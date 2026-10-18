/**
 * scripts/verify-all.mjs — 把 npm run verify 那条链逐道跑一遍并汇总。
 *
 * 为什么要它：全链一次跑完才能看到每一道的结果（串行链前一道失败就掩盖后面所有门禁——
 * 排查 CI 或本地红灯时每次只看到第一条，得反复推、反复等；这条已知问题记在 #578 的残余清单里）。
 * 本脚本读规划函数给出的名单（目录约定加显式排除表，#1125；名单只有这一个来源，不另抄一份），
 * 逐道执行、逐道记账，最后打印汇总，并按「有没有失败」决定退出码。
 *
 * 用法：
 *   node scripts/verify-all.mjs              跑全部并汇总
 *   node scripts/verify-all.mjs --list       只列名单，不执行
 *   node scripts/verify-all.mjs --from 40    从第 40 道开始跑（前面已经确认过的可跳过）
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 完成证据（#1158）：只看退出码会被「跑到一半就收摊、退出码仍是 0」骗过去（#1146 的实例）。
// 判据的写法、解析与那句人话理由都在 tests/lib/gate-result.ts 一处，这里只负责调用它。
import { judgeStepCompletion, loadCompletionExpectations } from '../tests/lib/gate-result.ts'
import { planGates } from './lib/discover-gates.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// 名单（#1125）：规划函数是唯一来源。规划出来的命令本来就是一条一句，
// 不用再按 && 切 —— 也就没有“读不懂的条目”这种东西了。
const gates = planGates(ROOT).map((s) => s.cmd)
if (!gates.length) {
  console.error('规划出来的名单是空的 —— 没有可跑的门禁')
  process.exit(2)
}

// 装载钩子：链上的测试要能把 "./x.js" 解析到同目录的同名 .ts（迁移中的单元靠它）。
// 判定只有一条：要跑的是 tests/ 下的文件才挂。同一个判定分散在三处，改一处必须全改：
//   1. scripts/verify-chain.js 的 argvOf（#1178 起 npm run test:smoke 也走它）
//   2. scripts/verify-parallel.mjs 的 argvOf   3. 本文件的 withTsHook
// 本脚本尤其不能漏：CI（.github/workflows/verify.yml）跑的就是它，漏挂的后果是
// 「本机 npm test 全绿、CI 红」——迁移成 .ts 的门禁在本地由钩子解析到源码，在 CI 那边解析不到。
const TS_HOOK = pathToFileURL(path.join(ROOT, 'scripts', 'ts-hook.mjs')).href
function withTsHook(cmd) {
  const m = /^node\s+(tests\/\S+)$/.exec(cmd)
  return m ? 'node --import ' + JSON.stringify(TS_HOOK) + ' ' + m[1] : cmd
}

// 链上这一道跑的是哪个门禁文件（归属表里的 file 就是这个写法）。
function gateFileOf(cmd) {
  const m = /^node\s+(tests\/\S+)$/.exec(cmd)
  return m ? m[1] : ''
}

// 完成证据（#1158）：归属表里记着「哪一扇已开闸、该有多少条断言」，按文件把期望挂到链上。
// 一扇都没挂上（而表里明明有已开闸的）说明两边写法对不上了，判据形同虚设 —— 当场判红，不许静默放行。
const expectations = loadCompletionExpectations()
const evidenceSteps = gates.filter(function (g) { return expectations.byFile.has(gateFileOf(g)) })
if (expectations.byFile.size && !evidenceSteps.length) {
  console.error('归属表里有 ' + expectations.byFile.size + ' 扇门禁已开闸（completionRecord: true），链上一条都没挂上：')
  console.error('  判据形同虚设，先核对 tests/gate-map.json 的 file 字段与链上的写法是否一致。')
  process.exit(1)
}

const argv = process.argv.slice(2)
if (argv.indexOf('--list') >= 0) {
  gates.forEach(function (g, i) { console.log((i + 1) + '. ' + g) })
  process.exit(0)
}
const fromIdx = argv.indexOf('--from')
const from = fromIdx >= 0 ? Math.max(1, Number(argv[fromIdx + 1]) || 1) : 1

console.log(
  '门禁逐道跑：共 ' + gates.length + ' 道' + (from > 1 ? '，从第 ' + from + ' 道开始' : '') +
  '（其中 ' + evidenceSteps.length + ' 道带完成证据判据）'
)
const started = Date.now()
const failed = []
for (let i = 0; i < gates.length; i++) {
  const n = i + 1
  if (n < from) continue
  const cmd = gates[i]
  const expect = expectations.byFile.get(gateFileOf(cmd))
  const t0 = Date.now()
  console.log('\n[' + n + '/' + gates.length + '] ' + cmd)
  try {
    if (expect) {
      // 有期望的这一道要把输出收下来读那行记录，收完照样原样打出去 —— 人看到的输出与从前一样。
      const out = execSync(withTsHook(cmd), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      process.stdout.write(out)
      const verdict = judgeStepCompletion(expect, 0, out)
      if (!verdict.ok) {
        const err = new Error('完成证据对不上：' + verdict.reason)
        err.evidenceReason = verdict.reason
        throw err
      }
      console.log('    ✓ 通过（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）完成证据：' + verdict.reason)
    } else {
      execSync(withTsHook(cmd), { cwd: ROOT, stdio: 'inherit' })
      console.log('    ✓ 通过（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）')
    }
  } catch (e) {
    const reason = (e && e.evidenceReason) ? e.evidenceReason : ''
    // 捕获模式下失败的输出要自己打出来，不然红在哪里就看不见了。
    if (e && typeof e.stdout === 'string' && e.stdout) process.stdout.write(e.stdout)
    if (e && typeof e.stderr === 'string' && e.stderr) process.stderr.write(e.stderr)
    failed.push({ n: n, cmd: cmd, code: (e && e.status != null) ? e.status : 0, reason: reason })
    console.log('    ✗ 失败（' + (reason ? '完成证据对不上' : '退出码 ' + ((e && e.status != null) ? e.status : '?')) + '）')
  }
}

const used = ((Date.now() - started) / 1000).toFixed(0)
const ran = gates.length - (from - 1)
console.log('\n==== 门禁汇总：' + (ran - failed.length) + ' 通过 / ' + failed.length + ' 失败（本次跑 ' + ran + ' 道，用时 ' + used + 's） ====')
if (failed.length) {
  failed.forEach(function (f) {
    console.log('  失败 #' + f.n + '（' + (f.reason ? '完成证据对不上' : '退出码 ' + f.code) + '）：' + f.cmd)
    if (f.reason) console.log('      ' + f.reason)
  })
  process.exit(1)
}
console.log('全部通过')
