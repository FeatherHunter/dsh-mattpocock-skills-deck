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
- 用本仓真实数据（433 张票）演练一遍，当天导出的日志能支持「只看本地诊断日志定位每一步」。
- 规格票 #1681（2026-10-30 发布）已建立；票号已回填两份 ADR 与本文档。

## 2. 阶段与门禁

| 阶段 | 产物 | 先写红的门禁 | 行为变化 | 对抗式审查重点 |
|---|---|---|---|---|
| 0 真机探针与唯一真源 | 列表行 parent_issue_url、issue_dependencies_summary、sub_issues_summary 三个字段的真机探针与夹具；操作百科补读/写标记、可用渠道与结果类型；术语「通知中心」「通知事件」 | tests/verify-github-rest-fallback.ts 的 #1682 段：读 tests/fixtures/1682/ 两套夹具与 probe-metadata.json，断言字段有则解析、无则走上次已知或标拿不到（解析器在 src/tracker/rooms/github/rest-list-metadata.ts，阶段 0 不接 list/get）；tests/verify-operation-catalog.ts、tests/verify-glossary-terms.ts（#1683 落） | 无 | 探针结论是否被当成已证事实；字段缺失退路是否写明 |
| 1 GitHub 房间内部分层 | transport/、channels/{graphql,rest}/、routing/、model/、read/、write/、room/、support/ 落位；读结果类型带来源与完整度 | tests/verify-room-layering.ts（#1684 落 20 项含 10 条负例，本票补到 21 项含 11 条负例）、tests/verify-read-result-provenance.ts（本票新落：从操作百科枚举读操作、缺来源字段即红；已接的 3 条读路径登记 wired，其余 9 条先按白名单登记——#1686 七条、#1687 两条，随读侧搬迁逐条清零） | 无行为变化，只换结构 | 依赖旁路、唯一出口被绕过、同一输入输出行为一致 |
| 2 宿主面板快照合并层 | 合并纯函数（字段三态、完整来源判定、字段组的来源与时间）、版本门、磁盘回放扩展（来源随盘、旧格式按未知） | tests/verify-panel-snapshot-merge.ts、tests/verify-snapshot-disk-replay.ts | 快照可合并、可回放；视图暂不切换 | 降级来源误删已知、完整来源判错、过期结果回退、并发写入顺序 |
| 3 客户端收编为单一读源 | issueCache 与地图子票桶退役为投影；陈旧先显示；写回执合并；TTL 改为只触发后台刷新；读投影回滚开关 | tests/verify-single-read-source.ts、tests/verify-detail-incremental.ts、tests/verify-acceptance-four.ts | 四条要求落地；界面改读投影 | 四条要求逐条演练；双源回流；回滚开关两条路径都能跑 |
| 4 REST 降级补齐 | 列表 parent_issue_url 零请求补父边；依赖计数大于 0 逐票拉；按需细节按需补；规格容器按「正文标记优先、标签兜底」修父边；预算按插件读额度（常规增量 ≤3、完整枚举 ≤16、详情 ≤5 类、8 路并发、降级探针 5s→60s、自动校准 ≥10min） | tests/verify-fallback-merge.ts、扩展 tests/verify-github-rest-fallback.ts | 降级结果只补不删，已知数据不缩 | 请求预算与 8 路并发上限；GHES 能力标记；降级误标完整 |
| 5 通知中心 | 事件先落库再呈现；事件库宿主持久化、工作区共享；当前状态仍从快照派生；未读入口；浮层历史；toast 只做回声；退役占行横幅 | tests/verify-notification-center.ts、改造 tests/verify-rest-fallback-banner.ts | 降级、刷新失败、写失败改为通知呈现，不再占列表行 | 事件不丢；去重与恢复配对；三条诚实约束（只有配额原因才提配额、超时改口「上次」、本次会话可关） |
| 6 收口 | 全链、真实数据演练、文档更新、ADR 回填规格票号 | 全链复跑 | 无 | 四条验收重放；门禁摘要可读 |

阶段 0 已于 2026-10-31T03:04:23–03:07:52（+08:00，gh 2.97.0，只读）完成真机探针：仓库规模 1627 张工单 + 64 个拉取请求，两页 200 行（187 张工单 + 13 个拉取请求）。parent_issue_url 出现在 73/187 张工单行，114 张顶层工单整个键不出现，13 个拉取请求行也没有；issue_dependencies_summary 与 sub_issues_summary 出现在 187/187 张工单行、0/13 个拉取请求行。故意让尾页失败一次（代理指向 127.0.0.1:1 请求第 3 页）得到退出码 1、117 毫秒、stdout 0 字节、一条 proxyconnect 拒绝连接，前两页 200 行保留；与生产 3.1–3.3 秒 EOF 同类。结论：字段出现性必须按整页判断，拉取请求行标不适用，依赖按四格任一大于 0 才逐票拉；缺失退路按规格阶段 4 口径。夹具与门禁见上一行，阶段 0 行为不变。

阶段 0 先做，是因为父边与依赖摘要的字段可用性决定阶段 4 的实现路径；阶段 1 其次，因为「来源与完整度」是后续所有合并判断的输入；阶段 2 与阶段 1 可以并行推进（不同人/不同子代理，写范围不相交），但阶段 3 必须等阶段 1 与阶段 2 都绿；阶段 4 依赖阶段 1 的渠道分层；阶段 5 独立，可随时插队。

## 3. 四条维护者要求的验收对照

| 要求 | 现状 | 目标 | 怎么验 | 阶段 |
|---|---|---|---|---|
| 1 降级不缩数据 | REST 降级后关系与子票计数丢失（0/3 → 0/0） | 已知数据保留，未知标未知 | verify-fallback-merge 构造降级前后对比；verify-acceptance-four 走真实快照 | 2–4 |
| 2 地图详情先显示已知阻塞 | 加载期间先空，回来才画 | 先画快照里已知的阻塞关系，返回后合并 | verify-acceptance-four（假数据驱动视图） | 3 |
| 3 详情关闭立即回列表 | 要等整仓刷新 | 写回执合并后同一快照立即一致 | verify-detail-incremental | 3 |
| 4 详情永久快照增量合并 | 每次进入空白 | 磁盘与内存快照 + 增删改合并 | verify-detail-incremental、verify-snapshot-disk-replay | 2–3 |

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
- 请求预算超支：预算常量住额度模块（src/refresh/kernel/host-budget.ts），不新建 YAML；时间值走 config/ttl.yaml 与生成器；超预算只补当前视图字段。
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
- 2026-10-31 阶段 4 第一批（#1689）：降级取数的请求预算、8 路并发与探测/校准节流落成与宿主额度账本同源的常量——src/refresh/kernel/host-budget.ts 新增 FALLBACK_FETCH_LIMITS（常规增量 ≤3 条请求、完整枚举 ≤16 条、单次详情 ≤5 类、并发 8 路），两个时间窗口走 config/intervals.yaml 的 fallbackProbeIntervalMs=60000 与 fallbackCalibrationIntervalMs=600000；纯算法内核 src/refresh/kernel/fallback-fetch-budget.ts 提供轮预算台账（发出前预扣、收到后按实际条数校正、失败也回填，读与写分桶不混记）、8 路并发闸（超出排队、一条不丢）与两个节流窗口判据；探测与校准挂在现有 probe-handler 探测拍上（不新增后台定时器），降级常驻时整仓探测 5 秒放宽到 60 秒、自动校准至少隔 10 分钟，增量轮预算透传 row-patch / thin-row-fetch 逐条记账；新增门禁 tests/verify-fallback-fetch-budget.ts（68 项断言，含超预算拒发与 20 条并发峰值 ≤8 的负例）。完整枚举 16 与详情 5 类的真实取数接线随阶段 4 后续票（#1690/#1691）落地。
