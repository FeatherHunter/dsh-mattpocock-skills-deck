/**
 * kernel/work-route-own.ts — #1355 / #1436：每个会话自己的工作路线读数（剥表、首帧只读补拉、三处接线共用的决策）
 * 背景：快照按工作区共享，但 workRouteTable 里每行「是不是本会话」的标记，是按请求它的那个会话算出来的。
 *   表跟着共享缓存或扇出交给别的会话，对方就会把别人的行当成自己的行，胶囊上显示的就是别人的工作路线。
 *   #1436 之前缺表只能发一次强制整份刷新（wf.refresh，真机中位 25 秒），重建回来之前胶囊那一段一直空白。
 *   现在首帧改走宿主只读电话 wf.workRoute：直接读本机 work-path 存档，不为了一张名单去重建整份快照。
 * 这一片只放四件与「读数是谁的」有关的事：
 *   ① 交给别人之前把表剥掉（snapshotWithoutWorkRoute）；
 *   ② 首帧 / 挂载 / 切会话时读一次自己的（loadOwnWorkRoute），读的过程中画「读取中」；读失败不打扰用户，
 *      自己再试两次，仍不成就不显示失败（旧路有数据就继续用旧的，下次打开再试）；
 *   ③ 304 回包捎来的新表能不能挂上去（adoptWorkRouteTableIfNewer）；
 *   ④ 三处接线共用「这一下要不要请求快照」的决策（snapshotRequestPlan，以及按决策真正发出去的 runSnapshotRequestPlan）。
 * 为什么单独一片：store-snapshot.ts 从 #707 起就贴着 350 行上限，这几件再塞进去会超。
 * 契约同其它 kernel 叶子：本片由 scripts/build.mts 拼回 src/client/index.ts；运行时不要 import 别的叶子，
 *   跨文件名字一律在下面用 ambient declare 声明（构建转译时整段抹掉，运行时一字不差）。
 */
// 本片用到的、住在别的叶子里的东西（拼成同一个闭包后才存在，故只声明形状）。
declare const host: any;
declare function log(...args: any[]): any;
declare function emit(...args: any[]): any;
// 失败重试的两档等待来自中央时间参数（config/intervals.yaml 的 ownRouteRetryMs）：
// 构建拼接时这一行会被剥掉，名字由闭包里的 timeConfig 片提供；门禁 CLIENTS 表与此处双向对账。
import { OWN_ROUTE_RETRY_MS } from '../../shared/time-config/src/values.js'

// #1355 · 把一份快照交给「别的会话」之前剥掉工作路线读数：表是按请求它的那个会话算的（每行是否本会话），
//   跟着快照走就会让接收方把别人的行当自己的。返回浅拷贝，不改调用方那一份（它可能正是首发会话手上那份）。
export const snapshotWithoutWorkRoute = function (snap: any): any {
  try {
    if (!snap || typeof snap !== 'object' || snap.workRouteTable === undefined) return snap
    const copy: any = Object.assign({}, snap)
    delete copy.workRouteTable
    return copy
  } catch (e) { return snap }
}

// #1436 · 首帧只读自己那份工作路线（不改快照、不触发整份重建）。
//   键用「会话号 + 工作区目录」两样一起记：换会话或换目录之后，飞在路上的旧回包一律按这个键丢掉，
//   否则慢一点的那份回包会把新会话的胶囊写成上一个会话的记录（串会话）。
export const ownWorkRouteKeyOf = function (st: any): string {
  try {
    if (!st || typeof st !== 'object') return ''
    const sid = st.sessionId ? String(st.sessionId) : ''
    const cwd = st.cwd ? String(st.cwd) : ''
    if (!sid || !cwd) return ''
    return sid + '|' + cwd
  } catch (e) { return '' }
}

// #1436 · 取当前键对应的那一格；键对不上（会话/目录换了）就当没有，调用方退回去看快照里那张表。
export const ownWorkRouteSlotOf = function (st: any): any {
  try {
    const key = ownWorkRouteKeyOf(st)
    if (!key) return null
    const slot = st.ownWorkRoute
    if (!slot || typeof slot !== 'object' || slot.key !== key) return null
    return slot
  } catch (e) { return null }
}

// 失败后自己再试的两次等待（毫秒）：第一次 1.2 秒后再试，第二次 2.5 秒后再试。
//   为什么不让用户点：读的是本机一份存档，失败几乎都是「晚一点文件就能读」这类瞬时原因，把重试做成按钮
//   等于把我们自己的重活推给用户；两次都不成就安静停手（库存在旧路上继续显示旧表），下次打开/切会话自然再试。
//   两档数值的真源是 config/intervals.yaml 的 ownRouteRetryMs（本文件顶部已从中央时间参数引入）。

/** #1436 · 错误归类用的短散列（5381）：日志只记散列，不把报错原文写进常驻日志。 */
const ownRouteHash8 = function (s: any): string {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

// 读失败：落一行日志（只记散列），还在重试窗口里就保持「读取中」并排下一次；窗口用完就标 off——
//   off 的意思是「这条便宜的读法暂时不可用」，界面据此安静退回旧路，不画红叉、不给按钮。
//   上一格读到过的旧表要留着（重读失败不该把已经显示出来的内容擦掉）。
const ownRouteFail = function (st: any, key: string, attempt: number, reason: any): void {
  try {
    const slot = ownWorkRouteSlotOf(st)
    const raw = (slot && slot.raw) ? slot.raw : null
    // 宿主是旧版本（不认这条电话）时重试永远不会成功：直接标 off 走旧路，不在后台空转。
    const permanent = String(reason || '') === 'host.work-route.unknown-endpoint'
    const wait = permanent ? undefined : OWN_ROUTE_RETRY_MS[attempt - 1]
    st.ownWorkRoute = {
      key: key, state: wait ? 'loading' : 'off', reason: String(reason || ''),
      at: (slot && slot.at) ? slot.at : '', tries: attempt, raw: raw,
    }
    // 宿主明确拒答（回包 ok:false）与「读存档那一步失败」是两种故障：前者可能整条电话没装上，后者是读文件没读成。
    const kind = permanent ? 'unknown-endpoint' : (String(reason || '') === 'host.work-route.rejected' ? 'rejected' : 'read-failed')
    try { log('warn', 'host.call.fail', { method: 'wf.workRoute', kind: 'work-route', errorHash: ownRouteHash8(reason), errorKind: kind }) } catch (eL) {}
    try { emit(st) } catch (eE) {}
    if (!wait) return
    st._ownRouteTimer = setTimeout(function () {
      st._ownRouteTimer = null
      if (ownWorkRouteKeyOf(st) !== key) return
      loadOwnWorkRoute(st, null)
    }, wait)
  } catch (e) {}
}

// #1436 · 读一次自己的那份工作路线。同一份键在途时只认第一发（_ownRouteInFlight 去重）；
//   先摆一格 loading 再发请求，这样界面从第一帧就有反馈（转圈），不会先空白很久再突然出现。
export const loadOwnWorkRoute = function (st: any, opts: any): void {
  try {
    const key = ownWorkRouteKeyOf(st)
    if (!key) return
    if (st._ownRouteInFlight === key) return
    const prev = ownWorkRouteSlotOf(st)
    const reset = !!(opts && opts.reset)
    const tries = (reset || !prev) ? 0 : (typeof prev.tries === 'number' ? prev.tries : 0)
    if (st._ownRouteTimer) { try { clearTimeout(st._ownRouteTimer) } catch (eT) {} st._ownRouteTimer = null }
    st._ownRouteInFlight = key
    // 上一格已经读到过表时把旧表留在格子里：重读期间界面先照旧显示上一份（旧总比空白强），读到新的再换。
    st.ownWorkRoute = {
      key: key, state: 'loading', reason: '', at: (prev && prev.at) ? prev.at : '',
      tries: tries, raw: (prev && prev.raw) ? prev.raw : null,
    }
    try { emit(st) } catch (eE) {}
    const t0 = Date.now()
    let p: any
    try { p = host.call('wf.workRoute', { sessionId: st.sessionId, cwd: st.cwd }) } catch (eC) { p = Promise.reject(eC) }
    Promise.resolve(p).then(function (res: any) {
      const ok = !!(res && res.ok === true)
      // 宿主端点表里没有这条电话（版本错位）时，回话是 ok:false + unknown endpoint；这一档与「读存档失败」
      // 的处置完全不同（前者重试无意义），所以要在日志里分开记，并让这次读取直接停手。
      const msg = String((res && res.error && res.error.message) || '')
      const noPhone = !ok && /unknown endpoint/i.test(msg)
      const raw = (res && res.workRouteTable && typeof res.workRouteTable === 'object') ? res.workRouteTable : null
      const tableReason = ok ? ((raw && raw.ok === true) ? 'ready' : ((raw && raw.reason) || 'host.work-route.read-failed')) : (noPhone ? 'host.work-route.unknown-endpoint' : 'host.work-route.rejected')
      try {
        if (ok) log('info', 'host.call', { method: 'wf.workRoute', kind: 'work-route', latencyMs: Date.now() - t0, ok: true, reason: tableReason })
        else log('warn', 'host.call.fail', { method: 'wf.workRoute', kind: 'work-route', errorHash: ownRouteHash8(tableReason), errorKind: noPhone ? 'unknown-endpoint' : 'rejected' })
      } catch (eL) {}
      if (ownWorkRouteKeyOf(st) !== key) return
      st._ownRouteInFlight = ''
      if (ok && raw && raw.ok === true) {
        st.ownWorkRoute = {
          key: key, state: 'ready', reason: '',
          at: (raw.readout && typeof raw.readout.at === 'string') ? raw.readout.at : '',
          tries: 0, raw: raw,
        }
        try { emit(st) } catch (eE2) {}
        return
      }
      ownRouteFail(st, key, tries + 1, tableReason)
    }).catch(function (e: any) {
      try { log('warn', 'host.call.fail', { method: 'wf.workRoute', kind: 'work-route', errorHash: ownRouteHash8((e && e.message) || e), errorKind: 'exception' }) } catch (eL2) {}
      if (ownWorkRouteKeyOf(st) !== key) return
      st._ownRouteInFlight = ''
      ownRouteFail(st, key, tries + 1, 'wf.workRoute-rejected')
    })
  } catch (e) {}
}

// #1373 · 304 回包捎来的新表能不能挂上去，只这一处说了算。正常那一路（probe-snapshot 的 304 分支）
//   与迟到那一路（probe-select 迟到的非正文分支）都调它：两处各写一遍的话，「什么算更新」迟早长岔。
//   规则：只收 ok:true 的那一份 —— 本地没表时也不能见啥收啥（#1440：宿主拿不到工作区根时会挂一张
//   {ok:false} 的坏读数，收下它就等于把「还没读到」换成「读不出来」，面板从此画坏表、而且不会自愈）；
//   本地有表时，本地坏了、或来者 readout.at 更新才换 —— 同旧、更旧、坏读数一律不换，不拿坏的顶掉好的。
//   为什么看 readout.at：宿主每次回包都是按请求那一刻现读账本现算的，at 就是那次读账本的时间，
//   来者比本地新，当且仅当它读到的账本比本地晚。换表不原地改旧快照（旧对象可能还被别处拿着）。
export const adoptWorkRouteTableIfNewer = function (st: any, snap: any): boolean {
  try {
    if (!snap || typeof snap !== 'object' || snap.workRouteTable === undefined || snap.workRouteTable === null) return false
    if (!st || typeof st !== 'object' || !st.snapshot || typeof st.snapshot !== 'object') return false
    const incoming: any = snap.workRouteTable
    const local: any = st.snapshot.workRouteTable
    if (local === undefined || local === null) {
      // 本地缺表：只收好读数。坏读数不挂上去 —— 缺表是「还没读到」，坏读数一旦挂上就变成
      // 「读不出来」，面板会画坏表，而且要等下一次带 at 的读数来了才能翻回来。
      if (!incoming || typeof incoming !== 'object' || incoming.ok !== true) return false
      st.snapshot = Object.assign({}, st.snapshot, { workRouteTable: incoming })
      return true
    }
    if (!incoming || typeof incoming !== 'object' || incoming.ok !== true) return false
    if (!local || typeof local !== 'object' || local.ok !== true) {
      st.snapshot = Object.assign({}, st.snapshot, { workRouteTable: incoming })
      return true
    }
    const inAt: any = (incoming.readout && typeof incoming.readout.at === 'string') ? Date.parse(incoming.readout.at) : NaN
    const localAt: any = (local.readout && typeof local.readout.at === 'string') ? Date.parse(local.readout.at) : NaN
    if (!isFinite(inAt) || !isFinite(localAt) || !(inAt > localAt)) return false
    st.snapshot = Object.assign({}, st.snapshot, { workRouteTable: incoming })
    return true
  } catch (e) { return false }
}

// #1355 · 三处接线（换目录、挂载、切会话）共用这一个决策，免得同一个判断散落三处后改漏一处。
//   mode：apply=换目录/摘要目录变化，mount=组件挂载，switch=切会话。返回 null 表示这次不发请求；
//   否则给 loadSnapshot 的 force/silent/why。
//   #1436 起这里不再承担「缺表就强制整份刷新」：缺表由 loadOwnWorkRoute 那条只读电话负责，
//   快照只按自己的新鲜度走，旧那支 25 秒重建不会再因为一张名单被触发。
export const snapshotRequestPlan = function (st: any, hydrated: any, mode: any, fresh: any): any {
  try {
    if (mode === 'switch') return null
    if (hydrated && fresh) return null
    return { force: false, silent: mode === 'mount' ? true : !!hydrated, why: undefined }
  } catch (e) { return null }
}
// #1355 · 按上面的决策真正发一次请求：判断只住 snapshotRequestPlan，接线处把各自己的 loadSnapshot 传进来。
//   返回这次发没发（true=发了请求），门禁与调用方都能据此确认「没有重复发」。
export const runSnapshotRequestPlan = function (st: any, hydrated: any, mode: any, fresh: any, load: any): boolean {
  try {
    const plan: any = snapshotRequestPlan(st, hydrated, mode, fresh)
    if (!plan) return false
    if (typeof load === 'function') load(st, plan.force, plan.silent, plan.why)
    return true
  } catch (e) { return false }
}
