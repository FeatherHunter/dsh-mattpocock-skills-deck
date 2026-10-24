// body-layout.ts —— 票正文里「正文最前」那一块被共享层放到标题前时，把它搬回标题与字段行之后。
//
// 为什么放在共享层：本地 Markdown 后端的整份正文改写（src/tracker/rooms/markdown/issues-patch.ts）
// 与 deck 工具的原话区改写（src/deck/shell/body-write.ts）都会碰到同一个形状，需要同一份实现。
// 两份拷贝在 #1486 期间各写了一份，语义完全相同；再留两份，以后改规则一定会分叉。
//
// 背景：本地票传上来是整份文件：文件头注释 + 一级标题 + 字段行 + 正文。共享层定位原话区时
// 只知道「正文」，没有 `## 目的` 就把原话区放在正文最前，于是整份文件里跑到标题前面去了 ——
// 读父注释、读字段都跟着坏。这里只搬「标题之前、又不是注释」的那一块，语义仍是「正文最前」。
export function moveLeadingSectionBelowTitle(text: string): string {
  const lines = String(text || '').split('\n')
  const h1 = lines.findIndex((l) => /^#[ \t]+\S/.test(l))
  if (h1 < 0) return text
  const pre = lines.slice(0, h1)
  const isComment = (l: string) => /^[ \t]*<!--.*-->[ \t]*$/.test(l)
  const prose = pre.filter((l) => l.trim() !== '' && !isComment(l))
  if (prose.length === 0) return text
  let end = h1 + 1
  while (end < lines.length) {
    const l = lines[end]
    if (l.trim() === '' || /^\*\*[^*]+:\*\*/.test(l) || /^(Status|Type|Blocked\s+by|Labels|Assignees|Close\s+reason)\s*[:：]/i.test(l)) { end++; continue }
    break
  }
  const head = pre.filter(isComment)
  return head.concat(lines.slice(h1, end), [''], prose, lines.slice(end)).join('\n')
}
