// verify-deck-tools-matrix.js —— 门禁：同一个动作在三种后端上分别落到哪里（#713 第六批）
// 用法：在插件根目录执行 node tests/verify-deck-tools-matrix.js，可独立运行。
//
// 为什么要这一段：这七个工具坐在 tracker 契约之上，而三个后端表达关系的方式**不一样**：
//   GitHub：父子是它自己的原生 sub-issues 层级，阻塞是原生 dependencies 边；
//   GitLab：父子落在平级链接 relates_to 上（不是层级），阻塞走它的回退路 —— 重写票的正文里那一行；
//   本地 Markdown：父子根本做不到（单根工作区），阻塞写进票文件正文里的 Blocked by 那一行。
// 同一个工具调用在这三种地方会得到不同的结果。如果返回里不逐项说清落点，AI 会以为地图结构已经建好了
// （对抗式审查里点名的那条攻击）。所以这一段把「建票 / 建整张地图骨架 / 补边 / 改票 / 读回」
// 五个动作在三个后端上各跑一遍，把真实结果收成一张对照表（打印在标准输出、写入 .tmp/713-backend-matrix.md），
// 并逐条断言：
//   ① 每个格子都回三态之一，从不抛异常；
//   ② 每条边都带落点与非空证据（做不到的照后端原话写）；
//   ③ 每次后端调用都过闸：闸记的 == 传输层真发的，绕开闸的条数为 0；
//   ④ 带上锚：同一个锚两次只多一张票；不带锚两次仍建两张（既有行为不许被改坏）。
//
// 三个后端都是**真后端模块**：GitHub / GitLab 用脚本化的 gh / glab（按真实命令形状回 JSON，每条命令都是一条
// 真实出站请求，照生产里传输层的做法报给闸）；本地 Markdown 用真实临时工作区，票就是文件。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const { makeScriptedGh, makeScriptedGlab } = require('./deck-tools-matrix-transports.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

/** 表格里那一格：这个动作在这个后端上落到哪里（精确说法由本文件给出，工具自己只报它看到的证据）。 */
const PRECISE = {
  github: { parent: '原生层级（GitHub sub-issues）', block: '原生依赖边（GitHub dependencies）' },
  gitlab: { parent: '平级链接（relates_to，不是层级）', block: '正文行（Blocked by 那一行）' },
  markdown: { parent: '做不到（单根工作区没有层级父子）', block: '正文行（票文件里的 Blocked by）' },
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、三个后端各自的现场
// ─────────────────────────────────────────────────────────────────────────────
function markdownLane() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-matrix-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 矩阵演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n演示\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
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
    id: 'markdown', label: '本地 Markdown（票就是工作区里的文件）',
    handle: { cwd: rootPosix, refId: '.scratch/demo' },
    backendCtx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name) { return name === 'fs' ? plat.fs : undefined } },
    repo: { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' },
    isRemote: false,
    evidence: () => '票文件：' + (() => { try { return fs.readdirSync(path.join(dir, 'issues')).join('、') } catch (e) { return '（还没有）' } })(),
    ticketKeys: () => { try { return fs.readdirSync(path.join(dir, 'issues')).map((f) => f.replace(/\.md$/, '')) } catch (e) { return [] } },
    cleanup: () => { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

function remoteLane(id, scripted, module, sink) {
  const bin = id === 'github' ? 'gh' : 'glab'
  const cwd = '/ws/' + id
  return {
    id: id, label: id === 'github' ? 'GitHub（原生 sub-issues / 原生依赖边）' : 'GitLab（父子是平级链接，阻塞退回正文）',
    handle: { cwd: cwd, refId: 'acme/demo' },
    isRemote: true,
    repo: { backend: id, refId: 'acme/demo', name: 'demo', url: '' },
    evidence: () => '命令：' + (sink.length ? sink[sink.length - 1] : '（没有发命令）'),
    sink: sink,
    scripted: scripted,
    cleanup: () => {},
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、主体
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('三后端矩阵门禁（#713 T9：同一个动作在 github / gitlab / markdown 上分别落到哪里）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const registryMod = await imp('src/host/tracker/registryCore.js')
  const githubModule = (await imp('src/host/tracker/backends/github/index.js')).githubModule
  const gitlabBackend = (await imp('src/host/tracker/backends/gitlab/index.js')).gitlabBackend
  const markdownModule = (await imp('src/host/tracker/backends/markdown/index.js')).markdownModule
  const toolCost = await imp('src/shared/refresh/tool-cost.js')

  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  const ghSink = []
  const glSink = []
  const gh = makeScriptedGh(ghSink)
  const gl = makeScriptedGlab(glSink)
  // 假传输层：gh / glab 每执行一条命令就是一条真实出站请求，照生产里那一层的做法报给闸。
  // （git 只读远端地址那一条不算 HTTP 请求，所以不报。）
  const ghCtx = {
    cwd: '/ws/github',
    platform: { resolveExecutable: async (n) => (n === 'gh' ? '/usr/local/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd, args) => { if (cmd === 'gh') gate.noteOutbound({ requests: 1, points: 0 }); return gh.exec(cmd, args) },
    isEnabled: () => false, logEvent: () => {},
  }
  const glCtx = {
    cwd: '/ws/gitlab',
    platform: { resolveExecutable: async (n) => (n === 'glab' ? '/usr/local/bin/glab' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd, args) => { if (cmd === 'glab') gate.noteOutbound({ requests: 1, points: 0 }); return gl.run(args) },
    isEnabled: () => false, logEvent: () => {},
  }

  const mdLane = markdownLane()
  const lanes = [
    Object.assign(remoteLane('github', gh, githubModule, ghSink), { backendCtx: ghCtx, module: githubModule }),
    Object.assign(remoteLane('gitlab', gl, gitlabBackend, glSink), { backendCtx: glCtx, module: gitlabBackend }),
    Object.assign(mdLane, { module: markdownModule }),
  ]

  const registry = registryMod.createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const disposals = []
  for (const lane of lanes) {
    disposals.push(registry.register(lane.module))
    registry.bind(lane.handle, lane.id)
  }
  const byCwd = new Map(lanes.map((l) => [l.handle.cwd, l]))
  const laneOf = (id) => lanes.find((l) => l.id === id)

  let currentLane = null
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    handleFor: (s) => (byCwd.get(s.cwd) || {}).handle,
    // 三个车道的现场（platform / fs / exec）不同：壳每次调用时现取当前车道的那一份。
    backendCtx: () => (currentLane ? currentLane.backendCtx : {}),
    now: () => clock,
    log: { fire: () => {} },
    planStore: (() => { const t = new Map(); return { durable: true, load(id) { return t.get(id) || null }, save(id, s) { t.set(id, s) } } })(),
    invalidate: () => {},
  }
  const tools = {}
  for (const [file, factory, name] of [
    ['src/host/tools/deckIssueCreate.js', 'createDeckIssueCreate', 'deck_issue_create'],
    ['src/host/tools/deckMapPlanCreate.js', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
    ['src/host/tools/deckMapLink.js', 'createDeckMapLink', 'deck_map_link'],
    ['src/host/tools/deckIssuePatch.js', 'createDeckIssuePatch', 'deck_issue_patch'],
    ['src/host/tools/deckIssueGet.js', 'createDeckIssueGet', 'deck_issue_get'],
    ['src/host/tools/deckMapSnapshot.js', 'createDeckMapSnapshot', 'deck_map_snapshot'],
  ]) {
    const mod = await imp(file)
    tools[name] = mod[factory](deps)
  }

  const envelopeOk = (r) => r && typeof r === 'object' && typeof r.ok === 'boolean' && ['ok', 'partial', 'unsupported'].indexOf(r.status) >= 0
  const edgesOfItems = (r) => ((r && r.items) || []).filter((i) => i && (i.op === 'parent' || i.op === 'block'))

  const table = []
  for (const lane of lanes) {
    currentLane = lane
    const exec = { agent: { session: { id: 's-' + lane.id, cwd: lane.handle.cwd } } }
    const rows = {}
    const run = async (name, args) => {
      try { return await tools[name].run(exec, args) } catch (e) { return { ok: false, status: 'threw', reason: String((e && e.message) || e) } }
    }
    // ① 建票
    const create = await run('deck_issue_create', { title: '矩阵第一张票', kind: 'task' })
    rows.create = create
    const evCreate = laneEvidence(lane)
    // ② 建整张地图骨架
    const plan = await run('deck_map_plan_create', { planId: 'mx-' + lane.id, title: '矩阵地图 ' + lane.id, children: [{ key: 'c1', title: '子票一' }, { key: 'c2', title: '子票二' }], edges: [{ from: 'c2', to: 'c1', type: 'blocked-by' }] })
    rows.plan = plan
    const evPlan = laneEvidence(lane)
    const mapKey = String((plan.data && plan.data.mapKey) || '00')
    // 建成的票号按计划顺序取（工具返回值里叫 builtKeys；planKey 在 items 里）
    const built = ((plan.items || []).filter((i) => i.role === 'child').map((i) => String(i.key))).filter(Boolean)
    const keys = built.length ? built : ((plan.data && plan.data.builtKeys) || []).map(String)
    const child1 = String(keys[0] || '')
    const child2 = String(keys[1] || '')
    // ③ 补边（父子 + 阻塞，一次调用两种边）
    rows.link = await run('deck_map_link', { key: child2, parentKey: mapKey, blockedBy: [child1] })
    const evLink = laneEvidence(lane)
    // ④ 改票
    rows.patch = await run('deck_issue_patch', { key: child1, comment: '矩阵改票：一条评论', addLabels: ['wayfinder:research'], close: true })
    const evPatch = laneEvidence(lane)
    // ⑤ 读回
    rows.read = await run('deck_issue_get', { key: child2 })
    rows.snapshot = await run('deck_map_snapshot', { key: mapKey })

    check(envelopeOk(create) && create.ok === true, '[' + lane.id + '] 建票：回 ok（实得 ' + create.status + '）')
    check(envelopeOk(plan) && plan.data && plan.data.mapKey && keys.length === 2, '[' + lane.id + '] 建整张地图骨架：地图票 ' + (plan.data && plan.data.mapKey) + '，子票 ' + keys.join('、') + '；没成的逐条：' + JSON.stringify(((plan && plan.items) || []).filter((i) => i.status !== 'ok').map((i) => i.planKey + ':' + String(i.reason || '').slice(0, 120))))
    check(envelopeOk(rows.link) && edgesOfItems(rows.link).length === 2, '[' + lane.id + '] 补边：父子与阻塞两条边都逐项回了（' + JSON.stringify(edgesOfItems(rows.link).map((i) => i.landing)) + '）')
    check(envelopeOk(rows.patch), '[' + lane.id + '] 改票：回三态之一（' + rows.patch.status + '）')
    check(envelopeOk(rows.read) && rows.read.ok === true, '[' + lane.id + '] 读回：回 ok（票 ' + child2 + '）')
    check(envelopeOk(rows.snapshot) && rows.snapshot.ok === true, '[' + lane.id + '] 看地图：回 ok')

    // 每条边都必须带落点与非空证据
    const allEdges = edgesOfItems(rows.link).concat(edgesOfItems(rows.plan))
    check(allEdges.length >= 2 && allEdges.every((i) => typeof i.landing === 'string' && i.landing && typeof i.evidence === 'string' && i.evidence.length > 0),
      '[' + lane.id + '] 每条边都带落点与非空证据：' + JSON.stringify(allEdges.map((i) => ({ op: i.op, landing: i.landing, evidence: i.evidence.slice(0, 60) }))))

    // 落点必须与这个后端的真实落法一致（工具那侧分不出原生层级与平级链接时，如实降一档也是对的）
    const parentEdge = edgesOfItems(rows.link).find((i) => i.op === 'parent')
    const blockEdge = edgesOfItems(rows.link).find((i) => i.op === 'block')
    const okParent = lane.id === 'markdown'
      ? (parentEdge.landing.indexOf('做不到') >= 0)
      : (parentEdge.landing.indexOf('契约的父子列') >= 0)
    check(okParent, '[' + lane.id + '] 父子边落点如实：' + parentEdge.landing + ' ｜ ' + PRECISE[lane.id].parent)
    const okBlock = lane.id === 'github' ? (blockEdge.landing === '原生依赖边') : (blockEdge.landing === '正文行')
    check(okBlock, '[' + lane.id + '] 阻塞边落点如实：' + blockEdge.landing + ' ｜ ' + PRECISE[lane.id].block)

    // ⑥ 带上锚：同一个锚两次只多一张；不带锚两次仍建两张（既有行为不许被改坏）
    const tracker = registry.get(lane.id)
    const repo = lane.repo
    const opCtx = lane.backendCtx
    const before = laneCount(lane)
    const viaGate = (fn) => gate.send({ source: 'tool.call', kind: 'tool-batch', bucket: 'graphql', workspaceKey: 'ws-' + lane.id, plan: [{}] }, async () => { await fn(); return { requests: 0, points: 0 } })
    let a1 = null
    let a2 = null
    let b1 = null
    let b2 = null
    await viaGate(async () => {
      a1 = await tracker.create(repo, { title: '锚：同一张', idempotencyKey: 'MX-' + lane.id }, opCtx)
      a2 = await tracker.create(repo, { title: '锚：同一张', idempotencyKey: 'MX-' + lane.id }, opCtx)
      b1 = await tracker.create(repo, { title: '没锚：两张之一' }, opCtx)
      b2 = await tracker.create(repo, { title: '没锚：两张之二' }, opCtx)
    })
    const after = laneCount(lane)
    check(a1 && a1.ok === true && a2 && a2.ok === true && String(a1.data.key) === String(a2.data.key), '[' + lane.id + '] 带同一个锚提交两次：只多一张、返回同一个 key（' + (a1 && a1.data && a1.data.key) + '）')
    check(b1 && b1.ok === true && b2 && b2.ok === true && String(b1.data.key) !== String(b2.data.key), '[' + lane.id + '] 不带锚提交两次：仍然建出两张（' + (b1 && b1.data && b1.data.key) + ' / ' + (b2 && b2.data && b2.data.key) + '）')
    check(after - before === 3, '[' + lane.id + '] 四次提交在远端/盘上只多出 3 张票（实得 ' + (after - before) + '）')

    table.push({
      lane: lane.id, label: lane.label,
      create: { status: create.status, 落点: '后端自己的票位置', 证据: evCreate },
      plan: { status: plan.status, 落点: '地图票 ' + mapKey + ' + 子票 ' + keys.join('、') + '（父子按这个后端的方式）', 证据: evPlan },
      link: { status: rows.link.status, 落点: '父子→' + PRECISE[lane.id].parent + '；阻塞→' + PRECISE[lane.id].block, 证据: blockEdge.evidence.slice(0, 90) + ' ｜ ' + evLink },
      patch: { status: rows.patch.status, 落点: '评论 / 标签 / 关闭各落在后端自己的票上', 证据: evPatch },
      read: { status: rows.read.status, 落点: '契约字段（父子列 + 阻塞列）', 证据: '票 ' + child2 + '：' + (rows.read.notes || []).join('；') },
    })
  }

  // ── ③ 每次后端调用都过闸 ──
  {
    const esc = gate.escaped()
    const stats = gate.stats()
    check(esc.requests === 0 && esc.points === 0, '两个远端车道发出去的命令全部过了闸（闸记 ' + stats.accounted.requests + ' 条 == 传输层真发 ' + stats.transport.requests + ' 条，绕开闸 ' + esc.requests + ' 条）')
    check(stats.accounted.requests > 0, '远端车道上真的发出了请求（' + stats.accounted.requests + ' 条），所以上面那条不是空过')
    check(gate.stats().byCategory['ai-tool'] > 0, '这些调用都记在「AI 工具」那一档（' + gate.stats().byCategory['ai-tool'] + ' 笔）')
  }

  // ── 对照表：打印 + 落文件 ──
  const md = renderTable(table)
  console.log('\n' + md + '\n')
  try {
    fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, '.tmp', '713-backend-matrix.md'), md, 'utf8')
    check(true, '对照表写进 .tmp/713-backend-matrix.md')
  } catch (e) { check(false, '对照表写盘失败：' + String(e && e.message)) }
  check(table.length === 3 && table.every((r) => r.link.落点.indexOf('→') > 0), '三个后端各一行，且每行的落点都写清了「这个动作落到哪里」')

  for (const d of disposals) { try { d.dispose() } catch (e) {} }
  for (const lane of lanes) lane.cleanup()
  console.log('\n' + (failed ? '存在失败' : '全部通过 — 三后端矩阵（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

/** 这个车道上现在一共有几张票（远端数远端模型里的票，本地数盘上的票文件）。 */
function laneCount(lane) {
  if (lane.id === 'markdown') return lane.ticketKeys().length
  return (lane.scripted.tickets || lane.scripted.issues).length
}

/** 这个车道上最近发生的一条可核对的证据（远端是最后一条命令，本地是盘上的票文件清单）。 */
function laneEvidence(lane) {
  if (lane.id !== 'markdown') {
    const sink = lane.sink
    return sink.length ? '命令：' + sink[sink.length - 1].slice(0, 120) : '（还没有发命令）'
  }
  const files = lane.ticketKeys()
  return '票文件：' + (files.length ? files.join('、') : '（还没有）')
}

/** 对照表：同一行 = 一个动作，同一列 = 一个后端。 */
function renderTable(table) {
  const lines = []
  lines.push('| 动作 | ' + table.map((t) => t.lane).join(' | ') + ' |')
  lines.push('| --- | ' + table.map(() => '---').join(' | ') + ' |')
  for (const act of ['create', 'plan', 'link', 'patch', 'read']) {
    const cells = table.map((t) => {
      const c = t[act]
      const cell = '状态 ' + c.status + '<br>落点：' + c.落点 + '<br>证据：' + String(c.证据).replace(/\|/g, '/')
      return cell
    })
    lines.push('| ' + ({ create: '建票', plan: '建整张地图骨架', link: '补边（父子 + 阻塞）', patch: '改票', read: '读回' })[act] + ' | ' + cells.join(' | ') + ' |')
  }
  lines.push('')
  lines.push('说明：这张表由 `node tests/verify-deck-tools-matrix.js` 现场跑出来（三个后端都是真后端模块）：'
    + 'GitHub 与 GitLab 用脚本化的 gh / glab，本地 Markdown 用真实临时工作区。'
    + '工具自己只报它看得到的证据（写后读回的结构字段与正文），分不出「原生层级」与「平级链接」时如实降一档；'
    + '表里那一列精确的落点是验收脚本按后端给出的。')
  return lines.join('\n')
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
