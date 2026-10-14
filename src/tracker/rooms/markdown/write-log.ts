/**
 * 房间内写操作的日志出口：一趟写落一行结论（附录 1.4 节第 104 条 `issue.write`）。
 *
 * 为什么本地房要有这一份：这一族写操作（建票、关票、重开、改票、贴标签、改认领、评论）此前在本地这一侧
 * 一条结论线都没有。事后拿导出包的人只能看到「这张票的正文里多了/少了一行」，看不出这一趟到底写没写下去：
 * 幂等锚命中复用（一份文件都没写）与真新建在结果里长得一样；关一张已经关着的票会照旧把同一份内容写回盘上；
 * 一次失败的建票与一次没走到写这一步的失败也分不开。三座房里 GitHub 房早有这条线（#104），
 * 这里沿用同一个事件名与同一套字段，只有「走了哪条路」这一格按本地房的实况改成 none / file。
 *
 * 为什么结论由出口的纯函数算、不散在内层分支里：与 GitHub 房同一条理由 —— 内层只填事实（真写了几份文件、
 * 有没有写不成的步），结论只在一处推导。同一件事两处写，迟早对不上；内层也就没有 reason 可写。
 *
 * 隐私：只记计数、枚举与耗时；票号、标题正文、标签名、文件名、路径、上游报错原文一个字都不记
 * （它们在工具返回值与 `error.normalize` 那一条里）。字段白名单由 tests/verify-log-fields.js 守着，
 * 字段与「这一趟到底写没写下去」的实况由 tests/verify-1059-issue-write.ts 守着。
 */

import type { OpContext } from '../../contract/contexts.js'

/** 一趟写走过的路：none 一个文件都没写（幂等命中复用、一处没改，或压根没走到写这一步）/ file 写了票文件。 */
export type WriteRoute = 'none' | 'file'

/**
 * 一趟写的事实桶：内层实现边走边填，出口按登记的那七个字段投影成一行。
 * 按调用各建一个（入口函数里 beginWriteTrail），并发写不会串。
 */
export interface WriteTrail {
  /** 真把一份票文件写到盘上的那一刻才改口：说的是「真走到哪一层」，不是「本来打算写哪一份」。 */
  route: WriteRoute
  /** 真写到盘上的文件份数（0 表示幂等命中复用或一处没改）。本房一趟写只动一份票文件，所以今天只有 0 与 1。 */
  written: number
  /** 没写成的步数。本房今天没有「写成一部分」的步骤，这个格子保持 0；留着它是与 GitHub 房同一个形状。 */
  failed: number
}

export function beginWriteTrail(): WriteTrail {
  return { route: 'none', written: 0, failed: 0 }
}

/**
 * 真把一份票文件写到盘上的那一刻调一次（调用点就在各入口调 write.ts 的 writeTextFile 的紧后面）。
 * 为什么用函数而不是让内层直接 `trail.written += 1`：route 与 written 是一件事的两面，
 * 只加计数忘了改 route，日志里就会出现「写了 1 份、路却是 none」这种自相矛盾的行。
 */
export function noteFileWritten(trail: WriteTrail | null | undefined): void {
  if (!trail) return
  trail.route = 'file'
  trail.written += 1
}

/**
 * 本房写路径今天会出现的写操作类别（与 GitHub 房同一份取值，它那边的登记见附录第 104 条）。
 * 关系与边那两条写操作（setParent / setBlockedBy）写的是同一份票文件，但它们报在另一条结论线上：
 * #1060 起归 `edge.write` 那一族（见 edge-log.ts），**不在这张表里** —— 同一趟动作发两种事件名，
 * 对账时人会以为漏了一个。本文件只管票本身的读写（建、关、重开、改字段、贴标签、改认领、评论）。
 */
export const ISSUE_WRITE_KINDS = Object.freeze([
  'create',
  'close',
  'reopen',
  'update',
  'setLabels',
  'setAssignees',
  'comment',
] as const)

/**
 * 一趟写可能得到的结论（失败那一档是 `fail:档位`，档位取自 error.kind，取值不固定，所以不在表里）。
 * 表里列的正好是下面 `issueReason` 能算出来的全部取值：另两房那个 `partial`（写成了但有步没写成）
 * 在本房不出现 —— 一趟只写一份票文件，没有「写成一部分」的步骤，`failed` 那一格也就恒为 0。
 * 哪天真有了一步只写一半的流程，先把 `failed` 填起来，再把取值与用例一起补进这张表，
 * 不要就地改这条线的意思。
 */
export const ISSUE_WRITE_REASONS = Object.freeze(['fresh', 'reuse', 'edited', 'noop'] as const)

/** 从返回里读「成没成、失败是哪一档」：返回是联合类型，先判 ok，再读 error.kind（读法与别处一致）。 */
function outcomeOf(r: unknown): { ok: boolean; errKind: string } {
  const rb = r as { ok?: unknown; error?: { kind?: unknown } } | null | undefined
  return { ok: !!(rb && rb.ok === true), errKind: String((rb && rb.error && rb.error.kind) || 'unknown') }
}

/** 失败一律以档位收尾：查的人不用再去别处拼。 */
function failReason(errKind: string): string {
  return 'fail:' + errKind
}

/**
 * 票写的结论：fresh 真新建 / reuse 幂等命中复用 / edited 改了已有票 / noop 一处没改 / fail:档位 失败。
 * 建票与其余几件的分别只在「一份文件都没写」那一格：建票一份没写是复用已有一张，改票一份没写是一处没改。
 *
 * 这里不推导 `partial`：本房一趟只写一份票文件，没有「写成一部分」的步骤，`trail.failed` 恒为 0，
 * 写一条永远走不到的分支只会让人以为它会发生。等真有那一步流程，连取值表与用例一起补回来。
 */
export function issueReason(kind: string, t: WriteTrail, ok: boolean, errKind: string): string {
  if (!ok) return failReason(errKind)
  if (t.written === 0) return kind === 'create' ? 'reuse' : 'noop'
  return kind === 'create' ? 'fresh' : 'edited'
}

/**
 * 票写一行结论，字段是登记的那七个：kind 写的是哪一类（create / close / reopen / update / setLabels /
 * setAssignees / comment）、route 走的哪条路、ok 成没成、written 真写到盘上几份文件、failed 没写成的步数、
 * reason 为什么是这个结论、latencyMs 这一趟花了多久（毫秒）。成功与失败都记，一趟一行。
 *
 * 为什么定常驻（信息级）：写票是人和 AI 的显式动作（一次会话几条到几十条），出「这张票怎么没建上」
 * 「是不是建重了一张」「刚才那次改动到底落盘没有」这类问题时，查的人不会先打开调试开关；
 * 它也是这一族唯一一条「写没写下去」的结论线。
 */
export function emitIssueWrite(ctx: OpContext, kind: string, trail: WriteTrail, r: unknown, t0: number): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    const o = outcomeOf(r)
    ctx.logEvent('info', 'issue.write', {
      kind: kind,
      route: trail.route,
      ok: o.ok,
      written: trail.written,
      failed: trail.failed,
      reason: issueReason(kind, trail, o.ok, o.errKind),
      latencyMs: Date.now() - t0,
    })
  } catch {}
}

export default { beginWriteTrail, noteFileWritten, issueReason, emitIssueWrite, ISSUE_WRITE_KINDS, ISSUE_WRITE_REASONS }
