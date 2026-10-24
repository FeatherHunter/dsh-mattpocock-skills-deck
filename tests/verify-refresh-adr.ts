// verify-refresh-adr.ts —— 门禁：刷新架构的 ADR 在，而且它写的判据与代码对得上（#719 T15 收口）
// 用法：在插件根目录执行 node tests/verify-refresh-adr.ts，可独立运行。
//
// 为什么 ADR 也要有门禁（票面「每条都要有门禁或断言，不能只改文档」）：
// ADR 是判据，判据过期比没有判据更坏——后来人会拿一句已经不对的话去对照代码。
// 所以这里做两件事：① 六条不变量逐条在文件里查得到（漏一条就红）；② 文档里那几句关于**形态**的
// 断言，拿代码当场核一遍（例如「350 行门禁只扫 src/**/*.js」这句话，就去读那条门禁本身扫的是哪棵树）。
// 第 ② 类是这套门禁里唯一有价值的部分：只查文件里有没有某些字串，是把文档抄一遍，不是守它。
//
// #1456 起这里守的不止一份：ADR_LIST 是清单（刷新额度架构，以及接替它的「后端操作单入口」）。
// 每份 ADR 除了「文件在盘上」，还要过它自己那一段判据；加第三份 ADR 时，路径加进 ADR_LIST，
// 再照 ⑧ 那段写一段「文档说的数与名录、代码当场对」的判据。
//
// 反证（每次运行都跑）：把一份「缺了 I4 的假 ADR 文本」喂同一个判据，必须判红；
// 接替的那份 ADR 也有一条反证（把能力总数改错一位，判据必须抓到）。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const ADR_REL = 'docs/adr/20260924-refresh-budget-architecture.md'
const TS_ADR_REL = 'docs/adr/20260913-builtin-ts-shape.md'
// 接替刷新额度架构的那份 ADR：后端操作统一走 Tracker 会话（规格 #1439 的实施决定）。
const TRACKER_ADR_REL = 'docs/adr/20261023-tracker-single-entry.md'
// 本门禁守的 ADR 清单（#1456：从前只认 ADR_REL 一份写死的路径，新 ADR 只能另开一条门禁才进得来）。
const ADR_LIST = [ADR_REL, TRACKER_ADR_REL]
const { OPERATIONS, LOCATORS } = require('../src/tracker/contract/operations-catalog.ts')

/** 六条不变量各自在 ADR 里必须出现的那一句判据标题。 */
const INVARIANTS = [
  { id: 'I1', needle: '唯一出口：对 GitHub 的每一次调用都必须经过闸', gate: 'tests/verify-gh-gateway.ts' },
  { id: 'I2', needle: '后台零定时器', gate: 'tests/verify-attention-model.ts' },
  { id: 'I3', needle: '首屏只付行数据的钱', gate: 'budget.js' },
  { id: 'I4', needle: '用量与工作区数量无关', gate: 'tests/verify-event-budget.ts' },
  { id: 'I5', needle: '失败必可见、必退避', gate: 'backoff' },
  { id: 'I6', needle: '花费可归因、可对账', gate: 'tests/verify-gate-accounting.ts' },
]

/**
 * 判据本体：一份 ADR 文本够了没有。抽成函数是为了让反证能拿假文本喂它。
 * 返回没查到的那些项（空数组 = 全查到）。
 */
function missingIn(text) {
  const missing = []
  for (const inv of INVARIANTS) {
    if (text.indexOf(inv.needle) < 0) missing.push(inv.id + ' 的判据标题「' + inv.needle + '」')
    else if (text.indexOf(inv.gate) < 0) missing.push(inv.id + ' 指到的那条门禁「' + inv.gate + '」')
  }
  return missing
}

/** 开会话失败时那四种可区分的结局（与 src/tracker/session/open-tracker.ts 的类型字面量同字）。 */
const TRACKER_REASONS = ['no-backend', 'multi-match', 'pending', 'workspace-not-ready']
/** 账本按「后端/桶」分键，三种内置后端各给一个键（Markdown 无桶，不在这张表里）。 */
const TRACKER_BUCKET_KEYS = ['github/rest', 'github/graphql', 'gitlab/requests']

/**
 * 接替的那份 ADR 的判据：它写的能力条数、操作条数、四种结局与三个账本键，都要与名录逐字对得上。
 * 抽成函数是为了让反证能拿假文本喂它（与 missingIn 同一个理由）。
 * 返回没对上的那些项（空数组 = 全对上）。
 */
function trackerAdrProblems(text) {
  const problems = []
  const capabilityCount = OPERATIONS.length + LOCATORS.length
  if (text.indexOf(capabilityCount + ' 条能力') < 0) problems.push('没写「' + capabilityCount + ' 条能力」')
  if (text.indexOf(OPERATIONS.length + ' 条操作') < 0) problems.push('没写「' + OPERATIONS.length + ' 条操作」')
  if (OPERATIONS[OPERATIONS.length - 1] !== 'readBudget') {
    problems.push('操作名录末尾不是 readBudget（名录变了，ADR 的说法要跟着改）')
  } else if (text.indexOf('readBudget') < 0) {
    problems.push('没点出 readBudget 这一条')
  } else if (text.indexOf('第 ' + OPERATIONS.length + ' 条') < 0) {
    problems.push('没写 readBudget 是第 ' + OPERATIONS.length + ' 条操作')
  }
  for (const reason of TRACKER_REASONS) {
    if (text.indexOf(reason) < 0) problems.push('没写开会话的结局 ' + reason)
  }
  for (const key of TRACKER_BUCKET_KEYS) {
    if (text.indexOf(key) < 0) problems.push('没写账本键 ' + key)
  }
  return problems
}

async function main() {
  console.log('刷新架构 ADR 门禁（#719 T15：ADR 在、六条不变量逐条在、文档里关于形态的断言与代码对得上）')

  // ⓪ 清单上的 ADR 都在盘上（#1456：结构从「写死一份路径」改成「一份清单」，新 ADR 进得来）。
  const missingAdr = ADR_LIST.filter((rel) => !fs.existsSync(path.join(ROOT, rel)))
  check(missingAdr.length === 0, 'ADR 清单上的文件都在盘上（' + ADR_LIST.length + ' 份）'
    + (missingAdr.length ? '（缺：' + missingAdr.join('、') + '）' : ''))

  const adrPath = path.join(ROOT, ADR_REL)
  check(fs.existsSync(adrPath), 'ADR 文件在场：' + ADR_REL)
  if (!fs.existsSync(adrPath)) {
    console.log('\n存在失败 — verify-refresh-adr 未通过（没有文件，后面的断言无从谈起）')
    process.exit(1)
  }
  const text = fs.readFileSync(adrPath, 'utf8')

  // ① 六条不变量逐条在，且各自指到一条真的门禁（那条门禁文件也必须真的在）。
  const missing = missingIn(text)
  check(missing.length === 0, '六条不变量的判据逐条在场并各指到一条门禁' + (missing.length ? '（缺：' + missing.join('；') + '）' : ''))
  for (const inv of INVARIANTS) {
    if (!inv.gate.startsWith('tests/')) continue
    check(fs.existsSync(path.join(ROOT, inv.gate)), inv.id + ' 指到的那条门禁文件真的在磁盘上：' + inv.gate)
  }

  // ② 形态依据：ADR 必须引用 TS 形状那份 ADR，并且那份文件真的在。
  check(text.indexOf('20260913-builtin-ts-shape.md') >= 0, 'ADR 引用了 docs/adr/20260913-builtin-ts-shape.md 作为形态依据')
  check(fs.existsSync(path.join(ROOT, TS_ADR_REL)), '形态依据那份 ADR 文件真的在：' + TS_ADR_REL)

  // ③ 那句话必须写全：src/refresh/kernel/ 下的 .ts 不受 350 行约束，理由是三条。
  check(text.indexOf('不受「单文件 350 行」这条数字约束') >= 0,
    'ADR 写明 src/refresh/kernel/ 下的 .ts 源文件不受「单文件 350 行」这条数字约束')
  check(text.indexOf('零增长基线') >= 0 && text.indexOf('只许减不许增') >= 0,
    '理由之一写明了：#1017 换轨后那条门禁也读 .ts 真源，超线的那份按零增长基线冻结（只许减不许增），不强制拆')
  check(text.indexOf('产物之间零相对引用是硬约束') >= 0 && /拆\s*`?\.ts`?/.test(text) && text.indexOf('重复代码') >= 0,
    '理由之二写明了：产物之间零相对引用是硬约束，拆 .ts 会逼出重复代码')
  check(text.indexOf('单一职责') >= 0 && text.indexOf('纯逻辑') >= 0 && text.indexOf('可单测') >= 0,
    '替代纪律三条写全：单一职责、纯逻辑、可单测')

  // ③b 上面那句必须与代码当场对得上——去读那条门禁和它记的基线，不许只信文档。
  //   #1017 之前这里核的是「门禁只扫 .js、没把 refresh 纳进去」；换轨之后那句话反了过来：
  //   门禁确实读 .ts 了，所以这句话的对照组变成「超线的那份真的冻结在基线里」。
  //   #1271 之后 chain.ts 的有效行降到 350 以内、按基线的「达标文件由各自拆分票移出」规则移出了，
  //   所以这里接受两种真实状态：仍在基线里（数值型冻结值），或已达标移出（当前有效行不超过上限）。
  const granularity = fs.readFileSync(path.join(ROOT, 'tests', 'verify-file-granularity.ts'), 'utf8')
  const scansSrc = /const SRC = path\.join\(ROOT, 'src'\)/.test(granularity)
  const readsTs = /\.ts/.test(granularity) && granularity.indexOf('effective-lines') >= 0
  check(scansSrc && readsTs,
    '当场核一遍：tests/verify-file-granularity.ts 扫的确实是 src 那棵树，而且真的把 .ts 真源读进来（#1017 换轨后）')
  const { countEffectiveLines } = require('../scripts/lib/effective-lines.mts')
  const frozenRel = 'src/refresh/kernel/refresh-chain.ts'
  let frozenAt = null
  let frozenMetric = null
  try {
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'file-granularity-baseline.json'), 'utf8'))
    frozenMetric = baseline.metric
    frozenAt = (baseline.files || {})[frozenRel]
  } catch (e) { /* 读不到就是没冻结，下面那条断言会红 */ }
  const chainLines = countEffectiveLines(fs.readFileSync(path.join(ROOT, frozenRel), 'utf8'))
  const frozenOrCompliant = frozenMetric === 'effective-lines'
    && (typeof frozenAt === 'number' ? frozenAt >= chainLines : frozenAt === undefined && chainLines <= 350)
  check(frozenOrCompliant,
    '当场核一遍：这条 ADR 点名的 chain.ts 要么按有效行冻结在零增长基线里、要么已达标移出（口径 effective-lines，'
    + (typeof frozenAt === 'number' ? '冻结值 ' + frozenAt : '基线里没有它，当前有效行 ' + chainLines + '，上限 350') + '）')

  // ④ 额度常量的落点与做法写全了。
  check(text.indexOf('只有一处物理真源') >= 0 && text.indexOf('src/refresh/kernel/host-budget.ts') >= 0,
    'ADR 写明额度常量只有一处物理真源：src/refresh/kernel/host-budget.ts')
  const injections = ['policy.ts', 'backoff.ts', 'tool-cost.ts']
  check(injections.every((n) => text.indexOf(n) >= 0),
    'ADR 写明宿主侧取好再传进纯函数，并点到三处同做法的先例：' + injections.join('、'))

  // ⑤ 三个后端的额度口径逐条在，且 GitLab 那一格如实写「待实测」（不许编一个点数制）。
  check(text.indexOf('GitLab') >= 0 && text.indexOf('待实测') >= 0 && text.indexOf('不许编') >= 0,
    'ADR 写明 GitLab 只有请求数这一种口径、数值待实测、不许编一个点数制')
  check(text.indexOf('本地 Markdown') >= 0 && text.indexOf('不出站') >= 0,
    'ADR 写明本地 Markdown 后端不出站、不计费')
  check(text.indexOf('两个互相独立的桶') >= 0 && text.indexOf('互不折算') >= 0,
    'ADR 写明 GitHub 是两个互相独立、互不折算的桶')
  // ⑤b 口径声明的真源在契约层，旧静态模型表随 #1448 退役（不许两份真源并存）。
  const budgetTruthPath = path.join(ROOT, 'src', 'tracker', 'contract', 'budget-model.ts')
  check(fs.existsSync(budgetTruthPath), '口径声明的真源在契约层：src/tracker/contract/budget-model.ts')
  const oldModelPath = path.join(ROOT, 'src', 'refresh', 'kernel', 'backend-quota-model.ts')
  check(!fs.existsSync(oldModelPath), '旧静态模型表已删除：src/refresh/kernel/backend-quota-model.ts 不在')
  if (fs.existsSync(budgetTruthPath)) {
    const modelText = fs.readFileSync(budgetTruthPath, 'utf8')
    check(!/\b5000\b/.test(modelText), '当场核一遍：真源里没有写死 GitHub 的额度数值（5000 不出现）')
  }

  // ⑥ 最坏用量按页数上界算这条也在，并指到上界常量与那个算式。
  check(text.indexOf('MAX_PAGES') >= 0 && text.indexOf('worstCaseRebuildCost') >= 0 && text.indexOf('page-budget.ts') >= 0,
    'ADR 写明最坏用量按页数上界算，并指到 MAX_PAGES 与 page-budget.ts 的算式')
  // 2026-10-19 第三阶段起共享层产物住仓库根的 .build/shared/（真源 src/refresh/kernel/page-allowance.ts）。
  const pageBudgetPath = path.join(ROOT, '.build', 'refresh', 'kernel', 'page-allowance.js')
  check(fs.existsSync(pageBudgetPath), 'ADR 说的那个算式产物真的在：.build/refresh/kernel/page-allowance.js')

  // ⑦ ADR 必须如实记下今天的缺口（I3 只落地了一半），不许把没做的写成做完。
  check(text.indexOf('现在的缺口') >= 0 && text.indexOf('没有落地') >= 0,
    'ADR 如实记下了今天的缺口（I3 的「整池重建改走薄片段」那一半没有落地）')

  // ⑧ 接替它的那份 ADR（20261023 后端操作单入口）也在清单里，且文档说的数与名录、代码当场对（#1456 第 6 条）。
  const trackerAdrPath = path.join(ROOT, TRACKER_ADR_REL)
  check(fs.existsSync(trackerAdrPath), '接替的 ADR 在盘上：' + TRACKER_ADR_REL)
  const trackerText = fs.existsSync(trackerAdrPath) ? fs.readFileSync(trackerAdrPath, 'utf8') : ''
  const trackerProblems = trackerAdrProblems(trackerText)
  check(trackerProblems.length === 0,
    '接替的 ADR 与能力名录对得上（' + (OPERATIONS.length + LOCATORS.length) + ' 条能力、' + OPERATIONS.length
    + ' 条操作、四种结局、三个账本键）' + (trackerProblems.length ? '（缺：' + trackerProblems.join('；') + '）' : ''))
  // 文档里的四种结局不能是编的：开会话的出口在代码里只有这四个理由。
  const openerText = fs.readFileSync(path.join(ROOT, 'src/tracker/session/open-tracker.ts'), 'utf8')
  const missingReasons = TRACKER_REASONS.filter((r) => openerText.indexOf("'" + r + "'") < 0)
  check(missingReasons.length === 0, 'ADR 写的四种结局在 open-tracker.ts 里都有同名字面量'
    + (missingReasons.length ? '（缺：' + missingReasons.join('、') + '）' : ''))
  // 三个账本键也不是抄的：拿账本的桶键函数现算一遍，与 ADR 写的逐字相等。
  const ledger = require('../src/refresh/rooms/host/quota-ledger.ts')
  check(ledger.bucketKey('github', 'rest') === 'github/rest'
    && ledger.bucketKey('github', 'graphql') === 'github/graphql'
    && ledger.bucketKey('gitlab', 'requests') === 'gitlab/requests',
    'ADR 写的三个账本键与账本的 bucketKey 现算结果一致')
  // 反证：把「26 条能力」改成「25 条能力」，同一个判据必须抓到。
  const capabilityCount = OPERATIONS.length + LOCATORS.length
  // 文本里「26 条能力」不止一处（决定段与迁移段各一处），要全部改错，不能只改第一处。
  const fakeTracker = trackerText.split(capabilityCount + ' 条能力').join((capabilityCount - 1) + ' 条能力')
  const fakeTrackerProblems = trackerAdrProblems(fakeTracker)
  check(fakeTrackerProblems.length > 0, '反证：把能力总数改错一位之后，同一个判据必须抓到它（抓到 '
    + fakeTrackerProblems.length + ' 条：' + fakeTrackerProblems.join('；') + '）')

  // 反证：一份缺了 I4 的假 ADR 文本喂同一个判据，必须判红。
  const fake = text.replace(INVARIANTS[3].needle, '（这一条被拿掉了）')
  const fakeMissing = missingIn(fake)
  check(fakeMissing.length === 1 && fakeMissing[0].indexOf('I4') === 0,
    '反证：抽掉 I4 的判据标题之后，同一个判据必须抓到它（抓到 ' + fakeMissing.length + ' 条：' + fakeMissing.join('；') + '）')

  console.log(failed ? '\n存在失败 — verify-refresh-adr 未通过' : '\n全部通过 — 刷新架构 ADR 门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
