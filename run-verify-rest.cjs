// 临时跳门运行器（不提交）：跑 verify 链里 verify-leaves.js 之后的所有条目。
// verify-leaves.js 当前因 StatusBar.js 359→360 基线漂移变红（#640 的遗留，非本票），
// 先跳过它，确认链上其余（尤其是本票五条新门禁）是否全绿。
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname)
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const chain = (raw.scripts && raw.scripts.verify) || ''
const entries = chain.split('&&').map((x) => x.trim()).filter(Boolean)
const idx = entries.findIndex((e) => e.includes('verify-leaves.js'))
const rest = entries.slice(idx + 1)
console.log('共跳过 ' + (idx + 1) + ' 条（含 verify-leaves），跑剩余 ' + rest.length + ' 条')
let done = 0
const reds = []
for (const entry of rest) {
  const parts = entry.split(/\s+/).filter(Boolean)
  const r = spawnSync(process.execPath, parts.slice(1), { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
  if (r.status !== 0) {
    reds.push(entry)
    console.log('FAIL ' + entry)
    console.log(String(r.stdout || '').split('\n').filter((l) => l.includes('FAIL')).slice(0, 5).join('\n'))
  } else {
    done += 1
  }
}
console.log('剩余链：' + done + ' 绿，' + reds.length + ' 红')
if (reds.length) console.log('红：\n' + reds.join('\n'))
process.exit(reds.length ? 1 : 0)
