/**
 * tests/tracker-contract/sections/snapshot.js — snapshot.js 宿主编排段（#132 Q2=B，Q3 细则必测）。
 *
 * 第一性原理（#124 §2.1 + Q3 裁决）：
 *  - composeSnapshot 非 op：纯 list 组合 + deck 派生；后端绝不存 deck 字段。
 *  - 缓存只缓存数据：快照（TTL 5000 可配）+ 依赖边 LRU（TTL 5s）；**绝不缓存 hasField/unsupported 判定**。
 *  - 「可选后端快路径」= snapshotFast（非 op）；只接受完整 Issue[]，否则回落 list（桩不误导）。
 *  - 写后自动逐出 = 宿主编排层显式 invalidate（本模块不感知写操作）。
 */

import { createRegistry } from '../../../src/host/tracker/registryCore.js' // V1 #461：registry.js 已拆为三块
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

  // ── 拉取请求同池（#505 落 #294 形状 A：不分片、不新增集合；同号异类不混键；牌面派生不丢任一）──
  // 分界：组装层全量保留（普通工单与拉取请求同池），界面按类型过滤归前端页签（#506），本层不过滤。
  {
    const base = (o) => Object.assign({ type: 'issue', title: 'T', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }, o)
    const prData = [
      base({ key: 'm1', type: 'map', title: 'M' }),
      base({ key: '5', title: 'Issue5', parentKey: 'm1', isPullRequest: false, mergedAt: null, reviews: [] }),
      base({ key: '6', title: 'PR6', parentKey: 'm1', isPullRequest: true, mergedAt: null, reviews: [{ state: 'approved', reviewer: { login: 'r1' }, submittedAt: '2024-01-03T00:00:00Z' }] }),
      base({ key: '5', title: 'PR5-orphan', isPullRequest: true, mergedAt: null, reviews: [] }),
      base({ key: '7', title: 'PR7-orphan', isPullRequest: true, mergedAt: '2024-02-01T00:00:00Z', reviews: [] }),
      base({ key: '8', title: 'Legacy8' }), // 无拉取请求能力的后端：三字段全省略（MISSING）
    ]
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'prpool', label: 'prpool',
      create: () => ({ list: async () => ({ ok: true, data: prData }) }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    const r = await composer.composeSnapshot('prpool', ref, {})
    const m1 = r.snapshot.maps.find((x) => x.key === 'm1')
    await assert('同池 tickets：普通工单与拉取请求同挂一图', r.ok === true && m1 && m1.tickets.length === 2 && m1.tickets.some((t) => t.isPullRequest === false) && m1.tickets.some((t) => t.isPullRequest === true), JSON.stringify(m1 && m1.tickets.map((t) => ({ key: t.key, title: t.title, isPullRequest: t.isPullRequest }))))
    const orphans = r.snapshot.issues
    await assert('✗ probe: 同号异类不互吞（已挂载工单 5 不吞掉孤儿拉取请求 5）', orphans.length === 3 && orphans.some((t) => t.title === 'PR5-orphan' && t.isPullRequest === true) && orphans.some((t) => t.key === '7') && orphans.some((t) => t.key === '8'), JSON.stringify(orphans.map((t) => t.title)))
    const pr6 = m1.tickets.find((t) => t.key === '6')
    const legacy8 = orphans.find((t) => t.key === '8')
    const issue5 = m1.tickets.find((t) => t.title === 'Issue5')
    await assert('EMPTY-MISSING 口径：有字段原样带、无字段保持省略', pr6 && Array.isArray(pr6.reviews) && pr6.reviews.length === 1 && pr6.reviews[0].reviewer.login === 'r1' && Array.isArray(issue5.reviews) && issue5.reviews.length === 0 && !Object.prototype.hasOwnProperty.call(legacy8, 'isPullRequest') && !Object.prototype.hasOwnProperty.call(legacy8, 'mergedAt') && !Object.prototype.hasOwnProperty.call(legacy8, 'reviews'), JSON.stringify({ pr6reviews: pr6 && pr6.reviews, legacyKeys: legacy8 && Object.keys(legacy8) }))
    const po = (r.snapshot.deck && r.snapshot.deck.progressOf) || {}
    await assert('牌面派生覆盖拉取请求（池内身份全覆盖，不丢任一）', r.snapshot.deck && ('6\0pr' in po) && ('7\0pr' in po) && ('8' in po) && r.snapshot.deck.stats.total === 5, JSON.stringify(r.snapshot.deck && { total: r.snapshot.deck.stats.total, keys: Object.keys(po) }))
    await assert('✗ probe: 同键双票不丢（普通 5 与拉取请求 5 各记一票）', ('5\0issue' in po) && ('5\0pr' in po) && r.snapshot.deck.stats.total === 5, JSON.stringify(Object.keys(po)))
    // 版号：只改拉取请求字段也换版号；MISSING 变 EMPTY 也换版号；同数据重建版号不变。
    const v1 = r.version
    const rSame = await composer.composeSnapshot('prpool', ref, {}, { force: true })
    await assert('同数据强制重建 → 版号不变（可复现）', rSame.version === v1, `v1=${v1} again=${rSame.version}`)
    prData.find((t) => t.title === 'PR6').mergedAt = '2024-03-01T00:00:00Z'
    const rMerged = await composer.composeSnapshot('prpool', ref, {}, { force: true })
    await assert('✗ probe: 只改合并时间 → 版号变化（不 served 陈旧 304）', rMerged.version !== v1, `v1=${v1} merged=${rMerged.version}`)
    prData.find((t) => t.title === 'Legacy8').isPullRequest = false
    const rMissing = await composer.composeSnapshot('prpool', ref, {}, { force: true })
    await assert('✗ probe: MISSING 变 EMPTY（false）→ 版号变化', rMissing.version !== rMerged.version, `merged=${rMerged.version} missing=${rMissing.version}`)
  }

  // ── 缓存键按后端加仓库键隔离 + LRU20 逐出（#505 键策略）──
  {
    let listCalls = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    const mkBackend = () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } })
    registry.register({ id: 'ka', label: 'ka', create: mkBackend, matches: async () => true })
    registry.register({ id: 'kb', label: 'kb', create: mkBackend, matches: async () => true })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    await composer.composeSnapshot('ka', ref, {})
    await composer.composeSnapshot('kb', ref, {})
    await assert('同仓库键不同后端 → 各建各的缓存（list 调两次）', listCalls === 2, `listCalls=${listCalls}`)
    for (let i = 0; i < 21; i++) await composer.composeSnapshot('ka', { backend: 'ka', refId: 'repo-' + i, name: 'R' + i, url: '' }, {})
    const before = listCalls
    await composer.composeSnapshot('ka', { backend: 'ka', refId: 'repo-0', name: 'R0', url: '' }, {})
    await assert('✗ probe: LRU20 逐出最早的仓库（第 21 个挤掉第 1 个 → 重新 list）', listCalls === before + 1, `listCalls=${listCalls} before=${before}`)
    const warm = await composer.composeSnapshot('ka', { backend: 'ka', refId: 'repo-20', name: 'R20', url: '' }, {})
    await assert('LRU 内仍热 → 不重新 list', listCalls === before + 1 && warm.cached === true, `listCalls=${listCalls}`)
  }

  // ── 命中刷新 LRU 顺序（#505 小修：命中调 touch 刷新顺序，否则退化成先进先出）──
  {
    let listCalls = 0
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({ id: 'lruref', label: 'lruref', create: () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } }), matches: async () => true })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    const R = (i) => ({ backend: 'lruref', refId: 'lru-' + i, name: 'L' + i, url: '' })
    for (let i = 0; i < 20; i++) await composer.composeSnapshot('lruref', R(i), {})
    await composer.composeSnapshot('lruref', R(0), {}) // 命中 lru-0 → 刷新为最新
    await composer.composeSnapshot('lruref', R(20), {}) // 挤掉最久未用的 lru-1，而不是刚命中的 lru-0
    const before = listCalls
    const hit0 = await composer.composeSnapshot('lruref', R(0), {})
    await assert('✗ probe: 命中刷新顺序（刚命中的 lru-0 不被逐出）', listCalls === before && hit0.cached === true, `listCalls=${listCalls} before=${before}`)
    await composer.composeSnapshot('lruref', R(1), {})
    await assert('✗ probe: 最久未用被逐出（未命中的 lru-1 重新 list）', listCalls === before + 1, `listCalls=${listCalls} before=${before}`)
  }

  // ── false 与 MISSING 不再混同（#505 小修三态：同键 false 已挂载不吞 MISSING 孤儿）──
  {
    const base = (o) => Object.assign({ type: 'issue', title: 'T', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' }, o)
    const mixed = [
      base({ key: 'm1', type: 'map', title: 'M' }),
      base({ key: '9', title: 'Issue9', parentKey: 'm1', isPullRequest: false }),
      base({ key: '9', title: 'Legacy9' }), // MISSING：三字段全省略
    ]
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'fmpool', label: 'fmpool',
      create: () => ({ list: async () => ({ ok: true, data: mixed }) }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    const r = await composer.composeSnapshot('fmpool', ref, {})
    await assert('✗ probe: false 与 MISSING 同键各算各的（孤儿不被吞）', r.ok === true && r.snapshot.issues.some((x) => x.title === 'Legacy9') && r.snapshot.deck.stats.total === 2, JSON.stringify({ issues: r.snapshot.issues.map((x) => x.title), total: r.snapshot.deck && r.snapshot.deck.stats.total }))
  }

  // ── 组装器房内日志（#505：未命中记常驻原因枚举；命中记按需，关开关不记、开着百分之一采样）──
  {
    const fires = []
    const mkLog = (debugOn) => ({ fire(level, event, fields) { fires.push({ level, event, fields: (typeof fields === 'function') ? fields() : fields }) }, isEnabled(level) { return level === 'info' || (level === 'debug' && debugOn) } })
    const registry = createRegistry({}, { matchesTimeout: 50 })
    registry.register({
      id: 'prlog', label: 'prlog',
      create: () => ({ list: async () => ({ ok: true, data: ALL }) }),
      matches: async () => true,
    })
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000, logCtx: mkLog(true) })
    await composer.composeSnapshot('prlog', ref, {})
    const missEmpty = fires.find((f) => f.event === 'snapshot.cache.miss')
    await assert('未命中记常驻（首建原因记 empty，只记原因枚举）', missEmpty && missEmpty.level === 'info' && missEmpty.fields && missEmpty.fields.reason === 'empty' && Object.keys(missEmpty.fields).join(',') === 'reason', JSON.stringify(missEmpty))
    fires.length = 0
    await composer.composeSnapshot('prlog', ref, {}, { force: true })
    const missForce = fires.find((f) => f.event === 'snapshot.cache.miss')
    await assert('强制重建记未命中原因 force', missForce && missForce.fields && missForce.fields.reason === 'force', JSON.stringify(missForce))
    fires.length = 0
    for (let i = 0; i < 150; i++) await composer.composeSnapshot('prlog', ref, {})
    const hits = fires.filter((f) => f.event === 'snapshot.cache.hit')
    await assert('命中记按需（开着百分之一采样：150 次命中记 1 次，只记 kind 与 ageMs）', hits.length === 1 && hits[0].level === 'debug' && hits[0].fields && hits[0].fields.kind === 'snapshot-lru' && typeof hits[0].fields.ageMs === 'number' && Object.keys(hits[0].fields).sort().join(',') === 'ageMs,kind', JSON.stringify(hits))
    const composerOff = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000, logCtx: mkLog(false) })
    fires.length = 0
    await composerOff.composeSnapshot('prlog', ref, {})
    for (let i = 0; i < 150; i++) await composerOff.composeSnapshot('prlog', ref, {})
    const hitsOff = fires.filter((f) => f.event === 'snapshot.cache.hit')
    const missOff = fires.filter((f) => f.event === 'snapshot.cache.miss')
    await assert('✗ probe: 关调试开关 → 按需命中零记录，常驻未命中照记', hitsOff.length === 0 && missOff.length === 1 && missOff[0].fields.reason === 'empty', `hits=${hitsOff.length} miss=${JSON.stringify(missOff)}`)
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
