/**
 * kernel/work-route-own.ts — #1355：每个会话自己的工作路线读数（剥表、补拉、三处接线共用的决策）
 * 背景：快照按工作区共享，但 workRouteTable 里每行「是不是本会话」的标记，是按请求它的那个会话算出来的。
 *   表跟着共享缓存或扇出交给别的会话，对方就会把别人的行当成自己的行，胶囊上显示的就是别人的工作路线。
 *   这一片只放三件与「读数是谁的」有关的判断：
 *   ① 交给别人之前把表剥掉（snapshotWithoutWorkRoute）；
 *   ② 拿到别人的读数后，给正在被看的 store 补一次带自己会话号的请求（ensureOwnWorkRoute）；
 *   ③ 换目录、挂载、切会话三处接线共用「这一下要不要请求」的决策（snapshotRequestPlan），以及按决策真正发出去的
 *      那一行（runSnapshotRequestPlan）——判断只留一份，接线处各一行，免得以后改漏一处。
 * 为什么单独一片：store-snapshot.ts 从 #707 起就贴着 350 行上限，这三件再塞进去会超。
 * 契约同其它 kernel 叶子：本片由 scripts/build.mts 拼回 src/client/index.ts；运行时不要 import 别的叶子，
 *   跨文件名字一律在下面用 ambient declare 声明（构建转译时整段抹掉，运行时一字不差）。
 */
// 本片用到的、住在别的叶子里的函数（拼成同一个闭包后才存在，故只声明形状）。
declare function snapNeedsOwnWorkRoute(st: any): boolean;

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
// #1355 · 扇出/继承之后，接收会话手上是别人的读数（已剥表）。给正在被看的 store 补一次带自己会话号的强制刷新；
//   同一个快照对象只补一次（_workRoutePulledFor），失败也等下一份快照再试，不在同一份失败回包上反复发请求。
export const ensureOwnWorkRoute = function (st: any, load: any): void {
  try {
    if (!snapNeedsOwnWorkRoute(st)) return
    if (!st || st._workRoutePulledFor === st.snapshot) return
    st._workRoutePulledFor = st.snapshot
    if (typeof load === 'function') load(st, true, true, 'work-route-missing')
  } catch (e) {}
}
// #1373 · 304 回包捎来的新表能不能挂上去，只这一处说了算。正常那一路（probe-snapshot 的 304 分支）
//   与迟到那一路（probe-select 迟到的非正文分支）都调它：两处各写一遍的话，「什么算更新」迟早长岔。
//   规则：本地没表照旧收（#1355 的老行为）；本地有表时，只收 ok:true 的那一份，且本地坏了、
//   或来者 readout.at 更新才换 —— 同旧、更旧、坏读数一律不换，不拿坏的顶掉好的。
//   为什么看 readout.at：宿主每次回包都是按请求那一刻现读账本现算的，at 就是那次读账本的时间，
//   来者比本地新，当且仅当它读到的账本比本地晚。换表不原地改旧快照（旧对象可能还被别处拿着）。
export const adoptWorkRouteTableIfNewer = function (st: any, snap: any): boolean {
  try {
    if (!snap || typeof snap !== 'object' || snap.workRouteTable === undefined || snap.workRouteTable === null) return false
    if (!st || typeof st !== 'object' || !st.snapshot || typeof st.snapshot !== 'object') return false
    const incoming: any = snap.workRouteTable
    const local: any = st.snapshot.workRouteTable
    if (local === undefined || local === null) {
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
//   否则给 loadSnapshot 的 force/silent/why（缺表补拉一律强制且静默，why 进日志原因格）。
export const snapshotRequestPlan = function (st: any, hydrated: any, mode: any, fresh: any): any {
  try {
    if (snapNeedsOwnWorkRoute(st)) return { force: true, silent: true, why: 'work-route-missing' }
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
