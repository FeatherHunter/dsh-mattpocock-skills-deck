/**
 * src/tracker/contract/inputs.ts —— 契约的入参形状：调用方交给房间的东西
 *
 * ── 这一件在五件里的位置 ────────────────────────────────────────────────────────
 * 按「谁读它」拆五件（见同目录 README.md）：本件放**调用方交给房间的所有形状**，
 * 读者是房间的实现（拿它当函数签名里的参数）与 deck 工具（拿它当调用时填的东西）。
 * 判断尺子只有一条：**它是流进房间的**（过滤器、补丁、选项、建票输入）—— 流出来的
 * （回值、失败、选择结论）住 results.ts。
 *
 * 按这条尺子，旧文件「入参与选项」一节里的 `Dependencies`、`Counts`、`PageResult`
 * 三个回值形状搬去了 results.ts，留下的才是真入参；这是有意的归位，不是搬错。
 *
 * 本件只引用地基层（枚举）与实体层（里程碑、自定义字段这些要被写进去的东西），
 * 不引用回值那一件：入参是链路前端，它不该依赖末端才产生的东西。
 */

import type { ActorKind, ClosedReason, IssueType, State } from './identity.js'
import type { CustomField, Milestone } from './entities.js'

// ─────────────────────────────────────────────────────────────────────────────
// 五、各操作的入参与选项
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 列出票时的过滤器。
 * 各字段都是可选：省略表示不按这一项收窄。`parentKey: null` 与省略不同 ——
 * 前者明确要「根票」，后者是「全部」（含子票）。
 */
export interface ListFilter {
  /** 只要某一类（票或地图）。 */
  type?: IssueType
  /**
   * 只要某一种状态。两种真实口径并存，调用方要知道自己在用哪一种：
   * 列出票时按严格相等筛；计数与分页认不出这个取值时当「两种状态都要」。
   * 所以 `state: 'all'` 这种写法在列出票上会把所有行都筛掉，不要用它表达「全部」——省略才是全部。
   */
  state?: State
  /**
   * 只要带这些标签的票（必须同时带上这些标签）。
   * 空数组与省略相同：都是不过滤（#1183 定为准行为，三后端与工具层都这么做；
   * 远端对空数组的反应各版本不一，所以远端查询只在标签非空时才带上它）。
   */
  labels?: string[]
  /** `null` = 只要根票；省略 = 全部。 */
  parentKey?: string | null
  /** 批量按编号取。 */
  keys?: string[]
  /** 只要拉取请求（界面上的拉取请求过滤器用）。 */
  isPullRequest?: boolean
  /**
   * 只要「更新时间不早于这个时刻」的票（ISO 8601 时刻串，例如 2026-10-24T12:00:00Z）。
   * 给刷新后台做增量索引窗口用：窗口起点之后的票才值得再翻一遍，服务端能筛就不要每拍全量翻。
   * 其余后端可以忽略这一格（忽略只表示多翻了几页，不会漏票）；GitHub 房间把它翻成
   * GraphQL 的 filterBy.since。非法或缺失按「不设窗口」处理，不报错。
   */
  since?: string
}

/** 读单票的选项（今天只有评论分页一项）。 */
export interface GetOpts {
  /** 评论分页：要前几条、从哪个游标之后开始。 */
  comments?: { first: number; after?: string }
}

/** 批量取阻塞关系的选项。 */
export interface DepsOpts {
  /** 一次问多个编号（宿主对结果做缓存）。 */
  keys?: string[]
}

/** 建票的输入。 */
export interface CreateInput {
  title: string
  body?: string
  type?: IssueType
  /** 挂在哪个地图下面；根票给 `null` 或省略。 */
  parentKey?: string | null
  labels?: LabelInput[]
  assignees?: AssigneeInput[]
  /**
   * 创建幂等锚（可选）。
   * 要解决的问题只有一句：票已经建成了，只是调用方没收到回答 —— 超时、EOF、退出码非 0
   * 却已经写进去了，外层一重试就多一张票。给了锚之后，同一个锚提交两次只会多出一张票、
   * 两次拿到同一个 key。
   * 键只允许字母、数字、点、下划线、连字符、冒号、斜杠，最长 200 字符；不合规当场按
   * `parse` 失败，**不做清洗**（清洗过的键与调用方手里那个就不是同一个串了）。
   * 回查拿不准时必须如实失败、绝不建票：「拿不准」当成「没找到」正是重复建票的来路。
   * 不传这个字段时，行为与没有它之前完全一样。
   */
  idempotencyKey?: string
}

/**
 * 初始化并发布工作区的输入。
 * ⚠️ 这个类型在今天的 `contract.js` 里**被引用但没有定义**（第 50 行的 initProject 签名引了
 * 一个不存在的 `InitProjectInput`），全仓也搜不到定义。这里按实现里的真实用法补出来：
 * `backends/github/init-project.js:27-28` 读的就是 `name` 与 `visibility` 两个字段。
 * 形状以那一处为准；将来若改发布流程的入参，两处一起改。
 */
export interface InitProjectInput {
  /** 仓库名（不含拥有者）；只允许字母、数字、点、下划线、连字符，最长 100。 */
  name: string
  /** 可见性；省略按私有处理（实现里的默认值就是私有）。 */
  visibility?: 'public' | 'private'
}

/** 关票的选项。 */
export interface CloseOpts {
  /** 关闭原因；不传就看后端默认。 */
  reason?: ClosedReason
}

/**
 * 改票的补丁（多字段一次原子写）。
 * 一个字段都不给时不该发写请求（那是空操作，白花一次配额）。
 */
export interface UpdatePatch {
  title?: string
  body?: string
  milestone?: Milestone | null
  customFields?: CustomField[]
}

/**
 * `setLabels` / `setAssignees` / `setParent` / `setBlockedBy` 的公共选项。
 * `expectedUpdatedAt` 是乐观并发控制：与后端当前的更新时间对不上就返回 `conflict`，
 * 不做「后写覆盖先写」。
 */
export interface SetOpts {
  expectedUpdatedAt?: string
}

/**
 * 标签输入：可以只给名字（`'bug'`），也可以给完整形状。
 * 房间实现要把裸字符串归一成 `{name, color: ''}` 那种形状再用。
 */
export type LabelInput = string | { name: string; color?: string; description?: string }

/** 指派输入：可以只给登录名（`'octocat'`），也可以给完整形状。 */
export type AssigneeInput =
  | string
  | { login: string; kind?: ActorKind; name?: string; avatarUrl?: string }

/** 按页取票的选项。 */
export interface PageOpts {
  /** 上一页给回来的不透明游标；第一页省略或给空串。调用方**不许**自己解析或拼装它。 */
  cursor?: string
  /** 一次要几行；缺省 50，超过 200 按 200 处理（要多了不报错，按上限给）。 */
  limit?: number
}
