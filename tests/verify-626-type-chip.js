// verify-626-type-chip.js — #626：地图详情页「普通票」那一格显示什么
//
// 现象（#626）：地图详情页里，没打 wayfinder 类型标签的子票，编号右边印出字面量
//   type.issue（比如 FeatherHunter/ilife 的地图 #152 下的子票 #239）。
// 修法：补词条 type.issue（中文「普通票」/英文 Issue）+ 中性灰徽章；徽章前面不留圆点
//   （那看着像多出来的项目符号，去掉后文字才左右对称），左侧方框用中性灰点，
//   并把「任务票」的齿轮留给任务票自己。
//
// 本脚本不看注释、不看愿望，按真实词条与真实代码算一遍这一格的文字与图标：
//   A. 词条：中文块与英文块里 type.issue 的取值（不是抄一份常量，是从语言包读出来的）
//   B. 徽章：把 chips.js 里真实的 TypeChip 拿出来执行（tr 用 index.js 同款「缺词条退回键名」语义），
//      断言 type=issue 出「普通票」而不是 'type.issue'，且 task 仍是「任务」
//   C. 图标：把 index.js 的 TYPE_ICON 与 MapDetail.js 里那一行三元表达式求值，
//      断言 issue→dot、task→gear（两者不再撞脸）
//   D. 双产物：client.js 与 package/lib/client.js 都带上了新词条
//
// 用法: node tests/verify-626-type-chip.js（在插件根目录；无需 gh / 网络）
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let failed = false
let passed = 0
const ok = function (name) { passed++; console.log('  PASS', name) }
const bad = function (name) { failed = true; console.log('  FAIL', name) }
const check = function (cond, name) { if (cond) ok(name); else bad(name) }
const read = function (rel) { try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch (e) { return '' } }

// ---- A. 语言包：两端各自的 type.issue 取值 ----
const locSrc = read('src/client/kernel/locale-flow.js')
const zhPart = locSrc.slice(locSrc.indexOf('zh: {'), locSrc.indexOf('en: {'))
const enPart = locSrc.slice(locSrc.indexOf('en: {'))
const valueOf = function (part, key) {
  const m = part.match(new RegExp("'" + key.replace('.', '\\.') + "':\\s*'((?:[^'\\\\]|\\\\.)*)'"))
  return m ? m[1] : null
}
const zhIssue = valueOf(zhPart, 'type.issue')
const enIssue = valueOf(enPart, 'type.issue')
check(zhIssue === '普通票', "A. 中文词条 type.issue = 普通票（实际 " + zhIssue + '）')
check(enIssue === 'Issue', "A. 英文词条 type.issue = Issue（实际 " + enIssue + '）')
check(valueOf(zhPart, 'type.task') === '任务' && valueOf(enPart, 'type.task') === 'Task', 'A. 任务票词条未被改动')
check(valueOf(zhPart, 'type.map') === '地图' && valueOf(zhPart, 'type.research') === '研究', 'A. 其余类型词条仍在')

// ---- B. 徽章：执行 chips.js 里真实的 TypeChip ----
const chipSrc = read('src/client/views/shared/chips.js')
const fnStart = chipSrc.indexOf('const TypeChip')
const fnTail = chipSrc.slice(fnStart)
const arrow = fnTail.slice(fnTail.indexOf('({'), fnTail.lastIndexOf('}') + 1)
check(fnStart >= 0 && arrow.length > 0, 'B. 从 chips.js 抽到 TypeChip 函数体')
// index.js 第 90-96 行的取词条语义：字典里有就用，没有就把键名原样返回
const trStub = function (key) {
  const v = valueOf(zhPart, key)
  return v !== null ? v : key
}
const iconMap = (function () {
  const m = read('src/client/index.js').match(/const TYPE_ICON = \{([^}]*)\}/)
  if (!m) return null
  const out = {}
  m[1].split(',').forEach(function (kv) {
    const p = kv.split(':')
    if (p.length === 2) out[p[0].trim()] = p[1].trim().replace(/'/g, '')
  })
  return out
})()
check(!!iconMap, 'B. 从 index.js 抽到 TYPE_ICON 表')
if (iconMap) {
  const makeChip = new Function('React', 'DswsCtx', 'Ic', 'tr', 'TYPE_ICON', 'return (' + arrow + ')')
  const TypeChip = makeChip(
    { useContext: function () { return null }, createElement: function (t, p, c) { return { type: t, props: p || {}, children: c === undefined ? null : c } } },
    {},
    function (p) { return { icon: p.n } },
    trStub,
    iconMap,
  )
  const textOf = function (type) {
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
check(chipSrc.indexOf('TYPE_LABEL[type]') < 0, 'B. chips.js 不再保留那条从 TYPE_LABEL 取文字的死代码')

// ---- C. 图标：TYPE_ICON 与 MapDetail 那一行三元表达式 ----
if (iconMap) {
  check(!('issue' in iconMap), 'C. TYPE_ICON 里没有 issue —— 普通票徽章不出图标（实际 ' + JSON.stringify(iconMap) + '）')
  check(iconMap.task === 'gear', 'C. TYPE_ICON.task 仍是 gear')
}
const detailSrc = read('src/client/views/MapDetail.js')
const icLine = (detailSrc.match(/const ic = [^\n]*/) || [''])[0]
check(icLine.length > 0, 'C. 从 MapDetail.js 抽到节点图标那一行')
if (icLine.length > 0) {
  const expr = icLine.slice('const ic = '.length).replace(/;\s*$/, '')
  const icFor = function (wt) { return new Function('_wt', 'return ' + expr)(wt) }
  check(icFor('issue') === 'dot', "C. 普通票左侧方框图标 = 中性灰点（实际 " + icFor('issue') + '）')
  check(icFor('task') === 'gear', 'C. 任务票方框图标仍是齿轮')
  check(icFor('research') === 'search' && icFor('prototype') === 'hammer' && icFor('grilling') === 'chat' && icFor('map') === 'map', 'C. 其余四种类型图标未变')
}
check(detailSrc.indexOf(": _wt === 'task' ? 'gear' : 'dot'") >= 0, 'C. MapDetail 末位兜底已改为中性灰点')

// ---- D. 样式类与双产物 ----
const stylesSrc = read('src/client/kernel/styles.js')
check(stylesSrc.indexOf('.dsws-chip-i{') >= 0, 'D. styles.js 有中性灰徽章样式 .dsws-chip-i')
const artifacts = ['client.js', 'package/lib/client.js']
for (const a of artifacts) {
  const buf = read(a)
  if (!buf) { bad('D. 产物缺失 ' + a + '（先跑 npm run build）'); continue }
  check(buf.indexOf("'type.issue'") >= 0, "D. " + a + " 含词条 'type.issue'")
  check(buf.indexOf('普通票') >= 0, 'D. ' + a + ' 含中文显示名「普通票」')
  check(buf.indexOf('dsws-chip-i') >= 0, 'D. ' + a + ' 含中性灰样式类')
}

console.log(failed ? '\n[verify-626-type-chip] FAIL (' + passed + ' passed)' : '\n全部通过 · #626 普通票显示口径生效 (' + passed + ')')
process.exit(failed ? 1 : 0)
