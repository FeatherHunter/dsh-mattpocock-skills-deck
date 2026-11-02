// tests/verify-1790-status-conflict.ts —— #1790 缺陷 A 的冲突判据：两处各说各话时，整次不写，按 retry 归一。
//
// 这一扇守四件事：
//   ① 读侧把真冲突原样带出来（可见 Status 行与隐藏 DSH-LABELS 里的 triage 各一枚且不同）。
//   ② 后端写侧遇到真冲突、调用方又没显式选状态时，整次拒绝，盘上一个字节都不动。
//   ③ deck 的 deck_issue_patch 遇到冲突整笔不写，回执带 data.statusConflict 与 data.retry；
//      按 data.retry.args 重试即可归一，resolveStatus: 'hidden' 也能选隐藏那侧。
//   ④ 同一次调用里的显式状态与 resolveStatus 选择不一致时 bad-args；没有冲突时传 resolveStatus 照常执行。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1790-status-conflict.ts

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1790-conflict-'))
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
/** 文件里 DSH-STATUS-HISTORY 的行（归一记账）。 */
function historyLines(text) {
  return String(text || '').split('\n').map(function(line) { return line.trim() }).filter(function(line) { return line.indexOf('<!-- DSH-STATUS-HISTORY:') === 0 })
}
/** 可见状态行的值；没有回空串。 */
function statusValue(text) {
  const m = /^[ \t]*(?:\*\*)?Status(?:\*\*)?[ \t]*[:：][ \t]*(\S.*?)[ \t]*$/m.exec(String(text || ''))
  return m ? m[1] : ''
}
/** 隐藏 DSH-LABELS 的值；没有这一行回空串。 */
function hiddenLabels(text) {
  const m = /<!--\s*DSH-LABELS:\s*([^>]*?)\s*-->/.exec(String(text || ''))
  return m ? m[1] : ''
}
/**
 * 把一张正常票改造成「真冲突」：可见 Status 行换成另一个合法状态，隐藏 DSH-LABELS 里补一枚 triage。
 * 这模拟旧版本把 triage 标签双写进 DSH-LABELS 的文件；新写侧只会在这种文件上遇到冲突。
 */
function doctorConflict(file, visible, hidden) {
  let text = fs.readFileSync(file, 'utf8')
  text = text.replace(/^(\*\*Status:\*\*[ \t]*)[^\n]*$/m, '$1' + visible)
  if (/<!--\s*DSH-LABELS:/.test(text)) text = text.replace(/<!--\s*DSH-LABELS:[^>]*-->/, '<!-- DSH-LABELS: ' + hidden + ' -->')
  else text = text.replace(/^(<!-- DSH-FORMAT: md-v1 -->\n)/m, '$1<!-- DSH-LABELS: ' + hidden + ' -->\n')
  fs.writeFileSync(file, text, 'utf8')
}
function repoOfFeature(feature) {
  return { backend: 'markdown', refId: '', name: '', url: '', effortId: feature, mdScene: 'feature' }
}
async function main() {
  console.log('1790 status conflict end to end')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.ts')
  const issuesMod = await imp('src/tracker/rooms/markdown/issues.ts')
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
  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1790-conflict-workpath-'))
  const bindings = workRouteMod.createWorkRouteBindings({ homeDir: workPathHome, now: function() { return clock }, readFile: function(p) { return fs.promises.readFile(p, 'utf8').then(function(t) { return t }, function() { return null }) }, writeFile: function(p, t) { return fs.promises.writeFile(p, t, 'utf8') }, mkdir: function(d) { return fs.promises.mkdir(d, { recursive: true }) } })
  const planTable = new Map()
  const planStore = { durable: true, load: function(id) { return planTable.get(String(id)) || null }, save: function(id, s) { planTable.set(String(id), s) } }
  const deps = { gate: gate, registry: registry, budget: budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: ws.ctx, handleFor: function() { return handle }, decideBackend: stubLib.makeDecideStub(registry), log: { fire: function() {} }, now: function() { return clock }, invalidate: function() {}, workRouteNote: function(i) { return bindings.note(i) }, workRouteRead: function(i) { return bindings.read(i) }, workRouteRelease: function(i) { return bindings.release(i) }, planStore: planStore }
  const exec = { agent: { session: { id: 's-1790-conflict', cwd: ws.rootPosix } } }
  const tools2 = {}
  for (let ti = 0; ti < TOOL_FILES.length; ti += 1) {
    const mod = await imp(TOOL_FILES[ti][0])
    tools2[TOOL_FILES[ti][2]] = mod[TOOL_FILES[ti][1]](deps)
  }
  const callTool = async function(name, args) { return tools2[name].run(exec, args || {}) }
  const readTicketFile = function(feature, key) {
    const dir = path.join(ws.root, '.scratch', feature, 'issues')
    let entries = []
    try { entries = fs.readdirSync(dir) } catch (e) { return '' }
    let hit = ''
    for (let i = 0; i < entries.length; i += 1) { if (entries[i].indexOf(key + '-') === 0) { hit = entries[i]; break } }
    if (!hit) return ''
    return fs.readFileSync(path.join(dir, hit), 'utf8')
  }
  const ticketPathOf = function(feature, key) {
    const dir = path.join(ws.root, '.scratch', feature, 'issues')
    let entries = []
    try { entries = fs.readdirSync(dir) } catch (e) { return '' }
    for (let i = 0; i < entries.length; i += 1) { if (entries[i].indexOf(key + '-') === 0) return path.join(dir, entries[i]) }
    return ''
  }
  const FEATURE = 'status-conflict-feature'
  const spec = await callTool('deck_issue_create', { title: '冲突演示规格', kind: 'spec', feature: FEATURE, body: '## 问题陈述 演示状态冲突' })
  check(spec && spec.status === 'ok', '造票规格 ok')
  // 冲突票：先由 deck 建一张正常实施票，再把它改造成旧版本双写的样子。
  const impl = await callTool('deck_issue_create', { title: '冲突票', kind: 'spec-ticket', parentKey: '00', feature: FEATURE, body: '**What to build:** 演示冲突。' })
  const implKey = String((impl.data && impl.data.ticket && impl.data.ticket.key) || '')
  check(!!implKey, '造票实施票 ok key=' + implKey)
  const implPath = ticketPathOf(FEATURE, implKey)
  doctorConflict(implPath, 'wontfix', 'ready-for-agent')
  const conflictBefore = readTicketFile(FEATURE, implKey)
  check(/^\*\*Status:\*\* wontfix$/m.test(conflictBefore) && hiddenLabels(conflictBefore) === 'ready-for-agent', '前置：票被改造成可见 wontfix + 隐藏 ready-for-agent')

  // ══ 一、读侧把真冲突原样带出来 ══
  const read = await callTool('deck_issue_get', { key: implKey, feature: FEATURE })
  const ticket = (read && read.data && read.data.ticket) || {}
  check(read && read.status === 'ok', '① 读票 ok')
  check(ticket.status === 'wontfix' && ticket.statusSource === 'visible', '① 有效状态读可见行：' + JSON.stringify({ status: ticket.status, source: ticket.statusSource }))
  check(ticket.state === 'closed', '① 状态落成两态 closed（wontfix 算关闭）：' + JSON.stringify(ticket.state))
  const conflict = ticket.statusConflict
  const wantConflict = {
    field: 'status',
    visible: 'wontfix',
    hidden: ['ready-for-agent'],
    hiddenSource: 'DSH-LABELS',
    stateFromVisible: 'closed',
    stateFromHidden: 'open',
    resolution: { default: 'visible', rule: 'visible-status-wins', action: 'write-visible-status-on-next-write', history: 'DSH-STATUS-HISTORY' }
  }
  check(!!conflict, '① 读侧带出 statusConflict')
  check(JSON.stringify(conflict) === JSON.stringify(wantConflict), '① 冲突对象逐字齐全：' + JSON.stringify(conflict))

  // ══ 二、后端写侧：没显式选状态时整次拒绝，盘上一个字节都不动 ══
  const featureRepo = repoOfFeature(FEATURE)
  const labelsRefused = await issuesMod.setLabelsIssue(ws.ctx, featureRepo, implKey, ['front-end'], {})
  check(!!(labelsRefused && labelsRefused.ok === false && labelsRefused.error && labelsRefused.error.kind === 'parse'), '② 后端 setLabels 遇冲突拒绝（kind=parse）：' + JSON.stringify(labelsRefused && !labelsRefused.ok ? labelsRefused.error.kind : labelsRefused))
  check(readTicketFile(FEATURE, implKey) === conflictBefore, '② setLabels 被拒后文件一个字节都不动')

  // ══ 三、deck：冲突回执形状与 retry ══
  const refused = await callTool('deck_issue_patch', { key: implKey, feature: FEATURE, comment: '冲突回执演示' })
  check(refused && refused.ok === false, '③ 冲突时整笔没成（ok:false）')
  check(refused && refused.status === 'unsupported', '③ 回执 status=unsupported：' + String(refused && refused.status))
  check(refused && refused.reason === 'bad-args', '③ 回执 reason=bad-args：' + String(refused && refused.reason))
  check(!!(refused && Array.isArray(refused.items) && refused.items.length === 1 && refused.items[0].step === 'status' && refused.items[0].status === 'failed'), '③ items 一条 step=status 的失败项：' + JSON.stringify(refused && refused.items))
  check(!!(refused && refused.data && JSON.stringify(refused.data.statusConflict) === JSON.stringify(wantConflict)), '③ data.statusConflict 与读侧同一份：' + JSON.stringify(refused && refused.data && refused.data.statusConflict))
  const retry = refused && refused.data && refused.data.retry
  check(!!(retry && retry.tool === 'deck_issue_patch'), '③ data.retry.tool 指回 deck_issue_patch：' + JSON.stringify(retry && retry.tool))
  check(!!(retry && retry.args && retry.args.resolveStatus === 'visible' && retry.args.key === implKey && retry.args.feature === FEATURE && retry.args.comment === '冲突回执演示'), '③ data.retry.args 是原参数加 resolveStatus=visible：' + JSON.stringify(retry && retry.args))
  check(String(refused && refused.text || '').indexOf('data.retry') >= 0, '③ text 说明没有写入并按 data.retry 重试：' + String(refused && refused.text).slice(0, 120))
  check(readTicketFile(FEATURE, implKey) === conflictBefore, '③ 整笔被拒后文件一个字节都不动（评论没落盘）')
  check((readTicketFile(FEATURE, implKey).match(/^### (?!Status)/gm) || []).length === 0, '③ 冲突票里没有多出评论段')

  // ══ 四、按 retry 重试成功（选择可见那侧）══
  const retried = await callTool('deck_issue_patch', retry.args)
  check(retried && retried.status === 'ok', '④ 按 data.retry.args 重试成功：' + JSON.stringify(retried && retried.status))
  const afterVisible = readTicketFile(FEATURE, implKey)
  check(/^\*\*Status:\*\* wontfix$/m.test(afterVisible), '④ 可见状态按选择留下 wontfix')
  check(hiddenLabels(afterVisible) === '', '④ 隐藏 DSH-LABELS 里的 triage 被清掉（只留非 triage，这里是空）：' + JSON.stringify(hiddenLabels(afterVisible)))
  const historyAfterVisible = historyLines(afterVisible)
  check(historyAfterVisible.length === 1 && historyAfterVisible[0].indexOf('source=hidden') >= 0 && historyAfterVisible[0].indexOf('discarded=ready-for-agent') >= 0 && historyAfterVisible[0].indexOf('adopted=wontfix') >= 0, '④ 落选的隐藏值记进历史：' + JSON.stringify(historyAfterVisible))
  check(countOcc(afterVisible, '### ') >= 1, '④ 这次评论落盘了')
  const reread = await callTool('deck_issue_get', { key: implKey, feature: FEATURE })
  check(!!(reread && reread.status === 'ok' && reread.data && reread.data.ticket && reread.data.ticket.statusConflict === undefined), '④ 归一后再读不再冲突')
  check(!!(reread && reread.data && reread.data.ticket && reread.data.ticket.status === 'wontfix' && reread.data.ticket.state === 'closed'), '④ 归一后状态仍是 wontfix / closed')

  // ══ 五、resolveStatus: 'hidden' 选隐藏那侧 ══
  const impl2 = await callTool('deck_issue_create', { title: '冲突票二', kind: 'spec-ticket', parentKey: '00', feature: FEATURE, body: '**What to build:** 演示按隐藏侧归一。' })
  const impl2Key = String((impl2.data && impl2.data.ticket && impl2.data.ticket.key) || '')
  check(!!impl2Key, '造票实施票二 ok key=' + impl2Key)
  doctorConflict(ticketPathOf(FEATURE, impl2Key), 'wontfix', 'ready-for-agent')
  const hiddenChoice = await callTool('deck_issue_patch', { key: impl2Key, feature: FEATURE, resolveStatus: 'hidden', comment: '按隐藏侧归一' })
  check(hiddenChoice && hiddenChoice.status === 'ok', '⑤ resolveStatus=hidden 重试成功：' + JSON.stringify(hiddenChoice && hiddenChoice.status))
  const afterHidden = readTicketFile(FEATURE, impl2Key)
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(afterHidden), '⑤ 可见状态行被改成隐藏侧的 ready-for-agent')
  check(hiddenLabels(afterHidden) === '', '⑤ 隐藏 DSH-LABELS 里的 triage 清掉')
  const historyAfterHidden = historyLines(afterHidden)
  check(historyAfterHidden.length === 1 && historyAfterHidden[0].indexOf('source=visible') >= 0 && historyAfterHidden[0].indexOf('discarded=wontfix') >= 0 && historyAfterHidden[0].indexOf('adopted=ready-for-agent') >= 0, '⑤ 落选的可见值记进历史：' + JSON.stringify(historyAfterHidden))
  const rereadHidden = await callTool('deck_issue_get', { key: impl2Key, feature: FEATURE })
  check(!!(rereadHidden && rereadHidden.status === 'ok' && rereadHidden.data && rereadHidden.data.ticket && rereadHidden.data.ticket.state === 'open'), '⑤ 归一后按 ready-for-agent 读成 open')

  // ══ 六、显式状态与 resolveStatus 选择不一致：bad-args，不写 ══
  const impl3 = await callTool('deck_issue_create', { title: '冲突票三', kind: 'spec-ticket', parentKey: '00', feature: FEATURE, body: '**What to build:** 演示选择不一致。' })
  const impl3Key = String((impl3.data && impl3.data.ticket && impl3.data.ticket.key) || '')
  check(!!impl3Key, '造票实施票三 ok key=' + impl3Key)
  doctorConflict(ticketPathOf(FEATURE, impl3Key), 'wontfix', 'ready-for-agent')
  const before3 = readTicketFile(FEATURE, impl3Key)
  const closeRefused = await issuesMod.closeIssue(ws.ctx, featureRepo, impl3Key, { reason: '冲突时关票' })
  check(!!(closeRefused && closeRefused.ok === false && closeRefused.error && closeRefused.error.kind === 'parse'), '⑥ 后端 close 遇冲突也拒绝（kind=parse）：' + JSON.stringify(closeRefused && !closeRefused.ok ? closeRefused.error.kind : closeRefused))
  check(readTicketFile(FEATURE, impl3Key) === before3, '⑥ close 被拒后文件一个字节都不动，也没有评论落盘')
  const mismatch = await callTool('deck_issue_patch', { key: impl3Key, feature: FEATURE, resolveStatus: 'visible', addLabels: ['needs-triage'], comment: '不一致演示' })
  check(mismatch && mismatch.status === 'unsupported' && mismatch.reason === 'bad-args', '⑥ 显式 triage 与 resolveStatus=visible 不一致 bad-args：' + JSON.stringify({ status: mismatch && mismatch.status, reason: mismatch && mismatch.reason }))
  check(readTicketFile(FEATURE, impl3Key) === before3, '⑥ 不一致被拒后文件一个字节都不动')
  const badChoice = await callTool('deck_issue_patch', { key: impl3Key, feature: FEATURE, resolveStatus: 'both', comment: '非法选择演示' })
  check(badChoice && badChoice.status === 'unsupported' && badChoice.reason === 'bad-args', '⑥ resolveStatus 只接受 visible/hidden：' + JSON.stringify(badChoice && badChoice.reason))
  check(readTicketFile(FEATURE, impl3Key) === before3, '⑥ 非法选择被拒后文件一个字节都不动')

  // ══ 七、没有冲突时：resolveStatus 照常执行；removeLabels 摘 triage 不清状态 ══
  const impl4 = await callTool('deck_issue_create', { title: '正常票', kind: 'spec-ticket', parentKey: '00', feature: FEATURE, body: '**What to build:** 没有冲突。' })
  const impl4Key = String((impl4.data && impl4.data.ticket && impl4.data.ticket.key) || '')
  check(!!impl4Key, '造票正常实施票 ok key=' + impl4Key)
  const noConflict = await callTool('deck_issue_patch', { key: impl4Key, feature: FEATURE, resolveStatus: 'hidden', comment: '无冲突也接受 resolveStatus' })
  check(noConflict && noConflict.status === 'ok', '⑦ 没有冲突时传 resolveStatus 照常执行：' + JSON.stringify(noConflict && noConflict.status))
  check(countOcc(readTicketFile(FEATURE, impl4Key), '### ') >= 1, '⑦ 无冲突时评论照常落盘')
  const beforeRemove = readTicketFile(FEATURE, impl4Key)
  const removed = await callTool('deck_issue_patch', { key: impl4Key, feature: FEATURE, removeLabels: ['ready-for-agent'] })
  check(removed && removed.status === 'ok', '⑦ 只摘 triage 标签仍执行成功：' + JSON.stringify(removed && removed.status))
  const notes = (removed && removed.notes) || []
  check(notes.some(function(n) { return String(n).indexOf('摘标签不会清掉状态') >= 0 }), '⑦ 回执说明摘 triage 不会清掉状态：' + JSON.stringify(notes))
  check(/^\*\*Status:\*\* ready-for-agent$/m.test(readTicketFile(FEATURE, impl4Key)), '⑦ 摘标签后可见状态仍是 ready-for-agent')

  ws.cleanup()
  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch (e) {}
  try { dispose.dispose() } catch (e) {}
  console.log(failed ? '存在失败 total=' + total : '全部通过 total=' + total)
  process.exit(failed ? 1 : 0)
}
main().catch(function(e) { console.error(String((e && e.stack) || e)); process.exit(1) })
