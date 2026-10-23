// verify-784-effortId.ts —— #784 回归：八个带 effortId 的 deck 工具逐项核对
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-784-effortId.ts，可独立运行。
// 本文件是 CommonJS：产品源码靠 pathToFileURL + 动态 import 取，说明符原样（budget.js / tool-cost.js
// 是构建产物，旁边没有同名 .ts，钩子不会改指）；只加类型标注，判据一字不动。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)
// 夹具说「这个工作区选过了」的唯一办法（#1138 起）：给这个工作区一份工作区文件。
// 两种造法与判定出口桩的来历见 tests/lib/deck-decide-stub.js 文件头。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

function makeWS() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-784-7-'))
  for (const eff of ['alpha', 'beta']) {
    const dir = path.join(root, '.scratch', eff)
    fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'map.md'),
      '# 地图(' + eff + ')\n\nStatus: ready-for-agent\n\n## Destination\n\n' + eff + '\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
    fs.writeFileSync(path.join(dir, 'issues', '01-first.md'),
      '# ' + (eff === 'alpha' ? 'Alpha01' : 'Beta01') + '\n\nLabels: wayfinder:task\n\n## 进度\n\n' + eff + '\n', 'utf8')
  }
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
  return { root, rootPosix, ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(n) { return n === 'fs' ? plat.fs : undefined } }, cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} } }
}

async function main(): Promise<void> {
  console.log('#784 八工具验收（八个带 effortId 的工具，deck_context 不带 effortId 不在内）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const ws = makeWS()
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch' }
  // #1138 起「这个工作区选过了」只有一种造法：给这个工作区一份工作区文件，文件里写着选了谁。
  // 这里原来写的是 registry.bind(handle, 'markdown')，注册表的绑定口子已整段删掉（见
  // src/tracker/registry/core.ts 文件头），夹具跟着改用工作区文件表达同一件事。
  chooseWorkspace(ws.rootPosix, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const planStore = (() => { const t = new Map(); return { durable: true, load(id) { return t.get(String(id)) || null }, save(id, s) { t.set(String(id), s) } } })()
  // decideBackend：生产装配总是给（见 src/deck/registration/host-assemble.ts 的 decideBackend: decideBackendFn），
  //   壳拿不到它时一律回「判定出口这次没装上」。夹具照生产的接法给上判定出口桩，桩直接调生产判定出口
  //   读上面那份工作区文件（写用途只认文件里的记录，这正是 #1003 契约期望行为第 4 条）。
  const deps = { gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: ws.ctx, handleFor: () => handle, log: { fire: () => {} }, now: () => clock, planStore, decideBackend: makeDecideStub(registry) }
  const exec = { agent: { session: { id: 's-784-7', cwd: ws.rootPosix } } }

  const files = [
    ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
    ['src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot', 'deck_map_snapshot'],
    ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list'],
    ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
    ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create'],
    ['src/deck/tools/map-link.ts', 'createDeckMapLink', 'deck_map_link'],
    ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch'],
  ]
  const tools = {}
  let firstDesc = ''
  for (const [f, fac, name] of files) {
    const mod = await imp(f)
    tools[name] = mod[fac](deps)
    const p = tools[name].definition.parameters.properties.effortId
    check(!!p, name + ' 参数表有 effortId')
    check(p && p.type === 'string', name + ' effortId 是可选字符串（不在 required 里：' + JSON.stringify(tools[name].definition.parameters.required) + '）')
    check(!(tools[name].definition.parameters.required || []).includes('effortId'), name + ' effortId 不在必填里')
    if (!firstDesc) firstDesc = p.description
    check(p.description === firstDesc, name + ' 参数说明与第一份逐字一致')
  }
  // 与 report 逐字一致
  const repMod = await imp('src/deck/tools/issue-report.ts')
  const repDesc = repMod.definition.parameters.properties.effortId.description
  check(firstDesc === repDesc, '八个带 effortId 的工具的参数说明逐字一致（' + firstDesc + '）')

  // 读票
  const gA = await tools.deck_issue_get.run(exec, { key: '01', effortId: 'alpha' })
  const gB = await tools.deck_issue_get.run(exec, { key: '01', effortId: 'beta' })
  check(gA.status === 'ok' && String(gA.data.ticket.title).includes('Alpha'), '读票 alpha 落在 alpha')
  check(gB.status === 'ok' && String(gB.data.ticket.title).includes('Beta'), '读票 beta 落在 beta')
  // 不带与今天一致：读回落第一份
  const g0 = await tools.deck_issue_get.run(exec, { key: '01' })
  check(g0.status === 'ok' && String(g0.data.ticket.title).includes('Alpha'), '读票不带时回落第一份（与今天一致）')

  // 地图快照
  const sA = await tools.deck_map_snapshot.run(exec, { key: '00', effortId: 'alpha' })
  const sB = await tools.deck_map_snapshot.run(exec, { key: '00', effortId: 'beta' })
  check(sA.status === 'ok' && sA.data.children.length === 1 && String(sA.data.children[0].title).includes('Alpha'), '快照 alpha 只有 Alpha 的子票')
  check(sB.status === 'ok' && sB.data.children.length === 1 && String(sB.data.children[0].title).includes('Beta'), '快照 beta 只有 Beta 的子票')

  // 列表：带 alpha 只回 alpha 的行
  const lA = await tools.deck_issue_list.run(exec, { state: 'all', effortId: 'alpha' })
  check(lA.status === 'ok' && lA.data.issues.length >= 2 && lA.data.issues.every((t) => t.effortId === 'alpha'), '列表带 alpha 只回 alpha 的行（' + lA.data.returned + ' 行）')
  const l0 = await tools.deck_issue_list.run(exec, { state: 'all' })
  check(l0.status === 'ok' && l0.data.total >= 4, '列表不带时两份一起（' + l0.data.total + ' 行，与今天一致）')

  // 建票：带 beta 建到 beta
  const cB = await tools.deck_issue_create.run(exec, { title: 'Beta 新票', kind: 'issue', effortId: 'beta' })
  check(cB.status === 'ok' && cB.data.ticket.effortId === 'beta', '建票带 beta 落在 beta（key=' + (cB.data.ticket && cB.data.ticket.key) + '）')
  // 建票不带：在多 effort 下必须 conflict（与今天逐字一致，不许改成猜）
  const c0 = await tools.deck_issue_create.run(exec, { title: '不带 scope 的新票', kind: 'issue' })
  check(c0.ok === false, '建票不带时照旧失败（conflict，与今天一致）：' + String(c0.text).slice(0, 80))

  // 改票：带 beta 改 beta 的 01
  const pB = await tools.deck_issue_patch.run(exec, { key: '01', effortId: 'beta', comment: '784 七项验收' })
  check(pB.status === 'ok' && (pB.items || []).some((i) => i.step === 'comment' && i.status === 'ok'), '改票带 beta 落在 beta')

  // 补边：在 beta 内给新建的那张票加阻塞边（同 effort 内）
  const newKey = String(cB.data.ticket.key)
  const linkB = await tools.deck_map_link.run(exec, { key: newKey, effortId: 'beta', blockedBy: ['01'] })
  check(linkB.status === 'ok', '补边带 beta 落在 beta（' + linkB.status + '）')

  // 批量建图：带 alpha 建到 alpha
  const plan = await tools.deck_map_plan_create.run(exec, { title: 'Alpha 批量图', effortId: 'alpha', planId: 'plan-784-7-a', children: [{ key: 'b1', title: '批量子票一', kind: 'issue' }] })
  check(plan.status === 'ok' && plan.data.mapKey, '批量建图带 alpha 建成（map=' + (plan.data && plan.data.mapKey) + '）')
  const snapAfter = await tools.deck_map_snapshot.run(exec, { key: plan.data.mapKey, effortId: 'alpha' })
  check(snapAfter.status === 'ok', '批量建的图能在 alpha 里读回来')

  // 远端忽略：用探针远端验证带不带 effortId 行为一致（后端忽略它）
  const probe = { id: 'probe-remote', label: '探针远端', matches: async () => false, create: () => ({ id: 'probe-remote', async create(repo, input) { return { ok: true, data: { key: 'P1', title: input.title, state: 'open', body: '', labels: [], assignees: [], effortId: '' } } }, async get(repo, key) { return { ok: true, data: { key: String(key), title: 'P1', state: 'open', body: '', labels: [], assignees: [], parentKey: null, effortId: '' } } }, async list(repo) { return { ok: true, data: [] } } }) }
  const dp = registry.register(probe)
  chooseWorkspace(ws.rootPosix, 'probe-remote')   // 把工作区文件改写成选了探针远端（等同旧写法 registry.bind(handle, 'probe-remote')）
  const r1 = await tools.deck_issue_get.run(exec, { key: 'P1' })
  const r2 = await tools.deck_issue_get.run(exec, { key: 'P1', effortId: 'alpha' })
  check(r1.status === 'ok' && r2.status === 'ok' && r1.text === r2.text, '远端后端带不带 effortId 行为一致（忽略它）')
  dp.dispose()
  chooseWorkspace(ws.rootPosix, 'markdown')   // 改回本地 Markdown（旧写法 registry.bind(handle, 'markdown')）

  ws.cleanup()
  try { dispose.dispose() } catch (e) {}
  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('验收脚本异常：' + ((e && e.stack) || e)); process.exit(1) })
