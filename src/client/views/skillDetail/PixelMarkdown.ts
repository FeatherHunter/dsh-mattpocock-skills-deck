/**
 * views/skillDetail/PixelMarkdown.ts — 像素风 Markdown 渲染的 TS 真源（887 TS 化，中组件）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelMarkdown (spliced by build) ====` 标记处。
 * 用法：PixelMarkdown({md, lang, st, onSkill, skillNames})；pixelDocHeadings(md) 纯函数抽标题给目录用。
 * onSkill 与 skillNames 都给了的时候，正文里写到的**随包真有的技能名**才做成可点的入口，点了压一层新的
 * 详情（2026-10-10 人拍板）。认三种写法：反引号写的 `/grill-with-docs` 或 `grilling`、直双引号写的
 * "grilling"（#1520），以及普通文字里直接写的 `/grilling`（#1556）；双引号写法只把引号里的名字做成入口，引号本身原样留在正文里。双引号这一种只认同一行内、
 * 引号里文字 1~64 字、整个名字对上的写法（真实技能名最长十几个字符，64 字上限只为挡住一整段话被误当成名字）；
 * 不在名单里、跨行、超长的引号文字都原样当普通文字画。普通文字里的斜杠写法保留作者原样（含开头的斜杠），大小写敏感。
 * 没给技能名单与 onSkill、或名字对不上时就都原样当文字画。
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
  // 正文里能点开的技能名（2026-10-10 人拍板）：只有随包真有的那些做成入口，别的原样当代码。
  // 认三种写法：反引号 `/grill-with-docs`（带斜杠）与 `grilling`（不带）、直双引号 "grilling"（#1520）、普通文字 /grilling（#1556），名字必须整个对上。
  const nameSet = function (names: any): any {
    if (!names || !names.length) return null
    const s: Record<string, boolean> = {}
    for (let i = 0; i < names.length; i++) s[String(names[i])] = true
    return s
  }
  const skillSet = nameSet(p.skillNames)
  const skillRefOf = function (code: string): string | null {
    if (!skillSet || typeof p.onSkill !== 'function') return null
    const text = String(code || '').trim()
    const name = text.charAt(0) === '/' ? text.slice(1) : text
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return null
    return skillSet[name] ? name : null
  }
  let k = 0
  const key = function (): string { k += 1; return 'pxd' + k }
  // 下面三个计数器给正文里能点的元素编号：同一篇正文里链接、图片、技能引用都可能不止一个，
  // 编号保证同屏里每颗控件的定位名都不同（文字会变，不能拿文字当定位名）。
  let linkN = 0
  let imgN = 0
  let skillN = 0
  // #1522：正文里写到的随包 md 文件名也能点开看原文。名单由宿主在读正文时一并给回
  // （p.mdRefs），渲染器只把「名单里真有的文件名」做成入口；对不上就原样画文字，
  // 不给名字造一个没有原文的入口。点开动作在外层（p.onMdFile），这里只负责认名字。
  const mdRefSet = typeof p.onMdFile === 'function' ? nameSet(p.mdRefs) : null
  let mdN = 0
  const mdRefOf = function (text: string, isUrl?: boolean): string | null {
    let t = String(text == null ? '' : text).trim()
    if (isUrl) { if (!t || /^https?:/i.test(t) || t.charAt(0) === '#') return null } else if (t.length > 1 && t.charAt(0) === '`' && t.charAt(t.length - 1) === '`') t = t.slice(1, t.length - 1)
    if (t.indexOf('./') === 0) t = t.slice(2)
    // 带目录的写法只认项目文档惯例的 docs/agents/<文件名>；相对链接与占位符/示例路径按票面边界「不做入口」不画。
    const pathRef = /^docs\/agents\/([A-Za-z0-9][A-Za-z0-9._-]*\.md)$/.exec(t)
    if (t.indexOf('/') >= 0) { if (isUrl || !pathRef) return null; t = pathRef[1] }
    if (!mdRefSet || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(t)) return null
    return mdRefSet[t] ? t : null
  }
  const mdRefNode = function (label: string, ref: string): any {
    // 观感沿用技能名的可点代码（pixel-skillref 只给 code 定过样式），不新增颜色。
    // 接线（#1335 界面反馈）：文件名入口也是按钮，按压档与定位名跟技能引用同一类。
    return h('code', { key: key(), className: 'pixel-skillref', role: 'button', tabIndex: 0, 'data-press': 'button', 'data-log': 'sd.md.file.' + (mdN += 1), onClick: function () { try { (p.onMdFile as (n: string) => void)(ref) } catch (e) { /* 忽略 */ } } }, label)
  }
  // 把一段普通文字按「文件名」切开：只认前后都是自然词边界的整名，避免把长单词里的一段当文件名。
  const mdRefNodes = function (text: string): any[] {
    const s = String(text == null ? '' : text), out: any[] = []
    if (!mdRefSet || !s) { out.push(s); return out }
    const re = /[A-Za-z0-9][A-Za-z0-9._-]*\.md/g
    let last = 0, m: RegExpExecArray | null = null
    while ((m = re.exec(s)) !== null) {
      const name = m[0], end = m.index + name.length
      const before = m.index > 0 ? s.charAt(m.index - 1) : '', after = end < s.length ? s.charAt(end) : ''
      if ((before && /[A-Za-z0-9_.\/-]/.test(before)) || (after && /[A-Za-z0-9_\/-]/.test(after)) || !mdRefSet[name]) continue
      if (m.index > last) out.push(s.slice(last, m.index))
      out.push(mdRefNode(name, name)); last = end
    }
    if (last < s.length) out.push(s.slice(last)); return out
  }
  const openImg = function (src: string, alt: string): void {
    if (!st || !src) return
    st.pixelImgOverlay = { src: src, alt: String(alt || '').slice(0, 200) }
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
  }
  // 正文里写到的技能名做成可点入口的那颗棋子：反引号写法、双引号写法（#1520）、普通文字斜杠写法（#1556）共用这一份，
  // 保证三种写法点下去是同一件事（压一层新详情），同屏定位名也还用同一个 sd.md.skill. 前缀。
  const skillEntry = function (ref: string, label: string): any {
    skillN += 1
    return h('code', {
      key: key(),
      className: 'pixel-skillref',
      role: 'button',
      tabIndex: 0,
      // 接线（#1335 界面反馈）：正文里写到的技能名是一个能点的入口（role=button），
      // 按下要有按压反馈；定位名只带编号，日志里能认出点的是第几个技能引用。
      'data-press': 'button',
      'data-log': 'sd.md.skill.' + skillN,
      onClick: function () { try { (p.onSkill as (n: string) => void)(ref) } catch (e) { /* 忽略 */ } },
    }, label)
  }
  // ---- 行内解析（2026-10-10 按 27 篇真实原文的组合重做）----
  // 盘点自 package/bundled-skills 的 27 篇 SKILL.md，真实出现的组合有：
  //   **`code`** 42 处（粗体里包代码）、**a *b* c** 14 处（粗体里再套斜体）、
  //   **a _b_ c** 25 处（粗体里套下划线强调）、[`code`](url) 3 处（链接标签本身是代码）、
  //   **[label](url)** 1 处（粗体包链接）；另有上百处代码跨度里带 *（glob 之类），
  //   那些星号必须原样，绝不能被当成强调标记。
  // 次序：①代码跨度抽成原子（里面字符不再参与解析）；②反斜杠转义出原样字符；
  // ③图片；④链接（标签递归，共用同一张原子表）；
  // ⑤双引号里写出来的技能名做成入口（#1520，引号本身原样留着；放在图片与链接之后，免得图片 alt/title 与链接地址里的引号文字被改写）；
  // ⑥普通文字里斜杠写出来的技能名做成入口（#1556，放在双引号之后、强调展开之前：链接与图片地址此时已被换成原子，不会被误认；代码跨度同理）；
  // ⑦剩下文字上递归解析强调；⑧原子填回（填回要下探到新建节点的子节点里，否则占位符会露在界面上）。
  // 强调收口的两条细节：** 与 __ 要成对整串；单个 * 只认"孤立的星"收口，
  // 这样 *a **b** c* 反向嵌套也能正确（否则会被切成三段各自的斜体）。
  // 下划线守词边界：_x_ 认，snake_case 不认。
  const pxInline = function (text: string, inLink: boolean): any[] { return pxInlineWith(text, inLink, []) }
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
    // 普通文字里的随包 md 文件名（#1522）：识别靠名单；链接标签里不认（标签本身已有入口）。
    const pushText = function (target: any[], s: string): void {
      if (!mdRefSet || inLink) target.push(s); else mdRefNodes(s).forEach(function (x: any) { target.push(x) })
    }
    const expand = function (nodes: any[]): any[] {
      const out: any[] = []
      nodes.forEach(function (n: any) {
        if (typeof n !== 'string') { out.push(n); return }
        const re = /\u0002A(\d+)\u0002/g
        let last = 0, m: RegExpExecArray | null = null
        while ((m = re.exec(n)) !== null) {
          if (m.index > last) pushText(out, n.slice(last, m.index))
          const atom = atoms[parseInt(m[1], 10)]
          if (atom !== undefined) out.push(atom)
          last = m.index + m[0].length
        }
        if (last < n.length) pushText(out, n.slice(last))
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
      const fileRef = mdRefOf(code); if (fileRef) return mark(mdRefNode(code, fileRef))
      const ref = skillRefOf(code); if (ref) return mark(skillEntry(ref, code))
      return mark(h('code', { key: key() }, code))
    })
    // ② 反斜杠转义：\* 这类写法要出原样的字符，且不得再参与强调与链接解析（原文里 0 处，属边角，
    //   但既然要按组合考虑就补上）。放在代码之后：代码跨度里的反斜杠是内容，不该被当转义吃掉。
    rest = rest.replace(/\\([*_`~\[\]()#!>\\\\])/g, function (all: string, ch: string) {
      return mark(String(ch))
    })
    // ③ 图片：在链接之前（否则 ![](...) 会被链接规则吃掉一半）；只认安全地址
    rest = rest.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g, function (all: string, alt: string, url: string) {
      if (!/^https:/i.test(url)) return alt || ''
      const clickable = !inLink && !!st
      const props: Record<string, any> = { key: key(), src: url, alt: alt || 'Image', loading: 'lazy' }
      if (clickable) {
        imgN += 1
        props.onClick = function () { openImg(url, alt) }
        // 接线（#1335 界面反馈）：点图会放大，图片没有按钮那种固定形状，用 other 档；
        // 编号让同屏多张图分得清点的是哪一张。
        props['data-press'] = 'other'
        props['data-log'] = 'sd.md.img.' + imgN
      }
      return mark(h('img', props))
    })
    // ④ 链接：只认 http(s)；标签递归解析，共用同一张原子表（标签里的代码才找得回自己那条）
    rest = rest.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, function (all: string, label: string, url: string) {
      if (!/^https?:/i.test(url)) {
        // #1522：随包 md 的相对链接（./X.md 或 X.md）也做成入口；别的相对地址维持原样文字。
        const fileRef = mdRefOf(url, true)
        if (!fileRef) return label
        // 标签里的行内代码在前面已经被抽成原子，这里不能再套一层按钮；遇到这种情况退回用文件名当标签。
        const plain = /^`([^`]*)`$/.exec(label), text = (plain ? plain[1] : label).indexOf('\u0002A') >= 0 ? fileRef : (plain ? plain[1] : label)
        return mark(mdRefNode(text, fileRef))
      }
      linkN += 1
      return mark(h('a', {
        key: key(),
        href: url,
        target: '_blank',
        rel: 'noreferrer',
        // 接线（#1335 界面反馈）：正文里的外链用 link 这一档；链接文字会变，定位名只带编号。
        'data-press': 'link',
        'data-log': 'sd.md.link.' + linkN,
      }, pxInlineWith(label, true, atoms)))
    })
    // ⑤ 双引号写出来的技能名（#1520）：随包正文里有技能名是用直双引号写的（例如 "grilling"），
    //   引号本身原样留在正文里，只把「整个名字正好是某个随包技能名」的那段引号内容做成与反引号写法相同的入口。
    //   判断标准就一条：引号里的文字去掉首尾空白、去掉开头可选的 / 之后，整个名字必须出现在本次渲染拿到的技能名单里；
    //   "the interface is the test surface" 这类普通引号文字、以及 "grill" 这种只是长得像技能名的文字都原样保留。
    //   两条可观察的边界：引号必须落在同一行内（正文里没有跨行引用的写法），引号里的文字最多 64 字
    //   （真实技能名最长十几个字符，这个上限只为挡住「一整段话恰好以引号开头结尾」被误当成名字，不是内容规则）。
    //   (?<!\\) 挡住前面带反斜杠的引号：反斜杠转义该由第②步处理，而 " 不在第②步的转义字符集里，这里必须自己排掉。
    //   放在图片与链接之后：图片的 alt 与 title、链接地址里若碰巧有引号文字，此时已经被整段换成原子，不会再被当成技能名。
    rest = rest.replace(/(?<!\\)"([^"\n]{1,64})"/g, function (all: string, inner: string) {
      const ref = skillRefOf(inner)
      if (!ref) return all
      return '"' + mark(skillEntry(ref, inner)) + '"'
    })
    // ⑥ 普通文字里斜杠写出来的技能名（#1556）：随包正文里有作者直接写 /tdd、/code-review 的地方，
    //   命中随包名单的做成与反引号、双引号相同的入口。词边界与随包 md 文件名引用同一套：斜杠前面是
    //   字母、数字、下划线、点、斜杠的不认；名字后面紧跟字母、数字、下划线、斜杠、连字符的不认；
    //   后面紧跟「点＋字母」（如 /tdd.md 这类文件写法）的不认，让文件引用分支处理。
    //   最长贪婪取出名字后整体查表，不中就原样放回，不许前缀回退（如 /implement-spec 整体命中，/tdd-x 不许拆出 tdd）。
    rest = rest.replace(/\/([A-Za-z0-9][A-Za-z0-9_-]*)/g, function (all: string, _name: string, offset: number, whole: string) {
      const before = offset > 0 ? whole.charAt(offset - 1) : '', end = offset + all.length, after = end < whole.length ? whole.charAt(end) : ''
      if ((before && /[A-Za-z0-9_.\/-]/.test(before)) || (after && /[A-Za-z0-9_\/-]/.test(after)) || (after === '.' && /[A-Za-z]/.test(whole.charAt(end + 1) || ''))) return all
      const ref = skillRefOf(all); return ref ? mark(skillEntry(ref, all)) : all
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
      // 代码块里的随包 md 文件名（#1522）：树状图与示例命令里常写文件名，同样做成入口。
      const codeNodes: any[] = []
      for (let ci = 0; ci < codeLines.length; ci++) { if (ci > 0) codeNodes.push('\n'); mdRefNodes(codeLines[ci]).forEach(function (x: any) { codeNodes.push(x) }) }
      nodes.push(h('pre', { key: key() }, h('code', null, codeNodes)))
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
      // 接线（#1335 界面反馈）：点遮罩空白处会关掉放大层，遮罩自己也是能点到的，所以接一组标识；
      // 它不是按钮，用 data-press 的 other 档，表示「按下去的是个没有固定形状的东西」。
      'data-press': 'other',
      'data-log': 'sd.md.img.backdrop',
      onClick: function (e: any) { try { if (e.target === e.currentTarget) { st.pixelImgOverlay = null; emit(st) } } catch (err) { /* 忽略 */ } },
    }, h('div', { className: 'pixel-modal', style: { maxWidth: '92%' } }, [
      h('div', { key: 't', className: 'pixel-top' }, [
        h('span', { key: 'a', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ov.alt || 'Image'),
        // 按压形状是 icon 档：这颗只有「✕」一个符号，小图标下沉会看着歪。
      h(PixelBtn, { key: 'x', mini: true, 'data-press': 'icon', 'data-log': 'sd.md.img.close', onClick: function () { st.pixelImgOverlay = null; try { emit(st) } catch (err) { /* 忽略 */ } } }, '✕'),
      ]),
      h('div', { key: 'b', className: 'pixel-body', style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } }, h('img', { src: ov.src, alt: ov.alt || 'Image', style: { maxHeight: '60vh' } })),
      h('div', { key: 'f', className: 'pixel-bot' }, [
        h('span', { key: 'u', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } }, ov.src),
        // 接线（#1335 界面反馈）：放大层底部那颗「打开原图」也是外链，用 link 档；它跟正文里的链接不是同一颗，定位名要分开。
        h('a', { key: 'o', href: ov.src, target: '_blank', rel: 'noreferrer', 'data-press': 'link', 'data-log': 'sd.md.img.openlink', style: { color: '#5b3df0', fontSize: 11, flex: 'none' } }, tr('sd.openLink')),
      ]),
    ])) : null,
  ])
}
