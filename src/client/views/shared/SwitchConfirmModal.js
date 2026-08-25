/**
 * views/shared/SwitchConfirmModal.js — 切换三选一确认 Modal（#189 · #186 定版）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:switchConfirmModal (spliced by build) ====` 标记处。
 * UI-only：已选态再选不同 trackerId → 弹此 Modal → wf.bind + 三缓存失效（host 侧）→ snapshot 重取。
 */
export const DEFAULT_SWITCH_PROMPT = '现有 issues 保留在原后端，切换后不可见，切回可见'
export const SwitchConfirmModal = (props) => {
  const sid = props && props.sessionId
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)
  const sc = s.switchConfirm
  if (!sc || !sc.open) return null
  const curLabel = typeof labelOf === 'function' ? labelOf(sc.curBackendId) : String(sc.curBackendId)
  const targetLabel = typeof labelOf === 'function' ? labelOf(sc.targetBackendId) : String(sc.targetBackendId)
  const curColor = typeof backendColorOf === 'function' ? backendColorOf(sc.curBackendId) : '#6e7681'
  const targetColor = typeof backendColorOf === 'function' ? backendColorOf(sc.targetBackendId) : '#6e7681'
  const isKeep = sc.option === 'keep'
  const isMigrate = sc.option === 'migrate'
  const isClear = sc.option === 'clear'
  // CRI：仅迁移分支阻断（wf.status 1/4/5）
  const cri = sc.criChecks
  const criLoading = !!sc.criLoading
  const criOk = cri ? !!cri.allOk : false
  const criDetails = cri ? [cri.c1, cri.c4, cri.c5].filter(Boolean) : []
  const migrateBlocked = isMigrate && !criLoading && !criOk
  const clearNeedInput = isClear && sc.clearInput !== '确认清空'
  // #191：目标待选态时（targetBackendId==null）确认按钮禁用；option=keep/migrate/clear 任选后都可点（target 由独立 radio 决定）
  const isTargetPending = sc.targetBackendId == null
  const confirmDisabled = sc.confirming || isTargetPending || (isMigrate && (criLoading || !criOk)) || (isClear && clearNeedInput)
  const doClose = function () {
    if (typeof closeSwitchConfirm === 'function') { closeSwitchConfirm(s) } else { s.switchConfirm = null; emit(s) }
  }
  const doConfirm = function () {
    if (confirmDisabled) return
    if (typeof confirmSwitchConfirm === 'function') confirmSwitchConfirm(s)
  }
  const onPromptChange = function (e) {
    const v = e.target.value
    s.switchConfirm.prompt = v
    emit(s)
  }
  const onOption = function (opt) {
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
  // 触发 CRI 加载（首次打开默认 keep，切到 migrate 时补拉；keep 下也后台预拉）
  React.useEffect(function () {
    if (!sc.criChecks && !sc.criLoading) {
      s.switchConfirm.criLoading = true; emit(s)
      if (typeof loadSwitchCri === 'function') loadSwitchCri(s)
    }
  }, [])
  const overlayStyle = { position: 'fixed', inset: 0, zIndex: 2147483001, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', padding: 16 }
  const cardStyle = { width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2,#16181d)', boxShadow: '0 16px 48px rgba(0,0,0,.5)', padding: 16 }
  const radioRow = function (id, checked, label, desc, badge) {
    const col = id === 'keep' ? '#4ade80' : id === 'migrate' ? '#f59e0b' : '#f87171'
    return h('label', { key: id, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, border: checked ? '1px solid ' + col : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: checked ? 'rgba(88,166,255,.06)' : 'transparent', cursor: 'pointer' } }, [
      h('input', { type: 'radio', name: 'dsws-switch-opt', checked: checked, onChange: function () { onOption(id) }, style: { marginTop: 3 } }),
      h('span', { style: { flex: 1 } }, [
        h('span', { style: { fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 } }, [
          h('span', null, label),
          badge ? h('span', { style: { fontSize: 10, color: col, border: '1px solid ' + col, borderRadius: 4, padding: '0 4px', lineHeight: 1.6 } }, badge) : null,
          checked && id === 'keep' ? h('span', { style: { fontSize: 10, color: '#4ade80' } }, '● 默认') : null,
        ]),
        h('span', { style: { fontSize: 11, color: '#8b8b95', display: 'block', marginTop: 2 } }, desc),
      ]),
    ])
  }
  return portalTop(h('div', { style: overlayStyle, onClick: function (e) { if (e.target === e.currentTarget) doClose() } }, [
    h('div', { style: cardStyle }, [
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
        typeof Ic === 'function' ? Ic({ n: 'compass', size: 14 }) : h('span', null, '◉'),
        h('span', { style: { fontSize: 13, fontWeight: 700 } }, tr('switch.title')),
        h('span', { style: { flex: 1 } }),
        h('button', { className: 'dsws-btn ghost', onClick: doClose, style: { padding: '2px 6px' } }, '✕'),
      ]),
      // #191：目标待选态（targetBackendId==null）渲染 target radio；已选态保留原 curLabel→targetLabel
      (function(){
        const modules = (s.backendModules || [{id:'github',label:'GitHub'},{id:'markdown',label:'Markdown'},{id:'gitlab',label:'GitLab'}]).filter(function(m){ return String(m.id).toLowerCase() !== 'other' })
        const onPick = function(id){
          if (s.switchConfirm.targetBackendId === id) return
          s.switchConfirm.targetBackendId = id
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
          h('span', { style: { fontSize: 10, color: '#8b8b95' } }, 'wf.bind per-cwd 幂等'),
        ])
        if (sc.targetBackendId != null) return headerRow
        const picker = h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } }, modules.map(function(m){
          const col = typeof backendColorOf === 'function' ? backendColorOf(m.id) : '#6e7681'
          return h('button', { key: m.id, type: 'button', onClick: function(){ onPick(m.id) }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid ' + col, background: 'transparent', color: col, fontSize: 12, fontWeight: 600, cursor: 'pointer' } }, [
            h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: col, flex: 'none' } }),
            h('span', null, m.label || m.id),
          ])
        }))
        return h('div', null, [headerRow, picker])
      })(),
      h('div', { style: { fontSize: 11, color: '#e6edf3', background: 'rgba(88,166,255,.08)', border: '1px solid rgba(88,166,255,.25)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 } }, [
        h('div', { style: { fontWeight: 600, marginBottom: 4 } }, tr('switch.hint')),
        h('div', { style: { color: '#8b8b95' } }, tr('switch.hintDesc')),
      ]),
      h('div', { style: { marginBottom: 10 } }, [
        h('div', { style: { fontSize: 11, fontWeight: 600, marginBottom: 4 } }, tr('switch.promptLabel')),
        h('textarea', { value: sc.prompt || '', onChange: onPromptChange, rows: 2, placeholder: DEFAULT_SWITCH_PROMPT, style: { width: '100%', minHeight: 44, maxHeight: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: 'var(--dsw-alias-bg-layer-1,#10131a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 12, resize: 'vertical' } }),
        h('div', { style: { fontSize: 10, color: '#8b8b95', marginTop: 3 } }, tr('switch.promptHint')),
      ]),
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
          const ok = c && c.ok
          const col = ok ? '#4ade80' : '#f87171'
          return h('div', { key: c.id, style: { display: 'flex', alignItems: 'center', gap: 6, color: col, fontSize: 11 } }, [
            h('span', { style: { fontSize: 10 } }, ok ? '✓' : '✕'),
            h('span', { style: { fontWeight: 600 } }, c.name || ('#' + c.id)),
            h('span', { style: { color: '#8b8b95', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.detail || ''),
          ])
        })) : null,
        migrateBlocked ? h('div', { style: { marginTop: 6, color: '#f87171', fontSize: 11 } }, 'prompt: ' + (criDetails.filter(function (c) { return !c.ok }).map(function (c) { return c.hint || c.detail }).join('；') || tr('switch.criHintFallback'))) : null,
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
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 } }, [
        h('button', { className: 'dsws-btn ghost', onClick: doClose, style: { fontSize: 12 } }, tr('switch.cancel')),
        h('button', { className: 'dsws-btn', disabled: confirmDisabled, onClick: doConfirm, style: { fontSize: 12, background: confirmDisabled ? '#2a2d35' : '#58a6ff', borderColor: confirmDisabled ? '#2a2d35' : '#58a6ff', color: confirmDisabled ? '#8b8b95' : '#0b1220', fontWeight: 700, cursor: confirmDisabled ? 'not-allowed' : 'pointer' } }, sc.confirming ? tr('switch.confirming') : tr('switch.confirm')),
      ]),
    ]),
  ]))
}
