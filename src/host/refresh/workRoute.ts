// src/host/refresh/workRoute.ts —— 会话↔票 工作路线的宿主半（#714 T10）
//
// 依据：定稿第十二章（增补）「会话与票：工作路线（数据侧）」与票面 #714。纯逻辑（键构造、按会话分格的
// 去重与留存、「只记写不记读」的过滤判定、落盘形状与隐私自检）全在 refresh-core 那份产物
// src/shared/refresh/chain.js 里；本文件只做它做不了的事：**内存表与落盘**，以及从工具调用事件取数。
//
// 守住五件事，逐条对应下面一段代码：
//   1. **按会话分格**：内存里一格一个会话（键是会话散列），同一个仓库开着两个会话时两条链互不覆盖
//      —— 这是票面点名的失败现场（同根多会话互相覆盖）。
//   2. **只记写与明确的处理动作**：本文件一条读都不记。判定交给 chain.js 的 chainVerdictOf，
//      它认识「明确只读」的工具与子命令（看票、列票、看帮助）与「写」的三条来源
//      （我们工具的具名参数 / 当前后端的命令行 / markdown 后端票文件的路径）。读那一路本来就不记，
//      本文件也不再发日志（#1083 退役了 sessionTickets.chain 一族；新存档的轨迹由
//      src/deck/shell/work-path-store.ts 发 workRoute.write / workRoute.read）。
//   3. **按时间与体积留存**：去重、时间倒序，超过 30 天的条目在下一次落盘时清掉，整份仍超过
//      2MB 就按时间从旧到新裁（#1083 把原来「每会话 20 张」的硬上限换掉了：会话长短差得远，
//      按张数切对长会话不够、对短会话又太多，而且把「多久没动」这个真正的判据排除在外）。
//      「分片内防抖」在这里的落点就是同一张票重复出现只留一条（链要回答的是「在处理哪几张票」，
//      不是一笔流水账），没有第二个合并窗口，也没有定时器。
//   4. **落盘只存散列与票键**：写下去的是 chainToDisk 那一份（会话散列、工作区根散列、后端名、
//      票键、时间、动作类别）。会话 id 原文、路径原文、命令原文一个都不在里面；落盘前还要过一遍
//      chainPrivacyViolations 自检，见到路径或命令的形状就**整份不写**。
//      注意这是**旧宿主缓存**（session-tickets.json）自己的口径；#1083 起新的工作路线存档
//      （src/deck/shell/work-path-store.ts）改用「字段白名单 + 凭证形状」检查，允许会话 id 原文与
//      会话/票标题快照落盘，凭证原文仍然永不落盘 —— 两代口径为什么不同见 ADR 20261019。
//   4b. **记之前先洗根**：调用方传进来的可能是会话所选目录原文（子目录、尾斜杠、大小写混写），
//      这里经注入的 canonicalKey 洗成工作区根后再算散列 —— 同一处地方永远落同一格，
//      读回那一侧按根过滤才找得到（#781；不洗就会内存里有、盘里有、读数里没有）。
//      洗不出来（没注入、抛错、回空）就用原文：宁可按旧形状记，也不错过这一笔。
//   5. **重启不丢**：落盘在 <进程当前目录>/.dsh-mattskillsdeck-cache/session-tickets.json（与命名守护
//      那份 naming-guardian.json 同一个目录、同一条纪律：全文覆写、失败不抛错）。切进工作区时调
//      restore() 读回来，链就回来了。
//
// 为什么没有定时器：写票是人的动作或 AI 的调用，本来就在低频那一档（一次最多几行 JSON），
// 当场写掉最省事，也省掉「脏了就刷」这条常驻活与它的日志点。缓存有 30 天保留期：清理由
// 本文件的纯函数 chainPrune 在每次落盘前做（数字来自 chain-prune.js），不需要定时扫描。
//
// 接线：订阅会话事件那条路（src/host/refresh/writeEvents.js）判定完一次调用之后，把结果交给
// note()；note() 只认已经判定过的东西，不自己去解析命令原文 —— 命令原文不进这个函数更好，
// 进来了也只是瞬时匹配，绝不留存。
//
// （2026-10-18 #1247 从 sessionTickets.js 转成 .ts：只加类型标注与注释，逻辑一行未动；
// 2026-10-19 #1260 从 sessionTickets 改名 workRoute，行为仍未动 —— 旧名只作历史说明。）
// 相对引用保持 .js 后缀，由 scripts/ts-hook.mjs 改指同名 .ts；落盘形状与隐私自检的约定不变，
// 本文件只记散列与票键，原文一个都不落盘。）
import { createChainState, chainVerdictOf, chainRecord, chainRootHash, chainSessionShardId, chainEntriesOf, chainToDisk, chainFromDisk, chainPrivacyViolations, CHAIN_ACTIONS, CHAIN_DISK_VERSION, chainBackendId, chainEffortId, chainTicketKey, isFingerprintLike } from '../../shared/refresh/chain.js'
import type { ChainEntry, ChainState } from '../../shared/refresh/src/chain.js'
import { CHAIN_KEEP_MS, CHAIN_MAX_BYTES, utf8Bytes, newestPrefixThatFits } from '../../shared/refresh/chain-prune.js'
// 本域 tsconfig 有意不加载任何类型包（types 为空），node:fs/promises 与 node:path 的类型声明
// 随 @types/node 一起被挡在门外；运行时一定是 Node，这两个模块必然存在。所以只忽略导入这一行的类型错误
// （纯类型层面，不影响 esbuild 的运行时转译）——与 src/host/choiceStore.ts 同一写法。
// @ts-expect-error
import { mkdir, readFile, writeFile } from 'node:fs/promises'
// @ts-expect-error
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// 类型（#1247 转写：只写类型不写实现）。
//
// 为什么这样标：内存表是本文件拥有的唯一形状（按会话散列分格），纯函数那一侧只给操作，
// 形状的读写都在这里，所以分格与条目的字段写死，免得以后有人顺手把会话原文写进来。
// 从外面进来的东西（缓存目录、文件服务、日志出口、归一出口、时钟）全是可选的，
// 测试一律用假零件，生产才给真的，所以依赖整包按 any 收，收窄发生在各使用点的 typeof 判断里。
// 落盘那一份只认散列与票键，隐私自检没过就整份不写 —— 这条纪律由 chainPrivacyViolations 守，
// 类型不替它放行任何原文。清理那两条线（30 天、2MB）的数字来自 chain-prune.js 的常量，本文件不另写一份；
// 链专用的裁剪实现也住在下面（数字与二分是共享的，怎么拼成链的落盘形状要用 chain.js 的工具，只能在这里）。
// ---------------------------------------------------------------------------

/** 落盘文件名（与 naming-guardian.json 同一个缓存目录）。 */
// 旧文件名常量：旧数据不读、不迁移、不删除（换存储路径归 #1261/#1083）。
export const SESSION_TICKETS_FILE = 'session-tickets.json'

/** 建表时的依赖：全部可选，给什么用什么（测试一律用假零件）。 */
interface WorkRouteDeps {
  cacheDir?: string
  getCacheDir?: () => string | Promise<string | null> | null
  fs?: any
  platform?: any
  readText?: (p: string) => string | Promise<string>
  writeText?: (p: string, text: string) => unknown | Promise<unknown>
  canonicalKey?: (raw: string) => string | Promise<string>
  now?: () => number
}

/** note() 的入参：已经判定过的那一笔，命令原文只做瞬时匹配，绝不留存。 */
interface NoteInput {
  sessionId?: unknown
  rootKey?: unknown
  rootHash?: unknown
  backend?: unknown
  effortId?: unknown
  tool?: unknown
  tier?: unknown
  reason?: unknown
  verb?: unknown
  ticketKey?: unknown
  path?: unknown
  args?: unknown
}

// ---------------------------------------------------------------------------
// 落盘前的留存裁剪（#1083，实现从共享层的 chain-prune.ts 搬到这里）。
//
// 为什么不留在共享层：.dependency-cruiser.ts 的 same-layer-import-shared 规定共享层的每个文件
// 都是自包含的纯模块，不许引用同层的另一个文件。而这一步要用 chain.js 的键构造、动作闭集合与
// 形状校验工具，才能把状态拼成落盘那份、再拼回来。宿主层引用共享层是正常方向，本文件又是
// chainPrune 唯一的生产调用方，所以实现住在这里；数字（30 天、2MB）与二分仍来自 chain-prune.js。
// ---------------------------------------------------------------------------

/** 留存裁剪的结果：dropped 是「按 30 天清掉 + 按 2MB 裁掉」一共丢了多少条，bytes 是裁剪后那份落盘的字节数。 */
export interface ChainPruneResult {
  state: ChainState
  dropped: number
  bytes: number
  reason: string
}

/** 裁剪后的一条（只为了在函数内部排序与重新分格）。 */
interface PruneRow {
  shardId: string
  rootHash: string
  backend: string
  ticketKey: string
  effortId: string
  at: number
  action: string
}

/** 按时间倒序取前 count 条，拼成「准备落盘的那份」——和 chainToDisk 的形状一模一样，只是允许只取一部分。 */
function prunePayloadOf(rows: PruneRow[], count: number, at: number): { v: number; at: number; shards: Array<Record<string, unknown>> } {
  const order: string[] = []
  const grouped: Record<string, { s: string; r: string; b: string; e: Array<[string, string, number, string]> }> = {}
  for (let i = 0; i < count; i++) {
    const row = rows[i]
    if (!grouped[row.shardId]) {
      grouped[row.shardId] = { s: row.shardId, r: row.rootHash, b: row.backend, e: [] }
      order.push(row.shardId)
    }
    grouped[row.shardId].e.push([row.ticketKey, row.effortId, row.at, row.action])
  }
  const shards: Array<Record<string, unknown>> = []
  for (const id of order) shards.push(grouped[id] as unknown as Record<string, unknown>)
  return { v: CHAIN_DISK_VERSION, at: at, shards: shards }
}

/** 裁剪后重建成纯逻辑用的状态（sessionId 本来是空的：落盘那份从来不含会话 id 原文）。 */
function pruneStateOf(rows: PruneRow[]): ChainState {
  // createChainState 来自共享层的 JS 产物（不含类型声明），返回形状在这里按源码的类型标注收窄。
  const state: ChainState = createChainState() as ChainState
  for (const row of rows) {
    const shard = state.shards[row.shardId] || { shardId: row.shardId, sessionId: '', rootHash: row.rootHash, backend: row.backend, entries: [] }
    shard.entries.push({ ticketKey: row.ticketKey, effortId: row.effortId, at: row.at, action: row.action })
    state.shards[row.shardId] = shard
  }
  return state
}

/**
 * 落盘前的留存裁剪（纯函数：时间由调用方传进来，自己不读时钟，也不碰磁盘）。
 *
 * 先按 30 天清，再按 2MB 从旧到新裁；裁剪后的状态与「只留这些条」的落盘字节数一起返回。
 * reason 只表示这次有没有丢东西：'chain.pruned' 丢过，'chain.prune-kept' 一条没丢。
 */
export function chainPrune(state: ChainState, opts?: { at?: number; keepMs?: number; maxBytes?: number }): ChainPruneResult {
  const rawAt = opts ? opts.at : 0
  const at = typeof rawAt === 'number' && isFinite(rawAt) ? Math.floor(rawAt) : 0
  const rawKeep = opts ? opts.keepMs : undefined
  const keepMs = typeof rawKeep === 'number' && isFinite(rawKeep) && rawKeep >= 0 ? rawKeep : CHAIN_KEEP_MS
  const rawMax = opts ? opts.maxBytes : undefined
  const maxBytes = typeof rawMax === 'number' && isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : CHAIN_MAX_BYTES
  const cutoff = at - keepMs

  const rows: PruneRow[] = []
  let before = 0
  const src = state && state.shards ? state.shards : {}
  for (const k of Object.keys(src)) {
    const shard = src[k]
    if (!shard || !isFingerprintLike(shard.shardId) || !isFingerprintLike(shard.rootHash) || !chainBackendId(shard.backend)) continue
    for (const e of Array.isArray(shard.entries) ? shard.entries : []) {
      const ticketKey = chainTicketKey(e ? e.ticketKey : '')
      if (!ticketKey) continue
      before += 1
      const entryAt = typeof e.at === 'number' && isFinite(e.at) ? Math.floor(e.at) : 0
      if (entryAt < cutoff) continue
      const action = String(e.action || '')
      rows.push({
        shardId: String(shard.shardId),
        rootHash: String(shard.rootHash),
        backend: chainBackendId(shard.backend),
        ticketKey: ticketKey,
        effortId: chainEffortId((e as ChainEntry).effortId),
        at: entryAt,
        action: CHAIN_ACTIONS.indexOf(action) >= 0 ? action : 'other-write',
      })
    }
  }
  rows.sort((a, b) => b.at - a.at)

  // 二分找「按时间倒序最多能留下多少条」：留得越多体积越大，所以可以二分。
  const kept = newestPrefixThatFits(rows.length, (count: number) => utf8Bytes(JSON.stringify(prunePayloadOf(rows, count, at))), maxBytes)
  const keptRows = rows.slice(0, kept)
  const bytes = utf8Bytes(JSON.stringify(prunePayloadOf(keptRows, keptRows.length, at)))
  return { state: pruneStateOf(keptRows), dropped: before - kept, bytes: bytes, reason: before - kept > 0 ? 'chain.pruned' : 'chain.prune-kept' }
}

/**
 * 建一张工作路线的内存表与它的落盘。
 *
 * deps 全部是可选的，给什么用什么（测试一律用假零件）：
 *   - `getCacheDir()`：返回缓存目录（宿主侧就是 repoKeys 那个 `<进程当前目录>/.dsh-mattskillsdeck-cache`）；
 *   - `cacheDir`：直接给目录（测试用）；
 *   - `fs` + `platform`：宿主的平台服务（`fs.resolve` / `fs.readText` / `fs.writeText`），与命名守护同一套；
 *   - `readText` / `writeText`：最简注入面（测试用，优先于上面两者）；
 *   - `canonicalKey()`：会话所选目录洗成工作区根的既有出口；有它时 note() 先洗根再算散列，没有时沿用原文；
 *   - `now()`：时钟；默认 Date.now。
 */
export function createWorkRoute(deps?: WorkRouteDeps | null): any {
  const opts: any = deps || {}
  const now: () => number = typeof opts.now === 'function' ? opts.now : Date.now

  let state: any = createChainState()
  let lastFlushAt = 0
  const counters = { records: 0, filtered: 0, flushes: 0, restored: 0, refused: 0 }

  function pathJoin(dir: any, name: any): any {
    const p: any = opts.platform && opts.platform.path
    if (p && typeof p.join === 'function') { try { return p.join(dir, name) } catch (e: any) { /* 退回 node 的拼法 */ } }
    return join(dir, name)
  }

  async function dirOf(): Promise<string | null> {
    if (opts.cacheDir) return String(opts.cacheDir)
    if (typeof opts.getCacheDir === 'function') { try { return await opts.getCacheDir() } catch (e: any) { return null } }
    return null
  }

  async function readTextOf(p: any): Promise<any> {
    if (typeof opts.readText === 'function') return await opts.readText(p)
    const fs: any = opts.fs
    if (fs && typeof fs.readText === 'function' && typeof fs.resolve === 'function') {
      const t: any = await fs.resolve(p)
      return await fs.readText(t)
    }
    return await readFile(p, 'utf8')
  }

  async function writeTextOf(p: any, text: string): Promise<any> {
    if (typeof opts.writeText === 'function') return await opts.writeText(p, text)
    const fs: any = opts.fs
    if (fs && typeof fs.writeText === 'function' && typeof fs.resolve === 'function') {
      const t: any = await fs.resolve(p)
      return await fs.writeText(t, text)
    }
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, text, 'utf8')
  }

  /** 这份缓存该落在哪个文件（拿不到目录就是 null）。 */
  async function fileOf(): Promise<any> {
    const dir: any = await dirOf()
    if (!dir) return null
    return pathJoin(dir, SESSION_TICKETS_FILE)
  }

  /**
   * 记一条已经判定过的工具调用。入参里可能带命令原文与路径原文，但它们只在这一层做瞬时匹配。
   *
   * `input`：`{ sessionId, rootKey 或 rootHash, backend, tool, tier, reason, verb, ticketKey, effortId, path, args }`
   * 其中 tier / reason 是写事件判定表（src/shared/refresh/write-detect.js）给的那一档与原因代号。
   * 返回 `{ recorded, action, ticketKey, effortId, reason, count }`；读、认不出、说不出票号一律 recorded:false。
   * #783：工作单元一路带到链上 —— 判据从路径与显式入参里取出它，记录与落盘都带着它。
   */
  async function note(input: NoteInput): Promise<any> {
    const verdict: any = chainVerdictOf(input)
    if (!verdict.record) { counters.filtered += 1; return { recorded: false, action: '', ticketKey: '', effortId: '', reason: verdict.reason, count: 0 } }
    // #781：先洗根再算散列。调用方（主动上报那一路）传的是会话所选目录原文，
    // 读回那一侧按工作区根过滤；不洗就会同一处落两格。洗失败就用原文，不丢这一笔。
    let rootKey: any = input ? input.rootKey : ''
    if ((!input || !input.rootHash) && rootKey && typeof opts.canonicalKey === 'function') {
      try { const c: any = await opts.canonicalKey(rootKey); if (typeof c === 'string' && c) rootKey = c } catch (e: any) { /* 用原文 */ }
    }
    const rootHash: any = input && input.rootHash ? String(input.rootHash) : chainRootHash(rootKey)
    const r: any = chainRecord(state, {
      sessionId: input ? input.sessionId : '',
      rootHash: rootHash,
      backend: input ? input.backend : '',
      effortId: verdict.effortId || '',
      ticketKey: verdict.ticketKey,
      action: verdict.action,
      at: now(),
    })
    if (!r.recorded) { counters.refused += 1; return { recorded: false, action: '', ticketKey: '', effortId: '', reason: r.reason, count: 0 } }
    state = r.state
    counters.records += 1
    const count: any = chainEntriesOf(state, input.sessionId).length
    // 记进链与落盘是同一步：写票本来就低频，当场写掉，省掉一个定时器与它的日志点。
    // #1083：这一路上原来那行 sessionTickets.chain 日志已随事件退役删掉；新存档的落盘轨迹
    // 由 src/deck/shell/work-path-store.ts 发 workRoute.write，本文件不再记日志。
    await flush()
    return { recorded: true, action: verdict.action, ticketKey: verdict.ticketKey, effortId: verdict.effortId || '', reason: 'chain.record', count: count }
  }

  /**
   * 把当前内存表写下去（全文覆写；照命名守护的做法：写不进去也不抛错，只把 ok:false 带回去）。
   *
   * #1083：落盘前先按 30 天保留期与 2MB 体积裁剪，返回里 `pruned` 是这一次裁掉了多少条。
   * 这一路不再记日志 —— 会话↔票链的常驻事件 sessionTickets.chain 已退役，新存档另发 workRoute.write。
   */
  async function flush(): Promise<any> {
    // #1083：落盘前先按 30 天保留期与 2MB 体积裁剪（纯函数，时间由这里传进去）。
    const at: number = now()
    const pruned: any = chainPrune(state, { at: at })
    state = pruned.state
    const payload: any = chainToDisk(state, { at: at })
    const dirty: any = chainPrivacyViolations(payload)
    let ok = false
    let reason = 'ok'
    if (dirty.length > 0) {
      // 隐私自检没过：整份不写（这一步能走到就是上游把原文漏进来了，宁可这次不落盘）。
      reason = 'privacy'
    } else {
      try {
        const file: any = await fileOf()
        if (!file) reason = 'no-dir'
        else { await writeTextOf(file, JSON.stringify(payload)); ok = true }
      } catch (e: any) { reason = 'write-fail' }
    }
    lastFlushAt = at
    if (ok) counters.flushes += 1
    return { ok: ok, reason: reason, shards: payload.shards.length, entries: countEntries(), pruned: pruned.dropped }
  }

  function countEntries(): number {
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
  async function restore(restoreOpts?: any): Promise<any> {
    const rootKey: any = restoreOpts && restoreOpts.rootKey
    const wanted: any = rootKey ? chainRootHash(rootKey) : ''
    let cache = 'skip'
    let payload: any = null
    try {
      const file: any = await fileOf()
      if (!file) cache = 'skip'
      else {
        const txt: any = await readTextOf(file)
        if (!txt) cache = 'miss'
        else { try { payload = JSON.parse(txt); cache = 'hit' } catch (e: any) { cache = 'bad' } }
      }
    } catch (e: any) { cache = 'miss' }
    if (!payload) {
      return { restored: 0, entries: 0, cache: cache, reason: cache === 'bad' ? 'chain.disk-shape' : 'chain.disk-empty' }
    }
    const read: any = chainFromDisk(payload)
    const shards: Record<string, any> = {}
    for (const k of Object.keys(read.state.shards)) {
      const sh: any = read.state.shards[k]
      if (wanted && sh.rootHash !== wanted) continue
      shards[k] = sh
    }
    for (const k of Object.keys(state.shards)) if (!shards[k]) shards[k] = state.shards[k]
    state = { shards: shards }
    counters.restored += 1
    const n = Object.keys(shards).length
    return { restored: n, entries: countEntries(), cache: n > 0 ? 'hit' : cache, reason: read.reason }
  }

  /** 某个会话的那一格链（时间倒序；条数由落盘前的 30 天/2MB 裁剪决定）；没有就是空数组。 */
  function entriesOf(sessionId: any): any {
    return chainEntriesOf(state, sessionId)
  }

  /** 某个会话现在记着几张票（面板那条展示链要的数字，本票只提供数，不画）。 */
  function sizeOf(sessionId: any): number {
    return entriesOf(sessionId).length
  }

  function stats(): any {
    return {
      shards: Object.keys(state.shards).length,
      entries: countEntries(),
      keepMs: CHAIN_KEEP_MS,
      maxBytes: CHAIN_MAX_BYTES,
      records: counters.records,
      filtered: counters.filtered,
      flushes: counters.flushes,
      restored: counters.restored,
      refused: counters.refused,
      lastFlushAt: lastFlushAt,
    }
  }

  /** 只读快照（调试与门禁用）：会话 id 只以散列出现。 */
  function snapshot(): any {
    const out: any[] = []
    for (const k of Object.keys(state.shards)) {
      const sh: any = state.shards[k]
      out.push({ shardId: sh.shardId, rootHash: sh.rootHash, backend: sh.backend, entries: sh.entries.map((e: any) => ({ ticketKey: e.ticketKey, effortId: (e.effortId === undefined || e.effortId === null) ? '' : String(e.effortId), at: e.at, action: e.action })) })
    }
    return out
  }

  /** 丢掉内存里的一格或全部（测试与「切出工作区」用）。 */
  function drop(sessionId?: any): void {
    if (sessionId === undefined || sessionId === null || sessionId === '') { state = createChainState(); return }
    const sid: any = chainSessionShardId(sessionId)
    const shards: Record<string, any> = {}
    for (const k of Object.keys(state.shards)) if (k !== sid) shards[k] = state.shards[k]
    state = { shards: shards }
  }

  return { note: note, flush: flush, restore: restore, entriesOf: entriesOf, sizeOf: sizeOf, stats: stats, snapshot: snapshot, drop: drop }
}
