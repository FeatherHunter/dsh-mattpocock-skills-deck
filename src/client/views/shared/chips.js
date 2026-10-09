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
    // #949 瞬间底座（收敛：从 ListTab.js 搬出，列表文件守 350 行）：可点小药丸的键盘可达三件套。
    //   Tab 停留靠 tabIndex: 0，外圈描边走样式叶子的 :focus-visible，不占布局；
    //   回车与空格沿用鼠标同一条路（调起 DOM click，不另写分支），布局文案都不动。
export     const chipKeyDown = function (e) {
      const k = e && e.key
      if (k === 'Enter' || k === ' ') { try { if (e.preventDefault) e.preventDefault() } catch (_) {} try { if (e.currentTarget) e.currentTarget.click() } catch (_) {} }
    }
    // 同一三件套的打包写法：返回一个新对象（带上调用点给的那些 props），不去改调用方传进来的那个对象 ——
    //   传共享对象时不会被顺手带上三件套（评审 2026-10-09 指出的坑）。行为与逐个写那三行完全一致。
export     const chipProps = function (p) {
      return Object.assign({ tabIndex: 0, role: 'button', onKeyDown: chipKeyDown }, p || {})
    }
