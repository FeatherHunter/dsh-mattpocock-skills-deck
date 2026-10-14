/**
 * tracker/detection/selection-precedence.ts — 判定结论的裁决顺序（唯一真源）
 *
 * 这个文件只回答一个问题：手上同时有几个候选结论时，这一次采用谁？
 *
 * 为什么值得单独一个文件：
 *  - 它是一条**规则**，不是一段流程。规则要能被单独问、单独验；从前它长在 357 行的探测服务里，
 *    门禁想验「上报的选择不算一层」只能把整份服务源码切碎了当场求值——那份服务因此连类型标注都不能写
 *    （写了门禁求值就语法报错），56 条类型错误一直挂着（#1169）。
 *  - 它没有环境依赖：不读盘、不联网、不看时钟、不记日志。纯函数，进出都是数据。
 *  - 它被探测服务与三条门禁（297 / 669 / 683）同时用到，是这个决定唯一该被改动的地方。
 *
 * 裁决顺序（唯一真源，改动前先看这里有没有人说得出理由）：
 *  1. 统一判定出口给出了带后端名的结论 → 采用它（出口是判定的唯一真源，见 backendDecision.ts）；
 *  2. 否则工作区里那份声明文件（锚文件）给了结论 → 采用它；
 *  3. 出口被问过但没给出带名的结论 → 用它的无结论那份，再不行用兜底（没有后端）；
 *  4. 出口根本没被问过（平台层没递） → 如实返回锚文件的结论，可能是「不知道」（null），**不产出兜底**。
 *
 * 一条不能改的约定：**调用方上报的选择（opts.hintBackendId）不是一层**。
 * 用户点确认走的是写入口落文件这条路，不经上报参数；把上报算成一层就等于同一件事有两个答案（#1003 已删掉那条老路径）。
 * 所以下面的入参里没有「上报」这一格——它不是被排在后面，而是根本不参与裁决。
 */

/** 裁决只关心结论的这几格；对外五个字段的真源在契约层（backendDecision.ts 的 Selection）。 */
export interface SelectionLike {
  /** 后端名；没有结论时是 null。 */
  backendId: string | null
  /** 这一格结论的来源词（写进 choiceSource，排查时看「谁定的」）。 */
  source: string
}

/** 一次裁决的全部输入。 */
export interface SelectionCandidates<S extends SelectionLike> {
  /** ① 工作区里那份声明文件（锚文件）给出的结论；没读到就是 null。 */
  declared: S | null
  /** 出口有没有被问过。没装出口（平台层没递）时是 false —— 这时不产出兜底结论。 */
  outletConsulted: boolean
  /** ② 统一判定出口给出的结论（已经过 selectionFromOutlet 归一）；问过但没答案就是 null。 */
  outlet: S | null
  /** 出口这一次的原话来源；只用于 choiceSource，不参与裁决。 */
  outletOrigin: string | null
}

/** 一次裁决的结果。 */
export interface SelectionVerdict<S extends SelectionLike> {
  /** 采用的结论；出口没被问过且锚文件也没答案时是 null。 */
  selection: S | null
  /** 这一格结论是谁定的：出口的原话来源、'none'（出口没答案）或空串（锚文件定的 / 没问过出口）。 */
  choiceSource: string
}

/** 兜底结论：没有后端，来源标 fallback。对外结构里的那一份与从前逐字一致。 */
export const FALLBACK_SELECTION: SelectionLike = { backendId: null, source: 'fallback' }

/**
 * 按上面那份裁决顺序挑出这一次采用的结论。
 *
 * 入参里没有「上报」这一格是有意的：上报不参与裁决，给它留一格就等于给它留了翻盘的机会（见文件头最后一条约定）。
 * 泛型只为让调用方拿回自己那份结论类型（探测服务用的是契约层的 Selection），运行时没有任何额外动作。
 */
export function resolveSelection<S extends SelectionLike>(c: SelectionCandidates<S>): SelectionVerdict<S> {
  if (c.outlet && c.outlet.backendId) return { selection: c.outlet, choiceSource: c.outletOrigin || '' }
  if (c.declared) return { selection: c.declared, choiceSource: '' }
  if (!c.outletConsulted) return { selection: null, choiceSource: '' }
  // 兜底那份没有后端名，所以按调用方的结论类型交回去要说一声：这是有意的，不是漏了字段。
  return { selection: (c.outlet || FALLBACK_SELECTION) as S, choiceSource: c.outletOrigin || 'none' }
}
