// src/host/platform/issueIndexWindow.js —— 「远端有没有变」那套状态与水印的持有者（#723 T19c · 第 E 件）
//
// 这一块从 src/host/issueList.js 里搬出来，只为一个原因：那个文件贴着 350 行上限（tests/verify-file-granularity.js），
// 水印收口那一段加进去就超了。搬运时行为一个字没改，只是把三个注入点（getRepoKey / readDiskCache / fetchIssueIndex）
// 变成构造参数。为什么这个文件住在 src/host/platform/：同层互引门禁把 src/host/ 整棵树算作宿主层，
// 而本文件的调用方 issueList.js 也在宿主层里 —— 搬进任何一个宿主层目录都要新增一条同层引用边。
//
// 它守的是一条纪律（#723 第 E 件）：**水印与基线只在变化真的并进列表之后才推进**。
//   从前是「探测一回来就推」：那条变化还没并进任何列表，水印先走了，它掉出下一次的扫描窗口，
//   此后再也没人见过它 —— 静默漏报。行级增量那条路（refresh/patch.js）是「并进列表之后才推」，
//   两个所有者并存就是这个后果，所以收口成：本文件只算「下一次该从哪儿扫」，推不推由调用方说了算，
//   唯一的推进口是下面这个 commit（探测回来说没变、或变化真的并进了快照，才允许调它）。
//
// 日志：本文件不新增事件，也不自己记日志（判断与发射都不在这里）。
import * as indexWindow from '../../shared/tracker/indexWindow.js'

/**
 * 建一份「窗口索引状态」。deps 由 src/host/issueList.js 注入：
 *   getRepoKey(cwd)              → { owner, name }
 *   readDiskCache(repo)          → 磁盘上那份快照（给重启后的第一次扫描立起点）
 *   fetchIssueIndex(cwd, since)  → 只问窗口内的变化，回 { ok, repo, index, count }
 *   now                          → 取时间（门禁注入假时钟）
 * 回包：{ scan(cwd, opts), commit(cwd, nextWatermarkMs, nextIndex), state(cwd) }
 */
export function createIssueIndexWindowState(deps) {
  const d = deps || {}
  const now = typeof d.now === 'function' ? d.now : Date.now
  const lastIndexBaselineByRepo = {}   // 仓库键 → 上一次的完整索引（增量已并入）
  const lastIndexWatermarkByRepo = {}  // 仓库键 → 上一次扫描的起点时刻

  // 重启后第一次扫描的起点：内存里的水印与基线一重启就没了，磁盘快照里带着完整的票与状态，
  // 口径与索引扫描一致，可直接当基线；取不到（没缓存或太旧）就整扫一遍，行为与从前一致。
  let _seedP = null
  function seedFor(cwd) {
    if (!_seedP) {
      _seedP = (async function () {
        try {
          if (typeof d.readDiskCache !== 'function' || typeof d.getRepoKey !== 'function') return null
          const rk = await d.getRepoKey(cwd)
          if (!rk) return null
          const snap = await d.readDiskCache(rk)
          if (!snap) return null
          return indexWindow.seedFromSnapshot(snap, now())
        } catch (e) { return null }
      })()
    }
    return _seedP
  }

  async function repoKeyOf(cwd) {
    try {
      const repo = await d.getRepoKey(cwd)
      if (!repo || !repo.owner || !repo.name) return null
      return { repo: repo, rk: repo.owner + '/' + repo.name }
    } catch (e) { return null }
  }

  /**
   * 扫一次窗口。opts.commit === true 时才把「基线 + 下一次的水印」记下来（默认不记）。
   * 回包里如实带着 nextWatermarkMs 与 watermarkCommitted，让调用方按「变化并进列表了没有」决定推不推。
   */
  async function scan(cwd, opts) {
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
    const w = indexWindow.scanWindow(lastIndexWatermarkByRepo[rk], startedMs)
    const remote = await d.fetchIssueIndex(cwd, w.sinceIso)
    if (!remote || remote.ok !== true) return remote || { ok: false, error: { kind: 'env', error: '索引扫描没有回包' } }
    const before = lastIndexBaselineByRepo[rk] || null
    const merged = indexWindow.mergeDelta(before, remote.index)
    const changed = indexWindow.indexDiffers(before, merged)
    const nextWatermarkMs = indexWindow.nextWatermark(startedMs)
    // 基线同水印一条理由：基线一推，「有没有变」这个判断也跟着提前消费掉——被推迟的那一次就再也补不回来。
    if (o.commit === true) commit(rk, nextWatermarkMs, merged)
    return { ok: true, repo: remote.repo, index: merged, count: Object.keys(merged).length, changed: changed, windowed: !w.full, windowCount: remote.count, nextWatermarkMs: nextWatermarkMs, watermarkCommitted: o.commit === true }
  }

  /** 水印与基线唯一的推进口：只许往前走，也不许把基线换成更旧的一份。 */
  function commit(rkOrCwd, nextWatermarkMs, nextIndex, isRepoKey) {
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

  /** 给调用方按工作区目录推进（内部先解析仓库键）。 */
  async function commitByCwd(cwd, nextWatermarkMs, nextIndex) {
    const hit = await repoKeyOf(cwd)
    if (!hit) return { ok: false, reason: 'no-repo' }
    return commit(hit.rk, nextWatermarkMs, nextIndex, true)
  }

  /** 这一路现在的读数（排查与门禁用；不含任何路径原文）。 */
  function state(cwd) {
    const keys = Object.keys(lastIndexWatermarkByRepo)
    return { repos: keys.length, watermarkMs: 0 }
  }

  return { scan: scan, commit: commitByCwd, state: state }
}
