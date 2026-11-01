// markdown-scan.ts —— 「这一行是不是代码围栏」「这一行是不是二级标题」这两条扫描判据的唯一一份。
//
// 为什么单独立成一件（#1506 两轴评审收口时抽出来）：建票渲染与模板判据走的是同一条渲染管线——
// create-render.ts 要找「第一个不在围栏里的二级标题」来拆正文，template-guard.ts 要判「远端四段
// 是不是写在围栏里当举例」。两处各自写一份正则，迟早有一天会各说各话：一处认波浪号、另一处不认，
// 一处允许行首缩进、另一处不允许，于是同一份正文在两个环节得到不同结论。
//
// 口径照 CommonMark 的写法简化：
//   - 围栏行：行首（可带空白）三个以上反引号或波浪号；开围栏记下符号与长度，
//     关闭围栏要同一种符号且不短于开围栏——所以 ~~~ 里包的 ``` 不会把围栏关掉；
//   - 二级标题行：最多三个前导空格，`##` 之后至少一个空白。
//
// 本文件是纯计算：只收文本（一行，或一整段正文），不读写文件、不看时钟。

/** 围栏记号：行首（可带空白）三个以上反引号或波浪号；捕获到的那串就是开围栏记号。 */
const FENCE_MARK = /^[ \t]*(`{3,}|~{3,})/

/** 二级标题行：最多三个前导空格（CommonMark 的写法），`##` 之后至少一个空白。 */
const HEADING_TWO_LINE = /^[ \t]{0,3}##[ \t]+(.*?)[ \t]*$/

/** 这一行是不是代码围栏的开/闭行（只看形状；要判一行在不在围栏里、围栏有没有关，用 scanFenceLines）。 */
export function isFenceLine(line: string): boolean {
  return FENCE_MARK.test(line)
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

/** 一段正文按代码围栏切成的行；fenced 为 true 表示这一行是围栏边界或在围栏里面。 */
export type FenceLine = { line: string; fenced: boolean }

/** 打开围栏的行返回符号与长度；不是围栏行返回 null。 */
function fenceOpening(line: string): { char: string; length: number } | null {
  const hit = FENCE_MARK.exec(line)
  return hit ? { char: hit[1][0], length: hit[1].length } : null
}

/** 这一行能不能关掉开着的围栏：同一种符号、不短于开围栏、后面只剩空白。 */
function fenceClosing(line: string, open: { char: string; length: number }): boolean {
  const hit = FENCE_MARK.exec(line)
  if (!hit) return false
  // 关闭记号后面只能剩空白；行尾可能带 \r（CRLF 正文），所以先 trim 再判。
  if (line.slice(hit[0].length).trim() !== '') return false
  return hit[1][0] === open.char && hit[1].length >= open.length
}

/** 把正文切成行并标出哪些行属于代码围栏（开闭行本身也算）。
 *
 *  建票渲染要「围栏里的 - [ ] 不搬走」「围栏里的示例字段不当真值」，都靠这份状态；
 *  混用符号时（~~~ 里包 ```）只有同种符号且够长的行才算关闭，里面的行一律算围栏内容。 */
export function scanFenceLines(body: string): FenceLine[] {
  const out: FenceLine[] = []
  let open: { char: string; length: number } | null = null
  for (const raw of String(body || '').split('\n')) {
    // 判围栏前去掉行尾 \r：CRLF 正文的关闭行是 ```\r，不去掉就永远关不上。
    // 输出的行保留原样（含 \r），firstHeadingOutsideFence 要靠原样长度算偏移。
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (open) {
      out.push({ line: raw, fenced: true })
      if (fenceClosing(line, open)) open = null
      continue
    }
    const mark = fenceOpening(line)
    if (mark) open = mark
    out.push({ line: raw, fenced: !!mark })
  }
  return out
}
