/**
 * src/shared/version-control/src/recovery-point.ts —— 破坏性历史改写（硬重置）的恢复点装置（#1748 T13，规格 #1586 域 5）
 *
 * 为什么单独一叶、且做成纯函数：硬重置是这一域唯一的「毁」级动作，规格第 4 节要求界面在动手前
 * 先说清「会丢什么、怎么找回来」。恢复点就是那份说明的唯一来源：预检读真实现场算出来，确认卡上
 * 原样展示，执行完回包里再带一份，用户事后能照着它找回旧提交。同一份逻辑还要给 #1751 T15
 * （提交历史页的「从这里恢复」）复用，所以不塞进宿主叶子，也不带任何进程/磁盘依赖。
 *
 * 约定（改这里之前先读）：
 *   1. 恢复路径一律用「提交全号 + reflog 选择器」两样同时写：全号是 git 里唯一不会歧义的写法，
 *      reflog 选择器是执行之后旧位置的新名字（执行前 HEAD@{0}，执行后变成 HEAD@{1}）。
 *      只写其中一样，用户在不同仓库状态下都会遇到「照着做却找不到」。
 *   2. 影响数字读不全就显式失败（recovery-unreadable），绝不给半份计数：把「丢了 3 行」写错成
 *      「丢了 0 行」比不显示更坏。二进制文件单独计数，不计入行数（git 对二进制不给行数）。
 *   3. atMs 由调用方给（宿主时钟），本文件不读钟：门禁要能造任意时刻的恢复点。
 *   4. #1750 T15 把本装置扩成整仓备份点（backupPointOf / backupSummaryOf / backupRestoreStepsOf）：
 *      判据与恢复点一致——读不全就不给半份说明、不承诺自动恢复；备份本身由宿主执行层跑，本文件只认结果。
 */

export interface RecoveryImpact {
  /** 会被丢弃的文件数（硬重置后工作区与索引回到目标提交）。 */
  files: number
  /** 其中能数清的新增行数合计；有二进制时它只覆盖文本文件。 */
  added: number
  /** 能数清的删除行数合计。 */
  deleted: number
  /** 数不清行数的二进制文件数（它们在「会丢什么」里单独写一句）。 */
  binary: number
  /** 这次影响读数的输出被截断过吗（截断时调用方应直接拒签票，不给半份）。 */
  truncated: boolean
}

export interface RecoveryPoint {
  /** 恢复点种类：目前只有硬重置一种；T15 若加「丢弃某几个提交」会扩这里。 */
  kind: 'reset-hard'
  /** 必看：确认卡上必须原样展示恢复路径才算看完。 */
  required: boolean
  /** 会丢掉什么：文件数、行数、二进制文件数。 */
  discard: { files: number; added: number; deleted: number; binary: number }
  /** 怎么找回来：旧提交全号 + 执行前后的 reflog 选择器。 */
  restore: { headOid: string; headShort: string; reflogBefore: string; reflogAfter: string }
  /** 目标提交（重置到哪），给确认卡写清「回到哪个提交」。 */
  target: { oid: string; short: string }
  /** 从当前分支上会被移出历史的提交数（它们仍可从恢复点找回）。 */
  commits: number
  atMs: number
}

/** 恢复点影响读数的形状校验：计数必须是非负整数，truncated 必须是布尔。 */
export function recoveryImpactProblem(impact: any): string | null {
  const i: any = impact || {}
  const keys: string[] = ['files', 'added', 'deleted', 'binary']
  for (let k = 0; k < keys.length; k += 1) {
    const v: any = i[keys[k]]
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v) return 'bad-count'
  }
  if (typeof i.truncated !== 'boolean') return 'bad-truncated'
  return null
}

/**
 * 造恢复点。调用方（宿主预检）已经把三样东西量好了：当前头、目标提交、影响读数。
 * 返回 ok:false 时调用方必须拒签票：没有恢复路径的硬重置不许执行。
 */
export function recoveryPointOf(input: any): any {
  const a: any = input || {}
  const impact: RecoveryImpact = a.impact
  const problem: string | null = recoveryImpactProblem(impact)
  if (problem === 'bad-count') return { ok: false, reason: 'recovery-unreadable', message: '硬重置会丢多少东西还没数清（计数读不出来），不给半份说明，也不签票。' }
  if (problem === 'bad-truncated') return { ok: false, reason: 'recovery-unreadable', message: '硬重置会丢多少东西还没数清（读数的完整性标志缺席），不给半份说明，也不签票。' }
  if (impact.truncated === true) return { ok: false, reason: 'recovery-unreadable', message: '硬重置的影响读数被截断了，数不全就不签票；请换一个小一点的目标提交再试。' }
  const headOid: string = String(a.headOid || '')
  const targetOid: string = String(a.targetOid || '')
  if (headOid === '' || targetOid === '') return { ok: false, reason: 'recovery-unreadable', message: '恢复点缺当前头或目标提交，不给半份说明，也不签票。' }
  const before: string = String(a.reflogBefore || 'HEAD@{0}')
  const after: string = String(a.reflogAfter || 'HEAD@{1}')
  const point: RecoveryPoint = {
    kind: 'reset-hard',
    required: true,
    discard: { files: impact.files, added: impact.added, deleted: impact.deleted, binary: impact.binary },
    restore: { headOid: headOid, headShort: headOid.slice(0, 10), reflogBefore: before, reflogAfter: after },
    target: { oid: targetOid, short: targetOid.slice(0, 10) },
    commits: typeof a.commits === 'number' && isFinite(a.commits) && a.commits >= 0 ? Math.floor(a.commits) : 0,
    atMs: typeof a.atMs === 'number' && isFinite(a.atMs) ? a.atMs : 0,
  }
  return { ok: true, point: point }
}

/** 恢复点的摘要：确认卡的内容进票据摘要，执行前后两份摘要要对得上（换了目标就不许执行）。 */
export function recoveryPointDigestInput(point: any): string {
  const p: any = point || {}
  return JSON.stringify({
    kind: String(p.kind || ''),
    discard: p.discard || {},
    restore: p.restore || {},
    target: p.target || {},
    commits: Number(p.commits) || 0,
  })
}

/** 照着做就能找回旧提交的还原步骤：界面原样展示，T15 的「从这里恢复」也复用它。 */
export function recoveryRestoreStepsOf(point: any): string[] {
  const p: any = point || {}
  const restore: any = p.restore || {}
  const head = String(restore.headOid || '')
  if (head === '') return []
  return [
    'git reset --hard ' + head,
    '如果上面的提交号已经失效，再用 reflog 找回：git reflog 里找 ' + String(restore.reflogAfter || 'HEAD@{1}') + ' 那一行，然后 git reset --hard ' + String(restore.reflogAfter || 'HEAD@{1}'),
  ]
}

/** 恢复点的一句话摘要：确认卡标题行与日志摘要共用，数字与单位都写死在这里，界面不再各处拼。 */
export function recoverySummaryOf(point: any): string {
  const p: any = point || {}
  const d: any = p.discard || {}
  const text: string = String(Number(d.files) || 0) + ' 个文件、' + (String(Number(d.added) || 0) + ' 行新增、' + String(Number(d.deleted) || 0) + ' 行删除')
  return Number(d.binary) > 0 ? text + '，另有 ' + String(Number(d.binary)) + ' 个二进制文件' : text
}

export const RECOVERY_POINT_SOURCE = 'src/shared/version-control/src/recovery-point.ts'

/** 整仓备份的方式：镜像克隆（磁盘够）或整仓打包（磁盘不够时的降级）。 */
export type BackupKind = 'mirror' | 'bundle'

/**
 * 整仓备份点：确认卡与执行回包共用同一份形状。
 * required 恒为 true：备份是 filter-repo 的强制前置，没备份成功不许动手。
 */
export interface BackupPoint {
  kind: BackupKind
  required: true
  /** 备份在本机的位置：镜像克隆是目录，整仓打包是 .bundle 文件。 */
  path: string
  /** 备份读出来的字节数：读不出来（0 或不是整数）就显式失败，不给半份。 */
  bytes: number
  /** 备份花了多久：界面如实显示，不替人估。 */
  elapsedMs: number
  atMs: number
}

/**
 * 造备份点。字节数、耗时、方式、路径任何一项读不全就回 backup-unreadable：
 * 备份是整仓重写的唯一退路，一条「备份已在」的假话比不给备份更危险。
 */
export function backupPointOf(input: any): any {
  const a: any = input || {}
  const kind: string = String(a.kind || '')
  if (kind !== 'mirror' && kind !== 'bundle') return { ok: false, reason: 'backup-unreadable', message: '备份方式读不出来（只认镜像克隆或整仓打包），不签票、不执行重写。' }
  const pathText: string = typeof a.path === 'string' ? a.path : ''
  if (pathText === '') return { ok: false, reason: 'backup-unreadable', message: '备份路径读不出来，不签票、不执行重写。' }
  const bytes: number = Number(a.bytes)
  if (typeof a.bytes !== 'number' || !isFinite(bytes) || bytes < 0 || Math.floor(bytes) !== bytes) return { ok: false, reason: 'backup-unreadable', message: '备份大小读不出来，不签票、不执行重写。' }
  const elapsedMs: number = Number(a.elapsedMs)
  if (typeof a.elapsedMs !== 'number' || !isFinite(elapsedMs) || elapsedMs < 0 || Math.floor(elapsedMs) !== elapsedMs) return { ok: false, reason: 'backup-unreadable', message: '备份耗时读不出来，不签票、不执行重写。' }
  const atMs: number = typeof a.atMs === 'number' && isFinite(a.atMs) ? a.atMs : 0
  const point: BackupPoint = { kind: kind as BackupKind, required: true, path: pathText, bytes: bytes, elapsedMs: elapsedMs, atMs: atMs }
  return { ok: true, point: point }
}

/** 备份点的摘要输入：执行回包与确认卡两份要对得上（换了路径或大小就不许当成同一次备份）。 */
export function backupPointDigestInput(point: any): string {
  const p: any = point || {}
  return JSON.stringify({
    kind: String(p.kind || ''),
    path: String(p.path || ''),
    bytes: Number(p.bytes) || 0,
  })
}

/** 人读的字节数：1.0 MB / 12 KB / 800 B；界面直接显示，不再各处换算。 */
export function humanBytesOf(value: any): string {
  const n: number = Number(value) || 0
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return String(Math.round(n)) + ' B'
}

/** 备份点的一句话摘要：确认卡、执行回包、任务残留说明共用这一句。 */
export function backupSummaryOf(point: any): string {
  const p: any = point || {}
  const way: string = p.kind === 'bundle' ? '整仓打包' : '镜像克隆'
  return way + '备份在 ' + String(p.path || '') + '，大小 ' + humanBytesOf(p.bytes) + '，耗时 ' + String(Number(p.elapsedMs) || 0) + ' 毫秒'
}

/**
 * 从备份重建仓库的步骤：界面原样展示，但绝不自动执行——规格写明不提供自动恢复。
 * 镜像克隆与整仓打包都能被 git clone 直接吃下，所以两者是同一句。
 */
export function backupRestoreStepsOf(point: any): string[] {
  const p: any = point || {}
  const target: string = String(p.path || '')
  if (target === '') return []
  return [
    'git clone ' + target + ' <新的仓库目录>',
    '核对恢复出来的提交号与备份说明里的一致，再决定是否用它替换当前仓库',
    '面板只给步骤、不执行恢复：规格要求整仓重写不提供自动恢复',
  ]
}
