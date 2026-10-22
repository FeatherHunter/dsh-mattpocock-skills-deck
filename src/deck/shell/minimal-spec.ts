// src/deck/shell/minimal-spec.ts —— 强制最小规范（宿主侧门面）
//
// 本件在 #1039 拆层后只剩三件事：
//   一、把纯规则侧（src/deck/rules/minimal-spec.ts 与 anchor.ts）的实现原样转出去，
//       让原来 import 这个路径的地方一行不用改；
//   二、给幂等锚补上**时钟**这一个宿主依赖（纯侧不读钟，时刻从形参进来）；
//   三、把纯侧那份「必备标签表」与「地图五区块」照旧转出去，供建票与地图骨架取用。
//
// 为什么保留这个门面而不是让调用方直接 import 纯侧：这条路径在过去一段时间里是「写票的
// 最低标准」的公开入口，调用方不止一处；一次性全改会把「拆层」与「改调用点」两件事搅在一起，
// 出问题时看不出是哪一件引起的。等以后调用点自然收敛，再谈删不删这个转发层。
import {
  ANCHOR_WINDOW_MS,
  anchorBucket as bucketOf,
  anchorKeyFor as keyFor,
} from '../rules/anchor.js'
import type { AnchorParts } from '../rules/anchor.js'
import {
  ensureBody as ensureBodyRules,
  ensureLabels as ensureLabelsRules,
  isWholeIssueBody as isWholeIssueBodyRules,
} from '../rules/minimal-spec.js'

export { MAP_BLOCK_TITLES } from '../rules/minimal-spec.js'
// 档位宽度一直是从 anchor.ts 来的（拆分前这个文件自己定义它，拆分后搬去了纯侧），
// 这里照旧从那条路径转出去，调用方看到的来路不变。
export { ANCHOR_WINDOW_MS } from '../rules/anchor.js'
export { labelNames } from '../rules/anchor.js'

// 纯侧的实现原样转出去：写路径与验收脚本各自挑门面或纯侧都行，两处指向的是同一份实现。
export const ensureBody = ensureBodyRules
export const ensureLabels = ensureLabelsRules
export const isWholeIssueBody = isWholeIssueBodyRules

/**
 * 系统时钟。写成函数而不是常量，是为了让调用方显式传时刻进来（验收里要固定时刻造锚），
 * 也为了将来换时钟源时只改这一处。
 */
export function systemNow(): number {
  return Date.now()
}

/**
 * 幂等锚：给「工具名 + 会话/工作区 + 标题 + 标签 + 时刻」算锚。
 *
 * 形参是一个具名对象，时刻（`now`）必须由调用方读出来传进来 —— 纯侧不读钟，
 * 与规则层的同一条规矩。工具入口照旧从自己的依赖袋取钟（`d.now`，缺省 Date.now），
 * 所以「测试里换假时钟」这件事仍然在工具那一层就能做到。
 *
 * 这里替调用方兜一次底：`now` 不是有限数字时读一次真钟。为什么兜底留在这一层而不是规则层 ——
 * 读钟是碰世界，规则层一个字都不许碰（#1038 定版）；宿主侧兜底则沿用拆分前的行为
 *（拆分前也是「不是数字就 Date.now()」），调用方少传一个字段不会算出 NaN 锚。
 */
export function anchorKeyFor(parts: AnchorParts): string {
  const now = (typeof parts.now === 'number' && isFinite(parts.now)) ? parts.now : Date.now()
  return keyFor(Object.assign({}, parts, { now: now }))
}

/** 幂等锚：把时刻压到一个时间档位上（档位宽度由 anchor.ts 的 ANCHOR_WINDOW_MS 定义）。 */
export function anchorBucket(now: unknown, windowMs?: number): number {
  return bucketOf(now as number, windowMs === undefined ? ANCHOR_WINDOW_MS : windowMs)
}

/**
 * 把「调用时刻」定下来：调用方给了就用它的，没给才回落到系统时钟。
 * 两条写路径（建票、补锚）都从这里取时刻，于是「同一个请求内的多次写用同一个档位」这件事
 * 只需要在一处保证。
 */
export function defaultNow(now?: unknown): number {
  return (typeof now === 'number' && Number.isFinite(now)) ? now : systemNow()
}
