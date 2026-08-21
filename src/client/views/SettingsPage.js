/**
 * views/SettingsPage.js — 配置页（TPL 表 + 设置，5.9）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
    // ---- 5.9 配置页（v25 · settings.plugins.tab「Waystation」：功能配置 + 动作模板编辑器）----
    // 开始模板（前缀开关 + execute 模板）/ 动作模板编辑器（其余 6 动作）
    // T3：模板名/描述在渲染时 tr('tpl.name.*')/tr('tpl.desc.*')（此处保留中文静态表供默认文案参考）
export     const TPL_NAMES = {
      diagnose: '诊断', fix: '修复', discuss: '讨论', handoff1: '交接第一击', handoff2: '交接第二击', fixate: '沉淀',
    }
export     const TPL_DESC = {
      diagnose: 'needs-triage 票的行级动作',
      fix: 'bug 票的行级动作',
      discuss: 'wayfinder:grilling 票的行级动作',
      handoff1: '生成交接文档（含时间戳，两击文件名一致）',
      handoff2: '读取交接文档',
      fixate: '零丢失快照 prompt',
    }
export     const TPL_EDIT_IDS = ['diagnose', 'fix', 'discuss', 'handoff1', 'handoff2', 'fixate']  // execute 在「开始模板」节
export     const PREVIEW_VALUES = { url: 'https://github.com/FeatherHunter/SKILLS/issues/365', number: '365', title: tr('cfg.previewTitle'), ts: '20260814-172113', file: '20260814-172113.md' }
export     const SettingsPage = (props) => {
      const cx = React.useContext(DswsCtx)
      if (!cx) return null
      const h = cx.h
      // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
      const sharedSt = cx.storeSvc.useStore(props && props.sessionId)
      const [openIn, setOpenIn] = React.useState(cfg.openIn || 'dock')
      const [openInNote, setOpenInNote] = React.useState(false)
      const [wf, setWf] = React.useState(cfg.withWayfinder)
      const [tpls, setTpls] = React.useState(function () {
        const o = {}
        o.execute = templates.execute || ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = templates[id] || '' })
        return o
      })
      const [saved, setSaved] = React.useState(false)
      const [errs, setErrs] = React.useState([])
      const [resetNote, setResetNote] = React.useState(null)
      const taRefs = React.useRef({})
      // v1.4.1：打开位置即时生效 —— seg 点击即写入 cfg + localStorage + 广播（无需滚到底部点保存全部）
      const pickOpenIn = function (v) {
        setOpenIn(v)
        cfg.openIn = v
        saveCfg()
        broadcastCfg()
        setOpenInNote(true)
        if (timer !== undefined) timer.timeout(function () { setOpenInNote(false) }, 2600)
      }
      // v1.3.3 T1：模板 textarea 自适应高度（内容全展开 · 无内层滚动 · 最外层滑动）
      const autoGrowTa = function (el) {
        if (!el) return
        el.style.height = 'auto'
        el.style.height = (el.scrollHeight + 2) + 'px'
      }
      // 校验全部 7 个模板（生效文本 = 自定义 || 默认）
      const validateAll = function (executeText) {
        const errList = []
        const check = function (id, text) {
          const v = validateTemplate(id, text || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''))
          if (!v.ok) {
            const bits = []
            if (v.missing.length) bits.push(tr('tpl.missing', { list: v.missing.map(function (n) { return '{' + n + '}' }).join('、') }))
            if (v.unknown.length) bits.push(tr('tpl.unknown', { list: v.unknown.map(function (n) { return '{' + n + '}' }).join('、') }))
            errList.push('「' + tr('tpl.name.' + id) + '」' + bits.join('；'))
          }
        }
        check('execute', executeText)
        TPL_EDIT_IDS.forEach(function (id) { check(id, tpls[id]) })
        return errList
      }
      const save = function () {
        const errList = validateAll(custom)
        if (errList.length) { setErrs(errList); return }
        setErrs([])
        cfg.openIn = openIn
        cfg.withWayfinder = wf
        templates.execute = custom
        TPL_EDIT_IDS.forEach(function (id) { templates[id] = tpls[id] })
        saveCfg(); saveTemplates(); broadcastCfg()
        setSaved(true)
        if (timer !== undefined) timer.timeout(function () { setSaved(false) }, 2000)
      }
      const setTpl = function (id, val) { setTpls(function (p) { const o = Object.assign({}, p); o[id] = val; return o }) }
      const resetExecute = function () { setTpl('execute', ''); setErrs([]) }
      const resetTpl = function (id) { setTpl(id, ''); setErrs([]) }
      // 页面级恢复全部默认（T1 规格 §5：清空 = 注入时走内置默认文本）
      const resetAll = function () {
        const o = {}
        o.execute = ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = '' })
        setTpls(o)
        setWf(true)
        setErrs([])
      }
      // 点击占位符 chip 在光标处插入
      const insertPh = function (id, name) {
        const ta = taRefs.current[id]
        const cur = tpls[id] || ''
        if (!ta) { setTpl(id, cur + '{' + name + '}'); return }
        const start = (ta.selectionStart != null) ? ta.selectionStart : cur.length
        const end = (ta.selectionEnd != null) ? ta.selectionEnd : cur.length
        const next = cur.slice(0, start) + '{' + name + '}' + cur.slice(end)
        setTpl(id, next)
        const pos = start + name.length + 2
        setTimeout(function () { try { ta.focus(); ta.setSelectionRange(pos, pos) } catch (e) { /* 忽略 */ } }, 0)
      }
      const chip = function (id, n, req) {
        return h('span', { key: n, className: 'dsws-cfg-chip' + (req ? ' req' : ''), title: req ? tr('cfg.chipReq') : tr('cfg.chipInsert'), onClick: function () { insertPh(id, n) } }, [
          h('span', null, '{' + n + '}'),
          req ? h('span', { className: 'must' }, tr('cfg.must')) : null,
        ])
      }
      const tplCard = function (id) {
        const val = tpls[id] || ''
        const preview = renderTemplate(id, PREVIEW_VALUES)
        const req = (TPL_REQUIRED[id] || []).slice()
        return h('div', { key: id, className: 'dsws-cfg-card' }, [
          h('div', { className: 'dsws-cfg-card-head' }, [
            h('span', { className: 'dsws-cfg-card-name' }, tr('tpl.name.' + id)),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-cfg-btn', onClick: function () { resetTpl(id) } }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-card-desc' }, tr('tpl.desc.' + id)),
          h('div', { className: 'dsws-cfg-chips' }, (TPL_PH[id] || []).map(function (n) { return chip(id, n, req.indexOf(n) >= 0) })),
          h('textarea', { ref: function (el) { taRefs.current[id] = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''), value: val, onChange: function (e) { setTpl(id, e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), preview]),
        ])
      }
      const custom = tpls.execute || ''
      // T5 修订：设置页内 toast（独立于面板 dock 的 notice 渲染）
      const cfgNotice = sharedSt.notice
      return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
        cfgNotice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
          Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
          h('span', null, cfgNotice.text),
        ]) : null,
        h('div', { className: 'dsws-cfg-head' }, [
          Icon({ scheme: 'compass', size: 20 }),
          h('span', { className: 't' }, tr('panel.title')),
          h('span', { className: 's', style: { color: saved ? 'var(--dsw-alias-state-success-primary,#4ade80)' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
            Ic({ n: saved ? 'check' : 'dot', size: 12 }),
            h('span', null, saved ? tr('cfg.saved') : tr('cfg.status')),
          ]),
        ]),
        h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
        // v1.5 T4：Matt 技能介绍卡（工程领域 + 通用领域 skills · GitHub 链接 + 安装 prompt 复制/注入）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'star', size: 13 }), h('span', null, tr('matte.title'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('matte.desc')),
          h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6 } }, [
            h('a', { href: MATT_REPO, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('matte.openRepo'))]),
            h('button', { className: 'dsws-btn', onClick: function () { copyText(sharedSt, promptText('installSkills'), tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('matte.copyPrompt'))]),
          ]),
        ]),
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
            openInNote ? h('div', { style: { fontSize: 11, color: '#4ade80', marginTop: 6 } }, tr('cfg.openInHint')) : null,
          ]),
        ]),
        // 1.5 面板宽度重置（#398 拆票 A · 与 #397 协调 · 等 layoutSvc.resetDetails API；缺失时友好提示不让 UI 崩溃）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'refresh', size: 13 }), h('span', null, tr('cfg.panelWidth'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.resetPanelWidthDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('button', { className: 'dsws-cfg-btn', onClick: function () {
              const ls = ctx.get('layout')
              if (ls && typeof ls.resetDetails === 'function') {
                try { ls.resetDetails(); setResetNote({ kind: 'ok', text: tr('toast.resetPanelWidthDone') }) }
                catch (e) { setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') }) }
              } else {
                setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') })
              }
              if (timer !== undefined) timer.timeout(function () { setResetNote(null) }, 2800)
            } }, tr('cfg.resetPanelWidth')),
            resetNote ? h('span', { style: { marginLeft: 10, fontSize: 11, color: resetNote.kind === 'ok' ? '#4ade80' : '#fbbf24' } }, resetNote.text) : null,
          ]),
        ]),
        // 2. 开始模板（execute 唯一编辑点；id 供动作模板编辑器锚点跳转）
        h('div', { id: 'dsws-cfg-exec-group', className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'play', size: 13 }), h('span', null, tr('cfg.startTpl'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.startTplDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('label', { className: 'dsws-cfg-sw' }, [
              h('input', { type: 'checkbox', checked: wf, onChange: function (e) { setWf(e.target.checked) } }),
              h('span', { className: 'tr' }),
              h('span', null, tr('cfg.withPrefix')),
            ]),
          ]),
          h('textarea', { ref: function (el) { taRefs.current.execute = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT.execute ? TPL_DEFAULT.execute() : ''), value: custom, onChange: function (e) { setTpl('execute', e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-chips' }, [
            (TPL_PH.execute || []).map(function (n) { return chip('execute', n, (TPL_REQUIRED.execute || []).indexOf(n) >= 0) }),
            h('button', { className: 'dsws-cfg-btn', style: { marginLeft: 'auto' }, onClick: resetExecute }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), renderTemplate('execute', PREVIEW_VALUES)]),
        ]),
        // 3. 动作模板编辑器（其余 6 动作 · T1：默认展开可手动折叠）
        h('details', { open: true, className: 'dsws-cfg-group dsws-cfg-details' }, [
          h('summary', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 650, marginBottom: 4, cursor: 'pointer', listStyle: 'none' } }, [Ic({ n: 'note', size: 13 }), h('span', null, tr('cfg.tplEditor'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, [
            h('span', null, tr('cfg.tplEditorDesc')),
            h('a', { href: 'javascript:void(0)', onClick: function () { const el = document.getElementById('dsws-cfg-exec-group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, style: { color: '#bc8cff', cursor: 'pointer', flex: 'none', textDecoration: 'none' } }, tr('cfg.execHint')),
          ]),
          TPL_EDIT_IDS.map(tplCard),
        ]),
        // 校验错误提示
        errs.length ? h('div', { className: 'dsws-cfg-err' }, [
          h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.saveRejected'))]),
          errs.map(function (e, i) { return h('div', { key: i }, '· ' + e) }),
        ]) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-end' } }, [
          h('button', { className: 'dsws-cfg-btn', onClick: resetAll }, tr('cfg.resetAll')),
          h('button', { className: 'dsws-cfg-save', onClick: save }, [Ic({ n: 'check', size: 13 }), h('span', null, tr('cfg.saveAll'))]),
        ]),
      ])
    }
