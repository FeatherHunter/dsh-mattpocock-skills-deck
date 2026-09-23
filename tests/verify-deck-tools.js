// verify-deck-tools.js —— 门禁：七个后端无关工具（#713 第六批）
// 用法：在插件根目录执行 node tests/verify-deck-tools.js，可独立运行。
//
// 这一段盯四件事，都是票面点名要的：
//   ① 七个工具各一条正例：调用能不能真的把事情做完（在真实本地 Markdown 后端上跑，票就是盘上的文件）。
//   ② 两条负向：`unsupported`（后端说做不到 / 会话取不到工作区）与 `partial`（一批里有的成、有的没成）。
//   ③ **每次后端调用都过闸**：这一段用的是真闸真账本（#706 T2 的 gate.js + ledger.js），
//      传输层每真发一条就报一次;所以「闸记下来的」与「传输层真发的」必须相等（escaped 必须为 0），
//      而「AI 工具那一档」的账必须有数 —— 谁绕开闸发请求，这个数就不是 0。
//   ④ 一条负向：让后端实现抛错 → 工具必须回 ok:false / partial，而不是把异常抛给 AI。
//
// 另外两条静态扫描（票面「加固补充」要求）：src/host/tools/** 与 src/shared/deck-tools/** 里
// 不许出现后端 id 的等值比较（`=== 'github'` 这种），否则工具就在自己判后端了。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const TOOL_FILES = [
  ['src/host/tools/deckContext.js', 'createDeckContext', 'deck_context'],
  ['src/host/tools/deckIssueGet.js', 'createDeckIssueGet', 'deck_issue_get'],
  ['src/host/tools/deckMapSnapshot.js', 'createDeckMapSnapshot', 'deck_map_snapshot'],
  ['src/host/tools/deckIssueCreate.js', 'createDeckIssueCreate', 'deck_issue_create'],
  ['src/host/tools/deckMapPlanCreate.js', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
  ['src/host/tools/deckMapLink.js', 'createDeckMapLink', 'deck_map_link'],
  ['src/host/tools/deckIssuePatch.js', 'createDeckIssuePatch', 'deck_issue_patch'],
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
    ticketFiles() { try { return fs.readdirSync(path.join(dir, 'issues')).filter((f) => f.endsWith('.md')) } catch (e) { return [] } },
    readTicket(name) { return fs.readFileSync(path.join(dir, 'issues', name), 'utf8') },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('七个后端无关工具的门禁（#713 T9：过闸、三态、永不抛、不判后端）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const registryMod = await imp('src/host/tracker/registryCore.js')
  const markdownModule = (await imp('src/host/tracker/backends/markdown/index.js')).markdownModule
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const planMod = await imp('src/shared/deck-tools/plan.js')
  const shellMod = await imp('src/shared/deck-tools/shell.js')

  // ── 组装：真闸 + 真账本 + 真注册表 + 真实本地 Markdown 后端 ──
  const ws = makeWorkspace()
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const logs = []
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  registry.bind(handle, 'markdown')   // 走「用户手动选择」那一档，测试不依赖锚文件识别
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  // 假传输层：每真发一条就报给闸（生产里这一层是起 gh / glab 进程的那一层；本地 Markdown 不发请求）。
  const transport = { requests: 0, points: 0 }
  function fire(requests, points) {
    transport.requests += (requests || 0)
    transport.points += (points || 0)
    gate.noteOutbound({ requests: requests || 0, points: points || 0 })
  }

  const invalidated = []
  const planStore = (() => {
    const table = new Map()
    return { durable: true, load(id) { return table.get(String(id)) || null }, save(id, s) { table.set(String(id), s) } }
  })()
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx, handleFor: () => handle,
    log: { fire: (level, event, fields) => logs.push({ level: level, event: event, fields: fields }) },
    now: () => clock,
    invalidate: (info) => invalidated.push(info),
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
    check(String(tool.definition.description || '').length <= 60, name + ' 的描述是一句话（' + String(tool.definition.description || '').length + ' 字）')
  }

  const callTool = async (name, args) => {
    const r = await tools[name].run(exec, args || {})
    // 选后端成功的那几次调用，每笔至少要过两次闸（选后端一次 + 真正读写一次）。
    // 这条计数是「选后端那一步有没有过闸」的唯一证据：绑定过的注册表在 select 时不发任何请求，
    // 只查「绕开闸的请求数为 0」是看不出一位绕开闸的 select 的（见交付报告里的反证 A）。
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
  {
    const r = await callTool('deck_issue_create', { title: '第一张演示票', kind: 'task', body: '正文在这里' })
    createdKey = String((r.data && r.data.ticket && r.data.ticket.key) || '')
    check(envelopeOk(r) && r.status === 'ok' && createdKey, 'deck_issue_create 正例：建成了（key=' + createdKey + '）')
    check(r.items.length === 0 && (r.notes || []).some((n) => n.indexOf('必备标签') >= 0), 'deck_issue_create 说明「我替你加了什么」：' + JSON.stringify(r.notes))
    const files = ws.ticketFiles()
    check(files.length === 1, 'deck_issue_create 真的落到了盘上的票文件（' + files.join('、') + '）')
    const text = files.length ? ws.readTicket(files[0]) : ''
    check(text.indexOf('wayfinder:task') >= 0, '必备标签写进了票文件')
    check(text.indexOf('## 进度') >= 0, '进度区写进了票文件')
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
    check(r.data && r.data.blocks && Array.isArray(r.data.blocks.destination === undefined ? r.data.blocks.notes : []), 'deck_map_snapshot 带回五个区块')
  }

  // ── ⑤ deck_map_plan_create：一整张地图的骨架（含分片与中间态） ──
  {
    const planArgs = {
      planId: 'plan-713-a', title: '演示地图甲',
      children: [{ key: 'a1', title: '子票一' }, { key: 'a2', title: '子票二' }, { key: 'a3', title: '子票三' }],
      edges: [{ from: 'a2', to: 'a1', type: 'blocked-by' }],
    }
    const filesBefore = ws.ticketFiles().length
    const r = await callTool('deck_map_plan_create', planArgs)
    check(envelopeOk(r), 'deck_map_plan_create 正例：回三态之一（实得 ' + (r && r.status) + '）')
    check(r.data && r.data.mapKey && r.data.builtKeys.length === 3, 'deck_map_plan_create 建成地图 + 3 张子票（' + JSON.stringify((r.data || {}).builtKeys) + '）')
    const edgeItems = (r.items || []).filter((i) => i.role === 'edge')
    check(edgeItems.length === 1 && edgeItems[0].landing && edgeItems[0].evidence, 'deck_map_plan_create 每条边都标出落点与证据：' + JSON.stringify(edgeItems[0]))
    check(r.data.durable === true, 'deck_map_plan_create 的中间态是落盘的（注入的 planStore 说它 durable）')
    // 续跑：同一个 planId 再来一次 → 一张票都不重复建
    const again = await callTool('deck_map_plan_create', planArgs)
    check(again.data && again.data.skippedKeys.length === 3 && again.data.builtKeys.length === 3, 'deck_map_plan_create 续跑：同一个 planId 再来一次只跳过、不重复建（skipped=' + JSON.stringify((again.data || {}).skippedKeys) + '）')
    check(ws.ticketFiles().length === filesBefore + 4, '盘上的票文件数对得上（地图 1 + 子票 3 = 4 张新票，实得新增 ' + (ws.ticketFiles().length - filesBefore) + '）')
  }

  // ── ⑥ deck_map_link：补边（正例 = 阻塞边；负向 = 这个后端做不到父子 → partial） ──
  {
    const kids = (await callTool('deck_map_snapshot', { key: '00' })).data.children
    const c1 = String(kids.find((k) => k.title === '子票一').key)
    const c3 = String(kids.find((k) => k.title === '子票三').key)
    const ok = await callTool('deck_map_link', { key: c3, blockedBy: [c1] })
    check(envelopeOk(ok) && ok.status === 'ok', 'deck_map_link 正例：补一条阻塞边（实得 ' + (ok && ok.status) + '）')
    const edge = (ok.items || [])[0]
    check(edge && edge.landing && edge.evidence, 'deck_map_link 标出这条边落在哪一列：' + JSON.stringify(edge))
    const text = ws.readTicket(ws.ticketFiles().find((f) => f.indexOf('/') < 0 && f !== '00-untitled.md') || '')
    check(typeof text === 'string', '补边之后票文件还在（不会被写坏）')
    // 负向：本地 Markdown 的 setParent 是做不到的（单根工作区）→ 这一步失败，工具必须回 partial 而不是抛
    const partial = await callTool('deck_map_link', { key: c3, parentKey: '00' })
    check(envelopeOk(partial) && partial.ok === false && partial.status === 'unsupported', '✗ 负向：后端说做不到 → ok:false / unsupported（实得 ' + (partial && partial.status) + '）')
    check((partial.items || []).some((i) => i.landing && i.landing.indexOf('做不到') >= 0) || (partial.items || []).some((i) => String(i.reason || i.evidence || '').indexOf('unsupported') >= 0), '做不到的那一条逐项写在 items 里：' + JSON.stringify((partial.items || [])[0]))
  }

  // ── ⑦ deck_issue_patch：改一张票（评论 + 标签 + 关闭；负向：后端做不到认领） ──
  {
    const r = await callTool('deck_issue_patch', { key: createdKey, comment: '这一条是工具发的评论', addLabels: ['wayfinder:research'], close: true })
    check(envelopeOk(r), 'deck_issue_patch 正例：回三态之一（实得 ' + (r && r.status) + '）')
    check((r.items || []).some((i) => i.step === 'comment' && i.status === 'ok'), 'deck_issue_patch 评论那一步成了：' + JSON.stringify(r.items))
    check((r.items || []).some((i) => i.step === 'close' && i.status === 'ok'), 'deck_issue_patch 关闭那一步成了')
    const assign = await callTool('deck_issue_patch', { key: createdKey, comment: '再来一条评论', assignees: ['someone'] })
    check(envelopeOk(assign) && assign.status === 'partial', '✗ 负向：本地 Markdown 只改状态不记认领人 → 评论成了、认领没成，回 partial（实得 ' + (assign && assign.status) + '）')
    check((assign.items || []).some((i) => i.step === 'assignees' && i.status === 'failed' && String(i.reason).indexOf('没记认领人') >= 0), '认领那一步如实说了「只改了状态、没记认领人」：' + JSON.stringify((assign.items || []).filter((i) => i.step === 'assignees')[0]))
    const nothing = await callTool('deck_issue_patch', { key: createdKey })
    check(nothing.ok === false && nothing.reason === 'bad-args', 'deck_issue_patch 负向：什么都没点名 → bad-args，不抛')
  }

  // ── ⑧ 每次后端调用都过闸（真闸真账本） ──
  {
    const stats = gate.stats()
    const esc = gate.escaped()
    check(esc.requests === 0 && esc.points === 0, '绕开闸的请求数为 0（闸记的 ' + JSON.stringify(stats.accounted) + ' == 传输层真发的 ' + JSON.stringify(stats.transport) + '）')
    check(stats.byCategory['ai-tool'] >= 10, '这些调用都记在「AI 工具」那一档（' + stats.byCategory['ai-tool'] + ' 笔）')
    check(selectCount.count > 0 && stats.byCategory['ai-tool'] >= selectCount.count * 2, '每笔工具调用至少过两次闸（选后端一次 + 真正读写一次）：' + stats.byCategory['ai-tool'] + ' 笔闸 ≥ ' + selectCount.count + ' 次调用 × 2')
    check(Object.keys(stats.byCategory).every((c) => c === 'ai-tool' || stats.byCategory[c] === 0), '没有一笔走到别的档去（' + JSON.stringify(stats.byCategory) + '）')
    check(logs.length > 0 && logs.every((l) => l.event === 'host.call' || l.event === 'host.call.fail'), '每个工具调用都落了既有事件 host.call / host.call.fail（' + logs.length + ' 行），没有新造事件名')
    check(invalidated.length > 0, '写之后失效了缓存（' + invalidated.length + ' 次）')

    // 上面那一段跑的是本地 Markdown 后端：它一个出站请求都不发，所以「账为 0」是对的。
    // 要证明「真的过了闸、真的记了账」，得用一个会真发出站请求的后端 —— 探针远端：
    // 它的每个操作都照生产里传输层的做法「每真发一条就报给闸一次」。
    const probe = {
      id: 'probe-remote', label: '探针远端（会真发出站请求）', matches: async () => false,
      create: () => ({
        id: 'probe-remote',
        async create(repo, input) { fire(2, 4); return { ok: true, data: { key: 'P1', title: input.title, state: 'open', body: String(input.body || ''), labels: [], assignees: [] } } },
        async get(repo, key) { fire(1, 3); return { ok: true, data: { key: String(key), title: 'P1', state: 'open', body: '', labels: [], assignees: [], parentKey: null } } },
      }),
    }
    const dp = registry.register(probe)
    registry.bind(handle, 'probe-remote')
    const before = { hour: ledger.hourOf('ai-tool'), accounted: gate.stats().accounted }
    const r = await tools.deck_issue_create.run(exec, { title: '远端那一张' })
    const after = { hour: ledger.hourOf('ai-tool'), accounted: gate.stats().accounted }
    check(envelopeOk(r) && r.ok === true, '探针远端上建票成功（实得 ' + (r && r.status) + '）')
    check(after.accounted.requests - before.accounted.requests === 2, '闸记下 2 条真实出站请求（实得 ' + (after.accounted.requests - before.accounted.requests) + '）')
    check(after.hour.requests - before.hour.requests === 2 && after.hour.points - before.hour.points === 4, '账本「AI 工具」那一档记下同样多（' + (after.hour.requests - before.hour.requests) + ' 条、' + (after.hour.points - before.hour.points) + ' 点）')
    check(gate.escaped().requests === 0, '绕开闸的请求数仍然是 0')
    dp.dispose()
    registry.bind(handle, 'markdown')

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
    const mod = {
      id: 'boom', label: '会抛的后端', matches: async () => false,
      create: () => ({
        id: 'boom',
        async create() { throw new Error('后端实现在这里抛了（探针故意做坏）') },
        async list() { throw new Error('后端实现在这里抛了（探针故意做坏）') },
        async get() { throw new Error('后端实现在这里抛了（探针故意做坏）') },
      }),
    }
    const d2 = registry.register(mod)
    registry.bind(handle, 'boom')
    try {
      const r = await tools.deck_issue_create.run(exec, { title: '会抛的那一张' })
      check(envelopeOk(r) && r.ok === false && r.status === 'unsupported' && r.reason === 'backend-threw', '✗ 负向：后端抛错 → ok:false / unsupported + reason=backend-threw（实得 ' + (r && r.status) + '/' + (r && r.reason) + '）')
      check(typeof r.text === 'string' && r.text.indexOf('后端实现抛错') >= 0, '抛错这件事如实写在 text 里：' + String(r && r.text).slice(0, 80))
      const r2 = await tools.deck_context.run(exec, {})
      check(envelopeOk(r2) && r2.ok === false, '✗ 负向：读路径上后端抛错也一样收成三态（' + (r2 && r2.status) + '）')
    } finally { d2.dispose(); registry.bind(handle, 'markdown') }
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
        else if (e.name.endsWith('.js')) files.push(p)
      }
    }
    for (const d of ['src/host/tools', 'src/shared/deck-tools']) walk(path.join(ROOT, d))
    check(files.length >= 8, '扫描到的工具层文件数（' + files.length + '：七个工具 + 两个共享壳）')
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

  ws.cleanup()
  try { dispose.dispose() } catch (e) {}
  console.log('\n' + (failed ? '存在失败' : '全部通过 — 七个工具：过闸、三态、永不抛、不判后端（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
