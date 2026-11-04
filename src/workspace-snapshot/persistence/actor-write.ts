// persistence/actor-write.ts —— 参与人按登录名落库（#1865 从 issue-groups-write.ts 搬出来共用）。
//
// 为什么单列：指派人、评论作者、评审人共用 actor 一张表，按登录名唯一。三处各写一遍 upsert，
// 迟早会有一处忘了 COALESCE，把已知的昵称/头像用 NULL 盖回去。所以 SQL 只留这一份。
//
// overwrite 的两种口径：
//   true  —— 完整来源：这一趟给什么就是什么，给 null 就是确认没有（标签/指派整组替换时用）；
//   false —— 补缺来源：只填旧值为空的那几格，不拿 null 覆盖已知（truncated 与评论作者用）。
import type { DatabaseSync } from 'node:sqlite'
import type { SnapshotActor } from '../model/types.js'

/** 写入一个参与人并拿回 actor_id。登录名为空是上游接线错误，直接抛，不静默丢作者。 */
export function upsertActor(db: DatabaseSync, item: SnapshotActor, overwrite: boolean): number {
  if (!item || typeof item.login !== 'string' || item.login.length === 0) {
    throw new Error('actor 写入缺少 login')
  }
  if (overwrite) {
    db.prepare(
      `INSERT INTO actor (login, kind, name, avatar_url) VALUES (?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET
         kind = excluded.kind, name = excluded.name, avatar_url = excluded.avatar_url`,
    ).run(item.login, item.kind ?? null, item.name ?? null, item.avatarUrl ?? null)
  } else {
    db.prepare(
      `INSERT INTO actor (login, kind, name, avatar_url) VALUES (?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET
         kind = COALESCE(excluded.kind, actor.kind),
         name = COALESCE(excluded.name, actor.name),
         avatar_url = COALESCE(excluded.avatar_url, actor.avatar_url)`,
    ).run(item.login, item.kind ?? null, item.name ?? null, item.avatarUrl ?? null)
  }
  const row = db.prepare('SELECT actor_id FROM actor WHERE login = ?').get(item.login) as
    | { actor_id?: number }
    | null
  if (!row) throw new Error(`actor 写入后读不回：${item.login}`)
  return Number(row.actor_id)
}
