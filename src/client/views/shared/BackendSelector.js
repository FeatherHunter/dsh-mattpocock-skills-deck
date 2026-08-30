/**
 * views/shared/BackendSelector.js — 共享后端选择器（Settings/StatusBar 复用）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export const BackendSelector = (props) => {
  const modules = (typeof otherFiltered === 'function') ? otherFiltered(props.modules) : ((props.modules && props.modules.length) ? props.modules : [])
  const curBackendId = props.curBackendId !== undefined ? props.curBackendId : null
  const curSource = props.curSource || 'fallback'
  const curSelection = props.curSelection || null
  const curRepo = props.curRepo || null
  const onPick = props.onPick
  // #189 · 已选态再选不同 trackerId → 弹确认 Modal（默认保留 + prompt 可编辑）
  const _cx = (typeof React !== 'undefined' && React.useContext) ? React.useContext(typeof DswsCtx !== 'undefined' ? DswsCtx : null) : null
  const _storeSvc = _cx && _cx.storeSvc ? _cx.storeSvc : null
  const _sidForSwitch = props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id) || null
  let _stForSwitch = null
  try {
    if (_storeSvc && _sidForSwitch) _stForSwitch = _storeSvc.storeOf(_sidForSwitch)
    else if (_storeSvc) _stForSwitch = _storeSvc.shared
    else if (typeof storeOf === 'function' && _sidForSwitch) _stForSwitch = storeOf(_sidForSwitch)
    else if (typeof shared !== 'undefined') _stForSwitch = shared
  } catch {}
  if (!_stForSwitch && typeof shared !== 'undefined') _stForSwitch = shared
  const handlePick = function (targetId) {
    try {
      if (_stForSwitch && typeof openSwitchConfirm === 'function' && _stForSwitch.selection && _stForSwitch.selection.backendId != null && _stForSwitch.selection.backendId !== targetId) {
        const opened = openSwitchConfirm(_stForSwitch, targetId)
        if (opened) return
      } else if (curBackendId != null && curBackendId !== targetId && _stForSwitch && typeof openSwitchConfirm === 'function') {
        if (_stForSwitch.selection) {
          const opened2 = openSwitchConfirm(_stForSwitch, targetId)
          if (opened2) return
        }
      }
    } catch {}
    if (typeof onPick === 'function') onPick(targetId)
  }
  const includeOther = props.includeOther !== undefined ? !!props.includeOther : true
  const showSourceCapsule = props.showSourceCapsule !== undefined ? !!props.showSourceCapsule : true
  const isMultiHit = curSelection && Array.isArray(curSelection.multiHit) && curSelection.multiHit.length > 1
  // #191：纯机制派生（store 内置中性兜底，不在此硬编码）
  const colorOf = typeof backendColorOf === 'function' ? backendColorOf : function () { return '' }
  const srcLabel = curSource === 'explicit' ? '显式绑定' : curSource === 'matches' ? '自动匹配' : '回退'
  const srcColor = curSource === 'explicit' ? '#4ade80' : curSource === 'matches' ? '#58a6ff' : '#8b8b95'
  // #191：面板内覆盖层锚点（SwitchConfirmModal 就地渲染 absolute 相对此容器）
  return h('div', { style: { position: 'relative' } }, [
    h('div', { style:{ fontSize:11, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, padding:'6px 8px', marginBottom:8 } }, tr('gate.wipNotice')),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, modules.map(function (m) {
      const isOn = curBackendId === m.id
      const multiHitMark = isMultiHit && curSelection.multiHit.indexOf(m.id) >= 0 ? h('span', { style: { fontSize: 10, color: '#f59e0b', border: '1px solid #f59e0b', borderRadius: 4, padding: '0 4px' } }, '⚠ 多命中') : null
      return h('label', { key: m.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, border: isOn ? '1px solid ' + colorOf(m.id) : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: isOn ? 'rgba(88,166,255,.08)' : 'transparent', cursor: 'pointer' } }, [
        h('input', { type: 'radio', name: 'dsws-backend', checked: isOn, onChange: function () { handlePick(m.id) } }),
        h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: colorOf(m.id), flex: 'none' } }),
        h('span', { style: { fontSize: 12, fontWeight: 600 } }, m.label),
        h('span', { style: { fontSize: 10, color: '#8b8b95' } }, m.id),
        h('span', { style: { flex: 1 } }),
        isOn && showSourceCapsule ? h('span', { style: { fontSize: 10, color: srcColor, border: '1px solid ' + srcColor, borderRadius: 4, padding: '0 4px' } }, srcLabel) : null,
        multiHitMark,
      ])
    })),
    includeOther ? h('label', { key: '_other', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, border: curBackendId === null ? '1px solid #6e7681' : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: curBackendId === null ? 'rgba(110,118,129,.12)' : 'transparent', cursor: 'pointer', marginTop: 4 } }, [
      h('input', { type: 'radio', name: 'dsws-backend', checked: curBackendId === null, onChange: function () { handlePick(null) } }),
      h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: '#6e7681', flex: 'none' } }),
      h('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Other（无后端）'),
      h('span', { style: { fontSize: 10, color: '#8b8b95' } }, '逃生舱'),
    ]) : null,
    isMultiHit ? h('div', { style: { fontSize: 11, color: '#f59e0b', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [typeof Ic === 'function' ? Ic({ n: 'alert', size: 11 }) : h('span', null, '⚠'), h('span', null, '检测到多个可用后端：' + curSelection.multiHit.join(', ') + ' — 建议显式绑定')]) : null,
    curSelection && curSelection.pending ? h('div', { style: { fontSize: 11, color: '#f59e0b', marginTop: 4 } }, '⏳ 探测未决，等待中… 若长时间停留请手动选择') : null,
    curRepo ? h('div', { style: { fontSize: 10, color: '#8b8b95', marginTop: 4 } }, '当前仓库: ' + (curRepo.name || '') + (curRepo.url ? ' · ' + curRepo.url : '')) : null,
    (_stForSwitch && _stForSwitch.switchConfirm && _stForSwitch.switchConfirm.open && typeof SwitchConfirmModal === 'function') ? h(SwitchConfirmModal, { sessionId: _sidForSwitch }) : null,
  ])
}
