// src/host/snapshotEnvelope.ts —— 快照信封的组装与落盘（#723 T19 从 sessionSnapshot.ts 原样搬出，纯结构、行为零变化）
//
// 为什么单开这一个文件：会话快照电话（src/refresh/rooms/host/session-snapshot-cache.ts）的五条分支（内存缓存短路、磁盘回放、
// 304、重建、失败）都要拼同一个形状的信封，而那个文件贴着 350 行上限（tests/verify-file-granularity.ts
// 的零增长基线）—— #723 要往快照回包上挂「每个会话在处理哪些票」的读数时，那个文件已经 349 行。
// 所以先把这两件与电话体无关的纯组装搬出来：谁要改「快照里都有哪些字段」，改这一处就够（#653 的老规矩）。
//
// 搬的时候只搬不改：函数体、注释、字段顺序、`cdk` 兜底值与原来逐字一致；`ghPath` / `ghError` 取的是
// 通话那一刻的宿主状态，所以由调用方（那个电话）每次现取好交进来。

/** 接线处交进来的几只口子：取宿主状态（gh 路径/错误）、落盘那一步、日志与读数。 */
type EnvelopeDeps = {
  getGhPath: () => string | null
  getGhLastError: () => unknown
  adoptSnapshot: (snap: unknown, c: unknown) => unknown
  logCtx?: { fire(level: string, event: string, fields?: unknown): void } | null
  /**
   * #1082：面板「跨会话在办表」的读数出口。输入回包与当前会话，返回字段值
   * （{ ok:true, readout } 或 { ok:false, reason }）；不接就整块不挂。
   */
  workRouteTableReadout?: (reply: unknown, ctx: { sessionId?: unknown }) => Promise<unknown> | unknown
  /** 挂到回包上的字段名；缺省 workRouteTable（与宿主读数模块、界面叶子同一个名字）。 */
  workRouteTableField?: string
}

/** buildSnap 的输入：五条分支各带一部分字段，这里只声明本文件真读到的那些。 */
type SnapInput = {
  repo?: unknown
  repoRoot?: unknown
  workspaceRoot?: unknown
  maps?: unknown[]
  issues?: unknown[]
  thinTickets?: unknown[]
  labels?: unknown[]
  repository?: unknown
  backendModules?: unknown
  selection?: unknown
  setupLayout?: unknown
  viewer?: unknown
  viewerLogin?: unknown
  deck?: unknown
  fallback?: string
  fallbackAt?: unknown
  fallbackReason?: unknown
  refresh?: unknown
}

/** deck 那一块里本文件真读到的两个字段。 */
type DeckLike = { counts?: { open?: number; closed?: number } | null; partial?: boolean }

/** 信封形状：显式声明本文件真读到的字段，其余（调用方透传的那些）原样放过。 */
type SnapLike = {
  [key: string]: unknown
  fromCache?: boolean
  generatedMs?: number
  maps?: unknown[]
  issues?: unknown[]
  labels?: unknown[]
  deck?: DeckLike | null
}

export function createSnapshotEnvelope(deps: EnvelopeDeps) {
  const d = deps || ({} as EnvelopeDeps)

  /**
   * 五条分支的快照同形，收在一处组装（#653：加字段改一处，免漏；repo 与 repoRoot 由调用方传入）。
   * deck 那一格由调用方按它的数据结构现拼，这一层只知道本文件真读到的那两个字段（见 DeckLike），
   * 所以在返回对象里按 DeckLike 收一下：运行时原样透传，转译产物与标注前逐字节相同。
   */
  function buildSnap(o: SnapInput): SnapLike {
    const snap = {
      ok: true,
      repo: (o.repo !== undefined ? o.repo : null),
      repoRoot: o.repoRoot,
      workspaceRoot: o.workspaceRoot,
      updatedAt: new Date().toISOString(),
      generatedMs: Date.now(),
      env: { ghPath: d.getGhPath(), ghError: d.getGhLastError() },
      maps: o.maps, issues: o.issues, thinTickets: o.thinTickets, labels: o.labels,
      repository: (o.repository !== undefined ? o.repository : null),
      backendModules: o.backendModules,
      selection: o.selection,
      setupLayout: (o.setupLayout !== undefined ? o.setupLayout : null),
      capabilities: null,
      viewer: (o.viewer !== undefined ? o.viewer : null),
      viewerLogin: (o.viewerLogin !== undefined ? o.viewerLogin : null),
      deck: o.deck as DeckLike, fallback: (o.fallback === 'rest' ? 'rest' : null), fallbackAt: (o.fallback === 'rest' ? (o.fallbackAt || null) : null), fallbackReason: (o.fallback === 'rest' ? (o.fallbackReason || null) : null), refresh: (o.refresh || null),
    }
    return snap
  }

  // #689：snapshot.built 多了三个字段（open / closed 是后端计数给的真值、拿不到记 -1；partial 说这份行数据全不全）
  // —— 加在既有事件里不新增一条（每次重建都会走到这里），字段表见 research/489-appendix.md 第 1 章。
  // #1295：再多记一个 specs —— 这一轮快照里认出几张「实施地图」（规格容器）。maps 是容器总数，
  //   maps 减 specs 就是「探索地图」的张数；面板的双轨分流一旦看起来不对，先拿这两个数对账：
  //   是这一轮就没认出来（specs=0），还是认出来了却没被列表画成蓝轨（渲染侧问题）。
  //   注意老直连快照路（src/refresh/rooms/host/snapshot-build.ts）只认 wayfinder:map 标签、不产规格容器，
  //   那条路上 specs 恒 0 属正常，别据此判「一张规格都没认出来」。
  // 类型说明（#1155）：落盘那一步是接线处给的回调，它的返回形状在这一层表达不出来，
  // 所以按调用方传进来的类型原样还回去（运行时不碰，只是把类型跟过去）。
  // 这里必须保持 async（原样就是 async）：调用方按承诺等它，产物里也必须是 async 函数。
  // 读字段时用的是「就地断言」写法（`(snap as SnapLike).x`）而不是先赋一个别名变量：断言只给编译器看，
  // 转译时整段消失，所以产物与标注前逐字节相同（#1155 验收第 3 条）。
  async function adoptSnapLog<T>(snap: T, c: unknown): Promise<T> {
    try {
      const logCtx = d.logCtx
      if (logCtx && snap && (snap as SnapLike).fromCache !== true) {
        const _d: DeckLike = ((snap as SnapLike).deck && typeof (snap as SnapLike).deck === 'object') ? ((snap as SnapLike).deck as DeckLike) : {}
        const _ct = (_d.counts && typeof _d.counts === 'object') ? _d.counts : null
        logCtx.fire('info', 'snapshot.built', { maps: ((snap as SnapLike).maps || []).length, specs: (((snap as SnapLike).maps || []) as any[]).filter(function (m: any) { return !!m && m.type === 'spec' }).length, issues: ((snap as SnapLike).issues || []).length, labels: ((snap as SnapLike).labels || []).length, open: _ct ? _ct.open : -1, closed: _ct ? _ct.closed : -1, partial: _d.partial === true, latencyMs: Date.now() - ((snap as SnapLike).generatedMs || Date.now()) })
      }
    } catch (e) {}
    return d.adoptSnapshot(snap, c) as T
  }

  /**
   * 把面板「跨会话在办表」的读数挂到一份 ok:true 的回包上（#1082）。
   *
   * 与旧的 withChainReadout 同一个理由包在最外一层（旧链读数已随 #1271 退役）：缓存短路回的是缓存里同一个对象，写进 buildSnap
   * 会把读数的时刻冻在落盘那一刻。这一步是异步的（读数要读盘），所以两条电话路都要等它。
   *
   * 只挂这一个字段、只信宿主读数：回包不是 ok:true 或接线处没给出口时原样返回；
   * 出口自己抛错就挂一条读不到的原因，不把整份快照带成失败。
   */
  async function withWorkRouteTable<T>(reply: T, args?: any): Promise<T> {
    if (!reply || typeof reply !== 'object' || (reply as { ok?: unknown }).ok !== true) return reply
    if (typeof d.workRouteTableReadout !== 'function') return reply
    const field = d.workRouteTableField || 'workRouteTable'
    try {
      (reply as { [key: string]: unknown })[field] = await d.workRouteTableReadout(reply, { sessionId: args && args.sessionId })
    } catch (eW) {
      (reply as { [key: string]: unknown })[field] = { ok: false, reason: 'read-failed' }
    }
    return reply
  }

  return { buildSnap: buildSnap, adoptSnapLog: adoptSnapLog, withWorkRouteTable: withWorkRouteTable }
}
// ============================ #1436：胶囊首帧那条只读电话 ============================
//
// 为什么这条电话的家安在这里：胶囊要在「打开会话的第一帧」显示这个会话处理过哪些票，
//   而答案就在本机一份小存档里（<主目录>/.dsh/mattskillsdeck/work-path/<工作区散列>.json）；
//   从前界面只能等宿主把整个仓库的快照重建一遍（wf.refresh，本机实测中位 25 秒以上）才能看到它。
//   这个文件已经拿着同一份读数出口（见上面的 EnvelopeDeps.workRouteTableReadout，快照回包挂表也用它），
//   所以把「只读那份存档、如实回一张表」的第二个消费者放在这里，不必再新开一个宿主入口文件
//   （src/host/index.ts 的动态装配边在门禁里是记名存量，新增一个同层文件会多一条新边）。
//
// 三条不能改的约定：
// 1. 只读：不写账本、不建仓、不加锁、不调 gh。读不出来就如实回 { ok:false, reason }，
//    不抛异常、不拿空名单冒充「没有记录」—— 调用方要靠 reason 区分「真的没有」与「读这一步坏了」。
// 2. 工作区路径必须先经 canonicalKey 再散列成工作区键：账本里的键是宿主规整过的路径算出来的
//    （Windows 盘符小写、保留反斜杠），自己再归一化一次会算出第二格，同一个工作区就成了两份账本
//    （src/refresh/contract/workspace-keys.ts:42 有同样的告诫）。
// 3. 日志沿用既有事件 host.call / host.call.fail（电话名 wf.workRoute、kind=work-route），
//    不新增事件名、不记路径原文与会话号原文。

/** 这条电话的依赖：读存档的那一口、把工作区路径规整成键的那一口、日志口；全部由入口显式传入。 */
type OwnWorkRouteDeps = {
  readout?: ((reply: unknown, ctx: { sessionId?: unknown }) => Promise<unknown> | unknown) | null
  canonicalKey?: ((cwd: string) => unknown) | null
  logCtx?: { fire(level: string, event: string, fields?: unknown): void } | null
}

/**
 * 造一条只读的「本会话处理过哪些票」电话。返回值只有 handleWorkRoute 一个方法：
 * 入参是客户端送来的 JSON（{ sessionId, cwd }），回 { ok:true, workRouteTable } —— 外层 ok 只说
 * 「这条电话跑完了」，里面那张表自己的 ok 才是「读到了没有」。
 */
export function createOwnWorkRoutePhone(deps?: OwnWorkRouteDeps) {
  const d = (deps || {}) as OwnWorkRouteDeps
  const readout = (typeof d.readout === 'function') ? d.readout : null
  const canonicalKey = (typeof d.canonicalKey === 'function') ? d.canonicalKey : null
  const logCtx = d.logCtx || null

  /** 错误归类的短散列（与 src/host/mapTickets.ts:44 同一份 5381 散列）；日志只记散列，不把报错原文写进常驻日志。 */
  function hash8(s?: unknown): string { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }

  /**
   * 电话体记一行日志：沿用既有事件 host.call / host.call.fail，电话名写 method、类别写 kind；不记路径与会话号原文。
   * reason 记「这张表最后是什么结论」—— ready 读到了、no-workspace 没有工作区目录、no-session 没有会话号、
   * no-binding 宿主没接上读口、read-failed 读存档抛错、shape 回话形状不对。
   * 为什么连「诚实地回了失败」也要记：客户端只看到表是坏的，分不清「这个会话真没有记录」与
   * 「读这一步没走通」；宿主这一行是唯一能分开两者的现场。
   */
  function phoneLog(t0: number, ok: boolean, err?: unknown, reason?: unknown): void {
    try {
      if (!logCtx || typeof logCtx.fire !== 'function') return
      const base = { method: 'wf.workRoute', kind: 'work-route' }
      if (ok) logCtx.fire('info', 'host.call', Object.assign({}, base, { latencyMs: Date.now() - t0, ok: true, reason: String(reason || 'ready') }))
      else logCtx.fire('warn', 'host.call.fail', Object.assign({}, base, { errorHash: hash8(String((err && (err as Error).message) || err || 'work-route-failed')), errorKind: 'read-failed' }))
    } catch (eL) {}
  }

  /** 读一份存档的形状校验：只要不是对象就当成「读这一步坏了」，不把 undefined 当成「没有记录」。 */
  function shapeOf(table?: unknown): unknown {
    const t = table as { ok?: unknown; readout?: unknown } | null | undefined
    if (!t || typeof t !== 'object') return { ok: false, reason: 'host.work-route.read-failed' }
    if (t.ok === true && (!t.readout || typeof t.readout !== 'object')) return { ok: false, reason: 'host.work-route.shape' }
    return t
  }

  async function handleWorkRoute(args?: unknown): Promise<unknown> {
    const a = (args && typeof args === 'object') ? (args as { sessionId?: unknown; cwd?: unknown }) : {}
    const sid: string = String(a.sessionId == null ? '' : a.sessionId)
    const rawCwd: string = String(a.cwd == null ? '' : a.cwd).trim()
    const t0: number = Date.now()
    let table: any
    if (!rawCwd) { table = { ok: false, reason: 'host.work-route.no-workspace' }; phoneLog(t0, true, null, table.reason) }
    else if (!sid) { table = { ok: false, reason: 'host.work-route.no-session' }; phoneLog(t0, true, null, table.reason) }
    else if (!readout) { table = { ok: false, reason: 'host.work-route.no-binding' }; phoneLog(t0, true, null, table.reason) }
    else {
      // 先规整再读：账本按规整后的路径散列存放，这里少走一步就会读出第二格（见上面约定 2）。
      let root: string = rawCwd
      try { if (canonicalKey) { const c = await canonicalKey(rawCwd); if (c) root = String(c) } } catch (eK) {}
      try {
        const out = await readout({ ok: true, workspaceRoot: root }, { sessionId: sid })
        table = shapeOf(out)
        // 读存档本身成功时也把结论记出来：ok:true 是「读到了，表在外面」；ok:false 的 reason
        // 区分「这个会话真没有记录」与「读这一步坏了」，这正是客户端分不清的地方。
        phoneLog(t0, true, null, (table && table.ok === true) ? 'ready' : (table && table.reason) || 'read-failed')
      } catch (eR) {
        table = { ok: false, reason: 'host.work-route.read-failed' }
        phoneLog(t0, false, eR)
      }
    }
    return { ok: true, workRouteTable: table }
  }

  return { handleWorkRoute: handleWorkRoute }
}
