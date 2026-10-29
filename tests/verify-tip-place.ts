// verify-tip-place.ts — 悬停提示方位纯函数 computeTipPlace 的单测（规格 #1651，地基票 #1652）
// 用法: node --import ./scripts/ts-hook.mts tests/verify-tip-place.ts
// 验证：给定合成矩形，断言方位与左上角坐标；外加两条不变式（提示不越出屏幕、提示不盖住触发控件）。
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

// 五类输入各一行，外加一行最顺的基线：给定输入，期望方位与坐标，失败信息直接指出哪一组边界错了。
// 坐标一律按左上角比对，避免半格误差让断言难读。
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
  // 渲染时的宽按生效宽度来量，所以不变式按渲染尺寸算，不按量之前的原始尺寸算。
  if (got) {
    const w = Math.min(c.tip.width, got.effectiveMaxWidth)
    const h = Math.min(c.tip.height, c.viewport.height - 8)
    const inViewport = got.x >= 4 && got.y >= 4 && got.x + w <= c.viewport.width - 4 && got.y + h <= c.viewport.height - 4
    ok(inViewport, c.name + '：不变式一成立（提示不越出屏幕）')
    const a = rectOf(c.anchor)
    const disjoint = got.x + w <= a.left || got.x >= a.right || got.y + h <= a.top || got.y >= a.bottom
    ok(disjoint, c.name + '：不变式二成立（提示不盖住触发控件）')
  }
}

console.log('')
if (failed) { console.log('存在失败 — 提示方位纯函数未达标'); process.exit(1) }
console.log('全部通过 — 提示方位纯函数：五类边界 + 两条不变式（共 ' + total + ' 条断言）')
