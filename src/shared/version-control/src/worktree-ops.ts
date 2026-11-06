// src/shared/version-control/src/worktree-ops.ts —— 工作树八条能力的纯规则层（#1752 T17）
//
// 这一份回答四件事，全部是纯函数（不读文件、不起进程、不碰时间）：
//   1. 八条能力各自对应哪些 git 动作、动作要哪些输入、要不要危险确认（能力号从账本 9.1–9.8 来）；
//   2. 动作到 argv 的拼装：写死「绝不带 --force / -f」的边界，拼完再用禁旗检查兜一次底；
//   3. 预检判定：按当前工作树清单、目标路径、版本可用性给出 allow / warn / block 与理由标识符；
//   4. 工作树清单的行模型（当前这一棵 + 其他几棵）、prune 清单、稀疏检出的规则文件路径与目录候选。
//
// 为什么这份文件里没有 import：它要按构建的拼接做法拼进界面闭包（客户端半边今天没有任何对
// src/shared 的运行时 import），所以不能有 import 语句。也正因为如此，路径与分支名的校验规则由本文件
// 自己写一份，不复用 commands.ts 的 BRANCH_PATTERN —— 两份规则服务的命令不同：那一份守的是推送
// refspec，这一份守的是「路径 / 分支名 / 锁定原因会不会被 git 当成开关」。校验口径写在下面的函数上。
//
// 判定结果只回理由标识符，不回文案：中文与英文的说法在 config/copy/vcworktrees.yaml，界面按
// vc.wt.why.<理由标识符> 取词。这样同一份判定在界面与宿主各说各话时，门禁能直接看到分叉。

/** 动作编号：八条能力展开成十个可执行动作（列表一读、锁/解锁两写、稀疏检出读规则/写规则两步）。 */
export interface WorktreeAction {
  id: string
  capId: string
  /** 读 / 写 / 毁：从账本继承的动作强度，界面按它决定确认卡的措辞强度。 */
  level: string
  /** 这条动作要用户填哪些输入：path（目标工作树）/ dest（移动目的地）/ branch / reason / dirs。 */
  needs: string[]
  /** 要不要危险确认卡（写动作一律要；列表是只读，不要）。 */
  confirm: boolean
  /** 是不是不可逆的破坏性动作：删除、清理登记、移动、写稀疏检出。 */
  danger: boolean
}

/**
 * 十个动作的全集。capId 与能力账本逐字一致；账本里 9.6 一条覆盖 lock 与 unlock 两写，
 * 所以这里 9.6 展开成 lock / unlock 两个动作，界面仍按能力号归组画一行主入口。
 */
export const WORKTREE_ACTIONS: WorktreeAction[] = [
  { id: 'list', capId: '9.1', level: '读', needs: [], confirm: false, danger: false },
  { id: 'add', capId: '9.2', level: '写', needs: ['path'], confirm: true, danger: false },
  { id: 'add-branch', capId: '9.3', level: '写', needs: ['path', 'branch'], confirm: true, danger: false },
  { id: 'remove', capId: '9.4', level: '毁', needs: ['path'], confirm: true, danger: true },
  { id: 'prune', capId: '9.5', level: '写', needs: [], confirm: true, danger: true },
  { id: 'lock', capId: '9.6', level: '写', needs: ['path', 'reason'], confirm: true, danger: false },
  { id: 'unlock', capId: '9.6', level: '写', needs: ['path'], confirm: true, danger: false },
  { id: 'move', capId: '9.7', level: '写', needs: ['path', 'dest'], confirm: true, danger: true },
  { id: 'sparse-list', capId: '9.8', level: '读', needs: ['path'], confirm: false, danger: false },
  { id: 'sparse-set', capId: '9.8', level: '写', needs: ['path', 'dirs'], confirm: true, danger: true },
]

/** 工作树页负责的八个能力号，顺序照规格第 11 节矩阵（9.1 列表 → 9.8 稀疏检出）。 */
export const WORKTREE_CAP_IDS: string[] = ['9.1', '9.2', '9.3', '9.4', '9.5', '9.6', '9.7', '9.8']

/** 理由标识符：判定只回这些短串，界面按 vc.wt.why.<短串> 取词。新增理由先在这里登记。 */
export const WORKTREE_REASONS: string[] = [
  'ok',
  'path-blank', 'path-bad', 'path-exists', 'path-missing', 'path-same', 'path-occupied',
  'dest-blank', 'dest-bad',
  'branch-blank', 'branch-bad', 'branch-missing',
  'reason-blank', 'reason-bad',
  'dirs-blank', 'dirs-bad',
  'worktree-not-listed', 'worktree-is-current', 'worktree-locked', 'worktree-not-locked',
  'worktree-dirty', 'nothing-to-prune',
  'version-too-old', 'version-unknown',
  'confirm-required', 'worktrees-changed', 'target-changed', 'ticket-missing', 'ticket-expired',
]

/** 一条工作树行：界面与判定共用的形状（宿主从 worktree list + identity 拼，界面从首屏片拼）。 */
export interface WorktreeRow {
  path: string
  display: string
  head: string
  branch: string
  detached: boolean
  bare: boolean
  current: boolean
  locked: boolean
  lockReason: string
  lockUnknown: boolean
  prunable: boolean
  prunableReason: string
}

/** 路径归一：反斜杠转正斜杠、去掉末尾分隔符、统一盘符大小写。只做比较用，不回写用户输入。 */
export const worktreeNormalizePath = function (p: any): string {
  let s = String(p === undefined || p === null ? '' : p).replace(/\\/g, '/')
  while (s.length > 1 && s.charAt(s.length - 1) === '/') s = s.slice(0, -1)
  if (/^[a-zA-Z]:/.test(s)) s = s.charAt(0).toLowerCase() + s.slice(1)
  return s
}

/** 两条路径是不是同一棵工作树（大小写只在 Windows 盘符上归一，其余按原样比）。 */
export const worktreeSamePathOf = function (a: any, b: any): boolean {
  const x = worktreeNormalizePath(a)
  const y = worktreeNormalizePath(b)
  return x !== '' && x === y
}

/**
 * 目标路径能不能当 git 参数用。拒绝空、拒绝以「-」开头（会被 git 当成开关）、拒绝控制字符，
 * 拒绝带「..」的段（越出仓库的路径不在这里拼）。
 */
export const worktreePathProblem = function (p: any): string {
  const s = String(p === undefined || p === null ? '' : p).trim()
  if (s === '') return 'path-blank'
  if (s.charAt(0) === '-') return 'path-bad'
  if (/[\u0000-\u001f]/.test(s)) return 'path-bad'
  const segs = worktreeNormalizePath(s).split('/')
  for (let i = 0; i < segs.length; i += 1) if (segs[i] === '..') return 'path-bad'
  return ''
}

/** 分支名：空、以「-」开头、含空白或控制字符都拒（分支名进的是 git 的位置参数，不许被读成开关）。 */
export const worktreeBranchProblem = function (b: any): string {
  const s = String(b === undefined || b === null ? '' : b).trim()
  if (s === '') return 'branch-blank'
  if (s.charAt(0) === '-') return 'branch-bad'
  if (/\s/.test(s) || /[\u0000-\u001f]/.test(s) || s.indexOf('..') >= 0) return 'branch-bad'
  return ''
}

/** 锁定原因：必填（规格原句「锁 / 解锁要求填写原因（解锁可留空）」），最长 200 字，不许控制字符。 */
export const worktreeReasonProblem = function (r: any): string {
  const s = String(r === undefined || r === null ? '' : r).trim()
  if (s === '') return 'reason-blank'
  if (s.length > 200) return 'reason-bad'
  if (/[\u0000-\u001f]/.test(s)) return 'reason-bad'
  return ''
}

/** 稀疏检出的目录勾选：至少一项；每项不许为空、不许以「-」开头、不许绝对路径与「..」。 */
export const worktreeDirsProblem = function (dirs: any): string {
  const list: any[] = Array.isArray(dirs) ? dirs : []
  const picked = list.filter(function (d: any): boolean { return String(d === undefined || d === null ? '' : d).trim() !== '' })
  if (picked.length === 0) return 'dirs-blank'
  for (let i = 0; i < picked.length; i += 1) {
    const s = String(picked[i]).trim()
    if (s.charAt(0) === '-') return 'dirs-bad'
    if (s.charAt(0) === '/') return 'dirs-bad'
    if (/^[a-zA-Z]:/.test(s)) return 'dirs-bad'
    if (/[\u0000-\u001f]/.test(s)) return 'dirs-bad'
    const segs = worktreeNormalizePath(s).split('/')
    for (let j = 0; j < segs.length; j += 1) if (segs[j] === '..') return 'dirs-bad'
  }
  return ''
}

/**
 * 禁旗检查（边界「不提供 --force 与 -f -f 入口」的最后一道闸）：argv 里出现 force 系开关就给出它。
 * 拼装函数本身不产生这些开关；这一道是防将来有人「顺手」加上却被当成小事。
 */
export const worktreeForbiddenFlagIn = function (argv: any): string {
  const list: any[] = Array.isArray(argv) ? argv : []
  for (let i = 0; i < list.length; i += 1) {
    const s = String(list[i])
    if (s === '--force' || s === '-f' || s === '-ff' || s === '--force-with-lease') return s
  }
  return ''
}

/** 一次动作要跑哪些 argv。返回 null 表示输入不合法（调用方先跑判定，不该走到这里）。 */
export const worktreeArgsOf = function (op: any, input: any): any {
  const o = String(op || '')
  const p = input || {}
  const path = String(p.path === undefined || p.path === null ? '' : p.path)
  if (o === 'list') return ['worktree', 'list', '--porcelain', '-z']
  if (o === 'list-plain') return ['worktree', 'list', '--porcelain']
  // 新建工作区有两种填法（原型 93 / 94）：带分支名时用 -b 新建并检出这条分支，
  // 不带分支名时仍是 git 自动按目录名建分支的旧形态（命令面板等既有调用方不受影响）。
  if (o === 'add') {
    const branch = String(p.branch === undefined || p.branch === null ? '' : p.branch)
    return branch === '' ? ['worktree', 'add', path] : ['worktree', 'add', '-b', branch, path]
  }
  if (o === 'add-branch') return ['worktree', 'add', path, String(p.branch === undefined || p.branch === null ? '' : p.branch)]
  if (o === 'remove') return ['worktree', 'remove', path]
  if (o === 'prune-preview') return ['worktree', 'prune', '--dry-run', '--verbose']
  if (o === 'prune') return ['worktree', 'prune', '--verbose']
  if (o === 'lock') return ['worktree', 'lock', '--reason', String(p.reason === undefined || p.reason === null ? '' : p.reason), path]
  if (o === 'unlock') return ['worktree', 'unlock', path]
  if (o === 'move') return ['worktree', 'move', path, String(p.dest === undefined || p.dest === null ? '' : p.dest)]
  if (o === 'sparse-list') return ['sparse-checkout', 'list']
  if (o === 'sparse-candidates') return ['ls-tree', '-d', '--name-only', 'HEAD']
  if (o === 'sparse-rule-dir') return ['rev-parse', '--git-dir']
  if (o === 'sparse-set') {
    const dirs: any[] = Array.isArray(p.dirs) ? p.dirs : []
    return ['sparse-checkout', 'set', '--cone'].concat(dirs.map(function (d: any): string { return String(d) }))
  }
  return null
}

/** 人读的命令名（结果卡只显示 git 子命令名，不显示可复制的整条命令）。 */
export const worktreeCmdNameOf = function (op: any): string {
  const o = String(op || '')
  if (o === 'list' || o === 'list-plain') return 'git worktree list'
  if (o === 'add' || o === 'add-branch') return 'git worktree add'
  if (o === 'remove') return 'git worktree remove'
  if (o === 'prune') return 'git worktree prune'
  if (o === 'lock') return 'git worktree lock'
  if (o === 'unlock') return 'git worktree unlock'
  if (o === 'move') return 'git worktree move'
  if (o === 'sparse-set' || o === 'sparse-list') return 'git sparse-checkout'
  return 'git ' + o
}

/** 版本可用性：只有隐藏与降档两档要拦或要提醒；可用性读不到（null）按「不知道」拦，不冒充能用。 */
const worktreeVersionOf = function (availability: any): any {
  const a = availability || null
  if (!a) return { state: 'unknown', needed: '', alternative: '' }
  const state = String(a.state || 'unknown')
  return { state: state, needed: String(a.needed || ''), alternative: String(a.alternative || '') }
}

const worktreeRowOf = function (list: any, p: any): any {
  const rows: any[] = Array.isArray(list) ? list : []
  const want = worktreeNormalizePath(p)
  for (let i = 0; i < rows.length; i += 1) if (worktreeNormalizePath(rows[i].path) === want) return rows[i]
  return null
}

/**
 * 预检判定。ctx 的字段全是「此刻的事实」，由调用方读好再交进来（宿主读真仓库，界面读首屏片）；
 * 判定本身不看时间、不读文件，所以同一个 ctx 在两边给出同一个答案，门禁可以拿它当唯一判据。
 */
export const worktreeJudge = function (op: any, ctx: any): any {
  const o = String(op || '')
  const c = ctx || {}
  const rows: any[] = Array.isArray(c.rows) ? c.rows : []
  const availability = c.availability
  const version = worktreeVersionOf(availability)
  const reasons: string[] = []
  // 提醒与放行分开记：只推一条提醒时，理由表长度仍是 1，光看长度会把「有提醒」误判成「干净放行」。
  let warned = false
  const block = function (r: string): any { reasons.push(r); return { decision: 'block', reasons: reasons, version: version } }
  const warn = function (r: string): void { reasons.push(r); warned = true }
  const allow = function (): any { if (reasons.length === 0) reasons.push('ok'); return { decision: warned ? 'warn' : 'allow', reasons: reasons, version: version } }

  if (version.state === 'hidden') return block('version-too-old')
  if (version.state === 'unknown') return block('version-unknown')
  if (version.state === 'degraded' && (o === 'lock' || o === 'unlock')) warn('version-unknown')

  if (o === 'list' || o === 'list-plain') return allow()

  const target = String(c.targetPath === undefined || c.targetPath === null ? '' : c.targetPath)
  const row = worktreeRowOf(rows, target)

  if (o === 'add' || o === 'add-branch') {
    const pp = worktreePathProblem(target)
    if (pp) return block(pp)
    if (c.targetExists === true) return block('path-exists')
    const branch = String(c.branch === undefined || c.branch === null ? '' : c.branch)
    // add 的分支是可选的：给了就按 -b 新建，得先过分支名形状检查；没给就交给 git 按目录名建分支。
    // add-branch 的分支是必填的，空值也走同一条分支名检查（branch-blank）。
    if (o === 'add-branch' || branch !== '') {
      const bp = worktreeBranchProblem(branch)
      if (bp) return block(bp)
      if (c.branchMissing === true) return block('branch-missing')
    }
    return allow()
  }

  if (o === 'prune') {
    const n = typeof c.prunableCount === 'number' ? c.prunableCount : (Array.isArray(c.prunableEntries) ? c.prunableEntries.length : -1)
    if (n === 0) return block('nothing-to-prune')
    if (n < 0) return block('worktree-not-listed')
    return allow()
  }

  // 其余动作都以「清单里的一棵工作树」为目标：不认识的路径先拒掉。
  if (target === '') return block('path-blank')
  if (!row) return block('worktree-not-listed')
  // #1904 修：「开移动表单」与「真的移动」不是同一件事。开表单时新目录还是空的，按 move 的规则判
  //   会直接落到 dest-blank 把按钮画成禁用——按钮点不动，表单永远打不开（真机上就是这么坏的）。
  //   所以 move-open 只判行级前提（当前树 / 锁着），新目录留空交给保存时的 move 判定。
  if (o === 'remove' || o === 'move' || o === 'move-open') {
    if (row.current === true) return block('worktree-is-current')
    if (row.locked === true) return block('worktree-locked')
  }
  if (o === 'move-open') return allow()
  if (o === 'remove') {
    if (typeof c.dirtyCount === 'number' && c.dirtyCount > 0) warn('worktree-dirty')
    return allow()
  }
  if (o === 'move') {
    const dp = worktreePathProblem(c.dest)
    if (dp) return block(dp === 'path-blank' ? 'dest-blank' : 'dest-bad')
    if (worktreeSamePathOf(c.dest, target)) return block('path-same')
    if (c.targetExists === true || c.destExists === true) return block('path-exists')
    return allow()
  }
  if (o === 'lock') {
    if (row.locked === true) return block('worktree-locked')
    const rp = worktreeReasonProblem(c.reason)
    if (rp) return block(rp)
    return allow()
  }
  if (o === 'unlock') {
    if (row.locked !== true && row.lockUnknown !== true) return block('worktree-not-locked')
    return allow()
  }
  if (o === 'sparse-list') return allow()
  if (o === 'sparse-set') {
    const ddp = worktreeDirsProblem(c.dirs)
    if (ddp) return block(ddp)
    return allow()
  }
  return block('path-bad')
}

/**
 * 清单行：把首屏 worktrees 片的「其他工作树」与 workspace 片的当前工作树拼成一份完整清单。
 * 当前这一棵排在最前面（人先看到自己在哪里），其余按路径排序，保证两次读数顺序稳定。
 */
export const worktreeRowsOf = function (others: any, current: any): WorktreeRow[] {
  const out: WorktreeRow[] = []
  const seen: Record<string, boolean> = {}
  const push = function (row: any): void {
    const key = worktreeNormalizePath(row.path)
    if (key === '' || seen[key]) return
    seen[key] = true
    out.push(row)
  }
  const cur = current || null
  if (cur && String(cur.worktreePath || cur.path || '') !== '') {
    push({
      path: String(cur.worktreePath || cur.path || ''),
      display: String(cur.worktreeDisplay || cur.display || cur.worktreePath || cur.path || ''),
      head: String(cur.oid || cur.head || ''),
      branch: String(cur.branch || ''),
      detached: cur.detached === true,
      bare: cur.bare === true,
      current: true,
      locked: false,
      lockReason: '',
      lockUnknown: false,
      prunable: false,
      prunableReason: '',
    })
  }
  const list: any[] = Array.isArray(others) ? others : []
  for (let i = 0; i < list.length; i += 1) {
    const w = list[i] || {}
    push({
      path: String(w.path || ''),
      display: String(w.display || w.path || ''),
      head: String(w.head || ''),
      branch: String(w.branch || ''),
      detached: w.detached === true,
      bare: w.bare === true,
      current: worktreeSamePathOf(w.path, cur && (cur.worktreePath || cur.path)),
      locked: w.locked === true,
      lockReason: String(w.lockReason || ''),
      lockUnknown: w.lockUnknown === true,
      prunable: w.prunable === true,
      prunableReason: String(w.prunableReason || ''),
    })
  }
  const rest = out.filter(function (r: WorktreeRow): boolean { return r.current !== true })
  rest.sort(function (a: WorktreeRow, b: WorktreeRow): number { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0) })
  const curRows = out.filter(function (r: WorktreeRow): boolean { return r.current === true })
  return curRows.concat(rest)
}

/** prune 清单：只列「登记还在、目录已经没了」的那些，且绝不包含当前工作树与仍锁定的工作树。 */
export const worktreePruneEntriesOf = function (rows: any): WorktreeRow[] {
  const list: any[] = Array.isArray(rows) ? rows : []
  return list.filter(function (r: any): boolean {
    return r && r.prunable === true && r.current !== true && r.locked !== true
  })
}

/**
 * 稀疏检出写入前要显示的规则文件路径。git 的 --git-dir 可能给相对路径（相对目标工作树），
 * 这里只做字符串拼接与「..」折叠，不碰文件系统：显示给人看的是「这个文件会被更新」。
 */
export const worktreeSparseRulePathOf = function (worktreePath: any, gitDirRaw: any): string {
  const raw = String(gitDirRaw === undefined || gitDirRaw === null ? '' : gitDirRaw).trim()
  let base = raw
  if (base !== '' && base.charAt(0) !== '/' && !/^[a-zA-Z]:/.test(base)) base = String(worktreePath || '') + '/' + base
  const parts = base.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const seg = parts[i]
    if (seg === '' && out.length > 0) continue
    if (seg === '.' && out.length > 0) continue
    if (seg === '..' && out.length > 0) { out.pop(); continue }
    out.push(seg)
  }
  return out.join('/') + '/info/sparse-checkout'
}

/** 稀疏检出目录候选：ls-tree -d --name-only HEAD 的每一行就是仓库顶层的一个目录。 */
export const worktreeSparseCandidatesOf = function (text: any): string[] {
  const lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const s = lines[i].trim()
    if (s !== '' && out.indexOf(s) < 0) out.push(s)
  }
  out.sort()
  return out
}

/** 当前稀疏规则（sparse-checkout list 的回包，一行一条）。 */
export const worktreeSparseRulesOf = function (text: any): string[] {
  return worktreeSparseCandidatesOf(text)
}

/** 工作树清单的稳定摘要：宿主用它比「预检到动手之间清单有没有变」，变了就零进程拒绝。 */
export const worktreeDigestOf = function (rows: any): string {
  const list: any[] = Array.isArray(rows) ? rows : []
  const parts: string[] = []
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i] || {}
    parts.push(worktreeNormalizePath(r.path) + '\u0000' + String(r.head || '') + '\u0000' + String(r.branch || '') + '\u0000' + (r.locked === true ? '1' : '0') + '\u0000' + (r.prunable === true ? '1' : '0'))
  }
  parts.sort()
  return parts.join('\u0001')
}

export const WORKTREE_SOURCE = 'src/shared/version-control/src/worktree-ops.ts'
