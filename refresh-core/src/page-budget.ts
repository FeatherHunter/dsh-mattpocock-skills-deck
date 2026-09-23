/**
 * refresh-core/src/page-budget.ts —— 一次整池重建要翻几页、花多少钱（#719 收口）
 *
 * 解决的是什么问题：整池重建的钱是按「翻了几页」算出来的。同一张票在只有 30 张票的仓库里
 * 一页就到底，在 500 张票的仓库里要翻 5 页。以前全仓只认一个写死的页数（5 页），于是两种仓库
 * 被算成同一个价钱：小仓库被算贵了，真出变化时反而没有余量。这份文件把两件事分开：
 *   - **实测算的页数**：账本记下每个仓库上一次重建实际翻了几页（账本在宿主侧，见
 *     src/host/refresh/ledger.js 的 notePages / pagesFor），下一次按这个数估。
 *   - **上界算的页数**：最坏用量一律按页数上界（budget.ts 的 MAX_PAGES）算，不按实测算。
 *     理由与「最坏」这两个字同源：实测是这一次的真相，上界是任何一次都不会超过的那条线；
 *     拿实测当最坏会把最坏情况算小，而门禁存在的意义正是盯住最坏情况。
 *
 * 为什么本文件一个数字都不写、全部从参数进来：刷新核心的产物（src/shared/refresh/*.js）之间
 * 不许互相 import（tests/verify-no-same-layer-import.js 与 tests/verify-refresh-freshness.js 的
 * 「产物零相对引用」两条门禁一起守这件事）。额度与单价常量因此仍然只有一处物理真源
 * （refresh-core/src/budget.ts），由宿主侧从 budget.js 取好再传进来 —— 做法与
 * policy.ts / backoff.ts / tool-cost.ts 完全一致。这里只放形状与算式。
 */

/** 重建那几页的单价与条数上界（值由调用方从 budget.js 取好传进来，本文件不写数字）。 */
export interface PagePrices {
  /** 列表薄片段一页的点数（budget.PAGE_COST_POINTS）。 */
  listPagePoints: number
  /** 列表每一页发出的请求条数。 */
  listPageRequests: number
  /** 拉取请求薄页的点数（budget.PR_PAGE_COST_POINTS）。 */
  prPagePoints: number
  /** 拉取请求页发出的请求条数。 */
  prPageRequests: number
  /** 「共多少张」那条计数查询的点数（budget.COUNT_COST_POINTS）。 */
  countPoints: number
  /** 计数查询发出的请求条数。 */
  countRequests: number
  /** 一次重建里拉取请求翻几页（budget.REBUILD_PR_PAGE_COUNT，今天恒为 1）。 */
  prPageCount: number
}

/** 一次整池重建的账：翻了几页工单池、一共几点、一共几条出站请求。 */
export interface RebuildCost {
  /** 这一次（或这一个上界）按工单池翻几页算。 */
  issuePages: number
  /** 工单池页数 + 拉取请求页数 + 计数那一条。 */
  requests: number
  /** 工单池页 + 拉取请求页 + 计数，各自按单价折出来的总点数。 */
  points: number
}

function nonNegativeInt(v: number): number {
  const n = typeof v === 'number' && isFinite(v) ? Math.floor(v) : 0
  return n > 0 ? n : 0
}

/**
 * 一个仓库的工单池要翻几页才算不漏。
 * 传进来的实测页数若不是正整数（没记过、记坏了），一律按 1 页算——宁可少估一次也不给负数或 NaN。
 */
export function issuesPagesFor(measuredPages: number): number {
  const p = nonNegativeInt(measuredPages)
  return p > 0 ? p : 1
}

/**
 * 这次该按几页算「最坏」：实测页数与页数上界里取大的那个。
 *
 * 为什么是取大而不是一律取上界：上界是常量（今天 10 页），而当某个仓库真的翻过了 10 页，
 * 说明上界本身该抬高——那时如实按实测算，比按一个已经被突破的常量算诚实。
 * 两个方向都不会把最坏算小，这正是这里要的性质。
 */
export function worstPagesFor(measuredPages: number, maxPages: number): number {
  const measured = issuesPagesFor(measuredPages)
  const upper = nonNegativeInt(maxPages)
  return measured > upper ? measured : upper
}

/**
 * 按工单池页数算一次整池重建的价钱。
 * 算式只有一条：工单池页 × 每页单价 + 拉取请求页 × 每页单价 + 计数 1 条 × 单价。
 * 页数给 0 或给坏值时按 1 页算（一次重建至少要看一眼工单池）。
 */
export function rebuildCost(issuePages: number, prices: PagePrices): RebuildCost {
  const pages = issuesPagesFor(issuePages)
  const prPages = nonNegativeInt(prices.prPageCount)
  return {
    issuePages: pages,
    requests: pages * nonNegativeInt(prices.listPageRequests) + prPages * nonNegativeInt(prices.prPageRequests) + nonNegativeInt(prices.countRequests),
    points: pages * nonNegativeInt(prices.listPagePoints) + prPages * nonNegativeInt(prices.prPagePoints) + nonNegativeInt(prices.countPoints),
  }
}

/**
 * 最坏一次重建的价钱：按「实测与上界里大的那个页数」算。
 * 门禁（verify-budget-worstcase / verify-event-budget）与账本的最坏列都走这一个入口，
 * 两处不会各算一份。
 */
export function worstCaseRebuildCost(measuredPages: number, maxPages: number, prices: PagePrices): RebuildCost {
  return rebuildCost(worstPagesFor(measuredPages, maxPages), prices)
}

/** 交给账本与门禁的一份页数报告：实测是多少、上界是多少、这次按哪个算、实测有没有突破上界。 */
export interface PageCountReport {
  /** 这个仓库上一次重建实测翻了几页（没记过时是 1）。 */
  measuredPages: number
  /** 页数上界（budget.MAX_PAGES）。 */
  upperBoundPages: number
  /** 这次按它算最坏：measuredPages 与 upperBoundPages 里大的那个。 */
  worstPages: number
  /** 实测是不是已经突破了上界（突破就该抬上界，门禁会把它报出来）。 */
  beyondUpperBound: boolean
}

/** 把上面那些判定收成一个报告对象，免得调用方自己拼四个字段、拼漏一个。 */
export function pageCountReport(measuredPages: number, maxPages: number): PageCountReport {
  const measured = issuesPagesFor(measuredPages)
  const upper = nonNegativeInt(maxPages)
  const worst = worstPagesFor(measured, upper)
  return {
    measuredPages: measured,
    upperBoundPages: upper,
    worstPages: worst,
    beyondUpperBound: upper > 0 && measured > upper,
  }
}
