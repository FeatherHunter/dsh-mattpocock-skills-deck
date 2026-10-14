/**
 * 房间内写操作的日志出口：一趟写落一行结论（附录 1.4 节第 104、105、106 条）。
 *
 * 三个族共用这一份机制，各自登记成一条事件：
 *  · `issue.write`（#104，常驻）—— 票的写：建票、关闭、重开、改票、改认领、评论、贴标签；
 *  · `labelDefs.write`（#105，常驻）—— 仓库里标签定义（名字、颜色、说明）的一趟改写；
 *  · `repo.init`（#106，常驻）—— 把工作区初始化并发布成 GitHub 仓库这一趟。
 *
 * 为什么三族共用一份机制、事件却各是各的：机制做的是同一件事 —— 进函数建一个事实桶，内层边走边填，
 * 出口按该事件登记的那几个字段投影成一行；而「说明书标题」不能合成一条：一条 `repo.write` 用 kind
 * 区分三种资源，会越加越宽，字段清单最后是所有族的并集。加一族只是加一行登记与一个纯函数，不动机制。
 *
 * 为什么结论由出口的纯函数算、不散在内层分支里：本仓踩过一次 —— `route` 曾在「算完差集」处就写成
 * `cli`，哪怕一条命令都没发。事实（发了几条、几条没成、走了哪条路）由内层填，结论只在一处推导；
 * 同一件事两处写，迟早对不上。改成这样之后内层再没有 `reason` 可写，编译器也会拦住重犯。
 *
 * 隐私：只记计数、布尔、枚举与耗时；票号、标题正文、标签名、颜色值、仓库地址、命令原文、上游报错
 * 原文一个字都不记（它们在工具返回值与 gh.exec / gh.timeout 那两条里）。字段白名单由
 * tests/verify-log-fields.js 守着，字段与「走了哪条路」的实况由 tests/verify-1053-issue-write.ts 守着。
 *
 * 记日志那层壳（`guardEmit`）、以及从返回里读结论的两件小事（`outcomeOf` / `failReason`）搬去了
 * `src/tracker/kernel/log-emit.ts`（#1182 第 3 件）：三座房的读出口、两座房的写出口抄的是同一副
 * 骨架，留着几份就会有一天给一处补上处理、别处忘了补。本文件对外导出的名字、签名与行为一个都没变。
 */

import type { OpContext } from '../../contract/contexts.js'
import { guardEmit, outcomeOf, failReason } from '../../kernel/log-emit.js'

/**
 * 一趟写走过的路：none 没走到外部调用 / rest 走 gh api / cli 走 gh issue 子命令 /
 * created 新建远程仓库 / existing 推到已有远程仓库。
 */
export type WriteRoute = 'none' | 'rest' | 'cli' | 'created' | 'existing'

/**
 * 一趟写的事实桶：内层实现边走边填，出口按事件各自登记的那几个字段投影。
 * 各族只填自己用得上那几格，余下的留 0、不进日志（票：written / failed；改色：planned / written / failed；
 * 初始化：route / steps）。按调用各建一个，并发写不会串。
 */
export interface WriteTrail {
  /** 走的哪条路。真发出命令那一刻才改口：一条都没发时保持 none —— 它说的是「真走到哪一层」，不是「本来打算走哪一层」。 */
  route: WriteRoute
  /** 这一趟打算动几条（改色用：入参里要改几个标签）。 */
  planned: number
  /** 真发出去几条写命令（0 表示幂等命中复用、一处没改，或压根没走到外部调用）。 */
  written: number
  /** 没成的步数（票：建完补挂没挂上的步数；改色：没改上的条数）。 */
  failed: number
  /** 一共起了几条外部命令（初始化用：走到第几步）。 */
  steps: number
}

export function beginWriteTrail(): WriteTrail {
  return { route: 'none', planned: 0, written: 0, failed: 0, steps: 0 }
}

// 从返回里读「成没成、失败是哪一档」（`outcomeOf`）与把档位拼成 `fail:<档位>`（`failReason`）
// 这两件小事，逐字同形的实现搬去了 `src/tracker/kernel/log-emit.ts`（#1182 第 3 件）：
// 三座房的读出口、两座房的写出口原本各抄一份，改一处忘一处就会让同一条结论线在不同房里长得不一样。

/**
 * 票写的结论：fresh 真新建 / reuse 幂等命中复用 / edited 改了已有票 / noop 一处没改 /
 * partial 写成了但有补挂没挂上 / fail:档位 失败。
 * 建票与其余几件的分别只在「一条写命令都没发」那一格：建票一条没发是复用已有一张，改票一条没发是一处没改。
 */
function issueReason(kind: string, t: WriteTrail, ok: boolean, errKind: string): string {
  if (!ok) return failReason(errKind)
  if (t.failed > 0) return 'partial'
  if (t.written === 0) return kind === 'create' ? 'reuse' : 'noop'
  return kind === 'create' ? 'fresh' : 'edited'
}

/**
 * 标签定义改写的结论：edited 都改上了 / partial 有的改上有的没改上 / allfailed 一条都没改上 /
 * noop 一条都不用改 / fail:档位 整批没能跑完。
 */
function labelDefsReason(t: WriteTrail, ok: boolean, errKind: string): string {
  if (!ok) return failReason(errKind)
  if (t.written === 0) return 'noop'
  if (t.failed === 0) return 'edited'
  return t.failed < t.written ? 'partial' : 'allfailed'
}

/** 初始化的结论：done 走完了 / fail:档位 停在哪一档；走的是新建仓库还是推到已有仓库看 route 那一格。 */
function repoInitReason(ok: boolean, errKind: string): string {
  return ok ? 'done' : failReason(errKind)
}

/**
 * 票写一行结论，字段是登记的那七个：kind 写的是哪一类（create / close / reopen / update / setAssignees /
 * comment / setLabels）、route 走的哪条路、ok 成没成、written 真发出去几条写命令、failed 补挂没挂上的步数、
 * reason 为什么是这个结论、latencyMs 这一趟花了多久（毫秒）。成功与失败都记，一趟一行。
 * 为什么定常驻（信息级）：写票是人和 AI 的显式动作（一次会话几条到几十条），出「这张票怎么没建上」
 * 「是不是建重了一张」这类问题时，查的人不会先打开调试开关；它也是这一族唯一一条「写没写下去」的结论线。
 */
export function emitIssueWrite(ctx: OpContext, kind: string, trail: WriteTrail, r: unknown, t0: number): void {
  guardEmit(ctx, (c) => {
    const o = outcomeOf(r)
    c.logEvent('info', 'issue.write', {
      kind: kind,
      route: trail.route,
      ok: o.ok,
      written: trail.written,
      failed: trail.failed,
      reason: issueReason(kind, trail, o.ok, o.errKind),
      latencyMs: Date.now() - t0,
    })
  })
}

/**
 * 标签定义改写一行结论：planned 这一趟打算动几个标签、written 真发出去几条改色命令、
 * failed 几条没改上、ok 成没成、reason 结论、latencyMs 耗时。标签名与颜色值都不记。
 * 为什么定常驻：批量改色是用户点一次才发生一次的显式动作，事后要能回答「这次要动 7 个，改上几个」。
 */
export function emitLabelDefsWrite(ctx: OpContext, trail: WriteTrail, r: unknown, t0: number): void {
  guardEmit(ctx, (c) => {
    const o = outcomeOf(r)
    c.logEvent('info', 'labelDefs.write', {
      planned: trail.planned,
      written: trail.written,
      failed: trail.failed,
      ok: o.ok,
      reason: labelDefsReason(trail, o.ok, o.errKind),
      latencyMs: Date.now() - t0,
    })
  })
}

/**
 * 仓库初始化一行结论：route 走的是新建仓库（created）还是推到已有仓库（existing）、
 * steps 这一趟一共起了几条外部命令（走到第几步）、ok 成没成、reason 结论、latencyMs 耗时。
 * 仓库名与地址不记。为什么定常驻：初始化失败最难事后追（仓库到底建没建起来、卡在推之前还是推之后），
 * 而它是用户点一次才发生一次的显式动作。
 */
export function emitRepoInitWrite(ctx: OpContext, trail: WriteTrail, r: unknown, t0: number): void {
  guardEmit(ctx, (c) => {
    const o = outcomeOf(r)
    c.logEvent('info', 'repo.init', {
      route: trail.route,
      steps: trail.steps,
      ok: o.ok,
      reason: repoInitReason(o.ok, o.errKind),
      latencyMs: Date.now() - t0,
    })
  })
}
