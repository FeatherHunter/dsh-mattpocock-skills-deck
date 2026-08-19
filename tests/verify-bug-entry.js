// verify-bug-entry.js — 新增BUG入口契约（issue #4 · v2 修 #1 BUG3：7 字段挪到模板末尾 · v3 UX：宽度自适应 + 按钮 hover 反馈 · #14 契约升级（issue 称 v2→v3）：字段集精简为 4 项 + inline 指引（v3.1：zh/en 分离）+ EN locale 切换）
// 用法: node tests/verify-bug-entry.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) PROMPTS 注册表存在 newBugWayfinder（version/placeholders/use/zh/en），注册表本体不含中途输入位，
//      4 字段中英齐全出现在 NEW_BUG_FIELDS_BODY / NEW_BUG_FIELDS_BODY_EN（末尾输入位），
//      且不硬编码平台工具（无 /gh/、无 "gh issue"）—— 按用户拍板写泛化「带 bug 标签的 ISSUE」
//   2) i18n 键 nav.bugNew / nav.bugNewTitle / panel.newBug / panel.newBugTitle 双语平衡
//   3) StatusBar BUG 段悬停菜单接线（s.bugMenuOpen + tr('nav.bugNew') + 点「新增」开新会话预填 newBugWayfinderText）
//   4) 面板「+ 新增BUG单」按钮接线（panel.newBugTitle + openTextInNewSession(newBugWayfinderText) 两处渲染）
//   5) Ic bug 图标注册（case 'bug'）
//   6) 文本拼接：newBugWayfinderText = promptText + BODY_FORMAT + locale 切换（promptLang()==='en' ? EN : ZH）——字段真正落在末尾
//   7) 双源接线与注册表键一致（含 NEW_BUG_FIELDS_BODY_EN）
//   8) 死区回归守护：BUG 悬停菜单弹层 marginBottom=0（光标路径全在 span 后代集内；mouseleave 不误触）
//   9) 宽度自适应（v3 UX）：BUG 悬停菜单弹层无 minWidth（按内容收缩，不留空白）
//  10) hover 反馈（v3 UX）：按钮 bugMenuHover 状态 + onMouseEnter/Leave 接线 + 条件红染色
//  11) #14 契约升级 v3.1（2026-08-18 验收反馈重拍板）：字段集 = 期望 / 实际 / 复现步骤 / 环境信息（4 项）；「字段名：留白位」+ 下缩进行说明；zh / en 分离（一次只出一种，跟随 DSH 语言）
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
// #14：4 字段（顺序：期望 / 实际 / 复现 / 环境）
const FIELDS_ZH = ['期望：', '实际：', '复现步骤：', '环境信息：']
const FIELDS_EN = ['Expected:', 'Actual:', 'Reproduction:', 'Environment:']
// v3.1：说明与填写位分层 —— 每个字段名独占一行（冒号后留白），说明在下一行缩进（两空格）
const DESC_INDENT_ZH = ['应发生什么', '用户预期看到的结果', '实际看到了什么', '影响范围', '前置', '编号列表', '系统状态', 'DSW vX.Y.Z']
const DESC_INDENT_EN = ['What should happen', 'the result the user expected', 'What actually happened', 'impact notes', 'Preamble', 'numbered steps', 'system state', 'DSW vX.Y.Z']
// 字段名行 = 冒号结尾且后面紧跟说明行（`字段名：\n  说明`）—— 表单形态守护：字段名行不可直接跟内容
// 注意：常量字符串里换行是字面 `\n`（两字符，JS 源码字符串转义），正则需用 \\n 匹配
const INDENTED_DESC_RE = /(?:\\n){2}(?:期望|实际|复现步骤|环境信息)：\\n {2}(?:(?!\\n).)+/
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
    // v2（#1 BUG3 补强）延续：注册表本体不再含 4 字段（已挪到 NEW_BUG_FIELDS_BODY / 模板末尾）
    const inRegZh = FIELDS_ZH.filter(function (f) { return zh.indexOf(f) >= 0 })
    if (inRegZh.length) problems.push('newBugWayfinder zh 注册表本体含中途输入位：' + inRegZh.join(' / ') + '（必须挪到末尾）')
    const inRegEn = FIELDS_EN.filter(function (f) { return en.indexOf(f) >= 0 })
    if (inRegEn.length) problems.push('newBugWayfinder en 注册表本体含中途输入位：' + inRegEn.join(' / ') + '（must move to end）')
    // v2 提示语：流程说明结尾指向「末尾」
    if (zh.indexOf('模板末尾') < 0) problems.push('newBugWayfinder zh 缺「模板末尾」指引')
    if (en.indexOf('end of the prompt template') < 0) problems.push('newBugWayfinder en 缺 "end of the prompt template" 指引')
    // #14：注册表提示语不再宣称「7 字段」（与 4 字段集一致）
    if (zh.indexOf('7 字段清单') >= 0) problems.push('newBugWayfinder zh 提示语仍称「7 字段清单」（#14 应同步为 4）')
    if (en.indexOf('7-field checklist') >= 0) problems.push('newBugWayfinder en 提示语仍称 "7-field checklist"（#14 应同步为 4）')
    if (/\bgh\b/i.test(zh) || /gh issue/i.test(en)) problems.push('newBugWayfinder 不应硬编码平台工具 gh')
    if (zh.indexOf('bug 标签') < 0) problems.push('newBugWayfinder zh 缺「带 bug 标签的 ISSUE」指引')
    if (en.indexOf('bug label') < 0) problems.push('newBugWayfinder en 缺 "bug label" 指引')
  }
  // 1.5) NEW_BUG_FIELDS_BODY（zh 4 字段）+ NEW_BUG_FIELDS_BODY_EN（en 4 字段）—— #14
  const fieldsBodyMatch = /NEW_BUG_FIELDS_BODY\s*=\s*function\s*\(\)\s*\{\s*return\s*'([^']*)'\s*\}/.exec(src)
  if (!fieldsBodyMatch) {
    problems.push('缺 NEW_BUG_FIELDS_BODY 常量定义')
  } else {
    const fieldsBody = fieldsBodyMatch[1]
    const missingZh = FIELDS_ZH.filter(function (f) { return fieldsBody.indexOf(f) < 0 })
    if (missingZh.length) problems.push('NEW_BUG_FIELDS_BODY 缺中文字段：' + missingZh.join(' / '))
    // 不再允许 v2 旧字段残留（背景/场景/现象/期望行为/实际行为/影响范围 已吸收合并）
    const LEGACY_ZH = ['背景：', '场景：', '现象：', '期望行为：', '实际行为：', '影响范围：']
    const legacyIn = LEGACY_ZH.filter(function (f) { return fieldsBody.indexOf(f) >= 0 })
    if (legacyIn.length) problems.push('NEW_BUG_FIELDS_BODY 残留 v2 旧字段：' + legacyIn.join(' / '))
    const missingInline = DESC_INDENT_ZH.filter(function (k) { return fieldsBody.indexOf(k) < 0 })
    if (missingInline.length) problems.push('NEW_BUG_FIELDS_BODY 缺 zh 说明关键字：' + missingInline.join(' / '))
    // v3.1 分离守护：zh 说明行不应混入英文短语（防止中英混排回潮）
    if (fieldsBody.indexOf('What should happen') >= 0 || fieldsBody.indexOf('What actually happened') >= 0) problems.push('NEW_BUG_FIELDS_BODY 混入英文 inline（v3.1 已决议 zh 只中文说明）')
    // v3.1 表单形态守护：字段名独占行 + 说明缩进下一行
    if (!INDENTED_DESC_RE.test(fieldsBody)) problems.push('NEW_BUG_FIELDS_BODY 字段未独立成行且说明未缩进（期望形态：`字段名：\n  说明`）')
  }
  const fieldsBodyEnMatch = /NEW_BUG_FIELDS_BODY_EN\s*=\s*function\s*\(\)\s*\{\s*return\s*'([^']*)'\s*\}/.exec(src)
  if (!fieldsBodyEnMatch) {
    problems.push('缺 NEW_BUG_FIELDS_BODY_EN 常量定义')
  } else {
    const fieldsBodyEn = fieldsBodyEnMatch[1]
    const missingEn = FIELDS_EN.filter(function (f) { return fieldsBodyEn.indexOf(f) < 0 })
    if (missingEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺英文字段：' + missingEn.join(' / '))
    const missingInlineEn = DESC_INDENT_EN.filter(function (k) { return fieldsBodyEn.indexOf(k) < 0 })
    if (missingInlineEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺 en 说明关键字：' + missingInlineEn.join(' / '))
    // v3.1 分离守护：en 说明行不应混入中文（跟随 DSH 语言一次只出一种）
    if (fieldsBodyEn.indexOf('应发生什么') >= 0 || fieldsBodyEn.indexOf('实际看到了什么') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 混入中文说明（v3.1 已决议 en 只英文说明）')
    // en 侧旧字段残留守护（与 zh LEGACY_ZH 对称；防 v2 英文字段回潮）
    const LEGACY_EN = ['Background:', 'Scenario:', 'Phenomenon:', 'Expected Behavior:', 'Actual Behavior:', 'Impact:']
    const legacyEnIn = LEGACY_EN.filter(function (f) { return fieldsBodyEn.indexOf(f) >= 0 })
    if (legacyEnIn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 残留 v2 旧字段：' + legacyEnIn.join(' / '))
    if (!/(?:\\n){2}Expected:\\n {2}(?:(?!\\n).)+/.test(fieldsBodyEn)) problems.push('NEW_BUG_FIELDS_BODY_EN 字段未独立成行且说明未缩进（期望形态：`Expected:\n  ...`）')
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
  // 7) 文本拼接 + locale 切换：newBugWayfinderText = promptText + BODY_FORMAT + (promptLang()==='en' ? EN : ZH)
  const builderMatch = /newBugWayfinderText\s*=\s*\(st\)\s*=>[\s\S]*?\+ \(promptLang\(\) === 'en' \? NEW_BUG_FIELDS_BODY_EN\(\) : NEW_BUG_FIELDS_BODY\(\)\)/.test(src)
  if (!builderMatch) problems.push('newBugWayfinderText 拼接未含 locale 切换（promptLang() === \'en\' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY()）——末尾输入位缺失或无双语切换')
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
  else console.log('  PASS', file, '（newBugWayfinder v' + (m ? m[1] : '?') + ' · 4 字段在末尾 · locale 切换 · 开新会话接线 ' + opens + ' 处 · i18n 4 键）')
}
console.log('P1: 新增BUG入口契约（issue #4/#14 · 末尾输入位 + locale 切换）')
targets.forEach(check)
// P2: 双源一致性
console.log('P2: 双源一致性')
const srca = fs.readFileSync(targets[0], 'utf8')
const srcb = fs.readFileSync(targets[1], 'utf8')
let dualFail = false
;['"newBugWayfinder": {', "case 'bug':", "'nav.bugNew':", "'nav.bugNewTitle':", "'panel.newBug':", "'panel.newBugTitle':", 's.bugMenuOpen', 'openTextInNewSession(s, newBugWayfinderText(s)', 'NEW_BUG_FIELDS_BODY', 'NEW_BUG_FIELDS_BODY_EN'].forEach(function (k) {
  const a = srca.includes(k)
  const b = srcb.includes(k)
  if (a !== b) { console.log('  FAIL 双源不一致: ' + k); dualFail = true }
})
if (!dualFail) console.log('  PASS 双源接线一致')
else failed = true
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
