/**
 * views/shared/BackendSelector.ts — 共享后端选择器（Settings/StatusBar 复用）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:... (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、字符串、
 * 数字、对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源（ESM 导出），
 * scripts/build.mts 构建时剥掉行首 export 后把声明体拼进 src/client/index.ts 的客户端闭包
 * （源码树里只有这一份真源）；模块说明符保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这些名字不在本文件里定义，是客户端闭包里更早拼进来的环境与叶子（React 与上下文对象由
 * 闭包入口提供；otherFiltered / backendColorOf 等是别的叶子里的判据函数；log / dswsLogHash 是
 * 日志口；SwitchConfirmModal 是共享弹窗），由构建按 build.mjs 的次序拼进同一个函数作用域带进来，
 * 这里只声明形状、不参与转译。为什么不写 import：拼进闭包的片段里留着运行时 import，运行时就是
 * 语法错。声明成 any / (...args: any[]): any 而不是精确签名，是为了保证「只加类型、不加约束」——
 * 转译后一字不差。注意这些名字在本文件里都被 typeof 探过或用 ... !== 'undefined' 探过，所以声明
 * 成常量不会与运行时的「可能不存在」冲突。
 */
declare const React: any;
declare const DswsCtx: any;
declare const storeOf: any;
declare const shared: any;
declare const log: any;
declare const dswsLogHash: any;
declare const openSwitchConfirm: any;
declare const backendColorOf: any;
declare const SwitchConfirmModal: any;
declare function otherFiltered(...args: any[]): any;
declare function Ic(...args: any[]): any;
declare function tr(...args: any[]): any;
declare function h(...args: any[]): any;
export const BackendSelector = (props: any) => {
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
  const handlePick = function (targetId: any) {
    try { const fromId = (curBackendId !== undefined && curBackendId !== null) ? String(curBackendId) : ''; const toId = (targetId !== undefined && targetId !== null) ? String(targetId) : ''; if (fromId !== toId) log('info', 'backend.switch', { from: fromId, to: toId, cwdHash: dswsLogHash((_stForSwitch && _stForSwitch.cwd) || '') }) } catch (eL) {}
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
  const srcLabel = curSource === 'explicit' ? tr('switch.srcExplicit') : curSource === 'matches' ? tr('switch.srcMatches') : tr('switch.srcFallback')
  const srcColor = curSource === 'explicit' ? '#4ade80' : curSource === 'matches' ? '#58a6ff' : '#8b8b95'
  // #191：面板内覆盖层锚点（SwitchConfirmModal 就地渲染 absolute 相对此容器）
  // #1600：筹备中黄条摘掉——GitLab 已可用，不再提示。
  return h('div', { style: { position: 'relative' } }, [
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, modules.map(function (m: any) {
      const isOn = curBackendId === m.id
      const multiHitMark = isMultiHit && curSelection.multiHit.indexOf(m.id) >= 0 ? h('span', { style: { fontSize: 10, color: '#f59e0b', border: '1px solid #f59e0b', borderRadius: 4, padding: '0 4px' } }, tr('switch.multiHitBadge')) : null
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
      h('span', { style: { fontSize: 12, fontWeight: 600 } }, tr('switch.otherOption')),
      h('span', { style: { fontSize: 10, color: '#8b8b95' } }, tr('switch.otherEscape')),
    ]) : null,
    isMultiHit ? h('div', { style: { fontSize: 11, color: '#f59e0b', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [typeof Ic === 'function' ? Ic({ n: 'alert', size: 11 }) : h('span', null, '⚠'), h('span', null, tr('switch.multiHitLine', { list: curSelection.multiHit.join(', ') }))]) : null,
    curSelection && curSelection.pending ? h('div', { style: { fontSize: 11, color: '#f59e0b', marginTop: 4 } }, tr('switch.pendingLine')) : null,
    curRepo ? h('div', { style: { fontSize: 10, color: '#8b8b95', marginTop: 4 } }, tr('switch.currentRepo', { repo: (curRepo.name || '') + (curRepo.url ? ' · ' + curRepo.url : '') })) : null,
    (_stForSwitch && _stForSwitch.switchConfirm && _stForSwitch.switchConfirm.open && typeof SwitchConfirmModal === 'function') ? h(SwitchConfirmModal, { sessionId: _sidForSwitch }) : null,
  ])
}
