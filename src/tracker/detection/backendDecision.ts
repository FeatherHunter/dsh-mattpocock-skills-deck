/**
 * tracker/detection/backendDecision.ts —— 后端判定的唯一真源（#1003 契约落地一期，#1048 收全证据二期）
 *
 * 人的话：工作区现在用哪个后端，只许这一处说了算。调用方（面板快照、九个 deck 工具、
 * 改色两条电话、状态栏）都问它，不许各自再写一份短清单。
 *
 * 一期做的读收敛（#1003）：
 *  - 空目录（还不知道工作区是哪条）如实按未知处理：不读文件、不起外部命令，
 *    不产出“没有后端”的结论，只说工作区还没就绪。
 *  - 顺序统一为：工作区文件 → 声明文件 → 自动识别。
 *    这一顺序把三条旧链（探测级联、工具壳、改色电话）里“看不看声明文件”的分叉收掉：
 *    只放声明文件的工作区，三处从此给出同一个答案。
 *  - 来源保持旧枚举（explicit / matches / fallback / unknown），另加 origin 一格
 *    区分“人选的 / 搬来的 / 声明文件来的 / 自动识别来的”，旧界面按 source 照读，
 *    新界面按 origin 区分。下一期（#1012 核落地后）再把 source 也换成新枚举。
 *
 * #1048（2026-10-14，按讨论票 #1047 的结论落地）——二期做的“收全证据、说得清为什么”：
 *  - **先收证据再合成**：三层各记一条“这一步看到了什么”（见 `EvidenceStep`），最后按
 *    「人选（工作区文件） > 程序自己认（声明文件 > 各房认领）」合成一个答案。读文件那两层
 *    每次照读：它们便宜、无副作用，而且“我选的”与“项目里写的”之间的矛盾只有两边都读才看得出来。
 *    各房认领那一层会真花配额与时间（工具壳那条路把它包在配额闸里），所以只在前两层都没给出
 *    可用结论时才问 —— 它是三层里最弱的一层，跳过它不会错过更确凿的证据；跳过这件事本身也记一条
 *    「skipped」步骤，事后能读出“为什么这层没问”。
 *  - **明文裁剪顺序**：多个后端同时认领时按 `MULTI_CLAIM_ORDER`（GitHub > Markdown > GitLab）
 *    取第一个。今天这个顺序是装配顺序（src/host/platformChannel.js 的 github → markdown → gitlab）
 *    碰巧给的，这里升成明文规则，由 tests/verify-detection-evidence.ts 钉住，免得以后有人调装配
 *    顺序就悄悄改掉了判定。声明文件里写多行标题时的互斥顺序不归这里管，仍由 parseIssueTracker
 *    那套（GitLab > Markdown > GitHub）说了算。
 *  - **一份解析器**：声明文件原来被两套解析器各读一遍，优先级还不一样（出口自带那套只看标题、
 *    顺序是 Markdown > GitHub > GitLab），同一次探测能得出两个结论。现在出口也用
 *    `parseIssueTracker`，一次读取、一份结论。
 *  - **内部三态**：`state` = decided（有结论）/ undetermined（判不出来，缺什么写在 missing 与 gap 里）/
 *    no-backend（明确没有后端：各房认领问过了，谁都没认领、也没有超时未决）。
 *  - **对外五个字段一个不动**：上层经 `selectionFromOutlet` 拿到的仍然是
 *    backendId / source / ref / multiHit / pending 这五个；state / missing / gap / conflict / steps
 *    是给排查、给门禁、给将来界面的内部字段。
 *  - **日志分层**：平时一条结论（常驻事件 `detection.detect`，由本文件发射，含来源、三态、耗时、
 *    矛盾）；调试开关打开时每个证据步骤各记一行（按需事件 `detection.step`，含步骤、这一步的结论、
 *    耗时、为什么继续往下走）。开关只在外层判一次，不开就不建步骤对象。
 *  - **失败档位表**：每一档写清“看了哪些地方、缺什么、补什么就能确定”（见 `DECISION_GAPS`），
 *    档位名稳定（写进日志与结果），给人看的话就是每一档的 text 那一段。
 *
 * #1138（2026-10-14 落地）：这里原来还有第一层「注册表里的进程内绑定」，它与工作区文件记的是同一件事，
 *   却是两份记录（宿主重启即消失），人选的记录因此有两个家。整层删掉了：人选只从工作区文件读，
 *   注册表那边负责写这份副本的 bind/bound/allBindings 也一起删了（见 src/tracker/registry/core.ts）。
 */

import * as workspaceFileNS from '../../deck/shell/workspace-anchor.js';
import { parseIssueTracker } from './parseIssueTracker.js';
import type { RepoHandle, SandboxFs } from '../contract/contexts.js';
import type { RepositoryRef } from '../contract/entities.js';
import type { Selection } from '../contract/results.js';
const parseWorkspaceFile = workspaceFileNS.parseWorkspaceFile;
const WORKSPACE_FILE_REL = workspaceFileNS.WORKSPACE_FILE_REL;

/**
 * 判定里流转的选择形状：就是契约的 Selection，只是引用缺席时按 null 写（契约里那格是可选）。
 * 这样写是因为三处调用方都按 `o.ref || null` 读，缺席与 null 在它们眼里是同一回事。
 */
export type DecisionSelection = Omit<Selection, 'ref'> & {
  ref?: RepositoryRef | null
};

/**
 * 判定内部的三态（#1048·#1047 决策 4）：有结论 / 判不出来（缺什么）/ 明确没有后端。
 * 后两者长得像、意思相反：undetermined 是“没查清”，no-backend 是“查清了，确实没有”。
 * 对外交出去的五个字段不含这一格，它是给排查与将来界面的。
 */
export type DecisionState = 'decided' | 'undetermined' | 'no-backend'

/**
 * 一条证据步骤：这一层看了什么、这一步的结论是什么、花了多久、为什么还要往下走。
 * 字段取值都是稳定的小写短横线记号（写进日志，改含义要发新事件）：
 *  - step：workspace-file（工作区文件）/ declaration（声明文件）/ autodetect（各房认领）/ claim-order（多人认领时的裁剪）
 *  - outcome：hit（给出可用后端）/ miss（没有这份记录）/ unreadable（有记录但读不出）/ unknown-backend（写了后端名但没装）
 *             / pending（认领超时未决）/ error（这一层抛错）/ skipped（没问这一层）
 *  - reason：为什么继续往下走，见下面各处调用点的记号（如 file-missing、skipped-stronger-evidence）
 */
export interface EvidenceStep {
  step: string
  outcome: string
  backendId: string
  ms: number
  reason: string
}

/**
 * 失败档位：判不出来时告诉人“看了哪些地方、缺什么、补什么就能确定”。
 * id 稳定（写进日志与结果），text 是给人看的一句话；detail 是这一档的具体线索（例如没装的那个后端名）。
 */
export interface DecisionGap {
  id: string
  looked: string[]
  missing: string
  fix: string
  text: string
  detail: string
}

/**
 * 证据矛盾（#1048）：两层以上都给出了可用后端且彼此不同时记一条，不静默吞掉。
 * kind 说清是哪两层在打架，ids 是这几层各自报的后端名（去重后按层序），used 是最终采用的那个。
 * 采用谁仍然由「人选 > 声明文件 > 各房认领」决定，矛盾只记录、不翻案。
 */
export interface DecisionConflict {
  kind: string
  ids: string[]
  used: string
}

/**
 * 判定出口的完整答案：选择加写权限与原因，另加内部三态、失败档位、矛盾与步骤轨迹。
 * origin 在这里一定有（纯核的五个分支都会填）。
 */
export type BackendDecision = Omit<Selection, 'ref' | 'origin'> & {
  origin: string
  canWrite: boolean
  reason: string
  ref?: RepositoryRef | null
  state: DecisionState
  missing: string
  gap: DecisionGap | null
  conflict: DecisionConflict | null
  steps: EvidenceStep[]
};

/**
 * 只问「有没有这个后端」的那一格：纯核与已知判断都只用到它，不把整座注册表拽进来。
 */
export interface DecisionRegistry {
  has(id: string): boolean
}

/**
 * 判定出口要用的注册表：问有没有、做自动识别。ctx 收成未知值，
 * 是因为两处交出去的 ctx 只是「够自动识别用的现场」（cwd、平台、文件、调用名），不是完整 OpContext。
 */
export interface DecideRegistry extends DecisionRegistry {
  select(handle: RepoHandle, ctx: unknown): Promise<Selection | null>
}

/**
 * 工作区文件那一层的解析结果：后端 id 加来源档位。
 * 格子按真源（workspace-file.ts 的 WorkspaceChoice）逐个声明，不用索引签名——
 * 接口没有隐式索引签名，带索引签名的目标会让真源的形状传不进来（TS2322）。
 */
export interface WorkspaceFileParsed {
  backendId: string
  source?: unknown
  pickedAt?: number
  layout?: string
}

/**
 * 读文件层要用的外部能力：沙箱文件服务优先，兼容老调用方交的两个函数。
 */
export interface FileLayerDeps {
  fs?: Pick<SandboxFs, 'resolve' | 'readText'> | null
  platform?: { fs?: Pick<SandboxFs, 'resolve' | 'readText'> } | null
  readWorkspaceFileText?: (cwd: string) => Promise<string | null>
  parseWorkspaceFile?: (text: string) => WorkspaceFileParsed | null
}

/**
 * 读声明层要用的外部能力：调用方给了整套解析器就用它的，没给就走本文件自带的 parseIssueTracker
 *（与探测器、工具壳装配层同一套解析器，一次读取一份结论）。
 */
export interface DeclarationLayerDeps {
  fs?: Pick<SandboxFs, 'resolve' | 'readText'> | null
  platform?: { fs?: Pick<SandboxFs, 'resolve' | 'readText'> } | null
  readDeclarationId?: (cwd: string) => Promise<string | null>
  parseDeclaration?: (raw: string) => Promise<string | null> | string | null
}

/**
 * 日志出口最小形状：有 fire 就记结论线；另有 isEnabled 时，调试开关打开才记步骤线。
 * 缺席（例如首帧那条调用今天还没接日志）就什么也不记——判定照做，只是留不下轨迹。
 */
export interface DecisionLogCtx {
  fire(level: string, event: string, fields: Record<string, unknown>): unknown
  isEnabled?(level: string): unknown
}

/**
 * 判定出口的全部外部依赖：各层所需能力加注册表、调用名、中止信号、自动识别钩子与日志出口。
 * 全是可选——调用方手里有什么就给什么，缺的层按「没有这一层」处理。
 */
export interface DecideBackendDeps extends FileLayerDeps, DeclarationLayerDeps {
  registry?: DecideRegistry | null
  caller?: string
  signal?: AbortSignal
  autodetect?: (handle: RepoHandle, ctx: unknown) => Promise<Selection | null>
  skipAutodetect?: boolean
  logCtx?: DecisionLogCtx | null
}

/**
 * 纯核的输入：三层候选加只读注册表。自动识别那一层是契约的选择形状（带引用、待定、多命中）。
 */
export interface DecidePureInput {
  fileParsed?: WorkspaceFileParsed | null
  declarationId?: string | null
  autodetect?: Selection | null
  registry?: DecisionRegistry | null
}

/**
 * 多个后端同时认领时的明文裁剪顺序（#1048·#1047 决策 3）：GitHub > Markdown > GitLab。
 * 名单里没有的房间排在这三个之后（保持它们自己的相对次序）。这条顺序由
 * tests/verify-detection-evidence.ts 钉住，改这里必须同时改那条门禁。
 */
export const MULTI_CLAIM_ORDER: readonly string[] = ['github', 'markdown', 'gitlab'];

// 老路径兜底：切核前常量不存在（只有 yaml），切核后是 json。读永远双路径（新优先、老兼容），与核的读写口同顺序。

// 工作区短指纹（只记散列、不记路径原文）。与 repoKeys.js / detectionService.ts 同一种取法，各文件自带一份是仓里既有写法。
function hash8(text: unknown): string {
  let h = 5381
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

/**
 * 文件来源 → 判定来源：调用方凭它分辨“人选的 / 搬来的 / 生成的 / 机器猜的”。
 * 核认 user/migrated/detected 三档，老 auto 只在读历史文件时出现（新文件不再产出）。
 */
function fileOriginOf(fileSource: unknown): string {
  if (fileSource === 'migrated') return 'file-migrated';
  if (fileSource === 'detected') return 'file-detected';
  if (fileSource === 'auto') return 'file-auto';
  return 'user-file';
}

/**
 * 出口答案 → 调用方选择形状（三处共用一处：探测服务、改色电话、工具壳）。
 * 有后端给 id 加引用（引用缺席现算）；无后端给 fallback；待定与多命中原样带出，由调用方拒绝。
 * 未注册的 id 由调用方先判（hasId），这里只做形状；o 为空（出口抛错）回空，由调用方走老路或诚实失败。
 * 注意：这里交出去的永远只有五个字段（#1048 边界三）——判定内部新加的三态、档位与轨迹不进这条路。
 */
export function selectionFromOutlet(o: DecisionSelection | null | undefined, describeFn?: (backendId: string) => RepositoryRef | null): DecisionSelection | null {
  if (!o) return null;
  if (o.backendId) {
    let ref: RepositoryRef | null = o.ref || null;
    if (!ref && typeof describeFn === 'function') {
      try { ref = describeFn(o.backendId); } catch (e) { ref = null; }
    }
    const out: DecisionSelection = { backendId: o.backendId, source: o.source || 'explicit', ref: ref };
    if (o.multiHit) out.multiHit = o.multiHit;
    if (o.pending) out.pending = o.pending;
    return out;
  }
  if (o.pending) return { backendId: null, source: 'fallback', pending: true, multiHit: o.multiHit };
  return { backendId: null, source: 'fallback' };
}

function isKnown(registry: DecisionRegistry | null | undefined, id: string): boolean {
  try {
    return !!(id && registry && typeof registry.has === 'function' && registry.has(id));
  } catch {
    return false;
  }
}

/**
 * 失败档位表（#1048）：每一档写清「看了哪些地方、缺什么、补什么就能确定」。
 * 档位名（id）稳定，会写进结果与日志；text 是给人看的话，一刀切地平实，不堆术语。
 * {detail} 由 decisionGapOf 用这一档的具体线索替换（例如没装的那个后端名）。
 */
const DECISION_GAPS: Record<string, { looked: string[]; missing: string; fix: string; text: string }> = {
  'workspace-not-ready': {
    looked: [],
    missing: '还不知道这个工作区是哪条目录',
    fix: '等面板认出工作区之后再试',
    text: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区之后再试。',
  },
  'file-unreadable': {
    looked: ['工作区文件 docs/agents/workspace.yaml（老工作区是 docs/agents/workspace.json）'],
    missing: '文件在，但读不出来或者格式不对',
    fix: '把这份文件改回可读的格式（写明用的是哪个后端）',
    text: '工作区文件读不出来：把 docs/agents/workspace.yaml 的格式改对，就能定下来。',
  },
  'file-unknown-backend': {
    looked: ['工作区文件 docs/agents/workspace.yaml（老工作区是 docs/agents/workspace.json）'],
    missing: '文件里写的后端「{detail}」没有装上',
    fix: '装上那个后端，或者把文件里的后端名改成已经装好的那个',
    text: '工作区文件里写的后端「{detail}」没有装上：装上它，或者把文件里那条记录改成已装的后端，就能定下来。',
  },
  'declaration-unreadable': {
    looked: ['声明文件 docs/agents/issue-tracker.md'],
    missing: '文件在，但读不出来',
    fix: '把声明文件补回可读的标题行（例如 `# Issue tracker: GitHub`）',
    text: '声明文件读不出来：把 docs/agents/issue-tracker.md 补回一行写明后端的标题，就能定下来。',
  },
  'declaration-unknown-backend': {
    looked: ['声明文件 docs/agents/issue-tracker.md'],
    missing: '声明文件写明的后端「{detail}」没有装上',
    fix: '装上那个后端，或者把声明文件里的标题改成已装的后端',
    text: '声明文件里写明的后端「{detail}」没有装上：装上它，或者改这一行标题，就能定下来。',
  },
  'autodetect-error': {
    looked: ['各房自己的认领（matches）'],
    missing: '认领这一步抛错了，这一层没拿到结论',
    fix: '把这条提示的原文报告给插件维护者',
    text: '各房认领这一步出错了，没能判断出后端。把这条提示的原文报告给插件维护者。',
  },
  'autodetect-pending': {
    looked: ['工作区文件', '声明文件', '各房自己的认领（matches）'],
    missing: '有房间认领超时，还没问完',
    fix: '等一会儿重试，或者直接在面板上选定一个后端',
    text: '有房间还没问完（认领超时），这一次不敢下结论。等一会儿重试，或直接在面板上选定一个后端。',
  },
  'layer-unavailable': {
    looked: ['工作区文件', '声明文件'],
    missing: '有一层这次根本没看成（读文件的接口没接上）',
    fix: '把这条提示报告给插件维护者（读文件这一层本该接上）',
    text: '有一层这次没看成（读文件的接口没接上），所以这次不算「看过之后确实没有」。',
  },
  'autodetect-unavailable': {
    looked: ['工作区文件', '声明文件'],
    missing: '前两处没认领，而「各房自己认领」这一层这次没问（注册表没接上，或调用方自己把它关了）',
    fix: '把这条提示报告给插件维护者（这一层本该问得上）',
    text: '前两处都没认领，而「各房自己认领」这一层这次没问成。所以只能说没定下来，不能说确实没有后端。',
  },
  'no-claim': {
    looked: ['工作区文件', '声明文件', '各房自己的认领（matches）'],
    missing: '三处都没有认领',
    fix: '在面板上选定一个后端（会写进工作区文件），或者在 docs/agents/issue-tracker.md 里写明用哪个',
    text: '三处都没认领：工作区文件、声明文件、各房自己的匹配都没说是谁。在面板上选定一个后端就能定下来。',
  },
};

/**
 * 取一档失败（带上这一档的具体线索）。档位名不认识就回 null——宁可少说，不编一档出来。
 */
export function decisionGapOf(id: string, detail?: unknown): DecisionGap | null {
  const g = DECISION_GAPS[String(id || '')];
  if (!g) return null;
  const d = String(detail == null ? '' : detail);
  return {
    id: String(id),
    looked: g.looked.slice(),
    missing: g.missing.replace('{detail}', d || '（名字没读出来）'),
    fix: g.fix,
    text: g.text.replace('{detail}', d || '（名字没读出来）'),
    detail: d,
  };
}

/**
 * 认领名单按明文顺序裁剪（#1048）：名单里有的按 MULTI_CLAIM_ORDER 排，名单里没有的
 * 保持它们原来的相对次序排在后面。排序稳定，同一个输入永远同一个答案。
 */
export function orderClaims(claims: readonly string[]): string[] {
  const list = (claims || []).map((x) => String(x)).filter(Boolean);
  const known: string[] = [];
  const rest: string[] = [];
  for (const id of list) {
    if (MULTI_CLAIM_ORDER.indexOf(id) >= 0) { if (known.indexOf(id) < 0) known.push(id) } else if (rest.indexOf(id) < 0) rest.push(id);
  }
  known.sort((a, b) => MULTI_CLAIM_ORDER.indexOf(a) - MULTI_CLAIM_ORDER.indexOf(b));
  return known.concat(rest);
}

/**
 * 证据层写下的“我看到谁”的记录，用来判矛盾。source 就是步骤名。
 */
interface Claim { source: string; backendId: string }

/**
 * 两层以上都给出可用后端、且不是同一个时，说清是哪两层在打架（#1048·#1047 故事 16）。
 * 今天真能发生的只有一种：「我选的」（工作区文件）与「项目里写的」（声明文件）不一致 ——
 * 这两层每次判定都读，两边都读才看得出来。各房认领只在前两层都没给出结论时才问，
 * 所以它不会与前两层同时交出答案；将来若放开「有更确凿的证据也照问」，这里要按来源两两命名扩展。
 * 真出现了今天到不了的组合，就记 `unexpected-layers`：宁可说「这组合不对劲」，也不编一个假的层名。
 */
function conflictOf(claims: readonly Claim[], used: string): DecisionConflict | null {
  const ids: string[] = [];
  for (const c of claims) if (c.backendId && ids.indexOf(c.backendId) < 0) ids.push(c.backendId);
  if (ids.length < 2) return null;
  const hasUser = claims.some((c) => c.source === 'workspace-file');
  const hasDecl = claims.some((c) => c.source === 'declaration');
  const kind = (hasUser && hasDecl) ? 'user-vs-declaration' : 'unexpected-layers';
  return { kind, ids, used: String(used || '') };
}

/**
 * 判定出口的内部骨架：收集步骤、记日志、最后一次性给出答案。
 * 单独抽出来是因为三层读法不同（文件、声明、认领），但“怎么记、怎么收尾”是同一条规矩，
 * 散在三处写迟早会写成三份不一样的日志。
 */
interface DecideRun {
  steps: EvidenceStep[]
  claims: Claim[]
  logCtx: DecisionLogCtx | null
  stepsEnabled: boolean
  t0: number
  step(step: string, outcome: string, ms: number, reason: string, backendId?: string): void
  fireConclusion(winner: DecisionSelection, cwdHash: string, conflict: DecisionConflict | null): void
}

function makeRun(logCtx: DecisionLogCtx | null, stepsEnabled: boolean): DecideRun {
  const steps: EvidenceStep[] = [];
  const claims: Claim[] = [];
  const t0 = Date.now();
  return {
    steps,
    claims,
    logCtx,
    stepsEnabled,
    t0,
    step(step, outcome, ms, reason, backendId) {
      const row: EvidenceStep = { step: String(step), outcome: String(outcome), backendId: String(backendId || ''), ms: Math.max(0, Math.round(ms)), reason: String(reason) };
      steps.push(row);
      if (!stepsEnabled || !logCtx) return;
      // 按需事件：开关开着才发（外层判一次，不开连对象都不建）。
      try { logCtx.fire('debug', 'detection.step', { step: row.step, outcome: row.outcome, backendId: row.backendId, ms: row.ms, reason: row.reason }) } catch (eS) {}
    },
    fireConclusion(winner, cwdHash, conflict) {
      if (!logCtx || typeof logCtx.fire !== 'function') return;
      // 平时只有这一条结论（#1047 决策 5）：判到哪个后端、来源、三态、花了多久、有没有矛盾。
      try {
        logCtx.fire('info', 'detection.detect', {
          cwdHash: String(cwdHash || ''),
          explicit: winner.source === 'explicit',
          matches: (winner.multiHit && winner.multiHit.length) ? winner.multiHit.length : (winner.source === 'matches' ? 1 : 0),
          pending: !!winner.pending,
          selection: String(winner.backendId || ''),
          origin: String(winner.origin || ''),
          state: winner.backendId ? 'decided' : (winner.pending ? 'undetermined' : 'no-backend'),
          latencyMs: Date.now() - t0,
          conflict: conflict ? conflict.kind : '',
        });
      } catch (eL) {}
    },
  };
}

/**
 * 统一判定的纯核：输入已经读到的各层候选，输出唯一答案。
 * 不碰文件系统与注册表，只做排序，方便单测与三处共用。
 * #1003 契约（2026-10-12 维护者拍板）：本机记忆只用来把工作区配置文件生成出来一次，
 *   此后不再参与任何判定，所以纯核里没有记忆这一层。
 * #1138（2026-10-14）：注册表里那份进程内绑定同样不再参与判定，纯核里也没有它那一层——
 *   判定顺序是「工作区文件 → 声明文件 → 自动识别」。
 */
export function decidePure({ fileParsed, declarationId, autodetect, registry }: DecidePureInput): DecisionSelection {
  if (fileParsed && fileParsed.backendId && isKnown(registry, fileParsed.backendId)) {
    const origin = fileOriginOf(fileParsed.source);
    return { backendId: fileParsed.backendId, source: 'explicit', origin };
  }
  if (declarationId && isKnown(registry, declarationId)) {
    return { backendId: declarationId, source: 'explicit', origin: 'declaration' };
  }
  if (autodetect && autodetect.backendId && isKnown(registry, autodetect.backendId)) {
    return { backendId: autodetect.backendId, source: autodetect.source || 'matches', origin: 'autodetect', ref: autodetect.ref || null, multiHit: autodetect.multiHit, pending: autodetect.pending };
  }
  if (autodetect && autodetect.pending) {
    return { backendId: null, source: 'fallback', origin: 'pending', pending: true };
  }
  return { backendId: null, source: 'fallback', origin: 'none' };
}

/**
 * 工作区文件那一层的读法：新文件优先、老文件兼容（与核的读口同顺序；老 json 只作兼容读）。
 * 回的是「读到了什么 + 这一步的结论」，不是光秃秃的解析结果——判不出来时要说得出缺什么（#1048）。
 */
interface FileLayerRead { parsed: WorkspaceFileParsed | null; outcome: string; reason: string }

async function readFileLayer(cwd: string, deps: FileLayerDeps): Promise<FileLayerRead> {
  const rels: string[] = [String(WORKSPACE_FILE_REL)];
  const legacyRel = (workspaceFileNS.WORKSPACE_FILE_LEGACY_REL || 'docs/agents/workspace.json');
  // 两个常量在类型层面是互不相交的字面量（yaml 与 json），直接比会报 TS2367；
  // 运行时它们都是字符串，这里按字符串比，行为与原来完全一致。
  if (legacyRel && (legacyRel as string) !== (WORKSPACE_FILE_REL as string)) rels.push(String(legacyRel));
  let sawFile = false;
  let sawBroken = false;
  try {
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      for (const rel of rels) {
        try {
          const target = await fsSvc.resolve(rel, { cwd });
          const txt = await fsSvc.readText(target);
          sawFile = true;
          const parsed = parseWorkspaceFile(txt);
          if (parsed && parsed.backendId) return { parsed, outcome: 'hit', reason: 'file-hit' };
          // 文件在，但里面没有可用的后端名：继续试下一个路径（老文件可能才是那份），都试完再说“读不出”。
          sawBroken = true;
        } catch (eOne) { /* 这条路径没有或读坏就试下一条 */ }
      }
      if (sawBroken) return { parsed: null, outcome: 'unreadable', reason: 'file-unreadable' };
      return { parsed: null, outcome: 'miss', reason: sawFile ? 'file-no-backend' : 'file-missing' };
    }
    if (typeof deps.readWorkspaceFileText === 'function' && typeof deps.parseWorkspaceFile === 'function') {
      const txt = await deps.readWorkspaceFileText(cwd);
      if (!txt) return { parsed: null, outcome: 'miss', reason: 'file-missing' };
      const parsed = deps.parseWorkspaceFile(txt);
      if (parsed && parsed.backendId) return { parsed, outcome: 'hit', reason: 'file-hit' };
      return { parsed: null, outcome: 'unreadable', reason: 'file-no-backend' };
    }
  } catch (eFile) {
    return { parsed: null, outcome: 'error', reason: 'file-error' };
  }
  return { parsed: null, outcome: 'miss', reason: 'file-layer-unavailable' };
}

/**
 * 声明文件那一层的读法：调用方给了读法就用它的，没给就自己经沙箱文件服务读原文，
 * 用 parseIssueTracker 解析（与探测器、工具壳装配层同一套解析器 —— 一次读取、一份结论，#1048）。
 */
interface DeclarationLayerRead { id: string; outcome: string; reason: string }

async function readDeclarationLayer(cwd: string, deps: DeclarationLayerDeps): Promise<DeclarationLayerRead> {
  try {
    if (typeof deps.readDeclarationId === 'function') {
      const did = await deps.readDeclarationId(cwd);
      if (typeof did === 'string' && did) return { id: did, outcome: 'hit', reason: 'declaration-hit' };
      return { id: '', outcome: 'miss', reason: 'declaration-missing' };
    }
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      let raw: unknown = null;
      try {
        const target = await fsSvc.resolve('docs/agents/issue-tracker.md', { cwd });
        raw = await fsSvc.readText(target);
      } catch (eRead) {
        return { id: '', outcome: 'miss', reason: 'declaration-missing' };
      }
      if (typeof deps.parseDeclaration === 'function') {
        const did2 = await deps.parseDeclaration(raw as string);
        if (typeof did2 === 'string' && did2) return { id: did2, outcome: 'hit', reason: 'declaration-hit' };
        return { id: '', outcome: 'miss', reason: 'declaration-no-backend' };
      }
      const parsed = parseIssueTracker(raw);
      if (parsed && parsed.explicitBackendId) return { id: parsed.explicitBackendId, outcome: 'hit', reason: 'declaration-' + parsed.reason };
      return { id: '', outcome: 'miss', reason: 'declaration-no-backend' };
    }
  } catch (eDecl) {
    return { id: '', outcome: 'error', reason: 'declaration-error' };
  }
  return { id: '', outcome: 'miss', reason: 'declaration-layer-unavailable' };
}

/**
 * 唯一判定出口：输入工作区根，输出 { backendId, source, origin, canWrite, reason } 加内部三态与轨迹。
 * 空根直接按未知返回，不读文件、不问注册表、不起外部命令。
 *
 * 下面这三层只有两类（2026-10-12 维护者拍板，全文见 docs/adr/20261012-backend-decision-two-classes.md；
 * #1138 之后「人选」那一类只剩一份记录）：
 *
 * 一、**人选**（第 1 层）——只有一份记录：工作区配置文件 docs/agents/workspace.yaml。
 *   它是人选的唯一真源：跨宿主重启、跨机器、以及从别人那儿克隆过来的仓库，都靠它。
 *   #1138 之前这里还有一层「注册表里的进程内绑定」，与这份文件记的是同一件事的两份记录（宿主重启即消失）。
 *   整层删掉了：一次动作只写一份，写成功才算这次选择生效（写入口见 src/host/workspaceCwd.js 的 handleBind）。
 *
 * 二、**程序自己认**（第 2、3 层）——都不是人选：
 *   第 2 层读工作区里的声明文件 docs/agents/issue-tracker.md（仓库里写明用哪个后端，由初始化那一步的
 *   AI 写下，插件自己不写）；
 *   第 3 层是后端自己的 matches 命中（看 .git/config、看目录里有没有 .scratch/map.md 之类）。
 *   声明文件同时也是第 3 层里 matches 的输入（见 src/host/tracker/backends/gitlab/index.js 的 matches
 *   注释），所以它是「程序自己认」的一条规则，不是人选。
 *
 * 写权限今天只给人选：第 1 层 canWrite: true；第 2、3 层 canWrite: false（reason: 'needs-generate'）。
 * 读用途不受这条限制；写用途的拦截在 src/shared/deck-tools/shell.js 与 src/host/workspaceLabelColors.js。
 */
export async function decideBackend(root: unknown, deps: DecideBackendDeps = {}): Promise<BackendDecision> {
  const cwd = String(root || '');
  const logCtx = (deps.logCtx || null) as DecisionLogCtx | null;
  // 调试开关只在外层判一次：不开就不建步骤对象、不发步骤线；结论线照发（常驻）。
  let stepsEnabled = false;
  try { stepsEnabled = !!(logCtx && typeof logCtx.isEnabled === 'function' && logCtx.isEnabled('debug')); } catch (eSw) { stepsEnabled = false; }
  const run = makeRun(logCtx, stepsEnabled);
  const cwdHash = hash8(cwd);
  if (!cwd) {
    // 空目录：不读文件、不起命令，如实说“工作区还没就绪”（#1003 空目录闸）。
    const gap = decisionGapOf('workspace-not-ready');
    const blank: DecisionSelection = { backendId: null, source: 'unknown', origin: 'unknown-workspace' };
    run.fireConclusion(blank, cwdHash, null);
    return { backendId: null, source: 'unknown', origin: 'unknown-workspace', canWrite: false, reason: 'workspace-not-ready', state: 'undetermined', missing: gap ? gap.missing : '', gap, conflict: null, steps: run.steps };
  }
  const registry = deps.registry || null;
  const handle = { cwd };

  // ① 人选那一层：工作区文件。每次都读（便宜、无副作用，矛盾靠它才看得出来）。
  const tFile = Date.now();
  const fileRead = await readFileLayer(cwd, deps);
  const fileParsed = fileRead.parsed;
  if (fileRead.outcome === 'hit' && fileParsed) {
    // 记这一步之前先把「这个后端装没装」问清：装了才叫这一层给出了可用结论（hit），
    // 没装是 unknown-backend —— 两件事写进日志与结果必须是同一个结论，不能一步两说。
    if (isKnown(registry, fileParsed.backendId)) {
      run.step('workspace-file', 'hit', Date.now() - tFile, fileRead.reason, fileParsed.backendId);
      run.claims.push({ source: 'workspace-file', backendId: fileParsed.backendId });
    } else {
      fileRead.outcome = 'unknown-backend';
      fileRead.reason = 'file-backend-unknown';
      run.step('workspace-file', 'unknown-backend', Date.now() - tFile, fileRead.reason, fileParsed.backendId);
    }
  } else {
    run.step('workspace-file', fileRead.outcome, Date.now() - tFile, fileRead.reason, fileParsed ? fileParsed.backendId : '');
  }
  const fileHit = (fileRead.outcome === 'hit' && fileParsed) ? fileParsed : null;

  // ② 程序自己认的第一条：声明文件。同样每次都读 —— 出口原来那套只看标题的解析器已删，
  //    现在与探测器、工具壳装配层共用 parseIssueTracker 一套，一次读取、一份结论。
  const tDecl = Date.now();
  const declRead = await readDeclarationLayer(cwd, deps);
  let declUnknown = false;
  if (declRead.outcome === 'hit') {
    if (isKnown(registry, declRead.id)) {
      run.step('declaration', 'hit', Date.now() - tDecl, declRead.reason, declRead.id);
      run.claims.push({ source: 'declaration', backendId: declRead.id });
    } else {
      declUnknown = true;
      run.step('declaration', 'unknown-backend', Date.now() - tDecl, 'declaration-backend-unknown', declRead.id);
    }
  } else {
    run.step('declaration', declRead.outcome, Date.now() - tDecl, declRead.reason, '');
  }
  const declHit = (declRead.outcome === 'hit' && !declUnknown) ? declRead.id : '';

  // ③ 程序自己认的第二条：各房认领（matches）。这一层会真花配额与时间，只在前两层都没给出
  //    可用结论时才问 —— 它是最弱的一层，跳过它不会错过更确凿的证据；跳过本身也记一条，事后读得出原因。
  let autodetect: Selection | null = null;
  let autoRan = false;
  let autoOutcome = 'skipped';
  let autoReason = '';
  let autoMs = 0;
  const needAutodetect = !fileHit && !declHit;
  if (deps.skipAutodetect === true) {
    autoReason = 'skipped-by-caller';
    run.step('autodetect', 'skipped', 0, autoReason, '');
  } else if (!needAutodetect) {
    autoReason = 'skipped-stronger-evidence';
    run.step('autodetect', 'skipped', 0, autoReason, '');
  } else {
    // 补全点之二：下面两处交出去的 ctx 都一定带 `caller`（调用方给了就用调用方的，
    // 没给就填 `backend-decision`），形状见契约里的 `EnrichedOpContext`。下游只许读，不许再改。
    const tAuto = Date.now();
    try {
      if (typeof deps.autodetect === 'function') {
        // 可选钩子：调用方把自己的自动识别包一层再交进来（例如工具壳把配额闸包在外面，
        // 行为与直接调注册表一致，只多记账）。不传钩子时直调注册表，其余三路走这一条。
        const ctx = { cwd, platform: deps.platform || null, fs: deps.fs || null, caller: deps.caller || 'backend-decision', signal: deps.signal };
        autodetect = await deps.autodetect(handle, ctx);
        autoRan = true;
      } else if (registry && typeof registry.select === 'function') {
        const ctx = { cwd, platform: deps.platform || null, fs: deps.fs || null, caller: deps.caller || 'backend-decision', signal: deps.signal };
        autodetect = await registry.select(handle, ctx);
        autoRan = true;
      } else {
        // 连问都问不了（没注册表可问）：如实记“没问”，不当成“问过了没人认领”。
        autoOutcome = 'skipped';
        autoReason = 'no-registry';
      }
    } catch (eAuto) {
      autodetect = null;
      autoRan = true;
      autoOutcome = 'error';
      autoReason = 'matches-error';
    }
    autoMs = Date.now() - tAuto;
    if (autoRan && autoOutcome !== 'error') {
      if (autodetect && autodetect.backendId) {
        const known = isKnown(registry, autodetect.backendId);
        autoOutcome = known ? 'hit' : 'unknown-backend';
        autoReason = known ? 'matches-hit' : 'matches-backend-unknown';
      } else if (autodetect && autodetect.pending) {
        autoOutcome = 'pending';
        autoReason = 'matches-pending';
      } else {
        autoOutcome = 'miss';
        autoReason = 'matches-no-claim';
      }
    }
    run.step('autodetect', autoOutcome, autoMs, autoReason, autodetect && autodetect.backendId ? autodetect.backendId : '');
  }

  // ④ 合成：人选 > 声明文件 > 各房认领。顺序是明文规则，后面的证据只进日志，不翻前面的案。
  // winner 的 origin 在下面四个分支里都会填（字面量），这里用交叉类型一次写清，
  // 免得出口组装时还要再断言一次（DecisionSelection 里的 origin 是可选的，那是给纯核与旧出口留的）。
  let winner: DecisionSelection & { origin: string };
  let canWrite = false;
  let reason = '';
  if (fileHit) {
    winner = { backendId: fileHit.backendId, source: 'explicit', origin: fileOriginOf(fileHit.source) };
    canWrite = true;
  } else if (declHit) {
    winner = { backendId: declHit, source: 'explicit', origin: 'declaration' };
    reason = 'needs-generate';
  } else if (autodetect && autodetect.backendId && isKnown(registry, autodetect.backendId)) {
    // 多个后端同时认领时按明文顺序裁剪（#1048）：名单来自注册表给的 multiHit，裁剪结果由本出口说了算。
    // 只有一个认领时原样透传（multiHit 该是 undefined 就还是 undefined：那是对外五个字段里的一个）。
    const claims = (autodetect.multiHit && autodetect.multiHit.length) ? autodetect.multiHit.map((x) => String(x)) : [];
    let picked = String(autodetect.backendId);
    let outMultiHit = autodetect.multiHit;
    if (claims.length > 1) {
      const ordered = orderClaims(claims);
      if (ordered.length && ordered.indexOf(picked) !== 0) picked = ordered[0];
      outMultiHit = ordered;
      run.step('claim-order', 'hit', 0, 'plain-order', picked);
    }
    winner = { backendId: picked, source: autodetect.source || 'matches', origin: 'autodetect', ref: autodetect.ref || null, multiHit: outMultiHit, pending: autodetect.pending };
    reason = 'needs-generate';
  } else if (autodetect && autodetect.pending) {
    winner = { backendId: null, source: 'fallback', origin: 'pending', pending: true };
    reason = 'pending';
  } else {
    winner = { backendId: null, source: 'fallback', origin: 'none' };
    // 对外五个字段里的 reason 保持 #1003 期的取值不变（调用方认这个字面量）；
    // 「这次到底问没问过各房」由下面的 state 与 gap 如实表达，不挤进 reason。
    reason = 'no-backend';
  }
  if (autoOutcome === 'hit' && autodetect && autodetect.backendId) run.claims.push({ source: 'autodetect', backendId: String(autodetect.backendId) });
  const conflict = conflictOf(run.claims, String(winner.backendId || ''));

  // ⑤ 三态与失败档位：判不出来时把“缺什么、补什么”一并给出（#1048）。档位按证据顺序取第一条最具体的。
  let state: DecisionState = 'decided';
  let gap: DecisionGap | null = null;
  if (!winner.backendId) {
    const pendingOnly = !!winner.pending;
    // 「确实没有」要两处文件都明确说没有、且各房认领也真问过（问过没人认领）才算数。
    // 少一个条件就退回「没定下来」：宁可说不知道，也不把「没看成 / 没问成」写成「没有」。
    const fileCleanMiss = fileRead.outcome === 'miss' && (fileRead.reason === 'file-missing' || fileRead.reason === 'file-no-backend');
    const declCleanMiss = declRead.outcome === 'miss' && (declRead.reason === 'declaration-missing' || declRead.reason === 'declaration-no-backend');
    const nothingThere = fileCleanMiss && declCleanMiss && autoRan && autoOutcome === 'miss';
    state = pendingOnly ? 'undetermined' : (nothingThere ? 'no-backend' : 'undetermined');
    if (fileRead.outcome === 'unknown-backend' && fileParsed) gap = decisionGapOf('file-unknown-backend', fileParsed.backendId);
    else if (fileRead.outcome === 'unreadable' || fileRead.outcome === 'error') gap = decisionGapOf('file-unreadable');
    else if (fileRead.reason === 'file-layer-unavailable') gap = decisionGapOf('layer-unavailable');
    else if (declUnknown) gap = decisionGapOf('declaration-unknown-backend', declRead.id);
    else if (declRead.outcome === 'error') gap = decisionGapOf('declaration-unreadable');
    else if (declRead.reason === 'declaration-layer-unavailable') gap = decisionGapOf('layer-unavailable');
    else if (autoOutcome === 'error') gap = decisionGapOf('autodetect-error');
    else if (pendingOnly || autoOutcome === 'pending') gap = decisionGapOf('autodetect-pending');
    // 没问过各房（没有注册表可问，或调用方自己把这一层关了）就不能说“确实没有后端”：
    // 这档如实说“问不了”，免得把「没人认领」与「没问」混成一句话。
    else if (!autoRan) gap = decisionGapOf('autodetect-unavailable');
    else gap = decisionGapOf('no-claim');
  }

  run.fireConclusion(winner, cwdHash, conflict);
  return {
    backendId: winner.backendId,
    source: winner.source,
    origin: winner.origin,
    canWrite,
    reason,
    ref: winner.ref || null,
    multiHit: winner.multiHit,
    pending: winner.pending,
    state,
    missing: gap ? gap.missing : '',
    gap,
    conflict,
    steps: run.steps,
  };
}

export default { decideBackend, decidePure, selectionFromOutlet, MULTI_CLAIM_ORDER, orderClaims, decisionGapOf };
