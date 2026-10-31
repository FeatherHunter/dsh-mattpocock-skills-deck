// 维护页的共享协议（规格 #1586 域 11 的 11.2–11.11，#1758 T22）。
// 本文件零 import：它同时给宿主预检/执行叶子和界面闭包用，拼进界面时不能带依赖。
// 十条能力的关系只有这一份真源：谁有主入口、谁走 120 秒票据、谁走长任务、谁受版本门限制。
// 新增动作要同步七个登记点（动作枚举、预检判定分支、检查白名单、写处理函数、宿主注册、
// 界面电话表、超时配置）。漏掉预检判定分支会永远落到 unknown-operation，
// 界面看起来能点、实际每次都被拦，这是本仓已经踩过的坑。

export interface MaintenanceOpMeta {
  id: string
  capId: string
  kind: 'write' | 'read' | 'task'
  dangerous: boolean
  confirm: boolean
  reversible: boolean
  needs: 'none'
  primary: boolean
  labelKey: string
  command: string
  requiresBackup?: boolean
  steps?: string[][]
}

function camelOf(id: string): string {
  const parts = String(id).split('-')
  const head = parts.shift() || ''
  return head + parts.map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1) }).join('')
}

// 每条动作的公共默认值：只读动作不需要确认卡，写动作一律要；危险与不可恢复由调用处覆盖。
function meta(id: string, capId: string, kind: any, command: string, extra?: any): MaintenanceOpMeta {
  const base: any = {
    id: id,
    capId: capId,
    kind: kind,
    dangerous: false,
    confirm: kind === 'write',
    reversible: true,
    needs: 'none',
    primary: false,
    labelKey: 'vc.maintenance.op.' + camelOf(id),
    command: command,
  }
  const add = extra || {}
  Object.keys(add).forEach(function (key) { base[key] = add[key] })
  return base as MaintenanceOpMeta
}

// 顺序按能力编号排：诊断页先读 11.2 到 11.4，维护页再读 11.5 到 11.11。
// 主入口十条：11.2 fsck-basic、11.3 fsck-unreachable、11.4 objects、11.5 gc、11.6 prune、
// 11.7 repack、11.8 maintenance-run、11.9 commit-graph、11.10 multi-pack-index、11.11 pack-refs。
export const MAINTENANCE_OPS: MaintenanceOpMeta[] = [
  meta('fsck-basic', '11.2', 'task', 'git fsck', { primary: true }),
  meta('fsck-unreachable', '11.3', 'task', 'git fsck --unreachable', { primary: true }),
  meta('unreachable', '11.3', 'read', 'git fsck --unreachable'),
  meta('objects', '11.4', 'read', 'git count-objects -vH', { primary: true }),
  meta('gc', '11.5', 'write', 'git gc', { primary: true }),
  meta('prune-preview', '11.6', 'read', 'git prune -n -v'),
  meta('prune', '11.6', 'write', 'git prune', { primary: true, dangerous: true, reversible: false, requiresBackup: true }),
  meta('repack', '11.7', 'read', 'git repack -a -d', { primary: true }),
  meta('maintenance-status', '11.8', 'read', 'git maintenance start / stop / register', {}),
  meta('maintenance-run', '11.8', 'write', 'git maintenance run', { primary: true }),
  meta('maintenance-enable', '11.8', 'write', 'git maintenance start', { steps: [['maintenance', 'start']] }),
  meta('maintenance-disable', '11.8', 'write', 'git maintenance stop / unregister', { steps: [['maintenance', 'stop'], ['maintenance', 'unregister']] }),
  meta('commit-graph', '11.9', 'read', 'git commit-graph', { primary: true }),
  meta('multi-pack-index', '11.10', 'read', 'git multi-pack-index', { primary: true }),
  meta('pack-refs', '11.11', 'read', 'git pack-refs', { primary: true }),
  meta('overview', '', 'read', 'git count-objects -vH 等组合读数', {}),
]

export const MAINTENANCE_WRITE_OPS: MaintenanceOpMeta[] = MAINTENANCE_OPS.filter(function (m) { return m.kind === 'write' })
export const MAINTENANCE_READ_OPS: MaintenanceOpMeta[] = MAINTENANCE_OPS.filter(function (m) { return m.kind === 'read' })
export const MAINTENANCE_TASK_ACTIONS: MaintenanceOpMeta[] = MAINTENANCE_OPS.filter(function (m) { return m.kind === 'task' })
export const MAINTENANCE_PRIMARY_IDS: string[] = MAINTENANCE_OPS.filter(function (m) { return m.primary }).map(function (m) { return m.id })

// 版本门与能力账本 versionPolicy=hide 的三条严格同源：老版本只读说明里说清楚用哪个版本替代。
export const MAINTENANCE_VERSION_HIDE: any = { '11.8': '2.30', '11.9': '2.18', '11.10': '2.21' }
export const MAINTENANCE_PLAN_KEYS: string[] = ['op', 'mode']
export const MAINTENANCE_CHECK_CONTRACT = 'vc-maintenance-check'
export const MAINTENANCE_CHECK_VERSION = 1
export const MAINTENANCE_PHONES: any = {
  read: 'wf.gitMaintenanceRead',
  check: 'wf.gitMaintenanceCheck',
  write: 'wf.gitMaintenanceWrite',
}

// 计划摘要输入必须跨机器稳定，所以自己写一份键排序的 JSON，不 import 别的模块。
function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonicalJson(value[key]) }).join(',') + '}'
}

export function maintenancePlanOf(partial?: any): any {
  const plan = partial || {}
  return {
    op: typeof plan.op === 'string' ? plan.op : '',
    mode: typeof plan.mode === 'string' ? plan.mode : '',
  }
}

export function maintenancePlanInput(plan: any): string {
  return canonicalJson(maintenancePlanOf(plan))
}

export function maintenanceOpMetaOf(opId: any): MaintenanceOpMeta | null {
  for (let i = 0; i < MAINTENANCE_OPS.length; i += 1) {
    if (MAINTENANCE_OPS[i].id === opId) return MAINTENANCE_OPS[i]
  }
  return null
}

export function maintenanceWriteOpOf(opId: any): MaintenanceOpMeta | null {
  const metaFound = maintenanceOpMetaOf(opId)
  return metaFound !== null && metaFound.kind === 'write' ? metaFound : null
}

export function maintenanceTaskActionOf(opId: any): MaintenanceOpMeta | null {
  const metaFound = maintenanceOpMetaOf(opId)
  return metaFound !== null && metaFound.kind === 'task' ? metaFound : null
}

// 长任务请求：任务通道的 fsck 用 args.mode 区分「只看悬空条目」与「列不可达对象」。
// 面板只执行 fsck --unreachable；--lost-found 会往 .git/lost-found 写文件，不在面板里跑。
export function maintenanceTaskRequestOf(opId: any): any {
  if (opId === 'gc') return { op: 'gc' }
  if (opId === 'prune') return { op: 'prune' }
  if (opId === 'maintenance-run') return { op: 'maintenance-run' }
  if (opId === 'fsck-basic') return { op: 'fsck', args: { mode: 'default' } }
  if (opId === 'fsck-unreachable') return { op: 'fsck', args: { mode: 'unreachable' } }
  return null
}

// 只读展示、没有触发按钮的动作，本地步骤恒为空；开启/关闭自动维护才走父层本地命令。
export function maintenanceLocalStepsOf(opId: any): string[][] {
  const metaFound = maintenanceOpMetaOf(opId)
  if (metaFound === null || !metaFound.steps) return []
  return metaFound.steps
}

export function maintenanceRequiresBackupOf(opId: any): boolean {
  const metaFound = maintenanceOpMetaOf(opId)
  return metaFound !== null && metaFound.requiresBackup === true
}

export function maintenanceModeProblem(mode: any): string | null {
  if (mode === undefined || mode === null || mode === '') return null
  if (mode === 'default' || mode === 'unreachable') return null
  return 'bad-mode'
}

// 版本比较只看主次版本：完整版本串形如 "git version 2.49.0.windows.1"，
// 读不出时按「不够」处理 —— 隐藏一个老版本没有的功能，比让人点了报错更诚实。
export function maintenanceVersionAtLeast(versionText: any, needText: any): boolean {
  const got = String(versionText || '').match(/(\d+)\.(\d+)/)
  const need = String(needText || '').match(/(\d+)\.(\d+)/)
  if (!got || !need) return false
  const gotMajor = parseInt(got[1], 10)
  const gotMinor = parseInt(got[2], 10)
  const needMajor = parseInt(need[1], 10)
  const needMinor = parseInt(need[2], 10)
  if (gotMajor !== needMajor) return gotMajor > needMajor
  return gotMinor >= needMinor
}

export function maintenanceVersionProblem(opMeta: any, gitVersion: any): string | null {
  if (!opMeta || typeof opMeta.capId !== 'string') return null
  const need = MAINTENANCE_VERSION_HIDE[opMeta.capId]
  if (!need) return null
  return maintenanceVersionAtLeast(gitVersion, need) ? null : 'version-unsupported'
}

export function maintenanceVisibleOf(capId: any, gitVersion: any): boolean {
  const need = MAINTENANCE_VERSION_HIDE[capId]
  if (!need) return true
  return maintenanceVersionAtLeast(gitVersion, need)
}

// 维护动作都在一个干净的、非裸仓库上做：裸仓库没有工作区，进行中的合并/变基先收尾再来。
export function maintenanceSceneProblem(scene: any): string | null {
  const view = scene || {}
  if (view.repoBare === true) return 'repo-bare'
  if (view.operation) return 'operation-in-progress'
  return null
}

export const MAINTENANCE_OPS_SOURCE = [
  '主入口：' + MAINTENANCE_PRIMARY_IDS.join(' '),
  '写动作：' + MAINTENANCE_WRITE_OPS.map(function (m) { return m.id }).join(' '),
  '读动作：' + MAINTENANCE_READ_OPS.map(function (m) { return m.id }).join(' '),
  '任务动作：' + MAINTENANCE_TASK_ACTIONS.map(function (m) { return m.id }).join(' '),
  '任务参数：fsck --unreachable / gc / prune / maintenance run',
  '危险区：prune 必须先整仓备份，备份失败就中止',
  '版本门：' + Object.keys(MAINTENANCE_VERSION_HIDE).map(function (capId) { return capId + '>=' + MAINTENANCE_VERSION_HIDE[capId] }).join(' '),
].join('\n')
