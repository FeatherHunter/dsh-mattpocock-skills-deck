// tests/verify-1298-spec-close.ts —— #1298 门禁：规格的自动关闭权限（只许关、不许重开；三道闸）
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1298
// 门禁归属: src/deck/tools/issue-patch.ts
// 门禁归属: src/deck/shell/spec-close-guard.ts
// 门禁归属: src/deck/shell/call-shell.ts
// 门禁归属: config/prompts/map-advancement.yaml
// 门禁归属: config/prompts/ticket-action-templates.yaml
// 门禁归属: src/client/kernel/container-view.ts
// 跑法（从仓库根目录）: node --import ./scripts/ts-hook.mts tests/verify-1298-spec-close.ts
//
// 这份门禁守 #1298 八条验收里本票新落地的四条（⑤–⑧），顺带钉住前序票已落地的 ①–④：
//   ⑤ 关闭规格的触发条件只有「收口核对通过」一条，没有「看到子票都关了顺手关」的旁路：
//      真本地 Markdown 后端上跑「实施票没关 → 关不了」「子票都关了但没带核对评论 → 关不了」
//      「两件事齐了 → 关得成」；再加一条静态扫描：src/deck 下只有 issue-patch.ts 一处调 close/reopen。
//   ⑥ 实施票没全关时关闭必须失败，回执里写清缺哪几张实施票
//      （data.rule = spec-close-children-open，data.missing 逐张列出票号、标题、当前状态）。
//   ⑦ 关闭前必须留一条评论写明逐条核对结论：没评论的关闭被挡下；这道闸放在所有写动作之前，
//      所以被挡下时一个字都没动（评论也没发出去）。
//   ⑧ AI 工具面上允许关、不允许重开：close:false 在选后端之前就被拒（ai-tool-refused），
//      票仍是关闭态。
//   ① 实施票必须挂规格：kind=ticket 不带 parentKey 直接 bad-args；带上父票号建出来的票，
//      文件头注释写着 parentKey，读回来类型是普通票。
//   ③ 规格票与实施票的必备标签只有 ready-for-agent，不带 wayfinder: 系列。
//   ④ tpl.implement 首行 /implement、次行 {url}（起新会话注入的提示词模板）。
//   ⑤ 规格三态模板 specSplit / specExecute / specComplete 都在（本票只改 specComplete 的关闭节）。
//
// 做法：照抄 tests/verify-deck-tools.ts 的夹具 —— 真闸、真账本、真注册表、真本地 Markdown 后端，
// 票就是 .scratch/demo/issues/*.md 这些文件；不另写假的 tracker，避免「工具自己跟自己对账」。
// 测试文件只能写可被 Node 直接剥离的 TypeScript：不用 enum、不用构造函数参数属性、不用装饰器。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const TOOL_FILES = [
  ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
  ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list'],
  ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
]

/** 一个真实本地 Markdown 工作区：票就是 .scratch/demo/issues/*.md 这些文件（与 tests/verify-deck-tools.ts 同一套）。 */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1298-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
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
    root: root,
    rootPosix: rootPosix,
    issuesDir: path.join(dir, 'issues'),
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name) { return name === 'fs' ? plat.fs : undefined } },
    ticketFiles() { try { return fs.readdirSync(path.join(dir, 'issues')).filter((f) => f.endsWith('.md')) } catch (e) { return [] } },
    readTicket(name) { return fs.readFileSync(path.join(dir, 'issues', name), 'utf8') },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 静态扫描用：把 src 下某一棵目录里的手写源码都列出来（构建产物不在 src/deck 下，见 AGENTS.md「只留 TS」）。 */
function walkSources(dir, out) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return out }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) { walkSources(abs, out); continue }
    if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(abs)
  }
  return out
}

async function main() {
  console.log('#1298 门禁：规格三态与自动关闭权限（关规格三道闸 + 只关不重开）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.ts')

  const ws = makeWorkspace()
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const logs = []
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  chooseWorkspace(ws.rootPosix, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1298-workpath-'))
  const workRouteBindings = workRouteMod.createWorkRouteBindings({
    homeDir: workPathHome, now: () => clock,
    readFile: (p) => fs.promises.readFile(p, 'utf8').then((t) => t, () => null),
    writeFile: (p, t) => fs.promises.writeFile(p, t, 'utf8'),
    mkdir: (dir) => fs.promises.mkdir(dir, { recursive: true }),
  })
  const planTable = new Map()
  const planStore = { durable: true, load(id) { return planTable.get(String(id)) || null }, save(id, s) { planTable.set(String(id), s) } }
  const invalidated = []
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx, handleFor: () => handle,
    decideBackend: makeDecideStub(registry),
    log: { fire: (level, event, fields) => logs.push({ level: level, event: event, fields: fields }) },
    now: () => clock,
    invalidate: (info) => invalidated.push(info),
    workRouteNote: (input) => workRouteBindings.note(input),
    workRouteRead: (input) => workRouteBindings.read(input),
    workRouteRelease: (input) => workRouteBindings.release(input),
    planStore: planStore,
  }
  const exec = { agent: { session: { id: 's-1298', cwd: ws.rootPosix } } }
  const tools = {}
  for (const [file, factory, name] of TOOL_FILES) {
    const mod = await imp(file)
    if (typeof mod[factory] !== 'function') { check(false, file + ' 导出 ' + factory); continue }
    tools[name] = mod[factory](deps)
  }
  const callTool = async (name, args) => tools[name].run(exec, args || {})
  const envelopeOk = (r) => r && typeof r === 'object' && typeof r.ok === 'boolean' && ['ok', 'partial', 'unsupported'].indexOf(r.status) >= 0
  const ticketFileOf = (key) => ws.ticketFiles().filter((f) => f.indexOf(key + '-') === 0)[0] || ''
  const ticketTextOf = (key) => { const f = ticketFileOf(key); return f ? ws.readTicket(f) : '' }
  const stateOf = async (key) => {
    const r = await callTool('deck_issue_get', { key: key })
    const t = (r.data || {}).ticket || {}
    return String(t.state || '')
  }

  // ── 造票：一张规格 + 两张实施票 + 一张普通票 + 一张空规格 ──
  let specKey = ''
  let implA = ''
  let implB = ''
  let plainKey = ''
  let emptySpecKey = ''
  {
    const noParent = await callTool('deck_issue_create', { title: '没挂规格的实施票', kind: 'ticket', body: '**要构建什么：** 做一件事\n' })
    check(noParent.ok === false && noParent.reason === 'bad-args', '① 负向：kind=ticket 不带 parentKey → bad-args，不落盘（实得 ' + (noParent && noParent.reason) + '）')

    const s = await callTool('deck_issue_create', { title: '演示规格：收口核对', kind: 'spec', parentKey: '00', body: '## 问题陈述\n\n验证关规格的三道闸。\n' })
    specKey = String((s.data && s.data.ticket && s.data.ticket.key) || '')
    check(envelopeOk(s) && s.status === 'ok' && specKey, '造票：规格建成了（key=' + specKey + '）')
    check(!!(s.data && s.data.ticket && s.data.ticket.type === 'spec'), '规格读回来契约类型就是 spec（实得 ' + (s.data && s.data.ticket && s.data.ticket.type) + '）')
    const sText = ticketTextOf(specKey)
    check(sText.indexOf('ready-for-agent') >= 0 && sText.indexOf('wayfinder:') < 0, '③ 规格票的必备标签只有 ready-for-agent，不带 wayfinder: 系列')

    const a = await callTool('deck_issue_create', { title: '实施票 A', kind: 'ticket', parentKey: specKey, body: '**要构建什么：** 做 A\n' })
    implA = String((a.data && a.data.ticket && a.data.ticket.key) || '')
    const b = await callTool('deck_issue_create', { title: '实施票 B', kind: 'ticket', parentKey: specKey, body: '**要构建什么：** 做 B\n' })
    implB = String((b.data && b.data.ticket && b.data.ticket.key) || '')
    check(implA && implB && implA !== implB, '造票：两张实施票建成了（' + implA + '、' + implB + '）')
    const aText = ticketTextOf(implA)
    check(aText.indexOf('<!-- DSH-ISSUE-KIND: ticket -->') >= 0, '① 实施票的文件头写了对象类型标记 ticket')
    check(aText.indexOf('parentKey: ' + specKey) >= 0, '① 实施票的父注释指向那张规格（文件头：' + JSON.stringify(aText.split('\n').slice(0, 4)) + '）')
    check(aText.indexOf('ready-for-agent') >= 0 && aText.indexOf('wayfinder:') < 0, '③ 实施票的必备标签只有 ready-for-agent，不带 wayfinder: 系列')

    const p = await callTool('deck_issue_create', { title: '普通票：与规格无关', kind: 'task', body: '普通正文\n' })
    plainKey = String((p.data && p.data.ticket && p.data.ticket.key) || '')
    check(envelopeOk(p) && p.status === 'ok' && plainKey, '造票：普通票建成了（key=' + plainKey + '）')

    const e = await callTool('deck_issue_create', { title: '空规格：还没有实施票', kind: 'spec', parentKey: '00', body: '## 问题陈述\n\n还没有拆实施票。\n' })
    emptySpecKey = String((e.data && e.data.ticket && e.data.ticket.key) || '')
    check(envelopeOk(e) && e.status === 'ok' && emptySpecKey, '造票：空规格建成了（key=' + emptySpecKey + '）')
  }

  // ── ⑤⑥ 实施票没全关：关规格必须失败，回执写清缺哪几张 ──
  {
    const comment = '收口核对：两张实施票都还在做，先不关'
    const r = await callTool('deck_issue_patch', { key: specKey, comment: comment, close: true })
    check(envelopeOk(r) && r.ok === false && r.status === 'unsupported', '⑥ 实施票没全关时关规格 → ok:false / unsupported（实得 ' + (r && r.status) + '）')
    check(r.reason === 'ai-tool-refused', '⑥ 拒绝原因码是 ai-tool-refused（实得 ' + (r && r.reason) + '）')
    check(!!(r.data && r.data.rule === 'spec-close-children-open'), '⑥ 回执带机器可读的规则码 spec-close-children-open（实得 ' + JSON.stringify(r.data) + '）')
    const missing = (r.data && Array.isArray(r.data.missing)) ? r.data.missing : []
    const missingKeys = missing.map((m) => String(m.key || ''))
    check(missingKeys.indexOf(implA) >= 0 && missingKeys.indexOf(implB) >= 0, '⑥ 回执逐张列出缺的实施票：' + JSON.stringify(missing))
    check(missing.every((m) => typeof m.title === 'string' && typeof m.state === 'string'), '⑥ 每张缺的票都带标题与当前状态：' + JSON.stringify(missing))
    check(String(r.text || '').indexOf('#' + implA) >= 0 && String(r.text || '').indexOf('#' + implB) >= 0, '⑥ 给人看的 text 里也写着缺哪些票：' + String(r.text || '').slice(0, 120) + '…')
    check((r.items || []).length === 0, '⑤ 拒绝发生在所有写动作之前：items 为空（实得 ' + JSON.stringify(r.items) + '）')
    check(ticketTextOf(specKey).indexOf(comment) < 0, '⑤ 被拒时那条核对评论也没有发出去（票文件里找不到这句话）')
    check((await stateOf(specKey)) !== 'closed', '⑤ 被拒后规格仍是 open（实得 ' + (await stateOf(specKey)) + '）')
  }

  // ── 实施票是普通票：一张一张关掉，不受规格闸影响（⑤ 的另一面） ──
  {
    const r1 = await callTool('deck_issue_patch', { key: implA, comment: '实施票 A 核对通过：单测与全链都绿。', close: true })
    check(r1.ok === true && r1.status === 'ok', '实施票 A 可以照常关闭（实得 ' + (r1 && r1.status) + '）')
    check((r1.items || []).some((i) => i.step === 'comment' && i.status === 'ok') && (r1.items || []).some((i) => i.step === 'close' && i.status === 'ok'), '实施票 A：评论与关闭两步都成了 ' + JSON.stringify(r1.items))
    check((await stateOf(implA)) === 'closed', '实施票 A 读回来是 closed（实得 ' + (await stateOf(implA)) + '）')
    check(ticketTextOf(implA).indexOf('Status: resolved') >= 0, '实施票 A 的文件里落了关闭状态（Status: resolved）')

    const r2 = await callTool('deck_issue_patch', { key: implB, comment: '实施票 B 核对通过：复现步骤已走一遍。', close: true })
    check(r2.ok === true && (await stateOf(implB)) === 'closed', '实施票 B 也关掉了（实得 ' + (r2 && r2.status) + ' / ' + (await stateOf(implB)) + '）')
  }

  // ── ⑤⑦ 子票都关了，但没带核对评论：仍然不许关 ──
  {
    const r = await callTool('deck_issue_patch', { key: specKey, close: true })
    check(envelopeOk(r) && r.ok === false && r.reason === 'ai-tool-refused', '⑦ 子票全关但没带 comment → 关闭被拒（实得 ' + (r && r.reason) + '）')
    check(!!(r.data && r.data.rule === 'spec-close-no-comment'), '⑦ 规则码是 spec-close-no-comment（实得 ' + JSON.stringify(r.data) + '）')
    check((r.items || []).length === 0, '⑦ 没评论的关闭一步都没走：items 为空')
    check((await stateOf(specKey)) !== 'closed', '⑦ 规格仍是 open（实得 ' + (await stateOf(specKey)) + '）')
  }

  // ── ⑤ 还没有实施票的规格：不许按完成态关 ──
  {
    const r = await callTool('deck_issue_patch', { key: emptySpecKey, comment: '核对：没有实施票', close: true })
    check(envelopeOk(r) && r.ok === false && r.reason === 'ai-tool-refused', '⑤ 空规格（没有实施票）不许关（实得 ' + (r && r.reason) + '）')
    check(!!(r.data && r.data.rule === 'spec-close-no-children'), '⑤ 规则码是 spec-close-no-children（实得 ' + JSON.stringify(r.data) + '）')
    check((await stateOf(emptySpecKey)) !== 'closed', '⑤ 空规格仍是 open')
  }

  // ── ⑤⑦ 收口核对通过：同一次调用里带核对评论 + close:true → 关得成 ──
  {
    const comment = '收口核对：#实施票 A 通过（单测与全链绿）；#实施票 B 通过（复现步骤走通）。结论：这张规格可以关。'
    const r = await callTool('deck_issue_patch', { key: specKey, comment: comment, close: true })
    check(envelopeOk(r) && r.ok === true && r.status === 'ok', '⑤ 子票全关 + 带核对评论 → 关规格成功（实得 ' + (r && r.status) + '）')
    check((r.items || []).some((i) => i.step === 'comment' && i.status === 'ok') && (r.items || []).some((i) => i.step === 'close' && i.status === 'ok'), '⑦ 评论先发、再关，两步都记成 ok：' + JSON.stringify(r.items))
    check((await stateOf(specKey)) === 'closed', '⑤ 规格读回来是 closed（实得 ' + (await stateOf(specKey)) + '）')
    check(ticketTextOf(specKey).indexOf('Status: resolved') >= 0, '⑤ 规格文件里落了关闭状态（Status: resolved）')
    check(ticketTextOf(specKey).indexOf(comment) >= 0, '⑦ 那条逐张核对结论真的留在了规格票面里')
  }

  // ── ⑧ AI 只许关、不许重开 ──
  {
    const r = await callTool('deck_issue_patch', { key: specKey, close: false })
    check(envelopeOk(r) && r.ok === false && r.reason === 'ai-tool-refused', '⑧ close:false（重开）→ 被拒（实得 ' + (r && r.reason) + '）')
    check(String(r.text || '').indexOf('重开') >= 0 && String(r.text || '').indexOf('人') >= 0, '⑧ 回执说清重开只能由人做：' + String(r.text || '').slice(0, 110) + '…')
    check((r.items || []).length === 0, '⑧ 重开被拒在选后端之前：一步都没走')
    check((await stateOf(specKey)) === 'closed', '⑧ 规格仍是关闭态，没有被 AI 重开（实得 ' + (await stateOf(specKey)) + '）')
  }

  // ── 非规格票关闭照旧成功：规格闸只认规格 ──
  {
    const r = await callTool('deck_issue_patch', { key: plainKey, comment: '普通票收尾：与规格无关。', close: true })
    check(envelopeOk(r) && r.ok === true && r.status === 'ok', '普通票（非规格）关闭不受规格闸影响（实得 ' + (r && r.status) + '）')
    check((await stateOf(plainKey)) === 'closed', '普通票读回来是 closed')
  }

  // ── ⑤ 静态扫描：src/deck 下只有 issue-patch.ts 一处调 close/reopen，没有「顺手关」的旁路 ──
  {
    const deckFiles = walkSources(path.join(ROOT, 'src', 'deck'), [])
    const callers = []
    for (const file of deckFiles) {
      const text = fs.readFileSync(file, 'utf8')
      const re = /(?:^|[^A-Za-z0-9_$])t\.(close|reopen)\s*\(/g
      let m = re.exec(text)
      while (m) { callers.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), call: m[1], at: m.index }); m = re.exec(text) }
    }
    const allowed = ['src/deck/tools/issue-patch.ts']
    const outsiders = callers.filter((c) => allowed.indexOf(c.file) < 0)
    check(outsiders.length === 0, '⑤ 关/重开只住在 issue-patch.ts 一个工具里，没有「子票都关了顺手关」的旁路（实得 ' + JSON.stringify(callers) + '）')
    check(callers.filter((c) => c.call === 'close').length === 1, '⑤ 全仓 deck 工具里只有一处 close 调用（实得 ' + callers.filter((c) => c.call === 'close').length + ' 处）')
  }

  // ── ⑧ 重开在 run 层就被挡住：代码顺序在「选后端」之前 ──
  {
    const patchText = fs.readFileSync(path.join(ROOT, 'src', 'deck', 'tools', 'issue-patch.ts'), 'utf8')
    const reopenAt = patchText.indexOf('if (a.close === false)')
    const pickAt = patchText.indexOf('const pick = await shell.pickBackend(exec, s)')
    check(reopenAt >= 0, '⑧ issue-patch 里有「close:false 直接拒绝」的那一支')
    check(pickAt > reopenAt, '⑧ 拒绝重开发生在选后端之前（连后端都不连、一个字都不动）')
    check(patchText.indexOf('重开不在这个 AI 工具面上') >= 0, '⑧ 拒绝文案说清「重开不在 AI 工具面上」')
    // 关规格三道闸的规则码都在 spec-close-guard 这一份实现里（动态那一半已经在上面跑过）。
    const guardText = fs.readFileSync(path.join(ROOT, 'src', 'deck', 'shell', 'spec-close-guard.ts'), 'utf8')
    const rules = ['spec-close-children-open', 'spec-close-no-children', 'spec-close-no-comment', 'spec-close-unreadable', 'spec-close-children-unreadable']
    check(rules.every((rule) => guardText.indexOf(rule) >= 0), '⑤⑥⑦ 关规格的三道闸与两条读不回兜底都实现在 spec-close-guard.ts（规则码：' + rules.join('、') + '）')
    check(guardText.indexOf('markerKindInHeader') >= 0 && guardText.indexOf('childrenOf') >= 0, '⑤ 判规格用了 markerKindInHeader（GitHub 车道兜底），数子票用了 childrenOf')
    check(patchText.indexOf('specCloseGuard') >= 0, '⑤ issue-patch 的关规格前置闸走的是 spec-close-guard 这份唯一实现')
  }

  // ── ④ tpl.implement：首行 /implement、次行 {url} ──
  {
    const yaml = fs.readFileSync(path.join(ROOT, 'config', 'prompts', 'ticket-action-templates.yaml'), 'utf8')
    const start = yaml.indexOf('tpl.implement:')
    const end = yaml.indexOf('\ntpl.', start + 1)
    const block = start >= 0 ? yaml.slice(start, end < 0 ? yaml.length : end) : ''
    check(start >= 0 && block.indexOf('/implement') >= 0, '④ tpl.implement 有 /implement 那一行（实施票首行可直接跑）')
    check(block.indexOf('{url}') >= 0, '④ tpl.implement 带 {url} 占位符（起新会话时注入的是当前票地址）')
    check(block.indexOf('/implement') < block.indexOf('{url}'), '④ 顺序是首行 /implement、次行 {url}')
  }

  // ── ⑤ 规格三态模板都在（本票只改 specComplete 的关闭节） ──
  {
    const cv = fs.readFileSync(path.join(ROOT, 'src', 'client', 'kernel', 'container-view.ts'), 'utf8')
    check(cv.indexOf('specComplete') >= 0 && cv.indexOf('specSplit') >= 0 && cv.indexOf('specExecute') >= 0, '⑤ 规格三态（specSplit / specExecute / specComplete）的取值真源还在 container-view.ts')
    const yaml = fs.readFileSync(path.join(ROOT, 'config', 'prompts', 'map-advancement.yaml'), 'utf8')
    check(yaml.indexOf('specComplete:') >= 0 && yaml.indexOf('specExecute:') >= 0 && yaml.indexOf('specSplit:') >= 0, '⑤ 三态模板的正文真源都在 map-advancement.yaml')
    const completeAt = yaml.indexOf('specComplete:')
    const executeAt = yaml.indexOf('specExecute:', completeAt)
    const block = completeAt >= 0 ? yaml.slice(completeAt, executeAt < 0 ? yaml.length : executeAt) : ''
    check(block.indexOf('deck_issue_patch') >= 0 && block.indexOf('close:true') >= 0, '⑤ specComplete 的关闭节写清「同一次 deck_issue_patch 里带 comment 和 close:true」')
    check(block.indexOf('旁路') >= 0 && block.indexOf('重开') >= 0, '⑤ specComplete 写清没有「顺手关」的旁路、重开只由人做')
    const sv = /version:\s*(\d+)/.exec(block.slice(0, 200))
    check(sv !== null && Number(sv[1]) >= 3, '⑤ specComplete 版本升到 3（补交付边界后必须同步升版）')
    ;['长期分支', 'PR', '没有版本库', '提交号', '等待'].forEach(function (word) {
      check(block.indexOf(word) >= 0, '⑤ specComplete v3 写清交付边界：含「' + word + '」')
    })
    check(block.indexOf('long-lived branch') >= 0 && block.indexOf('no version control') >= 0, '⑤ specComplete v3 英文同步写清长期分支与无版本库两种收尾')
  }

  // ── ① 实施票必须挂规格：代码里那道拒绝也在 ──
  {
    const createText = fs.readFileSync(path.join(ROOT, 'src', 'deck', 'tools', 'issue-create.ts'), 'utf8')
    check(createText.indexOf('实施票的父必须是规格票') >= 0, '① deck_issue_create 的源码里写着「实施票的父必须是规格票」')
  }

  ws.cleanup()
  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch (e) {}
  try { dispose.dispose() } catch (e) {}
  console.log('\n' + (failed ? '存在失败' : '全部通过 — #1298：关规格三道闸 + 只关不重开（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
