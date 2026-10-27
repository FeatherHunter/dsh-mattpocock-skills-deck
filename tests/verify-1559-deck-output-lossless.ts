/**
 * tests/verify-1559-deck-output-lossless.ts —— deck 工具回执必须是无损 JSON（#1559）。
 *
 * 病根：deck_issue_list 在后端正常返回列表（没走 REST 降级）时，把回执 data 上的 fallback 与
 * fallbackReason 两个键写成了 undefined。DSH 宿主收工具返回值时要求无损 JSON，一个 undefined
 * 就让整笔调用被拒（tool "deck_issue_list" returned invalid output: value is not lossless JSON）。
 * 修法口径：缺省的键不出现（不写 undefined，也不用 null 顶替），opId 恒为字符串。
 *
 * 本门禁钉住四件事：
 *   ① 检查器与宿主 walkJsonValue 同口径：不可枚举自有属性、symbol 键、BigInt、循环、-0、NaN/Infinity、
 *      Date/类实例、稀疏数组、数组额外自有属性、undefined 值、顶层 undefined 都必须被拒；
 *   ② 九个 deck 工具各跑一次真实成功路径（真实本地 Markdown 后端），每份回执都能过检查器，
 *      并且 JSON.parse(JSON.stringify(v)) 与 v 深度相等；
 *   ③ #1559 那个具体形状（data.fallback 为 undefined）会被检查器点名到字段路径；
 *   ④ 修前的旧写法上这扇门禁会红（实测：旧代码跑本文件报 value.data.fallback 是 undefined），
 *      修后转绿 —— 这就是本票的回归钉。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1559-deck-output-lossless.ts
 *
 * 门禁归属: src/deck/tools
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chooseWorkspace, makeDecideStub } from './lib/deck-decide-stub.js'
import { losslessProblems, describeLosslessProblems } from './lib/json-lossless.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const TOOL_FILES: Array<[string, string, string]> = [
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

/** 一个真实本地 Markdown 工作区：票就是 .scratch/demo/issues/*.md 这些文件（与 verify-deck-tools 同一套做法）。 */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-lossless-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return String(p).replace(/\\/g, '/') },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    root: root,
    rootPosix: rootPosix,
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')

  const ws = makeWorkspace()
  let clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  registry.register(markdownModule)
  chooseWorkspace(ws.rootPosix, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx,
    handleFor: () => ({ cwd: ws.rootPosix, refId: '.scratch/demo' }),
    decideBackend: makeDecideStub(registry),
    log: { fire: () => {} },
    now: () => clock,
  }
  const tools: Record<string, any> = {}
  for (const [file, factory, name] of TOOL_FILES) tools[name] = (await imp(file))[factory](deps)
  const exec = { agent: { session: { id: 's-1559', cwd: ws.rootPosix } } }

  /** 一份回执要过两关：宿主口径的无损 JSON；题面点名的 JSON 往返后等值。 */
  const audit = (label: string, value: unknown): void => {
    const problems = losslessProblems(value)
    check(problems.length === 0, label + ' 回执是无损 JSON' + (problems.length ? '：' + describeLosslessProblems(problems, 3) : ''))
    if (problems.length > 0) return
    let roundtrip = true
    let why = ''
    try { assert.deepStrictEqual(JSON.parse(JSON.stringify(value)), value) } catch (e) {
      roundtrip = false
      why = String((e as { message?: unknown } | null)?.message || e).split('\n')[0]
    }
    check(roundtrip, label + ' 回执经 JSON 往返后与本身等值' + (roundtrip ? '' : '：' + why))
  }

  const run = async (label: string, name: string, args: unknown): Promise<any> => {
    let r: any = null
    let threw = ''
    try { r = await tools[name].run(exec, args || {}) } catch (e) { threw = String((e as { message?: unknown } | null)?.message || e) }
    check(threw === '', label + '：工具不把异常抛给调用方' + (threw ? '（抛了：' + threw + '）' : ''))
    if (r !== null && r !== undefined) {
      // 只判「没抛 + 无损」不够：回执退回错误信封时门禁也绿，标题里的「真实成功路径」会失真（#1559 复审）。
      check(r.status === 'ok', label + ' 回执状态是 ok（实得 ' + JSON.stringify(r.status) + '）')
      audit(label, r)
    }
    return r
  }

  // ── 一、九个工具各跑一次真实成功路径，逐份回执过检查器 ──
  console.log('— 一、九个 deck 工具的真实成功回执必须能过宿主的无损 JSON 检查')
  await run('工作区概况', 'deck_context', {})
  const created = await run('建票', 'deck_issue_create', { title: '无损门禁演示票', kind: 'issue', feature: 'demo-spec', body: '正文在这里' })
  const issueKey = String((created && created.data && created.data.ticket && created.data.ticket.key) || '')
  check(!!issueKey, '建票回执带票号（实得 ' + JSON.stringify(issueKey) + '）')
  await run('读票', 'deck_issue_get', { key: issueKey, feature: 'demo-spec' })
  // #1559 的故障支就在这一条：正常成功（没走 REST 降级）的列票回执。
  const listedNormal = await run('列票（正常成功）', 'deck_issue_list', { state: 'open' })
  const normalData = (listedNormal && listedNormal.data) || {}
  check(!('fallback' in normalData) && !('fallbackReason' in normalData), '正常成功回执的 data 里没有 fallback/fallbackReason 两个键（实得 ' + JSON.stringify(Object.keys(normalData)) + '）')
  check(typeof normalData.opId === 'string' && normalData.opId.length > 0, '正常成功回执的 opId 是非空字符串（实得 ' + JSON.stringify(normalData.opId) + '）')
  await run('地图快照（full）', 'deck_map_snapshot', { key: '00', effort: 'demo' })
  await run('地图快照（thin）', 'deck_map_snapshot', { key: '00', effort: 'demo', detail: 'thin' })
  await run('改票', 'deck_issue_patch', { key: issueKey, feature: 'demo-spec', comment: '无损门禁：一条评论' })
  await run('上报处理', 'deck_issue_report', { key: issueKey, feature: 'demo-spec' })
  const childA = await run('建地图子票 A', 'deck_issue_create', { title: '地图子票 A', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '00', effort: 'demo', body: '子票 A' })
  const keyA = String((childA && childA.data && childA.data.ticket && childA.data.ticket.key) || '')
  const childB = await run('建地图子票 B', 'deck_issue_create', { title: '地图子票 B', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '00', effort: 'demo', body: '子票 B' })
  const keyB = String((childB && childB.data && childB.data.ticket && childB.data.ticket.key) || '')
  check(!!keyA && !!keyB, '两张地图子票都建成了（A=' + keyA + '，B=' + keyB + '）')
  await run('补阻塞边', 'deck_map_link', { key: keyB, effort: 'demo', blockedBy: [keyA] })
  await run('建地图骨架', 'deck_map_plan_create', { planId: 'lossless-plan', title: '无损门禁地图', effort: 'lossless-plan', children: [{ key: 'a1', title: '子一', kind: 'issue' }] })

  // ── 一（续）、降级分支：后端走了 REST 降级时，fallback 与 fallbackReason 必须有值 ──
  // 本地 Markdown 后端没有 REST 降级通道，所以这一段单独造一个「列表回 REST 降级」的假后端；
  // 不补这一条，Agent Brief 要求的「两种分支」里降级那一半就没有任何验证证据（#1559 复审补）。
  console.log('— 一（续）、REST 降级分支的回执形状')
  const ws2 = makeWorkspace()
  const ledger2 = ledgerMod.createLedger({ now: () => clock })
  const gate2 = gateMod.createGate({ ledger: ledger2, now: () => clock })
  const registry2 = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws2.ctx), { matchesTimeout: 200 })
  const fallbackModule = Object.assign({}, markdownModule, {
    create: (backendCtx: unknown) => {
      const tracker: Record<string, any> = (markdownModule as any).create(backendCtx)
      tracker.list = async () => ({ ok: true, data: [], truncated: false, fallback: 'rest', fallbackReason: 'quota' })
      return tracker
    },
  })
  registry2.register(fallbackModule as any)
  chooseWorkspace(ws2.rootPosix, 'markdown')
  ledger2.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const deps2 = {
    gate: gate2, registry: registry2, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws2.ctx,
    handleFor: () => ({ cwd: ws2.rootPosix, refId: '.scratch/demo' }),
    decideBackend: makeDecideStub(registry2),
    log: { fire: () => {} },
    now: () => clock,
  }
  const fallbackList = (await imp('src/deck/tools/issue-list.ts')).createDeckIssueList(deps2)
  const exec2 = { agent: { session: { id: 's-1559-rest', cwd: ws2.rootPosix } } }
  let fallbackReceipt: any = null
  let fallbackThrew = ''
  try { fallbackReceipt = await fallbackList.run(exec2, { state: 'open' }) } catch (e) { fallbackThrew = String((e as { message?: unknown } | null)?.message || e) }
  check(fallbackThrew === '', '列票（REST 降级）：工具不把异常抛给调用方' + (fallbackThrew ? '（抛了：' + fallbackThrew + '）' : ''))
  check(!!fallbackReceipt && fallbackReceipt.status === 'ok', '列票（REST 降级）回执状态是 ok（实得 ' + JSON.stringify(fallbackReceipt && fallbackReceipt.status) + '）')
  if (fallbackReceipt) audit('列票（REST 降级）', fallbackReceipt)
  const fallbackData = (fallbackReceipt && fallbackReceipt.data) || {}
  check(fallbackData.fallback === 'rest', 'REST 降级回执带 fallback=rest（实得 ' + JSON.stringify(fallbackData.fallback) + '）')
  check(fallbackData.fallbackReason === 'quota', 'REST 降级回执带具体原因 quota（实得 ' + JSON.stringify(fallbackData.fallbackReason) + '）')
  check(typeof fallbackData.opId === 'string' && fallbackData.opId.length > 0, 'REST 降级回执的 opId 也是非空字符串（实得 ' + JSON.stringify(fallbackData.opId) + '）')
  ws2.cleanup()

  // ── 二、检查器本身：宿主会拒收的坏值必须被点名 ──
  console.log('— 二、检查器判据（照宿主 walkJsonValue 的口径）')
  const badValues: Array<[string, unknown]> = [
    ['undefined 的对象属性（#1559 的形状）', { data: { fallback: undefined } }],
    ['undefined 的数组项', [1, undefined, 3]],
    ['稀疏数组', [1, , 3]],
    ['数组带额外自有属性', Object.assign([1], { extra: 2 })],
    ['symbol 自有键', { [Symbol('sym')]: 1 }],
    ['不可枚举自有属性', (() => { const o: any = { a: 1 }; Object.defineProperty(o, 'hidden', { value: 2, enumerable: false }); return o })()],
    ['BigInt', { n: 1n }],
    ['NaN', { n: NaN }],
    ['Infinity', { n: Infinity }],
    ['-0', -0],
    ['Date', new Date(0)],
    ['类实例', new (class Demo { x = 1 })()],
    ['Map', new Map()],
    ['函数', { fn: () => 1 }],
    ['循环引用', (() => { const o: any = {}; o.self = o; return o })()],
    ['顶层 undefined', undefined],
  ]
  for (const [name, value] of badValues) {
    const problems = losslessProblems(value)
    check(problems.length > 0, '坏值被拒：' + name + (problems.length ? '（' + problems[0].reason + '）' : '（没有被拒，判据漏了）'))
  }

  const goodValues: Array<[string, unknown]> = [
    ['null', null], ['布尔', true], ['字符串', 'x'], ['整数', 0], ['小数', 1.5],
    ['空数组', []], ['空对象', {}], ['嵌套普通值', { a: 1, b: [true, null, 'x'], c: { d: 2 } }],
    ['null 原型对象（宿主允许）', Object.assign(Object.create(null), { a: 1 })],
  ]
  for (const [name, value] of goodValues) {
    const problems = losslessProblems(value)
    check(problems.length === 0, '好值通过：' + name + (problems.length ? '（被误拒：' + problems[0].path + ' ' + problems[0].reason + '）' : ''))
  }

  // ── 三、钉住 #1559 的具体形状：字段路径必须被点到 ──
  console.log('— 三、#1559 的回归形状')
  const bugShape = losslessProblems({ status: 'ok', data: { total: 1, fallback: undefined, fallbackReason: undefined } })
  check(bugShape.some((p) => p.path === 'value.data.fallback'), '检查器点名 value.data.fallback（实得：' + JSON.stringify(bugShape.map((p) => p.path)) + '）')
  check(bugShape.some((p) => p.path === 'value.data.fallbackReason'), '检查器点名 value.data.fallbackReason（实得：' + JSON.stringify(bugShape.map((p) => p.path)) + '）')

  ws.cleanup()
  console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
