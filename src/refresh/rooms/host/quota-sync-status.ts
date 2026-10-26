// 后台额度同步的「最近一次失败」记事本（#1006）：后台同步成功还是失败是异步发生的，
// 界面却要在任意时刻回答「额度读数为什么还没同步上来」。这个模块只负责记住每个后端最近一次失败的
// 类别与时刻，房间状态（budget-state）把它带进面板快照，界面据此把「还没同步」说成一句有原因的人话。
//
// 三条约定：
// 1. 成功清掉该后端的失败记录：后台重试一旦成功，旧失败不该继续挂在界面上（否则恢复了也一直报故障）。
// 2. 更旧的结论不覆盖更新的：后台重试可能与首轮同步交错回来，晚到的旧结论不许把「更近的一次失败」改早。
// 3. 只认两种失败类别（hard / soft），判别不了形状的结论整条丢掉：宁可让界面退回中性的
//    「还没同步上来」，也不编一个可能是错的类别（编错类别比不说更坏）。
//
// 纯内存、无日志、无外部依赖：这里记的只是给界面用的一句话素材，真读数由后台同步与账本负责。

/** 失败类别：hard = 这台机器上的命令行工具没准备好，要人处理；soft = 刚才没连上服务，等它自己重试。 */
export type QuotaSyncFailKind = 'hard' | 'soft'

/** 后台同步报上来的一次结论。 */
export interface QuotaSyncInfo {
  readonly ok: boolean
  /** 失败类别；成功时没有这一格。 */
  readonly failKind?: QuotaSyncFailKind
  /** 失败原因，只给人排查看：界面不做机器判断，所以这里只存不翻译。 */
  readonly reason?: string
  /** 结论发生的时刻（毫秒时间戳），用来挡住晚到的旧结论。 */
  readonly at: number
}

/** 某个后端记下的最近一次失败。 */
export interface QuotaSyncFailure {
  readonly lastFailAt: number
  readonly lastFailKind: QuotaSyncFailKind
}

export interface QuotaSyncStatus {
  note: (backendId: string, info: QuotaSyncInfo) => void
  view: (backendId: string) => QuotaSyncFailure | null
}

// 最多记多少个后端：见 createQuotaSyncStatus 里那段「为什么有上限」的注释。
const MAX_BACKENDS = 32

/** 只认两种类别；别的值（含缺失）一律当「判别不了」。 */
function failKindOf(v: any): QuotaSyncFailKind | null {
  return (v === 'hard' || v === 'soft') ? v : null
}

/** 只认有限正数时刻；0、NaN、字符串一律当没有时刻。 */
function momentOf(v: any): number {
  return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0
}

/**
 * 造一个后台同步结论的记事本：note 记结论，view 按后端编号取出最近一次失败（没有失败回 null）。
 *
 * 为什么最多记 32 个后端：这份表只服务「界面把失败说出来」，不是历史库；一个工作区同时连的后端是个位数，
 * 32 足够宽松。不设上限的话，调用方哪天把偏移量、临时后端也当编号传进来，这张表会一路涨到进程结束。
 * 满了淘汰最久没更新的那条：被淘汰的后端只是退回中性的「还没同步上来」，不会把「不知道」说成「没问题」。
 */
export function createQuotaSyncStatus(): QuotaSyncStatus {
  // 键是后端编号，值是那个后端最近一次失败的结论；Map 的插入序就是「最久没被更新」的顺序。
  const lastFail = new Map<string, QuotaSyncFailure>()
  /** 写一条失败记录；同编号重写时先删再插，让它排到 Map 最后（= 最近更新过的那条）。 */
  function remember(id: string, rec: QuotaSyncFailure): void {
    if (lastFail.has(id)) lastFail.delete(id)
    lastFail.set(id, rec)
    while (lastFail.size > MAX_BACKENDS) {
      const oldest = lastFail.keys().next().value as string
      lastFail.delete(oldest)
    }
  }
  function note(backendId: string, info: QuotaSyncInfo): void {
    const id: string = (typeof backendId === 'string') ? backendId : String(backendId == null ? '' : backendId)
    if (!id || !info || typeof info !== 'object') return
    // 成功：下一步已经做成，把这个后端记的失败清掉，旧失败不能再挂在面板上。
    if (info.ok === true) { lastFail.delete(id); return }
    const at = momentOf(info.at)
    const kind = failKindOf(info.failKind)
    // 判别不了类别或时刻的结论整条丢掉：界面那边只能说「还没同步上来」，不猜是哪种失败。
    if (!at || !kind) return
    const prev = lastFail.get(id)
    // 比已记的更旧（按时刻比，不按调用先后）就不覆盖：乱序回来也不会把失败说早。
    if (prev && at < prev.lastFailAt) return
    remember(id, { lastFailAt: at, lastFailKind: kind })
  }
  function view(backendId: string): QuotaSyncFailure | null {
    const id: string = (typeof backendId === 'string') ? backendId : String(backendId == null ? '' : backendId)
    const rec = id ? lastFail.get(id) : undefined
    // 回一份拷贝：调用方改不到记事本里存的那条。
    return rec ? { lastFailAt: rec.lastFailAt, lastFailKind: rec.lastFailKind } : null
  }
  return { note: note, view: view }
}
