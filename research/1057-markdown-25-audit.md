# Markdown 房对 25 条能力的逐条比对（2026-10-14）

这份文件回答一个问题：本地 Markdown 后端（下称「Markdown 房」）对契约层那 25 条能力，逐条比「契约承诺了什么」与「实现实际做了什么」，**在已知的 8 处之外**还有没有对不上的地方。

判定用的尺子只有一把：`src/tracker/contract/` 目录里写下的签名与注释。实现侧读的是 `src/tracker/rooms/markdown/`。全部结论来自静态阅读源码，每条带文件与行号；没能确认的写在最后一节「未核实」，不猜。本次没有改动任何源码、没有改动任何票据。

**关于行号**：全部行号按**当前工作区里的文件**计数。其中 `src/tracker/rooms/markdown/index.ts` 在工作区里带着一处未提交的改动（#1129：`matches` 里删掉了「扫 `.scratch` 逐个拼 `<名字>/map.md` 去试」的那一段），比已提交的版本少 3 行；读这个文件时按工作区版本读的，所以报告里的行号与工作区一致、与 HEAD 差 3 行，其余文件没有这个差别。本次调查没有改动任何源码。

先约定三个词（与 `research/1057-teacher-brief-round2.md` 第 7-12 行的口径一致）：

- **契约层**：`src/tracker/contract/`，它写下「一个后端最多能被要求做哪些事、每件事收什么回什么」，自己不含实现。
- **操作与定位口**：25 条能力 = 22 条操作（`src/tracker/contract/operations-catalog.ts:62`，异步、有失败分类、没实现的后端由注册表补「我不支持」的桩）＋ 3 条定位口（同文件 `:102`，问名字，没有「我不支持」这种答案）。
- **谎报**：契约 `src/tracker/contract/operations.ts:28-29` 的原话——后端可以实现一部分，「但**谎报**算（返回 ok 而其实没做成）」。

---

## ① 一句话结论

除已知的 8 处之外，本次新找到 **14 处**与契约承诺对不上的地方：其中 5 处是「做不到却回成功」的谎报（改票忽略 `milestone`、改票丢掉除 `Type` 以外的自定义字段、列票不按标签筛、列票不按拉取请求筛、建票丢掉指派人），1 处会把同一个幂等锚建出两张票（回查时列目录失败被当成「没找到」），2 处会在同一情形下把「读不到」当成「没有」而静默少数据（数票回 0、按页取票回空页），其余 6 处是回值语义、失败档位、排序键与登记数据上的偏差。25 条里判定为「符合」的 13 条、「不符合」的 12 条、「拿不准」的 0 条（有两处口径本身在契约里自相矛盾，单独记在「未核实」第 2 条）。

### 已知的 8 处（基线，不计入上面的 14 处）

1. 六处「收了 `opts` 不往下传」：`getDependencies` 丢 `DepsOpts.keys`、`close` 丢 `CloseOpts.reason`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy` 四条丢 `SetOpts.expectedUpdatedAt`。接线处是 `src/tracker/rooms/markdown/index.ts:206`、`:208`、`:212`、`:213`、`:214`、`:215`。
2. 写前版本校验（`expectedUpdatedAt`）在 Markdown 房零命中；GitHub 在四处认它：`src/tracker/rooms/github/labels.ts:134`（`setLabels`）、`src/tracker/rooms/github/issues-write.ts:415`（`setAssignees`）、`src/tracker/rooms/github/graph.ts:173`（`setParent`）、`src/tracker/rooms/github/graph.ts:428`（`setBlockedBy`）。
3. 写阻塞关系时只有自环检查（`src/tracker/rooms/markdown/issues-patch.ts:209` 的 `self-block`），没有全图环检；契约 `src/tracker/contract/operations.ts:186-189` 把「写完之后成环 → `conflict` 且不落盘」写成硬规矩，还补了一句「环检是写路径的一部分，不许省」。GitHub 有全图环检：`src/tracker/rooms/github/cycle-check.ts:55` 与 `:93`，用在 `src/tracker/rooms/github/graph.ts:379`。

另外两条已在上一轮确认、本次不再重复核：3 条定位口在 Markdown 的**实例**上一条都没有（成员集合见 `src/tracker/rooms/markdown/index.ts:37-46`），`describe`（`index.ts:93`）与 `issueAddress`（`index.ts:124`）只挂在模块对象 `markdownModule` 上；注册表只给 22 条操作补桩、不给 3 条定位口补桩（`src/tracker/registry/shape.ts:15` 导入的是 `OPERATIONS`，`:105` 只对 `OPERATIONS.includes(prop)` 补桩），所以实例上访问 `getRepoKey` 会拿到 `undefined`。

---

## ② 25 条逐条表

判定三档的含义：**符合** = 全部合法输入下都对得上契约承诺；**不符合** = 有些输入对不上；**拿不准** = 没能确认（本次没有一条落在这一档，两处口径自相矛盾的条款记在「未核实」）。表里的「新发现 N」指向第三节。

| # | 能力 | 判定 | 一句话依据（带文件与行号） |
| --- | --- | --- | --- |
| 1 | `preflight` | 符合 | `src/tracker/rooms/markdown/index.ts:152-197` 只查「这个工作区有没有票仓」这一件环境事实，失败经 `failAs` 给档位与原文（`:187`、`:195`）；契约要求只判环境、不预判能力（`src/tracker/contract/operations.ts:101-108`）。 |
| 2 | `list` | 不符合 | 过滤器只认 `type`/`state`/`parentKey`/`keys`（`src/tracker/rooms/markdown/issues-read.ts:160-169`），不认契约写明的 `labels` 与 `isPullRequest`（`src/tracker/contract/inputs.ts:38-42`、`:47-48`）。见新发现 4、5。 |
| 3 | `counts` | 不符合 | 列目录失败被当成空目录（`src/tracker/rooms/markdown/read.ts:19-27` → `issues-read.ts:96-106` → `counts.ts:85-116`），会回 `{open:0,closed:0,total:0}`，违反契约「拿不全就整体失败，不许猜一个数」（`src/tracker/contract/index.ts:271`）；另 `labels: []` 与省略同（`counts.ts:47-59`、`:63`），与 `inputs.ts:40` 的措辞对不上。见新发现 6（乙）。 |
| 4 | `listPage` | 不符合 | 同一处列目录失败会回空页（`src/tracker/rooms/markdown/page.ts:86-115`），违反契约「拿不全就整体失败，不许返回半页」（`src/tracker/contract/contract-page.ts:40`）；排序键实为文件修改时间（`page.ts:46-54` 配 `issues-locate.ts:181-183`），见新发现 6（丙）与 11。 |
| 5 | `get` | 不符合 | 全文不读 `opts.comments`（`src/tracker/rooms/markdown/issues-read.ts:176-204` 只读 `opts.effortId`），契约说「`opts.comments` 控制评论带几条」（`operations.ts:130`、`inputs.ts:51-55`）。见新发现 3。 |
| 6 | `getDependencies` | 不符合 | 已知 8 处之一：`index.ts:206` 没把 `opts` 往下传，`graph.ts:34-86` 也不接收。其余部分对得上契约（`blockedBy` 是真源、`blocking` 是便利视图，`operations.ts:133-142`）。 |
| 7 | `create` | 不符合 | 锚回查时列目录失败被当成「没找到」，照常建票（`issues-create.ts:150` 配 `read.ts:19-27`）；命中复用的票不看是否还开着（`issues-create.ts:147-161`、`:194-206`）；`input.assignees` 被丢（`issues-create.ts:106-139`）；回查失败的档位与话术不是 `unsupported`（`:268`）。见新发现 6（甲）、7、8、9。 |
| 8 | `close` | 不符合 | 已知 8 处之一：`index.ts:208` 丢掉 `CloseOpts.reason`；实现恒写 `Status: resolved`（`issues-status.ts:61-63`），回读时 `reason` 恒为 `completed`（`parse.ts:249-250`）。 |
| 9 | `reopen` | 符合 | `issues-status.ts:64-66` 写回 `Status: ready-for-agent`；契约 `operations.ts:150-151` 对这条没有别的承诺。 |
| 10 | `comment` | 符合 | `comments.ts:63-64` 返回新建的那条评论本身（不是整张票），与 `operations.ts:153` 一致。 |
| 11 | `update` | 不符合 | `patch.milestone` 一处分支都没有、`patch.customFields` 只认 `Type`（`issues-patch.ts:133-197`，其中 `:167-173` 是自定义字段那段），两者都回 `ok`。见新发现 1、2。 |
| 12 | `setLabels` | 不符合 | 已知 8 处之一：`index.ts:212` 丢掉 `SetOpts.expectedUpdatedAt`；覆盖式改写本身对（`issues-patch.ts:354-369`），与 `operations.ts:159` 一致。 |
| 13 | `setAssignees` | 不符合 | 已知 8 处之一（`index.ts:213` 丢 `opts`）之外，还有登录名丢失：只按「给没给」写 `claimed`/`ready-for-agent`（`issues-patch.ts:222-236`），回读把认领人写成 `@me`（`parse.ts:241-248`；票面连 `Status` 行都没有时整个 `assignees` 字段省略，表示「认领状态未知」）。见新发现 10。 |
| 14 | `setParent` | 不符合 | 已知 8 处之一：`index.ts:214` 丢 `opts`。改父本身对（`issues-patch.ts:267-353`）；跨 effort 改父与「给地图找父」如实回 `unsupported`（`:272-285`、`:346-352`），按 `operations.ts:28-29` 不算谎报。 |
| 15 | `setBlockedBy` | 不符合 | 已知 8 处之一：`index.ts:215` 丢 `opts`；另有 `issues-patch.ts:209` 只有自环检查，没有 `operations.ts:186-189` 明说「不许省」的全图环检。 |
| 16 | `getCurrentUser` | 符合 | `index.ts:225` 回 `unsupported`；契约 `operations.ts:199-204` 明说本地 Markdown 回 `unsupported` 是正常答案。 |
| 17 | `initProject` | 符合 | `index.ts:226` 回 `unsupported`；契约 `operations.ts:206-214` 指定本地后端回 `unsupported`。 |
| 18 | `listLabels` | 符合 | `src/tracker/rooms/markdown/label-colors-ops.ts:144-186`：并集＝内置 ∪ 票面 ∪ 配色文件；票面有一张读不出来就整体失败（`:74-92`），配色文件读不出来也整体失败（`:145-150`），两句都带「未能获取全部标签」；契约见 `contract-label-colors.ts:58-79`。 |
| 19 | `setLabelColors` | 符合 | `label-colors-ops.ts:202-261`：形状不合整批 `parse`（`:203-205`）、读不出来一律不写（`:207-208`）、只读文件拒写（`:211-214`）、颜色不合法落该条 `parse`（`:224-228`）、标签不在文件里落该条 `not-found` 且不新增（`:229-236`）、写失败整条失败不留半截账（`:251-258`）；契约见 `contract-label-colors.ts:81-111`。 |
| 20 | `getRepoPermissions` | 符合 | `index.ts:228` 回 `unsupported`；契约 `operations.ts:234-241` 明说这是合规答案（本地没有「仓库权限」这回事）。 |
| 21 | `listSubIssues` | 符合 | `index.ts:230` 回 `unsupported`；契约 `operations.ts:243-259` 指定本地与 GitLab 回 `unsupported`。 |
| 22 | `ensureLabelColorsFile` | 符合 | `label-colors.ts:268-300`：文件在就一个字不改（`:276-290`）、读不出来不动它（`:271-275`）、只有老 `.json` 会被迁进新 `.yaml`（`:278-289`，`results.ts:190-193` 认「迁移」这个结果）。只有 `from` 的取值与 `results.ts:193-194` 那句话对不上，见新发现 13（可忽略）。 |
| 23 | `getRepoKey` | 符合 | 契约明说本地没有这条（`operations.ts:284-289`），实例上确实没有（`index.ts:37-46` 把定位口排除在实例形状外）。登记表那一行的说法与实际不符，见新发现 14。 |
| 24 | `describe` | 符合 | `index.ts:93-102` 回 `{backend,refId,name,url}`，契约 `operations.ts:291-295`；挂模块对象上，登记表 `capability-register.ts:52` 记为 `provided`。按契约签名省略第二个参数会拿到形状不合的回值，见新发现 12（今天不可达）。 |
| 25 | `issueAddress` | 符合 | `index.ts:124-127` 恒回空串；契约 `operations.ts:297-298` 与 `operations-catalog.ts:97-98` 明说本地算不出票文件名、回空串是答案（#1144）。 |

---

## ③ 新发现逐条展开

严重程度分四档：**高**（会悄悄写坏数据或让人拿到完全错误的结论）、**中**（会让人拿到错答案，或该失败的没失败）、**中低**（回值语义偏了，一般不会立刻出错）、**低**（口径或话术上的偏差）。

### 新发现 1：`update` 静默忽略 `patch.milestone`（严重程度：中）

**契约怎么承诺的**：`src/tracker/contract/inputs.ts:105-114` 的 `UpdatePatch` 有四个字段——`title`、`body`、`milestone`（`Milestone | null`）、`customFields`，注释写明这是「多字段一次原子写」。`src/tracker/contract/operations.ts:156-157` 只补了一句「空补丁不该发请求」，没有任何一句把 `milestone` 排除在外。同一份契约 `operations.ts:28-29` 把「返回 ok 而其实没做成」定成违约（谎报）。

**实现实际怎么做的**：`src/tracker/rooms/markdown/issues-patch.ts:133-197` 是 `update` 的全部实现。`:143-166` 处理 `title` 与 `body`，`:167-173` 处理 `customFields`，`:174-183` 处理一个契约里根本没有的 `patch.labels`；**`patch.milestone` 一处分支都没有**——传进来就当没传，函数照样返回 `{ok:true,data:票}`。全房检索 `milestone` 只有一处命中：`src/tracker/rooms/markdown/normalize.ts:6`（`if('milestone' in issue)delete issue.milestone`），而据 `src/tracker/contract/README.md:69-72` 的记载，`normalize.ts` 今天已不在实例上。

**差在哪**：调用方传 `{milestone: {...}}` 时，票面不会有任何变化，回值却是成功。想知道「有没有改」的调用方从回值里看不出来（回读出来的票本来就不带 `milestone` 字段，`parse.ts` 不产出它）。

**对照两个成熟做法**：GitHub 收到 `patch.milestone` 或 `patch.customFields` 直接回 `unsupported`（`src/tracker/rooms/github/issues-write.ts:326-335`）；GitLab 真支持 `milestone`、对 `customFields` 回 `unsupported`（`src/tracker/rooms/gitlab/issues.ts:369-385`）。也就是说「本地存不下就说做不到」在这个仓库里有现成的先例，Markdown 房选了第三条路——不说，也不做。

### 新发现 2：`update` 的 `customFields` 只认 `Type`，其余名字静默丢弃（严重程度：中低）

**契约怎么承诺的**：`inputs.ts:113` 的 `customFields?: CustomField[]`，形状是通用的 `{name, value, type, options?}`（`src/tracker/contract/entities.ts:67-74`），不限于某一个名字。

**实现实际怎么做的**：`issues-patch.ts:167-173` 遍历 `patch.customFields`，只处理 `cf.name === 'Type'` 的那一项（写一行 `Type: …`），其余名字的项既不写票面也不进回值里的失败。回读侧同样只有一项：`parse.ts:113-117` 无论票面有多少自定义字段，只产出 `Type` 一项（`customFields = [{name:'Type', value: typeRaw, ...}]`）。

**差在哪**：传 `customFields: [{name:'优先级', value:'高'}]` 会拿到 `ok` 与一张没变的票。契约没有给 Markdown 房「只支持 Type」这个口子，GitHub 面对 `customFields` 是整体回 `unsupported`（`issues-write.ts:326-335`）。

### 新发现 3：`get` 完全不用 `opts.comments`（严重程度：中低）

**契约怎么承诺的**：`operations.ts:130`「读一张票；`opts.comments` 控制评论带几条」；`inputs.ts:51-55` 的 `GetOpts.comments = { first: number; after?: string }`，注释是「评论分页：要前几条、从哪个游标之后开始」。

**实现实际怎么做的**：`issues-read.ts:176-204` 是 `get` 的全部实现，只从 `opts` 里读 `effortId`（`:181` 的 `scopeOf(repo,opts)`），**从不读 `opts.comments`**；全房检索 `opts.comments` 与 `comments?.` 零命中。评论由 `parse.ts:152-191` 整段解析后原样跟着票返回。

**差在哪**：契约的 `first` 是「带几条」的硬承诺，`after` 是「从哪个游标之后开始」；今天要 5 条的调用方会拿到全部评论，`after` 一点都没实现。GitHub 按 `first` 截断（`src/tracker/rooms/github/issues.ts:370-371` 与 `:419-420` 的 `slice(0,first)`），所以这不是契约没想清楚，是 Markdown 房没做。

### 新发现 4：`list` 不按 `filter.labels` 筛（严重程度：中）

**契约怎么承诺的**：`inputs.ts:38-41`「只要带这些标签的票（两个后端的计数实现都真按它筛，仓库里的契约原文也写了这一项）。空数组与省略不同：省略是不过滤，空数组是「一个标签都不带」。」`operations.ts:110-111` 说 `list` 的口径「见 `ListFilter` 各字段注释」——也就是说这份注释就是 `list` 的义务。

**实现实际怎么做的**：`issues-read.ts:160-169` 只有四个分支：`type`、`state`、`parentKey`、`keys`，**没有 `labels` 分支**。`counts.ts:19-21` 的顶部注释自己承认了这件事：「本后端的 list 今天不认标签筛（既有缺口，不在本票范围内）」。

**差在哪**：按标签筛的调用方会拿到未筛的全部票（只会多、不会少），这是错答案而不是缺功能。更麻烦的是同一个后端里两条操作口径不一致：`counts`（`counts.ts:105`）与 `listPage`（`page.ts:101`）都真按标签筛，于是一句「数出来 3 张、列出来 12 张」是完全可能的。

### 新发现 5：`list` 不认 `filter.isPullRequest`（严重程度：中低）

**契约怎么承诺的**：`inputs.ts:47-48`「只要拉取请求（界面上的拉取请求过滤器用）。」

**实现实际怎么做的**：同上那段过滤代码（`issues-read.ts:160-169`）没有这个分支；全房检索 `isPullRequest`，唯一命中是 `counts.ts:16` 的注释（说的是「忽略它」）。Markdown 的票行也从不产出 `isPullRequest` 字段（`parse.ts` 不设它）。

**差在哪**：本地后端没有拉取请求这个概念，所以 `isPullRequest: true` 的正确答案是空表；今天的实现返回全部票。`isPullRequest: false` 返回全部票是对的（碰巧）。调用方若真按这个过滤器画界面，会把整个票池标成拉取请求。要不要立刻改，取决于面板会不会在 Markdown 工作区上调它——这一条见「未核实」第 3 条。

### 新发现 6：列目录失败被静默当成「空目录」，四处受同一个根因影响（严重程度：高）

**根因**：`src/tracker/rooms/markdown/read.ts:19-27` 的 `readDir` 把三路列目录（`resolve`+`listDir`、`readdir`、`listDir`）的异常全部 `catch{return[]}`，取不到文件服务时也回空表（`:20`）。于是「这个目录读不出来」与「这个目录里没有文件」在下游是同一个值。同一份辅助件在别处是另一套口径的对照：`issues-locate.ts:56-57` 的 `listEfforts` 也把列目录失败吞成空表。

契约把「读不出来」与「没有」分得很清，而且点名了「目录读不出来」这一档：

- `src/tracker/contract/contract-idempotency.ts:35-37`：回查拿不准（搜索接口报错、列表翻不完、**目录读不出来**）必须如实失败、绝不建票，`error.kind` 是 `unsupported`，message 说清是「回查没能做成」。
- `src/tracker/contract/index.ts:271`：计数「拿不全就整体失败，不许猜一个数出来」。
- `src/tracker/contract/contract-page.ts:40`：按页取票「拿不全就整体失败，不许返回半页——界面上半页与一页长得一模一样，用户只会以为『历史就到这儿了』」。

四个受影响的地方：

**（甲）`create` 的幂等回查：同一个锚会静默建出第二张票。严重程度：高。**

`issues-create.ts:147-161` 的 `findAnchoredTicket` 第一件事是 `readDir(ctx,idir)`（`:150`）。目录读不出来时它拿到空表，循环一次都不进，函数返回 `null`；调用方 `createIssue` 把 `null` 读作「还没建过」（`:143` 的注释原话），于是照常取号、落盘、回 `ok`（`:208-245`）。`issues-create.ts:144-145` 的注释写着「有文件读不出来（被占用、权限、目录读不出来）：抛错，由调用方转成 `unsupported` 如实失败」——这句话对**单份票文件**读失败成立（`readTextFile` 会抛，见 `read.ts:12-18`），对**列目录**失败不成立，因为 `readDir` 根本不抛。这正是幂等锚被发明出来要防的那件事（重复建票），而且是在「看起来成功了」的外表下发生的（契约 `contract-idempotency.ts:35-36` 自己点了这个风险）。

**（乙）`counts`：读不到目录时回 `{open:0,closed:0,total:0}` 而不是失败。严重程度：中高。**

`enumerateIssueRows`（`issues-read.ts:55-131`）用 `readDir` 列票目录（`:97` 的 `collectTicketsIn`），它的错误收集只覆盖**单份文件**读不动（`:90-94` 的 `pushTicketRow` → `noteReadError`），列目录失败没有任何错误可记。`countIssues`（`counts.ts:85-116`）于是拿到 0 行、`errors` 为空，回三个 0。契约 `index.ts:271` 明说这算「猜一个数」。面板顶部那几个数字本来就因为「票池被悄悄截断」而偏过，这一档是同一个病的另一个入口。

**（丙）`listPage`：同一情形回 `{items:[],nextCursor:null,total:0}` 而不是失败。严重程度：中高。**

`page.ts:86-115` 与 `counts` 同口径（`:90` 开 `collectErrors:true`，`:91-97` 有错就整体失败），但错误同样只来自单文件读取；目录列不出来时它给出一页「空且没有下一页」，正好踩在 `contract-page.ts:40` 那句「用户只会以为历史就到这儿了」上。

**（丁）`list`：同一情形回空表。严重程度：低。**

`issues-read.ts:133-173` 本来就故意吞掉单份文件读不动的错误（`:136` 的注释与 `:48` 的说明），列目录失败在它这里连「吞」都算不上。契约没有像 `counts`、`listPage` 那样为 `list` 明写「拿不全必须整体失败」，所以这一条只作说明，不计入新的不符合。

### 新发现 7：`create` 的锚命中不检查那张票是否还开着（严重程度：中）

**契约怎么承诺的**：`contract-idempotency.ts:38-39`「命中复用的那张票必须**还开着**：已关闭的票不算命中（一个锚对应一件要做完的事，它已经做完了还拿旧 key 回来时，调用方要的是这次新建）」。这条判据在共享代码里只有一处：`src/shared/refresh/src/idempotency.ts:184-204` 的 `matchAnchor`，其中 `:200` 原话是 `if (c.state === 'closed') { mismatches.push('候选 ' + String(c.key) + ' 已经关闭了，不算命中（该建一张新的）'); continue }`。

**实现实际怎么做的**：`issues-create.ts:147-161` 的 `findAnchoredTicket` 只做一件事——把每份 `.md` 读出来、用 `idempotencyKeyOf` 比锚（`:157`），比中就返回，**完全不看 `state`**；`:194-206` 拿到命中就复用（`reused:true`），不写盘、不报错。全仓检索 `matchAnchor` 的用法只有三处：`src/tracker/rooms/github/idempotency.ts:27`（`:151`、`:177`、`:198` 调用）、`src/tracker/rooms/gitlab/idempotency.ts:22`（`:152`、`:173`、`:206` 调用）、`src/deck/tools/map-plan-create.ts:19`；**Markdown 房一处都没用**（`issues-create.ts:20` 只导入了 `anchorLineFor`、`checkIdempotencyKey`、`idempotencyKeyOf`）。共享判据里那两条规矩——「已关闭不算命中」与「拿不准按 `unsupported`」——因此在 Markdown 房都没生效。

**差在哪**：票关掉之后拿同一个锚再提交，调用方拿到的是那张已经关掉的旧票，而不是契约答应的「这次新建」。调用方如果按「返回的票应当是这次要做的那件事」往下走，就会拿到一张已经做完的票。

### 新发现 8：`create` 回查失败时的失败档位与话术不是 `unsupported`（严重程度：低）

**契约怎么承诺的**：`contract-idempotency.ts:35-37` 要求这一档的 `error.kind` 是 `unsupported`、message 说清是「回查没能做成」而不是「已经建过」。

**实现实际怎么做的**：单份票文件读不出来时，`findAnchoredTicket` 里的 `readTextFile` 抛出（`read.ts:12-18` 会抛），冒到 `issues-create.ts:268` 的 `catch`，走 `failFromError(e, ctx, '建这张票时出错')`。`failFromError`（`src/tracker/rooms/markdown/error-fail.ts:76-80`）按通用规则表判档（`kindFromError` → `verdictOf`），不会强制成 `unsupported`，message 也是「建这张票时出错」。`:144-145` 的注释声称「由调用方转成 `unsupported` 如实失败」，代码里没有这一转。

**差在哪**：不建票这一点做对了（没有重复建票），但调用方按 `kind` 分不清「这个后端不支持锚」还是「这次读盘出了问题」，message 也指不到「回查」这一步。共享代码里为这件事准备了现成的话术（`idempotency.ts:155` 的 `anchorUnsupported`、`:217-220` 的 `describeAnchorFailure`），Markdown 房没用。

### 新发现 9：`create` 静默丢弃 `input.assignees`（严重程度：中低）

**契约怎么承诺的**：`inputs.ts:63-71` 的 `CreateInput` 里 `assignees?: AssigneeInput[]` 是承诺过的字段；`operations.ts:144-145` 只说这一条是建票（可带幂等锚），没有把指派人排除。

**实现实际怎么做的**：拼票面正文的 `buildIssueText`（`issues-create.ts:106-139`）只写标题、正文、`Status`（默认 `ready-for-agent`）、`Type`、`Blocked by`、`Labels`、骨架与父注释，**不读 `input.assignees`**。全房检索 `assignees` 的命中只有三处：`issues-patch.ts:222-236`（`setAssignees` 自己）、`parse.ts:241-248`（回读映射）、`index.ts:213`（接线）。于是新建出来的票 `assignees` 回 `[]`（`parse.ts:241-248`：`Status` 不是 `claimed` 就给 `[]`）。

**差在哪**：带认领人建票的调用方拿到一张没人认领的票，且回值说成功。GitHub 真把 `assignees` 下推（`src/tracker/rooms/github/issues-write.ts:177-178`）。

### 新发现 10：`setAssignees` 不存登录名，回读用 `@me` 占位（严重程度：中低）

**契约怎么承诺的**：`operations.ts:168-169`「覆盖式改指派人（认领）」；`inputs.ts:131-134` 的 `AssigneeInput` 可以只给登录名（`'octocat'`），也可以给完整形状；`entities.ts:138-139` 说明 `assignees` 为 `[]` 表示「明确没人认领」。

**实现实际怎么做的**：`issues-patch.ts:222-236` 只看「给没给」——`:227` 的 `hasAssignee = Array.isArray(assignees) && assignees.length > 0`，`:228` 据此写 `Status: claimed` 或 `Status: ready-for-agent`；**任何登录名都不落盘**。回读时 `parse.ts:241-248` 把 `claimed` 映射成 `[{login:'@me',kind:'user'}]`，其余状态映射成 `[]`；票面连 `Status` 行都没有时这一段根本不执行，`assignees` 整个字段省略，表示「认领状态未知」（`src/tracker/contract/entities.ts:138-139` 对这两种写法的区别有专门说明）。

**差在哪**：`setAssignees(repo,'01',['octocat'])` 之后，返回的票里写的认领人是 `@me`——既不是调用方给的那个名字，也不是本地用户名（`src/tracker/contract/identity.ts:87-96` 对 `login` 的说法是「本地 Markdown 是本地用户名或 `''`」）。界面若用它显示「谁在办」，显示的是一个占位值。「认领／取消认领」这一层是对的，所以这条不是纯错，而是契约与本地存储之间没有对齐的地方。

**这是有来历的本地约定，不是随手写的**：`docs/architecture/markdown-backend-proposal-141.md:34` 与 `:48` 明确记着「`Status:claimed→[{login:'@me'}]` 或 `[]`」与「`setAssignees: claimed→Status: claimed / unclaim→Status: ready-for-agent`」；`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md:26-29` 也是这么描述本地后端的（认领＝设 `Status: claimed`）。所以要么改契约给本地后端留一个口子，要么改实现与这两份文档。

### 新发现 11：`listPage` 的排序键是文件修改时间，不是创建时间（严重程度：中低）

**契约怎么承诺的**：`operations.ts:119-122`「排序键固定『创建时间倒序』；游标不透明」；`contract-page.ts:19-22` 把理由写得很清楚——「翻页期间若有别的票被更新，按更新时间排序会让票在页与页之间挪位置，早先看过的那一页会漏掉一张；创建时间是写下来就不动的，翻到哪一页都稳定」。

**实现实际怎么做的**：`page.ts:46-54` 的 `byCreatedAtDesc` 比的是行上的 `createdAt` 字符串，而本地 Markdown 的 `createdAt` 来自**票文件的修改时间**：`issues-locate.ts:181-183`（`loadIssueFromFile` 取 `mtime||mtimeMs||ctime`）、`issues-create.ts:251-256`（新建路径同款）、`issues-read.ts:79-85`（地图行同款）；`page.ts:10-13` 的注释自己承认了这件事（「本后端的 createdAt 来自票文件的修改时间（parse 取的 mtime）」）。

**差在哪**：文件一被改写（关票、加评论、改标签都会重写文件），「创建时间」就跟着变，于是排序键实际是「最近修改时间倒序」。契约选创建时间的唯一理由就是翻页稳定，而这条性质在「翻页期间有人改票」这个正是它要防的场景下不成立——改过的那张旧票会跳到第一页，用户已经翻过的那一页会漏行。同一根因还让票的 `createdAt`／`updatedAt` 两个字段在每次写入之后失真（`entities.ts:126-135` 对这两个字段的说法是「创建时间／最后更新时间」）。要真修，得先给票文件本身写一个创建时间戳；本地盘上今天确实没有这个信息，所以这不是一句 `sort` 改得掉的。

### 新发现 12：`describe` 的第二个参数没有默认值，而契约把它标成可选（严重程度：低，今天不可达）

**契约怎么承诺的**：`operations.ts:291-295` 的签名是 `describe(handle: RepoHandle, backendId?: BackendId): RepositoryRef`，注释说「第二个参数是后端 id；实例自己知道身份，可以忽略它，故标可选参数」。

**实现实际怎么做的**：`index.ts:93` 的形参是必填的 `backendId: string`，`:99` 直接把它放进 `backend`（`{backend:backendId, ...}`），`:97` 的空路径也拿它当 `name` 兜底。按契约签名只传一个参数调用，会拿到 `{backend: undefined, refId: '', name: undefined, url: ''}` 这种形状不合的仓库身份。

**为什么说今天不可达**：仓库内的调用者都走注册表，注册表恒传后端 id（`src/tracker/registry/views.ts:31`、`:40`），并在 `:43` 兜了一层 `r.backend || backendId`；宿主那些 `reg.describe({cwd: …})` 的调用（例如 `src/host/refresh/wiring.js:224`）也由注册表补上 id。只有绕过注册表、直接按契约签名调模块对象上的 `describe` 才会踩到。列出来是因为契约层的「可选」在实现里没有对应的容错。

### 新发现 13：`ensureLabelColorsFile` 的 `from` 与契约那句注释对不上（严重程度：低）

**契约怎么承诺的**：`src/tracker/contract/results.ts:187-194` 说 `placed: true` 表示这次真新建或迁移，`from` 记「它原先是什么格式」，并且「**只在『文件本来就在』时有值**」。

**实现实际怎么做的**：`label-colors.ts:292-298`（确实没有文件、这次新建那支）回 `{ok:true, placed:true, reason:'created', from:'yaml'}`——本来没有文件却给了 `from`；`:278-289`（只有老 `.json`、这次迁移那支）回 `{ok:true, placed:true, reason:'migrated', from:'yaml'}`——原先其实是 `json`。

**差在哪**：调用方按 `placed` 判断时完全不受影响（`results.ts:193-194` 也说了「拿 `placed` 做判断即可」），所以这条只有人读日志时才会被绊一下。列出来是因为它确实与那一句注释不符。

### 新发现 14：登记表把 `getRepoKey` 记成「注册表补桩」，与实际不符（严重程度：低）

**三处口径**：契约说定位口「**没有『我不支持』这种答案**」，缺席就是缺席（`src/tracker/contract/operations-catalog.ts:17-20`、`operations.ts:279-281`、`README.md:57`）；注册表也确实不给定位口补桩（`src/tracker/registry/shape.ts:8` 的说明、`:15` 只导入 `OPERATIONS`、`:105` 只对 `OPERATIONS.includes(prop)` 补桩）；而 `src/tracker/contract/capability-answer.ts:63-66` 对 `stubBy: 'registry'` 的定义是「实例上根本没有这个成员，注册表按名录补桩」。

`src/tracker/rooms/markdown/capability-register.ts:51` 写的是 `getRepoKey: { kind: 'unsupported', stubBy: 'registry' }`。这一行与实际行为矛盾：今天既没有「我不支持」这个答案，也没有任何一处补桩，调用方直接访问实例成员拿到的是 `undefined`（就是基线里那一条）。同一个仓库里 GitLab 的登记写的是另一类（`src/tracker/rooms/gitlab/capability-register.ts:50` 的 `{kind:'planned', ticket:'1062'}`）。

**差在哪**：纯登记数据口径，不影响运行时行为；会影响的是拿这张表做诊断或生成文档的人——他会以为实例上有一个会回「我不支持」的 `getRepoKey`。

---

## ④ 未核实清单

下面每一条都是我**没有确认**的，写清卡在哪里，不猜结论。

1. **`list` 的「薄行」到底允许带什么**。`operations.ts:110` 的括注是「薄行，不带正文评论之外的展开」，我读成「不带『正文与评论之外』的展开」，也就是允许带正文与评论；`listPage` 那边的措辞是明确不许（`contract-page.ts:32-34`「**不带正文、不带评论**」）。Markdown 的 `list` 返回完整正文与评论（`issues-read.ts:91-93` 的 `pushTicketRow` 调 `loadIssueFromFile`，最终经 `parseMd` 产出整张票，读文件那一步见 `issues-locate.ts:174-194`），GitHub 的 `list` 也带（`src/tracker/rooms/github/queries.ts:17-33` 的 `ISSUE_FRAGMENT` 里就有 `body` 与 `comments`，`:36-43` 的 `LIST_QUERY` 直接复用它）。若作者本意是「`list` 也不带正文与评论」，这一条要改判为不符合。
2. **`labels: []` 的语义，契约里有两处相反的说法**。`inputs.ts:40` 说「空数组是『一个标签都不带』」；`index.ts:270` 的计数口径说 `labels` 是「必须同时带上这些标签的票」，空集在逻辑上是真空成立（＝不过滤）。Markdown 的实现走的是后一种（`counts.ts:47-59` 的 `labelsOf` 把非数组与空数组都归成 `[]`，`:63` 的 `hasAllLabels` 对空需求恒真；`page.ts:98-101` 同款），GitHub 的计数也不区分（`src/tracker/rooms/github/queries.ts:55-56` 的注释自认「空数组是『不筛』还是『全都要有』，没有把握」，分页那一版在 `:101` 写着同一句话），契约测试里也没有断言这一条（我查了 `tests/tracker-contract/sections/counts.js`）。两处口径作者的本意是哪一处，我确认不了，所以没有把它单独判成「不符合」。
3. **面板会不会在 Markdown 工作区上调 `isPullRequest` 过滤器**。如果界面按「票行里有没有 `isPullRequest` 字段」来隐藏这个过滤器，新发现 5 就只是纸面不符，没有用户可见的后果。消费这个过滤器的客户端与宿主代码我没有核。
4. **`listPage` 的 `filter` 是不是「只认 `state` 与 `labels`」**。`page.ts:84` 的注释这么写，依据是 `contract-page.ts:27`「`total` 是同一口径下的总数（口径与 `counts` 那条操作一致）」；但契约没有像 `index.ts:268` 那样为分页逐字列出「只认两项，其余忽略」。我按 Markdown 的读法（＝只认两项）处理，没有把它算成不符合；这一点未经作者确认。
5. **`setLabelColors` 一批里出现同名标签该怎么算**。今天的实现整批按 `parse` 失败（`label-colors-ops.ts:45-56` 的 `shapeProblem`）。契约只要求「入参每一条必须恰好出现在 `applied` 或 `failed` 之一」（`contract-label-colors.ts:45`），没说同名重复算哪种，我没有判它不符合。
6. **契约测试今天怎么覆盖上述情形**。我只看过 `tests/tracker-contract/sections/counts.js` 与 `sections/listPage.js:247-248` 里与 `labels` 有关的两处，其余用例、以及测试里有没有把今天的行为当成期望值，都没有逐个核（也没有跑测试）。
7. **`describe` 省略第二个参数这条路的可达性**。新发现 12 说「今天不可达」，依据是仓库内的调用点都经注册表（`registry/views.ts:40`）或由注册表补 id（`src/host/refresh/wiring.js:224`）。仓库外（例如别的插件）会不会按契约签名直接调模块对象的 `describe`，我没有核。
8. **`@me` 在界面上最终显示成什么**（新发现 10 的用户可见后果）。客户端渲染认领人那一层我没有读。
9. **`from` 字段在别的后端怎么填**（新发现 13）。GitHub 对 `ensureLabelColorsFile` 回 `unsupported`，GitLab 由注册表补桩，所以没有现成的第二家可以对照。
10. **本报告全部结论都是静态阅读代码与契约得出的，没有实跑复现。** 最值得实跑验证的是新发现 6 的三条（把 `issues/` 目录的权限改掉、或用文件服务注入一次列目录失败，看 `create`、`counts`、`listPage` 各自回什么）与新发现 1、2（给 `update` 传 `milestone`、传一个非 `Type` 的自定义字段，看是不是回 `ok` 而票面没变）。这两组一跑就能把「读出来的结论」变成「看得到的现象」。
