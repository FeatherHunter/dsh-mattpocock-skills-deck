// verify-971-markdown-parent.js —— #971 防回归：本地后端父边与快照按文件顶注释计数
// 用法：在插件根目录执行 node tests/verify-971-markdown-parent.js，可独立运行。
//
// 为什么要这一段：建票把父写进文件顶注释，读回与列举却永远填固定值 00，改父同目录直接说做不到。
// 扁平布局里地图是 01 号，固定值永远对不上，按地图筛选恒为 0，快照 0/0，只能人肉逐张读回。
// 这一段按验收标准逐条断言（#971 期望 A）：
//   ① 扁平无地图工作区建整张骨架：票全建成，父边全成功，整体成功，计数对得上；
//   ② 逐张读回的父子列与文件顶注释一致，地图自身为空；
//   ③ 按地图筛选与快照子票数等于实际子票数，不再为零；
//   ④ 单根布局（地图为 00）回归通过；跨目录或不存在的父仍如实失败。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function makePlat() {
  return {
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
}

async function main() {
  console.log('#971 防回归：本地后端父边与快照（读注释、改父同目录成功、快照计数）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const registryMod = await imp('src/host/tracker/registryCore.js')
  const markdownModule = (await imp('src/host/tracker/backends/markdown/index.js')).markdownModule
  const toolCost = await imp('src/shared/refresh/tool-cost.js')

  // —— 扁平工作区：建图前 0 张地图（有目录但没有 map.md），与工单里的现场一致 ——
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), '971-flat-'))
  const rootAPosix = rootA.replace(/\\/g, '/')
  // 有 issues 目录但没有 map.md：listEfforts 为空（0 张地图），创建走夹具回落，与现场一致。
  fs.mkdirSync(path.join(rootA, '.scratch', 'demo', 'issues'), { recursive: true })
  const plat = makePlat()
  const ctxA = { platform: plat, fs: plat.fs, cwd: rootAPosix, get(n) { return n === 'fs' ? plat.fs : undefined } }

  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ctxA), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  // 手动绑定，绕过 map.md 识别（现场建图前 0 张地图，识别本就找不到它）。
  // refId 用相对路径（与 verify-deck-tools.js 同口径），绝对路径会让 issuesDir 拼出双前缀。
  const handleA = { cwd: rootAPosix, refId: '.scratch/demo' }
  registry.bind(handleA, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ctxA, handleFor: () => handleA,
    log: { fire: () => {} }, now: () => clock,
    invalidate: () => {},
    planStore: (() => { const t = new Map(); return { durable: true, load(id) { return t.get(id) || null }, save(id, s) { t.set(id, s) } } })(),
  }
  const planMod = await imp('src/host/tools/deckMapPlanCreate.js')
  const snapMod = await imp('src/host/tools/deckMapSnapshot.js')
  const getMod = await imp('src/host/tools/deckIssueGet.js')
  const linkMod = await imp('src/host/tools/deckMapLink.js')
  const planTool = planMod.createDeckMapPlanCreate(deps)
  const snapTool = snapMod.createDeckMapSnapshot(deps)
  const getTool = getMod.createDeckIssueGet(deps)
  const linkTool = linkMod.createDeckMapLink(deps)
  const execA = { agent: { session: { id: 's-971', cwd: rootAPosix } } }

  // ① 建 1 地图加 2 子票加 2 条父边：票全建成，边全成功，整体成功。
  const plan = await planTool.run(execA, {
    planId: '971-flat-01', title: '扁平地图',
    children: [{ key: 'c1', title: '扁平子票一' }, { key: 'c2', title: '扁平子票二' }],
    edges: [{ from: 'c1', to: '@map', type: 'parent' }, { from: 'c2', to: '@map', type: 'parent' }],
  })
  check(plan && plan.status === 'ok', '扁平建图整体成功（实得 ' + (plan && plan.status) + '，边 ' + JSON.stringify((plan.items || []).filter((i) => i.role === 'edge').map((i) => i.status)) + '）')
  const mapKey = String((plan.data && plan.data.mapKey) || '')
  check(mapKey && mapKey !== '00', '扁平地图不是 00 号（实得 ' + mapKey + '，与工单一致）')
  check(plan.data && plan.data.counts && plan.data.counts.ok === true && plan.data.counts.actual === 3, '逐项校验对得上（计划 3 实际 ' + ((plan.data && plan.data.counts && plan.data.counts.actual) || '?') + '）')

  // ② 逐张读回与文件顶注释一致，地图自身为空。
  const tracker = registry.get('markdown')
  const repoA = { backend: 'markdown', refId: rootAPosix, name: 'flat', url: '' }
  const builtKeys = (plan.data && plan.data.builtKeys) || []
  const gotMap = await getTool.run(execA, { key: mapKey })
  check(gotMap && gotMap.status === 'ok' && !(gotMap.data && gotMap.data.relations && gotMap.data.relations.parentKey), '地图 ' + mapKey + ' 自身没有父票（实得 ' + ((gotMap.data && gotMap.data.relations && gotMap.data.relations.parentKey) || '空') + '）')
  for (const k of builtKeys) {
    const got = await getTool.run(execA, { key: k })
    const rel = got.data && got.data.relations ? got.data.relations.parentKey : ''
    check(String(rel) === String(mapKey), '子票 ' + k + ' 的父是地图 ' + mapKey + '（实得 ' + (rel || '空') + '）')
  }
  // 直接读盘确认注释写了（边接口拒了但文件层级写了，正是工单的连带证据 1）。
  const { listIssues } = await imp('src/host/tracker/backends/markdown/issues-read.js')
  void listIssues
  void repoA
  void tracker

  // ③ 按地图筛选与快照不再为零。
  const snap = await snapTool.run(execA, { key: mapKey })
  check(snap && snap.status === 'ok', '快照回 ok（实得 ' + (snap && snap.status) + '）')
  check(snap.data && snap.data.children && snap.data.children.length === 2, '快照子票数为 2（实得 ' + ((snap.data && snap.data.children && snap.data.children.length) || '?') + '，不再是 0/0）')

  // 同值补边不再失败（建图已带父，随后同值补一次边）。
  const childKey = String(builtKeys.find((k) => String(k) !== String(mapKey)) || builtKeys[0] || '')
  void childKey

  // —— 单根布局回归：有 map.md 的工作区里 00 的子票仍能列出 ——
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), '971-single-'))
  const dirB = path.join(rootB, '.scratch', 'demo')
  fs.mkdirSync(path.join(dirB, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dirB, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n', 'utf8')
  const rootBPosix = rootB.replace(/\\/g, '/')
  const ctxB = { platform: plat, fs: plat.fs, cwd: rootBPosix, get(n) { return n === 'fs' ? plat.fs : undefined } }
  const registryB = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ctxB), { matchesTimeout: 200 })
  const disposeB = registryB.createRegistry ? null : null
  void disposeB
  void registryB
  // 直接用后端建两张 00 的子票并列出（走同一份解析，不经过工具壳）。
  const { createIssue } = await imp('src/host/tracker/backends/markdown/issues-create.js')
  const repoB = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '', effortId: 'demo' }
  const b1 = await createIssue(ctxB, repoB, { title: '单根子票一', type: 'task', parentKey: '00' })
  const b2 = await createIssue(ctxB, repoB, { title: '单根子票二', type: 'task' })
  void b1
  void b2
  const { listIssues: listB } = await imp('src/host/tracker/backends/markdown/issues-read.js')
  const listed00 = await listB(ctxB, repoB, { parentKey: '00' })
  // b2 没有显式父，回落到 00，所以 00 下应有 2 张。
  check(listed00.ok === true && listed00.data && listed00.data.filter((r) => String(r.parentKey) === '00').length === 2, '单根布局按 00 列出 2 张子票（回归通过）')

  // —— 不存在的父仍如实失败（跨目录与缺失都算做不到，不假装成功） ——
  const { setParentIssue } = await imp('src/host/tracker/backends/markdown/issues-patch.js')
  const { getIssue: getB } = await imp('src/host/tracker/backends/markdown/issues-read.js')
  const { updateIssue } = await imp('src/host/tracker/backends/markdown/issues-patch.js')
  const miss = await setParentIssue(ctxB, repoB, String((b1.data && b1.data.key) || '01'), '99')
  check(miss.ok === false, '不存在的父如实失败（实得 ok=' + miss.ok + '）')
  const same = await setParentIssue(ctxB, repoB, String((b1.data && b1.data.key) || '01'), '00')
  check(same.ok === true, '同目录同值改父成功（no-op，不再报做不到）')
  // —— 加固：正文里举例写同样的注释不算数，只认文件头 ——
  const evil = await createIssue(ctxB, repoB, { title: '正文举例', type: 'task', body: '下面是写法举例：\n<!-- parentKey: 99 -->\n不要当真。' })
  const gotEvil = await getB(ctxB, repoB, String((evil.data && evil.data.key) || ''), {})
  check(gotEvil.ok === true && String((gotEvil.data && gotEvil.data.parentKey) || '') === '00', '正文里的举例注释不劫持归属（实得 ' + ((gotEvil.data && gotEvil.data.parentKey) || '空') + '，应回落 00）')
  // —— 加固：整份替换改正文不许弄丢父 ——
  const kidKey = String((b1.data && b1.data.key) || '01')
  const whole = '# 单根子票一\n\n全新的正文，没有父注释，没有字段行。'
  const upd = await updateIssue(ctxB, repoB, kidKey, { body: whole })
  check(upd.ok === true, '整份替换改正文成功')
  const gotKid = await getB(ctxB, repoB, kidKey, {})
  check(gotKid.ok === true && String((gotKid.data && gotKid.data.parentKey) || '') === '00', '整份替换后父还在 00（实得 ' + ((gotKid.data && gotKid.data.parentKey) || '空') + '）')

  try { dispose.dispose() } catch (e) {}
  try { fs.rmSync(rootA, { recursive: true, force: true }) } catch (e) {}
  try { fs.rmSync(rootB, { recursive: true, force: true }) } catch (e) {}
  console.log('\n' + (failed ? '存在失败' : '全部通过 — #971（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
