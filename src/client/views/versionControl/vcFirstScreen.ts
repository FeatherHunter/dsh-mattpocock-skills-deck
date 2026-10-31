// views/versionControl/vcFirstScreen.ts —— 首屏七片的客户端数据层（#1739 T04）
//
// 契约真源在 src/shared/version-control/src/first-screen.ts（首屏契约名、版本号、七片名单、刷新三时机、
// 形状判据与逐片成败判据都在那一份里）；本文件只做一件事：把一次聚合一电话的来回，落成界面能直接读的
// 「一份版本化快照 + 每片自己的三态」。
//
// 规格 #1586 第 9 节写死的几条，这里逐条对应：
//   ① 一次拿全：本文件只发一个电话（VC_FIRST_SCREEN_PHONE = wf.gitFirstScreen），七片都在这一份回包里；
//      绝不按片再发七枪（门禁断言每次刷新只有一次调用）。
//   ② 各自失败互不影响：宿主回来的快照里每片自带 state；读成功就存整份快照，某片 err 只影响那一片的显示，
//      其余片照常画。整份快照形状不对（契约/版本/片名/片形不对）才整体记失败，绝不拿半份数据冒充成功。
//   ③ 失败项单独显示失败态：vcFirstScreenSliceStateOf / vcFirstScreenFailedSlicesOf 给界面逐片判据。
//   ④ 重试入口：vcRetryFirstScreen（整页重读）与 vcRetryFirstScreenSlice（某片重试）。某片重试也是再发一次
//      聚合一电话 —— 因为七片本就来自同一次调用，没有单独读一片的第二条路（也不许再造一条）。
//   ⑤ 刷新三时机（进入页面、任务完成后、手动刷新）：vcReadFirstScreenOnEnter / vcReadFirstScreenAfterTask /
//      vcReadFirstScreenOnManual 三个入口都只走同一个 vcReadFirstScreen，每条路径一次调用。
//   ⑥ 失败保留旧数据：刷新失败时旧快照留着继续画（和 vcData.ts 的三态约定一致），只在上面加失败提示。
//   ⑦ 契约版本化：界面只认 FIRST_SCREEN_CONTRACT + FIRST_SCREEN_VERSION；版本对不上按 shape 失败处理，
//      不拿旧版本的快照硬画（宁可给「读不到 + 重试」）。
//
// 本文件由 scripts/build.mts 构建时剥行首 export 拼回 src/client/index.ts 的 leaf 标记处；
// 日志设施（log / dswsLogHash / dswsLogTrunc）由 src/client/ts-pixel-ambient.d.ts 全局声明。
// 七片与契约常量来自共享层同一份真源，本文件不另抄一份片名或版本号。
//
// 下面这几行是「编译期声明、运行期由拼接提供」：构建时共享层 first-screen.ts 会拼在本文件之前
// （Lead 统一接线时登记），名字在那时才真实存在；本文件单独过 tsc --noEmit 时看不到全局，
// 用模块作用域的 declare 声明同名形状即可。它们不是第二份实现，转译后整块消失。
declare function firstScreenShapeOk(snapshot: any): boolean
declare function firstScreenSliceOf(snapshot: any, id: any): any
declare function firstScreenFailedSlices(snapshot: any): string[]
declare const FIRST_SCREEN_SLICES: string[]
/** 首屏七片聚合电话的真实名字（调用点与门禁都读这一份）。 */
export const VC_FIRST_SCREEN_PHONE = 'wf.gitFirstScreen'
/** 刷新三时机的人话名（键名与共享层 FIRST_SCREEN_REFRESH_MOMENTS 同一份；值只用于注释与门禁对账）。 */
export const VC_FIRST_SCREEN_REFRESH: Record<string, string> = { enter: '进入页面', 'task-done': '任务完成后', manual: '手动刷新' }
/** 一份全新的首屏读数（面板刚打开、还没打过任何电话的样子）。 */
export const vcNewFirstScreenRead = function () {
  return { state: 'idle', data: null, error: null }
}
/** 落一行电话日志；日志设施缺席时静默跳过，绝不影响已经要回给界面的读数。 */
const vcFsOkLog = function (method: any, kind: any, t0: any) {
  try { log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) } catch (e) { /* 日志坏了不影响读数 */ }
}
const vcFsFailLog = function (method: any, kind: any, t0: any, fail: any) {
  try { log('warn', 'host.call.fail', { method: method, kind: kind, errorHash: dswsLogHash(dswsLogTrunc(String((fail && fail.kind) || '') + ' ' + String((fail && fail.message) || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响读数 */ }
}
/** 把一份回包归一成「失败」：带 error 的信封按信封走，其余（含 ok:true 却缺字段）一律记 shape。 */
const vcFsFailureOf = function (reply: any) {
  if (reply && reply.ok === false) {
    const e = reply.error || {}
    return { kind: String(e.kind || 'unknown'), message: String(e.message || '') }
  }
  return { kind: 'shape', message: '' }
}
/** 整份快照的形状判据：直接借共享层那一份（契约/版本/七片/逐片形状都在那里判）。 */
export const vcFirstScreenShapeOk = function (snapshot: any) {
  try { return firstScreenShapeOk(snapshot) === true } catch (e) { return false }
}
/** 当前读数里的快照（只有整次读成功且形状对才有；否则 null）。 */
export const vcFirstScreenOf = function (reads: any) {
  const r = reads && reads.firstScreen
  if (!r || r.state !== 'ok' || !r.data) return null
  return vcFirstScreenShapeOk(r.data) ? r.data : null
}
/** 整次读的三态（idle / loading / ok / err 之外，界面还能用 slice 版本逐片判）。 */
export const vcFirstScreenStateOf = function (reads: any) {
  const r = reads && reads.firstScreen
  return r && typeof r.state === 'string' ? r.state : 'idle'
}
/** 快照读到的时间（毫秒；没有快照回 null）。刷新提示要用它说「几分钟前读的」。 */
export const vcFirstScreenReadAtOf = function (reads: any) {
  const snapshot = vcFirstScreenOf(reads)
  return snapshot ? snapshot.readAtMs : null
}
/** 某一片在读数为 ok 时的数据；该片 err 或整次读失败时回 null（界面据此画失败态或空态）。 */
export const vcFirstScreenSliceOf = function (reads: any, id: any) {
  const snapshot = vcFirstScreenOf(reads)
  if (!snapshot) return null
  return firstScreenSliceOf(snapshot, id)
}
/**
 * 某一片的状态：ok / err / idle（还没读）/ load-fail（整次读失败、片状态无从得知）。
 * 为什么区分 idle 与 load-fail：刚打开面板和整次调用失败要画不同的话术（前者什么都不画，后者给重试）。
 */
export const vcFirstScreenSliceStateOf = function (reads: any, id: any) {
  const snapshot = vcFirstScreenOf(reads)
  if (snapshot) {
    const slice = firstScreenSliceOf(snapshot, id)
    return slice ? slice.state : 'idle'
  }
  const state = vcFirstScreenStateOf(reads)
  if (state === 'err' || state === 'loading') return 'load-fail'
  return 'idle'
}
/** 某一片的失败原因（该片不是 err 时回 null）。 */
export const vcFirstScreenSliceErrorOf = function (reads: any, id: any) {
  const slice = vcFirstScreenSliceOf(reads, id)
  return slice && slice.state === 'err' ? slice.error : null
}
/** 读失败的那几片（界面逐片画失败态与重试入口就用这一份）。 */
export const vcFirstScreenFailedSlicesOf = function (reads: any) {
  const snapshot = vcFirstScreenOf(reads)
  return snapshot ? firstScreenFailedSlices(snapshot) : []
}
/** 某一片现在能不能重试：该片 err，或者整次读失败；其它情况不画重试入口。 */
export const vcFirstScreenSliceRetryableOf = function (reads: any, id: any) {
  if (String(id || '') !== '' && FIRST_SCREEN_SLICES.indexOf(String(id)) < 0) return false
  return vcFirstScreenSliceStateOf(reads, id) === 'err' || vcFirstScreenSliceStateOf(reads, id) === 'load-fail'
}
/** 把一份首屏读数换成另一份（拿旧的 app 状态出来叠新读数时共用）。 */
const vcFsMerge = function (reads: any, next: any) {
  return Object.assign({}, reads || {}, { firstScreen: next })
}
/**
 * 发一次聚合一电话并把回包落成读数（所有刷新与重试入口都只走这里，保证「一次刷新一次调用」）。
 * 成功：存整份版本化快照；失败：保留旧快照，只记失败。
 */
export const vcReadFirstScreen = function (reads: any, call: any, cwd: any) {
  const base = reads || {}
  const prev = base.firstScreen || vcNewFirstScreenRead()
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_FIRST_SCREEN_PHONE, { cwd: String(cwd || '') }) })
    .then(function (reply: any) {
      if (reply && reply.ok === true && vcFirstScreenShapeOk(reply.firstScreen)) {
        vcFsOkLog(VC_FIRST_SCREEN_PHONE, 'git-first-screen', t0)
        return vcFsMerge(base, { state: 'ok', data: reply.firstScreen, error: null })
      }
      const fail = vcFsFailureOf(reply)
      vcFsFailLog(VC_FIRST_SCREEN_PHONE, 'git-first-screen', t0, fail)
      return vcFsMerge(base, { state: 'err', data: prev.data, error: fail })
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcFsFailLog(VC_FIRST_SCREEN_PHONE, 'git-first-screen', t0, fail)
      return vcFsMerge(base, { state: 'err', data: prev.data, error: fail })
    })
}
/** 进入页面时读一次（刷新时机一；规格第 9 节）。 */
export const vcReadFirstScreenOnEnter = function (reads: any, call: any, cwd: any) {
  return vcReadFirstScreen(reads, call, cwd)
}
/** 任务完成后重读一次（刷新时机二；写操作收尾与「让 AI 帮我解决」回到页面时都走这一条）。 */
export const vcReadFirstScreenAfterTask = function (reads: any, call: any, cwd: any) {
  return vcReadFirstScreen(reads, call, cwd)
}
/** 手动刷新时重读一次（刷新时机三；刷新按钮与快捷键都走这一条）。 */
export const vcReadFirstScreenOnManual = function (reads: any, call: any, cwd: any) {
  return vcReadFirstScreen(reads, call, cwd)
}
/** 整页重试：等于再读一次（失败不阻塞其它片已有数据）。 */
export const vcRetryFirstScreen = function (reads: any, call: any, cwd: any) {
  return vcReadFirstScreen(reads, call, cwd)
}
/**
 * 某一片的重试入口：仍是再发一次聚合一电话（七片同源，没有第二条路）。
 * id 不在七片名单里时直接回原读数、不发电话 —— 界面传错片名不许多打一枪。
 */
export const vcRetryFirstScreenSlice = function (reads: any, call: any, cwd: any, id: any) {
  const key = String(id === null || id === undefined ? '' : id)
  if (FIRST_SCREEN_SLICES.indexOf(key) < 0) return Promise.resolve(reads || {})
  return vcReadFirstScreen(reads, call, cwd)
}
/**
 * 从快照派生既有界面用的 FirstScreen（接线期过渡：VersionControlTab 的老块读 reads.screen，
 * 换成这一份就能「界面只读快照」而不用重画所有块）。四片（工作区/改动/历史/工作树）齐才给；
 * 缺一片就回 null，界面走「读不到 + 重试」，绝不拿残缺数据拼一份假 FirstScreen。
 */
export const vcFirstScreenScreenOf = function (reads: any) {
  const snapshot = vcFirstScreenOf(reads)
  if (!snapshot) return null
  const need = ['workspace', 'changes', 'history', 'worktrees']
  for (let i = 0; i < need.length; i += 1) {
    const slice = firstScreenSliceOf(snapshot, need[i])
    if (!slice || slice.state !== 'ok') return null
  }
  const ws = snapshot.slices.workspace.data
  const ch = snapshot.slices.changes.data
  const hi = snapshot.slices.history.data
  const wt = snapshot.slices.worktrees.data
  return {
    identity: ws.identity, staged: ch.staged, unstaged: ch.unstaged,
    stagedCount: ch.stagedCount, unstagedCount: ch.unstagedCount, conflictCount: ch.conflictCount,
    otherWorktrees: wt.others, branches: ws.branches, commits: hi.commits, repo: ws.repo,
  }
}
