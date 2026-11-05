// snapshot-library-read.ts —— 快照库门面的两条新读口：版本查询与变化集（#1890，规格 #1885 S4）
//
// 为什么单列：宿主侧门面（snapshot-library.ts）贴着 350 有效行上限；这两条读口回答的是
// 「库现在是什么版本」「从那个版本到现在谁变了」，与写入、详情、评论那几族读写不是同一件事。
// 句柄缓存留在 snapshot-library-handles.ts，这里只做库这一侧的读与出错收口。
//
// 三条约定：
//   1. 库开不出来回 null，不抛、不编一个版本号：调用方据此如实回失败，而不是把「读不到」
//      说成「版本 0」（0 是一个合法的版本，会把客户端带进错误的整份判断）。
//   2. 变化集的上限由调用方传（宿主电话从中央时间参数取），这一层不读配置、不写死数字。
//   3. 只读句柄也能读：库是唯一真相，读不写，也不改租约。
import type { ChangeSetProjection } from '../../../workspace-snapshot/contract/types.js'
import { handleOf, type SnapshotLibraryKey } from './snapshot-library-handles.js'

/**
 * 库的占用读数（#1922）：库文件字节数、票行数，外加读它时的库版本。只读，不改库。
 *
 * 为什么版本一起读：读回包都带版本是规格 #1885 的 I2；诊断这一趟与库里的版本对得上，
 * 日志里「界面看到的」与「库里的」才能对起来。
 */
export interface LibraryStorageStats {
  version: number
  bytes: number
  rows: number
}

/** 读库占用（#1922）；库开不出来或读失败回 null，调用方如实说「读不到」，不编 0。 */
export async function readLibraryStorageStats(input: SnapshotLibraryKey): Promise<LibraryStorageStats | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  try {
    const stats = handle.readStorageStats()
    return { version: handle.getMergeVersion(), bytes: stats.bytes, rows: stats.rows }
  } catch (e) {
    return null
  }
}

/** 读当前库版本；库开不出来回 null。只读句柄也能读（租约被占时界面仍要看版本）。 */
export async function readLibraryVersion(input: SnapshotLibraryKey): Promise<number | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  try {
    return handle.getMergeVersion()
  } catch (e) {
    return null
  }
}

/** 变化集读口要的输入：库身份三格 + 从哪个版本起 + 两个降级阈值。 */
export interface LibraryChangeSetInput extends SnapshotLibraryKey {
  /** 客户端手上的库版本。不是非负整数时按「没有基线」处理（整份）。 */
  sinceVersion: number
  /** 客户端看到 sinceVersion 的时刻（毫秒）；0 / 缺省表示不知道，时间上限不参与判断。 */
  sinceMs?: number
  /** 变化的行与墓碑合计最多回几行；<=0 表示不设上限（门禁与内部调用才会这么给）。 */
  maxRows: number
  /** 客户端手上的版本最多允许有多旧（毫秒）；<=0 表示不设上限。 */
  maxAgeMs: number
}

/** 读一次变化集；库开不出来回 null（调用方如实回失败，不交半份数据）。 */
export async function readLibraryChangeSet(input: LibraryChangeSetInput): Promise<ChangeSetProjection | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  try {
    return handle.readChangeSet({
      sinceVersion: input.sinceVersion,
      ...(typeof input.sinceMs === 'number' ? { sinceMs: input.sinceMs } : null),
      maxRows: input.maxRows,
      maxAgeMs: input.maxAgeMs,
    })
  } catch (e) {
    return null
  }
}
