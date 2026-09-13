// label-colors-paint.js —— 票面上色：把一张票的标签染成该有的颜色。
//
// 规则（#618 定的三级回落）：配色文件里收录了就用文件里的颜色，文件里没收录就按内置默认色，
// 内置也没有才用 #cccccc（灰）。原来做这件事的是 issues-labels.js 的 recolorLabels，那个文件连同
// 旧的调色盘表读法一起删掉了。
//
// 为什么读失败不报错只回落：票列表是主界面，不能因为配色文件被写坏就整页读不出来；
// 真正要报「读不出来」的是列标签与改色那两条契约操作（见 label-colors.js 的读与 label-colors-ops.js）。
import { normalizeColor } from '../../../../shared/label-color/colors.js'
import { readLabelColors } from './label-colors.js'
import { builtinColorOf, builtinLabelColors } from './label-colors-palette.js'

/** 票面上色用的查色表：配色文件里的颜色优先，其余标签按内置默认色补上。
 *  这条读路不抛错也不失败：读不出来时只用内置默认色（读的那一次会在调试日志里留一条痕）。 */
export async function loadPaintColorMap(ctx, repo) {
  const map = {}
  for (const item of builtinLabelColors()) {
    if (!item || !item.name) continue
    const c = normalizeColor(item.color)
    if (c) map[String(item.name)] = c
  }
  const read = await readLabelColors(ctx, repo)
  if (read.ok) {
    for (const name of Object.keys(read.colors)) if (read.colors[name]) map[name] = read.colors[name]
  }
  return map
}

/** 给一张票的标签上色。 */
export function applyLabelColors(issue, colorMap) {
  if (!issue || !Array.isArray(issue.labels)) return
  for (const lab of issue.labels) {
    if (!lab || !lab.name) continue
    lab.color = colorOfLabel(lab.name, colorMap)
  }
}

/** 单个标签的颜色：文件里查得到就用文件里的，否则内置默认色，否则灰。 */
export function colorOfLabel(name, colorMap) {
  const fromFile = normalizeColor(colorMap && colorMap[name])
  if (fromFile) return fromFile
  return builtinColorOf(name) || 'cccccc'
}

export default { loadPaintColorMap, applyLabelColors, colorOfLabel }
