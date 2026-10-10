/**
 * views/skillDetail/PixelMarkdown.ts — 像素风 Markdown 渲染的 TS 真源（887 TS 化，中组件）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelMarkdown (spliced by build) ====` 标记处。
 * 用法：PixelMarkdown({md, lang, st})；pixelDocHeadings(md) 纯函数抽标题给目录用。
 * 白名单与 views/shared/md.js 对齐（标题/分割线/引用/列表/任务列表/代码块/加粗/斜体/
 * 行内代码/删除线/链接/图片），只有两处不同：①列表支持缩进嵌套（生产渲染器会拍平，
 * 详情页要忠于原文，见 887 票面记录）；②画出来的全是 pixel- 类，由 pxSkillStyles 着色，
 * 不走行内样式。图片只认 https 地址，其余一律留说明文字；点图放大走 st.pixelImgOverlay。
 */
import type { PixelMarkdownProps, PixelHeading, PixelListFlatItem, PixelListSeq, PixelListBlock, PixelListNode, PixelBtnProps } from '../pixelProps';
declare const PixelBtn: (props?: PixelBtnProps) => any;
export const pixelDocHeadings = function (md?: string): PixelHeading[] {
  const out: PixelHeading[] = []
  String(md == null ? '' : md).split(/\r?\n/).forEach(function (line: string) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line.trim())
    if (m) out.push({ level: m[1].length, text: m[2].replace(/(\*\*|\*|~~|`)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') })
  })
  return out
}
export const PixelMarkdown = function (props?: PixelMarkdownProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = p.st || null
  let k = 0
  const key = function (): string { k += 1; return 'pxd' + k }
  const openImg = function (src: string, alt: string): void {
    if (!st || !src) return
    st.pixelImgOverlay = { src: src, alt: String(alt || '').slice(0, 200) }
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
  }
  // ---- 行内解析（2026-10-10 按 27 篇真实原文的组合重做）----
  // 盘点自 package/bundled-skills 的 27 篇 SKILL.md，真实出现的组合有：
  //   **`code`** 42 处（粗体里包代码）、**a *b* c** 14 处（粗体里再套斜体）、
  //   **a _b_ c** 25 处（粗体里套下划线强调）、[`code`](url) 3 处（链接标签本身是代码）、
  //   **[label](url)** 1 处（粗体包链接）；另有上百处代码跨度里带 *（glob 之类），
  //   那些星号必须原样，绝不能被当成强调标记。
  // 次序：①代码跨度抽成原子（里面字符不再参与解析）；②图片；③链接（标签递归，共用同一张原子表）；
  // ④剩下的文字上递归解析强调；⑤把原子填回（填回要下探到新建节点的子节点里，否则占位符会露在界面上）。
  // 强调收口的两条细节：** 与 __ 要成对整串；单个 * 只认"孤立的星"收口，
  // 这样 *a **b** c* 反向嵌套也能正确（否则会被切成三段各自的斜体）。
  // 下划线守词边界：_x_ 认，snake_case 不认。
  const pxInline = function (text: string, inLink: boolean): any[] {
    return pxInlineWith(text, inLink, [])
  }
  const pxInlineWith = function (text: string, inLink: boolean, atoms: any[]): any[] {
    const mark = function (node: any): string {
      atoms.push(node)
      return '\u0002A' + (atoms.length - 1) + '\u0002'
    }
    const findClose = function (s: string, ch: string, from: number, need: number): number {
      let i = from
      while (i < s.length) {
        if (s[i] !== ch) { i += 1; continue }
        let run = 1
        while (i + run < s.length && s[i + run] === ch) run += 1
        // 单个强调标记只认孤立的星/下划线；成对的两个必须整串（两个以上也不许拆着用）
        const fits = (need === 1) ? (run === 1) : (run >= need)
        if (fits) {
          if (ch === '_') {
            const after = (i + run < s.length) ? s[i + run] : ' '
            if (/[A-Za-z0-9]/.test(after)) { i += run; continue }
          }
          return i
        }
        i += run
      }
      return -1
    }
    const expand = function (nodes: any[]): any[] {
      const out: any[] = []
      nodes.forEach(function (n: any) {
        if (typeof n !== 'string') { out.push(n); return }
        const re = /\u0002A(\d+)\u0002/g
        let last = 0
        let m: RegExpExecArray | null = null
        while ((m = re.exec(n)) !== null) {
          if (m.index > last) out.push(n.slice(last, m.index))
          const atom = atoms[parseInt(m[1], 10)]
          if (atom !== undefined) out.push(atom)
          last = m.index + m[0].length
        }
        if (last < n.length) out.push(n.slice(last))
      })
      return out
    }
    const emphasisOf = function (s: string): any[] {
      const out: any[] = []
      let i = 0
      while (i < s.length) {
        const ch = s[i]
        if (ch !== '*' && ch !== '_' && ch !== '~') {
          let j = i
          while (j < s.length && s[j] !== '*' && s[j] !== '_' && s[j] !== '~') j += 1
          out.push(s.slice(i, j)); i = j; continue
        }
        let run = 1
        while (i + run < s.length && s[i + run] === ch) run += 1
        const need = (ch === '~') ? 2 : (run >= 2 ? 2 : 1)
        if (ch === '~' && run < 2) { out.push(s.slice(i, i + run)); i += run; continue }
        if (ch === '_') {
          const prev = (i > 0) ? s[i - 1] : ' '
          if (/[A-Za-z0-9]/.test(prev)) { out.push(s.slice(i, i + 1)); i += 1; continue }
        }
        const openEnd = i + need
        const closeAt = findClose(s, ch, openEnd, need)
        if (closeAt < 0) { out.push(s.slice(i, openEnd)); i = openEnd; continue }
        // 子节点先填回原子，再挂进这一层 —— 否则占位符会原样出现在界面上
        const kids = expand(emphasisOf(s.slice(openEnd, closeAt)))
        if (ch === '~') out.push(h('span', { key: key(), style: { textDecoration: 'line-through' } }, kids))
        else if (need === 2) out.push(h('strong', { key: key() }, kids))
        else out.push(h('em', { key: key() }, kids))
        i = closeAt + need
      }
      return out
    }
    let rest = String(text == null ? '' : text)
    // ① 代码跨度：原子，最高优先级
    rest = rest.replace(/`([^`]+)`/g, function (all: string, code: string) {
      return mark(h('code', { key: key() }, code))
    })
    // ② 图片：在链接之前（否则 ![](...) 会被链接规则吃掉一半）；只认安全地址
    rest = rest.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g, function (all: string, alt: string, url: string) {
      if (!/^https:/i.test(url)) return alt || ''
      const clickable = !inLink && !!st
      const props: Record<string, any> = { key: key(), src: url, alt: alt || 'Image', loading: 'lazy' }
      if (clickable) props.onClick = function () { openImg(url, alt) }
      return mark(h('img', props))
    })
    // ③ 链接：只认 http(s)；标签递归解析，共用同一张原子表（标签里的代码才找得回自己那条）
    rest = rest.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, function (all: string, label: string, url: string) {
      if (!/^https?:/i.test(url)) return label
      return mark(h('a', { key: key(), href: url, target: '_blank', rel: 'noreferrer' }, pxInlineWith(label, true, atoms)))
    })
    return expand(emphasisOf(rest))
  }

  const matchListLine = function (line: string): PixelListFlatItem | null {
    const im = /^( *)/.exec(line)
    const indent = im ? im[1].length : 0
    const rest = line.slice(indent)
    let m = /^-\s+\[([ xX])\]\s+(.+)$/.exec(rest)
    if (m) return { indent: indent, ordered: false, task: m[1], text: m[2] }
    m = /^(\d+)\.\s+(.+)$/.exec(rest)
    if (m) return { indent: indent, ordered: true, task: null, text: m[2] }
    m = /^(-|\*)\s+(.+)$/.exec(rest)
    if (m) return { indent: indent, ordered: false, task: null, text: m[2] }
    return null
  }
  const takeList = function (flat: PixelListFlatItem[], pos: number, indent: number): { lists: PixelListSeq; next: number } {
    const lists: PixelListSeq = []
    let cur: PixelListBlock | null = null
    let i = pos
    while (i < flat.length && flat[i].indent >= indent) {
      const r = flat[i]
      if (r.indent > indent) {
        if (cur && cur.items.length > 0) {
          const sub = takeList(flat, i, r.indent)
          cur.items[cur.items.length - 1].kids = sub.lists
          i = sub.next
        } else { i += 1 }
      } else {
        if (!cur || cur.ordered !== r.ordered) { cur = { ordered: r.ordered, items: [] }; lists.push(cur) }
        (cur as PixelListBlock).items.push({ task: r.task, text: r.text, kids: null })
        i += 1
      }
    }
    return { lists: lists, next: i }
  }
  const renderListSeq = function (seq: PixelListSeq): any[] {
    return seq.map(function (lst: PixelListBlock, li: number) {
      void li
      const tag = lst.ordered ? 'ol' : 'ul'
      return h(tag, { key: key() }, lst.items.map(function (it: PixelListNode, ii: number) {
        const kids = it.kids && it.kids.length ? renderListSeq(it.kids) : null
        if (it.task !== null) {
          return h('li', { key: ii }, h('label', { className: 'pixel-task' }, [
            h('input', { key: 'c', type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true }),
            h('span', { key: 't' }, pxInline(it.text, false)),
            kids ? h('span', { key: 'k' }, kids) : null,
          ]))
        }
        return h('li', { key: ii }, [h('span', { key: 't' }, pxInline(it.text, false))].concat(kids || []))
      }))
    })
  }
  const lines = String(p.md == null ? '' : p.md).split(/\r?\n/)
  const nodes: any[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trim = line.trim()
    if (trim.indexOf('```') === 0) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && lines[i].trim().indexOf('```') !== 0) { codeLines.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1
      nodes.push(h('pre', { key: key() }, h('code', null, codeLines.join('\n'))))
      continue
    }
    const hm = /^(#{1,6})\s+(.+)$/.exec(trim)
    if (hm) {
      const lv = Math.min(hm[1].length, 3)
      nodes.push(h('h' + lv, { key: key() }, pxInline(hm[2], false))); i += 1; continue
    }
    if (/^---+$/.test(trim) || /^\*\*\*+$/.test(trim)) { nodes.push(h('hr', { key: key() })); i += 1; continue }
    const q = /^>\s?(.*)$/.exec(trim)
    if (q) { nodes.push(h('blockquote', { key: key() }, pxInline(q[1], false))); i += 1; continue }
    if (matchListLine(line)) {
      const flat: PixelListFlatItem[] = []
      while (i < lines.length) {
        const r = matchListLine(lines[i])
        if (!r) break
        flat.push(r); i += 1
      }
      renderListSeq(takeList(flat, 0, flat[0].indent).lists).forEach(function (n: any) { nodes.push(n) })
      continue
    }
    if (trim === '') { i += 1; continue }
    nodes.push(h('p', { key: key() }, pxInline(line, false)))
    i += 1
  }
  const ov = st && st.pixelImgOverlay && st.pixelImgOverlay.src ? st.pixelImgOverlay : null
  return h('div', null, [
    h('div', { key: 'doc', className: 'pixel-doc', 'data-lang': p.lang || 'en' }, nodes),
    ov ? h('div', {
      key: 'ov',
      className: 'pixel-overlay',
      style: { position: 'fixed', zIndex: 10000 },
      onClick: function (e: any) { try { if (e.target === e.currentTarget) { st.pixelImgOverlay = null; emit(st) } } catch (err) { /* 忽略 */ } },
    }, h('div', { className: 'pixel-modal', style: { maxWidth: '92%' } }, [
      h('div', { key: 't', className: 'pixel-top' }, [
        h('span', { key: 'a', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ov.alt || 'Image'),
        h(PixelBtn, { key: 'x', mini: true, onClick: function () { st.pixelImgOverlay = null; try { emit(st) } catch (err) { /* 忽略 */ } } }, '✕'),
      ]),
      h('div', { key: 'b', className: 'pixel-body', style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } }, h('img', { src: ov.src, alt: ov.alt || 'Image', style: { maxHeight: '60vh' } })),
      h('div', { key: 'f', className: 'pixel-bot' }, [
        h('span', { key: 'u', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } }, ov.src),
        h('a', { key: 'o', href: ov.src, target: '_blank', rel: 'noreferrer', style: { color: '#5b3df0', fontSize: 11, flex: 'none' } }, tr('sd.openLink')),
      ]),
    ])) : null,
  ])
}
