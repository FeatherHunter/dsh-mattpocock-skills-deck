/**
 * src/refresh/rooms/host/snapshot-resync.ts —— 写回执失败后那次重同步的宿主接线（#1935）
 *
 * 谁调它：refresh-runtime 造出写事件取数那一格之后调用一次，把「排一次重同步」真正接到既有管线上。
 * 为什么不在 snapshot-library-behind.ts 里直接取数：状态模块要能在不挂宿主、不连库的门禁里单独验；
 * 取数只该有一条路，而这条路已经在 write-event-fetch.ts 里（读窗口索引 → 只补变的那几行 → 暂存给
 * 下一次探针），这里只负责延迟与转交，不新造第二条取数路。
 *
 * 两条不能改的约定：
 *  1. 延迟只从中央时间参数取（snapshotResyncDelayMs，2 秒）。不能等到常规 probe 的 5 分钟：
 *     那段时间里用户看到的就是本机旧数据。
 *  2. 先让取数那一格 remember(cwd) 再取数。写事件取数按「工作区短散列 → 目录」的映射找根，
 *     映射只在工作区变活跃时登记；重同步可能在一个还没标活跃的工作区上被叫醒，不先登记就会按
 *     write-no-root 直接返回，等于没重同步（真机上是「状态一直说落后」）。
 */
import { SNAPSHOT_RESYNC_DELAY_MS } from '../../../shared/time-config/src/values.js'
import type { SnapshotLibraryKey } from './snapshot-library-handles.js'
import { noteResyncStarted, setResyncScheduler } from './snapshot-library-behind.js'

/**
 * 把重同步入口接到写事件取数上。writeFetchOf 是懒取那一格的函数（写事件取数要等依赖装配好）。
 *
 * 排一次只排一次由状态模块管；这里只管「等 2 秒 → 交给既有取数」。取数那一趟结束（无论成败）都
 * 放开同一段落后的调度位，下一次失败还能再排一次。
 */
export function installResyncWiring(writeFetchOf: () => any): void {
  if (typeof writeFetchOf !== 'function') return
  setResyncScheduler(function (input: SnapshotLibraryKey): void {
    const cwd = String((input && input.workspaceRoot) || '')
    if (!cwd) return
    setTimeout(function (): void {
      let fetch: any = null
      try { fetch = writeFetchOf() } catch (e) { fetch = null }
      if (!fetch || typeof fetch.resync !== 'function') {
        // 取数那一格没接上（或老版本没有这一口）：不假装重同步过，放开调度位让下一次失败再试。
        noteResyncStarted(input)
        return
      }
      Promise.resolve(fetch.resync(cwd)).then(function (): void {
        noteResyncStarted(input)
      }, function (): void {
        noteResyncStarted(input)
      })
    }, SNAPSHOT_RESYNC_DELAY_MS)
  })
}
