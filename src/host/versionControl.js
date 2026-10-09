// src/host/versionControl.js —— 版本管理页签的宿主取数层（#817）
//
// 这一层把真实 git 进程跑起来、把输出交给已落地的 TypeScript 核心解析与组装、经三条电话
// （wf.gitStatus / wf.gitDiff / wf.gitLog）把结果回给界面。核心是纯函数，不许碰进程与磁盘；
// 取数与落盘按 docs/adr/20260913-builtin-ts-shape.md 归宿主，本文件就是「取数」的全部落点。
//
// 起进程的纪律（票面 #817 与 ADR 20261002-version-control-readonly-no-network.md）：
//   1. 一律走 DSH 的 subprocess 服务，不用 Node 的 child_process，不经 shell，argv 数组直传；
//   2. 第 0 步先问「这里是不是仓库」，问出仓库根之后每条命令都用 -C <仓库根> 钉死；
//   3. 会输出路径的命令加 -z；标准输入 ignore；标准输出设字节上限；超时走 DSH 的 timer 服务；
//   4. 退出码非零原样交给调用方判，本文件不抛；起进程之前先向闸报一笔（gate.noteOutbound）；
//   5. 第一版不发起网络动作（不 fetch / 不 pull / 不 push）：领先落后只读本地记录，依据时间取远端
//      跟踪引用 reflog 的末条时间戳（ADR 第 3 条）；刚克隆、还没 fetch 过的仓库没有 reflog，只有这个上游
//      自己的松散引用文件在时才退回它的落盘时间，否则如实回 null（拿全仓库共用的 packed-refs 的 mtime 凑
//      一个时间是不行的，#819 复审再修）。日志：每条命令一行常驻 git.exec（成功与非零退出
//      各一行），超时与起进程失败一行告警级 git.exec.fail（直通刷盘）；目录只记散列，输出不进日志。
import { fixedPrefix, stepZeroArgs, commandFor, autocrlfArgs, RUNNING_MARKER_PATHS } from '../shared/version-control/commands.js'
import { parseVersion, tierFor } from '../shared/version-control/capabilities.js'
import { parseStatus } from '../shared/version-control/parse-status.js'
import { parseWorktrees } from '../shared/version-control/parse-worktrees.js'
import { parseRefs } from '../shared/version-control/parse-refs.js'
import { parseLog } from '../shared/version-control/parse-log.js'
import { parseDiffFiles } from '../shared/version-control/parse-diff-files.js'
import { assemble, classifyStepZero } from '../shared/version-control/state.js'
import { makeStallWatch } from './stallWatch.js' // #847：字节增长看门狗（自包含叶子，照 #500/#821 先例）
import { getGhLane } from '../shared/gh-admission.js'

const VIA = 'version-control'          // 日志的 via：这一族 git 命令都由版本管理页签发起
const GIT_NAME = 'git'                 // 日志的 argv0：只记程序名，不记路径
const STDOUT_LIMIT = 8 * 1024 * 1024   // 状态、工作树、分支、历史、文件清单的字节上限
const PATCH_LIMIT = 4 * 1024 * 1024    // 单个文件差异的字节上限
const STDERR_LIMIT = 256 * 1024        // 错误信息的字节上限（只用来拼失败说明）
const RUN_TIMEOUT_MS = 20000           // 单条 git 命令的默认超时；接线给了 TIMEOUT_MS 就用接线那个
const FIRST_SCREEN_LOG_COUNT = 50      // 首屏一次读多少条提交（核心的默认口径）
const LOG_BATCH_MAX = 200              // 历史按批取时一批最多多少条

/** 造这台机器上唯一的版本管理取数器；依赖全部由入口显式传入（本文件不引用别的宿主文件）。 */
export function createVersionControl(deps) {
  const { subprocess, timer, fs, getPlatform, DEFAULT_CWD, TIMEOUT_MS, gate, logCtx } = deps
  const timeoutMs = (typeof TIMEOUT_MS === 'number' && TIMEOUT_MS > 0) ? TIMEOUT_MS : RUN_TIMEOUT_MS
  /** 路径短散列：日志里只认它，不记原始目录。 */
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  /** 目录散列：散列之前先把目录归一（反斜杠统一成正斜杠、去掉结尾的斜杠）。首屏头两条命令用的是
   *  调用方给的写法，后面几条用的是 git 自己回的正斜杠仓库根；不归一，同一个目录会算出两个 cwdHash
   *  （#819 复审发现），按它过滤日志就会把一次面板打开拆成两组。 */
  function dirHash(dir) { try { return hash8(String(dir || '').replace(/\\/g, '/').replace(/\/+$/, '')) } catch (e) { return '00000000' } }
  /** 落一行日志；日志设施缺席时静默跳过，绝不影响已经要回给界面的结果。 */
  function fire(level, event, fields) { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e) {} }
  /** 起进程之前把这一笔报给闸；闸没接上时照旧执行（门禁会因漏账判红，不在这里静默假装记过）。 */
  function reportOutbound() { try { if (gate && typeof gate.noteOutbound === 'function') gate.noteOutbound({ requests: 1, points: 0 }) } catch (e) {} }
  /** 从收集器里取文本与「有没有被字节上限截掉」的标记：DSH 收集器的真名是 lossy（越过保留的尾部时判真，留的是尾部 maxBytes）；finalize() 那条是给别家实现留的兼容路，两条都拿不到时按可能截断处理（核心口径）。 */
  function readCollector(collector) {
    if (!collector) return { text: '', truncated: false }
    try {
      if (typeof collector.finalize === 'function') { const r = collector.finalize() || {}; return { text: String(r.text || ''), truncated: r.truncated === true } }
      if (typeof collector.readFrom === 'function') { const r = collector.readFrom(0) || {}; return { text: String(r.text || ''), truncated: r.lossy === true } }
    } catch (e) {}
    return { text: '', truncated: true }
  }
  /** 把一条命令拼成「程序 + 钉死目录 + 固定前缀 + 子命令」的形状。 */
  function pinned(exe, dir, args) { return [exe, '-C', dir].concat(fixedPrefix(), args) }
  /** 把一次「钉死目录」的执行跑起来；返回核心 ports.ts 里那四种情形之一。 */
  function runPinned(exe, dir, args, opts) { return runGit(exe, dir, pinned(exe, dir, args).slice(1), opts) }

  /** 跑一条 git 命令：成功与非零退出各落一行 git.exec，超时与起进程失败各落一行 git.exec.fail。opts.env 是给 #839 那一族「可能弹凭据提示」的命令传非交互环境用的（undefined 值是墓碑，从继承环境里删掉这一项）。opts.signal 是 #965 准入的取消信号：排队时被取消按取消返回，不算失败。 */
  async function runGit(exe, dir, args, opts) {
    const t0 = Date.now()
    const limit = (opts && opts.stdoutLimit) ? opts.stdoutLimit : STDOUT_LIMIT
    const budget = (opts && opts.timeoutMs) ? opts.timeoutMs : timeoutMs
    const vcSignal = (opts && opts.signal) || undefined
    // #965：先拿名额再起进程，版本管理只读路与三路出站共用同一道计数，一律读桶。
    let vcRelease = null
    try {
      vcRelease = await getGhLane().acquire({ bucket: 'read', signal: vcSignal || undefined })
    } catch {
      return { kind: 'cancelled', cancelled: true, message: '已取消排队（出站准入等待中被取消），没有发出请求，可重试' }
    }
    const doneVc = function () { try { if (vcRelease) vcRelease() } catch {} }
    reportOutbound()
    let handle
    try {
      handle = subprocess.spawn({
        argv: [exe].concat(args),
        cwd: dir,
        stdio: { stdin: 'ignore', stdout: { maxBytes: limit }, stderr: { maxBytes: STDERR_LIMIT } },
        graceMs: 2000,
        env: (opts && opts.env) ? opts.env : undefined,
      })
    } catch (e) {
      doneVc()
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, errorHash: hash8(String((e && e.message) || e)) })
      return { kind: 'spawn-failed', message: String((e && e.message) || e) }
    }
    const watch = (opts && opts.stallMs) ? makeStallWatch(handle, Math.max(1000, Math.min(600000, Math.floor(opts.stallMs))), budget, timer) : null
    // #965：在飞时被取消就杀进程。
    let onAbortVc = null
    const abortVcP = new Promise(function (resolve) {
      if (!vcSignal || typeof vcSignal.addEventListener !== 'function') return
      if (vcSignal.aborted === true) { try { handle.terminate() } catch {} resolve({ exitCode: -1, signal: 'aborted' }); return }
      onAbortVc = function () { try { handle.terminate() } catch {} resolve({ exitCode: -1, signal: 'aborted' }) }
      try { vcSignal.addEventListener('abort', onAbortVc, { once: true }) } catch {}
    })
    let outcome
    try {
      outcome = await Promise.race([
        handle.done,
        timer.timeout(budget).then(function () { try { handle.terminate() } catch (eT) {} return { exitCode: -1, signal: 'timeout' } }),
        watch ? watch : new Promise(function () {}),
        abortVcP,
      ])
    } catch (e) {
      try { if (onAbortVc && vcSignal && typeof vcSignal.removeEventListener === 'function') vcSignal.removeEventListener('abort', onAbortVc) } catch {}
      doneVc()
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, errorHash: hash8(String((e && e.message) || e)) })
      return { kind: 'spawn-failed', message: String((e && e.message) || e) }
    }
    try { if (onAbortVc && vcSignal && typeof vcSignal.removeEventListener === 'function') vcSignal.removeEventListener('abort', onAbortVc) } catch {}
    // #965：在飞时被取消按取消返回，不算失败，不记超时。
    if (outcome && outcome.signal === 'aborted') {
      doneVc()
      return { kind: 'cancelled', cancelled: true, message: '已取消在飞请求（出站准入执行中被取消），可重试' }
    }
    if (outcome && outcome.signal === 'stalled') {
      doneVc()
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, timeoutMs: outcome.stallMs })
      return { kind: 'stalled', stallMs: outcome.stallMs }
    }
    if (outcome && outcome.signal === 'timeout') {
      doneVc()
      fire('warn', 'git.exec.fail', { argv0: GIT_NAME, cwdHash: dirHash(dir), via: VIA, timeoutMs: budget })
      return { kind: 'timeout', timeoutMs: budget }
    }
    const out = readCollector(handle.collected && handle.collected.stdout)
    const err = readCollector(handle.collected && handle.collected.stderr)
    const exitCode = (outcome && typeof outcome.exitCode === 'number') ? outcome.exitCode : -1
    fire('info', 'git.exec', { argv0: GIT_NAME, cwdHash: dirHash(dir), latencyMs: Date.now() - t0, exitCode: exitCode, via: VIA })
    if (exitCode !== 0) { doneVc(); return { kind: 'non-zero', exitCode: exitCode, stderr: err.text } }
    doneVc()
    return { kind: 'ok', stdout: out.text, truncated: out.truncated }
  }
  /** 找 git 命令；找不到或平台服务缺席都转成明确失败值，不抛。 */
  async function resolveGitExecutable() {
    try {
      const platform = await getPlatform()
      if (!platform || typeof platform.resolveExecutable !== 'function') return null
      const exe = await platform.resolveExecutable('git')
      return (typeof exe === 'string' && exe) ? exe : null
    } catch (e) { return null }
  }
  /** 失败信封的唯一真源：三条电话共用这一份形状（扁平信封，错误只有一个 kind 与一句人话）。 */
  function failPhone(kind, message, extra) { return Object.assign({ ok: false, error: { kind: kind, message: message } }, extra || {}) }

  /** 取错误信息的第一行做说明；空的时候给一句兜底，不留空白。 */
  function firstLine(text) { const t = String(text || '').replace(/\r/g, '').trim(); if (!t) return 'git 没有给出说明'; const i = t.indexOf('\n'); return (i >= 0 ? t.slice(0, i) : t).slice(0, 300) }

  /** 把一次进程执行的四种情形翻译成失败信封；成功交给调用方继续。 */
  function failureFromExec(res, what) {
    if (res.kind === 'timeout') return failPhone('timeout', what + '超时了（' + res.timeoutMs + ' 毫秒没有回音）')
    if (res.kind === 'spawn-failed') return failPhone('spawn', what + '时起不了 git 进程：' + res.message)
    if (res.kind === 'non-zero') return failPhone('exit', what + '失败（git 退出码 ' + res.exitCode + '）：' + firstLine(res.stderr))
    return null
  }

  /** 第 0 步 + 仓库根：先确认这里是不是仓库，再问出后续命令要钉死的那个目录（裸仓库的根就是它的 git 目录）。 */
  async function resolveRepoRoot(exe, cwd) {
    const step0 = await runPinned(exe, cwd, stepZeroArgs(), { stdoutLimit: STDERR_LIMIT })
    if (step0.kind === 'timeout' || step0.kind === 'spawn-failed') return failureFromExec(step0, '确认仓库这一步')
    const cls = classifyStepZero(step0.kind === 'ok' ? 0 : step0.exitCode, step0.stdout, step0.stderr)
    if (!cls.ok) { const says = String(step0.kind === 'ok' ? '' : step0.stderr || '').replace(/\r/g, '').trim().split('\n')[0].slice(0, 300); return failPhone('parse', '确认仓库这一步读不懂：' + cls.detail + (says ? '；git 说：' + says : '')) }
    if (cls.kind === 'not-repo') return failPhone('not-repo', '这个目录不在任何 git 仓库里')
    if (cls.kind === 'bare') return { ok: true, kind: 'bare', root: cls.gitDir, gitDir: cls.gitDir }
    const top = await runPinned(exe, cwd, ['rev-parse', '--show-toplevel'], { stdoutLimit: STDERR_LIMIT })
    const badTop = failureFromExec(top, '解析仓库根这一步')
    if (badTop) return badTop
    const root = firstLine(top.stdout)
    if (!root) return failPhone('parse', '仓库根是空的，后面那些命令没法钉死在这个仓库上')
    return { ok: true, kind: 'worktree', root: root, gitDir: cls.gitDir }
  }

  /** 跑一条采集命令并当场交给核心的解析器：读不全或读不懂都转成失败信封，绝不给半份数据。 */
  async function collect(exe, root, what, args, parse, opts) {
    const res = await runPinned(exe, root, args, opts)
    const bad = failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: failPhone('truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    const parsed = parse(res.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: failPhone('parse', what + '解析失败：' + parsed.detail) }
    return { ok: true, parsed: parsed }
  }

  /** 问一次「这个仓库有没有第一次提交」——用退出码判，不吃本地化后的 git 文案。 */
  async function readHasHead(exe, root) {
    const res = await runPinned(exe, root, ['rev-parse', '-q', '--verify', 'HEAD'], { stdoutLimit: 4096 })
    if (res.kind === 'ok') return true
    if (res.kind === 'non-zero') return false
    return null
  }

  // 缺文件判据（#858）：DSH fs 服务抛的缺失 code 是 FS_NOT_FOUND、不是 ENOENT，见 ./fsAbsence.js 的头注释。
  let _fsAbsP = null
  let _fsLastError = '' // 文件服务最近一次「不是缺文件」的错误原话（#858：两条路都不通时要把它带给界面）
  function fsAbsence() { if (!_fsAbsP) _fsAbsP = import('./fsAbsence.js'); return _fsAbsP }
  /** 查一个绝对路径在不在（#858 修正形状）：DSH 的 fs 服务是 **stat(target) / lstat(path)**、**没有 exists**——
   *  stat 吃的是 fs.resolve() 给的 target 对象，直接喂路径会抛 TypeError（不是 ENOENT），老写法因此一票否决了
   *  后面本来能给出结论的 lstat，于是「四个标记文件（正常仓库里全都不存在）」这条路必然失败。
   *  现在：先 resolve→stat；拿不到再退路径式的 lstat（缺失回 undefined）；**每个探测各自给结论，一条抛错不许
   *  否决别的探测**；只有所有探测都答不出来才算「查不了」（null）。 */
  async function pathExists(abs) {
    let answered = false
    if (fs && typeof fs.resolve === 'function' && typeof fs.stat === 'function') {
      try { const t = await fs.resolve(abs); const r = await fs.stat(t); if (r) return true; answered = true } catch (e) { if ((await fsAbsence()).isAbsenceError(e)) return false; _fsLastError = String((e && (e.code || e.message)) || e) }
    }
    if (fs && typeof fs.lstat === 'function') {
      try { const r = await fs.lstat(abs); if (r) return true; answered = true } catch (e) { if ((await fsAbsence()).isAbsenceError(e)) return false; _fsLastError = String((e && (e.code || e.message)) || e) }
    }
    if (fs && typeof fs.exists === 'function') {
      try { const r = await fs.exists(abs); if (r === true) return true; answered = true } catch (e) { if ((await fsAbsence()).isAbsenceError(e)) return false; _fsLastError = String((e && (e.code || e.message)) || e) }
    }
    return answered ? false : null
  }
  // 标记探测（#858）搬进 ./runningMarkers.js：本文件 350 行顶格，照 #500/#821 先例做自包含叶子。
  // 叶子只做「文件服务优先、拿不到结论走 git 兜底、两条都不通回 kind='env-fs' 并带文件服务的原话」，
  // git 那条命令由这里注入（叶子不碰 git）。为什么要有兜底：文件服务不可用时原来回 kind='env'，
  // 界面上被读成「找不到 git 程序」——真因不是 git（#858 人验收抓到的真 bug）。
  let _markersP = null
  function markersPhone() { if (!_markersP) _markersP = import('./runningMarkers.js').then(function (m) { return m.createRunningMarkers({ existsViaFs: pathExists, paths: RUNNING_MARKER_PATHS, runProbe: async function (rel, ctx) { const r = await runPinned(ctx.exe, ctx.root, ['rev-parse', '-q', '--verify', rel]); if (r && r.kind === 'ok') return true; if (r && r.kind === 'non-zero' && r.exitCode === 1) return false; return null }, getFsDetail: function () { return _fsLastError } }) }); return _markersP }

  // 依据时间那一段（reflog 取不到时退回引用文件的落盘时间，#819 复审 P0-3）在 ./versionControlBasis.js：
  // 本文件贴着 350 行上限，与差异电话体同一条先例（依赖全显式传入，那个叶子不引用本文件）。
  let _basisP = null
  function basisReader() {
    if (!_basisP) _basisP = import('./versionControlBasis.js').then(function (m) { return m.createBasisReader({ runPinned: runPinned, fs: fs }) })
    return _basisP
  }
  /** 换行配置的事实来源（核心的 autocrlfArgs）；没配过时 git 退出码 1，这里如实记 null。 */
  async function readAutocrlf(exe, root) {
    const res = await runPinned(exe, root, autocrlfArgs(), { stdoutLimit: 4096 })
    if (res.kind !== 'ok') return null
    const v = String(res.stdout).trim()
    return v === '' ? null : v
  }
  /** 首屏：一次把五块采集齐交给核心 assemble 组装；任何一块读不全或读不懂都整体明说失败。 */
  async function readScreen(exe, cwd) {
    const base = await resolveRepoRoot(exe, cwd)
    if (base.ok !== true) return base
    const verRes = await runPinned(exe, base.root, ['--version'], { stdoutLimit: 4096 })
    const badVer = failureFromExec(verRes, '读 git 版本这一步')
    if (badVer) return badVer
    const gitVersion = firstLine(verRes.stdout)
    const tier = tierFor(parseVersion(gitVersion))
    if (tier === 'unsupported') return failPhone('unsupported', '这台机器上的 git 版本太旧（' + gitVersion + '），第一版需要 2.11 以上', { tier: tier, gitVersion: gitVersion })

    if (base.kind === 'bare') {
      // 裸仓库没有工作树：核心只问「有没有提交」，问一次历史就够，读不到就当没有（回包里 bare 是真的）。
      let commits = []
      const lg = await runPinned(exe, base.root, commandFor('log', { logCount: 1 }).args)
      if (lg.kind === 'ok' && !lg.truncated) { const p = parseLog(lg.stdout); if (p.ok) commits = p.commits }
      const bareInput = { repoRoot: base.root, bare: true, statusHead: '', statusDetached: false, statusOid: null, statusUpstream: null, statusAhead: 0, statusBehind: 0, statusEntries: [], worktrees: [], refs: [], commits: commits, diffFiles: [], merging: false, rebasing: false, cherryPicking: false, reverting: false, tier: tier, autocrlf: null, nowMs: Date.now(), basisMs: null }
      const asmBare = assemble(bareInput)
      if (asmBare.ok !== true) return failPhone('parse', '首屏组装失败：' + asmBare.detail)
      return { ok: true, screen: asmBare.screen, tier: tier, gitVersion: gitVersion, worktreesNul: true, readAtMs: Date.now() }
    }

    const st = await collect(exe, base.root, '读工作区改动这一步', commandFor('status', {}).args, parseStatus)
    if (st.ok !== true) return st.envelope
    const status = st.parsed
    const hasHead = status.branch.oid !== null

    // 工作树清单：先用 -z（路径原样输出）；老版本 git 不认这个开关时退回换行形态，并把这次用的是哪一种写进回包。
    let worktreesNul = true
    let wtRes = await runPinned(exe, base.root, commandFor('worktrees', {}).args)
    if (wtRes.kind === 'non-zero') { worktreesNul = false; wtRes = await runPinned(exe, base.root, commandFor('worktrees', { useNulWorktrees: false }).args) }
    const badWt = failureFromExec(wtRes, '读工作树清单这一步')
    if (badWt) return badWt
    if (wtRes.truncated) return failPhone('truncated', '工作树清单读不全，不给半份列表')
    const worktrees = parseWorktrees(wtRes.stdout, worktreesNul)
    if (worktrees.ok !== true) return failPhone('parse', '工作树清单解析失败：' + worktrees.detail)

    const rf = await collect(exe, base.root, '读本地分支这一步', commandFor('refs', {}).args, parseRefs)
    if (rf.ok !== true) return rf.envelope

    // 没有第一次提交时历史与逐文件行数都没有基线：不起这两条进程，按零提交如实组装（核心对零提交有边界）。
    let commits = []
    let diffFiles = []
    if (hasHead) {
      const lg2 = await collect(exe, base.root, '读提交历史这一步', commandFor('log', { logCount: FIRST_SCREEN_LOG_COUNT }).args, parseLog)
      if (lg2.ok !== true) return lg2.envelope
      commits = lg2.parsed.commits
      const df = await collect(exe, base.root, '读每个文件改了行数这一步', commandFor('diffFiles', {}).args, parseDiffFiles)
      if (df.ok !== true) return df.envelope
      diffFiles = df.parsed.files
    }

    const mres = await (await markersPhone()).read(base.gitDir, { exe: exe, root: base.root })
    if (mres.ok !== true) return failPhone(mres.kind === 'env-fs' ? 'env-fs' : 'env', '宿主的文件服务现在用不了（' + String(mres.detail || '没有给出原因') + '），判断不了是不是正在合并或变基；这一项读不到就不给数')
    const markers = mres.markers
    const asm = assemble({
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
  async function handleGitStatus(args) {
    const exe = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    return readScreen(exe, cwdOf(args))
  }

  // 差异电话体（#821 起含「看某一次提交改了什么」）在 ./versionControlFiles.js：本文件贴着 350 行上限，照 logStore→logPhones 惯例搬成自包含叶子，依赖全显式传入、单向引用。
  let _filesP = null
  function diffPhone() { if (!_filesP) _filesP = import('./versionControlFiles.js').then(function (m) { return m.createGitDiffPhone({ failPhone: failPhone, runPinned: runPinned, failureFromExec: failureFromExec, resolveGitExecutable: resolveGitExecutable, resolveRepoRoot: resolveRepoRoot, readHasHead: readHasHead, cwdOf: cwdOf, patchLimit: PATCH_LIMIT }) }); return _filesP }
  async function handleGitDiff(args) { const p = await diffPhone(); return p(args) }

  /** 电话 wf.gitLog 的处理体：历史按批取；多要一条用来判断后面还有没有。 */
  async function handleGitLog(args) {
    const count = clampInt(args && args.count, FIRST_SCREEN_LOG_COUNT, 1, LOG_BATCH_MAX)
    const skip = clampInt(args && args.skip, 0, 0, 1000000)
    const exe = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const base = await resolveRepoRoot(exe, cwdOf(args))
    if (base.ok !== true) return base
    const hasHead = await readHasHead(exe, base.root)
    if (hasHead === null) return failPhone('env', '问不出这个仓库有没有第一次提交，读历史这一步做不了')
    if (hasHead === false) return { ok: true, commits: [], skip: skip, requested: count, returned: 0, hasMore: false }
    const res = await runPinned(exe, base.root, commandFor('log', { logCount: count + 1, logSkip: skip }).args)
    const bad = failureFromExec(res, '读提交历史这一步')
    if (bad) return bad
    if (res.truncated) return failPhone('truncated', '这一批提交历史超过了 ' + Math.round(STDOUT_LIMIT / 1048576) + ' MB，读不全就不给半份列表，请把每批条数调小再取')
    const parsed = parseLog(res.stdout)
    if (parsed.ok !== true) return failPhone('parse', '提交历史解析失败：' + parsed.detail)
    const hasMore = parsed.commits.length > count
    const commits = hasMore ? parsed.commits.slice(0, count) : parsed.commits
    return { ok: true, commits: commits, skip: skip, requested: count, returned: commits.length, hasMore: hasMore }
  }

  /** 入参里的工作目录：给了就用给的，没给用宿主进程当前目录。 */
  function cwdOf(args) { const c = args && args.cwd; return (typeof c === 'string' && c.trim() !== '') ? c : DEFAULT_CWD }

  /** 把一批条数夹进允许范围；给了看不懂的值就用默认值。 */
  function clampInt(v, fallback, min, max) { const n = (typeof v === 'number' && isFinite(v)) ? Math.floor(v) : ((typeof v === 'string' && /^[0-9]+$/.test(v)) ? Number(v) : NaN); if (!isFinite(n)) return fallback; return Math.min(max, Math.max(min, n)) }

  /** 电话体记一行日志：成功落 host.call，失败落 host.call.fail（沿用仓库里既有两个事件，不新增）。 */
  function phoneLog(method, kind, t0, res, err) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorKind: (res && res.error && res.error.kind) || '', errorHash: hash8(String((res && res.error && res.error.message) || 'version-control-not-ok')) }) } catch (eL) {} }

  /** 把一条电话体包成「进出各一行日志」的形状。 */
  function loggedPhone(method, kind, fn) { return async function () { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }

  /** 首屏读数（#841）：写模块的预检要的就是这一份——同一个 readScreen，不另起一套读法。 */
  async function readScreenOf(cwd) { const exe = await resolveGitExecutable(); if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）'); return readScreen(exe, cwd) }

  // 写操作那一族（#841 起 1 预检 + 5 执行，#865 再加更新远方记录 1 条）住另两文件；本文件只做装配与日志包装（动态加载、同层单向，同一出口、同一信封、同一读数、同一 loggedPhone）。
  let _writeP = null
  function writePhone() { if (!_writeP) _writeP = Promise.all([import('./gitCredentialExec.js'), import('./versionControlCheck.js'), import('./versionControlWrite.js')]).then(function (ms) { const sg = ms[0].createCredentialSafeGit({ runGit: runGit, getPlatform: getPlatform, DEFAULT_CWD: DEFAULT_CWD }); const nowFn = (deps && typeof deps.now === 'function') ? deps.now : Date.now; const c = ms[1].createWriteCheck({ vc: { readScreenOf: readScreenOf }, safeGit: sg, failPhone: failPhone, nowMs: nowFn, randomId: function () { return Math.random().toString(36).slice(2) } }); const w = ms[2].createWritePhones({ vc: { readScreenOf: readScreenOf }, safeGit: sg, tickets: c.tickets, results: c.results, nowMs: nowFn }); return { check: loggedPhone('wf.gitWriteCheck', 'git-write-check', c.handleGitWriteCheck), stage: loggedPhone('wf.gitStage', 'git-stage', w.handleGitStage), unstage: loggedPhone('wf.gitUnstage', 'git-unstage', w.handleGitUnstage), commit: loggedPhone('wf.gitCommit', 'git-commit', w.handleGitCommit), pull: loggedPhone('wf.gitPull', 'git-pull', w.handleGitPull), fetch: loggedPhone('wf.gitFetch', 'git-fetch', w.handleGitFetch), push: loggedPhone('wf.gitPush', 'git-push', w.handleGitPush) } }).catch(function (e) { const f = function () { return failPhone('env', '写操作那一族加载失败：' + String((e && e.message) || e)) }; return { check: f, stage: f, unstage: f, commit: f, pull: f, fetch: f, push: f } }); return _writeP }

  return {
    handleGitStatus: loggedPhone('wf.gitStatus', 'git-status', handleGitStatus),
    handleGitDiff: loggedPhone('wf.gitDiff', 'git-diff', handleGitDiff),
    handleGitLog: loggedPhone('wf.gitLog', 'git-log', handleGitLog),
    // 写电话（1 预检 + 6 执行）：第一次调用时才装配，装完缓存；键名与只读那三条同形。
    handleGitWriteCheck: async function (a) { const w = await writePhone(); return w.check(a) },
    handleGitStage: async function (a) { const w = await writePhone(); return w.stage(a) },
    handleGitUnstage: async function (a) { const w = await writePhone(); return w.unstage(a) },
    handleGitCommit: async function (a) { const w = await writePhone(); return w.commit(a) },
    handleGitPull: async function (a) { const w = await writePhone(); return w.pull(a) },
    handleGitFetch: async function (a) { const w = await writePhone(); return w.fetch(a) },
    handleGitPush: async function (a) { const w = await writePhone(); return w.push(a) },
    runGitCommand: runGit, // #839：那一族「可能弹凭据提示」的命令复用同一条进程出口（同一个报闸、同一条 git.exec 日志、同一套字节上限）
  }
}
