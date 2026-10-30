#!/usr/bin/env node
// 迁移说明（#1252）：本文件由 scripts/generate-time-config.mjs 转写而来，只加类型注解，行为零变化。
// scripts/generate-time-config.mts —— 中央时间参数的生成器：读 config/ 下按用途分开的三份
// 时间参数文件（timeouts.yaml 超时 / intervals.yaml 间隔与退避 / ttl.yaml 有效期），
// 写出 src/shared/time-config/src/values.ts（构建时现场生成、不入库）。
//
// 为什么是“生成”而不是“运行时读 YAML”：
//   · 客户端不经过 Node 运行时读文件——它吃的那几个值是构建时 splice 进去的（见 build.mts），
//     服务器侧运行时读 YAML、客户端侧吃构建期快照，两边会悄悄分叉。统一走“YAML → 生成 .ts →
//     编译 / 转译 / splice”这一条路，两边吃的是同一份数字。
//   · 生成产物不入库：数字只在 YAML 里有一份，构建（或 typecheck）时现场算出来；
//     想看“这次改了哪个时间、从几改到几”，看 YAML 的 diff。
//
// 用法（在仓库根目录跑）：
//   node scripts/generate-time-config.mts            按 YAML 重写 values.ts
//   node scripts/generate-time-config.mts --check   只比对，不写文件；
//       对不上时退出码 1（package.json 的 typecheck 脚本与 tests/verify-time-config.ts 都靠它看门）。
//       唯一例外：values.ts 根本不在（刚检出、还没跑过构建），这时现场生成一次再判过——
//       不然 typecheck 在全新检出上永远先红一次，那不是人的错。
//
// 缺键是故障，不是合法状态：YAML 里没写的键，生成器直接报错退出。调用方一律静态 import
// 生成的命名常量，不写任何“缺键回落数字”——数字只在 YAML 里有一份，回落表本身就是第二份拷贝。
// 未知键同样报错——多半是拼错了，静默忽略会让拼错的键看起来“生效了”。
//
// 数组项可以引用别的键（#1629）：退避序列里「一步等待」那一档不抄数字，写 stepWaitMs
// （或 stepWaitMs * 4），生成器在构建期把它算成一个普通数字；支持范围与规则见
// scripts/lib/time-config-expr.mts 的文件头。为什么允许这种写法：同一个数要在两处生效，
// 抄一份就会在调参时漏改（#1215 的单源头纪律）。

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import yaml from 'yaml'
import { resolveTimeArray } from './lib/time-config-expr.mts'

const ROOT: string = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const OUT_PATH: string = path.join(ROOT, 'src', 'shared', 'time-config', 'src', 'values.ts')
// 类型声明与转译产物并排放域表层（values.js 旁边）：.ts 调用方写的是
// `from '../../time-config/values.js'`，tsc 按“同名 .ts 兄弟”只能找到表层的 values.ts，
// 而真源在 src/ 下——没有这份 .d.ts，严格模式报 TS7016（没有声明文件）。
// 内容与 values.ts 同源（同一份 KEYS），数字只在 YAML 里有一份，这里只有类型，没有值。
const OUT_DTS_PATH: string = path.join(ROOT, 'src', 'shared', 'time-config', 'values.d.ts')
// 三份文件按用途分开，每份声明哪些分组是固定的：同一组写进两份文件、或写错文件，都在这里报错。
const YAML_FILES: string[] = ['config/timeouts.yaml', 'config/intervals.yaml', 'config/ttl.yaml']
const FILE_OF_GROUP: Record<string, string> = {
  timeouts: 'config/timeouts.yaml',
  intervals: 'config/intervals.yaml',
  backoff: 'config/intervals.yaml',
  ttl: 'config/ttl.yaml',
}

// ---------------------------------------------------------------------------
// 键表：YAML 键 → 生成的常量名 → 分组。分组只干一件事：决定校验规则
// （backoff 组是数组，其余三组是正整数毫秒）。
// ---------------------------------------------------------------------------
const ARRAY_GROUP: string = 'backoff'
/**
 * JavaScript 定时器能表达的延时上限（2^31-1 毫秒，约 24.8 天）。比它大的数交给 setTimeout / setInterval
 * 会被运行时折成 1 毫秒——「等于不超时」会悄悄变成「立刻超时」。所以越线本身不报错、只告警，
 * 但合法的越线值必须逐个写进下面的允许清单（只做大小比较的那几个窗口与保留期）。
 */
const JS_TIMER_MAX_MS: number = 2147483647
/**
 * 允许越过 JS_TIMER_MAX_MS 的键：它们只做大小比较（窗口、保留期），永远不会交给 setTimeout。
 * 目前三处：inFlightKeepAliveMs（正好等于上限，刻意的「永不」）、chainKeepMs 与
 * workRouteInProgressWindowMs（30 天保留期，只和「多久以前」比大小）。
 * 新增越线键时先想清楚它会不会当延用；会的话就别越线，而不是往这张清单里加。
 */
const COMPARE_ONLY_KEYS: Set<string> = new Set(['inFlightKeepAliveMs', 'chainKeepMs', 'workRouteInProgressWindowMs'])
/** [yaml键, 生成的常量名, 分组] */
const KEYS: Array<[string, string, string]> = [
  // —— timeouts：单次等待的上限 ——
  ['toolTimeoutMs', 'TOOL_TIMEOUT_MS', 'timeouts'],
  ['toolMarginMs', 'TOOL_MARGIN_MS', 'timeouts'],
  ['perOpTimeoutMs', 'PER_OP_TIMEOUT_MS', 'timeouts'],
  ['outboundReadMs', 'OUTBOUND_READ_TIMEOUT_MS', 'timeouts'],
  ['outboundWriteMs', 'OUTBOUND_WRITE_TIMEOUT_MS', 'timeouts'],
  ['outboundProbeMs', 'OUTBOUND_PROBE_TIMEOUT_MS', 'timeouts'],
  ['outboundDefaultMs', 'OUTBOUND_DEFAULT_TIMEOUT_MS', 'timeouts'],
  ['outboundTransportCooldownMs', 'OUTBOUND_TRANSPORT_COOLDOWN_MS', 'timeouts'],
  ['ghQueueWaitTimeoutMs', 'GH_QUEUE_WAIT_TIMEOUT_MS', 'timeouts'],
  ['githubClientTimeoutMs', 'GITHUB_CLIENT_TIMEOUT_MS', 'timeouts'],
  ['githubRestReadMs', 'GITHUB_REST_READ_TIMEOUT_MS', 'timeouts'],
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
  // —— 一步等待的统一值（#1629）：所有「发出一次请求后等它出结果」的上限都引用它 ——
  ['stepWaitMs', 'STEP_WAIT_MS', 'timeouts'],
  ['hostBootDeferMs', 'HOST_BOOT_DEFER_MS', 'timeouts'],
  ['keyLockMs', 'KEY_LOCK_TIMEOUT_MS', 'timeouts'],
  ['canonicalTimeoutMs', 'CANONICAL_TIMEOUT_MS', 'timeouts'],
  ['inFlightKeepAliveMs', 'IN_FLIGHT_KEEP_ALIVE_MS', 'timeouts'],
  ['settingsDebugPushWaitMs', 'SETTINGS_DEBUG_PUSH_WAIT_MS', 'timeouts'],
  ['quotaSyncCooldownMs', 'QUOTA_SYNC_COOLDOWN_MS', 'timeouts'],
  ['quotaSyncHardCooldownMs', 'QUOTA_SYNC_HARD_COOLDOWN_MS', 'timeouts'],
  ['quotaSyncMaxCooldownMs', 'QUOTA_SYNC_MAX_COOLDOWN_MS', 'timeouts'],
  ['registerRetryWaitMs', 'REGISTER_RETRY_WAIT_MS', 'timeouts'],
  ['shellResolveMs', 'SHELL_RESOLVE_TIMEOUT_MS', 'timeouts'],
  ['namingSummaryTimeoutMs', 'NAMING_SUMMARY_TIMEOUT_MS', 'timeouts'],
  ['logWatchdogMs', 'LOG_WATCHDOG_MS', 'timeouts'],
  ['probeAutoWaitMs', 'PROBE_AUTO_WAIT_MS', 'timeouts'],
  ['procProbeGraceMs', 'PROC_PROBE_GRACE_MS', 'timeouts'],
  ['procGraceMs', 'PROC_GRACE_MS', 'timeouts'],
  // —— PATH 里找不到 gh 时那次兜底探活（`gh --version` 的等待上限；#1160 收尾自审补登记，
  //    它当时写在 src/host/git-process.ts 里的 timer.timeout(2000)，单参写法漏过了门禁的正则）——
  ['ghVersionProbeMs', 'GH_VERSION_PROBE_MS', 'timeouts'],
  // —— 检测链里的谓词超时（对抗式自查补登记：原来写在 option 对象里，名字是裸 timeout，两边都看不见）——
  ['predicateTimeoutMs', 'PREDICATE_TIMEOUT_MS', 'timeouts'],
  // —— 检测链外层比内层串行最坏多留的余量（#1475：外层 = 内层最坏 + 余量，
  //    内层最坏由 src/tracker/rooms/github/read/preflight.ts 的 ghPreflightWorstCaseMs() 按出站档位现算）——
  ['predicateMarginMs', 'PREDICATE_MARGIN_MS', 'timeouts'],
  ['predicateFallbackTimeoutMs', 'PREDICATE_FALLBACK_TIMEOUT_MS', 'timeouts'],
  // —— 检测链里预取 gh 登录名的一次性竞速超时（detectChain.ts 的 timer.timeout(2500)，单源头改造时收拢）——
  ['ghLoginPrefetchMs', 'GH_LOGIN_PREFETCH_MS', 'timeouts'],
  // —— 同工作区构建互斥锁（#1365）：拿不到锁时的等待上限 ——
  ['buildLockWaitMs', 'BUILD_LOCK_WAIT_MS', 'timeouts'],
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
  // —— 降级取数的两个节流窗口（#1689）：降级常驻时探测放慢到 60 秒、自动校准至少 10 分钟 ——
  ['fallbackProbeIntervalMs', 'FALLBACK_PROBE_INTERVAL_MS', 'intervals'],
  ['fallbackCalibrationIntervalMs', 'FALLBACK_CALIBRATION_INTERVAL_MS', 'intervals'],
  // —— 命名状态与日志的节拍 ——
  ['namingPersistDebounceMs', 'NAMING_PERSIST_DEBOUNCE_MS', 'intervals'],
  ['namingSweepSoonMs', 'NAMING_SWEEP_SOON_MS', 'intervals'],
  ['namingFallbackIntervalMs', 'NAMING_FALLBACK_INTERVAL_MS', 'intervals'],
  ['namingRetryCooldownMs', 'NAMING_RETRY_COOLDOWN_MS', 'intervals'],
  // —— 谓词调试日志的采样节拍：15 秒内同类状态只记一次（detectChain.ts 的 nowP - lastPredAt > 15000，单源头改造时收拢）——
  ['predicateLogSampleMs', 'PREDICATE_LOG_SAMPLE_MS', 'intervals'],
  ['logWriteDebounceMs', 'LOG_WRITE_DEBOUNCE_MS', 'intervals'],
  ['logFlushMs', 'LOG_FLUSH_MS', 'intervals'],
  ['hostLogSlotRetryMs', 'HOST_LOG_SLOT_RETRY_MS', 'intervals'],
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
  // —— 回填草稿后补焦点的重试延时（api-io.ts 的 setTimeout(run, 120)，单源头改造中新门禁扫出来）——
  ['draftRefocusRetryMs', 'DRAFT_REFOCUS_RETRY_MS', 'intervals'],
  ['nativeTabRetryIntervalMs', 'NATIVE_TAB_RETRY_INTERVAL_MS', 'intervals'],
  ['skillSkeletonDelayMs', 'SKILL_SKELETON_DELAY_MS', 'intervals'],
  // —— 构建互斥锁的心跳间隔（#1365）：持锁期间证明还活着 ——
  ['buildLockHeartbeatMs', 'BUILD_LOCK_HEARTBEAT_MS', 'intervals'],
  // —— 宿主出站排队段的日志节流（#1101）：等多久才记一行、同一只桶最短多久记一次 ——
  ['laneLongWaitLogMs', 'LANE_LONG_WAIT_LOG_MS', 'intervals'],
  ['laneWaitLogIntervalMs', 'LANE_WAIT_LOG_INTERVAL_MS', 'intervals'],
  // #1627：deck 工具回执「慢」的日志判据（3 秒），只参与判断，不是等待上限。
  ['toolReceiptSlowMs', 'TOOL_RECEIPT_SLOW_MS', 'intervals'],
  // #1627：配额与限流诊断的两个判定窗（告警去重 60 秒 / 恢复安静 30 秒），只参与判断，不改任何出站行为。
  ['quotaIncidentDedupeMs', 'QUOTA_INCIDENT_DEDUPE_MS', 'intervals'],
  ['quotaRecoverQuietMs', 'QUOTA_RECOVER_QUIET_MS', 'intervals'],
  // —— ttl：有效期 ——
  ['preflightTtlMs', 'PREFLIGHT_TTL_MS', 'ttl'],
  ['chainAllGreenTtlMs', 'CHAIN_ALL_GREEN_TTL_MS', 'ttl'],
  // #1528：一趟环境检查里两项判据共用 `.scratch` 根目录列举结果的重合窗口。
  ['scratchRootListingTtlMs', 'SCRATCH_ROOT_LISTING_TTL_MS', 'ttl'],
  ['deferExpiryMs', 'DEFER_EXPIRY_MS', 'ttl'],
  ['failureHalfOpenDelayMs', 'FAILURE_HALF_OPEN_DELAY_MS', 'ttl'],
  ['attentionExpiryMs', 'ATTENTION_EXPIRY_MS', 'ttl'],
  // #1240：心跳的人在场判据（最近这段时间没有人类输入就不发心跳）。
  ['attentionHumanInputWindowMs', 'ATTENTION_HUMAN_INPUT_WINDOW_MS', 'ttl'],
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
  // #1240：刚选中快照的保护窗（别用旧缓存盖掉用户刚点的选择）。
  ['snapshotPickedGuardMs', 'SNAPSHOT_PICKED_GUARD_MS', 'ttl'],
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
  ['skillFloatCloseDelayMs', 'SKILL_FLOAT_CLOSE_DELAY_MS', 'ttl'],
  ['labelCopyFlashMs', 'LABEL_COPY_FLASH_MS', 'ttl'],
  ['skillDetailCopiedFlashMs', 'SKILL_DETAIL_COPIED_FLASH_MS', 'ttl'],
  // —— 构建互斥锁的陈旧判定有效期（#1365）：超期无心跳就接管 ——
  ['buildLockStaleMs', 'BUILD_LOCK_STALE_MS', 'ttl'],
  // —— 工作路线回执的三个时间窗（#1259）：在办 / 现办 / 撞单 ——
  ['workRouteInProgressWindowMs', 'WORK_ROUTE_IN_PROGRESS_WINDOW_MS', 'ttl'],
  ['workRouteActiveWindowMs', 'WORK_ROUTE_ACTIVE_WINDOW_MS', 'ttl'],
  ['workRouteCollisionWindowMs', 'WORK_ROUTE_COLLISION_WINDOW_MS', 'ttl'],
  // —— 会话链缓存与工作路线存档共用的保留期：30 天（两条存档形状同一套口径）——
  ['chainKeepMs', 'CHAIN_KEEP_MS', 'ttl'],
  // —— 写事件补丁的短存（超过就先丢掉，那一趟已经无关了）——
  ['writePatchTtlMs', 'WRITE_PATCH_TTL_MS', 'ttl'],
  // —— 视野模型上报的去重窗（同一签名在这段时间内只处理一次）——
  ['attentionReportDedupeMs', 'ATTENTION_REPORT_DEDUPE_MS', 'ttl'],
  // —— backoff：退避序列。项可以写引用（#1629），第二档就是一步等待本身 ——
  ['chainBackoffMs', 'CHAIN_BACKOFF_MS', 'backoff'],
  // —— 「下一步建议」选项行的客户端重试退避：两档 ——
  ['ownRouteRetryMs', 'OWN_ROUTE_RETRY_MS', 'backoff'],
  // —— 初始化等待那一路的等待封顶（#1363）：超过多久必真算一次 ——
  ['chainSetupPendingCapMs', 'CHAIN_SETUP_PENDING_CAP_MS', 'timeouts'],
]

/** 小编辑距离：拼错的键名能指到它想写的那个键，而不是一句“未知键”。 */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
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

function isPositiveInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/**
 * 读三份 YAML（每份声明固定的一组或两组）、做校验，返回 { values, warnings }。
 * values：键 → 生效值，全部来自 YAML。缺键直接报错——调用方不写回落，缺了就是故障。
 * 报错即抛，调用方按退出码 1 收尾。
 */
function load(docs: Array<{ rel: string; doc: any }>): { values: Record<string, any>; warnings: string[]; provided: Set<string> } {
  const known: Map<string, { constName: string; group: string }> = new Map(KEYS.map(([k, c, g]) => [k, { constName: c, group: g }]))
  const seen: Record<string, Record<string, any>> = { timeouts: {}, intervals: {}, ttl: {}, backoff: {} }
  const declaredIn: Map<string, string> = new Map()   // 分组 → 声明它的那份文件；一组写两处是要报错的
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
      const table: any = doc[k]
      if (typeof table !== 'object' || table === null) throw new Error(rel + ' 的 ' + k + ' 分组必须是一个映射')
      declaredIn.set(k, rel)
      Object.assign(seen[k], table)
    }
  }
  const warnings: string[] = []
  const values: Record<string, any> = {}
  const provided: Set<string> = new Set()
  // 第一遍先落标量键：数组项可能引用标量键（#1629 的一步等待），所以标量必须先算出来；
  // 数组键先把原始值收进清单，等标量都齐了再统一解析（解析规则见 lib/time-config-expr.mts）。
  const scalarValue: Record<string, number> = {}
  const pendingArrays: Array<{ key: string; group: string; raw: unknown }> = []
  for (const [key, { group }] of known) {
    const v: any = seen[group][key]
    if (v === undefined) {
      throw new Error('缺键：' + FILE_OF_GROUP[group] + ' 的 ' + group + '.' + key + ' 没写；数字只在 YAML 里有一份，没有回落可顶，先把键补上')
    }
    if (group === ARRAY_GROUP) {
      pendingArrays.push({ key, group, raw: v })
      continue
    }
    if (!isPositiveInt(v)) {
      throw new Error(FILE_OF_GROUP[group] + ' 的 ' + key + ' 必须是正整数毫秒，读到的是 ' + JSON.stringify(v))
    }
    values[key] = v
    scalarValue[key] = v
    provided.add(key)
    // 越过定时器上限只告警、不报错：TTL 与窗口一类只做大小比较，超出上限是合法的；
    // 但若这个键会直接当延时用，运行时会把大数折成 1 毫秒，行为会从「永不超时」翻成「立刻超时」。
    // 合法的越线值写在 COMPARE_ONLY_KEYS 里（每一处都要在注释里说清为什么只做比较），
    // 清单外的新键越线才告警——免得调参的人把 30 天保留期顺手当延时用。
    if (v > JS_TIMER_MAX_MS && !COMPARE_ONLY_KEYS.has(key)) {
      warnings.push(
        '越过定时器上限：' + FILE_OF_GROUP[group] + ' 的 ' + group + '.' + key + ' = ' + v + '，大于 JavaScript 定时器能表达的 ' + JS_TIMER_MAX_MS + ' 毫秒；只做大小比较（TTL、窗口）才安全，直接当延时会变成 1 毫秒',
      )
    }
  }
  // 第二遍收数组键：项可以是正整数，也可以写「键名」或「键名 * 倍数」引用上面那些标量键。
  // 解析与报错住在 lib/time-config-expr.mts（为什么允许引用见那个文件头）；产物里仍是普通数字数组。
  for (const { key, group, raw } of pendingArrays) {
    values[key] = resolveTimeArray(raw, {
      file: FILE_OF_GROUP[group],
      key,
      scalarOf: (target: string) => scalarValue[target],
      isArrayKey: (target: string) => known.get(target)?.group === ARRAY_GROUP,
    })
    provided.add(key)
  }
  // 未知键：先找像拼错的（编辑距离 ≤ 2），找不到就直说未知。都不静默。
  for (const [group, table] of Object.entries(seen)) {
    for (const k of Object.keys(table)) {
      if (known.has(k)) continue
      let best: { key: string; d: number } | null = null
      for (const [key] of known) {
        const d: number = editDistance(k, key)
        if (d <= 2 && (best === null || d < best.d)) best = { key, d }
      }
      throw new Error(
        FILE_OF_GROUP[group] + ' 里有未知键 ' + group + '.' + k
        + (best ? '（你想写的可能是 ' + best.key + '？）' : '（键表见 scripts/generate-time-config.mts 的 KEYS）'),
      )
    }
  }
  return { values, warnings, provided }
}

function tsLiteral(v: number | Array<number>): string {
  return Array.isArray(v) ? '[' + v.join(', ') + ']' : String(v)
}

/** 按 KEYS 生成 values.ts 全文。命名常量是给调用方 import 的；TIME_YAML 是给“值从哪来”留的证据。 */
function render(values: Record<string, any>, provided: unknown): string {
  void provided
  const lines: string[] = []
  lines.push('// values.ts —— 中央时间参数的生成源码（#1215 立，构建时现场生成、不入库）。')
  lines.push('//')
  lines.push('// 人手不改：本文件由 scripts/generate-time-config.mts 按 config/ 下的三份时间参数文件写出')
  lines.push('// （config/timeouts.yaml 超时、config/intervals.yaml 间隔与退避、config/ttl.yaml 有效期）。')
  lines.push('// 想调时间请改 YAML 再跑生成器；缺键直接报错，没有回落——数字只在 YAML 里有一份。')
  lines.push('')
  lines.push('export type TimeKey = ' + KEYS.map(([k]) => "'" + k + "'").join(' | ') + ';')
  lines.push('')
  lines.push('export const TIME_ARRAY_KEYS: ReadonlyArray<TimeKey> = ' + JSON.stringify(KEYS.filter(([, , g]) => g === ARRAY_GROUP).map(([k]) => k)) + ';')
  lines.push('')
  lines.push('/** YAML 里写了的值（缺键在生成器那一步就报错了，所以这里与命名常量永远一致）。 */')
  lines.push('export const TIME_YAML: Record<TimeKey, number | ReadonlyArray<number>> = {')
  for (const [key] of KEYS) {
    const v: any = values[key]
    lines.push('  ' + key + ': ' + (Array.isArray(v) ? 'Object.freeze([' + v.join(', ') + '])' : String(v)) + ',')
  }
  lines.push('};')
  lines.push('')
  lines.push('// —— 命名常量：调用方 import 这些名字。名字与收拢前各文件的常量名同义，')
  lines.push('// 改调用处时只是把右边的数字换成这里的名字，读起来还是原来那句话。')
  const byGroup: Record<string, Array<[string, string]>> = {}
  for (const [key, constName, group] of KEYS) byGroup[group] = [...(byGroup[group] || []), [key, constName]]
  for (const group of ['timeouts', 'intervals', 'ttl', 'backoff']) {
    lines.push('// ---- ' + group + ' ----')
    for (const [key, constName] of byGroup[group]) {
      const v: any = values[key]
      lines.push('export const ' + constName + ': ' + (Array.isArray(v) ? 'ReadonlyArray<number>' : 'number') + ' = ' + tsLiteral(v) + ';')
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 按同一份 KEYS 生成 values.d.ts 全文：只有声明、没有值（值只在 YAML 里有一份）。 */
function renderDts(values: Record<string, any>): string {
  void values
  const lines: string[] = []
  lines.push('// values.d.ts —— 中央时间参数的类型声明（#1215 单源头改造补，构建时现场生成、不入库）。')
  lines.push('//')
  lines.push('// 人手不改：本文件由 scripts/generate-time-config.mts 按 config/ 下的三份时间参数文件写出；')
  lines.push('// 想调时间请改 YAML 再跑生成器，不要手改这里（手改会被下一次构建覆盖，--check 也会判红）。')
  lines.push('//')
  lines.push('// 上面「人手不改」这一行不只是提醒人：scripts/lib/build-cache.mts 的 looksDerived() 见到它，')
  lines.push('// 就把本文件排除在构建输入之外（#1530：生成器在构建中段重写它时，输入摘要才不会被搅动）。')
  lines.push('// 判据的细节以那个函数为准，别在这份生成物里另抄一份，免得两处说法对不上。')
  lines.push('//')
  lines.push('// 为什么多这一份：调用方 import 的是域表层的 values.js（转译产物，没有类型），')
  lines.push('// tsc 按同名兄弟只能找到表层的 values.ts——而真源住在 src/ 下。没有这份声明，')
  lines.push('// 严格模式下所有 import values.js 的 .ts 都报 TS7016。内容与 values.ts 同源。')
  lines.push('')
  lines.push('export type TimeKey = ' + KEYS.map(([k]) => "'" + k + "'").join(' | ') + ';')
  lines.push('')
  lines.push('export declare const TIME_ARRAY_KEYS: ReadonlyArray<TimeKey>;')
  lines.push('export declare const TIME_YAML: Record<TimeKey, number | ReadonlyArray<number>>;')
  lines.push('')
  lines.push('// —— 命名常量：类型与 values.ts 里的一致，值以 YAML 为准 ——')
  for (const [key, constName, group] of KEYS) {
    const v: any = values[key]
    lines.push('export declare const ' + constName + ': ' + (Array.isArray(v) || group === ARRAY_GROUP ? 'ReadonlyArray<number>' : 'number') + ';')
  }
  return lines.join('\n')
}
/** 读三份时间参数文件；缺哪一份都直接报错——少读一份会静默退回旧值，那是看不见的错。 */
function readDocs(): Array<{ rel: string; doc: any }> {
  return YAML_FILES.map((rel: string) => {
    let text: string
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    } catch {
      throw new Error('读不到 ' + rel + '：三份中央时间参数文件缺一不可')
    }
    return { rel, doc: yaml.parse(text) }
  })
}

function main(): void {
  const checkOnly: boolean = process.argv.includes('--check')
  let values: Record<string, any>
  let provided: Set<string>
  try {
    const loaded: { values: Record<string, any>; warnings: string[]; provided: Set<string> } = load(readDocs())
    values = loaded.values
    provided = loaded.provided
    for (const w of loaded.warnings) console.log('WARN ' + w)
  } catch (err) {
    console.log('FAIL ' + err.message)
    process.exit(1)
  }
  const text: string = render(values, provided) + '\n'
  const dts: string = renderDts(values) + '\n'
  if (checkOnly) {
    let current: string | null = null
    try {
      current = fs.readFileSync(OUT_PATH, 'utf8')
    } catch {
      current = null
    }
    let currentDts: string | null = null
    try {
      currentDts = fs.readFileSync(OUT_DTS_PATH, 'utf8')
    } catch {
      currentDts = null
    }
    if (current === null || currentDts === null) {
      // 全新检出、还没跑过构建：现场生成一次再判过，不然 typecheck 在新机器上永远先红一次。
      fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
      fs.writeFileSync(OUT_PATH, text)
      fs.writeFileSync(OUT_DTS_PATH, dts)
      console.log('PASS 生成源码不在，已按 config/ 下的三份时间参数文件现场生成')
      return
    }
    if (current !== text || currentDts !== dts) {
      console.log('FAIL 生成源码与 config/ 下的三份时间参数文件对不上：请跑 node scripts/generate-time-config.mts 重算后再提交')
      process.exit(1)
    }
    console.log('PASS 生成源码与 config/ 下的三份时间参数文件一致')
    return
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, text)
  fs.writeFileSync(OUT_DTS_PATH, dts)
  console.log('已按 config/ 下的三份时间参数文件写出 ' + path.relative(ROOT, OUT_PATH))
}

main()
