// src/host/snapshotEnvelope.js —— 快照信封的组装与落盘（#723 T19 从 sessionSnapshot.js 原样搬出，纯结构、行为零变化）
//
// 为什么单开这一个文件：会话快照电话（src/host/sessionSnapshot.js）的五条分支（内存缓存短路、磁盘回放、
// 304、重建、失败）都要拼同一个形状的信封，而那个文件贴着 350 行上限（tests/verify-file-granularity.js
// 的零增长基线）—— #723 要往快照回包上挂「每个会话在处理哪些票」的读数时，那个文件已经 349 行。
// 所以先把这两件与电话体无关的纯组装搬出来：谁要改「快照里都有哪些字段」，改这一处就够（#653 的老规矩）。
//
// 搬的时候只搬不改：函数体、注释、字段顺序、`cdk` 兜底值与原来逐字一致；`ghPath` / `ghError` 取的是
// 通话那一刻的宿主状态，所以由调用方（那个电话）每次现取好交进来。
export function createSnapshotEnvelope(deps) {
  const d = deps || {}

  /** 五条分支的快照同形，收在一处组装（#653：加字段改一处，免漏；repo 与 repoRoot 由调用方传入）。 */
  function buildSnap(o) {
    const snap = {
      ok: true,
      repo: (o.repo !== undefined ? o.repo : null),
      repoRoot: o.repoRoot,
      workspaceRoot: o.workspaceRoot,
      updatedAt: new Date().toISOString(),
      generatedMs: Date.now(),
      env: { ghPath: d.getGhPath(), ghError: d.getGhLastError() },
      maps: o.maps, issues: o.issues, labels: o.labels,
      repository: (o.repository !== undefined ? o.repository : null),
      backendModules: o.backendModules,
      selection: o.selection,
      setupLayout: (o.setupLayout !== undefined ? o.setupLayout : null),
      capabilities: null,
      viewer: (o.viewer !== undefined ? o.viewer : null),
      viewerLogin: (o.viewerLogin !== undefined ? o.viewerLogin : null),
      deck: o.deck, fallback: (o.fallback === 'rest' ? 'rest' : null), refresh: (o.refresh || null),
    }
    return snap
  }

  // #689：snapshot.built 多了三个字段（open / closed 是后端计数给的真值、拿不到记 -1；partial 说这份行数据全不全）
  // —— 加在既有事件里不新增一条（每次重建都会走到这里），字段表见 research/489-appendix.md 第 1 章。
  async function adoptSnapLog(snap, c) {
    try {
      const logCtx = d.logCtx
      if (logCtx && snap && snap.fromCache !== true) {
        const _d = (snap.deck && typeof snap.deck === 'object') ? snap.deck : {}
        const _ct = (_d.counts && typeof _d.counts === 'object') ? _d.counts : null
        logCtx.fire('info', 'snapshot.built', { maps: (snap.maps || []).length, issues: (snap.issues || []).length, labels: (snap.labels || []).length, open: _ct ? _ct.open : -1, closed: _ct ? _ct.closed : -1, partial: _d.partial === true, latencyMs: Date.now() - (snap.generatedMs || Date.now()) })
      }
    } catch (e) {}
    return d.adoptSnapshot(snap, c)
  }

  return { buildSnap: buildSnap, adoptSnapLog: adoptSnapLog }
}
