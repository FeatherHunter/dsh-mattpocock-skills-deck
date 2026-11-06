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
//   3. 只读句柄也能读：库是唯一真相，读不写，也不碰租约（本地路径根本没有租约；
//      网络盘回退的只读句柄也一样能读）。
import type { ChangeSetProjection, SnapshotMode, SnapshotStorageKind } from '../../../workspace-snapshot/contract/types.js'
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
  /**
   * 这个句柄现在能不能写（#1932）。语义见 contract/types.ts 的 SnapshotMode：
   * readonly 只表达真写不了（网络盘回退、文件系统只读），不再表达「另一个窗口拿着租约」。
   */
  mode: SnapshotMode
  /** 库落在本地磁盘还是网络盘（#1932）：设置页的「写模型」一行据此选说法。 */
  storageKind: SnapshotStorageKind
  /**
   * 本地路径上是否有未过期的旧租约挡住了写（#1932 验收 5）。它为真时 mode 仍是 writable——
   * 这个窗口能读、也能尝试写，只是每一次写会回 legacy-writer；用户要做的是重启所有窗口。
   * 设置页的「写模型」一行据此说「需要重启」，不该把它显示成正常的本地多写者。
   */
  legacyWriterBlocked: boolean
}

/** 读库占用（#1922）；库开不出来或读失败回 null，调用方如实说「读不到」，不编 0。 */
export async function readLibraryStorageStats(input: SnapshotLibraryKey): Promise<LibraryStorageStats | null> {
  const handle = await handleOf(input)
  if (!handle) return null
  try {
    const stats = handle.readStorageStats()
    // 写模型的三格与读数一起取：它们同属「这个窗口现在拿到的是一份怎样的库」这一个答案，
    // 分两次取会在两个句柄之间拼出一份自相矛盾的诊断（例如 storageKind=network 配 mode=writable
    // 却来自两次不同开库）。
    return {
      version: handle.getMergeVersion(),
      bytes: stats.bytes,
      rows: stats.rows,
      mode: handle.mode,
      storageKind: stats.storageKind,
      legacyWriterBlocked: handle.legacyWriterBlocked,
    }
  } catch (e) {
    return null
  }
}

/** 读当前库版本；库开不出来回 null。只读句柄也能读（网络盘回退到只读时界面仍要看版本）。 */
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
