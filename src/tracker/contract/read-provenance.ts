/**
 * src/tracker/contract/read-provenance.ts —— 读结果的来源、按字段组完整度与取数时间窗
 *（规格 1681 第 3、5、9 节；票 #1685）
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * 「这一次读，数据实际是从哪条渠道取回来的？取全了没有？没取全的是哪几组？」
 * 在此之前，读结果只有数据本身（`OpResult<T>` 的 `data`）与一个笼统的 `truncated?: boolean`：
 * 调用方看不出这次是 GraphQL 主路还是 REST 降级，也看不出「行拿到了、评论没拉」这种
 * 按字段组割裂的状态。规格 1681 第 3 节要求读结果自带这四样信息（实际来源、按字段组完整度、
 * 缺失字段组、取数开始版本），第 5 节给出每个字段组的完整度判据，第 9 节要求来源与实际
 * 记账渠道一致。
 *
 * ── 为什么放在契约层 ────────────────────────────────────────────────────────────
 * 读结果的消费者不只有后端房间：宿主面板快照（阶段 2）、客户端投影（阶段 3）都要按字段组
 * 合并，三个后端（GitHub、GitLab、本地 Markdown）也都要交同一形状。契约目录是它们都能引的
 * 公共层，而且本文件只有类型与数据，符合契约层「只许类型与数据」的纪律
 * （`tests/verify-contract-types.ts` 盯着这条）。组装与校验是有行为的代码，住在
 * `src/tracker/rooms/github/routing/read-result.ts`，不在本文件。
 *
 * ── 三条不能改的约定 ───────────────────────────────────────────────────────────
 * 1. 完整度按字段组分别表态，不给一个总体布尔。`completeness` 是给界面排序与降级提示用的
 *    汇总值，由各组派生（派生规则见上面那个组装文件）；谁要判断「这一组能不能用」，必须看
 *    `fieldGroups` 里那一组，不能看 `completeness`。一个总体布尔正是这次要拆掉的东西。
 * 2. 三态不许借用魔法值：每组的取值只能是 `FIELD_GROUP_COMPLETENESS` 里的三个词。
 *    `complete` 是「能证明取全了」；`truncated` 是「到了上限或中途丢页，肯定不全」；
 *    `unexpressed` 是「这次根本没取这一组，不代表没有，也不代表完整」。
 *    恰好翻到整数页不算完整：没有空页探测或明确页数上限时，只能记 `truncated`。
 * 3. `source` 是开放字符串，不是封闭词表。规格第 3 节只强制 GitHub 返回真实渠道；
 *    GitLab 与本地 Markdown 写自家通道名（今天的默认值见操作百科的
 *    `OwnChannelReadSource`：`gitlab-api`、`markdown-files`），第三方后端可以写自己的名字。
 *    GitHub 房间里「哪些词合法」由路由层与 `tests/verify-read-result-provenance.ts` 守，
 *    契约层不造一个跨后端的假词表。
 */
import type { FieldGroup, ReadOperationName } from './operations-encyclopedia.js'

/**
 * 一个字段组在这次读结果里的完整度。
 *
 * 三个值的含义与公众号召见文件头的第 2 条约定：`complete` 要能证明取全，
 * `truncated` 是到上限或丢页，`unexpressed` 是这次没取。
 */
export const FIELD_GROUP_COMPLETENESS = ['complete', 'truncated', 'unexpressed'] as const
export type FieldGroupCompleteness = (typeof FIELD_GROUP_COMPLETENESS)[number]

/**
 * 整个读结果的汇总完整度（给人看、给界面排序用，不替代字段组）。
 *
 * `complete`：声明的字段组全都 `complete`；
 * `truncated`：至少一组 `truncated`（有明确的「不全」，降级提示优先说这个）；
 * `partial`：没有截断，但至少一组 `unexpressed`（这次没取的组不影响已取的部分）。
 *
 * 为什么不沿用旧的 `truncated?: boolean`：那个布尔把「没取」和「取不全」压成同一个 false，
 * 上层分不清该重取还是该补字段。新字段并存期间，旧布尔保持原值不动（阶段 1 行为不变），
 * 阶段 2 的合并层按这里的三态判断。
 */
export const READ_RESULT_COMPLETENESS = ['complete', 'truncated', 'partial'] as const
export type ReadCompleteness = (typeof READ_RESULT_COMPLETENESS)[number]

/**
 * 读结果的实际来源渠道名。
 *
 * GitHub 房间今天写 `graphql` / `rest` / `local` / `mixed` 四个词（词表与校验在
 * `src/tracker/rooms/github/routing/read-result.ts`）；其它后端写自己的通道名。
 * 用字符串而不是封闭联合，是给第三方后端留位置：契约层替它们编词表只会逼它们说谎。
 */
export type ReadResultSource = string

/**
 * 一次读操作交回来的「这趟读是怎么来的」。
 *
 * 为什么七个字段都要有：
 * - `operation`：这是哪条读操作的来源。同一份数据可能由 `list` 与 `get` 两条路取回，
 *   合并层要靠它判断两条来源有没有可比性；也让门禁能按操作逐条核对。
 * - `source`：实际用了哪条渠道（不是「允许用哪条」，那是操作百科的 `channels`）。
 * - `completeness`：汇总三态，见 `READ_RESULT_COMPLETENESS`。
 * - `fieldGroups`：按字段组表态。键集必须恰好等于操作百科为这条操作声明的组
 *   （GitHub 路由层强制，门禁逐条核对）；类型写成 `Partial` 是因为不同操作声明不同，
 *   单看类型没法把「这条操作该有哪几组」也编进去。
 * - `missingFieldGroups`：不是 `complete` 的那些组，按契约 `FIELD_GROUPS` 的顺序排。
 *   单独列一份是为了让界面与日志不用每次自己从 `fieldGroups` 里筛，也避免两边筛法不一致。
 * - `durationMs`：从开始取数到交出结果的毫秒数，用于超时归因与预算统计。
 * - `startVersion`：这一趟读的数据窗口起点（开始取数那一刻的版本标记）。阶段 2 的宿主版本门
 *   要靠它判断「这份结果比快照新还是旧」；阶段 1 先如实记「开始取数的时刻」，房间今天给不出
 *   仓库快照版本，字符串格式由 GitHub 路由层定义并校验。
 * - `degradedFrom`：走过降级时记主路渠道（例如 REST 兜底时为 `graphql`）。没降级就没有这个键；
 *   它只由后端写，界面不许自己补。
 */
export interface ReadProvenance {
  /** 这是哪条读操作的来源；必须是操作百科里标成读的那些名字之一。 */
  readonly operation: ReadOperationName
  /** 这一次实际取到数的渠道，见 `ReadResultSource`。 */
  readonly source: ReadResultSource
  /** 汇总完整度三态，见 `READ_RESULT_COMPLETENESS`。 */
  readonly completeness: ReadCompleteness
  /** 每条声明字段组的完整度；键集必须等于操作百科该操作声明的组。 */
  readonly fieldGroups: Readonly<Partial<Record<FieldGroup, FieldGroupCompleteness>>>
  /** 不是 `complete` 的字段组，顺序照契约 `FIELD_GROUPS`。 */
  readonly missingFieldGroups: readonly FieldGroup[]
  /** 从开始取数到交出结果的毫秒数，非负整数。 */
  readonly durationMs: number
  /** 这一趟读的数据窗口起点标记；格式由写它的后端定义，非空。 */
  readonly startVersion: string
  /** 走过降级时的主路渠道；没降级就没有这个键。 */
  readonly degradedFrom?: ReadResultSource
}
