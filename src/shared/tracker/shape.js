/**
 * tracker/shape.js — 契约层「完整数据形状」类型定义（host + client 共用，纯类型，无 IO）。
 *
 * 这是 UI 与后端之间的共同语言。所有后端必须把来源数据**归一化**成本文件的形状：
 *  - **核心字段**（key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey）**永远存在**，
 *    来源给不了的用确定空值（`''` / `null`）补齐。
 *  - **能力字段**（author/assignees/labels/milestone/customFields/reason/blockedBy/comments）
 *    可 MISSING：能实现 → 填值或 `EMPTY`（`[]` / `''` / `null`）；不能实现 → **省略该字段**（MISSING）。
 *  - 空值由 UI 按「现有渲染逻辑」处理（如 labels 空则不渲染标签胶囊），不新增隐藏逻辑。
 *
 * 定版依据：issue #127（完整数据形状 + capability-by-fill）+
 * `C:\Users\辰辰洋洋\AppData\Local\Temp\dsh-tracker-contract-issue-map-design.md`。
 * 由 `docs/architecture/tracker-layer-directory-architecture.md` + `tracker-backend-normalized-model.md` 派生。
 */

import { STATE, ISSUE_TYPE } from './constants.js'

/**
 * 后端 id（开放 string；仓库内唯一）。
 * 一等内置 'github' | 'markdown' | 'gitlab'；'other' 保留串已弃用。
 * 表达「无后端」只走 Selection.backendId: null（此时不产出 RepositoryRef）。
 * @typedef {string} BackendId
 */

/**
 * 归一化后的票状态（只两态）。
 * @typedef {'open'|'closed'} State
 */

/**
 * 票的类型（wayfinder 语义）。
 * @typedef {'issue'|'map'} IssueType
 */

/**
 * 关闭原因（开放 string；保留值 completed / not_planned / reopened / duplicate）。
 * 只在 state=closed 有意义；open 依后端支持情况给 ''(EMPTY) 或省略(MISSING)。
 * @typedef {string} ClosedReason
 */

/**
 * 参与人种类（开放 string；保留值 user / bot / organization）。
 * @typedef {string} ActorKind
 */

/**
 * 自定义字段类型（开放 string；保留值 text / number / date / single / multi）。
 * @typedef {string} FieldType
 */

/**
 * 参与人。
 * @typedef {Object} Actor
 * @property {string} login
 * @property {ActorKind} [kind] 识别机器人代理/组织（对 deck 认领有意义）
 * @property {string} [name] 显示名
 * @property {string} [avatarUrl]
 */

/**
 * 标签。
 * @typedef {Object} Label
 * @property {string} name
 * @property {string} color 后端无则 ''
 * @property {string} [description]
 */

/**
 * 评论。
 * @typedef {Object} Comment
 * @property {string} [id] 评论 id（threading/编辑追踪）
 * @property {Actor} author
 * @property {string} authorAssociation OWNER|MEMBER|CONTRIBUTOR|NONE|''（本地 ''）
 * @property {string} body
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} [editedAt] 编辑追踪
 */

/**
 * 里程碑。
 * @typedef {Object} Milestone
 * @property {string} name
 * @property {string} [description]
 * @property {'open'|'closed'} [state]
 * @property {string|null} [dueOn]
 */

/**
 * 结构化、类型化属性（**说明性元数据，绝不驱动 deck 逻辑**）。
 * @typedef {Object} CustomField
 * @property {string} name
 * @property {string|number|boolean|null} value
 * @property {FieldType} type
 * @property {string[]} [options] single/multi 的候选
 */

/**
 * 票/图的轻量引用（不递归展开，用于 blockedBy / blocking / tickets）。
 * @typedef {Object} IssueRef
 * @property {string} key 规范 id（github=String(number)；markdown='<NN>'；gitlab=String(iid)）
 * @property {string} title
 * @property {State} state 归一化两态（open/closed）
 * @property {IssueType} [type] 边上带 type（指向 map 还是票）
 */

/**
 * 票 / 图统一实体（完整形状）。
 *
 * 字段分组：
 *  - 【核心字段】永远存在，缺→`''`/`null`：key / type / title / state / body / url /
 *    createdAt / updatedAt / closedAt / parentKey。
 *  - 【能力字段】可 MISSING：author / assignees / labels / milestone / customFields /
 *    reason / blockedBy / comments。
 *
 * EMPTY vs MISSING：数组 `[]`=EMPTY、省略=MISSING；标量 `''`/`null`；**数组不填 `null`/`undefined`**
 * （`null` 只给 closedAt / parentKey）。EMPTY=有能力但本条无内容；MISSING=无该能力。
 *
 * ⚠️ blocking 不得作为 Issue 字段——它是 blockedBy 的反向派生（blocking 仅存在于 getDependencies 返回值与 deck 派生），违反=第二真相。
 *
 * @typedef {Object} Issue
 * @property {string} key 规范 id（仓库内唯一；全局身份 = (RepositoryRef, key)）
 * @property {import('./constants.js').ISSUE_TYPE} type issue | map（显式标记；map 可空）
 * @property {string} title
 * @property {State} state open | closed
 * @property {string} body 宿主端从 markdown 渲染，不重复 bodyHTML
 * @property {string} url 链接；本地 ''
 * @property {string} createdAt '' if none
 * @property {string} updatedAt '' if none
 * @property {string|null} closedAt null=未关闭
 * @property {string|null} parentKey 父 map 的 key；根=null（核心字段，永远存在）
 * @property {Actor} [author] 创建者（provenance）
 * @property {Actor[]} [assignees] 指派/认领；[]=EMPTY=未认领；省略=indeterminate（未知认领态）
 * @property {Label[]} [labels] EMPTY if none；MISSING if unsupported
 * @property {Milestone} [milestone]
 * @property {CustomField[]} [customFields] 结构化、说明性，绝不驱动 deck 逻辑
 * @property {ClosedReason} [reason] closed 时给原因（或 EMPTY=关了但没说明）；open 依后端支持给 ''/省略
 * @property {IssueRef[]} [blockedBy] 谁阻塞我（入边；唯一真源）
 * @property {Comment[]} [comments] 决策记录
 */

/**
 * 后端面对的工作区仓库。
 * `backend` 开放 string（**非空**）；'other' 保留串弃用——「无后端」只在 `Selection.backendId: null`。
 * @typedef {Object} RepositoryRef
 * @property {BackendId} backend 开放 string（非空；github/markdown/gitlab 一等）
 * @property {string} refId 稳定标识（github/gitlab='owner/name'；markdown='<path>'）；后端自解析
 * @property {string} name 显示名
 * @property {string} url 远端 URL；本地=''
 */

/**
 * 地图的 KPI 统计（**deck 派生视图，不属于后端形状**）。
 * 独立计数（claimed/blocked/indeterminate 各算各，可重叠）；「open=sum」为伪不变量（删除）。
 * @typedef {Object} MapStats
 * @property {number} total
 * @property {number} open
 * @property {number} closed
 * @property {number} frontier open 且无未满足依赖(blockedBy 空/全满足) 且未认领；天然排除 indeterminate
 * @property {number} claimed 有 assignee（认领）
 * @property {number} blocked open 且 blockedBy 非空（未满足依赖）
 * @property {number} indeterminate assignees=MISSING（未知认领态；不计 0、不误计 frontier）
 */

/**
 * 地图（type='map' 的 Issue 追加字段；向下，物化子票）。
 * @typedef {Object} MapNode
 * @property {Issue[]} tickets 子票（一层）；永远存在、缺省 `[]`(EMPTY)——「能否展开」用能力位表达，不作 MISSING
 */

/**
 * deck 投影（每票基数；display 直接用 key（`#${key}`），无 displayNumber / 无 number）。
 * @typedef {Object} DeckProjection
 * @property {Record<string, number|null>} progressOf 每票 `## 进度:N%`；无→null
 * @property {{name: string, color: string}[]} labels 标签色板目录
 * @property {Object} stats
 * @property {number} stats.total
 * @property {number} stats.open
 * @property {number} stats.closed
 * @property {number} stats.frontier
 * @property {number} stats.claimed
 * @property {number} stats.blocked
 * @property {number} stats.indeterminate
 * @property {{total: number; open: number; closed: number}[]} stats.levels 每层（数组）
 * @property {Record<string, number>} stats.levelOf 每 key 的 level
 * @property {Record<string, string[]>} [blockedByKeys] 把 IssueRef[] 投影成 key 数组（UI 用）
 */

/**
 * 后端中性快照（宿主编排；deck 为 host 计算的投影，UI 无脑用，绝不分支）。
 * @typedef {Object} Snapshot
 * @property {RepositoryRef} repository
 * @property {MapNode[]} maps
 * @property {Issue[]} issues 孤儿票（parentKey 指向已删/不存在 map）
 * @property {DeckProjection} deck host 计算的 deck 投影
 */

/** 契约形状版本（供日志/审计）。 */
export const SHAPE_VERSION = 1

/** 让本文件成为真实模块（类型定义是 JSDoc，此处仅作模块存在标识）。 */
export const TRACKER_SHAPE = Object.freeze({ version: SHAPE_VERSION, STATE, ISSUE_TYPE })
