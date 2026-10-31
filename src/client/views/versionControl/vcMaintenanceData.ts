// views/versionControl/vcMaintenanceData.ts —— 管理 › 维护页与诊断页的操作方法层（#1758 T22，规格 #1586 域 11）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼进 src/client/index.ts 的 leaf 标记处。
//
// 这一层只做三件事，不画界面、不发电话：
//   ① 十条能力 11.2–11.11 的 16 条动作各归哪一页、哪条是主入口、哪条进危险区、哪条要先备份；
//   ② 把界面上的选择翻成宿主预检 / 凭票执行 / 长任务能收的参数；
//   ③ 把回包分类成界面状态（可签票 / 被拦 / 失败 / 执行成功 / 任务四类结论）。
// 判定规则的真源在共享层 maintenance-ops.ts（宿主与界面读同一份），这里不复制一套规则，
// 只镜像成界面可以逐条对账的形状；门禁会把两份逐条比一遍。
//
// 为什么不在这里写任何中文字符串：可见文字全部走 t(词条)，词条真源 config/copy/vcmaintenance.yaml；
// 这一层可以被门禁直接求值，混进界面文案就分不清「逻辑」与「文案」的边界了。

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_MAINTENANCE_PAGE_SOURCE = 'src/client/views/versionControl/vcMaintenanceData.ts'

/** 本页要用的六条电话：读数、预检签票、凭票执行，加长任务通道的发起 / 查询 / 取消。 */
export const VC_MAINTENANCE_PHONES: Record<string, string> = {
  read: 'wf.gitMaintenanceRead',
  check: 'wf.gitMaintenanceCheck',
  write: 'wf.gitMaintenanceWrite',
  taskStart: 'wf.gitTaskStart',
  taskQuery: 'wf.gitTaskQuery',
  taskCancel: 'wf.gitTaskCancel',
}

/** 16 条动作的界面镜像：owner 指这条动作在哪一页当主入口（11.4 的对象读数同时在维护页常驻展示）。 */
export const VC_MAINTENANCE_ACTIONS: any[] = [
  { op: 'fsck-basic', capId: '11.2', kind: 'task', owner: 'diagnostics', dangerous: false, confirm: false, requiresBackup: false, command: 'git fsck' },
  { op: 'fsck-unreachable', capId: '11.3', kind: 'task', owner: 'diagnostics', dangerous: false, confirm: false, requiresBackup: false, command: 'git fsck --unreachable' },
  { op: 'unreachable', capId: '11.3', kind: 'read', owner: 'diagnostics', dangerous: false, confirm: false, requiresBackup: false, command: 'git fsck --unreachable' },
  { op: 'objects', capId: '11.4', kind: 'read', owner: 'diagnostics', dangerous: false, confirm: false, requiresBackup: false, command: 'git count-objects -vH' },
  { op: 'gc', capId: '11.5', kind: 'write', owner: 'maintenance', dangerous: false, confirm: true, requiresBackup: false, command: 'git gc' },
  { op: 'prune-preview', capId: '11.6', kind: 'read', owner: 'maintenance', dangerous: false, confirm: false, requiresBackup: false, command: 'git prune -n -v' },
  { op: 'prune', capId: '11.6', kind: 'write', owner: 'maintenance', dangerous: true, confirm: true, requiresBackup: true, command: 'git prune' },
  { op: 'repack', capId: '11.7', kind: 'read', owner: 'maintenance', dangerous: false, confirm: false, requiresBackup: false, command: 'git repack -a -d' },
  { op: 'maintenance-status', capId: '11.8', kind: 'read', owner: 'maintenance', dangerous: false, confirm: false, requiresBackup: false, command: 'git maintenance start / stop / register' },
  { op: 'maintenance-run', capId: '11.8', kind: 'write', owner: 'maintenance', dangerous: false, confirm: true, requiresBackup: false, command: 'git maintenance run' },
  { op: 'maintenance-enable', capId: '11.8', kind: 'write', owner: 'maintenance', dangerous: false, confirm: true, requiresBackup: false, command: 'git maintenance start' },
  { op: 'maintenance-disable', capId: '11.8', kind: 'write', owner: 'maintenance', dangerous: false, confirm: true, requiresBackup: false, command: 'git maintenance stop / unregister' },
  { op: 'commit-graph', capId: '11.9', kind: 'read', owner: 'maintenance', dangerous: false, confirm: false, requiresBackup: false, command: 'git commit-graph' },
  { op: 'multi-pack-index', capId: '11.10', kind: 'read', owner: 'maintenance', dangerous: false, confirm: false, requiresBackup: false, command: 'git multi-pack-index' },
  { op: 'pack-refs', capId: '11.11', kind: 'read', owner: 'maintenance', dangerous: false, confirm: false, requiresBackup: false, command: 'git pack-refs' },
  { op: 'overview', capId: '', kind: 'read', owner: 'maintenance', dangerous: false, confirm: false, requiresBackup: false, command: 'git count-objects -vH' },
]

/** 版本门：这三条能力在老的 git 上隐藏，界面同宿主读同一份版本阈值。 */
export const VC_MAINTENANCE_VERSION_GATES: Record<string, string> = { '11.8': '2.30', '11.9': '2.18', '11.10': '2.21' }

/** 危险区动作：只有清除不可达对象一条。 */
export const VC_MAINTENANCE_DANGER_IDS: string[] = ['prune']

const vcMaintenanceCamelOf = function (id: any): string {
  return String(id || '').split('-').map(function (part: string, index: number) {
    if (index === 0) return part
    return part.charAt(0).toUpperCase() + part.slice(1)
  }).join('')
}

/** 按动作名取界面镜像；认不出回 null（界面据此不画这一行）。 */
export const vcMaintenanceOpMetaOf = function (op: any): any {
  const s = String(op || '')
  for (let i = 0; i < VC_MAINTENANCE_ACTIONS.length; i += 1) {
    if (VC_MAINTENANCE_ACTIONS[i].op === s) return VC_MAINTENANCE_ACTIONS[i]
  }
  return null
}

/** 动作的可见文字键：一条动作一个，动词另有一条（按钮上用）。 */
export const vcMaintenanceOpLabelKeyOf = function (op: any): string { return 'vc.maintenance.op.' + vcMaintenanceCamelOf(op) }
export const vcMaintenanceOpVerbKeyOf = function (op: any): string { return 'vc.maintenance.op.verb.' + vcMaintenanceCamelOf(op) }

/** 这一页要画的动作清单：诊断页四条、维护页十二条（含总览读数）。 */
export const vcMaintenanceOpsOfPage = function (page: any): any[] {
  const s = String(page || '')
  return VC_MAINTENANCE_ACTIONS.filter(function (m) { return m.owner === s })
}

/** 版本门：能力编号在阈值之上才显示；没有门的能力一律显示。 */
export const vcMaintenanceVisibleOf = function (meta: any, gitVersion: any): boolean {
  if (!meta) return false
  const need: any = VC_MAINTENANCE_VERSION_GATES[meta.capId]
  if (!need) return true
  const m: any = /(\d+)\.(\d+)/.exec(String(gitVersion || ''))
  if (!m) return false
  const major: number = Number(m[1])
  const minor: number = Number(m[2])
  const needM: any = /^(\d+)\.(\d+)$/.exec(String(need))
  if (!needM) return false
  if (major !== Number(needM[1])) return major > Number(needM[1])
  return minor >= Number(needM[2])
}

/** 请求号：同一毫秒两次点击也不撞（带盐），只留小写字母数字与横线。 */
export const vcMaintenanceRequestIdOf = function (nowMs: any, salt: any): string {
  const clean: string = String(salt === undefined || salt === null ? '' : salt).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  const stamp: string = Number(nowMs || 0).toString(36)
  return clean === '' ? 'm' + stamp : 'm' + stamp + '-' + clean
}

/** 只读电话参数：读数与预演都只给仓库目录与动作名。 */
export const vcMaintenanceReadArgsOf = function (cwd: any, op: any): any {
  return { cwd: String(cwd || ''), op: String(op || '') }
}

/** 预检电话参数：动作与模式（只有完整性检查需要模式，其余不传）。 */
export const vcMaintenanceCheckArgsOf = function (cwd: any, op: any, mode?: any): any {
  const out: any = { cwd: String(cwd || ''), op: String(op || '') }
  if (mode !== undefined && mode !== null && mode !== '') out.mode = String(mode)
  return out
}

/** 凭票执行参数：票号与请求号都是必填，确认标记固定为真（点击确认卡之后才走到这里）。 */
export const vcMaintenanceWriteArgsOf = function (cwd: any, op: any, ticketId: any, requestId: any): any {
  return { cwd: String(cwd || ''), op: String(op || ''), ticketId: String(ticketId || ''), requestId: String(requestId || ''), confirmed: true }
}

/** 长任务发起参数：两条完整性检查都归任务通道的 fsck，模式决定 --unreachable 加不加。 */
export const vcMaintenanceTaskArgsOf = function (cwd: any, op: any, requestId: any): any {
  const unreachable: boolean = String(op || '') === 'fsck-unreachable'
  return { cwd: String(cwd || ''), op: 'fsck', args: { mode: unreachable ? 'unreachable' : 'default' }, confirm: true, requestId: String(requestId || '') }
}

/** 回包分类：读成功 / 可签票 / 被拦 / 失败。界面只认这四种，不自己猜字段。 */
export const vcMaintenanceReplyKindOf = function (reply: any): string {
  if (!reply) return 'fail'
  if (reply.ok !== true) return reply.reason === 'bad-target' || reply.reason === 'need-confirm' ? 'block' : 'fail'
  if (reply.decision && reply.decision.verdict === 'block') return 'block'
  if (reply.ticket) return 'allow'
  return 'read'
}

/** 拒绝或失败的理由标识符；成功回包回空串。 */
export const vcMaintenanceReasonOf = function (reply: any): string {
  if (!reply) return ''
  if (reply.reason) return String(reply.reason)
  if (reply.error && reply.error.reason) return String(reply.error.reason)
  return ''
}

/** 预检回包里的票；被拦或失败时回 null。 */
export const vcMaintenanceTicketOf = function (reply: any): any {
  if (!reply || reply.ok !== true || !reply.ticket) return null
  return reply.ticket
}

/** 预检回包里的四段确认卡；没有就回 null。 */
export const vcMaintenanceConfirmOf = function (reply: any): any {
  if (!reply || reply.ok !== true || !reply.confirm) return null
  return reply.confirm
}

/** 预检回包里的现场与备份计划：危险动作的确认卡要显示备份放哪、多大。 */
export const vcMaintenanceBackupOf = function (reply: any): any {
  if (!reply || reply.ok !== true) return null
  return reply.backup || null
}

/** 预检被拦时仍带回的预览事实（例如不可达对象个数）。 */
export const vcMaintenancePreviewOf = function (reply: any): any {
  if (!reply) return null
  return reply.preview || null
}

/** 读数回包里的对象统计；读失败回 null。 */
export const vcMaintenanceObjectsOf = function (reply: any): any {
  if (!reply || reply.ok !== true) return null
  if (reply.objects) return reply.objects
  if (reply.looseCount !== undefined) return reply
  return null
}

/** 读数回包里的自动维护状态；读失败回 null。 */
export const vcMaintenanceStatusOf = function (reply: any): any {
  if (!reply || reply.ok !== true) return null
  if (reply.maintenance && reply.maintenance.registered !== undefined) return reply.maintenance
  if (reply.registered !== undefined) return reply
  return null
}

/** 执行回包里的任务；本地动作回 null。 */
export const vcMaintenanceTaskOf = function (reply: any): any {
  if (!reply || reply.ok !== true) return null
  return reply.task || null
}

/** 执行回包里的备份点；没有备份的动作回 null。 */
export const vcMaintenanceBackupPointOf = function (reply: any): any {
  if (!reply || reply.ok !== true) return null
  return reply.backup || null
}

/** 人话备份摘要与三步还原指引：备份成功后才显示，绝不承诺自动恢复。 */
export const vcMaintenanceBackupSummaryOf = function (reply: any): string {
  if (!reply || reply.ok !== true) return ''
  return String(reply.backupSummary || '')
}

export const vcMaintenanceRestoreStepsOf = function (reply: any): string[] {
  if (!reply || reply.ok !== true || !Array.isArray(reply.backupRestoreSteps)) return []
  return reply.backupRestoreSteps.map(function (s: any) { return String(s) })
}

/** 本地动作执行后回读的自动维护状态；失败回 null。 */
export const vcMaintenanceStateOf = function (reply: any): any {
  if (!reply || reply.ok !== true) return null
  return reply.maintenance || null
}

/** 任务四类结论：成功 / 失败 / 被取消 / 中断（重启后如实说中断，不假装完成）。 */
export const vcMaintenanceTaskConclusionOf = function (task: any): string {
  if (!task) return ''
  const state: string = String(task.state || '')
  if (state === 'done' || state === 'succeeded') return 'done'
  if (state === 'failed') return 'failed'
  if (state === 'cancelled') return 'cancelled'
  if (state === 'interrupted') return 'interrupted'
  return ''
}

/** 任务是否已经停下：只有停下之后才显示结论条与停止按钮的禁用态。 */
export const vcMaintenanceTaskEndedOf = function (task: any): boolean {
  return vcMaintenanceTaskConclusionOf(task) !== ''
}

/** 进度：能解析出百分比就给真实百分比，否则只给阶段与已传字节（界面显示「不确定」）。 */
export const vcMaintenanceProgressOf = function (task: any): any {
  if (!task) return { percent: null, phase: '', bytes: null, uncertain: true }
  const progress: any = task.progress || {}
  const percent: any = (typeof progress.percent === 'number' && progress.percent >= 0 && progress.percent <= 100) ? Math.round(progress.percent) : null
  return { percent: percent, phase: String(progress.phase || ''), bytes: typeof progress.bytes === 'number' ? progress.bytes : null, uncertain: percent === null }
}

/** 失败话术：理由标识符先映射成失败族，再走同一条词条；没有映射时用 git 原话。 */
export const vcMaintenanceFailTextOf = function (t: any, reply: any, familyOf: any): string {
  const reason: string = vcMaintenanceReasonOf(reply)
  const said: string = String((reply && reply.error && reply.error.message) || (reply && reply.message) || '')
  if (typeof t !== 'function') return reason || said
  if (reason === '' || typeof familyOf !== 'function') return said
  return t('vc.maintenance.fail.' + String(familyOf(reason, reply && reply.error && reply.error.kind)), { git: said })
}

export const VC_MAINTENANCE_PAGE_HINT = 'maintenance'
