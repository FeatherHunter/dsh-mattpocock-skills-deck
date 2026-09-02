/**
 * views/ChecksTab.js — 环境检查（5.7 · #284 改版）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 * #284：九格目录视图（wf.status/checks 分组卡）整体退役；本页 = 链快照唯一渲染：
 *   ChainRenderer 同源 banner（蓝/黄/红互斥 42px）+ 步进条 + 动作分发；
 *   垂直步骤明细列出链上每一步的状态/名称/描述。渲染适配层随之瘦身。
 */
export const ChecksTab = ({ st }) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  React.useEffect(function () { loadChain(st, false) }, [])
  // B 方案（2026-08-28 用户定版）：链未全绿时每 20s 静默重查一次——修复（在对话/终端完成）后面板自动变绿，
  //   无需手动点「重新检查」；host 侧对未全绿快照不写 30s 缓存，poll 每次真探测；链全部通过后定时器停止（零开销）。
  React.useEffect(function () {
    const pollTimer = setInterval(function () {
      try {
        const steps = chainSteps(st)
        if (!steps.length) return
        if (steps.every(function (s) { return s.status === 'done' })) return
        if (st.refreshing) return
        loadChain(st, false)
      } catch (e) {}
    }, 20000)
    return function () { try { clearInterval(pollTimer) } catch (e) {} }
  }, [])
  // #284：单一口径 = 链快照步骤（pending = 诚实未知/未接入，置灰展示，不计入 ready/total）
  const steps = chainSteps(st)
  const chainSnapshot = st.chainSnapshot || null
  // no-repo 判定：链步骤 gh:remote 失败（原 findCheck('gh:remote').level==='bad'）
  const remoteStep = chainStep(st, 'gh:remote')
  const remoteBad = !!(remoteStep && remoteStep.status === 'fail')
  const chainDispatcher = (function () {
    try {
      if (typeof createActionDispatcher === 'function') {
        return createActionDispatcher({
          inject: function (text, args) { try { inject(st, text) } catch (e) {} },
          openUrl: function (url) { try { openUrl(url) } catch (e) {} },
          hostCall: function (method, params) { if (typeof host !== 'undefined' && host.call) return host.call(method, params); return Promise.reject(new Error('hostCall unavailable')) },
          renderForm: function (schema, onSubmit) {
            try {
              // #308 modal-seat + #318 wizard 单步：只用 openFormModal（顺序队列，失败不关，焦点聚集），不再手写 m.open 赋值
              // 兼容：wizard 载荷为 {type:'wizard', steps:[{schema}], label, submitAction}，form 为数组 schema
              const isWizardPayload = schema && typeof schema === 'object' && !Array.isArray(schema) && Array.isArray(schema.steps)
              if (typeof openFormModal === 'function') {
                if (isWizardPayload) {
                  // 单步 wizard 当单页表单：复用 modal-seat，向导感知渲染会在弹窗内分页（1 步即单页）；label 空时由 slotRenderer 回落“向导”，避免 ChecksTab 硬编码中文越 baseline
                  openFormModal(st, { type: 'wizard', steps: schema.steps, label: schema.label || '', submitAction: schema.submitAction || null }, onSubmit)
                } else {
                  openFormModal(st, { type: 'form', schema: schema, label: '填写表单' }, onSubmit)
                }
              } else if (typeof ensureFormModal === 'function') {
                // 兜底：旧 API（理论不可达，仅防产物不同步）
                const m = ensureFormModal(st)
                if (isWizardPayload) {
                  // 向导兜底：仍按 form 打开首步 schema（降级可用，label 空时由后续渲染回落）
                  const firstSchema = (Array.isArray(schema.steps[0] && schema.steps[0].schema) ? schema.steps[0].schema : (Array.isArray(schema.steps[0] && schema.steps[0].fields) ? schema.steps[0].fields : []))
                  m.open = true
                  m.schema = firstSchema
                  m.onSubmit = typeof onSubmit === 'function' ? onSubmit : null
                  m.label = schema.label || ''
                  m.pending = false
                } else {
                  m.open = true
                  m.schema = Array.isArray(schema) ? schema : []
                  m.onSubmit = typeof onSubmit === 'function' ? onSubmit : null
                  m.label = '填写表单'
                  m.pending = false
                }
                try { if (typeof emit === 'function') emit(st) } catch (e2) { try { st.tick = (st.tick||0)+1 } catch(_) {} }
              } else {
                try { onSubmit({}) } catch (e2) {}
              }
            } catch (e) {}
          },
          refresh: async function (target) {
            try {
              if (typeof host !== 'undefined' && host.call) { await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (st.selection && st.selection.backendId) || undefined }) }
            } catch (e) {}
            try { loadChain(st, true) } catch (e) {}
            try { loadSnapshot(st, true, true) } catch (e) {}
          },
          tr: tr,
          resolvePrompt: function (id, params) { try { if (id === 'setupRun' && typeof setupRunPrompt === 'function') return setupRunPrompt(st); return promptText(id, params) } catch (e) { return '' } }
        })
      }
    } catch (e) {}
    return null
  })()
  // B Timeline 定版（2026-08-28）：顶部不渲染 ChainBanner（原型无横幅——FAIL 状态由行内红卡+右置主按钮表达）；
  //   垂直步骤明细：每步 = 状态圆点 + 名称 + 描述（动作按钮按行级 primaryAction 渲染）
  const statusMeta = function (s) {
    const sts = s.status
    if (sts === 'done') return { dot: '#16a34a', color: '#4ade80', label: '\u2713' }
    if (sts === 'current') return { dot: '#f59e0b', color: '#f59e0b', label: '!' }
    if (sts === 'fail') return { dot: '#ef4444', color: '#f87171', label: '\u2715' }
    return { dot: '#6b7280', color: '#a1a1aa', label: '\u2026' }
  }
  // 修复契约（2026-08-28）：hint = 修复指引文案（host 由后端 fixes 解析；'prompt:' 前缀经 resolvePrompt 解出，UI 零派生）；
  //   动作按钮 = 检查失败时的可执行修复入口（inject-prompt / open-url / rpc / form / refresh），执行后走既有重求值闭环。
  const miniActionLabel = function (a) {
    const t = a && a.type
    if (t === 'inject-prompt') return (a && a.label) || '执行'
    if (t === 'open-url') return '打开链接'
    if (t === 'rpc') return (a && (a.method || a.endpoint)) || '执行'
    if (t === 'form') return (a && a.label) || '填写表单'
    if (t === 'wizard') return (a && a.label) || 'Wizard'
    if (t === 'refresh') return '重查'
    return 'unsupported: ' + String(t || 'unknown')
  }
  const runAction = async function (a) {
    if (!chainDispatcher) return
    try {
      const res = await chainDispatcher.dispatch(a)
      if (!res || !res.ok) { try { flash(st, String((res && res.error && res.error.message) || '动作失败'), 'warn') } catch (e) {} }
    } catch (e) { try { flash(st, String((e && e.message) || e).slice(0, 200), 'warn') } catch (e2) {} }
  }
  const hintTextOf = function (s) {
    const raw = (s && s.show && (s.show.hint || '')) || ''
    if (!raw) return ''
    if (typeof raw === 'string' && raw.indexOf('prompt:') === 0) {
      const pk = raw.slice(7)
      if (chainDispatcher && typeof chainDispatcher.resolvePrompt === 'function') {
        try { const r = chainDispatcher.resolvePrompt(pk, {}); if (typeof r === 'string' && r) return r } catch (e) {}
      }
    }
    return typeof raw === 'string' ? raw : ''
  }
  const stepRows = steps.length ? steps.map(function (s, i) {
    const meta = statusMeta(s)
    const label = (s.show && (s.show.fallback || s.show.title || s.show.i18nKey)) || s.id
    const desc = (s.show && (s.show.desc || '')) || ''
    // #284 修订（对抗式审查 2026-08-28）：pending 分两种——被前置阻塞（blockedBy 指明前置步）与诚实探测中；
    //   阻塞必须在 UI 明示，避免把「尚未轮到」误读为「探测中/未接入」（正是 #276 反对的不诚实状态）。
    let blockedNote = ''
    if (s.status === 'pending' && s.blockedBy) {
      const blocker = steps.find(function (x) { return String(x.id) === String(s.blockedBy) }) || null
      const blockerName = (blocker && blocker.show && (blocker.show.fallback || blocker.show.title)) || s.blockedBy
      blockedNote = tr('env.waitingBlocked', { by: String(blockerName) })
    }
    const finalDesc = blockedNote ? (desc ? desc + ' \u00b7 ' + blockedNote : blockedNote) : desc
    const hintText = hintTextOf(s)
    // #308 modal-seat：表单改走槽位弹窗；2026-08-28 用户定版：每行只保留一个主修复动作（form/wizard 优先，
    //   其次 inject-prompt/rpc），按钮置于行右侧；refresh 不再单独成按钮（顶部已有「重新检查」）。
    const fixActions = (s.status === 'fail' || s.status === 'current') ? (Array.isArray(s.actions) ? s.actions : []) : []
    const primaryAction = (chainDispatcher && fixActions.length) ? (fixActions.find(function (a) { return a && (a.type === 'form' || a.type === 'wizard') }) || fixActions.find(function (a) { return a && (a.type === 'inject-prompt' || a.type === 'rpc') }) || null) : null
    const primaryBtn = primaryAction ? (function () {
      const alabel = miniActionLabel(primaryAction)
      return h('button', { key: 'fix-primary', className: 'dsws-btn primary', tabIndex: 0, onClick: function () { runAction(primaryAction) }, style: { fontSize: 12, padding: '6px 14px', flex: 'none', whiteSpace: 'nowrap' } }, alabel)
    })() : null
    return h('div', { key: s.id || i, className: 'dsws-ccard', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, padding: primaryBtn ? '10px 12px' : undefined, border: primaryBtn ? '1px solid var(--dsw-alias-border-l1,#2a2d35)' : undefined, borderRadius: 10, background: primaryBtn ? 'var(--dsw-alias-bg-layer-1,#10131a)' : undefined } }, [
      h('span', { style: { width: 16, height: 16, borderRadius: '50%', background: meta.dot, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flex: 'none' } }, meta.label),
      h('span', { style: { flex: 1, minWidth: 0 } }, [
        h('span', { className: 'nm', style: { color: meta.color, fontWeight: primaryBtn ? 600 : 400 } }, String(label)),
        finalDesc ? h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.desc')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, finalDesc)]) }, h('div', { className: 'dt dsws-ellip', style: { color: '#8b8b95' } }, finalDesc)) : null,
        hintText ? h('div', { className: 'dt', style: { color: '#d97706', lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-wrap' } }, hintText) : null,
      ]),
      primaryBtn,
    ])
  }) : null
  // #308 modal-seat 挂载点（shell.overlay / root / single，复用 .dsws-modal 遮罩）
  const formModalNode = (typeof FormModalSeat === 'function') ? (function(){ try { return h(FormModalSeat, { st: st }) } catch(e){ return null } })() : null
  return h('div', null, [
    formModalNode,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 } }, [
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'gear', size: 12 }), h('span', null, tr('env.title', { n: envLabel(st) }))]),
      (function () {
        const selTop = st.selection || (st.snapshot && st.snapshot.selection) || null
        if (selTop && selTop.backendId) return h(Tip, { content: tr('banner.setupPickHint') }, h('span', { style: { fontSize: 10, lineHeight: '16px', padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(139,140,255,.45)', color: '#9a9aff' } }, String(selTop.backendId)))
        if (selTop && selTop.pending) return h('span', { style: { fontSize: 10, color: '#8b8b95' } }, tr('env.detecting'))
        return null
      })(),
      h('span', { style: { flex: 1 } }),
      h('button', { className: 'dsws-btn', disabled: st.refreshing, onClick: function () { refreshAll(st) }, style: { fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
        h('span', { className: 'dsws-rficon' + (st.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]),
        h('span', null, tr('env.recheck')),
      ]),
    ]),
    // B Timeline 定版（2026-08-28）：无 no-repo 弱化卡/恢复卡——远端未关联由行内红卡（gh:remote FAIL 行）表达；
    //   dismiss 状态机保留在 store（向后兼容），不再在检查页顶部占用空间
    stepRows,
    // #155 Q7：能力诊断折叠卡（默认收起，不进渲染分支；G5 能力视图仅诊断不驱动隐藏）
    (function () {
      const snap = st.snapshot
      const issues = snap && Array.isArray(snap.issues) ? snap.issues : []
      if (!issues.length && !snap) return null
      const caps = snap && snap.capabilities ? snap.capabilities : null
      let counts = caps
      if (!counts) {
        const fields = ['author', 'assignees', 'labels', 'milestone', 'customFields', 'reason', 'blockedBy', 'comments', 'closedAt']
        let present = 0, empty = 0, missing = 0
        issues.forEach(function (it) {
          fields.forEach(function (f) {
            if (it[f] === undefined) missing++
            else if (Array.isArray(it[f]) && it[f].length === 0) empty++
            else if (it[f] === null || it[f] === '') empty++
            else present++
          })
        })
        counts = { present: present, empty: empty, missing: missing }
      }
      const sel = st.selection || (snap && snap.selection) || null
      const repoRef = st.repository || (snap && snap.repository) || null
      return h('details', { style: { marginTop: 8, border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 6, padding: '6px 8px', background: 'rgba(255,255,255,.02)' } }, [
        h('summary', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: 'note', size: 11 }),
          h('span', null, '能力诊断（折叠，默认收起）'),
          h('span', { style: { fontSize: 10, color: '#8b8b95', marginLeft: 6 } }, 'present ' + counts.present + ' / empty ' + counts.empty + ' / missing ' + counts.missing),
        ]),
        h('div', { style: { fontSize: 11, color: '#8b8b95', marginTop: 6, lineHeight: 1.6 } }, [
          h('div', null, '当前后端: ' + (sel && sel.backendId ? sel.backendId : '\u2014') + (sel && sel.source ? ' (' + sel.source + ')' : '') + (sel && sel.pending ? ' \u23F3 pending' : '') + (sel && sel.multiHit ? ' \u26A0 multiHit:' + sel.multiHit.join(',') : '')),
          repoRef ? h('div', null, '仓库: ' + repoRef.name + (repoRef.url ? ' \u2014 ' + repoRef.url : ' (本地)')) : null,
          h('div', null, '字段 presence: present=' + counts.present + ' \u00b7 empty=' + counts.empty + ' \u00b7 missing=' + counts.missing),
          h('div', { style: { fontSize: 10, color: '#6b7280', marginTop: 4 } }, '诊断双轨：host 记每字段填/空，client 记渲染/隐藏；G5 能力视图不进任何 if(capability) 隐藏分支。'),
          h('div', { style: { marginTop: 6 } }, [
            h('button', { className: 'dsws-btn ghost', onClick: function () { try { console.log('[dsws] capabilities', counts, 'selection', sel, 'repo', repoRef) } catch {}; flash(st, '能力诊断已输出到控制台', 'info') }, style: { fontSize: 10, padding: '2px 6px' } }, '查看日志'),
          ]),
        ]),
      ])
    })(),
  ])
}
