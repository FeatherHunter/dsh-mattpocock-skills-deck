// work-path-ledger.ts —— 工作路线账页的纯逻辑（#1083 从 work-path-store.ts 拆出来）。
//
// 为什么单列一份：落盘要回答的四件事都是纯算术 —— 盘上那份 JSON 怎么读回来、新的一条怎么合进旧账、
// 30 天与 2MB 两条线怎么裁、裁完怎么序列化回去。它们错了不会当场崩，只会静默丢记录或静默超体积，
// 所以必须能拿一张内存账反复测，不需要真文件。时间与上限都由调用方传进来，本文件不读时钟、不碰磁盘。
//
// 「读-合并-写」里的合并口径（#1259 第 12–15 条）：
//   - 先按会话分页，页内按票键去重：同一会话同一票后来居上，只留最新一条；
//   - 别的会话、别的票原样保留 —— 这是「两个存储实例交替写谁也不丢」的前提；
//   - 页面标签（会话标题快照）最近一次非空的那次为准；条目标题缺省时沿用上一条的。
//
// 留存口径（#1083 删掉了共享纯逻辑里「每会话 20 条」的硬上限）：
//   - 先说时间：超过 30 天的条目在下一次写入时清掉；
//   - 再说体积：清完仍超过 2MB 就按时间从旧到新裁，最新的一定还在。
// 体积按序列化后的 UTF-8 字节数算，不按条数估：中文标题一个字符占三字节，按字符算会低估。
// 数字与二分算法不写在这里：它们与工作路线链共用 src/shared/refresh/src/chain-prune.ts，
// 那边是 30 天/2MB 的唯一住处。本文件只负责「这种存档形状怎么序列化」。
//
// 术语边界：本文件说的「账」指工作路线存档（work-path），不是 src/host/refresh/ledger.ts 的配额账本；
// 两者不同的东西，只是都用「账」这个日常词。
//
// #1086 补一支释放（applyRelease）：只从本会话那一页删掉一条工作条目，别的会话一概不碰；
// 删空了就摘掉整页，免得盘上留下一页没条目的空会话。

import { CHAIN_KEEP_MS, CHAIN_MAX_BYTES, utf8Bytes, newestPrefixThatFits } from '../../shared/refresh/chain-prune.js';

/** 读出口只读的账页形状（深拷贝，调用方随便改都不会污染内存真源）。 */
export interface WorkPathLedger {
  v: 3;
  at: number;
  backend: string;
  workers: Array<{
    session: string;
    label: string;
    labelAt: number;
    entries: Array<{
      ticketKey: string;
      effortId: string;
      title: string;
      action: string;
      actionAt: number;
      source: string;
      /** 最近一次上报带的进度自评（0 到 100 的整数）；最近一次没带就没有这一格，不沿用旧值。 */
      progress?: number;
    }>;
  }>;
}

/** 记一笔的输入：调用方（工具壳）从回执里能拿到的就是这些。 */
export interface WorkPathNoteInput {
  /** 工作区键（workspace.key）：落到哪一份文件由存储按 chainRootHash 算，不由调用方拼。 */
  rootKey: string;
  /** 当前会话 id（原始值会落盘，但绝不进回执与日志）。 */
  sessionId: string;
  /** 会话当时的标题快照：空串表示这次没带来标题，不覆盖旧的。 */
  sessionLabel?: string;
  /** 哪条后端链：github / markdown 等；空串表示调用方没说。 */
  backend?: string;
  ticketKey: string;
  effortId?: string;
  title?: string;
  /** 这次的进度自评（0 到 100 的整数）：不带就按「这次不记进度」处理，也不沿用上一次的旧值。 */
  progress?: number;
  /** 这一次的动作类别：report（上报）等。 */
  action: string;
  /** 这条记录的来源：reported（人/AI 上报）等。 */
  source: string;
}

/** 记一笔的结果：成功带这条票与本会话条数；旧文件读不出来时另带 warnings，供回执备注说明。 */
export type WorkPathNoteResult =
  | { ok: true; ticketKey: string; count: number; warnings?: string[] }
  | { ok: false; reason: string };

/** 释放一条工作条目的输入：工作区键 + 会话 + 票键，三者缺一不可（与记一笔同一套键）。 */
export interface WorkPathReleaseInput {
  /** 工作区键（workspace.key）：落到哪一份文件由存储按 chainRootHash 算，不由调用方拼。 */
  rootKey: string;
  /** 当前会话 id：只删这个会话自己那一页里的条目，别的会话一概不碰。 */
  sessionId: string;
  /** 要释放的票键。 */
  ticketKey: string;
}

/**
 * 释放的结果。removed=false 表示这条本来就不在本会话的工作路线里（不算失败：盘上没有可删的东西），
 * count 是释放后本会话还剩几条在办；成功时票键带回，方便调用方写回执备注。
 */
export type WorkPathReleaseResult =
  | { ok: true; ticketKey: string; removed: boolean; count: number }
  | { ok: false; reason: string };

/** 内存里的一条工作条目（与盘上 v3 的 entries 同形）。 */
export interface StoredEntry {
  ticketKey: string;
  effortId: string;
  title: string;
  action: string;
  actionAt: number;
  source: string;
  progress?: number;
}

export interface WorkerPage {
  label: string;
  labelAt: number;
  entries: Map<string, StoredEntry>;
}

/** 内存账：后端名 + 按会话分的页。 */
export interface RootLedger {
  backend: string;
  workers: Map<string, WorkerPage>;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** 进度自评的合法性：只有 0 到 100 的整数才算数；盘上旧账或坏数据读到别的值就当没有。 */
export function validProgress(v: unknown): number | undefined {
  return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 100) ? v : undefined;
}

export function emptyLedger(): RootLedger {
  return { backend: '', workers: new Map() };
}

/**
 * 盘上那份 JSON → 内存账。
 *
 * 返回 bad=true 的两种情况（都由调用方记日志并把账当空）：JSON 解析失败、形状不认识（版本不是 3、
 * workers 不是数组）。**条目级的坏数据不弄脏整份**：某一条字段不认就跳过那一条，别的照收 ——
 * 这是内部缓存，读回半条比整份空掉更接近真实。
 */
export function loadLedgerFromText(text: string): { ledger: RootLedger; bad: boolean } {
  const ledger = emptyLedger();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ledger, bad: true };
  }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== 3 || !Array.isArray(parsed.workers)) return { ledger, bad: true };
  if (typeof parsed.backend === 'string') ledger.backend = parsed.backend;
  for (const w of parsed.workers) {
    if (!w || typeof w !== 'object' || !isNonEmptyString(w.session) || !Array.isArray(w.entries)) continue;
    const page: WorkerPage = {
      label: typeof w.label === 'string' ? w.label : '',
      labelAt: typeof w.labelAt === 'number' ? w.labelAt : 0,
      entries: new Map(),
    };
    for (const e of w.entries) {
      if (!e || typeof e !== 'object' || !isNonEmptyString(e.ticketKey)) continue;
      const entry: StoredEntry = {
        ticketKey: e.ticketKey,
        effortId: typeof e.effortId === 'string' ? e.effortId : '',
        title: typeof e.title === 'string' ? e.title : '',
        action: typeof e.action === 'string' ? e.action : '',
        actionAt: typeof e.actionAt === 'number' ? e.actionAt : 0,
        source: typeof e.source === 'string' ? e.source : '',
      };
      const loadedProgress = validProgress(e.progress);
      if (loadedProgress !== undefined) entry.progress = loadedProgress;
      page.entries.set(e.ticketKey, entry);
    }
    ledger.workers.set(w.session, page);
  }
  return { ledger, bad: false };
}

/** 把一条新记录合进账（就地改，账是刚从盘上读出来的、本函数独占的那一份）。返回这一条所在的页。 */
export function applyNote(ledger: RootLedger, input: WorkPathNoteInput, at: number): WorkerPage {
  const backend = input && typeof input.backend === 'string' ? input.backend : '';
  if (backend !== '') ledger.backend = backend;
  let page = ledger.workers.get(input.sessionId);
  if (!page) {
    page = { label: '', labelAt: 0, entries: new Map() };
    ledger.workers.set(input.sessionId, page);
  }
  const label = input && typeof input.sessionLabel === 'string' ? input.sessionLabel : '';
  if (label !== '') {
    page.label = label;
    page.labelAt = at;
  }
  const prev = page.entries.get(input.ticketKey);
  const progress = validProgress(input ? input.progress : undefined);
  const entry: StoredEntry = {
    ticketKey: input.ticketKey,
    effortId: input && typeof input.effortId === 'string' ? input.effortId : (prev ? prev.effortId : ''),
    title: input && typeof input.title === 'string' ? input.title : (prev ? prev.title : ''),
    action: input && typeof input.action === 'string' ? input.action : (prev ? prev.action : ''),
    actionAt: at,
    source: input && typeof input.source === 'string' ? input.source : (prev ? prev.source : ''),
  };
  if (progress !== undefined) entry.progress = progress;
  page.entries.set(input.ticketKey, entry);
  return page;
}

/**
 * 把本会话对某张票的那一条从账里删掉（就地改，账是刚从盘上读出来的、本函数独占的那一份）。
 *
 * 只动这一个会话的页：别的会话、别的票原样保留。删到本会话一条不剩时把整页摘掉，
 * 盘上不会留下一页空会话。返回 removed=false 表示本来就不在（不算错），count 是删完还剩几条。
 */
export function applyRelease(ledger: RootLedger, sessionId: string, ticketKey: string): { removed: boolean; count: number } {
  const page = ledger.workers.get(sessionId);
  if (!page) return { removed: false, count: 0 };
  const removed = page.entries.delete(ticketKey);
  const count = page.entries.size;
  if (count === 0) ledger.workers.delete(sessionId);
  return { removed: removed, count: count };
}

/** 序列化成盘上形状（v3：版本、写盘时间、后端、按会话分的页）。 */
export function ledgerToText(ledger: RootLedger, at: number): string {
  const out: WorkPathLedger = { v: 3, at: at, backend: ledger.backend, workers: [] };
  for (const [session, page] of ledger.workers) {
    const entries: WorkPathLedger['workers'][number]['entries'] = [];
    for (const row of page.entries.values()) {
      const outEntry: WorkPathLedger['workers'][number]['entries'][number] = {
        ticketKey: row.ticketKey,
        effortId: row.effortId,
        title: row.title,
        action: row.action,
        actionAt: row.actionAt,
        source: row.source,
      };
      if (row.progress !== undefined) outEntry.progress = row.progress;
      entries.push(outEntry);
    }
    out.workers.push({ session: session, label: page.label, labelAt: page.labelAt, entries: entries });
  }
  return JSON.stringify(out);
}

/** 序列化后的字节数（2MB 那条线的判据）。 */
export function ledgerBytes(ledger: RootLedger, at: number): number {
  return utf8Bytes(ledgerToText(ledger, at));
}

interface FlatEntry {
  session: string;
  key: string;
  entry: StoredEntry;
}

/** 按给定的一组条目重新组账（保留原账的页顺序，条目只取进 kept 的那些）。 */
function rebuildLedger(ledger: RootLedger, kept: Set<string>): RootLedger {
  const out = emptyLedger();
  out.backend = ledger.backend;
  for (const [session, page] of ledger.workers) {
    const entries = new Map<string, StoredEntry>();
    for (const [key, entry] of page.entries) if (kept.has(session + '\0' + key)) entries.set(key, entry);
    if (entries.size > 0) out.workers.set(session, { label: page.label, labelAt: page.labelAt, entries: entries });
  }
  return out;
}

/** 把「时间倒序里最旧的那一截」裁掉：二分找按时间倒序最多能留下多少条，取体积放得下的最大前缀（二分住 chain-prune.ts）。 */
function trimToBytes(ledger: RootLedger, maxBytes: number, at: number): { ledger: RootLedger; dropped: number } {
  const flat: FlatEntry[] = [];
  for (const [session, page] of ledger.workers) for (const [key, entry] of page.entries) flat.push({ session: session, key: key, entry: entry });
  flat.sort((a, b) => b.entry.actionAt - a.entry.actionAt);
  const build = function (count: number): RootLedger {
    const out = emptyLedger();
    out.backend = ledger.backend;
    for (let i = 0; i < count; i++) {
      const row = flat[i];
      let page = out.workers.get(row.session);
      if (!page) { page = { label: '', labelAt: 0, entries: new Map() }; out.workers.set(row.session, page); }
      page.entries.set(row.key, row.entry);
    }
    // 页标签取自原账（标签属于会话，不属于某一条）。
    for (const [session, page] of out.workers) {
      const src = ledger.workers.get(session);
      if (src) { page.label = src.label; page.labelAt = src.labelAt; }
    }
    return out;
  };
  const kept = newestPrefixThatFits(flat.length, function (count: number): number { return ledgerBytes(build(count), at); }, maxBytes);
  if (kept === flat.length) return { ledger: ledger, dropped: 0 };
  return { ledger: build(kept), dropped: flat.length - kept };
}

/**
 * 落盘前的留存裁剪：先清 30 天以外的条目，再按 2MB 从最旧的开始裁。
 *
 * dropped 是两步一共丢了多少条（调用方拿它决定要不要记一条清理日志）。
 */
export function pruneLedger(ledger: RootLedger, opts?: { at?: number; keepMs?: number; maxBytes?: number }): { ledger: RootLedger; dropped: number } {
  const rawAt = opts ? opts.at : 0;
  const at = typeof rawAt === 'number' && isFinite(rawAt) ? Math.floor(rawAt) : 0;
  const rawKeep = opts ? opts.keepMs : undefined;
  const keepMs = typeof rawKeep === 'number' && isFinite(rawKeep) && rawKeep >= 0 ? rawKeep : CHAIN_KEEP_MS;
  const rawMax = opts ? opts.maxBytes : undefined;
  const maxBytes = typeof rawMax === 'number' && isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : CHAIN_MAX_BYTES;
  const cutoff = at - keepMs;
  let before = 0;
  let keptCount = 0;
  const kept = new Set<string>();
  for (const [session, page] of ledger.workers) {
    for (const [key, entry] of page.entries) {
      before += 1;
      if (entry.actionAt < cutoff) continue;
      kept.add(session + '\0' + key);
      keptCount += 1;
    }
  }
  const timeTrimmed = rebuildLedger(ledger, kept);
  const sizeTrimmed = trimToBytes(timeTrimmed, maxBytes, at);
  return { ledger: sizeTrimmed.ledger, dropped: before - keptCount + sizeTrimmed.dropped };
}
