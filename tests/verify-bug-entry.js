// verify-bug-entry.js — 新增BUG入口契约（issue #4 · v2 修 #1 BUG3：7 字段挪到末尾 · v3 UX：宽度自适应 + 按钮 hover 反馈 · #14 契约 v3.4：4 项 + 例行紧贴 · v4 #63 grilling 定版：去内部规则+实际→期望+括号单行）
// 用法: node tests/verify-bug-entry.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) PROMPTS 注册表 newBugWayfinder（version≥4/placeholders/use/zh/en），注册表本体为极简（按 wayfinder 技能规则处理），不含内部规则展开，4 字段括号单行在 NEW_BUG_FIELDS_BODY(_EN)（末尾），无 gh 硬编码
//   2) i18n 键 nav.bugNew / nav.bugNewTitle / panel.newBug / panel.newBugTitle 双语平衡
//   3) StatusBar BUG 段悬停菜单接线（s.bugMenuOpen + tr('nav.bugNew') + 点「新增」开新会话预填 newBugWayfinderText）
//   4) 面板「+ 新增BUG单」按钮接线（panel.newBugTitle + openTextInNewSession(newBugWayfinderText) 两处渲染）
//   5) Ic bug 图标注册（case 'bug'）
//   6) 文本拼接：newBugWayfinderText = promptText + BODY_FORMAT + locale 切换（promptLang()==='en' ? EN : ZH）——字段真正落在末尾
//   7) 双源接线与注册表键一致（含 NEW_BUG_FIELDS_BODY_EN）
//   8) 死区回归守护：BUG 悬停菜单弹层 marginBottom=0
//   9) 宽度自适应（v3 UX）：弹层无 minWidth
//  10) hover 反馈（v3 UX）：bugMenuHover 状态 + onMouseEnter/Leave + 条件红染色
//  11) v4 #63：字段集 = 实际→期望→复现步骤→环境信息（4 项括号单行），顺序实际→期望，无悬行例行，zh/en 分离
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
// v4 #63：4 字段（顺序：实际 → 期望 → 复现 → 环境）括号单行形态
const FIELDS_ZH = ['实际（看到什么；可含影响范围）：', '期望（应发生什么 / 预期结果）：', '复现步骤（[前置 / 场景] + 编号步骤）：', '环境信息（OS + 浏览器 + 插件版本）：']
const FIELDS_EN = ['Actual (what happened; may include impact):', 'Expected (what should happen / expected result):', 'Reproduction ([Preamble / Scenario] + numbered steps):', 'Environment (OS + browser + plugin version):']
// v4：括号内说明即指引，无独立例行；仍需校验说明关键字在场（防文案丢失）
const DESC_ZH = ['看到什么', '影响范围', '应发生什么', '预期结果', '前置', '编号步骤', '插件版本']
const DESC_EN = ['what should happen', 'expected result', 'what happened', 'impact', 'Preamble', 'numbered steps', 'plugin version']
// v4 形态守护：括号单行，每字段为 “字段名（说明）：” 单行，字段间用 \n 分隔，无 “\n  例：” 悬行
const BRACKET_LINE_ZH = ['实际（看到什么；可含影响范围）：', '期望（应发生什么 / 预期结果）：', '复现步骤（[前置 / 场景] + 编号步骤）：', '环境信息（OS + 浏览器 + 插件版本）：']
const BRACKET_LINE_EN = ['Actual (what happened; may include impact):', 'Expected (what should happen / expected result):', 'Reproduction ([Preamble / Scenario] + numbered steps):', 'Environment (OS + browser + plugin version):']
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
    if (ver < 4) problems.push('newBugWayfinder 版本异常 v' + ver + '（v4 #63 应 ≥4）')
    if (!use) problems.push('newBugWayfinder 缺 use')
    const ph = phRaw.split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean)
    if (ph.join(',') !== 'repo') problems.push('newBugWayfinder 占位符应为 ["repo"]，实际 ' + JSON.stringify(ph))
    // v4：注册表本体为极简（按 wayfinder 技能规则处理），不含内部规则展开
    if (zh.indexOf('请帮我新增一个 BUG 单（按 wayfinder 技能规则处理）。') < 0) problems.push('newBugWayfinder zh 缺极简句“请帮我新增一个 BUG 单（按 wayfinder 技能规则处理）。”')
    if (en.indexOf('Please help me file a new BUG ticket (follow the wayfinder skill rules).') < 0) problems.push('newBugWayfinder en 缺极简句 "Please help me file a new BUG ticket (follow the wayfinder skill rules)."')
    if (zh.indexOf('仓库：{repo}') < 0) problems.push('newBugWayfinder zh 缺“仓库：{repo}”')
    if (en.indexOf('Repo: {repo}') < 0) problems.push('newBugWayfinder en 缺 "Repo: {repo}"')
    // v4 去内部规则：不应含旧的展开式流程说明
    if (zh.indexOf('先澄清') >= 0) problems.push('newBugWayfinder zh 不应含内部规则“先澄清”（v4 已去）')
    if (zh.indexOf('判断分类') >= 0) problems.push('newBugWayfinder zh 不应含内部规则“判断分类”（v4 已去）')
    if (zh.indexOf('进度：0%') >= 0) problems.push('newBugWayfinder zh 不应含“进度：0%”（v4 已去，wayfinder 技能自带）')
    if (en.indexOf('Clarify first') >= 0) problems.push('newBugWayfinder en 不应含内部规则 "Clarify first"（v4 已去）')
    if (en.indexOf('Decide the case') >= 0) problems.push('newBugWayfinder en 不应含内部规则 "Decide the case"（v4 已去）')
    // v4 去模板末尾自指：不应再出现
    if (zh.indexOf('模板末尾') >= 0) problems.push('newBugWayfinder zh 不应含“模板末尾”自指（v4 已去）')
    if (en.indexOf('end of the prompt template') >= 0) problems.push('newBugWayfinder en 不应含 "end of the prompt template" 自指（v4 已去）')
    // v2 延续：注册表本体不再含字段（已挪到 NEW_BUG_FIELDS_BODY 末尾）—— 用新括号形态检测
    const inRegZh = FIELDS_ZH.filter(function (f) { return zh.indexOf(f) >= 0 })
    if (inRegZh.length) problems.push('newBugWayfinder zh 注册表本体含中途输入位：' + inRegZh.join(' / ') + '（必须挪到末尾）')
    const inRegEn = FIELDS_EN.filter(function (f) { return en.indexOf(f) >= 0 })
    if (inRegEn.length) problems.push('newBugWayfinder en 注册表本体含中途输入位：' + inRegEn.join(' / ') + '（must move to end）')
    // 不应再宣称“7 字段”
    if (zh.indexOf('7 字段清单') >= 0) problems.push('newBugWayfinder zh 提示语仍称「7 字段清单」')
    if (en.indexOf('7-field checklist') >= 0) problems.push('newBugWayfinder en 提示语仍称 "7-field checklist"')
    if (/\bgh\b/i.test(zh) || /gh issue/i.test(en)) problems.push('newBugWayfinder 不应硬编码平台工具 gh')
  }
  // 1.5) NEW_BUG_FIELDS_BODY（zh 4 字段括号单行）+ NEW_BUG_FIELDS_BODY_EN（en 4 字段括号单行）—— v4 #63
  const fieldsBodyMatch = /NEW_BUG_FIELDS_BODY\s*=\s*function\s*\(\)\s*\{\s*return\s*'([^']*)'\s*\}/.exec(src)
  if (!fieldsBodyMatch) {
    problems.push('缺 NEW_BUG_FIELDS_BODY 常量定义')
  } else {
    const fieldsBody = fieldsBodyMatch[1]
    // 顺序与完整性（v4 顺序实际→期望→复现→环境）
    const orderOk = fieldsBody.indexOf(FIELDS_ZH[0]) < fieldsBody.indexOf(FIELDS_ZH[1]) && fieldsBody.indexOf(FIELDS_ZH[1]) < fieldsBody.indexOf(FIELDS_ZH[2]) && fieldsBody.indexOf(FIELDS_ZH[2]) < fieldsBody.indexOf(FIELDS_ZH[3])
    if (!orderOk) problems.push('NEW_BUG_FIELDS_BODY 顺序非实际→期望→复现→环境')
    const missingZh = FIELDS_ZH.filter(function (f) { return fieldsBody.indexOf(f) < 0 })
    if (missingZh.length) problems.push('NEW_BUG_FIELDS_BODY 缺中文字段：' + missingZh.join(' / '))
    // 不再允许 v2 旧字段残留（背景/场景/现象/期望行为/实际行为/影响范围 已吸收合并）+ 旧形态“期望：\n  例：”
    const LEGACY_ZH = ['背景：', '场景：', '现象：', '期望行为：', '实际行为：', '影响范围：']
    const legacyIn = LEGACY_ZH.filter(function (f) { return fieldsBody.indexOf(f) >= 0 })
    if (legacyIn.length) problems.push('NEW_BUG_FIELDS_BODY 残留 v2 旧字段：' + legacyIn.join(' / '))
    if (fieldsBody.indexOf('\\n  例：') >= 0) problems.push('NEW_BUG_FIELDS_BODY 仍含旧形态悬行“\\n  例：”（v4 已改为括号单行）')
    const missingInline = DESC_ZH.filter(function (k) { return fieldsBody.indexOf(k) < 0 })
    if (missingInline.length) problems.push('NEW_BUG_FIELDS_BODY 缺 zh 说明关键字：' + missingInline.join(' / '))
    // v4 分离守护：zh 不应混入英文短语（防止中英混排回潮）
    if (fieldsBody.indexOf('What should happen') >= 0 || fieldsBody.indexOf('What actually happened') >= 0) problems.push('NEW_BUG_FIELDS_BODY 混入英文 inline（v4 zh 只中文说明）')
    // v4 形态守护：括号单行，末尾以 环境信息（OS + 浏览器 + 插件版本）：收尾
    if (!fieldsBody.endsWith('环境信息（OS + 浏览器 + 插件版本）：')) problems.push('NEW_BUG_FIELDS_BODY 末尾非「环境信息（OS + 浏览器 + 插件版本）：」收尾')
    // 括号单行完整性
    const missingBrZh = BRACKET_LINE_ZH.filter(function (g) { return fieldsBody.indexOf(g) < 0 })
    if (missingBrZh.length) problems.push('NEW_BUG_FIELDS_BODY 缺括号单行：' + missingBrZh.join(' / '))
  }
  const fieldsBodyEnMatch = /NEW_BUG_FIELDS_BODY_EN\s*=\s*function\s*\(\)\s*\{\s*return\s*'([^']*)'\s*\}/.exec(src)
  if (!fieldsBodyEnMatch) {
    problems.push('缺 NEW_BUG_FIELDS_BODY_EN 常量定义')
  } else {
    const fieldsBodyEn = fieldsBodyEnMatch[1]
    const orderOkEn = fieldsBodyEn.indexOf(FIELDS_EN[0]) < fieldsBodyEn.indexOf(FIELDS_EN[1]) && fieldsBodyEn.indexOf(FIELDS_EN[1]) < fieldsBodyEn.indexOf(FIELDS_EN[2]) && fieldsBodyEn.indexOf(FIELDS_EN[2]) < fieldsBodyEn.indexOf(FIELDS_EN[3])
    if (!orderOkEn) problems.push('NEW_BUG_FIELDS_BODY_EN 顺序非 Actual→Expected→Reproduction→Environment')
    const missingEn = FIELDS_EN.filter(function (f) { return fieldsBodyEn.indexOf(f) < 0 })
    if (missingEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺英文字段：' + missingEn.join(' / '))
    const missingInlineEn = DESC_EN.filter(function (k) { return fieldsBodyEn.indexOf(k) < 0 })
    if (missingInlineEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺 en 说明关键字：' + missingInlineEn.join(' / '))
    // v4 分离守护：en 不应混入中文（跟随 DSH 语言一次只出一种）
    if (fieldsBodyEn.indexOf('应发生什么') >= 0 || fieldsBodyEn.indexOf('实际看到了什么') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 混入中文说明（v4 en 只英文说明）')
    // en 侧旧字段残留守护
    const LEGACY_EN = ['Background:', 'Scenario:', 'Phenomenon:', 'Expected Behavior:', 'Actual Behavior:', 'Impact:']
    const legacyEnIn = LEGACY_EN.filter(function (f) { return fieldsBodyEn.indexOf(f) >= 0 })
    if (legacyEnIn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 残留 v2 旧字段：' + legacyEnIn.join(' / '))
    if (fieldsBodyEn.indexOf('\\n  e.g.') >= 0) problems.push('NEW_BUG_FIELDS_BODY_EN 仍含旧形态悬行“\\n  e.g.”（v4 已改为括号单行）')
    const missingBrEn = BRACKET_LINE_EN.filter(function (g) { return fieldsBodyEn.indexOf(g) < 0 })
    if (missingBrEn.length) problems.push('NEW_BUG_FIELDS_BODY_EN 缺括号单行：' + missingBrEn.join(' / '))
    if (!fieldsBodyEn.endsWith('Environment (OS + browser + plugin version):')) problems.push('NEW_BUG_FIELDS_BODY_EN 末尾非 "Environment (OS + browser + plugin version):" 收尾')
  }
  // 2) i18n 键
  ;['nav.bugNew', 'nav.bugNewTitle', 'panel.newBug', 'panel.newBugTitle'].forEach(function (k) {
    if (src.indexOf("'" + k + "':") < 0) problems.push('缺 i18n 键 ' + k)
  })
  // 3) StatusBar 悬停菜单接线
  if (!src.includes('s.bugMenuOpen')) problems.push('缺 s.bugMenuOpen 状态')
  if (src.indexOf("tr('nav.bugNew')") < 0) problems.push('状态栏菜单缺 nav.bugNew 引用')
  // 4) 面板按钮接线：newBugWayfinder 开新会话 ≥ 2 处（状态栏 1 + 共享 Tabs 行 1；#97 T4 去重后 Dock/Overlay tabs 行合成一处）
  const opens = (src.match(/openTextInNewSession\(s, newBugWayfinderText\(s\)/g) || []).length
  if (opens < 2) problems.push('newBugWayfinder 开新会话接线 < 2（实际 ' + opens + '）')
  // #211 占位：会话标题改用 newSessionTitleNew('bug')（双语 [New] 占位），按钮文字仍用 panel.newBug（≥1），标题不再强求 tr('panel.newBug')
  if ((src.match(/tr\('panel\.newBug'\)/g) || []).length < 1) problems.push('panel.newBug 引用 < 1（按钮文字）')
  if (!src.includes('newSessionTitleNew')) problems.push('缺 newSessionTitleNew 占位构造（#211）')
  // 5) Ic bug 图标
  if (src.indexOf("case 'bug':") < 0) problems.push('缺 Ic bug 图标')
  // 6) 死区回归守护：BUG 悬停菜单弹层 marginBottom 必须为 0/未设置
  const bugMenuMatch = src.match(/s\.bugMenuOpen \? h\('div', \{[^\n]*?\}, \[/)
  if (bugMenuMatch) {
    const styleStr = bugMenuMatch[0]
    const marginBottomMatches = styleStr.match(/marginBottom:\s*(\d+)/g)
    if (marginBottomMatches) {
      const values = marginBottomMatches.map(function (m) { return Number(m.match(/(\d+)/)[1]) })
      const maxVal = Math.max.apply(null, values)
      if (maxVal > 0) problems.push('BUG 悬停菜单弹层 marginBottom=' + values.join(',') + '（死区回归）')
    }
  }
  // 7) 文本拼接 + locale 切换：newBugWayfinderText = promptText + BODY_FORMAT + (promptLang()==='en' ? EN : ZH)
  const builderMatch = /newBugWayfinderText\s*=\s*\(st\)\s*=>[\s\S]*?\+ \(promptLang\(\) === 'en' \? NEW_BUG_FIELDS_BODY_EN\(\) : NEW_BUG_FIELDS_BODY\(\)\)/.test(src)
  if (!builderMatch) problems.push('newBugWayfinderText 拼接未含 locale 切换（promptLang() === \'en\' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY()）')
  // 9) 宽度自适应（v3 UX）：不应有 minWidth
  if (bugMenuMatch && /minWidth\s*:\s*\d+/.test(bugMenuMatch[0])) problems.push('BUG 悬停菜单弹层含 minWidth（应按内容自适应）')
  // 10) hover 反馈
  if (!/\bbugMenuHover:\s*false\b/.test(src)) problems.push('store 缺 bugMenuHover 默认状态（false）')
  const hoverChecks = [
    { re: /s\.bugMenuHover\s*=\s*true[\s\S]*?emit\(s\)/, name: '按钮 onMouseEnter 置 bugMenuHover=true' },
    { re: /s\.bugMenuHover\s*=\s*false[\s\S]*?emit\(s\)/, name: '按钮/菜单 mouseleave 重置 bugMenuHover=false' },
    { re: /s\.bugMenuHover\s*\?\s*['"]#f87171['"]/, name: '按钮 hover 红染色（#f87171）' },
  ]
  hoverChecks.forEach(function (c) { if (!c.re.test(src)) problems.push('hover 反馈缺：' + c.name) })
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '（newBugWayfinder v' + (m ? m[1] : '?') + ' · 实际→期望括号单行 · locale 切换 · 开新会话接线 ' + opens + ' 处 · i18n 4 键）')
}
console.log('P1: 新增BUG入口契约（issue #4/#63 v4 · 实际→期望括号单行 + locale 切换）')
targets.forEach(check)
// P2 已移除（T5 #98 阶段 3 收尾：产物 = f(src) 一源两物，src 为真源，产物由构建生成；
// 双源文本镜像断言已由运行时冒烟 + src↔产物逐字断言取代）
// 保留 P1 对单产物（含默认两产物各自）的行为特征校验；不再校验 client.js ↔ package/lib/client.js 双源一致性
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
