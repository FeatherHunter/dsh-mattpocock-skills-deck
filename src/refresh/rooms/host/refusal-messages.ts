// src/refresh/rooms/host/refusal-messages.ts —— AI 工具被拒时回给 AI 的那句话（#998 从宿主闸搬出）
//
// 为什么搬出来：src/refresh/rooms/host/refresh-gate.ts 贴着 350 行单文件上限（tests/verify-file-granularity.ts），
// #998 给「连续失败」留出口那件事要往闸里加十几行，就得先搬走同等量的东西。搬出来的只挑纯的：
// 给同样的输入永远同样的输出，不读时钟、不碰账本、不看工作区状态（时钟由调用方以 now 传进来）。
//
// 住共享层而不是宿主层：宿主层文件之间不许互相引用（tests/verify-dependency-rules.ts），
// 宿主引用共享层是允许的方向，所以只能放这里。本文件只 import 内核里两个纯函数：
// （resetClockText 把恢复时刻写成「约 HH:MM 恢复」，familyLabelOf 把桶名写成「REST 请求」「GraphQL 点数」），
// 这样这句话与裁决那一句是同一份格式、同一份短名表，不在两处各抄一份。
//
// 两种拒绝必须分得开（票面硬要求）：
//   ①「这一笔太大」——超过了插件给自己设的单次硬顶，是自限，不是别人抢了额度；
//   ②「额度被别人用掉了」——AI 工具这一笔花下去会低于保底线（服务端上限的 5%），
//     这时先拒 AI 工具写入，绝不挤掉插件刷新与人的动作；文案要说清服务端还剩多少、保底多少、
//     这一笔花完还剩多少、大概还有几分钟恢复（#1418 起的口径，#1527 补齐数字）。
// 每小时顶从 #1527 起只是提醒、不再是拒绝（提醒写在回执的 cost.warnings 与 cost.note 里，
// 由内核 admission-policy 拼），所以这里没有它的文案，也不要再加回来。

import { familyLabelOf, resetClockText } from '../../kernel/budget-admission.js'

/** 准入结论：哪一种拒、这次要花多少；见底时带上「缺的是哪一种额度、服务端还剩多少、什么时候恢复」。 */
type RefusalArgs = {
  reason: string; points: number; requests: number
  /** 这一桶的名字（rest / graphql / requests）：短名与单位都由它推，调用方不必自己拼。 */
  bucket?: string
  /** 服务端给的恢复时刻（毫秒 epoch）；读不到就是 0 或不传，文案里不出现恢复时间。 */
  resetAt?: number
  /** 调用方此刻的时钟（毫秒 epoch）：只用来算「还有约几分钟」；不给就只写钟点。 */
  now?: number
  /** 这一族的保底线（服务端上限的 5%）。 */
  floor?: number
  /** 这一族的服务端上限（5000 点 / 5000 条）。 */
  limit?: number
  /** 服务端读数扣掉本插件已花之后的剩余。 */
  serverRemaining?: number
  /** 内部推导出来的三格（由 bucket / resetAt / now 算，调用方不传）。 */
  familyLabel?: string; unit?: string; resetInMinutes?: number
}
/** 本小时 AI 工具已经花掉多少。 */
type RefusalHourSpend = { points: number; requests: number }
/** 建议分几片、每片最多几张票（只有建票类工具才有意义）。 */
type RefusalPlan = { shards: number; perShard: number }
/** 单次硬顶的两个数字（由调用方从 host-budget.js 取好传进来）。 */
type RefusalLimits = {
  aiToolMaxPointsPerCall: number
  aiToolMaxRequestsPerCall: number
}

/** 拼出那句拒绝文案：先分辨是哪一种拒，再按那一种该说的话说全。 */
export function refusalTextRef(a: RefusalArgs, hour: RefusalHourSpend, plan: RefusalPlan, limits: RefusalLimits): string {
  const resetAt = numOf(a.resetAt, 0)
  // 三格派生：缺的是哪一族、按什么单位计价、还有几分钟恢复。放在这里而不是闸里，闸才能少写几行。
  const named: RefusalArgs = Object.assign({}, a, {
    familyLabel: familyLabelOf(str(a.bucket)),
    unit: a.bucket === 'graphql' ? '点' : '条',
    resetAt: resetAt,
    resetInMinutes: resetAt > 0 ? Math.max(0, Math.floor((resetAt - numOf(a.now, 0)) / 60000)) : 0,
  })
  if (named.reason === 'ai-tool-over-call-cap') return callCapText(named, plan, limits)
  return floorText(named, hour)
}

/**
 * ① 单次硬顶：说清这一笔要花多少、上限在哪、超了多少，以及怎么把它拆开。
 *
 * 为什么超出的数要单独算：调用方看到「上限 600、这次 700」还得自己做减法，
 * 直接写「点数超了 100 点」更不容易看错（#1527 要求保留单次上限并返回拒绝原因）。
 */
function callCapText(a: RefusalArgs, plan: RefusalPlan, limits: RefusalLimits): string {
  const over: string[] = []
  if (a.points > limits.aiToolMaxPointsPerCall) over.push('点数超了 ' + (a.points - limits.aiToolMaxPointsPerCall) + ' 点')
  if (a.requests > limits.aiToolMaxRequestsPerCall) over.push('条数超了 ' + (a.requests - limits.aiToolMaxRequestsPerCall) + ' 条')
  const split = plan.shards > 1
    ? '这次要建 ' + plan.shards * plan.perShard + ' 张以内的票，建议分 ' + plan.shards + ' 次调用，每片不超过 ' + plan.perShard + ' 张票。'
    : '把这一笔拆小再试（例如分批建票、或改完一处再改下一处）。'
  return '这次调用超过了插件给自己设的单次硬顶：这一笔预计花 ' + a.points + ' 点、' + a.requests +
    ' 条出站请求，单次上限是 ' + limits.aiToolMaxPointsPerCall + ' 点 / ' + limits.aiToolMaxRequestsPerCall + ' 条' +
    (over.length ? '（' + over.join('、') + '）' : '') + '。额度没被别人用掉，是这一笔太大。' + split
}

/**
 * ② 额度不够：说清哪一族、服务端还剩多少、上限与保底各是多少、这一笔花完还剩多少、还有多久恢复。
 *
 * 这些数字一个都不能省：以前只说「剩余额度已到保底线」，人只能猜是哪儿没额度和为什么被拒，
 * 结果把「服务端还剩 3669 点」误当成「插件额度不够」（#1527 的原始现场）。
 */
function floorText(a: RefusalArgs, hour: RefusalHourSpend): string {
  const unit = a.unit === '条' ? '条' : '点'
  const remaining = numOf(a.serverRemaining, 0)
  const floor = numOf(a.floor, 0)
  const limit = numOf(a.limit, 0)
  const cost = unit === '点' ? a.points : a.requests
  const parts: string[] = []
  if (a.familyLabel) parts.push('这次要花的' + a.familyLabel + '额度不够用')
  parts.push('服务端还剩 ' + remaining + ' ' + unit + '（上限 ' + limit + '，保底 ' + floor + '）')
  if (cost > 0) parts.push('这一笔预计花 ' + cost + ' ' + unit + '，花完只剩 ' + Math.max(0, remaining - cost) + ' ' + unit)
  const wait = resetWaitText(a.resetAt, a.resetInMinutes)
  if (wait) parts.push(wait)
  return '剩余额度已经不够了，额度是被别人用掉的（会话里别的 GitHub 调用先花了）：' + parts.join('；') +
    '。本小时 AI 工具已用 ' + hour.points + ' 点、' + hour.requests + ' 条；先把这一笔拆小，或等额度恢复再试。'
}

/** 「还有约 N 分钟，约 HH:MM 恢复」；算不出分钟就只写钟点；两个都没有就回空串，绝不编。 */
function resetWaitText(at: unknown, minutes?: number): string {
  const clock = resetClockText(at)
  if (!clock) return ''
  const m = numOf(minutes, 0)
  return m > 0 ? '还有约 ' + m + ' 分钟，' + clock : clock
}

/** 报来的数不是有限数就用兜底值（与闸的 num 同口径）。 */
function numOf(v: unknown, fallback: number): number {
  return (typeof v === 'number' && isFinite(v)) ? v : fallback
}

/** 字符串兜底（与闸的 str 同口径）。 */
function str(v: unknown): string {
  return (typeof v === 'string') ? v : ''
}
