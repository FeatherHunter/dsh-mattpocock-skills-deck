// verify-refresh-adr.js —— 门禁：刷新架构的 ADR 在，而且它写的判据与代码对得上（#719 T15 收口）
// 用法：在插件根目录执行 node tests/verify-refresh-adr.js，可独立运行。
//
// 为什么 ADR 也要有门禁（票面「每条都要有门禁或断言，不能只改文档」）：
// ADR 是判据，判据过期比没有判据更坏——后来人会拿一句已经不对的话去对照代码。
// 所以这里做两件事：① 六条不变量逐条在文件里查得到（漏一条就红）；② 文档里那几句关于**形态**的
// 断言，拿代码当场核一遍（例如「350 行门禁只扫 src/**/*.js」这句话，就去读那条门禁本身扫的是哪棵树）。
// 第 ② 类是这套门禁里唯一有价值的部分：只查文件里有没有某些字串，是把文档抄一遍，不是守它。
//
// 反证（每次运行都跑）：把一份「缺了 I4 的假 ADR 文本」喂同一个判据，必须判红。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const ADR_REL = 'docs/adr/20260924-refresh-budget-architecture.md'
const TS_ADR_REL = 'docs/adr/20260913-builtin-ts-shape.md'

/** 六条不变量各自在 ADR 里必须出现的那一句判据标题。 */
const INVARIANTS = [
  { id: 'I1', needle: '唯一出口：对 GitHub 的每一次调用都必须经过闸', gate: 'tests/verify-gh-gateway.js' },
  { id: 'I2', needle: '后台零定时器', gate: 'tests/verify-attention-model.js' },
  { id: 'I3', needle: '首屏只付行数据的钱', gate: 'budget.js' },
  { id: 'I4', needle: '用量与工作区数量无关', gate: 'tests/verify-event-budget.js' },
  { id: 'I5', needle: '失败必可见、必退避', gate: 'backoff' },
  { id: 'I6', needle: '花费可归因、可对账', gate: 'tests/verify-gate-accounting.js' },
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

async function main() {
  console.log('刷新架构 ADR 门禁（#719 T15：ADR 在、六条不变量逐条在、文档里关于形态的断言与代码对得上）')

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

  // ③ 那句话必须写全：refresh-core/ 的 .ts 不受 350 行约束，理由是三条。
  check(text.indexOf('不受「单文件 350 行」这条数字约束') >= 0 || text.indexOf('不受「单文件 350 行」这条数字约束') >= 0,
    'ADR 写明 refresh-core/ 下的 .ts 源文件不受「单文件 350 行」这条数字约束')
  check(/只扫 `src\/\*\*\/\*\.js`/.test(text), '理由之一写明了：350 行那条门禁只扫 src/**/*.js')
  check(text.indexOf('产物之间零相对引用是硬约束') >= 0 && /拆\s*`?\.ts`?/.test(text) && text.indexOf('重复代码') >= 0,
    '理由之二写明了：产物之间零相对引用是硬约束，拆 .ts 会逼出重复代码')
  check(text.indexOf('单一职责') >= 0 && text.indexOf('纯逻辑') >= 0 && text.indexOf('可单测') >= 0,
    '替代纪律三条写全：单一职责、纯逻辑、可单测')

  // ③b 上面那句「只扫 src/**/*.js」必须与代码当场对得上——去读那条门禁本身，不许只信文档。
  const granularity = fs.readFileSync(path.join(ROOT, 'tests', 'verify-file-granularity.js'), 'utf8')
  const scansSrcOnly = /const SRC = path\.join\(ROOT, 'src'\)/.test(granularity) && !/refresh-core/.test(granularity)
  check(scansSrcOnly, '当场核一遍：tests/verify-file-granularity.js 扫的确实是 src 那棵树，没有把 refresh-core/ 纳进去')

  // ④ 额度常量的落点与做法写全了。
  check(text.indexOf('只有一处物理真源') >= 0 && text.indexOf('refresh-core/src/budget.ts') >= 0,
    'ADR 写明额度常量只有一处物理真源：refresh-core/src/budget.ts')
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
  // ⑤b 模型文件真的在，而且真的没有写死额度数值（与 verify-backend-quota-model 同一条纪律）。
  const modelPath = path.join(ROOT, 'src', 'shared', 'refresh', 'backend-quota.js')
  check(fs.existsSync(modelPath), 'ADR 说的那份额度模型产物真的在：src/shared/refresh/backend-quota.js')
  if (fs.existsSync(modelPath)) {
    const modelText = fs.readFileSync(modelPath, 'utf8')
    check(!/\b5000\b/.test(modelText), '当场核一遍：那份模型里没有写死 GitHub 的额度数值（5000 不出现）')
  }

  // ⑥ 最坏用量按页数上界算这条也在，并指到上界常量与那个算式。
  check(text.indexOf('MAX_PAGES') >= 0 && text.indexOf('worstCaseRebuildCost') >= 0 && text.indexOf('page-budget.ts') >= 0,
    'ADR 写明最坏用量按页数上界算，并指到 MAX_PAGES 与 page-budget.ts 的算式')
  const pageBudgetPath = path.join(ROOT, 'src', 'shared', 'refresh', 'page-budget.js')
  check(fs.existsSync(pageBudgetPath), 'ADR 说的那个算式产物真的在：src/shared/refresh/page-budget.js')

  // ⑦ ADR 必须如实记下今天的缺口（I3 只落地了一半），不许把没做的写成做完。
  check(text.indexOf('现在的缺口') >= 0 && text.indexOf('没有落地') >= 0,
    'ADR 如实记下了今天的缺口（I3 的「整池重建改走薄片段」那一半没有落地）')

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
