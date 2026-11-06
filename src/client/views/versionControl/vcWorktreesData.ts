// src/client/views/versionControl/vcWorktreesData.ts —— 工作树页的数据层（#1752 T17）
//
// 这一层只做「读数 → 页面模型」的换算，不发电话、不碰 DOM、不改状态：
//   · 清单与四态来自首屏快照里的 worktrees / workspace 两片（T04 一次取全的那一份，不另读一遍）；
//   · 版本门来自 version 片里的 switches（宿主已用共享层 capabilityAvailability 算好，界面不另写一份）；
//   · 行模型、prune 清单、稀疏规则这些纯计算都在共享层 worktree-ops.ts，这里只挑数据、拼模型。
//
// 为什么按钮能不能点也从这里算：规格第 4 节要求「禁用原因与核心判定函数同源，界面不自己另判一遍」。
// 所以这里直接调共享层的 worktreeJudge（宿主预检调的是同一个函数），界面拿到的 block 理由与宿主
// 预检拒绝的理由是同一套标识符；文案在 config/copy/vcworktrees.yaml 的 vc.wt.why.<标识符>。
//
// 数据缺席时不说「可以」：版本片读不到时可用性给 null（判定按 version-unknown 拦），
// 清单读不到时模型 state 是 error，页面画失败态与重试，而不是拿空清单冒充「只有一棵工作树」。

// 下面这些名字在本文件单独过 tsc --noEmit 时看不到：构建按叶子登记次序把它们拼进同一个闭包
// （共享层 worktree-ops.ts 与 first-screen.ts 先拼、本文件后拼），运行期真实存在。这里只声明形状。
declare const CAPABILITIES: any[]
declare const WORKTREE_ACTIONS: any[]
declare const WORKTREE_CAP_IDS: string[]
declare const WORKTREE_REASONS: string[]
declare function vcFirstScreenStateOf(reads: any): string
declare function vcFirstScreenSliceStateOf(reads: any, id: any): string
declare function vcFirstScreenSliceOf(reads: any, id: any): any
declare function vcFirstScreenSliceErrorOf(reads: any, id: any): any
declare function worktreeRowsOf(others: any, current: any): any[]
declare function worktreePruneEntriesOf(rows: any): any[]
declare function worktreeJudge(op: any, ctx: any): any
declare function worktreeSamePathOf(a: any, b: any): boolean

/** 这份文件的出处：排查时凭它找到这份文件。 */
export const VC_WORKTREES_DATA_SOURCE: string = 'src/client/views/versionControl/vcWorktreesData.ts'

/** 八条能力里「要对清单里某一棵工作树动手」的那四条（其余四条是全球动作或读清单）。 */
export const VC_WORKTREE_ROW_CAP_IDS: string[] = ['9.4', '9.6', '9.7', '9.8']

/** 清单这一片的四态：ok 有读数 / loading 更新中 / idle 还没读 / error 读失败。 */
export const vcWorktreesListStateOf = function (reads: any): string {
  const slice: string = vcFirstScreenSliceStateOf(reads, 'worktrees')
  if (slice === 'ok') return 'ok'
  if (slice === 'load-fail' || slice === 'err') return 'error'
  const whole: string = vcFirstScreenStateOf(reads)
  if (whole === 'loading') return 'loading'
  return 'idle'
}

/** 整次读失败时的失败原因（片级 error 为 null 时退回整次读的 error）。 */
const vcWorktreesErrorOf = function (reads: any, sliceId: string): any {
  const sliceErr: any = vcFirstScreenSliceErrorOf(reads, sliceId)
  if (sliceErr) return sliceErr
  const r: any = reads && reads.firstScreen
  return (r && r.error) || null
}

/**
 * 把首屏两片拼成完整清单：workspace 片的当前工作树 + worktrees 片的其余几棵。
 * 拼法与宿主同一份（worktreeRowsOf），所以界面看到的顺序与宿主预检时数的对象是同一批。
 */
export const vcWorktreesSnapshotOf = function (reads: any): any {
  const state: string = vcWorktreesListStateOf(reads)
  if (state !== 'ok') return { state: state, rows: [], bare: false, error: state === 'error' ? vcWorktreesErrorOf(reads, 'worktrees') : null }
  const wt: any = vcFirstScreenSliceOf(reads, 'worktrees')
  const wsState: string = vcFirstScreenSliceStateOf(reads, 'workspace')
  if (wsState === 'err') return { state: 'error', rows: [], bare: false, error: vcWorktreesErrorOf(reads, 'workspace') }
  const others: any[] = (wt && wt.data && Array.isArray(wt.data.others)) ? wt.data.others : []
  const identity: any = (wsState === 'ok' && wsState === 'ok') ? ((vcFirstScreenSliceOf(reads, 'workspace') || {}).data || {}).identity : null
  const rows: any[] = worktreeRowsOf(others, identity)
  return { state: 'ok', rows: rows, bare: !!(wt && wt.data && wt.data.bare === true), error: null }
}

/**
 * 版本片里的能力开关：宿主只把「不是 full」的那几条放进来，所以缺号就是 full。
 * 版本片本身读不到时整份可用性按 null 处理（判定据此拦 version-unknown，不冒充能用）。
 */
export const vcWorktreesVersionOf = function (reads: any): any {
  const sliceState: string = vcFirstScreenSliceStateOf(reads, 'version')
  if (sliceState !== 'ok') {
    const state: string = sliceState === 'idle' ? 'idle' : 'error'
    return { state: state, gitVersion: '', floor: '', byId: null, error: state === 'error' ? vcWorktreesErrorOf(reads, 'version') : null }
  }
  const slice: any = vcFirstScreenSliceOf(reads, 'version')
  const data: any = (slice && slice.data) || {}
  const byId: any = {}
  const switches: any[] = Array.isArray(data.switches) ? data.switches : []
  for (let i = 0; i < switches.length; i += 1) {
    const s: any = switches[i] || {}
    byId[String(s.id || '')] = { state: String(s.state || 'unknown'), needed: String(s.needed || ''), alternative: String(s.alternative || '') }
  }
  return { state: 'ok', gitVersion: String(data.gitVersion || ''), floor: String(data.floor || ''), byId: byId, error: null }
}

/** 某条能力在给定 git 版本下的可用性；版本片读不到时回 null（judge 按 version-unknown 拦）。 */
export const vcWorktreeAvailabilityOf = function (version: any, capId: any): any {
  if (!version || version.state !== 'ok' || !version.byId) return null
  const hit: any = version.byId[String(capId) === undefined || capId === null ? '' : String(capId)]
  if (!hit) return { state: 'full', needed: '', alternative: '' }
  return hit
}

/** 能力账本里的一条（页面要它的 minVersion 与名字；账本只有一份，界面不另写一份名单）。 */
export const vcWorktreeCapOf = function (capId: any): any {
  const want: string = String(capId === undefined || capId === null ? '' : capId)
  for (let i = 0; i < CAPABILITIES.length; i += 1) if (String(CAPABILITIES[i].id) === want) return CAPABILITIES[i]
  return null
}

/** 动作编号 → 动作定义（找不到回 null，界面据此不画入口）。 */
export const vcWorktreeActionOf = function (op: any): any {
  const want: string = String(op === undefined || op === null ? '' : op)
  for (let i = 0; i < WORKTREE_ACTIONS.length; i += 1) if (WORKTREE_ACTIONS[i].id === want) return WORKTREE_ACTIONS[i]
  return null
}

/**
 * 本地分支名（按首屏 workspace 片的读数顺序）。
 * 新建表单的「已有分支」用它做候选与「本地没有这条分支」的校验；读数缺席时回空表，
 * 表单不会把「读不到分支」误当成「一条分支都没有」去拦人（缺席时只靠宿主预检给结论）。
 */
export const vcWorktreesLocalBranchesOf = function (reads: any): string[] {
  if (vcFirstScreenSliceStateOf(reads, 'workspace') !== 'ok') return []
  const slice: any = vcFirstScreenSliceOf(reads, 'workspace')
  const data: any = (slice && slice.data) || {}
  const rows: any[] = Array.isArray(data.branches) ? data.branches : []
  const out: string[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row: any = rows[i] || {}
    const name: string = String(row.short || row.name || '')
    if (name !== '' && out.indexOf(name) < 0) out.push(name)
  }
  return out
}

/**
 * 「最近用过的分支」：原型的工作区表单给最近六条候选（原型 select.ts 按每条分支最后一次提交时间倒序）。
 * 首屏 workspace 片只带分支名与 tip 提交号，不带提交时间；能对上的时间从 history 片同一份提交读数里取，
 * 对不上的（这条分支的 tip 不在首屏那一页提交里）排到后面并保持读数顺序——不编一个假时间出来。
 * 当前分支不列：它已经在当前工作区里检出，再建一次同一条分支 git 会拒绝。
 */
export const vcWorktreesRecentBranchesOf = function (reads: any, limit: any): string[] {
  const names: string[] = vcWorktreesLocalBranchesOf(reads)
  if (names.length === 0) return []
  const slice: any = vcFirstScreenSliceOf(reads, 'workspace')
  const data: any = (slice && slice.data) || {}
  const rows: any[] = Array.isArray(data.branches) ? data.branches : []
  const current: string[] = []
  for (let i = 0; i < rows.length; i += 1) if (rows[i] && rows[i].current === true) current.push(String(rows[i].short || rows[i].name || ''))
  const times: Record<string, number> = {}
  if (vcFirstScreenSliceStateOf(reads, 'history') === 'ok') {
    const hist: any = vcFirstScreenSliceOf(reads, 'history')
    const commits: any[] = Array.isArray((hist && hist.data || {}).commits) ? hist.data.commits : []
    for (let i = 0; i < commits.length; i += 1) {
      const c: any = commits[i] || {}
      if (typeof c.commitDateMs === 'number') times[String(c.oid || '')] = c.commitDateMs
    }
  }
  const scored: any[] = []
  for (let i = 0; i < names.length; i += 1) {
    const name: string = names[i]
    if (current.indexOf(name) >= 0) continue
    const row: any = rows.filter(function (r: any): boolean { return String(r && (r.short || r.name) || '') === name })[0] || {}
    const ms: number = typeof times[String(row.oid || '')] === 'number' ? times[String(row.oid || '')] : -1
    scored.push({ name: name, ms: ms, at: i })
  }
  scored.sort(function (a: any, b: any): number {
    if (a.ms !== b.ms) return b.ms - a.ms
    return a.at - b.at
  })
  const n: number = typeof limit === 'number' && limit > 0 ? limit : 6
  return scored.slice(0, n).map(function (s: any): string { return String(s.name) })
}

/** 同一个路径是不是已经登记成清单里的一棵工作树（新建表单的「目录已被占用」用这一条）。 */
export const vcWorktreesPathTakenOf = function (model: any, path: any): boolean {
  const rows: any[] = Array.isArray(model && model.rows) ? model.rows : []
  for (let i = 0; i < rows.length; i += 1) if (rows[i] && worktreeSamePathOf(rows[i].path, path)) return true
  return false
}

/** 两条路径是不是同一棵（移动表单判断「新目录和现在一样」时用；口径与宿主同一份）。 */
export const vcWorktreesPathSameOf = function (a: any, b: any): boolean {
  return worktreeSamePathOf(a, b)
}

/** 路径的最后一段（新建结果、移动结果与稀疏检出结果都要用它说人话；不引界面层的拆分函数）。 */
export const vcWorktreeBaseNameOf = function (p: any): string {
  const raw: string = String(p === undefined || p === null ? '' : p).replace(/\\/g, '/')
  const at: number = raw.lastIndexOf('/')
  return at < 0 ? raw : raw.slice(at + 1)
}

/**
 * 一条动作此刻的判定：把模型里的清单、版本开关与本次输入交给共享层 worktreeJudge。
 * 与宿主预检是同一个函数、同一套理由标识符 —— 界面画禁用原因、宿主拒绝执行都用它。
 * 界面不知道的现场（比如目标工作树脏不脏）不传，判定就不会替它猜；真要执行时宿主预检会补上。
 */
export const vcWorktreesActionDecisionOf = function (model: any, op: any, input: any): any {
  const m: any = model || {}
  const i: any = input || {}
  const action: any = vcWorktreeActionOf(op)
  const ctx: any = {
    rows: Array.isArray(m.rows) ? m.rows : [],
    availability: vcWorktreeAvailabilityOf(m.version, action ? action.capId : ''),
    targetPath: String(i.path === undefined || i.path === null ? '' : i.path),
    dest: String(i.dest === undefined || i.dest === null ? '' : i.dest),
    branch: String(i.branch === undefined || i.branch === null ? '' : i.branch),
    reason: String(i.reason === undefined || i.reason === null ? '' : i.reason),
    dirs: Array.isArray(i.dirs) ? i.dirs : [],
    prunableCount: Array.isArray(m.pruneEntries) ? m.pruneEntries.length : -1,
  }
  if (i.targetExists === true) ctx.targetExists = true
  if (i.destExists === true) ctx.destExists = true
  if (i.branchMissing === true) ctx.branchMissing = true
  if (typeof i.dirtyCount === 'number') ctx.dirtyCount = i.dirtyCount
  return worktreeJudge(op, ctx)
}

/**
 * 页面模型：清单、版本开关、八条能力的入口定义、prune 清单。
 * 数据层只算一次，页面渲染与门禁断言都拿这同一份模型。
 */
export const vcWorktreesModelOf = function (reads: any): any {
  const snapshot: any = vcWorktreesSnapshotOf(reads)
  const version: any = vcWorktreesVersionOf(reads)
  const caps: any[] = []
  for (let i = 0; i < WORKTREE_CAP_IDS.length; i += 1) {
    const capId: string = WORKTREE_CAP_IDS[i]
    const actions: any[] = WORKTREE_ACTIONS.filter(function (a: any): boolean { return String(a.capId) === capId })
    caps.push({
      capId: capId,
      cap: vcWorktreeCapOf(capId),
      actions: actions,
      availability: vcWorktreeAvailabilityOf(version, capId),
      rowTargeted: VC_WORKTREE_ROW_CAP_IDS.indexOf(capId) >= 0,
    })
  }
  // 当前工作区单独成一棵卡（原型 section.wt-current）：worktreeRowsOf 把当前树也拼进清单并标 current，
  //   这里挑出来交给版式，清单本身仍保留整份（行级动作与门禁按路径查行时不会漏掉当前树）。
  const current: any = snapshot.rows.filter(function (r: any): boolean { return r && r.current === true })[0] || null
  return {
    state: snapshot.state,
    rows: snapshot.rows,
    current: current,
    bare: snapshot.bare,
    count: snapshot.rows.length,
    error: snapshot.error,
    version: version,
    caps: caps,
    // 新建表单的两种填法要用本地分支：已有分支挑候选、校验「本地没有这条分支」；
    // 读数缺席时回空表，表单只拦明显空值，分支是否存在交给宿主预检。
    branches: vcWorktreesLocalBranchesOf(reads),
    recentBranches: vcWorktreesRecentBranchesOf(reads, 6),
    pruneEntries: worktreePruneEntriesOf(snapshot.rows),
  }
}

/** 清单某一行上能做的动作：删除、锁定、解锁、移动、看稀疏检出（按行的锁定状态挑锁还是解锁）。 */
export const vcWorktreesRowActionsOf = function (model: any, row: any): any[] {
  const r: any = row || {}
  const ops: string[] = ['remove']
  if (r.locked === true || r.lockUnknown === true) ops.push('unlock')
  else ops.push('lock')
  ops.push('move')
  ops.push('sparse-list')
  const out: any[] = []
  for (let i = 0; i < ops.length; i += 1) {
    const action: any = vcWorktreeActionOf(ops[i])
    if (!action) continue
    out.push({ op: ops[i], action: action, decision: vcWorktreesActionDecisionOf(model, ops[i], { path: r.path }) })
  }
  return out
}

/** 理由标识符 → 词条键；不认识的标识符退回 ok 的说法，绝不把标识符原样印到界面上。 */
export const vcWorktreeWhyKeyOf = function (reason: any): string {
  const r: string = String(reason === undefined || reason === null ? '' : reason)
  return WORKTREE_REASONS.indexOf(r) >= 0 ? 'vc.wt.why.' + r : 'vc.wt.why.ok'
}

/**
 * 版本门禁用时给人看的一整句：需要哪个版本 + 这条能力的替代做法。
 * 替代做法的词条按能力号分（vc.wt.alt.9.4 …）；账本里的替代说明仍是命令面板检索用的那一份，两者内容是同一件事。
 */
export const vcWorktreesVersionHintOf = function (t: any, capId: any): string {
  const cap: any = vcWorktreeCapOf(capId)
  const version: string = cap ? String(cap.minVersion || '') : ''
  const need: string = version === '' ? '' : String(t('vc.wt.versionNeeded', { version: version }))
  const alt: string = String(t('vc.wt.alt.' + String(capId)))
  return need === '' ? alt : (need + ' ' + alt)
}
