/**
 * panel/NamingFailBanner.js — 命名链路定败的面板级常驻提醒（#267 · F4）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:namingFailBanner (spliced by build) ====` 标记处
 * （一源两物，与 Dock/Overlay 同模式 · G4 单文件单职责）。
 *
 * 数据面：有限重试耗尽清单（namingFailureInfo）由渲染钩子 kernel/api.js applyNamingFailurePanel
 * 落共享 store；本组件自订阅共享 store —— 面板级可见而非目标会话内闪现（AC1）。
 * 化解 = 值比对锁两路（手改 → locked 终局 / 值一致收敛 renamed），均只读探测绝不盲写，
 * 化解后下一轮拉询 host failures 清单不再包含该会话，横幅自动撤下。
 */
    export const NamingFailBanner = () => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const shS = cx ? cx.storeSvc.useStore(null) : useStore(null)
      const fls = ((shS && Array.isArray(shS.namingFailures)) ? shS.namingFailures : []).filter(function (f) { return f && f.sessionId })
      if (!fls.length) return null
      const style = { margin: '0 12px 6px', padding: '5px 8px', background: 'rgba(248,113,113,.10)', border: '1px solid rgba(248,113,113,.45)', color: '#f87171', fontSize: 11, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 3, flex: 'none' }
      const rows = fls.slice(0, 3).map(function (f) {
        return h('div', { key: f.sessionId, style: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (f.number != null ? '#' + f.number : tr('naming.stageDraft')) + ' · ' + (f._title || String(f.sessionId).slice(0, 10)) + ' — ' + String(f.error || 'rename failed'))
      })
      return h('div', { 'data-naming-fail-banner': '1', style: style }, [
        h('div', { style: { fontWeight: 700 } }, tr('naming.failTitle') + ' ×' + fls.length),
        h('div', { style: { fontSize: 10, opacity: .85 } }, tr('naming.failHint')),
      ].concat(rows))
    }
