// views/versionControl/vcRealManage.ts —— 真实页签的管理分区与侧页状态模型（#1776 M2）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这一层只做三件事，不碰宿主电话：
//   ① 给九个管理分区、两个侧页与撤销面板各造一份初始状态（读数包与界面状态分开，换工作区时整份复位）；
//   ② 把分散在各域读数包里的槽拼成一份「页面壳能读的读数」，壳的读法不变（remote / sync / migrate / branch 等槽）；
//   ③ 把管理页各自要的画法模型拼好（冲突、变基、任务面板），容器只再挂回调与处理器。
// 动作一律由 vcRealManageActions.ts 与 vcRealManageActions2.ts 发；这里不出现任何电话名。

declare const tr: any
declare function vcNewBranchRead(): any
declare function vcBranchBoardOf(reads: any): any
declare function vcNewRemoteReads(): any
declare function vcNewSyncReads(): any
declare function vcNewMigrateReads(): any
declare function vcNewMigrateExport(): any
declare function vcNewPlatformReads(): any
declare function vcConfigStateNew(): any
declare function vcSubmodulesUiOf(ui: any): any
declare function vcDiagnosticsStateNew(): any
declare function vcUndoStateNew(): any

// 冲突向导的状态：state 是进行中操作的名字（空串表示没有进行中的操作），reads 存「冲突清单」那条只读回包，
//   values 是页面输入，rows 是十五条动作各自的结果与确认卡。页面按 c.reads['conflict-list'] 取清单。
export const vcRealConflictsNew = function (): any {
  return { state: '', reads: {}, values: { target: '', path: '', side: 'ours', text: '' }, rows: {}, errorText: '' }
}

// 变基页的状态：state 是 rebase-state 读数，rows 是待办行数组（页面把同一字段当待办清单用），
//   values 是三个基座输入，confirm/ ticketId 是确认卡素材，actions 是每条动作的结果。
export const vcRealRebaseNew = function (): any {
  return { state: { state: null, branch: '', headOid: '', updateRefs: false }, reads: {}, values: { base: '', oldBase: '', newBase: '' }, rows: [], actions: {}, confirmOp: '', confirm: null, ticketId: '', errorText: '' }
}

// 九个管理分区 + 两个侧页 + 撤销面板的初始状态。读数包各自独立（remote/sync/migrate/platform 不共用槽），
//   因为同步任务与迁移任务都叫 task，混在一个包里会互相覆盖。
export const vcRealManageNew = function (): any {
  return {
    branch: vcNewBranchRead(),
    remote: vcNewRemoteReads(),
    sync: vcNewSyncReads(),
    migrate: vcNewMigrateReads(),
    migrateExport: vcNewMigrateExport(),
    migratePatches: vcNewPlatformReads(),
    platform: vcNewPlatformReads(),
    config: vcConfigStateNew(),
    submodules: { board: { state: 'idle', board: null, error: null }, ui: vcSubmodulesUiOf(null) },
    conflicts: vcRealConflictsNew(),
    rebase: vcRealRebaseNew(),
    undo: vcUndoStateNew(),
    tasks: { items: [], running: 0 },
    readsDone: {},
    branchConfirm: null,
    branchResult: null,
    branchPending: null,
    remoteConfirm: '',
    confirm: null,
    rebaseConfirm: null,
  }
}

// 管理页要往整份 ui 上放的字段：远端表单三件、同步/迁移共用的展开项与结果、迁移字段表、平台请求拉取三格、
//   诊断动作状态（vcDiagnosticsActionsOf 自己把状态放在 ui.diagnostics 里）。
export const vcRealManageUiNew = function (): any {
  return {
    form: '', target: '', problem: '', result: null,
    open: '', openAction: '', fields: {},
    rpStart: '', rpUrl: '', rpEnd: '',
    diagnostics: vcDiagnosticsStateNew(),
  }
}

// 一次请求号（重放去重用）：宿主只要求 [A-Za-z0-9_-] 且不超过 64，重试换新的请求号。
export const vcRealRequestIdOf = function (nowMs: any, salt: any): string {
  const ms: number = Number(nowMs || 0)
  return 'r' + ms.toString(36) + String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
}

// 管理页读数合并成壳要的那一份：壳的远端页读 reads.remote / reads.online，同步段读 reads.sync / reads.task，
//   迁移页读 reads.migrate，分支板读 reads.branch，平台页读 opts.platform（不走这里）。
export const vcRealManageShellReadsOf = function (reads: any, m: any): any {
  const base: any = reads || {}
  const mm: any = m || {}
  const remote: any = mm.remote || {}
  const sync: any = mm.sync || {}
  const migrate: any = mm.migrate || {}
  const platform: any = mm.platform || {}
  return Object.assign({}, base, {
    branch: mm.branch || base.branch,
    remote: remote.remote || base.remote,
    online: remote.online || base.online,
    sync: sync.sync || base.sync,
    task: sync.task || base.task,
    migrate: migrate.migrate || base.migrate,
    platform: platform.platform || base.platform,
    requestPull: platform.requestPull || base.requestPull,
    patches: platform.patches || base.patches,
  })
}

// 进入某一页要先读哪一类数据：空串表示这一页自给自足（维护页、搜索页），不用容器先读。
export const vcRealManageNeedReadOf = function (page: any): string {
  const p: string = String(page || '')
  if (p === 'branch-tags') return 'branch'
  if (p === 'remote') return 'remote'
  if (p === 'submodules') return 'submodules'
  if (p === 'migrate') return 'migrate'
  if (p === 'config' || p === 'hooks') return 'config'
  if (p === 'diagnostics') return 'diagnostics'
  if (p === 'platform') return 'platform'
  if (p === 'conflicts') return 'conflicts'
  if (p === 'rebase') return 'rebase'
  return ''
}

// 冲突页模型：页面要的字段就是这六个，handlers 由容器在动作层造好后挂上。
export const vcRealConflictsModelOf = function (c: any): any {
  const cc: any = c || {}
  return {
    state: String(cc.state || ''),
    reads: cc.reads || {},
    values: cc.values || { target: '', path: '', side: 'ours', text: '' },
    rows: cc.rows || {},
    error: false,
    errorText: String(cc.errorText || ''),
  }
}

// 变基页模型：rows 传待办行数组（页面用它画待办窗口），每条动作的结果放在 actions 里；
//   页面自身把 rows[op] 当对象读结果，这里补一层兼容：rows 同时挂一个 op 键的对象会让待办清单画不出来，
//   所以结果只走 errorText（失败原因）与行内确认卡，动作结果由动作层落到确认卡后的提示里。
export const vcRealRebaseModelOf = function (r: any): any {
  const rr: any = r || {}
  return {
    state: rr.state || { state: null, branch: '', headOid: '', updateRefs: false },
    reads: rr.reads || {},
    values: rr.values || { base: '', oldBase: '', newBase: '' },
    rows: Array.isArray(rr.rows) ? rr.rows : [],
    confirmOp: String(rr.confirmOp || ''),
    confirm: rr.confirm || null,
    ticketId: String(rr.ticketId || ''),
    errorText: String(rr.errorText || ''),
  }
}

// 管理页要传给壳的那一份数据：只放读数与状态，回调由容器逐帧挂（它们要闭在 actions 上）。
export const vcRealManagePropsOf = function (reads: any, ui: any, m: any): any {
  const mm: any = m || {}
  const branches: any = { branch: mm.branch }
  return {
    reads: vcRealManageShellReadsOf(reads, mm),
    branchBoard: vcBranchBoardOf(branches),
    branchConfirm: mm.branchConfirm || null,
    branchResult: mm.branchResult || null,
    platform: mm.platform || vcNewPlatformReads(),
    platformUi: ui || {},
    config: mm.config || vcConfigStateNew(),
    hooks: mm.config || vcConfigStateNew(),
    submodules: mm.submodules ? mm.submodules.board : null,
    submoduleUi: mm.submodules ? mm.submodules.ui : vcSubmodulesUiOf(null),
    migrate: mm.migrateExport || vcNewMigrateExport(),
    migrateReads: mm.migratePatches || vcNewPlatformReads(),
    conflicts: vcRealConflictsModelOf(mm.conflicts),
    rebase: vcRealRebaseModelOf(mm.rebase),
    undo: mm.undo || vcUndoStateNew(),
    tasks: mm.tasks && Array.isArray(mm.tasks.items) ? mm.tasks.items : [],
    running: mm.tasks && typeof mm.tasks.running === 'number' ? mm.tasks.running : 0,
  }
}

export const VC_REAL_MANAGE_SOURCE = 'src/client/views/versionControl/vcRealManage.ts'