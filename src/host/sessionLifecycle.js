// src/host/sessionLifecycle.js —— 会话启停电话与共享早选判据（H4 #448 从 host/index.js 273–275/288–307 搬出电话体，早选判据为快照与刷新两处前奏的同一逻辑收敛，纯结构、行为零变化）。
// 以后谁改它：改会话启停电话或早选与 force 判据的人。预估约70行，超 350 打回。
// 接线：由 index.js 动态 import 加载；ctx 与探测服务显式注入，快照与刷新经 index 转供给复用；本文件不引用其他新文件。
export function createSessionLifecycle(deps) {
  const { ctx, DEFAULT_CWD, errText, getDetectionService, getTrackerRegistry, getPlatform, logCtx } = deps
  // #491 房外埋点：hash8 只记散列不记原文；探测结论低频常驻，直接落盘（库体内兜底）。
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  async function handlePing() {
      return { ok: true, ts: Date.now() }
  }
  async function handleCwd(args) {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: '缺少 sessionId' }
      const sessions = ctx.get('sessions')
      if (sessions === undefined || typeof sessions.get !== 'function') return { ok: false, error: 'sessions 服务不可用' }
      try {
        const s = sessions.get(sid)
        // 现代 DSH 的 Session 结构：header.cwd 为权威；兼容旧 meta / 直接 cwd 字段
        const header = s && (s.header || s.meta)
        const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd: cwd }
        const meta = s && s.meta
        const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
        if (typeof cwd2 === 'string' && cwd2) return { ok: true, cwd: cwd2 }
        if (s && typeof s.cwd === 'string' && s.cwd) return { ok: true, cwd: s.cwd }
        return { ok: false, error: '会话无 cwd 信息' }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
  }
  // 两处前奏的同一判据收敛：显式绑定优先，否则实时探测。快照与刷新经显式参数复用本函数，不各留一份拷贝。
  async function selectEarly(selCtx) {
    const cwd = selCtx.cwd
    const backendId = selCtx.backendId
    let sel = null
    try {
      const svc = await getDetectionService()
      if (svc && typeof svc.detect === 'function') {
        const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: backendId })
        if (det && det.selection) sel = det.selection
      }
    } catch {}
    if (!sel || (sel.backendId == null && (!sel.source || sel.source !== 'explicit'))) {
      try {
        const regTmp = await getTrackerRegistry()
        const tmpHandle = { cwd }
        const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
        const sel2 = await regTmp.select(tmpHandle, tmpCtx)
        if (sel2) sel = sel2
      } catch {}
    }
    try { if (logCtx) logCtx.fire('info', 'detection.detect', { cwdHash: hash8(cwd), explicit: !!((sel && sel.source === 'explicit')), matches: (sel && Array.isArray(sel.multiHit)) ? sel.multiHit.length : ((sel && sel.source === 'matches') ? 1 : 0), pending: !!(sel && sel.pending), selection: String((sel && sel.backendId) || '') }) } catch (eL) {}
    return sel
  }
  function isComposerSelection(sel) {
    return !!(sel && sel.backendId && sel.backendId !== 'github' && sel.backendId !== '' && sel.backendId !== 'other')
  }
  return { handlePing, handleCwd, selectEarly, isComposerSelection }
}
