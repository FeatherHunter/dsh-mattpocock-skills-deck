// src/client/statusbar/suggestTimeline.ts —— 「下一步建议」小泡动效的纯函数（#1411）
//
// 职责：只做算术，不碰 DOM、不读真实时钟、不生成节点。它接收一份量好的布局（每颗选项的矩形、
// 关闭按钮的位置、整组高度），输出「这颗小泡从哪出发、飞到哪、延迟多久、飞多久、用哪条曲线」，
// 以及「已落 n 颗时选项行与关闭按钮行各自该多清楚」。DOM 那一片（suggestEngine.ts）只负责测量、
// 生成节点和逐帧套用这里算好的计划 —— 这样时间线可以在门禁里用假随机数直接验，不必真跑动画。
//
// 数值全部来自 suggestAppearance（外观旋钮集中一处）；口径是规格 #1397 定稿原型 C 版的数值清单。
//
// 契约（与仓库其它叶子文件同一套）：模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply
// 闭包；运行时不许跨文件 import；不许 export default；只写可剥离的 TypeScript。
declare const SUGGEST_APPEARANCE: any;

/** 把数字夹在区间里；不是有限数就退回下限。 */
function suggestClampNumber(value: any, min: number, max: number) {
  const n = Number(value)
  if (!isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/**
 * 每颗选项配几颗小泡：每 bubblePxPerPill 像素一颗，最少 bubbleMinPerPill 颗。
 * 一行都没量到宽度（全是 0）时返回空数组 —— 调用方据此直接按最终态显示，不演动画。
 */
export const suggestBubbleCounts = function (pillWidths: any) {
  const widths = Array.isArray(pillWidths) ? pillWidths : []
  const counts: number[] = []
  let sum = 0
  for (let i = 0; i < widths.length; i++) {
    const width = Math.max(0, Number(widths[i]) || 0)
    sum += width
    counts.push(Math.max(
      SUGGEST_APPEARANCE.bubbleMinPerPill,
      Math.round(width / SUGGEST_APPEARANCE.bubblePxPerPill)
    ))
  }
  if (!sum) return []
  return counts
}

/** 选项行共用透明度：已落比例按曲线抬高，全部落完才到 1（C 版：基数 0.04 + 0.96 * 比例的 0.8 次方）。 */
export const suggestRowOpacity = function (landed: any, total: any) {
  const count = Math.max(0, Number(total) || 0)
  if (!count) return 1
  const ratio = suggestClampNumber((Number(landed) || 0) / count, 0, 1)
  return SUGGEST_APPEARANCE.rowOpacityBase + SUGGEST_APPEARANCE.rowOpacitySpan * Math.pow(ratio, SUGGEST_APPEARANCE.rowOpacityCurve)
}

/** 关闭按钮行透明度：比选项行慢半拍（C 版用比例的平方，前段几乎不亮）。 */
export const suggestCloseOpacity = function (landed: any, total: any) {
  const count = Math.max(0, Number(total) || 0)
  if (!count) return 1
  const ratio = suggestClampNumber((Number(landed) || 0) / count, 0, 1)
  return Math.pow(ratio, SUGGEST_APPEARANCE.closeRevealCurve)
}

/** 到 elapsedMs 为止已经落地的小泡数：按每颗的「延迟 + 飞行」算出它自己的到达时刻。 */
export const suggestLandedCount = function (bubbles: any, elapsedMs: any) {
  const list = Array.isArray(bubbles) ? bubbles : []
  const elapsed = Math.max(0, Number(elapsedMs) || 0)
  let landed = 0
  for (let i = 0; i < list.length; i++) {
    const bubble = list[i]
    if (!bubble) continue
    if ((Number(bubble.delayMs) || 0) + (Number(bubble.durationMs) || 0) <= elapsed) landed++
  }
  return landed
}

/**
 * 算整组小泡的计划。layout = { containerHeight, pills: [{left, top, width, height}],
 * row: {left, width}, close: {centerX, bottomY, width} }，单位都是整组容器内的 CSS 像素；
 * rand 可注入（测试用），缺省 Math.random。返回 { bubbles, total }，每颗:
 * { size, fromX, fromY, toX, toY, delayMs, durationMs, ease, sway }。
 */
export const suggestBubblePlan = function (layout: any, rand: any) {
  const random = (typeof rand === 'function') ? rand : Math.random
  const layoutSafe = (layout && typeof layout === 'object') ? layout : {}
  const pills = Array.isArray(layoutSafe.pills) ? layoutSafe.pills : []
  const row = layoutSafe.row || { left: 0, width: 0 }
  const close = layoutSafe.close || { centerX: 0, bottomY: 0, width: 0 }
  const containerHeight = Math.max(0, Number(layoutSafe.containerHeight) || 0)
  if (!pills.length) return { bubbles: [], total: 0 }

  let counts = suggestBubbleCounts(pills.map(function (pill: any) { return pill && pill.width }))
  if (!counts.length) {
    // 量不到任何宽度时的兜底：按 bubbleFallbackCount 平均分给每颗选项（正常路径用不到）。
    const each = Math.max(0, Math.round(SUGGEST_APPEARANCE.bubbleFallbackCount / pills.length))
    counts = pills.map(function () { return each })
  }
  const slots: any[] = []
  for (let i = 0; i < pills.length; i++) {
    for (let n = 0; n < counts[i]; n++) slots.push(pills[i])
  }
  // 打乱落点顺序：哪颗泡先落与它落在哪颗选项无关（C 版定稿做法）。
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = slots[i]
    slots[i] = slots[j]
    slots[j] = tmp
  }

  const eases = Array.isArray(SUGGEST_APPEARANCE.easeList) ? SUGGEST_APPEARANCE.easeList : ['ease-out']
  const bubbles: any[] = []
  for (let i = 0; i < slots.length; i++) {
    const pill = slots[i] || { left: 0, top: 0, width: 0, height: 0 }
    const pillLeft = Number(pill.left) || 0
    const pillTop = Number(pill.top) || 0
    const pillWidth = Math.max(0, Number(pill.width) || 0)
    const pillHeight = Math.max(0, Number(pill.height) || 0)

    const size = SUGGEST_APPEARANCE.bubbleSizeMin + random() * SUGGEST_APPEARANCE.bubbleSizeRange
    const fromButton = random() < SUGGEST_APPEARANCE.bubbleFromButtonRatio
    let fromX = 0
    let fromY = 0
    if (fromButton) {
      const spread = (Number(close.width) || 0) / 2 + SUGGEST_APPEARANCE.bubbleButtonSpreadPx
      fromX = (Number(close.centerX) || 0) + (random() * 2 - 1) * spread
      fromX = suggestClampNumber(fromX, (Number(row.left) || 0) - SUGGEST_APPEARANCE.bubbleClampPx, (Number(row.left) || 0) + (Number(row.width) || 0) + SUGGEST_APPEARANCE.bubbleClampPx)
      fromY = (Number(close.bottomY) || 0) + SUGGEST_APPEARANCE.bubbleStartTopOffset + random() * SUGGEST_APPEARANCE.bubbleStartTopSpread
    } else {
      fromX = (Number(row.left) || 0) + (Number(row.width) || 0) * (0.04 + random() * 0.92)
      fromY = containerHeight + SUGGEST_APPEARANCE.bubbleStartBottomOffset + random() * SUGGEST_APPEARANCE.bubbleStartBottomSpread
    }
    const toX = pillLeft + pillWidth * (SUGGEST_APPEARANCE.bubbleArriveMinRatio + random() * SUGGEST_APPEARANCE.bubbleArriveSpanRatio)
    const toY = pillTop + pillHeight * (SUGGEST_APPEARANCE.bubbleArriveRowMinRatio + random() * SUGGEST_APPEARANCE.bubbleArriveRowSpanRatio)
    const delayMs = random() * SUGGEST_APPEARANCE.bubbleDelayMaxMs
    const durationMs = SUGGEST_APPEARANCE.bubbleTravelMinMs + random() * (SUGGEST_APPEARANCE.bubbleTravelMaxMs - SUGGEST_APPEARANCE.bubbleTravelMinMs)
    const ease = eases[Math.floor(random() * eases.length) % eases.length]
    const sway = (random() * 2 - 1) * SUGGEST_APPEARANCE.bubbleSwayPx
    bubbles.push({ size: size, fromX: fromX, fromY: fromY, toX: toX, toY: toY, delayMs: delayMs, durationMs: durationMs, ease: ease, sway: sway })
  }
  return { bubbles: bubbles, total: bubbles.length }
}

/**
 * 算「选中一条之后」的退场计划（#1451）：每一颗选项胶囊化作若干小泡，从胶囊所在的位置向上飘走。
 * layout 与 suggestBubblePlan 是同一份量好的布局；rand 可注入（测试用），缺省 Math.random。
 * 返回 { bubbles, total, endMs }：每颗 { size, fromX, fromY, toY, delayMs, durationMs, ease, sway }，
 * endMs 是最后一颗飞完的时刻，调用方按它加一点余量再收起整组。
 * 没有量到胶囊（layout 不可用或 pills 为空）时返回 total 0，调用方据此直接收起，不演动画。
 */
export const suggestPickPlan = function (layout: any, rand: any) {
  const random = (typeof rand === 'function') ? rand : Math.random
  const layoutSafe = (layout && typeof layout === 'object') ? layout : {}
  const pills = Array.isArray(layoutSafe.pills) ? layoutSafe.pills : []
  if (!pills.length) return { bubbles: [], total: 0, endMs: 0 }

  const eases = Array.isArray(SUGGEST_APPEARANCE.easeList) ? SUGGEST_APPEARANCE.easeList : ['ease-out']
  const bubbles: any[] = []
  let endMs = 0
  for (let i = 0; i < pills.length; i++) {
    const pill = pills[i] || { left: 0, top: 0, width: 0, height: 0 }
    const pillLeft = Number(pill.left) || 0
    const pillTop = Number(pill.top) || 0
    const pillWidth = Math.max(0, Number(pill.width) || 0)
    const pillHeight = Math.max(0, Number(pill.height) || 0)
    const count = Math.min(
      SUGGEST_APPEARANCE.pickBubbleMaxPerPill,
      Math.max(
        SUGGEST_APPEARANCE.pickBubbleMinPerPill,
        Math.round(pillWidth / SUGGEST_APPEARANCE.pickBubblePxPerPill)
      )
    )
    for (let n = 0; n < count; n++) {
      const size = SUGGEST_APPEARANCE.bubbleSizeMin + random() * SUGGEST_APPEARANCE.bubbleSizeRange
      const fromX = pillLeft + pillWidth * (0.2 + random() * 0.6)
      const fromY = pillTop + pillHeight * (0.25 + random() * 0.5)
      const rise = SUGGEST_APPEARANCE.pickBubbleRiseMinPx + random() * (SUGGEST_APPEARANCE.pickBubbleRiseMaxPx - SUGGEST_APPEARANCE.pickBubbleRiseMinPx)
      const delayMs = random() * SUGGEST_APPEARANCE.pickBubbleDelayMaxMs
      const durationMs = SUGGEST_APPEARANCE.pickBubbleTravelMinMs + random() * (SUGGEST_APPEARANCE.pickBubbleTravelMaxMs - SUGGEST_APPEARANCE.pickBubbleTravelMinMs)
      const ease = eases[Math.floor(random() * eases.length) % eases.length]
      const sway = (random() * 2 - 1) * SUGGEST_APPEARANCE.pickBubbleSwayPx
      endMs = Math.max(endMs, delayMs + durationMs)
      bubbles.push({ size: size, fromX: fromX, fromY: fromY, toY: fromY - rise, delayMs: delayMs, durationMs: durationMs, ease: ease, sway: sway })
    }
  }
  return { bubbles: bubbles, total: bubbles.length, endMs: endMs }
}
