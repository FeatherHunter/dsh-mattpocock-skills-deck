// views/versionControl/vcSyncData.ts —— 同步十个动作的数据层（#1755 T19，域 8 的 8.5–8.14）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 这里只做三件事：登记两条电话名、把宿主回包归一成读数、把用户操作变成一次调用。
// 界面（vcSyncPage.ts）只读读数、只画按钮，不发任何请求；打开页面不会自动预检、不会自动联网。
// 两条电话与宿主入口注册、门禁断言必须逐字一致：
//   wf.gitSyncCheck = 预检（读现场 + 强推时 ls-remote 读租约基准 + 签 120 秒票）
//   wf.gitSyncWrite = 凭票执行（只把动作交给长任务通道，不在这里起进程）
// 读数两个槽：sync 槽放预检回包（data / error），task 槽放执行回包里的任务摘要；
// 失败时保留上一份 data（不把旧结论当新结论，界面按 error 画失败态）。
declare const dswsLogHash: any
declare const dswsLogTrunc: any

export const VC_SYNC_PHONES: Record<string, string> = {
  check: 'wf.gitSyncCheck',
  write: 'wf.gitSyncWrite'
}

// 十个动作的 id 与名称键。id 与能力账本 8.5–8.14 逐条一致，界面按这个顺序排。
export const VC_SYNC_ACTION_ROWS: any[] = [
  { id: '8.5', action: 'fetch', labelKey: 'vc.sync.action.fetch' },
  { id: '8.6', action: 'pull-merge', labelKey: 'vc.sync.action.pullMerge' },
  { id: '8.7', action: 'pull-rebase', labelKey: 'vc.sync.action.pullRebase' },
  { id: '8.8', action: 'pull-ff-only', labelKey: 'vc.sync.action.pullFfOnly' },
  { id: '8.9', action: 'push', labelKey: 'vc.sync.action.push' },
  { id: '8.10', action: 'push-upstream', labelKey: 'vc.sync.action.pushUpstream' },
  { id: '8.11', action: 'delete-remote-ref', labelKey: 'vc.sync.action.delete' },
  { id: '8.12', action: 'force-push', labelKey: 'vc.sync.action.force' },
  { id: '8.13', action: 'atomic-push', labelKey: 'vc.sync.action.atomic' },
  { id: '8.14', action: 'push-tags', labelKey: 'vc.sync.action.tags' }
]

export const vcNewSyncReads = function () {
  return { sync: { state: 'idle', data: null, error: null }, task: { state: 'idle', data: null, error: null } }
}

export const vcSyncStateOf = function (reads: any) {
  const slot: any = reads && reads.sync
  return slot && typeof slot.state === 'string' ? slot.state : 'idle'
}

export const vcSyncDataOf = function (reads: any) {
  const slot: any = reads && reads.sync
  return slot && slot.data ? slot.data : null
}

export const vcSyncErrorOf = function (reads: any) {
  const slot: any = reads && reads.sync
  return slot && slot.error ? slot.error : null
}

export const vcSyncTaskOf = function (reads: any) {
  const slot: any = reads && reads.task
  return slot && slot.data ? slot.data : null
}

function vcSyncMerge(reads: any, next: any): any {
  return Object.assign({}, reads || {}, next)
}

function vcSyncLog(level: any, event: any, fields: any): void {
  try {
    if (typeof log === 'function') log(level, event, fields)
  } catch (e) {}
}

// 预检回包 → 读数。成功落 ok；失败（含 blocked 禁用）落 error，并保留上一份 data 供界面标「旧读数」。
export const vcApplySyncReply = function (reads: any, reply: any) {
  const base: any = reads || {}
  if (reply && reply.ok === true) {
    return vcSyncMerge(base, { sync: { state: 'ok', data: reply, error: null } })
  }
  const error: any = (reply && reply.error) || { kind: 'host', message: '预检没有返回结果' }
  return vcSyncMerge(base, { sync: { state: 'err', data: (base.sync && base.sync.data) || null, error: error } })
}

// 执行回包 → 读数。成功后把任务摘要放进 task 槽；失败放进 sync 槽的 error（结果贴触发点用）。
export const vcApplySyncWriteReply = function (reads: any, reply: any) {
  const base: any = reads || {}
  if (reply && reply.ok === true) {
    return vcSyncMerge(base, {
      sync: { state: 'ok', data: Object.assign({}, (base.sync && base.sync.data) || {}, { executed: true }), error: null },
      task: { state: 'ok', data: reply.task || null, error: null }
    })
  }
  const error: any = (reply && reply.error) || { kind: 'host', message: '执行没有返回结果' }
  return vcSyncMerge(base, { task: { state: 'err', data: (base.task && base.task.data) || null, error: error } })
}

// 一次预检：只有用户点「预检」才调。日志口径与其它电话一致（host.call / host.call.fail）。
export const vcReadSyncCheck = function (reads: any, call: any, cwd: any, action: any, input: any): Promise<any> {
  const startedAt: number = Date.now()
  return Promise.resolve()
    // 预检的参数是扁平的：动作参数（remote / localBranch / upstream …）与 cwd、action 同一层，
    // 宿主预检直接把它们交给 syncPlanOf；多包一层 input 会让宿主读到一堆 undefined。
    .then(function () { return call(VC_SYNC_PHONES.check, Object.assign({ cwd: String(cwd || ''), action: String(action || '') }, input || {})) })
    .then(function (reply: any) {
      vcSyncLog('info', 'host.call', { method: VC_SYNC_PHONES.check, latencyMs: Date.now() - startedAt, ok: !!(reply && reply.ok === true), kind: 'sync-check' })
      return vcApplySyncReply(reads, reply)
    })
    .catch(function (e: any) {
      vcSyncLog('warn', 'host.call.fail', { method: VC_SYNC_PHONES.check, kind: 'sync-check', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) })
      return vcApplySyncReply(reads, { ok: false, error: { kind: 'host', message: String((e && e.message) || e) } })
    })
}

// 一次凭票执行：确认后才调；只传票号与动作，不在这里拼任何 git 参数（argv 全在票里）。
export const vcRunSyncWrite = function (reads: any, call: any, cwd: any, ticketId: any, action: any, requestId: any, confirmed: any): Promise<any> {
  const startedAt: number = Date.now()
  return Promise.resolve()
    .then(function () {
      return call(VC_SYNC_PHONES.write, {
        cwd: String(cwd || ''),
        ticketId: String(ticketId || ''),
        action: String(action || ''),
        requestId: String(requestId || ''),
        confirmed: confirmed === true
      })
    })
    .then(function (reply: any) {
      vcSyncLog('info', 'host.call', { method: VC_SYNC_PHONES.write, latencyMs: Date.now() - startedAt, ok: !!(reply && reply.ok === true), kind: 'sync-write' })
      return vcApplySyncWriteReply(reads, reply)
    })
    .catch(function (e: any) {
      vcSyncLog('warn', 'host.call.fail', { method: VC_SYNC_PHONES.write, kind: 'sync-write', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) })
      return vcApplySyncWriteReply(reads, { ok: false, error: { kind: 'host', message: String((e && e.message) || e) } })
    })
}
