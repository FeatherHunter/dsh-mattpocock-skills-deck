# 面板行数据的字段消费清单（#677 研究底稿）

这份底稿只回答一个问题：**今天有谁在读写面板快照里那一条条「票的行数据」上的哪些字段，读来干什么。**

它要服务的事：把「已关闭票的行」换成不带正文、不带评论的薄片段，并给快照瘦身（#677 的三步走，权威版本见 `docs/design/677-issue-pool-completeness-spec.md`）。动手删字段之前，得先知道删掉谁会让哪一处在界面上变成空白或变成假话。

写法约定：坐标一律写到「文件 + 行号」。凡是我没有亲眼核过的，都写进最后那节「没查到的」，不猜。

---

## 1. 结论一页纸

**一、行数据上有读者的字段，比想象的多；但有三个字段今天确实没有任何客户端读者。** 分别是 `reviews`、`parentKey`，以及派生出来的 `deck.progressOf`。另有 `reason` 和 `milestone` 只有一处在数「有几个字段有值」（检查页的诊断卡），没有任何地方显示它们的值。

**二、正文（`body`）和评论（`comments`）今天确实有读者，而且只有一处 —— 单票详情页的兜底。** `src/client/views/IssueDetail.js:35-37` 从快照里找一张票当兜底（`snapIssue`），正文读在 `:160`，评论读在 `:177` 与 `:182`。要瘦身，这一处必须一起想（规格第 12 节已经把它登记成风险）。

**三、兜底行没有正文时不会显示「加载中」，而是显示「无描述」这三个字。** 见 `IssueDetail.js:242-244`。它把「这一行没带正文」和「这张票真的没有描述」画成同一个样子。顺带一个同源副作用：兜底行没带评论时，页面底部会显示「只读」提示（`:182-183` 与 `:281`），那是在说「这张票不能评论」——而它其实只是没拿到评论。

**四、画成列表里的一行，最少要这些字段**：`key`、`number`（宿主从 `key` 现算加上去的）、`effortId`、`type`、`title`、`state`、`labels[]`（要 `name` 与 `color`）、`author.login`、`blockedBy[]`、`assignees`、`updatedAt`、`createdAt`、`isPullRequest`。`url` 只有本地 Markdown 后端需要（GitHub 靠模板现拼）。

**五、真机那份快照里，字段体积的大头是三个**：`body`（占整份快照 24.8%）、`tickets`（地图容器带在行上的整段子票，23.4%）、`comments`（15.2%）—— 三个加起来占 63.5%。其中 `tickets` 是重复的：同一批地图容器与子票在 `snapshot.issues` 与 `snapshot.maps` 里各存了一份，两处合计 99.6% 的快照体积。

---

## 2. 先立坐标：今天一份「行数据」上到底有哪些字段

### 2.1 客户端看到的两个数组不是「两类票」

这一点必须先说清，否则后面所有字段讨论都会偏。

`src/host/sessionSnapshot.js:289`（刷新路径在 `src/host/sessionRefresh.js:283`，逻辑相同）把三段拼成一个数组：

```js
let allForList2 = [].concat(inner2.maps || [])
  .concat((inner2.maps||[]).flatMap(function(m){ return m.tickets||[]; }))
  .concat(inner2.issues||[])
allForList2 = (await _dedupe()).dedupeListByPool(allForList2)
```

然后 `:315` 把结果挂进 `snapshot.issues`。

所以今天的事实是：

1. **`snapshot.issues` 是整个扁平票池** —— 地图容器、地图的全部子票、未挂图的票，三段拼起来再按身份去重。它不是「孤儿票」。
2. **`snapshot.maps[].tickets` 是同一批子票对象的另一个引用**，按父地图分组。
3. 拼完再按身份去重（`src/shared/tracker/list-dedupe.js:40` 的 `dedupeListByPool`），所以身兼两职的票（既是地图又挂在别的地图下）只出现一次，地图容器优先。

真机快照实测（见 2.3 的取数说明）：`snapshot.issues` 510 行 = 40 个地图容器 + 287 张地图子票 + 183 张未挂图的票；`snapshot.maps` 40 个容器，它们与 `issues` 里那 40 行**内容逐字节相同**（含各自整段 `tickets`）。也就是说地图容器连同它的子票在序列化后的快照里出现两遍。

### 2.2 字段从哪来：三层叠加

一条行数据上的字段不是一次写成的，是三层叠出来的。删字段时要知道删的是哪一层。

**第一层：契约形状**（`src/shared/tracker/shape.js:133-159` 的 `Issue` typedef）——`key` / `effortId` / `type` / `title` / `state` / `body` / `url` / `createdAt` / `updatedAt` / `closedAt` / `parentKey` / `labels` / `assignees` / `comments` / `blockedBy` / `reason` / `author`（可省） / `milestone`（可省） / `customFields`（可省） / `isPullRequest` / `mergedAt` / `reviews`。

**第二层：后端归一填值**——GitHub 那一份在 `src/host/tracker/backends/github/normalize.js:250-301`；查询片段在 `src/host/tracker/backends/github/queries.js:14-30`。注意 `number` 在这一层**不入契约**（`deriveKey` 把它收成字符串 `key`，`queries.js:15` 注明 number 只作 key 的来源）。

**第三层：宿主拼快照时补的字段**——这是客户端真正读到的那些「后端其实没给」的字段：

- `src/host/index.js:169-181` 的 `upcaseSnapStates`：把 `state` 升成大写 `OPEN` / `CLOSED`（客户端全程按大写比）。
- `src/host/sessionSnapshot.js:258` / `:264`：给地图与子票补 `number`（整数，从 `key` 解析）。
- `src/host/sessionSnapshot.js:265-271`：把 `blockedBy` 压平成**键字符串数组**（对象形状的引用只留 `ref.key`）。
- `src/host/sessionSnapshot.js:273-277`：补 `claimedBy`（取 `assignees[0].login`，没有就是空串）。
- `src/host/sessionSnapshot.js:279-283`：补 `level`（DAG 最长路径分层深度）。
- `src/host/sessionSnapshot.js:284-285`：给地图补 `stats`（各地图自己的进度统计）。
- `src/host/sessionSnapshot.js:288`：给 `issues` 里的行补 `number`。

### 2.3 真机快照实测：字段清单与体积

取数说明：读的是面板自己写在本机的磁盘快照 `D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache\FeatherHunter__dsh-mattpocock-skills-deck.json`（2026-09-22 02:19:43 写入，本仓库 `FeatherHunter/dsh-mattpocock-skills-deck`）。字段有无与条数如下（都是实测值，不是推断）：

| 字段 | `snapshot.issues` 510 行里出现的行数 | `snapshot.maps[].tickets` 287 行里出现的行数 |
| --- | --- | --- |
| `key` `effortId` `type` `title` `state` `body` `url` `createdAt` `updatedAt` `closedAt` `parentKey` `labels` `assignees` `comments` `blockedBy` `reason` `author` `isPullRequest` `mergedAt` `reviews` | 510（全部） | 287（全部） |
| `number` | 510 | 287 |
| `claimedBy` | 286 | 287 |
| `level` | 286 | 287 |
| `tickets` `destination` `notes` `decisions` `fog` `outOfScope` `stats` | 40（就是那 40 个地图容器） | 0 |
| `milestone` `customFields` | 0 | 0 |
| `progress` | 0 | 0 |

字段体积（把 `snapshot.issues` 那 510 行按字段分别序列化后按 UTF-8 计字节求和；整份快照的 JSON 是 11,848,079 字节，与磁盘上那个文件一样大）：

| 字段 | 字节 | 占整份快照 |
| --- | --- | --- |
| `body` | 2,942,140 | 24.83% |
| `tickets` | 2,775,067 | 23.42% |
| `comments` | 1,804,728 | 15.23% |
| `decisions` | 149,305 | 1.26% |
| `author` | 85,094 | 0.72% |
| `notes` | 75,745 | 0.64% |
| `labels` | 60,639 | 0.51% |
| `assignees` | 44,196 | 0.37% |
| `title` | 41,622 | 0.35% |
| `url` | 36,699 | 0.31% |
| `stats` | 19,573 | 0.17% |
| `destination` | 19,187 | 0.16% |
| 其余 20 余个字段合计 | 91,945 | 0.78% |

这张表只统计了 `snapshot.issues` 里的字段，合计 8,273,163 字节，占整份快照的 69.83%。剩下那 30% 几乎全是 `snapshot.maps`（3,526,843 字节，29.77%）：那 40 个地图容器连同各自的 `tickets` 数组在 `issues` 与 `maps` 里各存了一份，所以同一份子票数据被数了两遍（`deck` 只有 33,143 字节，其余字段合计不到 15,000 字节）。


另实测几件与「能不能不带」直接相关的事：

- `reviews` 在 510 行上**全是空数组**（`array(0)` 510 条）。
- `reason` 在 510 行上**全是空串**。
- `milestone` 与 `customFields` 一行都没有（本仓库没有票挂里程碑）。
- `comments` 非空的有 472 行（只有 38 行是空数组），且每行最多 50 条评论 —— 这是 1.80 MB 的来处。
- `blockedBy` 的条目今天绝大多数已是键字符串（`["689","688"]` 这种），另有 9 行仍是 `{key,title,state}` 对象形状的老数据。
- `labels[]` 每项带 `name` / `color` / `description` 三个键。

---

## 3. 客户端读者清单：谁读了哪个字段、读来干什么

下面按「读的地方」分组。凡写「无读者」的，指的是**客户端**；宿主自己读的地方我会单独点出来。

### 3.1 主列表：`src/client/views/ListTab.js` 与 `src/client/views/ListTabRow.js`

`ListTab.js:102` 取池子（`st.snapshot.issues`），`ListTabRow.js:8` 的 `listIssueRow` 画一行。两者合起来是最大的读者群。

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `ListTab.js:103`、`:104` | `state` | 把池子劈成「未关闭」与「已关闭」两堆（`!== 'CLOSED'` / `=== 'CLOSED'`） |
| `ListTab.js:110` | `number` | 排序维度「编号」 |
| `ListTab.js:112` | `title` | 排序维度「标题」 |
| `ListTab.js:115` | `updatedAt` / `createdAt`（按 `st.sortKey` 取） | 排序维度「更新时间 / 创建时间」，默认就是 `updatedAt` |
| `ListTab.js:118` | `effortId`、`number` | 排序同键时的兜底比较 |
| `ListTab.js:121` | `type`、`labels[].name` | 判「这行是不是地图行」（`type === 'map'` 或带 `wayfinder:map` 标签），地图行恒置顶 |
| `ListTab.js:133` | `snapshot.issues` 本身 | 复制成配色用的数组（不是读某个字段） |
| `ListTab.js:134-135` | `labels[].name`、`labels[].color` | 统计每个标签被多少张票用到（chips 排序用），并聚合「标签名 → 颜色」 |
| `ListTab.js:152` | `maps[].tickets[].blockedBy`、`.state`、`.number` | 走 `mapBlockOf` 建阻断表（只有 open 的阻塞者才算） |
| `ListTab.js:156` | `state`、`type`、`labels[]`、`blockedBy`、`key`、`effortId` | 走 `applyStandaloneBlocks` 把独立票自己的阻塞边并进阻断表 |
| `ListTab.js:165-167` | `labels[].name` | 标签筛选（多选，命中任一即显示） |
| `ListTab.js:174-175` | 走 `isOccupied`：`state`、`assignees`、`blockedBy` | 状态筛选「阻塞 / 可接」 |
| `ListTab.js:208-211` | 走 `openIssuesOf`：`state`；`isOccupied` 同上 | 顶部三个数字（可接 / 占用 / 已关闭） |
| `ListTab.js:287`、`:288`、`:295` | 逐行交给 `listIssueRow` | 画开放行、画「只看已关闭」的行、画底部折叠行里的行 |
| `ListTab.js:293` | 数 `closedRows.length` | 折叠行标题「已关闭 N」 |
| `ListTabRow.js:9`、`:41`、`:42` | `labels[].name` | 判标签、拼标签名串、判是否地图行 |
| `ListTabRow.js:11` | `number` | 复制链接时的提示文案与链接参数 |
| `ListTabRow.js:33` | `number`、`effortId` | 按身份去 `snapshot.maps` 里找这张地图，拿它的 `stats` |
| `ListTabRow.js:35`、`:51` | `idOf(x)`（= `effortId` + `key`） | 查阻断表、查这一行的高亮状态（变化/新增） |
| `ListTabRow.js:36-37` | `blockedBy`（经阻断表） | 行上的红色「被阻塞」小标与悬停提示里的阻塞者编号 |
| `ListTabRow.js:38`、`:70`、`:85` | 走 `mapObj.stats` 的 `total` / `closed` | 地图行右上角那个迷你圆环与「完成」按钮的判定 |
| `ListTabRow.js:48` | `title` | `+N` 标签弹窗的标题 |
| `ListTabRow.js:53` | `idOf(x)` | 这一行在 React 列表里的 key |
| `ListTabRow.js:56-57` | `number`、`effortId` | 点行时压导航栈（进地图详情或进单票详情） |
| `ListTabRow.js:66` | `effortId` | 多工作单元仓库里那一枚 effort 小标 |
| `ListTabRow.js:67` | `key`（有就用它，没有回落 `number`） | 行首那个 `#编号` |
| `ListTabRow.js:69` | `title`、`author.login`、`author.name`、`author.avatarUrl` | 标题与悬停完整标题、作者头像/首字母圆点（作者是自己时不显示） |
| `ListTabRow.js:71` | `isOpen`（由调用方按 `state` 传入的布尔） | 已关闭行末尾的「已关闭」小标 |
| `ListTabRow.js:75-77` | `labels[].name`、`labels[].color` | 行第二排那些标签小圆片 |
| `ListTabRow.js:80-82` | `blockedBy`（经阻断表） | 被阻塞小标；有归属地图时可点击跳过去 |
| `ListTabRow.js:85` | `number`、`title`；走 `mkRowAction` / `openInNewSession` | 行尾按钮组：诊断/修复/讨论/执行、在新会话打开 |
| `ListTabRow.js:88-93` | `number`、`effortId` | 复制链接、打开链接（`issueUrlFor` 的参数） |

顺带一提：`ListTabRow.js:85` 那一行有 2110 个字符，是仓库里最长的一行之一，改动时容易看漏。

### 3.2 地图详情：`src/client/views/MapDetail.js`（读 `snapshot.maps[].tickets`）

由 `src/client/panel/Dock.js:49`、`:56`、`:302` 接线：停靠栏在「列表页签 + 有当前地图」时渲染 `MapDetail`，传进去的 `g` 是 `compute()` 分组里的一项，`g.m.tickets` 就是这张地图的子票。

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `MapDetail.js:20` | `labels[].name`、`type` | 判子票是研究/原型/追问/任务/地图哪一种，选节点图标 |
| `MapDetail.js:21` | `tickets`（数组本身） | 本页全部子票的来源 |
| `MapDetail.js:24-26` | `m.decisions`、`m.fog`、`m.outOfScope` | 三个折叠块（这三个不在行上，是宿主解析地图正文补的） |
| `MapDetail.js:27`、`:31`、`:34` | `m.stats.levels` | 分层进度条与「当前层」 |
| `MapDetail.js:36`、`:60` | `level` | 把子票按层分桶、给当前层的节点加高亮 |
| `MapDetail.js:39`、`:41`、`:49`、`:59`、`:111`、`:134` | `state` | 迷雾判定、同层排序、完成态样式、动作按钮是否出现、「已关闭」小标 |
| `MapDetail.js:40`、`:136` | `blockedBy` | 迷雾判定；悬停文案里列阻塞者标题 |
| `MapDetail.js:44`、`:132` | `title` | 迷雾标题匹配、节点标题 |
| `MapDetail.js:52` | `number` | 同层排序 |
| `MapDetail.js:62`、`:64`、`:69`、`:96`、`:120` | `idOf(t)`（= `effortId` + `key`） | 去雾状态表的键、行高亮表的键、React key |
| `MapDetail.js:90-93` | `labels[].name`、`type` | 行点击时分流：进下一级地图详情还是进普通工单详情 |
| `MapDetail.js:99-100`、`:113-114` | `number`、`effortId` | 压导航栈、拼外链 |
| `MapDetail.js:129` | `key`（有就用，没有回落 `number`） | 节点上的 `#编号` |
| `MapDetail.js:135` | `claimedBy` | 节点副信息里的认领人 |
| `MapDetail.js:139` | 走 `tProgressBar`：`state`、`progress` | 进度条 |
| `MapDetail.js:140` | 走 `tStatusBadge`：`state`、`progress` | 状态徽章 |
| `MapDetail.js:169`、`:200`、`:209`、`:282`、`:291` | `m.stats` | 「完成」判定与三个动作按钮的取舍 |
| `MapDetail.js:183`、`:232`、`:236` | `m.number`、`m.title`、`m.effortId` | 面包屑、地图编号徽章、标题、effort 小标 |
| `MapDetail.js:255`、`:262` | `m.destination`、`m.notes` | 目的与正文（都是宿主解析地图正文补的，不是行字段） |

### 3.3 单票详情：`src/client/views/IssueDetail.js`

这一处的兜底路径是本次重点，单独在第 5 节整节说。这里先列非兜底的部分：

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `IssueDetail.js:35-36` | `number`、`effortId` | 在池子里找这一张票当兜底（见第 5 节） |
| `IssueDetail.js:50-53` | `maps[].tickets[].number`、`.effortId` | 探测这张票挂在哪张地图下，画「属于 #N 地图」那一行 |
| `IssueDetail.js:97-101` | `maps`（找地图）+ 子票节点的 `number`、`effortId` | 子票/阻塞票点击后的分流 |

### 3.4 拉取请求页签：`src/client/views/PrTab.js`

数据来自 `store-derived.prIssuesOf`（只收 `isPullRequest === true` 的行）。

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `PrTab.js:27` | `isPullRequest` | 页签里只留拉取请求 |
| `PrTab.js:30` | `number`、`key` | 点行进详情 |
| `PrTab.js:55-58` | `updatedAt`、`number`、`key` | 按更新时间倒序排，同时间按编号 |
| `PrTab.js:70` | `key`（有就用，没有回落 `number`） | 行首 `#编号` 与 React key |
| `PrTab.js:71` | 走 `prStateKind`：`state`、`mergedAt` | 三态显示（打开 / 已关闭 / 已合并） |
| `PrTab.js:72` | `author.login` | 行上的 `@作者` |
| `PrTab.js:73`、`:84-86` | `labels[].name`、`labels[].color` | 标签小圆片（色优先取聚合色，回落票面色） |
| `PrTab.js:78` | `title` | 行标题（没有就回落 `#编号`） |
| `PrTab.js:89` | `updatedAt` | 行尾那句日期 |

### 3.5 派生与计数：`src/client/kernel/store-derived.js`

这个文件是全客户端读行数据最集中的地方，多个视图与状态栏都从这里取数。

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `:34-43` `effortNamesOf` | `effortId`（读 `maps`、`maps[].tickets`、`issues` 三处） | 数这个仓库有几个工作单元；多工作单元时界面才显示 effort 小标与筛选行 |
| `:45-61` `mapBlockOf` | `tickets[].blockedBy`、`.state`、`idOf`（`key`+`effortId`）、`m.number`、`m.title`、`m.effortId` | 建地图子票的阻断表（只记 open 的阻塞者），并记住归属地图供跳转 |
| `:64-77` `compute` | `tickets[].state`、`.claimedBy`、`.blockedBy` | 把每张地图的子票分成 frontier / claimed / blocked / closed 四堆；地图详情、技能页、状态栏都用它 |
| `:82` `openIssuesOf` | `state` | 「未关闭」这个口径的唯一实现（可接/占用/BUG/待分流的底座） |
| `:95-105` `standaloneStateMapOf` | `state`、`key`、`effortId` | 把全池状态收成一张按身份键入的表，供独立票阻塞边解析 |
| `:108-118` `standaloneHasOpenBlocker` | `blockedBy`（及其老对象形状上的 `.state`） | 判独立票有没有 open 的阻塞者 |
| `:119-144` `isOccupied` | `state`、`assignees`、`tickets[].blockedBy`、`tickets[].state` | 「被占用」的唯一定义（有指派人，或有 open 阻塞者） |
| `:150-186` `applyStandaloneBlocks` | `state`、`type`、`labels[].name`、`blockedBy`、`key`、`effortId` | 把独立票自己的阻塞边并进阻断表（地图票不碰） |
| `:188-191` `hasLabelOf` / `isTriageLike` / `bugCount` / `triageCount` | `labels[]` | 状态栏与检查页的 BUG / 待分流计数 |
| `:197-206` `buildColorOf` | `labels[].name`、`labels[].color`（读 `snapshot.labels`、`issues`、`maps[].tickets` 三处） | 「标签名 → 颜色」聚合表；改色弹窗、列表、详情都用它 |
| `:216-226` `actionColorOf` | `labels[]` | 行尾按钮的主色（按标签四选一） |
| `:228-243` `rowActionText` | `number`、`key`、`labels[]` | 生成注入给会话的指令文本 |
| `:246-286` `mkRowAction` | `number`、`labels[]` | 行尾那个主按钮（诊断/修复/讨论/研究/原型/执行） |
| `:305-324` `prIssuesOf` | `isPullRequest`、`key`、`number`、`effortId` | 拉取请求页签的行来源，按身份去重 |

状态栏的入口在 `src/client/statusbar/checksums.js:14-16`：`frontierCount(s)` / `bugCount(s)` / `triageCount(s)`，三个都落在 `openIssuesOf` 上，所以状态栏那几枚数字也读上面的 `state` 与 `labels`。

### 3.6 链接与身份：`src/client/kernel/link.js`

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `link.js:49` | `snapshot.issues` + `snapshot.maps[].tickets` | 拼一个「全池」数组用来找这张票 |
| `link.js:52` | `idOf(x)`（`effortId` + `key`） | 给了工作单元时按身份精确取 |
| `link.js:53` | `key`、`number` | 没给工作单元时按编号回落取 |
| `link.js:54` | `url` | **这是全客户端唯一一处从行数据上读 `url` 的地方**。有值就直接用它（本地 Markdown 的盘符路径就靠这一条）；没有才回落到后端的链接模板现拼 |

身份的算法只有一份，在 `src/shared/tracker/constants.js:102-127`：`effortOf(issue)` 读 `effortId`，`idOf(issue)` = `effortId + NUL + key`。所以 `key` 与 `effortId` 是被间接读得最多的两个字段 —— 几乎每个派生函数的第一件事都是给行做键。

### 3.7 改色补丁：`src/client/views/labels/labelColorPatch.js`

这个文件不只是读，还会**写**。它在保存标签颜色成功后，把新色写进当前这份快照的四个落脚点。

| 读/写的地方 | 字段 | 干什么 |
| --- | --- | --- |
| `:82` | `snap.labels[]`（不是行） | 写快照自带的标签表 |
| `:83` | `snap.deck.labels[]`（不是行） | 写派生色板。规格第 3 节第 7 条说的就是这个读者 |
| `:88` | `m.labels[]`（地图容器自己的标签） | 写地图容器的标签色 |
| `:89-90` | `m.tickets[].labels[].name`、`.color` | 写地图下每一张子票的标签色 |
| `:92-93` | `snap.issues[].labels[].name`、`.color` | 写未挂图的票的标签色 |

所以 `labels[]` 上的 `name` 与 `color` 既是读的对象也是写的对象；**换薄片段时，这里是最容易被忽略的一处**：`patchList` 只改对象形状的标签项（`:73`），字符串形状的原样跳过。

### 3.8 变化探测：`src/client/kernel/probe-snapshot.js` 与 `probe-chain.js`

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `probe-snapshot.js:105` | `labels[].name` | 把标签名排序拼成串，用于「标签变没变」的比较 |
| `probe-snapshot.js:115-116` | `tickets[].key`、`effortId`（经 `idOf`） | 给新旧两份快照的子票各自建索引 |
| `probe-snapshot.js:119-120` | `state`、`progress`、`claimedBy`、`labels[].name`、`updatedAt` | 逐票比这几个字段，判这行要不要闪一下 |
| `probe-snapshot.js:123` | `maps[].state`、`.title`、`.labels[]` | 判这张地图整体有没有变 |
| `probe-snapshot.js:129-136` | `issues[].key`、`.effortId`、`.state`、`.title`、`.labels[].name`、`.updatedAt` | 主列表根票的变化/新增/删除，产出 `rowFlash` |
| `probe-chain.js:171-178` | `tickets[].blockedBy`、`.number`、`.state`、`.title` | 拼「被谁阻塞」的悬停文案（只列仍 open 的阻塞者） |

注意 `probe-snapshot.js:120` 里比了 `progress`，但今天行上没有这个字段（见 3.10），两边都是 `undefined`，这一项恒不产生差异。

### 3.9 两处低频读者

| 读的地方 | 读的字段 | 读来干什么 |
| --- | --- | --- |
| `src/client/views/ChecksTab.js:219`、`:226-232` | `snap.issues` 上的 `author`、`assignees`、`labels`、`milestone`、`customFields`、`reason`、`blockedBy`、`comments`、`closedAt` 九个字段 | 检查页底部那张折叠的「能力诊断卡」：逐票数这九个字段各有几个「有值 / 空值 / 缺字段」。它不显示任何一个字段的值，只看在不在。`:221` 先看 `snap.capabilities`，而今天宿主恒把它填成 `null`（`src/host/sessionSnapshot.js:44`），所以这条回落每次都会跑 |
| `src/client/views/NoRepoCard.js:141-149` | `snap.labels[].name`；没有标签表时回落聚合 `snap.issues[].labels[].name` | 新建仓库成功后算「还缺哪几个内置标签」，决定要不要弹标签步骤 |

`src/host/snapshotBuild.js:128` 有一份与 `ChecksTab.js:224` 完全相同的九字段清单，那是宿主侧的旧直连路径，今天没有电话调用它（见 3.10）。

### 3.10 读到了、但今天没有来源的两个字段

这两条是**读者存在、生产者不在**，与「字段没人读」正好相反，但同样影响薄片段的设计。

**`progress`。** 读它的是 `src/client/views/shared/ticket.js`：`tStatus`（`:9-14`）、`tStatusLabel`（`:15-22`）、`tProgressBar`（`:23-33`）、`tStatusBadge`（`:34-41`）四个函数都读 `t.progress`。用它们的是 `MapDetail.js:139`、`:140` 与 `TicketRow.js:34`、`:36`。

但真机快照 510 行 + 287 行子票上**一条都没有 `progress`**（2.3 的实测）。全仓唯一会产出它的地方是旧直连路径的 `src/host/mapBody.js:71`（`progress: parseProgress(raw.body)`，属于 `mapTicket` 这个旧形状），而这条路径已经不在今天的取数链路上：`src/host/sessionSnapshot.js:197` 与 `:215` 都注明「所有后端均走 composeSnapshot，不再硬走 buildSnapshot 直调 gh」，`buildSnapshot` 只剩定义（`src/host/index.js:140`）与包装（`src/host/snapshotBuild.js:226`）而没有任何电话调用点，`wf.snapshot` / `wf.refresh` 两个电话（`src/host/index.js:255`、`:257`）都不经过它。

**结论**：进度块今天算在宿主侧，落在 `deck.progressOf` 上（`src/shared/tracker/deck-derive.js:183`，`parseProgress(t.body)`），客户端并没有把它读回来（见 3.11 的第一条）。所以 `tProgressBar` 读到的 `t.progress` 是 `undefined`，画出来是 `—` 与 0%。

**`blockedBy` 条目上的 `title` 与 `state`。** 契约形状里 `blockedBy` 是 `IssueRef[]`（`{key, title, state}`），但宿主在 `src/host/sessionSnapshot.js:265-271` 与 `src/host/sessionRefresh.js:255-266` 把它压成了键字符串数组。所以客户端拿到的绝大多数是 `["689","688"]` 这种（实测 9 行仍是老对象形状）。客户端那几个读阻塞边的地方（`refKeyOf`、`standaloneKeyOfRef`）实际只用得到键。`store-derived.js:180` 那句「用边自带的 `state` 回落」在压平后的数据上取不到东西（它不是对象），这是同源的一处。

### 3.11 只定义了、今天没有渲染入口的组件：`TicketRow`

`src/client/views/TicketRow.js:8` 定义了 `TicketRow`（读 `t.labels`、`t.type`、`t.number`、`t.state`、`t.blockedBy`、`t.key`、`t.title`、`t.author`、`t.claimedBy`、`t.progress`），构建也把它打进了产物（`scripts/build.mjs:332`，实测 `client.js` 里出现 2 次），但**全仓没有任何调用点**：`src/client` 里搜不到渲染 `TicketRow` 的地方，`Dock.js:302-303` 只渲染 `MapDetail` / `IssueDetail` / `ListTab` / `PrTab` / `SkillsTab` / `ChecksTab`。

所以它今天不构成「行数据必须带什么字段」的理由，但改动时会误导人：读起来像有读者，实际没有渲染入口。（旁证：`tests/verify-leaves.js:23` 还在断言这个文件导出了 `TicketRow`。）

### 3.12 顺带核到：`deck.progressOf` 没有任何客户端读者

`deriveDeck` 产出 `{progressOf, labels, stats, blockedByKeys}`（`src/shared/tracker/deck-derive.js:237`），宿主挂在 `snapshot.deck` 上（`src/host/tracker/snapshot.js:163`）。真机快照里 `deck` 的键就是这四个（实测）。

客户端只读其中两个：`snap.deck.labels`（`labelColorPatch.js:83`）与 `snap.deck.stats`（规格第 3 节第 7 条只登记了 `labels` 这一处读者；我另外核到 `labelColorPatch.js:83` 之外，客户端搜不到 `deck.progressOf` 与 `deck.blockedByKeys` 的读取）。**`deck.progressOf` 与 `deck.blockedByKeys` 今天在客户端没有读者。**

---

## 4. 逐字段总表：字段 → 客户端读者 → 能不能不带

说明：这一节只陈述事实。「能不带」的口径是**这份行数据只供客户端读**（后端仍然要产出宿主组装要用的字段，宿主自己读了哪些我在「宿主侧」一列注明）。我不判断该不该删。

| 字段 | 客户端有读者吗 | 主要读者（文件:行） | 宿主侧也读吗 |
| --- | --- | --- | --- |
| `key` | 有 | `constants.js:120-127` 的 `idOf`（几乎每个派生函数都用）、`ListTabRow.js:67`、`PrTab.js:70`、`link.js:53`、`store-derived.js:313` | 读（`list-dedupe.js:24`、`deck-derive.js:67`） |
| `effortId` | 有 | `constants.js:102-110` 的 `effortOf`、`ListTabRow.js:66`、`MapDetail.js:99-100`、`IssueDetail.js:252`、`store-derived.js:16/102/178/315` | 读（`snapshot.js:33/49/64`） |
| `type` | 有 | `ListTab.js:121`、`ListTabRow.js:32`、`MapDetail.js:20/93`、`store-derived.js:164/167` | 读（`snapshot.js:56/77`） |
| `title` | 有 | `ListTab.js:112`、`ListTabRow.js:48/69`、`MapDetail.js:44/132`、`PrTab.js:78`、`probe-snapshot.js:123/134`、`probe-chain.js:177` | 读（版号、层统计） |
| `state` | 有 | `ListTab.js:103-104/174-175`、`store-derived.js:70-74/82/120/167/211`、`ticket.js:9/24`、`PrTab.js:71`、`IssueDetail.js:148`、`probe-snapshot.js:120/134` | 读（`deck-derive.js:211`） |
| `body` | **有，但只有一处** | `IssueDetail.js:160`（兜底行的正文）→ `:242-244` 渲染 | 读（`deck-derive.js:183` 解析进度） |
| `url` | 有 | `link.js:54`（全客户端唯一一处） | 读（`sessionSnapshot.js:164-188` 给 markdown 兜底） |
| `createdAt` | 有 | `ListTab.js:115`（排序维度）、`IssueDetail.js:225` | 读（版号不含它） |
| `updatedAt` | 有 | `ListTab.js:115`（默认排序键）、`PrTab.js:55-58/74/89`、`probe-snapshot.js:120/134`、`IssueDetail.js:224` | 读（版号、变化探测） |
| `closedAt` | 有 | `IssueDetail.js:231`（显示「关闭日期」）、`ChecksTab.js:224`（诊断计数） | 读（`capability.js` 字段清单） |
| `parentKey` | **没有** | 客户端搜不到任何读者 | 读（`snapshot.js:48` 用来按父票分组出 `maps[].tickets`） |
| `labels[]`（`name`/`color`） | 有 | `ListTab.js:121/135/165`、`ListTabRow.js:9/41/76-77`、`MapDetail.js:20/92`、`PrTab.js:73/84-86`、`store-derived.js:164/188-191/202/217/248`、`labelColorPatch.js:90/93`、`probe-snapshot.js:105` | 读（`deck-derive.js:187-195`） |
| `labels[].description` | **没有** | 客户端搜不到行上的读者（`labelColorErrors.js:72` 读的是「列出标签」那条电话的回包，不是行数据） | 不读 |
| `assignees[]` | 有 | `store-derived.js:121`（`isOccupied`）、`IssueDetail.js:146-147/220-222`（只取 `login`）、`ChecksTab.js:224` | 读（`sessionSnapshot.js:274` 派生 `claimedBy`；`deck-derive.js:214/219`） |
| `assignees[].name` / `.avatarUrl` / `.kind` | **没有** | 客户端在行数据上只取 `login` 与数组长度 | 读（`kind` 参与 `deck` 的认领判定说明，代码里实际只用长度） |
| `comments[]` | **有，但只有一处** | `IssueDetail.js:177/182-183`（兜底行的评论区与「能不能评论」）→ `IssueDetailComments.js:81/91` | 不读 |
| `blockedBy[]`（键） | 有 | `store-derived.js:54/72-74/132/171`、`MapDetail.js:40`、`probe-chain.js:171-178`、`probe-snapshot.js:110`（注释口径） | 读（`deck-derive.js:87/120/234`） |
| `blockedBy[].title` / `.state` | 没有（客户端拿到的是键字符串，见 3.10） | —— | 读（`upcaseSnapStates` 会碰，但压平发生在其后） |
| `reason` | 名义上有（只数不显示） | `ChecksTab.js:224` | 读（`capability.js:37` 字段清单） |
| `milestone` | 名义上有（只数不显示） | `ChecksTab.js:224` | 读（同上；真机数据里一张都没有） |
| `customFields` | 名义上有（只数不显示） | `ChecksTab.js:224` | 读（同上；真机数据里一张都没有） |
| `author`（`login`/`name`/`avatarUrl`） | 有 | `ListTabRow.js:69`、`PrTab.js:72`、`IssueDetail.js:227-229`、`ChecksTab.js:224` | 读（`TicketRow`、版号不含它） |
| `author.kind` | **没有** | 客户端搜不到 | 不读 |
| `isPullRequest` | 有 | `store-derived.js:312`、`PrTab.js:27`、`IssueDetail.js:185` | 读（`snapshot.js:34-37` 池内身份、版号） |
| `mergedAt` | 有 | `stateKind.js:30`（经 `PrTab.js:71` 与 `IssueDetail.js:152`） | 读（版号 `prSigOf`） |
| `reviews[]` | **没有** | 客户端搜不到任何读者 | 读（`snapshot.js:102` 版号签名；`issueDetail.js:137`） |
| `number`（宿主补的） | 有 | `ListTab.js:110`、`ListTabRow.js:11/33/56/67/85`、`MapDetail.js:40/52/99/113/129`、`PrTab.js:30/58/70`、`IssueDetail.js:36/93/97`、`link.js:53`、`store-derived.js:230/232/247/313`、`api-io.js:14/23`、`probe-chain.js:172/176` | 是宿主自己补的（`sessionSnapshot.js:258/264/288`） |
| `claimedBy`（宿主补的） | 有 | `MapDetail.js:135`、`store-derived.js:72-74`、`probe-snapshot.js:120` | 是宿主自己补的（`sessionSnapshot.js:273-277`） |
| `level`（宿主补的） | 有 | `MapDetail.js:36/60` | 是宿主自己补的（`sessionSnapshot.js:280-283`） |
| 地图容器上的 `tickets` / `stats` / `destination` / `notes` / `decisions` / `fog` / `outOfScope` | 有（但读的是 `snapshot.maps` 这一份，不是 `issues` 里那一份） | `MapDetail.js:21/24-27/255/262`、`ListTabRow.js:33/38`、`store-derived.js:50/68` | 读（`snapshot.js:62-70` 解析地图正文） |
| `progress` | 读的人有、字段没有（见 3.10） | `ticket.js:9-41` → `MapDetail.js:139-140` | 旧直连路径才产出 |

**今天取了、但客户端确定没有任何读者的字段（事实清单，非建议）**：

1. `parentKey` —— 宿主组装树结构要用，但客户端一行都不读。
2. `reviews` —— 客户端零读者（含空数组，真机 510 行全是 `[]`）。
3. `deck.progressOf`（以及同批的 `deck.blockedByKeys`）—— 派生出来挂在快照上，客户端零读者。
4. `labels[].description` —— 行数据上没有客户端读者。
5. `assignees[].name` / `.avatarUrl` / `.kind` —— 行数据上只用到 `login` 与数组长度。
6. `author.kind` —— 行数据上零读者。
7. `blockedBy[].title` / `.state` —— 宿主已压平成键，客户端读不到也用不上。
8. `reason`、`milestone`、`customFields` —— 只有 `ChecksTab.js:224` 把字段名当字符串数在不在，没有任何地方显示它们的值；真机数据里 `reason` 全是空串、`milestone` 与 `customFields` 一个都没有。

**反过来要小心的两个字段（今天有人读，不能顺手当「没人读」删掉）**：

1. `body` —— `IssueDetail.js:160` 一条线上的人。
2. `comments` —— `IssueDetail.js:177/182`，还决定详情页底部显不显示那句「只读」（见第 5 节）。

---

## 5. 单票详情页的兜底路径（`IssueDetail.js:35-37`）逐字段说明

### 5.1 兜底那一行是怎么取到的

```js
const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
const snapIssue = issues.find(function (x) { return x.number === issueNumber && effortOf(x) === issueEffort })
               || issues.find(function (x) { return x.number === issueNumber })
const src = detail || snapIssue
```

三点事实：

1. **只在 `snapshot.issues` 里找，不在 `snapshot.maps[].tickets` 里找。** 今天因为 `snapshot.issues` 就是整个扁平票池（2.1），地图子票也在里面，所以兜底照样命中子票；但这条依赖很脆 —— 一旦 `snapshot.issues` 不再包含地图子票，子票详情的兜底就查不到了。
2. **优先按「编号 + 工作单元」精确命中，找不到再退化成只按编号找**（同号票在不同工作单元里会撞）。
3. **只有真详情（`detail`）还没到时才会用到它**：`src = detail || snapIssue`。真详情由 `fetchIssueDetail`（`src/client/kernel/api-io.js:51`，走宿主电话 `wf.issueDetail`）取。

### 5.2 兜底行上读了哪些字段

`src` 落到 `snapIssue` 时，下面这些读法读的就是快照里那一行：

| 读的地方 | 读的字段 | 读来干什么 | 字段没有时画成什么 |
| --- | --- | --- | --- |
| `:36` | `number`、`effortId` | 找到这一行 | 找不到就没有 `src`，走 `:135` 的轻量占位 |
| `:144` | `labels`（认两种形状：数组、或 `{nodes:[…]}`） | 顶部标签小圆片 | 空数组，不画 |
| `:146-147` | `assignees` | 顶部 `@认领人` 小圆片 | 空数组，不画 |
| `:148` | `state` | 状态基础值 | 回落 `'OPEN'` |
| `:152` | 经 `prStateKind`：`state`、`mergedAt` | 三态显示 | `stateKind.js:33` 出错才回落 `'closed'`；字段缺失时算 `open` |
| `:157` | `title` | 页面标题 | 回落 `'#' + issueNumber` |
| `:160` | **`body`** | 正文（见 5.3） | 空串 |
| `:174-175` | `subIssues.nodes` / `subIssues.totalCount` | 「子票 N」那一段 | 不画这一段 |
| `:176` | `blockedBy.nodes` | 「被阻塞 · N」那一段 | 不画这一段 |
| `:177`、`:182-183` | **`comments`** | 评论列表 + 「能不能评论」（见 5.4） | `canComment` 变假 |
| `:185` | `isPullRequest` | 拉取请求详情不给输入框 | 照常可评论 |
| `:224` / `:225` | `updatedAt` / `createdAt` | `· 更新 …` / `· 创建 …` | 不画 |
| `:227-229` | `author.login`、`author.avatarUrl` | `@作者` 与头像 | 不画 |
| `:231` | `closedAt` | `· 关闭 …`（只在非 open 且字段存在时） | 不画 |
| `:194`、`:206` | 只用「有没有 `src`」这个事实 | 顶部那个「快照」角标与「（显示快照降级）」提示 | —— |

顺带：`:178` `const isStale = !detail && !!snapIssue`，`:194` 会把这一页标成「快照」。也就是说界面今天**知道**自己在显示兜底行。

### 5.3 如果那一行没有正文，会渲染成什么

链条很短：

1. `:160` `const body = src.body || ''` —— 没有正文就是空串。
2. `:242-244`：

```js
(body && String(body).trim())
  ? h('div', …, (typeof mdToHtml === 'function' ? mdToHtml(body, { st: st }) : String(body)))
  : h('div', { style: { … } }, '无描述'),
```

**渲染结果是「无描述」这三个字，没有加载态、没有占位骨架、没有「详细内容加载中」。**（注意它是硬编码中文，不在词条表里，与仓库「界面文字走词条」的纪律不一致，这是我在核对时顺手看到的一处，不是本次任务的结论。）

同一页 `:141` 那句 `'无描述（快照未命中，细节加载中）'` 只在 `!src`（连兜底行都找不到）时才出现，与「兜底行没有正文」不是同一条路。

**所以薄片段带来的是一个会说话说错的界面**：薄行带得回标题、状态、标签、时间，但正文那一格会断言「这张票没有描述」。规格第 12 节把这条登记成落地前必须先列清单的风险，这份底稿就是那份清单的第 5.2 与 5.3 两节。

还有一条相关的时序事实：`:105` 的加载态分支条件是 `mode === 'loading' && !src`。只要兜底行在池子里，`src` 就是真值，加载态被跳过 —— 页面不会显示「正在加载正文」，而是直接显示 5.3 说的那一格。

### 5.4 没有评论时会怎样（同一个兜底的第二处副作用）

`:182-183`：

```js
const rawComments = src.comments
let canComment = !!rawComments && (Array.isArray(rawComments) ? true : !!(typeof rawComments === 'object' && Array.isArray(rawComments.nodes)))
```

薄行不带评论 → `rawComments` 是 `undefined` → `canComment` 为假 → `:281` 显示 `tr('detail.readOnlyHint')`（「只读」提示），`:276` 把评论区按「没有评论」渲染。

也就是说「这一行没带评论」会被画成「这张票不能评论」。这与 5.3 是同一个毛病：**用「手上没有」冒充「实际上没有」。**

---

## 6. 画成列表里的一行，最少需要哪些字段

口径先说清：下面的「一行」指 `ListTabRow.js:8` 的 `listIssueRow` 画出来的那一行，加它渲染前必经的那条流水线（`ListTab.js` 的排序 / 过滤 / 派生）。不含单票详情页、地图详情页、拉取请求页签的额外需要。

### 6.1 必需字段清单

**A 组 · 画像素本身就要（`listIssueRow` 直接读）**

| 字段 | 用来画什么 |
| --- | --- |
| `key` | 行首 `#编号`（`ListTabRow.js:67` 有就用它）、行身份（`:35`、`:51`、`:53`） |
| `number` | 点行压栈（`:56-57`）、找地图（`:33`）、复制/打开链接（`:11`、`:88-92`）、按钮提示（`:85`）。**注意**：这是宿主从 `key` 现算补上去的字段，后端给的是 `key`；走新路取回来的行若不带 `number`，上面这些读者读到的就是 `undefined`（第 8 节列了这一点） |
| `effortId` | 多工作单元时的 effort 小标（`:66`）、身份与找地图（`:33`、`:56`）。GitHub 恒为空串 |
| `type` | 判「这行是地图行」（`:32`；也可由 `wayfinder:map` 标签推出） |
| `title` | 行标题与悬停完整标题（`:69`）、`+N` 弹窗标题（`:48`）、按钮注入文本（`:85`） |
| `labels[].name` | 标签小圆片（`:76-77`）、判地图行（`:9`）、按钮取色（`store-derived.js:217-225`） |
| `labels[].color` | 标签小圆片的颜色（`:77`） |
| `author.login`（可选 `name` / `avatarUrl`） | 行尾作者头像或首字母圆点（`:69`） |
| `blockedBy[]` | 红色「被阻塞」小标（`:36-37`、`:80-82`，独立票经 `applyStandaloneBlocks`；地图子票经 `mapBlockOf`） |

**B 组 · 列表这条流水线要（`ListTab` 与它的派生读，不画像素但决定这一行出不出现、排在第几）**

| 字段 | 用来干什么 |
| --- | --- |
| `state` | 拆「未关闭 / 已关闭」两堆（`ListTab.js:103-104`）；状态筛选「阻塞 / 可接」（`:174-175`）；顶部三个数字（`:208-211`）；阻断表与占用判定（`store-derived.js:120`、`:167`） |
| `updatedAt` | 默认排序键（`ListTab.js:115`，`st.sortKey` 默认 `'updatedAt'`） |
| `createdAt` | 排序维度「创建时间」（`ListTab.js:115`，点排序 chips 时会取） |
| `labels[]` | 标签筛选（`ListTab.js:165-167`）、标签统计与配色聚合（`:133-135`） |
| `assignees` | `isOccupied` 的「有指派人即被占用」（`store-derived.js:121`） |
| `isPullRequest` | 把拉取请求从主列表分出去（`store-derived.js:312`、`PrTab.js:27`）。**今天 `ListTab` 还没按它过滤**，规格第 11 节阶段 1 要做这件事 |
| `url` | 链接兜底。严格说不是必需：`link.js:54` 取不到才回落模板现拼（`:56-62`）。**但本地 Markdown 后端只有这一条路能拼出盘符路径**，所以对 Markdown 是必需 |

**C 组 · 只有这一份行数据同时还要喂别处时才要**

| 字段 | 谁要 |
| --- | --- |
| `body` | 单票详情兜底（`IssueDetail.js:160`，第 5 节） |
| `comments` | 单票详情兜底（`IssueDetail.js:177`、`:182`） |
| `closedAt` | 单票详情兜底（`IssueDetail.js:231`） |
| `subIssues` / `blockedBy.nodes` | 单票详情的那两段清单（`IssueDetail.js:174-176`）。注意这是**详情电话**的形状，快照行上今天并没有（真机实测 510 行无 `subIssues`） |
| `reason` / `milestone` / `customFields` / `assignees` / `author` / `closedAt` / `blockedBy` / `comments` / `labels` | 检查页那张能力诊断卡要数这九个字段在不在（`ChecksTab.js:224`） |

### 6.2 与今天的字段清单对比

今天一条行数据上**有**、但上面三组里一个都不出现的字段（即：客户端没有任何读者，确定可以不带）：

`parentKey`、`reviews`、`labels[].description`、`assignees[].name`、`assignees[].avatarUrl`、`assignees[].kind`、`author.kind`、`blockedBy[].title`、`blockedBy[].state`，以及派生层上的 `deck.progressOf` 与 `deck.blockedByKeys`。

今天一条行数据上**有**、读者只有「数在不在」这一种（`ChecksTab.js:224`）的字段：`reason`、`milestone`、`customFields`（外加 `closedAt`、`comments`、`assignees`、`author`、`blockedBy`、`labels` —— 但这六个另有真正的读者）。

体积上值得记一笔：客户端零读者的这些字段，在真机快照里都不是大头（`reviews` 1,020 字节、`parentKey` 2,333 字节、`reason` 1,020 字节、`labels[].description` 混在 `labels` 的 60,639 字节里，`assignees[].name` 等混在 `assignees` 的 44,196 字节里）；大头是 `body`（2.94 MB）、`tickets`（2.78 MB）、`comments`（1.80 MB）—— 前两样正好是薄片段要动的目标，第三样（`comments`）只悬在详情兜底这一条线上。

### 6.3 三件要小心的

1. **`number` 不是后端给的字段。** 今天它是宿主在 `src/host/sessionSnapshot.js:258`、`:264`、`:288` 从 `key` 现算加上去的。客户端好几处直接读 `x.number` 而不回落 `x.key`（`ListTabRow.js:11`、`:56-57`、`:85`、`ListTab.js:110`、`api-io.js:14/23`）。走新的分页路取回来的行，要么同样由宿主补上 `number`，要么把这些读者改成读 `key` —— 否则点行会压进一个 `undefined`，详情页变成空白。
2. **`state` 必须是大写 `OPEN` / `CLOSED`。** 客户端全篇按大写比（`ListTab.js:103-104`、`store-derived.js:120`、`ticket.js:9`）。大写化发生在宿主侧（`src/host/index.js:169-181`）。新路若按契约小写直接递给界面，会把所有已关闭票当成未关闭。
3. **`labels[]` 既是读也是写。** `labelColorPatch.js:90/93` 会就地改行上的 `labels[].color`。`patchList` 只认对象形状的标签项（`:73`），字符串形状原样跳过。薄片段若把标签换成字符串数组，这一处会静默失效（改色后要等下一次全量刷新才看到新色）。

---

## 7. 这份清单的时效性：以后改了哪里，要重跑哪几条

这份清单是「**2026-09-22 这份代码**上谁读了什么」的快照，不是不变量。下面按「改哪里 → 这份清单里哪几条作废、要重跑」列出来。

### 7.1 阶段 1 改了 KPI 与状态栏的口径（规格第 11 节第 1 条、第 7.3 节）

**会动的**：`ListTab.js:208-211` 与 `src/client/statusbar/checksums.js:14-16` 两处改读 `deck.counts`。那两处今天读的是

- `openIssuesOf(st)`（`store-derived.js:82`）→ 行上的 `state`
- `isOccupied(st, x)`（`store-derived.js:119`）→ 行上的 `assignees` 与 `blockedBy`
- `hasLabelOf` / `isTriageLike`（`store-derived.js:188-191`）→ 行上的 `labels[]`

**要重跑**：第 3.1 节里 `ListTab.js:208-211` 那两行、第 3.5 节整表。

**重跑之后很可能仍然成立的**：`state`、`assignees`、`blockedBy`、`labels[]` 在客户端还有别的读者 —— 状态筛选（`ListTab.js:174-175`）、行上被阻塞小标（`ListTabRow.js:36`）、按钮取色（`store-derived.js:217`）、变化探测（`probe-snapshot.js:120`）。所以这几条「必需」不会因为 KPI 改口径而消失，**但会有新的读者顶上**：`deck.counts` 这条路径本身要不要 `labels` 得看落地实现（规格说计数由后端 `counts` 给，标签筛要下推）。

### 7.2 阶段 1 让主列表过滤掉拉取请求（规格第 11 节第 1 条）

**会动的**：`store-derived.prIssuesOf`（`:305-324`）与 `ListTab` 的派生多一层 `isPullRequest !== true` 过滤。

**要重跑**：第 3.1 节的入口一行、第 3.4 节整表。`isPullRequest` 从「必需」变成「更必需」（两处都靠它分流），这条结论不会翻转。

### 7.3 阶段 2 加了 `listPage` 与页数据（规格第 7.2、第 18 节第 8 条）

这是**影响最大的一处**。规格第 7.2 节要求页数据单独存一份（按「后端 + 仓库键 + 视图 + 筛选」分桶、不塞回快照），并在 `store-derived.js` 里做工单口径统一。

**要重跑**：第 3 节整节（会多出一个「页数据」的新读者群）、第 4 节整表、第 6 节整节。

**具体要盯的三件事**：① 页数据那条路有没有补 `number`（6.3 第 1 条）；② 页数据的 `state` 是大写还是小写（6.3 第 2 条）；③ `ListTabRow.js` 会不会被复用去画页数据的行（复用就等于把第 6.1 节 A 组清单直接搬过去）。

### 7.4 阶段 2 改了 `IssueDetail` 的兜底（规格第 12 节「薄片段字段不够」这条风险）

**会动的**：`IssueDetail.js:36-37` 那个 `snapIssue` 查找，以及依赖它的 `:160`（`body`）、`:177`、`:182`（`comments`）、`:231`（`closedAt`）。

**要重跑**：第 5 节整节，第 4 节表里 `body` / `comments` / `closedAt` 三行，第 6.2 节「确定可以不带」那张清单（`body` 与 `comments` 到时候可能**才**变成能不带）。

**一句话**：在 `IssueDetail` 改成「兜底行没有正文/评论时显示加载态」之前，`body` 与 `comments` 都不能算没人读。

### 7.5 阶段 3 把 `MapDetail` 的子票换成薄片段（规格第 11 节第 12 条）

**会动的**：`MapDetail.js` 里读子票的每一处，以及子票上的 `progress`（今天由宿主解析正文得到，规格要求进度仍由宿主侧 `mapTicket`/`parseProgress` 算好再发）。

**要重跑**：第 3.2 节整表；第 3.10 节的 `progress` 一条（如果那时宿主把进度补到了子票行上，「读到但没有来源」这个毛病就消失了，`tProgressBar` 会开始显示真进度）。

### 7.6 宿主侧那三个补字段的动作改了（`sessionSnapshot.js:258-288` 与 `sessionRefresh.js:253-285`）

**会动的**：`number`、`claimedBy`、`level`、`blockedBy` 压平、地图 `stats` 这五项都由这两段代码补。谁改这两段，谁就同时改了客户端能读到什么。

**要重跑**：第 2.2 节、第 4 节表里 `number` / `claimedBy` / `level` 三行、第 6.3 节第 1 条。

### 7.7 `snapshot.issues` 不再等于「整个扁平票池」（改动 `sessionSnapshot.js:289` / `sessionRefresh.js:283` 的拼接口径）

**要重跑**：第 2.1 节、第 5.1 节第 1 条（兜底为什么今天能找到地图子票）。

**这一条特别要盯**：`IssueDetail.js:35-36` 只在 `snapshot.issues` 里找兜底。如果 `snapshot.issues` 变成「只装未挂图的票」，从地图详情点进子票时兜底就会失效 —— 那时候要么改 `IssueDetail` 的查找，要么保证 `issues` 仍然包含子票。

### 7.8 新后端上线（GitLab 补齐两条实现、或出现第三方后端）

**要重跑**：第 2.3 节（真机实测只覆盖 GitHub 这一份快照），以及第 3.10 节的 `progress` 一条（本地 Markdown 那条路会不会自己产出 `progress`，这一轮没测）。

### 7.9 检查页那张能力诊断卡挪走或删掉（`ChecksTab.js:217-235`）

**会动的**：`reason`、`milestone`、`customFields` 会从「名义上有读者」变成「零读者」。

**要重跑**：第 3.9 节、第 4 节表里这三行、第 6.2 节整张清单。

### 7.10 一个提醒

第 3.11 节那个没有调用点的 `TicketRow` 是**最会误导人的一条**：它读的字段与 `MapDetail` 高度重叠，谁照着它去统计「谁读了子票的哪些字段」，都会多算一整套。如果这个组件被重新接上渲染入口，第 3.2 节的清单要按它的读法再并一遍。

---

## 8. 没查到的 / 没有验证的

1. **GitLab 与本地 Markdown 两条后端在这件事上的现状，这一轮没有测。** 第 2.3 节的字段清单来自 2026-09-22 那一份 GitHub 工作区的磁盘快照。本地 Markdown 后端会不会自己产出 `progress`、`blocking`、或者不同形状的 `labels`（字符串数组那种老形状），没有核。
2. **`progress` 那一条我用的是「快照里没有 + 唯一的产出点没有调用点」两件证据，没有打真网验证地图详情页上的进度条今天画成什么样。** 我推断它画成 `—` 与 0%，但没有截图核实。
3. **`deck.blockedByKeys` 的读者我只在 `src/client` 目录里搜了。** 如果构建产物（`client.js`）或宿主侧另有读者，我这一条会不准。
4. **`t.author.kind`（bot / user）到底有没有被 `deck` 的认领判定用到，我没有逐行跟。** 我在 `src/client` 里没搜到读者，`deck-derive.js` 的 `claimedOf`（`:46-49`）只看 `assignees` 的长度。
5. **`snapshot.issues` 里那 9 行仍是对象形状的 `blockedBy` 是怎么来的，没有追。** 它们与压平逻辑（`sessionSnapshot.js:265-271` 只对地图子票做）的关系我没有核到底 —— 压平那一段只遍历 `maps[].tickets`，`issues` 里未挂图的票走的是 `:288` 那条只补 `number` 的路，所以对象形状留在独立票上说得通，但我没有实证到具体那一张票。
6. **本条最要紧的自知之明**：第 4 节那张表是「静态读代码 + 一份真机快照」得出的。它说得清「今天谁读」，说不清「未来谁要读」。规格第 7 节要加的那些新读者（页数据、`deck.counts`、`partial` 提示）落地之后，这张表必须按第 7 节重跑一遍。

---

## 附：本次核对用到的坐标与命令

**读过的客户端文件（共 14 个）**

`src/client/views/ListTab.js`、`src/client/views/ListTabRow.js`、`src/client/views/MapDetail.js`、`src/client/views/IssueDetail.js`、`src/client/views/IssueDetailComments.js`、`src/client/views/PrTab.js`、`src/client/views/TicketRow.js`、`src/client/views/ChecksTab.js`、`src/client/views/NoRepoCard.js`、`src/client/views/SkillsTab.js`、`src/client/views/shared/ticket.js`、`src/client/views/shared/stateKind.js`、`src/client/kernel/store-derived.js`、`src/client/kernel/link.js`、`src/client/kernel/probe-snapshot.js`、`src/client/kernel/probe-chain.js`、`src/client/kernel/api-io.js`、`src/client/kernel/store-prefs.js`、`src/client/views/labels/labelColorPatch.js`、`src/client/statusbar/checksums.js`、`src/client/panel/Dock.js`

**读过的宿主与契约文件**

`src/host/sessionSnapshot.js`、`src/host/sessionRefresh.js`、`src/host/index.js`、`src/host/mapBody.js`、`src/host/snapshotBuild.js`、`src/host/tracker/snapshot.js`、`src/host/tracker/backends/github/normalize.js`、`src/host/tracker/backends/github/queries.js`、`src/shared/tracker/shape.js`、`src/shared/tracker/constants.js`、`src/shared/tracker/deck-derive.js`、`src/shared/tracker/list-dedupe.js`

**怎么搜「谁读了池子」**

在 `src/client` 目录里按 `snapshot.issues` / `snap.issues` / `.issues` / `map.tickets` / `.tickets` 搜全文，命中的文件就是第 3 节列出的那些（外加 `src/client/kernel/probe-snapshot.js` 与 `probe-chain.js` 两处变化探测）。再按字段名逐个搜（`.body`、`.progress`、`.assignees`、`.claimedBy`、`.closedAt`、`.mergedAt`、`.subIssues`、`.comments`、`isPullRequest`、`mergedAt`、`assignees`、`parentKey`、`reviews`、`milestone`、`reason`、`.url`、`progressOf`）补漏。

**真机快照的实测方式**

读 `D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache\FeatherHunter__dsh-mattpocock-skills-deck.json`（2026-09-22 02:19:43，11,848,079 字节），用一段一次性的 Node 脚本做四件事：① 逐个字段统计 510 行 / 287 行里出现的行数；② 把每行按字段分别序列化后按 UTF-8 计字节求和，得到第 2.3 节那张体积表，并顺带量出 `snapshot` 每个顶层键的体积；③ 对比 `snapshot.issues` 里 40 个地图容器与 `snapshot.maps` 的 40 项是否逐字节相同；④ 抽查 `blockedBy`、`labels`、`author`、`assignees`、`reviews` 的形状分布。脚本写在系统临时目录里，没有落进仓库。

**这份底稿的边界**

只读代码、只读快照，没有改任何代码、没有建提交、没有切分支、没有动任何票（只在 #687 下留了一条评论）。第 4 节那张清单是事实陈述，不含「应该删哪个字段」的建议。
