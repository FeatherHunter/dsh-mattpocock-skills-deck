# 时间参数中央 YAML：TS 侧完整清单（建档）

> 后补（第二轮落地之后）：本清单列的 TS 值已全部收进中央配置，时间参数并按类别分成了三份
> （`config/timeouts.yaml` 超时上限、`config/intervals.yaml` 间隔与延时、`config/ttl.yaml` 有效期），
> 存量 JavaScript 与界面半边也一并收了进来。现状、口径与门禁以
> `docs/adr/20261016-time-config-yaml.md` 为准；本文只是第一轮的建档记录，下面「只改 TS、JS 一律不动」
> 那句已作废。

> 目标：`config/timeouts.yaml` 收拢下面所有值。单位毫秒。本清单只建档，不改值。
> 口径：TS 文件里的超时 / 间隔 / 有效期 / 退避 / 等待 / 防抖。纯界面动画闪停（`views/*.ts` 的 600/1300/1500 等）
> 单列第 7 组，是否入 YAML 由定版方案裁决。`.js` 文件一律不动（用户决断 4）。

## 1. 出站分档（tracker 内核， rooms 共享）

- `src/tracker/kernel/outbound-tiers.ts:15-20`：`READ_TIMEOUT_MS=12000`、`WRITE_TIMEOUT_MS=30000`、`PROBE_TIMEOUT_MS=3000`、`DEFAULT_TIMEOUT_MS=30000`（#969 暂定值，注释写明终值等 #967）
- `src/tracker/registry/core.ts:44`：`MATCHES_TIMEOUT_MS=30000`（超时视作 pending）
- `src/tracker/detection/workspaceStore.ts:43`：`DEFAULT_TTL=30000`
- `src/tracker/rooms/github/client.ts:112`：`TIMEOUT_MS=30000`（兜底）；`:226` 探活 `timeout: 3000`；`:283` 默认按 `timeoutForGhArgs` 分档
- `src/tracker/rooms/github/backend.ts:80`、`repo.ts:125,135`、`init-project.ts:130`：`timeout: 3000`（git 探活直写）；`init-project.ts:111`：`timeout: 30000`
- `src/tracker/rooms/gitlab/`：命名常量 `sub-issues.ts:55 READ 8000`、`labels-ops.ts:105 GLAB 8000`、`index.ts:72 GIT_FALLBACK 2000`、`create-write.ts:35 CREATE 8000`、`pages.ts:67 TIMEOUT 10000`、`counts.ts:52 TIMEOUT 10000`；调用点直写约 25 处：`8000`（issues/graph/comments/labels/membership/blocking 多文件）、`5000`（graph-blocking:532、graph-membership:162、preflight:79,111）、`10000`（idempotency:166、issues:142）、`3000`（repo.ts:118）、`60000`（init-project:296 建仓）

## 2. 节拍与额度（共享刷新域，唯一真源 budget.ts）

- `src/shared/refresh/src/budget.ts`：`PROBE_INTERVAL_MS=5000`、黄档 `120000`、linger `15000`、重建黄档最小间隔 `300000`、对账 `10*60000`、预检寿命 `10*60000`、退避 `[8000,30000,2*60000,5*60000]`、半开 `5*60000`、全绿 `30*60000`、合并窗口 `10000`、推迟过期 `5*60000`、活跃余温 `30000`、心跳 `20000`、视野失效 `90000`、额度同步 `60000`、新鲜度黄 `5*60000`／红 `30*60000`（另有 `HOUR_MS` 单位换算，不入 YAML）
- `src/shared/refresh/src/tuning.ts:36-40`：`readBucketMax=64`、`writeBucketMax=16`（非时间，不入）、`deckEnsureTimeoutMs=15000`（`wiring.js:39-40` 另有 `DECK_EXPLICIT_TIMEOUT_MS=5000`，JS 不动）
- `src/shared/version-control/src/write-ticket.ts:16`：`TICKET_TTL_MS=120000`
- `src/host/refresh/chain-ride.ts:18`：`CHAIN_RIDE_MAX_AGE_MS=30000`

## 3. deck 工具壳

- 九个工具文件 `SANDBOX_TIMEOUT_MS=5000`（map-snapshot:27、map-plan-create:78、map-link:25、issue-report:27、issue-patch:26、issue-list:78、issue-get:23、issue-create:31、context:25）；`STORE_TIMEOUT_MS=10000`（map-plan-create:78）；`HOOK_TIMEOUT_MS=5000`（issue-report:28、issue-create:32）
- `src/deck/shell/call-budget.ts:25/28/30`：`DEFAULT_TOOL_TIMEOUT_MS=300000`、`DEFAULT_TOOL_MARGIN_MS=15000`、`DEFAULT_PER_OP_TIMEOUT_MS=30000`
- `src/deck/registration/register-options.ts:39`：`AGENT_TOOL_TIMEOUT_MS=300000`（零 import 约束，见该文件 `:37` 注释；与上一条同值由 `tests/verify-895-bulk-deadline.ts:300-303` 看守）
- `src/deck/rules/anchor.ts:21`：`ANCHOR_WINDOW_MS=300000`
- `src/deck/shell/write-mutex.ts:47`：`DEFAULT_KEY_LOCK_TIMEOUT_MS=60000`
- `src/deck/shell/session-workdir.ts:69`：`CANONICAL_TIMEOUT_MS=5000`
- `src/deck/shell/in-flight-lease.ts:24`：`KEEP_ALIVE_MS=2147483647`（保活哨兵，非常值，入 YAML 时需标注不可调）
- `src/deck/shell/plan-cursor.ts:106`：游标默认 `7*24*3600*1000`
- `src/deck/registration/host-assemble.ts:88`：`DECK_ASSEMBLY_TIMEOUT_MS=8000`
- `src/deck/registration/agent-row.ts:69-70`：`BRIDGE_DRY_TABLE_WAIT_MS=8000`、`DELEGATED_CELL_WAIT_MS=25000`

## 4. 宿主接线（TS）

- `src/host/index.ts:39/41`：`TIMEOUT_MS=30000`、`CACHE_MS=60000`（经 deps 注入 git-process / platformChannel / versionControl，改一处全链生效）
- `src/host/platformChannel.ts:150`：`STATUS_CACHE_MS=30000`
- `src/host/sessionSnapshot.ts:162,306`、`src/host/sessionRefresh.ts:122,282`：`snapshotTtl: 5000`（四处同值）

## 5. 客户端 TS

- `src/client/kernel/api-io.ts:440`：`MAP_TICKETS_TTL=60*1000`；`:153/157-158` 调度延迟 `120`／`0`（调度节拍，非超时语义，待裁决）
- `src/client/kernel/settings-debug.ts:41`：`SETTINGS_DEBUG_PUSH_WAIT_MS=5000`（client 吃共享值走构建 splice，见 `build.mjs:601` 的 refreshBudget 先例）

## 6. 非时间数字（明确不入）

`HOUR_MS`、`AI_TOOL_*` 点数与条数、`MAX_PAGES`、`TIER_*` 比例、`PLUGIN_*` 额度、`PAGE_COST_*` 单价、`REBUILD_PAGE_COUNT`、`readBucketMax/writeBucketMax`、`PREFLIGHT_RETRY_AFTER_FAILURE` 次数、`KEEP_ALIVE` 另议（第 3 组已注）。

## 7. 纯界面闪停（`.ts`，是否入 YAML 待定版裁决）

`IssueDetailComments.ts:64` 的 `1500`／`:128` 的 `600`、`IssueDetail.ts:59` 的 `3000`。

## 硬约束（定版必须回答）

1. `npm test = typecheck → build → verify`：typecheck 先于 build，生成物不进 git 则引用方在检查期断腿；`typecheck.mts` 以 git 跟踪文件做覆盖对账。
2. `register-options.ts:37` 零 import 约束：双生子不能 import 新域。
3. 客户端无运行时 import：共享值进闭包走构建 splice（`build.mjs:595-605` 十一份先例）。
4. 房间可引 `^src/shared/`（`tests/tracker-room-imports.json:7`，#1159），无需改 allowlist。
5. `yaml@^2.9.1` 已是正式依赖（`package.json:31`），无需加包。
