/**
 * tests/verify-690-closed-pages.js — #690（已关闭票按需翻页与三个触发点）门禁。
 *
 * 为什么要有这一条：契约那一段（tests/tracker-contract/sections/listPage.js）守的是「后端那一页取得对不对」，
 *   而这一票真正要做到的是**界面上那件事**：「需要的时候能看到全部已关闭票」。中间隔着两处只有跑起来才看得见的
 *   东西 —— 一份跨静默刷新活着的页数据（kernel/issue-pages.js），和三个必须走同一条路的触发点（ListTab 与它的
 *   叶子 ListTabClosed.js）。这一段把这两处钉住。
 *
 * 两半：
 *   一、行为断言：把内核模块的源码取出来，喂进三个替身（身份算法 idOf、通知 emit、取页 fetchIssuesPage）跑真行为
 *      —— 分桶、去重、静默刷新不清空、上限十页、游标失效重取第一页、后端不支持时不再重试，逐条验。
 *      页数据是「状态层」，不这么喂就只能对着源码猜，而猜不出的正是这些容易写错的边界。
 *   二、接线断言：对 ListTab.js / ListTabClosed.js / api-io.js / 词条文件 / 宿主电话的源码文本判「这三处触发点
 *      走的是同一条路」。文本判据容易被「改了个名字但行为没变」误伤 —— 所以每条都配 ✗ 反例：把写坏的样本喂给
 *      检查器，它必须报违规（否则这一段等于没写）。
 *
 * 用法：node tests/verify-690-closed-pages.js（在插件根目录）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

console.log('#690 门禁（已关闭票按需翻页：页数据的分桶/去重/不清空/上限，与三个触发点走同一条路）')

// ── 一、行为断言：把内核模块的源码喂进替身跑真行为 ──
// 替身说明：idOf 与真实那一份同口径（工作单元 + 编号），emit 只计数，fetchIssuesPage 由每个用例按需给回包。
function loadIssuePagesModule(fetchStub) {
  const raw = read('src/client/kernel/issue-pages.js').replace(/^(\s*)export\s+/gm, '$1')
  const emitCount = { n: 0 }
  const idOfStub = (x) => String((x && x.effortId ? x.effortId : '') + '|' + (x && x.key != null ? x.key : (x && x.number != null ? x.number : '')))
  const factory = new Function('idOf', 'emit', 'fetchIssuesPage', raw + '\nreturn { ISSUE_PAGE_MAX: ISSUE_PAGE_MAX, issuePageFilterOf: issuePageFilterOf, issuePageKeyOf: issuePageKeyOf, issuePageBucketRead: issuePageBucketRead, issuePageBucketOf: issuePageBucketOf, issuePageRowsOf: issuePageRowsOf, issuePageStatOf: issuePageStatOf, loadIssuePage: loadIssuePage }')
  return { mod: factory(idOfStub, () => { emitCount.n++ }, fetchStub), emitCount }
}

const mkSt = (over) => Object.assign({
  cwd: '/ws',
  workspaceRoot: '/ws',
  stateFilter: 'all',
  effFilters: [],
  lblFilters: [],
  snapshot: { selection: { backendId: 'github' }, repository: { backend: 'github', refId: 'acme/demo' }, issues: [], maps: [] },
}, over || {})

/** 一个会照单发货的取页替身：按调用次序回队列里的回包，记下每次入参。 */
function mkFetcher(responses) {
  const calls = []
  const fn = (st, opts) => {
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
    const responses = []
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

// ── 二、接线断言：三个触发点走同一条路 ──
/** 列表页检查器：三个触发点齐不齐、是不是都走 loadIssuePage / issuePageRowsOf。 */
export function listTabWiringCheck(src) {
  const bad = []
  if (!/const issues = ticketRowsOf\(.*\)\.concat\(issuePageRowsOf\(st, 'list'\)\)/.test(src)) bad.push('主列表没有把翻回来的页并进已关闭那一堆（应 concat(issuePageRowsOf(st, \'list\'))）')
  if (!/useClosedPageScroll\(st, st\.stateFilter === 'closed' \|\| st\.closedFoldOpen === true\)/.test(src)) bad.push('滚到底触发点没有挂上（查 useClosedPageScroll 的启用条件）')
  if (!/onToggle: function \(e\) \{.*loadIssuePage\(st, \{ view: 'list' \}\)/.test(src)) bad.push('展开折叠行没有触发取页（details 的 onToggle 里要调 loadIssuePage）')
  if (!/closedPagesNode\(h, st, closedRows\.length\)/.test(src)) bad.push('「已加载 x / 共 N」那一行没有挂上（应调 closedPagesNode）')
  return bad
}
/** 叶子检查器：滚到底这件事盯的是面板那个滚动容器，且只顺着游标往后取。 */
export function leafWiringCheck(src) {
  const bad = []
  if (!/querySelector\('\.dsws-body'\)/.test(src)) bad.push('滚到底没有盯面板的滚动容器（.dsws-body）')
  if (!/loadIssuePage\(st, \{ view: 'list', next: true \}\)/.test(src)) bad.push('滚到底没有走「要下一页」这一支')
  if (!/loadIssuePage\(st, \{ view: 'list' \}\)/.test(src)) bad.push('进「已关闭」视图时没有先备第一页')
  if (!/addEventListener\('scroll', onScroll, \{ passive: true, capture: true \}\)/.test(src)) bad.push('滚动监听不是 passive 且捕获相（会把滚动拖卡，或收不到不冒泡的滚动事件）')
  for (const k of ['list.pageLoaded', 'list.pageAllOnWeb', 'list.pageStale', 'list.pageFail']) {
    if (src.indexOf("'" + k + "'") < 0) bad.push('这一行少了一条要说的情形：' + k)
  }
  return bad
}
/** 电话检查器：客户端走 wf.issuesPage，并且这一页的取数落在 issues.page 这条常驻日志上。 */
export function apiIoWiringCheck(src) {
  const bad = []
  if (!/host\.call\('wf\.issuesPage'/.test(src)) bad.push('没有走 wf.issuesPage 这条电话')
  if (!/log\('info', 'issues\.page'/.test(src) || !/log\('warn', 'issues\.page'/.test(src)) bad.push('issues.page 这条常驻日志没有落点（成功与失败各一条）')
  for (const f of ['state', 'labelsCount', 'returned', 'total', 'latencyMs', 'ok', 'errorHash']) {
    if (src.indexOf(f + ':') < 0) bad.push('issues.page 少了字段 ' + f)
  }
  return bad
}
/** 词条检查器：五条文案中英各一份。 */
export function localeCheck(src) {
  const keys = ['list.pageLoaded', 'list.pageAllOnWeb', 'list.pageStale', 'list.pageFail', 'list.pageTrimmed']
  return keys.filter((k) => (src.split("'" + k + "':").length - 1) !== 2).map((k) => k + ' 不是中英各一份')
}

{
  const listTab = read('src/client/views/ListTab.js')
  const leaf = read('src/client/views/ListTabClosed.js')
  const apiIo = read('src/client/kernel/api-io.js')
  const locale = read('src/client/kernel/locale-pages.js')
  const hostIndex = read('src/host/index.js')
  check(listTabWiringCheck(listTab).length === 0, 'ListTab：三个触发点齐、并走同一条路（' + (listTabWiringCheck(listTab).join('；') || '全部命中') + '）')
  check(leafWiringCheck(leaf).length === 0, 'ListTabClosed：滚到底盯 .dwsb-body、四种情形都说得出（' + (leafWiringCheck(leaf).join('；') || '全部命中') + '）')
  check(apiIoWiringCheck(apiIo).length === 0, 'api-io：走 wf.issuesPage 并落 issues.page（' + (apiIoWiringCheck(apiIo).join('；') || '全部命中') + '）')
  check(localeCheck(locale).length === 0, '词条：五条文案中英各一份（' + (localeCheck(locale).join('；') || '全部命中') + '）')
  check(hostIndex.indexOf("harness.handle('wf.issuesPage'") >= 0, '宿主：wf.issuesPage 已注册（电话入口在 index.js）')

  // ✗ 反例：把写坏的样本喂给检查器，必须报违规（否则这一段形同虚设）
  check(listTabWiringCheck(listTab.replace(/useClosedPageScroll\(st, [^\n]*\)/, 'useClosedPageScroll(st, false)')).length > 0, '✗ probe: 滚到底触发点被摘掉被逮')
  check(listTabWiringCheck(listTab.replace(/onToggle: function \(e\) \{[^\n]*\}/, '')).length > 0, '✗ probe: 展开折叠行不再取页被逮')
  check(leafWiringCheck(leaf.replace(/querySelector\('\.dsws-body'\)/g, "querySelector('.dsws-nowhere')")).length > 0, '✗ probe: 滚到底盯错了容器被逮')
  check(apiIoWiringCheck(apiIo.replace(/host\.call\('wf\.issuesPage'/, "host.call('wf.issuesPageX'")).length > 0, '✗ probe: 电话名写错被逮')
  check(apiIoWiringCheck(apiIo.replace(/'issues\.page'/g, "'issues.pages'")).length > 0, '✗ probe: 事件名写成另一个被逮（日志点必须落在白名单上的那一个）')
  check(localeCheck(locale.replace(/'list\.pageStale': '[^']+',\n?/g, '')).length > 0, '✗ probe: 少一条词条被逮')
}

console.log('\n共 ' + total + ' 条断言')
if (failed) { console.log('存在失败'); process.exit(1) }
console.log('全部通过')
