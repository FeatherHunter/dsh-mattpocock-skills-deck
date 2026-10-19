// work-path-store.ts —— 工作路线的落盘存储（#1261 落地；#1083 加固成「读-合并-写」）。
//
// 每次记一笔都完整走一遍这条路：
//   读盘 → 解析（坏文件当空账，记日志）→ 按会话与票号合并 → 清 30 天以外的条目 →
//   仍超 2MB 就按时间从旧到新裁 → 隐私自检（字段白名单 + 凭证形状）→ 写临时文件再改名覆盖 →
//   最后读回一次确认能解析。
//
// 为什么每次都要重新读盘、而不是信任内存真源（#1261 的写法）：同一个工作区可能同时开着两个会话，
// 两个进程各有一份内存账。只写内存里那一份会把对方盘上刚写的记录整份盖掉；每次从盘上读、合并、
// 再写，先写后写两笔就都留在盘上（本门禁里就是「两个实例交替写，两条都在」）。代价是一笔记一次读，
// 而记一笔本来就低频。注意边界：两个进程同一瞬间各写各的仍会有一方覆盖另一方（没有文件锁），
// 但每次写都是「临时文件 + 改名」，任何时刻盘上都不会出现写了一半的坏文件；留档与重写会重新读盘，
// 下一次上报能把漏的那笔补回来。
//
// 失败一律不抛错：把所有异常收在 note() 里，回执备注由 work-path-record.ts 按 reason 写清楚。
// 换后端时旧文件改名留档（<根散列>.<旧后端>.json），新账从空开始，不把两个后端的票混在一起。
// 日志 (workRoute.write / workRoute.read) 只记原因代号与字段路径，不记被拦下的值：隐私命中时
// detail 是「$.workers[0].entries[0].title：像 GitHub 令牌」这种指路，令牌原文一个字符都不进日志。
//
// #1086 补一支释放（release）：把本会话对某张票的那一条工作条目从盘上删掉。它走同一套
// 「读盘 → 解析 → 删 → 裁剪 → 隐私自检 → 写临时文件再改名 → 读回核对」，只是把「合并新记录」
// 换成「删一条」；票本身（状态、认领人）一概不动，这是工具那边的职责，存储只碰这份存档。
// 读不出来或形状不认识时**不写盘**：宁可这次释放失败，也不能拿空账把别人的记录整份盖掉。
//
// 这份文件零 Node 导入：读写、改名、日志出口全部由调用方注入（生产是真文件系统与宿主日志，
// 门禁用临时目录与固定时钟），路径用斜杠拼接 —— Node 在 Windows 上也认斜杠。

import { chainRootHash, chainSessionShardId } from '../../shared/refresh/chain.js';
import { CHAIN_KEEP_MS, CHAIN_MAX_BYTES } from '../../shared/refresh/chain-prune.js';
import { applyNote, applyRelease, emptyLedger, ledgerToText, loadLedgerFromText, pruneLedger } from './work-path-ledger.js';
import type { RootLedger, WorkPathLedger, WorkPathNoteInput, WorkPathNoteResult, WorkPathReleaseInput, WorkPathReleaseResult } from './work-path-ledger.js';
import { privacyViolations } from './work-path-privacy.js';

export type { WorkPathLedger, WorkPathNoteInput, WorkPathNoteResult, WorkPathReleaseInput, WorkPathReleaseResult } from './work-path-ledger.js';

/** 建存储的依赖：全部可选，给什么用什么（测试一律用假零件，生产由宿主接线给真实现）。 */
export interface WorkPathStoreDeps {
  /** 用户主目录：文件落在 <home>/.dsh/mattskillsdeck/work-path/<根散列>.json。 */
  homeDir?: string;
  now?: () => number;
  /** 读整份文件：文件不存在时回 null（不是报错）；读不出来（抛错）时存储按空账继续并记日志。 */
  readFile?: (path: string) => Promise<string | null> | string | null;
  /** 写整份文件（写临时文件那一步用它）。 */
  writeFile?: (path: string, text: string) => Promise<void> | void;
  /** 建目录（要能建多层，相当于 mkdir -p）。 */
  mkdir?: (dir: string) => Promise<void> | void;
  /** 改名覆盖（临时文件 → 正式文件；换后端时旧文件 → 留档名）。不给时退化成直接写正式文件。 */
  rename?: (from: string, to: string) => Promise<void> | void;
  /** 宿主日志出口：fire(级别, 事件名, 字段)。不给就一条都不记。 */
  log?: { fire?: (level: string, event: string, fields: Record<string, unknown>) => void };
}

interface ReadResult { text: string | null; failed: boolean; }

export function createWorkPathStore(deps?: WorkPathStoreDeps) {
  const d = deps || {};
  const homeDir = typeof d.homeDir === 'string' ? d.homeDir : '';
  const now = typeof d.now === 'function' ? d.now : Date.now;
  const readFile = typeof d.readFile === 'function' ? d.readFile : function () { return null; };
  const writeFile = typeof d.writeFile === 'function' ? d.writeFile : function () { /* 无写能力：交给调用方报错 */ };
  const mkdir = typeof d.mkdir === 'function' ? d.mkdir : function () { /* 无建目录能力：同上 */ };
  const rename = typeof d.rename === 'function' ? d.rename : null;
  // 先摘出 fire 本身再调：调用方给回来的可能是个只有 fire 的对象，摘出来之后不必每次判空。
  const rawLog = d.log;
  const fire: ((level: string, event: string, fields: Record<string, unknown>) => void) | null =
    rawLog && typeof rawLog.fire === 'function' ? rawLog.fire : null;

  function hashOf(rootKey: string): string {
    try { return String(chainRootHash(rootKey)); } catch { return ''; }
  }

  /** 这份账该落在哪个文件（按工作区根散列命名，不由调用方拼）。 */
  function filePathFor(rootKey: string): string {
    return homeDir + '/.dsh/mattskillsdeck/work-path/' + hashOf(rootKey) + '.json';
  }

  function dirOf(filePath: string): string {
    const i = filePath.lastIndexOf('/');
    return i < 0 ? '.' : filePath.slice(0, i);
  }

  /** 旧后端的留档文件名：<根散列>.<旧后端>.json —— 不删、不再读，事后能翻。 */
  function legacyPathFor(filePath: string, oldBackend: string): string {
    const safe = String(oldBackend || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
    return filePath.slice(0, -5) + '.' + safe + '.json';
  }

  function countAll(ledger: RootLedger): number {
    let n = 0;
    for (const page of ledger.workers.values()) n += page.entries.size;
    return n;
  }

  /**
   * 写侧那一行日志。字段含义固定：kind 是五类之一（record/persist/readback/prune/release），ok 是这一步成没成，
   * count 视 kind 而定，why 是失败原因代号（成功空串），detail 是一句给人指的短说明。
   * detail 里只许出现字段路径与原因，不许出现被拦下的值本身 —— 隐私命中时它来自 privacyViolations[0]。
   */
  function emitWrite(kind: string, ok: boolean, action: string, count: number, sidHash: string, rootHash: string, why: string, detail: string): void {
    if (!fire) return;
    try { fire('info', 'workRoute.write', { sidHash: sidHash, rootHash: rootHash, kind: kind, ok: ok, action: action, count: count, why: why, detail: detail }); } catch { /* 日志不许影响落盘结论 */ }
  }

  /** 读侧那一行日志：只有失败才发；why 是原因代号（read-failed/bad-shape/threw），detail 同样不带原文。 */
  function emitRead(ok: boolean, sidHash: string, rootHash: string, why: string, detail: string): void {
    if (!fire) return;
    try { fire('info', 'workRoute.read', { sidHash: sidHash, rootHash: rootHash, ok: ok, why: why, detail: detail }); } catch { /* 同上 */ }
  }

  async function safeRead(file: string): Promise<ReadResult> {
    try {
      const text = await readFile(file);
      return { text: typeof text === 'string' ? text : null, failed: false };
    } catch {
      return { text: null, failed: true };
    }
  }

  /**
   * 写临时文件再改名覆盖；没注入改名能力时退化成直接写正式文件（老测试的假零件仍是这个形状）。
   * 临时文件名带上会话散列、时钟与一小段随机：同一会话连发两次上报时两趟写不会共用同一个临时文件、
   * 互相覆盖或读到对方半截内容。改名是原子的，正式文件要么是旧的整份、要么是新的整份。
   */
  async function writeAtomic(file: string, text: string, sidHash: string): Promise<void> {
    if (!rename) { await writeFile(file, text); return; }
    const tmp = file + '.' + (sidHash || 'x') + '.' + String(now()) + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
    await writeFile(tmp, text);
    await rename(tmp, file);
  }

  /**
   * 记一笔。全程不抛错：所有失败都变成 { ok:false, reason }，由调用方写进回执备注。
   * 成功时 count 是**本会话**的条数（回执里那句「在办 N 条」用的就是它）；warnings 是
   * 「这次落上了、但有件事你得知道」的备注（盘上旧文件读不出来、换了后端），由调用方拼进 notes。
   */
  async function note(input: WorkPathNoteInput): Promise<WorkPathNoteResult> {
    // 这三个先摆在外面：最外层 catch 也要能把日志补上（否则「抛错」那一行只剩结果没有原因）。
    let sidHash = '';
    let rootHash = '';
    const action = input && typeof input.action === 'string' ? input.action : '';
    try {
      const rootKey = input ? input.rootKey : '';
      const sessionId = input ? input.sessionId : '';
      const ticketKey = input ? input.ticketKey : '';
      rootHash = typeof rootKey === 'string' && rootKey !== '' ? hashOf(rootKey) : '';
      if (rootHash === '') return { ok: false, reason: 'no-root-hash' };
      if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, reason: 'no-session' };
      if (typeof ticketKey !== 'string' || ticketKey === '') return { ok: false, reason: 'no-ticket' };
      sidHash = chainSessionShardId(sessionId);
      const at = now();
      const file = filePathFor(rootKey);
      const warnings: string[] = [];

      // 一、读旧文件。读不出来或形状不认识都当空账，但要在日志与回执备注里如实说明。
      const raw = await safeRead(file);
      let ledger: RootLedger = emptyLedger();
      let readOk = true;
      let readWhy = '';
      if (raw.text !== null) {
        const loaded = loadLedgerFromText(raw.text);
        ledger = loaded.ledger;
        if (loaded.bad) { readOk = false; readWhy = 'bad-shape'; warnings.push('盘上的旧文件读不出来（形状不认识或解析失败），这次按空账重写了整份。'); }
      } else if (raw.failed) {
        readOk = false;
        readWhy = 'read-failed';
        warnings.push('盘上的旧文件这次没读出来（读文件失败），这次按空账重写了整份。');
      }
      // 读不出来也照样往下写 —— 链是一份可以重建的缓存，宁可重写整份也不能因为一份坏文件就记不上。

      // 二、换后端：旧文件改名留档，新账从空开始（不把两个后端的票混在一起）。
      const backend = input && typeof input.backend === 'string' ? input.backend : '';
      if (ledger.backend !== '' && backend !== '' && backend !== ledger.backend) {
        if (!rename) {
          emitWrite('persist', false, action, countAll(ledger), sidHash, rootHash, 'rename-unavailable', '');
          return { ok: false, reason: 'rename-unavailable' };
        }
        try {
          await rename(file, legacyPathFor(file, ledger.backend));
        } catch {
          emitWrite('persist', false, action, countAll(ledger), sidHash, rootHash, 'rename-failed', '');
          return { ok: false, reason: 'rename-failed' };
        }
        const oldBackend = ledger.backend;
        ledger = emptyLedger();
        warnings.push('工作区换了后端（' + oldBackend + ' → ' + backend + '），旧记录已改名留档，新账从空开始。');
      }

      // 三、合并 + 裁剪。清掉的条目数拿来做一条清理日志；记录事件的 ok 说的是「旧文件读得出来吗」。
      const page = applyNote(ledger, input, at);
      emitWrite('record', readOk, action, page.entries.size, sidHash, rootHash, readWhy, '');
      const pruned = pruneLedger(ledger, { at: at, keepMs: CHAIN_KEEP_MS, maxBytes: CHAIN_MAX_BYTES });
      ledger = pruned.ledger;
      if (pruned.dropped > 0) emitWrite('prune', true, action, pruned.dropped, sidHash, rootHash, '', '');

      // 四、隐私自检：字段白名单 + 凭证形状。命中就整份不写（凭证原文永远不落盘）。
      // 自检看的是「即将落盘的那份 JSON」，不是内存里的 Map 形状：Map 用 Object.keys 查不出子项，
      // 拿它自检等于什么都没查（#1083 门禁抓到过这一条，凭证会原样落盘）。
      const text = ledgerToText(ledger, at);
      const violations = privacyViolations(JSON.parse(text));
      if (violations.length > 0) {
        // detail 只记第一个违规的字段路径与原因（如「$.workers[0].entries[0].title：像 GitHub 令牌」），
        // 被拦下的值本身一个字符都不进日志 —— 这是隐私红线的下限。
        emitWrite('persist', false, action, 0, sidHash, rootHash, 'privacy', violations[0]);
        return { ok: false, reason: 'privacy' };
      }

      // 五、写临时文件再改名覆盖。
      try {
        await mkdir(dirOf(file));
        await writeAtomic(file, text, sidHash);
      } catch {
        emitWrite('persist', false, action, countAll(ledger), sidHash, rootHash, 'write-failed', '');
        return { ok: false, reason: 'write-failed' };
      }
      emitWrite('persist', true, action, countAll(ledger), sidHash, rootHash, '', '');

      // 六、读回一次确认能解析。解析不了就当这次没落上：盘上那份下次会被重写。
      const back = await safeRead(file);
      let backOk = false;
      if (back.text !== null) backOk = !loadLedgerFromText(back.text).bad;
      const backWhy = backOk ? '' : (back.failed ? 'read-failed' : 'readback-bad');
      emitWrite('readback', backOk, action, countAll(ledger), sidHash, rootHash, backWhy, '');
      if (!backOk) return { ok: false, reason: 'readback-failed' };

      // 回执里那句「在办 N 条」要用裁剪之后的数：刚清掉 30 天以前的条目时，裁剪前的数会把
      // 已经不在盘上的条目也算进去（旧实现就是在这里少数一条、多数一条都对不上）。
      const pageAfter = ledger.workers.get(sessionId);
      const sessionCount = pageAfter ? pageAfter.entries.size : 0;
      return { ok: true, ticketKey: ticketKey, count: sessionCount, warnings: warnings.length > 0 ? warnings : undefined };
    } catch (e) {
      const errName = e && typeof e === 'object' && 'name' in e ? String((e as { name?: unknown }).name || '') : '';
      emitWrite('persist', false, action, 0, sidHash, rootHash, 'threw', errName);
      return { ok: false, reason: 'threw' };
    }
  }

  /**
   * 释放（#1086）：把本会话对某张票的那一条从盘上删掉，票本身不动（状态、认领人由工具那边保证）。
   *
   * 与记一笔同一套规矩：全程不抛错、失败回 { ok:false, reason } 由回执备注写清楚；只有真删掉
   * 东西时才写盘。下面是几条特意分开的情形：
   *   - 盘上还没有这份文件：本来就没有可删的，回 removed=false（不是失败），也不写盘；
   *   - 盘上有文件但读不出来、或形状不认识：**不写盘**直接回失败 —— 读不懂就重写等于拿空账
   *     把别的会话的记录整份盖掉，宁可这次释放不成，留给下一条上报或释放重试；
   *   - 本会话本来就没这条：回 removed=false，不写盘（内存账与盘上是一致的）；
   *   - 真删掉了：清 30 天以外的条目（与记一笔同一把尺子），整份写回并读回核对。
   */
  async function release(input: WorkPathReleaseInput): Promise<WorkPathReleaseResult> {
    let sidHash = '';
    let rootHash = '';
    try {
      const rootKey = input ? input.rootKey : '';
      const sessionId = input ? input.sessionId : '';
      const ticketKey = input ? input.ticketKey : '';
      rootHash = typeof rootKey === 'string' && rootKey !== '' ? hashOf(rootKey) : '';
      if (rootHash === '') return { ok: false, reason: 'no-root-hash' };
      if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, reason: 'no-session' };
      if (typeof ticketKey !== 'string' || ticketKey === '') return { ok: false, reason: 'no-ticket' };
      sidHash = chainSessionShardId(sessionId);
      const at = now();
      const file = filePathFor(rootKey);

      // 一、读旧文件。读不出来与形状不认识都直接失败：这次不写盘，绝不拿空账去盖。
      const raw = await safeRead(file);
      if (raw.failed) {
        emitWrite('release', false, 'release', 0, sidHash, rootHash, 'read-failed', '');
        return { ok: false, reason: 'read-failed' };
      }
      if (raw.text === null) {
        emitWrite('release', true, 'release', 0, sidHash, rootHash, '', '');
        return { ok: true, ticketKey: ticketKey, removed: false, count: 0 };
      }
      const loaded = loadLedgerFromText(raw.text);
      if (loaded.bad) {
        emitWrite('release', false, 'release', 0, sidHash, rootHash, 'bad-shape', '');
        return { ok: false, reason: 'bad-shape' };
      }

      // 二、删这一条。本来就没有时直接回，不白写一次盘（内存账不需要「修正」）。
      let ledger = loaded.ledger;
      const result = applyRelease(ledger, sessionId, ticketKey);
      if (!result.removed) {
        emitWrite('release', true, 'release', result.count, sidHash, rootHash, '', '');
        return { ok: true, ticketKey: ticketKey, removed: false, count: result.count };
      }

      // 三、裁剪 + 隐私自检 + 写临时文件再改名 + 读回核对（与记一笔完全同一套）。
      const pruned = pruneLedger(ledger, { at: at, keepMs: CHAIN_KEEP_MS, maxBytes: CHAIN_MAX_BYTES });
      ledger = pruned.ledger;
      if (pruned.dropped > 0) emitWrite('prune', true, 'release', pruned.dropped, sidHash, rootHash, '', '');
      const text = ledgerToText(ledger, at);
      const violations = privacyViolations(JSON.parse(text));
      if (violations.length > 0) {
        emitWrite('persist', false, 'release', 0, sidHash, rootHash, 'privacy', violations[0]);
        return { ok: false, reason: 'privacy' };
      }
      try {
        await mkdir(dirOf(file));
        await writeAtomic(file, text, sidHash);
      } catch {
        emitWrite('persist', false, 'release', countAll(ledger), sidHash, rootHash, 'write-failed', '');
        return { ok: false, reason: 'write-failed' };
      }
      emitWrite('persist', true, 'release', countAll(ledger), sidHash, rootHash, '', '');
      const back = await safeRead(file);
      let backOk = false;
      if (back.text !== null) backOk = !loadLedgerFromText(back.text).bad;
      const backWhy = backOk ? '' : (back.failed ? 'read-failed' : 'readback-bad');
      emitWrite('readback', backOk, 'release', countAll(ledger), sidHash, rootHash, backWhy, '');
      if (!backOk) return { ok: false, reason: 'readback-failed' };
      // 剩余条数按裁剪之后算：回执备注里那句「本会话还剩 N 条」要与回执里看到的条数一致。
      const pageAfter = ledger.workers.get(sessionId);
      const left = pageAfter ? pageAfter.entries.size : 0;
      return { ok: true, ticketKey: ticketKey, removed: true, count: left };
    } catch (e) {
      const errName = e && typeof e === 'object' && 'name' in e ? String((e as { name?: unknown }).name || '') : '';
      emitWrite('persist', false, 'release', 0, sidHash, rootHash, 'threw', errName);
      return { ok: false, reason: 'threw' };
    }
  }

  /**
   * 读盘上那一份账（读出口用）。读不到、读失败、形状不认都回 null；
   * 读失败与坏形状记一条 workRoute.read（读出口失败那一行），文件不存在不算失败（第一次用）。
   * failed 把「文件不存在」与「读不出来」分开：读出口据此决定是给空表，还是如实回「这次读不出来」。
   */
  async function readSnapshotInfo(input: { rootKey?: unknown; sessionId?: unknown } | null | undefined): Promise<{ ledger: WorkPathLedger | null; failed: boolean }> {
    let rootHash = '';
    let sidHash = '';
    try {
      const rootKey = input ? String(input.rootKey || '') : '';
      const sessionId = input ? String(input.sessionId || '') : '';
      if (rootKey === '') return { ledger: null, failed: false };
      rootHash = hashOf(rootKey);
      sidHash = chainSessionShardId(sessionId);
      const raw = await safeRead(filePathFor(rootKey));
      if (raw.text === null) {
        if (raw.failed) emitRead(false, sidHash, rootHash, 'read-failed', '');
        return { ledger: null, failed: raw.failed };
      }
      const loaded = loadLedgerFromText(raw.text);
      if (loaded.bad) { emitRead(false, sidHash, rootHash, 'bad-shape', ''); return { ledger: null, failed: true }; }
      return { ledger: JSON.parse(ledgerToText(loaded.ledger, now())) as WorkPathLedger, failed: false };
    } catch {
      emitRead(false, sidHash, rootHash, 'threw', '');
      return { ledger: null, failed: true };
    }
  }

  /** 只要账本身（门禁与别处读盘用）；读失败与不存在都回 null，区分不了就问 readSnapshotInfo。 */
  async function readSnapshot(input: { rootKey?: unknown; sessionId?: unknown } | null | undefined): Promise<WorkPathLedger | null> {
    return (await readSnapshotInfo(input)).ledger;
  }

  return { note: note, release: release, readSnapshot: readSnapshot, readSnapshotInfo: readSnapshotInfo, filePathFor: filePathFor };
}

export type WorkPathStore = ReturnType<typeof createWorkPathStore>;
