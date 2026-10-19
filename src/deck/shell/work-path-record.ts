// work-path-record.ts —— 工具壳成功收口处的那一步「记一笔或释放一条，再带回执」（#1261 建；#1086 加释放）。
//
// 为什么单列一份而不是写进 call-shell.ts：壳文件有效行已到 321，离 350 上限只剩 29 行，
// 这一步的分支（只记上报、缺依赖跳过、失败写备注）展开要三十多行，会把壳顶超标。
// 本文件只 import type（借形状），运行时不引任何东西——与壳头注释那条
// 「运行时只从构造函数拿」的规矩一致：记、读、释放三支能力都由调用方以依赖注入。
//
// 输入输出的形状（与 DeckShellDeps 里 workRouteNote / workRouteRead / workRouteRelease 那三处注释同源）：
//   note 输入 { rootKey, sessionId, sessionLabel?, backend?, ticketKey, effortId?, title?, progress?, action, source }
//        输出 { ok: true, ticketKey, count, warnings? } | { ok: false, reason }
//        warnings 是「这次落上了、但有件事要告诉人」的备注（#1083：盘上旧文件读不出来按空账重写、
//        工作区换了后端旧记录改名留档），调用方原样拼进回执 notes，不改其他格。
//   read 输入 { sessionId, rootKey, at }
//        输出 { ok: true, readout, summary } | { ok: false, reason }
//   release 输入 { rootKey, sessionId, ticketKey }
//        输出 { ok: true, ticketKey, removed, count } | { ok: false, reason }
//        其中 removed=false 表示这条本来就不在本会话的工作路线里，不算失败。
// 其中 rootKey 是 workspace.key（工作区键），落到哪一份文件由存储按 chainRootHash 换算。
// 其中 readout 就是回执里 data.workRoute 的对象，summary 是 notes 里那句摘要（没有在办时为 null）。
// 其中 progress 是这次上报的进度自评（0 到 100 的整数），只有 deck_issue_report 会带；
// 不传时存储按「没带」处理，条目上就不出这一格。
//
// 带 release=true 的上报走释放那一支（#1086）：只删本会话对这张票的那一条工作条目，不记动作，
// 票本身的状态与认领人不碰（工具只把票读回来证明它存在）；释放成功之后照样读一遍在办表放进回执，
// 所以回执形状与正常上报一致，data.workRoute 照旧带出。

import type { DeckShellDeps, ShellSession, UnknownRecord } from './call-shell-types.js';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * 上报成功收口处调一次：记一笔（或释放一条）→ 读在办表 → 写进回执。
 * 只认 deck_issue_report 的成功回执，其余工具、失败回执、无票键回执一律直接返回；
 * 任一步失败时，在 notes 末尾留一句「这次没落上 / 没释放掉」，不抛错、不改回执其他格。
 */
export async function recordWorkRoute(
  deps: Pick<DeckShellDeps, 'workRouteNote' | 'workRouteRead' | 'workRouteRelease'> & { now?: () => number },
  tool: string,
  s: ShellSession,
  backendId: string,
  value: unknown,
): Promise<void> {
  if (tool !== 'deck_issue_report') return;
  const note = deps ? deps.workRouteNote : undefined;
  const read = deps ? deps.workRouteRead : undefined;
  const releaseFn = deps ? deps.workRouteRelease : undefined;
  const vRec = (value && typeof value === 'object') ? (value as UnknownRecord) : null;
  // 工具交出来的 value 用 status 不用 ok（ok 是壳合并信封时才有的格）：只认 status === 'ok'。
  if (!vRec || (vRec as UnknownRecord).status !== 'ok') return;
  const data = (vRec.data && typeof vRec.data === 'object') ? (vRec.data as UnknownRecord) : null;
  const key = data ? str(data.key) : '';
  if (key === '') return;
  // 释放是工具 value 顶层的内部信号（信封只拷固定那几格，不会漏进回执）。
  const releaseMode = (vRec as UnknownRecord).release === true;
  if (!Array.isArray(vRec.notes)) vRec.notes = [];
  const notes = vRec.notes as unknown[];
  if (releaseMode) {
    // 释放这一支接不上时也要说清楚：静默什么都不做会让人以为票已经释放了。
    if (typeof releaseFn !== 'function') {
      notes.push('工作路线这次没释放掉（no-release-binding）：当前装配没接上释放这一支，票的工作条目还留着。');
      return;
    }
  } else if (typeof note !== 'function') return;
  if (typeof read !== 'function') {
    // 读这一支缺席时也要说一声：否则回执安静地缺 data.workRoute，看不出是装配问题还是这次没读到。
    notes.push('工作路线这次带不出在办表（no-read-binding）：当前装配没接上读这一支，回执里缺 data.workRoute 这一格。');
    return;
  }
  // 上面按模式各放行一支，这里把三支的可调用形状收窄一次：TS 不会把上一个 if 里的收窄带进下面的新分支。
  const callRelease = releaseFn as NonNullable<typeof releaseFn>;
  const callNote = note as NonNullable<typeof note>;
  const callRead = read as NonNullable<typeof read>;
  // 工具已经校验过 0 到 100，这里只认数字；缺席时存储按「这次没带进度」处理（不沿用旧值）。
  const progress = (data && typeof data.progress === 'number') ? data.progress : undefined;
  // 两句失败备注分开写，是为了不说假话：记这一步失败时盘上可能是旧内容，但换后端那一刻旧文件已经被
  // 改名留档、主文件这次可能根本不在；读回核对失败时盘上其实已经是这次写的新内容。原来一句
  // 「盘上还是上一次的样子」在两种情形下都不成立。#1263 之后若要再细分，按 reason 接着加。
  const noteFailNote = function (reason: string): void {
    const tail = reason === 'readback-failed'
      ? '写下去了，但读回来核对没通过，下次上报会重新读盘再补上。'
      : '这次没写成功；盘上可能还是旧内容（换后端时旧文件已单独留档），下次上报会重新读盘再补上。';
    notes.push('工作路线这次没落上（' + reason + '）：在办表这次没带出来，' + tail);
  };
  const readFailNote = function (reason: string): void {
    notes.push('工作路线这次读不出来（' + reason + '）：在办表这次没带出来，下次上报会重新读盘再试。');
  };
  // 释放失败与「带不出在办表」分开说：前者要人知道票的工作条目还留着，后者说的是释放已经生效、只缺回执那一格。
  // 读回核对失败是释放里的特例：写盘那一步已经成了，删除大概率已经落盘，这时说「条目还留着」是假话
  // （与 noteFailNote 里分两句同一个理由）。
  const releaseFailNote = function (reason: string): void {
    if (reason === 'readback-failed') {
      notes.push('工作路线这次释放没核对上（readback-failed）：删除已经写进盘里了，但写回后读回来核对没通过；回执这次没带出在办表，下一次释放或上报会重新读盘确认。');
      return;
    }
    notes.push('工作路线这次没释放掉（' + reason + '）：这张票在本会话的工作条目还留着，下一次释放或上报会照常处理。');
  };
  const releaseReadFailNote = function (reason: string): void {
    notes.push('工作路线这次带不出在办表（' + reason + '）：释放已经处理，只是回执里缺 data.workRoute 这一格。');
  };
  const clock = deps && typeof deps.now === 'function' ? deps.now : Date.now;
  if (releaseMode) {
    let released: UnknownRecord | null = null;
    try {
      released = (await callRelease({
        rootKey: str(s && s.workspaceKey),
        sessionId: str(s && s.sessionId),
        ticketKey: key,
      })) as UnknownRecord | null;
    } catch {
      releaseFailNote('threw');
      return;
    }
    if (!released || released.ok !== true) {
      releaseFailNote(str(released && released.reason) || 'unknown');
      return;
    }
    if (released.removed === true) {
      const left = typeof released.count === 'number' ? released.count : 0;
      notes.push('已把票 ' + key + ' 从本会话的工作路线里释放掉（本会话还剩 ' + left + ' 条在办；票本身的状态与认领人没有改动）。');
    } else {
      notes.push('票 ' + key + ' 本来就不在本会话的工作路线里，这次没有可释放的条目。');
    }
  } else {
    let noted: UnknownRecord | null = null;
    try {
      // 动作固定 report，来源固定 reported；会话标题快照归 #1263，这里传空。
      noted = (await callNote({
        rootKey: str(s && s.workspaceKey),
        sessionId: str(s && s.sessionId),
        sessionLabel: '',
        backend: backendId,
        ticketKey: key,
        effortId: data ? str(data.effortId) : '',
        title: data ? str(data.title).slice(0, 80) : '',
        ...(progress !== undefined ? { progress: progress } : {}),
        action: 'report',
        source: 'reported',
      })) as UnknownRecord | null;
    } catch {
      noteFailNote('threw');
      return;
    }
    if (!noted || noted.ok !== true) {
      noteFailNote(str(noted && noted.reason) || 'unknown');
      return;
    }
    // 落上了但有件事得让人知道：把存储带回来的每一句如实拼进回执备注。
    const warned = Array.isArray(noted.warnings) ? (noted.warnings as unknown[]) : [];
    for (const w of warned) {
      const text = str(w);
      if (text !== '') notes.push(text);
    }
  }
  let ro: UnknownRecord | null = null;
  try {
    ro = (await callRead({
      sessionId: str(s && s.sessionId),
      rootKey: str(s && s.workspaceKey),
      at: clock(),
    })) as UnknownRecord | null;
  } catch {
    if (releaseMode) releaseReadFailNote('threw');
    else readFailNote('threw');
    return;
  }
  const readout = ro ? ro.readout : null;
  if (!ro || ro.ok !== true || !readout || typeof readout !== 'object') {
    const reason = str(ro && (ro as UnknownRecord).reason) || 'read-failed';
    if (releaseMode) releaseReadFailNote(reason);
    else readFailNote(reason);
    return;
  }
  (data as UnknownRecord).workRoute = readout;
  const summary = str(ro.summary);
  if (summary !== '') notes.push(summary);
}
