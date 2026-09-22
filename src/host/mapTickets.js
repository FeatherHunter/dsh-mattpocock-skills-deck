// src/host/mapTickets.js —— 宿主电话 wf.mapTickets：按需取一张地图的全部子票（#691 阶段 3）。
//
// 为什么会有这条电话：快照首屏不再装**已关闭地图**的子票（见 tracker/snapshot.js 的 assembleSnapshot），
// 用户点开一张地图时由这条电话现去后端把那张地图的子票一次拉全（开放与已关闭都在）。开放地图点开时
// 也走同一条路 —— 首屏那份行数据可能被列表的 500 条上限截断，而这条路是按「父票 → 子票」的原生关系
// 翻页拉到底，能保证「打开一张地图看到的就是它的全部子票」。
//
// 这条电话在宿主侧还做三件事（都是界面拿不到的信息）：
//   1. 调后端的 listSubIssues（读路径的旁路方法，不进契约的 OPERATIONS；没实现它的后端回 unsupported，
//      由界面退回快照里那份行数据 —— 不做能力表，这是 G5 红线）；
//   2. 把子票正文里的「## 进度：N%」解析成数字带上，正文本身剥掉 —— 正文不随行数据发给界面；
//   3. 补上客户端要的两样：`number`（后端只给 key）与**大写的** `state`（客户端多处按 'CLOSED' 比较）。
//
// 接线的纪律：本文件由 index.js 动态 import 加载（D7：新文件不静态 import）；依赖全部由 index 显式传入；
// 本文件不引用其他新文件。日志沿用既有的 host.call / host.call.fail 两个事件（不新增事件名）。
export function createMapTickets(deps) {
  const { canonicalKey, selectEarly, isComposerSelection, getTrackerRegistry, getPlatform, ctx, DEFAULT_CWD, logCtx, groupTickets, getMapBody, detectionExec } = deps

  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function phoneLog(method, kind, t0, res, err) { try {
    if (err !== undefined && err !== null) { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((err && err.message) || err)) }) }
    else if (res && res.ok) { if (logCtx) logCtx.fire('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) }
    else if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: method, kind: kind, errorHash: hash8(String((res && ((res.error && res.error.message) || res.error)) || 'map-tickets-not-ok')) }) } catch (eL) {} }

  const unsupported = function (message) { return { ok: false, error: { kind: 'unsupported', message: message } } }

  /**
   * 把后端回来的一行子票收拾成界面直接能画的样子。
   * 口径与快照那条路（sessionSnapshot.js 的组装）保持一致：编号从 key 补、状态转大写、
   * 阻塞引用压成键字符串、认领人从指派人里取第一个；进度从正文解析出来之后，正文与评论都剥掉。
   */
  function prepareRow(raw, parseProgress) {
    const t = Object.assign({}, raw)
    if (t.key != null && t.number == null) { const nn = parseInt(t.key, 10); if (!isNaN(nn)) t.number = nn }
    if (t.key != null) t.key = String(t.key)
    t.state = String(t.state || '').toUpperCase()
    if (Array.isArray(t.blockedBy)) {
      t.blockedBy = t.blockedBy.map(function (ref) {
        if (typeof ref === 'number' || typeof ref === 'string') return ref
        if (ref && typeof ref === 'object' && ref.key != null) return String(ref.key)
        return ref
      })
    } else t.blockedBy = []
    if (t.claimedBy == null) {
      const owners = t.assignees
      t.claimedBy = (Array.isArray(owners) && owners.length) ? ((owners[0] && owners[0].login) || '') : ''
    }
    // 「有读者没来源」的那一个字段（#687 的结论）：界面画进度条要 t.progress，而新路今天一条都没有值。
    // 这里从正文解析，解析不出给 null（= 未表达），界面对 null 画「—」而不是假装 0%。
    const body = typeof t.body === 'string' ? t.body : ''
    t.progress = (typeof parseProgress === 'function') ? parseProgress(body) : null
    delete t.body
    delete t.comments
    return t
  }

  async function handleMapTickets(args) {
    const cwd = await canonicalKey((args && args.cwd) || DEFAULT_CWD)
    const key = String((args && (args.key != null ? args.key : args.number)) || '').trim()
    if (!key) return { ok: false, error: { kind: 'parse', message: '缺少地图编号（key）' } }
    const sel = await selectEarly({ cwd, backendId: (args && args.backendId) || undefined, baseRev: (args && args.baseRev) || 0 })
    if (!isComposerSelection(sel)) return unsupported('这个后端不能按需取一张地图的子票（在它自己的网页上看全部）')
    const reg = await getTrackerRegistry()
    const backendId = sel.backendId
    const tracker = reg.get(backendId)
    if (!tracker || typeof tracker.listSubIssues !== 'function') return unsupported('这个后端不支持按需取一张地图的子票')
    let repoRef = null
    try { repoRef = reg.describe({ cwd }, backendId) } catch (e) { repoRef = null }
    if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
    // effort 维度：地图的身份是 (effortId, key)，同号地图在不同工作单元里是两张 —— 调用方给就带上。
    if (args && args.effortId !== undefined && args.effortId !== null) repoRef = Object.assign({}, repoRef, { effortId: String(args.effortId) })
    const ctx2 = { cwd, platform: await getPlatform(), fs: ctx.get('fs'), exec: function (c, a, o) { return detectionExec(c, a, o, 'map-tickets') } }
    const res = await tracker.listSubIssues(repoRef, key, {}, ctx2)
    if (!res || res.ok !== true) {
      const err = (res && res.error) || { kind: 'network', message: '子票没取回来' }
      return { ok: false, error: err }
    }
    const d = res.data || {}
    const mb = (typeof getMapBody === 'function') ? await getMapBody() : null
    const parseProgress = mb && typeof mb.parseProgress === 'function' ? mb.parseProgress : null
    const items = (Array.isArray(d.items) ? d.items : []).map(function (raw) { return prepareRow(raw, parseProgress) })
    // 分层与统计由宿主算好一起带回去（与快照里 m.stats 同一套纯函数）；界面不自己算层级。
    let stats = { total: items.length, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }
    try { if (typeof groupTickets === 'function') stats = groupTickets(items) } catch (e) {}
    return {
      ok: true,
      key: key,
      items: items,
      stats: stats,
      total: (typeof d.total === 'number') ? d.total : items.length, // 后端说的总数（连接上的 totalCount）
      fetched: (typeof d.fetched === 'number') ? d.fetched : items.length, // 这次真的拉回来的张数
      capped: d.capped === true, // 撞到 1000 张硬上限
      missing: (typeof d.missing === 'number' && d.missing > 0) ? d.missing : 0, // 与总数对不上的差额（0 = 对上了）
    }
  }

  // 电话体记一行日志（与仓库里其它电话同一条纪律：沿用既有事件，电话名写在 method，kind 是归一类别）。
  const handleMapTicketsLogged = async function (args) {
    const t0 = Date.now()
    try { const r = await handleMapTickets(args); phoneLog('wf.mapTickets', 'map-tickets', t0, r); return r } catch (e) { phoneLog('wf.mapTickets', 'map-tickets', t0, null, e); throw e }
  }

  return { handleMapTickets: handleMapTicketsLogged }
}
