// verify-prompts.js — dsh-waystation v1.5 方案 A：prompt 注册表契约校验（T13 扩展 · #461）
// 用法: node tests/verify-prompts.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) 注册表条目结构（version/placeholders/use/zh/en 齐全）
//   2) 文本内 {x} 占位符 与 placeholders 声明一致（未知占位符 = 违规）
//   3) 代码中 promptText('id') 引用全部存在
//   4) 双源注册表键集合一致
//   5) T13 阶段闸门契约：stageGate 条目 + 版本号 bump（tpl.diagnose/execute/mapExecute）
//      + 诊断/修复/执行（renderTemplate 末尾追加）与 map 推进接线
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
const unescapeStr = function (s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) { out += s[i + 1] === 'n' ? '\n' : s[i + 1]; i++ }
    else out += c
  }
  return out
}
const parseRegistry = function (src) {
  const reg = {}
  const entryRe = /^\s*"([a-zA-Z0-9.]+)": \{ version: (\d+), placeholders: \[([^\]]*)\], use: '([^']*)', zh: '([^']*)', en: '([^']*)' \},?$/gm
  let m
  while ((m = entryRe.exec(src)) !== null) {
    const ph = m[3] ? m[3].split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean) : []
    reg[m[1]] = { version: Number(m[2]), placeholders: ph, use: m[4], zh: unescapeStr(m[5]), en: unescapeStr(m[6]) }
  }
  return reg
}
const check = function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const reg = parseRegistry(src)
  const problems = []
  if (Object.keys(reg).length < 20) problems.push('注册表条目数异常 ' + Object.keys(reg).length + '（期望 20）')
  Object.keys(reg).forEach(function (id) {
    const p = reg[id]
    if (!(p.version >= 1)) problems.push(id + ' 缺 version')
    if (!p.zh || !p.en) problems.push(id + ' 缺 zh/en')
    if (!p.use) problems.push(id + ' 缺 use')
    const found = []
    const re = /\{(\w+)\}/g
    let mm
    while ((mm = re.exec(p.zh)) !== null) if (found.indexOf(mm[1]) < 0) found.push(mm[1])
    found.forEach(function (x) { if (p.placeholders.indexOf(x) < 0) problems.push(id + ' 文本含未声明占位符 {' + x + '}') })
    p.placeholders.forEach(function (x) { if (found.indexOf(x) < 0) problems.push(id + ' 声明占位符 {' + x + '} 但文本未使用') })
  })
  const useRe = /promptText\('([a-zA-Z0-9.]+)'/g
  let mu
  while ((mu = useRe.exec(src)) !== null) { if (!reg[mu[1]]) problems.push('引用不存在的 prompt id: ' + mu[1]) }
  // 旧形式残留
  ;["tr('prompt.", "'prompt.\'" ].forEach(function (bad) { if (src.includes(bad)) problems.push('旧字典引用残留 ' + bad) })
  // T13：版本号 bump —— 契约变更的条目必须升版（防回退），stageGate 必须存在（#65 diagnose 自带闸门，不再依赖尾部追加但保留 STAGE_GATED_IDS 声明）
  const V_MIN = { 'tpl.diagnose': 4, 'tpl.execute': 5, 'mapExecute': 5, 'stageGate': 2, 'complete': 4 }
  Object.keys(V_MIN).forEach(function (id) {
    const p = reg[id]
    if (!p) problems.push('T13 缺条目 ' + id)
    else if (p.version < V_MIN[id]) problems.push('T13 版本号未 bump ' + id + ' v' + p.version + '（期望 ≥ v' + V_MIN[id] + '）')
  })
  // T13：stageGate 文案关键标记（AI 行为契约：核验现状 / 维持95%摘标签 / 未动工走正常诊断）
  const g = reg['stageGate']
  if (g) {
    if (g.placeholders.length !== 0) problems.push('stageGate 不应有占位符')
    if (g.zh.indexOf('needs-triage') < 0 || g.zh.indexOf('95%') < 0 || g.zh.indexOf('未动工') < 0) problems.push('stageGate zh 缺关键标记（needs-triage / 95% / 未动工）')
    if (g.en.indexOf('needs-triage') < 0) problems.push('stageGate en 缺关键标记（needs-triage）')
  }
  // T13：接线 —— renderTemplate 对 诊断/修复/执行 条件追加 stageGate（#65 已改为：文本已含 阶段闸门/Stage gate 则跳过，避免与模板内清单式闸门重复；各 prompt 自带完整闸门/格式）
  const gatedMatch = src.match(/STAGE_GATED_IDS\s*=\s*\[([^\]]*)\]/)
  if (!gatedMatch) problems.push('T13 缺 STAGE_GATED_IDS 声明')
  else {
    const gated = gatedMatch[1].split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean)
    ;['diagnose', 'fix', 'execute'].forEach(function (id) { if (gated.indexOf(id) < 0) problems.push('STAGE_GATED_IDS 缺 ' + id) })
  }
  if (!src.includes("promptText('stageGate')")) problems.push("T13 缺 promptText('stageGate') 调用")
  if (!src.includes('STAGE_GATED_IDS.indexOf(id) >= 0')) problems.push('T13 renderTemplate 未按 STAGE_GATED_IDS 追加闸门')
  if (!src.includes("text.indexOf('阶段闸门')") || !src.includes("text.indexOf('Stage gate')")) problems.push('T13 renderTemplate 缺去重守卫（已含 阶段闸门/Stage gate 则跳过追加）')
  // T13：map 推进（mapExecute 新会话）同样挂闸门 —— v5（#68）：闸门一句引用内嵌于模板，外挂 gateText 已删；
  //   校验 mapExecute 文本含「阶段闸门」引用 + router 单行前缀（/wayfinder + 空格 + url）
  const me = reg['mapExecute']
  if (me) {
    if (me.zh.indexOf('阶段闸门') < 0 || me.en.indexOf('stage-gate') < 0) problems.push('T13 mapExecute 未含阶段闸门引用（needs-triage 先诊断）')
    if (me.zh.indexOf('needs-triage') < 0) problems.push('mapExecute zh 缺 needs-triage 标记')
  }
  if (src.indexOf("'/wayfinder '") < 0) problems.push('T13 map 推进缺单行前缀（/wayfinder + 空格 + url）')
  // #68 mapExecute 清单式（A★ · 全勾选框 · 无表格 · map 标识头自包含）：mapExecute 必须为清单骨架
  if (me) {
    if (me.zh.indexOf('- [ ]') < 0) problems.push('mapExecute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (me.zh.indexOf('## 目标 map') < 0 || me.zh.indexOf('## 分析') < 0 || me.zh.indexOf('## 选票') < 0 || me.zh.indexOf('## 执行') < 0 || me.zh.indexOf('## 收尾') < 0 || me.zh.indexOf('## 正文格式') < 0) problems.push('mapExecute zh 缺清单段标题（目标 map/分析/选票/执行/收尾/正文格式）')
    if (me.zh.indexOf('|') >= 0) problems.push('mapExecute zh 含表格 |（已约定无表格，全勾选框）')
    if (me.zh.indexOf('编号：') < 0 || me.zh.indexOf('标题：') < 0 || me.zh.indexOf('链接：') < 0) problems.push('mapExecute zh 缺 map 标识头三字段（编号/标题/链接）')
    if (me.placeholders.indexOf('n') < 0 || me.placeholders.indexOf('title') < 0 || me.placeholders.indexOf('url') < 0) problems.push('mapExecute 占位符缺 n/title/url（自包含 map 标识）')
    if (me.en.indexOf('- [ ]') < 0) problems.push('mapExecute en 缺清单标记 - [ ]')
    if (me.en.indexOf('## Target map') < 0 || me.en.indexOf('## Analyze') < 0 || me.en.indexOf('## Pick the ticket') < 0 || me.en.indexOf('## Execute') < 0 || me.en.indexOf('## Wrap-up') < 0) problems.push('mapExecute en 缺清单段标题（Target map/Analyze/Pick the ticket/Execute/Wrap-up）')
  }
  // #64 执行清单式（A★ · 全勾选框 · 无表格）：tpl.execute 必须为清单骨架
  const ex = reg['tpl.execute']
  if (ex) {
    if (ex.zh.indexOf('- [ ]') < 0) problems.push('tpl.execute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (ex.zh.indexOf('## 读现状') < 0 || ex.zh.indexOf('## 阶段闸门') < 0 || ex.zh.indexOf('## 收尾') < 0 || ex.zh.indexOf('## 正文格式') < 0) problems.push('tpl.execute zh 缺清单四段标题（读现状/阶段闸门/收尾/正文格式）')
    if (ex.zh.indexOf('|') >= 0) problems.push('tpl.execute zh 含表格 |（已约定无表格，全勾选框）')
    if (ex.en.indexOf('- [ ]') < 0) problems.push('tpl.execute en 缺清单标记 - [ ]')
  }
  // #65 诊断清单式（A★ · 全勾选框 · 无表格 · 诊断≠修复）：tpl.diagnose 必须为清单骨架
  const di = reg['tpl.diagnose']
  if (di) {
    if (di.zh.indexOf('- [ ]') < 0) problems.push('tpl.diagnose zh 缺清单标记 - [ ]（A★ 清单式）')
    if (di.zh.indexOf('## 弄清现象') < 0 || di.zh.indexOf('## 根因候选') < 0 || di.zh.indexOf('## 分流建议') < 0 || di.zh.indexOf('## 阶段闸门') < 0 || di.zh.indexOf('## 正文格式') < 0) problems.push('tpl.diagnose zh 缺清单段标题（弄清现象/根因候选/分流建议/阶段闸门/正文格式）')
    if (di.zh.indexOf('|') >= 0) problems.push('tpl.diagnose zh 含表格 |（已约定无表格，全勾选框）')
    if (di.zh.indexOf('诊断≠修复') < 0) problems.push('tpl.diagnose zh 缺诊断≠修复显式（第一性原理）')
    if (di.zh.indexOf('grilling') < 0) problems.push('tpl.diagnose zh 缺 grill 澄清句')
    if (di.en.indexOf('- [ ]') < 0) problems.push('tpl.diagnose en 缺清单标记 - [ ]')
    if (di.en.indexOf('diagnosis') < 0 || di.en.indexOf('Stage gate') < 0) problems.push('tpl.diagnose en 缺关键段（diagnosis/Stage gate）')
    if (di.en.indexOf('What are the symptoms') < 0 || di.en.indexOf('What is the impact') < 0) problems.push('tpl.diagnose en 缺 Symptoms 三行拆分（What are the symptoms / What is the impact）')
  }
  // #69 完成调查清单式（A★ · 全勾选框 · 无表格 · 调查器 · 人来定夺）：complete 必须为清单骨架 + 专业术语英文
  const co = reg['complete']
  if (co) {
    if (co.version < 4) problems.push('complete 版本号未 bump（期望 ≥ v4）')
    if (co.zh.indexOf('- [ ]') < 0) problems.push('complete zh 缺清单标记 - [ ]（A★ 清单式）')
    if (co.zh.indexOf('## MAP完成确认') < 0 || co.zh.indexOf('## 调查') < 0 || co.zh.indexOf('## 报告你来定夺') < 0 || co.zh.indexOf('## 收尾') < 0 || co.zh.indexOf('## 正文格式') < 0) problems.push('complete zh 缺清单段标题（MAP完成确认/调查/报告你来定夺/收尾/正文格式）')
    if (co.zh.indexOf('|') >= 0) problems.push('complete zh 含表格 |（已约定无表格，全勾选框）')
    if (co.zh.indexOf('子票') >= 0 || co.zh.indexOf('票') >= 0) problems.push('complete zh 专业术语未用英文（子票/票 → sub-issue/ticket）')
    if (co.placeholders.indexOf('closed') < 0 || co.placeholders.indexOf('total') < 0) problems.push('complete 占位符缺 closed/total')
    if (co.en.indexOf('- [ ]') < 0) problems.push('complete en 缺清单标记 - [ ]')
    if (co.en.indexOf('## MAP completion check') < 0 || co.en.indexOf('## Investigate') < 0 || co.en.indexOf('## Report to you') < 0 || co.en.indexOf('## Wrap-up') < 0) problems.push('complete en 缺清单段标题（MAP completion check/Investigate/Report to you/Wrap-up）')
  } else {
    problems.push('缺条目 complete')
  }
  // #71 交接第一击短标题文件名 + 第二击绝对路径（A★ · 全勾选框 · 无表格 · 单模板 · 去 /read 命令化）：handoff1 v3 短标题；handoff2 v3 用 {path}；handoffRead 已塌缩删除
  const h1 = reg['tpl.handoff1']
  if (h1) {
    if (h1.version < 3) problems.push('tpl.handoff1 版本号未 bump（期望 ≥ v3）')
    if (h1.zh.indexOf('短标题') < 0) problems.push('tpl.handoff1 zh 缺短标题指令（{ts}-<短标题>.md）')
    if (h1.en.indexOf('<short>') < 0) problems.push('tpl.handoff1 en 缺短标题指令（{ts}-<short>.md）')
  } else {
    problems.push('缺条目 tpl.handoff1')
  }
  const h2 = reg['tpl.handoff2']
  if (h2) {
    if (h2.version < 3) problems.push('tpl.handoff2 版本号未 bump（期望 ≥ v3）')
    if (h2.zh.indexOf('- [ ]') < 0) problems.push('tpl.handoff2 zh 缺清单标记 - [ ]（A★ 清单式）')
    if (h2.zh.indexOf('## 复述理解') < 0 || h2.zh.indexOf('## 继续推进') < 0) problems.push('tpl.handoff2 zh 缺清单段标题（复述理解/继续推进）')
    if (h2.zh.indexOf('|') >= 0) problems.push('tpl.handoff2 zh 含表格 |（已约定无表格，全勾选框）')
    if (h2.zh.indexOf('/read') >= 0) problems.push('tpl.handoff2 zh 仍含 /read 命令（DSH 无此命令，需通用语句）')
    if (h2.zh.indexOf('{path}') < 0) problems.push('tpl.handoff2 zh 未用 {path} 绝对路径占位符')
    if (h2.en.indexOf('- [ ]') < 0) problems.push('tpl.handoff2 en 缺清单标记 - [ ]')
    if (h2.en.indexOf('{path}') < 0) problems.push('tpl.handoff2 en 未用 {path} 绝对路径占位符')
  } else {
    problems.push('缺条目 tpl.handoff2')
  }
  if (reg['handoffRead']) problems.push('handoffRead 未塌缩删除（应只剩 tpl.handoff2 单模板）')
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '(' + Object.keys(reg).length + ' 条注册表，' + (src.match(/promptText\(/g) || []).length + ' 处引用)')
}
console.log('P1: prompt 注册表契约')
targets.forEach(check)
// 双源键一致性已移除（T5 #98：一源两物，build 保证同构）
// 保留单产物注册表校验（P1）；P2 双源接线一致性由 src↔产物 + 冒烟覆盖
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
