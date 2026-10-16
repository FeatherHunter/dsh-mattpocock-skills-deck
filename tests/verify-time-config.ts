// verify-time-config.ts —— 中央时间参数门禁（票 #1215 立）。
//
// 为什么要有这扇门禁：
//   全仓时间参数的唯一书写处是 config/ 下的三份文件（人改的唯一地方）：
//   config/timeouts.yaml（超时上限）、config/intervals.yaml（间隔与一次性延时、退避表）、
//   config/ttl.yaml（有效期）。生效处是 src/shared/time-config/src/values.ts（生成器写出的，
//   见 scripts/generate-time-config.mjs）。这扇门禁看守四件事，缺一件都会让“中央”二字落空：
//   ① 生成新鲜度：values.ts 必须与今天的三份 YAML 对得上（调了 YAML 忘跑生成器，在这里判红）；
//   ② 值一致：每个调用方文件里的数字（能 import 的按导出比，不能 import 的按源码字面比）
//      必须等于 YAML 生效值（改了一边没改另一边，在这里判红）；
//   ③ 覆盖率：src/ 下新冒出来的时间常量必须先登记，.ts 手写代码与 .js 存量代码一起扫
//      （绕过 YAML 直接写数字，在这里判红）；
//   ④ 界面半边能拿到值：界面文件是拼进同一个闭包才能用中央常量的，谁用了谁就必须出现在
//      scripts/build.mjs 的拼接名单里（两边对不上，构建出来的界面会引用一个不存在的名字）。
//
// 为什么分“能 import 的”与“不能 import 的”：
//   有些文件有零导入约束（src/deck/registration/register-options.ts:37，
//   本文件不引用其他层的文件），有些值藏在函数内部（src/host/index.ts 的 TIMEOUT_MS），
//   有些只是调用点的字面量（GitLab 房二十多处 { timeout: 8000 }）。硬要它们 import，
//   等于逼着改架构；所以前者按模块导出比（IMPORT 表），后者按源码字面出现次数比
//   （TEXT 表）。两种表的每一行都同时锁死“文件里的写法”与“YAML 的生效值”，
//   任何一边漂移都判红。
//
// 为什么界面半边（src/client/**）与两个被拼接的共享文件永远是字面量：
//   界面半边在构建时被整份拼进一个大闭包（scripts/build.mjs 的 SHARED_SPLICE），
//   文件里出现 import 语句在闭包里就是语法错误；src/shared/tracker/sync.js 与
//   src/shared/naming-tracking.js 也是整份拼进去的，同理不能 import。它们的数字由本门禁
//   按模块导出比（IMPORT 表 literal 行）或按源码字面出现次数比（TEXT 表）锁在 YAML 值上。
//   界面真正要用的中央常量走“构建时摘名字拼进闭包”那条路，名单在 CLIENT 表。
//
// 迁移中的状态机（#1215 分六片落地）：
//   每一行的 kind 只有两种：'literal'（文件里还是自己写的数字，门禁断言“相等”）与
//   'imported'（文件已经改成从 time-config 导入，门禁断言“就是同一个导出”，数组用引用相等）。
//   切片落地时把对应行翻成 'imported'，删掉 TEXT 行。永远保持 'literal' 的有四处，
//   它们不是没迁完，是架构上不能迁，理由写在各自的 note 里：
//   budget.ts（共享域之间不许互相 import）、tuning.ts（同上）、
//   write-ticket.ts（同上）、register-options.ts（零导入约束，见上）；界面半边与两个
//   被拼接的共享文件同理，理由写在各自行里。

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

/** YAML 生效值：YAML 写了就用 YAML 的，缺键用回落底座（与生成器 load() 同一条规则）。 */
function effective(key: string, timeYaml: Record<string, unknown>, fallbacks: Record<string, unknown>): unknown {
  return timeYaml[key] !== undefined ? timeYaml[key] : fallbacks[key]
}

// ---------------------------------------------------------------------------
// 表一 IMPORT：能 import 到的模块导出。kind 见文件头“状态机”一节。
// ---------------------------------------------------------------------------
interface ImportRow {
  file: string
  /** 模块导出的名字；TUNING 那行是“导出名.属性”写法，见下面的 PROP 分支。 */
  /** 生成侧（time-config values.ts）的常量名；imported 形态按这个名字比“同一份”。 */
  gen: string
  name: string
  key: string
  kind: 'literal' | 'imported'
  note?: string
}
const IMPORTS: ImportRow[] = [
  { file: 'src/tracker/kernel/outbound-tiers.ts', name: 'READ_TIMEOUT_MS', gen: 'OUTBOUND_READ_TIMEOUT_MS', key: 'outboundReadMs', kind: 'imported' },
  { file: 'src/tracker/kernel/outbound-tiers.ts', name: 'WRITE_TIMEOUT_MS', gen: 'OUTBOUND_WRITE_TIMEOUT_MS', key: 'outboundWriteMs', kind: 'imported' },
  { file: 'src/tracker/kernel/outbound-tiers.ts', name: 'PROBE_TIMEOUT_MS', gen: 'OUTBOUND_PROBE_TIMEOUT_MS', key: 'outboundProbeMs', kind: 'imported' },
  { file: 'src/tracker/kernel/outbound-tiers.ts', name: 'DEFAULT_TIMEOUT_MS', gen: 'OUTBOUND_DEFAULT_TIMEOUT_MS', key: 'outboundDefaultMs', kind: 'imported' },
  { file: 'src/tracker/registry/core.ts', name: 'MATCHES_TIMEOUT_MS', gen: 'MATCHES_TIMEOUT_MS', key: 'matchesTimeoutMs', kind: 'imported' },
  { file: 'src/tracker/rooms/github/client.ts', name: 'TIMEOUT_MS', gen: 'GITHUB_CLIENT_TIMEOUT_MS', key: 'githubClientTimeoutMs', kind: 'imported' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PROBE_INTERVAL_MS', gen: 'PROBE_INTERVAL_MS', key: 'probeIntervalMs', kind: 'literal', note: '共享域之间不许互相 import，永久 literal，只断言值相等' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PROBE_INTERVAL_YELLOW_MS', gen: 'PROBE_INTERVAL_YELLOW_MS', key: 'probeIntervalYellowMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PROBE_INTERVAL_LINGER_MS', gen: 'PROBE_INTERVAL_LINGER_MS', key: 'probeIntervalLingerMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'REBUILD_MIN_INTERVAL_YELLOW_MS', gen: 'REBUILD_MIN_INTERVAL_YELLOW_MS', key: 'rebuildMinIntervalYellowMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'RECONCILE_INTERVAL_MS', gen: 'RECONCILE_INTERVAL_MS', key: 'reconcileIntervalMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'QUOTA_SYNC_INTERVAL_MS', gen: 'QUOTA_SYNC_INTERVAL_MS', key: 'quotaSyncIntervalMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'ATTENTION_HEARTBEAT_MS', gen: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PREFLIGHT_TTL_MS', gen: 'PREFLIGHT_TTL_MS', key: 'preflightTtlMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'CHAIN_ALL_GREEN_TTL_MS', gen: 'CHAIN_ALL_GREEN_TTL_MS', key: 'chainAllGreenTtlMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'DEFER_EXPIRY_MS', gen: 'DEFER_EXPIRY_MS', key: 'deferExpiryMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'FAILURE_HALF_OPEN_DELAY_MS', gen: 'FAILURE_HALF_OPEN_DELAY_MS', key: 'failureHalfOpenDelayMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'ATTENTION_EXPIRY_MS', gen: 'ATTENTION_EXPIRY_MS', key: 'attentionExpiryMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'ACTIVE_LINGER_MS', gen: 'ACTIVE_LINGER_MS', key: 'activeLingerMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PATCH_MERGE_WINDOW_MS', gen: 'PATCH_MERGE_WINDOW_MS', key: 'patchMergeWindowMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'FRESHNESS_YELLOW_MS', gen: 'FRESHNESS_YELLOW_MS', key: 'freshnessYellowMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'FRESHNESS_RED_MS', gen: 'FRESHNESS_RED_MS', key: 'freshnessRedMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'CHAIN_BACKOFF_MS', gen: 'CHAIN_BACKOFF_MS', key: 'chainBackoffMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/refresh/src/tuning.ts', name: 'TUNING.deckEnsureTimeoutMs', gen: 'DECK_ENSURE_TIMEOUT_MS', key: 'deckEnsureMs', kind: 'literal', note: '共享域之间不许互相 import，永久 literal，只断言值相等' },
  { file: 'src/shared/version-control/src/write-ticket.ts', name: 'TICKET_TTL_MS', gen: 'TICKET_TTL_MS', key: 'ticketTtlMs', kind: 'literal', note: '共享域之间不许互相 import，永久 literal，只断言值相等' },
  { file: 'src/shared/tracker/indexWindow.js', name: 'MAX_WINDOW_MS', gen: 'TRACKER_INDEX_MAX_WINDOW_MS', key: 'trackerIndexMaxWindowMs', kind: 'literal', note: '共享域之间不许互相 import（dependency-cruiser 的 same-layer-import-shared 红线，src/shared/ → src/shared/ 一律判红），永久 literal，只断言值相等' },
  { file: 'src/shared/tracker/indexWindow.js', name: 'SKEW_MS', gen: 'TRACKER_INDEX_SKEW_MS', key: 'trackerIndexSkewMs', kind: 'literal', note: '同上' },
  { file: 'src/host/refresh/chain-ride.ts', name: 'CHAIN_RIDE_MAX_AGE_MS', gen: 'CHAIN_RIDE_MAX_AGE_MS', key: 'chainRideMaxAgeMs', kind: 'imported' },
  { file: 'src/deck/shell/call-budget.ts', name: 'DEFAULT_TOOL_TIMEOUT_MS', gen: 'TOOL_TIMEOUT_MS', key: 'toolTimeoutMs', kind: 'imported' },
  { file: 'src/deck/shell/call-budget.ts', name: 'DEFAULT_TOOL_MARGIN_MS', gen: 'TOOL_MARGIN_MS', key: 'toolMarginMs', kind: 'imported' },
  { file: 'src/deck/shell/call-budget.ts', name: 'DEFAULT_PER_OP_TIMEOUT_MS', gen: 'PER_OP_TIMEOUT_MS', key: 'perOpTimeoutMs', kind: 'imported' },
  { file: 'src/deck/registration/register-options.ts', name: 'AGENT_TOOL_TIMEOUT_MS', gen: 'TOOL_TIMEOUT_MS', key: 'toolTimeoutMs', kind: 'literal', note: '零导入约束（该文件 :37 注释），永久 literal；双生子同值另由 tests/verify-895-bulk-deadline.ts 第⑦节看守' },
  { file: 'src/deck/rules/anchor.ts', name: 'ANCHOR_WINDOW_MS', gen: 'ANCHOR_WINDOW_MS', key: 'anchorWindowMs', kind: 'imported' },
  { file: 'src/deck/shell/write-mutex.ts', name: 'DEFAULT_KEY_LOCK_TIMEOUT_MS', gen: 'KEY_LOCK_TIMEOUT_MS', key: 'keyLockMs', kind: 'imported' },
  { file: 'src/deck/registration/host-assemble.ts', name: 'DECK_ASSEMBLY_TIMEOUT_MS', gen: 'DECK_ASSEMBLY_TIMEOUT_MS', key: 'deckAssemblyMs', kind: 'imported' },
  // —— 界面半边：被整份拼进同一个闭包，文件里出现 import 就是语法错误，所以数字只能写在文件里，
  //    由本表按模块导出比（这是“永久 literal”，不是没迁完，理由见文件头） ——
  { file: 'src/client/kernel/log.js', name: 'LOG_FLUSH_MS', gen: 'LOG_FLUSH_MS', key: 'logFlushMs', kind: 'literal', note: '界面半边不能 import，永久 literal，只断言值相等' },
  { file: 'src/client/kernel/log.js', name: 'LOG_WATCHDOG_MS', gen: 'LOG_WATCHDOG_MS', key: 'logWatchdogMs', kind: 'literal', note: '同上' },
  { file: 'src/client/kernel/probe-snapshot.js', name: 'SNAP_WAIT_MS', gen: 'SNAP_WAIT_MS', key: 'snapWaitMs', kind: 'literal', note: '同上（tests/verify-subdir-first-frame.js 按这段源码字面做替换，写法与数字都不能动）' },
  { file: 'src/client/kernel/settings-view-write.js', name: 'VIEW_FLAG_WRITE_DEBOUNCE_MS', gen: 'VIEW_FLAG_WRITE_DEBOUNCE_MS', key: 'viewFlagWriteDebounceMs', kind: 'literal', note: '同上' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'ATTENTION_SILENT_MS', gen: 'ATTENTION_EXPIRY_MS', key: 'attentionExpiryMs', kind: 'literal', note: '同上；与宿主 budget.ts 的 ATTENTION_EXPIRY_MS 是同一个数，共用 attentionExpiryMs 这一档' },
  { file: 'src/client/views/shared/truthLines.js', name: 'REST_FALLBACK_STALE_MS', gen: 'REST_FALLBACK_STALE_MS', key: 'restFallbackStaleMs', kind: 'literal', note: '同上' },
  { file: 'src/client/views/versionControl/vcText.js', name: 'VC_RELATIVE_WINDOW_MS', gen: 'VC_RELATIVE_WINDOW_MS', key: 'vcRelativeWindowMs', kind: 'literal', note: '同上（tests/verify-842-version-control-write-view.js 把它列为导出契约）' },
  // —— 跟踪器同步契约对象：src/shared/tracker/sync.js 也整份拼进界面闭包，同理永久 literal ——
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.EVAL_GAP_MS', gen: 'SYNC_EVAL_GAP_MS', key: 'syncEvalGapMs', kind: 'literal', note: '整份拼进界面闭包不能 import，永久 literal，只断言值相等' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.DIRTY_PROBE_DEBOUNCE_MS', gen: 'SYNC_DIRTY_PROBE_DEBOUNCE_MS', key: 'syncDirtyProbeDebounceMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.OVERLAP_SKEW_MS', gen: 'SYNC_OVERLAP_SKEW_MS', key: 'syncOverlapSkewMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.FAILURE_BACKOFF_MS', gen: 'SYNC_FAILURE_BACKOFF_MS', key: 'syncFailureBackoffMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.DIRTY_ECHO_TTL_MS', gen: 'SYNC_DIRTY_ECHO_TTL_MS', key: 'syncDirtyEchoTtlMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.POLL_GRID_MS', gen: 'SYNC_POLL_GRID_MS', key: 'syncPollGridMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.ACTION_PROBE_WINDOW_MS', gen: 'SYNC_ACTION_PROBE_WINDOW_MS', key: 'syncActionProbeWindowMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.FALLBACK_PROBE_MS', gen: 'SYNC_FALLBACK_PROBE_MS', key: 'syncFallbackProbeMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.FOCUS_PROBE_MIN_MS', gen: 'SYNC_FOCUS_PROBE_MIN_MS', key: 'syncFocusProbeMinMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.SNAP_FRESH_MS', gen: 'SYNC_SNAP_FRESH_MS', key: 'syncSnapFreshMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.ATTENTION_HEARTBEAT_MS', gen: 'ATTENTION_HEARTBEAT_MS', key: 'attentionHeartbeatMs', kind: 'literal', note: '同上；与 refresh-core 的 ATTENTION_HEARTBEAT_MS 同一个数，共用 attentionHeartbeatMs 这一档' },
  { file: 'src/shared/tracker/sync.js', name: 'SYNC.ISSUE_CACHE_TTL', gen: 'SYNC_ISSUE_CACHE_TTL_MS', key: 'syncIssueCacheTtlMs', kind: 'literal', note: '同上' },
  { file: 'src/shared/naming-tracking.js', name: 'NAMING_RETRY_COOLDOWN_MS', gen: 'NAMING_RETRY_COOLDOWN_MS', key: 'namingRetryCooldownMs', kind: 'literal', note: '整份拼进界面闭包不能 import，永久 literal，只断言值相等' },
]

// ---------------------------------------------------------------------------
// 表二 TEXT：不能 import 的（未导出、函数内局部、调用点字面量）。
// snippet 是文件里今天的原样写法，count 是它在文件里的出现次数，value 是它代表的毫秒数。
// 文件里的数字变了 → 出现次数对不上；YAML 的值变了 → value 与生效值对不上。两边都锁。
// ---------------------------------------------------------------------------
interface TextRow {
  file: string
  snippet: string
  count: number
  value: number
  key: string
  kind: 'literal' | 'imported'
}
const TEXTS: TextRow[] = [
  { file: 'src/host/index.ts', snippet: 'const TIMEOUT_MS = 30000', count: 1, value: 30000, key: 'hostTimeoutMs', kind: 'literal' },
  { file: 'src/host/index.ts', snippet: 'const CACHE_MS = 60000', count: 1, value: 60000, key: 'snapshotCacheMs', kind: 'literal' },
  { file: 'src/deck/registration/register-options.ts', snippet: 'Math.floor(o.waitMs) : 2000', count: 1, value: 2000, key: 'registerRetryWaitMs', kind: 'literal' },
  // 入口文件（src/host/index.ts）禁静态 import 的那一处延迟启动：数字只能留在函数体里，
  // 这段写法在文件里只出现一次，改了数字或改了写法都会在这里判红。
  { file: 'src/host/index.ts', snippet: '}, 30000)', count: 1, value: 30000, key: 'hostBootDeferMs', kind: 'literal' },
  // —— 宿主侧“别名接中央常量”的那一批（第二轮全量收拢）——
  // 写法是 `const 本地名 = CENTRAL_某常量 ?? 原数字`：本地名不导出时 IMPORT 表比不了（那边比的是模块导出），
  // 所以走这张表——snippet 把「接的是哪个中央常量」与「缺表回落到哪个数字」一起锁住，
  // 任一处被改（换常量、改回落值、删掉回落）都对不上出现次数。value 仍是这一档的毫秒数。
  { file: 'src/host/versionControl.js', snippet: 'const RUN_TIMEOUT_MS = CENTRAL_VC_RUN_TIMEOUT_MS ?? 20000', count: 1, value: 20000, key: 'vcRunTimeoutMs', kind: 'literal' },
  { file: 'src/host/versionControlCheck.js', snippet: 'const CHECK_CALL_BUDGET_MS = CENTRAL_VC_CHECK_CALL_BUDGET_MS ?? 60000', count: 1, value: 60000, key: 'vcCheckCallBudgetMs', kind: 'literal' },
  { file: 'src/host/versionControlCheck.js', snippet: 'const LSFILES_TIMEOUT_MS = CENTRAL_VC_LSFILES_TIMEOUT_MS ?? 15000', count: 1, value: 15000, key: 'vcLsFilesTimeoutMs', kind: 'literal' },
  { file: 'src/host/versionControlCheck.js', snippet: 'const REMOTE_TIMEOUT_MS = CENTRAL_VC_REMOTE_TIMEOUT_MS ?? 5000', count: 1, value: 5000, key: 'vcRemoteTimeoutMs', kind: 'literal' },
  { file: 'src/host/versionControlWrite.js', snippet: 'const ADD_TIMEOUT_MS = CENTRAL_VC_ADD_TIMEOUT_MS ?? 15000', count: 1, value: 15000, key: 'vcAddTimeoutMs', kind: 'literal' },
  { file: 'src/host/versionControlWrite.js', snippet: 'COMMIT_TIMEOUT_MS = CENTRAL_VC_COMMIT_TIMEOUT_MS ?? 60000', count: 1, value: 60000, key: 'vcCommitTimeoutMs', kind: 'literal' },
  { file: 'src/host/versionControlWrite.js', snippet: 'PULL_TIMEOUT_MS = CENTRAL_VC_PULL_TIMEOUT_MS ?? 180000', count: 1, value: 180000, key: 'vcPullTimeoutMs', kind: 'literal' },
  { file: 'src/host/versionControlWrite.js', snippet: 'PUSH_TIMEOUT_MS = CENTRAL_VC_PUSH_TIMEOUT_MS ?? 120000', count: 1, value: 120000, key: 'vcPushTimeoutMs', kind: 'literal' },
  { file: 'src/host/versionControlWrite.js', snippet: 'FETCH_TIMEOUT_MS = CENTRAL_VC_FETCH_TIMEOUT_MS ?? 120000', count: 1, value: 120000, key: 'vcFetchTimeoutMs', kind: 'literal' },
  { file: 'src/host/gitCredentialExec.js', snippet: 'const CALL_BUDGET_MS = CENTRAL_GIT_CREDENTIAL_CALL_BUDGET_MS ?? 240000', count: 1, value: 240000, key: 'gitCredentialCallBudgetMs', kind: 'literal' },
  { file: 'src/host/gitCredentialExec.js', snippet: 'const MIN_BUDGET_MS = CENTRAL_GIT_CREDENTIAL_MIN_BUDGET_MS ?? 1000', count: 1, value: 1000, key: 'gitCredentialMinBudgetMs', kind: 'literal' },
  { file: 'src/host/gitCredentialExec.js', snippet: 'const MAX_BUDGET_MS = CENTRAL_GIT_CREDENTIAL_MAX_BUDGET_MS ?? 600000', count: 1, value: 600000, key: 'gitCredentialMaxBudgetMs', kind: 'literal' },
  { file: 'src/host/workspaceKey.js', snippet: 'const WORKSPACE_ROOT_TTL_MS = CENTRAL_WORKSPACE_ROOT_TTL_MS ?? 30000', count: 1, value: 30000, key: 'workspaceRootTtlMs', kind: 'literal' },
  { file: 'src/host/logStore.js', snippet: 'export const LOG_DEBOUNCE_MS = CENTRAL_LOG_WRITE_DEBOUNCE_MS ?? 1000', count: 1, value: 1000, key: 'logWriteDebounceMs', kind: 'literal' },
  { file: 'src/host/platform/namingSummary.js', snippet: 'const SUMMARY_TIMEOUT_MS = CENTRAL_NAMING_SUMMARY_TIMEOUT_MS ?? 30000', count: 1, value: 30000, key: 'namingSummaryTimeoutMs', kind: 'literal' },
  { file: 'src/host/namingGuardian.js', snippet: 'const NAMING_FALLBACK_MS = CENTRAL_NAMING_FALLBACK_INTERVAL_MS ?? 600000', count: 1, value: 600000, key: 'namingFallbackIntervalMs', kind: 'literal' },
  { file: 'src/host/skillProbeCache.js', snippet: 'export const SKILL_PROBE_CACHE_MS = CENTRAL_SKILL_PROBE_CACHE_MS ?? 10000', count: 1, value: 10000, key: 'skillProbeCacheMs', kind: 'literal' },
  // git 的 http.lowSpeedTime 只认秒，中央这一档写的是毫秒：这里锁住「除的是 1000」与「毫秒数」两件事，
  // 谁把除法改成别的、或把中央那一档改了，这一行都对不上。
  { file: 'src/host/gitCredentialExec.js', snippet: 'const LOW_SPEED_SECONDS = GIT_LOW_SPEED_TIMEOUT_MS / 1000', count: 1, value: 20000, key: 'gitLowSpeedTimeoutMs', kind: 'literal' },
  // —— 客户端“拼接常量缺席时退回原数字”的三处（第二轮全量收拢）——
  // 这三个界面文件会被门禁当普通模块直接 import 进来跑（那时构建时拼进闭包的常量并不存在，
  // 直接引用就是 ReferenceError，实测把 7 道门禁带红）。所以写法是
  // `typeof 常量 === 'number' ? 常量 : 原数字`：产品里走拼进来的中央值，门禁里走同一个数字，
  // 两边用的是不是同一个值，由下面这几行的片段与值一起锁住。
  { file: 'src/client/kernel/store-prefs.js', snippet: "'number' ? SYNC_ISSUE_CACHE_TTL_MS : 60000", count: 1, value: 60000, key: 'syncIssueCacheTtlMs', kind: 'literal' },
  { file: 'src/client/kernel/store-switch.js', snippet: "'number' ? STORE_SWITCH_CONFIRM_MS : 220", count: 1, value: 220, key: 'storeSwitchConfirmMs', kind: 'literal' },
  { file: 'src/client/kernel/api-new-session.js', snippet: "'number' ? CLIENT_SESSION_TICK_MS : 1000", count: 2, value: 1000, key: 'clientSessionTickMs', kind: 'literal' },
  { file: 'src/client/kernel/api-new-session.js', snippet: "'number' ? CLIENT_HANDOFF_DELAY_MS : 2000", count: 2, value: 2000, key: 'clientHandoffDelayMs', kind: 'literal' },
]

// ---------------------------------------------------------------------------
// 表三 CLIENT：界面半边要用的中央常量（走“构建时摘名字拼进闭包”那条路）。
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
  // 这几处是「SYNC 缺席时的兜底」，正常路径取 tracker/sync.js 里那份已锁的值，
  // 兜底这一支也改成吃拼进闭包的中央常量，界面上不再有第二份数字。
  { file: 'src/client/kernel/probe-auto.js', name: 'SYNC_FALLBACK_PROBE_MS', key: 'syncFallbackProbeMs' },
  { file: 'src/client/kernel/probe-auto.js', name: 'SYNC_FOCUS_PROBE_MIN_MS', key: 'syncFocusProbeMinMs' },
  { file: 'src/client/kernel/probe-auto.js', name: 'SYNC_SNAP_FRESH_MS', key: 'syncSnapFreshMs' },
  { file: 'src/client/kernel/store-prefs.js', name: 'SYNC_ISSUE_CACHE_TTL_MS', key: 'syncIssueCacheTtlMs' },
]

// ---------------------------------------------------------------------------
// 表四 EXEMPT：覆盖率扫描认出来、但刻意不入 YAML 的名字。每一行都要有理由，
// 理由写不清的就不该出现在这里——那是漏登记的参数，不是豁免。
// ---------------------------------------------------------------------------
interface ExemptRow {
  file: string
  name: string
  reason: string
}
const EXEMPTS: ExemptRow[] = [
  // —— budget.ts：非时间数字（点数、条数、单价、比例）与单位换算 ——
  { file: 'src/shared/refresh/src/budget.ts', name: 'HOUR_MS', reason: '单位换算（1 小时），不是旋钮，调它没有意义' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PREFLIGHT_RETRY_AFTER_FAILURE', reason: '次数（失败几次后不再复用预检），不是毫秒' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PLUGIN_SHARE_OF_REMAINING', reason: '比例，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PLUGIN_HOURLY_CAP', reason: '点数上限，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'READ_SHARE_OF_ALLOWANCE', reason: '比例，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'READ_HOURLY_CAP', reason: '点数上限，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'WRITE_RESERVED_SHARE', reason: '比例，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'WRITE_HOURLY_CAP', reason: '点数上限，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'TIER_GREEN_BELOW', reason: '比例阈值，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'TIER_RED_AT', reason: '比例阈值，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'MAX_ACTIVE_WORKSPACES', reason: '个数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'MAX_PAGES', reason: '页数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'AI_TOOL_MAX_POINTS_PER_CALL', reason: '点数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'AI_TOOL_MAX_REQUESTS_PER_CALL', reason: '条数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'AI_TOOL_MAX_POINTS_PER_HOUR', reason: '点数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'AI_TOOL_MAX_REQUESTS_PER_HOUR', reason: '条数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'AI_TOOL_MAX_CHILD_TICKETS_PER_CALL', reason: '个数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'AI_TOOL_SHARD_SIZE', reason: '个数（由上一条推导），不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'QUOTA_READ_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PROBE_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PREFLIGHT_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'CHAIN_EVAL_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PATCH_COST_POINTS_MIN', reason: '点数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PATCH_COST_POINTS_MAX', reason: '点数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PATCH_COST_REQUESTS', reason: '条数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PAGE_COST_POINTS', reason: '点数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PAGE_COST_POINTS_HALF', reason: '点数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PR_PAGE_COST_POINTS', reason: '点数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'SUB_ISSUES_PAGE_COST_POINTS', reason: '点数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'COUNT_COST_POINTS', reason: '点数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'LIST_PAGE_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'PR_PAGE_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'COUNT_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'REBUILD_PAGE_COUNT', reason: '页数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'REBUILD_PR_PAGE_COUNT', reason: '页数，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'REBUILD_COST_POINTS', reason: '点数（由页数与单价推导），不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'REBUILD_COST_REQUESTS', reason: '条数（由页数与单价推导），不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'WRITE_EVENT_COST_REQUESTS', reason: '条数单价，不是时间' },
  { file: 'src/shared/refresh/src/budget.ts', name: 'SWITCH_COST_REQUESTS', reason: '条数单价（由探针单价推导），不是时间' },
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
  { file: 'src/host/refresh/wiring.ts', name: 'DECK_ENSURE_TIMEOUT_MS', reason: '别名，取共用调参表的 TUNING.deckEnsureTimeoutMs（已登记为 deckEnsureMs，值由本门禁看守一致），缺表回落 15000；引用即跟随' },
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
  { file: 'src/host/platformChannel.ts', name: 'timeoutMs', reason: '透传变量，接注入的 TIMEOUT_MS（已登记，上游是 hostTimeoutMs）' },
  { file: 'src/host/refresh/chain-ride.ts', name: 'nowMs', reason: '测试注钟口（生产用 Date.now），不是可调参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'lingerMs', reason: '注入字段的本地接住（上游是 ACTIVE_LINGER_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'expiryMs', reason: '注入字段的本地接住（上游是 ATTENTION_EXPIRY_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'probeMs', reason: '注入字段的本地接住（上游是 PROBE_INTERVAL_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'lingerProbeMs', reason: '注入字段的本地接住（上游是 PROBE_INTERVAL_LINGER_MS），不是新参数' },
  { file: 'src/shared/refresh/src/attention.ts', name: 'lingerDelayMs', reason: '算出来的剩余等待（lingerMs 减已流逝），不是输入参数' },
  { file: 'src/shared/refresh/src/backoff.ts', name: 'MIN_BACKOFF_STEPS', reason: '步数下限（次数），不是毫秒' },
  { file: 'src/shared/refresh/src/backoff.ts', name: 'evaluatedAtMs', reason: '状态里的时间戳（上次求值时刻），不是可调参数' },
  { file: 'src/shared/refresh/src/backoff.ts', name: 'waitMs', reason: '算出来的等待结果（verdict 的输出），不是输入参数' },
  // —— 存量 JavaScript（票 #1215 全量收拢把覆盖率扫描从 .ts 扩到 .js 后新捞出来的）——
  // 分三类：测量值与时刻（调 YAML 改不了它）、状态字段与初值（0 表示“还没有”）、
  // 透传变量（值由调用方按已登记参数装进来）。
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'intervalMs', reason: '心跳状态的初值字段（0 = 还没定下节拍），真值由刷新预算的 PROBE_INTERVAL_MS 注入，不是新参数' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'lingerMs', reason: '同上，真值由刷新预算的 PROBE_INTERVAL_LINGER_MS 注入' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'atMs', reason: '心跳时刻的初值字段（0 = 还没跳过），不是可调参数' },
  { file: 'src/client/kernel/attention-heartbeat.js', name: 'latencyMs', reason: '测量用局部变量（一次回话的耗时），不是可调参数' },
  { file: 'src/client/kernel/log.js', name: 'windowMs', reason: '算出来的时间差（距上次汇总过了多久），不是可调参数' },
  { file: 'src/client/kernel/probe-auto.js', name: 'gateMs', reason: '派生变量，缺省接本文件顶部的 FOCUS_PROBE_MIN_MS（已登记），不是新参数' },
  { file: 'src/client/kernel/probe-select.js', name: '_incMs', reason: '从快照里读出的时刻（那份快照是什么时候生成的），不是可调参数' },
  { file: 'src/client/kernel/probe-select.js', name: '_curMs', reason: '同上' },
  { file: 'src/client/kernel/probe-select.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/kernel/probe-snapshot.js', name: 'timeOfMs', reason: '函数名（把时刻格式化成给人看的文字），不是时间参数' },
  { file: 'src/client/kernel/probe-snapshot.js', name: '_waitMs', reason: '别名，接本文件已登记的 SNAP_WAIT_MS，引用即跟随' },
  { file: 'src/client/kernel/probe-snapshot.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/kernel/router.js', name: 'fitMs', reason: '滚动位置回正的状态字段，不是时间参数' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'cacheMs', reason: '从快照里读出的生成时刻，不是可调参数' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'incomingMs', reason: '同上' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'curMs', reason: '同上' },
  { file: 'src/client/kernel/store-snapshot.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/kernel/store-switch.js', name: '_hadToWait', reason: '布尔判断结果（这一步有没有等过），不是时间参数' },
  { file: 'src/client/statusbar/checksums.js', name: '_probeMs', reason: '读出来的探测时刻，不是可调参数' },
  { file: 'src/client/statusbar/StatusLogMenu.js', name: 'latencyMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/client/views/shared/truthLines.js', name: 'TRUTH_MINUTE_MS', reason: '单位换算（1 分钟），不是旋钮，调它没有意义' },
  { file: 'src/client/views/shared/truthLines.js', name: 'ageMs', reason: '算出来的时间差（距今多久），不是可调参数' },
  { file: 'src/client/views/versionControl/vcBlocks.js', name: 'nowMs', reason: '读钟时刻（Date.now），不是可调参数' },
  { file: 'src/host/gitCredentialExec.js', name: 'elapsedMs', reason: '测量用局部变量（耗时），不是可调参数' },
  { file: 'src/host/gitCredentialExec.js', name: 'timeoutMs', reason: '透传参数，缺省接 GIT_CREDENTIAL_PROBE_TIMEOUT_MS（已登记）' },
  { file: 'src/host/platform/issueIndexWindow.js', name: 'startedMs', reason: '读钟时刻（这趟扫描什么时候开始的），不是可调参数' },
  { file: 'src/host/platform/issueIndexWindow.js', name: 'nextWatermarkMs', reason: '算出来的下一个水位时刻，不是可调参数' },
  { file: 'src/host/platform/issueIndexWindow.js', name: 'watermarkMs', reason: '上次扫到哪儿的时刻（状态字段），不是可调参数' },
  { file: 'src/host/refresh/attention.js', name: 'humanMs', reason: '读出来的「人最后一次动键盘鼠标」的时刻，不是可调参数' },
  { file: 'src/host/refresh/chainBackoff.js', name: 'waitMs', reason: '算出来的等待结果（退避结论的输出），不是输入参数' },
  { file: 'src/host/refresh/patch.js', name: 'scanStartedMs', reason: '读钟时刻（这趟核对什么时候开始的），不是可调参数' },
  { file: 'src/host/refresh/patch.js', name: 'sinceMs', reason: '算出来的起点时刻（上次水位减容差），不是可调参数' },
  { file: 'src/host/skillProbeCache.js', name: 'ttlMs', reason: '透传参数，缺省接 SKILL_PROBE_CACHE_MS（已登记，值由本门禁看守）' },
  { file: 'src/host/skillProbe.js', name: 'SKILL_CACHE_TTL_MS', reason: '函数内局部变量：接线给了正数就听接线的，没给时取中央常量 SKILL_LIST_CACHE_TTL_MS（已登记为 skillListCacheTtlMs，值由本门禁看守）' },
  { file: 'src/host/tracker/snapshot.js', name: 'snapshotTtl', reason: '透传参数，缺省接 SNAPSHOT_TTL_MS（已登记为 snapshotTtlMs）' },
  { file: 'src/host/tracker/snapshot.js', name: 'depsTtl', reason: '同上' },
  { file: 'src/host/versionControl.js', name: 'timeoutMs', reason: '透传参数，缺省接本文件已登记的 RUN_TIMEOUT_MS' },
  { file: 'src/host/versionControl.js', name: 'graceMs', reason: '透传参数，缺省接 PROC_GRACE_MS（已登记为 procGraceMs）' },
  { file: 'src/shared/naming-tracking.js', name: 'NAMING_HINT_GRACE_MS', reason: '值为 0 表示不宽限（把这个宽限窗关掉），不是可调时长' },
  { file: 'src/shared/tracker/indexWindow.js', name: 'sinceMs', reason: '算出来的起点时刻（水位减容差），不是可调参数' },
  // —— 派生变量：正常路径取 SYNC 契约里的同名项（已登记、值由本门禁看守），
  //    兜底取拼进闭包的中央常量；两条路都落在同一份 YAML 上，所以不需要第二把锁 ——
  { file: 'src/client/kernel/probe-auto.js', name: 'PROBE_MS', reason: '派生变量，取 SYNC.FALLBACK_PROBE_MS（已登记为 syncFallbackProbeMs），兜底取 SYNC_FALLBACK_PROBE_MS（拼进闭包的中央常量）；引用即跟随' },
  { file: 'src/client/kernel/probe-auto.js', name: 'FOCUS_PROBE_MIN_MS', reason: '派生变量，取 SYNC.FOCUS_PROBE_MIN_MS（已登记为 syncFocusProbeMinMs），兜底取 SYNC_FOCUS_PROBE_MIN_MS；引用即跟随' },
  { file: 'src/client/kernel/probe-auto.js', name: 'SNAP_FRESH_MS', reason: '派生变量，取 SYNC.SNAP_FRESH_MS（已登记为 syncSnapFreshMs），兜底取 SYNC_SNAP_FRESH_MS；引用即跟随' },
  { file: 'src/client/kernel/store-prefs.js', name: 'ISSUE_CACHE_TTL', reason: '派生变量，取 SYNC.ISSUE_CACHE_TTL（已登记为 syncIssueCacheTtlMs），兜底取 SYNC_ISSUE_CACHE_TTL_MS；引用即跟随' },
]

// 时间味判定：下划线写法看整段（_MS / _TTL / _INTERVAL / _EXPIRY / _BACKOFF / _WAIT / _WINDOW / _AGE），
// 驼峰写法只认结尾（…Ms / …Ttl / …Interval / …）。子串匹配会把 settleSwitchCard 这种
// 含 'ttl' 的名字误伤（StatusBackend.ts 的教训），所以驼峰必须顶到结尾。
const TIMEISH_RE = /(_MS|_TTL|_INTERVAL|_EXPIRY|_BACKOFF|_WAIT|_WINDOW|_AGE|KEEP_ALIVE)(_|$)|(Ms|Ttl|Interval|Expiry|Backoff|Wait|Window|Age)$|^ttl$/
function timeishLike(name: string): boolean {
  return TIMEISH_RE.test(name)
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  // 后面不能紧跟数字：否则 'timeout: 3000' 会把 'timeout: 30000' 也数进去（github/init-project.ts 的教训）。
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\d)', 'g')
  return haystack.match(re)?.length || 0
}

async function main(): Promise<void> {
  // —— 第零节：本门禁在验证链上有位置（改了链却没带上自己，等于没看门） ——
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: { verify?: string } }
  check(String((pkg.scripts && pkg.scripts.verify) || '').includes('verify-time-config.ts'), '本门禁已挂进 npm run verify 链')

  // —— 第一节：生成新鲜度（调了 YAML 忘跑生成器，在这里判红） ——
  const gen = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-time-config.mjs'), '--check'], { encoding: 'utf8' })
  check(gen.status === 0, '生成源码与 config/ 下的三份时间参数文件一致' + (gen.status === 0 ? '' : '（' + String((gen.stdout || '') + (gen.stderr || '')).trim().split('\n')[0] + '）'))

  // —— 第二节：值一致 ——
  const timeMod = (await import(TIME_CONFIG_JS)) as {
    TIME_YAML: Record<string, unknown>
    TIME_FALLBACKS: Record<string, unknown>
  } & Record<string, unknown>
  for (const row of IMPORTS) {
    const eff = effective(row.key, timeMod.TIME_YAML, timeMod.TIME_FALLBACKS)
    let mod: Record<string, unknown>
    try {
      mod = (await import(pathToFileURL(path.join(ROOT, row.file.replace(/\.ts$/, '.js'))).href)) as Record<string, unknown>
    } catch (e) {
      check(false, row.file + ' 载入失败，IMPORT 行无从比对：' + String((e as Error).message).split('\n')[0])
      continue
    }
    if (row.name.includes('.')) {
      const [objName, prop] = row.name.split('.')
      const obj = mod[objName] as Record<string, unknown> | undefined
      if (row.kind === 'imported') {
        check(false, row.file + ' 的 ' + row.name + ' 还不支持 imported 形态（对象属性无从引用相等），先保持 literal')
        continue
      }
      check(!!obj && eqValue(obj[prop], eff), row.file + ' 的 ' + row.name + ' == YAML 生效值 ' + JSON.stringify(eff))
      continue
    }
    if (row.kind === 'imported') {
      // imported 形态断言的是“就是同一个东西”：数字比值相等，数组比引用相等（同一个对象才算真导入，不是抄的数字）
      // 判红时先重跑一次构建再看：imported 读的是域构建产物（values.js），只改 YAML、只跑生成器、
      // 没跑构建时产物是旧的，这里的值会对不上（admission.ts 引 tuning.js 同例）。
      const same = Array.isArray(eff) ? mod[row.name] === timeMod[row.gen] : eqValue(mod[row.name], eff)
      check(same, row.file + ' 的 ' + row.name + ' 与 time-config 的 ' + row.gen + ' 是同一份值（真导入，不是抄的数字）' + (same ? '' : '（先重跑构建排除产物过期）'))
      continue
    }
    check(eqValue(mod[row.name], eff), row.file + ' 的 ' + row.name + ' == YAML 生效值 ' + JSON.stringify(eff))
  }
  for (const row of TEXTS) {
    const eff = effective(row.key, timeMod.TIME_YAML, timeMod.TIME_FALLBACKS)
    if (row.kind === 'imported') {
      check(false, row.file + ' 的 TEXT 行 kind 不该是 imported（字面行迁完就该删，而不是翻转）')
      continue
    }
    let text: string
    try {
      text = fs.readFileSync(path.join(ROOT, row.file), 'utf8')
    } catch (e) {
      check(false, row.file + ' 读不到，TEXT 行无从比对')
      continue
    }
    const n = countOccurrences(text, row.snippet)
    check(n === row.count, row.file + ' 里 “' + row.snippet + '” 出现 ' + row.count + ' 次（实测 ' + n + ' 次）')
    check(eff === row.value, row.key + ' 的 YAML 生效值是 ' + String(eff) + '（本行锁的是 ' + row.value + '）')
  }

  // —— 第三节：界面半边拿不拿得到值（values.ts 有、构建名单有、界面文件真在用） ——
  const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8')
  const namesBlock = buildSrc.match(/const CLIENT_TIME_NAMES = \[([\s\S]*?)\]/)
  const splicedNames = new Set((namesBlock ? namesBlock[1].match(/'[A-Za-z0-9_]+'/g) || [] : []).map((s) => s.slice(1, -1)))
  check(splicedNames.size > 0, '读到了 scripts/build.mjs 的界面拼接名单 CLIENT_TIME_NAMES（' + splicedNames.size + ' 个名字）')
  const clientUsed = new Set<string>()
  for (const row of CLIENTS) {
    clientUsed.add(row.name)
    const eff = effective(row.key, timeMod.TIME_YAML, timeMod.TIME_FALLBACKS)
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

  // —— 第三节：覆盖率（src/ 下新冒出来的时间常量，必须先登记） ——
  const ls = spawnSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
  check(ls.status === 0, 'git ls-files 可用（覆盖率扫描的前置条件）')
  const known = new Map<string, Set<string>>()
  const addKnown = (file: string, name: string) => {
    if (!known.has(file)) known.set(file, new Set())
    known.get(file)!.add(name)
  }
  for (const row of IMPORTS) {
    const dot = row.name.indexOf('.')
    addKnown(row.file, dot < 0 ? row.name : row.name.slice(0, dot))
    // TUNING.deckEnsureTimeoutMs 这种“导出名.属性”写法：属性名也要登记，
    // 否则覆盖率扫描会在对象字面量里把它当新参数捞出来。
    if (dot >= 0) addKnown(row.file, row.name.slice(dot + 1))
  }
  for (const row of TEXTS) {
    const mc = row.snippet.match(/const\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
    if (mc) addKnown(row.file, mc[1])
    // 字面量是对象属性写法（例如 snapshotTtl: 5000）时，属性名也要登记，否则覆盖率会把它当新参数。
    const mp = row.snippet.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/)
    if (mp) addKnown(row.file, mp[1])
    // 字面量只是表达式片段（例如 Math.floor(d.cooldownMs) : 60000）时，里面时间味的名字也要登记。
    for (const mt of row.snippet.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      if (timeishLike(mt[1])) addKnown(row.file, mt[1])
    }
  }
  const exempt = new Map<string, Map<string, string>>()
  for (const row of EXEMPTS) {
    if (!exempt.has(row.file)) exempt.set(row.file, new Map())
    exempt.get(row.file)!.set(row.name, row.reason)
  }
  const timeish = TIMEISH_RE
  const declRe = /^[ \t]*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]/gm
  const propRe = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\d[\d_]*(\s*\*\s*\d[\d_]*)*\s*[,}]/g
  // .ts 与 .js 一起扫：本仓手写代码正在“动到谁就转成 TS”，两种后缀并存期间，
  // 只扫 .ts 等于给存量 JavaScript 开了后门（漏登记的时间常量会一直漏下去）。
  const files = String(ls.stdout || '').split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.ts') || s.endsWith('.js'))
  let scanned = 0
  for (const file of files) {
    // 生成文件自己不参检：src/shared/time-config/src/values.ts 的每一项导出就是 YAML 的键，
    // 它由第一节的新鲜度看守，不需要第二份登记。把它也扫进去会自己告自己（S2 踩过）。
    if (file === 'src/shared/time-config/src/values.ts') continue
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const names = new Set<string>()
    for (const m of text.matchAll(declRe)) {
      if (timeish.test(m[1])) names.add(m[1])
    }
    // 对象字面量里的属性（例如 TUNING = { deckEnsureTimeoutMs: 15000 }）不在 const 声明里，单列一条捞出来。
    for (const m of text.matchAll(propRe)) {
      if (timeish.test(m[1]) && /ms|ttl|interval|expiry|wait|age|window/i.test(m[1])) names.add(m[1])
    }
    if (names.size === 0) continue
    scanned++
    for (const name of names) {
      if (known.get(file) && known.get(file)!.has(name)) continue
      const why = exempt.get(file) && exempt.get(file)!.get(name)
      check(!!why, file + ' 的 ' + name + (why ? ' 豁免（' + why + '）' : ' 未登记：新时间常量必须先入 YAML（IMPORT/TEXT 表）或写明豁免理由（EXEMPTS 表）'))
    }
  }
  check(scanned > 0, '覆盖率扫描走完了全部 src/**/*.ts 与 .js（命中时间常量的文件 ' + scanned + ' 个）')

  if (failed) process.exit(1)
  console.log('PASS 中央时间参数门禁全绿')
}

main().catch((e) => {
  console.log('  FAIL 门禁自己跑崩了：' + String((e && (e as Error).message) || e).split('\n')[0])
  process.exit(1)
})
