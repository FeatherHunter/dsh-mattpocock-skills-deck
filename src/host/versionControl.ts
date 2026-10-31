/**
 * src/host/versionControl.ts —— 版本管理页签的宿主取数层（#817）。
 *
 * 来源与零变化：本文件由同目录 versionControl.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./versionControl.js`，
 * 由 scripts/ts-hook.mts 在加载时改指到同名 .ts。
 *
 * 这一层把真实 git 进程跑起来、把输出交给已落地的 TypeScript 核心解析与组装、经三条电话
 * （wf.gitStatus / wf.gitDiff / wf.gitLog）把结果回给界面。核心是纯函数，不许碰进程与磁盘；
 * 取数与落盘按 docs/adr/20260913-builtin-ts-shape.md 归宿主，本文件就是「取数」的全部落点。
 *
 * 起进程的纪律（票面 #817 与 ADR 20261002-version-control-readonly-no-network.md）：
 *   1. 一律走 DSH 的 subprocess 服务，不用 Node 的 child_process，不经 shell，argv 数组直传；
 *   2. 第 0 步先问「这里是不是仓库」，问出仓库根之后每条命令都用 -C <仓库根> 钉死；
 *   3. 会输出路径的命令加 -z；标准输入 ignore；标准输出设字节上限；超时走 DSH 的 timer 服务；
 *   4. 退出码非零原样交给调用方判，本文件不抛；起进程之前先向闸报一笔（gate.noteOutbound）；
 *   5. 第一版不发起网络动作（不 fetch / 不 pull / 不 push）：领先落后只读本地记录，依据时间取远端
 *      跟踪引用 reflog 的末条时间戳（ADR 第 3 条）；刚克隆、还没 fetch 过的仓库没有 reflog，只有这个上游
 *      自己的松散引用文件在时才退回它的落盘时间，否则如实回 null（拿全仓库共用的 packed-refs 的 mtime 凑
 *      一个时间是不行的，#819 复审再修）。日志：每条命令一行常驻 git.exec（成功与非零退出
 *      各一行），超时与起进程失败一行告警级 git.exec.fail（直通刷盘），目录只记散列，输出不进日志。
 *
 * 为什么这样标注（聚合扇出文件的类型约定）：
 * 1. 相对导入说明符保留 `.js` 后缀（`./stallWatch.js`、`./versionControlBasis.js` 等一律不改成 `.ts`），
 *    改了会绕过钩子的同名解析约定，所以不能动；本文件只加类型，不断任何行为。
 * 2. 注入进来的能力（subprocess、timer、fs、platform、gate、logCtx）形状由接线处决定，
 *    本文件只读其中用到的少数成员，所以解构出来的每一项都按 `any` 用，
 *    类型不替代运行时的能力检测。
 * 3. 共享核心的解析与组装函数由共享域拥有形状，本文件只负责按约定调用，所以全部按 `any` 收。
 * 4. `catch (e)` 里读 `e.message` 的地方加了 `as any` 断言：类型层面 `catch` 的变量是 `unknown`，
 *    断言转译时整体剥离，运行时与原来一字不差。
 * 5. 没有新增任何 import 边：只给已有引用加类型，不引入新模块依赖；动态加载的那几条叶子
 *    （basis、markers、diff、write）仍走原来的 `./x.js` 说明符。
 */
import { fixedPrefix, stepZeroArgs, commandFor, autocrlfArgs, RUNNING_MARKER_PATHS, FAILING_EDITOR, subcommandOf } from '../shared/version-control/src/commands.js'
import { parseVersion, tierFor } from '../shared/version-control/src/capabilities.js'
import { parseStatus } from '../shared/version-control/src/parse-status.js'
import { parseWorktrees } from '../shared/version-control/src/parse-worktrees.js'
import { parseRefs } from '../shared/version-control/src/parse-refs.js'
import { parseLog } from '../shared/version-control/src/parse-log.js'
import { parseDiffFiles } from '../shared/version-control/src/parse-diff-files.js'
import { assemble, classifyStepZero } from '../shared/version-control/src/state.js'
import { makeStallWatch } from './stallWatch.js' // #847：字节增长看门狗（自包含叶子，照 #500/#821 先例）
import { withGhLane } from '../refresh/rooms/host/outbound-admission.js'
import { failPhone, firstLine, failureFromExec } from '../shared/version-control/exec-envelope.js'
// 单条 git 命令的默认超时住中央 YAML（config/timeouts.yaml 的 vcRunTimeoutMs 键）：这里直接引用中央常量，调时间改 YAML。
// 它管的是「调用方没给 TIMEOUT_MS 时，一条 git 命令最多跑多久」——接线给了 TIMEOUT_MS 就以接线那个为准。
// 路径走域构建产物写法（与 src/refresh/rooms/host/chain-coalescing.ts 引 values.js 同例），
// 值由 tests/verify-time-config.ts 看守一致。
import { VC_RUN_TIMEOUT_MS as RUN_TIMEOUT_MS, PROC_GRACE_MS } from '../shared/time-config/src/values.js'
// #1741：fast-import 那个只读文件流窄例外要宿主自己打开并核对普通文件、大小与摘要；
// 这条边只服务 stdinFile，读命令与其余写命令仍走注入的 subprocess 服务。
// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这些内建模块必然存在。
// @ts-expect-error
import { lstat as fsLstat, readFile as fsReadFile } from 'node:fs/promises'
// @ts-expect-error
import { isAbsolute as pathIsAbsolute } from 'node:path'
// @ts-expect-error
import { createHash as cryptoCreateHash } from 'node:crypto'

const VIA: string = 'version-control'          // 日志的 via：这一族 git 命令都由版本管理页签发起
const GIT_NAME: string = 'git'                 // 日志的 argv0：只记程序名，不记路径
// 本域 types 为空，Node 的 Buffer 声明随 @types/node 一起缺席；运行时一定是 Node，进程内必然存在。
// 按存在声明只为过编译器，不产生运行时代码。
declare const Buffer: { byteLength(s: string, encoding: string): number }
const STDOUT_LIMIT: number = 8 * 1024 * 1024   // 状态、工作树、分支、历史、文件清单的字节上限
const PATCH_LIMIT: number = 4 * 1024 * 1024    // 单个文件差异的字节上限
const STDERR_LIMIT: number = 256 * 1024        // 错误信息的上限（只用来拼失败说明）
const FIRST_SCREEN_LOG_COUNT: number = 50      // 首屏一次读多少条提交（核心的默认口径）
const LOG_BATCH_MAX: number = 200              // 历史按批取时一批最多多少条

/** stdinFile 只读文件流的命令白名单：整份规格里只有 fast-import 需要标准输入（规格第 8 节唯一例外）。 */
const STDIN_FILE_COMMAND: string = 'fast-import'

/** 路径守卫：只收绝对路径、不许含 NUL、不许出现 .. 段。返回空串表示通过，否则返回给人看的理由。
 *  为什么连 .. 也挡：票据把路径绑成了字符串，`repo/../outside` 与 `outside` 是同一份文件，
 *  只做「开头是不是绝对路径」的检查会让路径比较失去意义。 */
function stdinPathProblem(p: any): string {
  if (typeof p !== 'string' || !p) return '路径为空或不是字符串'
  if (p.indexOf('\u0000') >= 0) return '路径里含 NUL'
  if (!pathIsAbsolute(p)) return '不是绝对路径'
  const segments: string[] = p.split(/[\\/]+/)
  if (segments.indexOf('..') >= 0) return '路径里含 .. 段'
  return ''
}

/** 打开 fast-import 的只读输入文件并核对票据绑定的「普通文件、大小、摘要」三件事。
 *  任何一项不符都在起进程之前给明确失败（零进程）；读文件留到最后，读出来再按字节数复核一次，
 *  防「查 stat 之后文件被换掉」这种小窗口。 */
async function prepareStdinFile(spec: any): Promise<any> {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'bad-spec', message: 'stdinFile 必须给出 path、sizeBytes 与 sha256' }
  const problem: string = stdinPathProblem(spec.path)
  if (problem) return { ok: false, reason: 'bad-path', message: problem }
  const sizeBytes: any = spec.sizeBytes
  const sha256: string = (typeof spec.sha256 === 'string') ? spec.sha256.toLowerCase() : ''
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) return { ok: false, reason: 'bad-spec', message: 'sizeBytes 必须是非负整数' }
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, reason: 'bad-spec', message: 'sha256 必须是 64 位十六进制摘要' }
  let st: any
  try { st = await fsLstat(spec.path) } catch (e) {
    const code: string = (e && (e as any).code) ? String((e as any).code) : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'missing-file', message: 'stdinFile 指向的文件不存在' }
    return { ok: false, reason: 'unreadable', message: '读不了 stdinFile 的文件信息：' + String(((e as any) && (e as any).message) || e) }
  }
  // lstat：符号链接本身不是普通文件，不收（否则「路径绑定」可以绕过成任意目标）。
  if (!st || typeof st.isFile !== 'function' || !st.isFile()) return { ok: false, reason: 'not-regular-file', message: 'stdinFile 只收普通文件' }
  if (st.size !== sizeBytes) return { ok: false, reason: 'size-mismatch', message: '文件大小与票据绑定的不一致（实际 ' + st.size + '，票据 ' + sizeBytes + '）' }
  let bytes: any
  try { bytes = await fsReadFile(spec.path) } catch (e) { return { ok: false, reason: 'unreadable', message: '读不了 stdinFile 的文件内容：' + String(((e as any) && (e as any).message) || e) } }
  if (bytes.length !== sizeBytes) return { ok: false, reason: 'size-mismatch', message: '读出来的字节数与票据绑定的不一致（实际 ' + bytes.length + '，票据 ' + sizeBytes + '）' }
  const actual: string = cryptoCreateHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) return { ok: false, reason: 'digest-mismatch', message: '文件摘要与票据绑定的不一致（实际 ' + actual.slice(0, 16) + '…，票据 ' + sha256.slice(0, 16) + '…）' }
  return { ok: true, bytes: bytes }
}

/** 宿主注入的依赖：进程、计时、文件、平台与日志都在这里，本文件不自取任何环境。 */
export interface VersionControlDeps {
  subprocess: any
  timer: any
  fs: any
  getPlatform: any
  DEFAULT_CWD: any
  TIMEOUT_MS: any
  gate: any
  logCtx: any
  now?: any
}

/** 造这台机器上唯一的版本管理取数器；依赖全部由入口显式传入（本文件不引用别的宿主文件）。 */
export function createVersionControl(deps: any): any {
  const { subprocess, timer, fs, getPlatform, DEFAULT_CWD, TIMEOUT_MS, gate, logCtx }: any = deps
  const timeoutMs: any = (typeof TIMEOUT_MS === 'number' && TIMEOUT_MS > 0) ? TIMEOUT_MS : RUN_TIMEOUT_MS
  /** 路径短散列：日志里只认它，不记原始目录。 */
  function hash8(s: any): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  /** 目录散列：散列之前先把目录归一（反斜杠统一成正斜杠、去掉结尾的斜杠）。首屏头两条命令用的是
   *  调用方给的写法，后面几条用的是 git 自己回的正斜杠仓库根；不归一，同一个目录会算出两个 cwdHash
   *  （#819 复审发现），按它过滤日志就会把一次面板打开拆成两组。 */
  function dirHash(dir: any): string { try { return hash8(String(dir || '').replace(/\\/g, '/').replace(/\/+$/, '')) } catch (e) { return '00000000' } }
  /** 落一行日志；日志设施缺席时静默跳过，绝不影响已经要回给界面的结果。 */
  function fire(level: any, event: any, fields: any): void { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e) {} }
  /** 起进程之前把这一笔报给闸；闸没接上时照旧执行（门禁会因漏账判红，不在这里静默假装记过）。 */
  function reportOutbound(): void { try { if (gate && typeof gate.noteOutbound === 'function') gate.noteOutbound({ requests: 1, points: 0 }) } catch (e) {} }
  /** 从收集器里取文本与「有没有被字节上限截掉」的标记：DSH 收集器的真名是 lossy（越过保留的尾部时判真，留的是尾部 maxBytes）；finalize() 那条是给别家实现留的兼容路，两条都拿不到时按可能截断处理（核心口径）。 */
  function readCollector(collector: any): any {
    if (!collector) return { text: '', truncated: false }
    try {
      if (typeof collector.finalize === 'function') { const r: any = collector.finalize() || {}; return { text: String(r.text || ''), truncated: r.truncated === true } }
      if (typeof collector.readFrom === 'function') { const r: any = collector.readFrom(0) || {}; return { text: String(r.text || ''), truncated: r.lossy === true } }
    } catch (e) {}
    return { text: '', truncated: true }
  }
  /** 把一条命令拼成「程序 + 钉死目录 + 固定前缀 + 子命令」的形状。 */
  function pinned(exe: any, dir: any, args: any): any { return [exe, '-C', dir].concat(fixedPrefix(), args) }
  /** 把一次「钉死目录」的执行跑起来；返回核心 ports.ts 里那四种情形之一。 */
  function runPinned(exe: any, dir: any, args: any, opts?: any): Promise<any> { return runGit(exe, dir, pinned(exe, dir, args).slice(1), opts) }

  /** 跑一条 git 命令：成功与非零退出各落一行 git.exec，超时与起进程失败各落一行 git.exec.fail。opts.env 是给 #839 那一族「可能弹凭据提示」的命令传非交互环境用的（undefined 值是墓碑，从继承环境里删掉这一项）。 */
  async function runGit(exe: any, dir: any, args: any, opts: any): Promise<any> {
    const t0: number = Date.now()
    const limit: any = (opts && opts.stdoutLimit) ? opts.stdoutLimit : STDOUT_LIMIT
    const budget: any = (opts && opts.timeoutMs) ? opts.timeoutMs : timeoutMs
    // 命令名只从 argv 里按固定前缀规则找；找不到就给空串，不猜。argv 的个数单独记，原始参数不进日志。
    const cmd: string = subcommandOf(args)
    // 每一次 git 调用都注入 GIT_EDITOR=必失败命令（规格第 7 节）：读命令同样注入，
    // 是为了「谁能弹编辑器」这件事只依赖这一条出口，不靠每条命令自己记得传。
    // opts.env 里 undefined 值是墓碑（从继承环境删掉这一项），这里先浅拷贝再覆盖 GIT_EDITOR，墓碑语义保留。
    const childEnv: any = Object.assign({}, (opts && opts.env) ? opts.env : {}, { GIT_EDITOR: FAILING_EDITOR })
    // stdin 的唯一例外：stdinFile 只许配 fast-import，且 fast-import 必须配（不能空着管道跑）。
    // 这两条与文件校验都在起进程之前完成，失败时一个进程都不起。
    const wantStdin: boolean = !!(opts && opts.stdinFile)
    if (!wantStdin && cmd === STDIN_FILE_COMMAND) return { kind: 'stdin-failed', reason: 'stdin-required', message: 'fast-import 必须由宿主送一个只读文件流，没有配 stdinFile 就不能跑' }
    let stdinPrep: any = null
    if (wantStdin) {
      if (cmd !== STDIN_FILE_COMMAND) return { kind: 'stdin-failed', reason: 'not-allowed', message: 'stdinFile 只允许配 fast-import，其余命令的标准输入一律忽略' }
      stdinPrep = await prepareStdinFile(opts.stdinFile)
      if (!stdinPrep.ok) return { kind: 'stdin-failed', reason: stdinPrep.reason, message: stdinPrep.message }
    }
    // #965：git 只读与 gh 共用同一道（读桶），满了排队等；排队被取消按取消返回，不算失败。名额由包装器拿与放。
    // #1007 复核：git 的回话与冷却跟 GitHub 的通路分开记 —— 拿名额时报 service='git'，
    // 这样 GitHub 那条通路冷却时，本地的 git 命令照常能跑。
    return withGhLane({ bucket: 'read', signal: (opts && opts.signal) || undefined, service: 'git' }, async function (): Promise<any> {
    reportOutbound()
    let handle: any
    try {
      handle = subprocess.spawn({
        argv: [exe].concat(args),
        cwd: dir,
        // stdin 默认 ignore（规格第 8 节）：除 fast-import 那个只读文件流的窄例外，一律不给管道。
        stdio: { stdin: stdinPrep ? 'pipe' : 'ignore', stdout: { maxBytes: limit }, stderr: { maxBytes: STDERR_LIMIT } },
        graceMs: PROC_GRACE_MS,
        env: childEnv,
      })
    } catch (e) {
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: cmd, errorKind: 'spawn', errorHash: hash8(String(((e as any) && (e as any).message) || (e as any))) })
      return { kind: 'spawn-failed', message: String(((e as any) && (e as any).message) || (e as any)) }
    }
    // fast-import：把文件字节送进管道。送不进去要当场说清楚（缺流 / EPIPE / 其他写失败），
    // 不能让它静默变成一次「没有输入、却退出码非零」的普通失败。
    let stdinBytes: number = 0
    let notifyStdinError: any = null
    const stdinError: any = stdinPrep ? new Promise(function (resolve) { notifyStdinError = resolve }) : null
    function onStdinError(e: any): void { try { if (notifyStdinError) notifyStdinError({ kind: 'epipe', error: e }) } catch (e2) {} }
    if (stdinPrep) {
      const sink: any = (handle && handle.stdin) ? handle.stdin : null
      if (!sink || typeof sink.write !== 'function') {
        try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
        fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: cmd, errorKind: 'stdin' })
        return { kind: 'stdin-failed', reason: 'stdin-unsupported', message: '这条传输层服务不支持给 git 送标准输入，fast-import 跑不了' }
      }
      try { if (typeof sink.on === 'function') sink.on('error', onStdinError) } catch (eOn) {}
      try {
        sink.write(stdinPrep.bytes)
        stdinBytes = stdinPrep.bytes.length
        if (typeof sink.end === 'function') sink.end()
      } catch (eW) {
        const code: string = (eW && (eW as any).code) ? String((eW as any).code) : ''
        const reason: string = (code === 'EPIPE') ? 'epipe' : 'stdin-write-failed'
        try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
        fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: cmd, errorKind: reason })
        return { kind: 'stdin-failed', reason: reason, message: '给 git 送 fast-import 输入时失败：' + String(((eW as any) && (eW as any).message) || eW), stdinBytes: stdinBytes }
      }
    }
    const watch: any = (opts && opts.stallMs) ? makeStallWatch(handle, Math.max(1000, Math.min(600000, Math.floor(opts.stallMs))), budget, timer) : null
    let outcome: any
    try {
      const raced: any[] = [
        handle.done,
        timer.timeout(budget).then(function () { try { handle.terminate() } catch (eT) {} return { exitCode: -1, signal: 'timeout' } }),
        watch ? watch : new Promise(function () {}),
      ]
      if (stdinError) raced.push(stdinError)
      outcome = await Promise.race(raced)
    } catch (e) {
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: cmd, errorKind: 'spawn', errorHash: hash8(String(((e as any) && (e as any).message) || (e as any))) })
      return { kind: 'spawn-failed', message: String(((e as any) && (e as any).message) || (e as any)) }
    }
    if (outcome && outcome.kind === 'epipe') {
      try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: cmd, errorKind: 'epipe' })
      return { kind: 'stdin-failed', reason: 'epipe', message: 'git fast-import 提前退出，输入没有送完（EPIPE）', stdinBytes: stdinBytes }
    }
    if (outcome && outcome.signal === 'stalled') {
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: cmd, errorKind: 'stalled', timeoutMs: outcome.stallMs })
      return { kind: 'stalled', stallMs: outcome.stallMs }
    }
    if (outcome && outcome.signal === 'timeout') {
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: cmd, errorKind: 'timeout', timeoutMs: budget })
      return { kind: 'timeout', timeoutMs: budget }
    }
    const out: any = readCollector(handle.collected && handle.collected.stdout)
    const err: any = readCollector(handle.collected && handle.collected.stderr)
    const exitCode: number = (outcome && typeof outcome.exitCode === 'number') ? outcome.exitCode : -1
    // 字段白名单（规格第 8 节）：只记命令名、参数个数、退出码、耗时、输出长度与截断标记；
    // 参数内容、输出原文、目录原文都不进日志。
    fire('info', 'git.exec', { argv0: GIT_NAME, cwdHash: dirHash(dir), cmd: cmd, argc: Array.isArray(args) ? args.length : 0, latencyMs: Date.now() - t0, exitCode: exitCode, stdoutBytes: Buffer.byteLength(String(out.text || ''), 'utf8'), truncated: out.truncated === true, stdinBytes: stdinBytes, via: VIA })
    if (exitCode !== 0) { return { kind: 'non-zero', exitCode: exitCode, stderr: err.text } }
    return { kind: 'ok', stdout: out.text, truncated: out.truncated, stdinBytes: stdinBytes }
    }, function (): any { return { kind: 'cancelled', cancelled: true, message: '已取消排队，可重试' } })
  }
  /** 找 git 命令；找不到或平台服务缺席都转成明确失败值，不抛。 */
  async function resolveGitExecutable(): Promise<any> {
    try {
      const platform: any = await getPlatform()
      if (!platform || typeof platform.resolveExecutable !== 'function') return null
      const exe: any = await platform.resolveExecutable('git')
      return (typeof exe === 'string' && exe) ? exe : null
    } catch (e) { return null }
  }
  // 失败信封三件套（failPhone / firstLine / failureFromExec）已下沉到共享核心
  // src/shared/version-control/exec-envelope.js（纯函数，电话们照旧引用，形状不变，另认 cancelled）。
  /** 第 0 步 + 仓库根：先确认这里是不是仓库，再问出后续命令要钉死的那个目录（裸仓库的根就是它的 git 目录）。 */
  async function resolveRepoRoot(exe: any, cwd: any): Promise<any> {
    const step0: any = await runPinned(exe, cwd, stepZeroArgs(), { stdoutLimit: STDERR_LIMIT })
    if (step0.kind === 'timeout' || step0.kind === 'spawn-failed') return failureFromExec(step0, '确认仓库这一步')
    const cls: any = classifyStepZero(step0.kind === 'ok' ? 0 : step0.exitCode, step0.stdout, step0.stderr)
    if (!cls.ok) { const says: string = String(step0.kind === 'ok' ? '' : step0.stderr || '').replace(/\r/g, '').trim().split('\n')[0].slice(0, 300); return failPhone('parse', '确认仓库这一步读不懂：' + cls.detail + (says ? '；git 说：' + says : '')) }
    if (cls.kind === 'not-repo') return failPhone('not-repo', '这个目录不在任何 git 仓库里')
    if (cls.kind === 'bare') return { ok: true, kind: 'bare', root: cls.gitDir, gitDir: cls.gitDir }
    const top: any = await runPinned(exe, cwd, ['rev-parse', '--show-toplevel'], { stdoutLimit: STDERR_LIMIT })
    const badTop: any = failureFromExec(top, '解析仓库根这一步')
    if (badTop) return badTop
    const root: string = firstLine(top.stdout)
    if (!root) return failPhone('parse', '仓库根是空的，后面那些命令没法钉死在这个仓库上')
    return { ok: true, kind: 'worktree', root: root, gitDir: cls.gitDir }
  }

  /** 跑一条采集命令并当场交给核心的解析器：读不全或读不懂都转成失败信封，绝不给半份数据。 */
  async function collect(exe: any, root: any, what: any, args: any, parse: any, opts?: any): Promise<any> {
    const res: any = await runPinned(exe, root, args, opts)
    const bad: any = failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: failPhone('truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    const parsed: any = parse(res.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: failPhone('parse', what + '解析失败：' + parsed.detail) }
    return { ok: true, parsed: parsed }
  }

  /** 问一次「这个仓库有没有第一次提交」——用退出码判，不吃本地化后的 git 文案。 */
  async function readHasHead(exe: any, root: any): Promise<any> {
    const res: any = await runPinned(exe, root, ['rev-parse', '-q', '--verify', 'HEAD'], { stdoutLimit: 4096 })
    if (res.kind === 'ok') return true
    if (res.kind === 'non-zero') return false
    return null
  }

  // 缺文件判据（#858）：DSH fs 服务抛的缺失 code 是 FS_NOT_FOUND、不是 ENOENT，见 ./fsAbsence.js 的头注释。
  let _fsAbsP: any = null
  let _fsLastError: string = '' // 文件服务最近一次「不是缺文件」的错误原话（#858：两条路都不通时要把它带给界面）
  function fsAbsence(): any { if (!_fsAbsP) _fsAbsP = import('./fsAbsence.js'); return _fsAbsP }
  /** 查一个绝对路径在不在（#858 修正形状）：DSH 的 fs 服务是 **stat(target) / lstat(path)**、**没有 exists**——
   *  stat 吃的是 fs.resolve() 给的 target 对象，直接喂路径会抛 TypeError（不是 ENOENT），老写法因此一票否决了
   *  后面本来能给出结论的 lstat，于是「四个标记文件（正常仓库里全都不存在）」这条路必然失败。
   *  现在：先 resolve→stat；拿不到再退路径式的 lstat（缺失回 undefined）；**每个探测各自给结论，一条抛错不许
   *  否决别的探测**；只有所有探测都答不出来才算「查不了」（null）。 */
  async function pathExists(abs: any): Promise<any> {
    let answered: boolean = false
    if (fs && typeof fs.resolve === 'function' && typeof fs.stat === 'function') {
      try { const t: any = await fs.resolve(abs); const r: any = await fs.stat(t); if (r) return true; answered = true } catch (e) { if ((await fsAbsence()).isAbsenceError(e)) return false; _fsLastError = String(((e as any) && ((e as any).code || (e as any).message)) || (e as any)) }
    }
    if (fs && typeof fs.lstat === 'function') {
      try { const r: any = await fs.lstat(abs); if (r) return true; answered = true } catch (e) { if ((await fsAbsence()).isAbsenceError(e)) return false; _fsLastError = String(((e as any) && ((e as any).code || (e as any).message)) || (e as any)) }
    }
    if (fs && typeof fs.exists === 'function') {
      try { const r: any = await fs.exists(abs); if (r === true) return true; answered = true } catch (e) { if ((await fsAbsence()).isAbsenceError(e)) return false; _fsLastError = String(((e as any) && ((e as any).code || (e as any).message)) || (e as any)) }
    }
    return answered ? false : null
  }
  // 标记探测（#858）搬进 ./runningMarkers.js：本文件 350 行顶格，照 #500/#821 先例做自包含叶子。
  // 叶子只做「文件服务优先、拿不到结论走 git 兜底、两条都不通回 kind='env-fs' 并带文件服务的原话」，
  // git 那条命令由这里注入（叶子不碰 git）。为什么要有兜底：文件服务不可用时原来回 kind='env'，
  // 界面上被读成「找不到 git 程序」——真因不是 git（#858 人验收抓到的真 bug）。
  let _markersP: any = null
  function markersPhone(): any { if (!_markersP) _markersP = import('./runningMarkers.js').then(function (m: any) { return m.createRunningMarkers({ existsViaFs: pathExists, paths: RUNNING_MARKER_PATHS, runProbe: async function (rel: any, ctx: any): Promise<any> { const r: any = await runPinned(ctx.exe, ctx.root, ['rev-parse', '-q', '--verify', rel]); if (r && r.kind === 'ok') return true; if (r && r.kind === 'non-zero' && r.exitCode === 1) return false; return null }, getFsDetail: function (): any { return _fsLastError } }) }); return _markersP }

  // 依据时间那一段（reflog 取不到时退回引用文件的落盘时间，#819 复审 P0-3）在 ./versionControlBasis.js：
  // 本文件贴着 350 行上限，与差异电话体同一条先例（依赖全显式传入，那个叶子不引用本文件）。
  let _basisP: any = null
  function basisReader(): any {
    if (!_basisP) _basisP = import('./versionControlBasis.js').then(function (m: any) { return m.createBasisReader({ runPinned: runPinned, fs: fs }) })
    return _basisP
  }
  /** 换行配置的事实来源（核心的 autocrlfArgs）；没配过时 git 退出码 1，这里如实记 null。 */
  async function readAutocrlf(exe: any, root: any): Promise<any> {
    const res: any = await runPinned(exe, root, autocrlfArgs(), { stdoutLimit: 4096 })
    if (res.kind !== 'ok') return null
    const v: string = String(res.stdout).trim()
    return v === '' ? null : v
  }
  /** 首屏：一次把五块采集齐交给核心 assemble 组装；任何一块读不全或读不懂都整体明说失败。 */
  async function readScreen(exe: any, cwd: any): Promise<any> {
    const base: any = await resolveRepoRoot(exe, cwd)
    if (base.ok !== true) return base
    const verRes: any = await runPinned(exe, base.root, ['--version'], { stdoutLimit: 4096 })
    const badVer: any = failureFromExec(verRes, '读 git 版本这一步')
    if (badVer) return badVer
    const gitVersion: string = firstLine(verRes.stdout)
    const tier: any = tierFor(parseVersion(gitVersion))
    if (tier === 'unsupported') return failPhone('unsupported', '这台机器上的 git 版本太旧（' + gitVersion + '），第一版需要 2.11 以上', { tier: tier, gitVersion: gitVersion })

    if (base.kind === 'bare') {
      // 裸仓库没有工作树：核心只问「有没有提交」，问一次历史就够，读不到就当没有（回包里 bare 是真的）。
      let commits: any[] = []
      const lg: any = await runPinned(exe, base.root, (commandFor('log', { logCount: 1 }) as any).args)
      if (lg.kind === 'ok' && !lg.truncated) { const p: any = parseLog(lg.stdout); if (p.ok) commits = p.commits }
      const bareInput: any = { repoRoot: base.root, bare: true, statusHead: '', statusDetached: false, statusOid: null, statusUpstream: null, statusAhead: 0, statusBehind: 0, statusEntries: [], worktrees: [], refs: [], commits: commits, diffFiles: [], merging: false, rebasing: false, cherryPicking: false, reverting: false, tier: tier, autocrlf: null, nowMs: Date.now(), basisMs: null }
      const asmBare: any = assemble(bareInput)
      if (asmBare.ok !== true) return failPhone('parse', '首屏组装失败：' + asmBare.detail)
      return { ok: true, screen: asmBare.screen, tier: tier, gitVersion: gitVersion, worktreesNul: true, readAtMs: Date.now() }
    }

    const st: any = await collect(exe, base.root, '读工作区改动这一步', (commandFor('status', {}) as any).args, parseStatus)
    if (st.ok !== true) return st.envelope
    const status: any = st.parsed
    const hasHead: any = status.branch.oid !== null

    // 工作树清单：先用 -z（路径原样输出）；老版本 git 不认这个开关时退回换行形态，并把这次用的是哪一种写进回包。
    let worktreesNul: boolean = true
    let wtRes: any = await runPinned(exe, base.root, (commandFor('worktrees', {}) as any).args)
    if (wtRes.kind === 'non-zero') { worktreesNul = false; wtRes = await runPinned(exe, base.root, (commandFor('worktrees', { useNulWorktrees: false }) as any).args) }
    const badWt: any = failureFromExec(wtRes, '读工作树清单这一步')
    if (badWt) return badWt
    if (wtRes.truncated) return failPhone('truncated', '工作树清单读不全，不给半份列表')
    const worktrees: any = parseWorktrees(wtRes.stdout, worktreesNul)
    if (worktrees.ok !== true) return failPhone('parse', '工作树清单解析失败：' + worktrees.detail)

    const rf: any = await collect(exe, base.root, '读本地分支这一步', (commandFor('refs', {}) as any).args, parseRefs)
    if (rf.ok !== true) return rf.envelope

    // 没有第一次提交时历史与逐文件行数都没有基线：不起这两条进程，按零提交如实组装（核心对零提交有边界）。
    let commits: any[] = []
    let diffFiles: any[] = []
    if (hasHead) {
      const lg2: any = await collect(exe, base.root, '读提交历史这一步', (commandFor('log', { logCount: FIRST_SCREEN_LOG_COUNT }) as any).args, parseLog)
      if (lg2.ok !== true) return lg2.envelope
      commits = lg2.parsed.commits
      const df: any = await collect(exe, base.root, '读每个文件改了行数这一步', (commandFor('diffFiles', {}) as any).args, parseDiffFiles)
      if (df.ok !== true) return df.envelope
      diffFiles = df.parsed.files
    }

    const mres: any = await (await markersPhone()).read(base.gitDir, { exe: exe, root: base.root })
    if (mres.ok !== true) return failPhone(mres.kind === 'env-fs' ? 'env-fs' : 'env', '宿主的文件服务现在用不了（' + String(mres.detail || '没有给出原因') + '），判断不了是不是正在合并或变基；这一项读不到就不给数')
    const markers: any = mres.markers
    const asm: any = assemble({
      repoRoot: base.root, bare: false,
      statusHead: status.branch.head, statusDetached: status.branch.detached, statusOid: status.branch.oid,
      statusUpstream: status.branch.upstream, statusAhead: status.branch.ahead, statusBehind: status.branch.behind,
      statusEntries: status.entries, worktrees: worktrees.worktrees, refs: rf.parsed.refs, commits: commits, diffFiles: diffFiles,
      merging: markers.merging, rebasing: markers.rebasing, cherryPicking: markers.cherryPicking, reverting: markers.reverting,
      tier: tier, autocrlf: await readAutocrlf(exe, base.root), nowMs: Date.now(), basisMs: await (await basisReader()).readBasisMs(exe, base.root, base.gitDir, status.branch.upstream),
    })
    if (asm.ok !== true) return failPhone('parse', '首屏组装失败：' + asm.detail)
    return { ok: true, screen: asm.screen, tier: tier, gitVersion: gitVersion, worktreesNul: worktreesNul, readAtMs: Date.now() }
  }

  /** 电话 wf.gitStatus 的处理体：首屏一次拿全。 */
  async function handleGitStatus(args: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    return readScreen(exe, cwdOf(args))
  }

  // 差异电话体（#821 起含「看某一次提交改了什么」）在 ./versionControlFiles.js：本文件贴着 350 行上限，照 logStore→logPhones 惯例搬成自包含叶子，依赖全显式传入、单向引用。
  let _filesP: any = null
  function diffPhone(): any { if (!_filesP) _filesP = import('./versionControlFiles.js').then(function (m: any) { return m.createGitDiffPhone({ failPhone: failPhone, runPinned: runPinned, failureFromExec: failureFromExec, resolveGitExecutable: resolveGitExecutable, resolveRepoRoot: resolveRepoRoot, readHasHead: readHasHead, cwdOf: cwdOf, patchLimit: PATCH_LIMIT }) }); return _filesP }
  async function handleGitDiff(args: any): Promise<any> { const p: any = await diffPhone(); return p(args) }

  // 首屏一次取全的聚合电话（#1739 T04）住 ./versionControlFirstScreen.js：本文件贴着 350 行上限，
  // 与差异电话体同一先例（自包含叶子、依赖全显式传入、单向引用、不碰父文件闭包以外的状态）。
  let _firstP: any = null
  function firstScreenPhone(): any { if (!_firstP) _firstP = import('./versionControlFirstScreen.js').then(function (m: any) { return m.createFirstScreenPhone({ failPhone: failPhone, firstLine: firstLine, failureFromExec: failureFromExec, runPinned: runPinned, resolveGitExecutable: resolveGitExecutable, resolveRepoRoot: resolveRepoRoot, cwdOf: cwdOf, collect: collect, readHasHead: readHasHead, readAutocrlf: readAutocrlf, basisReader: basisReader, readMarkers: function (gitDir: any, ctx: any): any { return markersPhone().then(function (p: any): any { return p.read(gitDir, ctx) }) }, logCount: FIRST_SCREEN_LOG_COUNT }) }); return _firstP }
  async function handleGitFirstScreen(args: any): Promise<any> { const p: any = await firstScreenPhone(); return p(args) }

  /** 电话 wf.gitLog 的处理体：历史按批取；多要一条用来判断后面还有没有。 */
  async function handleGitLog(args: any): Promise<any> {
    const count: number = clampInt(args && args.count, FIRST_SCREEN_LOG_COUNT, 1, LOG_BATCH_MAX)
    const skip: number = clampInt(args && args.skip, 0, 0, 1000000)
    const exe: any = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const base: any = await resolveRepoRoot(exe, cwdOf(args))
    if (base.ok !== true) return base
    const hasHead: any = await readHasHead(exe, base.root)
    if (hasHead === null) return failPhone('env', '问不出这个仓库有没有第一次提交，读历史这一步做不了')
    if (hasHead === false) return { ok: true, commits: [], skip: skip, requested: count, returned: 0, hasMore: false }
    const res: any = await runPinned(exe, base.root, (commandFor('log', { logCount: count + 1, logSkip: skip }) as any).args)
    const bad: any = failureFromExec(res, '读提交历史这一步')
    if (bad) return bad
    if (res.truncated) return failPhone('truncated', '这一批提交历史超过了 ' + Math.round(STDOUT_LIMIT / 1048576) + ' MB，读不全就不给半份列表，请把每批条数调小再取')
    const parsed: any = parseLog(res.stdout)
    if (parsed.ok !== true) return failPhone('parse', '提交历史解析失败：' + parsed.detail)
    const hasMore: boolean = parsed.commits.length > count
    const commits: any[] = hasMore ? parsed.commits.slice(0, count) : parsed.commits
    return { ok: true, commits: commits, skip: skip, requested: count, returned: commits.length, hasMore: hasMore }
  }

  /** 入参里的工作目录：给了就用给的，没给用宿主进程当前目录。 */
  function cwdOf(args: any): any { const c: any = args && args.cwd; return (typeof c === 'string' && c.trim() !== '') ? c : DEFAULT_CWD }

  /** 把一批条数夹进允许范围；给了看不懂的值就用默认值。 */
  function clampInt(v: any, fallback: any, min: any, max: any): any { const n: any = (typeof v === 'number' && isFinite(v)) ? Math.floor(v) : ((typeof v === 'string' && /^[0-9]+$/.test(v)) ? Number(v) : NaN); if (!isFinite(n)) return fallback; return Math.min(max, Math.max(min, n)) }

  /** 电话体记一行日志：成功落 host.call，失败落 host.call.fail（沿用仓库里既有两个事件，不新增）。 */
  function phoneLog(method: any, kind: any, t0: any, res: any, err?: any): void { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String(((err as any) && (err as any).message) || (err as any))) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorKind: (res && res.error && res.error.kind) || '', errorHash: hash8(String((res && res.error && res.error.message) || 'version-control-not-ok')) }) } catch (eL) {} }

  /** 把一条电话体包成「进出各一行日志」的形状。 */
  function loggedPhone(method: any, kind: any, fn: any): any { return async function (): Promise<any> { const t0: number = Date.now(); try { const r: any = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }

  /** 首屏读数（#841）：写模块的预检要的就是这一份——同一个 readScreen，不另起一套读法。 */
  async function readScreenOf(cwd: any): Promise<any> { const exe: any = await resolveGitExecutable(); if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）'); return readScreen(exe, cwd) }

  // 写操作那一族（#841 起 1 预检 + 5 执行，#865 再加更新远方记录 1 条）住另两文件；本文件只做装配与日志包装（动态加载、同层单向，同一出口、同一信封、同一读数、同一 loggedPhone）。
  let _writeP: any = null
  function writePhone(): any { if (!_writeP) _writeP = Promise.all([import('../refresh/rooms/host/gh-execution.js'), import('./versionControlCheck.js'), import('./versionControlWrite.js')]).then(function (ms: any) { const sg: any = ms[0].createCredentialSafeGit({ runGit: runGit, getPlatform: getPlatform, DEFAULT_CWD: DEFAULT_CWD }); const nowFn: any = (deps && typeof deps.now === 'function') ? deps.now : Date.now; const c: any = ms[1].createWriteCheck({ vc: { readScreenOf: readScreenOf }, safeGit: sg, failPhone: failPhone, nowMs: nowFn, randomId: function (): string { return Math.random().toString(36).slice(2) } }); const w: any = ms[2].createWritePhones({ vc: { readScreenOf: readScreenOf }, safeGit: sg, tickets: c.tickets, results: c.results, nowMs: nowFn }); return { check: loggedPhone('wf.gitWriteCheck', 'git-write-check', c.handleGitWriteCheck), stage: loggedPhone('wf.gitStage', 'git-stage', w.handleGitStage), unstage: loggedPhone('wf.gitUnstage', 'git-unstage', w.handleGitUnstage), commit: loggedPhone('wf.gitCommit', 'git-commit', w.handleGitCommit), pull: loggedPhone('wf.gitPull', 'git-pull', w.handleGitPull), fetch: loggedPhone('wf.gitFetch', 'git-fetch', w.handleGitFetch), push: loggedPhone('wf.gitPush', 'git-push', w.handleGitPush), tickets: c.tickets } }).catch(function (e: any): any { const f: any = function (): any { return failPhone('env', '写操作那一族加载失败：' + String(((e as any) && (e as any).message) || (e as any))) }; return { check: f, stage: f, unstage: f, commit: f, pull: f, fetch: f, push: f } }); return _writeP }

  // ---- #1740 长任务通道（追加段，不改上面任何既有行为）----
  // 三条口径：
  //   1. 命令拼装与白名单来自共享协议 task-protocol；本层只负责起进程、固定前缀、GIT_EDITOR、
  //      -C 钉仓库、报闸、标准输入窄例外与输出增量读取，不判断业务语义；
  //   2. 进度靠定时读收集器（DSH 的 subprocess 服务只给 readFrom 增量读，没有逐行回调），
  //      读到多少行就交给运行器解析多少；解析不出百分比时运行器会如实标成不确定；
  //   3. 结束结论四类（成功、失败、取消、中断）由运行器写；本层只把退出事实与输出原文交出去。
  function makeLaunchTaskGit(pollMs: number): any {
    return async function launchTaskGit(options: any): Promise<any> {
      const resolved: any = await resolveGitExecutable()
      if (!resolved) return { ok: false, kind: 'spawn-failed', message: '找不到 git 可执行文件（platform.resolveExecutable("git") 没有给出路径）' }
      const dir: string = String((options && options.cwd) || DEFAULT_CWD || '')
      const args: string[] = Array.isArray(options && options.args) ? options.args : []
      const argv: string[] = [resolved, '-C', dir].concat(fixedPrefix(), args)
      const wantStdin: boolean = !!(options && options.stdinBytes)
      // 非交互：GIT_EDITOR 设成必失败命令（规格第 7 节），终端提示与 askpass 一并关死，长任务不许卡在等输入。
      const childEnv: any = { GIT_EDITOR: FAILING_EDITOR, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: FAILING_EDITOR }
      reportOutbound()
      let handle: any
      try {
        handle = subprocess.spawn({
          argv: argv,
          cwd: dir,
          stdio: { stdin: wantStdin ? 'pipe' : 'ignore', stdout: { maxBytes: STDOUT_LIMIT }, stderr: { maxBytes: STDERR_LIMIT } },
          graceMs: PROC_GRACE_MS,
          env: childEnv,
        })
      } catch (e) {
        fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: subcommandOf(args), errorKind: 'spawn' })
        return { ok: false, kind: 'spawn-failed', message: String(((e as any) && (e as any).message) || (e as any)) }
      }
      const state: any = { stopped: false, outOff: 0, errOff: 0, outText: '', errText: '', outLossy: false, errLossy: false, stdinError: null }
      const onLine: any = (options && typeof options.onLine === 'function') ? options.onLine : null
      function takeChunk(kind: any): void {
        try {
          const collector: any = handle && handle.collected ? handle.collected[kind] : null
          if (!collector || typeof collector.readFrom !== 'function') return
          const offKey: string = kind === 'stdout' ? 'outOff' : 'errOff'
          const textKey: string = kind === 'stdout' ? 'outText' : 'errText'
          const lossyKey: string = kind === 'stdout' ? 'outLossy' : 'errLossy'
          const chunk: any = collector.readFrom(state[offKey]) || {}
          if (typeof chunk.nextOffset === 'number') state[offKey] = chunk.nextOffset
          if (typeof chunk.text === 'string' && chunk.text) {
            state[textKey] += chunk.text
            if (onLine) {
              const lines: string[] = chunk.text.split(/\r?\n/)
              for (let i: number = 0; i < lines.length; i++) { const line: string = lines[i]; if (line.trim()) onLine(line) }
            }
          }
          if (chunk.lossy === true) state[lossyKey] = true
        } catch (e) { /* 读收集器失败不影响任务本身 */ }
      }
      function pump(): void { takeChunk('stdout'); takeChunk('stderr') }
      function loop(): void {
        if (state.stopped) return
        pump()
        try { Promise.resolve(timer.timeout(pollMs)).then(loop).catch(function (): void {}) } catch (e) {}
      }
      if (wantStdin) {
        const sink: any = handle && handle.stdin ? handle.stdin : null
        if (!sink || typeof sink.write !== 'function') {
          try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
          fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, cmd: subcommandOf(args), errorKind: 'stdin' })
          return { ok: false, kind: 'stdin-failed', message: '这条传输层服务不支持给 git 送标准输入，fast-import 跑不了' }
        }
        try {
          if (typeof sink.on === 'function') sink.on('error', function (e: any): void {
            state.stdinError = { kind: (e && e.code === 'EPIPE') ? 'epipe' : 'stdin-write-failed' }
            try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
          })
        } catch (eOn) {}
        try {
          sink.write(options.stdinBytes)
          if (typeof sink.end === 'function') sink.end()
        } catch (eW) {
          const code: string = (eW && (eW as any).code) ? String((eW as any).code) : ''
          state.stdinError = { kind: code === 'EPIPE' ? 'epipe' : 'stdin-write-failed' }
          try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {}
        }
      }
      loop()
      const finalDone: Promise<any> = Promise.resolve(handle.done).then(function (outcome: any): any {
        state.stopped = true
        pump()
        // 没有增量读能力的收集器（别家实现或测试假身）在结束时一次取全文；有增量读的已经在 pump 里读完。
        try {
          const so: any = handle && handle.collected ? handle.collected.stdout : null
          const se: any = handle && handle.collected ? handle.collected.stderr : null
          const noStream: boolean = !(so && typeof so.readFrom === 'function')
          if (noStream) {
            const o: any = readCollector(so)
            const r: any = readCollector(se)
            if (o.text) state.outText += o.text
            if (r.text) state.errText += r.text
            if (o.truncated || r.truncated) state.outLossy = true
          }
        } catch (eR) {}
        return {
          exitCode: (outcome && typeof outcome.exitCode === 'number') ? outcome.exitCode : null,
          signalled: !!(outcome && outcome.signal),
          stdout: state.outText,
          stderr: state.errText,
          truncated: state.outLossy || state.errLossy,
          stdinError: state.stdinError ? state.stdinError : null,
        }
      }, function (): any {
        state.stopped = true
        return { exitCode: null, signalled: false, stdout: state.outText, stderr: state.errText, truncated: state.outLossy || state.errLossy, stdinError: state.stdinError }
      })
      return {
        ok: true,
        handle: {
          done: finalDone,
          terminate: function (): void { try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch (eT) {} },
          stdin: handle.stdin,
        },
        stdinError: state.stdinError,
      }
    }
  }
  /** 长任务通道：首次调用时装配新叶子；三条电话与写电话同一个 loggedPhone 日志口径（host.call / host.call.fail）。 */
  let _taskP: any = null
  function taskPhone(): Promise<any> {
    if (!_taskP) {
      _taskP = (async function (): Promise<any> {
        const mod: any = await import('./versionControlTask.js')
        const pollMs: number = Math.max(100, Number(mod.TASK_POLL_MS) || 400)
        const channel: any = mod.createTaskChannel({
          fs: fs,
          getCacheDir: (deps && typeof deps.getCacheDir === 'function') ? deps.getCacheDir : null,
          timer: timer,
          now: (deps && typeof deps.now === 'function') ? deps.now : Date.now,
          hash8: hash8,
          instanceId: 'vc-' + hash8(String(Date.now()) + ':' + Math.random()),
          repoRoot: DEFAULT_CWD,
          fire: fire,
          prepareStdinFile: prepareStdinFile,
          launch: makeLaunchTaskGit(pollMs),
        })
        return {
          handleGitTaskStart: loggedPhone('wf.gitTaskStart', 'git-task-start', channel.handleGitTaskStart),
          handleGitTaskQuery: loggedPhone('wf.gitTaskQuery', 'git-task-query', channel.handleGitTaskQuery),
          handleGitTaskCancel: loggedPhone('wf.gitTaskCancel', 'git-task-cancel', channel.handleGitTaskCancel),
        }
      })()
      _taskP.catch(function (): void { _taskP = null })
    }
    return _taskP
  }

  // ---- #1742 改动页两条电话（追加段，不改上面任何既有行为）----
  // 预检（发票）与执行（凭票写）的装配住 ./versionControlChanges.js：那一片只做「同一个首屏读数、
  // 同一条进程出口、同一套 loggedPhone 日志口径」的拼接，改动页自己的票据表与 requestId 结果表留在它自己的闭包里。
  // 本文件只把上面已经造好的闭包交给它，不新增任何业务判定。
  let _changesP: any = null
  function changesPhone(): Promise<any> {
    if (!_changesP) {
      _changesP = import('./versionControlChanges.js').then(function (m: any): any {
        return m.createChangesPhone({
          fs: fs, failPhone: failPhone, fsAbsence: fsAbsence, resolveGitExecutable: resolveGitExecutable,
          runGit: runGit, fixedPrefix: fixedPrefix, pathExists: pathExists, readScreenOf: readScreenOf,
          loggedPhone: loggedPhone, DEFAULT_CWD: DEFAULT_CWD, timeoutMs: timeoutMs, STDOUT_LIMIT: STDOUT_LIMIT,
          now: (deps && typeof deps.now === 'function') ? deps.now : Date.now,
        })
      }).catch(function (e: any): any {
        const f: any = function (): any { return failPhone('env', '改动页那一族加载失败：' + String(((e as any) && (e as any).message) || (e as any))) }
        return { check: f, write: f, tickets: new Map() }
      })
    }
    return _changesP
  }

  return {
    handleGitStatus: loggedPhone('wf.gitStatus', 'git-status', handleGitStatus),
    handleGitDiff: loggedPhone('wf.gitDiff', 'git-diff', handleGitDiff),
    handleGitLog: loggedPhone('wf.gitLog', 'git-log', handleGitLog),
    // 首屏七片一次聚合（#1739 T04）：一次调用拿全，各片成败在回包里各自说。
    handleGitFirstScreen: loggedPhone('wf.gitFirstScreen', 'git-first-screen', handleGitFirstScreen),
    // 写电话（1 预检 + 6 执行）：第一次调用时才装配，装完缓存；键名与只读那三条同形。
    handleGitWriteCheck: async function (a: any): Promise<any> { const w: any = await writePhone(); return w.check(a) },
    handleGitStage: async function (a: any): Promise<any> { const w: any = await writePhone(); return w.stage(a) },
    handleGitUnstage: async function (a: any): Promise<any> { const w: any = await writePhone(); return w.unstage(a) },
    handleGitCommit: async function (a: any): Promise<any> { const w: any = await writePhone(); return w.commit(a) },
    handleGitPull: async function (a: any): Promise<any> { const w: any = await writePhone(); return w.pull(a) },
    handleGitFetch: async function (a: any): Promise<any> { const w: any = await writePhone(); return w.fetch(a) },
    handleGitPush: async function (a: any): Promise<any> { const w: any = await writePhone(); return w.push(a) },
    // 只给门禁与测试读取票据表（#1741）：绑定表要能被篡改着测，但这条路不注册成电话，客户端拿不到。
    // 票据原值仍只留在宿主进程内存里，不落盘、不进日志。
    writeTickets: async function (): Promise<any> { const w: any = await writePhone(); return w.tickets || null },
    runGitCommand: runGit, // #839：那一族「可能弹凭据提示」的命令复用同一条进程出口（同一个报闸、同一条 git.exec 日志、同一套字节上限）
    // #1740 长任务通道三条电话（开始、查询、取消）：装配在 ./versionControlTask.js，进程出口是上面那条固定前缀与报闸。
    handleGitTaskStart: async function (a: any): Promise<any> { const t: any = await taskPhone(); return t.handleGitTaskStart(a) },
    handleGitTaskQuery: async function (a: any): Promise<any> { const t: any = await taskPhone(); return t.handleGitTaskQuery(a) },
    handleGitTaskCancel: async function (a: any): Promise<any> { const t: any = await taskPhone(); return t.handleGitTaskCancel(a) },
    // #1742 改动页两条电话（预检、执行）：装配在 ./versionControlChanges.js，进程出口照旧是上面那条固定前缀与报闸。
    // 只读动作 1.13（查为什么被忽略）走预检电话的 op，不再单开第三条电话。
    handleGitChangesCheck: async function (a: any): Promise<any> { const c: any = await changesPhone(); return c.check(a) },
    handleGitChangesWrite: async function (a: any): Promise<any> { const c: any = await changesPhone(); return c.write(a) },
    // 只给门禁与测试读取改动页票据表（#1742），与 #1741 的 writeTickets 同一条口径：不注册成电话、客户端拿不到。
    changesTickets: async function (): Promise<any> { const c: any = await changesPhone(); return c.tickets || null },
  }
}
