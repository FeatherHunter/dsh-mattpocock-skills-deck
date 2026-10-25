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
 * 调用方注入的四个额度算式与常量。
 *
 * 为什么要注入而不是在本文件 import：一旦 import 进来，裁决文件里就出现了具体数字，
 * 门禁再也分不清「裁决逻辑」与「额度政策」。四个字段今天只用到 writeReserve；
 * 另外三个是读数换算那一侧要用的（两桶读数按 remaining 换算每小时额度、按 used/allowance
 * 算档位），留着这一份接口是为了让换轨之后的调用方只有一处需要接线。
 */
export interface BudgetLimits {
  /** 插件只拿服务端剩余额度的这一份，其余留给同一个账号下的其它工具。 */
  pluginShareOfRemaining: number
  /** 把服务端剩余换算成插件这一小时能花的额度（两桶读数用）。 */
  hourlyAllowance: (remaining: number) => number
  /** 一个桶的额度里留给写操作的那一份；剩余不多于它时，自动刷新与 AI 工具让路。 */
  writeReserve: (allowance: number) => number
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
 * 写操作按真实出站通道分三份名单（#1418 P1 复核；2026-10-25 用 GH_DEBUG=api 实测 gh CLI 的请求落点）。
 *
 * 为什么不是「写都花 REST 请求」：GitHub 的 REST 与 GraphQL 是两套互不相通的额度。
 * gh issue edit / gh issue close / gh issue reopen / gh issue comment 这几条子命令内部发的都是
 * POST /graphql（只花 GraphQL 点数）；真正只走 REST 的写操作只有建票一条：房间直接发
 * gh api repos/.../issues（gh issue create 不认 --json，见 issues-write.ts 的主路注释）。
 * 按真实出站通道判，REST 见底时改票、关票这些仍然做得了 —— 这正是票面要求的
 * 「只停真正依赖已见底那一族的操作」。
 */
const REST_WRITE_OPS: readonly string[] = ['create']

/** 只有 GraphQL 一条路的写操作：这几条子命令没有 REST 退路，只能看 GraphQL 点数。 */
const GRAPHQL_WRITE_OPS: readonly string[] = ['update', 'setLabels', 'setAssignees', 'close', 'reopen']

/**
 * 两条路都走的写操作，只要还剩一条路就能做，两族都见底才拦：
 *   - 评论先发 REST POST，失败回落 gh issue comment（GraphQL，见 comments.ts）；
 *   - 父子边先走 gh issue edit --parent（GraphQL），老版本回落 api .../sub_issues（REST，见 graph.ts）；
 *   - 阻塞边先走 GraphQL mutation，失败回落 REST（见 blocked-by-write.ts 的 route 结论）。
 */
const DUAL_WRITE_OPS: readonly string[] = ['comment', 'setParent', 'setBlockedBy']

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
 * 写操作里建票只有 REST 一条路，改票 / 标签 / 认领 / 关票 / 重开只有 GraphQL 一条路，
 * 评论、父子边、阻塞边两条路都走。
 */
export function familiesOfOp(op: string): OpFamilyChoice {
  if (REST_WRITE_OPS.indexOf(op) >= 0) return { all: ['rest'], anyOf: [] }
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

/** 把服务端给的恢复时刻写成「约 HH:MM」；没给（或不是个数）就回空串，绝不编一个。 */
function resetHintAt(at: unknown): string {
  const ms = typeof at === 'number' && isFinite(at) ? at : 0
  if (!(ms > 0)) return ''
  const d = new Date(ms)
  return '（约 ' + ('0' + String(d.getHours())).slice(-2) + ':' + ('0' + String(d.getMinutes())).slice(-2) + ' 恢复）'
}

/** 从一个桶的水位里取恢复时刻那一句；读数没带这一格就不写。 */
function resetHintOf(level: BucketLevel | null): string {
  return resetHintAt(level && level.resetAt)
}

/**
 * 额度见底时给人看的那一句话（#1418）：说清是哪种额度见底、大概什么时候恢复。
 *
 * 用「REST 请求额度」「GraphQL 点数额度」这样的完整说法，不用「族」「桶」这类账本内部叫法：
 * 第一次读这句话的人（用户与 AI）要能直接判断出「等多久、等的是哪一种额度」。
 */
export function exhaustedMessage(family: string, level: BucketLevel | null): string {
  return '额度见底：' + familyLabelOf(family) + '额度不够了' + resetHintOf(level) + '，这次先不执行。'
}

/**
 * 两条路都见底时的一句话（评论 / 父子边 / 阻塞边）：两种额度都点名。
 * 恢复时刻取两族里「先恢复的那一个」—— 只要有一族恢复就能重试，写最晚的那个会让人白等。
 */
function exhaustedAnyMessage(families: string[], levels: BucketLevel[]): string {
  const names = families.map(function (f: string): string { return familyLabelOf(f) }).join('与')
  let earliest = 0
  for (let i = 0; i < levels.length; i++) {
    const at = Number(levels[i] && levels[i].resetAt) || 0
    if (at > 0 && (earliest === 0 || at < earliest)) earliest = at
  }
  return '额度见底：' + names + '两种额度都不够了' + resetHintAt(earliest) + '，这次先不执行。'
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
  if (budget.independentBuckets !== true) {
    const requests = requestsLevelOf(reading)
    if (!requests) return { allowed: true, reason: 'reading-unknown' }
    if (requests.remaining > 0) return { allowed: true, reason: 'requests-available' }
    return { allowed: false, kind: 'rate-limit', reason: 'requests-exhausted', message: '这次调用的请求额度已经用完，先不执行。' }
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
      if (level.remaining <= limits.writeReserve(level.limit)) {
        return { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: exhaustedMessage(families.all[i], level) }
      }
    }
    if (families.anyOf.length) {
      const levels = families.anyOf.map(levelOfFamily)
      const blocked = levels.every(function (level: BucketLevel): boolean { return level.remaining <= limits.writeReserve(level.limit) })
      if (blocked) return { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: exhaustedAnyMessage(families.anyOf, levels) }
    }
    return { allowed: true, reason: 'sufficient' }
  }
  // 两桶口径却只拿到「只计请求」的读数（旧缓存）：只剩请求桶可看，按它判（行为与改动前一致）。
  for (const level of bucketLevelsOf(reading)) {
    if (level.remaining <= limits.writeReserve(level.limit)) {
      return { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: exhaustedMessage('rest', level) }
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

/** 读数里的数字可能缺格（旧缓存或手写夹具）：缺格按 0 算，与桥原来的兜底口径一致；resetAt 原样带出（#1418）。 */
function levelOf(level: BucketLevel | undefined | null): BucketLevel {
  const remaining = level && typeof level.remaining === 'number' && isFinite(level.remaining) ? level.remaining : 0
  const limit = level && typeof level.limit === 'number' && isFinite(level.limit) ? level.limit : 0
  const resetAt = level && typeof level.resetAt === 'number' && isFinite(level.resetAt) ? level.resetAt : 0
  return { remaining: remaining, limit: limit, resetAt: resetAt }
}
