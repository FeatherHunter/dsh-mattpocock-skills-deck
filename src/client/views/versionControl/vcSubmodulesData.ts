// vcSubmodulesData.ts —— 子模块页的数据层（#1757 T21，域 10 八条）
//
// 这一层只做三件事：把宿主读数回包验成可用形状、把八条能力的页面入口列成固定表、把判定理由
// 转成词条键。不保存状态、不发电话（状态与电话在 vcSubmodulesOps，画法在 vcSubmodulesPage）。
//
// 为什么能力入口表写死在客户端：能力账本（共享层 capability-ledger）是 162 条的唯一数据源，
// 但页面要的是「这一页的八条按什么顺序摆、每条点下去走哪个动作」，这层映射不能靠运行时猜。
// 每条入口的 capId 必须与能力账本一致；门禁 D2 断的就是这条顺序与条数。
//
// 约定：本文件由 scripts/build.mts 作为拼接片段并进客户端闭包，不写 import；
// 共享判定层的 SUBMODULE_* 常量与能力账本查询 vcCapabilityOf 在闭包里直接可用。
declare function vcCapabilityOf(id: any): any
declare const SUBMODULE_ACTIONS: any[]
declare const SUBMODULE_CAP_IDS: string[]
declare const SUBMODULE_REASONS: string[]
declare const SUBMODULE_BATCH_MENU: any[]
declare const SUBMODULE_BOARD_CONTRACT: string
declare const SUBMODULE_BOARD_VERSION: number

export const VC_SUBMODULES_DATA_SOURCE = 'src/client/views/versionControl/vcSubmodulesData.ts'

/** 子模块域四条电话（与宿主 src/host/index.ts 注册的名字逐字一致）。 */
export const VC_SUBMODULES_PHONES = {
  read: 'wf.gitSubmodules',
  check: 'wf.gitSubmoduleCheck',
  write: 'wf.gitSubmoduleWrite',
  task: 'wf.gitSubmoduleTask',
}

/** 页面十态：读数中、有读数、确认中、执行中、完成、失败、被拦、空、重读中、失效。 */
export const VC_SUBMODULE_MODES = ['idle', 'reading', 'board', 'confirm', 'running', 'done', 'failed', 'blocked', 'empty', 'stale']

/**
 * 八条能力在页面上的主入口。capId 顺序照能力账本 10.1–10.8；actionId 是点下去要预览的动作，
 * 批量入口（10.4）不进逐条动作表（actionId 为 batch 标记，页面另画四项固定菜单）。
 */
export const VC_SUBMODULE_ENTRIES = [
  { capId: '10.1', actionId: 'status', labelKey: 'vc.sub.entry.10.1' },
  { capId: '10.2', actionId: 'add', labelKey: 'vc.sub.entry.10.2' },
  { capId: '10.3', actionId: 'init', labelKey: 'vc.sub.entry.10.3' },
  { capId: '10.4', actionId: 'fetch', labelKey: 'vc.sub.entry.10.4' },
  { capId: '10.5', actionId: 'set-url', labelKey: 'vc.sub.entry.10.5' },
  { capId: '10.6', actionId: 'set-branch', labelKey: 'vc.sub.entry.10.6' },
  { capId: '10.7', actionId: 'deinit', labelKey: 'vc.sub.entry.10.7' },
  { capId: '10.8', actionId: 'absorb', labelKey: 'vc.sub.entry.10.8' },
]

/** 读数回包形状：契约名与版本号都对、rows 是数组才算一次可用读数；否则整包不认（旧读数不当新读数）。 */
export function vcSubmoduleBoardShapeOk(board: any): boolean {
  if (!board || typeof board !== 'object') return false
  if (board.ok !== true) return false
  if (board.contract !== SUBMODULE_BOARD_CONTRACT) return false
  if (board.version !== SUBMODULE_BOARD_VERSION) return false
  return Array.isArray(board.rows)
}

/** 行模型：只取页面要用的字段，缺字段给安全默认值（宿主版本旧一点也不会画出空白）。 */
export function vcSubmoduleRowsOf(board: any): any[] {
  const rows: any[] = board && Array.isArray(board.rows) ? board.rows : []
  return rows.map(function (r: any): any {
    const row: any = r || {}
    return {
      name: String(row.name || ''),
      path: String(row.path || ''),
      oid: String(row.oid || ''),
      state: String(row.state || ''),
      initialized: row.initialized === true,
      describe: String(row.describe || ''),
      url: String(row.url || ''),
      urlDisplay: String(row.urlDisplay || row.url || ''),
      branch: String(row.branch || ''),
      headBranch: String(row.headBranch || ''),
      detached: row.detached === true,
      localCommits: typeof row.localCommits === 'number' ? row.localCommits : 0,
      absorbable: row.absorbable === true,
      absorbFrom: String(row.absorbFrom || ''),
      absorbTo: String(row.absorbTo || ''),
    }
  })
}

/** 逐行动作：只取 place=row 的动作（页面级与批量菜单不混进每一行）。 */
export function vcSubmoduleRowActionsOf(): any[] {
  const out: any[] = []
  for (let i = 0; i < SUBMODULE_ACTIONS.length; i += 1) {
    const a: any = SUBMODULE_ACTIONS[i]
    if (a && a.place === 'row') out.push(a)
  }
  return out
}

/** 批量菜单：固定四项，原样取共享层那张表（页面只按它画按钮，不另写命令）。 */
export function vcSubmoduleBatchOf(): any[] {
  const out: any[] = []
  for (let i = 0; i < SUBMODULE_BATCH_MENU.length; i += 1) out.push(SUBMODULE_BATCH_MENU[i])
  return out
}

/** 理由标识符 → 词条键；不在固定表里的按 ok 处理（绝不把外部字符串拼进键）。 */
export function vcSubmoduleWhyKeyOf(reason: any): string {
  const id: string = String(reason === undefined || reason === null ? '' : reason)
  return SUBMODULE_REASONS.indexOf(id) >= 0 ? 'vc.sub.why.' + id : 'vc.sub.why.ok'
}

/** 一条能力的账本信息（名称与最低版本）；账本里没有就给空壳，页面不至于崩。 */
export function vcSubmoduleCapOf(capId: any): any {
  try { const cap: any = vcCapabilityOf(capId); return cap || { id: String(capId), name: '', minVersion: '' } } catch (e) { return { id: String(capId), name: '', minVersion: '' } }
}

/** 读数四态：ok=可用，error=回包有问题，idle=还没读。 */
export function vcSubmodulesStateOf(board: any): string {
  if (!board) return 'idle'
  if (board.state === 'ok' && vcSubmoduleBoardShapeOk(board.board)) return 'ok'
  if (board.state === 'error') return 'error'
  if (board.state === 'loading' || board.state === 'reading') return 'loading'
  return 'idle'
}

/** 界面状态的缺省形状：页面与处理层共用同一份，字段少一个就补一个。 */
export function vcSubmodulesUiOf(ui: any): any {
  const u: any = ui && typeof ui === 'object' ? ui : {}
  const field: any = u.field && typeof u.field === 'object' ? u.field : {}
  return {
    mode: VC_SUBMODULE_MODES.indexOf(String(u.mode || '')) >= 0 ? String(u.mode) : 'idle',
    op: String(u.op || ''),
    batch: u.batch === true,
    field: { path: String(field.path || ''), url: String(field.url || ''), branch: String(field.branch || ''), reason: String(field.reason || '') },
    plan: u.plan || null,
    ticket: u.ticket || null,
    decision: u.decision || null,
    reasons: Array.isArray(u.reasons) ? u.reasons : [],
    result: u.result || null,
    error: u.error || null,
    requestId: String(u.requestId || ''),
  }
}

export const VC_SUBMODULES_DATA_EXPORTS = 'vcSubmodulesData'
