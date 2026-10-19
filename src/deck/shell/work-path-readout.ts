// work-path-readout.ts —— 工作路线的回执形状（#1261 落地；规格见 #1259 第 8–10 条）。
//
// 这份读出口是纯函数：输入存储快照（内存深拷贝）与「当前会话是谁、现在几点」，
// 输出回执里 data.workRoute 的对象与 notes 里那句摘要。它不读盘、不看钟——
// 盘只在存储里碰，钟只由调用方（工具壳）传进来，所以同样的快照在任何时候算
// 出来都是同一个结果，门禁可以用固定时钟钉死。
//
// 三个口径（真源见 #1259，改一个就要同步改票面与门禁）：
//   在办 = 30 天内动过；现办（active）= 24 小时内动过；撞单 = 当前会话写过的票，
//   在前后 30 分钟内被另一个会话也记过。撞单行给的是「另一个会话」：票号、它的会话标识、
//   它记的时间——当前会话自己不出现在撞单行里（它就是收到回执的这一方，报自己等于没提示）。
//   判断按「与当前会话某一笔的间隔」算，不按最早—最晚总跨度：A=0、B=20、C=35 分钟时，
//   B 与 C 只差 15 分钟，该报；总跨度从 A 到 C 是 35 分钟，按跨度会把整票漏掉。
//
// 工作条目可选带 0 到 100 的进度自评（#1084）：原来的八格之外多一格 progress，
// 只作展示、不参与判定；最近一次上报没带就不出这一格。合法性的唯一真源是
// work-path-ledger.ts 的 validProgress，这里与盘上、工具参数校验共用同一把尺子。

import { chainSessionShardId } from '../../shared/refresh/chain.js';
import { validProgress } from './work-path-ledger.js';
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
  /** 最近一次上报带的进度自评（0 到 100 的整数）；最近一次没带就没有这一格。 */
  progress?: number;
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
  progress?: number;
}

// 进度自评的合法性判据唯一真源是 work-path-ledger.ts 的 validProgress（与盘上同一把尺子）：
// 只认 0 到 100 的整数，别的值（旧账、坏数据）当没有，不往回执里带。

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
          progress: validProgress(e.progress),
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
    const entry: WorkPathReadoutEntry = {
      ticketKey: r.ticketKey,
      title: r.title,
      sessionLabel: workPathSessionLabel(r.label, r.session),
      action: r.action,
      actionAt: new Date(r.actionAt).toISOString(),
      active: at - r.actionAt <= ACTIVE_WINDOW_MS,
      currentSession: r.session === sessionId,
      source: r.source,
    };
    if (r.progress !== undefined) entry.progress = r.progress;
    return entry;
  });
  const staleCount = entries.filter(function (e) { return !e.active; }).length;
  // 撞单：只看当前会话写过的那几张票——撞单是「我这张票可能有人在同时改」的提示，
  // 别的会话之间怎么撞不是这份回执要回答的事。每张票、每个别的会话只报一行：
  // 取那个会话里离当前会话某一笔最近的一笔（时间也是它记的时间），间隔不超过 30 分钟才算。
  const currentRows = new Map<string, FlatRow[]>();
  const otherRows = new Map<string, Map<string, FlatRow[]>>();
  for (const r of rows) {
    if (r.session === sessionId) {
      const mine = currentRows.get(r.ticketKey);
      if (mine) mine.push(r);
      else currentRows.set(r.ticketKey, [r]);
      continue;
    }
    let bySession = otherRows.get(r.ticketKey);
    if (!bySession) { bySession = new Map<string, FlatRow[]>(); otherRows.set(r.ticketKey, bySession); }
    const theirs = bySession.get(r.session);
    if (theirs) theirs.push(r);
    else bySession.set(r.session, [r]);
  }
  const collisions: WorkPathReadoutCollision[] = [];
  for (const [ticketKey, mine] of currentRows) {
    const bySession = otherRows.get(ticketKey);
    if (!bySession) continue;
    for (const [otherSession, theirs] of bySession) {
      let best: FlatRow | null = null;
      let bestGap = Number.POSITIVE_INFINITY;
      for (const row of theirs) {
        for (const m of mine) {
          const gap = Math.abs(row.actionAt - m.actionAt);
          if (gap < bestGap) { bestGap = gap; best = row; }
        }
      }
      if (!best || bestGap > COLLISION_WINDOW_MS) continue;
      collisions.push({
        ticketKey: ticketKey,
        sessionLabel: workPathSessionLabel(best.label, otherSession),
        actionAt: new Date(best.actionAt).toISOString(),
      });
    }
  }
  collisions.sort(function (a, b) {
    if (a.ticketKey !== b.ticketKey) return a.ticketKey < b.ticketKey ? -1 : 1;
    return a.actionAt < b.actionAt ? -1 : a.actionAt > b.actionAt ? 1 : 0;
  });
  const out: WorkPathReadout = {
    at: new Date(at).toISOString(),
    entries: entries,
    staleCount: staleCount,
  };
  if (collisions.length > 0) out.collisions = collisions;
  return out;
}

/** 撞车提醒（一句话，进回执 notes，紧跟在摘要后面）：只有同一张票在 30 分钟内被另一个会话也记过时才有内容，没有撞车回 null，调用方此时不写提醒。
 *
 * 为什么单列一句：摘要里按约定不写钟点，人看到摘要不知道撞车是哪一次；这句只用读出口已经算好的
 * collisions（票号、对面会话标签、对面记下的时间），不另读盘。提醒只管让人看见，不拦操作。
 */
export function buildWorkPathCollisionNote(readout: WorkPathReadout | null): string | null {
  if (!readout || !Array.isArray((readout as any).collisions)) return null;
  const hits = (readout as any).collisions as Array<{ ticketKey?: unknown; sessionLabel?: unknown; actionAt?: unknown }>;
  if (hits.length === 0) return null;
  const items: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const key = String(hits[i] && hits[i].ticketKey !== undefined ? (hits[i] as any).ticketKey : '');
    const label = String(hits[i] && hits[i].sessionLabel !== undefined ? (hits[i] as any).sessionLabel : '');
    const at = String(hits[i] && hits[i].actionAt !== undefined ? (hits[i] as any).actionAt : '');
    if (key === '' || label === '' || at === '') continue;
    items.push('票 #' + key + ' 在 30 分钟内也被 ' + label + ' 记过（它记在 ' + at + '）');
  }
  if (items.length === 0) return null;
  return '撞车提醒 · ' + items.join('；') + '，这次写仍然成功，票的状态没有变。';
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
