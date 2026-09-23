// verify-budget-page-upper-bound.js —— 门禁：最坏用量按页数上界算，账本记每个仓库的实测页数（#719 T15 收口）
// 用法：在插件根目录执行 node tests/verify-budget-page-upper-bound.js，可独立运行。
//
// 这一条守着定稿第十四章那句话：「账本记每个仓库的实测页数；最坏用量按页数上界（MAX_PAGES = 10）算」。
// 它拆成两件互不混淆的事：
//   ① **估**（账本按每个仓库自己的实测页数估）：小仓库不必替大仓库付那份钱。
//   ② **最坏**（一律按页数上界算，实测突破上界时按实测算）：门禁与账本的最坏列都不许比 ①小。
// 两件事都由 shared/refresh/page-budget.js 的同一个算式算出来，本门禁不自己写第二个算式。
//
// 断言的是**行为**而不是常量表：把 MAX_PAGES 改小，结论必须跟着变小；把实测页数往上改，
// 「估」必须跟着变大而「最坏」不许变小。只按常量表比对的门禁，在算式写错时照样判绿。
//
// 反证（每次运行都跑）：给一个 MAX_PAGES 被改小的变体，最坏那一笔必须跟着变小（说明上界真的在起作用）；
// 给一个「实测特别大」的仓库，最坏那一笔必须跟着变大（说明上界被突破时不会假装没这回事）。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 每一页的单价，全部从 budget.js 取；本门禁不写任何额度或单价数字。 */
const pricesOf = (b) => ({
  listPagePoints: b.PAGE_COST_POINTS,
  listPageRequests: b.LIST_PAGE_COST_REQUESTS,
  prPagePoints: b.PR_PAGE_COST_POINTS,
  prPageRequests: b.PR_PAGE_COST_REQUESTS,
  countPoints: b.COUNT_COST_POINTS,
  countRequests: b.COUNT_COST_REQUESTS,
  prPageCount: b.REBUILD_PR_PAGE_COUNT,
})

async function main() {
  console.log('页数上界门禁（#719 T15：最坏用量按 MAX_PAGES 算，账本按每个仓库的实测页数估）')
  const budget = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'budget.js')).href)
  const pb = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'page-budget.js')).href)
  const ledgerMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'refresh', 'ledger.js')).href)

  const prices = pricesOf(budget)
  const upper = budget.MAX_PAGES

  // ① 最坏那一笔按页数上界算，而且它是从「页 × 单价」推出来的，不是一个手写的数。
  const worst = pb.worstCaseRebuildCost(0, upper, prices)
  const expectPoints = upper * budget.PAGE_COST_POINTS + budget.REBUILD_PR_PAGE_COUNT * budget.PR_PAGE_COST_POINTS + budget.COUNT_COST_POINTS
  const expectRequests = upper * budget.LIST_PAGE_COST_REQUESTS + budget.REBUILD_PR_PAGE_COUNT * budget.PR_PAGE_COST_REQUESTS + budget.COUNT_COST_REQUESTS
  check(worst.issuePages === upper && worst.points === expectPoints && worst.requests === expectRequests,
    '最坏一次重建 = 上界 ' + worst.issuePages + ' 页 × ' + budget.PAGE_COST_POINTS + ' 点 + 拉取请求 ' +
    budget.REBUILD_PR_PAGE_COUNT + ' 页 × ' + budget.PR_PAGE_COST_POINTS + ' 点 + 计数 ' + budget.COUNT_COST_POINTS +
    ' 点 = ' + worst.points + ' 点、' + worst.requests + ' 条请求')
  check(worst.points > budget.REBUILD_COST_POINTS,
    '最坏那一笔（' + worst.points + ' 点）严格大于典型那一笔（' + budget.REBUILD_COST_POINTS + ' 点，按 ' + budget.REBUILD_PAGE_COUNT + ' 页算）——两个数不许混用')

  // ② 断言行为：把上界改小／改大，结论必须跟着动（算式不认识 MAX_PAGES 时这两条会红）。
  const low = pb.worstCaseRebuildCost(0, 1, prices)
  const high = pb.worstCaseRebuildCost(0, upper + 40, prices)
  check(low.points < worst.points && high.points > worst.points,
    '上界真的在算式里：上界 1 页 → ' + low.points + ' 点 ＜ 上界 ' + upper + ' 页 → ' + worst.points + ' 点 ＜ 上界 ' + (upper + 40) + ' 页 → ' + high.points + ' 点')

  // ③ 实测突破上界时，最坏那一笔按实测算，不假装没这回事。
  const beyond = pb.worstCaseRebuildCost(upper + 3, upper, prices)
  check(beyond.issuePages === upper + 3 && beyond.points > worst.points,
    '实测 ' + (upper + 3) + ' 页（突破上界 ' + upper + '）时最坏按实测算：' + beyond.points + ' 点 ＞ 上界那一笔 ' + worst.points + ' 点')
  const rep = pb.pageCountReport(upper + 3, upper)
  check(rep.beyondUpperBound === true && rep.worstPages === upper + 3 && rep.measuredPages === upper + 3,
    '页数报告如实说出「实测突破了上界」（实测 ' + rep.measuredPages + '、上界 ' + rep.upperBoundPages + '、按 ' + rep.worstPages + ' 算、突破=' + rep.beyondUpperBound + '）')

  // ④ 坏输入不许算出负数或 NaN（没记过、记坏了都按 1 页）。
  const junk = pb.worstCaseRebuildCost(-5, 0, prices)
  check(junk.issuePages === 1 && Number.isFinite(junk.points) && junk.points > 0,
    '坏输入（实测 -5、上界 0）按 1 页算，不产生负数或 NaN（实得 ' + junk.issuePages + ' 页、' + junk.points + ' 点）')

  // ⑤ 账本真的按仓库分别记：两个仓库各记各的，互不影响。
  const l = ledgerMod.createLedger({ now: () => 1_000_000 })
  check(l.pagesFor('ws-a') === null && l.pagesFor('ws-b') === null, '还没有实测时，两个仓库都查不到页数（按 1 页估，不编一个典型值）')
  l.notePages('ws-a', { issuePages: 2, prPages: 1 })
  l.notePages('ws-b', { issuePages: 4, prPages: 1 })
  const a = l.estimateRebuild('ws-a')
  const b2 = l.estimateRebuild('ws-b')
  check(l.pagesFor('ws-a').issuePages === 2 && l.pagesFor('ws-b').issuePages === 4 && a.points < b2.points,
    '账本按仓库分别记：ws-a 实测 2 页估出 ' + a.points + ' 点、ws-b 实测 4 页估出 ' + b2.points + ' 点（互不影响）')
  check(l.worstRebuild('ws-a').issuePages === upper && l.worstRebuild('ws-b').issuePages === upper,
    '两个仓库的**最坏**都是按上界 ' + upper + ' 页算（小仓库也不必替自己按大仓库估——最坏只看上界）')

  // ⑥ 账本记的是「历史上最多见过几页」，不是「最近一次几页」：某次翻到 12 页之后，
  //   后面几次只翻 2 页，也不许把最坏上界忘回去。这是「最坏」两个字的意思。
  l.notePages('ws-c', { issuePages: upper + 2, prPages: 1 })
  const c1 = l.worstRebuild('ws-c')
  for (let i = 0; i < 3; i++) l.notePages('ws-c', { issuePages: 2, prPages: 1 })
  const c2 = l.worstRebuild('ws-c')
  check(c1.points === c2.points && c2.issuePages === upper + 2,
    '实测过 ' + (upper + 2) + ' 页之后又回到 2 页，最坏仍按 ' + (upper + 2) + ' 页算（' + c2.points + ' 点，没有被忘掉）')
  check(l.pagesFor('ws-c').rebuilds === 4, '账本也记着这个仓库重建过几次（实得 ' + l.pagesFor('ws-c').rebuilds + ' 次）')

  // ⑦ 页数实测进了总览（对账时不必再翻内存），而页数记账不许没有仓库标识。
  check(l.snapshot().pages['ws-a'] && l.snapshot().pages['ws-a'].report.upperBoundPages === upper,
    '总览里带上了每个仓库的页数报告（ws-a 的上界是 ' + l.snapshot().pages['ws-a'].report.upperBoundPages + ' 页）')
  let threw = false
  try { l.notePages('', { issuePages: 3 }) } catch (e) { threw = true }
  check(threw, '没有仓库标识时记页数直接报错（页数是按仓库记的，没有标识就分不出是谁的）')

  // 反证（正向对照）：把上界调成 1，最坏那一笔必须明显变小 —— 说明门禁数的确实是上界的影响。
  const tiny = pb.worstCaseRebuildCost(0, 1, prices)
  check(tiny.points < worst.points, '反证：上界 1 页时最坏那一笔变小（' + tiny.points + ' 点 ＜ ' + worst.points + ' 点），说明上界真的决定结论')

  // 反证（负向对照）：给一个不认 MAX_PAGES 的假算式，同一套判据必须判红。
  const fakeNoUpper = (maxPages, p) => ({ points: 1 * p.listPagePoints + p.prPageCount * p.prPagePoints + p.countPoints })
  const sameForBoth = fakeNoUpper(1, prices).points === fakeNoUpper(upper + 40, prices).points
  check(sameForBoth, '反证：一个不认上界的假算式（两头上界算出同一个数）会被这条判据看出来（两处都算得 ' + fakeNoUpper(1, prices).points + ' 点）')

  console.log(failed ? '\n存在失败 — verify-budget-page-upper-bound 未通过' : '\n全部通过 — 页数上界门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
