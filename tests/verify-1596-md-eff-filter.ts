// tests/verify-1596-md-eff-filter.ts —— 门禁：#1596 md目录签单选与定名，加上 #1639 的排布与文字上限快速绊线。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1596-md-eff-filter.ts
//
// 背景（#1596）：主列表顶部那排按工作单元过滤的选项已定名 md目录签，之前是多选数组叠加；
//   #1596 定下单选语义（一次只看一个工作单元，再点同一颗回到全部）并把长名字显示全。
// 背景（#1639）：#1596 当时把「长名字显示全」做成了胶囊内部折行 + 整颗胶囊换行，而维护者要的是
//   行尾放不下就在字与字之间切断（前一半在第一行、后一半接在第二行头），并且每颗显示文字不超过
//   19 个数字的宽度、超出时末尾另加一个省略号（省略号不占那 19 个数字的额度）。
//
// 本门禁锁三件事，都是「一眼能读源码/能直接跑函数」的快速判据（百毫秒量级）：
//   1. 排布写法没退回 flex 整颗换行、胶囊内部折行：画法在 src/client/views/mdEffortRow.ts，
//      容器是普通块、每颗是内联盒、切口用 box-decoration-break:slice。
//   2. 单选行为与文字上限确实按维护者口径工作：把 mdEffortRow.ts 的真源码求值，
//      用假的 createElement / chipProps 画一棵元素树，点各颗看状态怎么变；
//      再用注入的字宽量 mdEffortLabelOf 的截断边界。
//   3. 术语表与下游寻址没被改动带跑。
// 真正的几何判据（分片数、首片在同一行、每片不是高块）在浏览器里量，见
//   tests/verify-1639-md-eff-split-browser.ts —— 本门禁只是快速绊线，不能替代它。
//
// 门禁归属: src/client/views/mdEffortRow.ts
// 门禁归属: src/client/views/ListTab.ts
// 门禁归属: GLOSSARY.md
const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const listTab = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTab.ts'), 'utf8')
const gloss = fs.readFileSync(path.join(ROOT, 'GLOSSARY.md'), 'utf8')
const leafPath = path.join(ROOT, 'src/client/views/mdEffortRow.ts')
const leafSrc = fs.readFileSync(leafPath, 'utf8')

// 1. 定名已写进术语表，且与工单标签、顶部页签区分。
check(gloss.indexOf('md目录签') >= 0, '术语表收录 md目录签')
check(gloss.indexOf('工单标签') >= 0 && gloss.indexOf('顶部页签') >= 0, '术语表区分工单标签与顶部页签')

// 2. 那一排的画法确实搬到了 mdEffortRow.ts，ListTab 只负责调用；旧写法（胶囊内折行 + 整颗换行）不该回来。
check(listTab.indexOf('mdEffortRowNode(h, st, effortNames)') >= 0, 'ListTab 调用 mdEffortRowNode 画那一排')
check(listTab.indexOf('maxWidth: 220') < 0, 'ListTab 不再留着旧的 220 像素上限写法')
check(leafSrc.indexOf('flexWrap') < 0, '画法里没有 flexWrap（退回 flex 就只能整颗换行）')
check(leafSrc.indexOf('maxWidth: 220') < 0, '画法里没有旧的 220 像素上限（内联盒上它不生效，只会把胶囊撑成高块）')
check(leafSrc.indexOf("display: 'inline'") >= 0, '每颗胶囊是内联盒（能被行尾切开的前提）')
check(leafSrc.indexOf('boxDecorationBreak') >= 0 && leafSrc.indexOf("'slice'") >= 0, '切口保留 slice 封口口径')

// 3. 把真源码求值，直接跑函数：既不抄逻辑，也不依赖浏览器。
const { spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.js')
const leafJs = spliceableJs('src/client/views/mdEffortRow.js').replace(/^[ \t]*export[ \t]+/gm, '')
const emitted: any[] = []
const emitStub = function (s: any) { emitted.push(s) }
const trStub = function (k: any) { return (k === 'list.all') ? '全部' : String(k) }
const tipStub = function (props: any, child: any) { return { type: 'Tip', props: props || {}, children: [child] } }
const chipPropsStub = function (p: any) { return p || {} }
const leaf = compileFn(['chipProps', 'tr', 'Tip', 'emit'], leafJs
  + '\nreturn { MD_EFFORT_LABEL_DIGIT_LIMIT, MD_EFFORT_LABEL_ELLIPSIS, mdEffortLabelOf, mdEffortRowNode }')(chipPropsStub, trStub, tipStub, emitStub)

function fakeH(type: any, props: any, children: any) {
  const kids: any[] = (children === undefined) ? [] : (Array.isArray(children) ? children : [children])
  // 函数式组件（Tip 桩）按 createElement 的规矩就地求值，返回它画出来的元素；其余按普通元素收下。
  if (typeof type === 'function') return type(props || {}, kids[0])
  return { type: type, props: props || {}, children: kids }
}
function findAll(node: any, pred: any, out?: any[]): any[] {
  const acc: any[] = out || []
  if (Array.isArray(node)) { node.forEach(function (n: any) { findAll(n, pred, acc) }); return acc }
  if (!node || typeof node !== 'object') return acc
  if (pred(node)) acc.push(node)
  ;(node.children || []).forEach(function (n: any) { findAll(n, pred, acc) })
  return acc
}
function textOf(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!node || typeof node !== 'object') return ''
  return (node.children || []).map(textOf).join('')
}
const findChips = function (tree: any): any[] {
  return findAll(tree, function (n: any) { return n && n.type === 'span' && n.props && n.props['data-log'] })
}

// 3.1 文字上限：注入「每个数字 5.5 像素、汉字 10 像素、其余半角 6 像素」的量字函数。
//   19 个数字 = 104.5 像素，这就是每颗目录签允许显示的文字宽度。
const measure = function (text: any): number {
  let w: number = 0
  const chars: string[] = Array.from(String(text))
  for (let i = 0; i < chars.length; i += 1) {
    const code: number = chars[i].codePointAt(0) || 0
    if (code >= 0x30 && code <= 0x39) w += 5.5
    else if ((code >= 0x2e80 && code <= 0x9fff) || code === 0x2026) w += 10
    else w += 6
  }
  return w
}
const labelOf = function (nm: any): string { return leaf.mdEffortLabelOf(nm, measure) }
const BUDGET = 19 * 5.5
check(leaf.MD_EFFORT_LABEL_DIGIT_LIMIT === 19, '文字上限记的是 19 个数字的宽度')
check(leaf.MD_EFFORT_LABEL_ELLIPSIS === '…', '截断标记是一个省略号字符')
check(labelOf('短名') === '短名', '没超上限的短名字原样显示')
check(labelOf('0'.repeat(19)) === '0'.repeat(19), '正好 19 个数字宽的名字不截断')
check(labelOf('0'.repeat(20)) === '0'.repeat(19) + '…', '20 个数字的名字截回 19 个数字再加省略号')
const longCjk = '这是一个特别长的目录名字用于跨行切断演示'
const cjkLabel = labelOf(longCjk)
check(cjkLabel.slice(-1) === '…' && cjkLabel.length === 11, '20 个汉字的名字截成 10 个汉字加省略号')
check(measure(cjkLabel.slice(0, -1)) <= BUDGET, '省略号之前的那截文字不超过 19 个数字的宽度')
check(measure(cjkLabel.slice(0, -1) + '字') > BUDGET, '再往前一个字就超上限（说明是真截断不是乱截）')
check(labelOf('') === '', '空名字原样返回')
check(labelOf(longCjk).indexOf('…') === labelOf(longCjk).length - 1, '省略号只在末尾，不在名字中间')

// 3.2 画出来的那一排：容器是普通块、每颗是内联盒、切口 slice、名字/悬停/日志都没丢。
const names = ['demo-章-7', 'spec-调色板', longCjk]
const st: any = { effFilters: [] }
const tree = leaf.mdEffortRowNode(fakeH, st, names, measure)
const row = findAll(tree, function (n: any) { return n && n.type === 'div' && n.props && n.props['data-dsh-md-effort-row'] === '1' })[0]
check(!!row, '画出来的那一排带 data-dsh-md-effort-row 锚点')
check(row && row.props.style.display === 'block', '容器是普通块（不是 flex）')
check(row && row.props.style.flexWrap === undefined, '容器不换行整颗（没有 flexWrap）')
const chips = findChips(tree)
check(chips.length === names.length + 1, '画了「全部」加每颗目录签，一颗不少')
const layoutOk = chips.every(function (c: any) {
  const s: any = c.props.style || {}
  return s.display === 'inline' && s.whiteSpace === 'normal' && s.wordBreak === 'break-all'
    && s.boxDecorationBreak === 'slice' && s.WebkitBoxDecorationBreak === 'slice' && s.maxWidth === undefined
})
check(layoutOk, '每颗胶囊都是内联盒、可逐字断开、slice 封口、没有宽度上限')
check(chips[0] && chips[0].props['data-log'] === 'list.effort.all' && textOf(chips[0]) === '全部', '「全部」那颗定位串与文字不变')
check(chips[1] && chips[1].props['data-log'] === 'list.effort.0' && chips[2].props['data-log'] === 'list.effort.1', '目录签定位串仍按序号，顺序不变')
check(chips[1] && chips[1].props['aria-label'] === names[0], '每颗目录签的 aria-label 仍是全名')
const tipOfFirst = findAll(tree, function (n: any) { return n && n.type === 'Tip' })[0]
check(tipOfFirst && tipOfFirst.props.content === names[0], '悬停提示仍是全名')
check(textOf(chips[3]) === labelOf(longCjk), '长名字按上限截断后再画，不是原样塞进去')
check(textOf(chips[2]) === names[1], '没超上限的目录名原样画')

// 3.3 单选行为：点一颗只选中一颗，再点同一颗回到全部，「全部」那颗清空。
const noopEvent = function () { return { stopped: false, stopPropagation: function () { this.stopped = true } } }
function clickChip(chip: any): any {
  const e = noopEvent()
  chip.props.onClick(e)
  return e
}
emitted.length = 0
const tree1 = leaf.mdEffortRowNode(fakeH, st, names, measure)
const chips1 = findChips(tree1)
const e1 = clickChip(chips1[1])
check(st.effFilters.length === 1 && st.effFilters[0] === names[0], '空态点第一颗只选中它（单选）')
check(emitted.length === 1 && emitted[0] === st, '点完把同一份状态交回 emit，界面才会重画')
check(e1.stopped === true, '点目录签会阻止冒泡，不误触列表行')
const tree2 = leaf.mdEffortRowNode(fakeH, st, names, measure)
const chips2 = findChips(tree2)
check(chips2[1].props.style.background === 'rgba(88,166,255,.18)', '选中的那颗有选中配色')
clickChip(chips2[1])
check(st.effFilters.length === 0, '再点同一颗回到全部')
st.effFilters = [names[1]]
const tree3 = leaf.mdEffortRowNode(fakeH, st, names, measure)
clickChip(findChips(tree3)[0])
check(st.effFilters.length === 0, '点「全部」清空筛选')

// 4. 下游寻址与单选口径一致：数组最多一颗时按单颗带寻址范围。
const ip = fs.readFileSync(path.join(ROOT, 'src/client/kernel/issue-pages.ts'), 'utf8')
check(ip.indexOf('effs.length === 1 ? String(effs[0])') >= 0, '下游单颗时带寻址范围，多选不带')

console.log('done ' + total + ' checks, failed=' + (failed ? 'yes' : 'no'))
if (failed) process.exit(1)
