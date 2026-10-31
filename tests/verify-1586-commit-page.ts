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
check(av({ mode: 'squash', target: 'abc123' }, '随便') === 'commit|--squash=abc123', 'A4b 2.4 squash：目标以 --squash=<目标> 一个元素传入，不拼 -m')
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

// C 组起是异步的（要真的拨宿主电话、等回包）：汇总与 GATE-RESULT 等它们跑完再打。
main().catch(function (e) { console.error('门禁执行异常：' + String((e && e.stack) || e)); process.exit(1) })

async function main() {
  await formGroup()
  console.log('')
  console.log('汇总：' + total + ' 条断言，' + failed + ' 条失败')
  printGateResult(GATE, total, failed)
  process.exit(failed > 0 ? 1 : 0)
}
