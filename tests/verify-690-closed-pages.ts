/**
 * tests/verify-690-closed-pages.js — #690（已关闭票按需翻页与三个触发点）门禁。
 *
 * 为什么要有这一条：契约那一段（tests/tracker-contract/sections/listPage.js）守的是「后端那一页取得对不对」，
 *   而这一票真正要做到的是**界面上那件事**：「需要的时候能看到全部已关闭票」。中间隔着只有跑起来才看得见的
 *   东西 —— 一份跨静默刷新活着的页数据（kernel/issue-pages.js）。这一段把它钉住。
 *
 * 做法：
 *   一、行为断言：把内核模块的源码取出来，喂进三个替身（身份算法 idOf、通知 emit、取页 fetchIssuesPage）跑真行为
 *      —— 分桶、去重、静默刷新不清空、上限十页、游标失效重取第一页、后端不支持时不再重试，逐条验。
 *      页数据是「状态层」，不这么喂就只能对着源码猜，而猜不出的正是这些容易写错的边界。
 *
 * 用法：node tests/verify-690-closed-pages.ts（在插件根目录）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// 本文件选 compileFn 手法：只是把内核模块源码当函数体造函数，三个替身本来就按参数名传进去。
import { compileFn } from './lib/eval-probe.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

console.log('#690 门禁（已关闭票按需翻页：页数据的分桶/去重/不清空/上限，与三个触发点走同一条路）')

// ── 一、行为断言：把内核模块的源码喂进替身跑真行为 ──
// 替身说明：idOf 与真实那一份同口径（工作单元 + 编号），emit 只计数，fetchIssuesPage 由每个用例按需给回包。
function loadIssuePagesModule(fetchStub: any) {
  const raw = read('src/client/kernel/issue-pages.js').replace(/^(\s*)export\s+/gm, '$1')
  const emitCount = { n: 0 }
  const idOfStub = (x: any) => String((x && x.effortId ? x.effortId : '') + '|' + (x && x.key != null ? x.key : (x && x.number != null ? x.number : '')))
  // 本处走 compileFn：参数名与替身一一对应，函数体与原来逐字相同。
  const factory = compileFn(['idOf', 'emit', 'fetchIssuesPage'], raw + '\nreturn { ISSUE_PAGE_MAX: ISSUE_PAGE_MAX, issuePageFilterOf: issuePageFilterOf, issuePageKeyOf: issuePageKeyOf, issuePageBucketRead: issuePageBucketRead, issuePageBucketOf: issuePageBucketOf, issuePageRowsOf: issuePageRowsOf, issuePageStatOf: issuePageStatOf, loadIssuePage: loadIssuePage }')
  return { mod: factory(idOfStub, () => { emitCount.n++ }, fetchStub), emitCount }
}

const mkSt = (over: any) => Object.assign({
  cwd: '/ws',
  workspaceRoot: '/ws',
  stateFilter: 'all',
  effFilters: [],
  lblFilters: [],
  snapshot: { selection: { backendId: 'github' }, repository: { backend: 'github', refId: 'acme/demo' }, issues: [], maps: [] },
}, over || {})

/** 一个会照单发货的取页替身：按调用次序回队列里的回包，记下每次入参。 */
function mkFetcher(responses: any[]) {
  const calls: any[] = []
  // 替身函数额外挂 calls 账本，按任意函数处理（运行时与原来一样）。
  const fn: any = (st: any, opts: any) => {
    calls.push(opts)
    const r = responses.length ? responses.shift() : { ok: true, items: [], nextCursor: null, total: 0 }
    return Promise.resolve(r)
  }
  fn.calls = calls
  return fn
}

{
  // 1）第一页：取回、进桶、「已加载 x / 共 N」两个数都在
  {
    const fetchStub = mkFetcher([{ ok: true, items: [{ key: '9', state: 'CLOSED' }, { key: '8', state: 'CLOSED' }], nextCursor: 'CUR2', total: 649 }])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    const stat = mod.issuePageStatOf(st, 'list')
    check(fetchStub.calls.length === 1 && fetchStub.calls[0].state === 'closed' && fetchStub.calls[0].cursor === '', '第一页：向宿主报「要已关闭票、没有游标」（请求按同一口径发出）')
    check(stat.loaded === 2 && stat.total === 649 && stat.hasMore === true && stat.pages === 1, '第一页：进桶了（已加载 2 / 共 649，还有下一页）')
    check(mod.issuePageRowsOf(st, 'list').length === 2, '第一页：行可以从桶里取出来画（池子里没有的那些）')
  }

  // 2）已有页就不重复取；顺着游标取下一页
  {
    const fetchStub = mkFetcher([
      { ok: true, items: [{ key: '9', state: 'CLOSED' }], nextCursor: 'CUR2', total: 649 },
      { ok: true, items: [{ key: '7', state: 'CLOSED' }], nextCursor: null, total: 649 },
    ])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    await mod.loadIssuePage(st, { view: 'list' })
    check(fetchStub.calls.length === 1, '已经备过第一页：第二次叫它什么都不做（不白发请求）')
    await mod.loadIssuePage(st, { view: 'list', next: true })
    check(fetchStub.calls.length === 2 && fetchStub.calls[1].cursor === 'CUR2', '滚到底：顺着上一页给的游标取下一页')
    const stat = mod.issuePageStatOf(st, 'list')
    check(stat.loaded === 2 && stat.hasMore === false, '翻到底：两页都在手上，游标已空（不再有下一页）')
    await mod.loadIssuePage(st, { view: 'list', next: true })
    check(fetchStub.calls.length === 2, '没有下一页了：再叫它也不发请求（不空转）')
  }

  // 3）去重按身份、同号票以后到的那份为准
  {
    const fetchStub = mkFetcher([
      { ok: true, items: [{ key: '9', title: '旧标题', state: 'CLOSED' }], nextCursor: 'CUR2', total: 3 },
      { ok: true, items: [{ key: '9', title: '新标题', state: 'CLOSED' }, { key: '7', state: 'CLOSED' }], nextCursor: null, total: 3 },
    ])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    await mod.loadIssuePage(st, { view: 'list', next: true })
    const rows = mod.issuePageRowsOf(st, 'list')
    const nine = rows.filter((x) => x.key === '9')
    check(rows.length === 2 && nine.length === 1, '去重：同一个编号出现两次也只留一行（' + rows.length + ' 行）')
    check(nine[0] && nine[0].title === '新标题', '去重：同号票以「后到的那份」为准（内容是新来的那份）')
  }

  // 4）静默刷新不清空已加载的页；池子里已有的行不重复画
  {
    const fetchStub = mkFetcher([{ ok: true, items: [{ key: '9', state: 'CLOSED' }, { key: '7', state: 'CLOSED' }], nextCursor: null, total: 2 }])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    // 静默刷新：整份快照被换掉（这是 probe-snapshot.js 那条路的真实行为），其中一条与页数据同号
    st.snapshot = { selection: { backendId: 'github' }, repository: { backend: 'github', refId: 'acme/demo' }, issues: [{ key: '7', title: '刷新后的 7', state: 'CLOSED' }], maps: [] }
    const rows = mod.issuePageRowsOf(st, 'list')
    check(rows.length === 1 && rows[0].key === '9', '静默刷新之后，翻出来的页仍在（只剩池子里没有的那一条要画，不重复）')
    check(mod.issuePageStatOf(st, 'list').loaded === 2, '静默刷新之后，桶里的行数一个没少（刷新碰不到页数据）')
  }

  // 5）分桶：切后端 / 切工作区 / 换筛选 = 换一个桶，旧桶的数据不跑到新桶里
  {
    const fetchStub = mkFetcher([{ ok: true, items: [{ key: '9', state: 'CLOSED' }], nextCursor: null, total: 1 }])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    const before = mod.issuePageKeyOf(st, 'list')
    check(before.indexOf('github') >= 0, '桶键里带着后端标识（' + before.replace(/\|/g, ' / ') + '）')
    st.snapshot = Object.assign({}, st.snapshot, { selection: { backendId: 'markdown' } })
    check(mod.issuePageRowsOf(st, 'list').length === 0, '切了后端：旧桶的数据不显示（换了一把钥匙）')
    check(mod.issuePageStatOf(st, 'list').pages === 0, '切了后端：新桶是空的（要重新翻）')
    check(mod.issuePageRowsOf(mkSt({ stateFilter: 'closed' }), 'map').length === 0, '换了视图（列表 / 地图）：两个视图各存各的，不互相污染')
  }

  // 6）上限十页：超了从最旧的页开始丢，并且让界面知道「再往上滚要重新加载」
  {
    const responses: any[] = []
    for (let i = 0; i < 12; i++) responses.push({ ok: true, items: [{ key: String(100 - i), state: 'CLOSED' }], nextCursor: 'C' + (i + 1), total: 999 })
    const fetchStub = mkFetcher(responses)
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    for (let i = 0; i < 12; i++) await mod.loadIssuePage(st, { view: 'list', next: i > 0 })
    const stat = mod.issuePageStatOf(st, 'list')
    check(mod.ISSUE_PAGE_MAX === 10, '上限写的是十页（规格第 7.2 节）')
    check(stat.pages === 10, '翻了十二页后，手上只留十页（多的从最旧的开始丢）')
    check(stat.trimmed === true, '丢过页这件事记在桶上（界面据此说「再往上滚要重新加载」）')
    check(stat.loaded === 10, '留下的十页各一行都在（丢的是整页，不是零散几行）')
  }

  // 7）游标失效：丢游标、重取第一页、并把这件事说出来
  {
    const fetchStub = mkFetcher([
      { ok: true, items: [{ key: '9', state: 'CLOSED' }], nextCursor: 'CUR2', total: 649 },
      { ok: false, error: { kind: 'not-found', message: 'listPage: 游标已失效，请重新加载（after cursor is invalid）' } },
      { ok: true, items: [{ key: '9', state: 'CLOSED' }, { key: '8', state: 'CLOSED' }], nextCursor: 'CUR3', total: 650 },
    ])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    await mod.loadIssuePage(st, { view: 'list', next: true })
    check(fetchStub.calls.length === 3 && fetchStub.calls[2].cursor === '', '游标失效：自动丢掉游标、重取第一页（第三次请求没有游标）')
    const stat = mod.issuePageStatOf(st, 'list')
    check(stat.notice === 'stale', '游标失效：这件事记在桶上，界面据此说「已从最近的一页重新开始」')
    check(stat.loaded === 2 && stat.total === 650 && stat.pages === 1, '游标失效：桶里现在就是新取回的第一页（旧页按失效处理，不混着用）')
  }

  // 8）后端不支持翻页：不重试、不重取，界面据此显示「在网页上看全部」
  {
    const fetchStub = mkFetcher([
      { ok: false, error: { kind: 'unsupported', message: 'backend github does not implement op listPage' } },
      { ok: true, items: [{ key: '1', state: 'CLOSED' }], nextCursor: null, total: 1 },
    ])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    const stat = mod.issuePageStatOf(st, 'list')
    check(stat.notice === 'noweb' && stat.pages === 0, '后端说做不到：记「去网页上看」，不假装取回了空的一页')
    await mod.loadIssuePage(st, { view: 'list' })
    check(fetchStub.calls.length === 1, '后端说做不到：不反复重试（用户不点就不再来回撞）')
  }

  // 9）其它失败（网络 / 配额）：如实记为失败，已经加载的页不受影响
  {
    const fetchStub = mkFetcher([
      { ok: true, items: [{ key: '9', state: 'CLOSED' }], nextCursor: 'CUR2', total: 9 },
      { ok: false, error: { kind: 'rate-limit', message: '配额用完了' } },
    ])
    const { mod } = loadIssuePagesModule(fetchStub)
    const st = mkSt({ stateFilter: 'closed' })
    await mod.loadIssuePage(st, { view: 'list' })
    await mod.loadIssuePage(st, { view: 'list', next: true })
    const stat = mod.issuePageStatOf(st, 'list')
    check(stat.notice === 'fail' && stat.loaded === 1, '取不到下一页：如实记为失败，已经加载的那一页还在（不被清掉）')
  }

  // 10）宿主侧那两样必须补的字段（研究底稿第 6.3 节：number 与大写 state）
  {
    const host = await import('file://' + path.join(ROOT, 'src/host/issuePage.js').replace(/\\/g, '/'))
    const row = host.createIssuePage({}).clientRowOf({ key: '42', state: 'closed', labels: [{ name: 'bug', color: 'ff0000' }], blockedBy: [{ key: '7' }, '8'] })
    check(row.number === 42 && row.key === '42', '宿主补 number：键字符串照样补出数字编号（点行才不会压进 undefined）')
    check(row.state === 'CLOSED', '宿主把 state 升成大写（界面全篇按大写比）')
    check(Array.isArray(row.blockedBy) && row.blockedBy.length === 2 && row.blockedBy[0] === '7' && row.blockedBy[1] === '8', '阻塞引用按快照那条链的同一形状压成键数组（两种入参形状都认）')
    const rowOpen = host.createIssuePage({}).clientRowOf({ key: '7', state: 'open' })
    check(rowOpen.state === 'OPEN' && !('number' in {}) && rowOpen.number === 7, '未关闭的行同样补好 number 与大写 state')
  }
}


console.log('\n共 ' + total + ' 条断言')
if (failed) { console.log('存在失败'); process.exit(1) }
console.log('全部通过')
