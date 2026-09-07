/**
 * statusbar/StatusLogMenu.js — 状态栏常驻诊断日志入口（#492 状态栏线）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 范围：小绿点（开时常驻绿、关时不挂载，#522 推翻 #333 常驻决议）＋四键菜单（导出今日日志／打开日志目录／
 * 复制日志路径／清空今日日志）＋清空确认框＋成功与失败反馈（#523：悬停 200 毫秒自开、单击照旧、离区 300 毫秒关；
 * 与技能菜单互斥；在绿点正上方水平居中、自顶向下展开、视口不够时自动内收；无底部说明行、宽度贴合最长行（#525 居中，替代 #523 左侧对齐）。
 * 接线：导出调 wf.logExport，清空调 wf.logClear，跳转目录调 wf.openFolder（目录用文件夹电话，文件才用 wf.openPath），
 * 复制路径走本地剪贴板（copyText），开关态读日志底座 logSwitch（启动已向宿主对账）。
 * 以后改状态栏日志入口的人改它；StatusBar.js 只留一行挂载。
 */
const dswsLogKnown = { dir: '', path: '' }
const dswsLogToday = function () {
  const d = new Date()
  const pad = function (n) { return String(n).padStart(2, '0') }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
const dswsLogHostOk = function () {
  return (typeof host !== 'undefined' && host && typeof host.call === 'function')
}
// 导出链路失败原因归一（#499 自监控 50）：解析器只回码，记账统一在用户动作处，一处失败只记一行。
const dswsLogResolveReason = function (err) {
  const s = String(err || '')
  if (s.indexOf('path-missing') >= 0) return 'path-missing'
  if (s.indexOf('host-unavailable') >= 0) return 'host-unavailable'
  return 'export-not-ok'
}
const dswsLogMenuFail = function (op, reason, err) {
  try { if (typeof logExportFail === 'function') logExportFail(op, reason, err) } catch (eL) {}
}
// 同形宿主失败行收拢（#514 提纯：十一处 host.call.fail 同形记账收一处，事件名级别字段不变）。
const dswsLogWarnCall = function (method, kind, err) { try { log('warn', 'host.call.fail', { method: method, kind: kind, errorHash: dswsLogHash(dswsLogTrunc(String((err && err.message) || err), 120, 'error')) }) } catch (eL) {} }
const dswsLogPickPath = function (v) { if (typeof v === 'string') return v; if (v && typeof v === 'object') { const c = v.displayPath || v.path || v.__target || v.target; if (typeof c === 'string' && c) return c } return '' } // 回包目录拆盒：字符串直用，目标对象读可显示路径，旧包同样认得出。
const dswsLogRemember = function (res) {
  try {
    const d = dswsLogPickPath(res && res.dir), p = dswsLogPickPath(res && res.path)
    if (d) dswsLogKnown.dir = d; if (p) dswsLogKnown.path = p
    else if (res && typeof res.fileName === 'string' && res.fileName && dswsLogKnown.dir) {
      dswsLogKnown.path = dswsLogKnown.dir + (dswsLogKnown.dir.slice(-1) === '/' ? '' : '/') + res.fileName
    }
  } catch (e) {}
}
// resolve known dir/path: use cache, else read-only export call to resolve (no toast here).
const dswsLogEnsurePath = function () {
  if (dswsLogKnown.dir && dswsLogKnown.path) { try { log('info', 'host.call', { method: 'wf.logExport', latencyMs: 0, ok: true, kind: 'log-resolve-cache' }) } catch (eL) {} return Promise.resolve({ ok: true, dir: dswsLogKnown.dir, path: dswsLogKnown.path }) }
  const t0 = Date.now()
  if (!dswsLogHostOk()) { dswsLogWarnCall('wf.logExport', 'log-resolve', 'host-unavailable'); return Promise.resolve({ ok: false, error: 'host-unavailable' }) }
  try {
    return host.call('wf.logExport', {}).then(function (res) {
      if (!res || res.ok !== true) { dswsLogWarnCall('wf.logExport', 'log-resolve', 'export-not-ok'); return { ok: false, error: 'export-not-ok' } }
      dswsLogRemember(res)
      try { log('info', 'host.call', { method: 'wf.logExport', latencyMs: Date.now() - t0, ok: !!(dswsLogKnown.dir && dswsLogKnown.path), kind: 'log-resolve' }) } catch (eL) {}
      if (!dswsLogKnown.dir || !dswsLogKnown.path) { dswsLogWarnCall('wf.logExport', 'log-resolve', 'path-missing'); return { ok: false, error: 'path-missing' } }
      return { ok: true, dir: dswsLogKnown.dir, path: dswsLogKnown.path }
    }).catch(function (e) { dswsLogWarnCall('wf.logExport', 'log-resolve', e); return { ok: false, error: (e && e.message) || String(e) } })
  } catch (e) {
    dswsLogFail('wf.logExport', 'log-resolve', (e && e.message) || e);
    return Promise.resolve({ ok: false, error: (e && e.message) || String(e) })
  }
}
// 悬浮菜单跟随锚点定位（#525：菜单水平居中于绿点，保留自底向上展开与右边缘兜底，视口不够时自动内收）。
const dswsLogPlaceMenu = function (anchorRef, setMenuPos) {
  try {
    const el = anchorRef.current; if (!el || typeof window === 'undefined') return; const r = el.getBoundingClientRect(); if (!r || (!r.width && !r.height)) return; const bottom = Math.max(0, Math.round(window.innerHeight - r.top)); const centerX = r.left + r.width / 2; let w = 0; try { const m = document.querySelector('[data-dsws-logmenu]'); if (m) w = m.offsetWidth || m.getBoundingClientRect().width || 0 } catch (eM) {} if (!w) w = 210; const half = w / 2; const margin = 12; const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0; let left = Math.round(centerX - half); if (left < margin) left = margin; if (vw && left + w > vw - margin) left = Math.max(margin, Math.round(vw - margin - w)); setMenuPos({ bottom: bottom, left: left }) // 先按实测宽居中，首开测不到宽时按最小宽估算，挂载后补测一次校准。
  } catch (e) {}
}
export const StatusLogDot = function (props) {
  const s = props && props.s
  const cx = React.useContext(DswsCtx)
  const hh = cx ? cx.h : React.createElement
  const store = s
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [menuPos, setMenuPos] = React.useState(null)
  const [busy, setBusy] = React.useState(null)
  const [clearConfirm, setClearConfirm] = React.useState(false)
  // #522 菜单行悬停高亮：鼠标放上去的行给背景（普通行沿用技能浮层菜单的悬停底，危险行沿用缺陷菜单的红底，不自创色板）。
  const [hoverKey, setHoverKey] = React.useState(null)
  const anchorRef = React.useRef(null)
  const closeRef = React.useRef(null)
  const hoverOpenRef = React.useRef(null) // 绿点悬停待开计时器（200 毫秒到即开菜单）。
  const menuRef = React.useRef(null)
  // switch state: single memory copy reconciled to host at startup; broadcast re-renders us.
  let debugOn = false
  try { debugOn = !!(typeof logSwitch !== 'undefined' && logSwitch && logSwitch.enabled === true) } catch (e) {}
  const clearHoverOpen = function () { try { if (hoverOpenRef.current) { clearTimeout(hoverOpenRef.current); hoverOpenRef.current = null } } catch (e) {} } // 取消悬停待开计时。
  const closeMenu = function () {
    clearHoverOpen()
    try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {}
    if (menuOpen) setMenuOpen(false)
  }
  const scheduleMenuClose = function () { clearHoverOpen() // 离区 300 毫秒后关，鼠标路过不误触。
    try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {}
    try { if (closeRef.current) clearTimeout(closeRef.current) } catch (e2) {}
    closeRef.current = setTimeout(function () { closeRef.current = null; setMenuOpen(false) }, 300)
  }
  const openMenu = function () { clearHoverOpen() // 开本菜单时收起技能菜单：只写技能浮层已有字段并走已有广播，不碰其内部实现。
    try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {}
    try { if (store && (store.skillsOpen || store.skillPopPos || store.skillHover)) { store.skillsOpen = false; store.skillHover = null; store.skillPopPos = null; if (typeof emit === 'function') emit(store) } } catch (e) {} // 技能提示字段已移除，不读写。
    dswsLogPlaceMenu(anchorRef, setMenuPos)
    setMenuOpen(true)
  }
  const scheduleMenuOpen = function () { if (menuOpen || clearConfirm) return // 绿点悬停 200 毫秒自开（单击开关保留，走 openMenu 统一互斥）。
    try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {}
    if (!hoverOpenRef.current) hoverOpenRef.current = setTimeout(function () { hoverOpenRef.current = null; openMenu() }, 200)
  }
  // 反向互斥：技能菜单打开时收起本菜单（只读技能浮层已有字段，不碰其内部实现）。
  React.useEffect(function () { if (menuOpen && store && store.skillsOpen) setMenuOpen(false) }, [menuOpen, store && store.skillsOpen])
  const toggleMenu = function () {
    if (menuOpen) closeMenu()
    else openMenu()
  }
  // Esc closes menu and confirm; outside click closes menu.
  React.useEffect(function () {
    if (!menuOpen && !clearConfirm) return undefined
    const onKey = function (e) {
      if (e && (e.key === 'Escape' || e.key === 'Esc')) {
        if (clearConfirm) setClearConfirm(false)
        else setMenuOpen(false)
      }
    }
    const onDown = function (e) {
      try {
        const t = e && e.target
        if (!t || typeof t.closest !== 'function') return
        if (t.closest('[data-dsws-logmenu]')) return
        if (t.closest('[data-dsws-logdot]')) return
      } catch (e2) { return }
      setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return function () {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menuOpen, clearConfirm])
  // keep menu anchored on scroll/resize while open.
  React.useEffect(function () {
    if (!menuOpen) return undefined
    let disposed = false
    const reposition = function () { if (disposed) return; dswsLogPlaceMenu(anchorRef, setMenuPos) }
    document.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
    try { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reposition); else setTimeout(reposition, 0) } catch (eR) {} // 挂载后按实测宽补测一次，把首开的估算位置校准到真正居中。
    return function () {
      disposed = true
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [menuOpen])
  const say = function (msg, kind) {
    try { if (store && typeof flash === 'function') flash(store, msg, kind) } catch (e) {}
  }
  const doExport = function () {
    if (busy) return
    if (!dswsLogHostOk()) { say(tr('logtoast.hostUnavailable'), 'warn'); return }
    setBusy('export')
    try {
      host.call('wf.logExport', {}).then(function (res) {
        setBusy(null)
        if (!res || res.ok !== true) {
          dswsLogWarnCall('wf.logExport', 'export', 'export-not-ok'); dswsLogMenuFail('export', 'export-not-ok', (res && res.error) || 'not-ok')
          say(tr('logtoast.exportFailed', { err: 'not-ok' }), 'warn')
          return
        }
        dswsLogRemember(res)
        const shown = dswsLogKnown.path || res.fileName || ''
        if (res.fallback === true) say(tr('logtoast.exportFallback', { path: shown }), 'ok')
        else say(tr('logtoast.exported', { path: shown }), 'ok')
        setMenuOpen(false)
      }).catch(function (e) {
        setBusy(null)
        dswsLogWarnCall('wf.logExport', 'export', e); dswsLogMenuFail('export', 'export-not-ok', e)
        say(tr('logtoast.exportFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
      })
    } catch (e) {
      setBusy(null)
      dswsLogWarnCall('wf.logExport', 'export', e); dswsLogMenuFail('export', 'export-not-ok', e)
      say(tr('logtoast.exportFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
    }
  }
  const doOpenDir = function () {
    if (busy) return
    if (!dswsLogHostOk()) { say(tr('logtoast.hostUnavailable'), 'warn'); return }
    setBusy('open')
    dswsLogEnsurePath().then(function (got) {
      if (!got.ok) {
        setBusy(null)
        dswsLogMenuFail('openDir', dswsLogResolveReason(got.error), got.error)
        say(tr('logtoast.openFailed', { err: String(got.error || 'unknown').slice(0, 120) }), 'warn')
        return
      }
      try {
        host.call('wf.openFolder', { cwd: got.dir }).then(function () {
          setBusy(null)
          setMenuOpen(false)
        }).catch(function (e) {
          setBusy(null)
          dswsLogWarnCall('wf.openFolder', 'open-path', e); dswsLogMenuFail('openDir', 'open-fail', e)
          say(tr('logtoast.openFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
        })
      } catch (e) {
        setBusy(null)
        dswsLogWarnCall('wf.openFolder', 'open-path', e); dswsLogMenuFail('openDir', 'open-fail', e)
        say(tr('logtoast.openFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
      }
    })
  }
  const doCopyPath = function () {
    if (busy) return
    if (!dswsLogHostOk()) { say(tr('logtoast.hostUnavailable'), 'warn'); return }
    setBusy('copy')
    dswsLogEnsurePath().then(function (got) {
      setBusy(null)
      if (!got.ok) {
        dswsLogMenuFail('copyPath', dswsLogResolveReason(got.error), got.error); say(tr('logtoast.openFailed', { err: String(got.error || 'unknown').slice(0, 120) }), 'warn')
        return
      }
      try {
        if (typeof copyText === 'function') copyText(store, got.path, tr('logtoast.pathCopied', { path: got.path }))
      } catch (e) {
        dswsLogMenuFail('copyPath', 'copy-fail', e)
        say(tr('logtoast.openFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
        return
      }
      setMenuOpen(false)
    })
  }
  const doClear = function () {
    if (busy) return
    setMenuOpen(false)
    setClearConfirm(true)
  }
  const doConfirmClear = function () {
    if (busy) return
    if (!dswsLogHostOk()) { say(tr('logtoast.hostUnavailable'), 'warn'); setClearConfirm(false); return }
    setBusy('clear')
    try {
      host.call('wf.logClear', { date: dswsLogToday() }).then(function (res) {
        setBusy(null)
        setClearConfirm(false)
        if (!res || res.ok !== true) {
          dswsLogWarnCall('wf.logClear', 'clear', 'clear-not-ok'); say(tr('logtoast.clearFailed', { err: 'not-ok' }), 'warn')
          return
        }
        const n = (typeof res.removed === 'number') ? res.removed : 0
        if (n > 0) say(tr('logtoast.cleared', { n: String(n) }), 'ok')
        else say(tr('logtoast.clearEmpty'), 'info')
      }).catch(function (e) {
        setBusy(null)
        setClearConfirm(false)
        dswsLogWarnCall('wf.logClear', 'clear', e); say(tr('logtoast.clearFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
      })
    } catch (e) {
      setBusy(null)
      setClearConfirm(false)
      dswsLogWarnCall('wf.logClear', 'clear', e); say(tr('logtoast.clearFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
    }
  }
  const dotColor = debugOn ? '#4ade80' : '#6b6b75'
  const dotTitle = debugOn ? tr('logmenu.titleOn') : tr('logmenu.title')
  const dot = hh('span', {
    'data-dsws-logdot': '1',
    key: 'dsws-logdot',
    ref: anchorRef,
    tabIndex: 0,
    role: 'button',
    title: dotTitle,
    'aria-label': dotTitle,
    onClick: function (e) { try { e.stopPropagation() } catch (e2) {}; toggleMenu() },
    onKeyDown: function (e) {
      if (!e) return
      if (e.key === 'Enter' || e.key === ' ') { try { e.preventDefault(); e.stopPropagation() } catch (e2) {}; toggleMenu() }
      if (e.key === 'Escape' || e.key === 'Esc') closeMenu()
    },
    onMouseEnter: function () { scheduleMenuOpen() },
    onMouseLeave: function () { scheduleMenuClose() },
    style: {
      width: 10, height: 10, borderRadius: 99, background: dotColor, flex: 'none', cursor: 'pointer',
      boxShadow: debugOn ? '0 0 6px rgba(74,222,128,.6)' : 'none', outline: 'none', display: 'inline-block', verticalAlign: 'middle',
    },
  })
  const itemStyle = function (key, danger) {
    const hovered = hoverKey === key && !busy
    return {
      display: 'flex', width: '100%', textAlign: 'left', border: 'none',
      background: hovered ? (danger ? 'rgba(248,113,113,.15)' : 'var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))') : 'none',
      color: danger ? '#fca5a5' : 'var(--dsw-alias-label-primary,#e6edf3)',
      fontSize: 13, padding: '8px 10px', borderRadius: 7, cursor: busy ? 'default' : 'pointer', alignItems: 'center', gap: 8, opacity: busy ? 0.55 : 1, whiteSpace: 'nowrap', // 行内不换行，菜单宽度贴合最长行。
    }
  }
  const menuItem = function (key, icon, label, fn, danger) {
    const busyLabel = busy === 'export' ? tr('logmenu.exporting') : (busy === 'clear' ? tr('logmenu.clearing') : null)
    const showBusy = !!busy && ((key === 'export' && busy === 'export') || (key === 'clear' && busy === 'clear'))
    return hh('button', { key: key, role: 'menuitem', disabled: !!busy, onClick: function (e) { try { e.stopPropagation() } catch (e2) {}; fn() }, onMouseEnter: function () { setHoverKey(key) }, onMouseLeave: function () { setHoverKey(null) }, style: itemStyle(key, danger) }, [
      (typeof Ic === 'function') ? Ic({ n: icon, size: 13, color: danger ? '#fca5a5' : undefined }) : null,
      hh('span', null, showBusy ? (busyLabel + '…') : label),
    ])
  }
  const menu = menuOpen ? PortalOverlay({
    'data-dsws-logmenu': '1',
    key: 'dsws-logmenu',
    onClick: function (e) { try { e.stopPropagation() } catch (e2) {} },
    onMouseEnter: function () { clearHoverOpen(); try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {} },
    onMouseLeave: function () { scheduleMenuClose() },
    style: Object.assign({ position: 'fixed', bottom: menuPos ? menuPos.bottom : 40, width: 'max-content', maxWidth: 'calc(100vw - 24px)', padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.45)' }, (menuPos && typeof menuPos.left === 'number') ? { left: menuPos.left } : { right: 12 }), // 水平居中于绿点（测不到锚点时沿用右边缘兜底），视口不够时定位函数已自动内收，宽度贴合最长行加内边距。
  }, [
    hh('div', { role: 'menu', 'aria-label': dotTitle }, [
      menuItem('export', 'note', tr('logmenu.export'), doExport, false),
      menuItem('open', 'external-link', tr('logmenu.openDir'), doOpenDir, false),
      menuItem('copy', 'clipboard', tr('logmenu.copyPath'), doCopyPath, false),
      hh('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '4px 6px' } }),
      menuItem('clear', 'alert', tr('logmenu.clear'), doClear, true),
    ]),
  ]) : null
  const confirmModal = clearConfirm ? PortalOverlay({
    'data-dsws-logmenu': '1',
    key: 'dsws-logconfirm',
    onClick: function (e) { try { if (e.target === e.currentTarget) setClearConfirm(false) } catch (e2) {} },
    style: { position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', padding: 20 },
  }, [
    hh('div', {
      role: 'dialog', 'aria-label': tr('logmenu.clearTitle'),
      style: {
        background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 12,
        padding: 18, width: '100%', maxWidth: 420, boxShadow: '0 8px 30px rgba(0,0,0,.45)',
      },
    }, [
      hh('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, tr('logmenu.clearTitle')),
      hh('div', { style: { fontSize: 13, color: '#9a9aa5', marginBottom: 14 } }, tr('logmenu.clearDesc')),
      hh('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, [
        hh('button', { className: 'dsws-btn ghost', disabled: busy === 'clear', onClick: function () { if (busy === 'clear') return; setClearConfirm(false) }, style: { fontSize: 12 } }, tr('logmenu.cancel')),
        hh('button', {
          className: 'dsws-btn', disabled: busy === 'clear',
          onClick: function (e) { try { e.stopPropagation() } catch (e2) {}; doConfirmClear() },
          style: {
            fontSize: 12, fontWeight: 700, background: '#5c2b2b', borderColor: '#5c2b2b', color: '#fca5a5',
            opacity: busy === 'clear' ? 0.55 : 1, cursor: busy === 'clear' ? 'default' : 'pointer',
          },
        }, busy === 'clear' ? (tr('logmenu.clearing') + '…') : tr('logmenu.confirmClear')),
      ]),
    ]),
  ]) : null
  return hh('span', {
    style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
    onClick: function (e) { try { e.stopPropagation() } catch (e2) {} },
  }, [dot, menu, confirmModal])
}
