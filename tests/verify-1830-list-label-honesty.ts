/**
 * tests/verify-1830-list-label-honesty.ts —— 标签筛选不再在 500 条窗口里静默漏票（#1830）。
 *
 * 病根（从第一性原理看）：
 *   deck_issue_list 的过滤分两层 —— 后端只收到 state/type，labels/assignee/query 全在内存里筛。
 *   GitHub 房一次列表只翻到 500 条工单就停（按更新时间倒序），于是「已关闭 + bug」这种筛法
 *   先在 500 条窗口里内存筛出 172 行，再如实报 total=172/returned=172/truncated=false ——
 *   三个数都「对」，但它们说的只是窗口，不是仓库；data 上没有任何一格能看出后端已经到顶
 *   （那句话只写在 notes 里），调用方与读者就把 172 行当成全部。比它更新更少的 #1303 掉在窗口外。
 *
 * 修法的三件事，本门禁逐件钉住：
 *   ① 房层：labels 与 state 一样下推进查询（GraphQL 用 $labels 变量，REST 降级用 labels= 参数），
 *      标签筛选在服务端就收窄了窗口，不再从 500 条里挑；
 *   ② 内存兜底：applyIssueFilter 按 AND 收窄，比较大小写不敏感（GitHub 的标签匹配本来就大小写不敏感，
 *      严格全等会把后端匹配上的行又丢掉，等于换一种方式漏票）；
 *   ③ 回执：deck_issue_list 的 data 永远带 backendTruncated 布尔，「本地 limit 截断」（truncated）
 *      与「后端到自己的上限就停」（backendTruncated）是两件事，分开说；notes 与 text 说的是同一件事。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1830-list-label-honesty.ts
 *
 * 门禁归属: src/tracker/rooms/github/read/issues.ts
 * 门禁归属: src/tracker/rooms/github/read/issues-rest-list.ts
 * 门禁归属: src/tracker/rooms/github/model/issue-filter.ts
 * 门禁归属: src/tracker/rooms/github/channels/graphql/queries.ts
 * 门禁归属: src/deck/tools/issue-list.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chooseWorkspace, makeDecideStub } from './lib/deck-decide-stub.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let failed = false
let total = 0
const check = function (ok, msg, got) {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (got === undefined ? '' : '（实得 ' + JSON.stringify(got) + '）'))
  if (!ok) failed = true
}

// ───────────────────────── 一、房层：labels 下推进查询 ─────────────────────────

const ISSUES_EMPTY = { data: { repository: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }
const PULLS_EMPTY = { data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }

/** 脚本化 gh：记录每一次实参；GraphQL 回空页，REST 回空数组；graphqlFail 时把 GraphQL 打挂。 */
function scriptedCtx(calls, opts) {
  const exec = async function (_cmd, args) {
    const joined = (args || []).join(' ')
    calls.push(joined)
    if (joined.indexOf('graphql') >= 0) {
      if (opts && opts.graphqlFail) return { code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' }
      return { code: 0, stdout: JSON.stringify(joined.indexOf('pullRequests(') >= 0 ? PULLS_EMPTY : ISSUES_EMPTY), stderr: '' }
    }
    return { code: 0, stdout: '[]', stderr: '' }
  }
  return {
    cwd: '/ws/fake',
    outbound: opts && opts.outbound,
    platform: { resolveExecutable: async function () { return 'gh' } },
    exec: exec,
    isEnabled: function () { return false },
    logEvent: function () {},
  }
}

async function partRoom() {
  console.log('— 一、房层：标签筛进 GraphQL 变量与 REST 查询参数，不再是「先取 500 条再内存挑」')
  const { createRegistry } = await imp('src/tracker/registry/core.ts')
  const { githubModule } = await imp('src/tracker/rooms/github/room/index.ts')
  const { createOutboundControl } = await imp('src/refresh/rooms/host/outbound-control.js')

  const regCtx = { logEvent: function () {}, isEnabled: function () { return false } }
  const reg = createRegistry(regCtx, { matchesTimeout: 200 })
  const d = reg.register(githubModule)
  const gh = reg.get('github')
  const ref = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
  const call = function (opts) { return scriptedCtx([], Object.assign({ outbound: createOutboundControl() }, opts)) }

  // 一、state=closed + labels=['bug']：工单查询与拉取请求查询都带标签变量。
  {
    const calls = []
    const ctx = scriptedCtx(calls, { outbound: createOutboundControl() })
    await gh.list(ref, { state: 'closed', labels: ['bug'] }, ctx)
    const issueCmd = calls.filter(function (c) { return c.indexOf('issues(first:') >= 0 }).join('\n')
    const prCmd = calls.filter(function (c) { return c.indexOf('pullRequests(') >= 0 }).join('\n')
    check(issueCmd.indexOf('labels[]=bug') >= 0, '一、工单查询带 labels[]=bug（标签下推，不在 500 条窗口里内存挑）', issueCmd.slice(0, 260))
    check(issueCmd.indexOf('filterBy:{labels:$labels}') >= 0, '一、工单查询用 filterBy.labels（与 counts 那条同一写法）', issueCmd.slice(0, 260))
    check(issueCmd.indexOf('states[]=CLOSED') >= 0, '一、状态与标签同时下推（states[] 仍在）', issueCmd.slice(0, 260))
    check(prCmd.indexOf('labels[]=bug') >= 0 && prCmd.indexOf('labels:$labels') >= 0, '一、拉取请求查询也带标签（PR 没有 filterBy，走 labels 参数）', prCmd.slice(0, 260))
  }

  // 二、没有标签筛：查询与从前一字不差，不多带变量。
  {
    const calls = []
    const ctx = scriptedCtx(calls, { outbound: createOutboundControl() })
    await gh.list(ref, {}, ctx)
    const joined = calls.join('\n')
    check(joined.indexOf('labels[]=') < 0, '二、不给 labels 时不带任何标签变量（老路径的形状不变）', joined.slice(0, 200))
    check(joined.indexOf('filterBy:{labels') < 0, '二、不给 labels 时查询正文里不出现 filterBy.labels', joined.slice(0, 200))
  }

  // 三、归一：空白项与重复项去掉，同一个标签只发一次。
  {
    const calls = []
    const ctx = scriptedCtx(calls, { outbound: createOutboundControl() })
    await gh.list(ref, { labels: [' bug ', 'bug', '', '   '] }, ctx)
    const issueCmd = calls.filter(function (c) { return c.indexOf('issues(first:') >= 0 }).join('\n')
    const hits = issueCmd.split('labels[]=bug').length - 1
    check(hits === 1, '三、重复与空白标签归一后只发一次 labels[]=bug', hits)
  }

  // 四、GraphQL 打挂走 REST：标签也要落到请求地址上。
  {
    const calls = []
    const ctx = scriptedCtx(calls, { outbound: createOutboundControl(), graphqlFail: true })
    const r = await gh.list(ref, { state: 'closed', labels: ['bug'] }, ctx)
    const issueRest = calls.filter(function (c) { return c.indexOf('/issues?') >= 0 }).join('\n')
    check(!!(r && r.ok), '四、GraphQL 失败后 REST 降级仍回成功', r && r.error && r.error.message)
    check(issueRest.indexOf('labels=bug') >= 0, '四、REST 工单请求带 labels=bug（降级路也收窄窗口）', issueRest.slice(0, 260))
  }

  // 五、带逗号的标签名不下推：REST 用逗号分隔标签，拆错名字比不下推更糟；内存兜底照旧生效。
  {
    const calls = []
    const ctx = scriptedCtx(calls, { outbound: createOutboundControl(), graphqlFail: true })
    await gh.list(ref, { labels: ['a,b'] }, ctx)
    const issueRest = calls.filter(function (c) { return c.indexOf('/issues?') >= 0 }).join('\n')
    check(issueRest.indexOf('labels=') < 0, '五、标签名带逗号时 REST 不下推（避免把名字拆错），交给内存兜底', issueRest.slice(0, 240))
  }

  d.dispose()
}

// ───────────────────────── 二、内存兜底：AND 语义、大小写不敏感 ─────────────────────────

async function partFilter() {
  console.log('— 二、内存兜底：filter.labels 按 AND 收窄，比较大小写不敏感（与 GitHub 后端匹配口径一致）')
  const { applyIssueFilter } = await imp('src/tracker/rooms/github/model/issue-filter.ts')
  const issues = [
    { key: '1', state: 'open', labels: [{ name: 'Bug', color: '' }] },
    { key: '2', state: 'open', labels: [{ name: 'bug', color: '' }, { name: 'ready-for-agent', color: '' }] },
    { key: '3', state: 'open', labels: [] },
    { key: '4', state: 'open' },
    { key: '5', state: 'open', labels: [{ name: 'wontfix', color: '' }] },
  ]
  const keysOf = function (rows) { return rows.map(function (r) { return r.key }) }
  const one = keysOf(applyIssueFilter(issues, { labels: ['bug'] }))
  check(JSON.stringify(one) === JSON.stringify(['1', '2']), '二、单标签：大小写不同也算命中（1 的 Bug、2 的 bug），没有标签的行不留', one)
  const two = keysOf(applyIssueFilter(issues, { labels: ['bug', 'ready-for-agent'] }))
  check(JSON.stringify(two) === JSON.stringify(['2']), '二、多标签是 AND：只有同时带齐的行留下', two)
  const none = keysOf(applyIssueFilter(issues, {}))
  check(none.length === 5, '二、不给 labels 时不收窄（老行为不变）', none)
}

// ───────────────────────── 三、回执：本地截断与后端截断分开说 ─────────────────────────

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1830-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
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
  return {
    root: root,
    rootPosix: rootPosix,
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 三行带 bug 标签的票：桩后端只回这几行，filter 与 truncated 都由用例指定。 */
function bugRows() {
  const out = []
  for (let i = 0; i < 3; i += 1) {
    out.push({ key: '10' + i, title: '第 ' + (i + 1) + ' 张 bug', state: 'closed', type: 'issue', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [], updatedAt: '', url: '' })
  }
  return out
}

async function makeHarness(opts) {
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const issueListMod = await imp('src/deck/tools/issue-list.ts')

  let clock = 1700000000000
  const ws = makeWorkspace()
  const ledger = ledgerMod.createLedger({ now: function () { return clock } })
  const gate = gateMod.createGate({ ledger: ledger, now: function () { return clock } })
  const registry = registryMod.createRegistry(Object.assign({ logEvent: function () {}, isEnabled: function () { return false } }, ws.ctx), { matchesTimeout: 200 })
  const seen = { filter: null }
  const stubModule = Object.assign({}, markdownModule, {
    create: function (backendCtx) {
      const tracker = markdownModule.create(backendCtx)
      tracker.list = async function (_ref, filter) {
        seen.filter = filter
        const out: Record<string, unknown> = { ok: true, data: opts.rows || [], truncated: opts.truncated === true }
        // 九、十两段要演练 REST 降级路径：桩里把 fallback / fallbackReason 一起回，形状与 GitHub 房的返回一致。
        if (opts.fallback) {
          out.fallback = opts.fallback
          out.fallbackReason = opts.fallbackReason || 'other'
        }
        return out
      }
      if (opts.thin) {
        tracker.listMaps = async function () {
          const rows = opts.thinRows || []
          return { ok: true, data: { rows: rows, total: rows.length, truncated: opts.thinTruncated === true } }
        }
      }
      return tracker
    },
  })
  registry.register(stubModule)
  chooseWorkspace(ws.rootPosix, 'markdown')
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const deps = {
    gate: gate, registry: registry, budget: budget,
    estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
    backendCtx: ws.ctx,
    handleFor: function () { return { cwd: ws.rootPosix, refId: '.scratch/demo' } },
    decideBackend: makeDecideStub(registry),
    log: { fire: function () {} },
    now: function () { return clock },
  }
  const tool = issueListMod.createDeckIssueList(deps)
  const exec = { agent: { session: { id: 's-1830', cwd: ws.rootPosix } } }
  return { ws: ws, tool: tool, exec: exec, seen: seen }
}

async function runTool(opts, args) {
  const h = await makeHarness(opts)
  let r = null
  let threw = ''
  try { r = await h.tool.run(h.exec, args) } catch (e) { threw = String((e && e.message) || e) }
  h.ws.cleanup()
  return { r: r, threw: threw, seen: h.seen }
}

function notesOf(r) { return ((r && r.notes) || []).map(function (n) { return String(n) }).join('\n') }

async function partTool() {
  console.log('— 三、工具层：labels 进后端 filter；data 把「本地 limit 截断」与「后端上限截断」分开说')
  const closedArgs = { state: 'closed', labels: [' bug '], limit: 50 }

  // 三、标签筛进后端 filter（归一后是 ['bug']），state 也照旧下推。
  const a = await runTool({ rows: bugRows(), truncated: false }, closedArgs)
  check(a.threw === '', '三、工具不把异常抛给调用方' + (a.threw ? '（抛了：' + a.threw + '）' : ''))
  check(JSON.stringify(a.seen.filter) === JSON.stringify({ state: 'closed', labels: ['bug'] }), '三、filter 带 state 与归一后的 labels（标签真的下推给后端）', a.seen.filter)
  check(!!(a.r && a.r.status === 'ok'), '三、回执状态是 ok', a.r && a.r.status)

  // 四、后端到顶、本地没截断：#1830 的原症状 —— data 必须能看出后端截断。
  const b = await runTool({ rows: bugRows(), truncated: true }, closedArgs)
  const bd = (b.r && b.r.data) || {}
  check(bd.backendTruncated === true, '四、后端到顶时 data.backendTruncated === true（本票的核心）', bd.backendTruncated)
  check(bd.truncated === false, '四、返回行数没超 limit 时 data.truncated 仍是 false（本地没截断）', bd.truncated)
  check(bd.returned === 3 && bd.total === 3, '四、total/returned 照旧按这次拿到的行算', { total: bd.total, returned: bd.returned })
  check(notesOf(b.r).indexOf('可能不全') >= 0, '四、notes 说「可能不全」', notesOf(b.r))
  check(String(b.r.text || '').indexOf('可能不全') >= 0, '四、text 也把后端截断说出来（notes 与 data 说同一件事）', b.r && b.r.text)

  // 五、本地 limit 截断、后端没到顶：两层不许混成一个数。
  const c = await runTool({ rows: bugRows(), truncated: false }, { state: 'closed', limit: 2 })
  const cd = (c.r && c.r.data) || {}
  check(cd.truncated === true, '五、行数超过 limit 时 data.truncated === true', cd.truncated)
  check(cd.backendTruncated === false, '五、后端没到顶时 data.backendTruncated === false', cd.backendTruncated)
  check(notesOf(c.r).indexOf('只回前 2 行') >= 0, '五、notes 说本地只回了前 2 行', notesOf(c.r))
  check(String(c.r.text || '').indexOf('可能不全') < 0, '五、后端没到顶时 text 不说「可能不全」', c.r && c.r.text)

  // 六、两层同时成立：两个旗标各说各的。
  const d = await runTool({ rows: bugRows(), truncated: true }, { state: 'closed', limit: 2 })
  const dd = (d.r && d.r.data) || {}
  check(dd.truncated === true && dd.backendTruncated === true, '六、两层同时截断时两个旗标都为 true', { truncated: dd.truncated, backendTruncated: dd.backendTruncated })

  // 七、薄查路径同样要分开说（地图薄查撞封顶页数时）。
  const e = await runTool({ thin: true, thinRows: [{ key: '00', title: '地图', state: 'open', url: '' }], thinTruncated: true }, { state: 'open', labels: ['wayfinder:map'] })
  const ed = (e.r && e.r.data) || {}
  check(ed.backendTruncated === true, '七、薄查撞封顶页数时 data.backendTruncated === true', ed.backendTruncated)
  check(ed.truncated === false, '七、薄查返回 1 行未超 limit 时 data.truncated === false', ed.truncated)
  check(String(e.r.text || '').indexOf('可能不全') >= 0, '七、薄查的 text 同样说「可能不全」', e.r && e.r.text)

  const f = await runTool({ thin: true, thinRows: [{ key: '00', title: '地图', state: 'open', url: '' }], thinTruncated: false }, { state: 'open', labels: ['wayfinder:map'] })
  const fd = (f.r && f.r.data) || {}
  check(fd.backendTruncated === false && fd.truncated === false, '八、薄查没到封顶时两个旗标都是 false', { truncated: fd.truncated, backendTruncated: fd.backendTruncated })

  // 九、REST 降级、但后端没撞上限：降级本身不等于清单不全，notes 与 text 都不许说「可能不全」。
  const g = await runTool({ rows: bugRows(), truncated: false, fallback: 'rest', fallbackReason: 'quota' }, closedArgs)
  const gd = (g.r && g.r.data) || {}
  check(gd.backendTruncated === false && gd.truncated === false, '九、降级但未撞后端上限时两个旗标都是 false', { truncated: gd.truncated, backendTruncated: gd.backendTruncated })
  check(gd.fallback === 'rest' && gd.fallbackReason === 'quota', '九、data 照旧写明走了 REST 降级与原因', { fallback: gd.fallback, fallbackReason: gd.fallbackReason })
  check(notesOf(g.r).indexOf('REST 降级通道') >= 0, '九、notes 照旧说明走了降级通道', notesOf(g.r))
  check(notesOf(g.r).indexOf('可能不全') < 0, '九、降级但未撞上限时 notes 不说「可能不全」', notesOf(g.r))
  check(String(g.r.text || '').indexOf('可能不全') < 0, '九、降级但未撞上限时 text 也不说「可能不全」', g.r && g.r.text)

  // 十、降级且撞到后端上限：两个旗标、notes、text 说的是同一件事。
  const h = await runTool({ rows: bugRows(), truncated: true, fallback: 'rest', fallbackReason: 'other' }, closedArgs)
  const hd = (h.r && h.r.data) || {}
  check(hd.fallback === 'rest' && hd.backendTruncated === true, '十、降级且撞上限时 data 同时有 fallback 与 backendTruncated', { fallback: hd.fallback, backendTruncated: hd.backendTruncated })
  check(notesOf(h.r).indexOf('可能不全') >= 0, '十、此时 notes 说「可能不全」', notesOf(h.r))
  check(String(h.r.text || '').indexOf('可能不全') >= 0, '十、此时 text 也说「可能不全」', h.r && h.r.text)
}

async function main() {
  await partRoom()
  await partFilter()
  await partTool()
  console.log('\n' + (failed ? 'FAIL' : 'PASS') + '：共 ' + total + ' 条断言')
  if (failed) process.exitCode = 1
}

main().catch(function (e) {
  console.error(e)
  process.exitCode = 1
})
