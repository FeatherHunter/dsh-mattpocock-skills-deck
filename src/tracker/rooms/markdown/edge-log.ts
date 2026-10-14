/**
 * src/tracker/rooms/markdown/edge-log.ts —— 本地 Markdown 房「关系与边」这一族的日志出口（#1060）。
 *
 * 为什么要有它：父子边与阻塞边在本房的落法与另两房都不同 —— 这里没有 gh、也没有裸接口，
 * 一条边就是票文件里的两处文字：文件头的 `<!-- parentKey: 01 -->` 那一行注释（父子边），
 * 正文里的 `Blocked by: #02` 那一行字段（阻塞边）。此前这一族一条结论线都没有：
 * 一次写完回来只有一个 ok，事后拿导出包的人分不清「这条边真挂上了」「本来就挂着、这次一处没改」
 * 「走在半路折了」；成环检查更是查没查过都看不出来 —— 环检要读整张图，读不全就不判、这次一个字都不写，
 * 而这件事在日志里同样是一片空白（#1174 决策 9 定的口径：拿不准就不放行）。
 *
 * 事件名与字段沿用 GitHub 房那一族（附录 1.4 节 #100 `edge.write`、1.5 节 #101 `edge.cycle`），
 * **不新造 `markdown.*`**：两房的边语义要对得上，日志形状就得是同一个名字、同一套字段。
 *   - `edge.write`（信息级，常驻）：一趟边写入一行，成功与失败都记。八个字段：kind 写的是父子边
 *     （parent）还是阻塞边（block）、route 走的哪条路、ok 成没成、added 真挂上几条、removed 真撤下几条、
 *     kept 对账之后发现「本来就在位」几条、reason 为什么是这个结论、latencyMs 这一趟花了多久。
 *   - `edge.cycle`（调试级，按需）：成环检查一趟一行。四个字段：verdict 结论（clear 没成环 /
 *     cycle 成环 / unchecked 邻接关系没取到、这一趟没查成）、nodes 邻接表里几张票、
 *     blockers 这一次拟写入几条阻塞边、latencyMs 查了多久。调用处先判一次调试开关，关闭时连字段对象都不组装。
 *
 * 本房与 GitHub 房**不一样**的几处，一并写在这里，免得下一个读代码的人以为漏了：
 *   ① route 只有 none / file 两个取值。本房的边写在票文件里，没有「原生旗」与「裸接口」两条路
 *      （GitHub 房的 flag / rest 是那两房的外部调用形态）。none = 这一趟没走到写票文件这一步，
 *      file = 走到了 —— 与同房 `issue.write` 的 route 同一套口径。
 *   ② 不另发 #102 `edge.roster`。那一行回答「邻接关系是从名册来的还是整仓拉来的」，而本房的环检
 *      每次都把本工作单元的票目录整读一遍，没有第二条来源可报；这一趟读了几张票已经记在 #101 的
 *      nodes 里，再发一行恒定值就是每趟都响的心跳（日志纪律：能排除哪种故障、指到下一步查哪里，答不上就不加）。
 *   ③ 不发 #103 `edge.repair`。那是 GraphQL 降级到 REST 之后补树边的那条路，本房没有对应的路。
 *   ④ GitHub 房在邻接关系没取到时报 `unchecked` 之后**按不成环放行**；本房同一词的含义是
 *      「没查成」，而这一趟因此**不放行、一个字都没写**（#1174 决策 9）。取值本身的意思
 *      （邻接关系没取到）两房一致，差别在接下来怎么办，这条差别记在附录第 101 条的补记里。
 *
 * 隐私：只记枚举、布尔与计数；票号、文件名、路径、父票编号、上游报错原文一个字都不记
 * （票号在工具返回值里，报错原文在失败结果的 raw 与 `error.normalize` 那一条里）。
 * 字段白名单由 tests/verify-log-fields.js 守着，每一档取值由 tests/verify-1060-edge-log.ts 逐条走到。
 */

import type { OpContext } from '../../contract/contexts.js'

/** 一趟边写入走过的路：none 没走到写票文件这一步（目标状态本来就在位、一处没改，或压根没走到写这一步）/ file 走到了。 */
export type EdgeRoute = 'none' | 'file'

/**
 * 一趟边写入的事实桶：内层实现边走边填，出口按登记的那八个字段投影成一行。
 * 按调用各建一个（入口函数里 beginEdgeTrail），并发写不会串。
 * 与 GitHub 房的同名形状只差 route 的取值域（那边是 flag / rest），字段与含义逐一对得上。
 */
export interface EdgeTrail {
  /** 真走到「把改动写进票文件」这一步的那个分支才改口：说的是这一趟走的路，不是事后猜的。 */
  route: EdgeRoute
  /** 真挂上去几条边（父子边一次最多一条；阻塞边一次可以补好几条）。 */
  added: number
  /** 真撤下来几条边。 */
  removed: number
  /** 对账之后发现「本来就在位」几条：不算 added、也不算失败的那几条。 */
  kept: number
}

export function beginEdgeTrail(): EdgeTrail {
  return { route: 'none', added: 0, removed: 0, kept: 0 }
}

/** 这一趟写的是哪一种边，与 GitHub 房同一份取值（附录第 100 条）。 */
export const EDGE_KINDS = Object.freeze(['parent', 'block'] as const)

/**
 * 一趟边写入可能得到的结论（失败那一档是 `fail:档位`，档位取自 error.kind，取值不固定，所以不在表里）。
 * 判定规则与 GitHub 房同一套、只有一处扩充：那边父子边只会出现 added / removed / noop 三个词
 * （改挂一条父子边在 GitHub 只记 added 一笔），而本房的父边就是正文里的一行注释，撤一条挂一条是两次
 * 真实的内容变化，所以改挂记 `diff` —— 表里本来就有这个取值，含义也一致（撤与挂各算一笔）。
 */
export const EDGE_REASONS = Object.freeze(['added', 'removed', 'diff', 'noop'] as const)

/**
 * 成环检查的三种结论，取 GitHub 房 `cycle-check.ts` 的同一套写法（#1180 定：三个词只声明一次，调用点不手写字符串）。
 * 本房与那边的差别见文件头第 ④ 条：unchecked 在这里意味着「没查成，所以这一趟不放行」。
 */
export const EDGE_CYCLE_VERDICT = Object.freeze({
  /** 没成环：这一趟查成了，可以往下写。 */
  CLEAR: 'clear',
  /** 成环：这一趟一个字都没写。 */
  CYCLE: 'cycle',
  /** 邻接关系没取到（列目录或读某份票读不动）：这一趟没查成，因此也不写。 */
  UNCHECKED: 'unchecked',
} as const)
export type EdgeCycleVerdict = (typeof EDGE_CYCLE_VERDICT)[keyof typeof EDGE_CYCLE_VERDICT]

/** 三种结论的取值表：门禁拿它反过来对账（表里每条都走到过、表外一个都没出现）。 */
export const EDGE_CYCLE_VERDICTS = Object.freeze(['clear', 'cycle', 'unchecked'] as const)

/** 从返回里读「成没成、失败是哪一档」：返回是联合类型，先判 ok，再读 error.kind（读法与同房 write-log.ts 一致）。 */
function outcomeOf(r: unknown): { ok: boolean; errKind: string } {
  const rb = r as { ok?: unknown; error?: { kind?: unknown } } | null | undefined
  return { ok: !!(rb && rb.ok === true), errKind: String((rb && rb.error && rb.error.kind) || 'unknown') }
}

/**
 * 这一趟边写入的结论，由出口按事实桶推导、不散在内层分支里（与 GitHub 房同一条理由：同一件事两处写，迟早对不上）。
 * 撤与挂各算一笔时记 `diff`，只挂记 `added`，只撤记 `removed`，一处没动记 `noop`，失败记 `fail:档位`。
 */
export function edgeReason(t: EdgeTrail, ok: boolean, errKind: string): string {
  if (!ok) return 'fail:' + errKind
  if (t.added > 0 && t.removed > 0) return 'diff'
  if (t.added > 0) return 'added'
  if (t.removed > 0) return 'removed'
  return 'noop'
}

/**
 * 边写入一行结论（`edge.write`），字段是登记的那八个。
 *
 * 为什么定常驻（信息级）：边是人和 AI 的显式动作（一次建图十几步），出「这条边怎么没挂上」
 * 「刚才那次改父子到底落盘没有」这类问题时，查的人不会先打开调试开关；
 * 它也是这一族唯一一条「写没写下去」的结论线。记日志这件事永远不许改变写的结果：整段包 try/catch，
 * 没有上下文就静默跳过。
 */
export function emitEdgeWrite(ctx: OpContext | null | undefined, kind: string, trail: EdgeTrail, r: unknown, t0: number): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    const o = outcomeOf(r)
    ctx.logEvent('info', 'edge.write', {
      kind: kind,
      route: trail.route,
      ok: o.ok,
      added: trail.added,
      removed: trail.removed,
      kept: trail.kept,
      reason: edgeReason(trail, o.ok, o.errKind),
      latencyMs: Date.now() - t0,
    })
  } catch {}
}

/**
 * 成环检查一行结论（`edge.cycle`），字段是登记的那四个。
 *
 * 为什么定按需（调试级）：写一条阻塞边就会查一次（一次建图十几步里它出现十几次），属高频路径；
 * 关闭时连字段对象都不组装。票号一个字都不记：哪张票在工具返回值与失败结果的 raw 里。
 */
export function emitEdgeCycle(ctx: OpContext | null | undefined, verdict: EdgeCycleVerdict, nodes: number, blockers: number, t0: number): void {
  try {
    if (!ctx || typeof ctx.isEnabled !== 'function' || ctx.isEnabled('debug') !== true || typeof ctx.logEvent !== 'function') return
    ctx.logEvent('debug', 'edge.cycle', { verdict: verdict, nodes: nodes, blockers: blockers, latencyMs: Date.now() - t0 })
  } catch {}
}

export default { beginEdgeTrail, edgeReason, emitEdgeWrite, emitEdgeCycle, EDGE_KINDS, EDGE_REASONS, EDGE_CYCLE_VERDICT, EDGE_CYCLE_VERDICTS }
