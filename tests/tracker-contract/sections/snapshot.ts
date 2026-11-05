// tests/tracker-contract/sections/snapshot.ts —— 快照拼装分区（原 snapshot.js）。
//
// 守的东西（#132 Q2=B）：composeSnapshot 非 op（纯 list 组合 + deck 派生）；快照缓存
// （TTL 可配）+ 依赖边 LRU 只缓存边数据；unsupported 不缓存；#1796 起首屏一律经
// list({state:'open'}) 取开放工作集（后端可选快路径整条不走），再并上开放地图子票与
// 已关闭地图容器行；map 正文五区块解析；拉取请求同池（#505 落 #294 形状 A）。#1887 起六个数字
// 不再由编排层写（由快照库一次查询算、电话层挂上），编排层只写 deck.partial（这份行数据全不全）。
//
// 类型说明：
// - 拼装器来自没类型的旧文件（allowJs 只保证引入得到，不做类型检查），
//   它的选项与返回在用到的地方是弱类型——传参按 JSDoc 形状传，读数不断言；
// - 注册表与 OPERATIONS 来自已转成 TS 的源文件，是强类型：
//   假后端模块统一按 `as unknown as BackendModule` 断言（契约分区同款做法），
//   因为它们故意返回坏形状（unsupported 桩、缺数字的 counts），本来就是要被逮住的反例。
import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../../../src/tracker/registry/core.js'
import { createSnapshotComposer } from '../../../src/host/tracker/snapshot.js'
import { OPERATIONS } from '../../../src/tracker/contract/index.ts'
import { countMarkerLines, markerKindInHeader } from '../../../src/shared/issue-file/src/marker.ts'
import type { BackendModule } from '../../../src/tracker/contract/backend-module.ts'
import type { BackendContext } from '../../../src/tracker/contract/contexts.ts'
import type { Issue } from '../../../src/tracker/contract/entities.ts'
import type { Snapshot, DeckProjection } from '../../../src/shared/tracker/shape.js'

/** 单条快照断言的结果：ok 为判定，detail 留现场。 */
export interface SnapshotSectionResult {
  name: string
  ok: boolean
  detail: string
}

/**
 * 拼装成功包：拼装器的 JSDoc 只写了 {ok, snapshot, version, cached}，
 * 运行时带版号对上时的 304 那条还多带 notModified（见 snapshot.js:299），这里一并写上。
 * deck 在运行时带 partial（#1887 起编排层不再写 counts / countsPending / missingOpen；
 * 六个数字由电话层从快照库挂上），共享形状的 DeckProjection 没跟上，这里按运行时补——不改源形状，本分区自用。
 * 本分区每个用例都先断言成功再读数，读版/读缓存/读 304 标记/读数字都走这个形状，一处一断言。
 */
interface ComposeSuccess {
  ok: true
  snapshot: Snapshot & {
    deck: DeckProjection & {
      counts?: { open: number; closed: number; total: number }
      partial?: boolean
      missingOpen?: number
    }
  }
  version: string
  cached?: boolean
  notModified?: unknown
}

/** 依赖边成功包：ok 时读 data 与 cached。 */
interface DependencySuccess {
  ok: true
  data: unknown
  cached?: boolean
}

/**
 * 快照里的地图节点：运行时是“整张 Issue（带 key）加解析出的正文区块”
 *（见 src/host/tracker/snapshot.js 的 assembleSnapshot），
 * 但共享形状的 MapNode 只写了 tickets。这里按运行时补全，
 * 有 key 才能 find，有区块字段才能断言 map 正文那两条回归。
 */
interface SnapshotMapNode extends Issue {
  tickets: Issue[]
  destination: string
  notes: string
  decisions: Array<{ title: string; url: string }>
  fog: string[]
  outOfScope: string[]
}

/**
 * 票池半成品：测试造票只写差异字段，缺的由 base 补齐。
 * 拉取请求三字段全可选——Legacy8 那张票故意三个都不写（MISSING），这是要守的口径，
 * 不是漏写；类型上可选才能把“省略”与“写 false/空”区分开。
 */
interface PoolTicket {
  key?: string
  type: string
  title: string
  state: string
  body: string
  url: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  parentKey: string | null
  labels: string[]
  assignees: string[]
  blockedBy: string[]
  comments: unknown[]
  reason: string
  isPullRequest?: boolean
  mergedAt?: string | null
  reviews?: unknown[]
}

// #1299 T8：规格票面样本的七节正文（与设计文档 #1277 第 6 节一致）。
const SPEC_SAMPLE_HEADINGS = ['问题陈述', '解决方案', '用户故事', '实现决策', '测试决策', '不在范围内', '补充说明']

/**
 * 规格票面样本的判据（#1299 T8）：一份合规的规格票面必须同时满足这几条硬形状；
 * 返回空数组表示全过，否则逐条点名违规码。门禁拿它同时验「合规样本通过」与「违规样本被抓到」。
 *
 * 这七条不是又发明一套判据：标记位置、单例、不再写类型行、规格不能有父票、标签集合，
 * 分别对应 ADR 2.1 / 2.5 与 #1277 第 2 节的约定；七节正文对应规格容器的正文形状。
 * 规格从 #1403 起与探索地图同级、是顶层容器，所以判据从「父注释必须指向探索地图 00」
 * 反过来变成「文件头不允许出现任何父注释」。
 */
function specSampleViolations(text: unknown): string[] {
  const raw = typeof text === 'string' ? text : ''
  const bad: string[] = []
  if (markerKindInHeader(raw) !== 'spec') bad.push('marker-not-in-header')
  if (countMarkerLines(raw) !== 1) bad.push('marker-count')
  if (/^\s*Type\s*[:：]\s*spec\s*$/im.test(raw)) bad.push('type-spec-line')
  if (/<!--\s*parentKey:/.test(raw)) bad.push('spec-has-parent')
  const labelsLine = (raw.split(/\r?\n/).filter((line) => /^Labels\s*[:：]/.test(line.trim()))[0] || '').trim()
  if (labelsLine.indexOf('ready-for-agent') < 0) bad.push('labels-not-ready')
  if (/wayfinder:/i.test(labelsLine)) bad.push('wayfinder-label')
  if (!SPEC_SAMPLE_HEADINGS.every((heading) => raw.indexOf('## ' + heading) >= 0)) bad.push('sections-missing')
  return bad
}

// 注册表要一个进程级上下文，测试桩传空对象：运行时不读它，类型上断言一次。
const emptyCtx = {} as unknown as BackendContext

export async function run() {
  const out: SnapshotSectionResult[] = []
  const P = 'snapshot · '
  const assert = async (name: string, cond: unknown, detail?: string): Promise<void> => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String(e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  // base 只做一件事：给半成品测试票补上通用默认字段。入参是差异字段，调用处只传要变的。
  const base = (o: Partial<PoolTicket>): PoolTicket => Object.assign(
    {
      type: 'issue', title: 'T', state: 'open', body: '', url: '',
      createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
      labels: [], assignees: [], blockedBy: [], comments: [], reason: ''
    },
    o
  )

  const ref = { backend: 'fake', refId: 'r1', name: 'R1', url: '' }
  const refU = { backend: 'unsup', refId: 'r2', name: 'R2', url: '' }

  const ALL = [
    { key: 'm1', type: 'map', title: 'M', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: null, labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
    { key: 't1', type: 'issue', title: 'T1', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: 'm1', labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
    { key: 'o1', type: 'issue', title: 'O1', state: 'open', body: '', url: '', createdAt: '', updatedAt: '', closedAt: null, parentKey: 'ghost-map', labels: [], assignees: [], blockedBy: [], comments: [], reason: '' },
  ]

  // ── 组装 / 非 op / deck 派生 ──
  {
    let listCalls = 0
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'fake', label: 'fake',
      // 快照桩只用来组装快照，不断言额度，所以按离网口径声明（注册表只验形状，不按口径限流）。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const res = await composer.composeSnapshot('fake', ref, { cwd: '/w' }) as ComposeSuccess
    // detail 原来是 `res && res.error`：成功时 res.error 是 undefined，JSON 化后还是 undefined，
    // 断言行不打印现场。这里保留这个语义（成功不打印）：res 已按成功形收窄，error 字段类型上没有，
    // 只在运行时万一失败时才读得到，所以这里按“可能有 error”读一次，与原来逐字一致。
    await assert('compose 成功且出 deck', res.ok === true && res.snapshot && res.snapshot.deck && typeof res.snapshot.deck.stats === 'object', JSON.stringify((res as unknown as { error?: unknown }).error))
    const snap = res.snapshot
    // 地图节点运行时带 key 与正文区块，共享形状只写了 tickets，这里按运行时收窄一次。
    const snapMaps = snap.maps as SnapshotMapNode[]
    await assert('repository 回填 ref', snap.repository === ref)
    await assert('maps 挂一层 tickets', snapMaps.length === 1 && snapMaps[0].key === 'm1' && snapMaps[0].tickets.length === 1 && snapMaps[0].tickets[0].key === 't1')
    await assert('孤儿（破链）归 issues', snap.issues.some((i) => i.key === 'o1'))
    await assert('deck 覆盖全量（map.tickets + orphan；map 节点是容器不重复计数）',
      snap.deck.stats.total === 2 && snap.deck.stats.levels && snap.deck.progressOf.t1 === null && 'm1' in snap.deck.progressOf,
      JSON.stringify(snap.deck.stats))
    // 注册表 get 回来可能是空（没注册这个 id），这里感叹号：本文件现造现用的假注册表，
    // fake 是同一段刚注册进去的，取不到只可能是测试自己写错了。
    await assert('composeSnapshot 非 op：OPERATIONS 不含 snapshot', !OPERATIONS.includes('snapshot') && !('snapshot' in registry.get('fake')!))
  }

  // ── 规格容器与实施票（#1277）：三层快照 + 视图兜底 ──
  {
    // 地图 m1 与规格 s1 都是顶层容器（规格不挂父票），s1 下挂实施票 t2；
    // p1 是普通票；s2 的契约类型是 issue、但票面文件头有规格标记 —— B 兜底要把它判成规格容器，
    // 并把挂在它下面的 t3 一起收进容器，而不是漏成两张普通票。
    const rows = [
      base({ key: 'm1', type: 'map', title: 'M' }),
      base({ key: 's1', type: 'spec', title: 'S', parentKey: null, body: '## 问题陈述\n问题\n\n## 解决方案\n方案\n\n## 用户故事\n- 故事\n\n## 实现决策\n决策\n\n## 测试决策\n测试\n\n## 不在范围内\n范围\n\n## 补充说明\n补充\n' }),
      base({ key: 't2', type: 'issue', title: 'T2', parentKey: 's1', body: '**要构建什么：** 做一件事\n' }),
      base({ key: 'p1', type: 'issue', title: 'P1' }),
      base({ key: 's2', type: 'issue', title: 'S2', body: '<!-- DSH-ISSUE-KIND: spec -->\n\n## 问题陈述\n问题\n' }),
      base({ key: 't3', type: 'issue', title: 'T3', parentKey: 's2' }),
      // 违规样本：标记写在标题之后不算文件头（ADR 2.5 的位置约定）——这一行必须留在普通票池里。
      base({ key: 's3', type: 'issue', title: 'S3', body: '# 标题\n\n<!-- DSH-ISSUE-KIND: spec -->\n\n## 问题陈述\n问题\n' }),
    ]
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'fake', label: 'fake',
      // 快照桩只用来组装快照，不断言额度，所以按离网口径声明（注册表只验形状，不按口径限流）。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => ({ ok: true, data: rows }) }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const res = await composer.composeSnapshot('fake', ref, {}) as ComposeSuccess
    const snap = res.snapshot
    const maps = snap.maps as SnapshotMapNode[]
    const byKey = (k: string): SnapshotMapNode => maps.filter((m) => m.key === k)[0]
    await assert('规格作为容器进 maps、与地图同数组靠 type 分辨（实得 ' + JSON.stringify(maps.map((m) => m.key + ':' + m.type)) + '）',
      maps.length === 3 && !!byKey('s1') && byKey('s1').type === 'spec' && !!byKey('m1') && byKey('m1').type === 'map')
    await assert('两层挂载：规格下挂实施票，地图下不再挂规格',
      !byKey('m1').tickets.some((t) => t.key === 's1') && byKey('s1').tickets.length === 1 && byKey('s1').tickets[0].key === 't2')
    await assert('视图兜底：契约类型是 issue、票面文件头有规格标记的行判成规格容器', !!byKey('s2') && byKey('s2').type === 'spec')
    await assert('违规样本：标记写在标题之后不算文件头，仍留在普通票池', !byKey('s3') && snap.issues.some((i) => i.key === 's3' && i.type === 'issue'))
    await assert('实施票与规格都不进普通票池', !snap.issues.some((i) => i.key === 's1' || i.key === 's2' || i.key === 't2' || i.key === 't3'))
    await assert('deck 覆盖全量：两个顶层容器下的实施票 + 普通票（容器节点不重复计数）',
      snap.deck.stats.total === 4, JSON.stringify(snap.deck.stats))
    const sections = (byKey('s1') as unknown as { sections?: Record<string, unknown> }).sections
    const SPEC_KEYS = ['problem', 'solution', 'userStories', 'implDecisions', 'testDecisions', 'outOfScope', 'furtherNotes']
    await assert('规格填七段 sections、不混进地图五槽',
      !!sections && SPEC_KEYS.every((k) => k in sections) && !('destination' in sections) && !('fog' in sections),
      JSON.stringify(sections))

    // #1299 T8：tests/tracker-contract/ 下的 spec 合规 / 违规样本必须落盘，门禁要同时「通过合规、抓到违规」。
    const sampleDir = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
    const readSample = (name: string): string => {
      try { return nodeFs.readFileSync(nodePath.join(sampleDir, name), 'utf8') } catch (e) { return '' }
    }
    const specOkText = readSample('spec-合规.md')
    const specBadText = readSample('spec-违规.md')
    const okCodes = specSampleViolations(specOkText)
    await assert('spec 合规样本落盘且七条形状全过', specOkText.length > 0 && okCodes.length === 0, JSON.stringify(okCodes))
    const badCodes = specSampleViolations(specBadText)
    const badExpected = ['marker-not-in-header', 'marker-count', 'type-spec-line', 'spec-has-parent', 'wayfinder-label', 'sections-missing']
    await assert('spec 违规样本逐条被抓到（预期至少含 ' + badExpected.join('、') + '）',
      specBadText.length > 0 && badExpected.every((code) => badCodes.indexOf(code) >= 0), JSON.stringify(badCodes))
    // 再把两份样本原样当「契约类型没标对的票面」喂给拼装器：合规的进容器、违规的留普通票池。
    const sampleRows = [
      base({ key: 'm1', type: 'map', title: 'M' }),
      base({ key: 'k1', type: 'issue', title: '合规样本', parentKey: null, body: specOkText }),
      base({ key: 'k2', type: 'issue', title: '违规样本', parentKey: 'm1', body: specBadText }),
    ]
    const sampleRegistry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    sampleRegistry.register({
      id: 'fake', label: 'fake',
      // 快照桩只用来组装快照，不断言额度，所以按离网口径声明（注册表只验形状，不按口径限流）。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => ({ ok: true, data: sampleRows }) }),
      matches: async () => true,
    } as unknown as BackendModule)
    const sampleComposer = createSnapshotComposer(sampleRegistry, { snapshotTtl: 50, depsTtl: 50 })
    const sampleRes = await sampleComposer.composeSnapshot('fake', ref, {}) as ComposeSuccess
    const sampleMaps = sampleRes.snapshot.maps as SnapshotMapNode[]
    await assert('spec 合规样本当容器收进快照（契约类型是 issue、文件头标记兜底成规格）',
      sampleRes.ok === true && sampleMaps.some((m) => m.key === 'k1' && m.type === 'spec'))
    // 违规样本挂在 m1 下面，会作为 m1 的子票挂上去（快照的普通票池只放没挂容器的票）；
    // 这里要断言的是「它没有被兜底成规格容器」，所以三处都查：不进 maps、挂在 m1 下、行类型仍是 issue。
    const k2AsMap = sampleMaps.filter((m) => m.key === 'k2')[0]
    const m1Node = sampleMaps.filter((m) => m.key === 'm1')[0]
    const m1Tickets = (m1Node && (m1Node as unknown as { tickets?: Array<Record<string, unknown>> }).tickets) || []
    const k2Ticket = m1Tickets.filter((t) => String(t.key) === 'k2')[0] || null
    const k2InIssues = sampleRes.snapshot.issues.filter((i) => i.key === 'k2')[0] || null
    const k2Kind = String((k2Ticket && k2Ticket.type) || (k2InIssues && k2InIssues.type) || '')
    await assert('spec 违规样本不兜底成规格（没进容器，挂在 m1 下仍是普通票）',
      !k2AsMap && !!k2Ticket && k2Kind === 'issue', JSON.stringify({ k2AsMap: !!k2AsMap, k2Ticket: !!k2Ticket, k2Kind: k2Kind }))
  }

  // ── 快照缓存：TTL / force / invalidate / clear ──
  {
    let listCalls = 0
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'fake', label: 'fake',
      // 快照桩只用来组装快照，不断言额度，所以按离网口径声明（注册表只验形状，不按口径限流）。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    await composer.composeSnapshot('fake', ref, {})
    const c2 = await composer.composeSnapshot('fake', ref, {}) as ComposeSuccess
    await assert('命中快照缓存（list 只调一次）', listCalls === 1 && c2.cached === true, `listCalls=${listCalls}`)
    await composer.composeSnapshot('fake', ref, {}, { force: true })
    await assert('force 绕过缓存 → 重新 list', listCalls === 2, `listCalls=${listCalls}`)
    const last = await composer.composeSnapshot('fake', ref, {}) as ComposeSuccess
    await assert('force 后缓存已刷新', last.cached === true && listCalls === 2)
    composer.invalidateSnapshot('fake', ref)
    await composer.composeSnapshot('fake', ref, {})
    await assert('invalidateSnapshot → 重新 list', listCalls === 3, `listCalls=${listCalls}`)
    composer.clear()
    await composer.composeSnapshot('fake', ref, {})
    await assert('clear → 重新 list', listCalls === 4, `listCalls=${listCalls}`)
    // TTL 这一段用可控时钟，不再靠「睡 10 毫秒 + 1 毫秒 TTL」去赌机器快慢：
    //   旧写法里最后那次「刚写进缓存就该命中」的断言只留了 1 毫秒的窗口，机器一忙就红；
    //   它一红 tests/verify-tracker-contract.js 就以 CONTRACT SKELETON NOT SELF-CONSISTENT 截断整条
    //   npm run verify 链，看起来像大面积回归（历史全量日志里 40 次出现过 2 次）。
    //   缓存过不过期只该由「时钟走了多久」决定，所以这里把 Date.now 换成可控值：
    //   过期确定发生、命中确定发生，两条断言的强度一点都不减。
    const realNow = Date.now
    let fakeNow = realNow()
    Date.now = () => fakeNow
    try {
      const exp = createSnapshotComposer(registry, { snapshotTtl: 1000, depsTtl: 1000 })
      await exp.composeSnapshot('fake', ref, {})
      fakeNow += 5000 // 时钟往前推 5 秒：缓存确定过期（不看机器忙不忙）
      await exp.composeSnapshot('fake', ref, {})
      await assert('✗ probe: TTL 过期 → 重新 list（不 Serve 陈旧）', listCalls === 6, `listCalls=${listCalls}`)
      const stale = await exp.composeSnapshot('fake', ref, {}) as ComposeSuccess
      await assert('TTL 过期后已重新缓存', stale.cached === true)
    } finally {
      Date.now = realNow
    }
  }

  // ── 依赖 LRU：只缓存边数据 ──
  {
    let depCalls = 0
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'fake', label: 'fake',
      // 快照桩只用来组装快照，不断言额度，所以按离网口径声明（注册表只验形状，不按口径限流）。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({
        list: async () => ({ ok: true, data: ALL }),
        getDependencies: async () => { depCalls++; return { ok: true, data: { blockedBy: [], blocking: [] } } },
      }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const d1 = await composer.getDependencies('fake', ref, 't1', {}) as DependencySuccess
    const d2 = await composer.getDependencies('fake', ref, 't1', {}) as DependencySuccess
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
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'unsup', label: 'unsup',
      // 这个桩只用来复现不支持的操作不缓存，不断言额度，所以按离网口径声明。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({
        getDependencies: async () => { unsupCalls++; return { ok: false, error: { kind: 'unsupported', message: 'no graph' } } },
      }),
      matches: async () => false,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    await composer.getDependencies('unsup', refU, 'x', {})
    await composer.getDependencies('unsup', refU, 'x', {})
    await assert('✗ probe: unsupported 每调必达 op（不缓存）', unsupCalls === 2, `unsupCalls=${unsupCalls}`)
  }

  // ── #1796 首屏不走后端快路径：一律经 list({state:'open'}) 取开放工作集 ──
  // 为什么：可选快路径只回「完整数组」，表达不了「只要未关闭」；开放票与已关闭历史挤同一个
  // 500 条窗口正是 #1796 的根因。所以哪怕后端提供了 snapshotFast，首屏也不走它。
  {
    let listCalls = 0
    let fastUsed = 0
    let lastFilter: any = null
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'fast', label: 'fast',
      // 这个桩只用来复现「快路径不再被调用」，不断言额度，所以按离网口径声明。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({
        list: async (_ref: any, filter: any) => { listCalls++; lastFilter = filter; return { ok: true, data: ALL } },
        snapshotFast: async () => { fastUsed++; return { ok: true, data: ALL } },
      }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const r1 = await composer.composeSnapshot('fast', ref, {}) as ComposeSuccess
    await assert('#1796 后端有快路径也不走：首屏走 list 取开放工作集', r1.ok === true && fastUsed === 0 && listCalls === 1 && r1.snapshot.deck.stats.total === 2,
      `fastUsed=${fastUsed} listCalls=${listCalls}`)
    await assert("#1796 首屏 list 下推状态筛选（filter.state === 'open'）", !!lastFilter && lastFilter.state === 'open', JSON.stringify(lastFilter))
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
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'mapbody', label: 'mapbody',
      // 这个桩只用来复现正文区块解析，不断言额度，所以按离网口径声明。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => ({ ok: true, data: MAP_BODY }) }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 50, depsTtl: 50 })
    const r = await composer.composeSnapshot('mapbody', ref, {}) as ComposeSuccess
    const bodyMaps = r.snapshot.maps as SnapshotMapNode[]
    const m1 = bodyMaps.find((x) => x.key === 'm1')
    const m2 = bodyMaps.find((x) => x.key === 'm2')
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
    const prData = [
      base({ key: 'm1', type: 'map', title: 'M' }),
      base({ key: '5', title: 'Issue5', parentKey: 'm1', isPullRequest: false, mergedAt: null, reviews: [] }),
      base({ key: '6', title: 'PR6', parentKey: 'm1', isPullRequest: true, mergedAt: null, reviews: [{ state: 'approved', reviewer: { login: 'r1' }, submittedAt: '2024-01-03T00:00:00Z' }] }),
      base({ key: '5', title: 'PR5-orphan', isPullRequest: true, mergedAt: null, reviews: [] }),
      base({ key: '7', title: 'PR7-orphan', isPullRequest: true, mergedAt: '2024-02-01T00:00:00Z', reviews: [] }),
      base({ key: '8', title: 'Legacy8' }), // 无拉取请求能力的后端：三字段全省略（MISSING）
    ]
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'prpool', label: 'prpool',
      // 这个桩只用来复现工单与拉取请求同池，不断言额度，所以按离网口径声明。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => ({ ok: true, data: prData }) }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    const r = await composer.composeSnapshot('prpool', ref, {}) as ComposeSuccess
    const prMaps = r.snapshot.maps as SnapshotMapNode[]
    const m1 = prMaps.find((x) => x.key === 'm1')
    await assert('同池 tickets：普通工单与拉取请求同挂一图', r.ok === true && m1 && m1.tickets.length === 2 && m1.tickets.some((t) => t.isPullRequest === false) && m1.tickets.some((t) => t.isPullRequest === true), JSON.stringify(m1 && m1.tickets.map((t) => ({ key: t.key, title: t.title, isPullRequest: t.isPullRequest }))))
    const orphans = r.snapshot.issues
    await assert('✗ probe: 同号异类不互吞（已挂载工单 5 不吞掉孤儿拉取请求 5）', orphans.length === 3 && orphans.some((t) => t.title === 'PR5-orphan' && t.isPullRequest === true) && orphans.some((t) => t.key === '7') && orphans.some((t) => t.key === '8'), JSON.stringify(orphans.map((t) => t.title)))
    const pr6 = m1!.tickets.find((t) => t.key === '6')
    const legacy8 = orphans.find((t) => t.key === '8')
    const issue5 = m1!.tickets.find((t) => t.title === 'Issue5')
    // 感叹号都是编译期收窄、运行时擦除：找的键/标题是同一文件上面的字面量，不可能找不到；
    // 万一找不到，擦除后与原来一样抛 TypeError，门禁记 section-crash，行为逐字一致。
    await assert('EMPTY-MISSING 口径：有字段原样带、无字段保持省略', pr6 && Array.isArray(pr6.reviews) && pr6.reviews.length === 1 && pr6.reviews[0].reviewer!.login === 'r1' && Array.isArray(issue5!.reviews) && issue5!.reviews.length === 0 && !Object.prototype.hasOwnProperty.call(legacy8!, 'isPullRequest') && !Object.prototype.hasOwnProperty.call(legacy8!, 'mergedAt') && !Object.prototype.hasOwnProperty.call(legacy8!, 'reviews'), JSON.stringify({ pr6reviews: pr6 && pr6.reviews, legacyKeys: legacy8 && Object.keys(legacy8) }))
    const po = (r.snapshot.deck && r.snapshot.deck.progressOf) || {}
    await assert('牌面派生覆盖拉取请求（池内身份全覆盖，不丢任一）', r.snapshot.deck && ('6\0pr' in po) && ('7\0pr' in po) && ('8' in po) && r.snapshot.deck.stats.total === 5, JSON.stringify(r.snapshot.deck && { total: r.snapshot.deck.stats.total, keys: Object.keys(po) }))
    await assert('✗ probe: 同键双票不丢（普通 5 与拉取请求 5 各记一票）', ('5\0issue' in po) && ('5\0pr' in po) && r.snapshot.deck.stats.total === 5, JSON.stringify(Object.keys(po)))
    // 版号：只改拉取请求字段也换版号；MISSING 变 EMPTY 也换版号；同数据重建版号不变。
    const v1 = r.version
    const rSame = await composer.composeSnapshot('prpool', ref, {}, { force: true }) as ComposeSuccess
    await assert('同数据强制重建 → 版号不变（可复现）', rSame.version === v1, `v1=${v1} again=${rSame.version}`)
    // find 后面跟感叹号：要找的标题是同一文件上面字面量写死的，不可能找不到；
    // 不加的话类型是“可能为空”，后面赋值编译不过，运行时其实一定有值。
    prData.find((t) => t.title === 'PR6')!.mergedAt = '2024-03-01T00:00:00Z'
    const rMerged = await composer.composeSnapshot('prpool', ref, {}, { force: true }) as ComposeSuccess
    await assert('✗ probe: 只改合并时间 → 版号变化（不 served 陈旧 304）', rMerged.version !== v1, `v1=${v1} merged=${rMerged.version}`)
    prData.find((t) => t.title === 'Legacy8')!.isPullRequest = false
    const rMissing = await composer.composeSnapshot('prpool', ref, {}, { force: true }) as ComposeSuccess
    await assert('✗ probe: MISSING 变 EMPTY（false）→ 版号变化', rMissing.version !== rMerged.version, `merged=${rMerged.version} missing=${rMissing.version}`)
  }

  // ── 缓存键按后端加仓库键隔离 + LRU20 逐出（#505 键策略）──
  {
    let listCalls = 0
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    const mkBackend = () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } })
    // 这两个桩只用来复现缓存按后端隔离，不断言额度，所以按离网口径声明。
    registry.register({ id: 'ka', label: 'ka', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: mkBackend, matches: async () => true } as unknown as BackendModule)
    registry.register({ id: 'kb', label: 'kb', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: mkBackend, matches: async () => true } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    await composer.composeSnapshot('ka', ref, {})
    await composer.composeSnapshot('kb', ref, {})
    await assert('同仓库键不同后端 → 各建各的缓存（list 调两次）', listCalls === 2, `listCalls=${listCalls}`)
    for (let i = 0; i < 21; i++) await composer.composeSnapshot('ka', { backend: 'ka', refId: 'repo-' + i, name: 'R' + i, url: '' }, {})
    const before = listCalls
    await composer.composeSnapshot('ka', { backend: 'ka', refId: 'repo-0', name: 'R0', url: '' }, {})
    await assert('✗ probe: LRU20 逐出最早的仓库（第 21 个挤掉第 1 个 → 重新 list）', listCalls === before + 1, `listCalls=${listCalls} before=${before}`)
    const warm = await composer.composeSnapshot('ka', { backend: 'ka', refId: 'repo-20', name: 'R20', url: '' }, {}) as ComposeSuccess
    await assert('LRU 内仍热 → 不重新 list', listCalls === before + 1 && warm.cached === true, `listCalls=${listCalls}`)
  }

  // ── 命中刷新 LRU 顺序（#505 小修：命中调 touch 刷新顺序，否则退化成先进先出）──
  {
    let listCalls = 0
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    // 这个桩只用来复现命中刷新顺序，不断言额度，所以按离网口径声明。
    registry.register({ id: 'lruref', label: 'lruref', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ list: async () => { listCalls++; return { ok: true, data: ALL } } }), matches: async () => true } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    const R = (i: number) => ({ backend: 'lruref', refId: 'lru-' + i, name: 'L' + i, url: '' })
    for (let i = 0; i < 20; i++) await composer.composeSnapshot('lruref', R(i), {})
    await composer.composeSnapshot('lruref', R(0), {}) // 命中 lru-0 → 刷新为最新
    await composer.composeSnapshot('lruref', R(20), {}) // 挤掉最久未用的 lru-1，而不是刚命中的 lru-0
    const before = listCalls
    const hit0 = await composer.composeSnapshot('lruref', R(0), {}) as ComposeSuccess
    await assert('✗ probe: 命中刷新顺序（刚命中的 lru-0 不被逐出）', listCalls === before && hit0.cached === true, `listCalls=${listCalls} before=${before}`)
    await composer.composeSnapshot('lruref', R(1), {})
    await assert('✗ probe: 最久未用被逐出（未命中的 lru-1 重新 list）', listCalls === before + 1, `listCalls=${listCalls} before=${before}`)
  }

  // ── false 与 MISSING 不再混同（#505 小修三态：同键 false 已挂载不吞 MISSING 孤儿）──
  {
    const mixed = [
      base({ key: 'm1', type: 'map', title: 'M' }),
      base({ key: '9', title: 'Issue9', parentKey: 'm1', isPullRequest: false }),
      base({ key: '9', title: 'Legacy9' }), // MISSING：三字段全省略
    ]
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'fmpool', label: 'fmpool',
      // 这个桩只用来复现假值与缺失同键各算各的，不断言额度，所以按离网口径声明。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => ({ ok: true, data: mixed }) }),
      matches: async () => true,
    } as unknown as BackendModule)
    const composer = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
    const r = await composer.composeSnapshot('fmpool', ref, {}) as ComposeSuccess
    await assert('✗ probe: false 与 MISSING 同键各算各的（孤儿不被吞）', r.ok === true && r.snapshot.issues.some((x) => x.title === 'Legacy9') && r.snapshot.deck.stats.total === 2, JSON.stringify({ issues: r.snapshot.issues.map((x) => x.title), total: r.snapshot.deck && r.snapshot.deck.stats.total }))
  }

  // ── 组装器房内日志（#505：未命中记常驻原因枚举；命中记按需，关开关不记、开着百分之一采样）──
  {
    const fires: Array<{ level: string; event: string; fields: Record<string, unknown> }> = []
    // 日志收集器：fire 收到的 fields 可能是函数（延迟组装），调用后统一按对象记，
    // 后面断言只读 reason/kind/ageMs 三个键。
    const mkLog = (debugOn: boolean) => ({
      fire(level: string, event: string, fields: Record<string, unknown> | (() => Record<string, unknown>)) {
        fires.push({ level, event, fields: (typeof fields === 'function') ? fields() : fields })
      },
      isEnabled(level: string) { return level === 'info' || (level === 'debug' && debugOn) }
    })
    const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
    registry.register({
      id: 'prlog', label: 'prlog',
      // 这个桩只用来复现组装器日志，不断言额度，所以按离网口径声明。
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({ list: async () => ({ ok: true, data: ALL }) }),
      matches: async () => true,
    } as unknown as BackendModule)
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

  // ── #1887：六个数字由快照库一次查询算，编排层不再向后端要计数 ──
  //   这一段守的是「编排层不造数字」：后端即使实现了 counts，这里也一次都不许调用；
  //   deck.counts 由电话层在库写到最新之后挂上（本分区没有库，所以这一格不该出现）。
  //   partial 只报「这份行数据有没有异常缺失」：列表触上限、REST 降级、开放容器的子票没拉全 / 拉不到。
  //   数字与清单的完整度是两件事：数字走了库那一条路，partial 不再拿后端 open 对账。
  {
    const POOL = [base({ key: '1', title: 'A' }), base({ key: '2', title: 'B', state: 'closed' })]
    let countsCalls = 0
    const mkReg = (listResult: () => any) => {
      const reg = createRegistry(emptyCtx, { matchesTimeout: 50 })
      // counts 故意实现并记一笔：编排层若还问它，下面那条断言当场抓住。
      reg.register({
        id: 'counted', label: 'counted',
        budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
        create: () => ({
          list: async () => listResult(),
          counts: async () => { countsCalls += 1; return { ok: true, data: { open: 999, closed: 999, total: 999 } } },
        }),
        matches: async () => true,
      } as unknown as BackendModule)
      return reg
    }

    // ① 来源完整：后端计数一次都不问，deck 上也没有计数相关的格子
    {
      countsCalls = 0
      const composer = createSnapshotComposer(mkReg(() => ({ ok: true, data: POOL })), { snapshotTtl: 60000, depsTtl: 60000 })
      const r = await composer.composeSnapshot('counted', ref, {}) as ComposeSuccess
      const deck: any = r.snapshot.deck
      await assert('编排层一次都不向后端要计数（后端实现了 counts 也不调用）', r.ok === true && countsCalls === 0, 'countsCalls=' + countsCalls)
      await assert('编排层不往 deck 写 counts（数字由电话层从库挂上）', !!deck && !deck.counts, JSON.stringify(deck && deck.counts))
      await assert('编排层不写 countsPending（「待校准」这一档已退场）', !!deck && !('countsPending' in deck), JSON.stringify(deck && deck.countsPending))
      await assert('编排层不再写 missingOpen（后端计数不参与 partial）', !!deck && !('missingOpen' in deck), JSON.stringify(deck && deck.missingOpen))
      await assert('来源完整时 partial 为假', !!deck && deck.partial === false, JSON.stringify(deck && deck.partial))
      const v1 = r.version
      countsCalls = 0
      const again = await composer.composeSnapshot('counted', ref, {}, { force: true }) as ComposeSuccess
      await assert('同数据重建 → 版号不变，且仍然不问计数', again.version === v1 && countsCalls === 0, 'v1=' + v1 + ' again=' + again.version + ' countsCalls=' + countsCalls)
    }

    // ② 列表触到上限 → partial 真（不靠后端计数判断）
    {
      countsCalls = 0
      const composer = createSnapshotComposer(mkReg(() => ({ ok: true, data: POOL, truncated: true })), { snapshotTtl: 60000, depsTtl: 60000 })
      const r = await composer.composeSnapshot('counted', ref, {}) as ComposeSuccess
      await assert('列表触到上限 → partial 置真（与后端计数无关）', r.snapshot.deck.partial === true && countsCalls === 0,
        JSON.stringify({ partial: r.snapshot.deck.partial, countsCalls }))
    }

    // ③ 这一趟走了 REST 降级 → partial 真
    {
      countsCalls = 0
      const composer = createSnapshotComposer(mkReg(() => ({ ok: true, data: POOL, fallback: 'rest' })), { snapshotTtl: 60000, depsTtl: 60000 })
      const r = await composer.composeSnapshot('counted', ref, {}) as ComposeSuccess
      await assert('这一趟走了 REST 降级 → partial 置真', r.snapshot.deck.partial === true && countsCalls === 0,
        JSON.stringify({ partial: r.snapshot.deck.partial, countsCalls }))
    }

    // ── #1796 首屏工作集：开放池 + 开放容器子票 + 已关闭地图容器行 ──
    //   守的是「首屏装哪些行」：开放工作集由后端先筛状态；开放容器（探索地图与规格）的子票要逐张拉全
    //   （含已关闭），否则地图详情数不清「共 N 张」、做完了的规格也会看着一张子票都没有；
    //   已关闭地图的容器行热启动沿用上一份快照、冷启动补一页薄行。
    {
      const OPEN_MAP = base({ key: '300', type: 'map', title: '开放地图' })
      const OPEN_TICKET = base({ key: '301', title: '开放票', parentKey: '300' })
      const OPEN_SPEC = base({ key: '302', type: 'spec', title: '开放规格' })
      const CLOSED_SUB = base({ key: '202', title: '已关闭子票', state: 'closed', parentKey: '300' })
      const CLOSED_SPEC_TICKET = base({ key: '203', title: '规格下已关闭的实施票', state: 'closed', parentKey: '302' })
      const calls: any = { listFilters: [] as any[], subIssueKeys: [] as any[], pageFilters: [] as any[], pageFails: false, capped: false, failKey: '' }
      const registry = createRegistry(emptyCtx, { matchesTimeout: 50 })
      registry.register({
        id: 'work', label: 'work',
        budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
        create: () => ({
          list: async (_ref: any, filter: any) => { calls.listFilters.push(filter); return { ok: true, data: [OPEN_MAP, OPEN_TICKET, OPEN_SPEC] } },
          listSubIssues: async (_ref: any, key: any) => {
            calls.subIssueKeys.push(key)
            if (calls.failKey && calls.failKey === key) return { ok: false, error: { kind: 'transport', message: 'boom' } }
            const all = key === '300' ? [CLOSED_SUB] : (key === '302' ? [CLOSED_SPEC_TICKET] : [])
            // 撞上限要能传到 partial（#1796 code review：子票装不全是异常缺失，不再只影响回补）。
            const capped = calls.capped && key === '300'
            return { ok: true, data: { items: all, total: all.length + (capped ? 1 : 0), fetched: all.length, capped, missing: capped ? 1 : 0, dropped: 0 } }
          },
          listPage: async (_ref: any, filter: any) => {
            calls.pageFilters.push(filter)
            if (calls.pageFails) return { ok: false, error: { kind: 'transport', message: 'boom' } }
            // 薄行只带列表画一行要的事实；类型由标签认出来（真实 GitHub 后端是 normalizeIssue 按 wayfinder:map 认）。
            const items = [{ number: 200, title: '已关闭地图', state: 'closed', type: 'map', labels: [{ name: 'wayfinder:map', color: '' }] }]
            return { ok: true, data: { items, total: items.length, hasNextPage: false } }
          },
        }),
        matches: async () => true,
      } as unknown as BackendModule)
      const wc = createSnapshotComposer(registry, { snapshotTtl: 60000, depsTtl: 60000 })
      const r = await wc.composeSnapshot('work', ref, {}) as ComposeSuccess
      await assert("#1796 首屏工作集取开放票（list 收到 state === 'open'）",
        r.ok === true && calls.listFilters.length === 1 && !!calls.listFilters[0] && calls.listFilters[0].state === 'open',
        JSON.stringify(calls.listFilters))
      const maps = r.snapshot.maps as SnapshotMapNode[]
      const openMap = maps.filter((m) => String(m.key) === '300')[0]
      await assert('#1796 开放容器的子票拉全（已关闭子票 202 挂回地图 300，且只问过两张开放容器）',
        !!openMap && openMap.tickets.some((t) => String(t.key) === '202') && calls.subIssueKeys.length === 2
          && calls.subIssueKeys.indexOf('300') >= 0 && calls.subIssueKeys.indexOf('302') >= 0,
        JSON.stringify({ tickets: openMap ? openMap.tickets.map((t) => String(t.key)) : null, asked: calls.subIssueKeys }))
      const openSpec: any = maps.filter((m) => String(m.key) === '302')[0]
      await assert('#1796 开放规格容器也拉子票（已关闭实施票 203 挂回规格 302，做完的规格不再显示一张子票都没有）',
        !!openSpec && openSpec.type === 'spec' && openSpec.tickets.some((t) => String(t.key) === '203'),
        JSON.stringify(openSpec && { tickets: openSpec.tickets.map((t) => String(t.key)) }))
      await assert('#1796 来源完整时 partial 为假（子票补齐不虚增开放行数；数字不在这里写）',
        r.snapshot.deck.partial === false && !('counts' in r.snapshot.deck),
        JSON.stringify({ partial: r.snapshot.deck.partial, counts: r.snapshot.deck.counts }))
      const closedContainer: any = maps.filter((m) => String(m.key) === '200')[0]
      await assert('#1796 冷启动补一页已关闭地图容器行（type=map、state=CLOSED、编号 200 在场）',
        !!closedContainer && closedContainer.type === 'map' && String(closedContainer.state).toUpperCase() === 'CLOSED' && closedContainer.number === 200,
        JSON.stringify(closedContainer && { key: closedContainer.key, type: closedContainer.type, state: closedContainer.state, number: closedContainer.number }))
      await assert('#1796 已关闭地图容器行按列表页筛选取（state=closed + wayfinder:map）',
        calls.pageFilters.length === 1 && !!calls.pageFilters[0] && calls.pageFilters[0].state === 'closed'
          && Array.isArray(calls.pageFilters[0].labels) && calls.pageFilters[0].labels[0] === 'wayfinder:map',
        JSON.stringify(calls.pageFilters))
      // 热启动：补页失败时沿用上一份快照里的已关闭容器行，不让列表上的容器行凭空消失。
      calls.pageFails = true
      const r2 = await wc.composeSnapshot('work', ref, {}, { force: true }) as ComposeSuccess
      const maps2 = r2.snapshot.maps as SnapshotMapNode[]
      const kept: any = maps2.filter((m) => String(m.key) === '200')[0]
      await assert('#1796 补页失败时热启动沿用上一份快照的已关闭容器行',
        !!kept && kept.type === 'map' && String(kept.state).toUpperCase() === 'CLOSED',
        JSON.stringify(maps2.map((m) => String(m.key))))
      // #1796 code review：子票撞上限（capped）也算异常缺失 —— 从前只影响回补，橙点不亮。
      calls.capped = true
      const r3 = await wc.composeSnapshot('work', ref, {}, { force: true }) as ComposeSuccess
      await assert('#1796 子票撞到上限时 partial 置真（开放工作集没缺，但子票不全）',
        r3.snapshot.deck.partial === true, JSON.stringify({ partial: r3.snapshot.deck.partial }))
      // #1887：子票拉取硬失败同样是「这份行数据不全」，partial 置真（与计数无关）。
      calls.capped = false
      calls.failKey = '300'
      const r4 = await wc.composeSnapshot('work', ref, {}, { force: true }) as ComposeSuccess
      await assert('#1887 子票拉取失败时 partial 置真（行数据不全，不靠后端计数）',
        r4.snapshot.deck.partial === true, JSON.stringify({ partial: r4.snapshot.deck.partial }))
    }
  }

  // ── 未知后端 ──
  {
    const composer = createSnapshotComposer(createRegistry(emptyCtx, { matchesTimeout: 50 }), {})
    const r = await composer.composeSnapshot('ghost', ref, {})
    // error 在 JSDoc 里只写了 Object，读 kind 要收窄一次；运行时还是同一个对象。
    await assert('未知后端 → ok:false error', r.ok === false && r.error && (r.error as { kind?: unknown }).kind === 'unsupported', JSON.stringify(r))
  }

  return out
}

export default { name: 'snapshot', run }
