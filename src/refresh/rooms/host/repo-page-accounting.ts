// src/refresh/rooms/host/repo-page-accounting.ts —— 按仓库记的「重建页数实测账」（#1255 从 quota-ledger.ts 拆出）
//
// 为什么单列一本账：账本里原来有两种账，键的维度不一样 ——
// 额度账按「档位 × 桶」记（三个档位、两个桶），页数账按「仓库」记（每个仓库自己的实测页数）。
// 两种账的调用方也不同：额度账是闸每一笔都问，页数账只在整池重建估算与总览里读。
// 拆出来之后 quota-ledger.ts 只持有实例（createPageBook），跨文件边只有一条（quota-ledger → 本文件），
// 反向不依赖：本文件只认 page-allowance.ts 与 host-budget.ts 的纯函数。
//
// 口径（从 quota-ledger.ts 原样搬来，行为一字未动）：
//   · 每个仓库记三样：最近一次翻了几页、历史上最多见过几页、累计重建过几次；
//   · 没记过的仓库按 1 页估，不编一个典型值出来；
//   · 最坏用量按「实测最大值与页数上界取大者」算，算式只在 page-allowance.ts 里。
import { MAX_PAGES, PAGE_COST_POINTS, PR_PAGE_COST_POINTS, COUNT_COST_POINTS, LIST_PAGE_COST_REQUESTS, PR_PAGE_COST_REQUESTS, COUNT_COST_REQUESTS, REBUILD_PR_PAGE_COUNT } from '../../kernel/host-budget.js'
import { pageCountReport, rebuildCost, worstCaseRebuildCost } from '../../kernel/page-allowance.js'

/** 单个仓库的重建页数实测。 */
export interface RepoPageRecord {
  issuePages: number
  maxIssuePages: number
  prPages: number
  rebuilds: number
  at: number
}

/** 记实测页数时的观测值：三个字段都可缺（缺了按 0 算、at 缺了取当下时刻），所以按 unknown 收。 */
export interface ObservedPages { issuePages?: unknown; prPages?: unknown; at?: unknown }

/**
 * 重建那几页的单价，全部来自 host-budget.ts（本文件不写任何一个额度或单价数字）。
 * 交给 page-allowance.ts 的纯函数算账，理由同 quota-ledger.ts 文件头：单一物理真源在 host-budget.ts。
 */
export const PAGE_PRICES = Object.freeze({
  listPagePoints: PAGE_COST_POINTS,
  listPageRequests: LIST_PAGE_COST_REQUESTS,
  prPagePoints: PR_PAGE_COST_POINTS,
  prPageRequests: PR_PAGE_COST_REQUESTS,
  countPoints: COUNT_COST_POINTS,
  countRequests: COUNT_COST_REQUESTS,
  prPageCount: REBUILD_PR_PAGE_COUNT,
})

/** 最坏用量那条线用的页数上界（budget.MAX_PAGES）。 */
export const PAGE_UPPER_BOUND = MAX_PAGES

/** 收未知输入、归一成数：非数字与 NaN 都算 0（与 quota-ledger.ts 的 num 同形，各管各的归一）。 */
function num(v: unknown): number {
  return (typeof v === 'number' && isFinite(v)) ? v : 0
}

/** 建一本页数账的依赖：缺了用系统时钟（原来就是这个行为）。 */
export interface PageBookDeps {
  now?: () => number
}

/**
 * 建一本按仓库记的页数账。调用方（quota-ledger.ts）持有实例，把五个方法挂进自己的回包；
 * 总览要的那一份「每个仓库的页数节」由 snapshotPages() 原样供给。
 */
export function createPageBook(deps?: PageBookDeps): {
  notePages: (repoKey: string, observed?: ObservedPages) => RepoPageRecord & { repoKey: string }
  pagesFor: (repoKey: string) => (RepoPageRecord & { repoKey: string }) | null
  estimateRebuild: (repoKey: string) => unknown
  worstRebuild: (repoKey: string) => unknown
  pageReport: (repoKey: string) => unknown
  snapshotPages: () => Record<string, unknown>
} {
  const opts = deps || {}
  const now = typeof opts.now === 'function' ? opts.now : Date.now

  /**
   * 每个仓库的重建页数实测（定稿第十四章：「账本记每个仓库的实测页数，最坏用量按页数上界算」）。
   * 键由调用方给（工作区根或仓库标识，跟闸的记账口径一致）；每个仓库记三样：
   * 最近一次翻了几页、历史上最多见过几页、累计重建过几次。
   * 为什么要记「最多见过几页」而不只记最近一次：最坏上界要的是一个不会被突破的数，
   * 只记最近一次的话，某次翻到 12 页、下一次回到 3 页，最坏上界就又变回 10 页了 ——
   * 那等于把已经发生过的事忘掉。算式在 page-allowance.ts，只此一处。
   */
  const pagesByRepo: Record<string, RepoPageRecord> = {}

  /** 记下这一次整池重建在一个仓库里实际翻了几页。observed: { issuePages, prPages?, at? }。 */
  function notePages(repoKey: string, observed?: ObservedPages) {
    const k = String(repoKey || '')
    if (!k) throw new Error('记实测页数要带仓库标识：页数是按仓库分别记的，没有标识就分不出是谁的')
    const o = observed || {}
    const issuePages = Math.max(1, Math.floor(num(o.issuePages)))
    const prPages = Math.max(0, Math.floor(num(o.prPages)))
    const t = (typeof o.at === 'number') ? o.at : now()
    const prev = pagesByRepo[k]
    const next = {
      issuePages: issuePages,
      maxIssuePages: prev ? Math.max(prev.maxIssuePages, issuePages) : issuePages,
      prPages: prPages,
      rebuilds: (prev ? prev.rebuilds : 0) + 1,
      at: t,
    }
    pagesByRepo[k] = next
    return Object.assign({ repoKey: k }, next)
  }

  /** 这个仓库的页数实测；没记过时给 null（调用方按 1 页估，不编一个典型值出来）。 */
  function pagesFor(repoKey: string) {
    const k = String(repoKey || '')
    const p = pagesByRepo[k]
    return p ? Object.assign({ repoKey: k }, p) : null
  }

  /**
   * 这个仓库下一次重建该按几页估：按它自己的实测页数（没记过时 1 页）。
   * 这是「估」，与最坏上界是两件事 —— 小仓库不必替大仓库付那份钱。
   */
  function estimateRebuild(repoKey: string) {
    const p = pagesFor(repoKey)
    return rebuildCost(p ? p.issuePages : 1, PAGE_PRICES)
  }

  /**
   * 这个仓库最坏一次重建要花多少：实测页数与页数上界（MAX_PAGES）取大的那个。
   * 门禁核对最坏用量走的是同一个算式（page-allowance.ts），两处不会各算一份。
   */
  function worstRebuild(repoKey: string) {
    const p = pagesFor(repoKey)
    return worstCaseRebuildCost(p ? p.maxIssuePages : 0, PAGE_UPPER_BOUND, PAGE_PRICES)
  }

  /** 页数报告：实测多少、上界多少、这次按哪个算、实测有没有突破上界。 */
  function pageReport(repoKey: string) {
    const p = pagesFor(repoKey)
    return pageCountReport(p ? p.maxIssuePages : 0, PAGE_UPPER_BOUND)
  }

  /**
   * 给总览的那一份「每个仓库的页数节」：实测三样 + 最坏用量 + 报告，原样拼好。
   * quota-ledger.ts 的 snapshot() 直接调它，拼法与拆分前一字相同。
   */
  function snapshotPages(): Record<string, unknown> {
    const pages: Record<string, unknown> = {}
    for (const k of Object.keys(pagesByRepo)) pages[k] = Object.assign({}, pagesByRepo[k], { worst: worstRebuild(k), report: pageReport(k) })
    return pages
  }

  return {
    notePages: notePages,
    pagesFor: pagesFor,
    estimateRebuild: estimateRebuild,
    worstRebuild: worstRebuild,
    pageReport: pageReport,
    snapshotPages: snapshotPages,
  }
}
