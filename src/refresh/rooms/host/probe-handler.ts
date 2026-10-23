/**
 * src/refresh/rooms/host/probe-handler.ts —— 面板增量探针处理器（wf.probe 的处理体）。
 *
 * 为什么要有它（一句话）：增量探针原来是评论读写电话里的第六个电话，探针水印、窗口索引、
 * 行级增量的逻辑自成一体，留在一起改探针要读完整文件的上下文，拆出来之后探针只改这一个文件。
 *
 * 来源：src/refresh/rooms/host/comment-thread-fetch.ts 的 handleProbe（#1429 C3 拆分，只移动代码、
 * 行为零变化；D4 起宿主入口与门禁夹具都直连这里，comment-thread-fetch 不再暴露探针）。
 *
 * 不能改的约定（与原来完全一致）：
 * 1. 探针水印只在变化真的并进列表之后才推进（commitIssueIndex），没并进去时一个字节都不动，
 *    否则那条变化会被挤出下一次的扫描窗口，此后再也发现不了（原来文件头第 3 条）。
 * 2. since 语义：窗口索引返回 changed=true 才视为变化；GitHub 与 composer 两条路各走各的取数，
 *    配额仍走 REST 池，不烧穿。
 */
import { idOfParts } from '../../../tracker/kernel/identity-keys.js'

/** 探针处理器收到的依赖：目录归一、后端选择、注册表、平台、索引与缓存等，全由调用点显式传入。 */
export interface ProbeHandlerDeps {
  canonicalKey: any
  selectEarly: any
  isComposerSelection: any
  getTrackerRegistry: any
  getPlatform: any
  ctx: any
  fetchIssueIndexWindowed: any
  issueIndexChanged: any
  rememberIssueIndex: any
  commitIssueIndex: any
  getCache: any
  setCache: any
  lastIssueIndexByRepo: any
  lastProbeAtByRepo: any
  deltaRefresh: any
  errText: any
}

/** 造出探针电话：目前只有一个 handleProbe（wf.probe 的处理体）。 */
export function createProbeHandler(deps: ProbeHandlerDeps): { handleProbe: (args: any) => Promise<any> } {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, fetchIssueIndexWindowed, issueIndexChanged, rememberIssueIndex, commitIssueIndex, getCache, setCache, lastIssueIndexByRepo, lastProbeAtByRepo, deltaRefresh, errText } = deps
  // v1.5 R2（#2 MVP）：probe 改用 `since` 时间戳探测全 issue 增量（地图 + 子票 + 其他），
  //   1 次 REST 调用覆盖全仓库变化。原实现 `labels=wayfinder:map` 仅匹配地图本身，
  //   **漏检所有子票变化**——面板可接/阻塞/已认领/已关闭分组（DESIGN.md §5.2）都是子票，
  //   故"列表不更新状态"。since 语义：返回数组非空 = 自上次快照以来有变化 → 视为 changed。
  //   配额仍走 REST 5000/h 池（独立于 GraphQL 5000 点/h），不烧穿。
  async function handleProbe(args: any): Promise<any> {
    // #1003 空目录闸：同上。
    const _rawProbeCwd: string = (args && typeof args.cwd === 'string' && args.cwd.trim()) ? args.cwd : ''
    if (!_rawProbeCwd) return { ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }
    const cwd: any = await canonicalKey(_rawProbeCwd)
    // 第一性原理分发：经 index 从会话启停模块转供给共享判据（H4 同例），不各留一份拷贝。
    // markdown 等走轻量 list 探针，github 仍走 gh issue index
    const _selProbe: any = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined })
    const useProbeTracker: any = isComposerSelection(_selProbe)
    if (useProbeTracker) {
      try {
        const reg: any = await getTrackerRegistry()
        const tracker: any = reg.get(_selProbe.backendId)
        if (tracker && typeof tracker.list === 'function') {
          let repoRef: any = null
          try { repoRef = reg.describe({ cwd }, _selProbe.backendId) } catch {}
          if (!repoRef) repoRef = { backend: _selProbe.backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || _selProbe.backendId, url: '' }
          const opCtx: any = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
          const r: any = await tracker.list(repoRef, {}, opCtx)
          if (!r || !r.ok) return { ok: false, error: errText((r && r.error) || 'probe list 失败') }
          const all: any[] = Array.isArray(r.data) ? r.data : []
          // 轻量索引：key -> state
          const idx: Record<string, string> = {}
          // effort 维度：探针索引按 (effort, 编号) 键入，否则两个 effort 的同号票会互相覆盖、第二个 effort 的变更探测不到
          all.forEach(function(it: any){ const k: any = it && (it.key != null ? idOfParts(it.effortId, String(it.key).padStart(2,'0')) : (it.number != null ? idOfParts(it.effortId, String(it.number).padStart(2,'0')) : '')); if(k) idx[k] = String(it.state||'OPEN').toUpperCase() })
          const rk1: string = _selProbe.backendId + ':' + cwd
          const known: any = lastIssueIndexByRepo[rk1] || {}
          const changed: any = issueIndexChanged(known, idx)
          rememberIssueIndex({ owner: _selProbe.backendId, name: cwd }, idx)
          // 兼容 remember 的 repoKey 形态：用 backendId+cwd 作 key，避免与 github 的 owner/name 串
          lastIssueIndexByRepo[rk1] = idx
          lastProbeAtByRepo[rk1] = new Date().toISOString()
          if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
          return { ok: true, changed: changed, repo: { owner: _selProbe.backendId, name: String(cwd).split(/[\\/]/).pop()||'' }, count: all.length, since: lastProbeAtByRepo[rk1] }
        }
      } catch (e: any) { return { ok: false, error: errText(e) } }
    }
    try {
      // 增量索引（本轮新增）：改走 fetchIssueIndexWindowed —— 它只回答「自上次以来有没有变」，
      //   并把增量并进完整基线后给出 changed。这里不再自己维护一份基线、也不再自行比对：
      //   两份状态会各自漂移，而漂移的后果是面板长期显示旧数据且不报错（静默漏报，最难查）。
      // #723（T19c）第 E 件：探测说变了之后，**先把变的那几条补进列表**（src/refresh/rooms/host/row-patch.js 的
      //   行级增量：一张票一条薄查询），再回给客户端那一份补好的结果 —— 从前这一步没人做，
      //   客户端只能整池重建，于是「只补变的那几条」那条窄路白写了。
      //   水印只在这一步真的并进列表之后才推进（commitIssueIndex），被推迟 / 被丢弃 / 失败时
      //   一个字节都不动 —— 否则那条变化会被挤出下一次的扫描窗口，此后再也发现不了。
      const remote: any = await fetchIssueIndexWindowed(cwd)
      if (!remote.ok) return { ok: false, error: errText(remote.error || 'probe 失败') }
      const repo: any = remote.repo
      const rk1: string = repo.owner + '/' + repo.name
      const changed: boolean = remote.changed === true
      lastProbeAtByRepo[rk1] = new Date().toISOString()
      const commit: any = function (): any { try { return commitIssueIndex(cwd, remote.nextWatermarkMs, remote.index) } catch (eC: any) { return null } }
      if (!changed) {
        // 没变 = 列表与远端一致，推水印（与基线）是安全的（不推就要每拍重扫同一个窗口）。
        commit()
        return { ok: true, changed: false, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      let delta: any = null
      try { delta = (typeof deltaRefresh === 'function') ? await deltaRefresh(cwd, {}) : null } catch (eD: any) { delta = null }
      if (delta && delta.mode === 'patch' && delta.rows && delta.rows.length) {
        // 并进列表了：水印与基线跟着走，客户端直接用这一份（不再发整池大查询）。
        commit()
        const cur: any = (typeof getCache === 'function') ? getCache(cwd) : null
        return {
          ok: true, changed: true, mode: 'patch', repo: repo, count: remote.count,
          rows: delta.rows, version: delta.version, queries: delta.queries, partial: delta.partial === true,
          snapshot: (cur && cur.snapshot) ? cur.snapshot : null, since: lastProbeAtByRepo[rk1],
        }
      }
      if (delta && delta.mode === 'nothing') {
        commit()
        return { ok: true, changed: false, mode: 'nothing', repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      if (delta && (delta.mode === 'deferred' || delta.mode === 'failed' || delta.mode === 'stale-dropped')) {
        // 没并进去：水印与基线一个字节都不动 —— 那条变化下一次仍然在窗口里、仍然会被发现；
        // 客户端这一拍什么都不用做（它就靠这个「没并进去」的回报原地不动）。
        return { ok: true, changed: true, mode: delta.mode, reason: String(delta.reason || ''), pending: delta.pending || 0, repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
      }
      // 该整池的那几档（冷启动 / 票号增减 / 条数过多 / 旧结构）：如实告诉客户端「这一次得整池」。
      // 这一档推水印与基线：客户端收到之后就会整池重建，那一次会把整仓重拿一遍，变化是被并进列表的
      // （不推的话每一拍都要从很旧的水印重扫，白烧额度）。
      if (changed) setCache({ ts: 0, snapshot: null, error: null, cwd: cwd })
      commit()
      return { ok: true, changed: true, mode: 'rebuild', reason: String((delta && delta.reason) || 'no-delta'), repo: repo, count: remote.count, since: lastProbeAtByRepo[rk1] }
    } catch (e: any) { return { ok: false, error: errText(e) } }
  }
  return { handleProbe }
}
