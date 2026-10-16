// values.ts —— 中央时间参数的生成源码（#1215 立）。
//
// 人手不改：本文件由 scripts/generate-time-config.mjs 按 config/timeouts.yaml 写出。
// 想调时间请改 YAML 再跑生成器；YAML 缺键时这里用回落底座（FALLBACKS）顶上，
// 落盘的值永远是“实际生效的值”，TIME_YAML 只记录“YAML 里写了哪些”。
// 本文件签入版本库：diff 就是调参记录。

export type TimeKey = 'toolTimeoutMs' | 'toolMarginMs' | 'perOpTimeoutMs' | 'outboundReadMs' | 'outboundWriteMs' | 'outboundProbeMs' | 'outboundDefaultMs' | 'githubClientTimeoutMs' | 'githubProbeMs' | 'gitProbeMs' | 'githubInitTimeoutMs' | 'gitlabReadMs' | 'gitlabSlowReadMs' | 'gitlabProbeMs' | 'gitlabRepoGitMs' | 'gitlabFallbackMs' | 'gitlabCreateProjectMs' | 'matchesTimeoutMs' | 'deckSandboxMs' | 'deckStoreMs' | 'deckEnsureMs' | 'deckHookMs' | 'deckAssemblyMs' | 'bridgeDryTableWaitMs' | 'delegatedCellWaitMs' | 'hostTimeoutMs' | 'keyLockMs' | 'canonicalTimeoutMs' | 'inFlightKeepAliveMs' | 'settingsDebugPushWaitMs' | 'quotaSyncCooldownMs' | 'registerRetryWaitMs' | 'shellResolveMs' | 'procProbeGraceMs' | 'procGraceMs' | 'probeIntervalMs' | 'probeIntervalYellowMs' | 'probeIntervalLingerMs' | 'rebuildMinIntervalYellowMs' | 'reconcileIntervalMs' | 'quotaSyncIntervalMs' | 'attentionHeartbeatMs' | 'preflightTtlMs' | 'chainAllGreenTtlMs' | 'deferExpiryMs' | 'failureHalfOpenDelayMs' | 'attentionExpiryMs' | 'activeLingerMs' | 'patchMergeWindowMs' | 'freshnessYellowMs' | 'freshnessRedMs' | 'ticketTtlMs' | 'workspaceStoreTtlMs' | 'chainRideMaxAgeMs' | 'snapshotTtlMs' | 'statusCacheMs' | 'snapshotCacheMs' | 'planCursorTtlMs' | 'anchorWindowMs' | 'idempotencyLookbackMs' | 'mapTicketsTtlMs' | 'chainBackoffMs';

export const TIME_ARRAY_KEYS: ReadonlyArray<TimeKey> = ["chainBackoffMs"];

/** YAML 里实际写了的键（缺键不在这里面）。想查“这个值是不是 YAML 里来的”，看这张表。 */
export const TIME_YAML: Partial<Record<TimeKey, number | ReadonlyArray<number>>> = {
  toolTimeoutMs: 300000,
  toolMarginMs: 15000,
  perOpTimeoutMs: 30000,
  outboundReadMs: 12000,
  outboundWriteMs: 30000,
  outboundProbeMs: 3000,
  outboundDefaultMs: 30000,
  githubClientTimeoutMs: 30000,
  githubProbeMs: 3000,
  gitProbeMs: 3000,
  githubInitTimeoutMs: 30000,
  gitlabReadMs: 8000,
  gitlabSlowReadMs: 10000,
  gitlabProbeMs: 5000,
  gitlabRepoGitMs: 3000,
  gitlabFallbackMs: 2000,
  gitlabCreateProjectMs: 60000,
  matchesTimeoutMs: 30000,
  deckSandboxMs: 5000,
  deckStoreMs: 10000,
  deckEnsureMs: 15000,
  deckHookMs: 5000,
  deckAssemblyMs: 8000,
  bridgeDryTableWaitMs: 8000,
  delegatedCellWaitMs: 25000,
  hostTimeoutMs: 30000,
  keyLockMs: 60000,
  canonicalTimeoutMs: 5000,
  inFlightKeepAliveMs: 2147483647,
  settingsDebugPushWaitMs: 5000,
  quotaSyncCooldownMs: 60000,
  registerRetryWaitMs: 2000,
  shellResolveMs: 8000,
  procProbeGraceMs: 1000,
  procGraceMs: 2000,
  probeIntervalMs: 5000,
  probeIntervalYellowMs: 120000,
  probeIntervalLingerMs: 15000,
  rebuildMinIntervalYellowMs: 300000,
  reconcileIntervalMs: 600000,
  quotaSyncIntervalMs: 60000,
  attentionHeartbeatMs: 20000,
  preflightTtlMs: 600000,
  chainAllGreenTtlMs: 1800000,
  deferExpiryMs: 300000,
  failureHalfOpenDelayMs: 300000,
  attentionExpiryMs: 90000,
  activeLingerMs: 30000,
  patchMergeWindowMs: 10000,
  freshnessYellowMs: 300000,
  freshnessRedMs: 1800000,
  ticketTtlMs: 120000,
  workspaceStoreTtlMs: 30000,
  chainRideMaxAgeMs: 30000,
  snapshotTtlMs: 5000,
  statusCacheMs: 30000,
  snapshotCacheMs: 60000,
  planCursorTtlMs: 604800000,
  anchorWindowMs: 300000,
  idempotencyLookbackMs: 1800000,
  mapTicketsTtlMs: 60000,
  chainBackoffMs: Object.freeze([8000, 30000, 120000, 300000]),
};

/** 回落底座：YAML 缺键时顶上的值 = 收拢当天各调用文件里的数字。改这里 = 改“缺键时按什么跑”，与调参是两件事。 */
export const TIME_FALLBACKS: Record<TimeKey, number | ReadonlyArray<number>> = {
  toolTimeoutMs: 300000,
  toolMarginMs: 15000,
  perOpTimeoutMs: 30000,
  outboundReadMs: 12000,
  outboundWriteMs: 30000,
  outboundProbeMs: 3000,
  outboundDefaultMs: 30000,
  githubClientTimeoutMs: 30000,
  githubProbeMs: 3000,
  gitProbeMs: 3000,
  githubInitTimeoutMs: 30000,
  gitlabReadMs: 8000,
  gitlabSlowReadMs: 10000,
  gitlabProbeMs: 5000,
  gitlabRepoGitMs: 3000,
  gitlabFallbackMs: 2000,
  gitlabCreateProjectMs: 60000,
  matchesTimeoutMs: 30000,
  deckSandboxMs: 5000,
  deckStoreMs: 10000,
  deckEnsureMs: 15000,
  deckHookMs: 5000,
  deckAssemblyMs: 8000,
  bridgeDryTableWaitMs: 8000,
  delegatedCellWaitMs: 25000,
  hostTimeoutMs: 30000,
  keyLockMs: 60000,
  canonicalTimeoutMs: 5000,
  inFlightKeepAliveMs: 2147483647,
  settingsDebugPushWaitMs: 5000,
  quotaSyncCooldownMs: 60000,
  registerRetryWaitMs: 2000,
  shellResolveMs: 8000,
  procProbeGraceMs: 1000,
  procGraceMs: 2000,
  probeIntervalMs: 5000,
  probeIntervalYellowMs: 120000,
  probeIntervalLingerMs: 15000,
  rebuildMinIntervalYellowMs: 300000,
  reconcileIntervalMs: 600000,
  quotaSyncIntervalMs: 60000,
  attentionHeartbeatMs: 20000,
  preflightTtlMs: 600000,
  chainAllGreenTtlMs: 1800000,
  deferExpiryMs: 300000,
  failureHalfOpenDelayMs: 300000,
  attentionExpiryMs: 90000,
  activeLingerMs: 30000,
  patchMergeWindowMs: 10000,
  freshnessYellowMs: 300000,
  freshnessRedMs: 1800000,
  ticketTtlMs: 120000,
  workspaceStoreTtlMs: 30000,
  chainRideMaxAgeMs: 30000,
  snapshotTtlMs: 5000,
  statusCacheMs: 30000,
  snapshotCacheMs: 60000,
  planCursorTtlMs: 604800000,
  anchorWindowMs: 300000,
  idempotencyLookbackMs: 1800000,
  mapTicketsTtlMs: 60000,
  chainBackoffMs: Object.freeze([8000, 30000, 120000, 300000]),
};

/** 取一个时间参数。YAML 有就用 YAML 的，缺键用回落底座（生成时已落盘，这里只是按同样的规则读）。 */
export function timeValue(key: TimeKey): number | ReadonlyArray<number> {
  const v = TIME_YAML[key] !== undefined ? TIME_YAML[key] : TIME_FALLBACKS[key];
  return v as number | ReadonlyArray<number>;
}

// —— 命名常量：调用方 import 这些名字，不直接碰 timeValue。名字与收拢前各文件的常量名同义，
// 改调用处时只是把右边的数字换成这里的名字，读起来还是原来那句话。
// ---- timeouts ----
export const TOOL_TIMEOUT_MS: number = 300000;
export const TOOL_MARGIN_MS: number = 15000;
export const PER_OP_TIMEOUT_MS: number = 30000;
export const OUTBOUND_READ_TIMEOUT_MS: number = 12000;
export const OUTBOUND_WRITE_TIMEOUT_MS: number = 30000;
export const OUTBOUND_PROBE_TIMEOUT_MS: number = 3000;
export const OUTBOUND_DEFAULT_TIMEOUT_MS: number = 30000;
export const GITHUB_CLIENT_TIMEOUT_MS: number = 30000;
export const GITHUB_PROBE_TIMEOUT_MS: number = 3000;
export const GIT_PROBE_TIMEOUT_MS: number = 3000;
export const GITHUB_INIT_TIMEOUT_MS: number = 30000;
export const GITLAB_READ_TIMEOUT_MS: number = 8000;
export const GITLAB_SLOW_READ_TIMEOUT_MS: number = 10000;
export const GITLAB_PROBE_TIMEOUT_MS: number = 5000;
export const GITLAB_REPO_GIT_TIMEOUT_MS: number = 3000;
export const GITLAB_FALLBACK_TIMEOUT_MS: number = 2000;
export const GITLAB_CREATE_PROJECT_TIMEOUT_MS: number = 60000;
export const MATCHES_TIMEOUT_MS: number = 30000;
export const DECK_SANDBOX_TIMEOUT_MS: number = 5000;
export const DECK_STORE_TIMEOUT_MS: number = 10000;
export const DECK_ENSURE_TIMEOUT_MS: number = 15000;
export const DECK_HOOK_TIMEOUT_MS: number = 5000;
export const DECK_ASSEMBLY_TIMEOUT_MS: number = 8000;
export const BRIDGE_DRY_TABLE_WAIT_MS: number = 8000;
export const DELEGATED_CELL_WAIT_MS: number = 25000;
export const HOST_TIMEOUT_MS: number = 30000;
export const KEY_LOCK_TIMEOUT_MS: number = 60000;
export const CANONICAL_TIMEOUT_MS: number = 5000;
export const IN_FLIGHT_KEEP_ALIVE_MS: number = 2147483647;
export const SETTINGS_DEBUG_PUSH_WAIT_MS: number = 5000;
export const QUOTA_SYNC_COOLDOWN_MS: number = 60000;
export const REGISTER_RETRY_WAIT_MS: number = 2000;
export const SHELL_RESOLVE_TIMEOUT_MS: number = 8000;
export const PROC_PROBE_GRACE_MS: number = 1000;
export const PROC_GRACE_MS: number = 2000;

// ---- intervals ----
export const PROBE_INTERVAL_MS: number = 5000;
export const PROBE_INTERVAL_YELLOW_MS: number = 120000;
export const PROBE_INTERVAL_LINGER_MS: number = 15000;
export const REBUILD_MIN_INTERVAL_YELLOW_MS: number = 300000;
export const RECONCILE_INTERVAL_MS: number = 600000;
export const QUOTA_SYNC_INTERVAL_MS: number = 60000;
export const ATTENTION_HEARTBEAT_MS: number = 20000;

// ---- ttl ----
export const PREFLIGHT_TTL_MS: number = 600000;
export const CHAIN_ALL_GREEN_TTL_MS: number = 1800000;
export const DEFER_EXPIRY_MS: number = 300000;
export const FAILURE_HALF_OPEN_DELAY_MS: number = 300000;
export const ATTENTION_EXPIRY_MS: number = 90000;
export const ACTIVE_LINGER_MS: number = 30000;
export const PATCH_MERGE_WINDOW_MS: number = 10000;
export const FRESHNESS_YELLOW_MS: number = 300000;
export const FRESHNESS_RED_MS: number = 1800000;
export const TICKET_TTL_MS: number = 120000;
export const WORKSPACE_STORE_TTL_MS: number = 30000;
export const CHAIN_RIDE_MAX_AGE_MS: number = 30000;
export const SNAPSHOT_TTL_MS: number = 5000;
export const STATUS_CACHE_MS: number = 30000;
export const SNAPSHOT_CACHE_MS: number = 60000;
export const PLAN_CURSOR_TTL_MS: number = 604800000;
export const ANCHOR_WINDOW_MS: number = 300000;
export const IDEMPOTENCY_LOOKBACK_MS: number = 1800000;
export const MAP_TICKETS_TTL_MS: number = 60000;

// ---- backoff ----
export const CHAIN_BACKOFF_MS: ReadonlyArray<number> = [8000, 30000, 120000, 300000];

