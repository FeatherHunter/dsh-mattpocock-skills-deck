/**
 * src/tracker/identity-keys.ts —— 票的身份算法：由 (effortId, key) 现算稳定身份。
 *
 * ── 为什么这份文件住在这里 ──────────────────────────────────────────────────
 * 它原来住在契约目录（`src/tracker/contract/vocabulary.ts` 末尾那一段“票的身份算法”）。
 * 契约目录只许放类型与契约自己的数据（门禁 `tests/verify-contract-types.js` 守着这条），
 * 而这四个函数是**行为**（被全仓三十多处调用的同一把尺子），所以按地图02开发票
 * （#1026）的裁决搬到这里：不在契约目录、两个后端都能引用，全仓改导入路径、行为一个字不改。
 *
 * ── 语义（与搬家前逐字一致） ────────────────────────────────────────────────
 * 本地 Markdown 后端的一个仓库可以有多个工作单元（`.scratch/<effort>/`），每个单元的票
 * 各自从 01 编号，所以「编号」在仓库内不再唯一，唯一的是 **(effortId, key)** 这一对。
 * 单工作单元后端（GitHub/GitLab）的工作单元标识恒为 ''（空串，不是缺席），身份退化成编号本身。
 * 返回值只用于比较与做键：不展示、不拼路径、不解析回两段。
 * 分隔符用 NUL（目录名与编号里都不会出现它，所以拼接结果不会和别的组合撞键）。
 *
 * ── 为什么每个函数都包 try/catch ────────────────────────────────────────────
 * 入参是跨层传进来的票对象（后端回包、老快照、手写数据），字段上可能挂着会抛异常的取值器。
 * 身份算法是读路径上最高频的调用，抛一次就会把整趟快照掀翻；拿不到就回空串，调用方按“未知”处理。
 */

/** 身份两段之间的分隔符：NUL（目录名与编号里都不会出现它，拼接结果不会撞键）。 */
export interface EffortCarrier {
  /** 工作单元标识；缺席、空值都按“单工作单元”处理。 */
  readonly effortId?: unknown
}

/** 能带编号的东西：只读 `key` 这一格（数字编号也认，统一转成串）。 */
export interface KeyCarrier {
  /** 票号；缺席、空值都按空串处理。 */
  readonly key?: unknown
}

/** 一张票（取身份只看这两格；多余字段一律忽略）。 */
export type IdentityCarrier = EffortCarrier & KeyCarrier

/** 阻塞引用：后端给的是对象，老快照与手写数据可能是裸字符串或数字；三种都认。 */
export type BlockRef = string | number | { readonly key?: unknown; readonly number?: unknown } | null | undefined

/**
 * 取一张票所属的工作单元标识；单工作单元后端返回 ''（空串，不是缺席）。
 *
 * 空值、缺席、取值器抛异常都回 ''：调用方拿它只能做比较与拼键，不能解读成“没有这个维度”。
 */
export function effortOf(issue: EffortCarrier | null | undefined): string {
  try {
    if (!issue) return ''
    const v = issue.effortId
    return v === undefined || v === null ? '' : String(v)
  } catch {
    return ''
  }
}

/**
 * 由两段现算身份（手上只有工作单元标识与编号、没有票对象时用）。
 *
 * 工作单元标识为空时就是编号本身（单工作单元后端退化成老行为，老快照的键不用重算）。
 */
export function idOfParts(effortId: unknown, key: unknown): string {
  const effort = effortId === undefined || effortId === null ? '' : String(effortId)
  const k = key === undefined || key === null ? '' : String(key)
  // 分隔符用 NUL 字面量（不单列模块常量：两扇门禁把本函数原文截出来单跑，引外部常量会断；
  // 目录名与编号里都不会出现 NUL，所以拼接结果不会和别的组合撞键）。
  return effort ? effort + '\u0000' + k : k
}

/**
 * 票在仓库内的稳定身份：`工作单元标识 + 分隔符 + 编号`；工作单元标识为空时就是编号。
 */
export function idOf(issue: IdentityCarrier | null | undefined): string {
  try {
    if (!issue) return ''
    return idOfParts(effortOf(issue), issue.key)
  } catch {
    return ''
  }
}

/**
 * 阻塞引用取键：对象取 `key`（没有再取 `number`），裸字符串或数字直接转成串；拿不到返回空串。
 */
export function refKeyOf(b: BlockRef | { readonly [extra: string]: unknown }): string {
  try {
    if (b === undefined || b === null) return ''
    if (typeof b === 'string' || typeof b === 'number') return String(b)
    if (typeof b === 'object') {
      const o = b as { readonly key?: unknown; readonly number?: unknown }
      if (o.key !== undefined && o.key !== null && o.key !== '') return String(o.key)
      if (o.number !== undefined && o.number !== null) return String(o.number)
    }
    return ''
  } catch {
    return ''
  }
}
