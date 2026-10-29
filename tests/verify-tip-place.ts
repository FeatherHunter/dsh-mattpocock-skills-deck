// verify-tip-place.ts — 悬停提示方位纯函数 computeTipPlace 的单测（规格 #1651，地基票 #1652）
// 用法: node --import ./scripts/ts-hook.mts tests/verify-tip-place.ts
// 验证：给定合成矩形，断言方位与左上角坐标；外加两条不变式（提示不越出屏幕、提示不盖住触发控件）。
// #1660：宽度上限指渲染外框宽（含左右内边距与边框），量到的提示宽也按外框宽解释；排位和渲染共用这一个宽度口径，不做换算。
// 写法保持 require 风格：验证链经装载钩子载入本文件，require 与 __dirname 照 CommonJS 形态工作。
const { computeTipPlace } = require('../src/client/views/primitives/tipPlace.ts')
const { sourceText } = require('./lib/source-text.ts')
let failed = false
let total = 0
const ok = (cond, msg) => {
  total += 1
  if (cond) console.log('  PASS ' + msg)
  else { console.log('  FAIL ' + msg); failed = true }
}

// 纯函数不碰界面：源码里不许出现运行时 import，也不许读 window、document 与 DOM。
const tipSrc = sourceText('src/client/views/primitives/tipPlace.ts')
ok(!/^\s*import\s/m.test(tipSrc), '纯函数文件里没有运行时 import（闭包叶子约定）')
// 注释里会写清不碰哪些东西，所以先去掉注释再查代码，避免注释里的说明文字被误判。
const tipCode = tipSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)[^\n]*?\/\/[^\n]*/g, '$1')
ok(!/\b(window|document|getBoundingClientRect|ResizeObserver|offsetWidth|offsetHeight)\b/.test(tipCode), '纯函数不读 DOM 与 window（屏幕尺寸由调用方传进来）')
ok(/\bGAP\b/.test(tipSrc) && /\bEDGE\b/.test(tipSrc), '间隙与边距是函数内的命名常量（8 与 4 不散落在调用方）')
// #1660：排位宽度按渲染外框宽算。右边界必须向下取整再夹，否则带小数的外框宽会把右缘推出屏幕（实测 −0.43 像素）。
ok(/Math\.floor\s*\(\s*vpW\s*-\s*w\s*-\s*EDGE\s*\)/.test(tipCode), '右边界按向下取整夹取（贴右时外框右缘不越出屏幕）')
ok(!/Math\.round\s*\(\s*clampX\s*\(/.test(tipCode), '取整由夹取函数自己负责，调用处不再二次取整')
// #1660：纵向下边界同理，带小数的外框高也不能把下缘顶出屏幕（旧实现底部留边会差 0.4 像素）。
ok(/Math\.floor\s*\(\s*vpH\s*-\s*h\s*-\s*EDGE\s*\)/.test(tipCode), '下边界按向下取整夹取（带小数外框高不越出屏幕）')
ok(!/Math\.round\s*\(\s*clampY\s*\(/.test(tipCode), '纵向取整同样由夹取函数自己负责，调用处不再二次取整')

// 十组边界各一行：基线、右缘、顶缘、窄屏、超长文本、四面都不够、贴右短提示（取整）、贴右长提示（上限主路径）、
// 200 像素窄屏、居中偏差；给定输入，期望方位与坐标，失败信息直接指出哪一组边界错了。
// 纯函数看不到浏览器侧「内容盒宽 vs 外框盒宽」的错位（#1660 的右偏 7～13 像素属于渲染侧），那部分由
// verify-hovertip.ts 锁源码与产物；这里锁取整、留边、收窄与居中这几条几何。坐标一律按左上角比对。
const CASES = [
  {
    name: '基线：中间控件落在正上方居中',
    anchor: { left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20 },
    tip: { width: 120, height: 40 },
    viewport: { width: 800, height: 600 },
    maxWidth: 220,
    expect: { placement: 'above', x: 65, y: 152, effectiveMaxWidth: 220 },
  },
  {
    name: '右缘：提示整块往左移而不是跑出屏幕',
    anchor: { left: 740, top: 200, right: 790, bottom: 220, width: 50, height: 20 },
    tip: { width: 120, height: 40 },
    viewport: { width: 800, height: 600 },
    maxWidth: 220,
    expect: { placement: 'above', x: 676, y: 152, effectiveMaxWidth: 220 },
  },
  {
    name: '顶缘：上方放不下翻到控件下方',
    anchor: { left: 100, top: 10, right: 150, bottom: 30, width: 50, height: 20 },
    tip: { width: 120, height: 40 },
    viewport: { width: 800, height: 600 },
    maxWidth: 220,
    expect: { placement: 'below', x: 65, y: 38, effectiveMaxWidth: 220 },
  },
  {
    name: '窄屏：生效宽度随屏幕收窄而不是横向溢出',
    anchor: { left: 80, top: 200, right: 130, bottom: 220, width: 50, height: 20 },
    tip: { width: 120, height: 40 },
    viewport: { width: 200, height: 600 },
    maxWidth: 220,
    expect: { placement: 'above', x: 45, y: 152, effectiveMaxWidth: 192 },
  },
  {
    name: '超长文本：提示宽按上限夹住而不是无限撑宽',
    anchor: { left: 375, top: 300, right: 425, bottom: 320, width: 50, height: 20 },
    tip: { width: 500, height: 60 },
    viewport: { width: 800, height: 600 },
    maxWidth: 220,
    expect: { placement: 'above', x: 290, y: 232, effectiveMaxWidth: 220 },
  },
  {
    name: '四面都不够：选空间最大的一侧并夹回屏幕内',
    anchor: { left: 190, top: 65, right: 210, bottom: 85, width: 20, height: 20 },
    tip: { width: 300, height: 100 },
    viewport: { width: 400, height: 150 },
    maxWidth: 220,
    expect: { placement: 'right', x: 218, y: 25, effectiveMaxWidth: 178 },
  },
  {
    name: '贴右短提示：带小数的外框宽也不许把右缘顶出屏幕（#1660）',
    anchor: { left: 740, top: 200, right: 760, bottom: 220, width: 20, height: 20 },
    tip: { width: 192.35, height: 40 },
    viewport: { width: 800, height: 600 },
    maxWidth: 320,
    expect: { placement: 'above', x: 603, y: 152, effectiveMaxWidth: 320 },
  },
  {
    name: '长提示（上限主路径）：渲染外框宽量到 320，右缘留出 4 像素（#1660）',
    anchor: { left: 2100, top: 600, right: 2140, bottom: 620, width: 40, height: 20 },
    tip: { width: 320, height: 40 },
    viewport: { width: 2195, height: 1235 },
    maxWidth: 320,
    expect: { placement: 'above', x: 1871, y: 552, effectiveMaxWidth: 320 },
  },
  {
    name: '200 像素窄屏：外框宽收到屏幕可用宽度，不横向越界（#1660）',
    anchor: { left: 80, top: 200, right: 130, bottom: 220, width: 50, height: 20 },
    tip: { width: 218.14, height: 40 },
    viewport: { width: 200, height: 600 },
    maxWidth: 320,
    expect: { placement: 'above', x: 4, y: 152, effectiveMaxWidth: 192 },
  },
  {
    name: '纵向带小数外框高：下边界向下取整，底部留边不被顶穿（#1660）',
    anchor: { left: 300, top: 20, right: 340, bottom: 300, width: 40, height: 280 },
    tip: { width: 320, height: 40.4 },
    viewport: { width: 400, height: 150 },
    maxWidth: 320,
    expect: { placement: 'left', x: 4, y: 105, effectiveMaxWidth: 288 },
  },
  {
    name: '不贴边的居中提示：外框中心与控件中心对齐（#1660）',
    anchor: { left: 1000, top: 800, right: 1001, bottom: 820, width: 1, height: 20 },
    tip: { width: 192.35, height: 40 },
    viewport: { width: 2195, height: 1235 },
    maxWidth: 320,
    expect: { placement: 'above', x: 904, y: 752, effectiveMaxWidth: 320 },
  },
]

const rectOf = (a) => ({
  left: a.left, top: a.top,
  right: (typeof a.right === 'number' ? a.right : a.left + a.width),
  bottom: (typeof a.bottom === 'number' ? a.bottom : a.top + a.height),
})

for (const c of CASES) {
  let got = null
  try { got = computeTipPlace(c.anchor, c.tip, c.viewport, c.maxWidth) }
  catch (e) { ok(false, c.name + '：函数抛异常 ' + (e && e.message)); continue }
  ok(got && got.placement === c.expect.placement, c.name + '：方位是 ' + c.expect.placement + '（实际 ' + (got && got.placement) + '）')
  ok(got && got.x === c.expect.x && got.y === c.expect.y, c.name + '：左上角是 (' + c.expect.x + ', ' + c.expect.y + ')（实际 (' + (got && got.x) + ', ' + (got && got.y) + ')）')
  ok(got && got.effectiveMaxWidth === c.expect.effectiveMaxWidth, c.name + '：生效宽度是 ' + c.expect.effectiveMaxWidth + '（实际 ' + (got && got.effectiveMaxWidth) + '）')
  // 两条不变式对每一类输入都跑一遍，不只跑最顺的那种。
  // 渲染宽按生效宽度（渲染外框宽上限）与量到的外框宽里更小的那个算；#1660 起渲染侧按 border-box，
  // 生效宽度就是外框宽，所以这里不替调用方补内边距与边框。
  if (got) {
    const w = Math.min(c.tip.width, got.effectiveMaxWidth)
    const h = Math.min(c.tip.height, c.viewport.height - 8)
    const inViewport = got.x >= 4 && got.y >= 4 && got.x + w <= c.viewport.width - 4 && got.y + h <= c.viewport.height - 4
    ok(inViewport, c.name + '：不变式一成立（提示不越出屏幕，贴边时外缘留出至少 4 像素；#1660 旧行为会吃到 −0.43 像素）')
    const a = rectOf(c.anchor)
    const disjoint = got.x + w <= a.left || got.x >= a.right || got.y + h <= a.top || got.y >= a.bottom
    ok(disjoint, c.name + '：不变式二成立（提示不盖住触发控件）')
    // 没有被屏幕边界夹取的居中式落位，提示外框中心应与触发控件中心对齐。纯函数给对输入本来就能做到；
    // #1660 的右偏 7～13 像素出在渲染侧把内容盒宽当外框宽（由 verify-hovertip.ts 锁产物与源码），这里锁夹取边界与取整后的对齐。
    const rightLimit = Math.floor(c.viewport.width - w - 4)
    const clamped = got.x <= 4 + 1e-9 || got.x >= rightLimit - 1e-9
    if ((got.placement === 'above' || got.placement === 'below') && !clamped) {
      const aCenterX = (a.left + a.right) / 2
      ok(Math.abs((got.x + w / 2) - aCenterX) <= 1, c.name + '：未被夹取时提示外框中心与控件中心水平偏差 ≤1 像素')
    }
  }
}

console.log('')
if (failed) { console.log('存在失败 — 提示方位纯函数未达标'); process.exit(1) }
console.log('全部通过 — 提示方位纯函数：十组边界 + 两条不变式（共 ' + total + ' 条断言）')
