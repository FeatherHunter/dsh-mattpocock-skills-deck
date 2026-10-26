// src/host/platformChannel.ts —— 平台与探测通道（H1 #445 从 host/index.js 259–491 搬出，纯结构、行为零变化）
// 2026-10-14（#1161）从 .js 转成 .ts：只加类型标注与注释，逻辑一行未动。
// 以后谁改它：改平台抽象、后端注册表或探测级联的人。预估约 280 行，超 350 打回。
// 接线：由 index.ts 动态 import 动态加载；STATUS_CACHE_MS 随本文件搬入（无外部引用）；getMattSkillProbeNames/probeSkill 显式注入；共享层只引用 src/shared（出站分档/准入/测量，#963）。本文件不引用其他宿主新文件。
// #968 技能按需多一个显式注入 getChainSkillNames（链条目录里要的三项技能名，查链时只问这三项）。
// #1161：内置房间清单从前写在本文件里（三段 try 各 import 一间房），现在只认装配点
//   src/tracker/registry/builtins.ts —— 宿主侧不再认识任何具体房间（规则 rooms-imported-only-by-assembly）。
import type { HostTimerService } from '../refresh/contract/host-timer-ports.js'
import { timeoutForGhArgs, isWriteGhArgs, ghCommandLabel, reportGhOutbound, noteGhGraphqlCorrection, ghCooldownReply, reportGhSpawnFailure, reportGhOutcome } from '../tracker/kernel/outbound-tiers.js'
// #1007：这一层的 gh 出站结局上报与冷却回话都走 tracker/kernel/outbound-tiers.ts（界面口径、日志口径与宿主两路共用一份）。
import { getGhLane } from '../refresh/rooms/host/outbound-admission.js'
// #1159：给房间的那份后端上下文要挂上出站控制面（实现见 outbound-control.ts，只做转发）。
import { createOutboundControl } from '../refresh/rooms/host/outbound-control.js'
// #1115：宿主计时器服务交回的是可调用的撤销器（不是数字句柄、也没有 dispose 方法），
//   撤销的三档判据收在共享层一处；本文件两处 timers 口都只用它，不再各写一遍。
import { hostTimers } from '../refresh/contract/host-timer-ports.js'
// 时间参数住中央 YAML：PROC_GRACE_MS 是单次等待上限，住 config/timeouts.yaml；STATUS_CACHE_MS 是有效期，住 config/ttl.yaml。调时间改对应的那一份。
import { STATUS_CACHE_MS, PROC_GRACE_MS } from '../shared/time-config/src/values.js'

// ---------------------------------------------------------------------------
// 类型（#1161 类型标注，只写类型不写实现）。
//
// 为什么这么标：
//   1. 注入进来的能力（ctx / subprocess / timer / probeSkill / logCtx）按本文件实际用到的部分写成最小
//      接口：多写一条就多一条约束，写少一条下面那几处就读不了。注入的东西缺了、坏了，由运行时的 typeof
//      判断当掉（ctx.get('platform') 可能什么都没有，就是靠 typeof 挡的），类型不替代那些判断。
//   2. 动态装配出来的服务（注册表 / 平台 / 工作区缓存 / 探测服务）各写一份最小接口，形状由产出它们的
//      那份文件定义，这里只声明用到的成员；跨不过去的地方用一次 as 收窄，运行时行为一字不变。
//   3. 从外面进来的东西（命令参数、探测结果、注册表事件）按 unknown 或最小形状收。
// ---------------------------------------------------------------------------

/** 日志出口（宿主注入）：fire 落一行，isEnabled 决定要不要落。 */
interface LogCtx { fire(level: string, event: string, fields?: unknown): void; isEnabled(level: string): boolean }
/** 出站闸（宿主注入）：闸可能比本通道晚一步就位，所以每次现问一次（见 gateOf）。 */
interface OutboundGate {
  noteOutbound(fields: { requests: number; points: number }): void
  /** 事后补报差额（#1482）：GraphQL 拿到回包里的真实点数后，把比 1 点大的部分补进闸；闸没这一口时跳过。 */
  noteOutboundCorrection?(fields: { requests: number; points: number }): void
}
/** 子进程句柄（宿主 subprocess.spawn 的产出）：本文件用到终止、完成承诺与两段收集缓冲。 */
interface SpawnHandle {
  terminate(): void
  done: Promise<ExecOutcome>
  collected?: { stdout?: ByteSink; stderr?: ByteSink }
}
/** 子进程收集缓冲：按起始下标读出到此刻为止的文本。 */
interface ByteSink { readFrom(from: number): { text: string } }
/** 一次外部命令的收尾结果（正常退出、超时、取消三条路都会给出它）。 */
interface ExecOutcome { exitCode?: number; signal?: string }
/** detectionExec 的选项：工作区目录、超时、取消信号（缺了就走缺省）。 */
interface ExecOpts { cwd?: string; timeout?: number; signal?: AbortSignal | null }
/** 技能探测单项结果（宿主注入的 probeSkill 的产出，本文件只读这几个字段）。 */
interface SkillProbe { ok?: boolean; level?: string; detail?: string; hint?: string; error?: string }
/** 技能探测批量结果（探测服务要的形状）。 */
interface SkillProbeBatch { ok: boolean; missing: string[]; probes: Record<string, SkillProbe>; hasPending: boolean; pendingError: unknown; pending: boolean }
/** 工作区句柄（探测级联的输入，形状由契约层定义）。 */
interface WorkspaceHandle { cwd?: string; refId?: string }
/** 注册表（src/tracker/registry/core.ts 的产出）：本文件只用到注册、选择、卸载通知三个成员。 */
interface TrackerRegistry {
  register(mod: unknown): unknown
  select(handle: WorkspaceHandle, ctx: unknown): Promise<unknown>
  on(event: string, fn: (evt: { id?: string }) => void): unknown
}
/** 工作区选择结果的缓存（src/tracker/detection/workspaceStore.ts 的产出）：本文件只用到这几个成员。 */
interface WorkspaceStore {
  get(handle: WorkspaceHandle): unknown
  set(...a: unknown[]): unknown
  has(handle: WorkspaceHandle): boolean
  clear(): unknown
  invalidate(handle: WorkspaceHandle): unknown
  invalidateByBackend(id: string): unknown
  keys(): string[]
  onRegistryBindStale(...a: unknown[]): unknown
}
/** 探测级联服务（src/tracker/detection/detectionService.ts 的产出）：本文件只把它交给接线处。 */
interface DetectionService { detect(handle: WorkspaceHandle, opts?: unknown): Promise<unknown> }
/** 平台服务（src/host/platform/index.js 的产出，或本文件内联兜底造出来的那一份）。 */
interface PlatformService {
  os: string
  getHome(): Promise<string | null>
  path: PlatformPath
  resolveExecutable(name: string): Promise<string | null>
  fs?: unknown
  env: { get(key: string): string | undefined; has(key: string): boolean }
}
/** 路径工具（node:path 的适配面；joinHome 是平台层补的那一件）。 */
interface PlatformPath {
  join(...segs: string[]): string
  sep: string
  dirname(p: string): string
  basename(p: string): string
  resolve(...segs: string[]): string
  normalize(p: string): string
  isAbsolute(p: string): boolean
  relative(a: string, b: string): string
  joinHome(...segs: string[]): Promise<string>
}
/** node:path 模块（或 D7 兜底里手写的那份替身）：本文件只用到 posix / win32 两套实现。 */
interface PathModule { posix: Omit<PlatformPath, 'joinHome'>; win32: Omit<PlatformPath, 'joinHome'> }
/** node:os 模块（或兜底替身）：只用 homedir 与 platform。 */
interface OsModule { homedir(): string; platform(): string }
/** 决策函数的装配结果（#1003 单出口）。 */
interface DecisionFnModule { decideBackend: ((...a: unknown[]) => unknown) | null }
/** 宿主侧那份「人选的后端」记忆（src/host/choiceStore.ts 的产出）：本文件只把它原样转交给接线处。 */
type ChoiceStore = Awaited<ReturnType<typeof import('./choiceStore.js')['createChoiceStoreForHost']>>

/** 接线处注入的依赖。 */
interface Deps {
  ctx: { get(key: string): unknown; set?(key: string, value: unknown): unknown }
  subprocess: { spawn(opts: { argv: string[]; cwd: string; stdio: unknown; graceMs: number }): SpawnHandle }
  timer: HostTimerService
  fs?: unknown
  DEFAULT_CWD: string
  TIMEOUT_MS: number
  getMattSkillProbeNames(): Promise<string[]> | string[]
  getChainSkillNames?(): Promise<string[] | null> | string[] | null
  probeSkill(name: string, lang: string, cwd: string, opts: { force: boolean }): Promise<SkillProbe>
  logCtx?: LogCtx | null
  gate?: unknown
  getGate?(): unknown
}

// 运行时的 process 声明（与 src/refresh/rooms/host/git-execution.ts:28 同形）：本文件只在「平台适配器造不出来」的
// 最后一道兜底里读它，且都按「可能不存在」写（见 nodeOs 兜底与 envSrc）。
declare const process: { env?: Record<string, string | undefined>; platform?: string } | undefined

/**
 * 按探测范围挑选本轮要探测的技能名单（#968 平时问三项、重查问全量的分流判据，纯函数，门禁直测它）。
 *
 * 为什么：日常检查链只需要确认链条里的三项核心技能是否在场，每次都把全套技能挨个探测一遍会白白浪费子进程与文件读取；只有用户主动要求全量重查或范围未知时才需要全量名单。
 * 什么约定不能改：
 *   1. 只有 `scope === 'chain'` 且 `chainNames` 是非空数组时才返回 `chainNames` 的浅拷贝；其余任何取值（包括 `'all'`、空值、未传或 `chainNames` 为空）一律退回 `allNames` 的浅拷贝，宁可多问绝不漏判。
 *   2. 返回值必须是新数组拷贝，调用方在结果上增删元素不能污染传入的原数组；任何异常输入都兜底返回空数组 `[]`，不向外抛错。
 * 反例：`selectSkillProbeNames(['wayfinder', 'grilling'], [], 'chain')` 传入空的链条名单时，若直接返回空数组 `[]`，会导致检查链误以为无需探测任何技能而假绿；正确行为是退回全量名单 `['wayfinder', 'grilling']`。
 */
export function selectSkillProbeNames(allNames: unknown, chainNames: unknown, scope: unknown): string[] {
  try {
    if (String(scope || '') === 'chain' && Array.isArray(chainNames) && chainNames.length) return chainNames.slice()
  } catch {}
  try { return ((allNames || []) as string[]).slice() } catch { return [] }
}

/**
 * 组装宿主侧的平台抽象、后端注册表、工作区探测缓存、本机选择记忆与统一判定出口（#445 / #683 / #1003 / #1161）。
 *
 * 为什么：宿主入口、快照构建、检查链和工作区绑定都需要同一份平台适配器、同一个后端注册表单例和同一条本机记忆读改写队列；集中在这里懒加载并缓存 Promise，能保证全进程共享同一份实例且只经 `src/tracker/registry/builtins.ts` 装配点接触具体后端房间。
 * 什么约定不能改：
 *   1. `getTrackerRegistry`、`getPlatform`、`getWorkspaceStore`、`getChoiceStore`、`getDecisionFn` 全部采用首次调用懒初始化并复用同一个 Promise，并发调用绝不能建出两份注册表或两条本机记忆队列。
 *   2. `detectionExec` 执行外部命令时必须先经出站名额闸与并发通道（`getGhLane`），并在调试开关打开时记录 `exec.run`（只记命令程序名与工作区八位短指纹，绝不把完整路径或参数原文写进日志）。
 *   3. 本文件只能经装配点 `../tracker/registry/builtins.js` 登记内置后端房间，不得直接引用任何 `src/tracker/rooms/*` 内部实现。
 * 反例：若在 `workspaceCwd.ts` 和 `platformChannel.ts` 里各自调用 `createChoiceStoreForHost` 新建本机记忆实例，两个窗口同时切换后端时就会绕开单队列串行化，后写的一方直接覆盖先写一方的 `~/.dsh/mattskillsdeck/choices.json`。
 */
export function createPlatformChannel(deps: Deps) {
  const { ctx, subprocess, timer, fs, DEFAULT_CWD, TIMEOUT_MS, getMattSkillProbeNames, getChainSkillNames, probeSkill, logCtx, gate, getGate } = deps
  // #494 O1：旧文本通道退役——backend.diagnostic 不再产生（github 房内零调用；残留 ctx.log.* 调用自动静默，gitlab 房由本房 O 票另行结构化）。房内埋点只走 logEvent/isEnabled。
  // #927：闸可能比本通道晚一步就位（刷新接线要到插件起步时才建好），所以每次报账现问一次：
  // 拿到就用，还没有就什么都不做。写成一次性快照的话，先建好的那一路会永远拿不到闸。
  function gateOf(): OutboundGate | null {
    let g: unknown = null
    try { g = (typeof getGate === 'function') ? getGate() : gate } catch (e) { g = null }
    return (g && typeof (g as OutboundGate).noteOutbound === 'function') ? (g as OutboundGate) : null
  }
  const backendLogCtx: LogCtx | null = (logCtx && typeof logCtx.fire === 'function') ? logCtx : null
  function backendLogEvent(level: string, event: string, fields?: unknown): void { try { if (backendLogCtx) backendLogCtx.fire(level, event, fields) } catch (e) {} }
  function backendLogEnabled(level: string): boolean { try { return backendLogCtx ? backendLogCtx.isEnabled(level) : (level === 'error' || level === 'warn') } catch (e) { return level === 'error' || level === 'warn' } }
  // #1159：出站控制面（名额闸 / 取消判定 / 搭车账本）是进程级能力，随这份后端上下文注入一次。
  // 房间只认契约形状（src/tracker/contract/outbound.ts），不再从宿主 import；这一处与
  // src/refresh/rooms/host/refresh-runtime.js 的 backendObj 是两处注入点，缺一处那条路上的房间会按环境失败。
  const backendCtxForRooms = { logEvent: backendLogEvent, isEnabled: backendLogEnabled, outbound: createOutboundControl() }
  // #606 房外埋点 helper：工作区只记短指纹，不记原始路径。
  function hash8(s: unknown): string { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch { return '00000000' } }
  // #606 命令名只留程序名：调用方通常给的是 'gh' / 'git' 这种裸名字，但若给了带目录的完整路径，
  //   这里也把目录部分去掉，保证日志里永远不会出现一条文件系统路径。
  function progName(cmd: unknown): string { try { return String(cmd || '').split(/[\\/]/).pop() || '' } catch { return '' } }
    // ============ Tracker Registry（#155 · 后端选择 UI）============
    let _trackerRegistry: TrackerRegistry | null = null
    let _trackerRegistryInit: Promise<TrackerRegistry | null> | null = null
    async function getTrackerRegistry(): Promise<TrackerRegistry | null> {
      if (_trackerRegistry) return _trackerRegistry
      if (_trackerRegistryInit) return _trackerRegistryInit
      _trackerRegistryInit = (async () => {
        try {
          const injected = ctx.get('trackerRegistry') as TrackerRegistry | null | undefined
          if (injected && typeof injected.select === 'function') { _trackerRegistry = injected; return _trackerRegistry }
        } catch {}
        try {
          const regMod = await import('../tracker/registry/core.js') // V1 #461：registry.js 已拆为三块，装配入口为 core.ts
          const createRegistry = (regMod.createRegistry || (regMod as { default?: unknown }).default) as (ctx: unknown) => TrackerRegistry
          // #1109：这里**不许**自带等待值（从前写死 3000）。选后端的兜底等待只有一个出处：
          //   src/tracker/registry/core.ts 的缺省值（缺省 30 秒，见那份文件里的 MATCHES_TIMEOUT_MS）。
          //   两处各写各的，就会出现「改了一处、另一处照旧」。门禁见 tests/verify-1109-matches-timeout.ts。
          const reg = createRegistry(backendCtxForRooms)
          // 注册内置后端（github → markdown → gitlab，顺序见装配点）：「有哪几个内置房间」的唯一出处是装配点
          //   src/tracker/registry/builtins.ts（#1161）。这里只消费装配结果，不再认识任何具体房间。
          //   逐间加载失败已在装配点里吞掉（一间房坏掉不拖累其余两间），注册失败照旧忽略以保持可用。
          //   #230（D10）那条教训（markdown 必须整份注册，否则 setupPrompt 丢失）已写进装配点，别再搬回来。
          const builtinsMod = await import('../tracker/registry/builtins.js')
          const builtinModules = await builtinsMod.loadBuiltinBackendModules()
          for (const m of builtinModules) try { reg.register(m) } catch {}
          _trackerRegistry = reg
          try { ctx.set && ctx.set('trackerRegistry', reg) } catch {}
          return reg
        } catch (e) {
          // 回落：空 registry（仅 explicit 能力）
          try {
            const regMod2 = await import('../tracker/registry/core.js') // V1 #461：同上（回落分支）
            const cr = (regMod2.createRegistry || (regMod2 as { default?: unknown }).default) as (ctx: unknown) => TrackerRegistry
            // #1109：回落分支同样不许自带等待值，理由与上面那一处逐字相同（唯一出处 = src/tracker/registry/core.ts 的缺省值）。
            _trackerRegistry = cr(backendCtxForRooms)
            return _trackerRegistry
          } catch { return null }
        }
      })()
      _trackerRegistry = await _trackerRegistryInit
      return _trackerRegistry
    }
    // 触发预热（不阻塞主流程）
    try { getTrackerRegistry().catch(()=>{}) } catch {}
    // ============ 平台抽象（#171 · createPlatform 惰性单例）============
    // 第一性原理：平台单点 + 零手拼 + 双闸不变量；经 ctx.get('platform') 或内联 fallback（零 import 语法，避 D7 dev host vm.Script 阻塞）
    let _platform: PlatformService | null = null
    let _platformInit: Promise<PlatformService> | null = null
    let lastPlatformOk: boolean | null = null
    async function getPlatform(): Promise<PlatformService | null> {
      const platT0 = Date.now()
      if (_platform) return _platform
      if (_platformInit) return _platformInit
      _platformInit = (async () => {
        const injected = ctx.get('platform') as PlatformService | null | undefined
        if (injected && typeof injected.getHome === 'function' && injected.path) return injected
        try {
          const platMod = await import('./platform/index.js')
          const createPlatform = platMod.createPlatform || (platMod as { default?: unknown }).default
          if (typeof createPlatform === 'function') return createPlatform(ctx) as unknown as PlatformService
        } catch {}
        let nodePath: PathModule | null = null
        let nodeOs: OsModule | null = null
        // 本域 tsconfig 有意不加载任何类型包（types 为空），node:path / node:os 的类型声明随 @types/node
        // 一起被挡在门外；运行时一定是 Node，这两个模块必然存在。所以只忽略这两行导入的类型错误
        // （纯类型层面，不影响 esbuild 的运行时转译）——与 src/host/platform/darwin/index.ts:15-21 同一写法。
        // @ts-expect-error
        try { const m = await import('node:path'); nodePath = (m.default || m) as unknown as PathModule } catch {}
        // @ts-expect-error
        try { const m2 = await import('node:os'); nodeOs = (m2.default || m2) as unknown as OsModule } catch {}
        if (!nodePath || !nodeOs) {
          const sepWin = String.fromCharCode(92)
          nodePath = { posix: { join: (...a: string[]) => a.join('/').replace(/\/\//g,'/'), sep: '/', dirname: (p: string)=>p.slice(0,p.lastIndexOf('/')), basename: (p: string)=>p.split('/').pop() as string, resolve: (...a: string[])=>a.join('/'), normalize: (p: string)=>p, isAbsolute: (p: string)=>p.startsWith('/'), relative: (a: string,b: string)=>b }, win32: { join: (...a: string[]) => a.join(sepWin).replace(/\//g,sepWin), sep: sepWin, dirname: (p: string)=>p.slice(0,p.lastIndexOf(sepWin)), basename: (p: string)=>p.split(sepWin).pop() as string, resolve: (...a: string[])=>a.join(sepWin), normalize: (p: string)=>p, isAbsolute: (p: string)=>/^[A-Za-z]:/.test(p), relative: (a: string,b: string)=>b } }
          nodeOs = { homedir: () => (typeof process !== 'undefined' && process.env && (process.env.USERPROFILE || process.env.HOME)) || '', platform: () => { try { return (typeof process !== 'undefined' && process['platform']) || 'win32' } catch { return 'win32' } } }
        }
        const osName = (nodeOs.platform ? nodeOs.platform() : 'win32')
        const pathImpl = osName === 'win32' ? nodePath.win32 : nodePath.posix
        const envSrc: Record<string, string | undefined> = (typeof process !== 'undefined' && process.env) ? process.env : {}
        const homedirFn = () => { try { return nodeOs.homedir() } catch { return '' } }
        const WIN32_GUARD_RE = /^[A-Za-z]:/
        let cachedHome: string | null | undefined
        const getHomeInner = async (): Promise<string | null> => {
          if (cachedHome !== undefined) return cachedHome
          let primary = ''
          try { const v = homedirFn(); primary = v == null ? '' : String(v) } catch { primary = '' }
          if (osName === 'win32') {
            if (primary && WIN32_GUARD_RE.test(primary)) { cachedHome = primary; return cachedHome }
            const up = envSrc.USERPROFILE
            if (up) { cachedHome = up; return cachedHome }
            const combined = (envSrc.HOMEDRIVE || '') + (envSrc.HOMEPATH || '')
            if (combined) { cachedHome = combined; return cachedHome }
            cachedHome = null; return cachedHome
          } else {
            try { const v = homedirFn(); cachedHome = v || null; return cachedHome } catch { cachedHome = null; return cachedHome }
          }
        }
        const pathObj = Object.freeze({
          join: pathImpl.join.bind(pathImpl),
          sep: pathImpl.sep,
          dirname: pathImpl.dirname.bind(pathImpl),
          basename: pathImpl.basename.bind(pathImpl),
          resolve: pathImpl.resolve.bind(pathImpl),
          normalize: pathImpl.normalize.bind(pathImpl),
          isAbsolute: pathImpl.isAbsolute.bind(pathImpl),
          relative: pathImpl.relative.bind(pathImpl),
          async joinHome(...segs: string[]) { const h = await getHomeInner(); return pathImpl.join(h as string, ...segs) },
        })
        async function resolveExec(name: string): Promise<string | null> {
          const mapped = osName === 'win32' && name === 'cmd' ? 'cmd.exe' : name
          const subprocessSvc = ctx.get('subprocess') as { resolveExecutable(name: string): Promise<string | null> } | null | undefined
          try { return await subprocessSvc!.resolveExecutable(mapped) } catch (e) {
            if (name === 'gh') {
              const fb = envSrc.DSH_GH_PATH || ''
              if (!fb) throw e
              const fss = ctx.get('fs') as { lstat?(p: string): Promise<unknown> } | null | undefined
              if (!fss || typeof fss.lstat !== 'function') throw e
              try { const info = await fss.lstat(fb); if (info) return fb } catch {}
            }
            throw e
          }
        }
        const resolveExecutable = async (name: string): Promise<string | null> => { try { return await resolveExec(name) } catch { return null } }
        const fss = ctx.get('fs')
        const envView = Object.freeze({ get(k: string): string | undefined { return envSrc[k] }, has(k: string): boolean { return k in envSrc } })
        return Object.freeze({ os: osName, getHome: getHomeInner, path: pathObj, resolveExecutable, fs: fss, env: envView })
      })()
      _platform = await _platformInit
      try { const okNow = !!_platform; if (logCtx && logCtx.isEnabled('debug') && okNow !== lastPlatformOk) { lastPlatformOk = okNow; logCtx.fire('debug', 'platform.resolve', function () { return { name: 'platform', ok: okNow, latencyMs: Date.now() - platT0 } }) } } catch (eL) {}
      return _platform
    }
    // ============ 探测级联 · workspaceStore + detectionService（#152 · #150 Q1-Q7）============
    // 判定出口严格分层 + 轻量化二联骨架 + per-workspace 内存 Map<handleKey→Selection> 不落盘 + pending 不缓存 + wf.bind 写文件
    //   （#1138：内存 Map 这一层是**选择结果的缓存**，不是人选的记录；人选的记录只有工作区文件一份。）
    let _workspaceStore: WorkspaceStore | null = null
    let _detectionService: DetectionService | null = null
    async function getWorkspaceStore(): Promise<WorkspaceStore> {
      if (_workspaceStore) return _workspaceStore
      try {
        const mod = await import('../tracker/detection/workspaceStore.js')
        const create = (mod.createWorkspaceStore || (mod as { default?: unknown }).default) as unknown as (opts: { ttl: number; logCtx: LogCtx | null | undefined }) => WorkspaceStore
        _workspaceStore = create({ ttl: STATUS_CACHE_MS, logCtx: logCtx })
        // 后端被卸载后的缓存清理（#150 Q3；#1138 改了触发口径）：
        //   以前靠「注册表把绑到这个后端的工作区标 stale、再发一条 bind 事件」，而绑定表已经删了。
        //   现在注册表只发 unregister（带上被卸掉的 id），这里按「缓存里答的是不是这个后端」来清——
        //   同样准（清掉的正是会答出这个不存在后端的那些格子），且不依赖任何绑定记录。
        try {
          const reg = await getTrackerRegistry()
          if (reg && typeof reg.on === 'function') reg.on('unregister', (evt) => { if (evt && evt.id) { try { _workspaceStore!.invalidateByBackend(evt.id) } catch {} } })
        } catch {}
      } catch { _workspaceStore = { get: () => null, set: () => {}, has: () => false, clear: () => {}, invalidate: () => {}, invalidateByBackend: () => {}, keys: () => [], onRegistryBindStale: () => {} } }
      return _workspaceStore
    }
    // #幽灵修复：BackendContext.exec（contract.js §BackendContext）——preflight 经 ghClient/glab 执行 gh/glab。
    // 契约形状 {stdout,stderr,code}；exit code≠0 不抛（调用方判）；超时 terminate；opts.timeout/signal 透传。
    // #606 补测点：这条路此前一条日志都不留（唯一的记录点在 github 房的 client.js，它要调用上下文自带记录器，
    //   而各操作上下文都没带），于是面板列表的主取数路、每次探测的预检、取当前登录用户与所有写操作
    //   起了多少次外部命令全都看不见。这里补 exec.run（按需）：一次调用落一行，只记命令名、工作区短指纹、
    //   耗时、退出码与发起链名；不记完整参数、不记令牌、不记原始路径。调试开关关着时只读一次开关就返回。
    // 第四个参数 via 是「这条命令由哪条链起的」：造操作上下文的调用方把链名传进来，日志只记这个固定名字。
    async function detectionExec(cmd: unknown, args: string[] | null | undefined, opts: ExecOpts | null | undefined, via: unknown): Promise<{ stdout: string; stderr: string; code: number | undefined }> {
      const argv = [String(cmd)].concat(args || [])
      const c = (opts && opts.cwd) || ''
      // 起始时刻只在开关打开时才取：关着时这一行读一个布尔就结束，连时钟都不读，后面那行自然也不落。
      const execT0 = (logCtx && logCtx.isEnabled('debug')) ? Date.now() : 0
      // #963 出站同一口径：gh / glab 是真实出站（git 是本地命令，不进准入）。gh 按读写探活分档，glab 沿用旧默认。
      const cmdBase = String(cmd || '').split(/[\\/]/).pop() || ''
      const deIsGh = /^gh(\.exe)?$/i.test(cmdBase)
      const deIsGlab = /^glab(\.exe)?$/i.test(cmdBase)
      const deIsOutbound = deIsGh || deIsGlab
      const deBucket = (deIsGh && isWriteGhArgs(args)) ? 'write' : 'read'
      // #1007：失败回话与日志要说得出是哪条命令，所有上报共用一个短标签（只记枚举式短标签，不记命令原文）。
      const deCmd = ghCommandLabel(args)
      // 报闸的实例留到事后再用一次（#1482）：真实点数在回包里，起进程前只够按 1 点估。
      // 报闸与补差的口径住在 tracker/kernel/outbound-tiers.ts，这个文件只留「拿到闸、调用两次」。
      let deGate: OutboundGate | null = null
      let deRelease: (() => void) | null = null
      if (deIsOutbound) {
        try { deRelease = await getGhLane().acquire({ bucket: deBucket, signal: (opts && opts.signal) || undefined, cmd: deIsGh ? deCmd : undefined, service: deIsGh ? 'github' : 'gitlab' }) }
        catch (eDeQ) {
          // #1007：冷却窗口里的拒绝不是「排队取消」，要如实说成「通路不通」，否则调用方会以为只是排队被人喊停。
          const deCoolText = ghCooldownReply(eDeQ, deCmd || cmdBase || 'gh')
          if (deCoolText) return { stdout: '', stderr: deCoolText, code: -1 }
          return { stdout: '', stderr: 'cancelled while queued for gh admission', code: -1 }
        }
      }
      // #723（T19）：这一笔真实出站先报给闸（I1）。这条通道是操作上下文交给后端的那种 exec 出口
      // （tracker 三个房间与快照那几路都走它），起的是 gh / glab / git 三条命令；gh 与 glab 是真出站，
      // git 只读远端地址，但都是「起了一个进程」，一起报才能保证账上的条数与真起的命令数一一对应。
      // #965：这一块在拿名额之后 —— 排队等待不算这一笔，取消排队的不进账。
      try { deGate = reportGhOutbound(gateOf(), args) } catch (eR) { /* 报账失败不许影响已经起来的这一条命令 */ }
      let handle: SpawnHandle
      try {
        handle = subprocess.spawn({
          argv: argv,
          cwd: c || DEFAULT_CWD,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 256 * 1024 } },
          graceMs: PROC_GRACE_MS,
        })
      } catch (e) {
        // #1007：gh 进程根本没起来也是 transport 级失败（spawn-failed），同一只桶进入冷却。
        // glab 走的不是 GitHub 的通路，不在这里上报，免得 GitLab 的故障把 GitHub 的调用一起挡掉。
        if (deIsGh) reportGhSpawnFailure(getGhLane(), deBucket, deCmd)
        if (deIsOutbound) { try { if (deRelease) deRelease() } catch {} }
        throw new Error('exec spawn failed: ' + String((e && (e as { message?: unknown }).message) || e))
      }
      // #969：gh 默认超时按读写探活分档（调用方显式 timeout 优先）；glab 与 git 沿用旧默认。
      const timeoutMs = (opts && opts.timeout != null) ? opts.timeout : (deIsGh ? timeoutForGhArgs(args) : TIMEOUT_MS)
      // 调用方取消信号（#895）：中止即杀进程，不留没人等的写入；没有信号时与原来一字不差。
      let onAbortSig: (() => void) | null = null
      const abortP = new Promise<ExecOutcome>(function (resolve) {
        const sig = opts && opts.signal
        if (!sig || typeof sig.addEventListener !== 'function') return
        if (sig.aborted === true) { try { handle.terminate() } catch (e2) {} resolve({ exitCode: -1, signal: 'aborted' }); return }
        onAbortSig = function () { try { handle.terminate() } catch (e2) {} resolve({ exitCode: -1, signal: 'aborted' }) }
        try { sig.addEventListener('abort', onAbortSig, { once: true }) } catch (e) {}
      })
      let outcome: ExecOutcome
      try {
        outcome = await Promise.race([
          handle.done,
          timer.timeout(timeoutMs).then(function () { try { handle.terminate() } catch (e2) {} return { exitCode: -1, signal: 'timeout' } }),
          abortP,
        ])
      } catch (e) {
        outcome = { exitCode: -1, signal: 'error' }
      }
      try { if (opts && opts.signal && onAbortSig && typeof opts.signal.removeEventListener === 'function') opts.signal.removeEventListener('abort', onAbortSig) } catch (e) {}
      const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0) : { text: '' }
      const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0) : { text: '' }
      try { if (execT0 && logCtx!.isEnabled('debug')) logCtx!.fire('debug', 'exec.run', { argv0: progName(argv[0]), cwdHash: hash8(c || DEFAULT_CWD), latencyMs: Date.now() - execT0, exitCode: (outcome && typeof outcome.exitCode === 'number') ? outcome.exitCode : -1, via: String(via || 'unspecified') }) } catch (eL) {}
      // #1007：这一趟的结局回写给同一只准入桶（三条口径见 tracker/kernel/outbound-tiers.ts 末尾那一节）。
      if (deIsGh) reportGhOutcome(getGhLane(), { bucket: deBucket, cmd: deCmd, outcome: outcome, stdout: out.text, stderr: err.text })
      if (deIsOutbound) { try { if (deRelease) deRelease() } catch {} }
      // #1482：GraphQL 的真实点数只有拿到回包才知道，成功之后在这里补差；补差口径住 outbound-tiers.ts。
      // 这条通道本身就是起进程的那一层，补差只补这一层；房间的 client.ts 那是另一条报账路，两边不重叠。
      noteGhGraphqlCorrection(deGate, args, outcome && outcome.exitCode, out.text)
      return { stdout: out.text || '', stderr: err.text || '', code: outcome.exitCode }
    }
    async function getDetectionService(): Promise<DetectionService> {
      if (_detectionService) return _detectionService
      const registry = await getTrackerRegistry()
      const platform = await getPlatform()
      const ws = await getWorkspaceStore()
      const fsSvc = ctx.get('fs')
      try {
        const mod = await import('../tracker/detection/detectionService.js')
        // 动态 import 的那份模块，工厂签名在编译期拿不到；这里按「收一个依赖对象」收着用，
        // 依赖逐项的检查在探测服务那一侧（它自己的 DetectionServiceDeps 就是真源）。
        const create = (mod.createDetectionService || (mod as { default?: unknown }).default) as unknown as (deps: Record<string, unknown>) => DetectionService
        // 取不到决策函数时按「没有」处理（原写法是 `.catch(function () { return {} })` 再取字段，语义相同）。
        const decided = await getDecisionFn().catch(function (): DecisionFnModule { return { decideBackend: null } })
        const decideBackend = (decided || { decideBackend: null }).decideBackend || null
        // skillProbe 内联（复用 probeSkill 双源逻辑；全量名单 = shared/matt-skills.js 单源，二十多项）
        // #280/#fix-banner：旧版硬编码 10 名，遗漏 grill-with-docs / wizard / grill-me / to-questionnaire / wait-what / writing-for-agents 等导致横幅永远报警
        // #968 技能按需：平时（链求值、普通探测）只问链条目录要的三项，人亲手点重查才问全量。
        // 范围由探测编排层按重查标记带来（见 detectionService），这里只按范围选名单；重查标记同时透给单项探测，
        // 让它绕过短时记住（刚装好的技能重查立即可见），平时则命中记住、不重复问。
        const skillProbe = async ({ cwd, skillScope, force }: { cwd: string; skillScope?: unknown; force?: unknown }): Promise<SkillProbeBatch> => {
          // probeNames：全量即 shared/matt-skills.js:MATT_SKILL_PROBE_NAMES（单源）；链上三项即链目录真源；改探测集只改各真源一处即可
          const probeNames = selectSkillProbeNames(await getMattSkillProbeNames(), (typeof getChainSkillNames === 'function') ? await getChainSkillNames() : null, skillScope)
          const probes: Record<string, SkillProbe> = {}
          const missing: string[] = []
          let hasPending = false
          let pendingError: unknown = null
          for (let i = 0; i < probeNames.length; i++) {
            const name = probeNames[i]
            try {
              const r = await probeSkill(name, 'zh', cwd, { force: !!force })
              probes[name] = r
              if (r.level === 'pending') { hasPending = true; if (!pendingError && r.error) pendingError = r.error }
              else if (r.level !== 'ok') missing.push(name)
            } catch (e) { const err = String((e && (e as { message?: unknown }).message) || e); probes[name] = { ok: false, level: 'bad', detail: err, hint: 'prompt:installSkills', error: err }; missing.push(name) }
          }
          const ok = missing.length === 0 && !hasPending
          return { ok, missing, probes, hasPending, pendingError, pending: hasPending }
        }
        // #683（F1）：判定链要读宿主侧那份记忆（用户选的后端按工作区记着），实例由 index.js 单点持有 ——
        //   那条读-改-写队列必须全进程只有一条，不能在这里另建一份。
        _detectionService = create({ registry, getPlatform, getFs: () => fsSvc, getTimers: () => hostTimers(timer), workspaceStore: ws, skillProbe, resolveRepoHandle: async (h: WorkspaceHandle) => ({ cwd: h.cwd || '', refId: h.refId || '' }), exec: detectionExec, getChoiceStore: getChoiceStore, logCtx: logCtx, decideBackend: decideBackend })
      } catch (e) {
        // 兜底：最小二联（explicit → matches）不含 preflight/skill
        _detectionService = {
          detect: async (handle: WorkspaceHandle, opts?: unknown) => {
            const plat = await getPlatform()
            const expMod = await import('../tracker/detection/explicitDetector.js')
            const expFn = (expMod.detectExplicit || (expMod as { default?: unknown }).default) as (h: WorkspaceHandle, c: unknown, r: unknown) => Promise<{ selection?: unknown; raw?: unknown; parsed?: unknown }>
            const exp = await expFn(handle, { platform: plat, cwd: handle.cwd, fs: fsSvc }, registry)
            let sel = exp.selection as { ref?: { refId?: string } } | null | undefined
            if (!sel) { const ctx2 = { cwd: handle.cwd, platform: plat, fs: fsSvc, caller: 'detect', timers: hostTimers(timer) }; sel = await registry!.select(handle, ctx2) as { ref?: { refId?: string } } | null }
            return { handle, selection: sel, repoHandle: { cwd: handle.cwd || '', refId: (sel && sel.ref && sel.ref.refId) || '' }, explicit: { raw: exp.raw, parsed: exp.parsed }, preflight: null, skillProbes: null, at: Date.now() }
          }
        }
      }
      return _detectionService
    }
  function clearWorkspaceStore() { try { if (_workspaceStore && typeof _workspaceStore.clear === 'function') _workspaceStore.clear() } catch {} }
  // #683（F1）：宿主侧那份记忆（H）的单例就在这里建 —— 读它的是两处（绑定写入、判定读取），而它内部
  //   那条读-改-写队列必须全进程只有一条（两个窗口同时写才排得成队）。规则与字段见 src/host/choiceStore.ts 文件头。
  let _choiceStoreP: Promise<ChoiceStore | null> | null = null
  function getChoiceStore(): Promise<ChoiceStore | null> {
    if (!_choiceStoreP) _choiceStoreP = (async function () {
      const mod = await import('./choiceStore.js')
      return mod.createChoiceStoreForHost({ getHome: async function () { const p = await getPlatform(); return p!.getHome() }, getTrackerRegistry: function () { return getTrackerRegistry() }, logCtx: logCtx })
    })().catch(function () { return null })
    return _choiceStoreP
  }
  let _decideBackendP: Promise<DecisionFnModule> | null = null // #1003 单出口装配点（跨层引用基线记名；映射挂函数上整包递，下游零新增边）
  const getDecisionFn = (): Promise<DecisionFnModule> => (_decideBackendP || (_decideBackendP = import('../tracker/detection/backendDecision.js').then(
    function (m) {
      const fn = (m.decideBackend || (m.default && m.default.decideBackend) || null) as DecisionFnModule['decideBackend']
      if (fn) { try { (fn as { selectionFromOutlet?: unknown }).selectionFromOutlet = m.selectionFromOutlet || (m.default && m.default.selectionFromOutlet) || null } catch (eAttach) {} }
      return { decideBackend: fn }
    },
    function () { return { decideBackend: null } })))
  return { getTrackerRegistry, getPlatform, getWorkspaceStore, detectionExec, getDetectionService, getChoiceStore, clearWorkspaceStore, getDecisionFn }
}
