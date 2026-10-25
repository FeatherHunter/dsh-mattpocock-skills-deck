/**
 * src/tracker/contract/budget-model.ts —— 预算口径、预算读数与管线拦截口的类型真源。
 *
 * 为什么这些类型住在契约层：预算口径是会话管线、房间声明、注册表校验三处共用的同一份形状，
 * 散在三处各写一份，改一处漏两处就是「同一件事三种说法」。契约层是房间与宿主唯一可以引用的
 * 公共面（依赖规则把契约层排除在同层互引判域之外），所以口径类型住在这里，会话与注册表只从
 * 这里引用类型，不再互相引用。数值（还剩多少）不住这里，住在读数类型里；读数只是形状，
 * 真正的数字由缓存与后端在运行时给出。
 *
 * 这一份里只有类型与数据，没有运行时实现：校验函数住在注册表那一份
 * （src/tracker/registry/shape.ts），那是它唯一的使用者；契约门禁要求契约目录下只有类型与
 * 数据，所以实现不许搬进来。会话目录下原来的三份（budget.ts、budget-reading.ts、
 * interceptors.ts）现在只是转手 reship 的薄垫片，形状真源在这里。
 */

import type { ErrorKind } from './identity.js'

/**
 * 预算口径的名字：双桶（两种限额各自独立）/ 只计请求 / 离网（本来就不花额度）/ 未知（还没量出来）。
 */
export type BudgetKind = 'two-buckets' | 'requests-only' | 'off-network' | 'unknown'

/**
 * 四种口径的名字（值与上面的联合是同一件事，数组只给运行时校验用，不另起名字）。
 * 这一份是数据（字面量数组），不是实现，所以可以住在契约层。
 */
export const BUDGET_KINDS: readonly BudgetKind[] = ['two-buckets', 'requests-only', 'off-network', 'unknown']

/**
 * 一个后端花额度的口径声明。
 * 房间在模块对象上交这一份（必填，缺了注册表当场拒绝）；会话照它解释读数，管线照它记账。
 */
export interface BackendBudgetModel {
  /** 口径：双桶（两种限额各自独立）/ 只计请求 / 离网（本来就不花额度）/ 未知（还没量出来）。 */
  kind: BudgetKind
  /** 请求数进不进账（双桶的休息桶与只计请求的那一桶都认这一格）。 */
  countsRequests: boolean
  /** 点数进不进账（只有双桶的查询桶认这一格，其余口径恒为否）。 */
  countsPoints: boolean
  /** 两种限额互不相通（双桶恒为是，其余口径没有第二桶可言，恒为否）。 */
  independentBuckets: boolean
}

/**
 * 一个桶的水位：还剩多少（与限额同单位：请求数或点数），以及限额是多少（读数的分母）。
 */
export interface BucketLevel {
  /** 还剩多少（与限额同单位：请求数或点数）。 */
  remaining: number
  /** 限额是多少（读数的分母，调用方据此算剩百分之几）。 */
  limit: number
  /**
   * 服务端说这一桶什么时候恢复（毫秒 epoch；#1418 加的）。
   *
   * 为什么要这一格：额度见底时给人看的文案要写清「大概什么时候恢复」，否则人只知道现在不能做，
   * 不知道等多久。读数没带恢复时刻时这一格缺席或为 0；裁决那边会把缺格补成 0（budget-admission.ts
   * 的 levelOf），调用方按「大于 0」才写时刻，绝不编一个。
   */
  resetAt?: number
}

/**
 * 一次预算读数。
 * 前两种是「量出来了」，第三种是「离网本来就没有额度这回事」，第四种是「没量出来」——
 * 四种各有各的名字，管线按名字分流，不许按「剩的数大不大」猜。
 */
export type BudgetReading =
  | { known: true; kind: 'two-buckets'; buckets: { rest: BucketLevel; graphql: BucketLevel } }
  | { known: true; kind: 'requests-only'; requests: BucketLevel }
  | { known: true; kind: 'off-network' }
  | { known: false; reason: 'not-measured' | 'unavailable' | 'unsupported' }

/**
 * 裁决的输入：调哪一条、口径是什么、缓存里那份读数、写权限就绪没有。
 */
export interface AdmitInput {
  /** 本次要调的能力名（裁决要点名 Protections 时就靠这一格认出写操作）。 */
  op: string
  /** 后端的花钱口径（读数按它解释：离网没有额度可言，双桶看两桶）。 */
  budget: BackendBudgetModel
  /** 缓存里那份读数（管线读好递进来，裁决自己不再读缓存，免得两次读到两份）。 */
  reading: BudgetReading
  /** 写权限就绪没有（硬顶看这一格：没就绪时写操作推迟，不看读数）。 */
  canWrite: boolean
}

/**
 * 裁决的输出：放行，或推迟并说清档位与理由。
 * 推迟的档位沿用契约的错误档位（已知耗尽走限流那一档），调用方按档位说话，不另起名字。
 */
export type AdmitDecision =
  | { allowed: true; reason: string }
  | { allowed: false; kind: ErrorKind; reason: string; message: string }

/**
 * 裁决口：同步异步都认（今天的实现是纯算，直接给值；以后要读盘就给承诺）。
 */
export type AdmitPort = (input: AdmitInput) => AdmitDecision | Promise<AdmitDecision>

/**
 * 记账的输入：调了哪一条、口径是什么、房间原样回了什么（用量由记账实现自己从结果里认）。
 */
export interface AccountInput {
  /** 本次调的能力名（记账按它分桶：读预算这一条根本到不了记账，见管线）。 */
  op: string
  /** 后端的花钱口径（离网那一家的账恒记零花，口径说了算）。 */
  budget: BackendBudgetModel
  /** 房间原样回的结果（成功失败都递：失败那次花没花，由记账实现按口径定）。 */
  result: unknown
  /**
   * 这次调用落在哪个后端上（账本的键的一半，见规格 1439 第 8 节「账本以『后端 id 加桶名』为键」）。
   * 可选：老调用方不开会话就没有后端可言，记账实现读到缺席时按「未知后端」只记请求数，
   * 不许编一个后端编号出来（#1446 加）。
   */
  backendId?: string
}

/**
 * 记账口：只记账，不改变结果（记账炸了管线只记一行诊断，结果照旧）。
 */
export type AccountPort = (input: AccountInput) => void | Promise<void>
