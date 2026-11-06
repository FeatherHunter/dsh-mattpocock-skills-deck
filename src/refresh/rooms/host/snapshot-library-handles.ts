// src/refresh/rooms/host/snapshot-library-handles.ts —— 快照库句柄的缓存与开关（#1863 立起，#1888 拆出）
//
// 为什么单列：宿主侧的快照库门面（snapshot-library.ts）贴着 350 有效行上限，而 #1888 要往门面上
// 加「同步簿记读写、变化行提交、差分基线」四个口。句柄缓存这件事与那些新口无关，搬出来之后
// 门面只留业务读写，句柄这件事仍然只有一份实现。
//
// 约定：
//   1. 按 (工作区, 后端, 仓库身份) 懒开一个库句柄，最多同时留 MAX_HANDLES 个；淘汰时关掉最旧的。
//   2. 缓存句柄是为了让数据库连接只建一次（每次请求都开/关库会白付一次建连与 WAL 恢复的代价）。
//      #1932 起本地路径不再有租约心跳，缓存与「谁拿到写权」无关——本地所有窗口都能写；
//      只有网络盘路径上缓存句柄会顺带保住那份写者租约的心跳。
//   3. 日志出口由宿主注入；没注入就完全不记（与快照树 runtime/log.ts 的可选注入同一口径）。
/// <reference path="../../../workspace-snapshot/node-ambient.d.ts" />
import type {
  OpenWorkspaceSnapshotOptions,
  SnapshotBackend,
  WorkspaceSnapshotHandle,
} from '../../../workspace-snapshot/contract/types.js'

declare const process: { pid: number } | undefined

/** 快照树只暴露契约；开库这一句是本目录唯一一处动态 import 契约实现的地方。 */
async function openSnapshot(options: OpenWorkspaceSnapshotOptions): Promise<{ handle: WorkspaceSnapshotHandle }> {
  const mod = await import('../../../workspace-snapshot/contract/index.js')
  return mod.openWorkspaceSnapshot(options)
}

/** 同一工作区最多同时留几个库句柄；工作区一般只有一个，留 4 是给多仓库/多后端切换。 */
export const MAX_HANDLES = 4

/** 开库身份：三个格一起决定库文件与句柄，缺一个都会串工作区。 */
export interface SnapshotLibraryKey {
  workspaceRoot: string
  backend: string
  repoIdentity: string
}

interface HandleEntry {
  handle: WorkspaceSnapshotHandle
  key: string
}

const handles = new Map<string, HandleEntry>()
let leaseSeq = 0

/** #1869：快照库四族事件（开库、租约、写入、损坏重建）的出口；由宿主装配时注入。 */
export type SnapshotLogSink = (level: string, event: string, fields: Record<string, unknown>) => void
let logSink: SnapshotLogSink | null = null

/** 接上日志出口。传 null 关掉（门禁与测试用）。 */
export function setSnapshotLogSink(sink: SnapshotLogSink | null): void {
  logSink = sink
}

function cacheKeyOf(input: SnapshotLibraryKey): string {
  return [input.workspaceRoot, input.backend, input.repoIdentity].join('\u0000')
}

export function supportedBackend(backend: string): backend is SnapshotBackend {
  return backend === 'github' || backend === 'gitlab' || backend === 'markdown'
}

/** 拿一个可用的句柄；开不出来回 null（首屏不许因为库不可用而空，调用方会回落在线路径）。 */
export async function handleOf(input: SnapshotLibraryKey): Promise<WorkspaceSnapshotHandle | null> {
  if (!input.workspaceRoot || !supportedBackend(input.backend)) return null
  const key = cacheKeyOf(input)
  const hit = handles.get(key)
  if (hit) {
    // Map 的插入顺序当 LRU：每次命中挪到队尾。
    handles.delete(key)
    handles.set(key, hit)
    return hit.handle
  }
  let opened: { handle: WorkspaceSnapshotHandle }
  try {
    leaseSeq += 1
    const pid = (typeof process !== 'undefined' && process) ? process.pid : 0
    opened = await openSnapshot({
      workspaceRoot: input.workspaceRoot,
      backend: input.backend,
      repoIdentity: input.repoIdentity,
      // 写者标识只在网络盘路径上被写进 meta 的租约（本地路径根本不写租约，这一格不参与判断）。
      // 前缀用 rw-：旧代码的标识形如 refresh-… / snapshot:…，排查网络盘租约冲突时一眼能分出
      // 「这是读写锁版本写下的」还是「旧版本留下的」。改前缀只影响日志与排查，不影响判断。
      leaseOwner: 'rw-' + pid + '-' + leaseSeq,
      now: () => Date.now(),
      ...(logSink ? { logEvent: logSink as any } : null),
    })
  } catch (e) {
    return null
  }
  while (handles.size >= MAX_HANDLES) {
    const oldestKey = handles.keys().next().value as string | undefined
    if (oldestKey === undefined) break
    const oldest = handles.get(oldestKey)
    handles.delete(oldestKey)
    try { if (oldest) oldest.handle.close() } catch (e) { /* 关不掉也不影响新句柄 */ }
  }
  handles.set(key, { handle: opened.handle, key })
  return opened.handle
}

/** 测试与进程收尾用：关掉所有缓存句柄；之后再用会重新开库。 */
export function closeSnapshotLibraries(): void {
  for (const entry of handles.values()) {
    try { entry.handle.close() } catch (e) { /* 幂等关闭 */ }
  }
  handles.clear()
}

/** 当前缓存的句柄数（测试断言句柄上限用）。 */
export function snapshotLibraryHandleCount(): number {
  return handles.size
}
