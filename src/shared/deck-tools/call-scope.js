// src/shared/deck-tools/call-scope.js —— 批量调用的执行上下文（#895）
//
// 为什么有这个文件：单次工具调用有墙钟上限（agent 注册那份 AGENT_TOOL_TIMEOUT_MS），
// 而批量活要发几十次远端调用。超限被外层掐死会丢掉全部进度，所以调用自己要会看钟：
//   1. 剩余额度不够就停发新的调用，主动报部分成功（调用方拿游标续跑）；
//   2. 每一次远端调用单独钳制超时并可中止，超支的只坏自己那一项，不炸整包；
//   3. 同一次调用里重复读只发一次（纯读记忆），写操作只废掉被波及的条目；
//   4. 超时与中止的回执永远诚实（生效与否说不清 + 核对指引），不假装成功。
//
// 住共享层：宿主工具文件各自 import 它（host → shared 是允许的方向）。
// 本文件零导入（共享层文件之间不许互引）。后端房间可按需读 ctx.memo（房间 → shared
// 允许），ctx.memo 缺席时一切照旧——面板与旧调用方不受影响。
// 日志：不新增事件名、不记新字段（复用宿主壳既有的 host.call 两行）。

/** 单次执行允许的最长时间（毫秒）：与 agent 注册那份同值；改那边时同步改这里。 */
export const DEFAULT_TOOL_TIMEOUT_MS = 120000
/** 剩余额度到这条线就停发新调用：留给收尾回包与误差（只大不小，方向安全）。 */
export const DEFAULT_TOOL_MARGIN_MS = 10000
/** 单次远端调用默认钳制（毫秒）：与 github 房单条命令默认同值；改那边时同步改这里。 */
export const DEFAULT_PER_OP_TIMEOUT_MS = 30000

function num(v, d) { const n = (typeof v === 'number' && isFinite(v)) ? v : NaN; return isNaN(n) ? d : n }
function repoIdOf(repo) {
  const r = repo || {}
  const id = (typeof r.refId === 'string' && r.refId) ? r.refId : ((typeof r.backend === 'string') ? r.backend : '')
  const ef = (typeof r.effortId === 'string') ? r.effortId : ''
  return id + (ef ? '#' + ef : '')
}
function canon(v) {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}
function isArr(v) { return Array.isArray(v) }

/** 一次调用的记忆：操作结果缓存 + 票关系名册（后端检查者用来做定向刷新）。 */
export function createCallMemo() {
  return { seq: 0, store: new Map(), roster: { complete: false, byKey: new Map() }, dirty: new Set() }
}
function rowKeysOf(rows) {
  const out = []
  const list = isArr(rows) ? rows : []
  for (const r of list) {
    if (r && (typeof r.key === 'string' || typeof r.key === 'number')) out.push(String(r.key))
  }
  return out
}
function blockedKeysOf(issue) {
  const bb = issue && issue.blockedBy
  if (!isArr(bb)) return []
  const out = []
  for (const b of bb) {
    const k = String((b && b.key) || b || '')
    if (k) out.push(k)
  }
  return out
}
function parentOf(issue) {
  const p = issue && issue.parentKey
  return (p === undefined || p === null) ? '' : String(p)
}
/** 列表过滤器是否等价于整仓（只有整仓结果才能重建名册；带筛的只做合并）。 */
export function isFullListFilter(filter) {
  const f = filter || {}
  if (f.parentKey !== undefined && f.parentKey !== null && f.parentKey !== '') return false
  if (Array.isArray(f.keys) && f.keys.length) return false
  if (typeof f.type === 'string' && f.type && f.type !== 'all') return false
  if (typeof f.state === 'string' && f.state && f.state !== 'all') return false
  return true
}
/** 列表成功 → 整仓重建名册，带筛只合并（名册完整性位不动，不拿子集当全集）。 */
export function rosterAdoptList(memo, rows, filter) {
  if (!memo) return []
  if (isFullListFilter(filter)) return rosterFromRows(memo, rows)
  const list = Array.isArray(rows) ? rows : []
  for (const r of list) { if (r) rosterUpsert(memo, r) }
  return rowKeysOf(rows)
}
/** 整仓列表成功 → 重建名册（dirty 清空：这次读是新鲜的，之前写的都含在里面了）。 */
export function rosterFromRows(memo, rows) {
  const byKey = new Map()
  const list = isArr(rows) ? rows : []
  for (const r of list) {
    if (!r) continue
    byKey.set(String(r.key), { blockedBy: blockedKeysOf(r), parentKey: parentOf(r) })
  }
  memo.roster = { complete: true, byKey: byKey }
  memo.dirty = new Set()
  return rowKeysOf(rows)
}
/** 单票读成功 → 合并进名册并洗掉它的脏标记。 */
export function rosterUpsert(memo, issue) {
  if (!issue) return
  const k = String(issue.key)
  memo.roster.byKey.set(k, { blockedBy: blockedKeysOf(issue), parentKey: parentOf(issue) })
  memo.dirty.delete(k)
}
/** 后端内部写操作的可选标记：删名册条目并记脏（操作缓存的裁剪由外层 facade 做，这里只动名册）。 */
export function markDirty(memo, key) {
  if (!memo) return
  const k = String(key || '')
  if (!k) return
  try { if (memo.roster && memo.roster.byKey instanceof Map) memo.roster.byKey.delete(k) } catch (e) {}
  try { if (memo.dirty instanceof Set) memo.dirty.add(k) } catch (e) {}
}
/** 写操作波及某票 → 删它的读缓存、含它的列表缓存、名册条目，并记脏。
 *  key 必须带仓库前缀（与缓存键同形）：调用方传 repo，由这里拼，避免裸票号对不上。 */
export function rosterDirty(memo, repo, keys) {
  const pre = repoIdOf(repo) + '|'
  const list = isArr(keys) ? keys : []
  for (const raw of list) {
    const k = String(raw || '')
    if (!k) continue
    memo.dirty.add(k)
    const drop = []
    for (const entry of memo.store) {
      const sk = entry[0]
      const val = entry[1]
      if (sk === 'get|' + pre + k || sk === 'deps|' + pre + k) { drop.push(sk); continue }
      if (sk.indexOf('list|' + pre) === 0 && val && isArr(val.members) && val.members.indexOf(k) >= 0) drop.push(sk)
    }
    for (const sk of drop) memo.store.delete(sk)
    memo.roster.byKey.delete(k)
    continue
  }
  memo.seq += 1
}

function timeoutResult() {
  return { ok: false, error: { kind: 'timeout', message: '这一次远端调用在限时内没回来，是否生效说不清：先按返回里说的办法核对现状再续，不要直接重放写操作。' } }
}
function abortedResult() {
  return { ok: false, error: { kind: 'aborted', message: '这次调用被中止了，没做完就是没做：按需重调一次即可。' } }
}
function budgetResult() {
  return { ok: false, error: { kind: 'over-budget', message: '剩余额度不够再发一次远端调用了，这次没动手：带同样参数重调一次即可接着做。' } }
}

/**
 * 给一次工具调用包一层执行上下文。
 * c：壳给的调用上下文（tracker / opCtx / now，缺 tracker 则 scope.ok 为假）。
 * exec：工具 run 收到的 exec（只为取调用方取消信号，拿不到就当没有）。
 * opts：{ timeoutMs, marginMs, perOpTimeoutMs, now } 全可选，测试注入小预算就靠它。
 */
export function withCallScope(c, exec, opts) {
  const o = opts || {}
  const cc = c || {}
  const real = cc.tracker || null
  const nowFn = (typeof o.now === 'function') ? o.now : ((typeof cc.now === 'function') ? cc.now : Date.now)
  const budget = {
    timeoutMs: num(o.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS),
    marginMs: num(o.marginMs, DEFAULT_TOOL_MARGIN_MS),
    perOpTimeoutMs: num(o.perOpTimeoutMs, DEFAULT_PER_OP_TIMEOUT_MS),
    startedAt: nowFn(),
  }
  const callerSignal = (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : null
  const memo = createCallMemo()
  const baseOpCtx = Object.assign({}, cc.opCtx, { memo: memo })
  if (callerSignal) baseOpCtx.signal = callerSignal

  function remainingMs() { return Math.max(0, budget.startedAt + budget.timeoutMs - nowFn()) }
  function outOfBudget() { return remainingMs() <= budget.marginMs }

  async function execOp(label, fn) {
    void label
    if (outOfBudget()) return { ok: false, refused: 'budget' }
    if (callerSignal && callerSignal.aborted === true) return { ok: false, refused: 'aborted' }
    const clamp = Math.min(budget.perOpTimeoutMs, Math.max(1, remainingMs() - budget.marginMs))
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null
    const sig = ctrl ? ctrl.signal : null
    let onCaller = null
    if (callerSignal && typeof callerSignal.addEventListener === 'function' && ctrl) {
      onCaller = function () { try { ctrl.abort() } catch (e) {} }
      try { callerSignal.addEventListener('abort', onCaller, { once: true }) } catch (e) {}
    }
    let timedOut = false
    let timer = null
    try {
      if (typeof setTimeout === 'function' && ctrl) {
        timer = setTimeout(function () { timedOut = true; try { ctrl.abort() } catch (e) {} }, clamp)
      }
      const ctx2 = sig ? Object.assign({}, baseOpCtx, { signal: sig }) : baseOpCtx
      const result = await fn(ctx2)
      if (timedOut) return { ok: false, timeout: true, result: result }
      if (sig && sig.aborted) return { ok: false, aborted: true, result: result }
      return { ok: true, result: result }
    } catch (e) {
      if (timedOut) return { ok: false, timeout: true, error: e }
      if (sig && sig.aborted) return { ok: false, aborted: true, error: e }
      return { ok: false, error: e }
    } finally {
      try { if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer) } catch (e) {}
      try { if (callerSignal && onCaller && typeof callerSignal.removeEventListener === 'function') callerSignal.removeEventListener('abort', onCaller) } catch (e) {}
    }
  }

  function mapOpOutcome(r) {
    if (r.ok) return r.result
    if (r.timeout) return timeoutResult()
    if (r.aborted || r.refused === 'aborted') return abortedResult()
    if (r.refused === 'budget') return budgetResult()
    return { ok: false, error: { kind: 'backend-threw', message: '这一次远端调用抛错了（已拦下）：' + String((r.error && r.error.message) || r.error || '未知').slice(0, 200) } }
  }

  function memoGet(kind, key) {
    const e = memo.store.get(kind + '|' + key)
    return (e && e.seq === memo.seq) ? e.result : null
  }
  function memoPut(kind, key, result, members) {
    memo.store.set(kind + '|' + key, { seq: memo.seq, result: result, members: isArr(members) ? members : null })
  }
  function noTracker() {
    return { ok: false, error: { kind: 'backend-threw', message: '这次没拿到后端实现，我没往下做。' } }
  }

  // 写穿透共用（新增七个操作中的六个写操作）：无记忆缓存，成功只脏该票
  // （与 setParent/setBlockedBy 同形）；超时与中止的回执与现有六个一字同形。
  async function writeThru(op, repo, key, invoke) {
    if (!real[op]) return noTracker()
    const out = mapOpOutcome(await execOp(op, function (c2) { return invoke(c2) }))
    if (out && out.ok === true) rosterDirty(memo, repo, [String(key)])
    return out
  }

  let tracker = null
  if (real) {
    tracker = {
      get: async function (repo, key, f, ctx) {
        void ctx
        const k = repoIdOf(repo) + '|' + String(key)
        const hit = memoGet('get', k)
        if (hit) return hit
        const out = mapOpOutcome(await execOp('get', function (c2) { return real.get(repo, key, f || {}, c2) }))
        if (out && out.ok === true && out.data) { memoPut('get', k, out); rosterUpsert(memo, out.data) }
        return out
      },
      list: async function (repo, filter, ctx) {
        void ctx
        const k = repoIdOf(repo) + '|' + canon(filter || {})
        const hit = memoGet('list', k)
        if (hit) return hit
        const out = mapOpOutcome(await execOp('list', function (c2) { return real.list(repo, filter || {}, c2) }))
        if (out && out.ok === true && isArr(out.data)) memoPut('list', k, out, rosterAdoptList(memo, out.data, filter))
        return out
      },
      getDependencies: async function (repo, key, f, ctx) {
        void ctx
        const k = repoIdOf(repo) + '|' + String(key)
        const hit = memoGet('deps', k)
        if (hit) return hit
        const out = mapOpOutcome(await execOp('deps', function (c2) { return real.getDependencies(repo, key, f || {}, c2) }))
        if (out && out.ok === true && out.data) {
          memoPut('deps', k, out)
          rosterUpsert(memo, { key: String(key), blockedBy: out.data.blockedBy })
        }
        return out
      },
      create: async function (repo, input, ctx) {
        void ctx
        if (!real.create) return noTracker()
        const out = mapOpOutcome(await execOp('create', function (c2) { return real.create(repo, input, c2) }))
        if (out && out.ok === true && out.data && out.data.key !== undefined) rosterUpsert(memo, out.data)
        return out
      },
      setParent: async function (repo, key, parent, f, ctx) {
        void ctx
        if (!real.setParent) return noTracker()
        const out = mapOpOutcome(await execOp('setParent', function (c2) { return real.setParent(repo, key, parent, f || {}, c2) }))
        if (out && out.ok === true) rosterDirty(memo, repo, [String(key)])
        return out
      },
      setBlockedBy: async function (repo, key, blockers, f, ctx) {
        void ctx
        if (!real.setBlockedBy) return noTracker()
        const out = mapOpOutcome(await execOp('setBlockedBy', function (c2) { return real.setBlockedBy(repo, key, blockers, f || {}, c2) }))
        if (out && out.ok === true) rosterDirty(memo, repo, [String(key)])
        return out
      },
      // 以下七个是本次补的钳制与预算口（deck_context/patch/create/report 在此之前直调后端，
      // 无单次钳制、无剩余额度检查，串行几个慢调用就撞上外层 120 秒被掐）。形状与契约同形：
      // preflight 不记名册（环境探活次次真问）；六个写操作成功只脏该票，与上面两写同形。
      preflight: async function (handle, ctx) {
        void ctx
        if (!real.preflight) return noTracker()
        return mapOpOutcome(await execOp('preflight', function (c2) { return real.preflight(handle, c2) }))
      },
      // #992：仓库写权限旁路（只读探活一次，次次真问；没有这个方法的后端诚实回未知，
      //   不走 backend-threw —— 缺方法不是执行层失败，调用方按未知处理）。
      getRepoPermissions: async function (repo, ctx) {
        void ctx
        if (!real.getRepoPermissions) return { ok: false, error: { kind: 'unsupported', message: '这个后端没有仓库写权限旁路，按未知处理' } }
        return mapOpOutcome(await execOp('repoPermissions', function (c2) { return real.getRepoPermissions(repo, c2) }))
      },
      close: async function (repo, key, f, ctx) {
        void ctx
        return writeThru('close', repo, key, function (c2) { return real.close(repo, key, f || {}, c2) })
      },
      reopen: async function (repo, key, ctx) {
        void ctx
        return writeThru('reopen', repo, key, function (c2) { return real.reopen(repo, key, c2) })
      },
      comment: async function (repo, key, body, ctx) {
        void ctx
        return writeThru('comment', repo, key, function (c2) { return real.comment(repo, key, body, c2) })
      },
      update: async function (repo, key, patch, ctx) {
        void ctx
        return writeThru('update', repo, key, function (c2) { return real.update(repo, key, patch, c2) })
      },
      setLabels: async function (repo, key, labels, f, ctx) {
        void ctx
        return writeThru('setLabels', repo, key, function (c2) { return real.setLabels(repo, key, labels, f || {}, c2) })
      },
      setAssignees: async function (repo, key, assignees, f, ctx) {
        void ctx
        return writeThru('setAssignees', repo, key, function (c2) { return real.setAssignees(repo, key, assignees, f || {}, c2) })
      },
    }
  }

  return {
    tracker: tracker,
    opCtx: baseOpCtx,
    memo: memo,
    budget: budget,
    remainingMs: remainingMs,
    outOfBudget: outOfBudget,
    execOp: execOp,
    ok: !!real,
  }
}
