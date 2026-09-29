// src/host/sessionLifecycle.js —— 会话启停电话与共享早选判据（H4 #448 从 host/index.js 273–275/288–307 搬出电话体，早选判据为快照与刷新两处前奏的同一逻辑收敛，纯结构、行为零变化）。
// 以后谁改它：改会话启停电话或早选与 force 判据的人。预估约70行，超 350 打回。
// 接线：由 index.js 动态 import 加载；ctx 与探测服务显式注入，快照与刷新经 index 转供给复用；本文件不引用其他新文件；目录取法调 shared 共用函数（#730），内存答不出再问一次落盘语料（同票第二段）。
import { resolveSessionCwd } from '../shared/session-cwd.js'
export function createSessionLifecycle(deps) {
  const { ctx, DEFAULT_CWD, errText, getDetectionService, getTrackerRegistry, getPlatform, canonicalKey, logCtx } = deps
  // #491 房外埋点：hash8 只记散列不记原文；探测结论低频常驻，直接落盘（库体内兜底）。
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  async function handlePing() {
      return { ok: true, ts: Date.now() }
  }
  // #730 第二段：内存里答不出时，去落盘语料问一次同一个字段（会话头里的目录）。
  //   为什么必须有这一步：DSH 的会话仓库只装「活着的」会话，会话所属的执行单元一释放就把会话移出仓库，
  //   于是「刚才还在看的会话，过一会儿就问不到了」。可真机实测 4187 个落盘会话头里 4187 个都记着目录，
  //   一个不缺——答案一直在盘上，原先只问了内存那一个来源（真机 5 天 1957 次询问失败 283 次，全落在这一支）。
  //   只读头、不读事件正文（filterSessions 读的是语料的头部清单，不做事件重放），失败一律回空串，
  //   由调用方按原本那一类如实失败——绝不在插件这边自己拼一个目录出来。
  async function persistedCwdOf(sid) {
    try {
      const q = ctx.get('sessionQuery')
      if (!q || typeof q.filterSessions !== 'function') return ''
      const records = await q.filterSessions([{ kind: 'id', values: [String(sid)] }])
      if (!Array.isArray(records)) return ''
      for (const rec of records) {
        const cwd = resolveSessionCwd(rec) // 语料记录与「会话对象」同形（头放在 header 里），所以共用同一只取法
        if (cwd) return cwd
      }
    } catch (e) {}
    return ''
  }
  async function handleCwd(args) {
      const sid = args && args.sessionId
      // 失败四种各有机器可读种类（#730：无目录与找不到会话必须分开，否则排查分不清哪一类现场；旧文案一个字不改）。
      if (!sid) return { ok: false, error: '缺少 sessionId', kind: 'no-sid' }
      const sessions = ctx.get('sessions')
      if (sessions === undefined || typeof sessions.get !== 'function') return { ok: false, error: 'sessions 服务不可用', kind: 'no-service' }
      let liveMissing = false
      try {
        const s = sessions.get(sid)
        if (!s) liveMissing = true
        else {
          const cwd = resolveSessionCwd(s) // #730：与沙箱同一套取法，只读 header.cwd
          if (cwd) return await withRoot({ ok: true, cwd: cwd }, cwd)
        }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
      const fromDisk = await persistedCwdOf(sid) // #730 第二段：内存答不出就问落盘；两处都答不出才按原样失败
      if (fromDisk) return await withRoot({ ok: true, cwd: fromDisk }, fromDisk)
      if (liveMissing) return { ok: false, error: '找不到这个会话', kind: 'not-found' }
      return { ok: false, error: '会话无 cwd 信息', kind: 'no-cwd' }
  }
  // 顺手把「这个会话的工作区根」也带回给客户端（2026-09-19 加，维护者报「面板打开后几十秒才出现归属标志」）。
  //   为什么加在这里：面板头部那枚归属标志只要工作区根这一个值，原先却只能等一整份仓库快照（含全部票与地图）
  //   拿回来才画得出来，缓存没命中时就是几十秒。而工作区根是一条很便宜的信息，这条电话（wf.cwd）在面板打开时
  //   本来就会被调用，顺路带回来客户端几百毫秒内就有根了，与快照什么时候到无关。
  //   取法与快照里那个 workspaceRoot 完全同一把尺子（canonicalKey）：同源才不会出现「两处算出两个根」。
  //   失败一律只当「这次没带这个值」：这条电话原本只答 cwd，不能因为算根出问题就把它的行为改坏。
  //   （这里不记日志：算根失败是个安静的可选增强，这条电话本身的成败已经由 host.call / host.call.fail 记着了。）
  async function withRoot(res, rawCwd) {
    try {
      if (typeof canonicalKey !== 'function') return res
      const root = await canonicalKey(rawCwd)
      if (typeof root === 'string' && root) res.workspaceRoot = root
    } catch (e) {}
    return res
  }
  // 两处前奏的同一判据收敛：显式绑定优先，否则实时探测。快照与刷新经显式参数复用本函数，不各留一份拷贝。
  async function selectEarly(selCtx) {
    const cwd = selCtx.cwd
    const backendId = selCtx.backendId
    let sel = null
    try {
      const svc = await getDetectionService()
      if (svc && typeof svc.detect === 'function') {
        const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: backendId, baseRev: (selCtx && Number.isInteger(selCtx.baseRev)) ? selCtx.baseRev : 0 })
        if (det && det.selection) sel = det.selection
      }
    } catch {}
    if (!sel || (sel.backendId == null && (!sel.source || sel.source !== 'explicit'))) {
      try {
        const regTmp = await getTrackerRegistry()
        const tmpHandle = { cwd }
        const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'snapshot-early' }
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
  function phoneLog(method, kind, t0, res, err) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && (res.error || res.errorKind)) || 'cwd-not-ok')) }) } catch (eL) {} }
  function loggedPhone(method, kind, fn) { return async function () { const t0 = Date.now(); try { const r = await fn.apply(null, arguments); phoneLog(method, kind, t0, r); return r } catch (e) { phoneLog(method, kind, t0, null, e); throw e } } }
  return { handlePing: handlePing, handleCwd: loggedPhone('wf.cwd', 'cwd', handleCwd), selectEarly: selectEarly, isComposerSelection: isComposerSelection }
}
