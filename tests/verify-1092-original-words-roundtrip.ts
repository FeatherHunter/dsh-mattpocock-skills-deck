// verify-1092-original-words-roundtrip.ts —— #1092 防回归：维护者原话读得回来，一个字不改（含出处与记录时间）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1092-original-words-roundtrip.ts，可独立运行。
//
// 为什么要有这一段（#1092 的验收）：#1091 把原话写进了正文，却没有任何读工具把它读回来；要读到原话只能
// 把 body 整段拿走自己数引用块，读出来的换行、空行、行内空格与写进去的是否逐字相同也没人验。
// 这一段用真 Markdown 后端加真工具，走完「建票带原话 → 读工具读回 → 地图快照读回 → 再写再读」，逐条断言：
//   ① deck_issue_get 的 data.ticket.originalWords 与写进去的 {text, source} 逐字相同（多行、空行、行内前后空格、
//      以 > 开头的一行、看起来像出处的一行、全角标点、emoji、句尾空格都不许变）；
//   ② recordedAt 只从出处文字里认带 T 的 ISO 8601 时间，原样返回；出处没写时间、只写日期时是 null；
//   ③ section='维护者原话' 能直接取到整区原文（含引用块的 > 前缀）；
//   ④ deck_map_snapshot 的 full 行原话与 deck_issue_get 是同一份，thin 行故意不带；
//   ⑤ 没写过原话的票回空数组（不是 null）；代码块里的示例标题不算真的原话区；
//   ⑥ 同一段原话 + 同一出处重复提交时幂等跳过，读回来仍只有一条（recordedAt 不参与幂等判断）。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
// 判定出口桩（#1003 单出口）：壳拿不到它时会回「判定出口这次没装上」，夹具照生产接上。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT: string = path.resolve(__dirname, '..')
// 反引号用字符码拼出来，免得这段源码里出现三连反引号把代码块围栏写死。
const FENCE = String.fromCharCode(96).repeat(3)
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

function makePlat() {
  return {
    path: path.posix,
    fs: {
      async resolve(p: any) { return String(p).replace(/\\/g, '/') },
      async readText(t: any) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: any, c: any) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: any) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t: any) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t: any) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
}

async function main() {
  console.log('#1092 防回归：维护者原话读得回来，一个字不改')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const words = await imp('src/shared/issue-file/src/original-words.js')

  // —— 一条刁钻的原话：多行、中间空行、行首行尾空格（行尾两个空格是有意的）、以 > 开头的一行、
  //    看起来像出处的一行、全角标点与 emoji。写进正文再读回来必须逐字相同。——
  const TRICKY_LINES = [
    '第一行：带全角标点，还带 emoji 🙂',
    '',
    '  行首两个空格、行尾两个空格  ',
    '> 这一行本身就以上尖括号开头',
    '出处：这一行看起来像出处，但它在引用块里，读回来必须还是原话',
    '最后一行以两个空格结尾  ',
  ]
  const TRICKY = TRICKY_LINES.join('\n')
  const e1 = { text: TRICKY, source: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1092' }
  const e2 = { text: '第二条原话（出处里写了时间）', source: '本会话（2026-10-21T22:05+08:00）' }
  const e3 = { text: '第三条原话（出处里只有日期）', source: 'src/shared/issue-file/src/original-words.ts:249 （2026-10-21）' }

  // ═══ 一、纯函数层：读回规则与 recordedAt 的认法 ═══
  const unitBody = '## 维护者原话\n\n出处：本会话（2026-10-21T22:05:30Z）\n> 甲\n\n出处：' + e3.source + '\n> 乙\n\n出处：版本 v1.2.3\n> 丙\n'
  const unit = words.parseOriginalWords(unitBody)
  check(unit.length === 3, '纯函数：三条原话按出现顺序读出（实得 ' + unit.length + ' 条）')
  check(unit[0] && unit[0].recordedAt === '2026-10-21T22:05:30Z', '纯函数：出处里的 UTC 时间原样带出（实得 ' + String(unit[0] && unit[0].recordedAt) + '）')
  check(unit[1] && unit[1].recordedAt === null, '纯函数：出处里只有日期（没带 T 的具体时刻）时不认成记录时间（实得 ' + String(unit[1] && unit[1].recordedAt) + '）')
  check(unit[2] && unit[2].recordedAt === null, '纯函数：出处里没有时间时 recordedAt 是 null（实得 ' + String(unit[2] && unit[2].recordedAt) + '）')
  check(words.parseOriginalWords(null).length === 0 && words.parseOriginalWords('普通正文，没有原话区').length === 0,
    '纯函数：没有原话区时回空数组（不是 null、不猜）')
  const quotedFake = '## 维护者原话\n\n出处：示例出处\n> 示例原话\n'
  const fenceFake = '顺手记一下写法：\n\n' + FENCE + '\n' + quotedFake + FENCE + '\n'
  check(words.parseOriginalWords(fenceFake).length === 0, '纯函数：代码块里的示例标题不算真的原话区')
  const commentedFake = '<!--\n## 维护者原话\n\n出处：注释里的示例\n> 注释里的原话\n-->\n'
  check(words.parseOriginalWords(commentedFake).length === 0, '纯函数：HTML 注释里的示例标题也不算真的原话区')

  // —— 真临时目录里的一份 Markdown 工作区（与 verify-1090 / verify-1091 同一套夹具口径）——
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), '1092-original-words-'))
  const rootAPosix = rootA.replace(/\\/g, '/')
  fs.mkdirSync(path.join(rootA, '.scratch', 'demo', 'issues'), { recursive: true })
  const plat = makePlat()
  const ctxA = { platform: plat, fs: plat.fs, cwd: rootAPosix, get(n: string) { return n === 'fs' ? plat.fs : undefined } }
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ctxA), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handleA = { cwd: rootAPosix, refId: '.scratch/demo' }
  chooseWorkspace(rootAPosix, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ctxA, handleFor: () => handleA,
    log: { fire: () => {} }, now: () => clock,
    invalidate: () => {},
    decideBackend: makeDecideStub(registry),
    planStore: (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(id) || null }, save(id: string, s: unknown) { t.set(id, s) } } })(),
  }
  const createTool = (await imp('src/deck/tools/issue-create.ts')).createDeckIssueCreate(deps)
  const patchTool = (await imp('src/deck/tools/issue-patch.ts')).createDeckIssuePatch(deps)
  const getTool = (await imp('src/deck/tools/issue-get.ts')).createDeckIssueGet(deps)
  const snapTool = (await imp('src/deck/tools/map-snapshot.ts')).createDeckMapSnapshot(deps)
  const planTool = (await imp('src/deck/tools/map-plan-create.ts')).createDeckMapPlanCreate(deps)
  const execA = { agent: { session: { id: 's-1092', cwd: rootAPosix } } }
  const wordsOf = (res: any): any[] => (res && res.data && res.data.ticket && res.data.ticket.originalWords) || []

  // ═══ ① 建票带一条刁钻原话，再读回来逐字相同 ═══
  const created = await createTool.run(execA, { title: '原话读回票', kind: 'issue', body: '## 目的\n\n把原话读回来。\n', originalWords: e1 })
  check(!!created && created.status === 'ok', '建票带原话回 ok（实得 ' + String(created && created.status) + '，说明 ' + String((created && created.text) || '').slice(0, 160) + '）')
  const cKey = String((created.data && created.data.ticket && created.data.ticket.key) || '')
  check(!!cKey, '拿到建出来的票号（实得 ' + cKey + '）')
  const g1 = await getTool.run(execA, { key: cKey })
  const w1 = wordsOf(g1)
  check(w1.length === 1, '读工具读回一条原话（实得 ' + w1.length + ' 条）')
  check(w1[0] && JSON.stringify(w1[0].text) === JSON.stringify(TRICKY),
    '原话正文逐字相同（长度 ' + String(w1[0] && w1[0].text.length) + ' / 写入 ' + TRICKY.length + '，空行、行首行尾空格、> 开头都没有被改写）')
  check(w1[0] && w1[0].source === e1.source, '出处原样带出（实得 ' + String(w1[0] && w1[0].source) + '）')
  check(w1[0] && w1[0].recordedAt === null, '出处里没有时间时 recordedAt 是 null（实得 ' + String(w1[0] && w1[0].recordedAt) + '）')
  const body1 = String((g1.data && g1.data.ticket && g1.data.ticket.body) || '')
  check(body1.indexOf('出处：' + e1.source) >= 0 && body1.indexOf('> ' + TRICKY_LINES[0]) >= 0 && body1.indexOf('> > 这一行') >= 0,
    '正文里写出的是「出处行 + 引用块」规范写法（含 > 开头的行再加一层引用）')
  check(body1.split('\n').some((l: string) => l.indexOf('> 出处：这一行看起来像出处') === 0),
    '看起来像出处的原话行被包在引用块里，不会被误当出处')

  // ═══ ② 再追加两条：recordedAt 从出处里认，顺序不乱 ═══
  const p2 = await patchTool.run(execA, { key: cKey, originalWords: e2 })
  check(!!p2 && p2.status === 'ok', '追加第二条原话回 ok（实得 ' + String(p2 && p2.status) + '）')
  const p3 = await patchTool.run(execA, { key: cKey, originalWords: e3 })
  check(!!p3 && p3.status === 'ok', '追加第三条原话回 ok（实得 ' + String(p3 && p3.status) + '）')
  const g2 = await getTool.run(execA, { key: cKey })
  const w2 = wordsOf(g2)
  check(w2.length === 3, '读回三条原话（实得 ' + w2.length + ' 条）')
  check(w2[1] && w2[1].recordedAt === '2026-10-21T22:05+08:00', '第二条的 recordedAt 从出处里认出并原样带出（实得 ' + String(w2[1] && w2[1].recordedAt) + '）')
  check(w2[2] && w2[2].recordedAt === null, '第三条出处只有日期，recordedAt 是 null（实得 ' + String(w2[2] && w2[2].recordedAt) + '）')
  check(w2[0] && JSON.stringify(w2[0].text) === JSON.stringify(TRICKY) && w2[0].source === e1.source,
    '追加后面的原话不会改到前面的原话（第一条仍逐字相同）')

  // ═══ ③ section='维护者原话' 直接取整区原文 ═══
  const gs = await getTool.run(execA, { key: cKey, section: '维护者原话' })
  const section = (gs.data && gs.data.section) || null
  check(!!section && String(section.name).indexOf('维护者原话') >= 0, 'section 参数按标题找到原话区（实得 ' + JSON.stringify(section && section.name) + '）')
  check(String(section.text).indexOf('出处：' + e1.source) >= 0 && String(section.text).indexOf('> ' + TRICKY_LINES[2]) >= 0,
    'section 原文里出处行与引用块都在（引用块的 > 前缀原样，不替读的人剥掉）')

  // ═══ ⑥ 重复提交同一段原话 + 同一出处：幂等跳过，读回来仍是一条 ═══
  const again = await patchTool.run(execA, { key: cKey, originalWords: e2 })
  const againItem = ((again && again.items) || []).find((i: any) => i.step === 'text') || {}
  check(!!again && again.status === 'ok' && againItem.skipped === true, '重复提交时幂等跳过、不再写一遍正文（实得 skipped=' + String(againItem.skipped) + '）')
  const g3 = await getTool.run(execA, { key: cKey })
  check(wordsOf(g3).length === 3, '幂等跳过之后读回来仍只有三条（实得 ' + wordsOf(g3).length + ' 条）')

  // ═══ ④ 地图快照 full 行同一份、thin 行不带 ═══
  const plan = await planTool.run(execA, {
    planId: '1092-roundtrip-01', title: '原话读回地图',
    children: [{ key: 'c1', title: '原话读回子票', kind: 'issue' }],
    edges: [{ from: 'c1', to: '@map', type: 'parent' }],
  })
  check(plan && plan.status === 'ok', '建地图加子票整体成功（实得 ' + String(plan && plan.status) + '）')
  const mapKey = String((plan.data && plan.data.mapKey) || '')
  const childKey = String(((plan.data && plan.data.builtKeys) || []).find((k: string) => String(k) !== mapKey) || '')
  check(!!mapKey && !!childKey, '地图与子票票号都拿到了（地图 ' + mapKey + '，子票 ' + childKey + '）')
  const childWrite = await patchTool.run(execA, { key: childKey, originalWords: e1 })
  check(childWrite && childWrite.status === 'ok', '给子票写一条原话回 ok（实得 ' + String(childWrite && childWrite.status) + '）')
  const childGet = await getTool.run(execA, { key: childKey })
  const childWords = wordsOf(childGet)
  const snap = await snapTool.run(execA, { key: mapKey })
  const rows = (snap.data && snap.data.children) || []
  const row = rows.find((r: any) => String(r.key) === childKey)
  check(!!row && JSON.stringify(row.originalWords) === JSON.stringify(childWords),
    '快照 full 行的原话与 deck_issue_get 读回逐项相同（实得 ' + JSON.stringify(row && row.originalWords) + '）')
  const thin = await snapTool.run(execA, { key: mapKey, detail: 'thin' })
  const thinRow = ((thin.data && thin.data.children) || []).find((r: any) => String(r.key) === childKey)
  check(!!thinRow && thinRow.originalWords === undefined, '薄行不带原话字段（守住回包大小，要原话逐张读 get）')

  // ═══ ⑤ 没写过原话的票回空数组 ═══
  const mapGet = await getTool.run(execA, { key: mapKey })
  check(Array.isArray(wordsOf(mapGet)) && wordsOf(mapGet).length === 0, '没写过原话的票回空数组（不是 null，实得 ' + JSON.stringify(wordsOf(mapGet)) + '）')

  try { dispose.dispose() } catch (e) {}
  try { fs.rmSync(rootA, { recursive: true, force: true }) } catch (e) {}
  console.log('\n' + (failed ? '存在失败' : '全部通过 — #1092（' + total + ' 条）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
