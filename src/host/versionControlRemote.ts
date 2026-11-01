/**
 * src/host/versionControlRemote.ts —— 域 8「远端与同步」的宿主电话（#1754 T18）
 *
 * 只做三件事：读远端列表（本地，不联网）、做四条写动作（add / rename / remove / set-url）、
 * 在用户显式要求时跑一次 git ls-remote（唯一允许的只读联网操作，ADR 20261031 第 6 节）。
 * 四条写动作照贮藏那一套走三段式（#1776 M4b）：预检电话 wf.gitRemoteCheck 签一张 120 秒的票 →
 * 页面确认卡 → 执行电话凭票动手。本文件只负责读列表与起写进程；票的判定在同层叶子
 * versionControlRemoteCheck.ts（纯内存，不起任何进程）。
 *
 * 纪律：
 *   1. 起进程只走父文件注入的 runPinned（同一个-D 钉目录、固定前缀、报闸、字节上限、git.exec 日志）；
 *      本文件不碰 subprocess，也不自造日志事件名。
 *   2. 联网那一路必须由用户显式触发才走：本文件不设定时器、不自动重试、不落盘缓存；
 *      同一仓库同一远端的在途请求只飞一个，重复点击拿到的是同一个 Promise。
 *   3. 失败不说谎：写动作做完要重新读一遍列表，用真实状态回话；读不全就整体失败，不给半份。
 *   4. 地址与失败原话都要过共享层的 scrub，口令原文不进回包、不进日志。
 *
 * 为什么参数按 any 收：runPinned / failureFromExec 等能力由父文件注入，形状由接线处决定；
 * 本文件只读用到的那几个成员，类型只做最小约束。
 */
import {
  parseRemoteList,
  parseRemoteBranches,
  parseLsRemote,
  remoteListArgs,
  remoteBranchesArgs,
  remoteAddArgs,
  remoteRenameArgs,
  remoteRemoveArgs,
  remoteSetUrlArgs,
  lsRemoteArgs,
  remoteNameProblem,
  remoteUrlProblem,
  remoteRefSelectorProblem,
  remoteWriteActionOf,
  classifyLsRemoteFailure,
} from '../shared/version-control/src/remote.js'
import { nonInteractiveGitEnv } from '../shared/version-control/src/commands.js'
// 远端写动作的票据层（#1776 M4b）：签票、复核绑定、requestId 去重都在同层叶子，本文件只管读列表与起写进程。
import { createRemoteTickets } from './versionControlRemoteCheck.js'
// 值由 tests/verify-time-config.ts 看守一致：联网查看与四条写动作的超时住 config/timeouts.yaml，源码只导入生成常量。
import { VC_REMOTE_ONLINE_TIMEOUT_MS as ONLINE_TIMEOUT_MS, VC_REMOTE_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 父文件注入的依赖：全部显式传入，本文件不引用父文件（单向引用）。 */
export interface RemotePhoneDeps {
  runPinned: any
  failureFromExec: any
  failPhone: any
  resolveGitExecutable: any
  resolveRepoRoot: any
  cwdOf: any
  nowMs: any
}

/** 一次联网读取最多等多久：ADR 要求限频，也让卡住的连接不把面板拖死（值住 config/timeouts.yaml）。 */
/** 远端列表与每个远端的分支读数的输出上限：几十个远端也远用不到这么多。 */
const LIST_STDOUT_LIMIT: number = 2 * 1024 * 1024
const BRANCH_STDOUT_LIMIT: number = 512 * 1024
const ONLINE_STDOUT_LIMIT: number = 4 * 1024 * 1024

/** 造这一族电话；依赖由父文件显式传入。 */
export function createRemotePhones(deps: any): any {
  const { runPinned, failureFromExec, failPhone, resolveGitExecutable, resolveRepoRoot, cwdOf, nowMs }: RemotePhoneDeps = deps
  /** 在途的联网请求（同一 cwd + 远端名 + 引用选择器只飞一个）。不设过期、不自动重发。 */
  const inflight: Map<string, Promise<any>> = new Map()
  /** 四条写动作的票据层：票表与 requestId 结果表只活在宿主内存里（不落盘、不进日志）。 */
  const tickets: any = createRemoteTickets({ nowMs: nowMs })

  /** 域 8 自己的失败信封：kind 是稳定分类，reason 是更细的标识符，message/hint 是给人看的话。 */
  function fail(kind: string, reason: string, message: string, hint: string): any {
    return { ok: false, error: { kind: kind, reason: reason, message: message, hint: hint } }
  }
  /** 把父文件注入的失败信封（failPhone / failureFromExec 的产物）转成域 8 的形状，补上 reason。 */
  function adapt(cause: any, reason: string, hint: string): any {
    const kind: string = (cause && cause.error && cause.error.kind) || 'env'
    const message: string = (cause && cause.error && cause.error.message) || '这一步没有成功'
    return fail(kind, reason, message, hint)
  }
  /** 起 git：先找可执行文件，再问出仓库根；两步都失败就回失败信封。 */
  async function prepare(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { ok: false, fail: failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, cwd)
    if (base.ok !== true) return { ok: false, fail: base }
    return { ok: true, exe: exe, root: base.root }
  }
  /** 读一遍远端列表 + 每个远端的本地跟踪分支（全部本地命令，不联网）。 */
  async function readState(exe: any, root: any): Promise<any> {
    const res: any = await runPinned(exe, root, remoteListArgs(), { stdoutLimit: LIST_STDOUT_LIMIT })
    const bad: any = failureFromExec(res, '读远端列表这一步')
    if (bad) return bad
    if (res.truncated) return failPhone('truncated', '远端列表超过了尺寸上限，读不全就不给半份。请减少远端数量后再试。')
    const parsed: any = parseRemoteList(res.stdout)
    if (parsed.ok !== true) return fail('parse', 'remote-list-malformed', '远端列表读不全（有远端缺 fetch 或 push 记录）。面板不猜，请到终端里跑一次 git remote -v 看看。', '')
    const remotes: any[] = []
    for (const entry of parsed.remotes) {
      const br: any = await runPinned(exe, root, remoteBranchesArgs(entry.name), { stdoutLimit: BRANCH_STDOUT_LIMIT })
      const brBad: any = failureFromExec(br, '读远端 ' + entry.name + ' 的跟踪分支这一步')
      if (brBad) return brBad
      if (br.truncated) return failPhone('truncated', '远端 ' + entry.name + ' 的跟踪分支读不全（输出被截断），不给半份。')
      const branches: any = parseRemoteBranches(br.stdout, entry.name)
      if (branches.ok !== true) return fail('parse', 'remote-branches-malformed', '远端 ' + entry.name + ' 的跟踪分支读不全（记录格式不对）。面板不猜。', '')
      remotes.push({
        name: entry.name,
        fetchUrl: entry.fetchUrl,
        pushUrl: entry.pushUrl,
        hasCredential: entry.hasCredential,
        branchCount: branches.branches.length,
        branches: branches.branches,
      })
    }
    return { ok: true, source: 'local', readAtMs: nowMs(), remotes: remotes }
  }
  /** 远端列表电话：只读本地记录，打开页面与刷新都走它，绝不联网。 */
  async function handleGitRemoteList(args: any): Promise<any> {
    const p: any = await prepare(cwdOf(args))
    if (!p.ok) return p.fail
    return await readState(p.exe, p.root)
  }
  /**
   * 预检电话（#1776 M4b）：只读一遍远端列表判目标，签一张 120 秒的票；写进程一个都不起。
   * 回包里的 remotes 是远端列表摘要（名 / fetch / push），确认卡用它说清「现在这张列表长什么样」。
   */
  async function handleGitRemoteCheck(args: any): Promise<any> {
    const action: string = String((args && args.action) || '')
    if (!remoteWriteActionOf(action)) return fail('args', 'remote-action', '不认识的远端动作，预检没有发起。', '只能从登记 / 改名 / 删除 / 改地址四种里选。')
    const p: any = await prepare(cwdOf(args))
    if (!p.ok) return p.fail
    const before: any = await readState(p.exe, p.root)
    if (before.ok !== true) return before
    return tickets.issue(action, args, { root: p.root, remotes: before.remotes, readAtMs: before.readAtMs })
  }
  /**
   * 写动作的统一外壳（#1776 M4b）：先过票据关（不碰进程）→ 读一遍远端列表 → 复核票据绑定 →
   * 凭票做 → 重新读一遍列表（用真实状态回话）→ 按请求号记下结果供重放去重。
   * 票据过期、动作不符、没经过确认卡时，写进程一个都不起；绑定状态不一致时读进程照跑、写进程不起。
   */
  async function writeAction(action: string, command: string, input: any, run: any): Promise<any> {
    const pre: any = tickets.precheck(action, input)
    if (pre.ok !== true) return pre
    if (pre.replay) return pre.replay
    const p: any = await prepare(cwdOf(input))
    if (!p.ok) return p.fail
    const before: any = await readState(p.exe, p.root)
    if (before.ok !== true) return before
    const confirm: any = tickets.confirmState(action, input, { root: p.root, remotes: before.remotes })
    if (confirm.ok !== true) return confirm
    const target: any = run.target(before.remotes)
    const refuse: any = run.refuse(target)
    if (refuse) return refuse
    const t0: number = nowMs()
    const res: any = await runPinned(p.exe, p.root, run.argv(), { timeoutMs: WRITE_TIMEOUT_MS })
    const bad: any = failureFromExec(res, '执行 ' + command + ' 这一步')
    if (bad) return adapt(bad, 'remote-write-failed', '写动作没有成功，远端列表仍是动手前的样子。请按上面的 git 原话处理后再试。')
    const after: any = await readState(p.exe, p.root)
    if (after.ok !== true) {
      return fail('read-after', 'remote-read-after-failed', '动作已经发出去，但重新读远端列表没有成功，没法确认结果。请点一下刷新，看一眼列表再决定。', '')
    }
    const reply: any = {
      ok: true,
      action: action,
      command: command,
      name: run.name,
      ms: Math.max(0, nowMs() - t0),
      n: 1,
      before: { exists: !!target, url: target ? target.fetchUrl : null },
      after: { remotes: after.remotes.map((r: any) => r.name), readAtMs: after.readAtMs },
      readAtMs: after.readAtMs,
    }
    tickets.remember(input && input.requestId, reply)
    return reply
  }
  /** 登记远端（8.2）。 */
  async function handleGitRemoteAdd(args: any): Promise<any> {
    const name: any = args && args.name
    const url: any = args && args.url
    const nameProblem: any = remoteNameProblem(name)
    if (nameProblem) return fail('args', 'remote-name', '远端名不能为空、不能以减号开头、不能含空白或控制字符。', '换一个名字再试。')
    const urlProblem: any = remoteUrlProblem(url)
    if (urlProblem) return fail('args', 'remote-url', '这个地址面板不认（支持 https / http / ssh / git / file、本机路径与 git@host:path 这种写法）。', '检查地址是否完整、是否含空白。')
    return await writeAction('add', 'git remote add', args, {
      name: name,
      argv: function (): string[] { return remoteAddArgs(name, url) },
      target: function (remotes: any[]): any { return remotes.filter((r: any) => r.name === name)[0] || null },
      refuse: function (target: any): any {
        if (target) return fail('args', 'remote-exists', '已经有叫 ' + name + ' 的远端了。', '先删掉或改名原来的远端，或者换一个名字。')
        return null
      },
    })
  }
  /** 改名远端（8.2）。 */
  async function handleGitRemoteRename(args: any): Promise<any> {
    const from: any = args && args.from
    const to: any = args && args.to
    const fromProblem: any = remoteNameProblem(from)
    const toProblem: any = remoteNameProblem(to)
    if (fromProblem || toProblem) return fail('args', 'remote-name', '远端名不能为空、不能以减号开头、不能含空白或控制字符。', '换一个名字再试。')
    if (from === to) return fail('args', 'remote-unchanged', '新旧名字是同一个，这次改名没有意义。', '换一个新的名字再试。')
    return await writeAction('rename', 'git remote rename', args, {
      name: to,
      argv: function (): string[] { return remoteRenameArgs(from, to) },
      target: function (remotes: any[]): any { return remotes.filter((r: any) => r.name === from)[0] || null },
      refuse: function (target: any): any {
        if (!target) return fail('args', 'remote-missing', '没有叫 ' + from + ' 的远端，改名做不了。', '刷新一下远端列表再选。')
        return null
      },
    })
  }
  /** 删除远端（8.2）：确认卡在客户端贴触发点，这里是凭票执行端。 */
  async function handleGitRemoteRemove(args: any): Promise<any> {
    const name: any = args && args.name
    const nameProblem: any = remoteNameProblem(name)
    if (nameProblem) return fail('args', 'remote-name', '远端名不能为空、不能以减号开头、不能含空白或控制字符。', '从远端列表里选一个再试。')
    return await writeAction('remove', 'git remote remove', args, {
      name: name,
      argv: function (): string[] { return remoteRemoveArgs(name) },
      target: function (remotes: any[]): any { return remotes.filter((r: any) => r.name === name)[0] || null },
      refuse: function (target: any): any {
        if (!target) return fail('args', 'remote-missing', '没有叫 ' + name + ' 的远端，删除做不了。', '刷新一下远端列表再选。')
        return null
      },
    })
  }
  /** 改地址（8.3）。 */
  async function handleGitRemoteSetUrl(args: any): Promise<any> {
    const name: any = args && args.name
    const url: any = args && args.url
    const nameProblem: any = remoteNameProblem(name)
    if (nameProblem) return fail('args', 'remote-name', '远端名不能为空、不能以减号开头、不能含空白或控制字符。', '从远端列表里选一个再试。')
    const urlProblem: any = remoteUrlProblem(url)
    if (urlProblem) return fail('args', 'remote-url', '这个地址面板不认（支持 https / http / ssh / git / file、本机路径与 git@host:path 这种写法）。', '检查地址是否完整、是否含空白。')
    return await writeAction('setUrl', 'git remote set-url', args, {
      name: name,
      argv: function (): string[] { return remoteSetUrlArgs(name, url) },
      target: function (remotes: any[]): any { return remotes.filter((r: any) => r.name === name)[0] || null },
      refuse: function (target: any): any {
        if (!target) return fail('args', 'remote-missing', '没有叫 ' + name + ' 的远端，改地址做不了。', '刷新一下远端列表再选。')
        if (target.fetchUrl === url && target.pushUrl === url) return fail('args', 'remote-unchanged', '新地址和现在一样，这次没有改动。', '换一个地址再试。')
        return null
      },
    })
  }
  /** 联网查看（8.4，唯一允许的只读联网操作）：同一请求在途时复用同一个 Promise。 */
  function handleGitRemoteOnline(args: any): Promise<any> {
    const name: any = args && args.name
    const refs: any = (args && Array.isArray(args.refs)) ? args.refs : []
    const nameProblem: any = remoteNameProblem(name)
    if (nameProblem) return Promise.resolve(fail('args', 'remote-name', '远端名不合法，联网查看没有发起。', '从远端列表里选一个再试。'))
    for (const ref of refs) {
      if (remoteRefSelectorProblem(ref)) return Promise.resolve(fail('args', 'remote-ref', '引用选择器不合法，联网查看没有发起。', '只写分支短名或完整的 refs/heads/…、refs/tags/…。'))
    }
    const key: string = JSON.stringify([cwdOf(args), name, refs])
    const running: any = inflight.get(key)
    if (running) return running
    const p: Promise<any> = onlineRun(cwdOf(args), name, refs)
    inflight.set(key, p)
    const clear: any = function (): void { if (inflight.get(key) === p) inflight.delete(key) }
    p.then(clear, clear)
    return p
  }
  /** 真正跑一次 ls-remote：先确认远端在本地白名单里（不联网），再起进程，最后按结果分类。 */
  async function onlineRun(cwd: any, name: string, refs: any[]): Promise<any> {
    const p: any = await prepare(cwd)
    if (!p.ok) return p.fail
    const before: any = await readState(p.exe, p.root)
    if (before.ok !== true) return before
    if (!before.remotes.some((r: any) => r.name === name)) {
      return fail('args', 'remote-missing', '没有叫 ' + name + ' 的远端，联网查看没有发起。', '刷新一下远端列表再选。')
    }
    const res: any = await runPinned(p.exe, p.root, lsRemoteArgs(name, refs), {
      stdoutLimit: ONLINE_STDOUT_LIMIT,
      timeoutMs: ONLINE_TIMEOUT_MS,
      env: nonInteractiveGitEnv(),
    })
    const failure: any = classifyLsRemoteFailure(res)
    if (failure) return { ok: false, error: failure, remoteName: name }
    const parsed: any = parseLsRemote(res.stdout)
    if (parsed.ok !== true) {
      return fail('parse', 'ls-remote-malformed', '远端的引用清单读不懂（提交号或引用名格式不对），这次不给半份。', '稍后再点一次；一直不行就到终端里手动跑 git ls-remote 看完整输出。')
    }
    return { ok: true, source: 'network', remoteName: name, refs: parsed.refs, count: parsed.refs.length, readAtMs: nowMs(), truncated: false }
  }

  return {
    handleGitRemoteList: handleGitRemoteList,
    handleGitRemoteCheck: handleGitRemoteCheck,
    handleGitRemoteAdd: handleGitRemoteAdd,
    handleGitRemoteRename: handleGitRemoteRename,
    handleGitRemoteRemove: handleGitRemoteRemove,
    handleGitRemoteSetUrl: handleGitRemoteSetUrl,
    handleGitRemoteOnline: handleGitRemoteOnline,
    readState: readState,
  }
}
// 七条电话的日志包装搬到共享层 src/shared/version-control/src/remote-handles.ts（#1754 T18 起六条，
// #1776 M4b 加远端预检 wf.gitRemoteCheck 后七条）：宿主父文件不能静态 import 同层叶子
// （same-layer-import-host），包装逻辑放在共享层后，父文件只递一个按需取件的函数，
// 这里留纯电话体与它们共用的 in-flight 表。
