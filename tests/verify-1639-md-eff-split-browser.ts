// tests/verify-1639-md-eff-split-browser.ts —— 门禁：#1639 md目录签在行尾切成两半（真 Chromium 量分片）与目录名文字上限。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1639-md-eff-split-browser.ts
//
// 为什么要真浏览器：这件事的判据是「排布」——同一颗胶囊在第一行尾被切成两片、第二片接在第二行头、
//   每片只有一行高。jsdom 没有排版引擎（getClientRects 恒为空、getBoundingClientRect 全是 0），
//   源码文本比对也拦不住「写法看着像、实际整颗换行」的回归，#1596 就是这么漏过去的。
//   所以这里把真组件画出来的 HTML 交给 Chromium，用 getClientRects 数分片、用逐字 Range 拼回名字。
//
// 门禁锁的是维护者拍板的那三条（#1639）：
//   1. 行尾放不下就在字与字之间切断：长目录签至少两片，第一片从第一行行尾开始，而不是整颗挪到第二行。
//   2. 不许在胶囊内部折行：每一片最多一行高（约 18px，留到 24px 判定），不能是 30px 往上的高块。
//   3. 切口是 slice：第二片从行左贴边接上（第一行尾平切口、第二行头文字贴边），不是两颗半截胶囊。
// 外加维护者新增的文字上限：每颗显示文字不超过 19 个数字字符的宽度，超出时末尾另加一个省略号；
//   省略号不占那 19 个数字的额度，「全部」那颗不受影响，悬停与 aria-label 仍是全名。
//
// 同页还有一份反证：把同一棵树按旧写法（flex 容器 + 每颗 maxWidth 220 + 胶囊内折行）重画一次，
//   它必须被判坏 —— 否则说明判据本身量错了东西（照 tests/verify-capsule-layout.ts 的 G5 做法）。
//
// 门禁归属: src/client/views/mdEffortRow.ts
// 门禁归属: src/client/views/ListTab.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourcePath } from './lib/source-text.ts'
import { withPage, closeBrowser } from './lib/browser-pool.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 列表正文的实际宽度：面板内容宽 460（.dsws-panel 的 width:460px 是内容宽）减去列表正文两侧各 12 像素
// （.dsws-body 的 padding:10px 12px），得 436。这一排就画在这 436 像素里，行尾位置由它决定。
const STAGE_WIDTH = 436
// 这一排只画一行名字的上限；超过就要切两行，所以 stage 高度不设死。
// 长目录名：20 个汉字。按「每个汉字 10 像素」算约 200 像素，远超 19 个数字的宽度（约 100 像素），
// 一定会被截断，也一定比一行放得下的余量长 —— 它就是被切成两半的那一颗。
const LONG_NAME = '这是一个特别长的目录名字用于行尾切断演示'
// 第一行先放这些短目录签，把长签的起点挤到行尾；具体用哪几颗由脚本按量到的字宽算（见 pickFillers）。
const FILLER_POOL = ['甲', '演示乙', '演示丙丁', '演示戊己庚', '演示标签变体一', 'demo-短']

function esc(s: any): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 最小的假 React：只搭对象树，不碰 DOM；函数组件按 createElement 的规矩就地求值一次。 */
function makeReact(): any {
  return {
    createElement: function (type: any, props: any) {
      const kids: any[] = []
      const walk = function (k: any) { if (Array.isArray(k)) { k.forEach(walk); return } if (k === null || k === undefined || k === false) return; kids.push(k) }
      walk(Array.prototype.slice.call(arguments, 2))
      if (typeof type === 'function') return { type: type, props: props || {}, children: [type(props || {}, kids[0])] }
      return { type: type, props: props || {}, children: kids }
    },
  }
}

// 数字样式要补 px 的属性之外，还有这些数字本来就无单位（照 verify-1565 的同一套）。
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
 * 把假 React 树写成 HTML。Tip 是悬停包裹层，拆掉留真子树（真机里 HoverTip 也是 return Fragment(trigger, tip)，
 * DOM 上不包外壳）。legacy=true 时把这一排还原成 #1596 当年的旧写法（flex 容器 + 每颗 maxWidth 220 +
 * 胶囊内折行），用来做同页反证。
 */
function htmlOf(node: any, legacy: boolean): string {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (typeof node === 'function') return ''
  if (Array.isArray(node)) return node.map(function (n: any) { return htmlOf(n, legacy) }).join('')
  if (typeof node.type === 'function') return htmlOf(node.children, legacy)
  if (node.type === 'Tip' || node.type === 'Portal') return htmlOf(node.children, legacy)
  const props = node.props || {}
  let style: any = props.style ? Object.assign({}, props.style) : null
  if (legacy) {
    const isRow = node.type === 'div' && props['data-dsh-md-effort-row']
    const isChip = node.type === 'span' && props['data-log']
    if (isRow) style = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 }
    if (isChip) {
      // 旧写法：整颗是 flex 子项（会被整块化、换行只整颗搬），胶囊内部靠 maxWidth + 折行显示长名字。
      style = Object.assign({}, style)
      delete style.display
      delete style.boxDecorationBreak
      delete style.WebkitBoxDecorationBreak
      delete style.marginRight
      style.maxWidth = 220
      style.whiteSpace = 'normal'
      style.wordBreak = 'break-all'
      style.lineHeight = 1.4
    }
  }
  const attrs: string[] = []
  if (style) attrs.push('style="' + cssOf(style) + '"')
  if (props.className) attrs.push('class="' + esc(props.className) + '"')
  for (const k of Object.keys(props)) {
    if (k.indexOf('data-') === 0 || k === 'aria-label' || k === 'role') attrs.push(k + '="' + esc(props[k]) + '"')
  }
  return '<' + node.type + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + htmlOf(node.children, legacy) + '</' + node.type + '>'
}

/**
 * 在浏览器里读一个 stage 的几何。返回分片矩形、逐字矩形、行边界等；判断放在 Node 里做，
 * 这样失败消息能写清楚差了多少像素。
 */
function readStageInPage(stageId: string): any {
  const stage = document.getElementById(stageId)
  if (!stage) return null
  const row = stage.querySelector('[data-dsh-md-effort-row="1"]') as any
  if (!row) return null
  const rowRect = row.getBoundingClientRect()
  const chips = Array.prototype.slice.call(row.querySelectorAll('span[data-log]'))
  const allChip = chips[0]
  const dirChips = chips.slice(1)
  const longChip = dirChips[dirChips.length - 1]
  const longRects = Array.prototype.slice.call(longChip.getClientRects())
  const textNode = longChip.firstChild
  const text = (textNode && textNode.nodeType === 3) ? String(textNode.nodeValue) : ''
  const range = document.createRange()
  const charRects: any[] = []
  for (let i = 0; i < text.length; i += 1) {
    range.setStart(textNode, i)
    range.setEnd(textNode, i + 1)
    const r = range.getBoundingClientRect()
    charRects.push({ ch: text.charAt(i), top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width })
  }
  const sorted = charRects.slice().sort(function (a: any, b: any) {
    if (Math.abs(a.top - b.top) > 1) return a.top - b.top
    return a.left - b.left
  })
  return {
    rowLeft: rowRect.left,
    rowRight: rowRect.right,
    rowTop: rowRect.top,
    rowScrollWidth: row.scrollWidth,
    rowClientWidth: row.clientWidth,
    allTop: allChip.getBoundingClientRect().top,
    allText: allChip.textContent,
    chipTexts: dirChips.map(function (c: any) { return c.textContent }),
    chipTops: dirChips.map(function (c: any) { return c.getBoundingClientRect().top }),
    sliceCount: longRects.length,
    slices: longRects.map(function (r: any) { return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, height: r.height, width: r.width } }),
    text: text,
    joined: sorted.map(function (c: any) { return c.ch }).join(''),
    charCount: charRects.length,
    maxCharRight: charRects.reduce(function (m: number, c: any) { return Math.max(m, c.right) }, -Infinity),
    minCharLeft: charRects.reduce(function (m: number, c: any) { return Math.min(m, c.left) }, Infinity),
    labelWidth: charRects.reduce(function (s: number, c: any) { return s + c.width }, 0),
  }
}

async function main(): Promise<void> {
  // ── 一、取真样式与真词表 ──
  // styles.ts 在拼包时和 kernel/motion.ts 住在同一段闭包里，单独 import 时 MOTION 是自由变量；
  // 先把真值挂到 globalThis 再加载（与 tests/verify-997-vc-sight-browser.ts 同一做法）。
  const motionMod: any = await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/motion.ts')).href)
  ;(globalThis as any).MOTION = motionMod.MOTION
  const stylesRel: string = sourcePath('src/client/kernel/styles.js')
  const stylesMod: any = await import(pathToFileURL(path.join(ROOT, stylesRel)).href)
  const STYLE_TEXT: string = Array.isArray(stylesMod.STYLE_TEXT) ? stylesMod.STYLE_TEXT.join('\n') : String(stylesMod.STYLE_TEXT)
  check(STYLE_TEXT.indexOf('.dsws-chip') >= 0, '取到真样式表（含 .dsws-chip）')
  const pagesRel: string = sourcePath('src/client/kernel/locale-pages.js')
  const zh: any = (await import(pathToFileURL(path.join(ROOT, pagesRel)).href)).L_PAGES.zh
  const tr = function (k: string): string { return zh[k] !== undefined ? String(zh[k]) : String(k) }
  const ALL_TEXT: string = tr('list.all')

  // ── 二、把真源码求值，用它画这一排（不手抄样式） ──
  const leafJs: string = spliceableJs('src/client/views/mdEffortRow.js').replace(/^[ \t]*export[ \t]+/gm, '')
  const leaf: any = compileFn(['chipProps', 'tr', 'Tip', 'emit'], leafJs
    + '\nreturn { MD_EFFORT_LABEL_DIGIT_LIMIT, MD_EFFORT_LABEL_ELLIPSIS, mdEffortLabelOf, mdEffortRowNode }')(
    function (p: any) { return p || {} },
    tr,
    function (props: any, child: any) { return { type: 'Tip', props: props || {}, children: [child] } },
    function () { return undefined })
  const DIGIT_SAMPLE: string = '0'.repeat(leaf.MD_EFFORT_LABEL_DIGIT_LIMIT)
  const ELLIPSIS: string = leaf.MD_EFFORT_LABEL_ELLIPSIS
  check(leaf.MD_EFFORT_LABEL_DIGIT_LIMIT === 19, '文字上限是 19 个数字的宽度')

  // ── 三、第一遍量字宽：用浏览器真字体量面板里的字号（10px），第二遍才能按同一把尺子算截断 ──
  const probeHtml: string = '<!doctype html><html><head><meta charset="utf-8"><style>' + STYLE_TEXT + '</style><style>'
    + 'html,body{margin:0;background:#16181d;color:#e6edf3;}'
    + 'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;line-height:1.6}'
    + '.probe{position:absolute;left:-9999px;top:0;font-size:10px;line-height:14px;white-space:nowrap}'
    + '</style></head><body>'
    + '<span class="probe" id="probe-cap">' + DIGIT_SAMPLE + '</span>'
    + '<span class="probe" id="probe-ell">' + esc(ELLIPSIS) + '</span>'
    + [ALL_TEXT].concat(FILLER_POOL, [LONG_NAME]).map(function (t: string) {
      return '<span class="probe" data-p="' + esc(t) + '">' + esc(t) + '</span>'
    }).join('')
    + '</body></html>'

  let probe: any = null
  let newStage: any = null
  let oldStage: any = null

  await withPage({ viewport: { width: 900, height: 900 } }, async (page: any) => {
    await page.setContent(probeHtml)
    probe = await page.evaluate(function (args: any) {
      const cs = getComputedStyle(document.body)
      const ctx: any = document.createElement('canvas').getContext('2d')
      ctx.font = '10px ' + cs.fontFamily
      const texts: any = {}
      Array.prototype.slice.call(document.querySelectorAll('.probe[data-p]')).forEach(function (n: any) {
        texts[n.getAttribute('data-p')] = n.getBoundingClientRect().width
      })
      const capEl: any = document.getElementById('probe-cap')
      const ellEl: any = document.getElementById('probe-ell')
      const chars: string[] = Array.from(args.longName)
      const prefixes: number[] = [0]
      let acc = ''
      for (let i = 0; i < chars.length; i += 1) { acc += chars[i]; prefixes.push(ctx.measureText(acc).width) }
      return {
        fontFamily: cs.fontFamily,
        texts: texts,
        capWidth: capEl.getBoundingClientRect().width,
        ellWidth: ellEl.getBoundingClientRect().width,
        canvasCap: ctx.measureText(args.digits).width,
        longPrefixes: prefixes,
        longWidth: ctx.measureText(args.longName).width,
      }
    }, { digits: DIGIT_SAMPLE, longName: LONG_NAME })
  })

  check(!!probe, '浏览器量到了字宽')
  const widthOf = function (t: string): number { return probe.texts[t] }
  check(isFinite(widthOf(ALL_TEXT)) && isFinite(widthOf(LONG_NAME)), '量到「全部」与长目录名的宽度')
  // 胶囊的盒子宽 = 文字宽 + 左右内边距 16 + 左右边框 2 + 右外边距 8（见 mdEffortRow.ts 的排布注释）。
  const chipWidth = function (text: string): number { return widthOf(text) + 26 }
  check(Math.abs(probe.capWidth - probe.canvasCap) < 1, '元素量到与画布量到的 19 个数字宽度一致（' + probe.capWidth.toFixed(1) + 'px ≈ ' + probe.canvasCap.toFixed(1) + 'px）')

  // 注入量字函数：让 Node 里算出的截断结果与浏览器真字体一致。
  const injectedMeasure = function (text: any): number {
    const s: string = String(text)
    if (s === DIGIT_SAMPLE) return probe.canvasCap
    if (s === ELLIPSIS) return probe.ellWidth
    if (Object.prototype.hasOwnProperty.call(probe.texts, s)) return probe.texts[s]
    if (s.length > 0 && LONG_NAME.indexOf(s) === 0) return probe.longPrefixes[Array.from(s).length]
    return NaN
  }
  const EXPECTED_LABEL: string = leaf.mdEffortLabelOf(LONG_NAME, injectedMeasure)
  check(EXPECTED_LABEL.slice(-1) === ELLIPSIS, '长目录名按上限截断，末尾是省略号（' + EXPECTED_LABEL + '）')
  const ALL_CHIP_W: number = chipWidth(ALL_TEXT)
  // 显示文字 = 截断后留下的前缀 + 省略号；宽度要按两段分别量再相加（省略号不是原名的前缀）。
  const LABEL_BODY: string = EXPECTED_LABEL.slice(0, -1)
  const LABEL_W: number = (EXPECTED_LABEL.length > 0 ? injectedMeasure(LABEL_BODY) : 0) + probe.ellWidth
  const FULL_W: number = probe.longWidth
  check(FULL_W > probe.canvasCap + probe.ellWidth, '反证成立的前提：长目录名确实比上限宽（' + FULL_W.toFixed(1) + 'px > ' + (probe.canvasCap + probe.ellWidth).toFixed(1) + 'px）')
  check(LABEL_W <= probe.canvasCap + probe.ellWidth + 2, '截断后显示文字不超过「19 个数字 + 一个省略号」的宽度（' + LABEL_W.toFixed(1) + 'px）')

  // ── 四、挑第一行的短目录签：让长签的起点正好卡在行尾（两边都要留出至少两个字） ──
  // 约束：长签第一行至少能放下两个字（约 30px：左内边距 8 + 边框 1 + 两个字），
  //       第二行也至少要接上两个字（余量不超过「显示文字宽 − 20」）。
  const minFirst = 30
  const maxFirst = Math.max(minFirst, LABEL_W - 20)
  let best: any = null
  for (let mask = 0; mask < (1 << FILLER_POOL.length); mask += 1) {
    const chosen: string[] = []
    let used: number = ALL_CHIP_W
    for (let i = 0; i < FILLER_POOL.length; i += 1) {
      if (!(mask & (1 << i))) continue
      chosen.push(FILLER_POOL[i])
      used += chipWidth(FILLER_POOL[i])
    }
    const room: number = STAGE_WIDTH - used
    if (room < minFirst || room > maxFirst) continue
    const score: number = Math.abs(room - LABEL_W * 0.55)
    if (!best || score < best.score) best = { chosen: chosen, room: room, score: score }
  }
  check(!!best, '能给长签凑出行尾只剩几十像素的第一行')
  const fillers: string[] = best ? best.chosen : []
  const names: string[] = fillers.concat([LONG_NAME])
  const room: number = STAGE_WIDTH - ALL_CHIP_W - fillers.reduce(function (s: number, t: string) { return s + chipWidth(t) }, 0)
  console.log('  · 第一行：「全部」+ ' + fillers.length + ' 颗短签，留给长签 ' + room.toFixed(1) + 'px；长签显示文字 ' + LABEL_W.toFixed(1) + 'px')

  // ── 五、画两个 stage：新写法与旧写法（同一棵树，只换排布样式） ──
  // 假 React 只搭对象树：h 是它给的 createElement（真机里 ListTab 拿到的 h 也是 createElement 这一类函数）。
  const h: any = makeReact().createElement
  const rowTree: any = leaf.mdEffortRowNode(h, { effFilters: [] }, names, injectedMeasure)
  const pageCss: string = '<style>'
    + 'html,body{margin:0;background:#16181d;color:#e6edf3;}'
    + 'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;line-height:1.6}'
    + '.stage{width:' + STAGE_WIDTH + 'px;margin:0 0 10px 0;background:#16181d}'
    + '.probe{position:absolute;left:-9999px;top:0;font-size:10px;line-height:14px;white-space:nowrap}'
    + '</style>'
  const finalHtml: string = '<!doctype html><html><head><meta charset="utf-8"><style>' + STYLE_TEXT + '</style>' + pageCss
    + '</head><body>'
    + '<span class="probe" id="probe-cap">' + DIGIT_SAMPLE + '</span>'
    + '<span class="probe" id="probe-ell">' + esc(ELLIPSIS) + '</span>'
    + '<div class="stage" id="stage-new">' + htmlOf(rowTree, false) + '</div>'
    + '<div class="stage" id="stage-old">' + htmlOf(rowTree, true) + '</div>'
    + '</body></html>'

  await withPage({ viewport: { width: 900, height: 900 } }, async (page: any) => {
    await page.setContent(finalHtml)
    newStage = await page.evaluate(readStageInPage, 'stage-new')
    oldStage = await page.evaluate(readStageInPage, 'stage-old')
  })
  await closeBrowser()

  check(!!newStage && !!oldStage, '两个 stage 都画出来了')
  if (!newStage || !oldStage) {
    console.log('done ' + total + ' checks, failed=' + (failed ? 'yes' : 'no'))
    process.exit(1)
  }

  // ── 六、新写法的几何判据 ──
  const first: any = newStage.slices[0]
  const last: any = newStage.slices[newStage.slices.length - 1]
  const maxSliceHeight: number = newStage.slices.reduce(function (m: number, s: any) { return Math.max(m, s.height) }, 0)
  check(newStage.sliceCount >= 2, '长目录签被切成 ' + newStage.sliceCount + ' 片（不是整颗一颗）')
  check(Math.abs(first.top - newStage.allTop) <= 2, '第一片就在第一行（与「全部」那颗同一行，差 ' + Math.abs(first.top - newStage.allTop).toFixed(1) + 'px ≤ 2px）')
  check(maxSliceHeight <= 24, '每片最多一行高（最高 ' + maxSliceHeight.toFixed(1) + 'px ≤ 24px），没有在胶囊内部折成高块')
  check(newStage.slices.every(function (s: any) { return s.height <= 24 }), '所有分片都不高于一行（没有哪一截折成两行）')
  check(last.top - first.top >= 15, '第二片落到第二行（两片行距 ' + (last.top - first.top).toFixed(1) + 'px）')
  check(first.right >= newStage.rowRight - 16, '第一片贴着行尾切断（右缘 ' + first.right.toFixed(1) + 'px，行右 ' + newStage.rowRight.toFixed(1) + 'px）')
  check(last.left <= newStage.rowLeft + 4 && last.left >= newStage.rowLeft - 2, '第二片从行左贴边接上（左缘 ' + last.left.toFixed(1) + 'px，行左 ' + newStage.rowLeft.toFixed(1) + 'px）')
  check(newStage.maxCharRight <= newStage.rowRight + 1, '文字最右不超出这一行（' + newStage.maxCharRight.toFixed(1) + 'px ≤ ' + (newStage.rowRight + 1).toFixed(1) + 'px）')
  check(newStage.rowScrollWidth <= newStage.rowClientWidth + 1, '这一排没有横向溢出（scrollWidth ' + newStage.rowScrollWidth + ' ≤ clientWidth ' + newStage.rowClientWidth + ' + 1）')
  check(newStage.joined === EXPECTED_LABEL, '两截按行读回来拼成完整显示文字（「' + newStage.joined + '」）')
  check(newStage.charCount === Array.from(EXPECTED_LABEL).length, '逐字数下来一个不少（' + newStage.charCount + ' 个字）')
  check(newStage.text === EXPECTED_LABEL, '渲染的就是按上限截断后的文字')
  check(newStage.text.slice(-1) === ELLIPSIS, '长目录签末尾是省略号')

  // 第一行先画短目录签，它们都不能被截断；「全部」那颗不受文字上限影响。
  const fillerTexts: string[] = newStage.chipTexts.slice(0, newStage.chipTexts.length - 1)
  check(fillerTexts.every(function (t: string) { return t.indexOf(ELLIPSIS) < 0 }), '没超上限的目录名不出现省略号')
  check(newStage.allText === ALL_TEXT && newStage.allText.indexOf(ELLIPSIS) < 0, '「全部」那颗文字不变、不受上限影响')
  check(newStage.chipTops.every(function (top: number) { return Math.abs(top - newStage.allTop) <= 2 }), '长签之前的每颗目录签都画在第一行')

  // ── 七、反证：同一页把旧写法重画一遍，我们的判据必须判它坏 ──
  const oldMaxHeight: number = oldStage.slices.reduce(function (m: number, s: any) { return Math.max(m, s.height) }, 0)
  const oldMoved: number = Math.abs(oldStage.slices[0].top - oldStage.allTop)
  const oldBroken: boolean = oldStage.sliceCount < 2 || oldMoved > 2 || oldMaxHeight > 24
  check(oldBroken, '反证：旧写法（flex 容器 + 220 像素上限 + 胶囊内折行）会被判坏（分片 ' + oldStage.sliceCount + ' 片，离第一行 ' + oldMoved.toFixed(1) + 'px，最高 ' + oldMaxHeight.toFixed(1) + 'px）')
  check(oldStage.chipTexts[oldStage.chipTexts.length - 1] === EXPECTED_LABEL, '反证对照组用的是同一颗、同一段显示文字（只改排布，不改截断）')

  console.log('done ' + total + ' checks, failed=' + (failed ? 'yes' : 'no'))
  if (failed) process.exit(1)
}

main().catch(function (e: any) {
  console.error('  FAIL 门禁自己在执行中抛错：' + (e && e.stack ? e.stack : e))
  try { closeBrowser() } catch (e2) { /* 关不上就交给进程退出 */ }
  process.exit(1)
})
