/**
 * views/shared/md.js — issue 正文 markdown 白名单渲染（mdToHtml，T17）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ============================================================
    // T17：issue 正文 markdown 白名单渲染（mdToHtml）
    //   只认白名单语法，其余一律纯文本（不渲染原始 HTML，防 XSS）
    //   输出标准 HTML 标签 → opencode-palette 主题自动上色（markdownHeading/Link/Code/Emph/Strong）
    //   返回值：React 元素数组（可直接作为 h(...) children）
    // ============================================================
export     const MD_LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/g
export     const MD_TASK_RE = /^- \[([ xX])\]\s*(.*)$/
export     const mdEsc = function (s) { return String(s == null ? '' : s) }
export     const mdInline = function (text, keyBase) {
      const out = []
      let rest = mdEsc(text)
      let k = 0
      // 先提取链接（防内部 ** 混淆；URL 协议白名单防 javascript:/data: 等危险协议）
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
        linkParts.push(h('a', { key: 'l' + (k++), href: u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, mdInline(label, 'll' + k)))
        return '\u0001L' + (linkParts.length - 1) + '\u0001'
      })
      // 再处理加粗 / 斜体 / 行内代码 / 删除线（先解析段内链接占位符——链接可嵌在文本任意位置）
      rest.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60|~~[^~]+~~)/g).forEach(function (seg, si) {
        if (!seg) return
        if (seg.indexOf('\u0001') >= 0) {
          const re = /\u0001L(\d+)\u0001/g
          let last = 0
          let m
          while ((m = re.exec(seg)) !== null) {
            if (m.index > last) out.push(seg.slice(last, m.index))
            const n = parseInt(m[1], 10)
            if (!isNaN(n) && linkParts[n]) out.push(linkParts[n])
            else out.push(m[0])
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
      const nodes = []
      const lines = String(md == null ? '' : md).split(/\r?\n/)
      let i = 0
      let k = 0
      const pushList = function (items, ordered) {
        if (!items.length) return
        if (ordered) {
          nodes.push(h('ol', { key: 'ol' + (k++), style: { margin: '2px 0', paddingLeft: 16 } }, items.map(function (it, ii) {
            if (it.task !== null) {
              return h('li', { key: 'li' + ii, style: { listStyle: 'none', marginLeft: -14 } }, [
                h('input', { type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true, style: { marginRight: 5, verticalAlign: 'middle' } }),
                h('span', null, mdInline(it.text, 't' + ii)),
              ])
            }
            return h('li', { key: 'li' + ii }, mdInline(it.text, 't' + ii))
          })))
          return
        }
        nodes.push(h('ul', { key: 'ul' + (k++), style: { margin: '2px 0', paddingLeft: 16 } }, items.map(function (it, ii) {
          if (it.task !== null) {
            return h('li', { key: 'li' + ii, style: { listStyle: 'none', marginLeft: -14 } }, [
              h('input', { type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true, style: { marginRight: 5, verticalAlign: 'middle' } }),
              h('span', null, mdInline(it.text, 't' + ii)),
            ])
          }
          return h('li', { key: 'li' + ii }, mdInline(it.text, 't' + ii))
        })))
      }
      while (i < lines.length) {
        const line = lines[i]
        const trim = line.trim()
        // 代码块 ```lang ... ```（白名单安全：纯文本块，不执行）
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
          nodes.push(h('div', { key: 'h' + (k++), style: { fontSize: sz, fontWeight: 700, margin: (lv<=2?'6px 0 3px':'4px 0 2px'), color: 'var(--dsw-alias-markdown-heading,var(--dsw-alias-label-primary,#e6edf3))', fontFamily: (lv===2?'var(--dsw-font-markdown-h2,var(--dsw-font-family))':undefined) } }, mdInline(hm[2], 'h' + k))); i++; continue
        }
        const hr = /^---+$/.test(trim) || /^\*\*\*+$/.test(trim)
        if (hr) { nodes.push(h('hr', { key: 'hr' + (k++), style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', margin: '4px 0' } })); i++; continue }
        const q = /^>\s?(.*)$/.exec(trim)
        if (q) { nodes.push(h('blockquote', { key: 'bq' + (k++), style: { margin: '2px 0', paddingLeft: 8, borderLeft: '3px solid var(--dsw-alias-border-l1,#2a2d35)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, mdInline(q[1], 'q' + k))); i++; continue }
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
        nodes.push(h('div', { key: 'p' + (k++), style: { margin: '1px 0' } }, mdInline(line, 'p' + k)))
        i++
      }
      if (o.single) return nodes[0] || null
      return nodes
    }
