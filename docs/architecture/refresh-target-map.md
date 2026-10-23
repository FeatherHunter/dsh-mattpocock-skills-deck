# 刷新机制目标地图：旧位置到新位置对照、命名理由与规则迁移方案

> 归属：规格 #1419（刷新机制重构）第零批交付物，实施票 #1423。
> 地位：后面每一张搬家票（#1425–#1429）按这张图搬家，评审者按这张图核对有没有漏搬。
> 口径：手写 TypeScript 源文件 59 个（只数 `src/` 下手写的 `.ts`，不含转译产物 `.js`、测试 `tests/`、文档与生成器）。关联但不计入的文件另见附录。
> 基线提交：main HEAD 2298c11e；专用分支 refactor/refresh-modules。

## 一、目标结构（规格原文照抄，不发挥）

```text
src/refresh/
  README.md            这套机制解决什么问题、六个环节怎么串、改哪里
  contract/            对外契约：类型、端口、可调参数、触发分类
  kernel/              纯逻辑：预算、策略、注意力、变化检测、补丁应用、退避
  rooms/host/          宿主房：运行时、闸、账本、取数、记账、挂载
  rooms/client/        客户端房：节拍、订阅、注意力心跳、快照缓存与同步
  registry/            装配登记：唯一的组装点（含 deck 工具桥）
```

分层规则（单向依赖，从内到外）：
- 内核与契约不依赖宿主房、客户端房、装配登记。
- 房只依赖契约；房与房之间不互相引用（宿主房与客户端房只能靠 RPC 契约说话）。
- 房与装配登记之间只有装配点依赖房；房不回头依赖装配登记。
- `src/refresh` 之外只允许深引契约，不允许引某个房内部的具体文件。

六个环节（README 与评审的共同语言）：节拍 → 变化检测 → 取数 → 准入 → 补丁应用 → 记账。

## 二、59 个文件对照表

### A 组：纯逻辑候选（17 个，起草时在 src/shared/refresh/src/，去 kernel/ 与 contract/；#1425 起已搬空）

| # | 旧位置 | 新位置 | 改名理由（一句话：拥有什么、替谁做决定） |
|---|---|---|---|
| A1 | src/shared/refresh/src/budget.ts | src/refresh/kernel/host-budget.ts | 它拥有宿主侧预算的算式与上界，替“这次取数允不允许花”做决定；加宿主域前缀，与页面预算区分 |
| A2 | src/shared/refresh/src/page-budget.ts | src/refresh/kernel/page-allowance.ts | 它拥有“一页行数据多少钱”的单价表，替首屏记账做决定；原名 budget 易与宿主预算混淆 |
| A3 | src/shared/refresh/src/tool-cost.ts | src/refresh/kernel/tool-call-budget.ts | 它拥有 deck 工具调用的点数表，替工具准入做决定；原名 cost 不说明替谁做决定 |
| A4 | src/shared/refresh/src/step-cost.ts | src/refresh/kernel/step-pricing.ts | 它拥有链上每一步的价格，替事件预算测算做决定 |
| A5 | src/shared/refresh/src/policy.ts | src/refresh/kernel/admission-policy.ts | 它拥有准入策略的判定表，替“放行还是拒绝”做决定 |
| A6 | src/shared/refresh/src/attention.ts | src/refresh/kernel/attention-model.ts | 它拥有注意力模型的纯判定（谁在看、算哪一档），替节拍档位做决定；加模型后缀，与两房落地 □分 |
| A7 | src/shared/refresh/src/backend-quota.ts | src/refresh/kernel/backend-quota-model.ts | 它拥有三个后端各一套额度模型的纯算式，替“各后端剩多少”做决定 |
| A8 | src/shared/refresh/src/backoff.ts | src/refresh/kernel/failure-backoff.ts | 它拥有失败退避序列与熔断判定，替“失败后等多久”做决定；加失败域前缀，与链退避区分 |
| A9 | src/shared/refresh/src/chain.ts | src/refresh/kernel/refresh-chain.ts | 它拥有“一次刷新只有一条链”的推进规则，替链状态机做决定 |
| A10 | src/shared/refresh/src/chain-prune.ts | src/refresh/kernel/chain-pruning.ts | 它拥有链剪枝规则，替“哪些链节点可以丢”做决定 |
| A11 | src/shared/refresh/src/delta.ts | src/refresh/kernel/snapshot-diff.ts | 它拥有快照差异比对口径，替“变了哪几行”做决定；原名 delta 不说明比较对象 |
| A12 | src/shared/refresh/src/failure-window.ts | src/refresh/kernel/failure-window.ts | 名字已自解释：拥有失败窗口判定，不改名，直接搬家 |
| A13 | src/shared/refresh/src/idempotency.ts | src/refresh/contract/idempotency-keys.ts | 它拥有幂等键的形状，替“重复提交算一次”做决定；它是契约（形状），进 contract |
| A14 | src/shared/refresh/src/create-write.ts | src/refresh/kernel/create-write-policy.ts | 它拥有创建与写事件的判定，替写事件允不允许做决定 |
| A15 | src/shared/refresh/src/write-detect.ts | src/refresh/kernel/write-event-detection.ts | 它拥有写事件的探测判定，替“这是不是一次写事件”做决定；原名缩写补全 |
| A16 | src/shared/refresh/src/ports.ts | src/refresh/contract/refresh-ports.ts | 它拥有对外端口的形状，进 contract；加刷新域前缀 |
| A17 | src/shared/refresh/src/tuning.ts | src/refresh/contract/tuning-parameters.ts | 它拥有可调参数的形状（节拍、阈值），替“哪些旋钮可以调”做决定；它是契约面 |

### B 组：宿主房候选（13 个，起草时在 src/host/refresh/，去 rooms/host/；#1426 起已搬空）

| # | 旧位置 | 新位置 | 改名理由 |
|---|---|---|---|
| B1 | src/host/refresh/gate.ts | src/refresh/rooms/host/refresh-gate.ts | 拥有唯一出口闸的实例逻辑，替“能不能花”做决定；加刷新域前缀 |
| B2 | src/host/refresh/ledger.ts | src/refresh/rooms/host/quota-ledger.ts | 拥有每一笔花费的账本，替“花了多少、剩多少”做决定；原名 ledger 不说明记谁的账 |
| B3 | src/host/refresh/attention.ts | src/refresh/rooms/host/host-attention.ts | 拥有注意力模型在宿主侧的落地，替宿主节拍做决定；加宿主前缀，与客户端注意力区分 |
| B4 | src/host/refresh/chainBackoff.ts | src/refresh/rooms/host/chain-backoff.ts | 拥有链退避的宿主执行，替“链失败后等多久”做决定；文件名大小写统一为短横线 |
| B5 | src/host/refresh/chain-ride.ts | src/refresh/rooms/host/chain-coalescing.ts | 拥有链请求合流，替“同链请求谁搭谁的车”做决定；原名 ride 是比喻，不说明机制 |
| B6 | src/host/refresh/patch.ts | src/refresh/rooms/host/row-patch.ts | 只管把一行补进快照，不拥有整条刷新流程；改名收窄职责 |
| B7 | src/host/refresh/refreshSource.ts | src/refresh/contract/trigger-classification.ts | 回答“这次刷新是谁触发的、算哪一类”；它是分类，进 contract，原名只说来源不说分类 |
| B8 | src/host/refresh/fetchThinRows.ts | src/refresh/rooms/host/thin-row-fetch.ts | 拥有薄行取数执行，替“列表取回哪些行”做决定；动宾补全 |
| B9 | src/host/refresh/recordRepoPages.ts | src/refresh/rooms/host/repo-page-accounting.ts | 拥有按仓库页数记账，替真值复核做决定；原名只说记录不说记账 |
| B10 | src/host/refresh/refusal-text.ts | src/refresh/rooms/host/refusal-messages.ts | 拥有拒绝与降档文案，替界面说什么话做决定；复数说明是文案集合 |
| B11 | src/host/refresh/wiring.ts（运行时部分） | src/refresh/rooms/host/refresh-runtime.ts | 拥有宿主运行时的装配（闸、账本、订阅、视野），替“宿主侧谁先谁后”做决定；原名 wiring 只说从大文件切出来 |
| B12 | src/host/refresh/wiring.ts（桥部分） | src/refresh/registry/deck-tool-bridge.ts | 拥有 deck 工具桥的接线，替“工具调用走哪条链”做决定；与运行时拆成两个文件 |
| B13 | src/host/refresh/writeEvents.ts | src/refresh/rooms/host/write-event-subscription.ts | 拥有写事件订阅，替“写事件来时通知谁”做决定；原名缩写补全 |
| B14（附） | src/host/refresh/workRouteReadoutForHost.ts | src/refresh/rooms/host/work-route-readout.ts | 拥有工作路线读出口，替面板读数做决定；随运行时同批搬家（计数仍在 B 组 13 个内，本行是 wiring 拆分后的第二落点说明，不另计数） |

> 计数说明：B 组按盘上 13 个文件计；wiring 拆成两个落点，旧路径仍计 1 个，新位置占 2 个（运行时进宿主房、桥进登记层）。

### C 组：宿主取数与快照（11 个，去 rooms/host/）

| # | 旧位置 | 新位置 | 改名理由 |
|---|---|---|---|
| C1 | src/host/issueList.ts | src/refresh/rooms/host/issue-list-fetch.ts | 拥有列表取数执行，替“列表取回什么”做决定 |
| C2 | src/host/issueDetail.ts | src/refresh/rooms/host/issue-detail-fetch.ts | 拥有正文取数执行（只在人点开时取），替正文首屏不进列表做决定 |
| C3 | src/host/commentThreads.ts | src/refresh/rooms/host/comment-thread-fetch.ts | 拥有评论线程取数，替“评论何时取”做决定；第四批从中拆出探测处理器部分 |
| C4 | src/host/snapshotBuild.ts | src/refresh/rooms/host/snapshot-build.ts | 拥有快照组装，替“快照长什么样”做决定 |
| C5 | src/host/sessionRefresh.ts | src/refresh/rooms/host/session-refresh-schedule.ts | 拥有会话级刷新调度，替“这个会话何时刷”做决定 |
| C6 | src/host/sessionSnapshot.ts | src/refresh/rooms/host/session-snapshot-cache.ts | 拥有会话快照缓存，替“快照存哪、谁可读”做决定 |
| C7 | src/host/detectChain.ts | src/refresh/rooms/host/check-chain-evaluation.ts | 拥有检查链求值，替“链推进到哪一步”做决定；原名只说探测不说链 |
| C8 | src/host/git-process.ts | src/refresh/rooms/host/git-execution.ts | 拥有 git 子进程执行，替“本地 git 怎么跑”做决定；第四批与 gh 执行分开 |
| C9 | src/host/gitCredentialExec.ts | src/refresh/rooms/host/gh-execution.ts | 拥有 gh 执行，替“GitHub 调用怎么跑”做决定；原名只说凭证不说执行 |
| C10 | src/host/platform/refreshAssembly.ts | src/refresh/rooms/host/refresh-assembly.ts | 拥有行级增量的宿主装配，替“补丁逻辑在哪装起来”做决定 |
| C11 | src/host/platform/outbound-control.ts | src/refresh/rooms/host/outbound-control.ts | 拥有出站控制面（名额闸、取消判定、搭车账本），名字已自解释，直接搬家 |

### D 组：索引、窗口、准入与入口（4 个）

| # | 旧位置 | 新位置 | 改名理由 |
|---|---|---|---|
| D1 | src/host/platform/issueIndexWindow.ts | src/refresh/rooms/host/issue-index-scan.ts | 拥有索引扫描状态（用水印扫远端），替“扫哪一段”做决定；与窗口规则分开命名 |
| D2 | src/shared/tracker/indexWindow.ts | src/refresh/kernel/index-window-rules.ts | 拥有时间窗与水印规则真源（纯逻辑），替“窗口怎么算”做决定；它是规则，进内核 |
| D3 | src/host/outbound/admission.ts | src/refresh/rooms/host/outbound-admission.ts | 拥有出站准入判定执行，替“这笔调用放不放”做决定 |
| D4 | src/host/index.ts（仅 wf.probe 段） | src/refresh/rooms/host/probe-handler.ts | 拥有探测取数入口的宿主处理，替“探测请求进来先干什么”做决定；从宿主顶层入口拆出 |

### E 组：客户端房（9 个，起草时在 src/client/kernel/，去 rooms/client/；#1428 起已搬空）

| # | 旧位置 | 新位置 | 改名理由 |
|---|---|---|---|
| E1 | src/client/kernel/probe-auto.ts | src/refresh/rooms/client/refresh-timer.ts | 拥有客户端探测节拍，替“多久问一次宿主”做决定；原名只说自动不说节拍 |
| E2 | src/client/kernel/attention-heartbeat.ts | src/refresh/rooms/client/client-attention-heartbeat.ts | 拥有客户端注意力心跳，替“人在看哪”做决定；加客户端前缀 |
| E3 | src/client/kernel/probe-chain.ts | src/refresh/rooms/client/probe-chain-subscription.ts | 拥有探测链订阅，替“链变了通知谁”做决定 |
| E4 | src/client/kernel/probe-select.ts | src/refresh/rooms/client/probe-scope-selection.ts | 拥有探测范围选择，替“这次只看哪些工作区”做决定 |
| E5 | src/client/kernel/probe-snapshot.ts | src/refresh/rooms/client/snapshot-sync.ts | 拥有快照同步，替“面板手上的快照何时更新”做决定 |
| E6 | src/client/kernel/probe-snapshot-helpers.ts | src/refresh/rooms/client/snapshot-sync-helpers.ts | 快照同步的帮手，与 E5 同批搬家 |
| E7 | src/client/kernel/probe-stale.ts | src/refresh/rooms/client/staleness-indicator.ts | 拥有新鲜度指示，替“面板说新还是旧”做决定 |
| E8 | src/client/kernel/store-snapshot.ts | src/refresh/rooms/client/snapshot-cache-store.ts | 拥有快照缓存存储，替“快照在客户端存哪”做决定 |
| E9 | src/client/kernel/slotRenderer-repo-sync.ts | src/refresh/rooms/client/repo-sync-renderer.ts | 拥有仓库同步渲染，替“同步状态怎么画”做决定 |

### F 组：装配桥与共享钥匙（5 个，去 registry/ 与 contract/）

| # | 旧位置 | 新位置 | 改名理由 |
|---|---|---|---|
| F1 | src/deck/shell/call-budget.ts | src/refresh/rooms/host/tool-call-budget-enforcement.ts | 拥有工具调用预算执行，替“工具调用扣哪一桶”做决定；它是宿主房执行 |
| F2 | src/deck/registration/quota-sync.ts | src/refresh/registry/quota-sync-bridge.ts | 拥有剩余额度读数桥，替“工具侧读数与账本对齐”做决定；它是桥，进登记层 |
| F3 | src/deck/registration/host-assemble.ts（桥部分） | src/refresh/registry/deck-tool-bridge.ts | 与 B12 会合：deck 工具桥的唯一落点；运行时部分不进这里 |
| F4 | src/shared/refresh-workspace-key.ts | src/refresh/contract/workspace-keys.ts | 工作区钥匙形状与算法（纯函数），替“五处同源”做决定；是契约，进 contract |
| F5 | src/shared/host-timer/src/host-timers.ts | src/refresh/contract/host-timer-ports.ts | 计时器口形状，替“时间由谁提供”做决定；内核不许碰时间，只认这个口 |

> 合计：17 + 13 + 11 + 4 + 9 + 5 = 59（B12 与 F3 在新位置会合成一个 deck-tool-bridge 文件，旧路径计 2 个，新位置计 1 个，评审时按“两处旧实现并一处桥”核对）。

## 三、附录：相邻但不计入 59 的关联文件（有交代，不留“以后再说”）

- src/host/issuePage.ts、snapshotEnvelope.ts、tracker/snapshot.ts：快照包络与分页通用件，不属于刷新机制独有，搬家时只改导入，不搬家。
- src/deck/shell/call-shell.ts、work-path-ledger.ts：调用壳与工作区路径账本是 deck 通用层，刷新只调用它们，归属不变。
- src/shared/time-config/：中央时间参数真源，搬家不搬它（规格已定：时间参数不跟着进新目录）。
- 转译产物与测试：src/shared/refresh/ 下的 .js 产物、tests/verify-* 门禁脚本随搬家改导入，不计入 59。

## 四、机器规则与基线迁移方案

现状（基线提交）：
- 依赖图只看 src/host、src/shared、src/seam、src/tracker 四棵树（.dependency-cruiser.ts），src/client 整棵不在图里，src/deck 经 OPTIONAL_TREES 喂图。
- 同层互引：platform/host/shared/seam/tracker 各一条 same-layer-import 规则，存量边记 tests/same-layer-baseline.json（只许减不许增）。
- 房间纪律：cross-room-import 等，登记表 tests/tracker-room-imports.json。

迁移（四步，每步只缩不长）：
1. 本票之后（#1424）：新目录骨架先生效三条新规则（内核禁 I/O、宿主房与客户端房零引用、新目录之外只许深引 contract），旧路径用基线接住现状（新增 refresh 旧路径基线，条目数等于当前违规数，之后逐票减）。
2. #1425（内核搬家）：内核文件受禁 I/O 规则真管；旧路径基线减去 A 组；常量真源检查（budget 唯一）绿。
3. #1424（骨架与规则先行）：客户端手写源码从这张票起进图 —— 2026-10-19 纯 TS 化之后树上已无产物同名 .js，过去整体排除的理由已不存在。#1426–#1428（宿主房、桥、客户端房）：每批减去对应组旧路径基线；客户端与宿主共用同一份规则定义。
4. #1430（收口）：旧路径引用 grep 为零，旧基线与临时豁免全部删除，规则收紧到最终形态（无基线、全绿）。

判据落点：新增规则并入 tests/verify-dependency-rules.ts 那一扇，不新开门禁脚本（规格测试决策已定）。

终态（#1430，已验证）：分层四条定版——`refresh-kernel-no-io` 唯一例外是 `async_hooks`（to 侧 pathNot，step-pricing 透传计数用，不碰文件不联网）；两房零引用两条零违规；`refresh-outside-only-contract` 禁房间与登记深引、内核与契约公开（#1425 对第 24 行的修正）。`tests/refresh-baseline.json` 已删，门禁里读取块与分类第三参数一并移除；同层 82 条存量零新增。

## 五、ADR 变更草案（docs/adr/20260924-refresh-budget-architecture.md → v2）

要改的章节：
- 标题：形态后缀“纯逻辑进 src/shared/refresh/”改为“纯逻辑进 src/refresh/kernel/，契约进 src/refresh/contract/”。
- §3“纯逻辑放哪、取数与落盘放哪”：纯逻辑落点改为新内核目录；I/O 分界线文字不动；产物零相对引用改为“内核与房之间零直引、只经契约”。
- 新增一节“目录与命名”：写入本图第一、二节的分层规则与命名规则（目录回答哪一层哪个角色、文件回答拥有什么替谁做决定、缩写只用 GLOSSARY 已有词）。
- 全文路径引用：凡出现 src/shared/refresh、src/host/refresh、src/client/kernel/probe-* 的地方改为新路径。

明确不动的：六条不变量 I1–I6 的判据语义一个字不动；三个后端各自的额度模型不动；余量数值不动；日志事件名与字段不动。

落点（#1430 v2 实际做法，与草案有三处出入，均有理由）：一、标题已按草案改成“纯逻辑进 `src/refresh/kernel/` · 契约进 `src/refresh/contract/`”。二、“目录与命名”落在 §3 内一款，没有单立一节——ADR 正文多处交叉引用 §3–§8，单立新节要么重排编号、要么挂在末尾割裂上下文；分层与命名的内容已全。三、“产物零相对引用”保留原句没有按草案改写——门禁认这个字串，改写会杀掉判据；内核与房之间零直引的意思由分层四条守着。四、“六条文字不动”指判据语义，`怎么判` 里的落点（闸/预算/退避/测试文件名）随“全文路径引用”一条更新，旧名在正文各留一处备查（门禁认 `budget.js` 等字串）。

## 六、批次与回滚

- 第零批（本票）：只写本文档，不改运行代码。
- 第一批（#1425）：A 组 + B7/F4/F5 契约部分。
- 第二批（#1426）：B 组宿主运行时（含 B1–B6、B10–B11、B13）。
- 第三批前半（#1427）：C 组 + D 组 + F1–F3 桥。
- 第三批后半（#1428）：E 组客户端房（含客户端进图）。
- 第四批（#1429）：C3/D4/执行文件按职责拆分（探测处理器、索引扫描、gh 与 git 执行、运行时与桥拆分），每个拆分单独提交。
- 收口（#1430）：ADR v2、索引、README、全量验证、一个 PR 合入 main。

每批单独提交、单独可回滚（一次 revert）；搬家只移动与改导入，不改数值与算式；基线只许缩不许长。

各批状态（#1430）：第零批到第四批（#1425–#1429）全部完成并合入本分支，收口即本票；分支上 10 余个提交见 `git log main..refactor/refresh-modules`。

## 七、已知风险

- 当前工作区另有 V2 客户端改动未提交（卡片与地图详情相关），第三批搬客户端文件前先与该会话协调，避免把别人的改动卷进搬家提交。
- 搬家后无 re-export 壳，每批必须一次改完全部导入点，改动面大，评审按“只移动 + 改导入”机械核对。
- 按文件名断言的门禁与挑选规则（gate-map）需同步改，否则出现休眠门禁；装载钩子“同名 .ts 优先”要求引用说明符同步改，否则本机绿 CI 红。

收口（#1430）：三条风险均已关闭——V2 客户端改动协调：第三批按“只暂存本票路径”提交，未发生卷入；无 re-export 壳：每批一次改全导入点，全量验证链覆盖；门禁与钩子：每票同步改 gate-map 与引用说明符，无休眠门禁（收口再全量验证一次）。
