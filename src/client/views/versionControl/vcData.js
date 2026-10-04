// views/versionControl/vcData.js — 版本管理页签的数据层：三条只读电话 + 各自的三态（#818）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。本文件不画界面：把「该给界面一份什么读数」算清楚。
//
// 三条电话（宿主侧已落地，回包是仓库既有的扁平信封，见 src/host/versionControl.js）：
//   wf.gitStatus { cwd }            → { ok:true, screen, tier, gitVersion, readAtMs } | { ok:false, error:{kind,message} }
//   wf.gitDiff   { cwd,path,untracked } → { ok:true, path, lines, truncated, reason }   | 失败信封同上
//   wf.gitLog    { cwd,count,skip }  → { ok:true, commits, skip, requested, returned, hasMore } | 失败信封同上
//
// 三态与「有没有旧数据」怎么落（规格写死的那几条）：
//   ① 首屏三块来自同一次读取，成败一起：wf.gitStatus 成功才有 screen，失败就整页一句话。
//      不做「每块各自降级」——它们真出问题时是一起倒的。
//   ② 面板刚打开那一下是 idle（还没读数）：界面据此整块不画。
//   ③ 已经有旧数据时再读失败：旧数据留着继续画，只在上面加一条「刷新失败了」的提示。
//   ④ 差异与提交历史是按需的独立读取，各自三态（读取中 / 有数据 / 读不到加一个重试），
//      而且各自记「有没有旧数据」——失败绝不清空上一次读到的东西。
//   ⑤ 回包形状不对（ok:true 却没有该有的字段）一律按失败处理并如实标成 shape：不拿半份数据冒充成功。
//
// 日志点（AGENTS.md 的「跨进程或模块边界」那条；事件名沿用既有的 host.call / host.call.fail，
//   不新增事件、附录不动）：每一次打电话成功落一行 host.call、失败落一行 host.call.fail，
//   字段只记 method / latencyMs / ok / kind 与错误的散列（错误原文只截断后散列，绝不记全文）。
/** 三条电话的真实名字（调用点与门禁都读这一份）。 */
export const VC_PHONES = { status: 'wf.gitStatus', diff: 'wf.gitDiff', log: 'wf.gitLog' }
/** 续读历史一批要几条（与宿主首屏那一批同口径 50）。 */
export const VC_LOG_BATCH = 50
/**
 * 这个工作区能不能读（空 cwd 一律不读）。
 * 为什么必须有这一条：宿主那边 cwdOf 对空串会退回它自己的默认目录 —— 也就是说面板会把
 * 「插件自己那个仓库」的数据画出来给用户看。宁可画一句「这个会话还没有工作区」，也不发这一枪。
 */
export const vcShouldRead = function (cwd) { return String(cwd === null || cwd === undefined ? '' : cwd).trim() !== '' }
/** 一份全新的读数（面板刚打开、还没打过任何电话的样子）。 */
export const vcNewReads = function () {
  return {
    screen: { state: 'idle', data: null, error: null },
    diffs: {},
    // 「这笔提交改了什么」那一路（规格故事 32）：文件清单一份，清单里每个文件的补丁各一份。
    //   补丁按「修订号 + 路径」两个一起当键 —— 同一个文件在不同提交里的补丁是两回事，不能互相顶替。
    commit: { rev: '', state: 'idle', files: [], truncated: false, reason: '', error: null },
    commitDiffs: {},
    log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null },
  }
}
/** 某个文件在某笔提交里的补丁在 commitDiffs 里的键。 */
export const vcCommitKeyOf = function (rev, path) { return String(rev || '') + '\u0000' + String(path || '') }
/** 落一行电话日志；日志设施缺席时静默跳过，绝不影响已经要回给界面的读数。 */
const vcOkLog = function (method, kind, t0) {
  try { log('info', 'host.call', { method: method, latencyMs: Date.now() - t0, ok: true, kind: kind }) } catch (e) { /* 日志坏了不影响读数 */ }
}
const vcFailLog = function (method, kind, t0, fail) {
  try { log('warn', 'host.call.fail', { method: method, kind: kind, errorHash: dswsLogHash(dswsLogTrunc(String((fail && fail.kind) || '') + ' ' + String((fail && fail.message) || ''), 120, 'error')) }) } catch (e) { /* 日志坏了不影响读数 */ }
}
/** 把一份回包归一成「失败」：带 error 的信封按信封走，其余（包括 ok:true 却缺字段）一律记 shape。 */
export const vcFailureOf = function (reply) {
  if (reply && reply.ok === false) {
    const e = reply.error || {}
    return { kind: String(e.kind || 'unknown'), message: String(e.message || '') }
  }
  return { kind: 'shape', message: '' }
}
/**
 * 首屏回包里的 screen 形状对不对（按契约逐字段核）。
 * 为什么不能只判真假值：字符串、数组、数字、空对象都是真值 —— 放过去以后界面会把它画成
 *   「工作树空、没有分支、已暂存 0 / 未暂存 0、没有未提交的改动」，也就是把「读不到」说成
 *   「这个仓库很干净」。三条硬承诺的第一条就是「拿不到的东西绝不装作没有」，所以任何一项
 *   不对都按 shape 失败处理（走「读不到 + 重试」那一支）。
 */
export const vcScreenShapeOk = function (s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  const id = s.identity
  if (!id || typeof id !== 'object' || Array.isArray(id)) return false
  if (typeof id.worktreePath !== 'string' || typeof id.sync !== 'string' || typeof id.detached !== 'boolean') return false
  if (typeof id.ahead !== 'number' || typeof id.behind !== 'number') return false
  if (!(id.branch === null || typeof id.branch === 'string')) return false
  if (!(id.basisMs === null || typeof id.basisMs === 'number')) return false
  for (const k of ['staged', 'unstaged', 'otherWorktrees', 'branches', 'commits']) { if (!Array.isArray(s[k])) return false }
  for (const k of ['stagedCount', 'unstagedCount', 'conflictCount']) { if (typeof s[k] !== 'number' || !isFinite(s[k])) return false }
  if (!s.repo || typeof s.repo !== 'object' || Array.isArray(s.repo)) return false
  return true
}
/** 首屏读数：成功一份 screen，失败保留旧数据。 */
export const vcReadStatus = function (reads, call, cwd) {
  const base = reads || vcNewReads()
  const prev = base.screen || { state: 'idle', data: null, error: null }
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PHONES.status, { cwd: String(cwd || '') }) })
    .then(function (reply) {
      if (reply && reply.ok === true && vcScreenShapeOk(reply.screen)) {
        vcOkLog(VC_PHONES.status, 'git-status', t0)
        return Object.assign({}, base, {
          screen: { state: 'ok', data: { screen: reply.screen, tier: String(reply.tier || ''), gitVersion: String(reply.gitVersion || ''), readAtMs: Number(reply.readAtMs) || Date.now() }, error: null },
        })
      }
      const fail = vcFailureOf(reply)
      vcFailLog(VC_PHONES.status, 'git-status', t0, fail)
      return Object.assign({}, base, { screen: { state: 'err', data: prev.data, error: fail } })
    })
    .catch(function (e) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcFailLog(VC_PHONES.status, 'git-status', t0, fail)
      return Object.assign({}, base, { screen: { state: 'err', data: prev.data, error: fail } })
    })
}
/** 一处文件的差异（按需）：三态各自独立，失败保留上一次读到的那份。 */
export const vcReadDiff = function (reads, call, cwd, path, untracked) {
  const base = reads || vcNewReads()
  const key = String(path || '')
  const diffs = Object.assign({}, base.diffs || {})
  const prev = diffs[key] || { state: 'idle', lines: null, reason: '', truncated: false, error: null }
  diffs[key] = { state: 'loading', lines: prev.lines, reason: prev.reason, truncated: prev.truncated === true, error: prev.error }
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PHONES.diff, { cwd: String(cwd || ''), path: key, untracked: untracked === true }) })
    .then(function (reply) {
      if (reply && reply.ok === true && Array.isArray(reply.lines)) {
        vcOkLog(VC_PHONES.diff, 'git-diff', t0)
        diffs[key] = { state: 'ok', lines: reply.lines, reason: String(reply.reason || 'ok'), truncated: reply.truncated === true, error: null }
        return Object.assign({}, base, { diffs: diffs })
      }
      const fail = vcFailureOf(reply)
      vcFailLog(VC_PHONES.diff, 'git-diff', t0, fail)
      diffs[key] = { state: 'err', lines: prev.lines, reason: prev.reason, truncated: prev.truncated === true, error: fail }
      return Object.assign({}, base, { diffs: diffs })
    })
    .catch(function (e) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcFailLog(VC_PHONES.diff, 'git-diff', t0, fail)
      diffs[key] = { state: 'err', lines: prev.lines, reason: prev.reason, truncated: prev.truncated === true, error: fail }
      return Object.assign({}, base, { diffs: diffs })
    })
}
/**
 * 一笔提交改了哪些文件（按需）：wf.gitDiff 带 rev 时回的是文件清单，与单文件差异是两个形状。
 * 每一笔请求带一个递增代际号 seq：快速连点两笔提交时，晚到的旧回包不许把界面钉在旧的那一笔上
 *   （仓库里对这类竞态有现成先例：#66/#67 的 stale drop）。写回前用 vcApplyCommitReply 判一次。
 */
export const vcReadCommitFiles = function (reads, call, cwd, rev) {
  const base = reads || vcNewReads()
  const key = String(rev || '')
  const prev = base.commit || { rev: '', seq: 0, state: 'idle', files: [], truncated: false, reason: '', error: null }
  const same = prev.rev === key
  const seq = (Number(prev.seq) || 0) + 1
  const roll = { rev: key, seq: seq, state: 'loading', files: same ? prev.files : [], truncated: same ? prev.truncated === true : false, reason: same ? prev.reason : '', error: same ? prev.error : null }
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PHONES.diff, { cwd: String(cwd || ''), rev: key }) })
    .then(function (reply) {
      if (reply && reply.ok === true && Array.isArray(reply.files)) {
        vcOkLog(VC_PHONES.diff, 'git-diff', t0)
        roll.state = 'ok'
        roll.files = reply.files
        roll.truncated = reply.truncated === true
        roll.reason = String(reply.reason || 'ok')
        roll.error = null
        return Object.assign({}, base, { commit: roll })
      }
      const fail = vcFailureOf(reply)
      vcFailLog(VC_PHONES.diff, 'git-diff', t0, fail)
      roll.state = 'err'
      roll.error = fail
      return Object.assign({}, base, { commit: roll })
    })
    .catch(function (e) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcFailLog(VC_PHONES.diff, 'git-diff', t0, fail)
      roll.state = 'err'
      roll.error = fail
      return Object.assign({}, base, { commit: roll })
    })
}
/**
 * 落库前的 stale drop：晚到的旧回包（代际号更小）不许覆盖新回包。
 * 判据就是两边的 seq —— 谁新听谁；当前这一份已经是更新的就原样还回去（与 #66/#67 同一形状）。
 */
export const vcApplyCommitReply = function (currentReads, nextReads) {
  const cur = currentReads && currentReads.commit
  const nxt = nextReads && nextReads.commit
  if (!nxt) return currentReads
  // 判据只看代际号：当前这一份是更新的（seq 更大）就不许被晚到的旧回包顶回去。
  //   比 rev 是不行的 —— 竞态里当前那一份往往是「另一笔提交的 loading」，rev 本来就不一样。
  if (cur && (Number(cur.seq) || 0) > (Number(nxt.seq) || 0)) return currentReads
  return nextReads
}
/**
 * cwd 一变就整体复位（#819 发现 2）：读数、展开状态、点开的那笔提交全清。
 * 为什么必须有这一条：Dock 在同会话里换工作区**不重挂载**组件，带着旧读数与旧 ui 进新工作区，
 *   用户就会在新工作区的身份行下面看到上一个工作树的提交清单 —— 正是他最怕的认错工作树。
 * 返回 { changed, reads, ui }：changed 为假时原样还回去（同工作区刷新失败时旧数据照常留着）。
 */
export const vcFreshOnCwd = function (lastCwd, cwd, reads, ui) {
  if (String(lastCwd) === String(cwd)) return { changed: false, reads: reads, ui: ui }
  return { changed: true, reads: vcNewReads(), ui: { fileShown: {}, openDiff: '', openCommit: '' } }
}
/** 把「正在读更早的提交」这一刻先写进读数：界面那一句提示才有机会出现，防重入的守卫也才真的有效。 */
export const vcMarkLogLoading = function (reads) {
  const base = reads || vcNewReads()
  const prev = base.log || { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null }
  return Object.assign({}, base, { log: { state: 'loading', commits: prev.commits || [], hasMore: prev.hasMore === true, fetched: prev.fetched || 0, error: prev.error } })
}
/** 一笔提交里某个文件改了什么（按需）：与未提交那一层同一个回包形状，各存各的键。 */
export const vcReadCommitFileDiff = function (reads, call, cwd, rev, path) {
  const base = reads || vcNewReads()
  const key = vcCommitKeyOf(rev, path)
  const map = Object.assign({}, base.commitDiffs || {})
  const prev = map[key] || { state: 'idle', lines: null, reason: '', truncated: false, error: null }
  map[key] = { state: 'loading', lines: prev.lines, reason: prev.reason, truncated: prev.truncated === true, error: prev.error }
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PHONES.diff, { cwd: String(cwd || ''), rev: String(rev || ''), path: String(path || '') }) })
    .then(function (reply) {
      if (reply && reply.ok === true && Array.isArray(reply.lines)) {
        vcOkLog(VC_PHONES.diff, 'git-diff', t0)
        map[key] = { state: 'ok', lines: reply.lines, reason: String(reply.reason || 'ok'), truncated: reply.truncated === true, error: null }
        return Object.assign({}, base, { commitDiffs: map })
      }
      const fail = vcFailureOf(reply)
      vcFailLog(VC_PHONES.diff, 'git-diff', t0, fail)
      map[key] = { state: 'err', lines: prev.lines, reason: prev.reason, truncated: prev.truncated === true, error: fail }
      return Object.assign({}, base, { commitDiffs: map })
    })
    .catch(function (e) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcFailLog(VC_PHONES.diff, 'git-diff', t0, fail)
      map[key] = { state: 'err', lines: prev.lines, reason: prev.reason, truncated: prev.truncated === true, error: fail }
      return Object.assign({}, base, { commitDiffs: map })
    })
}
/** 下一批要从第几条开始取（首屏那批 + 已经续读回来的那几批）。 */
export const vcNextSkipOf = function (screen, logRead) {
  const first = (screen && Array.isArray(screen.commits)) ? screen.commits.length : 0
  const fetched = (logRead && Number(logRead.fetched)) || 0
  return first + fetched
}
/** 更早的提交（按需，分批）：失败保留已经读回来的那些，不清空。 */
export const vcReadMoreCommits = function (reads, call, cwd, skip) {
  const base = reads || vcNewReads()
  const prev = base.log || { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null }
  const logRoll = { state: 'loading', commits: prev.commits || [], hasMore: prev.hasMore === true, fetched: prev.fetched || 0, error: prev.error }
  const t0 = Date.now()
  return Promise.resolve()
    .then(function () { return call(VC_PHONES.log, { cwd: String(cwd || ''), count: VC_LOG_BATCH, skip: Math.max(0, Math.floor(Number(skip) || 0)) }) })
    .then(function (reply) {
      if (reply && reply.ok === true && Array.isArray(reply.commits)) {
        vcOkLog(VC_PHONES.log, 'git-log', t0)
        logRoll.state = 'ok'
        logRoll.commits = (prev.commits || []).concat(reply.commits)
        logRoll.fetched = (prev.fetched || 0) + reply.commits.length
        logRoll.hasMore = reply.hasMore === true
        logRoll.error = null
        return Object.assign({}, base, { log: logRoll })
      }
      const fail = vcFailureOf(reply)
      vcFailLog(VC_PHONES.log, 'git-log', t0, fail)
      logRoll.state = 'err'
      logRoll.error = fail
      return Object.assign({}, base, { log: logRoll })
    })
    .catch(function (e) {
      const fail = { kind: 'throw', message: String((e && e.message) || e) }
      vcFailLog(VC_PHONES.log, 'git-log', t0, fail)
      logRoll.state = 'err'
      logRoll.error = fail
      return Object.assign({}, base, { log: logRoll })
    })
}
