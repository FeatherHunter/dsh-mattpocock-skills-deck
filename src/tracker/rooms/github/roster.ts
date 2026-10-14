// src/tracker/rooms/github/roster.ts —— 调用内票关系名册（#895 去放大）
//
// 为什么有这个文件：成环检查与反向聚合以前每次整仓拉取。调用上下文带名册
// （ctx.memo，工具层调用上下文建的）时只定向重读脏票，大幅减少出站。
// 名册形状与工具层调用上下文那份同形（字段 complete/byKey/dirty/seq/store），
// 两边各一份实现：房间不许引用 agent 工具层（跨层门禁），形状对不上时以读回为准，
// 绝不猜——拿不准就退回整仓拉取（老行为）。本文件零导入。
import type { Issue } from '../../contract/entities.js';
import type { ListFilter } from '../../contract/inputs.js';
import type { OpContext } from '../../contract/contexts.js';

/** 名册里一条票的最小事实：只记阻塞键与父键，调用链只读这两项，形状与工具层调用上下文那份同形。 */
interface RosterFacts {
  blockedBy: string[];
  parentKey: string;
}

/** 名册本体：是否拿全加按 key 索引的事实表，byKey 用 Map 保证插入顺序与去重。 */
interface RosterStore {
  complete: boolean;
  byKey: Map<string, RosterFacts>;
}

/** 调用上下文里携带的名册容器：room 只读写这两格，缺谁都按无名册退回整仓拉取。 */
export interface RosterMemo {
  roster?: RosterStore | null;
  dirty?: Set<string> | null;
}

/**
 * 带名册的调用上下文：宿主在运行时把名册挂在 memo 格上（契约的 OpContext 没写这一格，
 * 有就是锦上添花、没有就跳过名册更新）。读名册的函数（列表/单票/成环）收这个形状，
 * 传普通 OpContext 也照样能进（memo 是可选格）。
 */
export type MemoContext = OpContext & { memo?: RosterMemo | null };

/** 名册能收的行形状：契约 Issue 的子集（key/blockedBy/parentKey），测试桩多余字段不读。 */
type RosterRow = Pick<Issue, 'key' | 'blockedBy' | 'parentKey'>;

function isArr(v: unknown): v is unknown[] { return Array.isArray(v) }
function blockedKeysOf(issue: RosterRow | null | undefined): string[] {
  const bb = issue && issue.blockedBy
  if (!isArr(bb)) return []
  const out: string[] = []
  for (const b of bb) {
    // 为什么这样读：阻塞边多数是引用对象（取 key），历史数据里也有裸 key 串，两种都收；空值跳过，与原来一致。
    const keyField: unknown = (b && typeof b === 'object') ? (b as unknown as Record<string, unknown>).key : undefined;
    const k = String(keyField || (b as unknown) || '')
    if (k) out.push(k)
  }
  return out
}
function parentOf(issue: RosterRow | null | undefined): string {
  const p = issue && issue.parentKey
  return (p === undefined || p === null) ? '' : String(p)
}
/** 列表过滤器是否等价于整仓（只有整仓结果才能重建名册；带筛的只做合并）。 */
export function isFullListFilter(filter: ListFilter | null | undefined): boolean {
  const f = filter || {} as ListFilter;
  if (f.parentKey !== undefined && f.parentKey !== null && f.parentKey !== '') return false
  if (Array.isArray(f.keys) && f.keys.length) return false
  // 为什么转成 string 再比 'all'：历史调用方有用 'all' 表示整仓的写法，契约类型里没有这一项，转成 string 比才不会报无交集，运行时与原来一致。
  if (typeof f.type === 'string' && f.type && (f.type as string) !== 'all') return false
  if (typeof f.state === 'string' && f.state && (f.state as string) !== 'all') return false
  return true
}
/** 整仓重建，带筛合并；返回成员键（调用方裁剪缓存用）。 */
export function rosterAdoptList(memo: RosterMemo | null | undefined, rows: unknown, filter: ListFilter | null | undefined): string[] {
  if (!memo) return []
  const list: unknown[] = isArr(rows) ? rows : []
  if (isFullListFilter(filter)) {
    const byKey = new Map<string, RosterFacts>()
    for (const r of list) {
      if (!r) continue
      // 为什么断言成行形状：列表行是契约 Issue，测试桩可能缺字段，读 key/blockedBy/parentKey 三格与原来一致。
      const row = r as RosterRow;
      byKey.set(String(row.key), { blockedBy: blockedKeysOf(row), parentKey: parentOf(row) })
    }
    memo.roster = { complete: true, byKey: byKey }
    memo.dirty = new Set<string>()
  } else {
    for (const r of list) { if (r) rosterUpsert(memo, r as RosterRow) }
  }
  const out: string[] = []
  for (const r of list) { if (r) out.push(String((r as RosterRow).key)) }
  return out
}
/** 单票读成功 → 合并进名册并洗掉它的脏标记。 */
export function rosterUpsert(memo: RosterMemo | null | undefined, issue: RosterRow | null | undefined): void {
  if (!memo || !issue) return
  const k = String(issue.key)
  try {
    if (memo.roster && memo.roster.byKey instanceof Map) {
      memo.roster.byKey.set(k, { blockedBy: blockedKeysOf(issue), parentKey: parentOf(issue) })
    }
  } catch (e) {}
  try { if (memo.dirty instanceof Set) memo.dirty.delete(k) } catch (e) {}
}
/** 写操作波及某票 → 删名册条目并记脏（操作缓存的裁剪由外层 facade 做）。 */
export function markDirty(memo: RosterMemo | null | undefined, key: unknown): void {
  if (!memo) return
  const k = String(key || '')
  if (!k) return
  try { if (memo.roster && memo.roster.byKey instanceof Map) memo.roster.byKey.delete(k) } catch (e) {}
  try { if (memo.dirty instanceof Set) memo.dirty.add(k) } catch (e) {}
}
