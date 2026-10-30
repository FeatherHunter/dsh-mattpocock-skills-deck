# REST 降级路径能否与 GraphQL 读路径字段级等价

调研日期：2026-10-30。范围：`src/tracker/rooms/github/` 的读路径（`list`、`get`、`getDependencies`、`listSubIssues`、`counts`）以及面板快照与 deck 工具对它们的消费。

调研边界：没有改动任何源码，没有发起任何真实网络请求。GitHub API 的事实来自 docs.github.com 与 github.blog 的官方 changelog（文末列 URL）；仓库规模来自本地快照缓存 `.dsh-mattskillsdeck-cache/FeatherHunter__dsh-mattpocock-skills-deck.json`（cacheFormat=3，updatedAt 2026-10-28 13:36:58）。

## 结论先行

**「100% 等价」不成立；「有条件等价」成立。**

三条硬结论：

1. **`counts` 这一条操作在 REST 上没有等价物。** 整仓 open/closed 计数要求「只数 issue、不数 PR」。REST 的 `GET /repos/{owner}/{repo}/issues` 会把拉取请求一起返回，且没有 `is:issue` 这样的过滤参数；仓库对象的 `open_issues_count` 同样混算 PR；search API 能筛 `is:issue`，但每次最多返回 1000 条、且认证用户只有 30 次/分钟。本仓现在 433 行（370 张 issue + 63 张 PR），还能用 search 蒙对；仓库一大就必错。所以 `counts` 只能继续走 GraphQL，或者接受「降级时没有精确计数」（现状就是后者：拿不到就退回派生值并给 `deck.partial` 打一个小圆点）。
2. **GHES 上不成立。** 子票 REST 端点的官方版本标注只有 `fpt` 与 `ghec`，没有 `ghes` 一档；依赖边 REST 从 GHES 3.19 才有。也就是说企业版上「父票/子票树」这一整块在 REST 里根本不存在，`blockedBy` 在 3.19 以前也不存在。
3. **github.com 上，`list`/`get` 除了三个小字段，其余可以做到字段级等价，代价是每轮多 14 到 66 个 REST 请求。** 三个不等价的小字段是：作者与指派人的 `name`（REST 的 Simple User 只有 login/avatar_url）、评论的「是否编辑过」标记（GraphQL 有 `lastEditedAt`，REST 只有 `updated_at`）、以及列表行的 `blockedBy` 需要按票补拉（GraphQL 在同一次查询里顺带返回）。

还有一条产品事实要先说清：**面板今天本来就会显示「这次走的是 REST」的横幅**（`src/client/views/shared/truthLines.ts:262-280`，`RestFallbackBanner`）。这是有意为之的「诚实告知」，不是缺陷。所以「面板看不出降级」如果指数据一样、横幅保留，那是可做到的；如果指连横幅都不出现，那要先决定删掉这个信号——那是产品决定，不是技术缺口。

## 一、GraphQL 读路径请求了哪些字段，谁在消费

### 1.1 整仓列表行（`LIST_QUERY` + `LIST_ISSUE_FRAGMENT`，`queries.ts:65-79`）

字段：`number, title, state, body, url, createdAt, updatedAt, closedAt, author{login avatarUrl __typename, User.name, Organization.name}, assignees(first:50){login name avatarUrl}, labels(first:50){name color description}, milestone{title description state dueOn}, parent{number}, blockedBy(first:50){number title state}`。

消费方：

- 面板列表与地图子票：`buildSnapshot` 用 `session.list` 拿全仓，剔掉 PR，按 `updatedAt` 倒排（`snapshot-build.ts:413-464`）。
- 面板行上的阻塞标记与「阻塞」筛选直接吃快照里的 `blockedBy`（`src/client/views/ListTab.ts:289-314`、`src/client/views/TicketRow.ts:33`、`src/client/kernel/store-derived.ts:133-173`）。
- deck 薄列表（`deck_issue_list`）也走同一个 `list`，只回薄行。

也就是说：**列表这一条路上，`blockedBy` 与 `parent` 是「顺带就有」的**，这正是 REST 降级最难补的两格。

### 1.2 单票详情（`GET_QUERY` + `ISSUE_FRAGMENT`，`queries.ts:58-87`）

在上面的字段之外多了 `comments(first:50){totalCount, nodes{id author{...} authorAssociation body createdAt updatedAt lastEditedAt}}`。详情页另发一次 `getDependencies` 拿 `blockedBy`/`blocking`（`issue-detail-fetch.ts:141-144`），并把契约形状折回界面的 `{nodes}` 形状（`issue-detail-fetch.ts:73-107`）。

消费方：`IssueDetail` 的标题/正文/标签/指派人/作者/评论列表/阻塞来源与「挡路」卡片。详情页对 `subIssues` 固定给空连接（`issue-detail-fetch.ts:97-98`）——地图详情页的子票列表本来优先读快照，这是既有设计，不算降级缺口。

### 1.3 依赖边（`DEPS_QUERY`，`queries.ts:115-124`）

`blockedBy(first:50){pageInfo{hasNextPage} nodes{number title state labels(first:20){nodes{name}}}}` 与 `blocking(first:50){同形}`。读不到就退回「扫全仓反推 blocking」的兜底（`deps-read.ts:91-132`），并把 `blockingSource` 标成 `scan`、把完整性标成 `false`。

### 1.4 地图子票（`SUB_ISSUES_QUERY`，`queries.ts:210-243`）

子票行字段：`number,title,state,body,url,createdAt,updatedAt,closedAt,author,assignees(50),labels(50 name/color/description),parent{number},blockedBy(50){number title state}`，不含 comments 与 milestone。面板刷新只对**开放的**容器逐个调一次（`snapshot-build.ts:377-406`，调用在 `:385`）。

### 1.5 计数（`COUNTS_QUERY`，`queries.ts:133-148`）

`issues(states:[OPEN]){totalCount}` 与 `issues(states:[CLOSED]){totalCount}`，带标签时加 `filterBy:{labels:$labels}`。这个操作**明确不做 REST 兜底**，理由写在 `counts.ts:17-20`：search 有 1000 条上限、`open_issues_count` 混算 PR。宿主拿不到计数时退回派生值并置 `deck.partial`（`src/host/tracker/snapshot.ts:40-55`，界面显示为数字右上角的小圆点，`ListTab.ts:368`）。

### 1.6 PR 富化（`PULL_REQUEST_FRAGMENT`，`queries.ts:264-303`）

`mergedAt`、`reviews(first:20){state author{login} submittedAt}`、`comments(first:20){totalCount}` 等。注意：`PullRequest` 类型没有 `parent`/`blockedBy`（`queries.ts:257-261` 的真仓探针结论），所以这两格对 PR 本来就不要求。

## 二、字段差距矩阵

「每轮请求数」按本仓当前规模估算：433 行（370 issue + 63 PR）、45 个容器（其中 3 个开放、20 个 spec）、14 张票有 `blockedBy`、24 张有评论、15 个标签。

### 2.1 整仓列表行

| 字段 / 行为 | GraphQL 出处 | REST 可行端点 | 每轮请求数 | 能否等价 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `number/title/state/body/url/createdAt/updatedAt/closedAt` | `queries.ts:36-54` | `GET /repos/{o}/{n}/issues?state=all&per_page=100&page=p` | 0（同一页） | 能 | `url` 用 `html_url`，`normalize.ts:382-437` 已双认；`body` 自带，`type` 推导不受影响 |
| `author.login/avatarUrl`、`assignees[].login/avatarUrl` | `queries.ts:38-44` | 同一响应里的 `user`/`assignees` | 0 | 能 | Simple User 有 login 与 avatar_url |
| `author.name`、`assignees[].name` | GraphQL 显式请求 `name` | 无（`GET /users/{login}` 才有） | 去重作者数（不可控） | **不能** | 详情页作者行会空；面板只显示 login，看不出 |
| `labels{name,color,description}` | `queries.ts:45` | 同一响应的 `labels[]` | 0 | 能 | REST label 对象含 description |
| `milestone{title,description,state,dueOn}` | `queries.ts:46` | 同一响应的 `milestone` | 0 | 能 | REST 用 `due_on`，`normalize.ts:154-171` 已认 |
| `parent{number}` | `queries.ts:52` | 列表行的 `parent_issue_url`（Issue schema 里有）；或逐容器 `GET /issues/{n}/sub_issues` 反向建 | 0（若列表带该字段）或 45 | 能，成本待定 | 列表端点是否逐行返回 `parent_issue_url` 要在实现时用一次真实请求确认（本调研未打网络）；退路是逐容器子票 |
| `blockedBy{number,title,state}`（并从 blocker 的 labels 推 type） | `queries.ts:53`、`normalize.ts:219-245` | `GET /issues/{n}/dependencies/blocked_by?per_page=100` | 14（仅「摘要计数 > 0」的票）；若列表不返回依赖摘要则 370 | 能，但必须逐票 | 有整仓批量端点；只有计数摘要（`issue_dependencies_summary`），没有身份列表。这是列表等价的最大成本项 |
| 评论计数 `commentCount` | 列表片段**没有** | REST 行自带 `comments` 数字 | 0 | 超出等价（REST 更全） | `normalize.ts:174-180` 认数字 |
| 行序 | `orderBy: UPDATED_AT DESC` | 默认 `created` 倒序 | 0 | 能 | 加 `sort=updated&direction=desc`；快照自己还会重排，影响很小 |
| 上限 | 工单 500、PR 1000（`issues.ts:233`、`:259`） | 10 页 × 100 = 1000 行（`issues.ts:105-146`） | 0 | 能（本仓 433 行） | 两条路都够用 |

### 2.2 单票详情

| 字段 / 行为 | GraphQL 出处 | REST 可行端点 | 每次请求数 | 能否等价 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 上面列表行的全部字段 | `ISSUE_FRAGMENT` | `GET /issues/{n}` | 0（同一次） | 基本能 | 同 2.1 的 name、blockedBy 两项差距 |
| 评论正文前 50 条（author/authorAssociation/body/createdAt/updatedAt/lastEditedAt） | `queries.ts:20-33`、`:58-62` | `GET /issues/{n}/comments?per_page=100&page=p` | +1 | 能，除「编辑标记」 | REST 只有 `updated_at`，没有 `last_edited_at`；`Comment.editedAt` 会丢 |
| 评论「加载更多」 | `getIssueQuery(commentsFirst, after)`，`queries.ts:97-106` | 同一个 comments 端点翻页 | +1/页 | 能 | 现在降级路完全不补正文：`issues.ts:399` 只拿单票，`issue-detail-fetch.ts` 因此得到空列表 |
| `blockedBy` / `blocking` | `DEPS_QUERY`，`queries.ts:115-124` | `GET /issues/{n}/dependencies/blocked_by` 与 `.../blocking` | +2 | 能 | 每关系 50 条上限与 GraphQL 一致（2025-08-21 changelog） |
| `reviews`（仅 PR 详情） | `queries.ts:276-280` | `GET /pulls/{n}/reviews?per_page=100` | +1 | 能 | 现降级路只在 `enrichSinglePR` 里补（`pulls.ts:89-116`），失败静默 |
| `mergedAt` | `queries.ts:270` | `GET /pulls/{n}` 或列表行 `pull_request.merged_at` | 0~1 | 能 | 现状已在补（`pulls.ts:68-86`） |
| `subIssues`（详情页本来不用） | — | — | 0 | 不要求 | `issue-detail-fetch.ts:70-71` 的解释：要给子票就另调 `listSubIssues` |

### 2.3 计数

| 字段 / 行为 | GraphQL 出处 | REST 可行端点 | 每轮请求数 | 能否等价 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 整仓 open/closed/total | `COUNTS_QUERY`，`queries.ts:133-148` | **没有等价端点** | — | **不能** | `/issues` 混入 PR 且无 `is:issue` 过滤；`open_issues_count` 同样混算；search 有 1000 条上限、30 次/分钟。只剩「全量翻页本地数」一条路（本仓 5 页，仓库一大就线性涨） |
| 带标签的计数 | `COUNTS_QUERY_WITH_LABELS` | `GET /issues?labels=a,b&state=...` 同样混 PR | — | 不能 | 同上 |

### 2.4 地图子票与 PR 列表

| 字段 / 行为 | GraphQL 出处 | REST 可行端点 | 每轮请求数 | 能否等价 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 子票行（number/title/state/body/url/时间/author/assignees/labels/parent） | `SUB_ISSUE_FRAGMENT`，`queries.ts:210-224` | `GET /issues/{n}/sub_issues?per_page=100` | 1/容器（开放 3 个；全量 45 个） | 基本能 | REST 直接回完整 Issue 数组，连 labels 都带；`author.name` 同上缺口 |
| 子票的 `blockedBy` | 同片段 | 逐子票 `dependencies/blocked_by` | 仅「有边的」子票 | 能 | 子票行同样只有计数摘要 |
| PR 列表行（mergedAt 等） | `LIST_PR_QUERY` | `GET /pulls?state=all&per_page=100` | 1 | 能 | 现状已这么补；注意 REST 的 `/issues` 列表本来就含 PR，可以不重复拉 `/pulls`，只补 reviews |

### 2.5 汇总：哪些字段「REST 根本没有」

- 整仓「只数 issue」的精确计数（没有不含 PR 的计数端点）。
- 批量返回依赖边「身份」的端点（只有逐票端点）。
- 用户的显示名 `name`（Simple User 不带，要单用户查）。
- 评论的编辑标记（只有 `updated_at`）。
- GHES 上的子票端点（整个不存在）。

## 三、请求数与延迟成本（本仓 433 行规模的估算）

### 3.1 现状：GraphQL 一轮快照发多少次

- 整仓 issue 列表：370 张 / 每页 50 = 8 页；
- PR 列表：63 张 / 每页 50 = 2 页；
- 开放容器子票：3 次；
- 标签：1 次；当前用户：1 次；计数：2 次。

合计约 **17 次 GraphQL 请求**。每次请求里还带 50 行的 labels/assignees/blockedBy/parent 连接，单次耗时通常比一个 REST 列表页更长。

### 3.2 REST 全量等价：按今天快照的范围

| 项目 | 请求数 | 说明 |
| --- | --- | --- |
| `/issues?state=all&per_page=100` | 5 | 433 行含 PR |
| `/labels?per_page=100` | 1 | 15 个标签 |
| `/user` | 1 | 当前用户 |
| `/issues/{n}/sub_issues`（开放容器） | 3 | 每个容器一次 |
| `/issues/{n}/dependencies/blocked_by` | 14 | 仅「有边」的票；前提是列表行带依赖摘要 |
| 计数 | 0 | 不承诺等价，仍走 GraphQL |
| PR reviews | 0 | 详情按需 |
| **合计** | **约 24 次** | 串行约 10–20 秒（按 `gh api` 单次 0.4–0.9 秒），8 路并发约 3–5 秒 |

如果把「45 个容器全量」也算进来（历史地图也要子票树），再加 42 次，合计 **约 66 次**，串行 30–60 秒、8 路并发 8–12 秒。

如果列表行**不**返回 `issue_dependencies_summary`，`blockedBy` 就变成每票一次（370 次），这条方案基本不成立——这是实现前必须先用一次真实请求确认的关键假设。

### 3.3 与限流对照

- REST 主限流：认证用户 5000 请求/小时。24 次/轮、10 分钟一轮是 144 次/小时；就算 1 分钟一轮也只有 1440 次/小时，**主限流不是瓶颈**。66 次/轮、1 分钟一轮是 3960 次/小时，接近上限，需要降频或做增量。
- 次限流：并发 ≤100（REST 与 GraphQL 共享）、REST ≤900 points/分钟；GET 计 1 point，24 次/轮远低于 900。保持 8–10 路并发是安全的。
- 内容创建次限流（80/分钟、500/小时）与读路径无关，只影响评论/打标/关票等写操作。
- search 有单独的 30 次/分钟：用 search 做计数的话，2 次/轮 × 每分钟一轮 = 120 次/分钟，**会撞上限**；必须缓存或不做。
- GraphQL 侧：5000 points/小时，连接 `first` 上限 100，单次 50 万 node、10 秒超时。列表每页 50 行、每行带 4 个连接，按官方公式约每页几十点，17 次请求一轮约数百点，远低于上限。

结论：**成本问题不是限流，而是「逐票/逐容器」的请求组织方式**。它决定了降级一轮的耗时是 5 秒还是 60 秒。

## 四、可选策略排序（性价比从高到低）

1. **列表补 `parent` + 只给「有依赖计数」的票补 `blockedBy`。**
   - 做法：解析列表行的 `parent_issue_url` 得到父票号（零额外请求）；对 `issue_dependencies_summary.blocked_by > 0` 的票逐张拉 `dependencies/blocked_by`（本仓 14 次）。
   - 收益：面板列表的阻塞标记、「阻塞」筛选、地图归属（`parentKey`）与 GraphQL 主路一致；这是「面板看不出降级」的主体。
   - 代价：列表行是否带父票与依赖摘要需先确认；带的话固定成本 +14 请求。
2. **详情页按需补三样：评论正文（+1）、`blockedBy`/`blocking`（+2）、PR 详情补 reviews（+1）。**
   - 收益：评论列表与「加载更多」、阻塞来源与挡路卡片、PR 审阅状态全部恢复。
   - 代价：只在用户打开详情时花，固定成本为零；评论多时按 100 条/页继续翻。
3. **把 `parent-repair` 的筛选从「只看 `wayfinder:map` 标签」改成「按归一后的 type 判 spec/map」。**
   - 收益：20 个规格容器下的实施票也能找回 `parentKey`（现在这些票在降级时变成孤儿）。
   - 代价：每个规格容器多 1 次 `sub_issues`（+20 请求），或直接用第 1 条的列表父票字段（0 请求）后整段退役。
4. **关系边缓存叠加。**
   - 做法：把上一轮（GraphQL 的）`blockedBy` 按票号存快照，降级时只对 `updatedAt` 变过的票重拉；边很少变（本仓 433 张里只有 14 张有边）。
   - 收益：第二轮起 14 → 0~2 次。
   - 代价：边变更有一轮延迟；需要记录缓存时刻并在快照里暴露「边可能旧」。
5. **`since` 增量。**
   - 做法：记上次快照时间，只拉 `since=...` 的票，其余沿用缓存。
   - 收益：列表 5 页 → 1~2 页。
   - 代价：关闭/转父/删边这类「不改变行内容」的变化不会出现在增量里，要配合定期全量；复杂度明显高于第 1–4 条。
6. **放弃 `counts` 等价，保持现状并如实标注。**
   - 收益：避免引入「假精确」；`deck.partial` 小圆点已经在做诚实提示。
   - 代价：降级期间看不到真实整仓计数（面板本来也只有派生值）。
7. **不推荐：用 search 取代 `counts`。** 1000 条上限 + 30 次/分钟，两个限制都会随仓库增长而爆；`open_issues_count` 同样不可用。

排序理由：第 1、2 条把「面板与详情看得见的差异」一次补齐，成本都是十几次请求；第 3 条修的是一个具体的孤儿问题；第 4、5 条是成本优化，前两条落地后再做才有意义；第 6 条是明确「这一格不求等价」的边界。

## 五、已知缺口逐条核对（含代码位置）

| 缺口 | 代码位置 | 是否属于等价目标 |
| --- | --- | --- |
| 列表降级不补 `blockedBy`（恒缺，界面上阻塞标记与筛选失真） | `issues.ts:105-146`（只映射行）、`normalize.ts:219-231`（等字段，但没有来源） | 是，第一优先 |
| 单票降级不补 `blockedBy`/`blocking`，只剩 `get` 自带的那一份 | `issues.ts:326-457`（REST 只 GET 单票）、`issue-detail-fetch.ts:141-145`（依赖失败退成 get 自带） | 是 |
| 单票降级不补评论正文，详情页评论空、加载更多失效 | `issues.ts:399`（REST 单票只有计数）、`comment-thread-fetch.ts:229`（加载更多也走 `get`） | 是 |
| 规格容器的父子边不修 | `parent-repair.ts:40-47`（筛 `wayfinder:map` 标签）、`:57`（只对这批容器发 `sub_issues`） | 是 |
| 子票树不在 `get` 里返回 | `issue-detail-fetch.ts:97-98`（固定空连接） | 否（既有设计，快照另给） |
| PR 只补 `merged_at`，不补 reviews | `pulls.ts:68-86` | 详情算，列表不算（快照剔 PR） |
| reviews 失败静默 | `pulls.ts:89-116` | 是（至少要知道缺了） |
| 评论编辑标记丢失 | `normalize.ts:182-211`（认 `lastEditedAt`，REST 无此字段） | 字段级不等价，影响很小 |
| 作者/指派人 `name` 丢失 | `normalize.ts:71-84`（认两种拼法，但 REST 没这个值） | 字段级不等价，详情页可见 |
| 计数完全不做 REST 兜底 | `counts.ts:17-20`（注释写明理由）、`counts.ts:79-143` | 「面板看不出降级」的一部分，但**做不到**；现状有 `deck.partial` 提示（`src/host/tracker/snapshot.ts:40-55`、`ListTab.ts:368`） |
| 降级横幅会显示 | `truthLines.ts:262-280` | 这是有意保留的信号；要「看不出」得单独做产品决定 |

现有门禁的覆盖情况：`tests/verify-github-rest-fallback.ts`（97 行）用 stub 造 `Post "https://api.github.com/graphql": unexpected EOF`，断言「150 行全量、414/8 的 `parentKey=7`、`url` 用 `html_url`、#7 `type=map`、按 `parentKey` 过滤得 2 条」。它**没有**断言 `blockedBy`、评论正文、计数，也没有和第二份 GraphQL 结果做逐字段 diff。任务里提到的 `tests/verify-refresh-414.*` 在仓库里不存在（全仓无匹配），当前真实门禁就是上面这一份。

## 六、GHES / 旧版本

- **子票 REST：企业版没有。** 官方文档的版本标注是 `fpt: '*'`、`ghec: '*'`，没有 `ghes` 一档。父票端点 `GET /issues/{n}/parent`、子票列表 `GET /issues/{n}/sub_issues`、加/移子票的 POST/DELETE 都属于这一页。也就是说在 GHES 上，降级路既拿不到 `parentKey`，也重建不出子票树，`setParent` 的 REST 回退同样不可用（`graph.ts:164-299` 在 GHES/未启用时会如实回 unsupported）。
- **依赖边 REST：GHES 3.19 起。** 版本标注是 `ghes: '>=3.19'`；3.19 以前连 `blocked_by` 端点都没有。github.com 上是全量可用（2025-08-21 GA，每种关系上限 50 条）。
- **因此 100% 等价在 GHES 上不成立**：即使 `blockedBy` 能补，父子边与子票树也补不回来。仓库已经有 `ghe-host` 这个降级原因（`fallback-reason.ts:56-73`：`GH_HOST` 不是 github.com 或报错里带 enterprise 时归到这一档），正确的做法是继续如实标 `ghe-host`，而不是在 GHES 上假装字段齐全。
- **API 版本**：文档现在标注请求头 `X-GitHub-Api-Version: 2026-03-10`。子票与依赖边端点要求选一个包含它们的版本（2022-11-28 之后的版本都可以）；实现时要确认 `gh api` 发出的版本头能被服务端接受，否则会出现「端点存在但字段被裁掉」的假等价。

## 七、如果要做，最小落地顺序

1. 先用一次真实请求确认两件事：`GET /issues` 列表行是否逐行带 `parent_issue_url` 与 `issue_dependencies_summary`；`GET /issues/{n}/sub_issues` 返回的 Issue 里是否带 `blockedBy` 的计数摘要。这两条决定成本是 24 次还是 400 次。
2. 列表降级：解析父票字段 + 只对「有依赖计数」的票拉 `dependencies/blocked_by`，写回 `normalizeIssue` 的 `parentKey`/`blockedBy`。
3. 详情降级：`get` 之后并发补 `comments`（1 次）与 `dependencies/blocked_by`、`dependencies/blocking`（2 次）；PR 再补 `reviews`（1 次）。失败要显式标「这一格没拿到」，不要静默。
4. `parent-repair` 的容器筛选改成按 `type`（spec 也算），或在第 2 条生效后退役这一段。
5. 计数保持 GraphQL-only；降级时继续用 `deck.partial` 提示，不要造数。
6. 补门禁：扩 `tests/verify-github-rest-fallback.ts`，断言 `blockedBy`、评论正文、`parentKey`（含 spec 容器）；再加一条离线 stub 的「GraphQL 快照 vs REST 快照逐字段 diff」门禁，把不等价的三个字段显式列成允许差异，防止以后悄悄扩大。

## 八、一句话总结

在 github.com 上，REST 可以把列表行与详情的字段补到「只差作者显示名和评论编辑标记」；代价是每轮多十几到几十次逐票/逐容器请求。`counts` 与 GHES 是两处无法等价的地方，必须如实承认，而不是硬凑。

## 参考文档

- 子票 REST（版本标注无 ghes）：https://docs.github.com/en/rest/issues/sub-issues?apiVersion=2022-11-28
- 依赖边 REST（ghes >= 3.19）：https://docs.github.com/en/rest/issues/issue-dependencies?apiVersion=2022-11-28
- REST 限流与次限流：https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GraphQL 限流与点数公式：https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- 搜索 API（30 次/分钟、1000 条上限）：https://docs.github.com/en/rest/search/search
- PR reviews REST：https://docs.github.com/en/rest/pulls/reviews
- 依赖功能 GA 公告（每种关系 50 条、搜索限定符）：https://github.blog/changelog/2025-08-21-dependencies-on-issues/
- 子票 REST 补充公告（取父票端点）：https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/
