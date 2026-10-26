// tests/verify-1565-workroute-first-col-browser.ts —— 门禁：在办表首列最宽一档等于票号徽标上限，省下的横向空间还给标题列（#1565）。
//
// 这张票修的是两个各写各的数：首列分档封顶原来写 192px，徽标上限是 136px，走到最宽一档时格子白留 56px。
// 现在分档封顶由徽标上限推出（同一个数）。本门禁盯三件事，全部用真 Chromium 量出来的几何，不看源码文本：
//   G1 最宽一档的格子宽 == 徽标上限：格子与徽标等宽，不再白留；同一页面里按改前的 192px 模板再画一份作反证，
//      它必须量出约 56px 的留白 —— 证明这把尺子抓得住这个毛病，不会永远绿。
//   G2 同一面板宽度下，标题列真的变宽、长标题可见的字符真的变多（改前模板 vs 现在模板，同一个容器宽度）。
//   G3 中等长度目录（#notes-inbox/02）仍完整显示，没有被这次收窄误截。
//
// 表格宽度取 644px：浮层最小宽度 680px 按 border-box 扣掉浮层与表块各自的内边距、边框后，表格真正拿到的宽度
// （见 workRouteTable.ts 的 WORK_ROUTE_POPOVER_MIN_WIDTH 与两处 padding/border）。就算宿主按 content-box 算（662px），
// G2 的差值也不变（首列省下的 56px 按 grid 的余量分配规则两列均分，各多 28px），判据不受这点影响。
// 页面里的 DOM 不是重新实现的组件，而是用真源里同一份模板字符串、同一个上限宽度、同一套格子样式拼出来的：
// 模板与上限从 src/client/kernel/ticket-label.ts import，真实组件确实用了这些值，由 verify-1082 的渲染断言盯着。
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
import { withPage, closeBrowser } from './lib/browser-pool.js'

let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 改前的最宽一档（#1565 票面记录的历史值）：只用来做「改前确实白留 56px」的反证与对照，不参与产品逻辑。
const PRE_1565_FIRST_COL_PX = 192
// 浮层与表格块各自的内边距、边框（workRouteTable.ts：浮层 padding 6px 8px / border 1px；表块 padding 6px 8px / border 1px）。
const POPOVER_CHROME_X = 8 * 2 + 1 * 2
const SECTION_CHROME_X = 8 * 2 + 1 * 2
// 长到一定被截的标题：只用来数「标题列里能看见几个字」，内容本身没有含义。
const LONG_TITLE = '把在办表的标题列宽度量出来看看这次改动到底能多显示几个汉字'
// 11px 字下整串约 150px，超过徽标上限：逼出首列最宽一档。
const LONG_EFFORT = 'wayfinder-capability-test'
// 「#notes-inbox/02」按估宽约 117px：中等长度目录，收窄后必须仍完整显示。
const MEDIUM_EFFORT = 'notes-inbox'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function main(): Promise<void> {
  const kernel: any = await import('../src/client/kernel/ticket-label.js')
  const tableLeaf: any = await import('../src/client/views/shared/workRouteTable.js')
  const TICKET_LABEL_MAX_WIDTH: string = kernel.TICKET_LABEL_MAX_WIDTH
  const TICKET_LABEL_MAX_WIDTH_PX: number = kernel.TICKET_LABEL_MAX_WIDTH_PX
  const WORK_ROUTE_FIRST_COL_TIERS_PX: number[] = kernel.WORK_ROUTE_FIRST_COL_TIERS_PX
  const ticketLabelPartsOf = kernel.ticketLabelPartsOf
  const workRouteCellsFor = kernel.workRouteCellsFor
  const POPOVER_MIN_WIDTH: number = tableLeaf.WORK_ROUTE_POPOVER_MIN_WIDTH

  // ── 一、先把「一个数」钉住：最宽一档就是徽标上限，CSS 写法也由它推出来 ──
  check(typeof TICKET_LABEL_MAX_WIDTH_PX === 'number' && TICKET_LABEL_MAX_WIDTH_PX > 0, '徽标上限先是一个像素数（' + TICKET_LABEL_MAX_WIDTH_PX + '）')
  check(TICKET_LABEL_MAX_WIDTH === TICKET_LABEL_MAX_WIDTH_PX + 'px', '徽标上限的 CSS 写法由那个数推出来（' + TICKET_LABEL_MAX_WIDTH + '）')
  check(WORK_ROUTE_FIRST_COL_TIERS_PX[WORK_ROUTE_FIRST_COL_TIERS_PX.length - 1] === TICKET_LABEL_MAX_WIDTH_PX, '首列分档最后一档 = 徽标上限（' + TICKET_LABEL_MAX_WIDTH_PX + 'px，两处同源）')

  // ── 二、拼出两张同构的页面：现在这一版，与改前首列 192px 的对照版 ──
  const newCells = workRouteCellsFor([{ ticketKey: '00', effortId: LONG_EFFORT }])
  const oldCells = newCells.replace(/^\d+px/, PRE_1565_FIRST_COL_PX + 'px')
  check(newCells.split(' ')[0] === TICKET_LABEL_MAX_WIDTH, '长目录那一行的首列档位就是徽标上限（模板：' + newCells + '）')
  check(oldCells !== newCells && oldCells.split(' ')[0] === PRE_1565_FIRST_COL_PX + 'px', '对照版首列换成改前的 ' + PRE_1565_FIRST_COL_PX + 'px（其余列不变）')
  const GRID_WIDTH = POPOVER_MIN_WIDTH - POPOVER_CHROME_X - SECTION_CHROME_X
  const MIN_TABLE_WIDTH = TICKET_LABEL_MAX_WIDTH_PX + 150 + 104 + 48 + 36 + 36 + 5 * 6
  check(GRID_WIDTH >= MIN_TABLE_WIDTH, '浮层最小宽度换算出的表格宽度 ' + GRID_WIDTH + 'px 放得下六列与列间距（至少 ' + MIN_TABLE_WIDTH + 'px，不出横向滚动）')

  function badgeHtml(key: string, effortId: string): string {
    const p = ticketLabelPartsOf(key, effortId)
    return '<span class="badge" style="display:inline-flex;align-items:center;max-width:' + TICKET_LABEL_MAX_WIDTH + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      '<span class="badge-prefix" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto">' + esc(p.prefix) + '</span>' +
      '<span class="badge-number" style="flex:none">' + esc(p.number) + '</span>' +
      '</span>'
  }
  function rowHtml(cells: string, title: string, key: string, effortId: string): string {
    return '<div class="grid" style="grid-template-columns:' + cells + '">' +
      badgeHtml(key, effortId) +
      '<span class="title">' + esc(title) + '</span>' +
      '<span class="cell" style="display:inline-flex;align-items:center;gap:4px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">会话 s-1565</span></span>' +
      '<span class="cell">上报</span>' +
      '<span class="cell">16:50</span>' +
      '<span class="cell">在办</span>' +
      '</div>'
  }
  function stageHtml(id: string, cells: string): string {
    return '<div class="stage" id="' + id + '">' +
      rowHtml(cells, LONG_TITLE, '00', LONG_EFFORT) +
      rowHtml(cells, '中等目录那一行', '02', MEDIUM_EFFORT) +
      '</div>'
  }
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;background:#111;color:#eee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.stage{font-size:11px;margin:8px auto}' +
    '.grid{display:grid;align-items:center;gap:6px;padding:3px 0;width:' + GRID_WIDTH + 'px;font-size:11px}' +
    '.title{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6e6eb}' +
    '.cell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.badge{font-variant-numeric:tabular-nums;color:#e6e6eb}' +
    '</style></head><body>' + stageHtml('stage-new', newCells) + stageHtml('stage-old', oldCells) + '</body></html>'

  // ── 三、真浏览器量：格子宽、徽标宽、标题列宽、可见字符数 ──
  let measured: any = null
  try {
    measured = await withPage({ viewport: { width: 1200, height: 900 } }, async (page: any) => {
      await page.setContent(html)
      return page.evaluate(() => {
        // 一行里能完整落进格子的字符数（单行 nowrap：字符 i 的右缘还在格子内，就算看得见）。
        const visibleChars = (span) => {
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
        const read = (stageId) => {
          const stage = document.getElementById(stageId)
          const rows = Array.from(stage.querySelectorAll('.grid'))
          const longRow = rows[0]
          const mediumRow = rows[1]
          // 轨道宽度读 computedStyle（浏览器算完之后的每一列宽）；格子里的元素可能比轨道窄（徽标带 max-width），
          // 直接量元素会把「列宽」和「内容宽」混成一个数。
          const tracks = String(getComputedStyle(longRow).gridTemplateColumns || '').trim().split(/\s+/).map((v) => parseFloat(v))
          const badge = longRow.querySelector('.badge')
          const longPrefix = badge.querySelector('.badge-prefix')
          const title = longRow.querySelector('.title')
          const mediumBadge = mediumRow.querySelector('.badge')
          const mediumPrefix = mediumBadge.querySelector('.badge-prefix')
          return {
            gridWidth: longRow.getBoundingClientRect().width,
            gridClientWidth: longRow.clientWidth,
            gridScrollWidth: longRow.scrollWidth,
            tracks: tracks,
            badgeWidth: badge.getBoundingClientRect().width,
            longPrefixClientWidth: longPrefix.clientWidth,
            longPrefixScrollWidth: longPrefix.scrollWidth,
            titleWidth: title.getBoundingClientRect().width,
            titleVisible: visibleChars(title),
            titleFullWidth: title.scrollWidth,
            mediumBadgeClientWidth: mediumBadge.clientWidth,
            mediumBadgeScrollWidth: mediumBadge.scrollWidth,
            mediumPrefixClientWidth: mediumPrefix.clientWidth,
            mediumPrefixScrollWidth: mediumPrefix.scrollWidth,
          }
        }
        return { now: read('stage-new'), before: read('stage-old') }
      })
    })
  } finally {
    await closeBrowser()
  }
  const n = measured.now
  const o = measured.before
  const f = (v: any) => Number(v).toFixed(1)

  check(Math.abs(n.gridWidth - GRID_WIDTH) <= 1, '页面量到的表格宽度就是换算出的 ' + GRID_WIDTH + 'px（实得 ' + f(n.gridWidth) + 'px）')
  check(n.gridScrollWidth <= n.gridClientWidth + 1, '六列在浮层最小宽度里放得下，不出横向滚动（scrollWidth ' + f(n.gridScrollWidth) + 'px / clientWidth ' + f(n.gridClientWidth) + 'px）')

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

  // ── G3：中等长度目录仍完整显示 ──
  check(n.mediumPrefixScrollWidth <= n.mediumPrefixClientWidth + 1 && n.mediumBadgeScrollWidth <= n.mediumBadgeClientWidth + 1, 'G3 中等目录「#notes-inbox/02」完整显示，没有被误截（前缀内容 ' + f(n.mediumPrefixScrollWidth) + 'px / 可见 ' + f(n.mediumPrefixClientWidth) + 'px）')
  check(o.mediumPrefixScrollWidth <= o.mediumPrefixClientWidth + 1, 'G3 改前模板下中等目录同样完整显示（对照：这次收窄没有把它挤坏）')

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
