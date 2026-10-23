// src/deck/shell/call-memo.ts —— 一次调用里的记忆：读缓存 + 票关系名册 + 脏票集合（#1040 从 tool-call-budget-enforcement.ts 拆出）
//
// 为什么单独一个文件：tool-call-budget-enforcement.ts 补完类型标注之后有效行数冲到 428，越过了「单文件 350 行」
// 那条上限（tests/verify-file-granularity.ts）。这里装的是纯数据结构与它们的键（怎么存、怎么作废），
// 那边装的是预算与钳制（怎么看钟、怎么中止）。拆开的唯一原因就是那条行数上限，不是为了分层。
//
// 谁用它：同目录的 tool-call-budget-enforcement.ts（门面每次读写都过这里）；后端房间经 ctx.memo 读同一份东西
// （房间 → 壳是允许的方向），只读不建。
//
// 三条不能改的约定：
//   1. 缓存键的形状是 `get|<仓库>|<票号>` / `deps|<仓库>|<票号>` / `list|<仓库>|<规范串>`，
//      房间与门禁按这个形状找条目（tests/verify-895-github-memo.js 钉着），改形要全改。
//   2. seq 是写入口的版本号：写操作一律把它往前推一格，旧 seq 的条目当场作废。别把它当计数器用。
//   3. 名册只记关系（谁被阻塞、父票是谁），正文一律不入内存；complete 位只在整仓列表成功时才立。
//
// 本文件零导入，也不碰时间、不碰后端、不落盘：给它数据，它给结论。
//
// 已知的重复：src/tracker/rooms/github/roster.ts 有一份房间自己的同名实现（#895 时期就分了两份）。
// 本票（#1040）按票面边界不动房间那侧；「同一份规则两处实现」这件事记在地图 #1037 的账上。

/** 未知形状的入参统一按这张表逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>;

/** 缓存里的一条：seq 是写入口的版本号，对不上就当作过期（写操作会前推 seq）。 */
export interface MemoEntry {
  seq: number;
  result: unknown;
  members: string[] | null;
}

/** 名册里的一条：只记关系（谁被阻塞、父票是谁），正文一律不入内存。 */
export interface RosterEntry {
  blockedBy: string[];
  parentKey: string;
}

/** 一次调用里的记忆：操作结果缓存 + 票关系名册 + 脏票集合（房间读它做定向刷新）。 */
export interface CallMemo {
  seq: number;
  store: Map<string, MemoEntry>;
  roster: { complete: boolean; byKey: Map<string, RosterEntry> };
  dirty: Set<string>;
}

/** 仓库的缓存前缀：refId 优先，其次后端 id，再拼 effortId（多工作区同一个后端时靠它分开）。 */
export function repoIdOf(repo: unknown): string {
  const r = (repo || {}) as UnknownRecord
  const id = (typeof r.refId === 'string' && r.refId) ? r.refId : ((typeof r.backend === 'string') ? r.backend : '')
  const ef = (typeof r.effortId === 'string') ? r.effortId : ''
  return id + (ef ? '#' + ef : '')
}
/** 过滤器与参数的规范串：键排序后拼一串，用来当缓存键（同形不同序算同一个键）。 */
export function canon(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (typeof v === 'object') {
    const o = v as UnknownRecord
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}
/** 数组判定（收窄成 unknown[]，读数据时到处要用）。 */
export function isArr(v: unknown): v is unknown[] { return Array.isArray(v) }

/** 一次调用的记忆：操作结果缓存 + 票关系名册（后端检查者用来做定向刷新）。 */
export function createCallMemo(): CallMemo {
  return { seq: 0, store: new Map<string, MemoEntry>(), roster: { complete: false, byKey: new Map<string, RosterEntry>() }, dirty: new Set<string>() }
}
function rowKeysOf(rows: unknown): string[] {
  const out: string[] = []
  const list = isArr(rows) ? rows : []
  for (const r of list) {
    const rec = (r || null) as UnknownRecord | null
    if (rec && (typeof rec.key === 'string' || typeof rec.key === 'number')) out.push(String(rec.key))
  }
  return out
}
function blockedKeysOf(issue: unknown): string[] {
  const bb = issue ? (issue as UnknownRecord).blockedBy : null
  if (!isArr(bb)) return []
  const out: string[] = []
  for (const b of bb) {
    const k = String((b ? (b as UnknownRecord).key : '') || b || '')
    if (k) out.push(k)
  }
  return out
}
function parentOf(issue: unknown): string {
  const p = issue ? (issue as UnknownRecord).parentKey : null
  return (p === undefined || p === null) ? '' : String(p)
}
/** 列表过滤器是否等价于整仓（只有整仓结果才能重建名册；带筛的只做合并）。 */
export function isFullListFilter(filter: unknown): boolean {
  const f = (filter || {}) as UnknownRecord
  if (f.parentKey !== undefined && f.parentKey !== null && f.parentKey !== '') return false
  if (Array.isArray(f.keys) && f.keys.length) return false
  if (typeof f.type === 'string' && f.type && f.type !== 'all') return false
  if (typeof f.state === 'string' && f.state && f.state !== 'all') return false
  return true
}
/**
 * 列表成功 → 整仓重建名册，带筛只合并（名册完整性位不动，不拿子集当全集）。
 * `opts.complete === false`（#1304）表示这份列表自己被上限截断过：只能合并本批行，完整性位置 false。
 * 这个可选布尔只在本函数与 rosterFromRows 用，不导出类型（房间那份同形实现也不导出）。
 */
export function rosterAdoptList(memo: CallMemo | null | undefined, rows: unknown, filter: unknown, opts?: { complete?: boolean }): string[] {
  if (!memo) return []
  if (isFullListFilter(filter)) return rosterFromRows(memo, rows, opts)
  const list = Array.isArray(rows) ? rows : []
  for (const r of list) { if (r) rosterUpsert(memo, r) }
  return rowKeysOf(rows)
}
/**
 * 整仓列表成功 → 重建名册（dirty 清空：这次读是新鲜的，之前写的都含在里面了）。
 * 列表被上限截断（`opts.complete === false`）时只合并这一批行：完整性位保持 false、dirty 不清 ——
 * 少了一半票的索引算出来的关系会静默少边，那正是 #1304 要修的另一半。
 */
export function rosterFromRows(memo: CallMemo, rows: unknown, opts?: { complete?: boolean }): string[] {
  const list = isArr(rows) ? rows : []
  if (opts && opts.complete === false) {
    for (const r of list) {
      if (!r) continue
      memo.roster.byKey.set(String((r as UnknownRecord).key), { blockedBy: blockedKeysOf(r), parentKey: parentOf(r) })
    }
    memo.roster.complete = false
    return rowKeysOf(rows)
  }
  const byKey = new Map<string, RosterEntry>()
  for (const r of list) {
    if (!r) continue
    byKey.set(String((r as UnknownRecord).key), { blockedBy: blockedKeysOf(r), parentKey: parentOf(r) })
  }
  memo.roster = { complete: true, byKey: byKey }
  memo.dirty = new Set<string>()
  return rowKeysOf(rows)
}
/** 单票读成功 → 合并进名册并洗掉它的脏标记。 */
export function rosterUpsert(memo: CallMemo, issue: unknown): void {
  if (!issue) return
  const k = String((issue as UnknownRecord).key)
  memo.roster.byKey.set(k, { blockedBy: blockedKeysOf(issue), parentKey: parentOf(issue) })
  memo.dirty.delete(k)
}
/** 后端内部写操作的可选标记：删名册条目并记脏（操作缓存的裁剪由外层 facade 做，这里只动名册）。 */
export function markDirty(memo: CallMemo | null | undefined, key: unknown): void {
  if (!memo) return
  const k = String(key || '')
  if (!k) return
  try { if (memo.roster && memo.roster.byKey instanceof Map) memo.roster.byKey.delete(k) } catch (e) {}
  try { if (memo.dirty instanceof Set) memo.dirty.add(k) } catch (e) {}
}
/** 写操作波及某票 → 删它的读缓存、含它的列表缓存、名册条目，并记脏。
 *  key 必须带仓库前缀（与缓存键同形）：调用方传 repo，由这里拼，避免裸票号对不上。 */
export function rosterDirty(memo: CallMemo, repo: unknown, keys: unknown): void {
  const pre = repoIdOf(repo) + '|'
  const list = isArr(keys) ? keys : []
  for (const raw of list) {
    const k = String(raw || '')
    if (!k) continue
    memo.dirty.add(k)
    const drop: string[] = []
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

/** 新建成功 → 名册并入新票，并把同一后端的工作区列表缓存整片作废，再把 seq 往前推一格。
 *  为什么不能照用 rosterDirty：它按「成员里有这张票」删列表缓存，而刚建的票不在任何旧列表里，
 *  一条也删不到——于是同一次调用里后面再读列表，拿回的是不含新票的旧快照。
 *  这里与改删同形（seq 前推＝这次调用里后面的读重新走远端），只是删法按整片删。
 *  也不必像 rosterDirty 那样删 get|/deps| 条目：读缓存只在读成功时才写，而新票的票号
 *  在这一次调用里从没读过；seq 前推之后，门面那侧就算还留着旧条目也不会再命中。 */
export function rosterAddCreated(memo: CallMemo | null | undefined, repo: unknown, issue: unknown): string {
  if (!memo) return ''
  const rec = (issue || null) as UnknownRecord | null
  const k = (rec && rec.key !== undefined && rec.key !== null) ? String(rec.key) : ''
  if (k) rosterUpsert(memo, issue)
  const pre = repoIdOf(repo) + '|'
  for (const sk of Array.from(memo.store.keys())) {
    if (sk.indexOf('list|' + pre) === 0) memo.store.delete(sk)
  }
  memo.seq += 1
  return k
}
