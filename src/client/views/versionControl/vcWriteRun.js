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
  commit: 'wf.gitCommit',
  pull: 'wf.gitPull',
  push: 'wf.gitPush',
}

/** 预检（提交 / 拉取 / 推送三档；暂存没有预检 —— 它可逆、天然幂等）。 */
export const vcRunCheck = function (call, cwd, op, extra) {
  const args = Object.assign({ cwd: String(cwd || ''), op: String(op || '') }, extra || {})
  return call(VC_WRITE_PHONES.check, args)
}

/** 一条写电话。payload：stage 用 paths；commit 用 message；三条都要 ticketId 与 requestId。 */
export const vcRunWrite = function (call, cwd, op, payload) {
  const p = payload || {}
  const o = String(op || '')
  if (o === 'stage') return call(VC_WRITE_PHONES.stage, { cwd: String(cwd || ''), paths: Array.isArray(p.paths) ? p.paths.slice() : [] })
  const args = { cwd: String(cwd || ''), ticketId: String(p.ticketId || ''), requestId: String(p.requestId || '') }
  if (o === 'commit') args.message = String(p.message || '')
  return call(VC_WRITE_PHONES[o] || VC_WRITE_PHONES.commit, args)
}

/** 一次请求的 requestId（宿主只要求 [A-Za-z0-9_-] 且不超过 64）。 */
export const vcRequestIdOf = function (nowMs, salt) {
  return 'w' + Number(nowMs || 0).toString(36) + String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
}

/** 回包 → 结果模型：{ state, key, params, tip, retryable, moved }。 */
export const vcOpResultOf = function (op, reply) {
  const r = reply || {}
  const o = String(op || '')
  if (r.ok === true) {
    if (o === 'stage') return { state: 'done', key: 'vc.op.doneStage', params: { n: String((r.staged || []).length) }, tip: '', retryable: false, moved: false }
    if (o === 'commit') return { state: 'done', key: 'vc.op.doneCommit', params: {}, tip: String(r.headAfter || ''), retryable: false, moved: false }
    if (o === 'pull') return { state: 'done', key: 'vc.op.donePull', params: {}, tip: String(r.mode || ''), retryable: false, moved: false }
    return { state: 'done', key: 'vc.op.donePush', params: {}, tip: String(r.remote || '') + '/' + String(r.branch || ''), retryable: false, moved: false }
  }
  const err = r.error || {}
  const key = vcWriteErrKeyOf(err)
  // 提交失败：宿主回的 head-moved 是明说；万一没标而 headBefore/headAfter 已经不同，也照同一条口径说。
  const moved = o === 'commit' && (String(err.reason || '') === 'head-moved' || (!!r.headBefore && !!r.headAfter && String(r.headBefore) !== String(r.headAfter)))
  return {
    state: 'failed',
    key: moved ? 'vc.writeErr.notReady' : key,
    params: {},
    tip: String(err.hint || err.message || ''),
    retryable: !moved,
    moved: moved,
  }
}

/**
 * 成功之后重读：首屏一定重读（暂存/提交/拉取/推送都会改变首屏读数）；
 * 提交再读一次历史第一页（设计 §3：跳到第一页，不是接着往后翻）。
 */
export const vcAfterWrite = function (reads, call, cwd, op) {
  return vcReadStatus(reads, call, cwd).then(function (next) {
    if (String(op || '') !== 'commit') return next
    const freshLog = Object.assign({}, next, { log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } })
    return vcReadMoreCommits(freshLog, call, cwd, 0)
  })
}
