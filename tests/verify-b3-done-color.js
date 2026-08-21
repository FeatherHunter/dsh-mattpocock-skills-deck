// verify-b3-done-color.js — dsh-waystation v1.5 B3（#457）：map 列表行完成态「新会话」按钮与「完成」同色
// 用法: node tests/verify-b3-done-color.js（在插件根目录；无需 gh / 网络）
// 验证：
//   1) map 完成态（mapDone）时列表行「新会话」按钮 background=#3fb950、文字=#0c1a10（与「完成」同色）
//   2) 非完成态回退 actionColorOf(x, colorOf)（维持按 label 配色，不受影响）
//   3) 「完成」按钮本身保持 #3fb950 / #0c1a10
//   4) 范围守卫：仅列表行（openInNewSession(st, x)）带 mapDone 配色；详情面板（st, t）与 map 详情（st, m）的
//      新会话按钮不得带 mapDone 配色（D9/6A：只改 map 列表行，其余状态不变）
//   5) 双源镜像一致性（client.js ↔ package/lib/client.js 关键特征逐字等价）
const fs = require('fs')
const files = ['client.js', 'package/lib/client.js']
let failed = false
const check = function (ok, msg) { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('B3: 完成态「新会话」同色（#457）')

// 列表行动作组块 = 完成按钮 + 新会话按钮所在的连续行区间（互相比邻）
const actionGroup = function (src) {
  const lines = src.split('\n')
  let rowIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('openInNewSession(st, x)') && lines[i].includes('mapDone')) { rowIdx = i; break }
  }
  if (rowIdx < 0) return ''
  // 从新会话按钮行向前找同区块内的「完成」按钮行（mapDone ? h('button'...）
  let doneIdx = -1
  for (let i = rowIdx - 1; i >= 0 && i > rowIdx - 30; i--) {
    if (lines[i].includes("tr('map.doneTitle')")) { doneIdx = i; break }
  }
  if (doneIdx < 0) return ''
  return lines.slice(doneIdx, rowIdx + 1).join('\n')
}

const collected = {}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const block = actionGroup(src)
  const tag = f.indexOf('package/') >= 0 ? 'pkg' : 'cli'
  collected[tag] = block

  check(block.length > 0, f + ' 列表行动作组块（完成+新会话）提取成功')
  if (!block.length) { failed = true; continue }
  // 完成按钮 = 绿底深字
  check(block.includes("background: '#3fb950'"), f + ' 完成按钮 background #3fb950')
  check(block.includes("color: '#0c1a10'"), f + ' 完成按钮 color #0c1a10')
  // 新会话按钮完成态同色
  check(block.includes("background: mapDone ? '#3fb950' : actionColorOf(x, colorOf)"), f + ' 新会话完成态 background=#3fb950（非完成态回退 actionColorOf）')
  check(block.includes("color: mapDone ? '#0c1a10'"), f + ' 新会话完成态 color=#0c1a10')
  // 非完成态文字色逻辑保留（isLightHex 分支未删）
  check(block.includes("(isLightHex(actionColorOf(x, colorOf))"), f + ' 非完成态文字色仍按 isLightHex')
  // 范围守卫：详情面板(st, t) 与 map 详情(st, m) 的新会话按钮不得引用 mapDone
  const otherLines = src.split('\n').filter(l => (l.includes('openInNewSession(st, t)') || l.includes('openInNewSession(st, m)')) && l.includes('mapDone'))
  check(otherLines.length === 0, f + ' 详情面板/map 详情新会话按钮未带 mapDone 配色（范围=仅列表行）')
  // 列表行新会话按钮仅 1 处（无双写漂移）
  const rowCount = src.split('\n').filter(l => l.includes('openInNewSession(st, x)')).length
  check(rowCount === 1, f + ' 列表行新会话按钮仅 1 处（无双写漂移）')
}

// 双源一致性已移除（T5 #98：一源两物，build 保证同构）
// 保留对单产物（_dev/_pkg 各自）的完成态同色校验；双源逐字一致由构建保证

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
