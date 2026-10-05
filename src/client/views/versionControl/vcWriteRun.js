// views/versionControl/vcWriteRun.js —— 写操作的执行层（#842）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回 src/client/index.js 的 leaf 标记处（一源两物）。
//
// 职责只有四件：发预检拿票、发那一条写电话、把回包翻成「结果一句话 + 还能不能重试」、成功后重读。
//   · 一条只读电话都不在这里发（重读走 vcData.js 的既有读法），更不排任何定时器；
//   · 票据与 requestId 都由这一层带着走，界面只拿模型；
//   · 提交不幂等：HEAD 变了就说「HEAD 已经变了」并不给重试（设计 §3 / 风险 5）。
export const VC_WRITE_PHONES = {
  check: 'wf.gitWriteCheck',
  stage: 'wf.gitStage',
  unstage: 'wf.gitUnstage',
  commit: 'wf.gitCommit',
  pull: 'wf.gitPull',
  push: 'wf.gitPush',
}

/** 预检（提交 / 拉取 / 推送三档；暂存与撤回暂存没有预检 —— 都可逆、天然幂等）。 */
export const vcRunCheck = function (call, cwd, op, extra) {
  const args = Object.assign({ cwd: String(cwd || ''), op: String(op || '') }, extra || {})
  return call(VC_WRITE_PHONES.check, args)
}

/** 一条写电话。payload：stage / unstage 用 paths；commit 用 message；后三条都要 ticketId 与 requestId。 */
export const vcRunWrite = function (call, cwd, op, payload) {
  const p = payload || {}
  const o = String(op || '')
  if (o === 'stage') return call(VC_WRITE_PHONES.stage, { cwd: String(cwd || ''), paths: Array.isArray(p.paths) ? p.paths.slice() : [] })
  if (o === 'unstage') return call(VC_WRITE_PHONES.unstage, { cwd: String(cwd || ''), paths: Array.isArray(p.paths) ? p.paths.slice() : [] })
  const args = { cwd: String(cwd || ''), ticketId: String(p.ticketId || ''), requestId: String(p.requestId || '') }
  if (o === 'commit') args.message = String(p.message || '')
  return call(VC_WRITE_PHONES[o] || VC_WRITE_PHONES.commit, args)
}

/** 一次请求的 requestId（宿主只要求 [A-Za-z0-9_-] 且不超过 64）。 */
export const vcRequestIdOf = function (nowMs, salt) {
  return 'w' + Number(nowMs || 0).toString(36) + String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
}

/** 回包 → 结果模型：{ state, key, params, verb, tipKey, tip, retryable, moved }。
 *  plan 是**预检回包那一份**（可选）：推送成功的措辞按 plan.mode 分档 —— 执行回包的 mode 对 recreate 档
 *  仍回 existing-upstream（宿主不改），只有预检才知道这次是「第一次推送」还是「重建上游」。 */
export const vcOpResultOf = function (op, reply, plan) {
  const r = reply || {}
  const o = String(op || '')
  if (r.ok === true) {
    if (o === 'stage') return { state: 'done', key: 'vc.op.doneStage', params: { n: String((r.staged || []).length) }, verb: 'vc.op.done', tipKey: '', tip: '', retryable: false, moved: false }
    if (o === 'unstage') return { state: 'done', key: 'vc.op.doneUnstage', params: { n: String((r.unstaged || []).length) }, verb: 'vc.op.done', tipKey: '', tip: '', retryable: false, moved: false }
    // 提交成功不再把 headAfter（一个 oid）当悬停文字：那是内部标识符，历史那一块重读之后自然看得见。
    if (o === 'commit') return { state: 'done', key: 'vc.op.doneCommit', params: {}, verb: 'vc.op.done', tipKey: '', tip: '', retryable: false, moved: false }
    // 拉取成功把宿主回包的 mode（fast-forward / up-to-date / unknown）翻成词条，不原样显示内部标识符。
    if (o === 'pull') {
      const mode = String(r.mode || '')
      const tipKey = mode === 'fast-forward' ? 'vc.op.modeFastForward' : (mode === 'up-to-date' ? 'vc.op.modeUpToDate' : '')
      return { state: 'done', key: 'vc.op.donePull', params: {}, verb: 'vc.op.done', tipKey: tipKey, tip: '', retryable: false, moved: false }
    }
    // 推送成功按**预检 plan.mode** 分三档说：existing 说「推送完成」、set-upstream 说「第一次推送、已设为上游」、
    //   recreate 说「已重建上游」。执行回包的 mode 只有 existing-upstream / set-upstream 两种（recreate 档仍回前者），
    //   所以措辞不能看执行回包。
    const pm = String((plan && plan.mode) || '')
    const remote = String((plan && plan.remote) || r.remote || '')
    const target = String((plan && plan.branch) || r.branch || '')
    const local = String((plan && plan.localBranch) || r.local || '')
    if (pm === 'recreate') return { state: 'done', key: 'vc.op.donePushRecreate', params: { local: local, remote: remote, target: target }, verb: 'vc.op.done', tipKey: '', tip: '', retryable: false, moved: false }
    if (pm === 'set-upstream') return { state: 'done', key: 'vc.op.donePushSetUpstream', params: {}, verb: 'vc.op.done', tipKey: '', tip: '', retryable: false, moved: false }
    return { state: 'done', key: 'vc.op.donePush', params: {}, verb: 'vc.op.done', tipKey: '', tip: remote + '/' + target, retryable: false, moved: false }
  }
  const err = r.error || {}
  const reason = String(err.reason || '')
  // 提交不幂等：HEAD 变了（或读不到 HEAD）都只能如实说「结果不确定」——绝不写「没做成」。
  //   宿主 hint 的语义就是「可能这次提交成功了 / 结果未知」，主句与动作词都照它说（对抗式审查 4.1）。
  const moved = o === 'commit' && (reason === 'head-moved' || reason === 'head-unreadable' || (!!r.headBefore && !!r.headAfter && String(r.headBefore) !== String(r.headAfter)))
  // 推送被拒（non-fast-forward）与拉取不能快进是两回事：推送这一档本地还没有远端那些提交，话术要先让人 fetch/pull。
  const pushNff = o === 'push' && reason === 'non-fast-forward'
  const key = moved ? 'vc.writeErr.moved' : (pushNff ? 'vc.writeErr.notFastForwardPush' : vcWriteErrKeyOf(err))
  return {
    state: 'failed',
    key: key,
    params: {},
    // 失败才有一句「面板不替你做什么」；成功那几档没有 limit 键，界面据此不画。
    limitKey: key + '.limit',
    verb: moved ? 'vc.op.unknown' : 'vc.op.failed',
    tipKey: '',
    tip: String(err.hint || err.message || ''),
    // 结果不确定时不给重试按钮：提交不幂等，鼓励再点一次是最坏的建议。
    retryable: !moved,
    moved: moved,
  }
}

/**
 * 成功之后重读：首屏一定重读（暂存/撤回暂存/提交/拉取/推送都会改变首屏读数）；
 * 提交再读一次历史第一页（设计 §3：跳到第一页，不是接着往后翻）。
 */
export const vcAfterWrite = function (reads, call, cwd, op) {
  return vcReadStatus(reads, call, cwd).then(function (next) {
    if (String(op || '') !== 'commit') return next
    const freshLog = Object.assign({}, next, { log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } })
    return vcReadMoreCommits(freshLog, call, cwd, 0)
  })
}
