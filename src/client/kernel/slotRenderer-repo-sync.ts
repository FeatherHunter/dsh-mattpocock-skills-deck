/**
 * slotRenderer-repo-sync.ts — 仓库同步流程与失败文案（K1 由 slotRenderer.js 拆出）。
 *
 * 为什么同步要单独一层：建库之后要不要再查一次、失败文案拼哪几段、重试走哪条宿主调用，
 * 这些一旦散到弹窗各处就会各写一套，重试两次就会打架，所以同步的起止与文案只住在这里。
 * 本文件由 slotRenderer-repo-sync.js 转写而来，只加类型标注与环境声明，运行行为一字不改。
 * 反例：不要在这里画弹窗，不要在这里决定队列开关，打开入口见 slotRenderer-queue.ts。
 */
// 打开入口见 slotRenderer-queue.ts，弹窗本体见 slotRenderer-modal-view.ts；三文件经构建拼回同一闭包，互相调用不走 import。
declare function moduleMetaOf(...args: any[]): any;
declare function promptLang(...args: any[]): any;
declare function tr(...args: any[]): any;
declare function chainStep(...args: any[]): any;
declare function emit(...args: any[]): any;
declare const timer: any;
declare const host: any;
declare function loadSnapshot(...args: any[]): any;
declare function chainEventRefresh(...args: any[]): any;
declare function loadChain(...args: any[]): any;
declare function userHintOf(...args: any[]): any;
declare function closeFormModal(...args: any[]): any;
    function resolveFailText(st: any, dispKind: any, code: any, rawMsg: any): string {
      let bkText: string = ''
      try {
        const sel2: any = st.selection || (st.snapshot && st.snapshot.selection) || null
        const bid: any = sel2 && sel2.backendId
        const mm: any = (typeof moduleMetaOf === 'function' && bid != null) ? moduleMetaOf(st, bid) : null
        const ek: any = mm && mm.prompts && mm.prompts.errorKinds && mm.prompts.errorKinds[dispKind]
        if (ek) { const lg: any = (typeof promptLang === 'function') ? promptLang() : 'zh'; bkText = String((lg === 'en' && ek.en) ? ek.en : (ek.zh || '')) }
      } catch (e) { /* 后端数据兜底 */ }
      let mapped: string = ''
      try { const key: string = 'panel.noRepoErr.' + dispKind; const v: any = tr(key); if (v !== key) mapped = v } catch (e) { /* locale 兜底 */ }
      let fb: string = ''
      try { fb = tr('panel.noRepoErr.half-created') } catch (e) { /* 兜底 */ }
      let base: string = bkText || mapped || rawMsg || ''
      if (dispKind === 'half-created') { base = (bkText || mapped || fb || '') + (rawMsg ? '：' + String(rawMsg).slice(0, 120) : '') }
      // #993：unknown 与 git-ownership 这两档正文里没有 git 原话时一定要补上它，文案承诺了附原话却不附就是名实不符。
      if (dispKind === 'unknown' || dispKind === 'git-ownership') {
        const rawFull: string = rawMsg ? String(rawMsg) : ''
        const rawCut: string = rawFull ? rawFull.slice(0, 160) : ''
        if (rawCut && base !== rawCut && base !== rawFull) base = (base || rawCut) + ' · ' + rawFull.slice(0, 120)
      }
      return base
    }
    export function startRepoSync(st: any): void {
      if (!st) return
      st.repoSync = { phase: 'syncing', at: Date.now() }
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_){} }
      try {
        const t: any = (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') ? timer.timeout : (typeof setTimeout === 'function' ? setTimeout : null)
        if (t) t(function(): void { if (st.repoSync && st.repoSync.phase === 'syncing') { st.repoSync = { phase: 'timeout', at: Date.now() }; try { if (typeof emit === 'function') emit(st) } catch(_){} } }, 30000)
      } catch (e) { /* 超时兜底失败不阻断 */ }
    }
    export function finishRepoSync(st: any): void {
      if (!st || !st.repoSync) return
      try {
        const remote: any = (typeof chainStep === 'function') ? chainStep(st, 'gh:remote') : null
        if (remote && remote.status === 'done') { st.repoSync = null }
        else { st.repoSync = { phase: 'timeout', at: Date.now() } }
      } catch (e) { st.repoSync = { phase: 'timeout', at: Date.now() } }
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_){} }
    }
    export function retryRepoSync(st: any): any {
      if (!st) return Promise.resolve()
      try { if (st.repoSync) st.repoSync = { phase: 'syncing', at: Date.now() }; if (typeof emit === 'function') emit(st) } catch(_){}
      return (async function (): Promise<void> {
        try {
          if (typeof host !== 'undefined' && host.call) {
            await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (typeof userHintOf === 'function' ? userHintOf(st.selection) : undefined) || undefined })
          }
          try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch(_){}
          try { if (typeof chainEventRefresh === 'function') await chainEventRefresh(st, 'user-recheck'); else if (typeof loadChain === 'function') await loadChain(st, true, 'user-recheck') } catch(_){}
        } catch (e) { /* 重查失败由 finishRepoSync 定态 */ }
        finishRepoSync(st)
      })()
    }
    function runRepoSyncRecheck(st: any): any {
      return (async function (): Promise<void> {
        try {
          if (typeof host !== 'undefined' && host.call) {
            await host.call('wf.detect', { cwd: st.cwd || '', force: true, backendId: (typeof userHintOf === 'function' ? userHintOf(st.selection) : undefined) || undefined })
          }
          try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch(_){}
          try { if (typeof chainEventRefresh === 'function') await chainEventRefresh(st, 'action-done'); else if (typeof loadChain === 'function') await loadChain(st, true, 'action-done') } catch(_){}
        } catch (e) { /* 重查异常照常定态 */ }
        finishRepoSync(st)
      })()
    }
    function closeSuccess(st: any): void {
      if (!st || !st.formModal) return
      st.formModal.success = null
      try { if (typeof emit === 'function') emit(st) } catch (e) { try { st.tick = (st.tick||0)+1 } catch(_){} }
    }
    function visLabelOf(visibility: any): string {
      const lg: any = (typeof promptLang === 'function') ? promptLang() : 'zh'
      const v: string = String(visibility || 'public')
      if (v === 'private') return lg === 'en' ? 'private' : '私有'
      return lg === 'en' ? 'public' : '公开'
    }
    function retryPushFlow(st: any, m: any): void {
      const fail: any = m && m.fail
      const repo: any = fail && fail.repo ? fail.repo : null
      const repoUrl: string = fail && fail.link ? fail.link : ''
      if (!repo) return
      m.pending = true
      m.fail = null
      try { if (typeof emit === 'function') emit(st) } catch(_){}
      ;(async function (): Promise<void> {
        try {
          let res: any = null
          if (typeof host !== 'undefined' && host.call) res = await host.call('wf.retryPush', { cwd: st.cwd || '', name: repo.name || '', owner: repo.owner || '', repoUrl: repoUrl })
          m.pending = false
          if (res && res.ok && res.repo) {
            try { if (st && Array.isArray(st._formModalQueue)) st._formModalQueue = [] } catch(_){}
            try { closeFormModal(st) } catch(_){ m.open = false }
            const r2: any = res.repo
            m.success = { owner: r2.owner || '', name: r2.name || '', url: (res && res.repoUrl) ? res.repoUrl : '', visLabel: visLabelOf(m.lastVis) }
            startRepoSync(st)
            runRepoSyncRecheck(st)
          } else {
            const code: string = (res && res.errorKind) ? String(res.errorKind).toLowerCase() : 'network'
            m.fail = { kind: 'half-created', code: code, text: resolveFailText(st, 'half-created', code, String((res && res.error) || '')), link: repoUrl || null, repo: repo, halfCreated: true }
          }
        } catch (e) {
          m.pending = false
          const code: string = (e && ((e as any).code || (e as any).errorKind)) ? String((e as any).code || (e as any).kind || (e as any).errorKind).toLowerCase() : 'network'
          m.fail = { kind: 'half-created', code: code, text: resolveFailText(st, 'half-created', code, String((e && (e as any).message) || e)), link: repoUrl || null, repo: repo, halfCreated: true }
        }
        try { if (typeof emit === 'function') emit(st) } catch(_){}
      })()
    }
