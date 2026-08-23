/**
 * tracker/contract.js — Tracker 接口 + 归一化约定（主缝）。
 *
 * 一个「后端 = 一个实现本接口的适配器」。UI/宿主只通过本接口访问 tracker，
 * 不知道后端是谁。各后端（github/markdown/gitlab/…）严格对照本契约实现。
 *
 * 归一化三规则（capability-by-fill 的关键，见 shape.js）：
 *   1. 完整形状：字段齐，UI 假设必填。
 *   2. EMPTY vs MISSING：能实现但来源无 → EMPTY（[]/''/null）= 有能力但无内容；
 *      不能实现 → 省略字段（MISSING）= 能力缺失，或对应 op 返回 kind:'unsupported'。
 *   3. 日志二分：host 记录归一化后每字段填/空；client 记录渲染/隐藏（诊断用，不引入运行期内省）。
 */

import { BACKEND_KIND, STATE, ISSUE_TYPE, ERROR_KIND, CONTRACT_VERSION } from '../../shared/tracker/constants.js'

/**
 * Tracker 接口。实现方（后端适配器）应提供全部操作；不能实现的按规则返回 unsupported
 * 或省略字段，不硬装。
 *
 * @typedef {Object} Tracker
 * @property {string} id 后端 id（= BACKEND_KIND 之一）
 *
 * @property {(repo: import('../../shared/tracker/shape.js').RepositoryRef) => Promise<import('../../shared/tracker/shape.js').BackendStatus>} detect
 * @property {(repo: Object, opts?: Object) => Promise<import('../../shared/tracker/shape.js').Issue[]>} list
 * @property {(repo: Object, key: string) => Promise<import('../../shared/tracker/shape.js').Issue>} get
 * @property {(repo: Object, input: Object) => Promise<import('../../shared/tracker/shape.js').Issue>} create
 * @property {(repo: Object, key: string, body: string) => Promise<Object>} comment
 * @property {(repo: Object, key: string) => Promise<Object>} close
 * @property {(repo: Object, key: string, labels: string[]) => Promise<Object>} label
 * @property {(repo: Object, parentKey: string, childKey: string) => Promise<Object>} subIssue
 * @property {(repo: Object, childKey: string) => Promise<import('../../shared/tracker/shape.js').IssueRef[]>} blockedBy
 * @property {(repo: Object, opts?: Object) => Promise<import('../../shared/tracker/shape.js').MapNode>} syncSnapshot
 * @property {(repo: Object, opts?: Object) => Promise<Object>} preflight
 */

/** 操作清单（供 registry/日志/审计遍历）。 */
export const OPERATIONS = Object.freeze([
  'detect', 'list', 'get', 'create', 'comment', 'close',
  'label', 'subIssue', 'blockedBy', 'syncSnapshot', 'preflight',
])

/** 归一化规则（供诊断/审计引用；各后端 normalize.js 依此实现）。 */
export const NORMALIZE_RULES = Object.freeze({
  completeShape: true, // interface 声明全部字段，UI 假设必填
  emptyVsMissing: true, // 能实现→空值=EMPTY；不能实现→省略=MISSING
  logBisect: true, // host 记每字段填/空，client 记渲染/隐藏，不引入运行期内省
  noCapabilityBranching: true, // 能力视图只作诊断，不驱动 UI 隐藏（G5）
})

export const TRACKER_CONTRACT = Object.freeze({
  version: CONTRACT_VERSION,
  operations: OPERATIONS,
  normalizeRules: NORMALIZE_RULES,
  kinds: BACKEND_KIND,
  state: STATE,
  issueType: ISSUE_TYPE,
  errorKind: ERROR_KIND,
})
