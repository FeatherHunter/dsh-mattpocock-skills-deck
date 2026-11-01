// views/versionControl/vcRemoteData.ts —— 远端与同步页的数据层（#1754 T18，域 8 的 8.1–8.4）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这一页有两种读数，绝不许混成一份：
//   ① 本地读数：git remote -v 加本地跟踪分支（git for-each-ref refs/remotes/<name>/），不联网；
//      界面必须写「这是本地记录」与读取时刻，不能让人当成刚从远端问回来的。
//   ② 联网读数：只有用户显式点「联网查看」才发 git ls-remote（ADR 20261031 第 6 节），
//      结果标来源 network 与这一次的读取时刻；打开页面、切页签、定时刷新都不自动走。
// 失败与截断都不给半份：联网失败/输出被截断时引用清单保持为空，只画失败分类与下一步。
// 刷新失败保留上一次的读数继续画（与 vcFirstScreen.ts 的约定一致），旧读数会在界面上标出来。
//
// 六条电话名是页面与宿主唯一对得上的接头：宿主在 src/host/versionControlRemote.ts 登记同名电话，
//   门禁拿这一份名单逐个对账（本文件不另写第二份字符串）。
// 限频（同一远端同一时刻只飞一个请求、不排队、不自动重试）在宿主那一层做，客户端只负责「不重复发」：
//   联网入口只在用户点它时调用一次 vcReadRemoteOnline，渲染函数本身不发任何请求。
//
// 日志设施（log / dswsLogHash / dswsLogTrunc）由 src/client/ts-pixel-ambient.d.ts 全局声明。

/** 六条电话的真实名字（列表 / 登记 / 改名 / 删除 / 改地址 / 联网查看）。 */
export const VC_REMOTE_PHONES: Record<string, string> = {
  list: 'wf.gitRemoteList',
  add: 'wf.gitRemoteAdd',
  rename: 'wf.gitRemoteRename',
  remove: 'wf.gitRemoteRemove',
  setUrl: 'wf.gitRemoteSetUrl',
  online: 'wf.gitRemoteOnline',
}
/** 三条写动作的电话名（界面按动作名取值，避免把字符串散落在画法里）。 */
export const VC_REMOTE_WRITE_PHONES: Record<string, string> = {
  add: VC_REMOTE_PHONES.add,
  rename: VC_REMOTE_PHONES.rename,
  remove: VC_REMOTE_PHONES.remove,
  setUrl: VC_REMOTE_PHONES.setUrl,
}
/** 写动作与确认卡能用到的三种表单形态；按页面壳那一份（VC_SHELL_FORMS）取，不另抄一份写法。 */
declare const VC_SHELL_FORMS: string[]
export const VC_REMOTE_FORMS: string[] = VC_SHELL_FORMS.slice()
/** 联网失败的分类（与宿主 / 共享层 classifyLsRemoteFailure 的 kind 一一对应）。 */
export const VC_REMOTE_ONLINE_FAIL_KINDS: string[] = ['timeout', 'needs-credential', 'no-network', 'remote-missing', 'truncated', 'other']

/** 一份全新的远端读数（面板刚打开、本地列表还没读、也还没有任何联网结果）。 */
export const vcNewRemoteReads = function () {
  return {
    remote: { state: 'idle', data: null, error: null },
    online: { state: 'idle', name: '', data: null, error: null },
  }
}
/** 落一行电话日志；日志设施缺席时静默跳过，绝不影响已经要回给界面的读数。 */
const vcRmOkLog = function (method: any, kind: any, t0: any) {
  try { log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) } catch (e) { /* 日志坏了不影响读数 */ }
}
const vcRmFailLog = function (method: any, kind: any, t0: any, fail: any) {
  try { log('warn', 'host.call.fail', { method: method, kind: kind, errorHash: dswsLogHash(dswsLogTrunc(String((fail && fail.kind) || '') + ' ' + String((fail && fail.message) || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响读数 */ }
}
/** 把一份回包归一成失败：带 error 的信封按信封走，其余（含 ok:true 却缺字段）一律记 shape。 */
const vcRmFailureOf = function (reply: any) {
  if (reply && reply.ok === false) {
    const e = reply.error || {}
    return { kind: String(e.kind || 'unknown'), reason: String(e.reason || e.kind || 'unknown'), message: String(e.message || ''), hint: String(e.hint || '') }
  }
  return { kind: 'shape', reason: 'shape', message: '', hint: '' }
}
/** 本地列表回包的形状判据：来源必须是 local、读取时刻是数字、远端是数组；缺一样就按失败处理。 */
const vcRmLocalShapeOk = function (data: any) {
  if (!data || data.source !== 'local') return false
  if (typeof data.readAtMs !== 'number' || !isFinite(data.readAtMs)) return false
  return Array.isArray(data.remotes)
}
/** 联网结果回包的形状判据：来源必须是 network、引用是数组、读取时刻是数字，截断的一律不算成功。 */
const vcRmOnlineShapeOk = function (data: any) {
  if (!data || data.source !== 'network') return false
  if (typeof data.readAtMs !== 'number' || !isFinite(data.readAtMs)) return false
  if (data.truncated === true) return false
  return Array.isArray(data.refs)
}

/** 本地读数的三态（ok / loading / err / idle 原样给出；界面自己决定怎么画）。 */
export const vcRemoteStateOf = function (reads: any) {
  const r = reads && reads.remote
  return r && typeof r.state === 'string' ? r.state : 'idle'
}
/** 本地读数的读取时刻（毫秒；没有本地读数回 null）。 */
export const vcRemoteReadAtOf = function (reads: any) {
  const r = reads && reads.remote
  const data = r && r.data
  return data && typeof data.readAtMs === 'number' ? data.readAtMs : null
}
/** 本地读数里的远端数组（读失败时仍是上一次的列表，不从空表猜）。 */
export const vcRemoteRemotesOf = function (reads: any) {
  const r = reads && reads.remote
  const data = r && r.data
  return data && Array.isArray(data.remotes) ? data.remotes : []
}
/** 本地读失败的原因（不是 err 时回 null）。 */
export const vcRemoteErrorOf = function (reads: any) {
  const r = reads && reads.remote
  return r && r.state === 'err' ? r.error : null
}
/** 联网读数的三态（idle / loading / ok / err）。 */
export const vcRemoteOnlineStateOf = function (reads: any) {
  const r = reads && reads.online
  return r && typeof r.state === 'string' ? r.state : 'idle'
}
/** 这一次联网读的是哪个远端（还没联网时是空串）。 */
export const vcRemoteOnlineNameOf = function (reads: any) {
  const r = reads && reads.online
  return r && typeof r.name === 'string' ? r.name : ''
}
/** 联网读成功的那份结果（没成功回 null；截断的回包不算成功）。 */
export const vcRemoteOnlineOf = function (reads: any) {
  const r = reads && reads.online
  if (!r || r.state !== 'ok' || !vcRmOnlineShapeOk(r.data)) return null
  return r.data
}
/** 联网读失败的原因（不是 err 时回 null）。 */
export const vcRemoteOnlineErrorOf = function (reads: any) {
  const r = reads && reads.online
  return r && r.state === 'err' ? r.error : null
}
const vcRmMerge = function (reads: any, key: any, next: any) {
  const base = reads || vcNewRemoteReads()
  const patch: any = {}
  patch[key] = next
  return Object.assign({}, base, patch)
}
/**
 * 把一份回包落成读数。kind = 'remote'（本地列表）或 'online'（联网查看）。
 * 成功换掉对应槽；失败只记失败并保留上一次的数据（界面会标成旧读数，不拿半份冒充新读数）。
 */
export const vcApplyRemoteReply = function (reads: any, kind: any, reply: any) {
  const which = String(kind) === 'online' ? 'online' : 'remote'
  const prev = (reads && reads[which]) || {}
  if (which === 'remote') {
    if (reply && reply.ok === true && vcRmLocalShapeOk(reply)) {
      return vcRmMerge(reads, 'remote', { state: 'ok', data: { source: 'local', readAtMs: reply.readAtMs, remotes: reply.remotes }, error: null })
    }
    const fail = vcRmFailureOf(reply)
    return vcRmMerge(reads, 'remote', { state: 'err', data: prev.data || null, error: fail })
  }
  const name = String((reply && (reply.remoteName || (reply.error && reply.error.remote))) || prev.name || '')
  if (reply && reply.ok === true && vcRmOnlineShapeOk(reply)) {
    const data = { source: 'network', remoteName: String(reply.remoteName || name), refs: reply.refs, count: typeof reply.count === 'number' ? reply.count : reply.refs.length, readAtMs: reply.readAtMs, truncated: false }
    return vcRmMerge(reads, 'online', { state: 'ok', name: data.remoteName, data: data, error: null })
  }
  // 联网失败与截断都不给半份：数据槽清空，只留失败分类与下一步。
  return vcRmMerge(reads, 'online', { state: 'err', name: name, data: null, error: vcRmFailureOf(reply) })
}
/**
 * 读一次本地远端列表（不联网）。
 * 先切到加载态并保留旧数据，回包到了再落读数；失败时旧列表继续画（界面会标旧读数）。
 */
export const vcReadRemoteList = function (reads: any, call: any, cwd: any) {
  const base = reads || vcNewRemoteReads()
  const prev = base.remote || { state: 'idle', data: null, error: null }
  const loading = vcRmMerge(base, 'remote', { state: 'loading', data: prev.data || null, error: null })
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_REMOTE_PHONES.list, { cwd: String(cwd || '') }) })
    .then(function (reply: any) {
      if (reply && reply.ok === true && vcRmLocalShapeOk(reply)) vcRmOkLog(VC_REMOTE_PHONES.list, 'git-remote-list', t0)
      else vcRmFailLog(VC_REMOTE_PHONES.list, 'git-remote-list', t0, vcRmFailureOf(reply))
      return vcApplyRemoteReply(loading, 'remote', reply)
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcRmFailLog(VC_REMOTE_PHONES.list, 'git-remote-list', t0, fail)
      return vcRmMerge(loading, 'remote', { state: 'err', data: prev.data || null, error: fail })
    })
}
/**
 * 联网查看一个远端的引用（唯一一条会联网的路径；只由用户点「联网查看」触发）。
 * 进加载态时清空上一次的引用清单 —— 不拿上一次结果冒充这一次。
 */
export const vcReadRemoteOnline = function (reads: any, call: any, cwd: any, name: any, refs: any) {
  const base = reads || vcNewRemoteReads()
  const remoteName = String(name || '')
  const selectors = Array.isArray(refs) ? refs.map(function (r: any) { return String(r) }) : []
  const loading = vcRmMerge(base, 'online', { state: 'loading', name: remoteName, data: null, error: null })
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_REMOTE_PHONES.online, { cwd: String(cwd || ''), name: remoteName, refs: selectors }) })
    .then(function (reply: any) {
      if (reply && reply.ok === true && vcRmOnlineShapeOk(reply)) vcRmOkLog(VC_REMOTE_PHONES.online, 'git-remote-online', t0)
      else vcRmFailLog(VC_REMOTE_PHONES.online, 'git-remote-online', t0, vcRmFailureOf(reply))
      return vcApplyRemoteReply(loading, 'online', reply)
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcRmFailLog(VC_REMOTE_PHONES.online, 'git-remote-online', t0, fail)
      return vcRmMerge(loading, 'online', { state: 'err', name: remoteName, data: null, error: fail })
    })
}
/**
 * 发一条写动作电话（登记 / 改名 / 删除 / 改地址），把回包原样交给界面并落日志。
 * 写回包只报「动作成没成、作用对象是谁」，不回整份远端记录，所以这里不自己拼一份列表：
 * 动作成功后由调用方紧接着调 vcReadRemoteList 重读，界面画「列表正在重读」。
 */
export const vcRunRemoteWrite = function (reads: any, call: any, phone: any, args: any) {
  const base = reads || vcNewRemoteReads()
  const method = String(phone || '')
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(method, args || {}) })
    .then(function (reply: any) {
      if (reply && reply.ok === true) vcRmOkLog(method, 'git-remote-write', t0)
      else vcRmFailLog(method, 'git-remote-write', t0, vcRmFailureOf(reply))
      return { reads: base, reply: reply }
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcRmFailLog(method, 'git-remote-write', t0, fail)
      return { reads: base, reply: { ok: false, error: fail } }
    })
}
