/**
 * src/refresh/rooms/host/patch-wiring.ts —— 行级增量的宿主装配（从 refresh-runtime.ts 里原样搬出来，#1472）
 *
 * 为什么单独一个文件：refresh-runtime.ts 顶着自己的 350 有效行上限（tests/verify-file-granularity.ts），
 * 而 #1472 要往那条接线里加两件东西（写事件取数与探针短路）。把「按需造一份行级增量」这段装配原样搬出来，
 * 让 refresh-runtime 腾出行数，行为一个字不变：读哪份快照、写回哪两处、仓库坐标怎么问、这一笔过不过闸，
 * 全部仍由 refresh-runtime 现拼、从这里交进来。
 *
 * 不能改的三条约定（与搬出来之前逐字一致）：
 *  1. 惰性装配：真的有人跑增量之前一个对象都不造（createPatchForHost 会连带造出取数三件套的依赖）。
 *  2. 闸的后端编号在**调用那一刻**读（backendIdOf），不在装配时读死：当前后端是会话读出来的，
 *     装配的时候常常还没有（还没读过就缺席，闸按未知后端处理）。
 *  3. 写回快照的两处（宿主缓存与磁盘缓存）各自包 try：这是后台补行，写盘失败只该让这一趟白干，
 *     不许把调用方的工具调用带崩。
 */
import { createPatchForHost } from './refresh-assembly.js'

/** 装配行级增量要的几样：宿主入口那一包依赖、闸、后端编号的读法、只读会话装配口、工作区短散列。 */
export interface PatchWiringDeps {
  d: any
  gate: any
  backendIdOf: () => any
  openSession: any
  workspaceKeyOf: any
  logCtx?: any
}

/** 造出「按需一份行级增量」的入口。回 { patchOf }，patchOf() 第一次调用时才真的造对象。 */
export function createPatchWiring(deps: PatchWiringDeps): { patchOf: () => any } {
  const d: any = (deps && deps.d) || {}
  const gate: any = deps && deps.gate
  const openSession: any = deps && deps.openSession
  const workspaceKeyOf: any = deps && deps.workspaceKeyOf
  const logCtx: any = (deps && deps.logCtx) || null
  const backendIdOf: () => any = deps.backendIdOf
  let patchRunner: any = null
  function patchOf(): any {
    if (!patchRunner) {
      patchRunner = createPatchForHost({
        readSnapshot: function (cwd: any): any { try { const e: any = (typeof d.getCache === 'function') ? d.getCache(cwd) : null; return (e && e.snapshot) ? e.snapshot : null } catch (eR: any) { return null } },
        writeSnapshot: async function (cwd: any, snap: any): Promise<void> {
          try { if (typeof d.setCache === 'function') d.setCache({ ts: Date.now(), snapshot: snap, error: null, cwd: cwd }) } catch (eW: any) {}
          try { const repo: any = await d.getRepoKey(cwd); if (repo && typeof d.writeDiskCache === 'function') await d.writeDiskCache(repo, snap) } catch (eD: any) {}
        },
        indexOfSnapshot: function (snap: any): any { return (typeof d.issueIndexFromSnapshot === 'function') ? d.issueIndexFromSnapshot(snap) : {} },
        probeIndex: function (cwd: any, sinceIso: any): any { return (typeof d.fetchIssueIndex === 'function') ? d.fetchIssueIndex(cwd, sinceIso) : Promise.resolve({ ok: false }) },
        getRepoKey: function (cwd: any): any { return (typeof d.getRepoKey === 'function') ? d.getRepoKey(cwd) : Promise.resolve(null) },
        // #1446：闸按后端分桶算账，裁决也告诉它这是哪个后端（还没读过就缺席，闸按未知后端处理）。
        decide: function (req: any): any { const backendId: any = backendIdOf(); return gate.decideFor(backendId && req && typeof req === 'object' ? Object.assign({}, req, { backendId: backendId }) : req) },
        openSession: openSession, // #1444：薄行取数改走只读会话（取数文件不再经 send/runGh）
        // 与活跃集合、写事件白名单同一把短散列：不一致就会让探测这条路每一笔都被判「推迟」。
        workspaceKeyOf: workspaceKeyOf,
        now: Date.now,
        logCtx: logCtx,
      })
    }
    return patchRunner
  }
  return { patchOf: patchOf }
}
