const { createOutboundControl } = require('../src/refresh/rooms/host/outbound-control.ts')
// verify-deck-tools-matrix.ts —— 门禁：同一个动作在三种后端上分别落到哪里（#713 第六批）
// 用法：在插件根目录执行 node tests/verify-deck-tools-matrix.ts，可独立运行。
//
// 为什么要这一段：这九个工具坐在 tracker 契约之上，而三个后端表达关系的方式**不一样**：
//   GitHub：父子是它自己的原生 sub-issues 层级，阻塞是原生 dependencies 边；
//   GitLab：父子是票正文顶部的 `Part of #<地图>` 声明行（读回走契约的父子列），阻塞是原生 is_blocked_by 边
//     （上限；免费档或远端说没能力时才回退到重写正文里的 Blocked by 行）；
//   本地 Markdown：父子写在票文件顶的注释里（例如 <!-- parentKey: 01 -->，#971 起读回与列举都认它），阻塞写进票文件正文里的 Blocked by 那一行。
// 同一个工具调用在这三种地方会得到不同的结果。如果返回里不逐项说清落点，AI 会以为地图结构已经建好了
// （对抗式审查里点名的那条攻击）。所以这一段把「建票 / 建整张地图骨架 / 补边 / 改票 / 读回」
// 五个动作在三个后端上各跑一遍，把真实结果收成一张对照表（打印在标准输出、写入 .tmp/713-backend-matrix.md），
// 并逐条断言：
//   ① 每个格子都回三态之一，从不抛异常；
//   ② 每条边都带落点与非空证据（做不到的照后端原话写）；
//   ③ 每一次远端调用都有人放行：#1442 起准入搬进 Tracker 会话管线，每条命令都必须落在
//      「经管线放行、还没记账」的操作窗口里（测试自己用旧发送口包住的锚用例单列一类），两者之外偷发为 0；
//   ④ 带上锚：同一个锚两次只多一张票；不带锚两次仍建两张（既有行为不许被改坏）。
//
// 三个后端都是**真后端模块**：GitHub / GitLab 用脚本化的 gh / glab（按真实命令形状回 JSON，每条命令都是一条
// 真实出站请求，照生产里传输层的做法报给闸）；本地 Markdown 用真实临时工作区，票就是文件。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const { makeScriptedGh, makeScriptedGlab } = require('./deck-tools-matrix-transports.js')
// #1299 T8：双轨链路要核对「首行 /implement 能用」，模板正文的真源是提示词配置（与 verify-1281 同一条读取路径）。
const promptConfig = require('../scripts/lib/prompt-config.mts')
// 夹具口（写法见 tests/lib/deck-decide-stub.js 开头）：#1138 之后「用户选过哪个后端」只剩工作区文件一份记录，
// 注册表上那层绑定已经删了。下面用内存账本 chooseWorkspace 顶替工作区文件，用人选判定出口的夹具
// makeDecideStub 顶替生产出口，壳读到的就还是「这个工作区用户亲手选过哪个后端」。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

/** 表格里那一格：这个动作在这个后端上落到哪里（精确说法由本文件给出，工具自己只报它看到的证据）。 */
const PRECISE = {
  github: { parent: '原生层级（GitHub sub-issues）', block: '原生依赖边（GitHub dependencies）' },
  gitlab: { parent: '正文声明行（Part of #<地图>，读回走契约的父子列）', block: '原生依赖边（is_blocked_by；没能力时回退正文行）' },
  // #971 起本地 Markdown 的父子以文件顶注释为承载，读回走契约的父子列（与远端同一档），不再是做不到。
  markdown: { parent: '票文件注释（本地 Markdown 的 parentKey 注释，读回走契约的父子列）', block: '正文行（票文件里的 Blocked by）' },
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
    // #1299 T8：双轨链路要看落盘票面本身（文件名、文件头顺序、正文评论），所以把工作目录与读票口暴露出来。
    dir: dir,
    ticketFileOf: (key) => { try { return fs.readdirSync(path.join(dir, 'issues')).filter((f) => f.indexOf(String(key) + '-') === 0)[0] || '' } catch (e) { return '' } },
    readTicket: (name) => { try { return fs.readFileSync(path.join(dir, 'issues', name), 'utf8') } catch (e) { return '' } },
    // #1486：规格落成 <feature>/spec.md，实施票落 <feature>/issues/NN-*.md。双轨里给规格单独一个 feature 目录，
    // 避免与演示地图的 00 号（map.md）以及演示票的编号混在一起。
    specDir: path.join(root, '.scratch', 'spec-lane'),
    specFileOf: () => { try { return fs.existsSync(path.join(root, '.scratch', 'spec-lane', 'spec.md')) ? 'spec.md' : '' } catch (e) { return '' } },
    readSpec: () => { try { return fs.readFileSync(path.join(root, '.scratch', 'spec-lane', 'spec.md'), 'utf8') } catch (e) { return '' } },
    specTicketFileOf: (key) => { try { return fs.readdirSync(path.join(root, '.scratch', 'spec-lane', 'issues')).filter((f) => f.indexOf(String(key) + '-') === 0)[0] || '' } catch (e) { return '' } },
    readSpecTicket: (name) => { try { return fs.readFileSync(path.join(root, '.scratch', 'spec-lane', 'issues', name), 'utf8') } catch (e) { return '' } },
    cleanup: () => { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

function remoteLane(id, scripted, module, sink) {
  const bin = id === 'github' ? 'gh' : 'glab'
  const cwd = '/ws/' + id
  return {
    id: id, label: id === 'github' ? 'GitHub（原生 sub-issues / 原生依赖边）' : 'GitLab（父子是正文声明行，阻塞是原生边）',
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
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const githubModule = (await imp('src/tracker/rooms/github/index.ts')).githubModule
  const gitlabBackend = (await imp('src/tracker/rooms/gitlab/index.ts')).gitlabBackend
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  // #1299 T8：双轨链路要用的三处真源——客户端容器三态、行首动作、对象类型标记。
  const cv = await imp('src/client/kernel/container-view.ts')
  const sd = await imp('src/client/kernel/store-derived.ts')
  // 行级动作全家已从 store-derived.ts 抽到 row-actions.ts，动作断言改从新片取。
  const ra = await imp('src/client/kernel/row-actions.ts')
  const marker = await imp('src/shared/issue-file/src/marker.ts')
  // 选后端的判定出口（#1003 单出口）。生产装配总是把它递给工具（见 src/refresh/registry/deck-tool-bridge.ts
  //   的 `decideBackend: decideBackend || null`），壳拿不到它时会一律回「判定出口这次没装上」，
  //   所以夹具也必须照生产的接法给上。这里给的是**真人选出口的夹具**（makeDecideStub，见
  //   tests/lib/deck-decide-stub.js）：它把夹具的内存账本当工作区文件读，所以下面每个车道
  //   那次 chooseWorkspace(lane.handle.cwd, lane.id) 才会被读成「用户亲手选过这个工作区」，
  //   三个车道的写用途才会被放行（#1138 之后这份记录只剩工作区文件一份，注册表上那层绑定已删）。

  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  // #1446 起账本按后端分桶：先建出 github 这只后端，读数再按后端 id 落账。
  // 这里只建一只 —— 读缓存口不带后端时靠「账本里只有一只后端」认出它，与本段只关心
  // 「裁决看到真读数」这一点相符；多只后端时歧义归装配层（见 quotaPart 的 backendId 来源）。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  // 只计请求的后端（GitLab）只有 requests 一格：它也要有真读数，否则裁决看到的是「还没量出来」。
  ledger.ensureBackend('gitlab', { kind: 'requests-only' })
  ledger.syncServer('gitlab', { requests: { limit: 2000, remaining: 2000, reset: clock + 3600000 } }, clock)

  // #1442：工具不再自己过闸 —— 每次操作的准入搬进了 Tracker 会话管线（读缓存 → 裁决 → 转发 → 记账）。
  // 这一段把装配层配的那三件（src/refresh/registry/deck-tool-bridge.ts 的 buildTrackerPorts）
  // 原样接过来：裁决与记账都用装配层那一份，门禁不另抄口径。#1454 起记账口是真记账，
  // 不再用「调了 account 就算记了账」的自包计数器掩盖「账本里其实一分没有」；账本金额与桶在 ③ 段直接断言。
  const bridgeMod = await imp('src/refresh/registry/deck-tool-bridge.ts')
  // 注册表在下面才建出来（模块要一条条 register）：先留一格，注册完再按「账本 + 注册表」重建，
  // 这样读数口才认得出每个后端的预算口径（离网后端回「已知且不需要额度」，而不是「还没量出来」）。
  let trackerPorts = bridgeMod.buildTrackerPorts({ ledger: ledger })
  let pipelineWindows = 0        // 已放行、还没记账的操作窗口数（管线一次操作一个；只用于把出站归到管线）
  let admitCalls = 0
  let admitsWithKnownReading = 0
  const pipelineRefusals = []
  const admitPort = async (input) => {
    admitCalls += 1
    if (input && input.reading && input.reading.known === true) admitsWithKnownReading += 1
    const decision = await trackerPorts.admit(input)
    if (decision && decision.allowed === true) pipelineWindows += 1
    else pipelineRefusals.push(decision)
    return decision
  }
  // 记账口原样转发给装配层的真实现；这里只负责把管线窗口关上，不数「调用次数」——
  // 调用次数证明不了钱进了账本，账本金额由 ③ 段直接断言。
  const accountPort = async (input) => {
    pipelineWindows = Math.max(0, pipelineWindows - 1)
    await trackerPorts.account(input)
  }
  // 每条远端命令归一次档：A 管线窗口里（工具自身的流量）、B 旧发送口里（本段自己用 gate.send 包住的锚用例）、
  // C 两边都不在 —— C 就是「绕开了一切准入」的那一类，必须一条都没有。
  // #1482 起传输层按真实出站口径报：GraphQL 只算点数、不占 REST 请求条数。下面 REST 与点数分开数，
  // ③ 段既按「每条命令都归了档」查归因，也按两种口径分别与账本对账。
  let outboundInPipeline = 0
  let outboundInOldSend = 0
  let oldSendDepth = 0
  let outboundRest = 0        // 全部命令里按真实口径算的 REST 请求条数
  let outboundPoints = 0      // 全部命令里按真实口径算的 GraphQL 点数
  let oldSendRest = 0
  let oldSendPoints = 0
  let outsideRest = 0
  let outsidePoints = 0
  const outboundOutside = []
  // 管线窗口里按后端分开数：③ 段要拿它们与账本逐个桶对账（github 两桶、gitlab 只有 requests）。
  let pipelineGithub = 0
  let pipelineGitlab = 0
  let pipelineGithubGraphql = 0
  // #1482：这一条命令算不算 GraphQL，由本门禁按夹具里真出现的命令形状写死判断，不调用生产函数 ——
  // 生产判据哪天退化了，期望若跟着一起变，门禁就会把红判成绿（ADR 20261021 §2.5 第 2 条：门禁要能红能绿）。
  // 夹具里的 GraphQL 命令只有一种形状：gh api graphql ...。
  const isGraphqlLiteral = (args) => Array.isArray(args) && args[0] === 'api' && String(args[1] || '').indexOf('graphql') === 0
  const noteRemoteOutbound = (cmd, args) => {
    const isGql = cmd === 'gh' && isGraphqlLiteral(args)
    const rest = isGql ? 0 : 1
    const points = isGql ? 1 : 0
    if (pipelineWindows > 0) {
      outboundInPipeline += 1
      if (cmd === 'gh') { pipelineGithub += 1; if (isGql) pipelineGithubGraphql += 1 }
      if (cmd === 'glab') pipelineGitlab += 1
    } else if (oldSendDepth > 0) { outboundInOldSend += 1; oldSendRest += rest; oldSendPoints += points }
    else { outboundOutside.push(cmd + ' ' + String((args && args[0]) || '')); outsideRest += rest; outsidePoints += points }
    outboundRest += rest
    outboundPoints += points
    gate.noteOutbound({ requests: rest, points: points })
  }

  const ghSink = []
  const glSink = []
  const gh = makeScriptedGh(ghSink)
  const gl = makeScriptedGlab(glSink)
  // 假传输层：gh / glab 每执行一条命令就是一条真实出站请求，照生产里那一层的做法报给闸。
  // （git 只读远端地址那一条不算 HTTP 请求，所以不报。）
  const ghCtx = {
    cwd: '/ws/github',
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (n) => (n === 'gh' ? '/usr/local/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd, args) => { if (cmd === 'gh') noteRemoteOutbound(cmd, args); return gh.exec(cmd, args) },
    isEnabled: () => false, logEvent: () => {},
  }
  const glCtx = {
    cwd: '/ws/gitlab',
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async (n) => (n === 'glab' ? '/usr/local/bin/glab' : null), path: path.posix, env: { get: () => undefined } },
    exec: async (cmd, args) => { if (cmd === 'glab') noteRemoteOutbound(cmd, args); return gl.run(args) },
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
    // 这个车道的「用户亲手选过谁」写进夹具账本（等价于往工作区文件里写一行）。
    chooseWorkspace(lane.handle.cwd, lane.id)
  }
  trackerPorts = bridgeMod.buildTrackerPorts({ ledger: ledger, registry: registry })
  const byCwd = new Map(lanes.map((l) => [l.handle.cwd, l]))
  const laneOf = (id) => lanes.find((l) => l.id === id)

  let currentLane = null
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    handleFor: (s) => (byCwd.get(s.cwd) || {}).handle,
    // 三个车道的现场（platform / fs / exec）不同：壳每次调用时现取当前车道的那一份。
    backendCtx: () => (currentLane ? currentLane.backendCtx : {}),
    // #1442：会话管线要的三件由装配层给（外面裹了计数，见上面那段注释；不在这里另写裁决口径）。
    getCachedReading: trackerPorts.getCachedReading,
    admit: admitPort,
    account: accountPort,
    now: () => clock,
    log: { fire: () => {} },
    decideBackend: makeDecideStub(registry),
    planStore: (() => { const t = new Map(); return { durable: true, load(id) { return t.get(id) || null }, save(id, s) { t.set(id, s) } } })(),
    invalidate: () => {},
  }
  const tools = {}
  for (const [file, factory, name] of [
    ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
    ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
    ['src/deck/tools/map-link.ts', 'createDeckMapLink', 'deck_map_link'],
    ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
    ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
    ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list'],
    ['src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot', 'deck_map_snapshot'],
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
    const create = await run('deck_issue_create', { title: '矩阵第一张票', kind: 'issue' })
    rows.create = create
    const evCreate = laneEvidence(lane)
    // ② 建整张地图骨架
    // #1403 T3 起计划子票的 kind 必填，地图工单还要带 label；按目标口径写，等 T3 合入后由它校验。
    // 原文布局下一个目录只能有一份 map.md（issue-tracker-local.md:25-28）：markdown 车道的 .scratch/demo
    // 开头已经手写了一份 map.md 给快照段用，所以计划单独点名一个 effort 目录；远端车道忽略这个参数。
    const planScope = lane.id === 'markdown' ? { effort: 'plan-lane' } : {}
    const plan = await run('deck_map_plan_create', Object.assign({
      planId: 'mx-' + lane.id, title: '矩阵地图 ' + lane.id,
      children: [
        { key: 'c1', title: '子票一', kind: 'map-ticket', label: 'wayfinder:task' },
        { key: 'c2', title: '子票二', kind: 'map-ticket', label: 'wayfinder:task' },
      ],
      edges: [{ from: 'c2', to: 'c1', type: 'blocked-by' }],
    }, planScope))
    rows.plan = plan
    const evPlan = laneEvidence(lane)
    const mapKey = String((plan.data && plan.data.mapKey) || '00')
    // 建成的票号按计划顺序取（工具返回值里叫 builtKeys；planKey 在 items 里）
    const built = ((plan.items || []).filter((i) => i.role === 'child').map((i) => String(i.key))).filter(Boolean)
    const keys = built.length ? built : ((plan.data && plan.data.builtKeys) || []).map(String)
    const child1 = String(keys[0] || '')
    const child2 = String(keys[1] || '')
    // ③ 补边（父子 + 阻塞，一次调用两种边）
    rows.link = await run('deck_map_link', Object.assign({ key: child2, parentKey: mapKey, blockedBy: [child1] }, planScope))
    const evLink = laneEvidence(lane)
    // ④ 改票
    rows.patch = await run('deck_issue_patch', Object.assign({ key: child1, comment: '矩阵改票：一条评论', addLabels: ['wayfinder:research'], close: true }, planScope))
    const evPatch = laneEvidence(lane)
    // ⑤ 读回
    rows.read = await run('deck_issue_get', Object.assign({ key: child2 }, planScope))
    rows.snapshot = await run('deck_map_snapshot', Object.assign({ key: mapKey }, planScope))

    // 失败时把「为什么」一并带出来（#726 收口时的教训：门禁红得让人能一眼看出是哪一步、哪一句），
    // 否则只剩一个 unsupported，谁也猜不出是闸推迟、后端抛错还是没选中后端。
    check(envelopeOk(create) && create.ok === true, '[' + lane.id + '] 建票：回 ok（实得 ' + create.status + (create && create.ok ? '' : '；reason=' + String((create && create.reason) || '') + '；text=' + String((create && create.text) || '').slice(0, 160)) + '）')
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
    // #971 起三个后端补父边都走契约的父子列（本地看的是文件顶注释，不再是做不到）。
    const okParent = (parentEdge.landing.indexOf('契约的父子列') >= 0)
    check(okParent, '[' + lane.id + '] 父子边落点如实：' + parentEdge.landing + ' ｜ ' + PRECISE[lane.id].parent)
    // GitHub 与 GitLab 的阻塞都落在原生边上（GitLab 是 is_blocked_by），只有本地 Markdown 落在正文行。
    const okBlock = lane.id === 'markdown' ? (blockEdge.landing === '正文行') : (blockEdge.landing === '原生依赖边')
    check(okBlock, '[' + lane.id + '] 阻塞边落点如实：' + blockEdge.landing + ' ｜ ' + PRECISE[lane.id].block)

    // ⑥ 带上锚：同一个锚两次只多一张；不带锚两次仍建两张（既有行为不许被改坏）
    const tracker = registry.get(lane.id)
    const repo = lane.repo
    const opCtx = lane.backendCtx
    const before = laneCount(lane)
    const viaGate = (fn) => gate.send({ source: 'tool.call', kind: 'tool-batch', bucket: 'graphql', workspaceKey: 'ws-' + lane.id, plan: [{}] }, async () => {
      // 这四次是直接调后端模块的锚用例（不经工具、也就不经会话管线），所以照旧用旧发送口包住，
      // 让闸的账上仍然记到它们 —— 归为上面的 B 档，不算「绕开准入」。
      oldSendDepth += 1
      try { await fn() } finally { oldSendDepth -= 1 }
      return { requests: 0, points: 0 }
    })
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

  // ── ②½ 双轨链路：同一串动作在本地 Markdown 与 GitHub 上各跑一遍（#1299 T8） ──
  //
  // 这一段为什么是「两条链路」而不是「两张对照表」：上面那一段验的是「同一个工具在三个后端上落到哪里」，
  // 这里验的是「一条完整的拆票→实施→收口链路，在两个后端上是不是同一种玩法」。节点固定五个：
  //   A 建探索地图（父子 + 阻塞边）→ B /to-spec 建顶层规格 → C /to-tickets 建实施票 → D /implement 首行与三态按钮 → E /close-spec 收口。
  // 每个节点都留可重放证据（票号、落盘文件、命令），最后写进 .tmp/1299-dual-lane-evidence.md。
  {
    const SPEC_BODY = [
      '## 问题陈述',
      '双轨链路要把一张规格票从建到关完整走一遍：中间任何一步换了后端就换了玩法，都算没统一。',
      '## 解决方案',
      '本地 Markdown 与 GitHub 各跑一次同样的五个节点，逐个断言对象类型、父子边、阻塞边与关闭状态。',
      '## 用户故事',
      '- 作为维护者，我希望同一张规格票在两个后端上被认成同一种对象。',
      '## 实现决策',
      '- 规格票与实施票的对象类型写在票面标记里，父边靠近端自己的结构承载。',
      '## 测试决策',
      '- 这条链路本身就是门禁：两条都跑通、证据落盘，才算完成。',
      '## 不在范围内',
      '- 不在门禁里连真实 GitHub 仓库：远端用脚本化的 gh 按真实命令形状回包。',
      '## 补充说明',
      '- 证据写在 .tmp/1299-dual-lane-evidence.md，票号与文件路径都能照着重放。',
    ].join('\n\n')
    const TICKET_BODY = '## 要构建什么\n\n双轨链路里的一张实施票（#1299 T8）。\n\n## 验收判据\n\n父边落在规格票下面，标签只带 ready-for-agent。'
    const evidenceLines = []
    const dualLanes = []
    const promptData = promptConfig.readPromptConfig(ROOT)
    const implSpec = promptConfig.PROMPT_TEMPLATE_IDS.filter((x) => x.id === 'tpl.implement')[0]
    const implZh = String(promptData.templates[implSpec.family]['tpl.implement'].zh || '')
    for (const laneId of ['markdown', 'github']) {
      const lane = laneOf(laneId)
      currentLane = lane
      const exec = { agent: { session: { id: 's-' + lane.id + '-dual', cwd: lane.handle.cwd } } }
      const run = async (name, args) => {
        try { return await tools[name].run(exec, args) } catch (e) { return { ok: false, status: 'threw', reason: String((e && e.message) || e) } }
      }
      // 本地 Markdown 的规格与实施票单独落一个 feature 目录；远端没有这个参数（也不需要）。
      const specScope = lane.id === 'markdown' ? { feature: 'spec-lane' } : {}
      const ticketOf = (r) => (r && r.data && r.data.ticket) || {}
      const relOf = (r) => String((r && r.data && r.data.relations && r.data.relations.parentKey) || '')
      const edgeOf = (r, op) => edgesOfItems(r).filter((i) => i.op === op)[0] || null
      const labelNamesOf = (t) => {
        const list = Array.isArray(t && t.labels) ? t.labels : []
        return list.map((x) => (typeof x === 'string') ? x : String((x && x.name) || '')).map((s) => s.trim()).filter(Boolean)
      }
      const shortText = (r) => String((r && r.text) || '').replace(/\s+/g, ' ').slice(0, 200)
      const snapshotState = async (res) => {
        const stats = (res && res.data && res.data.stats) || null
        const st = cv.containerStateOf({ stats: stats })
        return { stats: stats, state: st, tri: cv.containerTriState('spec', st) }
      }
      try {
        // A：建探索地图（父子边 + 阻塞边）
        // 与上面表格里的计划再分开一个 effort 目录：同一个目录只能有一份 map.md，两张地图不能挤在一起。
        const planScope = lane.id === 'markdown' ? { effort: 'plan-lane-dual' } : {}
        const plan = await run('deck_map_plan_create', Object.assign({
          planId: 'dual-' + lane.id,
          title: '双轨链路地图 ' + lane.id,
          children: [
            { key: 'r1', title: '调研一', kind: 'map-ticket', label: 'wayfinder:research' },
            { key: 'r2', title: '调研二', kind: 'map-ticket', label: 'wayfinder:research' },
          ],
          edges: [{ from: 'r2', to: 'r1', type: 'blocked-by' }],
        }, planScope))
        const mapKey = String((plan && plan.data && plan.data.mapKey) || '')

        const planChildren = ((plan && plan.items) || []).filter((i) => i.role === 'child' && i.status === 'ok')
        const aBlock = edgeOf(plan, 'block')
        check(plan && plan.ok === true && mapKey !== '' && planChildren.length === 2,
          '[' + lane.id + '] 双轨 A 建探索地图：回 ok，地图票 ' + mapKey + '，子票 ' + planChildren.map((i) => i.key).join('、') + '（' + shortText(plan) + '）')
        // 父子边这一档要单独读回：plan_plan_create 建子票时父边是随建票一起落的（不是单独一次挂边动作），
        // 所以它的证据不在 items 的 edge 行里，而在每张子票写后读回的 parentKey 上。
        const aChildKeys = planChildren.map((i) => String(i.key))
        const aChildGets = []
        for (const aChildKey of aChildKeys) aChildGets.push(await run('deck_issue_get', Object.assign({ key: aChildKey }, planScope)))
        const aParentOk = aChildKeys.length === 2 && aChildGets.length === 2 && aChildGets.every((g) => !!g && g.ok === true && relOf(g) === mapKey)
        check(aParentOk,
          '[' + lane.id + '] 双轨 A 父子边留落点与证据（写后读回契约父子列）：' + aChildKeys.map((k, idx) => '票 ' + k + ' 父=' + (aChildGets[idx] ? relOf(aChildGets[idx]) : '（没读回）')).join('；'))
        check(!!aBlock && aBlock.status === 'ok' && !!aBlock.landing && !!aBlock.evidence,
          '[' + lane.id + '] 双轨 A 阻塞边留落点与证据：' + (aBlock ? aBlock.landing + ' ｜ ' + aBlock.evidence : '（没有这条边）'))
        evidenceLines.push('- [' + lane.id + '] A 探索地图：票 ' + mapKey + '；父子边 契约父子列（' + aChildKeys.map((k) => k + '→' + mapKey).join('、') + '）；阻塞边 ' + (aBlock && aBlock.landing) + '；现场：' + laneEvidence(lane))

        // B：/to-spec 建规格票。规格从 #1403 起与探索地图同级、是顶层容器，不挂到地图下。
        const createSpec = await run('deck_issue_create', Object.assign({ title: '双轨规格票 ' + lane.id, kind: 'spec', body: SPEC_BODY }, specScope))
        const specKey = String((createSpec && createSpec.data && createSpec.data.ticket && createSpec.data.ticket.key) || '')
        const bParent = edgeOf(createSpec, 'parent')
        const specGet = await run('deck_issue_get', Object.assign({ key: specKey }, specScope))
        const specBrief = ticketOf(specGet)
        // T1 读侧统一后，两条车道的契约类型都归一成 spec；这里只认 type，不再靠标记兜底。
        const specJudge = String(specBrief.type || '') === 'spec'
        // #1403：规格是顶层容器，读回来不该带父票。本地 markdown 房目前对「文件头没有父注释的普通票」
        // 仍回落 #971 的老默认值 00（parse.ts 的 parentKey 缺省），所以 markdown 车道这两条会红到读侧
        // 把 spec 的缺省父票改成 null 为止；这是 T1 读侧的范围，T4b 只把门禁按新口径钉住，不掩盖。
        const specRel = relOf(specGet)
        check(createSpec && createSpec.ok === true && specKey !== '' && !bParent,
          '[' + lane.id + '] 双轨 B 建规格票：票 ' + specKey + '，规格是顶层容器、没有父边' + (bParent ? '（实得 ' + bParent.status + ' / ' + bParent.landing + '）' : ''))
        check(!!specGet && specGet.ok === true && specJudge && specRel === '',
          '[' + lane.id + '] 双轨 B 规格票可识别且是顶层（无父票）：type=' + String(specBrief.type) + '，父票=' + JSON.stringify(specRel))
        if (lane.id === 'markdown') {
          const specFile = lane.specFileOf()
          const specText = lane.readSpec()
          const lines = specText.split('\n')
          check(specFile === 'spec.md' && specText.indexOf('双轨规格票') >= 0 && specText.indexOf('untitled') < 0,
            '[' + lane.id + '] 双轨 B 规格票落成 spec.md、标题在正文里：' + specFile)
          check((lines[0] || '') === '<!-- DSH-FORMAT: md-v1 -->' && /^<!-- DSH-STATUS: /.test(lines[1] || '') && lines.slice(0, 8).some((l) => /^<!-- DSH-IDEMPOTENCY-KEY: /.test(l)) && lines.slice(0, 10).every((l) => !/^<!--\s*(?:parentKey|DSH-PARENT):/.test(l)),
            '[' + lane.id + '] 双轨 B 规格票文件头是隐藏注释（格式 → 状态 → 标签 → 锚）、无父注释：' + JSON.stringify(lines.slice(0, 6)))
          check(specText.indexOf('Type: spec') < 0 && specText.indexOf('DSH-ISSUE-KIND') < 0,
            '[' + lane.id + '] 双轨 B 规格票不再写 Type: spec 与旧类型标记')
        } else {
          check(marker.markerKindInHeader(specBrief.body) === 'spec' && String(specBrief.type || '') === 'spec',
            '[' + lane.id + '] 双轨 B 规格票正文第一段带对象类型标记、契约类型也归一成 spec：type=' + String(specBrief.type) + '，' + JSON.stringify(String(specBrief.body || '').split('\n').slice(0, 2)))
        }
        const emptySnap = await run('deck_map_snapshot', Object.assign({ key: specKey }, specScope))
        const emptyState = await snapshotState(emptySnap)
        check(!!emptySnap && emptySnap.ok === true && emptyState.state === 'empty' && emptyState.tri.labelKey === 'act.split' && emptyState.tri.color === '#f59e0b',
          '[' + lane.id + '] 双轨 B 三态按钮空态：还没实施票 → 「拆票」橙色（' + emptyState.state + ' / ' + emptyState.tri.labelKey + ' / ' + emptyState.tri.color + '）')
        evidenceLines.push('- [' + lane.id + '] B 规格票：票 ' + specKey + (lane.id === 'markdown' ? '；文件 ' + lane.specFileOf() : '；落点 顶层容器（无父票）'))

        // C：/to-tickets 建两张实施票（挂规格下，不传 labels，工具默认只给 ready-for-agent）
        const createT1 = await run('deck_issue_create', Object.assign({ title: '实施票一 ' + lane.id, kind: 'spec-ticket', parentKey: specKey, body: TICKET_BODY }, specScope))
        const createT2 = await run('deck_issue_create', Object.assign({ title: '实施票二 ' + lane.id, kind: 'spec-ticket', parentKey: specKey, body: TICKET_BODY }, specScope))
        const t1Key = String((createT1 && createT1.data && createT1.data.ticket && createT1.data.ticket.key) || '')
        const t2Key = String((createT2 && createT2.data && createT2.data.ticket && createT2.data.ticket.key) || '')
        const t1Get = await run('deck_issue_get', Object.assign({ key: t1Key }, specScope))
        const t1Brief = ticketOf(t1Get)
        const t1Labels = labelNamesOf(t1Brief)
        const t1Rel = relOf(t1Get)
        const t2Get = await run('deck_issue_get', Object.assign({ key: t2Key }, specScope))
        const t2Rel = relOf(t2Get)
        check(createT1 && createT1.ok === true && createT2 && createT2.ok === true && t1Key !== '' && t2Key !== '' && !!edgeOf(createT1, 'parent') && edgeOf(createT1, 'parent').status === 'ok',
          '[' + lane.id + '] 双轨 C 建两张实施票：' + t1Key + '、' + t2Key + '；父边落点 ' + (edgeOf(createT1, 'parent') && edgeOf(createT1, 'parent').landing))
        // #1486+#1487 之后，原文布局里规格容器（.scratch/<feature>/spec.md）与探索地图（.scratch/<effort>/map.md）
        // 分处不同目录、票号都从 00 起，所以 specKey 与 mapKey 常常都是 '00'：按裸票号比较必然相等，
        // 旧写法「t1Rel !== mapKey」因此恒假，但它原本要证的「挂在规格下、不是挂在探索地图下」仍然要证。
        // 改成把父票在规格目录（specScope）里读回来认类型：读到 type 必须是 spec；读不到 type 但能在
        // specScope 里寻址成功，也说明父票落在规格目录里，不是地图目录。
        const cParentGet = t1Rel ? await run('deck_issue_get', Object.assign({ key: t1Rel }, specScope)) : null
        const cParentType = String(ticketOf(cParentGet).type || '')
        const cParentInSpec = !!cParentGet && cParentGet.ok === true && (cParentType === '' || cParentType === 'spec')
        check(t1Rel === specKey && t2Rel === specKey && cParentInSpec,
          '[' + lane.id + '] 双轨 C 实施票挂在规格票下（不是探索地图）：票 ' + t1Key + ' 父=' + t1Rel + '，票 ' + t2Key + ' 父=' + t2Rel + '；父票在规格目录读回 type=' + (cParentType || '（未给类型）'))
        check(t1Labels.length === 1 && t1Labels[0] === 'ready-for-agent',
          '[' + lane.id + '] 双轨 C 实施票标签集合恰为 {ready-for-agent}：' + JSON.stringify(t1Labels))
        check(Number(t2Key) === Number(t1Key) + 1 && Number(t1Key) > 0,
          '[' + lane.id + '] 双轨 C 实施票编号在 effort 内连续（规格 ' + specKey + '，实施 ' + t1Key + '、' + t2Key + '）')
        const link = await run('deck_map_link', Object.assign({ key: t2Key, blockedBy: [t1Key] }, specScope))
        const cBlock = edgeOf(link, 'block')
        check(!!link && link.ok === true && !!cBlock && cBlock.status === 'ok' && !!cBlock.landing && !!cBlock.evidence,
          '[' + lane.id + '] 双轨 C 实施票之间补阻塞边：' + (cBlock ? cBlock.landing + ' ｜ ' + cBlock.evidence : '（没回）'))
        if (lane.id === 'markdown') {
          const t1File = lane.specTicketFileOf(t1Key)
          const t1Text = lane.readSpecTicket(t1File)
          const t1Lines = t1Text.split('\n')
          check(t1File.indexOf('实施票一') >= 0 && t1Text.indexOf('wayfinder:') < 0 && /^<!-- DSH-LABELS: .*ready-for-agent -->$/m.test(t1Text) && t1Text.indexOf('<!-- DSH-PARENT: ' + specKey + ' -->') >= 0,
            '[' + lane.id + '] 双轨 C 实施票文件：' + t1File + '；标签只留 ready-for-agent、隐藏注释指规格票')
          check(t1Lines.slice(0, 6).every((l) => l.indexOf('DSH-ISSUE-KIND') < 0) && t1Text.indexOf('Labels: ready-for-agent') < 0,
            '[' + lane.id + '] 双轨 C 实施票不再写旧类型标记与可见 Labels 行：' + JSON.stringify(t1Lines.slice(0, 4)))
        }
        const openSnap = await run('deck_map_snapshot', Object.assign({ key: specKey }, specScope))
        const openState = await snapshotState(openSnap)
        check(!!openSnap && openSnap.ok === true && openState.stats && openState.stats.total === 2 && openState.stats.closed === 0 && openState.state === 'open' && openState.tri.labelKey === 'act.execute' && openState.tri.color === '#1D4ED8',
          '[' + lane.id + '] 双轨 C 三态按钮执行态：两张实施票都没关 → 「执行」规格蓝（' + openState.state + ' / ' + openState.tri.labelKey + ' / ' + openState.tri.color + '）')
        evidenceLines.push('- [' + lane.id + '] C 实施票：' + t1Key + '、' + t2Key + '（父 ' + specKey + '；阻塞 ' + t2Key + ' 被 ' + t1Key + ' 挡住）')

        // D：/implement 首行与三态按钮写回口径
        check(ra.rowActionKind({ labels: t1Labels }) === 'implement',
          '[' + lane.id + '] 双轨 D 实施票首行动作是 /implement：' + String(ra.rowActionKind({ labels: t1Labels })))
        check(implZh.indexOf('/implement\n{url}') === 0,
          '[' + lane.id + '] 双轨 D /implement 模板首行可用（模板 tpl.implement 以 /implement 开头）')
        const emptyTri = cv.containerTriState('spec', 'empty')
        const openTri = cv.containerTriState('spec', 'open')
        const doneTri = cv.containerTriState('spec', 'done')
        check(emptyTri.labelKey === 'act.split' && emptyTri.color === '#f59e0b' && openTri.labelKey === 'act.execute' && openTri.color === '#1D4ED8' && doneTri.labelKey === 'act.done' && doneTri.color === '#3fb950',
          '[' + lane.id + '] 双轨 D 三态按钮（拆票橙 / 执行规格蓝 / 完成绿）与写回状态读回一致')
        evidenceLines.push('- [' + lane.id + '] D /implement：实施票 ' + t1Key + ' 的行首动作判定为 implement，模板首行 /implement；三态按钮 拆票橙/执行蓝/完成绿')

        // E：/close-spec 收口（实施票未全关 → 失败并点名；全关但没评论 → 失败；带评论 → 关成功）
        const earlyClose = await run('deck_issue_patch', Object.assign({ key: specKey, comment: '收口核对：先试一次，此时还有实施票没关。', close: true }, specScope))
        const earlyRule = String((earlyClose && earlyClose.data && earlyClose.data.rule) || '')
        const earlyText = String((earlyClose && earlyClose.text) || '')
        check(!!earlyClose && earlyClose.status === 'unsupported' && earlyRule === 'spec-close-children-open' && earlyText.indexOf(t1Key) >= 0 && earlyText.indexOf(t2Key) >= 0,
          '[' + lane.id + '] 双轨 E 实施票没全关时关规格必须失败并点名缺哪几张：rule=' + earlyRule + '；回执=' + earlyText.slice(0, 160))
        const closeT1 = await run('deck_issue_patch', Object.assign({ key: t1Key, close: true }, specScope))
        const midSnap = await snapshotState(await run('deck_map_snapshot', Object.assign({ key: specKey }, specScope)))
        check(!!closeT1 && closeT1.ok === true && midSnap.state === 'open' && midSnap.stats && midSnap.stats.closed === 1,
          '[' + lane.id + '] 双轨 E 先关一张实施票：票 ' + t1Key + ' 已关，规格仍执行态（closed=' + String(midSnap.stats && midSnap.stats.closed) + '）')
        const closeT2 = await run('deck_issue_patch', Object.assign({ key: t2Key, close: true }, specScope))
        const doneSnap = await snapshotState(await run('deck_map_snapshot', Object.assign({ key: specKey }, specScope)))
        check(!!closeT2 && closeT2.ok === true && doneSnap.state === 'done' && doneSnap.tri.labelKey === 'act.done' && doneSnap.tri.color === '#3fb950',
          '[' + lane.id + '] 双轨 E 实施票全关后规格变完成态：' + doneSnap.state + ' / ' + doneSnap.tri.labelKey + ' / ' + doneSnap.tri.color + '）')
        const noCommentClose = await run('deck_issue_patch', Object.assign({ key: specKey, close: true }, specScope))
        const noCommentRule = String((noCommentClose && noCommentClose.data && noCommentClose.data.rule) || '')
        check(!!noCommentClose && noCommentClose.status === 'unsupported' && noCommentRule === 'spec-close-no-comment',
          '[' + lane.id + '] 双轨 E 没有收口核对评论时关规格失败：rule=' + noCommentRule)
        const finalClose = await run('deck_issue_patch', Object.assign({ key: specKey, comment: '收口核对：实施票一、实施票二逐张核对通过，规格关闭。', close: true }, specScope))
        const finalState = String((finalClose && finalClose.data && finalClose.data.ticket && finalClose.data.ticket.state) || '')
        check(!!finalClose && finalClose.ok === true && finalState === 'closed',
          '[' + lane.id + '] 双轨 E 带核对评论后规格完成态自动关闭：' + finalState + '（' + shortText(finalClose) + '）')
        if (lane.id === 'markdown') {
          const specText = lane.readSpec()
          check(/^<!-- DSH-STATUS: (?:closed|resolved) -->$/m.test(specText) && specText.indexOf('收口核对') >= 0,
            '[' + lane.id + '] 双轨 E 规格票隐藏状态已关闭且留着核对评论')
        } else {
          const ghSpec = (lane.scripted.tickets || []).filter((t) => String(t.number) === specKey)[0] || null
          check(!!ghSpec && ghSpec.state === 'closed' && JSON.stringify(ghSpec.comments || []).indexOf('收口核对') >= 0,
            '[' + lane.id + '] 双轨 E GitHub 上规格票真的关了，核对评论也在票上')
        }
        const reopen = await run('deck_issue_patch', Object.assign({ key: specKey, close: false }, specScope))
        const reopenRule = String((reopen && reopen.data && reopen.data.rule) || '')
        const reopenText = String((reopen && reopen.text) || '')
        const afterReopenGet = await run('deck_issue_get', Object.assign({ key: specKey }, specScope))
        const afterReopen = String((afterReopenGet && afterReopenGet.data && afterReopenGet.data.ticket && afterReopenGet.data.ticket.state) || '')
        check(!!reopen && reopen.status === 'unsupported' && reopenText.indexOf('重开') >= 0 && afterReopen === 'closed',
          '[' + lane.id + '] 双轨 E 重开动作不在 AI 工具面上：被拒且票仍是关闭态（rule=' + reopenRule + '）')
        evidenceLines.push('- [' + lane.id + '] E 收口：未全关时 rule=' + earlyRule + '；缺评论时 rule=' + noCommentRule + '；带核对评论后 ' + specKey + ' 关闭；重开被拒（票仍 ' + afterReopen + '）')
        dualLanes.push(lane.id)
      } catch (e) {
        check(false, '[' + lane.id + '] 双轨链路中途抛错：' + String((e && e.message) || e))
      }
    }
    check(dualLanes.length === 2, '双轨链路：本地 Markdown 与 GitHub 各跑通一次（' + dualLanes.join('、') + '）')
    try {
      fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true })
      const evidenceText = ['# 双轨链路证据（#1299 T8）', '', '五节点：A 建探索地图 → B /to-spec → C /to-tickets → D /implement → E /close-spec。', '', evidenceLines.join('\n'), ''].join('\n')
      fs.writeFileSync(path.join(ROOT, '.tmp', '1299-dual-lane-evidence.md'), evidenceText, 'utf8')
      check(true, '双轨链路证据写进 .tmp/1299-dual-lane-evidence.md')
    } catch (e) { check(false, '双轨链路证据写盘失败：' + String((e && e.message) || e)) }
  }

  // ── ③ 每一次远端调用都有人放行 ──
  //
  // #1442 起口径变了：工具**不再**自己过闸（旧壳里那一段 gate.send 已从工具调用路径上退休），
  // 每次操作的准入搬进了 Tracker 会话管线（pipeline.admit → 房间 → pipeline.account）。
  // 因此旧判据「闸记的 == 传输层真发的、绕开条数 0」对工具流量结构性不成立：闸的 accounted 只在
  // 旧发送口里记，工具流量一律落在 escaped 里。#1454 已落实「账本只由操作管线的 account 一处记」，
  // 所以这里除了归因，还要直接查账本：真发出去的每一条 gh/glab 命令，都按后端口径落到了该落的桶，
  // 金额一分不多一分不少；旧发送口包住的锚用例是直接调后端模块、不经管线，账本上一分都不该有。
  // 口径仍是「**每一条远端命令发出去的时候，都正处在一次经管线放行、还没记账的操作里**」；
  // 只有测试自己故意用旧发送口包住的锚用例单列一类；两类之外一条都没有。
  {
    const stats = gate.stats()
    const esc = gate.escaped()
    // 管线窗口里真发的 REST 条数：GraphQL 已按 #1482 的口径从条数里剔除。
    const pipelineRest = outboundInPipeline - pipelineGithubGraphql
    check(stats.transport.requests > 0 && stats.transport.requests === outboundRest,
      '传输层按真实口径报 REST 请求条数（' + stats.transport.requests + ' 条 = 管线 ' + pipelineRest + ' + 旧发送口 ' + oldSendRest + ' + 两者之外 ' + outsideRest + '）：GraphQL 不算 REST 请求')
    check(stats.transport.points === outboundPoints,
      '传输层按真实口径报 GraphQL 点数（' + stats.transport.points + ' 点 = 管线 ' + pipelineGithubGraphql + ' + 旧发送口 ' + oldSendPoints + ' + 两者之外 ' + outsidePoints + '）：先报闸按 1 点估，夹具回包没带 cost，所以不补差')
    check(outboundOutside.length === 0,
      '两个远端车道发出去的每一条命令，都落在某次经管线放行、还没记账的操作里（' + outboundInPipeline + ' 条），或测试自己用旧发送口包住的锚用例里（' + outboundInOldSend + ' 条）；两者之外偷发的 0 条'
        + (outboundOutside.length ? '（偷发样例：' + outboundOutside.slice(0, 3).join(' ｜ ') + '）' : ''))
    check(outboundInPipeline > 0, '工具自身的流量真的从会话管线走（' + outboundInPipeline + ' 条），所以上面那条不是空过')
    check(admitCalls > 0 && pipelineRefusals.length === 0 && pipelineWindows === 0,
      '管线给每一次操作都裁决并记账：' + admitCalls + ' 次裁决，拒绝 ' + pipelineRefusals.length + ' 次，收尾时残留窗口 ' + pipelineWindows + ' 个（记账是不是真进了账本，下面按金额查）')
    check(admitCalls === admitsWithKnownReading,
      '裁决看到的是账本里的真读数（' + admitsWithKnownReading + '/' + admitCalls + ' 次 known:true），不是「还没量出来」那一份')
    check(stats.accounted.requests > 0 && stats.accounted.requests === oldSendRest && stats.accounted.points === oldSendPoints,
      '闸账上那 ' + stats.accounted.requests + ' 条 REST 请求 / ' + stats.accounted.points + ' 点全部来自旧发送口包住的锚用例（' + oldSendRest + ' 条 / ' + oldSendPoints + ' 点）：工具流量不再经过那个口，所以闸记的少于真发是设计，不是漏记')
    check(esc.requests === stats.transport.requests - stats.accounted.requests && esc.requests === pipelineRest,
      '逃逸读数 = 真发 − 账上（' + esc.requests + ' = ' + stats.transport.requests + ' − ' + stats.accounted.requests + '），正好等于走管线的工具流量（' + pipelineRest + ' 条 REST）：逐条可对数，不是一笔糊涂账')
    check(esc.points === stats.transport.points - stats.accounted.points && esc.points === pipelineGithubGraphql,
      '逃逸点数同样对得上（' + esc.points + ' 点 = 走管线的 GraphQL ' + pipelineGithubGraphql + ' 条）：两桶口径下点数不多不少')
    check(gate.stats().byCategory['ai-tool'] > 0, '旧发送口那几笔仍然记在「AI 工具」那一档（' + gate.stats().byCategory['ai-tool'] + ' 笔）')

    // 账本对账（#1454 + #1482）：真实用量只有操作管线的 account 一条写入口；GraphQL 只进点数桶，不再被记成 REST。
    const snap = ledger.snapshot()
    check(snap.total.requests === pipelineRest,
      '账本总量 == 管线里真发出去的 REST 请求条数（账本 ' + snap.total.requests + ' 条，管线窗口 ' + pipelineRest + ' 条）：每一条都记了、没有一条记两遍；GraphQL 不再被记成 REST')
    check(snap.total.points === pipelineGithubGraphql,
      '账本总点数 == 管线里真发出去的 GitHub GraphQL 命令数（账本 ' + snap.total.points + ' 点，命令行 ' + pipelineGithubGraphql + ' 条）：两桶口径没把点数算进别的桶')
    check(ledger.hourOf('ai-tool', 'github').requests === pipelineGithub - pipelineGithubGraphql && ledger.hourOf('ai-tool', 'github').points === pipelineGithubGraphql,
      'GitHub 记在 ai-tool 档：' + ledger.hourOf('ai-tool', 'github').requests + ' 条 REST 请求 / ' + ledger.hourOf('ai-tool', 'github').points + ' 点（真发 ' + pipelineGithub + ' 条，其中 GraphQL ' + pipelineGithubGraphql + ' 条）')
    check(ledger.hourOf('ai-tool', 'gitlab').requests === pipelineGitlab && ledger.hourOf('ai-tool', 'gitlab').points === 0,
      'GitLab 记在 ai-tool 档的 requests 桶：' + ledger.hourOf('ai-tool', 'gitlab').requests + ' 条请求 / ' + ledger.hourOf('ai-tool', 'gitlab').points + ' 点（真发 ' + pipelineGitlab + ' 条，只计请求的后端不记点）')
    check(ledger.snapshot().byAccount['plugin'].hour.requests === 0,
      '没有一笔用量被记到 plugin 档（deck 工具这条路只记 ai-tool；实得 ' + ledger.snapshot().byAccount['plugin'].hour.requests + ' 条）')
    const bucketKeys = Object.keys(snap.buckets).sort().join(',')
    check(bucketKeys === 'github/graphql,github/rest,gitlab/requests',
      '账本的桶与后端口径一致：GitHub 两个桶、GitLab 只有 requests（实得 ' + bucketKeys + '）')
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
  lines.push('说明：这张表由 `node tests/verify-deck-tools-matrix.ts` 现场跑出来（三个后端都是真后端模块）：'
    + 'GitHub 与 GitLab 用脚本化的 gh / glab，本地 Markdown 用真实临时工作区。'
    + '工具自己只报它看得到的证据（写后读回的结构字段与正文），分不出「原生层级」与「平级链接」时如实降一档；'
    + '表里那一列精确的落点是验收脚本按后端给出的。')
  return lines.join('\n')
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
