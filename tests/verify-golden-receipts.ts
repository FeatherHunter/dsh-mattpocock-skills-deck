// tests/verify-golden-receipts.ts —— 金标准回执夹具的比对命令（#1015，硬化版）。
//
// 目的：把「行为零变化」从口头承诺变成机器判据。
// 做法：用固定的本地 Markdown 工作区、固定的会话、固定的时钟，
//   把九个 deck 工具各调一次代表性调用，归一化后与基准逐字节比对。
//   差一个字符就报错（exit 1），全等才过（exit 0）。
//
// 用法（自挂钩子，裸跑即正确，不需要命令行再挂一遍）：
//   node tests/verify-golden-receipts.ts            # 比对（只读基准，不写盘）
//   node tests/verify-golden-receipts.ts --update   # 重建基准（只在有意改行为且已评审时用）
//
// 自挂钩子：本文件启动第一件事就是导入 scripts/ts-hook.mjs（与生产线 npm test
//   挂的是同一个钩子）。此后一切产品模块导入都走同一解析路径：同名 .ts 存在
//   就量 .ts，不存在就量 .js——混存期量不错文件。外加解析自证：每个模块记录
//   实际解析到了谁；若磁盘上有 .ts 兄弟却解析到 .js，说明钩子没生效，直接
//   报错退出（含糊时宁可红，不要绿）。
//
// 归一化口径（基准里看不到的东西，只有三样；其余一个字符都不放过）：
//   1. 绝对路径：本次运行的工作区根一律换成 <ROOT>（posix 与反斜杠两种写法都换）。
//   2. 工作区钥匙：本次运行的精确钥匙值换成 <WSKEY>（它由工作区根算出来，根变它就变）。
//      注意：不用通配正则——通配会把票正文里恰好长得像钥匙的内容也抹掉，那是假绿。
//   3. 时间戳：ISO 时刻（Z 结尾，形如 20xx-xx-xxTxx:xx:xx(.xxx)Z）一律换成 <TIME>
//      （文件修改时间是墙上时钟，两次运行必然不一样）。非 Z 形式的时刻若出现，
//      让它红（红比悄悄抹掉对），再按需把新形状列进来。
//   约束：金标准演示票的标题、正文、评论里不许出现日期样子的字符串，否则归一化
//     会把它当时间戳抹掉（目前的内容没有，改输入时注意）。
//   固定时钟（1700000000000）让幂等锚的时间窗口号固定，锚本身是确定性的；
//   固定会话（s-golden）让会话号稳定，它出现在回执里但每次都一样，故不归一化。
//
// 键排序：比对前对象键递归排序（JSON 键顺序永不承载语义，排了之后重构式改动
//   不再误红）。数组顺序不动——列表类输出本来就按 key 排过（确定性），只有
//   按修改时间倒序的那一处是跨机器远虑，记成已知约束，不在此处理。
//
// 两房形状（同一次调用在两房下的回执形状）：
//   九个工具的基准跑在本地 Markdown 房（离线、确定性）。
//   GitHub 房要联网，不进逐字节比对；它与 Markdown 房的形状对照记在
//   tests/tracker-contract/fixtures/golden-receipts/two-room-shape.golden.json，
//   断言只看字段形状与已知差异，不看具体值。
//   已知缺口（不是疏漏，是离线量尺的原理边界）：GitHub 房特有的回执措辞
//   （evidence 文案、landing 落点描述）只有真机联网能走到，playback 固件守的
//   是后端契约层的形状，不是这九个工具在 GitHub 房里的回执原文。
//
// 守卫边界（本夹具不是全部）：每个工具一次最小调用，只守快乐路径回执；
//   错误分支与集成级错误包络由 tests/verify-deck-tools.js 的 86 条守着，
//   后端契约由 tests/verify-tracker-contract.js 守着。夹具绿不等于行为全等，
//   夹具红则一定是有东西变了（表示抖动或真漂移，按分拣指南看）。
//
// 分拣指南（红了先看这里）：cost.actual.remaining 是具名常量
//  （src/shared/refresh/budget.js 的 PLUGIN_HOURLY_CAP），变了先看是不是调过配额；
//   <TIME> 与 <ROOT> 与 <WSKEY> 不可能出现在差异里（已归一），若出现说明归一化漏了形状；
//   其余差异逐个看：键少了/多了是真漂移，值变了是真漂移（键已排序，不会再有纯顺序差异）。
//
// 与讨论结论的衔接（#1014 Q1/Q5、规格单 #1098）：
//   Q1 活样板：本夹具就是它的量尺（改一行三关都会看见，夹具守住回执不变）。
//   Q5 闭包拼接顺序：手写有序清单仍在，改顺序会改构建产物；
//     本夹具守的是工具回执层，拼接顺序的量尺由构建产物守，两层分工不同，不互相替代。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix as posixPath, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// 夹具口（写法见 tests/lib/deck-decide-stub.js 开头）：#1138 起「用户选过哪个后端」只剩工作区文件里
// 那一条记录（docs/agents/workspace.yaml），注册表上那层 bind 已经整段删掉。下面用内存账本
// chooseWorkspace 顶替工作区文件、用真人选出口的夹具 makeDecideStub 顶替生产出口，
// 工具读到的就还是「这个工作区用户亲手选过 markdown」，基准收据里的 explicit 才立得住。
import { chooseWorkspace, makeDecideStub } from './lib/deck-decide-stub.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GOLDEN_DIR = join(ROOT, 'tests', 'tracker-contract', 'fixtures', 'golden-receipts')

// 固定输入：改这里的任何一个字，基准都要重建（--update）。
const SESSION_ID = 's-golden'
const CLOCK = 1700000000000
const MAP_MD = '# 金标准底图\n\nStatus: ready-for-agent\n\n## Destination\n\n金标准演示用底图\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n'

type GoldenCall = { file: string, tool: string, args: Record<string, unknown> }
const CALLS: GoldenCall[] = [
  { file: '01-deck_context.golden.json', tool: 'deck_context', args: {} },
  { file: '02-deck_issue_create.golden.json', tool: 'deck_issue_create', args: { title: '金标准演示票', kind: 'task', body: '正文' } },
  { file: '03-deck_issue_list.golden.json', tool: 'deck_issue_list', args: { state: 'open' } },
  // get 的 key 依赖 create 的结果（固定为 01），snapshot 的 key 固定为 00（底图）。
  { file: '04-deck_issue_get.golden.json', tool: 'deck_issue_get', args: { key: '01', blocking: false } },
  { file: '05-deck_map_snapshot.golden.json', tool: 'deck_map_snapshot', args: { key: '00' } },
  { file: '06-deck_map_plan_create.golden.json', tool: 'deck_map_plan_create', args: { planId: 'golden-1', title: '金标准地图', children: [{ key: 'a1', title: '金子票一' }, { key: 'a2', title: '金子票二' }], edges: [] } },
  // link 的两张子票 key 依赖 plan 的结果（固定为 04 blockedBy 03）。
  { file: '07-deck_map_link.golden.json', tool: 'deck_map_link', args: { key: '04', blockedBy: ['03'] } },
  { file: '08-deck_issue_patch.golden.json', tool: 'deck_issue_patch', args: { key: '01', comment: '金标准评论' } },
  { file: '09-deck_issue_report.golden.json', tool: 'deck_issue_report', args: { key: '01', note: '金标准上报' } },
]

function resolveSpec(spec: string): string {
  const meta = import.meta as unknown as { resolve: (s: string) => string }
  return meta.resolve(spec)
}

type LoadInfo = { spec: string, url: string, viaTs: boolean }
const loadedModules: LoadInfo[] = []

// 经钩子解析后再导入：量到的与自证的是同一个东西。
// 自证（tripwire）：说明符要的是 .js、磁盘上有 .ts 兄弟、解析却给了 .js——
// 说明钩子没生效，直接报错退出。含糊时宁可红，不要绿。
async function loadModule(spec: string): Promise<unknown> {
  const url = resolveSpec(spec)
  const viaTs = url.endsWith('.ts')
  if (spec.endsWith('.js') && !viaTs && url.startsWith('file:')) {
    const targetPath = fileURLToPath(url)
    const sibling = targetPath.slice(0, -'.js'.length) + '.ts'
    if (existsSync(sibling)) {
      throw new Error(`[golden] 钩子疑似未生效：${spec} 有 .ts 兄弟却解析到 .js（${url}）。含糊时宁可红，已中止。`)
    }
  }
  loadedModules.push({ spec, url, viaTs })
  return import(url)
}

function normalize(value: unknown, rootPosix: string, rootWin: string, wsKey: string): unknown {
  const isoRe = /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let s = v
      if (rootPosix) s = s.split(rootPosix).join('<ROOT>')
      if (rootWin && rootWin !== rootPosix) s = s.split(rootWin).join('<ROOT>')
      if (wsKey) s = s.split(wsKey).join('<WSKEY>')
      s = s.replace(isoRe, '<TIME>')
      return s
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>)) o[k] = walk((v as Record<string, unknown>)[k])
      return o
    }
    return v
  }
  return walk(value)
}

// 键递归排序：JSON 键顺序永不承载语义，排了之后重构式改动不再误红。
// 数组顺序不动（列表输出本来就按 key 排过，是确定性的）。
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = sortKeys((v as Record<string, unknown>)[k])
    }
    return o
  }
  return v
}

function canonStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + '\n'
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i
  }
  return a.length === b.length ? -1 : n
}

async function buildReceipts(): Promise<{ raw: Record<string, unknown>, rootPosix: string, rootWin: string, wsKey: string, cleanup: () => void }> {
  // 自挂钩子：与生产线挂的是同一个钩子，此后一切产品模块导入都走同一解析路径。
  // 必须是第一件事——它之前的产品导入不受钩子管（本文件之前只有 node: 内建导入，不受影响）。
  await import('../scripts/ts-hook.mjs')

  const budget = await loadModule('../src/shared/refresh/budget.js') as Record<string, (...a: never[]) => unknown>
  const ledgerMod = await loadModule('../src/host/refresh/ledger.ts') as Record<string, (...a: never[]) => unknown>
  const gateMod = await loadModule('../src/host/refresh/gate.ts') as Record<string, (...a: never[]) => unknown>
  const registryMod = await loadModule('../src/tracker/registry/core.ts') as Record<string, (...a: never[]) => unknown>
  const markdownModule = ((await loadModule('../src/tracker/rooms/markdown/index.ts')) as { markdownModule: unknown }).markdownModule
  const toolCost = await loadModule('../src/shared/refresh/tool-cost.js') as Record<string, (...a: never[]) => unknown>

  const TOOL_FILES: Record<string, [string, string]> = {
    deck_context: ['../src/deck/tools/context.ts', 'createDeckContext'],
    deck_issue_get: ['../src/deck/tools/issue-get.ts', 'createDeckIssueGet'],
    deck_map_snapshot: ['../src/deck/tools/map-snapshot.ts', 'createDeckMapSnapshot'],
    deck_issue_list: ['../src/deck/tools/issue-list.ts', 'createDeckIssueList'],
    deck_issue_create: ['../src/deck/tools/issue-create.ts', 'createDeckIssueCreate'],
    deck_map_plan_create: ['../src/deck/tools/map-plan-create.ts', 'createDeckMapPlanCreate'],
    deck_map_link: ['../src/deck/tools/map-link.ts', 'createDeckMapLink'],
    deck_issue_patch: ['../src/deck/tools/issue-patch.ts', 'createDeckIssuePatch'],
    deck_issue_report: ['../src/deck/tools/issue-report.ts', 'createDeckIssueReport'],
  }

  const posixSep = (p: string): string => String(p).replace(/\\/g, '/')
  const root = mkdtempSync(join(tmpdir(), 'golden-'))
  const dir = join(root, '.scratch', 'demo')
  mkdirSync(join(dir, 'issues'), { recursive: true })
  writeFileSync(join(dir, 'map.md'), MAP_MD, 'utf8')
  const plat = {
    path: posixPath,
    fs: {
      async resolve(p: string): Promise<string> { return posixSep(p) },
      async readText(t: string): Promise<string> { return readFileSync(t, 'utf8') },
      async writeText(t: string, c: string): Promise<void> { mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, c, 'utf8') },
      async lstat(t: string): Promise<unknown> { try { return statSync(t) } catch { return null } },
      async listDir(t: string): Promise<unknown> { try { return readdirSync(t) } catch { return [] } },
      async stat(t: string): Promise<unknown> { try { return statSync(t) } catch { return null } },
    },
  }
  const rootPosix = posixSep(root)
  const rootWin = root
  const wsCtx = { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string): unknown { return name === 'fs' ? plat.fs : undefined } }
  const clock = CLOCK
  const ledger = (ledgerMod.createLedger as unknown as (o: { now: () => number }) => { syncServer: (q: unknown, n: number) => void })({ now: () => clock })
  const gate = (gateMod.createGate as unknown as (o: { ledger: unknown, now: () => number }) => unknown)({ ledger, now: () => clock })
  const registry = (registryMod.createRegistry as unknown as (ctx: unknown, o: { matchesTimeout: number }) => {
    register: (m: unknown) => { dispose: () => void },
  })(Object.assign({ logEvent: () => {}, isEnabled: () => false }, wsCtx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: rootPosix, refId: '.scratch/demo' }
  // #1138：把「用户选过 markdown」写进夹具账本（等价于工作区文件里那一行）。原来这里是
  // registry.bind(handle, 'markdown')，绑定层已随 #1138 整段删掉。
  chooseWorkspace(rootPosix, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const deps = {
    gate, registry, budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: wsCtx, handleFor: () => handle,
    decideBackend: makeDecideStub(registry),
    log: { fire: () => {} },
    now: () => clock,
    invalidate: () => {},
    chainNote: async (input: { ticketKey?: unknown }) => ({ recorded: true, action: 'report', ticketKey: String(input.ticketKey || ''), reason: 'chain.record', count: 1 }),
    planStore: (() => { const table = new Map<string, unknown>(); return { durable: true, load(id: string): unknown { return table.get(String(id)) || null }, save(id: string, s: unknown): void { table.set(String(id), s) } } })(),
  }
  const exec = { agent: { session: { id: SESSION_ID, cwd: rootPosix } } }
  const tools: Record<string, { run: (e: unknown, a: unknown) => Promise<unknown> }> = {}
  for (const name of Object.keys(TOOL_FILES)) {
    const [file, factory] = TOOL_FILES[name]
    const mod = await loadModule(file) as Record<string, (d: unknown) => { run: (e: unknown, a: unknown) => Promise<unknown> }>
    tools[name] = mod[factory](deps)
  }
  // 按 CALLS 的顺序依次调用（写操作有先后，顺序即基准的一部分）。
  const raw: Record<string, unknown> = {}
  for (const c of CALLS) {
    raw[c.tool] = await tools[c.tool].run(exec, c.args)
  }
  // 工作区钥匙由根算出来，读出来再归一（根变它就变，但归一后稳定）。
  const ctxOut = raw.deck_context as { workspace?: { key?: string } }
  const wsKey = (ctxOut && ctxOut.workspace && ctxOut.workspace.key) || ''
  const cleanup = () => { try { rmSync(root, { recursive: true, force: true }) } catch { /* 忽略 */ } try { dispose.dispose() } catch { /* 忽略 */ } }
  return { raw, rootPosix, rootWin, wsKey, cleanup }
}

async function buildTwoRoomShape(): Promise<Record<string, unknown>> {
  // 离线形状对照：同一张最小票在两房 normalize 之后的字段清单。
  // 不比值，只比「有哪些字段」与「已知差异」——联网的 GitHub 真值由 playback 固件守。
  const mdNorm = ((await loadModule('../src/tracker/rooms/markdown/normalize.ts')) as { normalizeIssue: (body: string, meta: unknown) => Record<string, unknown> }).normalizeIssue
  const ghNorm = ((await loadModule('../src/tracker/rooms/github/normalize.ts')) as { normalizeIssue: (raw: unknown) => Record<string, unknown> }).normalizeIssue
  const md = mdNorm('# 对照票\n\nStatus: ready-for-agent\nType: task\nBlocked by:\n\n## Comments\n', { key: '01', parentKey: '00', isMap: false, createdAt: '', updatedAt: '' })
  const gh = ghNorm({
    number: 1, title: '对照票', state: 'open', body: '', url: '',
    createdAt: '', updatedAt: '', closedAt: null,
    author: { login: 'a' }, assignees: { nodes: [] }, labels: { nodes: [] },
    milestone: null, comments: { nodes: [] }, parent: null, blockedBy: { nodes: [] },
  })
  const mdFields = Object.keys(md).sort()
  const ghFields = Object.keys(gh).sort()
  const common = mdFields.filter((f) => ghFields.indexOf(f) >= 0)
  return {
    // 这份对照只记形状，不记值；值由九个工具的基准守。
    markdownFields: mdFields,
    githubFields: ghFields,
    commonCore: common,
    knownDiffs: [
      'assignees：Markdown 房无认领人时给空数组（EMPTY），GitHub 房按远端节点归一；两房都不许省略该字段之外的核心字段。',
      'labels：两房每项都是 {name,color}，颜色缺省为空字符串；色值语义由标签配色契约另守。',
      'milestone：Markdown 房没有该字段（MISSING），GitHub 房按远端有无给值或空；能力差异如实标注，不算行为漂移。',
      'comments：两房都有数组，作者形状按各自后端归一；时间戳归一化后不进比对。',
    ],
  }
}

async function main(): Promise<void> {
  const update = process.argv.indexOf('--update') >= 0
  console.log('金标准回执夹具（#1015）：' + (update ? '重建基准' : '逐字节比对'))
  const { raw, rootPosix, rootWin, wsKey, cleanup } = await buildReceipts()
  const viaTs = loadedModules.filter((m) => m.viaTs).length
  console.log(`  解析：${loadedModules.length} 个模块经钩子解析，其中 ${viaTs} 个走.ts、${loadedModules.length - viaTs} 个走.js。`)
  let failed = false
  let total = 0
  let changed = 0
  const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
  try {
    for (const c of CALLS) {
      const norm = normalize(raw[c.tool], rootPosix, rootWin, wsKey)
      const text = canonStringify(norm)
      const p = join(GOLDEN_DIR, c.file)
      if (update) {
        mkdirSync(GOLDEN_DIR, { recursive: true })
        const existed = existsSync(p)
        const old = existed ? readFileSync(p, 'utf8') : null
        writeFileSync(p, text, 'utf8')
        if (old === null) {
          check(true, c.tool + ' 基准已写入 ' + relative(ROOT, p) + '（' + text.length + ' 字，新建）')
        } else if (old === text) {
          check(true, c.tool + ' 基准不变 ' + relative(ROOT, p) + '（' + text.length + ' 字）')
        } else {
          changed += 1
          const at = firstDiff(old, text)
          check(true, c.tool + ' 基准已更新 ' + relative(ROOT, p) + '（旧 ' + old.length + ' 字→新 ' + text.length + ' 字，首个差异在第 ' + at + ' 个字符）')
        }
      } else {
        if (!existsSync(p)) {
          check(false, c.tool + ' 缺基准文件：' + relative(ROOT, p) + '（先跑 --update 建一次）')
          continue
        }
        const want = readFileSync(p, 'utf8')
        if (want === text) {
          check(true, c.tool + ' 逐字节一致（' + text.length + ' 字）')
        } else {
          const at = firstDiff(want, text)
          const win = 80
          const wSnip = JSON.stringify(want.slice(Math.max(0, at - win), at + win))
          const gSnip = JSON.stringify(text.slice(Math.max(0, at - win), at + win))
          check(false, c.tool + ' 差字符：第 ' + at + ' 个字符起不一致（基准 ' + want.length + ' 字、实测 ' + text.length + ' 字）。基准片段 ' + wSnip + '；实测片段 ' + gSnip)
        }
      }
    }
    // 两房形状对照：同样逐字节比对（形状变了就是行为变了）。
    const shape = await buildTwoRoomShape()
    const shapeText = canonStringify(shape)
    const shapeFile = 'two-room-shape.golden.json'
    const shapePath = join(GOLDEN_DIR, shapeFile)
    if (update) {
      mkdirSync(GOLDEN_DIR, { recursive: true })
      const old = existsSync(shapePath) ? readFileSync(shapePath, 'utf8') : null
      writeFileSync(shapePath, shapeText, 'utf8')
      if (old === shapeText) check(true, 'two-room-shape 基准不变（' + shapeText.length + ' 字）')
      else {
        changed += 1
        check(true, 'two-room-shape 基准已更新（' + shapeText.length + ' 字' + (old === null ? '，新建' : '，内容有变') + '）')
      }
    } else {
      if (!existsSync(shapePath)) {
        check(false, '缺形状基准：' + relative(ROOT, shapePath))
      } else {
        const want = readFileSync(shapePath, 'utf8')
        if (want === shapeText) check(true, 'two-room-shape 逐字节一致（' + shapeText.length + ' 字）')
        else {
          const at = firstDiff(want, shapeText)
          check(false, 'two-room-shape 差字符：第 ' + at + ' 个字符起不一致')
        }
      }
    }
  } finally {
    cleanup()
  }
  if (update) console.log(`\n重建完成：${changed} 个文件内容有变（有意改行为且已评审才可提交），其余不变。`)
  console.log('\n' + (failed ? '存在失败（差一个字符即红）' : '全部通过 — 九个工具回执逐字节一致（' + total + ' 项）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: unknown) => { console.error('金标准比对执行异常：' + (((e as Error) && (e as Error).stack) || e)); process.exit(1) })
