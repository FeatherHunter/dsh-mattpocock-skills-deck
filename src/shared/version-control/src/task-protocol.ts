// 长任务通道的纯协议层（#1740）：动作清单、参数拼装、进度解析、任务记录字段。
//
// 这一层不碰进程、不碰文件、不碰界面：宿主侧的运行器与客户端侧的任务区都从这里取同一份
// 动作清单与同一套守卫规则。做这样切分的原因是三条硬要求：
//   1. 长任务只做票面点名的那十七种动作，不许扩成「任意 git 命令执行」。清单只写在这里，
//      宿主注册、界面任务区、门禁都从这里读，另写一份就会漂移。
//   2. 参数一律逐项组成 argv，不拼 shell 字符串；任何以短横线开头的远程地址、目录、分支
//      都当选项注入拒掉。历史改写类动作还会进来问一次显式确认。
//   3. 进度能解析出真实百分比就画真实百分比，解析不出就返回 null，界面据此显示「不确定」
//      而不是编一个假进度。clone/fetch/pull/push 的 Receiving objects 行就是真实百分比来源。

/** 四类结束结论。中断专指宿主进程重启后对上一次在途任务的如实说明，不是进程自己退出。 */
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
 * 票面点名的十七种长任务，一个不多一个不少。
 * 这里刻意不接收任意命令名：命令名不在清单里就直接拒绝，避免把通道做成通用执行器。
 */
export const TASK_OPS: TaskOpMeta[] = [
  meta('clone', 'versionControl.task.op.clone', true, { residual: '目标目录可能只写了一半，删除该目录后可以重试' }),
  meta('fetch', 'versionControl.task.op.fetch', true, { residual: '已经下载的对象留在本地对象库里，重新抓取会接着用，不会重复下载全部内容' }),
  meta('pull', 'versionControl.task.op.pull', true, { residual: '工作区可能停在未完成的合并或变基状态，面板会如实显示冲突，处理完再重试' }),
  meta('push', 'versionControl.task.op.push', true, { residual: '远端可能只收到了部分引用，重试前先核对该分支在远端的位置' }),
  meta('submodule-init', 'versionControl.task.op.submoduleInit', true, { residual: '子模块目录可能只初始化了一半，重新执行会从断点继续' }),
  meta('submodule-update', 'versionControl.task.op.submoduleUpdate', true, { residual: '子模块内容可能只更新了一半，重新执行会从断点继续' }),
  meta('archive', 'versionControl.task.op.archive', false, { residual: '输出文件可能不完整，删除后重试' }),
  meta('bundle', 'versionControl.task.op.bundle', false, { residual: '输出文件可能不完整，删除后重试' }),
  meta('format-patch', 'versionControl.task.op.formatPatch', false, { residual: '输出目录里可能留下不完整的补丁文件，按日期核对后删掉重试' }),
  meta('fast-export', 'versionControl.task.op.fastExport', false, { residual: '导出文件可能不完整，删除后重试' }),
  meta('fast-import', 'versionControl.task.op.fastImport', false, { stdinFile: true, residual: '目标仓库可能已经写入了部分对象，导入前先备份或改用临时仓库核对' }),
  meta('filter-repo', 'versionControl.task.op.filterRepo', false, { requiresConfirm: true, residual: '历史可能已经被改写了一半，先用 fsck 核对，必要时从备份恢复' }),
  meta('svn-fetch', 'versionControl.task.op.svnFetch', false, { requiresConfirm: true, residual: '本地可能已经写入了部分提交，核对后再重试' }),
  meta('gc', 'versionControl.task.op.gc', false, { requiresConfirm: true, residual: '清理可能被中断，仓库仍然可用，重新执行一遍即可' }),
  meta('prune', 'versionControl.task.op.prune', false, { requiresConfirm: true, residual: '对象清理可能被中断，仓库仍然可用，但在核对之前不要执行其它写操作' }),
  meta('fsck', 'versionControl.task.op.fsck', false, { residual: '核对本身不改仓库，取消后直接重试即可' }),
  meta('maintenance-run', 'versionControl.task.op.maintenanceRun', false, { requiresConfirm: true, residual: '维护任务可能被中断，仓库仍然可用，重新执行一遍即可' }),
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
  if (!isTaskOp(op)) return badArg('unknown-op', '长任务清单里没有这个动作', '只接受票面点名的十七种动作')
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
    return { ok: true, args: out.concat([a.url, a.dir]) }
  }
  if (op === 'fetch') {
    const remoteProblem = taskRemoteProblem(a.remote || 'origin')
    if (remoteProblem) return badArg('bad-remote', remoteProblem)
    const out = ['fetch', '--progress', a.remote || 'origin']
    const refspecs = a.refspecs === undefined ? [] : a.refspecs
    if (!Array.isArray(refspecs)) return badArg('bad-args', 'refspecs 必须是数组')
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
    const localProblem = taskRefProblem(a.localBranch)
    if (localProblem) return badArg('bad-local-branch', localProblem)
    const branchProblem = taskRefProblem(a.branch)
    if (branchProblem) return badArg('bad-branch', branchProblem)
    const out = ['push', '--progress', '--no-follow-tags']
    if (a.setUpstream === true) out.push('--set-upstream')
    out.push(a.remote || 'origin', a.localBranch + ':' + a.branch)
    return { ok: true, args: out }
  }
  if (op === 'submodule-init') return { ok: true, args: ['submodule', 'update', '--init', '--recursive'] }
  if (op === 'submodule-update') return { ok: true, args: ['submodule', 'update', '--recursive'] }
  if (op === 'archive') {
    const revProblem = taskRevProblem(a.ref)
    if (revProblem) return badArg('bad-ref', revProblem)
    const pathProblem = taskPathProblem(a.outputPath)
    if (pathProblem) return badArg('bad-path', pathProblem)
    return { ok: true, args: ['archive', '--format=tar', '--output=' + a.outputPath, a.ref] }
  }
  if (op === 'bundle') {
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
      if (!Array.isArray(a.args)) return badArg('bad-args', '外部工具参数必须是数组')
      const allowed = ['--path', '--invert-paths', '--replace-refs', '--strip-blobs-bigger-than']
      for (const item of a.args) {
        if (typeof item !== 'string' || item.length === 0) return badArg('bad-args', '外部工具参数必须是文本')
        if (item.charAt(0) !== '-' || allowed.indexOf(item) < 0) return badArg('bad-args', '外部工具参数只接受登记过的选项')
        out.push(item)
      }
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
  if (op === 'fsck') return { ok: true, args: ['fsck', '--no-progress'] }
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

/** 长任务协议里对外可执行的公开动作名清单，宿主注册与界面电话按这份清单点名。 */
export const TASK_SOURCE = 'task-protocol'
