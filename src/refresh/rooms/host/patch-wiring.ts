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
 *  3. #1893：宿主内存里的快照工作副本已删。生产装配只给「从库回放读基线」这一条读路，不给写路——
 *     变化行由 row-patch 经库门面提交，回包由投影产生。门禁夹具（不接库的老世界）可显式注入
 *     readSnapshotForPatch / writeSnapshotForPatch 两个口，那是测试替身，不是宿主的生产路径。
 */
import { createPatchForHost } from './refresh-assembly.js'
// #1888：行级增量的差分基线、水印/世代号/待办、变化行的写入都走快照库；这一层只把库门面与
// 仓库键交给 row-patch，库的身份拼接规则只有 ./patch-library-ports.ts 这一份。
import { createPatchLibraryPorts } from './patch-library-ports.js'
// #1870：基线索引与索引扫描用的是同一份实现（kernel 那一份会把地图容器与地图子票一起算进来）。
// 以前这里注入的是宿主入口手写的那一小段，它只遍历快照的 issues 数组：挂在 maps 下面的子票
// 一个都不在其中，于是子票一有变化就被判成「多出一条票」，整池重建。判据一源，别再抄第二份。
import { indexFromSnapshot } from '../../kernel/index-window-rules.js'

/** 装配行级增量要的几样：宿主入口那一包依赖、闸、后端编号的读法、只读会话装配口、工作区短散列、注册表。 */
export interface PatchWiringDeps {
  d: any
  gate: any
  backendIdOf: () => any
  openSession: any
  workspaceKeyOf: any
  logCtx?: any
  /** #1893：库身份解析（GitLab / 本地 Markdown 的 refId 只有 describe 给得出）。 */
  getTrackerRegistry?: (() => any) | null
}

/** 造出「按需一份行级增量」的入口。回 { patchOf }，patchOf() 第一次调用时才真的造对象。 */
export function createPatchWiring(deps: PatchWiringDeps): { patchOf: () => any } {
  const d: any = (deps && deps.d) || {}
  const gate: any = deps && deps.gate
  const openSession: any = deps && deps.openSession
  const workspaceKeyOf: any = deps && deps.workspaceKeyOf
  const logCtx: any = (deps && deps.logCtx) || null
  const backendIdOf: () => any = deps.backendIdOf
  const getTrackerRegistry: any = (deps && typeof deps.getTrackerRegistry === 'function') ? deps.getTrackerRegistry : null
  // #1893：生产路径不再有「写回宿主内存副本」这一步；下面两个口只给不接库的门禁夹具用。
  const legacyRead: any = (typeof d.readSnapshotForPatch === 'function') ? d.readSnapshotForPatch : null
  const legacyWrite: any = (typeof d.writeSnapshotForPatch === 'function') ? d.writeSnapshotForPatch : null
  // #1888：簿记、差分基线、变化行的读写口。库身份与回放读法都收在 patch-library-ports。
  const library = createPatchLibraryPorts({
    getSnapshotLibrary: (typeof d.getSnapshotLibrary === 'function')
      ? function (): any { return d.getSnapshotLibrary() }
      : null,
    getRepoKey: (typeof d.getRepoKey === 'function')
      ? function (cwd: any): any { return d.getRepoKey(cwd) }
      : null,
    getTrackerRegistry: getTrackerRegistry,
    // #1885 评审修复：本地证据（describe / 本地远程 / Markdown 目录）都答不上时才问会话；
    // 与两条读口同一条身份补齐链（tracker/session/repo-ref 的 resolveRepoRefForCwd）。
    openSession: (typeof openSession === 'function') ? openSession : null,
    backendIdOf: function (): string { return String(backendIdOf() || '') },
  })
  let patchRunner: any = null
  function patchOf(): any {
    if (!patchRunner) {
      patchRunner = createPatchForHost({
        // 生产：只从库回放拿基线。#1893 之前这里读的是宿主内存副本，库里为空时还会拿它兜底；
        // 现在两条都没有了——库回放为 null 就回 rebuild，交给整池（整池也会写库）。
        // generatedMs 取行组最老取数时刻：它是「每一行至少是那一刻取到的」，正是水印起点的真话
        // （readSnapshotReplay 专门算了这个值，不拿最新时刻顶替，见 SnapshotReplay.oldestRowAtMs）。
        readSnapshot: function (cwd: any): any {
          if (legacyRead) {
            try { const got = legacyRead(cwd); if (got) return got } catch (eR: any) { return null }
          }
          return library.readReplay(cwd).then(function (replay: any) {
            if (!replay) return null
            return Object.assign({}, replay.snapshot, { generatedMs: replay.oldestRowAtMs })
          }).catch(function (): any { return null })
        },
        // 生产不写整份快照；只有门禁夹具显式注入时才写它自己的假世界。
        writeSnapshot: legacyWrite || undefined,
        indexOfSnapshot: function (snap: any): any { return indexFromSnapshot(snap) || {} },
        probeIndex: function (cwd: any, sinceIso: any): any { return (typeof d.fetchIssueIndex === 'function') ? d.fetchIssueIndex(cwd, sinceIso) : Promise.resolve({ ok: false }) },
        getRepoKey: function (cwd: any): any { return (typeof d.getRepoKey === 'function') ? d.getRepoKey(cwd) : Promise.resolve(null) },
        // #1446：闸按后端分桶算账，裁决也告诉它这是哪个后端（还没读过就缺席，闸按未知后端处理）。
        decide: function (req: any): any { const backendId: any = backendIdOf(); return gate.decideFor(backendId && req && typeof req === 'object' ? Object.assign({}, req, { backendId: backendId }) : req) },
        openSession: openSession, // #1444：薄行取数改走只读会话（取数文件不再经 send/runGh）
        // 与活跃集合、写事件白名单同一把短散列：不一致就会让探测这条路每一笔都被判「推迟」。
        workspaceKeyOf: workspaceKeyOf,
        // #1888：差分基线、水印/世代号/待办、变化行都写进快照库；#1893 起这也是基线的唯一来源。
        library: library,
        // #1866：写回执先提交进本地快照库，提交成功调用方才更新界面。
        // 库门面没注入或打不开时回「降级」：这一趟照旧把回执交给界面，但不假装写进了库；
        // 门面在、但事务没提交（版本门丢弃或者写失败）时回 ok:false，调用方据此保持旧值。
        recordWriteReceipt: async function (input: any): Promise<any> {
          try {
            const lib: any = (typeof d.getSnapshotLibrary === 'function') ? await d.getSnapshotLibrary() : null
            if (!lib || typeof lib.recordWriteReceipt !== 'function') {
              return { ok: true, degraded: true, rows: 0, mergeVersion: null, reason: 'library-unavailable' }
            }
            return await lib.recordWriteReceipt(input)
          } catch (eR: any) {
            return { ok: false, rows: 0, mergeVersion: null, reason: 'receipt-threw' }
          }
        },
        now: Date.now,
        logCtx: logCtx,
      })
    }
    return patchRunner
  }
  return { patchOf: patchOf }
}
