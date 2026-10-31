/**
 * src/tracker/rooms/github/read/rest-detail-completion.ts —— REST 单票降级时按需补齐关系与明细（#1691）
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * GitHub 的 GraphQL 偶发失败时，单票读走 REST：`/issues/<n>` 只保证给行与正文，
 * 评论正文、依赖边、拉取请求的评审与合并时间都不在这份回包里。以前这一支直接退回，
 * 降级读出来的票于是「没有父票、没有依赖、没有评论、没有评审」——把「没取到」当成了
 * 「确实没有」（#1681 的未知 ≠ 空）。这里在返回前按需补：每一类最多发一次请求，
 * 补到就把原始形状写回行上让 normalize 读，补不到就写行内三态记「未知」，绝不写空值。
 *
 * ── 三条不能改的约定 ───────────────────────────────────────────────────────────
 * 1. 每类最多一次请求：评论、依赖、评审、合并时间各一次，没有重试、没有翻页。
 *    调用方（issues.ts 的 REST 分支）只调本函数一次，重复调用会重复花钱。
 * 2. 补不到记未知：失败写 `fieldStates.<组> = { known:false, reason:'unreadable' }`，
 *    依赖与评审不写空数组；只有回包明确给出零条（依赖摘要四格全零、评论页不满一页）才记已知空。
 * 3. 请求类型与 `via` 标签一一对应：get.rest-comments / get.rest-deps / get.rest-merge /
 *    get.rest-review（登记在 tests/verify-github-gh-via.ts 的 TAG_SPEC.get 里）。
 *
 * 父票边不发请求：`/issues/<n>` 回包自带 `parent_issue_url`。但单行看不到「整页表不表达这组字段」
 * 的证据，所以只有键出现了才认；键没出现记「未表达」，不当成「明确没有父票」。
 */

import type { OpContext } from '../../../contract/contexts.js'
import type { FieldGroup } from '../../../contract/operations-encyclopedia.js'
import type { FieldGroupCompleteness } from '../../../contract/read-provenance.js'
import { ghClient } from '../transport/client.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { GITHUB_REST_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'
import { parseParentIssueNumber } from '../channels/rest/list-row-metadata.js'

/** 仓库坐标：调用方已保证形状，与 pulls.ts 同一份最小接口。 */
interface ParsedRepo {
  owner: string
  name: string
}

/** 一次补取涉及的四类明细；父票边不占请求，不在此列。 */
export type RestDetailClass = 'comments' | 'dependencies' | 'review' | 'mergeInfo'

/** 一类的结局：补到了、试过但没补到、按条件不需要补、对拉取请求不适用。 */
export type RestDetailOutcome = 'ok' | 'failed' | 'skipped' | 'not-applicable'

/** 补取结果：要覆盖给来源完整度的组、发出去的请求数、每类结局（调用方据此落降级日志）。 */
export interface RestDetailCompletion {
  /** 只装这次真的动过的组；调用方拿它覆盖 REST 单票的默认八组表态。 */
  fieldGroups: Partial<Record<FieldGroup, FieldGroupCompleteness>>
  /** 本次一共发出几次 gh 请求（父票边不算，它读回包）。 */
  requests: number
  /** 每类结局，另加 parent 一格（row=行里给了、absent=行里没这键、not-applicable=拉取请求）。 */
  outcomes: Record<string, string>
}

type RawBag = Record<string, unknown>

function asBag (raw: unknown): RawBag | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as RawBag : null
}

function hasOwn (bag: RawBag, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(bag, key)
}

/** 往行内三态里写一组：已有别的组时保留，只覆盖本组。 */
function putState (bag: RawBag, group: string, state: unknown): void {
  const existing = asBag(bag.fieldStates);
  const next: RawBag = existing ? Object.assign({}, existing) : {}
  next[group] = state
  bag.fieldStates = next
}

/** 非负整数才算计数；与列表行元数据同一口径，坏形状不改写成零。 */
function readCount (bag: RawBag, key: string): number | null {
  const value = bag[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** 依赖摘要四格；任一格坏掉就整份当读不懂，不以部分数值推断「依赖为零」。 */
function dependencySummaryOf (bag: RawBag): { blockedBy: number; blocking: number; totalBlockedBy: number; totalBlocking: number } | null {
  const raw = asBag(bag.issue_dependencies_summary)
  if (!raw) return null
  const blockedBy = readCount(raw, 'blocked_by')
  const blocking = readCount(raw, 'blocking')
  const totalBlockedBy = readCount(raw, 'total_blocked_by')
  const totalBlocking = readCount(raw, 'total_blocking')
  if (blockedBy === null || blocking === null || totalBlockedBy === null || totalBlocking === null) return null
  return { blockedBy: blockedBy, blocking: blocking, totalBlockedBy: totalBlockedBy, totalBlocking: totalBlocking }
}

/** 四格全零才敢说「没有依赖」；任一格大于零就得拉一次明细核对。 */
function dependenciesDefinitelyEmpty (summary: { blockedBy: number; blocking: number; totalBlockedBy: number; totalBlocking: number }): boolean {
  return summary.blockedBy === 0 && summary.blocking === 0 && summary.totalBlockedBy === 0 && summary.totalBlocking === 0
}

/** 拉取请求行：/issues 回包里带 pull_request 对象（与列表判据同一口径）。 */
function isPullRequestRow (bag: RawBag): boolean {
  const v = bag.pull_request
  return hasOwn(bag, 'pull_request') && v !== null && typeof v === 'object'
}

/** 解析 gh 回包的 JSON；坏 JSON 回 null，由调用方记「未知」。 */
function parseJson (text: string | undefined): unknown {
  try { return JSON.parse(text || 'null') } catch (e) { return null }
}

/** 从这次回包里认出票号（路径要用）；读不到就补不了，调用方已经把坏形状挡在外面一层。 */
function numberOf (bag: RawBag): string {
  const n = bag.number
  return n == null ? '' : String(n)
}

/**
 * 按需补齐单票 REST 回包，直接改传进来的那一行（与 pulls.ts 的富化同一做法：改的是原引用）。
 *
 * @param raw /issues/<n> 或 /pulls/<n> 的原始回包
 * @param parsed 仓库坐标
 * @param ctx 读上下文（gh 客户端、cwd、日志壳都在里面）
 * @param opts.wantComments 调用方点名的评论条数（GetOpts.comments.first）；null 表示没点名，不补评论正文
 */
export async function completeRestDetail (raw: unknown, parsed: ParsedRepo, ctx: OpContext, opts?: { wantComments?: number | null }): Promise<RestDetailCompletion> {
  const out: RestDetailCompletion = { fieldGroups: {}, requests: 0, outcomes: {} }
  const bag = asBag(raw)
  if (!bag) return out
  const isPR = isPullRequestRow(bag)
  const num = numberOf(bag)

  // ① 父票边：读行内链接，不发请求。键出现才算表达；键没出现记未表达（单行看不到整页字段出现性）。
  if (isPR) {
    putState(bag, 'parents', { known: false, value: null, reason: 'not-applicable' })
    putState(bag, 'dependencies', { known: false, value: null, reason: 'not-applicable' })
    putState(bag, 'subIssues', { known: false, value: null, reason: 'not-applicable' })
    out.outcomes.parent = 'not-applicable'
    out.outcomes.dependencies = 'not-applicable'
  } else if (hasOwn(bag, 'parent_issue_url')) {
    const v = bag.parent_issue_url
    if (v === null) {
      bag.parentKey = null
      out.fieldGroups.parents = 'complete'
      out.outcomes.parent = 'row'
    } else {
      const key = parseParentIssueNumber(v)
      if (key === null) {
        putState(bag, 'parents', { known: false, value: null, reason: 'unreadable' })
        out.outcomes.parent = 'absent'
      } else {
        bag.parentKey = key
        out.fieldGroups.parents = 'complete'
        out.outcomes.parent = 'row'
      }
    }
  } else {
    putState(bag, 'parents', { known: false, value: null, reason: 'not-expressed' })
    out.outcomes.parent = 'absent'
  }

  // ② 依赖边：摘要四格全零记已知空（零请求）；否则每张票最多拉一次明细，条数与摘要对不上就记未知。
  if (!isPR) {
    const summary = dependencySummaryOf(bag)
    if (summary && dependenciesDefinitelyEmpty(summary)) {
      bag.blockedBy = []
      out.fieldGroups.dependencies = 'complete'
      out.outcomes.dependencies = 'skipped'
    } else {
      out.requests += 1
      const page = PAGINATION.github.restPageSize
      let got: unknown = null
      try {
        const r = await ghClient(ctx).execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/issues/' + num + '/dependencies/blocked_by?per_page=' + page], { cwd: ctx && ctx.cwd, via: 'get.rest-deps', timeout: GITHUB_REST_READ_TIMEOUT_MS })
        if (r && r.ok === true) got = parseJson(r.data.stdout)
      } catch (e) { got = null }
      if (Array.isArray(got) && (summary === null || got.length === summary.blockedBy)) {
        // 只取正向边（被谁阻塞）：反向边这版实现不补，来源完整度只声明这一组能证到「直接依赖」。
        bag.blockedBy = got
        out.fieldGroups.dependencies = 'complete'
        out.outcomes.dependencies = 'ok'
      } else {
        putState(bag, 'dependencies', { known: false, value: null, reason: 'unreadable' })
        out.outcomes.dependencies = 'failed'
      }
    }
  }

  // ③ 评论正文：只有调用方点名要（wantComments 非 null 且大于零）才补一页，不翻页。
  const want = opts && typeof opts.wantComments === 'number' ? opts.wantComments : null
  if (want === null || want <= 0) {
    out.outcomes.comments = 'skipped'
  } else {
    out.requests += 1
    const page = Math.min(want, PAGINATION.github.restPageSize)
    let got: unknown = null
    try {
      const r = await ghClient(ctx).execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/issues/' + num + '/comments?per_page=' + page], { cwd: ctx && ctx.cwd, via: 'get.rest-comments', timeout: GITHUB_REST_READ_TIMEOUT_MS })
      if (r && r.ok === true) got = parseJson(r.data.stdout)
    } catch (e) { got = null }
    if (Array.isArray(got)) {
      bag.comments = got
      // 回包不满一页：这一页就是全部，评论总数可证；满一页：后面可能还有，总数保持未知。
      if (got.length < page) {
        bag.commentCount = got.length
        out.fieldGroups.comments = 'complete'
      } else {
        out.fieldGroups.comments = 'truncated'
      }
      out.outcomes.comments = 'ok'
    } else {
      putState(bag, 'comments', { known: false, value: null, reason: 'unreadable' })
      out.outcomes.comments = 'failed'
    }
  }

  // ④ 拉取请求的评审与合并时间：各最多一次请求。行里已经表达过的（/pulls 带 merged_at、reviews 数组）不重复拉。
  if (isPR) {
    if (Array.isArray(bag.reviews)) {
      out.outcomes.review = 'skipped'
    } else {
      out.requests += 1
      const page = PAGINATION.github.restPageSize
      let got: unknown = null
      try {
        const r = await ghClient(ctx).execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls/' + num + '/reviews?per_page=' + page], { cwd: ctx && ctx.cwd, via: 'get.rest-review', timeout: GITHUB_REST_READ_TIMEOUT_MS })
        if (r && r.ok === true) got = parseJson(r.data.stdout)
      } catch (e) { got = null }
      if (Array.isArray(got)) {
        bag.reviews = got
        out.fieldGroups.review = got.length >= page ? 'truncated' : 'complete'
        out.outcomes.review = 'ok'
      } else {
        putState(bag, 'review', { known: false, value: null, reason: 'unreadable' })
        out.outcomes.review = 'failed'
      }
    }
    const merged = bag.merged_at
    const pull = asBag(bag.pull_request)
    const expressed = typeof merged === 'string' || merged === null || (pull !== null && hasOwn(pull, 'merged_at'))
    if (expressed) {
      out.outcomes.mergeInfo = 'skipped'
    } else {
      out.requests += 1
      let got: unknown = null
      try {
        const r = await ghClient(ctx).execGh(['api', 'repos/' + parsed.owner + '/' + parsed.name + '/pulls/' + num], { cwd: ctx && ctx.cwd, via: 'get.rest-merge', timeout: GITHUB_REST_READ_TIMEOUT_MS })
        if (r && r.ok === true) got = parseJson(r.data.stdout)
      } catch (e) { got = null }
      const gb = asBag(got)
      const mergedAt = gb ? gb.merged_at : undefined
      if (mergedAt === null || typeof mergedAt === 'string') {
        bag.merged_at = mergedAt
        out.fieldGroups.mergeInfo = 'complete'
        out.outcomes.mergeInfo = 'ok'
      } else {
        putState(bag, 'mergeInfo', { known: false, value: null, reason: 'unreadable' })
        out.outcomes.mergeInfo = 'failed'
      }
    }
  } else {
    out.outcomes.review = 'skipped'
    out.outcomes.mergeInfo = 'skipped'
  }

  return out
}

export default { completeRestDetail }
