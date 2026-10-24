/**
 * src/refresh/rooms/host/write-event-fetch.ts —— 写事件触发的那一趟取数，以及交给下一次探针的补丁（#1472）
 *
 * 为什么要有它：写事件订阅（write-event-subscription.ts）在 deck_* 写工具成功之后会叫一次 fetch，
 * 从前那一格是 refresh-runtime 里的空实现（恒回 0 条、0 点）。于是票在远端改了、胶囊与面板却还画旧状态，
 * 用户只能等下一次整份快照重建（真机日志里是 25 秒级）。本文件把那一格换成真的取数：
 * 只补「刚才改的那一张票」（一张票一条薄查询），并进宿主快照，再把补丁暂存起来。
 *
 * 两条取数路各管一段，中间靠这一份暂存接起来：
 *  1. 写事件那条路（fetch），按写事件的档位分两支：
 *     · patch-now（改标题/评论、关票等，点得出票号）→ patch.patchTickets 补那一行；
 *     · probe-now（新建票，payload 里没有票号）→ patch.patchChanged 先问窗口索引、再只补变的那几条。
 *     补成功就把新快照暂存，等下一次探针来取。
 *  2. 探针那条路（takeWritePatch）：wf.probe 一来先问这里有没有刚补好的快照；有就直接回给客户端，
 *     不必再去问窗口索引、更不必整份重建。只交一次，之后照旧走正常探测。
 *
 * 为什么暂存而不直接推给客户端：探针是客户端唯一的「我要不要刷新」入口，写事件本身没有回包通道；
 * 在这里改协议就是新开一条推送，风险远大于「让下一次探针顺手带走」。
 *
 * 不许改的红线（票面 #1444 裁决）：fetch 的返回值里 requests / points 恒为 0。
 * 那两个数写进 write.sent 日志，是「管线里这一笔花了多少」的记账位，真实用量归 #1446，
 * 这里不许自己编一个数字 —— 补齐这一趟真实的薄查询条数另走 refresh.patch 那一行日志。
 *
 * 失败不静默：没有根映射（写事件那条路不知道该往哪个工作区补）、补取数抛错、暂存的补丁过期丢弃，
 * 各记一行既有事件 refresh.patch（reason=write-no-root / write-patch-threw / write-patch-expired，
 * 抛错那一行带 err 原文截断）；「有映射但补不成」由 patch 自己按真实 reason 记
 * （rebuild / failed / stale-dropped），这里不重复记、更不假装补过。
 */

/** 装配这一格要的依赖：拿行级增量的入口、短散列、目录归一。 */
export interface WriteEventFetchDeps {
  patchOf: () => any
  hash8: (input: any) => string
  canonicalKey?: any
  /** 只给门禁用：拨「现在几点」，好让「过了多久算过期」不必真等。生产不传，走 Date.now。 */
  now?: () => number
}

/** 暂存补丁最多留多久：写事件之后探针通常在几秒内就到，超过这个时限说明这一趟已经无关了。 */
const PATCH_TTL_MS = 15000

/**
 * 造出写事件取数那一格。回四件：
 *   fetch(step, meta)        写事件订阅在 fire 里 await 的那一格，回 { requests:0, points:0 }（见文件头红线）
 *   remember(root) / forget(root)  与写事件白名单同步维护「短散列 → 工作区目录」的映射
 *   takeWritePatch(cwd)      探针进来先取一次：有刚补好的快照就交出去（只交一次）
 */
export function createWriteEventFetch(deps: WriteEventFetchDeps): any {
  const d: any = deps || {}
  const patchOf: () => any = d.patchOf
  const hash8: (input: any) => string = d.hash8
  const canonicalKey: any = d.canonicalKey
  const now: () => number = (typeof d.now === 'function') ? d.now : Date.now

  /** 活跃工作区根的短散列 → 归一后的工作区目录（写事件只带散列，不带目录）。 */
  const rootByHash: Record<string, string> = {}
  /** 工作区目录 → 最近一次补好的补丁（只留一份，探针取走即删）。 */
  const pendingByCwd: Record<string, any> = {}

  /** 借 patch 的日志出口发一行 refresh.patch：这个事件的字段口径全仓只有那一处，这里不再写第二份。 */
  function log(mode: string, reason: string, extra?: any): void {
    try {
      const p: any = patchOf()
      if (p && typeof p.log === 'function') p.log(mode, reason, extra || {})
    } catch (eL: any) { /* 日志不许把主流程带崩 */ }
  }

  /** 把工作区根归一一次（写事件那一侧也是按 canonicalKey 的产物算散列的，两处必须同一把钥匙）。 */
  async function canonicalOf(root: any): Promise<string> {
    const raw: string = String(root || '')
    if (!raw || typeof canonicalKey !== 'function') return raw
    try { return String(await canonicalKey(raw) || raw) } catch (eC: any) { return raw }
  }

  /** 活跃集合里有这个根了（与 writeEvents.allowRoot 同步调）：记住它的散列。 */
  async function remember(root: any): Promise<void> {
    const key: string = await canonicalOf(root)
    if (!key) return
    try { rootByHash[hash8(key)] = key } catch (eH: any) {}
  }

  /** 这个根切走了（与 writeEvents.forgetRoot 同步调）：映射与还没取走的补丁一起收摊。 */
  async function forget(root: any): Promise<void> {
    const raw: string = String(root || '')
    if (!raw) return
    const hashes: string[] = []
    const key: string = await canonicalOf(root)
    try { hashes.push(hash8(String(key || raw))) } catch (eH: any) {}
    if (key && key !== raw) { try { hashes.push(hash8(raw)) } catch (eH2: any) {} }
    hashes.forEach(function (h: string): void {
      const cwd: any = rootByHash[h]
      if (cwd) { delete pendingByCwd[cwd]; delete rootByHash[h] }
    })
  }

  /** 补好的一份先存着，等下一次探针取走：只有真的并进快照（带 snapshot）才算补好。 */
  function stash(cwd: string, res: any, keyHash: string): void {
    if (res && res.mode === 'patch' && res.snapshot) {
      pendingByCwd[cwd] = {
        mode: 'patch', rows: res.rows || [], version: res.version, snapshot: res.snapshot,
        queries: Number(res.queries) || 0, partial: res.partial === true, at: now(), keyHash: keyHash,
      }
    } else {
      // 没补成也要留下为什么（rebuild / failed / stale-dropped / 空结果）：静默回 0 就是「假装补过」。
      log('failed', String((res && res.reason) || 'write-patch-empty'), { keyHash: keyHash })
    }
  }

  /**
   * 写事件订阅在 fire 里 await 的那一格：只补「刚才写的那一张票」，补好就暂存给下一次探针。
   * 回值按 #1444 裁决恒为 0 条、0 点（见文件头红线）。
   */
  async function fetch(step: any, meta: any): Promise<{ requests: number; points: number }> {
    const zero: { requests: number; points: number } = { requests: 0, points: 0 }
    let keyHash: string = ''
    try {
      if (!step) return zero
      const wantsTicket: boolean = step.action === 'patch-now' && step.ticket != null && step.ticket !== ''
      const wantsProbe: boolean = step.action === 'probe-now'
      if (!wantsTicket && !wantsProbe) return zero
      keyHash = String((meta && meta.workspaceKey) || '')
      const cwd: any = keyHash ? rootByHash[keyHash] : ''
      if (!cwd) { log('failed', 'write-no-root', { keyHash: keyHash }); return zero }
      const patch: any = patchOf()
      // 改/关已有票：写事件已经点得出票号，直接补那一张（一张票一条薄查询）。
      // 新建票：payload 里没有票号（deck_issue_create），得先问窗口索引再只补新增的那几条。
      const res: any = wantsTicket
        ? await Promise.resolve(patch.patchTickets(cwd, [String(step.ticket)]))
        : await Promise.resolve(patch.patchChanged(cwd))
      stash(cwd, res, keyHash)
    } catch (eF: any) { log('failed', 'write-patch-threw', { keyHash: keyHash, err: (eF && eF.message) || String(eF) }) }
    return zero
  }

  /**
   * 探针进来先问这一句：有刚补好的快照就交出去，没有就回 null 让探针照旧走窗口探测。
   * 只交一次（取走即删），过期的直接丢掉——同一份补丁被重放会让客户端反复回到旧版本。
   * at 一起交出去：探针拿它当回包的 since（补丁覆盖到哪一刻），不能拿「此刻」冒充。
   */
  function takeWritePatch(cwd: any): any {
    const key: string = String(cwd || '')
    const p: any = key ? pendingByCwd[key] : null
    if (!p) return null
    delete pendingByCwd[key]
    if (!(now() - Number(p.at || 0) <= PATCH_TTL_MS)) { log('stale-dropped', 'write-patch-expired', { keyHash: p.keyHash || '' }); return null }
    return { mode: 'patch', rows: p.rows, version: p.version, snapshot: p.snapshot, queries: p.queries, partial: p.partial, at: p.at }
  }

  return { fetch: fetch, remember: remember, forget: forget, takeWritePatch: takeWritePatch }
}
