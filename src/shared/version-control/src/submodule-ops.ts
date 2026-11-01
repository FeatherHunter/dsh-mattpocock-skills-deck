// 子模块域（域 10，八条能力）的纯判定层（#1757 T21）。
//
// 这一层不碰进程、不碰文件、不碰界面：宿主侧的读数、预检、执行与任务电话，客户端侧的动作表、
// 固定菜单与页面，都从这里取同一份动作清单、同一套参数守卫与同一个判定函数。集中在这里的原因
// 是票面的三条硬要求：
//   1. 10.4 禁止的是「给用户一个 foreach 任意命令入口」，不是禁止这条固定菜单本身：
//      批量只给四个固定菜单，调用方只能挑菜单号，不能送命令字符串。唯一用到 foreach 的
//      「逐个抓取」，其完整 argv（submodule foreach --recursive git fetch）写成字面量常量
//      SUBMODULE_FETCH_ARGV，放在任务协议层，没有任何字段能改命令形状或追加子命令。
//   2. 写动作三段式：预检（submoduleJudge）与执行共用同一份 plan 与同一个 argv 拼装，
//      界面上「为什么不能点」与宿主真正执行的理由同源，不会漂移。
//   3. 地址里可能带账号口令：解析、展示、票据摘要都只用抹掉口令的版本，原文只用于执行那一次。
//
// 约定（改了会坏的地方）：
//   · 本文件是客户端拼接片段，不能 import 任何模块，也不许用 Node 内置；同一份源码同时被宿主
//     （tsconfig 含本目录）与客户端闭包（esbuild 拼接）编译，所以只能写自包含的纯函数。
//   · 动作清单是唯一真源：页面入口、宿主预检白名单、门禁三处都读它，另写一份就会漂移。
//   · 返回的行是给界面直接画的：路径、地址、分支都是抹过口令、限过长度的文本。

/** 域 10 八条能力号。票面 10.5/10.6/10.7 的次序与账本不同，这里以账本与规格正文域 10 为准。 */
export const SUBMODULE_CAP_IDS = ['10.1', '10.2', '10.3', '10.4', '10.5', '10.6', '10.7', '10.8']

/** 一条子模块动作。id 是动作名（不是能力号：10.3 有三条、10.4 是四项菜单），kind 决定走哪条通道。 */
export type SubmoduleAction = {
  id: string
  capId: string
  /** read=只读刷新；write=凭票写电话 wf.gitSubmoduleWrite；task=走 T05 长任务通道。 */
  kind: 'read' | 'write' | 'task'
  /** page=页面级入口；row=逐行动作；batch=固定四项批量菜单。 */
  place: 'page' | 'row' | 'batch'
  /** 这个动作要用户填哪些字段；空数组表示不需要任何输入。 */
  needs: string[]
  danger: boolean
  confirm: boolean
  taskOp: string | null
}

/**
 * 八条能力的全部动作，一个不多一个不少。
 * 10.3 的「初始化并检出 / 检出记录的提交 / 更新到远端最新」是三条独立动作：git 的 argv 不同、
 *   能不能在未初始化的目录上跑也不同，合并成一条会让人分不清自己点的是哪一件事。
 * 10.4 的批量执行不在本表（place=batch 的动作只有菜单），因为它的四项是页面级菜单而不是逐行动作。
 */
export const SUBMODULE_ACTIONS: SubmoduleAction[] = [
  { id: 'status', capId: '10.1', kind: 'read', place: 'page', needs: [], danger: false, confirm: false, taskOp: null },
  { id: 'add', capId: '10.2', kind: 'task', place: 'page', needs: ['path', 'url'], danger: false, confirm: true, taskOp: 'submodule-add' },
  { id: 'init', capId: '10.3', kind: 'task', place: 'row', needs: ['path'], danger: false, confirm: true, taskOp: 'submodule-init' },
  { id: 'recorded', capId: '10.3', kind: 'task', place: 'row', needs: ['path'], danger: false, confirm: true, taskOp: 'submodule-update' },
  { id: 'remote', capId: '10.3', kind: 'task', place: 'row', needs: ['path'], danger: false, confirm: true, taskOp: 'submodule-remote-update' },
  { id: 'fetch', capId: '10.4', kind: 'task', place: 'batch', needs: [], danger: false, confirm: true, taskOp: 'submodule-fetch' },
  { id: 'set-url', capId: '10.5', kind: 'write', place: 'row', needs: ['path', 'url'], danger: false, confirm: true, taskOp: null },
  { id: 'sync', capId: '10.5', kind: 'write', place: 'row', needs: ['path'], danger: false, confirm: true, taskOp: null },
  { id: 'set-branch', capId: '10.6', kind: 'write', place: 'row', needs: ['path', 'branch'], danger: false, confirm: true, taskOp: null },
  { id: 'deinit', capId: '10.7', kind: 'write', place: 'row', needs: ['path'], danger: true, confirm: true, taskOp: null },
  { id: 'absorb', capId: '10.8', kind: 'write', place: 'row', needs: ['path'], danger: true, confirm: true, taskOp: null },
]

/** 凭票写电话能做的五个动作（执行层只认这五个，其余一律拒绝）。 */
export const SUBMODULE_WRITE_OPS = ['set-url', 'sync', 'set-branch', 'deinit', 'absorb']

/** 走长任务通道的五个动作（逐行四个 + 新增一个；批量菜单另算）。 */
export const SUBMODULE_TASK_OPS = ['add', 'init', 'recorded', 'remote', 'fetch']

/**
 * 10.4 的固定四项批量菜单。每项只有菜单号与写死的任务动作，没有字段、没有命令输入框。
 * 看状态不是任务，直接重读面板；其余三项走 T05 任务通道（argv 在 submoduleTaskOf 里写死）。
 */
export const SUBMODULE_BATCH_MENU = [
  { id: 'init', capId: '10.4', taskOp: 'submodule-init', labelKey: 'vc.sub.batch.init' },
  { id: 'fetch', capId: '10.4', taskOp: 'submodule-fetch', labelKey: 'vc.sub.batch.fetch' },
  { id: 'recorded', capId: '10.4', taskOp: 'submodule-update', labelKey: 'vc.sub.batch.recorded' },
  { id: 'status', capId: '10.4', taskOp: null, labelKey: 'vc.sub.batch.status' },
]

/** 子模块读数回包的契约名与版本号；形状不对整包不认。 */
export const SUBMODULE_BOARD_CONTRACT = 'version-control.submodule-board'
export const SUBMODULE_BOARD_VERSION = 1

/** 预检回包的契约名与版本号（与 #1746 分支域同一套三段式口径）。 */
export const SUBMODULE_CHECK_CONTRACT = 'version-control.submodule-check'
export const SUBMODULE_CHECK_VERSION = 1

/** 失败与禁用原因的固定标识符表；界面按 vc.sub.why.<理由> 取词条，不自己拼人话。 */
export const SUBMODULE_REASONS = [
  'ok',
  'path-blank',
  'path-bad',
  'url-blank',
  'url-bad',
  'url-credentials',
  'branch-blank',
  'branch-bad',
  'module-missing',
  'module-not-initialized',
  'module-exists',
  'target-exists',
  'nothing-to-absorb',
  'local-commits',
  'unknown-action',
  'confirm-required',
]

/** 按菜单号取固定批量菜单项；不是四个固定菜单之一回 null（调用方据此拒绝，绝不把菜单号当命令）。 */
export function submoduleBatchMenuOf(id: any): any {
  if (typeof id !== 'string') return null
  for (const item of SUBMODULE_BATCH_MENU) if (item.id === id) return item
  return null
}

/** 按动作名取动作定义；不在表里回 null，调用方据此给 unknown-action 而不是落到别的分支。 */
export function submoduleActionOf(id: any): SubmoduleAction | null {
  if (typeof id !== 'string') return null
  for (const item of SUBMODULE_ACTIONS) if (item.id === id) return item
  return null
}

/** 稳定序列化：对象按键排序、数组保序、undefined 当 null；用于票据摘要与比较，不用于展示。 */
export function submoduleStableValue(value: any): string {
  function walk(v: any): string {
    if (v === undefined || v === null) return 'null'
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'null'
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'string') return JSON.stringify(v)
    if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']'
    if (typeof v === 'object') {
      const keys = Object.keys(v).sort()
      const parts: string[] = []
      for (const k of keys) parts.push(JSON.stringify(k) + ':' + walk(v[k]))
      return '{' + parts.join(',') + '}'
    }
    return 'null'
  }
  return walk(value)
}

/** 子模块路径守卫：必须是仓库内相对路径。绝对路径、上跳段、短横线开头、控制字符都拒。 */
export function submodulePathProblem(value: any): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'path-blank'
  if (value.length > 4096) return 'path-bad'
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'path-bad'
  if (/^[-+]/.test(value)) return 'path-bad'
  if (/^[\\/]/.test(value)) return 'path-bad'
  if (/^[A-Za-z]:/.test(value)) return 'path-bad'
  const segments = value.split(/[\\/]/)
  for (const seg of segments) if (seg === '..') return 'path-bad'
  return null
}

/** 地址守卫：空、控制字符、空白、短横线开头的选项注入都拒；scheme 与相对地址都允许。 */
export function submoduleUrlProblem(value: any): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'url-blank'
  if (value.length > 4096) return 'url-bad'
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return 'url-bad'
  if (/^[-+]/.test(value)) return 'url-bad'
  return null
}

/** 跟踪分支守卫：空、空白、控制字符、短横线或加号开头、上跳段都拒。 */
export function submoduleBranchProblem(value: any): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'branch-blank'
  if (value.length > 4096) return 'branch-bad'
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return 'branch-bad'
  if (/^[-+]/.test(value)) return 'branch-bad'
  if (value.indexOf('..') >= 0 || value.indexOf(':') >= 0) return 'branch-bad'
  return null
}

/** 地址里是否带账号口令（scheme://user:secret@host 这一种才算；ssh 的 user@host 不算口令）。 */
export function submoduleUrlHasCredentials(value: any): boolean {
  const text = typeof value === 'string' ? value : ''
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/.test(text)
}

/** 展示与票据摘要用的地址：把账号口令抹成两个星号，其余原样保留。 */
export function submoduleRedactUrl(value: any): string {
  let text = typeof value === 'string' ? value : ''
  if (submoduleUrlHasCredentials(text)) text = text.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]*@/, '$1**@')
  return text.length > 400 ? text.slice(0, 400) + '…' : text
}

/** 读状态用的 argv：递归列出全部子模块（含未初始化与与记录不同的）。 */
export function submoduleStatusArgs(): string[] {
  return ['submodule', 'status', '--recursive']
}

/** 读 .gitmodules 配置的 argv：一次取出 path/url/branch，避免每个子模块起一趟进程。 */
export function submoduleConfigArgs(): string[] {
  return ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\.']
}

/**
 * 解析 git submodule status --recursive 的输出。
 * 每行形如「 <oid> <path> (<describe>)」，首字符是状态：空格=已初始化且与记录一致，
 * - = 未初始化，+ = 与记录的提交不同，U = 合并冲突。路径可能带空格，所以按首个空白切成
 * oid 与「路径 (describe)」两段，再从末尾的括号倒着切路径，不按空白 split 整行。
 */
export function submoduleParseStatus(text: any): any {
  const s = typeof text === 'string' ? text : ''
  const lines = s.split(/\r?\n/)
  const rows: any[] = []
  for (const raw of lines) {
    const line = String(raw)
    if (line.length < 3) continue
    const mark = line.charAt(0)
    if (mark !== ' ' && mark !== '-' && mark !== '+' && mark !== 'U') continue
    const rest = line.slice(1)
    const spaceAt = rest.indexOf(' ')
    if (spaceAt < 0) continue
    const oid = rest.slice(0, spaceAt)
    let path = rest.slice(spaceAt + 1)
    let describe = ''
    const close = path.lastIndexOf(')')
    const open = path.lastIndexOf(' (', close)
    if (close === path.length - 1 && open >= 0) {
      describe = path.slice(open + 2, close)
      path = path.slice(0, open)
    }
    path = path.trim()
    if (path.length === 0) continue
    const states: any = { ' ': 'clean', '-': 'uninitialized', '+': 'different', 'U': 'conflict' }
    rows.push({ path: path, oid: oid, state: states[mark], describe: describe })
  }
  return { ok: true, rows: rows }
}

/**
 * 解析 git config -f .gitmodules --get-regexp 的输出。
 * 每行是「submodule.<name>.<key> <value>」，值可能含空格（URL、分支一般不含），所以按第一个
 * 空白切键与值，键再按点切成三段；不认识的键忽略，不整包失败。
 */
export function submoduleParseConfig(text: any): any {
  const s = typeof text === 'string' ? text : ''
  const modules: any[] = []
  const byName: any = {}
  for (const raw of s.split(/\r?\n/)) {
    const line = String(raw).trim()
    if (line.length === 0) continue
    const spaceAt = line.indexOf(' ')
    if (spaceAt <= 0) continue
    const key = line.slice(0, spaceAt)
    const value = line.slice(spaceAt + 1)
    // 键的形状是 submodule.<名字>.<字段>；名字本身可能带斜杠（子模块路径）或转义后的点，
    // 所以按「去掉前缀、再从最后一个点切字段」来解，不按点整段 split。
    if (key.indexOf('submodule.') !== 0) continue
    const rest = key.slice('submodule.'.length)
    const dotAt = rest.lastIndexOf('.')
    if (dotAt <= 0) continue
    const name = rest.slice(0, dotAt)
    const field = rest.slice(dotAt + 1)
    if (!byName[name]) { byName[name] = { name: name, path: '', url: '', branch: '' }; modules.push(byName[name]) }
    if (field === 'path') byName[name].path = value
    else if (field === 'url') byName[name].url = value
    else if (field === 'branch') byName[name].branch = value
  }
  return { ok: true, modules: modules }
}

/**
 * 把状态行、配置行与逐个子模块的补充事实拼成界面行。
 * facts 是宿主额外读到的：headBranch/detached/localCommits/absorbable/absorbFrom/absorbTo。
 * 以状态行为主：配置里有但状态里没有的（没登记到 .gitmodules 的残留目录）不凭空造行。
 */
export function submoduleRowsOf(statusRows: any, modules: any, facts: any): any[] {
  const list = Array.isArray(statusRows) ? statusRows : []
  const modList = Array.isArray(modules) ? modules : []
  const byPath: any = {}
  for (const m of modList) if (m && typeof m.path === 'string') byPath[m.path] = m
  const factMap = facts && typeof facts === 'object' ? facts : {}
  const rows: any[] = []
  for (const st of list) {
    if (!st || typeof st.path !== 'string') continue
    const mod = byPath[st.path] || null
    const f = factMap[st.path] || {}
    const url = mod ? String(mod.url || '') : ''
    rows.push({
      name: mod ? String(mod.name || st.path) : st.path,
      path: st.path,
      oid: String(st.oid || ''),
      state: String(st.state || 'uninitialized'),
      initialized: st.state !== 'uninitialized',
      describe: String(st.describe || ''),
      url: url,
      urlDisplay: submoduleRedactUrl(url),
      branch: mod ? String(mod.branch || '') : '',
      headBranch: f.headBranch ? String(f.headBranch) : '',
      detached: f.detached === true,
      localCommits: typeof f.localCommits === 'number' && isFinite(f.localCommits) ? f.localCommits : 0,
      absorbable: f.absorbable === true,
      absorbFrom: f.absorbFrom ? String(f.absorbFrom) : '',
      absorbTo: f.absorbTo ? String(f.absorbTo) : '',
    })
  }
  rows.sort(function (a: any, b: any): number { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0 })
  return rows
}

/** 现场摘要：票据绑定用，行变了摘要就变，执行前逐字比对。 */
export function submoduleDigestOf(rows: any): string {
  const list = Array.isArray(rows) ? rows : []
  const compact = list.map(function (r: any): any {
    return [r.path, r.oid, r.state, r.urlDisplay, r.branch, r.headBranch, r.detached ? 1 : 0, r.localCommits, r.absorbable ? 1 : 0]
  })
  return submoduleStableValue(compact)
}

/** 给人看的一句话现场：几行、几个已初始化、几个分离头指针。失败与禁用理由旁边用它。 */
export function submoduleSceneSummary(rows: any): string {
  const list = Array.isArray(rows) ? rows : []
  let initialized = 0
  let detached = 0
  for (const r of list) {
    if (r && r.initialized === true) initialized += 1
    if (r && r.initialized === true && r.detached === true) detached += 1
  }
  return '共 ' + list.length + ' 个子模块，已初始化 ' + initialized + ' 个，分离头指针 ' + detached + ' 个'
}

/** 判定结果：decision 决定界面画不画禁用原因，reasons 按固定标识符表给词条键。 */
export function submoduleJudge(op: any, ctx: any): any {
  const action = submoduleActionOf(op)
  const c = ctx && typeof ctx === 'object' ? ctx : {}
  const rows = Array.isArray(c.rows) ? c.rows : []
  function rowOf(path: any): any {
    if (typeof path !== 'string') return null
    for (const r of rows) if (r && r.path === path) return r
    return null
  }
  function allow(): any { return { decision: 'allow', reasons: [] } }
  function warn(reason: string): any { return { decision: 'warn', reasons: [reason] } }
  function block(reason: string): any { return { decision: 'block', reasons: [reason] } }
  if (!action) return block('unknown-action')
  if (action.id === 'status') return allow()
  // 批量菜单的动作不需要任何字段：命令写死在任务协议里，判定只看菜单本身合不合法。
  if (action.place === 'batch') return allow()
  const pathProblem = submodulePathProblem(c.path)
  if (pathProblem) return block(pathProblem)
  const row = rowOf(c.path)
  if (action.id === 'add') {
    const urlProblem = submoduleUrlProblem(c.url)
    if (urlProblem) return block(urlProblem)
    if (row) return block('module-exists')
    if (c.targetExists === true && c.targetEmpty !== true) return block('target-exists')
    if (submoduleUrlHasCredentials(c.url)) return warn('url-credentials')
    return allow()
  }
  if (!row) return block('module-missing')
  if (action.id === 'set-url') {
    const urlProblem = submoduleUrlProblem(c.url)
    if (urlProblem) return block(urlProblem)
    if (submoduleUrlHasCredentials(c.url)) return warn('url-credentials')
    return allow()
  }
  if (action.id === 'set-branch') {
    const branchProblem = submoduleBranchProblem(c.branch)
    if (branchProblem) return block(branchProblem)
    return allow()
  }
  if (action.id === 'deinit') {
    if (row.initialized !== true) return block('module-not-initialized')
    if (row.localCommits > 0 && row.detached === true) return warn('local-commits')
    return allow()
  }
  if (action.id === 'absorb') {
    if (row.initialized !== true) return block('module-not-initialized')
    if (row.absorbable !== true) return block('nothing-to-absorb')
    return allow()
  }
  // 剩下的是更新/抓取一族（init/recorded/remote/fetch）：未初始化时只有 init 能跑。
  if (action.id !== 'init' && row.initialized !== true) return block('module-not-initialized')
  return allow()
}

/**
 * 把界面送来的字段规范化成一份计划：只保留这个动作需要的字段，去首尾空白，缺字段给固定理由。
 * 计划是票据绑定的唯一输入：执行层只按票里的计划拼 argv，客户端再送一遍参数也不采信。
 */
export function submodulePlanOf(op: any, input: any): any {
  const action = submoduleActionOf(op)
  const i = input && typeof input === 'object' ? input : {}
  if (!action) return { ok: false, reason: 'unknown-action', message: '没有这个子模块动作' }
  const plan: any = { action: action.id, capId: action.capId, kind: action.kind, path: '', url: '', branch: '' }
  if (action.needs.indexOf('path') >= 0) plan.path = String(i.path === undefined || i.path === null ? '' : i.path).trim()
  if (action.needs.indexOf('url') >= 0) plan.url = String(i.url === undefined || i.url === null ? '' : i.url).trim()
  if (action.needs.indexOf('branch') >= 0) plan.branch = String(i.branch === undefined || i.branch === null ? '' : i.branch).trim()
  const pathProblem = action.needs.indexOf('path') >= 0 ? submodulePathProblem(plan.path) : null
  if (pathProblem) return { ok: false, reason: pathProblem, message: '路径必须是仓库内的相对路径，不能为空、不能以短横线开头、不能有上跳段' }
  const urlProblem = action.needs.indexOf('url') >= 0 ? submoduleUrlProblem(plan.url) : null
  if (urlProblem) return { ok: false, reason: urlProblem, message: '子模块地址不能为空，也不能带空白或以短横线开头' }
  const branchProblem = action.needs.indexOf('branch') >= 0 ? submoduleBranchProblem(plan.branch) : null
  if (branchProblem) return { ok: false, reason: branchProblem, message: '跟踪分支不能为空、不能带空白或以短横线开头' }
  return { ok: true, plan: plan }
}

/** 票据摘要的输入：计划去掉原文地址里的口令，只留抹过的展示值。 */
export function submodulePlanDigestInput(plan: any): string {
  const p = plan && typeof plan === 'object' ? plan : {}
  return submoduleStableValue({ action: p.action, capId: p.capId, kind: p.kind, path: p.path, url: submoduleRedactUrl(p.url), branch: p.branch })
}

/** 凭票写电话的 argv：只认五个写动作，每项都是独立参数，不拼 shell 字符串。 */
export function submoduleWriteArgsOf(op: any, plan: any): any {
  const action = submoduleActionOf(op)
  const p = plan && typeof plan === 'object' ? plan : {}
  if (!action || SUBMODULE_WRITE_OPS.indexOf(String(op)) < 0) return { ok: false, reason: 'unknown-action', message: '凭票执行只接受五个子模块写动作' }
  const path = String(p.path || '')
  const pathProblem = submodulePathProblem(path)
  if (pathProblem) return { ok: false, reason: pathProblem, message: '路径不合格，不能拼进命令' }
  if (op === 'set-url') {
    const urlProblem = submoduleUrlProblem(p.url)
    if (urlProblem) return { ok: false, reason: urlProblem, message: '新地址不合格，不能拼进命令' }
    return { ok: true, args: ['submodule', 'set-url', '--', path, String(p.url)] }
  }
  if (op === 'sync') return { ok: true, args: ['submodule', 'sync', '--recursive', '--', path] }
  if (op === 'set-branch') {
    const branchProblem = submoduleBranchProblem(p.branch)
    if (branchProblem) return { ok: false, reason: branchProblem, message: '跟踪分支不合格，不能拼进命令' }
    return { ok: true, args: ['submodule', 'set-branch', '--branch', String(p.branch), '--', path] }
  }
  if (op === 'deinit') return { ok: true, args: ['submodule', 'deinit', '--', path] }
  return { ok: true, args: ['submodule', 'absorbgitdirs', '--', path] }
}

/**
 * 长任务通道的动作与参数：只认 SUBMODULE_TASK_OPS 五个动作，参数只有 path/url 两个格子。
 * 批量菜单的三项走这里时 path 为空，argv 由宿主 task-protocol 拼成不带路径的整批命令。
 */
export function submoduleTaskOf(op: any, plan: any): any {
  const p = plan && typeof plan === 'object' ? plan : {}
  // 固定批量菜单走这里：菜单号只能命中 SUBMODULE_BATCH_MENU，argv 由任务协议写死，没有任何字段能改命令。
  if (p.batch === true) {
    const menu: any = submoduleBatchMenuOf(op)
    if (!menu || !menu.taskOp) return { ok: false, reason: 'unknown-action', message: '批量菜单里没有这个任务动作' }
    return { ok: true, op: menu.taskOp, args: {} }
  }
  const action = submoduleActionOf(op)
  if (!action || action.kind !== 'task' || !action.taskOp) return { ok: false, reason: 'unknown-action', message: '这个动作不走长任务通道' }
  const args: any = {}
  if (action.id === 'add') {
    const urlProblem = submoduleUrlProblem(p.url)
    if (urlProblem) return { ok: false, reason: urlProblem, message: '子模块地址不合格' }
    const pathProblem = submodulePathProblem(p.path)
    if (pathProblem) return { ok: false, reason: pathProblem, message: '子模块路径不合格' }
    args.url = String(p.url)
    args.path = String(p.path)
  } else if (action.id !== 'status' && action.place !== 'batch') {
    if (p.path) {
      const pathProblem = submodulePathProblem(p.path)
      if (pathProblem) return { ok: false, reason: pathProblem, message: '子模块路径不合格' }
      args.path = String(p.path)
    }
  }
  return { ok: true, op: action.taskOp, args: args }
}

/** 本文件源码位置：门禁按这份登记核对「唯一真源」这一句话。 */
export const SUBMODULE_SOURCE = 'src/shared/version-control/src/submodule-ops.ts'
