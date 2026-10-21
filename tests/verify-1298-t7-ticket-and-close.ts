// tests/verify-1298-t7-ticket-and-close.ts —— #1298 门禁：实施票挂规格（双后端）与规格关闭守卫
// 门禁归属: src/tracker/rooms/github/issues-write.ts, src/deck/tools/issue-create.ts, src/deck/tools/issue-patch.ts, tests/deck-tools-matrix-transports.ts
//
// 这张票（T7）的验收里，能在「deck 工具 + 后端」这条缝上钉死的是这几条：
//   ① GitHub 车道：deck_issue_create(kind=spec) 建出的规格票，正文第一行留对象类型标记、第二行留幂等锚，
//      写后读回 type=spec（两车道同判的前提）；同一个锚重试只多一张票。
//   ② 两个车道建实施票（kind=ticket）：父必须是规格票 —— 挂探索地图、或干脆没给父票，都必须失败且不落票；
//      标签集合只剩 ready-for-agent（传进来的 wayfinder:* 会被去掉，去掉这件事写进回执）。
//   ③ 本地 Markdown 车道：编号在 effort 内连续不重号，中文标题原样进文件名（不落 01-untitled.md），
//      父边落在文件头的 <!-- parentKey: <规格票号> --> 注释里。
//   ④ 规格关闭守卫：子票没全关时关规格必须失败并说清缺哪几张；规格关闭前必须留一条评论；
//      AI 工具面允许关、不允许重开（close:false 只回一句「做不到」，后端状态不动）。
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1298-t7-ticket-and-close.ts
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const { createOutboundControl } = require('../src/host/platform/outbound-control.ts')
const { makeScriptedGh } = require('./deck-tools-matrix-transports.js')
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
/** 失败时的「为什么」：三态、原因码与工具原话都带上，门禁红的时候不用再猜。 */
const why = (r) => '；实得 status=' + String((r && r.status) || '') + ' reason=' + String((r && r.reason) || '') + ' text=' + String((r && r.text) || '').slice(0, 200)
const itemsOf = (r) => ((r && r.items) || []).filter((i) => i && typeof i === 'object')
const stepItem = (r, step) => itemsOf(r).find((i) => i.step === step)
const parentEdge = (r) => itemsOf(r).find((i) => i.edge && i.edge.op === 'parent')
const closeReason = (r) => String((stepItem(r, 'close') || {}).reason || '')
const reopenReason = (r) => String((stepItem(r, 'reopen') || {}).reason || '')

/** 本地 Markdown 车道现场：一个真实临时工作区，map.md 就是地图（票号 00），票是 issues/ 下的文件。 */
function markdownLane() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1298-t7-'))
  const dir = path.join(root, '.scratch', 'demo')
  const issuesDir = path.join(dir, 'issues')
  fs.mkdirSync(issuesDir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# T7 本地演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n演示\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p) { return String(p).replace(/\\/g, '/') },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    id: 'markdown',
    handle: { cwd: rootPosix, refId: '.scratch/demo' },
    backendCtx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name) { return name === 'fs' ? plat.fs : undefined } },
    files() { try { return fs.readdirSync(issuesDir).filter((f) => f.endsWith('.md')).sort() } catch (e) { return [] } },
    read(name) { return fs.readFileSync(path.join(issuesDir, name), 'utf8') },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('T7 门禁（#1298）：实施票挂规格（双后端）与规格关闭守卫')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const githubModule = (await imp('src/tracker/rooms/github/index.ts')).githubModule
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/shared/refresh/tool-cost.js')

  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const registry = registryMod.createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })

  const ghSink = []
  const gh = makeScriptedGh(ghSink)
  const ghCtx = {
    cwd: '/ws/github',
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (n) => (n === 'gh' ? '/usr/local/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd, args) => { if (cmd === 'gh') gate.noteOutbound({ requests: 1, points: 0 }); return gh.exec(cmd, args) },
    isEnabled: () => false, logEvent: () => {},
  }
  const ghLane = { id: 'github', handle: { cwd: '/ws/github', refId: 'acme/demo' }, backendCtx: ghCtx }
  const md = markdownLane()
  const disposals = [registry.register(githubModule), registry.register(markdownModule)]
  chooseWorkspace(ghLane.handle.cwd, 'github')
  chooseWorkspace(md.handle.cwd, 'markdown')
  const byCwd = new Map([[ghLane.handle.cwd, ghLane], [md.handle.cwd, md]])
  let currentLane = ghLane

  const table = new Map()
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    handleFor: (s) => (byCwd.get(s.cwd) || {}).handle,
    backendCtx: () => currentLane.backendCtx,
    now: () => clock,
    log: { fire: () => {} },
    decideBackend: makeDecideStub(registry),
    planStore: { durable: true, load(id) { return table.get(String(id)) || null }, save(id, s) { table.set(String(id), s) } },
    invalidate: () => {},
  }
  const tools = {}
  for (const [file, factory, name] of [
    ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
    ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
    ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ]) {
    const mod = await imp(file)
    tools[name] = mod[factory](deps)
  }
  const run = async (name, args) => {
    try { return await tools[name].run({ agent: { session: { id: 's-' + currentLane.id + '-t7', cwd: currentLane.handle.cwd } } }, args || {}) }
    catch (e) { return { ok: false, status: 'threw', reason: String((e && e.message) || e) } }
  }
  const useLane = (lane) => { currentLane = lane }

  try {
    // ─────────────────────────────────────────────────────────────────────
    // A. GitHub 车道
    // ─────────────────────────────────────────────────────────────────────
    useLane(ghLane)

    const gMap = await run('deck_issue_create', { title: 'T7 双后端演示地图', kind: 'map' })
    const gMapKey = String((gMap && gMap.data && gMap.data.ticket && gMap.data.ticket.key) || '')
    check(gMap.status === 'ok' && gMapKey !== '', '[GitHub] 建探索地图：回 ok，地图票 ' + gMapKey + why(gMap))
    const gMapTicket = gh.tickets.find((t) => String(t.number) === gMapKey)
    check(!!gMapTicket && gMapTicket.labels.indexOf('wayfinder:map') >= 0, '[GitHub] 探索地图带着 wayfinder:map 标签（后端认得出它是地图）：' + JSON.stringify(gMapTicket && gMapTicket.labels))

    const gSpec = await run('deck_issue_create', { title: 'T7 双后端演示规格', kind: 'spec', parentKey: gMapKey, idempotencyKey: 'T7-GH-SPEC', body: '## Problem Statement\n\n演示用规格。\n\n## Solution\n\n演示用解法。' })
    const gSpecKey = String((gSpec && gSpec.data && gSpec.data.ticket && gSpec.data.ticket.key) || '')
    check(gSpec.status === 'ok' && gSpecKey !== '', '[GitHub] 建规格票：回 ok，票 ' + gSpecKey + why(gSpec))
    const gSpecTicket = gh.tickets.find((t) => String(t.number) === gSpecKey)
    const gSpecLines = String((gSpecTicket && gSpecTicket.body) || '').split('\n')
    check(gSpecLines[0] === '<!-- DSH-ISSUE-KIND: spec -->', '[GitHub] 规格票正文第一行是对象类型标记（GitHub 只认第一行）：' + JSON.stringify(gSpecLines.slice(0, 2)))
    check(/^<!-- DSH-IDEMPOTENCY-KEY:/.test(String(gSpecLines[1] || '')), '[GitHub] 幂等锚留在第二行（标记第一行、锚第二行，两个都还在）：' + JSON.stringify(gSpecLines.slice(0, 2)))
    check(gSpec.data.ticket.type === 'spec', '[GitHub] 建票回包按第一行标记读回 type=spec：' + String(gSpec.data.ticket.type))
    const gSpecEdge = parentEdge(gSpec)
    check(!!gSpecEdge && gSpecEdge.status === 'ok' && String(gSpecEdge.evidence || '').length > 0, '[GitHub] 规格挂地图的父边留了落点与非空证据：' + JSON.stringify(gSpecEdge && { status: gSpecEdge.status, landing: gSpecEdge.landing, evidence: String(gSpecEdge.evidence || '').slice(0, 80) }))
    const gSpecRead = await run('deck_issue_get', { key: gSpecKey })
    check(gSpecRead.status === 'ok' && gSpecRead.data.ticket.type === 'spec' && String(gSpecRead.data.relations.parentKey) === gMapKey, '[GitHub] 写后读回：对象类型 spec、父票 ' + gMapKey + '（实得 type=' + String(gSpecRead.data && gSpecRead.data.ticket && gSpecRead.data.ticket.type) + ' parentKey=' + String(gSpecRead.data && gSpecRead.data.relations && gSpecRead.data.relations.parentKey) + '）' + why(gSpecRead))

    const gSpecAgain = await run('deck_issue_create', { title: 'T7 双后端演示规格（重试）', kind: 'spec', parentKey: gMapKey, idempotencyKey: 'T7-GH-SPEC' })
    check(gSpecAgain.status === 'ok' && String(gSpecAgain.data.ticket.key) === gSpecKey, '[GitHub] 同锚重试复用同一张规格票，不重复建：' + String(gSpecAgain.data && gSpecAgain.data.ticket && gSpecAgain.data.ticket.key))
    check(gh.tickets.length === 2, '[GitHub] 建到这一步远端只有两张票（地图 + 规格），重试没有多建：' + gh.tickets.length)

    const gCloseNoComment = await run('deck_issue_patch', { key: gSpecKey, close: true })
    check(gCloseNoComment.status === 'unsupported' && closeReason(gCloseNoComment).indexOf('评论') >= 0, '[GitHub] 规格关闭前没留评论：拒绝关闭并说清要先评论：' + closeReason(gCloseNoComment))
    check(String(gSpecTicket.state) === 'open', '[GitHub] 被拒绝的关闭没有改后端状态（仍 open）：' + String(gSpecTicket.state))

    const mkGTicket = (title) => run('deck_issue_create', { title: title, kind: 'ticket', parentKey: gSpecKey, labels: ['wayfinder:research'] })
    const gT1 = await mkGTicket('实施票一')
    const gT2 = await mkGTicket('实施票二')
    const gT1Key = String((gT1 && gT1.data && gT1.data.ticket && gT1.data.ticket.key) || '')
    const gT2Key = String((gT2 && gT2.data && gT2.data.ticket && gT2.data.ticket.key) || '')
    check(gT1.status === 'ok' && gT2.status === 'ok' && gT1Key !== '' && gT2Key !== '' && gT1Key !== gT2Key, '[GitHub] 规格下建出两张实施票：' + gT1Key + ' / ' + gT2Key + why(gT1) + why(gT2))
    const gT1Ticket = gh.tickets.find((t) => String(t.number) === gT1Key)
    check(String(gT1Ticket.parentKey) === gSpecKey, '[GitHub] 实施票父边落在原生父子列、指向规格 ' + gSpecKey + '（不是探索地图 ' + gMapKey + '）：parentKey=' + String(gT1Ticket.parentKey))
    check(JSON.stringify(gT1Ticket.labels) === '["ready-for-agent"]', '[GitHub] 实施票标签集合只剩 ready-for-agent（传进来的 wayfinder:research 被去掉）：' + JSON.stringify(gT1Ticket.labels))
    const gT1Notes = (gT1.notes || []).join('；')
    check(gT1Notes.indexOf('wayfinder') >= 0, '[GitHub] 去标签这件事写进了回执（不悄悄改）：' + gT1Notes.slice(0, 200))
    const gT1Edge = parentEdge(gT1)
    check(!!gT1Edge && gT1Edge.status === 'ok' && String(gT1Edge.evidence || '').length > 0, '[GitHub] 实施票挂规格的父边留了落点与非空证据：' + JSON.stringify(gT1Edge && { status: gT1Edge.status, landing: gT1Edge.landing, evidence: String(gT1Edge.evidence || '').slice(0, 80) }))
    const gT1Read = await run('deck_issue_get', { key: gT1Key })
    check(gT1Read.status === 'ok' && String(gT1Read.data.relations.parentKey) === gSpecKey, '[GitHub] 实施票写后读回父票是规格 ' + gSpecKey + '：' + String(gT1Read.data && gT1Read.data.relations && gT1Read.data.relations.parentKey) + why(gT1Read))

    const gBeforeBad = gh.tickets.length
    const gBadMapParent = await run('deck_issue_create', { title: '挂到探索地图下的实施票', kind: 'ticket', parentKey: gMapKey })
    check(gBadMapParent.ok === false && gBadMapParent.status === 'unsupported' && String(gBadMapParent.text || '').indexOf('父必须是规格票') >= 0, '[GitHub] 父票是探索地图：建票失败并说清父必须是规格票：' + why(gBadMapParent))
    check(gh.tickets.length === gBeforeBad, '[GitHub] 父票不合规时票没落盘（远端数量没变）：' + gh.tickets.length)
    const gNoParent = await run('deck_issue_create', { title: '没给父票的实施票', kind: 'ticket' })
    check(gNoParent.ok === false && gNoParent.reason === 'bad-args' && String(gNoParent.text || '').indexOf('实施票的父必须是规格票') >= 0, '[GitHub] 没给父票：工具层当场拒绝：' + why(gNoParent))

    const gBlocked = await run('deck_issue_patch', { key: gSpecKey, comment: '逐张核对：两张实施票都还没关。', close: true })
    const gBlockedReason = closeReason(gBlocked)
    check(gBlocked.status === 'partial' && gBlockedReason.indexOf(gT1Key) >= 0 && gBlockedReason.indexOf('实施票一') >= 0 && gBlockedReason.indexOf(gT2Key) >= 0 && gBlockedReason.indexOf('实施票二') >= 0, '[GitHub] 实施票没全关时关规格失败，回执逐张说清缺哪几张：' + gBlockedReason)
    check(String(gSpecTicket.state) === 'open', '[GitHub] 关规格失败后规格仍是 open：' + String(gSpecTicket.state))

    const gCloseT1 = await run('deck_issue_patch', { key: gT1Key, comment: '核对通过：实施票一。', close: true })
    check(gCloseT1.status === 'ok' && String(gT1Ticket.state) === 'closed', '[GitHub] 非规格票可以直接关（子票/评论闸只挡规格）：' + String(gT1Ticket.state) + why(gCloseT1))

    const gBlocked2 = await run('deck_issue_patch', { key: gSpecKey, comment: '逐张核对：实施票一通过，实施票二还没关。', close: true })
    const gBlocked2Reason = closeReason(gBlocked2)
    check(gBlocked2.status === 'partial' && gBlocked2Reason.indexOf('实施票二') >= 0 && gBlocked2Reason.indexOf('实施票一') < 0, '[GitHub] 只剩一张没关时回执只列缺的那张：' + gBlocked2Reason)

    const gCloseT2 = await run('deck_issue_patch', { key: gT2Key, close: true })
    check(gCloseT2.status === 'ok' && String(gT2TicketState(gh, gT2Key)) === 'closed', '[GitHub] 第二张实施票不带评论也能关（评论闸只挡规格）' + why(gCloseT2))

    const gCloseSpec = await run('deck_issue_patch', { key: gSpecKey, comment: '逐张核对结论：实施票一通过；实施票二通过。规格可以关。', close: true })
    check(gCloseSpec.status === 'ok' && String(gCloseSpec.data.ticket.state) === 'closed' && String(gSpecTicket.state) === 'closed', '[GitHub] 子票全关 + 留了核对评论：规格关成功，写后读回 closed：' + String(gSpecTicket.state) + why(gCloseSpec))
    check(gSpecTicket.comments.length >= 1, '[GitHub] 规格票上确实留下了一条核对评论：' + gSpecTicket.comments.length)

    const gReopen = await run('deck_issue_patch', { key: gSpecKey, close: false })
    check(gReopen.status === 'unsupported' && reopenReason(gReopen).indexOf('重开') >= 0, '[GitHub] close:false 不再表示重开：回一条「做不到」：' + reopenReason(gReopen))
    check(String(gSpecTicket.state) === 'closed' && ghSink.filter((l) => l.indexOf('issue reopen') >= 0).length === 0, '[GitHub] 重开请求没有真的发到后端（状态仍 closed、命令列表里没有 issue reopen）：' + String(gSpecTicket.state))

    // ─────────────────────────────────────────────────────────────────────
    // B. 本地 Markdown 车道
    // ─────────────────────────────────────────────────────────────────────
    useLane(md)

    const mSpec = await run('deck_issue_create', { title: '本地规格票', kind: 'spec', parentKey: '00', idempotencyKey: 'T7-MD-SPEC', body: '## 问题陈述\n\n演示用规格。' })
    const mSpecKey = String((mSpec && mSpec.data && mSpec.data.ticket && mSpec.data.ticket.key) || '')
    check(mSpec.status === 'ok' && mSpecKey === '01', '[本地] 建规格票：编号 01（effort 里第一张票）：' + mSpecKey + why(mSpec))
    const mSpecFile = md.files().find((f) => /^01-/.test(f))
    check(mSpecFile === '01-本地规格票.md', '[本地] 中文标题原样进文件名：' + JSON.stringify(md.files()))
    const mSpecText = mSpecFile ? md.read(mSpecFile) : ''
    const mSpecHead = mSpecText.split('\n').slice(0, 4)
    check(mSpecHead[1] === '<!-- DSH-ISSUE-KIND: spec -->' && /^<!-- parentKey: 00 -->$/.test(String(mSpecHead[2] || '')), '[本地] 规格文件头：锚 → spec 标记 → parentKey 00 → created：' + JSON.stringify(mSpecHead))
    check(mSpecText.indexOf('Type: spec') < 0, '[本地] 规格票不写 Type: spec 行（标记是唯一真源）')
    const mSpecRead = await run('deck_issue_get', { key: mSpecKey })
    check(mSpecRead.status === 'ok' && mSpecRead.data.ticket.type === 'spec', '[本地] 写后读回 type=spec：' + String(mSpecRead.data && mSpecRead.data.ticket && mSpecRead.data.ticket.type) + why(mSpecRead))

    const mCloseNoComment = await run('deck_issue_patch', { key: mSpecKey, close: true })
    check(mCloseNoComment.status === 'unsupported' && closeReason(mCloseNoComment).indexOf('评论') >= 0, '[本地] 规格关闭前没留评论：拒绝关闭并说清要先评论：' + closeReason(mCloseNoComment))

    const mkMTicket = (title) => run('deck_issue_create', { title: title, kind: 'ticket', parentKey: mSpecKey, labels: ['wayfinder:research'] })
    const mT1 = await mkMTicket('实施票一')
    const mT2 = await mkMTicket('实施票二')
    const mT1Key = String((mT1 && mT1.data && mT1.data.ticket && mT1.data.ticket.key) || '')
    const mT2Key = String((mT2 && mT2.data && mT2.data.ticket && mT2.data.ticket.key) || '')
    check(mT1.status === 'ok' && mT2.status === 'ok' && mT1Key === '02' && mT2Key === '03', '[本地] 同批实施票编号连续不重号：' + mT1Key + ' / ' + mT2Key + why(mT1) + why(mT2))
    check(JSON.stringify(md.files()) === JSON.stringify(['01-本地规格票.md', '02-实施票一.md', '03-实施票二.md']), '[本地] 三张票各一个文件、中文标题进文件名：' + JSON.stringify(md.files()))
    const mT1Text = md.read('02-实施票一.md')
    const mT1Head = mT1Text.split('\n').slice(0, 4)
    check(mT1Head[1] === '<!-- DSH-ISSUE-KIND: ticket -->' && /^<!-- parentKey: 01 -->$/.test(String(mT1Head[2] || '')), '[本地] 实施票文件头：ticket 标记 + 父注释指向规格 01：' + JSON.stringify(mT1Head))
    check(/^Labels: ready-for-agent$/m.test(mT1Text) && mT1Text.indexOf('wayfinder') < 0, '[本地] 实施票标签只剩 ready-for-agent：' + String((mT1Text.match(/^Labels:.*$/m) || [])[0]))
    const mT1Notes = (mT1.notes || []).join('；')
    check(mT1Notes.indexOf('wayfinder') >= 0, '[本地] 去标签这件事写进了回执：' + mT1Notes.slice(0, 200))
    const mT1Read = await run('deck_issue_get', { key: mT1Key })
    check(mT1Read.status === 'ok' && String(mT1Read.data.relations.parentKey) === mSpecKey, '[本地] 实施票写后读回父票是规格 ' + mSpecKey + '：' + String(mT1Read.data && mT1Read.data.relations && mT1Read.data.relations.parentKey) + why(mT1Read))
    const mT1Edge = parentEdge(mT1)
    check(!!mT1Edge && mT1Edge.status === 'ok' && String(mT1Edge.evidence || '').length > 0, '[本地] 实施票挂规格的父边留了落点与非空证据：' + JSON.stringify(mT1Edge && { landing: mT1Edge.landing, evidence: String(mT1Edge.evidence || '').slice(0, 80) }))

    const mBlocked = await run('deck_issue_patch', { key: mSpecKey, comment: '逐张核对：两张实施票都还没关。', close: true })
    const mBlockedReason = closeReason(mBlocked)
    check(mBlocked.status === 'partial' && mBlockedReason.indexOf('实施票一') >= 0 && mBlockedReason.indexOf('实施票二') >= 0, '[本地] 实施票没全关时关规格失败，回执列出缺哪几张：' + mBlockedReason)

    const mCloseT1 = await run('deck_issue_patch', { key: mT1Key, comment: '核对通过：实施票一。', close: true })
    check(mCloseT1.status === 'ok' && String(mCloseT1.data.ticket.state) === 'closed' && md.read('02-实施票一.md').indexOf('Status: resolved') >= 0, '[本地] 非规格票可以直接关：读回 state=closed，票面落 Status: resolved（parse 把 resolved 归一成 closed）：' + String((md.read('02-实施票一.md').match(/^Status:.*$/m) || [])[0]) + why(mCloseT1))

    const mBlocked2 = await run('deck_issue_patch', { key: mSpecKey, comment: '逐张核对：实施票一通过，实施票二还没关。', close: true })
    const mBlocked2Reason = closeReason(mBlocked2)
    check(mBlocked2.status === 'partial' && mBlocked2Reason.indexOf('实施票二') >= 0 && mBlocked2Reason.indexOf('实施票一') < 0, '[本地] 只剩一张没关时回执只列缺的那张：' + mBlocked2Reason)

    const mCloseT2 = await run('deck_issue_patch', { key: mT2Key, close: true })
    check(mCloseT2.status === 'ok' && String(mCloseT2.data.ticket.state) === 'closed' && md.read('03-实施票二.md').indexOf('Status: resolved') >= 0, '[本地] 实施票不带评论也能关（评论闸只挡规格）：读回 state=closed' + why(mCloseT2))

    const mCloseSpec = await run('deck_issue_patch', { key: mSpecKey, comment: '逐张核对结论：实施票一通过；实施票二通过。规格可以关。', close: true })
    check(mCloseSpec.status === 'ok' && String(mCloseSpec.data.ticket.state) === 'closed' && md.read(mSpecFile).indexOf('Status: resolved') >= 0, '[本地] 子票全关 + 留了核对评论：规格关成功，读回 state=closed、票面 Status: resolved：' + String((md.read(mSpecFile).match(/^Status:.*$/m) || [])[0]) + why(mCloseSpec))
    check(/核对结论/.test(md.read(mSpecFile)), '[本地] 规格票上确实留下了核对评论')

    const mReopen = await run('deck_issue_patch', { key: mSpecKey, close: false })
    check(mReopen.status === 'unsupported' && reopenReason(mReopen).indexOf('重开') >= 0, '[本地] close:false 不再表示重开：回一条「做不到」：' + reopenReason(mReopen))
    check(md.read(mSpecFile).indexOf('Status: resolved') >= 0, '[本地] 重开请求没有改盘上状态（仍 closed）：' + String((md.read(mSpecFile).match(/^Status:.*$/m) || [])[0]))
  } finally {
    for (const d of disposals) { try { d.dispose() } catch (e) {} }
    md.cleanup()
  }

  console.log('\n' + (failed ? '存在失败' : '全部通过 — T7 双后端门禁（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

/** 远端那张票现在的状态（脚本化 gh 的模型里直接读）。 */
function gT2TicketState(gh, key) {
  const t = gh.tickets.find((x) => String(x.number) === String(key))
  return t ? String(t.state) : ''
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
