#!/usr/bin/env node
// 迁移说明（#1252）：本文件由 scripts/verify-chain.js 转写为 scripts/verify-chain.ts，只加类型注解，运行时行为零变化。
// scripts/verify-chain.ts —— verify 链的执行器（1.7.50 发布门禁红线的根治）。
//
// 名单只有一份来源：scripts/verify-stages.json（目录约定加显式排除表，#1125）
// 经由 scripts/lib/discover-gates.ts 的 planGates() 算出来。package.json 里
// 不再有那条长串（scripts.verify 现在就是 `node scripts/verify-chain.ts`
// 这一句，本脚本不再读它 —— 读了会把自己当成一步，无限递归）。
// 烟链例外：scripts.smoke 那五条还住在 package.json 里（#1125 范围只动主链），
// --script smoke 读那一格；读法与切法收在 scripts/lib/discover-gates.ts 一处（#1643）。
//
// 用法：node scripts/verify-chain.ts（跑规划出来的主链）
//       node scripts/verify-chain.ts --only <子串>（抽查：只跑名字含这个子串的条目）
//       node scripts/verify-chain.ts --script smoke（跑 scripts.smoke，五条冒烟；#1178 起 npm run test:smoke 走这条）
//
// 为什么冒烟也走这一份（#1178）：从前 test:smoke 是一条裸的 && 串，谁给冒烟上的门禁开闸，
// 那条路都会静默漏掉下面的完成证据判据。现在两条链共用这一个执行器与同一份判据，
// 只是「名单怎么来」不同（主链走规划函数、冒烟读 package.json 的 scripts.smoke 那一格）：
// 清单的读法与切法都收在 scripts/lib/discover-gates.ts 一处（#1643），两条链不会各切各的。
//
// #1158 起多一条判据：只看退出码会被「跑到一半就收摊、退出码仍是 0」骗过去
// （#1146 实测：verify-deck-no-hang 的 21 条断言只跑到第 12 条就退出，整条链判绿）。
// 所以对「已开闸」的门禁（tests/gate-map.json 里 completionRecord 为 true 的那几扇），
// 要求它交出完成记录：退出码 0 且末行有 GATE-RESULT 且计数等于表里记着的期望，缺一判红。
// 没开闸的步骤保持老行为，只看退出码 —— 判据的写法与解析都在 tests/lib/gate-result.ts 一处。
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const { judgeStepCompletion, loadCompletionExpectations } = require('../tests/lib/gate-result.ts')
const { planGates, readSmokeCommands, splitCommandArgs, commandTestFile } = require('./lib/discover-gates.ts')

const ROOT: string = path.resolve(__dirname, '..')
// 名单（#1125）：主链走规划函数，冒烟清单读 package.json（读法同收在 discover-gates）。判定只有一条：
// 要起的是 tests/ 下的文件才挂装载钩子。链上今天全是测试条目，写这条是为了跟并行执行器
// （scripts/verify-parallel.mts 的 argvOf）保持同一口径——两处任一处改了，另一处必须跟着改。
const TS_HOOK: string = pathToFileURL(path.join(ROOT, 'scripts', 'ts-hook.mts')).href
function argvOf(parts: string[]): string[] {
  return parts[1] && parts[1].startsWith('tests/') ? ['--import', TS_HOOK, ...parts.slice(1)] : parts.slice(1)
}
// 命令行参数：--script 只认 smoke（缺省跑主链，即规划结果），--only 抽查（子串过滤）。
function argValue(name: string): string {
  const i: number = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ''
}
const scriptName: string = argValue('--script') || 'verify'
let entries: string[]
if (scriptName === 'smoke') {
  // 冒烟清单只有一处来源（package.json 的 scripts.smoke），读法与切法在 discover-gates 里（#1643）。
  entries = readSmokeCommands(ROOT)
  if (!entries.length) { console.error('FAIL package.json 里没有 scripts.smoke，没有可跑的链'); process.exit(1) }
} else if (scriptName === 'verify') {
  // 主链：规划函数是名单的唯一来源（目录约定加显式排除表）。规划出来的命令
  // 本来就是一条一句，不用再按 && 切。
  entries = planGates(ROOT).map((s: { cmd: string }) => s.cmd)
} else {
  console.error('FAIL --script 只认 verify（缺省）与 smoke：' + scriptName)
  process.exit(1)
}

// 切命令、认测试文件的函数都收在 scripts/lib/discover-gates.ts 一处（#1643）：
// splitCommandChain / splitCommandArgs / commandTestFile，主链与冒烟链共用同一份切法。

const only: string = argValue('--only')
entries = entries.filter((e) => !only || e.includes(only))
if (!entries.length) { console.error('FAIL 没有可跑的条目'); process.exit(1) }

// 完成证据（#1158）：归属表里记着「哪一扇已开闸、该有多少条断言」，这里按文件把期望挂到链上。
// 守卫（#1178 起逐条对）：表里记着开闸、而且它的步骤原文就在这条链上的，必须按文件挂得上；
// 挂不上说明「表里的 file 写法」与「链上的步骤写法」对不上，判据形同虚设 —— 当场判红，不许静默放行。
// 为什么不写成「至少挂上一扇」：冒烟链与主链各自开闸的门禁不是同一批，一刀切会误伤另一条链
// （冒烟链上今天就有两扇开闸，主链那些已开闸的门禁都不在它上面）。两条链都开闸时这个守卫照样逐条生效。
// 带 --only 抽查时不查这条：抽查本来就可能一条开闸的都没选中。
const expectations = loadCompletionExpectations()
const unmatched: string[] = entries.filter(
  (e) => expectations.byStep.has(e) && !expectations.byFile.has(commandTestFile(e)),
)
if (!only && unmatched.length) {
  console.error('FAIL 归属表里记着开闸、步骤原文也在这条链上，但按文件对不上（' + unmatched.length + ' 条）：')
  for (const e of unmatched.slice(0, 3)) console.error('  ' + e.slice(0, 120))
  console.error('  判据形同虚设，先核对 tests/gate-map.json 的 file 字段与链上的写法是否一致。')
  process.exit(1)
}
const opened: string[] = entries.filter((e) => expectations.byFile.has(commandTestFile(e)))

console.log('verify-chain: 共 ' + entries.length + ' 条' + (only ? '（过滤 ' + only + '）' : '') + '，其中 ' + opened.length + ' 条带完成证据判据')
let done: number = 0
for (const entry of entries) {
  const parts: string[] = splitCommandArgs(entry)
  if (parts[0] !== 'node') { console.error('FAIL 非 node 条目拒绝执行：' + entry.slice(0, 120)); process.exit(1) }
  const expect = expectations.byFile.get(commandTestFile(entry))
  // 有期望的步骤要把 stdout 收下来读那行记录，所以不能直接 inherit；收完照样原样打出去，
  // 人看到的输出与从前一样，只是这一条要等它跑完才出现（只有已开闸的少数几条如此）。
  const r = expect
    ? spawnSync(process.execPath, argvOf(parts), { cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', shell: false })
    : spawnSync(process.execPath, argvOf(parts), { cwd: ROOT, stdio: 'inherit', shell: false })
  if (r.error) { console.error('FAIL 起不来：' + entry.slice(0, 120) + ' ' + String(r.error.message || r.error)); process.exit(1) }
  if (expect && typeof r.stdout === 'string' && r.stdout) process.stdout.write(r.stdout)
  if (r.status !== 0) { console.error('FAIL 止于：' + entry.slice(0, 160) + '（exit ' + r.status + '）'); process.exit(r.status) }
  if (expect) {
    const verdict = judgeStepCompletion(expect, r.status, r.stdout || '')
    if (!verdict.ok) {
      console.error('FAIL 完成证据对不上：' + commandTestFile(entry) + ' —— ' + verdict.reason)
      process.exit(1)
    }
  }
  done += 1
}
console.log('verify-chain: 全绿（' + done + ' 条，其中 ' + opened.length + ' 条带完成证据判据）')
