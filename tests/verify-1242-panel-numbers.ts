// tests/verify-1242-panel-numbers.ts —— 门禁：面板统计数字必须与 GitHub 现场对得上（#1242）
//
// 现场（#1242 正文）：面板上的「总数 / 未关闭 / 已关闭 / 可接 / 已认领 / 被阻塞」六格数字
// 由宿主算好交给界面，但没有任何一道门禁从**原始 gh 回包**一路走到这六格。
//
// #1870 之后这一扇只覆盖面板真正走的那条路：wf.mapTickets（点开一张地图时现取子票，
// 界面顶栏与容器三态优先用它的数字）。原来的「快照兜底路径」那半段驱动的是旧快照组装
// （snapshot-build），那个模块在生产里已经没有调用点、本票删掉了；列表与容器树的快照
// 改从本地快照库的读投影出，由 verify-1863 / verify-1869 那几扇盯。
//
// 这条路的唯一替身是 gh 可执行程序（按命令行分派的假函数），注册表、GitHub 房间、会话管线、
// 地图正文解析、分组与分层全部是仓库里的真件。链路上任何一格改了行为，这里的手写期望就会对不上。
//
// 门禁归属: src/host/mapTickets.ts
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
import { createRegistry } from '../src/tracker/registry/core.ts'
import { githubModule } from '../src/tracker/rooms/github/room/index.ts'
import { createMapBody } from '../src/host/mapBody.ts'
import { createTicketGrouping } from '../src/host/ticketGrouping.ts'
import { createMapTickets } from '../src/host/mapTickets.ts'

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
 * 搭一份面板真正用的取数电话（wf.mapTickets）：
 * 注册表 → GitHub 房间 → listSubIssues；只有 gh 是假的。
 * 这条电话不经过快照，是面板顶栏统计数字的首选来源。
 */
async function mapTicketsOf(world: World): Promise<any> {
  const mapBody = createMapBody()
  const grouping = createTicketGrouping()
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
  return createMapTickets({
    canonicalKey: async function (dir: string) { return dir },
    selectEarly: async function () { return SEL },
    isComposerSelection: function () { return true },
    // 仓库身份由后端自己回答；这一扇只判数字，身份用固定的完整坐标，不再花一次远端定位。
    getTrackerRegistry: async function () {
      return {
        get: function (id: string) { return registry.get(id) },
        describe: function () { return { backend: 'github', refId: REPO_ID, name: REPO_ID, url: 'https://github.com/' + REPO_ID } },
      }
    },
    getPlatform: async function () { return hostCtx.platform },
    ctx: { get: function () { return undefined } },
    DEFAULT_CWD: CWD,
    logCtx: null,
    groupTickets: grouping.groupTickets,
    getMapBody: async function () { return mapBody },
    detectionExec: function (c: string, a: string[], o: any) { return hostCtx.exec(c, a, o) },
    openSession: async function () { return null },
  })
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
  // #1870：这一段原来从「旧快照装配（snapshot-build）」一路走到信封与六格。那份装配在生产里
  // 没有调用点了，面板的列表与容器树改由本地快照库的读投影出（首屏与断网回放由 1863 / 1869 那两扇盯），
  // 所以这里只留「面板真正走的那条按需取数电话」——它才是顶栏六格数字的主来源。
  // ── 五、面板真正走的那条路：wf.mapTickets 从原始回包到六格 ─────────────
  //
  // 面板顶栏与容器三态优先用这条电话取回来的 stats（取不到才退回上面那份快照），
  // 所以它才是「面板数字」的主路径；这一节从原始 gh 回包一路走到六格，逐格对账。
  console.log('== 五、面板真正走的那条路：wf.mapTickets 从原始回包到六格 ==')
  const phoneWorld = makeWorld()
  const phone = await mapTicketsOf(phoneWorld)
  const live = await phone.handleMapTickets({ cwd: CWD, key: '100' })
  check(live && live.ok === true, '五、地图 #100 的按需取数成功（面板顶栏优先用这份数字）', live && live.ok)
  check(live && live.key === '100', '五、回包带地图编号', live && live.key)
  const liveRows = (live && Array.isArray(live.items)) ? live.items : []
  check(liveRows.length === 5, '五、五张子票一张不少', liveRows.length)
  check(same(liveRows.map(function (r: any) { return r.number }), [101, 102, 103, 104, 105]), '五、子票编号与现场一致', show(liveRows.map(function (r: any) { return r.number }), [101, 102, 103, 104, 105]))
  check(same(liveRows.map(function (r: any) { return r.state }), ['OPEN', 'OPEN', 'OPEN', 'OPEN', 'CLOSED']), '五、状态转成界面要的大写', show(liveRows.map(function (r: any) { return r.state }), 'OPEN/CLOSED 序列'))
  check(liveRows[0] && liveRows[0].progress === 60, '五、进度从正文解析成 60', liveRows[0] && liveRows[0].progress)
  check(liveRows.every(function (r: any) { return !('body' in r) && !('comments' in r) }), '五、正文与评论不随行数据交给界面')
  check(same(liveRows.map(function (r: any) { return r.claimedBy }), ['', 'alice', '', '', '']), '五、认领人从指派人里取第一个', show(liveRows.map(function (r: any) { return r.claimedBy }), ['', 'alice', '', '', '']))
  check(liveRows[2] && same(liveRows[2].blockedBy, ['104']), '五、阻塞引用压成编号字符串', show(liveRows[2] && liveRows[2].blockedBy, ['104']))
  check(liveRows[3] && same(liveRows[3].blockedBy, []), '五、没有被阻塞的票给空数组（不是漏字段）', liveRows[3] && liveRows[3].blockedBy)
  check(liveRows[0] && same(liveRows[0].labels, [{ name: 'wayfinder:task', color: '0e8a16' }]), '五、标签带名字与颜色', show(liveRows[0] && liveRows[0].labels, [{ name: 'wayfinder:task', color: '0e8a16' }]))
  check(live && same(live.stats, HAND_STATS), '五、六格统计与两层分层和手数一致', show(live && live.stats, HAND_STATS))
  check(live && live.total === 5 && live.fetched === 5 && live.capped === false && live.missing === 0, '五、总数 / 实到 / 截断 / 差额四格照实交代', show(live && { total: live.total, fetched: live.fetched, capped: live.capped, missing: live.missing }, { total: 5, fetched: 5, capped: false, missing: 0 }))
  const phoneCalls = phoneWorld.calls
  check(phoneCalls.length === 1 && phoneCalls[0].cmd === 'gh', '五、整趟只发一条 gh 命令（没有旁路）', phoneCalls.map(function (c: any) { return c.cmd + ' ' + c.args.join(' ') }))
  check(phoneCalls.length === 1 && String(phoneCalls[0].args.join(' ')).indexOf('subIssues') >= 0 && String(phoneCalls[0].args.join(' ')).indexOf('number=100') >= 0 && String(phoneCalls[0].args.join(' ')).indexOf('owner=acme') >= 0 && String(phoneCalls[0].args.join(' ')).indexOf('name=demo') >= 0, '五、按地图 #100 与仓库坐标取子票', phoneCalls[0] && phoneCalls[0].args.join(' '))
  check(worldUnhandled(phoneWorld) === 0, '五、没有门禁没脚本化却被悄悄放过的命令', phoneWorld.unhandled.join(' | '))
  // 失败面：地图 #200 的子票查询回 errors，这一条电话必须如实失败、不交半份数据。
  const live200 = await phone.handleMapTickets({ cwd: CWD, key: '200' })
  check(live200 && live200.ok === false, '五、子票取不回来时如实失败', live200 && live200.ok)
  check(live200 && live200.error && typeof live200.error.kind === 'string', '五、失败原因带可归类的档位（不吞成一句空话）', show(live200 && live200.error, '{kind,...}'))
  // 敏感性：现场一变（#104 关闭，#103 解锁），手写 stats 期望就不成立。
  const phoneChangedWorld = makeWorld()
  phoneChangedWorld.sub100[3] = rowToNode({ number: 104, title: '子票 104', state: 'CLOSED', updatedAt: '2026-03-05T00:00:00Z', author: false })
  const changed = await (await mapTicketsOf(phoneChangedWorld)).handleMapTickets({ cwd: CWD, key: '100' })
  check(changed && changed.ok === true && changed.stats.blocked === 0 && changed.stats.open === 3 && changed.stats.closed === 2, '五、把 #104 改关之后 #103 解锁（open3 / closed2 / blocked0）', show(changed && changed.stats, { open: 3, closed: 2, blocked: 0 }))
  check(changed && !same(changed.stats, HAND_STATS), '五、现场一变，原来的手写 stats 期望就不成立')

  // ── 八、自检：门禁自己不联网、不偷跑别的进程 ───────────────────────────
  console.log('== 八、自检：门禁自身不联网、不另起进程 ==')
  const selfSource = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const forbidden = [
    'child' + '_process',
    'spawn' + '(',
    'exec' + 'Sync',
    'gh' + '.exe',
    'https://api' + '.github.com',
  ]
  forbidden.forEach(function (word) {
    check(selfSource.indexOf(word) < 0, '八、门禁源码不含 ' + word, selfSource.indexOf(word))
  })
  check(selfSource.indexOf("from '../src/tracker/rooms/github/room/index.ts'") >= 0, '八、门禁加载的是真 GitHub 房间（不是假会话）')
  check(selfSource.indexOf("from '../src/host/mapTickets.ts'") >= 0, '八、门禁加载的是面板真正走的取数电话（不是另抄一份口径）')
  check(selfSource.indexOf("from '../src/refresh/rooms/host/session-opener.ts'") >= 0, '八、门禁加载的是真会话装配（出站都经会话管线）')

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
