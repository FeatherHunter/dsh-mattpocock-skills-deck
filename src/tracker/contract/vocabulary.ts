/**
 * tracker/constants.js — 契约层枚举常量（host 与 client 共用）。
 *
 * 这里只放「跨端稳定」的枚举。取值一律小写短横线/snake，避免与后端原始值混淆。
 * 后端在 normalize 阶段必须把这些值归一化成下面的形态（capability-by-fill，
 * 见 contract.js + capability.js）。GitHub 原值大写（OPEN/CLOSED）→ normalize 归一小写。
 *
 * ⚠️ 定版注意：`RepositoryRef.backend` 是开放 string（`BackendId`），**不再是枚举**。
 * 本文件的 `BACKEND_KIND` 因此只作「registry 内置 id 常量」与文档化的保留值，
 * 不充当字段类型（禁止再用它标注 `RepositoryRef.backend` / `BackendStatus.backend`）。
 */

/** 后端内置 id（registry 注册的一等后端；非字段类型）。 */
/**
 * @typedef {string} BackendId 后端 id（开放 string；仓库内唯一）。
 * 一等内置 `'github' | 'markdown' | 'gitlab'`（由 registry 注册）；
 * `'other'` 保留串**已弃用**——不再作为一等后端 id，也不在 registry 注册；
 * 表达「无后端」只走 `Selection.backendId: null`（此时不产出 RepositoryRef）。
 */
export const BACKEND_KIND = Object.freeze({
  GITHUB: 'github',
  MARKDOWN: 'markdown',
  GITLAB: 'gitlab',
})

/** 归一化后的票状态（只两态：open / closed）。本地 markdown 的 Status 在此映射（归 #115）。 */
export const STATE = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
})

/**
 * 票的类型（wayfinder 语义）：普通票、探索地图 或 规格（实施地图）。
 * 注意：与本地 markdown 的 `Type:`（research/…）正交。
 * 与 `identity.ts` 的 `IssueType` 是同一份取值的两种写法，改一处必须改另一处。
 */
export const ISSUE_TYPE = Object.freeze({
  ISSUE: 'issue',
  MAP: 'map',
  SPEC: 'spec',
})

/**
 * 规格（实施地图）容器在正文首行的隐藏标记。
 *
 * 为什么用正文标记而不是标签：探索地图有 `wayfinder:map` 标签可认，规格没有自己的标签
 * （也不许带 `wayfinder:map` —— 带了就会被认成探索地图），所以靠正文第一行独占一行的
 * 这段隐藏标记来认。写法：`<!-- DSH-ISSUE-KIND: spec -->`，前后各留空行更好。
 *
 * 认法（各房归一层的 `deriveType` 照这条做）：正文首行去掉首尾空白后整行精确等于这一串
 * 才算规格；正文别处提到这一串不算数；首行不是它就按普通票处理。判定顺序上标记排在标签
 * 前面（GLOSSARY.md「对象类型（objectKind）」词条：标记 → 标签 → 形状，标记是唯一真源）。
 *
 * 这一版只有 GitHub 房实现（`src/tracker/rooms/github/normalize.ts` 的 `isSpecBody`）；
 * GitLab 房没做，归另一张票（#326 一次会话只动一个房间）——别以为那边已经同步。这里只放
 * 这一串常量（契约目录只放类型与常量、不放行为；两个房间本来就不许互引）。
 *
 * #1277 现状与缺口：本地房与宿主快照的判据已经搬到 `src/shared/issue-file/src/marker.ts`（唯一真源）；
 * 这一串常量还不能并过去 —— 契约目录的门禁只许它自引，不许引共享包，而 GitHub 房只读契约层。等 GitHub
 * 房改为认文件头标记时一起并（见 `docs/design/1277-md-spec-container.md` §7 第 7 条）。
 */
export const SPEC_BODY_MARKER = '<!-- DSH-ISSUE-KIND: spec -->'

/** 面板快照模式（沿用现有面板 snapMode 口径；与 tracker 数据形状解耦，仅客户端面板用）。 */
export const SNAP_MODE = Object.freeze({
  OK: 'ok',
  LOADING: 'loading',
  ERR: 'err',
})

/**
 * 关闭原因保留值（开放 string；未知→原样展示，不分支）。
 * 表里只收插件自己**认得**的那两个值（#719 收口时按此清过一遍）。
 * GitHub 那一侧的同一个字段上还见过 `not_planned`（未计划）与 `reopened`（重新打开）两个取值，
 * 插件今天既不产出它们、也不读它们，所以不再收进这张表——留着就是没人碰的死词汇。
 * 将来真要用到，**连调用点一起加回来**：那时这个值自然就有了产出与读者（#719 统筹者的裁决）。
 * ⚠️ `reason` 是能力字段：closed 时给原因；open 依后端支持情况给 `''`(EMPTY) 或省略(MISSING)。
 */
export const CLOSED_REASON = Object.freeze({
  COMPLETED: 'completed',
  DUPLICATE: 'duplicate',
})

/** 参与人种类保留值（开放 string；识别机器人代理/组织）。 */
export const ACTOR_KIND = Object.freeze({
  USER: 'user',
  BOT: 'bot',
  ORGANIZATION: 'organization',
})

/** 自定义字段类型保留值（开放 string；说明性元数据，绝不驱动 deck 逻辑）。 */
export const FIELD_TYPE = Object.freeze({
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  SINGLE: 'single',
  MULTI: 'multi',
})

/** 操作错误 kind（后端/契约层统一分类；登录引导、限流、权限等据此分流）。 */
export const ERROR_KIND = Object.freeze({
  ENV: 'env', // 环境缺工具/缺变量（category: 工具不可用、路径不存在）
  AUTH: 'auth', // 未登录 / 凭据失效 / 权限不足
  RATELIMIT: 'rate-limit', // 限流（对齐库内「小写短横线」规范；旧值 'rateLimit' 已弃）
  CONFLICT: 'conflict', // 写前置失败 / 图不变量违反（如 If-Match 不匹配、setBlockedBy 自环/成环）
  UNSUPPORTED: 'unsupported', // 该后端不实现某操作/字段（= 能力缺失）
  NOTFOUND: 'not-found', // 资源不存在（对应 GitHub 404；不区分具体 HTTP 码；旧值 'notfound' 已弃）
  NETWORK: 'network',
  PARSE: 'parse',
})

/** 契约层归一化规则版本（供 logging/审计引用）。 */
export const CONTRACT_VERSION = 1

// ─────────────────────────────────────────────────────────────────────────────
// 票的身份算法不住在这里：`effortOf` / `idOfParts` / `idOf` / `refKeyOf` 四个函数是行为，
// 按地图02开发票（#1026）的裁决已搬到 `src/tracker/kernel/identity-keys.ts`（不在契约目录、
// 两个后端都能引用）。本文件只留上面的常量（契约自己的数据）；取身份请引用那份文件。
// ─────────────────────────────────────────────────────────────────────────────
