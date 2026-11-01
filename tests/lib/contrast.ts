/**
 * tests/lib/contrast.ts —— 像素皮肤两扇门禁共用的 WCAG 相对亮度与对比度算法。
 *
 * 为什么抽出来：技能详情栈门禁（verify-skill-detail-stack.ts）与卡片门禁（verify-cards-dir.ts）
 * 原本各自抄了一份一模一样的实现，以后只改一份就会出现「同一个色值，两扇门一红一绿」。
 * 这里只放 WCAG 2.x 的定义本身，不掺门禁口径：过线是 4.5:1 还是 3:1，由调用方自己判。
 *
 * 入参是六位十六进制颜色（#rrggbb），大小写都认；调用方给的色值来自样式文本，
 * 取不到时传空串会得到 NaN，与两扇门禁原来的行为一致（由调用方先判「取到没有」）。
 */
/** 一个按 CSS 语法解析出来的颜色：rgb 三通道 0..255，alpha 0..1。 */
export interface RgbaColor {
  rgb: number[]
  alpha: number
}

/** WCAG 2.x 的 sRGB 线性化（阈值沿用 0.03928，与既有两扇门禁的历史结论保持一致，不另立一套）。 */
function linearChannel(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminanceOfRgb(rgb: number[]): number {
  return 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2])
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return luminanceOfRgb([(n >> 16) & 255, (n >> 8) & 255, n & 255])
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 两个已解析颜色的对比度：调用方已把半透明颜色合成到实底上时用这个。 */
export function contrastRatioOfRgb(a: number[], b: number[]): number {
  const la = luminanceOfRgb(a), lb = luminanceOfRgb(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * 解析一个 CSS 颜色：#rgb / #rrggbb / rgb() / rgba()，大小写都认；解析不了返回 null。
 * 只放 WCAG 与 CSS 合成需要的字段，不做浏览器端的完整颜色解析（不认颜色关键字、hsl 等）。
 */
export function parseColor(token: any): RgbaColor | null {
  if (typeof token !== 'string') return null
  const text = token.trim()
  const hex = text.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (hex) {
    const h = hex[1]
    if (h.length === 3) {
      return {
        rgb: [parseInt(h.charAt(0) + h.charAt(0), 16), parseInt(h.charAt(1) + h.charAt(1), 16), parseInt(h.charAt(2) + h.charAt(2), 16)],
        alpha: 1,
      }
    }
    return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], alpha: 1 }
  }
  const m = text.match(/^rgba?\(([^)]+)\)$/)
  if (!m) return null
  const parts = m[1].split(',').map(function (part: string) { return Number(part.trim()) })
  if (parts.length < 3 || parts.some(function (v: number) { return !Number.isFinite(v) })) return null
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts.length > 3 ? Math.min(1, Math.max(0, parts[3])) : 1 }
}

/** 把一个颜色按 CSS 合成公式叠到实底（[r,g,b]）上，返回合成后的 [r,g,b]。 */
export function compositeOver(color: RgbaColor, background: number[]): number[] {
  const alpha = color.alpha
  return [
    color.rgb[0] * alpha + background[0] * (1 - alpha),
    color.rgb[1] * alpha + background[1] * (1 - alpha),
    color.rgb[2] * alpha + background[2] * (1 - alpha),
  ]
}

/**
 * 从一个 CSS 值里取全部色标（渐变可能有多个；单色就是它自己）。
 * 判对比度时每个色标都要算一遍，任何一档不过关都算不过关——只看最上面那一档会漏。
 */
export function colorStopsOf(css: any): RgbaColor[] {
  const found = String(css == null ? '' : css).match(/rgba?\([^)]+\)/g)
  if (found && found.length) {
    const stops: RgbaColor[] = []
    for (let i = 0; i < found.length; i++) {
      const color = parseColor(found[i])
      if (color) stops.push(color)
    }
    return stops
  }
  const single = parseColor(css)
  return single ? [single] : []
}

/** 文字对「一组背景色标叠在页面底色上」的最差对比度：取每个色标合成后的最小值。 */
export function worstTextContrast(textToken: any, backgroundCss: any, pageRgb: number[]): number {
  const text = parseColor(textToken)
  const stops = colorStopsOf(backgroundCss)
  if (!text || !stops.length) return 0
  let worst = Infinity
  for (let i = 0; i < stops.length; i++) {
    const background = compositeOver(stops[i], pageRgb)
    const textOnBackground = compositeOver(text, background)
    const ratio = contrastRatioOfRgb(textOnBackground, background)
    if (ratio < worst) worst = ratio
  }
  return worst
}

/** 控件自身（背景合成后）对页面底色的最差对比度：非文本对比度按 3:1 判。 */
export function worstSurfaceContrast(surfaceCss: any, pageRgb: number[]): number {
  const stops = colorStopsOf(surfaceCss)
  if (!stops.length) return 0
  let worst = Infinity
  for (let i = 0; i < stops.length; i++) {
    const surface = compositeOver(stops[i], pageRgb)
    const ratio = contrastRatioOfRgb(surface, pageRgb)
    if (ratio < worst) worst = ratio
  }
  return worst
}
