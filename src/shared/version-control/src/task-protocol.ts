// 长任务通道的纯协议层（#1740）：动作清单、参数拼装、进度解析、任务记录字段。
//
// 这一层不碰进程、不碰文件、不碰界面：宿主侧的运行器与客户端侧的任务区都从这里取同一份
// 动作清单与同一套守卫规则。做这样切分的原因是三条硬要求：
//   1. 长任务只做票面点名的二十种动作（#1757 T21 加了子模块新增/抓取/更新到远端三条），
//      不许扩成「任意 git 命令执行」。清单只写在这里，
//      宿主注册、界面任务区、门禁都从这里读，另写一份就会漂移。
//   2. 参数一律逐项组成 argv，不拼 shell 字符串；任何以短横线开头的远程地址、目录、分支
//      都当选项注入拒掉。历史改写类动作还会进来问一次显式确认。
//   3. 进度能解析出真实百分比就画真实百分比，解析不出就返回 null，界面据此显示「不确定」
//      而不是编一个假进度。clone/fetch/pull/push 的 Receiving objects 行就是真实百分比来源。

/** 四类结束结论。中断专指宿主进程重启后对上一次在途任务的如实说明，不是进程自己退出。 */
import { filterRepoArgs } from './filter-repo-args.js'

export const TASK_CONCLUSIONS = ['succeeded', 'failed', 'cancelled', 'interrupted']

/** 任务状态只有两种：在途、已结束。四类结论只挂在已结束上。 */
export const TASK_STATES = ['running', 'done']

/** 任务记录允许落盘的字段。任务库按这份名单过滤，参数原文、输入文件内容、原始路径都不会进文件。 */
export const TASK_RECORD_FIELDS = [
  'taskId', 'requestId', 'op', 'cwdHash', 'state', 'conclusion', 'phase', 'percent',
  'receivedBytes', 'elapsedMs', 'startedAt', 'endedAt', 'exitCode', 'truncated',
  'failureKind', 'failureLine', 'residual', 'cancelRequested', 'stdinBytes', 'instanceId', 'interrupted',
]

export type TaskOpMeta = {
  id: string
  /** 动作名对应的文案键，界面用 t(keys) 取词条，不在这里写死中文。 */
  labelKey: string
  /** 这个动作的进度行是否可能带真实百分比。 */
  progress: boolean
  /** 只有 fast-import 允许从普通文件送输入；它是票面点名的唯一宽例外。 */
  stdinFile: boolean
  /** 危险动作必须由调用方显式带 confirm: true，否则开始前就拒。 */
  requiresConfirm: boolean
  /** 执行中途被取消时可能留下的残留说明，界面与结论都会带上。 */
  residual: string
}

function meta(id: any, labelKey: any, progress: any, extra?: any): TaskOpMeta {
  return {
    id, labelKey, progress,
    stdinFile: !!(extra && extra.stdinFile),
    requiresConfirm: !!(extra && extra.requiresConfirm),
    residual: (extra && extra.residual) || '任务被取消，可能有未完成的产物留在工作区，请按提示核对后再重试',
  }
}

/**
 * 票面点名的二十种长任务，一个不多一个不少。
 * 这里刻意不接收任意命令名：命令名不在清单里就直接拒绝，避免把通道做成通用执行器。
 */
export const TASK_OPS: TaskOpMeta[] = [
  meta('clone', 'vc.task.op.clone', true, { residual: '目标目录可能只写了一半，删除该目录后可以重试' }),
  meta('fetch', 'vc.task.op.fetch', true, { residual: '已经下载的对象留在本地对象库里，重新抓取会接着用，不会重复下载全部内容' }),
  meta('pull', 'vc.task.op.pull', true, { residual: '工作区可能停在未完成的合并或变基状态，面板会如实显示冲突，处理完再重试' }),
  meta('push', 'vc.task.op.push', true, { residual: '远端可能只收到了部分引用，重试前先核对该分支在远端的位置' }),
  meta('submodule-init', 'vc.task.op.submoduleInit', true, { residual: '子模块目录可能只初始化了一半，重新执行会从断点继续' }),
  meta('submodule-update', 'vc.task.op.submoduleUpdate', true, { residual: '子模块内容可能只更新了一半，重新执行会从断点继续' }),
  meta('submodule-add', 'vc.task.op.submoduleAdd', true, { residual: '子模块目录可能只写了一半，删除这个目录后可以重试' }),
  meta('submodule-fetch', 'vc.task.op.submoduleFetch', false, { residual: '抓取被取消时已有对象留在本地库里，重新抓取会接着用' }),
  meta('submodule-remote-update', 'vc.task.op.submoduleRemoteUpdate', true, { residual: '子模块内容可能只更新了一半，重新执行会从断点继续' }),
  meta('archive', 'vc.task.op.archive', false, { residual: '输出文件可能不完整，删除后重试' }),
  meta('bundle', 'vc.task.op.bundle', false, { residual: '输出文件可能不完整，删除后重试' }),
  meta('format-patch', 'vc.task.op.formatPatch', false, { residual: '输出目录里可能留下不完整的补丁文件，按日期核对后删掉重试' }),
  meta('fast-export', 'vc.task.op.fastExport', false, { residual: '导出文件可能不完整，删除后重试' }),
  meta('fast-import', 'vc.task.op.fastImport', false, { stdinFile: true, residual: '目标仓库可能已经写入了部分对象，导入前先备份或改用临时仓库核对' }),
  meta('filter-repo', 'vc.task.op.filterRepo', false, { requiresConfirm: true, residual: '历史可能已经被改写了一半，先用 fsck 核对，必要时从备份恢复' }),
  meta('svn-fetch', 'vc.task.op.svnFetch', false, { requiresConfirm: true, residual: '本地可能已经写入了部分提交，核对后再重试' }),
  meta('gc', 'vc.task.op.gc', false, { requiresConfirm: true, residual: '清理可能被中断，仓库仍然可用，重新执行一遍即可' }),
  meta('prune', 'vc.task.op.prune', false, { requiresConfirm: true, residual: '对象清理可能被中断，仓库仍然可用，但在核对之前不要执行其它写操作' }),
  meta('fsck', 'vc.task.op.fsck', false, { residual: '核对本身不改仓库，取消后直接重试即可' }),
  meta('maintenance-run', 'vc.task.op.maintenanceRun', false, { requiresConfirm: true, residual: '维护任务可能被中断，仓库仍然可用，重新执行一遍即可' }),
]

/** 按动作名取元信息；不在清单里回 null，调用方据此给明确拒绝而不是落到 unknown 分支。 */
export function taskOpMetaOf(id: any): TaskOpMeta | null {
  if (typeof id !== 'string') return null
  for (const item of TASK_OPS) if (item.id === id) return item
  return null
}

/** 这个动作名是否在长任务清单里。宿主注册与界面电话都先过这一道。 */
export function isTaskOp(id: any): boolean {
  return !!taskOpMetaOf(id)
}

export type TaskArgResult =
  | { ok: true; args: string[] }
  | { ok: false; reason: string; message: string; hint: string }

function badArg(reason: any, message: any, hint?: any): TaskArgResult {
  return { ok: false, reason, message, hint: hint || '检查参数后重试；远程地址、分支名、路径都不许以短横线开头' }
}

function textArg(value: any): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.indexOf('\u0000') < 0
}

/** 远程地址守卫：拒绝空值、空白、NUL 与短横线开头（后者会被 git 当成选项）。 */
export function taskRemoteProblem(value: any): string | null {
  if (!textArg(value)) return '远程地址必须是长度有限的非空文本'
  if (/\s/.test(value)) return '远程地址里不许有空白字符'
  if (value.charAt(0) === '-') return '远程地址不许以短横线开头'
  return null
}

/** 分支与 refspec 单侧守卫：短横线、加号开头都拒，冒号与空白也不许出现在单侧里。 */
export function taskRefProblem(value: any): string | null {
  if (!textArg(value)) return '分支或引用必须是长度有限的非空文本'
  if (/\s/.test(value)) return '分支或引用里不许有空白字符'
  if (/^[-+]/.test(value)) return '分支或引用不许以短横线或加号开头'
  if (value.indexOf(':') >= 0) return '单侧分支或引用里不许带冒号'
  return null
}

/** fetch 的 refspec 守卫：允许 main 这类短名与 refs/heads 长名，拒绝强制前导加号。 */
export function taskRefspecProblem(value: any): string | null {
  if (!textArg(value)) return 'refspec 必须是长度有限的非空文本'
  if (/\s/.test(value)) return 'refspec 里不许有空白字符'
  if (/^[-+]/.test(value)) return 'refspec 不许以短横线或加号开头'
  return null
}

/** 路径守卫：拒绝空值、NUL、以短横线开头与含上跳段，允许相对或绝对路径。 */
export function taskPathProblem(value: any): string | null {
  if (!textArg(value)) return '路径必须是长度有限的非空文本'
  if (value.indexOf('\u0000') >= 0) return '路径里不许有 NUL 字符'
  if (/^[-+]/.test(value)) return '路径不许以短横线或加号开头'
  const segments = String(value).split(/[\\/]/)
  for (const seg of segments) if (seg === '..') return '路径里不许有上跳段（..）'
  return null
}

/** 引用与区间守卫：允许 HEAD、HEAD~2..HEAD 这类写法，拒绝以短横线开头的选项注入。 */
export function taskRevProblem(value: any): string | null {
  if (!textArg(value)) return '引用必须是长度有限的非空文本'
  if (/\s/.test(value)) return '引用里不许有空白字符'
  if (/^[-+]/.test(value)) return '引用不许以短横线或加号开头'
  return null
}

/**
 * 把动作与参数拼成 argv 尾段（不含可执行文件名与固定前缀）。
 * 返回的数组每一项都是独立参数，调用方把整段直接交给 spawn，不经过 shell 拼接。
 */
export function taskArgsFor(op: any, args: any): TaskArgResult {
  if (!isTaskOp(op)) return badArg('unknown-op', '长任务清单里没有这个动作', '只接受票面点名的二十种动作')
  const a = args && typeof args === 'object' ? args : {}
  if (op === 'clone') {
    const urlProblem = taskRemoteProblem(a.url)
    if (urlProblem) return badArg('bad-remote', urlProblem)
    const dirProblem = taskPathProblem(a.dir)
    if (dirProblem) return badArg('bad-path', dirProblem)
    const out = ['clone', '--progress']
    if (a.depth !== undefined) {
      const depth = Number(a.depth)
      if (!Number.isInteger(depth) || depth < 1 || depth > 100000) return badArg('bad-args', 'depth 必须是正整数')
      out.push('--depth', String(depth))
    }
    // #1756 T20 克隆向导：分支、递归子模块、浅克隆子模块三个可选开关，只在不给/给假时完全不出现在 argv 里
    //   （老调用方的 argv 一个字节都不变）。--shallow-submodules 依赖 --depth，缺了 git 会自己报错，
    //   这里提前给人话，免得用户等到任务跑起来才看到一句英文。
    if (a.branch !== undefined && a.branch !== null && String(a.branch).trim() !== '') {
      const branchProblem = taskRefProblem(String(a.branch).trim())
      if (branchProblem) return badArg('bad-branch', branchProblem)
      out.push('--branch', String(a.branch).trim())
    }
    if (a.shallowSubmodules === true) {
      if (a.depth === undefined) return badArg('bad-args', '浅克隆子模块必须同时给深度（--shallow-submodules 要有 --depth 才有意义）')
      out.push('--shallow-submodules')
    }
    if (a.recurseSubmodules === true) out.push('--recurse-submodules')
    return { ok: true, args: out.concat([a.url, a.dir]) }
  }
  if (op === 'fetch') {
    const remoteProblem = taskRemoteProblem(a.remote || 'origin')
    if (remoteProblem) return badArg('bad-remote', remoteProblem)
    // #1755 T19：--all / --prune / --tags 是 8.5 票面点名的三种取法；缺省参数下 argv 与既有行为逐字一致。
    const all = a.all === true
    const out = all ? ['fetch', '--progress', '--all'] : ['fetch', '--progress', a.remote || 'origin']
    if (a.prune === true) out.push('--prune')
    if (a.tags === true) out.push('--tags')
    const refspecs = a.refspecs === undefined ? [] : a.refspecs
    if (!Array.isArray(refspecs)) return badArg('bad-args', 'refspecs 必须是数组')
    if (all && refspecs.length > 0) return badArg('bad-args', '--all 与具体引用不能同时使用')
    for (const ref of refspecs) {
      const problem = taskRefspecProblem(ref)
      if (problem) return badArg('bad-refspec', problem)
      out.push(ref)
    }
    return { ok: true, args: out }
  }
  if (op === 'pull') {
    const problem = taskRemoteProblem(a.upstream)
    if (problem) return badArg('bad-upstream', problem)
    const mode = a.mode || 'ff-only'
    const flags = mode === 'merge' ? ['--no-rebase'] : mode === 'rebase' ? ['--rebase'] : ['--ff-only']
    return { ok: true, args: ['pull', '--progress'].concat(flags, [a.upstream]) }
  }
  if (op === 'push') {
    const remoteProblem = taskRemoteProblem(a.remote || 'origin')
    if (remoteProblem) return badArg('bad-remote', remoteProblem)
    // #1755 T19：删除远端引用（8.11）只收完整引用名，避免把名字当选项传进去。
    if (a.deleteRef !== undefined) {
      if (typeof a.deleteRef !== 'string' || !/^refs\/(heads|tags)\/[^\s\u0000]+$/.test(a.deleteRef)) return badArg('bad-ref', '删除的远端引用必须是 refs/heads/ 或 refs/tags/ 下的完整名字')
      if (/^[-+]/.test(a.deleteRef) || a.deleteRef.indexOf('..') >= 0) return badArg('bad-ref', '删除的远端引用里不许有上跳段或以减号开头')
      return { ok: true, args: ['push', '--progress', '--no-follow-tags', '--delete', a.remote || 'origin', a.deleteRef] }
    }
    // 推送标签（8.14）只有两种模式；这两种都不带 --no-follow-tags，否则标签根本不会被推上去。
    if (a.tags !== undefined) {
      const mode = a.tags === 'tags' ? '--tags' : a.tags === 'follow-tags' ? '--follow-tags' : ''
      if (mode === '') return badArg('bad-args', '推送标签的模式只有 follow-tags 或 tags')
      return { ok: true, args: ['push', '--progress', mode, a.remote || 'origin'] }
    }
    const localProblem = taskRefProblem(a.localBranch)
    if (localProblem) return badArg('bad-local-branch', localProblem)
    const branchProblem = taskRefProblem(a.branch)
    if (branchProblem) return badArg('bad-branch', branchProblem)
    const out = ['push', '--progress', '--no-follow-tags']
    if (a.setUpstream === true) out.push('--set-upstream')
    // 原子推送（8.13）：所有引用要么全成要么全不成。
    if (a.atomic === true) out.push('--atomic')
    // 强推（8.12）只接受显式租约：租约是「分支:提交号」，没有提交号的强推在这里就被拒绝。
    if (a.forceWithLease !== undefined) {
      const lease = a.forceWithLease
      if (lease === null || typeof lease !== 'object') return badArg('bad-lease', '强推必须带租约对象')
      const leaseBranchProblem = taskRefProblem(lease.branch)
      if (leaseBranchProblem) return badArg('bad-lease', leaseBranchProblem)
      if (typeof lease.oid !== 'string' || !/^[0-9a-fA-F]{7,64}$/.test(lease.oid)) return badArg('bad-lease', '租约基准必须是完整的十六进制提交号')
      out.push('--force-with-lease=' + lease.branch + ':' + lease.oid)
      if (a.forceIfIncludes === true) out.push('--force-if-includes')
    }
    out.push(a.remote || 'origin', a.localBranch + ':' + a.branch)
    return { ok: true, args: out }
  }
  if (op === 'submodule-init' || op === 'submodule-update' || op === 'submodule-remote-update') {
    // 逐行模式带一个路径（批量菜单不带，走整批）；路径只当 update 的收窄参数，不能变成选项。
    const out = ['submodule', 'update']
    if (op === 'submodule-init') out.push('--init')
    if (op === 'submodule-remote-update') out.push('--remote')
    out.push('--recursive')
    if (a.path !== undefined) {
      const pathProblem = taskPathProblem(a.path)
      if (pathProblem) return badArg('bad-path', pathProblem)
      out.push('--', a.path)
    }
    return { ok: true, args: out }
  }
  if (op === 'submodule-add') {
    // 10.2 新增子模块：地址与路径逐项独立成参数，-- 隔开，任何一项都不许以短横线开头。
    const urlProblem = taskRemoteProblem(a.url)
    if (urlProblem) return badArg('bad-remote', urlProblem)
    const pathProblem = taskPathProblem(a.path)
    if (pathProblem) return badArg('bad-path', pathProblem)
    return { ok: true, args: ['submodule', 'add', '--', a.url, a.path] }
  }
  if (op === 'submodule-fetch') {
    // 10.4 的「逐个抓取」是固定菜单：命令字符串写死成 git fetch，调用方连字段都没有地方塞。
    // foreach 本身不接受路径收窄参数，所以这里刻意忽略 a.path，避免有人用路径字段改命令形状。
    return { ok: true, args: ['submodule', 'foreach', '--recursive', 'git fetch'] }
  }
  if (op === 'archive') {
    const revProblem = taskRevProblem(a.ref)
    if (revProblem) return badArg('bad-ref', revProblem)
    const pathProblem = taskPathProblem(a.outputPath)
    if (pathProblem) return badArg('bad-path', pathProblem)
    return { ok: true, args: ['archive', '--format=tar', '--output=' + a.outputPath, a.ref] }
  }
  if (op === 'bundle') {
    // 离线包三件事（#1759 T23，11.13）：create 产文件、verify 只校验、unbundle 把包里的引用装回当前仓库。
    // mode 缺省是 create，此时 argv 与 T19 之前逐字一致；verify / unbundle 吃的是 filePath（已存在的包），
    // 两者的 argv 形状固定为 bundle <verify|unbundle> <文件>，没有别的选项可传。
    const mode = a.mode === undefined ? 'create' : String(a.mode)
    if (mode !== 'create' && mode !== 'verify' && mode !== 'unbundle') return badArg('bad-mode', '离线包只支持 create、verify 与 unbundle 三种动作')
    if (mode !== 'create') {
      const inputProblem = taskPathProblem(a.filePath)
      if (inputProblem) return badArg('bad-path', inputProblem)
      return { ok: true, args: ['bundle', mode, a.filePath] }
    }
    const pathProblem = taskPathProblem(a.outputPath)
    if (pathProblem) return badArg('bad-path', pathProblem)
    const out = ['bundle', 'create', a.outputPath]
    if (a.ref !== undefined) {
      const revProblem = taskRevProblem(a.ref)
      if (revProblem) return badArg('bad-ref', revProblem)
      out.push(a.ref)
    } else out.push('--all')
    return { ok: true, args: out }
  }
  if (op === 'format-patch') {
    const revProblem = taskRevProblem(a.range)
    if (revProblem) return badArg('bad-range', revProblem)
    const pathProblem = taskPathProblem(a.dir)
    if (pathProblem) return badArg('bad-path', pathProblem)
    return { ok: true, args: ['format-patch', '--output-directory', a.dir, a.range] }
  }
  if (op === 'fast-export') {
    const out = ['fast-export']
    if (a.outputPath !== undefined) {
      const pathProblem = taskPathProblem(a.outputPath)
      if (pathProblem) return badArg('bad-path', pathProblem)
      out.push('--output=' + a.outputPath)
    }
    out.push('--all')
    return { ok: true, args: out }
  }
  if (op === 'fast-import') return { ok: true, args: ['fast-import', '--quiet'] }
  if (op === 'filter-repo') {
    const out = ['filter-repo', '--force']
    if (a.args !== undefined) {
      const parsed: any = filterRepoArgs(a.args)
      if (parsed.ok !== true) return badArg(parsed.reason, parsed.message, parsed.hint)
      for (const tok of parsed.args) out.push(tok)
    }
    return { ok: true, args: out }
  }
  if (op === 'svn-fetch') {
    const problem = taskRemoteProblem(a.url)
    if (problem) return badArg('bad-remote', problem)
    return { ok: true, args: ['svn', 'fetch', '--quiet', a.url] }
  }
  if (op === 'gc') return { ok: true, args: ['gc', '--quiet'] }
  if (op === 'prune') return { ok: true, args: ['prune', '--progress'] }
  if (op === 'fsck') {
    // 维护页的完整性检查另一档是「找还能捞回来的对象」：追加 --unreachable 只列不可达对象。
    // --lost-found 会往 .git/lost-found 写文件，不在面板里跑；不认识的模式明确拒绝。
    const mode: any = (a.args && a.args.mode !== undefined) ? a.args.mode : a.mode;
    if (mode !== undefined && mode !== null && mode !== 'default' && mode !== 'unreachable') return badArg('bad-mode', 'fsck 只接受 default 与 unreachable 两种模式');
    const args = ['fsck', '--no-progress'];
    if (mode === 'unreachable') args.push('--unreachable');
    return { ok: true, args: args };
  }
  if (op === 'maintenance-run') return { ok: true, args: ['maintenance', 'run'] }
  return badArg('unknown-op', '长任务清单里没有这个动作')
}

/** 按 1024 进制把人类可读的字节串转成字节数；读不出来回 null。 */
function sizeToBytes(value: any, unit: any): number | null {
  if (value === undefined) return null
  const n = Number(value)
  if (!isFinite(n) || n < 0) return null
  const u = String(unit || '').toLowerCase()
  const base = u.indexOf('ib') >= 0 ? 1024 : u.indexOf('b') >= 0 ? 1000 : 1024
  const power = u.indexOf('g') === 0 ? 3 : u.indexOf('m') === 0 ? 2 : u.indexOf('k') === 0 ? 1 : 0
  return Math.round(n * Math.pow(base, power))
}

export type TaskProgress = { phase: string | null; percent: number | null; bytes: number | null }

/**
 * 解析一行进度输出。找到形如 Receiving objects:  42% (12/34), 1.2 MiB 的行就给出
 * 阶段名、真实百分比与已传字节；没有百分比的行只给阶段名，percent 保持 null，
 * 让界面显示「进度不确定」而不是编一个数字。
 */
export function parseTaskProgress(line: any): TaskProgress {
  const empty = { phase: null, percent: null, bytes: null }
  if (typeof line !== 'string' || line.length === 0) return empty
  const match = /([A-Za-z][A-Za-z0-9 _-]*?):\s+(\d{1,3})%\s*\((\d+)\/(\d+)\)(?:,\s*([\d.]+)\s*([KMGT]?i?B))?/.exec(line)
  if (match) {
    const percent = Number(match[2])
    return {
      phase: match[1].trim(),
      percent: percent >= 0 && percent <= 100 ? percent : null,
      bytes: sizeToBytes(match[5], match[6]),
    }
  }
  const phaseMatch = /^(?:remote:\s*)?([A-Za-z][A-Za-z0-9 _-]*?):/.exec(line)
  return { phase: phaseMatch ? phaseMatch[1].trim() : null, percent: null, bytes: null }
}

/** 递归按键排序的稳定序列化：同一组参数无论键序如何都得到同一个去重键。 */
export function canonicalArgs(value: any): string {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {}
      for (const key of Object.keys(v).sort()) out[key] = walk(v[key])
      return out
    }
    return v
  }
  try { return JSON.stringify(walk(value)) } catch { return '' }
}

/** 同一对象同一动作在途去重用的键：动作 + 仓库指纹 + 规范化参数。 */
export function taskDedupeKey(op: any, cwdHash: any, args: any): string {
  return String(op) + '\u0000' + String(cwdHash) + '\u0000' + canonicalArgs(args)
}

/** 输入文件引用的形状校验：路径、非负整数大小、64 位十六进制摘要，三样缺一不可。
 *  这里只管形状；文件是否真是普通文件、大小与摘要是否对得上，由宿主打开文件时核对（那两个事实只有宿主知道）。 */
export function stdinSpecProblem(spec: any): string | null {
  if (!spec || typeof spec !== 'object') return '输入文件规格必须是对象'
  if (typeof spec.path !== 'string' || spec.path.length === 0) return '输入文件缺少路径'
  if (!Number.isInteger(spec.sizeBytes) || spec.sizeBytes < 0) return '输入文件大小必须是非负整数'
  if (typeof spec.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(spec.sha256)) return '输入文件摘要必须是 64 位十六进制'
  return null
}

/** 对外可见的任务摘要：只挑界面需要的字段，参数原文与文件内容不往外传。
 *  放在协议层而不是宿主运行器里：界面读的形状与「任务记录里哪些字段能外传」是协议的一部分，
 *  宿主与界面两侧按同一份口径解释同一个回包。 */
export function summaryOf(record: any): any {
  if (!record || typeof record !== 'object') return null
  const percent: number | null = typeof record.percent === 'number' ? record.percent : null
  const meta: any = taskOpMetaOf(record.op)
  return {
    taskId: record.taskId,
    requestId: record.requestId || null,
    op: record.op,
    // 动作的文案键也随摘要一起给界面：界面不自己拼动作名，避免多一处映射。
    labelKey: meta ? meta.labelKey : null,
    state: record.state || 'running',
    conclusion: record.conclusion || null,
    phase: record.phase || null,
    percent,
    uncertain: record.state === 'running' && percent === null,
    receivedBytes: typeof record.receivedBytes === 'number' ? record.receivedBytes : null,
    elapsedMs: typeof record.elapsedMs === 'number' ? record.elapsedMs : null,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : null,
    endedAt: typeof record.endedAt === 'number' ? record.endedAt : null,
    exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
    truncated: record.truncated === true,
    failureKind: record.failureKind || null,
    failureLine: record.failureLine || null,
    residual: record.residual || null,
    cancelRequested: record.cancelRequested === true,
    stdinBytes: typeof record.stdinBytes === 'number' ? record.stdinBytes : null,
    interrupted: record.interrupted === true || record.conclusion === 'interrupted',
  }
}

/** 长任务协议里对外可执行的公开动作名清单，宿主注册与界面电话按这份清单点名。 */
export const TASK_SOURCE = 'task-protocol'