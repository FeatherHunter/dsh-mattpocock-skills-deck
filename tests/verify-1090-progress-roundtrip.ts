// verify-1090-progress-roundtrip.ts —— #1090 防回归：进度写进去要读得回来（写、读、面板派生三处同一口径）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1090-progress-roundtrip.ts，可独立运行。
//
// 为什么要有这一段（#1090 的验收）：改之前把 90% 写进正文、读回来却是 null，三处入口各说各话。
// 这一段用真 Markdown 后端加真工具，走完「建票 → 写进度 → 三处读回」，逐条断言：
//   ① deck_issue_patch 写一条进度，deck_issue_get 的 data.ticket.progress 与写入逐项相同（percent/note/updatedAt、entries 首条）；
//   ② deck_map_snapshot 的 full 行 progressDetail 与数字 progress 同源，薄行仍不带进度；
//   ③ deck 投影 deriveDeck 的 progressOf 从同一份正文读出同一个数字（面板那块用它）；
//   ④ 正文里的代码块示例标题不被当成真的进度区；
//   ⑤ 老格式「## 进度：90%」第一次被写入时，旧百分比搬成「时间未记录」一条，旧自由文字原样保留；
//   ⑥ 重复的进度区合成一个、记录一条不丢；
//   ⑦ 正文超过 60KB 时拒绝写入、正文一个字不动；
//   ⑧ 写进度只动进度区，正文其他部分逐字不变；旧的自由文字进度参数不再收。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
// 判定出口桩（#1003 单出口）：壳拿不到它时会回「判定出口这次没装上」，夹具照生产接上。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT: string = path.resolve(__dirname, '..')
// 反引号用字符码拼出来，免得这段源码里出现三连反引号把代码块围栏写死。
const FENCE = String.fromCharCode(96).repeat(3)
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

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
  console.log('#1090 防回归：进度写进去要读得回来（写、读、面板派生三处同一口径）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const { stripProgressSections } = await imp('src/tracker/body-parse.ts')
  const { deriveDeck } = await imp('src/tracker/deck-derive.ts')

  // —— 真临时目录里的一份 Markdown 工作区（与 verify-971 同一套夹具口径）——
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), '1090-progress-'))
  const rootAPosix = rootA.replace(/\\/g, '/')
  fs.mkdirSync(path.join(rootA, '.scratch', 'demo', 'issues'), { recursive: true })
  const plat = makePlat()
  const ctxA = { platform: plat, fs: plat.fs, cwd: rootAPosix, get(n) { return n === 'fs' ? plat.fs : undefined } }
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ctxA), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handleA = { cwd: rootAPosix, refId: '.scratch/demo' }
  chooseWorkspace(rootAPosix, 'markdown')
  // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ctxA, handleFor: () => handleA,
    log: { fire: () => {} }, now: () => clock,
    invalidate: () => {},
    decideBackend: makeDecideStub(registry),
    planStore: (() => { const t = new Map(); return { durable: true, load(id) { return t.get(id) || null }, save(id, s) { t.set(id, s) } } })(),
  }
  const planTool = (await imp('src/deck/tools/map-plan-create.ts')).createDeckMapPlanCreate(deps)
  const patchTool = (await imp('src/deck/tools/issue-patch.ts')).createDeckIssuePatch(deps)
  const getTool = (await imp('src/deck/tools/issue-get.ts')).createDeckIssueGet(deps)
  const snapTool = (await imp('src/deck/tools/map-snapshot.ts')).createDeckMapSnapshot(deps)
  const createTool = (await imp('src/deck/tools/issue-create.ts')).createDeckIssueCreate(deps)
  const execA = { agent: { session: { id: 's-1090', cwd: rootAPosix } } }

  // ═══ ① 建地图 + 一张子票，写一条进度再读回 ═══
  const plan = await planTool.run(execA, {
    planId: '1090-roundtrip-01', title: '进度回合地图',
    children: [{ key: 'c1', title: '回合子票一', kind: 'issue' }],
    edges: [{ from: 'c1', to: '@map', type: 'parent' }],
  })
  check(plan && plan.status === 'ok', '建地图加子票整体成功（实得 ' + (plan && plan.status) + '）')
  const mapKey = String((plan.data && plan.data.mapKey) || '')
  const builtKeys = (plan.data && plan.data.builtKeys) || []
  const childKey = String(builtKeys.find((k) => String(k) !== mapKey) || '')
  check(!!mapKey && !!childKey, '地图与子票票号都拿到了（地图 ' + mapKey + '，子票 ' + childKey + '）')

  const before = await getTool.run(execA, { key: childKey })
  const beforeBody = String((before.data && before.data.ticket && before.data.ticket.body) || '')
  const w1 = await patchTool.run(execA, { key: childKey, progress: { percent: 90, note: '写完了' } })
  check(w1 && w1.status === 'ok', '写一条进度回 ok（实得 ' + (w1 && w1.status) + '，说明 ' + String((w1 && w1.text) || '').slice(0, 120) + '）')
  const w1item = ((w1 && w1.items) || []).find((i) => i.step === 'text') || {}
  check(w1item.status === 'ok', '写后核对那一步自己回 ok（实得 ' + w1item.status + '，原因 ' + String(w1item.reason || '') + '）')

  const g1 = await getTool.run(execA, { key: childKey })
  const p1 = (g1.data && g1.data.ticket && g1.data.ticket.progress) || null
  check(!!p1 && p1.percent === 90 && p1.note === '写完了', 'deck_issue_get 读回 percent 与说明都相同（实得 ' + JSON.stringify(p1) + '）')
  check(!!p1 && ISO_MS.test(String(p1.updatedAt)), '时间由工具盖成 ISO 8601 带时区（实得 ' + String(p1 && p1.updatedAt) + '）')
  check(!!p1 && Array.isArray(p1.entries) && p1.entries.length === 1 && p1.entries[0].percent === 90
    && p1.entries[0].note === '写完了' && p1.entries[0].updatedAt === p1.updatedAt, '第一条记录就是刚写的这条（实得 ' + JSON.stringify(p1 && p1.entries) + '）')
  const g1body = String((g1.data && g1.data.ticket && g1.data.ticket.body) || '')
  check(g1body.indexOf('- 进度：90%') >= 0, '正文里写出了规范条目（实得含 = ' + (g1body.indexOf('- 进度：90%') >= 0) + '）')

  // ⑧ 只动进度区：去掉进度区以后，正文其余部分与写前逐字相同。
  check(stripProgressSections(beforeBody).trim() === stripProgressSections(g1body).trim(), '写进度只动进度区，正文其他部分逐字未动')

  // 读工具的 section 参数能直接取进度区。
  const gsection = await getTool.run(execA, { key: childKey, section: '进度' })
  const section = (gsection.data && gsection.data.section) || null
  check(!!section && String(section.name).indexOf('进度') >= 0 && String(section.text).indexOf('- 进度：90%') >= 0,
    'section=进度 能直接取到进度区（实得 ' + JSON.stringify(section) + '）')

  // ═══ ② 地图快照 full 行与数字进度同源，薄行不带进度 ═══
  const snap = await snapTool.run(execA, { key: mapKey })
  const rows = (snap.data && snap.data.children) || []
  const row = rows.find((r) => String(r.key) === childKey)
  check(!!row && row.progress === 90, '快照 full 行数字进度 90（实得 ' + String(row && row.progress) + '）')
  check(!!row && !!row.progressDetail && row.progressDetail.percent === 90 && row.progressDetail.note === '写完了'
    && row.progressDetail.updatedAt === p1.updatedAt, '快照 full 行结构化进度与 get 读回逐项相同（实得 ' + JSON.stringify(row && row.progressDetail) + '）')
  const thin = await snapTool.run(execA, { key: mapKey, detail: 'thin' })
  const thinRow = ((thin.data && thin.data.children) || []).find((r) => String(r.key) === childKey)
  check(!!thinRow && thinRow.progress === undefined && thinRow.progressDetail === undefined, '薄行仍不带进度字段（守住回包大小）')

  // ═══ ③ 面板派生（deriveDeck 的 progressOf）从同一份正文读出同一个数字 ═══
  const ticketSeed = {
    key: childKey, type: 'issue', title: '回合子票一', state: 'open', body: g1body, url: '',
    createdAt: '', updatedAt: '', closedAt: null, parentKey: mapKey,
    labels: [], assignees: [], comments: [], blockedBy: [], reason: '',
  }
  const mapSeed = {
    key: mapKey, type: 'map', title: '进度回合地图', state: 'open', body: '', url: '',
    createdAt: '', updatedAt: '', closedAt: null, parentKey: null,
    labels: [], assignees: [], comments: [], blockedBy: [], reason: '', tickets: [ticketSeed],
  }
  const deck = deriveDeck({ maps: [mapSeed], issues: [] })
  const progressValues = Object.keys(deck.progressOf).map((k) => deck.progressOf[k])
  check(progressValues.indexOf(90) >= 0, '面板派生的 progressOf 也是 90（实得 ' + JSON.stringify(progressValues) + '）')

  // ═══ ⑨ 旧的自由文字 progress 参数不再收，正文不动 ═══
  const oldStyle = await patchTool.run(execA, { key: childKey, progress: '95%' })
  check(oldStyle && oldStyle.status !== 'ok', '自由文字 progress 被拒（实得 ' + (oldStyle && oldStyle.status) + '）')
  const gOld = await getTool.run(execA, { key: childKey })
  check(String((gOld.data && gOld.data.ticket && gOld.data.ticket.body) || '') === g1body, '被拒以后正文一个字没动')

  // ═══ ⑤ 老格式第一次被写入：旧百分比搬成一条「时间未记录」，旧自由文字保留 ═══
  const legacyBody = '## 进度：90%\n\n以前随手写的一段旧文字。'
  const lc = await createTool.run(execA, { title: '老格式进度票', kind: 'issue', body: legacyBody })
  check(lc && lc.status === 'ok', '老格式票建成功（实得 ' + (lc && lc.status) + '）')
  const legacyKey = String((lc.data && lc.data.ticket && lc.data.ticket.key) || '')
  const lw = await patchTool.run(execA, { key: legacyKey, progress: { percent: 70, note: '按新写法再记一条' } })
  check(lw && lw.status === 'ok', '老格式票写新进度回 ok（实得 ' + (lw && lw.status) + '，说明 ' + String((lw && lw.text) || '').slice(0, 160) + '）')
  const lg = await getTool.run(execA, { key: legacyKey })
  const lp = (lg.data && lg.data.ticket && lg.data.ticket.progress) || null
  const lgbody = String((lg.data && lg.data.ticket && lg.data.ticket.body) || '')
  check(!!lp && lp.percent === 70 && lp.entries.length === 2, '老格式票读回新记录在先、旧记录在后（实得 ' + JSON.stringify(lp) + '）')
  check(!!lp && lp.entries.length === 2 && lp.entries[1].percent === 90 && lp.entries[1].updatedAt === null && lp.entries[1].note === '',
    '旧标题里的百分比搬成「时间未记录」一条、说明为空（实得 ' + JSON.stringify(lp && lp.entries) + '）')
  check(lgbody.indexOf('时间未记录') >= 0, '旧百分比那条写明了「时间未记录」')
  check(lgbody.indexOf('以前随手写的一段旧文字。') >= 0, '旧自由文字原样保留')

  // ═══ ⑥ 重复进度区合成一个、记录一条不丢 ═══
  const dupBody = '## 进度\n\n- 进度：30%（2026-01-01T00:00:00+08:00）：旧一\n\n## 进度\n\n- 进度：40%（2026-01-02T00:00:00+08:00）：旧二\n'
  const dc = await createTool.run(execA, { title: '重复进度区票', kind: 'issue', body: dupBody })
  check(dc && dc.status === 'ok', '重复进度区票建成功（实得 ' + (dc && dc.status) + '）')
  const dupKey = String((dc.data && dc.data.ticket && dc.data.ticket.key) || '')
  const dw = await patchTool.run(execA, { key: dupKey, progress: { percent: 50, note: '合成一个' } })
  check(dw && dw.status === 'ok', '重复进度区票写进度回 ok（实得 ' + (dw && dw.status) + '）')
  const dg = await getTool.run(execA, { key: dupKey })
  const dp = (dg.data && dg.data.ticket && dg.data.ticket.progress) || null
  const dgbody = String((dg.data && dg.data.ticket && dg.data.ticket.body) || '')
  check(!!dp && dp.percent === 50 && dp.entries.length === 3, '重复进度区的三条记录都在（实得 ' + JSON.stringify(dp) + '）')
  check(!!dp && dp.entries.map((e) => e.percent).join(',') === '50,30,40', '顺序是新的最上、两段旧记录按出现顺序（实得 ' + (dp && dp.entries.map((e) => e.percent).join(',')) + '）')
  const headingCount = dgbody.split(/\r?\n/).filter((l) => /^##\s*进度/.test(l)).length
  check(headingCount === 1, '重复进度区只剩一个标题（实得 ' + headingCount + ' 个）')

  // ═══ ④ 代码块里的示例标题不算真的进度区、也不被改写 ═══
  const fenceBody = '顺手记一下写法：\n\n' + FENCE + '\n## 进度：99%\n' + FENCE + '\n'
  const fc = await createTool.run(execA, { title: '代码块示例票', kind: 'issue', body: fenceBody })
  check(fc && fc.status === 'ok', '代码块示例票建成功（实得 ' + (fc && fc.status) + '）')
  const fenceKey = String((fc.data && fc.data.ticket && fc.data.ticket.key) || '')
  const fw = await patchTool.run(execA, { key: fenceKey, progress: { percent: 20, note: '加一条' } })
  check(fw && fw.status === 'ok', '代码块示例票写进度回 ok（实得 ' + (fw && fw.status) + '）')
  const fg = await getTool.run(execA, { key: fenceKey })
  const fp = (fg.data && fg.data.ticket && fg.data.ticket.progress) || null
  const fgbody = String((fg.data && fg.data.ticket && fg.data.ticket.body) || '')
  check(!!fp && fp.percent === 20, '示例里的 99% 没被当成当前进度（实得 ' + JSON.stringify(fp) + '）')
  check(fgbody.indexOf(FENCE + '\n## 进度：99%\n' + FENCE) >= 0, '代码块示例原样保留、一个字没被改写')

  // ═══ ⑦ 正文超过 60KB 时拒绝写入、正文一个字不动 ═══
  const bigBody = '## 目的\n\n' + 'x'.repeat(62000)
  const bc = await createTool.run(execA, { title: '超长正文票', kind: 'issue', body: bigBody })
  check(bc && bc.status === 'ok', '超长正文票建成功（实得 ' + (bc && bc.status) + '）')
  const bigKey = String((bc.data && bc.data.ticket && bc.data.ticket.key) || '')
  const bBefore = await getTool.run(execA, { key: bigKey })
  const bBeforeBody = String((bBefore.data && bBefore.data.ticket && bBefore.data.ticket.body) || '')
  const bw = await patchTool.run(execA, { key: bigKey, progress: { percent: 10, note: '想写但超长' } })
  check(bw && bw.status !== 'ok', '超过 60KB 时明确拒绝写入（实得 ' + (bw && bw.status) + '）')
  const bwReasons = ((bw && bw.items) || []).map((i) => String((i.error && i.error.message) || i.reason || '')).join(' ')
  check(bwReasons.indexOf('硬顶') >= 0 && bwReasons.indexOf('一个字没动') >= 0,
    '拒绝说明里讲了 60KB 这条硬顶、也说了正文没动（实得：' + bwReasons.slice(0, 220) + '）')
  const bAfter = await getTool.run(execA, { key: bigKey })
  check(String((bAfter.data && bAfter.data.ticket && bAfter.data.ticket.body) || '') === bBeforeBody, '被拒以后正文一个字没动')

  try { dispose.dispose() } catch (e) {}
  try { fs.rmSync(rootA, { recursive: true, force: true }) } catch (e) {}
  console.log('\n' + (failed ? '存在失败' : '全部通过 — #1090（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
