// src/client/statusbar/suggestEngine.ts —— 「下一步建议」小泡动效的 DOM 执行者（#1411）
//
// 职责：整组气泡挂载后，量一次布局、按 suggestTimeline 算好的计划生成小泡节点、用 CSS transition
// 把它们从关闭按钮下方（或对话区）送到各自选项里侧，同时逐帧抬高选项行与关闭按钮行的共用透明度；
// 选中一条时关闭按钮先消失、每个选项胶囊化作小泡向上飘走（#1451 用户拍板），关闭与被覆盖仍走整组淡出。
// 所有算术都在 suggestTimeline（纯函数、可脱 DOM 测），这里只做测量、建节点、套样式、清节点。
//
// 为什么这么切：动效参数与时间线要能在门禁里精确验证，不能靠「真跑一遍动画看着像」；把算术抽成
// 纯函数以后，这层只剩机械动作，jsdom 里量不到布局（矩形全是 0）时直接不演、按最终态显示，
// 所以 #1411 第一次提交的那批交互测试一行都不用改。
//
// 边界（票面 #1411）：
//   - 不新增常驻定时器：只在整组存活期间挂 requestAnimationFrame 循环，落地后停；清小泡、入场
//     收尾与退场各用一个一次性的 setTimeout，dispose 里全部清掉；
//   - 尊重系统「减少动效」：matchMedia 命中就直接不演，交给 CSS 的最终态；
//   - 只读借用：本文件不碰会话服务。
//
// 契约（与仓库其它叶子文件同一套）：模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply
// 闭包；运行时不许跨文件 import；不许 export default；只写可剥离的 TypeScript。
declare const SUGGEST_APPEARANCE: any;
declare function suggestBubblePlan(layout: any, rand?: any): any;
declare function suggestPickPlan(layout: any, rand?: any): any;
declare function suggestRowOpacity(landed: any, total: any): number;
declare function suggestCloseOpacity(landed: any, total: any): number;
declare function suggestLandedCount(bubbles: any, elapsedMs: any): number;

/**
 * 给一整组气泡建一个动效执行器。layerEl 是挂到页面浮层上的那一层容器（.dsws-sugg-layer），
 * 里面约定有 .dsws-sugg-row（选项行）、.dsws-sugg-xrow（关闭按钮行）与若干 .dsws-sugg-pill。
 * 返回 { run, playOut, dispose }：run 在挂载后调一次；playOut 在点击/关闭时调；dispose 卸载时调。
 */
export const createSuggestEngine = function (layerEl: any) {
  let disposed = false
  // 是否真的演了动画：量不到布局、没有小泡数、系统要求减少动效时都是 false，调用方按最终态处理。
  let animatable = false
  let frame = 0
  let cleanupTimer: any = 0
  let outTimer: any = 0
  let bubbles: any[] = []
  const nodes: any[] = []

  /** 停掉入场那趟：取消逐帧与清尾定时器（退场接管或卸载时调，免得两趟动画抢同一批行与小泡）。 */
  function stopEntrance() {
    if (frame) {
      try { cancelAnimationFrame(frame) } catch (eFrame) {}
      frame = 0
    }
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = 0 }
  }

  /** 清掉全部小泡节点（不动两行透明度）。 */
  function clearBubbles() {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      try { if (node && node.parentNode) node.parentNode.removeChild(node) } catch (eRemove) {}
    }
    nodes.length = 0
    bubbles = []
  }

  /** 收尾：小泡清掉、两行回到全清楚（动画结束后的稳定态）。 */
  function settle() {
    clearBubbles()
    try {
      const row = layerEl.querySelector('.dsws-sugg-row')
      const xrow = layerEl.querySelector('.dsws-sugg-xrow')
      if (row && row.style) row.style.opacity = '1'
      if (xrow && xrow.style) xrow.style.opacity = '1'
    } catch (eSettle) {}
  }

  /** 系统是否要求减少动效（拿不到 matchMedia 就当没要求）。 */
  function prefersReducedMotion() {
    try {
      if (typeof window === 'undefined' || !window.matchMedia) return false
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      return !!(query && query.matches)
    } catch (eReduce) { return false }
  }

  /** 量一遍布局：坐标都换算成「整组容器左上角为原点」的 CSS 像素。量不到返回 null。 */
  function measureLayout() {
    const row = layerEl.querySelector('.dsws-sugg-row')
    const xrow = layerEl.querySelector('.dsws-sugg-xrow')
    if (!row || !xrow) return null
    const pillNodes = row.querySelectorAll('.dsws-sugg-pill')
    if (!pillNodes || !pillNodes.length) return null
    if (typeof layerEl.getBoundingClientRect !== 'function') return null
    const layerRect = layerEl.getBoundingClientRect()
    if (!layerRect || (!layerRect.width && !layerRect.height)) return null
    const left0 = Number(layerRect.left) || 0
    const top0 = Number(layerRect.top) || 0
    const pills: any[] = []
    for (let i = 0; i < pillNodes.length; i++) {
      const node = pillNodes[i]
      if (!node || typeof node.getBoundingClientRect !== 'function') return null
      const rect = node.getBoundingClientRect()
      if (!rect) return null
      pills.push({
        left: (Number(rect.left) || 0) - left0,
        top: (Number(rect.top) || 0) - top0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0,
      })
    }
    const rowRect = row.getBoundingClientRect()
    const xrowRect = xrow.getBoundingClientRect()
    return {
      containerHeight: Number(layerRect.height) || 0,
      pills: pills,
      row: {
        left: (Number(rowRect.left) || 0) - left0,
        width: Number(rowRect.width) || 0,
      },
      close: {
        centerX: (Number(xrowRect.left) || 0) - left0 + (Number(xrowRect.width) || 0) / 2,
        bottomY: (Number(xrowRect.bottom) || 0) - top0,
        width: Number(xrowRect.width) || 0,
      },
    }
  }

  /** 建一颗小泡节点：起点、尺寸、飞行时长/延迟/曲线都在计划里，节点只负责照做。
   *  入场的小泡从完全透明起飞，起点先加 sway；选中退场的小泡从半透明起飞、起点落在胶囊正中，
   *  sway 留到下一步塞进 transform 里（这样它横向漂出去、不是斜着飞）。 */
  function spawnBubble(bubble: any, opacityFrom: any, centered: any) {
    const size = Math.max(1, Number(bubble.size) || 1)
    const fromX = Number(bubble.fromX) || 0
    const startX = centered ? fromX : fromX + (Number(bubble.sway) || 0)
    const node = document.createElement('span')
    node.className = 'dsws-sugg-bub'
    node.setAttribute('aria-hidden', 'true')
    const style = node.style
    style.left = (startX - size / 2) + 'px'
    style.top = ((Number(bubble.fromY) || 0) - size / 2) + 'px'
    style.width = size + 'px'
    style.height = size + 'px'
    style.transitionProperty = 'transform,opacity'
    style.transitionDuration = (Number(bubble.durationMs) || 0) + 'ms'
    style.transitionDelay = (Number(bubble.delayMs) || 0) + 'ms'
    style.transitionTimingFunction = String(bubble.ease || 'ease-out')
    style.opacity = String(opacityFrom)
    layerEl.appendChild(node)
    nodes.push(node)
    return node
  }

  /**
   * 演一遍入场：量布局 → 算计划 → 逐颗生成小泡 → 下一帧统一起飞 → 逐帧抬高两行透明度。
   * 返回是否真的演了（false 表示调用方应按最终态显示，别再等动画）。
   */
  function run() {
    if (disposed || !layerEl) return false
    if (prefersReducedMotion()) return false
    if (typeof requestAnimationFrame !== 'function' || typeof document === 'undefined') return false
    const layout = measureLayout()
    if (!layout) return false
    const plan = suggestBubblePlan(layout)
    if (!plan || !plan.total || !plan.bubbles || !plan.bubbles.length) return false
    bubbles = plan.bubbles
    const total = plan.total
    animatable = true
    const row = layerEl.querySelector('.dsws-sugg-row')
    const xrow = layerEl.querySelector('.dsws-sugg-xrow')
    try {
      if (row && row.style) row.style.opacity = String(suggestRowOpacity(0, total))
      if (xrow && xrow.style) xrow.style.opacity = '0'
    } catch (eInitial) {}
    for (let i = 0; i < bubbles.length; i++) spawnBubble(bubbles[i], 0, false)
    // 第一帧先让起点生效（opacity 从 0 到 0.9 也算一段），下一帧再统一改成终点，过渡才会真的走。
    frame = requestAnimationFrame(function () {
      frame = 0
      if (disposed) return
      for (let i = 0; i < nodes.length && i < bubbles.length; i++) {
        const bubble = bubbles[i]
        const node = nodes[i]
        if (!node || !node.style) continue
        const dx = (Number(bubble.toX) || 0) - (Number(bubble.fromX) || 0) - (Number(bubble.sway) || 0)
        const dy = (Number(bubble.toY) || 0) - (Number(bubble.fromY) || 0)
        node.style.opacity = '0.9'
        node.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'
      }
      tick(0)
    })
    let started = -1
    function tick(ts: number) {
      if (disposed) return
      const stamp = (typeof ts === 'number' && ts > 0) ? ts : 0
      if (started < 0) started = stamp
      const elapsed = stamp - started
      const landed = suggestLandedCount(bubbles, elapsed)
      try {
        if (row && row.style) row.style.opacity = String(suggestRowOpacity(landed, total))
        if (xrow && xrow.style) xrow.style.opacity = String(suggestCloseOpacity(landed, total))
      } catch (eTick) {}
      if (landed >= total) {
        cleanupTimer = setTimeout(function () { cleanupTimer = 0; if (!disposed) settle() }, SUGGEST_APPEARANCE.bubbleCleanupDelayMs)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    return true
  }

  /**
   * 选中一条的退场（#1451）：关闭按钮立刻消失，每个选项胶囊化作几颗小泡从原地向上飘走，
   * 全部飘完（plan.endMs + 尾巴）后再调 done 收起整组。量不到布局或算不出计划时返回 false。
   */
  function playPickOut(done: any) {
    const layout = measureLayout()
    if (!layout) return false
    const plan = suggestPickPlan(layout)
    if (!plan || !plan.total || !plan.bubbles || !plan.bubbles.length) return false
    stopEntrance()
    try {
      const row = layerEl.querySelector('.dsws-sugg-row')
      const xrow = layerEl.querySelector('.dsws-sugg-xrow')
      // 两行一起立刻隐去：用户看到的先是「关闭按钮没了」，再是胶囊化泡上飘。
      if (row && row.style) row.style.opacity = '0'
      if (xrow && xrow.style) {
        xrow.style.opacity = '0'
        xrow.style.pointerEvents = 'none'
      }
    } catch (eHide) {}
    clearBubbles()
    const outBubbles = plan.bubbles
    for (let i = 0; i < outBubbles.length; i++) spawnBubble(outBubbles[i], 0.85, true)
    frame = requestAnimationFrame(function () {
      frame = 0
      if (disposed) return
      for (let i = 0; i < nodes.length && i < outBubbles.length; i++) {
        const bubble = outBubbles[i]
        const node = nodes[i]
        if (!node || !node.style) continue
        node.style.opacity = '0'
        const dy = (Number(bubble.toY) || 0) - (Number(bubble.fromY) || 0)
        node.style.transform = 'translate(' + (Number(bubble.sway) || 0) + 'px,' + dy + 'px)'
      }
    })
    outTimer = setTimeout(function () {
      outTimer = 0
      if (disposed) return
      try { if (typeof done === 'function') done() } catch (eDone) {}
    }, (Number(plan.endMs) || 0) + (Number(SUGGEST_APPEARANCE.pickBubbleTailMs) || 0))
    return true
  }

  /**
   * 退场：kind 是 'pick'（选中一条，胶囊化作小泡上飘）或 'fade'（关闭/被覆盖，整组淡出）。
   * 返回 true 表示已经接管退场（到点会调 done）；false 表示没演，调用方立刻自己处理。
   */
  function playOut(kind: string, done: any) {
    if (disposed || !animatable || !layerEl) return false
    if (kind === 'pick') return playPickOut(done)
    stopEntrance()
    clearBubbles()
    const cls = 'dsws-sugg-fading'
    const wait = SUGGEST_APPEARANCE.fadeMs
    try { if (layerEl.classList) layerEl.classList.add(cls) } catch (eClass) { return false }
    outTimer = setTimeout(function () {
      outTimer = 0
      if (disposed) return
      try { if (typeof done === 'function') done() } catch (eDone) {}
    }, Number(wait) || 0)
    return true
  }

  /** 卸载：停帧、清定时器、清小泡、摘退场 class（幂等）。 */
  function dispose() {
    if (disposed) return
    disposed = true
    animatable = false
    if (frame) {
      try { cancelAnimationFrame(frame) } catch (eFrame) {}
      frame = 0
    }
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = 0 }
    if (outTimer) { clearTimeout(outTimer); outTimer = 0 }
    clearBubbles()
    try {
      if (layerEl && layerEl.classList) layerEl.classList.remove('dsws-sugg-fading')
    } catch (eClean) {}
  }

  return { run: run, playOut: playOut, dispose: dispose, isAnimatable: function () { return animatable } }
}
