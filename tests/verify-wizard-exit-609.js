// verify-wizard-exit-609.js —— #609 门禁：向导不能因为「没人应答」或「调起器返回非零」就静默改变结论。
//
// 为什么要有这一条：tests/verify-release-contract.js 的 F 段只看关键字与 `bash -n` 语法，不跑真行为，
//   所以下面两类缺陷从 2026-09-08 那次「修复」之后一直是绿的：
//     一、`wizard/template.sh` 的 open_url 把调起器的退出码交回给调用处，于是 `set -e` 在「弹浏览器」这一步
//         当场结束整个发布向导（本机 explorer.exe 打开网址稳定返回 1），屏幕停在「↗ opening …」，没有任何提示；
//     二、pause / confirm 用 `read … || true`，读不到任何输入（后台跑、没人坐在终端前）时回复变量保持空串，
//         向导据此静默走「否」分支，还把「已发布」写进落盘文件，退出码仍是 0。
//   本门禁不扫关键字，它驱动真实脚本代码：
//     A. 用向导库真的 open_url 去调一个「返回 1 的调起器」，再把 scripts/wizard-release.sh 里每一处
//        open_url 调用按行号原样抽出来执行，看脚本会不会被带走；
//     B. 让 pause 在 stdin 关掉时跑，看它是明确失败还是静默返回成功；
//     C. 把 scripts/wizard-release.sh 的发布那一段（第 285–320 行）整段抽出来跑，npm 与调起器都换成桩函数；
//     D. 对照：换成「有人应答」的输入，同一段必须照常走完并照常记「已发布」。
//   确定性、秒级、不需要人按键、不联网，也绝不执行真实发布（npm 全程是桩，只打印参数），
//   更不会弹浏览器：调起器换成了「返回 1 的桩」，真 explorer.exe 一次都不会被调到。
//
// 「没有人应答」的判据（与 wizard/template.sh 里的注释是同一句话）：读不到任何输入（read 返回非零，
//   也就是输入流已经结束、并没有人在按键）即为「没有人应答」；空行仍算「有人按了回车」，所以人自己
//   按回车走「否」那条路不受影响，向导只是不再把「没人应答」当成「人按了否」。
//
// 用法：node tests/verify-wizard-exit-609.js（在插件根目录，不需要构建产物，需要 Git Bash 的 bash）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const WIZARD_REL = 'scripts/wizard-release.sh'
const WORK_REL = 'test/wizard-609-work'
const WORK = path.join(ROOT, WORK_REL)
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
// 发布那一段的行号：抽的是产品源码本身，不手抄。改向导的人若把这段挪了位置，这段门禁会当场花掉提醒对齐。
const PUBLISH_START = 285
const PUBLISH_END = 320

let failed = false
let total = 0
function check(ok, msg) {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// 交给 bash 的路径写成 Git Bash 的 /d/... 形式；同一个 /d/... 在 WSL 的 bash 里也能落到同一个目录。
function toBashPath(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  if (!m) return p.replace(/\\/g, '/')
  return '/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/')
}
// 本机同时装着 WSL 的 bash 与 Git Bash 的 bash：本门禁要的是仓库文档指定的那个 Git Bash
// （explorer.exe 这一支只有它才走得到），所以先把 Git Bash 的绝对路径找出来，找不到再回落 PATH 上的 bash。
function resolveBash() {
  if (process.env.WIZARD_TEST_BASH) return process.env.WIZARD_TEST_BASH
  if (fs.existsSync(GIT_BASH)) return GIT_BASH
  return 'bash'
}
// 这台机器上连 bash 都起不来时跳过并打印说明，而不是报红：跑不了 bash 的机器本来就不该被这条门禁判失败
// （离线门禁不该因为环境缺失而阻断别人；仓库里其它需要外部程序的检查也是这个口径）。
function bashAvailable() {
  try {
    const r = spawnSync(resolveBash(), ['-c', 'exit 0'], { encoding: 'utf8', timeout: 20000 })
    return !r.error && r.status === 0
  } catch (e) {
    return false
  }
}

function runBash(relPath, args, opts) {
  return spawnSync(resolveBash(), [relPath].concat(args || []), Object.assign({
    cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000,
  }, opts || {}))
}
function outOf(r) { return (r.stdout || '') + (r.stderr || '') }
function readWorkFile(name) {
  const p = path.join(WORK, name)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}
function readWizardSource() { return fs.readFileSync(path.join(ROOT, WIZARD_REL), 'utf8') }
// 抽一段产品源码，原样拼进探针脚本，绝不手抄。
function extractPublishSegment() {
  return readWizardSource().split('\n').slice(PUBLISH_START - 1, PUBLISH_END).join('\n')
}
function listOpenUrlCallLines(src) {
  return src.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^open_url\s/.test(line))
}
// 本仓库的门禁惯例：门禁自己确认已挂进 npm run verify 链，免得哪天被摘掉还没人发现。
function isInVerifyChain() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    return String((pkg.scripts && pkg.scripts.verify) || '').includes('verify-wizard-exit-609.js')
  } catch (e) {
    return false
  }
}

// 在仓库根下写一段真脚本：只 source 向导库，之后是探针自己的准备段与要验的代码。
// 探针的输入走命令行参数（这个环境里 Node 传给 bash 的环境变量会被丢掉，实测如此，所以不靠环境变量）。
function writeProbe(name, prepLines) {
  const rel = WORK_REL + '/' + name
  fs.writeFileSync(path.join(ROOT, rel), [
    'set -euo pipefail',
    'REPO_REL="$1"',
    '. "$REPO_REL/wizard/template.sh"',
  ].concat(prepLines).concat(['']).join('\n'), 'utf8')
  return rel
}
// 探针里所有仓库内路径都写成「仓库相对路径」，省得跨系统两种写法（Git Bash 的 /d/... 与 WSL 的 /mnt/d/...）各拼一遍。
const REPO_REL_ARG = toBashPath(ROOT)

// 「返回非零的调起器」桩：本机 explorer.exe 打开网址稳定返回 1，这里用同名桩复刻那一条。
// 之所以连 command -v 一起接管：产品代码是「先问有没有 wslview，有就调」，不接管的话本机真的会调 explorer.exe，
// 门禁就会往桌面弹一个网页 —— 那是不能接受的副作用。接管之后，真调起器一个字节都走不到。
function launcherStubLines(indent) {
  const pad = indent || ''
  return [
    '# 桩调起器：command -v 一律答「有」，真命令一律返回 1（复刻本机 explorer.exe 的行为）',
    pad + 'command() {',
    pad + '  if [[ "${1:-}" = "-v" ]]; then',
    pad + '    case "${2:-}" in wslview) return 0 ;; explorer.exe) return 1 ;; xdg-open) return 1 ;; open) return 1 ;; esac',
    pad + '  fi',
    pad + '  builtin command "$@"',
    pad + '}',
    pad + 'wslview() { return 1; }',
    pad + 'xdg-open() { return 1; }',
    pad + 'explorer.exe() { return 1; }',
    pad + 'open() { return 1; }',
  ]
}

function main() {
  console.log('向导退出语义门禁（#609：调起器返回值不决定脚本生死、没人应答要明确失败、没发布不许记「已发布」）')
  console.log('「没有人应答」= 读不到任何输入（read 返回非零）；空行仍算有人按了回车。')
  if (!bashAvailable()) {
    console.log('  跳过：这台机器上起不了 bash（找过 Git Bash 的常规位置，也试过 PATH 上的 bash）。')
    console.log('  本门禁驱动的是 bash 脚本的真实行为，没有 bash 就无从判定；按仓库惯例跳过而不是报红。')
    console.log('  要指定 bash 可设环境变量 WIZARD_TEST_BASH=<bash 可执行文件路径> 后重跑。')
    process.exit(0)
  }
  check(isInVerifyChain(), '本门禁已挂进 npm run verify 链（package.json 的 scripts.verify 里有 verify-wizard-exit-609.js）')
  try {
    fs.rmSync(WORK, { recursive: true, force: true })
    fs.mkdirSync(path.join(WORK, 'walk-root', 'package'), { recursive: true })
    const src = readWizardSource()
    const callCount = listOpenUrlCallLines(src).length

    // ── 一、调起器返回非零时，产品里每一处 open_url 调用都不许把脚本带走 ──
    {
      const stub = launcherStubLines(' ').join('\n')
      const probe = writeProbe('probe-open-url.sh', [
        launcherStubLines('').join('\n'),
        'command -v wslview >/dev/null 2>&1 || { echo "桩调起器没接上，这一条没验成"; exit 90; }',
        '# 产品那几行 open_url 的网址里用到这些变量，先照产品自己的取值补上（值本身不参与判定）',
        'PKG="dsh-mattpocock-skills-deck"',
        '# 产品源码里每一处 open_url 调用（只看以 open_url 开头那一行）按行号原样抽出来执行：',
        '# 这不是关键字扫描，跑的就是产品那一行；它下面紧挨的 step / say 行不在抽取范围内。',
        'CALL_LINES=$(grep -n "^[[:space:]]*open_url " "$REPO_REL/' + WIZARD_REL + '" | cut -d: -f1)',
        'COUNT=0',
        'for n in $CALL_LINES; do',
        '  COUNT=$((COUNT + 1))',
        '  sed -n "${n}p" "$REPO_REL/' + WIZARD_REL + '" > "' + WORK_REL + '/call.$COUNT.sh"',
        '  printf "\\n" >> "' + WORK_REL + '/call.$COUNT.sh"',
        '  . "' + WORK_REL + '/call.$COUNT.sh"',
        '  echo "【探针】第 $n 行 open_url 之后脚本还活着"',
        'done',
        'echo "【探针】共跑过 $COUNT 处 open_url"',
        '# 再正面量一次返回值本身：库函数不该把调起器的退出码交出来',
        'open_url "https://example.invalid/probe"',
        'echo "【探针】open_url 对着返回 1 的调起器返回 $?"',
      ].concat(['']).join('\n'))
      const r = runBash(probe, [REPO_REL_ARG])
      check(callCount === 4, '产品脚本 ' + WIZARD_REL + ' 里认得出 4 处 open_url 调用（实得 ' + callCount + ' 处）')
      check(r.status === 0, '调起器返回非零时，每一处 open_url 调用都不会结束脚本（探针退出码 ' + r.status + '）')
      const alive = (outOf(r).match(/【探针】第 \d+ 行 open_url 之后脚本还活着/g) || []).length
      check(alive === callCount, callCount + ' 处调用全部走过（实得 ' + alive + ' 处）')
      const zero = outOf(r).indexOf('【探针】open_url 对着返回 1 的调起器返回 0') >= 0
      const got = (outOf(r).match(/【探针】open_url 对着[^\n]*/) || ['（没有这一行）'])[0]
      check(zero, '向导库的 open_url 对着「返回 1 的调起器」也返回 0（实得 ' + JSON.stringify(got) + '）')
      check(outOf(r).indexOf('桩调起器没接上') < 0, '桩调起器确实接上了（不是「压根没走到 open_url」）')
    }

    // ── 二、pause 在「没人应答」时要明确失败，而不是静默返回成功 ──
    {
      const probe = writeProbe('probe-pause-eof.sh', [
        'pause "探针：没人应答"',
        'echo "【探针】pause 在没人应答时返回了（这条不该出现）"',
      ])
      const r = runBash(probe, [REPO_REL_ARG], { input: '' })
      const text = outOf(r)
      check(r.status !== 0, 'pause 读不到任何输入时脚本以非零退出（实得 ' + r.status + '）')
      check(text.indexOf('【探针】pause 在没人应答时返回了') < 0, 'pause 读不到任何输入时不静默返回、不把「没人应答」当成「人按了回车」')
      check(/没有人应答/.test(text), '停下时说了「没有人应答」（' + (/没有人应答/.test(text) ? '有这句' : '没有这句') + '）')
      check(/没有发布任何东西/.test(text), '停下时说了「没有发布任何东西」一类的话')
      console.log('    探针最后两行：' + JSON.stringify(text.trim().split('\n').slice(-2).join(' / ')))
    }

    // ── 三、真脚本原样的发布段 + stdin 关掉：没人应答时不许静默走「否」、也不许记「已发布」 ──
    {
      const probe = writeProbe('probe-release-eof.sh', [
        'TEST_VERSION="v1.7.19"',
        'PKG="dsh-mattpocock-skills-deck"',
        'REGISTRY="https://registry.npmjs.org"',
        'VER_NUM="1.7.19"',
        'VERSION="$TEST_VERSION"',
        'ROOT="$REPO_REL/' + WORK_REL + '/walk-root"',
        'ENV_FILE="$REPO_REL/' + WORK_REL + '/wizard-release.env"',
        'export ENV_FILE',
        'TOTAL_STAGES=6',
        '_STAGE_INDEX=4',
        '# 调起器与 npm 都换成桩：这一整段跑下来不会发出去任何东西，也不会弹浏览器',
        'open_url() { return 0; }',
        'npm() { printf "    [桩] 不会真的执行：npm %s\\n" "$*"; return 0; }',
        '# ↓↓↓ 以下逐字来自 ' + WIZARD_REL + ' 第 ' + PUBLISH_START + '–' + PUBLISH_END + ' 行',
        extractPublishSegment(),
        '# ↑↑↑ 逐字抽取结束',
        'echo "【探针】发布那一段跑到最后一行了（这条不该出现）"',
      ])
      const r = runBash(probe, [REPO_REL_ARG], { input: '' })
      const envText = readWorkFile('wizard-release.env')
      check(r.status !== 0, '真脚本原样的发布段在「没有人应答」时退出码非 0（实得 ' + r.status + '）')
      check(envText.indexOf('WIZARD_RELEASE_PUBLISHED') < 0, '没人应答时不写 WIZARD_RELEASE_PUBLISHED（落盘文件内容：' + JSON.stringify(envText.trim()) + '）')
      check(outOf(r).indexOf('【探针】发布那一段跑到最后一行了') < 0, '没人应答时它不会一路跑到那一段的收尾')
      check(/没有人应答/.test(outOf(r)) && /没有发布任何东西/.test(outOf(r)), '停下时说清了「没有人应答，没有发布任何东西」')
    }

    // ── 四、对照实验：换成「有人应答」的输入，别把正常的问答一起堵死 ──
    {
      const probe = writeProbe('probe-release-human.sh', [
        'TEST_VERSION="v1.7.19"',
        'PKG="dsh-mattpocock-skills-deck"',
        'REGISTRY="https://registry.npmjs.org"',
        'VER_NUM="1.7.19"',
        'VERSION="$TEST_VERSION"',
        'ROOT="$REPO_REL/' + WORK_REL + '/walk-root"',
        'ENV_FILE="$REPO_REL/' + WORK_REL + '/env-with-human.env"',
        'export ENV_FILE',
        'TOTAL_STAGES=6',
        '_STAGE_INDEX=4',
        'open_url() { return 0; }',
        'npm() { printf "    [桩] 不会真的执行：npm %s\\n" "$*"; return 0; }',
        extractPublishSegment(),
        'echo "【探针】有人应答时这一段跑到了最后一行"',
      ])
      // 三行输入对应：确认「在本终端直接发布」= y、「发布步骤已完成」= 回车、「包主页 Latest 已是本版」= 回车。
      const r = runBash(probe, [REPO_REL_ARG], { input: 'y\n\n\n' })
      const envText = readWorkFile('env-with-human.env')
      check(r.status === 0 && outOf(r).indexOf('【探针】有人应答时这一段跑到了最后一行') >= 0, '有人在终端里按回车 / 输入 y 时，同一段照常走完（退出码 ' + r.status + '）')
      check(envText.indexOf('WIZARD_RELEASE_PUBLISHED=') >= 0, '有人应答并确认「已发布」时才写上 WIZARD_RELEASE_PUBLISHED（这次确实执行了发布命令，npm 是桩）')
    }
  } finally {
    try { fs.rmSync(WORK, { recursive: true, force: true }) } catch (e) {}
  }

  console.log('')
  console.log(failed
    ? '存在失败 — verify-wizard-exit-609 未通过（共 ' + total + ' 项断言）'
    : '全部通过 — 向导退出语义门禁生效（共 ' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main()
