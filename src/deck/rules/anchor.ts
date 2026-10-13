// src/deck/rules/anchor.ts —— 幂等锚：把「同一次意图」算成一个稳定的短串（纯规则侧）
//
// 本文件由 src/deck/shell/minimal-spec.ts 拆出（#1039 按 #1038 定版：纯侧收幂等锚，
// 时钟改传参）。行为与拆分前逐字相同，只改了一件事：**不再有 `Date.now()` 兜底** ——
// 拆分前 `now` 缺席时偷偷读钟，现在改成必填形参，缺了编译不过。
//
// 这个文件只回答一个问题：一次写操作该带哪个幂等锚。
// 契约层（#711）拿这个锚回查，同一个锚在 5 分钟窗口里重复出现就复用同一张票 ——
// 重试不会重复花钱。窗口把「重试」与「故意再建一张」分开：窗口之内是同一次意图，
// 之外是新的一次。工具自己不记表，去重的权威在契约层。
//
// 为什么时刻必须从形参进来：读钟是碰外面（#1038 定版）。拆开之后单测可以喂假时钟，
// 同一份输入永远得到同一个锚；宿主侧（工具入口）把真钟读出来传进来。
import type { Timestamp } from './time.js'

/**
 * 幂等窗口的长度，单位毫秒（5 分钟）。
 * 这个数写死在规则里而不是让调用方传：它是「什么样算同一次意图」这条业务判断，
 * 与后端、与工作区都无关；要改就改这一处，别让各调用方各传一个值。
 */
export const ANCHOR_WINDOW_MS = 300000

/**
 * 窗口序号：把时刻切成一个个窗口，同一个窗口里的所有时刻得到同一个序号。
 * 锚用的是窗口序号而不是精确时刻 —— 这样「9:00:01 发起、9:00:03 重试」落在同一个锚上。
 */
export function anchorBucket(now: Timestamp, windowMs: number = ANCHOR_WINDOW_MS): number {
  return Math.floor(now / windowMs)
}

/** 拿不准是不是字符串时统一收口成字符串：不是字符串就当空串（调用方各自判空）。 */
function str(v: unknown): string {
  return (typeof v === 'string') ? v : ''
}

/** 把各种形态的标签清单（字符串、`{name}` 对象、两种混着来）归一成去空后的名字数组。 */
export function labelNames(list: unknown): string[] {
  const arr = Array.isArray(list) ? list : []
  return arr
    .map((one) => (typeof one === 'string' ? one : (one && (one as { name?: unknown }).name) || ''))
    .map((name) => String(name).trim())
    .filter(Boolean)
}

/**
 * 幂等锚的入参（具名对象）。
 * 单独写成类型而不是写在函数签名里，是为了让宿主侧的门面能原样转发这个形状 ——
 * 转发处不必再抄一遍字段，纯侧加一个字段时门面自动跟上。
 */
export interface AnchorParts {
  /** 工具名（锚只在同一个工具内部去重）。 */
  tool: unknown
  /** 会话标识；缺席时退到工作区标识。 */
  sessionId?: unknown
  /** 工作区标识：会话标识缺席时的退路（同一个工作区里同名同标签的写操作照样去重）。 */
  workspaceKey?: unknown
  /** 票的标题。 */
  title: unknown
  /** 这次要带的标签（各种形态都认）。 */
  labels?: unknown
  /** 这次调用的时刻，Unix 毫秒。必须由宿主侧读出来传进来。 */
  now: Timestamp
  /** 窗口长度，单位毫秒；只有测试会传，生产用默认的 5 分钟。 */
  windowMs?: number
}

/**
 * 幂等锚：同一个会话 + 同一个标题 + 同一批标签，在同一个窗口里得到同一个锚。
 *
 * 锚的构成是 `工具名|会话（没有就说工作区）|标题|标签（逗号相连）|窗口序号` 的 djb2 哈希，
 * 前缀 `deck-`，末尾再缀上窗口序号本身（便于人一眼看出这是哪个窗口的锚）。
 * 标签按调用方给的先后顺序拼，**不重排**：同一个调用点每次传的标签顺序是稳定的，重试自然落在同一个锚上；
 * 反过来，重排会让「本来同一个锚」变成两个锚、去重失效 —— 排序看着更「整齐」，代价是多建一张票。
 * 「同一批标签换个顺序要不要算同一个锚」属于去重语义，要改得先改契约层（#711）的口径，不在搬家范围内。
 *
 * 形参是具名对象。拆分前它也是具名对象，但类型是 `unknown`、字段全靠运行时自己收口、`now` 可选
 * 且缺席时内部读一次钟；这次收成有名字的类型（`AnchorParts`），少一个字段、字段类型写错都当场编译不过，
 * `now` 也改成必填 —— 这就是「纯侧不读钟」这条线在类型上的落点（读钟的兜底搬去了宿主侧门面）。
 */
export function anchorKeyFor(parts: AnchorParts): string {
  const windowMs = (typeof parts.windowMs === 'number' && parts.windowMs > 0) ? parts.windowMs : ANCHOR_WINDOW_MS
  const bucket = anchorBucket(parts.now, windowMs)
  const labels = labelNames(parts.labels)
  const raw = [
    str(parts.tool),
    str(parts.sessionId) || str(parts.workspaceKey),
    str(parts.title),
    labels.join(','),
    String(bucket),
  ].join('|')
  // djb2：够短、够散，而且完全确定 —— 同一份输入在哪台机器上都得到同一个锚。
  let h = 5381
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h + raw.charCodeAt(i)) >>> 0)
  return 'deck-' + ('0000000' + h.toString(16)).slice(-8) + '-' + bucket
}
