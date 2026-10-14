/**
 * write-guards.ts — 本地 Markdown 房写路径上的两道闸（#1174 决策 9）。
 *
 * 契约对写操作有两个承诺，缺一个都算没做到位：
 *   ① **写前版本校验**：调用方给了 `SetOpts.expectedUpdatedAt` 时，盘上这张票的更新时间对不上就回
 *      `conflict`，一个字都不写。它防的是「两个人同时改同一张票，后写的那次把先写的盖掉」——
 *      本地这一侧没有远端那样的事务，只能靠这一步自己比。
 *   ② **写后环检**：把「这张票改成由这批票阻塞」代进整张图判一次，成环就回 `conflict` 且不落盘。
 *      本地只挡自环是不够的（自环只是环里最短的一种），A 等 B、B 等 C、C 等 A 一样能让整张图卡死。
 *
 * 为什么单独放一个文件：这两个函数的共同点是「**拿不准就不放行**」——图读不全、文件时间取不到，
 * 都不许当成「没发现问题」。这类判断要在一个地方读得完，散在写操作里就容易被下一个改的人顺手绕过。
 * 它们与 `issues-patch.ts` 的关系是「被调用」：那边负责定位、读改写、字段合并，这边只管两道闸。
 */
import { statFile } from './read.js'
import { failAs } from './error-fail.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { readBlockedByGraph, cycleThrough } from './graph.js'
// #1060：环检这一趟的结论线（事件 `edge.cycle`，与 GitHub 房同一个名字、同一套字段）。
import { emitEdgeCycle, EDGE_CYCLE_VERDICT } from './edge-log.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { SetOpts } from '../../contract/inputs.js'

// 仓库引用：path 是本地后端的自有约定（契约不保证），有就多认那个目录（path.ts 的同款，房间里各备一份）。
type RepoWithPath = RepositoryRef & { path?: string }

// 本文件交出去的失败形状：与 failAs 落的三段式一致（流转到调用方那一侧时按结构兼容）。
interface GuardFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 这张票文件当前的「更新时间」：与票的 `updatedAt` 同源——`loadIssueFromFile` 取的就是文件 mtime。
 *  取不到就回 `null`：「拿不到版本」与「版本对得上」是两件事，混成一个值就会把「校验没做成」说成「校验通过」。 */
async function currentUpdatedAt(ctx: OpContext, fullPath: string): Promise<string | null> {
  try{
    const st=await statFile(ctx,fullPath) as Record<string, unknown> | null
    if(!st||typeof st!=='object')return null
    const t=st.mtime||st.mtimeMs||st.ctime
    if(t===undefined||t===null||t==='')return null
    if(t instanceof Date)return isNaN(t.getTime())?null:t.toISOString()
    if(typeof t==='number')return isNaN(t)?null:new Date(t).toISOString()
    const s=String(t)
    const d=new Date(s)
    return isNaN(d.getTime())?s:d.toISOString()
  }catch{return null}
}

/** 写前版本校验（#1174 决策 9；契约 `SetOpts.expectedUpdatedAt` 的乐观并发控制）。
 *
 *  四种情形各自诚实，绝不混：
 *   - 调用方**没给**期望值 → 不校验（今天全仓没有调用方传它，这是常态；见本票使用者故事 23）；
 *   - 给了、与盘上文件的更新时间**对得上** → 放行；
 *   - 给了、**对不上** → `conflict`，一个字都不写（这正是「不做后写覆盖先写」那句话的落点）；
 *   - 给了、但**文件时间取不到** → `unsupported`，也一个字都不写 —— 校验没做成就不许放行，
 *     放行等于把「不知道」说成「没被改过」。
 *
 *  原文一律给这次比的两个值（本地就能定论：是这两个串不一样），人据此自己核对。 */
export async function checkExpectedUpdatedAt(ctx: OpContext, fullPath: string, opts: SetOpts | undefined): Promise<{ ok: true } | GuardFailure> {
  const want=opts&&typeof opts.expectedUpdatedAt==='string'?opts.expectedUpdatedAt.trim():''
  if(!want)return{ok:true}
  const cur=await currentUpdatedAt(ctx,fullPath)
  if(cur===null){
    return failAs(ERROR_KIND.UNSUPPORTED,'这个后端取不到这张票的更新时间，写前版本校验做不成，所以这次一个字都没写',fullPath)
  }
  if(cur!==want){
    return failAs(ERROR_KIND.CONFLICT,'expectedUpdatedAt mismatch（这张票在你读到它之后已经被改过，所以这次一个字都没写）',JSON.stringify({expected:want,actual:cur}))
  }
  return{ok:true}
}

/** 把「这张票改成由这批票阻塞」代进整张图，判一次有没有成环。
 *
 *  两种结论：没有环 → 放行；有环 → `conflict`，并把环上经过的点按顺序写进原文给人看
 *  （只说「成环了」而不说哪几张票，人还得自己再去图上找一遍）。
 *  图读不全（列目录读不出来、某份票读不出来）时同样不放行：这时候「没看到环」不等于「没有环」。 */
export async function cycleVerdictFor(ctx: OpContext, repo: RepoWithPath | null, effortId: string, key: string, blockers: unknown[]): Promise<{ ok: true } | GuardFailure>{
  const t0=Date.now()
  const g=await readBlockedByGraph(ctx,repo,effortId)
  // 「没查成」也是一个结论（#1060）：图读不全时不放行这件事此前只落在返回里，导出包里看不出这一趟到底查没查。
  // 与 GitHub 房同一套写法记一行，取 `unchecked`（那边 unchecked 之后按不成环放行，本房因此连写都不写，差异见 edge-log.ts 文件头）。
  if(!g.ok){
    emitEdgeCycle(ctx,EDGE_CYCLE_VERDICT.UNCHECKED,0,blockers.length,t0)
    return{ok:false,error:g.error}
  }
  const graph=new Map<string,string[]>(g.graph)
  graph.set(key,blockers.map(function(k){ return String(k).padStart(2,'0') }).filter(Boolean))
  const cycle=cycleThrough(graph,key)
  // nodes 记的是这张邻接表里有几张票（含这次代进去的那张），人据此判断这一趟判环看全了没有。
  if(!cycle){
    emitEdgeCycle(ctx,EDGE_CYCLE_VERDICT.CLEAR,graph.size,blockers.length,t0)
    return{ok:true}
  }
  emitEdgeCycle(ctx,EDGE_CYCLE_VERDICT.CYCLE,graph.size,blockers.length,t0)
  return failAs(ERROR_KIND.CONFLICT,'这条依赖写下去会成环（'+cycle.join(' → ')+'），所以这次一个字都没写',JSON.stringify({key:key,blockers:blockers,cycle:cycle}))
}
