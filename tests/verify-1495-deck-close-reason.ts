// verify 1495 full : deck closeReason end to end
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
  ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch']
]
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1495-'))
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
function sectionBody(text, heading) {
  const NL2 = String.fromCharCode(10)
  const lines2 = String(text || '').split(NL2)
  const want = '## ' + heading
  let start = -1
  for (let i = 0; i < lines2.length; i += 1) { if (lines2[i].trim() === want) { start = i; break } }
  if (start < 0) return ''
  const out = []
  for (let i = start + 1; i < lines2.length; i += 1) {
    const line = lines2[i]
    if (line.slice(0, 3) === '## ') break
    out.push(line)
  }
  return out.join(NL2)
}
function commentCount(text) {
  const body = sectionBody(text, 'Comments')
  const NL3 = String.fromCharCode(10)
  const parts = body.split(NL3)
  let n = 0
  for (let i = 0; i < parts.length; i += 1) { if (parts[i].slice(0, 4) === '### ') n += 1 }
  return n
}
function countOcc(hay, needle) {
  let n = 0
  let pos = 0
  while (true) {
    const at = String(hay).indexOf(needle, pos)
    if (at < 0) break
    n += 1
    pos = at + needle.length
  }
  return n
}
async function main() {
  console.log('1495 deck closeReason end to end')
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
  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1495-workpath-'))
  const bindings = workRouteMod.createWorkRouteBindings({ homeDir: workPathHome, now: function() { return clock }, readFile: function(p) { return fs.promises.readFile(p, 'utf8').then(function(t) { return t }, function() { return null }) }, writeFile: function(p, t) { return fs.promises.writeFile(p, t, 'utf8') }, mkdir: function(d) { return fs.promises.mkdir(d, { recursive: true }) } })
  const planTable = new Map()
  const planStore = { durable: true, load: function(id) { return planTable.get(String(id)) || null }, save: function(id, s) { planTable.set(String(id), s) } }
  const deps = { gate: gate, registry: registry, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: ws.ctx, handleFor: function() { return handle }, decideBackend: stubLib.makeDecideStub(registry), log: { fire: function() {} }, now: function() { return clock }, invalidate: function() {}, workRouteNote: function(i) { return bindings.note(i) }, workRouteRead: function(i) { return bindings.read(i) }, workRouteRelease: function(i) { return bindings.release(i) }, planStore: planStore }
  const exec = { agent: { session: { id: 's-1495', cwd: ws.rootPosix } } }
  const tools2 = {}
  for (let ti = 0; ti < TOOL_FILES.length; ti += 1) {
    const f = TOOL_FILES[ti][0]
    const fac = TOOL_FILES[ti][1]
    const nm = TOOL_FILES[ti][2]
    const mod = await imp(f)
    tools2[nm] = mod[fac](deps)
  }
  const callTool = async function(name, args) { return tools2[name].run(exec, args || {}) }
  const readTicketFile = function(effort, key) {
    const dir = path.join(ws.root, '.scratch', effort, 'issues')
    let entries = []
    try { entries = fs.readdirSync(dir) } catch (e) { return '' }
    let hit = ''
    for (let i = 0; i < entries.length; i += 1) { if (entries[i].indexOf(key + '-') === 0) { hit = entries[i]; break } }
    if (!hit) return ''
    return fs.readFileSync(path.join(dir, hit), 'utf8')
  }
  const readMapFile = function(effort) { try { return fs.readFileSync(path.join(ws.root, '.scratch', effort, 'map.md'), 'utf8') } catch (e) { return '' } }
  const EFFORT = 'close-reason-demo'
  const FEATURE = 'close-reason-feature'
  const map = await callTool('deck_issue_create', { title: '关闭原因演示地图', kind: 'map', effort: EFFORT, body: '## Destination 演示关闭原因透传' })
  check(map && map.status === 'ok', '造票地图 ok')
  const child = await callTool('deck_issue_create', { title: '现成方案有哪些', kind: 'map-ticket', label: 'wayfinder:research', parentKey: '00', effort: EFFORT, body: '先把已知方案列出来' })
  const childKey = String((child.data && child.data.ticket && child.data.ticket.key) || '')
  check(!!childKey, '造票子票 ok key=' + childKey)
  const spec = await callTool('deck_issue_create', { title: '关闭原因演示规格', kind: 'spec', feature: FEATURE, body: '## 问题陈述 演示实施票关闭原因' })
  check(spec && spec.status === 'ok', '造票规格 ok')
  const impl = await callTool('deck_issue_create', { title: '实施第一步', kind: 'spec-ticket', parentKey: '00', feature: FEATURE, body: '要构建什么 做第一步' })
  const implKey = String((impl.data && impl.data.ticket && impl.data.ticket.key) || '')
  check(!!implKey, '造票实施票 ok key=' + implKey)
  const reason1 = '现成方案够用，走查完成'
  const r1 = await callTool('deck_issue_patch', { key: childKey, effort: EFFORT, close: true, closeReason: reason1 })
  check(r1 && r1.status === 'ok', '地图子票带原因关闭 ok')
  const t1 = readTicketFile(EFFORT, childKey)
  check(t1.indexOf('Status: resolved') >= 0, '子票状态 resolved')
  check(t1.indexOf('## Answer') >= 0, '子票有 Answer 段')
  check(sectionBody(t1, 'Answer').indexOf(reason1) >= 0, 'Answer 含关闭原因')
  check(sectionBody(readMapFile(EFFORT), 'Decisions so far').indexOf('现成方案有哪些') >= 0, '地图指针追加')
  const rDup = await callTool('deck_issue_patch', { key: childKey, effort: EFFORT, close: true, closeReason: reason1 })
  check(rDup && rDup.status === 'ok', '重复关闭仍 ok')
  const tDup = readTicketFile(EFFORT, childKey)
  check(countOcc(tDup, '## Answer') === 1, '重复关闭只有一个 Answer')
  const reason2 = '第一步做完了'
  const r2 = await callTool('deck_issue_patch', { key: implKey, feature: FEATURE, close: true, closeReason: reason2 })
  check(r2 && r2.status === 'ok', '实施票带原因关闭 ok')
  const t2 = readTicketFile(FEATURE, implKey)
  check(t2.indexOf('**Status:** resolved') >= 0, '实施票加粗状态 resolved')
  check(t2.indexOf('## Answer') < 0, '实施票不写 Answer')
  check(t2.indexOf('Close reason') < 0, '实施票不写 Close reason 行')
  check(sectionBody(t2, 'Comments').indexOf(reason2) >= 0, '实施票评论含原因')
  check(commentCount(t2) === 1, '实施票评论一条')
  const child2 = await callTool('deck_issue_create', { title: '不带原因的子票', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '00', effort: EFFORT, body: '不带原因关一次' })
  const child2Key = String((child2.data && child2.data.ticket && child2.data.ticket.key) || '')
  const r3 = await callTool('deck_issue_patch', { key: child2Key, effort: EFFORT, close: true })
  check(r3 && r3.status === 'ok', '不带原因关闭 ok')
  const t3 = readTicketFile(EFFORT, child2Key)
  check(t3.indexOf('Status: resolved') >= 0, '不带原因状态照改')
  check(t3.indexOf('## Answer') < 0, '不带原因不写 Answer')
  const child3 = await callTool('deck_issue_create', { title: '只带原因不关票', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '00', effort: EFFORT, body: '只带原因不关' })
  const child3Key = String((child3.data && child3.data.ticket && child3.data.ticket.key) || '')
  const before3 = readTicketFile(EFFORT, child3Key)
  const r4 = await callTool('deck_issue_patch', { key: child3Key, effort: EFFORT, closeReason: '只有原因没说关票' })
  check(r4 && r4.reason === 'bad-args', '只带原因不带关票 bad-args')
  check(readTicketFile(EFFORT, child3Key) === before3, '被拒时文件不动')
  ws.cleanup()
  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch (e) {}
  try { dispose.dispose() } catch (e) {}
  console.log(failed ? '存在失败 total=' + total : '全部通过 total=' + total)
  process.exit(failed ? 1 : 0)
}
main().catch(function(e) { console.error(String((e && e.stack) || e)); process.exit(1) })
