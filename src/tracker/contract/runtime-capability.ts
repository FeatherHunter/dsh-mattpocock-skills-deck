/**
 * src/tracker/contract/runtime-capability.ts —— 读操作在「企业版主机」上的运行时能力回答（只有类型与取值表）
 *
 * 这份文件回答的问题：「这一次读操作，在眼前这台服务端上，到底支持到什么程度？」
 * 答案是**运行时探测出来的**，不是查表查出来的：先问服务端版本（`gh api meta` 的 installed_version），
 * 再按版本与接口事实回答「支持 / 部分支持 / 不支持」，并带一句人话原因与承接它的能力票号。
 *
 * 为什么不能读构建期那张能力表（src/tracker/contract/capability-answer.ts 与各房 capability-register.ts）：
 * 那张表是给人看的账、由门禁比对文档，它说的是「这个后端形态上有没有这件事」，不是「这台服务端今天行不行」。
 * 企业版的版本差异（例：依赖边端点从 3.19 才有）只有探测才知道；拿静态表冒充运行时事实，
 * 会在老版本企业版上把「没有这个接口」说成「有」或者反过来。所以这张回答的 source 恒为 'runtime-probe'。
 *
 * 三档与错误档位不是一套词：这里的 supported / partial / unsupported 说的是「接口能力」，
 * 不是 TrackerError 的 kind。名字刻意与能力登记的四档分开（那四档是构建期账，见 capability-answer.ts）。
 */

/** 回答的三种程度：支持、部分支持（版本够但主路不一定）、不支持（这台服务端没有这个接口）。 */
export const RUNTIME_SUPPORT_LEVELS = Object.freeze(['supported', 'partial', 'unsupported'] as const)
/** 支持程度的取值类型；从 RUNTIME_SUPPORT_LEVELS 推出来，保证类型与常量不会写成两个值。 */
export type RuntimeSupportLevel = (typeof RUNTIME_SUPPORT_LEVELS)[number]

/** 探测认出的服务端种类：github.com、企业版（ghes）、认不出（unknown，探测失败时只给这一档）。 */
export const RUNTIME_HOST_KINDS = Object.freeze(['github.com', 'ghes', 'unknown'] as const)
/** 服务端种类的取值类型。 */
export type RuntimeHostKind = (typeof RUNTIME_HOST_KINDS)[number]

/** 需要运行时能力回答的读操作（今天只有这两条会撞上企业版版本差异）。 */
export const RUNTIME_CAPABILITY_OPERATIONS = Object.freeze(['listSubIssues', 'getDependencies'] as const)
/** 需要运行时能力回答的读操作名。 */
export type RuntimeCapabilityOperation = (typeof RUNTIME_CAPABILITY_OPERATIONS)[number]

/** 一次服务端探测的结果：认没认出来、认出什么、版本原文、时刻、以及失败时的原因。 */
export interface RuntimeServerProbe {
  /** 探测本身成没成（meta 请求成功且回包能读）。false 时不许拿它回答「支持」。 */
  ok: boolean
  /** 认出的服务端种类；探测失败时恒 'unknown'（不猜）。 */
  hostKind: RuntimeHostKind
  /** 服务端版本原文（如 '3.18.4'）；github.com 没有这一格，记 null。 */
  serverVersion: string | null
  /** 探测发生的时刻（毫秒时间戳；回答里原样带上，界面能说清「什么时候问的」）。 */
  probedAtMs: number
  /** 探测失败的原因（人话）；成功时是空串。 */
  reason: string
}

/** 一条读操作在眼前这台服务端上的能力回答（带原因与能力票号，不冒充、不省略）。 */
export interface RuntimeCapabilityAnswer {
  /** 这条回答是关于哪条读操作的。 */
  operation: RuntimeCapabilityOperation
  /** 支持程度：见 RUNTIME_SUPPORT_LEVELS。 */
  support: RuntimeSupportLevel
  /** 人话原因（说清是哪件事、哪个版本限制），不写只有内部才懂的缩写。 */
  reason: string
  /** 承接这件事的能力票号（规格 #1681 的已知缺口都记在这张票下）。 */
  ticket: string
  /** 回答所依据的服务端种类与版本原文。 */
  hostKind: RuntimeHostKind
  serverVersion: string | null
  /** 探测时刻，与 RuntimeServerProbe.probedAtMs 同一个值。 */
  probedAtMs: number
  /** 来源恒为运行时探测：不许是静态能力表。 */
  source: 'runtime-probe'
}
