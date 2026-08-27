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
            try { onSubmit({}) } catch (e) {}
          },
          refresh: async function (target) {
            try {
              if (typeof host !== 'undefined' && host.call) { await host.call('wf.detect', { cwd: st.cwd || '', force: true }) }
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
  const chainBannerBlock = (chainSnapshot && chainDispatcher) ? (function () {
    try { return h(ChainRenderer, { snapshot: chainSnapshot, dispatcher: chainDispatcher, st: st }) } catch (e) { return null }
  })() : null
  // 垂直步骤明细：每步 = 状态圆点 + 名称 + 描述（动作按钮由 banner 的 ChainRenderer 承担，明细不再重复）
  const statusMeta = function (s) {
    const sts = s.status
    if (sts === 'done') return { dot: '#16a34a', color: '#4ade80', label: '\u2713' }
    if (sts === 'current') return { dot: '#f59e0b', color: '#f59e0b', label: '!' }
    if (sts === 'fail') return { dot: '#ef4444', color: '#f87171', label: '\u2715' }
    return { dot: '#6b7280', color: '#a1a1aa', label: '\u2026' }
  }
  const stepRows = steps.length ? steps.map(function (s, i) {
    const meta = statusMeta(s)
    const label = (s.show && (s.show.fallback || s.show.title || s.show.i18nKey)) || s.id
    const desc = (s.show && (s.show.desc || '')) || ''
    return h('div', { key: s.id || i, className: 'dsws-ccard', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, [
      h('span', { style: { width: 16, height: 16, borderRadius: '50%', background: meta.dot, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flex: 'none' } }, meta.label),
      h('span', { style: { flex: 1, minWidth: 0 } }, [
        h('span', { className: 'nm', style: { color: meta.color } }, String(label)),
        desc ? h('div', { className: 'dt dsws-ellip', title: desc, style: { color: '#8b8b95' } }, desc) : null,
      ]),
    ])
  }) : null
  return h('div', null, [
    chainBannerBlock,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 } }, [
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'gear', size: 12 }), h('span', null, tr('env.title', { n: envLabel(st) }))]),
      (function () {
        const selTop = st.selection || (st.snapshot && st.snapshot.selection) || null
        if (selTop && selTop.backendId) return h('span', { title: tr('banner.setupPickHint'), style: { fontSize: 10, lineHeight: '16px', padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(139,140,255,.45)', color: '#9a9aff' } }, String(selTop.backendId))
        if (selTop && selTop.pending) return h('span', { style: { fontSize: 10, color: '#8b8b95' } }, tr('env.detecting'))
        return null
      })(),
      h('span', { style: { flex: 1 } }),
      h('button', { className: 'dsws-btn', disabled: st.refreshing, onClick: function () { refreshAll(st) }, style: { fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
        h('span', { className: 'dsws-rficon' + (st.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]),
        h('span', null, tr('env.recheck')),
      ]),
    ]),
    // no-repo 弱化卡（与旧行为一致：红卡显示时弱化为提示，dismiss 后提供重置入口）
    (function () { const dismissed = isNoRepoDismissed(st.cwd); const showRed = remoteBad && !dismissed; if (!showRed) return null; return h('div', { className: 'dsws-ccard', style: { opacity: 0.85, borderColor: 'rgba(139,139,149,.35)', background: 'rgba(139,139,149,.08)', marginBottom: 6 } }, [h('div', { className: 'nm', style: { color: '#8b8b95' } }, (remoteStep && remoteStep.show && (remoteStep.show.fallback || remoteStep.show.title)) || tr('nav.takeable')), h('div', { className: 'dt', style: { color: '#8b8b95' } }, tr('panel.noRepoCardDone')), h('div', { className: 'act' }, [h('button', { className: 'dsws-btn', onClick: function () { st.tab = 'list'; emit(st) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('panel.tabList'))])]) })(),
    (function () { const dismissed = isNoRepoDismissed(st.cwd); if (!dismissed) return null; if (!remoteBad) return null; return h('div', { className: 'dsws-ccard', style: { borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.06)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 } }, [h('span', { style: { fontSize: 11, color: '#f87171', flex: 1 } }, tr('panel.noRepoCardDismiss') + ' \u00b7 ' + (remoteStep && remoteStep.show && (remoteStep.show.desc || ''))), h('button', { className: 'dsws-btn', onClick: function () { setNoRepoDismissed(st.cwd, false); emit(st) }, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, tr('panel.noRepoReset'))]) })(),
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
