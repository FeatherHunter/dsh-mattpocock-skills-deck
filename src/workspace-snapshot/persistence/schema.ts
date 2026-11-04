// persistence/schema.ts —— 十二张表的建表语句与库级元信息的读写。
//
// 表结构以 research/20261104-snapshot-database-schema-proposal.md 第 3 节为准，只做了
// TypeScript/命名上的适配，语义没有变。所有表 STRICT：类型写错当场报错，不静默存进去。
// 时间列一律是 UTC 毫秒整数；JSON 列只放开放形状，不参与查询。
//
// 一个库只属于一个身份（后端 + 仓库 + 工作区根）。身份匹配在 runtime/open.ts 开库时做，
// 这里只提供读取与初始化，不替调用方决定「不匹配时重建还是拒绝」。
import type { DatabaseSync } from 'node:sqlite'
import type { SnapshotBackend } from '../model/types.js'

/**
 * 库结构版本。升级走显式迁移（#1886 起），迁移失败或版本比本代码新才整库重建：
 * 版本 1 是「没有版本的存储层」，2 起加了版本号、行上的最后变化版本、墓碑与同步簿记。
 */
export const SNAPSHOT_SCHEMA_VERSION = 2

/** 建表顺序照顾外键：被引用的表先建。 */
export const SNAPSHOT_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE meta (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version     INTEGER NOT NULL,
    backend            TEXT NOT NULL,
    repo_identity      TEXT NOT NULL,
    workspace_root     TEXT NOT NULL,
    merge_version      INTEGER NOT NULL DEFAULT 0,
    last_write_ms      INTEGER NOT NULL DEFAULT 0,
    lease_owner        TEXT,
    lease_heartbeat_ms INTEGER,
    lease_expires_ms   INTEGER,
    sync_watermark_ms  INTEGER NOT NULL DEFAULT 0,
    sync_generation    INTEGER NOT NULL DEFAULT 0,
    sync_pending_json  TEXT,
    full_enumeration_ms INTEGER NOT NULL DEFAULT 0
  ) STRICT`,
  `CREATE TABLE actor (
    actor_id   INTEGER PRIMARY KEY,
    login      TEXT NOT NULL,
    kind       TEXT,
    name       TEXT,
    avatar_url TEXT
  ) STRICT`,
  `CREATE UNIQUE INDEX actor_login ON actor(login)`,
  `CREATE TABLE issue (
    issue_id             INTEGER PRIMARY KEY,
    effort_id            TEXT NOT NULL,
    key                  TEXT NOT NULL,
    type                 TEXT,
    title                TEXT,
    state                TEXT,
    url                  TEXT,
    created_at_ms        INTEGER,
    updated_at_ms        INTEGER,
    closed_at_ms         INTEGER,
    reason               TEXT,
    author_id            INTEGER REFERENCES actor(actor_id),
    is_pull_request      INTEGER,
    merged_at_ms         INTEGER,
    comment_count        INTEGER,
    sub_total            INTEGER,
    sub_completed        INTEGER,
    sub_percent          INTEGER,
    milestone_json       TEXT,
    custom_fields_json   TEXT,
    status               TEXT,
    status_visible       TEXT,
    status_source        TEXT,
    status_conflict_json TEXT,
    first_seen_ms        INTEGER NOT NULL,
    last_seen_ms         INTEGER NOT NULL,
    last_change_version  INTEGER NOT NULL DEFAULT 0
  ) STRICT`,
  `CREATE UNIQUE INDEX issue_identity ON issue(effort_id, key)`,
  `CREATE INDEX issue_state_updated ON issue(state, updated_at_ms DESC)`,
  `CREATE INDEX issue_change_version ON issue(last_change_version)`,
  `CREATE INDEX issue_type ON issue(type)`,
  `CREATE TABLE issue_body (
    issue_id INTEGER PRIMARY KEY REFERENCES issue(issue_id) ON DELETE CASCADE,
    body     TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE issue_group (
    issue_id        INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    group_name      TEXT NOT NULL,
    completeness    TEXT NOT NULL CHECK (completeness IN ('complete', 'truncated', 'unknown')),
    reason          TEXT,
    source          TEXT,
    operation       TEXT,
    last_queried_ms INTEGER NOT NULL,
    written_version INTEGER NOT NULL,
    PRIMARY KEY (issue_id, group_name)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE label (
    name        TEXT PRIMARY KEY,
    color       TEXT,
    description TEXT
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE issue_label (
    issue_id   INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    label_name TEXT NOT NULL REFERENCES label(name),
    position   INTEGER NOT NULL,
    PRIMARY KEY (issue_id, label_name)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE issue_assignee (
    issue_id INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    actor_id INTEGER NOT NULL REFERENCES actor(actor_id),
    position INTEGER NOT NULL,
    PRIMARY KEY (issue_id, actor_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE issue_edge (
    subject_id INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    object_id  INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('parent', 'blocks')),
    PRIMARY KEY (subject_id, kind, object_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE INDEX edge_object ON issue_edge(object_id, kind)`,
  `CREATE TABLE comment (
    row_id             INTEGER PRIMARY KEY,
    issue_id           INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    backend_id         TEXT,
    author_id          INTEGER REFERENCES actor(actor_id),
    author_association TEXT,
    body               TEXT NOT NULL,
    created_at_ms      INTEGER,
    updated_at_ms      INTEGER,
    edited_at_ms       INTEGER,
    position           INTEGER NOT NULL
  ) STRICT`,
  `CREATE UNIQUE INDEX comment_backend_id ON comment(issue_id, backend_id) WHERE backend_id IS NOT NULL`,
  `CREATE INDEX comment_order ON comment(issue_id, position)`,
  `CREATE TABLE review (
    issue_id        INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    state           TEXT NOT NULL,
    reviewer_id     INTEGER REFERENCES actor(actor_id),
    submitted_at_ms INTEGER,
    PRIMARY KEY (issue_id, position)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE fetch_cursor (
    issue_id   INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
    group_name TEXT NOT NULL,
    cursor     TEXT NOT NULL,
    updated_ms INTEGER NOT NULL,
    PRIMARY KEY (issue_id, group_name)
  ) STRICT, WITHOUT ROWID`,
  // 墓碑：某张票在哪个版本被确认不存在。行数据不删，删除只写这一张表；
  // 票重新出现时由写入路径把对应的墓碑清掉（ingest 里那一句 DELETE）。
  `CREATE TABLE issue_tombstone (
    issue_id      INTEGER PRIMARY KEY REFERENCES issue(issue_id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,
    deleted_at_ms INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX tombstone_version ON issue_tombstone(version)`,
]

export interface SnapshotIdentity {
  backend: SnapshotBackend
  repoIdentity: string
  workspaceRoot: string
}

export interface SnapshotMetaIdentity extends SnapshotIdentity {
  schemaVersion: number
}

/** 读 PRAGMA user_version；没有库结构时是 0。 */
export function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | null
  return Number(row?.user_version ?? 0)
}

/** 读 meta 里的身份；表不存在或行不存在都返回 null（调用方据此判为需要重建）。 */
export function readMetaIdentity(db: DatabaseSync): SnapshotMetaIdentity | null {
  try {
    const row = db.prepare(
      'SELECT schema_version, backend, repo_identity, workspace_root FROM meta WHERE id = 1',
    ).get() as
      | { schema_version?: number, backend?: string, repo_identity?: string, workspace_root?: string }
      | null
    if (!row) return null
    return {
      schemaVersion: Number(row.schema_version ?? 0),
      backend: String(row.backend ?? '') as SnapshotBackend,
      repoIdentity: String(row.repo_identity ?? ''),
      workspaceRoot: String(row.workspace_root ?? ''),
    }
  } catch {
    // 表不存在时 prepare 直接抛；身份检查用 null 表示「这里没有可用的 meta」。
    return null
  }
}

/** 读当前合并版本；meta 缺失是结构错误，直接抛，不拿 0 掩盖。 */
export function readMergeVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT merge_version FROM meta WHERE id = 1').get() as
    | { merge_version?: number }
    | null
  if (!row) throw new Error('快照库缺少 meta 行，无法读取合并版本')
  return Number(row.merge_version ?? 0)
}

/**
 * 建空库并把身份写进 meta。
 *
 * 整段在一个事务里：建表与写 meta 要么一起成功，要么全滚掉——不会留下「有表但没有身份」
 * 的半成品库，下次开库会把它误判成损坏或别的身份。调用方必须保证连接上没有别的事务。
 */
export function initializeSchema(
  db: DatabaseSync,
  identity: SnapshotIdentity,
  nowMs: number,
): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const statement of SNAPSHOT_SCHEMA_STATEMENTS) db.exec(statement)
    db.exec(`PRAGMA user_version = ${SNAPSHOT_SCHEMA_VERSION}`)
    db.prepare(
      `INSERT INTO meta (
        id, schema_version, backend, repo_identity, workspace_root,
        merge_version, last_write_ms, lease_owner, lease_heartbeat_ms, lease_expires_ms
      ) VALUES (1, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL)`,
    ).run(SNAPSHOT_SCHEMA_VERSION, identity.backend, identity.repoIdentity, identity.workspaceRoot, nowMs)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已因错误自动回滚 */ }
    throw error
  }
}
