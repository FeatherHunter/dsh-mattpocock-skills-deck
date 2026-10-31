// src/refresh/rooms/host/issue-index-scan.ts —— 从同目录 issueIndexWindow.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：「远端有没有变」那套状态与水印的持有者，转成 TypeScript 后调用方
//   （同在宿主层的 issueList.js）能按类型取用扫描与推进入口，水印口径仍与原来逐行一致。
// 什么约定不能改：
//   1. 水印与基线只在变化真的并进列表之后才推进：本文件只算「下一次该从哪儿扫」，推不推由调用方说了算。
//   2. 唯一的推进口是下面的 commit（探测回来说没变、或变化真的并进了快照，才允许调它），只许往前走。
//   3. 同名但不同目录的另一份 src/refresh/kernel/index-window-rules.js 是时间窗与水印规则的真源，
//      本文件只是它的持有者与装配点，两份互不干扰：改规则去共享层那一份，改持有状态才动这一份。
//   4. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mts 改指同名 .ts，本文件不改说明符。
//   5. 只写可剥离类型：类型一律经 import type 引入或就地声明，不新增任何运行时边。
//   6. 本文件不新增事件，也不自己记日志（判断与发射都不在这里）。
import * as indexWindow from '../../kernel/index-window-rules.js'

// 构造参数由 src/refresh/rooms/host/issue-list-fetch.js 注入，按实际读到的格子声明，缺省一律按没有处理。
interface IssueIndexWindowDeps {
  // 取仓库键（工作区目录原文进来，仓库三元组出去）
  getRepoKey?: (cwd: string) => Promise<{ owner: string; name: string } | null | undefined>
  // 磁盘上那份快照（给重启后的第一次扫描立起点）
  readDiskCache?: (repo: unknown) => Promise<any>
  // 只问窗口内的变化（回包带 repo/index/count）。#1689 起尾参可带一本本轮预算账本：
  // 带 since 的窗口扫描可以用探针同一轮的增量账本继续预扣，整仓枚举由取数入口自己开枚举账本。
  fetchIssueIndex?: (cwd: string, sinceIso: string, budget?: any) => Promise<any>
  // 取时间（门禁注入假时钟）
  now?: () => number
}

// 仓库键解析结果：仓库原文与 owner/name 拼成的键。
interface RepoHit {
  repo: { owner: string; name: string }
  rk: string
}

// 建一份「窗口索引状态」。deps 由 src/refresh/rooms/host/issue-list-fetch.js 注入：
//   getRepoKey(cwd)              → { owner, name }
//   readDiskCache(repo)          → 磁盘上那份快照（给重启后的第一次扫描立起点）
//   fetchIssueIndex(cwd, since)  → 只问窗口内的变化，回 { ok, repo, index, count }（#1689 起尾参可带本轮预算账本）
//   now                          → 取时间（门禁注入假时钟）
// 回包：{ scan(cwd, opts), commit(cwd, nextWatermarkMs, nextIndex), state(cwd) }
export function createIssueIndexWindowState(deps: IssueIndexWindowDeps | null | undefined): {
  scan: (cwd: string, opts?: { commit?: boolean; budget?: any }) => Promise<any>
  commit: (cwd: string, nextWatermarkMs: number, nextIndex?: Record<string, any>) => Promise<any>
  state: (cwd: string) => { repos: number; watermarkMs: number }
} {
  const d: IssueIndexWindowDeps = deps || {}
  const now: () => number = typeof d.now === 'function' ? d.now : Date.now
  const lastIndexBaselineByRepo: Record<string, any> = {}   // 仓库键 → 上一次的完整索引（增量已并入）
  const lastIndexWatermarkByRepo: Record<string, number> = {}  // 仓库键 → 上一次扫描的起点时刻

  // 重启后第一次扫描的起点：内存里的水印与基线一重启就没了，磁盘快照里带着完整的票与状态，
  // 口径与索引扫描一致，可直接当基线；取不到（没缓存或太旧）就整扫一遍，行为与从前一致。
  let _seedP: Promise<any> | null = null
  function seedFor(cwd: string): Promise<any> {
    if (!_seedP) {
      _seedP = (async function () {
        try {
          if (typeof d.readDiskCache !== 'function' || typeof d.getRepoKey !== 'function') return null
          const rk = await d.getRepoKey(cwd)
          if (!rk) return null
          const snap = await d.readDiskCache(rk)
          if (!snap) return null
          return (indexWindow as any).seedFromSnapshot(snap, now())
        } catch (e) { return null }
      })()
    }
    return _seedP
  }

  async function repoKeyOf(cwd: string): Promise<RepoHit | null> {
    try {
      const repo = await d.getRepoKey!(cwd)
      if (!repo || !repo.owner || !repo.name) return null
      return { repo: repo, rk: repo.owner + '/' + repo.name }
    } catch (e) { return null }
  }

  // 扫一次窗口。opts.commit === true 时才把「基线 + 下一次的水印」记下来（默认不记）。
  // #1689：opts.budget 是调用方（降级探针）注入的本轮请求预算账本，原样转给 fetchIssueIndex 记在翻页那一层；
  // 不注入时取数入口按「带窗口=增量轮 / 不带窗口=枚举轮」自己开一本。
  // 回包里如实带着 nextWatermarkMs 与 watermarkCommitted，让调用方按「变化并进列表了没有」决定推不推。
  async function scan(cwd: string, opts?: { commit?: boolean; budget?: any }): Promise<any> {
    const o = opts || {}
    const hit = await repoKeyOf(cwd)
    if (!hit) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo' } }
    const rk = hit.rk
    if (!lastIndexWatermarkByRepo[rk]) {
      const seed = await seedFor(cwd)
      if (seed && seed.baseline) {
        lastIndexBaselineByRepo[rk] = seed.baseline
        lastIndexWatermarkByRepo[rk] = seed.watermarkMs
      }
    }
    const startedMs = now()
    const w = (indexWindow as any).scanWindow(lastIndexWatermarkByRepo[rk], startedMs)
    const remote = await d.fetchIssueIndex!(cwd, w.sinceIso, o.budget)
    if (!remote || remote.ok !== true) return remote || { ok: false, error: { kind: 'env', error: '索引扫描没有回包' } }
    const before = lastIndexBaselineByRepo[rk] || null
    const merged = (indexWindow as any).mergeDelta(before, remote.index)
    const changed = (indexWindow as any).indexDiffers(before, merged)
    const nextWatermarkMs = (indexWindow as any).nextWatermark(startedMs)
    // 基线同水印一条理由：基线一推，「有没有变」这个判断也跟着提前消费掉——被推迟的那一次就再也补不回来。
    if (o.commit === true) commit(rk, nextWatermarkMs, merged)
    return { ok: true, repo: remote.repo, index: merged, count: Object.keys(merged).length, changed: changed, windowed: !w.full, windowCount: remote.count, nextWatermarkMs: nextWatermarkMs, watermarkCommitted: o.commit === true }
  }

  // 水印与基线唯一的推进口：只许往前走，也不许把基线换成更旧的一份。
  function commit(rkOrCwd: string, nextWatermarkMs: number, nextIndex?: Record<string, any>, isRepoKey?: unknown): any {
    const rk = String(rkOrCwd || '')
    if (!rk) return { ok: false, reason: 'no-repo' }
    const next = Number(nextWatermarkMs)
    if (!isFinite(next) || next <= 0) return { ok: false, reason: 'bad-watermark' }
    if (nextIndex && typeof nextIndex === 'object') lastIndexBaselineByRepo[rk] = nextIndex
    const cur = Number(lastIndexWatermarkByRepo[rk]) || 0
    if (next <= cur) return { ok: true, advanced: false, watermarkMs: cur }
    lastIndexWatermarkByRepo[rk] = next
    return { ok: true, advanced: true, watermarkMs: next }
  }

  // 给调用方按工作区目录推进（内部先解析仓库键）。
  async function commitByCwd(cwd: string, nextWatermarkMs: number, nextIndex?: Record<string, any>): Promise<any> {
    const hit = await repoKeyOf(cwd)
    if (!hit) return { ok: false, reason: 'no-repo' }
    return commit(hit.rk, nextWatermarkMs, nextIndex, true)
  }

  // 这一路现在的读数（排查与门禁用；不含任何路径原文）。
  function state(cwd: string): { repos: number; watermarkMs: number } {
    void cwd
    const keys = Object.keys(lastIndexWatermarkByRepo)
    return { repos: keys.length, watermarkMs: 0 }
  }

  return { scan: scan, commit: commitByCwd, state: state }
}


// ── 扫描入口（#1429 索引扫描拆分）：原 issue-list-fetch.ts 的 _idxState + fetchIssueIndexWindowed +
// commitIssueIndex 整体搬入（注释与实现一字不动，只换落点；上面那段 E 件水印口径说明跟着走）。
// 内含唯一一份窗口状态（createIssueIndexWindowState 在这里只造一次）：调用方经同名转交字段进来，
// 扫与推落在同一份状态上，不另起第二份。为什么工厂参数仍叫 d：搬来的闭包体点 d.X，零改写就是零行为差。
// 依赖由取数入口现取现传（getRepoKey / readDiskCache / 取数入口自己的 fetchIssueIndex / Date.now），
// 与拆分前 _idxState 传的那一份逐字一致。
export function createIssueIndexScan(deps: any): any {
  const d: any = deps || {}
  let stP: any = null
  function _st(): any {
    if (!stP) stP = createIssueIndexWindowState({ getRepoKey: d.getRepoKey, readDiskCache: d.readDiskCache, fetchIssueIndex: function (cwd: any, sinceIso: any, budget: any): Promise<any> { return d.fetchIssueIndex(cwd, sinceIso, budget) }, now: Date.now })
    return stP
  }
    // 增量索引：把「只问变化」的时间窗与水印合并进完整基线，再判有没有真的变。为什么必须合并：
    //   拿全量基线去比一个只含增量的结果，两边大小天然不同，会每次都判成「变了」，后果是每分钟一次
    //   全量重建；为什么水印取「扫描发起之前」：取结束时两次扫描之间会留缝，缝里的改动永远看不到。
    // #723（T19c）第 E 件 · 水印收口：这一条路**不再自己推进水印与基线**（从前是「探测一回来就推」，
    //   那条变化还没并进任何列表，水印先走了就掉出下一次的窗口，谁也再见不到它）。只算「下一次该
    //   从哪儿扫」并如实交回去，推不推由调用方决定，唯一推进口是 commitIssueIndex。状态与规则住在
    //   ./platform/issueIndexWindow.js（调用方 issue-list-fetch.ts 当时贴着 350 行上限，那一段搬过去了；为什么住那一层见那一份文件头）。
  // 尾参 opts 标成可选：原 .js 里 cacheSnapshotIsCurrent 只传 cwd 一个实参，少传在运行时就是 undefined，原样透传给 st.scan；标成必选 tsc 会报 2554，改成 `?` 不产生任何运行时代码。
  async function fetchIssueIndexWindowed(cwd: any, opts?: any): Promise<any> {
    try { const st: any = _st(); return await st.scan(cwd, opts) } catch (e: any) { return { ok: false, error: { kind: 'env', error: String((e && e.message) || e) } } }
  }
  /** 水印与基线唯一的推进口：只在「变化真的并进列表之后」（或探测回来说没变）调它。 */
  async function commitIssueIndex(cwd: any, nextWatermarkMs: any, nextIndex: any): Promise<any> {
    try { const st: any = _st(); return await st.commit(cwd, nextWatermarkMs, nextIndex) } catch (e) { return { ok: false, reason: 'threw' } }
  }
  return { fetchIssueIndexWindowed: fetchIssueIndexWindowed, commitIssueIndex: commitIssueIndex }
}
