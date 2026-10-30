/**
 * src/tracker/rooms/github/model/normalize.ts — GitHub 原始形状 → 契约标准形状。
 *
 * #1686 阶段 1：从房间根迁入 model/，旧路径 src/tracker/rooms/github/normalize.ts 保留纯转发，行为零变化。
 *
 * 文件头原写 `backends/github/normalize.js`，是 #1019 目录归位前的旧路径；#1052 按读路径这一片改成今天的真名。
 *
 * 定版依据：#126（Label 形状与 EMPTY/MISSING）+#127（单 key/无 number/无 subIssues/树边=parentKey+tickets）
 * +#124（setLabels/create labels 富输入）+#138 一页纸方案（形状归一不变量）
 *
 * 不变量（第一性推导）：
 *  - 单 key：`Issue.key: string = String(raw.number)`，永不产出 `number` 字段（harness 断言 no number）。
 *  - 无 `subIssues`/`blocking`：树边 = `parentKey` 向上 + `MapNode.tickets` 向下；`blocking` 仅 `getDependencies` 投影。
 *  - GitHub 原生支持 labels/assignees/comments/blockedBy/reason → 恒 EMPTY（[]/'' 非 MISSING），capability-by-fill。
 *  - `Label = { name: string; color: string; description?: string }`，color 无则 ''，description 仅非空携带。
 *  - `parentKey: string|null` 核心字段永远存在；子票只认原生 parent（忽略 task list）。
 */

import { STATE, ISSUE_TYPE } from '../../../contract/vocabulary.js'
import { markerKindInHeader } from '../../../../shared/issue-file/src/marker.js'
import type { Comment, Issue, IssueRef, Label, Milestone, Review } from '../../../contract/entities.js';
import type { Actor, IssueType, State } from '../../../contract/identity.js';

/** GitHub 原始对象的最小读形：GraphQL 与 REST 字段名各一套，缺谁都按空处理，所以全可选。 */
type RawBag = Record<string, unknown>;

/** 把未知输入收成键值袋：对象才有字段可读，其余一律按无字段处理，与原来的判空顺序一致。 */
function asBag(raw: unknown): RawBag | null {
  return (raw && typeof raw === 'object' ? (raw as RawBag) : null);
}

function normalizeLabel(rawLabel: unknown): Label | null {
  if (typeof rawLabel === 'string') {
    const name = rawLabel.trim()
    if (!name) return null
    return { name, color: '' }
  }
  if (!rawLabel || typeof rawLabel !== 'object') return null
  const bag = rawLabel as RawBag;
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
  if (bag && bag.labels && typeof bag.labels === 'object' && Array.isArray((bag.labels as RawBag).nodes)) nodes = (bag.labels as RawBag).nodes
  else if (Array.isArray(bag && (bag as RawBag).labels)) nodes = (bag as RawBag).labels
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
  const bag = raw as RawBag;
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
  if (bag && bag.assignees && typeof bag.assignees === 'object' && Array.isArray((bag.assignees as RawBag).nodes)) nodes = (bag.assignees as RawBag).nodes
  else if (Array.isArray(bag && (bag as RawBag).assignees)) nodes = (bag as RawBag).assignees
  else if (bag && Array.isArray((bag as RawBag).nodes)) nodes = (bag as RawBag).nodes
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
 * `<!-- DSH-ISSUE-KIND: spec -->`（#1403 T1 读侧统一：三房同一判据，GitHub 房不再只看首行）。
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
  // 没有标记才看标签：带 `wayfinder:map` 标签的票是探索地图。
  if (labels.some((l) => l.name === 'wayfinder:map')) return ISSUE_TYPE.MAP
  // 后端形状明说「这是地图」的也算（那是显式声明，不是猜）。
  if (bag && (bag.isMap === true || bag.type === 'map')) return ISSUE_TYPE.MAP
  return ISSUE_TYPE.ISSUE
}

function deriveParentKey(raw: unknown): string | null {
  if (!raw) return null
  const bag = asBag(raw);
  if (!bag) return null
  if (typeof bag.parentKey === 'string') return bag.parentKey
  if (bag.parentKey === null) return null
  const parent = (bag.parent && typeof bag.parent === 'object' ? (bag.parent as RawBag) : null) as RawBag | null;
  if (parent && parent.number != null) return String(parent.number)
  if (parent && typeof parent.key === 'string') return parent.key
  return null
}

function normalizeMilestone(raw: unknown): Milestone | undefined {
  const bag = asBag(raw);
  const src = (bag && bag.milestone && typeof bag.milestone === 'object' ? (bag.milestone as RawBag) : null) as RawBag | null;
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

/** 评论总数：有连接总数用总数（零条时也要能说出共有几条），否则按实际节点数；本地数组形状没有总数，按数组长度。REST 单票的 comments 是数字（就是总数），这时按这个数。 */
function deriveCommentCount(raw: unknown, comments: Comment[]): number {
  const bag = asBag(raw)
  if (bag && typeof bag.comments === 'number' && isFinite(bag.comments) && bag.comments >= 0) return Math.floor(bag.comments)
  const conn = bag && bag.comments && typeof bag.comments === 'object' ? (bag.comments as RawBag) : null
  if (conn && typeof conn.totalCount === 'number' && isFinite(conn.totalCount) && conn.totalCount >= 0) return Math.floor(conn.totalCount)
  return comments.length
}

function normalizeComments(raw: unknown): Comment[] {
  const bag = asBag(raw);
  let nodes: unknown = null
  if (bag && bag.comments && typeof bag.comments === 'object' && Array.isArray((bag.comments as RawBag).nodes)) nodes = (bag.comments as RawBag).nodes
  else if (Array.isArray(bag && (bag as RawBag).comments)) nodes = (bag as RawBag).comments
  else return [] // 恒实现 → EMPTY
  const out: Comment[] = []
  for (const n of (nodes as unknown[])) {
    if (!n || typeof n !== 'object') continue
    const rec = n as RawBag;
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

/**
 * 读一条边连接的节点与截断位（#1304）。
 * 两种回包都认：GraphQL 连接形状（nodes + pageInfo.hasNextPage）与 REST 形状（直接数组，没有分页信息）。
 * 只有 pageInfo.hasNextPage === true 才算截断 —— 缺 pageInfo 时按「不知道上限、没有截断」收下，
 * 与原来读单条边时的行为一致；REST 数组按完整收下，完整性判不了的那一路由上层自己交代。
 */
function edgeNodesOf(raw: unknown, field: string): { nodes: unknown[]; truncated: boolean } {
  const bag = asBag(raw)
  const conn = bag && bag[field] && typeof bag[field] === 'object' ? bag[field] as RawBag : null
  if (conn && Array.isArray(conn.nodes)) {
    const pageInfo = conn.pageInfo && typeof conn.pageInfo === 'object' ? conn.pageInfo as RawBag : null
    return { nodes: conn.nodes, truncated: pageInfo ? pageInfo.hasNextPage === true : false }
  }
  // REST 回包：边就是数组（列表行、单票都这样），没有分页信息，按完整收下。
  if (Array.isArray(bag && bag[field])) return { nodes: (bag as RawBag)[field] as unknown[], truncated: false }
  // REST 字段名的历史写法（blocked_by）只在正向边这一条上有。
  if (field === 'blockedBy' && bag && Array.isArray(bag.blocked_by)) return { nodes: bag.blocked_by as unknown[], truncated: false }
  return { nodes: [], truncated: false }
}

/** 边节点上的 labels 两种形状都认（GraphQL 连接 {nodes:[{name}]}、REST 数组 [{name}]），只取名字。 */
function labelNamesOfEdge(raw: unknown): string[] {
  const out: string[] = []
  const bag = raw && typeof raw === 'object' ? raw as RawBag : null
  const arr = Array.isArray(raw) ? raw : (bag && Array.isArray(bag.nodes) ? bag.nodes as unknown[] : null)
  if (!arr) return out
  for (const l of arr) {
    if (typeof l === 'string') { if (l) out.push(l); continue }
    const rec = l && typeof l === 'object' ? l as RawBag : null
    if (rec && typeof rec.name === 'string' && rec.name) out.push(rec.name)
  }
  return out
}

/** 把边连接的节点归一成一串轻量引用：键 + 标题 + 状态，种类有才补。 */
function refsOfEdgeNodes(nodes: unknown[]): IssueRef[] {
  const out: IssueRef[] = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const rec = n as RawBag;
    const k = rec.number != null ? String(rec.number) : (typeof rec.key === 'string' ? rec.key : '')
    if (!k) continue
    const title = typeof rec.title === 'string' ? rec.title : ''
    const stateRaw = rec.state != null ? String(rec.state).toLowerCase() : 'open'
    const state: State = stateRaw === 'closed' ? STATE.CLOSED : STATE.OPEN
    // 为什么先装三格必备：阻塞引用只保证 key 与标题状态，种类有才补，与契约轻量引用一致。
    const ref: IssueRef = { key: k, title, state }
    // type 可选：来源明说就用来源的；只有边节点带 labels 时（#1304 的依赖查询会带）才按旧路口径推 ——
    // 带 wayfinder:map 标签的是探索地图，其余按普通票。这样新路推出来的 ref 与旧路逐票读的完全一致。
    if (rec.type === 'map' || rec.type === 'issue') ref.type = rec.type
    else if (rec.labels !== undefined && rec.labels !== null) {
      const names = labelNamesOfEdge(rec.labels)
      ref.type = names.indexOf('wayfinder:map') >= 0 ? ISSUE_TYPE.MAP : ISSUE_TYPE.ISSUE
    }
    out.push(ref)
  }
  return out
}

function normalizeBlockedBy(raw: unknown): IssueRef[] {
  return refsOfEdgeNodes(edgeNodesOf(raw, 'blockedBy').nodes)
}

/**
 * 依赖投影归一（#1304）：一次读回正向与反向两条边，并交代这两条边各自有没有到上限。
 * 为什么单开这个出口：单票查询只要正向边（normalizeBlockedBy 继续走同一条读法），
 * 反向边只在 getDependencies 这一条路上要，两条边一起读回来才不用整仓扫描。
 * 两条边都要带「到没到上限」：正向边同样会在 50 条被封顶，少掉的边看起来就像「没人阻塞它」。
 */
export function normalizeDependencyEdges(raw: unknown): {
  blockedBy: IssueRef[]
  blocking: IssueRef[]
  blockedByTruncated: boolean
  blockingTruncated: boolean
} {
  const blocked = edgeNodesOf(raw, 'blockedBy')
  const blockBy = edgeNodesOf(raw, 'blocking')
  return {
    blockedBy: refsOfEdgeNodes(blocked.nodes),
    blocking: refsOfEdgeNodes(blockBy.nodes),
    blockedByTruncated: blocked.truncated,
    blockingTruncated: blockBy.truncated,
  }
}

// 拉取请求三字段归一（#504 落 #294 形状 A：复用工单形状加三个可选字段，不新增实体）。
// 双路输入：GraphQL pullRequest 节点（mergedAt/reviews.nodes）与 REST pull 对象
// （merged_at/pull_request 标记/reviews 数组）都认；来源没有内容给空值（null/[]），
// GitHub 有该能力所以逐票必带 isPullRequest（true/false），坏值按空值收敛，不断言缺失。
// 取舍（与 queries.js 同口径）：列表走 REST 时评审恒为空数组（列表不拉 /reviews，见 pulls.js），
// 列表走 GraphQL 时评审与评论各给 20 条（工单评论 50 条是历史配额，拉取请求取 20 条省配额），
// #506 前端房只做展示不依赖明细，点开单票才有真值。
// 缺边（与 queries.js 同口径）：拉取请求类型原生没有 parent 与 blockedBy 边（2026-09-06 真仓探针已确认），
// 所以查询侧首版不取这两条边；归一侧仍走同一函数（deriveParentKey 给 null，normalizeBlockedBy 给空数组），
// milestone 在拉取请求类型可用，查询侧已补取，缺内容时归一给省略，与工单一致。
function normalizeReview(n: unknown): Review | null {
  if (!n || typeof n !== 'object') return null
  const rec = n as RawBag;
  if (typeof rec.state !== 'string' || rec.state === '') return null
  // 为什么先只装结论：评审人缺了就省略，与契约评审快照一致。
  const out: Review = { state: rec.state }
  let login = ''
  const cand = [rec.reviewer, rec.author, rec.user]
  for (const c of cand) {
    if (c && typeof c === 'object' && typeof (c as RawBag).login === 'string' && ((c as RawBag).login as string).trim() !== '') { login = (c as RawBag).login as string; break }
  }
  if (login) out.reviewer = { login }
  const when = typeof rec.submittedAt === 'string' ? rec.submittedAt : (typeof rec.submitted_at === 'string' ? rec.submitted_at : '')
  if (when) out.submittedAt = when
  return out
}

function normalizeReviews(raw: unknown): Review[] {
  const bag = asBag(raw);
  let nodes: unknown = null
  if (bag && bag.reviews && typeof bag.reviews === 'object' && Array.isArray((bag.reviews as RawBag).nodes)) nodes = (bag.reviews as RawBag).nodes
  else if (bag && Array.isArray(bag.reviews)) nodes = bag.reviews
  else return [] // 无来源 → EMPTY（GitHub 恒可实现；REST 列表页无评审明细恒给 []，单票页 enrichSinglePR 才补真值，#506 展示不依赖条数）
  const out: Review[] = []
  for (const n of (nodes as unknown[])) {
    const r = normalizeReview(n)
    if (r) out.push(r)
  }
  return out
}

function deriveIsPullRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const bag = raw as RawBag;
  if (typeof bag.isPullRequest === 'boolean') return bag.isPullRequest // 已归一重入
  if (bag.pull_request != null) return true // REST issue 列表里的拉取请求标记
  if (typeof bag.__typename === 'string' && bag.__typename.toLowerCase() === 'pullrequest') return true
  if ('mergedAt' in bag || 'merged_at' in bag) return true // 拉取请求形状才有合并时间键
  if (bag.reviews != null) return true // 评审键只出现在拉取请求形状
  return false
}

function deriveMergedAt(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const bag = raw as RawBag;
  if (typeof bag.mergedAt === 'string') return bag.mergedAt
  if (typeof bag.merged_at === 'string') return bag.merged_at
  const pr = (bag.pull_request && typeof bag.pull_request === 'object' ? (bag.pull_request as RawBag) : null) as RawBag | null;
  if (pr && typeof pr.merged_at === 'string') return pr.merged_at
  return null // 没合并或不是拉取请求 → null（EMPTY）；无能力后端才省略，本房恒给
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

/**
 * GitHub 原始数据归一成契约票：核心字段永远给全，能力字段有才给，拉取请求三字段恒给。
 *
 * 为什么收 unknown：输入是 GraphQL 工单、REST 工单或测试桩三路，形状不一，在内部逐格收窄比对外定大联合更稳。
 */
export function normalizeIssue(raw: unknown): Issue {
  const key = deriveKey(raw)
  const type = deriveType(raw)
  // 状态：交给 pullStateOf 一处判定（已合并归到已关闭）；合并时间原样留在 mergedAt，界面据此显示「已合并」
  const state = pullStateOf(raw)
  const mergedAt = deriveMergedAt(raw)
  const labels = normalizeLabels(raw)
  const assignees = normalizeAssignees(raw)
  const comments = normalizeComments(raw)
  const blockedBy = normalizeBlockedBy(raw)
  const parentKey = deriveParentKey(raw)
  const bag = asBag(raw);

  // 基础核心字段（永远存在）
  // effortId：GitHub 一个仓库只有一个隐含 effort，核心字段填 ''（EMPTY，不是 MISSING）
  // 为什么整体标成 Issue：后面还要补作者与里程碑等可选能力，先定死契约形状，后面补字段才不会报缺成员。
  const issue: Issue = {
    key,
    effortId: '',
    type,
    commentCount: deriveCommentCount(raw, comments),
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
    comments,
    blockedBy,
    // reason：GitHub 支持 closedReason，open 也输出 ''(EMPTY)
    reason: bag && typeof bag.reason === 'string' ? bag.reason : (bag && typeof bag.stateReason === 'string' ? (bag.stateReason as string) : ''),
  }

  // 能力字段：author（有则给对象，无则 MISSING → 省略）
  const authorRaw = bag && (bag.author || bag.user);
  const author = normalizeActor(authorRaw)
  if (author) issue.author = author

  // milestone：有则给对象，无则 MISSING（省略）
  const milestone = normalizeMilestone(raw)
  if (milestone) issue.milestone = milestone

  // customFields：GitHub 无结构化字段 → 始终 MISSING（省略）
  // 不产出 customFields

  // 拉取请求三字段：本房恒有能力，逐票必带（#505 交接）；缺内容给空值，不省略
  issue.isPullRequest = deriveIsPullRequest(raw)
  issue.mergedAt = mergedAt
  issue.reviews = normalizeReviews(raw)

  return issue
}

export default normalizeIssue
