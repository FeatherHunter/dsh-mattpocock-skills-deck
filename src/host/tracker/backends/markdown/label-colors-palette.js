// label-colors-palette.js —— 内置默认色表的唯一持有者（供配色文件那条路的三处共用）。
//
// 这份表只有一处出处：后端模块自己声明的那份调色盘（src/host/tracker/backends/markdown/index.js 的
// defaultLabelPalette，也是契约里 labelPalette 自报数据的来源）。它由后端模块在装载时交给本文件，
// 本文件不自己再抄一份（#618 的硬要求：不许造第二份默认色表）。
// 为什么要「交给」而不是让本文件 import 那份表：后端模块会 import 配色这几个文件，反过来 import 它
// 就成了循环引用，读代码的人很难判断谁先初始化。
//
// 三处用它：① 首建配色文件时按它预填；② 列标签的并集里补上这些标签；③ 票面标签既不在配色文件里
// 也不在这份表里才回灰（见 label-colors-paint.js）。
import { normalizeColor } from '../../../../shared/label-color/colors.js'

let builtinColors = []

/** 后端模块把内置默认色表交给本文件（同一个数组，不复制）。 */
export function useBuiltinLabelColors(list) {
  builtinColors = Array.isArray(list) ? list : []
}

/** 当前生效的内置默认色表。 */
export function builtinLabelColors() {
  return builtinColors
}

/** 标签名 → 内置默认色（小写六位；表里没有这个标签时返回空串）。 */
export function builtinColorOf(name) {
  for (const item of builtinColors) {
    if (item && String(item.name || '') === String(name)) {
      const c = normalizeColor(item.color)
      return c || ''
    }
  }
  return ''
}

/** 内置默认色表的对象形态：标签名 → 颜色（键的顺序按内置调色盘的顺序，人看起来稳定）。
 *  首建配色文件时用它；颜色统一成不带井号的小写六位。 */
export function builtinColorObject() {
  const out = {}
  for (const item of builtinColors) {
    if (!item || !item.name) continue
    out[String(item.name)] = normalizeColor(item.color) || ''
  }
  return out
}

export default { useBuiltinLabelColors, builtinLabelColors, builtinColorOf, builtinColorObject }
