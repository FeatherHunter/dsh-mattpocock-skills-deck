/**
 * src/tracker/rooms/github/model/normalize.ts — GitHub 原始形状 → 契约标准形状。
 *
 * 房间分层（#1686 阶段 1、#1687 收口）：归一化住在 model/，读实现在 read/、写在 write/；
 * 房间根不再有同名转发文件。字段组三态的判定在 model/field-states.ts（#1688），这里只负责组装票。
 *
 * 定版依据：#126（Label 形状与 EMPTY/MISSING）+#127（单 key/无 number/无 subIssues/树边=parentKey+tickets）
 * +#124（setLabels/create labels 富输入）+#138 一页纸方案（形状归一不变量）
 *
 * 不变量（第一性推导）：
 *  - 单 key：Issue.key 是 String(raw.number)，永不产出 number 字段（harness 断言 no number）。
 *  - 无 subIssues/blocking：树边 = parentKey 向上 + MapNode.tickets 向下；blocking 仅 getDependencies 投影。
 *  - labels/assignees 是 GitHub 的稳定能力 → 恒给数组（没有就是空数组，EMPTY 不是 MISSING）。
 *  - 其余按字段组走三态（#1688，类型见 contract/field-state.ts）：来源表达了才把字段写到票上；
 *    来源没表达就省略字段，并在票的 fieldStates 里把这组记成「未表达」，绝不回落成 []/0/null
 *    冒充「确实为空」。缺评论总数不再拿正文条数顶替，缺依赖边不再给空数组。
 *  - parentKey 是核心字段永远存在：父边未知时仍写 null，读的人必须看 fieldStates.parents
 *    才知道那是「没有父票」还是「不知道」。
 *  - Label = { name: string; color: string; description?: string }，color 无则空串，description 仅非空携带。
 */

import { STATE, ISSUE_TYPE } from '../../../contract/vocabulary.js'
import { markerKindInHeader } from '../../../../shared/issue-file/src/marker.js'
import {
  asBag,
  parentStateOf,
  dependenciesStateOf,
  subIssuesStateOf,
  commentCountStateOf,
  reviewStateOf,
  mergeInfoStateOf,
} from './field-states.js'
import type { Comment, Issue, IssueFieldStates, Label, Milestone } from '../../../contract/entities.js'
import type { Actor, IssueType, State } from '../../../contract/identity.js'

function normalizeLabel(rawLabel: unknown): Label | null {
  if (typeof rawLabel === 'string') {
    const name = rawLabel.trim()
    if (!name) return null
    return { name, color: '' }
  }
  if (!rawLabel || typeof rawLabel !== 'object') return null
  const bag = rawLabel as Record<string, unknown>;
  const name = typeof bag.name === 'string' ? bag.name.trim() : ''
  if (!name) return null
  const color = typeof bag.color === 'string' ? bag.color : ''
  // 为什么先按 Label 定死再补可选字段：颜色无则空串，说明只在非空时携带，与契约三键一致。
  const out: Label = { name, color }
  if (typeof bag.description === 'string' && bag.description.trim() !== '') {
    out.description = bag.description
  }
  return out
}

function normalizeLabels(raw: unknown): Label[] {
  const bag = asBag(raw);
  let nodes: unknown = null
  if (bag && bag.labels && typeof bag.labels === 'object' && Array.isArray((bag.labels as Record<string, unknown>).nodes)) nodes = (bag.labels as Record<string, unknown>).nodes
  else if (Array.isArray(bag && (bag as Record<string, unknown>).labels)) nodes = (bag as Record<string, unknown>).labels
  else if (Array.isArray(raw)) nodes = raw
  else return [] // 无来源 → EMPTY（GitHub 恒可实现）
  const out: Label[] = []
  for (const n of (nodes as unknown[])) {
    const l = normalizeLabel(n)
    if (l) out.push(l)
  }
  return out
}

function kindFromTypename(t: unknown): string {
  const s = String(t || '').toLowerCase()
  if (s === 'bot') return 'bot'
  if (s === 'organization') return 'organization'
  return 'user'
}

function normalizeActor(raw: unknown): Actor | null {
  if (!raw || typeof raw !== 'object') return null
  const bag = raw as Record<string, unknown>;
  const login = typeof bag.login === 'string' ? bag.login.trim() : ''
  if (!login) return null
  // 为什么先只装 login：其余三格全是可选能力，缺了就省略，与契约参与人形状一致。
  const out: Actor = { login }
  const kind = bag.__typename ? kindFromTypename(bag.__typename) : (bag.kind ? String(bag.kind) : undefined)
  if (kind) out.kind = kind
  if (typeof bag.name === 'string' && bag.name.trim() !== '') out.name = bag.name
  if (typeof bag.avatarUrl === 'string' && bag.avatarUrl !== '') out.avatarUrl = bag.avatarUrl
  else if (typeof bag.avatar_url === 'string' && bag.avatar_url !== '') out.avatarUrl = bag.avatar_url
  return out
}

function normalizeAssignees(raw: unknown): Actor[] {
  const bag = asBag(raw);
  let nodes: unknown = null
  if (bag && bag.assignees && typeof bag.assignees === 'object' && Array.isArray((bag.assignees as Record<string, unknown>).nodes)) nodes = (bag.assignees as Record<string, unknown>).nodes
  else if (Array.isArray(bag && (bag as Record<string, unknown>).assignees)) nodes = (bag as Record<string, unknown>).assignees
  else if (bag && Array.isArray((bag as Record<string, unknown>).nodes)) nodes = (bag as Record<string, unknown>).nodes
  else return [] // GitHub 恒实现 → EMPTY
  const out: Actor[] = []
  for (const n of (nodes as unknown[])) {
    const a = normalizeActor(n)
    if (a) out.push(a)
  }
  return out
}

function deriveKey(raw: unknown): string {
  if (raw == null) return '0'
  const bag = asBag(raw);
  if (bag && typeof bag.key === 'string' && bag.key !== '') return bag.key
  if (bag && bag.number != null) return String(bag.number)
  if (bag && bag.id != null) return String(bag.id)
  return '0'
}

/**
 * 规格容器（实施地图）的识别：正文文件头（第一个标题之前）独占一行的隐藏标记
 * DSH-ISSUE-KIND: spec（#1403 T1 读侧统一：三房同一判据，GitHub 房不再只看首行）。
 *
 * 认法直接复用共享包 src/shared/issue-file/src/marker.ts 的 markerKindInHeader：
 * 只扫第一个标题之前的那一段（没有标题时取前 10 行），整行精确匹配才作数。
 * 这样「幂等锚占第一行、规格标记占第二行」的正文照样认成规格——写侧建带锚的票时锚就排在
 * 正文最前面，只认首行会把这类票漏掉；而正文里顺手提到这一串字、或标记落在标题之后，
 * 都不算数。
 *
 * 为什么判定住在房里：契约目录只放类型与常量、不放行为；各房拿共享包的纯函数自己调，
 * 判据只有一份，结论三家一致。
 */
export function isSpecBody(body: unknown): boolean {
  return typeof body === 'string' && markerKindInHeader(body) === 'spec'
}

function deriveType(raw: unknown): IssueType {
  const bag = asBag(raw)
  // 判定顺序的红线是**正文标记最前**，依据是 GLOSSARY.md「对象类型（objectKind）」词条：
  // 正文首行的隐藏标记 → 表达对象类型的标签 → 正文形状，标记是唯一真源。所以一张既带标记、
  // 又带 wayfinder:map 标签的脏票按规格算（规格本来就不许带那个标签，写侧会自动给
  // type==='map' 的票加上它；真遇到两者同时在场，那是写侧该修的数据，不改变这里按标记认）。
  if (isSpecBody(bag && typeof bag.body === 'string' ? bag.body : '')) return ISSUE_TYPE.SPEC
  const labels = normalizeLabels(raw)
  // 没有标记才看标签：带 wayfinder:map 标签的票是探索地图。
  if (labels.some((l) => l.name === 'wayfinder:map')) return ISSUE_TYPE.MAP
  // 后端形状明说「这是地图」的也算（那是显式声明，不是猜）。
  if (bag && (bag.isMap === true || bag.type === 'map')) return ISSUE_TYPE.MAP
  return ISSUE_TYPE.ISSUE
}

function normalizeMilestone(raw: unknown): Milestone | undefined {
  const bag = asBag(raw);
  const src = (bag && bag.milestone && typeof bag.milestone === 'object' ? (bag.milestone as Record<string, unknown>) : null) as Record<string, unknown> | null;
  if (!src || typeof src !== 'object') return undefined
  const title = typeof src.title === 'string' ? src.title.trim() : ''
  if (!title) return undefined
  // 为什么先只装名字：其余三格全是可选能力，缺了就省略或给空，与契约里程碑形状一致。
  const out: Milestone = { name: title }
  if (typeof src.description === 'string' && src.description.trim() !== '') out.description = src.description
  if (typeof src.state === 'string') {
    const s = src.state.toLowerCase()
    if (s === 'open' || s === 'closed') out.state = s
  }
  if (typeof src.dueOn === 'string' && src.dueOn !== '') out.dueOn = src.dueOn
  else if (typeof src.due_on === 'string' && src.due_on !== '') out.dueOn = src.due_on
  else out.dueOn = null
  return out
}

/** 评论正文：来源给了节点数组才映射；没给返回 null（三态里的「不知道」，调用方据此省略字段）。 */
function commentBodiesOf(raw: unknown): Comment[] | null {
  const bag = asBag(raw);
  if (!bag) return null
  const source = bag.comments
  let nodes: unknown[] | null = null
  if (Array.isArray(source)) nodes = source
  else if (source && typeof source === 'object' && Array.isArray((source as Record<string, unknown>).nodes)) nodes = (source as Record<string, unknown>).nodes as unknown[]
  if (!nodes) return null
  const out: Comment[] = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const rec = n as Record<string, unknown>;
    const body = typeof rec.body === 'string' ? rec.body : ''
    const author = normalizeActor(rec.author || rec.user) || { login: '' }
    const association = typeof rec.authorAssociation === 'string' ? rec.authorAssociation : (typeof rec.author_association === 'string' ? rec.author_association : '')
    // 为什么先装五格必备：评论的作者与时间缺了就给空，与契约评论形状一致，编号与编辑时间后面再补。
    const c: Comment = {
      author,
      authorAssociation: association,
      body,
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : (typeof rec.created_at === 'string' ? rec.created_at : ''),
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : (typeof rec.updated_at === 'string' ? rec.updated_at : ''),
    }
    if (typeof rec.id === 'string' || typeof rec.id === 'number') c.id = String(rec.id)
    if (typeof rec.editedAt === 'string' || rec.editedAt === null) c.editedAt = rec.editedAt
    else if (typeof rec.lastEditedAt === 'string' || rec.lastEditedAt === null) c.editedAt = rec.lastEditedAt
    else if (typeof rec.edited_at === 'string' || rec.edited_at === null) c.editedAt = rec.edited_at
    else if (typeof rec.last_edited_at === 'string' || rec.last_edited_at === null) c.editedAt = rec.last_edited_at
    out.push(c)
  }
  return out
}

// 拉取请求三字段归一（#504 落 #294 形状 A：复用工单形状加三个可选字段，不新增实体）。
// 双路输入：GraphQL pullRequest 节点（mergedAt/reviews.nodes）与 REST pull 对象
// （merged_at/pull_request 标记/reviews 数组）都认；#1688 起内容走三态：
// 来源表达了才写 mergedAt/reviews，没表达就省略字段并在 fieldStates 记「未表达」；
// 明确了「没有评审」「还没合并」照样写 []/null（那是事实，不是未知）。
// 取舍（与 queries 同口径）：列表走 REST 时评审未拉取（列表不拉 /reviews，见 pulls 读路径），
// 列表走 GraphQL 时评审与评论各给 20 条（工单评论 50 条是历史配额，拉取请求取 20 条省配额），
// #506 前端房只做展示不依赖明细，点开单票才有真值。
// 缺边（与 queries 同口径）：拉取请求类型原生没有 parent 与 blockedBy 边（2026-09-06 真仓探针已确认），
// 所以查询侧不取这两条边；归一侧不猜，fieldStates.parents / dependencies 记「未表达」——
// 不再写 null 与空数组冒充「没有父票」「没有依赖」。
function deriveIsPullRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const bag = raw as Record<string, unknown>;
  if (typeof bag.isPullRequest === 'boolean') return bag.isPullRequest // 已归一重入
  if (bag.pull_request != null) return true // REST issue 列表里的拉取请求标记
  if (typeof bag.__typename === 'string' && bag.__typename.toLowerCase() === 'pullrequest') return true
  if ('mergedAt' in bag || 'merged_at' in bag) return true // 拉取请求形状才有合并时间键
  if (bag.reviews != null) return true // 评审键只出现在拉取请求形状
  return false
}

/**
 * GitHub 原始数据里的状态 → 契约状态（只有打开 / 已关闭两种，见 shared/tracker/shape.js）。
 *
 * 为什么要它（#599）：GitHub 的拉取请求有三种状态（OPEN / CLOSED / MERGED），契约只有两种，
 * 所以要有一处把「已合并」收成「已关闭」，且只有这一处：
 *   一、GraphQL 的拉取请求自己写 state=MERGED；
 *   二、REST 兜底路上，/issues 与 /pulls 对已合并的拉取请求都给 state=closed（2026-09-11 真仓核过），
 *       所以两条路本来就同口径。
 * 契约保持两态，界面另按合并时间把这类条目显示成「已合并」（判据在 client 的 views/shared/stateKind.js）。
 * 宿主单票详情那条路（src/refresh/rooms/host/issue-detail-fetch.js）也调它，保证两处状态口径一致。
 */
export function pullStateOf(raw: unknown): State {
  const bag = asBag(raw);
  const s = bag && bag.state != null ? String(bag.state).toLowerCase() : ''
  return (s === 'closed' || s === 'merged') ? STATE.CLOSED : STATE.OPEN
}

export { normalizeDependencyEdges } from './field-states.js'

/**
 * GitHub 原始数据归一成契约票：核心字段永远给全，能力字段按来源表达与否给或省略，
 * 六组字段三态恒带（GitHub 房是唯一强制来源的后端，见 field-state.ts 文件头第 4 条）。
 *
 * 为什么收 unknown：输入是 GraphQL 工单、REST 工单或测试桩三路，形状不一，在内部逐格收窄比对外定大联合更稳。
 */
export function normalizeIssue(raw: unknown): Issue {
  const bag = asBag(raw)
  const key = deriveKey(raw)
  const type = deriveType(raw)
  // 状态：交给 pullStateOf 一处判定（已合并归到已关闭）；合并时间按三态留在 mergeInfo/mergedAt，
  // 界面据此显示「已合并」。
  const state = pullStateOf(raw)
  const labels = normalizeLabels(raw)
  const assignees = normalizeAssignees(raw)

  // 六组三态：先各自判「来源表达了没有」，再据此决定票上写不写对应字段。
  const parentState = parentStateOf(raw)
  const dependenciesState = dependenciesStateOf(raw)
  const subIssuesState = subIssuesStateOf(raw)
  const commentCountState = commentCountStateOf(raw)
  const reviewState = reviewStateOf(raw)
  const mergeInfoState = mergeInfoStateOf(raw)
  const commentBodies = commentBodiesOf(raw)
  const parentKey = parentState.known ? parentState.value : null

  // 基础核心字段（永远存在）
  // effortId：GitHub 一个仓库只有一个隐含 effort，核心字段填 ''（EMPTY，不是 MISSING）
  // 为什么整体标成 Issue：后面还要补作者与里程碑等可选能力，先定死契约形状，后面补字段才不会报缺成员。
  const issue: Issue = {
    key,
    effortId: '',
    type,
    title: bag && typeof bag.title === 'string' ? bag.title : '',
    state,
    body: bag && typeof bag.body === 'string' ? bag.body : '',
    url: bag && typeof bag.html_url === 'string' && bag.html_url ? bag.html_url : (bag && typeof bag.url === 'string' ? bag.url : ''),
    createdAt: bag && typeof bag.createdAt === 'string' ? bag.createdAt : (bag && typeof bag.created_at === 'string' ? (bag.created_at as string) : ''),
    updatedAt: bag && typeof bag.updatedAt === 'string' ? bag.updatedAt : (bag && typeof bag.updated_at === 'string' ? (bag.updated_at as string) : ''),
    closedAt: bag && (typeof bag.closedAt === 'string' || bag.closedAt === null) ? (bag.closedAt as string | null) : (bag && (typeof bag.closed_at === 'string' || bag.closed_at === null) ? (bag.closed_at as string | null) : null),
    parentKey,
    labels,
    assignees,
    // reason：GitHub 支持 closedReason，open 也输出 ''(EMPTY)
    reason: bag && typeof bag.reason === 'string' ? bag.reason : (bag && typeof bag.stateReason === 'string' ? (bag.stateReason as string) : ''),
    // 拉取请求标记：资源类型由查询端点决定，不属于六组件裁范围，保持原有判定（逐票必带布尔）。
    isPullRequest: deriveIsPullRequest(raw),
  }

  // 六组三态恒带（GitHub 房「来源表达与否」的唯一承载点）。
  const fieldStates: IssueFieldStates = {
    parents: parentState,
    dependencies: dependenciesState,
    subIssues: subIssuesState,
    comments: commentCountState,
    review: reviewState,
    mergeInfo: mergeInfoState,
  }
  issue.fieldStates = fieldStates

  // 只有来源表达了才写字段：未知就省略，不许拿 []/0/null 冒充「确实为空」。
  if (commentBodies) issue.comments = commentBodies
  if (commentCountState.known) issue.commentCount = commentCountState.value
  if (dependenciesState.known) issue.blockedBy = dependenciesState.value
  if (reviewState.known) issue.reviews = reviewState.value
  if (mergeInfoState.known) issue.mergedAt = mergeInfoState.value

  // 能力字段：author（有则给对象，无则 MISSING → 省略）
  const authorRaw = bag && (bag.author || bag.user);
  const author = normalizeActor(authorRaw)
  if (author) issue.author = author

  // milestone：有则给对象，无则 MISSING（省略）
  const milestone = normalizeMilestone(raw)
  if (milestone) issue.milestone = milestone

  // customFields：GitHub 无结构化字段 → 始终 MISSING（省略）
  // 不产出 customFields

  return issue
}

export default normalizeIssue
