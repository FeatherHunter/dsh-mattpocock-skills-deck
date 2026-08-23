/**
 * tracker/capability.js — capability-by-fill 推导（G5，**纯诊断视图**，不驱动 UI 隐藏）。
 *
 * 能力不是后端手写的声明清单，而是「运行时调用的结果」：
 *   - **字段能力** = 归一化结果上 `hasField`（`[]`/''/null 存在 = EMPTY = 有能力；
 *     字段被省略 = MISSING = 无能力）。
 *   - **操作能力** = 调用该 op → 得数据 = 可用；返回 `{ok:false, error:{kind:'unsupported'}}` = 不可用。
 *
 * 这里**不导出**任何布尔能力开关 / 能力表 / 能力缓存（G5 红线：无能力表、无能力分支、无运行期内省）。
 * 对外只有一个诊断入口：`diagnoseCapabilities(issue, log)`——记录每字段填/空（host 侧二分边界）。
 */

/**
 * 判断归一化对象是否带某字段（存在 = 不是 undefined；EMPTY 也计入存在）。
 * @param {Object} obj
 * @param {string} field
 * @returns {boolean}
 */
export function hasField(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field)
}

/** 判断空值（[]/''/null/undefined）。 */
export function isEmpty(v) {
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  return v === ''
}

// 诊断遍历字段：核心字段（永远存在）+ 能力字段（可 MISSING）。
// 【已删除】不再遍历 'number' / 'subIssues'（定版：单 key、无 number；树边 = parentKey + tickets）。
const DIAG_FIELDS = [
  // ---- 核心字段（永远存在）----
  'key', 'type', 'title', 'state', 'body', 'url',
  'createdAt', 'updatedAt', 'closedAt', 'parentKey',
  // ---- 能力字段（可 MISSING；EMPTY=有能力无内容，MISSING=无能力）----
  'author', 'assignees', 'labels', 'milestone', 'customFields',
  'reason', 'blockedBy', 'comments',
]

/**
 * 把一张归一化 Issue 的每字段填/空 记录到日志（host 侧二分边界）。
 * 字段在但空 → `'EMPTY'`；字段省略 → `'MISSING'`；有值 → 原值。
 * 纯诊断，**不返回**任何布尔能力开关。
 * @param {import('../../shared/tracker/shape.js').Issue} issue
 * @param {{label: string, value: unknown}[]} [log] 可传入复用；缺省新建
 * @returns {{label: string, value: unknown}[]} 追加后的日志
 */
export function diagnoseCapabilities(issue, log = []) {
  for (const field of DIAG_FIELDS) {
    const present = hasField(issue, field)
    const val = issue[field]
    log.push({ label: field, value: present ? (isEmpty(val) ? 'EMPTY' : val) : 'MISSING' })
  }
  return log
}

export const CAPABILITY = Object.freeze({ version: 1 })
