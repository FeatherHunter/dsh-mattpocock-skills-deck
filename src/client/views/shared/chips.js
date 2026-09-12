/**
 * views/shared/chips.js — 通用小徽章（Dot / TypeChip）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export     const Dot = ({ level }) => { const cx = React.useContext(DswsCtx); const h = cx ? cx.h : React.createElement; return h('span', { className: 'dsws-dot', style: { background: level === 'ok' ? '#4ade80' : level === 'warn' ? '#f59e0b' : level === 'bad' ? '#f87171' : '#52525b' } }) }
export     const TypeChip = ({ type }) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // 样式类按类型分发；issue（普通票）走中性灰，其余五种是 wayfinder 自己的类型色。
      // 文字一律来自词条 type.<类型>，没有词条时 tr 会退回键名（那正是 #626 修的那个毛病）。
      const cls = { research: 'dsws-chip-r', prototype: 'dsws-chip-p', grilling: 'dsws-chip-g', task: 'dsws-chip-t', map: 'dsws-chip-m', issue: 'dsws-chip-i' }[type] || ''
      // 有图标才画图标：普通票（issue）没有自己的图标，只出文字 —— 前面挂一个灰点像多出来的
      // 项目符号，去掉之后文字左右留白对称（#626）
      const icon = TYPE_ICON[type]
      return h('span', { className: 'dsws-chip ' + cls }, [
        icon ? Ic({ n: icon, size: 11 }) : null,
        h('span', null, tr('type.' + type)),
      ])
    }
