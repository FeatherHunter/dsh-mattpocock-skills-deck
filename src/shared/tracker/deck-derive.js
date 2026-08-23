/**
 * tracker/deck-derive.js — deck 投影纯函数（host 与 deck 共用；无 IO、无副作用）。
 *
 * 第一性原理（#127/#124 定版）：
 *  - deck 是**派生视图**，不是事实源：`MapStats`（frontier/claimed/blocked/indeterminate）不进后端形状，
 *    由 `state` + `blockedBy`（唯一真源）+ `assignees` 推导；后端绝不存 `deck` 字段。
 *  - 独立计数（claimed/blocked/indeterminate 各算各，可重叠）；「open=sum」为伪不变量（删除）。
 *  - `frontier` 须「assignees **已知且空** + !claimed + !blocked」= 天然排除 indeterminate（assignees:MISSING）。
 *  - **NOT-FOUND（破链依赖）→ 安全 blocked**（绝不误判 frontier），levelOf 按 0 计（占层级，不影响 blocked 判定）。
 *  - 环（自环/成环）用 visited 守卫：返回 0 / 跳过该边（保证终止）。
 *  - display 直接用 `key`（`#${key}`），无 getDisplayNumber / 无 number。
 *
 * 输入：整个 Snapshot 的 {maps, issues}；deck 以整个 Snapshot 为单位（全局 key 空间；labels 全量并集）。
 */

import { STATE } from './constants.js'

const OPEN = STATE.OPEN
const CLOSED = STATE.CLOSED

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * 从正文解析进度（与 host/index.js 既有口径一致的三级锚定）：
 *   1) 标题行 `## 进度：90%`（行首 markdown 标题 · 进度区正形）
 *   2) 行首变体 `进度：90%` / `Progress: 90%`（无标题符号）
 *   3) 全文兜底（兼容老票随手格式 · 放最后不劫持前两层）
 * 无进度 → null；非法/超界 → clamp 0..100。
 * @param {string|null|undefined} body
 * @returns {number|null}
 */
export function parseProgress(body) {
  if (body == null) return null
  const s = String(body)
  const m = s.match(/^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (isNaN(n)) return null
  return Math.max(0, Math.min(100, n))
}

/** claimed 三态：true=有认领；false=已知且空（EMPTY []）；null=indeterminate（assignees MISSING）。 */
function claimedOf(ticket) {
  if (!hasOwn(ticket, 'assignees')) return null
  return Array.isArray(ticket.assignees) && ticket.assignees.length > 0
}

/**
 * 是否有未满足的 open 阻塞者。
 * 规则（#124 §5.2）：在 deck 内 lookup(ref.key) 且 state==='open' → true；
 * **NOT-FOUND（破链依赖）→ true（安全 blocked，绝不误判 frontier）**。
 * @param {Object} ticket
 * @param {Map<string, Object>} byKey deck 内全部票（key → Issue）
 * @returns {boolean}
 */
function hasOpenBlocker(ticket, byKey) {
  const refs = ticket.blockedBy
  if (!Array.isArray(refs) || refs.length === 0) return false
  return refs.some((ref) => {
    const target = byKey.get(ref && ref.key)
    if (!target) return true // NOT-FOUND → blocked（安全）
    return target.state === OPEN
  })
}

/**
 * DAG 最长路径分层（level(root)=0；level(x)=1+max(level(直接阻塞者))）。
 * 环守卫：visited 栈内重入 → 0（跳过该边）；NOT-FOUND 阻塞者 → 按 0 计（占层级）。
 * @param {Object} ticket
 * @param {Map<string, Object>} byKey
 * @param {Map<string, number>} memo
 * @param {Set<string>} stack
 * @returns {number}
 */
function levelOf(ticket, byKey, memo, stack) {
  const k = ticket.key
  if (memo.has(k)) return memo.get(k)
  if (stack.has(k)) return 0 // 环：返回 0 / 跳过该边
  stack.add(k)
  let maxL = -1
  const refs = ticket.blockedBy
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      const target = byKey.get(ref && ref.key)
      const l = target ? levelOf(target, byKey, memo, stack) : 0 // NOT-FOUND → 0（占层级）
      if (l > maxL) maxL = l
    }
  }
  stack.delete(k)
  const level = maxL === -1 ? 0 : maxL + 1
  memo.set(k, level)
  return level
}

/**
 * 把一张 deck 切片（maps + issues）投影成 DeckProjection。
 * - 覆盖单位 = 整个 Snapshot：maps（节点本身 + 各自 tickets）+ issues（孤儿/未挂图票），按 key 唯一化；
 *   deck 负责全部票（全局 key 空间；labels 色板全量并集）。
 * - 输入必须满足：tickets 只挂在 MapNode 上（base Issue 无 tickets）；孤儿含破链票与根票（见 snapshot.js）。
 *
 * @param {{maps?: import('./shape.js').MapNode[], issues?: import('./shape.js').Issue[]}} input
 * @returns {import('./shape.js').DeckProjection}
 */
export function deriveDeck(input = {}) {
  const maps = Array.isArray(input.maps) ? input.maps : []
  const issues = Array.isArray(input.issues) ? input.issues : []

  // 按 key 唯一化（map 节点也可能出现在父 map.tickets；lookup 全局一份）。
  // 语义（Q4 裁决）：deck 以整个 Snapshot 为单位——**票池**（stats 计数对象）= 各 map.tickets 并集 + issues（孤儿/未挂图票）；
  // **map 节点本身**是容器（父 map.tickets 里的子 map 仍算其父的票，计入池）；map 节点不因「在 maps[] 里」而重复计数，
  // 但其 key 参与 lookup（跨 map 依赖可解析）。progressOf/labels/blockedByKeys/levelOf 覆盖全部（含 map 节点）。
  const byKey = new Map()
  const add = (t) => { if (t && typeof t.key === 'string' && !byKey.has(t.key)) byKey.set(t.key, t) }
  for (const m of maps) { add(m); for (const t of (m.tickets || [])) add(t) }
  for (const t of issues) add(t)
  const all = Array.from(byKey.values())

  // 票池 = 各 map.tickets 并集 + issues（不含单独出现在 maps[] 的根 map 节点）
  const poolKeys = new Set()
  for (const m of maps) for (const t of (m.tickets || [])) if (t && typeof t.key === 'string') poolKeys.add(t.key)
  for (const t of issues) if (t && typeof t.key === 'string') poolKeys.add(t.key)

  // progressOf（每票基数；无 → null）
  const progressOf = {}
  for (const t of all) progressOf[t.key] = parseProgress(t.body)

  // labels 色板目录（全量并集；名称唯一，保留首个颜色；MISSING 字段跳过不崩溃）
  const labelMap = new Map()
  for (const t of all) {
    const arr = t.labels
    if (!Array.isArray(arr)) continue
    for (const l of arr) {
      if (l && typeof l.name === 'string' && !labelMap.has(l.name)) {
        labelMap.set(l.name, { name: l.name, color: typeof l.color === 'string' ? l.color : '' })
      }
    }
  }
  const labels = Array.from(labelMap.values())

  // levelOf（DAG 全票；环/NFD 规则见 levelOf）
  const memo = new Map()
  const stack = new Set()
  const levelOfByKey = {}
  for (const t of all) levelOfByKey[t.key] = levelOf(t, byKey, memo, stack)

  // stats（独立计数可重叠；frontier ⊥ claimed/blocked/indeterminate；NOT-FOUND→blocked 安全）。
  // 只统计票池（map.tickets + orphan）；map 节点本身是容器，不重复计数。
  const stats = { total: poolKeys.size, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, indeterminate: 0, levels: [], levelOf: levelOfByKey }
  const levelAgg = new Map() // level -> {total, open, closed}
  for (const key of poolKeys) {
    const t = byKey.get(key)
    const isOpen = t.state === OPEN
    if (t.state === CLOSED) stats.closed++
    else if (isOpen) stats.open++
    const claimed = claimedOf(t)
    const isBlocked = isOpen && hasOpenBlocker(t, byKey)
    if (claimed === true) stats.claimed++
    else if (claimed === null) stats.indeterminate++
    if (isBlocked) stats.blocked++
    if (isOpen && claimed === false && !isBlocked) stats.frontier++ // assignees 已知且空 + !claimed + !blocked
    const lv = levelOfByKey[t.key]
    let agg = levelAgg.get(lv)
    if (!agg) { agg = { level: lv, total: 0, open: 0, closed: 0 }; levelAgg.set(lv, agg) }
    agg.total++
    if (isOpen) agg.open++
    else agg.closed++
  }
  stats.levels = Array.from(levelAgg.values())
    .sort((a, b) => a.level - b.level)
    .map((v) => ({ total: v.total, open: v.open, closed: v.closed })) // 每层（数组）；只载形状声明的字段

  // blockedByKeys（把 IssueRef[] 投影成 UI 使用的 key 数组）
  const blockedByKeys = {}
  for (const t of all) {
    blockedByKeys[t.key] = (Array.isArray(t.blockedBy) ? t.blockedBy : []).map((r) => r && r.key)
  }

  return { progressOf, labels, stats, blockedByKeys }
}

export const DECK_DERIVE = Object.freeze({ version: 1 })
