/**
 * tests/tracker-contract/sections/snapshot.js — snapshot.js 宿主编排段（#132 Q2=B，Q3 细则必测）。
 *
 * 第一性原理（#124 §2.1 + Q3 裁决）：
 *  - composeSnapshot 非 op：纯 list 组合 + deck 派生；后端绝不存 deck 字段。
 *  - 缓存只缓存数据：快照（TTL 5000 可配）+ 依赖边 LRU（TTL 5s）；**绝不缓存 hasField/unsupported 判定**。
 *  - 「可选后端快路径」= snapshotFast（非 op）；只接受完整 Issue[]，否则回落 list（桩不误导）。
 *  - 写后自动逐出 = 宿主编排层显式 invalidate（本模块不感知写操作）。
 */

import { createRegistry } from '../../../src/host/tracker/registry.js'
import { createSnapshotComposer } from '../../../src/host/tracker/snapshot.js'
import { OPERATIONS } from '../../../src/host/tracker/contract.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ref = { backend: 'fake', refId: 'r1', name: 'R1', url: '' }
const refU = { backend: 'unsup', refId: 'r2', name: 'R2', url: '' }

const ALL = [
  { key: 'm1', type: 'map', title: 'M', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
  { key: 't1', type: 'issue', title: 'T1', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: 'm1', labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
  { key: 'o1', type: 'issue', title: 'O1', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: 'ghost-map', labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
]

export async function run() {
  const out = []
  const P = 'snapshot · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  // ── 组装 / 非 op / deck 派生 ──
  {
    let listCalls = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'fake', label: 'fake',
      create: () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const res = await composer.composeSnapshot('fake', ref, { cwd: '/w' })
    await assert('compose 成功且出 deck', res.ok === true && res.snapshot && res.snapshot.deck && typeof res.snapshot.deck.stats === 'object', JSON.stringify(res && res.error))
    const snap = res.snapshot
    await assert('repository 回填 ref', snap.repository === ref)
    await assert('maps 挂一层 tickets', snap.maps.length === 1 && snap.maps[0].key === 'm1' && snap.maps[0].tickets.length === 1 && snap.maps[0].tickets[0].key === 't1')
    await assert('孤儿（破链）归 issues', snap.issues.some((i) => i.key === 'o1'))
    await assert('deck 覆盖全量（map.tickets + orphan；map 节点是容器不重复计数）',
      snap.deck.stats.total === 2 && snap.deck.stats.levels && snap.deck.progressOf.t1 === null && 'm1' in snap.deck.progressOf,
      JSON.stringify(snap.deck.stats))
    await assert('composeSnapshot 非 op：OPERATIONS 不含 snapshot', !OPERATIONS.includes('snapshot') && !('snapshot' in registry.get('fake')))
  }

  // ── 快照缓存：TTL / force / invalidate / clear ──
  {
    let listCalls = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'fake', label: 'fake',
      create: () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    await composer.composeSnapshot('fake', ref, {})
    const c2 = await composer.composeSnapshot('fake', ref, {})
    await assert('命中快照缓存（list 只调一次）', listCalls === 1 && c2.cached === true, `listCalls=${listCalls}`)
    await composer.composeSnapshot('fake', ref, {}, { force: true })
    await assert('force 绕过缓存 → 重新 list', listCalls === 2, `listCalls=${listCalls}`)
    const last = await composer.composeSnapshot('fake', ref, {})
    await assert('force 后缓存已刷新', last.cached === true && listCalls === 2)
    composer.invalidateSnapshot('fake', ref)
    await composer.composeSnapshot('fake', ref, {})
    await assert('invalidateSnapshot → 重新 list', listCalls === 3, `listCalls=${listCalls}`)
    composer.clear()
    await composer.composeSnapshot('fake', ref, {})
    await assert('clear → 重新 list', listCalls === 4, `listCalls=${listCalls}`)
    const exp = createSnapshotComposer(registry, { snapshotTtl: 1, depsTtl: 1 })
    await exp.composeSnapshot('fake', ref, {})
    await sleep(10)
    await exp.composeSnapshot('fake', ref, {})
    await assert('✗ probe: TTL 过期 → 重新 list（不 Serve 陈旧）', listCalls === 6, `listCalls=${listCalls}`)
    const stale = await exp.composeSnapshot('fake', ref, {})
    await assert('TTL 过期后已重新缓存', stale.cached === true)
  }

  // ── 依赖 LRU：只缓存边数据 ──
  {
    let depCalls = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'fake', label: 'fake',
      create: () => ({
        list: async () => ({ ok: true, data: ALL }),
        getDependencies: async () => { depCalls++; return { ok: true, data: { blockedBy: [], blocking: [] } } },
      }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const d1 = await composer.getDependencies('fake', ref, 't1', {})
    const d2 = await composer.getDependencies('fake', ref, 't1', {})
    await assert('依赖 LRU：第二次命中（只调一次 op）', depCalls === 1 && d1.cached !== true && d2.cached === true, `depCalls=${depCalls}`)
    composer.invalidateDependencies('fake', ref, 't1')
    await composer.getDependencies('fake', ref, 't1', {})
    await assert('invalidateDependencies(key) → 重新调 op', depCalls === 2, `depCalls=${depCalls}`)
    composer.invalidateDependencies('fake', ref)
    await composer.getDependencies('fake', ref, 't1', {})
    await assert('invalidateDependencies(无 key) 清空该 repo', depCalls === 3, `depCalls=${depCalls}`)
  }

  // ── unsupported 不缓存（G5 红线）：独立计数器验证 ──
  {
    let unsupCalls = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'unsup', label: 'unsup',
      create: () => ({
        getDependencies: async () => { unsupCalls++; return { ok: false, error: { kind: 'unsupported', message: 'no graph' } } },
      }),
      matches: async () => false,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    await composer.getDependencies('unsup', refU, 'x', {})
    await composer.getDependencies('unsup', refU, 'x', {})
    await assert('✗ probe: unsupported 每调必达 op（不缓存）', unsupCalls === 2, `unsupCalls=${unsupCalls}`)
  }

  // ── 可选后端快路径（非 op）：完整才用，不完整回落 list ──
  {
    let listCalls = 0
    let fastUsed = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'fast', label: 'fast',
      create: () => ({
        list: async () => { listCalls++; return { ok: true, data: ALL } },
        snapshotFast: async () => { fastUsed++; return { ok: true, data: ALL } },
      }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const r1 = await composer.composeSnapshot('fast', ref, {})
    await assert('快路径生效（list 不调，deck 照常派生）', r1.ok === true && fastUsed === 1 && listCalls === 0 && r1.snapshot.deck.stats.total === 2,
      `fastUsed=${fastUsed} listCalls=${listCalls}`)
  }
  {
    let listCalls = 0
    let fastUsed = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'half', label: 'half',
      create: () => ({
        list: async () => { listCalls++; return { ok: true, data: ALL } },
        snapshotFast: async () => { fastUsed++; return { ok: true, data: null } }, // 不完整 → 回落
      }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const r2 = await composer.composeSnapshot('half', ref, {})
    await assert('✗ probe: 快路径不完整 → 回落 list（桩不误导）', r2.ok === true && fastUsed === 1 && listCalls === 1,
      `fastUsed=${fastUsed} listCalls=${listCalls}`)
  }

  // ── map 正文五区块（Destination/Notes/Decisions so far/Not yet specified/Out of scope）──
  // 回归：快照经 composeSnapshot 后，map 必须携带解析后的区块字段。UI 详情页（MapDetail）
  // 直接读 m.decisions.length / m.fog.length / m.outOfScope.length；GitHub 后端切到编排器后
  // 曾漏解析正文，点击 Map 行进详情页即报 Cannot read properties of undefined (reading 'length')。
  {
    const MAP_BODY = [
      { key: 'm1', type: 'map', title: 'M', state: 'open', body: '## Destination\n做好一件事\n## Notes\n背景说明\n## Decisions so far\n- [定版：先修详情页](https://example.com/1) 理由一\n## Not yet specified\n- 迷雾一\n<!-- 注释不进入迷雾 -->\n## Out of scope\n- 不做二\n', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
      { key: 'm2', type: 'map', title: 'M2', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
    ]
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'mapbody', label: 'mapbody',
      create: () => ({ list: async () => ({ ok: true, data: MAP_BODY }) }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const r = await composer.composeSnapshot('mapbody', ref, {})
    const m1 = r.snapshot.maps.find((x) => x.key === 'm1')
    const m2 = r.snapshot.maps.find((x) => x.key === 'm2')
    await assert('map 区块解析：destination/notes/decisions/fog/outOfScope 命中正文',
      m1 && m1.destination === '做好一件事' && m1.notes === '背景说明'
        && Array.isArray(m1.decisions) && m1.decisions.length === 1
        && m1.decisions[0].title === '定版：先修详情页' && m1.decisions[0].url === 'https://example.com/1'
        && Array.isArray(m1.fog) && m1.fog.length === 1 && m1.fog[0] === '- 迷雾一'
        && Array.isArray(m1.outOfScope) && m1.outOfScope.length === 1 && m1.outOfScope[0] === '- 不做二',
      JSON.stringify({ m1: m1 && { destination: m1.destination, notes: m1.notes, decisions: m1.decisions, fog: m1.fog, outOfScope: m1.outOfScope } }))
    await assert('map 区块字段恒为 EMPTY（正文为空也给数组/字符串，不 MISSING）',
      m2 && Array.isArray(m2.decisions) && m2.decisions.length === 0
        && Array.isArray(m2.fog) && m2.fog.length === 0
        && Array.isArray(m2.outOfScope) && m2.outOfScope.length === 0
        && typeof m2.destination === 'string' && m2.destination === ''
        && typeof m2.notes === 'string' && m2.notes === '',
      JSON.stringify({ m2: m2 && { destination: m2.destination, notes: m2.notes, decisions: m2.decisions, fog: m2.fog, outOfScope: m2.outOfScope } }))
  }

  // ── 未知后端 ──
  {
    const composer = createSnapshotComposer(createRegistry({}, { matchesTimeout: 50 }), {})
    const r = await composer.composeSnapshot('ghost', ref, {})
    await assert('未知后端 → ok:false error', r.ok === false && r.error && r.error.kind === 'unsupported', JSON.stringify(r))
  }

  return out
}

export default { name: 'snapshot', run }
