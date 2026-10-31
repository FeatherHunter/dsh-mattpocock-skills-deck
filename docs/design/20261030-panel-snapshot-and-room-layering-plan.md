# 面板快照与 GitHub 房间分层：迁移计划（2026-10-30 讨论定版后编制）

> 日期：2026-10-30 编制（承接同日两份 ADR；语义以 ADR 为准，本文只写顺序、每阶段门禁与对抗式审查）
> 地位：迁移顺序与阶段验收的唯一依据；与两份同日 ADR 冲突时以 ADR 为准。
> 关联：规格票 #1681 · docs/adr/20261030-panel-snapshot-single-source.md · docs/adr/20261030-github-room-channel-layering.md · 调研 research/graphql-rest-fallback-2026-10-30.md · research/rest-graphql-read-parity-2026-10-30.md

## 1. 目标与验收

四条维护者要求是最终验收判据（原话要点）：

1. REST 降级时不允许减少 GraphQL 已经查到并显示出来的数据（例：3 个子票降级后不能变 0）；
2. 进入 MAP 详情先继续显示列表页已经知道的阻塞关系，新查询回来再更新；
3. ISSUE 详情里把票关闭后，回到列表立即显示已关闭；
4. ISSUE 详情请求回来后留下永久快照，之后的请求按增、删、改合并，不要每次进入都空白。

通用完成判据：

- `npm run verify:parallel` 全链为绿，不允许任何「已知红」。
- 每条新增门禁都能红能绿：每个新增门禁都带负例，先按旧行为写红，再修到绿；不能只删不增。
- 用本仓真实数据演练一遍（收口日 2026-10-31T14:23:12+08:00 实测 1659 张工单 + 64 个拉取请求），当天导出的日志能支持「只看本地诊断日志定位每一步」。
- 规格票 #1681（2026-10-30 发布）已建立；票号已回填两份 ADR 与本文档。

## 2. 阶段与门禁

| 阶段 | 产物 | 先写红的门禁 | 行为变化 | 对抗式审查重点 |
|---|---|---|---|---|
| 0 真机探针与唯一真源 | 列表行 parent_issue_url、issue_dependencies_summary、sub_issues_summary 三个字段的真机探针与夹具；操作百科补读/写标记、可用渠道与结果类型；术语「通知中心」「通知事件」 | tests/verify-github-rest-fallback.ts 的 #1682 段：读 tests/fixtures/1682/ 两套夹具与 probe-metadata.json，断言字段有则解析、无则走上次已知或标拿不到（解析器在 src/tracker/rooms/github/channels/rest/list-row-metadata.ts，阶段 0 不接 list/get）；tests/verify-operation-catalog.ts、tests/verify-glossary-terms.ts（#1683 落） | 无 | 探针结论是否被当成已证事实；字段缺失退路是否写明 |
| 1 GitHub 房间内部分层 | transport/、channels/{graphql,rest}/、routing/、model/、read/、write/、room/、support/ 落位；读结果类型带来源与完整度 | tests/verify-room-layering.ts（#1684 落 20 项含 10 条负例，本票补到 21 项含 11 条负例）、tests/verify-read-result-provenance.ts（本票新落：从操作百科枚举读操作、缺来源字段即红；已接的 3 条读路径登记 wired，其余 9 条先按白名单登记——#1686 七条、#1687 两条，随读侧搬迁逐条清零） | 无行为变化，只换结构 | 依赖旁路、唯一出口被绕过、同一输入输出行为一致 |
| 2 宿主面板快照合并层 | 合并纯函数（字段三态、完整来源判定、字段组的来源与时间）、版本门、磁盘回放扩展（来源随盘、旧格式按未知、按需细节按上限淘汰并留「曾取过」记号） | tests/verify-panel-snapshot-merge.ts、tests/verify-1692-disk-replay-eviction.ts（#1692 落：格式版本与来源、旧格式按未知照读、LRU 淘汰与「未取（曾在某时）」） | 快照可合并、可回放；视图暂不切换 | 降级来源误删已知、完整来源判错、过期结果回退、并发写入顺序 |
| 3 客户端收编为单一读源 | issueCache 与地图子票桶退役为投影；陈旧先显示；写回执合并；TTL 改为只触发后台刷新；读投影回滚开关 | tests/verify-single-read-source.ts、tests/verify-detail-incremental.ts、tests/verify-acceptance-four.ts | 四条要求落地；界面改读投影 | 四条要求逐条演练；双源回流；回滚开关两条路径都能跑 |
| 4 REST 降级补齐 | 列表 parent_issue_url 零请求补父边；依赖计数大于 0 逐票拉；按需细节按需补；规格容器按「正文标记优先、标签兜底」修父边；预算按插件读额度（常规增量 ≤3、完整枚举 ≤16、详情 ≤5 类、8 路并发、降级探针 5s→60s、自动校准 ≥10min） | tests/verify-rest-fallback-completion.ts（46 项）、tests/verify-rest-detail-completion.ts（61 项）、扩展 tests/verify-github-rest-fallback.ts | 降级结果只补不删，已知数据不缩 | 请求预算与 8 路并发上限；GHES 能力标记；降级误标完整 |
| 5 通知中心 | 事件先落库再呈现；事件库宿主持久化、工作区共享；当前状态仍从快照派生；未读入口；浮层历史；toast 只做回声；退役占行横幅 | tests/verify-notification-center.ts、改造 tests/verify-rest-fallback-banner.ts | 降级、刷新失败、写失败改为通知呈现，不再占列表行 | 事件不丢；去重与恢复配对；三条诚实约束（只有配额原因才提配额、超时改口「上次」、本次会话可关） |
| 6 收口 | 全链、真实数据演练、文档更新、ADR 回填规格票号 | 全链复跑 | 无 | 四条验收重放；门禁摘要可读 |

阶段 0 已于 2026-10-31T03:04:23–03:07:52（+08:00，gh 2.97.0，只读）完成真机探针：仓库规模 1627 张工单 + 64 个拉取请求（该时点实测；收口日 2026-10-31T14:23:12+08:00 复测为 1659 张工单 + 64 个拉取请求，差额来自实施期新建票），两页 200 行（187 张工单 + 13 个拉取请求）。parent_issue_url 出现在 73/187 张工单行，114 张顶层工单整个键不出现，13 个拉取请求行也没有；issue_dependencies_summary 与 sub_issues_summary 出现在 187/187 张工单行、0/13 个拉取请求行。故意让尾页失败一次（代理指向 127.0.0.1:1 请求第 3 页）得到退出码 1、117 毫秒、stdout 0 字节、一条 proxyconnect 拒绝连接，前两页 200 行保留；与生产 3.1–3.3 秒 EOF 同类。结论：字段出现性必须按整页判断，拉取请求行标不适用，依赖按四格任一大于 0 才逐票拉；缺失退路按规格阶段 4 口径。夹具与门禁见上一行，阶段 0 行为不变。

阶段 0 先做，是因为父边与依赖摘要的字段可用性决定阶段 4 的实现路径；阶段 1 其次，因为「来源与完整度」是后续所有合并判断的输入；阶段 2 与阶段 1 可以并行推进（不同人/不同子代理，写范围不相交），但阶段 3 必须等阶段 1 与阶段 2 都绿；阶段 4 依赖阶段 1 的渠道分层；阶段 5 独立，可随时插队。

## 3. 四条维护者要求的验收对照

| 要求 | 现状 | 目标 | 怎么验 | 阶段 |
|---|---|---|---|---|
| 1 降级不缩数据 | REST 降级后关系与子票计数丢失（0/3 → 0/0） | 已知数据保留，未知标未知 | verify-rest-fallback-completion 与 verify-rest-detail-completion 构造降级前后对比；verify-acceptance-four 走真实快照 | 2–4 |
| 2 地图详情先显示已知阻塞 | 加载期间先空，回来才画 | 先画快照里已知的阻塞关系，返回后合并 | verify-acceptance-four（假数据驱动视图） | 3 |
| 3 详情关闭立即回列表 | 要等整仓刷新 | 写回执合并后同一快照立即一致 | verify-detail-incremental | 3 |
| 4 详情永久快照增量合并 | 每次进入空白 | 磁盘与内存快照 + 增删改合并 | verify-detail-incremental、verify-1692-disk-replay-eviction | 2–3 |

## 4. 对抗式审查机制（每阶段必须做）

- 每个阶段结束后，派一个没有实现上下文的子代理：只给它两份 ADR 的判据、本阶段 diff、测试命令，要求它列出反例并逐条判定；再派一个只写探针的子代理（降级、截断、部分失败、并发、重启五类输入）验证行为。
- 审查结论逐条写回规格票：结论 + 证据（命令输出、日志行、门禁红绿），不许只写「通过」。
- 11 条开发规则逐条对照，作为审查清单：
  1. 改到 JS 就重构为 TS：阶段内新增文件全 .ts，动到的 JS 先修后转、两次提交；
  2. 结构符合纯 TS 项目的权威做法：ADR §2.1 的目录职责与依赖方向；
  3. 数据结构：字段三态、来源与时间显式建模，不靠魔法值；
  4. 算法：合并按字段组线性合并，分页用迭代器，并发有上限；
  5. 设计模式：纯函数内核 + 外层 I/O；渠道选择集中在 routing；
  6. 架构师思维：先门禁后实现，先数据后界面；
  7. 第一性原理：以「不丢已知数据」为准绳，不以现有代码形状为约束；
  8. 过程有对抗式审查：本节第 1 条的子代理机制；
  9. 目录、目录名、文件名自解释：按职责命名，不按技术栈缩写；
  10. 不过度发散：只做 ADR 范围，其它后端与完整通知系统不做；
  11. 充分封装解耦、组件可复用：channels 与 transport 被读、写两条路复用；合并纯函数被宿主与投影共用。

## 5. 风险与回滚

- 快照体积：按需细节设条数与字节上限、LRU 淘汰、超限记日志。
- 磁盘旧数据误导：界面显示来源与时间；校准失败进通知中心。
- 双源回流：verify-single-read-source 用运行时不变量与纯投影测试防住；阶段 3 完成后删除旧缓存代码。
- 请求预算超支：预算常量住额度模块（src/refresh/kernel/host-budget.ts），不新建 YAML；时间值走 config/intervals.yaml 与生成器；超预算只补当前视图字段。
- GHES 与 counts 缺口：能力表标记，界面按未知渲染，文档写清。
- 回滚：每阶段独立提交、可单独 revert；阶段 3 留一个「读投影开关」（默认新路径），出问题切回旧路径。
- 通知中心清理挂在写/读/刷新节拍上，不新增后台定时器（docs/adr/20260924-refresh-budget-architecture.md 的 I2）。
- 迁移期中间态难看：阶段 0–2 行为不变；阶段 3 一次切换，不并行双写。

## 6. 不做的范围

- 不改读操作在额度闸里的渠道放行判定（另票）；不改额度记账、桶与占比。
- 版本控制页、设置、技能、检查链不纳入面板快照。
- 不做跨后端通用分层框架；GitLab 与 Markdown 不动。
- 通知不做系统级或桌面通知（宿主未暴露该能力），只做面板内通知中心。
- 不追求 counts 与 GHES 的 REST 等价。

## 7. 变更记录

- 2026-10-30 编制：承接两篇 ADR，定六阶段顺序、每阶段门禁与对抗式审查清单。
- 2026-10-31 阶段 0 探针完成（#1682）：两页 200 行真机夹具脱敏入库；字段出现性按整页判断、拉取请求标不适用、依赖四格判明细；尾页失败形状与生产 EOF 同类；阶段 0 行为不变，探针断言并入 tests/verify-github-rest-fallback.ts。
- 2026-10-31 回填规格票 #1681：补阶段 0 真机探针；预算改按插件读额度；通知中心持久化与清理口径；验收改「不允许任何已知红」；回滚开关与双源门禁描述。
- 2026-10-31 阶段 0 补记（#1683）：操作百科成为读操作唯一真源——24 条操作带读/写标记，12 条读操作带渠道、结果类型、字段组与记账口径；额度闸的读名单改为从百科派生，三个后端的读来源登记同源；术语表补「通知中心」「通知事件」与按需细节淘汰例外；新增门禁 tests/verify-operation-catalog.ts（21 项断言、6 条负例）与 tests/verify-glossary-terms.ts（5 项、3 条负例）并入链。
- 2026-10-31 阶段 1 第一批（#1684）：GitHub 房间建九个物理目录（transport、channels/graphql、channels/rest、routing、read、write、model、room、support）；gh 客户端搬入 transport/client.ts，成为房间唯一的 gh 进程出口；旧平铺路径只留纯转发；新增 tests/verify-room-layering.ts（20 项断言含 10 条负例）；7 扇按源码路径写死的门禁改指 transport/；阶段 1 行为不变。
- 2026-10-31 阶段 1 第二批（#1685）：GraphQL 查询与 REST 列表行形状分别收进 channels/graphql/queries.ts 与 channels/rest/list-row-metadata.ts，旧路径只留纯转发；两条通道各落 read-shapes.ts 完整度判据（互不引用），routing/read-assembly.ts 归一出统一读结果；整仓列表、单票、按页取票三条读路径交出实际来源、按字段组完整度、缺失字段组、耗时、取数开始版本与降级来源，其余 9 条读操作按白名单登记（#1686 七条、#1687 两条）；触端点上限一律记截断——REST 整仓列表触 10 页上限、GraphQL 单票依赖触每侧 50 条、单行标签触 50 条、标签清单触 1000 条、子票触 1000 条；已关闭票翻页只加来源与完整度，不把按更新时间增量扩展到 listPage；新增 tests/verify-read-result-provenance.ts（251 项断言）并入链，门禁地图重录；阶段 1 行为零变化。
- 2026-10-31 阶段 1 第三批（#1687，阶段 1 收口）：写实现、房间入口与写侧支撑全部进职责目录——write/ 收建票、评论、关闭原因、标签写侧、阻塞边、初始化、父子边与阻塞边编排、成环检查与标签配色写侧，room/ 收入口、装配与检查表，read/ 收 issues 与 read-sources、getDependencies 并入 read/deps-read，预算读数进 transport/，降级原因分类进 routing/，owner/name 解析抽成 model/issue-key.ts；写路径主通道按 ADR §2.6 原样保留（只换位置不改路径）。房间根 41 个旧路径纯转发文件全部删除、房间根零平铺源码，src/、tests/、scripts/ 里不再有指向旧平铺路径的导入与注释；tests/verify-room-layering.ts 新增「房间根零平铺」「房间内外都不许从旧路径导入」判据并补负例；#1685 留下的 getCurrentUser 与 readBudget 两条读来源白名单清零，十二条读操作全部 wired（tests/verify-read-result-provenance.ts 294 项断言）；门禁地图与文件粒度基线按最终树重录；阶段 1 行为零变化。
- 2026-10-31 阶段 1 第二批（#1686）：模型、读实现与读写共用支撑迁入职责目录——六个共用支撑（错误分类 errors、读日志 read-log、写日志 write-log、用量记账 op-usage、能力注册表 capability-register、初始化错误种类 init-project-error-kinds）进 support/；四个模型件（归一化 normalize、名册 roster、环检查 cycle-check、仓库身份 repo）进 model/；十个读实现（page、counts、sub-issues、deps-read、maps、parent-repair、preflight、pulls、repo-permissions、issues-rest-list）进 read/，标签读侧从 label-colors-ops.ts 拆出 read/labels.ts（旧文件只留写侧并具名转发读侧名字，等 #1687 再变纯转发）；幂等重放搬 routing/idempotency.ts，GraphQL 评论翻页搬 channels/graphql/comment-paging.ts；旧平铺路径全部保留纯转发（行为零变化）；依赖方向按 ADR 授权放宽并在 ADR 第 6 节留记录（model 可引用 transport、support 收纳错误分类、read 可引用 channels、各层可引用自身）；#1685 留下的七条读来源白名单全部清零（预检、依赖、标签清单、计数、仓库权限、子票、地图），十条读操作接上来源与完整度，白名单只剩 getCurrentUser 与 readBudget 两条留 #1687；tests/verify-read-result-provenance.ts 升至 265 项断言，按源码路径写死的门禁、文件粒度基线与门禁地图同步重录；阶段 1 行为零变化。
- 2026-10-31 阶段 4 第一批（#1689）：降级取数的请求预算、8 路并发与探测/校准节流落成与宿主额度账本同源的常量——src/refresh/kernel/host-budget.ts 新增 FALLBACK_FETCH_LIMITS（常规增量 ≤3 条请求、完整枚举 ≤16 条、单次详情 ≤5 类、并发 8 路），两个时间窗口走 config/intervals.yaml 的 fallbackProbeIntervalMs=60000 与 fallbackCalibrationIntervalMs=600000；纯算法内核 src/refresh/kernel/fallback-fetch-budget.ts 提供轮预算台账（发出前预扣、收到后按实际条数校正、失败也回填，读与写分桶不混记）、8 路并发闸（超出排队、一条不丢）与两个节流窗口判据；探测与校准挂在现有 probe-handler 探测拍上（不新增后台定时器），降级常驻时整仓探测 5 秒放宽到 60 秒、自动校准至少隔 10 分钟，增量轮预算透传 row-patch / thin-row-fetch 逐条记账；新增门禁 tests/verify-fallback-fetch-budget.ts（101 项断言，含超预算拒发与 20 条并发峰值 ≤8 的负例）。完整枚举 16 与详情 5 类已经接到真实取数路径：issue-list-fetch.ts 的索引翻页逐页预扣、收到校正、失败回填（带 since 的窗口探测记增量 3 条，不带 since 的整仓枚举记 16 条，第 17 页停翻并回可诊断的截断位置）；issue-detail-fetch.ts 的 get 与 getDependencies 两类按类预扣（第 6 类、同类重复一律拒发并留痕，回包带账本读数与被拒类名）；门禁用 stub 执行器真跑这两条路径（第 17 页拒发、第 6 类拒发、同类去重只发一次），断言总数升到 101 项。房间读实现内部的 REST 翻页仍按既有上限各自记账，逐页预算合并与字段补齐留给 #1691。
- 2026-10-31 阶段 2 第二批（#1692）：磁盘快照格式升到第 4 版，随盘带整仓级来源、完整度与写盘时刻——diskMeta 从 merge 组戳聚合（单一来源记名、多种记 mixed、超过 3 种塌成整仓级不逐条膨胀、完整度取最保守一档），旧第 3 版文件照读并按「来源未知 / 完整度未知」回放，文件里已有字段一个不删；新字段只走信封，snapshot.version/etag 与合并协议 snapshot.merge 都不碰（这两条由门禁 A9/A10/A36 钉住）。回放出来的内容在面板降为「上次已知（HH:mm）」一句话；详情页对已淘汰的行说「未取（曾在 HH:mm）」，不画成空白。行上按需细节（正文、评论、评审、子票清单）按条数 200、字节 512KB 两把尺子做 LRU 淘汰（本轮真取到的行打新时间戳），只淘汰内容、行上写 detailEvicted 记号（何时淘汰、淘汰哪几栏、上次已知时刻），行本身、父子边、依赖边、子票计数、地图行与地图统计永不淘汰；清理挂在读盘、写盘、行级写回三处既有拍子上，不新增后台定时器。新增 tests/verify-1692-disk-replay-eviction.ts（85 项断言，含旧格式按未知照读、来源超限塌缩、骨架不淘汰、二次跑零淘汰等负例）并入链；refresh.patch 与 snapshot.cache.hit 两处既有事件扩字段、事件总数不变（常驻 72、按需 63、自监控 5、总 140）。
- 2026-10-31 阶段 2 第一批（#1690）：快照合并纯函数成为唯一写入入口——`src/refresh/kernel/snapshot-merge.ts` 的 `mergeSnapshot(snapshot,input)` 按字段组（row/body/labels/parents/dependencies/subIssues/comments/review/mergeInfo 九组）合并，四类结果（新增/修改/删除/保留）显式可断言，整行替换退役；版本门覆盖所有字段组写入（含值回退），过期结果整份丢弃并记日志；只有完整来源允许删除或清空，非完整来源只补空缺；内容版本号单调递增，信封契约版本与 etag/304 语义不动。新增 tests/verify-panel-snapshot-merge.ts（80 项断言，含四类结果各一例、读写两条路径、降级不缩数据与先红后绿证据）；行为变化：快照可合并。
- 2026-10-31 阶段 4 第二批（#1691）：REST 降级补齐——列表父边读行内 parent_issue_url 零请求补，依赖只对四格任一大于零的票逐票拉一次、全零记已知空，子票计数用行内摘要不翻页；详情评论/依赖/评审/合并时间四类按需补、每类最多一次请求，补不到记未知不写空；规格容器按正文标记优先、标签兜底识别，只对已打开容器补子票；降级结果只补不删，已知关系不缩。新增 tests/verify-rest-fallback-completion.ts（46 项）与 tests/verify-rest-detail-completion.ts（61 项），扩展 tests/verify-github-rest-fallback.ts；行为变化：降级结果更完整。
- 2026-10-31 阶段 5 第一批（#1693）：通知事件库落地——`src/refresh/kernel/notification-events.ts` 定义事件身份与恢复配对，`src/refresh/rooms/host/notification-store.ts` 复用快照信封落盘、按工作区共享；事件先落库再呈现，当前是否降级仍从快照派生。新增 tests/verify-notification-events.ts（102 项断言）；行为变化：降级、刷新失败、写失败开始进事件库。
- 2026-10-31 阶段 3 第一批（#1694）：详情读投影与永久快照增量合并——详情取数经 `src/refresh/rooms/host/detail-snapshot-merge.ts` 走合并唯一入口写回快照，客户端 `detailProjection` 从快照投影详情，进入先画上次内容并标注上次数据与时间，失败不清空；写回执合并后列表/地图/详情同帧一致；读投影开关默认新路径、legacy 可回滚。新增 tests/verify-detail-incremental.ts（31 项）、tests/verify-single-read-source.ts（23 项）、tests/verify-acceptance-four.ts（27 项，四条维护者要求联合门禁，走真实快照路径）；行为变化：四条要求落地，界面改读投影。
- 2026-10-31 阶段 3 第二批（#1695）：旧详情缓存与地图子票桶退役为投影——快照模式不再读写 `issueCache`，TTL 只触发后台重取、不清空不阻塞显示；地图子票桶改按编号增量合并，不再整桶替换；快照顶层字段白名单与会话呈现态黑名单落地（打开中的票、筛选、草稿、布局、后端模块选择不进共享快照）。新增 tests/verify-retire-client-caches.ts（39 项），tests/verify-single-read-source.ts 升到 25 项；行为变化：读路径只读投影。
- 2026-10-31 阶段 3 第三批（#1696）：地图详情首帧显示快照已知阻塞关系与计数——宿主把子票行归一成首帧可画形状（数字票号、阻塞者转数字、反推「我挡住谁」、逐票 level、五组计数），列表截断或降级时按编号补回上次已知子票行与计数（只补不删），已关闭容器首帧子票为空口径不动；新增 tests/verify-map-first-frame.ts（41 项）与 tests/verify-map-first-frame-freshness.ts（39 项，真投影驱动渲染、排在构建之后）；行为变化：地图详情首帧不再空白。
- 2026-10-31 阶段 5 第二批（#1697）：通知中心界面落地——面板头部未读徽标进折叠阶梯、历史覆盖层、toast 只做回声，三条诚实约束（只有配额原因才提配额、超过一小时改口上次、本次会话可关）由词表与门禁钉住；tests/verify-notification-center.ts 83 项；行为变化：降级与失败改由通知中心呈现。
- 2026-10-31 阶段 4 第三批（#1698）：计数诚实与企业版运行时能力回答——完整枚举时本地重算并标来源，拿不到保留上次已知并标待校准，界面缺失显示「未知」而不是假零；数字与行数据冲突时以行数据为准并留痕；企业版按运行时探测（`/meta` 的 `installed_version`）回答支持/部分支持/不支持并带原因与能力票号，运行时不读静态能力表。新增 tests/verify-counts-honesty.ts（52 项）与 tests/verify-ghes-runtime-capability.ts（39 项）；行为变化：计数与能力回答诚实。
- 2026-10-31 阶段 5 第三批（#1699）：列表内降级提示行退役为头部行内小标识，旧门禁改为真渲染通知断言；行为变化：降级提示不再占列表行。
- 2026-10-31 阶段 6 收口（#1700）：30 条验收逐条核对、七个阶段结论、五类输入×五段日志核对、真实数据演练（1659 张工单 + 64 个拉取请求，检索时刻 2026-10-31T14:23:12+08:00）、已知红清零与文档真数回填。新增 tests/verify-closeout-acceptance.ts（20 项，验收矩阵与文档真数）与 tests/verify-closeout-log-trips.ts（34 项，降级/截断/部分失败/并发/重启五类输入各一趟、五段缺段即红）；四条维护者要求联合门禁 verify-acceptance-four（27 项）随全链通过。

## 8. 收口记录

- **时间**：2026-10-31T14:20–14:50（+08:00）；**执行**：收口票 #1700 实施会话（工作树 `.worktrees/1700`，分支 `feat/1700-closeout`，起点 `fc2ff4cf`）。
- **核对内容**：30 条验收逐条有判据门禁与负例（`tests/fixtures/1700/closeout-matrix.json` 30 行，编号连续、七个阶段齐全、引用门禁 30/30 在链）；七个阶段产物与门禁逐条对照；五类输入（降级、截断、部分失败、并发、重启）各一趟真实流程，按「起点输入摘要、分支原因、外部调用结果加耗时、状态变化、终点结论」五段核对；已知红清零（knownReds 空数组，三类处置齐全）。
- **结论**：集成分支 `integ/1681-panel-snapshot` 全链 `npm run verify:parallel` 480 步、真红 0、冒烟 5 条真红 0；30 条验收全部 pass；四条维护者要求联合门禁通过；真实数据演练六步全通，84 行日志按五段口径可定位每一步。
- **已知红**：票级分支 `tests/verify-no-mixed-session.ts` 判红是结构性已知红（`docs/agents/parallel-sessions.md:46`），裁决以集成分支为准；8 路并发下少数渲染/折叠门禁偶发假红，复跑转绿；实施期真红已全部修复（逐条见收口记录文档第 5 节）。
- **剩余缺口与票号**：跨容器阻塞者首帧不显示、已关闭容器首帧子票为空（规格 §13 已知边界，后续票）；企业版无真机（按夹具，GHES 能力回答）；真实演练只读、写回执为模拟；counts 与 GHES 无 REST 等价（ADR 明确不做）。
- **详细记录**：`docs/design/20261030-panel-snapshot-closeout.md`（30 条逐条表、七阶段表、五类输入×五段表、已知红处置、演练记录、缺口）；两份同日 ADR 各补「收口记录」节。
