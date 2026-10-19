// verify-626-type-chip.ts — #626：地图详情页「普通票」那一格显示什么
//
// 现象（#626）：地图详情页里，没打 wayfinder 类型标签的子票，编号右边印出字面量
//   type.issue（比如 FeatherHunter/ilife 的地图 #152 下的子票 #239）。
// 修法：补词条 type.issue（中文「普通票」/英文 Issue）+ 中性灰徽章；徽章前面不留圆点
//   （那看着像多出来的项目符号，去掉后文字才左右对称），左侧方框用中性灰点，
//   并把「任务票」的齿轮留给任务票自己。
//
// 本脚本不看注释、不看愿望，按真实词条与真实代码算一遍这一格的文字与图标：
//   A. 词条：从语言包取出中文块，只作为真词条喂给 B 段被测的 TypeChip（不再单独断言语言包文本）
//   B. 徽章：把 chips.js 里真实的 TypeChip 拿出来执行（tr 用 index.ts 同款「缺词条退回键名」语义），
//      断言 type=issue 出「普通票」而不是 'type.issue'，且 task 仍是「任务」
//   C. 图标：把 MapDetail.js 里那一行三元表达式抠出来求值，断言 issue→dot、task→gear（两者不再撞脸）
//   D. 双产物：client.js 与 package/lib/client.js 都带上了新词条
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-626-type-chip.ts（在插件根目录；无需 gh / 网络）
const fs = require('fs')
const path = require('path')
const { compileFn } = require('./lib/eval-probe.js')
// #1251：locale-flow.js 手写真源已删，真源是同名 .ts；A 段按文本扫描取原文（单引号形态，valueOf 正则不动）。
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name: string): void { passed++; console.log('  PASS', name) }
const bad = function (name: string): void { failed = true; console.log('  FAIL', name) }
const check = function (cond: unknown, name: string): void { if (cond) ok(name); else bad(name) }
const read = function (rel: string): string { try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch (e) { return '' } }

// ---- A. 语言包：取出真词条 ----
// 【已删除】原先这里读 locale-flow.js 的源码文本，用正则抠出中英文 type.issue / type.task /
// type.map / type.research 的值并逐条断言。那是钉源码文本的门禁（等价改写法就会变红），撤掉。
// 保留下面的 zhPart 与 valueOf：它们不再被单独断言，而是作为真词条喂给 B 段被测的 TypeChip。
const locSrc = sourceText('src/client/kernel/locale-flow.js')
const zhPart = locSrc.slice(locSrc.indexOf('zh: {'), locSrc.indexOf('en: {'))
const valueOf = function (part: string, key: string): string | null {
  const m = part.match(new RegExp("'" + key.replace('.', '\\.') + "':\\s*'((?:[^'\\\\]|\\\\.)*)'"))
  return m ? m[1] : null
}

// ---- B. 徽章：执行 chips.js 里真实的 TypeChip ----
// chips 的手写真源已经是同名 .ts：函数体里带着 `({ type }: any)` 这类类型标注，原文不能直接当 JavaScript 求值。
// 所以走 spliceableJs —— 它按构建同一份口径转译，拿到的就是拼进产物的那段 JavaScript。
const chipSrc = spliceableJs('src/client/views/shared/chips.js')
const fnStart = chipSrc.indexOf('const TypeChip')
const fnTail = chipSrc.slice(fnStart)
// 花括号配平取 TypeChip 函数体（不用 lastIndexOf 取文件尾：chips.js 尾部还有键盘三件套，取尾会把 export 也兜进来）
const arrow = (function (): string {
  const bodyOpen = fnTail.indexOf('=>')
  let i = fnTail.indexOf('{', bodyOpen)
  if (i < 0) return ''
  let depth = 0
  for (let j = i; j < fnTail.length; j += 1) {
    if (fnTail[j] === '{') depth += 1
    else if (fnTail[j] === '}') { depth -= 1; if (depth === 0) return fnTail.slice(fnTail.indexOf('({'), j + 1) }
  }
  return ''
})()
check(fnStart >= 0 && arrow.length > 0, 'B. 从 chips.js 抽到 TypeChip 函数体')
// 入口同款取词条语义（index.ts，locale 缺失时退化实现）：字典里有就用，没有就把键名原样返回
const trStub = function (key: string): string {
  const v = valueOf(zhPart, key)
  return v !== null ? v : key
}
const iconMap = (function (): Record<string, string> | null {
  // #1254：真源已转 src/client/index.ts，走 sourceText（.ts 优先，文本与转写前一致）。
  const m = sourceText('src/client/index.js').match(/const TYPE_ICON = \{([^}]*)\}/)
  if (!m) return null
  const out: Record<string, string> = {}
  m[1].split(',').forEach(function (kv: string): void {
    const p = kv.split(':')
    if (p.length === 2) out[p[0].trim()] = p[1].trim().replace(/'/g, '')
  })
  return out
})()
check(!!iconMap, 'B. 从 index.ts 抽到 TYPE_ICON 表')
if (iconMap) {
  // 本文件选 compileFn：这两处原来都是「把参数名与函数体交给构造器造函数」，语义一一对应，
  //   且被造的代码只用参数、不读外层变量（arrow 是当场算好的文本），所以不需要额外的作用域表。
  const makeChip = compileFn(['React', 'DswsCtx', 'Ic', 'tr', 'TYPE_ICON'], 'return (' + arrow + ')')
  const TypeChip = makeChip(
    { useContext: function () { return null }, createElement: function (t: string, p: Record<string, unknown>, c: unknown) { return { type: t, props: p || {}, children: c === undefined ? null : c } } },
    {},
    function (p: { n: string }) { return { icon: p.n } },
    trStub,
    iconMap,
  )
  const textOf = function (type: string): { className: string; icon: string | null; text: string } {
    const chip = TypeChip({ type: type })
    const label = chip.children[1]
    return { className: chip.props.className, icon: chip.children[0] ? chip.children[0].icon : null, text: label.children }
  }
  const issueChip = textOf('issue')
  check(issueChip.text === '普通票', "B. 普通票徽章文字 = 普通票（实际 " + issueChip.text + '）')
  check(issueChip.text !== 'type.issue', "B. 徽章不再印出 'type.issue' 字面量")
  check(issueChip.icon === null, "B. 普通票徽章不出图标（实际 " + issueChip.icon + '）')
  check(issueChip.className === 'dsws-chip dsws-chip-i', 'B. 普通票徽章样式类 = dsws-chip-i（中性灰）')
  const taskChip = textOf('task')
  check(taskChip.text === '任务' && taskChip.icon === 'gear', 'B. 任务票徽章未受影响（任务 + 齿轮）')
  const researchChip = textOf('research')
  check(researchChip.text === '研究' && researchChip.icon === 'search', 'B. 研究票徽章未受影响（研究 + 放大镜）')
  // 兜底语义本身没动：将来冒出新类型值，仍会退回键名（那是 tr 的既有行为，本票不碰）
  check(textOf('brandnewtype').text === 'type.brandnewtype', 'B. 未知类型仍退回键名（tr 的既有兜底未被改动）')
}

// ---- C. 图标：把 MapDetail.js 那一行三元表达式抠出来求值 ----
// 【已删除】原先还断言 TYPE_ICON 表（从 index.js 抠出来）里没有 issue、task 是 gear。
// 那是钉源码文本的断言；TYPE_ICON 现在只作为参数喂给 B 段被测的 TypeChip，不再单独断言它的内容。
// 同上：MapDetail 的真源也已经是 .ts，这一行三元表达式要交给 compileFn 求值，按可拼接的 JavaScript 形态取。
const detailSrc = spliceableJs('src/client/views/MapDetail.js')
const icLine = (detailSrc.match(/const ic = [^\n]*/) || [''])[0]
check(icLine.length > 0, 'C. 从 MapDetail.js 抽到节点图标那一行')
if (icLine.length > 0) {
  const expr = icLine.slice('const ic = '.length).replace(/;\s*$/, '')
  // 同上：这里同样只是把 _wt 与一段当场算好的表达式文本交给构造器，照样走 compileFn。
  const icFor = function (wt: string): string { return compileFn(['_wt'], 'return ' + expr)(wt) }
  check(icFor('issue') === 'dot', "C. 普通票左侧方框图标 = 中性灰点（实际 " + icFor('issue') + '）')
  check(icFor('task') === 'gear', 'C. 任务票方框图标仍是齿轮')
  check(icFor('research') === 'search' && icFor('prototype') === 'hammer' && icFor('grilling') === 'chat' && icFor('map') === 'map', 'C. 其余四种类型图标未变')
}
// 【已删除】两处钉源码文本的断言：MapDetail.js 里「末位兜底写成 'dot'」的那段文本，
// 以及 styles.js 里必须出现 '.dsws-chip-i{'。等价改写法一变它们就变红，撤掉。

// ---- D. 双产物 ----
const artifacts = ['client.js', 'package/lib/client.js']
for (const a of artifacts) {
  const buf = read(a)
  if (!buf) { bad('D. 产物缺失 ' + a + '（先跑 npm run build）'); continue }
  // #1251：esbuild 产物统一用双引号（手写 .js 时代是单引号），两种形态都认（同 slots:271 做法）。
  check(buf.indexOf("'type.issue'") >= 0 || buf.indexOf('"type.issue"') >= 0, "D. " + a + " 含词条 'type.issue'")
  check(buf.indexOf('普通票') >= 0, 'D. ' + a + ' 含中文显示名「普通票」')
  check(buf.indexOf('dsws-chip-i') >= 0, 'D. ' + a + ' 含中性灰样式类')
}

console.log(failed ? '\n[verify-626-type-chip] FAIL (' + passed + ' passed)' : '\n全部通过 · #626 普通票显示口径生效 (' + passed + ')')
process.exit(failed ? 1 : 0)
