// verify-bug-entry.js — 新增BUG入口契约（issue #4）
// 用法: node tests/verify-bug-entry.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) PROMPTS 注册表存在 newBugWayfinder（version/placeholders/use/zh/en），7 字段中英齐全，
//      且不硬编码平台工具（无 /gh/、无 "gh issue"）—— 按用户拍板写泛化「带 bug 标签的 ISSUE」
//   2) i18n 键 nav.bugNew / nav.bugNewTitle / panel.newBug / panel.newBugTitle 双语平衡
//   3) StatusBar BUG 段悬停菜单接线（s.bugMenuOpen + tr('nav.bugNew') + 点「新增」开新会话预填 newBugWayfinderText）
//   4) 面板「+ 新增BUG单」按钮接线（panel.newBugTitle + openTextInNewSession(newBugWayfinderText) 两处渲染）
//   5) Ic bug 图标注册（case 'bug'）
//   6) 双源接线与注册表键一致
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
const FIELDS_ZH = ['背景：', '场景：', '现象：', '复现步骤：', '期望行为：', '实际行为：', '影响范围：']
const FIELDS_EN = ['Background:', 'Scenario:', 'Symptom:', 'Reproduction steps:', 'Expected behavior:', 'Actual behavior:', 'Impact:']
const RE_ENTRY = /"newBugWayfinder": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '([^']*)', zh: '([^']*)', en: '([^']*)' \}/
const check = function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const problems = []
  // 1) 注册表条目
  const m = src.match(RE_ENTRY)
  if (!m) { problems.push('缺 newBugWayfinder 注册表条目') }
  else {
    const ver = Number(m[1])
    const phRaw = m[2]
    const use = m[3]
    const zh = m[4]
    const en = m[5]
    if (ver < 1) problems.push('newBugWayfinder 版本异常 v' + ver)
    if (!use) problems.push('newBugWayfinder 缺 use')
    const ph = phRaw.split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean)
    if (ph.join(',') !== 'repo') problems.push('newBugWayfinder 占位符应为 ["repo"]，实际 ' + JSON.stringify(ph))
    const missingZh = FIELDS_ZH.filter(function (f) { return zh.indexOf(f) < 0 })
    if (missingZh.length) problems.push('newBugWayfinder zh 缺字段：' + missingZh.join(' / '))
    const missingEn = FIELDS_EN.filter(function (f) { return en.indexOf(f) < 0 })
    if (missingEn.length) problems.push('newBugWayfinder en 缺字段：' + missingEn.join(' / '))
    if (/\bgh\b/i.test(zh) || /gh issue/i.test(en)) problems.push('newBugWayfinder 不应硬编码平台工具 gh')
    if (zh.indexOf('bug 标签') < 0) problems.push('newBugWayfinder zh 缺「带 bug 标签的 ISSUE」指引')
    if (en.indexOf('bug label') < 0) problems.push('newBugWayfinder en 缺 "bug label" 指引')
  }
  // 2) i18n 键
  ;['nav.bugNew', 'nav.bugNewTitle', 'panel.newBug', 'panel.newBugTitle'].forEach(function (k) {
    if (src.indexOf("'" + k + "':") < 0) problems.push('缺 i18n 键 ' + k)
  })
  // 3) StatusBar 悬停菜单接线
  if (!src.includes('s.bugMenuOpen')) problems.push('缺 s.bugMenuOpen 状态')
  if (src.indexOf("tr('nav.bugNew')") < 0) problems.push('状态栏菜单缺 nav.bugNew 引用')
  // 4) 面板按钮接线：newBugWayfinder 开新会话 ≥ 3 处（状态栏 1 + 面板 2）
  const opens = (src.match(/openTextInNewSession\(s, newBugWayfinderText\(s\)/g) || []).length
  if (opens < 3) problems.push('newBugWayfinder 开新会话接线 < 3（实际 ' + opens + '）')
  if ((src.match(/tr\('panel\.newBug'\)/g) || []).length < 2) problems.push('panel.newBug 引用 < 2（按钮文字/会话标题）')
  // 5) Ic bug 图标
  if (src.indexOf("case 'bug':") < 0) problems.push('缺 Ic bug 图标')
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '（newBugWayfinder v' + (m ? m[1] : '?') + ' · 开新会话接线 ' + opens + ' 处 · i18n 4 键）')
}
console.log('P1: 新增BUG入口契约（issue #4）')
targets.forEach(check)
// P2: 双源一致性
console.log('P2: 双源一致性')
const srca = fs.readFileSync(targets[0], 'utf8')
const srcb = fs.readFileSync(targets[1], 'utf8')
let dualFail = false
;['"newBugWayfinder": {', "case 'bug':", "'nav.bugNew':", "'nav.bugNewTitle':", "'panel.newBug':", "'panel.newBugTitle':", 's.bugMenuOpen', 'openTextInNewSession(s, newBugWayfinderText(s)'].forEach(function (k) {
  const a = srca.includes(k)
  const b = srcb.includes(k)
  if (a !== b) { console.log('  FAIL 双源不一致: ' + k); dualFail = true }
})
if (!dualFail) console.log('  PASS 双源接线一致')
else failed = true
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
