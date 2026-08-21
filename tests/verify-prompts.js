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
  // T13：版本号 bump —— 契约变更的条目必须升版（防回退），stageGate 必须存在
  const V_MIN = { 'tpl.diagnose': 3, 'tpl.execute': 5, 'mapExecute': 4, 'stageGate': 2 }
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
  // T13：接线 —— renderTemplate 对 诊断/修复/执行 末尾追加 stageGate
  const gatedMatch = src.match(/STAGE_GATED_IDS\s*=\s*\[([^\]]*)\]/)
  if (!gatedMatch) problems.push('T13 缺 STAGE_GATED_IDS 声明')
  else {
    const gated = gatedMatch[1].split(',').map(function (x) { return x.trim().replace(/'/g, '') }).filter(Boolean)
    ;['diagnose', 'fix', 'execute'].forEach(function (id) { if (gated.indexOf(id) < 0) problems.push('STAGE_GATED_IDS 缺 ' + id) })
  }
  if (!src.includes("promptText('stageGate')")) problems.push("T13 缺 promptText('stageGate') 调用")
  if (!src.includes('STAGE_GATED_IDS.indexOf(id) >= 0')) problems.push('T13 renderTemplate 未按 STAGE_GATED_IDS 追加闸门')
  // T13：map 推进（mapExecute 新会话）同样挂闸门
  if (!src.includes('MAP_EXECUTE_PROMPT') || !src.includes('gateText')) problems.push('T13 map 推进未挂 stageGate（缺 gateText）')
  // #64 执行清单式（A★ · 全勾选框 · 无表格）：tpl.execute 必须为清单骨架
  const ex = reg['tpl.execute']
  if (ex) {
    if (ex.zh.indexOf('- [ ]') < 0) problems.push('tpl.execute zh 缺清单标记 - [ ]（A★ 清单式）')
    if (ex.zh.indexOf('## 读现状') < 0 || ex.zh.indexOf('## 阶段闸门') < 0 || ex.zh.indexOf('## 收尾') < 0 || ex.zh.indexOf('## 正文格式') < 0) problems.push('tpl.execute zh 缺清单四段标题（读现状/阶段闸门/收尾/正文格式）')
    if (ex.zh.indexOf('|') >= 0) problems.push('tpl.execute zh 含表格 |（已约定无表格，全勾选框）')
    if (ex.en.indexOf('- [ ]') < 0) problems.push('tpl.execute en 缺清单标记 - [ ]')
  }
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '(' + Object.keys(reg).length + ' 条注册表，' + (src.match(/promptText\(/g) || []).length + ' 处引用)')
}
console.log('P1: prompt 注册表契约')
targets.forEach(check)
// 双源键一致性已移除（T5 #98：一源两物，build 保证同构）
// 保留单产物注册表校验（P1）；P2 双源接线一致性由 src↔产物 + 冒烟覆盖
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
