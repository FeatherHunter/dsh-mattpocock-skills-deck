#!/usr/bin/env node
// scripts/generate-time-config.mjs —— 中央时间参数的生成器：读 config/ 下按用途分开的三份
// 时间参数文件（timeouts.yaml 超时 / intervals.yaml 间隔与退避 / ttl.yaml 有效期），
// 写出 src/shared/time-config/src/values.ts（签入版本库的那份生成源码）。
//
// 为什么是“生成”而不是“运行时读 YAML”：
//   · 客户端不经过 Node 运行时读文件——它吃的那几个值是构建时 splice 进去的（见 build.mjs），
//     服务器侧运行时读 YAML、客户端侧吃构建期快照，两边会悄悄分叉。统一走“YAML → 生成 .ts →
//     编译 / 转译 / splice”这一条路，两边吃的是同一份数字。
//   · 生成产物签入版本库：diff 里能看见“这次改了哪个时间、从几改到几”，回滚就是一次普通的文件回滚。
//
// 用法（在仓库根目录跑）：
//   node scripts/generate-time-config.mjs            按 YAML 重写 values.ts
//   node scripts/generate-time-config.mjs --check   只比对，不写文件；
//       对不上时退出码 1（package.json 的 typecheck 脚本与 tests/verify-time-config.ts 都靠它看门）。
//
// 缺键是合法状态，不是故障：YAML 里没写的键，生成器只告警，values.ts 里用“回落底座”
// （FALLBACKS，值 = 收拢当天各文件里的数字）顶上。所以“先加调用、后补 YAML”不会把构建炸掉；
// 反过来，未知键一律报错——多半是拼错了，静默忽略会让拼错的键看起来“生效了”。

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import yaml from 'yaml'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const OUT_PATH = path.join(ROOT, 'src', 'shared', 'time-config', 'src', 'values.ts')
// 三份文件按用途分开，每份声明哪些分组是固定的：同一组写进两份文件、或写错文件，都在这里报错。
const YAML_FILES = ['config/timeouts.yaml', 'config/intervals.yaml', 'config/ttl.yaml']
const FILE_OF_GROUP = {
  timeouts: 'config/timeouts.yaml',
  intervals: 'config/intervals.yaml',
  backoff: 'config/intervals.yaml',
  ttl: 'config/ttl.yaml',
}

// ---------------------------------------------------------------------------
// 键表：YAML 键 → 生成的常量名 → 分组。分组只干一件事：决定校验规则
// （backoff 组是数组，其余三组是正整数毫秒）。
// ---------------------------------------------------------------------------
const ARRAY_GROUP = 'backoff'
/**
 * JavaScript 定时器能表达的延时上限（2^31-1 毫秒，约 24.8 天）。比它大的数交给 setTimeout / setInterval
 * 会被运行时折成 1 毫秒——「等于不超时」会悄悄变成「立刻超时」。今天没有键越过这条线
 * （inFlightKeepAliveMs 正好等于上限，是刻意的「永不」），这条常数只用来在下面发一句告警。
 */
const JS_TIMER_MAX_MS = 2147483647
/** [yaml键, 生成的常量名, 分组] */
const KEYS = [
  // —— timeouts：单次等待的上限 ——
  ['toolTimeoutMs', 'TOOL_TIMEOUT_MS', 'timeouts'],
  ['toolMarginMs', 'TOOL_MARGIN_MS', 'timeouts'],
  ['perOpTimeoutMs', 'PER_OP_TIMEOUT_MS', 'timeouts'],
  ['outboundReadMs', 'OUTBOUND_READ_TIMEOUT_MS', 'timeouts'],
  ['outboundWriteMs', 'OUTBOUND_WRITE_TIMEOUT_MS', 'timeouts'],
  ['outboundProbeMs', 'OUTBOUND_PROBE_TIMEOUT_MS', 'timeouts'],
  ['outboundDefaultMs', 'OUTBOUND_DEFAULT_TIMEOUT_MS', 'timeouts'],
  ['githubClientTimeoutMs', 'GITHUB_CLIENT_TIMEOUT_MS', 'timeouts'],
  ['githubProbeMs', 'GITHUB_PROBE_TIMEOUT_MS', 'timeouts'],
  ['gitProbeMs', 'GIT_PROBE_TIMEOUT_MS', 'timeouts'],
  ['githubInitTimeoutMs', 'GITHUB_INIT_TIMEOUT_MS', 'timeouts'],
  ['gitlabReadMs', 'GITLAB_READ_TIMEOUT_MS', 'timeouts'],
  ['gitlabSlowReadMs', 'GITLAB_SLOW_READ_TIMEOUT_MS', 'timeouts'],
  ['gitlabProbeMs', 'GITLAB_PROBE_TIMEOUT_MS', 'timeouts'],
  ['gitlabRepoGitMs', 'GITLAB_REPO_GIT_TIMEOUT_MS', 'timeouts'],
  ['gitlabFallbackMs', 'GITLAB_FALLBACK_TIMEOUT_MS', 'timeouts'],
  ['gitlabCreateProjectMs', 'GITLAB_CREATE_PROJECT_TIMEOUT_MS', 'timeouts'],
  // —— 宿主直调的 git 命令与凭据助手（2026-10-16 全量收拢补）——
  ['vcRunTimeoutMs', 'VC_RUN_TIMEOUT_MS', 'timeouts'],
  ['vcCheckCallBudgetMs', 'VC_CHECK_CALL_BUDGET_MS', 'timeouts'],
  ['vcLsFilesTimeoutMs', 'VC_LSFILES_TIMEOUT_MS', 'timeouts'],
  ['vcRemoteTimeoutMs', 'VC_REMOTE_TIMEOUT_MS', 'timeouts'],
  ['vcAddTimeoutMs', 'VC_ADD_TIMEOUT_MS', 'timeouts'],
  ['vcCommitTimeoutMs', 'VC_COMMIT_TIMEOUT_MS', 'timeouts'],
  ['vcPullTimeoutMs', 'VC_PULL_TIMEOUT_MS', 'timeouts'],
  ['vcPushTimeoutMs', 'VC_PUSH_TIMEOUT_MS', 'timeouts'],
  ['vcFetchTimeoutMs', 'VC_FETCH_TIMEOUT_MS', 'timeouts'],
  ['vcReadCmdTimeoutMs', 'VC_READ_CMD_TIMEOUT_MS', 'timeouts'],
  ['vcHeadCallBudgetMs', 'VC_HEAD_CALL_BUDGET_MS', 'timeouts'],
  ['vcReadCallBudgetMs', 'VC_READ_CALL_BUDGET_MS', 'timeouts'],
  ['vcLsFilesCallBudgetMs', 'VC_LSFILES_CALL_BUDGET_MS', 'timeouts'],
  ['vcRemoteListCallBudgetMs', 'VC_REMOTE_LIST_CALL_BUDGET_MS', 'timeouts'],
  ['vcPrePushCheckCallBudgetMs', 'VC_PRE_PUSH_CHECK_CALL_BUDGET_MS', 'timeouts'],
  ['vcWriteCallMarginMs', 'VC_WRITE_CALL_MARGIN_MS', 'timeouts'],
  ['gitCredentialCallBudgetMs', 'GIT_CREDENTIAL_CALL_BUDGET_MS', 'timeouts'],
  ['gitCredentialMinBudgetMs', 'GIT_CREDENTIAL_MIN_BUDGET_MS', 'timeouts'],
  ['gitCredentialMaxBudgetMs', 'GIT_CREDENTIAL_MAX_BUDGET_MS', 'timeouts'],
  ['gitCredentialProbeTimeoutMs', 'GIT_CREDENTIAL_PROBE_TIMEOUT_MS', 'timeouts'],
  ['gitCredentialLsRemoteBudgetMs', 'GIT_CREDENTIAL_LS_REMOTE_BUDGET_MS', 'timeouts'],
  ['gitCredentialFetchBudgetMs', 'GIT_CREDENTIAL_FETCH_BUDGET_MS', 'timeouts'],
  ['gitCredentialPullBudgetMs', 'GIT_CREDENTIAL_PULL_BUDGET_MS', 'timeouts'],
  ['gitCredentialPushBudgetMs', 'GIT_CREDENTIAL_PUSH_BUDGET_MS', 'timeouts'],
  ['gitCredentialDefaultBudgetMs', 'GIT_CREDENTIAL_DEFAULT_BUDGET_MS', 'timeouts'],
  ['gitLowSpeedTimeoutMs', 'GIT_LOW_SPEED_TIMEOUT_MS', 'timeouts'],
  ['matchesTimeoutMs', 'MATCHES_TIMEOUT_MS', 'timeouts'],
  ['deckSandboxMs', 'DECK_SANDBOX_TIMEOUT_MS', 'timeouts'],
  ['deckStoreMs', 'DECK_STORE_TIMEOUT_MS', 'timeouts'],
  ['deckEnsureMs', 'DECK_ENSURE_TIMEOUT_MS', 'timeouts'],
  ['deckLocalReadMs', 'DECK_LOCAL_READ_TIMEOUT_MS', 'timeouts'],
  ['deckHookMs', 'DECK_HOOK_TIMEOUT_MS', 'timeouts'],
  ['deckAssemblyMs', 'DECK_ASSEMBLY_TIMEOUT_MS', 'timeouts'],
  ['bridgeDryTableWaitMs', 'BRIDGE_DRY_TABLE_WAIT_MS', 'timeouts'],
  ['delegatedCellWaitMs', 'DELEGATED_CELL_WAIT_MS', 'timeouts'],
  ['hostTimeoutMs', 'HOST_TIMEOUT_MS', 'timeouts'],
  ['hostBootDeferMs', 'HOST_BOOT_DEFER_MS', 'timeouts'],
  ['keyLockMs', 'KEY_LOCK_TIMEOUT_MS', 'timeouts'],
  ['canonicalTimeoutMs', 'CANONICAL_TIMEOUT_MS', 'timeouts'],
  ['inFlightKeepAliveMs', 'IN_FLIGHT_KEEP_ALIVE_MS', 'timeouts'],
  ['settingsDebugPushWaitMs', 'SETTINGS_DEBUG_PUSH_WAIT_MS', 'timeouts'],
  ['quotaSyncCooldownMs', 'QUOTA_SYNC_COOLDOWN_MS', 'timeouts'],
  ['registerRetryWaitMs', 'REGISTER_RETRY_WAIT_MS', 'timeouts'],
  ['shellResolveMs', 'SHELL_RESOLVE_TIMEOUT_MS', 'timeouts'],
  ['namingSummaryTimeoutMs', 'NAMING_SUMMARY_TIMEOUT_MS', 'timeouts'],
  ['logWatchdogMs', 'LOG_WATCHDOG_MS', 'timeouts'],
  ['probeAutoWaitMs', 'PROBE_AUTO_WAIT_MS', 'timeouts'],
  ['procProbeGraceMs', 'PROC_PROBE_GRACE_MS', 'timeouts'],
  ['procGraceMs', 'PROC_GRACE_MS', 'timeouts'],
  // —— 检测链里的谓词超时（对抗式自查补登记：原来写在 option 对象里，名字是裸 timeout，两边都看不见）——
  ['predicateTimeoutMs', 'PREDICATE_TIMEOUT_MS', 'timeouts'],
  ['predicateFallbackTimeoutMs', 'PREDICATE_FALLBACK_TIMEOUT_MS', 'timeouts'],
  // —— intervals：节拍间隔 ——
  ['probeIntervalMs', 'PROBE_INTERVAL_MS', 'intervals'],
  ['probeIntervalYellowMs', 'PROBE_INTERVAL_YELLOW_MS', 'intervals'],
  ['probeIntervalLingerMs', 'PROBE_INTERVAL_LINGER_MS', 'intervals'],
  ['rebuildMinIntervalYellowMs', 'REBUILD_MIN_INTERVAL_YELLOW_MS', 'intervals'],
  ['reconcileIntervalMs', 'RECONCILE_INTERVAL_MS', 'intervals'],
  ['quotaSyncIntervalMs', 'QUOTA_SYNC_INTERVAL_MS', 'intervals'],
  ['attentionHeartbeatMs', 'ATTENTION_HEARTBEAT_MS', 'intervals'],
  // —— 跟踪器同步的节拍（shared/tracker/sync.js，宿主与界面吃同一份）——
  ['syncEvalGapMs', 'SYNC_EVAL_GAP_MS', 'intervals'],
  ['syncDirtyProbeDebounceMs', 'SYNC_DIRTY_PROBE_DEBOUNCE_MS', 'intervals'],
  ['syncFailureBackoffMs', 'SYNC_FAILURE_BACKOFF_MS', 'intervals'],
  ['syncPollGridMs', 'SYNC_POLL_GRID_MS', 'intervals'],
  ['syncFallbackProbeMs', 'SYNC_FALLBACK_PROBE_MS', 'intervals'],
  ['syncFocusProbeMinMs', 'SYNC_FOCUS_PROBE_MIN_MS', 'intervals'],
  // —— 命名状态与日志的节拍 ——
  ['namingPersistDebounceMs', 'NAMING_PERSIST_DEBOUNCE_MS', 'intervals'],
  ['namingSweepSoonMs', 'NAMING_SWEEP_SOON_MS', 'intervals'],
  ['namingFallbackIntervalMs', 'NAMING_FALLBACK_INTERVAL_MS', 'intervals'],
  ['namingRetryCooldownMs', 'NAMING_RETRY_COOLDOWN_MS', 'intervals'],
  ['logWriteDebounceMs', 'LOG_WRITE_DEBOUNCE_MS', 'intervals'],
  ['logFlushMs', 'LOG_FLUSH_MS', 'intervals'],
  // —— 界面上的一次性延时 ——
  ['clientSessionTickMs', 'CLIENT_SESSION_TICK_MS', 'intervals'],
  ['clientHandoffDelayMs', 'CLIENT_HANDOFF_DELAY_MS', 'intervals'],
  ['slotQueueStepMs', 'SLOT_QUEUE_STEP_MS', 'intervals'],
  ['slotModalOpenDelayMs', 'SLOT_MODAL_OPEN_DELAY_MS', 'intervals'],
  ['storeSwitchConfirmMs', 'STORE_SWITCH_CONFIRM_MS', 'intervals'],
  ['statusMenuDismissDelayMs', 'STATUS_MENU_DISMISS_DELAY_MS', 'intervals'],
  ['statusMenuHoverOpenDelayMs', 'STATUS_MENU_HOVER_OPEN_DELAY_MS', 'intervals'],
  ['statusMenuFallbackDelayMs', 'STATUS_MENU_FALLBACK_DELAY_MS', 'intervals'],
  ['viewFlagWriteDebounceMs', 'VIEW_FLAG_WRITE_DEBOUNCE_MS', 'intervals'],
  // —— 悬停提示的两个延时（对抗式自查补登记：藏在 delay: { show, hide } 这样的对象里）——
  ['tipShowDelayMs', 'TIP_SHOW_DELAY_MS', 'intervals'],
  ['tipHideDelayMs', 'TIP_HIDE_DELAY_MS', 'intervals'],
  // —— ttl：有效期 ——
  ['preflightTtlMs', 'PREFLIGHT_TTL_MS', 'ttl'],
  ['chainAllGreenTtlMs', 'CHAIN_ALL_GREEN_TTL_MS', 'ttl'],
  ['deferExpiryMs', 'DEFER_EXPIRY_MS', 'ttl'],
  ['failureHalfOpenDelayMs', 'FAILURE_HALF_OPEN_DELAY_MS', 'ttl'],
  ['attentionExpiryMs', 'ATTENTION_EXPIRY_MS', 'ttl'],
  ['activeLingerMs', 'ACTIVE_LINGER_MS', 'ttl'],
  ['patchMergeWindowMs', 'PATCH_MERGE_WINDOW_MS', 'ttl'],
  ['freshnessYellowMs', 'FRESHNESS_YELLOW_MS', 'ttl'],
  ['freshnessRedMs', 'FRESHNESS_RED_MS', 'ttl'],
  ['ticketTtlMs', 'TICKET_TTL_MS', 'ttl'],
  ['workspaceStoreTtlMs', 'WORKSPACE_STORE_TTL_MS', 'ttl'],
  ['chainRideMaxAgeMs', 'CHAIN_RIDE_MAX_AGE_MS', 'ttl'],
  ['snapshotTtlMs', 'SNAPSHOT_TTL_MS', 'ttl'],
  ['statusCacheMs', 'STATUS_CACHE_MS', 'ttl'],
  ['snapshotCacheMs', 'SNAPSHOT_CACHE_MS', 'ttl'],
  ['planCursorTtlMs', 'PLAN_CURSOR_TTL_MS', 'ttl'],
  ['anchorWindowMs', 'ANCHOR_WINDOW_MS', 'ttl'],
  ['idempotencyLookbackMs', 'IDEMPOTENCY_LOOKBACK_MS', 'ttl'],
  ['mapTicketsTtlMs', 'MAP_TICKETS_TTL_MS', 'ttl'],
  // —— 跟踪器同步的寿命（shared/tracker/sync.js，宿主与界面吃同一份）——
  ['syncOverlapSkewMs', 'SYNC_OVERLAP_SKEW_MS', 'ttl'],
  ['syncDirtyEchoTtlMs', 'SYNC_DIRTY_ECHO_TTL_MS', 'ttl'],
  ['syncActionProbeWindowMs', 'SYNC_ACTION_PROBE_WINDOW_MS', 'ttl'],
  ['syncSnapFreshMs', 'SYNC_SNAP_FRESH_MS', 'ttl'],
  ['syncIssueCacheTtlMs', 'SYNC_ISSUE_CACHE_TTL_MS', 'ttl'],
  ['trackerIndexMaxWindowMs', 'TRACKER_INDEX_MAX_WINDOW_MS', 'ttl'],
  ['trackerIndexSkewMs', 'TRACKER_INDEX_SKEW_MS', 'ttl'],
  // —— 宿主侧的小缓存与界面提示的停留时间 ——
  ['skillListCacheTtlMs', 'SKILL_LIST_CACHE_TTL_MS', 'ttl'],
  ['skillProbeCacheMs', 'SKILL_PROBE_CACHE_MS', 'ttl'],
  ['workspaceRootTtlMs', 'WORKSPACE_ROOT_TTL_MS', 'ttl'],
  ['snapWaitMs', 'SNAP_WAIT_MS', 'ttl'],
  ['snapshotProbeMs', 'SNAPSHOT_PROBE_MS', 'ttl'],
  ['storeNoticeDismissMs', 'STORE_NOTICE_DISMISS_MS', 'ttl'],
  ['restFallbackStaleMs', 'REST_FALLBACK_STALE_MS', 'ttl'],
  ['vcRelativeWindowMs', 'VC_RELATIVE_WINDOW_MS', 'ttl'],
  ['issueDetailConfirmMs', 'ISSUE_DETAIL_CONFIRM_MS', 'ttl'],
  ['commentResultFlashMs', 'COMMENT_RESULT_FLASH_MS', 'ttl'],
  ['commentsMoreLoadingMinMs', 'COMMENTS_MORE_LOADING_MIN_MS', 'ttl'],
  ['copyFlashMs', 'COPY_FLASH_MS', 'ttl'],
  // —— backoff：退避序列 ——
  ['chainBackoffMs', 'CHAIN_BACKOFF_MS', 'backoff'],
]

// ---------------------------------------------------------------------------
// 回落底座：YAML 缺键时顶上的值。
// 约定：这里的值永远等于“收拢当天各调用文件里的数字”（见 config/ 下三份 YAML 头部注释里的
// 管辖说明）。改 YAML 是调参；改这里是改“YAML 缺键时系统按什么跑”，两者不要混在一起——
// 回落值变了，说明“今天各文件里的数字”这个前提变了，那是另一次收拢，先补 inventory 再动手。
// ---------------------------------------------------------------------------
const FALLBACKS = {
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
  tipShowDelayMs: 500,
  tipHideDelayMs: 160,
  viewFlagWriteDebounceMs: 500,
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
  chainBackoffMs: [8000, 30000, 120000, 300000],
}

/** 小编辑距离：拼错的键名能指到它想写的那个键，而不是一句“未知键”。 */
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function isPositiveInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/**
 * 读三份 YAML（每份声明固定的一组或两组）、做校验，返回 { values, warnings }。
 * values：键 → 生效值（YAML 有就用 YAML 的，缺键用回落底座并记一条告警）。
 * 报错即抛，调用方按退出码 1 收尾。
 */
function load(docs) {
  const known = new Map(KEYS.map(([k, c, g]) => [k, { constName: c, group: g }]))
  const seen = { timeouts: {}, intervals: {}, ttl: {}, backoff: {} }
  const declaredIn = new Map()   // 分组 → 声明它的那份文件；一组写两处是要报错的
  for (const { rel, doc } of docs) {
    if (!doc || typeof doc !== 'object') throw new Error(rel + ' 不是一个映射，生成器无从下手')
    if (doc.version !== 1) throw new Error(rel + ' 的 version 必须是 1，读到的是 ' + JSON.stringify(doc.version))
    for (const k of Object.keys(doc)) {
      if (k === 'version') continue
      // 组外顶层键一律是放错位置的——多半是新加的键不知道该进哪组。
      if (!Object.prototype.hasOwnProperty.call(seen, k)) {
        throw new Error(rel + ' 的顶层键“' + k + '”不在四组（timeouts/intervals/ttl/backoff）里，请把它放进对的那组')
      }
      if (FILE_OF_GROUP[k] !== rel) {
        throw new Error('分组 ' + k + ' 该写在 ' + FILE_OF_GROUP[k] + '，不该出现在 ' + rel)
      }
      if (declaredIn.has(k)) {
        throw new Error('分组 ' + k + ' 在 ' + declaredIn.get(k) + ' 与 ' + rel + ' 里各写了一份；一组只写一处')
      }
      const table = doc[k]
      if (typeof table !== 'object' || table === null) throw new Error(rel + ' 的 ' + k + ' 分组必须是一个映射')
      declaredIn.set(k, rel)
      Object.assign(seen[k], table)
    }
  }
  const warnings = []
  const values = {}
  const provided = new Set()
  for (const [key, { group }] of known) {
    const v = seen[group][key]
    if (v === undefined) {
      warnings.push('缺键：' + FILE_OF_GROUP[group] + ' 的 ' + group + '.' + key + ' 没写，用回落值 ' + JSON.stringify(FALLBACKS[key]) + ' 顶上（合法，但请补上）')
      values[key] = FALLBACKS[key]
      continue
    }
    if (group === ARRAY_GROUP) {
      if (!Array.isArray(v) || v.length === 0 || !v.every(isPositiveInt)) {
        throw new Error(FILE_OF_GROUP[group] + ' 的 ' + key + ' 必须是非空正整数数组，读到的是 ' + JSON.stringify(v))
      }
      values[key] = [...v]
      provided.add(key)
      continue
    }
    if (!isPositiveInt(v)) {
      throw new Error(FILE_OF_GROUP[group] + ' 的 ' + key + ' 必须是正整数毫秒，读到的是 ' + JSON.stringify(v))
    }
    values[key] = v
    provided.add(key)
    // 越过定时器上限只告警、不报错：TTL 与窗口一类只做大小比较，超出上限是合法的；
    // 但若这个键会直接当延时用，运行时会把大数折成 1 毫秒，行为会从「永不超时」翻成「立刻超时」。
    if (v > JS_TIMER_MAX_MS) {
      warnings.push(
        '越过定时器上限：' + FILE_OF_GROUP[group] + ' 的 ' + group + '.' + key + ' = ' + v + '，大于 JavaScript 定时器能表达的 ' + JS_TIMER_MAX_MS + ' 毫秒；只做大小比较（TTL、窗口）才安全，直接当延时会变成 1 毫秒',
      )
    }
  }
  // 未知键：先找像拼错的（编辑距离 ≤ 2），找不到就直说未知。都不静默。
  for (const [group, table] of Object.entries(seen)) {
    for (const k of Object.keys(table)) {
      if (known.has(k)) continue
      let best = null
      for (const [key] of known) {
        const d = editDistance(k, key)
        if (d <= 2 && (best === null || d < best.d)) best = { key, d }
      }
      throw new Error(
        FILE_OF_GROUP[group] + ' 里有未知键 ' + group + '.' + k
        + (best ? '（你想写的可能是 ' + best.key + '？）' : '（键表见 scripts/generate-time-config.mjs 的 KEYS）'),
      )
    }
  }
  return { values, warnings, provided }
}

function tsLiteral(v) {
  return Array.isArray(v) ? '[' + v.join(', ') + ']' : String(v)
}

/** 按 KEYS 生成 values.ts 全文。命名常量是给调用方 import 的；TIME_YAML 是给“值从哪来”留的证据。 */
function render(values, provided) {
  const lines = []
  lines.push('// values.ts —— 中央时间参数的生成源码（#1215 立）。')
  lines.push('//')
  lines.push('// 人手不改：本文件由 scripts/generate-time-config.mjs 按 config/ 下的三份时间参数文件写出')
  lines.push('// （config/timeouts.yaml 超时、config/intervals.yaml 间隔与退避、config/ttl.yaml 有效期）。')
  lines.push('// 想调时间请改 YAML 再跑生成器；YAML 缺键时这里用回落底座（FALLBACKS）顶上，')
  lines.push('// 落盘的值永远是“实际生效的值”，TIME_YAML 只记录“YAML 里写了哪些”。')
  lines.push('// 本文件签入版本库：diff 就是调参记录。')
  lines.push('')
  lines.push('export type TimeKey = ' + KEYS.map(([k]) => "'" + k + "'").join(' | ') + ';')
  lines.push('')
  lines.push('export const TIME_ARRAY_KEYS: ReadonlyArray<TimeKey> = ' + JSON.stringify(KEYS.filter(([, , g]) => g === ARRAY_GROUP).map(([k]) => k)) + ';')
  lines.push('')
  lines.push('/** YAML 里实际写了的键（缺键不在这里面）。想查“这个值是不是 YAML 里来的”，看这张表。 */')
  lines.push('export const TIME_YAML: Partial<Record<TimeKey, number | ReadonlyArray<number>>> = {')
  for (const [key] of KEYS) {
    if (!provided.has(key)) continue
    const v = values[key]
    lines.push('  ' + key + ': ' + (Array.isArray(v) ? 'Object.freeze([' + v.join(', ') + '])' : String(v)) + ',')
  }
  lines.push('};')
  lines.push('')
  lines.push('/** 回落底座：YAML 缺键时顶上的值 = 收拢当天各调用文件里的数字。改这里 = 改“缺键时按什么跑”，与调参是两件事。 */')
  lines.push('export const TIME_FALLBACKS: Record<TimeKey, number | ReadonlyArray<number>> = {')
  for (const [key] of KEYS) {
    const v = FALLBACKS[key]
    lines.push('  ' + key + ': ' + (Array.isArray(v) ? 'Object.freeze([' + v.join(', ') + '])' : String(v)) + ',')
  }
  lines.push('};')
  lines.push('')
  lines.push('/** 取一个时间参数。YAML 有就用 YAML 的，缺键用回落底座（生成时已落盘，这里只是按同样的规则读）。 */')
  lines.push('export function timeValue(key: TimeKey): number | ReadonlyArray<number> {')
  lines.push('  const v = TIME_YAML[key] !== undefined ? TIME_YAML[key] : TIME_FALLBACKS[key];')
  lines.push('  return v as number | ReadonlyArray<number>;')
  lines.push('}')
  lines.push('')
  lines.push('// —— 命名常量：调用方 import 这些名字，不直接碰 timeValue。名字与收拢前各文件的常量名同义，')
  lines.push('// 改调用处时只是把右边的数字换成这里的名字，读起来还是原来那句话。')
  const byGroup = {}
  for (const [key, constName, group] of KEYS) byGroup[group] = [...(byGroup[group] || []), [key, constName]]
  for (const group of ['timeouts', 'intervals', 'ttl', 'backoff']) {
    lines.push('// ---- ' + group + ' ----')
    for (const [key, constName] of byGroup[group]) {
      const v = values[key]
      lines.push('export const ' + constName + ': ' + (Array.isArray(v) ? 'ReadonlyArray<number>' : 'number') + ' = ' + tsLiteral(v) + ';')
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 读三份时间参数文件；缺哪一份都直接报错——少读一份会静默退回回落值，那是看不见的错。 */
function readDocs() {
  return YAML_FILES.map((rel) => {
    let text
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    } catch {
      throw new Error('读不到 ' + rel + '：三份中央时间参数文件缺一不可')
    }
    return { rel, doc: yaml.parse(text) }
  })
}

function main() {
  const checkOnly = process.argv.includes('--check')
  let values
  let provided
  try {
    const loaded = load(readDocs())
    values = loaded.values
    provided = loaded.provided
    for (const w of loaded.warnings) console.log('WARN ' + w)
  } catch (err) {
    console.log('FAIL ' + err.message)
    process.exit(1)
  }
  const text = render(values, provided) + '\n'
  if (checkOnly) {
    let current = null
    try {
      current = fs.readFileSync(OUT_PATH, 'utf8')
    } catch {
      current = null
    }
    if (current !== text) {
      console.log('FAIL 生成源码与 config/ 下的三份时间参数文件对不上：请跑 node scripts/generate-time-config.mjs 重算后再提交')
      process.exit(1)
    }
    console.log('PASS 生成源码与 config/ 下的三份时间参数文件一致')
    return
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, text)
  console.log('已按 config/ 下的三份时间参数文件写出 ' + path.relative(ROOT, OUT_PATH))
}

main()
