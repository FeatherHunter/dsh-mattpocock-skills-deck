// verify-time-config.ts —— 中央时间参数门禁（票 #1215 立）。
//
// 为什么要有这扇门禁：
//   全仓 TypeScript 时间参数的唯一书写处是 config/timeouts.yaml（人改的唯一地方），
//   生效处是 src/shared/time-config/src/values.ts（生成器写出的，见
//   scripts/generate-time-config.mjs）。这扇门禁看守三件事，缺一件都会让“中央”二字落空：
//   ① 生成新鲜度：values.ts 必须与今天的 YAML 对得上（调了 YAML 忘跑生成器，在这里判红）；
//   ② 值一致：每个调用方文件里的数字（能 import 的按导出比，不能 import 的按源码字面比）
//      必须等于 YAML 生效值（改了一边没改另一边，在这里判红）；
//   ③ 覆盖率：src/ 下新冒出来的时间常量必须先登记（绕过 YAML 直接写数字，在这里判红）。
//
// 为什么分“能 import 的”与“不能 import 的”：
//   有些文件有零导入约束（src/deck/registration/register-options.ts:37，
//   本文件不引用其他层的文件），有些值藏在函数内部（src/host/index.ts 的 TIMEOUT_MS），
//   有些只是调用点的字面量（GitLab 房二十多处 { timeout: 8000 }）。硬要它们 import，
//   等于逼着改架构；所以前者按模块导出比（IMPORT 表），后者按源码字面出现次数比
//   （TEXT 表）。两种表的每一行都同时锁死“文件里的写法”与“YAML 的生效值”，
//   任何一边漂移都判红。
//
// 迁移中的状态机（#1215 分六片落地）：
//   每一行的 kind 只有两种：'literal'（文件里还是自己写的数字，门禁断言“相等”）与
//   'imported'（文件已经改成从 time-config 导入，门禁断言“就是同一个导出”，数组用引用相等）。
//   切片落地时把对应行翻成 'imported'，删掉 TEXT 行。永远保持 'literal' 的只有四处，
//   它们不是没迁完，是架构上不能迁，理由写在各自的 note 里：
//   budget.ts（共享域之间不许互相 import）、tuning.ts（同上）、
//   write-ticket.ts（同上）、register-options.ts（零导入约束，见上）。

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
  { file: 'src/host/refresh/chain-ride.ts', name: 'CHAIN_RIDE_MAX_AGE_MS', gen: 'CHAIN_RIDE_MAX_AGE_MS', key: 'chainRideMaxAgeMs', kind: 'imported' },
  { file: 'src/deck/shell/call-budget.ts', name: 'DEFAULT_TOOL_TIMEOUT_MS', gen: 'TOOL_TIMEOUT_MS', key: 'toolTimeoutMs', kind: 'imported' },
  { file: 'src/deck/shell/call-budget.ts', name: 'DEFAULT_TOOL_MARGIN_MS', gen: 'TOOL_MARGIN_MS', key: 'toolMarginMs', kind: 'imported' },
  { file: 'src/deck/shell/call-budget.ts', name: 'DEFAULT_PER_OP_TIMEOUT_MS', gen: 'PER_OP_TIMEOUT_MS', key: 'perOpTimeoutMs', kind: 'imported' },
  { file: 'src/deck/registration/register-options.ts', name: 'AGENT_TOOL_TIMEOUT_MS', gen: 'TOOL_TIMEOUT_MS', key: 'toolTimeoutMs', kind: 'literal', note: '零导入约束（该文件 :37 注释），永久 literal；双生子同值另由 tests/verify-895-bulk-deadline.ts 第⑦节看守' },
  { file: 'src/deck/rules/anchor.ts', name: 'ANCHOR_WINDOW_MS', gen: 'ANCHOR_WINDOW_MS', key: 'anchorWindowMs', kind: 'imported' },
  { file: 'src/deck/shell/write-mutex.ts', name: 'DEFAULT_KEY_LOCK_TIMEOUT_MS', gen: 'KEY_LOCK_TIMEOUT_MS', key: 'keyLockMs', kind: 'imported' },
  { file: 'src/deck/registration/host-assemble.ts', name: 'DECK_ASSEMBLY_TIMEOUT_MS', gen: 'DECK_ASSEMBLY_TIMEOUT_MS', key: 'deckAssemblyMs', kind: 'imported' },
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
  { file: 'src/client/kernel/api-io.ts', snippet: 'const MAP_TICKETS_TTL = 60 * 1000', count: 1, value: 60000, key: 'mapTicketsTtlMs', kind: 'literal' },
  { file: 'src/client/kernel/settings-debug.ts', snippet: 'const SETTINGS_DEBUG_PUSH_WAIT_MS = 5000', count: 1, value: 5000, key: 'settingsDebugPushWaitMs', kind: 'literal' },
  { file: 'src/deck/registration/register-options.ts', snippet: 'Math.floor(o.waitMs) : 2000', count: 1, value: 2000, key: 'registerRetryWaitMs', kind: 'literal' },
]

// ---------------------------------------------------------------------------
// 表三 EXEMPT：覆盖率扫描认出来、但刻意不入 YAML 的名字。每一行都要有理由，
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
  check(gen.status === 0, '生成源码与 config/timeouts.yaml 一致' + (gen.status === 0 ? '' : '（' + String((gen.stdout || '') + (gen.stderr || '')).trim().split('\n')[0] + '）'))

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
  const files = String(ls.stdout || '').split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.ts'))
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
  check(scanned > 0, '覆盖率扫描走完了全部 src/**/*.ts（命中时间常量的文件 ' + scanned + ' 个）')

  if (failed) process.exit(1)
  console.log('PASS 中央时间参数门禁全绿')
}

main().catch((e) => {
  console.log('  FAIL 门禁自己跑崩了：' + String((e && (e as Error).message) || e).split('\n')[0])
  process.exit(1)
})
