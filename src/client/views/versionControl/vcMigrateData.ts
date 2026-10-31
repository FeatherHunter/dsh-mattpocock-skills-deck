// views/versionControl/vcMigrateData.ts —— 迁移与备份域的数据层（#1759 T23）。
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包。
//
// 三件事：登记两条电话名、把宿主回包归一成读数、把用户操作变成一次调用。界面只读读数、只画按钮。
// 两条电话与宿主入口注册、门禁断言必须逐字一致：
//   wf.gitMigrateCheck = 预检（读现场 + 参数守卫 + 只读动作当场读结果 + 签 120 秒票）
//   wf.gitMigrateWrite = 凭票执行（init 直接执行，其余交给长任务通道）
// 读数两个槽：migrate 槽放预检回包（含只读结果），task 槽放执行回包里的任务摘要；
// 失败时保留上一份 data（不把旧结论当新结论，界面按 error 画失败态）。
declare const dswsLogHash: any
declare const dswsLogTrunc: any

export const VC_MIGRATE_PHONES: Record<string, string> = {
  check: 'wf.gitMigrateCheck',
  write: 'wf.gitMigrateWrite'
}

// 九个动作：id 与能力账本逐条一致（11.1 / 11.12 / 11.13 / 5.13）；svn 两条是迁移页补充块，
// 账本里没有独立 id（规格与票面都不许为它造新 id），所以 id 留空、extra 标真。
export const VC_MIGRATE_ACTION_ROWS: any[] = [
  { id: '11.1', action: 'init', labelKey: 'vc.migrate.action.init', readOnly: false, extra: false },
  { id: '11.12', action: 'archive', labelKey: 'vc.migrate.action.archive', readOnly: false, extra: false },
  { id: '11.13', action: 'bundle-create', labelKey: 'vc.migrate.action.bundleCreate', readOnly: false, extra: false },
  { id: '11.13', action: 'bundle-verify', labelKey: 'vc.migrate.action.bundleVerify', readOnly: true, extra: false },
  { id: '11.13', action: 'bundle-unbundle', labelKey: 'vc.migrate.action.bundleUnbundle', readOnly: false, extra: false },
  { id: '5.13', action: 'fast-export', labelKey: 'vc.migrate.action.fastExport', readOnly: false, extra: false },
  { id: '5.13', action: 'fast-import', labelKey: 'vc.migrate.action.fastImport', readOnly: false, extra: false },
  { id: '', action: 'svn-probe', labelKey: 'vc.migrate.action.svnProbe', readOnly: true, extra: true },
  { id: '', action: 'svn-fetch', labelKey: 'vc.migrate.action.svnFetch', readOnly: false, extra: true }
]

export const vcNewMigrateReads = function () {
  return { migrate: { state: 'idle', data: null, error: null }, task: { state: 'idle', data: null, error: null } }
}

export const vcMigrateStateOf = function (reads: any) {
  const slot: any = reads && reads.migrate
  return slot && typeof slot.state === 'string' ? slot.state : 'idle'
}

export const vcMigrateDataOf = function (reads: any) {
  const slot: any = reads && reads.migrate
  return slot && slot.data ? slot.data : null
}

export const vcMigrateErrorOf = function (reads: any) {
  const slot: any = reads && reads.migrate
  return slot && slot.error ? slot.error : null
}

export const vcMigrateTaskOf = function (reads: any) {
  const slot: any = reads && reads.task
  return slot && slot.data ? slot.data : null
}

function vcMigrateMerge(reads: any, next: any): any {
  return Object.assign({}, reads || {}, next)
}

function vcMigrateLog(level: any, event: any, fields: any): void {
  try {
    if (typeof log === 'function') log(level, event, fields)
  } catch (e) {}
}

// 预检回包 → 读数。成功落 ok（只读动作的结果也在里面）；失败落 error 并保留上一份 data。
export const vcApplyMigrateReply = function (reads: any, reply: any) {
  const base: any = reads || {}
  if (reply && reply.ok === true) {
    return vcMigrateMerge(base, { migrate: { state: 'ok', data: reply, error: null } })
  }
  const error: any = (reply && reply.error) || { kind: 'host', message: '预检没有返回结果' }
  return vcMigrateMerge(base, { migrate: { state: 'err', data: (base.migrate && base.migrate.data) || null, error: error } })
}

// 执行回包 → 读数。成功后任务摘要进 task 槽；失败放进 task 槽的 error（结果贴触发点用）。
export const vcApplyMigrateWriteReply = function (reads: any, reply: any) {
  const base: any = reads || {}
  if (reply && reply.ok === true) {
    return vcMigrateMerge(base, {
      migrate: { state: 'ok', data: Object.assign({}, (base.migrate && base.migrate.data) || {}, { executed: true, init: reply.init || null }), error: null },
      task: { state: 'ok', data: reply.task || null, error: null }
    })
  }
  const error: any = (reply && reply.error) || { kind: 'host', message: '执行没有返回结果' }
  return vcMigrateMerge(base, { task: { state: 'err', data: (base.task && base.task.data) || null, error: error } })
}

// 一次预检：只有用户点「预检」才调。参数是扁平的（cwd / action 与动作字段同一层）。
export const vcReadMigrateCheck = function (reads: any, call: any, cwd: any, action: any, input: any): Promise<any> {
  const startedAt: number = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_MIGRATE_PHONES.check, Object.assign({ cwd: String(cwd || ''), action: String(action || '') }, input || {})) })
    .then(function (reply: any) {
      vcMigrateLog('info', 'host.call', { method: VC_MIGRATE_PHONES.check, latencyMs: Date.now() - startedAt, ok: !!(reply && reply.ok === true), kind: 'migrate-check' })
      return vcApplyMigrateReply(reads, reply)
    })
    .catch(function (e: any) {
      vcMigrateLog('warn', 'host.call.fail', { method: VC_MIGRATE_PHONES.check, kind: 'migrate-check', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) })
      return vcApplyMigrateReply(reads, { ok: false, error: { kind: 'host', message: String((e && e.message) || e) } })
    })
}

// 一次凭票执行：确认后才调；只传票号与动作，不在这里拼任何 git 参数（argv 全在票里）。
export const vcRunMigrateWrite = function (reads: any, call: any, cwd: any, ticketId: any, action: any, requestId: any, confirmed: any): Promise<any> {
  const startedAt: number = Date.now()
  return Promise.resolve()
    .then(function () {
      return call(VC_MIGRATE_PHONES.write, {
        cwd: String(cwd || ''),
        ticketId: String(ticketId || ''),
        action: String(action || ''),
        requestId: String(requestId || ''),
        confirmed: confirmed === true
      })
    })
    .then(function (reply: any) {
      vcMigrateLog('info', 'host.call', { method: VC_MIGRATE_PHONES.write, latencyMs: Date.now() - startedAt, ok: !!(reply && reply.ok === true), kind: 'migrate-write' })
      return vcApplyMigrateWriteReply(reads, reply)
    })
    .catch(function (e: any) {
      vcMigrateLog('warn', 'host.call.fail', { method: VC_MIGRATE_PHONES.write, kind: 'migrate-write', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) })
      return vcApplyMigrateWriteReply(reads, { ok: false, error: { kind: 'host', message: String((e && e.message) || e) } })
    })
}
