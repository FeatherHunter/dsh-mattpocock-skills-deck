// src/refresh/rooms/host/git-execution.ts —— git 本地执行与仓库钥匙（H1 #445 从 host/index.js 496–720 搬出，纯结构、行为零变化；#1429 C8 把 gh 命令执行并入 gh-execution.js，这里只组装、不再拥有 gh）
// 以后谁改它：改外部进程执行（gh/git）、工作区钥匙规整或仓库根与磁盘缓存策略的人。预估约 270 行，超 350 打回。
// 接线：由 index.js 动态 import 动态加载；getPlatform/getWorkspaceStore/setCache/clearWorkspaceStore/namingSweepSoon/parseGithubRepo 显式注入；本文件不引用其他新文件。
// 显式传参编辑：共享状态归 index.js 持有——ghPath/ghLastError 经存取器读写，repoKeys/repoRoots 按引用共享，cache 重赋值改 setCache；resetGhCache 的 _workspaceStore 直访改 clearWorkspaceStore（状态归 platformChannel）。行为与搬前一致。
//
// #723（T19）闸接进取数层：宿主这一层的进程出口（本地 git 探测与仓库缓存由 execProc 出去；gh 出站
// 自 #1453 起随会话走 Tracker 房间，本文件保留 runGh 只为兼容旧装配，仓里已经没有它的调用点），
// 所以**每一笔真实出站都在起进程之前报给闸一次**（gate.noteOutbound）—— 这是不变量 I1「对 GitHub 的每一次
// 调用都必须经过闸」在宿主这一层的落点。闸由接线处（src/host/registerPhones.js）注入，本文件不 import 它
// （同层互引门禁不许），没注入时照旧执行、只是这一笔不在账上（门禁会因此判红，不许静默）。
// 报账单位是**真实出站请求条数**：一条 gh/git/glab 命令就是一条（分页、重试、兜底链由调用方各自再报）。
//
// #1453（规格 1439 第 5 节）：仓库定位分两层——宿主这一份只读本地证据（git remote、.git/config），
// 需要 `gh repo view` 的那一级属于出站，已经从这里删掉；它改由会话的 getRepoKey 能力在开会话之后
// 走 Tracker 操作管线（先裁决、再按后端口径记账），见 src/refresh/rooms/host/session-opener.ts。
// 所以「选哪个后端」这一层永远不会起 gh，也不会花额度。
import { timeoutForGhArgs, isWriteGhArgs } from '../../../tracker/kernel/outbound-tiers.js'
import { getGhLane } from './outbound-admission.js'
import { createGhExecution } from './gh-execution.js'
// #1392：实例销毁时一条外部命令的收尾（还名额、终止子进程、接住 done、建计时器守卫）见 ../shared/command-cleanup/。
import { onceRelease, abandonCommand, startWaitTimeout, DISPOSED_MESSAGE } from '../../../shared/command-cleanup/src/command-cleanup.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { PROC_GRACE_MS } from '../../../shared/time-config/src/values.js'

// ---------------------------------------------------------------------------
// 类型（#1155 类型标注，只写类型不写实现）。
//
// 为什么这么标：
//   1. 本文件是「拿宿主给的东西干活」的一层：subprocess / timer / fs / platform 这些能力全部由接线处注入
//      （见文件头「接线」那段）。形状就按本文件实际用到的部分写下来 —— 多写一条就多一条约束，写少一条
//      下面那几处就读不了。注入的东西缺了、坏了，由运行时的 typeof 判断当掉，类型不替代那些判断。
//   2. 从外面进来的东西（命令参数、报数字段、缓存里读出来的 JSON）按 unknown 或最小形状收，
//      收窄发生在 Array.isArray、typeof 与 JSON.parse 之后的判断里。
// ---------------------------------------------------------------------------

// 运行时的 process 兜底声明：本 tsconfig 有意不加载任何类型包（types 为空），Node 运行时保证 process 存在；
// 只声明本文件实际用到的 cwd（先例见 src/tracker/rooms/markdown/write-queue.ts），不产生运行时代码。
declare const process: { cwd(): string } | undefined

/** 仓库身份：owner 与 name 两个字段，parseGithubRepo 与缓存文件名都只认这两个。 */
interface RepoKey { owner: string; name: string }

/** 文件服务（宿主注入）：resolve 把路径换成服务认的目标对象，读写只认那个目标对象。 */
interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  readText(target: unknown): Promise<string>
  writeText(target: unknown, text: string): Promise<void>
}

/** 平台层（宿主注入）：找可执行文件、用户主目录、路径拼接；env 有没有由调用点自己判断。 */
interface PlatformLike {
  resolveExecutable(name: string): Promise<string | null>
  getHome(): string | Promise<string>
  path: { join(...parts: string[]): string }
  fs: { mkdir?(path: string): Promise<unknown>; resolve(path: string): Promise<unknown> }
  env?: { get(name: string): string | undefined | null }
}

/** 工作区抽屉（宿主注入）：这里只用到 clear。 */
interface WorkspaceStoreLike { clear(): unknown }

/** 检查链退避器（宿主注入）：写成功之后叫它把退避拉回第一档。 */
interface ChainBackoffLike { noteWriteActivity(): unknown }

/** 子进程的一条输出流：readFrom 从字节偏移读起，没内容时给空文本。 */
interface CollectedStream { readFrom(offset: number): { text?: string } }

/** 一条子进程收尾时的事实：退出码，外加「等超时被杀」这类信号。 */
interface SpawnOutcome { exitCode: number; signal?: string }

/** 子进程句柄（宿主注入）：done 收尾时落定，terminate 立刻杀，collected 是两条输出流的读取口。 */
interface SpawnHandle {
  done: Promise<SpawnOutcome>
  terminate(): void
  collected?: { stdout?: CollectedStream; stderr?: CollectedStream }
}

/** 起一条子进程要填的东西：参数数组、工作目录（可缺）、两条流的截断上限、宽限毫秒数。 */
interface SpawnRequest {
  argv: string[]
  cwd?: string
  stdio: { stdin: string; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
  graceMs: number
}

/** 进程执行（宿主注入）：本文件唯一的起进程出口。 */
interface SubprocessLike { spawn(req: SpawnRequest): SpawnHandle }

/** 定时器（宿主注入）：只要一个「等 ms 毫秒再回调」的口子，形状便于与子进程 done 一起 race。 */
interface TimerLike { timeout(ms: number): { then<T>(cb: () => T): Promise<T> } }

/** 闸（不变量 I1）：每一笔真实出站在起进程之前报一次；没有闸就什么都不报（门禁会判红，不许静默）。 */
interface OutboundGateLike { noteOutbound(entry: { requests: number; points: number }): unknown }

/** 宿主日志出口：先问开关再组装字段（字段可以是函数，关着就不求值）。 */
interface LogCtx {
  isEnabled(level: string): boolean
  fire(level: string, event: string, fields: unknown): void
}

/** 通用进程执行的结果：成的那支必须带整数退出码 0（#857），败的那支只保证有错误正文。 */
interface ProcOk { ok: true; text: string; code: number }
interface ProcFail { ok: false; error: string; code?: number }
type ProcResult = ProcOk | ProcFail

/**
 * 接线处注入的整套依赖（src/host/index.ts 一处构造）。可选的三项都是「没有就跳过」的能力：闸可能晚一步
 * 就位（getGate/gate）、清工作区抽屉与检查链退避器都是可选勾子。logCtx 按必给标：第 197/203 行
 * `_execT0 && logCtx.isEnabled(...)` 里 _execT0 非 0 本身就说明第 159 行已确认过它存在（这条由运行时保证）。
 */
interface RepoKeysDeps {
  subprocess: SubprocessLike
  timer: TimerLike
  fs?: FsLike
  DEFAULT_CWD: string
  TIMEOUT_MS: number
  repoKeys: Record<string, RepoKey>
  repoRoots: Record<string, string | undefined>
  getGhPath: () => string | null
  setGhPath: (value: string | null) => unknown
  getGhLastError: () => string | null
  setGhLastError: (value: string | null) => unknown
  getPlatform: () => Promise<PlatformLike>
  getWorkspaceStore: () => Promise<WorkspaceStoreLike>
  setCache: (value: { ts: number; snapshot: unknown; error: unknown; cwd: string }) => unknown
  clearWorkspaceStore?: () => unknown
  namingSweepSoon: (ms: number) => unknown
  getChainBackoff?: () => Promise<ChainBackoffLike | null | undefined>
  parseGithubRepo: (text: string) => RepoKey | null
  logCtx: LogCtx
  gate?: OutboundGateLike | null
  getGate?: () => OutboundGateLike | null | undefined
}

/** 工作区钥匙模块（动态 import 进来的 .js）：本文件只按这两条读法用它，别的导出不管。 */
type WorkspaceKeyModule = typeof import('../../../host/workspaceKey.js')

export function createRepoKeys(deps: RepoKeysDeps) {
  const { subprocess, timer, fs, DEFAULT_CWD, TIMEOUT_MS, repoKeys, repoRoots, getGhPath, setGhPath, getGhLastError, setGhLastError, getPlatform, getWorkspaceStore, setCache, clearWorkspaceStore, namingSweepSoon, getChainBackoff, parseGithubRepo, logCtx, gate, getGate } = deps
  // #1429（C8/gh 拆分）：gh 执行体已并入 gh-execution.ts，这里只做组装——gh 专属依赖连同
  // 三个共享小件（reportOutbound、hash8、canonicalKey，两边共用、只许有一份）一起传过去；
  // 出去的 resolveGh/resetGhCache/runGh 三个字段名与原来一字不差，老调用方不用改。
  const _gh = createGhExecution({ subprocess, timer, DEFAULT_CWD, getGhPath, setGhPath, getGhLastError, setGhLastError, getPlatform, getWorkspaceStore, clearWorkspaceStore, setCache, namingSweepSoon, getChainBackoff, logCtx, reportOutbound, hash8, canonicalKey })
  const { resolveGh, resetGhCache, runGh } = _gh
  // 共享状态归 index.js 单一持有：ghPath/ghLastError 经存取器（基本类型重赋值不能按引用共享）；repoKeys/repoRoots 按引用共享（只做属性读写与删除，从不整体重赋值）。
  // #491 房外埋点 helpers：hash8 只记散列不记原文；P1 事件外层先判开关再组装字段（字段函数只在守卫通过后求值）。
  function hash8(s: unknown) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  // #606 命令名只留程序名：调用方通常给的是 'git' 这种裸名字，但若给了带目录的完整路径，
  //   这里也把目录部分去掉，保证日志里永远不会出现一条文件系统路径。
  function progName(cmd: unknown) { try { return String(cmd || '').split(/[\\/]/).pop() || '' } catch (e) { return '' } }
  let lastNormKind = ''
  let lastCanonOut = ''

  /** 这一笔真实出站报给闸（I1）。闸没接上时什么都不做——但那正是门禁要判红的现场，不许静默假装记过账。
   *  #927：闸可能比这一层晚一步就位（刷新接线要到插件起步时才建好），所以每次报账现问一次，
   *  拿到就用、还没有就什么都不做。写成一次性快照的话，先建好的那一路会永远拿不到闸。 */
  function gateOf() {
    let g = null
    try { g = (typeof getGate === 'function') ? getGate() : gate } catch (e) { g = null }
    return (g && typeof g.noteOutbound === 'function') ? g : null
  }
  function reportOutbound(args?: string[]) {
    try {
      const g = gateOf()
      if (!g) return
      // GraphQL 那一桶按点数计（一条 gh api graphql 命令算一点），REST 那一桶按请求条数计，两桶互不折算。
      const isGraphql = (String(args && args[0]) === 'api' && String(args && args[1] || '').indexOf('graphql') >= 0)
      g.noteOutbound({ requests: 1, points: isGraphql ? 1 : 0 })
    } catch (e) { /* 报账失败不许影响已经起来的这一条命令 */ }
  }

    // 通用进程执行（#344 前置检查用：git / cmd 等，不经 shell，错误不归一化）
    // #606 补测点：少数自建操作上下文（评论读取、单票详情、初始化与推送）的 ctx.exec 直连这里，
    //   不走 platformChannel 的 detectionExec。同一个事件 exec.run、同一套字段，两条路互斥，
    //   所以每条外部命令只落一行，两次相加就是「经 ctx.exec 起过多少次」。调试开关关着时只读一次开关就返回。
    // 第三个参数 via 是「这条命令由哪条链起的」：调用方把链名传进来，日志只记这个固定名字。
    async function execProc(argv: string[], cwd?: string, via?: string): Promise<ProcResult> {
      // 起始时刻只在开关打开时才取：关着时这一行读一个布尔就结束，连时钟都不读，后面两行自然也不落。
      const _execT0 = (logCtx && logCtx.isEnabled('debug')) ? Date.now() : 0
      // #963 出站同一口径：gh / glab 进准入（git 是本地命令不进）；gh 默认超时按读写探活分档。
      const xpProg = progName(argv && argv[0])
      const xpIsGh = /^gh(\.exe)?$/i.test(xpProg)
      const xpIsGlab = /^glab(\.exe)?$/i.test(xpProg)
      const xpIsOutbound = xpIsGh || xpIsGlab
      const xpArgs = Array.isArray(argv) ? argv.slice(1) : []
      const xpBucket = (xpIsGh && isWriteGhArgs(xpArgs)) ? 'write' : 'read'
      // 出站才拿名额（不传取消信号，拿不到只会等不会抛）；git 本地命令直行。
      let xpRelease = null
      // #1392：归还包成幂等，下面每条退出路径都调 xpReleaseSlot()；git 本地命令没有名额，它是空转。
      if (xpIsOutbound) xpRelease = await getGhLane().acquire({ bucket: xpBucket })
      const xpReleaseSlot = onceRelease(xpRelease)
      // #723（T19）：这一笔真实出站先报给闸（I1）。这条路的调用方是 git / glab / gh 三条，
      // 其中 gh 与 glab 是真实出站；git 只读远端地址、不起 HTTP 请求，但它是同一个进程出口，
      // 一起报能保证「起过几条命令」与账上的条数一一对应（宁可多记一笔，也不要漏一笔）。
      reportOutbound(argv)
      let handle
      try {
        handle = subprocess.spawn({
          argv: argv,
          // 这条通道也跑与工作区无关的命令（版本探测、凭据检查）：没给目录就交给宿主默认落点，
          // 但**不写「回退兜底值」那种死写法**——兜底值已是空串，写成回退只会让后人以为这里有工作区。
          cwd: cwd || undefined,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: PROC_GRACE_MS,
        })
      } catch (e) {
        xpReleaseSlot()
        return { ok: false, error: String((e && (e as { message?: unknown }).message) || e) }
      }
      // #969：gh 等待上限按分档暂定值；git / glab 沿用旧默认。
      // #1392：同 runGh —— 实例销毁后建计时器会同步抛 INACTIVE_EFFECT；startWaitTimeout 收完尾返回 null。
      const to = startWaitTimeout(timer, xpIsGh ? timeoutForGhArgs(xpArgs) : TIMEOUT_MS, function () { abandonCommand(handle, xpReleaseSlot) })
      if (!to) {
        try { if (_execT0 && logCtx.isEnabled('debug')) logCtx.fire('debug', 'exec.run', { argv0: progName(argv && argv[0]), cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - _execT0, exitCode: -1, via: String(via || 'unspecified') }) } catch (eL) {}
        return { ok: false, error: DISPOSED_MESSAGE }
      }
      let outcome
      try {
        outcome = await Promise.race([
          handle.done,
          to.then(function () { handle.terminate(); return { exitCode: -1, signal: 'timeout' } }),
        ])
      } catch (e) {
        // #1392：计时器建出来之后实例才被销毁，它被撤销时 Promise 以拒绝落定，race 跟着拒绝。
        //   收尾与销毁那一档相同；失败对象保持原形状（没有 kind），不把这一路单独分类。
        abandonCommand(handle, xpReleaseSlot)
        try { if (_execT0 && logCtx.isEnabled('debug')) logCtx.fire('debug', 'exec.run', { argv0: progName(argv && argv[0]), cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - _execT0, exitCode: -1, via: String(via || 'unspecified') }) } catch (eL) {}
        return { ok: false, error: String((e && (e as { message?: unknown }).message) || e) }
      }
      const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0) : { text: '' }
      const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0) : { text: '' }
      try { if (_execT0 && logCtx.isEnabled('debug')) logCtx.fire('debug', 'exec.run', { argv0: progName(argv && argv[0]), cwdHash: hash8(cwd || DEFAULT_CWD), latencyMs: Date.now() - _execT0, exitCode: (outcome && typeof outcome.exitCode === 'number') ? outcome.exitCode : -1, via: String(via || 'unspecified') }) } catch (eL) {}
      xpReleaseSlot()
      if (outcome.exitCode !== 0) return { ok: false, code: outcome.exitCode, error: ((err.text || '') + (out.text || '')).slice(0, 400) }
      // #857：成功必须带整数退出码 0。调用方经 ctx.exec 转给 GitHub 命令执行器时，那边按“拿不到整数退出码就判失败”处理；缺了这个 0，评论写成功了面板也会报失败。
      return { ok: true, text: out.text || '', code: 0 }
    }

    async function resolveGit() {
      const platform = await getPlatform()
      return platform.resolveExecutable('git')
    }

    // 用户主目录（#171 已迁 platform.getHome；原 cmd.exe 探测仅 win32 生效，现平台层统一）
    async function getHome() {
      const platform = await getPlatform()
      return platform.getHome()
    }

    // ============ 规整工作区钥匙（地图 #278 A 方案 · #279 落地）============
    // 同一工作区经会话快照不同字段上报时写法可能不同（盘符大小写/尾斜杠/斜杠方向）。
    // 按工作区分桶的抽屉（repoKeys/repoRoots/chainCache/workspaceStore/快照单槽）统一在
    // 读写删三侧使用 canonicalWorkspaceKey 洗出的规整钥匙——读写删同形，失效删除才删得中。
    // 绝对路径（主流形态）在洗衣机内部短路，零 fs 调用；异常时回退原串（读写删仍同形）。
    let _workspaceKeyMod: WorkspaceKeyModule | null = null
    async function canonicalKey(raw?: string) {
      try {
        if (!_workspaceKeyMod) _workspaceKeyMod = await import('../../../host/workspaceKey.js')
        const m = _workspaceKeyMod
        const fn = m.canonicalWorkspaceKey || (m.default && m.default.canonicalWorkspaceKey)
        if (typeof fn !== 'function') { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'workspaceKey.canonical', function () { return { rawHash: hash8(raw), normalizedHash: hash8(raw), fallback: true } }) } catch (eL) {}; return raw }
        const canonOut = await fn(raw, { getPlatform, getFs: () => fs, getDefaultCwd: () => DEFAULT_CWD, logCtx: logCtx })
        try { const fb = String(canonOut) === String(raw); if (logCtx && logCtx.isEnabled('debug') && (fb || canonOut !== lastCanonOut)) { lastCanonOut = canonOut; logCtx.fire('debug', 'workspaceKey.canonical', function () { return { rawHash: hash8(raw), normalizedHash: hash8(canonOut), fallback: fb } }) } } catch (eL) {}
        return canonOut
      } catch (e) { try { if (logCtx && logCtx.isEnabled('debug')) logCtx.fire('debug', 'workspaceKey.canonical', function () { return { rawHash: hash8(raw), normalizedHash: hash8(raw), fallback: true } }) } catch (eL) {}; return raw }
    }

    // ============ v1.5 T9：git 根检测 + 磁盘缓存（跨重启秒开）============
    // git rev-parse --show-toplevel 层层上溯找根；嵌套仓库（子目录含独立 .git）git 原生停在最近根 —— 符合用户要求
    // #652 补一句：工作区根（哪条目录算这个会话的工作区）不在这里算，在 workspaceKey.js 的 resolveWorkspaceRoot
    //   里按「自带 .git 或自带主锚文件」两个标记判定；这里只答「这个 git 仓库的根在哪」，仅供展示与取远端用。
    // repoRoots 由 index.js 按引用共享（建仓失效删裸变量）；cacheDirResolved 本文件自有。
    let cacheDirResolved: string | null = null  // 缓存目录（惰性解析）
    async function getRepoRoot(cwd?: string) {
      const key = await canonicalKey(cwd || DEFAULT_CWD)
      if (repoRoots[key] !== undefined) return repoRoots[key]
      // #652 顺手修掉的老毛病：旧写法先把 null 写进缓存再读它，等于把「一次临时失败」（git 没起来、
      //   命令超时、这一刻还不是仓库）永久记成空，之后环境修好也再问不出来。现在只有真拿到根才写缓存，
      //   拿不到就当这一次的结论返回（与相邻的 getRepoKey 同纪律：失败不进缓存）。
      let root = null
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', key, 'rev-parse', '--show-toplevel'], key, 'repo-root')
        const txt = r.ok ? r.text.trim() : ''
        if (txt && !/fatal/i.test(txt)) { root = txt; repoRoots[key] = txt }
      }
      return root
    }
    // 缓存目录：<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/（T9 修复：fs 沙箱 workspace-write 只允许 cwd 下，
    //   ~/.dsh 在沙箱外被拒 → 缓存永不写入；改用 process.cwd() 落点，跨重启秒开；v1.6.17 更名 waystation → MattSkillsDeck）
    async function getCacheDir() {
      if (cacheDirResolved) return cacheDirResolved
      const platform = await getPlatform()
      const cwd0 = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : DEFAULT_CWD
      if (!cwd0) return null
      cacheDirResolved = platform.path.join(cwd0, '.dsh-mattskillsdeck-cache')
      try { const pfs = platform.fs; if (pfs !== undefined && typeof pfs.mkdir === 'function') await pfs.mkdir(cacheDirResolved) } catch (e) { /* 已存在或不可建，writeText 会自建 */ }
      return cacheDirResolved
    }
    function cacheFileName(repo?: RepoKey | null) {
      return (repo && repo.owner && repo.name) ? repo.owner + '__' + repo.name + '.json' : null
    }
    async function readDiskCache(repo?: RepoKey | null) {
      try {
        if (fs === undefined || typeof fs.readText !== 'function' || typeof fs.resolve !== 'function') return null
        const dir = await getCacheDir(); if (!dir) return null
        const fn = cacheFileName(repo); if (!fn) return null
        const p = await fs.resolve(fn, { cwd: dir })
        const txt = await fs.readText(p)
        if (!txt) return null
        const j = JSON.parse(txt)
        // cacheFormat 3 之后才可读（2→3：1.7.5 新增 map 五区块解析；旧快照缺 decisions/fog/outOfScope,destination,notes，
        // 视为陈旧强制重建，详情页不再抛且区块可展示；沿用 #327 的小写 state 防御）
        if (j && j.ok === true && Array.isArray(j.maps) && typeof j.generatedMs === 'number' && j.cacheFormat === 3) return j
        return null
      } catch (e) { return null }
    }
    async function writeDiskCache(repo: RepoKey | null | undefined, snap: unknown) {
      try {
        if (fs === undefined || typeof fs.writeText !== 'function' || typeof fs.resolve !== 'function') return
        const dir = await getCacheDir(); if (!dir) return
        const fn = cacheFileName(repo); if (!fn) return
        // T9 修复：fs 服务的 writeText 要求 resolve() 返回的 target 对象（{targetKey,displayPath}），不能直接传路径字符串
        const platform = await getPlatform()
        const t = await platform.fs.resolve(platform.path.join(dir, fn))
        // 缓存格式版本 3：1.7.5 map 五区块（见上），旧格式一律视为不新鲜
        await fs.writeText(t, JSON.stringify(Object.assign({}, snap, { cacheFormat: 3 })))
      } catch (e) { /* 写失败不影响主流程 */ }
    }

    async function getRepoKey(cwd?: string) {
      const rkT0 = Date.now()
      const key = await canonicalKey(cwd || DEFAULT_CWD)
      if (repoKeys[key]) return repoKeys[key]
      // v1.5 T11（map#37 · #38 R1 + #40 R2 输入）：
      //   多远程下 gh 必选 upstream（context/remote.go::remoteNameSortScore upstream(3)>github(2)>origin(1)），
      //   无参 `gh repo view` 永远返回原作者。改为：显式 `git remote get-url origin` + parseGithubRepo 首选，
      //   失败再 .git/config 直读；两级都是本地证据，不起进程（gh 那一级见文件头 #1453 那一段）。
      const root = await getRepoRoot(key)
      const execCwd = root || key
      // Tier 1：git remote get-url origin + parseGithubRepo（SSH/HTTPS 都由 parseRegex 覆盖）
      const git = await resolveGit()
      if (git) {
        const r = await execProc([git, '-C', execCwd, 'remote', 'get-url', 'origin'], execCwd, 'repo-key')
        if (r.ok) {
          const k = parseGithubRepo(r.text)
          if (k) { repoKeys[key] = k; try { if (logCtx) logCtx.fire('info', 'repo.resolve.tier', { tier: 1, ok: true, latencyMs: Date.now() - rkT0 }) } catch (eL) {}; return k }
        }
      }
      // Tier 2：.git/config 直读 origin（git 二进制不可用 / `remote get-url` 失败时）
      if (fs !== undefined) {
        try {
          const t = await fs.resolve('.git/config', { cwd: execCwd })
          const txt = await fs.readText(t)
          const um = txt.match(/\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/)
          if (um) {
            const k = parseGithubRepo(um[1])
            if (k) { repoKeys[key] = k; try { if (logCtx) logCtx.fire('info', 'repo.resolve.tier', { tier: 2, ok: true, latencyMs: Date.now() - rkT0 }) } catch (eL) {}; return k }
          }
        } catch (e) { /* 落 Tier 3 */ }
      }
      // 两级本地证据都没答上来：如实回 null（#1453）。这里不再退到 gh repo view——那一级是出站，
      // 会花额度，必须放在会话建立之后、由会话的 getRepoKey 能力过裁决与记账（规格 1439 第 5 节）。
      // 调用方按 null 走降级；需要 GitHub 仓库身份的地方会先去开会话，由会话补出 refId。
      // 这里不另记一行日志：本地证据读不到是正常结局（不是出站失败），而会话那一侧的房间
      // 会把它自己的 tier 结果记进 repo.resolve.tier，排查时看那一条更准。
      return null
    }
  // #723（T19）：TIMEOUT_MS 一并交出去，供还读它的老调用方兜底；分档由出站两路按命令认，不再两处各写一份。
  return { resolveGh, resetGhCache, runGh, execProc, resolveGit, getHome, canonicalKey, getRepoRoot, getCacheDir, cacheFileName, readDiskCache, writeDiskCache, getRepoKey, TIMEOUT_MS }
}
