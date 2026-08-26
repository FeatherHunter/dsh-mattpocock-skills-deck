/**
 * views/shared/chips.js — 通用小徽章（Dot / TypeChip）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export     const Dot = ({ level }) => { const cx = React.useContext(DswsCtx); const h = cx ? cx.h : React.createElement; return h('span', { className: 'dsws-dot', style: { background: level === 'ok' ? '#4ade80' : level === 'warn' ? '#f59e0b' : level === 'bad' ? '#f87171' : '#52525b' } }) }
export     const TypeChip = ({ type }) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const t = TYPE_LABEL[type] || [type, '', type]
      const cls = { research: 'dsws-chip-r', prototype: 'dsws-chip-p', grilling: 'dsws-chip-g', task: 'dsws-chip-t', map: 'dsws-chip-m' }[type] || ''
      return h('span', { className: 'dsws-chip ' + cls }, [
        Ic({ n: TYPE_ICON[type] || 'dot', size: 11 }),
        h('span', null, tr('type.' + type)),
      ])
    }
