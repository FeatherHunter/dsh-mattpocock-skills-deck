# #749 面板打开后还在跑的定时器与数据流清单

> 子票归属：地图 #747「右侧面板打开时对话框输入卡顿的深度调查」。
> 本票问题：面板打开后，面板自己在后台还在做哪些定时做的事？这些事是否和人在对话框里打字抢同一条主线程，从而把输入拖慢？
> 方法：只读代码文档，不改生产代码，不跑实测。有实测数字的给出处与数字，查不到的一律写「没查到／没量到」。

## 核心结论（先说答案）

1. 面板打开后，界面侧长期存活的定时器只有两条：**活跃探测循环**（绿档 5 秒一跳，只探正在看的那一个工作区）和**视野心跳**（20 秒一次，只上报事实、不引发探测）。兜底探针（60 秒）是安全网，有活跃循环时基本不额外起请求。三条数字的真源分别是 `src/shared/refresh/budget.js`（5 秒／15 秒／20 秒）与 `src/shared/tracker/sync.js`（60 秒）。
2. 宿主侧面板打开后没有「每个后台工作区各一条定时器」这种东西。不变量 I2（后台零定时器）在代码层面成立：不在活跃集合里的工作区一个探测定时器都没有，唯一的例外是刚离开的那个工作区最多保留 30 秒收尾节拍，到点归零（`tests/verify-attention-model.js` 逐段断言）。
3. 但「后台零定时器」不等于「后台零网络」：全局性的配额同步（60 秒一次）、整池对账（10 分钟一次）、命名守护 10 分钟兜底（每次只轮转扫 1 个仓库）、写事件触发的取数（10 秒合并窗口）都会起外部 `gh` 命令，且与输入跑在同一条 JS 主线程的事件循环里。从代码结构看，**输入卡的那一刻，后台任务完全可能正在跑**；但本票没有实测，两者是否同峰写的是「没量到」，第 4 章给了开关对照的做法。

## 1. 面板打开后面板自己在跑的东西（一览表）

| # | 任务 | 间隔 | 单次耗时 | 是否起外部命令 | 代码位置 |
|---|---|---|---|---|---|
| A1 | 活跃探测循环（只探正在看的工作区） | 绿档 5 秒；刚离开收尾档 15 秒；黄档 120 秒；红档停（间隔为 null） | 没量到（单次为 1 次轻量 REST 探测 `wf.probe`，changed 才跟一次补量；整池重建耗时没量到） | 是（`wf.probe` → 宿主起 `gh`；补量走薄查询或整池，见 A4） | 间隔真源 `src/shared/refresh/budget.js:2-4`（`PROBE_INTERVAL_MS=5e3`、`PROBE_INTERVAL_YELLOW_MS=12e4`、`PROBE_INTERVAL_LINGER_MS=15e3`）；档位映射 `src/shared/refresh/policy.js:39-65`（`degradePlanFor`）；循环本体 `src/client/kernel/probe-auto.js:189-216`（`startActiveProbeLoop`，`timer.interval(step, _attentionPlan.intervalMs)`）；三条件门（面板可见＋`standing==='active'`＋距上次满一个间隔）同文件 `:197-206` |
| A2 | 兜底探针（`startAutoProbe` 的 `setInterval` 安全网） | 60 秒（`FALLBACK_PROBE_MS`）；页签隐藏时跳过发起；回到前台走 focus 探针 | 没量到（与 A1 同一 `probeNow`，单次 1 次 REST；耗时没量到） | 是（同 A1） | `src/shared/tracker/sync.js:53`（`FALLBACK_PROBE_MS: 60000`）；派生 `src/client/kernel/probe-auto.js:15`（`PROBE_MS`）；循环 `:157-180`；跨 reload 清旧 timer `:160-171` |
| A3 | 焦点／可见性探针（回到前台那一下） | 限流 60 秒（`FOCUS_PROBE_MIN_MS`）；#707 起按活跃间隔判（正在看 5 秒那档优先） | 没量到 | 是（触发一次 `probeNow(true)`） | `src/shared/tracker/sync.js:55`；`src/client/kernel/probe-auto.js:16,21-30`（`probeNow(fromFocus)` 的 `gateMs`）；监听 `:172-179`（`focus`＋`visibilitychange` 双恢复通道） |
| A4 | 快照校验（缓存还算不算当前） | 跟随每次探测／打开／刷新触发，无独立节拍；打开面板另有 60 秒新鲜阈值（`SNAP_FRESH_MS`，新鲜则零请求） | 全量索引注释值：同一仓库全量 585 条约 7 秒，最近 1 天 24 条约 1.2 秒（注释实测，非本票实测）；本次面板打开链路的单次耗时没量到 | 是（`gh api …/issues?state=all&per_page=100 --paginate` 取索引，见 `fetchIssueIndex`） | 注释 `src/host/issueList.js:160-163`；实现 `:164-225`（`fetchIssueIndex`，含部分数据解析与手动分页兜底 `:22-74`）；水印语义 `:226-249`；是否当前 `:251-266`（`cacheSnapshotIsCurrent`，变了不推水印、没变才推）；新鲜阈值 `src/shared/tracker/sync.js:57` 与 `src/client/kernel/probe-auto.js:307-311` |
| A5 | 视野心跳（界面上报「我还在看谁」） | 20 秒（`ATTENTION_HEARTBEAT_MS`）；零配额、不出网的是「不引发探测」，上报本身是一次 `wf.focus` 跨边界调用 | 没量到（只传窗口标识、工作区根、可见性，不拉数据） | 否（不上 GitHub，只调宿主 `wf.focus`；宿主侧只做归一化与纯函数求值，不起 `gh`） | 真源 `src/shared/tracker/sync.js:61` 与 `src/shared/refresh/budget.js:14`（同为 `20_000`）；循环 `src/client/kernel/attention-heartbeat.js:165-176`；三道源头门（面板不可见／窗口未获焦／60 秒无人类输入则连发都不发）`:155-163`；宿主薄壳 `src/host/refresh/attention.js:28-39,152-177` |
| A6 | 关键动作后延迟探测 | 8 秒防抖窗（`ACTION_PROBE_WINDOW_MS`），一次只排一个；页签隐藏时跳过发起 | 没量到 | 是（一次轻量 REST 探测） | `src/shared/tracker/sync.js:51`；`src/client/kernel/probe-auto.js:145-156`（`scheduleActionProbe`） |
| A7 | 命名守护 | 无自续定时器（#709 退役了从前每 15 秒全仓库扫一遍的 tick）；事件驱动（建号拦截、新会话注册、认领推送、客户端上报四种事件＋界面每次拉计划单）＋ 10 分钟兜底（每次只轮转扫 1 个仓库）；落盘防抖 1200 毫秒；短窗合并 1500／800／120 毫秒 | 注释值：旧 tick 全扫一次 7～12 秒（退役前的注释，非本票实测）；现行事件跳／兜底跳的单次耗时没量到 | 是（`gh api repos/…/issues?state=all&per_page=100 --paginate` 取索引做差值结算） | 退役说明与现行语义 `src/host/namingGuardian.js:23-24,68-82`；兜底常量 `:24`（`NAMING_FALLBACK_MS = 10*60_000`）；单轮只扫 1 仓 `:150-151`；落盘防抖 `:63-67`（1200ms）；短窗 `:181-188`（默认 1500ms）、注册 800ms（`:212`）、等待查询 120ms（`:341`） |
| A8 | 写事件触发的取数 | 事件到达即判，同一工作区 10 秒合并窗口（`PATCH_MERGE_WINDOW_MS`）；过闸（调用点 `event.write`） | 没量到 | 是（`patch` 或 `probe`，由闸放行后真发） | 合并窗口 `src/shared/refresh/budget.js:11`（`1e4`）；订阅与门 `src/host/refresh/writeEvents.js:63-83,106-121,206-235`；闸分类 `src/host/refresh/gate.js:47` |
| A9 | 配额同步（读服务端剩余额度） | 60 秒 | 没量到（注释写明不扣配额但仍是真实出站） | 是（真实出站 1 条，不扣配额） | `src/shared/refresh/budget.js:63`（`QUOTA_SYNC_INTERVAL_MS=6e4`）；闸分类 `src/host/refresh/gate.js:45`（`'quota.sync': 'background'`）；账本节拍归调用方 `src/host/refresh/ledger.js:21-33` |
| A10 | 整池对账（reconcile） | 10 分钟；黄档停（`reconcileIntervalMs: null`），红档停 | 没量到 | 是（GraphQL 整池，见闸桶映射） | `src/shared/refresh/budget.js:6`（`RECONCILE_INTERVAL_MS=10*60_000`）；黄档停 `src/shared/refresh/policy.js:49-56`；闸分类 `src/host/refresh/gate.js:42` |
| A11 | 检查链退避 | 失败后 8 秒 → 30 秒 → 2 分钟 → 5 分钟拉开（`CHAIN_BACKOFF_MS`）；成功一次归零 | 没量到 | 是（`chain` 种类，REST 桶，单次约 3 条出站，见预算常量） | `src/shared/refresh/budget.js:9`；单次成本 `:67`（`CHAIN_EVAL_COST_REQUESTS=3`） |
| A12 | 行闪烁清除／通知清除 | 单次 2.6 秒（行闪烁）；通知 2.8 秒；切换确认 220 毫秒 | 不适用（纯本地渲染定时器） | 否 | `src/client/kernel/probe-snapshot-helpers.js:92-103`（一次只排一个）；`src/client/kernel/store-snapshot.js:347`；`src/client/kernel/store-switch.js:108` |
| A13 | 更新状态轮询 | 1 秒，但只在安装中／校验中（`installing`／`verifying`）挂载，平时不跑 | 没量到 | 否（读宿主更新快照，不上 GitHub） | `scripts/generated/updateClient.derived.js:114`（`UPD_POLL`）、`packages/dsh-plugin-update/derive-client-values.mjs:25`（注释 `UPD_POLL = 1000`）、门禁期望 `tests/verify-generated-no-shadow.js:108`；挂载条件 `src/client/views/useUpdatePanel.js:164-169` |
| A14 | 原生页签注册重试 | 1 秒试一次、最多 10 次，仅老宿主无 `ctx.inject` 的启动期；成功或 10 次即停 | 不适用（启动期一次性） | 否 | `src/client/panelAssembly.js:136-142` |

## 2. 输入链路：为什么说「抢同一条主线程」在结构上成立

1. 对话框（评论输入框）是受控 `textarea`：`value` 绑 `st.cmtDraft`，每敲一个字走 `onChange` → `st.cmtDraft = ev.target.value; emit(st)`（`src/client/views/IssueDetailComments.js:120-130`）。`emit` 是全量重渲染（同仓既有模式，评论区、列表行、闪烁标记都在同一棵树里）。
2. 后台任务的回包（`probeNow` 的 `host.call('wf.probe').then(…applySnap…emit)`，`src/client/kernel/probe-auto.js:38-99`；`refreshAll` 的 `Promise.all([p1,p2]).then(…扇出同工作区全组…emit)`，同文件 `:228-302`）同样回到这条主线程做快照对比（`diffSnapshots`）、行闪烁标记（`rowFlash`／`issueFlash`）与 `emit`。
3. 结论：两者共用同一条 JS 主线程事件循环，**结构上存在互堵的可能**：一次大的整池回包（全量 issues 排序、快照对比、跨 store 扇出）正好落在两次按键之间，就会把那一帧的输入响应往后推。**但本票没有按键级实测，这个「正好」是否发生、延迟多少，写的是没量到**（见第 4 章）。

## 3. 视野模型与闸档位：正在看的、工作区、配额

1. 视野模型活跃集合：上限 2（`src/shared/refresh/budget.js:24`，`MAX_ACTIVE_WORKSPACES=2`，门禁在 `tests/verify-attention-model.js:120` 钉死）；刚离开保留收尾 30 秒（`ACTIVE_LINGER_MS=3e4`，同文件 `:13`）；90 秒无任何上报整桌收摊（`ATTENTION_EXPIRY_MS=9e4`，同文件 `:15`）；收尾探测按 15 秒（`PROBE_INTERVAL_LINGER_MS=15e3`，同文件 `:4`）。
2. 处境三种取值：`active`（我在活跃集合里，有定时器）、`evicted`（名额被占，无定时器，切回来按生命周期那一次取）、`collapsed`（整桌收摊）（`src/host/refresh/attention.js:145-176`，注释写清三态语义）。
3. 闸档位：绿（已用／额度 < 0.6）后台按节拍跑；黄（0.6～0.85）后台刷新全停（`background-tier-yellow`）、探测降到 120 秒、对账停、重建最小间隔 300 秒；红（≥0.85）自动刷新全停、只留人的动作（`background-tier-red`）；剩余额度到保底线读让路写；撞限流（`Retry-After`）该工作区后台停、生命周期降级、人的动作照做。阈值 `src/shared/refresh/budget.js:22-23`（`TIER_GREEN_BELOW=0.6`、`TIER_RED_AT=0.85`），裁决 `src/shared/refresh/policy.js:70-103`（`decide`），闸内注释 `src/host/refresh/gate.js:1-20`。
4. 配额紧张时是否已降档：**没查到**——降档是运行时按账本实时算的（`ledger.view(bucket).tier`），本票只读代码，没有读任何一次运行时的档位、剩余额度与 `refresh.decide` 日志。现场查法：开调试开关，看 `refresh.decide`（结论与原因）与 `refresh.skipped`（被推迟的后台档）两条按需日志（落点 `src/host/refresh/gate.js:153-161`）。

## 4. 同峰对照与开关对照（本票没量到＋ delegated 做法）

1. 输入时间点与后台任务高峰是否同峰：**没量到**。本票只读代码，没有按键时间戳、没有 `wf.probe` 起止时间戳、没有输入延迟分段统计，回答不了「输入卡的那几秒后台有没有任务在跑」。
2. 关掉这些任务后输入是否变快：**没量到**（只做开关对照、不落地改法的对照本票也没有执行）。
3. 交给 #747 后续的最小可执行对照（只开关、不改生产代码）：
   - 对照组：面板打开、停在复现输入卡的对话框，保持正常打字节奏，记录可感知的卡顿段。
   - 实验组 A（停界面探测）：调试控制台里清掉 `shared._activeTimer` 与 `shared._probeTimer`（`src/client/kernel/probe-auto.js:165,214` 登记的两处），保持心跳与命名守护不动，对比同一段输入。
   - 实验组 B（再停心跳与命名兜底）：另停 `shared._beatTimer`（`src/client/kernel/attention-heartbeat.js:173`），并确认 10 分钟内无命名兜底跳（`src/host/namingGuardian.js:72-81`），对比同一段输入。
   - 判定：A 快、B 更快 → 探测回包是主犯；A 不快、B 快 → 心跳／兜底是共犯；都不快 → 主犯不在定时器里，回 #747 查渲染链路（`emit` 全量重渲染、Markdown 渲染、行闪烁扇出）。
   - 日志佐证：开调试开关后，用 `host.call`（含 `latencyMs` 与 `kind: 'probe'`）、`write.event`、`refresh.decide`、`refresh.skipped`、`attention.report／attention.sweep` 几条的落盘时间戳与按键时间戳对齐（落点见上表各行）。

## 5. 后台工作区是否偷跑（I2 是否成立）

1. 代码层面成立：活跃集合之外的工作区没有探测定时器；刚离开 30 秒内有 1 个收尾节拍（15 秒档），到 30 秒归零；90 秒无上报整桌收摊。机械保证在 `src/shared/refresh/attention.js:46-99`（`collect`：只给活跃集合发 `intervalMs`，其余进 `cancel`），门禁在 `tests/verify-attention-model.js:140-353`（后台零定时器、活跃上限 2、同一工作区根只探一次、90 秒收摊四条逐段断言）。设计原文 `CONTEXT.md:131`（I2）与 `docs/adr/20260924-refresh-budget-architecture.md:30-34`（30 秒收尾为例外的现行口径）。
2. 例外清单（不算偷跑，但排查时要知道它们存在）：配额同步 60 秒全局一次（A9）、整池对账 10 分钟一次（A10）、命名守护 10 分钟兜底轮转 1 仓（A7）、写事件 10 秒合并窗口的取数（A8）。它们都不持有「按后台工作区常驻」的定时器，但都会在输入进行中起外部命令。
3. 运行时是否真零偷跑：**没量到**——闸自带漏网计数 `escaped()`（传输层真发数减闸记数，不为 0 即有人绕闸，`src/host/refresh/gate.js:313-319`），本票没有读任何一次该计数的运行值。

## 附：没查到／没量到一览（验收对照）

- 每个后台任务的单次耗时：只有两处注释值（A4 的 7 秒／1.2 秒、A7 的 7～12 秒），其余单次耗时全部没量到。
- 输入延迟与后台任务的同峰关系：没量到（无按键时间戳与任务起止时间戳的对齐数据）。
- 开关对照（关掉后输入是否变快）：没量到（本票未执行，第 4 章只给了做法）。
- 当前闸档位与剩余额度：没查到（运行时值，需开调试看 `refresh.decide`）。
- `POLL_GRID_MS=4000`（`src/shared/tracker/sync.js:49`）在客户端的直接消费点：本票在 `src/client` 未找到对应的轮询消费，只看到注释称其为「视线门控轮询的唯一节拍来源」——是否仍有生产调用，写没查到。
