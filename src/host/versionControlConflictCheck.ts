// host/versionControlConflictCheck.ts —— 冲突向导（#1747 T12，规格域 6）的预检电话 wf.gitConflictCheck
//
// 一条写动作走三步（与改动页、分支域同一套）：预检签 120 秒票 → 用户确认 → 凭票执行一次。
// 本文件只做预检与只读：读现场（versionControlConflictScene.ts）、逐动作守卫、判定此刻能不能做、签票。
// 判定不许散落在界面：界面按共享层 conflict-ops.ts 的同一张表画按钮，拦不拦由这里说，理由用同一批标识符，
// 句子统一从 write-reasons.ts 的 writeHintFor 取——界面与宿主说同一句话。
//
// 只读动作（6.5 清单、6.9 视图、6.10 预演、6.14 rerere、6.15 残留标记）也走本文件的 handleConflictRead：
// 它们不签票、只在需要时重新读一遍现场，回包结构与写预检的回去一起（都带 contract/version/readAtMs）。
import { CONFLICT_WRITE_OPS, CONFLICT_READ_OPS, CONFLICT_CHECK_CONTRACT, CONFLICT_CHECK_VERSION, conflictOpMetaOf, conflictPlanOf, conflictTargetProblem, conflictPathProblem, conflictSideProblem, conflictOpAllowedIn } from '../shared/version-control/src/conflict-ops.js'
import { conflictTextProblem } from '../shared/version-control/src/conflict-text.js'
import { makeTicket } from '../shared/version-control/src/write-ticket.js'
import { writeHintFor } from '../shared/version-control/src/write-reasons.js'

/** 整份编辑允许的最大长度：1MiB。超过按「这段文本太大」拒，不把几兆字塞进票据或日志。 */
const TEXT_LIMIT = 1048576

/** 造预检电话：返回 { handleConflictCheck, handleConflictRead, tickets, results, measure }。
 *  tickets/results 住宿主进程内存，执行叶子共用同一份；measure 与预检同一口径重算现场。 */
export function createConflictCheck(deps: any): any {
  const d: any = deps || {}
  const scene: any = d.scene
  const failPhone: any = d.failPhone
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const randomId: any = (typeof d.randomId === 'function') ? d.randomId : function (): string { return Math.random().toString(36).slice(2) }
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()

  /** 失败信封：kind 是环节、reason 是固定理由标识符，附加字段平铺在顶层。 */
  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
  }
  /** 拒绝回包：与成功回包同一套形状（contract/version/op/decision/reasons/readAtMs），界面照同一判据画。 */
  function blocked(op: string, reason: string, extra?: any): any {
    return fail('blocked', reason, writeHintFor(reason), Object.assign({ contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION, op: op, decision: { verdict: 'block', reasons: [reason] }, reasons: [reason], readAtMs: nowFn() }, extra || {}))
  }
  function argsFail(reason: string, extra?: any): any {
    return fail('args', reason, writeHintFor(reason), Object.assign({ contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION }, extra || {}))
  }
  /** 现场摘要：block 时也要回，界面才能画「为什么不能点」；不回文件内容，只回条目形状。 */
  function sceneSummaryOf(s: any): any {
    return { state: s.state, conflictCount: s.conflictCount, headOid: s.headOid, gitVersion: s.gitVersion, conflicts: s.conflicts }
  }
  /** 确认卡文案：动词说清会发生什么；跳过与中止额外说清不可逆（规格四段确认卡）。 */
  function confirmOf(plan: any): any {
    const op: string = String(plan.op || '')
    const target: string = String(plan.target || '')
    const path: string = String(plan.path || '')
    const side: string = String(plan.side || '')
    const state: string = String(plan.state || '')
    const sideText: string = side === 'ours' ? '当前边' : (side === 'theirs' ? '对方边' : '保留删除')
    if (op === 'merge') return { kind: op, target: target, verb: '把 ' + target + ' 合并进当前分支' }
    if (op === 'merge-ff-only') return { kind: op, target: target, verb: '只允许快进地把 ' + target + ' 合并进来（不能快进就失败）' }
    if (op === 'merge-no-ff') return { kind: op, target: target, verb: '禁止快进，为这次合并单独生成一个合并提交（' + target + '）' }
    if (op === 'merge-squash') return { kind: op, target: target, verb: '把 ' + target + ' 的改动挤压成工作区改动，不生成合并提交' }
    if (op === 'take-side') return { kind: op, target: path, verb: '对 ' + path + ' 选' + sideText + '并登记进暂存区' }
    if (op === 'save-file') return { kind: op, target: path, verb: '把面板里编辑好的整份内容写回 ' + path + '（保存前会查残留冲突标记）' }
    if (op === 'mark-resolved') return { kind: op, target: path, verb: '把 ' + path + ' 标记为已解决（git add）' }
    if (op === 'op-continue') return { kind: op, target: state, verb: '继续这次 ' + state + '（用默认提交说明，不弹编辑器）' }
    if (op === 'op-skip') return { kind: op, target: state, verb: '跳过这次 ' + state + ' 的这一步（这一步的改动会丢掉，不能撤销）' }
    if (op === 'op-abort') return { kind: op, target: state, verb: '中止这次 ' + state + '（回到操作前，途中做过的事会丢）' }
    return { kind: op, target: target, verb: '执行 ' + op }
  }
  /** 签票：计划与判定随票保存，执行层只按票里的计划拼 argv。 */
  function sign(plan: any, s: any, decision: any, confirm: any, confirmRequired: boolean): any {
    const ticket: any = makeTicket({
      id: String(randomId()),
      op: plan.op as any,
      nowMs: nowFn(),
      headOid: s.headOid,
      indexFingerprint: null,
      indexEntries: null,
      target: null,
      repoRoot: s.repoRoot,
      changes: null,
      bindings: scene.bindingsOf(s, plan),
    })
    ticket.plan = plan
    ticket.conflict = plan
    ticket.decision = decision
    ticket.confirm = confirm
    ticket.confirmRequired = confirmRequired
    ticket.sceneSummary = sceneSummaryOf(s)
    tickets.set(ticket.id, ticket)
    // 票表只活内存；超过 200 张按插入顺序删最旧的，长会话里不会无限长。
    while (tickets.size > 200) { const k: any = tickets.keys().next().value; tickets.delete(k) }
    return ticket
  }
  function entryOf(s: any, path: string): any {
    for (let i = 0; i < s.conflicts.length; i += 1) if (String(s.conflicts[i].path) === path) return s.conflicts[i]
    return null
  }

  /** 只读动作：不签票、不写仓库；读不到就如实失败，不给半份读数。 */
  async function handleConflictRead(args: any): Promise<any> {
    const a: any = args || {}
    const cwd: string = typeof a.cwd === 'string' ? a.cwd : ''
    if (cwd.trim() === '') return argsFail('bad-target', { op: String(a.op || '') })
    const op: string = String(a.op || '')
    const meta: any = conflictOpMetaOf(op)
    if (meta === null || meta.kind !== 'read') return argsFail('bad-target', { op: op })
    if (op === 'conflict-list') {
      const s: any = await scene.sceneOf(cwd)
      if (s.ok !== true) return s.envelope
      return { ok: true, contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION, op: op, state: s.state, headOid: s.headOid, gitVersion: s.gitVersion, conflicts: s.conflicts, conflictCount: s.conflictCount, clean: s.conflictCount === 0, readAtMs: nowFn() }
    }
    if (op === 'conflict-view') {
      const path: string = String(a.path || '')
      const pProblem: any = conflictPathProblem(path)
      if (pProblem) return argsFail(pProblem, { op: op })
      const s: any = await scene.sceneOf(cwd)
      if (s.ok !== true) return s.envelope
      const entry: any = entryOf(s, path)
      if (entry === null) return blocked(op, 'path-not-conflicted', { scene: sceneSummaryOf(s) })
      const view: any = await scene.fileViewOf(s.repoRoot, path)
      if (view.ok !== true) return view.envelope
      if (entry.textKind === 'binary') return { ok: true, contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION, op: op, path: path, kind: 'binary', entry: entry, text: null, hunks: null, hunkCount: 0, readAtMs: nowFn() }
      return { ok: true, contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION, op: op, path: path, kind: view.kind, entry: entry, text: view.text, hunks: view.hunks, hunkCount: view.hunkCount, readAtMs: nowFn() }
    }
    if (op === 'merge-preview') {
      const target: string = String(a.target || '')
      const tProblem: any = conflictTargetProblem(target)
      if (tProblem) return argsFail(tProblem, { op: op })
      const s: any = await scene.sceneOf(cwd)
      if (s.ok !== true) return s.envelope
      const allowed: any = conflictOpAllowedIn(op, s.state, s.conflictCount > 0)
      if (allowed) return blocked(op, allowed, { scene: sceneSummaryOf(s) })
      const pre: any = await scene.mergePreviewOf(cwd, target)
      if (pre.ok !== true) return pre.envelope
      return Object.assign({ contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION, op: op, target: target }, pre)
    }
    if (op === 'rerere-view') {
      const r: any = await scene.rerereOf(cwd)
      if (r.ok !== true) return r.envelope
      return Object.assign({ contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION, op: op }, r)
    }
    const m: any = await scene.markerCheckOf(cwd)
    if (m.ok !== true) return m.envelope
    return Object.assign({ contract: CONFLICT_CHECK_CONTRACT, version: CONFLICT_CHECK_VERSION, op: op }, m)
  }

  /** 预检入口：校验 → 读现场 → 逐动作守卫 → 判定 → 签票（拒绝不签票，照样回现场）。 */
  async function handleConflictCheck(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op || '')
    const meta: any = conflictOpMetaOf(op)
    if (meta !== null && meta.kind === 'read') return handleConflictRead(a)
    if (meta === null || CONFLICT_WRITE_OPS.indexOf(meta) < 0) return argsFail('bad-target', { op: op })
    const cwd: string = typeof a.cwd === 'string' ? a.cwd : ''
    if (cwd.trim() === '') return argsFail('bad-target', { op: op })
    const s: any = await scene.sceneOf(cwd)
    if (s.ok !== true) return s.envelope
    const payload: any = (a.payload && typeof a.payload === 'object') ? a.payload : a
    const plan: any = conflictPlanOf({
      op: op,
      state: s.state,
      target: payload.target,
      path: payload.path,
      side: payload.side,
      textDigest: null,
      oldDigest: null,
    })
    const hasConflicts: boolean = s.conflictCount > 0
    // 动作本身此刻能不能做（进行中状态、有没有冲突、有没有可继续的操作）由共享层统一判。
    const allowed: any = conflictOpAllowedIn(op, s.state, hasConflicts)
    if (allowed) return blocked(op, allowed, { scene: sceneSummaryOf(s), confirm: confirmOf(plan) })
    if (op === 'merge' || op === 'merge-ff-only' || op === 'merge-no-ff' || op === 'merge-squash') {
      const tProblem: any = conflictTargetProblem(plan.target)
      if (tProblem) return argsFail(tProblem, { op: op })
      const rev: any = await scene.readOut(s.exe, s.repoRoot, '确认合并目标这一步', ['rev-parse', '-q', '--verify', String(plan.target) + '^{commit}'], { allowNonZero: true })
      if (rev.ok !== true) return rev.envelope
      if (rev.exitCode !== 0) return blocked(op, 'target-missing', { scene: sceneSummaryOf(s), confirm: confirmOf(plan) })
    }
    if (op === 'take-side') {
      const pProblem: any = conflictPathProblem(plan.path)
      if (pProblem) return argsFail(pProblem, { op: op })
      const sProblem: any = conflictSideProblem(plan.side)
      if (sProblem) return argsFail(sProblem, { op: op })
      const entry: any = entryOf(s, String(plan.path))
      if (entry === null) return blocked(op, 'path-not-conflicted', { scene: sceneSummaryOf(s), confirm: confirmOf(plan) })
      if (plan.side !== 'delete' && entry.sides[String(plan.side)] !== true) return blocked(op, 'side-missing', { scene: sceneSummaryOf(s), confirm: confirmOf(plan), path: entry.path })
    }
    if (op === 'save-file') {
      const pProblem: any = conflictPathProblem(plan.path)
      if (pProblem) return argsFail(pProblem, { op: op })
      const entry: any = entryOf(s, String(plan.path))
      if (entry === null) return blocked(op, 'path-not-conflicted', { scene: sceneSummaryOf(s), confirm: confirmOf(plan) })
      if (entry.textKind === 'binary') return blocked(op, 'binary-file', { scene: sceneSummaryOf(s), confirm: confirmOf(plan), path: entry.path })
      const text: any = payload.text
      const problem: any = conflictTextProblem(text, TEXT_LIMIT)
      if (problem) return blocked(op, String(problem.reason), { scene: sceneSummaryOf(s), confirm: confirmOf(plan), path: entry.path, line: problem.line || null, marker: problem.marker || null })
      const old: any = await scene.readTextFile(s.repoRoot, String(plan.path))
      if (old.ok !== true) return blocked(op, 'path-not-conflicted', { scene: sceneSummaryOf(s), confirm: confirmOf(plan), path: entry.path })
      plan.oldDigest = scene.digest16(old.text)
      plan.textDigest = scene.digest16(String(text))
    }
    if (op === 'mark-resolved') {
      const pProblem: any = conflictPathProblem(plan.path)
      if (pProblem) return argsFail(pProblem, { op: op })
      const entry: any = entryOf(s, String(plan.path))
      if (entry === null) return blocked(op, 'path-not-conflicted', { scene: sceneSummaryOf(s), confirm: confirmOf(plan) })
      const mc: any = await scene.markerCheckPathOf(cwd, String(plan.path))
      if (mc.ok !== true) return mc.envelope
      if (mc.clean !== true) return blocked(op, 'conflict-markers', { scene: sceneSummaryOf(s), confirm: confirmOf(plan), path: entry.path, line: mc.markers[0] ? mc.markers[0].line : null })
    }
    // 进行中操作类的动作：状态必须是四种之一（allowed 已经拦住没有状态的情形），这里只补状态名。
    if (op === 'op-continue' || op === 'op-skip' || op === 'op-abort') plan.state = s.state
    const confirm: any = confirmOf(plan)
    const confirmRequired: boolean = meta.confirm === true
    const decision: any = { verdict: 'allow', reasons: ['ok'] }
    const ticket: any = sign(plan, s, decision, confirm, confirmRequired)
    return {
      ok: true,
      contract: CONFLICT_CHECK_CONTRACT,
      version: CONFLICT_CHECK_VERSION,
      op: op,
      decision: decision,
      reasons: ['ok'],
      confirmRequired: confirmRequired,
      confirm: confirm,
      ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      plan: plan,
      scene: sceneSummaryOf(s),
      readAtMs: nowFn(),
    }
  }

  return { handleConflictCheck: handleConflictCheck, handleConflictRead: handleConflictRead, tickets: tickets, results: results, measure: scene.measure }
}

export const CONFLICT_CHECK_SOURCE = 'src/host/versionControlConflictCheck.ts'
