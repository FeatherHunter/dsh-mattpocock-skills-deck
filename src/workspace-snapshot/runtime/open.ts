// runtime/open.ts —— 对外入口：开库、校验身份、决定写模型、装配句柄。
//
// 开库顺序是有讲究的：
//   1. 先判定库文件在哪：本地磁盘走「多写者」，网络盘 / UNC 走「单写者 + 抢不到就只读」（#1932）；
//   2. 再做 quick_check。损坏的文件连 PRAGMA 都可能报错，必须在设 WAL 之前发现；
//   3. 损坏 → 关连接、三件套改名备份、重建空库，并落一条诊断（损坏原因 + 备份后缀）；
//   4. 结构版本不符 / 没有 meta / 身份（后端、仓库、工作区根）不符 → 整库重建并落诊断，
//      绝不静默把一个仓库的快照当成另一个仓库的；
//   5. 按第 1 步的类别决定写权：
//      - 本地：不抢租约、不启心跳，mode 直接是 writable；只处理一种例外——meta 里还留着
//        一条未过期的旧租约（可能是旧版本窗口还在写）。这时句柄仍是 writable，但每一次本地写
//        都回 legacy-writer，诊断说「请重启所有窗口」；租约过期后下一次写自动恢复。
//      - 网络：抢单写者租约。抢不到就关掉写连接、以只读连接重开，句柄 mode 变 readonly，
//        诊断 lease-held-readonly；抢到就起心跳，丢心跳降级只读。
//   6. 写连接根本开不出来（文件系统不可写）时，尝试只读打开：成功则 mode readonly + 诊断
//      readonly-filesystem；连只读都开不出来就照旧把原错误抛出去。
//
// 为什么重建用「删文件」而不是 DROP TABLE：损坏的库可能连 sqlite_master 都读不出来，
// 删文件是唯一能保证回到可用状态的做法；备份改名先做，失败就抛，绝不在没有证据的情况下删库。
//
// #1934 起重建是库外互斥的（细节在 runtime/rebuild-lock.ts 与 open-schema.ts）：
//   - 自动重建与 handle.rebuild() 都先拿 dbPath + '.rebuild-lock' 这把锁；拿不到抛
//     RebuildBusyError，一个文件都不删（宿主 catch 之后回落在线路径，下一次再试）。
//   - 自动重建拿到锁之后必须重看一遍库：等锁期间别人可能已经重建好了，直接用新库。
//   - openForWriting 这一层的只读兜底**不许**吞掉 RebuildBusyError：那是「稍后重试」，
//     不是「这个环境写不了」，伪装成只读句柄会让竞争现场永远好不了。
//
// 什么约定不能改：
//   - 本地路径不再写 meta 的租约三格（lease_owner / lease_heartbeat_ms / lease_expires_ms）。
//     空闲窗口只要开着就占着写权，正是规格 #1930 要废掉的东西；本地写靠 SQLite 的
//     BEGIN IMMEDIATE + busy_timeout 排队（见 runtime/write-ports.ts 与 runtime/ingest.ts）。
//   - 网络盘的租约三列与心跳时长一律保留，不许删列、不许删配置：网络回退还要用它们。
//   - 旧租约检测只认「过期时间在未来」这一条判活。只写了 owner 没有过期时间的残留行按过期处理，
//     否则用户会卡在一个没人持有、却谁也写不了的库里。
//   - 六条读口与三条写口分别住在 read-ports.ts / write-ports.ts（单文件 350 有效行的门禁）；
//     这个文件只留开库与写模型这条主干。
import { dirname, existsSync, mkdirSync, resolve } from './node-builtins.js'
import type {
  MarkMissingResult,
  OpenWorkspaceSnapshotOptions,
  OpenWorkspaceSnapshotResult,
  SnapshotMode,
  SnapshotStorageKind,
  WorkspaceSnapshotHandle,
 } from '../contract/types.js'
import type { SnapshotDiagnostic } from '../model/types.js'
import {
  applyReaderPragmas,
  closeDatabase,
  openDatabase,
  quickCheckDatabase,
} from '../persistence/database.js'
import {
  readMergeVersion,
  type SnapshotIdentity,
} from '../persistence/schema.js'
import {
  describeError,
  openWritableDatabase as openSchemaWritable,
  rebuildWritableDatabase,
} from './open-schema.js'
import { isRebuildBusyError } from './rebuild-lock.js'
import { createReadPorts } from './read-ports.js'
import { createWritePorts, LEGACY_WRITER_MESSAGE } from './write-ports.js'
import {
  clearResidualLease,
  isLeaseLive,
  readLeaseState,
  releaseLease,
  startLeaseHeartbeat,
  tryAcquireLease,
  type LeaseHeartbeat,
} from './lease.js'
import { detectStorageKindDetailed } from './storage-kind.js'
import { logSnapshot, shortHash } from './log.js'
import { defaultSnapshotDbPath, resolveSnapshotWorkspaceRoot } from './paths.js'

/** 允许的后端；运行时再挡一道，防止 JS 调用方传进不认识的字符串。 */
const SNAPSHOT_BACKENDS = new Set(['github', 'gitlab', 'markdown'])

/**
 * 判定「本地路径判不出来」的三种依据：都按本地多写者处理，并让开库日志说清这次是猜的
 * （见 README「写模型」一节：宁可多窗口可写，也不把本地库锁成只读）。
 */
const KIND_UNKNOWN_REASONS = new Set(['probe-failed', 'statfs-failed', 'no-existing-ancestor'])

/**
 * 打开工作区快照库。返回的 handle 是同步 API（理由见 contract/types.ts 的注释）。
 *
 * options.dbPath 存在时按调用方给的路径（测试注入）；否则按规格落到工作区根下的缓存目录。
 * 传入的 workspaceRoot 会先按 workspace.yaml 规则归一到根，身份校验与默认路径都用归一后的根。
 */
export function openWorkspaceSnapshot(
  options: OpenWorkspaceSnapshotOptions,
): OpenWorkspaceSnapshotResult {
  if (!options || typeof options !== 'object') throw new Error('openWorkspaceSnapshot 需要 options')
  if (typeof options.workspaceRoot !== 'string' || options.workspaceRoot.length === 0) {
    throw new Error('openWorkspaceSnapshot 缺少 workspaceRoot')
  }
  if (!SNAPSHOT_BACKENDS.has(options.backend)) {
    throw new Error('openWorkspaceSnapshot 不认识的后端：' + String(options.backend))
  }
  if (typeof options.repoIdentity !== 'string') {
    throw new Error('openWorkspaceSnapshot 缺少 repoIdentity')
  }

  const now = options.now ?? (() => Date.now())
  const root = resolveSnapshotWorkspaceRoot(options.workspaceRoot)
  const dbPath = options.dbPath
    ? resolve(options.dbPath)
    : defaultSnapshotDbPath(root, options.backend)
  const identity: SnapshotIdentity = {
    backend: options.backend,
    repoIdentity: options.repoIdentity,
    workspaceRoot: root,
  }
  // 写者标识只有网络盘那一路用得上；本地路径不写租约，这一格不参与任何判断。
  const owner = options.leaseOwner ?? `snapshot:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
  const diagnostics: SnapshotDiagnostic[] = []
  const logEvent = options.logEvent

  // 目录先建出来再判定路径：POSIX 那一路要 statfs 最近的已存在目录，目录不在就只能瞎猜。
  mkdirSync(dirname(dbPath), { recursive: true })
  const detection = options.storageKind
    ? { kind: options.storageKind, reason: 'option' }
    : detectStorageKindDetailed(dbPath)
  const storageKind: SnapshotStorageKind = detection.kind

  const existsBefore = existsSync(dbPath)
  const opened = openForWriting(dbPath, identity, now, diagnostics, logEvent)
  let db = opened.db
  let journalMode = opened.journalMode
  let mode: SnapshotMode = 'writable'
  let legacyWriterBlocked = false
  let heartbeat: LeaseHeartbeat | null = null
  let openReason: string | undefined

  if (opened.fallbackError !== undefined) {
    // 写连接开不出来：多半是文件系统不可写。只读能开就按只读环境工作，开不出来照旧抛原错误。
    journalMode = 'readonly'
    mode = 'readonly'
    openReason = 'readonly-filesystem'
    diagnostics.push({
      code: 'readonly-filesystem',
      message: '这个工作区所在的磁盘不能写，快照库以只读方式打开',
      detail: describeError(opened.fallbackError),
    })
  }

  if (mode === 'writable' && storageKind === 'local') {
    // 本地：不抢租约、不启心跳。只处理一种例外——meta 里还留着未过期的旧租约
    //（旧版本窗口可能还在写这个库；新旧混写会把数据写坏，所以先拒绝本地写，等租约过期）。
    const state = readLeaseState(db)
    if (isLeaseLive(state, now())) {
      legacyWriterBlocked = true
      openReason = 'legacy-writer'
      diagnostics.push({
        code: 'legacy-writer-restart',
        message: LEGACY_WRITER_MESSAGE + '，重启之前这个窗口不写本地库',
        detail: state.owner ? '持有者：' + state.owner : undefined,
      })
    } else if (state.owner !== null) {
      // 过期或残缺的残留行：开库时就清掉，让本地写从一开始就是通的（不需要用户做任何事）。
      clearResidualLease(db)
    }
    if (KIND_UNKNOWN_REASONS.has(detection.reason) && !legacyWriterBlocked) {
      // 判不出是不是网络盘：按本地多写者处理，并在开库这一条里说清这次是猜的。
      openReason = 'storage-kind-unknown'
    }
  }

  if (mode === 'writable' && storageKind === 'network') {
    // 网络盘 / UNC：保留单写者回退，抢不到就只读（多进程写 SMB/NFS 上的 SQLite 不安全）。
    const lease = tryAcquireNetworkLease(db, owner, now)
    if (!lease.acquired) {
      closeDatabase(db)
      db = openDatabase(dbPath, true)
      applyReaderPragmas(db)
      journalMode = 'readonly'
      mode = 'readonly'
      openReason = 'lease-held'
      diagnostics.push({
        code: 'lease-held-readonly',
        message: '快照库的写者租约被占用，已退回只读',
        detail: lease.detail,
      })
      // reason 是稳定的枚举（held = 别人拿着写权），持有者那一句人话放 detail；
      // 把两者混在 reason 里会让按 reason 过滤的排查看不到「抢不到」这一类。
      logSnapshot(logEvent, 'warn', 'workspaceSnapshot.lease', {
        acquired: false,
        ownerHash: shortHash(owner),
        reason: 'held',
        ...(lease.detail ? { detail: lease.detail } : null),
      })
    } else {
      heartbeat = startLeaseHeartbeat(db, owner, now, (error) => {
        if (mode !== 'writable') return
        mode = 'readonly'
        diagnostics.push({
          code: 'lease-lost-readonly',
          message: '快照库写者租约已丢失，句柄降级为只读',
          detail: describeError(error),
        })
        logSnapshot(logEvent, 'warn', 'workspaceSnapshot.lease', {
          acquired: false,
          ownerHash: shortHash(owner),
          reason: 'heartbeat-lost',
        })
      })
      logSnapshot(logEvent, 'info', 'workspaceSnapshot.lease', {
        acquired: true,
        ownerHash: shortHash(owner),
        nowMs: now(),
      })
    }
  }

  logSnapshot(logEvent, 'info', 'workspaceSnapshot.open', {
    backend: identity.backend,
    rootHash: shortHash(root),
    repoHash: shortHash(identity.repoIdentity),
    dbExisted: existsBefore,
    journalMode,
    mode,
    ...(openReason ? { reason: openReason } : null),
    mergeVersion: readMergeVersion(db),
    // 迁移过就说清「这一次没重建」：reason 已经给了更重要的那一句时不覆盖它。
    ...(opened.migratedFrom !== undefined && !openReason ? { reason: 'migrated-from-' + opened.migratedFrom } : null),
  })

  let closed = false
  const assertOpen = (): void => {
    if (closed) throw new Error('快照句柄已关闭')
  }

  /**
   * 本地写之前的旧租约重查（#1932）：租约过期就把残留行清掉并恢复写，不要求重启本窗口。
   * 返回 true = 现在不能写（还有一个未过期的旧租约）。网络盘恒为 false：那里的写权由 mode 表达。
   */
  const refreshLegacyWriterBlock = (): boolean => {
    if (storageKind !== 'local' || mode !== 'writable') return false
    const state = readLeaseState(db)
    if (state.owner === null) { legacyWriterBlocked = false; return false }
    if (isLeaseLive(state, now())) { legacyWriterBlocked = true; return true }
    clearResidualLease(db)
    legacyWriterBlocked = false
    return false
  }

  const readPorts = createReadPorts({
    db: () => db,
    dbPath,
    storageKind,
    now,
    ...(options.onReadStep ? { onReadStep: options.onReadStep } : null),
    assertOpen,
  })
  const writePorts = createWritePorts({
    db: () => db,
    now,
    ...(logEvent ? { logEvent } : null),
    mode: () => mode,
    storageKind,
    legacyWriteBlocked: refreshLegacyWriterBlock,
    assertOpen,
  })

  const handle: WorkspaceSnapshotHandle = {
    get mode(): SnapshotMode {
      return mode
    },
    get storageKind(): SnapshotStorageKind {
      return storageKind
    },
    /**
     * 现读现判：租约过期之后这一格要能自己变回 false，不需要等某次写或重开库。
     * 为什么在取值时读一次 meta：设置页的「写模型」一行读的就是它，一个只在写时才刷新的缓存会让
     * 设置页在租约早已过期时继续显示「请重启所有窗口」——而那正是本票要避免的「要求重启本窗口」。
     * 这里只读不清：清残留行仍然只在写之前做（写路径的职责），读口不写库。
     */
    get legacyWriterBlocked(): boolean {
      if (closed) return legacyWriterBlocked
      if (storageKind !== 'local' || mode !== 'writable') { legacyWriterBlocked = false; return false }
      legacyWriterBlocked = isLeaseLive(readLeaseState(db), now())
      return legacyWriterBlocked
    },
    ...readPorts,
    ...writePorts,
    rebuild(): void {
      assertOpen()
      if (mode !== 'writable') throw new Error('只读快照句柄不能整库重建')
      // 旧租约未过期时不重建：重建会删库重建，而另一个可能是旧版本的进程还在写这份库。
      // 先让用户重启所有窗口；这里如实抛一句人话，不静默降级成「重建了但没人知道」。
      if (refreshLegacyWriterBlock()) throw new Error(LEGACY_WRITER_MESSAGE + '，重启之后再重建本地库')
      // #1934：删库/建库这一段走库外互斥。先拿锁再关连接：拿不到锁时抛 RebuildBusyError，
      // 这个句柄仍然能用（读照常、写照常），不会因为一次「稍后重试」变成废句柄。
      const fresh = rebuildWritableDatabase(dbPath, identity, now(), logEvent, () => {
        heartbeat?.stop()
        heartbeat = null
        closeDatabase(db)
      })
      db = fresh.db
      journalMode = fresh.journalMode
      // 网络盘：重建之后重新抢一次写者租约（本地路径没有租约这一步）。
      if (storageKind === 'network') {
        const lease = tryAcquireNetworkLease(db, owner, now)
        if (!lease.acquired) {
          // 极窄的竞态：删库与重新抢租约之间别人先建了库并抢走租约。既不删别人的库，也不假装能写。
          closeDatabase(db)
          db = openDatabase(dbPath, true)
          applyReaderPragmas(db)
          journalMode = 'readonly'
          mode = 'readonly'
          diagnostics.push({
            code: 'lease-held-readonly',
            message: '整库重建后写者租约被占用，已退回只读',
            detail: lease.detail,
          })
          return
        }
        heartbeat = startLeaseHeartbeat(db, owner, now, (error) => {
          if (mode !== 'writable') return
          mode = 'readonly'
          diagnostics.push({
            code: 'lease-lost-readonly',
            message: '快照库写者租约已丢失，句柄降级为只读',
            detail: describeError(error),
          })
        })
      }
      mode = 'writable'
      logSnapshot(logEvent, 'info', 'workspaceSnapshot.open', {
        mode: 'writable',
        reason: 'rebuilt',
        journalMode,
        mergeVersion: readMergeVersion(db),
      })
    },
    close(): void {
      if (closed) return
      closed = true
      heartbeat?.stop()
      heartbeat = null
      // 本地路径没有租约可放；只有网络盘抢到过租约的那一份才需要释放。
      if (mode === 'writable' && storageKind === 'network') releaseLease(db, owner)
      closeDatabase(db)
      logSnapshot(logEvent, 'info', 'workspaceSnapshot.open', { mode: 'closed' })
    },
    getDiagnostics(): SnapshotDiagnostic[] {
      return diagnostics.slice()
    },
  }

  return { handle, mode, storageKind, diagnostics: diagnostics.slice() }
}

/** 开写连接的结果：fallbackError 有值表示写连接失败、这份连接是退而求其次的只读连接。 */
interface OpenedForWriting {
  db: import('node:sqlite').DatabaseSync
  journalMode: string
  migratedFrom?: number
  fallbackError?: unknown
}

/**
 * 先按可写开库；开不出来时尝试只读打开（#1932 的「真只读环境」）。
 *
 * 为什么只读连接还要跑 quick_check：写连接失败的原因不止「磁盘不可写」一种——损坏的库、
 * 被别人独占的库也会失败。只有 quick_check 通过，才敢把这份连接当成「能读的库」交给上层；
 * 否则会把一个坏库伪装成只读句柄，用户会看到「全是空的」而不是「库坏了」。
 */
function openForWriting(
  dbPath: string,
  identity: SnapshotIdentity,
  now: () => number,
  diagnostics: SnapshotDiagnostic[],
  logEvent: import('../contract/types.js').SnapshotLogEvent | undefined,
): OpenedForWriting {
  try {
    const opened = openSchemaWritable(dbPath, identity, now(), diagnostics, logEvent)
    return {
      db: opened.db,
      journalMode: opened.journalMode,
      ...(opened.migratedFrom !== undefined ? { migratedFrom: opened.migratedFrom } : null),
    }
  } catch (error) {
    // 「另一个窗口正在重建，等了一会儿没轮到」（#1934）不是「这个环境写不了」：
    // 吞成只读句柄会让升级/竞争现场伪装成一个永远只读的工作区，用户等多久都好不了。
    // 交给宿主：它 catch 之后回落在线路径，下一次刷新会再试一次开库。
    if (isRebuildBusyError(error)) throw error
    // #1936 评审修复：只把「真的写不了」的错误退成只读。SQLITE_BUSY（另一个写者占着写锁）、
    // 迁移失败、未知错误都不属于「这个环境不能写」——把它们吞成只读会把一次短暂竞争伪装成
    // 永久只读，句柄还会被 handleOf 缓存到会话结束（旧的「只读到重启」问题会回来）。
    if (!isReadOnlyEnvironmentError(error)) throw error
    const reader = openReadOnlyReader(dbPath)
    if (!reader) throw error
    return { db: reader, journalMode: 'readonly', fallbackError: error }
  }
}

/** 这个错误是不是「文件系统/权限真的写不了」，而不是短暂的锁竞争或迁移失败。 */
function isReadOnlyEnvironmentError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null | undefined)?.code || '')
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return true
  const message = String((error as { message?: unknown } | null | undefined)?.message || error || '')
  return /readonly|read-only|unable to open database file|attempt to write a readonly database/i.test(message)
}

/** 以只读连接打开并确认它能用；任何一步失败都回 null（调用方抛原来的错误）。 */
function openReadOnlyReader(dbPath: string): import('node:sqlite').DatabaseSync | null {
  let reader: import('node:sqlite').DatabaseSync | null = null
  try {
    reader = openDatabase(dbPath, true)
    applyReaderPragmas(reader)
    quickCheckDatabase(reader)
    return reader
  } catch {
    if (reader) closeDatabase(reader)
    return null
  }
}

/** 抢一次网络盘租约；失败（busy_timeout 之后仍拿不到写锁）按「抢不到」处理，不抛。 */
function tryAcquireNetworkLease(
  db: import('node:sqlite').DatabaseSync,
  owner: string,
  now: () => number,
): { acquired: boolean, detail?: string } {
  try {
    const lease = tryAcquireLease(db, owner, now())
    return {
      acquired: lease.acquired,
      ...(lease.holder ? { detail: '持有者：' + lease.holder } : null),
    }
  } catch (error) {
    return { acquired: false, detail: describeError(error) }
  }
}
