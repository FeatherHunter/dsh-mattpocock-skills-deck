#!/usr/bin/env node
// scripts/verify-chain.js —— verify 链的 Windows 执行器（1.7.50 发布门禁红线的根治）。
//
// 起因：package.json 里 scripts.verify 是一整串 node tests/*.js && ……（8639 字），
// Windows cmd.exe 单条命令上限 8191 字，npm test 经 cmd 转发直接报命令行过长，
// 在我之前就已经跑不起来（我加的那一项只是最后一根稻草）。bash 系（CI）不受影响。
// 修法：不断链（不断言链内容的门禁用 includes() 钉着它，只能读不能搬），
// 执行改走本脚本：读出链、按 && 切开、逐条直调 node，首红即停并透传退出码。
// 用法：node scripts/verify-chain.js（全链）或 node scripts/verify-chain.js --only <子串>（抽查）。
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
// 装载钩子：让链上的脚本能把 "./x.js" 解析到同目录的同名 .ts（迁移中的单元靠它，引用点一个字不改）。
// 没有同名 .ts 时钩子什么都不做，所以没迁移的条目行为与今天完全一样。
// 判定只有一条：要起的是 tests/ 下的文件才挂。链上今天全是测试条目，写这条是为了跟并行执行器
// （scripts/verify-parallel.mjs 的 argvOf）保持同一口径——两处任一处改了，另一处必须跟着改。
// 这一层只改「怎么起进程」，不动 package.json 里那条链的文字——不断链是不断言链内容的门禁钉住的约定。
const TS_HOOK = pathToFileURL(path.join(ROOT, 'scripts', 'ts-hook.mjs')).href
function argvOf(parts) {
  return parts[1] && parts[1].startsWith('tests/') ? ['--import', TS_HOOK, ...parts.slice(1)] : parts.slice(1)
}
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const chain = (raw.scripts && raw.scripts.verify) || ''
if (!chain) { console.error('FAIL verify 链为空'); process.exit(1) }

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

// 链上那一步跑的是哪个门禁文件。归属表里的 file 就是这个写法（仓库相对路径、斜杠统一）。
function gateFileOf(parts) {
  return parts[1] ? String(parts[1]).replace(/\\/g, '/').replace(/^\.\//, '') : ''
}

const only = (process.argv[2] === '--only' && process.argv[3]) ? process.argv[3] : ''
const entries = splitChain(chain).filter((e) => !only || e.includes(only))
if (!entries.length) { console.error('FAIL 没有可跑的条目'); process.exit(1) }

// 完成证据（#1158）：归属表里记着「哪一扇已开闸、该有多少条断言」，这里按文件把期望挂到链上。
// 一条都没挂上（而表里明明有已开闸的）说明两边写法对不上了，判据形同虚设 —— 当场判红，不许静默放行。
// 带 --only 抽查时不查这条：抽查本来就可能一条开闸的都没选中。
const expectations = loadCompletionExpectations()
const opened = entries.filter((e) => expectations.byFile.has(gateFileOf(splitArgs(e))))
if (!only && expectations.byFile.size && !opened.length) {
  console.error('FAIL 归属表里有 ' + expectations.byFile.size + ' 扇门禁已开闸（completionRecord: true），链上一条都没挂上：')
  console.error('  判据形同虚设，先核对 tests/gate-map.json 的 file 字段与链上的写法是否一致。')
  process.exit(1)
}

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
