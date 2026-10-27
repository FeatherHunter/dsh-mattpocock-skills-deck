// tests/verify-1565-workroute-first-col-browser.ts —— 门禁：在办表首列最宽一档等于票号徽标上限，省下的横向空间还给标题列（#1565）。
//
// 这张票修的是两个各写各的数：首列分档封顶原来写 192px，徽标上限是 136px，走到最宽一档时格子白留 56px。
// 现在分档封顶由徽标上限推出（同一个数）。本门禁盯三件事，全部用真 Chromium 量出来的几何，不看源码文本：
//   G1 最宽一档的格子宽 == 徽标上限：格子与徽标等宽，不再白留；同一页面里按改前的 192px 模板再画一份作反证，
//      它必须量出约 56px 的留白 —— 证明这把尺子抓得住这个毛病，不会永远绿。
//   G2 同一面板宽度下，标题列真的变宽、长标题可见的字符真的变多（改前模板 vs 现在模板，同一个容器宽度）。
//   G3 中等长度目录（#notes-inbox/02）按新上限走省略号：目录段被裁、`/` 与完整编号仍可见，
//      没有被这次收窄误截掉编号。
//
// 页面是怎么来的（这一节是这门禁的立身之本，改之前先读一遍）：
//   不是手抄一份 CSS 再量自己抄的东西，而是把 src/client/views/shared/workRouteTable.ts 按构建同一做法求值，
//   用假 React 把**真的 WorkRouteTable 组件**画成一棵对象树，再按树里真实的 props.style、真实的列宽模板、
//   真实的表头与行结构序列化成 HTML，交给 Chromium 量。真组件把 gap 从 6 改成 8、把格子内边距改掉，
//   这里量的就是改之后的样式 —— 门禁跟着真源走，不会自己骗自己。
//   词表也用真的（kernel/locale-pages 的 zh），否则动作词画成一长串键名会把行挤出横向滚动，
//   量出来的不是产品里的样子。
//
// 表格内容宽为什么是 662px：宿主默认 box-sizing 是 content-box（src/client/views/SubworkspaceMark.ts 的注释
// 记着这一条，胶囊那类要改 border-box 的控件都得显式写），浮层最小宽度 680px 是内容宽，表块（section）是它的
// 块级子元素，宽度 680，再减掉表块自己的内边距 8×2 与边框 1×2 得到 662px。内边距与边框这两笔从真组件画出来的
// section.props.style 里解析，不另抄数字。
//
// 门禁归属: src/client/kernel/ticket-label.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
//
// 依赖：playwright（含 chromium）—— 全部判据都是真浏览器量出来的几何。这一行也让 fast 档按
// 「门禁正文里出现 playwright」认出本门禁是真浏览器门禁并跳过它（脚本见 scripts/verify-parallel.mts 的 isBrowserStep）。
//
// 用法（在插件根目录）：
//   node --import ./scripts/ts-hook.mts tests/verify-1565-workroute-first-col-browser.ts
// 要跳过真浏览器门禁用 npm run verify:fast（那一档不含本门禁）。
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourcePath } from './lib/source-text.ts'
import { withPage, closeBrowser } from './lib/browser-pool.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 改前的最宽一档（#1565 票面记录的历史值）：只用来做「改前确实白留 56px」的反证与对照，不参与产品逻辑。
const PRE_1565_FIRST_COL_PX = 192
// 长到一定被截的标题：只用来数「标题列里能看见几个字」，内容本身没有含义。
const LONG_TITLE = '把在办表的标题列宽度量出来看看这次改动到底能多显示几个汉字'
// 11px 字下整串约 150px，超过徽标上限：逼出首列最宽一档。
const LONG_EFFORT = 'wayfinder-capability-test'
// 「#notes-inbox/02」按估宽约 117px：超过新上限 85px，走目录省略号，`/` 与编号完整保留（#1579）。
const MEDIUM_EFFORT = 'notes-inbox'

function esc(s: any): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 最小的假 React：只搭对象树，不碰 DOM。与 verify-1082 同一做法（那一份还多了 useState/useEffect 的假身，
 * 本门禁只画一次静态表，用不到）。组件用 React.createElement 画时，函数组件按真 React 的调用方式调一次。
 */
function makeReact(): any {
  let refIndex = 0
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) { if (Array.isArray(k)) { k.forEach(walk); return } if (k === null || k === undefined || k === false) return; kids.push(k) }
      walk(Array.prototype.slice.call(arguments, 2))
      if (typeof type === 'function') return { type: type, props: props || {}, children: [type(props || {}, kids[0])] }
      return { type: type, props: props || {}, children: kids }
    },
    useContext: function () { return null },
    useState: function (init: any) { return [typeof init === 'function' ? init() : init, function () {}] },
    useRef: function (init: any) { refIndex += 1; return { current: init === undefined ? null : init } },
    useEffect: function () { return undefined },
  }
}

/** 在对象树里按条件找节点（含 children 递归）。 */
function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n: any) => findAll(n, pred, out)); return out }
  if (pred(node)) out.push(node)
  if (node.children) findAll(node.children, pred, out)
  return out
}

// 数字样式要补 px 的属性之外，还有这些数字本来就无单位（抄少了会把 flex: '1 1 auto' 这类字符串也补成 px，故只认数字）。
const UNITLESS = new Set(['flexGrow', 'flexShrink', 'opacity', 'zIndex', 'lineHeight', 'fontWeight', 'order', 'gridRow', 'gridColumn', 'aspectRatio'])

/** 把 React 的 style 对象写成 CSS 文本（camelCase → kebab-case，数字补 px）。 */
function cssOf(style: any): string {
  return Object.keys(style).map(function (k) {
    const prop = k.replace(/[A-Z]/g, function (m: string) { return '-' + m.toLowerCase() })
    const v = style[k]
    const val = (typeof v === 'number' && !UNITLESS.has(k)) ? v + 'px' : String(v)
    return prop + ':' + val
  }).join(';')
}

/**
 * 把假 React 树按真实 props.style 写成 HTML。
 *
 * Tip / Portal 是包裹层，拆掉只留它包着的真 DOM 子树；Icon 是个空图标，写一个空 span 占位。
 * gridTemplateOverride 只在「按改前 192px 重画对照版」时传入：把每一处真实模板的首列换掉，其余原样。
 */
function htmlOf(node: any, realCells: string, gridTemplateOverride: string | null): string {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (typeof node === 'function') return ''
  if (Array.isArray(node)) return node.map(function (n: any) { return htmlOf(n, realCells, gridTemplateOverride) }).join('')
  if (typeof node.type === 'function') return htmlOf(node.children, realCells, gridTemplateOverride)
  if (node.type === 'Tip' || node.type === 'Portal') return htmlOf(node.children, realCells, gridTemplateOverride)
  if (node.type === 'Icon') return '<span></span>'
  const props = node.props || {}
  const style = props.style ? Object.assign({}, props.style) : null
  if (style && style.gridTemplateColumns === realCells && gridTemplateOverride) style.gridTemplateColumns = gridTemplateOverride
  const attrs: string[] = []
  if (style) attrs.push('style="' + cssOf(style) + '"')
  if (props.className) attrs.push('class="' + esc(props.className) + '"')
  for (const k of Object.keys(props)) {
    if (k.indexOf('data-') === 0 || k === 'aria-label' || k === 'role') attrs.push(k + '="' + esc(props[k]) + '"')
  }
  return '<' + node.type + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + htmlOf(node.children, realCells, gridTemplateOverride) + '</' + node.type + '>'
}

/** 横向内边距之和（真样式里的 padding 简写，如 '6px 8px' → 16）。 */
function horizontalPaddingOf(padding: any): number {
  const parts = String(padding || '').trim().split(/\s+/).map(parseFloat)
  if (!parts.length || !isFinite(parts[0])) return 0
  const x = parts.length >= 2 ? parts[1] : parts[0]
  return isFinite(x) ? x * 2 : 0
}

/** 横向边框之和（真样式里的 border 简写，如 '1px solid ...' → 2）。 */
function horizontalBorderOf(border: any): number {
  const first = parseFloat(String(border || ''))
  return isFinite(first) ? first * 2 : 0
}

/** 一份列宽模板在不被拉伸时的最小宽度：各列下限（固定列就是它本身）之和 + 列间距。 */
function minWidthOfCells(cells: string, gap: number, trackCount: number): number {
  const parts = String(cells).match(/minmax\([^)]*\)|\S+/g) || []
  let w = 0
  for (const t of parts) {
    const mm = /^minmax\((\d+)px\s*,/.exec(t)
    const fx = /^(\d+)px$/.exec(t)
    if (mm) w += Number(mm[1])
    else if (fx) w += Number(fx[1])
    else return -1
  }
  return w + (trackCount - 1) * gap
}

async function main(): Promise<void> {
  const kernel: any = await import('../src/client/kernel/ticket-label.js')
  const tableLeaf: any = await import('../src/client/views/shared/workRouteTable.js')
  const TICKET_LABEL_MAX_WIDTH: string = kernel.TICKET_LABEL_MAX_WIDTH
  const TICKET_LABEL_MAX_WIDTH_PX: number = kernel.TICKET_LABEL_MAX_WIDTH_PX
  const WORK_ROUTE_FIRST_COL_TIERS_PX: readonly number[] = kernel.WORK_ROUTE_FIRST_COL_TIERS_PX
  const POPOVER_MIN_WIDTH: number = tableLeaf.WORK_ROUTE_POPOVER_MIN_WIDTH

  // ── 一、先把「一个数」钉住：最宽一档就是徽标上限，CSS 写法也由它推出来 ──
  check(typeof TICKET_LABEL_MAX_WIDTH_PX === 'number' && TICKET_LABEL_MAX_WIDTH_PX > 0, '徽标上限先是一个像素数（' + TICKET_LABEL_MAX_WIDTH_PX + '）')
  check(TICKET_LABEL_MAX_WIDTH === TICKET_LABEL_MAX_WIDTH_PX + 'px', '徽标上限的 CSS 写法由那个数推出来（' + TICKET_LABEL_MAX_WIDTH + '）')
  check(WORK_ROUTE_FIRST_COL_TIERS_PX[WORK_ROUTE_FIRST_COL_TIERS_PX.length - 1] === TICKET_LABEL_MAX_WIDTH_PX, '首列分档最后一档 = 徽标上限（' + TICKET_LABEL_MAX_WIDTH_PX + 'px，两处同源）')
  check(TICKET_LABEL_MAX_WIDTH_PX < PRE_1565_FIRST_COL_PX, '反证成立的前提：现在的最宽一档比改前的 ' + PRE_1565_FIRST_COL_PX + 'px 窄（否则「白留 56px」的对照组不成立）')

  // ── 二、把真组件画出来（假 React、真源码、真词表），样式与列宽模板都从这棵树上取 ──
  const pagesUrl = sourcePath('src/client/kernel/locale-pages.js')
  const zh: any = (await import(pathToFileURL(path.join(ROOT, pagesUrl)).href) as any).L_PAGES.zh
  const tr = function (k: string, p?: any): string {
    let s = zh[k] !== undefined ? zh[k] : String(k)
    Object.keys(p || {}).forEach(function (key: string) { s = s.split('{' + key + '}').join(String(p[key])) })
    return s
  }
  ;(globalThis as any).ticketLabelOf = kernel.ticketLabelOf
  ;(globalThis as any).ticketLabelNodesOf = kernel.ticketLabelNodesOf
  ;(globalThis as any).TICKET_LABEL_MAX_WIDTH = TICKET_LABEL_MAX_WIDTH
  ;(globalThis as any).workRouteCellsFor = kernel.workRouteCellsFor
  ;(globalThis as any).ownWorkRouteSlotOf = function () { return null }
  ;(globalThis as any).findMapByIdentity = function () { return null }
  ;(globalThis as any).containerKindOf = function () { return '' }
  ;(globalThis as any).pushNav = function () {}
  const leafSrc = spliceableJs('src/client/views/shared/workRouteTable.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const leaf: any = compileFn(['React', 'DswsCtx', 'Tip', 'tr', 'h', 'Ic', 'portalTop', 'DSW_VERSION'], leafSrc + '\nreturn { WorkRouteTable }')(
    makeReact(), null,
    function (props: any, child: any) { return { type: 'Tip', props: props || {}, children: [child] } },
    tr, null,
    function (args: any) { return { type: 'Icon', props: args || {}, children: [] } },
    function (n: any) { return { type: 'Portal', props: {}, children: [n] } },
    '9.9.9-test')

  const at = '2026-10-19T08:00:00.000Z'
  const readout = {
    at: at,
    staleCount: 0,
    entries: [
      { ticketKey: '00', effortId: LONG_EFFORT, title: LONG_TITLE, sessionLabel: '会话 s-1565', action: 'report', actionAt: at, active: true, currentSession: false },
      { ticketKey: '02', effortId: MEDIUM_EFFORT, title: '中等目录那一行', sessionLabel: '会话 s-1565', action: 'report', actionAt: at, active: true, currentSession: false },
    ],
  }
  const tree: any = leaf.WorkRouteTable({ st: { snapshot: { workRouteTable: { ok: true, readout: readout } } } })
  const section: any = findAll(tree, function (n: any) { return n.props && n.props['data-work-route-table'] === 'ok' })[0]
  check(!!section, '真组件画出了 ok 状态的表（不是空态/读不到）')
  const rows: any[] = findAll(section, function (n: any) { return n.props && n.props['data-work-route-row'] === 1 })
  const headNode: any = findAll(section, function (n: any) { return n.props && n.props['data-work-route-head'] === 1 })[0]
  check(rows.length === 2 && !!headNode, '真组件画出了表头与两行数据（实得 ' + rows.length + ' 行）')
  const sectionStyle: any = section.props.style || {}
  const rowStyle: any = rows[0].props.style || {}
  const realCells: string = String(rowStyle.gridTemplateColumns || '')
  check(realCells.split(' ')[0] === TICKET_LABEL_MAX_WIDTH, '真组件算出的首列就是徽标上限（模板：' + realCells + '）')
  check(!!headNode && String(headNode.props.style.gridTemplateColumns) === realCells, '表头与数据行共用同一份模板（列要逐字对齐）')
  const gap: number = Number(rowStyle.gap)
  check(isFinite(gap) && gap > 0, '从真行样式里读出列间距（' + gap + 'px），不另抄数字')
  const sectionChrome = horizontalPaddingOf(sectionStyle.padding) + horizontalBorderOf(sectionStyle.border)
  check(sectionChrome > 0, '从真表块样式里读出左右内边距与边框（' + sectionChrome + 'px）')
  const GRID_WIDTH = POPOVER_MIN_WIDTH - sectionChrome
  check(GRID_WIDTH > TICKET_LABEL_MAX_WIDTH_PX && GRID_WIDTH < POPOVER_MIN_WIDTH, '表格内容宽由浮层最小宽度减去表块两侧的边距推出（' + GRID_WIDTH + 'px）')
  const minTableWidth = minWidthOfCells(realCells, gap, 6)
  check(minTableWidth > 0 && GRID_WIDTH >= minTableWidth, '浮层最小宽度放得下六列的保底与列间距（至少 ' + minTableWidth + 'px，实得 ' + GRID_WIDTH + 'px）')

  // ── 三、拼出两张同构页面：现在这一版，与改前首列 192px 的对照版（其余样式全部来自真组件） ──
  const oldCells = realCells.replace(/^\d+px/, PRE_1565_FIRST_COL_PX + 'px')
  check(oldCells !== realCells && oldCells.split(' ')[0] === PRE_1565_FIRST_COL_PX + 'px', '对照版首列换成改前的 ' + PRE_1565_FIRST_COL_PX + 'px（其余列与样式不变）')
  const stage = function (id: string, cells: string | null): string {
    return '<div class="stage" id="' + id + '" style="width:' + POPOVER_MIN_WIDTH + 'px">' + htmlOf(section, realCells, cells) + '</div>'
  }
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;background:#111;color:#eee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '</style></head><body>' + stage('stage-new', null) + stage('stage-old', oldCells) + '</body></html>'

  // ── 四、真浏览器量：格子宽、徽标宽、标题列宽、可见字符数 ──
  let measured: any = null
  try {
    measured = await withPage({ viewport: { width: 1200, height: 900 } }, async (page: any) => {
      await page.setContent(html)
      return page.evaluate(function () {
        // 一行里能完整落进格子的字符数（单行 nowrap：字符 i 的右缘还在格子内，就算看得见）。
        const visibleChars = function (span: any): number {
          const text = String(span.textContent || '')
          const node = span.firstChild
          if (!node || node.nodeType !== 3) return 0
          const box = span.getBoundingClientRect()
          const range = document.createRange()
          let visible = 0
          for (let i = 1; i <= text.length; i++) {
            range.setStart(node, 0)
            range.setEnd(node, i)
            if (range.getBoundingClientRect().right <= box.right - 0.5) visible = i
            else break
          }
          return visible
        }
        const px = function (v: any): number[] { return String(v || '').trim().split(/\s+/).map(parseFloat) }
        const read = function (stageId: string): any {
          const stage = document.getElementById(stageId)
          const sectionEl = stage.firstElementChild
          const rows = Array.from(stage.querySelectorAll('[data-work-route-row="1"]'))
          const head = stage.querySelector('[data-work-route-head="1"]')
          const wrap = head.parentElement
          const longRow = rows[0]
          const mediumRow = rows[1]
          // 轨道宽度读 computedStyle（浏览器算完之后的每一列宽）；格子里的元素可能比轨道窄（徽标带 max-width），
          // 直接量元素会把「列宽」和「内容宽」混成一个数。
          const tracks = px(getComputedStyle(longRow).gridTemplateColumns)
          const headTracks = px(getComputedStyle(head).gridTemplateColumns)
          const badge = longRow.children[0]
          const longPrefix = badge.children[0]
          const title = longRow.children[1]
          const mediumBadge = mediumRow.children[0]
          const mediumPrefix = mediumBadge.children[0]
          const mediumNumber = mediumBadge.children[1]
          return {
            sectionWidth: sectionEl.getBoundingClientRect().width,
            gridWidth: longRow.getBoundingClientRect().width,
            gridClientWidth: longRow.clientWidth,
            gridScrollWidth: longRow.scrollWidth,
            wrapClientWidth: wrap.clientWidth,
            wrapScrollWidth: wrap.scrollWidth,
            tracks: tracks,
            headTracks: headTracks,
            badgeWidth: badge.getBoundingClientRect().width,
            badgeClientWidth: badge.clientWidth,
            longPrefixClientWidth: longPrefix.clientWidth,
            longPrefixScrollWidth: longPrefix.scrollWidth,
            titleWidth: title.getBoundingClientRect().width,
            titleVisible: visibleChars(title),
            titleFullWidth: title.scrollWidth,
            mediumBadgeClientWidth: mediumBadge.clientWidth,
            mediumBadgeScrollWidth: mediumBadge.scrollWidth,
            mediumPrefixClientWidth: mediumPrefix.clientWidth,
            mediumPrefixScrollWidth: mediumPrefix.scrollWidth,
            mediumNumberText: String((mediumNumber && mediumNumber.textContent) || ''),
            mediumNumberClientWidth: mediumNumber ? mediumNumber.clientWidth : 0,
            mediumNumberScrollWidth: mediumNumber ? mediumNumber.scrollWidth : 0,
          }
        }
        return { now: read('stage-new'), before: read('stage-old') }
      })
    })
  } finally {
    await closeBrowser()
  }
  const n: any = measured.now
  const o: any = measured.before
  const f = function (v: any): string { return Number(v).toFixed(1) }

  check(Math.abs(n.sectionWidth - POPOVER_MIN_WIDTH) <= 1, '表块宽度就是浮层最小宽度 ' + POPOVER_MIN_WIDTH + 'px（宿主默认 content-box，实得 ' + f(n.sectionWidth) + 'px）')
  check(Math.abs(n.gridWidth - GRID_WIDTH) <= 1, '表格内容宽就是算出来的 ' + GRID_WIDTH + 'px（实得 ' + f(n.gridWidth) + 'px）')
  check(JSON.stringify(n.headTracks) === JSON.stringify(n.tracks), '页面里表头与数据行的轨道逐像素相同（表头轨道 ' + n.headTracks.join('/') + '）')
  check(n.wrapScrollWidth <= n.wrapClientWidth + 1, '真词表下整表不出横向滚动（scrollWidth ' + f(n.wrapScrollWidth) + 'px / clientWidth ' + f(n.wrapClientWidth) + 'px）')

  // ── G1：最宽一档的格子宽 == 徽标上限，不再白留 ──
  check(Math.abs(n.tracks[0] - TICKET_LABEL_MAX_WIDTH_PX) <= 0.5, 'G1 最宽一档的格子宽等于徽标上限（实得 ' + f(n.tracks[0]) + 'px）')
  check(Math.abs(n.tracks[0] - n.badgeWidth) <= 0.5, 'G1 格子与徽标等宽，白留消失（格子 ' + f(n.tracks[0]) + 'px / 徽标 ' + f(n.badgeWidth) + 'px）')
  check(n.longPrefixScrollWidth > n.longPrefixClientWidth, 'G1 超长目录确实碰到上限走了省略号（目录段内容 ' + f(n.longPrefixScrollWidth) + 'px > 可见 ' + f(n.longPrefixClientWidth) + 'px）：这条留白断言才有意义')
  // 反证：同一把尺子量改前模板，必须看得见那 56px。
  check(Math.abs(o.tracks[0] - PRE_1565_FIRST_COL_PX) <= 0.5, '反证 改前模板的首列确实是 ' + PRE_1565_FIRST_COL_PX + 'px（实得 ' + f(o.tracks[0]) + 'px）')
  check(o.tracks[0] - o.badgeWidth >= 55, '反证 改前格子比徽标宽出约 56px（实得 ' + f(o.tracks[0] - o.badgeWidth) + 'px）：本门禁量得出这个毛病')

  // ── G2：同一面板宽度下，标题列变宽、长标题可见字符变多 ──
  // 边界：面板越宽，两列按余量一起长；等到标题列到 320px 上限（面板很宽时），省下的空间按 #1553 的口径留在行尾，
  // 那时新旧两边都停在上限、可见字符相同。本门禁取浮层最小宽度，也就是浮层不主动变宽时的常态宽度。
  check(n.tracks[1] >= o.tracks[1] + 20, 'G2 同一面板宽度下标题列变宽（改前 ' + f(o.tracks[1]) + 'px → 现在 ' + f(n.tracks[1]) + 'px）')
  check(n.titleVisible > o.titleVisible, 'G2 长标题可见字符变多（改前 ' + o.titleVisible + ' 个 → 现在 ' + n.titleVisible + ' 个；全宽 ' + f(n.titleFullWidth) + 'px）')
  check(n.tracks[1] > 150 && n.tracks[1] <= 320, 'G2 标题列仍落在 150~320px 的上限区间里（实得 ' + f(n.tracks[1]) + 'px）')

  // ── G3：中等目录按新上限走目录省略，`/` 与完整编号保留 ──
  check(n.mediumPrefixScrollWidth > n.mediumPrefixClientWidth, 'G3 中等目录「#notes-inbox/02」目录段走省略号（内容 ' + f(n.mediumPrefixScrollWidth) + 'px > 可见 ' + f(n.mediumPrefixClientWidth) + 'px）')
  check(n.mediumNumberText === '/02', 'G3 `/编号` 段文字完整（实得 ' + JSON.stringify(n.mediumNumberText) + '）')
  check(n.mediumNumberScrollWidth <= n.mediumNumberClientWidth + 1, 'G3 `/编号` 段没有被裁掉（内容 ' + f(n.mediumNumberScrollWidth) + 'px / 可见 ' + f(n.mediumNumberClientWidth) + 'px）')
  check(o.mediumPrefixScrollWidth > o.mediumPrefixClientWidth, 'G3 改前模板（首列 192px）下中等目录同样走省略号（内容 ' + f(o.mediumPrefixScrollWidth) + 'px > 可见 ' + f(o.mediumPrefixClientWidth) + 'px）：省略出自徽标全局上限 85px，不是这次收窄挤坏的')

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
