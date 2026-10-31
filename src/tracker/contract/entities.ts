/**
 * src/tracker/contract/entities.ts —— 契约的实体形状：票、标签、评论、参与人、仓库身份
 *
 * ── 这一件在五件里的位置 ────────────────────────────────────────────────────────
 * 按「谁读它」拆五件（见同目录 README.md）：本件放**实体**，读者是房间（造出它们）、
 * deck 工具与面板（消费它们）。本件只引用地基层 `identity.ts`：实体要用到状态、
 * 种类、关闭原因这些枚举，但**不引用**返回值与入参 —— 实体是「东西长什么样」，
 * 不回答「这次调用成没成」。
 *
 * 与返回值那一件（results.ts）的分界：`LabelColorBatchResult`（逐条记账的结果）住在
 * results.ts，不在这里。原因是它要用到失败形状 `TrackerError`，而失败形状属于返回值那一件；
 * 若把它放在本件，就会形成「实体引返回值、返回值引实体」的环。
 */

import type { Actor, BackendId, ClosedReason, IssueType, State } from './identity.js'
import type { FieldState } from './field-state.js'

// ─────────────────────────────────────────────────────────────────────────────
// 二、实体形状：票、标签、评论、参与人
//
// 这些形状今天住在 `src/shared/tracker/shape.js`（JSDoc），宿主与客户端共用。
// 写在这里是为了让契约自洽：operations.ts 的每个操作都要引用它们。
// 迁移时 shape.js 的去留另定（它服务的读者比契约层更宽），本轮不动它。
// 参与人（Actor）住在 identity.ts，理由见那个文件里的说明。
// ─────────────────────────────────────────────────────────────────────────────

/** 一个标签。 */
export interface Label {
  /** 标签名，**原样**返回（不做大小写折叠；名字里可以有冒号与空格，例如 `wayfinder:map`）。 */
  name: string
  /** 颜色，不带井号的六位小写十六进制（例：`8b5cf6`）；后端给不了颜色就写 `''`。 */
  color: string
  /** 可选的说明文字；后端给不了就整个字段省略。 */
  description?: string
}

/** 一条评论。 */
export interface Comment {
  /** 评论 id（用于串接与追踪编辑）；后端给不了就省略。 */
  id?: string
  /** 谁写的。 */
  author: Actor
  /** 作者与仓库的关系，GitHub 是 OWNER/MEMBER/CONTRIBUTOR/NONE，本地是 `''`。 */
  authorAssociation: string
  /** 评论正文（Markdown 原文，渲染由宿主负责）。 */
  body: string
  /** 创建时间（ISO 字符串）；给不了写 `''`。 */
  createdAt: string
  /** 最后更新时间；给不了写 `''`。 */
  updatedAt: string
  /** 编辑时间；从来没有编辑过就省略或给 `null`。 */
  editedAt?: string | null
}

/** 里程碑。 */
export interface Milestone {
  name: string
  description?: string
  state?: 'open' | 'closed'
  /** 到期日；没有就 `null`。 */
  dueOn?: string | null
}

/**
 * 结构化自定义字段。
 * ⚠️ 这是**说明性元数据，绝不驱动 deck 逻辑**：界面上可以显示，任何判定都不许读它。
 */
export interface CustomField {
  name: string
  value: string | number | boolean | null
  /** 字段类型（开放字符串），保留值 `text` / `number` / `date` / `single` / `multi`。 */
  type: string
  /** 单选/多选的候选值。 */
  options?: string[]
}

/** 拉取请求的一条评审记录（只读快照）。 */
export interface Review {
  /** 评审结论（开放文字），保留写法 `approved` / `changes_requested` / `commented` / `dismissed`。 */
  state: string
  /** 给出这条评审的人；没有就不写这个字段。 */
  reviewer?: Actor
  /** 给出评审的时间；没有就不写这个字段。 */
  submittedAt?: string
}

/**
 * 票/图的轻量引用（不递归展开），用于阻塞关系与子票清单。
 * `key` 的解析范围是**引用方所在的工作单元（effort）**：本地 Markdown 的 `Blocked by:`
 * 只在同一个 effort 里找同号票，跨 effort 的同号票是两张不同的票。
 */
export interface IssueRef {
  /** 规范 id：GitHub 是编号字符串，本地 Markdown 是两位数编号，GitLab 是 iid。 */
  key: string
  title: string
  /** 归一化后的两态；**缺省表示状态未知**（例如本地 Markdown 的阻塞目标票读不到）。
   *
   *  缺省不是 open：消费方不得把它当成「还开着」去拦住别人的动作，也不得因此丢掉这条边。
   *  只有明确读到状态时才写这一格。 */
  state?: State
  /** 边上带种类时给出（指向地图还是票）。 */
  type?: IssueType
}

/**
 * 子票计数（一张地图下有多少子票、完成了多少）。
 *
 * 为什么不塞进 Issue 的数组：三态里「缺计数保持未知」要能说出口——计数没取到时整组是未知的，
 * 不能落成 `total: 0`（那等于声称没有子票）。形状与 REST 列表行的 sub_issues_summary 一致。
 */
export interface SubIssueCounts {
  /** 子票总数。 */
  total: number
  /** 已关闭的子票数。 */
  completed: number
  /** 完成百分比（0..100 的整数）。 */
  percentCompleted: number
}

/**
 * 一张票上按字段组的三态快照（#1688 落，消费方是快照合并）。
 *
 * 为什么要有它：Issue 上的 `parentKey`/`blockedBy`/`commentCount`/`reviews`/`mergedAt`
 * 分不清「确实为空」与「这次没取到」——缺边写成 `[]`、缺父票写成 `null`，合并层就把未知当事实。
 * 六组三态把这件事说清；每组的「知道」与「不知道」都能判读。
 *
 * 约定（改之前先读这四条）：
 *  1. 六组是固定的一整套：给了 `fieldStates`，六组就必须齐全（省略整块 = 这个后端没有三态口径，
 *     按能力字段的旧口径读）；单组缺席或形状不对由门禁判红。
 *  2. 已知时值必须与 Issue 上的对应字段一致：parents↔parentKey、dependencies↔blockedBy、
 *     comments↔commentCount、review↔reviews、mergeInfo↔mergedAt；subIssues 没有对应字段，只在这里。
 *  3. 未知时 Issue 上那个字段整个省略。`parentKey` 是例外：它是核心字段、永远存在，未知时仍写
 *     `null`，读的人必须看这里才知道是「没有父票」还是「不知道」。
 *  4. 只有字段组「完整」的来源才允许按这里的值删改上次已知（完整度在 ReadProvenance 上按组表态）；
 *     截断或未表达的来源只能补空缺。这条是下一张票（#1690）的合并规则，本契约只承载事实。
 */
export interface IssueFieldStates {
  /** 父子边：父票 key；`null` 表示明确没有父票。 */
  readonly parents: FieldState<string | null>
  /** 依赖边：谁阻塞我；`[]` 表示明确没有阻塞者。 */
  readonly dependencies: FieldState<IssueRef[]>
  /** 子票计数。 */
  readonly subIssues: FieldState<SubIssueCounts>
  /** 评论总数；评论正文取没取看 Issue.comments 与 provenance 的 comments 组完整度。 */
  readonly comments: FieldState<number>
  /** 评审明细；`[]` 表示明确没有评审。 */
  readonly review: FieldState<Review[]>
  /** 合并时间；`null` 表示明确还没合并。 */
  readonly mergeInfo: FieldState<string | null>
}

/**
 * 票/图的完整实体。
 *
 * 核心字段**永远存在**（缺了用 `''`/`null` 补齐），能力字段**可以整个省略**（= 没有这个能力）：
 * - 核心：key、effortId、type、title、state、body、url、createdAt、updatedAt、closedAt、parentKey
 * - 能力：author、assignees、labels、milestone、customFields、reason、blockedBy、comments、
 *   isPullRequest、mergedAt、reviews、fieldStates
 *
 * ⚠️ `blocking`（我阻塞了谁）**不许**作为 Issue 的字段：它是 `blockedBy` 的反向派生，
 * 只允许出现在 `getDependencies` 的返回值里。放进来就是第二真源，两处迟早对不上。
 */
export interface Issue {
  /** 规范 id，**在本工作单元内**唯一；全局身份是 (仓库引用, effortId, key) 三元组。 */
  key: string
  /**
   * 这张票属于哪个工作单元（核心字段，永远存在）。
   * 本地 Markdown 是 `.scratch/<工作单元>/` 的目录名；单工作单元的后端（GitHub/GitLab）写 `''`。
   * 父子关系与阻塞引用都按它圈定范围，不跨工作单元解析。
   */
  effortId: string
  /** 票的种类。 */
  type: IssueType
  title: string
  state: State
  /** 正文（Markdown 原文）；宿主负责渲染，后端不产出渲染结果。 */
  body: string
  /** 可点开的链接；本地后端没有链接就写 `''`。 */
  url: string
  /** 创建时间；没有写 `''`。 */
  createdAt: string
  /** 更新时间；没有写 `''`。 */
  updatedAt: string
  /** 关闭时间；没有关闭就是 `null`。 */
  closedAt: string | null
  /** 父地图的 key；根票是 `null`（核心字段，永远存在）。 */
  parentKey: string | null
  author?: Actor
  /** 指派人（认领）；`[]` 表示明确「没人认领」，整个字段省略表示「认领状态未知」。 */
  assignees?: Actor[]
  /** 标签；`[]` 表示有能力但没标签，省略表示这个后端给不了标签。 */
  labels?: Label[]
  milestone?: Milestone
  customFields?: CustomField[]
  /** 关闭原因，只在 `state === 'closed'` 时有意义。 */
  reason?: ClosedReason
  /** 谁阻塞我（入边，唯一真源）。 */
  blockedBy?: IssueRef[]
  /** 评论（决策记录）。 */
  comments?: Comment[]
  /** 评论总数（后端能给就给，拿不到就省略；调用方不许拿 comments.length 当总数）。 */
  commentCount?: number
  /** 是不是拉取请求：能判断就写 true/false，判断不了就省略这个字段。 */
  isPullRequest?: boolean
  /** 合并时间，还没合并是 `null`；没有拉取请求能力的后端省略。 */
  mergedAt?: string | null
  /** 评审细分，没有评审给 `[]`；没有拉取请求能力的后端省略。 */
  reviews?: Review[]
  /**
   * 按字段组的三态快照（#1688）。省略 = 这个后端不区分「明确为空」与「不知道」，
   * 按能力字段的旧口径读（`[]`/`null` 就是明确为空）；GitHub 房每次归一都给六组齐全。
   * 组的清单、语义与「已知时与上面字段一致」的约定见 IssueFieldStates。
   */
  fieldStates?: IssueFieldStates
}

/**
 * 归一化后的目标仓库（选定后端之后的身份）。
 * `backend` 是**非空**开放字符串；「没有后端」只走 `Selection.backendId: null`，
 * 那种情况下不产出本对象（不许造假身份）。
 */
export interface RepositoryRef {
  backend: BackendId
  /** 稳定标识：GitHub/GitLab 是 `owner/name`，本地 Markdown 是路径。 */
  refId: string
  /** 显示名（界面上那一行字）。 */
  name: string
  /** 远端地址；本地是 `''`。 */
  url: string
  /**
   * 远端网页端的 origin（`scheme://host[:port]`，例如 `https://gitlab.example.com`、
   * `http://10.1.2.3:8086`）。可选：本地后端、以及主机就是服务商默认域名的后端省略；
   * 给出来时拼仓库/票链接以它为准，不要再换成服务商域名。
   */
  host?: string
  /**
   * 可选的寻址范围：省略 = 这个仓库的全部工作单元（列表用）；给出 = 只针对这一个工作单元读写。
   * 为什么放在仓库引用上、而不是给每个操作加一个参数：操作签名已经定版，
   * 给 comment/reopen/update 加形参会把调用上下文挤位、破坏既有后端实现。
   */
  effortId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 六之一、标签配色的两个「行」形状
//
// 这两条是「标签颜色可编辑」这件事的行形状：界面只跟它们打交道，不知道底下是 GitHub 的
// 仓库标签，还是本地工作区里那个用户可以自己手改的配色文件。
// 逐条记账的**结果**形状（LabelColorBatchResult）住在 results.ts，理由见本文件头。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一条标签与它的颜色。
 * 颜色统一写成**不带井号的六位小写十六进制**；空串表示「这个标签还没配颜色」，
 * 界面按灰色显示 —— 「能返回颜色但不知道颜色」是空值，不是省略。
 * 列表项只许这三个键：不带「有多少张票在用这个标签」这类计数，也不带分组标记。
 */
export interface LabelColor {
  /** 标签名，原样返回（不折叠大小写；名字里可以有冒号与空格）。 */
  name: string
  /** 六位小写十六进制、不带井号；`''` 表示还没配颜色。 */
  color: string
  /** 说明文字；省略表示这个后端给不了。 */
  description?: string
}

/** 批量改色里的一条改动：标签名与新颜色。调用方只放**真正变了**的那些。 */
export interface LabelColorChange {
  name: string
  /** 新颜色（六位十六进制，大小写都收）；写进真源后由后端给回小写。 */
  color: string
}