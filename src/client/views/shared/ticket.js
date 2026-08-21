/**
 * views/shared/ticket.js — 票进度渲染（tStatus 系，v1.5 T12）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ============================================================
    // v1.5 T12：票进度渲染（状态徽章 + 进度条）—— open/close 原生 + 进度自评
export     const tStatus = function (t) {
      if (t.state === 'CLOSED') return { key: 'done', color: '#3fb950', icon: 'check' }
      if (t.progress === null || t.progress === undefined || t.progress <= 0) return { key: 'todo', color: '#8b8b95', icon: 'dot' } // B4：0% = 未动工（契约），不进 doing
      if (t.progress >= 100) return { key: 'accept', color: '#f59e0b', icon: 'alert' }
      if (t.progress >= 95) return { key: 'confirm', color: '#f59e0b', icon: 'alert' }
      return { key: 'doing', color: '#58a6ff', icon: 'dot' }
    }
export     const tStatusLabel = function (t) {
      const s = tStatus(t)
      if (s.key === 'done') return tr('progress.done')
      if (s.key === 'accept') return tr('progress.accept')
      if (s.key === 'confirm') return tr('progress.confirm')
      if (s.key === 'doing') return tr('progress.doing', { n: t.progress })
      return tr('progress.todo')
    }
export     const tProgressBar = function (t) {
      const p = (t.state === 'CLOSED') ? 100 : (t.progress === null || t.progress === undefined ? 0 : t.progress)
      const color = (t.state === 'CLOSED') ? '#3fb950' : (t.progress === null || t.progress === undefined ? '#52525b' : '#58a6ff')
      const label = (t.state === 'CLOSED') ? '100%' : (t.progress === null || t.progress === undefined ? '—' : t.progress + '%')
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 } }, [
        h('div', { style: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' } }, [
          h('div', { style: { width: String(p) + '%', height: '100%', background: color, borderRadius: 2 } }),
        ]),
        h('span', { style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right' } }, label),
      ])
    }
export     const tStatusBadge = function (t) {
      if (t.state === 'CLOSED') return null
      const s = tStatus(t)
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 2, color: s.color, fontSize: 9, flex: 'none' } }, [
        Ic({ n: s.icon, size: 8 }),
        h('span', null, tStatusLabel(t)),
      ])
    }
