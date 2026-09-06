/**
 * tests/tracker-contract/sections/deck.js — deck-derive.js 纯函数段（#132 Q2=B，Q4 细则必测）。
 *
 * 第一性原理（#127/#124）：deck 是派生视图——frontier/claimed/blocked/indeterminate 由
 * state+blockedBy+assignees 推导；「assignees 已知且空 + !claimed + !blocked」才 frontier；
 * NOT-FOUND（破链依赖）→ 安全 blocked（绝不误判 frontier）；levelOf：环 visited 守卫 + NFD 按 0 计。
 * 本段必须有 **NFD + 环** 两条用例（Q4 裁决）。
 */

import { deriveDeck, parseProgress } from '../../../src/shared/tracker/deck-derive.js'

/** 造一张票（默认挂在 m1 下、空 assignees=EMPTY、无阻塞）。 */
const t = (key, over = {}) => Object.assign({
  key, type: 'issue', title: key, state: 'open', body: '', url: '',
  createdAt: '', updatedAt: '', closedAt: null, parentKey: 'm1',
  labels: [], assignees: [], comments: [], blockedBy: [], reason: '',
}, over)

/** 造一张 map 节点。 */
const m = (key, tickets = [], over = {}) => Object.assign({
  key, type: 'map', title: key, state: 'open', body: '', url: '',
  createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
  labels: [], assignees: [], comments: [], blockedBy: [], reason: '',
  tickets,
}, over)

export async function run() {
  const out = []
  const P = 'deck · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  // ── parseProgress（三锚定 + clamp + null）──
  await assert('parseProgress 标题行', parseProgress('## 进度：42%') === 42, String(parseProgress('## 进度：42%')))
  await assert('parseProgress 行首变体（Progress:）', parseProgress('Progress: 80%') === 80)
  await assert('parseProgress 全文兜底', parseProgress('正文提到 进度：7% 而已') === 7)
  await assert('parseProgress 超界 clamp 100', parseProgress('## 进度：130%') === 100)
  await assert('parseProgress 无进度 → null', parseProgress('') === null && parseProgress(null) === null && parseProgress('no progress here') === null)

  // ── 基础投影：progressOf / labels / blockedByKeys / levelOf 链 ──
  {
    const a = t('a', { blockedBy: [], parentKey: null, assignees: [] })
    const b = t('b', { blockedBy: [{ key: 'a', title: 'a', state: 'open' }] })
    const c = t('c', { blockedBy: [{ key: 'b', title: 'b', state: 'open' }], body: '## 进度：55%' })
    const d = t('d', { labels: [{ name: 'bug', color: 'red' }] })
    const e = t('e', { labels: [{ name: 'bug', color: 'blue' }, { name: 'feat', color: '' }] }) // 同名去重
    const f = t('f', {}) // 无 labels 字段（MISSING）不崩
    const deck = deriveDeck({ maps: [m('m1', [a, b, c, d, e, f])], issues: [] })
    await assert('progressOf 每票基数', deck.progressOf.c === 55 && deck.progressOf.a === null)
    await assert('labels 全量并集 + 名称唯一（首个颜色）',
      JSON.stringify(deck.labels) === JSON.stringify([{ name: 'bug', color: 'red' }, { name: 'feat', color: '' }]),
      JSON.stringify(deck.labels))
    await assert('blockedByKeys 投影为 key 数组', JSON.stringify(deck.blockedByKeys.b) === JSON.stringify(['a'])
      && JSON.stringify(deck.blockedByKeys.a) === JSON.stringify([]))
    await assert('levelOf DAG 最长路径（a=0,b=1,c=2）', deck.stats.levelOf.a === 0 && deck.stats.levelOf.b === 1 && deck.stats.levelOf.c === 2,
      JSON.stringify(deck.stats.levelOf))
    await assert('levels 数组按层聚合', JSON.stringify(deck.stats.levels) === JSON.stringify([{ total: 4, open: 4, closed: 0 }, { total: 1, open: 1, closed: 0 }, { total: 1, open: 1, closed: 0 }]),
      JSON.stringify(deck.stats.levels))
  }

  // ── stats 口径：claimed/blocked/indeterminate 独立 + frontier 排除 ──
  {
    const frontier = t('frontier', { assignees: [], blockedBy: [] })                 // 已知且空 → 可 frontier
    const claimed = t('claimed', { assignees: [{ login: 'a' }] })                    // claimed=true
    const blocked = t('blocked', { assignees: [], blockedBy: [{ key: 'frontier', title: 'f', state: 'open' }] })
    const indeterminate = t('indet', { blockedBy: [] })                              // assignees 省略（MISSING）
    delete indeterminate.assignees
    const closed = t('closed', { state: 'closed', assignees: [], blockedBy: [] })
    const deck = deriveDeck({ maps: [m('m1', [frontier, claimed, blocked, indeterminate, closed])], issues: [] })
    const s = deck.stats
    await assert('stats.total/open/closed', s.total === 5 && s.open === 4 && s.closed === 1, JSON.stringify(s))
    await assert('claimed 独立计数', s.claimed === 1)
    await assert('blocked 独立计数', s.blocked === 1)
    await assert('indeterminate 计数（assignees MISSING）', s.indeterminate === 1)
    await assert('frontier 排除 indeterminate/claimed/blocked/closed', s.frontier === 1, `frontier=${s.frontier}`)
  }

  // ── Q4 必测：NOT-FOUND（破链依赖）→ 安全 blocked，levelOf 按 0 计 ──
  {
    const nfd = t('nfd', { assignees: [], blockedBy: [{ key: 'ghost-1', title: 'missing', state: 'open' }] })
    const deck = deriveDeck({ maps: [m('m1', [nfd])], issues: [] })
    await assert('NFD → blocked=true（安全，绝不误判 frontier）', deck.stats.blocked === 1 && deck.stats.frontier === 0,
      JSON.stringify(deck.stats))
    await assert('NFD levelOf 按 0 计 → 占层级 level=1', deck.stats.levelOf.nfd === 1, `level=${deck.stats.levelOf.nfd}`)
    await assert('✗ probe: NFD 若被误当满足 → 会错判 frontier（自证）', (async () => {
      // naive：查表缺失的依赖当「满足」→ nfd 会被误判为 frontier（与正确口径可区分）
      const naiveSatisfied = (ticket, map) => (ticket.blockedBy || []).every((ref) => {
        const target = map.get(ref.key)
        return !target || target.state !== 'open'
      })
      const naiveFrontier = naiveSatisfied(nfd, new Map([['nfd', nfd]])) // ghost 不在表内 → naive 判满足
      return naiveFrontier === true && deck.stats.frontier === 0
    })(), 'NFD semantic must be distinguishable from naive (satisfied)')
  }

  // ── Q4 必测：环 visited 守卫（终止 + 不误崩） ──
  {
    const c1 = t('c1', { assignees: [], blockedBy: [{ key: 'c2', title: 'c2', state: 'open' }] })
    const c2 = t('c2', { assignees: [], blockedBy: [{ key: 'c1', title: 'c1', state: 'open' }] })
    const deck = deriveDeck({ maps: [m('m1', [c1, c2])], issues: [] })
    const l1 = deck.stats.levelOf.c1
    const l2 = deck.stats.levelOf.c2
    await assert('环：终止且层级有限（均 ≥0，其一 ≥1）', Number.isFinite(l1) && Number.isFinite(l2) && l1 >= 0 && l2 >= 0 && Math.max(l1, l2) >= 1,
      JSON.stringify(deck.stats.levelOf))
    await assert('✗ probe: 无守卫实现会栈溢出（自证）', (async () => {
      // 同输入的「无 visited 守卫」递归实现 → 环必然 RangeError 溢出；守卫版已正常返回。
      const noGuardLevelOf = (ticket, map) => {
        const blockers = (ticket.blockedBy || []).map((x) => map.get(x.key)).filter(Boolean)
        if (!blockers.length) return 0
        return 1 + Math.max(...blockers.map((b) => noGuardLevelOf(b, map)))
      }
      const byKey = new Map([['c1', c1], ['c2', c2]])
      let overflow = false
      try { noGuardLevelOf(c1, byKey) } catch (e) { overflow = e instanceof RangeError }
      return overflow
    })(), 'deriveDeck(cycle) must return (visited guard)')
  }

  // ── 孤儿（issues）计入 deck ──
  {
    const orphan = t('orphan', { parentKey: 'ghost-map', assignees: [], blockedBy: [] })
    const deck = deriveDeck({ maps: [m('m1', [])], issues: [orphan] })
    await assert('孤儿（破链）计入 deck stats', deck.stats.total === 1 && deck.stats.frontier === 1, JSON.stringify(deck.stats))
  }

  // ── 池内身份：同号异类计两票（#505 小修：byKey/poolKeys/progressOf 按池内身份，不按裸 key）──
  {
    const issue5 = t('5', { assignees: [], isPullRequest: false })
    const pr5 = t('5', { assignees: [], isPullRequest: true })
    const deck = deriveDeck({ maps: [m('m1', [issue5, pr5])], issues: [] })
    await assert('同号异类计两票（普通 5 与拉取请求 5 不丢任一）', deck.stats.total === 2, JSON.stringify(deck.stats))
    await assert('✗ probe: 双 5 各有牌面（progressOf 按池内身份键入）', ('5\0issue' in deck.progressOf) && ('5\0pr' in deck.progressOf), JSON.stringify(Object.keys(deck.progressOf)))
    const fals = t('9', { assignees: [], isPullRequest: false })
    const miss = t('9', { assignees: [] }) // MISSING：无该能力后端省略该字段
    const deck2 = deriveDeck({ maps: [m('m1', [fals])], issues: [miss] })
    await assert('✗ probe: false 与 MISSING 不再混同（同键计两票）', deck2.stats.total === 2 && ('9\0issue' in deck2.progressOf) && ('9' in deck2.progressOf), JSON.stringify({ total: deck2.stats.total, keys: Object.keys(deck2.progressOf) }))
    const bad = t('5', { assignees: [], isPullRequest: 'yes' }) // BAD：字段在但不是布尔值
    const deck3 = deriveDeck({ maps: [m('m1', [issue5])], issues: [bad] })
    await assert('✗ probe: BAD 单独隔离（混合返回不断言一致，不抛不吞）', deck3.stats.total === 2 && ('5\0bad' in deck3.progressOf), JSON.stringify({ total: deck3.stats.total, keys: Object.keys(deck3.progressOf) }))
  }

  return out
}

export default { name: 'deck', run }
