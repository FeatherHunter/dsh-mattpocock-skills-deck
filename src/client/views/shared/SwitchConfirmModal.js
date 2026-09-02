/**
 * views/shared/SwitchConfirmModal.js — 切换三选一确认 Modal（#189 · #186 定版 · #191 补入口）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:switchConfirmModal (spliced by build) ====` 标记处。
 * UI-only：已选态再选不同 trackerId → 弹此 Modal → wf.bind + 三缓存失效（host 侧）→ snapshot 重取。
 *
 * #191 修订：
 *   - target picker 永远渲染（已选态边框高亮，可重新切换）
 *   - option=null 默认不选中三选一（用户选策略后才可确认）
 *   - 删除 hint 提示框 / prompt 编辑区 / "wf.bind per-cwd 幂等" 灰字（信息冗余）
 *   - 卡片 box-sizing + overflowX hidden 防横向滚动
 */
export const SwitchConfirmModal = (props) => {
  const sid = props && props.sessionId
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)
  const sc = s.switchConfirm
  if (!sc || !sc.open) return null
  const curLabel = typeof labelOf === 'function' ? labelOf(sc.curBackendId) : String(sc.curBackendId)
  const targetLabel = typeof labelOf === 'function' ? labelOf(sc.targetBackendId) : String(sc.targetBackendId)
  const curColor = typeof backendColorOf === 'function' ? backendColorOf(sc.curBackendId) : ''
  const targetColor = typeof backendColorOf === 'function' ? backendColorOf(sc.targetBackendId) : ''
  const isKeep = sc.option === 'keep'
  const isMigrate = sc.option === 'migrate'
  const isClear = sc.option === 'clear'
  // CRI：仅迁移分支阻断（链步骤 gh:remote/gh:installed/gh:authed）
  const cri = sc.criChecks
  const criLoading = !!sc.criLoading
  const criOk = cri ? !!cri.allOk : false
  const criDetails = cri ? [cri.c1, cri.c4, cri.c5].filter(Boolean) : []
  const migrateBlocked = isMigrate && !criLoading && !criOk
  const clearNeedInput = isClear && sc.clearInput !== '确认清空'
  // #191（用户反馈）：option=null 时三选一不默认选中；目标未选 OR 三选一未选时确认按钮禁用
  const _optNone = sc.option == null
  const isTargetPending = sc.targetBackendId == null
  const confirmDisabled = sc.confirming || isTargetPending || _optNone || (isMigrate && (criLoading || !criOk)) || (isClear && clearNeedInput)
  const doClose = function () {
    if (typeof closeSwitchConfirm === 'function') { closeSwitchConfirm(s) } else { s.switchConfirm = null; emit(s) }
  }
  const doConfirm = function () {
    if (confirmDisabled) return
    if (typeof confirmSwitchConfirm === 'function') confirmSwitchConfirm(s)
  }
  const onOption = function (opt) {
    // #191（用户反馈）：未选 target 时不允许选三选一（radio disabled 双保险）
    if (s.switchConfirm.targetBackendId == null) return
    s.switchConfirm.option = opt
    // 切换到迁移时若尚未加载 CRI，触发加载
    if (opt === 'migrate' && !s.switchConfirm.criChecks && !s.switchConfirm.criLoading) {
      s.switchConfirm.criLoading = true; emit(s)
      if (typeof loadSwitchCri === 'function') loadSwitchCri(s)
    }
    emit(s)
  }
  const onClearInput = function (e) {
    s.switchConfirm.clearInput = e.target.value
    emit(s)
  }
  // 触发 CRI 加载（仅在 option=migrate 时触发；用户选 migrate 后才需要 CRI，节省探测）
  React.useEffect(function () {
    if (sc.option === 'migrate' && !sc.criChecks && !sc.criLoading) {
      s.switchConfirm.criLoading = true; emit(s)
      if (typeof loadSwitchCri === 'function') loadSwitchCri(s)
    }
  }, [])
  // #191（用户反馈）：面板内覆盖层（不渲染到 body，不做全屏弹窗）；就地渲染于右侧面板容器内（容器需 position:relative）
  // #191（用户反馈）：顶部 Y 轴恒定——不垂直居中，顶部锚定 + 内容向下生长；按钮在标题行右侧（与 ✕ 并列）
  const overlayStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(0,0,0,.45)', padding: '16px 16px 16px', borderRadius: 12, overflowY: 'auto' }
  // #191（用户反馈）：弹窗高度固定，内容多少不跳动（keep/migrate/clear 三态同高，多出部分内部滚动）
  // #191（用户反馈）：顶部固定（标题 + 按钮恒定），内容区独立向下延伸滚动——按钮永不跳动
  const cardStyle = { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 560, maxHeight: '90vh', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2,#16181d)', boxShadow: '0 16px 48px rgba(0,0,0,.5)', padding: 16 }
  const bodyStyle = { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }
  // #191（用户反馈）：去圆点，点整行即选中；行高固定为选中态高度（徽标占位，选中不跳动）
  const radioRow = function (id, checked, label, desc, badge) {
    const col = id === 'keep' ? '#4ade80' : id === 'migrate' ? '#f59e0b' : '#f87171'
    const disabled = isTargetPending
    return h('div', { key: id, onClick: function(){ if(disabled) return; onOption(id) }, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, minHeight: 54, boxSizing: 'border-box', border: checked ? '1px solid ' + col : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: checked ? 'rgba(88,166,255,.06)' : 'transparent', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 } }, [
      h('span', { style: { flex: 1, minWidth: 0 } }, [
        h('span', { style: { fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 } }, [
          h('span', null, label),
          badge ? h('span', { style: { fontSize: 10, color: col, border: '1px solid ' + col, borderRadius: 4, padding: '0 4px', lineHeight: 1.6 } }, badge) : null,
          h('span', { style: { fontSize: 10, color: col, border: '1px solid ' + col, borderRadius: 4, padding: '0 4px', lineHeight: 1.6, visibility: checked ? 'visible' : 'hidden' } }, '已选'),
          h('span', { style: { fontSize: 10, color: '#4ade80', visibility: (checked && id === 'keep') ? 'visible' : 'hidden' } }, '● 推荐'),
        ]),
        h('span', { style: { fontSize: 11, color: '#8b8b95', display: 'block', marginTop: 2 } }, desc),
      ]),
    ])
  }
  return h('div', { style: overlayStyle, onClick: function (e) { if (e.target === e.currentTarget) doClose() } }, [
    h('div', { style: cardStyle }, [
      // #191（用户反馈）：操作按钮与标题同行右侧（取消 + 确认切换 + ✕），顶部 Y 恒定，不占独立行
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flex: 'none' } }, [
        typeof Ic === 'function' ? Ic({ n: 'compass', size: 14 }) : h('span', null, '◉'),
        h('span', { style: { fontSize: 13, fontWeight: 700, flex: 'none' } }, tr('switch.title')),
        h('span', { style: { flex: 1 } }),
        h(Tip, { content: tr('switch.clearBindTitle') }, h('button', { className: 'dsws-btn ghost', onClick: function () { try { if (typeof clearBackendBinding === 'function') clearBackendBinding(s) } catch (e) {} }, style: { fontSize: 12, padding: '2px 10px', color: '#f87171', borderColor: 'rgba(248,113,113,.45)' } }, tr('switch.clearBind'))),
        h('button', { className: 'dsws-btn ghost', onClick: doClose, style: { fontSize: 12, padding: '2px 10px' } }, tr('switch.cancel')),
        h('button', { className: 'dsws-btn', disabled: confirmDisabled, onClick: doConfirm, style: { fontSize: 12, padding: '2px 10px', background: confirmDisabled ? '#2a2d35' : '#58a6ff', borderColor: confirmDisabled ? '#2a2d35' : '#58a6ff', color: confirmDisabled ? '#8b8b95' : '#0b1220', fontWeight: 700, cursor: confirmDisabled ? 'not-allowed' : 'pointer' } }, sc.confirming ? tr('switch.confirming') : tr('switch.confirm')),
        h('button', { className: 'dsws-btn ghost', onClick: doClose, style: { padding: '2px 6px' } }, '✕'),
      ]),
      // #191：内容区独立滚动（向下延伸），起始标记
      h('div', { style: bodyStyle }, [
      (function(){
        const modules = otherFiltered(s.backendModules)
        const onPick = function(id){
          if (s.switchConfirm.targetBackendId === id) return
          s.switchConfirm.targetBackendId = id
          // #191（用户反馈）：选中 target 后三选一自动选中 keep（推荐），未选 target 时三选一禁用
          if (s.switchConfirm.option == null) s.switchConfirm.option = 'keep'
          // 切换 target 后 CRI 需要重拉（不同后端的 CRI 不同；migrate 选过就再加载一次）
          s.switchConfirm.criChecks = null
          s.switchConfirm.criLoading = true
          emit(s)
          if (typeof loadSwitchCri === 'function') loadSwitchCri(s)
        }
        const headerRow = h('div', { style: { fontSize: 11, color: '#8b8b95', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: curColor, flex: 'none' } }), h('span', { style: { fontWeight: 600, color: curColor } }, curLabel)]),
          h('span', null, '→'),
          sc.targetBackendId == null
            ? h('span', { style: { fontSize: 11, color: '#8b8b95', fontStyle: 'italic' } }, '选择目标后端…')
            : h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: targetColor, flex: 'none' } }), h('span', { style: { fontWeight: 600, color: targetColor } }, targetLabel)]),
          h('span', { style: { flex: 1 } }),
        ])
        const wipBanner = h('div', { style:{ fontSize:11, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, padding:'6px 8px', marginBottom:10 } }, tr('gate.wipNotice'));
        // #191（用户反馈）：picker 永远渲染（即使已选也可重选 target）
        const picker = h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } }, modules.map(function(m){
          const col = typeof backendColorOf === 'function' ? backendColorOf(m.id) : ''
          const isSelected = s.switchConfirm.targetBackendId === m.id
          return h('button', { key: m.id, type: 'button', 'data-target-id': m.id, onClick: function(){ onPick(m.id) }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: isSelected ? '5px 11px' : '6px 12px', borderRadius: 8, border: isSelected ? '2px solid ' + col : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: isSelected ? 'rgba(88,166,255,.10)' : 'transparent', color: isSelected ? col : '#8b8b95', fontSize: 12, fontWeight: isSelected ? 700 : 500, cursor: 'pointer' } }, [
            h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: col, flex: 'none' } }),
            h('span', null, m.label || m.id),
          ])
        }))
        return h('div', null, [headerRow, wipBanner, picker])
      })(),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 } }, [
        radioRow('keep', isKeep, tr('switch.optKeep'), tr('switch.optKeepDesc'), null),
        radioRow('migrate', isMigrate, tr('switch.optMigrate'), tr('switch.optMigrateDesc'), tr('switch.badgeExp')),
        radioRow('clear', isClear, tr('switch.optClear'), tr('switch.optClearDesc'), null),
      ]),
      isMigrate ? h('div', { style: { fontSize: 11, border: '1px solid ' + (migrateBlocked ? 'rgba(248,113,113,.45)' : 'rgba(245,158,11,.35)'), background: migrateBlocked ? 'rgba(248,113,113,.08)' : 'rgba(245,158,11,.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 } }, [
        h('div', { style: { fontWeight: 600, color: migrateBlocked ? '#f87171' : '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 } }, [
          criLoading ? h('span', { className: 'dsws-spinner', style: { width: 11, height: 11, borderWidth: 2, display: 'inline-block' } }) : null,
          h('span', null, criLoading ? tr('switch.criLoading') : migrateBlocked ? tr('switch.criBlocked') : tr('switch.criOk')),
        ]),
        !criLoading ? h('div', { style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 } }, criDetails.map(function (c) {
          // #284：CRI 项现为链步骤（status/show 派生 ok 与文案）
          const ok = !!(c && c.status === 'done')
          const col = ok ? '#4ade80' : '#f87171'
          const cName = (c && c.show && (c.show.fallback || c.show.title || c.show.i18nKey)) || (c && c.id) || ''
          const cDetail = (c && c.show && c.show.desc) || ''
          return h('div', { key: c && c.id, style: { display: 'flex', alignItems: 'center', gap: 6, color: col, fontSize: 11 } }, [
            h('span', { style: { fontSize: 10 } }, ok ? '✓' : '✕'),
            h('span', { style: { fontWeight: 600 } }, cName),
            h('span', { style: { color: '#8b8b95', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cDetail),
          ])
        })) : null,
        migrateBlocked ? h('div', { style: { marginTop: 6, color: '#f87171', fontSize: 11 } }, 'prompt: ' + (criDetails.filter(function (c) { return c && c.status !== 'done' }).map(function (c) { return (c && c.show && c.show.hint) || (c && c.show && c.show.desc) || '' }).join('；') || tr('switch.criHintFallback'))) : null,
        isMigrate ? h('div', { style: { marginTop: 6, color: '#8b8b95', fontSize: 10 } }, tr('switch.migrateNote')) : null,
      ]) : null,
      isClear ? h('div', { style: { border: '1px solid rgba(248,113,113,.45)', background: 'rgba(248,113,113,.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 } }, [
        h('div', { style: { fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 4 } }, tr('switch.clearWarn')),
        h('div', { style: { fontSize: 11, color: '#8b8b95', marginBottom: 6 } }, tr('switch.clearDesc')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
          h('span', { style: { fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' } }, tr('switch.clearInputLabel')),
          h('input', { value: sc.clearInput || '', onChange: onClearInput, placeholder: '确认清空', style: { flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid ' + (clearNeedInput ? 'rgba(248,113,113,.6)' : 'rgba(74,222,128,.5)'), background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 12 } }),
        ]),
        clearNeedInput ? h('div', { style: { fontSize: 10, color: '#f87171', marginTop: 4 } }, tr('switch.clearNeedInput')) : h('div', { style: { fontSize: 10, color: '#4ade80', marginTop: 4 } }, tr('switch.clearOk')),
      ]) : null,
      ]),
    ]),
  ])
}
