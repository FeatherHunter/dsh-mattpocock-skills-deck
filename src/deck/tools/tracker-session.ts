// src/deck/tools/tracker-session.ts —— 九个 deck 工具走 Tracker 会话的接线层（#1442）。
//
// 为什么单开这一层：#1435 的根因是工具壳在认出后端之前先过闸（无读数时剩余额度是 0，
// 0 命中写保底，本地 Markdown 工作区被永久推迟）。本票把「选后端、过闸、补仓库标识」
// 三件事从九个工具里收拢到这里，统一走 openTracker 会话：选后端只读本地认领（不出站、
// 不花额度），离网后端跳过剩余额度探针（没有额度可言，直接放行），额度只在管线里按
// 后端口径裁决与记账。九个工具的 work 闭包一个字不动，只换 pick 与 call 两个调用点。
import { openTracker } from '../../tracker/session/open-tracker.js'
import { resolveSessionRepoRef } from '../../tracker/session/repo-ref.js'
import type { TrackerSession } from '../../tracker/session/open-tracker.js'
import type { RepositoryRef } from '../../tracker/contract/entities.js'
import { selectionFromOutlet } from '../../tracker/detection/backendDecision.js'
import { tierFor, aiToolFloor } from '../../refresh/kernel/host-budget.js'
import { recordWorkRoute } from '../shell/work-path-record.js'
import { DECK_STATUS, DECK_TOOL_KIND, REFUSAL_REASONS, receiptCost } from '../shell/call-shell.js'
import { withCap } from '../shell/capped-wait.js'

/** 未知形状的记录（依赖袋与会话壳都没标类型，用到哪格验哪格，不猜）。 */
type UnknownRecord = Record<string, unknown>;
/** 字符串兜底（与壳里同名函数同算法，壳没把它导出，各文件自带一份是仓里既有写法）。 */
function str(v: unknown): string { return (typeof v === 'string') ? v : ''; }
/** 数字兜底（非数字一律按 0，保证回执里的数字格永远是数字）。 */
function num(v: unknown): number { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
/** 工作区短指纹（与 backendDecision.js 里同算法，壳没把它导出，各文件自带一份是仓里既有写法）。 */
function hash8(text: unknown): string {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
  return ('0000000' + h.toString(16)).slice(-8);
}

/** deck 工具每趟操作的编号：时间转 36 进制加自增序号，保证同一毫秒内也不重。房间日志里的 opId 就是这一格，工具回执里也带上它，两边才能对上。 */
let deckOpSeq = 0;
function newDeckOpId(nowFn: () => number): string {
  try { return String(nowFn()) + '-' + (++deckOpSeq).toString(36); } catch { return 'op-' + (++deckOpSeq).toString(36); }
}

/** 打开会话要齐的东西（工具把自己手头现成的递进来，本层不替工具算估算、不探沙箱）。 */
export interface DeckSessionRequest {
  /** 工具的依赖袋（判定出口、闸、账本读口、裁决记账三件都从这里取，缺席各退默认）。 */
  deps: unknown;
  /** DSH 给的执行上下文（只为透传取消信号， withCallScope 自己从它取）。 */
  exec: unknown;
  /** 会话上下文（sessionContextOfAsync 的成功那一支，目录与工作区键从它取）。 */
  session: unknown;
  /** 调用前估算（工具已经算好的那一份，超顶判断只认它，不另算第二份）。 */
  estimate: unknown;
  /** 工具名（只写进回执那一格，不参与定价）。 */
  tool: string;
  /** 读写类别（只决定整单前置检查用哪条代表操作，不透进管线）。 */
  kind: string;
}
/**
 * 打开成功：沿用壳的 pick 形状（repoOf 照用不改），外加会话与透传件。
 *
 * requests 与 points 照旧填「这次选后端探测花掉的量」：壳的 repoOf 与回执都按 pick 形状读这两格，
 * 少了它们类型就对不上（1442 的接线层与 1443 删掉旧壳之后在类型检查上撞过一次）。
 */
export interface DeckOpenedSession {
  ok: true; backendId: string; source: string; ref: UnknownRecord | null; pending: boolean;
  /** 这次开会话的估算请求条数（来自调用前估算，不做第二份计数）。 */
  requests: number;
  /** 这次开会话的估算点数（同上）。 */
  points: number;
  /** Tracker 会话（24 条异步操作走管线，定位口直通房间）。 */
  session: TrackerSession;
  /** 调用上下文要的裁决结论（双桶是闸的原话，离网是直通标记，work 闭包照旧从 c.admit 取）。 */
  admit: UnknownRecord;
}
/** 打开失败：原因码与人话（工具拿它拼 unsupported 信封，与原来拼 pick 失败那一行同形）。 */
export interface DeckOpenFailed { ok: false; reason: string; text: string; }
/** 决定的两种结局（成功才有会话，失败只有原因码与人话）。 */
export type DeckOpenResult = DeckOpenedSession | DeckOpenFailed;

/** 后端 ctx（与壳里 backendCtxNow 同算法：函数现取、对象直用，拿不到按空对象，房间读文件不因此炸）。 */
function backendCtxNow(d: UnknownRecord): UnknownRecord {
  const b = d.backendCtx;
  if (typeof b === 'function') { try { return (b() || {}) as UnknownRecord; } catch { return {}; } }
  return (b || {}) as UnknownRecord;
}
/** 依赖袋没配裁决口时的兜底（与参考裁决同口径：硬顶先行、未知与离网放行、已知耗尽推迟，见 budget-model.ts）。 */
async function fallbackAdmit(input: UnknownRecord): Promise<UnknownRecord> {
  const op = String(input.op || '');
  const model = (input.budget || {}) as UnknownRecord;
  const reading = (input.reading || {}) as UnknownRecord;
  const writes = ['create', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy'];
  if (writes.indexOf(op) >= 0 && input.canWrite === false) return { allowed: false, kind: 'rate-limit', reason: 'hard-cap', message: '硬顶：这次调用没有写权限，写操作直接拒绝。' };
  if (!reading || reading.known === false) return { allowed: true, reason: 'unknown-reading' };
  if (model.kind === 'off-network' || reading.kind === 'off-network') return { allowed: true, reason: 'off-network' };
  const levels: Array<{ remaining: number; limit: number }> = [];
  if (reading.kind === 'requests-only') levels.push((reading.requests || {}) as { remaining: number; limit: number });
  else if (reading.kind === 'two-buckets') {
    const buckets = (reading.buckets || {}) as UnknownRecord;
    if (model.kind === 'requests-only') levels.push((buckets.rest || {}) as { remaining: number; limit: number });
    else if (model.independentBuckets) levels.push((buckets.rest || {}) as { remaining: number; limit: number }, (buckets.graphql || {}) as { remaining: number; limit: number });
    else levels.push((buckets.graphql || {}) as { remaining: number; limit: number });
  }
  // #1527：保底线改成服务端上限的 5%（以前是本桶份额的 30%），文案照实报服务端剩余与保底，不让人猜。
  for (const level of levels) {
    if (num(level.remaining) <= aiToolFloor(num(level.limit))) return { allowed: false, kind: 'rate-limit', reason: 'exhausted', message: '额度见底：服务端还剩 ' + num(level.remaining) + '（上限 ' + num(level.limit) + '，保底 ' + aiToolFloor(num(level.limit)) + '），这次先不执行。' };
  }
  return { allowed: true, reason: 'sufficient' };
}

/**
 * 打开一个 Tracker 会话（九个工具的 pickBackend 整段搬到这里，失败的人话与原来逐字相同）。
 * 注册表的选择接口一次都不调：判定出口给选择形状，openTracker 用预填的 resolveSelection 建会话。
 * 闸的发送接口一次都不调：探针只用纯算的 admitAiTool（不花额度），离网后端连探针都跳过。
 */
export async function openDeckSession(req: DeckSessionRequest): Promise<DeckOpenResult> {
  const d = (req.deps || {}) as UnknownRecord;
  const s = (req.session || {}) as UnknownRecord;
  const est = (req.estimate || {}) as UnknownRecord;
  // #1418：读/写只决定会话预检先试哪一族；真正按哪一族拦住某一次操作，由那次操作过管线时
  //   按操作名判（见 src/refresh/kernel/budget-admission.ts 的 familiesOfOp）。
  const readCall = str(req.kind) === 'read';
  const registry = (d.registry || {}) as UnknownRecord;
  const gate = (d.gate || {}) as UnknownRecord;
  const cwd = str(s.cwd);
  if (cwd.trim() === '') return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' };
  const handle = (typeof d.handleFor === 'function') ? ((d.handleFor(s) || { cwd: cwd }) as UnknownRecord) : { cwd: cwd };
  try { if (typeof d.ensureReading === 'function') await d.ensureReading(cwd, s.workspaceKey); } catch { /* 保读数永不拦路，保不住就照旧往下走。 */ }
  const useOutlet = (typeof d.decideBackend === 'function') ? d.decideBackend as (cwd: string, ctx: unknown) => Promise<unknown> : null;
  if (!useOutlet) return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '判定出口这次没装上，我没往下做。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。' };
  const directSelect = async (h: unknown, actx?: unknown): Promise<unknown> => {
    const a = (actx || null) as UnknownRecord | null;
    return (registry.select as (h: unknown, c: unknown) => Promise<unknown>)(h, Object.assign({}, backendCtxNow(d), { cwd: cwd, caller: (a && a.caller) || DECK_TOOL_KIND, signal: (a && a.signal) || undefined }));
  };
  let outlet: UnknownRecord | null = null;
  try {
    outlet = (await useOutlet(cwd, {
      registry: registry, backendCtx: backendCtxNow(d),
      readWorkspaceFileText: d.readWorkspaceFileText, parseWorkspaceFile: d.parseWorkspaceFile,
      readDeclarationId: d.readDeclarationId, caller: DECK_TOOL_KIND, autodetect: directSelect, logCtx: d.log,
    })) as UnknownRecord | null;
  } catch (e) { return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选后端这一步的后端实现抛错了，我没往下做。' }; }
  let selection: UnknownRecord | null = null;
  try {
    selection = (selectionFromOutlet(outlet as never, function (id: string): never {
      try { return (registry.describe as (h: unknown, id: string) => never)(handle, id); } catch { return null as never; }
    }) || null) as unknown as UnknownRecord | null;
  } catch { selection = null; }
  const source = str(selection && selection.source);
  if (!selection || selection.backendId == null) {
    const pending = !!(selection && selection.pending);
    return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: pending ? '后端还没定下来（自动识别有超时未决），先在面板上选一次后端。' : '这个工作区还没有后端（既没有手动选过，也没有识别到锚文件）。先在面板上选一个后端。' };
  }
  if (source !== 'explicit' && ((Array.isArray(selection.multiHit) && (selection.multiHit as unknown[]).length > 1) || selection.pending)) {
    const mh = Array.isArray(selection.multiHit) && (selection.multiHit as unknown[]).length > 1;
    return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: mh ? '这个工作区同时被 ' + (selection.multiHit as unknown[]).length + ' 个后端认出，请在面板中选定后再试。' : '后端还没定下来，先在面板上选一次后端。' };
  }
  const backendId = str(selection.backendId);
  let model: UnknownRecord = {};
  try {
    const modules = (typeof registry.modules === 'function') ? (registry.modules() as Array<{ id: string; budget?: unknown }>) : [];
    model = ((modules.filter(function (m) { return m && m.id === backendId; })[0] || {}).budget || {}) as UnknownRecord;
  } catch { model = {}; }
  const offline = str(model.kind) === 'off-network';
  // #1446：闸按后端模型选桶（只计请求的后端只有 requests 这一桶），并且告诉闸「这是哪个后端」——
  // 不传 backendId 时闸只能按未知后端算，两桶保底与分桶读数就落不到这个后端头上。
  // #1418：两桶后端里一个工具可能碰两族额度（建票 REST + 建前幂等锚回查 GraphQL、改票只有 GraphQL、
  //   评论与阻塞边两条路任一），而开会话前的预检只回答「这一笔值不值得试」——真正的按操作拦截
  //   在每次操作过管线时做（见 src/refresh/kernel/budget-admission.ts 的 familiesOfOp）。
  //   所以预检按族逐个试：一族因为额度见底被拒就换另一族再问一次，两族都见底才拒。
  //   不自己拿两族的 remaining 绝对值相比：两族的尺子不一样（保底各按服务端上限的 5%，#1527），
  //   余量判断一律交给闸按各桶自己的保底线算。单次硬顶与桶无关，被它拒就不再换桶；
  //   每小时那条线 #1527 起只是提醒（放行并带一段 warnings），不会让换桶循环多问一次。
  const probeBuckets: string[] = str(model.kind) === 'requests-only'
    ? ['requests']
    : (readCall ? ['graphql'] : ['rest', 'graphql']);
  const admitVolumes = { points: num(est.points), requests: num(est.requests), childTickets: num(est.tickets) };
  // 先给空对象再按分支覆盖：后面的成功回执要读它，而编译器分不清「循环里已赋值」与「没走到那一支」。
  // 真正走到成功回执时它一定是被赋过值的那一份（两族都见底的分支在下面直接 return）。
  let admit: UnknownRecord = {};
  if (offline) {
    // 离网后端没有额度可言：剩余额度探针在这里没有意义（无读数的 0 不能当成耗尽，见 #1435），
    // 所以只认调用前估算的单次硬顶；每小时提醒线越线时照常执行，提醒句留在估算 text 里（#1527）。
    if (est.withinCallCap === false) return { ok: false, reason: REFUSAL_REASONS.OVER_CAP, text: str(est.text) || '这次调用超过了插件给 AI 工具设的硬顶，我没有动手。' };
    admit = { admitted: true, points: admitVolumes.points, requests: admitVolumes.requests, childTickets: admitVolumes.childTickets, reason: 'off-network' };
  } else {
    if (typeof gate.admitAiTool !== 'function') return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '额度闸这次没装上，我没往下做。' };
    let lastText: string = '';
    let lastReason: string = '';
    let failedAt: string = '';
    let passed: boolean = false;
    for (let i: number = 0; i < probeBuckets.length && !passed; i++) {
      const bucket: string = probeBuckets[i];
      let probe: UnknownRecord;
      try {
        probe = (await gate.admitAiTool({ points: 0, requests: 1, childTickets: 0 }, { workspaceKey: s.workspaceKey, bucket: bucket, backendId: backendId })) as UnknownRecord;
      } catch { return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选后端这一步的后端实现抛错了，我没往下做。' }; }
      if (!probe || probe.admitted !== true) {
        lastText = str(probe && probe.text); lastReason = str(probe && probe.reason); failedAt = 'probe';
        if (lastReason === 'ai-tool-below-remaining') continue;
        break;
      }
      let volumesOk: UnknownRecord;
      try {
        volumesOk = (await gate.admitAiTool(admitVolumes, { workspaceKey: s.workspaceKey, kind: 'tool-batch', bucket: bucket, backendId: backendId })) as UnknownRecord;
      } catch { return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选后端这一步的后端实现抛错了，我没往下做。' }; }
      if (volumesOk && volumesOk.admitted === true) { admit = volumesOk; passed = true; break; }
      lastText = str(volumesOk && volumesOk.text); lastReason = str(volumesOk && volumesOk.reason); failedAt = 'admit';
      if (lastReason === 'ai-tool-below-remaining') continue;
      break;
    }
    if (!passed) {
      // 文案取闸给的 text（见底时会写「哪种额度 / 约几点恢复 / 还剩多少」），没有才退回原因代号。
      if (failedAt === 'admit') return { ok: false, reason: REFUSAL_REASONS.OVER_CAP, text: lastText || '这次调用超过了插件给 AI 工具设的硬顶，我没有动手。' };
      return { ok: false, reason: REFUSAL_REASONS.GATE_DEFER, text: '这一次选后端被闸推迟了（' + (lastText || lastReason || '额度不够了') + '），先不做。' };
    }
  }
  const getCachedReading = (typeof d.getCachedReading === 'function') ? d.getCachedReading as () => unknown : async function (): Promise<unknown> { return { known: false, reason: 'not-measured' }; };
  const admitPort = (typeof d.admit === 'function') ? d.admit as (input: unknown) => Promise<unknown> : fallbackAdmit;
  const accountPort = (typeof d.account === 'function') ? d.account as (input: unknown) => Promise<unknown> : async function (): Promise<void> { /* 依赖袋没配记账口：无处可记，零记账。 */ };
  const snapshot = selection;
  let opened: { ok: boolean; session?: TrackerSession; reason?: string; detail?: string };
  try {
    opened = (await openTracker({ cwd: cwd } as never, {
      registry: registry as never, getCachedReading: getCachedReading as never,
      admit: admitPort as never, account: accountPort as never,
      canWrite: true, canWriteReason: '1442 在工具侧保留自有写检查，会话写权限先按就绪透传，1444 再收紧。',
      resolveSelection: async function () { return snapshot as never; },
    })) as { ok: boolean; session?: TrackerSession; reason?: string; detail?: string };
  } catch (e) { return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选后端这一步的后端实现抛错了，我没往下做。' }; }
  if (!opened || opened.ok !== true || !opened.session) {
    const reason = str(opened && opened.reason);
    const detail = str(opened && opened.detail);
    if (reason === 'multi-match') return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: '这个工作区同时被多个后端认出，请在面板中选定后再试。' };
    if (reason === 'workspace-not-ready') return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' };
    if (reason === 'no-backend') return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: '这个工作区还没有后端（既没有手动选过，也没有识别到锚文件）。先在面板上选一个后端。' };
    return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选中的后端还没就绪（' + (detail || reason || '没说清原因') + '），我没往下做。' };
  }
  // 仓库标识补全：判定出口带的先用；缺 refId 时与刷新后台走同一份补齐
  // （src/tracker/session/repo-ref.ts）：先问会话的 describe（本地 Markdown 在这里就能拿到工作区
  // 路径），仍缺再问会话的 getRepoKey 远端定位口，拿到 owner/name 后由后端 describe 写完整身份
  // （域名不在这里拼）。#1453 起这一问必须走会话能力：仓库定位是出站动作，要过裁决与记账；
  // 注册表的取实例口不再对 deck 工具公开。#1583 起不按后端名写死、也不再自己拼 github.com。
  let ref: UnknownRecord | null = (selection.ref || null) as UnknownRecord | null;
  if (!ref || !ref.refId) {
    const cap = (typeof d.resolveTimeoutMs === 'number' && (d.resolveTimeoutMs as number) > 0) ? Math.floor(d.resolveTimeoutMs as number) : 8000;
    // 补身份整段与等待上限赛跑：describe 是同步的，真正可能悬挂的是远端那一问；整段一起限时
    // 也覆盖将来 describe 换成异步实现的情形。等待口缺席时用真定时器（与旧行为一致）。
    const resolved = await withCap(
      resolveSessionRepoRef({
        session: opened.session,
        cwd: cwd,
        backendId: backendId,
        fromSelection: (ref as unknown as RepositoryRef | null),
        baseCtx: backendCtxNow(d),
        caller: DECK_TOOL_KIND,
      }),
      cap,
      (typeof d.sleep === 'function') ? d.sleep as (ms: number) => Promise<unknown> : undefined,
    );
    const maybe = (resolved.ok === true) ? (resolved.value as { ref?: RepositoryRef | null } | null) : null;
    if (maybe && maybe.ref) ref = maybe.ref as unknown as UnknownRecord;
  }
  return { ok: true, backendId: backendId, source: source, ref: ref, pending: !!selection.pending, requests: num(est.requests), points: num(est.points), session: opened.session, admit: admit };
}

/** 管线执行层失败（房间抛错被管线收成 env）与旧口径的对照：旧壳认 backend-threw 才抛，这里改写一格再交出去。 */
const ADAPT_OPS = ['get', 'list', 'listMaps', 'getDependencies', 'create', 'setParent', 'setBlockedBy', 'preflight', 'getRepoPermissions', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees'];
/** 把会话包成预算壳认得的后端门面：方法名与 withCallScope 要的那十五条对齐，env 改写成 backend-threw。 */
function adaptSession(session: TrackerSession): UnknownRecord {
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

/** 调一次会话要齐的东西（openDeckSession 的成功那一支原样递进来，工具再加自己的 repo 与沙箱）。 */
export interface DeckCallRequest {
  /** 工具名（只写进回执那一格，不参与定价）。 */
  tool: string;
  /** 工具的依赖袋（写后失效缓存从这里取，缺席就跳过，不拦事）。 */
  deps: unknown;
  /** openDeckSession 的成功那一支（会话、后端编号、裁决结论都在里面）。 */
  opened: DeckOpenedSession;
  /** 会话上下文（工作区目录与键从它取）。 */
  session: unknown;
  /** 可用的仓库身份（shell.repoOf 的产物，open 那一步已经备好）。 */
  repo: unknown;
  /** 调用前估算（回执估算那一格原样回它，不另算第二份）。 */
  estimate: unknown;
  /** 沙箱快照（对象才取策略格，其余一律按没有处理，与原来同形）。 */
  sandbox?: unknown;
  /** 取消信号（工具从执行上下文取到的那个；管线目前不用它，留着不改调用方形状）。 */
  signal?: unknown;
}
/** 统一的返回信封底（与壳里 envelope 同形：先摆五格，再并业务格）。 */
function envelope(tool: string, status: string, extra?: UnknownRecord): UnknownRecord {
  return Object.assign({ ok: status === DECK_STATUS.OK, status: status, tool: tool, reason: '', text: '' }, extra || {});
}
/**
 * 读支出那一格的四件事实（#1446）：这次算在哪个后端上、它按什么口径花钱、读数知不知道、离不离网。
 * 为什么先摆事实再谈水位：旧回执用 remaining:-1 / tier:'off-network' 这类哨兵冒充数字，读的人分不清
 * 「量出来是 1」与「根本没有这个数」；四格事实永远在，水位（remaining/tier）只在真量到且该后端有额度时附上。
 */
interface BudgetFacts {
  backendId: string;
  budgetKind: string;
  readKnown: boolean;
  offNetwork: boolean;
}

/** 额度读数还没同步上来时的说明（人话，不写哨兵）：未知不拦事，但这一笔不按额度记账。 */
const NOTE_READING_UNKNOWN = '额度读数还没同步上来，这次不按额度记账。';
/** 离网后端的说明：本来就没有额度这回事，既不记条数也不记点数。 */
const NOTE_OFF_NETWORK = '本后端不需要额度（离网口径）。';

/**
 * 按后端口径解释一次读数，答「这一笔的账该怎么写」。
 * 返回的 actual 里一定有 backendId/budgetKind/readKnown/offNetwork；remaining 与 tier 只在
 * 模型有额度且读数真是那个形状时才加，未知与离网一律不带水位。
 * 为什么离网也算 readKnown:true：这不是「没量到」，而是「量过了，本后端根本没有额度」——
 * 与面板 budgetState（refresh-runtime.ts）同一口径，两处说法必须一致，否则人会以为哪里坏了。
 */
async function quotaPart(d: UnknownRecord, session: TrackerSession): Promise<{ actual: UnknownRecord; note: string | null }> {
  const model = (session.budget || {}) as unknown as UnknownRecord;
  const kind = str(model.kind) || 'unknown';
  const facts: BudgetFacts = {
    backendId: str(openedBackendIdOf(session)),
    budgetKind: kind,
    readKnown: false,
    offNetwork: kind === 'off-network',
  };
  if (facts.offNetwork) return { actual: Object.assign({}, facts, { readKnown: true }) as unknown as UnknownRecord, note: NOTE_OFF_NETWORK };
  try {
    if (typeof d.getCachedReading === 'function') {
      const reading = ((await d.getCachedReading()) || {}) as UnknownRecord;
      // 两桶后端看查询桶（与旧口径一致）；只计请求的后端看请求那一格。读数形状对不上就按未知处理，
      // 不拿另一种桶的数字冒充（例如拿 REST 请求数当 GraphQL 点数）。
      if (kind === 'two-buckets' && reading && reading.known === true && reading.kind === 'two-buckets') {
        const buckets = (reading.buckets || {}) as UnknownRecord;
        const graphql = (buckets.graphql || {}) as UnknownRecord;
        const remaining = graphql.remaining;
        const limit = graphql.limit;
        // 读数说「已知」但那一格不是有限数字（形状不对）时按未知处理：宁可写「还没同步上来」，
        // 也不能把缺格兜成 0 再算出一个假档位 —— 回执是给人看额度的地方，不能编。
        if (typeof remaining === 'number' && isFinite(remaining) && typeof limit === 'number' && isFinite(limit)) {
          // 档位吃的是已用比例（与账本同口径），剩余额度要先换算成已用才喂进去。
          return {
            actual: Object.assign({}, facts, { readKnown: true, remaining: remaining, tier: tierFor(limit > 0 ? 1 - remaining / limit : 1) }) as unknown as UnknownRecord,
            note: null,
          };
        }
      }
      if (kind === 'requests-only' && reading && reading.known === true && reading.kind === 'requests-only') {
        const requests = (reading.requests || {}) as UnknownRecord;
        const remaining = requests.remaining;
        const limit = requests.limit;
        if (typeof remaining === 'number' && isFinite(remaining) && typeof limit === 'number' && isFinite(limit)) {
          return {
            actual: Object.assign({}, facts, { readKnown: true, remaining: remaining, tier: tierFor(limit > 0 ? 1 - remaining / limit : 1) }) as unknown as UnknownRecord,
            note: null,
          };
        }
      }
    }
  } catch { /* 读缓存炸了按未知处理，与管线同口径。 */ }
  return { actual: facts as unknown as UnknownRecord, note: NOTE_READING_UNKNOWN };
}

/** 会话属于哪个后端（会话壳一定有 backendId；取不到就空串，回执里如实空着，不编一个 id）。 */
function openedBackendIdOf(session: TrackerSession): string {
  try { return str((session as unknown as UnknownRecord).backendId); } catch { return ''; }
}

/**
 * 跑一次会话调用（九个工具的 shell.call 整段搬到这里，work 闭包一字不动）。
 * 不调闸的发送接口：记账走管线里的记账口，回执的实际花费沿用 work 交回来的 claimed（与原来同口径）。
 */
export async function callDeckSession(req: DeckCallRequest, work: (ctx: unknown) => unknown): Promise<unknown> {
  const d = (req.deps || {}) as UnknownRecord;
  const opened = req.opened;
  const s = (req.session || {}) as UnknownRecord;
  const est = (req.estimate || {}) as UnknownRecord;
  const tool = str(req.tool) || 'deck_tool';
  const backendId = opened.backendId;
  const nowFn: () => number = (typeof d.now === 'function') ? d.now as () => number : Date.now;
  const sbM = (req.sandbox && typeof req.sandbox === 'object') ? (req.sandbox as UnknownRecord) : {} as UnknownRecord;
  const sbPolicy = sbM.policy;
  const sessionId = (typeof sbM.sessionId === 'string' && sbM.sessionId) ? sbM.sessionId : str(s.sessionId);
  const ctx: UnknownRecord = {
    session: s,
    pick: { backendId: backendId, source: opened.source, ref: opened.ref },
    repo: req.repo,
    now: nowFn,
    tracker: adaptSession(opened.session),
    opCtx: Object.assign({}, backendCtxNow(d), { cwd: str(s.cwd), signal: undefined, caller: DECK_TOOL_KIND, sandboxPolicy: sbPolicy, sessionId: sessionId, opId: newDeckOpId(nowFn) }),
    admit: opened.admit,
  };
  let value: unknown = null;
  // work 闭包交回 { value, claimed }：里面是工具自己的业务结果，外面那层是这次的实际用量。
  // 这两格要分开取——以前只留了 value，回执的实际用量就只能再从 value 上找，永远找不到（恒 0/0）。
  let rawClaimed: unknown = null;
  try {
    const out = (await work(ctx)) as UnknownRecord | null;
    value = (out && typeof out === 'object' && 'value' in out) ? (out as UnknownRecord).value : out;
    rawClaimed = (out && typeof out === 'object' && 'claimed' in out) ? (out as UnknownRecord).claimed : null;
  } catch (e) {
    const eh = hash8(String(((e || {}) as UnknownRecord).message || e));
    return envelope(tool, DECK_STATUS.UNSUPPORTED, {
      reason: REFUSAL_REASONS.BACKEND_THREW, text: '后端实现抛错了（我没有把它抛给 AI，按三态返回）：' + String(((e || {}) as UnknownRecord).message || e).slice(0, 300),
      workspace: { root: str(s.cwd), key: str(s.workspaceKey) },
      backend: { id: backendId, source: opened.source },
      errorHash: eh, cost: { estimated: est },
    });
  }
  const vRec = (value && typeof value === 'object') ? (value as UnknownRecord) : null;
  const failed = vRec ? (vRec.ok === false) : false;
  // 五个写工具成功收口处记一笔工作路线（与原来同条件：ok 才记，partial 与失败不记）。
  if (!failed) {
    try {
      await recordWorkRoute({
        workRouteNote: (typeof d.workRouteNote === 'function') ? d.workRouteNote as (input: UnknownRecord) => Promise<unknown> : undefined,
        workRouteRead: (typeof d.workRouteRead === 'function') ? d.workRouteRead as (input: UnknownRecord) => Promise<unknown> : undefined,
        workRouteRelease: (typeof d.workRouteRelease === 'function') ? d.workRouteRelease as (input: UnknownRecord) => Promise<unknown> : undefined,
        now: nowFn,
      }, tool, { cwd: str(s.cwd), workspaceKey: str(s.workspaceKey), sessionId: s.sessionId }, backendId, value);
    } catch { /* 记不上只少在办表，不翻结果。 */ }
  }
  const claimed = (rawClaimed && typeof rawClaimed === 'object') ? rawClaimed as UnknownRecord : {};
  const quota = await quotaPart(d, opened.session);
  // 实际花费 = 这一笔花了多少（requests/points，旧字段照留）+ 四格后端口径事实（#1446）。
  // remaining/tier 只在 quotaPart 真量到水位时才在里面；未知与离网时这两格根本不出现，
  // 不再用 -1 / 'unknown' / 'off-network' 冒充数字——不知道就如实说不出数，理由写在 cost.note。
  const actual: UnknownRecord = Object.assign(
    { requests: num((claimed as UnknownRecord).requests), points: num((claimed as UnknownRecord).points) },
    quota.actual,
  );
  // #1527：闸放行时带的提醒（例如这一小时越过了 AI 工具提醒线）要出现在回执里——人翻回执就能看见
  //   「花得多、该收手」，不用去日志里翻；票面第 5 条点名 cost.note，提醒也写进那一格。拼法在壳里
  //   （call-shell.ts 的 receiptCost）：这里是接线层，只递料，不各拼一份。没提醒时两格都不出现。
  const cost = receiptCost(est, actual, opened.admit, quota.note)
  const out = envelope(tool, DECK_STATUS.OK, {
    workspace: { root: str(s.cwd), key: str(s.workspaceKey) },
    backend: { id: backendId, source: opened.source },
    repo: { backend: str((req.repo as UnknownRecord || {}).backend), refId: str((req.repo as UnknownRecord || {}).refId), name: str((req.repo as UnknownRecord || {}).name), url: str((req.repo as UnknownRecord || {}).url) },
    cost: cost,
  });
  // 合并工具自己的结果（与壳里 mergeOutcome 同形：状态与八格照抄，touched 触发写后失效）。
  const v = vRec || {};
  out.status = str(v.status) || DECK_STATUS.OK;
  out.ok = out.status === DECK_STATUS.OK;
  out.reason = str(v.reason);
  out.text = str(v.text);
  out.data = v.data !== undefined ? v.data : null;
  out.items = Array.isArray(v.items) ? v.items : [];
  out.notes = Array.isArray(v.notes) ? v.notes : [];
  out.readBack = v.readBack !== undefined ? v.readBack : null;
  const touched = Array.isArray(v.touched) ? (v.touched as unknown[]).filter(function (k): k is string { return typeof k === 'string' && !!k; }) : [];
  out.touched = touched;
  if (touched.length && typeof d.invalidate === 'function') {
    try { (d.invalidate as (info: unknown) => void)({ repo: out.repo, backendId: backendId, keys: touched, workspace: out.workspace }); } catch { /* 缓存失效失败不影响已经写成的结果。 */ }
  }
  return out;
}
