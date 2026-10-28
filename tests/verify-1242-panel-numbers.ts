// tests/verify-1242-panel-numbers.ts —— 门禁：面板统计数字必须与 GitHub 现场对得上（#1242）
//
// 现场（#1242 正文）：面板上的「总数 / 未关闭 / 已关闭 / 可接 / 已认领 / 被阻塞」六格数字
// 是宿主拼快照时算出来的，但没有任何一道门禁从**原始 gh 回包**一路走到这六格。
// 既有 tests/verify-1444-snapshot.ts 直接塞一份已归一的假会话结果，绕过了 GitHub 房间与
// gh 出站，所以「房间把回包读歪了」「装配把子票塞错地图」这类故障它一条也抓不到。
//
// 这一扇补的正是这一段：唯一替身是 gh 可执行程序（按命令行分派的假函数），
// 注册表、GitHub 房间、会话管线、快照装配、地图正文解析、分组与分层全部是仓库里的真件。
// 链路上任何一格改了行为，这里的手写期望就会对不上。
//
// 门禁归属: src/refresh/rooms/host/snapshot-build.ts
// 门禁归属: src/tracker/rooms/github
// 门禁归属: src/host/ticketGrouping.ts
// 门禁归属: src/host/mapBody.ts
// 门禁归属: src/refresh/rooms/host/session-opener.ts
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1242-panel-numbers.ts
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.ts'
import { createSessionOpener } from '../src/refresh/rooms/host/session-opener.ts'
import { createSnapshotBuilder } from '../src/refresh/rooms/host/snapshot-build.ts'
import { createRegistry } from '../src/tracker/registry/core.ts'
import { githubModule } from '../src/tracker/rooms/github/index.ts'
import { createMapBody } from '../src/host/mapBody.ts'
import { createTicketGrouping } from '../src/host/ticketGrouping.ts'

const CWD = '/ws/demo'
const REPO_ID = 'acme/demo'
const AUTHOR = { login: 'octocat', name: '章鱼猫', avatarUrl: 'https://avatars.example.invalid/octocat', __typename: 'User' }
const VIEWER = { login: 'octocat', name: '章鱼猫', avatarUrl: 'https://avatars.example.invalid/octocat' }
const SEL = {
  backendId: 'github',
  source: 'explicit',
  ref: { backend: 'github', refId: REPO_ID, name: REPO_ID, url: 'https://github.com/' + REPO_ID },
}
const LABEL_COLORS: Record<string, string> = { 'wayfinder:map': '5319e7', 'wayfinder:task': '0e8a16', 'ready-for-agent': '0e8a16', bug: 'd73a4a' }
const LABEL_CATALOG = [
  { name: 'ready-for-agent', color: '0e8a16', description: '' },
  { name: 'bug', color: 'd73a4a', description: '' },
]

let total = 0
let failed = 0
/** 逐条断言：打印 PASS/FAIL，失败累计，收尾一起判红。 */
const check = (ok: unknown, msg: string, detail?: unknown): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || detail === undefined ? '' : ' — ' + String(detail)))
  if (!ok) failed += 1
}
/** 把对象按键名排序后序列化：只比内容，不比键的先后（不同代码路径不会保证同一个键序）。 */
const stable = (value: any): any => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out: any = {}
    Object.keys(value).sort().forEach(function (k) { if (value[k] !== undefined) out[k] = stable(value[k]) })
    return out
  }
  return value
}
/** 深比较，用于「整块形状」这种一次判多格的断言。 */
const same = (a: any, b: any): boolean => JSON.stringify(stable(a)) === JSON.stringify(stable(b))
/** 失败时把两边都打出来，省得只看到一句 false。 */
const show = (a: any, b: any): string => '实际=' + JSON.stringify(stable(a)) + ' 期望=' + JSON.stringify(stable(b))

// ── 夹具：一份能顺序说明问题的最小仓库现场 ───────────────────────────────────
//
// 11 张工单 + 1 个拉取请求；#100 与 #200 是探索地图，#300 是已关闭的地图（不进地图表）。
// #100 的 5 张子票覆盖：可接 / 已认领 / 被阻塞 / 阻塞别人 / 已关闭；
// #200 的取数故意失败，用来钉「单张地图失败只降级这一张，不拖垮整份快照」。
// updatedAt 决定列表顺序，也决定地图表顺序（快照按倒序取）。
const PROGRESS_BODY = '## 进度：60%'
const MAP100_BODY = [
  '# 探索地图：面板数字',
  '',
  '## Destination',
  '面板上的每一格统计数字都能和 GitHub 现场对上，对不上时门禁先红。',
  '',
  '## Notes',
  '本图只关心读路径；写路径由别的票管。',
  '',
  '## Decisions so far',
  '- [只比统计数字，不比界面文案](https://github.com/acme/demo/issues/100) — 界面文案另有票看。',
  '- **不做全量快照比对**：只钉住 stats 六个数字与分层。',
  '',
  '## Not yet specified',
  '- 增量刷新时数字会不会短暂对不上。',
  '',
  '## Out of scope',
  '- 写操作的回写。',
].join('\n')

const ROOT_ROWS = [
  { number: 100, title: '探索地图：面板数字', state: 'OPEN', labels: ['wayfinder:map'], body: MAP100_BODY, updatedAt: '2026-03-11T00:00:00Z' },
  { number: 200, title: '探索地图：降级地图', state: 'OPEN', labels: ['wayfinder:map'], updatedAt: '2026-03-10T00:00:00Z' },
  { number: 300, title: '探索地图：已关闭', state: 'CLOSED', labels: ['wayfinder:map'], updatedAt: '2026-03-09T00:00:00Z' },
  { number: 101, title: '子票 101', state: 'OPEN', labels: ['wayfinder:task'], body: PROGRESS_BODY, updatedAt: '2026-03-08T00:00:00Z' },
  { number: 102, title: '子票 102', state: 'OPEN', assignees: ['alice'], updatedAt: '2026-03-07T00:00:00Z' },
  { number: 103, title: '子票 103', state: 'OPEN', blockedBy: [104], updatedAt: '2026-03-06T00:00:00Z' },
  { number: 104, title: '子票 104', state: 'OPEN', updatedAt: '2026-03-05T00:00:00Z' },
  { number: 105, title: '子票 105', state: 'CLOSED', updatedAt: '2026-03-04T00:00:00Z' },
  { number: 110, title: '普通票 110', state: 'OPEN', updatedAt: '2026-03-03T00:00:00Z' },
  { number: 111, title: '缺陷票 111', state: 'CLOSED', updatedAt: '2026-03-02T00:00:00Z' },
  { number: 112, title: '普通票 112', state: 'OPEN', assignees: ['bob'], updatedAt: '2026-03-01T00:00:00Z' },
]
const PULL_REQUEST = Object.assign(
  rowToNode({ number: 500, title: '拉取请求 500', state: 'OPEN', updatedAt: '2026-04-01T00:00:00Z' }),
  { __typename: 'PullRequest' },
)

function actorOf(login: string, name?: string) {
  return { login, name: name || login, avatarUrl: 'https://avatars.example.invalid/' + login, __typename: 'User' }
}
/** 行 → GraphQL 工单节点：只造房间归一函数真正读的那几格。 */
function rowToNode(row: any): any {
  return {
    number: row.number,
    title: row.title,
    state: row.state || 'OPEN',
    body: row.body || '',
    url: 'https://github.com/' + REPO_ID + '/issues/' + row.number,
    createdAt: row.createdAt || '2026-01-01T00:00:00Z',
    updatedAt: row.updatedAt || '2026-01-01T00:00:00Z',
    author: row.author === false ? undefined : AUTHOR,
    assignees: { nodes: (row.assignees || []).map(function (login: string) { return actorOf(login) }) },
    labels: { nodes: (row.labels || []).map(function (name: string) { return { name: name, color: LABEL_COLORS[name] || 'ededed', description: '' } }) },
    blockedBy: { nodes: (row.blockedBy || []).map(function (n: number) { return { number: n, title: '票 ' + n, state: 'OPEN' } }) },
    __typename: 'Issue',
  }
}
function rootNodes(): any[] { return ROOT_ROWS.map(rowToNode) }
/** #100 的 5 张子票：#101 带进度、#102 已认领、#103 被 #104 挡着、#105 已关闭。 */
function sub100Nodes(): any[] {
  return [
    rowToNode({ number: 101, title: '子票 101', state: 'OPEN', labels: ['wayfinder:task'], body: PROGRESS_BODY, updatedAt: '2026-03-08T00:00:00Z', author: false }),
    rowToNode({ number: 102, title: '子票 102', state: 'OPEN', assignees: ['alice'], updatedAt: '2026-03-07T00:00:00Z', author: false }),
    rowToNode({ number: 103, title: '子票 103', state: 'OPEN', blockedBy: [104], updatedAt: '2026-03-06T00:00:00Z', author: false }),
    rowToNode({ number: 104, title: '子票 104', state: 'OPEN', updatedAt: '2026-03-05T00:00:00Z', author: false }),
    rowToNode({ number: 105, title: '子票 105', state: 'CLOSED', updatedAt: '2026-03-04T00:00:00Z', author: false }),
  ]
}

type World = {
  calls: Array<{ cmd: string; args: string[]; opts: any }>
  unhandled: string[]
  failList: boolean
  sub100: any[]
  root: any[]
}
function makeWorld(over?: Partial<World>): World {
  return Object.assign({
    calls: [],
    unhandled: [],
    failList: false,
    sub100: sub100Nodes(),
    root: rootNodes(),
  }, over || {})
}
const okExec = (stdout: string) => ({ code: 0, stdout: stdout, stderr: '' })

/** 假 gh：只回答这一扇门禁需要的六类命令，其余一律记进 unhandled 并失败（不静默放过）。 */
function makeExec(world: World) {
  return async function exec(cmd: string, args: string[], opts: any): Promise<any> {
    world.calls.push({ cmd: cmd, args: args, opts: opts })
    if (cmd !== 'gh') {
      world.unhandled.push(cmd + ' ' + args.join(' '))
      return { code: 1, stdout: '', stderr: '门禁只脚本化 gh，收到 ' + cmd }
    }
    const query = args.filter(function (a) { return a.indexOf('query=') === 0 })[0] || ''
    const hasNumberVar = args.some(function (a) { return a.indexOf('number=') === 0 })
    if (query.indexOf('subIssues') >= 0 && hasNumberVar) {
      const numberVar = args.filter(function (a) { return a.indexOf('number=') === 0 })[0] || ''
      const mapNumber = Number(numberVar.slice('number='.length))
      if (mapNumber === 200) {
        return okExec(JSON.stringify({ errors: [{ message: '门禁夹具：地图 #200 子票取数故意失败' }] }))
      }
      return okExec(JSON.stringify({
        data: { repository: { issue: { subIssues: { totalCount: world.sub100.length, nodes: world.sub100, pageInfo: { hasNextPage: false, endCursor: null } } } } },
      }))
    }
    if (query.indexOf('pullRequests') >= 0) {
      return okExec(JSON.stringify({
        data: { repository: { pullRequests: { nodes: [PULL_REQUEST], pageInfo: { hasNextPage: false, endCursor: null } } } },
      }))
    }
    if (query.indexOf('issues(') >= 0) {
      if (world.failList) return { code: 1, stdout: '', stderr: '门禁夹具：列表 GraphQL 故意失败' }
      return okExec(JSON.stringify({
        data: { repository: { issues: { nodes: world.root, pageInfo: { hasNextPage: false, endCursor: null } } } },
      }))
    }
    if (args[0] === 'label' && args[1] === 'list') return okExec(JSON.stringify(LABEL_CATALOG))
    if (args[0] === 'api' && args[1] === 'user') return okExec(JSON.stringify(VIEWER))
    if (args[0] === 'api' && typeof args[1] === 'string' && args[1].indexOf('repos/') === 0) {
      if (world.failList) return { code: 1, stdout: '', stderr: '门禁夹具：列表 REST 也故意失败' }
      return okExec('[]')
    }
    world.unhandled.push(cmd + ' ' + args.join(' '))
    return { code: 1, stdout: '', stderr: '门禁未脚本化这条命令：' + args.join(' ').slice(0, 160) }
  }
}

/**
 * 按仓库里的真实装配搭一份快照：
 * 注册表 → GitHub 房间 → 会话管线 → 快照组装；只把 gh 换成 makeExec 那个假函数。
 * 返回快照与旁证（发了哪些命令、有没有走到快照不该直调的那条执行口）。
 */
async function snapshotOf(world: World, over?: { groupTickets?: any }): Promise<{ snapshot: any; execProcCalls: number }> {
  const mapBody = createMapBody()
  const grouping = createTicketGrouping()
  // 账本只提供读与记账两个口：读恒为「还没量过」，写记账空转（这一扇不判额度）。
  const ledger = { view: function () { return null }, spend: function () { return null } }
  let execProcCalls = 0
  const hostCtx: any = {
    cwd: CWD,
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async function (name: string) { return name === 'gh' ? 'gh' : null } },
    exec: makeExec(world),
    isEnabled: function () { return false },
    logEvent: function () {},
  }
  const registry = createRegistry(hostCtx, { matchesTimeout: 200 })
  registry.register(githubModule)
  const openSession = createSessionOpener({
    getTrackerRegistry: async function () { return registry },
    ledger: ledger,
    backendCtx: function () { return hostCtx },
    ensureBackend: function () {},
  })
  const builder = createSnapshotBuilder({
    openSession: openSession,
    getRepoKey: async function () { return { owner: 'acme', name: 'demo' } },
    // 快照自己不许绕开会话直连进程：走到这里就说明装配被改坏了。
    execProc: async function () { execProcCalls += 1; throw new Error('快照装配不该直调 execProc') },
    mapTicket: mapBody.mapTicket,
    parseMapBody: mapBody.parseMapBody,
    computeLevels: grouping.computeLevels,
    groupTickets: over && over.groupTickets ? over.groupTickets : grouping.groupTickets,
    getTrackerRegistry: async function () { return registry },
    getPlatform: async function () { return hostCtx.platform },
    getRepoRoot: async function () { return CWD },
    getGhPath: function () { return 'gh' },
    getGhLastError: function () { return null },
    ctx: { get: function () { return undefined } },
    timer: { timeout: function () { return null } },
    getDetectionService: async function () { return { detect: async function () { return { selection: SEL } } } },
  })
  const snapshot = await builder.buildSnapshot(CWD)
  return { snapshot: snapshot, execProcCalls: execProcCalls }
}

// ── 手写期望：只写「人从 GitHub 现场能数出来」的那几格 ─────────────────────
const HAND_TICKETS = [
  { number: 101, title: '子票 101', type: 'task', state: 'OPEN', claimedBy: '', blockedBy: [], blocks: [], labels: ['wayfinder:task'], url: 'https://github.com/acme/demo/issues/101', progress: 60, level: 0 },
  { number: 102, title: '子票 102', type: 'other', state: 'OPEN', claimedBy: 'alice', blockedBy: [], blocks: [], labels: [], url: 'https://github.com/acme/demo/issues/102', progress: null, level: 0 },
  { number: 103, title: '子票 103', type: 'other', state: 'OPEN', claimedBy: '', blockedBy: [104], blocks: [], labels: [], url: 'https://github.com/acme/demo/issues/103', progress: null, level: 1 },
  { number: 104, title: '子票 104', type: 'other', state: 'OPEN', claimedBy: '', blockedBy: [], blocks: [103], labels: [], url: 'https://github.com/acme/demo/issues/104', progress: null, level: 0 },
  { number: 105, title: '子票 105', type: 'other', state: 'CLOSED', claimedBy: '', blockedBy: [], blocks: [], labels: [], url: 'https://github.com/acme/demo/issues/105', progress: null, level: 0 },
]
const HAND_STATS = {
  total: 5, open: 4, closed: 1, frontier: 2, claimed: 1, blocked: 1,
  levels: [
    { level: 0, numbers: [101, 102, 104, 105], open: 3, closed: 1, total: 4, frontier: 2, claimed: 1, blocked: 0 },
    { level: 1, numbers: [103], open: 1, closed: 0, total: 1, frontier: 0, claimed: 0, blocked: 1 },
  ],
  levelOf: { '101': 0, '102': 0, '103': 1, '104': 0, '105': 0 },
}
const HAND_DECISIONS = [
  { title: '只比统计数字，不比界面文案', url: 'https://github.com/acme/demo/issues/100', gist: '界面文案另有票看。' },
  { title: '不做全量快照比对', url: '', gist: '只钉住 stats 六个数字与分层。' },
]

async function main(): Promise<void> {
  // ── 一、正常世界：快照信封与列表 ─────────────────────────────────────────
  console.log('== 一、正常世界：面板快照的信封、列表与能力诊断 ==')
  const normalWorld = makeWorld()
  const normal = await snapshotOf(normalWorld)
  const snap = normal.snapshot
  check(snap && snap.ok === true, '一、正常世界快照 ok:true', snap && snap.ok)
  check(snap.repo && snap.repo.owner === 'acme' && snap.repo.name === 'demo', '一、repo 是 acme/demo', show(snap.repo, { owner: 'acme', name: 'demo' }))
  check(snap.repoRoot === CWD, '一、repoRoot 是工作区目录', snap.repoRoot)
  check(snap.env && snap.env.ghPath === 'gh' && snap.env.ghError === null, '一、env 交代 gh 路径与上一次错误', show(snap.env, { ghPath: 'gh', ghError: null }))
  check(snap.repository && same(snap.repository, { backend: 'github', refId: REPO_ID, name: REPO_ID, url: 'https://github.com/' + REPO_ID }), '一、仓库身份由后端 describe 产出', show(snap.repository, REPO_ID))
  check(snap.selection && snap.selection.backendId === 'github', '一、selection 沿用显式选择', show(snap.selection, SEL))
  check(Array.isArray(snap.backendModules) && snap.backendModules.length === 1 && snap.backendModules[0].id === 'github', '一、队列里只有一个 GitHub 后端', show(snap.backendModules && snap.backendModules.map(function (m: any) { return m && m.id }), ['github']))
  check(snap.fallback === null && snap.fallbackAt === null, '一、主路成功时没有「切了 REST 通道」的标记', show({ fallback: snap.fallback, fallbackAt: snap.fallbackAt }, { fallback: null, fallbackAt: null }))
  check(typeof snap.updatedAt === 'string' && snap.updatedAt.length > 0, '一、updatedAt 有值', snap.updatedAt)
  check(snap.viewerLogin === 'octocat', '一、viewerLogin 是 octocat', snap.viewerLogin)
  check(snap.viewer && same(snap.viewer, Object.assign({ kind: 'user' }, VIEWER)), '一、viewer 原样带回登录名与显示名', show(snap.viewer, VIEWER))
  check(same(snap.labels, [{ name: 'ready-for-agent', color: '0e8a16' }, { name: 'bug', color: 'd73a4a' }]), '一、标签目录只留名字与颜色', show(snap.labels, LABEL_CATALOG))

  const rows = snap.issues
  check(Array.isArray(rows) && rows.length === 11, '一、列表行 11 条（拉取请求不算票）', rows && rows.length)
  check(same(rows.map(function (r: any) { return r.number }), [100, 200, 300, 101, 102, 103, 104, 105, 110, 111, 112]), '一、列表按更新时间倒序', show(rows.map(function (r: any) { return r.number }), [100, 200, 300, 101, 102, 103, 104, 105, 110, 111, 112]))
  check(same(rows.map(function (r: any) { return r.title }), ROOT_ROWS.map(function (r) { return r.title })), '一、列表标题与现场一致', show(rows.map(function (r: any) { return r.title }), ROOT_ROWS.map(function (r) { return r.title })))
  check(same(rows.map(function (r: any) { return r.state }), ['OPEN', 'OPEN', 'CLOSED', 'OPEN', 'OPEN', 'OPEN', 'OPEN', 'CLOSED', 'OPEN', 'CLOSED', 'OPEN']), '一、已关闭状态照实标 CLOSED', show(rows.map(function (r: any) { return r.state }), 'OPEN/CLOSED 序列'))
  check(same(rows.map(function (r: any) { return r.assignees }), [[], [], [], [], ['alice'], [], [], [], [], [], ['bob']]), '一、认领人只留登录名', show(rows.map(function (r: any) { return r.assignees }), '[alice] 与 [bob] 各一条'))
  check(same(rows.map(function (r: any) { return r.labels.map(function (l: any) { return l.name }) }), [['wayfinder:map'], ['wayfinder:map'], ['wayfinder:map'], ['wayfinder:task'], [], [], [], [], [], [], []]), '一、标签名照实带出（拉取请求没有标签不影响这里）', show(rows.map(function (r: any) { return r.labels }), '3 张地图 + 1 张任务票'))
  check(rows.every(function (r: any) { return r.author && r.author.login === 'octocat' && r.author.name === '章鱼猫' }), '一、作者逐行都有，名字不丢')
  check(same(snap.capabilities, { present: 17, empty: 16, missing: 66 }), '一、能力诊断九格 × 11 行 = 99 格，有值 17 / 空 16 / 缺 66', show(snap.capabilities, { present: 17, empty: 16, missing: 66 }))

  // ── 二、地图 #100：五区块与子票逐张 ─────────────────────────────────────
  console.log('== 二、地图 #100：正文五区块与子票逐张对齐 ==')
  const maps = snap.maps
  check(Array.isArray(maps) && maps.length === 2, '二、地图表只有两张打开的地图', maps && maps.length)
  check(same(maps.map(function (m: any) { return m.number }), [100, 200]), '二、地图按列表顺序排列（#100 在前）', show(maps.map(function (m: any) { return m.number }), [100, 200]))
  check(!maps.some(function (m: any) { return m.number === 300 }), '二、已关闭的地图不进地图表')
  const map100 = maps[0]
  check(map100 && map100.number === 100 && map100.title === '探索地图：面板数字', '二、地图 #100 的编号与标题', show(map100 && { number: map100.number, title: map100.title }, { number: 100, title: '探索地图：面板数字' }))
  check(map100 && map100.state === 'OPEN' && map100.type === 'map' && map100.key === '100' && map100.effortId === '', '二、地图 #100 的容器身份（state/type/key/effortId）', show(map100 && { state: map100.state, type: map100.type, key: map100.key, effortId: map100.effortId }, { state: 'OPEN', type: 'map', key: '100', effortId: '' }))
  check(map100 && map100.url === 'https://github.com/acme/demo/issues/100', '二、地图 #100 的地址', map100 && map100.url)
  check(same(map100.labels, ['wayfinder:map']), '二、地图 #100 的标签名', show(map100.labels, ['wayfinder:map']))
  check(map100.destination === '面板上的每一格统计数字都能和 GitHub 现场对上，对不上时门禁先红。', '二、Destination 区', map100.destination)
  check(map100.notes === '本图只关心读路径；写路径由别的票管。', '二、Notes 区', map100.notes)
  check(same(map100.decisions, HAND_DECISIONS), '二、Decisions so far 两条（链接写法与加粗写法各一条）', show(map100.decisions, HAND_DECISIONS))
  check(same(map100.fog, ['- 增量刷新时数字会不会短暂对不上。']), '二、Not yet specified 区', show(map100.fog, ['- 增量刷新时数字会不会短暂对不上。']))
  check(same(map100.outOfScope, ['- 写操作的回写。']), '二、Out of scope 区', show(map100.outOfScope, ['- 写操作的回写。']))
  check(Array.isArray(map100.tickets) && map100.tickets.length === 5, '二、地图 #100 有 5 张子票', map100.tickets && map100.tickets.length)
  check(same(map100.tickets, HAND_TICKETS), '二、5 张子票逐格：状态 / 认领 / 阻塞边 / 反向阻塞 / 标签 / 进度 / 层级', show(map100.tickets, HAND_TICKETS))
  check(same(map100.stats, HAND_STATS), '二、stats 六格与两层分层和手数一致', show(map100.stats, HAND_STATS))

  // ── 三、地图 #200：单张失败只降级这一张 ─────────────────────────────────
  console.log('== 三、地图 #200：子票取数失败只降级这一张 ==')
  const map200 = maps[1]
  check(map200 && map200.number === 200 && map200.state === 'OPEN' && map200.type === 'map', '三、地图 #200 仍在地图表里（编号/状态/类型）', show(map200 && { number: map200.number, state: map200.state, type: map200.type }, { number: 200, state: 'OPEN', type: 'map' }))
  check(map200 && map200.error && String(map200.error.error || '').indexOf('子票取数') >= 0, '三、地图 #200 带着取数失败的原因（不静默）', show(map200 && map200.error, '含「子票取数」'))
  check(map200 && same(map200.tickets, []) && same(map200.stats, { total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0 }), '三、降级地图的票数为 0、六格全 0（不拿别的图冒充）', show(map200 && { tickets: map200.tickets, stats: map200.stats }, { tickets: [], stats: 0 }))

  // ── 四、出站轨迹：六条命令、没有旁路 ───────────────────────────────────
  console.log('== 四、出站轨迹：六条命令、没有旁路 ==')
  const calls = normalWorld.calls
  check(calls.length === 6, '四、整份快照只发六条 gh 命令（列表 2 + 标签 1 + 本人 1 + 子票 2）', calls.length)
  check(calls.every(function (c) { return c.cmd === 'gh' }), '四、所有命令都走 gh 可执行程序（没有别的进程）')
  const gqlCalls = calls.filter(function (c) { return c.args[0] === 'api' && c.args[1] === 'graphql' })
  const issuePageCalls = gqlCalls.filter(function (c) { return String(c.args.join(' ')).indexOf('issues(first:') >= 0 })
  const prPageCalls = gqlCalls.filter(function (c) { return String(c.args.join(' ')).indexOf('pullRequests(first:') >= 0 })
  const subCalls = gqlCalls.filter(function (c) { return String(c.args.join(' ')).indexOf('subIssues') >= 0 })
  check(issuePageCalls.length === 1, '四、工单列表走一次 GraphQL', issuePageCalls.length)
  check(prPageCalls.length === 1, '四、拉取请求列表走一次 GraphQL', prPageCalls.length)
  check(subCalls.length === 2, '四、两张地图各取一次子票', subCalls.length)
  check(issuePageCalls.length === 1 && String(issuePageCalls[0].args.join(' ')).indexOf('owner=acme') >= 0 && String(issuePageCalls[0].args.join(' ')).indexOf('name=demo') >= 0 && String(issuePageCalls[0].args.join(' ')).indexOf('first=50') >= 0, '四、工单列表按仓库坐标与一页 50 条发出', issuePageCalls[0] && issuePageCalls[0].args.join(' '))
  check(subCalls.some(function (c) { return String(c.args.join(' ')).indexOf('number=100') >= 0 }) && subCalls.some(function (c) { return String(c.args.join(' ')).indexOf('number=200') >= 0 }), '四、子票查询按地图号 100 / 200 发出', subCalls.map(function (c) { return c.args.join(' ') }))
  const labelCalls = calls.filter(function (c) { return c.args[0] === 'label' && c.args[1] === 'list' })
  const labelArgs = labelCalls[0] ? labelCalls[0].args.join(' ') : ''
  check(labelCalls.length === 1 && labelArgs.indexOf('--repo acme/demo') >= 0 && labelArgs.indexOf('--json name,color,description') >= 0 && labelArgs.indexOf('--limit 1000') >= 0, '四、标签目录按仓库一次拉全', labelArgs)
  const userCalls = calls.filter(function (c) { return c.args[0] === 'api' && c.args[1] === 'user' })
  check(userCalls.length === 1 && userCalls[0].args.join(' ').indexOf('--jq') >= 0, '四、当前登录人走一次 api user', userCalls.length)
  check(!calls.some(function (c) { return c.args.join(' ').indexOf('repo view') >= 0 }), '四、没有为了拿仓库身份额外发 repo view')
  check(!calls.some(function (c) { return typeof c.args[1] === 'string' && c.args[1].indexOf('repos/') === 0 }), '四、主路成功时没有走 REST 降级')
  check(worldUnhandled(normalWorld) === 0, '四、没有门禁没脚本化却被悄悄放过的命令', normalWorld.unhandled.join(' | '))
  check(normal.execProcCalls === 0, '四、快照自己一次都没直调 execProc（所有出站都经房间）', normal.execProcCalls)

  // ── 五、失败面：列表取不回来时如实失败，不伪造 ─────────────────────────
  console.log('== 五、失败面：列表取不回来时如实失败 ==')
  const failedWorld = makeWorld({ failList: true })
  const failedSnap = (await snapshotOf(failedWorld)).snapshot
  check(failedSnap && failedSnap.ok === false, '五、列表 GraphQL 与 REST 都失败时快照 ok:false', failedSnap && failedSnap.ok)
  check(failedSnap && failedSnap.error && typeof failedSnap.error.kind === 'string' && typeof failedSnap.error.error === 'string', '五、失败原因带 kind 与说明', show(failedSnap && failedSnap.error, '{kind,error}'))
  check(failedSnap && failedSnap.maps === undefined && failedSnap.issues === undefined, '五、失败时没有伪造 maps / issues 两个空集合', show(failedSnap && Object.keys(failedSnap), '不含 maps/issues'))
  check(failedWorld.calls.some(function (c) { return typeof c.args[1] === 'string' && c.args[1].indexOf('repos/') === 0 }), '五、主路失败后确实走到过 REST 降级')
  check(failedSnap && failedSnap.maps === undefined && failedSnap.issues === undefined, '五、失败回包不带旧信封的默认字段（由上层决定要不要用缓存）')

  // ── 六、敏感性：改坏分组 / 改现场，手写期望都会当场不成立 ───────────────
  console.log('== 六、敏感性：分组算错或现场变了，手写期望都会当场不成立 ==')
  const wrongWorld = makeWorld()
  const realGroup = createTicketGrouping().groupTickets
  const bumped = await snapshotOf(wrongWorld, { groupTickets: function (tickets: any) {
    const stats = realGroup(tickets)
    return Object.assign({}, stats, {
      total: stats.total + 1, open: stats.open + 1, closed: stats.closed + 1,
      frontier: stats.frontier + 1, claimed: stats.claimed + 1, blocked: stats.blocked + 1,
    })
  } })
  const bumpedStats = bumped.snapshot.maps[0].stats
  check(!same(bumpedStats, HAND_STATS), '六、分组六格任何一格算错，整块 stats 期望就不成立（六格各 +1）')
  ;['total', 'open', 'closed', 'frontier', 'claimed', 'blocked'].forEach(function (key) {
    check(bumpedStats[key] !== HAND_STATS[key], '六、六格逐格点名：' + key + ' 被改坏时手写期望能抓到', bumpedStats[key] + ' vs ' + HAND_STATS[key])
  })
  const wrongGroupWorld = makeWorld()
  const wrongGroup = await snapshotOf(wrongGroupWorld, { groupTickets: function (tickets: any) {
    const stats = realGroup(tickets)
    return Object.assign({}, stats, { frontier: tickets.length })
  } })
  const wrongStats = wrongGroup.snapshot.maps[0].stats
  check(wrongStats.frontier === 5 && !same(wrongStats, HAND_STATS), '六、把「可接」错算成票数时，手写期望不成立（5 对 2）', wrongStats.frontier)
  const closed104World = makeWorld({ sub100: sub100Nodes() })
  closed104World.sub100[3] = rowToNode({ number: 104, title: '子票 104', state: 'CLOSED', updatedAt: '2026-03-05T00:00:00Z', author: false })
  const closed104 = await snapshotOf(closed104World)
  const stats104 = closed104.snapshot.maps[0].stats
  check(stats104.open === 3 && stats104.closed === 2 && stats104.frontier === 2 && stats104.blocked === 0, '六、把 #104 改关之后 #103 解锁（open3 / closed2 / frontier2 / blocked0）', show(stats104, { open: 3, closed: 2, frontier: 2, blocked: 0 }))
  check(!same(stats104, HAND_STATS), '六、现场一变（#104 关闭），原来的手写 stats 期望就不成立')

  // ── 七、自检：门禁自己不联网、不偷跑别的进程 ───────────────────────────
  console.log('== 七、自检：门禁自身不联网、不另起进程 ==')
  const selfSource = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const forbidden = [
    'child' + '_process',
    'spawn' + '(',
    'exec' + 'Sync',
    'gh' + '.exe',
    'https://api' + '.github.com',
  ]
  forbidden.forEach(function (word) {
    check(selfSource.indexOf(word) < 0, '七、门禁源码不含 ' + word, selfSource.indexOf(word))
  })
  check(selfSource.indexOf("from '../src/refresh/rooms/host/snapshot-build.ts'") >= 0, '七、门禁加载的是真快照装配（不是另抄一份口径）')
  check(selfSource.indexOf("from '../src/tracker/rooms/github/index.ts'") >= 0, '七、门禁加载的是真 GitHub 房间（不是假会话）')
  check(selfSource.indexOf("from '../src/refresh/rooms/host/session-opener.ts'") >= 0, '七、门禁加载的是真会话装配（出站都经会话管线）')

  printGateResult('verify-1242-panel-numbers', total, failed)
  if (failed) {
    console.log('\n1242 PANEL NUMBERS TESTS FAILED（共 ' + total + ' 条断言，' + failed + ' 条失败）')
    process.exit(1)
  }
  console.log('\n1242 PANEL NUMBERS TESTS PASSED（共 ' + total + ' 条断言）')
}

function worldUnhandled(world: World): number { return world.unhandled.length }

main().then(function () {
  // main 内部已经用 process.exit 处理失败；到这里说明全绿。
}, function (err) {
  console.error('1242 门禁执行失败：', err && err.stack ? err.stack : err)
  process.exit(1)
})
