// verify 1790 status surface : 本地 Markdown 读面带出状态与冲突（#1790 缺陷 A 的 P4）
//
// 判据（先写判据再实现）：
// 一、deck_issue_get 的 data.ticket 按需带 status / statusVisible / statusSource / statusConflict：
//     后端没读到的字段不出现；读到冲突票时四个字段的语义与 status.ts 的读侧约定一致。
// 二、deck_issue_list 的每一行：有 status 才给 status；statusConflict 是布尔、总是给（没有冲突为 false）；
//     text 里追加「其中状态冲突 N 张」；纯地图筛的薄地图行仍只有 key/title/state/url 四格，不加状态两格。
// 三、deck_map_snapshot 的 childRow（full）与 thinRow（thin）：同样有 status（有才给）与 statusConflict；
//     text 里带冲突数；data.map 容器一个字段都不加。
// 四、没有状态的票（普通票）在 get 里四格都不出现；在 list 里 status 不出现、statusConflict 仍显式为 false。
const path = require('path')
const fs = require('fs')
const os = require('os')
const urlLib = require('url')
const pathToFileURL = urlLib.pathToFileURL
const ROOT = path.resolve(__dirname, '..')
const stubLib = require('./lib/deck-decide-stub.js')
let failed = false
let total = 0
function check(ok, msg) { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
function imp(rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }
const TOOL_FILES = [
  ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
  ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list'],
  ['src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot', 'deck_map_snapshot']
]
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1790-surface-'))
  const plat = {
    path: path.posix,
    fs: {
      resolve: async function(p) { return String(p).split(path.sep).join('/') },
      readText: async function(t) { return fs.readFileSync(t, 'utf8') },
      writeText: async function(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      lstat: async function(t) { try { return fs.statSync(t) } catch (e) { return null } },
      listDir: async function(t) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      stat: async function(t) { try { return fs.statSync(t) } catch (e) { return null } }
    }
  }
  const rootPosix = root.split(path.sep).join('/')
  return {
    root: root,
    rootPosix: rootPosix,
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get: function(name) { return name === 'fs' ? plat.fs : undefined } },
    cleanup: function() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} }
  }
}
function ticketFilePath(wsRoot, dirName, key) {
  const idir = path.join(wsRoot, '.scratch', dirName, 'issues')
  let entries = []
  try { entries = fs.readdirSync(idir) } catch (e) { return '' }
  for (let i = 0; i < entries.length; i += 1) { if (entries[i].indexOf(key + '-') === 0) return path.join(idir, entries[i]) }
  return ''
}
// 整份重写票文件：用来造「可见 Status 行与隐藏 DSH-LABELS 不一致」的旧文件形态。
// 只写读侧解析要的那几行，不依赖写侧当前渲染（P2 正在并行改写侧，测试不跟它耦合）。
function writeTicketFile(filePath, opts) {
  const lines = ['<!-- DSH-FORMAT: md-v1 -->']
  if (opts.parent) lines.push('<!-- DSH-PARENT: ' + opts.parent + ' -->')
  lines.push('<!-- DSH-LABELS: ' + opts.labels + ' -->')
  lines.push('<!-- DSH-CREATED: 2026-01-01T00:00:00.000Z -->')
  lines.push('# ' + opts.title, '')
  if (opts.status) lines.push('**Status:** ' + opts.status, '')
  lines.push(opts.body)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8')
}
function rowOf(rows, key) {
  for (let i = 0; i < rows.length; i += 1) { if (String(rows[i].key) === String(key)) return rows[i] }
  return null
}
async function main() {
  console.log('1790 deck 读面状态字段（get / list / map snapshot）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.ts')
  const ws = makeWorkspace()
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: function() { return clock } })
  const gate = gateMod.createGate({ ledger: ledger, now: function() { return clock } })
  const registry = registryMod.createRegistry({ logEvent: function() {}, isEnabled: function() { return false }, platform: ws.ctx.platform, fs: ws.ctx.fs, cwd: ws.ctx.cwd, get: ws.ctx.get }, { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  stubLib.chooseWorkspace(ws.rootPosix, 'markdown')
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1790-surface-workpath-'))
  const bindings = workRouteMod.createWorkRouteBindings({ homeDir: workPathHome, now: function() { return clock }, readFile: function(p) { return fs.promises.readFile(p, 'utf8').then(function(t) { return t }, function() { return null }) }, writeFile: function(p, t) { return fs.promises.writeFile(p, t, 'utf8') }, mkdir: function(d) { return fs.promises.mkdir(d, { recursive: true }) } })
  const planTable = new Map()
  const planStore = { durable: true, load: function(id) { return planTable.get(String(id)) || null }, save: function(id, s) { planTable.set(String(id), s) } }
  const deps = { gate: gate, registry: registry, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: ws.ctx, handleFor: function() { return handle }, decideBackend: stubLib.makeDecideStub(registry), log: { fire: function() {} }, now: function() { return clock }, invalidate: function() {}, workRouteNote: function(i) { return bindings.note(i) }, workRouteRead: function(i) { return bindings.read(i) }, workRouteRelease: function(i) { return bindings.release(i) }, planStore: planStore }
  const exec = { agent: { session: { id: 's-1790-surface', cwd: ws.rootPosix } } }
  const tools2 = {}
  for (let ti = 0; ti < TOOL_FILES.length; ti += 1) {
    const mod = await imp(TOOL_FILES[ti][0])
    tools2[TOOL_FILES[ti][2]] = mod[TOOL_FILES[ti][1]](deps)
  }
  const callTool = async function(name, args) { return tools2[name].run(exec, args || {}) }
  const createdKey = function(r) { return String((r && r.data && r.data.ticket && r.data.ticket.key) || '') }
  const E = 'surface-effort'
  const F = 'surface-feature'
  const DEMO = 'demo'

  // ---- 造票：地图 + 两张子票 + 规格 + 两张实施票 + 缺陷票 + 普通票 ----
  const map = await callTool('deck_issue_create', { title: '状态读面演示地图', kind: 'map', effort: E, body: '## Destination 状态读面演示' })
  check(map && map.status === 'ok', '造票：地图')
  const child = await callTool('deck_issue_create', { title: '现成方案调研', kind: 'map-ticket', label: 'wayfinder:research', parentKey: '00', effort: E, body: '先把已知方案列出来' })
  const childKey = createdKey(child)
  check(!!childKey, '造票：地图子票 key=' + childKey)
  const childConflict = await callTool('deck_issue_create', { title: '状态冲突的子票', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '00', effort: E, body: '这张子票的可见状态与隐藏标签不一致' })
  const childConflictKey = createdKey(childConflict)
  check(!!childConflictKey, '造票：要改写成冲突的地图子票 key=' + childConflictKey)
  const spec = await callTool('deck_issue_create', { title: '状态读面演示规格', kind: 'spec', feature: F, body: '## 问题陈述 状态读面演示' })
  check(spec && spec.status === 'ok', '造票：规格')
  const implOld = await callTool('deck_issue_create', { title: '旧文件实施票', kind: 'spec-ticket', parentKey: '00', feature: F, body: '**What to build:** 读回旧文件的隐藏状态' })
  const implOldKey = createdKey(implOld)
  check(!!implOldKey, '造票：旧文件实施票 key=' + implOldKey)
  const implConflict = await callTool('deck_issue_create', { title: '冲突实施票', kind: 'spec-ticket', parentKey: '00', feature: F, body: '**What to build:** 读回可见与隐藏冲突' })
  const implConflictKey = createdKey(implConflict)
  check(!!implConflictKey, '造票：冲突实施票 key=' + implConflictKey)
  const bug = await callTool('deck_issue_create', { title: '兼容旧文件的缺陷票', kind: 'bug', effort: DEMO, body: '## 缺陷说明 可见状态与隐藏标签不一致' })
  const bugKey = createdKey(bug)
  check(!!bugKey, '造票：缺陷票 key=' + bugKey)
  const plain = await callTool('deck_issue_create', { title: '没有状态的普通票', kind: 'issue', effort: DEMO, body: '普通票没有状态，读面不该出现 state 之外的字段' })
  const plainKey = createdKey(plain)
  check(!!plainKey, '造票：普通票 key=' + plainKey)
  // 普通票也能有状态：再造一张、稍后改写成「可见 Status 与隐藏 triage 冲突」的旧文件形态。
  // 地图子票不行——它只认 claimed / resolved，可见值非法时按默认读，永远不产生冲突。
  const plainConflict = await callTool('deck_issue_create', { title: '状态冲突的普通票', kind: 'issue', effort: DEMO, body: '普通票的可见状态与隐藏标签不一致' })
  const plainConflictKey = createdKey(plainConflict)
  check(!!plainConflictKey, '造票：要改写成冲突的普通票 key=' + plainConflictKey)

  // ---- 改盘上文件造旧形态 ----
  const childConflictPath = ticketFilePath(ws.root, E, childConflictKey)
  check(!!childConflictPath, '找到冲突子票文件')
  writeTicketFile(childConflictPath, { parent: '00', labels: 'bug, needs-triage', status: 'wontfix', title: childConflictKey + ': 状态冲突的子票', body: '## What to build 状态冲突演示' })
  const implConflictPath = ticketFilePath(ws.root, F, implConflictKey)
  check(!!implConflictPath, '找到冲突实施票文件')
  writeTicketFile(implConflictPath, { parent: '00', labels: 'ready-for-agent', status: 'wontfix', title: implConflictKey + ': 冲突实施票', body: '**What to build:** 冲突演示' })
  const bugPath = ticketFilePath(ws.root, DEMO, bugKey)
  check(!!bugPath, '找到缺陷票文件')
  writeTicketFile(bugPath, { parent: '', labels: 'bug, needs-triage', status: 'ready-for-agent', title: bugKey + ': 兼容旧文件的缺陷票', body: '## 缺陷说明 可见状态是旧渲染器的默认值' })
  const plainPath = ticketFilePath(ws.root, DEMO, plainKey)
  check(!!plainPath, '找到普通票文件')
  // 写侧目前还会给新建普通票写一行可见 Status；这里整份改写成真正「没有状态」的票，
  // 只验读面的「无值不出现」，不跟 P2 正在改的写侧默认耦合。
  writeTicketFile(plainPath, { parent: '', labels: '', status: '', title: plainKey + ': 没有状态的普通票', body: '普通票没有状态，读面不该出现 state 之外的字段' })
  const plainConflictPath = ticketFilePath(ws.root, DEMO, plainConflictKey)
  check(!!plainConflictPath, '找到冲突普通票文件')
  writeTicketFile(plainConflictPath, { parent: '', labels: 'ready-for-agent', status: 'wontfix', title: plainConflictKey + ': 状态冲突的普通票', body: '普通票的可见状态与隐藏标签不一致' })
  // 旧文件实施票：可见 Status 写的是旧渲染器默认值 ready-for-agent，隐藏 DSH-LABELS 里也有一枚同值 triage；
  // 读侧约定（#1790 缺陷 A）：可见值是旧默认时不算冲突，状态来源记隐藏标签。
  const implOldPath = ticketFilePath(ws.root, F, implOldKey)
  check(!!implOldPath, '找到旧文件实施票文件')
  writeTicketFile(implOldPath, { parent: '00', labels: 'ready-for-agent', status: 'ready-for-agent', title: implOldKey + ': 旧文件实施票', body: '**What to build:** 读回旧文件的隐藏状态' })

  const expectConflictImpl = {
    field: 'status', visible: 'wontfix', hidden: ['ready-for-agent'], hiddenSource: 'DSH-LABELS',
    stateFromVisible: 'closed', stateFromHidden: 'open',
    resolution: { default: 'visible', rule: 'visible-status-wins', action: 'write-visible-status-on-next-write', history: 'DSH-STATUS-HISTORY' }
  }

  // ---- 一、deck_issue_get ----
  const gConflict = await callTool('deck_issue_get', { key: implConflictKey, feature: F })
  check(gConflict && gConflict.status === 'ok', 'get 冲突票 ok')
  const confTicket = (gConflict && gConflict.data && gConflict.data.ticket) || {}
  check(confTicket.status === 'wontfix', 'get 冲突票 status=可见值 wontfix（实得 ' + confTicket.status + '）')
  check(confTicket.statusSource === 'visible', 'get 冲突票 statusSource=visible（实得 ' + confTicket.statusSource + '）')
  check(!('statusVisible' in confTicket), 'get 冲突票不带 statusVisible（可见值被采用了）')
  check(JSON.stringify(confTicket.statusConflict) === JSON.stringify(expectConflictImpl), 'get 冲突票 statusConflict 形状与读侧约定一致（实得 ' + JSON.stringify(confTicket.statusConflict) + '）')
  check(confTicket.state === 'closed', 'get 冲突票 state 由 wontfix 派生为 closed（实得 ' + confTicket.state + '）')
  check(String(gConflict.text || '').indexOf('读回来了：状态 closed') >= 0, 'get 冲突票 text 仍按老格式报状态')

  const gOld = await callTool('deck_issue_get', { key: implOldKey, feature: F })
  check(gOld && gOld.status === 'ok', 'get 旧文件实施票 ok')
  const oldTicket = (gOld && gOld.data && gOld.data.ticket) || {}
  check(oldTicket.status === 'ready-for-agent', 'get 旧文件实施票 status=ready-for-agent（实得 ' + oldTicket.status + '）')
  check(oldTicket.statusSource === 'hidden', 'get 旧文件实施票 statusSource=hidden（实得 ' + oldTicket.statusSource + '）')
  check(!('statusVisible' in oldTicket), 'get 旧文件实施票可见值与采用值相同，不带 statusVisible')
  check(!('statusConflict' in oldTicket), 'get 旧文件实施票没有冲突时不带 statusConflict')
  check(oldTicket.body === (gOld.data && gOld.data.excerpt), 'get 的 data.ticket.body 仍是 2000 字摘录（与 excerpt 一致）')
  check(String(gOld.data && gOld.data.excerpt).length <= 2000, 'get 正文摘录仍不超过 2000 字')

  const gChild = await callTool('deck_issue_get', { key: childKey, effort: E })
  const childTicket = (gChild && gChild.data && gChild.data.ticket) || {}
  check(gChild && gChild.status === 'ok', 'get 地图子票 ok')
  check(childTicket.status === 'claimed', 'get 地图子票 status=claimed（实得 ' + childTicket.status + '）')
  // 建票时写侧已把默认值落成可见 Status: claimed（#1790 缺陷 A 的唯一真源），所以来源是可见行而不是默认值。
  check(childTicket.statusSource === 'visible', 'get 地图子票 statusSource=visible（实得 ' + childTicket.statusSource + '）')
  check(!('statusVisible' in childTicket) && !('statusConflict' in childTicket), 'get 地图子票不带 statusVisible / statusConflict')

  const gBug = await callTool('deck_issue_get', { key: bugKey, effort: DEMO })
  const bugTicket = (gBug && gBug.data && gBug.data.ticket) || {}
  check(gBug && gBug.status === 'ok', 'get 缺陷票 ok')
  check(bugTicket.status === 'needs-triage', 'get 缺陷票 status=needs-triage（隐藏标签采用，实得 ' + bugTicket.status + '）')
  check(bugTicket.statusSource === 'hidden', 'get 缺陷票 statusSource=hidden（实得 ' + bugTicket.statusSource + '）')
  check(bugTicket.statusVisible === 'ready-for-agent', 'get 缺陷票 statusVisible=可见值 ready-for-agent（实得 ' + bugTicket.statusVisible + '）')
  check(!('statusConflict' in bugTicket), 'get 缺陷票可见值是旧默认、不算冲突，不带 statusConflict')

  const gPlain = await callTool('deck_issue_get', { key: plainKey, effort: DEMO })
  const plainTicket = (gPlain && gPlain.data && gPlain.data.ticket) || {}
  check(gPlain && gPlain.status === 'ok', 'get 普通票 ok')
  check(!('status' in plainTicket) && !('statusSource' in plainTicket) && !('statusVisible' in plainTicket) && !('statusConflict' in plainTicket), 'get 普通票没有状态时四格一个都不出现（实得 status=' + plainTicket.status + '，source=' + plainTicket.statusSource + '）')

  // ---- 二、deck_issue_list ----
  const lF = await callTool('deck_issue_list', { state: 'all', feature: F })
  check(lF && lF.status === 'ok', 'list 规格目录 ok')
  const rowsF = (lF && lF.data && lF.data.issues) || []
  const rowImplOld = rowOf(rowsF, implOldKey)
  const rowImplConflict = rowOf(rowsF, implConflictKey)
  check(!!rowImplOld && !!rowImplConflict, 'list 规格目录里两张实施票都在')
  check(rowImplConflict && rowImplConflict.status === 'wontfix', 'list 冲突行 status=wontfix（实得 ' + (rowImplConflict && rowImplConflict.status) + '）')
  check(rowImplConflict && rowImplConflict.statusConflict === true, 'list 冲突行 statusConflict 是布尔 true')
  check(rowImplOld && rowImplOld.status === 'ready-for-agent', 'list 无冲突行 status=ready-for-agent（实得 ' + (rowImplOld && rowImplOld.status) + '）')
  check(rowImplOld && rowImplOld.statusConflict === false, 'list 无冲突行 statusConflict 显式 false（实得 ' + (rowImplOld && rowImplOld.statusConflict) + '）')
  check(rowImplConflict && !('statusVisible' in rowImplConflict) && !('statusSource' in rowImplConflict), 'list 行只带 status 与 statusConflict 两格，不带 statusVisible / statusSource')
  check(String(lF.text || '').indexOf('其中状态冲突 1 张') >= 0, 'list text 带「其中状态冲突 1 张」（实得 ' + lF.text + '）')

  const lE = await callTool('deck_issue_list', { state: 'all', effort: E })
  check(lE && lE.status === 'ok', 'list 地图目录 ok')
  const rowsE = (lE && lE.data && lE.data.issues) || []
  const rowChild = rowOf(rowsE, childKey)
  const rowChildConflict = rowOf(rowsE, childConflictKey)
  check(rowChild && rowChild.status === 'claimed' && rowChild.statusConflict === false, 'list 地图子票 status=claimed、statusConflict=false')
  // 地图子票只认 claimed / resolved：可见行写的 wontfix 是非法值，按默认 claimed 读，不产生冲突。
  check(rowChildConflict && rowChildConflict.status === 'claimed' && rowChildConflict.statusConflict === false, 'list 非法可见值的子票按 claimed 读、无冲突（实得 ' + (rowChildConflict && rowChildConflict.status) + ' / ' + (rowChildConflict && rowChildConflict.statusConflict) + '）')
  check(String(lE.text || '').indexOf('其中状态冲突 0 张') >= 0, 'list 地图目录 text 冲突数 0（实得 ' + lE.text + '）')

  const lAll = await callTool('deck_issue_list', { state: 'all' })
  check(lAll && lAll.status === 'ok', 'list 全仓 ok')
  const rowsAll = (lAll && lAll.data && lAll.data.issues) || []
  const plainRow = (function() {
    for (let i = 0; i < rowsAll.length; i += 1) { if (String(rowsAll[i].key) === plainKey && String(rowsAll[i].effortId) === DEMO) return rowsAll[i] }
    return null
  })()
  check(!!plainRow, 'list 全仓里有普通票行')
  check(plainRow && !('status' in plainRow), 'list 普通票没有 status 时不出 status 字段（实得 status=' + (plainRow && plainRow.status) + '）')
  check(plainRow && plainRow.statusConflict === false, 'list 普通票 statusConflict 仍显式 false')
  check(String(lAll.text || '').indexOf('其中状态冲突 2 张') >= 0, 'list 全仓 text 冲突数 2（实施票 1 张 + 普通票 1 张；实得 ' + lAll.text + '）')

  const lThin = await callTool('deck_issue_list', { state: 'all', labels: ['wayfinder:map'] })
  check(lThin && lThin.status === 'ok', 'list 纯地图筛（薄查）ok')
  const thinRows = (lThin && lThin.data && lThin.data.issues) || []
  check(thinRows.length === 1, '薄查只回 1 张地图（实得 ' + thinRows.length + '）')
  const thinRow = thinRows[0] || {}
  check('key' in thinRow && 'title' in thinRow && 'state' in thinRow && 'url' in thinRow, '薄地图行仍带 key/title/state/url 四格')
  check(!('status' in thinRow) && !('statusConflict' in thinRow), '薄地图行不加 status / statusConflict 两格')
  check(String(lThin.text || '').indexOf('状态冲突') < 0, '薄地图路 text 不加冲突数（薄行没有状态）')

  // ---- 三、deck_map_snapshot ----
  const snap = await callTool('deck_map_snapshot', { key: '00', effort: E })
  check(snap && snap.status === 'ok', 'map snapshot full ok')
  const kids = (snap && snap.data && snap.data.children) || []
  const kidChild = rowOf(kids, childKey)
  const kidConflict = rowOf(kids, childConflictKey)
  check(!!kidChild && !!kidConflict, 'snapshot 子票两张都在')
  check(kidChild && kidChild.status === 'claimed', 'snapshot childRow status=claimed（实得 ' + (kidChild && kidChild.status) + '）')
  check(kidChild && kidChild.statusConflict === false, 'snapshot childRow 无冲突时 statusConflict=false')
  check(kidConflict && kidConflict.status === 'claimed' && kidConflict.statusConflict === false, 'snapshot childRow 非法可见值的子票按 claimed 读、无冲突')
  check(kidChild && 'progress' in kidChild && 'progressDetail' in kidChild && 'originalWords' in kidChild, 'snapshot childRow 原有字段不变（progress / progressDetail / originalWords 都在）')
  const mapData = (snap && snap.data && snap.data.map) || {}
  check(!('status' in mapData) && !('statusConflict' in mapData), 'snapshot data.map 不加 status / statusConflict')
  check(String(snap.text || '').indexOf('其中状态冲突 0 张') >= 0, 'map snapshot text 带冲突数（地图子票不会冲突，恒为 0；实得 ' + snap.text + '）')

  const snapThin = await callTool('deck_map_snapshot', { key: '00', effort: E, detail: 'thin' })
  check(snapThin && snapThin.status === 'ok', 'map snapshot thin ok')
  const thinKids = (snapThin && snapThin.data && snapThin.data.children) || []
  const thinKidChild = rowOf(thinKids, childKey)
  const thinKidConflict = rowOf(thinKids, childConflictKey)
  check(thinKidChild && thinKidChild.status === 'claimed' && thinKidChild.statusConflict === false, 'snapshot thinRow 普通子票带 status 与 statusConflict=false')
  check(thinKidConflict && thinKidConflict.status === 'claimed' && thinKidConflict.statusConflict === false, 'snapshot thinRow 非法可见值的子票按 claimed 读、无冲突')
  check(thinKidChild && !('progress' in thinKidChild) && !('progressDetail' in thinKidChild) && !('originalWords' in thinKidChild), 'snapshot thinRow 仍不带正文进度与维护者原话')
  check(String(snapThin.text || '').indexOf('其中状态冲突 0 张') >= 0, 'map snapshot thin text 带冲突数（恒为 0）')

  ws.cleanup()
  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch (e) {}
  try { dispose.dispose() } catch (e) {}
  console.log(failed ? '存在失败 total=' + total : '全部通过 total=' + total)
  process.exit(failed ? 1 : 0)
}
main().catch(function(e) { console.error(String((e && e.stack) || e)); process.exit(1) })
