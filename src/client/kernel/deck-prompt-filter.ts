/**
 * src/client/kernel/deck-prompt-filter.ts — #1612：deck 关闭的工作区里，提示词不再提醒调用 deck 工具
 *
 * 契约：本文件是内核模块（ESM 导出）；scripts/build.mts 构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里那一行 kernel:deckPromptFilter 拼接标记处（apply 闭包内原位），与其它内核片同模式。
 *
 * 为什么要有它：提示词模板里有一段「## 工具」（英文「## Tools」）提醒调用方优先用 deck_ 开头的工具、
 *   用 deck_issue_report 上报、最后调用 suggest_next_steps 推荐技能。这段模板由构建期烘进客户端数据，
 *   本票不动模板生成链，只在**注入那一刻**按当前工作区过滤（brief 第 6 条）。
 *
 * 过滤口径（宁可少删，不许误删）：
 *   · 只删「提醒行」——形如「- [ ] …」的勾选条目里提到 deck_ 或 suggest_next_steps 的那些行，
 *     正文里顺口提到 deck 的普通句子一个字不动；
 *   · 一条都不剩时连它的小节标题（## 工具 / ## Tools）一起删掉，免得留下一个空标题；
 *   · 「## 调查」那一段不含 deck 字样，本过滤器不会碰它（有门禁守着）。
 *   · deck 没关、或文本里本来就没有这类行时原样返回（同一个字符串，不做任何格式整理）。
 */

// 这一行是不是模板里那种勾选提醒行：「- [ ] …」或「* [x] …」（缩进随意，模板用两格）。
const deckPromptCheckLine = /^\s*[-*]\s+\[[ xX]?\]\s/
// 行里提没提到 deck 工具或建议工具。deck_ 前面可以是空格、反引号、括号；中文句子里它常紧跟汉字，
//   所以只要求前面不是字母数字下划线（「用的deck_工具」这种挤在一起的写法也认）。
const deckPromptMention = /(?:^|[^A-Za-z0-9_])deck_[A-Za-z0-9_]*|suggest_next_steps/
// 小节标题（模板里只用到 ## 这一级，但按 1~6 级一起认，将来写深一层也不用改）。
const deckPromptHeading = /^\s{0,3}#{1,6}\s/
// 空行（模板里小节之间用空行分隔）。
const deckPromptBlank = /^\s*$/

/**
 * 按「deck 关没关」过滤一段提示词。
 * @param text 待注入的提示词原文（可能是空串、null、undefined）
 * @param deckClosed 这个工作区的 deck 工具箱是不是关着（真值才过滤）
 * @returns 过滤后的文本；deck 没关或没有可删的行时原样返回
 */
export const deckPromptFiltered = function (text: any, deckClosed: any): any {
  try {
    const s = (text === null || text === undefined) ? '' : String(text)
    if (!deckClosed || !s) return s
    const src = s.split('\n')
    const gone: any = {}
    let removed = 0
    for (let i = 0; i < src.length; i++) {
      const line = src[i]
      if (!deckPromptCheckLine.test(line)) continue
      if (!deckPromptMention.test(line)) continue
      gone[i] = true
      removed++
    }
    if (!removed) return s
    // 删完提醒行之后，有的小节会一条正文都不剩：把它的标题也去掉（否则注入的提示词里会挂一个空标题）。
    for (let i = 0; i < src.length; i++) {
      if (gone[i] || !deckPromptHeading.test(src[i])) continue
      let end = src.length
      for (let j = i + 1; j < src.length; j++) {
        if (!gone[j] && deckPromptHeading.test(src[j])) { end = j; break }
      }
      let body = 0
      for (let j = i + 1; j < end; j++) {
        if (!gone[j] && !deckPromptBlank.test(src[j])) { body++; break }
      }
      if (!body) { gone[i] = true; removed++ }
    }
    // 拼回去：被删处常留下连着的空行，收成一行；首尾空行去掉（注入前还会补一个换行，见 withTrailingNewline）。
    const out: any[] = []
    for (let i = 0; i < src.length; i++) {
      if (gone[i]) continue
      if (deckPromptBlank.test(src[i])) {
        if (!out.length) continue
        if (out[out.length - 1] === '') continue
        out.push('')
        continue
      }
      out.push(src[i])
    }
    while (out.length && out[out.length - 1] === '') out.pop()
    return out.join('\n')
  } catch (e) {
    try { return (text === null || text === undefined) ? '' : String(text) } catch (e2) { return '' }
  }
}
