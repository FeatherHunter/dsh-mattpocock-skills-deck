// tests/verify-1607-gh-unc-cwd.ts —— 门禁：UNC 工作区里 gh 的当前目录要原样交给进程，不许绕道 shell（#1607）
//
// 现场：工作区设成 WSL2 的 UNC 路径（\\wsl.localhost\<发行版>\home\<用户>\<仓库>）之后，仓库识别失败，
// gh repo view 报 not a git repository；票面记录的现场里，gh 的当前目录还退回了 C:\Windows。
// 票面最初的猜测是「cmd 不支持 UNC 当前目录，所以 Windows 退回系统目录」。2026-10-28 维护者在真实环境做了对照：
// 直接 spawn gh（shell:false）并把当前目录设为 UNC 路径时，gh repo view 正常返回 owner/name（退出码 0）；
// 只有经 cmd.exe 启动（shell:true，或命令解析到 .cmd 垫片）才会打印
//   CMD.EXE was started with ... UNC paths are not supported.  Defaulting to Windows directory.
// 以及 not a git repository。同一天在本机用真实 UNC 共享复跑同一组对照，结论一致。
// 也就是说：坏了的是「经 cmd.exe 启动」那条路，不是 UNC 当前目录本身。
//
// 为什么要有这一页：插件这一侧起 gh 的整条链路（房间 execGh → 宿主 detectionExec → 平台 subprocess）今天
// 全部走 argv 数组、不接 shell，UNC 当前目录原样交给进程 —— 这个事实没有任何门禁钉着。谁哪天顺手加一个
// shell:true，或者把当前目录「归一化」一下（例如 toLowerCase），现场就会以「只有特定安装方式才复现」的样子回来。
// 本页钉三件事（对应 #1607 验收的三条）：
//   一、静态：gh / git 的每个起进程点都不经过 shell、cmd、powershell；启动方式是 argv 数组；当前目录原样传下去。
//   二、行为：用生产 ghPreflight，工作目录给一个大小写混合的 UNC 路径，断言三步 gh 命令收到的当前目录一字不差。
//   三、回归：同一组断言在 D:\ 盘符路径上逐字节不变，且两条路径的命令序列完全一致。
//
// 为什么不需要 WSL：UNC 路径在这里只是交给假执行器的一串字符串，不要求真的存在或挂载。
// 真机复验（真的在 WSL2 UNC 工作区里跑 gh repo view）仍要人工做一次，复现条件写在 #1607 票面。
//
// 查不出的写法：源码扫描只认「直接在起进程处套 shell / cmd」这种写法。如果先把命令拼成一行字符串、再交给
// 自己封装的执行函数，或者 shell 来自用户装的 .cmd 垫片（那是安装方式的事，不在插件源码里），这一页看不见。
// 为了不让它假绿，第一段先自测扫描器：喂几段故意犯规的样例必须全部报警，喂一段干净的 argv 样例必须不报警。
//
// 门禁归属: src/tracker/rooms/github/read/preflight.ts
// 门禁归属: src/tracker/rooms/github/transport/client.ts
// 门禁归属: src/refresh/rooms/host/gh-execution.ts
// 门禁归属: src/host/platformChannel.ts
// 门禁归属: src/host/versionControl.ts
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1607-gh-unc-cwd.ts
import fs from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import { ghPreflight } from '../src/tracker/rooms/github/preflight.ts'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'
import { resetGhLaneForTest } from '../src/refresh/rooms/host/outbound-admission.ts'

const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')

let total = 0
let failed = 0
/** 逐条断言：打印 PASS/FAIL，失败累计，收尾一起判红。 */
const check = (ok: unknown, msg: string, detail?: unknown): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || detail === undefined ? '' : ' — ' + String(detail)))
  if (!ok) failed += 1
}

// ---------------------------------------------------------------------------
// 一、扫描器：源码里有没有「把命令交给 shell / cmd 解释」的写法
// ---------------------------------------------------------------------------
// 只认这几条会真正改变「命令怎么被解释」的写法：给子进程开 shell 选项，或直接起 cmd / powershell / bash。
// 单看 /c 不够（它也可能只是某个参数），但起进程的窗口里出现 '/c' 基本只有 cmd 这一种来源，一并拦下。
const SHELL_LAUNCH_PATTERNS: ReadonlyArray<{ why: string; re: RegExp }> = [
  { why: '给子进程开了 shell 选项', re: /\bshell\s*:\s*(?:true|'[^']*'|"[^"]*")/ },
  { why: '进程是 cmd.exe', re: /\bcmd\.exe\b/i },
  { why: '进程是 cmd', re: /['"]cmd['"]/ },
  { why: '参数里有 /c（cmd 执行一条命令的开关）', re: /['"]\/c['"]/ },
  { why: '进程是 powershell', re: /\bpowershell(?:\.exe)?\b/i },
  { why: '进程是 bash', re: /\bbash\b/i },
]

/** 在一段源码里找「命令会经 shell / cmd 解释」的写法；回命中的原因，空数组表示干净。 */
function findShellLaunch(src: string): string[] {
  const text = String(src || '')
  const hits: string[] = []
  for (const p of SHELL_LAUNCH_PATTERNS) if (p.re.test(text)) hits.push(p.why)
  return hits
}

/** 找到源码里每个起进程的调用点，取它和后面十行当窗口：只看真正起进程的那一小段。 */
function spawnWindows(src: string): string[] {
  const lines = String(src || '').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (/\bspawn\s*\(/.test(lines[i])) out.push(lines.slice(i, i + 10).join('\n'))
  }
  return out
}

console.log('== 一、扫描器自测：故意犯规的样例必须报警，干净的 argv 样例必须不报警 ==')
const MUST_FLAG = [
  ['shell:true', "subprocess.spawn({ argv: [exe].concat(args), cwd: cwd, shell: true })"],
  ['cmd.exe /c', "spawn('cmd.exe', ['/c', 'gh repo view --json nameWithOwner'], { cwd: cwd })"],
  ['cmd /c', "spawn('cmd', ['/c', 'gh repo view'], { cwd: cwd })"],
  ['powershell -c', "spawn('powershell.exe', ['-c', 'gh repo view'], { cwd: cwd })"],
  ['bash -c', "spawn('bash', ['-c', 'gh repo view'], { cwd: cwd })"],
] as const
for (const [label, snippet] of MUST_FLAG) {
  check(findShellLaunch(snippet).length > 0, '一、扫描器能认出犯规写法：' + label, findShellLaunch(snippet).join('、'))
}
const MUST_NOT_FLAG = [
  ['argv 数组直接起 gh', "subprocess.spawn({ argv: [exe].concat(args), cwd: cwd, stdio: { stdin: 'ignore' }, graceMs: 8000 })"],
  ['执行器按 argv 两个参数起 gh', "exec('gh', args, { cwd, timeout: 15000, signal: laneSignal })"],
] as const
for (const [label, snippet] of MUST_NOT_FLAG) {
  check(findShellLaunch(snippet).length === 0, '一、扫描器不冤枉干净写法：' + label, findShellLaunch(snippet).join('、'))
}

// 起 gh / git 进程的四处源码（四处都必须走 argv 数组，且不接 shell）。
const SOURCE_FILES: Record<string, string> = {
  ghExecution: 'src/refresh/rooms/host/gh-execution.ts',
  platformChannel: 'src/host/platformChannel.ts',
  versionControl: 'src/host/versionControl.ts',
  ghClient: 'src/tracker/rooms/github/transport/client.ts',
}
const sources: Record<string, string> = {}
for (const key of Object.keys(SOURCE_FILES)) {
  try {
    sources[key] = fs.readFileSync(nodePath.join(ROOT, SOURCE_FILES[key]), 'utf8')
    check(true, '一、读到了 ' + SOURCE_FILES[key])
  } catch (e) {
    check(false, '一、读到了 ' + SOURCE_FILES[key], String((e && (e as Error).message) || e).slice(0, 200))
  }
}

console.log('== 一、四个起进程点：都不经 shell / cmd / powershell，当前目录原样传下去 ==')
for (const key of Object.keys(sources)) {
  const windows = spawnWindows(sources[key])
  const hits: string[] = []
  for (const w of windows) hits.push(...findShellLaunch(w))
  check(hits.length === 0, '一、' + SOURCE_FILES[key] + ' 的起进程点没有 shell / cmd / powershell', hits.join('、') || windows.length + ' 个窗口都干净')
}
const ghExecWindows = spawnWindows(sources.ghExecution || '')
check(ghExecWindows.some((w) => /argv\s*:/.test(w)), '一、gh-execution 起 gh 用 argv 数组')
check(ghExecWindows.some((w) => /cwd\s*:\s*cwd\b/.test(w)), '一、gh-execution 把 runGh 收到的当前目录原样传下去（cwd: cwd）')
const platformWindows = spawnWindows(sources.platformChannel || '')
check(platformWindows.some((w) => /argv\s*:/.test(w)), '一、platformChannel 起进程用 argv 数组')
check(platformWindows.some((w) => /cwd\s*:\s*c\b/.test(w)), '一、platformChannel 把调用方给的当前目录原样传下去（cwd: c）')
const vcWindows = spawnWindows(sources.versionControl || '')
check(vcWindows.some((w) => /argv\s*:/.test(w)), '一、versionControl 起 git 用 argv 数组')
check(vcWindows.some((w) => /cwd\s*:\s*dir\b/.test(w)), '一、versionControl 把 runGit 收到的目录原样传下去（cwd: dir）')
check(/exec\(\s*'gh'\s*,\s*args\s*,\s*\{\s*cwd\b/.test(sources.ghClient || ''), "一、gh 客户端把当前目录原样交给执行器（exec('gh', args, { cwd, … })）")
check(!/\bshell\s*:/.test(sources.ghClient || ''), '一、gh 客户端没有给执行器加 shell 选项')

// 不许把进程当前目录做大小写折叠或路径归一化：同一行里既出现 cwd 又出现 toLowerCase / path.normalize 就判红。
// （工作区身份键那一层按约定折叠大小写，见 #1498；那不是交给进程的当前目录，两者不要混。）
const normalizeLines: string[] = []
for (const key of Object.keys(sources)) {
  const lines = String(sources[key] || '').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (/\bcwd\b/.test(lines[i]) && /toLowerCase|path\.normalize\(/.test(lines[i])) normalizeLines.push(SOURCE_FILES[key] + ':' + (i + 1))
  }
}
check(normalizeLines.length === 0, '一、交给进程的当前目录没有被 toLowerCase / path.normalize 改造', normalizeLines.join('、') || '0 处')

// ---------------------------------------------------------------------------
// 二～五、行为：用生产 ghPreflight 跑一趟，看三步 gh 命令收到的当前目录
// ---------------------------------------------------------------------------
/** 假执行器的回话：与真 gh 一样交 stdout / stderr / 退出码。 */
type ExecAnswer = { stdout?: string; stderr?: string; code: number }
/** 记下来的一笔 gh 调用：命令、参数、以及执行器收到的当前目录（opts.cwd）。 */
type GhCall = { cmd: string; args: string[]; cwd: string | undefined }

/** 带大小写混合的 UNC 工作区：故意不用全小写，用来发现「悄悄把路径折成小写」的改动。 */
const UNC_CWD = '\\\\wsl.localhost\\Ubuntu-26.04\\home\\Acgmn\\GitHub\\WanGP'
/** 盘符工作区：验收第二条要求它的行为逐字节不变。 */
const DRIVE_CWD = 'D:\\Repo\\MixedCase-WanGP'
/** 票面现场里 cmd.exe 因 UNC 当前目录退回系统目录、随后 gh 失败的那段原文（照抄，用来跑失败分支）。 */
const CMD_FALLOUT = "'" + UNC_CWD + "'\r\n"
  + 'CMD.EXE was started with the above path as the current directory.\r\n'
  + 'UNC paths are not supported.  Defaulting to Windows directory.\r\n'
  + 'failed to run git: fatal: not a git repository (or any of the parent directories): .git\n'

/** 造一个假世界：执行器按参数回样本并记下每一笔（含 opts.cwd），出站控制面用生产件。 */
function makeWorld(answer: (args: string[]) => ExecAnswer) {
  resetGhLaneForTest()
  const calls: GhCall[] = []
  const outbound = createOutboundControl()
  const exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    calls.push({ cmd: String(cmd), args: Array.isArray(args) ? args.slice() : [], cwd: opts && typeof opts.cwd === 'string' ? opts.cwd : undefined })
    const a = answer(Array.isArray(args) ? args : [])
    return { stdout: a.stdout || '', stderr: a.stderr || '', code: a.code }
  }
  const ctx = {
    cwd: DRIVE_CWD,
    platform: { os: 'win32', resolveExecutable: async (name: string) => (name === 'gh' ? 'D:/fake/gh.exe' : null) },
    exec,
    outbound,
    logEvent: (_level: string, _event: string, _fields: Record<string, unknown>) => {},
    isEnabled: () => true,
  }
  return { calls, ctx }
}

/** 三关全过的回话：登录态正常、gh repo view 认出仓库、仓库接口可达。 */
function okAnswers(args: string[]): ExecAnswer {
  if (args[0] === 'auth' && args[1] === 'status') return { code: 0, stdout: 'github.com\n  Logged in to github.com account FeatherHunter\n' }
  if (args[0] === 'repo' && args[1] === 'view') return { code: 0, stdout: 'FeatherHunter/dsh-mattpocock-skills-deck\n' }
  if (args[0] === 'api') return { code: 0, stdout: '{"id":1}\n' }
  return { code: 1, stderr: 'unexpected gh command: ' + args.join(' ') }
}

/** 跑一趟生产 ghPreflight：工作区目录给 handle，上下文目录给 ctx（默认为盘符路径，模拟「两者都有」）。 */
async function runPreflight(handleCwd: string, answer: (args: string[]) => ExecAnswer) {
  const world = makeWorld(answer)
  const reply = await ghPreflight({ cwd: handleCwd, refId: '' } as never, world.ctx as never)
  return { reply, calls: world.calls }
}

const REPO_VIEW_ARGS = 'repo view --json nameWithOwner -q .nameWithOwner'

console.log('== 二、UNC 工作区：三步命令的当前目录一字不差（票面验收第一条） ==')
{
  const unc = await runPreflight(UNC_CWD, okAnswers)
  const seq = unc.calls.map((c) => c.args.join(' '))
  check(unc.reply.ok === true, '二、UNC 工作区三关全过（gh repo view 认出了仓库）', JSON.stringify(unc.reply))
  check(seq.length === 3, '二、UNC 工作区只发三步：登录态、仓库身份、仓库接口', seq.join(' | '))
  check(seq[0] === 'auth status', '二、第一步仍是 gh auth status', seq[0])
  check(seq[1] === REPO_VIEW_ARGS, '二、第二步仍是 gh repo view（与票面现象里的命令一字不差）', seq[1])
  check(seq[2] === 'api repos/FeatherHunter/dsh-mattpocock-skills-deck', '二、第三步用认出来的 owner/name 问仓库接口', seq[2])
  check(unc.calls.every((c) => c.cwd === UNC_CWD), '二、三步收到的当前目录与工作区一字不差（大小写也没变）', JSON.stringify(unc.calls.map((c) => c.cwd)))
  check(unc.calls.every((c) => c.cmd === 'gh'), '二、起的一直是 gh 本身，没有套一层 shell / cmd', JSON.stringify(unc.calls.map((c) => c.cmd)))
  check(!unc.calls.some((c) => /^[A-Za-z]:\\Windows$/i.test(String(c.cwd))), '二、没有任何一笔命令的当前目录变成 C:\\Windows', JSON.stringify(unc.calls.map((c) => c.cwd)))
}

console.log('== 三、盘符工作区：同一组断言逐字节不变（票面验收第二条） ==')
{
  const drive = await runPreflight(DRIVE_CWD, okAnswers)
  const seq = drive.calls.map((c) => c.args.join(' '))
  const uncSeq = ['auth status', REPO_VIEW_ARGS, 'api repos/FeatherHunter/dsh-mattpocock-skills-deck']
  check(drive.reply.ok === true, '三、盘符工作区三关全过', JSON.stringify(drive.reply))
  check(seq.join('|') === uncSeq.join('|'), '三、盘符工作区的命令序列与 UNC 工作区完全一致（没有为 UNC 走另一套逻辑）', seq.join(' | '))
  check(drive.calls.every((c) => c.cwd === DRIVE_CWD), '三、盘符工作区的当前目录原样传下去', JSON.stringify(drive.calls.map((c) => c.cwd)))
}

console.log('== 四、UNC 工作区里 gh repo view 真的失败 → 如实判「认不出仓库」，不换当前目录 ==')
{
  const failed = await runPreflight(UNC_CWD, (args: string[]) => {
    if (args[0] === 'repo' && args[1] === 'view') return { code: 1, stderr: CMD_FALLOUT }
    return okAnswers(args)
  })
  const error = (failed.reply.ok === false ? failed.reply.error : null) as { kind?: string; message?: string } | null
  check(!!error && error.kind === 'not-found', '四、失败结论是「仓库不存在 / 认不出」，不是网络或认证档', JSON.stringify(failed.reply))
  check(!!error && error.message === 'repo not found: cannot resolve owner/name (no refId and gh repo view failed)', '四、失败话术与从前一字不差', error && error.message)
  check(failed.calls.length === 2, '四、失败时不再去问仓库接口（不会拿空仓库名发请求）', failed.calls.map((c) => c.args.join(' ')).join(' | '))
  check(failed.calls.every((c) => c.cwd === UNC_CWD), '四、失败这一支也不换当前目录（Original UNC 原样交出去）', JSON.stringify(failed.calls.map((c) => c.cwd)))
  check(!failed.calls.some((c) => /^[A-Za-z]:\\Windows$/i.test(String(c.cwd))), '四、没有任何一笔命令的当前目录变成 C:\\Windows', JSON.stringify(failed.calls.map((c) => c.cwd)))
}

console.log('== 五、工作区目录优先：handle.cwd 胜过上下文目录，且原样传下去 ==')
{
  const world = makeWorld(okAnswers)
  const reply = await ghPreflight({ cwd: UNC_CWD, refId: '' } as never, world.ctx as never)
  check(reply.ok === true, '五、三关全过', JSON.stringify(reply))
  check(world.calls.length === 3 && world.calls.every((c) => c.cwd === UNC_CWD), '五、上下文里另有一个盘符目录时，仍用工作区给的那个 UNC 路径且不改造', JSON.stringify(world.calls.map((c) => c.cwd)))
}

printGateResult('verify-1607-gh-unc-cwd', total, failed)
if (failed) {
  console.log('\n1607 GH UNC CWD TESTS FAILED（共 ' + total + ' 条断言，' + failed + ' 条失败）')
  process.exit(1)
}
console.log('\n1607 GH UNC CWD TESTS PASSED（共 ' + total + ' 条断言）')
