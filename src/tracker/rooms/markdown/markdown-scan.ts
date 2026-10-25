// markdown-scan.ts —— 「这一行是不是代码围栏」「这一行是不是二级标题」这两条扫描判据的唯一一份。
//
// 为什么单独立成一件（#1506 两轴评审收口时抽出来）：建票渲染与模板判据走的是同一条渲染管线——
// create-render.ts 要找「第一个不在围栏里的二级标题」来拆正文，template-guard.ts 要判「远端四段
// 是不是写在围栏里当举例」。两处各自写一份正则，迟早有一天会各说各话：一处认波浪号、另一处不认，
// 一处允许行首缩进、另一处不允许，于是同一份正文在两个环节得到不同结论。
//
// 口径照 CommonMark 的写法简化，不解析围栏后面的语言名、也不要求关闭围栏与打开围栏等长：
//   - 围栏行：行首（可带空白）三个以上反引号或波浪号；
//   - 二级标题行：最多三个前导空格，`##` 之后至少一个空白。
//
// 本文件是纯计算：只收一行文本，不读写文件、不看时钟。

/** 围栏行：行首（可带空白）三个以上反引号或波浪号。 */
const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})/

/** 二级标题行：最多三个前导空格（CommonMark 的写法），`##` 之后至少一个空白。 */
const HEADING_TWO_LINE = /^[ \t]{0,3}##[ \t]+(.*?)[ \t]*$/

/** 这一行是不是代码围栏的开/闭行（用法是每遇到一次翻转「在不在围栏里」）。 */
export function isFenceLine(line: string): boolean {
  return FENCE_LINE.test(line)
}

/** 这一行是不是二级标题（标题文字为空也算，例如正文里孤零零一个 `## `）。 */
export function isHeadingTwoLine(line: string): boolean {
  return HEADING_TWO_LINE.test(line)
}

/** 这一行是不是二级标题：是则返回标题文字（已去掉行尾空白），不是则返回空串。 */
export function headingTwoText(line: string): string {
  const hit = HEADING_TWO_LINE.exec(line)
  return hit ? hit[1] : ''
}
