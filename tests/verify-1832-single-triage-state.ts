// tests/verify-1832-single-triage-state.ts —— #1832 缺陷的回归门禁：一张票同一时刻只有一枚 triage 状态。
//
// 这一扇守八件事（对应票面验收标准 a~f，另加标签名大小写与批量建图两条）：
//   a) 建票时显式给了一枚状态（needs-info），就按调用方的来，不再叠位置默认的 needs-triage；
//      规格下的实施票显式给 needs-info 时也不再叠 ready-for-agent。
//   b) 对一枚已有 needs-triage 的票 addLabels 一枚 ready-for-agent：状态被替换，旧标签从票上摘掉，
//      回执写明摘了哪几枚 —— 不是两枚并存；标签名大小写不同（Ready-For-Agent）算同一枚。
//   c) 一次请求给两枚以上 triage 状态（建票、改标签、批量建图的地图本体都算）：整笔拒绝，票面一个标签都不动。
//   d) 没有显式状态时位置默认照旧补（缺陷票仍是 bug + needs-triage）。
//   e) 本地 Markdown 房的行为不回归：票文件里仍只有一条可见 Status 行，隐藏 DSH-LABELS 只留非 triage，
//      读侧合成回来的标签里恰有一枚 triage。
//   f) 批量建图（deck_map_plan_create）时地图本体与子票都显式给状态：按调用方的来、不叠位置默认，
//      建后读回核对通过；地图容器的状态只写进文件头隐藏 DSH-STATUS。
//
// 跑法（在插件根目录执行）：
//   node --import ./scripts/ts-hook.mts tests/verify-1832-single-triage-state.ts
//   链上跑不用手写 --import：scripts/verify-chain.ts 与 scripts/verify-parallel.mts 会自动挂钩子。
//
// 门禁归属: src/deck/rules/label-names.ts
// 门禁归属: src/deck/rules/triage-state.ts
// 门禁归属: src/deck/rules/object-kind.ts
// 门禁归属: src/deck/rules/minimal-spec.ts
// 门禁归属: src/deck/tools/issue-create.ts
// 门禁归属: src/deck/tools/issue-patch.ts
// 门禁归属: src/deck/tools/issue-patch-labels.ts
// 门禁归属: src/deck/tools/map-plan-create.ts
// 门禁归属: src/deck/tools/map-plan-readback.ts
// 门禁归属: src/tracker/contract/triage-states.ts
// 门禁归属: src/tracker/rooms/markdown/issues-create.ts
// 门禁归属: src/tracker/rooms/markdown/status-create.ts
// 门禁归属: src/tracker/rooms/markdown/status-write.ts
// 门禁归属: src/tracker/rooms/markdown/issues-patch.ts

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
  ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
  ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create']
]
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1832-triage-'))
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
/** 可见状态行的值；没有回空串。 */
function statusValue(text) {
  const m = /^[ \t]*(?:\*\*)?Status[ \t]*[:：][ \t]*\*{0,2}[ \t]*(\S.*?)[ \t]*$/m.exec(String(text || ''))
  return m ? m[1] : ''
}
/** 隐藏 DSH-LABELS 的值；没有这一行回空串。 */
function hiddenLabels(text) {
  const m = /<!--\s*DSH-LABELS:\s*([^>]*?)\s*-->/.exec(String(text || ''))
  return m ? m[1] : ''
}
/** 文件头隐藏 DSH-STATUS 的值（容器用；票形文件的状态写在可见 Status 行）；没有回空串。 */
function hiddenStatus(text) {
  const m = /<!--\s*DSH-STATUS:\s*([^>]*?)\s*-->/.exec(String(text || ''))
  return m ? m[1] : ''
}
// 五枚状态名单在 main 里从契约层装入（门禁与 deck 用同一份），这里先留空，不在测试里手抄第二份。
let TRIAGE = []
/** 这份标签名单里的 triage 状态（大小写不敏感）；用来数「几枚状态」。 */
function triageStatesOf(names) {
  const out = []
  for (const one of names) {
    const low = String(one).trim().toLowerCase()
    if (TRIAGE.indexOf(low) >= 0 && out.indexOf(low) < 0) out.push(low)
  }
  return out
}
function labelNamesOf(issue) {
  const list = issue && Array.isArray(issue.labels) ? issue.labels : []
  return list.map(function(one) { return one && typeof one === 'object' && one.name !== undefined ? String(one.name) : String(one) })
}
function repoOfFeature(feature) {
  return { backend: 'markdown', refId: '', name: '', url: '', effortId: feature, mdScene: 'feature' }
}
async function main() {
  console.log('1832 single triage state end to end')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.ts')
  // 五枚状态名单从契约层取（deck 与各后端认的就是这一份），不在测试里手抄第二份。
  const contractMod = await imp('src/tracker/contract/triage-states.ts')
  TRIAGE = contractMod.TRIAGE_STATE_LABELS.slice()
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
  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1832-triage-workpath-'))
  const bindings = workRouteMod.createWorkRouteBindings({ homeDir: workPathHome, now: function() { return clock }, readFile: function(p) { return fs.promises.readFile(p, 'utf8').then(function(t) { return t }, function() { return null }) }, writeFile: function(p, t) { return fs.promises.writeFile(p, t, 'utf8') }, mkdir: function(d) { return fs.promises.mkdir(d, { recursive: true }) } })
  const planTable = new Map()
  const planStore = { durable: true, load: function(id) { return planTable.get(String(id)) || null }, save: function(id, s) { planTable.set(String(id), s) } }
  const deps = { gate: gate, registry: registry, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: ws.ctx, handleFor: function() { return handle }, decideBackend: stubLib.makeDecideStub(registry), log: { fire: function() {} }, now: function() { return clock }, invalidate: function() {}, workRouteNote: function(i) { return bindings.note(i) }, workRouteRead: function(i) { return bindings.read(i) }, workRouteRelease: function(i) { return bindings.release(i) }, planStore: planStore }
  const exec = { agent: { session: { id: 's-1832-triage', cwd: ws.rootPosix } } }
  const tools2 = {}
  for (let ti = 0; ti < TOOL_FILES.length; ti += 1) {
    const mod = await imp(TOOL_FILES[ti][0])
    tools2[TOOL_FILES[ti][2]] = mod[TOOL_FILES[ti][1]](deps)
  }
  const callTool = async function(name, args) { return tools2[name].run(exec, args || {}) }
  const issuesDir = function(feature) { return path.join(ws.root, '.scratch', feature || 'demo', 'issues') }
  const countFiles = function(feature) { try { return fs.readdirSync(issuesDir(feature)).length } catch (e) { return 0 } }
  const ticketPathOf = function(feature, key) {
    const dir = issuesDir(feature)
    let entries = []
    try { entries = fs.readdirSync(dir) } catch (e) { return '' }
    for (let i = 0; i < entries.length; i += 1) { if (entries[i].indexOf(key + '-') === 0) return path.join(dir, entries[i]) }
    return ''
  }
  const readTicketFile = function(feature, key) {
    const one = ticketPathOf(feature, key)
    return one ? fs.readFileSync(one, 'utf8') : ''
  }
  // 地图是 <effort>/map.md 的容器，不在 issues/ 里，按路径单独读（fixture 与 verify-1413 相同）。
  // f 用一块独立、干净的 effort 目录：地图目录里一旦有别的票，按父票列出来的张数就不是这一张地图的了（#1832 门禁自己踩过）。
  const MAP_EFFORT = 'triage-map'
  const MAP_FILE = path.join(ws.root, '.scratch', MAP_EFFORT, 'map.md')
  const readMapFile = function() { return fs.readFileSync(MAP_FILE, 'utf8') }
  const FEATURE = 'single-triage-feature'

  // ══ 造背景票：一张规格，演示规格下的实施票 ══
  const spec = await callTool('deck_issue_create', { title: '单状态演示规格', kind: 'spec', feature: FEATURE, body: '## 问题陈述 演示 triage 状态至多一枚' })
  check(spec && spec.status === 'ok', '造票规格 ok：' + JSON.stringify(spec && spec.status))

  // ══ a) 建票时显式给状态：用调用方那一枚，不叠位置默认 ══
  const a1 = await callTool('deck_issue_create', { title: '显式 needs-info 的缺陷票', kind: 'bug', labels: ['needs-info'], body: '**What to build:** 演示显式状态不被位置默认覆盖。' })
  const a1Key = String((a1 && a1.data && a1.data.ticket && a1.data.ticket.key) || '')
  check(a1 && a1.status === 'ok' && !!a1Key, 'a 建显式状态的缺陷票 ok key=' + a1Key)
  const a1Text = readTicketFile('demo', a1Key)
  check(statusValue(a1Text) === 'needs-info', 'a 可见 Status 行按调用方给的 needs-info：' + JSON.stringify(statusValue(a1Text)))
  check(hiddenLabels(a1Text) === 'bug', 'a 隐藏 DSH-LABELS 只留类型标签 bug（triage 不写隐藏名单）：' + JSON.stringify(hiddenLabels(a1Text)))
  const a1Read = await callTool('deck_issue_get', { key: a1Key })
  const a1Labels = labelNamesOf(a1Read && a1Read.data && a1Read.data.ticket)
  const a1States = triageStatesOf(a1Labels)
  check(a1Labels.indexOf('bug') >= 0, 'a 类型标签 bug 仍在：' + JSON.stringify(a1Labels))
  check(a1States.length === 1 && a1States[0] === 'needs-info', 'a 标签里恰有一枚 triage 状态且是 needs-info（没有 needs-triage）：' + JSON.stringify(a1Labels))
  check(a1Labels.indexOf('needs-triage') < 0, 'a 没有把位置默认的 needs-triage 叠上去：' + JSON.stringify(a1Labels))
  const a1Notes = (a1 && a1.notes) || []
  check(a1Notes.some(function(n) { return String(n).indexOf('bug') >= 0 }) && !a1Notes.some(function(n) { return String(n).indexOf('needs-triage') >= 0 }), 'a 回执只补了 bug 这一枚：' + JSON.stringify(a1Notes))

  // a2) 规格下的实施票显式给 needs-info：不叠位置默认的 ready-for-agent。
  const a2 = await callTool('deck_issue_create', { title: '显式 needs-info 的实施票', kind: 'spec-ticket', parentKey: '00', feature: FEATURE, labels: ['needs-info'], body: '**What to build:** 演示实施票的默认状态让路。' })
  const a2Key = String((a2 && a2.data && a2.data.ticket && a2.data.ticket.key) || '')
  check(a2 && a2.status === 'ok' && !!a2Key, 'a2 建显式状态的实施票 ok key=' + a2Key)
  const a2Text = readTicketFile(FEATURE, a2Key)
  check(statusValue(a2Text) === 'needs-info', 'a2 实施票可见 Status 行是 needs-info：' + JSON.stringify(statusValue(a2Text)))
  const a2Read = await callTool('deck_issue_get', { key: a2Key, feature: FEATURE })
  const a2Labels = labelNamesOf(a2Read && a2Read.data && a2Read.data.ticket)
  const a2States = triageStatesOf(a2Labels)
  check(a2States.length === 1 && a2States[0] === 'needs-info', 'a2 实施票标签里恰有一枚 triage 状态且是 needs-info（没有 ready-for-agent）：' + JSON.stringify(a2Labels))

  // ══ d) 没有显式状态时，位置默认照旧补 ══
  const d = await callTool('deck_issue_create', { title: '默认状态的缺陷票', kind: 'bug', body: '**What to build:** 演示位置默认仍在。' })
  const dKey = String((d && d.data && d.data.ticket && d.data.ticket.key) || '')
  check(d && d.status === 'ok' && !!dKey, 'd 建默认缺陷票 ok key=' + dKey)
  const dText = readTicketFile('demo', dKey)
  check(statusValue(dText) === 'needs-triage', 'd 默认缺陷票可见状态仍是 needs-triage：' + JSON.stringify(statusValue(dText)))
  const dRead = await callTool('deck_issue_get', { key: dKey })
  const dLabels = labelNamesOf(dRead && dRead.data && dRead.data.ticket)
  const dStates = triageStatesOf(dLabels)
  check(dLabels.indexOf('bug') >= 0 && dStates.length === 1 && dStates[0] === 'needs-triage', 'd 默认缺陷票标签是 bug + needs-triage：' + JSON.stringify(dLabels))
  const dNotes = (d && d.notes) || []
  check(dNotes.some(function(n) { return String(n).indexOf('补了必备标签') >= 0 }), 'd 回执写明补了必备标签：' + JSON.stringify(dNotes))

  // ══ b) 改标签：addLabels 带新状态=替换旧状态，回执写明摘了哪几枚 ══
  const b = await callTool('deck_issue_patch', { key: dKey, addLabels: ['ready-for-agent'], comment: '把状态从等待诊断推进到可接' })
  check(b && b.status === 'ok', 'b 改标签 ok：' + JSON.stringify(b && b.status))
  const bText = readTicketFile('demo', dKey)
  check(statusValue(bText) === 'ready-for-agent', 'b 可见状态行换成 ready-for-agent：' + JSON.stringify(statusValue(bText)))
  check(hiddenLabels(bText) === 'bug', 'b 隐藏 DSH-LABELS 仍只留 bug：' + JSON.stringify(hiddenLabels(bText)))
  const bRead = await callTool('deck_issue_get', { key: dKey })
  const bLabels = labelNamesOf(bRead && bRead.data && bRead.data.ticket)
  const bStates = triageStatesOf(bLabels)
  check(bStates.length === 1 && bStates[0] === 'ready-for-agent', 'b 票上恰有一枚 triage 状态，且是 ready-for-agent：' + JSON.stringify(bLabels))
  check(bLabels.indexOf('needs-triage') < 0, 'b 旧状态 needs-triage 已从票上摘掉：' + JSON.stringify(bLabels))
  const bNotes = (b && b.notes) || []
  check(bNotes.some(function(n) { return String(n).indexOf('旧状态') >= 0 && String(n).indexOf('needs-triage') >= 0 }), 'b 回执写明摘掉了 needs-triage：' + JSON.stringify(bNotes))

  // ══ b2) 标签名大小写不同也算同一枚：Ready-For-Agent 与 ready-for-agent 不并存 ══
  const g = await callTool('deck_issue_create', { title: '大小写变体验证的缺陷票', kind: 'bug', body: '**What to build:** 演示标签名大小写不敏感。' })
  const gKey = String((g && g.data && g.data.ticket && g.data.ticket.key) || '')
  check(g && g.status === 'ok' && !!gKey, 'b2 造默认缺陷票 ok key=' + gKey)
  const gPatch = await callTool('deck_issue_patch', { key: gKey, addLabels: ['Ready-For-Agent'] })
  check(gPatch && gPatch.status === 'ok', 'b2 用大小写不同的标签名改状态 ok：' + JSON.stringify(gPatch && gPatch.status))
  const gFailed = ((gPatch && gPatch.items) || []).filter(function(it) { return it && it.status === 'failed' })
  check(gFailed.length === 0, 'b2 没有「整批替换没落全」这类失败项：' + JSON.stringify(gFailed))
  const gText = readTicketFile('demo', gKey)
  check(statusValue(gText) === 'ready-for-agent', 'b2 可见状态统一写成小写 ready-for-agent：' + JSON.stringify(statusValue(gText)))
  const gRead = await callTool('deck_issue_get', { key: gKey })
  const gLabels = labelNamesOf(gRead && gRead.data && gRead.data.ticket)
  const gStates = triageStatesOf(gLabels)
  check(gStates.length === 1 && gStates[0] === 'ready-for-agent', 'b2 票上恰一枚 triage 状态（大小写算同一枚）：' + JSON.stringify(gLabels))
  const gNotes = (gPatch && gPatch.notes) || []
  check(gNotes.some(function(n) { return String(n).indexOf('needs-triage') >= 0 }), 'b2 回执写明摘掉了 needs-triage：' + JSON.stringify(gNotes))

  // ══ c) 一次给两枚以上状态：整笔拒绝，票面一个标签都不动 ══
  const beforeCreateCount = countFiles('demo')
  const c1 = await callTool('deck_issue_create', { title: '两枚状态的缺陷票', kind: 'bug', labels: ['needs-triage', 'needs-info'], body: '**What to build:** 演示建票拒绝。' })
  check(c1 && c1.status === 'unsupported' && c1.reason === 'bad-args', 'c1 建票给两枚状态被拒（bad-args）：' + JSON.stringify({ status: c1 && c1.status, reason: c1 && c1.reason }))
  check(String(c1 && c1.text || '').indexOf('五选一') >= 0 && String(c1 && c1.text || '').indexOf('只留一枚') >= 0, 'c1 拒绝原因说清「五选一、只留一枚」：' + String(c1 && c1.text).slice(0, 160))
  check(String(c1 && c1.text || '').indexOf('这张票没建') >= 0, 'c1 拒绝原因写明这张票没建')
  check(countFiles('demo') === beforeCreateCount, 'c1 被拒后盘上一张票都没多建：' + beforeCreateCount + ' → ' + countFiles('demo'))
  const c2 = await callTool('deck_issue_create', { title: '两枚状态的普通票', kind: 'issue', labels: ['ready-for-human', 'wontfix'], body: '**What to build:** 演示普通票也拒绝。' })
  check(c2 && c2.status === 'unsupported' && c2.reason === 'bad-args', 'c2 普通票给两枚状态同样被拒：' + JSON.stringify({ status: c2 && c2.status, reason: c2 && c2.reason }))
  check(countFiles('demo') === beforeCreateCount, 'c2 被拒后盘上一张票都没多建')

  const beforePatch = readTicketFile('demo', dKey)
  const c3 = await callTool('deck_issue_patch', { key: dKey, addLabels: ['needs-info', 'ready-for-human'] })
  check(c3 && c3.status === 'unsupported' && c3.reason === 'bad-args', 'c3 改标签给两枚状态被拒（bad-args）：' + JSON.stringify({ status: c3 && c3.status, reason: c3 && c3.reason }))
  check(String(c3 && c3.text || '').indexOf('五选一') >= 0, 'c3 拒绝原因说清只能留一枚：' + String(c3 && c3.text).slice(0, 160))
  check(String(c3 && c3.text || '').indexOf('没写盘') >= 0, 'c3 拒绝原因写明一个字都没写：' + String(c3 && c3.text).slice(0, 200))
  check(readTicketFile('demo', dKey) === beforePatch, 'c3 被拒后票文件一个字节都不动')

  // c4) 批量建图的地图本体一次给两枚状态：整批拒绝，一张票都不动。
  const beforeMapCount = countFiles('demo')
  const c4 = await callTool('deck_map_plan_create', { title: '两枚状态的地图骨架', planId: 'plan-1832-c4', labels: ['needs-triage', 'needs-info'], children: [{ key: 'child-bug', title: '子票：演示拒绝', kind: 'bug' }] })
  check(c4 && c4.status === 'unsupported' && c4.reason === 'bad-args', 'c4 地图本体给两枚状态被拒（bad-args）：' + JSON.stringify({ status: c4 && c4.status, reason: c4 && c4.reason }))
  check(String(c4 && c4.text || '').indexOf('五选一') >= 0 && String(c4 && c4.text || '').indexOf('只留一枚') >= 0, 'c4 拒绝原因说清「五选一、只留一枚」：' + String(c4 && c4.text).slice(0, 160))
  check(String(c4 && c4.text || '').indexOf('一张票都没动') >= 0, 'c4 拒绝原因写明一张票都没动')
  check(countFiles('demo') === beforeMapCount, 'c4 被拒后盘上一张票都没多建：' + beforeMapCount + ' → ' + countFiles('demo'))

  // ══ f) 批量建图：地图本体与子票都显式给状态，按调用方的来，建后读回核对通过 ══
  const f = await callTool('deck_map_plan_create', { title: '显式状态的演示地图', planId: 'plan-1832-f', effort: MAP_EFFORT, labels: ['needs-info'], children: [{ key: 'explicit-bug', title: '显式 needs-info 的子票', kind: 'bug', labels: ['needs-info'] }] })
  check(f && f.status === 'ok', 'f 建图 ok：' + JSON.stringify({ status: f && f.status, text: String(f && f.text || '').slice(0, 200) }))
  const fNotes = (f && f.notes) || []
  check(fNotes.some(function(n) { return String(n).indexOf('建后读回核对通过') >= 0 }), 'f 回执写明建后读回核对通过：' + JSON.stringify(fNotes))
  check(!fNotes.some(function(n) { return String(n).indexOf('缺标签') >= 0 }), 'f 读回核对没有报「缺标签」（显式状态不叠位置默认）：' + JSON.stringify(fNotes))
  const fMapKey = String((f && f.data && f.data.mapKey) || '')
  check(!!fMapKey, 'f 回执带地图票号 key=' + fMapKey)
  if (fMapKey) {
    const mapText = readMapFile()
    check(hiddenStatus(mapText) === 'needs-info', 'f 地图容器的状态只写在文件头隐藏 DSH-STATUS，且是 needs-info：' + JSON.stringify(hiddenStatus(mapText)))
    const mapLabels = hiddenLabels(mapText)
    check(mapLabels.indexOf('wayfinder:map') >= 0, 'f 地图容器仍带位置类型标签 wayfinder:map：' + JSON.stringify(mapLabels))
    check(mapLabels.indexOf('needs-triage') < 0, 'f 地图容器没有被叠上位置默认的 needs-triage：' + JSON.stringify(mapLabels))
  }
  const fChild = {}
  for (const it of ((f && f.items) || [])) { if (it && it.role === 'child' && it.status === 'ok' && it.planKey) fChild[String(it.planKey)] = String(it.key) }
  const fChildKey = String(fChild['explicit-bug'] || '')
  check(!!fChildKey, 'f 回执明细里有子票 explicit-bug → 票号（实得 ' + JSON.stringify(fChild) + '）')
  if (fChildKey) {
    const fText = readTicketFile(MAP_EFFORT, fChildKey)
    check(statusValue(fText) === 'needs-info', 'f 子票可见状态是 needs-info（不叠位置默认）：' + JSON.stringify(statusValue(fText)))
    check(hiddenLabels(fText) === 'bug', 'f 子票隐藏 DSH-LABELS 只留 bug：' + JSON.stringify(hiddenLabels(fText)))
  }

  // ══ e) 本地 Markdown 房不回归：一条可见 Status 行、隐藏名单不含 triage、读侧恰一枚状态 ══
  const finalText = readTicketFile('demo', dKey)
  check(countOcc(finalText, '**Status:**') === 1, 'e 票文件里只有一条可见 Status 行：' + countOcc(finalText, '**Status:**'))
  const finalHidden = hiddenLabels(finalText)
  check(triageStatesOf(finalHidden.split(',').map(function(s) { return s.trim() })).length === 0, 'e 隐藏 DSH-LABELS 里不含任何 triage 状态：' + JSON.stringify(finalHidden))
  check(finalHidden.trim() === 'bug', 'e 隐藏 DSH-LABELS 只留非 triage 的 bug：' + JSON.stringify(finalHidden))
  const finalRead = await callTool('deck_issue_get', { key: dKey })
  const finalLabels = labelNamesOf(finalRead && finalRead.data && finalRead.data.ticket)
  check(triageStatesOf(finalLabels).length === 1, 'e 读侧合成回来的标签里恰有一枚 triage：' + JSON.stringify(finalLabels))
  check(!!(finalRead && finalRead.data && finalRead.data.ticket && finalRead.data.ticket.statusConflict === undefined), 'e 读侧没有状态冲突（写侧只写了一条状态）')

  ws.cleanup()
  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch (e) {}
  try { dispose.dispose() } catch (e) {}
  console.log(failed ? '存在失败 total=' + total : '全部通过 total=' + total)
  process.exit(failed ? 1 : 0)
}
main().catch(function(e) { console.error(String((e && e.stack) || e)); process.exit(1) })
