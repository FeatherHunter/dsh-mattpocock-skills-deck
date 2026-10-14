/**
 * 票写入的常驻结论线（附录 1.4 节 #104 `issue.write`）。
 *
 * 为什么单独一份：建票、改票、评论、改标签这一族写在五个文件里（issues-write.ts 的
 * create / close / reopen / update / setAssignees，comments.ts 的 comment，labels.ts 的 setLabels），
 * 而「写没写下去、走的哪条路、为什么」这套话三处都要说同一遍 —— 轨迹形状与发射口放一处，
 * 免得三份各写各的、日子久了对不上。
 *
 * 用法照 #1054 的 EdgeTrail（graph.ts 的 emitEdgeWrite）那一套：
 * 内层实现拿着一个小对象边走边填，外层包装在出口处统一发射一行。
 */

import type { OpContext } from '../../contract/contexts.js';

/**
 * 一趟票写的轨迹：由内层实现边走边填，外层包装统一发射。
 * 为什么用一个小对象传进内层，而不是在出口处回头猜：同一趟写可能真新建、也可能幂等命中复用、
 * 还可能停在写前校验一步都没出去；建完票之后的补挂（标签、认领、父边）挂没挂上，也只有内层知道。
 * 小对象按调用各建一个，并发写不会串。
 */
export interface IssueWriteTrail {
  /** 走的哪条路：none 没走到外部调用 / rest 走 gh api / cli 走 gh issue 子命令。 */
  route: 'none' | 'rest' | 'cli';
  /** 真发出去几条写命令（0 表示幂等命中复用了已有票，或压根没走到外部调用）。 */
  written: number;
  /** 建完票之后补挂（标签、认领、父边）没挂上的步数（0 表示都挂上了，或本来就不需要挂）。 */
  followFailed: number;
  /** 为什么是这个结论：fresh 真新建 / reuse 幂等命中复用 / edited 改了已有票 / noop 一处没改 / none 还没走到结论。 */
  reason: string;
}

export function newIssueWriteTrail(): IssueWriteTrail {
  return { route: 'none', written: 0, followFailed: 0, reason: 'none' }
}

/**
 * 一趟写入一行，成功与失败都记，回答「这张票到底写没写下去、走的哪条路、为什么」。字段全是枚举与计数：
 * kind 写的是哪一类（create / close / reopen / update / setAssignees / comment / setLabels）、
 * route 走的哪条路（none 没走到外部调用 / rest 走 gh api / cli 走 gh issue 子命令）、
 * ok 成没成、written 真发出去几条写命令、followFailed 建完票之后补挂没挂上的步数、
 * reason 为什么是这个结论（fresh 真新建 / reuse 幂等命中复用 / edited 改了已有票 / noop 一处没改 /
 * partial 写成了但有补挂没挂上 / fail:档位 失败）、latencyMs 这一趟花了多久（毫秒）。
 * 票号、票面标题正文、命令原文、上游报错原文一个字都不记：票号与正文在工具返回值里，
 * 命令与报错原文在 gh.exec / gh.timeout 那两条里。
 * 为什么定常驻（信息级）：写票是人和 AI 的显式动作（一次会话几条到几十条），出「这张票怎么没建上」
 * 「是不是建重了一张」这类问题时，查的人不会先打开调试开关；它也是这一族里唯一一条「写没写下去」的结论线。
 */
export function emitIssueWrite(ctx: OpContext, kind: string, trail: IssueWriteTrail, r: unknown, t0: number): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    // 失败那一路的档位从返回里读；返回是联合类型，先按「有 error 这一格」的形状取，读法与别处一致。
    const rb = r as { ok?: unknown; error?: { kind?: unknown } } | null | undefined
    const okFlag = !!(rb && rb.ok === true)
    const errKind = String((rb && rb.error && rb.error.kind) || 'unknown')
    // 失败一律以档位收尾（reason 里带着档位，查的人不用再去别处拼）；成功时若有补挂没挂上，如实说成 partial。
    const reason = !okFlag ? 'fail:' + errKind : (trail.followFailed > 0 ? 'partial' : trail.reason)
    ctx.logEvent('info', 'issue.write', { kind: kind, route: trail.route, ok: okFlag, written: trail.written, followFailed: trail.followFailed, reason: reason, latencyMs: Date.now() - t0 })
  } catch {}
}
