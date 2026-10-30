/**
 * src/tracker/contract/field-state.ts —— 字段三态的通用形状：有值 / 明确为空 / 不知道
 *
 * 为什么要有它（#1688；来龙去脉见 docs/adr/20261030-panel-snapshot-single-source.md 第 40-43 行）：
 * 读回来的票上很多字段有「确实为空」与「来源这次没说」两种空法。以前两者都落成 `[]`、`0`、`null`，
 * 合并时就把「不知道」当成事实（典型例子：缺依赖边看起来像「没有依赖」，缺父票看起来像「没有父票」）。
 * 这里把三态定成一种可判读的类型，谁读它都能分清「知道是空」和「不知道」。
 *
 * 约定（改之前先读这四条）：
 *  1. 只有三态，不许魔法值：`known: true` 带真值且 `reason` 为 null；`known: false` 的
 *     `value` 必须是 null，`reason` 只能取 FIELD_STATE_REASONS 里的词。不要用 `[]`/`0`/`''` 冒充未知。
 *  2. 三个原因各说一件事：
 *     `not-expressed` = 来源这次没表达这个字段组（不代表没有，也不代表完整）；
 *     `not-applicable` = 这类对象原生没有这个字段（例如拉取请求类型没有父票边）；
 *     `unreadable` = 来源给了，但形状读不懂（坏值）。
 *  3. 契约层只许类型与常量（tests/verify-contract-types.ts 第二项）：这里不写函数，构造器在各后端的归一化里。
 *  4. 已知与未知怎么落到字段上由各后端的归一化决定（当前唯一生产者是 GitHub 房的
 *     src/tracker/rooms/github/model/normalize.ts）；非 GitHub 后端可以整块省略三态，
 *     按「`[]`/`null` 就是明确为空」的旧口径读，这一条就是契约给它们的显式默认值。
 */

/** 「不知道」的三个原因。三个词各有边界（见文件头第 2 条），不许多编第四个词。 */
export const FIELD_STATE_REASONS = ['not-expressed', 'not-applicable', 'unreadable'] as const

/** 三态里「不知道」的原因词。 */
export type FieldStateReason = (typeof FIELD_STATE_REASONS)[number]

/**
 * 一个字段或一个字段组的三态。
 * 用 `known` 当判别位（不看 value 是不是 null）：明确为空也是一条事实，必须与「不知道」分开。
 */
export type FieldState<T> =
  | { readonly known: true; readonly value: T; readonly reason: null }
  | { readonly known: false; readonly value: null; readonly reason: FieldStateReason }
