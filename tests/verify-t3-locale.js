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
  // v26：移除 sidebar.footer.action 入口按钮（打开形式收敛为仅右侧 details 列）后：
  //   动态版注册 5 个插槽（shell.overlay / conversation.input.dock / tool.view.cordis / settings.plugins.tab / details）
  //   静态 bundle 4 个（同上去掉 tool.view.cordis，disposeSlots 形态）
  const n = (src.match(/slots\.inject\('/g) || []).length
  // v1.4.1：better-sidebar tab 改走 ensureSidebarTab 直接注册（非 slots.inject）→ 静态 bundle 4 个（动态版 5 个：多 tool.view.cordis）
  // v1.5 T2：新增 settings.section 注册 → 动态版 6 个（+settings.section），静态 bundle 5 个
  const expectInject = file.indexOf('package/') >= 0 ? 5 : 6
  if (n !== expectInject) problems.push('slots.inject 注册数异常 ' + n + '（期望 ' + expectInject + '）')
  if (problems.length) { console.log('  FAIL', file, problems.join('；')); failed = true }
  else console.log('  PASS', file, '(' + zh.size + ' 键 × zh/en，' + used.size + ' 处引用)')
}
console.log('T3: 双语字典一致性')
targets.forEach(check)
if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
