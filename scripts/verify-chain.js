#!/usr/bin/env node
// scripts/verify-chain.js —— verify 链的执行器（1.7.50 发布门禁红线的根治）。
//
// 名单只有一份来源：scripts/verify-stages.json（目录约定加显式排除表，#1125）
// 经由 scripts/lib/discover-gates.ts 的 planGates() 算出来。package.json 里
// 不再有那条长串（scripts.verify 现在就是 `node scripts/verify-chain.js`
// 这一句，本脚本不再读它 —— 读了会把自己当成一步，无限递归）。
// 烟链例外：scripts.smoke 那六条还住在 package.json 里（#1125 范围只动主链），
// --script smoke 走老路读字符串。
//
// 用法：node scripts/verify-chain.js（跑规划出来的主链）
//       node scripts/verify-chain.js --only <子串>（抽查：只跑名字含这个子串的条目）
//       node scripts/verify-chain.js --script smoke（跑 scripts.smoke，六条冒烟；#1178 起 npm run test:smoke 走这条）
//
// 为什么冒烟也走这一份（#1178）：从前 test:smoke 是一条裸的 && 串，谁给冒烟上的门禁开闸，
// 那条路都会静默漏掉下面的完成证据判据。现在两条链共用这一个执行器与同一份判据，
// 只是「名单怎么来」不同（主链走规划、冒烟读字符串），切法、挂装载钩子、首红即停全都一样。
//
// #1158 起多一条判据：只看退出码会被「跑到一半就收摊、退出码仍是 0」骗过去
// （#1146 实测：verify-deck-no-hang 的 21 条断言只跑到第 12 条就退出，整条链判绿）。
// 所以对「已开闸」的门禁（tests/gate-map.json 里 completionRecord 为 true 的那几扇），
// 要求它交出完成记录：退出码 0 且末行有 GATE-RESULT 且计数等于表里记着的期望，缺一判红。
// 没开闸的步骤保持老行为，只看退出码 —— 判据的写法与解析都在 tests/lib/gate-result.ts 一处。
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const { judgeStepCompletion, loadCompletionExpectations } = require('../tests/lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
// 名单（#1125）：主链走规划函数，冒烟仍读 package.json 字符串。判定只有一条：
// 要起的是 tests/ 下的文件才挂装载钩子。链上今天全是测试条目，写这条是为了跟并行执行器
// （scripts/verify-parallel.mjs 的 argvOf）保持同一口径——两处任一处改了，另一处必须跟着改。
const TS_HOOK = pathToFileURL(path.join(ROOT, 'scripts', 'ts-hook.mjs')).href
function argvOf(parts) {
  return parts[1] && parts[1].startsWith('tests/') ? ['--import', TS_HOOK, ...parts.slice(1)] : parts.slice(1)
}
// 命令行参数：--script 只认 smoke（缺省跑主链，即规划结果），--only 抽查（子串过滤）。
function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ''
}
const scriptName = argValue('--script') || 'verify'
let entries
if (scriptName === 'smoke') {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const chain = (raw.scripts && raw.scripts.smoke) || ''
  if (!chain) { console.error('FAIL package.json 里没有 scripts.smoke，没有可跑的链'); process.exit(1) }
  entries = splitChain(chain)
} else if (scriptName === 'verify') {
  // 主链：规划函数是名单的唯一来源（目录约定加显式排除表）。规划出来的命令
  // 本来就是一条一句，不用再按 && 切。
  const { planGates } = require('./lib/discover-gates.ts')
  entries = planGates(ROOT).map((s) => s.cmd)
} else {
  console.error('FAIL --script 只认 verify（缺省）与 smoke：' + scriptName)
  process.exit(1)
}

// 按 && 切，照顾双引号里的 &&（链里现在没有，引号分支是防御）。
function splitChain(s) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) { cur += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '&' && s[i + 1] === '&') {
      out.push(cur.replace(/\s+$/, ''))
      cur = ''
      i += 1
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.map((x) => x.trim()).filter(Boolean)
}

function splitArgs(cmd) {
  const args = []
  let cur = ''
  let quote = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (/\s/.test(ch)) { if (cur) { args.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) args.push(cur)
  return args
}

// 链上那一步跑的是哪个测试文件。归属表里的 file 就是这个写法（仓库相对路径、斜杠统一）。
// 主链上一步长这样：`node tests/verify-x.js`，第二个参数就是它；
// 冒烟链上多一层装载钩子：`node --import ./scripts/ts-hook.mjs tests/smoke-x.test.js`，
// 所以取「第一个落在 tests/ 下的参数」，找不到再退回第二个 —— 两种写法都能认出文件。
function gateFileOf(parts) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const testArg = parts.slice(1).find((p) => norm(p).startsWith('tests/'))
  const chosen = testArg || parts[1]
  return chosen ? norm(chosen) : ''
}

const only = argValue('--only')
entries = entries.filter((e) => !only || e.includes(only))
if (!entries.length) { console.error('FAIL 没有可跑的条目'); process.exit(1) }

// 完成证据（#1158）：归属表里记着「哪一扇已开闸、该有多少条断言」，这里按文件把期望挂到链上。
// 守卫（#1178 起逐条对）：表里记着开闸、而且它的步骤原文就在这条链上的，必须按文件挂得上；
// 挂不上说明「表里的 file 写法」与「链上的步骤写法」对不上，判据形同虚设 —— 当场判红，不许静默放行。
// 为什么不写成「至少挂上一扇」：冒烟链与主链各自开闸的门禁不是同一批，一刀切会误伤另一条链
// （冒烟链上今天就有两扇开闸，主链那六扇都不在它上面）。两条链都开闸时这个守卫照样逐条生效。
// 带 --only 抽查时不查这条：抽查本来就可能一条开闸的都没选中。
const expectations = loadCompletionExpectations()
const unmatched = entries.filter(
  (e) => expectations.byStep.has(e) && !expectations.byFile.has(gateFileOf(splitArgs(e))),
)
if (!only && unmatched.length) {
  console.error('FAIL 归属表里记着开闸、步骤原文也在这条链上，但按文件对不上（' + unmatched.length + ' 条）：')
  for (const e of unmatched.slice(0, 3)) console.error('  ' + e.slice(0, 120))
  console.error('  判据形同虚设，先核对 tests/gate-map.json 的 file 字段与链上的写法是否一致。')
  process.exit(1)
}
const opened = entries.filter((e) => expectations.byFile.has(gateFileOf(splitArgs(e))))

console.log('verify-chain: 共 ' + entries.length + ' 条' + (only ? '（过滤 ' + only + '）' : '') + '，其中 ' + opened.length + ' 条带完成证据判据')
let done = 0
for (const entry of entries) {
  const parts = splitArgs(entry)
  if (parts[0] !== 'node') { console.error('FAIL 非 node 条目拒绝执行：' + entry.slice(0, 120)); process.exit(1) }
  const expect = expectations.byFile.get(gateFileOf(parts))
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
      console.error('FAIL 完成证据对不上：' + gateFileOf(parts) + ' —— ' + verdict.reason)
      process.exit(1)
    }
  }
  done += 1
}
console.log('verify-chain: 全绿（' + done + ' 条，其中 ' + opened.length + ' 条带完成证据判据）')
