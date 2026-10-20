// verify-t3-locale.ts — dsh-waystation v25 T3 双语字典一致性验证（ticket #366）
// 2026-10-17 从 .js 转成 TypeScript：只改文件名、用法这行与几处类型标注，判据与断言一条没动。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-t3-locale.ts [file...]（默认 client.js + package/lib/client.js）
// 验证：
//   1) zh/en 字典键完全一致（双语平衡）
//   2) 所有 tr('...') 调用键都存在（无悬空键；以 '.' 结尾的键为动态前缀，校验前缀存在）
const fs = require('fs')
const files = process.argv.slice(2)
const targets = files.length ? files : ['client.js', 'package/lib/client.js']
let failed = false
const check = function (file: string) {
  const src = fs.readFileSync(file, 'utf8')
  // #1294：界面词表的真源搬到 config/copy/*.yaml，生成物 locale-data.ts 拼进产物后，每族常量写作
  // `const L_<族> = Object.freeze({ ... })`（旧产物是「const L_PANEL = { ... }」，两种形态都认，
  // 这样本门禁在迁移前后都能跑）。合并器 `const L = LOCALE_COPY` 不再带词条，所以字典区必须从首族
  // 常量切到合并常量之前——那一段才是十份族常量的完整 zh/en 词条。首族不一定是 panel（生成物按族名
  // 排序，cards 在最前），所以这里按 `const L_<大写族名> =` 找第一个，不能写死 L_PANEL。
  const frozenStart = src.search(/const L_[A-Z0-9]+ = Object\.freeze\(\{/)
  const plainStart = src.search(/const L_[A-Z0-9]+ = \{/)
  const dictStart = frozenStart >= 0 ? frozenStart : (plainStart >= 0 ? plainStart : src.indexOf('const L = {'))
  if (dictStart < 0) { console.log('  FAIL', file, '无 L 字典'); failed = true; return }
  const mergeStart = src.indexOf('const LOCALE_COPY', dictStart)
  const svcStart = src.indexOf('const localeSvc = ctx.get', dictStart)
  const dictEnd = mergeStart >= 0 ? mergeStart : (svcStart >= 0 ? svcStart : src.length)
  const dictBlock = src.slice(dictStart, dictEnd)
  // 2026-10-17 修：产物里的键与引用都被 esbuild 改成了双引号（源码写单引号），
  // 原来的正则只认单引号，于是 zh/en 两个集合都是空的，整扇门禁在主干上假红。
  // 这里同时接受单引号与双引号两种写法，键与引用各一处。
  const keyRe = /["']([a-zA-Z0-9.]+)["']:/g
  // #1294：语言段的开头现在可能是 `zh: {`（旧）或 `"zh": {` / `'zh': {`（生成物转译后），三種都认。
  const isLangSectionLine = function (line: string, lang: string): boolean {
    const t = line.trim()
    return t === lang + ': {' || t === '"' + lang + '": {' || t === '\'' + lang + '\': {'
  }
  const zh = new Set<string>(); const en = new Set<string>()
  let inEn = false
  for (const line of dictBlock.split('\n')) {
    if (isLangSectionLine(line, 'zh')) { inEn = false; continue }
    if (isLangSectionLine(line, 'en')) { inEn = true; continue }
    let m: RegExpExecArray | null
    keyRe.lastIndex = 0
    while ((m = keyRe.exec(line)) !== null) { (inEn ? en : zh).add(m[1]) }
  }
  const useRe = /\btr\(["']([a-zA-Z0-9.]*)(?:["']|\+)/g
  const used = new Set()
  let m: RegExpExecArray | null
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
  // #1254：panelAssembly 转 .ts 后拼进产物要过转译，单引号统一成双引号——数注册数只认引号就够了，两种都认（同本文件 17-19 行键与引用的做法）。
  const nOnce = (src.match(/__injectOnce\s*\(['"]/g) || []).length
  const nRaw = (src.match(/slots\.inject\(['"]/g) || []).length
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
