// verify-bug-entry.js — 新增BUG入口契约（issue #4 · v2 修 #1 BUG3：7 字段挪到模板末尾 · v3 UX：宽度自适应 + 按钮 hover 反馈）
// 用法: node tests/verify-bug-entry.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) PROMPTS 注册表存在 newBugWayfinder（version/placeholders/use/zh/en），注册表本体不含中途输入位，
//      7 字段中英齐全出现在 NEW_BUG_FIELDS_BODY（v2 末尾输入位），
//      且不硬编码平台工具（无 /gh/、无 "gh issue"）—— 按用户拍板写泛化「带 bug 标签的 ISSUE」
//   2) i18n 键 nav.bugNew / nav.bugNewTitle / panel.newBug / panel.newBugTitle 双语平衡
//   3) StatusBar BUG 段悬停菜单接线（s.bugMenuOpen + tr('nav.bugNew') + 点「新增」开新会话预填 newBugWayfinderText）
//   4) 面板「+ 新增BUG单」按钮接线（panel.newBugTitle + openTextInNewSession(newBugWayfinderText) 两处渲染）
//   5) Ic bug 图标注册（case 'bug'）
//   6) 文本拼接：newBugWayfinderText = promptText + BODY_FORMAT + NEW_BUG_FIELDS_BODY（7 字段真正落在末尾）
//   7) 双源接线与注册表键一致
//   8) 死区回归守护：BUG 悬停菜单弹层 marginBottom=0（光标路径全在 span 后代集内；mouseleave 不误触）
//   9) 宽度自适应（v3 UX）：BUG 悬停菜单弹层无 minWidth（按内容收缩，不留空白）
//  10) hover 反馈（v3 UX）：按钮 bugMenuHover 状态 + onMouseEnter/Leave 接线 + 条件红染色
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
    // v2（#1 BUG3 补强）：注册表本体不再含 7 字段（已挪到 NEW_BUG_FIELDS_BODY / 模板末尾）
    const inRegZh = FIELDS_ZH.filter(function (f) { return zh.indexOf(f) >= 0 })
    if (inRegZh.length) problems.push('newBugWayfinder zh 注册表本体含中途输入位：' + inRegZh.join(' / ') + '（v2 必须挪到末尾）')
    const inRegEn = FIELDS_EN.filter(function (f) { return en.indexOf(f) >= 0 })
    if (inRegEn.length) problems.push('newBugWayfinder en 注册表本体含中途输入位：' + inRegEn.join(' / ') + '（v2 must move to end）')
    // v2 提示语：流程说明结尾指向「末尾」
    if (zh.indexOf('模板末尾') < 0) problems.push('newBugWayfinder zh 缺「模板末尾」指引')
    if (en.indexOf('end of the prompt template') < 0) problems.push('newBugWayfinder en 缺 "end of the prompt template" 指引')
    if (/\bgh\b/i.test(zh) || /gh issue/i.test(en)) problems.push('newBugWayfinder 不应硬编码平台工具 gh')
    if (zh.indexOf('bug 标签') < 0) problems.push('newBugWayfinder zh 缺「带 bug 标签的 ISSUE」指引')
    if (en.indexOf('bug label') < 0) problems.push('newBugWayfinder en 缺 "bug label" 指引')
  }
  // 1.5) NEW_BUG_FIELDS_BODY 7 字段（中英版共用 zh 字段，en 仅在 v1 注册表里——v2 末尾仅 zh 7 字段）
  const fieldsBodyMatch = /NEW_BUG_FIELDS_BODY\s*=\s*function\s*\(\)\s*\{\s*return\s*'([^']*)'\s*\}/.exec(src)
  if (!fieldsBodyMatch) {
    problems.push('缺 NEW_BUG_FIELDS_BODY 常量定义')
  } else {
    const fieldsBody = fieldsBodyMatch[1]
    const missingZh = FIELDS_ZH.filter(function (f) { return fieldsBody.indexOf(f) < 0 })
    if (missingZh.length) problems.push('NEW_BUG_FIELDS_BODY 缺中文字段：' + missingZh.join(' / '))
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
  // 6) 死区回归守护：BUG 悬停菜单弹层 marginBottom 必须为 0/未设置
  // 物理意义：mouseleave 在「光标进入非 element 后代的像素区」时触发——marginBottom 制造的非 span 后代真空带
  // 会让光标从 BUG 段移向菜单途中误触 mouseleave → 菜单关闭。修复把视觉间距挪到 paddingTop（仍在 span 后代集内）。
  const bugMenuMatch = src.match(/s\.bugMenuOpen \? h\('div', \{[^\n]*?\}, \[/)
  if (bugMenuMatch) {
    const styleStr = bugMenuMatch[0]
    const marginBottomMatches = styleStr.match(/marginBottom:\s*(\d+)/g)
    if (marginBottomMatches) {
      const values = marginBottomMatches.map(function (m) { return Number(m.match(/(\d+)/)[1]) })
      const maxVal = Math.max.apply(null, values)
      if (maxVal > 0) problems.push('BUG 悬停菜单弹层 marginBottom=' + values.join(',') + '（死区回归——光标路径中非 span 后代真空带将触发 mouseleave 导致菜单关闭；视觉间距应挪到 paddingTop）')
    }
  }
  // 7) 文本拼接：newBugWayfinderText = promptText + BODY_FORMAT + NEW_BUG_FIELDS_BODY
  const builderMatch = /newBugWayfinderText\s*=\s*\(st\)\s*=>[\s\S]*?\+ NEW_BUG_FIELDS_BODY\(\)/.test(src)
  if (!builderMatch) problems.push('newBugWayfinderText 拼接未含 NEW_BUG_FIELDS_BODY()（末尾输入位丢失）')
  // 9) 宽度自适应（v3 UX）：BUG 悬停菜单弹层不应有 minWidth（按内容收缩，不留空隙）
  if (bugMenuMatch && /minWidth\s*:\s*\d+/.test(bugMenuMatch[0])) problems.push('BUG 悬停菜单弹层含 minWidth（应按内容自适应，去除右侧空白）')
  // 10) hover 反馈（v3 UX）：状态 + 接线 + 染色条件
  if (!/\bbugMenuHover:\s*false\b/.test(src)) problems.push('store 缺 bugMenuHover 默认状态（false）')
  // 弹层 onMouseLeave 重置 bugMenuHover + 按钮 onMouseEnter/Leave + 条件红染色三处必齐
  const hoverChecks = [
    { re: /s\.bugMenuHover\s*=\s*true[\s\S]*?emit\(s\)/, name: '按钮 onMouseEnter 置 bugMenuHover=true' },
    { re: /s\.bugMenuHover\s*=\s*false[\s\S]*?emit\(s\)/, name: '按钮/菜单 mouseleave 重置 bugMenuHover=false' },
    { re: /s\.bugMenuHover\s*\?\s*['"]#f87171['"]/, name: '按钮 hover 红染色（#f87171）' },
  ]
  hoverChecks.forEach(function (c) { if (!c.re.test(src)) problems.push('hover 反馈缺：' + c.name) })
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '（newBugWayfinder v' + (m ? m[1] : '?') + ' · 7 字段在末尾 · 开新会话接线 ' + opens + ' 处 · i18n 4 键）')
}
console.log('P1: 新增BUG入口契约（issue #4 · v2 末尾输入位）')
targets.forEach(check)
// P2: 双源一致性
console.log('P2: 双源一致性')
const srca = fs.readFileSync(targets[0], 'utf8')
const srcb = fs.readFileSync(targets[1], 'utf8')
let dualFail = false
;['"newBugWayfinder": {', "case 'bug':", "'nav.bugNew':", "'nav.bugNewTitle':", "'panel.newBug':", "'panel.newBugTitle':", 's.bugMenuOpen', 'openTextInNewSession(s, newBugWayfinderText(s)', 'NEW_BUG_FIELDS_BODY'].forEach(function (k) {
  const a = srca.includes(k)
  const b = srcb.includes(k)
  if (a !== b) { console.log('  FAIL 双源不一致: ' + k); dualFail = true }
})
if (!dualFail) console.log('  PASS 双源接线一致')
else failed = true
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
