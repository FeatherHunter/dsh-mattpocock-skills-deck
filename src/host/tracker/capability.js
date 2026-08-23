/**
 * tracker/capability.js — capability-by-fill 推导（G5，**纯诊断视图**，不驱动 UI 隐藏）。
 *
 * 能力不是后端手写的声明清单，而是从「归一化对象里字段是否存在」+「操作是否可用」推导：
 *   - 字段**存在**（即使 EMPTY `[]`/''/null）→ 该能力**存在**。
 *   - 字段被**省略**（MISSING）→ 该能力**缺失**。
 *   - 「后端级能力」（closedState/liveUpdates）由**可用操作**（ops）驱动，绝不硬编码 true。
 *
 * 第一性原理：诊断视图**只说真话** —— 查不到的默认 false，不猜、不硬编码。
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

/**
 * 从一张归一化 Issue + 可用操作表推导能力视图。
 * @param {import('../../shared/tracker/shape.js').Issue} issue
 * @param {{subIssue?: boolean, blockedBy?: boolean, close?: boolean, liveUpdates?: boolean}} [ops] 该后端可用操作（由 preflight/detect 结果驱动）
 * @returns {import('../../shared/tracker/shape.js').BackendCapabilities}
 */
export function deriveCapabilities(issue, ops = {}) {
  const has = (f) => hasField(issue, f)
  const op = (name) => !!ops[name]
  return {
    labels: has('labels'),
    subIssue: has('subIssues') && op('subIssue'),
    depGraph: (has('blockedBy') || has('blocking')) && op('blockedBy'),
    comments: has('comments'),
    closedState: op('close'), // 需要该后端能表达/执行 close，才能说「有 closed 态」；查不到=false
    liveUpdates: !!ops.liveUpdates, // 由 preflight/detect 驱动；缺省 false，不硬编码 true
    remoteSharing: has('url') && !!issue.url,
  }
}

/**
 * 把一次同步返回的形状降级为诊断信息（供 wf.status/snapshot 当 isInfo，不驱动隐藏），
 * 并回填「每字段填/空」日志（host 侧二分边界）。
 * @param {import('../../shared/tracker/shape.js').Issue} issue
 * @param {{label: string, value: unknown}[]} log
 * @param {object} [ops]
 * @returns {import('../../shared/tracker/shape.js').BackendCapabilities}
 */
export function diagnoseCapabilities(issue, log = [], ops) {
  const caps = deriveCapabilities(issue, ops)
  for (const field of ['key', 'number', 'title', 'body', 'state', 'url', 'labels', 'assignees', 'comments', 'subIssues', 'blockedBy', 'blocking', 'closedAt', 'parentKey']) {
    const present = hasField(issue, field)
    const val = issue[field]
    log.push({ label: field, value: present ? (isEmpty(val) ? 'EMPTY' : val) : 'MISSING' })
  }
  return caps
}

/** 判断空值（[]/''/null/undefined）。 */
export function isEmpty(v) {
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  return v === ''
}

export const CAPABILITY = Object.freeze({ version: 1 })
