// tests/verify-1403-kind-two-layer.ts —— #1403 T2：建票参数换成两层词表（kind 六值 + 地图工单的 label）
// 门禁归属: src/deck/tools/issue-create.ts
// 门禁归属: src/deck/rules/object-kind.ts
// 门禁归属: src/tracker/rooms/markdown/issues-create.ts
// 门禁归属: src/tracker/rooms/markdown/parse.ts
//
// 这份门禁只回答一个问题：建票的六个位置值，落到真实本地 Markdown 后端上，是不是真的按位置表那样落盘、
// 读回来是不是还认得出？给人读的口径在规格 #1403 与工具说明里，这里给机器盯。
//
// 用真闸 + 真账本 + 真注册表 + 本地 Markdown 房间（与 verify-1106 同一套夹具写法）：
//   一、六个位置各建一张，逐项核对盘上的类型标签、正文文件头标记、## 进度、Type 行、父子注释；
//   二、四个 wayfinder label 各建一张地图工单，核对 Type 行就是去前缀的那一个；
//   三、兜底 issue 原样收任何标签（包括类型标签）；
//   四、读回来：带 wayfinder:map 标签的新地图票仍读成地图（parse 的判定顺序），地图工单读得到父票；
//   五、拒绝例：缺 kind、旧值、label 误用、父票错配等，全部在碰后端之前挡下，回执点明合法值与迁移路径。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1403-kind-two-layer.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chooseWorkspace, makeDecideStub } from './lib/deck-decide-stub.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-two-layer-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  // 这里不再预写 map.md：这一段要用 deck_issue_create 建一张地图（handle 的 refId 指着 demo），
  // 原文布局一个目录只允许一份 map.md；预写的占位会让建图如实拒绝（旧扁平布局地图是普通编号票，才不冲突）。
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
    root, rootPosix, issuesDir: path.join(dir, 'issues'), mapFile: path.join(dir, 'map.md'),
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('#1403 两层词表：六个位置值建票、落盘、读回与拒绝例')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')

  const ws = makeWorkspace()
  const clock = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => clock })
  const gate = gateMod.createGate({ ledger, now: () => clock })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix, refId: '.scratch/demo' }
  chooseWorkspace(ws.rootPosix, 'markdown')
  // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const planStore = (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(String(id)) || null }, save(id: string, s: unknown) { t.set(String(id), s) } } })()
  const deps = {
    gate, registry, budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx, handleFor: () => handle,
    decideBackend: makeDecideStub(registry),
    log: { fire: () => {} },
    now: () => clock,
    invalidate: () => {},
    workRouteNote: async () => null,
    workRouteRead: () => null,
    workRouteRelease: async () => null,
    planStore,
  }
  const exec = { agent: { session: { id: 's-1403', cwd: ws.rootPosix } } }
  const tools: Record<string, any> = {}
  for (const [file, factory, name] of [
    ['src/deck/tools/issue-create.ts', 'createDeckIssueCreate', 'deck_issue_create'],
    ['src/deck/tools/issue-get.ts', 'createDeckIssueGet', 'deck_issue_get'],
  ] as Array<[string, string, string]>) tools[name] = (await imp(file))[factory](deps)
  const run = async (name: string, args: unknown) => {
    let r: any = null
    let threw = ''
    try { r = await tools[name].run(exec, args) } catch (e) { threw = String((e && (e as Error).message) || e) }
    return { r, threw }
  }
  const create = async (args: Record<string, unknown>) => {
    const { r, threw } = await run('deck_issue_create', args)
    check(!threw && r && r.status === 'ok', '建票成功：' + String(args.kind) + (args.label ? '（' + String(args.label) + '）' : '') + (threw ? '，抛了 ' + threw : r && r.status !== 'ok' ? '，实得 ' + r.status + ' ' + JSON.stringify(r.text || r.data || {}).slice(0, 220) : ''))
    return r
  }
  const findUnderScratch = (pred: (full: string, name: string) => boolean): string[] => {
    const out: string[] = []
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (pred(full, e.name)) out.push(full)
      }
    }
    walk(path.join(ws.root, '.scratch'))
    return out
  }
  const fileOf = (key: string): string => {
    const names = fs.readdirSync(ws.issuesDir).filter((n) => n.startsWith(key + '-'))
    if (names.length === 1) return fs.readFileSync(path.join(ws.issuesDir, names[0]), 'utf8')
    // #1486：没有 feature 参数时目录按标题生成，票不再全落在同一个 issues/ 下；按编号在 .scratch 下递归找。
    const found = findUnderScratch((_full, name) => name.startsWith(key + '-') && name.endsWith('.md'))
    if (found.length === 1) return fs.readFileSync(found[0], 'utf8')
    throw new Error('票 ' + key + ' 的文件找到 ' + (names.length || found.length) + ' 个')
  }
  const specFileText = (): string => {
    const found = findUnderScratch((_full, name) => name === 'spec.md')
    if (found.length !== 1) throw new Error('规格文件找到 ' + found.length + ' 个')
    return fs.readFileSync(found[0], 'utf8')
  }
  const typeLines = (text: string) => (text.match(/^Type[：:].*$/gm) || [])
  const labelsLine = (text: string) => ((text.match(/^Labels[：:].*$/m) || [''])[0] || '').trim()
  const hasProgress = (text: string) => /^##\s*进度\s*$/m.test(text)

  // ── 一、六个位置各建一张 ──
  console.log('— 一、六个位置值：类型标签、正文文件头标记、## 进度、Type 行、父子注释')
  const mapRes = await create({ title: '两层地图', kind: 'map' })
  const mapKey = mapRes && mapRes.data && mapRes.data.ticket ? String(mapRes.data.ticket.key) : ''
  if (mapKey) {
    // 原文布局里地图是 demo/map.md 的容器（不在 issues/ 里），按路径读；标签也从可见 Labels 行
    // 改成隐藏注释 DSH-LABELS（#1486 起落盘改成隐藏注释，可见行不再写）。
    const text = fs.readFileSync(ws.mapFile, 'utf8')
    check(mapRes.data.ticket.type === 'map', 'map 读回来契约类型是 map（实得 ' + mapRes.data.ticket.type + '）')
    check(/<!-- DSH-LABELS: .*wayfinder:map -->/m.test(text), 'map 的 DSH-LABELS 注释带 wayfinder:map')
    check(!/DSH-ISSUE-KIND/.test(text), 'map 不写正文文件头标记')
    check(typeLines(text).length === 0, 'map 不写 Type 行（尤其没有 Type: map）')
    check(hasProgress(text), 'map 的正文补了 ## 进度')
    const order = ['## Destination', '## Notes', '## Decisions so far', '## Not yet specified', '## Out of scope'].map((h) => text.indexOf(h))
    check(order.every((i) => i >= 0) && text.indexOf('## 进度') > Math.max.apply(null, order), 'map 的五节在前、## 进度在五节之后')
  }
  const specRes = await create({ title: '两层规格', kind: 'spec' })
  const specKey = specRes && specRes.data && specRes.data.ticket ? String(specRes.data.ticket.key) : ''
  if (specKey) {
    const text = specFileText()
    check(specRes.data.ticket.type === 'spec', 'spec 读回来契约类型是 spec（实得 ' + specRes.data.ticket.type + '）')
    check(/<!-- DSH-STATUS: ready-for-agent -->/.test(text), 'spec 的隐藏注释写状态与必备标签')
    check(/^<!-- DSH-LABELS: .*ready-for-agent -->$/m.test(text), 'spec 的 DSH-LABELS 带 ready-for-agent')
    check(!/DSH-ISSUE-KIND/.test(text), '新布局的 spec 不再写旧类型标记')
    check(typeLines(text).length === 0, 'spec 不写 Type 行')
    check(hasProgress(text), 'spec 也补了 ## 进度（#1403 起所有位置都补）')
  }
  const mapTicketRes = await create({ title: '地图下的调研票', kind: 'map-ticket', label: 'wayfinder:research', parentKey: '00' })
  const mapTicketKey = mapTicketRes && mapTicketRes.data && mapTicketRes.data.ticket ? String(mapTicketRes.data.ticket.key) : ''
  if (mapTicketKey) {
    const text = fileOf(mapTicketKey)
    const ticket = mapTicketRes.data.ticket
    check(ticket.type === 'issue', 'map-ticket 的契约类型是 issue（实得 ' + ticket.type + '）')
    check(/^Type: research$/m.test(text), 'map-ticket 的 Type 行是去前缀的 research（实得 ' + JSON.stringify(typeLines(text)) + '）')
    check(/<!-- DSH-LABELS: .*wayfinder:research -->/m.test(text), 'map-ticket 的 DSH-LABELS 注释带选中的 wayfinder:research')
    check((text.match(/wayfinder:[a-z]+/g) || []).length === 1, 'map-ticket 的类型标签只有一枚，不补第二枚')
    check(!/DSH-ISSUE-KIND/.test(text), 'map-ticket 不写正文文件头标记')
    check(/<!-- DSH-PARENT: 00 -->/.test(text), 'map-ticket 的文件头写父票 00')
    check(String(ticket.parentKey || '') === '00', 'map-ticket 读回来父票是 00（实得 ' + ticket.parentKey + '）')
    check(hasProgress(text), 'map-ticket 的正文补了 ## 进度')
  }
  const specTicketRes = specKey ? await create({ title: '规格下的实施票', kind: 'spec-ticket', parentKey: specKey }) : null
  if (specTicketRes && specTicketRes.data && specTicketRes.data.ticket) {
    const ticket = specTicketRes.data.ticket
    const text = fileOf(String(ticket.key))
    check(ticket.type === 'issue', 'spec-ticket 的契约类型是 issue（实得 ' + ticket.type + '）')
    check(/<!-- DSH-PARENT: 00 -->/.test(text), 'spec-ticket 的隐藏注释写父票 00')
    check(/^<!-- DSH-LABELS: .*ready-for-agent -->$/m.test(text), 'spec-ticket 的 DSH-LABELS 带 ready-for-agent')
    check(typeLines(text).length === 0, 'spec-ticket 不写 Type 行')
    check(hasProgress(text), 'spec-ticket 也补了 ## 进度')
  }
  const bugRes = await create({ title: '两层缺陷票', kind: 'bug' })
  if (bugRes && bugRes.data && bugRes.data.ticket) {
    const text = fileOf(String(bugRes.data.ticket.key))
    check(/^<!-- DSH-LABELS: .*bug.*needs-triage -->$/m.test(text), 'bug 的 DSH-LABELS 带 bug 与 needs-triage（实得 ' + labelsLine(text) + '）')
    check(typeLines(text).length === 0, 'bug 不写 Type 行')
    check(!/DSH-ISSUE-KIND/.test(text), 'bug 不写旧类型标记')
    check(hasProgress(text), 'bug 的正文补了 ## 进度')
  }
  const issueRes = await create({ title: '两层兜底票', kind: 'issue', labels: ['wayfinder:map', 'bug', 'ready-for-agent'] })
  if (issueRes && issueRes.data && issueRes.data.ticket) {
    const text = fileOf(String(issueRes.data.ticket.key))
    const line = ((text.match(/^<!-- DSH-LABELS: .* -->$/m) || [''])[0] || '').trim()
    check(line === '<!-- DSH-LABELS: wayfinder:map, bug, ready-for-agent -->', 'issue 兜底原样落盘任何标签（实得 ' + line + '）')
    check(typeLines(text).length === 0, 'issue 不写 Type 行')
    check(hasProgress(text), 'issue 的正文补了 ## 进度')
  }
  const issue2 = await create({ title: '兜底票带了工单标签', kind: 'issue', labels: ['wayfinder:task'] })
  if (issue2 && issue2.data && issue2.data.ticket) {
    const text = fileOf(String(issue2.data.ticket.key))
    check(typeLines(text).length === 0, 'issue 即使带了 wayfinder 标签也不写 Type 行（Type 行只属于地图工单）')
  }

  // ── 二、四个 wayfinder label 各建一张地图工单 ──
  console.log('— 二、地图工单的四个 label：Type 行各写去前缀的那一个')
  for (const label of ['wayfinder:research', 'wayfinder:prototype', 'wayfinder:grilling', 'wayfinder:task']) {
    const bare = String(label).replace(/^wayfinder:/, '')
    const r = await create({ title: '地图工单之' + bare, kind: 'map-ticket', label, parentKey: '00' })
    if (r && r.data && r.data.ticket) {
      const text = fileOf(String(r.data.ticket.key))
      check(new RegExp('^Type: ' + bare + '$', 'm').test(text), label + ' 的 Type 行是 ' + bare + '（实得 ' + JSON.stringify(typeLines(text)) + '）')
      check((text.match(/wayfinder:[a-z]+/g) || []).length === 1, label + ' 只有这一枚类型标签')
    }
  }

  // ── 三、读回：新地图票与地图工单 ──
  console.log('— 三、读回：带 wayfinder:map 标签的新地图票仍读成地图，地图工单读得到父票')
  if (mapKey) {
    // 这一跑里地图（demo/map.md，00）与规格（另一个目录的 spec.md，也是 00）票号都是 00，
    // 读地图要点名它所在的 effort，否则裸 00 会先命中规格（原文布局的容器票号都从 00 起）。
    const got = await run('deck_issue_get', { key: mapKey, effort: 'demo', blocking: false })
    const issue = got.r && got.r.data ? (got.r.data.issue || got.r.data.ticket) : null
    check(got.r && got.r.status === 'ok' && issue && issue.type === 'map', '新的地图票读回来仍是 map（实得 ' + (issue && issue.type) + '）')
    check(issue && (issue.parentKey === null || issue.parentKey === undefined), '新的地图票没有父票（实得 ' + (issue && issue.parentKey) + '）')
  }
  if (mapTicketKey) {
    const got = await run('deck_issue_get', { key: mapTicketKey, blocking: false })
    const rel = got.r && got.r.data ? got.r.data.relations : null
    check(rel && String(rel.parentKey || '') === '00', '地图工单读回来父票是 00（实得 ' + (rel && rel.parentKey) + '）')
  }

  // ── 三b、父票类型读不到时的降级说明（本地后端总会回类型，这里挂一个不回类型的后端探针） ──
  console.log('— 三b、父票类型读不到的降级：只核存在性，回执照实说明')
  {
    // 这个桩只用来复现父票类型读不到的降级，不断言额度，所以按离网口径声明（注册表只验形状，不按口径限流）。
    const stub = {
      id: 'stub-1403', label: '不回父票类型的后端', matches: async () => false,
      budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
      create: () => ({
        id: 'stub-1403',
        async list() { return { ok: true, data: { issues: [], total: 0, returned: 0 } } },
        async get() { return { ok: true, data: { key: '77', title: '父票（没有类型字段）', body: '' } } },
        async create() { return { ok: true, data: { key: '99', title: '降级探测票', type: 'issue' } } },
      }),
    }
    const dispose = registry.register(stub)
    chooseWorkspace(ws.rootPosix, 'stub-1403')
    try {
      const got = await run('deck_issue_create', { title: '降级探测票', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '77' })
      const notes = (got.r && Array.isArray(got.r.notes)) ? got.r.notes : []
      check(notes.some((n: unknown) => String(n).includes('父票类型读不到，只核了存在性')), '父票没有类型字段时，回执写明「父票类型读不到，只核了存在性」（notes=' + JSON.stringify(notes).slice(0, 220) + '）')
      check(got.r && got.r.status !== 'ok', '读回里没有父子边时如实回 partial，不当成建好（实得 ' + (got.r && got.r.status) + '）')
    } finally { dispose.dispose(); chooseWorkspace(ws.rootPosix, 'markdown') }
  }

  // ── 四、拒绝例：全部在碰后端之前挡下 ──
  console.log('— 四、拒绝例：缺 kind、旧值、label 误用、父票错配，文案点明合法值与迁移路径')
  const countFiles = (): number => findUnderScratch((_full, name) => name.endsWith('.md')).length
  const filesBefore = countFiles()
  const refusals: Array<[string, Record<string, unknown>, RegExp]> = [
    ['缺 kind', { title: '没写位置' }, /kind/],
    ['旧值 task', { title: '旧值任务', kind: 'task' }, /map-ticket|issue/],
    ['旧值 ticket', { title: '旧值实施', kind: 'ticket' }, /spec-ticket/],
    ['不认识的位置值', { title: '位置写错', kind: 'story' }, /map|spec|bug|issue/],
    ['非地图工单传 label', { title: '规格带标签', kind: 'spec', label: 'wayfinder:task' }, /map-ticket/],
    ['地图工单缺 label', { title: '缺标签', kind: 'map-ticket', parentKey: '00' }, /label/],
    ['地图工单 label 非法', { title: '标签非法', kind: 'map-ticket', label: 'wayfinder:map', parentKey: '00' }, /wayfinder/],
    ['地图工单缺父票', { title: '缺父票', kind: 'map-ticket', label: 'wayfinder:task' }, /parentKey|父票/],
    ['实施票缺父票', { title: '实施缺父', kind: 'spec-ticket' }, /parentKey|父票/],
    ['map 带父票', { title: '地图带父', kind: 'map', parentKey: '00' }, /parentKey|父票/],
    ['spec 带父票', { title: '规格带父', kind: 'spec', parentKey: '00' }, /parentKey|父票/],
    ['非 issue 在 labels 带类型标签', { title: '标签塞类型', kind: 'bug', labels: ['bug'] }, /类型标签由 kind/],
    ['spec-ticket 在 labels 带类型标签', { title: '实施塞类型', kind: 'spec-ticket', parentKey: '00', labels: ['wayfinder:task'] }, /类型标签由 kind/],
    ['父票不存在', { title: '父不存在', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '999999' }, /999999|找不到|不存在/],
    ['地图工单的父不是地图', { title: '父错配地图', kind: 'map-ticket', label: 'wayfinder:task', parentKey: '01' }, /地图|探索地图/],
    ['实施票的父不是规格', { title: '父错配规格', kind: 'spec-ticket', parentKey: '01' }, /规格/],
  ]
  // 先造两张用于「父票错配」的票：一张在 map 目录里的普通票，一张在 spec 目录里的普通票。
  // #1486 起没有 feature 的普通票会按标题另起目录，父票号在别的目录里读不到；错配用例要落在同一个容器目录里。
  const plain = await create({ title: '普通票：给错配用', kind: 'issue', effort: 'demo' })
  const plainKey = plain && plain.data && plain.data.ticket ? String(plain.data.ticket.key) : ''
  const specFeature = specRes && specRes.data && specRes.data.ticket ? String(specRes.data.ticket.effortId || '') : ''
  const wrongParent = specFeature ? await create({ title: '规格目录里的普通票', kind: 'issue', feature: specFeature }) : null
  const wrongKey = wrongParent && wrongParent.data && wrongParent.data.ticket ? String(wrongParent.data.ticket.key) : ''
  const filesAfterSetup = countFiles()
  let seen = 0
  for (const [name, args0, want] of refusals) {
    const args: Record<string, unknown> = Object.assign({}, args0)
    if (String(args.parentKey) === '01') args.parentKey = (name === '实施票的父不是规格' ? wrongKey : plainKey) || '999999'
    if (name === '实施票的父不是规格' && specFeature) args.feature = specFeature
    const { r, threw } = await run('deck_issue_create', args)
    seen += 1
    const ok = !threw && r && r.status === 'unsupported' && r.reason === 'bad-args' && want.test(String(r.text || ''))
    check(ok, '拒绝：' + name + (ok ? '' : '（实得 ' + (threw || (r && (r.status + '/' + r.reason + ' ' + String(r.text || '').slice(0, 180)))) + '）'))
  }
  check(seen === refusals.length, '拒绝例都跑过了（' + seen + ' 条）')
  check(countFiles() === filesAfterSetup, '拒绝例一张票都没建（盘上仍是 ' + filesAfterSetup + ' 张）')
  check(filesAfterSetup - filesBefore === 2, '错配用例前只多建了两张普通票（' + filesBefore + ' → ' + filesAfterSetup + '）')

  ws.cleanup()
  console.log('共 ' + total + ' 项' + (failed ? '，有失败' : '，全部通过'))
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1 })
