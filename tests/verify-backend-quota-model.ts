// verify-backend-quota-model.ts —— 门禁：口径声明的唯一真源，旧静态模型表已退役（#719 T15 起，2026-10-23 #1448 改写）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-backend-quota-model.ts，可独立运行。
//
// 为什么改写：规格 #1439 把「每个后端花额度的口径」从 src/refresh/kernel/backend-quota-model.ts 那张静态表
// 搬回各后端模块自己的 budget 声明（形状定在契约层 src/tracker/contract/budget-model.ts）。旧表留着就是第二份
// 真源：一份写死 github / gitlab / markdown，一份在房间模块里，两份一漂移，闸与账本就会各按各的算。
// 这份门禁守四件事：
//   ① 旧文件与其转译产物真的不在了（退役不是「不再引用」而是「删掉」）；
//   ② 口径只有四个取值，契约里没有写死任何额度数值；
//   ③ 三个内置后端的声明与契约对齐（GitHub 两桶、GitLab 只计请求、Markdown 离网）；
//   ④ 账本按口径建桶、记账按口径换算——同一笔花费喂给三种口径，结论必须不同。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT: string = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

async function main() {
  console.log('后端口径声明门禁（#1439 / #1448：真源在契约与房间模块，旧静态表已退役）')

  // ① 旧静态表退役：源码与产物都不许还在。产物由构建生成，删源后重建就不再出现；这里同时查两处。
  const oldSource = path.join(ROOT, 'src', 'refresh', 'kernel', 'backend-quota-model.ts')
  const oldBuilt = path.join(ROOT, '.build', 'refresh', 'kernel', 'backend-quota-model.js')
  check(!fs.existsSync(oldSource), '旧静态模型表源码已删除：src/refresh/kernel/backend-quota-model.ts')
  check(!fs.existsSync(oldBuilt), '旧静态模型表的转译产物也不在了：.build/refresh/kernel/backend-quota-model.js')

  // ② 契约层的口径：四个取值，一个不多一个不少；契约里不许写死额度数值。
  const contract = await import(pathToFileURL(path.join(ROOT, 'src', 'tracker', 'contract', 'budget-model.ts')).href)
  const kinds = contract.BUDGET_KINDS || []
  check(Array.isArray(kinds) && kinds.length === 4 &&
    ['two-buckets', 'requests-only', 'off-network', 'unknown'].every((k) => kinds.indexOf(k) >= 0),
    '契约里口径恰好四个取值：' + kinds.join(' / '))
  const contractText = fs.readFileSync(path.join(ROOT, 'src', 'tracker', 'contract', 'budget-model.ts'), 'utf8')
  check(!/\b5000\b/.test(contractText) && !/\b1750\b/.test(contractText) && !/\b1225\b/.test(contractText),
    '契约文件里没有写死任何额度数值（5000 / 1750 / 1225 都不出现）：额度只能来自现场读数')

  // ③ 三个内置后端各自声明一份口径，且与契约的四格齐全（kind / countsRequests / countsPoints / independentBuckets）。
  const builtins = await import(pathToFileURL(path.join(ROOT, 'src', 'tracker', 'registry', 'builtins.ts')).href)
  const mods = await builtins.loadBuiltinBackendModules()
  const budgetOf = (id: string): any => {
    for (const m of mods) if (m && m.id === id) return m.budget
    return null
  }
  const wellFormed = (b: any): boolean => !!b && kinds.indexOf(b.kind) >= 0 &&
    typeof b.countsRequests === 'boolean' && typeof b.countsPoints === 'boolean' && typeof b.independentBuckets === 'boolean'
  const gh = budgetOf('github'); const gl = budgetOf('gitlab'); const md = budgetOf('markdown')
  check(wellFormed(gh) && gh.kind === 'two-buckets' && gh.countsRequests && gh.countsPoints && gh.independentBuckets,
    'GitHub 声明两个互相独立的桶（数请求、数点数，两桶独立）：' + JSON.stringify(gh))
  check(wellFormed(gl) && gl.kind === 'requests-only' && gl.countsRequests && !gl.countsPoints && !gl.independentBuckets,
    'GitLab 声明只计请求数、不数点数、没有第二桶：' + JSON.stringify(gl))
  check(wellFormed(md) && md.kind === 'off-network' && !md.countsRequests && !md.countsPoints,
    '本地 Markdown 声明离网、不记请求数也不记点数：' + JSON.stringify(md))
  check(mods.every((m: any) => wellFormed(m.budget)),
    '内置后端每一个都在模块上交了完整的口径声明（缺了注册表会当场拒绝）')

  // ④ 账本按口径建桶：两桶建 rest 与 graphql，只计请求建 requests，离网不建，未知只建 requests。
  const ledger = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'quota-ledger.ts')).href)
  const bucketsOf = (b: any): string => (ledger.bucketsForKind(b.kind) || []).join(',')
  check(bucketsOf(gh) === 'rest,graphql', '两桶后端在账本里建 rest 与 graphql 两个桶（实得 ' + bucketsOf(gh) + '）')
  check(bucketsOf(gl) === 'requests', '只计请求的后端只建 requests 一个桶（实得 ' + bucketsOf(gl) + '）')
  check(bucketsOf(md) === '', '离网后端一个桶都不建（实得「' + bucketsOf(md) + '」）')
  const unknownModel = { kind: 'unknown', countsRequests: true, countsPoints: false, independentBuckets: false }
  check(bucketsOf(unknownModel) === 'requests', '未知口径只建 requests 桶（只记发出去的请求数，实得 ' + bucketsOf(unknownModel) + '）')

  // ⑤ 记账按口径换算：同一笔（5 条请求、9 点）喂给三种口径，结论必须不同。
  const acct = await import(pathToFileURL(path.join(ROOT, 'src', 'refresh', 'kernel', 'backend-accounting.ts')).href)
  const usage = { requests: 5, points: 9 }
  const spendOf = (budget: any): string => {
    const rows = acct.spendsOfAccount({ op: 'get', budget: budget, result: { ok: true, usage: usage }, backendId: 'x' }) || []
    return rows.map((r: any) => r.bucket + ':' + r.requests + '/' + r.points).join(',') || '(none)'
  }
  const ghSpend = spendOf(gh); const glSpend = spendOf(gl); const mdSpend = spendOf(md)
  check(ghSpend === 'rest:5/0,graphql:0/9', '两桶口径把同一笔拆进两个桶（实得 ' + ghSpend + '）')
  check(glSpend === 'requests:5/0', '只计请求口径只记 5 条请求、点数不记（实得 ' + glSpend + '）')
  check(mdSpend === '(none)', '离网口径一笔都不记（实得 ' + mdSpend + '）')
  check(new Set([ghSpend, glSpend, mdSpend]).size === 3, '同一笔花费喂三种口径得到三种不同的记法：' + [ghSpend, glSpend, mdSpend].join(' ／ '))
  const negRows = acct.spendsOfAccount({ op: 'get', budget: gh, result: { ok: true, usage: { requests: -3, points: -4 } }, backendId: 'x' }) || []
  check(negRows.every((r: any) => r.requests >= 0 && r.points >= 0), '坏输入（负数用量）不会记成负账：' + JSON.stringify(negRows))

  console.log(failed ? '\n存在失败 — verify-backend-quota-model 未通过' : '\n全部通过 — 口径声明真源与旧表退役门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e: any) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
