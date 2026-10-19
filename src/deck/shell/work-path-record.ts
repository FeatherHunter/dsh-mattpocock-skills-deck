// work-path-record.ts —— 工具壳成功收口处的那一步「记一笔并带回执」（#1261 起步，#1262 铺满五个写工具）。
//
// 为什么单列一份而不是写进 call-shell.ts：壳文件有效行已到 327（总行 481），离 350 上限只剩 23 行，
// 这一步的分支（认哪些工具、认哪些票、失败写备注）展开要五十多行，会把壳顶超标。
// 本文件除一个运行时值导入（chainTicketKey，见下）外只 import 类型；记与读两支能力
// 都由调用方以依赖注入（DeckShellDeps 的 workRouteNote / workRouteRead）。
//
// 谁记、谁不记（规格 #1259 第 5、6、8 条，本票 #1262 铺满）：
//   写工具：deck_issue_report（动作 report、来源 reported）、deck_issue_create（create / auto）、
//           deck_issue_patch（edit / auto）、deck_map_plan_create（plan / auto）、deck_map_link（link / auto）。
//   读工具：deck_context、deck_issue_get、deck_issue_list、deck_map_snapshot —— 一次都不记。
//   失败、被闸推迟、参数里认不出票号的调用——不记，回执里也不带 data.workRoute。
//   只认 status 为 ok 的回执：partial 的回执在信封里 ok 也是 false（部分写成功不等于成功），
//   规格把 data.workRoute 限定在 ok 回执的 data 内，失败的票不能冒充在办，所以 partial 一律不记。
//
// 记哪几张票：规格写「按工具返回的 touched 票号」，一次调用里每个票号各一笔。
//   report 的 touched 恒为空（它写的是评论与进度，不碰票面），票号在 data.key；
//   plan 只记这一次真建出来的子票（items 里 role=child 且 status=ok 且没标 skipped）——
//     地图票是容器、不在「子票」之列；续跑时上一次已建、这一次跳过的子票也不再重记，
//     否则同一张票每续跑一次就被刷新一次动作时间，在办表会说谎；
//   同一张票重复出现只记一次（link 可能对同一张票办多件事）。
//
// 输入输出的形状（与 DeckShellDeps 里 workRouteNote / workRouteRead 那两处注释同源）：
//   note 输入 { rootKey, sessionId, sessionLabel?, backend?, ticketKey, effortId?, title?, action, source }
//        输出 { ok: true, ticketKey, count } | { ok: false, reason }
//   read 输入 { sessionId, rootKey, at }
//        输出 { ok: true, readout, summary } | { ok: false, reason }
// 其中 rootKey 是 workspace.key（工作区键），落到哪一份文件由存储按 chainRootHash 换算。
// 其中 readout 就是回执里 data.workRoute 的对象，summary 是 notes 里那句摘要（没有在办时为 null）。
//
// 标题与工作单元是锦上添花：能从这次回执里认出来就写进去，认不出就省略键——
// 存储约定传 undefined 保留上一次的值，传空串会覆盖（见 work-path-store.ts 的 note）。
//
// 票号先按链的同一套归一收一次（chainTicketKey：去 #、去前导零）：后端回执的写法并不统一，
// markdown 建票回 "01"、上报却回 "1"；不先收成同一个键，同一张票会在在办表里出现两条
// （#1262 的门禁实测：上报回 "1"、建票回 "01" 若各记各的，同一张票就占了两行）。归一后 "#01"、"01"、"1" 都记成 "1"。
// 这是本文件唯一一处运行时值导入：chain.ts 是共享纯逻辑（不碰 DOM、不碰 Node 内置模块），
// 与依赖规则门禁里登记的跨层方向一致，不新增豁免。

import { chainTicketKey } from '../../shared/refresh/chain.js';
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
 * 写工具成功收口处调一次：逐张票记一笔 → 读在办表 → 写进回执。
 * 不是写工具、回执不是成功（partial 也不算）、一个票号都认不出、依赖缺席，都直接返回，不碰回执；
 * 记或读任一步失败时，在 notes 末尾留一句实话，不抛错、不改回执其他格。
 */
export async function noteWorkRoute(
  deps: Pick<DeckShellDeps, 'workRouteNote' | 'workRouteRead'> & { now?: () => number },
  tool: string,
  s: ShellSession,
  backendId: string,
  value: unknown,
): Promise<void> {
  const spec = WRITE_TOOLS[tool];
  if (!spec) return;
  const note = deps ? deps.workRouteNote : undefined;
  const read = deps ? deps.workRouteRead : undefined;
  if (typeof note !== 'function' || typeof read !== 'function') return;
  const vRec = obj(value);
  if (!vRec) return;
  // 工具交出来的 value 用 status 不用 ok（ok 是壳合并信封时才有的格）。
  // 只认 ok：规格 #1259 决定 8 把 data.workRoute 限定在 ok 回执的 data 内，决定 6 说失败不记
  // 不注入；partial 的信封 ok 是 false（只写成了一部分），按失败办，宁可这次少记也不把没写成
  // 的票冒充在办。
  if (str(vRec.status) !== 'ok') return;
  if (!Array.isArray(vRec.notes)) vRec.notes = [];
  const notes = vRec.notes as unknown[];
  const tickets = spec.ticketKeys(vRec);
  if (tickets.length === 0) return;
  let recorded = 0;
  let phase = 'write';
  const writeFailNote = function (reason: string): void {
    if (recorded > 0) notes.push('工作路线这次没记全（' + reason + '）：已经记下的不会丢，下一次写票会把缺的补上。');
    else notes.push('工作路线这次没落上（' + reason + '）：盘上还是上一次的样子，下一次写票会补上。');
  };
  const readFailNote = function (reason: string): void {
    notes.push('工作路线记上了，但这次没读回来（' + reason + '）：下一次写票会把在办表带上。');
  };
  const clock = deps && typeof deps.now === 'function' ? deps.now : Date.now;
  const rootKey = str(s && s.workspaceKey);
  const sessionId = str(s && s.sessionId);
  try {
    for (let i = 0; i < tickets.length; i++) {
      const ticketKey = tickets[i];
      const facts = spec.ticketFactsOf(vRec, ticketKey);
      const input: UnknownRecord = {
        rootKey: rootKey,
        sessionId: sessionId,
        sessionLabel: '',           // 会话标题快照归 #1263，这里传空串表示「这次没带」。
        backend: backendId,
        ticketKey: ticketKey,
        action: spec.action,
        source: spec.source,
      };
      // 认不出的标题与工作单元省略键，让存储保留上一次的值（传空串会把它抹掉）。
      if (facts.title !== '') input.title = facts.title;
      if (facts.effortId !== '') input.effortId = facts.effortId;
      const noted = (await note(input)) as UnknownRecord | null;
      if (!noted || noted.ok !== true) {
        writeFailNote(str(noted && noted.reason) || 'unknown');
        return;
      }
      recorded += 1;
    }
    phase = 'read';
    const ro = (await read({
      sessionId: sessionId,
      rootKey: rootKey,
      at: clock(),
    })) as UnknownRecord | null;
    const readout = ro ? ro.readout : null;
    if (!ro || ro.ok !== true || !readout || typeof readout !== 'object') {
      readFailNote(str(ro && (ro as UnknownRecord).reason) || 'read-failed');
      return;
    }
    const data = obj(vRec.data);
    if (!data) return;
    data.workRoute = readout;
    const summary = str(ro.summary);
    if (summary !== '') notes.push(summary);
  } catch {
    if (phase === 'read') readFailNote('threw');
    else writeFailNote('threw');
  }
}
