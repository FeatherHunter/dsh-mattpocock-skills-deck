// 门禁归属: src/shared/version-control/src/commit-plan.ts
// verify-1586-commit-page.ts —— 提交页能力（规格 #1586 域 2 八条，T08 #1743）。
//
// 这一扇守的是「八条提交能力各自唯一主入口，git 参数独立拼装」这一组外部行为：
//   A 组：2.1–2.8 每条能力的 argv 逐元素断言（数组、不经 shell、次序固定）。
//   B 组：计划校验（2.4 缺目标 / 坏目标）、危险动作识别（2.3 / 2.4）、追加签名行原文。
//   B5/B6 是两条反证：把真源文本改坏之后，同一套断言必须判红——证明这扇门禁会咬，不是永远绿。
//
// 做法：不 import 真源模块，而是读真源原文、按构建同一份转译口径当场求值（与 verify-818 同一套装置）。
//   这样反证才落在「真源原文」上：改坏一份真源文本，就能看同一套断言在改坏的实现上判红。
//   后续 C–F 组（宿主读电话 / 预检 / 执行 / 客户端面板）在同一份文件上按同样方式追加。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-commit-page.ts
const path = require('path')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-commit-page'
let total = 0
let failed = 0
const check = (ok, msg) => {
  total += 1
  if (!ok) failed += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

const PLAN_SOURCE = 'src/shared/version-control/src/commit-plan.ts'
const PLAN_EXPORTS = [
  'VC_COMMIT_MODES', 'VC_COMMIT_MODE_KEYS', 'VC_COMMIT_MODE_CAPS', 'COMMIT_TARGET_PATTERN',
  'commitPlanDefault', 'commitPlanOf', 'commitPlanProblem', 'commitPlanDangerous', 'commitArgvOf', 'commitTrailerOf',
  'COMMIT_PLAN_SOURCE',
]

/** 去掉行首 export：与 verify-818 的拼闭包装置同一写法（求值用的是真源原文，不是产物）。 */
function stripExports(text) { return text.replace(/^(\s*)export\s+/gm, '$1') }

/** 按构建同一份转译参数把这段源码转成 JavaScript（不在这里另写一套参数）。 */
function toEvalJs(code) {
  const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
  return require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code
}

/** 把 commit-plan 真源原文（可先按 patch 改坏）求值成一组函数：反证装置就靠这个入口。 */
function evalPlan(patch) {
  let src = stripExports(sourceText(PLAN_SOURCE))
  if (patch) src = patch(src)
  src = toEvalJs(src)
  const body = src + '\nreturn { ' + PLAN_EXPORTS.join(', ') + ' }\n'
  return compileFn(['unused'], body)(null)
}

const P = evalPlan(null)

/** A5 的断言本体：单独抽出来，B5 的反证要对同一个函数用改坏实现再判一次。 */
const skipHooksOk = (M) => M.commitArgvOf({ mode: 'staged', skipHooks: true }, '标题').join('|') === 'commit|--no-verify|-m|标题'
/** A7 的断言本体：多行说明必须整段保留在同一个参数元素里。 */
const multiLineOk = (M) => {
  const msg = '标题\n\n正文第一段\n第二段'
  const argv = M.commitArgvOf({ mode: 'staged' }, msg)
  return argv.length === 3 && argv[2] === msg && argv[2].split('\n').length === 4
}

// ---------- A 组：八条能力各自的 argv（数组元素逐个断言，不拼整行比对） ----------
const av = (plan, msg) => P.commitArgvOf(plan, msg).join('|')

check(av({ mode: 'staged' }, '标题') === 'commit|-m|标题', 'A1 2.1 提交已暂存内容：argv 为 commit / -m / 说明三个独立元素')
check(av({ mode: 'all' }, '标题') === 'commit|-a|-m|标题', 'A2 2.2 提交全部已跟踪改动：-a 是独立元素，排在说明之前')
check(av({ mode: 'amend' }, '') === 'commit|--amend|--no-edit', 'A3a 2.3 修订上一条提交且不写新说明：用 --amend 与 --no-edit')
check(av({ mode: 'amend' }, '改说明') === 'commit|--amend|-m|改说明', 'A3b 2.3 修订并改说明：--amend 与 -m 说明各自独立')
check(av({ mode: 'fixup', target: 'HEAD~1' }, '随便') === 'commit|--fixup=HEAD~1', 'A4a 2.4 fixup：目标以 --fixup=<目标> 一个元素传入，不拼 -m')
check(av({ mode: 'squash', target: 'abc123' }, '随便') === 'commit|--squash=abc123|-m|随便', 'A4b 2.4 squash：目标以 --squash=<目标> 一个元素传入，说明另用 -m 传（执行层把编辑器钉成必定失败，git 不接受空说明）')
check(skipHooksOk(P), 'A5 2.5 跳过钩子：--no-verify 是独立元素，且恰好一次')
check(av({ mode: 'staged', sign: true }, '标题') === 'commit|-S|-m|标题' && av({ mode: 'staged', signoff: true }, '标题') === 'commit|-s|-m|标题', 'A6a 2.6 签名提交（-S）与追加签名行（-s）各是各的元素')
check(av({ mode: 'staged', sign: true, signoff: true }, '标题') === 'commit|-S|-s|-m|标题', 'A6b 2.6 两者同时勾选：-S 与 -s 分别是独立元素，不是一个合并开关')
check(!P.commitArgvOf({ mode: 'staged', sign: true }, '标题').includes('-s') && !P.commitArgvOf({ mode: 'staged', signoff: true }, '标题').includes('-S'), 'A6c 2.6 只勾签名时没有 -s、只勾追加签名行时没有 -S（两件事不互相冒充）')
check(multiLineOk(P), 'A7 2.7 多行提交说明：换行原样保留，整段说明只占 -m 后面的一个元素')
check(JSON.stringify(P.commitArgvOf({ mode: 'staged' }, '标题\n\n模板第一段\n模板第二段')) === JSON.stringify(['commit', '-m', '标题\n\n模板第一段\n模板第二段']), 'A8 2.8 套用模板后的原文：整份模板文本作为同一个 -m 元素传入')
check(av({ mode: 'staged', sign: true, signoff: true, skipHooks: true }, '标题') === 'commit|-S|-s|--no-verify|-m|标题', 'A9 全部开关一起勾：选项次序固定为 -S / -s / --no-verify / -m')
const argvAll = P.commitArgvOf({ mode: 'all', sign: true, signoff: true, skipHooks: true }, '标题')
check(argvAll.every((x) => typeof x === 'string' && x.indexOf('commit ') !== 0 && x.trim() === x), 'A10 argv 每个元素都是独立字符串（没有把多个选项拼成一整行，也没有首尾空白）')

// ---------- B 组：计划归一、校验、危险动作、追加签名行原文 ----------
const norm = P.commitPlanOf({ mode: 'nonsense', target: '  HEAD~1  ', skipHooks: 1, sign: 'true', signoff: true })
check(norm.mode === 'staged' && norm.target === 'HEAD~1' && norm.skipHooks === false && norm.sign === false && norm.signoff === true, 'B1 外部输入归一：名单外形态回落 staged，目标去空白，布尔只认 true')
check(P.commitPlanProblem({ mode: 'fixup' }) === 'need-commit-target', 'B2a 2.4 fixup 没选目标：理由为 need-commit-target')
check(P.commitPlanProblem({ mode: 'squash', target: '-x' }) === 'bad-commit-target', 'B2b 目标以短横线开头（像开关）：理由为 bad-commit-target')
check(P.commitPlanProblem({ mode: 'staged', target: 'a b' }) === 'bad-commit-target', 'B2c 目标里有空格：理由为 bad-commit-target')
check(P.commitPlanProblem({ mode: 'fixup', target: 'HEAD~1' }) === null && P.commitPlanProblem(P.commitPlanDefault()) === null, 'B2d 合法目标与默认计划都通过校验')
check(P.commitPlanDangerous({ mode: 'amend' }) && P.commitPlanDangerous({ mode: 'fixup', target: 'HEAD~1' }) && P.commitPlanDangerous({ mode: 'squash', target: 'HEAD~1' }), 'B3a 2.3 / 2.4 都被认成危险动作（界面必须给确认卡）')
check(!P.commitPlanDangerous({ mode: 'staged' }) && !P.commitPlanDangerous({ mode: 'all' }), 'B3b 2.1 / 2.2 不是危险动作')
check(P.commitTrailerOf({ name: '张三', email: 'z@y' }) === 'Signed-off-by: 张三 <z@y>', 'B4a 追加签名行原文按 git 的 Signed-off-by 格式生成')
check(P.commitTrailerOf({ name: '张三' }) === '' && P.commitTrailerOf(null) === '', 'B4b 身份缺名字或邮箱时回空串（界面据此说写不出来，不编造一行假签名）')

// ---------- 反证：篡改真源文本之后，同一套断言必须判红 ----------
const rawPlanSrc = sourceText(PLAN_SOURCE)
const mutant1Src = rawPlanSrc.replace("argv.push('--no-verify')", "argv.push('--no-verify-x')")
check(mutant1Src !== rawPlanSrc, 'B5-pre 反证一改动命中真源原文（改了 --no-verify 那一行）')
const mut1 = evalPlan((s) => s.replace("argv.push('--no-verify')", "argv.push('--no-verify-x')"))
check(skipHooksOk(P) === true && skipHooksOk(mut1) === false, 'B5 反证一：把 --no-verify 改坏后，A5 的同一断言必须判红')

const mutant2Patch = (s) => s.replace('argv.push(\'-m\', msg)', "argv.push('-m', msg.split('\\n')[0])")
const mutant2Src = mutant2Patch(rawPlanSrc)
check(mutant2Src !== rawPlanSrc, 'B6-pre 反证二改动命中真源原文（把 -m 的值改成只取第一行）')
const mut2 = evalPlan(mutant2Patch)
check(multiLineOk(P) === true && multiLineOk(mut2) === false, 'B6 反证二：把多行说明改成只取第一行后，A7 的同一断言必须判红')
check(skipHooksOk(mut1) === false && multiLineOk(mut2) === false, 'B7 反证装置自检：两条反证各自改中的那一半判红（不是所有断言一起红）')


// ---- C 组：宿主只读取数电话（wf.gitCommitForm）----
// 这一组真的把叶子模块装配起来拨电话，假的只是 git 进程出口与文件服务：
// 断言 argv 逐元素、身份/签名/模板/修订四块回包、软降级与固定失败信封。
const FORM_SOURCE = 'src/host/versionControlCommitForm.ts'
const MOUNT_SOURCE = 'src/host/versionControlCommitFormMount.ts'
const HOST_SOURCE = 'src/host/versionControl.ts'
const INDEX_SOURCE = 'src/host/index.ts'
const CWD = 'C:/repo'

/** 造一个只读电话的宿主替身：记录每次 git 调用的 argv、每次文件解析的路径，按 route 回假结果。 */
function makeFormHost(route, files) {
  const calls = []
  const resolves = []
  const fixed = require('../src/shared/version-control/src/commands.js').fixedPrefix
  const host = {
    failPhone: function (kind, message) { return { ok: false, error: { kind: kind, message: message } } },
    fs: {
      resolve: async function (p) { resolves.push(p); return p },
      readText: async function (p) {
        if (files && Object.prototype.hasOwnProperty.call(files, p)) return files[p]
        const e = new Error('ENOENT: no such file: ' + p)
        e.code = 'ENOENT'
        throw e
      },
    },
    fsAbsence: async function () { return { isAbsenceError: function (e) { return !!e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') } } },
    resolveGitExecutable: async function () { return 'git' },
    runGit: async function (exe, dir, argv, opts) {
      calls.push(argv)
      const rest = argv.slice(['-C', dir].concat(fixed()).length)
      const hit = route(rest, argv, opts)
      return Object.assign({ kind: 'ok', stdout: '', truncated: false }, hit || {})
    },
    fixedPrefix: fixed,
    DEFAULT_CWD: CWD,
    timeoutMs: 1234,
    STDOUT_LIMIT: 4096,
    now: function () { return 777 },
  }
  return { host: host, calls: calls, resolves: resolves }
}

/** 本机配置的假输出：六项表单要读的键各一行，值与键之间用 \n 分隔、条目之间用 NUL 分隔（git config --null --list 的形状）。 */
function formConfigOut(extra) {
  const pairs = [
    ['user.name', '张三'],
    ['user.email', 'z@example.com'],
    ['user.signingkey', 'ABC123'],
    ['gpg.format', 'ssh'],
    ['commit.gpgsign', 'true'],
    ['commit.template', '.gitmessage'],
  ]
  if (extra) pairs.push(extra)
  return pairs.map(function (p) { return p[0] + '\n' + p[1] }).join('\u0000') + '\u0000'
}

const FORM_TEMPLATE = '第一行摘要\n\n- 改动：把提交面板接进改动页\n- 原因：2.7 不再推外部编辑器\n'
const FORM_OID = 'a'.repeat(40)
const FORM_LOG_OUT = 'aaaaaaa\u0000原说明标题\u0000原说明标题\n\n正文第一段\n第二段\n'

async function formGroup() {
  const { pathToFileURL } = require('url')
  const formMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControlCommitForm.js')).href)
  const fixed = require('../src/shared/version-control/src/commands.js').fixedPrefix()

  /** 正常仓库的假命令出口：config 回六项配置、rev-parse 回一个满长 oid、log 回短号+主题+多行正文。 */
  function okRoute(rest) {
    if (rest[0] === 'config') return { stdout: formConfigOut(null) }
    if (rest[0] === 'rev-parse') return { stdout: FORM_OID + '\n' }
    if (rest[0] === 'log') return { stdout: FORM_LOG_OUT }
    return { kind: 'non-zero', exitCode: 2, stderr: 'unexpected command' }
  }

  const files = { 'C:/repo/.gitmessage': FORM_TEMPLATE }
  const made = makeFormHost(okRoute, files)
  const phone = formMod.createCommitFormPhone(made.host)
  const r = await phone.handleGitCommitForm({ cwd: CWD })

  // C1 命令拼装：-C 钉仓库 + 固定前缀之后，子命令与选项各自独立成元素，不经 shell。
  const expected = ['-C', CWD].concat(fixed).concat(['config', '--null', '--list'])
  check(made.calls.length >= 3 && made.calls[0].join('\u0001') === expected.join('\u0001'), 'C1 读配置的 argv 是「-C 钉仓库 + 固定前缀 + config --null --list」，每个元素独立')
  check(made.calls.every(function (a) { return a.every(function (x) { return typeof x === 'string' }) }), 'C2 每次 git 调用的参数全是独立字符串（没有整行拼接的命令串）')
  check(made.calls.every(function (a) { return a[0] === '-C' && a[1] === CWD }), 'C3 每次调用都用 -C 钉在请求的那棵仓库上')
  check(!made.calls.some(function (a) { return a.some(function (x) { return /[;&|]/.test(x) }) }), 'C4 参数里没有 shell 连接符（不经过 shell 拼命令）')

  // C5 身份、签名、追加签名行原文：都从本机配置读，追加签名行不依赖任何全局设置。
  check(r.ok === true && r.identity.name === '张三' && r.identity.email === 'z@example.com', 'C5 回包带上 git 配置里的提交身份（user.name / user.email）')
  check(r.signing.key === 'ABC123' && r.signing.format === 'ssh' && r.signing.gpgsign === true, 'C6 回包带上签名三项（密钥 / 格式 / 是否默认签名）')
  check(r.trailer === 'Signed-off-by: 张三 <z@example.com>', 'C7 追加签名行原文由身份拼出，与签名提交是两回事')

  // C8 模板（2.8）：读全文、按 cwd 拼相对路径、多行原样保留。
  check(r.template.configured === true && r.template.text === FORM_TEMPLATE && r.template.problem === '', 'C8 commit.template 读回全文（多行原样保留）')
  check(made.resolves.indexOf(CWD + '/.gitmessage') >= 0, 'C9 相对路径的模板按请求的工作目录拼成绝对路径再读')
  check(r.template.truncated === false, 'C10 正常长度的模板不标截断')

  // C11 修订（2.3）预填：原提交号、短号、主题与多行说明原样拿回。
  check(r.amend.available === true && r.amend.oid === FORM_OID && r.amend.short === 'aaaaaaa', 'C11 修订目标读回原提交号与短号（面板据此显示「修订哪一条」）')
  check(r.amend.subject === '原说明标题' && r.amend.message === '原说明标题\n\n正文第一段\n第二段', 'C12 修订预填拿回原说明原文，多行保留且不留行尾空行')
  check(made.calls.some(function (a) { return a.slice(['-C', CWD].concat(fixed).length).join('|') === 'log|-1|--format=%h%x00%s%x00%B' }), 'C13 读原说明的 log 参数各自独立成元素（格式串是一个元素，不是拼出来的命令）')

  // C14 还没有任何提交时只是「不能修订」，整条电话仍成功：表单不能因此打不开。
  const noHead = makeFormHost(function (rest) {
    if (rest[0] === 'config') return { stdout: formConfigOut(null) }
    if (rest[0] === 'rev-parse') return { kind: 'non-zero', exitCode: 128, stderr: 'fatal: Needed a single revision' }
    return { kind: 'non-zero', exitCode: 2, stderr: 'unexpected command' }
  }, files)
  const rNoHead = await formMod.createCommitFormPhone(noHead.host).handleGitCommitForm({ cwd: CWD })
  check(rNoHead.ok === true && rNoHead.amend.available === false && rNoHead.amend.problem === 'no-commits', 'C14 没有上一条提交时电话仍 ok:true，修订项回 problem=no-commits 让按钮禁用')
  check(noHead.calls.length === 2 && noHead.calls.every(function (a) { return a.slice(-1)[0] !== 'log' && a[a.length - 3] !== 'log' }), 'C15 没有提交时不再多跑读说明那条 log 命令')

  // C16 模板配了但文件不在：软降级（prolem=missing），不把整张表单判死。
  const noTpl = makeFormHost(okRoute, {})
  const rNoTpl = await formMod.createCommitFormPhone(noTpl.host).handleGitCommitForm({ cwd: CWD })
  check(rNoTpl.ok === true && rNoTpl.template.configured === true && rNoTpl.template.text === '' && rNoTpl.template.problem === 'missing', 'C16 模板文件缺失时回 problem=missing（软降级，表单照常打开）')

  // C17 没配模板：configured=false，不报问题。
  const withoutTpl = makeFormHost(function (rest) {
    if (rest[0] === 'config') return { stdout: formConfigOut(null).split('\u0000').filter(function (x) { return x !== '' && x.indexOf('commit.template\n') < 0 }).join('\u0000') + '\u0000' }
    if (rest[0] === 'rev-parse') return { stdout: FORM_OID + '\n' }
    if (rest[0] === 'log') return { stdout: FORM_LOG_OUT }
    return { kind: 'non-zero', exitCode: 2, stderr: 'unexpected command' }
  }, {})
  const rWithout = await formMod.createCommitFormPhone(withoutTpl.host).handleGitCommitForm({ cwd: CWD })
  check(rWithout.template.configured === false && rWithout.template.problem === '', 'C17 没配 commit.template 时回 configured=false，界面显示「没有模板」而不是失败')

  // C18/C19 失败信封：读配置超时与非零退出都回固定形状 { ok:false, error:{ kind, message } }。
  const timeout = makeFormHost(function (rest) { if (rest[0] === 'config') return { kind: 'timeout', timeoutMs: 1234 }; return { kind: 'ok', stdout: '' } }, {})
  const rTimeout = await formMod.createCommitFormPhone(timeout.host).handleGitCommitForm({ cwd: CWD })
  check(rTimeout.ok === false && rTimeout.error.kind === 'timeout', 'C18 读配置超时回 ok:false + kind=timeout（不假装成功）')
  check(Object.keys(rTimeout.error).sort().join(',') === 'kind,message', 'C19 失败信封固定为 { ok:false, error:{ kind, message } }，不多带字段')
  const rejected = makeFormHost(function (rest) { if (rest[0] === 'config') return { kind: 'non-zero', exitCode: 128, stderr: 'fatal' }; return { kind: 'ok', stdout: '' } }, {})
  const rRejected = await formMod.createCommitFormPhone(rejected.host).handleGitCommitForm({ cwd: CWD })
  check(rRejected.ok === false && rRejected.error.kind === 'git', 'C20 配置被 git 拒绝时回 kind=git，不落 unknown')

  // C21 反证：把正常回包里的邮箱去掉，C5 的同一套断言本体必须判红（证明这几条断言会咬）。
  const identityOk = function (res) { return res.ok === true && res.identity.name === '张三' && res.identity.email === 'z@example.com' }
  check(identityOk(r) === true, 'C21 反证前件：同一套身份断言在真回包上成立')
  check(identityOk({ ok: true, identity: { name: '张三', email: '' } }) === false, 'C22 反证：身份回包里少了邮箱，同一套断言必须判红')

  // C23 源码断言：读电话的叶子不自己起进程；装配线三处都在。
  const formSrc = sourceText(FORM_SOURCE)
  check(!/child_process|spawnSync|execSync/.test(formSrc), 'C23 源码断言：读电话叶子不自己起进程（只走注入的 git 出口）')
  check(sourceText(HOST_SOURCE).indexOf('createCommitFormMount') >= 0 && sourceText(INDEX_SOURCE).indexOf("harness.handle('wf.gitCommitForm'") >= 0, 'C24 父文件与宿主注册表都已接上 wf.gitCommitForm 电话')
  check(sourceText(MOUNT_SOURCE).indexOf("loggedPhone('wf.gitCommitForm'") >= 0, 'C25 装配壳用同一套 loggedPhone 日志口径包住这条电话')
}


// ---- D/E 组：宿主预检与执行（真临时仓库 + 可路由假 subprocess）----
// 做法与 tests/verify-841-write-phones.ts 同一套：只读命令真跑 git，写命令可被 override 拦下来，
// 这样「真跑过的 argv」「真仓库有没有被动过」「票据门有没有拦住」都能断言，不必摸私有函数。
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

function realGit(cwd, args) {
  const r = spawnSync('git', args, { cwd: cwd, encoding: 'utf8', windowsHide: true, env: Object.assign({}, process.env, { GIT_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'false' }) })
  return { code: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() }
}

/** 造一个真临时仓库：默认带一条基线提交并把 a.txt 的改动暂存好（2.1 的起点）。 */
function mkRealRepo(tag, withCommit) {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'dsws1743-' + tag + '-'))
  realGit(dir, ['init', '-q', '-b', 'main'])
  realGit(dir, ['config', 'user.name', '测试员'])
  realGit(dir, ['config', 'user.email', 't@example.com'])
  require('fs').writeFileSync(require('path').join(dir, 'a.txt'), 'a\n')
  if (withCommit !== false) {
    realGit(dir, ['add', '-A'])
    realGit(dir, ['commit', '-q', '-m', '基线提交'])
    require('fs').writeFileSync(require('path').join(dir, 'a.txt'), 'a\nb\n')
    realGit(dir, ['add', 'a.txt'])
  }
  return dir
}

/** 造一个宿主版控实例：deps 形状照 verify-841；写命令默认真跑，用例可 setOverride 拦截。 */
async function makeCommitVc(tag, withCommit) {
  const dir = mkRealRepo(tag, withCommit)
  const spawns = []
  const requests = []
  const logs = []
  const clock = { t: 1000 }
  let override = null
  const deps = {
    subprocess: {
      spawn: function (req) {
        spawns.push(req.argv.slice())
        requests.push({ argv: req.argv.slice(), cwd: req.cwd })
        const hit = override ? override(req.argv, req) : null
        if (hit) {
          const mk = function (t, trunc) { return { finalize: function () { return { text: String(t === undefined || t === null ? '' : t), truncated: trunc === true } } } }
          return { done: Promise.resolve({ exitCode: hit.code || 0 }), collected: { stdout: mk(hit.stdout, hit.truncated), stderr: mk(hit.stderr) }, terminate: function () {} }
        }
        const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26, env: Object.assign({}, process.env, { GIT_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'false' }) })
        const mk2 = function (b) { return { finalize: function () { return { text: String(b || ''), truncated: false } } } }
        return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk2(r.stdout), stderr: mk2(r.stderr) }, terminate: function () {} }
      },
    },
    timer: { timeout: function (ms) { return new Promise(function (res) { setTimeout(res, ms) }) } },
    fs: { stat: async function (p) { return await require('fs').promises.stat(p) }, lstat: async function (p) { return await require('fs').promises.lstat(p) }, exists: async function (p) { try { await require('fs').promises.access(p); return true } catch (e) { return false } } },
    getPlatform: async function () { return { resolveExecutable: async function (n) { return n === 'git' ? 'git' : null } } },
    DEFAULT_CWD: ROOT,
    TIMEOUT_MS: 30000,
    gate: { noteOutbound: function () {} },
    logCtx: { fire: function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
    now: function () { return clock.t },
  }
  const vcMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const vc = vcMod.createVersionControl(deps)
  const apps = require('../src/shared/version-control/src/commit-plan.js')
  function after(argv) { const i = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return i < 0 ? argv : argv.slice(i + 1) }
  function writeSpawns() { return spawns.filter(function (a) { return ['add', 'reset', 'commit', 'pull', 'push', 'fetch'].indexOf(after(a)[0]) >= 0 }) }
  return { dir: dir, vc: vc, spawns: spawns, requests: requests, clock: clock, after: after, writeSpawns: writeSpawns, setOverride: function (fn) { override = fn }, logs: logs, plans: apps }
}

async function commitGroup() {
  const plans = require('../src/shared/version-control/src/commit-plan.js')
  const defaultPlan = plans.commitPlanDefault()

  console.log('D 提交计划预检（真仓库）')
  // D1 2.1 提交暂存内容：默认计划在「有暂存」时放行，票据里绑计划摘要与索引条数。
  const h1 = await makeCommitVc('d1')
  const p1 = await h1.vc.handleGitWriteCheck({ cwd: h1.dir, op: 'commit', message: '标题一', plan: null })
  check(p1.ok === true && p1.decision.verdict === 'allow' && p1.plan.mode === 'staged', 'D1 2.1 有暂存内容时默认计划放行（plan.mode=staged）')
  const t1 = (await h1.vc.writeTickets()).get(p1.ticket.id)
  check(!!t1 && t1.target.mode === 'staged' && typeof t1.bindings.preconditions.planDigest === 'string' && t1.bindings.preconditions.planDigest.length === 16, 'D2 票据里绑了提交计划摘要（16 位短摘要），执行前会重算比对')

  // D3 2.2 全部已跟踪改动：只有未暂存改动时也能提交；另外默认计划此时应被挡（nothing-staged）。
  const h2 = await makeCommitVc('d2')
  realGit(h2.dir, ['reset', '-q'])
  const p2 = await h2.vc.handleGitWriteCheck({ cwd: h2.dir, op: 'commit', message: '标题二', plan: { mode: 'all' } })
  check(p2.ok === true && p2.decision.verdict === 'allow' && p2.plan.mode === 'all', 'D3 2.2 只有未暂存改动时 -a 计划仍放行（不逼人先暂存）')
  const t2 = (await h2.vc.writeTickets()).get(p2.ticket.id)
  check(!!t2 && typeof t2.bindings.preconditions.worktreeDigest === 'string' && t2.bindings.preconditions.worktreeDigest.length === 16, 'D4 2.2 额外绑工作树形状（预检后改过的已跟踪文件不会被 -a 静默带走）')
  const p2default = await h2.vc.handleGitWriteCheck({ cwd: h2.dir, op: 'commit', message: '标题二', plan: null })
  check(p2default.ok === false && p2default.error.kind === 'blocked' && p2default.decision.reasons.indexOf('nothing-staged') >= 0, 'D5 反证：同一仓库用默认计划（只提交暂存区）必须被挡，理由 nothing-staged')

  // D6 2.3 修订：没有暂存内容也能只改说明；但分支还没有提交时给 nothing-to-amend。
  const h3 = await makeCommitVc('d3')
  realGit(h3.dir, ['reset', '-q'])
  const p3 = await h3.vc.handleGitWriteCheck({ cwd: h3.dir, op: 'commit', message: '只改说明', plan: { mode: 'amend' } })
  check(p3.ok === true && p3.decision.verdict === 'allow' && p3.plan.mode === 'amend', 'D6 2.3 没有暂存内容也能修订（只改说明这一档不再被 nothing-staged 挡）')
  const h3empty = await makeCommitVc('d3empty', false)
  const p3empty = await h3empty.vc.handleGitWriteCheck({ cwd: h3empty.dir, op: 'commit', message: '', plan: { mode: 'amend' } })
  check(p3empty.ok === false && p3empty.error.kind === 'blocked' && p3empty.decision.reasons.indexOf('nothing-to-amend') >= 0, 'D7 2.3 分支还没有任何提交时挡下来，理由 nothing-to-amend（按钮据此禁用并说清原因）')

  // D8 2.4 目标核验：目标不在仓库里、目标形状不对，都要当场拒且零写命令。
  const h4 = await makeCommitVc('d4')
  const n4 = h4.writeSpawns().length
  const p4 = await h4.vc.handleGitWriteCheck({ cwd: h4.dir, op: 'commit', message: '', plan: { mode: 'fixup', target: 'deadbeef' } })
  check(p4.ok === false && p4.error.reason === 'bad-commit-target' && h4.writeSpawns().length === n4, 'D8 2.4 fixup 目标不在仓库里：bad-commit-target 且零写命令')
  const p4shape = await h4.vc.handleGitWriteCheck({ cwd: h4.dir, op: 'commit', message: '', plan: { mode: 'squash', target: '--junk' } })
  check(p4shape.ok === false && p4shape.error.reason === 'bad-commit-target', 'D9 2.4 目标形状不对（像开关）：bad-commit-target，连同形状一起拒')
  const p4miss = await h4.vc.handleGitWriteCheck({ cwd: h4.dir, op: 'commit', message: '', plan: { mode: 'fixup' } })
  check(p4miss.ok === false && p4miss.error.reason === 'need-commit-target', 'D10 2.4 没选目标：need-commit-target（界面同一理由禁用按钮）')

  // D11 票据绑计划：预检按 2.1 开的票，执行时换成 2.3 修订必须拒，且 HEAD 不动。
  const h5 = await makeCommitVc('d5')
  const p5 = await h5.vc.handleGitWriteCheck({ cwd: h5.dir, op: 'commit', message: '普通提交', plan: null })
  const head5 = realGit(h5.dir, ['rev-parse', 'HEAD']).out
  const n5 = h5.writeSpawns().length
  const x5 = await h5.vc.handleGitCommit({ cwd: h5.dir, ticketId: p5.ticket.id, requestId: 'mismatch-1', message: '普通提交', plan: { mode: 'amend' } })
  check(x5.ok === false && x5.error.reason === 'target-changed' && h5.writeSpawns().length === n5 && realGit(h5.dir, ['rev-parse', 'HEAD']).out === head5, 'D11 票据绑定生效：执行时把 2.1 换成 2.3 被拒 target-changed，零写命令、HEAD 不动')

  console.log('E 提交执行（argv 逐元素与失败分类）')
  // E1 2.1：真跑一条 git commit -m，argv 每个元素独立、cwd 钉在票的那棵树。
  const h6 = await makeCommitVc('e1')
  const p6 = await h6.vc.handleGitWriteCheck({ cwd: h6.dir, op: 'commit', message: '第一行标题' })
  const x6 = await h6.vc.handleGitCommit({ cwd: h6.dir, ticketId: p6.ticket.id, requestId: 'e1-1', message: '第一行标题', plan: null })
  const c6 = h6.spawns.filter(function (a) { return h6.after(a)[0] === 'commit' })[0] || []
  const r6 = h6.requests[h6.spawns.indexOf(c6)] || {}
  check(x6.ok === true && x6.committed === true && x6.mode === 'staged', 'E1 2.1 提交成功，回包带形态 staged 与前后 HEAD')
  check(h6.after(c6).join('\u0001') === 'commit\u0001-m\u0001第一行标题', 'E2 2.1 argv 逐元素：commit / -m / 整段说明各占一个元素（说明里的换行与空格不被拆开）')
  check(c6.every(function (x) { return typeof x === 'string' }) && c6.indexOf('--no-pager') > 0 && c6.indexOf('i18n.logOutputEncoding=UTF-8') > 0 && c6.indexOf('--literal-pathspecs') > 0 && h6.after(c6)[0] === 'commit', 'E3 子命令排在固定前缀之后，且全是独立的字符串元素（没有 shell 拼接过的一整行）')
  check(r6.cwd === h6.dir, 'E4 执行时的 cwd 钉在票据那条仓库上（不是调用方随便给的目录）')

  // E5 2.2：argv 带 -a。
  const h7 = await makeCommitVc('e2')
  realGit(h7.dir, ['reset', '-q'])
  const p7 = await h7.vc.handleGitWriteCheck({ cwd: h7.dir, op: 'commit', message: '全部已跟踪改动', plan: { mode: 'all' } })
  const x7 = await h7.vc.handleGitCommit({ cwd: h7.dir, ticketId: p7.ticket.id, requestId: 'e2-1', message: '全部已跟踪改动', plan: { mode: 'all' } })
  const c7 = h7.spawns.filter(function (a) { return h7.after(a)[0] === 'commit' })[0] || []
  check(x7.ok === true && x7.mode === 'all' && h7.after(c7).join('\u0001') === 'commit\u0001-a\u0001-m\u0001全部已跟踪改动', 'E5 2.2 argv 是 commit -a -m：-a 独立元素且排在说明前')

  // E6 2.3：修订上一条提交，argv 是 --amend；说明为空时用 --no-edit 不逼人重写。
  const h8 = await makeCommitVc('e3')
  realGit(h8.dir, ['reset', '-q'])
  const p8 = await h8.vc.handleGitWriteCheck({ cwd: h8.dir, op: 'commit', message: '改写后的说明', plan: { mode: 'amend' } })
  const x8 = await h8.vc.handleGitCommit({ cwd: h8.dir, ticketId: p8.ticket.id, requestId: 'e3-1', message: '改写后的说明', plan: { mode: 'amend' } })
  const c8 = h8.spawns.filter(function (a) { return h8.after(a)[0] === 'commit' })[0] || []
  check(x8.ok === true && x8.mode === 'amend' && h8.after(c8).join('\u0001') === 'commit\u0001--amend\u0001-m\u0001改写后的说明', 'E6 2.3 argv 是 commit --amend -m，仍是独立元素')
  check(realGit(h8.dir, ['log', '-1', '--format=%s']).out === '改写后的说明', 'E7 2.3 真仓库的上一条提交说明确实被改写（HEAD 换了新提交，说明是新写的）')
  const p8b = await h8.vc.handleGitWriteCheck({ cwd: h8.dir, op: 'commit', message: '', plan: { mode: 'amend' } })
  const x8b = await h8.vc.handleGitCommit({ cwd: h8.dir, ticketId: p8b.ticket.id, requestId: 'e3-2', message: '', plan: { mode: 'amend' } })
  const c8b = h8.spawns.filter(function (a) { return h8.after(a)[0] === 'commit' })[1] || []
  check(x8b.ok === true && h8.after(c8b).join('\u0001') === 'commit\u0001--amend\u0001--no-edit', 'E8 2.3 不带新说明时 argv 用 --no-edit（允许只改内容，不逼人重写说明）')

  // E9 2.4：fixup / squash 的 argv 把目标提交写成 --fixup=<目标> / --squash=<目标>，不带 -m。
  const h9 = await makeCommitVc('e4')
  const target9 = realGit(h9.dir, ['rev-parse', 'HEAD']).out
  const p9 = await h9.vc.handleGitWriteCheck({ cwd: h9.dir, op: 'commit', message: '', plan: { mode: 'fixup', target: target9 } })
  const x9 = await h9.vc.handleGitCommit({ cwd: h9.dir, ticketId: p9.ticket.id, requestId: 'e4-1', message: '', plan: { mode: 'fixup', target: target9 } })
  const c9 = h9.spawns.filter(function (a) { return h9.after(a)[0] === 'commit' })[0] || []
  check(x9.ok === true && x9.mode === 'fixup' && h9.after(c9).join('\u0001') === 'commit\u0001--fixup=' + target9, 'E9 2.4 fixup argv 是 commit --fixup=<目标>，说明由 git 自己写（不带 -m）')
  const h10 = await makeCommitVc('e5')
  const target10 = realGit(h10.dir, ['rev-parse', 'HEAD']).out
  const p10 = await h10.vc.handleGitWriteCheck({ cwd: h10.dir, op: 'commit', message: '压缩说明', plan: { mode: 'squash', target: target10 } })
  const x10 = await h10.vc.handleGitCommit({ cwd: h10.dir, ticketId: p10.ticket.id, requestId: 'e5-1', message: '压缩说明', plan: { mode: 'squash', target: target10 } })
  const c10 = h10.spawns.filter(function (a) { return h10.after(a)[0] === 'commit' })[0] || []
  check(x10.ok === true && x10.mode === 'squash' && h10.after(c10).join('\u0001') === 'commit\u0001--squash=' + target10 + '\u0001-m\u0001压缩说明', 'E10 2.4 squash argv 是 commit --squash=<目标> -m <说明>（编辑器钉成败型，说明只能走 -m）')

  // E11 2.5 / 2.6：跳过钩子、签名提交、追加签名行三个开关各自独立成一个元素，次序固定。
  const h11 = await makeCommitVc('e6')
  const plan11 = { mode: 'staged', skipHooks: true, sign: true, signoff: true }
  const p11 = await h11.vc.handleGitWriteCheck({ cwd: h11.dir, op: 'commit', message: '带开关的提交', plan: plan11 })
  h11.setOverride(function (argv) { return h11.after(argv)[0] === 'commit' ? { code: 0 } : null })
  const x11 = await h11.vc.handleGitCommit({ cwd: h11.dir, ticketId: p11.ticket.id, requestId: 'e6-1', message: '带开关的提交', plan: plan11 })
  const c11 = h11.spawns.filter(function (a) { return h11.after(a)[0] === 'commit' })[0] || []
  check(h11.after(c11).join('\u0001') === 'commit\u0001-S\u0001-s\u0001--no-verify\u0001-m\u0001带开关的提交', 'E11 2.5/2.6 开关次序固定：-S（签名提交）→ -s（追加签名行）→ --no-verify（跳过钩子）→ -m，三者互不替代')
  check(x11.ok === true && x11.sign === true && x11.signoff === true && x11.skipHooks === true, 'E12 回包如实说这次用了哪些开关（界面据此写结果细节）')

  // E13 同一 requestId 重放：回到同一份结果，不再起第二条提交进程。
  const h12 = await makeCommitVc('e7')
  const p12 = await h12.vc.handleGitWriteCheck({ cwd: h12.dir, op: 'commit', message: '只提交一次' })
  const x12a = await h12.vc.handleGitCommit({ cwd: h12.dir, ticketId: p12.ticket.id, requestId: 'e7-1', message: '只提交一次', plan: null })
  const n12 = h12.writeSpawns().length
  const x12b = await h12.vc.handleGitCommit({ cwd: h12.dir, ticketId: p12.ticket.id, requestId: 'e7-1', message: '只提交一次', plan: null })
  check(x12a.ok === true && x12b.ok === true && x12b.headAfter === x12a.headAfter && h12.writeSpawns().length === n12, 'E13 同一 requestId 重放回同一份结果，不重复执行（提交不幂等，重放不能被当成第二次提交）')

  // E14–E16 失败分类：签名失败 / 没有可修订的提交 / 认不出的失败，都不许落 unknown-operation。
  const h13 = await makeCommitVc('e8')
  const p13 = await h13.vc.handleGitWriteCheck({ cwd: h13.dir, op: 'commit', message: '签名提交', plan: { mode: 'staged', sign: true } })
  h13.setOverride(function (argv) { return h13.after(argv)[0] === 'commit' ? { code: 1, stderr: 'gpg: signing failed: No secret key' } : null })
  const x13 = await h13.vc.handleGitCommit({ cwd: h13.dir, ticketId: p13.ticket.id, requestId: 'e8-1', message: '签名提交', plan: { mode: 'staged', sign: true } })
  check(x13.ok === false && x13.error.reason === 'signing-failed' && Object.keys(x13.error).sort().join(',') === 'hint,kind,message,reason', 'E14 2.6 签名失败分类为 signing-failed，信封固定 { ok, error:{ kind, reason, message, hint } }')
  const h14 = await makeCommitVc('e9')
  realGit(h14.dir, ['reset', '-q'])
  const p14 = await h14.vc.handleGitWriteCheck({ cwd: h14.dir, op: 'commit', message: '', plan: { mode: 'amend' } })
  h14.setOverride(function (argv) { return h14.after(argv)[0] === 'commit' ? { code: 128, stderr: 'fatal: You have nothing to amend.' } : null })
  const x14 = await h14.vc.handleGitCommit({ cwd: h14.dir, ticketId: p14.ticket.id, requestId: 'e9-1', message: '', plan: { mode: 'amend' } })
  check(x14.ok === false && x14.error.reason === 'nothing-to-amend', 'E15 2.3 执行时才发现没有可修订的提交：分类为 nothing-to-amend（不落 unknown）')
  const h15 = await makeCommitVc('e10')
  const p15 = await h15.vc.handleGitWriteCheck({ cwd: h15.dir, op: 'commit', message: '普通提交' })
  h15.setOverride(function (argv) { return h15.after(argv)[0] === 'commit' ? { code: 1, stderr: 'some weird failure from git' } : null })
  const x15 = await h15.vc.handleGitCommit({ cwd: h15.dir, ticketId: p15.ticket.id, requestId: 'e10-1', message: '普通提交', plan: null })
  check(x15.ok === false && x15.error.reason === 'unknown-write-failure', 'E16 认不出的失败如实落 unknown-write-failure（不猜原因、不假装成功）')

  // E17 源码断言：写层不自己起进程（只走注入的安全执行层）。
  check(!/child_process|spawnSync|execSync/.test(sourceText('src/host/versionControlWrite.ts')), 'E17 源码断言：写层不自己起进程，提交只经安全执行层那一个出口')
}

// ---------- F 组：客户端提交面板（多行输入 / 签名分开 / 模板 / 确认卡 / 结果贴触发点） ----------
// 做法与 A 组同一套：把 commit-plan 与 vcCommitPage 两份真源原文拼成闭包求值，再用 react-dom/server
// 渲成静态 HTML 读外部行为。反证（F11 起）把真源文本改坏，同一套判据必须判红。
const PAGE_SOURCE = 'src/client/views/versionControl/vcCommitPage.ts'
const PAGE_EXPORTS = ['vcCommitPanelOf', 'vcCommitPageNode', 'vcCommitConfirmNode', 'commitBlockKeyOf']
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup

/** 界面词条桩：把键与占位符参数都摊在文本里，断言才能看到「将写入的原文」这类内容。 */
const tStub = function (key, params) {
  const extra = (params && typeof params === 'object') ? Object.keys(params).map(function (k) { return k + '=' + String(params[k]) }).join(',') : ''
  return extra ? String(key) + ' ' + extra : String(key)
}

/** 把两份真源原文（可先按 patch 改坏）求值成页面模块：反证装置就靠 patch 这个入口。 */
function evalPage(patch) {
  let src = stripExports(sourceText(PLAN_SOURCE)) + '\n' + stripExports(sourceText(PAGE_SOURCE))
  if (patch) src = patch(src)
  src = toEvalJs(src)
  const body = src + '\nreturn { ' + PAGE_EXPORTS.join(', ') + ', commitPlanOf, commitTrailerOf }\n'
  return compileFn(['unused'], body)(null)
}

const PAGE_FORM = {
  identity: { name: '张三', email: 'z@example.com' },
  signing: { key: 'ABC123', format: 'ssh', gpgsign: true },
  template: { configured: true, path: '.gitmessage', text: '模板第一行\n- 模板第二行', problem: '', truncated: false },
  trailer: 'Signed-off-by: 张三 <z@example.com>',
  amend: { available: true, short: 'abc1234', subject: '上一条提交', message: '原说明' },
}
const PAGE_TARGETS = [{ oid: 'abc1234', short: 'abc1234', subject: '上一条提交' }]

function pageUi(over) {
  const commit = Object.assign({
    plan: { mode: 'staged', target: '', skipHooks: false, sign: false, signoff: false },
    message: '标题\n\n正文第一段', state: 'idle', form: PAGE_FORM,
    decision: null, result: null, confirm: null, formProblem: '',
  }, over || {})
  return { commit: commit }
}

function renderPanel(ui, module) {
  const M = module || PAGE
  return renderToStaticMarkup(M.vcCommitPageNode(React.createElement, tStub, { ui: ui, targets: PAGE_TARGETS }))
}

const countOf = function (html, token) { return html.split(token).length - 1 }

/** F2 的判据本体：说明输入必须是多行 textarea（反证会把 textarea 改回单行 input）。 */
const multiLineOkUi = function (html) {
  return /<textarea[^>]*data-vc-commit-msg="1"/.test(html) && !/<input[^>]*data-vc-commit-msg="1"/.test(html)
}
/** F3 的判据本体：签名提交与追加签名行各占一枚 2.6 勾选框（反证会把其中一枚挂到 2.5）。 */
const signSplitOk = function (html) {
  return countOf(html, 'data-cap-control="2.6"') === 2 && countOf(html, 'data-cap-control="2.5"') === 1 &&
    html.indexOf('data-vc-commit-opt="sign"') >= 0 && html.indexOf('data-vc-commit-opt="signoff"') >= 0
}
/** F5 的判据本体：确认卡固定四段（反证会删掉可逆性与恢复路径那一段）。 */
const confirmSegsOk = function (html) {
  return ['what', 'wont', 'reversible', 'verb'].every(function (seg) { return html.indexOf('data-vc-commit-seg="' + seg + '"') >= 0 })
}

const PAGE = evalPage(null)

function pageGroup() {
  const html = renderPanel(pageUi())
  check(html.indexOf('data-vc-commit-panel="1"') >= 0 && html.indexOf('data-vc-page="changes"') >= 0, 'F1 提交面板挂在改动页上：面板根节点带 data-vc-commit-panel 与 data-vc-page=changes')
  check(multiLineOkUi(html), 'F2 2.7 提交说明是面板内多行输入框（textarea，rows=6），不是单行输入框，也没有把用户推给外部编辑器')
  check(html.indexOf('正文第一段') >= 0, 'F2b 多行说明的换行内容原样出现在 textarea 的值里（长文与换行不被压成一行）')
  check(signSplitOk(html), 'F3 2.6 签名提交（sign）与追加签名行（signoff）是两枚独立勾选框，各自 data-cap-control=2.6；2.5 跳过钩子单独一枚（三件事不合并）')
  check(html.indexOf('data-vc-commit-template') >= 0 && html.indexOf('data-cap-control="2.8"') >= 0 && html.indexOf('模板第一行') >= 0, 'F4 2.8 套用提交说明模板：按钮与模板原文都在面板内可见（读回 commit.template 后照原文套用）')
  check(html.indexOf('data-vc-commit-trailer') >= 0 && html.indexOf('Signed-off-by: 张三') >= 0, 'F4b 2.6 面板内显示将写入的尾部签名行原文（追加签名行写什么，确认之前就能看见）')
  const counts = {}
  ;['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8'].forEach(function (cap) { counts[cap] = countOf(html, 'data-cap-control="' + cap + '"') })
  check(counts['2.1'] === 1 && counts['2.2'] === 1 && counts['2.3'] === 1 && counts['2.4'] === 2 && counts['2.5'] === 1 && counts['2.6'] === 2 && counts['2.7'] === 1 && counts['2.8'] === 1, 'F5 八条能力各自恰好一个主入口（2.4 的 fixup 与 squash 共用一条能力、两枚形态按钮）：共 10 个 data-cap-control')

  const confirmHtml = renderPanel(pageUi({ confirm: {} }))
  check(confirmSegsOk(confirmHtml) && confirmHtml.indexOf('data-focus-default="cancel"') >= 0 && confirmHtml.indexOf('data-vc-commit-confirm="1"') >= 0, 'F6 危险动作的确认卡贴面板内（不是居中模态）：四段「会动什么/不会动什么/可逆性与恢复路径/动词写后果」齐全，默认焦点在取消')
  check(confirmHtml.indexOf('data-vc-commit-confirm-trailer') >= 0 && confirmHtml.indexOf('data-vc-commit-confirm-msg') >= 0, 'F6b 确认卡显示将写入的签名行与提交说明原文（提交前能核对到底写什么）')

  const okHtml = renderPanel(pageUi({ result: { state: 'ok', ms: 12, cmd: 'commit' } }))
  const okIdx = okHtml.indexOf('data-vc-commit-result="ok"')
  check(okIdx > okHtml.indexOf('data-vc-commit-submit') && okIdx < okHtml.lastIndexOf('</section>'), 'F7 成功回执贴在触发点：结果节点在提交按钮之后、仍在本面板 section 之内（不是全局横幅）')

  const failHtml = renderPanel(pageUi({ result: { state: 'fail', reason: 'signing-failed', message: 'gpg: signing failed', hint: '检查签名配置', ms: 3 } }))
  check(failHtml.indexOf('data-vc-commit-result="fail"') >= 0 && failHtml.indexOf('role="alert"') >= 0 && failHtml.indexOf('vc.block.signingFailed') >= 0 && failHtml.indexOf('gpg: signing failed') >= 0, 'F8 失败回执也贴触发点：分类词条（signing-failed 那一族）与 git 原话一起显示，读屏用 role=alert')

  const fixHtml = renderPanel(pageUi({ plan: { mode: 'fixup', target: '', skipHooks: false, sign: false, signoff: false } }))
  check(fixHtml.indexOf('data-vc-commit-target="1"') >= 0 && fixHtml.indexOf('data-vc-commit-target-tip') >= 0 && fixHtml.indexOf('vc.block.needCommitTarget') >= 0, 'F9 2.4 fixup / squash 没有可吸收目标时：目标选择行给出 needCommitTarget 常驻原因，提交按钮一并禁用')

  const noHeadHtml = renderPanel(pageUi({ form: Object.assign({}, PAGE_FORM, { amend: { available: false, short: '', subject: '', message: '' } }), plan: { mode: 'amend', target: '', skipHooks: false, sign: false, signoff: false } }))
  check(noHeadHtml.indexOf('data-cap-why="vc.block.nothingToAmend"') >= 0 && /<button[^>]*data-vc-commit-mode="amend"[^>]*disabled/.test(noHeadHtml), 'F10 2.3 分支还没有任何提交时：修订按钮禁用，并把 nothingToAmend 的常驻原因挂在按钮上')

  // F11–F13 反证：把真源文本改坏，上面同一套判据必须判红（证明这扇门禁会咬，不是永远绿）。
  const broken1 = evalPage(function (s) { return s.replace("h('textarea'", "h('input'") })
  check(multiLineOkUi(renderPanel(pageUi(), broken1)) === false, 'F11 反证：把多行 textarea 改回单行 input，F2 同一套判据判红（多行输入不是摆设）')
  const broken2 = evalPage(function (s) { return s.replace("{ key: 'signoff', cap: '2.6',", "{ key: 'signoff', cap: '2.5',") })
  check(signSplitOk(renderPanel(pageUi(), broken2)) === false, 'F12 反证：把追加签名行的能力标号挂到 2.5 上，F3 同一套判据判红（签名与追加签名行不许混成一条）')
  const broken3 = evalPage(function (s) { return s.replace(/\s*\{ seg: 'reversible'[^\n]*\n/, '\n') })
  check(confirmSegsOk(renderPanel(pageUi({ confirm: {} }), broken3)) === false, 'F13 反证：删掉确认卡的可逆性与恢复路径那一段，F6 同一套判据判红（四段少一段就挡住）')
}

// C 组起是异步的（要真的拨宿主电话、等回包）：汇总与 GATE-RESULT 等它们跑完再打。
main().catch(function (e) { console.error('门禁执行异常：' + String((e && e.stack) || e)); process.exit(1) })

async function main() {
  await formGroup()
  await commitGroup()
  pageGroup()
  console.log('')
  console.log('汇总：' + total + ' 条断言，' + failed + ' 条失败')
  printGateResult(GATE, total, failed)
  process.exit(failed > 0 ? 1 : 0)
}
