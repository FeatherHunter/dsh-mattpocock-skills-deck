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
 * #1048（2026-10-14，按讨论票 #1047 的结论落地）——二期把「收集证据」与「判断」拆成两件事。
 * 这么拆不是为了好看：它们回答的是两个不同的问题，混在一个函数里才让「要不要多问一层」变成
 * 一个说不清的局部布尔值。
 *
 *  - **收集**（壳，会读文件、问注册表）回答「我看到了什么」，按**证据范围**收：
 *      · `decisive`（要一个结论）：按优先级依次收，高优先级那层一旦给出可用结论就停，
 *        低优先级层记一条「被更强的证据压过」。这不是偷工——优先级是全序
 *        （人选 > 声明文件 > 各房认领），高优先级一旦给出结论，低优先级层按定义不可能翻案，
 *        所以 decisive 收到的证据对**结论**是充分的；它少的只是「如果问了低优先级层会说什么」
 *        这一份诊断信息，而这份信息由下面的覆盖度如实标出。
 *      · `exhaustive`（要一份诊断）：三层全收，跨层矛盾（例如「我选的」与「各房认出来的」不一致）
 *        这时才可能被看见。
 *    范围由 `resolveEvidenceScope` 一处决定：调试开关打开即 exhaustive —— 「平时一条结论、
 *    出问题开调试开关记全过程」（#1047 决策 5）在这里延伸成证据分层。
 *  - **判断**（纯核，不碰 IO）回答「按这些证据该判谁」：`synthesize` 只吃一份证据报告，
 *    产出结论、三态、失败档位、矛盾与覆盖度；`pickVerdict` 就是按 `EVIDENCE_PRIORITY`
 *    取第一条结论。纯核可以脱离假文件系统直接断言，门禁因此钉得住规则本身。
 *  - **覆盖度诚实**：结果里带 `coverage`（这次真看了哪几层、哪几层是有意没看、为什么），
 *    这样「没有发现矛盾」永远不等于「没有去看」——与三态同一条原则：宁可说没查清，不说查清了没有。
 *  - **一份规则**：三层优先级（`EVIDENCE_PRIORITY`）、多房裁剪顺序（`MULTI_CLAIM_ORDER`）、
 *    失败档位各只有一处声明；`decidePure` 也走同一条合成规则，不再另写一套判断。
 *  - **明文裁剪顺序**：多个后端同时认领时按 `MULTI_CLAIM_ORDER`（GitHub > Markdown > GitLab）
 *    取第一个。今天这个顺序是装配顺序（src/host/platformChannel.js 的 github → markdown → gitlab）
 *    碰巧给的，这里升成明文规则，由 tests/verify-detection-evidence.ts 钉住，免得以后有人调装配
 *    顺序就悄悄改掉了判定。声明文件里写多行标题时的互斥顺序不归这里管，仍由 parseIssueTracker
 *    那套（GitLab > Markdown > GitHub）说了算：三个顺序管三件事，各有各的名字，不互相借。
 *  - **一份解析器**：声明文件原来被两套解析器各读一遍，优先级还不一样，同一次探测能得出两个结论。
 *    现在出口也用 `parseIssueTracker`，一次读取、一份结论。
 *  - **内部三态**：`state` = decided（有结论）/ undetermined（判不出来，缺什么写在 missing 与 gap 里）/
 *    no-backend（明确没有后端：各房认领问过了，谁都没认领、也没有超时未决）。
 *  - **对外五个字段一个不动**：上层经 `selectionFromOutlet` 拿到的仍然是
 *    backendId / source / ref / multiHit / pending 这五个；state / missing / gap / conflict / coverage /
 *    steps 是给排查、给门禁、给将来界面的内部字段。
 *  - **日志分层**：平时一条结论（常驻事件 `detection.detect`，由本文件发射，含来源、三态、档位、
 *    覆盖度、耗时、矛盾）；调试开关打开时每个证据步骤各记一行（按需事件 `detection.step`，
 *    含步骤、这一步的结论、耗时、为什么继续往下走）。开关只在外层判一次，不开就不建步骤对象。
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

/* ══════════════════════════════════════════════════════════════════════════════
 * 一、证据的形状：层与全序（政策即数据）
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * 证据层。取值就是步骤行里的 `step` 取值（稳定，写进日志，改含义要发新事件）：
 * workspace-file（工作区文件里人选的那一层）/ declaration（声明文件那一层）/ autodetect（各房认领）。
 */
export type EvidenceTier = 'workspace-file' | 'declaration' | 'autodetect'

/**
 * 三层证据的优先级，**唯一的声明处**：人选 > 声明文件 > 各房认领。
 * 它是一条全序，判断因此可以「取第一条结论」而不必两两比较，也无所谓谁先谁后地问。
 */
export const EVIDENCE_PRIORITY: readonly EvidenceTier[] = ['workspace-file', 'declaration', 'autodetect']

/**
 * 证据范围：收多深由问的人想干什么决定。
 *  - decisive：要一个结论。高优先级层给出结论就停。
 *  - exhaustive：要一份诊断。三层全收，跨层矛盾才看得见。
 */
export type EvidenceScope = 'decisive' | 'exhaustive'

/**
 * 一层证据这一步的结论用词（稳定，写进步骤行）：
 * hit（给出可用后端）/ miss（看过了，这一层没有可用的记录）/ unreadable（记录在但读不出、格式不对）
 * / unknown-backend（写了后端名，但那个后端没装上）/ pending（认领超时未决）/ error（这一步出错了）
 * / skipped（有意没看这一层）。
 */
export type EvidenceOutcomeWord = 'hit' | 'miss' | 'unreadable' | 'unknown-backend' | 'pending' | 'error' | 'skipped'

/**
 * 这一层这一步的意义分四类，与用词的关系写在下面的构造函数里：
 * verdict（给出了可用结论）/ abstain（看过了，没有结论）/ unavailable（没看成或问不成）/ skipped（有意没看）。
 * 判断层只认 kind，日志层只认 outcome，两者不许对不上——所以只经构造函数产出。
 */
export type EvidenceKind = 'verdict' | 'abstain' | 'unavailable' | 'skipped'

/**
 * 一层证据的收集结果：这一步看了什么、结论是什么、为什么。
 * 可选格只在特定层有意义：fileSource 只有工作区文件层有（user / migrated / detected / auto，
 * 用来分辨人选与搬来的记录）；multiHit / pending / ref / source 只有各房认领层有。
 */
export interface TierEvidence {
  tier: EvidenceTier
  kind: EvidenceKind
  outcome: EvidenceOutcomeWord
  reason: string
  backendId: string
  fileSource?: unknown
  source?: SelectionSource
  multiHit?: string[]
  pending?: true
  ref?: RepositoryRef | null
}

/**
 * 覆盖度：这次真看了哪几层、哪几层是有意没看、为什么。
 * 它存在的理由只有一条：让「没有发现矛盾」与「没有去看」分得开（与三态同一条原则）。
 */
export interface DecisionCoverage {
  scope: EvidenceScope
  checked: EvidenceTier[]
  skipped: { tier: EvidenceTier; why: string }[]
}

/** 一份证据报告：收集层的产出，判断层的唯一输入。 */
export interface EvidenceReport {
  evidence: TierEvidence[]
  scope: EvidenceScope
}

/**
 * 一条已经定下来的结论。与对外五个字段的区别：这里还带写权限与原因，
 * 因为「人选才能写」这条规矩是判定层算出来的，不是调用方各自再说一遍。
 */
export interface Verdict {
  backendId: string
  source: SelectionSource
  origin: string
  ref?: RepositoryRef | null
  multiHit?: string[]
  pending?: true
  canWrite: boolean
  reason: string
}

/** 判断层的产出：交给上层的选择形状 + 写权限原因 + 三态、档位、矛盾、覆盖度。 */
export interface DecisionSynthesis {
  verdict: Verdict | null
  selection: DecisionSelection
  canWrite: boolean
  reason: string
  state: DecisionState
  gap: DecisionGap | null
  conflict: DecisionConflict | null
  coverage: DecisionCoverage
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 二、对外契约与外部依赖（形状一个不动，#1048 边界三）
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * 判定里流转的选择形状：就是契约的 Selection，只是引用缺席时按 null 写（契约里那格是可选）。
 * 这样写是因为三处调用方都按 `o.ref || null` 读，缺席与 null 在它们眼里是同一回事。
 */
export type DecisionSelection = Omit<Selection, 'ref'> & {
  ref?: RepositoryRef | null
};

/**
 * 「这个结论怎么来的」的四种取值，直接取自契约（不另立一份，免得两处各说各话）。
 * 内部一概用这一份：谁要是写了个契约里没有的来源名，类型检查当场红。
 */
export type SelectionSource = Selection['source'];

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
 *  - outcome：见 EvidenceOutcomeWord
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
 * kind 说清是哪几层在打架，ids 是这几层各自报的后端名（去重后按层序），used 是最终采用的那个。
 * 采用谁仍然由 EVIDENCE_PRIORITY 决定，矛盾只记录、不翻案。
 *
 * 矛盾平时看得见哪几种，取决于证据范围：decisive 时后一层不会与前面同时交出答案，
 * 所以真能发生的只有「我选的 vs 项目里写的」；exhaustive（调试开关打开）时三层都可能各说各话，
 * 这时按实际参与的层两两命名（user-vs-autodetect / declaration-vs-autodetect / 三层）。
 */
export interface DecisionConflict {
  kind: string
  ids: string[]
  used: string
}

/**
 * 判定出口的完整答案：选择加写权限与原因，另加内部三态、失败档位、矛盾、覆盖度与步骤轨迹。
 * origin 在这里一定有（判断层的每个分支都会填）。
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
  coverage: DecisionCoverage
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
  /**
   * 证据范围（#1048 收口补做）：`decisive` 只要一个结论（默认，与今天逐格一致）；
   * `exhaustive` 三层全收，要的是诊断（跨层矛盾只有三层都问过才看得见）。
   *
   * 为什么做成入参而不是继续读日志开关：**范围属于判定，不属于日志**。范围决定的是
   * 「问哪几层」，这件事与「记不记日志」是两件事；把能力挂在日志开关上，等于说
   * 「想审计就得先开日志」，将来界面要给一个「诊断」动作时无处可挂。调试开关今天
   * 仍然是触发 exhaustive 的入口之一（见 resolveEvidenceScope），但它是入口，不是主人。
   * 放宽范围只多问低层，翻不了已经作出的裁决（优先级是全序），这条被门禁逐格钉住。
   */
  scope?: EvidenceScope
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

/* ══════════════════════════════════════════════════════════════════════════════
 * 三、小工具
 * ════════════════════════════════════════════════════════════════════════════ */

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
 * 注意：这里交出去的永远只有五个字段（#1048 边界三）——判定内部新加的三态、档位、覆盖度与轨迹不进这条路。
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
 * 这个错误是不是「文件不在」（而不是「读的时候出了别的问题」）。
 * 为什么要分：把「读不成」记成「没有这份文件」，会让判定层得出「查清了，确实没有后端」——
 * 那是句假话。分不出来时一律当作「读不成」（宁可说没查清）。
 */
function isMissingFileError(e: unknown): boolean {
  const asRecord = (e && typeof e === 'object') ? (e as Record<string, unknown>) : null;
  const code = asRecord ? String(asRecord['code'] || '') : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') return true;
  const msg = asRecord && asRecord['message'] != null ? String(asRecord['message']) : String(e == null ? '' : e);
  return /ENOENT|ENOTDIR|no such file|not found|找不到|不存在/i.test(msg);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 四、证据的构造函数（kind 与 outcome 只在这里配对，别处不许手写）
 * ════════════════════════════════════════════════════════════════════════════ */

/** 这一层给出了可用结论：kind=verdict，日志用词 hit。 */
export function verdictEvidence(tier: EvidenceTier, backendId: string, reason: string, extra: Partial<TierEvidence> = {}): TierEvidence {
  return Object.assign({ tier: tier, kind: 'verdict' as EvidenceKind, outcome: 'hit' as EvidenceOutcomeWord, reason: String(reason), backendId: String(backendId || '') }, extra);
}

/** 看过了，这一层没有可用的记录：kind=abstain，日志用词 miss。 */
export function abstainEvidence(tier: EvidenceTier, reason: string): TierEvidence {
  return { tier: tier, kind: 'abstain', outcome: 'miss', reason: String(reason), backendId: '' };
}

/** 没看成 / 问不成 / 认了个没装的后端：这一层拿不到结论。 */
export function unavailableEvidence(tier: EvidenceTier, outcome: EvidenceOutcomeWord, reason: string, backendId = ''): TierEvidence {
  return { tier: tier, kind: 'unavailable', outcome: outcome, reason: String(reason), backendId: String(backendId || '') };
}

/** 有意没看这一层：why 是原因（写进覆盖度），reason 是步骤行里的原因用词。 */
export function skippedEvidence(tier: EvidenceTier, reason: string): TierEvidence {
  return { tier: tier, kind: 'skipped', outcome: 'skipped', reason: String(reason), backendId: '' };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 五、判断（纯核：不碰文件系统、不问注册表，只吃一份证据报告）
 * ════════════════════════════════════════════════════════════════════════════ */

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
  // 「读不成」与「没有这份文件」是两件事：前者是没查清，后者才够格说「确实没有」。
  // 分成两档是为了让日志与结果都别把没查清说成没有（这一档是 #1048 复核时补的）。
  'file-read-failed': {
    looked: ['工作区文件 docs/agents/workspace.yaml（老工作区是 docs/agents/workspace.json）'],
    missing: '这份文件可能在，但这次没读成（读的时候出错了，不是「文件不存在」）',
    fix: '确认这个目录现在能读，再试一次；还不行就把这条提示报告给插件维护者',
    text: '工作区文件这次没读成（不是文件不存在，是读的时候出错了）：确认这个目录能读之后再试一次，就能定下来。',
  },
  'file-unknown-backend': {
    looked: ['工作区文件 docs/agents/workspace.yaml（老工作区是 docs/agents/workspace.json）'],
    missing: '文件里写的后端「{detail}」没有装上',
    fix: '装上那个后端，或者把文件里的后端名改成已经装好的那个',
    text: '工作区文件里写的后端「{detail}」没有装上：装上它，或者把文件里那条记录改成已装的后端，就能定下来。',
  },
  'declaration-unreadable': {
    looked: ['声明文件 docs/agents/issue-tracker.md'],
    missing: '文件在，但读不出来或者里面没有写后端',
    fix: '把声明文件补回可读的标题行（例如 `# Issue tracker: GitHub`）',
    text: '声明文件里读不出后端：把 docs/agents/issue-tracker.md 补回一行写明后端的标题，就能定下来。',
  },
  'declaration-read-failed': {
    looked: ['声明文件 docs/agents/issue-tracker.md'],
    missing: '这份文件可能在，但这次没读成（读的时候出错了，不是「文件不存在」）',
    fix: '确认这个文件现在能读，再试一次；还不行就把这条提示报告给插件维护者',
    text: '声明文件这次没读成（不是文件不存在，是读的时候出错了）：确认这个文件能读之后再试一次，就能定下来。',
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
  // #1048 复核补的一档：各房认出来的是个没装上的后端，原来的档位链会落到「三处都没认领」，
  // 那是与事实相反的一句话（步骤行里明明记着认出了谁）。
  'claim-unknown-backend': {
    looked: ['各房自己的认领（matches）'],
    missing: '各房认出来的是「{detail}」，但那个后端没有装上',
    fix: '装上那个后端，或者把工作区文件、声明文件里的后端名改成已经装好的那个',
    text: '各房认出来的是「{detail}」，但这个后端没有装上：装上它，或者把「我选的」与「项目里写的」改成已装的后端，就能定下来。',
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
 * 各房给的认领按明文顺序归一：多命中时把名单排序，并按排序结果定下采用谁。
 * 注册表给的 backendId 只是「装配顺序里的第一个」，不是明文规则的结果 —— 出口说了算，
 * 所以这一步留在纯核里，可以脱离注册表直接断言（门禁因此钉得住规则本身）。
 */
export function normalizeClaim(sel: Selection | null | undefined): { backendId: string; multiHit?: string[]; reordered: boolean } {
  const id = (sel && sel.backendId) ? String(sel.backendId) : '';
  const raw = (sel && sel.multiHit && sel.multiHit.length) ? sel.multiHit.map((x) => String(x)) : [];
  if (raw.length <= 1) return { backendId: id, multiHit: (sel && sel.multiHit) ? sel.multiHit : undefined, reordered: false };
  const ordered = orderClaims(raw);
  const useFirst = ordered.length > 0 && ordered.indexOf(id) !== 0;
  return { backendId: useFirst ? ordered[0] : id, multiHit: ordered, reordered: useFirst };
}

/**
 * 按 EVIDENCE_PRIORITY 取第一条结论。全序下这就是全部判断：取到谁就是谁，后面的证据不翻案。
 * 拿不到结论回 null，由 synthesize 去算三态与档位。
 */
export function pickVerdict(evidence: readonly TierEvidence[]): Verdict | null {
  const rows = evidence || [];
  for (const tier of EVIDENCE_PRIORITY) {
    const hit = rows.find((e) => e.tier === tier && e.kind === 'verdict');
    if (!hit) continue;
    if (tier === 'workspace-file') {
      return { backendId: hit.backendId, source: 'explicit', origin: fileOriginOf(hit.fileSource), ref: hit.ref || null, canWrite: true, reason: '' };
    }
    if (tier === 'declaration') {
      return { backendId: hit.backendId, source: 'explicit', origin: 'declaration', ref: hit.ref || null, canWrite: false, reason: 'needs-generate' };
    }
    return {
      backendId: hit.backendId,
      source: hit.source || 'matches',
      origin: 'autodetect',
      ref: hit.ref || null,
      multiHit: hit.multiHit,
      pending: hit.pending,
      canWrite: false,
      reason: 'needs-generate',
    };
  }
  return null;
}

/**
 * 哪几层在打架：按实际参与的层命名，认不出来的组合记 `unexpected-layers`
 * （宁可说「这组合不对劲」，也不编一个假的层名）。
 */
export function conflictKindOf(tiers: readonly string[]): string {
  const has = (t: string) => tiers.indexOf(t) >= 0;
  const n = tiers.length;
  if (n >= 3) return 'user-vs-declaration-vs-autodetect';
  if (has('workspace-file') && has('declaration')) return 'user-vs-declaration';
  if (has('workspace-file') && has('autodetect')) return 'user-vs-autodetect';
  if (has('declaration') && has('autodetect')) return 'declaration-vs-autodetect';
  return 'unexpected-layers';
}

function conflictOf(claims: readonly { source: string; backendId: string }[], used: string): DecisionConflict | null {
  const ids: string[] = [];
  for (const c of claims) if (c.backendId && ids.indexOf(c.backendId) < 0) ids.push(c.backendId);
  if (ids.length < 2) return null;
  const tiers: string[] = [];
  for (const c of claims) if (c.backendId && tiers.indexOf(c.source) < 0) tiers.push(c.source);
  return { kind: conflictKindOf(tiers), ids, used: String(used || '') };
}

/** 覆盖度：哪些层真看了、哪些层有意没看、为什么。 */
export function coverageOf(evidence: readonly TierEvidence[], scope: EvidenceScope): DecisionCoverage {
  const checked: EvidenceTier[] = [];
  const skipped: { tier: EvidenceTier; why: string }[] = [];
  const rows = evidence || [];
  for (const tier of EVIDENCE_PRIORITY) {
    const row = rows.find((e) => e.tier === tier);
    if (!row) continue;
    if (row.kind === 'skipped') skipped.push({ tier: tier, why: row.reason });
    else checked.push(tier);
  }
  return { scope: scope, checked: checked, skipped: skipped };
}

/**
 * 覆盖度的日志用文本（一个字段、逗号分号分隔，方便 grep）：
 * `checked=workspace-file,declaration;skipped=autodetect:skipped-stronger-evidence`。
 * 没有跳过的层就省略后半段。
 */
export function formatCoverage(c: DecisionCoverage | null | undefined): string {
  if (!c) return '';
  const head = 'checked=' + c.checked.join(',');
  if (!c.skipped.length) return head;
  return head + ';skipped=' + c.skipped.map((s) => s.tier + ':' + s.why).join(',');
}

/**
 * 失败档位：按证据顺序取第一条最具体的。
 * 顺序即「离结论最近的那一处问题先说」：工作区文件（人选那一层）→ 声明文件 → 各房认领。
 */
export function gapOfEvidence(evidence: readonly TierEvidence[], pendingOnly = false): DecisionGap | null {
  const rows = evidence || [];
  const get = (t: EvidenceTier) => rows.find((e) => e.tier === t) || null;
  const file = get('workspace-file');
  const decl = get('declaration');
  const claim = get('autodetect');
  if (file && file.outcome === 'unknown-backend') return decisionGapOf('file-unknown-backend', file.backendId);
  if (file && file.reason === 'file-read-failed') return decisionGapOf('file-read-failed');
  if (file && (file.outcome === 'unreadable' || file.outcome === 'error')) return decisionGapOf('file-unreadable');
  if (file && file.reason === 'file-layer-unavailable') return decisionGapOf('layer-unavailable');
  if (decl && decl.outcome === 'unknown-backend') return decisionGapOf('declaration-unknown-backend', decl.backendId);
  if (decl && decl.reason === 'declaration-read-failed') return decisionGapOf('declaration-read-failed');
  if (decl && (decl.outcome === 'error' || decl.outcome === 'unreadable')) return decisionGapOf('declaration-unreadable');
  if (decl && decl.reason === 'declaration-layer-unavailable') return decisionGapOf('layer-unavailable');
  if (claim && claim.outcome === 'error') return decisionGapOf('autodetect-error');
  if (claim && claim.outcome === 'unknown-backend') return decisionGapOf('claim-unknown-backend', claim.backendId);
  if (pendingOnly || (claim && claim.outcome === 'pending')) return decisionGapOf('autodetect-pending');
  // 没问过各房（没有注册表可问，或调用方自己把这一层关了）就不能说“确实没有后端”：
  // 这档如实说“问不了”，免得把「没人认领」与「没问」混成一句话。
  if (!claim || claim.kind === 'skipped') return decisionGapOf('autodetect-unavailable');
  return decisionGapOf('no-claim');
}

/**
 * 判断：一份证据报告 → 结论 + 三态 + 档位 + 矛盾 + 覆盖度。纯函数，不碰 IO。
 *
 * 「明确没有后端」的判据（#1048）：两处文件都干净地说没有（不是读不成），
 * 且各房认领真问过、谁都没认领。少一个条件就退回「没定下来」——
 * 宁可说不知道，也不把「没看成 / 没问成」写成「没有」。
 */
export function synthesize(report: EvidenceReport): DecisionSynthesis {
  const evidence = report.evidence || [];
  const scope: EvidenceScope = report.scope || 'decisive';
  const coverage = coverageOf(evidence, scope);
  const verdict = pickVerdict(evidence);
  const claims = evidence.filter((e) => e.kind === 'verdict').map((e) => ({ source: e.tier as string, backendId: e.backendId }));
  const conflict = conflictOf(claims, verdict ? verdict.backendId : '');
  if (verdict) {
    return {
      verdict: verdict,
      selection: { backendId: verdict.backendId, source: verdict.source, origin: verdict.origin, ref: verdict.ref || null, multiHit: verdict.multiHit, pending: verdict.pending },
      canWrite: verdict.canWrite,
      reason: verdict.reason,
      state: 'decided',
      gap: null,
      conflict: conflict,
      coverage: coverage,
    };
  }
  const get = (t: EvidenceTier) => evidence.find((e) => e.tier === t) || null;
  const claim = get('autodetect');
  const pendingOnly = !!(claim && claim.kind === 'unavailable' && claim.outcome === 'pending');
  const cleanMiss = (row: TierEvidence | null, reasons: string[]) => !!row && row.kind === 'abstain' && reasons.indexOf(row.reason) >= 0;
  const nothingThere = cleanMiss(get('workspace-file'), ['file-missing', 'file-no-backend'])
    && cleanMiss(get('declaration'), ['declaration-missing', 'declaration-no-backend'])
    && cleanMiss(claim, ['matches-no-claim']);
  const state: DecisionState = pendingOnly ? 'undetermined' : (nothingThere ? 'no-backend' : 'undetermined');
  const gap = gapOfEvidence(evidence, pendingOnly);
  // 对外五个字段里的 reason 保持 #1003 期的取值不变（调用方认这个字面量）；
  // 「这次到底问没问过各房」由 state 与 gap 如实表达，不挤进 reason。
  const selection: DecisionSelection = pendingOnly
    ? { backendId: null, source: 'fallback', origin: 'pending', pending: true }
    : { backendId: null, source: 'fallback', origin: 'none' };
  return {
    verdict: null,
    selection: selection,
    canWrite: false,
    reason: pendingOnly ? 'pending' : 'no-backend',
    state: state,
    gap: gap,
    conflict: conflict,
    coverage: coverage,
  };
}

/**
 * 证据范围（#1048·#1047 决策 5）：要一个结论还是要一份诊断。
 * 今天「要不要诊断」对外只有一个入口——日志的调试开关；这是当前唯一的信号，
 * 不代表将来不能有别的入口（例如界面上一个「诊断」动作），所以收在一个函数里，好换。
 * 调用方明确把各房认领关掉（skipAutodetect）时范围不变，关这一层是另一个旋钮。
 */
export function resolveEvidenceScope(opts: { logCtx?: DecisionLogCtx | null; scope?: EvidenceScope } = {}): EvidenceScope {
  // 调用方点名要哪一档就听它的：范围是判定的入参，日志开关只是下面那一条默认入口。
  if (opts.scope === 'decisive' || opts.scope === 'exhaustive') return opts.scope;
  const logCtx = opts.logCtx || null;
  try {
    return (logCtx && typeof logCtx.isEnabled === 'function' && logCtx.isEnabled('debug')) ? 'exhaustive' : 'decisive';
  } catch (eSw) {
    return 'decisive';
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 六、收集（壳：读文件、问注册表、记步骤与结论日志）
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * 判定出口的内部骨架：记步骤、发结论线。
 * 单独抽出来是因为三层读法不同（文件、声明、认领），但“怎么记、怎么收尾”是同一条规矩，
 * 散在三处写迟早会写成三份不一样的日志。
 */
interface DecideRun {
  steps: EvidenceStep[]
  logCtx: DecisionLogCtx | null
  stepsEnabled: boolean
  t0: number
  step(step: string, outcome: string, ms: number, reason: string, backendId?: string): void
  fireConclusion(selection: DecisionSelection, cwdHash: string, synth: DecisionSynthesis): void
}

function makeRun(logCtx: DecisionLogCtx | null, stepsEnabled: boolean): DecideRun {
  const steps: EvidenceStep[] = [];
  const t0 = Date.now();
  return {
    steps,
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
    fireConclusion(selection, cwdHash, synth) {
      if (!logCtx || typeof logCtx.fire !== 'function') return;
      // 平时只有这一条结论（#1047 决策 5）：判到哪个后端、来源、三态、档位、覆盖度、花了多久、有没有矛盾。
      // 三态与档位**取自判断层的产出**（#1048 复核修的一处：从前这里按 winner 现推一遍，
      // 于是四类「判不出来」的场景日志写 no-backend、结果写 undetermined，日志在骗人）。
      try {
        logCtx.fire('info', 'detection.detect', {
          cwdHash: String(cwdHash || ''),
          explicit: selection.source === 'explicit',
          matches: (selection.multiHit && selection.multiHit.length) ? selection.multiHit.length : (selection.source === 'matches' ? 1 : 0),
          pending: !!selection.pending,
          selection: String(selection.backendId || ''),
          origin: String(selection.origin || ''),
          state: synth.state,
          gap: synth.gap ? synth.gap.id : '',
          coverage: formatCoverage(synth.coverage),
          latencyMs: Date.now() - t0,
          conflict: synth.conflict ? synth.conflict.kind : '',
        });
      } catch (eL) {}
    },
  };
}

/**
 * 工作区文件那一层的读法：新文件优先、老文件兼容（与核的读口同顺序；老 json 只作兼容读）。
 * 回的是「读到了什么 + 这一步的结论」，不是光秃秃的解析结果——判不出来时要说得出缺什么（#1048）。
 * 「文件不在」与「读不成」在这里就分开：前者够格参与「确实没有」的结论，后者不够（见 isMissingFileError）。
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
  let readFailed = false;
  try {
    const fsSvc = deps.fs || (deps.platform && deps.platform.fs) || null;
    if (fsSvc && typeof fsSvc.resolve === 'function' && typeof fsSvc.readText === 'function') {
      for (const rel of rels) {
        let txt = '';
        try {
          const target = await fsSvc.resolve(rel, { cwd });
          txt = await fsSvc.readText(target);
        } catch (eOne) {
          // 这一条路径没读成：文件不在是「没有这份记录」，别的错是「这次没看成」。
          if (!isMissingFileError(eOne)) readFailed = true;
          continue;
        }
        sawFile = true;
        const parsed = parseWorkspaceFile(txt);
        if (parsed && parsed.backendId) return { parsed, outcome: 'hit', reason: 'file-hit' };
        // 文件在，但里面没有可用的后端名：继续试下一个路径（老文件可能才是那份），都试完再说“读不出”。
        sawBroken = true;
      }
      if (sawBroken) return { parsed: null, outcome: 'unreadable', reason: 'file-unreadable' };
      if (readFailed) return { parsed: null, outcome: 'error', reason: 'file-read-failed' };
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
 * 读失败同样与「文件不存在」分开。
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
        if (isMissingFileError(eRead)) return { id: '', outcome: 'miss', reason: 'declaration-missing' };
        return { id: '', outcome: 'error', reason: 'declaration-read-failed' };
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
 * 收集三层证据（壳）。记步骤、按证据范围决定问不问各房，返回一份证据报告。
 *
 * 各房认领那一层会读 .git/config、列 .scratch 目录、必要时起 `git` 子进程（不消耗远端接口配额），
 * 它是三层里最弱、也最贵的一层；decisive 范围下只在前两层都没给出可用结论时才问，
 * 跳过这件事本身也记一条步骤，事后读得出原因。
 */
async function collectEvidence(cwd: string, deps: DecideBackendDeps, scope: EvidenceScope, run: DecideRun): Promise<TierEvidence[]> {
  const registry = deps.registry || null;
  const handle = { cwd };
  const evidence: TierEvidence[] = [];

  // ① 人选那一层：工作区文件。每次都读（便宜、无副作用，矛盾靠它才看得出来）。
  const tFile = Date.now();
  const fileRead = await readFileLayer(cwd, deps);
  const fileParsed = fileRead.parsed;
  let fileEvidence: TierEvidence;
  if (fileRead.outcome === 'hit' && fileParsed) {
    // 记这一步之前先把「这个后端装没装」问清：装了才叫这一层给出了可用结论（hit），
    // 没装是 unknown-backend —— 两件事写进日志与结果必须是同一个结论，不能一步两说。
    if (isKnown(registry, fileParsed.backendId)) {
      fileEvidence = verdictEvidence('workspace-file', fileParsed.backendId, fileRead.reason, { fileSource: fileParsed.source });
    } else {
      fileEvidence = unavailableEvidence('workspace-file', 'unknown-backend', 'file-backend-unknown', fileParsed.backendId);
    }
  } else if (fileRead.outcome === 'unreadable') {
    fileEvidence = unavailableEvidence('workspace-file', 'unreadable', fileRead.reason);
  } else if (fileRead.outcome === 'error') {
    fileEvidence = unavailableEvidence('workspace-file', 'error', fileRead.reason);
  } else {
    fileEvidence = abstainEvidence('workspace-file', fileRead.reason);
  }
  run.step('workspace-file', fileEvidence.outcome, Date.now() - tFile, fileEvidence.reason, fileEvidence.backendId);
  evidence.push(fileEvidence);

  // ② 程序自己认的第一条：声明文件。同样每次都读 —— 出口原来那套只看标题的解析器已删，
  //    现在与探测器、工具壳装配层共用 parseIssueTracker 一套，一次读取、一份结论。
  const tDecl = Date.now();
  const declRead = await readDeclarationLayer(cwd, deps);
  let declEvidence: TierEvidence;
  if (declRead.outcome === 'hit') {
    if (isKnown(registry, declRead.id)) declEvidence = verdictEvidence('declaration', declRead.id, declRead.reason);
    else declEvidence = unavailableEvidence('declaration', 'unknown-backend', 'declaration-backend-unknown', declRead.id);
  } else if (declRead.outcome === 'error') {
    declEvidence = unavailableEvidence('declaration', 'error', declRead.reason);
  } else {
    declEvidence = abstainEvidence('declaration', declRead.reason);
  }
  run.step('declaration', declEvidence.outcome, Date.now() - tDecl, declEvidence.reason, declEvidence.backendId);
  evidence.push(declEvidence);

  // ③ 程序自己认的第二条：各房认领（matches）。
  const callerClosedIt = deps.skipAutodetect === true;
  const higherTierDecided = evidence.some((e) => e.kind === 'verdict');
  const mustAsk = !callerClosedIt && (scope === 'exhaustive' || !higherTierDecided);
  if (!mustAsk) {
    // 有意没看：调用方关掉了，或已有更强的证据（decisive 范围）。
    const why = callerClosedIt ? 'skipped-by-caller' : 'skipped-stronger-evidence';
    run.step('autodetect', 'skipped', 0, why, '');
    evidence.push(skippedEvidence('autodetect', why));
    return evidence;
  }

  const tAuto = Date.now();
  let sel: Selection | null = null;
  let ran = false;
  let failed = false;
  try {
    if (typeof deps.autodetect === 'function') {
      // 可选钩子：调用方把自己的自动识别包一层再交进来（例如工具壳把配额闸包在外面，
      // 行为与直接调注册表一致，只多记账）。不传钩子时直调注册表，其余三路走这一条。
      const ctx = { cwd, platform: deps.platform || null, fs: deps.fs || null, caller: deps.caller || 'backend-decision', signal: deps.signal };
      sel = await deps.autodetect(handle, ctx);
      ran = true;
    } else if (registry && typeof registry.select === 'function') {
      const ctx = { cwd, platform: deps.platform || null, fs: deps.fs || null, caller: deps.caller || 'backend-decision', signal: deps.signal };
      sel = await registry.select(handle, ctx);
      ran = true;
    }
  } catch (eAuto) {
    sel = null;
    ran = true;
    failed = true;
  }
  const autoMs = Date.now() - tAuto;
  let claimEvidence: TierEvidence;
  if (failed) {
    claimEvidence = unavailableEvidence('autodetect', 'error', 'matches-error');
  } else if (!ran) {
    // 连问都问不了（没注册表可问）：如实记“没问”，不当成“问过了没人认领”。
    claimEvidence = skippedEvidence('autodetect', 'no-registry');
  } else if (sel && sel.backendId) {
    const normalized = normalizeClaim(sel);
    if (normalized.reordered || (sel.multiHit && sel.multiHit.length > 1)) {
      run.step('claim-order', 'hit', 0, 'plain-order', normalized.backendId);
    }
    claimEvidence = isKnown(registry, normalized.backendId)
      ? verdictEvidence('autodetect', normalized.backendId, 'matches-hit', {
        multiHit: normalized.multiHit,
        pending: sel.pending,
        ref: sel.ref || null,
        source: sel.source,
      })
      : unavailableEvidence('autodetect', 'unknown-backend', 'matches-backend-unknown', normalized.backendId);
  } else if (sel && sel.pending) {
    claimEvidence = unavailableEvidence('autodetect', 'pending', 'matches-pending');
  } else {
    claimEvidence = abstainEvidence('autodetect', 'matches-no-claim');
  }
  run.step('autodetect', claimEvidence.outcome, autoMs, claimEvidence.reason, claimEvidence.backendId);
  evidence.push(claimEvidence);
  return evidence;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 七、出口
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * 统一判定的纯核（历史形状的快捷入口）：输入已经读到的各层候选，输出唯一答案。
 * 它现在也走同一条合成规则（synthesize）——不再另写一套 if/else，免得「两套真相」从缝里回来。
 * #1003 契约（2026-10-12 维护者拍板）：本机记忆只用来把工作区配置文件生成出来一次，
 *   此后不再参与任何判定，所以这里没有记忆这一层。
 * #1138（2026-10-14）：注册表里那份进程内绑定同样不再参与判定，顺序是「工作区文件 → 声明文件 → 自动识别」。
 */
export function decidePure({ fileParsed, declarationId, autodetect, registry }: DecidePureInput): DecisionSelection {
  const evidence: TierEvidence[] = [];
  if (fileParsed && fileParsed.backendId) {
    evidence.push(isKnown(registry, fileParsed.backendId)
      ? verdictEvidence('workspace-file', fileParsed.backendId, 'file-hit', { fileSource: fileParsed.source })
      : unavailableEvidence('workspace-file', 'unknown-backend', 'file-backend-unknown', fileParsed.backendId));
  } else {
    evidence.push(abstainEvidence('workspace-file', 'file-missing'));
  }
  if (declarationId) {
    evidence.push(isKnown(registry, declarationId)
      ? verdictEvidence('declaration', declarationId, 'declaration-hit')
      : unavailableEvidence('declaration', 'unknown-backend', 'declaration-backend-unknown', declarationId));
  } else {
    evidence.push(abstainEvidence('declaration', 'declaration-missing'));
  }
  if (autodetect && autodetect.backendId) {
    const normalized = normalizeClaim(autodetect);
    evidence.push(isKnown(registry, normalized.backendId)
      ? verdictEvidence('autodetect', normalized.backendId, 'matches-hit', { multiHit: normalized.multiHit, pending: autodetect.pending, ref: autodetect.ref || null, source: autodetect.source })
      : unavailableEvidence('autodetect', 'unknown-backend', 'matches-backend-unknown', normalized.backendId));
  } else if (autodetect && autodetect.pending) {
    evidence.push(unavailableEvidence('autodetect', 'pending', 'matches-pending'));
  } else {
    evidence.push(abstainEvidence('autodetect', 'matches-no-claim'));
  }
  const synth = synthesize({ evidence: evidence, scope: 'decisive' });
  return {
    backendId: synth.selection.backendId,
    source: synth.selection.source,
    origin: synth.selection.origin,
    ref: synth.selection.ref || null,
    multiHit: synth.selection.multiHit,
    pending: synth.selection.pending,
  };
}

/**
 * 唯一判定出口：输入工作区根，输出 { backendId, source, origin, canWrite, reason } 加内部三态、档位与轨迹。
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
 *   声明文件同时也是第 3 层里 matches 的输入（见 src/tracker/rooms/gitlab/index.ts 的 matches
 *   注释），所以它是「程序自己认」的一条规则，不是人选。
 *
 * 写权限今天只给人选：第 1 层 canWrite: true；第 2、3 层 canWrite: false（reason: 'needs-generate'）。
 * 读用途不受这条限制；写用途的拦截在 src/deck/shell/call-shell.ts（工具层）与 src/host/workspaceLabelColors.js（改色）。
 */
export async function decideBackend(root: unknown, deps: DecideBackendDeps = {}): Promise<BackendDecision> {
  const cwd = String(root || '');
  const logCtx = (deps.logCtx || null) as DecisionLogCtx | null;
  // 证据范围与调试开关只在外层判一次：不开就不建步骤对象、不发步骤线；结论线照发（常驻）。
  const scope = resolveEvidenceScope({ logCtx: logCtx, scope: deps.scope });
  const run = makeRun(logCtx, scope === 'exhaustive');
  const cwdHash = hash8(cwd);
  if (!cwd) {
    // 空目录：不读文件、不起命令，如实说“工作区还没就绪”（#1003 空目录闸）。
    const gap = decisionGapOf('workspace-not-ready');
    const blank: DecisionSelection = { backendId: null, source: 'unknown', origin: 'unknown-workspace' };
    // 这一趟什么都没看：覆盖度如实记成「一层都没看」，不冒充「看过了没有」。
    const synth: DecisionSynthesis = {
      verdict: null,
      selection: blank,
      canWrite: false,
      reason: 'workspace-not-ready',
      state: 'undetermined',
      gap: gap,
      conflict: null,
      coverage: { scope: scope, checked: [], skipped: [] },
    };
    run.fireConclusion(blank, cwdHash, synth);
    // 空根这一支照旧只交对外那五个字段加原因：这一趟什么都没看，所以三态是 undetermined、
    // 覆盖度是「一层都没看」，档位说「工作区还没就绪」。
    return {
      backendId: null,
      source: 'unknown',
      origin: 'unknown-workspace',
      canWrite: false,
      reason: 'workspace-not-ready',
      ref: null,
      state: synth.state,
      missing: gap ? gap.missing : '',
      gap: gap,
      conflict: null,
      coverage: synth.coverage,
      steps: run.steps,
    };
  }

  const evidence = await collectEvidence(cwd, deps, scope, run);
  const synth = synthesize({ evidence: evidence, scope: scope });
  run.fireConclusion(synth.selection, cwdHash, synth);
  return {
    backendId: synth.selection.backendId,
    source: synth.selection.source,
    // 契约里 origin 是可选的，判断层每一支都写了它；这里的兜底只为满足类型，
    // 真要走到空串说明上游漏写，门禁里有多处断言盯着 origin 的具体取值。
    origin: String(synth.selection.origin || ''),
    canWrite: synth.canWrite,
    reason: synth.reason,
    ref: synth.selection.ref || null,
    multiHit: synth.selection.multiHit,
    pending: synth.selection.pending,
    state: synth.state,
    missing: synth.gap ? synth.gap.missing : '',
    gap: synth.gap,
    conflict: synth.conflict,
    coverage: synth.coverage,
    steps: run.steps,
  };
}

export default {
  decideBackend,
  decidePure,
  selectionFromOutlet,
  MULTI_CLAIM_ORDER,
  EVIDENCE_PRIORITY,
  orderClaims,
  normalizeClaim,
  decisionGapOf,
  pickVerdict,
  synthesize,
  resolveEvidenceScope,
  formatCoverage,
};
