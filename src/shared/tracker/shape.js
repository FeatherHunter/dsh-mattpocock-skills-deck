/**
 * tracker/shape.js — 契约层「完整数据形状」类型定义（host + client 共用，纯类型，无 IO）。
 *
 * 这是 UI 与后端之间的共同语言。所有后端必须把来源数据**归一化**成本文件的形状：
 *  - 字段齐（interface 声明全部字段；UI 假设字段必填）。
 *  - 能实现的填值；能实现但来源为空 → EMPTY（`[]` / `''` / `null`）；
 *    不能实现的 → 从归一化对象**省略该字段**（MISSING，能力缺失）。
 *  - 空值由 UI 按「现有渲染逻辑」处理（如 labels 空则不渲染标签胶囊），不新增隐藏逻辑。
 *
 * 由 `docs/architecture/tracker-layer-directory-architecture.md` + `tracker-backend-normalized-model.md` 派生。
 */

import { STATE, ISSUE_TYPE, BACKEND_KIND, SNAP_MODE } from './constants.js'

/**
 * 标签。
 * @typedef {Object} Label
 * @property {string} name 标签名
 * @property {string} color 颜色（后端无则 ''）
 */

/**
 * 票/图的轻量引用（不递归展开，用于 subIssues / blockedBy / blocking）。
 * @typedef {Object} IssueRef
 * @property {string} key 规范 id（github='<n>'；markdown='<NN>' 两位零填充）
 * @property {number|null} number 数值 id（github 有；markdown=null，用 key）
 * @property {string} title
 * @property {import('./constants.js').STATE} state 归一化两态（open/closed）
 */

/**
 * 评论。
 * @typedef {Object} Comment
 * @property {{login: string}} author
 * @property {string} authorAssociation OWNER|MEMBER|CONTRIBUTOR|NONE|''（本地 ''）
 * @property {string} body
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * 指派者。
 * @typedef {Object} Assignee
 * @property {string} login
 * @property {string} [name]
 * @property {string} [avatarUrl] 可选：兼容 GitLab/本地渲染头图
 */

/**
 * 票 / 图统一实体（完整形状）。
 * @typedef {Object} Issue
 * @property {string} key 规范 id
 * @property {number|null} number 数值 id
 * @property {import('./constants.js').ISSUE_TYPE} type issue | map
 * @property {string} title
 * @property {import('./constants.js').STATE} state open | closed
 * @property {string} body
 * @property {string} url 链接；本地 '' 或 file://
 * @property {Label[]} labels EMPTY if none；MISSING if unsupported
 * @property {Assignee[]} assignees
 * @property {Comment[]} comments
 * @property {IssueRef[]} subIssues
 * @property {IssueRef[]} blockedBy
 * @property {IssueRef[]} blocking
 * @property {string} createdAt '' if none
 * @property {string} updatedAt '' if none
 * @property {string|null} closedAt
 * @property {string|null} parentKey 所属 map 的 key
 */

/**
 * 后端面对的工作区仓库。
 * @typedef {Object} RepositoryRef
 * @property {import('./constants.js').BACKEND_KIND} backend
 * @property {string} id 稳定标识（github/gitlab='owner/name'；markdown='<path>'）
 * @property {string} name 显示名
 * @property {string} owner owner；markdown=''
 * @property {string} remote 远端 URL；本地=''
 * @property {string} path 本地路径（markdown）；远端=''
 * @property {import('./constants.js').SNAP_MODE} snapMode
 */

/**
 * 地图的 KPI 统计（沿用现有面板口径）。
 * @typedef {Object} MapStats
 * @property {number} total
 * @property {number} open
 * @property {number} closed
 * @property {number} frontier
 * @property {number} claimed
 * @property {number} blocked
 */

/**
 * 地图（type='map' 的 Issue 追加字段）。
 * @typedef {Object} MapNode
 * @property {Issue[]} tickets 子票（一层；递归由 syncSnapshot 各 map 各自拉取）
 * @property {MapStats} stats
 */

/**
 * 能力视图（host 计算，**只作诊断/信息，不驱动 UI 隐藏**，见 G5）。
 * 每个布尔值 = 对应字段/操作在归一化对象里「存在」（EMPTY 也算存在）。
 * @typedef {Object} BackendCapabilities
 * @property {boolean} labels
 * @property {boolean} subIssue
 * @property {boolean} depGraph
 * @property {boolean} comments
 * @property {boolean} closedState
 * @property {boolean} liveUpdates
 * @property {boolean} remoteSharing
 */

/**
 * 后端状态（探测结果，随 wf.status/wf.snapshot 下发）。
 * @typedef {Object} BackendStatus
 * @property {import('./constants.js').BACKEND_KIND} backend
 * @property {boolean} ok
 * @property {BackendCapabilities} capabilities
 * @property {string} detail 探测错误/提示（诊断用）
 */

/** 契约形状版本（供日志/审计）。 */
export const SHAPE_VERSION = 1

/** 让本文件成为真实模块（类型定义是 JSDoc，此处仅作模块存在标识）。 */
export const TRACKER_SHAPE = Object.freeze({ version: SHAPE_VERSION, STATE, ISSUE_TYPE, BACKEND_KIND, SNAP_MODE })
