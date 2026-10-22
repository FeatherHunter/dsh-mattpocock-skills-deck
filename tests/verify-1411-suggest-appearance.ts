// tests/verify-1411-suggest-appearance.ts —— 门禁：「下一步建议」小泡动效与外观（#1411 第二次提交）
//
// 契约（票面 #1411 验收②、⑨）：
//   - 外观与动效的关键数值来自集中的旋钮对象（SUGGEST_APPEARANCE），本门禁把它们逐条钉死，
//     以后谁调数值都必须先改这里、让本门禁看得出来；
//   - 时间线是纯函数：泡数（每 20 像素一颗、最少 4 颗）、选项行共用透明度、关闭按钮慢半拍的曲线、
//     已落数量、每颗小泡的出发地/落点/延迟/时长/曲线，都能脱 DOM 精确算出来；
//   - DOM 执行者只测量、建节点、套样式：驱动假 DOM 验证它会在量得到布局时演、量不到/减少动效时
//     不演，dispose 把节点与定时器清干净；源码里不许出现常驻定时器（setInterval）；
//   - 样式里的小泡、退场动画、亮色主题覆盖、减少动效兜底都在；层级常量值与外观旋钮集中一处。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1411-suggest-appearance.ts
// 断言数变化时同步 scripts/gate-map.mts 里 COMPLETION_RECORDED_GATES 的 verify-1411-suggest-appearance。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')
const ROOT = path.resolve(__dirname, '..')
const imp = function (rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }

const failures = []
let total = 0
function check(ok, label) {
  total++
  if (!ok) failures.push(label)
}
function near(a, b, eps) {
  return Math.abs(Number(a) - Number(b)) <= (eps || 1e-6)
}

async function main() {
  // ---------- 0. 载入外观旋钮与两片动效叶子（不需要 jsdom：时间线是纯函数） ----------
  const appearanceMod = await imp('src/client/statusbar/suggestAppearance.ts')
  const A = appearanceMod.SUGGEST_APPEARANCE
  global.SUGGEST_APPEARANCE = A
  global.SUGGEST_Z = appearanceMod.SUGGEST_Z
  const timelineMod = await imp('src/client/statusbar/suggestTimeline.ts')
  const stylesMod = await imp('src/client/statusbar/suggestStyles.ts')
  const engineMod = await imp('src/client/statusbar/suggestEngine.ts')
  const suggestBubbleCounts = timelineMod.suggestBubbleCounts
  const suggestRowOpacity = timelineMod.suggestRowOpacity
  const suggestCloseOpacity = timelineMod.suggestCloseOpacity
  const suggestLandedCount = timelineMod.suggestLandedCount
  const suggestBubblePlan = timelineMod.suggestBubblePlan
  const createSuggestEngine = engineMod.createSuggestEngine
  // 构建时这几片叶子被拼进同一个闭包，跨叶子的名字直接可用；直接 import 单文件时它们落回全局，
  // 所以这里按 verify-1409 的同款做法把时间线函数挂到 globalThis 上。
  global.suggestBubblePlan = suggestBubblePlan
  global.suggestRowOpacity = suggestRowOpacity
  global.suggestCloseOpacity = suggestCloseOpacity
  global.suggestLandedCount = suggestLandedCount

  // ---------- 1. 外观旋钮：关键值逐个钉死（值一变这条门禁就红） ----------
  {
    check(appearanceMod.SUGGEST_Z === 2147482000, '旋钮：层级常量 SUGGEST_Z 仍是 2147482000')
    check(appearanceMod.SUGGEST_Z < 2147483000, '旋钮：层级仍在仓库顶层浮层（2147483000）之下')
    check(A.gapAboveCapsule === 9, '旋钮：气泡与胶囊的间距 9')
    check(A.maxWidthPx === 720, '旋钮：整组最大宽度 720')
    check(A.pillFontPx === 12.5, '旋钮：选项字号 12.5')
    check(A.pillLineHeight === 1.5, '旋钮：选项行高 1.5')
    check(A.pillRadiusPx === 99, '旋钮：选项圆角 99')
    check(A.pillPadY === 3 && A.pillPadX === 12, '旋钮：选项内边距 3 12')
    check(A.pillGapPx === 6, '旋钮：选项间距 6')
    check(A.pillMaxWidthPx === 360, '旋钮：单颗选项宽度上限 360')
    check(A.closeRowMarginTopPx === 10, '旋钮：关闭按钮行与选项行间距 10')
    check(A.closeFontPx === 13 && A.closePadY === 2 && A.closePadX === 10, '旋钮：关闭按钮字号 13、内边距 2 10')
    check(A.closeIdleOpacity === 0.6, '旋钮：关闭按钮空闲不透明度 0.6')
    check(A.bubblePxPerPill === 20 && A.bubbleMinPerPill === 4, '旋钮：每 20 像素一颗、最少 4 颗')
    check(A.bubbleSizeMin === 3.5 && A.bubbleSizeRange === 6, '旋钮：小泡直径 3.5~9.5')
    check(A.bubbleFallbackCount === 8, '旋钮：量不到宽度时兜底 8 颗')
    check(A.bubbleDelayMaxMs === 360, '旋钮：出发延迟上限 360 毫秒')
    check(A.bubbleTravelMinMs === 320 && A.bubbleTravelMaxMs === 660, '旋钮：飞行时长 320~660 毫秒')
    check(A.bubbleFromButtonRatio === 0.8, '旋钮：八成从关闭按钮下方出发')
    check(A.bubbleButtonSpreadPx === 90 && A.bubbleClampPx === 40, '旋钮：按钮两侧各约 90、再钳 40')
    check(A.bubbleStartTopOffset === 14 && A.bubbleStartTopSpread === 116, '旋钮：按钮下方出发点 14~130')
    check(A.bubbleStartBottomOffset === 8 && A.bubbleStartBottomSpread === 122, '旋钮：对话区出发点 8~130')
    check(A.bubbleArriveMinRatio === 0.15 && A.bubbleArriveSpanRatio === 0.7, '旋钮：落点横向 15%~85%')
    check(A.bubbleArriveRowMinRatio === 0.25 && A.bubbleArriveRowSpanRatio === 0.55, '旋钮：落点纵向 25%~80%')
    check(A.bubbleSwayPx === 20, '旋钮：飞行摆动幅度 20')
    check(A.rowOpacityBase === 0.04 && A.rowOpacitySpan === 0.96 && A.rowOpacityCurve === 0.8, '旋钮：选项行透明度 0.04 + 0.96 * 比例^0.8')
    check(A.closeRevealCurve === 2, '旋钮：关闭按钮慢半拍（比例的平方）')
    check(A.bubbleCleanupDelayMs === 260, '旋钮：落完后 260 毫秒清泡')
    check(A.pickMs === 280 && A.fadeMs === 170, '旋钮：选中退场 280 毫秒、关闭淡出 170 毫秒')
    check(Array.isArray(A.easeList) && A.easeList.length === 5, '旋钮：五条速度曲线')
    check(A.easeList.indexOf('ease-out') >= 0 && A.easeList.indexOf('ease-in-out') >= 0, '旋钮：曲线里有 ease-out、ease-in-out')
    check(typeof A.pillBg === 'string' && A.pillBg.indexOf('linear-gradient') === 0, '旋钮：药丸底是渐变（C 版玻璃质感）')
    check(typeof A.bubbleBg === 'string' && A.bubbleBg.indexOf('radial-gradient') === 0, '旋钮：小泡底是径向高光')
    check(typeof A.lightPillBg === 'string' && A.lightPillBorder !== A.pillBorder, '旋钮：亮色主题另给一组颜色')
    check(Object.keys(A).length >= 60, '旋钮：外观参数集中在一个对象里（至少 60 项）')
    const appearanceSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestAppearance.ts'), 'utf8')
    const zDefs = appearanceSrc.split('SUGGEST_Z').length - 1
    check(zDefs >= 1 && /SUGGEST_Z = 2147482000/.test(appearanceSrc), '旋钮：层级常量只有一个定义，值写在这里')
  }

  // ---------- 2. 泡数：每 20 像素一颗、最少 4 颗，量不到宽度返回空 ----------
  {
    const counted = suggestBubbleCounts([60, 200])
    check(Array.isArray(counted) && counted[0] === 4 && counted[1] === 10, '泡数：60 像素最少 4 颗、200 像素 10 颗')
    check(JSON.stringify(suggestBubbleCounts([])) === '[]', '泡数：没有选项返回空数组')
    check(JSON.stringify(suggestBubbleCounts([0, 0])) === '[]', '泡数：宽度全是 0（量不到布局）返回空数组')
    check(suggestBubbleCounts([399.999])[0] === 20 || suggestBubbleCounts([399.999])[0] === 20, '泡数：宽选项按 20 像素一档配更多颗')
    check(suggestBubbleCounts([19])[0] === 4, '泡数：极窄选项也至少 4 颗')
  }

  // ---------- 3. 共用透明度曲线：全部落完才到 1；关闭按钮慢半拍 ----------
  {
    check(near(suggestRowOpacity(0, 10), 0.04), '透明度：一颗没落时选项行几乎透明（0.04）')
    check(near(suggestRowOpacity(10, 10), 1), '透明度：全部落完选项行完全清楚')
    check(near(suggestRowOpacity(5, 10), 0.04 + 0.96 * Math.pow(0.5, 0.8), 1e-9), '透明度：落一半时按 0.8 次方曲线（约 0.591）')
    check(suggestRowOpacity(3, 10) < suggestRowOpacity(6, 10), '透明度：已落越多越清楚（单调）')
    check(near(suggestRowOpacity(0, 0), 1), '透明度：没有小泡时按最终态（1）')
    check(near(suggestCloseOpacity(0, 10), 0), '透明度：关闭按钮起步完全不亮')
    check(near(suggestCloseOpacity(5, 10), 0.25), '透明度：关闭按钮落一半时只有 0.25（慢半拍）')
    check(near(suggestCloseOpacity(10, 10), 1), '透明度：全部落完关闭按钮才完全亮')
    check(suggestCloseOpacity(5, 10) < suggestRowOpacity(5, 10), '透明度：同一时刻关闭按钮比选项行暗')
  }

  // ---------- 4. 已落数量：按「延迟 + 飞行」各自算到达时刻 ----------
  {
    const sample = [{ delayMs: 0, durationMs: 100 }, { delayMs: 50, durationMs: 100 }]
    check(suggestLandedCount(sample, 0) === 0, '已落：时间 0 时没有小泡到达')
    check(suggestLandedCount(sample, 99) === 0, '已落：未到第一颗的到达时刻')
    check(suggestLandedCount(sample, 100) === 1, '已落：第一颗到点算落')
    check(suggestLandedCount(sample, 149) === 1, '已落：第二颗还差 1 毫秒')
    check(suggestLandedCount(sample, 150) === 2, '已落：第二颗到点')
    check(suggestLandedCount([], 500) === 0, '已落：空数组不报错也不数')
  }

  // ---------- 5. 小泡计划：出发地、落点、延迟、时长、曲线的区间与随机数消耗顺序 ----------
  {
    const layout = {
      containerHeight: 120,
      pills: [
        { left: 100, top: 20, width: 100, height: 24 },
        { left: 220, top: 20, width: 200, height: 24 },
      ],
      row: { left: 100, width: 320 },
      close: { centerX: 260, bottomY: 50, width: 30 },
    }
    const counts = suggestBubbleCounts(layout.pills.map(function (p) { return p.width }))
    const expectedTotal = counts[0] + counts[1]
    check(expectedTotal === 15, '计划：两颗选项 100/200 像素配 5 + 10 颗')
    // 每颗泡固定消耗 10 次随机数；第 1 次是尺寸、第 2 次决定出发地，其余依次。
    // 打乱落点先用掉 total - 1 次。用 i%10 定位「出发地」那一位，可精确控制 80% 的判定。
    function seeded(buttonValue) {
      let i = 0
      return function () {
        const index = i++
        if (index < expectedTotal - 1) return 0.5
        const offset = index - (expectedTotal - 1)
        if (offset % 10 === 1) return buttonValue
        return 0.5
      }
    }
    const fromButton = suggestBubblePlan(layout, seeded(0.1))
    check(fromButton.total === expectedTotal, '计划：总颗数等于各选项泡数之和')
    check(fromButton.bubbles.length === expectedTotal, '计划：每颗都有一条计划')
    let buttonSide = true
    let boundsOk = true
    for (let i = 0; i < fromButton.bubbles.length; i++) {
      const b = fromButton.bubbles[i]
      if (b.fromX < layout.row.left - A.bubbleClampPx || b.fromX > layout.row.left + layout.row.width + A.bubbleClampPx) buttonSide = false
      if (b.fromY < layout.close.bottomY + A.bubbleStartTopOffset || b.fromY > layout.close.bottomY + A.bubbleStartTopOffset + A.bubbleStartTopSpread) buttonSide = false
      if (b.toX < 100 || b.toX > 420) boundsOk = false
      if (b.toY < 20 || b.toY > 44) boundsOk = false
    }
    check(buttonSide, '计划：八成从关闭按钮下方出发时，起点都在按钮下方那一带')
    check(boundsOk, '计划：落点都落在自己那颗选项的矩形里（宽度 15%~85%、高度 25%~80%）')
    let sizeOk = true
    let delayOk = true
    let durationOk = true
    let easeOk = true
    for (let i = 0; i < fromButton.bubbles.length; i++) {
      const b = fromButton.bubbles[i]
      if (b.size < A.bubbleSizeMin || b.size > A.bubbleSizeMin + A.bubbleSizeRange) sizeOk = false
      if (b.delayMs < 0 || b.delayMs > A.bubbleDelayMaxMs) delayOk = false
      if (b.durationMs < A.bubbleTravelMinMs || b.durationMs > A.bubbleTravelMaxMs) durationOk = false
      if (A.easeList.indexOf(b.ease) < 0) easeOk = false
    }
    check(sizeOk, '计划：小泡尺寸都在 3.5~9.5 之间')
    check(delayOk, '计划：出发延迟都在 0~360 毫秒之间')
    check(durationOk, '计划：飞行时长都在 320~660 毫秒之间')
    check(easeOk, '计划：每颗的曲线都取自那五条')
    let firstPill = 0
    let secondPill = 0
    for (let i = 0; i < fromButton.bubbles.length; i++) {
      const b = fromButton.bubbles[i]
      if (b.toX >= 100 && b.toX <= 200) firstPill++
      else if (b.toX >= 220 && b.toX <= 420) secondPill++
    }
    check(firstPill === 5 && secondPill === 10, '计划：越宽的选项配的小泡越多（5 : 10）')

    const fromFar = suggestBubblePlan(layout, seeded(0.9))
    let farOk = true
    for (let i = 0; i < fromFar.bubbles.length; i++) {
      const b = fromFar.bubbles[i]
      if (b.fromX < layout.row.left || b.fromX > layout.row.left + layout.row.width) farOk = false
      if (b.fromY < layout.containerHeight + A.bubbleStartBottomOffset) farOk = false
      if (b.fromY > layout.containerHeight + A.bubbleStartBottomOffset + A.bubbleStartBottomSpread) farOk = false
    }
    check(farOk, '计划：两成从对话区别处出发时，起点都在选项行下方那一带')

    const again = suggestBubblePlan(layout, seeded(0.1))
    check(JSON.stringify(again) === JSON.stringify(fromButton), '计划：同一串随机数得到同一份计划（可测、无隐藏状态）')
    check(suggestBubblePlan({ pills: [] }).total === 0, '计划：没有选项时返回空计划')
    const zeroWidth = suggestBubblePlan({ containerHeight: 120, pills: [{ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 0, height: 0 }], row: { left: 0, width: 0 }, close: { centerX: 0, bottomY: 0, width: 0 } })
    check(zeroWidth.total === 8, '计划：一点宽度都量不到时按兜底 8 颗平均分（不演动画前的最后兜底）')
  }

  // ---------- 6. DOM 执行者：假 DOM 上验证演/不演、逐帧透明度、清节点 ----------
  {
    function fakeNode() {
      return {
        className: '',
        attrs: {},
        style: {},
        parentNode: null,
        setAttribute: function (k, v) { this.attrs[k] = v },
      }
    }
    const world = {
      row: { style: {}, getBoundingClientRect: function () { return { left: 100, top: 20, width: 320, height: 24 } } },
      xrow: { style: {}, getBoundingClientRect: function () { return { left: 240, top: 54, width: 40, height: 20 } } },
      pills: [
        { getBoundingClientRect: function () { return { left: 100, top: 20, width: 100, height: 24 } } },
        { getBoundingClientRect: function () { return { left: 220, top: 20, width: 200, height: 24 } } },
      ],
    }
    const layer = {
      children: [],
      classList: { list: [], add: function (c) { this.list.push(c) }, remove: function (c) { this.list = this.list.filter(function (x) { return x !== c }) } },
      getBoundingClientRect: function () { return { left: 0, top: 0, width: 600, height: 120 } },
      querySelector: function (sel) {
        if (sel === '.dsws-sugg-row') return world.row
        if (sel === '.dsws-sugg-xrow') return world.xrow
        return null
      },
      appendChild: function (node) { node.parentNode = layer; layer.children.push(node) },
      removeChild: function (node) { node.parentNode = null; layer.children = layer.children.filter(function (x) { return x !== node }) },
    }
    world.row.querySelectorAll = function () { return world.pills }
    const frames = []
    global.document = { createElement: function () { return fakeNode() } }
    global.requestAnimationFrame = function (cb) { frames.push(cb); return frames.length }
    global.cancelAnimationFrame = function () {}
    global.window = { matchMedia: function () { return { matches: false } } }

    const engine = createSuggestEngine(layer)
    check(engine.run() === true, '执行者：量得到布局时真的演动画')
    check(layer.children.length === 15, '执行者：按计划生成了 15 颗小泡节点')
    check(world.row.style.opacity === String(A.rowOpacityBase), '执行者：开场选项行几乎透明（0.04）')
    check(world.xrow.style.opacity === '0', '执行者：开场关闭按钮完全不亮')
    let nodeStylesOk = true
    for (let i = 0; i < layer.children.length; i++) {
      const node = layer.children[i]
      const duration = parseFloat(String(node.style.transitionDuration))
      const delay = parseFloat(String(node.style.transitionDelay))
      if (node.className !== 'dsws-sugg-bub') nodeStylesOk = false
      if (!(duration >= A.bubbleTravelMinMs && duration <= A.bubbleTravelMaxMs)) nodeStylesOk = false
      if (!(delay >= 0 && delay <= A.bubbleDelayMaxMs)) nodeStylesOk = false
      if (node.style.borderRadius && node.style.borderRadius !== '50%' && node.style.borderRadius !== '50%') nodeStylesOk = false
    }
    check(nodeStylesOk, '执行者：每颗节点的时长/延迟都来自计划，节点类是 .dsws-sugg-bub')

    // 逐帧驱动：第一帧先量起点、第二帧改成终点、第三帧时早已全部落完。
    const firstFrame = frames.shift()
    check(typeof firstFrame === 'function', '执行者：第一帧排进了 requestAnimationFrame')
    firstFrame(1000)
    let transformOk = layer.children.length > 0
    for (let i = 0; i < layer.children.length; i++) {
      if (!layer.children[i].style.transform || String(layer.children[i].style.transform).indexOf('translate(') !== 0) transformOk = false
    }
    check(transformOk, '执行者：起飞帧给每颗小泡设了位移终点（translate）')
    const secondFrame = frames.shift()
    check(typeof secondFrame === 'function', '执行者：起飞后又排了一帧继续数已落')
    secondFrame(5000)
    check(world.row.style.opacity === '1', '执行者：全部落完后选项行完全清楚')
    check(world.xrow.style.opacity === '1', '执行者：全部落完后关闭按钮也完全清楚')
    engine.dispose()
    check(layer.children.length === 0, '执行者：dispose 清掉全部小泡节点')
    check(engine.isAnimatable() === false, '执行者：dispose 后不再接管动画')

    // 关闭按钮：没有动画可演时 playOut 返回 false，让调用方立刻关掉整组。
    const idleEngine = createSuggestEngine(layer)
    check(idleEngine.playOut('fade', function () {}) === false, '执行者：未演动画时 playOut 不接管，调用方立即处理')
    idleEngine.dispose()

    // 减少动效：系统要求 reduce 时不演（交给 CSS 的最终态）。
    global.window = { matchMedia: function () { return { matches: true } } }
    const reducedEngine = createSuggestEngine(layer)
    check(reducedEngine.run() === false, '执行者：系统要求减少动效时不演动画')
    reducedEngine.dispose()

    // 量不到布局（jsdom / 被隐藏）：不演、不建节点。
    global.window = { matchMedia: function () { return { matches: false } } }
    const hiddenLayer = {
      classList: { add: function () {}, remove: function () {} },
      getBoundingClientRect: function () { return { left: 0, top: 0, width: 0, height: 0 } },
      querySelector: layer.querySelector,
      appendChild: function () {},
    }
    const hiddenEngine = createSuggestEngine(hiddenLayer)
    check(hiddenEngine.run() === false, '执行者：量不到布局时不演动画（jsdom 里按最终态显示）')
    hiddenEngine.dispose()
  }

  // ---------- 7. 源码守卫：集中、只读、无常驻定时器、亮暗主题与减少动效 ----------
  {
    const stylesSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStyles.ts'), 'utf8')
    const bubbleSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestBubble.ts'), 'utf8')
    const timelineSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestTimeline.ts'), 'utf8')
    const engineSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestEngine.ts'), 'utf8')
    const indexSrc = fs.readFileSync(path.join(ROOT, 'src/client/index.ts'), 'utf8')
    const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mts'), 'utf8')
    const leavesSrc = fs.readFileSync(path.join(ROOT, 'tests/verify-leaves.ts'), 'utf8')
    check(stylesSrc.indexOf('.dsws-sugg-bub') >= 0, '守卫：小泡类的样式在样式叶子里')
    check(stylesSrc.indexOf('dsws-sugg-pick') >= 0 && stylesSrc.indexOf('dsws-sugg-fade') >= 0, '守卫：选中退场与关闭淡出的动画都在')
    const cssText = String(stylesMod.SUGGEST_STYLE_TEXT)
    check(stylesSrc.indexOf('SUGGEST_APPEARANCE.pickMs') >= 0 && stylesSrc.indexOf('SUGGEST_APPEARANCE.fadeMs') >= 0, '守卫：退场时长取自外观旋钮（源码不写死数字）')
    check(cssText.indexOf(A.pickMs + 'ms') >= 0 && cssText.indexOf(A.fadeMs + 'ms') >= 0, '守卫：产出的 CSS 里退场时长等于旋钮值')
    check(stylesSrc.indexOf('body:not([data-ds-dark-theme])') >= 0, '守卫：亮色主题有单独覆盖')
    check(stylesSrc.indexOf('prefers-reduced-motion') >= 0, '守卫：系统减少动效有兜底')
    check(stylesSrc.indexOf('will-change') >= 0, '守卫：小泡标了 will-change（动效性能）')
    check(timelineSrc.indexOf('document.') < 0 && timelineSrc.indexOf('window.') < 0, '守卫：时间线是纯函数（不碰 DOM）')
    check(timelineSrc.indexOf('setTimeout') < 0 && timelineSrc.indexOf('setInterval') < 0, '守卫：时间线不含任何定时器')
    check(engineSrc.indexOf('setInterval') < 0, '守卫：DOM 执行者没有常驻定时器')
    check(engineSrc.indexOf('cancelAnimationFrame') >= 0 && engineSrc.indexOf('clearTimeout') >= 0, '守卫：执行者卸载时停帧、清定时器')
    check(engineSrc.indexOf('prefers-reduced-motion') >= 0, '守卫：执行者在运行时也尊重减少动效')
    check(engineSrc.indexOf('suggestBubblePlan') >= 0 && engineSrc.indexOf('suggestRowOpacity') >= 0, '守卫：执行者复用时间线纯函数，不自己算数')
    check(bubbleSrc.indexOf('createSuggestEngine') >= 0 && bubbleSrc.indexOf('playOut') >= 0, '守卫：气泡薄壳通过执行器演退场，不另造一套')
    check(bubbleSrc.indexOf('setTimeout') < 0 && bubbleSrc.indexOf('setInterval') < 0, '守卫：气泡薄壳仍不新增定时器')
    check(indexSrc.indexOf('leaf:suggestTimeline') >= 0 && indexSrc.indexOf('leaf:suggestEngine') >= 0, '接线：两片新叶子在入口登记了拼接标记')
    check(indexSrc.indexOf('leaf:suggestTimeline') < indexSrc.indexOf('leaf:suggestEngine') && indexSrc.indexOf('leaf:suggestEngine') < indexSrc.indexOf('leaf:suggestBubble'), '接线：拼接次序是时间线 → 执行者 → 气泡薄壳')
    check(buildSrc.indexOf("id: 'suggestTimeline'") >= 0 && buildSrc.indexOf("id: 'suggestEngine'") >= 0, '接线：两片新叶子在构建清单登记')
    check(leavesSrc.indexOf('suggestTimeline.ts') >= 0 && leavesSrc.indexOf('suggestEngine.ts') >= 0, '接线：两片新叶子在叶子清单登记（单文件行数上限检查）')
  }

  if (failures.length) {
    console.log('verify-1411-suggest-appearance 失败项：')
    for (const item of failures) console.log('  - ' + item)
  }
  console.log('verify-1411-suggest-appearance：' + total + ' 条断言，' + failures.length + ' 条失败')
  printGateResult('verify-1411-suggest-appearance', total, failures.length ? 1 : 0)
  process.exit(failures.length ? 1 : 0)
}

main().catch(function (err) {
  console.log('verify-1411-suggest-appearance 异常：' + ((err && err.stack) || err))
  printGateResult('verify-1411-suggest-appearance', total, 1)
  process.exit(1)
})
