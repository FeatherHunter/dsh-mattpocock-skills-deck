# 地图 #1010 子票与本轮 deck 重构的关系判定（第 2 组：998、893、930、1003、1006）

这份文件回答一件事：这五张票里，哪些部分会随着「deck 工具加 GitHub 房加 Markdown 房全量改写 TypeScript」这次重构一起被解决，哪些部分属于别的地盘，谁都不许越界。

判定基准（父会话给的，原样照用）：在内的是 `src/deck/**`（九个工具、壳、注册、日志）＋`src/tracker/contract/**`＋`src/tracker/registry/**`＋`src/tracker/rooms/github/**`＋`src/tracker/rooms/markdown/**`＋`src/tracker/detection/**`＋`src/host/refresh/**` 里被 deck 调到的行。不在内的是 `src/client/**`、提示词文案、`scripts/**`、GitLab 房、四个计算核、闸与账本本体。

「谁的」不是我凭印象说的：每一条都拿迁移映射表 `research/1010-migration-map.json` 核过（`modules` 是被搬的文件、`specifiers` 是 import 要改的文件、`outOfScope` 是明确不动的），核过的结果写在各节里。

## #998 整片被闸推迟（gate-defer）

**状态**：开放，`bug` + `ready-for-agent`。**判定：部分。**

**归我们的（重构即吞掉）**：票里「## 七、全量审查发现（尚未建票）」那一节，六条严重加七条中等，逐条点名了文件与函数，而这些文件全在我们的搬迁清单里：

| 票内点名的位置 | 重构后的新家 | 问题一句话 |
| --- | --- | --- |
| `shared/deck-tools/key-lock.js:52-57` | `src/deck/shell/write-mutex.ts` | 等待超时后删队尾，同一票出现两个写入者 |
| `host/tools/deckMapLink.js:86-94` 与 `:142-143`、`edges.js:236` | `src/deck/tools/map-link.ts`、`src/deck/shell/edge-landing.ts` | `blockedBy: []` 静默清空已有阻塞边还报成功 |
| `host/tools/deckIssuePatch.js:31-35` 的 `must()` 共八处、`shell.js:306-314` | `src/deck/tools/issue-patch.ts`、`src/deck/shell/call-shell.ts` | 改票中途失败，已发生的副作用被丢掉 |
| `host/tools/deckMapPlanCreate.js:210-240`、`:154`、`:300`、`:316` | `src/deck/tools/map-plan-create.ts` | 续跑漏建子票却回「计数对齐、全部建成」 |
| `shared/deck-tools/plan.js:70-77`、`deckMapPlanCreate.js:116` 与 `:167` | `src/deck/shell/minimal-spec.ts` | 缺省 planId 带 5 分钟时间桶，隔五分钟重发就新建整张图 |
| `deckMapPlanCreate.js:120` 与 `:149` | `src/deck/tools/map-plan-create.ts` | `ACTIVE_PLANS` 占位在 try 之外，抛错就永久「正在执行」 |
| `backends/github/issues.js:168`（500 上限）、`github/queries.js:27`（评论恒取 50）、`gitlab/issues.js:79`、`markdown/issues-read.js:66` | `src/tracker/rooms/github/issues.ts`、`queries.ts`、`markdown/issues-read.ts`；契约位置在 `src/tracker/contract/operations.ts` 的 `list` 与 `get` | 列表总数建在可能被截断的集合上；评论静默截断 |
| `host/tools/deckContext.js:81/88/97`、`deckMapSnapshot.js:103/110/144` 与 `edges.js:139-146`、`deckIssueCreate.js:137/143`、`deckMapLink.js:117` | `src/deck/tools/context.ts`、`map-snapshot.ts`、`issue-create.ts` | 地图清单误诊、快照把整仓票当子票、读回失败误报、`parentKey:''` 语义相反 |
| `platform/deckExec.js:48-92`、`deckToolsRow.js:315`、`shared/deck-tools/agent-register.js:230` | `src/deck/registration/host-delegate.ts`、`agent-row.ts`、`register-options.ts` | 代执行没有取消与整体超时，四种失败共用一句「还没接通」 |

票内还有一句关键话：「待上报人点头：为本节第七部分的六条严重与七条中等建票；与 #895、#898 相邻的两条并入对应票，不新开重复单」——也就是说这十三条**今天还没有自己的票**，只有 #998 正文里这一节。我们重构若不逐条点名吞掉，它们就会随着搬家和转换一起消失得无声无息。

**不归我们的**：票的本体现象（`deck_*` 整片被闸推迟）是闸的连续失败自锁，落点在 `src/host/refresh/gate.js` 与 `refresh-core` 的策略与窗口状态机；这三处**不在**我的搬迁清单里（我核过：`gate.js`、`ledger.js`、`refresh-core/src/policy.ts`、`refresh-core/src/failure-window.ts` 都不在 `modules` 也不在 `specifiers`），属刷新域。它已修（提交 `71dbc3e`，半开探针加 29 项门禁 `tests/verify-998-half-open.js`）并真机验证过。票内自留的次级项（分桶、冷却锚点）已经另立 #1006（本组第 5 张），backend-threw 超时话术仍未定。

**重构后靠什么保证不再犯**：这十三条要么在新树里逐条改掉，要么显式立票；两者都不做就等于丢。另外票里那条根因（契约层没有「这份数据全不全」的位置）由新契约正面解决——`list` 加可选 `partial`、用现成 `counts` 报真总数，这正是我们契约这一批该定的事。

## #893 两个 deck 工具调用失败，原因未查清

**状态**：开放，`bug` + `ready-for-human`。**判定：已可关（附证据，建议由维护者点头后关）。**

**依据**：票内诊断已把根因收到环境那两层，且明说不是代码坏：「那一次 `deck_context` 返回部分成功……`deck_issue_list` 六次都没取回列表，后端原话都是取列表请求遇到 EOF」「本次复查同样调用全部成功：确认工具返回 ok，地图 37 张」。票内「更新诊断」把候选一（当时令牌无效，约占八成）与候选二（列表请求 EOF，约占六成半）列在前面，候选三明说「是转述时缩成了坏掉」。

更硬的证据在别处：#998 的进度记录写着 2026-10-10 修复后「三次 deck 调用（现状/读单/上报）本轮全部成功」——也就是这两条工具在那次故障之后再没复现过。票内剩下的唯一交付是「人在本机重登并重调」，而维护者在 #1003 里已明确同类事项不再请报告人回话（原话：「我们经过本次重构，把整套后端选择逻辑和配置项都处理好了，问题应该会直接消失」）。

**若不关**，那它的判定就是「不归我们」：根因是当时的登录态与网络，重构不负责修环境。

**重构后靠什么保证不再犯**：票里真正的抱怨是「只说是坏掉、看不到原文错误」。新契约的 `ErrorKind` 八档加两房 `errors` 归一，会让「哪一步失败、什么原因」写进回执——这正是新契约第一批已经落地的 `TrackerError` 与 `ErrorKind`（`src/tracker/contract/ports.ts:88-96` 与 `:341-344`）。

## #930 看不见用户选的后端（cwd 未归一）与写探测恒灰

**状态**：开放，`bug` + `ready-for-agent`。**判定：部分。**

票首有维护者 2026-10-11 的口径更正，把这张票劈成两半：

- **缺陷 A（工具看不见用户选的后端）**：更正原文说「在新方案下根因消失」——后端选择不再按工作区哈希键分桶，改读写工作区根上的配置文件，相关改造归 #1003（判定收口与迁移）与 #1012（存储格式与共用读写核）。它落在我们范围里的那一行是工具壳：`src/shared/deck-tools/shell.js`（票内诊断点名「工具侧不归一」），在我们的搬迁清单里是 MODULE，新家 `src/deck/shell/call-shell.ts`；#1003 一期（提交 `fa4df444`）改的正是这个文件。
- **缺陷 B（`md:scratchWritable` 写探测恒灰）**：根因是检查链构造谓词上下文时没带沙箱政策、写探测也没透传（`src/host/tracker/predicatePrimitives.js:156` 与 `:169-172`、`src/host/detectChain.js:130`）。这两个文件**不在**我们的搬迁清单，而且迁移映射表的 `outOfScope` 一节已经写明「属检查链与谓词那一摊，deck 调用链不经过，本次不动」（同列的还有 `capability.js`、`generic.js`、`predicateCore.js`、`snapshot.js`）。所以缺陷 B **不归我们**，要继续做得另有人接。

**重构后靠什么保证不再犯**：新树里工作区目录一律经唯一归一函数取（契约 `OpContext.cwd` 的注释已写明「这一次调用针对的工作区目录」与唯一钥匙的来历），并把「显式选择优先」写成判定服务的唯一出口；#1003 那批门禁（`verify-1003-unified-decision`、`verify-1003-single-outlet` 等）随新树改路径后继续常驻。

## #1003 环境检查与改色弹窗打架（把安装目录当工作区）

**状态**：开放，`bug` + `ready-for-agent`，票内一期、二期与单出口收尾均已合入。**判定：部分，另有一处边界冲突要人裁。**

**归我们的**（票内「你的写范围」第一节与我们的 `modules` 清单逐条对上）：

| 票内划给本票的写范围 | 我们的映射表怎么记 |
| --- | --- |
| `src/host/tracker/detection/**`（把三份显式三层收成一个判定服务） | MODULE（`detection/backendDecision.js` 等在册） |
| `src/shared/deck-tools/shell.js`（工具壳改调那个服务） | MODULE，新家 `src/deck/shell/call-shell.ts` |
| `src/host/platform/deckToolsAssembly.js`（删掉自动写那段） | MODULE，新家 `src/deck/registration/host-assemble.ts` |

**不归我们的**：`src/client/**` 的客户端闸与偏好搬迁、老用户迁移逻辑、本机记忆退役、`docs/adr/20260828-workspace-key-unification.md` 与三条按源码文本钉它的旧门禁、标签配色那套。这些都在票内被明确划给别人或划给客户端。

**要人裁的边界冲突（重要）**：票内把 `src/host/workspaceCwd.js` 写成「唯一写入口」并列入**它的**写范围；而我们的迁移映射表里这个文件是 `specifiers` 的宿主（它 `import` 我们的 `shared/deck-tools/workspace-file.js`，我们把这个模块搬到 `src/deck/shell/workspace-anchor.ts` 之后，这一行 import 必须改）。同一文件两个写者，撞地图那条硬规则「同一条边界，同一时间只允许一个写者」。两条出路：一是等 #1003 收口后我们再改那一行 import；二是我们改 import 时 #1003 不动该文件。建议前者（#1003 是活跃实施票），我们搬家时只改那一行并跑它那三条门禁。

**另一处要回填的**：票内「地图层面的条目」有一段写着「『全 TS 项目』的迁移路线需要一条自己的路线图：今天只有三个 TS 核与客户端组件是 TS，宿主与共享层仍有大量 `.js`，转型顺序与门禁没人定」——那正是我们这次在做的事（设计文档已定版，见 `docs/adr/20261011-deck-ts-rewrite.md`）。这条应当回填给本票或地图，避免有人再立一张重复的票。

**重构后靠什么保证不再犯**：判定「当前后端是谁」只有一处出口（新 `src/tracker/detection/` 的判定服务，答案带「从哪一级来」），空目录按未知处理、不起任何外部命令；这三条在票内已成文并有门禁，随新树改路径后继续跑。

## #1006 剩余额度读数冷却按工作区分开并移出关键路径

**状态**：开放，`bug` + `ready-for-agent` + `wayfinder:task`。**判定：部分。**

**归我们的**：读数同步那一件整个在我们范围里——`src/host/platform/deckQuotaSync.js` 在我们的 `modules` 里（MODULE），新家 `src/deck/registration/quota-sync.ts`；它的接线在 `src/host/refresh/wiring.js`，这个文件在我们的 `specifiers` 里（我核到 6 条 import 要改），也就是「deck 调到的行」那一档。票末六条验收标准（过期后只放一笔、A 工作区失败不影响 B、等待序列有上限、有旧读数不等同步、慢读数不覆盖新读数、不新增日志事件名）可以直接变成新树里的断言。

**不归我们的**：`src/host/repoKeys.js` 的五档错误分类（`env`/`spawn`/`auth`/`timeout`/解析不出）——这个文件不在我的映射表里，属通路那一摊（#1007 与 #962 的地盘）；闸的连续失败计数与门槛，票内自己写了「不在本票范围：那是另一张票（归因埋点）」，而闸本就不在我们范围内。

**重构后靠什么保证不再犯**：新契约把「动手前保一次剩余额度读数」建模成可选依赖端口，缺席与失败都不挡路（第一批已经这样标注：`ensureReading` 失败吞掉、`resolveTimeoutMs` 标为「接受但未接线、接口设计定去时」）；门禁 `tests/verify-deck-quota-sync.js` 在我们的 34 个测试清单里，搬家时路径同步改、断言照跑。

## 汇总

| 票 | 判定 | 归我们的部分 | 不归我们的部分 | 建议动作 |
| --- | --- | --- | --- | --- |
| #998 | 部分 | 票内第十三条审查发现（六严重加七中等）全部落在我们的新树里 | 闸的连续失败自锁（刷新域，已修 `71dbc3e`）；分桶与冷却锚点已由 #1006 接 | 把这十三条做成清单挂在地图下，重构时逐条勾；票本体等刷新域收口 |
| #893 | 已可关（建议） | 无（不是代码缺陷） | 环境与登录态 | 维护者点头后关票，理由写「根因是当时令牌失效与列表请求 EOF，复查与后续实测均正常」 |
| #930 | 部分 | 缺陷 A 的工具壳那一行（`shell.js`，已由 #1003 一期收口） | 缺陷 B 整个（检查链与谓词那摊，我们的映射表已列范围外）；缺陷 A 的其余归 #1003 与 #1012 | 缺陷 B 另找人接；本票等 #1003 收口后按 A 已消失、B 另立处理 |
| #1003 | 部分 | `detection/**`、`shell.js`、`deckToolsAssembly.js` | 客户端、迁移逻辑、ADR 与旧门禁、`workspaceCwd.js` 的写入口语义 | 先裁 `workspaceCwd.js` 的写者顺序；把「全 TS 迁移路线」那条回填给我们，别重复立票 |
| #1006 | 部分 | `deckQuotaSync.js` 整件加 `wiring.js` 里 deck 调到的行 | `repoKeys.js` 五档分类（通路那摊）；闸的计数与门槛 | 等 #1003 收口后开工；验收六条直接搬成新树断言 |

一句话总结：这五张里真正会「被重构吞掉」的是 #998 正文那十三条审查发现与 #1006 的读数同步那件；#893 是环境的旧账（建议关）；#930 与 #1003 各有一半落在我们范围，且 #1003 与我们在 `workspaceCwd.js` 上有一个写者冲突必须先裁。
