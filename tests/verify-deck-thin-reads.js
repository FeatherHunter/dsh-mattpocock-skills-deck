// verify-deck-thin-reads.js —— 门禁：按需取数（blocking=false 与 detail=thin）的诚实
// 用法：在插件根目录执行 node tests/verify-deck-thin-reads.js，可独立运行。
//
// 为什么要这一段：单票读的反向边要扫全仓、快照的全量行带正文进度，回包大、慢、
// 票多时还被截断。按需参数让调用方少拿：blocking=false 跳过反向扫描，
// detail=thin 只要薄行。但三条诚实线一寸不让：
//   ① 缺省全量：不传参就是今天的全量，老调用方形状一字不动；
//   ② 跳过必注记：没取的记空不记 0，正文里不写“0 条”这种假话，注记写清怎么拿全量；
//   ③ 统计不变：thin 只薄行，统计与进度表用全量行算好再薄，数字与 full 一字不差。
// 本文件不联网：后端全是桩，只验“调没调、记没记、数对不对”。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function stubGateLedger(gateMod, ledgerMod) {
  const now = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => now })
  const gate = gateMod.createGate({ ledger: ledger, now: () => now })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: now + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: now + 3600000 } }, now)
  return { gate: gate }
}

function baseDeps(gate, registry, budget, over) {
  return Object.assign({
    gate: gate,
    registry: registry,
    budget: budget,
    estimate: () => ({ points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 60, text: '' }),
    costInputFrom: () => ({ tool: 't' }),
    backendCtx: {},
    handleFor: (s) => ({ cwd: (s && s.cwd) || '' }),
    log: null,
    now: () => Date.now(),
    canonicalKey: async (raw) => raw,
    workspaceKeyOf: () => 'ws-test',
    toolTimeoutMs: 60000,
    toolMarginMs: 5000,
  }, over || {})
}

const execFor = () => ({ agent: { session: { id: 's-thin', cwd: 'D:/demo' } } })
const refOf = { backend: 'stub', refId: 'o/n', name: 'o/n', url: '' }
function stubRegistry(tracker) {
  return {
    select: async () => ({ backendId: 'stub', source: 'explicit', ref: refOf, pending: false }),
    get: () => tracker,
    has: () => true,
    bound: () => 'stub',
    describe: () => refOf,
  }
}

const demoIssue = { key: '7', title: '演练票', state: 'open', type: 'issue', labels: [], assignees: [], updatedAt: '', closedAt: '', url: '', body: '# 演练票\n\n## 进度\n\n- 第一步\n', parentKey: '3', blockedBy: [{ key: '5' }] }

async function main() {
  console.log('按需取数诚实门禁（缺省全量、跳过注记、统计不变）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const getMod = await imp('src/host/tools/deckIssueGet.js')
  const snapMod = await imp('src/host/tools/deckMapSnapshot.js')

  // ① 缺省全量：反向边照取
  {
    let depsCalls = 0
    const tracker = {
      get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
      getDependencies: async () => { depsCalls += 1; return { ok: true, data: { blockedBy: [{ key: '5' }], blocking: [{ key: '9' }] } } },
    }
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(tracker), budget))
    const r = await tool.run(execFor(), { key: '7' })
    check(depsCalls === 1, '缺省取反向边（调了依赖接口）')
    check(r && r.status === 'ok' && r.data.relations.blocking.length === 1, '缺省反向边在关系里')
    check(typeof r.text === 'string' && r.text.indexOf('阻塞别人 1 条') >= 0, '缺省正文报条数')
  }

  // ② blocking=false：依赖接口一次不打，反向边记空不记 0
  {
    let depsCalls = 0
    const tracker = {
      get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
      getDependencies: async () => { depsCalls += 1; return { ok: true, data: { blockedBy: [], blocking: [] } } },
    }
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(tracker), budget))
    const r = await tool.run(execFor(), { key: '7', blocking: false })
    check(depsCalls === 0, '关掉反向边一次不打依赖接口')
    check(r && r.status === 'ok', '关掉照样 OK')
    check(r && Array.isArray(r.data.relations.blocking) && r.data.relations.blocking.length === 0, '反向边记空')
    check(typeof r.text === 'string' && r.text.indexOf('阻塞别人未取') >= 0 && r.text.indexOf('阻塞别人 0 条') < 0, '正文不写假的 0 条')
    check(JSON.stringify(r.notes || []).indexOf('blocking=false') >= 0, '注记写清跳过与拿全量办法')
    check(r.data.relations.blockedBy.length === 1 && r.data.relations.parentKey === '3', '正向关系不受影响')
  }

  // ③ blocking=true 显式：与缺省同形
  {
    let depsCalls = 0
    const tracker = {
      get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
      getDependencies: async () => { depsCalls += 1; return { ok: true, data: { blockedBy: [], blocking: [] } } },
    }
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(tracker), budget))
    const r = await tool.run(execFor(), { key: '7', blocking: true })
    check(depsCalls === 1 && r && r.status === 'ok', '显式 true 与缺省同形')
  }

  // ④ 快照缺省 full：行带进度
  const mapIssue = { key: '3', title: '地图', state: 'open', type: 'map', labels: [], assignees: [], updatedAt: '', url: '', body: '## Destination\n\n去那里\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n' }
  const kid = (k, body) => ({ key: k, title: '子票' + k, state: 'open', type: 'issue', labels: [], assignees: [], blockedBy: [], updatedAt: '', body: body })
  const kids = [kid('11', '# 子票11\n\n## 进度\n\n- 做完一步\n'), kid('12', '# 子票12\n\n## 进度\n\n<!-- 做到哪一步了，在这里一行一行记 -->\n')]
  function snapTracker() {
    return {
      get: async () => ({ ok: true, data: Object.assign({}, mapIssue) }),
      list: async () => ({ ok: true, data: kids.map((k) => Object.assign({}, k, { parentKey: '3' })) }),
    }
  }
  let fullStats = null
  {
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = snapMod.createDeckMapSnapshot(baseDeps(g.gate, stubRegistry(snapTracker()), budget))
    const r = await tool.run(execFor(), { key: '3' })
    check(r && r.status === 'ok', '快照缺省 OK')
    check(r && r.data.children.length === 2 && r.data.children[0].progress !== undefined, '缺省行带进度')
    fullStats = r && r.data.stats
  }

  // ⑤ detail=thin：行薄、统计与 full 一字不差、注记在
  {
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = snapMod.createDeckMapSnapshot(baseDeps(g.gate, stubRegistry(snapTracker()), budget))
    const r = await tool.run(execFor(), { key: '3', detail: 'thin' })
    check(r && r.status === 'ok', '薄行照样 OK')
    check(r && r.data.children.length === 2 && r.data.children[0].progress === undefined && r.data.children[0].key === '11', '薄行无进度有键')
    check(JSON.stringify(r.data.stats) === JSON.stringify(fullStats), '统计与 full 一字不差')
    check(JSON.stringify(r.notes || []).indexOf('detail=thin') >= 0, '注记写清薄行与拿正文办法')
  }

  // ⑥ 介绍不断：描述是一行，参数说明里有性能字眼
  {
    check(typeof getMod.definition.description === 'string' && getMod.definition.description.indexOf('\n') < 0, '单票读介绍仍是一行')
    check(getMod.definition.parameters.properties.blocking.description.indexOf('全仓扫描') >= 0, 'blocking 参数说清代价')
    check(snapMod.definition.parameters.properties.detail.description.indexOf('thin') >= 0, 'detail 参数说清两档')
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
