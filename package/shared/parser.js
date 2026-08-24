/**
 * src/shared/parser.js —— host 纯函数叶子（阶段 1 · 源真源）
 *
 * 来源：host.js / package/lib/index.js 内联定义原样抽取（行为逐字等价）。
 * 现状（阶段 1）：host.js / package/lib/index.js 仍保留各自内联副本（零行为变化），
 *   本文件是「唯一真源 + 测试基准」；阶段 2（领域模块化）时让两边 import 本叶子的同名导出。
 * 约束：本文件必须保持纯函数（不碰 ctx / 不碰 DOM / 无共享状态），否则失去叶子价值。
 *
 * 命名导出 = host.js 内同名函数；新增业务逻辑请先在本文件加，再同步内联（并跑差分测试钉住）。
 */

// ——— normalizeBody：剥 BOM + 字面 \n 还原（T16 容错） ———
export function normalizeBody(raw) {
  let s = String(raw || '').replace(/^\uFEFF/, '')
  const realNL = (s.match(/\n/g) || []).length
  const literalNL = (s.match(/\\n/g) || []).length
  if (realNL < 2 && literalNL > 0) {
    s = s.replace(/\\n/g, '\n')
  }
  return s
}

// ——— parseMapBody：wayfinder map 五区块解析（## Destination / Notes / Decisions so far / Not yet specified / Out of scope） ———
export function parseMapBody(body) {
  const out = { destination: '', notes: '', decisions: [], fog: [], outOfScope: [] }
  if (!body) return out
  const sec = {}
  const lines = normalizeBody(body).split(/\r?\n/)
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/)
    if (m) { cur = m[1]; sec[cur] = sec[cur] || []; continue }
    if (cur) sec[cur].push(lines[i])
  }
  const clean = function (arr) { return (arr || []).map(function (s) { return s.trim() }).filter(Boolean) }
  out.destination = clean(sec['Destination']).join(' ')
  out.notes = clean(sec['Notes']).join(' ')
  out.decisions = clean(sec['Decisions so far']).filter(function (l) { return l.indexOf('- [') === 0 }).map(function (l) {
    const t = l.match(/\[(.+?)\]\((.+?)\)/)
    const g = l.replace(/^-\s*\[.+?\]\(.+?\)\s*[-–—]?\s*/, '')
    return { title: t ? t[1] : l, url: t ? t[2] : '', gist: g }
  })
  out.fog = clean(sec['Not yet specified']).filter(function (l) { return l.indexOf('<!--') !== 0 })
  out.outOfScope = clean(sec['Out of scope']).filter(function (l) { return l.indexOf('<!--') !== 0 })
  return out
}

// ——— parseProgress：进度块三级锚定（## 进度：N% / 行首变体 / 全文兜底），clamp 0-100 ———
export function parseProgress(body) {
  if (!body) return null
  const s = String(body)
  const m = s.match(/^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (isNaN(n)) return null
  return Math.max(0, Math.min(100, n))
}

// ——— computeLevels：blockedBy DAG 最长路径深度分层（level(root)=0；level(x)=1+max(level(直接阻塞者))） ———
export function computeLevels(tickets) {
  const byNum = {}
  tickets.forEach(function (t) { byNum[t.number] = t })
  const memo = {}
  const levelOf = function (t) {
    if (memo[t.number] !== undefined) return memo[t.number]
    const blockers = (t.blockedBy || []).map(function (b) { return byNum[b] }).filter(Boolean)
    if (!blockers.length) { memo[t.number] = 0; return 0 }
    let maxL = -1
    blockers.forEach(function (b) { const l = levelOf(b); if (l > maxL) maxL = l })
    memo[t.number] = maxL + 1
    return memo[t.number]
  }
  const byNumber = {}
  tickets.forEach(function (t) { byNumber[t.number] = levelOf(t) })
  const levels = []
  tickets.forEach(function (t) {
    const lv = byNumber[t.number]
    let layer = levels[lv]
    if (!layer) { layer = { level: lv, numbers: [], open: 0, closed: 0, total: 0, frontier: 0, claimed: 0, blocked: 0 }; levels[lv] = layer }
    layer.numbers.push(t.number)
    layer.total++
    if (t.state === 'CLOSED') layer.closed++
    else layer.open++
  })
  // 层内状态细分（frontier/claimed/blocked 归层）
  const openBlocker = function (b) { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
  levels.forEach(function (layer) {
    const openT = tickets.filter(function (t) { return byNumber[t.number] === layer.level && t.state === 'OPEN' })
    layer.frontier = openT.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) }).length
    layer.claimed = openT.filter(function (t) { return t.claimedBy }).length
    layer.blocked = openT.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) }).length
  })
  // 剔除空洞（levels 数组可能因跳级出现 undefined）
  const compact = levels.filter(Boolean)
  return { byNumber: byNumber, levels: compact }
}

// ——— groupTickets：open/closed/frontier/claimed/blocked 分组 + 附 DAG 分层（v1.4 T1 #442） ———
export function groupTickets(tickets) {
  const byNum = {}
  tickets.forEach(function (t) { byNum[t.number] = t })
  const openBlocker = function (b) { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
  const open = tickets.filter(function (t) { return t.state === 'OPEN' })
  const closed = tickets.filter(function (t) { return t.state === 'CLOSED' })
  const frontier = open.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
  const claimed = open.filter(function (t) { return t.claimedBy })
  const blocked = open.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
  // v1.4（T1 #442）：附 DAG 分层（client 渲染漏斗分层用）
  const lv = computeLevels(tickets)
  return {
    total: tickets.length, open: open.length, closed: closed.length,
    frontier: frontier.length, claimed: claimed.length, blocked: blocked.length,
    levels: lv.levels, levelOf: lv.byNumber,
  }
}
