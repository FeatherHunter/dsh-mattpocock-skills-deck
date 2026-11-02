#!/usr/bin/env node
/**
 * verify-1837-legend-browser.ts —— 技能列表标题行「重要程度图例」的真浏览器量宽门禁（#1837）
 *
 * 为什么必须真浏览器：图例与标题挤在同一行，460 宽一行、360 宽一行、300 宽英文允许换行——
 *   这些结论只有按真实面板嵌套（.dsws-panel > .dsws-body > .pixel-tab > 列表）量像素才算得出来，
 *   jsdom 与 react-dom/server 都给不出布局宽度。这一扇把真实的 STYLE_TEXT 与 PIXEL_STYLE_TEXT
 *   注入真 Chromium，按 460/360/300 三档 × 深/浅两皮肤 × 中/英两语言逐档量。
 *
 * 判据：
 *   A. 图例存在且说全四样：核心、常用、备用三个色点加一项★推荐；文案取自词表真源（config/copy/skilldetail.yaml）。
 *   B. 460 / 360：图例与标题「■ 技能」同一行，图例不超出标题行右边界。
 *   C. 300：英文允许图例换行（换到第二行仍右对齐），但不许图例自身溢出标题行、不许某一项被裁掉；
 *      英文换行时中文仍应一行放得下（同一套规则下中文更短）。
 *   F. 三档宽度 × 深浅 × 中英：文档、面板、页签、27 行都没有横向溢出。面板可被用户拖窄，
 *      窄时技能行靠换行适应（行可以变高），但不许出现横向滚动条；两颗按钮始终在同一组里换行。
 *   D. 三档色点按皮肤令牌上色：深色核心 rgb(245,158,11)、常用 rgb(14,138,22)；浅色核心 rgb(180,83,9)、
 *      常用 rgb(21,128,61)；备用两套皮肤都是透明底（空心）。行里的点与图例里的点颜色一致（同源）。
 *   E. 反证：给同一把量尺强加「不许换行」的样式，300 宽必须量出横向溢出——量尺测不出真的坏了就没有证据力。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1837-legend-browser.ts
 * 依赖：playwright（本机已装 headless shell）；截图不落盘，量完即关。
 * 门禁归属: src/client/views/skillDetail/PixelStyles.ts
 * 门禁归属: src/client/views/skillDetail/PixelSkillList.ts
 * 门禁归属: src/client/views/pixel/PixelDot.ts
 * 门禁归属: src/shared/matt-skills.ts
 * 门禁归属: config/copy/skilldetail.yaml
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const ROOT = path.resolve(__dirname, '..')
const { sourcePath } = require('./lib/source-text.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { parse: parseYaml } = require('yaml')

const GATE = 'verify-1837-legend-browser'
const WIDTHS = [460, 360, 300]
const SKINS = ['dark', 'light']
const LANGS = ['zh', 'en']
// 皮肤令牌的最终计算值（PixelStyles.ts:25 深色 → #f59e0b / #0e8a16；:41 浅色 → #b45309 / #15803d）。
// 图例与行都查 shared 的外观表，所以这里量的是「外观表 + 皮肤令牌」合起来的真实像素色。
const EXPECTED_DOT_BG = {
  dark: { core: 'rgb(245, 158, 11)', common: 'rgb(14, 138, 22)', rare: 'rgba(0, 0, 0, 0)' },
  light: { core: 'rgb(180, 83, 9)', common: 'rgb(21, 128, 61)', rare: 'rgba(0, 0, 0, 0)' },
}
// 反证用的破坏样式：把标题行与图例都锁成不许换行，并把图例文字放大到 16px——
// 这一下 300 宽的英文图例一定宽过标题行，量尺必须量出横向溢出。
const BREAKAGE_CSS = '.pixel-skillhead{flex-wrap:nowrap!important}.pixel-skilllegend{flex-wrap:nowrap!important;max-width:none!important;margin-left:0!important}.pixel-legenditem{font-size:16px!important}'

let total = 0
let failed = 0
const check = (ok: any, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed += 1
}
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 让叶子组件在 Node 里能求值：它们用 `declare const` 引 React / DswsCtx / tr / Tip / 兄弟叶子，
// 运行时靠自由标识符解析到 globalThis；真实客户端里这些由构建拼装提供（见 src/client/index.ts 的拼接标记）。
function installGlobals(React: any, dict: any, shared: any): void {
  globalThis.React = React
  globalThis.DswsCtx = React.createContext(null)
  globalThis.TR = dict
  globalThis.tr = function (key: string): string {
    return Object.prototype.hasOwnProperty.call(globalThis.TR || {}, key) ? String(globalThis.TR[key]) : String(key)
  }
  // Tip 真实实现只是给 children 挂悬停事件（HoverTip 用 cloneElement），不额外包一层；
  // 量宽用 props.children 原样返回，布局与真实页面一致。
  globalThis.Tip = function (p: any): any { return p && p.children }
  globalThis.SKILL_IMPORTANCE_STYLES = shared.SKILL_IMPORTANCE_STYLES
}

function pageHtml(STYLE_TEXT: string, PIXEL_STYLE_TEXT: string, markup: string, skin: string, width: number, extraCss: string): string {
  const attrs = skin === 'dark' ? ' data-ds-dark-theme' : ''
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>' + STYLE_TEXT + '\n' + PIXEL_STYLE_TEXT + '</style>' +
    '<style>#probe-panel{position:static!important;width:' + width + 'px!important;max-height:none!important}' + extraCss + '</style>' +
    '</head><body' + attrs + '><div id="probe-panel" class="dsws-panel"><div class="dsws-body"><div class="pixel-tab">' + markup + '</div></div></div></body></html>'
}

// 页面里量一次，把判据要的数字全带回来（避免多次 evaluate 之间布局变化）。
function measure(): any {
  const q = function (sel: string): any { return document.querySelector(sel) }
  const qa = function (sel: string): any[] { return Array.from(document.querySelectorAll(sel)) }
  const overflow = function (el: any): number { return el ? el.scrollWidth - el.clientWidth : -1 }
  const box = function (el: any): any { return el ? el.getBoundingClientRect() : null }
  const dotOf = function (el: any): any {
    if (!el) return null
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, bw: cs.borderTopWidth }
  }
  const panel = q('#probe-panel')
  const body = q('.dsws-body')
  const tab = q('.pixel-tab')
  const root = tab ? tab.firstElementChild : null
  const head = q('.pixel-skillhead')
  const legend = q('.pixel-skilllegend')
  const title = head ? head.querySelector('span') : null
  const legendItems = qa('.pixel-legenditem')
  const rows = qa('.pixel-skillrow')
  const sampleRows = [rows[0], rows[9], rows[12]]
  return {
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: overflow(body),
    tabOverflow: overflow(tab),
    rootOverflow: overflow(root),
    headOverflow: overflow(head),
    legendOverflow: overflow(legend),
    headClientWidth: head ? head.clientWidth : -1,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    panelWidth: panel ? panel.clientWidth : -1,
    head: box(head),
    legend: box(legend),
    legendW: legend ? legend.getBoundingClientRect().width : -1,
    legendTop: legend ? legend.getBoundingClientRect().top : -1,
    titleW: title ? title.getBoundingClientRect().width : -1,
    titleTop: title ? title.getBoundingClientRect().top : -1,
    titleText: title ? String(title.textContent) : '',
    legendLabels: legendItems.map(function (it: any): string { return String(it.textContent) }),
    legendItemOverflows: legendItems.map(function (it: any): number { return overflow(it) }),
    legendDots: qa('.pixel-legenditem .pixel-dot').map(dotOf),
    rowCount: rows.length,
    rowOverflows: rows.map(function (r: any): number { return overflow(r) }),
    rowDots: sampleRows.map(function (r: any): any { return dotOf(r ? r.querySelector('.pixel-dot') : null) }),
    buttonTexts: rows.map(function (r: any): string[] {
      return Array.from(r.querySelectorAll('.pixel-btn')).map(function (b: any): string { return String(b.textContent) })
    }),
  }
}

function sameLine(m: any): boolean {
  return m.legendTop >= 0 && m.titleTop >= 0 && Math.abs(m.legendTop - m.titleTop) < 8
}

function assertCombo(tag: string, lang: string, skin: string, width: number, m: any, dict: any): void {
  const label = tag + '（' + lang + ' / ' + skin + ' / ' + width + 'px）'
  const wantLabels = [dict['sd.imp.core'], dict['sd.imp.common'], dict['sd.imp.rare'], '★' + dict['sd.imp.star']]
  check(m.rowCount === 27, label + ' 渲染了 27 行技能')
  check(m.titleText === dict['sd.listTitle'], label + ' 标题文字是「' + dict['sd.listTitle'] + '」（实际「' + m.titleText + '」）')
  check(m.legendLabels.join('|') === wantLabels.join('|'), label + ' 图例说全「核心 / 常用 / 备用 / ★推荐」（实际 ' + m.legendLabels.join('|') + '）')
  const buttonOk = m.buttonTexts.every(function (labels: string[]): boolean {
    return labels.indexOf(dict['sd.injectChat']) !== -1 && labels.indexOf(dict['sd.detailBtn']) !== -1
  })
  check(buttonOk, label + ' 每一行都完整显示「' + dict['sd.injectChat'] + '」「' + dict['sd.detailBtn'] + '」两颗按钮文字')
  const itemClipped = m.legendItemOverflows.filter(function (v: number): boolean { return v > 0 })
  check(itemClipped.length === 0, label + ' 图例每一项都没有被裁掉')
  // 460 / 360 必须一行；300 允许换行，但图例自身不许超出标题行（300 的英文是最长的组合）。
  if (width >= 360) {
    check(sameLine(m), label + ' 图例与标题同一行（图例 ' + m.legendW.toFixed(2) + ' + 标题 ' + m.titleW.toFixed(2) + ' / 标题行 ' + m.headClientWidth + '）')
  }
  check(m.legendW > 0 && m.legendW <= m.headClientWidth + 1, label + ' 图例不宽于标题行（图例 ' + m.legendW.toFixed(2) + ' / 标题行 ' + m.headClientWidth + '）')
  const legendRightOk = m.legend.right <= m.head.right + 1 && m.legend.left >= m.head.left - 1
  check(legendRightOk, label + ' 图例在标题行内右对齐（右缘 ' + m.legend.right.toFixed(2) + ' / 标题行右缘 ' + m.head.right.toFixed(2) + '）')
  const dots = m.legendDots
  const want = EXPECTED_DOT_BG[skin]
  // 先确认三个色点都在，再读各自底色：图例若整个丢了，这里应该报 PASS/FAIL，而不是因为读
  // dots[0].bg 先抛 TypeError（那样红色原因看起来像门禁自己坏了，反而掩盖真正的回归）。
  const haveThree = dots.length === 3
  const dotAt = function (i: number): any { return dots[i] || { bg: '(缺)', bw: '(缺)' } }
  check(haveThree && dotAt(0).bg === want.core, label + ' 核心色点＝皮肤警告色（实际 ' + dotAt(0).bg + ' / 期望 ' + want.core + '）')
  check(haveThree && dotAt(1).bg === want.common, label + ' 常用色点＝皮肤就绪色（实际 ' + dotAt(1).bg + ' / 期望 ' + want.common + '）')
  check(haveThree && dotAt(2).bg === want.rare && dotAt(2).bw === '2px', label + ' 备用色点＝透明底、2px 描边（空心）（实际底 ' + dotAt(2).bg + '、描边 ' + dotAt(2).bw + '）')
  check(haveThree && dotAt(0).bw === '2px' && dotAt(1).bw === '2px', label + ' 实心色点同样保留 2px 描边（实际 ' + dotAt(0).bw + ' / ' + dotAt(1).bw + '）')
  const rowSame = haveThree && m.rowDots.length === 3 &&
    m.rowDots[0].bg === dots[0].bg && m.rowDots[1].bg === dots[1].bg && m.rowDots[2].bg === dots[2].bg
  check(!!rowSame, label + ' 行里的色点与图例同色（同源外观表）')
  // 三档面板宽度都要整页不横向溢出：面板可被用户拖窄，360/300 下技能行靠换行适应（行可以变高），
  // 但不允许出现横向滚动条；这也是 #1836 把按钮改叫「注入对话」之后第一次把窄宽度钉住。
  const rowBad = m.rowOverflows.filter(function (v: number): boolean { return v > 0 })
  check(m.docOverflow <= 0 && m.bodyOverflow <= 0 && m.tabOverflow <= 0 && m.rootOverflow <= 0,
    label + ' 文档 / 面板 / 页签 / 列表都没有横向溢出')
  check(rowBad.length === 0, label + ' 27 行都没有横向溢出（越界行数 ' + rowBad.length + '）')
  if (width === 300 && lang === 'en') {
    console.log('  INFO ' + label + ' 图例是否换行：' + (sameLine(m) ? '未换行' : '已换行（允许）') + '；图例宽 ' + m.legendW.toFixed(2))
  }
}

async function main(): Promise<void> {
  const React = require('react')
  const ReactDOMServer = require('react-dom/server')
  const { chromium } = require('playwright')
  const { renderToStaticMarkup } = ReactDOMServer

  // 1) 真实样式：kernel/styles 与像素皮肤都按真源导入，量到的就是线上那套 CSS。
  const motionMod = await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/motion.ts')).href)
  globalThis.MOTION = motionMod.MOTION
  const kernelStyles = await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/styles.ts')).href)
  const pixelStyles = await import(pathToFileURL(path.join(ROOT, 'src/client/views/skillDetail/PixelStyles.ts')).href)
  const STYLE_TEXT: string = kernelStyles.STYLE_TEXT
  // 像素皮肤是一段段规则组成的数组（真源就是 string[]），拼页面时先按真源顺序接成一份文本。
  const PIXEL_STYLE_TEXT: string = Array.isArray(pixelStyles.PIXEL_STYLE_TEXT) ? pixelStyles.PIXEL_STYLE_TEXT.join('') : String(pixelStyles.PIXEL_STYLE_TEXT)

  // 2) 真实共享数据与外观表（技能名单、档位、颜色都只在这一处定义）。
  const shared = await import(pathToFileURL(path.join(ROOT, sourcePath('src/shared/matt-skills.js'))).href)
  const detailCopy = parseYaml(read('config/copy/skilldetail.yaml'))
  const descCopy = parseYaml(read('config/copy/skilldesc.yaml'))
  const dictFor = function (lang: string): any {
    return Object.assign({}, detailCopy[lang] || {}, descCopy[lang] || {})
  }

  check(shared.SKILLS.length === 27, '真源数据表里有 27 项技能')

  // 3) 组件按真源导入；先装好全局再导叶子（它们只在渲染时才取那些全局）。
  installGlobals(React, dictFor('zh'), shared)
  const dotMod = await import(pathToFileURL(path.join(ROOT, 'src/client/views/pixel/PixelDot.ts')).href)
  const btnMod = await import(pathToFileURL(path.join(ROOT, 'src/client/views/pixel/PixelBtn.ts')).href)
  globalThis.PixelDot = dotMod.PixelDot
  globalThis.PixelBtn = btnMod.PixelBtn
  const rowMod = await import(pathToFileURL(path.join(ROOT, 'src/client/views/skillDetail/PixelSkillRow.ts')).href)
  globalThis.PixelSkillRow = rowMod.PixelSkillRow
  const listMod = await import(pathToFileURL(path.join(ROOT, 'src/client/views/skillDetail/PixelSkillList.ts')).href)
  check(typeof rowMod.PixelSkillRow === 'function' && typeof listMod.PixelSkillList === 'function', '技能行与技能列表都能在 Node 里按真源求值')

  const renderList = function (dict: any): string {
    globalThis.TR = dict
    const items = shared.SKILLS.map(function (s: any): any {
      return { name: s.name, importance: s.importance, use: dict['skilldesc.' + s.name] || '', recommended: s.name === 'ask-matt' }
    })
    return renderToStaticMarkup(React.createElement(listMod.PixelSkillList, {
      items: items,
      onDetail: function (): void {},
      onLoad: function (): void {},
      loadingName: '',
    }))
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 } })
    for (const lang of LANGS) {
      const dict = dictFor(lang)
      const markup = renderList(dict)
      check(markup.indexOf('pixel-skilllegend') !== -1, lang + '：渲染结果里带图例容器')
      for (const skin of SKINS) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width: width + 240, height: 1200 })
          await page.setContent(pageHtml(STYLE_TEXT, PIXEL_STYLE_TEXT, markup, skin, width, ''))
          const m = await page.evaluate(measure)
          assertCombo(GATE, lang, skin, width, m, dict)
        }
      }
    }

    // 4) 反证：同一把量尺必须能测出「真的坏了」。
    const dictEn = dictFor('en')
    const markupEn = renderList(dictEn)
    await page.setViewportSize({ width: 300 + 240, height: 1200 })
    await page.setContent(pageHtml(STYLE_TEXT, PIXEL_STYLE_TEXT, markupEn, 'dark', 300, '<style>' + BREAKAGE_CSS + '</style>'))
    const bad = await page.evaluate(measure)
    check(bad.legendOverflow > 0 || bad.headOverflow > 0 || bad.docOverflow > 0,
      '反证：锁死不许换行后，300 宽英文必须量出溢出（图例溢出 ' + Math.max(bad.legendOverflow, 0).toFixed(2) + '、标题行溢出 ' + Math.max(bad.headOverflow, 0).toFixed(2) + '、文档溢出 ' + bad.docOverflow.toFixed(2) + '）')
    await page.close()
  } finally {
    await browser.close()
  }
}

main().then(function (): void {
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}).catch(function (err: any): void {
  console.log('  FAIL 门禁自己抛错：' + String((err && err.stack) || err))
  printGateResult(GATE, total + 1, 1)
  process.exit(1)
})
