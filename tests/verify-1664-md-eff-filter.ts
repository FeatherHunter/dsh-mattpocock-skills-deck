// tests/verify-1664-md-eff-filter.ts —— 门禁：#1664 主列表顶部那排 md目录签的折叠与选项来源。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1664-md-eff-filter.ts
//
// 背景（#1664，维护者拍板的口径）：markdown 列表顶部那排按工作单元过滤的 md目录签有两处缺口：
//   1. 目录名多了以后全部平铺，没有折叠；维护者要求照第三排分类标签那套折叠来一份蓝色的——
//      平时先画 10 个目录名（「全部」不算），多出来的收进一颗蓝色虚线 +N，点一下全展开、
//      末尾出现一颗「收起」，点了回到折叠态；
//   2. 完全关闭的工作单元仍出现在选项里；维护者要求「这个目录下没有一张打开的票」就整颗拿掉，
//      在哪个状态筛选下都不出现。
//
// 本门禁锁三件事：
//   1. 画法（src/client/views/mdEffortRow.ts）：把真源码求值，用假的 createElement 画树，
//      数颗数、看文字与配色、点 +N 与「收起」看状态怎么变。名单由调用方给，所以这里直接喂 10 个以上名字。
//   2. 选项来源（src/client/kernel/store-derived.ts 的 effortOptionNamesOf）：直接导真模块，
//      把身份函数挂到 globalThis（那些名字在打包闭包里是全局，单测里挂真身，与 verify-1548 同一做法），
//      喂各种快照看哪些工作单元会进选项、哪些被藏掉；同时确认徽标用的 effortNamesOf 没被带跑。
//   3. 接线（src/client/views/ListTab.ts）：这一排用的是过滤后的名单，而「要不要画这一排」仍看全部目录。
//
// 门禁归属: src/client/views/mdEffortRow.ts
// 门禁归属: src/client/kernel/store-derived.ts
// 门禁归属: src/client/views/ListTab.ts
const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string) => import(require('node:url').pathToFileURL(path.join(ROOT, rel)).href)

// ---------- 一、画法：把 mdEffortRow.ts 的真源码求值，用假的 createElement 画树 ----------
const { spliceableJs } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.js')
const leafJs = spliceableJs('src/client/views/mdEffortRow.js').replace(/^[ \t]*export[ \t]+/gm, '')
const emitted: any[] = []
const emitStub = function (s: any) { emitted.push(s) }
const trStub = function (k: any, vars?: any) {
  if (k === 'list.all') return '全部'
  if (k === 'list.collapse') return '收起'
  if (vars && vars.names !== undefined) return '全部 md目录签：' + vars.names + '（点击展开）'
  return String(k)
}
const tipStub = function (props: any, child: any) { return { type: 'Tip', props: props || {}, children: [child] } }
const chipPropsStub = function (p: any) { return p || {} }
const leaf = compileFn(['chipProps', 'tr', 'Tip', 'emit'], leafJs
  + '\nreturn { MD_EFFORT_FOLD_AT, mdEffortRowNode }')(chipPropsStub, trStub, tipStub, emitStub)

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
const chipsOf = function (st: any, names: any): any[] { return findChips(leaf.mdEffortRowNode(fakeH, st, names)) }
const logAt = function (chips: any, i: number): string { return (chips[i] && chips[i].props['data-log']) || '' }
const hasLog = function (tree: any, log: string): boolean {
  return findAll(tree, function (n: any) { return n && n.props && n.props['data-log'] === log }).length > 0
}
const noopEvent = function () { return { stopped: false, stopPropagation: function () { this.stopped = true } } }
function clickChip(chip: any): any {
  const e = noopEvent()
  chip.props.onClick(e)
  return e
}

check(leaf.MD_EFFORT_FOLD_AT === 10, '折叠阈值就是 10 个目录名（不含「全部」）')
const names12: string[] = []
for (let i = 0; i < 12; i += 1) names12.push('demo-' + (i + 1))
const names10: string[] = names12.slice(0, 10)

// 1.1 折叠态：全部 + 前 10 个 + 一颗蓝色 +N。
const stFold: any = { effFilters: [] }
const foldTree = leaf.mdEffortRowNode(fakeH, stFold, names12)
const foldChips = findChips(foldTree)
check(foldChips.length === 1 + 10 + 1, '12 个目录名折叠态画「全部」+ 前 10 个 + 一颗 +N（实际 ' + foldChips.length + ' 颗）')
check(logAt(foldChips, 0) === 'list.effort.all', '第一颗仍是「全部」')
check(logAt(foldChips, 1) === 'list.effort.0' && logAt(foldChips, 10) === 'list.effort.9', '前 10 颗定位串仍按序号，顺序不变')
const more = foldChips[foldChips.length - 1]
const moreStyle: any = more.props.style || {}
check(more.props['data-log'] === 'list.effort.more', '+N 有自己的定位串 list.effort.more')
check(textOf(more) === '+2', '+N 上写的是被藏起来的个数（+2）')
check(moreStyle.background === 'rgba(88,166,255,.1)' && moreStyle.color === '#58a6ff', '+N 是蓝色控件（与选中态同一个蓝）')
check(String(moreStyle.border).indexOf('1px dashed') === 0 && String(moreStyle.border).indexOf('rgba(88,166,255') >= 0, '+N 的描边是蓝色虚线')
check(moreStyle.display === 'inline', '+N 也是内联盒，与别的目录签一起能在行尾切断')
check(more.props['data-press'] === 'chip', '+N 带按压态（可点控件都得有 data-press）')
// +N 的悬停提示挂在它外面那层 Tip 上（每颗目录签自己也有一层 Tip），按内容里有最后一个名字认出它。
const moreTip = findAll(foldTree, function (n: any) {
  return n && n.type === 'Tip' && String(n.props && n.props.content).indexOf(names12[11]) >= 0
})[0]
check(!!moreTip && String(moreTip.props.content).indexOf(names12[0]) >= 0
  && String(moreTip.props.content).indexOf(names12[9]) >= 0, '+N 的悬停提示列出全部目录名（含被藏起来的那几个）')

// 1.2 点 +N 展开：12 个全画出来，末尾出现「收起」。
emitted.length = 0
const eMore = clickChip(more)
check(stFold.expEfforts === true, '点 +N 把展开状态记到 st.expEfforts 上')
check(emitted.length === 1 && emitted[0] === stFold, '点完把同一份状态交回 emit，界面才会重画')
check(eMore.stopped === true, '点 +N 会阻止冒泡，不误触列表行')
const expChips = chipsOf(stFold, names12)
check(expChips.length === 1 + 12 + 1, '展开后 12 个目录名全画出来，末尾多一颗「收起」（实际 ' + expChips.length + ' 颗）')
const less = expChips[expChips.length - 1]
check(less.props['data-log'] === 'list.effort.less', '「收起」有自己的定位串 list.effort.less')
check(textOf(less) === '收起', '「收起」那颗写的是「收起」')
const lessStyle: any = less.props.style || {}
check(lessStyle.background === 'rgba(255,255,255,.06)', '「收起」照抄第三排那颗的淡灰底，不抢蓝色')
check(less.props['data-press'] === 'chip', '「收起」带按压态')
check(!hasLog(expChips, 'list.effort.more'), '展开后不再有 +N 控件')

// 1.3 点「收起」回到折叠态。
emitted.length = 0
const eLess = clickChip(less)
check(stFold.expEfforts === false, '点「收起」回到折叠态')
check(emitted.length === 1 && emitted[0] === stFold, '点「收起」也把状态交回 emit')
check(eLess.stopped === true, '点「收起」同样阻止冒泡')
const backChips = chipsOf(stFold, names12)
check(backChips.length === 1 + 10 + 1 && logAt(backChips, backChips.length - 1) === 'list.effort.more', '收起后只留前 10 个，+N 回来')

// 1.4 边界：正好 10 个不折叠；11 个写 +1；展开态碰上只有 10 个时不画「收起」。
const st10: any = { effFilters: [] }
const chips10 = chipsOf(st10, names10)
check(chips10.length === 1 + 10, '正好 10 个目录名不折叠（没有 +N）')
check(!hasLog(chips10, 'list.effort.more'), '正好 10 个时不出现 +N')
const chips11 = chipsOf({ effFilters: [] }, names12.slice(0, 11))
check(chips11.length === 1 + 10 + 1 && textOf(chips11[chips11.length - 1]) === '+1', '11 个目录名时 +N 写 +1')
const chipsExpanded10 = chipsOf({ effFilters: [], expEfforts: true }, names10)
check(chipsExpanded10.length === 1 + 10, '展开态碰上只有 10 个目录名时不画「收起」（没有可收起的东西）')
check(!hasLog(chipsExpanded10, 'list.effort.less'), '没有可收起的东西时不出现「收起」')
// 展开态碰上名单变短（原本 12 个，关闭几个后剩 5 个）也照旧只画拿到的名单，不靠旧状态补东西。
const chipsExpanded5 = chipsOf({ effFilters: [], expEfforts: true }, names12.slice(0, 5))
check(chipsExpanded5.length === 1 + 5, '展开态碰上只有 5 个目录名时画「全部」+ 5 颗（实际 ' + chipsExpanded5.length + ' 颗）')
check(!hasLog(chipsExpanded5, 'list.effort.more') && !hasLog(chipsExpanded5, 'list.effort.less'),
  '名单变短到不用折叠时，展开态既不补 +N 也不补「收起」')

// 1.5 折叠不影响点选：折叠态点目录签仍是单选，选中配色照旧。
const stPick: any = { effFilters: [] }
const pickChips = chipsOf(stPick, names12)
clickChip(pickChips[2])
check(stPick.effFilters.length === 1 && stPick.effFilters[0] === names12[1], '折叠态点目录签仍是单选（只选中被点的那一颗）')
const pickChips2 = chipsOf(stPick, names12)
check(pickChips2[2].props.style.background === 'rgba(88,166,255,.18)', '选中的那颗有选中配色（折叠不影响选中态画法）')

// ---------- 二、选项来源：effortOptionNamesOf 只留「还有打开的票」的工作单元 ----------
async function checkOptionSourceAndWiring(): Promise<void> {
  const sd: any = await imp('src/client/kernel/store-derived.js')
  const identityKeys: any = await imp('src/tracker/kernel/identity-keys.js')
  // store-derived.ts 里 identity 三函数是打包闭包给的全局（declare），单测里把真身挂上。
  ;(globalThis as any).effortOf = identityKeys.effortOf
  ;(globalThis as any).idOfParts = identityKeys.idOfParts
  ;(globalThis as any).idOf = identityKeys.idOf

  // 三个来源各有一种情况：地图本身开着（子票开没开都不影响）、地图与子票全关、池子票里的小写 closed、
  // 票上缺 state（按打开算）、没有工作单元标识的行（不该凭空造出一颗选项）。
  const snapMix: any = {
    maps: [
      { effortId: 'alpha', state: 'OPEN', tickets: [{ effortId: 'alpha', state: 'OPEN' }, { effortId: 'alpha', state: 'CLOSED' }] },
      { effortId: 'beta', state: 'OPEN', tickets: [{ effortId: 'beta', state: 'CLOSED' }] },
      { effortId: 'gamma', state: 'CLOSED', tickets: [{ effortId: 'gamma', state: 'CLOSED' }] },
    ],
    issues: [
      { effortId: 'alpha', state: 'CLOSED' },
      { effortId: 'delta', state: 'closed' },
      { effortId: 'epsilon' },
      { effortId: 'zeta', state: 'OPEN' },
      { state: 'OPEN' },
    ],
  }
  const opts: string[] = sd.effortOptionNamesOf({ snapshot: snapMix })
  check(JSON.stringify(opts) === JSON.stringify(['alpha', 'beta', 'epsilon', 'zeta']),
    '选项只留有打开的票的工作单元，并按名字排序（实际 [' + opts.join(', ') + ']）')
  check(opts.indexOf('gamma') < 0, '地图与子票全关的工作单元被藏掉')
  check(opts.indexOf('delta') < 0, '池子票里小写的 closed 也认作已关闭，整颗藏掉')
  check(opts.indexOf('epsilon') >= 0, '票上缺少 state 字段时按打开算（宁可多给一颗，不误藏）')
  const allNames: string[] = sd.effortNamesOf({ snapshot: snapMix })
  check(allNames.length === 6 && allNames.indexOf('gamma') >= 0 && allNames.indexOf('delta') >= 0,
    '徽标用的 effortNamesOf 仍收全部目录（含全关的），没被过滤带跑（实际 [' + allNames.join(', ') + ']）')

  // 边界：空快照、缺快照、只有要藏的东西、数组里夹着坏行。
  check(JSON.stringify(sd.effortOptionNamesOf({})) === '[]', '没有快照时回空数组')
  check(JSON.stringify(sd.effortOptionNamesOf(null)) === '[]', '状态为空时回空数组')
  check(JSON.stringify(sd.effortOptionNamesOf({ snapshot: { maps: [{ effortId: 'only', state: 'CLOSED', tickets: [] }], issues: [] } })) === '[]',
    '唯一的工作单元也全关时回空数组（调用方据此不画这一排）')
  check(JSON.stringify(sd.effortOptionNamesOf({ snapshot: { maps: [null], issues: [null] } })) === '[]', '数组里夹坏行不抛错，照常回空数组')
  // 口径要求「在哪个状态筛选下都不出现」：这份选项只读快照、不读 stateFilter，三种筛选必须给出同一份名单。
  const optsOpen: string[] = sd.effortOptionNamesOf({ snapshot: snapMix, stateFilter: 'open' })
  const optsClosed: string[] = sd.effortOptionNamesOf({ snapshot: snapMix, stateFilter: 'closed' })
  const optsAll: string[] = sd.effortOptionNamesOf({ snapshot: snapMix, stateFilter: 'all' })
  check(JSON.stringify(optsOpen) === JSON.stringify(opts) && JSON.stringify(optsClosed) === JSON.stringify(opts)
    && JSON.stringify(optsAll) === JSON.stringify(opts),
    '状态筛选（打开 / 已关闭 / 全部）不改变选项名单，全关的工作单元在哪个筛选下都不冒出来')

  // 接线：这一排传过滤后的名单；「要不要画这一排」仍看全部目录。
  const listTab: string = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTab.ts'), 'utf8')
  check(listTab.indexOf('const effortNames = effortOptionNamesOf(st)') >= 0, 'ListTab 的选项来自过滤后的名单（effortOptionNamesOf）')
  check(listTab.indexOf('const allEffortNames = effortNamesOf(st)') >= 0
    && listTab.indexOf('const multiEffort = allEffortNames.length > 1') >= 0,
    '「要不要画这一排」仍看全部目录，不跟着选项少一颗就消失')
  check(listTab.indexOf('mdEffortRowNode(h, st, effortNames)') >= 0, '画这一排时传的是过滤后的名单')
}

checkOptionSourceAndWiring().then(function () {
  console.log('done ' + total + ' checks, failed=' + (failed ? 'yes' : 'no'))
  process.exit(failed ? 1 : 0)
}, function (e: any) {
  console.error('  FAIL 门禁自己在执行中抛错：' + (e && e.stack ? e.stack : e))
  process.exit(1)
})
