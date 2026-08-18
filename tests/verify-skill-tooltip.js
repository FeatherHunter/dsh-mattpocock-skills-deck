// verify-skill-tooltip.js — 技能浮层契约（issue #3 + 第一性原理文案评审）
// 用法: node tests/verify-skill-tooltip.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) tooltip portal 到 document.body（RDOM.createPortal → portalTop 包装）
//      —— z-index 抬到 2147483000，脱离宿主输入区祖先的堆叠上下文 / 裁剪
//   2) 翻转阈值 238 与实宽（maxWidth 220 + padding 16 + border 2）对齐，不再用旧 240
//   3) 技能列表悬停开/移出关（对齐 BUG 段 hover menu）：外层 wrapper 含 onMouseEnter/MouseLeave
//      两态同步清 skillHover/skillTip；点击语义保留
//   4) 死区回归：按钮与列表的 4px 间隙用 paddingTop 桥接（仍在 span 后代集内），不用 marginBottom
//      —— 与 verify-bug-entry.js 的 BUG 菜单契约口径一致，防止 mouseleave 误关
//   5) 兜底：取不到 react-dom 时退化为原地渲染（不劣于现状）
//   6) 双源一致：以上特征在 client.js + package/lib/client.js 同步
//   7) skilldesc 文案评审（第一性原理）：
//      —— 20 条 skill 全部命中 zh + en 两块字典，键集合相等
//      —— 旧版「自指 / jargon-only / 元评论」关键词不得出现
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
// 第一性原理：hover 浮层需告知"触发 / 动作 / 产物"，否则用户读完不知道该不该点。
// 旧版的「自指」「jargon-only」「元评论」黑名单（出现即视为评审不通过）。
const ZH_BAD = ['设计树', '深模块设计词汇', 'task 型 ticket', '本插件服务的对象', '领域术语与统一语言', '巨型项目决策地图', '对齐提问', '硬 bug 与性能回归诊断循环', '红-绿-重构', '讨论固化成规格', '写出优秀技能']
const EN_BAD = ['design tree', 'Deep module design vocabulary', 'task tickets', 'what this plugin serves', 'Domain terms & ubiquitous language', 'Decision maps for large projects', 'alignment questioning', 'Diagnosis loop for hard bugs & performance regressions', 'Red-green-refactor', 'Turn discussions into specs', 'Write great skills']
// 20 个 skill 名（必须全有 zh + en）
const SKILL_NAMES = ['ask-matt', 'setup-matt-pocock-skills', 'wayfinder', 'triage', 'grilling', 'domain-modeling', 'research', 'prototype', 'implement', 'code-review', 'codebase-design', 'diagnosing-bugs', 'improve-codebase-architecture', 'tdd', 'handoff', 'teach', 'to-spec', 'to-tickets', 'resolving-merge-conflicts', 'writing-great-skills']
const extractSkilldescBlock = function (src, lang) {
  // 匹配 zh/en 块内 'skilldesc.<name>': '...' 的全部条目
  const re = new RegExp("'skilldesc\\.([a-z\\-]+)':\\s*'([^']*)'", 'g')
  const out = {}
  let m
  while ((m = re.exec(src)) !== null) out[m[1]] = m[2]
  return out
}
const check = function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const problems = []
  // 1) portal 接线
  if (!/RDOM\s*=\s*\(function/.test(src)) problems.push('缺 RDOM 解析 IIFE（取 react-dom 三路回退）')
  if (!/RDOM\.createPortal/.test(src)) problems.push('缺 RDOM.createPortal 调用')
  if (!/portalTop\s*=\s*function/.test(src)) problems.push('缺 portalTop 包装函数')
  const portalUse = src.match(/portalTop\(h\('div', \{ style: \{ position: 'fixed'/)
  if (!portalUse) problems.push('tooltip 渲染未走 portalTop 包装（position:fixed 仍困在状态栏子树）')
  // 1.5) z-index 抬到最高档
  if (!/zIndex:\s*2147483000/.test(src)) problems.push('tooltip zIndex 未抬到 2147483000（候选根因 2：堆叠上下文被压层）')
  // 1.6) 兜底：取不到 RDOM 时退化为原地渲染
  if (!/if \(RDOM && typeof document/.test(src)) problems.push('portalTop 缺 RDOM/document 兜底（极端环境会抛错）')
  // 2) 翻转阈值 238
  if (/tip\.x \+ 240 > window\.innerWidth/.test(src)) problems.push('旧翻转阈值 240 仍在（与 maxWidth 220 贴边）')
  if (!/tip\.x \+ 238 > window\.innerWidth/.test(src)) problems.push('缺新翻转阈值 238（maxWidth 220 + padding 16 + border 2）')
  // 3) 列表悬停开/移出关
  if (!/s\.skillsOpen\s*=\s*true[\s\S]{0,200}?emit\(s\)/.test(src)) problems.push('缺列表 onMouseEnter 置 skillsOpen=true')
  if (!/s\.skillsOpen\s*=\s*false[\s\S]{0,400}?s\.skillHover\s*=\s*null[\s\S]{0,200}?s\.skillTip\s*=\s*null[\s\S]{0,200}?emit\(s\)/.test(src)) problems.push('缺列表 onMouseLeave 同时关 skillsOpen + 清 skillHover/skillTip')
  // 4) 死区：4px 间隙走 paddingTop
  const popMatch = src.match(/s\.skillsOpen \? h\('div', \{ style: \{ position: 'absolute'[\s\S]*?paddingBottom: 4[\s\S]*?\}, \[/)
  if (!popMatch) problems.push('缺技能列表弹层（外层 wrapper · style.position=absolute 且 paddingBottom=4）')
  else {
    const inner = popMatch[0]
    if (/marginBottom:\s*[1-9]/.test(inner)) problems.push('技能列表弹层仍带 marginBottom（光标死区，mouseleave 会误关）')
    if (!/paddingTop:\s*4/.test(inner)) problems.push('技能列表弹层缺 paddingTop:4 桥接（必须替换原 marginBottom 防误关）')
  }
  // 5) 工具调用次数：portalTop 在源里 ≥ 1 处
  const portalCalls = (src.match(/portalTop\(/g) || []).length
  if (portalCalls < 1) problems.push('portalTop 调用 < 1（实际 ' + portalCalls + '）')
  // 7) skilldesc 文案评审
  // 7.1) zh / en 各有 20 个键，键集合相等
  const zhAll = extractSkilldescBlock(src, 'zh')
  const enAll = extractSkilldescBlock(src, 'en')
  const zhKeys = Object.keys(zhAll).sort()
  const enKeys = Object.keys(enAll).sort()
  const expected = SKILL_NAMES.slice().sort()
  if (zhKeys.join(',') !== expected.join(',')) problems.push('zh skilldesc 键集合不全：缺 ' + expected.filter(function (k) { return !zhAll[k] }).join('/') + '，多 ' + zhKeys.filter(function (k) { return expected.indexOf(k) < 0 }).join('/'))
  if (enKeys.join(',') !== expected.join(',')) problems.push('en skilldesc 键集合不全：缺 ' + expected.filter(function (k) { return !enAll[k] }).join('/') + '，多 ' + enKeys.filter(function (k) { return expected.indexOf(k) < 0 }).join('/'))
  if (zhKeys.join(',') !== enKeys.join(',')) problems.push('zh / en skilldesc 键集合不等')
  // 7.2) 黑名单关键词不得出现（旧版 jargon / 自指 / 元评论）
  ZH_BAD.forEach(function (bad) {
    const hit = Object.keys(zhAll).filter(function (k) { return zhAll[k].indexOf(bad) >= 0 })
    if (hit.length) problems.push('zh skilldesc 命中黑名单「' + bad + '」（' + hit.join('/') + '）—— 自指 / jargon-only / 元评论')
  })
  EN_BAD.forEach(function (bad) {
    const hit = Object.keys(enAll).filter(function (k) { return enAll[k].indexOf(bad) >= 0 })
    if (hit.length) problems.push('en skilldesc 命中黑名单「' + bad + '」（' + hit.join('/') + '）—— self-referential / jargon-only / meta-commentary')
  })
  // 7.3) 每条 skilldesc 至少 8 个非空字符（防止空字符串 / 单字符）
  SKILL_NAMES.forEach(function (k) {
    const zh = zhAll[k]
    const en = enAll[k]
    if (!zh || zh.length < 8) problems.push('zh skilldesc.' + k + ' 过短：' + JSON.stringify(zh))
    if (!en || en.length < 8) problems.push('en skilldesc.' + k + ' 过短：' + JSON.stringify(en))
  })
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '（portal ✓ · zIndex 2147483000 ✓ · 阈值 238 ✓ · hover 开/移出关 ✓ · paddingTop 桥接 ✓ · 20 键中英齐 ✓ · 文案黑名单 0 命中 ✓）')
}
console.log('P1: 技能浮层契约（issue #3）')
targets.forEach(check)
// P2: 双源一致性
console.log('P2: 双源一致性')
const srca = fs.readFileSync(targets[0], 'utf8')
const srcb = fs.readFileSync(targets[1], 'utf8')
let dualFail = false
const keys = ['const RDOM = (function ()', 'RDOM.createPortal', 'portalTop = function', "zIndex: 2147483000", 'tip.x + 238 > window.innerWidth', 's.skillsOpen = true', "paddingTop: 4"]
keys.forEach(function (k) {
  const a = srca.includes(k)
  const b = srcb.includes(k)
  if (a !== b) { console.log('  FAIL 双源不一致: ' + k); dualFail = true }
})
// 文案评审双源一致：12 条新文案的"指纹"必须两边都有
const newFingerprints = [
  '为多议题项目建决策地图与子票拆解', 'Build decision maps + sub-ticket breakdowns for big projects',
  'issue 分流：归类→验证→追问', 'Route issues: classify → verify → grill',
  '在你拍板前反复追问澄清', 'Relentlessly question you until the design is locked down',
  '让代码 / 文档 / 对话用同一套词', 'so code, docs and chat use one language',
  '把规格文档拆成代码任务', 'Break a spec into code tasks',
  '按仓库规范 + 原规格', 'on both repo standards and the originating spec',
  '为代码找清晰的模块边界', 'Find clean module boundaries',
  '定位→假设→验证，循环往复', 'locate → hypothesize → verify, loop',
  '扫出代码库的深化机会', 'Scan the codebase for deepening opportunities',
  '测试驱动开发：先写失败测试', 'failing test first, then minimal implementation',
  '把零散讨论固化成可执行的规格文档', 'Turn scattered discussions into an executable spec',
  '为 AI 写出可复用、可测试的技能描述', 'Write reusable, testable skill descriptions for AI',
]
newFingerprints.forEach(function (fp) {
  const a = srca.includes(fp)
  const b = srcb.includes(fp)
  if (a !== b) { console.log('  FAIL 双源不一致（文案）: ' + fp); dualFail = true }
})
if (!dualFail) console.log('  PASS 双源接线一致（含 12 条新文案指纹）')
else failed = true
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')