# 契约操作到底几条：19 还是 25，以及这对 GitLab 房三张票意味着什么

> 这是一次只读调研的记录。核对时间是二零二六年十月十四日，工作区 HEAD 是提交 `60e91738`（「把证据范围做成判定的入参，并给两条直调点补上日志出口（#1048 收口补做）」，2026-10-14 18:12:47 +0800）。
> 每一条结论都写了文件路径与行号。没有亲手读到的东西一律写「未核实」，不猜。
> 本次没有改动任何源码，也没有做任何决定。

## 零、先回答那个问题：不是「19 变成 25」，准确说法是「19 条操作变成 22 条操作，另加一段 3 条定位口」

「19 个操作变成 25 个操作」这句话不准确。今天契约里的能力上限是 **25 条，但它分成两段**：**22 条操作**加**3 条定位口**（`src/tracker/contract/operations-catalog.ts:62-87` 的 `OPERATIONS` 是 22 个名字，`:102-106` 的 `LOCATORS` 是 3 个名字，`:114` 的 `CAPABILITIES` 把两段拼成 25）。

所以完整的变化是三步，不是一个数字的替换：

1. **老操作 19 条，一条没少，原样留着。**
2. **净增 3 条操作**（`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile`），19 加 3 等于 22。
3. **新建了一段「定位口」，3 条**（`getRepoKey`、`describe`、`issueAddress`），老契约没有这一段。

19 条老操作一条都没被摘掉，这一点我是拿提交对照出来的：在改变契约的那笔提交的父提交上，`src/tracker/contract/operations-catalog.ts` 的 `OPERATIONS` 数组正好是 19 个名字（`preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`），命令是 `git show c8d7ef0a^:src/tracker/contract/operations-catalog.ts`；今天这 19 个名字仍旧在 `src/tracker/contract/operations-catalog.ts:63-81` 里，一个不缺。

**改这件事的是哪一笔提交、哪一张票。** 提交 `c8d7ef0a`（2026-10-14 14:33:51 +0800），标题「把 Tracker 能力上限落到 25 条：契约收编后端独有方法并补齐注册表桩」，提交正文自己写明「契约层定义 25 条能力上限（22 条操作加 3 条定位口）……关联 #1051」，改动面 18 个文件、455 行新增、257 行删除。成文决议是 `docs/adr/20261014-tracker-capability-ceiling.md`（标题「ADR：Tracker 能力上限（25 条）」，状态已定版），它的 `:5` 写「讨论见 #1051」，`:11` 写「以前契约只管 19 条操作」，`:17-20` 写「全部 25 条能力都写在契约层：操作 22 条……定位口 3 条」。

---

## 一、契约当前操作清单（逐个，带签名与中文注释）

真源是 `src/tracker/contract/operations-catalog.ts` 的两个 `as const` 数组；接口签名与注释在 `src/tracker/contract/operations.ts` 的 `Tracker` 接口里。

### 1.1 操作 22 条（`operations-catalog.ts:62-87`）

名单按名录里的原顺序抄（名录 `:59-60` 的注释把顺序定成规矩：「顺序就是上层读到的顺序，也是门禁与金标准逐个核对的顺序；加名字往末尾追加，不要把已有名字挪位置」）。签名与注释抄自 `operations.ts` 的 `Tracker` 接口，行号即出处。

| # | 操作名 | 签名（`src/tracker/contract/operations.ts`） | 中文注释（同文件，原样摘） |
| --- | --- | --- | --- |
| 1 | `preflight` | `preflight(handle: RepoHandle, ctx: OpContext): Promise<PreflightResult>`（`:108`） | 「环境预检：这台机器上这条路现在通不通。只判环境（工具在不在、登录没有、连不连得上、文件系统能不能碰），**不预判能力**（「能不能建票」不在这里回答，那是 create 自己的事）。返回 `PreflightResult` 而不是 `OpResult`：预检回答的是通不通这一件事，包一层 ok/data 会长出「ok 但环境不 ok」这种自相矛盾的形状。」（`:101-107`） |
| 2 | `list` | `list(repo: RepositoryRef, filter: ListFilter \| undefined, ctx: OpContext): Promise<OpResult<Issue[]>>`（`:111`） | 「列票（薄行，不带正文评论之外的展开；详细口径见 `ListFilter` 各字段注释）。」（`:110`） |
| 3 | `get` | `get(repo: RepositoryRef, key: string, opts: GetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:131`） | 「读一张票；`opts.comments` 控制评论带几条。」（`:130`） |
| 4 | `getDependencies` | `getDependencies(repo: RepositoryRef, key: string, opts: DepsOpts \| undefined, ctx: OpContext): Promise<OpResult<Dependencies>>`（`:137-142`） | 「取依赖关系：谁阻塞我（唯一真源）与反向聚合出的「我阻塞了谁」（便利视图）。便利视图不是第二真源：任何判定都只许信 `blockedBy`。」（`:133-136`） |
| 5 | `create` | `create(repo: RepositoryRef, input: CreateInput, ctx: OpContext): Promise<OpResult<Issue>>`（`:145`） | 「建一张票（可带幂等锚，见 `CreateInput.idempotencyKey`）。」（`:144`） |
| 6 | `close` | `close(repo: RepositoryRef, key: string, opts: CloseOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:148`） | 「关票；带 `expectedUpdatedAt` 时对不上就回 `conflict`。」（`:147`） |
| 7 | `reopen` | `reopen(repo: RepositoryRef, key: string, ctx: OpContext): Promise<OpResult<Issue>>`（`:151`） | 「重开票。」（`:150`） |
| 8 | `comment` | `comment(repo: RepositoryRef, key: string, body: string, ctx: OpContext): Promise<OpResult<Comment>>`（`:154`） | 「发一条评论；返回新建的那条评论本身（不是整张票）。」（`:153`） |
| 9 | `update` | `update(repo: RepositoryRef, key: string, patch: UpdatePatch, ctx: OpContext): Promise<OpResult<Issue>>`（`:157`） | 「改票（多字段原子写）；空补丁不该发请求。」（`:156`） |
| 10 | `setLabels` | `setLabels(repo: RepositoryRef, key: string, labels: LabelInput[], opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:160-166`） | 「覆盖式改标签（传什么就是什么，不是增量）。」（`:159`） |
| 11 | `setAssignees` | `setAssignees(repo: RepositoryRef, key: string, assignees: AssigneeInput[], opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:169-175`） | 「覆盖式改指派人（认领）。」（`:168`） |
| 12 | `setParent` | `setParent(repo: RepositoryRef, key: string, parentKey: string \| null, opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:178-184`） | 「改父地图；`null` 表示移到根。」（`:177`） |
| 13 | `setBlockedBy` | `setBlockedBy(repo: RepositoryRef, key: string, blockers: string[], opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:191-197`） | 「改阻塞关系。两条硬规矩：自己阻塞自己 → `conflict`；写完之后成环 → `conflict` 且**不落盘**。环检是写路径的一部分，不许省（省掉之后图会变成一团，而且再也解不开）。」（`:186-190`） |
| 14 | `getCurrentUser` | `getCurrentUser(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<Actor>>`（`:204`） | 「当前登录人。GitHub 回真实账号；本地 Markdown 与 GitLab 回 `unsupported` —— 这是**正常答案**，不是故障，调用方据此把「本人」相关的高亮关掉即可。」（`:199-203`） |
| 15 | `initProject` | `initProject(handle: RepoHandle, input: InitProjectInput, ctx: OpContext): Promise<OpResult<RepositoryRef>>`（`:210-214`） | 「初始化并发布工作区：建仓、提交、推上去。GitHub 后端完整实现；本地 Markdown 后端回 `unsupported`；GitLab 后端由注册表补桩。」（`:206-209`） |
| 16 | `listLabels` | `listLabels(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColor[]>>`（`:221`） | 「列出「这个后端能改色的全部标签」与各自颜色。**取不全就必须整体失败**，不许静默返回残缺列表……用户只会看到「标签凭空少了几个」。」（`:216-220`） |
| 17 | `setLabelColors` | `setLabelColors(repo: RepositoryRef, changes: LabelColorChange[], ctx: OpContext): Promise<OpResult<LabelColorBatchResult>>`（`:228-232`） | 「批量改标签颜色，逐条记账。部分成功是合法结果（入参每一条必须恰好落在 applied 或 failed 之一）；保存成功后界面必须重新列出标签拿真值刷新，不许乐观刷新。」（`:223-227`） |
| 18 | `counts` | `counts(repo: RepositoryRef, filter: ListFilter \| undefined, ctx: OpContext): Promise<OpResult<Counts>>`（`:117`） | 「数票：这个后端里符合条件的有多少张。只回数字不回行；只数工单不含拉取请求；拿不全就整体失败，**不许猜一个数**。」（`:113-116`） |
| 19 | `listPage` | `listPage(repo: RepositoryRef, filter: ListFilter \| undefined, opts: PageOpts \| undefined, ctx: OpContext): Promise<OpResult<PageResult>>`（`:123-128`） | 「按页取票：一次要一页行数据，外加「一共多少张」。排序键固定「创建时间倒序」；游标不透明，调用方只负责原样回传。」（`:119-122`） |
| 20 | `getRepoPermissions` | `getRepoPermissions(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>>`（`:241`） | 「问这个仓库的写权限。只回答 push / triage 两个布尔；问不出来如实失败，调用方按「未知」处理，**不许捏造**。GitHub 后端真去问；本地 Markdown 后端回 `unsupported`（本地文件可写性由沙箱与文件权限决定，没有「仓库权限」这回事）；GitLab 后端由注册表补桩。这三种回法都是合规的答案。」（`:234-240`） |
| 21 | `listSubIssues` | `listSubIssues(repo: RepositoryRef, mapKey: string, opts: Record<string, never> \| undefined, ctx: OpContext): Promise<OpResult<SubIssueList>>`（`:254-259`） | 「取一张地图的全部子票（翻页拉到底，带 1000 张硬上限）。为什么它在契约里而不是某家的扩展：它的读者是宿主电话（`src/host/mapTickets.js`），那是房外代码；房外有读者，它就不是「某家的实现细节」。返回的字段里 `capped` 与 `missing` 是「有没有拿全」的诚实交代……本地 Markdown 后端与 GitLab 后端今天回 `unsupported`，宿主电话据此退化：界面提示用户「在它自己那边看全部」。」（`:243-253`） |
| 22 | `ensureLabelColorsFile` | `ensureLabelColorsFile(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColorsFilePlacement>>`（`:270`） | 「确保工作区里有那份用户可手改的标签配色文件。调用它的地方是「用户为工作区选定后端」那一步……本地 Markdown 后端实现它（颜色存在工作区文件里）；GitHub 后端回 `unsupported` —— 它的标签颜色存在仓库标签上，没有本地文件可放。幂等要求：文件已存在时**一个字都不改**（用户可能已经手改过它）。」（`:261-269`） |

### 1.2 定位口 3 条（`operations-catalog.ts:102-106`）

`Tracker` 接口里用一段注释把这 3 条与上面 22 条的区别说清了（`operations.ts:272-276`）：

> 「── 定位口三条 ── 与上面 22 条操作的区别只有一条，但很要紧：它们**没有「我不支持」这种答案**。问「这个仓库在这个后端上叫什么」，答案是名字或者空；空也是答案，不是失败。所以注册表不替它们补桩，缺席就是缺席，调用方拿空值继续往下走（不抛、不拦）。名字用「地址」不用「网址」：本地文件后端给过票文件路径，路径也是地址。」

| # | 定位口名 | 签名（`src/tracker/contract/operations.ts`） | 中文注释（同文件，原样摘） |
| --- | --- | --- | --- |
| 23 | `getRepoKey` | `getRepoKey(cwd: string, ctx: OpContext): Promise<{ owner: string; name: string } \| null>`（`:283`） | 「从工作区目录解析出 `owner/name`（只有需要连远端的后端才有意义）。返回 `null` 表示这一趟没解析出来（不是异常，调用方按「补不出来」处理，**不许编一个名字**）。本地 Markdown 后端没有这条 —— 它的身份就是工作区目录本身，没有什么可解析的。」（`:278-282`） |
| 24 | `describe` | `describe(handle: RepoHandle, backendId?: BackendId): RepositoryRef`（`:289`） | 「产出仓库身份。第二个参数是后端 id；实例自己知道身份，可以忽略它，故标可选参数。」（`:285-288`） |
| 25 | `issueAddress` | `issueAddress(ref: RepositoryRef, key: string): string`（`:292`） | 「一张票在这个后端里的地址（远端后端回网页地址；本地 Markdown 算不出票文件名，回空串，见 #1144）。」（`:291`） |

### 1.3 与清单配套的两件事实

- `Tracker` 一共 **26 个成员**：上面 25 条加一个 `readonly id: BackendId`（`operations.ts:99`）。接口自己的注释写「一个后端适配器对上层承诺的全部能力：**22 条操作 + 3 条定位口，共 25 条**」（`operations.ts:85`），并写明「谁实现：GitHub 后端与本地 Markdown 后端（GitLab 后端本轮不动，它拿到的是注册表补的桩）」（`operations.ts:87`）。
- 后端可以少实现：`RoomOperations = Partial<Tracker> & { id?: BackendId }`（`operations.ts:304-306`），注册表按 `OPERATIONS` 给缺的操作补「我不支持」的桩（`src/tracker/registry/shape.ts:105` 的 `OPERATIONS.includes(prop)` 分支，`:87` 的注释写「`OPERATIONS`（22 条操作）里缺的方法 → unsupported 桩」）。**桩只补操作那 22 条，不补定位口那 3 条**，这与定位口的定义一致。

### 1.4 目录里的文件（本节点名的都在这）

`src/tracker/contract/` 下共 16 个文件，按 `glob` 实测逐个列出：

| 文件 | 本次读了吗 |
| --- | --- |
| `src/tracker/contract/operations.ts`（306 行） | 读了全文 |
| `src/tracker/contract/operations-catalog.ts`（114 行） | 读了全文 |
| `src/tracker/contract/README.md`（130 行） | 读了全文 |
| `src/tracker/contract/index.ts`（313 行） | 读了全文 |
| `src/tracker/contract/backend-module.ts`（249 行） | 读了全文 |
| `src/tracker/contract/vocabulary.ts`（93 行） | 读了全文 |
| `src/tracker/contract/results.ts`（200 行） | 读了全文 |
| `src/tracker/contract/identity.ts` | 未逐行读（本次只用到 `operations.ts` 对它的 import） |
| `src/tracker/contract/entities.ts` | 未逐行读 |
| `src/tracker/contract/contexts.ts` | 未逐行读 |
| `src/tracker/contract/inputs.ts` | 未逐行读 |
| `src/tracker/contract/canonical-labels.ts` | 未逐行读（只在全目录搜「19」时命中一行标签数量，与本问题无关） |
| `src/tracker/contract/contract-page.ts` | 未逐行读 |
| `src/tracker/contract/contract-label-colors.ts` | 未逐行读 |
| `src/tracker/contract/contract-idempotency.ts` | 未逐行读 |
| `src/tracker/contract/vocabulary.js` | 未读；它是构建产物（`README.md:86-88` 写「拼接拼的是构建机生成的 `src/tracker/contract/vocabulary.js`，那是产物、不入库」） |

**任务书里点名的 `ports.ts` 这个文件不存在。** 目录里没有 `ports.ts`。`src/tracker/contract/README.md:102-103` 解释了原因：「形状层按「谁读它」分成五件（2026-10-12 拆开，原先堆在一个 `ports.ts` 里）」，拆成的五件是 `identity.ts`、`entities.ts`、`contexts.ts`、`results.ts`、`inputs.ts`（文件清单表在 `README.md:105-111`）。

---

## 二、19 与 25 的差集：新增的是哪几个、干什么用、从哪张票来

### 2.1 差集（老 19 条一条没摘）

| 分类 | 名字 | 从哪来 |
| --- | --- | --- |
| **净增 3 条操作** | `getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile` | 从「某一个后端自己的房内扩展」收编进契约，见下面 2.2 |
| **新增 3 条定位口**（老契约没有这一段） | `getRepoKey`、`describe`、`issueAddress` | `getRepoKey` 与 `describe` 原是房内旁路键；`issueAddress` 是 #1051 结论里的 `issueUrl`，后来改名（见 2.3） |
| **摘掉 2 个房内私有函数**（本来就不在那 19 条里） | `normalize`、`parse` | 它们在老口径里是 Markdown 房的旁路键，本轮退回成房内私有函数，没有升进契约。`docs/adr/20261014-tracker-capability-ceiling.md:36` 写「本地 Markdown 的 `normalize` / `parse` 从实例上摘掉：它们是房内模块的私有实现，别的文件直接 import，不经实例」 |
| **退休 3 个类型** | `GitHubRoomExtension`、`MarkdownRoomExtension`、`RoomAuxiliaries` | `operations.ts:14-16` 写「上一版的写法是「契约管 19 条操作，各家另有自己的扩展」……那三个类型已经删掉，成员全部并进 `Tracker`」 |

### 2.2 新增这 3 条操作各自干什么、为什么收进来

`operations.ts:59-64`（`src/tracker/contract/README.md` 里同一段）把理由写成了同一条：「三条操作是 2026-10-14 从「某一个后端的私有扩展」收进来的，理由都是同一条——**它们的读者在后端之外**」：

- `getRepoPermissions`：「deck_context 的能力位与失败归因两边都要用「这个仓库能不能写」。」（`README.md:61`）
- `listSubIssues`：「调用者是宿主电话 `src/host/mapTickets.js`。」（`README.md:62`）
- `ensureLabelColorsFile`：「调用者是宿主「用户为工作区选定后端」那一步；它当时就做成「实现了就放、没实现就跳过」，但那句话得写进契约才算数。」（`README.md:63`）

名录里对这三条另有一行注释（`operations-catalog.ts:82-83`）：「下面三条原先分别挂在某一个房间的「房内扩展」名下（没进名录，因此也没有桩）。收进来的理由是同一条：它们的读者都在房外，只有进名录，上层才不用问后端是谁。」

`getRepoPermissions` 另有一层变化值得单记：**它在老契约里是「可选成员」，今天变成名录里的正式操作、必填成员**。老契约在 `git show c8d7ef0a^:src/tracker/contract/operations.ts` 里写的是 `getRepoPermissions?(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>>`（带问号），并且那一段注释原文是「**`getRepoPermissions` 是这一轮新升进契约的**：它原本是 GitHub 房的只读旁路（不进 OPERATIONS），但 deck 的「这个仓库能不能写」这个判断两边都要用，按归属原则升进来；`listSubIssues` 与 `ensureLabelColorsFile` 仍是房内扩展，在本文件末尾单独定形状，**不进 `Tracker`**」。今天 `operations.ts:241` 的声明没有问号，且三条都在 `OPERATIONS` 里。

### 2.3 从哪张票来

- **讨论票 #1051**（「地图08讨论：契约第一次被真后端压」）是结论产地。成文决议 `docs/adr/20261014-tracker-capability-ceiling.md:5` 写「讨论见 #1051」；提交 `c8d7ef0a` 的正文写「关联 #1051」。
- **固化票是 #1147**（「契约层补齐能力上限：25 条能力定稿、三条编译期断言、门禁先建后删」）。落地这笔提交 `c8d7ef0a` 就是它这条线的产出；`2482604f`（「跟踪器域转成 TypeScript 并立起能力断言，门禁里被接管的四项随之拆除（#1147）」）是收尾。`docs/adr/20261014-tracker-capability-ceiling.md:5` 写「承接 `docs/adr/20261011-deck-ts-rewrite.md` §3.1；讨论见 #1051；真源见 `src/tracker/contract/operations-catalog.ts` 与 `src/tracker/contract/operations.ts`」。
- **改名那一笔**：`issueUrl` 这个名字今天不存在了，改成了 `issueAddress`。这也解释了为什么今天的差集表里看不到 `issueUrl`。#1057 的调研记录 `research/1057-teacher-brief-round2.md:268` 记「就是 #1051 结论里的 `issueUrl`。#1133 / #1134 / #1135 把它改名为 `issueAddress`，旧名连同 `searchUrl`、`linkPattern` 由 #1141（提交 `856636a1`）删除」；契约自己的一行也留了痕：`operations.ts:291` 的 `issueAddress` 注释末尾写「见 #1144」。**#1051 评论原文里那六条补进名字（`listSubIssues`、`getRepoPermissions`、`getRepoKey`、`describe`、`issueUrl`、`ensureLabelColorsFile`）与今天名录里的六条新增一一对得上，只差一个改过名的 `issueUrl`→`issueAddress`。** 该评论原文本次没有亲手用 `gh` 读回，是按 `research/1057-teacher-brief-round2.md:212` 的转引记的，见第五节。

### 2.4 一个必须说清的口径：这是「能力上限」，不是「每个后端都实现」

`src/tracker/contract/README.md:42-50` 的标题就是「能力的上限：25 条，全部写在这一层（2026-10-14 定的规矩）」，正文写「后端面对每一条只有两种回法——**我实现**，或者**我不支持**。**后端不许有自己独有的对外方法**：凡是实例上叫得到名字的东西，都必须先在这份契约里出现」。表格在 `README.md:54-57` 分两段列了 22 与 3。

---

## 三、GitLab 房对照（已实现 / 未实现 / 未知，逐个能力）

### 3.0 先说三件与任务书描述不符的实测事实

任务书说「`src/tracker/rooms/gitlab/` 下 14 个 `.js` 文件」。实测**这 14 个文件今天全部是 `.ts`，一个 `.js` 都没有**：

1. 14 个文件的扩展名全部是 `.ts`，目录里 `.js` 文件的个数是 0（`Get-ChildItem src\tracker\rooms\gitlab -Filter *.js` 实测 0）。
2. `src/tracker/rooms/README.md:15-24` 的文件构成说明仍然写着 `index.js`、`client.js` 这类旧名字，这一处还没有跟上。
3. `src/tracker/rooms/gitlab/index.ts:8-9` 自己记了改名时间：「2026-10-14 从 index.js 改名成 index.ts（地图 06 的单房票 #1135，先修后转两次提交里的后一次），同轮把 13 个手写 .js 一并转成 .ts：只加类型标注不改逻辑，转完行为与转之前一致。」

改名是两笔提交做的（`git log --name-status -- src/tracker/rooms/gitlab/*.ts` 实测）：`03ec7d81`（「GitLab 房入口从 JavaScript 转成 TypeScript，顺手把指向它的路径全部改过来（地图06 #1135）」）把 `index.ts` 转成 `.ts` 并新增；`2482604f`（「跟踪器域转成 TypeScript 并立起能力断言，门禁里被接管的四项随之拆除（#1147）」）把其余 13 份一并转成 `.ts`。两笔都在 2026-10-14。

类型检查已经接上：`src/tracker/tsconfig.json` 的 `include` 是 `["**/*.ts"]`（目录通配，新增文件自动进检查），`index.ts:11` 的注释写明跑法 `node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json`。

### 3.1 GitLab 实例今天交出来的成员（一手清单）

`src/tracker/rooms/gitlab/index.ts:35-41` 的 `GitlabBackendMembers` 类型逐字列了它交出来的名字，`createGitlabBackend`（`:175`）返回的对象用 `satisfies GitlabBackendShape`（`:197`）收口。成员逐个是：

```
'id'
'preflight' | 'list'
'get' | 'getDependencies' | 'create' | 'close' | 'reopen'
'comment' | 'update' | 'setLabels'
'setAssignees' | 'setParent' | 'setBlockedBy'
'describe' | 'issueAddress'
```

去掉 `id`，**15 条能力 = 13 条操作 + 2 条定位口**。这与文件自己的注释一致：`:30` 写「GitLab 交出来的成员：15 条能力 + id（13 条操作 + describe/issueAddress；其余缺的都还没做）」，`:168` 写「今天实现了 13 条操作 + 2 条定位口，其余交给注册表补桩」。

### 3.2 25 条能力逐条对照

| # | 能力 | 段 | GitLab 今天 | 判据 |
| --- | --- | --- | --- | --- |
| 1 | `preflight` | 操作 | **已实现** | `index.ts:184` → `glabPreflight`（`src/tracker/rooms/gitlab/preflight.ts:48`） |
| 2 | `list` | 操作 | **已实现** | `index.ts:185` → `listIssues`（`issues.ts:119`） |
| 3 | `get` | 操作 | **已实现** | `index.ts:186` → `getIssue`（`issues.ts:176`） |
| 4 | `getDependencies` | 操作 | **已实现** | `index.ts:187` → `getDependencies`（`graph-blocking.ts:187`，经 `graph.ts:3` 转出） |
| 5 | `create` | 操作 | **已实现** | `index.ts:188` → `createIssue`（`issues.ts:212`） |
| 6 | `close` | 操作 | **已实现** | `index.ts:189` → `closeIssue`（`issues.ts:294`） |
| 7 | `reopen` | 操作 | **已实现** | `index.ts:190` → `reopenIssue`（`issues.ts:324`） |
| 8 | `comment` | 操作 | **已实现** | `index.ts:191` → `addComment`（`comments.ts:46`） |
| 9 | `update` | 操作 | **已实现** | `index.ts:192` → `updateIssue`（`issues.ts:353`） |
| 10 | `setLabels` | 操作 | **已实现** | `index.ts:193` → `setLabels`（`labels.ts:85`） |
| 11 | `setAssignees` | 操作 | **已实现** | `index.ts:194` → `setAssignees`（`graph-membership.ts:135`） |
| 12 | `setParent` | 操作 | **已实现** | `index.ts:195` → `setParent`（`graph-membership.ts:49`；落成 `relates_to` 平级链接，不是原生父子边，见 `index.ts:221-223` 的文案改正记录） |
| 13 | `setBlockedBy` | 操作 | **已实现** | `index.ts:196` → `setBlockedBy`（`graph-blocking.ts:254`） |
| 14 | `getCurrentUser` | 操作 | **未实现**（注册表补桩） | `GitlabBackendMembers`（`index.ts:35-41`）里没有它；`docs/tracker/capability-gitlab.md:28` 登记「当前不支持、未来会开发」 |
| 15 | `initProject` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:29` 同登记，依据「`glab repo create` 能建」 |
| 16 | `listLabels` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:26` 登记「当前不支持、未来会开发；标签配色语义说得通」 |
| 17 | `setLabelColors` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:27` |
| 18 | `counts` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:24` |
| 19 | `listPage` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:25` |
| 20 | `getRepoPermissions` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:30` |
| 21 | `listSubIssues` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:31`，且 `operations.ts:251-252` 明写「本地 Markdown 后端与 GitLab 后端今天回 `unsupported`」 |
| 22 | `ensureLabelColorsFile` | 操作 | **未实现**（注册表补桩） | 同上；`capability-gitlab.md:32` |
| 23 | `getRepoKey` | 定位口 | **没有这条**（定位口注册表不补桩） | `GitlabBackendMembers` 里没有；`index.ts:30` 的注释说「其余缺的都还没做」；`capability-gitlab.md:40` 登记「当前不支持、未来会开发……实例与模块都没有」 |
| 24 | `describe` | 定位口 | **已实现** | `index.ts:182`（实例成员）与 `index.ts:286`（模块对象成员），函数在 `index.ts:118` |
| 25 | `issueAddress` | 定位口 | **已实现** | `index.ts:183`（实例成员）与 `index.ts:291`（模块对象成员），函数在 `index.ts:135` |

**小计**：已实现 15 条（13 条操作 + 2 条定位口），未实现 9 条操作，缺 1 条定位口，合计覆盖 25 条里的 15 条。

### 3.3 与能力登记表的对照，以及一处需要拍板的口径差

GitLab 的能力登记表是 `docs/tracker/capability-gitlab.md`（`#1147` 决策 9 的交付物，`:3` 写「一条一条审过实现才落笔，不估」）。上表与它逐条一致，只有一处**登记表的表述和契约自己的注释不一致**，原文如下：

- 登记表 `docs/tracker/capability-gitlab.md:32` 把 `ensureLabelColorsFile` 的依据写成「同上；**语义是本地放文件，与远端无关**」，归到「当前不支持、未来会开发」。
- 契约自己的注释 `operations.ts:265-266` 写的是「本地 Markdown 后端实现它（颜色存在工作区文件里）；**GitHub 后端回 `unsupported`** —— 它的标签颜色存在仓库标签上，没有本地文件可放」。这一段只点名了 GitHub 回 `unsupported`，没有点名 GitLab。
- 同一件事在 Markdown 的登记表里是另一个口径：`docs/tracker/capability-markdown.md:28` 把 `ensureLabelColorsFile` 登记成 Markdown「明确提供功能」。

也就是说：**「GitLab 这一条到底该登记成「明确不支持」还是「当前不支持、未来会开发」，两份文档口径不同。** 契约注释的措辞与登记表的措辞对不上，这一处需要人拍板，本次不下判断（见第五节）。

### 3.4 房内有几个「非契约」的对外导出，别把它们当成契约操作

房内文件里有两个名字与契约操作同名、但**不在工厂交出的对象上**，容易被误读成「已实现」：

- `src/tracker/rooms/gitlab/labels.ts:160` 的 `export async function listLabels(...): Promise<OpResult<Label[]>>`。它自己的注释 `:159` 写着「**非op**：列仓库标签色板（供 DeckProjection.labels 并集，非契约op），只取 name/color 两格以便并集」。它**没有**挂进 `createGitlabBackend` 的返回对象（`index.ts:193` 只挂了 `setLabels`），所以契约的 `listLabels` 在 GitLab 上仍然是未实现；而且它的返回类型是 `Label[]`，与契约 `listLabels` 要求的 `LabelColor[]`（`operations.ts:221`）不是同一个形状。
- `src/tracker/rooms/gitlab/comments.ts:103` 的 `export async function listComments(...)` 同理，它也不在工厂返回对象上（`index.ts:191` 只挂了 `addComment`），契约里也没有「列评论」这条操作（评论随 `get` 的 `opts.comments` 带出来，见 `operations.ts:130`）。

另有一处值得记住的注释：`src/tracker/rooms/gitlab/index.ts:177` 那个 `unsupported` 局部函数（`gitlab ${op} pending #145 stub`）带一行 `void unsupported`（`:178`），**它是个死代码占位**，真正回「不支持」的是注册表补的桩，不是它。

### 3.5 编译期已经盯上了这间房

`src/tracker/capability-assertions.ts` 是三条编译期断言（`:6` 写「本文件没有任何运行时语句……违反时 tsc 直接红」），它 import 了 GitLab 的形状：

- `:33` `import type { GitlabBackendMembers, createGitlabBackend } from './rooms/gitlab/index.js'`
- `:59-60` 断言一（完整）：`GitlabBackendMembers` 里登记的名字，工厂必须一个不少地交出来
- `:71` 断言三（不多）：工厂交出来的键必须全在契约里，多带一个契约之外的对外方法就红

**这条断言是按「登记集合」核对的，不是按契约的 25 条核对的**：GitLab 今天登记 15 条，编译期只保证「这 15 条一条不少、一条不多」，**不会**因为它缺那 10 条而报警——缺的那些由注册表补桩，这正是契约允许的常态。`capability-assertions.ts:25-27` 定了改成员的规矩：「先改对应后端的登记表（`docs/tracker/capability-*.md`），再改下面对应的成员集合，两处同一次提交。」

### 3.6 旧的契约路径还在不在房内（任务书第 8 问）

**不在。** 房内 14 个 `.ts` 文件的全部 import 说明符都指向新契约：`../../contract/vocabulary.js`、`../../contract/identity.js`、`../../contract/contexts.js`、`../../contract/entities.js`、`../../contract/inputs.js`、`../../contract/results.js`、`../../contract/operations.js`，另有房内的 `./xxx.js` 与仓库共享的 `../../../shared/...`。用 `grep` 在 `src/tracker/rooms/gitlab/` 搜 `host/tracker/contract` 只有 **1 处命中，而且是注释不是 import**：

- `src/tracker/rooms/gitlab/idempotency.ts:5` 的注释里提到旧文件「`src/host/tracker/contract-idempotency.js`」（说明幂等锚的语义原住那里）。

另有两处**文字口径过时**（不是路径引用），一并列出：

- `src/tracker/rooms/gitlab/index.ts:5` 的文件头注释写「严格对照 **contract.js 13操作集（OPERATIONS）** 与 shape.js」。今天 `src/tracker/contract/contract.js` 这个文件已经不存在（契约真源在 `src/tracker/contract/` 的 `.ts` 里），而且「13 操作集」这个数也低估了——今天的操作是 22 条。
- `src/tracker/rooms/README.md:15-24` 的文件构成说明整段还在用 `.js` 后缀。

---

## 四、这对票 #1063、#1064 的直接影响（只列事实推论，不做决定）

先把这三张票是什么写清楚（出处 `research/1010-ticket-structure.md:256` 的表格「| 10 GitLab 房 | #1062 | #1063 讨论、#1064 目录归位与迁移说明、#1065 讲解 |」，同一段在 `research/1010-ticket-structure.md:225` 记了第十号地图的目的）：**#1062 是第十号地图票（GitLab 房）**，**#1063 是它的讨论票**，**#1064 是「地图10开发：房间目录归位与迁移说明」这张开发票**，另有 #1065 是讲解票。

下面是查证到的事实推论，按票分。

### 4.1 对 #1063（讨论票）的直接影响

1. **#1063 讨论的前提数字已经不是今天的数字。** 已有的讨论底稿 `research/1063-teaching-background.md:16` 写的是：「契约十九个操作指的是……十九个名字的清单亲手数过，见 `research/1010-room-conformity-checklist.md:4`……**新契约目录的说明确认将来是十九条加新升的一条共二十个成员**，见 `src/tracker/contract/README.md:108-110`。」今天 `src/tracker/contract/README.md:108-110` 的内容已经是 `entities.ts`、`contexts.ts`、`results.ts` 那三行文件清单，与「十九条加新升的一条共二十个成员」毫无关系；README 的现行数字写在 `README.md:42`（标题「能力的上限：25 条」）与 `README.md:54-57` 的两段表（操作 22 + 定位口 3）。**这份底稿写于 2026-10-13（它自己的 `:6` 写明核对日期），比契约升级的 `c8d7ef0a`（2026-10-14 14:33）早一天，所以它记的是升级前的状态。**
2. **同一份底稿的另一条已经实测不成立。** `research/1063-teaching-background.md:28` 写「代码仍然是手写 JavaScript，十四个文件的扩展名全部还是点杰埃斯，没有一个变成点梯埃斯，这个事实是亲手列目录看到的」，`:30` 写「说明文件还没有落盘」。`:28` 这条今天已经被推翻（14 个文件全是 `.ts`，见本文 3.0）；`:30` 这条今天仍然成立（见 4.2 第 3 点）。
3. **讨论票要讨论的口径变了。** 老口径下「GitLab 房差几条」的答数是「19 条里差 6 条」（19 减 13）；今天的答数是「25 条能力里差 10 条」（25 减 15：9 条操作加 1 条定位口）。这两个数字不能互换着用，因为分母与分段都变了。
4. **一份现成的、按 25 条口径写成的对照答案已经存在**：`docs/tracker/capability-gitlab.md`（`#1147` 预交付）。它 `:44` 自己写明用途：「本表随地图 10（GitLab 房，`#1062`）交付使用。本表由 `#1147` 预交付，地图 10 动工时不再重审，只需在实现偏离本表时回来改表。」也就是说讨论票不必重新逐条审，只需在实现偏离时改表——但**表里那一处口径差（3.3 节）在动手前需要先有一句话定下来**，否则「不再重审」会把那个含糊一起带进实现。

### 4.2 对 #1064（目录归位与迁移说明）的直接影响

1. **#1064 票面点名的 14 个 `.js` 文件已经不叫 `.js` 了。** `research/1136-adversarial-coverage.md:256` 转引了 #1064 的自述边界：「它自写边界「只搬目录与写说明，**代码不转 TypeScript**」，文件清单正是 gitlab 那 14 份（client、comments、create-write、errors、graph-blocking、graph-membership、graph、idempotency、index、issues、labels、normalize、preflight、queries）」。这 14 个名字今天都在，但扩展名已经由 `03ec7d81`（#1135）与 `2482604f`（#1147）两笔提交转成了 `.ts`。**「代码不转 TypeScript」这条边界，事实上已经被别的票先行履行完了**；#1064 剩下的、也是它真正独有的那一半是「写迁移说明」。
2. **迁移说明确实还没写。** 决议与规格要求的文件名是 `MIGRATION-SLOT.md`（`research/1063-teaching-background.md:22` 记「将来要放在 `src/tracker/rooms/gitlab/` 下面的那一份说明文件，文件名是 `MIGRATION-SLOT.md`」）。今天全仓搜 `*MIGRATION*` 零命中（`glob **/*MIGRATION*` 返回空），与底稿 `research/1063-teaching-background.md:30` 的实测一致。票结构文档给 #1064 定的做完标志是「目录就位加说明文件写清步骤加门禁不因它变红」（`research/1010-ticket-structure.md:225`，经 `research/1063-teaching-background.md:22` 转引），**其中「目录就位」与「代码不转」两项目前都已由别的票完成，只剩说明文件与门禁两项。**
3. **`#1136` 的对抗审查已经把 #1064 重新定性为「收尾欠账」，并且点明它还没收完。** `research/1136-adversarial-coverage.md:308` 原话：「票的定位要往上提一格：不是「两条正则指空目录」，而是「**目录归位的收尾欠账**」……#1064 那串收尾没收完，本票是它的尾巴，建议在票面与 `#1064` 之间补一条明写的父子关系或前后关系。」同一份文件 `:256` 的表里把 #1064 记为「**本票是它的尾巴**」，并写「而在办的正是给这 14 份做 `.js`→`.ts` → **归位这件事的收尾还没收完**」（「本票」指的是 #1136）。
4. **如果要给 GitLab 补齐契约，缺口是可数的 10 条。** 9 条操作是 `counts`、`listPage`、`listLabels`、`setLabelColors`、`getCurrentUser`、`initProject`、`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile`；1 条定位口是 `getRepoKey`。补齐时按契约规矩是「先把名字加进 `operations-catalog.ts` 与 `Tracker`，再让后端去实现」（`README.md:49-50`），并且要同步改登记表与房间里的成员集合（`capability-assertions.ts:25-27`）。**「这 10 条该谁来补、分几票补、以及补齐是否属于 #1064 的范围」是决定，本次不做。**
5. **#1064 现在若动手，会碰到已经变了的前提。** 它的票面口径（14 份手写 `.js`、不转码）与今天的工作区（14 份 `.ts`、类型检查已接上、编译期断言已挂上）对不上；`research/1136-adversarial-coverage.md:256` 也把它与 #1136 描述的同一批门禁文字（`.dependency-cruiser.cjs`、`tests/same-layer-baseline.json`、`tests/verify-dependency-rules.ts`）列在一起。**这些门禁文件的现状与 #1064 的归属关系，本次没有逐项核实（见第五节）。**

### 4.3 一处与「契约条数」无关、但会影响这三张票的事实

契约版本号**没有**因为 19 升到 25 而变。`src/tracker/contract/vocabulary.ts:87` 写的是 `export const CONTRACT_VERSION = 1`，`operations-catalog.ts:46-49` 专门用一段注释解释了为什么版本号不搬过来（「它住在 `vocabulary.ts`（值 1，供日志与审计引用）」）。**「加操作不升版本号」是既定口径，有原文可查**：`src/tracker/contract/index.ts:275-276` 在「计数契约」那一节里写「**不升 CONTRACT_VERSION**：这一次是纯新增操作，没实现它的后端由注册表自动补桩兜住，既有形状与既有后端一个都没改。（这句话写在这里，是免得以后有人看见「契约加了东西却没升版号」再查一遍。）」——注意那句原文是给 `counts` 这条操作写的，但它表达的判据（纯新增操作不升版号）与本次 19 升 25 的形状相同。**「本次 19 升 25 是否也明确援引了这条判据」这件事，本次没有找到逐字对应的一句话，见第五节。**

---

## 五、未核实清单

1. **#1051 的评论原文与 #1147 的评论原文，本次没有用 `gh` 亲手读回。** 本文 2.3 节里那六条补进名字（`listSubIssues`、`getRepoPermissions`、`getRepoKey`、`describe`、`issueUrl`、`ensureLabelColorsFile`）与「本次摘掉 2 条：`normalize`、`parse`」「新版合计 25 条」这些原话，都是从 `research/1057-teacher-brief-round2.md:212` 的转引读到的；那一行自己写明来源是 #1051 的定稿评论。**#1051 与 #1147 的票面与评论原文本次未核实。**
2. **#1062、#1063、#1064 三张票的正文与评论，本次没有亲手读回。** 它们的分工（地图 / 讨论 / 目录归位与迁移说明）取自 `research/1010-ticket-structure.md:256`，#1064 的自述边界取自 `research/1136-adversarial-coverage.md:256` 的转引。**票面是否还点名别的文件、是否已经有人动过、当前的 open/closed 状态，本次未核实。** 这与 `research/1063-teaching-background.md:90` 记的同一条未核实一致。
3. **迁移说明文件 `MIGRATION-SLOT.md` 要求的章节，未核实。** 本次只核实了「它今天不存在」（全仓 glob 零命中）；它该写哪几节，本次没有找到逐字的章节清单（`research/1063-teaching-background.md:96` 记的也是同一条未核实）。
4. **`ensureLabelColorsFile` 在 GitLab 上的登记口径，两份文档不一致，未裁决。** 事实见本文 3.3 节：`docs/tracker/capability-gitlab.md:32` 记「当前不支持、未来会开发」，而契约注释 `operations.ts:265-266` 只点名了 GitHub 回 `unsupported`、没点名 GitLab。**这一处该以哪份为准，本次未核实有没有成文裁决。**
5. **「19 升 25 不升 CONTRACT_VERSION」有没有一句逐字对应的话，未核实。** 本次只找到 `src/tracker/contract/index.ts:275-276` 给 `counts` 那条操作写的同形判据（原文见 4.3 节），以及 `vocabulary.ts:87` 的现值 `1`；**没有找到专为本次 19 升 25 写的「不升版号」原句。**
6. **`src/tracker/rooms/README.md` 里那批 `.js` 旧名字、以及 `src/tracker/rooms/gitlab/index.ts:5` 那句「contract.js 13操作集」，归属哪张票修，未核实。** `research/1136-adversarial-coverage.md:308` 只提到同一批旧路径表述的收尾「建议在票面与 #1064 之间补一条明写的父子关系或前后关系」，没有点名责任人；`research/1136-adversarial-decision.md:81` 另记着一条「#1154：归位之后残留的旧路径表述：91 个文件仍写着 `tracker/backends`」，但那一批讲的是 `tracker/backends` 这个更旧的路径，与本文这两处的 `.js` 旧名字不完全相同。**这两处该谁修、算不算 #1064 的范围，本次未核实。**
7. **#1065 讲解票与 #1055（GitHub 房的讲解票）的正文没有读。** 它们可能含对条数的另一种表述，本次只读了 `research/1010-ticket-structure.md` 的票结构表。
8. **`src/tracker/rooms/gitlab/` 那 13 份非入口文件内部的函数签名，本次只核到导出行，没有逐行读实现。** 对照表里每一条「已实现」的判据都是「工厂返回对象里挂了它、并且它转发到的那个函数确实存在且导出」；**这些实现内部是否与契约的参数语义逐条对齐（例如 `setLabels` 是否把 `opts.expectedUpdatedAt` 往下传、`close` 是否读了 `CloseOpts.reason`），本次未核实。** 已有的同类记录显示这类差异是真出现过的：`research/1063-teaching-background.md:86` 记「前两座房间的对照表已经暴露八处语义差异……其中六处是收了可选项却不往下传」，而 GitLab 房**从来没有做过这种逐条语义对照**（同一份文件 `:92` 把「第三座房间的十九操作对照」列为未核实）。
9. **`docs/tracker/capability-github.md` 与 `docs/tracker/capability-markdown.md` 里关于 GitHub / Markdown 两房的具体登记条目，本次只核到与本文相关的行，没有逐条对照实现复核。** 本文用到的两处是：`capability-markdown.md:28`（Markdown 实现 `ensureLabelColorsFile`）与 `capability-gitlab.md` 全文。
10. **#1064 票面点名的 14 个文件名与今天磁盘上的 14 个文件名是否严格一一对应，未逐名核对。** 本文核到的是「数量是 14」「全部是 `.ts`」；两份清单的逐名对齐取自 `research/1136-adversarial-coverage.md:256` 的转引，没有与实际文件名做过一次逐行的并排比对。
