// tests/verify-1446-static-gate.ts —— 门禁：额度裁决与账本不再认后端名字（#1446 G2）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1446-static-gate.ts，可独立运行。
//
// 为什么要这一段：#1446 把账本从「一个固定桶集合」改成「按后端建模」，裁决也从「各处各写一份
// 剩余≤保底」收成一个纯函数。收口之后最容易回潮的有三件事：
//   1. 裁决、账本、会话管线与桥这四处重新按后端名字写分支（'github' / 'gitlab' / 'markdown'）；
//   2. 有人用 `backendId === 'github'` 这类等值比较代替「口径来自后端模型」；
//   3. 旧的固定桶集合 LEDGER_BUCKETS、以及「只查 rest 一个桶」的 view('rest') 重新长出来。
// 本门禁只读源码文本、只跑正则，不加载运行时：它守的是写法，不是行为（行为由 verify-1446-gitlab-budget 守）。
const path = require('path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 这四处是 #1446 的收口面：裁决纯函数、账本、会话管线、工具桥。
// 房间模块自己的注册表与实现当然要写后端名字，它们不在扫描名单里。
const GUARDED = [
  'src/refresh/kernel/budget-admission.ts',
  'src/refresh/rooms/host/quota-ledger.ts',
  'src/tracker/session/pipeline.ts',
  'src/refresh/registry/deck-tool-bridge.ts',
]
// 整棵源码树都要干净的两处旧写法。
const OLD_LEDGER_BUCKETS = 'LEDGER_BUCKETS'
const OLD_SINGLE_BUCKET_VIEW = /\.view\(\s*['"]rest['"]/g

function stripComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(function (l) { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l }).join('\n')
}
function read(rel) { return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')) }
function listTs(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push.apply(out, listTs(abs));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(abs)
  }
  return out
}
function relOf(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/') }
// 类型判断（typeof x.backendId === 'string'）不是「按名字分支」，先抹掉再查等值比较。
function backendIdComparisons(code) {
  const masked = code.replace(/typeof\s+[A-Za-z0-9_$.]*backendId\s*===\s*['"]string['"]/g, '')
  return masked.match(/backendId\s*===\s*[^=]/g) || []
}

function main() {
  console.log('后端名字与固定桶写法门禁（#1446：四处收口面不许按后端名分支）')
  // —— A. 四个收口面都在 ——
  for (const rel of GUARDED) check(fs.existsSync(path.join(ROOT, rel)), '收口面存在：' + rel)
  // —— B. 四处都不许出现后端名字的字面量 ——
  for (const rel of GUARDED) {
    const names = read(rel).match(/['"](github|gitlab|markdown)['"]/g) || []
    check(names.length === 0, rel + ' 不含后端名字字面量' + (names.length ? '（命中 ' + names.join('、') + '）' : ''))
  }
  // —— C. 四处都不许用 backendId 等值比较分出后端 ——
  for (const rel of GUARDED) {
    const hits = backendIdComparisons(read(rel))
    check(hits.length === 0, rel + ' 没有 backendId 等值比较' + (hits.length ? '（命中 ' + hits.length + ' 处）' : ''))
  }
  // —— D. 全树不许再有固定桶集合与「只查 rest 一个桶」 ——
  const allTs = listTs(path.join(ROOT, 'src'))
  const fixedBuckets = allTs.filter(function (f) { return read(relOf(f)).indexOf(OLD_LEDGER_BUCKETS) >= 0 }).map(relOf)
  check(fixedBuckets.length === 0, '全树没有 LEDGER_BUCKETS 固定桶集合' + (fixedBuckets.length ? '（违规：' + fixedBuckets.join('、') + '）' : ''))
  const singleView = allTs.filter(function (f) { return (read(relOf(f)).match(OLD_SINGLE_BUCKET_VIEW) || []).length > 0 }).map(relOf)
  check(singleView.length === 0, '全树没有只查 rest 一个桶的 view(\'rest\')' + (singleView.length ? '（违规：' + singleView.join('、') + '）' : ''))

  // —— E. 裁决纯函数的形状：导出、常量、不 import 额度数字 ——
  const admit = read(GUARDED[0])
  check(/export\s+function\s+decideByBudget\s*\(/.test(admit), 'budget-admission 导出 decideByBudget 纯函数')
  check(admit.indexOf('硬顶：这次调用没有写权限，写操作直接拒绝。') >= 0, '硬顶文案与既有裁决逐字一致（调用方按同一句话说话）')
  check(!/from\s+['"][^'"]*host-budget/.test(admit), 'budget-admission 不 import host-budget（额度数字由调用方注入）')
  check(!/0\.35|35\s*\/\s*100/.test(admit), 'budget-admission 不写 35% 保底数字（两桶算式只在第 e 步用注入的 writeReserve）')
  check(admit.indexOf('off-network-free') >= 0 && admit.indexOf('reading-unknown') >= 0 && admit.indexOf('requests-exhausted') >= 0, '裁决的三种新理由都在（离网/未知/请求用尽）')

  // —— F. 桥确实走纯函数，账本仍按「后端 + 桶」取视图 ——
  const bridge = read(GUARDED[3])
  check(/from\s+['"][^'"]*budget-admission/.test(bridge) && bridge.indexOf('decideByBudget(') >= 0, '工具桥的裁决改调 decideByBudget（不在桥里另写一份口径）')
  const ledger = read(GUARDED[1])
  check(/function\s+view\s*\(\s*backendId\s*:\s*string\s*,\s*bucket\s*:\s*string\s*\)/.test(ledger), '账本的发布口是 view(backendId, bucket)（按后端 + 桶取，不再取固定集合）')

  // —— G. 房间侧的读数实现已经落地（读不到就回未知，不回 0） ——
  const gitlabBudget = read('src/tracker/rooms/gitlab/budget.ts')
  check(/ratelimit-limit/.test(gitlabBudget.toLowerCase()) && /ratelimit-remaining/.test(gitlabBudget.toLowerCase()), 'GitLab 读数解析响应头里的 RateLimit-Limit / RateLimit-Remaining')
  check(gitlabBudget.indexOf("'not-measured'") >= 0 && gitlabBudget.indexOf("'unavailable'") >= 0, 'GitLab 读数的两种未知原因都在（没装 glab / 量了但拿不到）')
  const markdownBudget = read('src/tracker/rooms/markdown/budget.ts')
  check(markdownBudget.indexOf("kind: 'off-network'") >= 0, 'Markdown 读数恒为离网（本地读写不花额度）')
  check(markdownBudget.indexOf('readFile') < 0 && markdownBudget.indexOf('exec') < 0, 'Markdown 读数不读盘、不调命令（纯回答）')

  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

try { main() } catch (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) }
