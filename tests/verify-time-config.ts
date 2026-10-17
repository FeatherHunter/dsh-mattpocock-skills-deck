// verify-time-config.ts —— 中央时间参数门禁（票 #1215 立，单源头改造后重写）。
//
// 为什么要有这扇门禁：
//   全仓时间参数的唯一书写处是 config/ 下的三份文件（人改的唯一地方）：
//   config/timeouts.yaml（超时上限）、config/intervals.yaml（间隔与一次性延时、退避表）、
//   config/ttl.yaml（有效期）。生效处是构建时生成的 src/shared/time-config/src/values.ts
//   （脚本见 scripts/generate-time-config.mjs，产物不入库，构建与测试时现场生成）。
//   这扇门禁看守四件事，缺一件都会让“中央”二字落空：
//   ① 生成新鲜度：现场生成的值必须与今天的三份 YAML 对得上；
//   ② 真引用：每个调用方拿到的必须就是生成出来的那一份（引用相等），源码里不许再写时间数字；
//   ③ 界面半边能拿到值：拼进闭包的常量，values、构建名单、界面用处三方一次对上；
//   ④ 无字面量：src/ 下时间味的名字挂着的不许是数字（绕过 YAML 直接写数字，在这里判红）。
//
// 和旧版的区别（2026-10-16 单源头改造）：
//   旧版锁的是“两份数字相等”（IMPORT 表的 literal 行 + TEXT 表的片段行）：源码里写一份数字，
//   门禁核对它等于 YAML。改造后源码里不再有第二份数字，所以这两张表整个删掉，换成：
//   ② 的引用相等断言（REFERENCES 表：模块拿到的就是生成的那一份，不是抄的），
//   ④ 的无字面量扫描（数字出现在时间味的位置就判红，唯一的出口是 PERMANENT 表）。
//   以后加一个时间参数的动作是：YAML 里加键 → 文件里 import 生成常量 → REFERENCES 里加一行。
//   删一行同理。三张表（REFERENCES / CLIENTS / PERMANENT）与 EXEMPTS 的行数只许增不许减式的维护：
//   加参数加行，删参数删行，不许为了让门禁变绿而删行（那等于把参数放回源码里写数字）。
//
// 为什么有些文件是动态 import 或闭包拼接，而不是一律静态 import：
//   src/host/index.ts 是插件入口，禁静态 import（D7），走动态 import；
//   src/client/** 整份拼进界面闭包，文件里的 import 行由构建剥掉（见 stripTimeConfigRefs，
//   单行是硬要求），名字由闭包里另一片提供，门禁把它当模块直接 import 跑时引用是真的；
//   src/deck/registration/register-options.ts 的零导入约束已解除（只引用纯数据目录，不算跨层）。
//   跨共享域引用中央时间参数目录是 architecture 允许的唯一例外（.dependency-cruiser.cjs 的
//   same-layer-import-shared 规则里写明，只认 src/shared/time-config/ 这一个目录）。
//
// 永久字面量（PERMANENT 表）：只有四种能留数字——
//   ① 单位换算（1 小时、1 分钟：这是数学定义，不是旋钮，调它没有意义）；
//   ② 0 表示“还没有/关掉”（状态初值与开关，不是时长）；
//   ③ 非时间的数字（点数、条数、比例、字节、个数：覆盖率判据看名字，它们由 EXEMPTS 表认领）；
//   ④ 除法里的 1000（毫秒换算成秒给只认秒的 git 选项：除数不是时长）。
//   除此四种，时间味的名字后面不许出现数字。理由写不清的就不该出现在表里。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TIME_CONFIG_JS = '../src/shared/time-config/src/values.js'

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

const eqValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// 表一 REFERENCES：调用方拿到的必须就是生成的那一份。
// access 是模块里读值的路（导出名，或 对象.属性 / TUNING.属性）；gen 是生成侧的常量名；
// key 是它对应的 YAML 键（这一列防“键写错”：键在 YAML 里不存在就判红）。
// 断言的是引用相等（数字比值，数组比引用）：同一个对象才算真导入，不是抄的数字。
// ---------------------------------------------------------------------------
interface RefRow {
  file: string
  access: string
  gen: string
  key: string
}
const REFERENCES: RefRow[] = [
  // —— 宿主：静态 import 生成常量（别名只改名，不改值） ——
  { file: 'src/host/versionControl.js', access: 'RUN_TIMEOUT_MS', gen: 'VC_RUN_TIMEOUT_MS', key: 'vcRunTimeoutMs' },
  { file: 'src/host/versionControlCheck.js', access: 'CHECK_CALL_BUDGET_MS', gen: 'VC_CHECK_CALL_BUDGET_MS', key: 'vcCheckCallBudgetMs' },
  { file: 'src/host/versionControlCheck.js', access: 'LSFILES_TIMEOUT_MS', gen: 'VC_LSFILES_TIMEOUT_MS', key: 'vcLsFilesTimeoutMs' },
  { file: 'src/host/versionControlCheck.js', access: 'REMOTE_TIMEOUT_MS', gen: 'VC_REMOTE_TIMEOUT_MS', key: 'vcRemoteTimeoutMs' },
  { file: 'src/host/versionControlWrite.js', access: 'ADD_TIMEOUT_MS', gen: 'VC_ADD_TIMEOUT_MS', key: 'vcAddTimeoutMs' },
  { file: 'src/host/versionControlWrite.js', access: 'COMMIT_TIMEOUT_MS', gen: 'VC_COMMIT_TIMEOUT_MS', key: 'vcCommitTimeoutMs' },
  { file: 'src/host/versionControlWrite.js', access: 'PULL_TIMEOUT_MS', gen: 'VC_PULL_TIMEOUT_MS', key: 'vcPullTimeoutMs' },
  { file: 'src/host/versionControlWrite.js', access: 'PUSH_TIMEOUT_MS', gen: 'VC_PUSH_TIMEOUT_MS', key: 'vcPushTimeoutMs' },
  { file: 'src/host/versionControlWrite.js', access: 'FETCH_TIMEOUT_MS', gen: 'VC_FETCH_TIMEOUT_MS', key: 'vcFetchTimeoutMs' },
  { file: 'src/host/gitCredentialExec.js', access: 'CALL_BUDGET_MS', gen: 'GIT_CREDENTIAL_CALL_BUDGET_MS', key: 'gitCredentialCallBudgetMs' },
  { file: 'src/host/gitCredentialExec.js', access: 'MIN_BUDGET_MS', gen: 'GIT_CREDENTIAL_MIN_BUDGET_MS', key: 'gitCredentialMinBudgetMs' },
  { file: 'src/host/gitCredentialExec.js', access: 'MAX_BUDGET_MS', gen: 'GIT_CREDENTIAL_MAX_BUDGET_MS', key: 'gitCredentialMaxBudgetMs' },
  { file: 'src/host/gitCredentialExec.js', access: 'GIT_LOW_SPEED_TIMEOUT_MS', gen: 'GIT_LOW_SPEED_TIMEOUT_MS', key: 'gitLowSpeedTimeoutMs' },
  { file: 'src/host/workspaceKey.js', access: 'WORKSPACE_ROOT_TTL_MS', gen: 'WORKSPACE_ROOT_TTL_MS', key: 'workspaceRootTtlMs' },
  { file: 'src/host/logStore.js', access: 'LOG_DEBOUNCE_MS', gen: 'LOG_WRITE_DEBOUNCE_MS', key: 'logWriteDebounceMs' },
  { file: 'src/host/platform/namingSummary.js', access: 'SUMMARY_TIMEOUT_MS', gen: 'NAMING_SUMMARY_TIMEOUT_MS', key: 'namingSummaryTimeoutMs' },
  { file: 'src/host/namingGuardian.js', access: 'NAMING_FALLBACK_MS', gen: 'NAMING_FALLBACK_INTERVAL_MS', key: 'namingFallbackIntervalMs' },
  { file: 'src/host/skillProbeCache.js', access: 'SKILL_PROBE_CACHE_MS', gen: 'SKILL_PROBE_CACHE_MS', key: 'skillProbeCacheMs' },
  { file: 'src/host/refresh/chain-ride.ts', access: 'CHAIN_RIDE_MAX_AGE_MS', gen: 'CHAIN_RIDE_MAX_AGE_MS', key: 'chainRideMaxAgeMs' },
  { file: 'src/host/refresh/wiring.ts', access: 'DECK_ENSURE_TIMEOUT_MS', gen: 'DECK_ENSURE_TIMEOUT_MS', key: 'deckEnsureMs' },
  { file: 'src/host/refresh/wiring.ts', access: 'DECK_LOCAL_READ_TIMEOUT_MS', gen: 'DECK_LOCAL_READ_TIMEOUT_MS', key: 'deckLocalReadMs' },
  { file: 'src/host/refresh/wiring.ts', access: 'SHELL_RESOLVE_TIMEOUT_MS', gen: 'SHELL_RESOLVE_TIMEOUT_MS', key: 'shellResolveMs' },
  { file: 'src/host/refresh/gate.ts', access: 'FAILURE_HALF_OPEN_DELAY_MS', gen: 'FAILURE_HALF_OPEN_DELAY_MS', key: 'failureHalfOpenDelayMs' },
  { file: 'src/host/refresh/gate.ts', access: 'DEFER_EXPIRY_MS', gen: 'DEFER_EXPIRY_MS', key: 'deferExpiryMs' },
  { file: 'src/host/refresh/gate.ts', access: 'PROBE_INTERVAL_MS', gen: 'PROBE_INTERVAL_MS', key: 'probeIntervalMs' },
  { file: 'src/host/refresh/gate.ts', access: 'PROBE_INTERVAL_YELLOW_MS', gen: 'PROBE_INTERVAL_YELLOW_MS', key: 'probeIntervalYellowMs' },
  { file: 'src/host/refresh/gate.ts', access: 'RECONCILE_INTERVAL_MS', gen: 'RECONCILE_INTERVAL_MS', key: 'reconcileIntervalMs' },
  { file: 'src/host/refresh/gate.ts', access: 'REBUILD_MIN_INTERVAL_YELLOW_MS', gen: 'REBUILD_MIN_INTERVAL_YELLOW_MS', key: 'rebuildMinIntervalYellowMs' },
  { file: 'src/host/refresh/gate.ts', access: 'CHAIN_BACKOFF_MS', gen: 'CHAIN_BACKOFF_MS', key: 'chainBackoffMs' },
  { file: 'src/host/refresh/attention.js', access: 'ACTIVE_LINGER_MS', gen: 'ACTIVE_LINGER_MS', key: 'activeLingerMs' },
  { file: 'src/host/refresh/attention.js', access: 'ATTENTION_EXPIRY_MS', gen: 'ATTENTION_EXPIRY_MS', key: 'attentionExpiryMs' },
  { file: 'src/host/refresh/attention.js', access: 'PROBE_INTERVAL_MS', gen: 'PROBE_INTERVAL_MS', key: 'probeIntervalMs' },
  { file: 'src/host/refresh/attention.js', access: 'PROBE_INTERVAL_LINGER_MS', gen: 'PROBE_INTERVAL_LINGER_MS', key: 'probeIntervalLingerMs' },
  { file: 'src/host/refresh/attention.js', access: 'ATTENTION_HEARTBEAT_MS', gen: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs' },
  { file: 'src/host/refresh/ledger.ts', access: 'QUOTA_SYNC_INTERVAL_MS', gen: 'QUOTA_SYNC_INTERVAL_MS', key: 'quotaSyncIntervalMs' },
  { file: 'src/host/refresh/writeEvents.js', access: 'PATCH_MERGE_WINDOW_MS', gen: 'PATCH_MERGE_WINDOW_MS', key: 'patchMergeWindowMs' },
  { file: 'src/host/refresh/writeEvents.js', access: 'PROBE_INTERVAL_MS', gen: 'PROBE_INTERVAL_MS', key: 'probeIntervalMs' },
  // —— 动态 import（发布包里源码树不在时允许取不到，由调用方照旧求值）：名字走 central 命名空间，门禁认动态 import 行 ——
  { file: 'src/host/refresh/chainBackoff.js', access: 'CHAIN_BACKOFF_MS', gen: 'CHAIN_BACKOFF_MS', key: 'chainBackoffMs' },
  { file: 'src/host/refresh/chainBackoff.js', access: 'CHAIN_ALL_GREEN_TTL_MS', gen: 'CHAIN_ALL_GREEN_TTL_MS', key: 'chainAllGreenTtlMs' },
  { file: 'src/host/refresh/chainBackoff.js', access: 'PREFLIGHT_TTL_MS', gen: 'PREFLIGHT_TTL_MS', key: 'preflightTtlMs' },
  { file: 'src/host/versionControlCheck.js', access: 'TICKET_TTL_MS', gen: 'TICKET_TTL_MS', key: 'ticketTtlMs' },
  // —— 宿主早先已是真引用的（第一轮接入，沿用） ——
  { file: 'src/tracker/kernel/outbound-tiers.ts', access: 'READ_TIMEOUT_MS', gen: 'OUTBOUND_READ_TIMEOUT_MS', key: 'outboundReadMs' },
  { file: 'src/tracker/kernel/outbound-tiers.ts', access: 'WRITE_TIMEOUT_MS', gen: 'OUTBOUND_WRITE_TIMEOUT_MS', key: 'outboundWriteMs' },
  { file: 'src/tracker/kernel/outbound-tiers.ts', access: 'PROBE_TIMEOUT_MS', gen: 'OUTBOUND_PROBE_TIMEOUT_MS', key: 'outboundProbeMs' },
  { file: 'src/tracker/kernel/outbound-tiers.ts', access: 'DEFAULT_TIMEOUT_MS', gen: 'OUTBOUND_DEFAULT_TIMEOUT_MS', key: 'outboundDefaultMs' },
  { file: 'src/tracker/registry/core.ts', access: 'MATCHES_TIMEOUT_MS', gen: 'MATCHES_TIMEOUT_MS', key: 'matchesTimeoutMs' },
  { file: 'src/tracker/rooms/github/client.ts', access: 'TIMEOUT_MS', gen: 'GITHUB_CLIENT_TIMEOUT_MS', key: 'githubClientTimeoutMs' },
  // —— 共享层：整份转出（budget）与直接引用 ——
  { file: 'src/shared/refresh/src/budget.ts', access: 'PROBE_INTERVAL_MS', gen: 'PROBE_INTERVAL_MS', key: 'probeIntervalMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'PROBE_INTERVAL_YELLOW_MS', gen: 'PROBE_INTERVAL_YELLOW_MS', key: 'probeIntervalYellowMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'PROBE_INTERVAL_LINGER_MS', gen: 'PROBE_INTERVAL_LINGER_MS', key: 'probeIntervalLingerMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'REBUILD_MIN_INTERVAL_YELLOW_MS', gen: 'REBUILD_MIN_INTERVAL_YELLOW_MS', key: 'rebuildMinIntervalYellowMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'RECONCILE_INTERVAL_MS', gen: 'RECONCILE_INTERVAL_MS', key: 'reconcileIntervalMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'QUOTA_SYNC_INTERVAL_MS', gen: 'QUOTA_SYNC_INTERVAL_MS', key: 'quotaSyncIntervalMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'ATTENTION_HEARTBEAT_MS', gen: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'PREFLIGHT_TTL_MS', gen: 'PREFLIGHT_TTL_MS', key: 'preflightTtlMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'CHAIN_ALL_GREEN_TTL_MS', gen: 'CHAIN_ALL_GREEN_TTL_MS', key: 'chainAllGreenTtlMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'DEFER_EXPIRY_MS', gen: 'DEFER_EXPIRY_MS', key: 'deferExpiryMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'FAILURE_HALF_OPEN_DELAY_MS', gen: 'FAILURE_HALF_OPEN_DELAY_MS', key: 'failureHalfOpenDelayMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'ATTENTION_EXPIRY_MS', gen: 'ATTENTION_EXPIRY_MS', key: 'attentionExpiryMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'ACTIVE_LINGER_MS', gen: 'ACTIVE_LINGER_MS', key: 'activeLingerMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'PATCH_MERGE_WINDOW_MS', gen: 'PATCH_MERGE_WINDOW_MS', key: 'patchMergeWindowMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'FRESHNESS_YELLOW_MS', gen: 'FRESHNESS_YELLOW_MS', key: 'freshnessYellowMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'FRESHNESS_RED_MS', gen: 'FRESHNESS_RED_MS', key: 'freshnessRedMs' },
  { file: 'src/shared/refresh/src/budget.ts', access: 'CHAIN_BACKOFF_MS', gen: 'CHAIN_BACKOFF_MS', key: 'chainBackoffMs' },
  { file: 'src/shared/refresh/src/tuning.ts', access: 'TUNING.deckEnsureTimeoutMs', gen: 'DECK_ENSURE_TIMEOUT_MS', key: 'deckEnsureMs' },
  { file: 'src/shared/version-control/src/write-ticket.ts', access: 'TICKET_TTL_MS', gen: 'TICKET_TTL_MS', key: 'ticketTtlMs' },
  { file: 'src/shared/tracker/indexWindow.js', access: 'MAX_WINDOW_MS', gen: 'TRACKER_INDEX_MAX_WINDOW_MS', key: 'trackerIndexMaxWindowMs' },
  { file: 'src/shared/tracker/indexWindow.js', access: 'SKEW_MS', gen: 'TRACKER_INDEX_SKEW_MS', key: 'trackerIndexSkewMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.EVAL_GAP_MS', gen: 'SYNC_EVAL_GAP_MS', key: 'syncEvalGapMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.DIRTY_PROBE_DEBOUNCE_MS', gen: 'SYNC_DIRTY_PROBE_DEBOUNCE_MS', key: 'syncDirtyProbeDebounceMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.OVERLAP_SKEW_MS', gen: 'SYNC_OVERLAP_SKEW_MS', key: 'syncOverlapSkewMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.FAILURE_BACKOFF_MS', gen: 'SYNC_FAILURE_BACKOFF_MS', key: 'syncFailureBackoffMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.DIRTY_ECHO_TTL_MS', gen: 'SYNC_DIRTY_ECHO_TTL_MS', key: 'syncDirtyEchoTtlMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.POLL_GRID_MS', gen: 'SYNC_POLL_GRID_MS', key: 'syncPollGridMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.ACTION_PROBE_WINDOW_MS', gen: 'SYNC_ACTION_PROBE_WINDOW_MS', key: 'syncActionProbeWindowMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.FALLBACK_PROBE_MS', gen: 'SYNC_FALLBACK_PROBE_MS', key: 'syncFallbackProbeMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.FOCUS_PROBE_MIN_MS', gen: 'SYNC_FOCUS_PROBE_MIN_MS', key: 'syncFocusProbeMinMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.SNAP_FRESH_MS', gen: 'SYNC_SNAP_FRESH_MS', key: 'syncSnapFreshMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.ATTENTION_HEARTBEAT_MS', gen: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs' },
  { file: 'src/shared/tracker/sync.js', access: 'SYNC.ISSUE_CACHE_TTL', gen: 'SYNC_ISSUE_CACHE_TTL_MS', key: 'syncIssueCacheTtlMs' },
  { file: 'src/shared/naming-tracking.js', access: 'NAMING_RETRY_COOLDOWN_MS', gen: 'NAMING_RETRY_COOLDOWN_MS', key: 'namingRetryCooldownMs' },
  // —— deck 壳：注册外层上限（导出名沿用，值是中央那一份） ——
  { file: 'src/deck/registration/register-options.ts', access: 'AGENT_TOOL_TIMEOUT_MS', gen: 'TOOL_TIMEOUT_MS', key: 'toolTimeoutMs' },
  { file: 'src/deck/registration/register-options.ts', access: 'REGISTER_RETRY_WAIT_MS', gen: 'REGISTER_RETRY_WAIT_MS', key: 'registerRetryWaitMs' },
  // —— 宿主 tracker：谓词回落超时（函数内裸用导入常量，模块不导出：门禁走源码 import 断言） ——
  { file: 'src/host/tracker/predicateCore.js', access: 'PREDICATE_FALLBACK_TIMEOUT_MS', gen: 'PREDICATE_FALLBACK_TIMEOUT_MS', key: 'predicateFallbackTimeoutMs' },
  { file: 'src/deck/shell/call-budget.ts', access: 'DEFAULT_TOOL_TIMEOUT_MS', gen: 'TOOL_TIMEOUT_MS', key: 'toolTimeoutMs' },
  { file: 'src/deck/shell/call-budget.ts', access: 'DEFAULT_TOOL_MARGIN_MS', gen: 'TOOL_MARGIN_MS', key: 'toolMarginMs' },
  { file: 'src/deck/shell/call-budget.ts', access: 'DEFAULT_PER_OP_TIMEOUT_MS', gen: 'PER_OP_TIMEOUT_MS', key: 'perOpTimeoutMs' },
  { file: 'src/deck/rules/anchor.ts', access: 'ANCHOR_WINDOW_MS', gen: 'ANCHOR_WINDOW_MS', key: 'anchorWindowMs' },
  { file: 'src/deck/shell/write-mutex.ts', access: 'DEFAULT_KEY_LOCK_TIMEOUT_MS', gen: 'KEY_LOCK_TIMEOUT_MS', key: 'keyLockMs' },
  { file: 'src/deck/registration/host-assemble.ts', access: 'DECK_ASSEMBLY_TIMEOUT_MS', gen: 'DECK_ASSEMBLY_TIMEOUT_MS', key: 'deckAssemblyMs' },
  // —— 界面半边：门禁把它当模块直接 import 跑，引用是真的（构建拼进闭包时剥掉 import 行） ——
  { file: 'src/client/kernel/log.js', access: 'LOG_FLUSH_MS', gen: 'LOG_FLUSH_MS', key: 'logFlushMs' },
  { file: 'src/client/kernel/log.js', access: 'LOG_WATCHDOG_MS', gen: 'LOG_WATCHDOG_MS', key: 'logWatchdogMs' },
  { file: 'src/client/kernel/probe-snapshot.js', access: 'SNAP_WAIT_MS', gen: 'SNAP_WAIT_MS', key: 'snapWaitMs' },
  { file: 'src/client/kernel/settings-view-write.js', access: 'VIEW_FLAG_WRITE_DEBOUNCE_MS', gen: 'VIEW_FLAG_WRITE_DEBOUNCE_MS', key: 'viewFlagWriteDebounceMs' },
  { file: 'src/client/kernel/attention-heartbeat.js', access: 'ATTENTION_EXPIRY_MS', gen: 'ATTENTION_EXPIRY_MS', key: 'attentionExpiryMs' },
  { file: 'src/client/kernel/attention-heartbeat.js', access: 'ATTENTION_HEARTBEAT_MS', gen: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs' },
  { file: 'src/client/views/shared/truthLines.js', access: 'REST_FALLBACK_STALE_MS', gen: 'REST_FALLBACK_STALE_MS', key: 'restFallbackStaleMs' },
  { file: 'src/client/views/versionControl/vcText.js', access: 'VC_RELATIVE_WINDOW_MS', gen: 'VC_RELATIVE_WINDOW_MS', key: 'vcRelativeWindowMs' },
  { file: 'src/client/kernel/store-prefs.js', access: 'SYNC_ISSUE_CACHE_TTL_MS', gen: 'SYNC_ISSUE_CACHE_TTL_MS', key: 'syncIssueCacheTtlMs' },
  { file: 'src/client/kernel/store-switch.js', access: 'STORE_SWITCH_CONFIRM_MS', gen: 'STORE_SWITCH_CONFIRM_MS', key: 'storeSwitchConfirmMs' },
  { file: 'src/client/kernel/api-new-session.js', access: 'CLIENT_SESSION_TICK_MS', gen: 'CLIENT_SESSION_TICK_MS', key: 'clientSessionTickMs' },
  { file: 'src/client/kernel/api-new-session.js', access: 'CLIENT_HANDOFF_DELAY_MS', gen: 'CLIENT_HANDOFF_DELAY_MS', key: 'clientHandoffDelayMs' },
  { file: 'src/client/views/primitives/Tip.js', access: 'TIP_SHOW_DELAY_MS', gen: 'TIP_SHOW_DELAY_MS', key: 'tipShowDelayMs' },
  { file: 'src/client/views/primitives/Tip.js', access: 'TIP_HIDE_DELAY_MS', gen: 'TIP_HIDE_DELAY_MS', key: 'tipHideDelayMs' },
]

// ---------------------------------------------------------------------------
// 表二 CLIENT：界面半边要用的中央常量（走“构建时摘名字拼进闭包”那条路）。
// 为什么单列一张表：界面文件不能 import，值只能由 scripts/build.mjs 的 CLIENT_TIME_NAMES
// 挑出来塞进同一个闭包。三件事要一次对上，少一件界面就会引用一个不存在的名字或白拼一份：
//   ① values.ts 里有这个常量（YAML 键存在）；② 构建名单里有它；③ 界面文件里确实在用它。
// 名单与表必须严格一一对应（名单多一个名字 = 拼进闭包却没人用；表多一行 = 用了却没人拼）。
// ---------------------------------------------------------------------------
interface ClientRow {
  file: string
  /** 界面文件里引用的中央常量名，也是 build.mjs 拼接名单里的名字。 */
  name: string
  /** 它对应的 YAML 键（人改的那个名字）。 */
  key: string
}
const CLIENTS: ClientRow[] = [
  { file: 'src/client/kernel/api-io.ts', name: 'MAP_TICKETS_TTL_MS', key: 'mapTicketsTtlMs' },
  { file: 'src/client/kernel/settings-debug.ts', name: 'SETTINGS_DEBUG_PUSH_WAIT_MS', key: 'settingsDebugPushWaitMs' },
  { file: 'src/client/kernel/api-new-session.js', name: 'CLIENT_SESSION_TICK_MS', key: 'clientSessionTickMs' },
  { file: 'src/client/kernel/api-new-session.js', name: 'CLIENT_HANDOFF_DELAY_MS', key: 'clientHandoffDelayMs' },
  { file: 'src/client/kernel/probe-auto.js', name: 'PROBE_AUTO_WAIT_MS', key: 'probeAutoWaitMs' },
  { file: 'src/client/kernel/probe-snapshot-helpers.js', name: 'SNAPSHOT_PROBE_MS', key: 'snapshotProbeMs' },
  { file: 'src/client/kernel/slotRenderer-queue.js', name: 'SLOT_QUEUE_STEP_MS', key: 'slotQueueStepMs' },
  { file: 'src/client/kernel/slotRenderer-modal-view.js', name: 'SLOT_MODAL_OPEN_DELAY_MS', key: 'slotModalOpenDelayMs' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'STORE_NOTICE_DISMISS_MS', key: 'storeNoticeDismissMs' },
  { file: 'src/client/kernel/store-switch.js', name: 'STORE_SWITCH_CONFIRM_MS', key: 'storeSwitchConfirmMs' },
  { file: 'src/client/statusbar/StatusLogMenu.js', name: 'STATUS_MENU_DISMISS_DELAY_MS', key: 'statusMenuDismissDelayMs' },
  { file: 'src/client/statusbar/StatusLogMenu.js', name: 'STATUS_MENU_HOVER_OPEN_DELAY_MS', key: 'statusMenuHoverOpenDelayMs' },
  { file: 'src/client/statusbar/StatusMenus.js', name: 'STATUS_MENU_FALLBACK_DELAY_MS', key: 'statusMenuFallbackDelayMs' },
  { file: 'src/client/views/IssueDetail.ts', name: 'ISSUE_DETAIL_CONFIRM_MS', key: 'issueDetailConfirmMs' },
  { file: 'src/client/views/IssueDetailComments.ts', name: 'COMMENT_RESULT_FLASH_MS', key: 'commentResultFlashMs' },
  { file: 'src/client/views/IssueDetailComments.ts', name: 'COMMENTS_MORE_LOADING_MIN_MS', key: 'commentsMoreLoadingMinMs' },
  { file: 'src/client/views/ListTabRow.js', name: 'COPY_FLASH_MS', key: 'copyFlashMs' },
  // #1160 收尾自审发现的一类漏网写法：回调带括号时旧正则看不见参数列表第二位上的数字
  // （`setTimeout(function () {…}, 160)` 这种）。下面五处都是这类，现已收编成中央常量。
  { file: 'src/client/floating/SkillFloatList.js', name: 'SKILL_FLOAT_CLOSE_DELAY_MS', key: 'skillFloatCloseDelayMs' },
  { file: 'src/client/views/labels/LabelColorDialog.js', name: 'LABEL_COPY_FLASH_MS', key: 'labelCopyFlashMs' },
  { file: 'src/client/views/skillDetail/PixelSkillDetailModal.ts', name: 'SKILL_DETAIL_COPIED_FLASH_MS', key: 'skillDetailCopiedFlashMs' },
  { file: 'src/client/panelAssembly.js', name: 'NATIVE_TAB_RETRY_INTERVAL_MS', key: 'nativeTabRetryIntervalMs' },
  { file: 'src/client/views/skillDetail/PixelSkillOps.ts', name: 'SKILL_SKELETON_DELAY_MS', key: 'skillSkeletonDelayMs' },
  // 这几处是「SYNC 缺席时的兜底」，正常路径取 tracker/sync.js 里那份已锁的值，
  // 兜底这一支也改成吃拼进闭包的中央常量，界面上不再有第二份数字。
  { file: 'src/client/kernel/probe-auto.js', name: 'SYNC_FALLBACK_PROBE_MS', key: 'syncFallbackProbeMs' },
  { file: 'src/client/kernel/probe-auto.js', name: 'SYNC_FOCUS_PROBE_MIN_MS', key: 'syncFocusProbeMinMs' },
  { file: 'src/client/kernel/probe-auto.js', name: 'SYNC_SNAP_FRESH_MS', key: 'syncSnapFreshMs' },
  { file: 'src/client/kernel/store-prefs.js', name: 'SYNC_ISSUE_CACHE_TTL_MS', key: 'syncIssueCacheTtlMs' },
  // 界面叶子与内核改成中央真引用后、剥掉 import 行的那些名字也由这一片提供。
  { file: 'src/client/kernel/probe-snapshot.js', name: 'SNAP_WAIT_MS', key: 'snapWaitMs' },
  { file: 'src/client/kernel/settings-view-write.js', name: 'VIEW_FLAG_WRITE_DEBOUNCE_MS', key: 'viewFlagWriteDebounceMs' },
  { file: 'src/client/views/shared/truthLines.js', name: 'REST_FALLBACK_STALE_MS', key: 'restFallbackStaleMs' },
  { file: 'src/client/views/primitives/Tip.js', name: 'TIP_SHOW_DELAY_MS', key: 'tipShowDelayMs' },
  { file: 'src/client/views/primitives/Tip.js', name: 'TIP_HIDE_DELAY_MS', key: 'tipHideDelayMs' },
  { file: 'src/client/views/versionControl/vcText.js', name: 'VC_RELATIVE_WINDOW_MS', key: 'vcRelativeWindowMs' },
  { file: 'src/client/kernel/api-io.ts', name: 'DRAFT_REFOCUS_RETRY_MS', key: 'draftRefocusRetryMs' },
  // —— 拼进闭包的共享文件：它们自己不能 import（闭包里没有模块系统），import 行剥掉之后，
  // 下面这些名字由 timeConfig 片段提供声明。file 填的是真源（.ts/.js 源码），门禁只查“文件里确实在用”，
  // 值的一致性由表一（REFERENCES）那几行管——两张表各管一头。
  // naming-tracking.js（改名冷却窗，闭包里的面板逻辑要用它判“还在冷却里”）。
  { file: 'src/shared/naming-tracking.js', name: 'NAMING_RETRY_COOLDOWN_MS', key: 'namingRetryCooldownMs' },
  // sync.js（trackerSync 拼片）：SYNC 对象里原来是字面量，现在 12 个名字全由这一片提供。
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_EVAL_GAP_MS', key: 'syncEvalGapMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_DIRTY_PROBE_DEBOUNCE_MS', key: 'syncDirtyProbeDebounceMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_OVERLAP_SKEW_MS', key: 'syncOverlapSkewMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_FAILURE_BACKOFF_MS', key: 'syncFailureBackoffMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_DIRTY_ECHO_TTL_MS', key: 'syncDirtyEchoTtlMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_POLL_GRID_MS', key: 'syncPollGridMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_ACTION_PROBE_WINDOW_MS', key: 'syncActionProbeWindowMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_FALLBACK_PROBE_MS', key: 'syncFallbackProbeMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_FOCUS_PROBE_MIN_MS', key: 'syncFocusProbeMinMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_SNAP_FRESH_MS', key: 'syncSnapFreshMs' },
  { file: 'src/shared/tracker/sync.js', name: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC_ISSUE_CACHE_TTL_MS', key: 'syncIssueCacheTtlMs' },
  // budget.ts（refreshBudget 拼片）：函数体里裸用这 17 个名字，单源头改造前是字面量。
  { file: 'src/shared/refresh/src/budget.ts', name: 'PROBE_INTERVAL_MS', key: 'probeIntervalMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PROBE_INTERVAL_YELLOW_MS', key: 'probeIntervalYellowMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PROBE_INTERVAL_LINGER_MS', key: 'probeIntervalLingerMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'REBUILD_MIN_INTERVAL_YELLOW_MS', key: 'rebuildMinIntervalYellowMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'RECONCILE_INTERVAL_MS', key: 'reconcileIntervalMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PREFLIGHT_TTL_MS', key: 'preflightTtlMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'CHAIN_BACKOFF_MS', key: 'chainBackoffMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'FAILURE_HALF_OPEN_DELAY_MS', key: 'failureHalfOpenDelayMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'CHAIN_ALL_GREEN_TTL_MS', key: 'chainAllGreenTtlMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PATCH_MERGE_WINDOW_MS', key: 'patchMergeWindowMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'DEFER_EXPIRY_MS', key: 'deferExpiryMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'ACTIVE_LINGER_MS', key: 'activeLingerMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'ATTENTION_EXPIRY_MS', key: 'attentionExpiryMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'QUOTA_SYNC_INTERVAL_MS', key: 'quotaSyncIntervalMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'FRESHNESS_YELLOW_MS', key: 'freshnessYellowMs' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'FRESHNESS_RED_MS', key: 'freshnessRedMs' },
]

// ---------------------------------------------------------------------------
// 表三 PERMANENT：源码里允许留数字的唯一出口。每一行锁死“文件 + 片段”，
// 片段变了（改数字、改写法、挪位置）就判红。理由四选一，写不清的不许出现在这里。
// ---------------------------------------------------------------------------
interface PermanentRow {
  file: string
  snippet: string
  reason: string
}
const PERMANENT: PermanentRow[] = [
  // —— 单位换算（数学定义，不是旋钮） ——
  { file: 'src/shared/refresh/src/budget.ts', snippet: 'HOUR_MS = 3_600_000', reason: '单位换算（1 小时），不是旋钮，调它没有意义' },
  { file: 'src/client/views/shared/truthLines.js', snippet: 'TRUTH_MINUTE_MS = 60000', reason: '单位换算（1 分钟），只做“多久”折人话的刻度，不是旋钮' },
  // —— 0 表示“还没有 / 关掉”（状态初值与开关，不是时长） ——
  { file: 'src/shared/naming-tracking.ts', snippet: 'NAMING_HINT_GRACE_MS = 0', reason: '值为 0 表示把这个宽限窗关掉，不是可调时长' },
  { file: 'src/client/kernel/attention-heartbeat.js', snippet: "intervalMs: 0, lingerMs: 0, standing: '', limit: 0, atMs: 0", reason: '心跳计划的状态初值（0 = 还没定下节拍 / 还没跳过），真值由刷新预算注入，不是新参数' },
  { file: 'src/client/kernel/router.js', snippet: 'commitMs: -1, fitMs: 0', reason: '面板时钟的状态初值（-1 / 0 = 还没提交过），不是可调时长' },
  { file: 'src/shared/tracker/indexWindow.ts', snippet: 'sinceMs: 0', reason: '还没有水位时从头全量（0 = 没有上次扫到哪儿），不是可调时长' },
  // —— 单位不是毫秒（调它等于改语义，不是调时间） ——
  { file: 'src/shared/refresh/src/backoff.ts', snippet: 'MIN_BACKOFF_STEPS = 2', reason: '退避步数下限（几档）：只有一档就没有「退」这件事，门禁按它核对序列；改它等于改校验语义' },
]

// ---------------------------------------------------------------------------
// 表四 EXEMPT：覆盖率扫描认出来、但不是“本文件自己决定的可调时长”的名字。
// 每一行都要有理由，理由写不清的就不该出现在这里——那是漏登记的参数，不是豁免。
// 注意：这里只认“名字”，名字后面挂着数字由上一张 PERMANENT 表管（两张表各管一头）。
// ---------------------------------------------------------------------------
interface ExemptRow {
  file: string
  name: string
  reason: string
}
const EXEMPTS: ExemptRow[] = [
  // —— tuning.ts：非时间条数 ——
  { file: 'src/shared/refresh/src/tuning.ts', name: 'readBucketMax', reason: '条数（桶容量），不是时间' },
  { file: 'src/shared/refresh/src/tuning.ts', name: 'writeBucketMax', reason: '条数（桶容量），不是时间' },
  // —— 函数内局部变量：它们只是把模块参数换个名字接住，不是新的参数 ——
  { file: 'src/tracker/detection/workspaceStore.ts', name: 'ttl', reason: '函数内局部变量，接的是 WORKSPACE_STORE_TTL_MS（已登记），不是新参数' },
  { file: 'src/tracker/registry/core.ts', name: 'matchesTimeout', reason: '函数内局部变量，接的是 MATCHES_TIMEOUT_MS（已登记），不是新参数' },
  { file: 'src/deck/shell/plan-cursor.ts', name: 'ttl', reason: '函数内局部变量，接的是 7 天默认值（已登记），不是新参数' },
  { file: 'src/shared/refresh/src/write-detect.ts', name: 'mergeWindowMs', reason: '函数内局部变量，接的是注入的 limits（上游是 PATCH_MERGE_WINDOW_MS），不是新参数' },
  { file: 'src/shared/refresh/src/write-detect.ts', name: 'probeIntervalMs', reason: '函数内局部变量，接的是注入的 limits（上游是 PROBE_INTERVAL_MS），不是新参数' },
  // —— 别名：恒等于已登记的参数，改一边自动跟另一边，不需要第二把锁 ——
  { file: 'src/host/refresh/ledger.ts', name: 'SYNC_INTERVAL_MS', reason: '别名，恒等于 QUOTA_SYNC_INTERVAL_MS（已登记），引用即跟随' },
  // —— 注入结构体的字段：值由调用方按已登记参数装进来，本文件不写数字 ——
  { file: 'src/shared/refresh/src/policy.ts', name: 'rebuildMinGapMs', reason: '注入字段，接的是上游 REBUILD_MIN_INTERVAL_YELLOW_MS（已登记），缺省 0' },
  // —— 读钟算出来的测量值（耗时、时刻）：调 YAML 改不了它，不是可调参数 ——
  { file: 'src/shared/version-control/src/parse-log.ts', name: 'aMs', reason: '测量用局部变量（两次读钟的差），不是可调参数' },
  { file: 'src/shared/version-control/src/parse-log.ts', name: 'cMs', reason: '测量用局部变量（两次读钟的差），不是可调参数' },
  { file: 'src/tracker/detection/backendDecision.ts', name: 'autoMs', reason: '测量用局部变量，不是可调参数' },
  { file: 'src/tracker/detection/detectionService.ts', name: 'nowMs', reason: '读钟时刻（Date.now），不是可调参数' },
  { file: 'src/tracker/rooms/github/client.ts', name: 'elapsedMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/tracker/rooms/github/idempotency.ts', name: 'nowMs', reason: '读钟时刻（Date.now），不是可调参数' },
  { file: 'src/tracker/rooms/github/issues.ts', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  // —— 名字巧合：叫 Window 但不是时间 ——
  { file: 'src/tracker/rooms/github/idempotency.ts', name: 'inWindow', reason: '过滤后的候选数组（“窗口内的数据”），不是毫秒数' },
  // —— 第二层：函数级透传与计算值（门禁覆盖率扫描捞出来的，逐个定性） ——
  { file: 'src/deck/registration/quota-sync.ts', name: 'resetMs', reason: '服务端回传的重置时刻算出来的剩余量，不是可调参数' },
  { file: 'src/deck/rules/anchor.ts', name: 'windowMs', reason: '透传变量，缺省接 ANCHOR_WINDOW_MS（已登记）' },
  { file: 'src/deck/tools/map-link.ts', name: 'lockTimeoutMs', reason: '透传变量，缺省走 DEFAULT_KEY_LOCK_TIMEOUT_MS（已登记，见 write-mutex.ts:86）' },
  { file: 'src/deck/registration/quota-sync.ts', name: 'cooldownMs', reason: '透传变量，缺省走 QUOTA_SYNC_COOLDOWN_MS（已登记）' },
  { file: 'src/host/detectChain.ts', name: 'nowMs', reason: '读钟时刻（Date.now），不是可调参数' },
  { file: 'src/host/detectChain.ts', name: 'waitMs', reason: '透传 backoff 的 verdict 结论，不是输入参数' },
  { file: 'src/host/platformChannel.ts', name: 'timeoutMs', reason: '透传变量，接注入的 TIMEOUT_MS（调用方按已登记的 hostTimeoutMs 装进来）' },
  { file: 'src/host/refresh/chain-ride.ts', name: 'nowMs', reason: '测试注钟口（生产用 Date.now），不是可调参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'lingerMs', reason: '注入字段的本地接住（上游是 ACTIVE_LINGER_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'expiryMs', reason: '注入字段的本地接住（上游是 ATTENTION_EXPIRY_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'probeMs', reason: '注入字段的本地接住（上游是 PROBE_INTERVAL_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'lingerProbeMs', reason: '注入字段的本地接住（上游是 PROBE_INTERVAL_LINGER_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'lingerDelayMs', reason: '算出来的剩余等待（lingerMs 减已流逝），不是输入参数' },
  { file: 'src/shared/refresh/src/backoff.ts', name: 'MIN_BACKOFF_STEPS', reason: '步数下限（次数），不是毫秒' },
  { file: 'src/shared/refresh/src/backoff.ts', name: 'evaluatedAtMs', reason: '状态里的时间戳（上次求值时刻），不是可调参数' },
  { file: 'src/shared/refresh/src/backoff.ts', name: 'waitMs', reason: '算出来的等待结果（verdict 的输出），不是输入参数' },
  // —— 存量 JavaScript（覆盖率扫描从 .ts 扩到 .js 后新捞出来的）——
  // 分三类：测量值与时刻（调 YAML 改不了它）、状态字段与初值（0 表示“还没有”）、
  // 透传变量（值由调用方按已登记参数装进来）。
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'intervalMs', reason: '心跳状态的初值字段（0 = 还没定下节拍），真值由刷新预算的 PROBE_INTERVAL_MS 注入，不是新参数' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'lingerMs', reason: '同上，真值由刷新预算的 PROBE_INTERVAL_LINGER_MS 注入' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'atMs', reason: '心跳时刻的初值字段（0 = 还没跳过），不是可调参数' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'latencyMs', reason: '测量用局部变量（一次回话的耗时），不是可调参数' },
  { file: 'src/client/kernel/log.js', name: 'windowMs', reason: '算出来的时间差（距上次汇总过了多久），不是可调参数' },
  { file: 'src/client/kernel/probe-auto.js', name: 'gateMs', reason: '派生变量，缺省接本文件顶部的 FOCUS_PROBE_MIN_MS（拼进闭包的中央常量），不是新参数' },
  { file: 'src/client/kernel/probe-select.js', name: '_incMs', reason: '从快照里读出的时刻（那份快照是什么时候生成的），不是可调参数' },
  { file: 'src/client/kernel/probe-select.js', name: '_curMs', reason: '同上' },
  { file: 'src/client/kernel/probe-select.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/kernel/probe-snapshot.js', name: 'timeOfMs', reason: '函数名（把时刻格式化成给人看的文字），不是时间参数' },
  { file: 'src/client/kernel/probe-snapshot.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/kernel/router.js', name: 'fitMs', reason: '滚动位置回正的状态字段，不是时间参数' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'cacheMs', reason: '从快照里读出的生成时刻，不是可调参数' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'incomingMs', reason: '同上' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'curMs', reason: '同上' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/kernel/store-switch.js', name: '_hadToWait', reason: '布尔判断结果（这一步有没有等过），不是时间参数' },
  { file: 'src/client/statusbar/checksums.js', name: '_probeMs', reason: '读出来的探测时刻，不是可调参数' },
  { file: 'src/client/statusbar/StatusLogMenu.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/views/shared/truthLines.js', name: 'ageMs', reason: '算出来的时间差（距今多久），不是可调参数' },
  { file: 'src/client/views/versionControl/vcBlocks.js', name: 'nowMs', reason: '读钟时刻（Date.now），不是可调参数' },
  { file: 'src/host/gitCredentialExec.js', name: 'elapsedMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/host/gitCredentialExec.js', name: 'timeoutMs', reason: '透传参数，缺省接 GIT_CREDENTIAL_PROBE_TIMEOUT_MS（已登记）' },
  { file: 'src/host/gitCredentialExec.js', name: 'lowSpeedSeconds', reason: '派生变量：由已登记的 GIT_LOW_SPEED_TIMEOUT_MS 除以 1000 得到（git 的 lowSpeedTime 只认秒），除数不是时长' },
  { file: 'src/host/gitCredentialExec.js', name: 'deadline', reason: '算出来的截止时刻（Date.now() 加整趟预算），不是可调参数' },
  { file: 'src/host/namingGuardian.js', name: 'delay', reason: '派生变量：缺省接已登记的 NAMING_SWEEP_SOON_MS，正常路径用调用方给的 delayMs' },
  { file: 'src/shared/naming-tracking.ts', name: 'grace', reason: '派生变量：缺省接已登记的 NAMING_HINT_GRACE_MS，正常路径用调用方给的 hintGraceMs' },
  { file: 'src/shared/refresh/src/backoff.ts', name: 'delay', reason: '派生变量：backoffDelayMs(state) 算出来的本次等待时长，序列本身已登记为 chainBackoffMs' },
  { file: 'src/tracker/rooms/github/client.ts', name: 'timeout', reason: '透传参数：值来自上层调用参数，本文件不决定时长（出站层的档位由 outbound-tiers.ts 定，已登记）' },
  { file: 'src/tracker/rooms/gitlab/client.ts', name: 'timeout', reason: '同上，透传参数' },
  { file: 'src/host/platform/issueIndexWindow.js', name: 'startedMs', reason: '读钟时刻（这趟扫描什么时候开始的），不是可调参数' },
  { file: 'src/host/platform/issueIndexWindow.js', name: 'nextWatermarkMs', reason: '算出来的下一个水位时刻，不是可调参数' },
  { file: 'src/host/platform/issueIndexWindow.js', name: 'watermarkMs', reason: '上次扫到哪儿的时刻（状态字段），不是可调参数' },
  { file: 'src/host/refresh/attention.js', name: 'humanMs', reason: '读出来的「人最后一次动键盘鼠标」的时刻，不是可调参数' },
  { file: 'src/host/refresh/chainBackoff.js', name: 'waitMs', reason: '算出来的等待结果（退避结论的输出），不是输入参数' },
  { file: 'src/host/refresh/patch.js', name: 'scanStartedMs', reason: '读钟时刻（这趟核对什么时候开始的），不是可调参数' },
  { file: 'src/host/refresh/patch.js', name: 'sinceMs', reason: '算出来的起点时刻（上次水位减容差），不是可调参数' },
  { file: 'src/host/skillProbeCache.js', name: 'ttlMs', reason: '透传参数，缺省接 SKILL_PROBE_CACHE_MS（已登记）' },
  { file: 'src/host/skillProbe.js', name: 'SKILL_CACHE_TTL_MS', reason: '函数内局部变量：接线给了正数就听接线的，没给时取中央常量 SKILL_LIST_CACHE_TTL_MS（已登记为 skillListCacheTtlMs）' },
  { file: 'src/host/tracker/snapshot.js', name: 'snapshotTtl', reason: '透传参数，缺省接 SNAPSHOT_TTL_MS（已登记为 snapshotTtlMs）' },
  { file: 'src/host/tracker/snapshot.js', name: 'depsTtl', reason: '同上' },
  { file: 'src/host/versionControl.js', name: 'timeoutMs', reason: '透传参数，缺省接本文件已登记的 RUN_TIMEOUT_MS' },
  { file: 'src/host/versionControl.js', name: 'graceMs', reason: '透传参数，缺省接 PROC_GRACE_MS（已登记为 procGraceMs）' },
  { file: 'src/shared/tracker/indexWindow.ts', name: 'sinceMs', reason: '算出来的起点时刻（水位减容差），不是可调参数' },
  // —— 派生变量：正常路径取 SYNC 契约里的同名项（已登记），兜底取拼进闭包的中央常量 ——
  { file: 'src/client/kernel/probe-auto.js', name: 'PROBE_MS', reason: '派生变量，取 SYNC.FALLBACK_PROBE_MS（已登记为 syncFallbackProbeMs），兜底取拼进闭包的 SYNC_FALLBACK_PROBE_MS；引用即跟随' },
  { file: 'src/client/kernel/probe-auto.js', name: 'FOCUS_PROBE_MIN_MS', reason: '派生变量，取 SYNC.FOCUS_PROBE_MIN_MS（已登记为 syncFocusProbeMinMs），兜底取拼进闭包的 SYNC_FOCUS_PROBE_MIN_MS；引用即跟随' },
  { file: 'src/client/kernel/probe-auto.js', name: 'SNAP_FRESH_MS', reason: '派生变量，取 SYNC.SNAP_FRESH_MS（已登记为 syncSnapFreshMs），兜底取拼进闭包的 SYNC_SNAP_FRESH_MS；引用即跟随' },
  { file: 'src/client/kernel/store-prefs.js', name: 'ISSUE_CACHE_TTL', reason: '派生变量，取 SYNC.ISSUE_CACHE_TTL（已登记为 syncIssueCacheTtlMs），兜底取拼进闭包的 SYNC_ISSUE_CACHE_TTL_MS；引用即跟随' },
  // —— 2026-10-16 对抗式自查：时间味判据加宽之后第一次被认出来的名字，逐个定性 ——
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'interval', reason: '函数参数名，值由调用方给（planAttention 的入参），本文件不决定时长' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'linger', reason: '同上，函数参数名，不是可调常量' },
  { file: 'src/deck/shell/call-shell.ts', name: 'sleep', reason: '等待函数的名字（sleep(ms)），不是数值；调用点给的毫秒数由各自的时间常量决定' },
  { file: 'src/deck/shell/session-workdir.ts', name: 'sleep', reason: '同上，等待函数名' },
  { file: 'src/deck/shell/table-cell.ts', name: 'sleep', reason: '同上，等待函数名' },
  { file: 'src/deck/shell/write-mutex.ts', name: 'sleep', reason: '同上，等待函数名' },
]

// 时间味判定，两类都认：
//   ① 写在后缀上的单位与语义：下划线写法看整段（_MS / _TTL / _INTERVAL / _EXPIRY / _BACKOFF / _WAIT /
//      _WINDOW / _AGE / KEEP_ALIVE，以及以秒、分钟、小时、天为单位的 _SECONDS / _MINUTES / _HOURS / _DAYS）；
//      驼峰写法只认结尾（…Ms / …Ttl / …Interval / …Expiry / …Backoff / …Wait / …Window / …Age /
//      …Seconds / …Minutes / …Hours / …Days）。子串匹配会把 settleSwitchCard 这种含 'ttl' 的名字误伤
//      （StatusBackend.ts 的教训），所以驼峰必须顶到结尾。
//   ② 英文里最常用的整词时间名（大小写敏感、按住词边界）：timeout / interval / delay / stall /
//      deadline / grace / cooldown / debounce / throttle / linger / watchdog / retention / duration /
//      sleep / expiry / expire / wait，以及孤零零的小写 ttl。
function timeishLike(name: string): boolean {
  return TIMEISH_RE.test(name)
}
const TIMEISH_RE = /(_MS|_TTL|_INTERVAL|_EXPIRY|_BACKOFF|_WAIT|_WINDOW|_AGE|KEEP_ALIVE|_SECONDS|_MINUTES|_HOURS|_DAYS)(_|$)|(Ms|Ttl|Interval|Expiry|Backoff|Wait|Window|Age|Seconds|Minutes|Hours|Days)$|^ttl$|(^|_)(timeout|interval|delay|stall|deadline|grace|cooldown|debounce|throttle|linger|watchdog|retention|duration|sleep|expiry|expire|wait)(_|$)/

// 把注释与字符串字面量剥掉再扫描：注释里的历史数字（“2026-10-14 由 120000 放宽到 300000”）、
// 日志文案里的数字（'timeout 30s'）、文档字符串，都不是代码，不参检。
// 剥法是粗糙的行级处理（块注释整段去、行注释按 // 切、单双反引号引号段去），
// 正则字面量里含 // 或引号的行可能被误伤——误伤只会表现为“多报”，不会漏报，
// 多报的那一行按实际情况收入 PERMANENT 或改写即可。
function stripCode(text: string): string {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat(m.split('\n').length - 1))
  return noBlock
    .split('\n')
    .map((line) => {
      const cut = line.split('//')[0]
      return cut
        .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    })
    .join('\n')
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  // 后面不能紧跟数字：否则 'SNAP_WAIT_MS' 会把 'SNAP_WAIT_MS2' 也数进去。
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\d)', 'g')
  return haystack.match(re)?.length || 0
}

async function main(): Promise<void> {
  // —— 第零节：本门禁在验证链上有位置（改了链却没带上自己，等于没看门） ——
  const stages = fs.readFileSync(path.join(ROOT, 'scripts', 'verify-stages.json'), 'utf8')
  check(stages.includes('tests/verify-time-config.ts'), '本门禁已挂进验证链（scripts/verify-stages.json）')

  // —— 第一节：生成新鲜度（调了 YAML 忘跑生成器，在这里判红） ——
  const gen = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-time-config.mjs'), '--check'], { encoding: 'utf8' })
  check(gen.status === 0, '生成源码与 config/ 下的三份时间参数文件一致' + (gen.status === 0 ? '' : '（' + String((gen.stdout || '') + (gen.stderr || '')).trim().split('\n')[0] + '）'))

  // —— 构建产物自检 ——
  // 宿主与共享层的源码 import 的是域构建产物 src/shared/time-config/values.js
  // （由构建从本域的 src/values.ts 编译出来，不入库）：缺了它第二节会抛 Cannot find module，
  // 看上去像「值对不上」，其实只是没构建过。
  if (!fs.existsSync(path.join(ROOT, 'src/shared/time-config/values.js'))) {
    check(
      false,
      '生成物 src/shared/time-config/values.js 不在（构建产物、不入库）——先跑一次 node scripts/build.mjs 再来跑本门禁；这不是值不一致',
    )
    console.log('FAIL 中央时间参数门禁：生成物缺席，先构建')
    process.exit(1)
  }

  // —— 第二节：真引用（拿到的就是生成的那一份，不是抄的数字） ——
  const timeMod = (await import(TIME_CONFIG_JS)) as { TIME_YAML: Record<string, unknown> } & Record<string, unknown>
  for (const row of REFERENCES) {
    if (!(row.key in timeMod.TIME_YAML)) {
      check(false, row.file + ' 的 REFERENCES 行键写错了：YAML 里没有 ' + row.key)
      continue
    }
    const eff = timeMod.TIME_YAML[row.key]
    let mod: Record<string, unknown>
    try {
      mod = (await import(pathToFileURL(path.join(ROOT, row.file.replace(/\.ts$/, '.js'))).href)) as Record<string, unknown>
    } catch (e) {
      check(false, row.file + ' 载入失败，REFERENCES 行无从比对：' + String((e as Error).message).split('\n')[0])
      continue
    }
    let got: unknown = mod
    for (const part of row.access.split('.')) {
      got = (got as Record<string, unknown> | undefined)?.[part]
    }
    const src = fs.readFileSync(path.join(ROOT, row.file), 'utf8')
    // import 别名（import { GEN as LOCAL }）不是模块导出，模块读不到：这时退到源码断言——
    // 文件里必须有一行从 time-config 真引用了这个生成常量（名字对不上就判红）。
    // import 行存在 + 第四节无字面量，两件事合在一起才是“真引用”。
    const local = row.access.includes('.') ? row.access.slice(row.access.indexOf('.') + 1) : row.access
    const importRe = new RegExp(
      '(import|export)\\s*\\{[^}]*\\b' + row.gen + '\\b\\s*(as\\s+' + local + '\\b)?[^}]*\\}(\\s*from\\s*[\'"][^\'"]*time-config/values\\.js[\'"])?',
    )
    // 动态 import（chainBackoff.js 那种）：import('…time-config/values.js') 取到命名空间再点名字用。
    // 静态行没有，动态行 + 名字在源码里出现才算——动态行本身不带名字，不点名就放行等于没看门。
    const dynamicRe = new RegExp('import\\(\\s*[\'"][^\'"]*time-config/values\\.js[\'"]\\s*\\)')
    const imported = importRe.test(src) || (dynamicRe.test(src) && src.includes(row.gen))
    // 数字比值相等；数组比引用，跨源码/产物两份实例时退到“值相等 + 源码里真引用了这个名字”
    // （手抄一个相同数组的作弊写法会被 import 断言拦住：没写 import 行就判红）。
    // 模块根本不导出这个名字时（只在内部用，如 budget.ts；或只走动态 import，如 chainBackoff.js），
    // got 是 undefined，比不出值——这时 import 行断言是唯一的证据（字面量那一头由第四节接着看）。
    const same = Array.isArray(eff)
      ? got === timeMod[row.gen] || (imported && (got === undefined || eqValue(got, eff)))
      : got !== undefined ? eqValue(got, eff) : imported
    check(
      same,
      row.file + ' 的 ' + row.access + ' 与 time-config 的 ' + row.gen + ' 是同一份值（真导入，不是抄的数字）'
        + (same ? '' : '（实测 ' + JSON.stringify(got) + '，YAML 生效值 ' + JSON.stringify(eff) + '；先重跑构建排除产物过期）'),
    )
  }

  // —— 第三节：界面半边拿不拿得到值（values.ts 有、构建名单有、界面文件真在用） ——
  const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8')
  const namesBlock = buildSrc.match(/const CLIENT_TIME_NAMES = \[([\s\S]*?)\]/)
  const splicedNames = new Set((namesBlock ? namesBlock[1].match(/'[A-Za-z0-9_]+'/g) || [] : []).map((s) => s.slice(1, -1)))
  check(splicedNames.size > 0, '读到了 scripts/build.mjs 的界面拼接名单 CLIENT_TIME_NAMES（' + splicedNames.size + ' 个名字）')
  const clientUsed = new Set<string>()
  for (const row of CLIENTS) {
    clientUsed.add(row.name)
    const eff = (timeMod.TIME_YAML as Record<string, unknown>)[row.key]
    check(timeMod[row.name] !== undefined, 'values.ts 里有 ' + row.name + '（YAML 键 ' + row.key + ' 的生效值 ' + JSON.stringify(eff) + '）')
    check(splicedNames.has(row.name), row.name + ' 已在 scripts/build.mjs 的拼接名单里（没登记的话界面构建出来会引用一个不存在的名字）')
    let text = ''
    try {
      text = fs.readFileSync(path.join(ROOT, row.file), 'utf8')
    } catch (e) {
      check(false, row.file + ' 读不到，界面里用没用它无从比对')
      continue
    }
    check(new RegExp('\\b' + row.name + '\\b').test(text), row.file + ' 里确实在用 ' + row.name)
  }
  for (const name of splicedNames) {
    check(clientUsed.has(name), '拼接名单里的 ' + name + ' 有界面文件在用（名单多一个名字，就是把没人用的常量白拼进闭包）')
  }

  // —— 第四节：无字面量（时间味的位置上不许出现数字，PERMANENT 表是唯一出口） ——
  const permanentByFile = new Map<string, string[]>()
  for (const row of PERMANENT) {
    if (!permanentByFile.has(row.file)) permanentByFile.set(row.file, [])
    permanentByFile.get(row.file)!.push(row.snippet)
  }
  // 五种数字藏法：声明挂数字、属性挂数字、对象里藏数字、定时器参数位、缺省回落位。
  // 前三种沿用覆盖率扫描的正则（只认“值是数字”的）；后两种是单源头改造新加的
  // （以前“缺席回落同一个数字”是合法写法，现在回落本身就是第二份数字）。
  // 0 与 -1 一律放行：它们表示“还没有”（初始哨兵：还没提交过、还没定下节拍、从头全量），
  // 不是可调时长——调一个超时值不会把它调成 0，真想关掉的那个 0 由 PERMANENT 表逐行认领。
  const numVal = (s: string): number => Number(s.replace(/_/g, ''))
  const declNumRe = /^[ \t]*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(\d[\d_]*(\.\d+)?)\b/gm
  const propNumRe = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(-?\d[\d_]*)(\s*\*\s*\d[\d_]*)*\s*[,}]/g
  const objNumRe = /([A-Za-z_$][\w$]*)\s*:\s*\{[^{}]*\d[^{}]*\}/g
  // 定时器参数位：先找调用点，再按括号配对取出这一整次调用的参数列表，逐个顶层参数看是不是裸数字。
  // 从前只用一条正则、并且要求「逗号前面是没括号的回调」，于是下面两类写法整个漏过门禁：
  //   · timer.timeout(2000)——仓里自己的定时口，延时可以是唯一的那个参数（#1160 收尾自审时真漏了一个：
  //     src/host/git-process.ts 起 `gh --version` 那一次挂的是裸 2000）；
  //   · setTimeout(() => {…}, 5000)——箭头回调自带括号，逗号前那一段被 [^,()]* 挡掉，匹配不上。
  // 所以改成取整段参数再判：只认「某个顶层参数本身就是数字」这一种形态，
  // 回调体内部的数字（timer.timeout(() => { i + 1 }, 5000) 里的 1）不算，免得凭空多报。
  const TIMER_CALL_RE = /\b(?:setTimeout|setInterval|timer\.(?:timeout|sleep|wait))\s*\(/g
  function timerArgHits(text: string): string[] {
    const out: string[] = []
    for (const m of text.matchAll(TIMER_CALL_RE)) {
      const open = (m.index || 0) + m[0].length - 1
      let depth = 0
      let args = ''
      for (let i = open; i < text.length; i++) {
        const ch = text[i]
        if (ch === '(') depth++
        else if (ch === ')') { depth--; if (depth === 0) break }
        if (depth >= 1) args += ch
      }
      // 顶层参数：按深度 1 的逗号切开（args 从最外层那个左括号起算，所以顶层深度是 1）。
      const parts: string[] = []
      let d = 0
      let cur = ''
      for (const ch of args) {
        if (ch === '(') d++
        else if (ch === ')') d--
        if (ch === ',' && d === 1) { parts.push(cur); cur = ''; continue }
        cur += ch
      }
      parts.push(cur)
      for (const part of parts) {
        const bare = part.replace(/[()]/g, '').trim()
        if (!/^\d[\d_]*$/.test(bare)) continue
        if (numVal(bare) === 0) continue
        out.push('定时器参数位是数字：' + m[0].replace(/\s*\($/, '') + '(' + bare + ')')
      }
    }
    return out
  }
  const fallbackNumRe = /([A-Za-z_$][A-Za-z0-9_$.]*)\s*(\?\?|\|\|)\s*(\d[\d_]*)\b/g
  const ls4 = spawnSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
  check(ls4.status === 0, 'git ls-files 可用（无字面量扫描的前置条件）')
  const files4 = String(ls4.stdout || '').split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.ts') || s.endsWith('.js'))
  for (const file of files4) {
    if (file === 'src/shared/time-config/src/values.ts') continue
    const text = stripCode(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    const hits: string[] = []
    for (const m of text.matchAll(declNumRe)) {
      if (numVal(m[2]) === 0) continue
      if (timeishLike(m[1])) hits.push('声明挂数字：' + m[1] + ' = ' + m[2])
    }
    for (const m of text.matchAll(propNumRe)) {
      if (!m[0].includes('*') && (numVal(m[2]) === 0 || numVal(m[2]) === -1)) continue
      if (timeishLike(m[1])) hits.push('属性挂数字：' + m[1] + ' = ' + m[2])
    }
    for (const m of text.matchAll(objNumRe)) {
      if (timeishLike(m[1])) hits.push('对象里藏数字：' + m[1] + ' : {…}')
    }
    for (const hit of timerArgHits(text)) hits.push(hit)
    for (const m of text.matchAll(fallbackNumRe)) {
      if (numVal(m[3]) === 0 || numVal(m[3]) === -1) continue
      if (timeishLike(m[1].split('.').pop()!)) hits.push('缺省回落是数字：' + m[1] + ' ' + m[2] + ' ' + m[3])
    }
    if (hits.length === 0) continue
    // 命中了先看 PERMANENT 表：片段对得上才放行，对不上（改了数字、改了写法）就判红。
    const raws = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const allowed = permanentByFile.get(file) || []
    for (const hit of hits) {
      const cover = allowed.find((s) => {
        const n = countOccurrences(raws, s)
        return n > 0 && hitCovers(s, hit)
      })
      check(!!cover, file + ' ' + hit + (cover ? '（PERMANENT 表已认领）' : '——源码里不许写时间数字：入 YAML 走 import，或收入 PERMANENT 并写明理由'))
    }
    // PERMANENT 片段自身也要存在，否则这张表就是空头支票。
    for (const s of allowed) {
      check(countOccurrences(raws, s) > 0, file + ' 的 PERMANENT 片段还在源码里（“' + s + '”）：表与源码必须同步增减')
    }
  }

  // —— 第五节：覆盖率（src/ 下新冒出来的时间名字，必须先登记） ——
  const known = new Map<string, Set<string>>()
  const addKnown = (file: string, name: string) => {
    if (!known.has(file)) known.set(file, new Set())
    known.get(file)!.add(name)
  }
  // REFERENCES 登记的名字：导出名、对象名、属性名都是已知。
  for (const row of REFERENCES) {
    const dot = row.access.indexOf('.')
    addKnown(row.file, dot < 0 ? row.access : row.access.slice(0, dot))
    if (dot >= 0) addKnown(row.file, row.access.slice(dot + 1))
    addKnown(row.file, row.gen)
  }
  for (const row of CLIENTS) addKnown(row.file, row.name)
  // PERMANENT 表里的名字：数字在上一节管过了，这里只认“这个名字出现过”。
  for (const row of PERMANENT) {
    for (const mt of row.snippet.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      if (timeishLike(mt[1])) addKnown(row.file, mt[1])
    }
  }
  const exempt = new Map<string, Map<string, string>>()
  for (const row of EXEMPTS) {
    if (!exempt.has(row.file)) exempt.set(row.file, new Map())
    exempt.get(row.file)!.set(row.name, row.reason)
  }
  // 每个文件登记的生成常量名：声明右边引用它，等于“值从中央来”，自动放行
  // （例如 const ATTENTION_SILENT_MS = ATTENTION_EXPIRY_MS：左边是新名字，但右边是中央那一份）。
  // 名单是全局的：右边出现任何一个已登记的生成常量名都算数——生成常量的名字是中央统一编的，
  // 局部变量撞上同一个名字的概率基本没有；真撞上了，第四节的字面量扫描会把本地赋值拦下来。
  const allGens = new Set<string>()
  for (const row of REFERENCES) {
    allGens.add(row.gen)
  }
  for (const row of CLIENTS) {
    allGens.add(row.name)
  }
  const declRe = /^[ \t]*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]/gm
  const propRe = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\d[\d_]*(\s*\*\s*\d[\d_]*)*\s*[,}]/g
  const files = String(ls4.stdout || '').split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.ts') || s.endsWith('.js'))
  let scanned = 0
  for (const file of files) {
    if (file === 'src/shared/time-config/src/values.ts') continue
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const stripped = stripCode(text)
    const declLines = new Map<string, string>()
    for (const m of stripped.matchAll(declRe)) {
      if (!timeishLike(m[1])) continue
      const lineStart = stripped.lastIndexOf('\n', m.index) + 1
      const lineEnd = stripped.indexOf('\n', m.index)
      declLines.set(m[1], stripped.slice(lineStart, lineEnd < 0 ? undefined : lineEnd))
    }
    const names = new Set<string>(declLines.keys())
    for (const m of stripped.matchAll(propRe)) {
      if (timeishLike(m[1])) names.add(m[1])
    }
    for (const m of stripped.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{[^{}]*\d[^{}]*\}/g)) {
      if (timeishLike(m[1])) names.add(m[1])
    }
    if (names.size === 0) continue
    scanned++
    for (const name of names) {
      if (known.get(file) && known.get(file)!.has(name)) continue
      // 右边引用已登记的生成常量：值从中央来，放行。
      const rhs = declLines.get(name) || ''
      if (rhs && [...allGens].some((g) => rhs.includes(g))) continue
      const why = exempt.get(file) && exempt.get(file)!.get(name)
      check(!!why, file + ' 的 ' + name + (why ? ' 豁免（' + why + '）' : ' 未登记：新时间名字必须先入 YAML（REFERENCES 表）或写明豁免理由（EXEMPTS 表）'))
    }
  }
  check(scanned > 0, '覆盖率扫描走完了全部 src/**/*.ts 与 .js（命中时间名字的文件 ' + scanned + ' 个）')

  if (failed) process.exit(1)
  console.log('PASS 中央时间参数门禁全绿')
}

// PERMANENT 命中匹配：片段里的名字出现在 hit 描述里，算认领成功。
// （片段锁的是源码写法，hit 锁的是“哪种藏法”：两者对上才放行。）
function hitCovers(snippet: string, hit: string): boolean {
  const names = snippet.match(/([A-Za-z_$][A-Za-z0-9_$]*)/g) || []
  return names.some((n) => timeishLike(n) && hit.includes(n))
}

main().catch((e) => {
  console.log('  FAIL 门禁自己跑崩了：' + String((e && (e as Error).message) || e).split('\n')[0])
  process.exit(1)
})
