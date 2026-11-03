// tests/verify-1829-page-head.ts —— 门禁：#1829 阶段 4-A 页头与页面骨架原语。
//
// 背景：#1829 阶段 4 把页面壳原来那一行「标题 + 种类 + 层级」换成真正的页头；#1840 按定稿原型
// docs/prototype/vc-redesign/src/ui/views/page-shell.ts 把页头收敛成两段：标题行（返回键 + 标题 + 能力计数）
// 与导语。原型的 pageShell 只有这两段，「种类 / 第 N 层」是早先自造的信息，已删除。本门禁锁住五件事：
//   1) changes 页头：类名、data-vc-page-head、标题与「21 条能力」计数用真词表；只有两段、第二段是导语，没有种类行；
//   2) 返回键只在 back === true 时出现，是 type=button 带 data-vc-back 的真按钮，排在最前面；
//   3) 任务页是流程页、不在 16 页能力账本里，因此不画计数，标题仍是「任务」；管理索引页头同样只有两段；
//   4) 四个原语的结构：section / fold / factGrid / objRow 各一组，含危险标记、空 children、is-mono 与三档色调；
//   5) 样式叶子覆盖全部冻结类名，规则都以 [data-vc-shell] 开头、只用 --vcs-* 令牌；460 / 520 的分列由
//      auto-fit minmax 基规则按内容宽推出，300 窄档另有一条覆盖规则，遮罩定位也在。
//
// 手法：与 verify-1545 / verify-1829-palette-overlay 同一套——视图叶子按构建口径剥 export 装进 compileFn 求值，
// 跨叶符号（PAGE_COUNTS）用真身从参数注入；词表读生成物，不在这里抄文案。
//
// 门禁归属: src/client/views/versionControl/vcPageHead.ts
// 门禁归属: src/client/views/versionControl/vcPageStyles.ts
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1829-page-head.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.ts'
import { spliceableJs } from './lib/source-text.ts'
import { ensureLocaleData } from './lib/locale-data.ts'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1829-page-head'

let total = 0
let failed = 0
function check(ok: any, msg: string) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}

/** 假 React：与 verify-1545 同一份形状；children 里的数组递归展平，空值丢掉，够本门禁按树检查结构。 */
function makeReact() {
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) {
        if (Array.isArray(k)) { k.forEach(walk); return }
        if (k === null || k === undefined || k === false) return
        kids.push(k)
      }
      walk(Array.prototype.slice.call(arguments, 2))
      if (typeof type === 'function') return { type: type, props: props || {}, children: [type(props || {}, kids[0])] }
      return { type: type, props: props || {}, children: kids }
    },
    useContext: function () { return null },
    useState: function (init: any) { return [typeof init === 'function' ? init() : init, function () {}] },
    useRef: function (init: any) { return { current: init === undefined ? null : init } },
    useEffect: function () { return undefined },
  }
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach(function (n: any) { findAll(n, pred, out) }); return out }
  if (pred(node)) out.push(node)
  if (node.children !== undefined) findAll(node.children, pred, out)
  return out
}

function textOf(node: any): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return textOf(node.children)
  return ''
}

function clsOf(node: any): string {
  return String((node && node.props && node.props.className) || '')
}

function classHas(node: any, name: string): boolean {
  return clsOf(node).split(/\s+/).indexOf(name) >= 0
}

function pick(root: any, cls: string): any {
  return findAll(root, function (n: any) { return classHas(n, cls) })[0]
}

async function main() {
  console.log('#1829 阶段 4-A / #1840 页头与页面骨架原语：页头两段、返回键条件、任务页无计数、四个原语结构、样式类名')

  // 词表读生成物的真中文，与运行时同一个取词口径：查不到键就回键名本身，占位符按 {name} 替换。
  const localeRel = ensureLocaleData(ROOT)
  const locale: any = await import(pathToFileURL(path.join(ROOT, localeRel)).href)
  const zh = locale.LOCALE_COPY && locale.LOCALE_COPY.zh
  if (!zh) throw new Error('读不到生成物 ' + localeRel + ' 的中文词表（LOCALE_COPY.zh）')
  const trZh = function (key: string, params?: any) {
    let text = zh[key] !== undefined ? String(zh[key]) : String(key)
    Object.keys(params || {}).forEach(function (name: string) {
      text = text.split('{' + name + '}').join(String((params || {})[name]))
    })
    return text
  }

  // 跨叶符号用真身：能力账本与页面深度表都由仓库里的真源给，不在门禁里另抄一份。
  const ledger: any = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/capability-ledger.ts')).href)
  const PAGE_COUNTS = ledger.PAGE_COUNTS

  const leafSrc = spliceableJs('src/client/views/versionControl/vcPageHead.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const factory = compileFn(
    ['PAGE_COUNTS'],
    leafSrc + '\nreturn { vcPageHeadNode: vcPageHeadNode, vcPageSectionNode: vcPageSectionNode, vcPageFoldNode: vcPageFoldNode, vcPageFactGridNode: vcPageFactGridNode, vcPageObjRowNode: vcPageObjRowNode };',
  )
  const leaf: any = factory(PAGE_COUNTS)
  const h = makeReact().createElement

  // ===== A changes 页头：两段结构、标题与计数用真词表、导语非空 =====
  const head = leaf.vcPageHeadNode(h, trZh, { page: 'changes' })
  check(!!head && head.type === 'div' && clsOf(head) === 'vcs-page-meta vcs-page-head', 'A1 页头是 div.vcs-page-meta.vcs-page-head（类名契约，老门禁按 vcs-page-meta 找它）')
  check(!!head && head.props['data-vc-page-head'] === 'changes', 'A2 页头带 data-vc-page-head=页面 id（实得 ' + String(head && head.props['data-vc-page-head']) + '）')
  const headKids: any[] = (head && Array.isArray(head.children)) ? head.children : []
  check(headKids.length === 2, 'A3 页头恰好两段：标题行、导语（实得 ' + headKids.length + ' 段）')
  const row = headKids[0]
  check(!!row && row.type === 'div' && clsOf(row) === 'vcs-page-title-row', 'A4 第一段是 div.vcs-page-title-row')
  const rowKids: any[] = (row && Array.isArray(row.children)) ? row.children : []
  check(rowKids.length === 2, 'A5 没要返回键时标题行只有标题与计数两个子节点（实得 ' + rowKids.length + ' 个）')
  const title = rowKids[0]
  check(!!title && title.type === 'h2' && classHas(title, 'vcs-page-title'), 'A6 标题是 h2.vcs-page-title（类名必须保留）')
  check(textOf(title) === trZh('vc.shell.page.changes'), 'A7 标题文字用真词表 vc.shell.page.changes（实得「' + textOf(title) + '」）')
  const count = rowKids[1]
  const expectedCount = trZh('vc.shell.page.caps', { n: PAGE_COUNTS.changes })
  check(!!count && classHas(count, 'vcs-page-count') && count.type === 'span', 'A8 计数是 span.vcs-page-count')
  check(textOf(count) === expectedCount && expectedCount === '21 条能力', 'A9 计数写「21 条能力」（从账本取数，实得「' + textOf(count) + '」）')
  check(findAll(head, function (n: any) { return n.props && n.props['data-vc-back'] !== undefined }).length === 0, 'A10 没要返回键时整棵树里没有 data-vc-back')
  const lede = headKids[1]
  check(!!lede && lede.type === 'p' && clsOf(lede) === 'vcs-page-lede', 'A11 第二段是 p.vcs-page-lede（原型 pageShell 只有标题行与导语两段）')
  const ledeText = textOf(lede)
  check(ledeText !== '' && ledeText !== 'vc.shell.page.note.changes' && ledeText.length >= 8, 'A12 导语非空、不是键名本身（实得「' + ledeText.slice(0, 30) + '…」）')
  check(findAll(head, function (n: any) { return classHas(n, 'vcs-page-sub') || classHas(n, 'vcs-page-kind') || classHas(n, 'vcs-page-depth') }).length === 0, 'A13 页头里不再有「种类 / 层级」那一行（#1840 按原型删掉的自造信息）')

  // ===== B 返回键：只在 back === true 时出现，是 type=button 的真按钮，排在标题之前 =====
  const withBack = leaf.vcPageHeadNode(h, trZh, { page: 'changes', back: true })
  const backBtns = findAll(withBack, function (n: any) { return n.props && n.props['data-vc-back'] === '1' })
  check(backBtns.length === 1, 'B1 back === true 时恰好一个返回键（实得 ' + backBtns.length + ' 个）')
  const back = backBtns[0]
  check(!!back && back.type === 'button' && back.props.type === 'button', 'B2 返回键画成 button，type=button（不是链接、不是假按钮）')
  check(!!back && textOf(back) === trZh('vc.shell.page.back'), 'B3 返回键文字用真词表 vc.shell.page.back（实得「' + textOf(back) + '」）')
  const backRow: any[] = (withBack && withBack.children && Array.isArray(withBack.children[0].children)) ? withBack.children[0].children : []
  check(backRow.length === 3 && backRow[0] === back, 'B4 返回键排在标题之前，标题行因此有三个子节点')
  const backFalse = leaf.vcPageHeadNode(h, trZh, { page: 'changes', back: false })
  check(findAll(backFalse, function (n: any) { return n.props && n.props['data-vc-back'] !== undefined }).length === 0, 'B5 back 不是 true（false / 缺省）时不画返回键')
  // 顶栏返回键退役后，页头返回键是唯一生产 vc.changes.back / vc.commit.back 的地方（#1840 评审）：
  //   这里读渲染结果确认 data-log 真的落在返回键上，不能只靠源码里出现过常量字符串。
  const withLog = leaf.vcPageHeadNode(h, trZh, { page: 'changes', back: true, backLog: 'vc.changes.back' })
  const logBack = findAll(withLog, function (n: any) { return n.props && n.props['data-vc-back'] === '1' })[0]
  check(!!logBack && logBack.props['data-log'] === 'vc.changes.back' && logBack.props['data-press'] === 'button', 'B6 调用方给 backLog 时返回键挂同一词条的 data-log 与 data-press=button（实得 ' + String(logBack && logBack.props['data-log']) + '）')
  check(!back || back.props['data-log'] === undefined, 'B7 没给 backLog 时返回键不挂空的 data-log（独立渲染页头不产生假事件）')

  // ===== C 任务页：流程页、不在 16 页能力账本里，不画计数 =====
  const task = leaf.vcPageHeadNode(h, trZh, { page: 'task' })
  check(findAll(task, function (n: any) { return classHas(n, 'vcs-page-count') }).length === 0, 'C1 任务页不画能力计数（PAGE_COUNTS 里没有 task）')
  check(textOf(pick(task, 'vcs-page-title')) === trZh('vc.shell.page.task'), 'C2 任务页标题仍是「任务」（实得「' + textOf(pick(task, 'vcs-page-title')) + '」）')
  check(findAll(task, function (n: any) { return classHas(n, 'vcs-page-kind') || classHas(n, 'vcs-page-depth') }).length === 0, 'C3 任务页也走两段页头：不画种类与层级，不会留一行空壳')
  check(textOf(pick(task, 'vcs-page-lede')) === trZh('vc.shell.page.note.task'), 'C4 任务页导语用 vc.shell.page.note.task（实得「' + textOf(pick(task, 'vcs-page-lede')).slice(0, 24) + '…」）')
  // 管理索引不在能力账本、没有种类（#1840）：页头与别的页一样是两段；早先传 hideSub 才收起的空行现在结构上就不存在。
  const idxHead = leaf.vcPageHeadNode(h, trZh, { page: 'manage' })
  const idxKids: any[] = (idxHead && Array.isArray(idxHead.children)) ? idxHead.children : []
  check(idxKids.length === 2 && pick(idxHead, 'vcs-page-sub') === undefined && textOf(pick(idxHead, 'vcs-page-lede')) === trZh('vc.shell.page.note.manage'), 'C5 管理索引页头同样只有两段：没有空的种类/层级行，标题行之外只有那条管理索引导语（实得 ' + idxKids.length + ' 段）')

  // ===== D 分区原语：section.page-section，危险区加 is-danger 与 data 标记，标题行给条数与危险提示 =====
  const sec = leaf.vcPageSectionNode(h, trZh, {
    title: 'vc.shell.page.changes', count: 3, danger: true, note: 'vc.shell.page.empty',
    children: [h('span', { key: 'a' }, '一'), h('span', { key: 'b' }, '二')],
  })
  check(!!sec && sec.type === 'section' && clsOf(sec) === 'page-section is-danger', 'D1 危险分区是 section.page-section.is-danger（实得「' + clsOf(sec) + '」）')
  check(!!sec && sec.props['data-vc-danger-section'] === '1', 'D2 危险分区带 data-vc-danger-section=1')
  const secHead = pick(sec, 'section-head')
  check(!!secHead && secHead.type === 'div', 'D3 标题行是 div.section-head')
  check(textOf(pick(sec, 'section-title')) === trZh('vc.shell.page.changes'), 'D4 分区标题用真词条（实得「' + textOf(pick(sec, 'section-title')) + '」）')
  check(textOf(pick(sec, 'section-count')) === '3', 'D5 分区条数是 span.section-count（实得「' + textOf(pick(sec, 'section-count')) + '」）')
  check(textOf(pick(sec, 'section-danger')) === trZh('vc.shell.page.danger'), 'D6 危险提示是 span.section-danger，文字来自 vc.shell.page.danger（实得「' + textOf(pick(sec, 'section-danger')) + '」）')
  check(textOf(pick(sec, 'section-note')) === trZh('vc.shell.page.empty'), 'D7 说明段是 p.section-note（实得「' + textOf(pick(sec, 'section-note')) + '」）')
  check(findAll(sec, function (n: any) { return n.type === 'span' && (textOf(n) === '一' || textOf(n) === '二') }).length === 2, 'D8 children 数组原样画进分区')
  const plainSec = leaf.vcPageSectionNode(h, trZh, { title: 'vc.shell.page.commits', children: h('span', { key: 'only' }, '单') })
  check(clsOf(plainSec) === 'page-section' && plainSec.props['data-vc-danger-section'] === undefined, 'D9 非危险分区只有 page-section 类，不带危险标记')
  check(findAll(plainSec, function (n: any) { return classHas(n, 'section-note') }).length === 0, 'D10 没给说明时不画空的 section-note')
  check(findAll(plainSec, function (n: any) { return n.type === 'span' && textOf(n) === '单' }).length === 1, 'D11 children 给单个节点也能画出来')

  // ===== E 折叠段原语：details.fold + data-vc-page-fold，open 只在 true 时写，fold-body 始终在 =====
  const fold = leaf.vcPageFoldNode(h, trZh, {
    key: 'ops', open: true, title: 'vc.shell.page.changes', count: 2, note: 'vc.shell.page.empty',
    children: h('div', { key: 'one' }, '一格'),
  })
  check(!!fold && fold.type === 'details' && clsOf(fold) === 'fold' && fold.props['data-vc-page-fold'] === 'ops', 'E1 折叠段是 details.fold 带 data-vc-page-fold=ops（实得「' + clsOf(fold) + '」）')
  check(fold.props.open === 'open', 'E2 open === true 时带 open 属性（实得 ' + String(fold.props.open) + '）')
  const summary = fold.children[0]
  check(!!summary && summary.type === 'summary' && clsOf(summary) === 'fold-head', 'E3 第一段是 summary.fold-head')
  check(textOf(pick(fold, 'fold-title')) === trZh('vc.shell.page.changes'), 'E4 折叠段标题用真词条（实得「' + textOf(pick(fold, 'fold-title')) + '」）')
  check(textOf(pick(fold, 'fold-count')) === '2', 'E5 折叠段条数是 span.fold-count（实得「' + textOf(pick(fold, 'fold-count')) + '」）')
  check(textOf(pick(fold, 'fold-note')) === trZh('vc.shell.page.empty'), 'E6 说明段是 p.fold-note（实得「' + textOf(pick(fold, 'fold-note')) + '」）')
  const foldBody = pick(fold, 'fold-body')
  check(!!foldBody && foldBody.type === 'div' && findAll(foldBody, function (n: any) { return textOf(n) === '一格' }).length >= 1, 'E7 正文在 div.fold-body 里')
  const closed = leaf.vcPageFoldNode(h, trZh, { key: 'closed' })
  check(closed.props.open === undefined, 'E8 不传 open（或给 false）时不写 open 属性，默认收起')
  const closedBody = pick(closed, 'fold-body')
  check(!!closedBody && closedBody.type === 'div' && Array.isArray(closedBody.children) && closedBody.children.length === 0, 'E9 没有 children 时 fold-body 仍画出来，里面为空')

  // ===== F 事实网格原语：dl.fact-grid，每格 dt.fact-key + dd.fact-value，值按 mono 与三档色调加类 =====
  const grid = leaf.vcPageFactGridNode(h, trZh, {
    facts: [
      { key: 'vc.shell.page.changes', value: '21', mono: true, tone: 'warn' },
      { key: 'vc.shell.page.commits', value: '10', tone: 'muted' },
      { key: 'vc.shell.page.stash', value: '待定', tone: 'error' },
    ],
  })
  check(!!grid && grid.type === 'dl' && clsOf(grid) === 'fact-grid', 'F1 事实网格是 dl.fact-grid')
  const cells: any[] = (grid && Array.isArray(grid.children)) ? grid.children : []
  check(cells.length === 3 && cells.every(function (c: any) { return c.type === 'div' && classHas(c, 'fact-cell') }), 'F2 每项一格 div.fact-cell（实得 ' + cells.length + ' 格）')
  const cell0Kids: any[] = cells[0] ? cells[0].children : []
  check(!!cell0Kids[0] && cell0Kids[0].type === 'dt' && classHas(cell0Kids[0], 'fact-key') && textOf(cell0Kids[0]) === trZh('vc.shell.page.changes'), 'F3 每格先 dt.fact-key（文字用真词条，实得「' + textOf(cell0Kids[0]) + '」）')
  check(!!cell0Kids[1] && cell0Kids[1].type === 'dd' && classHas(cell0Kids[1], 'fact-value') && textOf(cell0Kids[1]) === '21', 'F4 再 dd.fact-value，值原样输出（实得「' + textOf(cell0Kids[1]) + '」）')
  check(!!cell0Kids[1] && classHas(cell0Kids[1], 'is-mono') && classHas(cell0Kids[1], 'is-warn'), 'F5 mono 加 is-mono、tone=warn 加 is-warn（实得「' + clsOf(cell0Kids[1]) + '」）')
  const dd1: any = cells[1] ? cells[1].children[1] : null
  check(!!dd1 && classHas(dd1, 'is-muted') && !classHas(dd1, 'is-mono'), 'F6 tone=muted 加 is-muted，没要等宽时没有 is-mono（实得「' + clsOf(dd1) + '」）')
  const dd2: any = cells[2] ? cells[2].children[1] : null
  check(!!dd2 && classHas(dd2, 'is-error'), 'F7 tone=error 加 is-error（实得「' + clsOf(dd2) + '」）')
  const emptyGrid = leaf.vcPageFactGridNode(h, trZh, {})
  check(!!emptyGrid && emptyGrid.type === 'dl' && emptyGrid.children.length === 0, 'F8 没给 facts 时画空的 dl.fact-grid（不抛错）')

  // ===== G 对象行原语：div.obj-row，危险行加 is-danger，左边 obj-main、右边 obj-side =====
  const objRow = leaf.vcPageObjRowNode(h, trZh, {
    danger: true,
    main: h('span', { key: 'm' }, '主体'),
    side: [h('span', { key: 's1' }, '一'), h('span', { key: 's2' }, '二')],
  })
  check(!!objRow && objRow.type === 'div' && clsOf(objRow) === 'obj-row is-danger', 'G1 危险对象行是 div.obj-row.is-danger（实得「' + clsOf(objRow) + '」）')
  const objMain = objRow.children[0]
  const objSide = objRow.children[1]
  check(!!objMain && objMain.type === 'div' && clsOf(objMain) === 'obj-main', 'G2 左边是 div.obj-main')
  check(findAll(objMain, function (n: any) { return n.type === 'span' && textOf(n) === '主体' }).length === 1, 'G3 主体内容画进 obj-main')
  check(!!objSide && objSide.type === 'div' && clsOf(objSide) === 'obj-side', 'G4 右边是 div.obj-side')
  check(findAll(objSide, function (n: any) { return n.type === 'span' }).length === 2, 'G5 side 数组原样画进 obj-side（实得 ' + findAll(objSide, function (n: any) { return n.type === 'span' }).length + ' 个）')
  const plainObj = leaf.vcPageObjRowNode(h, trZh, {})
  check(clsOf(plainObj) === 'obj-row' && plainObj.children.length === 2 && clsOf(plainObj.children[1]) === 'obj-side', 'G6 非危险、没给两侧内容时仍是 obj-row，obj-main 与 obj-side 都在')

  // ===== H 样式叶子：冻结类名齐全、每条规则以 [data-vc-shell] 开头、只用令牌、四档宽与遮罩定位都在 =====
  const styleMod: any = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/vcPageStyles.ts')).href)
  const styleText = String(styleMod.VC_PAGE_STYLE_TEXT || '')
  check(styleText.length > 2000, 'H1 样式文本存在且非空（实得 ' + styleText.length + ' 字符）')
  const frozen = [
    'vcs-page-head', 'vcs-page-title-row', 'vcs-page-back', 'vcs-page-title', 'vcs-page-count', 'vcs-page-lede',
    'page-section', 'section-head', 'section-title', 'section-count', 'section-danger', 'section-note',
    'fold', 'fold-head', 'fold-title', 'fold-count', 'fold-note', 'fold-body',
    'fact-grid', 'fact-cell', 'fact-key', 'fact-value', 'is-mono', 'is-muted', 'is-warn', 'is-error',
    'obj-row', 'obj-main', 'obj-side',
    'vcs-manage-index', 'vcs-manage-card', 'vcs-manage-card-title', 'vcs-manage-card-count', 'vcs-manage-card-go',
    'vcs-palette-backdrop', 'vcs-pal-panel', 'vcs-pal-foot', 'vcs-pal-close',
    'vcs-branch-head', 'vcs-branch-title', 'vcs-branch-facts', 'vcs-branch-close',
  ]
  const missing = frozen.filter(function (name: string) { return styleText.indexOf('.' + name) < 0 })
  check(missing.length === 0, 'H2 冻结类名全部出现在样式里（缺 ' + missing.join(',') + '）')
  const ruleLines = styleText.split('\n').map(function (s: string) { return s.trim() }).filter(function (s: string) { return s !== '' && s.indexOf('/*') !== 0 })
  check(ruleLines.length > 0 && ruleLines.every(function (s: string) { return s.indexOf('[data-vc-shell]') === 0 }), 'H3 每条规则都以 [data-vc-shell] 开头（实得 ' + ruleLines.length + ' 条）')
  check(ruleLines.every(function (s: string) { return s.charAt(s.length - 1) === '}' }), 'H4 每条规则都以右花括号收尾（没有半截规则）')
  check(!/#[0-9a-fA-F]{3,8}\b/.test(styleText) && !/rgba?\(/.test(styleText), 'H5 颜色只用 --vcs-* 令牌，没有硬编码色值（浅色皮肤只换令牌）')
  check(styleText.indexOf('[data-vc-shell]{position:relative}') >= 0, 'H6 根节点补了 position:relative 供遮罩定位')
  check(/\.vcs-palette-backdrop\{[^}]*position:absolute/.test(styleText) && /inset:0/.test(styleText), 'H7 命令面板遮罩贴根铺满（position:absolute + inset:0）')
  check(/\.vcs-manage-index \.vcs-gear-list\{[^}]*display:grid/.test(styleText), 'H8 管理索引的齿轮列表改成网格')
  // 九张卡是 auto-fit 网格（#1840）：460 两列、520 三列都由这条基规则按内容宽自然得到，
  //   不写死宽度选择器——写死一份宽度表就多一处会漂的第二真源。
  check(/\.vcs-manage-index \.vcs-gear-list\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(148px,1fr\)\)/.test(styleText), 'H9 管理卡网格按原型 auto-fit minmax(148px,1fr)：宽度变化自己分列，不另写 460/520 规则')
  // 由基规则按内容宽推列数：正文左右各 12px 内边距（300 档 10px），列间 gap 7px，每列至少 148px。
  const columnsOf = function (panelWidth: number) {
    const min = 148, gap = 7
    let n = 1
    while ((n + 1) * min + n * gap <= panelWidth) n += 1
    return n
  }
  const contentWidth = function (w: number) { return w - (w <= 300 ? 20 : 24) }
  check(columnsOf(contentWidth(460)) === 2, 'H10 460 宽管理索引按基规则排两列（内容宽 ' + contentWidth(460) + '，实得 ' + columnsOf(contentWidth(460)) + ' 列）')
  check(columnsOf(contentWidth(520)) === 3, 'H11 520 宽管理索引按基规则排三列（内容宽 ' + contentWidth(520) + '，实得 ' + columnsOf(contentWidth(520)) + ' 列）')
  // 300 档按原型 @container panel max-width:359px 收成单列；380 与 460/520 由基规则得到列数，不另写宽度表。
  check(/\[data-vc-width="300"\] \.vcs-manage-index \.vcs-gear-list\{grid-template-columns:minmax\(0,1fr\)\}/.test(styleText), 'H12 300 宽管理索引收成单列（原型窄档规则）')
  check(/\[data-vc-width="300"\] \.vcs-page-back-label\{display:none\}/.test(styleText), 'H13 300 宽返回键只留图标（原型 max-width:339px 的规则，导航入口不删）')
  // #1840 评审：本区能力条数是九张卡片的必带信息，300 基准图里每张卡都写着「13 条能力 · 打开」，
  //   300 宽只能收次要信息（层级、分支事实），不能把条数藏掉；「打开」也要靠 margin-left:auto 留在右端。
  check(!/\[data-vc-width="300"\] \.vcs-manage-card-count\{display:none\}/.test(styleText) && /\.vcs-manage-card-go\{[^}]*margin-left:auto/.test(styleText), 'H14 300 宽仍显示管理卡片条数，「打开」靠 margin-left:auto 留在卡片右端')
  check(/\.fact-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(150px,1fr\)\)/.test(styleText), 'H15 事实网格按原型 auto-fit minmax(150px,1fr)：容器宽了自己分列')
  check(/\[data-vc-width="300"\] \.fact-grid\{grid-template-columns:minmax\(0,1fr\)\}/.test(styleText), 'H16 300 宽事实网格收成一列（原型 @359 规则）')
  check(/overflow-wrap:anywhere/.test(styleText), 'H17 长文字允许在词内换行（窄档不横向溢出）')
  // 管理卡与两条跨区入口是真按钮：全局按钮规则（单行省略）会把整句覆盖口径裁掉，
  // 真机 300/460/520 三档都拍到裁在卡片右边框上。这里守这两条覆盖规则不被顺手删掉。
  check(/\.vcs-manage-card\{[^}]*white-space:normal/.test(styleText), 'H18 管理卡按钮允许换行（覆盖全局按钮的单行省略，覆盖口径不被裁掉）')
  check(/\.vcs-manage-shortcut\{[^}]*white-space:normal/.test(styleText), 'H19 两条跨区入口按钮允许换行（命令面板与全库搜索的整句说明）')

  console.log('\n共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  if (failed > 0) console.log('存在失败（共 ' + total + ' 项）')
  else console.log('全部通过（共 ' + total + ' 项）')
  printGateResult(GATE, total, failed)
  if (failed > 0) process.exitCode = 1
}

main().catch(function (e: any) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  printGateResult(GATE, total, failed)
  process.exitCode = 1
})
