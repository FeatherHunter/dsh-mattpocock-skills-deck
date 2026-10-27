// tests/verify-1564-ticket-badge.ts —— 门禁：票号徽标只有一种画法（#1564）。
//
// 要钉住的事：同一颗「#目录/编号」徽标以前在五处显示点各画一遍（列表行、票详情页头、容器详情页头、
// 在办表首列、状态栏胶囊的展开单子与主行）—— 五份拷贝各自写着上限宽度、两段布局（目录段可省略、
// 编号尾巴绝不缩小）、悬停内容与无障碍名。其中一处已经写歪过（#1301 地图详情页头画成裸号），
// 所以本票把整颗徽标收成一个共用组件，五个调用方从此只回答「画哪张票、用哪种外壳、这一处主色是什么」。
//
// 从 #1564 起：
//   · 整颗徽标的画法只在 src/client/views/shared/ticketBadge.ts 一处，四种外壳 surface =
//     badge（列表行与两处详情页头）/ cell（在办表首列）/ pill（胶囊展开单子）/ capsule（主胶囊）；
//   · 五个调用点不再出现上限宽度、两段子节点、折叠函数、悬停字符串与 dsws-idnum 类名；
//   · 在办表首列（cell）不套自己的 Tip —— 嵌套 Tip 只有外层会显示（HoverTip 的全局待显示槽），
//     这一处的悬停交给整行的 tipContent（#1287/#1288）；
//   · 文字规则、折叠让位与上限宽度的真源仍住在 kernel/ticket-label.ts（本票没搬它，只搬「怎么画」）。
//
// 手法：组件用真函数跑（假 h 记录节点树、假 Tip 记录悬停内容），五个调用点用源码文本核对
// （它们住在浏览器闭包里，靠 build 拼进 src/client/index.ts，在这里没法整体运行）。
//
// 门禁归属: src/client/views/shared/ticketBadge.ts
// 门禁归属: src/client/kernel/ticket-label.ts
// 门禁归属: src/client/views/ListTabRow.ts
// 门禁归属: src/client/views/IssueDetail.ts
// 门禁归属: src/client/views/MapDetailHead.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
// 门禁归属: src/client/statusbar/SessionChainCapsule.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1564-ticket-badge.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sourceText } from './lib/source-text.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 门禁里的假元素工厂：把每一次创建记录成 { tag, props, children }，方便断言形状与顺序。 */
const fakeH = function (tag: any, props: any, children?: any) {
  const kids = children == null ? [] : (Array.isArray(children) ? children : [children])
  return { tag: tag, props: props || {}, children: kids }
}
/** 假 Tip：记录悬停内容；组件把 Tip 当标签传进 h，断言时按这个函数引用认它。 */
const FakeTip = function (props: any) { return { tag: 'tip', props: props || {}, children: [] } }
/** 数一棵假节点树里套了几层 Tip（嵌套 Tip 是 #1564 明确要避免的写错法）。 */
const countTip = function (node: any): number {
  if (!node || typeof node !== 'object') return 0
  if (node.tag === FakeTip || node.tag === 'tip') return 1 + (node.children || []).reduce((n: number, c: any) => n + countTip(c), 0)
  return (node.children || []).reduce((n: number, c: any) => n + countTip(c), 0)
}
/** 丢给假 h 的图标节点：柱记号用来确认它排在号前面、且不在号字里面。 */
const ICON = fakeH('icon', { 'data-icon': 'map' })

async function main(): Promise<void> {
  const kernel: any = await imp('src/client/kernel/ticket-label.ts')
  ;(globalThis as any).Tip = FakeTip
  ;(globalThis as any).ticketLabelOf = kernel.ticketLabelOf
  ;(globalThis as any).ticketLabelNodesOf = kernel.ticketLabelNodesOf
  ;(globalThis as any).ticketLabelCapsuleFoldOf = kernel.ticketLabelCapsuleFoldOf
  ;(globalThis as any).TICKET_LABEL_MAX_WIDTH = kernel.TICKET_LABEL_MAX_WIDTH
  const badgeMod: any = await imp('src/client/views/shared/ticketBadge.ts')
  const ticketBadgeOf = badgeMod.ticketBadgeOf
  check(typeof ticketBadgeOf === 'function', 'views/shared/ticketBadge.ts 导出 ticketBadgeOf（整颗徽标的唯一画法）')

  // ── 一、四种外壳的真函数行为 ───────────────────────────────────────────────────
  const DIR = '买咖啡积分'
  const FULL = '#' + DIR + '/01'
  const badge = ticketBadgeOf(fakeH, { key: '01', effortId: DIR, surface: 'badge', color: '#1D4ED8' })
  check(badge.tag === FakeTip && badge.props.content === FULL, 'badge 外壳：整颗包在 Tip 里，悬停内容是完整写法 #买咖啡积分/01')
  check(badge.children.length === 1, 'badge 外壳：Tip 里只包一个节点（不把两段号直接挂在 Tip 下）')
  const badgeSpan = badge.children[0]
  check(badgeSpan.tag === 'span' && badgeSpan.props.className === 'dsws-idnum', 'badge 外壳：里面仍是 dsws-idnum（浅色主题层与交互反馈样式按这个类名命中）')
  const bs = badgeSpan.props.style
  check(bs.color === '#1D4ED8' && bs.borderColor === '#1D4ED8', 'badge 外壳：文字与描边取调用方给的主色')
  check(bs.maxWidth === '85px' && bs.display === 'inline-flex' && bs.overflow === 'hidden', 'badge 外壳：上限宽度来自 kernel 那一份（85px），不外写一个数')
  check(badgeSpan.children.length === 2, 'badge 外壳：两段子节点原样来自 ticketLabelNodesOf（目录 + /编号）')
  check(badgeSpan.children[0] && badgeSpan.children[0].props.style.textOverflow === 'ellipsis', 'badge 外壳：目录那段可省略（末尾变…）')
  check(badgeSpan.children[1] && badgeSpan.children[1].props.style.flex === 'none', 'badge 外壳：`/编号` 那段绝不缩小')

  const cell = ticketBadgeOf(fakeH, { key: '00', effortId: DIR, surface: 'cell', color: 'var(--dsw-alias-label-primary,#e6e6eb)', ref: 'number-ref' })
  check(cell.tag !== FakeTip && countTip(cell) === 0, 'cell 外壳：不套自己的 Tip（嵌套 Tip 只有外层会显示，悬停交给整行）')
  check(cell.props.ref === 'number-ref', 'cell 外壳：保留量「这一格有没有被截掉」用的 ref')
  check(cell.props.style.maxWidth === '85px' && cell.props.style.fontVariantNumeric === 'tabular-nums', 'cell 外壳：上限宽度仍是同一份（85px），数字等宽照旧')
  check(cell.props.style.textOverflow === 'ellipsis' && cell.props.style.whiteSpace === 'nowrap', 'cell 外壳：格子溢出走省略号')
  check(cell.children.length === 2 && cell.children[1] && cell.children[1].props.style.flex === 'none', 'cell 外壳：两段号与其它外壳是同一份（`/编号` 不缩）')

  const pill = ticketBadgeOf(fakeH, { key: '01', effortId: DIR, surface: 'pill', color: '#1D4ED8', borderColor: '#93C5FD' })
  check(pill.tag === FakeTip && pill.props.content === FULL, 'pill 外壳：悬停内容同样是完整写法')
  const pillSpan = pill.children[0]
  check(pillSpan.props.style.borderRadius === 99 && pillSpan.props.style.border === '1px solid #93C5FD', 'pill 外壳：圆角药丸，描边取 borderColor')
  check(pillSpan.props.style.flex === 'none' && pillSpan.props.style.fontSize === 11, 'pill 外壳：不参与横排伸缩、字号 11（展开单子里的那一行）')
  check(pillSpan.children.length === 2, 'pill 外壳：没有容器图标时直接两段号')
  const pillWithIcon = ticketBadgeOf(fakeH, { key: '00', effortId: DIR, surface: 'pill', color: '#1D4ED8', borderColor: '#93C5FD', leadingIcon: ICON })
  const pillWithIconSpan = pillWithIcon.children[0]
  check(pillWithIconSpan.children.length === 2 && pillWithIconSpan.children[0] === ICON, 'pill 外壳：容器图标排在号前面（图标是号的兄弟，不是号字）')
  check(pillWithIconSpan.children[1] && pillWithIconSpan.children[1].children.length === 2, 'pill 外壳：图标之后的号仍是两段')

  const caps = ticketBadgeOf(fakeH, { key: '01', effortId: DIR, surface: 'capsule' })
  check(caps.tag === FakeTip && caps.props.content === FULL, 'capsule 外壳：悬停内容仍是完整写法（主胶囊这一颗只补悬停）')
  const foldExpected = kernel.ticketLabelCapsuleFoldOf(fakeH, '01', DIR)
  check(JSON.stringify(caps.children[0]) === JSON.stringify(foldExpected), 'capsule 外壳：折叠结构与 kernel 的 ticketLabelCapsuleFoldOf 逐字一致（目录段挂让位号、编号尾巴不挂号）')
  const foldSrc = caps.children[0].children || []
  check(foldSrc.length === 2 && foldSrc[0].props['data-fold-priority'] === 12 && foldSrc[1].props.style.flex === 'none', 'capsule 外壳：目录段有让位号 12、编号尾巴 flex: none')

  const empty = ticketBadgeOf(fakeH, { key: '', effortId: DIR })
  check(empty.props.content === '' && empty.children[0].children.length === 0, '空编号：不画字样（不画只有 # 和目录的空徽标）')
  const dflt = ticketBadgeOf(fakeH, { key: '1' })
  check(dflt.tag === FakeTip && dflt.children[0].props.className === 'dsws-idnum', '不传 surface 时按 badge 画（列表行的默认外壳）')
  check(ticketBadgeOf(fakeH, { key: '01', effortId: DIR }).props.content === FULL, '不传 effortId 时按没有目录处理（#01）')

  // ── 二、五个调用点只给身份与外壳，不再自带一份画法 ────────────────────────────────
  const sites: Array<{ file: string; surface: string; why: string }> = [
    { file: 'src/client/views/ListTabRow.ts', surface: "'badge'", why: '列表行' },
    { file: 'src/client/views/IssueDetail.ts', surface: "'badge'", why: '票详情页头' },
    { file: 'src/client/views/MapDetailHead.ts', surface: "'badge'", why: '容器详情页头' },
    { file: 'src/client/views/shared/workRouteTable.ts', surface: "'cell'", why: '在办表首列' },
    { file: 'src/client/statusbar/SessionChainCapsule.ts', surface: "surface: 'pill'", why: '状态栏胶囊单子' },
  ]
  for (const s of sites) {
    const src = sourceText(s.file)
    check(src.indexOf('declare function ticketBadgeOf(') >= 0, s.file + ' 声明了共用组件 ticketBadgeOf（' + s.why + '）')
    check(src.indexOf('ticketBadgeOf(h, {') >= 0, s.file + ' 真的调用了共用组件（' + s.why + '）')
    check(src.indexOf('surface: ' + s.surface.replace('surface: ', '')) >= 0, s.file + ' 用对了外壳 ' + s.surface + '（' + s.why + '）')
    for (const residue of ['ticketLabelNodesOf(', 'ticketLabelCapsuleFoldOf(', 'TICKET_LABEL_MAX_WIDTH', "'85px'"]) {
      check(src.indexOf(residue) < 0, s.file + ' 不再自带画法：源码里没有 ' + residue + '（' + s.why + '）')
    }
  }
  // 主胶囊那一颗是第二种外壳（capsule），同一个调用点里与 pill 并列。
  const capsuleSrc = sourceText('src/client/statusbar/SessionChainCapsule.ts')
  check(capsuleSrc.indexOf("surface: 'capsule'") >= 0, 'SessionChainCapsule.ts 的主胶囊用 capsule 外壳（目录段让位、编号尾巴不缩）')
  check((capsuleSrc.match(/ticketBadgeOf\(h, \{/g) || []).length === 2, 'SessionChainCapsule.ts 的两处徽标（单子药丸 + 主胶囊）都走共用组件')
  // 在办表首列不套自己的 Tip：这一点的反面写法（第二层 Tip 包住号）必须不存在。
  const tableSrc = sourceText('src/client/views/shared/workRouteTable.ts')
  check(tableSrc.indexOf('h(Tip, { content: ticketLabelOf(') < 0 && countTip(fakeH) === 0, '工作路线表首列不另套一层 Tip（悬停由整行 tipContent 负责）')
  check(tableSrc.indexOf('h(Tip, { content: tipContent') >= 0, '工作路线表整行悬停仍在（cell 外壳把悬停交给它）')

  // ── 三、登记：组件进了构建清单、index 拼接标记与叶子清单，且它自己不再引运行时模块 ──────
  const compSrc = sourceText('src/client/views/shared/ticketBadge.ts')
  check(!/(^|\n)\s*import\s/.test(compSrc) && compSrc.indexOf('require(') < 0, '组件文件不写运行时 import/require（构建要把它拼进同一个闭包）')
  check(compSrc.indexOf("'dsws-idnum'") >= 0, '组件文件自己写 dsws-idnum 类名（类名只在这一处出现）')
  check(compSrc.indexOf('data-fold-priority') < 0, '折叠让位仍是 kernel/ticket-label.ts 的事（组件不重写让位号）')
  const buildSrc = sourceText('scripts/build.mts')
  check(buildSrc.indexOf("{ id: 'ticketBadge', file: 'src/client/views/shared/ticketBadge.ts' }") >= 0, 'scripts/build.mts 的 LEAF_MODULES 登记了 ticketBadge')
  const idxSrc = sourceText('src/client/index.ts')
  check(/leaf:ticketBadge \(spliced by build\)/.test(idxSrc), 'src/client/index.ts 有 leaf:ticketBadge 的拼接标记')
  const leavesSrc = sourceText('tests/verify-leaves.ts')
  check(leavesSrc.indexOf("src/client/views/shared/ticketBadge.ts") >= 0, 'tests/verify-leaves.ts 的 LEAVES 登记了 ticketBadge（行数上限与产物新鲜度也覆盖到它）')
  check(kernel.ticketLabelCapsuleFoldOf && typeof kernel.ticketLabelNodesOf === 'function', 'kernel/ticket-label.ts 仍然持有两段与折叠两份规则（本票没搬走它们）')

  // ── 四、旧拷贝清零：五处显示点不再自己算上限宽度；类名只由组件写 ─────────────────────
  // 这里按“显示点”而不是“整份文件”判：IssueDetail 里还留着子票/阻塞列表那种更简的
  //   dsws-idnum 手写（只写编号、没有目录段），它不属于票里点名的五处，本票没动它。
  const five = sites.map((s) => s.file).concat(['src/client/statusbar/SessionChainCapsule.ts'])
  const unique = five.filter((f, i) => five.indexOf(f) === i)
  let dupMaxWidth = 0
  for (const file of unique) dupMaxWidth += (sourceText(file).match(/maxWidth:\s*TICKET_LABEL_MAX_WIDTH/g) || []).length
  check(dupMaxWidth === 0, '五处显示点里没有一处再写 maxWidth: TICKET_LABEL_MAX_WIDTH')
  check((compSrc.match(/className: 'dsws-idnum'/g) || []).length === 1, '组件是这套徽标唯一写 dsws-idnum 类名的地方（浅色层与悬停样式靠它命中）')

  if (total === 0) check(false, '一条断言都没跑')
}

main().then(function () {
  console.log('\n共 ' + total + ' 条断言')
  if (failed) { console.log('存在失败'); process.exit(1) }
  console.log('全部通过')
}).catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
