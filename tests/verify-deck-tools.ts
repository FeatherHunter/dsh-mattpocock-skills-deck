// verify-deck-tools.ts —— 门禁：九个后端无关工具（#713 第六批 + 薄列表补齐）
// 用法：在插件根目录执行 node tests/verify-deck-tools.ts，可独立运行。
//
// 这一段盯四件事，都是票面点名要的：
//   ① 九个工具各一条正例：调用能不能真的把事情做完（在真实本地 Markdown 后端上跑，票就是盘上的文件）。
//   ② 两条负向：`unsupported`（后端说做不到 / 会话取不到工作区）与 `partial`（一批里有的成、有的没成）。
//   ③ **离网后端不再过闸**（#1442 起）：工具只调 Tracker 会话，离网口径跳过剩余额度探针，
//      所以真闸的「AI 工具」那一档是 0、escaped 是 0 —— 这个零不是漏记，是离网本来就没有额度可记。
//      真闸与真账本的实例仍在（GitHub 路的回归保护走它们），只是离网调用不再经手。
//      判定出口的常驻结论线 detection.detect 仍在，调用改走会话后工具层不再发 host.call。
//      传过闸的旧断言见 git 历史，本文件现在只钉新口径；跨口径的对照由 tests/verify-1442-tracker-tools.ts 负责。
//   ④ 一条负向：让后端实现抛错 → 工具必须回 ok:false / partial，而不是把异常抛给 AI。
//
// 另外两条静态扫描（票面「加固补充」要求）：src/deck/tools/**、src/deck/shell/** 与 src/deck/registration/** 里
// 不许出现后端 id 的等值比较（`=== 'github'` 这种），否则工具就在自己判后端了。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
// 夹具说「这个工作区选过了」的唯一办法（#1138 起）：给这个工作区一份工作区文件。来历见该文件头。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const TOOL_FILES = [
  ['src/deck/tools/context.ts', 'createDeckContext', 'deck_context'],
  ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ['src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot', 'deck_map_snapshot'],
  ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list'],
  ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
  ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
  ['src/deck/tools/map-link.ts', 'createDeckMapLink', 'deck_map_link'],
  ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
  ['src/deck/tools/issue-report.ts', 'createDeckIssueReport', 'deck_issue_report'],
]

/** 一个真实本地 Markdown 工作区：票就是 .scratch/demo/issues/*.md 这些文件（与 sections/idempotency.js 同一套做法）。 */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-tools-'))
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
    ticketFiles(effortId) { try { return fs.readdirSync(effortId ? path.join(root, '.scratch', effortId, 'issues') : path.join(dir, 'issues')).filter((f) => f.endsWith('.md')) } catch (e) { return [] } },
    readTicket(name, effortId) { return fs.readFileSync(effortId ? path.join(root, '.scratch', effortId, 'issues', name) : path.join(dir, 'issues', name), 'utf8') },
    readSpec() { try { return fs.readFileSync(path.join(dir, 'spec.md'), 'utf8') } catch (e) { return '' } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('九个后端无关工具的门禁（#713 T9：过闸、三态、永不抛、不判后端）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const planMod = await imp('src/deck/shell/minimal-spec.ts')
  const shellMod = await imp('src/deck/shell/call-shell.ts')
  // #1261：工作路线用同一份真实现（临时家目录 + 固定时钟），门禁用假口会把「记没记上」变成自证——
  // 记一笔真落盘、读一笔真读盘，断言直接看盘上的文件与回执。
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.ts')
  const chainMod = await imp('src/refresh/kernel/refresh-chain.js')
  // 选后端的判定出口（#1003 单出口）。生产装配总是把它递给工具（见 src/refresh/registry/deck-tool-bridge.ts
  //   的 `decideBackend: decideBackend || null`），壳拿不到它时会一律回「判定出口这次没装上」，
  //   所以夹具也必须照生产的接法给上，否则下面这些正例一条都跑不到真实路径。
  //   #1138 起「这个工作区选过了」只有一种造法：给这个工作区一份工作区文件。下面那次
  //   chooseWorkspace(ws.rootPosix, 'markdown') 就是这件事（桩内部走生产那一个判定出口，
  //   读的正是这份文件），写用途才会被放行（#1003 契约期望行为第 4 条：写用途只认文件里的记录）。

  // ── 组装：真闸 + 真账本 + 真注册表 + 真实本地 Markdown 后端 ──
  const ws = makeWorkspace()
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const logs = []
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  chooseWorkspace(ws.rootPosix, 'markdown')   // 等于「这个工作区里有一份写着 markdown 的工作区文件」，测试不依赖锚文件识别
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  // 假传输层：每真发一条就报给闸（生产里这一层是起 gh / glab 进程的那一层；本地 Markdown 不发请求）。
  const transport = { requests: 0, points: 0 }
  function fire(requests, points) {
    transport.requests += (requests || 0)
    transport.points += (points || 0)
    gate.noteOutbound({ requests: requests || 0, points: points || 0 })
  }

  const invalidated = []
  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-workpath-'))
  const workRouteBindings = workRouteMod.createWorkRouteBindings({
    homeDir: workPathHome, now: () => clock,
    readFile: (p) => fs.promises.readFile(p, 'utf8').then((t) => t, () => null),
    writeFile: (p, t) => fs.promises.writeFile(p, t, 'utf8'),
    mkdir: (dir) => fs.promises.mkdir(dir, { recursive: true }),
  })
  const planStore = (() => {
    const table = new Map()
    return { durable: true, load(id) { return table.get(String(id)) || null }, save(id, s) { table.set(String(id), s) } }
  })()
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
  const exec = { agent: { session: { id: 's-713', cwd: ws.rootPosix } } }

  const tools = {}
  for (const [file, factory, name] of TOOL_FILES) {
    const mod = await imp(file)
    if (typeof mod[factory] !== 'function') { check(false, file + ' 导出 ' + factory); continue }
    const tool = mod[factory](deps)
    tools[name] = tool
    check(tool.definition && tool.definition.name === name && typeof tool.run === 'function', name + ' 装起来了，名字与定义一致')
    // #762 修路由要把适用范围与退出写进描述，60 字装不下，放宽到 350 字（入口三句、其余两句，提示词成本认下来）。
    check(String(tool.definition.description || '').length <= 350, name + ' 的描述在 350 字内（' + String(tool.definition.description || '').length + ' 字）')
  }

  const callTool = async (name, args) => {
    const r = await tools[name].run(exec, args || {})
    // 成功选出后端的那几次调用在这里计数，供下面那段「离网调用不再过真闸」核对（调用次数大于 0 而闸计数为 0）。
    // #1442 起选后端走判定出口（读工作区文件），不再调注册表的选择接口；选择接口零调用由 tests/verify-1442-tracker-tools.ts 钉住。
    if (r && r.backend && r.backend.id) selectCount.count += 1
    return r
  }
  const selectCount = { count: 0 }
  const envelopeOk = (r) => r && typeof r === 'object' && typeof r.ok === 'boolean' && ['ok', 'partial', 'unsupported'].indexOf(r.status) >= 0

  // ── ① deck_context：工作区/后端/仓库解析结果 + 地图清单 ──
  {
    const r = await callTool('deck_context')
    check(envelopeOk(r) && r.status === 'ok', 'deck_context 正例：回 ok（实得 ' + (r && r.status) + '）')
    check(r.workspace && r.workspace.root === ws.rootPosix, 'deck_context 回显解析到的工作区根（' + (r.workspace && r.workspace.root) + '）')
    check(r.backend && r.backend.id === 'markdown' && r.backend.source === 'explicit', 'deck_context 回显后端与来源（' + JSON.stringify(r.backend) + '）')
    check(r.data && Array.isArray(r.data.maps), 'deck_context 带回地图清单（' + JSON.stringify((r.data || {}).maps) + '）')
    check(r.cost && r.cost.estimated && typeof r.cost.estimated.points === 'number' && r.cost.actual, 'deck_context 带回调用前的预估与调用后的真实花费')
  }

  // ── ② deck_issue_create：建票 + 必备标签 + 进度区 ──
  let createdKey = ''
  let planMapKey713 = ''
  {
    const r = await callTool('deck_issue_create', { title: '第一张演示票', kind: 'issue', body: '正文在这里' })
    createdKey = String((r.data && r.data.ticket && r.data.ticket.key) || '')
    check(envelopeOk(r) && r.status === 'ok' && createdKey, 'deck_issue_create 正例：建成了（key=' + createdKey + '）')
    check(r.items.length === 0 && !(r.notes || []).some((n) => n.indexOf('必备标签') >= 0), 'deck_issue_create 对普通票不硬塞类型标签（notes：' + JSON.stringify(r.notes) + '）')
    const files = ws.ticketFiles()
    check(files.length === 1, 'deck_issue_create 真的落到了盘上的票文件（' + files.join('、') + '）')
    const text = files.length ? ws.readTicket(files[0]) : ''
    check(text.indexOf('wayfinder:') < 0, '普通票（issue）不带 wayfinder: 系列标签')
    check(text.indexOf('## 进度') >= 0, '进度区写进了票文件')
  }

  // ── ②a deck_issue_create 的 spec / spec-ticket 两档（#1277、#1403）：票面文件头写对象类型标记 ──
  let specKey = ''
  {
    // 规格是与探索地图同级的顶层容器（#1403）：建规格不传 parentKey。
    const r = await callTool('deck_issue_create', { title: '演示规格票', kind: 'spec', body: '## 问题陈述\n\n规格正文\n' })
    specKey = String((r.data && r.data.ticket && r.data.ticket.key) || '')
    check(envelopeOk(r) && r.status === 'ok' && specKey, 'deck_issue_create 正例：建成规格票（key=' + specKey + '）')
    check(!!(r.data && r.data.ticket && r.data.ticket.type === 'spec'), '规格票读回来契约类型就是 spec（实得 ' + (r.data && r.data.ticket && r.data.ticket.type) + '）')
    // #1486：规格落成 <feature>/spec.md，不再是 issues/00-*.md；正文只留原文模板，插件状态进隐藏注释。
    const text = ws.readSpec()
    const header = String(text).split('\n').slice(0, 8).join('\n')
    check(specKey === '00' && text.indexOf('# 演示规格票') >= 0, '规格票落成 spec.md，编号是 00（key=' + specKey + '）')
    check(text.indexOf('<!-- DSH-FORMAT: md-v1 -->') >= 0, '规格票的文件头写了格式版本注释（前 8 行：' + JSON.stringify(header) + '）')
    check(/^<!-- DSH-STATUS: ready-for-agent -->$/m.test(text), '规格票的隐藏注释写状态 ready-for-agent')
    check(/^<!-- DSH-LABELS: .*ready-for-agent -->$/m.test(text), '规格票带的必备标签是 ready-for-agent')
    check(text.indexOf('DSH-ISSUE-KIND') < 0, '新布局不再写旧的 DSH-ISSUE-KIND 标记')
    check(text.indexOf('parentKey:') < 0, '规格是顶层容器，票面不写父注释（前 8 行：' + JSON.stringify(header) + '）')
    check(text.indexOf('Type: spec') < 0, '规格票不再写 Type: spec 这一行')
    check(text.indexOf('## 进度') >= 0, '规格票也补进度区（#1403 起所有位置统一）')
    const t = await callTool('deck_issue_create', { title: '演示实施票', kind: 'spec-ticket', parentKey: specKey, body: '**要构建什么：** 做一件事\n' })
    const ticketKey = String((t.data && t.data.ticket && t.data.ticket.key) || '')
    check(envelopeOk(t) && t.status === 'ok' && ticketKey, 'deck_issue_create 正例：建成实施票（key=' + ticketKey + '）')
    const tFile = ws.ticketFiles().filter((f) => f.indexOf(ticketKey + '-') >= 0)[0] || ''
    const tText = tFile ? ws.readTicket(tFile) : ''
    check(tText.indexOf('<!-- DSH-PARENT: ' + specKey + ' -->') >= 0, '实施票的隐藏注释指向规格票（实得文件头：' + JSON.stringify(String(tText).split('\n').slice(0, 6)) + '）')
    check(tText.indexOf('DSH-ISSUE-KIND') < 0, '实施票不再写旧的 ticket 标记')
    // 列表：type=issue 不把规格票混进来。规格票在 list 里的身份（与 map.md 同为 00）归 #1488 统一处理，本票不锁。
    const onlyIssue = await callTool('deck_issue_list', { state: 'open', type: 'issue' })
    check(!!(onlyIssue.data && onlyIssue.data.issues.every((i) => String(i.key) !== specKey)), 'deck_issue_list 传 type=issue 不把规格票混进来')
  }

  // ── ②b deck_issue_list：全局薄列表（过滤不过滤都回薄行，不回正文） ──
  {
    const r = await callTool('deck_issue_list', { state: 'open' })
    check(envelopeOk(r) && r.status === 'ok' && r.data && Array.isArray(r.data.issues), 'deck_issue_list 正例：列表回来了（' + (r.data ? r.data.returned : '?') + '/' + (r.data ? r.data.total : '?') + ' 行）')
    check(r.data.issues.every((t) => t.body === undefined && t.comments === undefined), 'deck_issue_list 只回薄行（不带正文与评论）')
    const q = await callTool('deck_issue_list', { state: 'open', query: '第一张演示票' })
    check(q.data && q.data.total >= 1 && q.data.issues.every((t) => String(t.title).indexOf('第一张演示票') >= 0 || String(t.key) === createdKey), 'deck_issue_list 按 query 子串过滤（命中刚才那张票）')
    const capped = await callTool('deck_issue_list', { state: 'open', limit: 1 })
    check(capped.data && capped.data.returned <= 1, 'deck_issue_list 按 limit 截断（回 ' + (capped.data ? capped.data.returned : '?') + ' 行）')
  }

  // ── ③ deck_issue_get：读回一张票（含负向：读一张不存在的票） ──
  {
    const r = await callTool('deck_issue_get', { key: createdKey })
    check(envelopeOk(r) && r.status === 'ok' && r.data && r.data.ticket && r.data.ticket.key === createdKey, 'deck_issue_get 正例：票读回来了（' + createdKey + '）')
    check(r.data && r.data.landings && typeof r.data.landings.parent === 'string', 'deck_issue_get 给每条边标了落点（' + JSON.stringify((r.data || {}).landings) + '）')
    const bad = await callTool('deck_issue_get', { key: '999999' })
    check(envelopeOk(bad) && bad.ok === false && bad.status === 'unsupported', 'deck_issue_get 负向：读一张不存在的票 → ok:false / unsupported（实得 ' + (bad && bad.status) + '）')
    const noArgs = await callTool('deck_issue_get', {})
    check(noArgs.ok === false && noArgs.reason === 'bad-args', 'deck_issue_get 负向：不给票号 → bad-args，不抛')
  }

  // ── ④ deck_map_snapshot：地图的子票与进度 ──
  {
    const r = await callTool('deck_map_snapshot', { key: '00' })
    check(envelopeOk(r) && r.status === 'ok', 'deck_map_snapshot 正例：地图读回来了（实得 ' + (r && r.status) + '）')
    check(r.data && r.data.stats && typeof r.data.stats.open === 'number', 'deck_map_snapshot 带回进度统计（' + JSON.stringify((r.data || {}).stats) + '）')
    // 这条以前写成 Array.isArray(blocks.destination === undefined ? blocks.notes : [])：
    // destination 是字符串，=== undefined 恒假，整个表达式退化成 Array.isArray([])，恒真，
    // 于是「五个区块」从来没被真正检查过。#809 里它是接缝盲区的证据之一，这里补成真检查。
    const blocks = (r.data || {}).blocks || {}
    const FIVE = ['destination', 'notes', 'decisions', 'fog', 'outOfScope']
    check(r.data && r.data.blocks && FIVE.every((k) => Object.prototype.hasOwnProperty.call(blocks, k) && blocks[k] !== null && blocks[k] !== undefined),
      'deck_map_snapshot 带回五个区块（Destination / Notes / Decisions so far / Not yet specified / Out of scope）')
    check(typeof blocks.destination === 'string'
      && (typeof blocks.notes === 'string' || Array.isArray(blocks.notes))
      && Array.isArray(blocks.decisions) && Array.isArray(blocks.fog) && Array.isArray(blocks.outOfScope),
      'deck_map_snapshot 五个区块各自成形（destination/notes 是文字，decisions/fog/outOfScope 是清单）')
  }

  // ── ⑤ deck_map_plan_create：一整张地图的骨架（含分片与中间态） ──
  {
    // 原文布局下一个目录只能有一份 map.md（issue-tracker-local.md:25-28）：这个工作区开头已经手写了一份
    // .scratch/demo/map.md 给快照段用，所以建图夹具单独点名一个 effort 目录，测试意图仍是「建图 → 快照 →
    // 读回」，不是「同目录重复地图会被怎么处理」这一档。
    const planArgs = {
      planId: 'plan-713-a', title: '演示地图甲', effort: 'plan-demo',
      // #1403 T3 起计划子票的 kind 必填，且地图工单要带 label；这里按目标口径写，
      // 当前分支的工具只把子票当普通工单建，字段先被忽略，合并 T3 后由 T3 的校验接手。
      children: [
        { key: 'a1', title: '子票一', kind: 'map-ticket', label: 'wayfinder:task' },
        { key: 'a2', title: '子票二', kind: 'map-ticket', label: 'wayfinder:task' },
        { key: 'a3', title: '子票三', kind: 'map-ticket', label: 'wayfinder:task' },
      ],
      edges: [{ from: 'a2', to: 'a1', type: 'blocked-by' }],
    }
    // 原文布局里子票编号接着同一个目录 issues/ 里已有的编号往下排。先放两张占位票把编号推到 03 起，
    // 与这个夹具原本「子票 3/4/5」的票号一致：这样计划建的票与 demo 工作区的票号不重合，
    // 后面「在办表里 6 张票、6 个票号」的断言仍按原意成立（占位票不走工具，不记在办表）。
    const planIssues = path.join(ws.root, '.scratch', 'plan-demo', 'issues')
    fs.mkdirSync(planIssues, { recursive: true })
    fs.writeFileSync(path.join(planIssues, '01-placeholder-a.md'), '# 01: placeholder-a\n', 'utf8')
    fs.writeFileSync(path.join(planIssues, '02-placeholder-b.md'), '# 02: placeholder-b\n', 'utf8')
    const filesBefore = ws.ticketFiles('plan-demo').length
    const r = await callTool('deck_map_plan_create', planArgs)
    planMapKey713 = String((r.data && r.data.mapKey) || '')
    check(envelopeOk(r), 'deck_map_plan_create 正例：回三态之一（实得 ' + (r && r.status) + '）')
    check(r.data && r.data.mapKey && r.data.builtKeys.length === 3, 'deck_map_plan_create 建成地图 + 3 张子票（' + JSON.stringify((r.data || {}).builtKeys) + '）')
    const edgeItems = (r.items || []).filter((i) => i.role === 'edge')
    check(edgeItems.length === 1 && edgeItems[0].landing && edgeItems[0].evidence, 'deck_map_plan_create 每条边都标出落点与证据：' + JSON.stringify(edgeItems[0]))
    check(typeof edgeItems[0].evidence === 'string'
      && edgeItems[0].evidence.indexOf('的 blockedBy 里有') > 0
      && edgeItems[0].evidence.indexOf('被') > 0 && edgeItems[0].evidence.indexOf('阻塞') > 0,
      'deck_map_plan_create 回执点名方向（谁被谁阻塞）：' + String(edgeItems[0].evidence))
    check(r.data.durable === true, 'deck_map_plan_create 的中间态是落盘的（注入的 planStore 说它 durable）')
    // 续跑：同一个 planId 再来一次 → 一张票都不重复建
    const again = await callTool('deck_map_plan_create', planArgs)
    check(again.data && again.data.skippedKeys.length === 3 && again.data.builtKeys.length === 3, 'deck_map_plan_create 续跑：同一个 planId 再来一次只跳过、不重复建（skipped=' + JSON.stringify((again.data || {}).skippedKeys) + '）')
    // 原文布局里地图是 <effort>/map.md（不进 issues/），所以 issues 下新增的只有 3 张子票；地图本身另查在不在。
    check(ws.ticketFiles('plan-demo').length === filesBefore + 3
      && fs.existsSync(path.join(ws.root, '.scratch', 'plan-demo', 'map.md')),
      '盘上的票文件数对得上（地图落在 plan-demo/map.md、不进 issues；子票 3 张 = issues 下新增 3 个文件，实得新增 ' + (ws.ticketFiles('plan-demo').length - filesBefore) + '）')

    // #1421：edges 里出现不认识的 type 时整批拒写，且一条边、一张票都不落（零副作用）。
    const badBefore = ws.ticketFiles('plan-demo').length
    const badType = await callTool('deck_map_plan_create', {
      planId: 'plan-713-badtype', title: 'type 写错的地图',
      children: [{ key: 'c1', title: '子票一', kind: 'map-ticket', label: 'wayfinder:task' }],
      edges: [{ from: 'c1', to: '@map', type: 'blocks' }],
    })
    check(badType && badType.ok === false && badType.status === 'unsupported' && badType.reason === 'bad-args',
      '✗ 负向：edges 的 type 写成不认识的值 → ok:false / unsupported / bad-args（实得 ' + (badType && badType.status) + ' / ' + (badType && badType.reason) + '）')
    check(String((badType && badType.text) || '').indexOf('只认 blocked-by 与 parent') > 0,
      '✗ 负向：拒写文案说清 type 只认那两个值：' + String((badType && badType.text) || ''))
    check(ws.ticketFiles('plan-demo').length === badBefore,
      '✗ 负向：整批拒写之后盘上没多任何票（零副作用，实得新增 ' + (ws.ticketFiles('plan-demo').length - badBefore) + '）')
    // #1421 审查补：一条合法边与一条不认识的 type 混在同一批里时，整批都不写 ——
    // 不是「跳过坏的那条、把好的那条写下去」。
    const mixBefore = ws.ticketFiles('plan-demo').length
    const mixed = await callTool('deck_map_plan_create', {
      planId: 'plan-713-mixedtype', title: '合法边与写错的 type 混在一批',
      children: [
        { key: 'm1', title: '合法子票', kind: 'map-ticket', label: 'wayfinder:task' },
        { key: 'm2', title: '另一张子票', kind: 'map-ticket', label: 'wayfinder:task' },
      ],
      edges: [{ from: 'm2', to: 'm1', type: 'blocked-by' }, { from: 'm1', to: 'm2', type: 'blocks' }],
    })
    check(mixed && mixed.ok === false && mixed.status === 'unsupported' && mixed.reason === 'bad-args',
      '✗ 负向：合法边与非法 type 混在一批 → 整批拒绝（实得 ' + (mixed && mixed.status) + ' / ' + (mixed && mixed.reason) + '）')
    check(ws.ticketFiles('plan-demo').length === mixBefore,
      '✗ 负向：混批被拒之后一张票也没建（零副作用，实得新增 ' + (ws.ticketFiles('plan-demo').length - mixBefore) + '）')
  }

  // ── ⑥ deck_map_link：补边（正例 = 阻塞边；正例 = 同目录父子；负向 = 不存在的父） ──
  {
    // #971 起计划的子票挂在计划地图下，不再挂在 00 下：按计划地图取子票，00 只剩最初那一张演示票。
    // 计划落在 plan-demo 那个 effort 目录里，读回与补边都要点名同一个目录。
    const kids = (await callTool('deck_map_snapshot', { key: planMapKey713, effort: 'plan-demo' })).data.children
    // 原文布局的子票标题带编号（"01: 子票一"，heading 逐字是 "# <NN>: <问题>"），按后缀认标题。
    const pickKid = (t) => kids.find((k) => k.title === t || String(k.title).endsWith(': ' + t))
    const c1 = String(pickKid('子票一').key)
    const c3 = String(pickKid('子票三').key)
    const ok = await callTool('deck_map_link', { key: c3, blockedBy: [c1], effort: 'plan-demo' })
    check(envelopeOk(ok) && ok.status === 'ok', 'deck_map_link 正例：补一条阻塞边（实得 ' + (ok && ok.status) + '）')
    const edge = (ok.items || [])[0]
    check(edge && edge.landing && edge.evidence, 'deck_map_link 标出这条边落在哪一列：' + JSON.stringify(edge))
    check(edge && typeof edge.evidence === 'string'
      && edge.evidence.indexOf('票 #' + c3 + ' 的 blockedBy 里有 #' + c1) > 0
      && edge.evidence.indexOf('被 #' + c1 + ' 阻塞') > 0,
      'deck_map_link 回执点名方向（票 #' + c3 + ' 被 #' + c1 + ' 阻塞）：' + String(edge && edge.evidence))
    const planFiles = ws.ticketFiles('plan-demo')
    const text = planFiles.length ? ws.readTicket(planFiles[0], 'plan-demo') : ''
    check(typeof text === 'string', '补边之后票文件还在（不会被写坏）')
    // #971 起同目录改父能做成（文件顶注释即归属）：同值补一次边直接成功，返回落点与证据。
    const same = await callTool('deck_map_link', { key: c3, parentKey: planMapKey713, effort: 'plan-demo' })
    check(envelopeOk(same) && same.status === 'ok', 'deck_map_link 正例：同目录同值补父边直接成功（实得 ' + (same && same.status) + '）')
    check((same.items || []).some((i) => i.landing && i.evidence), '同值父边逐项写了落点与证据：' + JSON.stringify((same.items || [])[0]))
    check((same.items || []).some((i) => typeof i.evidence === 'string' && i.evidence.indexOf('票 #' + c3 + ' 的父票是 #' + planMapKey713) > 0),
      '同值父边回执点名方向（谁的父票是谁）：' + JSON.stringify((same.items || [])[0]))
    // 负向：父票根本不存在 → 这一步失败，工具必须回 unsupported 而不是抛
    const partial = await callTool('deck_map_link', { key: c3, parentKey: '99', effort: 'plan-demo' })
    check(envelopeOk(partial) && partial.ok === false && partial.status === 'unsupported', '✗ 负向：父票不存在 → ok:false / unsupported（实得 ' + (partial && partial.status) + '）')
    check((partial.items || []).some((i) => i.landing && i.landing.indexOf('做不到') >= 0) || (partial.items || []).some((i) => String(i.reason || i.evidence || '').indexOf('not-found') >= 0), '做不到的那一条逐项写在 items 里：' + JSON.stringify((partial.items || [])[0]))
    // 计划夹具到此用完（后面几段验的是 demo 工作区的改票/认领/上报）：把它建的票清掉，
    // 免得计划目录里的 01/02/03 与 demo 目录的同号票撞车，让后面按裸票号读写的调用变歧义。
    fs.rmSync(path.join(ws.root, '.scratch', 'plan-demo'), { recursive: true, force: true })
  }

  // ── ⑦ deck_issue_patch：改一张票（评论 + 标签 + 关闭 + 认领） ──
  {
    const r = await callTool('deck_issue_patch', { key: createdKey, comment: '这一条是工具发的评论', addLabels: ['wayfinder:research'], close: true })
    check(envelopeOk(r), 'deck_issue_patch 正例：回三态之一（实得 ' + (r && r.status) + '）')
    check((r.items || []).some((i) => i.step === 'comment' && i.status === 'ok'), 'deck_issue_patch 评论那一步成了：' + JSON.stringify(r.items))
    check((r.items || []).some((i) => i.step === 'close' && i.status === 'ok'), 'deck_issue_patch 关闭那一步成了')
    // #1273：回执里写后回读的整票只能有一份。data.ticket 留整票；readBack 只留核对用的摘要，
    // 不许再装 body/comments——PTC 会话读的就是 run() 的原始信封，否则同一张票会进两次上下文。
    const receiptText = JSON.stringify(r)
    check(!!(r.data && r.data.ticket && typeof r.data.ticket.body === 'string'), 'deck_issue_patch 回执的 data.ticket 仍是整票（写后回读的正文在）')
    check(!!r.readBack && typeof r.readBack === 'object' && !('body' in r.readBack) && !('comments' in r.readBack), 'deck_issue_patch 回执的 readBack 只是核对摘要（不带 body/comments）：' + JSON.stringify(r.readBack))
    check(!!r.readBack && String(r.readBack.key) === String(createdKey) && r.readBack.state === 'closed' && typeof r.readBack.updatedAt === 'string' && r.readBack.updatedAt !== '', 'readBack 摘要带票号、写后状态与更新时间（能核对改没改成）：' + JSON.stringify(r.readBack))
    check(!!r.readBack && Object.keys(r.readBack).sort().join(',') === 'key,state,updatedAt', 'readBack 摘要只带这三格，字段增删会被这条断言看见：' + JSON.stringify(r.readBack))
    check((receiptText.match(/正文在这里/g) || []).length === 1, '回执 JSON 里整票正文只出现一份（data.ticket 一份，readBack 不再重复）')
    const roundTripped = JSON.parse(JSON.stringify(r))
    check((JSON.stringify(roundTripped).match(/正文在这里/g) || []).length === 1, '回执过一次 JSON 往返（连接、fetch 与 PTC 会话交给模型前的边界）后正文仍只有一份')
    // 认领这一步在 #1174 之前是「本地 Markdown 做不到」的负向例子：它只把状态改成 claimed，
    // 不记认领人，回读只能拿 @me 占位，所以工具层只能回 partial。现在本地房把名字写进票面、
    // 原样读回，这一步就该如实成功——这条断言跟着产品决定改了方向，不是放松检查。
    const assign = await callTool('deck_issue_patch', { key: createdKey, comment: '再来一条评论', assignees: ['someone'] })
    check(envelopeOk(assign) && assign.status === 'ok', '认领在本地 Markdown 上真能做成，回 ok（实得 ' + (assign && assign.status) + '）')
    check((assign.items || []).some((i) => i.step === 'assignees' && i.status === 'ok' && (i.assignees || []).indexOf('someone') >= 0), '认领那一步带回了写进去的名字：' + JSON.stringify((assign.items || []).filter((i) => i.step === 'assignees')[0]))
    const nothing = await callTool('deck_issue_patch', { key: createdKey })
    check(nothing.ok === false && nothing.reason === 'bad-args', 'deck_issue_patch 负向：什么都没点名 → bad-args，不抛')
  }

  // ── ⑦b deck_issue_report：上报成功收口记进工作路线（正例 + 负向） ──
  {
    const r = await callTool('deck_issue_report', { key: createdKey, note: '开始处理', workRouteDetail: 'standard' })
    const normCreated = String(createdKey).replace(/^0+(?=\d)/, '')
    check(envelopeOk(r) && r.status === 'ok' && r.data && String(r.data.key).replace(/^0+(?=\d)/, '') === normCreated, 'deck_issue_report 正例：上报成了（票 ' + createdKey + '，实得 ' + (r && r.status) + '）')
    // #1261 起步、#1262 铺满：上报成功收口也记一笔（动作 report、来源 reported），
    // 回执带的是这个工作区整张在办表（不止刚上报这一张），notes 末尾带摘要。
    // 这张夹具到这一步在办表里有 6 张票：创建票 1、子票 3/4/5、②a 的规格票与实施票各一条
    //（票号在链上统一收成 "1"、"2"…）。地图 2 是容器，按规格（#1259 决定 5：「plan 建出的每张子票各一条」）
    // 不记，所以不在表里。
    const wr = r.data && r.data.workRoute
    check(wr && typeof wr.at === 'string' && Array.isArray(wr.entries) && wr.entries.length === 6, 'deck_issue_report 回执带工作路线在办表（6 条，实得 ' + JSON.stringify(wr && wr.entries && wr.entries.length) + '）')
    const e0 = wr && wr.entries && wr.entries[0]
    check(e0 && String(e0.ticketKey) === normCreated && e0.action === 'report' && e0.source === 'reported' && e0.active === true && e0.currentSession === true, '在办表第一条是刚上报的票（动作 report、来源 reported、现办、当前会话）：' + JSON.stringify(e0))
    check(wr && wr.entries && new Set(wr.entries.map((e) => String(e.ticketKey))).size === wr.entries.length, '同一张票在在办表里只有一条（6 条票、6 个票号）：' + JSON.stringify(wr && wr.entries && wr.entries.map((e) => e.ticketKey)))
    check(e0 && typeof e0.sessionLabel === 'string' && e0.sessionLabel.indexOf('会话 ') === 0, '会话只露标签不露原始 id（实得 ' + (e0 && e0.sessionLabel) + '）')
    // #1352：上报不再收进度自评，条目与回执 data 都不出现 progress 这一格。
    check(e0 && !Object.prototype.hasOwnProperty.call(e0, 'progress'), '在办表这一条没有 progress 键（#1352 起不再新增）')
    check(!!(r.data) && !Object.prototype.hasOwnProperty.call(r.data, 'progress'), '回执 data 里也没有 progress 这一格（#1352 起不再新增）')
    check(wr && wr.collisions === undefined && typeof wr.staleCount === 'number', '单会话无撞单（collisions 键不出现，staleCount 在）')
    check((r.notes || []).some((n) => String(n).indexOf('工作路线摘要 · 本工作区在办 6 条') === 0), 'notes 末尾带工作路线摘要：' + JSON.stringify(r.notes))
    check(JSON.stringify(r).indexOf('s-713') < 0, '回执全文没有原始会话 id（s-713 只进盘，不进回执）')
    // 盘上是同一份：v3 形状、同一张票、原始会话 id 在盘上（回执里只有标签）。
    const wsKey = r.workspace && r.workspace.key
    check(typeof wsKey === 'string' && wsKey, '回执带工作区钥匙（落哪一份文件由它定）')
    const diskFile = workPathHome + '/.dsh/mattskillsdeck/work-path/' + chainMod.chainRootHash(wsKey) + '.json'
    const before = fs.readFileSync(diskFile, 'utf8')
    const disk = JSON.parse(before)
    check(disk && disk.v === 3 && Array.isArray(disk.workers) && disk.workers.length === 1, '盘上是 v3 形状（一份账、一个会话页）')
    const row = disk.workers[0].entries[0]
    check(row && String(row.ticketKey) === normCreated && disk.workers[0].session === 's-713' && row.hasWork === true, '盘上是同一张票 + 原始会话 id；建过票的条目带 hasWork=true：' + JSON.stringify(row))
    check(row && !Object.prototype.hasOwnProperty.call(row, 'progress'), '盘上条目也没有 progress 键（#1352 起不再新增）')
    // 只读调用不碰盘：读一张票，盘上文件一字不动。
    await callTool('deck_issue_get', { key: createdKey })
    check(fs.readFileSync(diskFile, 'utf8') === before, '只读调用不碰盘（文件内容一字不动）')
    // 紧接着第二次调用：同一张票只留一条（去重后来居上），回执与盘上一致。
    const r2 = await callTool('deck_issue_report', { key: createdKey, note: '继续处理', workRouteDetail: 'standard' })
    check(r2.data && r2.data.workRoute && r2.data.workRoute.entries.length === 6, '第二次上报同一张票：在办表还是 6 条（去重，不多也不少）')
    const after2 = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
    const createdRows = after2.workers[0].entries.filter((e) => String(e.ticketKey) === normCreated)
    check(after2.workers[0].entries.length === 6 && createdRows.length === 1 && createdRows[0].action === 'report', '第二次上报：盘上还是同一条，动作停在 report（去重）')
    // #1352：上报不再收进度，条目、回执 data 与盘上三处都没有 progress 键。
    const r2Created = ((r2.data && r2.data.workRoute && r2.data.workRoute.entries) || []).filter((e) => String(e.ticketKey) === normCreated)[0]
    check(r2Created && !Object.prototype.hasOwnProperty.call(r2Created, 'progress'), '第二次上报：在办表这一条没有 progress 键')
    check(!!(r2.data) && !Object.prototype.hasOwnProperty.call(r2.data, 'progress'), '第二次上报：回执 data 里也没有 progress 这一格')
    const after2row = createdRows[0]
    check(after2row && !Object.prototype.hasOwnProperty.call(after2row, 'progress'), '第二次上报：盘上这一条也没有 progress 键')
    // progress 参数退役（#1352）：定义里不再广告这个键，但工具 run 仍可能收到宿主原样转来的原始参数——
    // 收到就一律 bad-args，不抛、不带 data、不写盘，并在选后端之前拒绝。
    const diskBeforeBadProgress = fs.readFileSync(diskFile, 'utf8')
    const retired: Array<[string, unknown]> = [['合法数字', 40], ['0', 0], ['超过 100', 101], ['负数', -1], ['小数', 12.5], ['字符串', '30'], ['布尔', true]]
    const badSeen: string[] = []
    for (const [label, progressValue] of retired) {
      const rr = await callTool('deck_issue_report', { key: createdKey, progress: progressValue })
      const text = String(rr && rr.text || '')
      const isBad = envelopeOk(rr) && rr.ok === false && rr.reason === 'bad-args' && !rr.data
        && text.indexOf('progress 参数已退役') >= 0 && text.indexOf('deck_issue_patch') >= 0
      if (!isBad) badSeen.push(label + '（' + JSON.stringify({ ok: rr && rr.ok, status: rr && rr.status, reason: rr && rr.reason, hasData: !!(rr && rr.data), text }) + '）')
    }
    check(badSeen.length === 0, 'progress 参数已退役：带这个键（40 / 0 / 101 / -1 / 12.5 / 30 / true）一律 bad-args、不抛、不带 data，并指路 deck_issue_patch' + (badSeen.length ? '：' + badSeen.join('；') : ''))
    check(fs.readFileSync(diskFile, 'utf8') === diskBeforeBadProgress, '带已退役的 progress 时盘上一字不动（不写盘）')
    // 旧存档里已经记下的进度自评不回溯删除：手动把盘上这一条加上 progress 再上报一次，历史值还在，
    // 但回执里不再投影这一格（工作条目这一格已退役）。
    const legacy = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
    const legacyRow = legacy.workers[0].entries.filter((e) => String(e.ticketKey) === normCreated)[0]
    legacyRow.progress = 40
    fs.writeFileSync(diskFile, JSON.stringify(legacy, null, 2) + '\n')
    const keep = await callTool('deck_issue_report', { key: createdKey, note: '旧进度保留' })
    const keptDisk = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
    const keptRow = keptDisk.workers[0].entries.filter((e) => String(e.ticketKey) === normCreated)[0]
    check(envelopeOk(keep) && keep.status === 'ok' && !!keptRow && keptRow.progress === 40, '旧存档里的进度自评 40 后来的上报不会抹掉（#1352：不回溯删除，实得 ' + JSON.stringify(keptRow && keptRow.progress) + '）')
    const keepEntry = ((keep.data && keep.data.workRoute && keep.data.workRoute.entries) || []).filter((e) => String(e.ticketKey) === normCreated)[0]
    check(keepEntry && !Object.prototype.hasOwnProperty.call(keepEntry, 'progress'), '回执里不再投影历史进度（这一格已退役，实得 ' + JSON.stringify(keepEntry) + '）')
    // #1086 释放入口，2026-10-21（#1349）起收紧：这张票本会话建过、改过、关过，属于处理过的票 ——
    // 带 release=true 的上报不能再把它从工作路线里删掉，回执必须说明原因；纯误报的释放成功路径由
    // tests/verify-1106-deck-surface.ts 的「二d」用夹具里没人处理过的地图 00 覆盖。
    const relBefore = await callTool('deck_issue_get', { key: createdKey })
    const relBeforeTicket = relBefore.data && relBefore.data.ticket
    const relFace = (t) => JSON.stringify(t && { state: t.state, assignees: t.assignees })
    const rel = await callTool('deck_issue_report', { key: createdKey, release: true, workRouteDetail: 'standard' })
    const relWr = rel.data && rel.data.workRoute
    const normKey = (k) => String(k).replace(/^0+(?=\d)/, '')
    check(envelopeOk(rel) && rel.status === 'ok' && !!relWr, '释放被拒：成功回执仍带在办表（实得 ' + (rel && rel.status) + '）')
    const relOwn = (relWr && relWr.entries || []).filter((e) => normKey(e.ticketKey) === normCreated)
    check(relOwn.length === 1, '处理过的票释放被拒：在办表里这张票还在、只有一条（实得 ' + JSON.stringify(relOwn.length) + ' 条）')
    check((rel.notes || []).some((n) => String(n).indexOf('有过实际处理') >= 0 && String(n).indexOf('不能从工作路线里释放') >= 0 && String(n).indexOf('只用来撤销从没处理过的误报') >= 0),
      '处理过的票释放被拒：备注说明干过实事、不能释放：' + JSON.stringify(rel.notes))
    check(!(rel.data) || !Object.prototype.hasOwnProperty.call(rel.data, 'progress'), '释放回执的 data 里没有 progress 这一格（该格已随 #1352 退役，释放也不记动作）')
    check(JSON.stringify(rel).indexOf('s-713') < 0, '释放回执全文没有原始会话 id（只进盘）')
    const relDisk = JSON.parse(fs.readFileSync(diskFile, 'utf8'))
    const relDiskRows = ((relDisk.workers || []).flatMap((w) => w.entries || [])).filter((e) => normKey(e.ticketKey) === normCreated)
    check(relDiskRows.length === 1 && relDiskRows[0].hasWork === true, '处理过的票释放被拒：盘上这一条还在，且 hasWork=true')
    const relGet = await callTool('deck_issue_get', { key: createdKey })
    const relTicket = relGet.data && relGet.data.ticket
    check(envelopeOk(relGet) && relGet.status === 'ok' && !!relBeforeTicket && !!relTicket && relFace(relBeforeTicket) === relFace(relTicket),
      '释放不改票本身：票照样读得回来，状态与认领人前后一致（前 ' + relFace(relBeforeTicket) + '，后 ' + relFace(relTicket) + '）')
    const relAgain = await callTool('deck_issue_report', { key: createdKey, release: true })
    check(envelopeOk(relAgain) && relAgain.status === 'ok'
      && (relAgain.notes || []).some((n) => String(n).indexOf('有过实际处理') >= 0 && String(n).indexOf('不能从工作路线里释放') >= 0)
      && !(relAgain.notes || []).some((n) => String(n).indexOf('本来就不在本会话的工作路线里') >= 0),
      '再释放同一条：仍说明干过实事、不能释放（不说本来就没有）')
    const relFalse = await callTool('deck_issue_report', { key: createdKey, release: false, workRouteDetail: 'standard' })
    const relFalseEntries = relFalse.data && relFalse.data.workRoute && (relFalse.data.workRoute.entries || []).filter((e) => normKey(e.ticketKey) === normCreated)
    check(envelopeOk(relFalse) && relFalse.status === 'ok' && !!relFalseEntries && relFalseEntries.length === 1,
      'release:false 仍走正常上报：条目仍在且只有一条（实得 ' + JSON.stringify(relFalseEntries && relFalseEntries.length) + ' 条）')
    const bad = await callTool('deck_issue_report', { key: '999999' })
    check(envelopeOk(bad) && bad.ok === false && bad.status === 'unsupported', 'deck_issue_report 负向：票不存在 → ok:false / unsupported（实得 ' + (bad && bad.status) + '）')
    check(!bad.data || !bad.data.workRoute, '失败回执不带在办表（这一格只属于成功的上报）')
    const noArgs = await callTool('deck_issue_report', {})
    check(noArgs.ok === false && noArgs.reason === 'bad-args', 'deck_issue_report 负向：不给票号 → bad-args，不抛')
  }

  // ── ⑧ 每次后端调用都过闸（真闸真账本） ──
  {
    const stats = gate.stats()
    const esc = gate.escaped()
    check(esc.requests === 0 && esc.points === 0, '绕开闸的请求数为 0（闸记的 ' + JSON.stringify(stats.accounted) + ' == 传输层真发的 ' + JSON.stringify(stats.transport) + '）')
    // #1442 起离网调用不再过真闸：准入搬进 Tracker 管线（本夹具的裁决是测试本地那一份），真闸的「AI 工具」那一档保持 0 不是漏记。
    check(stats.byCategory['ai-tool'] === 0, '离网调用不再过真闸：「AI 工具」那一档是 0（实得 ' + stats.byCategory['ai-tool'] + ' 笔）')
    check(selectCount.count > 0 && stats.byCategory['ai-tool'] === 0, '选后端也不再过真闸：' + selectCount.count + ' 次成功调用、真闸 0 笔（判定走判定出口，额度走管线裁决）')
    check(Object.keys(stats.byCategory).every((c) => c === 'ai-tool' || stats.byCategory[c] === 0), '没有一笔走到别的档去（' + JSON.stringify(stats.byCategory) + '）')
    // 工具层自己只许发 host.call / host.call.fail 这两个既有事件名。
    // detection.detect 是统一判定出口的常驻结论线：2026-10-14（#1048 收口补做）给 deck 工具这条直调点
    // 也递上了日志出口，于是每趟判定会多一条结论线 —— 它不是工具层新造的名字，所以这一条放行，
    // 但另外单独钉一次「它确实出现了」，免得哪天日志出口被摘掉却没人发现。
    const ownRows = logs.filter((l) => l.event === 'host.call' || l.event === 'host.call.fail')
    const decisionRows = logs.filter((l) => l.event === 'detection.detect')
    // #1442 起调用改走 Tracker 会话，工具壳不再发 host.call；日志只剩判定出口的常驻结论线，事件名仍不许新增。
    check(ownRows.length === 0 && logs.every((l) => l.event === 'detection.detect'),
      '工具层没新造事件名：自有行是 0（会话接管了调用，host.call 不再出现），其余全是判定出口的常驻结论线 detection.detect（' + decisionRows.length + ' 行）')
    check(decisionRows.length > 0, 'deck 工具这条直调点也把判定结论写进日志了（每趟判定一条，' + decisionRows.length + ' 条）')
    check(invalidated.length > 0, '写之后失效了缓存（' + invalidated.length + ' 次）')

    // 上面那一段跑的是本地 Markdown 后端：离网口径下一个出站请求都不发，所以「账为 0」是对的（#1442 起连闸也不过了）。
    // 探针远端仍按离网口径声明（注册表只验形状，不按口径限流），但它的每个操作照生产里传输层的做法「每真发一条就报给闸一次」。
    // #1442 的管线记账是空实现（各操作真实用量 1443 才进账本），所以这几条上报在真闸这里记为绕开（escaped），而不是记入「AI 工具」那一档。
    // 这一段只钉住「记账空实现 + 逃逸探测器仍灵」，不把这几条逃逸当成事故（事故与否等 1443 接线后再判）。
    const probe = {
      id: 'probe-remote', label: '探针远端（会真发出站请求）', matches: async () => false,
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({
        id: 'probe-remote',
        async create(repo, input) { fire(2, 4); return { ok: true, data: { key: 'P1', title: input.title, state: 'open', body: String(input.body || ''), labels: [], assignees: [] } } },
        async get(repo, key) { fire(1, 3); return { ok: true, data: { key: String(key), title: 'P1', state: 'open', body: '', labels: [], assignees: [], parentKey: null } } },
      }),
    }
    const dp = registry.register(probe)
    chooseWorkspace(ws.rootPosix, 'probe-remote')   // 把工作区文件改写成选了探针远端（等同旧写法 registry.bind(handle, 'probe-remote')）
    const before = { hour: ledger.hourOf('ai-tool'), accounted: gate.stats().accounted, escaped: gate.escaped().requests }
    const r = await tools.deck_issue_create.run(exec, { title: '远端那一张', kind: 'issue' })
    const after = { hour: ledger.hourOf('ai-tool'), accounted: gate.stats().accounted, escaped: gate.escaped().requests }
    check(envelopeOk(r) && r.ok === true, '探针远端上建票成功（实得 ' + (r && r.status) + '）')
    check(after.accounted.requests - before.accounted.requests === 0, '离网探针不经真闸记账：闸记下 0 条（实得 ' + (after.accounted.requests - before.accounted.requests) + '，管线记账 1443 才接）')
    check(after.hour.requests - before.hour.requests === 0 && after.hour.points - before.hour.points === 0, '账本「AI 工具」那一档仍是 0（实得 ' + (after.hour.requests - before.hour.requests) + ' 条、' + (after.hour.points - before.hour.points) + ' 点）')
    check(after.escaped - before.escaped === 2, '探针的上报走了逃逸口（+2），逃逸探测器仍灵')
    dp.dispose()
    chooseWorkspace(ws.rootPosix, 'markdown')

    // ✗ probe：把「过闸」这件事做坏 —— 绕开闸直接发一条，escaped 必须立刻不是 0。
    // 没有这一条，「绕开闸的请求数为 0」这句话就可能是因为根本没人发请求而白过。
    const escBefore = gate.escaped().requests
    fire(1, 0)
    check(gate.escaped().requests === escBefore + 1, '✗ probe：绕开闸发一条请求 → escaped 立刻多一条（' + escBefore + ' → ' + gate.escaped().requests + '）')
  }

  // ── ⑨ 负向：后端实现抛错 → 工具返回 ok:false / partial，而不是抛 ──
  {
    const throwing = {
      id: 'boom', label: '会抛的后端', matches: async () => true,
      create: () => ({ id: 'boom' }),
      create_: null,
    }
    // 直接注册一个 create 会抛的后端：工具必须把异常收成三态返回
    // 这个后端只用来复现实现抛错被收成三态返回，不断言额度，所以按离网口径声明。
    const mod = {
      id: 'boom', label: '会抛的后端', matches: async () => false,
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({
        id: 'boom',
        async create() { throw new Error('后端实现在这里抛了（探针故意做坏）') },
        async list() { throw new Error('后端实现在这里抛了（探针故意做坏）') },
        async get() { throw new Error('后端实现在这里抛了（探针故意做坏）') },
      }),
    }
    const d2 = registry.register(mod)
    chooseWorkspace(ws.rootPosix, 'boom')
    try {
      const r = await tools.deck_issue_create.run(exec, { title: '会抛的那一张', kind: 'issue' })
      check(envelopeOk(r) && r.ok === false && r.status === 'unsupported' && r.reason === 'backend-threw', '✗ 负向：后端抛错 → ok:false / unsupported + reason=backend-threw（实得 ' + (r && r.status) + '/' + (r && r.reason) + '）')
      check(typeof r.text === 'string' && r.text.indexOf('后端实现抛错') >= 0, '抛错这件事如实写在 text 里：' + String(r && r.text).slice(0, 80))
      const r2 = await tools.deck_context.run(exec, {})
      check(envelopeOk(r2) && r2.ok === false, '✗ 负向：读路径上后端抛错也一样收成三态（' + (r2 && r2.status) + '）')
    } finally { d2.dispose(); chooseWorkspace(ws.rootPosix, 'markdown') }
  }

  // ── ⑩ 负向：会话取不到工作区 → 如实说做不到，不猜一个进程目录 ──
  {
    const r = await tools.deck_context.run({ agent: { session: {} } }, {})
    check(envelopeOk(r) && r.ok === false && r.reason === 'no-session-context', '✗ 负向：会话里没有工作区 → no-session-context（实得 ' + (r && r.reason) + '）')
  }

  // ── ⑪ 静态扫描：工具层不许判后端（不许出现后端 id 的等值比较） ──
  {
    const files = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.js') || e.name.endsWith('.ts')) files.push(p)
      }
    }
    for (const d of ['src/deck/tools', 'src/deck/shell', 'src/deck/registration']) walk(path.join(ROOT, d))
    check(files.length >= 8, '扫描到的工具层文件数（' + files.length + '：九个工具 + 两个共享壳）')
    const RE_ID = /(===|!==|==|!=)\s*['"](github|gitlab|markdown)['"]|['"](github|gitlab|markdown)['"]\s*(===|!==|==|!=)/
    const hits = []
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^A-Za-z0-9_$:])\/\/.*$/gm, '$1')
      text.split('\n').forEach((line, i) => { if (RE_ID.test(line)) hits.push(path.relative(ROOT, f) + ':' + (i + 1) + ' ' + line.trim()) })
    }
    check(hits.length === 0, '工具层没有后端 id 的等值比较（' + (hits.length ? hits.join(' / ') : '零命中') + '）')
    // 反证：把一行坏代码放进内存里，扫描器必须逮住（否则上面那条断言是空的）
    const probe = "const x = sel.backendId === 'github'"
    check(RE_ID.test(probe), '✗ probe：扫描规则能逮住 `backendId === \'github\'` 这种写法')
    check(!RE_ID.test("const x = pick.backendId ? 'yes' : 'no'"), '扫描规则不误伤正常的取用（不把「用了 backendId」当违规）')
  }

  // ── ⑫ 算账：调用前算出来的数与 budget.js 的硬顶一致（分片算式与 budget.shardPlan 逐值比） ──
  {
    const limits = shellMod.limitsFromBudget(budget)
    const est = toolCost.estimateToolCost({ tool: 'deck_map_plan_create', tickets: 61, edges: 0 }, limits)
    const plan = budget.shardPlan(61)
    check(est.shards === plan.shards && est.perShard === plan.perShard, '分片算式与 budget.shardPlan 逐值一致（' + JSON.stringify(est) + ' vs ' + JSON.stringify(plan) + '）')
    check(est.withinCallCap === false || est.points <= budget.AI_TOOL_MAX_POINTS_PER_CALL, '61 张票这一笔按 budget.js 的硬顶判（points=' + est.points + '，顶=' + budget.AI_TOOL_MAX_POINTS_PER_CALL + '）')
    const over = toolCost.estimateToolCost({ tool: 'deck_map_plan_create', tickets: 400, edges: 400 }, limits)
    check(over.withinCallCap === false && over.overCallCap !== '', '超顶的那一笔被判出来（' + over.overCallCap + '：' + over.text + '）')
  }

  // ── ⑬ 判定出口缺席：打开会话要回一个规规矩矩的拒绝，不能把 (原因码, 文案) 错当成 (工具名, 原因码, 文案) 递出去 ──
  //    这一支以前没有门禁覆盖（十几条夹具都照生产接上了判定出口），#1040 转 TypeScript 时类型检查才把它抓出来。
  //    #1443 起这一步搬进了 openDeckSession（旧壳的 pickBackend 已删），同一条照旧钉在这里。
  {
    const sessionMod = await imp('src/deck/tools/tracker-session.ts')
    const opened = await sessionMod.openDeckSession({ deps: Object.assign({}, deps, { decideBackend: undefined }), exec: exec, session: { cwd: ws.rootPosix, workspaceKey: 'ws-bare', sessionId: 's-713' }, estimate: { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' }, tool: 'deck_context', kind: 'op' })
    check(opened && opened.ok === false && opened.reason === 'backend-threw', '判定出口缺席时回原因码 backend-threw（实得 ' + JSON.stringify(opened && opened.reason) + '）')
    check(typeof (opened && opened.text) === 'string' && String(opened.text).indexOf('判定出口这次没装上') === 0, '拒绝文案是一句话，不是对象（实得 ' + JSON.stringify(opened && opened.text) + '）')
    check(opened && !('status' in opened) && !('tool' in opened), '拒绝不是信封：没有 status / tool 那两格')
  }

  // ── ⑭ 注进依赖的等待口用于仓库标识补全的竞速：getRepoKey 一直不回时，打开会话用注入的等待口兜底，不把进程吊死 ──
  //    旧路把等待口一路递到工具侧上下文（ctx.sleep）；#1443 起调用上下文不再带等待口，等待口只活在打开会话那一步的
  //    补全竞速里（缺席时用真定时器，测试注入假的）。这一条钉住：注入的口子确实被用，且毫秒数是依赖里配的那一格。
  {
    const sessionMod2 = await imp('src/deck/tools/tracker-session.ts')
    const injectedCalls = []
    const injected = (ms) => { injectedCalls.push(ms); return Promise.resolve(null) }
    const slowReg = {
      has: () => true,
      describe: () => ({ backend: 'github', refId: '', name: 'ws', url: '' }),
      get: () => ({ getRepoKey: () => new Promise(() => {}) }),
      modules: () => [{ id: 'github', budget: { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true } }],
    }
    const slowDeps = Object.assign({}, deps, { registry: slowReg, sleep: injected, resolveTimeoutMs: 50, decideBackend: async () => ({ backendId: 'github', source: 'matches', ref: null, canWrite: true }) })
    const opened2 = await sessionMod2.openDeckSession({ deps: slowDeps, exec: exec, session: { cwd: ws.rootPosix, workspaceKey: 'ws-slow', sessionId: 's-713' }, estimate: { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' }, tool: 'deck_context', kind: 'op' })
    check(opened2 && opened2.ok === true, '补全 hang 住时打开会话照样成功（等待口兜底，实得 ' + JSON.stringify(opened2 && opened2.reason) + '）')
    check(injectedCalls.length === 1 && injectedCalls[0] === 50, '注入的等待口被用了一次，毫秒数是依赖里配的 50（实得 ' + JSON.stringify(injectedCalls) + '）')
  }

  ws.cleanup()
  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch (e) {}
  try { dispose.dispose() } catch (e) {}
  console.log('\n' + (failed ? '存在失败' : '全部通过 — 九个工具：过闸、三态、永不抛、不判后端（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
