#!/usr/bin/env node
// scripts/verify-chain.js —— verify 链的 Windows 执行器（1.7.50 发布门禁红线的根治）。
//
// 起因：package.json 里 scripts.verify 是一整串 node tests/*.js && ……（8639 字），
// Windows cmd.exe 单条命令上限 8191 字，npm test 经 cmd 转发直接报命令行过长，
// 在我之前就已经跑不起来（我加的那一项只是最后一根稻草）。bash 系（CI）不受影响。
// 修法：不断链（不断言链内容的门禁用 includes() 钉着它，只能读不能搬），
// 执行改走本脚本：读出链、按 && 切开、逐条直调 node，首红即停并透传退出码。
// 用法：node scripts/verify-chain.js（全链）或 node scripts/verify-chain.js --only <子串>（抽查）。
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
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

const only = (process.argv[2] === '--only' && process.argv[3]) ? process.argv[3] : ''
const entries = splitChain(chain).filter((e) => !only || e.includes(only))
if (!entries.length) { console.error('FAIL 没有可跑的条目'); process.exit(1) }
console.log('verify-chain: 共 ' + entries.length + ' 条' + (only ? '（过滤 ' + only + '）' : ''))
let done = 0
for (const entry of entries) {
  const parts = splitArgs(entry)
  if (parts[0] !== 'node') { console.error('FAIL 非 node 条目拒绝执行：' + entry.slice(0, 120)); process.exit(1) }
  const r = spawnSync(process.execPath, parts.slice(1), { cwd: ROOT, stdio: 'inherit', shell: false })
  if (r.error) { console.error('FAIL 起不来：' + entry.slice(0, 120) + ' ' + String(r.error.message || r.error)); process.exit(1) }
  if (r.status !== 0) { console.error('FAIL 止于：' + entry.slice(0, 160) + '（exit ' + r.status + '）'); process.exit(r.status) }
  done += 1
}
console.log('verify-chain: 全绿（' + done + ' 条）')
