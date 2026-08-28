// verify-t3-locale.js — dsh-waystation v25 T3 双语字典一致性验证（ticket #366）
// 用法: node tests/verify-t3-locale.js [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) zh/en 字典键完全一致（双语平衡）
//   2) 所有 tr('...') 调用键都存在（无悬空键；以 '.' 结尾的键为动态前缀，校验前缀存在）
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
const check = function (file) {
  const src = fs.readFileSync(file, 'utf8')
  const dictStart = src.indexOf('const L = {')
  if (dictStart < 0) { console.log('  FAIL', file, '无 L 字典'); failed = true; return }
  const dictEnd = src.indexOf('const localeSvc = ctx.get', dictStart)
  const dictBlock = src.slice(dictStart, dictEnd)
  const keyRe = /'([a-zA-Z0-9.]+)':/g
  const zh = new Set(); const en = new Set()
  let inEn = false
  for (const line of dictBlock.split('\n')) {
    if (line.includes('zh: {')) { inEn = false; continue }
    if (line.includes('en: {')) { inEn = true; continue }
    let m
    keyRe.lastIndex = 0
    while ((m = keyRe.exec(line)) !== null) { (inEn ? en : zh).add(m[1]) }
  }
  const useRe = /\btr\('([a-zA-Z0-9.]*)(?:'|\+)/g
  const used = new Set()
  let m
  while ((m = useRe.exec(src)) !== null) used.add(m[1])
  const problems = []
  if (zh.size !== en.size) problems.push('zh/en 数量不一致 ' + zh.size + ' vs ' + en.size)
  ;[...zh].forEach(function (k) { if (!en.has(k)) problems.push('zh 独有键 ' + k) })
  ;[...en].forEach(function (k) { if (!zh.has(k)) problems.push('en 独有键 ' + k) })
  ;[...used].forEach(function (k) {
    if (k.endsWith('.')) {
      const prefix = k
      const ok = [...zh].some(function (key) { return key.startsWith(prefix) })
      if (!ok) problems.push('动态前缀无键 ' + prefix)
    } else if (!zh.has(k) || !en.has(k)) problems.push('引用缺失 ' + k)
  })
  // 完整性：历史改名连带误伤防护（t('→tr(' 全局替换曾误伤 tplText( → tplTextr(、slots.inject( → slots.injectr(）
  ;['tplTextr(', 'injectr(', 'getr(', 'setHeightr(', 'Heig\u0072('].forEach(function (bad) {
    if (src.includes(bad)) problems.push('改名误伤残留 ' + bad)
  })
  // T0（#93）一源出两物后：pkg 由规范源（动态版）构建，tool.view.cordis 不再缺失 —— 两产物注册数一致。
  // v26 移除 sidebar.footer.action 后：shell.overlay / conversation.input.dock / tool.view.cordis / settings.plugins.tab / details = 5；v1.5 T2 新增 settings.section = 6。
  // #298 幂等：6 槽位经 __injectOnce 注入，底层 slots.inject 仅剩 helper 内 1 处（变量式调用，不计入字面量 ' 统计）；此处校验幂等注册数
  const nOnce = (src.match(/__injectOnce\s*\('/g) || []).length
  const nRaw = (src.match(/slots\.inject\('/g) || []).length
  const expectInject = 6
  if (nOnce !== expectInject) problems.push('__injectOnce 注册数异常 ' + nOnce + '（期望 ' + expectInject + '）')
  if (nRaw !== 0) problems.push('slots.inject\' 裸露数异常 ' + nRaw + '（期望 0，#298 后应经 __injectOnce）')
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '(' + zh.size + ' 键 × zh/en，' + used.size + ' 处引用)')
}
console.log('T3: 双语字典一致性')
targets.forEach(check)
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
