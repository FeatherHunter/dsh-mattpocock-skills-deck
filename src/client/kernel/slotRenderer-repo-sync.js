// slotRenderer-repo-sync.js — 仓库同步流程与失败文案（K1 由 slotRenderer.js 拆出，行为零变化）。
// 含 resolveFailText、startRepoSync、finishRepoSync、retryRepoSync、runRepoSyncRecheck、closeSuccess、visLabelOf、retryPushFlow。
// 打开入口见 slotRenderer-queue.js，弹窗本体见 slotRenderer-modal-view.js；三文件经构建拼回同一闭包，互相调用不走 import。

    // ---- #419/#425 成功闭环与 #420/#426 失败文案（helpers，纯函数 + st 级状态）----
    function resolveFailText(st, dispKind, code, rawMsg) {
      let bkText = ''
      try {
        const sel2 = st.selection || (st.snapshot && st.snapshot.selection) || null
        const bid = sel2 && sel2.backendId
        const mm = (typeof moduleMetaOf === 'function' && bid != null) ? moduleMetaOf(st, bid) : null
        const ek = mm && mm.prompts && mm.prompts.errorKinds && mm.prompts.errorKinds[dispKind]
        if (ek) { const lg = (typeof promptLang === 'function') ? promptLang() : 'zh'; bkText = String((lg === 'en' && ek.en) ? ek.en : (ek.zh || '')) }
      } catch (e) { /* 后端数据兜底 */ }
      let mapped = ''
      try { const key = 'panel.noRepoErr.' + dispKind; const v = tr(key); if (v !== key) mapped = v } catch (e) { /* locale 兜底 */ }
      let fb = ''
      try { fb = tr('panel.noRepoErr.half-created') } catch (e) { /* 兜底 */ }
      let base = bkText || mapped || rawMsg || ''
      if (dispKind === 'half-created') { base = (bkText || mapped || fb || '') + (rawMsg ? '：' + String(rawMsg).slice(0, 120) : '') }
      return base
    }
    export function startRepoSync(st) {
      if (!st) return
      st.repoSync = { phase: 'syncing', at: Date.now() }
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_){} }
      try {
        const t = (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') ? timer.timeout : (typeof setTimeout === 'function' ? setTimeout : null)
        if (t) t(function(){ if (st.repoSync && st.repoSync.phase === 'syncing') { st.repoSync = { phase: 'timeout', at: Date.now() }; try { if (typeof emit === 'function') emit(st) } catch(_){} } }, 30000)
      } catch (e) { /* 超时兜底失败不阻断 */ }
    }
    export function finishRepoSync(st) {
      if (!st || !st.repoSync) return
      try {
        const remote = (typeof chainStep === 'function') ? chainStep(st, 'gh:remote') : null
        if (remote && remote.status === 'done') { st.repoSync = null }
        else { st.repoSync = { phase: 'timeout', at: Date.now() } }
      } catch (e) { st.repoSync = { phase: 'timeout', at: Date.now() } }
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_){} }
    }
    export function retryRepoSync(st) {
      if (!st) return Promise.resolve()
      try { if (st.repoSync) st.repoSync = { phase: 'syncing', at: Date.now() }; if (typeof emit === 'function') emit(st) } catch(_){}
      return (async function () {
        try {
          if (typeof host !== 'undefined' && host.call) {
            await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (st.selection && st.selection.backendId) || undefined })
          }
          try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch(_){}
          try { if (typeof loadChain === 'function') await loadChain(st, true) } catch(_){}
        } catch (e) { /* 重查失败由 finishRepoSync 定态 */ }
        finishRepoSync(st)
      })()
    }
    function runRepoSyncRecheck(st) {
      return (async function () {
        try {
          if (typeof host !== 'undefined' && host.call) {
            await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (st.selection && st.selection.backendId) || undefined })
          }
          try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch(_){}
          try { if (typeof loadChain === 'function') await loadChain(st, true) } catch(_){}
        } catch (e) { /* 重查异常照常定态 */ }
        finishRepoSync(st)
      })()
    }
    function closeSuccess(st) {
      if (!st || !st.formModal) return
      st.formModal.success = null
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_){} }
    }
    function visLabelOf(visibility) {
      const lg = (typeof promptLang === 'function') ? promptLang() : 'zh'
      const v = String(visibility || 'public')
      if (v === 'private') return lg === 'en' ? 'private' : '私有'
      return lg === 'en' ? 'public' : '公开'
    }
    function retryPushFlow(st, m) {
      const fail = m && m.fail
      const repo = fail && fail.repo ? fail.repo : null
      const repoUrl = fail && fail.link ? fail.link : ''
      if (!repo) return
      m.pending = true
      m.fail = null
      try { if (typeof emit === 'function') emit(st) } catch(_){}
      ;(async function () {
        try {
          let res = null
          if (typeof host !== 'undefined' && host.call) res = await host.call('wf.retryPush', { cwd: st.cwd || '', name: repo.name || '', owner: repo.owner || '', repoUrl: repoUrl })
          m.pending = false
          if (res && res.ok && res.repo) {
            // 重试成功 → 走成功闭环（成功弹窗 + 同步过渡态 + 后台重查）
            try { if (st && Array.isArray(st._formModalQueue)) st._formModalQueue = [] } catch(_){}
            try { closeFormModal(st) } catch(_){ m.open = false }
            const r2 = res.repo
            m.success = { owner: r2.owner || '', name: r2.name || '', url: (res && res.repoUrl) ? res.repoUrl : '', visLabel: visLabelOf(m.lastVis) }
            startRepoSync(st)
            runRepoSyncRecheck(st)
          } else {
            const code = (res && res.errorKind) ? String(res.errorKind).toLowerCase() : 'network'
            m.fail = { kind: 'half-created', code: code, text: resolveFailText(st, 'half-created', code, String((res && res.error) || '')), link: repoUrl || null, repo: repo, halfCreated: true }
          }
        } catch (e) {
          m.pending = false
          const code = (e && (e.code || e.errorKind)) ? String(e.code || e.kind || e.errorKind).toLowerCase() : 'network'
          m.fail = { kind: 'half-created', code: code, text: resolveFailText(st, 'half-created', code, String((e && e.message) || e)), link: repoUrl || null, repo: repo, halfCreated: true }
        }
        try { if (typeof emit === 'function') emit(st) } catch(_){}
      })()
    }
