// work-path-record.ts —— 工具壳成功收口处的那一步「记一笔或释放一条」（#1261 建；#1086 加释放；#1262 铺满五个写工具；#1561 起不再带回执）。
//
// 为什么单列一份而不是写进 call-shell.ts：壳文件有效行已到 321，离 350 上限只剩 29 行，
// 这一步的分支（认哪些工具、认哪些票、失败写备注）展开要五十多行，会把壳顶超标。
// 本文件除一个运行时值导入（chainTicketKey，见下）外只 import 类型；记与释放两支能力
// 由调用方以依赖注入（DeckShellDeps 的 workRouteNote / workRouteRelease）。读在办表走 deck_work_route，不在这里。
//
// 谁记、谁不记（规格 #1259 第 5、6、8 条，本票 #1262 铺满）：
//   写工具：deck_issue_report（动作 report、来源 reported）、deck_issue_create（create / auto）、
//           deck_issue_patch（edit / auto）、deck_map_plan_create（plan / auto）、deck_map_link（link / auto）。
//   读工具：deck_context、deck_issue_get、deck_issue_list、deck_map_snapshot —— 一次都不记。
//   失败、被闸推迟、参数里认不出票号的调用——不记。
//   只认 status 为 ok 的回执：partial 的回执在信封里 ok 也是 false（部分写成功不等于成功），
//   失败的票不能冒充在办，所以 partial 一律不记。#1561 起写回执里不再带在办表。
//
// 记哪几张票：规格写「按工具返回的 touched 票号」，一次调用里每个票号各一笔。
//   report 的 touched 恒为空（它写的是评论与进度，不碰票面），票号在 data.key；
//   plan 只记这一次真建出来的子票（items 里 role=child 且 status=ok 且没标 skipped）——
//     地图票是容器、不在「子票」之列；续跑时上一次已建、这一次跳过的子票也不再重记，
//     否则同一张票每续跑一次就被刷新一次动作时间，在办表会说谎；
//   同一张票重复出现只记一次（link 可能对同一张票办多件事）。
//
// 带 release=true 的上报走释放那一支（#1086；#1349 收紧）：只撤销从没实际处理过的误报，删掉本会话
// 对这张票的那一条工作条目，不记动作，票本身的状态与认领人不碰（工具只把票读回来证明它存在）。
// 建过、改过、关过、建过计划或挂过边的票不许释放，备注说明路径保留。释放处理完只留备注，
// 不再读在办表放进回执（#1561 起要看在办表就调 deck_work_route）。
//
// 输入输出的形状（与 DeckShellDeps 里 workRouteNote / workRouteRelease 那两处注释同源；读形状见 work-route.ts）：
//   note 输入 { rootKey, sessionId, sessionLabel?, backend?, ticketKey, effortId?, title?, action, source }
//        输出 { ok: true, ticketKey, count, warnings? } | { ok: false, reason }
//        warnings 是「这次落上了、但有件事要告诉人」的备注（#1083：盘上旧文件读不出来按空账重写、
//        工作区换了后端旧记录改名留档），调用方原样拼进回执 notes，不改其他格。
//   release 输入 { rootKey, sessionId, ticketKey }
//        输出 { ok: true, ticketKey, removed, count, blocked? } | { ok: false, reason }
//        其中 removed=false 表示没删：本来就不在本会话的工作路线里，或这张票干过实事
//        （blocked='has-work'，按 #1349 只许撤销误报），都不算失败。
// 其中 rootKey 是 workspace.key（工作区键），落到哪一份文件由存储按 chainRootHash 换算。
// #1561 起写回执里不再带在办表，notes 里也不再带摘要与撞车提醒，只留记不上、释放失败这类实话。
// #1352 起上报不再带 progress：工作条目不再新增这一格，旧存档里已经记下的原样保留（不回溯删除）。
//
// 标题与工作单元是锦上添花：能从这次回执里认出来就写进去，认不出就省略键——
// 存储约定传 undefined 保留上一次的值，传空串会覆盖（见 work-path-store.ts 的 note）。
//
// 票号先按链的同一套归一收一次（chainTicketKey：去 #、去前导零）：后端回执的写法并不统一，
// markdown 建票回 "01"、上报却回 "1"；不先收成同一个键，同一张票会在在办表里出现两条
// （#1262 的门禁实测：上报回 "1"、建票回 "01" 若各记各的，同一张票就占了两行）。归一后 "#01"、"01"、"1" 都记成 "1"。
// 这是本文件唯一一处运行时值导入：chain.ts 是共享纯逻辑（不碰 DOM、不碰 Node 内置模块），
// 与依赖规则门禁里登记的跨层方向一致，不新增豁免。

import { chainTicketKey } from '../../refresh/kernel/refresh-chain.js';
import type { DeckShellDeps, ShellSession, UnknownRecord } from './call-shell-types.js';

/** 一张票这次要写进工作路线的标题与工作单元；认不出就给空串，调用方据此省略键。 */
interface TicketFacts {
  title: string;
  effortId: string;
}

/** 一个写工具的登记表：动作、来源、这次写到的票号、票面信息从回执哪一处取。 */
interface WriteToolRule {
  action: string;
  source: string;
  /** 这次调用写到的票号（已归一、已去重、认不出的丢掉）。 */
  ticketKeys: (vRec: UnknownRecord) => string[];
  /** 这张票的标题与工作单元；认不出返回空串，note 时省略键。 */
  ticketFactsOf: (vRec: UnknownRecord, key: string) => TicketFacts;
}

/** 存储里标题最多留 80 字，与读出口的展示口径一致。 */
function clip(t: string): string {
  return t.slice(0, 80);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function obj(v: unknown): UnknownRecord | null {
  return (v && typeof v === 'object') ? (v as UnknownRecord) : null;
}

/** 把回执里的一串票号收成去重后的键：按链的口径归一，认不出的丢掉，顺序照回执给的顺序。 */
function normalizeKeys(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const key = chainTicketKey(list[i]);
    if (key !== '' && out.indexOf(key) < 0) out.push(key);
  }
  return out;
}

/** 大多数写工具都从 touched 取票号：本次写到的每一张票，按回执给的顺序。 */
function keysOfTouched(vRec: UnknownRecord): string[] {
  return normalizeKeys(vRec.touched);
}

/** 上报不碰票面，touched 恒空；它报的那张票在 data.key。 */
function keysOfReport(vRec: UnknownRecord): string[] {
  const data = obj(vRec.data);
  const key = data ? chainTicketKey(data.key) : '';
  return key === '' ? [] : [key];
}

/**
 * 建图只记这一次真建出来的子票：items 里 role=child、status=ok、且没标 skipped。
 * 不记地图票（规格只写「它建出的每张子票各一条」），也不记上次已建、这次跳过的子票
 * （记了会刷新它们的动作时间，续跑一次就在办表里再「动」一次）。
 */
function keysOfPlanChildren(vRec: UnknownRecord): string[] {
  const items = Array.isArray(vRec.items) ? vRec.items : [];
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const row = obj(items[i]);
    if (!row || row.role !== 'child' || row.status !== 'ok' || row.skipped === true) continue;
    const key = chainTicketKey(row.key);
    if (key !== '' && out.indexOf(key) < 0) out.push(key);
  }
  return out;
}

/** 建票与改票的回执里都有 data.ticket：key 对得上才算这张票的份，对不上就当作没这份信息。 */
function ticketFactsOfTicket(vRec: UnknownRecord, key: string): TicketFacts {
  const data = obj(vRec.data);
  const ticket = data ? obj(data.ticket) : null;
  if (!ticket || chainTicketKey(ticket.key) !== key) return { title: '', effortId: '' };
  return { title: clip(str(ticket.title)), effortId: str(ticket.effortId) };
}

/** 上报的票面信息就在 data 上（title 与 effortId 直接给，票号已在 data.key 上认过）。 */
function ticketFactsOfReport(vRec: UnknownRecord): TicketFacts {
  const data = obj(vRec.data) || {};
  return { title: clip(str(data.title)), effortId: str(data.effortId) };
}

/** 建图的回执把每张票放在 items 里，按票号找子票那一行取标题。 */
function ticketFactsOfPlanChild(vRec: UnknownRecord, key: string): TicketFacts {
  const items = Array.isArray(vRec.items) ? vRec.items : [];
  for (let i = 0; i < items.length; i++) {
    const row = obj(items[i]);
    if (!row || row.role !== 'child' || chainTicketKey(row.key) !== key) continue;
    return { title: clip(str(row.title)), effortId: '' };
  }
  return { title: '', effortId: '' };
}

/** 连边的回执里没有标题与工作单元，留空（存储会保留上一次的值，不会抹掉）。 */
function emptyTicketFacts(): TicketFacts {
  return { title: '', effortId: '' };
}

/** 五个写工具的动作类别与来源。读工具不在这张表里，所以它们走不到记一笔那一步。 */
const WRITE_TOOLS: Record<string, WriteToolRule> = {
  deck_issue_report: { action: 'report', source: 'reported', ticketKeys: keysOfReport, ticketFactsOf: ticketFactsOfReport },
  deck_issue_create: { action: 'create', source: 'auto', ticketKeys: keysOfTouched, ticketFactsOf: ticketFactsOfTicket },
  deck_issue_patch: { action: 'edit', source: 'auto', ticketKeys: keysOfTouched, ticketFactsOf: ticketFactsOfTicket },
  deck_map_plan_create: { action: 'plan', source: 'auto', ticketKeys: keysOfPlanChildren, ticketFactsOf: ticketFactsOfPlanChild },
  deck_map_link: { action: 'link', source: 'auto', ticketKeys: keysOfTouched, ticketFactsOf: emptyTicketFacts },
};

/**
 * 写工具成功收口处调一次：逐张票记一笔（上报带 release=true 时改走释放一支），不再读在办表、不写回执。
 * 不是写工具、回执不是成功（partial 也不算）、一个票号都认不出、依赖缺席，都直接返回，不碰回执；
 * 记或释放失败时，在 notes 末尾留一句实话，不抛错、不改回执其他格。
 * 要看在办表就调 deck_work_route（#1561 起写回执里不再带 data.workRoute、notes 里不再带摘要与撞车提醒）。
 */
export async function recordWorkRoute(
  deps: Pick<DeckShellDeps, 'workRouteNote' | 'workRouteRead' | 'workRouteRelease'> & { now?: () => number },
  tool: string,
  s: ShellSession,
  backendId: string,
  value: unknown,
): Promise<void> {
  const spec = WRITE_TOOLS[tool];
  if (!spec) return;
  const note = deps ? deps.workRouteNote : undefined;
  const releaseFn = deps ? deps.workRouteRelease : undefined;
  const vRec = obj(value);
  if (!vRec) return;
  // 工具交出来的 value 用 status 不用 ok（ok 是壳合并信封时才有的格）。
  // 只认 ok：规格 #1259 决定 8 把 data.workRoute 限定在 ok 回执的 data 内，决定 6 说失败不记
  // 不注入；partial 的信封 ok 是 false（只写成了一部分），按失败办，宁可这次少记也不把没写成
  // 的票冒充在办。
  if (str(vRec.status) !== 'ok') return;
  const tickets = spec.ticketKeys(vRec);
  if (tickets.length === 0) return;
  // 释放是工具 value 顶层的内部信号（信封只拷固定那几格，不会漏进回执）：只有上报会带它。
  const releaseMode = spec.action === 'report' && vRec.release === true;
  if (!Array.isArray(vRec.notes)) vRec.notes = [];
  const notes = vRec.notes as unknown[];
  if (releaseMode) {
    // 释放这一支接不上时也要说清楚：静默什么都不做会让人以为票已经释放了。
    if (typeof releaseFn !== 'function') {
      notes.push('工作路线这次没释放掉（no-release-binding）：当前装配没接上释放这一支，票的工作条目还留着。');
      return;
    }
  } else if (typeof note !== 'function') return;
  // 上面按模式各放行一支，这里把可调用形状收窄一次：TS 不会把上一个 if 里的收窄带进下面的新分支。
  const callRelease = releaseFn as NonNullable<typeof releaseFn>;
  const callNote = note as NonNullable<typeof note>;
  // 两句失败备注分开写，是为了不说假话：记这一步失败时盘上可能是旧内容，但换后端那一刻旧文件已经被
  // 改名留档、主文件这次可能根本不在；读回核对失败时盘上其实已经是这次写的新内容。原来一句
  // 「盘上还是上一次的样子」在两种情形下都不成立。逐张票写时还多一种「记了几张、剩下的没记上」，
  // 这种只说「没记全」，不谎称整次没落上。#1263 之后若要再细分，按 reason 接着加。
  const noteFailNote = function (reason: string): void {
    const tail = reason === 'readback-failed'
      ? '写下去了，但读回来核对没通过，下一次写票会重新读盘再补上。'
      : '这次没写成功；盘上可能还是旧内容（换后端时旧文件已单独留档），下一次写票会重新读盘再补上。';
    notes.push('工作路线这次没落上（' + reason + '）：' + tail + '要看在办表就调 deck_work_route。');
  };
  const partialNote = function (reason: string): void {
    notes.push('工作路线这次没记全（' + reason + '）：已经记下的不会丢，下一次写票会把缺的补上。');
  };
  // 释放失败要人知道票的工作条目还留着。
  // 读回核对失败是释放里的特例：写盘那一步已经成了，删除大概率已经落盘，这时说「条目还留着」是假话
  // （与 noteFailNote 里分两句同一个理由）。
  const releaseFailNote = function (reason: string): void {
    if (reason === 'readback-failed') {
      notes.push('工作路线这次释放没核对上（readback-failed）：删除已经写进盘里了，但写回后读回来核对没通过；下一次释放或上报会重新读盘确认。');
      return;
    }
    notes.push('工作路线这次没释放掉（' + reason + '）：这张票在本会话的工作条目还留着，下一次释放或上报会照常处理。');
  };
  const rootKey = str(s && s.workspaceKey);
  const sessionId = str(s && s.sessionId);
  let recorded = 0;
  try {
    if (releaseMode) {
      // 释放只针对上报那一张票（data.key 归一后的 tickets[0]）。工具已经把票读回来证明它存在，
      // 这里只删本会话对它的那一条工作条目，票本身的状态与认领人不碰。
      const released = (await callRelease({
        rootKey: rootKey,
        sessionId: sessionId,
        ticketKey: tickets[0],
      })) as UnknownRecord | null;
      if (!released || released.ok !== true) {
        releaseFailNote(str(released && released.reason) || 'unknown');
        return;
      }
      if (released.removed === true) {
        const left = typeof released.count === 'number' ? released.count : 0;
        notes.push('已把票 ' + tickets[0] + ' 从本会话的工作路线里释放掉（本会话还剩 ' + left + ' 条在办；票本身的状态与认领人没有改动）。');
      } else if (released.blocked === 'has-work') {
        notes.push('票 ' + tickets[0] + ' 在本会话有过实际处理（建票、改票、关票、建计划、挂边之一），按规则不能从工作路线里释放；这条路径保留。release 只用来撤销从没处理过的误报。');
      } else {
        notes.push('票 ' + tickets[0] + ' 本来就不在本会话的工作路线里，这次没有可释放的条目。');
      }
    } else {
      for (let i = 0; i < tickets.length; i++) {
        const ticketKey = tickets[i];
        const facts = spec.ticketFactsOf(vRec, ticketKey);
        const input: UnknownRecord = {
          rootKey: rootKey,
          sessionId: sessionId,
          sessionLabel: '',           // 会话标题快照由宿主侧在 workRouteNote 里按 titleFactOf 同一条取法填（取不到留空），这里传空串表示没带。
          backend: backendId,
          ticketKey: ticketKey,
          action: spec.action,
          source: spec.source,
        };
        // 认不出的标题与工作单元省略键，让存储保留上一次的值（传空串会把它抹掉）。
        if (facts.title !== '') input.title = facts.title;
        if (facts.effortId !== '') input.effortId = facts.effortId;
        const noted = (await callNote(input)) as UnknownRecord | null;
        if (!noted || noted.ok !== true) {
          if (recorded > 0) partialNote(str(noted && noted.reason) || 'unknown');
          else noteFailNote(str(noted && noted.reason) || 'unknown');
          return;
        }
        // 落上了但有件事得让人知道：把存储带回来的每一句如实拼进回执备注。一次调用可能记多张票，
        // 同一句警告（例如「盘上旧文件读不出来，按空账重写」）只说一遍，不重复刷屏。
        const warned = Array.isArray(noted.warnings) ? (noted.warnings as unknown[]) : [];
        for (let w = 0; w < warned.length; w++) {
          const text = str(warned[w]);
          if (text !== '' && notes.indexOf(text) < 0) notes.push(text);
        }
        recorded += 1;
      }
    }
  } catch {
    if (releaseMode) {
      releaseFailNote('threw');
    } else if (recorded > 0) {
      partialNote('threw');
    } else {
      noteFailNote('threw');
    }
  }
}
