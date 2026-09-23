/**
 * refresh-core/src/backend-quota.ts —— 每个后端的额度桶长什么样、一笔花费怎么按后端算价（#719 收口）
 *
 * 解决的是什么问题：账本与闸是按「桶」记账的，而桶的形状不是三个后端共用的。
 * GitHub 有两个互相独立的桶——REST 数请求条数、GraphQL 数点数，两桶各自一份额度、互不折算；
 * GitLab 只有请求条数这一种口径，没有点数制；本地 Markdown 后端读写的是本机文件，根本不出站，
 * 因此既没有额度也没有花费。把这三件事写在一处、由闸与账本按后端取，比在三处各写一段
 * 「如果是 GitHub 就……」可靠得多。
 *
 * 本文件不写任何**额度数值**。服务端上限（每小时多少）由账本每分钟从服务端读数里取回来
 * （GitHub 走那个不扣配额的 `gh api rate_limit`），这里的模型只回答「有几个桶、每个桶按什么单位
 * 计数、两桶独不独立、这个后端到底计不计费」。这样做的原因与 budget.ts 同源：额度常量只能有
 * 一处物理真源，而「服务端此刻还剩多少」本来就只能现场读，写死一个数就会骗人。
 *
 * 关于 GitLab 的那一格，口径写死为「按请求数计费，具体数值待实测」：今天没有实测依据，
 * 就不写一个看起来像真的点数制。宁可缺一个数，也不要多一个编出来的数。
 *
 * 为什么本文件一个数字都不写、全部是形状与判定：刷新核心的产物（src/shared/refresh/*.js）之间
 * 不许互相 import（tests/verify-no-same-layer-import.js 与 tests/verify-refresh-freshness.js 的
 * 「产物零相对引用」两条门禁一起守这件事）。额度常量因此只有一处物理真源（budget.ts），
 * 做法与 policy.ts / backoff.ts / tool-cost.ts 一致。
 */

/** 一个后端有几种额度口径。 */
export type BackendBudgetKind =
  /** 两个互相独立的桶，各有各的额度（今天只有 GitHub）。 */
  | 'two-buckets'
  /** 只有「发出去了多少条请求」这一种口径，没有点数制（今天只有 GitLab）。 */
  | 'requests-only'
  /** 不出站：读写都在本机，既没有额度也没有花费（本地 Markdown 后端）。 */
  | 'off-network'
  /** 还没认出来的后端：只按请求数记账，点数口径等那个后端定下来再补。 */
  | 'unknown'

/** 一个后端的额度桶形状。 */
export interface BackendBudgetModel {
  /** 后端标识，与仓库里三个后端房间的名字一致：github / gitlab / markdown。 */
  backendId: string
  /** 这个后端属于哪一类口径。 */
  kind: BackendBudgetKind
  /** 这个后端出站请求要不要计费（本地 Markdown 后端不出站，所以为假）。 */
  countsRequests: boolean
  /** 这个后端有没有「点数」这种口径（GitHub 有；GitLab 与本地 Markdown 没有）。 */
  countsPoints: boolean
  /** 两个桶是不是互相独立、各自一份额度（今天只有 GitHub 是）。 */
  independentBuckets: boolean
  /** 一句话说清这个后端的额度桶长什么样，给人和门禁读。 */
  summary: string
}

/**
 * 三个内置后端的额度桶形状 + 一个「还没认出来的后端」的兜底形状。
 *
 * 兜底那一格为什么不猜成 GitHub 那张形状：猜错的方向决定后果——若某个新后端其实有独立的点数桶，
 * 猜成「只有请求数」只是少记了点数（少花，安全的一侧）；反过来把没有点数制的后端猜成两点数桶，
 * 会凭空算出一份额度、让闸以为自己有钱。兜底一律取更省的那一侧。
 */
export const BACKEND_BUDGET_MODELS: readonly BackendBudgetModel[] = Object.freeze([
  Object.freeze({
    backendId: 'github',
    kind: 'two-buckets' as BackendBudgetKind,
    countsRequests: true,
    countsPoints: true,
    independentBuckets: true,
    summary: 'GitHub：两个互相独立的桶——REST 数出站请求条数、GraphQL 数点数，两桶各自一份额度、互不折算；上限由账本每分钟从服务端读数取回来。',
  }),
  Object.freeze({
    backendId: 'gitlab',
    kind: 'requests-only' as BackendBudgetKind,
    countsRequests: true,
    countsPoints: false,
    independentBuckets: false,
    summary: 'GitLab：只有出站请求条数这一种口径，没有点数制；额度数值待实测，此处不写一个编出来的数。',
  }),
  Object.freeze({
    backendId: 'markdown',
    kind: 'off-network' as BackendBudgetKind,
    countsRequests: false,
    countsPoints: false,
    independentBuckets: false,
    summary: '本地 Markdown：读写都在本机文件，不出站，因此没有额度也没有花费。',
  }),
  Object.freeze({
    backendId: '',
    kind: 'unknown' as BackendBudgetKind,
    countsRequests: true,
    countsPoints: false,
    independentBuckets: false,
    summary: '还没认出来的后端：只按出站请求条数记账，点数口径等那个后端定下来再补（少花的一侧，不是多花的一侧）。',
  }),
])

/** 按后端标识取配额模型；认不出来的一律回兜底那一格，绝不抛错也绝不回空对象。 */
export function backendBudgetModel(backendId: string): BackendBudgetModel {
  const id = String(backendId || '').trim().toLowerCase()
  for (const m of BACKEND_BUDGET_MODELS) {
    if (m.backendId !== '' && m.backendId === id) return m
  }
  for (const m of BACKEND_BUDGET_MODELS) {
    if (m.backendId === '') return m
  }
  /* istanbul ignore next —— 兜底那一格永远在表里；真被删掉时给一个同样更省的形状，不要抛。 */
  return { backendId: '', kind: 'unknown', countsRequests: true, countsPoints: false, independentBuckets: false, summary: '没有可用的额度模型，按只记请求数处理。' }
}

/** 一笔逻辑动作要花的东西（两个口径都给出来，由后端模型决定哪几个真的记账）。 */
export interface QuotaSpend {
  /** 这笔动作真实发出的出站请求条数（分页、重试、兜底链都算进去）。 */
  requests: number
  /** 这笔动作在点数口径下的花费（只有 GitHub 的 GraphQL 这一路才有意义）。 */
  points: number
}

/** 按后端算完之后的那笔账：真的记账的花费，外加一句「为什么这么记」。 */
export interface BackendQuotaSpend {
  backendId: string
  kind: BackendBudgetKind
  /** 这个后端真正记下来的出站请求条数。 */
  requests: number
  /** 这个后端真正记下来的点数（它没有点数口径时恒为 0）。 */
  points: number
  /** 点数这一项到底算不算数（GitLab 与本地 Markdown 都是假）。 */
  pointsCounted: boolean
  /** 一句话说清这笔账按什么口径记的。 */
  note: string
}

function nonNegative(v: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : 0
  return n > 0 ? n : 0
}

/**
 * 按后端算一笔花费。三个内置后端 + 未知后端的算法都在这一个函数里：
 *   - GitHub：两个口径都记，原样传出去；
 *   - GitLab：只记请求条数，点数一律记 0，并且明说「这个后端不按点数计费」；
 *   - 本地 Markdown：两样都记 0，并且明说「不出站」；
 *   - 未知后端：只记请求条数，点数记 0，并且明说口径待定。
 * 无论哪一种，返回值里都带着「为什么这么记」，调用方不必自己再拼一句话。
 */
export function priceSpend(backendId: string, spend: QuotaSpend): BackendQuotaSpend {
  const m = backendBudgetModel(backendId)
  const requests = m.countsRequests ? nonNegative(spend && spend.requests) : 0
  const points = m.countsPoints ? nonNegative(spend && spend.points) : 0
  const note =
    m.kind === 'two-buckets' ? '两个桶都记：请求条数进 REST 桶、点数进 GraphQL 桶，两桶互不折算。'
      : m.kind === 'requests-only' ? '只记出站请求条数：这个后端没有点数制（与 GitHub 的两桶不同，额度数值待实测）。'
        : m.kind === 'off-network' ? '不出站，记 0：本地 Markdown 后端读写的是本机文件，不花任何额度。'
          : '只记出站请求条数：还没认出来这个后端，点数口径待定，先按更省的一侧记。'
  return { backendId: m.backendId === '' ? String(backendId || '') : m.backendId, kind: m.kind, requests: requests, points: points, pointsCounted: m.countsPoints, note: note }
}

/**
 * 这个后端要不要进「两桶各自一份额度」的那套判定。
 * 账本与闸只在它为真时才分开算两桶的档位；其余后端只有一个「请求数」的账。
 */
export function usesIndependentBuckets(backendId: string): boolean {
  return backendBudgetModel(backendId).independentBuckets
}
