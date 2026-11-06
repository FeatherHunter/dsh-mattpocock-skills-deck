/**
 * src/refresh/rooms/host/write-retry.ts —— 写回执遇到「写失败」时的有界重试（#1935）
 *
 * 为什么要有这一层：写回执（关票、改标签、发评论之后 tracker 交回来的那张票）落库时，SQLite 偶尔会
 * 因为瞬时事务冲突回 write-failed。之前这类失败一出现就把整笔回执丢掉，界面上的这一笔已经成了、
 * 本机库却还是旧的，只能等下一次整份刷新。这里按两档退避重试一次到两次，把「瞬时冲突」与
 * 「真的写不进去」分开。
 *
 * 只对 write-failed 重试，别的失败一律原样交回：
 *  - stale 是版本门挡下（期间有别的写者先提交了），重试带回来的还是同一份数据，等下一次读结果就好；
 *  - readonly 是磁盘本来就不可写，legacy-writer 是旧版本窗口还占着写权（#1932），两者都不会因为
 *    本进程再试一次而变好；
 *  - unavailable / 参数错误连句柄都没拿到，重试只是白等 15 秒。
 * 反例：不要为了「让回执一定能落库」把重试次数放大到几次以上——回执失败时界面已经可以继续，
 * 真正兜底的是随后安排的重同步（见 snapshot-library-behind.ts），不是在这里死等。
 *
 * 延迟来自中央时间参数（config/intervals.yaml 的 snapshotWriteRetryFirstMs / SecondMs），
 * 本文件不写死数字；门禁通过注入 sleep 替身来验「试了几次、等了多久」，不真的等 15 秒。
 */
import type { IngestResult } from '../../../workspace-snapshot/contract/types.js'
import {
  SNAPSHOT_WRITE_RETRY_FIRST_MS,
  SNAPSHOT_WRITE_RETRY_SECOND_MS,
} from '../../../shared/time-config/src/values.js'

/** 两档退避的毫秒数，顺序即重试顺序；只有两档，见文件头「不要放大次数」那条。 */
export const SNAPSHOT_WRITE_RETRY_DELAYS_MS: readonly number[] = [
  SNAPSHOT_WRITE_RETRY_FIRST_MS,
  SNAPSHOT_WRITE_RETRY_SECOND_MS,
]

/** 一次尝试要跑的东西：每次都重新读当前句柄版本、重新算这一批要写的组（评论回执的位置会变）。 */
export type IngestAttempt = () => IngestResult

/** 等一会儿的替身接口；门禁用它记录时长，生产用 setTimeout。 */
export type WriteRetrySleep = (ms: number) => Promise<void>

const defaultSleep: WriteRetrySleep = function (ms: number): Promise<void> {
  return new Promise<void>(function (resolve): void { setTimeout(resolve, ms) })
}

let sleepImpl: WriteRetrySleep = defaultSleep

/**
 * 门禁专用：替换等待实现，让「两次退避」不必真的等 15 秒。传 null 还原。
 * 生产代码不调用；它只影响本模块的等待，不影响重试次数与判定。
 */
export function setWriteRetrySleepForTest(sleep: WriteRetrySleep | null): void {
  sleepImpl = (typeof sleep === 'function') ? sleep : defaultSleep
}

/**
 * 跑一次写回执：第一次立即跑；只有回 write-failed 才按两档退避再试。
 *
 * 回最后一次尝试的结果，不把中间失败抹掉——调用方拿到的 reason 就是最终失败的原因，
 * 它据此决定要不要置「本机库落后」（只认 write-failed，见 snapshot-library-behind.ts）。
 */
export async function ingestWithRetry(attempt: IngestAttempt): Promise<IngestResult> {
  let result: IngestResult = attempt()
  for (let attemptIndex = 0; attemptIndex < SNAPSHOT_WRITE_RETRY_DELAYS_MS.length; attemptIndex += 1) {
    if (result.committed || result.reason !== 'write-failed') return result
    await sleepImpl(SNAPSHOT_WRITE_RETRY_DELAYS_MS[attemptIndex])
    result = attempt()
  }
  return result
}
