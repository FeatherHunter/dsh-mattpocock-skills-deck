# GitHub 读路径 13 份文件对 25 条能力的逐条答案

**这份文件回答什么问题。** #1052（GitHub 后端房间的「读路径」票）票面写着一条验收标准：「本片涉及的能力逐条有『实现 / 不支持』的明确答案」。这份文件就是那份答案：把契约的 25 条能力（22 条操作 + 3 条定位口）逐条拿出来，说清 **#1052 点名的这 13 份读路径文件**里哪份文件的哪个函数实现了它、真做了什么（哪个 gh 命令或哪段本地逻辑）、结论是什么，每条结论都带 `文件:行号` 判据。不照抄登记表，全部动手读过实现再落笔。

**给谁用。** 三拨人：一是 #1052 的验收人，票面要求的那张「能力小表」可以直接从第三节抄；二是维护 `docs/tracker/capability-github.md`（#1147 的登记表）的人，第五节是那张表的逐条校对，其中两处需要有人拍板；三是以后改读路径的人，第六节是「这 13 份文件各自管哪几条能力」的索引。

**什么时候过期。** 两件事任一发生就过期：一是契约名录改了（`src/tracker/contract/operations-catalog.ts` 的 `OPERATIONS` 或 `LOCATORS`），二是本文点到的那 13 份文件里的实现改了。本文的核对时间是 **2026-10-14**，当天名录 25 条（`operations-catalog.ts:62-87` 的 22 条 + `operations-catalog.ts:102-106` 的 3 条），GitHub 房间实现其中 **24 条**，缺 `ensureLabelColorsFile` 一条（第 4.1 节与第五节有说清）。另外提醒一句：本文的行号取自 2026-10-14 当天的**工作区状态**，当天读路径这 13 份里有 11 份正带着未提交的改动（`checks.ts`、`counts.ts`、`fallback-reason.ts`、`issues.ts`、`labels.ts`、`normalize.ts`、`page.ts`、`preflight.ts`、`queries.ts`、`sub-issues.ts`、`repo.ts`；只有 `client.ts` 与 `repo-permissions.ts` 是干净的），装配文件 `backend.ts` 也在改动中；那些改动提交之后，行号需要重新对一遍，判定本身不受影响。

---

## 一、25 条名录与签名（判「实现」的依据）

名录的唯一真源是 `src/tracker/contract/operations-catalog.ts`：`OPERATIONS` 数组从第 62 行起、`LOCATORS` 从第 102 行起，两段合起来是 `CAPABILITIES`（`operations-catalog.ts:114`）。签名（参数与返回）写在 `src/tracker/contract/operations.ts`，返回形状的定义在 `src/tracker/contract/results.ts` 与 `src/tracker/contract/inputs.ts`。

三段的分工是这条规矩的根：**契约定义能力上限，后端对每一条只有两种回法——「我实现」或「我不支持」，后端不许有自己独有的对外方法**（`operations.ts:7-12`）。操作那 22 条没实现时由注册表补一个「我不支持」的桩（`src/tracker/registry/shape.ts:73-78` 的 `unsupportedStub`，装配处 `shape.ts:105`）；定位口那 3 条没有「不支持」这种答案，缺席就是缺席，调用方拿空值往下走（`operations-catalog.ts:89-101`）。

| # | 名录位置 | 能力名 | 段 | 签名（`operations.ts` 行号） | 返回形状（定义处） |
|---|---|---|---|---|---|
| 1 | `operations-catalog.ts:63` | `preflight` | 操作 | `preflight(handle: RepoHandle, ctx: OpContext): Promise<PreflightResult>`（`:108`） | `PreflightResult { ok: boolean; error?: TrackerError }`（`results.ts:56-60`） |
| 2 | `operations-catalog.ts:64` | `list` | 操作 | `list(repo: RepositoryRef, filter: ListFilter \| undefined, ctx: OpContext): Promise<OpResult<Issue[]>>`（`:111`） | `OpResult<Issue[]>`（`results.ts:47`） |
| 3 | `operations-catalog.ts:65` | `get` | 操作 | `get(repo, key: string, opts: GetOpts \| undefined, ctx): Promise<OpResult<Issue>>`（`:131`） | `OpResult<Issue>` |
| 4 | `operations-catalog.ts:66` | `getDependencies` | 操作 | `getDependencies(repo, key, opts: DepsOpts \| undefined, ctx): Promise<OpResult<Dependencies>>`（`:137-142`） | `Dependencies { blockedBy: IssueRef[]; blocking: IssueRef[] }`（`results.ts:114-118`） |
| 5 | `operations-catalog.ts:67` | `create` | 操作 | `create(repo, input: CreateInput, ctx): Promise<OpResult<Issue>>`（`:145`） | `OpResult<Issue>` |
| 6 | `operations-catalog.ts:68` | `close` | 操作 | `close(repo, key, opts: CloseOpts \| undefined, ctx): Promise<OpResult<Issue>>`（`:148`） | `OpResult<Issue>` |
| 7 | `operations-catalog.ts:69` | `reopen` | 操作 | `reopen(repo, key, ctx): Promise<OpResult<Issue>>`（`:151`） | `OpResult<Issue>` |
| 8 | `operations-catalog.ts:70` | `comment` | 操作 | `comment(repo, key, body: string, ctx): Promise<OpResult<Comment>>`（`:154`） | `OpResult<Comment>` |
| 9 | `operations-catalog.ts:71` | `update` | 操作 | `update(repo, key, patch: UpdatePatch, ctx): Promise<OpResult<Issue>>`（`:157`） | `OpResult<Issue>` |
| 10 | `operations-catalog.ts:72` | `setLabels` | 操作 | `setLabels(repo, key, labels: LabelInput[], opts: SetOpts \| undefined, ctx): Promise<OpResult<Issue>>`（`:160-166`） | `OpResult<Issue>` |
| 11 | `operations-catalog.ts:73` | `setAssignees` | 操作 | `setAssignees(repo, key, assignees: AssigneeInput[], opts: SetOpts \| undefined, ctx): Promise<OpResult<Issue>>`（`:169-175`） | `OpResult<Issue>` |
| 12 | `operations-catalog.ts:74` | `setParent` | 操作 | `setParent(repo, key, parentKey: string \| null, opts: SetOpts \| undefined, ctx): Promise<OpResult<Issue>>`（`:178-184`） | `OpResult<Issue>` |
| 13 | `operations-catalog.ts:75` | `setBlockedBy` | 操作 | `setBlockedBy(repo, key, blockers: string[], opts: SetOpts \| undefined, ctx): Promise<OpResult<Issue>>`（`:191-197`） | `OpResult<Issue>` |
| 14 | `operations-catalog.ts:76` | `getCurrentUser` | 操作 | `getCurrentUser(repo, ctx): Promise<OpResult<Actor>>`（`:204`） | `OpResult<Actor>` |
| 15 | `operations-catalog.ts:77` | `initProject` | 操作 | `initProject(handle: RepoHandle, input: InitProjectInput, ctx): Promise<OpResult<RepositoryRef>>`（`:210-214`） | `OpResult<RepositoryRef>` |
| 16 | `operations-catalog.ts:78` | `listLabels` | 操作 | `listLabels(repo, ctx): Promise<OpResult<LabelColor[]>>`（`:221`） | `OpResult<LabelColor[]>` |
| 17 | `operations-catalog.ts:79` | `setLabelColors` | 操作 | `setLabelColors(repo, changes: LabelColorChange[], ctx): Promise<OpResult<LabelColorBatchResult>>`（`:228-232`） | `LabelColorBatchResult { applied[]; failed[] }`（`results.ts:156-159`） |
| 18 | `operations-catalog.ts:80` | `counts` | 操作 | `counts(repo, filter: ListFilter \| undefined, ctx): Promise<OpResult<Counts>>`（`:117`） | `Counts { open; closed; total }`（`results.ts:126-130`） |
| 19 | `operations-catalog.ts:81` | `listPage` | 操作 | `listPage(repo, filter, opts: PageOpts \| undefined, ctx): Promise<OpResult<PageResult>>`（`:123-128`） | `PageResult { items; nextCursor: string \| null; total }`（`results.ts:137-144`） |
| 20 | `operations-catalog.ts:84` | `getRepoPermissions` | 操作 | `getRepoPermissions(repo, ctx): Promise<OpResult<RepoPermissions>>`（`:241`） | `RepoPermissions { push: boolean; triage: boolean }`（`results.ts:101-106`） |
| 21 | `operations-catalog.ts:85` | `listSubIssues` | 操作 | `listSubIssues(repo, mapKey: string, opts: Record<string, never> \| undefined, ctx): Promise<OpResult<SubIssueList>>`（`:254-259`） | `SubIssueList { items, total, fetched, capped, missing, dropped }`（`results.ts:172-185`） |
| 22 | `operations-catalog.ts:86` | `ensureLabelColorsFile` | 操作 | `ensureLabelColorsFile(repo, ctx): Promise<OpResult<LabelColorsFilePlacement>>`（`:270`） | `LabelColorsFilePlacement { placed; reason; from? }`（`results.ts:196-200`） |
| 23 | `operations-catalog.ts:103` | `getRepoKey` | 定位口 | `getRepoKey(cwd: string, ctx: OpContext): Promise<{ owner: string; name: string } \| null>`（`:283`） | 名字或 `null` |
| 24 | `operations-catalog.ts:104` | `describe` | 定位口 | `describe(handle: RepoHandle, backendId?: BackendId): RepositoryRef`（`:289`，同步） | `RepositoryRef` |
| 25 | `operations-catalog.ts:105` | `issueAddress` | 定位口 | `issueAddress(ref: RepositoryRef, key: string): string`（`:292`，同步） | 地址字符串（算不出回空串） |

入参形状（`inputs.ts`）：`ListFilter`（`:29-49`，`state` 在计数与分页上「认不出就当两种状态都要」）、`GetOpts`（`:52-55`）、`PageOpts`（`:137-142`，缺省 50、上限 200）、`SetOpts`（`:121-123`）、`LabelInput` = `string | { name; color?; description? }`（`:129`）、`AssigneeInput` = `string | { login; kind?; name?; avatarUrl? }`（`:132-134`）、`CreateInput`（`:64-83`）、`UpdatePatch`（`:109-114`）、`InitProjectInput`（`:92-97`）。

---

## 二、装配：每条能力实际接到哪个函数

装配在 `src/tracker/rooms/github/backend.ts` 的 `createGithubBackend(ctx)`（`:77`），返回的那个对象字面量从 `:80` 到 `:158`，一共 **25 个成员 = 24 条能力 + `id`**（本文字面数过：`id`、`preflight`、`list`、`counts`、`listPage`、`listSubIssues`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`listLabels`、`setLabelColors`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`describe`、`issueAddress`、`getRepoKey`、`getRepoPermissions`）。房间模块 `src/tracker/rooms/github/index.ts:197-233` 的 `githubModule.create` 就是它（`:214`）。

| 能力 | 装配行 | 接到谁 | 实现文件在不在本片 13 份里 |
|---|---|---|---|
| `preflight` | `backend.ts:82` | `ghPreflight` | 在（`preflight.ts`） |
| `list` | `backend.ts:83` | `listIssues` | 在（`issues.ts`） |
| `counts` | `backend.ts:85` | `countIssues` | 在（`counts.ts`） |
| `listPage` | `backend.ts:87` | `listIssuesPage` | 在（`page.ts`） |
| `listSubIssues` | `backend.ts:91` | `listSubIssues` | 在（`sub-issues.ts`） |
| `get` | `backend.ts:92` | `getIssue` | 在（`issues.ts`） |
| `getDependencies` | `backend.ts:93` | `getDependencies` | 不在（`graph.ts`）；本片供读侧数据 |
| `create` | `backend.ts:94` | `createIssue` | 不在（`issues-write.ts`） |
| `close` | `backend.ts:95` | `closeIssue` | 不在（`issues-write.ts`） |
| `reopen` | `backend.ts:96` | `reopenIssue` | 不在（`issues-write.ts`） |
| `comment` | `backend.ts:97` | `addComment` | 不在（`comments.ts`） |
| `update` | `backend.ts:98` | `updateIssue` | 不在（`issues-write.ts`） |
| `setLabels` | `backend.ts:99` | `setLabels` | 在（`labels.ts`） |
| `listLabels` | `backend.ts:101` | `listLabels` | 不在（`label-colors-ops.ts`） |
| `setLabelColors` | `backend.ts:102` | `setLabelColors` | 不在（`label-colors-ops.ts`）；本片供失败归因 |
| `setAssignees` | `backend.ts:103` | `setAssignees` | 不在（`issues-write.ts`） |
| `setParent` | `backend.ts:104` | `setParent` | 不在（`graph.ts`）；本片供读侧数据 |
| `setBlockedBy` | `backend.ts:105` | `setBlockedBy` | 不在（`graph.ts`）；本片供读侧数据 |
| `getCurrentUser` | `backend.ts:106-133` | 工厂内联（`gh api user`） | 不在（内联）；走本片的 `client.ts` |
| `initProject` | `backend.ts:136` | `initProject` | 不在（`init-project.ts`） |
| `describe` | `backend.ts:137` | `describe` | 在（`repo.ts`） |
| `issueAddress` | `backend.ts:138` | `issueAddress` | 在（`repo.ts`） |
| `getRepoKey` | `backend.ts:142` | `getRepoKey` | 在（`repo.ts`） |
| `getRepoPermissions` | `backend.ts:147-157` | 内联壳 + `readRepoPermissions` | 在（`repo-permissions.ts`） |
| `ensureLabelColorsFile` | **没有这一行** | 注册表补桩 | 不在（全房间没有实现，见第 4.1 节） |

「少写一条」与「多带一条」都不是靠人眼看的：三条编译期断言收在 `src/tracker/capability-assertions.ts`——完整（`:91-92`）、名录与 `Tracker` 同集（`:40-42`）、不多带契约之外的成员（`:103-105`）；GitHub 登记的那一套成员集合在 `capability-assertions.ts:48-56`，文件头第 48 行明写「GitHub：24 条能力 + id（缺的只有 `ensureLabelColorsFile`，由注册表补桩）」。

---

## 三、逐条判定

先给结论表（25 行），再给本片实现的那几条的明细。**本片**指 #1052 点名的 13 份：`queries.ts`、`issues.ts`、`counts.ts`、`page.ts`、`labels.ts`、`preflight.ts`、`checks.ts`、`client.ts`、`sub-issues.ts`、`normalize.ts`、`repo-permissions.ts`、`fallback-reason.ts`、`repo.ts`。

| 能力 | 结论 | 本片落点（文件:行） | 一句判据 |
|---|---|---|---|
| `preflight` | 实现 | `preflight.ts:51-119` | 三项门禁：`platform.resolveExecutable('gh')`（`:58-67`）、`gh auth status`（`:77`）、`gh api repos/{o}/{n}`（`:109`） |
| `list` | 实现 | `issues.ts:152-264`（+`queries.ts:33-40`、`normalize.ts:286`、`fallback-reason.ts:57-72`） | `gh api graphql` 跑 `LIST_QUERY` 翻页取票（`:168-193`），失败降 REST `gh api repos/{o}/{n}/issues?state=all&per_page=100&page=k`（`:90-116`） |
| `get` | 实现 | `issues.ts:269-368`（+`queries.ts:43-47/213-217`） | `GET_QUERY` 取票（`:281`），不中再查拉取请求（`:307`），再降 REST `/issues/{n}`（`:327`）与 `/pulls/{n}`（`:338`） |
| `getDependencies` | 实现 | 不在本片（`graph.ts`）；本片供数据 `queries.ts:29`、`normalize.ts:177-200` | 装配在 `backend.ts:93`；`blockedBy` 边由 `ISSUE_FRAGMENT` 抓、由 `normalizeBlockedBy` 归一 |
| `create` | 实现 | 不在本片（`issues-write.ts`）；读回经 `normalize.ts:286` | 装配在 `backend.ts:94`；`issues-write.ts:17` 引 `normalize.js` |
| `close` | 实现 | 不在本片（`issues-write.ts`） | 装配在 `backend.ts:95` |
| `reopen` | 实现 | 不在本片（`issues-write.ts`） | 装配在 `backend.ts:96` |
| `comment` | 实现 | 不在本片（`comments.ts`） | 装配在 `backend.ts:97` |
| `update` | 实现 | 不在本片（`issues-write.ts`） | 装配在 `backend.ts:98` |
| `setLabels` | 实现 | `labels.ts:105-165` | 先读现状做 diff（`:127-132`），再逐条 `gh issue edit --remove-label/--add-label`（`:136`/`:140`） |
| `setAssignees` | 实现 | 不在本片（`issues-write.ts`） | 装配在 `backend.ts:103` |
| `setParent` | 实现 | 不在本片（`graph.ts`）；本片供数据 `queries.ts:28`、`normalize.ts:115-125` | 装配在 `backend.ts:104`；`parent{number}` 由片段抓、归一出 `parentKey` |
| `setBlockedBy` | 实现 | 不在本片（`graph.ts`）；本片供数据 `queries.ts:29`、`normalize.ts:177-200` | 装配在 `backend.ts:105` |
| `getCurrentUser` | 实现 | 不在本片（`backend.ts:106-133` 内联）；走本片 `client.ts:206` 的 `execGh` | `gh api user --jq '{login, name, avatarUrl}'`（`backend.ts:108`） |
| `initProject` | 实现 | 不在本片（`init-project.ts`） | 装配在 `backend.ts:136`（结果形状处有 `as unknown as` 断言，见 `:134-135` 的理由） |
| `listLabels` | 实现 | 不在本片（`label-colors-ops.ts`） | 装配在 `backend.ts:101` |
| `setLabelColors` | 实现 | 不在本片（`label-colors-ops.ts`）；本片供 404 归因 `repo-permissions.ts:52` | 装配在 `backend.ts:102`；改色链的 `explain404` 在 `label-colors-ops.ts:328` 调 `readRepoPermissions` |
| `counts` | 实现（完整，不是部分实现） | `counts.ts:71-119` | 一次 GraphQL 取 `openIssues/closedIssues` 的 `totalCount`（`counts.ts:79-86`、`queries.ts:56-69`）；判据见第 4.1 节 |
| `listPage` | 实现 | `page.ts:108-183` | `gh api graphql` 跑 `LIST_PAGE_QUERY`（`:118-128`），创建时间倒序、`totalCount` 与 `nodes` 同连接（`queries.ts:100-108`） |
| `getRepoPermissions` | 实现 | `repo-permissions.ts:52-91` + `backend.ts:147-157` | `gh api repos/{owner}/{name} --jq .permissions`（`repo-permissions.ts:81`），只读取 `push`/`triage` 两个布尔（`:31-42`） |
| `listSubIssues` | 实现 | `sub-issues.ts:47-118` | `gh api graphql` 跑 `SUB_ISSUES_QUERY` 按父票往下翻页（`:63`），每页 100、硬上限 1000（`:35-36`） |
| `ensureLabelColorsFile` | 今天不支持（注册表补桩）；「未来是否开发」两处口径不一致，见第 5.2 节 | 本片没有落点 | 全房间 grep 无实现；`capability-assertions.ts:48` 明说只缺它；桩见 `registry/shape.ts:73-78` |
| `getRepoKey` | 实现 | `repo.ts:105-168` | 三层兜底：`git -C cwd remote get-url origin`（`:117`）→ 读 `.git/config`（`:138-153`）→ `gh repo view --json nameWithOwner -q .nameWithOwner`（`:159`） |
| `describe` | 实现 | `repo.ts:39-53` | 同步纯函数：`refId` 有 `owner/name` 就拼 `https://github.com/{refId}`（`:51`），否则退回 cwd 目录名 |
| `issueAddress` | 实现 | `repo.ts:58-62` | 拼 `https://github.com/{refId}/issues/{key}`；`refId` 为空回空串（`:60`） |

### 3.1 本片实现的能力，明细与判据

**`preflight`（`preflight.ts:51-119`）。** 函数 `ghPreflight(handle, ctx)`，只判环境、按顺序三项：
1. gh 可执行：`platform.resolveExecutable('gh')`，拿不到就回 `env` 档（`:58-67`）；
2. 登录态：`gh auth status`（`:77`），非 0 就把 client 层归一好的失败原样交出去（`:81`）；
3. 仓库可达：`refId` 优先 `handle.refId`、其次 `ctx.refId`（`:27-32`）；没有就 `gh repo view --json nameWithOwner -q .nameWithOwner`（`:94`）；最后 `gh api repos/{owner}/{name}`（`:109`）。
成功回 `{ ok: true }`（`:114`）。契约对它的要求在 `operations.ts:101-108`（只判环境、不预判能力），返回形状在 `results.ts:56-60`；合规性判断见第 4.3 节。`checks.ts:15-48` 那 4 条检查项（`gh:remote`/`gh:installed`/`gh:authed`/`gh:repoAccess`）是界面与链快照读的**检查目录**，不是能力位，每项的 `origin` 分别指到 `preflight.js:1`（`:30`）、`:2`（`:38`）、`:3`（`:46`）。

**`list`（`issues.ts:152-264`）。** 函数 `listIssues(repo, filter, ctx)`：
- 主路：`gh api graphql -f query=LIST_QUERY -F owner -F name -F first=100 [-F after]` 逐页取（`:168-193`），`after` 来自 `pageInfo.endCursor`（`:189`），代码里写着 500 条安全上限（`:192`）；
- 拉取请求走同一池：再跑 `LIST_PR_QUERY`（`:199-219`，上限 1000 条，`:218`），两类节点都过 `normalizeIssue`（`:186`/`:213`），归一失败的条数聚合成 `error.normalize` 调试事件（`:60-65`、`:222-223`）；
- GraphQL 任一步失败（退出码非 0 / JSON 坏 / 有 `errors` / 缺 `data.repository` / 缺 `issues.nodes`）就置 `needRest`（`:175-183`），降级到 REST：`fetchAllIssuesREST` 逐页 `gh api repos/{o}/{n}/issues?state=all&per_page=100&page=k`，最多 10 页（`:90-116`），再补拉取请求、修复树边（`:234-238`），成功时在返回值上多带 `fallback: 'rest'` 与 `fallbackReason`（`:254`，理由见 `:247-253`）；
- 过滤在内存完成：`applyIssueFilter` 认 `state`/`type`/`parentKey`/`keys`/`isPullRequest`（`:121-145`）。
降级原因的细分在 `fallback-reason.ts:57-72`（`timeout`/`rate-limit`/`ghe-host`/`graphql-error` 四档）。查询与片段在 `queries.ts:33-40`（`LIST_QUERY`）、`:14-30`（`ISSUE_FRAGMENT`）。

**`get`（`issues.ts:269-368`）。** 函数 `getIssue(repo, key, opts, ctx)`：key 必须是数字，否则 `parse` 失败（`:275-277`）；先 `GET_QUERY` 查工单（`:281`）；查不到再 `GET_PR_QUERY` 查拉取请求（`:307`）；两者都不中就走 REST `gh api repos/{o}/{n}/issues/{num}`（`:327`），仍不中再试 `gh api repos/{o}/{n}/pulls/{num}`（`:338`）；`opts.comments.first` 只做截断（`:317-319`、`:357-359`，注释里写明「契约允许宿主侧分页」）。

**`counts`（`counts.ts:71-119`）。** 见第 4.1 节，判据全文在那里。

**`listPage`（`page.ts:108-183`）。** `gh api graphql` 跑 `LIST_PAGE_QUERY`（有标签筛时用 `LIST_PAGE_QUERY_WITH_LABELS`，`:120`），查询里排序键写死 `orderBy:{field:CREATED_AT, direction:DESC}`（`queries.ts:102`）、`totalCount` 与 `nodes` 取自同一连接（`queries.ts:103-105`）；`limit` 缺省 50、上限 200、不合法按缺省（`page.ts:37-46`）；`cursor` 省略/空串算第一页（`:49-54`）；`filter` 只认 `state` 与 `labels`，其余忽略（`:57-80`、`:98-99`）；游标失效单独认得出，回 `not-found` 并明说「请重新加载」（`:142-145`）；`hasNextPage` 为真却没有 `endCursor` 时宁可失败（`:168-173`）；`nextCursor` 没有下一页给 `null`（`:167`、`:174`），与 `results.ts:140-141` 一致。

**`setLabels`（`labels.ts:105-165`）。** 入参先归一并去重（`:34-64`）；`opts.expectedUpdatedAt` 不匹配就回 `conflict`（`:116-123`）；读现状做 diff（`:127-132`）；逐条 `gh issue edit {key} --repo {owner}/{name} --remove-label {n}`（`:136`）与 `--add-label {n}`（`:140`）；写失败时走 `attributeLabelFailure`（`:88-99`）——404/权限句命中就问一次仓库权限，只有 `triage === false` 才改判成 `auth` 档并给人话（`:93-97`，话术来自 `repo-permissions.ts:98-103`）；写成功后读回最新票、把 `labels` 覆盖成归一后的目标集（`:144-155`），读不回来时给乐观回落（`:148-151`）。

**`getRepoPermissions`（`repo-permissions.ts:52-91` + `backend.ts:147-157`）。** 核心是 `gh api repos/{spec} --jq .permissions`（`repo-permissions.ts:81`），只认 `push`/`triage` 两格是不是布尔（`:31-42`），缺字段/解析失败/命令失败一律回 `null`（`:82`、`:85`、`:87-90`），调用方按「未知」处理。`backend.ts` 那层壳负责两件本地判断：`refId` 缺 `owner/name` 回 `not-found`（`:153`）；`readRepoPermissions` 回 `null` 回 `network` 并明说按未知处理（`:155`）。批内复用位（`Map<string, Promise<...>>`）在 `:29`、`:55-71`，今天有两个调用方：`label-colors-ops.ts:328`（改色链的 404 归因）与 `labels.ts:93`（打标签的 404 归因）。

**`listSubIssues`（`sub-issues.ts:47-118`）。** 逐页 `gh api graphql -f query=SUB_ISSUES_QUERY -F owner -F name -F number -F first=100 [-F after]`（`:63-65`），每页 100 张（`:35`）、硬上限 1000 张（`:36`）；任何一页失败先按原样重试一次、第二次才如实报错（`:69-72`，理由：这台机器上 `api.github.com/graphql` 的 POST 偶发 `unexpected EOF`）；`hasNextPage` 为真才用 `endCursor` 继续（`:103-106`）；归一失败的行进 `dropped` 不计入 `fetched`（`:97-99`）；到上限回 `capped: true` 并停（`:101`）；`missing` 只算「没被上限卡住却与 `totalCount` 对不上」的差额（`:110`）；`total` 拿不到时退化成拉到的张数（`:111`，注释在 `:93-96`）。注释里的过期之处见第 4.2 节。

**`getRepoKey` / `describe` / `issueAddress`（`repo.ts`）。** `getRepoKey(cwd, ctx)`（`:105-168`）三层兜底，每层成功各记一行 `repo.resolve.tier`（`:97-103`、`:120`/`:130`/`:145`/`:151`/`:163`），全挂记 `tier 3, ok:false` 后回 `null`（`:166-167`）。`describe(handle, backendId)`（`:39-53`）是同步纯函数，`refId` 或 cwd 目录名出一个 `RepositoryRef`。`issueAddress(ref, key)`（`:58-62`）拼网页地址。这三个之外，同一文件还挂着模块级只读 view：`repoSearchAddress`（`:64-66`）、`issueRefPattern`（`:68`）、`links`（`:72-77`）、`capabilities`（`:84`）、`openRepository`（`:86`）——它们**不是** 25 条能力，而是给界面与注册表用的链接/能力位数据（`index.ts:217-229` 把它们摆在模块对象上，注册表按名字转发，见 `src/tracker/registry/views.ts:114-137`）。

### 3.2 本片不实现、但本片是它们基础设施的部分

有几份文件一条能力都不「拥有」，却是上面多条能力的共用底座，判定时不能漏：

- **`client.ts`（`ghClient`，`:135-399`）**：唯一的 gh 执行器。`execGh`（`:206-363`）负责超时（读 12 秒 / 写 30 秒 / 探活 3 秒的分档，`:212`、`:259`）、出站名额排队（`:264`）、退出码判失败（拿不到整数退出码按 -1，`:303-307`）、错误判档只走 `error-rules.ts` 那张表（`:322`、`:345`）、常驻日志 `gh.exec`/`gh.timeout`/`gh.resolve.fail`（`:185-197`）。凡走 gh 的能力都经它：`preflight`、`list`、`get`、`counts`、`listPage`、`listSubIssues`、`setLabels`、`getRepoPermissions`、`getRepoKey` 第三层、`getCurrentUser`（`backend.ts:107`）以及不在本片的写路径与改色。
- **`queries.ts`**：`LIST_QUERY`（`:33`）、`GET_QUERY`（`:43`）、`COUNTS_QUERY`/`COUNTS_QUERY_WITH_LABELS`（`:56`/`:64`）、`PAGE_ISSUE_FRAGMENT` 与两条分页查询（`:81`/`:100`/`:111`）、`SUB_ISSUE_FRAGMENT`/`SUB_ISSUES_QUERY`（`:127`/`:148`），外加拉取请求用的 `PULL_REQUEST_FRAGMENT`/`LIST_PR_QUERY`/`GET_PR_QUERY`（`:180`/`:203`/`:213`）——`list` 与 `get` 的同池合并靠后三条。
- **`normalize.ts`（`normalizeIssue`，`:286-340`）**：GitHub 原始形状（GraphQL 与 REST 两套字段名）→ 契约 `Issue` 的唯一出口，被 `issues.ts:18`、`page.ts:31`、`sub-issues.ts:29`、`labels.ts:21`、`graph.ts:22`、`issues-write.ts:17` 六处引用。不变量写在文件头 `:7-12`：`key = String(number)` 且永不产出 `number`、`parentKey` 核心字段永远存在、`labels/assignees/comments/blockedBy` 恒 EMPTY、拉取请求三字段恒给（`:335-337`）。
- **`fallback-reason.ts`**：只服务 `list` 与 `get` 的 REST 降级原因（`issues.ts:25`、`:231`、`:326`），四档取值 `FallbackReason`（`:55`）。
- **`checks.ts`**：4 条环境检查项的目录（`:15-48`），`checks()` 回只读副本（`:53-55`）。它不对应 25 条里的任何一条；它是「环境检查」那一屏与链快照的数据，与 `preflight` 同源但不同物（每项 `origin` 指到 `preflight.ts` 的第 1/2/3 项）。

---

## 四、三个容易糊过去的问题

### 4.1 `counts` 算「实现」还是「部分实现」——按契约原文判：是**完整实现**

契约对这条的原话（`operations.ts:113-117`）：

> 数票：这个后端里符合条件的有多少张。
> 只回数字不回行；只数工单不含拉取请求；拿不全就整体失败，**不许猜一个数**。

返回形状那一段再补一句口径（`results.ts:120-130`）：三个数都必须是非负整数，任何一个拿不到就整体失败。

拿这四句逐条对 `counts.ts`：

1. **只回数字不回行**——`counts.ts:112` 只回 `{ open, closed, total }`，查询本身也只取 `totalCount`（`queries.ts:56-61`），没有 `nodes`。
2. **只数工单不含拉取请求**——走的是 `issues` 连接（`queries.ts:58-59`），文件头 `:10` 写明「issues 连接天然不含拉取请求，正合契约的只数工单（REST 的 `open_issues_count` 把拉取请求也算在内）」。
3. **拿不全就整体失败**——GraphQL 命令失败直接交回失败（`counts.ts:87`）；JSON 坏、缺 `repository`、`totalCount` 不是非负整数，各回一条 `parse` 失败（`:93`、`:104`、`:107-108`），最后一条的原话就是「refusing to guess a number」。
4. **不许猜一个数**——`countOf` 只接受有限、非负、整数的 `totalCount`，其余一律当没拿到（`:57-62`）。

那「不做 REST 兜底」（`:13-16` 写的两条理由）算不算缺口？**不算**。契约给 `counts` 的能力上限就是「一次准数」，它没有要求第二条通道，反而明确要求「拿不全就整体失败」——兜到一条不准的口子上，产出的正是一个「看着像数、其实不对」的数字，那才是违反契约。`counts.ts:14-16` 给的正是这个理由：REST 没有同样准的计数口（`search` 有 1000 条上限、`open_issues_count` 混算拉取请求）。

所以这张票上的答案写 **「实现」**，并在依据里带一句「不做 REST 兜底是契约允许的选择，不是缺口」。若写成「部分实现」，会让人以为这条能力今天有已知的取不到的数，与事实相反。

另外两点顺手核过，也支持「完整实现」：`filter` 只认 `state` 与 `labels`（`:34-55`、`:110-111`），与 `inputs.ts:32-42` 的口径一致（计数认不出 `state` 取值时当两种都要、`labels` 必须同时带上）；`total` 由同一份查询里的两个数相加（`:112`），文件头 `:11` 说明这样不会出现「两个时刻凑出来的总数」。

### 4.2 `listSubIssues` 的过期注释——确认过期，名录在第 21 条

`sub-issues.ts:12-14` 今天仍写着：

> 名字为什么不进契约的 OPERATIONS：它是读路径的实现细节，与 `snapshotFast` 同一条豁免（见 tracker/contract.js 的「非 op 旁路豁免」）。

这句话**已经不成立**，三处证据：

1. **它今天就在名录里，是第 21 条**：`src/tracker/contract/operations-catalog.ts:85` 的 `'listSubIssues'`。按数组从第 63 行开始数（`operations-catalog.ts:63-86`），它是第 21 个名字，之后只剩 `ensureLabelColorsFile`（`:86`）。
2. **契约自己记录了这次反转**：`operations.ts:79-80`——「为什么 `listSubIssues` 在名录里：它原先被当作『读路径的实现细节』，但它的读者在房外（宿主电话 `src/host/mapTickets.js`），房外有读者就说明它不是细节，只能进名录」。房外读者确实在：`src/host/mapTickets.js:9`、`:69`、`:76` 调 `tracker.listSubIssues`。
3. **装配处的注释是新的**：`backend.ts:88-90` 写着「2026-10-14 起它是契约操作（`Tracker.listSubIssues`）：原先按『读路径的实现细节』豁免在外，但它的调用者是宿主电话 `wf.mapTickets`——房外有读者，它就不是某家的细节」。

同一条注释里的另外两句仍然成立，改注释时别一起删掉：「没实现它的后端由电话按 unsupported 退化」（今天的实现：`src/host/mapTickets.js:69` 判 `typeof tracker.listSubIssues !== 'function'` 就回 unsupported；`markdown/index.ts:206` 也明回 `unsupported`）与「不做能力表（G5 红线）」。

顺带：这条注释指的 `tracker/contract.js` 这个文件**已经不存在了**（`src/tracker/contract.js` 与 `src/tracker/contract-page.js` 都已退休，值是 `src/tracker/contract/` 目录）。同一类过期路径还有两处，见第 5.3 节。

### 4.3 `preflight` 只回 `{ ok: true }`、不带任何能力位——**合规，而且必须这样**

契约对返回形状的定义（`results.ts:56-60`）：

> `export interface PreflightResult { ok: boolean; error?: TrackerError }`
> `ok:false` 时给出原因；`ok:true` 时不写。

契约对这条能力本身的定义（`operations.ts:101-108`）：

> 环境预检：这台机器上这条路现在通不通。只判环境（工具在不在、登录没有、连不连得上、文件系统能不能碰），**不预判能力**（「能不能建票」不在这里回答，那是 create 自己的事）。

拿这两段判 `preflight.ts:114` 的 `return { ok: true }`：形状上 `ok:true` 不写 `error`，与 `results.ts:58-59` 一字不差；语义上它恰好只回答三项环境判定（`:58-67`、`:77`、`:109`），没有一项是能力。文件头 `:8` 还留着一句更硬的话：「不检查：labels/subIssue/depGraph 等能力；不返回 capabilities 布尔表（旧 BackendStatus 已删）」。

所以这不是「合规但缺东西」，而是**方向相反的一条要求**：预检里出现能力位才是违约。想知道某条能力能不能用，办法是调它一次、看回 `ok` 还是 `unsupported`（`operations.ts:30-31`：能力是事后的事实，这里没有 `supportedOps` 之类的清单，将来也不许加）。界面那边的环境检查行不由 `preflight` 的返回值供给，而由 `checks.ts:15-48` 那份检查目录供给，两件事本来就分着。

---

## 五、与 `docs/tracker/capability-github.md` 的逐条对照

对照对象是 #1147 预交付的登记表 `docs/tracker/capability-github.md`（44 行）。结论：**25 条里 24 条一致（含「实现」与「不支持」两类事实都对）、1 条（`ensureLabelColorsFile`）的分类口径需要拍板**；另有 1 处表头措辞要修（不属于 25 条里的任何一条，见 5.2 第 2 处）。

### 5.1 一致的（23 条 + 表头结构）

- 表把「操作（22 条中提供 21 条）」与「定位口（3 条全部提供）」分开列（`capability-github.md:7`、`:34`），与 `operations-catalog.ts` 的两段结构一致。
- 操作表 21 行「明确提供功能」逐条核过实现，与本文第三节逐条判定**全部一致**（`capability-github.md:11-31`）。举三处最容易被写错的：`getRepoPermissions` 表里写 `repo-permissions.ts`（`:30`）——对，核心命令在那里（`repo-permissions.ts:81`），外壳在 `backend.ts:147-157`；`listSubIssues` 表里写 `sub-issues.ts` 且「宿主电话 `wf.mapTickets` 在用」（`:31`）——对，调用点在 `src/host/mapTickets.js:76`；`getRepoKey` 表里写「三层兜底：git remote → 配置 → gh 视图」（`:38`）——对，三层分别在 `repo.ts:117`、`:138-153`、`:159`。
- 表头第 5 行说「缺的那条由注册表按名录自动补桩（`src/tracker/registry/shape.ts`）」——对，桩在 `shape.ts:73-78`，装配处 `shape.ts:105` 只对 `OPERATIONS` 里的名字补。
- 表头第 5 行说「实现真源：`backend.ts`（工厂 24 个成员）+ 各实现文件」——「24 条能力」这个数对，但「24 个成员」这个说法不严谨（见 5.2 第 2 条）。

### 5.2 不一致 / 需要有人拍板的（2 处）

**第 1 处（分类口径）：`ensureLabelColorsFile` 是「当前不支持、未来会开发」还是「明确不支持」。**

- 表里写什么：`capability-github.md:32` 登记为「**当前不支持、未来会开发**」，理由栏写「今天只有 Markdown 实现（往工作区放默认配色文件）；语义是本地放文件、与远端无关，GitHub 工作区同样用得上，今天没排期」。按该表自己的登记口径（`:3`）：「明确不支持——形态不合、永远不会有；当前不支持、未来会开发——说得通、今天没做」。
- 实现是什么：**今天确实没有实现**，这一条没有分歧。三处证据：全房间 grep `ensureLabelColorsFile` 无任何实现（全仓 18 处命中里，唯一实现是 `src/tracker/rooms/markdown/index.ts:198`，唯一调用方是 `src/host/workspaceCwd.js:50-55`）；`capability-assertions.ts:48` 明写「GitHub：24 条能力 + id（缺的只有 `ensureLabelColorsFile`，由注册表补桩）」；`backend.ts` 的返回对象里没有这一格（`:80-158`），编译器靠 `satisfies GithubBackendShape`（`:158`）拦着它多写。今天调用方拿到的是注册表补的诚实 `unsupported`（`registry/shape.ts:78`）。
- 分歧在哪：**契约注释给的理由是「形态不合」，不是「没排期」**。`operations.ts:261-270` 写：「本地 Markdown 后端实现它（颜色存在工作区文件里）；GitHub 后端回 `unsupported` —— 它的标签颜色存在仓库标签上，没有本地文件可放。」按表的定义，「形态不合、永远不会有」恰好是「明确不支持」那一档，而表却把它记成「未来会开发」。
- 谁该改：需要人拍板，二选一。若按契约注释的理由（GitHub 的颜色住在仓库标签上、没有本地文件可放），表应改成「**明确不支持**」，`capability-github.md:32` 的理由栏也要跟着改；若真的打算以后给 GitHub 工作区也放一份本地配色文件（表里「GitHub 工作区同样用得上」就是这个意思），那要改的是 `operations.ts:266` 那句理由——不能一边说「没有本地文件可放」，一边在表里记「未来会开发」。改动要连同 `capability-assertions.ts:48-56` 的登记集合一起提交（该文件头 `:20-22` 定的规矩）。

**第 2 处（措辞，不算判定错误）：表头「工厂 24 个成员」。**

- 表里写什么：`capability-github.md:5` 写「实现真源：`src/tracker/rooms/github/backend.ts`（工厂 24 个成员）」。
- 实现是什么：工厂实际交 **25 个键**（本节按顶层键数过，也见第二节的清单）：24 条能力 + `id`。`id` 是身份不是能力，不进名录（`capability-assertions.ts:39` 的注释、`operations-catalog.ts:24` 的「两段名字合起来就是 `CAPABILITIES`——`Tracker` 接口的全部 25 个成员」，注意 `Tracker` 的 25 个成员里也含 `id`：`operations.ts:99` 的 `readonly id`）。所以「24 条能力」对，「24 个成员」少算了 `id`。
- 谁该改：表本身，把「工厂 24 个成员」改成「工厂 24 条能力 + `id`」，与 `capability-assertions.ts:48` 的写法对齐。

### 5.3 顺带发现的过期引用（不影响任何一条判定，但会误导后来读代码的人）

1. `sub-issues.ts:12-14`：说 `listSubIssues` 不进契约的 `OPERATIONS`，且指 `tracker/contract.js` 的「非 op 旁路豁免」。**两处都过期**（详见第 4.2 节）。
2. `counts.ts:2`：指 `tracker/contract.js` 的「计数契约」。该文件已不存在（今天是 `src/tracker/contract/` 目录，计数口径在 `operations.ts:113-117` 与 `results.ts:120-130`）。
3. `page.ts:2`：指 `tracker/contract-page.js` 的「分页契约」。该文件已不存在，今天是 `src/tracker/contract/contract-page.ts`。
4. 两份逐字相同的仓库名拆解：`issues.ts:67-80` 与 `labels.ts:66-79` 各有一份 `parseRepo`/`repoId`。`counts.ts:30`、`page.ts:33`、`sub-issues.ts:32` 都从 `issues.js` 取，`labels.ts:12` 的注释说本文件「只保留了它们要用的仓库名拆解」。behavior 相同，但两处改一处会静默不一致——留给后续清理，不是本片验收项。

---

## 六、这 13 份文件各自在哪些能力上出现（索引）

| 文件 | 它「拥有」的能力 | 它还参与的能力 / 别的角色 |
|---|---|---|
| `queries.ts` | 无（它是数据） | `list`（`:33`）、`get`（`:43`/`:213`）、`counts`（`:56`/`:64`）、`listPage`（`:100`/`:111`）、`listSubIssues`（`:148`）；另供 `getDependencies`/`setParent`/`setBlockedBy` 读侧边（`:28`/`:29`） |
| `issues.ts` | `list`（`:152`）、`get`（`:269`） | 导出 `parseRepo`/`repoId`（`:67-80`）给 `counts.ts`/`page.ts`/`sub-issues.ts` 用 |
| `counts.ts` | `counts`（`:71`） | 无 |
| `page.ts` | `listPage`（`:108`） | 无 |
| `labels.ts` | `setLabels`（`:105`） | 自带一份 `parseRepo`/`repoId`（`:66-79`）；`setLabels` 的 404 归因接 `repo-permissions.ts` |
| `preflight.ts` | `preflight`（`:51`） | `checks.ts` 的 4 条检查项各自把 `origin` 指到这里 |
| `checks.ts` | 无（不是 25 条之一） | 环境检查目录（`:15-48`），供检查页与链快照 |
| `client.ts` | 无（它是执行器） | 凡走 gh 的能力都经它：`preflight`/`list`/`get`/`counts`/`listPage`/`listSubIssues`/`setLabels`/`getRepoPermissions`/`getRepoKey`，以及不在本片的写路径、改色、`getCurrentUser`、`initProject` |
| `sub-issues.ts` | `listSubIssues`（`:47`） | 无 |
| `normalize.ts` | 无（它是形状出口） | `list`/`get`/`listPage`/`listSubIssues`/`setLabels` 及不在本片的 `graph.ts`、`issues-write.ts` 的读回都过它 |
| `repo-permissions.ts` | `getRepoPermissions`（核心 `:52`） | `setLabels`（`labels.ts:93`）与 `setLabelColors`（`label-colors-ops.ts:328`）的失败归因；`readonlyMessage`（`:98`）是只读仓库的统一说法 |
| `fallback-reason.ts` | 无 | 只服务 `list`/`get` 的 REST 降级原因（`issues.ts:231`/`:326`） |
| `repo.ts` | `getRepoKey`（`:105`）、`describe`（`:39`）、`issueAddress`（`:58`） | 另挂模块级只读 view：`repoSearchAddress`（`:64`）、`issueRefPattern`（`:68`）、`links`（`:72`）、`capabilities`（`:84`）、`openRepository`（`:86`） |

**13 份文件的答案汇总**：25 条能力的归属分三类。**本片直接实现 11 条**：`preflight`（`preflight.ts:51`）、`list`（`issues.ts:152`）、`get`（`issues.ts:269`）、`counts`（`counts.ts:71`）、`listPage`（`page.ts:108`）、`setLabels`（`labels.ts:105`）、`listSubIssues`（`sub-issues.ts:47`）、`getRepoPermissions`（`repo-permissions.ts:52`，另有一层壳在 `backend.ts:147-157`）、`getRepoKey`（`repo.ts:105`）、`describe`（`repo.ts:39`）、`issueAddress`（`repo.ts:58`）。**本片参与、但主实现不在本片 4 条**：`getDependencies`、`setParent`、`setBlockedBy`（三条主实现在 `graph.ts`，本片供 `queries.ts:28-29` 与 `normalize.ts:115-125`/`:177-200` 的读侧数据）、`setLabelColors`（主实现在 `label-colors-ops.ts`，本片供 `repo-permissions.ts:52` 的失败归因）。**其余 10 条既不在本片实现、也与本片无参与关系**：`create`、`close`、`reopen`、`comment`、`update`、`setAssignees`、`listLabels`、`getCurrentUser`、`initProject`、`ensureLabelColorsFile`，各自归属见第二节的装配表。

---

## 七、本文最没把握的几条（自查，供审阅的人先看这里）

1. **`ensureLabelColorsFile` 的「未来会不会开发」**：这是排期问题，读代码读不出来。我只能证明「今天没有实现、今天回 unsupported」，并指出表与契约注释对**分类**的说法冲突（第 5.2 节第 1 处）。要谁拍板：写 `docs/tracker/capability-github.md` 的人与维护 `operations.ts` 注释的人。
2. **`getDependencies` / `setParent` / `setBlockedBy` 的判定**：主实现在 `graph.ts`，不属于本片，我没有逐行读它，本文的「实现」判定依据是装配行（`backend.ts:93`/`:104`/`:105`）加本片供的读侧数据（`queries.ts:28-29`、`normalize.ts:115-125`/`:177-200`）。若验收要求「读路径的本片必须自证这三条」，需要补读 `graph.ts`。
3. **`checks.ts` 要不要算进这张小表**：我按「它不是 25 条里的任何一条」处理（它是环境检查目录）。若 #1052 的验收口径要把检查目录也算作读路径的对外能力，这一节的分类要重做。
4. **表里 `getRepoPermissions` 的「`deck_context` 能力位在用」**：我只核实了本片内的两个调用方（`labels.ts:93`、`label-colors-ops.ts:328`），没有进 `deck_context` 的实现去核实那一处能力位，故第五节没有为这半句背书。
5. **`list` 的 500 条上限（`issues.ts:192`）与拉取请求 1000 条上限（`:218`）**：实现里有硬上限，契约的 `list` 那一段（`operations.ts:110-111`）没有提上限。我没有找到契约对上限的表述，所以没把它算成「表与实现不一致」；如果上层读者依赖「list 一定给全」，这条需要单独立票。
