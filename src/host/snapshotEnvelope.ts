// src/host/snapshotEnvelope.js —— 快照信封的组装与落盘（#723 T19 从 sessionSnapshot.js 原样搬出，纯结构、行为零变化）
//
// 为什么单开这一个文件：会话快照电话（src/host/sessionSnapshot.js）的五条分支（内存缓存短路、磁盘回放、
// 304、重建、失败）都要拼同一个形状的信封，而那个文件贴着 350 行上限（tests/verify-file-granularity.js
// 的零增长基线）—— #723 要往快照回包上挂「每个会话在处理哪些票」的读数时，那个文件已经 349 行。
// 所以先把这两件与电话体无关的纯组装搬出来：谁要改「快照里都有哪些字段」，改这一处就够（#653 的老规矩）。
//
// 搬的时候只搬不改：函数体、注释、字段顺序、`cdk` 兜底值与原来逐字一致；`ghPath` / `ghError` 取的是
// 通话那一刻的宿主状态，所以由调用方（那个电话）每次现取好交进来。

/** 接线处交进来的几只口子：取宿主状态（gh 路径/错误）、落盘那一步、日志与读数。 */
type EnvelopeDeps = {
  getGhPath: () => string
  getGhLastError: () => unknown
  adoptSnapshot: (snap: unknown, c: unknown) => unknown
  logCtx?: { fire(level: string, event: string, fields?: unknown): void } | null
  chainReadout?: () => unknown
  chainField?: string
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
  // 类型说明（#1155）：落盘那一步是接线处给的回调，它的返回形状在这一层表达不出来，
  // 所以按调用方传进来的类型原样还回去（运行时不碰，只是把类型跟过去）。
  // 这里必须保持 async（原样就是 async）：调用方按承诺等它，产物里也必须是 async 函数。
  async function adoptSnapLog<T>(snap: T, c: unknown): Promise<T> {
    try {
      const logCtx = d.logCtx
      const s = snap as SnapLike
      if (logCtx && snap && s.fromCache !== true) {
        const _d: DeckLike = (s.deck && typeof s.deck === 'object') ? s.deck : {}
        const _ct = (_d.counts && typeof _d.counts === 'object') ? _d.counts : null
        logCtx.fire('info', 'snapshot.built', { maps: (s.maps || []).length, issues: (s.issues || []).length, labels: (s.labels || []).length, open: _ct ? _ct.open : -1, closed: _ct ? _ct.closed : -1, partial: _d.partial === true, latencyMs: Date.now() - (s.generatedMs || Date.now()) })
      }
    } catch (e) {}
    return d.adoptSnapshot(snap, c) as T
  }

  /**
   * 把「每个会话在处理哪些票」的读数挂到一份 ok:true 的回包上（票 #721 的界面那一块读的就是它）。
   *
   * 为什么包在最外一层、而不是写进 buildSnap：缓存短路那两条回的是缓存里**同一个对象**，
   * 写进信封会把读数的时刻冻在缓存落盘那一刻。读数每次现算，所以这一步只能在回包交出去之前做。
   *
   * 2026-09-24：这一步从 sessionSnapshot.js 搬到这里，因为**两条回包路径都要用它**——
   * wf.snapshot 一直挂着这个字段，wf.refresh 从来没挂过，界面走过一次强制刷新就永久显示
   * 「读不到处理记录」（真机反馈的那条）。搬家之后两条路共用同一份信封与同一个挂载口，
   * 「两边字段不一样」这种漂移不再可能悄悄发生（tests/verify-reply-envelope-parity.js 每次比对）。
   *
   * 回包不是 ok:true（失败那种）、或接线处没给读数函数，都原样返回：不挂字段，
   * 也不能把一份失败的快照伪装成成功的。
   *
   * 类型说明（#1155）：回包形状由各条电话自己定，这里按调用方传进来的类型原样还回去。
   */
  function withChainReadout<T>(reply: T): T {
    if (!reply || typeof reply !== 'object') return reply
    const r = reply as { ok?: unknown; [key: string]: unknown }
    if (r.ok !== true) return reply
    if (typeof d.chainReadout !== 'function') return reply
    try { r[d.chainField || 'sessionTickets'] = d.chainReadout() } catch (eR) { /* 读数取不到不影响这份快照本身 */ }
    return reply
  }

  return { buildSnap: buildSnap, adoptSnapLog: adoptSnapLog, withChainReadout: withChainReadout }
}
