/**
 * statusbar/StatusLogMenu.js — 状态栏常驻诊断日志入口（#492 状态栏线）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 范围：常驻小灰点（关灰开绿）＋点击四键菜单（导出今日日志／打开日志目录／
 * 复制日志路径／清空今日日志）＋清空确认框＋成功与失败反馈。
 * 接线：导出调 wf.logExport，清空调 wf.logClear，跳转目录复用 wf.openPath，
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
const dswsLogRemember = function (res) {
  try {
    if (res && typeof res.dir === 'string' && res.dir) dswsLogKnown.dir = res.dir
    if (res && typeof res.path === 'string' && res.path) dswsLogKnown.path = res.path
    else if (res && typeof res.fileName === 'string' && res.fileName && dswsLogKnown.dir) {
      const sep = dswsLogKnown.dir.slice(-1) === '/' ? '' : '/'
      dswsLogKnown.path = dswsLogKnown.dir + sep + res.fileName
    }
  } catch (e) {}
}
// resolve known dir/path: use cache, else read-only export call to resolve (no toast here).
const dswsLogEnsurePath = function () {
  if (dswsLogKnown.dir && dswsLogKnown.path) return Promise.resolve({ ok: true, dir: dswsLogKnown.dir, path: dswsLogKnown.path })
  if (!dswsLogHostOk()) return Promise.resolve({ ok: false, error: 'host-unavailable' })
  try {
    return host.call('wf.logExport', {}).then(function (res) {
      if (!res || res.ok !== true) return { ok: false, error: 'export-not-ok' }
      dswsLogRemember(res)
      if (!dswsLogKnown.dir || !dswsLogKnown.path) return { ok: false, error: 'path-missing' }
      return { ok: true, dir: dswsLogKnown.dir, path: dswsLogKnown.path }
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || String(e) }
    })
  } catch (e) {
    return Promise.resolve({ ok: false, error: (e && e.message) || String(e) })
  }
}
export const StatusLogDot = function (props) {
  const s = props && props.s
  const cx = React.useContext(DswsCtx)
  const hh = cx ? cx.h : React.createElement
  const store = s
  const openState = React.useState(false)
  const menuOpen = openState[0]
  const setMenuOpen = openState[1]
  const posState = React.useState(null)
  const menuPos = posState[0]
  const setMenuPos = posState[1]
  const busyState = React.useState(null)
  const busy = busyState[0]
  const setBusy = busyState[1]
  const confirmState = React.useState(false)
  const clearConfirm = confirmState[0]
  const setClearConfirm = confirmState[1]
  const anchorRef = React.useRef(null)
  const closeRef = React.useRef(null)
  const menuRef = React.useRef(null)
  // switch state: single memory copy reconciled to host at startup; broadcast re-renders us.
  let debugOn = false
  try { debugOn = !!(typeof logSwitch !== 'undefined' && logSwitch && logSwitch.enabled === true) } catch (e) {}
  const closeMenu = function () {
    try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {}
    if (menuOpen) setMenuOpen(false)
  }
  const scheduleMenuClose = function () {
    try {
      if (typeof scheduleStatusClose === 'function' && typeof closeStatusBugMenu === 'function') {
        scheduleStatusClose(closeRef, function () { setMenuOpen(false) })
        return
      }
    } catch (e) {}
    try { if (closeRef.current) clearTimeout(closeRef.current) } catch (e2) {}
    closeRef.current = setTimeout(function () { closeRef.current = null; setMenuOpen(false) }, 160)
  }
  const openMenu = function () {
    try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {}
    try {
      if (typeof placeStatusOverlay === 'function' && anchorRef.current) {
        const p = placeStatusOverlay(anchorRef.current, 'right')
        if (p) setMenuPos(p)
      }
    } catch (e) {}
    setMenuOpen(true)
  }
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
    const reposition = function () {
      if (disposed) return
      try {
        if (typeof placeStatusOverlay === 'function' && anchorRef.current) {
          const p = placeStatusOverlay(anchorRef.current, 'right')
          if (p) setMenuPos(p)
        }
      } catch (e) {}
    }
    document.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
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
        say(tr('logtoast.exportFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
      })
    } catch (e) {
      setBusy(null)
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
        say(tr('logtoast.openFailed', { err: String(got.error || 'unknown').slice(0, 120) }), 'warn')
        return
      }
      try {
        host.call('wf.openPath', { path: got.dir }).then(function () {
          setBusy(null)
          setMenuOpen(false)
        }).catch(function (e) {
          setBusy(null)
          say(tr('logtoast.openFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
        })
      } catch (e) {
        setBusy(null)
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
        say(tr('logtoast.openFailed', { err: String(got.error || 'unknown').slice(0, 120) }), 'warn')
        return
      }
      try {
        if (typeof copyText === 'function') copyText(store, got.path, tr('logtoast.pathCopied', { path: got.path }))
      } catch (e) {
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
          say(tr('logtoast.clearFailed', { err: 'not-ok' }), 'warn')
          return
        }
        const n = (typeof res.removed === 'number') ? res.removed : 0
        if (n > 0) say(tr('logtoast.cleared', { n: String(n) }), 'ok')
        else say(tr('logtoast.clearEmpty'), 'info')
      }).catch(function (e) {
        setBusy(null)
        setClearConfirm(false)
        say(tr('logtoast.clearFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
      })
    } catch (e) {
      setBusy(null)
      setClearConfirm(false)
      say(tr('logtoast.clearFailed', { err: String((e && e.message) || e).slice(0, 120) }), 'warn')
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
    onMouseEnter: function () { try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {} },
    style: {
      width: 10, height: 10, borderRadius: 99, background: dotColor, flex: 'none', cursor: 'pointer',
      boxShadow: debugOn ? '0 0 6px rgba(74,222,128,.6)' : 'none',
      outline: 'none', display: 'inline-block', verticalAlign: 'middle',
    },
  })
  const itemStyle = function (danger) {
    return {
      display: 'flex', width: '100%', textAlign: 'left', background: 'none', border: 'none',
      color: danger ? '#fca5a5' : 'var(--dsw-alias-label-primary,#e6edf3)',
      fontSize: 13, padding: '8px 10px', borderRadius: 7, cursor: busy ? 'default' : 'pointer',
      alignItems: 'center', gap: 8, opacity: busy ? 0.55 : 1,
    }
  }
  const menuItem = function (key, icon, label, fn, danger) {
    const busyLabel = busy === 'export' ? tr('logmenu.exporting') : (busy === 'clear' ? tr('logmenu.clearing') : null)
    const showBusy = !!busy && ((key === 'export' && busy === 'export') || (key === 'clear' && busy === 'clear'))
    return hh('button', {
      key: key, role: 'menuitem', disabled: !!busy, onClick: function (e) { try { e.stopPropagation() } catch (e2) {}; fn() }, style: itemStyle(danger),
    }, [
      (typeof Ic === 'function') ? Ic({ n: icon, size: 13, color: danger ? '#fca5a5' : undefined }) : null,
      hh('span', null, showBusy ? (busyLabel + '…') : label),
    ])
  }
  const menu = menuOpen ? PortalOverlay({
    'data-dsws-logmenu': '1',
    key: 'dsws-logmenu',
    onClick: function (e) { try { e.stopPropagation() } catch (e2) {} },
    onMouseEnter: function () { try { if (typeof clearStatusClose === 'function') clearStatusClose(closeRef) } catch (e) {} },
    onMouseLeave: function () { scheduleMenuClose() },
    style: {
      position: 'fixed',
      right: menuPos ? menuPos.right : 12,
      bottom: menuPos ? menuPos.bottom : 40,
      minWidth: 210, padding: 4, zIndex: 2147483000,
      background: 'var(--dsw-alias-bg-layer-2,#16181d)',
      border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 10,
      boxShadow: '0 8px 30px rgba(0,0,0,.45)',
    },
  }, [
    hh('div', { role: 'menu', 'aria-label': dotTitle }, [
      menuItem('export', 'note', tr('logmenu.export'), doExport, false),
      menuItem('open', 'external-link', tr('logmenu.openDir'), doOpenDir, false),
      menuItem('copy', 'clipboard', tr('logmenu.copyPath'), doCopyPath, false),
      hh('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '4px 6px' } }),
      menuItem('clear', 'alert', tr('logmenu.clear'), doClear, true),
      hh('div', { style: { fontSize: 11, color: '#8b8b95', padding: '6px 10px 4px', lineHeight: 1.5 } }, tr('logmenu.note')),
    ]),
  ]) : null
  const confirmModal = clearConfirm ? PortalOverlay({
    'data-dsws-logmenu': '1',
    key: 'dsws-logconfirm',
    onClick: function (e) { try { if (e.target === e.currentTarget) setClearConfirm(false) } catch (e2) {} },
    style: {
      position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', padding: 20,
    },
  }, [
    hh('div', {
      role: 'dialog', 'aria-label': tr('logmenu.clearTitle'),
      style: {
        background: 'var(--dsw-alias-bg-layer-2,#16181d)',
        border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 12,
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
