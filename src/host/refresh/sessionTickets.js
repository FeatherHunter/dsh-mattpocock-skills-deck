// src/host/refresh/sessionTickets.js —— 会话↔票 处理链的宿主半（#714 T10）
//
// 依据：定稿第十二章（增补）「会话与票：处理链（数据侧）」与票面 #714。纯逻辑（键构造、按会话分格的
// 去重与留存、「只记写不记读」的过滤判定、落盘形状与隐私自检）全在 refresh-core 那份产物
// src/shared/refresh/chain.js 里；本文件只做它做不了的事：**内存表与落盘**，以及从工具调用事件取数。
//
// 守住五件事，逐条对应下面一段代码：
//   1. **按会话分格**：内存里一格一个会话（键是会话散列），同一个仓库开着两个会话时两条链互不覆盖
//      —— 这是票面点名的失败现场（同根多会话互相覆盖）。
//   2. **只记写与明确的处理动作**：本文件一条读都不记。判定交给 chain.js 的 chainVerdictOf，
//      它认识「明确只读」的工具与子命令（看票、列票、看帮助）与「写」的三条来源
//      （我们工具的具名参数 / 当前后端的命令行 / markdown 后端的票文件路径）。读那一路连日志都不落
//      —— 它是高频路径，记了就是刷屏（同 489 附录里 labelColors.read 那一档的处置）。
//   3. **每会话留最近 20 张**：去重、时间倒序、超过丢最旧的，算法在 chain.js 的 mergeEntries 一处。
//      「分片内防抖」在这里的落点就是同一张票重复出现只留一条（链要回答的是「在处理哪几张票」，
//      不是一笔流水账），没有第二个合并窗口，也没有定时器。
//   4. **落盘只存散列与票键**：写下去的是 chainToDisk 那一份（会话散列、工作区根散列、后端名、
//      票键、时间、动作类别）。会话 id 原文、路径原文、命令原文一个都不在里面；落盘前还要过一遍
//      chainPrivacyViolations 自检，见到路径或命令的形状就**整份不写**并记一行 ok:false。
//   5. **重启不丢**：落盘在 <进程当前目录>/.dsh-mattskillsdeck-cache/session-tickets.json（与命名守护
//      那份 naming-guardian.json 同一个目录、同一条纪律：全文覆写、失败不抛错）。切进工作区时调
//      restore() 读回来，链就回来了。
//
// 为什么没有定时器：写票是人的动作或 AI 的调用，本来就在低频那一档（一次最多几行 JSON），
// 当场写掉最省事，也省掉「脏了就刷」这条常驻活与它的日志点。缓存没有过期一说：留存上限是
// 每会话 20 张，时间只是排序用的，所以日志里没有「过期」这一档 (见 489 附录 #78)。
//
// 接线：订阅会话事件那条路（src/host/refresh/writeEvents.js）判定完一次调用之后，把结果交给
// note()；note() 只认已经判定过的东西，不自己去解析命令原文 —— 命令原文不进这个函数更好，
// 进来了也只是瞬时匹配，绝不留存。
import { createChainState, chainVerdictOf, chainRecord, chainRootHash, chainSessionShardId, chainEntriesOf, chainToDisk, chainFromDisk, chainPrivacyViolations, CHAIN_SESSION_CAP } from '../../shared/refresh/chain.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 落盘文件名（与 naming-guardian.json 同一个缓存目录）。 */
export const SESSION_TICKETS_FILE = 'session-tickets.json'

/**
 * 建一张处理链的内存表与它的落盘。
 *
 * deps 全部是可选的，给什么用什么（测试一律用假零件）：
 *   - `getCacheDir()`：返回缓存目录（宿主侧就是 repoKeys 那个 `<进程当前目录>/.dsh-mattskillsdeck-cache`）；
 *   - `cacheDir`：直接给目录（测试用）；
 *   - `fs` + `platform`：宿主的平台服务（`fs.resolve` / `fs.readText` / `fs.writeText`），与命名守护同一套；
 *   - `readText` / `writeText`：最简注入面（测试用，优先于上面两者）；
 *   - `logCtx`：宿主日志出口（`isEnabled` 与 `fire`）；没给就一条都不记；
 *   - `now()`：时钟；默认 Date.now。
 */
export function createSessionTickets(deps) {
  const opts = deps || {}
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const logCtx = opts.logCtx || null

  let state = createChainState()
  let lastFlushAt = 0
  const counters = { records: 0, filtered: 0, flushes: 0, restored: 0, refused: 0 }

  /**
   * 记一行「记进链」。三处落点各自直接写字段对象，不经过转发函数 —— 489 附录的字段白名单门禁
   * 是按调用处那个对象字面量来核对允许字段的，转发一层它就读不到字段，等于白名单失了效。
   * 字段只有散列、枚举与数字，绝不带路径、命令与票标题；日志出问题不许影响记链本身。
   */

  function pathJoin(dir, name) {
    const p = opts.platform && opts.platform.path
    if (p && typeof p.join === 'function') { try { return p.join(dir, name) } catch (e) { /* 退回 node 的拼法 */ } }
    return join(dir, name)
  }

  async function dirOf() {
    if (opts.cacheDir) return String(opts.cacheDir)
    if (typeof opts.getCacheDir === 'function') { try { return await opts.getCacheDir() } catch (e) { return null } }
    return null
  }

  async function readTextOf(p) {
    if (typeof opts.readText === 'function') return await opts.readText(p)
    const fs = opts.fs
    if (fs && typeof fs.readText === 'function' && typeof fs.resolve === 'function') {
      const t = await fs.resolve(p)
      return await fs.readText(t)
    }
    return await readFile(p, 'utf8')
  }

  async function writeTextOf(p, text) {
    if (typeof opts.writeText === 'function') return await opts.writeText(p, text)
    const fs = opts.fs
    if (fs && typeof fs.writeText === 'function' && typeof fs.resolve === 'function') {
      const t = await fs.resolve(p)
      return await fs.writeText(t, text)
    }
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, text, 'utf8')
  }

  /** 这份缓存该落在哪个文件（拿不到目录就是 null）。 */
  async function fileOf() {
    const dir = await dirOf()
    if (!dir) return null
    return pathJoin(dir, SESSION_TICKETS_FILE)
  }

  /**
   * 记一条已经判定过的工具调用。入参里可能带命令原文与路径原文，但它们只在这一层做瞬时匹配。
   *
   * `input`：`{ sessionId, rootKey 或 rootHash, backend, tool, tier, reason, verb, ticketKey, path, args }`
   * 其中 tier / reason 是写事件判定表（src/shared/refresh/write-detect.js）给的那一档与原因代号。
   * 返回 `{ recorded, action, ticketKey, reason, count }`；读、认不出、说不出票号一律 recorded:false。
   */
  async function note(input) {
    const verdict = chainVerdictOf(input)
    if (!verdict.record) { counters.filtered += 1; return { recorded: false, action: '', ticketKey: '', reason: verdict.reason, count: 0 } }
    const rootHash = input && input.rootHash ? String(input.rootHash) : chainRootHash(input ? input.rootKey : '')
    const r = chainRecord(state, {
      sessionId: input ? input.sessionId : '',
      rootHash: rootHash,
      backend: input ? input.backend : '',
      ticketKey: verdict.ticketKey,
      action: verdict.action,
      at: now(),
    })
    if (!r.recorded) { counters.refused += 1; return { recorded: false, action: '', ticketKey: '', reason: r.reason, count: 0 } }
    state = r.state
    counters.records += 1
    const count = chainEntriesOf(state, input.sessionId).length
    // 记进链与落盘是同一步：写票本来就低频，当场写掉，省掉一个定时器与它的日志点。
    const saved = await flush({ silent: true })
    try {
      if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'sessionTickets.chain', { kind: 'record', sidHash: r.shardId, rootHash: rootHash, ok: saved.ok, action: verdict.action, count: count })
    } catch (eL) { /* 日志出问题不许影响记链本身 */ }
    return { recorded: true, action: verdict.action, ticketKey: verdict.ticketKey, reason: 'chain.record', count: count }
  }

  /**
   * 把当前内存表写下去（全文覆写；照命名守护的做法：写不进去也不抛错，只把 ok:false 记下来）。
   * `silent` 是 note() 用的：那一路已经把结果合进了自己的那一行，不另记一行。
   */
  async function flush(flushOpts) {
    const silent = !!(flushOpts && flushOpts.silent)
    const payload = chainToDisk(state, { at: now() })
    const dirty = chainPrivacyViolations(payload)
    let ok = false
    let reason = 'ok'
    if (dirty.length > 0) {
      // 隐私自检没过：整份不写（这一步能走到就是上游把原文漏进来了，宁可这次不落盘）。
      reason = 'privacy'
    } else {
      try {
        const file = await fileOf()
        if (!file) reason = 'no-dir'
        else { await writeTextOf(file, JSON.stringify(payload)); ok = true }
      } catch (e) { reason = 'write-fail' }
    }
    lastFlushAt = now()
    if (ok) counters.flushes += 1
    if (!silent || !ok) {
      const first = Object.keys(state.shards)[0]
      const shard = first ? state.shards[first] : null
      try {
        if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'sessionTickets.chain', { kind: 'flush', sidHash: first || '', rootHash: shard ? shard.rootHash : '', ok: ok, action: '', count: countEntries() })
      } catch (eL) { /* 同上：日志不许影响落盘结论 */ }
    }
    return { ok: ok, reason: reason, shards: payload.shards.length, entries: countEntries() }
  }

  function countEntries() {
    let n = 0
    for (const k of Object.keys(state.shards)) n += state.shards[k].entries.length
    return n
  }

  /**
   * 从落盘读回来（重启、切进工作区时调一次）。读端比写端严格：版本不认、某一格形状不对、
   * 某一条不像票键，一律丢掉那一份/那一格/那一条（链是一份可以重建的缓存，读半份比空着更坏）。
   *
   * `restoreOpts.rootKey` 给了就只收这一个工作区的格子（缓存目录是进程级的，不只装一个仓库）。
   */
  async function restore(restoreOpts) {
    const rootKey = restoreOpts && restoreOpts.rootKey
    const wanted = rootKey ? chainRootHash(rootKey) : ''
    let cache = 'skip'
    let payload = null
    try {
      const file = await fileOf()
      if (!file) cache = 'skip'
      else {
        const txt = await readTextOf(file)
        if (!txt) cache = 'miss'
        else { try { payload = JSON.parse(txt); cache = 'hit' } catch (e) { cache = 'bad' } }
      }
    } catch (e) { cache = 'miss' }
    if (!payload) {
      try {
        if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'sessionTickets.chain', { kind: 'restore', sidHash: '', rootHash: wanted, ok: false, action: '', count: 0 })
      } catch (eL) { /* 同上 */ }
      return { restored: 0, entries: 0, cache: cache, reason: cache === 'bad' ? 'chain.disk-shape' : 'chain.disk-empty' }
    }
    const read = chainFromDisk(payload)
    const shards = {}
    for (const k of Object.keys(read.state.shards)) {
      const sh = read.state.shards[k]
      if (wanted && sh.rootHash !== wanted) continue
      shards[k] = sh
    }
    for (const k of Object.keys(state.shards)) if (!shards[k]) shards[k] = state.shards[k]
    state = { shards: shards }
    counters.restored += 1
    const n = Object.keys(shards).length
    try {
      if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'sessionTickets.chain', { kind: 'restore', sidHash: '', rootHash: wanted, ok: n > 0, action: '', count: countEntries() })
    } catch (eL) { /* 同上 */ }
    return { restored: n, entries: countEntries(), cache: n > 0 ? 'hit' : cache, reason: read.reason }
  }

  /** 某个会话的那一格链（时间倒序、最多 20 条）；没有就是空数组。 */
  function entriesOf(sessionId) {
    return chainEntriesOf(state, sessionId)
  }

  /** 某个会话现在记着几张票（面板那条展示链要的数字，本票只提供数，不画）。 */
  function sizeOf(sessionId) {
    return entriesOf(sessionId).length
  }

  function stats() {
    return {
      shards: Object.keys(state.shards).length,
      entries: countEntries(),
      capPerSession: CHAIN_SESSION_CAP,
      records: counters.records,
      filtered: counters.filtered,
      flushes: counters.flushes,
      restored: counters.restored,
      refused: counters.refused,
      lastFlushAt: lastFlushAt,
    }
  }

  /** 只读快照（调试与门禁用）：会话 id 只以散列出现。 */
  function snapshot() {
    const out = []
    for (const k of Object.keys(state.shards)) {
      const sh = state.shards[k]
      out.push({ shardId: sh.shardId, rootHash: sh.rootHash, backend: sh.backend, entries: sh.entries.map((e) => ({ ticketKey: e.ticketKey, at: e.at, action: e.action })) })
    }
    return out
  }

  /** 丢掉内存里的一格或全部（测试与「切出工作区」用）。 */
  function drop(sessionId) {
    if (sessionId === undefined || sessionId === null || sessionId === '') { state = createChainState(); return }
    const sid = chainSessionShardId(sessionId)
    const shards = {}
    for (const k of Object.keys(state.shards)) if (k !== sid) shards[k] = state.shards[k]
    state = { shards: shards }
  }

  return { note: note, flush: flush, restore: restore, entriesOf: entriesOf, sizeOf: sizeOf, stats: stats, snapshot: snapshot, drop: drop }
}
