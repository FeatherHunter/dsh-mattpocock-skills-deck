// verify-deck-thin-reads.ts —— 门禁：按需取数（blocking=false 与 detail=thin）的诚实
// 用法：在插件根目录执行 node tests/verify-deck-thin-reads.ts，可独立运行。
//
// 为什么要这一段：单票读的反向边要扫全仓、快照的全量行带正文进度，回包大、慢、
// 票多时还被截断。按需参数让调用方少拿：blocking=false 跳过反向扫描，
// detail=thin 只要薄行，body excerpt/full 与 comments=N 控制正文与评论的量。
// 但三条诚实线一寸不让：
//   ① 缺省口径：blocking 与快照缺省仍是全量；正文缺省只回前 2000 字、评论缺省 0 条只回总数
//      （#1562：缺省省上下文，要全文或评论正文再按需取一次）；
//   ② 跳过必注记：没取的记空不记 0，正文里不写“0 条”这种假话，注记写清怎么拿全量；
//   ③ 统计不变：thin 只薄行，统计与进度表用全量行算好再薄，数字与 full 一字不差。
//   ④ 正文只出现一处（#1828）：摘要、全文、指定节三档都只在 data.body（或 data.section.text）里
//      各一份；回执不再把同一段正文抄进 data.ticket.body、data.excerpt，section 档也不在 data.body 里重复。
// 全文交付可验完整：body='full' 按 7000 字分块、带全文 SHA-256 指纹，拼回去逐字节相同；
// 写整段正文凭指纹验旧，对不上一个字不动。
// 本文件不联网：后端全是桩，只验“调没调、记没记、数对不对”。
const path = require('path')
const { pathToFileURL } = require('url')
// 判定出口桩（#1003 单出口）：壳拿不到它时一律回「判定出口这次没装上」，
// 生产装配总会给，夹具照生产接上；桩的来历见 tests/lib/deck-decide-stub.js 文件头。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
// #1828：同一段正文在回执里只许出现一次。数它在整份回执里出现了几次。
const countOf = (text, part) => (part ? String(text).split(part).length - 1 : 0)

function stubGateLedger(gateMod, ledgerMod) {
  const now = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => now })
  const gate = gateMod.createGate({ ledger: ledger, now: () => now })
  // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: now + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: now + 3600000 } }, now)
  return { gate: gate }
}

function baseDeps(gate, registry, budget, over) {
  const base = Object.assign({
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
  // 判定出口（#1003 单出口）：壳拿不到它时一律回「判定出口这次没装上」，生产装配总会给。
  // 这里按夹具自己那张桩注册表补上（桩的来历见 tests/lib/deck-decide-stub.js 文件头）。
  // #1138 起「这个工作区选过了」只剩工作区文件一份记录（注册表上的 bound 已整段删掉）：
  // 本夹具的会话 cwd 一律是 execFor 里那个 D:/demo，给它记一笔就等于这个工作区里有那份文件。
  if (!base.decideBackend && base.registry) base.decideBackend = makeDecideStub(base.registry)
  chooseWorkspace('D:/demo', 'stub')
  return base
}

const execFor = () => ({ agent: { session: { id: 's-thin', cwd: 'D:/demo' } } })
const refOf = { backend: 'stub', refId: 'o/n', name: 'o/n', url: '' }
function stubRegistry(tracker) {
  return {
    select: async () => ({ backendId: 'stub', source: 'explicit', ref: refOf, pending: false }),
    get: () => tracker,
    // #1439（#1442）起打开 Tracker 会话时要按后端编号取预算声明，预算声明是必填项：这里的桩后端照
    // 「离网」口径声明（不发请求、不计条数与点数），少了 modules 这一格 openTracker 会回 pending，
    // 工具就一路回 backend-threw（看上去像后端抛错，其实根本没走到 work 闭包）。
    modules: () => [{ id: 'stub', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false } }],
    has: () => true,
    describe: () => refOf,
  }
}

const demoIssue = { key: '7', title: '演练票', state: 'open', type: 'issue', labels: [], assignees: [], updatedAt: '', closedAt: '', url: '', body: '# 演练票\n\n## 进度\n\n- 第一步\n', parentKey: '3', blockedBy: [{ key: '5' }] }

async function main() {
  console.log('按需取数诚实门禁（缺省口径、跳过注记、统计不变）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const getMod = await imp('src/deck/tools/issue-get.ts')
  const snapMod = await imp('src/deck/tools/map-snapshot.ts')

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

  // ⑥ 反向边不全时两条路都要自曝（#1304）：原生连接截断说「可能不全」，退回整仓反推说「用了兜底」
  {
    const truncated = {
      get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
      getDependencies: async () => ({ ok: true, data: { blockedBy: [{ key: '5' }], blocking: [{ key: '9' }], blockingSource: 'native', blockingComplete: false, blockingNote: '反向边这次从后端的原生字段一次取回，但连接到了 50 条上限，可能不全：这是后端一次能给的上限，不是「没有阻塞别人」。' } }),
    }
    const g = stubGateLedger(gateMod, ledgerMod)
    const r = await getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(truncated), budget)).run(execFor(), { key: '7' })
    check(r && r.status === 'ok' && r.data.relations.blocking.length === 1, '⑥-1 到了上限，已经看到的边照给')
    check(typeof r.text === 'string' && r.text.indexOf('可能不全') >= 0, '⑥-2 正文说清这个条数可能不全')
    check(JSON.stringify(r.notes || []).indexOf('不是「没有阻塞别人」') >= 0, '⑥-3 注记把后端给的说明原样带上')
  }
  {
    const scanned = {
      get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
      getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [{ key: '9' }], blockingSource: 'scan', blockingComplete: true, blockingNote: '原生反向边字段这次没取到，退回整仓列表反推（结果完整，但代价随仓库票数增长）。' } }),
    }
    const g = stubGateLedger(gateMod, ledgerMod)
    const r = await getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(scanned), budget)).run(execFor(), { key: '7' })
    check(r && r.status === 'ok', '⑥-4 退回整仓反推照样读成功')
    check(JSON.stringify(r.notes || []).indexOf('整仓列表反推') >= 0, '⑥-5 注记交代用了兜底（即使结果完整）')
    check(typeof r.text === 'string' && r.text.indexOf('可能不全') < 0, '⑥-6 结果完整时不乱说「可能不全」')
  }

  // ⑥-b REST 降级时列表也要自曝（#1304 AC⑤）：主路用不了、走 REST 通道，REST 自己也可能只拿到一部分
  {
    const listMod = await imp('src/deck/tools/issue-list.ts')
    const tracker = {
      // GitHub 房的 REST 降级分支恒回 truncated:true（read/issues.ts）。桩按真实形状给，
      // 否则这里会把「降级但没标截断」当成「一定可能不全」，与 data.backendTruncated 说不到一起（#1830）。
      list: async () => ({ ok: true, data: [Object.assign({}, demoIssue)], fallback: 'rest', fallbackReason: 'other', truncated: true }),
    }
    const g = stubGateLedger(gateMod, ledgerMod)
    const tool = listMod.createDeckIssueList(baseDeps(g.gate, stubRegistry(tracker), budget))
    const r = await tool.run(execFor(), {})
    check(r && r.status === 'ok', '⑥-7 REST 降级时列表照样回 OK')
    const notesText = JSON.stringify(r && r.notes || [])
    check(notesText.indexOf('REST 降级通道') >= 0 && notesText.indexOf('可能不全') >= 0, '⑥-8 注记说清走了 REST 且清单可能不全')
  }

  // ⑦ 介绍不断：描述是一行，参数说明里有性能字眼
  {
    check(typeof getMod.definition.description === 'string' && getMod.definition.description.indexOf('\n') < 0, '单票读介绍仍是一行')
    check(getMod.definition.parameters.properties.blocking.description.indexOf('反向边查询') >= 0, 'blocking 参数说清代价')
    check(snapMod.definition.parameters.properties.detail.description.indexOf('thin') >= 0, 'detail 参数说清两档')
  }

  // ⑧ 正文与评论按需取（#1562）：缺省摘要 + 评论 0 条；全文分块可验；写正文凭指纹验旧
  {
    const { bodyDigest, chunkBody, joinChunks } = await imp('src/deck/shell/body-digest.ts')
    // 指纹算法：空串与 'abc' 都是 SHA-256 公认值，分块拼回去逐字节相同。
    check(bodyDigest('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '空正文指纹是空串的 SHA-256')
    check(bodyDigest('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', '指纹是 SHA-256 公认值（abc）')
    const rt = '甲'.repeat(8000)
    check(joinChunks(chunkBody(rt)) === rt, '分块拼回去逐字节相同')
    check(chunkBody(rt).every((c) => c.length <= 7000), '每块不超 7000 字（渲染上限 8000 留余量）')
    check(chunkBody('').length === 0, '空正文不分块')
    // 中文与表情走 UTF-8 多字节：与运行环境的标准库对拍，错一个字节都会红。
    {
      const { createHash } = await import('node:crypto')
      const sample = '甲乙丙\u{1F600}混合 mixed 123'
      check(bodyDigest(sample) === createHash('sha256').update(sample, 'utf8').digest('hex'), '中文与表情的指纹与标准库一致')
    }
    // 正文里放一段只出现一次的标记：整份回执只能数到一次（#1828）。
    const MARK = '正文唯一标记-1828'
    const bigBody = '# 大正文\n\n' + MARK + '\n' + '甲'.repeat(5000) + '\n'
    const cmts = [0, 1, 2].map((i) => ({ author: { login: 'u' + i }, body: '评论' + i, createdAt: '', updatedAt: '' }))
    const bodyTracker = {
      get: async (_repo, _key, opts) => {
        const want = (opts && opts.comments && typeof opts.comments.first === 'number') ? opts.comments.first : 0
        return { ok: true, data: Object.assign({}, demoIssue, { body: bigBody, comments: cmts.slice(0, want), commentCount: cmts.length }) }
      },
      getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
    }
    // 缺省：摘要 + 评论 0 条只给总数。
    {
      const g = stubGateLedger(gateMod, ledgerMod)
      const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(bodyTracker), budget))
      const r = await tool.run(execFor(), { key: '7' })
      check(r && r.status === 'ok' && r.data.body.mode === 'excerpt', '缺省正文走摘要档')
      check(r && r.data.body.length === bigBody.length && r.data.body.text.length === 2000, '摘要档长度诚实（全文长度 + 前 2000 字）')
      check(r && !('body' in (r.data.ticket || {})), '票面不再带正文（data.ticket.body 不存在）')
      check(r && !('excerpt' in r.data), '顶层不再多装一份摘要（data.excerpt 不存在）')
      check(countOf(JSON.stringify(r), MARK) === 1, '正文唯一标记在整份回执里只出现一次（实得 ' + countOf(JSON.stringify(r), MARK) + ' 次）')
      check(r && r.data.body.digest === bodyDigest(bigBody), '摘要档指纹即全文指纹')
      check(r && Array.isArray(r.data.comments) && r.data.comments.length === 0 && r.data.commentCount === 3, '缺省评论 0 条、总数照给')
      const notes = JSON.stringify(r.notes || [])
      check(notes.indexOf("body='full'") >= 0 && notes.indexOf('comments=N') >= 0, '注记写清拿全文与评论正文的办法')
    }
    // 全文：分块 + 指纹，拼回去逐字节相同。
    {
      const g = stubGateLedger(gateMod, ledgerMod)
      const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(bodyTracker), budget))
      const r = await tool.run(execFor(), { key: '7', body: 'full' })
      check(r && r.status === 'ok' && r.data.body.mode === 'full', 'body=full 走全文档')
      check(r && joinChunks(r.data.body.chunks) === bigBody, '全文分块拼回去逐字节相同')
      check(r && r.data.body.digest === bodyDigest(bigBody), '全文指纹对得上')
      check(r && !('body' in (r.data.ticket || {})), '全文档票面也不带正文（正文只在 data.body.chunks）')
      check(countOf(JSON.stringify(r), MARK) === 1, '全文在整份回执里只出现一次（实得 ' + countOf(JSON.stringify(r), MARK) + ' 次）')
    }
    // 指定节：只回这一节，且原文只出现在 data.section.text 一处（#1828）。
    {
      const sectionBody = '# 带节票\n\n' + MARK + '\n\n## 进度\n\n这一步做完了\n\n## 其他\n\n别的内容\n'
      const tracker = {
        get: async () => ({ ok: true, data: Object.assign({}, demoIssue, { body: sectionBody, comments: [], commentCount: 0 }) }),
        getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
      }
      const g = stubGateLedger(gateMod, ledgerMod)
      const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(tracker), budget))
      const r = await tool.run(execFor(), { key: '7', section: '进度' })
      check(r && r.status === 'ok' && r.data.body.mode === 'section' && !('text' in r.data.body), '只读某一节时正文走 section 档，data.body 不再重复这一节')
      check(r && r.data.section && String(r.data.section.text).indexOf('这一步做完了') >= 0, '指定节的原文在 data.section.text')
      check(countOf(JSON.stringify(r), '这一步做完了') === 1, '指定节的原文在整份回执里只出现一次（实得 ' + countOf(JSON.stringify(r), '这一步做完了') + ' 次）')
      check(r && !('body' in (r.data.ticket || {})) && !('excerpt' in r.data), '指定节时票面与顶层也不带正文')
      // 全文 + 指定节：正文在 chunks 里，section 只报节名，不再重复节原文。
      const rf = await tool.run(execFor(), { key: '7', section: '进度', body: 'full' })
      check(rf && rf.data.body.mode === 'full' && rf.data.section && rf.data.section.name === '进度' && rf.data.section.text === undefined,
        '全文 + 指定节：正文只在 chunks，section 只报节名')
      // #1828 评审收口：section 传空串按「没请求节」处理，不能把正文误切成某一节、也不能丢 data.body.text。
      const re = await tool.run(execFor(), { key: '7', section: '' })
      check(re && re.data.body && re.data.body.mode === 'excerpt' && typeof re.data.body.text === 'string' && re.data.body.text.length > 0,
        'section 传空串时仍回摘要档正文（data.body.text）')
      check(re && re.data.section === null, 'section 传空串时 data.section 为 null')
    }
    // 按需评论：传几回几。
    {
      const g = stubGateLedger(gateMod, ledgerMod)
      const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(bodyTracker), budget))
      const r = await tool.run(execFor(), { key: '7', comments: 2 })
      check(r && r.status === 'ok' && r.data.comments.length === 2 && r.data.commentCount === 3, '传几条回几条、总数不变')
    }
    // #1828 验收：10KB 正文 + 5 条评论，缺省回执不超过 3KB，正文只出现一次。
    {
      const body10k = '# 十千字票\n\n' + 'a'.repeat(10000) + '\n'
      const many = [0, 1, 2, 3, 4].map((i) => ({ author: { login: 'u' + i }, body: '评论' + i, createdAt: '', updatedAt: '' }))
      const tracker = {
        get: async () => ({ ok: true, data: Object.assign({}, demoIssue, { body: body10k, comments: [], commentCount: many.length }) }),
        getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
      }
      const g = stubGateLedger(gateMod, ledgerMod)
      const tool = getMod.createDeckIssueGet(baseDeps(g.gate, stubRegistry(tracker), budget))
      const r = await tool.run(execFor(), { key: '7' })
     // 量两个数：data 是工具自己装的那一块（正文、票面、关系、落点），整份回执外面还有壳的公共字段
      // （tool/workspace/backend/repo/cost/notes 等，约 700 字，由会话壳统一加，跟正文重复无关）。
      // #1562 时同构造整份 7433 字；#1828 唯一化正文后 data 2705、整份 3406，所以卡这两个上限。
      const size = JSON.stringify(r).length
      const dataSize = JSON.stringify(r.data).length
      check(r && r.status === 'ok' && r.data.body.text.length === 2000 && r.data.body.length === body10k.length && r.data.commentCount === 5,
        '10KB 正文 + 5 条评论：摘要 2000 字、全文长度与评论总数照给')
      check(dataSize <= 3000, '10KB 正文 + 5 条评论：回执的 data 部分 ≤3KB（实得 ' + dataSize + ' 字）')
      check(size <= 3500, '10KB 正文 + 5 条评论：整份回执 ≤3.5KB（实得 ' + size + ' 字）')
      check(countOf(JSON.stringify(r), '十千字票') === 1, '正文在整份回执里只出现一次（实得 ' + countOf(JSON.stringify(r), '十千字票') + ' 次）')
    }
    // 写整段正文：没带指纹、指纹对不上，都一个字不动。
    {
      const patchMod = await imp('src/deck/tools/issue-patch.ts')
      const g = stubGateLedger(gateMod, ledgerMod)
      const mkPatch = () => patchMod.createDeckIssuePatch(baseDeps(g.gate, stubRegistry(bodyTracker), budget))
      const noDigest = await mkPatch().run(execFor(), { key: '7', body: bigBody + '改' })
      const noDigestText = JSON.stringify(noDigest)
      check(noDigestText.indexOf('bodyDigest') >= 0 && noDigest.data && noDigest.data.ticket && noDigest.data.ticket.body === bigBody, '没带指纹写正文：一个字不动并告诉怎么取指纹')
      const wrong = await mkPatch().run(execFor(), { key: '7', body: bigBody + '改', bodyDigest: '0'.repeat(64) })
      check(JSON.stringify(wrong).indexOf('指纹对不上') >= 0, '指纹对不上：一个字不动并提示重读')
    }
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
