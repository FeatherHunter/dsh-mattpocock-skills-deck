/**
 * views/labels/labelColorPalette.js — 标签配色入口图标的颜色（#637 新增）
 *
 * 面板头部那颗入口按钮里的调色盘整只上色：盘身填暖木色，四颗颜料点取四个 wayfinder
 * 标签的真实颜色。为什么单拆一份叶子：labelColorErrors.js 已经 348 行（上限 350），
 * 这几十行塞进去会顶破文件粒度门禁。
 *
 * 四个槽位按图标源码里四个圆点的出现次序排（左下、左上、右上、右下），依次对应
 * wayfinder:map、wayfinder:research、wayfinder:prototype、wayfinder:task。
 * 每一个槽位独立兜底：这个标签在清单里没有、没有颜色、颜色不是合法的六位十六进制，
 * 这个槽位就用默认色——负责人原话：「如果异常、不存在等任何特殊情况用默认色兜底」。
 * 清单本身拿不到（还没取回来、取失败、回包形状不对）→ 四个槽位全是默认色。
 *
 * 默认色是深浅两档（light-dark 写法）：浅色面板用深一档，深色面板用亮一档，
 * 面板按当前主题自己挑（写法在这套界面里实测能用，见 #637 的探针页）。
 * 真实颜色是用户在改色弹窗里定的色（归一成带井号的小写六位），深浅两主题用同一个——
 * 这四个标签是仓库的固定标签，颜色由人定，图标只负责原样显示，不替它调深浅。
 */
export const LC_ENTRY_PALETTE_SLOTS = ['wayfinder:map', 'wayfinder:research', 'wayfinder:prototype', 'wayfinder:task']
export const LC_ENTRY_PALETTE_DEFAULTS = [
  'light-dark(#d73a4a,#f87171)',
  'light-dark(#bf8700,#e3b341)',
  'light-dark(#1a7f37,#3fb950)',
  'light-dark(#0969da,#58a6ff)',
]
export const LC_ENTRY_PALETTE_BODY = {
  fill: 'light-dark(#e8c98f,#c9a063)',
  stroke: 'light-dark(#a8763c,#e0bd86)',
}
// rows 是 lcLabelsOf 取出来的形状（[{ name, color }]，color 是后端写法：不带井号、大小写不保证）。
// 返回四个圆点的填充色（每个都是「带井号的小写六位」或该槽位的默认色），顺序与 LC_ENTRY_PALETTE_SLOTS 一致。
// 同名标签出现多次时以第一次为准（标签名在后端是唯一的，真出现重复说明回包有问题，不值得再定一条规则）。
export const lcEntryPaletteOf = function (rows) {
  const byName = {}
  if (Array.isArray(rows)) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r || typeof r.name !== 'string') continue
      if (Object.prototype.hasOwnProperty.call(byName, r.name)) continue
      byName[r.name] = (typeof r.color === 'string') ? r.color : ''
    }
  }
  const out = []
  for (let i = 0; i < LC_ENTRY_PALETTE_SLOTS.length; i++) {
    const n = normalizeColor(byName[LC_ENTRY_PALETTE_SLOTS[i]])
    out.push(n ? ('#' + n) : LC_ENTRY_PALETTE_DEFAULTS[i])
  }
  return out
}
