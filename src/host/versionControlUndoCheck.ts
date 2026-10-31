/**
 * src/host/versionControlUndoCheck.ts —— 历史改写五条动作的预检与签票（#1748 T13，规格 #1586 域 5）
 *
 * 为什么有这一层：撤销提交、硬重置、还原提交、拣选提交都是改写历史或工作区的动作，界面上都要走
 * 「预检一张确认卡 → 用户读几秒 → 点确认」。这几秒里仓库仍可能被别的程序改动：HEAD 被切走、
 * 工作区多了改动、引用指向了另一条提交。没有票据的话，用户确认的是「刚才那条」，执行的却是
 * 「现在这条」。办法照 #841/#1742/#1751 的既有先例：预检读真实现场，把「要动的那条提交 / 那个
 * HEAD / 那个工作区形状」量成绑定值写进票里，执行时逐格重验，任何一格变了就零命令拒绝。
 *
 * 本文件只做预检与只读测量，绝不执行写命令（写命令在 versionControlUndoWrite.ts）。硬重置是这一域
 * 唯一的「毁」级动作：预检必须先算出恢复点（会丢多少文件/行、怎么找回旧提交），算不出来就拒签票。
 */
import { failPhone, firstLine } from '../shared/version-control/exec-envelope.js'
import { parseDiffFiles } from '../shared/version-control/src/parse-diff-files.js'
import { makeTicket } from '../shared/version-control/src/write-ticket.js'
import { undoOpOf, undoPlanOf, undoArgvOf, undoDefaultMessageOf, undoMessageProblem } from '../shared/version-control/src/undo-ops.js'
import { UNDO_CHECK_CONTRACT, UNDO_CHECK_VERSION, undoPlanDigestOf, undoSceneSummaryOf, undoWorktreeDigestOf } from '../shared/version-control/src/undo-ticket.js'
import { recoveryPointOf } from '../shared/version-control/src/recovery-point.js'
import { VC_UNDO_READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 只读命令的输出上限：影响读数与提交号都不大，8MB 足够，超了按读不全拒。 */
const READ_LIMIT: number = 8 * 1024 * 1024
/** 数硬重置会丢多少东西那一条 diff 单独放宽到 4MB：改动多的大仓库会真的很大。 */
const IMPACT_LIMIT: number = 4 * 1024 * 1024

/**
 * 造预检层：签票、测现场、留票。票住在宿主进程内存里，不落盘、不进日志。
 * 依赖全部由装配壳显式传入，本文件不引别的宿主文件（同层单向）。
 */
export function createUndoCheck(deps: any): any {
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()
  const now = function (): number { try { return typeof deps.nowMs === 'function' ? Number(deps.nowMs()) : Date.now() } catch (e) { return Date.now() } }
  const mkId = function (): string { return 'un' + now().toString(36) + Math.random().toString(36).slice(2, 8) }
  const readTimeoutMs: number = Number(deps.readTimeoutMs) || VC_UNDO_READ_TIMEOUT_MS

  /** 失败信封：沿用宿主既有形状，另带稳定 reason 供界面与门禁对账（与贮藏、分支两族同一口径）。 */
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  /** 跑一条只读命令并翻成 {ok:true,stdout} 或失败信封；非零退出不当作成功。 */
  async function readOut(exe: string, root: string, args: string[], limit?: number): Promise<any> {
    let res: any
    try { res = await deps.runPinned(exe, root, args, { timeoutMs: readTimeoutMs, stdoutLimit: limit || READ_LIMIT }) } catch (e) { return fail('env', 'unknown', '只读命令没有起进程：' + firstLine(String((e && (e as any).message) || e))) }
    if (res && res.kind === 'ok') return { ok: true, stdout: String(res.stdout || ''), truncated: res.truncated === true }
    if (res && res.kind === 'non-zero') return fail('read', 'unknown', firstLine(res.stderr) || '只读命令以非零退出码结束了')
    return fail('read', 'unknown', firstLine(res && res.message) || '只读命令没有正常结束')
  }

  /** 解析仓库：找不到 git 或不是仓库都回明确失败信封。 */
  async function repoOf(cwd: string): Promise<any> {
    let exe: any = null
    try { exe = await deps.resolveGitExecutable() } catch (e) { exe = null }
    if (!exe) return fail('env', 'unknown', '找不到 git 命令，读不了仓库现场。')
    const repo: any = await deps.resolveRepoRoot(exe, cwd)
    if (!repo || repo.ok !== true) return repo && repo.error ? repo : fail('not-repo', 'unknown', '当前目录不是 git 仓库：' + cwd)
    return { ok: true, exe: String(exe), root: String(repo.root) }
  }

  /**
   * 测一次现场：首屏读数（同一个 readScreenOf，不另起一套读法）+ 仓库根 + 工作区形状摘要。
   * 预检与执行前的重验都走这一个函数，两次口径完全一样才能比出「变没变」。
   */
  async function measure(cwd: string): Promise<any> {
    const repo: any = await repoOf(cwd)
    if (repo.ok !== true) return repo
    let sc: any = null
    try { sc = await deps.readScreenOf(cwd) } catch (e) { sc = null }
    if (!sc || sc.ok !== true) return (sc && sc.error) ? sc : fail('read', 'unknown', '读不到仓库首屏，判断不了现场（' + firstLine(String((sc && sc.error && sc.error.message) || sc)) + '）')
    const scene: any = undoSceneSummaryOf(sc.screen)
    return { ok: true, exe: repo.exe, root: repo.root, screen: sc.screen, scene: scene, worktreeDigest: undoWorktreeDigestOf(sc.screen) }
  }

  /** 引用解析成提交全号：不存在回 target-missing（调用方按动作换成自己的 reason 与字段）。 */
  async function resolveCommit(exe: string, root: string, rev: string): Promise<any> {
    let res: any
    try { res = await deps.runPinned(exe, root, ['rev-parse', '--verify', '--quiet', rev + '^{commit}'], { timeoutMs: readTimeoutMs, stdoutLimit: 4096 }) } catch (e) { return fail('env', 'unknown', '确认提交这一步没有起进程：' + firstLine(String((e && (e as any).message) || e))) }
    if (res && res.kind === 'ok') {
      const oid: string = String(res.stdout || '').trim().toLowerCase()
      if (/^[0-9a-f]{40,64}$/.test(oid)) return { ok: true, oid: oid }
      return fail('parse', 'target-missing', 'git 给出的提交号形状不对：' + oid)
    }
    if (res && res.kind === 'non-zero') return { ok: false, reason: 'target-missing', message: '找不到这个提交：' + rev }
    return fail('env', 'unknown', '确认提交这一步没有正常结束：' + firstLine(res && res.message))
  }

  /** 这条提交已经在当前分支历史里了吗（拣选用途：已存在的提交再拣一次只会得到空提交，先拒）。 */
  async function ancestorOfHead(exe: string, root: string, oid: string): Promise<any> {
    const res: any = await deps.runPinned(exe, root, ['merge-base', '--is-ancestor', oid, 'HEAD'], { timeoutMs: readTimeoutMs, stdoutLimit: 4096 })
    if (res && res.kind === 'ok') return { ok: true, ancestor: true }
    if (res && res.kind === 'non-zero' && Number(res.exitCode) === 1) return { ok: true, ancestor: false }
    return fail('env', 'unknown', '判断提交是否已在历史里这一步没有正常结束。')
  }

  /** 读一条提交的标题（还原提交的默认说明要用）。 */
  async function subjectOf(exe: string, root: string, oid: string): Promise<any> {
    const res: any = await readOut(exe, root, ['log', '-1', '--format=%s', oid], 64 * 1024)
    if (res.ok !== true) return res
    return { ok: true, subject: String(res.stdout || '').replace(/\r/g, '').split('\n')[0] }
  }

  /**
   * 硬重置的恢复点：数「会丢什么」并记下「怎么找回」。
   * 数不全（解析失败、被截断、reflog 选择器读不出）一律拒签票，绝不拿半份计数去吓人或哄人。
   */
  async function recoveryOf(exe: string, root: string, plan: any, scene: any): Promise<any> {
    const diffRes: any = await readOut(exe, root, ['diff', '--numstat', '-z', String(plan.targetOid)], IMPACT_LIMIT)
    if (diffRes.ok !== true) return diffRes
    if (diffRes.truncated === true) return fail('read', 'recovery-unreadable', '硬重置的影响读数被截断了，数不全就不签票。')
    const parsed: any = parseDiffFiles(String(diffRes.stdout || ''))
    if (parsed.ok !== true) return fail('read', 'recovery-unreadable', '硬重置的影响读数解析失败：' + String(parsed.detail || parsed.error || '格式不对'))
    const files: any[] = parsed.files || []
    let added: number = 0
    let deleted: number = 0
    let binary: number = 0
    for (let i = 0; i < files.length; i += 1) {
      const one: any = files[i]
      if (one.added === null || one.deleted === null) binary += 1
      else { added += Number(one.added) || 0; deleted += Number(one.deleted) || 0 }
    }
    const selRes: any = await readOut(exe, root, ['reflog', 'show', '-n', '1', '--format=%gd', 'HEAD'], 4096)
    if (selRes.ok !== true) return fail('read', 'recovery-unreadable', '读不到当前 reflog 选择器，恢复路径写不出来，不签票。')
    const selector: string = String(selRes.stdout || '').trim()
    const matched: any = /^HEAD@\{(\d+)\}$/.exec(selector)
    if (!matched) return fail('read', 'recovery-unreadable', '读到的 reflog 选择器不是 HEAD@{n} 形状：' + selector)
    const countRes: any = await readOut(exe, root, ['rev-list', '--count', String(plan.targetOid) + '..HEAD'], 4096)
    if (countRes.ok !== true) return fail('read', 'recovery-unreadable', '数不出会被移出历史的提交有多少个，不签票。')
    const commits: number = Number(String(countRes.stdout || '').trim())
    if (!isFinite(commits) || commits < 0) return fail('read', 'recovery-unreadable', '会被移出历史的提交数读出来不是数：' + String(countRes.stdout || ''))
    const built: any = recoveryPointOf({
      headOid: scene.head, targetOid: String(plan.targetOid),
      impact: { files: files.length, added: added, deleted: deleted, binary: binary, truncated: false },
      commits: Math.floor(commits), reflogBefore: selector, reflogAfter: 'HEAD@{' + String(Number(matched[1]) + 1) + '}', atMs: now(),
    })
    if (built.ok !== true) return fail('read', built.reason, built.message)
    return { ok: true, point: built.point }
  }

  /**
   * 预检：校验输入 → 测现场 → 拒掉不能做的情形（没提交、停在中途操作、目标不存在、无事可做）
   * → 算恢复点/默认说明 → 解析提交号 → 签票。任何一步不成立都回明确失败，不签票。
   */
  async function handleCheck(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op === undefined || a.op === null ? '' : a.op)
    const def: any = undoOpOf(op)
    if (!def) return fail('usage', 'unknown-op', '没有这条历史改写动作：' + op)
    const planned: any = undoPlanOf(a)
    if (planned.ok !== true) return fail('usage', planned.reason, planned.message, { field: planned.field, index: planned.index })
    const plan: any = planned.plan
    const cwd: string = String(a.cwd || deps.defaultCwd || '')
    const m: any = await measure(cwd)
    if (m.ok !== true) return m
    const scene: any = m.scene
    if (scene.hasCommits !== true) return fail('blocked', 'no-head', '这个仓库还没有第一次提交，没有可改写的历史。', { scene: scene })
    if (scene.midOperation === true) return fail('blocked', 'mid-operation', '仓库正停在中途操作里（' + String(scene.midOperationWhich || '合并或变基') + '），先把它做完或放弃，再来改写历史。', { scene: scene })

    let defaultMessage: string = ''
    if (def.needsTarget === true) {
      const resolved: any = await resolveCommit(m.exe, m.root, plan.target)
      if (resolved.ok !== true) return fail('target', 'target-missing', resolved.message || '找不到这个提交：' + plan.target, { field: 'target', scene: scene })
      plan.targetOid = String(resolved.oid)
      if (plan.targetOid === scene.head) {
        if (op === 'reset-soft') return fail('blocked', 'nothing-to-do', '现在就在这个提交上，软重置过去不会改变任何东西。', { scene: scene })
        if (op === 'reset-mixed' && Number(scene.stagedCount) === 0) return fail('blocked', 'nothing-to-do', '现在就在这个提交上，暂存区也空着，混合重置没有可撤销的东西。', { scene: scene })
        if (op === 'reset-hard' && scene.dirty !== true) return fail('blocked', 'nothing-to-do', '现在就在这个提交上，工作区也干净，硬重置过去没有可丢的东西。', { scene: scene })
      }
      if (op === 'revert') {
        const subject: any = await subjectOf(m.exe, m.root, plan.targetOid)
        if (subject.ok !== true) return subject
        defaultMessage = undoDefaultMessageOf(subject.subject)
        if (String(plan.message) === '') plan.message = defaultMessage
        if (undoMessageProblem(plan.message) !== null) return fail('usage', 'message-too-long', '还原说明超过了长度上限，改短一点再预检。', { field: 'message' })
      }
    }

    let recovery: any = null
    if (def.needsRecovery === true) {
      const rec: any = await recoveryOf(m.exe, m.root, plan, scene)
      if (rec.ok !== true) return rec
      recovery = rec.point
      // 恢复点只给界面与票据摘要看；计划摘要按 undoPlanDigestOf 里点名的字段算，不带它，执行前才比得准。
      plan.recovery = recovery
    }

    if (def.needsCommits === true) {
      const picks: any[] = []
      for (let i = 0; i < plan.commits.length; i += 1) {
        const rev: string = String(plan.commits[i])
        const resolved: any = await resolveCommit(m.exe, m.root, rev)
        if (resolved.ok !== true) return fail('target', 'commits-invalid', '第 ' + String(i + 1) + ' 条：' + String(resolved.message || ('找不到这个提交：' + rev)), { field: 'commits', index: i + 1 })
        const anc: any = await ancestorOfHead(m.exe, m.root, String(resolved.oid))
        if (anc.ok !== true) return anc
        if (anc.ancestor === true) return fail('blocked', 'commit-already-present', '第 ' + String(i + 1) + ' 条提交已经在当前分支历史里了，再拣一次只会得到空提交。', { field: 'commits', index: i + 1 })
        picks.push({ rev: rev, oid: String(resolved.oid) })
      }
      plan.commits = picks
    }

    const built: any = undoArgvOf(plan)
    if (built.ok !== true) return fail('usage', built.reason || 'unknown', '这条动作的命令计划没拼出来，不签票。')
    const ticket: any = makeTicket({
      id: mkId(),
      // 历史改写五条动作名走同一套票据机制，但共享层 WriteOp 联合类型目前只列提交/拉取/推送/抓取与改动页动作；
      // 这里按任意字符串入票（扩联合要连带改七个登记点门禁与跨票评审，留给后续票）。
      op: op as any,
      nowMs: now(),
      headOid: String(scene.head),
      indexFingerprint: null,
      indexEntries: null,
      target: plan,
      repoRoot: String(m.root),
      bindings: { preconditions: { planDigest: undoPlanDigestOf(plan), worktreeDigest: String(m.worktreeDigest) }, counters: { indexEntries: null } },
    })
    tickets.set(ticket.id, ticket)
    if (tickets.size > 200) { const oldest: any = tickets.keys().next().value; tickets.delete(oldest) }
    const shownPlan: any = {
      op: plan.op, target: plan.target, targetOid: plan.targetOid, message: plan.message,
      commits: plan.commits, resetMode: plan.resetMode, recovery: plan.recovery || null,
    }
    return {
      ok: true,
      contract: UNDO_CHECK_CONTRACT,
      version: UNDO_CHECK_VERSION,
      op: def.op,
      capId: def.id,
      atMs: ticket.checkedAtMs,
      ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      scene: scene,
      plan: shownPlan,
      danger: def.danger === true,
      recovery: recovery,
      defaultMessage: defaultMessage,
      steps: built.steps,
      stepCount: built.steps.length,
    }
  }

  return { handleCheck: handleCheck, measure: measure, tickets: tickets, results: results }
}
