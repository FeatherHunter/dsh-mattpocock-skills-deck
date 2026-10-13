// tests/verify-1106-deck-surface.ts —— #1106：九个 deck 工具对外的样子（参数表 / 信封表 / 点数表）
// 门禁归属: src/deck/tools
// 门禁归属: src/deck/shell/call-shell.ts
// 门禁归属: src/shared/refresh/src/tool-cost.ts
//
// 这份门禁只回答一个问题：九个对外工具「长什么样」，是不是还和冻下来的对照面一样？
// 给人读的那一份表在 specs/1106-deck-tool-surface-spec.md —— 那边给人读，这边给机器盯，
// 说的是同一件事：参数改一个键、回执少一格、点数动一条，这里就红。
//
// 三层 + 一条静态扫描，对着票面（#1106）的三张表：
//   一、参数表：九个定义的形状（参数名与书写顺序、必填、枚举、每个对象节点都显式写 additionalProperties:false）。
//       参数说明的文案不在这里抄第二份：长度由 tests/verify-deck-tools.js 盯着（≤350 字），
//       两处关键文案由 tests/verify-deck-thin-reads.js 盯着。
//   二、信封表：回执只有两种形状 —— 走到选后端之后的 14 格、还没走到之前的 6 格；三态取值；
//       失败时的原因码只能是七个之一；失败永远是值不是异常（稀奇古怪的参数形状也回值）；
//       记账数不上信封。
//   三、点数表：每一支调用在闸上记多少条、多少点。
//   四、越界：工具层不许出现直连外面的写法（起进程、联网、读环境、读写文件、动态求值）。
//
// 为什么用真闸 + 真账本 + 真注册表 + 本地 Markdown 房间：记账这件事只有真过一遍闸才看得见。
// 后端说「做不到」那一支按票面点名的缝来 —— 工具表工厂的依赖参数就是唯一的缝（传一个会说做不到的后端）。
//
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mjs tests/verify-1106-deck-surface.ts
// 手工跑要自己挂装载钩子（源码之间写的是 `../src/x.js` 这类说明符，靠钩子改指同名 .ts）；
// 挂进 npm test / verify:parallel / verify-all / test:smoke 四个入口时，钩子由那几处自动加上。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

/** 表一 · 参数表：九个定义的形状。格式见 shapeOf() 上面那段注释。 */
const FROZEN_SHAPE: Record<string, string> = {
  deck_context: '必填=[] 多传=false',
  deck_issue_get: 'key:string, comments:number, section:string, blocking:boolean, effortId:string 必填=[key] 多传=false',
  deck_map_snapshot: 'key:string, frontierOnly:boolean, detail:枚举(full|thin), effortId:string 必填=[key] 多传=false',
  deck_issue_list: 'state:枚举(open|closed|all), type:枚举(issue|map|all), labels:数组<string>, assignee:string, query:string, limit:number, effortId:string 必填=[] 多传=false',
  deck_issue_create: 'title:string, body:string, kind:枚举(task|bug|map), parentKey:string, labels:数组<string>, assignees:数组<string>, idempotencyKey:string, effortId:string 必填=[title] 多传=false',
  deck_map_plan_create: 'title:string, body:string, planId:string, children:数组<对象(key:string, title:string, body:string, kind:枚举(task|bug|map), labels:数组<string>, assignees:数组<string> 必填=[key,title] 多传=false)>, edges:数组<对象(from:string, to:string, type:枚举(blocked-by|parent) 必填=[from,to] 多传=false)>, labels:数组<string>, effortId:string 必填=[title,children] 多传=false',
  deck_map_link: 'key:string, parentKey:string, blockedBy:数组<string>, edges:数组<对象(key:string, parentKey:string, blockedBy:数组<string> 必填=[key] 多传=false)>, effortId:string 必填=[] 多传=false',
  deck_issue_patch: 'key:string, comment:string, addLabels:数组<string>, removeLabels:数组<string>, assignees:数组<string>, title:string, body:string, progress:string, close:boolean, effortId:string 必填=[key] 多传=false',
  deck_issue_report: 'key:string, note:string, effortId:string 必填=[key] 多传=false',
}

/** 表二 · 信封表：两种形状的字段清单，一个不多一个不少。 */
const ENVELOPE_FULL = ['backend', 'cost', 'data', 'items', 'notes', 'ok', 'readBack', 'reason', 'repo', 'status', 'text', 'tool', 'touched', 'workspace']
const ENVELOPE_PRE_GATE = ['cost', 'ok', 'reason', 'status', 'text', 'tool']
/** 七个原因码，取值写在 src/deck/shell/call-shell.ts:47-55。 */
const REASONS = ['no-session-context', 'ai-tool-refused', 'no-backend', 'gate-defer', 'backend-threw', 'backend-unsupported', 'bad-args']
const STATUSES = ['ok', 'partial', 'unsupported']

/** 表三 · 点数表：工具自己报的那一笔（不含选后端那固定 1 条 0 点）。 */
type PointsRow = { label: string, tool: string, args: Record<string, unknown>, own: [number, number] | 'est', select: boolean }
const POINTS: PointsRow[] = [
  { label: '工作区概况：成功', tool: 'deck_context', args: {}, own: [3, 2], select: true },
  { label: '建票：缺标题（还没走到选后端）', tool: 'deck_issue_create', args: {}, own: [0, 0], select: false },
  { label: '建票：成功、没有父子边', tool: 'deck_issue_create', args: { title: '点数表甲票', kind: 'task' }, own: [2, 4], select: true },
  { label: '建票：成功、带父子边', tool: 'deck_issue_create', args: { title: '点数表乙票', parentKey: '00' }, own: [3, 6], select: true },
  { label: '读票：缺票号（还没走到选后端）', tool: 'deck_issue_get', args: {}, own: [0, 0], select: false },
  { label: '读票：这张票读不回来', tool: 'deck_issue_get', args: { key: '999999' }, own: [1, 3], select: true },
  { label: '读票：成功、跳反向边', tool: 'deck_issue_get', args: { key: '01', blocking: false }, own: [1, 3], select: true },
  { label: '读票：成功、读全量关系（缺省）', tool: 'deck_issue_get', args: { key: '01' }, own: [2, 6], select: true },
  { label: '列票：成功（回多少行都一样）', tool: 'deck_issue_list', args: {}, own: [2, 5], select: true },
  { label: '看地图：成功、薄行也一样', tool: 'deck_map_snapshot', args: { key: '00', detail: 'thin' }, own: [2, 5], select: true },
  { label: '看地图：这张地图读不回来', tool: 'deck_map_snapshot', args: { key: '999999' }, own: [1, 3], select: true },
  { label: '建图：缺标题（还没走到选后端）', tool: 'deck_map_plan_create', args: {}, own: [0, 0], select: false },
  {
    label: '建图：成功（按估算：3 张票 + 2 条边）', tool: 'deck_map_plan_create', select: true, own: 'est',
    args: { planId: 'points-plan', title: '点数表地图', children: [{ key: 'a1', title: '子一' }, { key: 'a2', title: '子二' }], edges: [{ from: 'a2', to: 'a1', type: 'blocked-by' }] },
  },
  // 计划标识会原样当幂等键写进票面，字符集由后端定：中文会被后端挡下。
  // 这一支顺带钉住这条边界，以及它记账的价（1 条 / 4 点）。
  { label: '建图：计划标识带中文（后端挡下）', tool: 'deck_map_plan_create', args: { planId: '点数表图', title: '点数表地图', children: [{ key: 'c1', title: '子一' }] }, own: [1, 4], select: true },
  { label: '连边：两个都没给（还没走到选后端）', tool: 'deck_map_link', args: {}, own: [0, 0], select: false },
  { label: '连边：挂父子（按估算：1 条边 + 读一次）', tool: 'deck_map_link', args: { key: '02', parentKey: '00' }, own: 'est', select: true },
  { label: '连边：清空阻塞（按估算：没有边 + 读一次）', tool: 'deck_map_link', args: { key: '02', blockedBy: [] }, own: 'est', select: true },
  { label: '改票：缺票号（还没走到选后端）', tool: 'deck_issue_patch', args: {}, own: [0, 0], select: false },
  { label: '改票：成功（按估算：改一次 + 读一次）', tool: 'deck_issue_patch', args: { key: '02', comment: '点数表：改一下' }, own: 'est', select: true },
  { label: '上报：缺票号（还没走到选后端）', tool: 'deck_issue_report', args: {}, own: [0, 0], select: false },
  { label: '上报：成功', tool: 'deck_issue_report', args: { key: '02' }, own: [1, 3], select: true },
  { label: '上报：这张票不存在（同价）', tool: 'deck_issue_report', args: { key: '999999' }, own: [1, 3], select: true },
]

/**
 * 把一个对象节点压成一行可比较的摘要（表一就是拿它比的）。
 * 格式：`字段名:类型` 按定义里的书写顺序排（顺序也冻着——模型看到的就是这个顺序），
 * 类型里 数组 写 `数组<元素>`、对象写 `对象(子摘要)`、枚举写 `枚举(a|b)`；末尾接必填与多传两格。
 * 每个对象节点都必须显式写 additionalProperties:false，缺一个就红（多传即拒靠的就是它）。
 */
function shapeOf(node: any): string {
  const props = node && node.properties ? node.properties : {}
  const names = Object.keys(props)
  const parts = names.map((name) => name + ':' + typeOf(props[name]))
  const required = Array.isArray(node && node.required) ? node.required : []
  const ap = (node && Object.prototype.hasOwnProperty.call(node, 'additionalProperties')) ? String(node.additionalProperties) : '(缺)'
  return (parts.length ? parts.join(', ') + ' ' : '') + '必填=[' + required.join(',') + '] 多传=' + ap
}
function typeOf(node: any): string {
  const t = node && node.type
  if (t === 'array') return '数组<' + (node.items ? typeOf(node.items) : '(缺 items)') + '>'
  if (t === 'object') return '对象(' + shapeOf(node) + ')'
  if (Array.isArray(node && node.enum)) return '枚举(' + node.enum.join('|') + ')'
  return String(t)
}

/** 一个真实本地 Markdown 工作区（与 tests/verify-deck-tools.js 同一套做法：票就是盘上的 .md）。 */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-surface-'))
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
    root, rootPosix, issuesDir: path.join(dir, 'issues'),
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined } },
    ticketText(name: string) { return fs.readFileSync(path.join(dir, 'issues', name), 'utf8') },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('#1106 九个工具对外长什么样（参数表 / 信封表 / 点数表）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const decMod = await imp('src/tracker/detection/backendDecision.ts')

  // ── 组装：真闸 + 真账本 + 真注册表 + 真实本地 Markdown 后端 ──
  const ws = makeWorkspace()
  const clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  registry.bind(handle, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const planStore = (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(String(id)) || null }, save(id: string, s: unknown) { t.set(String(id), s) } } })()
  const deps = {
    gate, registry, budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx, handleFor: () => handle,
    decideBackend: decMod.decideBackend,
    log: { fire: () => {} },
    now: () => clock,
    invalidate: () => {},
    chainNote: async () => ({ recorded: true, action: 'report', ticketKey: '', reason: 'chain.record', count: 1 }),
    planStore,
  }
  const exec = { agent: { session: { id: 's-1106', cwd: ws.rootPosix } } }
  const tools: Record<string, any> = {}
  for (const [file, factory, name] of TOOL_FILES) tools[name] = (await imp(file))[factory](deps)

  const claimedNow = () => ({ requests: gate.stats().claimed.requests, points: gate.stats().claimed.points })
  const run = async (name: string, args: unknown) => {
    let r: any = null
    let threw = ''
    try { r = await tools[name].run(exec, args) } catch (e) { threw = String((e && (e as Error).message) || e) }
    return { r, threw }
  }

  // ── 一、参数表 ──
  console.log('— 一、参数表：九个定义的形状（参数名与顺序、必填、枚举、多传即拒）')
  for (const [, , name] of TOOL_FILES) {
    const got = shapeOf(tools[name].definition.parameters)
    const want = FROZEN_SHAPE[name]
    check(got === want, name + ' 的参数形状没动' + (got === want ? '' : '\n        冻着的：' + want + '\n        现在的：' + got))
  }
  {
    // 哪些格子有各自的说明、哪些没有，也是模型看到的样子的一部分，所以一并冻住。
    // 现在没有各自说明的是下面这十二个（数组本身有一句说明，条目里的字段没有）：这是本来就有的粗糙处，
    // 不在本票范围内，也不许在这里被悄悄改动 —— 变红说明模型看到的东西变了，得有人来看一眼再决定。
    const FROZEN_NO_DESC = [
      'deck_map_plan_create.children[].title', 'deck_map_plan_create.children[].body', 'deck_map_plan_create.children[].kind',
      'deck_map_plan_create.children[].labels', 'deck_map_plan_create.children[].assignees',
      'deck_map_plan_create.edges[].from', 'deck_map_plan_create.edges[].to', 'deck_map_plan_create.edges[].type',
      'deck_map_plan_create.labels',
      'deck_map_link.edges[].key', 'deck_map_link.edges[].parentKey', 'deck_map_link.edges[].blockedBy',
    ]
    const noDesc: string[] = []
    const walk = (node: any, where: string) => {
      const props = (node && node.properties) || {}
      for (const n of Object.keys(props)) {
        const p = props[n]
        if (typeof p.description !== 'string' || !p.description.trim()) noDesc.push(where + '.' + n)
        walk(p, where + '.' + n)
      }
      if (node && node.items) walk(node.items, where + '[]')
    }
    for (const [, , name] of TOOL_FILES) walk(tools[name].definition.parameters, name)
    const same = noDesc.join('、') === FROZEN_NO_DESC.join('、')
    check(same, '没有各自说明的参数还是那十二个' + (same ? '' : '\n        冻着的：' + FROZEN_NO_DESC.join('、') + '\n        现在的：' + noDesc.join('、')))
  }
  {
    // 多传即拒的机制在定义里：每个对象节点都显式写了 false（工具自己收到不认识的键时当没有）。
    const bad: string[] = []
    const walk = (node: any, where: string) => {
      if (node && node.type === 'object' && node.additionalProperties !== false) bad.push(where)
      const props = (node && node.properties) || {}
      for (const n of Object.keys(props)) walk(props[n], where + '.' + n)
      if (node && node.items) walk(node.items, where + '[]')
    }
    for (const [, , name] of TOOL_FILES) walk(tools[name].definition.parameters, name)
    check(bad.length === 0, '每个对象节点都显式写了 additionalProperties:false（漏的：' + (bad.length ? bad.join('、') : '一个都没有') + '）')
  }
  {
    // 装配顺序：宿主装配与展示都按它来。
    const orderMod = await imp('src/deck/rules/tool-order.ts')
    const want = TOOL_FILES.map((x) => x[2]).join(',')
    check(orderMod.DECK_TOOL_ORDER.join(',') === want, '九个工具的装配顺序冻着：' + want)
  }

  // 先按顺序建出后面要用的票：01 甲票、02 乙票（乙票挂在 00 地图下）。
  await run('deck_issue_create', { title: '信封表甲票', kind: 'task', body: '正文' })
  await run('deck_issue_create', { title: '信封表乙票', parentKey: '00' })

  // ── 二、信封表 ──
  console.log('— 二、信封表：两种形状、三态、七个原因码、失败不抛、记账数不外露')
  const representative: Array<[string, Record<string, unknown>]> = [
    ['deck_context', {}],
    ['deck_issue_get', { key: '01' }],
    ['deck_map_snapshot', { key: '00' }],
    ['deck_issue_list', { state: 'open' }],
    ['deck_issue_create', { title: '信封表丙票' }],
    ['deck_map_plan_create', { planId: 'surface-plan', title: '信封表地图', children: [{ key: 'b1', title: '子一' }] }],
    ['deck_map_link', { key: '02', parentKey: '00' }],
    ['deck_issue_patch', { key: '02', comment: '信封表：改一下' }],
    ['deck_issue_report', { key: '02' }],
  ]
  for (const [name, args] of representative) {
    const { r, threw } = await run(name, args)
    check(!threw && !!r && r.status === 'ok', name + ' 正例：回值且 ok（实得 ' + (threw || (r && r.status)) + '）')
    const keys = r && typeof r === 'object' ? Object.keys(r).sort() : []
    check(keys.join(',') === ENVELOPE_FULL.join(','), name + ' 回执正好 14 格，一格不多一格不少（实得 ' + keys.length + ' 格：' + keys.join(',') + '）')
    check(Object.prototype.hasOwnProperty.call(r, 'claimed') === false, name + ' 记账数不上信封（回执里没有 claimed）')
    check(!!(r && r.cost && r.cost.estimated && typeof r.cost.estimated.points === 'number' && typeof r.cost.estimated.requests === 'number'),
      name + ' 带回调用前的估算（' + JSON.stringify(r && r.cost && r.cost.estimated) + '）')
    check(!!(r && r.cost && r.cost.actual && typeof r.cost.actual.remaining === 'number'), name + ' 带回调用后的真实花费一格（' + JSON.stringify(r && r.cost && r.cost.actual) + '）')
  }
  {
    // 失败那一侧：还没走到选后端就失败的回执是 6 格；走到之后的失败回执是 14 格。别的形状一律算破。
    const shapes: Array<[string, Record<string, unknown>]> = [
      ['deck_issue_get', {}], ['deck_issue_create', {}], ['deck_map_snapshot', {}],
      ['deck_map_plan_create', {}], ['deck_map_link', {}], ['deck_issue_patch', {}], ['deck_issue_report', {}],
      ['deck_issue_get', { key: '999999' }], ['deck_map_snapshot', { key: '999999' }], ['deck_issue_report', { key: '999999' }],
    ]
    const unexpected: string[] = []
    const badReason: string[] = []
    for (const [name, args] of shapes) {
      const { r, threw } = await run(name, args)
      if (threw) { unexpected.push(name + ' 抛了：' + threw); continue }
      const keys = Object.keys(r || {}).sort().join(',')
      if (keys !== ENVELOPE_FULL.join(',') && keys !== ENVELOPE_PRE_GATE.join(',')) unexpected.push(name + ' 回执形状没见过的 ' + keys)
      if (!STATUSES.includes(r.status) || r.ok !== (r.status === 'ok')) unexpected.push(name + ' 三态不成形：' + JSON.stringify({ status: r.status, ok: r.ok }))
      if (r.status !== 'ok' && !REASONS.includes(r.reason)) badReason.push(name + ' 原因码不认识：' + r.reason)
      if (r.status === 'ok' && r.reason !== '') badReason.push(name + ' 成功了却带原因码：' + r.reason)
    }
    check(unexpected.length === 0, '失败也回值、回执只有两种形状、三态自洽' + (unexpected.length ? '：' + unexpected.join('；') : ''))
    check(badReason.length === 0, '失败的原因码都在七个码里（' + (badReason.length ? badReason.join('；') : '零例外') + '）')
  }
  {
    // 稀奇古怪的参数形状：一律回值，一支都不许抛（抛出去 AI 会退回去用 gh，两条写路径同时开火）。
    const hostiles: unknown[] = [undefined, null, 42, '字符串', [], { key: {} }]
    const threwList: string[] = []
    let seen = 0
    for (const [, , name] of TOOL_FILES) {
      for (const bad of hostiles) {
        const { r, threw } = await run(name, bad)
        seen += 1
        if (threw) threwList.push(name + '(' + JSON.stringify(bad) + ')：' + threw)
        else if (!r || typeof r !== 'object' || !STATUSES.includes(r.status)) threwList.push(name + '(' + JSON.stringify(bad) + ') 没回三态回执')
      }
    }
    check(threwList.length === 0, '九个工具 × ' + hostiles.length + ' 种怪参数（共 ' + seen + ' 次）都回值不抛' + (threwList.length ? '：' + threwList.join('；') : ''))
  }

  // ── 三、点数表 ──
  console.log('— 三、点数表：每一支调用在闸上记多少条、多少点')
  {
    const limits = { maxPointsPerCall: 600, maxRequestsPerCall: 400, maxPointsPerHour: 2000, maxRequestsPerHour: 1500, maxChildTicketsPerCall: 60, usedPointsThisHour: 0, usedRequestsThisHour: 0 }
    for (const row of POINTS) {
      const before = claimedNow()
      const { r, threw } = await run(row.tool, row.args)
      const after = claimedNow()
      const delta = { requests: after.requests - before.requests, points: after.points - before.points }
      let own: [number, number]
      if (row.own === 'est') {
        const est = toolCost.estimateToolCost(toolCost.toolCostInputFrom(row.tool, row.args), limits)
        own = [est.requests, est.points]
      } else own = row.own
      const want = { requests: own[0] + (row.select ? 1 : 0), points: own[1] }
      const ok = !threw && delta.requests === want.requests && delta.points === want.points
      check(ok, row.label + '：这一笔记 ' + want.requests + ' 条 / ' + want.points + ' 点（实得 ' + delta.requests + ' / ' + delta.points + (threw ? '，抛了 ' + threw : '，状态 ' + (r && r.status)) + '）')
    }
  }
  {
    // 后端说「做不到」那一支（票面点名的缝：工具表工厂的依赖参数）。本地房间不会这样失败，所以另挂一个后端。
    const refusing = {
      id: 'refuse-1106', label: '会说做不到的后端', matches: async () => false,
      create: () => ({
        id: 'refuse-1106',
        async list() { return { ok: false, error: { kind: 'unsupported', message: '这次故意说做不到（门禁探针）' } } },
        async create() { return { ok: false, error: { kind: 'unsupported', message: '这次故意说做不到（门禁探针）' } } },
      }),
    }
    const dispose = registry.register(refusing)
    registry.bind(handle, 'refuse-1106')
    try {
      const before = claimedNow()
      const listed = await run('deck_issue_list', { state: 'open' })
      const afterList = claimedNow()
      check(listed.r && listed.r.status === 'unsupported' && listed.r.reason === 'backend-unsupported',
        '后端说做不到：列表这一支回 unsupported + backend-unsupported（实得 ' + (listed.r && listed.r.status) + '/' + (listed.r && listed.r.reason) + '）')
      check(afterList.requests - before.requests === 2 && afterList.points - before.points === 3,
        '后端说做不到：列表这一笔记 2 条 / 3 点（实得 ' + (afterList.requests - before.requests) + ' / ' + (afterList.points - before.points) + '）')
      const beforeCreate = claimedNow()
      const created = await run('deck_issue_create', { title: '后端说建不成的那一张' })
      const afterCreate = claimedNow()
      check(created.r && created.r.status === 'unsupported' && created.r.reason === 'backend-unsupported',
        '后端说做不到：建票这一支回 unsupported + backend-unsupported（实得 ' + (created.r && created.r.status) + '/' + (created.r && created.r.reason) + '）')
      check(afterCreate.requests - beforeCreate.requests === 2 && afterCreate.points - beforeCreate.points === 4,
        '后端说做不到：建票这一笔记 2 条 / 4 点（实得 ' + (afterCreate.requests - beforeCreate.requests) + ' / ' + (afterCreate.points - beforeCreate.points) + '）')
    } finally { dispose.dispose(); registry.bind(handle, 'markdown') }
  }

  {
    // 同一份计划标识同时在两次执行里跑：先到的那次上锁，后到的那次在碰后端之前就被挡下，一分钱不记。
    // 这一支写着「计划标识正被别的执行占用」，平常跑不出来，所以这里并发叫两次把它逼出来。
    const raceArgs = { planId: 'race-plan', title: '并发地图', children: [{ key: 'r1', title: '唯一子票' }] }
    const before = claimedNow()
    const [one, two] = await Promise.all([run('deck_map_plan_create', raceArgs), run('deck_map_plan_create', raceArgs)])
    const after = claimedNow()
    const refused = [one, two].filter((x) => !x.threw && x.r && x.r.status === 'unsupported' && x.r.reason === 'backend-unsupported')
    const succeeded = [one, two].filter((x) => !x.threw && x.r && x.r.status === 'ok')
    const delta = { requests: after.requests - before.requests, points: after.points - before.points }
    check(refused.length === 1 && succeeded.length === 1,
      '同一个计划标识并发叫两次：恰好一次被挡下、一次做成（挡下 ' + refused.length + ' 次、做成 ' + succeeded.length + ' 次）')
    check(refused.length === 1 && refused[0].r && Object.keys(refused[0].r).length === ENVELOPE_PRE_GATE.length,
      '被挡下的那一次回的是「还没走到选后端」的那种形状（' + (refused[0] && refused[0].r ? Object.keys(refused[0].r).length : '?') + ' 格）')
    check(delta.requests === 8 && delta.points === 13,
      '并发这一次只记做成的那一笔（1 张地图 + 1 张子票 + 1 条父子边 + 选后端 1 条 = 8 条 / 13 点），被挡下的不记（实得 ' + delta.requests + ' 条 / ' + delta.points + ' 点）')
  }

  // ── 四、越界判据 ──
  console.log('— 四、越界：工具层不许出现直连外面的写法')
  {
    // 每一条都配一个「必须命中」的例子与一个「不许误伤」的反例：表里任何一条写错，它就成了一条永不命中的死条目，
    // 而外面那条断言只会更绿 —— 这正是假门禁的典型形状，所以每条都要当场证明自己是活的。
    const PATTERNS: Array<{ re: RegExp, label: string, hit: string, miss: string }> = [
      { re: /child_process/, label: '起进程', hit: "require('child_process')", miss: 'const childProcessName = 1' },
      { re: /\bfetch\s*\(/, label: '联网', hit: "fetch('https://x')", miss: 'const fetchLabel = 1' },
      { re: /process\.(env|argv|pid|platform)/, label: '读环境', hit: 'process.env.HOME', miss: 'const processed = 1' },
      { re: /require\s*\(/, label: '旧式取模块', hit: "require('node:fs')", miss: 'const requiredField = 1' },
      { re: /from\s+['"]node:/, label: '取 Node 能力', hit: "import fs from 'node:fs'", miss: "import x from './x.js'" },
      { re: /fs\.(readFile|writeFile|readdir)/, label: '读写文件', hit: 'fs.readFile(p)', miss: 'const fsLike = 1' },
      { re: /\bgh\s+(issue|api|pr|repo)\b/, label: '走命令行 gh', hit: "const cmd = 'gh issue view 1106'", miss: "const ghName = 'gh'" },
      { re: /\beval\s*\(/, label: '动态求值', hit: "eval('1')", miss: 'const evaluate = 1' },
      { re: /new\s+Function\s*\(/, label: '动态构造函数', hit: "new Function('return 1')", miss: 'const funcFactory = 1' },
    ]
    for (const p of PATTERNS) {
      check(p.re.test(p.hit), '越界写法表里这条真的会命中：' + p.label + '（' + p.hit + '）')
      check(!p.re.test(p.miss), '越界写法表里这条不误伤正常写法：' + p.label + '（' + p.miss + '）')
    }
    // 时间这一类单独判，不能一禁了之：票面的可动清单里，超时钳制与「测试里可换的时钟缺省」是点过名允许的，
    // 九份工具都各写了一份。真正要拦的是拿它们去读真实时间做业务判断。所以规则是「栏行 + 同行必须还有另一半」：
    //   时钟缺省：这一行出现 Date.now / new Date 时，同行必须写着 typeof d.now === 'function'；
    //   超时钳制：这一行出现 setTimeout 时，同行必须写着 Promise（那支超时竞赛）。
    // 判每一行而不是整份文件，是因为这两件事本来就写在同一行里，按行判才能同时抓住两种情形。
    const ALLOWED: Array<{ label: string, line: RegExp, mustAlso: RegExp, hit: string, miss: string }> = [
      {
        label: '时钟缺省', line: /Date\.now|new\s+Date\s*\(/, mustAlso: /typeof d\.now === 'function'/,
        hit: 'const t = Date.now()', miss: "now: (typeof d.now === 'function') ? d.now : Date.now",
      },
      {
        label: '超时钳制', line: /setTimeout\s*\(/, mustAlso: /Promise/,
        hit: 'setTimeout(f, 1)', miss: 'new Promise(function (r) { setTimeout(function () { r(1) }, 1) })',
      },
    ]
    for (const a of ALLOWED) {
      check(a.line.test(a.hit) && !a.mustAlso.test(a.hit), '允许形状表：' + a.label + ' 的越界写法真会被抓到（' + a.hit + '）')
      check(!(a.line.test(a.miss) && !a.mustAlso.test(a.miss)), '允许形状表：' + a.label + ' 的正常写法不误伤（' + a.miss + '）')
    }
    const dir = path.join(ROOT, 'src', 'deck', 'tools')
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.ts')).sort()
    // 工具层就是这十份：九份工具 + 顺序表的宿主侧门面。门面（tool-order.ts）只转发一行，
    // 本体在 src/deck/rules/tool-order.ts，跟装表住同一层。多一份少一份都该有人看一眼。
    const EXPECTED_FILES = ['context.ts', 'issue-create.ts', 'issue-get.ts', 'issue-list.ts', 'issue-patch.ts', 'issue-report.ts', 'map-link.ts', 'map-plan-create.ts', 'map-snapshot.ts', 'tool-order.ts'].sort()
    check(names.join(',') === EXPECTED_FILES.join(','), '工具层是九份工具 + 顺序表门面这十份（实际 ' + names.join(',') + '）')
    const bad: string[] = []
    let sawClock = 0
    let sawTimer = 0
    for (const name of names) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      // 注释里会讲清为什么不许用这些写法，所以先把注释剔掉再扫。
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      for (const line of code.split('\n')) {
        for (const p of PATTERNS) if (p.re.test(line)) bad.push(name + '：' + p.label + '（' + line.trim().slice(0, 60) + '）')
        for (const a of ALLOWED) {
          if (!a.line.test(line)) continue
          if (a.label === '时钟缺省') sawClock += 1
          else sawTimer += 1
          if (!a.mustAlso.test(line)) bad.push(name + '：' + a.label + '写成了不许的样子（' + line.trim().slice(0, 80) + '）')
        }
      }
    }
    check(bad.length === 0, bad.length
      ? '工具层有直连外面的写法：' + bad.join('；')
      : '十份文件里没有起进程、联网、走 gh、读环境、旧式取模块、取 Node 能力、读写文件、动态求值的写法；时间只用在票面点名的两种形状上')
    check(sawClock > 0 && sawTimer > 0, '允许形状表在真实文件上确实被走到（时钟缺省 ' + sawClock + ' 处、超时钳制 ' + sawTimer + ' 处），这套判据不是空转')
  }

  ws.cleanup()
  console.log('共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  // 显式收工，同 tests/verify-deck-tools.js 与金标准回执那两扇。原因是本门禁真的走调用链：
  // 主逻辑 215 毫秒就跑完，之后进程还挂着几个「超时钳制」留下的定时器，最晚的约 60 秒才到 ——
  // 不写这一句，门禁会白等一分钟（量过：整进程 60.3 秒）。
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('  FAIL 异常：' + ((e && e.stack) || e)); process.exit(1) })
