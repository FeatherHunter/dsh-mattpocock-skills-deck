// src/tracker/detection/evidenceHelpers.ts —— 证据的小工具（从 backendDecision.ts 拆出，票 #6 收口）
//
// 为什么单开这一层：backendDecision.ts 在零增长基线上（verify-file-granularity，只许减不许增，
// 超 500 有效行阻断发布），票 #5 加档位后越过基线。这里搬走的是与「判定主流程」无关的三样：
// 三层优先级常量、证据的四个构造函数（kind 与 outcome 只在这里配对，别处不许手写）、
// 覆盖度的计算与日志文本。类型仍以 backendDecision 为唯一声明处，这里只按类型导入
// （编译后擦除，两个文件之间没有运行时的循环依赖）。
import type { Selection } from '../contract/results.js';
import type { RepositoryRef } from '../contract/entities.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * 一、证据的形状：层与全序（政策即数据）。类型仍以 backendDecision 为对外真源
 *（它从这里导入并再导出），调用方按老路径导入不必改；两个文件之间只有
 * backendDecision → evidenceHelpers 一个方向的依赖，没有运行时循环。
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * 证据层。取值就是步骤行里的 `step` 取值（稳定，写进日志，改含义要发新事件）：
 * workspace-file（工作区文件里人选的那一层）/ declaration（声明文件那一层）/ autodetect（各房认领）。
 */
export type EvidenceTier = 'workspace-file' | 'declaration' | 'autodetect'

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
 * 判定层只认 kind，日志层只认 outcome，两者不许对不上——所以只经构造函数产出。
 */
export type EvidenceKind = 'verdict' | 'abstain' | 'unavailable' | 'skipped'

/** 认领来源词（与契约层 Selection 的 source 同源，这里只为 TierEvidence 复用该形状）。 */
export type SelectionSource = Selection['source'];

/**
 * 一层证据的收集结果：这一步看了什么、结论是什么、为什么。
 * 可选格只在特定层有意义：fileSource 只有工作区文件层有（user / migrated / detected / auto，
 * 用来分辨人选与搬来的记录）；multiHit / pending / ref / source 只有各房认领层有。
 * declarationConfidence 只有声明文件层有（#1572）：高置信来自标题行；正文关键词的低置信在读取层
 * 就记成 abstain（方案 A），不会走到 pickVerdict 产出结论，这里只作证据元数据保留。
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
  declarationConfidence?: 'high' | 'low'
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

/**
 * 三层证据的优先级，**唯一的声明处**：人选 > 声明文件 > 各房认领。
 * 它是一条全序，判断因此可以「取第一条结论」而不必两两比较，也无所谓谁先谁后地问。
 */
export const EVIDENCE_PRIORITY: readonly EvidenceTier[] = ['workspace-file', 'declaration', 'autodetect'];

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
