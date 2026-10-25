// src/refresh/kernel/budget-admission.ts —— 按后端口径分支的额度裁决（#1446 A3 的 G2 组）
//
// 为什么单独一份纯函数：桥里的裁决闭包原来把「有没有写权限、读数知不知道、这个后端是两桶
// 还是只计请求」混在同一段 if 里，两桶的写保底又被套到了每一种读数上。口径已经由后端自己的
// BackendBudgetModel 声明（#1446 起注册表必填），裁决就只该看声明与读数，不再认后端名字，
// 也不能因为「读数未知」就当成「剩余为 0」。
//
// 本文件不读盘、不联网、不看时钟；额度数字一个都不写在这里 —— 35% 份额、每小时额度、
// 写保底与档位换算全部由调用方注入。这样同一个算式在刷新闸、宿主账本与门禁里是同一份逻辑，
// 而数字只有 host-budget.ts 一处真源（同一件事不写两遍）。

import type { BackendBudgetModel, BudgetReading, BucketLevel } from '../../tracker/contract/budget-model.js'

/**
 * 调用方注入的额度算式与常量。
 *
 * 为什么要注入而不是在本文件 import：一旦 import 进来，裁决文件里就出现了具体数字，
 * 门禁再也分不清「裁决逻辑」与「额度政策」。本文件的保底判据用 aiToolFloor（服务端上限的 5%）；
 * writeReserve 仍由账本与后台刷新那一侧用，接口留在这里是为了让换轨之后的调用方只有一处接线。
 */
export interface BudgetLimits {
  /** 插件只拿服务端剩余额度的这一份，其余留给同一个账号下的其它工具。 */
  pluginShareOfRemaining: number
  /** 把服务端剩余换算成插件这一小时能花的额度（两桶读数用）。 */
  hourlyAllowance: (remaining: number) => number
  /** 一个桶的额度里留给写操作的那一份；后台刷新的读让路看它。 */
  writeReserve: (allowance: number) => number
  /** AI 工具的保底线（host-budget.ts 的 aiToolFloor）：服务端上限的 5%，花到它上面就拒。 */
  aiToolFloor: (limit: number) => number
  /** 按已用比例算档位（绿 / 黄 / 红），只在两桶口径下有实际意义。 */
  tierFor: (usedRatio: number) => string
}

/** 一次裁决的输入：调哪一条、后端口径、缓存里的读数、写权限就绪没有。 */
export interface BudgetAdmitInput {
  /** 本次要调的能力名；写操作名单住在本文件里，别处不再各写一份。 */
  op: string
  /** 后端自己的花钱口径（注册表里声明的那一格，不按后端名字猜）。 */
  budget: BackendBudgetModel
  /** 缓存里的那一份读数（管线读好递进来，裁决不再自己读缓存）。 */
  reading: BudgetReading
  /** 写权限就绪没有；没就绪时写操作直接拒绝，不看读数。 */
  canWrite: boolean
  /**
   * 这一笔预计花多少点、多少条出站请求（可选）。
   * 给了就按「花完这一笔之后还剩多少」判保底，没给按 0 算（只判「现在就低于保底」）——
   * 逐操作的管线裁决拿不到成本，开会话前的预检有成本，两处共用这一个纯函数（#1527）。
   */
  points?: number
  requests?: number
}

/**
 * 裁决理由的代号。
 * 这些代号会进日志与门禁，改名等同换事件含义，只能加不能改。
 */
export type BudgetReason =
  | 'hard-cap'
  | 'off-network-free'
  | 'reading-unknown'
  | 'requests-available'
  | 'requests-exhausted'
  | 'exhausted'
  | 'sufficient'

/** 理由代号的中文短名：日志与界面直接用人话，不在各处再翻一遍。 */
export const BUDGET_REASON_LABEL: Record<BudgetReason, string> = {
  'hard-cap': '硬顶拒绝',
  'off-network-free': '离网免额度',
  'reading-unknown': '读数未知',
  'requests-available': '请求额度可用',
  'requests-exhausted': '请求额度用尽',
  exhausted: '额度见底',
  sufficient: '额度充足',
}

/** 一次裁决的结论：放行，或者拒绝 / 推迟并说清理由。 */
export interface BudgetDecision {
  /** 放行了吗。false 时调用方必须当场拦下这一次调用。 */
  allowed: boolean
  /** 判定理由的代号（中文短名见 BUDGET_REASON_LABEL）。 */
  reason: BudgetReason
  /** 拒绝或推迟的档位；沿用契约里已有的错误档位，不另起名字。 */
  kind?: 'hard-cap' | 'rate-limit'
  /** 给人看的一句话；拒绝与推迟都要有，调用方可以原样转给 AI。 */
  message?: string
}

/**
 * 写操作名单。
 *
 * 名单留在本文件里而不是从契约导入：契约的能力名录还包含读操作，裁决只关心「这一次会不会
 * 改远端状态」。名单与桥原来的那一份逐字相同，改名单时以契约的写能力为准。
 */
const WRITE_OPS: readonly string[] = ['create', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy']

/** 一条请求是不是写操作。 */
export function isWriteOp(op: string): boolean {
  return WRITE_OPS.indexOf(op) >= 0
}

/**
 * 两桶后端里「读」那几条（GitHub：读全走 GraphQL 点数：探测、列表、单票、翻页、子票、标签清单、计数）。
 *
 * 名单留在本文件与三份写名单作伴：漏一条就会把这一条当「族不明」，退化成两族都看（旧行为），
 * 只是保守一点，不会放行不该放行的调用。
 */
const GRAPHQL_READ_OPS: readonly string[] = ['list', 'get', 'listPage', 'getDependencies', 'listSubIssues', 'listLabels', 'counts']

/**
 * 写操作按真实出站通道分四份名单（#1418 P1 复核；2026-10-25 用 GH_DEBUG=api 实测 gh CLI 的请求落点，
 * 复核第二轮又核对了「一次操作里的前置读」）。
 *
 * 为什么不能只看「最后那条写命令」：一次操作里除了写还要先读。建票就是典型 —— 写那一步是
 * REST（房间直接发 gh api repos/.../issues，gh issue create 不认 --json），但建之前必跑幂等锚回查：
 * gh search issues 与 gh issue list 都是 GraphQL（见 idempotency.ts 的快路 / 慢路）。
 * 所以建票同时依赖两族额度；只按 REST 判会让「GraphQL 已见底」时放行、随后建票必然失败。
 * 反过来，改票 / 关票 / 父子边的前置读与写都在 GraphQL 上，REST 见底时它们照做 —— 这正是
 * 票面要求的「只停真正依赖已见底那一族的操作」。
 */
const BOTH_WRITE_OPS: readonly string[] = ['create']

/**
 * 只有 GraphQL 一条路的写操作（含前置读）：gh issue edit / close / reopen 这几条子命令内部发
 * POST /graphql；setParent 的 REST 退路只在「老版本 gh 不认 --parent」时才走（graph.ts 的
 * isUnknownFlag 分支），额度耗尽不会换路，所以它也只看 GraphQL。
 */
const GRAPHQL_WRITE_OPS: readonly string[] = ['update', 'setLabels', 'setAssignees', 'setParent', 'close', 'reopen']

/**
 * 有退路的写操作：第一条通道失败会真的换另一条重发，只要还剩一条路就能做，两族都见底才拦。
 *   - 评论先发 REST POST，失败无条件回落 gh issue comment（GraphQL，见 comments.ts）；
 *   - 阻塞边先走 GraphQL mutation，id 查询或写失败会回落 REST（见 blocked-by-write.ts）。
 */
const DUAL_WRITE_OPS: readonly string[] = ['comment', 'setBlockedBy']

/** 这次调用依赖哪几族额度：all 是缺一不可的，anyOf 是两条通道任走一条即可（见 DUAL_WRITE_OPS）。 */
export interface OpFamilyChoice {
  /** 少了任何一族就做不成的额度。名单外的操作（切换后端、探测这一类）按两族都看，与改动前一样保守。 */
  all: string[]
  /** 有退路的那几族：只有全部见底才拦。 */
  anyOf: string[]
}

/**
 * 这次调用会花哪几族额度（#1418）。
 *
 * 判定只认「这一次真正会出站的通道」，不认「写/读」这个大方向：读操作全走 GraphQL 点数；
 * 写操作里建票两族都要（写 REST、建前回查 GraphQL），改票 / 标签 / 认领 / 关票 / 重开 / 父子边
 * 只有 GraphQL 一条路，评论与阻塞边两条路都走。
 */
export function familiesOfOp(op: string): OpFamilyChoice {
  if (BOTH_WRITE_OPS.indexOf(op) >= 0) return { all: ['rest', 'graphql'], anyOf: [] }
  if (GRAPHQL_WRITE_OPS.indexOf(op) >= 0) return { all: ['graphql'], anyOf: [] }
  if (DUAL_WRITE_OPS.indexOf(op) >= 0) return { all: [], anyOf: ['rest', 'graphql'] }
  if (GRAPHQL_READ_OPS.indexOf(op) >= 0) return { all: ['graphql'], anyOf: [] }
  return { all: ['rest', 'graphql'], anyOf: [] }
}

/** 额度的中文短名：给人看的文案里用它，日志与门禁代号仍是 rest / graphql / requests。 */
const FAMILY_LABEL: Record<string, string> = { rest: 'REST 请求', graphql: 'GraphQL 点数', requests: '请求次数' }

/** 把额度短名交出去（闸的拒绝文案要按桶点名，不能只写「一个桶」）。 */
export function familyLabelOf(family: string): string {
  return FAMILY_LABEL[family] || family
}

/**
 * 把服务端给的恢复时刻写成「约 HH:MM 恢复」；没给（或不是个数）就回空串，绝不编一个。
 * 导出给闸的拒绝文案（refusal-messages.ts）共用：同一句话只写一份，两处不各写一套格式。
 */
export function resetClockText(at: unknown): string {
  const ms = typeof at === 'number' && isFinite(at) ? at : 0
  if (!(ms > 0)) return ''
  const d = new Date(ms)
  return '约 ' + ('0' + String(d.getHours())).slice(-2) + ':' + ('0' + String(d.getMinutes())).slice(-2) + ' 恢复'
}

/** 一个桶现在还剩多少（单位按额度给：GraphQL 按点、请求按条）。 */
function remainingTextOf(family: string, level: BucketLevel): string {
  const left = level && typeof level.remaining === 'number' ? level.remaining : 0
  return '还剩 ' + left + (family === 'graphql' ? ' 点' : ' 条')
}

/**
 * 「服务端还剩多少、上限多少、保底多少」这一段公用说明（#1527 起拒绝文案要说清这四个数）。
 *
 * 给了这一笔的成本就再说「花完只剩多少」——这正是拒与不拒的判据本身，人一眼能核对。
 * 恢复时刻读不到就不写（resetClockText 回空串），绝不编一个时刻。
 */
function quotaDetailText(family: string, level: BucketLevel, cost: number, floor: number): string {
  const unit = family === 'graphql' ? '点' : '条'
  const left = level && typeof level.remaining === 'number' && isFinite(level.remaining) ? level.remaining : 0
  const limit = level && typeof level.limit === 'number' && isFinite(level.limit) ? level.limit : 0
  const parts = ['服务端还剩 ' + left + ' ' + unit + '（上限 ' + limit + '，保底 ' + floor + '）']
  if (cost > 0) parts.push('这一笔预计花 ' + cost + ' ' + unit + '，花完只剩 ' + Math.max(0, left - cost) + ' ' + unit)
  const clock = resetClockText(level && level.resetAt)
  if (clock) parts.push(clock)
  return parts.join('；')
}

/**
 * 额度见底时给人看的那一句话（#1418）：说清是哪种额度见底、还剩多少、大概什么时候恢复。
 *
 * 用「REST 请求额度」「GraphQL 点数额度」这样的完整说法，不用「族」「桶」这类账本内部叫法：
 * 第一次读这句话的人（用户与 AI）要能直接判断出「等多久、等的是哪一种额度」。
 */
export function exhaustedMessage(family: string, level: BucketLevel | null, cost?: number, floor?: number): string {
  const lv = level || { remaining: 0, limit: 0 }
  const c = typeof cost === 'number' && isFinite(cost) ? cost : 0
  const f = typeof floor === 'number' && isFinite(floor) ? floor : 0
  return '额度见底：' + familyLabelOf(family) + '额度不够了（' + quotaDetailText(family, lv, c, f) + '），这次先不执行。'
}

/**
 * 两条路都见底时的一句话（评论 / 阻塞边）：两种额度都点名，各自还剩多少。
 * 恢复时刻取两族里「先恢复的那一个」—— 只要有一族恢复就能重试，写最晚的那个会让人白等。
 */
function exhaustedAnyMessage(families: string[], levels: BucketLevel[], costs?: number[], floors?: number[]): string {
  const names = families.map(function (f: string): string { return familyLabelOf(f) }).join('与')
  const detail = families.map(function (f: string, i: number): string {
    const c = costs && typeof costs[i] === 'number' && isFinite(costs[i]) ? costs[i] : 0
    const fl = floors && typeof floors[i] === 'number' && isFinite(floors[i]) ? floors[i] : 0
    return quotaDetailText(f, levels[i], c, fl)
  }).join('；')
  return '额度见底：' + names + '两种额度都不够了（' + detail + '），这次先不执行。'
}

/** 硬顶的原话：桥、门禁与给人看的说明共用这一句，不各写各的。 */
export const HARD_CAP_MESSAGE = '硬顶：这次调用没有写权限，写操作直接拒绝。'

/**
 * 按预算模型裁决一笔调用。
 *
 * 判定顺序就是「谁最不该被额度拦住」的顺序，不能调换：
 *  a. 没有写权限时的写操作：直接拒绝（硬顶，和额度无关，先于一切读数判断）；
 *  b. 离网后端（口径或读数任一说离网）：本来就不花额度，直接放行；
 *  c. 读数未知：放行并如实标「读数未知」—— 未知不是 0，绝不套「剩余≤保底」；
 *  d. 只计请求的口径：只看请求桶还有没有剩余，不套 35% 保底、不看档位；
 *  e. 两桶独立口径：按这次真正会花的那几族判断（#1418）——缺一不可的清单逐族看，
 *     有退路的清单只在两族都见底时才拦。
 *
 * 为什么把 b 放在 c 前面：离网后端的读数本来就可能缺席，若先判未知就会把「离网免额度」
 * 说成「读数未知」，理由与事实不符。为什么把 c 放在 d/e 前面：读数未知时 remaining 没有值，
 * 拿 0 去比保底等于凭空判定额度见底。
 */
export function decideByBudget(input: BudgetAdmitInput, limits: BudgetLimits): BudgetDecision {
  const budget = (input && input.budget) || ({ kind: 'unknown', countsRequests: false, countsPoints: false, independentBuckets: false } as BackendBudgetModel)
  const reading = (input && input.reading) || ({ known: false, reason: 'not-measured' } as BudgetReading)
  const op = String((input && input.op) || '')
  // 这一笔的成本：逐操作的管线裁决拿不到（只按「现在还剩多少」判），开会话前的预检拿得到。
  const pointsCost = numOf(input && input.points)
  const requestsCost = numOf(input && input.requests)
  /** 这一族按点数还是条数计价：GraphQL 数点，REST 与请求桶数条。 */
  const costOfFamily = function (family: string): number { return family === 'graphql' ? pointsCost : requestsCost }

  // a. 写权限是硬顶：没就绪时不看读数，也不管这个后端还剩多少额度。
  if (input && input.canWrite === false && isWriteOp(op)) {
    return { allowed: false, kind: 'hard-cap', reason: 'hard-cap', message: HARD_CAP_MESSAGE }
  }

  // b. 离网后端没有额度这回事：口径或读数任一说离网就放行，理由写「离网免额度」。
  if (budget.kind === 'off-network' || (reading.known === true && reading.kind === 'off-network')) {
    return { allowed: true, reason: 'off-network-free' }
  }

  // c. 读数未知：不拦事，也不把未知当成 0。管线会在日志里记下这一条理由。
  if (reading.known === false) {
    return { allowed: true, reason: 'reading-unknown' }
  }

  // d. 只计请求的口径：请求额度是硬值，只看它还有没有剩余（>0 就放行），
  //    不套两桶的 35% 写保底，也不算档位 —— 请求桶根本没有「留给写操作」这一份。
  // #1527：保底判据换成「花完这一笔之后仍高于服务端上限的 5%」；以前是「剩余 > 0 就放行」。
  if (budget.independentBuckets !== true) {
    const requests = requestsLevelOf(reading)
    if (!requests) return { allowed: true, reason: 'reading-unknown' }
    const floor = limits.aiToolFloor(requests.limit)
    if (requests.remaining - requestsCost > floor) return { allowed: true, reason: 'requests-available' }
    return { allowed: false, kind: 'rate-limit', reason: 'requests-exhausted', message: exhaustedMessage('requests', requests, requestsCost, floor) }
  }

  // e. 两桶独立口径：只按这次调用真正会花的那几族判断（#1418）。
  //    缺一不可的清单（all）逐族看剩余；有退路的清单（anyOf）只在全部见底时才拦。
  //    这样 REST 见底时改票 / 关票照做、GraphQL 见底时读操作才停，另一族见底不再连累这一条。
  if (reading.kind === 'two-buckets') {
    const restLevel = levelOf(reading.buckets.rest)
    const graphqlLevel = levelOf(reading.buckets.graphql)
    const levelOfFamily = function (family: string): BucketLevel { return family === 'graphql' ? graphqlLevel : restLevel }
    const families = familiesOfOp(op)
    for (let i = 0; i < families.all.length; i++) {
      const level = levelOfFamily(families.all[i])
      const cost = costOfFamily(families.all[i])
      const floor = limits.aiToolFloor(level.limit)
      if (level.remaining - cost <= floor) {
        return { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: exhaustedMessage(families.all[i], level, cost, floor) }
      }
    }
    if (families.anyOf.length) {
      const levels = families.anyOf.map(levelOfFamily)
      const costs = families.anyOf.map(costOfFamily)
      const floors = levels.map(function (level: BucketLevel): number { return limits.aiToolFloor(level.limit) })
      const blocked = levels.every(function (level: BucketLevel, i: number): boolean { return level.remaining - costs[i] <= floors[i] })
      if (blocked) return { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: exhaustedAnyMessage(families.anyOf, levels, costs, floors) }
    }
    return { allowed: true, reason: 'sufficient' }
  }
  // 两桶口径却只拿到「只计请求」的读数（旧缓存）：只剩请求桶可看，按它判。
  for (const level of bucketLevelsOf(reading)) {
    const floor = limits.aiToolFloor(level.limit)
    if (level.remaining - requestsCost <= floor) {
      return { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: exhaustedMessage('rest', level, requestsCost, floor) }
    }
  }
  return { allowed: true, reason: 'sufficient' }
}

/** 从读数里取请求桶；两桶读数没有 requests 这一格时返回 null（交给调用方按读数未知处理）。 */
function requestsLevelOf(reading: BudgetReading): BucketLevel | null {
  if (reading.known === false) return null
  if (reading.kind === 'requests-only') return levelOf(reading.requests)
  if (reading.kind === 'two-buckets') {
    // 口径说「只计请求」却拿到两桶读数：请求额度与休息桶是同一份限制（GitHub 的 REST 桶），
    // 取 rest 而不是 graphql —— graphql 是点数桶，拿它比请求剩余会把两件不同单位的事混在一起。
    return levelOf(reading.buckets.rest)
  }
  return null
}

/** 从读数里取两桶；沿用的旧行为是两桶口径只认 rest 与 graphql 两格。 */
function bucketLevelsOf(reading: BudgetReading): BucketLevel[] {
  if (reading.known === false) return []
  if (reading.kind === 'two-buckets') return [levelOf(reading.buckets.rest), levelOf(reading.buckets.graphql)]
  if (reading.kind === 'requests-only') return [levelOf(reading.requests)]
  return []
}

/** 任意报数：不是有限数就当 0（这一笔成本缺省时用它，与闸的 num 同口径）。 */
function numOf(v: unknown): number {
  return (typeof v === 'number' && isFinite(v)) ? v : 0
}

/** 读数里的数字可能缺格（旧缓存或手写夹具）：缺格按 0 算，与桥原来的兜底口径一致；resetAt 原样带出（#1418）。 */
function levelOf(level: BucketLevel | undefined | null): BucketLevel {
  const remaining = level && typeof level.remaining === 'number' && isFinite(level.remaining) ? level.remaining : 0
  const limit = level && typeof level.limit === 'number' && isFinite(level.limit) ? level.limit : 0
  const resetAt = level && typeof level.resetAt === 'number' && isFinite(level.resetAt) ? level.resetAt : 0
  return { remaining: remaining, limit: limit, resetAt: resetAt }
}
