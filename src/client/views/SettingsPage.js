/**
 * views/SettingsPage.js — 配置页（TPL 表 + 设置，5.9）真源 ESM，build 拼回 src/client/index.js leaf
 */
// 增-2（#520）：底部作者其他插件清单（4 个，2026-09-06 已验真；写死网址，不拉取不新增网络请求）
const MORE_PLUGINS = [
  { slug: 'dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', descKey: 'more.desc.deck' },
  { slug: 'dsh-opencode-palette', url: 'https://github.com/FeatherHunter/dsh-opencode-palette', descKey: 'more.desc.palette' },
  { slug: 'dsh-prompt', url: 'https://github.com/FeatherHunter/dsh-prompt', descKey: 'more.desc.prompt' },
  { slug: 'dsh-im-companion', url: 'https://github.com/FeatherHunter/dsh-im-companion', descKey: 'more.desc.companion' },
]
export     const SettingsPage = (props) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
      const sharedSt = cx ? cx.storeSvc.useStore(props && props.sessionId) : useStore(props && props.sessionId)
      // T2 悬停提示迁移：设置提示框的定位、翻转、挂顶显示已统一交给 HoverTip（mode='mouse'）负责，显示悬停提示、移动悬停提示、隐藏悬停提示三个旧函数（showCfgTip/moveCfgTip/hideCfgTip）已经下线，移除了全局显示时序，翻转阈值与样式走统一配置表，页面行为没有变化
      const [openIn, setOpenIn] = React.useState(cfg.openIn || 'dock')
      const [openInNote, setOpenInNote] = React.useState(false)
      const [foldVer, setFoldVer] = React.useState(0)
      // #492调试分组：开关秒显宿主值，经 wf.logSetSwitch 写宿主，底座广播刷新；四键走宿主电话
      const [dbgPending, setDbgPending] = React.useState(false)
      const [dbgBusy, setDbgBusy] = React.useState(null)
      const [clearAsked, setClearAsked] = React.useState(false)
      const [lastExport, setLastExport] = React.useState(null)
      const dbgChecked = (function () {
        try { if (typeof logSwitch !== 'undefined' && logSwitch) return logSwitch.enabled === true } catch (eDbg) {}
        try { return !!readLocalDebugSwitch().enabled } catch (eDbg2) { return false }
      })()
      const hostReady = function () { try { return !!(typeof host !== 'undefined' && host && host.call) } catch (eDbg) { return false } }
      const todayName = function () { try { const d = new Date(); const p = function (n) { return String(n).padStart(2, '0') }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) } catch (eDbg) { return '' } }
      const dirOfExport = function (res) { try { const d = res && res.summary && res.summary.header && res.summary.header.dir ? String(res.summary.header.dir) : ''; return d ? (d.replace(/\/+$/, '') + '/logs') : '' } catch (eDbg) { return '' } }
      const rememberExport = function (res) { try { setLastExport({ dir: dirOfExport(res), fileName: res.fileName || '', fallback: res.fallback === true }) } catch (eDbg) {} }
      const guardOp = function () {
        if (dbgBusy) return false
        if (!hostReady()) { flash(sharedSt, tr('err.hostUnavailable'), 'warn'); return false }
        return true
      }
      const toggleDbg = function (e) {
        if (dbgPending || !guardOp()) return
        const next = !!(e && e.target && e.target.checked)
        setDbgPending(true)
        try {
          if (typeof setLogSwitch !== 'function') throw new Error('no-switch')
          setLogSwitch(next, 1).then(function (res) {
            setDbgPending(false)
            const okSw = !!(res && res.ok)
            flash(sharedSt, tr(!okSw ? 'cfg.dbgSwitchFail' : ((res.enabled === true) ? 'cfg.dbgSwitchOnToast' : 'cfg.dbgSwitchOffToast')), okSw ? 'ok' : 'warn')
          }).catch(function () { setDbgPending(false); flash(sharedSt, tr('cfg.dbgSwitchFail'), 'warn') })
        } catch (errDbg) { setDbgPending(false); flash(sharedSt, tr('cfg.dbgSwitchFail'), 'warn') }
      }
      // 静默取导出结果解析目录位置并缓存，不刷提示，供打开与复制复用
      const resolveLogDir = function () {
        if (lastExport && lastExport.dir) { try { log('info', 'host.call', { method: 'wf.logExport', latencyMs: 0, ok: true, kind: 'log-resolve-cache' }) } catch (eL) {} return Promise.resolve(lastExport.dir) }
        const t0 = Date.now()
        if (!hostReady()) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc('host-unavailable', 120, 'error')) }) } catch (eL) {}; return Promise.resolve('') }
        try {
          return host.call('wf.logExport', { format: 'zip' }).then(function (res) {
            if (!res || res.ok !== true) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc('export-not-ok', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('resolve', 'export-not-ok', (res && res.error) || 'not-ok') } catch (eDbg2) {} return '' }
            rememberExport(res)
            const _dir = dirOfExport(res)
            try { log('info', 'host.call', { method: 'wf.logExport', latencyMs: Date.now() - t0, ok: !!_dir, kind: 'log-resolve' }) } catch (eL) {}
            if (!_dir) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc('path-missing', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('resolve', 'path-missing', 'path-missing') } catch (eDbg2) {} }
            return _dir
          }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('resolve', 'export-not-ok', e) } catch (eDbg2) {}; return '' })
        } catch (eDbg) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc(String((eDbg && eDbg.message) || eDbg), 120, 'error')) }) } catch (eL) {}; return Promise.resolve('') }
      }
      const doExport = function () {
        if (!guardOp()) return
        setDbgBusy('export')
        try {
          host.call('wf.logExport', { format: 'zip' }).then(function (res) {
            setDbgBusy(null)
            if (!res || res.ok !== true) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: dswsLogHash(dswsLogTrunc('export-not-ok', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('export', 'export-not-ok', (res && res.error) || 'not-ok') } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn'); return }
            rememberExport(res)
            let msg = tr('cfg.dbgExportOk', { file: String(res.fileName || '') })
            if (res.fallback === true) msg = msg + ' ' + tr('cfg.dbgExportFallback')
            flash(sharedSt, msg, 'ok')
          }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('export', 'export-not-ok', e) } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn') })
        } catch (eDbg) { setDbgBusy(null); flash(sharedSt, tr('cfg.dbgExportFail'), 'warn') }
      }
      const doOpen = function () {
        if (!guardOp()) return
        setDbgBusy('open')
        resolveLogDir().then(function (dir) {
          if (!dir) { setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('openDir', 'path-missing', 'path-missing') } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn'); return }
          try {
            host.call('wf.openFolder', { cwd: dir }).then(function (res) {
              setDbgBusy(null)
              const okOpen = !!(res && res.ok === true)
              if (!okOpen) { try { log('warn', 'host.call.fail', { method: 'wf.openFolder', kind: 'open-path', errorHash: dswsLogHash(dswsLogTrunc('open-not-ok', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('openDir', 'open-fail', (res && res.error) || 'not-ok') } catch (eDbg2) {} }; flash(sharedSt, tr(okOpen ? 'cfg.dbgOpenedDir' : 'cfg.dbgOpenDirFail'), okOpen ? 'ok' : 'warn')
            }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.openFolder', kind: 'open-path', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('openDir', 'open-fail', e) } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgOpenDirFail'), 'warn') })
          } catch (eDbg) { setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('openDir', 'open-fail', eDbg) } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgOpenDirFail'), 'warn') }
        })
      }
      const doCopy = function () {
        if (!guardOp()) return
        setDbgBusy('copy')
        resolveLogDir().then(function (dir) {
          setDbgBusy(null)
          if (!dir) { try { if (typeof logExportFail === 'function') logExportFail('copyPath', 'path-missing', 'path-missing') } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn'); return }
          try { copyText(sharedSt, dir, tr('cfg.dbgCopied')) } catch (eDbg) { try { if (typeof logExportFail === 'function') logExportFail('copyPath', 'copy-fail', eDbg) } catch (eDbg2) {} flash(sharedSt, tr('toast.copyFailed'), 'warn') }
        })
      }
      const doClearAsk = function () { if (!dbgBusy) setClearAsked(true) }
      const doClearCancel = function () { setClearAsked(false) }
      const doClearConfirm = function () {
        if (dbgBusy) return
        if (!hostReady()) { setClearAsked(false); flash(sharedSt, tr('err.hostUnavailable'), 'warn'); return }
        const name = todayName()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) { setClearAsked(false); flash(sharedSt, tr('cfg.dbgClearFail'), 'warn'); return }
        setDbgBusy('clear')
        try {
          host.call('wf.logClear', { date: name }).then(function (res) {
            setDbgBusy(null); setClearAsked(false)
            if (!res || res.ok !== true) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: dswsLogHash(dswsLogTrunc('clear-not-ok', 120, 'error')) }) } catch (eL) {}; flash(sharedSt, tr('cfg.dbgClearFail'), 'warn'); return }
            flash(sharedSt, tr((res.removed || 0) > 0 ? 'cfg.dbgClearOk' : 'cfg.dbgClearEmpty'), 'ok')
          }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; setDbgBusy(null); setClearAsked(false); flash(sharedSt, tr('cfg.dbgClearFail'), 'warn') })
        } catch (eDbg) { setDbgBusy(null); setClearAsked(false); flash(sharedSt, tr('cfg.dbgClearFail'), 'warn') }
      }
      // v1.4.1：打开位置即时生效 —— seg 点击即写入 cfg + localStorage + 广播（无需滚到底部点保存全部）
      const pickOpenIn = function (v) {
        setOpenIn(v)
        cfg.openIn = v
        saveCfg()
        broadcastCfg()
        try { log('info', 'settings.save', { openIn: String(v || ''), tplChangedCount: 0 }) } catch (eL) {}
        setOpenInNote(true)
        if (timer !== undefined) timer.timeout(function () { setOpenInNote(false) }, 2600)
      }
      // #155 Q1 改：只读全局总览（wf.bindings + workspaces.list + wf.registry 色值，不可改；不调 wf.bind）
      // 数据装载与跳转收进 views/SettingsWorkspaces.js 的 useWsOverview（纯结构搬移，行为零变化）
      const overview = useWsOverview(cx, sharedSt)
      // T5 修订：设置页内 toast（独立于面板 dock 的 notice 渲染）
      const cfgNotice = sharedSt.notice
      return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
        cfgNotice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
          Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
          h('span', null, cfgNotice.text),
        ]) : null,
        // 增-1（#520）改-2（#521）：标题同一行右侧两个表情按钮（星星只留 🌟、反馈只留 💬，一家一颗常显；悬停介绍、跳转网址、键盘聚焦不动；窄窗口换行到标题下方；状态小字旁显示构建注入的版本号去 v 前缀数字，点跳仓库首页）
        h('div', { className: 'dsws-cfg-head', style: { flexWrap: 'wrap' } }, [
          Icon({ scheme: 'compass', size: 20 }),
          h('span', { className: 't' }, tr('panel.title')),
          h('span', { className: 's', style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
            Ic({ n: 'dot', size: 12 }),
            h('span', null, tr('cfg.status')),
            h('a', { href: DSW_REPO_URL, target: '_blank', rel: 'noreferrer', style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', textDecoration: 'none' } }, (typeof DSW_VERSION === 'string' ? DSW_VERSION.replace(/^v/, '') : '')),
          ]),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            h(HoverTip, { key: 'star', content: tr('cfg.starTip'), mode: 'mouse', maxWidth: 220 },
              h('a', { href: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', target: '_blank', rel: 'noreferrer', style: { display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, color: 'inherit', textDecoration: 'none' } }, [h('span', { 'aria-hidden': 'true', style: { fontSize: 14, lineHeight: 1 } }, '🌟')])),
            h(HoverTip, { key: 'feedback', content: tr('cfg.feedbackTip'), mode: 'mouse', maxWidth: 220 },
              h('a', { href: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/new', target: '_blank', rel: 'noreferrer', style: { display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, color: 'inherit', textDecoration: 'none' } }, [h('span', { 'aria-hidden': 'true', style: { fontSize: 14, lineHeight: 1 } }, '💬')])),
          ]),
        ]),
        h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
        // v1.4：打开位置（details 列 / better-sidebar）—— better-sidebar 未装时仅显示 dock 选项
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'map', size: 13 }), h('span', null, tr('cfg.openIn'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.openInDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('span', { className: 'dsws-cfg-label' }, tr('cfg.openInLabel')),
            h('div', { className: 'dsws-cfg-seg' }, [
              h('button', { key: 'dock', className: openIn === 'dock' ? 'on' : '', onClick: function () { pickOpenIn('dock') } }, tr('cfg.openInDock')),
              (function () { try { return !!ctx.get('betterSidebar') } catch (e) { return false } })()
                ? h('button', { key: 'sidebar', className: openIn === 'sidebar' ? 'on' : '', onClick: function () { pickOpenIn('sidebar') } }, tr('cfg.openInSidebar'))
                : null,
            ]),
            // 收-1（#521）：常驻小字，长期可见的确定性答案（原 2.6 秒闪现保留，不依赖它传达）
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('cfg.openInSavedHint')),
            openInNote ? h('div', { style: { fontSize: 11, color: '#4ade80', marginTop: 6 } }, tr('cfg.openInHint')) : null,
          ]),
        ]),
        // #155 Q1 改：只读全局总览（wf.bindings + workspaces.list + wf.registry 色值，不可改；不调 wf.bind）
        // 分组渲染收进 views/SettingsWorkspaces.js 的 renderWsOverview（纯结构搬移，行为零变化）
        renderWsOverview(h, sharedSt, overview.wsOverview, overview.loadRef, foldVer, setFoldVer),

        // #492 沉底调试分组（布局文案沿 #334 原型：主开关默认关，写经 wf.logSetSwitch，对账以宿主为准，保存即广播；四键调宿主三电话加复用目录电话）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'gear', size: 13 }), h('span', null, tr('cfg.dbgTitle'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.dbgDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('label', { className: 'dsws-cfg-sw' }, [
              h('input', { type: 'checkbox', checked: dbgChecked, disabled: !!(dbgPending || dbgBusy), onChange: toggleDbg }),
              h('span', { className: 'tr' }), h('span', null, tr(dbgChecked ? 'cfg.dbgSwitchOn' : 'cfg.dbgSwitchOff')),
            ]),
          ]),
          h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6, marginTop: 8 } }, [
            h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doExport }, tr('cfg.dbgExport')),
            h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doOpen }, tr('cfg.dbgOpen')),
            h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doCopy }, tr('cfg.dbgCopy')),
            h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doClearAsk }, tr('cfg.dbgClear')),
          ]),
          h('div', { className: 'dsws-cfg-gdesc', style: { marginTop: 6 } }, tr('cfg.dbgPackageHint')),
          clearAsked ? h('div', { className: 'dsws-cfg-err', style: { marginTop: 8 } }, [
            h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.dbgClearTitle'))]),
            h('div', null, tr('cfg.dbgClearDesc')),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } }, [
              h('button', { className: 'dsws-cfg-btn', onClick: doClearCancel }, tr('switch.cancel')),
              h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doClearConfirm }, tr('cfg.dbgConfirmClear')),
            ]),
          ]) : null,
        ]),
        // 增-2（#520）：底部作者其他插件独立区域（默认展开，每行点开跳对应仓库首页；不新增本地存档键）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'skills', size: 13 }), h('span', null, tr('more.title'))]),
        ].concat(MORE_PLUGINS.map(function (p) {
          return h('a', { key: p.slug, href: p.url, target: '_blank', rel: 'noreferrer', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', textDecoration: 'none', color: 'inherit' } }, [
            h('span', { style: { fontFamily: 'Consolas,Menlo,monospace', fontSize: 12, fontWeight: 650, flex: 'none' } }, p.slug),
            h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr(p.descKey)),
            Ic({ n: 'external-link', size: 12 }),
          ])
        }))),
        // T2 HoverTip 迁移：移除 sharedSt.cfgTip 全局 portal，改由 HoverTip 统一（行为零变化，翻转/样式走契约）
        null,
      ])
    }