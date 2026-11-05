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
  // 只问窗口内的变化（回包带 repo/index/count）。#1689 起尾参可带一本本轮预算账本：
  // 带 since 的窗口扫描可以用探针同一轮的增量账本继续预扣，整仓枚举由取数入口自己开枚举账本。
  fetchIssueIndex?: (cwd: string, sinceIso: string, budget?: any) => Promise<any>
  // #1870：重启后第一次扫描的起点。回「本地快照库回放出来的那份快照」与它最老的一次取数时刻
  // （库里一条票都没有、库打不开、后端认不出都回 null）。后端编号由这一层转手传下去，
  // 装配方不必为了一个字符串再开一趟会话。
  readLibrarySnapshot?: (cwd: string, repo: { owner: string; name: string }, backendId: string) => Promise<{ snapshot: any; oldestRowAtMs: number } | null>
  /**
   * #1887：整仓完整枚举被采用之后回调一次（由 commitIssueIndex 触发，只在调用方明确说
   * 「fullEnumeration: true」时调）。实现住在取数入口：只有那一层摸得到快照库门面。
   */
  onFullEnumeration?: (input: { cwd: string; backendId: string; repoIdentity: string; atMs: number }) => Promise<any> | any
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
//   fetchIssueIndex(cwd, since)  → 只问窗口内的变化，回 { ok, repo, index, count }（#1689 起尾参可带本轮预算账本）
//   now                          → 取时间（门禁注入假时钟）
// #1870：重启后的第一次扫描的起点改从本地快照库取（旧的那份磁盘 JSON 已经不读了）。库里有这一份
// 工作区数据时，第一次扫描就是缩窗的；库为空、库打不开、或者那份数据太旧，照旧退化成一次不带 since
// 的整仓枚举（判据全在 kernel/index-window-rules.ts 的 seedFromSnapshot 里，这里一条都不重写）。
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

  async function repoKeyOf(cwd: string): Promise<RepoHit | null> {
    try {
      const repo = await d.getRepoKey!(cwd)
      if (!repo || !repo.owner || !repo.name) return null
      return { repo: repo, rk: repo.owner + '/' + repo.name }
    } catch (e) { return null }
  }

  /**
   * #1870：库里那份数据给这一轮扫描立起点（基线 + 水印），只在内存里还没有水印时问一次。
   *
   * 回放里没有 generatedMs 这一格——它说的是「这份数据是什么时候取的」，所以用 lastKnownAtMs
   * 顶上去交给 seedFromSnapshot：太旧、没有票、时刻在将来，那三档判据与从前读旧磁盘快照
   * 那一版逐字相同，这里一条都不重写。
   */
  async function seedFromLibrary(cwd: string, repo: { owner: string; name: string }, backendId: string, startedMs: number): Promise<void> {
    if (typeof d.readLibrarySnapshot !== 'function') return
    const rk: string = repo.owner + '/' + repo.name
    let got: { snapshot: any; oldestRowAtMs: number } | null = null
    try { got = await d.readLibrarySnapshot(cwd, repo, backendId) } catch (e) { got = null }
    if (!got || !got.snapshot) return
    // 起点取「行组最老的那一次取数时刻」，不是最新的那一次：见 snapshot-library.ts 的
    // SnapshotReplay.oldestRowAtMs（取最新会让旧行更早发生的改动永远落在窗口外）。
    const seed: any = (indexWindow as any).seedFromSnapshot(
      Object.assign({}, got.snapshot, { generatedMs: Number(got.oldestRowAtMs) || 0 }),
      startedMs,
    )
    if (!seed) return
    // 走唯一的推进口，不直接写两张表：起点也是「水印往前走一步」，同样要过 next>0 与单调性那两道检查。
    commit(rk, seed.watermarkMs, seed.baseline)
  }

  // 扫一次窗口。opts.commit === true 时才把「基线 + 下一次的水印」记下来（默认不记）。
  // #1689：opts.budget 是调用方（降级探针）注入的本轮请求预算账本，原样转给 fetchIssueIndex 记在翻页那一层；
  // 不注入时取数入口按「带窗口=增量轮 / 不带窗口=枚举轮」自己开一本。
  // 回包里如实带着 nextWatermarkMs 与 watermarkCommitted，让调用方按「变化并进列表了没有」决定推不推。
  async function scan(cwd: string, opts?: { commit?: boolean; budget?: any; backendId?: string }): Promise<any> {
    const o = opts || {}
    const hit = await repoKeyOf(cwd)
    if (!hit) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo' } }
    const rk = hit.rk
    const startedMs = now()
    // 这一份工作区在本进程里还没扫过：先问库要起点（重启后就靠这一步不整仓枚举）。
    // 判据是「水印那一格有没有」而不是「基线在不在」：没有水印时 scanWindow 本来就要整扫，
    // 基线在不在都不影响结论，少问一次库也就少开一次句柄。
    if (lastIndexWatermarkByRepo[rk] === undefined) await seedFromLibrary(cwd, hit.repo, String(o.backendId || ''), startedMs)
    const w = (indexWindow as any).scanWindow(lastIndexWatermarkByRepo[rk], startedMs)
    const remote = await d.fetchIssueIndex!(cwd, w.sinceIso, o.budget)
    if (!remote || remote.ok !== true) return remote || { ok: false, error: { kind: 'env', error: '索引扫描没有回包' } }
    const before = lastIndexBaselineByRepo[rk] || null
    const merged = (indexWindow as any).mergeDelta(before, remote.index)
    const changed = (indexWindow as any).indexDiffers(before, merged)
    const nextWatermarkMs = (indexWindow as any).nextWatermark(startedMs)
    // 基线同水印一条理由：基线一推，「有没有变」这个判断也跟着提前消费掉——被推迟的那一次就再也补不回来。
    if (o.commit === true) commit(rk, nextWatermarkMs, merged)
    return {
      ok: true,
      repo: remote.repo,
      // #1887：库身份由取数入口按会话 refId 原样带回来；完整枚举标记要靠它开对的那一个库。
      repoIdentity: String(remote.repoIdentity || ''),
      backendId: String(remote.backendId || ''),
      index: merged,
      count: Object.keys(merged).length,
      changed: changed,
      // windowed = 这一趟只扫了窗口；full = 这一趟是「没有窗口起点」的整仓枚举（两者互为反面）。
      windowed: !w.full,
      full: w.full,
      // 这一趟的行有没有真的写进库；写失败时完整枚举标记不写（commitIssueIndex 会再看一眼）。
      persisted: remote.persisted !== false,
      windowCount: remote.count,
      nextWatermarkMs: nextWatermarkMs,
      watermarkCommitted: o.commit === true,
    }
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
// 依赖由取数入口现取现传（getRepoKey / 取数入口自己的 fetchIssueIndex / Date.now），
// 与拆分前 _idxState 传的那一份逐字一致（#1870 起少了磁盘快照那一格）。
export function createIssueIndexScan(deps: any): any {
  const d: any = deps || {}
  let stP: any = null
  function _st(): any {
    if (!stP) stP = createIssueIndexWindowState({
      getRepoKey: d.getRepoKey,
      fetchIssueIndex: function (cwd: any, sinceIso: any, budget: any): Promise<any> { return d.fetchIssueIndex(cwd, sinceIso, budget) },
      // #1870：起点从本地快照库来（入口经取数入口注入）；没接就照旧整扫一次。
      readLibrarySnapshot: d.readLibrarySnapshot,
      now: Date.now,
    })
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
  /**
   * 水印与基线唯一的推进口：只在「变化真的并进列表之后」（或探测回来说没变）调它。
   *
   * #1887：opts.fullEnumeration 为真时，推完水印再写「上一次完整枚举时刻」。这个判断不在这里做
   * 「是不是真的完整」——取数入口已经把「窗口扫描 / 被截断 / 预算拦住 / 行没写进库」那几档挡在外面，
   * 到得了这里又明说 true 的，就是完整枚举被采用的那一趟。回调失败不影响水印推进（两件事分开记账）。
   */
  async function commitIssueIndex(cwd: any, nextWatermarkMs: any, nextIndex: any, opts?: any): Promise<any> {
    try {
      const st: any = _st()
      const committed: any = await st.commit(cwd, nextWatermarkMs, nextIndex)
      const o: any = opts || {}
      if (committed && committed.ok !== false && o.fullEnumeration === true && typeof d.onFullEnumeration === 'function') {
        try {
          await d.onFullEnumeration({
            cwd: String(cwd || ''),
            backendId: String(o.backendId || ''),
            repoIdentity: String(o.repoIdentity || ''),
            atMs: Date.now(),
          })
        } catch (eM: any) {}
      }
      return committed
    } catch (e) { return { ok: false, reason: 'threw' } }
  }
  return { fetchIssueIndexWindowed: fetchIssueIndexWindowed, commitIssueIndex: commitIssueIndex }
}
