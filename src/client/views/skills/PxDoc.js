/**
 * views/skills/PxDoc.js — 像素风 Markdown 渲染（887 原型 verdict 落地，中组件）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxDoc (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxDoc({md, lang, st})；pxDocHeadings(md) 纯函数抽标题给目录用。
 * 白名单与 views/shared/md.js 对齐（标题/分割线/引用/列表/任务列表/代码块/加粗/斜体/
 * 行内代码/删除线/链接/图片），只有两处不同：①列表支持缩进嵌套（生产渲染器会拍平，
 * 详情页要忠于原文，见 887 票面记录）；②画出来的全是 px- 类，由 pxSkillStyles 着色，
 * 不走行内样式。图片只认 https 地址，其余一律留说明文字；点图放大走 st.pxImgOverlay。
 */
export const pxDocHeadings = function (md) {
  const out = []
  String(md == null ? '' : md).split(/\r?\n/).forEach(function (line) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line.trim())
    if (m) out.push({ level: m[1].length, text: m[2].replace(/(\*\*|\*|~~|`)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') })
  })
  return out
}
export const PxDoc = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = p.st || null
  let k = 0
  const key = function () { k += 1; return 'pxd' + k }
  const openImg = function (src, alt) {
    if (!st || !src) return
    st.pxImgOverlay = { src: src, alt: String(alt || '').slice(0, 200) }
    try { if (typeof emit === 'function') emit(st) } catch (e) { /* 画布外自测时没有 emit */ }
  }
  const pxInline = function (text, inLink) {
    const out = []
    const pushMarks = function (seg) {
      seg.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~~[^~]+~~)/g).forEach(function (part) {
        if (!part) return
        let m = /^\*\*([^*]+)\*\*$/.exec(part)
        if (m) { out.push(h('strong', { key: key() }, m[1])); return }
        m = /^\*([^*]+)\*$/.exec(part)
        if (m) { out.push(h('em', { key: key() }, m[1])); return }
        m = /^`([^`]+)`$/.exec(part)
        if (m) { out.push(h('code', { key: key() }, m[1])); return }
        m = /^~~([^~]+)~~$/.exec(part)
        if (m) { out.push(h('span', { key: key(), style: { textDecoration: 'line-through' } }, m[1])); return }
        out.push(part)
      })
    }
    const pushLinks = function (seg) {
      const re = /\[([^\]]+)\]\(([^\s)]+)\)/g
      let last = 0
      let m = null
      let hit = false
      while ((m = re.exec(seg)) !== null) {
        hit = true
        if (m.index > last) pushMarks(seg.slice(last, m.index))
        if (/^https?:/i.test(m[2])) {
          out.push(h('a', { key: key(), href: m[2], target: '_blank', rel: 'noreferrer' }, m[1]))
        } else { out.push(m[1]) }
        last = m.index + m[0].length
      }
      if (!hit) { pushMarks(seg); return }
      if (last < seg.length) pushMarks(seg.slice(last))
    }
    const re = /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["']([^{"']*)["'])?\s*\)/g
    let last = 0
    let m = null
    let hit = false
    while ((m = re.exec(text)) !== null) {
      hit = true
      if (m.index > last) pushLinks(text.slice(last, m.index))
      if (/^https:/i.test(m[2])) {
        const src = m[2]
        const alt = m[1] || 'Image'
        const clickable = !inLink && !!st
        const imgProps = { key: key(), src: src, alt: alt, loading: 'lazy' }
        if (clickable) imgProps.onClick = function () { openImg(src, alt) }
        out.push(h('img', imgProps))
      } else { out.push(m[1] || '') }
      last = m.index + m[0].length
    }
    if (!hit) { pushLinks(text); return out }
    if (last < text.length) pushLinks(text.slice(last))
    return out
  }
  const matchListLine = function (line) {
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
  const takeList = function (flat, pos, indent) {
    const lists = []
    let cur = null
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
        cur.items.push({ task: r.task, text: r.text, kids: null })
        i += 1
      }
    }
    return { lists: lists, next: i }
  }
  const renderListSeq = function (seq) {
    return seq.map(function (lst, li) {
      const tag = lst.ordered ? 'ol' : 'ul'
      return h(tag, { key: key() }, lst.items.map(function (it, ii) {
        const kids = it.kids && it.kids.length ? renderListSeq(it.kids) : null
        if (it.task !== null) {
          return h('li', { key: ii }, h('label', { className: 'px-task' }, [
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
  const nodes = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trim = line.trim()
    if (trim.indexOf('```') === 0) {
      const codeLines = []
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
      const flat = []
      while (i < lines.length && matchListLine(lines[i])) { flat.push(matchListLine(lines[i])); i += 1 }
      renderListSeq(takeList(flat, 0, flat[0].indent).lists).forEach(function (n) { nodes.push(n) })
      continue
    }
    if (trim === '') { i += 1; continue }
    nodes.push(h('p', { key: key() }, pxInline(line, false)))
    i += 1
  }
  const ov = st && st.pxImgOverlay && st.pxImgOverlay.src ? st.pxImgOverlay : null
  return h('div', null, [
    h('div', { key: 'doc', className: 'px-doc', 'data-lang': p.lang || 'en' }, nodes),
    ov ? h('div', {
      key: 'ov',
      className: 'px-overlay',
      style: { position: 'fixed', zIndex: 10000 },
      onClick: function (e) { try { if (e.target === e.currentTarget) { st.pxImgOverlay = null; emit(st) } } catch (err) { /* 忽略 */ } },
    }, h('div', { className: 'px-modal', style: { maxWidth: '92%' } }, [
      h('div', { key: 't', className: 'px-top' }, [
        h('span', { key: 'a', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ov.alt || 'Image'),
        h(PxBtn, { key: 'x', mini: true, onClick: function () { st.pxImgOverlay = null; try { emit(st) } catch (err) { /* 忽略 */ } } }, '✕'),
      ]),
      h('div', { key: 'b', className: 'px-body', style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } }, h('img', { src: ov.src, alt: ov.alt || 'Image', style: { maxHeight: '60vh' } })),
      h('div', { key: 'f', className: 'px-bot' }, [
        h('span', { key: 'u', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } }, ov.src),
        h('a', { key: 'o', href: ov.src, target: '_blank', rel: 'noreferrer', style: { color: '#5b3df0', fontSize: 11, flex: 'none' } }, tr('sd.openLink')),
      ]),
    ])) : null,
  ])
}
