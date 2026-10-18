// src/host/tracker/capability.ts —— 从同目录 capability.js 逐行转写而来，只加类型标注与注释，运行时逻辑一个字未动。
//
// 为什么要转写这一份：宿主目录正在按“动到哪里就转到哪里”的口径把手写 JavaScript 换成 TypeScript，
//   本文件是能力诊断视图的真源，保持与调用方（src/tracker/index.ts 转出诊断入口）的导出形态一致才能无缝替换。
// 什么约定不能改：
//   1. 诊断只记录每字段填空，不导出布尔能力开关、能力表与能力缓存，调用方按“调用即知”使用本入口。
//   2. 空值口径保持原样：数组空、空串、空与未定义都算空，字段省略才算无能力。
//   3. 相对导入一律保留 .js 后缀，运行时由 scripts/ts-hook.mjs 改指同名 .ts，本文件不改说明符。

// 类型只做编译期约束，不产生运行时引用：Issue 的形状以共享层为准，本文件只读不写。
import type { Issue } from '../../shared/tracker/shape.js'

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

// 诊断日志行的形状：调用方传数组复用时按这一格追加，本文件不校验数组以外的形状。
export interface CapabilityLogEntry {
  label: string
  value: unknown
}

/**
 * 判断归一化对象是否带某字段（存在 = 不是 undefined；EMPTY 也计入存在）。
 */
export function hasField(obj: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, field)
}

/** 判断空值（[]/''/null/undefined）。 */
export function isEmpty(v: unknown): boolean {
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  return v === ''
}

// 诊断遍历字段：核心字段（永远存在）+ 能力字段（可 MISSING）。
// 【已删除】不再遍历 'number' / 'subIssues'（定版：单 key、无 number；树边 = parentKey + tickets）。
const DIAG_FIELDS: string[] = [
  // ---- 核心字段（永远存在）----
  'key', 'effortId', 'type', 'title', 'state', 'body', 'url',
  'createdAt', 'updatedAt', 'closedAt', 'parentKey',
  // ---- 能力字段（可 MISSING；EMPTY=有能力无内容，MISSING=无能力）----
  'author', 'assignees', 'labels', 'milestone', 'customFields',
  'reason', 'blockedBy', 'comments',
  // 拉取请求三个可选扩展字段：有该能力的后端给值或空，没有该能力的后端省略，诊断日志照此分成两类记录
  'isPullRequest', 'mergedAt', 'reviews',
]

/**
 * 把一张归一化 Issue 的每字段填/空 记录到日志（host 侧二分边界）。
 * 字段在但空 → `'EMPTY'`；字段省略 → `'MISSING'`；有值 → 原值。
 * 纯诊断，**不返回**任何布尔能力开关。
 */
export function diagnoseCapabilities(issue: Issue, log: CapabilityLogEntry[] = []): CapabilityLogEntry[] {
  for (const field of DIAG_FIELDS) {
    const present = hasField(issue, field)
    // Issue 类型没有字符串索引签名，运行时仍按字典取值，这里经 Record 中转只是让编译器认可用方括号取值。
    const record = issue as unknown as Record<string, unknown>
    const val = record[field]
    log.push({ label: field, value: present ? (isEmpty(val) ? 'EMPTY' : val) : 'MISSING' })
  }
  return log
}

export const CAPABILITY = Object.freeze({ version: 1 })
