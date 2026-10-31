// 同步动作的预检：读现场 → 共享层判定 → 签 120 秒的票（#1755 T19，域 8 的 8.5–8.14）。
//
// 这个文件只读，不起任何写进程。流程与 branch-check 同一条路子（票面要求复用它的纪律）：
//   ① 读一次现场（readScreenOf；与执行时复核用的是同一个读数口）；
//   ② 强推必须先跑 ls-remote 拿到远端当场的提交号，租约基准只能来自这一次联网读取；
//   ③ 共享层 syncPlanOf 归一参数与 argv，judgeSync 给出 allow/warn/block；
//   ④ block 时回失败信封并带上原因与现场，零票；否则签票，票里记 plan 摘要与远端 oid。
//
// 票只在 120 秒内有效（TICKET_TTL_MS）；执行叶子会重验仓库、HEAD、动作与票号，现场变了就零进程拒绝。

import { makeBindings, makeTicket } from '../shared/version-control/src/write-ticket.js'
import { syncActionOf, syncPlanDigestInput, syncPlanOf, syncVersionAtLeast, SYNC_CHECK_CONTRACT, SYNC_CHECK_VERSION } from '../shared/version-control/src/sync-actions.js'
import { judgeSync, syncConfirmOf, syncReasonTextOf } from '../shared/version-control/src/sync-rules.js'
import { classifyLsRemoteFailure, parseLsRemote, parseRemoteList } from '../shared/version-control/src/remote.js'
import { taskArgsFor } from '../shared/version-control/src/task-protocol.js'
import { VC_BRANCH_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

export const SYNC_CHECK_SOURCE = 'src/host/versionControlSyncCheck.ts'

// 一张票最多在内存里留 200 张；超出按签票时刻丢最旧的，避免长时间开会话把内存撑大。
function trimTickets(tickets: any): void {
  if (tickets.size <= 200) return
  const rows: any[] = []
  tickets.forEach(function (t: any) { rows.push(t) })
  rows.sort(function (a: any, b: any) { return a.checkedAtMs - b.checkedAtMs })
  while (tickets.size > 200) tickets.delete(rows.shift().id)
}

export function createSyncCheck(d: any): any {
  const failPhone: any = d.failPhone
  const failureFromExec: any = d.failureFromExec
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const readScreenOf: any = d.readScreenOf
  const runPinned: any = d.runPinned
  const now: any = d.now
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()
  let seq = 0

  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
  }

  function gitSays(res: any): string {
    const stderr: string = String((res && res.stderr) || '').trim()
    const text: string = stderr !== '' ? stderr : String((res && res.stdout) || '').trim()
    const line: string = text.split('\n')[0] || ''
    return line.slice(0, 400)
  }

  async function readText(exe: any, root: string, argv: string[], step: string): Promise<any> {
    const res: any = await runPinned(exe, root, argv, { stdoutLimit: 1024 * 1024, timeoutMs: READ_TIMEOUT_MS })
    if (res && res.truncated === true) return { ok: false, fail: fail('truncated', 'truncated', 'git 输出被截断，读不全就不给半份', { git: gitSays(res), step: step }) }
    if (!res || res.kind !== 'ok') {
      const bad: any = failureFromExec(res, step)
      if (bad) return { ok: false, fail: bad }
      return { ok: false, fail: fail('git', 'git-failed', '读仓库现场失败', { git: gitSays(res), step: step }) }
    }
    return { ok: true, text: String(res.stdout || '') }
  }

  // 现场归一：共享层判定只吃这几个布尔与清单，不自己去解析 screen 的复杂形状。
  function sceneOf(screen: any, remotes: string[]): any {
    const identity: any = (screen && screen.identity) || {}
    const repo: any = (screen && screen.repo) || {}
    return {
      bare: repo.bare === true,
      detached: identity.detached === true,
      currentBranch: String(identity.branch || ''),
      midOperation: repo.merging === true || repo.rebasing === true || repo.cherryPicking === true || repo.reverting === true,
      conflicts: Number((screen && screen.conflictCount) || 0) > 0,
      dirty: Number((screen && screen.stagedCount) || 0) + Number((screen && screen.unstagedCount) || 0) > 0,
      remotes: remotes,
      upstreamGone: identity.sync === 'upstream-gone'
    }
  }

  // 强制租约：先按占位 oid 过一遍形状校验拿到远端与分支名，再用真实基准重新规划。
  async function leaseBaseline(exe: any, root: string, plan: any): Promise<any> {
    const res: any = await runPinned(exe, root, ['ls-remote', plan.remote, 'refs/heads/' + plan.branch], { stdoutLimit: 1024 * 1024, timeoutMs: READ_TIMEOUT_MS })
    if (res && res.truncated === true) return { ok: false, fail: fail('truncated', 'truncated', 'ls-remote 输出被截断，强推没有可信的租约基准', { step: '读取远端租约基准' }) }
    if (!res || res.kind !== 'ok') {
      const classified: any = classifyLsRemoteFailure(res || {})
      if (classified && classified.kind) {
        return { ok: false, fail: fail(classified.kind, classified.kind, String(classified.message || '联网读取远端失败'), { git: gitSays(res), step: '读取远端租约基准', hint: String(classified.hint || '') }) }
      }
      const bad: any = failureFromExec(res, '读取远端租约基准这一步')
      if (bad) return { ok: false, fail: bad }
      return { ok: false, fail: fail('network', 'ls-remote-failed', '联网读取远端失败', { git: gitSays(res), step: '读取远端租约基准' }) }
    }
    const parsed: any = parseLsRemote(res.stdout)
    if (parsed.ok !== true) return { ok: false, fail: fail('parse', 'baseline-bad', 'ls-remote 的输出读不懂，不能当租约基准：' + String(parsed.error || ''), { step: '解析远端租约基准' }) }
    const ref: string = 'refs/heads/' + plan.branch
    let oid: string = ''
    for (let i = 0; i < parsed.refs.length; i = i + 1) if (parsed.refs[i].ref === ref) oid = String(parsed.refs[i].oid || '')
    if (oid === '') return { ok: false, fail: fail('blocked', 'baseline-missing', syncReasonTextOf('baseline-missing'), { step: '读取远端租约基准' }) }
    if (!/^[0-9a-fA-F]{7,64}$/.test(oid)) return { ok: false, fail: fail('parse', 'baseline-bad', syncReasonTextOf('baseline-bad'), { step: '解析远端租约基准' }) }
    return { ok: true, oid: oid, readAtMs: now() }
  }

  async function handleGitSyncCheck(rawArgs: any): Promise<any> {
    const a: any = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
    const cwd: string = typeof a.cwd === 'string' ? a.cwd : ''
    if (cwd === '') return fail('bad-target', 'bad-target', '缺少仓库目录（cwd）')
    const entry: any = syncActionOf(a.action)
    if (entry === null) {
      const probe: any = syncPlanOf(a.action, {})
      return fail('bad-target', probe.reason, probe.message)
    }
    const exe: any = await resolveGitExecutable()
    if (!exe) return fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const sr: any = await readScreenOf(cwd)
    if (!sr || sr.ok !== true) return sr
    const screen: any = sr.screen
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return base
    const root: string = String(base.root)
    const remoteText: any = await readText(exe, root, ['remote', '-v'], '读远端清单这一步')
    if (!remoteText.ok) return remoteText.fail
    const remoteParsed: any = parseRemoteList(remoteText.text)
    if (remoteParsed.ok !== true) return fail('parse', 'parse', '远端清单读不懂：' + String(remoteParsed.error || ''), { step: '解析远端清单' })
    const remoteNames: string[] = []
    for (let i = 0; i < remoteParsed.remotes.length; i = i + 1) {
      const name: string = String(remoteParsed.remotes[i].name || '')
      if (name !== '' && remoteNames.indexOf(name) < 0) remoteNames.push(name)
    }
    const scene: any = sceneOf(screen, remoteNames)
    let baseline: any = null
    let plan: any = null
    if (entry.action === 'force-push') {
      const draft: any = syncPlanOf(entry.action, Object.assign({}, a, { leaseOid: '0000000000000000000000000000000000000000' }))
      if (draft.ok !== true) return fail('bad-target', draft.reason, draft.message)
      baseline = await leaseBaseline(exe, root, draft.plan)
      if (!baseline.ok) return baseline.fail
      const withLease: any = syncPlanOf(entry.action, Object.assign({}, a, { leaseOid: baseline.oid, forceIfIncludes: syncVersionAtLeast(sr.gitVersion, 2, 30) }))
      if (withLease.ok !== true) return fail('bad-target', withLease.reason, withLease.message)
      plan = withLease.plan
    } else {
      const planned: any = syncPlanOf(entry.action, a)
      if (planned.ok !== true) return fail('bad-target', planned.reason, planned.message)
      plan = planned.plan
    }
    const argvCheck: any = taskArgsFor(plan.op, plan.taskArgs)
    if (argvCheck.ok !== true) return fail('bad-args', String(argvCheck.reason || 'bad-args'), String(argvCheck.message || '长任务参数不合法'))
    const judge: any = judgeSync(scene, plan)
    const readAtMs: number = now()
    const reasonRows: any[] = judge.reasons.map(function (id: string) { return { id: id, text: syncReasonTextOf(id), blocking: judge.blockingReasons.indexOf(id) >= 0 } })
    const versionPolicy: any = plan.versionNeed ? { need: plan.versionNeed, satisfied: plan.forceIfIncludes === true, note: String(plan.versionNote || '') } : null
    if (judge.decision === 'block') {
      const first: string = judge.blockingReasons.length > 0 ? judge.blockingReasons[0] : 'bad-plan'
      return fail('blocked', first, syncReasonTextOf(first), { decision: 'block', reasons: reasonRows, scene: scene, readAtMs: readAtMs, baseline: baseline ? { source: 'network', oid: baseline.oid, readAtMs: baseline.readAtMs } : null, versionPolicy: versionPolicy })
    }
    let oldOid: string = baseline ? String(baseline.oid) : ''
    let newOid: string = ''
    if (entry.action === 'force-push') {
      const local: any = await readText(exe, root, ['rev-parse', 'refs/heads/' + plan.localBranch], '读本地分支提交号这一步')
      if (!local.ok) return local.fail
      newOid = String(local.text).trim().split('\n')[0]
      if (!/^[0-9a-fA-F]{7,64}$/.test(newOid)) return fail('parse', 'parse', '本地分支的提交号读不懂，不能点名强推目标', { step: '解析本地分支提交号' })
    }
    const confirm: any = syncConfirmOf(plan, { oldOid: oldOid, newOid: newOid })
    seq = seq + 1
    const ticket: any = makeTicket({
      id: 'sync-' + String(now()) + '-' + String(seq),
      op: plan.op,
      nowMs: now(),
      headOid: String((screen.identity && screen.identity.oid) || ''),
      indexFingerprint: null,
      indexEntries: Number((screen && screen.stagedCount) || 0),
      target: plan,
      repoRoot: root,
      bindings: makeBindings({ preconditions: { planDigest: syncPlanDigestInput(plan), remoteOid: baseline ? baseline.oid : null } })
    })
    tickets.set(ticket.id, ticket)
    trimTickets(tickets)
    return {
      ok: true,
      contract: SYNC_CHECK_CONTRACT,
      version: SYNC_CHECK_VERSION,
      action: plan.action,
      capabilityId: plan.id,
      op: plan.op,
      level: plan.level,
      command: plan.commandText,
      decision: judge.decision,
      reasons: reasonRows,
      confirmRequired: judge.confirmRequired === true,
      confirm: confirm,
      plan: plan,
      ticket: ticket,
      oldOid: oldOid,
      newOid: newOid,
      baseline: baseline ? { source: 'network', oid: String(baseline.oid), readAtMs: baseline.readAtMs } : null,
      scene: scene,
      readAtMs: readAtMs,
      versionPolicy: versionPolicy
    }
  }

  // 执行前复核用同一个读数口：仓库根、HEAD、工作区形状都要重新读一遍，现场变了就拒绝。
  async function measure(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { ok: false, envelope: fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const sr: any = await readScreenOf(cwd)
    if (!sr || sr.ok !== true) return { ok: false, envelope: sr }
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return { ok: false, envelope: base }
    const screen: any = sr.screen
    return { ok: true, root: String(base.root), headOid: String((screen.identity && screen.identity.oid) || ''), screen: screen }
  }

  return { tickets: tickets, results: results, handleGitSyncCheck: handleGitSyncCheck, measure: measure, sceneOf: sceneOf }
}
