# 研究 #1679：GitLab 房与 GitHub 房在真机上的差异与坑

> 供 wayfinder 地图 #1673「GitLab 后端在 web profile 下的真机系统化测试方案」使用。
> 只读调查，没有改代码、没有建删 GitLab 项目。所有结论都指到源码/文档的 file:line；标「未核实」的，是真机上要专门看一眼的。

**总览（先读这一段）**

- **最危险 5 个差异**：① 票池只取一页 100 张（GitHub 是 500 张封顶且带截断旗标）——面板、`deck_issue_list`、地图快照都只看得见这 100 张；② 免费档写不了原生阻塞边，回落成「可见行 + 隐藏机器表」成对写法；③ 父子归属落在正文文件头的隐藏标记里，不在平台的层级里；④ 指派时 username 换不出 id 会被静默丢掉（可能把一张票的指派清空，还回成功）；⑤ 免费档的 403 会被通用错误表说成「权限不足 / 请登录」，看不出是付费档限制。
- **免费版 403 要点**：真机已查实「`GET links` 通、`POST is_blocked_by` 回 403」（#1599，commit c90b3d7fa）。房内把 403/404/premium 字样当作「原生阻塞能力不存在」的证据，滑到正文成对写法（graph-blocking.ts:81-95、:145-151）。但从别的写路径漏出来的 403，通用表会归成 AUTH（src/tracker/kernel/error-rules.ts:129-133），用户看到的是「权限/登录」，不是「需要付费档」。
- **真机最容易误判 3 处**：① 面板看起来正常，实际只有 100 张票——唯一的迹象是数字角上一颗小圆点，提示语「ISSUE 未完全加载，体检可能遗漏。」；② 「写成功了」但指派是空的、或阻塞只写在正文里（原生边没落地）；③ 地图薄查撞到封顶只挂 `truncated` 并在注记里说一句，不当失败，容易当成「就这么几张地图」。
- **额外查清的一件事**：本次做了一次只读 API 调用（`glab 1.123.0`，登录身份 FeatherHunter），`GET projects/gitlab-org%2Fgitlab/issues?iids[]=1` 不带 state 参数时回的是 `"state":"closed"` —— **GitLab 缺省返回全部状态**。maps.ts:13 那句注释「GitLab 缺省只回开着的票」不成立（实现里显式传了 state=all，所以行为不受影响，但真机测试不要按那句注释的预期去判）。

---

## 0. 这份笔记怎么读

- 「依据」列给的是本仓源码与官方文档。行号对应本次阅读时的文件；GitLab 官方文档只引官方站点。
- 「真机怎么看出来」列写的是**用户在 web 界面或工具回包里能直接看到的东西**，不是内部实现。
- 「过去出过问题」只写有据可查的票号/提交；没有就写「无记录」。
- 「自动测试覆盖」写到具体文件与断言所在的范围；写在「契约测试」里的意思是：用脚本化的假 `glab` 跑真房间，**不联网、不碰真 GitLab**。这一层能证明「拿到这样的回话之后做对了」，证明不了「真 GitLab 会这么回话」。

---

## 1. 通道与错误分类

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 1.1 | GitLab 房所有出站都走 `glab api` 这一条命令通道，客户端只回 `{stdout,stderr,code}`，不抛异常；缺执行器或平台口时回 `code 127 / 'platform unavailable'` | src/tracker/rooms/gitlab/client.ts:1-6、:16-18、:40-44 | 界面上要么是一切正常，要么整条操作以「后端原话」形式失败，看不到中间态 | 无记录 | tests/verify-1447-gitlab-e2e.ts（真房间 + 假 glab）；tests/verify-1179-gitlab-endpoint-coverage.ts（唯一出网出口是 client.ts 里拼 api 的那句） |
| 1.2 | 一次 `glab` 调用记 1 条请求、0 点数（GitLab 没有点数概念） | client.ts:58-66；src/tracker/rooms/gitlab/index.ts:453；docs/adr/20260924-refresh-budget-architecture.md:99 | 用量条上只有「请求」在动，「点数」永远是 0 | 无记录 | tests/verify-1447-gitlab-e2e.ts（账本只有 gitlab/requests 一格、点数恒 0） |
| 1.3 | 错误判档真源是通用表，GitLab 房只多两条专有规则：`/host not found/i` 与 `/no token/i` 都归 AUTH（glab 说「没配凭据」，不是 DNS） | src/tracker/rooms/gitlab/errors.ts:4-17、:37-68；docs/adr/20261014-error-classification-single-source.md | 没登录时界面说「登录/权限」，不会说成网络故障 | 无记录（ADR 记的是旧的判档方式被推翻） | 通用表由 kernel 侧门禁覆盖；房内专有两条无单独门禁 |
| 1.4 | **403 的判法**：通用表先用「403 + 限流文案」判限流，其余 403 一律判 AUTH（权限不足） | src/tracker/kernel/error-rules.ts:121-133 | 免费档/权限不足的 403 显示成「没有权限 / 请登录」，不会提「这是付费档功能」 | 有一条实测错判记录写在注释里（GitHub 限流回 403 被判成没登录） | 无（判档本身无 GitLab 专属门禁） |
| 1.5 | 提示语只有两句通用：认不出原因、以及「这个后端没有这项能力」 | src/tracker/kernel/error-rules.ts:424、:427 | 失败卡片上除了后端原话，只有这两句之一 | 无记录 | 无 |
| 1.6 | 预检三判据：工具在 / 已登录 / 仓库可达，用常量档位判，不靠文本猜 | src/tracker/rooms/gitlab/preflight.ts:2-15、:69-73、:84、:118-120 | 检查页三行：「GitLab CLI (glab) 已安装」「glab 已登录」「GitLab 仓库可达」 | 无记录 | tests/verify-1187-gitlab-chain-predicates.ts（84 条断言）；tests/verify-1447-gitlab-e2e.ts（开会话四种结局） |

---

## 2. 登录、权限、license 与免费档

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 2.1 | **免费档没有原生阻塞写入**：房内先 `GET links` 探一下，写的时候 `POST is_blocked_by` 在免费档回 403/404，于是整趟滚回，改用正文成对写法 | src/tracker/rooms/gitlab/graph-blocking.ts:81-95（注释 :87 明写「仅 Premium；free 返回 403/404」）、:145-151；docs/tracker/capability-gitlab.md:23、:57-60 | 票正文里多出一段 `Blocked by: #x` 可见行和一张隐藏机器表；GitLab 网页的「阻塞」区块是空的 | **出过**：#1599 之前把「读回零条原生边」当成「核对失败」，免费档上阻塞一次都写不成（commit c90b3d7fa 的票面记录） | tests/verify-1599-gitlab-hidden-markers.ts（成对写与空集拆干净，21 条断言）；tests/tracker-contract/sections/room-gitlab-extras.ts（原生真写 / 回退 / 读回核对 / 环检）；夹具 tests/tracker-contract/fixtures/gitlab.ts:1-9（free 与 premium 两套） |
| 2.2 | 写后核对的口径：**只认「多出来的原生边」**；端点通、零条（nativeEmpty）= 干净，可以滑进正文回退；只有探针本身失败才算核对不了 | graph-blocking.ts:282-300 | 免费档上阻塞能写成；但界面上看不到「这是降级写法」的提示 | **出过**：#1599（同上） | 同上（纯函数层）；真机三步（挂、改挂、取消）在门禁里做不了，见 tests/verify-1599-gitlab-hidden-markers.ts:11-12 |
| 2.3 | 权限档位按官方默认角色表：Guest 10 / Planner 15 / Reporter 20 / Security Manager 25 / Developer 30 / Maintainer 40 / Owner 50；整理票要 15、推送要 30 | src/tracker/rooms/gitlab/identity-ops.ts:11-31（:19-29 档位表，:30-31 明写「没有真机实测过任何角色回包」） | 「这张票能不能整理」的判据来自这里；判错就会表现成「明明有权限却被拒」或反过来 | 无记录（码内自述未实测） | tests/tracker-contract/sections/room-gitlab-extras.ts（Guest/Planner/Reporter/SecurityManager/Developer 五种回包、两格取高、拿不到档位如实失败） |
| 2.4 | 平台**有**原生子票（Child items，Free/Premium/Ultimate 都有），但本房走 REST 不走 work items / GraphQL，所以读的是隐藏标记 | src/tracker/rooms/gitlab/README.md:25-34；docs/tracker/capability-gitlab.md:57-60 | 在 GitLab 网页上把一张票手工加成某张票的子项，桌面端**不认**这条边；反过来，桌面端挂的子票在网页的层级区看不到 | 无记录（README 明确提醒「别对用户说 GitLab 没有子票」） | tests/verify-1599-gitlab-hidden-markers.ts（隐藏标记优先、正文中间不算）；契约 sections/room-gitlab-extras.ts（listSubIssues） |
| 2.5 | 读额度只有请求数这一种口径，官方没有点数概念 | index.ts:453；docs/adr/20260924-refresh-budget-architecture.md:99、:103；docs/adr/20261023-tracker-single-entry.md:28 | 额度区只有一句「请求额度剩 x/y」（config/copy/pages.yaml:42），没有点数那一行；量不到时说「额度读数还没同步上来」（:44）。GitLab 的额度数值 ADR 明确写「今天没有实测依据」 | 无记录 | tests/verify-1446-gitlab-budget.ts；tests/verify-1447-gitlab-e2e.ts（三态：有头→已知、没装 glab→not-measured、请求坏→unavailable） |

---

## 3. 隐藏父级标记：读写与渲染

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 3.1 | 父子归属的唯一真相是票**正文文件头**里的 `<!-- DSH-PARENT: <地图号> -->`；只认第一个 `#` 标题之前（没有标题就看前 10 行） | src/tracker/rooms/gitlab/description-markers.ts:15-24、:36-40、:66；graph-membership.ts:42-44 | 桌面端「这张票属于哪张地图」与 GitLab 网页的层级无关；把那段注释删掉或挪到正文中间，票就变成「游离」 | **出过**：#1599 主体（71f53cb4a）之前用的是可见行 `Part of #x`，被随手改乱就丢归属 | tests/verify-1599-gitlab-hidden-markers.ts（只认文件头、重复行清干净、挂/拆位置在幂等锚之后）；tests/verify-1130-gitlab-marker-read.ts（matches 识别与 read.degraded 落点） |
| 3.2 | 旧的可见行 `Part of #N` 只回退认、不再写；写时顺手置换掉 | description-markers.ts:25-26；README.md:29 | 老票正文里还能看到这行；新挂的票不会再出现 | **出过**：#1599（同上） | 同上（「旧行写时置换」） |
| 3.3 | 写挂载后会回读核对：读回来的 parentKey 对不上就回 `conflict`，不把「写丢了」包装成成功 | graph-membership.ts:100-121 | 挂父子失败时会说「写后读回对不上」，而不是报成功 | 无记录 | 契约 room-gitlab-extras.ts（写后语义核对）；tests/verify-1599-gitlab-hidden-markers.ts（纯函数层） |
| 3.4 | 渲染这一层：**本房不剥**隐藏标记，GitLab 网页端把 HTML 注释当不可见文本。同族的 `DSH-ISSUE-KIND` 在 GitLab 上「会不会被渲染出来」是 ADR 里列明的待验项 | docs/adr/20261020-object-kind-identification.md:133 | 网页端正常看不见；但票的「编辑」框与 API 原文里有。若 GitLab 以后把注释渲染出来，这段就会以文字形式出现在票面上 | 无记录 | 无（这一层没有门禁，ADR 把它列为验收项） |

---

## 4. 阻塞：原生边与成对降级

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 4.1 | 读阻塞是三层：原生 `links` → 隐藏机器表 → 可见行，对端状态逐张落实 | src/tracker/rooms/gitlab/README.md:36-38；capability-gitlab.md:23 | 一张票的「被阻塞」列表可能来自三种写法，界面上不分层显示 | 无记录 | 契约 room-gitlab-extras.ts（真实状态 / 读回核对）；tests/verify-1599-gitlab-hidden-markers.ts |
| 4.2 | 降级写法是**成对**：可见行给人看，隐藏机器表给机器读；拆干净要两份都不残留 | src/tracker/rooms/gitlab/graph-blocking.ts:473（回退路径重写这一对）、:45；src/tracker/rooms/gitlab/description-markers.ts:94-98（机器表与可见行两条正则）、:134-145（成对重写与拆干净）；capability-gitlab.md:23 | 解开阻塞后正文里不该留下半行；若只删一份，网页上还能看到 `Blocked by` | **出过**：#1599（旧实现只写一份、空集没拆干净） | tests/verify-1599-gitlab-hidden-markers.ts（「阻塞成对写」「空集拆干净」两条） |
| 4.3 | 写阻塞前先做环检，两条写路径共用；读不到的节点当叶子 | graph-blocking.ts:428-444 | 成环时整条写失败并回 `conflict`，不会只写半边 | 无记录 | 契约 room-gitlab-extras.ts（环检） |
| 4.4 | 每条阻塞写入前都要按 `expectedUpdatedAt` 前置读一次（给了才做） | graph-blocking.ts:428-433 | 两个人同时改同一张票的阻塞，后者收到 `conflict` | 无记录 | 无专门门禁（GitHub 侧同款逻辑在 src/tracker/rooms/github/graph.ts:173-178，两边都没有单测） |

---

## 5. refId、编号与仓库身份

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 5.1 | GitLab 允许分组套分组，refId 要保留**全部分组**（`group/sub/project`）；只取两段会指向另一个仓库且不报错 | src/tracker/rooms/gitlab/repo.ts:11-16；docs/architecture/tracker-backend-normalized-model.md:40 | 票列表变成空、或者看着像另一个项目的票；写操作打到别的仓库 | 无记录（码内把这当成必须防的坑） | tests/verify-1447-gitlab-e2e.ts（repo.resolve.tier）；契约 sections/room-gitlab-extras.ts（getRepoKey） |
| 5.2 | 仓库身份三层兜底：`git remote get-url` → `.git/config` → `glab repo view --output json`，认不出回 null 不抛 | repo.ts:18-24 | 认不出时面板显示「已选 GitLab 但仓库引用缺失」的警示，而不是冒充仓库名 | 无记录 | tests/verify-1130-gitlab-marker-read.ts（.git/config、git 兜底、无 fs、exec 抛）；tests/verify-1555-gitlab-claim-declaration.ts（认领只认高置信声明） |
| 5.3 | 票号用 `iid`（项目内编号），不是全局 `id`；归一那一层直接取 `String(raw.iid)`，永远不产出数字 | docs/architecture/tracker-backend-normalized-model.md:72；src/tracker/rooms/gitlab/normalize.ts:8、:73 | 网页地址 `/-/issues/12` 与工具里的票号一致；用全局 id 会读不到票 | 无记录 | 契约 sections/listPage.ts:401（行 key 顺序 5,4）；tests/verify-1447-gitlab-e2e.ts |

---

## 6. 分页、票池与 counts（这一节最容易在真机上误判）

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 6.1 | **`list` 只取一页 100 张，没有 page 参数、没有游标、没有截断旗标**；GitHub 是翻到底、500 张封顶并置 `truncated` | src/tracker/rooms/gitlab/issues.ts:121-166（:132 per_page=100，:160-162 只回数组）；对照 src/tracker/rooms/github/issues.ts:232-233、:304-311 | 票数超过 100 时，面板与 `deck_issue_list` 只看到最新的 100 张，文字仍说「共 N 行符合」（N≤100），**没有任何截断提示**（GitHub 会加一句「后端这次只翻到自己的上限就停了」） | **出过同一类问题**：#1304 把 `truncated` / `fallback` 交代写进契约，GitHub 侧照此加了旗标与注记（src/tracker/rooms/github/issues.ts:48、:298-311），GitLab 房这份交代没有对应物 | 部分：契约 sections/listPage.ts 覆盖 `listPage`（59 条断言），**`list` 的一页上限没有任何门禁** |
| 6.2 | 面板快照直接调 `list`，再用 `counts.total` 与池子里行数比对判断全不全 | src/host/tracker/snapshot.ts:267-276、:283-296（注释 :284-285 明写「GitHub 最多 500 条、GitLab 只取一页」） | 数字是后端真值，但列表只有 100 行；`deck.partial=true` 表现为数字角上一颗小圆点，悬浮提示「ISSUE 未完全加载，体检可能遗漏。」 | **出过**：#677（票池完整性规格 docs/design/677-issue-pool-completeness-spec.md）、#689（partial 从橙色胶囊改成数字角小圆点，src/client/views/ListTab.ts:357-370） | 无（面板层无 GitLab 专属门禁）；客户端显示见 src/client/views/ListTab.ts:357-383、文案 config/copy/flow.yaml:52 |
| 6.3 | 地图快照取子票也是 `list({parentKey})`：GitLab 房忽略 parentKey，把整仓一页回给宿主，由宿主按行上的 parentKey 二次筛 | issues.ts:157-159（注释：links 聚合法太重，先回全量）；src/deck/tools/map-snapshot.ts:127、:144（childrenOf 二次筛）；src/deck/shell/edge-landing.ts:87-104 | 地图进度与子票清单只在这 100 行里算；子票在第 100 张之外的，会被当成不存在 | 无记录 | 无（宿主二次筛没有 GitLab 专属用例） |
| 6.4 | 刷新房的索引翻页走 `listPage`，但 GitLab 房**完全不认 `since`**，每轮都翻全仓 | src/refresh/rooms/host/issue-list-fetch.ts:148-168（:149 注释「list 在 500 条处截断」、:163 超页数 fail('truncated')、:168 filter {since} 交服务端）；GitLab 侧 grep 无 since | 窗口筛选在 GitLab 上被静默忽略：每轮都在扫全仓，票多时刷新变慢；撞页数上限会报 `truncated` | 无记录 | 无（GitLab 侧无 since 用例） |
| 6.5 | 分页游标就是页码字符串；**同一页码只在同一每页行数下有意义**，中途改 limit 会漏行/重行且远端不报错 | src/tracker/rooms/gitlab/pages.ts:9-18 | 正常使用看不出来；只有换 limit 时才可能「少了一段历史」且没有任何错误 | 无记录 | 契约 sections/listPage.ts:411-414（游标翻页、末页 null）、:445（坏游标一个请求都不发、点名「游标已失效」） |
| 6.6 | 总线正好是每页条数的整数倍时，最后一页仍会给游标，调用方要多取一次才拿到空页 | pages.ts 契约；src/tracker/rooms/gitlab/README.md:17 | 多一次空请求（耗时 + 1 次请求计数），不影响结果 | 无记录 | 契约 sections/listPage.ts:416-428（钉的是实际行为，附带官方 Pagination 头不可靠的理由） |
| 6.7 | 每读一页都要额外问一次 `issues_statistics`（拿同口径总数），总数拿不到整条失败，不回「有行没总数」 | pages.ts:20-26；counts.ts:9-30 | 翻页时请求数明显比 GitHub 多（每页 +1）；总数接口失败时整页读不出来 | 无记录 | 契约 sections/listPage.ts:404（每条读多问一次）、:439（总数失败整条失败）；sections/counts.ts:338-391 |
| 6.8 | counts 走 `issues_statistics`，映射 open←opened / total←all；**不数合并请求** | counts.ts:9-30（:22-25 明写「只在文档上对过、没真机量过」） | 面板上的总数与 GitLab 项目页显示的「Issues」数一致；但与「Issues + Merge requests」合计数不一致 | 无记录（码内自述未实测） | 契约 sections/counts.ts:338-391；tests/verify-1446-gitlab-budget.ts（另一件事） |
| 6.9 | GitLab REST 的 per_page 上限是 100（官方写死），照 200 去问会被远端静默截到 100，于是「这一页取不满 = 最后一页」的判据失效，历史少一段且不报错 | src/tracker/contract/pagination.ts:11-15、:64-83 | 正常情况下看不出来；真机上要看「页大小被悄悄改小」这类症状 | 无记录（文件头把这件事写成必须防的坑） | tests/verify-pagination-limits.ts（数字表比对）；契约 sections/listPage.ts:430-434（limit 999 → per_page=100） |

---

## 7. 地图列表筛选与截断

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 7.1 | 地图薄查服务端按 `labels=wayfinder:map` 筛、内存复核、显式 `state=all`、按创建时间倒序翻页、回包按更新时间倒序重排；单页失败整趟失败，绝不回落 | src/tracker/rooms/gitlab/maps.ts:1-8、:37-42、:90-138 | 地图清单会「看起来全了」；一页失败时整条清单报错，不是少几张 | 无记录 | tests/verify-1605-gitlab-map-list.ts（服务端参数、内存复核、两页拼接、第二页失败整趟失败） |
| 7.2 | 最多翻 10 页（1000 张），撞上限挂 `truncated=true`，不当失败 | maps.ts:41、:124、:138；pagination.ts:81-82 | `deck_issue_list` 的注记里多一句「地图只取回了前 N 张（共 M 张，撞到封顶页数），剩下的这次没拿。」 | 无记录 | tests/verify-1605-gitlab-map-list.ts（撞 10 页上限挂 truncated） |
| 7.3 | 只有「纯地图筛」才走薄查；带文本搜、指派、指定父目录、混其它标签时走老的 `list`（一页 100 张） | src/deck/tools/issue-list.ts:252-256；:309 | 同一次查询加一个 `query` 参数，结果集上限就从 1000 掉到 100 | 无记录 | 无（分流条件本身无 GitLab 用例） |
| 7.4 | 薄查失败**不回落**老路（只有「这个后端不支持」才回落） | maps.ts:7-8；src/deck/tools/issue-list.ts:254 | 薄查超时/传输失败时整条报错，不会自动用老路补一份 | 无记录 | tests/verify-1605-gitlab-map-list.ts（第二页失败/超时/执行器抛错都整趟失败且 kind 不是 unsupported） |
| 7.5 | `state` 缺省的真相：官方文档没写缺省值；**本次只读实测**不带 state 时回的是 closed 票 → 缺省是全部状态 | 实测：`glab api 'projects/gitlab-org%2Fgitlab/issues?iids[]=1&per_page=1'` → `"state":"closed"`；对照 maps.ts:13 的注释「GitLab 缺省只回开着的票」 | 关掉一张地图后它仍然出现在清单里（显式 state=all 的实现本来也这样） | 无记录（注释与实测不符，实现不受影响） | 无 |

---

## 8. 标签与颜色（单字段）

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 8.1 | GitLab 标签只有一个 `color` 字段；`text_color` 是服务器算出来的，**写不了**（三张参数表都没有它） | src/tracker/rooms/gitlab/README.md:40-46；labels-ops.ts:30-38；契约 src/tracker/contract/results.ts:243-244（applied 只有 {name,color}） | 配色弹窗只能改一个颜色；改完网页上的文字颜色可能跟着变（服务器按对比度算） | 无记录 | 契约 sections/labels.ts:20、:443（真实适配器探针） |
| 8.2 | 写颜色必须带井号加六位十六进制；不带井号远端拒 | labels-ops.ts:18-65（:47 起写明）、:375（PUT -f color=#xxxxxx） | 手工喂 `8b5cf6` 会被远端拒，工具里会看到后端原话 | 无记录 | 契约 sections/labels.ts（真实适配器探针） |
| 8.3 | 列标签时**必须显式关掉分组继承**（`include_ancestor_groups=false`），否则列表里会出现改不了的祖先分组标签 | labels-ops.ts:47-54、:256-263 | 标签配色弹窗里少掉「分组上设的标签」；要是没关掉，就会出现「看着能改、一按保存就 404」 | 无记录（码内把这写成必须防的坑） | 契约 sections/labels.ts（列表探针） |
| 8.4 | 改色逐条发 PUT、逐条记账、中途不回滚；没有批量接口 | labels-ops.ts:426-471；pagination.ts:76-78（并发 4） | 一批 10 条里第 5 条失败时，前 4 条已经改了，界面按 applied/failed 两摞显示 | 无记录 | 契约 sections/labels.ts（真实适配器探针）；无「中途失败」的 GitLab 专属用例 |
| 8.5 | 改色失败的提示把三种来路写在同一句里：标签不在 / 项目路径不对 / 没权限 | labels-ops.ts:391-415（NOTFOUND 那句 :406-409） | 失败卡片上是这一句，需要人自己排 | 无记录 | 无 |
| 8.6 | `ensureLabelColorsFile`（往工作区放配色文件）在本房与 GitHub 房都是「按设计明确不支持」——**这不是两家的差异**，但容易在真机上被当成回退 | src/tracker/rooms/gitlab/capability-register.ts:60-64；src/tracker/rooms/github/capability-register.ts:54 | 配色只能改远端，工作区里不会多出一份文件 | 无记录 | 能力登记门禁 tests/verify-capability-register.ts |

---

## 9. 标签与限额：读预算

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 9.1 | 读预算用 `glab api --include` 读 `RateLimit-Limit / RateLimit-Remaining`；量不到就回「未知 + 原因」，不回 0、不抛 | src/tracker/rooms/gitlab/budget.ts:4-15、:41-48 | 量不到时显示「额度读数还没同步上来」；后台同步报 hard 失败时补一句「命令行工具还没准备好（没装或没登录）」（config/copy/pages.yaml:44、:46）；读到 0 才变红说耗尽（src/client/views/shared/truthLines.ts:167）；有头时是「请求额度剩 x/y」（:164-168） | 无记录 | tests/verify-1446-gitlab-budget.ts（三条坏路、大小写不敏感、缺剩余算解析不出）；tests/verify-1447-gitlab-e2e.ts |
| 9.2 | 响应头在 glab 这条缝上默认拿不到（没加 `-i`；加了会把头混进 stdout 让 JSON.parse 崩） | src/tracker/rooms/gitlab/README.md:11-15；counts.ts:9-12 | 分页与总数都只能靠「这一页够不够 per_page」推断，所以才有 6.6 那次多取 | 无记录 | 契约 sections/listPage.ts:416-428（把这个代价写成断言） |

---

## 10. 预检、setup prompt 与环境检查

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 10.1 | 三条检查项的文案是 GitLab 专属：glab 已安装 / 已登录 / 仓库可达 | config/copy/word.yaml:152-157；docs/adr/20260826-check-item-chain-contract.md:122 | 检查页三行都带 GitLab/glab 字样 | 无记录 | tests/verify-1187-gitlab-chain-predicates.ts |
| 10.2 | **宿主只在启动时读一次 PATH**：刚装好 glab，当前宿主仍然找不到；要重启宿主 | src/tracker/rooms/gitlab/SETUP-PROMPT.md:33-35；index.ts:309、:319（修夹具文案里写同一件事） | 装完点「重查」还是红；用绝对路径跑 `glab --version` 有版本号 | 无记录 | 无（这是流程，不是代码路径） |
| 10.3 | 设置页给 AI 的提示词四段：本仓库为 GitLab → 提议 GitLab Issues / 本次已选后端 / 模板要求 / 标签清单要求 | src/tracker/rooms/gitlab/index.ts:417-422；config/copy/panel.yaml:101-107（:107 要求 triage 五角色 + wayfinder 五个标签） | 选择 GitLab 后端后，AI 被要求按 GitLab 模板生成 `docs/agents/issue-tracker.md` 并补全标签 | 无记录 | tests/verify-locale-completeness.ts:284；tests/verify-655-setup-layout.ts:133 |
| 10.4 | 建仓（initProject）走 `glab repo create`，与 GitHub 不同：没有 `--source`，建仓与配 remote+push 是两条命令；**必须传 `-s`**，否则会问「Create a local project directory?」并在子目录 git init | src/tracker/rooms/gitlab/init-project.ts:9-14、:16-37 | 弹窗里选可见性（private/public）后提交；建完之后远端仓库已存在，配 remote/push 失败时话术要点明「仓库已建好」 | **出过**：#1601 在真机上于主仓目录误建过一个项目（id 88199059），发现后立即删除；坑写在 SETUP-PROMPT.md:38-39 | 契约 sections/room-gitlab-extras.ts（两种可见性都真出现在命令里、省略时显式 --private）；无「子目录 git init」的用例 |
| 10.5 | token 只显示一次、用 `--stdin` 喂、喂完删文件；项目回包带 `runners_token` 等密钥，存样本要剔除 | SETUP-PROMPT.md:36-37、:41-42 | 存下来的 JSON 样本里不该有密钥字段 | 无记录 | 无（流程纪律） |
| 10.6 | 自部署 / 极狐（JihuLab）的主机名要先问人，不能默认 gitlab.com | SETUP-PROMPT.md:43-44 | 默认站点与真实站点不一致时，所有 `glab` 调用都指错地方 | 无记录 | 无 |

---

## 11. 404 与网络失败提示

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 11.1 | 404 一律归 `not-found`（资源不存在：票、仓库、标签都算） | src/tracker/kernel/error-rules.ts:136-142 | 失败卡片说「找不到」，不会说「网络问题」 | 无记录 | 契约 sections/listPage.ts:442（列票 404 整条失败且 kind=not-found） |
| 11.2 | 但同一个 404 可能来自三件事（标签不在 / 项目路径不对 / 没权限），改色那句话把三种写在一起 | labels-ops.ts:406-409 | 提示语一句话覆盖三种可能，需要人自己排 | 无记录 | 无 |
| 11.3 | 读单票：回包不是对象就按「票不存在」回 `issue <k> not found` | issues.ts:178-204 | 票号写错、或 refId 指错项目，看到同一句话 | 无记录 | 契约（get 失败档位） |
| 11.4 | 网络类失败按错误码名判（ENOTFOUND/ECONNRESET…），不认正文散句 | error-rules.ts:104-107 | 断网时提示「网络/连接」；但 glab 自己的「host not found」（其实是没配凭据）先说成登录问题（errors.ts:37-68） | 无记录 | 无 GitLab 专属用例 |

---

## 12. 并发写

| # | 差异是什么 | 源码/文档依据 | 真机怎么看出来 | 过去出过问题 | 自动测试覆盖到哪一层 |
|---|---|---|---|---|---|
| 12.1 | 建票收敛成**一条 POST**；只有「确定一个字节都没发出去」才允许重发，超时/EOF/5xx/形状不对一律不再发 | src/tracker/rooms/gitlab/create-write.ts:4-20 | 网络抖动时不会多出一张票；失败话术带幂等键 | 无记录（老写法会多建一张并回成功） | tests/verify-gitlab-single-write.ts（5 类失败 + 「多出两张票」的反向 probe） |
| 12.2 | 指派：先把 username 逐个换 id（`GET users?username=`），**单个查不到就跳过、不拦整批**，最后 PUT `assignee_ids`（查不到时可能发空串） | src/tracker/rooms/gitlab/graph-membership.ts:166-195 | 指派一个不在项目里的人 → 工具回成功，但票上是空的；原本有指派时，因为发的是空 `assignee_ids`，按 API 语义会清掉现有指派（这一条按接口语义推断，真机要专门看一眼） | 无记录 | **无**（tests 里只有 tests/tracker-contract/gitlab-endpoints.ts:89 提到 assignee_ids，没有 username→id 的用例） |
| 12.3 | 标签整集替换、父子挂载、阻塞写入都支持 `expectedUpdatedAt` 乐观并发（对不上回 `conflict`，一个字不写） | src/tracker/rooms/gitlab/labels.ts:103-126；graph-membership.ts:158-165；graph-blocking.ts:428-433 | 并发改同一张票时，后手看到 `conflict: expectedUpdatedAt mismatch` | 无记录 | 无专门门禁（GitHub 侧同款在 src/tracker/rooms/github/graph.ts:173-178） |
| 12.4 | 读票本身会 best-effort 聚合评论与链接（失败忽略，不影响读票） | issues.ts:94-111 | 票详情偶尔缺评论列表，但没有报错 | 无记录 | 契约（get 聚合） |

---

## 13. 给真机测试方案的建议清单（按风险排序）

1. **票池超过 100 张的仓库**：面板行数、`deck_issue_list` 的「共 N 行符合」、`deck_map_snapshot` 的子票与进度是否都只按 100 张算；`deck.partial` 小圆点与提示语是否出现（flow.yaml:52）。
2. **免费档阻塞**：挂/改挂/取消三步，每步都看「网页层级区块为空 + 正文成对写法在」；再验一次原生探针被 403 时**没有**把整条写操作判成 AUTH。
3. **父子边**：在网页上手工加 child item → 桌面端不认；把隐藏标记挪到正文中间 → 归属丢失；删掉标记 → 票变游离。
4. **指派**：指派一个不在项目里的用户名，看是否「回成功但票上没有指派」；再指派一个合法的，看是否清掉了别人的。
5. **地图列表**：地图数接近 1000 时是否出现 `truncated` 注记；一页失败时是否整条失败（而不是少几张）。
6. **404 与权限**：refId 指错项目、标签不存在、无写权限三种情况下的话术是否可分辨（现状：改色那句不可分辨）。
7. **额度**：装没装 glab、请求坏、正常三种情况下额度区的显示（未知带原因 / 已知）。
8. **since 被忽略**：窗口刷新在 GitLab 上是否每轮都扫全仓（表现为刷新变慢、请求数偏高）。
9. **setup**：装完 glab 不重启宿主 → 检查页仍红；重启后变绿（PATH 只读一次）。
10. **建仓**：在非空目录点建仓，确认没有在子目录里 `git init`、也没有动本地仓库远端（#1601 的坑）。

---

## 14. 现有自动测试覆盖矩阵（GitLab）

| 测试文件 | 覆盖什么 | 覆不到的 |
|---|---|---|
| tests/verify-1447-gitlab-e2e.ts | 真房间 + 假 glab：预算三态、账本一格、读数未知不当耗尽、无写权限按硬顶拒绝、开会话四种结局、面板读数形状 | 真 GitLab 回包 |
| tests/verify-1599-gitlab-hidden-markers.ts | 纯函数层：隐藏标记优先、正文中间不算、重复行清干净、旧行写时置换、挂/拆位置、阻塞成对写与空集拆干净 | 真机三步（文件头 :11-12 自述） |
| tests/verify-1605-gitlab-map-list.ts | listMaps：服务端参数、内存复核、两页拼接、撞 10 页上限 truncated、第二页失败整趟失败 | 真机地图数 |
| tests/verify-1130-gitlab-marker-read.ts | matches 四处识别与 read.degraded 落点 | 真实声明文件 |
| tests/verify-gitlab-single-write.ts | 建票单写、不多建票、5 类失败 | 真网络抖动 |
| tests/verify-1179-gitlab-endpoint-coverage.ts | 端点登记与唯一出网出口 | 远端行为 |
| tests/verify-1555-gitlab-claim-declaration.ts | 认领只认高置信声明 | 真工作区 |
| tests/verify-1446-gitlab-budget.ts | 响应头解析、三态、经工厂读预算、登记表同档 | 真实 RateLimit 头 |
| tests/verify-1187-gitlab-chain-predicates.ts | 两条检查项谓词（84 条断言） | 真机检查页 |
| tests/tracker-contract/sections/listPage.ts | GitLab listPage 59 条断言（含整数倍多取一次、坏游标、counts 失败、404） | `list` 的一页上限 |
| tests/tracker-contract/sections/counts.ts / labels.ts | counts 与标签的真实适配器探针 | 真实 GitLab |
| tests/tracker-contract/sections/room-gitlab-extras.ts | getCurrentUser、getRepoPermissions、listSubIssues、initProject、getRepoKey、阻塞（原生/回退/核对/环检） | setAssignees 的 username→id 解析 |

**明确的覆盖缺口**（没有门禁、只能靠真机）：
- `list` 的 100 张上限与「没有截断旗标」这件事；
- 面板快照在 GitLab 上的 partial 判定；
- setAssignees 的 username→id 解析与静默丢人；
- `since` 被静默忽略；
- 地图子票那条链上「宿主按行上 parentKey 二次筛」这一段（GitLab 房自己不筛）。

---

## 15. 参考

- 源码：src/tracker/rooms/gitlab/（client / errors / preflight / repo / issues / pages / counts / maps / sub-issues / budget / labels / labels-ops / graph-blocking / graph-membership / description-markers / create-write / identity-ops / init-project / capability-register / README.md / SETUP-PROMPT.md）
- 文档：docs/tracker/capability-gitlab.md；docs/architecture/tracker-backend-normalized-model.md；docs/adr/20260924-refresh-budget-architecture.md、20261014-error-classification-single-source.md、20261023-tracker-single-entry.md、20261020-object-kind-identification.md、20260826-check-item-chain-contract.md
- 历史：#1599（隐藏标记与阻塞降级；commit 71f53cb4a 主体、c90b3d7fa 修复）、#1601（建票读回真机验证，含误建项目 88199059）、#1304（截断要如实说）、#677/#689（数字与 partial）、#1605（地图薄查）
- 真机记录：#1601 票面（沙箱 FeatherHunter/dsh-1601-probe-20261028-181550，iid 1 / id 208244723，已删）；本次只读调用（glab 1.123.0 / gitlab.com / FeatherHunter）
