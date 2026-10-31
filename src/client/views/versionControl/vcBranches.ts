// views/versionControl/vcBranches.ts —— 分支与标签域 4 的业务面板（#1746 T11，返工后）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包。本文件只画业务面和算读数，
// 不直接发电话：三条电话（读 wf.gitBranches / 预检 wf.gitBranchCheck / 执行 wf.gitBranchWrite）由调用方以 call 传进来，
// 与 vcData.ts、vcFirstScreen.ts 同一先例。
//
// 十三条能力各有一个唯一主入口（能力行 data-cap-primary 仍由壳按能力账本画，本文件不重复画行）：
//   4.1 分支列表、4.2 新建并切换、4.3 切换、4.4 分离头、4.5 重命名、4.6 删除、4.7 上游、
//   4.8 已并入/没并入、4.9 标签列表、4.10 建标签、4.11 删标签、4.12 验签、4.13 分支说明。
// 每个动作按钮带 data-vc-branch-action 与 data-vc-op（能力号），门禁据此逐条对上账本与 argv。
//
// 写动作四段式（规格第 8 节；#1746 返工后按 lead 裁决走 120 秒票据）：
//   ① 预检（wf.gitBranchCheck）：读一次真实现场、判定 allow/warn/block，签票（票 120 秒过期）；
//      block 时回包照样带现场与理由，界面画「为什么不能点」；warn 时回包带确认卡四段素材；
//   ② 确认（界面弹确认卡，默认焦点在取消）；
//   ③ 凭票执行（wf.gitBranchWrite）：只交票号 + requestId + 动作参数，宿主重算现场、绑定表逐格比对，
//      票过期/目标变了/换动作一律零进程拒绝；同一 requestId 重放回同一份结果；
//   ④ 结果贴点：成功贴命令；失败贴 git 原话、环节、期望与实际（照实显示，不假装成功）。
// 4.12 验签是只读动作，走预检电话的 verify 分支，不签票、不进执行电话；verified:false 是「没验过」。
//
// 日志点沿用既有 host.call / host.call.fail 两个事件（不新增事件、附录不动）。
declare function log(level: any, event: any, fields: any): void
declare function dswsLogHash(text: any): string
declare function dswsLogTrunc(text: any, n: any, kind: any): string
declare function vcShellConfirmCardNode(h: any, t: any, o: any): any
declare function vcShellResultNode(h: any, t: any, o: any): any

export const VC_BRANCHES_PHONE = 'wf.gitBranches'
export const VC_BRANCH_CHECK_PHONE = 'wf.gitBranchCheck'
export const VC_BRANCH_WRITE_PHONE = 'wf.gitBranchWrite'
export const VC_BRANCH_BOARD_CONTRACT = 'version-control.branch-board'
export const VC_BRANCH_BOARD_VERSION = 1
export const VC_BRANCH_CHECK_CONTRACT = 'version-control.branch-check'
export const VC_BRANCH_CHECK_VERSION = 1
// 票的有效期不在这里写数字：真源是 config/ttl.yaml 的 ticketTtlMs（共享层 write-ticket 的 TICKET_TTL_MS）；
// 界面要提示「票会过期」时直接看回包里的 expiresAtMs 与 checkedAtMs，不在客户端再抄一份时长。
/** 本域十三条能力号（顺序即规格矩阵 4.1–4.13）。 */
export const VC_BRANCH_OP_IDS: string[] = ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9', '4.10', '4.11', '4.12', '4.13']
/** 九个凭票执行的写动作（kind 与宿主执行叶子的 op 一致；4.12 是只读验签，不在其中）。 */
export const VC_BRANCH_WRITE_OPS: string[] = ['create', 'switch', 'detach', 'rename', 'delete', 'upstream', 'tag-create', 'tag-delete', 'describe']
/** 写动作到宿主 op 与文案键的对应（4.1/4.8/4.9 是读，不在这张表里；4.12 走预检的只读分支）。 */
export const VC_BRANCH_ACTIONS: any[] = [
  { op: '4.2', kind: 'create', label: 'vc.shell.branch2.create', form: true },
  { op: '4.3', kind: 'switch', label: 'vc.shell.branch2.switch' },
  { op: '4.4', kind: 'detach', label: 'vc.shell.branch2.detach', form: true },
  { op: '4.5', kind: 'rename', label: 'vc.shell.branch2.rename', form: true },
  { op: '4.6', kind: 'delete', label: 'vc.shell.branch2.delete' },
  { op: '4.7', kind: 'upstream', label: 'vc.shell.branch2.upstream', form: true },
  { op: '4.10', kind: 'tag-create', label: 'vc.shell.branch2.tagCreate', form: true },
  { op: '4.11', kind: 'tag-delete', label: 'vc.shell.branch2.tagDelete' },
  { op: '4.12', kind: 'verify', label: 'vc.shell.branch2.verify', form: true, checkOnly: true },
  { op: '4.13', kind: 'describe', label: 'vc.shell.branch2.describe', form: true },
]
/** 一份全新的分支面板读数（还没打过电话的样子）：读、预检、执行三块各自留位置。 */
export const vcNewBranchRead = function () { return { state: 'idle', data: null, error: null, check: null, write: null } }
const vcBrOkLog = function (method: any, kind: any, t0: any) {
  try { log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) } catch (e) { /* 日志坏了不影响读数 */ }
}
const vcBrFailLog = function (method: any, kind: any, t0: any, fail: any) {
  try { log('warn', 'host.call.fail', { method: method, kind: kind, errorHash: dswsLogHash(dswsLogTrunc(String((fail && fail.kind) || '') + ' ' + String((fail && fail.message) || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响读数 */ }
}
/** 读回包形状：契约名与版本对、读时刻是有限数、两个清单是数组、descriptions 是对象。形状不对按失败。 */
export const vcBranchShapeOk = function (board: any) {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return false
  if (String(board.contract || '') !== VC_BRANCH_BOARD_CONTRACT) return false
  if (Number(board.version) !== VC_BRANCH_BOARD_VERSION) return false
  if (typeof board.readAtMs !== 'number' || !isFinite(board.readAtMs)) return false
  if (!Array.isArray(board.branches) || !Array.isArray(board.tags)) return false
  if (!board.descriptions || typeof board.descriptions !== 'object' || Array.isArray(board.descriptions)) return false
  return true
}
/** 预检回包形状：契约名与版本对、readAtMs 有限、op 是字符串；成功时必须有票，失败时必须有 error。 */
export const vcBranchCheckShapeOk = function (reply: any) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return false
  if (reply.ok !== true && reply.ok !== false) return false
  if (String(reply.contract || '') !== VC_BRANCH_CHECK_CONTRACT) return false
  if (Number(reply.version) !== VC_BRANCH_CHECK_VERSION) return false
  if (typeof reply.readAtMs !== 'number' || !isFinite(reply.readAtMs)) return false
  if (typeof reply.op !== 'string' || reply.op === '') return false
  if (reply.op === 'verify') return true
  if (reply.ok === true) return !!reply.ticket && typeof reply.ticket === 'object' && typeof reply.ticket.id === 'string' && reply.ticket.id !== ''
  return !!reply.error && typeof reply.error === 'object'
}
/** 读：一次电话取回分支/标签/已并入/说明；失败保留上一次读到的东西与预检/执行读数（失败绝不清空）。 */
export const vcReadBranches = function (reads: any, call: any, cwd: any) {
  const base = reads || {}
  const prev = base.branch || vcNewBranchRead()
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_BRANCHES_PHONE, { cwd: String(cwd || '') }) })
    .then(function (reply: any) {
      if (reply && reply.ok === true && vcBranchShapeOk(reply)) {
        vcBrOkLog(VC_BRANCHES_PHONE, 'git-branches', t0)
        return Object.assign({}, base, { branch: { state: 'ok', data: reply, error: null, check: prev.check || null, write: prev.write || null } })
      }
      const fail = reply && reply.ok === false ? { kind: String((reply.error || {}).kind || 'unknown'), message: String((reply.error || {}).message || '') } : { kind: 'shape', message: '' }
      vcBrFailLog(VC_BRANCHES_PHONE, 'git-branches', t0, fail)
      return Object.assign({}, base, { branch: { state: 'err', data: prev.data, error: fail, check: prev.check || null, write: prev.write || null } })
    })
    .catch(function (e: any) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcBrFailLog(VC_BRANCHES_PHONE, 'git-branches', t0, fail)
      return Object.assign({}, base, { branch: { state: 'err', data: prev.data, error: fail, check: prev.check || null, write: prev.write || null } })
    })
}
/** 读数便捷取值。 */
export const vcBranchReadOf = function (reads: any) { const r = reads || {}; return r.branch || vcNewBranchRead() }
export const vcBranchBoardOf = function (reads: any) { const r = vcBranchReadOf(reads); return vcBranchShapeOk(r.data) ? r.data : null }
export const vcBranchStateOf = function (reads: any) { return String(vcBranchReadOf(reads).state || 'idle') }
export const vcBranchCheckOf = function (reads: any) { return vcBranchReadOf(reads).check || null }
export const vcBranchWriteResultOf = function (reads: any) { return vcBranchReadOf(reads).write || null }
/** 本刻手里那张票：预检成功时给 {id, op, checkedAtMs, expiresAtMs}，否则 null。执行必须带它。 */
export const vcBranchTicketOf = function (reads: any) {
  const c = vcBranchCheckOf(reads)
  const d = c && c.data
  if (!d || d.ok !== true || !d.ticket || typeof d.ticket.id !== 'string' || d.ticket.id === '') return null
  return { id: d.ticket.id, op: String(d.ticket.op || ''), checkedAtMs: Number(d.ticket.checkedAtMs) || 0, expiresAtMs: Number(d.ticket.expiresAtMs) || 0 }
}
/** 预检的判定与理由（block 与 warn 都从这里取；block 时 ok 是 false，data 照样是回包）。 */
export const vcBranchCheckDecisionOf = function (reads: any) {
  const c = vcBranchCheckOf(reads)
  const d = c && c.data
  const decision = (d && d.decision) || null
  if (!decision || typeof decision !== 'object') return null
  return { verdict: String(decision.verdict || ''), reasons: Array.isArray(decision.reasons) ? decision.reasons.map(function (x: any) { return String(x) }) : [] }
}
/** 把某个动作的输入拼成电话参数：op 由能力号决定，表单字段原样带上（空值不带；票号与 confirmed 另由调用方给）。 */
export const vcBranchRequestOf = function (op: any, fields: any) {
  const want = String(op || '')
  const f = fields || {}
  let kind = ''
  for (let i = 0; i < VC_BRANCH_ACTIONS.length; i += 1) if (VC_BRANCH_ACTIONS[i].op === want) kind = VC_BRANCH_ACTIONS[i].kind
  const req: any = { op: kind }
  const keys = ['name', 'to', 'from', 'rev', 'branch', 'upstream', 'text', 'object', 'objectKind', 'mode', 'message', 'target', 'force', 'unset']
  for (let i = 0; i < keys.length; i += 1) if (f[keys[i]] !== undefined) req[keys[i]] = f[keys[i]]
  return req
}
/**
 * 预检：读现场、判定、签票。block 时宿主回失败信封（error.kind='blocked'），但现场与理由照样在顶层，
 * 所以预检读数把回包原样留着，界面既能画「为什么不能点」，也能在 warn 时取确认卡素材。
 */
export const vcBranchCheck = function (reads: any, call: any, cwd: any, op: any, fields: any) {
  const base = reads || {}
  const prev = base.branch || vcNewBranchRead()
  const req = vcBranchRequestOf(op, fields)
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_BRANCH_CHECK_PHONE, Object.assign({ cwd: String(cwd || '') }, req)) })
    .then(function (reply: any) {
      const shapeOk = vcBranchCheckShapeOk(reply)
      const good = shapeOk && reply.ok === true
      if (good) vcBrOkLog(VC_BRANCH_CHECK_PHONE, req.op, t0)
      else vcBrFailLog(VC_BRANCH_CHECK_PHONE, req.op, t0, { kind: shapeOk ? String(((reply || {}).error || {}).kind || 'blocked') : 'shape', message: '' })
      const check = shapeOk
        ? { state: good ? 'ok' : 'err', data: reply, error: good ? null : { kind: String((reply.error || {}).kind || 'blocked'), message: String((reply.error || {}).message || '') } }
        : { state: 'err', data: null, error: { kind: 'shape', message: '预检回包形状不对' } }
      return Object.assign({}, base, { branch: { state: prev.state, data: prev.data, error: prev.error, check: check, write: prev.write || null } })
    })
    .catch(function (e: any) {
      vcBrFailLog(VC_BRANCH_CHECK_PHONE, req.op, t0, { kind: 'throw', message: String((e && e.message) || e) })
      const check = { state: 'err', data: null, error: { kind: 'throw', message: String((e && e.message) || e) } }
      return Object.assign({}, base, { branch: { state: prev.state, data: prev.data, error: prev.error, check: check, write: prev.write || null } })
    })
}
/**
 * 执行：凭预检票执行一次；只带 {ticketId, requestId, op, ...动作参数}。
 * 宿主重算现场并逐格比对绑定表，票过期/目标变/换动作一律零进程拒绝；同一 requestId 重放回同一份结果。
 * 回包原样交给界面，本函数不改写结论（失败原话与环节在顶层）。
 */
export const vcBranchWrite = function (reads: any, call: any, cwd: any, op: any, fields: any) {
  const f = fields || {}
  const req = vcBranchRequestOf(op, f)
  const body: any = { cwd: String(cwd || ''), ticketId: String(f.ticketId || ''), requestId: String(f.requestId || '') }
  const keys = ['name', 'to', 'from', 'rev', 'branch', 'upstream', 'text', 'object', 'objectKind', 'mode', 'message', 'target', 'force', 'unset']
  body.op = req.op
  for (let i = 0; i < keys.length; i += 1) if (f[keys[i]] !== undefined) body[keys[i]] = f[keys[i]]
  if (f.confirmed === true) body.confirmed = true
  const base = reads || {}
  const prev = base.branch || vcNewBranchRead()
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_BRANCH_WRITE_PHONE, body) })
    .then(function (reply: any) {
      if (reply && reply.ok === true) vcBrOkLog(VC_BRANCH_WRITE_PHONE, req.op, t0)
      else vcBrFailLog(VC_BRANCH_WRITE_PHONE, req.op, t0, { kind: String(((reply || {}).error || {}).kind || 'unknown'), message: '' })
      // 失败时把回包原样留着：写失败的 git 原话、环节、期望与实际都在包里，
      //   结果贴点要照原话显示，不能只剩一句「写失败」（上一版就是在这里把细节丢掉的）。
      const write = reply && typeof reply === 'object'
        ? { state: reply.ok === true ? 'ok' : 'err', data: reply, error: reply.ok === true ? null : { kind: 'write', message: '' } }
        : { state: 'err', data: null, error: { kind: 'write', message: '' } }
      return Object.assign({}, base, { branch: { state: prev.state, data: prev.data, error: prev.error, check: prev.check || null, write: write } })
    })
    .catch(function (e: any) {
      vcBrFailLog(VC_BRANCH_WRITE_PHONE, req.op, t0, { kind: 'throw', message: String((e && e.message) || e) })
      return Object.assign({}, base, { branch: { state: prev.state, data: prev.data, error: prev.error, check: prev.check || null, write: { state: 'err', data: null, error: { kind: 'throw', message: String((e && e.message) || e) } } } })
    })
}
/** 预检回包怎么读：'checked'（拿到票）/ 'blocked'（不能做，理由在 reasons）/ 'fail'（读不回现场等）。 */
export const vcBranchCheckKindOf = function (reply: any) {
  if (!reply || typeof reply !== 'object') return 'unknown'
  if (reply.ok === true) return 'checked'
  const kind = String(((reply.error || {}).kind) || '')
  return kind === 'blocked' ? 'blocked' : 'fail'
}
/**
 * 执行回包怎么读：'done' / 'need-confirm'（还需确认）/ 'stale'（票过期、目标变了、换动作，要重新预检）/
 * 'blocked'（其它拒绝）/ 'fail'（git 失败或环境失败）。宿主回传的 reason 是固定理由标识符。
 */
export const vcBranchReplyKindOf = function (reply: any) {
  if (!reply || typeof reply !== 'object') return 'unknown'
  if (reply.reused === true && reply.result) return reply.result.ok === true ? 'done' : 'fail'
  if (reply.ok === true) return 'done'
  const kind = String(((reply.error || {}).kind) || '')
  const reason = String(reply.reason || ((reply.error || {}).reason) || '')
  if (kind === 'need-confirm') return 'need-confirm'
  if (reason === 'ticket-missing' || reason === 'ticket-expired' || reason === 'ticket-op-mismatch' || reason === 'target-changed' || reason === 'stale-repo' || reason === 'stale-index') return 'stale'
  return kind === 'blocked' ? 'blocked' : 'fail'
}
/** 回包里的理由标识符（预检 block 与执行拒绝都给界面拼文案用）。 */
export const vcBranchReasonsOf = function (reply: any) {
  const r = (reply && reply.reasons) || ((reply && reply.decision && reply.decision.reasons) || [])
  return Array.isArray(r) ? r.map(function (x: any) { return String(x) }) : []
}
/** 确认卡素材：warn 的预检回包给 verb/target/kind，界面按四段模板拼（默认焦点在取消）。 */
export const vcBranchConfirmOf = function (reply: any) {
  const c = (reply && (reply.confirm || (reply.decision && reply.decision.confirm))) || null
  if (!c) return null
  return { verb: String(c.verb || ''), target: String(c.target || ''), kind: String(c.kind || '') }
}
/** 结果贴点：写回包归一成壳的结果节点参数。 */
export const vcBranchResultOf = function (reply: any) {
  const kind = vcBranchReplyKindOf(reply)
  if (kind === 'done') {
    const r = reply && reply.reused === true && reply.result ? reply.result : (reply || {})
    return { state: 'ok', cmd: String(r.command || ''), ms: 0, n: 1, next: '' }
  }
  // 宿主失败信封的形状是「error 里只有 kind/message，原话与环节在顶层」（failPhone 把附加字段平铺）。
  //   两种都认：先看顶层，再回落到 error 里，免得真机上结果贴点只剩「写失败」四个字。
  const r = reply || {}
  const e = r.error || {}
  const pick = function (k: any) { return String(r[k] !== undefined && r[k] !== '' ? r[k] : (e[k] !== undefined && e[k] !== '' ? e[k] : '')) }
  // error:true 是页面壳结果节点认「失败」的标记（vcShellResultNode 按它选报警分支）；
  //   state 给本域与门禁读，两个字段说的是同一件事，不各算一套。
  return { state: 'fail', error: true, git: pick('git'), step: pick('step') || String(e.kind || ''), expected: pick('expected'), actual: pick('actual'), cause: pick('cause') || String(e.message || ''), reason: String(r.reason || e.reason || '') }
}

// ———— 业务面板 ————
// 面板只读一份读数（board），按读数画四块：当前分支与列表、标签列表、十个写动作的入口、结果与确认卡。
// 每个动作按钮都带 data-vc-branch-action（宿主 kind）与 data-vc-op（能力号），一行一条、不重复。
export const vcBranchBoardNode = function (h: any, t: any, o: any) {
  const opts = o || {}
  const board = vcBranchShapeOk(opts.board) ? opts.board : null
  const kids: any[] = []
  kids.push(h('h4', { key: 'title', className: 'vcs-branch2-title' }, t('vc.shell.branch2.title')))
  const current = board && board.current ? String(board.current.name || '') : ''
  kids.push(h('p', { key: 'cur', className: 'vcs-branch2-cur', 'data-vc-branch-current': current }, t('vc.shell.branch2.current', { branch: current || t('vc.shell.branch2.unknown') })))
  if (!board) {
    kids.push(h('p', { key: 'none', className: 'vcs-branch2-empty', 'data-vc-branch2-empty': '1' }, t('vc.shell.branch2.empty')))
    if (opts.onRetry) kids.push(h('button', { key: 'retry', type: 'button', className: 'vcs-branch2-retry', 'data-vc-branch2-retry': '1', onClick: opts.onRetry }, t('vc.shell.state.retry')))
  } else {
    const rows: any[] = []
    for (let i = 0; i < board.branches.length; i += 1) {
      const b = board.branches[i] || {}
      const name = String(b.name || '')
      const acts: any[] = []
      const add = function (op: any, kind: any, labelKey: any) { acts.push(h('button', { key: kind, type: 'button', className: 'vcs-branch2-act', 'data-vc-branch-action': kind, 'data-vc-op': op, 'data-vc-branch-name': name }, t(labelKey))) }
      add('4.3', 'switch', 'vc.shell.branch2.switch')
      add('4.4', 'detach', 'vc.shell.branch2.detach')
      add('4.5', 'rename', 'vc.shell.branch2.rename')
      add('4.6', 'delete', 'vc.shell.branch2.delete')
      add('4.7', 'upstream', 'vc.shell.branch2.upstream')
      add('4.13', 'describe', 'vc.shell.branch2.describe')
      const badges: any[] = []
      if (b.current === true) badges.push(h('span', { key: 'cur', className: 'vcs-branch2-badge' }, t('vc.shell.branch2.currentBadge')))
      if (String(b.upstream || '')) badges.push(h('span', { key: 'up', className: 'vcs-branch2-badge', 'data-vc-branch-upstream': String(b.upstream) }, t('vc.shell.branch2.upstreamShort', { upstream: String(b.upstream), ahead: Number(b.ahead) || 0, behind: Number(b.behind) || 0 })))
      if (String((board.descriptions || {})[name] || '')) badges.push(h('span', { key: 'desc', className: 'vcs-branch2-desc' }, String((board.descriptions || {})[name])))
      rows.push(h('li', { key: name, className: 'vcs-branch2-row', 'data-vc-branch-row': name }, [
        h('span', { key: 'name', className: 'vcs-branch2-name' }, name),
        h('span', { key: 'badges', className: 'vcs-branch2-badges' }, badges),
        h('span', { key: 'acts', className: 'vcs-branch2-acts' }, acts),
      ]))
    }
    kids.push(h('div', { key: 'list', className: 'vcs-branch2-list', 'data-vc-branch-list': String(board.branches.length) }, [
      h('p', { key: 'h', className: 'vcs-branch2-h' }, t('vc.shell.branch2.list')),
      rows.length ? h('ul', { key: 'rows', className: 'vcs-branch2-rows' }, rows) : h('p', { key: 'none', className: 'vcs-branch2-empty' }, t('vc.shell.branch2.noBranches')),
    ]))
    // 4.8：已并入 / 没并入两张名单（读 4.1 时一起取回，不另发电话）。
    const merged = Array.isArray(board.merged) ? board.merged : null
    const notMerged = Array.isArray(board.notMerged) ? board.notMerged : null
    if (merged && notMerged) {
      kids.push(h('div', { key: 'merged', className: 'vcs-branch2-merged', 'data-vc-branch-merged': String(merged.length), 'data-vc-branch-notmerged': String(notMerged.length) }, [
        h('p', { key: 'mh', className: 'vcs-branch2-h' }, t('vc.shell.branch2.merged')),
        h('p', { key: 'm', className: 'vcs-branch2-names', 'data-vc-branch-merged-list': merged.join(',') }, merged.join('、') || t('vc.shell.branch2.none')),
        h('p', { key: 'nh', className: 'vcs-branch2-h' }, t('vc.shell.branch2.notMerged')),
        h('p', { key: 'n', className: 'vcs-branch2-names', 'data-vc-branch-notmerged-list': notMerged.join(',') }, notMerged.join('、') || t('vc.shell.branch2.none')),
      ]))
    }
    // 4.9 / 4.10 / 4.11 / 4.12：标签清单与每个标签的动作。
    const tagRows: any[] = []
    for (let i = 0; i < board.tags.length; i += 1) {
      const tag = board.tags[i] || {}
      const name = String(tag.name || '')
      tagRows.push(h('li', { key: name, className: 'vcs-tag-row', 'data-vc-tag-row': name, 'data-vc-tag-annotated': tag.annotated === true ? '1' : '0' }, [
        h('span', { key: 'name', className: 'vcs-tag-name' }, name),
        h('button', { key: 'del', type: 'button', className: 'vcs-tag-act', 'data-vc-tag-action': 'delete', 'data-vc-op': '4.11', 'data-vc-tag-name': name }, t('vc.shell.branch2.tagDelete')),
        h('button', { key: 'ver', type: 'button', className: 'vcs-tag-act', 'data-vc-tag-action': 'verify', 'data-vc-op': '4.12', 'data-vc-tag-name': name }, t('vc.shell.branch2.verify')),
      ]))
    }
    kids.push(h('div', { key: 'tags', className: 'vcs-tag-list', 'data-vc-tag-list': String(board.tags.length) }, [
      h('p', { key: 'h', className: 'vcs-branch2-h' }, t('vc.shell.branch2.tags')),
      tagRows.length ? h('ul', { key: 'rows', className: 'vcs-tag-rows' }, tagRows) : h('p', { key: 'none', className: 'vcs-branch2-empty' }, t('vc.shell.branch2.noTags')),
    ]))
  }
  // 十个写动作的表单入口：一行一条，带 kind 与能力号（新建分支/建标签等需要输入的放输入框）。
  const forms: any[] = []
  for (let i = 0; i < VC_BRANCH_ACTIONS.length; i += 1) {
    const act = VC_BRANCH_ACTIONS[i]
    const row: any[] = [h('span', { key: 'label', className: 'vcs-branch2-label' }, t(act.label))]
    if (act.form) {
      row.push(h('input', { key: 'input', type: 'text', className: 'vcs-branch2-input', 'data-vc-branch-input': act.kind, placeholder: t('vc.shell.branch2.inputHint') }))
    }
    row.push(h('button', { key: 'go', type: 'button', className: 'vcs-branch2-go', 'data-vc-branch-action': act.kind, 'data-vc-op': act.op, 'data-vc-branch-form': act.form ? '1' : '0' }, t('vc.shell.branch2.go')))
    forms.push(h('li', { key: act.op, className: 'vcs-branch2-form', 'data-vc-op-row': act.op }, row))
  }
  kids.push(h('div', { key: 'forms', className: 'vcs-branch2-forms', 'data-vc-branch-forms': String(forms.length) }, [
    h('p', { key: 'h', className: 'vcs-branch2-h' }, t('vc.shell.branch2.actions')),
    h('ul', { key: 'rows', className: 'vcs-branch2-form-rows' }, forms),
  ]))
  if (opts.confirm) kids.push(Object.assign({}, vcShellConfirmCardNode(h, t, opts.confirm), { key: 'confirm' }))
  if (opts.result) kids.push(Object.assign({}, vcShellResultNode(h, t, opts.result), { key: 'result' }))
  return h('section', { className: 'vcs-branch2', 'data-vc-branch2': '1', 'data-vc-branch-ops': String(VC_BRANCH_OP_IDS.length), 'data-vc-branch-writes': String(VC_BRANCH_WRITE_OPS.length), 'data-vc-branch-checks': '1' }, kids)
}

export const VC_BRANCHES_SOURCE = 'src/client/views/versionControl/vcBranches.ts'
