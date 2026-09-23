// verify-backend-quota-model.js —— 门禁：每个后端的额度桶形状与「按后端算价」（#719 T15 收口）
// 用法：在插件根目录执行 node tests/verify-backend-quota-model.js，可独立运行。
//
// 守着三件事（定稿第九章最后一条与第十四章「它其余的处置」）：
//   ① GitHub 有两个互相独立的桶（REST 数请求条数、GraphQL 数点数），两桶互不折算；
//   ② GitLab 只有请求条数这一种口径，**没有点数制**——不许给它编一个看起来像真的点数；
//   ③ 本地 Markdown 后端不出站，因此没有额度也没有花费。
// 另外守一条纪律：这份模型里**不许出现任何额度数值**。服务端此刻还剩多少只能现场读
//（GitHub 走那个不扣配额的 `gh api rate_limit`），写死一个数就会骗人；额度常量的唯一物理真源
// 仍然是 refresh-core/src/budget.ts。
//
// 断言的是**行为**：同一笔花费喂给三个后端，返回值必须按各自的口径不同——不是只比对一张常量表。
// 反证（每次运行都跑）：把一笔点数花费喂给 GitLab，它必须记 0 点并明说「这个后端不按点数计费」；
// 把同一笔喂给 GitHub，点数必须原样传出去（说明上面那条不是因为「反正都记 0」而通过）。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  console.log('后端额度模型门禁（#719 T15：三个后端的桶形状不同，按后端算价）')
  const q = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'refresh', 'backend-quota.js')).href)

  // ① GitHub：两桶、彼此独立、两个口径都记账。
  const gh = q.backendBudgetModel('github')
  const ghSpend = q.priceSpend('github', { requests: 7, points: 13 })
  check(gh.kind === 'two-buckets' && gh.countsRequests && gh.countsPoints && gh.independentBuckets,
    'GitHub 是两个互相独立的桶（kind=' + gh.kind + '、数请求=' + gh.countsRequests + '、数点数=' + gh.countsPoints + '、两桶独立=' + gh.independentBuckets + '）')
  check(ghSpend.requests === 7 && ghSpend.points === 13 && ghSpend.pointsCounted === true && q.usesIndependentBuckets('github') === true,
    'GitHub 的一笔花费两个口径都记：' + ghSpend.requests + ' 条请求、' + ghSpend.points + ' 点；两桶独立判定=' + q.usesIndependentBuckets('github'))

  // ② GitLab：只有请求数这一种口径；点数记 0 并明说不按点数计费（不许编一个点数制）。
  const gl = q.backendBudgetModel('gitlab')
  const glSpend = q.priceSpend('gitlab', { requests: 5, points: 999 })
  check(gl.kind === 'requests-only' && gl.countsRequests === true && gl.countsPoints === false && gl.independentBuckets === false,
    'GitLab 只有请求数这一种口径（kind=' + gl.kind + '、数请求=' + gl.countsRequests + '、数点数=' + gl.countsPoints + '、两桶独立=' + gl.independentBuckets + '）')
  check(glSpend.requests === 5 && glSpend.points === 0 && glSpend.pointsCounted === false,
    '同一笔（5 条请求、999 点）喂给 GitLab：只记 ' + glSpend.requests + ' 条请求，点数记 ' + glSpend.points + ' 点（点数算不算数=' + glSpend.pointsCounted + '）')
  check(gl.summary.indexOf('待实测') >= 0,
    'GitLab 的额度数值如实写成「待实测」，没有编一个数（原话：' + gl.summary + '）')

  // ③ 本地 Markdown：不出站，两样都记 0。
  const md = q.backendBudgetModel('markdown')
  const mdSpend = q.priceSpend('markdown', { requests: 4, points: 6 })
  check(md.kind === 'off-network' && md.countsRequests === false && md.countsPoints === false &&
    mdSpend.requests === 0 && mdSpend.points === 0,
    '本地 Markdown 不出站：' + mdSpend.requests + ' 条请求、' + mdSpend.points + ' 点，kind=' + md.kind)

  // ④ 认不出来的后端：按更省的一侧记（只记请求数、点数不记），不猜成 GitHub 那张形状。
  const other = q.backendBudgetModel('bitbucket')
  const otherSpend = q.priceSpend('bitbucket', { requests: 3, points: 8 })
  check(other.kind === 'unknown' && otherSpend.requests === 3 && otherSpend.points === 0 && otherSpend.pointsCounted === false,
    '认不出来的后端按更省的一侧记（kind=' + other.kind + '、记 ' + otherSpend.requests + ' 条请求、' + otherSpend.points + ' 点），不猜成两桶')
  check(other.kind !== 'two-buckets' && q.usesIndependentBuckets('bitbucket') === false,
    '认不出来的后端不会被当成两桶（否则会凭空算出一份额度让闸以为自己有钱）')

  // ⑤ 同一笔花费喂三个后端，结论必须不一样（这才叫「按后端算价」）。
  const spend = { requests: 5, points: 9 }
  const all = ['github', 'gitlab', 'markdown'].map((b) => q.priceSpend(b, spend))
  const sigs = all.map((s) => s.kind + '|' + s.requests + '|' + s.points)
  check(new Set(sigs).size === 3,
    '同一笔（5 条请求、9 点）喂三个后端得到三种不同的记法：' + sigs.join(' ／ '))

  // ⑥ 这份模型里一个额度数值都没有（额度只能来自服务端现场读数，常量真源只有 budget.ts）。
  const text = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'refresh', 'backend-quota.js'), 'utf8')
  check(!/\b5000\b/.test(text) && !/\b1750\b/.test(text) && !/\b1225\b/.test(text),
    '模型产物里没有写死任何额度数值（5000 / 1750 / 1225 都不出现）')
  const numericFields = []
  for (const m of all) for (const k of Object.keys(m)) if (typeof m[k] === 'number' && k !== 'requests' && k !== 'points') numericFields.push(k)
  check(numericFields.length === 0, '模型本身的字段里没有「额度数值」这种东西（数值字段只有记下来的 requests 与 points 两项）')

  // ⑦ 坏输入不许算出负数：负的请求数当 0 记。
  const neg = q.priceSpend('github', { requests: -3, points: -4 })
  check(neg.requests === 0 && neg.points === 0, '负数的一笔按 0 记，不产生负账（实得 ' + neg.requests + ' 条、' + neg.points + ' 点）')

  // 反证：GitLab 那条不许是因为「反正都记 0」才通过的 —— 同一笔喂 GitHub，点数必须原样传出去。
  check(glSpend.points === 0 && ghSpend.points === 13,
    '反证：同一笔点数花费，GitLab 记 0 点而 GitHub 原样记 ' + ghSpend.points + ' 点（说明 GitLab 那条判红不是因为两边都记 0）')

  console.log(failed ? '\n存在失败 — verify-backend-quota-model 未通过' : '\n全部通过 — 后端额度模型门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
