/**
 * scripts/verify-all.mjs — 把 npm run verify 那条链逐道跑一遍并汇总。
 *
 * 为什么要它：`npm run verify` 用 && 把九十多条命令串成一条，前一道失败就会掩盖后面所有门禁——
 * 排查 CI 或本地红灯时每次只看到第一条，得反复推、反复等（这条已知问题记在 #578 的残余清单里）。
 * 本脚本读 package.json 里那条 verify 链（名单只有这一个来源，不另抄一份），逐道执行、逐道记账，
 * 最后打印汇总，并按「有没有失败」决定退出码——入口契约与 npm run verify 一致（非零即失败）。
 *
 * 用法：
 *   node scripts/verify-all.mjs              跑全部并汇总
 *   node scripts/verify-all.mjs --list       只列名单，不执行
 *   node scripts/verify-all.mjs --from 40    从第 40 道开始跑（前面已经确认过的可跳过）
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const chain = String((pkg.scripts && pkg.scripts.verify) || '')
if (!chain) {
  console.error('package.json 里没有 scripts.verify —— 没有名单可跑')
  process.exit(2)
}
const gates = chain.split('&&').map(function (s) { return s.trim() }).filter(Boolean)

const argv = process.argv.slice(2)
if (argv.indexOf('--list') >= 0) {
  gates.forEach(function (g, i) { console.log((i + 1) + '. ' + g) })
  process.exit(0)
}
const fromIdx = argv.indexOf('--from')
const from = fromIdx >= 0 ? Math.max(1, Number(argv[fromIdx + 1]) || 1) : 1

console.log('门禁逐道跑：共 ' + gates.length + ' 道' + (from > 1 ? '，从第 ' + from + ' 道开始' : ''))
const started = Date.now()
const failed = []
for (let i = 0; i < gates.length; i++) {
  const n = i + 1
  if (n < from) continue
  const cmd = gates[i]
  const t0 = Date.now()
  console.log('\n[' + n + '/' + gates.length + '] ' + cmd)
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
    console.log('    ✓ 通过（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）')
  } catch (e) {
    failed.push({ n: n, cmd: cmd, code: (e && e.status != null) ? e.status : '?' })
    console.log('    ✗ 失败（退出码 ' + ((e && e.status != null) ? e.status : '?') + '）')
  }
}

const used = ((Date.now() - started) / 1000).toFixed(0)
const ran = gates.length - (from - 1)
console.log('\n==== 门禁汇总：' + (ran - failed.length) + ' 通过 / ' + failed.length + ' 失败（本次跑 ' + ran + ' 道，用时 ' + used + 's） ====')
if (failed.length) {
  failed.forEach(function (f) { console.log('  失败 #' + f.n + '（退出码 ' + f.code + '）：' + f.cmd) })
  process.exit(1)
}
console.log('全部通过')
