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
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
