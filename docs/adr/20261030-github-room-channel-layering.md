# ADR：GitHub 房间把传输与读渠道拆成下层，REST 降级按完整度补数据（关联：#1681）

> 日期：2026-10-30 定版（本轮讨论 Q1–Q9 由维护者逐题拍板）
> 地位：GitHub 后端房间（src/tracker/rooms/github/）分层与读渠道语义的唯一依据。凡与本文冲突的旧实现——读与写混在一个编排函数里、降级整块顶掉主路结果、降级即视为「空」、父边修复按标签硬编码——以本文为准；未来任何改动以未来版本的 ADR 为准。
> 关联：规格票 #1681 · docs/adr/20261030-panel-snapshot-single-source.md（同日另一篇：数据层语义）· docs/adr/20261014-tracker-room-boundary.md（房间边界）· docs/adr/20261023-tracker-single-entry.md（单一入口）· docs/adr/20260913-builtin-ts-shape.md（TS 形态）· GLOSSARY.md「读渠道」「读结果」「完整来源」· 调研 research/rest-graphql-read-parity-2026-10-30.md、research/graphql-rest-fallback-2026-10-30.md

---

## 1. 背景

今天 src/tracker/rooms/github/ 有 38 个手写 TypeScript 文件、全部平铺：GraphQL 文档在 queries.ts，REST 端点在 issues.ts / pulls.ts / parent-repair.ts，两种线上形状靠 normalize.ts 同时懂两份格式来消化；listIssues 一个函数里混着 GraphQL 主路、REST 降级、PR 富化、父边修复、归一、名册六件事；读结果只表达「有或没有」，没有来源与完整度，下游无法判断该不该覆盖已知数据。

这带来三类可复现的坏结果：降级会丢掉已经成功的页；父边修复只认 wayfinder:map 标签，规格容器的子票在降级时静默变空壳；想新增一条降级路径要改编排函数，容易漏字段。

等价性调研（research/rest-graphql-read-parity-2026-10-30.md）结论：严格「100% 等价」不成立，github.com 上是有条件等价——

- counts 没有 REST 等价（/issues 混 PR、open_issues_count 混算、search 有 1000 上限且 30 次/分钟）；
- GHES 没有子票 REST，依赖边 REST 从 3.19 起才有；
- github.com 的 list/get 除作者与指派人的 name、评论 edited、列表 blockedBy 需逐票补之外字段可等价；每轮多 14–66 个请求，8 路并发 3–5 秒（串行 10–20 秒）。引用公开额度（5000 次/小时、900 点/分钟）会高估可用余量——插件只拿剩余额度的 35%，读侧每小时只有约 1225 次（见 src/refresh/kernel/host-budget.ts），所以预算必须按插件自己的读额度算（见 §2.3）。

2026-10-30 用一次只读 gh api 抽取 5 行核对：REST 列表行已经带 parent_issue_url、issue_dependencies_summary{blocked_by,blocking,total_blocked_by,total_blocking}、sub_issues_summary{completed,percent_completed,total}——父票边零请求可得；依赖明细只需对计数大于 0 的票逐票拉（本仓 14 张），不会退化成几百次请求。这次核对是一次性命令行核对、未进代码；阶段 0 要把探针固化成门禁用例，落地前按「未验证事实」处理：字段缺失时不补父边，只用上次已知。

## 2. 决策

### 2.1 八类职责九个物理目录，依赖只向下

今日目标结构（目录名按职责自解释；channels/graphql 与 channels/rest 算两个物理目录，故是 8 类职责、9 个物理目录）：

- transport/：gh 命令的唯一出口、超时、重试、限流观测（现 client.ts / budget.ts 收进来）；
- channels/graphql/：GraphQL 文档与请求/响应形状；channels/rest/：REST 端点与请求/响应形状；两者互不 import，也不 import read/、write/、room/；
- routing/：按操作与完整度选渠道、组织降级与合并，读操作只经这里；
- read/：读操作编排（列表、单票、已关闭分页、计数、依赖、子票、标签）；write/：写操作编排；
- model/：归一化后的领域形状、字段三态与合并口径；仓库身份与人员信息经 transport 的客户端取回，本层不直接起进程；
- room/：房间入口与契约接线（backend.ts、能力声明）；
- support/：错误分类、读写日志、用量计数、分页、并发等内部工具。

依赖方向：room → read/write → routing → channels → transport；model 可被 read/write/routing 引用，model 自己可以引用 transport（仓库身份与远端探测经客户端出手，不直接起进程），但 transport 与 channels 不得反过来引用 model；read 可以引用 channels/graphql 与 channels/rest 的请求文档与回包形状（纯数据），渠道选择与降级顺序仍只由 routing 决定；channels 不得引用上游（同层拆文件算本层内引用，允许：例如评论翻页 channels/graphql/comment-paging.ts 引同层 queries.ts）。support 在最底层，不引用房间内任何一层，但任何层都可以引用它（因此 transport 可以引用 support：错误分类与用量计数都住这一层）。#1687 起 write 可以引用 read/ 与 channels/graphql/：写后要读回（getIssue、依赖投影、标签清单、仓库权限），关票原因要先发评论，阻塞边主路是 GraphQL mutation、写层必须自己声明请求与回包形状；room/ 可以引用本层（入口、装配、检查表三个文件互相引用）。由现有依赖门禁（verify-dependency-rules.ts 与 .dependency-cruiser.ts）扩展硬卡。

### 2.2 读结果带来源与完整度

新增读结果类型：数据 + 来源渠道 + 完整度（完整 / 截断 / 降级 / 部分失败）+ 缺失字段清单 + 耗时 + 取数开始时的快照版本。

- 完整 = 该操作所问范围被完整答全；截断 = 有上限未取全；降级 = 走了备路；部分失败 = 有页或字段没拿到。
- 完整度按字段组给：REST 完整的整仓枚举能证明某票不存在，但不能证明 blockedBy 为空；「恰好整数页」不算完整，需要空页探测或页数上限才能判定。
- 下游（面板快照）只允许对「完整」结果做删除与清空，其余只能补（见面板快照 ADR）。
- 每个读操作的可用渠道与结果类型由操作百科单一真源声明，门禁从它枚举，不手写读操作清单。

### 2.3 降级只补不删

- REST 降级结果不再整块顶掉 GraphQL 已知数据：按字段组合并，补得到的字段写上来源，补不到的字段标未知。
- 最便宜的三步先做：列表行的 parent_issue_url 零请求补父边；issue_dependencies_summary 计数大于 0 的票逐票拉 dependencies/blocked_by；按需细节（评论正文、PR 评审）只在人打开时补，子票清单沿用快照已有。
- 并发有上限（8 路）；预算按插件自己的读额度算：常规增量一轮 ≤3 个请求，整仓完整枚举一轮 ≤16 个（列表最多 10 页、拉取请求 1、标签 1、当前用户 1、终止探测最多 1、余量 2），单次详情补取 ≤5 类请求；降级期探针从 5 秒降到 60 秒，自动整仓校准间隔 ≥10 分钟。超预算时只补当前视图需要的字段，不追一轮全量。

### 2.4 规格容器按「正文标记优先、标签兜底」识别

父边修复不再按标签 wayfinder:map 硬编码，改为先看正文里的容器标记、没有标记再按标签兜底；规格容器与地图容器一样补父子边。

### 2.5 范围限制

- 只重构 GitHub 房间；GitLab 与 Markdown 只跟随契约与兼容，不做跨后端通用框架。
- 不做的：counts 的 REST 等价（完整 REST 枚举时本地重算并标「本地枚举」来源；枚举不完整时保留旧值、时间与待校准标记，界面不静默派生冒充完整）、GHES 子票与依赖的等价（改为运行时能力回答：探测服务端版本后返回不支持/部分支持并带原因与能力票号）。

### 2.6 形态与纪律

- 新文件只写 TypeScript；动到的旧 JS 按仓规先修后转、两次提交。
- 单个文件不超过 350 行（现有门禁）；依赖图唯一真源仍是 .dependency-cruiser.ts；房间能引哪些房外目录登记在 tests/tracker-room-imports.json；注释与日志按仓规，穿过边界的整趟轨迹要能只看日志定位。
- 写路径按现状登记、本次只做结构分层不改主通道：建票 REST POST；评论 REST 优先、失败转 GraphQL；阻塞边 GraphQL mutation 优先、REST 兜底；关闭/重开走 gh issue close/reopen；父子边走 gh issue edit --parent / sub_issues DELETE，失败按 REST 兜底。

## 3. 门禁（怎么判）

- tests/verify-room-layering.ts（新增）：8 类职责、9 个物理目录存在，依赖方向正确，channels 不引用 read/write/room，transport 是唯一 gh 出口（扩展现有 verify-gh-gateway.ts）。
- tests/verify-read-result-provenance.ts（新增）：每个读操作返回来源与完整度；缺来源即红；降级路径必须标降级，不许标完整；读操作清单从操作百科枚举（阶段 0 补读写标记与结果类型）。
- tests/verify-fallback-merge.ts（新增）：先构造 GraphQL 完整结果、再喂同一范围 REST 降级结果，断言行数、父边、已经成功的页、子票计数都不减少；规格容器父边按「正文标记优先、标签兜底」修复。
- 扩展 tests/verify-github-rest-fallback.ts：今天只断言 150 行、parentKey、html_url、type；补 blockedBy 不缩、评论正文保留、sub_issues_summary 补齐的断言。
- 新增门禁必须能红能绿：每个新增门禁都带负例，先按旧行为写红，再修到绿。

## 4. 取代的旧结论

| 旧结论 | 出处 | 新结论（本文） |
|---|---|---|
| 任何数据通道迁移必须同步保留降级通道 | docs/research/424-refresh-dual-channel-spec.md §73 | 保留之外还要保住已知数据，并带完整度标记 |
| 降级时 blockedBy 写成空数组、诚实可读 | 同上 §Out of Scope | 已知依赖保留，未知才标未知 |
| 父边修复只认 wayfinder:map 标签 | parent-repair.ts | 正文标记优先、标签兜底 |
| 读与写混在同一个编排函数、两种协议都在里面 | listIssues 等 | channels 只管形状，routing 决定顺序，read/write 编排 |
| 降级结果整块替换主路结果 | 现有实现 | 按字段组合并，只补不删 |
| 预算照公开额度（5000 次/小时）算 | 现有讨论 | 按插件自己的读额度（约 1225 次/小时）算 |
| counts 拿不到就按池子派生 | 现有实现 | 完整枚举时本地重算并标来源；否则旧值 + 时间 + 待校准 |

## 5. 后果与缺口

- 每轮多 14–66 个请求、慢 3–5 秒，换来不丢数据；调用方需要接受「部分字段未知」。
- counts 与 GHES 仍是诚实缺失，界面要按未知渲染而不是冒充完整。
- 迁移必须分阶段、每阶段行为等价、门禁先红后绿；顺序与对抗式审查清单见计划文档。
- 其它后端不跟进这次分层，契约面保持兼容。

## 6. 变更记录

- 2026-10-30 定版：Q1–Q9 拍板；八目录分层与「降级只补不删」作为结论落盘。
- 2026-10-31 回填规格票 #1681：改为「8 类职责、9 个物理目录」；预算改按插件读额度；父边与依赖摘要标为阶段 0 真机探针；counts 诚实与 GHES 运行时能力；写路径按操作现状登记。
- 2026-10-31 阶段 1 第二批（#1686）：support/ 先落位错误分类（errors.ts）、读写日志、用量计数、能力登记、初始化错误分类；transport 允许引用 support（错误分类与用量计数都在这一层，方向仍是「上层引底层」）。原本打算放进 support/ 的幂等键与评论分页要调用 gh 客户端，按「support 不依赖任何层」的边界改放 routing/ 与 channels/graphql/。
- 2026-10-31 阶段 1 第二批（#1686）：model/ 迁入归一化（normalize.ts）、名册（roster.ts）、依赖环检查（cycle-check.ts）与仓库身份（repo.ts）；错误分类按票面「读写共用支撑」的定位留在 support/，不放进 model/。因为仓库身份要经客户端问远端，model 允许引用 transport（transport 不许反过来引用 model），这条依赖方向已同步写进第 2 章。read/ 迁入 page、counts、sub-issues、deps-read、maps、parent-repair 六个读实现；它们直接引用 channels 的两份只读形状与请求文档（纯数据），因此 read 允许引用 channels/graphql 与 channels/rest，渠道选择仍只由 routing 决定，这条也同步写进第 2 章。
- 2026-10-31 阶段 1 第二批（#1686）：routing/ 迁入幂等锚回查（idempotency.ts）：它要先选读或写、再经客户端发请求，属于路由层的取数决策；channels/graphql/ 迁入评论翻页（comment-paging.ts）：只拼 GraphQL 查询文本与校验回包，属于协议形状层。原来把这两个文件放进 support/ 的打算作废——support 不依赖任何层，而它们都要调 transport 的客户端；channels/graphql 因此允许引用本层（同层拆文件），这条已同步写进第 2 章。旧路径都保留纯转发。

- 2026-10-31 阶段 1 第二批（#1686）：read/ 最后四个读实现（preflight.ts、pulls.ts、repo-permissions.ts、issues-rest-list.ts）迁入；标签读侧（listLabels 及其帮手）从 label-colors-ops.ts 拆出为 read/labels.ts，那个文件只留写侧的 setLabelColors 并继续转发读侧名字，两条操作的命令形状、失败档位与话术一字未改。到此 read/ 该有的文件全部落位，旧平铺路径都只是纯转发，等 #1687 收口；这些读实现仍经 transport 起 gh、经 channels 取请求文档与回包形状，没有新增依赖方向。
- 2026-10-31 阶段 1 第三批（#1687，阶段 1 收口）：写实现全部迁入 write/——建票 issues、评论 comments、关闭原因 close-reason、标签写侧 labels、阻塞边 blocked-by-write、初始化 init-project、父子边与阻塞边编排 graph，成环检查 cycle-check 从 model/ 改放 write/（它是写动作的前置判断，且 model 不许引用 read），标签配色只留写侧的 setLabelColors 为 label-colors；房间入口与契约接线迁入 room/（backend、index、checks）。read/ 收 issues.ts（列表与单票）与 read-sources.ts，getDependencies 从 graph.ts 并入 read/deps-read.ts；预算读数 budget.ts 收进 transport/（它只是一次 gh 调的薄读数，且 transport 不许引用 routing，来源与完整度由 room/backend.ts 挂上）；降级原因分类 fallback-reason.ts 进 routing/；读写两侧共用的 owner/name 解析抽成 model/issue-key.ts（原来三处一字不差的副本合一）。写路径主通道一字未改：建票 REST、评论 REST 优先、阻塞边 GraphQL 优先、关闭与重开走 gh 命令、父子边 gh 命令为主 REST 兜底。
- 2026-10-31 阶段 1 第三批（#1687）：write 的允许依赖扩三格并写进第 2.1 节——write 自身（关闭原因先发评论、父子边与阻塞边编排互调）、read/（写后读回：getIssue、依赖投影、标签清单、仓库权限）、channels/graphql/（阻塞边主路是 GraphQL mutation，写层要声明请求与回包形状）；room 允许引用本层。read 的两条读来源白名单清零：getCurrentUser 与 readBudget 接上来源与完整度，十二条读操作全部 wired，tests/verify-read-result-provenance.ts 升至 294 项断言。
- 2026-10-31 阶段 1 第三批（#1687）：房间根 41 个旧平铺路径的纯转发文件全部删除，房间根不再有平铺源码文件；tests/verify-room-layering.ts 增加三类判据（房间根零平铺、房间内不许从旧路径导入、房间外也不许从旧路径导入）并补齐对应负例；src/、tests/、scripts/ 里的导入与注释全部改指九目录新路径，门禁地图与文件粒度基线按最终树重录；阶段 1 行为零变化。
- 2026-10-31 复审修复（#1681 收口后）：整仓 REST 枚举在满十页且尾页满时多打一页空页探测（探测为空即完整、非空仍截断、探测失败与页失败分开记；该请求只受房间上限约束，不进宿主 16 请求预算）；通知事件库拆成 src/host/notifications.ts 接线叶子，房间加载钩子由宿主入口注入（房间只许入口深引），入口→接线叶子这条装配扇入登记进同层存量清单（存量 83→82 条，同票删两条失效条目）。逐条见收口文档第 9 节。

## 7. 收口记录（2026-10-31，票 #1700）

- **核对人**：规格 #1681 收口票 #1700 的实施会话（工作树 `.worktrees/1700`，分支 `feat/1700-closeout`，起点 `fc2ff4cf`）。
- **核对范围**：本 ADR 的渠道分层、读结果来源与完整度、REST 降级补齐、请求预算、计数诚实、企业版运行时能力回答逐条对照实现与门禁，并用本仓真实数据演练一遍（1659 张工单 + 64 个拉取请求，检索时刻 2026-10-31T14:23:12+08:00）。
- **结论**：九目录分层落地并由 `verify-room-layering` 硬卡（#1684–#1687），十二条读操作全部带来源与字段组完整度（`verify-read-result-provenance` 316 项）；REST 降级补齐完成——列表父边读行内链接零请求、依赖只对四格任一大于零的票逐票拉一次、详情评论/依赖/评审/合并时间四类各最多一次请求、补不到记未知不写空（#1691，`verify-rest-fallback-completion` 46 项、`verify-rest-detail-completion` 61 项）；请求预算与 8 路并发、探测/校准窗口按插件读额度落地并被门禁同源读取（#1689，`verify-fallback-fetch-budget` 101 项）；计数诚实改为「完整枚举本地重算并标来源、拿不到保留上次已知并标待校准、界面不显示假零」（#1698，`verify-counts-honesty` 52 项）；企业版走运行时探测回答支持/部分支持/不支持并带原因与能力票号（#1698，`verify-ghes-runtime-capability` 39 项）。
- **真实演练**：本仓真实列表与单票降级、合并、投影、写回执（模拟）与通知落盘六步全通，84 行日志按五段口径可定位每一步；依赖与子票端点为不打扰真实仓库按即时失败注入，未真打。
- **全链**：`npm run verify:parallel` 480 步、集成分支真红 0、冒烟 5 条真红 0；票级分支 `tests/verify-no-mixed-session.ts` 判红是结构性已知红（`docs/agents/parallel-sessions.md:46`）。
- **剩余缺口与已知边界**：counts 与 GHES 无 REST 等价（本 ADR 明确不做，只要求诚实）；企业版无真机，按夹具；跨容器阻塞者首帧不显示与已关闭容器首帧子票为空是规格 §13 的现行口径；逐条见 `docs/design/20261030-panel-snapshot-closeout.md` 第 7 节。
