// src/deck/tools/tracker-session-adapt.ts —— 把 Tracker 会话包成旧调用壳认得的后端门面（#1611 拆出处）。
//
// 为什么单独成一份：#1611 修文件粒度门禁时，tracker-session.ts 到了 351 有效行（上限 350）。
// 那份文件里的「打开会话」与「跑一次调用」是两条主流程，而这里只是给管线执行层的结果换一个错误档位，
// 与两条主流程无关；搬出来之后 tracker-session.ts 回到阈值以内，这一段也更容易单独读。
//
// 为什么需要这层适配：房间抛出的错会被管线收成 env（见 src/tracker/contract/ 的错误档位），
// 而旧调用壳（src/deck/shell/call-shell.ts）只认 backend-threw 这一档。适配层把每个操作的 env
// 改写成 backend-threw，让管线与旧壳的口径对齐；方法名与旧壳 withCallScope 要的那十五条一一对应，
// 名单多一条少一条都会让某个工具在调用时拿不到实现，所以要改就跟着壳一起改。
import type { TrackerSession } from '../../tracker/session/open-tracker.js'

/** 未知形状的记录（会话壳没标类型，用到哪格验哪格，不猜）。 */
type UnknownRecord = Record<string, unknown>
/** 字符串兜底（与壳里同名函数同算法，壳没把它导出，各文件自带一份是仓里既有写法）。 */
function str(v: unknown): string { return (typeof v === 'string') ? v : '' }

/** 管线执行层失败（房间抛错被管线收成 env）与旧口径的对照：旧壳认 backend-threw 才抛，这里改写一格再交出去。 */
const ADAPT_OPS = ['get', 'list', 'listMaps', 'getDependencies', 'create', 'setParent', 'setBlockedBy', 'preflight', 'getRepoPermissions', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees'];
/** 把会话包成预算壳认得的后端门面：方法名与 withCallScope 要的那十五条对齐，env 改写成 backend-threw。 */
export function adaptSession(session: TrackerSession): UnknownRecord {
  const room = (session || {}) as unknown as UnknownRecord;
  const out: UnknownRecord = {};
  for (const name of ADAPT_OPS) {
    out[name] = async function (...args: unknown[]): Promise<unknown> {
      const fn = room[name] as ((...a: unknown[]) => Promise<unknown>) | undefined;
      // listMaps 是第一条允许退化的操作：房间没有它（手造桩或极老的会话形状）不算执行层失败，
      // 调用方拿 unsupported 照老路走；其余操作的缺席仍是抛错（调用方按 backend-threw 处理）。
      if (typeof fn !== 'function') {
        if (name === 'listMaps') return { ok: false, error: { kind: 'unsupported', message: '这个后端没有地图薄行，按老路取' } };
        throw new Error('这次没拿到后端实现，我没往下做。');
      }
      const got = (await fn(...args)) as UnknownRecord | null;
      const err = (got && got.ok === false) ? (got.error || null) as UnknownRecord | null : null;
      if (err && str(err.kind) === 'env') return { ok: false, error: { kind: 'backend-threw', message: str(err.message) || '执行层没回来' } };
      return got;
    };
  }
  return out;
}
