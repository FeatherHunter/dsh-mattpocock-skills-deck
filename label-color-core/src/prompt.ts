/**
 * label-color-core/src/prompt.ts —— 调色盘提示词的两段纯拼装（表格 + 整段提示词）
 *
 * 这里只做拼装，不带任何用户能看到的文案：开头一句、两列表头、结尾一句都由调用方
 * 从词表里传进来（中文一份、英文一份，界面用哪份就传哪份）。核心不含文案这件事是
 * 有意的——守客户端双语文案的那条门禁只看 src/client 下的文件，看不见这里，
 * 文案一旦写进核心，就再也没有机器看着它有没有中英两份。
 *
 * 这个文件不引用同目录的 colors.ts：src/shared 下的文件之间不许互相引用
 * （同层互引门禁会红），而且两个文件都会被拼进客户端闭包，互相引用在闭包里也不成立。
 */
import type { LabelColorRow } from './ports.js'

/** 一段提示词里由词条提供的三样文本：开头一句、表格的两个表头、结尾一句。 */
export interface PalettePromptTexts {
  opening: string
  columnNames: { name: string; color: string }
  closing: string
}

/**
 * 表格单元格里的颜色写法：去掉开头的井号、去掉首尾空白、转成小写。
 *
 * 为什么这里自己写一遍而不是调 colors.ts 的归一化：两个文件不许互相引用（见文件头）。
 * 这一段与 colors.ts 的基础归一化是同一个形状，但它只负责「打印成什么样」，
 * 不判合法性、不做任何跳过的决定——值合不合法由 colors.ts 的 isColor 判，两边分工不同。
 * 这样写的好处是人照着表格抄进配色文件时，抄到的就是这个仓库认的那种写法。
 */
function formatColorCell(color: unknown): string {
  let text = typeof color === 'string' ? color.trim() : ''
  if (text.startsWith('#')) text = text.slice(1)
  return text.trim().toLowerCase()
}

/**
 * 把清单拼成一张两列的 Markdown 表格：左边标签名，右边颜色。
 *
 * 表头文字由调用方给（中英各一份住词表里），第二行是 Markdown 表格的分隔行，
 * 之后每行一个标签。色值一律按 formatColorCell 的写法输出成不带井号的小写六位，
 * 方便人直接照表格把颜色抄进配色文件。
 * rows 为空时也能拼：出来的是一个只有表头与分隔行的空表，不是错误。
 */
export function buildPaletteTable(
  rows: LabelColorRow[],
  columnNames: { name: string; color: string },
): string {
  const lines = [
    '| ' + columnNames.name + ' | ' + columnNames.color + ' |',
    '| --- | --- |',
  ]
  for (const row of rows) lines.push('| ' + row.name + ' | ' + formatColorCell(row.color) + ' |')
  return lines.join('\n')
}

/**
 * 拼一整段调色盘提示词：开头一句、表格、结尾一句，三段之间空一行。
 *
 * 空串或者只有空白的段落会被跳过（不留下多余的空行）：GitHub 后端与本地 Markdown
 * 后端要说的话不一样，某一版可能不需要结尾那一句，调用方传空串即可，不必另写一个函数。
 * 三段按顺序用空行连起来，正是 Markdown 里一段接一段的写法。
 */
export function buildPalettePrompt(input: { rows: LabelColorRow[]; texts: PalettePromptTexts }): string {
  const parts = [input.texts.opening, buildPaletteTable(input.rows, input.texts.columnNames), input.texts.closing]
  return parts.filter((part) => typeof part === 'string' && part.trim() !== '').join('\n\n')
}
