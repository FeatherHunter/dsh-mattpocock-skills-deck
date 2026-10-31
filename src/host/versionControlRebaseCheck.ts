// host/versionControlRebaseCheck.ts —— 变基待办页（#1749 T14）的预检签票电话 wf.gitRebaseCheck 与只读电话 wf.gitRebaseRead
//
// 这一层只做一件事：在真的执行之前，把「现在能不能做、做了会动哪些提交」读清楚，签一张 120 秒的票。
// 票里保存的是 rebasePlanOf 的固定格式计划与绑定表（计划摘要、工作区摘要、updateRefs 开关值、当时不存在的标记），
// 执行层凭票重算现场，任何一格对不上就零进程拒绝。
//
// 预检顺序（任何一步不过都零进程拒绝）：
//   ① 动作不在表里 → bad-target；② 缺仓库目录 → bad-target；③ 读现场；
//   ④ rebase.updateRefs=true → update-refs-on（规格明确不做 --update-refs，面板不替人改配置）；
//   ⑤ 已有进行中的操作 → operation-in-progress；
//   ⑥ 逐动作守卫：基座形状、待办行与窗口是否一致、换基座新旧基座、自动吸收有没有可吸收的对、
//      保留合并结构要 git 2.18；⑦ 签票。
//
// 只读动作（rebase-state / rebase-window / rebase-onto-range / rebase-autosquash-pairs / rebase-merges-cost）
// 走同一个电话名但只读表：界面打开页面时先读一遍，不需要先签票。
import { REBASE_CHECK_CONTRACT, REBASE_CHECK_VERSION, REBASE_WRITE_OPS, rebaseMessageProblemOf, rebaseOpMetaOf, rebasePlanOf, rebaseRowsProblem, rebaseTargetProblem } from '../shared/version-control/src/rebase-ops.js'
import { makeTicket } from '../shared/version-control/src/write-ticket.js'
import { writeHintFor } from '../shared/version-control/src/write-reasons.js'

/** 失败信封：reason 与附加字段平铺在顶层，kind 在 error 里（与改动页、冲突向导同一口径）。 */
function fail(kind: string, reason: string, message: string, extra?: any): any {
  return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message }, reason: reason }, extra || {})
}

/** 造预检电话：返回 { handleRebaseCheck, handleRebaseRead, tickets, results, measure }。 */
export function createRebaseCheck(deps: any): any {
  const d: any = deps || {}
  const scene: any = d.scene
  const failPhone: any = d.failPhone
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const randomId: any = (typeof d.randomId === 'function') ? d.randomId : function (): string { return String(nowFn()) }
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()

  function failAt(kind: string, reason: string, message: string, extra?: any): any { return failPhone(kind, message, Object.assign({ reason: reason }, extra || {})) }
  function argsFail(reason: string, message: string, extra?: any): any { return failAt('args', reason, message, extra) }
  /** 拒绝时也把契约、动作与读到的现场带上，界面不用猜是哪一步拦下的。 */
  function blocked(op: string, reason: string, message: string, extra?: any): any {
    return Object.assign(failAt('blocked', reason, message, extra), {
      contract: REBASE_CHECK_CONTRACT,
      version: REBASE_CHECK_VERSION,
      op: op,
      decision: { verdict: 'block', reasons: [reason] },
      reasons: [reason],
      readAtMs: nowFn(),
    })
  }
  function sceneSummaryOf(s: any): any {
    return { repoRoot: s.repoRoot, headOid: s.headOid, state: s.state, branch: s.branch, updateRefs: s.updateRefs, gitVersion: s.gitVersion }
  }
  /** 签票：票里保存计划与绑定表，超时沿用共享的 120 秒票据时限。 */
  function sign(plan: any, s: any, confirm: any): any {
    const ticket: any = makeTicket({
      id: randomId(),
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
    ticket.confirm = confirm
    ticket.confirmRequired = true
    ticket.sceneSummary = sceneSummaryOf(s)
    tickets.set(String(ticket.id), ticket)
    while (tickets.size > 200) { const k: any = tickets.keys().next().value; tickets.delete(k) }
    return ticket
  }
  /** 确认卡四段（规格要求：做了什么、不会做什么、能不能回退、按哪个词执行）。 */
  function confirmOf(plan: any, s: any, extra: any): any {
    const base: string = String(plan.base || plan.newBase || '')
    let what: string = '把 ' + base + ' 之后的提交按面板排好的待办清单重放一遍（改说明、压缩、丢弃、重排都在这一步生效）'
    if (plan.op === 'rebase-onto') what = '把旧基座 ' + String(plan.oldBase) + ' 之后的 ' + String(extra.movedCount) + ' 个提交搬到新基座 ' + String(plan.newBase) + ' 上重新放一遍'
    if (plan.op === 'rebase-autosquash') what = '把 ' + base + ' 之后带 fixup!/squash! 标记的 ' + String(extra.pairCount) + ' 个提交按 git 的配对自动吸收进目标提交，然后重放一遍'
    if (plan.op === 'rebase-merges') what = '把 ' + base + ' 之后的提交连同 ' + String(extra.mergeCount) + ' 个合并提交的结构一起重放一遍（--rebase-merges）'
    const wont: string = '不会碰其他分支（这版面板不做 --update-refs），不会丢提交（旧 HEAD 留在 reflog 里），也不会替你解决冲突'
    const reversible: string = '可回退：旧提交都还在；中途失败或冲突时到冲突向导点中止就回到操作前，执行完也可以从 reflog 找回旧 HEAD'
    const verb: string = plan.op === 'rebase-onto' ? '开始换基座' : (plan.op === 'rebase-merges' ? '带合并结构变基' : '开始变基')
    return { what: what, wont: wont, reversible: reversible, verb: verb }
  }
  /** 按动作造计划：先把形状校验过，再读现场解析基座，把确切提交号写进计划（票据绑定到具体提交）。 */
  async function planFor(op: string, payload: any, cwd: string): Promise<any> {
    const base: any = payload.base
    const rows: any = payload.rows
    const oldBase: any = payload.oldBase
    const newBase: any = payload.newBase
    if (op === 'rebase-todo' || op === 'rebase-autosquash' || op === 'rebase-merges') {
      const bad: any = rebaseTargetProblem(base)
      if (bad) return { fail: argsFail(bad, '变基基座的形状不对：只接受分支名、标签名或完整提交号', { target: base }) }
    }
    if (op === 'rebase-onto') {
      const b1: any = rebaseTargetProblem(oldBase)
      if (b1) return { fail: argsFail(b1, '旧基座的形状不对：只接受分支名、标签名或完整提交号', { target: oldBase }) }
      const b2: any = rebaseTargetProblem(newBase)
      if (b2) return { fail: argsFail(b2, '新基座的形状不对：只接受分支名、标签名或完整提交号', { target: newBase }) }
    }
    if (op === 'rebase-todo') {
      const rowsBad: any = rebaseRowsProblem(rows, null)
      if (rowsBad) return { fail: argsFail(rowsBad, '待办清单的形状不对：每一行要有提交号与 pick/reword/squash/fixup/drop 之一', { rowsProblem: rowsBad }) }
      const msgBad: any = rebaseMessageProblemOf(rows)
      if (msgBad) return { fail: argsFail(msgBad, msgBad === 'message-too-long' ? '改说明的正文太长了（最多 5000 字）' : '有要改说明的提交没填新说明', {}) }
    }
    const plan0: any = rebasePlanOf({ op: op, base: op === 'rebase-onto' ? null : base, rows: op === 'rebase-todo' ? rows : null, oldBase: op === 'rebase-onto' ? oldBase : null, newBase: op === 'rebase-onto' ? newBase : null, merges: op === 'rebase-merges', autosquash: op === 'rebase-autosquash' })
    const m0: any = await scene.measure(cwd, plan0)
    if (!m0 || m0.ok !== true) return { fail: m0 ? m0.envelope : failAt('env', 'env', '读不到仓库现场') }
    if (m0.updateRefs === true) return { fail: blocked(op, 'update-refs-on', '这个仓库开着 rebase.updateRefs：变基时 git 会自动搬动其他分支的指针，面板不提供这种做法。请到侧栏终端先把它关掉（git config --local rebase.updateRefs false）再回来', { setting: 'rebase.updateRefs' }) }
    if (m0.state !== null) return { fail: blocked(op, 'operation-in-progress', '仓库正在 ' + String(m0.state) + ' 中，先把当前操作处理完再变基（冲突向导里可以继续、跳过或中止）', { state: m0.state }) }
    if (op === 'rebase-todo') {
      const winBad: any = rebaseRowsProblem(rows, m0.windowOids)
      if (winBad) return { fail: blocked(op, winBad === 'todo-mismatch' ? 'todo-mismatch' : 'bad-todo', '待办清单与这个基座到 HEAD 的提交对不上（窗口在确认后又变了）。请刷新后重新排一次', { windowCount: (m0.windowOids || []).length }) }
    }
    if (op === 'rebase-onto' && String(m0.oldBaseOid) === String(m0.newBaseOid)) return { fail: blocked(op, 'nothing-to-do', '新旧基座指向同一个提交，没有需要搬走的范围', {}) }
    const extra: any = {}
    if (op === 'rebase-onto') {
      const range: any = await scene.ontoRangeOf(cwd, oldBase, newBase)
      if (!range || range.ok !== true) return { fail: range ? range.envelope : failAt('env', 'env', '读不到换基座的范围') }
      if (range.movedCount === 0) return { fail: blocked(op, 'nothing-to-do', '旧基座之后没有可搬走的提交（HEAD 就停在旧基座附近）', {}) }
      extra.movedCount = range.movedCount
      extra.incomingCount = range.incomingCount
    }
    if (op === 'rebase-autosquash') {
      const pairs: any = await scene.autosquashPairsOf(cwd, base)
      if (!pairs || pairs.ok !== true) return { fail: pairs ? pairs.envelope : failAt('env', 'env', '读不到自动吸收清单') }
      if (pairs.pairs.length === 0) return { fail: blocked(op, 'nothing-to-do', '这个基座之后没有带 fixup!/squash! 标记的提交，没有可自动吸收的对象', {}) }
      extra.pairCount = pairs.pairs.length
      extra.pairs = pairs.pairs
    }
    if (op === 'rebase-merges') {
      const cost: any = await scene.mergesCostOf(cwd, base)
      if (!cost || cost.ok !== true) return { fail: cost ? cost.envelope : failAt('env', 'env', '读不到保留合并结构的代价') }
      extra.mergeCount = cost.count
      extra.mergeCommits = cost.mergeCommits
    }
    const plan: any = rebasePlanOf({
      op: op,
      base: op === 'rebase-onto' ? null : base,
      baseOid: m0.baseOid,
      branch: m0.branch,
      rows: op === 'rebase-todo' ? rows : null,
      oldBase: op === 'rebase-onto' ? oldBase : null,
      oldBaseOid: m0.oldBaseOid,
      newBase: op === 'rebase-onto' ? newBase : null,
      newBaseOid: m0.newBaseOid,
      merges: op === 'rebase-merges',
      autosquash: op === 'rebase-autosquash',
    })
    if (op === 'rebase-todo') extra.windowCount = (m0.windowOids || []).length
    return { plan: plan, scene: m0.scene, extra: extra }
  }

  /** 只读电话：页面打开时先读状态/窗口/范围/吸收对/代价，不签票。 */
  async function handleRebaseRead(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op || '')
    const meta: any = rebaseOpMetaOf(op)
    if (!meta || meta.kind !== 'read') return argsFail('bad-target', '不认识这个只读动作：' + op, { op: op })
    const cwd: string = String(a.cwd || '')
    if (cwd === '') return argsFail('bad-target', '缺少仓库目录')
    const payload: any = a.payload && typeof a.payload === 'object' ? a.payload : a
    // 只读回包也要带 ok:true：界面与门禁靠它区分「读到了」与「拒绝/失败」，缺了会被当成失败。
    const body: any = { ok: true, contract: REBASE_CHECK_CONTRACT, version: REBASE_CHECK_VERSION, op: op }
    if (op === 'rebase-state') {
      const s: any = await scene.sceneOf(cwd)
      if (!s || s.ok !== true) return s && s.envelope ? s.envelope : failAt('env', 'env', '读不到仓库状态')
      return Object.assign(body, { state: s.state, branch: s.branch, headOid: s.headOid, repoRoot: s.repoRoot, updateRefs: s.updateRefs, gitVersion: s.gitVersion, canRebase: s.state === null && s.updateRefs !== true, readAtMs: nowFn() })
    }
    if (op === 'rebase-window') {
      const r: any = await scene.windowOf(cwd, payload.base)
      if (!r || r.ok !== true) return r && r.envelope ? r.envelope : failAt('env', 'env', '读不到待办窗口')
      return Object.assign(body, { base: r.base, baseOid: r.baseOid, headOid: r.headOid, commits: r.commits, commitCount: r.commitCount, readAtMs: r.readAtMs })
    }
    if (op === 'rebase-onto-range') {
      const r: any = await scene.ontoRangeOf(cwd, payload.oldBase, payload.newBase)
      if (!r || r.ok !== true) return r && r.envelope ? r.envelope : failAt('env', 'env', '读不到换基座范围')
      return Object.assign(body, { oldBase: r.oldBase, oldBaseOid: r.oldBaseOid, newBase: r.newBase, newBaseOid: r.newBaseOid, moved: r.moved, incoming: r.incoming, movedCount: r.movedCount, incomingCount: r.incomingCount, readAtMs: r.readAtMs })
    }
    if (op === 'rebase-autosquash-pairs') {
      const r: any = await scene.autosquashPairsOf(cwd, payload.base)
      if (!r || r.ok !== true) return r && r.envelope ? r.envelope : failAt('env', 'env', '读不到自动吸收清单')
      return Object.assign(body, { base: r.base, baseOid: r.baseOid, pairs: r.pairs, pairCount: r.pairs.length, readAtMs: r.readAtMs })
    }
    const r: any = await scene.mergesCostOf(cwd, payload.base)
    if (!r || r.ok !== true) return r && r.envelope ? r.envelope : failAt('env', 'env', '读不到保留合并结构的代价')
    return Object.assign(body, { base: r.base, baseOid: r.baseOid, mergeCommits: r.mergeCommits, count: r.count, gitVersion: r.gitVersion, readAtMs: r.readAtMs })
  }

  /** 预检电话：只读动作转给 handleRebaseRead，写动作走完整校验后签票。 */
  async function handleRebaseCheck(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op || '')
    const meta: any = rebaseOpMetaOf(op)
    if (!meta) return argsFail('bad-target', '不认识这个动作：' + op, { op: op })
    if (meta.kind === 'read') return handleRebaseRead(a)
    const cwd: string = String(a.cwd || '')
    if (cwd === '') return argsFail('bad-target', '缺少仓库目录')
    const payload: any = a.payload && typeof a.payload === 'object' ? a.payload : a
    const made: any = await planFor(op, payload, cwd)
    if (made.fail) return made.fail
    const confirm: any = confirmOf(made.plan, made.scene, made.extra || {})
    const ticket: any = sign(made.plan, made.scene, confirm)
    return {
      ok: true,
      contract: REBASE_CHECK_CONTRACT,
      version: REBASE_CHECK_VERSION,
      op: op,
      decision: { verdict: 'allow', reasons: ['ok'] },
      reasons: ['ok'],
      confirmRequired: true,
      confirm: confirm,
      ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      plan: made.plan,
      scene: sceneSummaryOf(made.scene),
      extra: made.extra || {},
      readAtMs: nowFn(),
    }
  }

  return { handleRebaseCheck: handleRebaseCheck, handleRebaseRead: handleRebaseRead, tickets: tickets, results: results, measure: scene.measure }
}

export const REBASE_CHECK_SOURCE = 'src/host/versionControlRebaseCheck.ts'

