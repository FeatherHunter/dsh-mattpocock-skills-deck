/**
 * backends/markdown/parse.js — 解析行内字段（Status:/Type:/Blocked by:）+ map 正文。
 *
 * ⌈ 骨架占位 ⌉ #115 实现：按 mattpocock `.scratch/` 格式解析（行内字段，`## Comments`/`## Answer`）。
 * 访问 OS 只经 platform（#113）。
 */

import { STATE, ISSUE_TYPE } from '../../../../shared/tracker/constants.js'

/**
 * 解析一份本地票/图文件 → 契约形状。
 * 注意：本地 markdown **无 labels**，按契约「无能力 → 省略字段(MISSING)」，
 * 故返回对象**不携带 `labels` 字段**（区别于「有能力但空 = []」）。
 * @param {string} text
 * @param {{key: string, parentKey?: string}} meta
 * @returns {import('../../../../shared/tracker/shape.js').Issue}
 */
export function parseMd(text, meta) {
  // OPEN-DECISION §6.1：Status→state 的映射是「草案」（resolved→closed），待 #127 定夺，勿当不变量。
  const status = /Status:\s*(\w+)/.exec(text)?.[1] || ''
  const state = status === 'resolved' ? STATE.CLOSED : STATE.OPEN
  const issue = {
    key: meta.key || '00',
    number: null,
    type: ISSUE_TYPE.ISSUE,
    title: (text.split('\n')[0] || '').replace(/^#+\s*/, '').trim() || '',
    state,
    body: text,
    url: '',
    // 不写 labels —— 本地无 labels 能力（MISSING），由 capability.js 据此判定 labels:false
    assignees: [],
    comments: [],
    subIssues: [],
    blockedBy: [],
    blocking: [],
    createdAt: '',
    updatedAt: '',
    closedAt: status === 'resolved' ? null : null,
    parentKey: meta.parentKey || null,
  }
  return issue
}
export default parseMd
