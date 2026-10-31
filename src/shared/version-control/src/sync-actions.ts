// 版本管理「同步」十个动作的共享口径（#1755 T19，域 8 的 8.5–8.14）。
//
// 这个文件故意不 import 任何兄弟文件：共享层同层互相 import 会被依赖门禁拦下（见 branch-ticket.ts 开头的说明），
// 所以参数校验、归一、长期任务入参与给人看的命令原文都写在这里，宿主只负责读现场、签票与起进程。
//
// 约定（改之前先读）：
// - syncPlanOf 成功回 { ok: true, plan }，失败回 { ok: false, reason, message }；reason 是稳定的机器可读短名，
//   message 是给人看的一句中文，宿主把两者都透传给界面，界面不许自己再拼一遍。
// - plan.taskArgs 原样交给长任务通道的 taskArgsFor；plan.commandText 是给人看的命令原文（与能力账本口径一致）。
// - 强推只允许带租约：leaseOid 必须来自 ls-remote 当场读到的远端提交号；没有它就不许规划出强推。
// - git 版本 2.30 及以上才追加 --force-if-includes，低版本如实降级并把降级说明放进 plan.versionNote。

export const SYNC_CHECK_CONTRACT = 'version-control.sync-check'
export const SYNC_CHECK_VERSION = 1
export const SYNC_ACTIONS_SOURCE = 'src/shared/version-control/src/sync-actions.ts'

// 十个动作的登记表。id 与能力账本一致（8.5–8.14），level 与账本同口径。
export const SYNC_ACTIONS: any[] = [
  { action: 'fetch', id: '8.5', op: 'fetch', level: '写', needsConfirm: true, commandText: 'git fetch [--all] [--prune] [--tags]' },
  { action: 'pull-merge', id: '8.6', op: 'pull', level: '写', needsConfirm: true, commandText: 'git pull' },
  { action: 'pull-rebase', id: '8.7', op: 'pull', level: '改写', needsConfirm: true, commandText: 'git pull --rebase' },
  { action: 'pull-ff-only', id: '8.8', op: 'pull', level: '写', needsConfirm: true, commandText: 'git pull --ff-only' },
  { action: 'push', id: '8.9', op: 'push', level: '写', needsConfirm: true, commandText: 'git push' },
  { action: 'push-upstream', id: '8.10', op: 'push', level: '写', needsConfirm: true, commandText: 'git push -u' },
  { action: 'delete-remote-ref', id: '8.11', op: 'push', level: '毁', needsConfirm: true, commandText: 'git push --delete' },
  { action: 'force-push', id: '8.12', op: 'push', level: '毁', needsConfirm: true, commandText: 'git push --force-with-lease' },
  { action: 'atomic-push', id: '8.13', op: 'push', level: '写', needsConfirm: true, commandText: 'git push --atomic' },
  { action: 'push-tags', id: '8.14', op: 'push', level: '写', needsConfirm: true, commandText: 'git push --follow-tags / --tags' }
]

export function syncActionOf(action: any): any {
  const id = String(action === undefined || action === null ? '' : action)
  for (let i = 0; i < SYNC_ACTIONS.length; i = i + 1) {
    if (SYNC_ACTIONS[i].action === id) return SYNC_ACTIONS[i]
  }
  return null
}

export function syncActionIds(): string[] {
  const out: string[] = []
  for (let i = 0; i < SYNC_ACTIONS.length; i = i + 1) out.push(String(SYNC_ACTIONS[i].id))
  return out
}

function textOf(value: any): string {
  return typeof value === 'string' ? value.trim() : ''
}

function bad(reason: string, message: string): any {
  return { ok: false, reason: reason, message: message }
}

// 远端名只允许常规字符、不许以减号开头、不许空白与控制字符；长度上限防住超长输入。
export function syncRemoteProblem(name: string): string {
  if (name === '') return '远端名不能为空'
  if (name.length > 100) return '远端名超过 100 个字符'
  if (name.charAt(0) === '-') return '远端名不能以减号开头'
  if (/[\s\u0000-\u001f]/.test(name)) return '远端名不能包含空白或控制字符'
  if (name === '.' || name === '..' || name.indexOf('..') >= 0) return '远端名不能包含两个连续的点'
  return ''
}

// 引用名（分支、标签）的宽松校验：拒绝空白、控制字符、减号开头、连续的点和 git 的保留符号。
export function syncRefProblem(name: string): string {
  if (name === '') return '引用名不能为空'
  if (name.length > 200) return '引用名超过 200 个字符'
  if (name.charAt(0) === '-') return '引用名不能以减号开头'
  if (/[\s\u0000-\u001f]/.test(name)) return '引用名不能包含空白或控制字符'
  if (name.indexOf('..') >= 0) return '引用名不能包含两个连续的点'
  if (name.indexOf('@{') >= 0) return '引用名不能包含 @{'
  if (/[~^:?*\[\\]/.test(name)) return '引用名不能包含 git 的保留符号'
  if (name.charAt(name.length - 1) === '/') return '引用名不能以斜杠结尾'
  return ''
}

// 强推租约基准必须是 ls-remote 读到的十六进制提交号；短号与空值都不接受，避免无基准强推。
export function syncOidProblem(oid: string): string {
  if (oid === '') return '强推必须带远端当场的提交号作为租约基准'
  if (!/^[0-9a-fA-F]{7,64}$/.test(oid)) return '租约基准不是合法的十六进制提交号'
  return ''
}

// 引用规格（fetch 的 refspec）：拒绝空白、控制字符与减号开头，允许带 + 强制前缀与冒号两侧。
export function syncRefspecProblem(refspec: string): string {
  if (refspec === '') return 'refspec 不能为空'
  if (refspec.length > 300) return 'refspec 超过 300 个字符'
  if (refspec.charAt(0) === '-') return 'refspec 不能以减号开头'
  if (/[\s\u0000-\u001f]/.test(refspec)) return 'refspec 不能包含空白或控制字符'
  if (refspec.indexOf('..') >= 0) return 'refspec 不能包含两个连续的点'
  return ''
}

// 拉取的上游写法必须是「远端/分支」两段，避免把选项塞进上游参数。
export function syncUpstreamProblem(upstream: string): string {
  if (upstream === '') return '拉取必须指定上游分支，例如 origin/main'
  const cut = upstream.indexOf('/')
  if (cut <= 0 || cut === upstream.length - 1) return '上游分支必须写成「远端/分支」两段'
  const remoteProblem = syncRemoteProblem(upstream.slice(0, cut))
  if (remoteProblem !== '') return remoteProblem
  const refProblem = syncRefProblem(upstream.slice(cut + 1))
  if (refProblem !== '') return refProblem
  return ''
}

function basePlan(entry: any, plan: any): any {
  return Object.assign({
    action: entry.action,
    id: entry.id,
    op: entry.op,
    level: entry.level,
    needsConfirm: entry.needsConfirm === true,
    commandText: entry.commandText,
    remote: 'origin',
    branch: '',
    localBranch: '',
    upstream: '',
    ref: '',
    refKind: '',
    mode: '',
    leaseBranch: '',
    leaseOid: '',
    forceIfIncludes: false,
    versionNeed: '',
    versionNote: '',
    targetText: '',
    taskArgs: {}
  }, plan || {})
}

// 把动作参数归一成 plan；plan.taskArgs 直接进长任务通道，plan.targetText 进确认卡点名对象。
export function syncPlanOf(action: any, input: any): any {
  const entry = syncActionOf(action)
  if (entry === null) return bad('unknown-action', '不认识的同步动作：' + String(action))
  const a = input === undefined || input === null ? {} : input
  const remote = textOf(a.remote) === '' ? 'origin' : textOf(a.remote)
  const remoteProblem = syncRemoteProblem(remote)
  if (remoteProblem !== '') return bad('bad-remote', remoteProblem)
  if (entry.action === 'fetch') {
    const all = a.all === true
    const prune = a.prune === true
    const tags = a.tags === true
    const refspecs = a.refspecs === undefined || a.refspecs === null ? [] : a.refspecs
    if (!Array.isArray(refspecs)) return bad('bad-args', 'refspecs 必须是数组')
    if (all && refspecs.length > 0) return bad('bad-args', '--all 与具体引用不能同时使用')
    const refs: string[] = []
    for (let i = 0; i < refspecs.length; i = i + 1) {
      const ref = textOf(refspecs[i])
      const refProblem = syncRefspecProblem(ref)
      if (refProblem !== '') return bad('bad-ref', refProblem)
      refs.push(ref)
    }
    return {
      ok: true,
      plan: basePlan(entry, {
        remote: remote,
        branch: '',
        taskArgs: { remote: remote, all: all, prune: prune, tags: tags, refspecs: refs },
        targetText: '远端 ' + remote
      })
    }
  }
  if (entry.action === 'pull-merge' || entry.action === 'pull-rebase' || entry.action === 'pull-ff-only') {
    const upstream = textOf(a.upstream)
    const upstreamProblem = syncUpstreamProblem(upstream)
    if (upstreamProblem !== '') return bad('bad-upstream', upstreamProblem)
    const cut = upstream.indexOf('/')
    const mode = entry.action === 'pull-merge' ? 'merge' : entry.action === 'pull-rebase' ? 'rebase' : 'ff-only'
    return {
      ok: true,
      plan: basePlan(entry, {
        remote: upstream.slice(0, cut),
        upstream: upstream,
        branch: upstream.slice(cut + 1),
        mode: mode,
        taskArgs: { upstream: upstream, mode: mode },
        targetText: '上游 ' + upstream
      })
    }
  }
  if (entry.action === 'delete-remote-ref') {
    const kind = textOf(a.refKind) === 'tag' ? 'tag' : textOf(a.refKind) === 'branch' ? 'branch' : ''
    if (kind === '') return bad('bad-args', '删除远端引用时必须说明删分支还是删标签')
    const name = textOf(a.name)
    const refProblem = syncRefProblem(name)
    if (refProblem !== '') return bad('bad-ref', refProblem)
    const ref = (kind === 'tag' ? 'refs/tags/' : 'refs/heads/') + name
    return {
      ok: true,
      plan: basePlan(entry, {
        remote: remote,
        branch: kind === 'branch' ? name : '',
        ref: ref,
        refKind: kind,
        taskArgs: { remote: remote, deleteRef: ref },
        targetText: (kind === 'tag' ? '远端标签 ' : '远端分支 ') + remote + '/' + name
      })
    }
  }
  if (entry.action === 'force-push') {
    const localBranch = textOf(a.localBranch)
    const branch = textOf(a.branch) === '' ? localBranch : textOf(a.branch)
    if (syncRefProblem(localBranch) !== '') return bad('bad-branch', syncRefProblem(localBranch) || '本地分支不合法')
    if (syncRefProblem(branch) !== '') return bad('bad-branch', syncRefProblem(branch) || '远端分支不合法')
    const leaseOid = textOf(a.leaseOid)
    const oidProblem = syncOidProblem(leaseOid)
    if (oidProblem !== '') return bad('bad-lease', oidProblem)
    const forceIfIncludes = a.forceIfIncludes === true
    return {
      ok: true,
      plan: basePlan(entry, {
        remote: remote,
        branch: branch,
        localBranch: localBranch,
        leaseBranch: branch,
        leaseOid: leaseOid,
        forceIfIncludes: forceIfIncludes,
        versionNeed: '2.30',
        versionNote: forceIfIncludes ? '' : '本机 git 低于 2.30，本次强推只带 --force-with-lease，少一道 --force-if-includes 保护。',
        taskArgs: { remote: remote, localBranch: localBranch, branch: branch, forceWithLease: { branch: branch, oid: leaseOid }, forceIfIncludes: forceIfIncludes },
        targetText: '远端分支 ' + remote + '/' + branch + '（租约基准 ' + leaseOid + '）'
      })
    }
  }
  if (entry.action === 'push-tags') {
    const mode = textOf(a.tags) === 'tags' ? 'tags' : 'follow-tags'
    return {
      ok: true,
      plan: basePlan(entry, {
        remote: remote,
        mode: mode,
        taskArgs: { remote: remote, tags: mode },
        targetText: '远端 ' + remote + ' 的标签（' + (mode === 'tags' ? '推送全部标签' : '随提交推送标签') + '）'
      })
    }
  }
  // push / push-upstream / atomic-push 共用一套分支校验。
  const localBranch = textOf(a.localBranch)
  const branch = textOf(a.branch) === '' ? localBranch : textOf(a.branch)
  const localProblem = syncRefProblem(localBranch)
  if (localProblem !== '') return bad('bad-branch', localProblem)
  const branchProblem = syncRefProblem(branch)
  if (branchProblem !== '') return bad('bad-branch', branchProblem)
  const taskArgs: any = { remote: remote, localBranch: localBranch, branch: branch }
  if (entry.action === 'push-upstream') taskArgs.setUpstream = true
  if (entry.action === 'atomic-push') taskArgs.atomic = true
  return {
    ok: true,
    plan: basePlan(entry, {
      remote: remote,
      branch: branch,
      localBranch: localBranch,
      taskArgs: taskArgs,
      targetText: '远端分支 ' + remote + '/' + branch
    })
  }
}

function stableOf(value: any): string {
  if (value === null || value === undefined) return 'null'
  const kind = typeof value
  if (kind === 'string') return JSON.stringify(value)
  if (kind === 'number' || kind === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (let i = 0; i < value.length; i = i + 1) parts.push(stableOf(value[i]))
    return '[' + parts.join(',') + ']'
  }
  if (kind === 'object') {
    const keys = Object.keys(value).sort()
    const parts: string[] = []
    for (let i = 0; i < keys.length; i = i + 1) parts.push(JSON.stringify(keys[i]) + ':' + stableOf(value[keys[i]]))
    return '{' + parts.join(',') + '}'
  }
  return JSON.stringify(String(value))
}

// 票据里记的计划摘要：同一个 plan 永远得到同一个字符串，键序不影响结果。
export function syncPlanDigestInput(plan: any): string {
  return stableOf(plan === undefined || plan === null ? null : plan)
}

// 宿主用它判断能不能追加 --force-if-includes；解析失败按低版本处理（宁可不加，也不假装加了）。
export function syncVersionAtLeast(version: any, major: number, minor: number): boolean {
  const text = textOf(version)
  const found = /([0-9]+)\.([0-9]+)/.exec(text)
  if (found === null) return false
  const gotMajor = parseInt(found[1], 10)
  const gotMinor = parseInt(found[2], 10)
  if (gotMajor !== major) return gotMajor > major
  return gotMinor >= minor
}
