/**
 * src/tracker/rooms/github/read/rest-list-relations.ts —— REST 列表行的关系字段补齐（票 #1691）
 *
 * 为什么要有这一份：整仓列表掉到 REST 通道时，父票边、依赖边、子票计数三组关系字段只能
 * 从每个列表行里读 `parent_issue_url`、`issue_dependencies_summary`、`sub_issues_summary`。
 * 字段在这一页里出没出现过按整页判（真机探针 #1682 的结论：顶层工单没有父票键是常态，
 * 只有子票行带键才能证明接口会表达它），读到的结果按字段三态写回 `raw.fieldStates`，
 * 交给 model/field-states.ts 与 normalize.ts 统一消费。
 *
 * 两条不能改的约定：
 *  1. 父票链接只要整页表达，就不再逐张容器票发 `/sub_issues`（本模块报告 parentFromRows，
 *     由调用方跳过旧的树边兜底）；行里没表达时本模块不猜，仍交给 parent-repair 兜底。
 *  2. 依赖只对四格计数任一大于零的票各发一次明细请求；没取成或取回来对不上摘要计数时，
 *     写「不知道」而不是空数组。已关闭容器不猜父子边（见 parent-repair.ts）。
 */
import { ghClient } from '../transport/client.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { FieldState } from '../../../contract/field-state.js'
import { PAGINATION } from '../../../contract/pagination.js'
// REST 读走 30 秒档（中央 githubRestReadMs），与读档 12 秒分开。
import { GITHUB_REST_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'
import {
  detectRestListFieldPresence,
  needsDependencyDetail,
  parseRestListRowMetadata,
  type RestFieldGroup,
  type RestListFieldPresence,
  type IssueDependenciesSummary,
} from '../channels/rest/list-row-metadata.js'
import type { ParsedRepo } from '../model/issue-key.js'

/** 一行原始回包只按对象读；空值、数组都不当行。 */
type RawBag = Record<string, unknown>

/** 这一趟关系补齐的事实；调用方据此落降级日志、并决定还要不要走 sub_issues 兜底。 */
export interface RestListRelationsFacts {
  /** 整页字段出现情况：三组键有没有在任意一行出现过。 */
  presence: RestListFieldPresence
  /** 父票边是否已经能从行内链接补齐；假时调用方保留 sub_issues 兜底。 */
  parentFromRows: boolean
  /** 依赖计数大于零、需要逐票拉明细的票数。 */
  dependencyCandidates: number
  /** 其中成功取回明细的票数。 */
  dependencyFetched: number
  /** 其中没取成、已记成未知的票数。 */
  dependencyFailed: number
}

function asBag(raw: unknown): RawBag | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as RawBag : null
}

/** 把一组三态写进原始行的 fieldStates；已经有一份就并进去，不覆盖别的组。 */
function writeGroup(bag: RawBag, group: string, state: FieldState<unknown>): void {
  const raw = bag.fieldStates
  const box = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as RawBag : null
  if (box) box[group] = state
  else bag.fieldStates = { [group]: state }
}

/** 列表行元数据的三态与契约三态同词，直接搬；unknown 的 reason 原样保留。 */
function stateOfGroup<T>(group: RestFieldGroup<T>): FieldState<T> {
  return group.known
    ? { known: true, value: group.value, reason: null }
    : { known: false, value: null, reason: group.reason }
}

/** 记一条「这一张没补成」：依赖组写成不可读，合并层会保留上次已知、不把它当成空。 */
function markDependenciesUnknown(bag: RawBag): void {
  writeGroup(bag, 'dependencies', { known: false, value: null, reason: 'unreadable' })
}

/** 一条依赖明细请求的输入：行本身与它摘要里的直接依赖数（用来核对取回条数）。 */
interface DependencyCandidate {
  bag: RawBag
  summary: IssueDependenciesSummary
}

/**
 * 拉一张票的直接依赖明细（`/issues/<n>/dependencies/blocked_by`），成功写 `blocked_by` 数组。
 * 为什么失败不写空数组：未知与「没有依赖」在合并层是两种用法，写空会删掉上次已知的边。
 */
async function fetchDependencyDetail(candidate: DependencyCandidate, parsed: ParsedRepo, ctx: OpContext): Promise<boolean> {
  const bag = candidate.bag
  try {
    const c = ghClient(ctx)
    const url = 'repos/' + parsed.owner + '/' + parsed.name + '/issues/' + String(bag.number) + '/dependencies/blocked_by?per_page=' + PAGINATION.github.restPageSize
    const r = await c.execGh(['api', url], { cwd: ctx && ctx.cwd, via: 'list.rest-deps', timeout: GITHUB_REST_READ_TIMEOUT_MS })
    if (!r.ok) { markDependenciesUnknown(bag); return false }
    let j: unknown
    try { j = JSON.parse(r.data.stdout || '') } catch { markDependenciesUnknown(bag); return false }
    // 满一页说明可能还有下一页；这一趟不翻页，只记未知，不拿一页冒充全部。
    if (!Array.isArray(j) || j.length >= PAGINATION.github.restPageSize) { markDependenciesUnknown(bag); return false }
    // 取回条数与摘要里的直接依赖数对不上，说明这一趟说的不是同一件事，按不可读处理。
    if (j.length !== candidate.summary.blockedBy) { markDependenciesUnknown(bag); return false }
    // 写成 blockedBy（数组形状）：model/field-states.ts 的 edgeReadOf 只认这个键，
    // 由它再归一成 IssueRef[]；写 blocked_by 在现行读法里读不到（那条兼容分支走不到）。
    bag.blockedBy = j
    return true
  } catch {
    markDependenciesUnknown(bag)
    return false
  }
}

/**
 * 给一整批 REST 列表行补齐三组关系字段，并按需逐票拉依赖明细。
 *
 * 直接改传入的原始行（与 parent-repair 的既有做法一致，调用方随后统一归一化）；
 * 只发依赖明细这一类请求：父票与子票摘要都来自行本身，不发任何翻页。
 */
export async function completeRestListRelations(raws: unknown[], parsed: ParsedRepo, ctx: OpContext): Promise<RestListRelationsFacts> {
  const presence = detectRestListFieldPresence(raws)
  const candidates: DependencyCandidate[] = []
  for (const raw of raws) {
    const bag = asBag(raw)
    if (!bag) continue
    const metadata = parseRestListRowMetadata(raw, presence)
    // 拉取请求行没有这三组工单关系字段：记「不适用」，不是「没表达」。
    if (metadata.rowKind === 'pull-request' || presence.parent) writeGroup(bag, 'parents', stateOfGroup(metadata.parentKey))
    writeGroup(bag, 'subIssues', stateOfGroup(metadata.subIssues))
    if (metadata.rowKind === 'pull-request') {
      writeGroup(bag, 'dependencies', stateOfGroup(metadata.dependencies))
      continue
    }
    const dependencies = metadata.dependencies
    if (!dependencies.known) {
      writeGroup(bag, 'dependencies', stateOfGroup(dependencies))
      continue
    }
    if (needsDependencyDetail(dependencies) === true) {
      candidates.push({ bag: bag, summary: dependencies.value })
    } else {
      // 四格全零：直接依赖边确实为零，这条事实可以写成空数组（区别于「不知道」）。
      bag.blockedBy = []
    }
  }
  const fetched = await Promise.all(candidates.map((candidate) => fetchDependencyDetail(candidate, parsed, ctx)))
  const dependencyFetched = fetched.filter((ok) => ok).length
  return {
    presence: presence,
    parentFromRows: presence.parent,
    dependencyCandidates: candidates.length,
    dependencyFetched: dependencyFetched,
    dependencyFailed: candidates.length - dependencyFetched,
  }
}

export default { completeRestListRelations }
