// values.ts —— 中央时间参数的生成源码（#1215 立）。
//
// 人手不改：本文件由 scripts/generate-time-config.mjs 按 config/ 下的三份时间参数文件写出
// （config/timeouts.yaml 超时、config/intervals.yaml 间隔与退避、config/ttl.yaml 有效期）。
// 想调时间请改 YAML 再跑生成器；YAML 缺键时这里用回落底座（FALLBACKS）顶上，
// 落盘的值永远是“实际生效的值”，TIME_YAML 只记录“YAML 里写了哪些”。
// 本文件签入版本库：diff 就是调参记录。

export type TimeKey = 'toolTimeoutMs' | 'toolMarginMs' | 'perOpTimeoutMs' | 'outboundReadMs' | 'outboundWriteMs' | 'outboundProbeMs' | 'outboundDefaultMs' | 'githubClientTimeoutMs' | 'githubProbeMs' | 'gitProbeMs' | 'githubInitTimeoutMs' | 'gitlabReadMs' | 'gitlabSlowReadMs' | 'gitlabProbeMs' | 'gitlabRepoGitMs' | 'gitlabFallbackMs' | 'gitlabCreateProjectMs' | 'vcRunTimeoutMs' | 'vcCheckCallBudgetMs' | 'vcLsFilesTimeoutMs' | 'vcRemoteTimeoutMs' | 'vcAddTimeoutMs' | 'vcCommitTimeoutMs' | 'vcPullTimeoutMs' | 'vcPushTimeoutMs' | 'vcFetchTimeoutMs' | 'vcReadCmdTimeoutMs' | 'vcHeadCallBudgetMs' | 'vcReadCallBudgetMs' | 'vcLsFilesCallBudgetMs' | 'vcRemoteListCallBudgetMs' | 'vcPrePushCheckCallBudgetMs' | 'vcWriteCallMarginMs' | 'gitCredentialCallBudgetMs' | 'gitCredentialMinBudgetMs' | 'gitCredentialMaxBudgetMs' | 'gitCredentialProbeTimeoutMs' | 'gitCredentialLsRemoteBudgetMs' | 'gitCredentialFetchBudgetMs' | 'gitCredentialPullBudgetMs' | 'gitCredentialPushBudgetMs' | 'gitCredentialDefaultBudgetMs' | 'gitLowSpeedTimeoutMs' | 'matchesTimeoutMs' | 'deckSandboxMs' | 'deckStoreMs' | 'deckEnsureMs' | 'deckLocalReadMs' | 'deckHookMs' | 'deckAssemblyMs' | 'bridgeDryTableWaitMs' | 'delegatedCellWaitMs' | 'hostTimeoutMs' | 'hostBootDeferMs' | 'keyLockMs' | 'canonicalTimeoutMs' | 'inFlightKeepAliveMs' | 'settingsDebugPushWaitMs' | 'quotaSyncCooldownMs' | 'registerRetryWaitMs' | 'shellResolveMs' | 'namingSummaryTimeoutMs' | 'logWatchdogMs' | 'probeAutoWaitMs' | 'procProbeGraceMs' | 'procGraceMs' | 'predicateTimeoutMs' | 'predicateFallbackTimeoutMs' | 'probeIntervalMs' | 'probeIntervalYellowMs' | 'probeIntervalLingerMs' | 'rebuildMinIntervalYellowMs' | 'reconcileIntervalMs' | 'quotaSyncIntervalMs' | 'attentionHeartbeatMs' | 'syncEvalGapMs' | 'syncDirtyProbeDebounceMs' | 'syncFailureBackoffMs' | 'syncPollGridMs' | 'syncFallbackProbeMs' | 'syncFocusProbeMinMs' | 'namingPersistDebounceMs' | 'namingSweepSoonMs' | 'namingFallbackIntervalMs' | 'namingRetryCooldownMs' | 'logWriteDebounceMs' | 'logFlushMs' | 'clientSessionTickMs' | 'clientHandoffDelayMs' | 'slotQueueStepMs' | 'slotModalOpenDelayMs' | 'storeSwitchConfirmMs' | 'statusMenuDismissDelayMs' | 'statusMenuHoverOpenDelayMs' | 'statusMenuFallbackDelayMs' | 'viewFlagWriteDebounceMs' | 'tipShowDelayMs' | 'tipHideDelayMs' | 'preflightTtlMs' | 'chainAllGreenTtlMs' | 'deferExpiryMs' | 'failureHalfOpenDelayMs' | 'attentionExpiryMs' | 'activeLingerMs' | 'patchMergeWindowMs' | 'freshnessYellowMs' | 'freshnessRedMs' | 'ticketTtlMs' | 'workspaceStoreTtlMs' | 'chainRideMaxAgeMs' | 'snapshotTtlMs' | 'statusCacheMs' | 'snapshotCacheMs' | 'planCursorTtlMs' | 'anchorWindowMs' | 'idempotencyLookbackMs' | 'mapTicketsTtlMs' | 'syncOverlapSkewMs' | 'syncDirtyEchoTtlMs' | 'syncActionProbeWindowMs' | 'syncSnapFreshMs' | 'syncIssueCacheTtlMs' | 'trackerIndexMaxWindowMs' | 'trackerIndexSkewMs' | 'skillListCacheTtlMs' | 'skillProbeCacheMs' | 'workspaceRootTtlMs' | 'snapWaitMs' | 'snapshotProbeMs' | 'storeNoticeDismissMs' | 'restFallbackStaleMs' | 'vcRelativeWindowMs' | 'issueDetailConfirmMs' | 'commentResultFlashMs' | 'commentsMoreLoadingMinMs' | 'copyFlashMs' | 'chainBackoffMs';

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
  vcRunTimeoutMs: 20000,
  vcCheckCallBudgetMs: 60000,
  vcLsFilesTimeoutMs: 15000,
  vcRemoteTimeoutMs: 5000,
  vcAddTimeoutMs: 15000,
  vcCommitTimeoutMs: 60000,
  vcPullTimeoutMs: 180000,
  vcPushTimeoutMs: 120000,
  vcFetchTimeoutMs: 120000,
  vcReadCmdTimeoutMs: 5000,
  vcHeadCallBudgetMs: 20000,
  vcReadCallBudgetMs: 10000,
  vcLsFilesCallBudgetMs: 30000,
  vcRemoteListCallBudgetMs: 15000,
  vcPrePushCheckCallBudgetMs: 15000,
  vcWriteCallMarginMs: 10000,
  gitCredentialCallBudgetMs: 240000,
  gitCredentialMinBudgetMs: 1000,
  gitCredentialMaxBudgetMs: 600000,
  gitCredentialProbeTimeoutMs: 5000,
  gitCredentialLsRemoteBudgetMs: 20000,
  gitCredentialFetchBudgetMs: 120000,
  gitCredentialPullBudgetMs: 180000,
  gitCredentialPushBudgetMs: 120000,
  gitCredentialDefaultBudgetMs: 60000,
  gitLowSpeedTimeoutMs: 20000,
  matchesTimeoutMs: 30000,
  deckSandboxMs: 5000,
  deckStoreMs: 10000,
  deckEnsureMs: 15000,
  deckLocalReadMs: 5000,
  deckHookMs: 5000,
  deckAssemblyMs: 8000,
  bridgeDryTableWaitMs: 8000,
  delegatedCellWaitMs: 25000,
  hostTimeoutMs: 30000,
  hostBootDeferMs: 30000,
  keyLockMs: 60000,
  canonicalTimeoutMs: 5000,
  inFlightKeepAliveMs: 2147483647,
  settingsDebugPushWaitMs: 5000,
  quotaSyncCooldownMs: 60000,
  registerRetryWaitMs: 2000,
  shellResolveMs: 8000,
  namingSummaryTimeoutMs: 30000,
  logWatchdogMs: 5000,
  probeAutoWaitMs: 15000,
  procProbeGraceMs: 1000,
  procGraceMs: 2000,
  predicateTimeoutMs: 15000,
  predicateFallbackTimeoutMs: 3000,
  probeIntervalMs: 5000,
  probeIntervalYellowMs: 120000,
  probeIntervalLingerMs: 15000,
  rebuildMinIntervalYellowMs: 300000,
  reconcileIntervalMs: 600000,
  quotaSyncIntervalMs: 60000,
  attentionHeartbeatMs: 20000,
  syncEvalGapMs: 4500,
  syncDirtyProbeDebounceMs: 1200,
  syncFailureBackoffMs: 300000,
  syncPollGridMs: 4000,
  syncFallbackProbeMs: 60000,
  syncFocusProbeMinMs: 60000,
  namingPersistDebounceMs: 1200,
  namingSweepSoonMs: 1500,
  namingFallbackIntervalMs: 600000,
  namingRetryCooldownMs: 45000,
  logWriteDebounceMs: 1000,
  logFlushMs: 1000,
  clientSessionTickMs: 1000,
  clientHandoffDelayMs: 2000,
  slotQueueStepMs: 80,
  slotModalOpenDelayMs: 1100,
  storeSwitchConfirmMs: 220,
  statusMenuDismissDelayMs: 300,
  statusMenuHoverOpenDelayMs: 200,
  statusMenuFallbackDelayMs: 160,
  viewFlagWriteDebounceMs: 500,
  tipShowDelayMs: 500,
  tipHideDelayMs: 160,
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
  syncOverlapSkewMs: 90000,
  syncDirtyEchoTtlMs: 60000,
  syncActionProbeWindowMs: 8000,
  syncSnapFreshMs: 60000,
  syncIssueCacheTtlMs: 60000,
  trackerIndexMaxWindowMs: 604800000,
  trackerIndexSkewMs: 60000,
  skillListCacheTtlMs: 30000,
  skillProbeCacheMs: 10000,
  workspaceRootTtlMs: 30000,
  snapWaitMs: 30000,
  snapshotProbeMs: 2600,
  storeNoticeDismissMs: 2800,
  restFallbackStaleMs: 3600000,
  vcRelativeWindowMs: 604800000,
  issueDetailConfirmMs: 3000,
  commentResultFlashMs: 1500,
  commentsMoreLoadingMinMs: 600,
  copyFlashMs: 1300,
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
  vcRunTimeoutMs: 20000,
  vcCheckCallBudgetMs: 60000,
  vcLsFilesTimeoutMs: 15000,
  vcRemoteTimeoutMs: 5000,
  vcAddTimeoutMs: 15000,
  vcCommitTimeoutMs: 60000,
  vcPullTimeoutMs: 180000,
  vcPushTimeoutMs: 120000,
  vcFetchTimeoutMs: 120000,
  vcReadCmdTimeoutMs: 5000,
  vcHeadCallBudgetMs: 20000,
  vcReadCallBudgetMs: 10000,
  vcLsFilesCallBudgetMs: 30000,
  vcRemoteListCallBudgetMs: 15000,
  vcPrePushCheckCallBudgetMs: 15000,
  vcWriteCallMarginMs: 10000,
  gitCredentialCallBudgetMs: 240000,
  gitCredentialMinBudgetMs: 1000,
  gitCredentialMaxBudgetMs: 600000,
  gitCredentialProbeTimeoutMs: 5000,
  gitCredentialLsRemoteBudgetMs: 20000,
  gitCredentialFetchBudgetMs: 120000,
  gitCredentialPullBudgetMs: 180000,
  gitCredentialPushBudgetMs: 120000,
  gitCredentialDefaultBudgetMs: 60000,
  gitLowSpeedTimeoutMs: 20000,
  matchesTimeoutMs: 30000,
  deckSandboxMs: 5000,
  deckStoreMs: 10000,
  deckEnsureMs: 15000,
  deckLocalReadMs: 5000,
  deckHookMs: 5000,
  deckAssemblyMs: 8000,
  bridgeDryTableWaitMs: 8000,
  delegatedCellWaitMs: 25000,
  hostTimeoutMs: 30000,
  hostBootDeferMs: 30000,
  keyLockMs: 60000,
  canonicalTimeoutMs: 5000,
  inFlightKeepAliveMs: 2147483647,
  settingsDebugPushWaitMs: 5000,
  quotaSyncCooldownMs: 60000,
  registerRetryWaitMs: 2000,
  shellResolveMs: 8000,
  namingSummaryTimeoutMs: 30000,
  logWatchdogMs: 5000,
  probeAutoWaitMs: 15000,
  procProbeGraceMs: 1000,
  procGraceMs: 2000,
  predicateTimeoutMs: 15000,
  predicateFallbackTimeoutMs: 3000,
  probeIntervalMs: 5000,
  probeIntervalYellowMs: 120000,
  probeIntervalLingerMs: 15000,
  rebuildMinIntervalYellowMs: 300000,
  reconcileIntervalMs: 600000,
  quotaSyncIntervalMs: 60000,
  attentionHeartbeatMs: 20000,
  syncEvalGapMs: 4500,
  syncDirtyProbeDebounceMs: 1200,
  syncFailureBackoffMs: 300000,
  syncPollGridMs: 4000,
  syncFallbackProbeMs: 60000,
  syncFocusProbeMinMs: 60000,
  namingPersistDebounceMs: 1200,
  namingSweepSoonMs: 1500,
  namingFallbackIntervalMs: 600000,
  namingRetryCooldownMs: 45000,
  logWriteDebounceMs: 1000,
  logFlushMs: 1000,
  clientSessionTickMs: 1000,
  clientHandoffDelayMs: 2000,
  slotQueueStepMs: 80,
  slotModalOpenDelayMs: 1100,
  storeSwitchConfirmMs: 220,
  statusMenuDismissDelayMs: 300,
  statusMenuHoverOpenDelayMs: 200,
  statusMenuFallbackDelayMs: 160,
  viewFlagWriteDebounceMs: 500,
  tipShowDelayMs: 500,
  tipHideDelayMs: 160,
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
  syncOverlapSkewMs: 90000,
  syncDirtyEchoTtlMs: 60000,
  syncActionProbeWindowMs: 8000,
  syncSnapFreshMs: 60000,
  syncIssueCacheTtlMs: 60000,
  trackerIndexMaxWindowMs: 604800000,
  trackerIndexSkewMs: 60000,
  skillListCacheTtlMs: 30000,
  skillProbeCacheMs: 10000,
  workspaceRootTtlMs: 30000,
  snapWaitMs: 30000,
  snapshotProbeMs: 2600,
  storeNoticeDismissMs: 2800,
  restFallbackStaleMs: 3600000,
  vcRelativeWindowMs: 604800000,
  issueDetailConfirmMs: 3000,
  commentResultFlashMs: 1500,
  commentsMoreLoadingMinMs: 600,
  copyFlashMs: 1300,
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
export const VC_RUN_TIMEOUT_MS: number = 20000;
export const VC_CHECK_CALL_BUDGET_MS: number = 60000;
export const VC_LSFILES_TIMEOUT_MS: number = 15000;
export const VC_REMOTE_TIMEOUT_MS: number = 5000;
export const VC_ADD_TIMEOUT_MS: number = 15000;
export const VC_COMMIT_TIMEOUT_MS: number = 60000;
export const VC_PULL_TIMEOUT_MS: number = 180000;
export const VC_PUSH_TIMEOUT_MS: number = 120000;
export const VC_FETCH_TIMEOUT_MS: number = 120000;
export const VC_READ_CMD_TIMEOUT_MS: number = 5000;
export const VC_HEAD_CALL_BUDGET_MS: number = 20000;
export const VC_READ_CALL_BUDGET_MS: number = 10000;
export const VC_LSFILES_CALL_BUDGET_MS: number = 30000;
export const VC_REMOTE_LIST_CALL_BUDGET_MS: number = 15000;
export const VC_PRE_PUSH_CHECK_CALL_BUDGET_MS: number = 15000;
export const VC_WRITE_CALL_MARGIN_MS: number = 10000;
export const GIT_CREDENTIAL_CALL_BUDGET_MS: number = 240000;
export const GIT_CREDENTIAL_MIN_BUDGET_MS: number = 1000;
export const GIT_CREDENTIAL_MAX_BUDGET_MS: number = 600000;
export const GIT_CREDENTIAL_PROBE_TIMEOUT_MS: number = 5000;
export const GIT_CREDENTIAL_LS_REMOTE_BUDGET_MS: number = 20000;
export const GIT_CREDENTIAL_FETCH_BUDGET_MS: number = 120000;
export const GIT_CREDENTIAL_PULL_BUDGET_MS: number = 180000;
export const GIT_CREDENTIAL_PUSH_BUDGET_MS: number = 120000;
export const GIT_CREDENTIAL_DEFAULT_BUDGET_MS: number = 60000;
export const GIT_LOW_SPEED_TIMEOUT_MS: number = 20000;
export const MATCHES_TIMEOUT_MS: number = 30000;
export const DECK_SANDBOX_TIMEOUT_MS: number = 5000;
export const DECK_STORE_TIMEOUT_MS: number = 10000;
export const DECK_ENSURE_TIMEOUT_MS: number = 15000;
export const DECK_LOCAL_READ_TIMEOUT_MS: number = 5000;
export const DECK_HOOK_TIMEOUT_MS: number = 5000;
export const DECK_ASSEMBLY_TIMEOUT_MS: number = 8000;
export const BRIDGE_DRY_TABLE_WAIT_MS: number = 8000;
export const DELEGATED_CELL_WAIT_MS: number = 25000;
export const HOST_TIMEOUT_MS: number = 30000;
export const HOST_BOOT_DEFER_MS: number = 30000;
export const KEY_LOCK_TIMEOUT_MS: number = 60000;
export const CANONICAL_TIMEOUT_MS: number = 5000;
export const IN_FLIGHT_KEEP_ALIVE_MS: number = 2147483647;
export const SETTINGS_DEBUG_PUSH_WAIT_MS: number = 5000;
export const QUOTA_SYNC_COOLDOWN_MS: number = 60000;
export const REGISTER_RETRY_WAIT_MS: number = 2000;
export const SHELL_RESOLVE_TIMEOUT_MS: number = 8000;
export const NAMING_SUMMARY_TIMEOUT_MS: number = 30000;
export const LOG_WATCHDOG_MS: number = 5000;
export const PROBE_AUTO_WAIT_MS: number = 15000;
export const PROC_PROBE_GRACE_MS: number = 1000;
export const PROC_GRACE_MS: number = 2000;
export const PREDICATE_TIMEOUT_MS: number = 15000;
export const PREDICATE_FALLBACK_TIMEOUT_MS: number = 3000;

// ---- intervals ----
export const PROBE_INTERVAL_MS: number = 5000;
export const PROBE_INTERVAL_YELLOW_MS: number = 120000;
export const PROBE_INTERVAL_LINGER_MS: number = 15000;
export const REBUILD_MIN_INTERVAL_YELLOW_MS: number = 300000;
export const RECONCILE_INTERVAL_MS: number = 600000;
export const QUOTA_SYNC_INTERVAL_MS: number = 60000;
export const ATTENTION_HEARTBEAT_MS: number = 20000;
export const SYNC_EVAL_GAP_MS: number = 4500;
export const SYNC_DIRTY_PROBE_DEBOUNCE_MS: number = 1200;
export const SYNC_FAILURE_BACKOFF_MS: number = 300000;
export const SYNC_POLL_GRID_MS: number = 4000;
export const SYNC_FALLBACK_PROBE_MS: number = 60000;
export const SYNC_FOCUS_PROBE_MIN_MS: number = 60000;
export const NAMING_PERSIST_DEBOUNCE_MS: number = 1200;
export const NAMING_SWEEP_SOON_MS: number = 1500;
export const NAMING_FALLBACK_INTERVAL_MS: number = 600000;
export const NAMING_RETRY_COOLDOWN_MS: number = 45000;
export const LOG_WRITE_DEBOUNCE_MS: number = 1000;
export const LOG_FLUSH_MS: number = 1000;
export const CLIENT_SESSION_TICK_MS: number = 1000;
export const CLIENT_HANDOFF_DELAY_MS: number = 2000;
export const SLOT_QUEUE_STEP_MS: number = 80;
export const SLOT_MODAL_OPEN_DELAY_MS: number = 1100;
export const STORE_SWITCH_CONFIRM_MS: number = 220;
export const STATUS_MENU_DISMISS_DELAY_MS: number = 300;
export const STATUS_MENU_HOVER_OPEN_DELAY_MS: number = 200;
export const STATUS_MENU_FALLBACK_DELAY_MS: number = 160;
export const VIEW_FLAG_WRITE_DEBOUNCE_MS: number = 500;
export const TIP_SHOW_DELAY_MS: number = 500;
export const TIP_HIDE_DELAY_MS: number = 160;

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
export const SYNC_OVERLAP_SKEW_MS: number = 90000;
export const SYNC_DIRTY_ECHO_TTL_MS: number = 60000;
export const SYNC_ACTION_PROBE_WINDOW_MS: number = 8000;
export const SYNC_SNAP_FRESH_MS: number = 60000;
export const SYNC_ISSUE_CACHE_TTL_MS: number = 60000;
export const TRACKER_INDEX_MAX_WINDOW_MS: number = 604800000;
export const TRACKER_INDEX_SKEW_MS: number = 60000;
export const SKILL_LIST_CACHE_TTL_MS: number = 30000;
export const SKILL_PROBE_CACHE_MS: number = 10000;
export const WORKSPACE_ROOT_TTL_MS: number = 30000;
export const SNAP_WAIT_MS: number = 30000;
export const SNAPSHOT_PROBE_MS: number = 2600;
export const STORE_NOTICE_DISMISS_MS: number = 2800;
export const REST_FALLBACK_STALE_MS: number = 3600000;
export const VC_RELATIVE_WINDOW_MS: number = 604800000;
export const ISSUE_DETAIL_CONFIRM_MS: number = 3000;
export const COMMENT_RESULT_FLASH_MS: number = 1500;
export const COMMENTS_MORE_LOADING_MIN_MS: number = 600;
export const COPY_FLASH_MS: number = 1300;

// ---- backoff ----
export const CHAIN_BACKOFF_MS: ReadonlyArray<number> = [8000, 30000, 120000, 300000];

