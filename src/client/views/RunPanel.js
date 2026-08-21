/**
 * views/RunPanel.js — Run 卡控制面板（5.10）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.10 Run 卡控制面板（v25：状态展示 + 快捷打开配置页；外观切换已迁入设置页）----
export     const RunPanel = (props) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const cur = props.useSessions((x) => x.current)
      const s = cx ? cx.storeSvc.useStore(cur) : useStore(cur)
      return h('div', { style: { border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1,#10131a)', fontFamily: 'var(--dsw-font-family)', fontSize: 13, color: 'var(--dsw-alias-label-primary,#e6edf3)', lineHeight: 1.6 } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
          h('strong', null, tr('panel.title')),
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, color: '#4ade80', fontSize: 12 } }, [Ic({ n: 'dot', size: 10 }), h('span', null, tr('run.loaded'))]),
        ]),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', margin: '6px 0' } }, tr('run.desc')),
        h('div', { className: 'dsws-uirow' }, [
          h('button', { className: 'dsws-btn', onClick: function () { openPanel(s) } }, tr('run.openPanel')),
          // v25：设置面板为 shell 组件本地状态、无公开打开 API（已查证）→ 按钮引导路径（偏离记录见 T2a resolution）
          h('button', { className: 'dsws-btn', onClick: function () { flash(s, tr('run.cfgGuide'), 'info') } }, tr('run.openCfg')),
        ]),
      ])
    }
