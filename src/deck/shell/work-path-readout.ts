// work-path-readout.ts —— 工作路线的回执形状（#1261 落地；规格见 #1259 第 8–10 条）。
//
// 这份读出口是纯函数：输入存储快照（内存深拷贝）与「当前会话是谁、现在几点」，
// 输出回执里 data.workRoute 的对象与 notes 里那句摘要。它不读盘、不看钟——
// 盘只在存储里碰，钟只由调用方（工具壳）传进来，所以同样的快照在任何时候算
// 出来都是同一个结果，门禁可以用固定时钟钉死。
//
// 三个口径（真源见 #1259，改一个就要同步改票面与门禁）：
//   在办 = 30 天内动过；现办（active）= 24 小时内动过；撞单 = 同一票在 30 分钟内
//   被两个以上会话记过。撞单行的 sessionLabel 取该票最新那条的会话快照——
//   选「最新」是因为它代表这张票当前在谁手里，比枚举全部会话更利于接手。

import { chainSessionShardId } from '../../shared/refresh/chain.js';
import type { WorkPathLedger } from './work-path-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = DAY_MS;
const ROUTE_WINDOW_MS = 30 * DAY_MS;
const COLLISION_WINDOW_MS = 30 * 60 * 1000;
const SUMMARY_CLIP = 3;

export interface WorkPathReadoutEntry {
  ticketKey: string;
  title: string;
  sessionLabel: string;
  action: string;
  actionAt: string;
  active: boolean;
  currentSession: boolean;
  source: string;
}

export interface WorkPathReadoutCollision {
  ticketKey: string;
  sessionLabel: string;
  actionAt: string;
}

export interface WorkPathReadout {
  at: string;
  entries: WorkPathReadoutEntry[];
  staleCount: number;
  collisions?: WorkPathReadoutCollision[];
}

/** 会话快照缺席时的兜底：原始会话 id 只取散列，前 6 位拼成「会话 ××」。 */
export function workPathSessionLabel(label: string, sessionId: string): string {
  if (typeof label === 'string' && label !== '') return label;
  const shard = chainSessionShardId(String(sessionId || ''));
  return '会话 ' + String(shard).slice(0, 6);
}

interface FlatRow {
  session: string;
  label: string;
  ticketKey: string;
  title: string;
  action: string;
  actionAt: number;
  source: string;
}

export function buildWorkPathReadout(
  ledger: WorkPathLedger | null,
  opts: { sessionId: string; at: number }
): WorkPathReadout {
  const sessionId = opts ? String(opts.sessionId || '') : '';
  const at = opts && typeof opts.at === 'number' ? opts.at : Date.now();
  const rows: FlatRow[] = [];
  if (ledger && typeof ledger === 'object' && Array.isArray(ledger.workers)) {
    for (const w of ledger.workers) {
      if (!w || typeof w !== 'object' || typeof w.session !== 'string' || !Array.isArray(w.entries)) continue;
      for (const e of w.entries) {
        if (!e || typeof e !== 'object' || typeof e.ticketKey !== 'string' || e.ticketKey === '') continue;
        if (typeof e.actionAt !== 'number') continue;
        const age = at - e.actionAt;
        if (age < 0 || age > ROUTE_WINDOW_MS) continue;
        rows.push({
          session: w.session,
          label: typeof w.label === 'string' ? w.label : '',
          ticketKey: e.ticketKey,
          title: typeof e.title === 'string' ? e.title : '',
          action: typeof e.action === 'string' ? e.action : '',
          actionAt: e.actionAt,
          source: typeof e.source === 'string' ? e.source : '',
        });
      }
    }
  }
  // 排序：当前会话的排前面（接手的人先看到自己的），其余按时间倒序。
  rows.sort(function (a, b) {
    const ac = a.session === sessionId ? 0 : 1;
    const bc = b.session === sessionId ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return b.actionAt - a.actionAt;
  });
  const entries: WorkPathReadoutEntry[] = rows.map(function (r) {
    return {
      ticketKey: r.ticketKey,
      title: r.title,
      sessionLabel: workPathSessionLabel(r.label, r.session),
      action: r.action,
      actionAt: new Date(r.actionAt).toISOString(),
      active: at - r.actionAt <= ACTIVE_WINDOW_MS,
      currentSession: r.session === sessionId,
      source: r.source,
    };
  });
  const staleCount = entries.filter(function (e) { return !e.active; }).length;
  // 撞单：同一票被两个以上会话记过，且最早与最晚之间不超过 30 分钟。
  const byTicket = new Map<string, FlatRow[]>();
  for (const r of rows) {
    const list = byTicket.get(r.ticketKey);
    if (list) list.push(r);
    else byTicket.set(r.ticketKey, [r]);
  }
  const collisions: WorkPathReadoutCollision[] = [];
  for (const [ticketKey, list] of byTicket) {
    const sessions = new Set(list.map(function (r) { return r.session; }));
    if (sessions.size < 2) continue;
    let lo = list[0].actionAt;
    let hi = list[0].actionAt;
    let latest = list[0];
    for (const r of list) {
      if (r.actionAt < lo) lo = r.actionAt;
      if (r.actionAt >= hi) { hi = r.actionAt; latest = r; }
    }
    if (hi - lo > COLLISION_WINDOW_MS) continue;
    collisions.push({
      ticketKey: ticketKey,
      sessionLabel: workPathSessionLabel(latest.label, latest.session),
      actionAt: new Date(latest.actionAt).toISOString(),
    });
  }
  collisions.sort(function (a, b) { return a.ticketKey < b.ticketKey ? -1 : a.ticketKey > b.ticketKey ? 1 : 0; });
  const out: WorkPathReadout = {
    at: new Date(at).toISOString(),
    entries: entries,
    staleCount: staleCount,
  };
  if (collisions.length > 0) out.collisions = collisions;
  return out;
}

/** 摘要（一句话，进回执 notes）：没在办时回 null，调用方此时不写摘要。 */
export function buildWorkPathSummary(readout: WorkPathReadout | null): string | null {
  if (!readout || !Array.isArray(readout.entries) || readout.entries.length === 0) return null;
  const total = readout.entries.length;
  const shown = Math.min(SUMMARY_CLIP, total);
  const clip = readout.entries.slice(0, shown).map(function (e) { return '#' + e.ticketKey; }).join('、');
  let text = '工作路线摘要 · 本工作区在办 ' + total + ' 条（最近 ' + shown + ' 条：' + clip + '）';
  if (total > shown) text += '，其余 ' + (total - shown) + ' 条见 data.workRoute';
  const stale = typeof readout.staleCount === 'number' ? readout.staleCount : 0;
  if (stale > 0) text += '；其中 ' + stale + ' 条超过 1 天未动';
  return text;
}
