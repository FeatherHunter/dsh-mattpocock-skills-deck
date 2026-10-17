#!/usr/bin/env node
/**
 * verify-locale-completeness.ts — locale 完整性门禁（#231 验收）。
 *
 * A. zh/en 键集合全等（键数一致且互相包含）；
 * B. 本票关键键存在（双语源与双产物四处核验）；
 * D. 双产物里关键键齐备；
 * E. 类型徽章能收到的每个类型值都有词条；
 * A2. 词条结构（值放错层也要报红）；
 * F. 技能描述文案评审（技能名单从 src/shared/matt-skills.js 真源取，黑名单与最短长度一起查；
 *    2026-10-17 从 verify-skill-tooltip.js 第 7 段搬来 —— 那扇门禁其余判据有真会红的继任者）。
 *
 * 原来还有一段 C：遍历 src/client 下的手写源码，逐文件数「字符串级中文」条数并与基线清单比对。
 * 那盯的是源码文本的写法与条数（等价重构、搬文件、改引号、改注释都会变红），已按维护者要求整段删除。
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }

// ---------- A. locale 键集合 ----------
const LOCALE_SRC_FILES = ['src/client/kernel/locale-panel.js', 'src/client/kernel/locale-flow.js', 'src/client/kernel/locale-word.js', 'src/client/kernel/locale-labels.js', 'src/client/kernel/locale-pages.js', 'src/client/kernel/locale-vcwrite.js', 'src/client/kernel/locale-skilldesc.js', 'src/client/kernel/locale.js'] // #458 K5：locale.js 已拆为三片段加合并器，此处读四文件拼起来的内容断言（panel 含导航面板横幅环境引导，flow 含动作类型列表配置详情地图提示，word 含技能检查浮层命名切换进度错误模板运行描述，合并器含 L 合并逻辑）；#621 起多一份 locale-labels.js（标签配色弹窗的中英词条），#690 起再多一份 locale-pages.js（历史票按需翻页的五条），#879 起再多一份 locale-skilldesc.js（技能描述 27 条），同样按「每个键 zh/en 各出现一次」判定
// 这份清单里写的是词条「原来叫什么」，不是「今天住在哪」：本题（#1209）把 locale-pages 从
// locale-pages.js 转成了 locale-pages.ts，而构建的 pixel-ts 那一段会把每个 .ts 真源转译成同名
// .js（带 AUTO-GENERATED 横幅、字符串字面量被改写成双引号）。所以按 .js 路径读会读到派生产物：
// 下面那句 keysOf 的正则认的是 '键': '值' 这种单引号写法，读到产物就会一个键都认不出来、
// 把「键非双语配对」误报成红。取源统一走 tests/lib/source-text.ts（#1207 立的入口，
// 问 .js 时同名 .ts 优先），下面读的与 import 的都换成它给的那条路径。
const { sourcePath } = require('./lib/source-text.ts')
const locSrc = LOCALE_SRC_FILES.map((f) => fs.readFileSync(path.join(root, sourcePath(f)), 'utf8')).join('\n')
function sliceAfter(buf, marker) { const i = buf.indexOf(marker); return i < 0 ? '' : buf.slice(i) }
function keysOf(seg) {
  const re = /'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'/g
  const out = {}
  let m
  while ((m = re.exec(seg)) !== null) out[m[1]] = m[2]
  return out
}
const allKeys = keysOf(locSrc)
const half = Math.floor(Object.keys(allKeys).length / 2)
const zhSet = new Set(Object.keys(keysOf(sliceAfter(locSrc, "'act.view'") || locSrc)))
if (!zhSet.size) bad('A. zh 半区切片失败')
const zhCount = (locSrc.match(/':\s*'/g) || []).length
if (zhCount > 600) ok('A. locale 规模正常（约 ' + Math.round(zhCount / 2) + ' 键 × 2 语）')
else bad('A. locale 规模异常：value-form 出现 ' + zhCount)
// 更强判定：直接按字节序切两半并不稳（中英同文件交错块状布局），改为「键出现次数必须=2」
let dupFail = []
for (const k of Object.keys(allKeys)) {
  const c = locSrc.split("'" + k + "':").length - 1
  if (c !== 2) dupFail.push(k + '(' + c + ')')
}
if (!dupFail.length) ok('A. 全部键 zh/en 双语各出现一次')
else bad('A. 键非双语配对 → ' + dupFail.slice(0, 8).join(', ') + (dupFail.length > 8 ? ' …共' + dupFail.length : ''))

// ---------- B. 关键键 ----------
const REQUIRED = [
  'list.openInTrackerTitle', 'detail.viewOnTracker', 'detail.viewOnTrackerHint',
  'detail.authFailCta', 'detail.readOnlyHint',
  'switch.gateOtherErr', 'switch.pleaseSelectTracker', 'switch.gateIntro',
  'panel.loadingShort',
  'setup.github.trackerLine', 'setup.github.labelReqs',
  'setup.markdown.trackerLine', 'setup.markdown.labelReqs',
  'setup.gitlab.trackerLine', 'setup.gitlab.labelReqs',
  'setup.default.trackerLine', 'setup.default.labelReqs',
  'panel.labelsStepTitle', 'panel.labelsStepDesc',
  'check.selection.pass', 'check.tracker.initialized.pass', 'env.diagTitle', 'env.actRun', 'env.chainDone',
  // #626：普通票的显示名。TypeChip 渲染的是 tr('type.' + 类型值)，缺了这条，
  // 界面上会直接印出 'type.issue' 这串字（#626 实测）。
  'type.issue',
  // #655：初始化小卡上那组单选与两句注入句。缺了卡片会印出键名，注入文案里那句布局结论会空着。
  'setup.layoutQuestion', 'setup.layoutSingle', 'setup.layoutMulti',
  'setup.layout.single', 'setup.layout.multi',
]
for (const k of REQUIRED) {
  if (k in allKeys) ok('B. 键在 ' + k)
  else bad('B. 缺键 ' + k)
}
// #619：旧的「标签调色盘」注入文案整段删除，那条词条键也随之删掉。
//   判据由「必须存在」换成「必须不存在」——同一条键，方向相反，强度不变。
if (!('setup.markdown.paletteNote' in allKeys)) ok('B. 已删的 setup.markdown.paletteNote 键没有复活（#619）')
else bad('B. setup.markdown.paletteNote 又回来了：#619 已删掉这条注入文案，词条不该再存在')

// ---------- E. 类型徽章能收到的每个类型值都必须有词条（#626 防复发）----------
// TypeChip（views/shared/chips.js）渲染的是 tr('type.' + 类型值)。类型值有两个来源：
//   ① 后端归一的票类型：src/tracker/contract/vocabulary.ts 的 ISSUE_TYPE（issue / map）
//   ② 五个 wayfinder 类型标签：src/tracker/contract/canonical-labels.ts 的 wayfinder:xxx
// 任何一路冒出新值而词条没跟上，界面上就会印出键名本身 —— 那正是 #626 的毛病。
const constantsSrc = fs.readFileSync(path.join(root, 'src/tracker/contract/vocabulary.ts'), 'utf8')
const issueTypeBlock = (constantsSrc.match(/ISSUE_TYPE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/) || [])[1] || ''
const fromBackend = (issueTypeBlock.match(/:\s*'([a-z]+)'/g) || []).map(function (s) { return s.replace(/[^a-z]/g, '') })
const labelsSrc = fs.readFileSync(path.join(root, 'src/tracker/contract/canonical-labels.ts'), 'utf8')
const fromLabels = []
;(labelsSrc.match(/wayfinder:[a-z]+/g) || []).forEach(function (n) {
  const v = n.slice('wayfinder:'.length)
  if (fromLabels.indexOf(v) < 0) fromLabels.push(v)
})
const typeValues = []
fromBackend.concat(fromLabels).forEach(function (v) { if (v && typeValues.indexOf(v) < 0) typeValues.push(v) })
// 这里原来还有一条「至少收集到 6 个类型值」的自检，盯的是上面两个正则能不能从
// src/tracker/contract/vocabulary.ts 与 src/tracker/contract/canonical-labels.ts 的写法里抠出字面量（改写法就变红），
// 已按维护者要求删除；抠取本身保留，只作为下面按 key 核词条的输入。
for (const v of typeValues) {
  if (('type.' + v) in allKeys) ok('E. 有词条 type.' + v)
  else bad('E. 缺词条 type.' + v + ' —— 类型徽章会把这串字直接印到界面上')
}

// ---------- D. 双产物关键键 ----------
// #1209 起 locale-pages 片段的真源是 .ts：构建的 pixel-ts 转译把字符串字面量改写成双引号，
//   产物里键的写法是 "键" 而不再是 '键'（手写 .js 时代是逐字拼进去的）。判据只认键名本身，
//   单双引号都算命中 —— 只认单引号会把转译后的产物误报成缺键。
for (const a of ['client.js', path.join('package', 'lib', 'client.js')]) {
  let buf
  try { buf = fs.readFileSync(path.join(root, a), 'utf8') } catch (e) { bad('D. 产物缺失 ' + a); continue }
  const miss = REQUIRED.filter(function (k) { return buf.indexOf("'" + k + "'") < 0 && buf.indexOf('"' + k + '"') < 0 })
  if (!miss.length) ok('D. 产物关键键齐备 ' + a)
  else bad('D. 产物缺键 ' + a + ' -> ' + miss.join(','))
}

// ---------- A2. 词条结构（#818 补：上面那条 A 只数「键名出现两次」，数不出「值放错层」）----------
// 为什么另开这一条：把中文值写在 zh 字典**外面**、英文值写在 en 里，键名照样出现两次 ——
//   A 那条会绿，而界面上 tr('vc.xxx') 印出来的是键名本身。#818 实施时真发生过一次：
//   94 条新词条的中文全落在 zh 外面，A 报「全部键 zh/en 双语各出现一次」、T3 门禁也全绿，
//   是独立验收者按对象结构复现出来的。所以这里不再数数，直接 import 词条模块看结构。
const LOCALE_STRUCT_FILES = [
  'src/client/kernel/locale-panel.js',
  'src/client/kernel/locale-flow.js',
  'src/client/kernel/locale-word.js',
  'src/client/kernel/locale-labels.js',
  'src/client/kernel/locale-pages.js',
  'src/client/kernel/locale-vcwrite.js', // #842 写操作那一族的词条（单独一份片段）
  'src/client/kernel/locale-skilldesc.js', // #879 技能描述 27 条中英词条（单独一份片段）
]
;(async function structuralCheck() {
  const { pathToFileURL } = require('url')
  const problems = []
  // 片段真源里会引用中央时间参数（例如 locale-flow 的「宿主超过 N 秒没回应」直接算
  // SETTINGS_DEBUG_PUSH_WAIT_MS / 1000，真源在 src/shared/time-config/values.js）。
  // 单独 import 一个片段时这个裸标识符没人定义，会抛 ReferenceError，被误报成「载入失败」。
  // 这里先把 values.js 导出的数值常量挂到 globalThis（ESM 里裸标识符会回落到全局），
  // 数值仍从真源取，不手抄；只挂数字，避免把对象也塞进全局。
  const timeValues = await import(pathToFileURL(path.join(root, sourcePath('src/shared/time-config/values.js'))).href)
  for (const k of Object.keys(timeValues)) {
    if (typeof timeValues[k] === 'number') globalThis[k] = timeValues[k]
  }
  for (const rel of LOCALE_STRUCT_FILES) {
    let mod
    // 与上面 locSrc 同一条口径：先问 sourcePath 拿到这份词条真源今天住在哪，再 import 它。
    // 不先问就按 .js 拼 URL，这条 A2 断言盯的会是构建产物而不是源码 —— 产物对不对是
    // verify-*-freshness 那几条的职责，不是这里的。
    const real = path.join(root, sourcePath(rel))
    try { mod = await import(pathToFileURL(real).href) } catch (e) { problems.push(rel + ' 载入失败：' + ((e && e.message) || e)); continue }
    for (const name of Object.keys(mod)) {
      const dict = mod[name]
      if (!dict || typeof dict !== 'object' || !dict.zh || !dict.en) continue
      const top = Object.keys(dict).filter(function (k) { return k !== 'zh' && k !== 'en' })
      if (top.length) problems.push(rel + ' 的 ' + name + ' 顶层多出 ' + top.length + ' 个键（例如 ' + top.slice(0, 3).join('、') + '）：这些键不在 zh/en 字典里，界面上会直接把键名印出来')
      const zk = Object.keys(dict.zh), ek = Object.keys(dict.en)
      const onlyZh = zk.filter(function (k) { return !(k in dict.en) })
      const onlyEn = ek.filter(function (k) { return !(k in dict.zh) })
      if (onlyZh.length) problems.push(rel + ' 的 ' + name + ' 只在 zh 里有 ' + onlyZh.length + ' 个键（例如 ' + onlyZh.slice(0, 3).join('、') + '）')
      if (onlyEn.length) problems.push(rel + ' 的 ' + name + ' 只在 en 里有 ' + onlyEn.length + ' 个键（例如 ' + onlyEn.slice(0, 3).join('、') + '）')
    }
  }
  if (!problems.length) ok('A2. 词条结构：每个字典只有 zh/en 两个顶层键，且两边键集合相等')
  else for (const p of problems.slice(0, 6)) bad('A2. ' + p)

  // ---------- F. 技能描述文案评审（2026-10-17 从 verify-skill-tooltip.js 第 7 段搬来）----------
  // 为什么搬到这儿：原来那扇门禁 93 个判据点里 90 个是「某个字符串在产物文本里出现」，
  // 两次把产品改坏（z-index 降档、悬停不再打开列表）它都照样打印通过；唯一没人接手的
  // 就是这段文案评审。其余判据今天有真会红的继任者：verify-issue22-popovers.js（z-index
  // 就近配对）、verify-hovertip.js（翻转阈值与 portal 契约）、verify-issue22-ui.js（真浏览器）。
  // 技能名单从 src/shared/matt-skills.js 的真源读，不再硬编码 27 个名字：增减技能只改
  // 真源一处，locale-skilldesc.js 的条数跟不上就会在这里报红。
  const ZH_BAD = ['设计树', '深模块设计词汇', 'task 型 ticket', '本插件服务的对象', '领域术语与统一语言', '巨型项目决策地图', '对齐提问', '硬 bug 与性能回归诊断循环', '红-绿-重构', '讨论固化成规格', '写出优秀技能']
  const EN_BAD = ['design tree', 'Deep module design vocabulary', 'task tickets', 'what this plugin serves', 'Domain terms & ubiquitous language', 'Decision maps for large projects', 'alignment questioning', 'Diagnosis loop for hard bugs & performance regressions', 'Red-green-refactor', 'Turn discussions into specs', 'Write great skills']
  try {
    const matt = await import(pathToFileURL(path.join(root, sourcePath('src/shared/matt-skills.js'))).href)
    const sdMod = await import(pathToFileURL(path.join(root, sourcePath('src/client/kernel/locale-skilldesc.js'))).href)
    const dict = sdMod.L_SKILLDESC || {}
    const zhDict = dict.zh || {}
    const enDict = dict.en || {}
    const names = (matt.SKILLS || []).map(function (s) { return s.name }).sort()
    const zhKeys = Object.keys(zhDict).map(function (k) { return k.replace(/^skilldesc\./, '') }).sort()
    const enKeys = Object.keys(enDict).map(function (k) { return k.replace(/^skilldesc\./, '') }).sort()
    const missing = names.filter(function (n) { return !zhDict['skilldesc.' + n] || !enDict['skilldesc.' + n] })
    const extra = zhKeys.filter(function (k) { return names.indexOf(k) < 0 })
    if (names.length && !missing.length) ok('F. 技能描述：真源里 ' + names.length + ' 个技能的中英词条齐全')
    else bad('F. 技能描述缺词条：' + (missing.join('/') || '真源名单读不到'))
    if (!extra.length) ok('F. 技能描述没有真源之外的孤儿键')
    else bad('F. 技能描述多出真源之外的键：' + extra.join('/'))
    if (zhKeys.join(',') === enKeys.join(',')) ok('F. 技能描述中英键集合相等')
    else bad('F. 技能描述中英键集合不等')
    const blackHits = []
    ZH_BAD.forEach(function (w) { Object.keys(zhDict).forEach(function (k) { if (zhDict[k].indexOf(w) >= 0) blackHits.push('zh ' + k + ' 命中「' + w + '」') }) })
    EN_BAD.forEach(function (w) { Object.keys(enDict).forEach(function (k) { if (enDict[k].indexOf(w) >= 0) blackHits.push('en ' + k + ' 命中「' + w + '」') }) })
    if (!blackHits.length) ok('F. 技能描述没有自指 / jargon-only / 元评论黑名单词')
    else bad('F. 技能描述命中黑名单：' + blackHits.slice(0, 5).join('；'))
    const tooShort = names.filter(function (n) { const z = zhDict['skilldesc.' + n], e = enDict['skilldesc.' + n]; return (z && z.length < 8) || (e && e.length < 8) })
    if (!tooShort.length) ok('F. 技能描述每条都在 8 个字符以上')
    else bad('F. 技能描述过短：' + tooShort.join('/'))
  } catch (e) {
    bad('F. 技能描述评审载入失败：' + ((e && e.message) || e))
  }
  console.log(failed ? '\n[locale-completeness] FAIL (' + passed + ' passed)' : '\n全部通过 · locale 完整性门禁生效 (' + passed + ')')
  process.exit(failed ? 1 : 0)
})()
