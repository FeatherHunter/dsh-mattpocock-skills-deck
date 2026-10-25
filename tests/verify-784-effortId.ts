// verify-784-effortId.ts —— #784 回归（#1480 T2 改写）：八个 deck 工具的 effort / feature 参数逐项核对
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-784-effortId.ts，可独立运行。
// 本文件是 CommonJS：产品源码靠 pathToFileURL + 动态 import 取，说明符原样（budget.js / tool-cost.js
// 是构建产物，旁边没有同名 .ts，钩子不会改指）；只加类型标注，判据按 #1480 T2 的口径更新。
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-784-8-'))
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
  console.log('#784 八工具验收（#1480 T2：effort / feature 两个本地后端参数；deck_context 不带）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
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
  chooseWorkspace(ws.rootPosix, 'markdown')
  // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const planStore = (() => { const t = new Map(); return { durable: true, load(id) { return t.get(String(id)) || null }, save(id, s) { t.set(String(id), s) } } })()
  const deps = { gate, registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, backendCtx: ws.ctx, handleFor: () => handle, log: { fire: () => {} }, now: () => clock, planStore, decideBackend: makeDecideStub(registry) }
  const exec = { agent: { session: { id: 's-784-8', cwd: ws.rootPosix } } }

  // ① 参数表：八个工具都有 effort 与 feature，都是可选字符串；deck_context 一个都不带。
  const files = [
    ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get', 'locate'],
    ['src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot', 'deck_map_snapshot', 'locate'],
    ['src/deck/tools/issue-list.ts', 'createDeckIssueList', 'deck_issue_list', 'locate'],
    ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create', 'create'],
    ['src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate', 'deck_map_plan_create', 'create'],
    ['src/deck/tools/map-link.ts', 'createDeckMapLink', 'deck_map_link', 'locate'],
    ['src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', 'deck_issue_patch', 'locate'],
  ]
  const tools = {}
  const descs = { locate: { effort: '', feature: '' }, create: { effort: '', feature: '' } }
  for (const [f, fac, name, mode] of files) {
    const mod = await imp(f)
    tools[name] = mod[fac](deps)
    const props = tools[name].definition.parameters.properties
    const required = tools[name].definition.parameters.required || []
    check(!!props.effort && props.effort.type === 'string', name + ' 参数表有 effort（可选字符串）')
    check(!!props.feature && props.feature.type === 'string', name + ' 参数表有 feature（可选字符串）')
    check(!required.includes('effort') && !required.includes('feature'), name + ' effort 与 feature 都不在必填里')
    if (!descs[mode].effort) descs[mode].effort = props.effort.description
    if (!descs[mode].feature) descs[mode].feature = props.feature.description
    check(props.effort.description === descs[mode].effort, name + ' effort 说明与本类第一份逐字一致')
    check(props.feature.description === descs[mode].feature, name + ' feature 说明与本类第一份逐字一致')
  }
  // 报告工具直接导出 definition（不经工厂），单独核一遍，它与读类同一套说明。
  const repMod = await imp('src/deck/tools/issue-report.ts')
  const repProps = repMod.definition.parameters.properties
  check(!!repProps.effort && !!repProps.feature, 'deck_issue_report 参数表有 effort 与 feature')
  check(repProps.effort.description === descs.locate.effort && repProps.feature.description === descs.locate.feature, 'deck_issue_report 的说明与读类工具逐字一致')
  // 两类说明必须各说各的场景，不能混成一句。
  check(descs.locate.effort !== descs.create.effort, '读类与建类的 effort 说明不是同一句（读=全仓库找，建=按父票或标题决定目录）')
  check(descs.locate.effort.includes('<effort>') && descs.locate.feature.includes('<feature-slug>'), '说明里点名原文占位符 <effort> / <feature-slug>')
  // 上下文工具不该长这两个参数。
  const ctxMod = await imp('src/deck/tools/context.ts')
  const ctxProps = ctxMod.createDeckContext(deps).definition.parameters.properties
  check(!ctxProps.effort && !ctxProps.feature, 'deck_context 不带 effort / feature')

  // ② 行为：两个参数都落到同一个 repo.effortId，按目录定位。
  // 读票
  const gA = await tools.deck_issue_get.run(exec, { key: '01', feature: 'alpha' })
  const gB = await tools.deck_issue_get.run(exec, { key: '01', effort: 'beta' })
  check(gA.status === 'ok' && String(gA.data.ticket.title).includes('Alpha'), 'feature=alpha 读票落在 alpha')
  check(gB.status === 'ok' && String(gB.data.ticket.title).includes('Beta'), 'effort=beta 读票落在 beta')
  const g0 = await tools.deck_issue_get.run(exec, { key: '01' })
  check(g0.status === 'ok' && String(g0.data.ticket.title).includes('Alpha'), '读票不带时回落第一份（与今天一致）')
  // 互斥与非法目录名：都在落盘前拒绝。
  const both = await tools.deck_issue_get.run(exec, { key: '01', feature: 'alpha', effort: 'alpha' })
  check(both.ok === false && String(both.text || both.message || '').includes('只能填一个'), '两个参数同时给 → bad-args（只填一个）')
  const bad = await tools.deck_issue_get.run(exec, { key: '01', feature: '../escape' })
  check(bad.ok === false && String(bad.text || bad.message || '').includes('目录名'), '非法目录名 → bad-args（拒绝 ..）')

  // 地图快照
  const sA = await tools.deck_map_snapshot.run(exec, { key: '00', effort: 'alpha' })
  const sB = await tools.deck_map_snapshot.run(exec, { key: '00', feature: 'beta' })
  check(sA.status === 'ok' && sA.data.children.length === 1 && String(sA.data.children[0].title).includes('Alpha'), '快照 effort=alpha 只有 Alpha 的子票')
  check(sB.status === 'ok' && sB.data.children.length === 1 && String(sB.data.children[0].title).includes('Beta'), '快照 feature=beta 只有 Beta 的子票（实得 ' + JSON.stringify((sB.data && sB.data.children || []).map((c: any) => c.title)) + '；' + String(sB.text || '').slice(0, 160) + '）')

  // 列表：带 alpha 只回 alpha 的行
  const lA = await tools.deck_issue_list.run(exec, { state: 'all', feature: 'alpha' })
  check(lA.status === 'ok' && lA.data.issues.length >= 2 && lA.data.issues.every((t) => t.effortId === 'alpha'), '列表 feature=alpha 只回 alpha 的行（' + lA.data.returned + ' 行）')
  const l0 = await tools.deck_issue_list.run(exec, { state: 'all' })
  check(l0.status === 'ok' && l0.data.total >= 4, '列表不带时两份一起（' + l0.data.total + ' 行，与今天一致）')

  // 建票：带 beta 建到 beta；不带时 #1486 起按标题生成目录，不再猜现有 effort。
  const cB = await tools.deck_issue_create.run(exec, { title: 'Beta 新票', kind: 'issue', feature: 'beta' })
  check(cB.status === 'ok' && cB.data.ticket.effortId === 'beta', '建票 feature=beta 落在 beta（key=' + (cB.data.ticket && cB.data.ticket.key) + '）')
  const cBoth = await tools.deck_issue_create.run(exec, { title: '两参数新票', kind: 'issue', feature: 'beta', effort: 'beta' })
  check(cBoth.ok === false && String(cBoth.text || cBoth.message || '').includes('只能填一个'), '建票两个参数同时给 → bad-args，不落盘')
  const c0 = await tools.deck_issue_create.run(exec, { title: '不带 scope 的新票', kind: 'issue' })
  check(c0.status === 'ok' && String(c0.text || '').includes('.scratch/不带-scope-的新票/issues/'), '建票不带 scope 时按标题生成目录并如实回报（' + String(c0.text || '').slice(0, 80) + '）')

  // 改票：带 beta 改 beta 的 01
  const pB = await tools.deck_issue_patch.run(exec, { key: '01', effort: 'beta', comment: '784 T2 验收' })
  check(pB.status === 'ok' && (pB.items || []).some((i) => i.step === 'comment' && i.status === 'ok'), '改票 effort=beta 落在 beta')

  // 补边：在 beta 内给新建的那张票加阻塞边（同 effort 内）
  const newKey = String(cB.data.ticket.key)
  const linkB = await tools.deck_map_link.run(exec, { key: newKey, feature: 'beta', blockedBy: ['01'] })
  check(linkB.status === 'ok', '补边 feature=beta 落在 beta（' + linkB.status + '）')

  // 批量建图：带 alpha 建到 alpha。
  // #1487 起原文布局一个目录只允许一份 map.md（地图容器占 00）：上面快照断言用的那份手写 alpha/map.md
  // 到这里已经用完，先清掉给计划新建的地图腾位，否则建图会被如实拒绝，测不到「带 effort=alpha 就落在 alpha」。
  fs.rmSync(path.join(ws.root, '.scratch', 'alpha', 'map.md'))
  const plan = await tools.deck_map_plan_create.run(exec, { title: 'Alpha 批量图', effort: 'alpha', planId: 'plan-784-8-a', children: [{ key: 'b1', title: '批量子票一', kind: 'issue' }] })
  check(plan.status === 'ok' && plan.data.mapKey, '批量建图 effort=alpha 建成（map=' + (plan.data && plan.data.mapKey) + '）')
  const snapAfter = await tools.deck_map_snapshot.run(exec, { key: plan.data.mapKey, effort: 'alpha' })
  check(snapAfter.status === 'ok', '批量建的图能在 alpha 里读回来')

  // 远端忽略：用探针远端验证带不带 effort / feature 行为一致（后端忽略它）
  const probe = { id: 'probe-remote', label: '探针远端', matches: async () => false, budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }, create: () => ({ id: 'probe-remote', async create(repo, input) { return { ok: true, data: { key: 'P1', title: input.title, state: 'open', body: '', labels: [], assignees: [], effortId: '' } } }, async get(repo, key) { return { ok: true, data: { key: String(key), title: 'P1', state: 'open', body: '', labels: [], assignees: [], parentKey: null, effortId: '' } } }, async list(repo) { return { ok: true, data: [] } } }) }
  const dp = registry.register(probe)
  chooseWorkspace(ws.rootPosix, 'probe-remote')
  const r1 = await tools.deck_issue_get.run(exec, { key: 'P1' })
  const r2 = await tools.deck_issue_get.run(exec, { key: 'P1', feature: 'alpha' })
  const r3 = await tools.deck_issue_get.run(exec, { key: 'P1', effort: 'beta' })
  check(r1.status === 'ok' && r2.status === 'ok' && r3.status === 'ok' && r1.text === r2.text && r1.text === r3.text, '远端后端带不带 effort / feature 行为一致（忽略它）')
  dp.dispose()
  chooseWorkspace(ws.rootPosix, 'markdown')

  ws.cleanup()
  try { dispose.dispose() } catch (e) {}
  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('验收脚本异常：' + ((e && e.stack) || e)); process.exit(1) })
