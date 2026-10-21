/**
 * kernel/entry-card.ts —— 入口浮层里那两张选择卡的卡面画法（#1297：入口浮层）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥掉行首 export，
 * 把声明体拼回 src/client/index.ts 的 `// ==== kernel:entryCard (spliced by build) ====`
 * 标记处（源码树里只有这一份真源）。本文件只画卡：插图、技能链、三行文字，
 * 不读状态、不接线、不发日志 —— 那几件事在 kernel/entry-choice.ts 里，一个入口只收一处。
 *
 * 卡面文案一个字都不写在这：眉标、状态句、主体文本、技能链上的每个词都从
 * config/copy/cards.yaml 生成出来的词表里取（键名 card.entry.*），这里只留键名。
 * 颜色同样不写死探索紫与规格蓝：身份色一律读中央色表 CONTAINER_ACCENT，
 * 免得再出现一份「卡上一个紫、别处另一个紫」的副本（#1296 的教训）。
 *
 * 尺寸与排版照 2026-10-20 定稿的原型 docs/prototype/1290-entry-in-real-ui.html：
 * 卡 368×232；左上是一块 184×116 的插图底板，里面再嵌一张 168×104 的画布；
 * 右栏宽 144px（12px 全角字一行正好 12 个字）；底部一条 344×80 的技能链。
 * 换字号、改宽度要连着断行上限一起改，否则主体文本会多出一行（验收要求最多三行）。
 */

declare const h: any
declare const tr: (...args: any[]) => any
declare const CONTAINER_ACCENT: any
declare const CONTAINER_DONE_COLOR: any

export const ENTRY_CARD_W = 368
export const ENTRY_CARD_H = 232
// 右栏从 x=208 起、到卡片右沿留 16px，正文可用宽度 144px；12px 全角字一行正好 12 个。
const BODY_X = 208
const BODY_TOP = 86
const BODY_SIZE = 12
const BODY_LINE_H = 17
// 插图与技能链底板的公用外观（照原型：更暗一档的底、细边框）。
const PANEL_FILL = '#0a0c10'
const PANEL_STROKE = '#2a2d35'
const MONO = 'Consolas,Menlo,monospace'
// 「已完成」的绿不在这里另开一份：容器三态与实施票勾共用中央色表里的 CONTAINER_DONE_COLOR，
// 卡面插图的勾也读它，免得多处各写一个绿、以后改色漏掉一处。
// #1343：不再写同值兜底——中央色表要是缺了，退回空串（真机不会缺），真源才真只有一处。
const DONE_GREEN = (typeof CONTAINER_DONE_COLOR === 'string' && CONTAINER_DONE_COLOR) ? CONTAINER_DONE_COLOR : ''
// 实施地图这一侧的两个浅蓝：身份深蓝只用在卡边框上，文字与线条用浅一档的同族色。
const IMPL_LINE = '#93c5fd'
const IMPL_TEXT = '#bfdbfe'
// 探索地图这一侧的浅紫同理。
const EXPLORE_TEXT = '#e9d5ff'

/**
 * 把 #rrggbb 展开成带透明度的 rgba()。为什么不用写死的 rgba 字面量：
 * 身份色只有中央色表一处真源，透明度是画法而不是颜色，改色时不该陪着一起来回改。
 */
function withAlpha(hex: any, alpha: number): string {
  const raw = String(hex == null ? '' : hex).replace('#', '')
  const full = raw.length === 3 ? raw.charAt(0) + raw.charAt(0) + raw.charAt(1) + raw.charAt(1) + raw.charAt(2) + raw.charAt(2) : raw
  const n = parseInt(full, 16)
  if (full.length !== 6 || !isFinite(n)) return 'rgba(255,255,255,' + alpha + ')'
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')'
}

/** 两张卡各自的取色：探索地图读中央色表的 map，实施地图读 spec（深蓝只上边框）。 */
function cardColors(kind: any) {
  const table = (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT : {}
  const identity = String((kind === 'map' ? table.map : table.spec) || '')
  if (kind === 'map') return { identity: identity, borderAlpha: 0.45, line: identity, text: EXPLORE_TEXT, glow: identity }
  return { identity: identity, borderAlpha: 0.75, line: IMPL_LINE, text: IMPL_TEXT, glow: '#60a5fa' }
}

// 渐变 id 要在整页唯一：两张卡、两个窗口各画一份，id 撞了后者会拿到前者的颜色。
let entryArtSeq = 0
function nextArtId(): string {
  entryArtSeq += 1
  return 'dsws-entry-art-' + entryArtSeq
}

function svgText(x: number, y: number, text: any, size: number, fill: any, extra?: any) {
  const attrs: any = { x: x, y: y, fontSize: size, fill: fill }
  if (extra) {
    if (extra.weight != null) attrs.fontWeight = extra.weight
    if (extra.anchor) attrs.textAnchor = extra.anchor
    if (extra.spacing != null) attrs.letterSpacing = extra.spacing
    if (extra.opacity != null) attrs.fillOpacity = extra.opacity
    if (extra.family) attrs.fontFamily = extra.family
  }
  return h('text', attrs, String(text == null ? '' : text))
}

// ===== 主体文本断行 =====
// 中文按词切、西文按词切，都靠这两个上限：行宽 12 个汉字（西文 24 个字符）。
// 「想清楚 / 没想清楚 / 什么程度」这类词必须整体进出，否则会出现「没想清 / 楚」这种断法。
const NO_LINE_START = '，。、；：！？）】》」』%'
const NO_LINE_END = '（【《「『('
const KEEP_WORDS = ['规格', '实施票', '文档', '问号', '开工', '没定', '一条', '几条', '到底', '问清', '清楚', '想清楚', '没想清楚', '什么程度', '细节', '做到', '写成', '落成', '消掉', '摊开', '分头', '探出', '探路', '一排', '每个', '什么', '手里', '多了']
const HAS_CJK = /[\u3400-\u9fff]/

/** 把一段话切成「不可再分的小单位」：中文命中保持词就吃整词，否则一个字一格；西文按空格切词。 */
function splitUnits(text: any): string[] {
  const raw = String(text == null ? '' : text)
  if (!HAS_CJK.test(raw)) {
    const words: string[] = []
    raw.split(/\s+/).forEach(function (w: any) {
      if (w) words.push(w)
    })
    return words
  }
  const units: string[] = []
  let i = 0
  while (i < raw.length) {
    let hit = ''
    for (let k = 0; k < KEEP_WORDS.length; k += 1) {
      const w = KEEP_WORDS[k]
      if (w && raw.substr(i, w.length) === w) { hit = w; break }
    }
    if (hit) { units.push(hit); i += hit.length; continue }
    units.push(raw.charAt(i))
    i += 1
  }
  return units
}

/** 单位的显示宽度：中文按 1 格/字，西文按 0.55 格/字符（每行上限是「格」）。 */
function unitWidth(u: string): number {
  return HAS_CJK.test(u) ? u.length : Math.max(1, u.length * 0.55)
}

/** 把单位排成行：放不下时优先在标点后断（句子不被劈成两半），实在没有标点就按当前位置断。 */
function packLines(units: string[], maxUnits: number): string[] {
  const lines: string[] = []
  let cur: string[] = []
  let w = 0
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i]
    const uw = unitWidth(u)
    if (w + uw > maxUnits && cur.length > 0) {
      let cut = -1
      for (let j = cur.length - 1; j >= 0; j -= 1) { if (NO_LINE_START.indexOf(cur[j]) >= 0) { cut = j; break } }
      const head = cut >= 0 ? cur.slice(0, cut + 1) : []
      let headW = 0
      for (let j = 0; j < head.length; j += 1) headW += unitWidth(head[j])
      if (head.length && headW >= Math.ceil(maxUnits * 0.55)) {
        lines.push(head.join(''))
        cur = cur.slice(cut + 1)
        w = 0
        for (let j = 0; j < cur.length; j += 1) w += unitWidth(cur[j])
      } else if (NO_LINE_START.indexOf(u) >= 0 && cur.length > 1) {
        // 这个单位不能出现在行首：把上一行最后一个单位挪下来陪它。
        const last = cur.pop() as string
        lines.push(cur.join(''))
        cur = [last]
        w = unitWidth(last)
      } else {
        lines.push(cur.join(''))
        cur = []
        w = 0
      }
    }
    if (u && NO_LINE_END.indexOf(u) >= 0 && cur.length > 0) {
      cur.push(u)
      lines.push(cur.join(''))
      cur = []
      w = 0
      continue
    }
    cur.push(u)
    w += uw
  }
  if (cur.length) lines.push(cur.join(''))
  return lines
}

// ===== 插图 =====
function gradientDefs(id: string, color: string) {
  return h('defs', null, [
    h('radialGradient', { key: 'g', id: 'g' + id }, [
      h('stop', { key: 'a', offset: '0', stopColor: color, stopOpacity: '.38' }),
      h('stop', { key: 'b', offset: '1', stopColor: color, stopOpacity: '0' }),
    ]),
    h('radialGradient', { key: 'f', id: 'f' + id }, [
      h('stop', { key: 'a', offset: '0', stopColor: color, stopOpacity: '.3' }),
      h('stop', { key: 'b', offset: '.55', stopColor: color, stopOpacity: '.14' }),
      h('stop', { key: 'c', offset: '1', stopColor: color, stopOpacity: '0' }),
    ]),
  ])
}

/** 起点那颗「需求」胶囊：虚线表示还没定形（探索地图），实线表示已经清楚（实施地图）。 */
function needCapsule(x: number, y: number, w: number, hh: number, stroke: string, ink: string, dash: boolean, label: string) {
  const attrs: any = { x: x, y: y, width: w, height: hh, rx: hh / 2, fill: 'rgba(0,0,0,0)', stroke: stroke, strokeWidth: 1.3 }
  if (dash) attrs.strokeDasharray = '3.4 2.4'
  return h('g', null, [
    h('rect', Object.assign({ key: 'r' }, attrs)),
    svgText(x + w / 2, y + hh / 2 + 4, label, 10.5, ink, { anchor: 'middle', spacing: 0.5 }),
  ])
}

function qMark(x: number, y: number, r: number) {
  return h('g', null, [
    h('circle', { key: 'c', cx: x, cy: y, r: r, fill: 'rgba(10,12,16,.92)', stroke: EXPLORE_TEXT, strokeWidth: 1.3 }),
    svgText(x, y + r * 0.38, '?', r * 1.35, EXPLORE_TEXT, { anchor: 'middle' }),
  ])
}

/** 终点环：check=true 是「已达成」（绿勾），false 是「还没到」（空心环）。外圈是同色辉光。 */
function targetRing(x: number, y: number, r: number, color: string, glowId: string, check: boolean) {
  const parts: any[] = [
    h('circle', { key: 'glow', cx: x, cy: y, r: r + 9, fill: 'url(#' + glowId + ')' }),
    h('circle', { key: 'ring', cx: x, cy: y, r: r, fill: '#0b0d11', stroke: color, strokeWidth: 1.4 }),
  ]
  if (check) {
    parts.push(h('path', { key: 'ok', d: 'M' + (x - r * 0.42) + ' ' + y + ' l' + (r * 0.3) + ' ' + (r * 0.34) + ' l' + (r * 0.6) + '-' + (r * 0.68), fill: 'none', stroke: DONE_GREEN, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))
  } else {
    parts.push(h('circle', { key: 'open', cx: x, cy: y, r: r * 0.42, fill: 'none', stroke: color, strokeWidth: 1.1, opacity: '.75' }))
  }
  return h('g', null, parts)
}

/** 一张实施票：蓝框 + 绿勾 + 两条占位字线。 */
function ticketShape(x: number, y: number, w: number, hh: number) {
  return h('g', null, [
    h('rect', { key: 'r', x: x, y: y, width: w, height: hh, rx: 4, fill: 'rgba(29,78,216,.42)', stroke: IMPL_LINE, strokeWidth: 1.2 }),
    h('path', { key: 'ok', d: 'M' + (x + 6) + ' ' + (y + hh / 2) + ' l2.2 2.2 4-4.6', fill: 'none', stroke: DONE_GREEN, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { key: 'l1', d: 'M' + (x + 16) + ' ' + (y + hh / 2 - 2.5) + ' H ' + (x + w - 5), stroke: IMPL_LINE, strokeWidth: 1.2, strokeLinecap: 'round', opacity: '.7' }),
    h('path', { key: 'l2', d: 'M' + (x + 16) + ' ' + (y + hh / 2 + 3) + ' H ' + (x + w - 12), stroke: IMPL_LINE, strokeWidth: 1, strokeLinecap: 'round', opacity: '.35' }),
  ])
}

/** 探索地图插图：一个还没定形的需求，分出去三个问号，都没入雾里，终点是个空的环。 */
function artExplore(id: string, colors: any) {
  const P = colors.line
  const PT = colors.text
  const parts: any[] = [
    gradientDefs(id, colors.glow),
    needCapsule(6, 42, 42, 20, P, PT, true, String(tr('card.entry.need') || '')),
    h('circle', { key: 'k1', cx: 60, cy: 52, r: 5, fill: 'none', stroke: P, strokeOpacity: '.35', strokeWidth: 1 }),
    h('circle', { key: 'k2', cx: 60, cy: 52, r: 2.6, fill: P }),
    h('path', { key: 'k3', d: 'M62 52 H 72', fill: 'none', stroke: P, strokeWidth: 1.6, strokeLinecap: 'round' }),
    h('circle', { key: 'k4', cx: 76, cy: 52, r: 3.6, fill: P }),
    h('path', { key: 'b1', d: 'M76 52 C 84 46 92 26 100 21', fill: 'none', stroke: P, strokeWidth: 1.6, strokeLinecap: 'round', opacity: '.9' }),
    h('path', { key: 'b2', d: 'M76 52 C 86 52 94 52 100 52', fill: 'none', stroke: P, strokeWidth: 1.6, strokeLinecap: 'round', opacity: '.9' }),
    h('path', { key: 'b3', d: 'M76 52 C 84 58 92 78 100 83', fill: 'none', stroke: P, strokeWidth: 1.6, strokeLinecap: 'round', opacity: '.9' }),
    qMark(108, 20, 8),
    qMark(108, 52, 8),
    qMark(108, 84, 8),
    h('path', { key: 'd1', d: 'M116 20 C 128 22 138 40 145 50', fill: 'none', stroke: PT, strokeWidth: 1.2, strokeDasharray: '4 4', strokeLinecap: 'round', opacity: '.45' }),
    h('path', { key: 'd2', d: 'M116 52 C 128 52 138 52 145 52', fill: 'none', stroke: PT, strokeWidth: 1.2, strokeDasharray: '4 4', strokeLinecap: 'round', opacity: '.4' }),
    h('path', { key: 'd3', d: 'M116 84 C 128 82 138 64 145 54', fill: 'none', stroke: PT, strokeWidth: 1.2, strokeDasharray: '4 4', strokeLinecap: 'round', opacity: '.35' }),
    h('circle', { key: 'fog', cx: 152, cy: 52, r: 30, fill: 'url(#f' + id + ')' }),
    targetRing(150, 52, 8, PT, 'g' + id, false),
  ]
  return h('g', null, parts)
}

/** 实施地图插图：一个已经定形的需求，拆成四张实施票，都收在黑点底部、终点带绿勾。 */
function artImpl(id: string, colors: any) {
  const B = IMPL_LINE
  const BT = IMPL_TEXT
  const ys = [8, 31, 54, 77]
  const cys = [16.5, 39.5, 62.5, 85.5]
  const parts: any[] = [gradientDefs(id, colors.glow), needCapsule(6, 42, 42, 20, B, BT, false, String(tr('card.entry.need') || ''))]
  for (let i = 0; i < 4; i += 1) {
    parts.push(h('path', { key: 'a' + i, d: 'M48 52 C 56 52 58 ' + cys[i] + ' 68 ' + cys[i], fill: 'none', stroke: B, strokeWidth: 1.4, strokeLinecap: 'round', opacity: '.75' }))
  }
  for (let j = 0; j < 4; j += 1) {
    parts.push(ticketShape(70, ys[j], 36, 17))
    parts.push(h('path', { key: 'm' + j, d: 'M106 ' + cys[j] + ' C 118 ' + cys[j] + ' 128 ' + (cys[j] < 52 ? cys[j] + 8 : cys[j] - 8) + ' 138 50', fill: 'none', stroke: B, strokeWidth: 1.3, strokeLinecap: 'round', opacity: '.55' }))
  }
  parts.push(targetRing(148, 52, 8, BT, 'g' + id, true))
  return h('g', null, parts)
}

function implIdentity(): string {
  try {
    const table = (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT : {}
    return String(table.spec || '')
  } catch (e) { return '' }
}

// ===== 技能链 =====
// 链上每个节点是一个扁圆角框加等宽字，箭头是一根横线加三角。等宽字按字号估框宽：
// 字体栈第一档是 Consolas，它一个字符正好 0.55 个字宽；汉字占满一个字宽。
// 左边距、分叉、四行技能、花括号、目标明确、两张蓝卡都按原型的位置摆，
// 字号从原型的小字放大到 9.2 之后框会变宽，所以右侧三格依次右移，收尾仍留在底板右边线以内。
// 这一段可用区是 (12,140) 到 (356,220)。
const CHAIN_TOP = 140
const CHAIN_CY = 180
const CHAIN_NODE_H = 16
const CHAIN_FONT = 9.2

function nodeWidth(label: any, size: number): number {
  const text = String(label == null ? '' : label)
  const textW = HAS_CJK.test(text) ? text.length * size : text.length * size * 0.55
  return Math.max(28, Math.ceil(textW) + 5)
}

function chainNode(x: number, y: number, w: number, text: any, opt: any) {
  const o = opt || {}
  const size = o.size || CHAIN_FONT
  const attrs: any = { x: x, y: y, width: w, height: CHAIN_NODE_H, rx: o.rx == null ? 5 : o.rx, fill: o.fill || 'rgba(255,255,255,.04)', stroke: o.stroke || '#8b8b95', strokeWidth: 1 }
  if (o.dash) attrs.strokeDasharray = '3 2'
  return h('g', null, [
    h('rect', Object.assign({ key: 'r' }, attrs)),
    svgText(x + w / 2, y + CHAIN_NODE_H / 2 + size * 0.36, text, size, o.text || '#e6edf3', { anchor: 'middle', family: MONO }),
  ])
}

function chainArrow(x1: number, x2: number, y: number, color: string) {
  return h('g', null, [
    h('path', { key: 'l', d: 'M' + x1 + ' ' + y + ' H' + (x2 - 3), stroke: color, strokeWidth: 1, fill: 'none' }),
    h('path', { key: 'h', d: 'M' + (x2 - 3.4) + ' ' + (y - 2.4) + ' L' + x2 + ' ' + y + ' L' + (x2 - 3.4) + ' ' + (y + 2.4), stroke: color, strokeWidth: 1, fill: 'none' }),
  ])
}

/**
 * 把一列并行技能「收」进下一格：在四行盒子的右沿外侧画一个右开口的 `}` 形花括号。
 * 两头分别落在第一行、最后一行的纵向中点（原型那条汇总竖线就是从第一行中点拉到最后一行的中点，
 * 不是从行顶拉到行底）；中间那道尖朝右指向「目标明确」，再用一小段箭头从尖接到下一格。
 * 原来这里只画一根竖线，看不出是「汇总」而不是一条边界。
 * 参数 x 是括号左侧起点；脊线在 x+5，尖在 x+11、纵向正中是 cy。
 */
function chainBrace(x: number, top: number, bottom: number, cy: number, color: string) {
  const spine = x + 5
  const tip = x + 11
  return h('path', {
    key: 'brace',
    d: 'M' + (x + 2) + ' ' + top +
      ' Q' + spine + ' ' + top + ' ' + spine + ' ' + (top + 8) +
      ' L' + spine + ' ' + (cy - 6) +
      ' Q' + spine + ' ' + cy + ' ' + tip + ' ' + cy +
      ' Q' + spine + ' ' + cy + ' ' + spine + ' ' + (cy + 6) +
      ' L' + spine + ' ' + (bottom - 8) +
      ' Q' + spine + ' ' + bottom + ' ' + (x + 2) + ' ' + bottom,
    stroke: color,
    strokeWidth: 1,
    fill: 'none',
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  })
}

/** 探索地图这条链：/wayfinder 分叉出四个并行技能，四行右沿再用一个花括号汇总进「目标明确」，然后接 /to-spec 与 /to-tickets。 */
function chainExplore(colors: any) {
  const P = colors.line
  const PT = colors.text
  const B = IMPL_LINE
  const BT = IMPL_TEXT
  const rows = [tr('card.entry.chain.prototype'), tr('card.entry.chain.research'), tr('card.entry.chain.grilling'), tr('card.entry.chain.domain')]
  const rowH = CHAIN_NODE_H
  const gap = 2.5
  const cy = CHAIN_CY
  const top = cy - (rows.length * rowH + (rows.length - 1) * gap) / 2
  const bottom = top + (rows.length - 1) * (rowH + gap) + rowH
  const parts: any[] = []
  // 分叉的两段落差都留 6px：箭头三角本身就占 3.4px，再留出线段，箭头才画得出来。
  // 上一版只留 2px，箭头三角整根压在竖干和盒子左边框上，看起来像一个小叉，不像箭头。
  const wayX = 22
  const wWay = nodeWidth(tr('card.entry.chain.wayfinder'), CHAIN_FONT)
  const wayEnd = wayX + wWay
  parts.push(chainNode(wayX, cy - rowH / 2, wWay, tr('card.entry.chain.wayfinder'), { fill: withAlpha(P, 0.12), stroke: P, text: PT, size: CHAIN_FONT }))
  const sx = wayEnd + 6
  const gx = sx + 6
  parts.push(chainArrow(wayEnd, sx, cy, P))
  parts.push(h('path', { key: 'v1', d: 'M' + sx + ' ' + cy + ' V' + (top + rowH / 2), stroke: P, strokeWidth: 1, fill: 'none' }))
  parts.push(h('path', { key: 'v2', d: 'M' + sx + ' ' + cy + ' V' + (bottom - rowH / 2), stroke: P, strokeWidth: 1, fill: 'none' }))
  let colW = 0
  for (let i = 0; i < rows.length; i += 1) {
    const y = top + i * (rowH + gap)
    const w = nodeWidth(rows[i], CHAIN_FONT)
    if (w > colW) colW = w
    parts.push(chainArrow(sx, gx, y + rowH / 2, P))
    parts.push(chainNode(gx, y, w, rows[i], { fill: withAlpha(P, 0.1), stroke: P, text: PT, size: CHAIN_FONT, rx: 4 }))
  }
  const braceX = gx + colW + 2
  const braceTip = braceX + 11
  // 花括号的两头对齐第一行和最后一行的纵向中点，与原型那条汇总竖线一致（行顶到行底会显得括号画大了）。
  parts.push(chainBrace(braceX, top + rowH / 2, bottom - rowH / 2, cy, P))
  const goalX = braceTip + 5
  const goalW = nodeWidth(tr('card.entry.chain.goalClear'), CHAIN_FONT)
  parts.push(chainArrow(braceTip, goalX, cy, P))
  parts.push(chainNode(goalX, cy - rowH / 2, goalW, tr('card.entry.chain.goalClear'), { fill: 'transparent', stroke: '#5c636d', dash: true, text: '#b4bac2', size: CHAIN_FONT, rx: 4 }))
  const spX = goalX + goalW + 5
  const spW = nodeWidth(tr('card.entry.chain.toSpec'), CHAIN_FONT)
  parts.push(chainArrow(goalX + goalW, spX, cy, B))
  parts.push(chainNode(spX, cy - rowH / 2, spW, tr('card.entry.chain.toSpec'), { fill: withAlpha(implIdentity(), 0.3), stroke: B, text: BT, size: CHAIN_FONT, rx: 4 }))
  const tkX = spX + spW + 5
  const tkW = nodeWidth(tr('card.entry.chain.toTickets'), CHAIN_FONT)
  parts.push(chainArrow(spX + spW, tkX, cy, B))
  parts.push(chainNode(tkX, cy - rowH / 2, tkW, tr('card.entry.chain.toTickets'), { fill: withAlpha(implIdentity(), 0.3), stroke: B, text: BT, size: CHAIN_FONT, rx: 4 }))
  return h('g', null, parts)
}

/** 实施地图这条链：/grill-with-docs 讨论收口，跳过四个并行技能的调查段，直接进 /to-spec 与 /to-tickets。 */
function chainImpl() {
  const B = IMPL_LINE
  const BT = IMPL_TEXT
  const rowH = CHAIN_NODE_H
  const cy = CHAIN_CY
  const parts: any[] = []
  const startX = 26
  const grillW = nodeWidth(tr('card.entry.chain.grillWithDocs'), CHAIN_FONT)
  parts.push(chainNode(startX, cy - rowH / 2, grillW, tr('card.entry.chain.grillWithDocs'), { fill: withAlpha(implIdentity(), 0.3), stroke: B, text: BT, size: CHAIN_FONT }))
  const goalX = startX + grillW + 14
  const goalW = nodeWidth(tr('card.entry.chain.goalClear'), CHAIN_FONT)
  parts.push(chainArrow(startX + grillW, goalX, cy, B))
  parts.push(chainNode(goalX, cy - rowH / 2, goalW, tr('card.entry.chain.goalClear'), { fill: 'transparent', stroke: '#5c636d', dash: true, text: '#b4bac2', size: CHAIN_FONT, rx: 4 }))
  const spX = goalX + goalW + 14
  const spW = nodeWidth(tr('card.entry.chain.toSpec'), CHAIN_FONT)
  parts.push(chainArrow(goalX + goalW, spX, cy, B))
  parts.push(chainNode(spX, cy - rowH / 2, spW, tr('card.entry.chain.toSpec'), { fill: withAlpha(implIdentity(), 0.3), stroke: B, text: BT, size: CHAIN_FONT, rx: 4 }))
  const tkX = spX + spW + 14
  const tkW = nodeWidth(tr('card.entry.chain.toTickets'), CHAIN_FONT)
  parts.push(chainArrow(spX + spW, tkX, cy, B))
  parts.push(chainNode(tkX, cy - rowH / 2, tkW, tr('card.entry.chain.toTickets'), { fill: withAlpha(implIdentity(), 0.3), stroke: B, text: BT, size: CHAIN_FONT, rx: 4 }))
  return h('g', null, parts)
}

/** 供门禁核对「主体文本最多三行、每行不超过 12 个汉字」：与卡面用的是同一套断行。
 *  单测/门禁调用时不会碰 h 与 tr，所以这个模块可以被 Node 直接 require 来验断行规则。 */
export const entryBodyLines = function (body: any): string[] {
  const text = String(body || '')
  return packLines(splitUnits(text), HAS_CJK.test(text) ? 12 : 24)
}

/**
 * 画一张选择卡。kind 只有两个值：'map'（探索地图）与 'spec'（实施地图）；
 * 除此之外的入参按探索地图画（这个组件只给入口浮层用，遇到第三种该当场看出来）。
 */
export const buildEntryCard = function (kind: any) {
  const isMap = kind !== 'spec'
  const colors = cardColors(isMap ? 'map' : 'spec')
  const id = nextArtId()
  const brow = String(tr(isMap ? 'card.entry.explore.brow' : 'card.entry.impl.brow') || '')
  const state = String(tr(isMap ? 'card.entry.explore.state' : 'card.entry.impl.state') || '')
  const body = String(tr(isMap ? 'card.entry.explore.body' : 'card.entry.impl.body') || '')
  const maxUnits = HAS_CJK.test(body) ? 12 : 24
  const lines = packLines(splitUnits(body), maxUnits)
  const parts: any[] = [
    h('rect', { key: 'card', x: 0.5, y: 0.5, width: ENTRY_CARD_W - 1, height: ENTRY_CARD_H - 1, rx: 12, fill: '#10131a', stroke: colors.identity, strokeOpacity: String(colors.borderAlpha) }),
    h('rect', { key: 'art', x: 12, y: 12, width: 184, height: 116, rx: 8, fill: PANEL_FILL, stroke: PANEL_STROKE }),
    h('g', { key: 'artg', transform: 'translate(20,18)' }, [isMap ? artExplore(id, colors) : artImpl(id, colors)]),
    svgText(208, 36, brow, 11, colors.line, { opacity: 0.72, spacing: 1.2 }),
    svgText(208, 64, state, 17, colors.line, { weight: 700 }),
    h('rect', { key: 'chainbg', x: 12, y: CHAIN_TOP, width: 344, height: 80, rx: 8, fill: PANEL_FILL, stroke: PANEL_STROKE }),
    h('g', { key: 'chain', transform: 'translate(0,0)' }, [isMap ? chainExplore(colors) : chainImpl()]),
  ]
  for (let i = 0; i < lines.length; i += 1) {
    parts.push(svgText(BODY_X, BODY_TOP + i * BODY_LINE_H, lines[i], BODY_SIZE, '#a1a1aa'))
  }
  return h('svg', {
    viewBox: '0 0 ' + ENTRY_CARD_W + ' ' + ENTRY_CARD_H,
    width: ENTRY_CARD_W,
    height: ENTRY_CARD_H,
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif',
    style: { display: 'block' },
  }, parts)
}
