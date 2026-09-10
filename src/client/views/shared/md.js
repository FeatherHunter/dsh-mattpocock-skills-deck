/**
 * views/shared/md.js — 议题正文 markdown 白名单渲染（mdToHtml）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 *
 * 第一性原理说明（为什么这样写）：
 * 1. 容器约束内容：右侧面板只有三四百像素宽，图片原始尺寸任意大，所以缩略图只做上限约束，
 *    从不拉大，从不变形。宽度不超过内容区，高度不超过二百二十像素，超出按比例缩小。
 * 2. 作者意图在容器内生效：图片标签自带的宽高是作者想显示的大小，保留它，但同样受上限约束，
 *    取两者的较小值。小图保持原样，大图压下来。
 * 3. 正文不可信：正文是用户输入，渲染跑在特权面板里，默认拒绝，只放行安全协议的图片地址，
 *    只认图片地址、说明、宽、高、标题五个属性，不拼网页字符串，只构造界面元素。
 * 4. 信息不丢失：地址危险或加载失败时，不留裂图图标，留下说明文字与原图链接。
 */
export     const MD_LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/g
export     const MD_TASK_RE = /^- \[([ xX])\]\s*(.*)$/
export     const MD_IMG_RE = /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g
export     const MD_HTML_IMG_RE = /<img\b[^>]*\/?>/gi
export     const mdEsc = function (s) { return String(s == null ? '' : s) }
// 图片地址只认安全超文本协议，其余一律返回空，调用方降级为文字
export     const mdSafeImgUrl = function (u) {
      const s = String(u == null ? '' : u).trim().replace(/^<|>$/g, '').trim()
      if (!s) return null
      if (/^https:/i.test(s)) return s
      return null
    }
// 从图片标签原文里读出五个属性，宽高只认正整数并钳制上限，其余属性忽略
export     const mdParseImgAttrs = function (tag) {
      const out = { src: null, alt: '', width: null, height: null, imgTitle: '' }
      const body = String(tag || '').replace(/^<\s*img\b/i, '').replace(/\/?\s*>$/, '')
      const re = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`>]+))/g
      let m = null
      let srcRaw = null
      let altRaw = null
      let titleRaw = null
      let wRaw = null
      let hRaw = null
      while ((m = re.exec(body)) !== null) {
        const name = String(m[1] || '').toLowerCase()
        const val = (m[3] !== undefined) ? m[3] : ((m[4] !== undefined) ? m[4] : (m[5] || ''))
        if (name === 'src') srcRaw = val
        else if (name === 'alt') altRaw = val
        else if (name === 'title') titleRaw = val
        else if (name === 'width') wRaw = val
        else if (name === 'height') hRaw = val
      }
      out.src = mdSafeImgUrl(srcRaw)
      out.alt = String(altRaw == null ? '' : altRaw).slice(0, 200)
      out.imgTitle = String(titleRaw == null ? '' : titleRaw).slice(0, 200)
      const toClamped = function (v) {
        const n = parseInt(String(v == null ? '' : v).trim(), 10)
        if (isNaN(n) || n <= 0) return null
        return Math.min(n, 1200)
      }
      out.width = toClamped(wRaw)
      out.height = toClamped(hRaw)
      return out
    }
// 文案走中英文词条，源码不留中文硬编码；单测无语言服务时回落英文
export     const mdT = function (key, fb) {
      try { if (typeof tr === 'function') return tr(key) } catch (e) {}
      return fb
    }
// 缩略图样式：只做上限约束，从不拉大。包在链接里的图片不给放大手形，保持跳转语义
export     const mdImgStyle = function (attrW, attrH, inLink) {
      const st = { maxWidth: '100%', maxHeight: 220, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'rgba(255,255,255,.03)', display: 'block', margin: '4px 0', objectFit: 'contain' }
      if (attrW) { st.width = attrW }
      if (attrH) { st.height = attrH }
      if (!inLink) { st.cursor = 'zoom-in' }
      return st
    }
// 打开放大浮层：把图片地址与说明写进共享 store 并请求重渲染，关闭由浮层组件负责清空
export     const mdOpenImg = function (st, src, alt) {
      if (!st || !src) return
      st.imgOverlay = { src: src, alt: String(alt || '').slice(0, 200) }
      try { if (typeof emit === 'function') emit(st) } catch (e) {}
    }
// 关闭放大浮层：清空共享 store 并请求重渲染
export     const mdCloseImg = function (st) {
      if (!st) return
      st.imgOverlay = null
      try { if (typeof emit === 'function') emit(st) } catch (e) {}
    }
// 放大浮层：面板内半透明深色背景居中显示大图，点空白、点关闭、按退出键关闭，底部给原图链接
export     const mdImgOverlay = function (st) {
      if (!st || !st.imgOverlay || !st.imgOverlay.src) return null
      const cur = st.imgOverlay
      const close = function () { mdCloseImg(st) }
      const onKey = function (ev) {
        try { if (ev && (ev.key === 'Escape' || ev.key === 'Esc')) { ev.stopPropagation(); close() } } catch (e) {}
      }
      const box = h('div', { role: 'dialog', 'aria-label': cur.alt || 'Image', tabIndex: -1, onKeyDown: onKey, style: { background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 10, maxWidth: '92%', maxHeight: '86%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 12px 48px rgba(0,0,0,.55)' } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, [
          h('span', { style: { flex: 1, minWidth: 0, fontSize: 12, color: 'var(--dsw-alias-label-primary,#e6edf3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cur.alt || 'Image'),
          h('button', { className: 'dsws-btn ghost', autoFocus: true, onClick: function (e) { try { e.stopPropagation() } catch (e2) {} close() }, style: { padding: '2px 8px', fontSize: 11 }, 'aria-label': mdT('panel.closeTitle', 'Close panel') }, '✕'),
        ]),
        h('div', { style: { padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, overflow: 'auto' } }, [
          h('img', { src: cur.src, alt: cur.alt || 'Image', style: { maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 6 } }),
        ]),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [
          h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cur.src),
          h('a', { href: cur.src, target: '_blank', rel: 'noreferrer', onClick: function (e) { try { e.stopPropagation() } catch (e2) {} }, style: { color: '#58a6ff', textDecoration: 'underline', flex: 'none' } }, mdT('env.actOpenUrl', 'Open link')),
        ]),
      ])
      const overlay = h('div', { onClick: function (e) { try { if (e.target === e.currentTarget) close() } catch (e2) {} }, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 } }, [box])
      try { if (typeof portalTop === 'function') return portalTop(overlay) } catch (e) {}
      return overlay
    }
export     const mdInline = function (text, keyBase, opts) {
      const o = opts || {}
      const inLink = !!o.inLink
      const st = o.st || null
      const out = []
      let rest = mdEsc(text)
      let k = 0
      // 先提取图片（在链接之前，否则图片会被链接正则吃掉一半；危险地址直接留说明文字）
      const imgParts = []
      rest = rest.replace(MD_HTML_IMG_RE, function (tag) {
        const a = mdParseImgAttrs(tag)
        if (!a.src) return a.alt || ''
        const idx = imgParts.length
        imgParts.push({ kind: 'html', alt: a.alt, src: a.src, width: a.width, height: a.height, imgTitle: a.imgTitle })
        return '\u0001I' + idx + '\u0001'
      })
      rest = rest.replace(MD_IMG_RE, function (m, alt, src, title) {
        const u = mdSafeImgUrl(src)
        if (!u) return String(alt == null ? '' : alt)
        const idx = imgParts.length
        imgParts.push({ kind: 'md', alt: String(alt == null ? '' : alt).slice(0, 200), src: u, width: null, height: null, imgTitle: String(title == null ? '' : title).slice(0, 200) })
        return '\u0001I' + idx + '\u0001'
      })
      // 再提取链接（链接文字里可能包含上面的图片占位符，递归时把图片解出来；包在链接里的图片不放大）
      const linkParts = []
      const mdSafeUrl = function (u) {
        const s = String(u == null ? '' : u).trim()
        if (!s) return null
        if (/^(https?:|mailto:)/i.test(s)) return s
        if (/^[#/]/.test(s) || /^\.\.?\//.test(s)) return s
        if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s
        return null
      }
      rest = rest.replace(MD_LINK_RE, function (m, label, url) {
        const u = mdSafeUrl(url)
        if (u === null) return label
        linkParts.push(h('a', { key: 'l' + (k++), href: u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, mdInline(label, 'll' + k, { st: st, inLink: true })))
        return '\u0001L' + (linkParts.length - 1) + '\u0001'
      })
      const makeImg = function (part, key) {
        const clickable = !inLink && !!st
        const props = { key: key, src: part.src, alt: part.alt || 'Image', loading: 'lazy', decoding: 'async', style: mdImgStyle(part.width, part.height, !clickable) }
        if (clickable) {
          props.onClick = function () { mdOpenImg(st, part.src, part.alt) }
        }
        const img = h('img', props)
        // 图片标题走跟随式悬浮（与原生 title 同内容：标题优先、说明兜底；无字不包，保持无提示）。
        const tipText = part.imgTitle || part.alt || null
        if (!tipText) return img
        return h(Tip, { content: tipText, key: key + '-tip' }, img)
      }
      // 再处理加粗 / 斜体 / 行内代码 / 删除线（先解析段内链接与图片占位符——两者可嵌在文本任意位置）
      rest.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60|~~[^~]+~~)/g).forEach(function (seg, si) {
        if (!seg) return
        if (seg.indexOf('\u0001') >= 0) {
          const re = /\u0001([LI])(\d+)\u0001/g
          let last = 0
          let m
          while ((m = re.exec(seg)) !== null) {
            if (m.index > last) out.push(seg.slice(last, m.index))
            const n = parseInt(m[2], 10)
            if (m[1] === 'L') {
              if (!isNaN(n) && linkParts[n]) out.push(linkParts[n])
              else out.push(m[0])
            } else {
              if (!isNaN(n) && imgParts[n]) out.push(makeImg(imgParts[n], (keyBase || '') + 'img' + si + '_' + n))
              else out.push(m[0])
            }
            last = m.index + m[0].length
          }
          if (last < seg.length) out.push(seg.slice(last))
          return
        }
        const em = /^\*\*([^*]+)\*\*$/.exec(seg)
        if (em) { out.push(h('strong', { key: (keyBase || '') + 's' + (si) }, em[1])); return }
        const it = /^\*([^*]+)\*$/.exec(seg)
        if (it) { out.push(h('em', { key: (keyBase || '') + 'i' + (si) }, it[1])); return }
        const cd = /^\x60([^\x60]+)\x60$/.exec(seg)
        if (cd) { out.push(h('code', { key: (keyBase || '') + 'c' + (si), style: { fontFamily: 'var(--ds-font-family-code,Consolas,Menlo,monospace)', fontSize: '0.92em', padding: '0 3px', borderRadius: 4, background: 'var(--dsw-alias-markdown-code-block,rgba(255,255,255,.07))' } }, cd[1])); return }
        const del = /^~~([^~]+)~~$/.exec(seg)
        if (del) { out.push(h('span', { key: (keyBase || '') + 'd' + (si), style: { textDecoration: 'line-through', color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, del[1])); return }
        out.push(seg)
      })
      return out
    }
export     const mdToHtml = function (md, opts) {
      const o = opts || {}
      const pass = (o && o.st) ? { st: o.st } : ((o && o.inLink) ? { inLink: true } : {})
      const nodes = []
      const lines = String(md == null ? '' : md).split(/\r?\n/)
      let i = 0
      let k = 0
      const inlineWith = function (t, kb) { return mdInline(t, kb, pass.st ? { st: pass.st } : undefined) }
      const pushList = function (items, ordered) {
        if (!items.length) return
        if (ordered) {
          nodes.push(h('ol', { key: 'ol' + (k++), style: { margin: '2px 0', paddingLeft: 16 } }, items.map(function (it, ii) {
            if (it.task !== null) {
              return h('li', { key: 'li' + ii, style: { listStyle: 'none', marginLeft: -14 } }, [
                h('input', { type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true, style: { marginRight: 5, verticalAlign: 'middle' } }),
                h('span', null, inlineWith(it.text, 't' + ii)),
              ])
            }
            return h('li', { key: 'li' + ii }, inlineWith(it.text, 't' + ii))
          })))
          return
        }
        nodes.push(h('ul', { key: 'ul' + (k++), style: { margin: '2px 0', paddingLeft: 16 } }, items.map(function (it, ii) {
          if (it.task !== null) {
            return h('li', { key: 'li' + ii, style: { listStyle: 'none', marginLeft: -14 } }, [
              h('input', { type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true, style: { marginRight: 5, verticalAlign: 'middle' } }),
              h('span', null, inlineWith(it.text, 't' + ii)),
            ])
          }
          return h('li', { key: 'li' + ii }, inlineWith(it.text, 't' + ii))
        })))
      }
      while (i < lines.length) {
        const line = lines[i]
        const trim = line.trim()
        // 代码块 ```lang ... ```（白名单安全：纯文本块，不执行，块内图片也不解析）
        if (trim.indexOf('```') === 0) {
          const lang = trim.slice(3).trim()
          const codeLines = []
          i++
          while (i < lines.length && lines[i].trim().indexOf('```') !== 0) { codeLines.push(lines[i]); i++ }
          if (i < lines.length && lines[i].trim().indexOf('```') === 0) i++
          nodes.push(h('pre', { key: 'cb' + (k++), style: { margin: '4px 0', padding: '8px 10px', background: 'var(--dsw-alias-markdown-code-block,rgba(255,255,255,.06))', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6, overflowX: 'auto', fontSize: 11, lineHeight: 1.5 } }, [
            h('code', { style: { fontFamily: 'var(--ds-font-family-code,Consolas,Menlo,monospace)', whiteSpace: 'pre' } }, codeLines.join('\n')),
          ]))
          continue
        }
        const hm = /^(#{1,6})\s+(.+)$/.exec(trim)
        if (hm) {
          const lv = hm[1].length
          const sizes = { 1:16, 2:14, 3:13, 4:12, 5:11, 6:10 }
          const sz = sizes[lv] || 12
          nodes.push(h('div', { key: 'h' + (k++), style: { fontSize: sz, fontWeight: 700, margin: (lv<=2?'6px 0 3px':'4px 0 2px'), color: 'var(--dsw-alias-markdown-heading,var(--dsw-alias-label-primary,#e6edf3))', fontFamily: (lv===2?'var(--dsw-font-markdown-h2,var(--dsw-font-family))':undefined) } }, inlineWith(hm[2], 'h' + k))); i++; continue
        }
        const hr = /^---+$/.test(trim) || /^\*\*\*+$/.test(trim)
        if (hr) { nodes.push(h('hr', { key: 'hr' + (k++), style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', margin: '4px 0' } })); i++; continue }
        const q = /^>\s?(.*)$/.exec(trim)
        if (q) { nodes.push(h('blockquote', { key: 'bq' + (k++), style: { margin: '2px 0', paddingLeft: 8, borderLeft: '3px solid var(--dsw-alias-border-l1,#2a2d35)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, inlineWith(q[1], 'q' + k))); i++; continue }
        // 列表（连续行归组）— 支持 - / * / 1. 有序 + 任务列表
        const listItems = []
        let j = i
        let isOrdered = false
        while (j < lines.length) {
          const lt = lines[j].trim()
          const taskM = MD_TASK_RE.exec(lt)
          const bullet = /^-\s+(.+)$/.exec(lt) || /^\*\s+(.+)$/.exec(lt)
          const ordered = /^(\d+)\.\s+(.+)$/.exec(lt)
          if (taskM) { listItems.push({ task: taskM[1], text: taskM[2] }); j++; continue }
          if (bullet) { listItems.push({ task: null, text: bullet[1] }); j++; continue }
          if (ordered) { listItems.push({ task: null, text: ordered[2] }); isOrdered = true; j++; continue }
          break
        }
        if (listItems.length) { pushList(listItems, isOrdered); i = j; continue }
        // 空行 / 普通段落
        if (trim === '') { i++; continue }
        nodes.push(h('div', { key: 'p' + (k++), style: { margin: '1px 0' } }, inlineWith(line, 'p' + k)))
        i++
      }
      if (o.single) return nodes[0] || null
      return nodes
    }
