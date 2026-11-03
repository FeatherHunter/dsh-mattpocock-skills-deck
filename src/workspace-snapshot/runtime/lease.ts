// runtime/lease.ts —— 单写者租约：抢、续、放。
//
// 为什么需要租约：同一份工作区可能被两个进程同时刷新（宿主重载、两个窗口），SQLite 本身
// 能保证事务串行，但「谁可以写」还需要一个跨进程的约定，否则两边会互相覆盖读结果。
// 做法是在 meta 那一行上做租约：BEGIN IMMEDIATE 拿到写锁后读租约，没人持有或已过期才写自己的
// 标识；心跳每 5 秒把过期时间推到 15 秒后，进程崩了最多 15 秒后别人可以接手。
//
// 抢不到不是错误：退回只读，列表照常能看，上层通过 diagnostics 与 handle.mode 感知。
import type { DatabaseSync } from 'node:sqlite'
import {
  SNAPSHOT_LEASE_HEARTBEAT_MS as LEASE_HEARTBEAT_MS,
  SNAPSHOT_LEASE_TTL_MS as LEASE_TTL_MS,
} from '../../shared/time-config/src/values.js'

// 两个时长都来自中央时间配置（心跳在 config/intervals.yaml、过期在 config/ttl.yaml），
// 本文件只引用生成常量、不留数字：改时长要改 YAML，再跑一次生成器。
export { LEASE_HEARTBEAT_MS, LEASE_TTL_MS }

export interface LeaseAcquireResult {
  acquired: boolean
  /** 抢不到时当前持有者（可能为空：刚过期但还没人接手）。 */
  holder: string | null
}

/**
 * 试着抢租约。整个过程在一个 IMMEDIATE 事务里：读租约与写租约之间不会有第二个写者插进来。
 *
 * 自己是当前持有者时视为续约（同一 owner 重入），这样 rebuild 之后重新抢不会自己挡自己。
 */
export function tryAcquireLease(db: DatabaseSync, owner: string, nowMs: number): LeaseAcquireResult {
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare('SELECT lease_owner, lease_expires_ms FROM meta WHERE id = 1').get() as
      | { lease_owner?: string | null, lease_expires_ms?: number | null }
      | null
    if (!row) throw new Error('快照库缺少 meta 行，无法抢租约')
    const holder = row.lease_owner ?? null
    const expires = row.lease_expires_ms == null ? null : Number(row.lease_expires_ms)
    const heldByOther = holder !== null && holder !== owner && expires !== null && expires > nowMs
    if (heldByOther) {
      db.exec('ROLLBACK')
      return { acquired: false, holder }
    }
    db.prepare(
      'UPDATE meta SET lease_owner = ?, lease_heartbeat_ms = ?, lease_expires_ms = ? WHERE id = 1',
    ).run(owner, nowMs, nowMs + LEASE_TTL_MS)
    db.exec('COMMIT')
    return { acquired: true, holder }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已自动回滚 */ }
    throw error
  }
}

/**
 * 释放租约。关库时调用：不释放的话，下一次开库要等 15 秒过期，测试与正常重载都会莫名变只读。
 * 只清自己的那一行，别人接手后不会误清。
 */
export function releaseLease(db: DatabaseSync, owner: string): void {
  try {
    db.prepare(
      'UPDATE meta SET lease_owner = NULL, lease_heartbeat_ms = NULL, lease_expires_ms = NULL WHERE id = 1 AND lease_owner = ?',
    ).run(owner)
  } catch {
    // 关库路径上的清理失败不改变「租约最多 15 秒后过期」这个事实。
  }
}

export interface LeaseHeartbeat {
  stop(): void
}

/**
 * 开始心跳。用注入的时钟算过期时间（测试可以用假时钟跨过 15 秒），定时器 unref 掉，
 * 不会因为快照库开着就拖住进程退出。
 *
 * 丢租约的两种情形都回调：更新影响 0 行（别人接手）或 SQLite 报错。回调里由 runtime
 * 把句柄降级成只读；心跳自己先停，避免继续往别人的租约上写。
 */
export function startLeaseHeartbeat(
  db: DatabaseSync,
  owner: string,
  now: () => number,
  onLost: (error?: unknown) => void,
): LeaseHeartbeat {
  let stopped = false
  const timer = setInterval(() => {
    if (stopped) return
    try {
      const nowMs = now()
      const result = db.prepare(
        'UPDATE meta SET lease_heartbeat_ms = ?, lease_expires_ms = ? WHERE id = 1 AND lease_owner = ?',
      ).run(nowMs, nowMs + LEASE_TTL_MS, owner)
      if (Number(result.changes) === 0) {
        stopped = true
        clearInterval(timer)
        onLost()
      }
    } catch (error) {
      stopped = true
      clearInterval(timer)
      onLost(error)
    }
  }, LEASE_HEARTBEAT_MS)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  return {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}
