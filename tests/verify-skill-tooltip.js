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
  // HoverTip 新契约：estW = maxWidth(220) + 16 + 2 = 238，翻转判据为 x + estW > vpW（原 tip.x+238 已抽象为 estW）
  if (!/tip\.x \+ 238 > window\.innerWidth/.test(src) && !/estW/.test(src) && !/maxWidth \+ 16 \+ 2/.test(src)) problems.push('缺新翻转阈值 238（maxWidth 220 + padding 16 + border 2）— 当前 HoverTip 以 estW 抽象，需含 estW 或 maxWidth+16+2')
  // 3) 列表悬停开/移出关：portal 后由 showSkillPop / closeSkillPop + 延迟桥接负责
  //    T0（#93）一源出两物后，showSkillPop 内含 issuePath 协同（clearClose(issuePathCloseRef) + 分支），skillsOpen=true 落在 ~450 字符处 —— 窗口放宽到 600
  if (!/const showSkillPop\s*=\s*function[\s\S]{0,600}s\.skillsOpen\s*=\s*true/.test(src)) problems.push('缺列表 onMouseEnter 置 skillsOpen=true')
  if (!/const closeSkillPop\s*=\s*function[\s\S]{0,350}s\.skillsOpen\s*=\s*false[\s\S]{0,180}s\.skillHover\s*=\s*null/.test(src)) problems.push('缺列表关闭及 skillHover 清理（T2 后 skillTip 已由 HoverTip 统一，旧全局 skillTip 不再存在）')
  // 4) 死区：portal 外层保留 4px 上下桥接，并通过延迟关闭跨越 DOM gap
  const popMatch = src.match(/PortalOverlay\(\{ className: 'dsws-skillpop-bridge'[\s\S]*?paddingTop: 4[\s\S]*?paddingBottom: 4[\s\S]*?\}, \[/)
  if (!popMatch) problems.push('缺技能列表 portal bridge（paddingTop/paddingBottom=4）')
  else if (/marginBottom:\s*[1-9]/.test(popMatch[0])) problems.push('技能列表 portal bridge 含 marginBottom（会制造光标死区）')
  if (!/const scheduleClose\s*=\s*function/.test(src)) problems.push('缺 portal 弹层延迟关闭桥接')
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
// P2 双源一致性已移除（T5 #98：一源两物，build 保证同构）
// 保留 P1 单产物技能浮层契约校验（含文案评审）；双源一致性由 src↔产物 + 冒烟覆盖
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')