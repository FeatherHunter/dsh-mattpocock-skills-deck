# 三个后端房间对契约的符合度对照表（2026-10-11，第二批子任务 C）

这份文件回答一个问题：把 `src/host/tracker/contract.js` 里今天用注释写的契约改成 TypeScript `interface`、让两个房间 `implements` 之后，**哪些地方会编译不过、哪些地方要补**。
只读源码所得，每条带文件路径与行号；拿不准的标「未核实」，不猜。契约的 19 个操作名清单见 `src/host/tracker/contract.js:58-74`（亲手数过 19 项）。

读法：第一节是 19 个契约操作逐个对照；第二节是三个非契约面；第三节是两房模块对象的键集差异；第四节是「今天不被校验、改接口后新被编译器要求」的清单；第五节是结论计数。

## 一、19 个契约操作逐个对照

参数个数的读法：契约签名从 `src/host/tracker/contract.js` 的 `@typedef Tracker`（第 32 到 50 行）抄；房内实现从 `createGithubBackend`（`src/host/tracker/backends/github/backend.js:66-138`）与 `createMarkdownBackend`（`src/host/tracker/backends/markdown/index.js:87-154`）的返回对象抄。

| # | 操作 | GitHub 房实现位置 | Markdown 房实现位置 | 参数个数与可选项差异 | 返回形状差异 |
|---|------|-------------------|---------------------|----------------------|--------------|
| 1 | preflight | `github/backend.js:71` | `markdown/index.js:90-123` | 契约 `(handle, ctx)` 两个；两房都是两个，一致 | 两房都回 `{ok:true}` 或 `{ok:false,error:{kind,message}}`（不含 OpResult 外壳），与契约 `PreflightResult`（`contract.js:163-167`）一致；Markdown 的失败档用 `NOTFOUND`（`:121`），GitHub 走 `ghPreflight` |
| 2 | list | `github/backend.js:72` | `markdown/index.js:124` | 契约 `(repo, filter?, ctx)` 三个；两房都三个，一致 | 两房都回 `OpResult<Issue[]>`；Markdown 内部把参数顺序翻成 `listIssues(opCtx, repo, filter)`（`:124`），属房内私有写法，不影响形状 |
| 3 | counts | `github/backend.js:74` | `markdown/index.js:127` | 契约 `(repo, filter?, ctx)` 三个；两房都三个，一致 | 两房都回 `{ok:true,data:{open,closed,total}}`；Markdown 的实现在 `markdown/counts.js:99`，读不动票文件时整体失败不回偏小的数（`counts.js:85`） |
| 4 | listPage | `github/backend.js:76` | `markdown/index.js:130` | 契约 `(repo, filter?, opts?, ctx)` 四个；两房都四个，一致 | 两房都回 `{ok:true,data:{items,nextCursor,total}}`（GitHub `github/page.js:153`、Markdown `markdown/page.js:96`），与契约 `PageResult`（`contract-page.js:68-72`）逐字一致 |
| 5 | get | `github/backend.js:81` | `markdown/index.js:131` | 契约 `(repo, key, opts?, ctx)` 四个；两房都四个，一致 | 两房都回 `OpResult<Issue>`，一致 |
| 6 | getDependencies | `github/backend.js:82` | `markdown/index.js:132` | 契约 `(repo, key, opts?, ctx)` 四个；两房都声明四个，但 **Markdown 拿到 `opts` 不往下传**（`:132` 调 `getDependenciesForKey(opCtx,repo,key)`，只传三个） | 两房都回 `{blockedBy, blocking}`（GitHub `github/graph.js:172`、Markdown `markdown/graph.js:71`），与契约 `Dependencies`（`contract.js:193-196`）一致；Markdown 的 blockedBy 只在本工作单元内解析并按需回填标题状态（`markdown/graph.js:33-50`） |
| 7 | create | `github/backend.js:83` | `markdown/index.js:133` | 契约 `(repo, input, ctx)` 三个；两房都三个，一致 | 两房都回 `OpResult<Issue>`；Markdown 多工作单元且未指定范围时报 conflict 诚实失败（`markdown/issues-create.js:41`） |
| 8 | close | `github/backend.js:84` | `markdown/index.js:134` | 契约 `(repo, key, opts?, ctx)` 四个；两房都声明四个，但 **Markdown 拿到 `opts` 不往下传**（`:134` 调 `closeIssue(opCtx,repo,key)`），契约的 `CloseOpts.reason` 在 Markdown 上等于没实现 | 两房都回 `OpResult<Issue>` |
| 9 | reopen | `github/backend.js:85` | `markdown/index.js:135` | 契约 `(repo, key, ctx)` 三个；两房都三个，一致 | 两房都回 `OpResult<Issue>` |
| 10 | comment | `github/backend.js:86` | `markdown/index.js:136` | 契约 `(repo, key, body, ctx)` 四个；两房都四个，一致 | 两房都回 `OpResult<Comment>` |
| 11 | update | `github/backend.js:87` | `markdown/index.js:137` | 契约 `(repo, key, patch, ctx)` 四个；两房都四个，一致 | 两房都回 `OpResult<Issue>`；GitHub 认 `expectedUpdatedAt`（`github/issues-write.js:288-292`），Markdown 全房不认（见第五节第 2 条） |
| 12 | setLabels | `github/backend.js:88` | `markdown/index.js:138` | 契约 `(repo, key, labels, opts?, ctx)` 五个；两房都声明五个，但 **Markdown 拿到 `opts` 不往下传**（`:138`） | 两房都回 `OpResult<Issue>`；GitHub 认 `expectedUpdatedAt`（`github/labels.js:88-104`） |
| 13 | setAssignees | `github/backend.js:92` | `markdown/index.js:139` | 契约五个；两房都声明五个，但 **Markdown 丢 `opts`**（`:139`） | 两房都回 `OpResult<Issue>` |
| 14 | setParent | `github/backend.js:93` | `markdown/index.js:140` | 契约 `(repo, key, parentKey, opts?, ctx)` 五个；两房都声明五个，但 **Markdown 丢 `opts`**（`:140`） | 两房都回 `OpResult<Issue>`；GitHub 认 `expectedUpdatedAt`（`github/graph.js:61-65`） |
| 15 | setBlockedBy | `github/backend.js:94` | `markdown/index.js:141` | 契约 `(repo, key, blockers, opts?, ctx)` 五个；两房都声明五个，但 **Markdown 丢 `opts`**（`:141`） | 两房都回 `OpResult<Issue>`；**环检只有 GitHub 有**（`github/graph.js:15` 引 `cycle-check.js` 的 `hasCycle`），Markdown 只挡自环（`markdown/issues-patch.js:186`），契约 `contract.js:46` 要求的「写后环检，成环→conflict 不落盘」在 Markdown 上未实现 |
| 16 | getCurrentUser | `github/backend.js:95-117` | `markdown/index.js:149` | 契约 `(repo, ctx)` 两个；GitHub 两个；**Markdown 是零参桩**（`async ()=>`，两个参数都不声明） | GitHub 回 `{ok:true,data:{login,kind:'user'}}` 或 `unsupported`（`:101`）；Markdown 固定回 `{ok:false,error:{kind:'unsupported',message:'markdown getCurrentUser unsupported'}}`，与契约第 49 行「Markdown/GitLab 返回 unsupported」一致 |
| 17 | initProject | `github/backend.js:118` | `markdown/index.js:150` | 契约 `(handle, input, ctx)` 三个；GitHub 三个；**Markdown 是零参桩**（`async ()=>`） | GitHub 回 `OpResult<RepositoryRef>`；Markdown 固定回 `unsupported` 桩。**注意这里有矛盾**：契约 `contract.js:50` 写「markdown 幂等骨架」，实现却是 unsupported（见第五节第 1 条） |
| 18 | listLabels | `github/backend.js:90` | `markdown/index.js:144` | 契约 `(repo, ctx)` 两个；两房都两个，一致 | 两房都回 `OpResult<LabelColor[]>`；Markdown 在配色文件缺失时顺手补一份默认文件（`:143` 注释），属房内副作用，形状不变 |
| 19 | setLabelColors | `github/backend.js:91` | `markdown/index.js:145` | 契约 `(repo, changes, ctx)` 三个；两房都三个，一致 | 两房都回 `{ok:true,data:{applied,failed}}` 形状（逐条记账），与契约 `contract-label-colors.js` 一致（未逐字段复核，标未核实） |

结论一句话：**19 个操作两房都齐，没有一个靠注册表补桩**（补桩逻辑见 `src/host/tracker/registryShape.js:84-93`：只在方法缺失时才补）。差异集中在「Markdown 声明了可选项参数却不用」，这类差异 TypeScript 不报错（函数少传参数是合法的），要靠接口注释或评审拦住。

## 二、三个非契约面逐个对照

| 面 | GitHub 房 | Markdown 房 | 说明 |
|----|-----------|-------------|------|
| `getRepoPermissions` | `github/backend.js:129-137`，入参 `(repo, opCtx)`，回 `{ok:true,data:{push,triage}}` 或 `{ok:false,error}`（网络问不出来按未知） | **无**（全房搜索无此名） | 本地文件后端的「可写」由共享判断直接给，见 `src/shared/tracker/backendWritePermissions.js`（`deck_context` 用它，`src/host/tools/deckContext.js:86`） |
| `listSubIssues` | `github/backend.js:80`，入参 `(repo, mapKey, opts, opCtx)`，翻页拉到底加硬上限 | **无** | GitHub 房注释写明它是「读路径实现细节、不进契约的 OPERATIONS」（`:77-79`，与 `contract.js:23-25` 的非 op 旁路豁免同一条） |
| `ensureLabelColorsFile` | **无** | `markdown/index.js:148`，入参 `(repo, opCtx)`，放一份配色文件 | 供「用户为工作区选定后端」那一步用（`:146-147` 注释）；只有 Markdown 系后端会往工作区放这个文件 |

三个面没有一个是两房都实现的，所以它们要么升为契约的可选操作（由注册表给缺的后端补桩），要么继续当房内旁路并在接口里留出旁路位置（见第四节）。

## 三、两房模块对象的键集差异（逐键对照）

GitHub 模块对象在 `src/host/tracker/backends/github/index.js:192-226`（16 个键）；Markdown 模块对象在 `src/host/tracker/backends/markdown/index.js:222-252`（15 个键）。

| 键 | GitHub | Markdown | 行号与说明 |
|----|--------|----------|------------|
| `id` | 有 | 有 | `github/index.js:193`、`markdown/index.js:223` |
| `label` | 有 | 有 | `github/index.js:194`、`markdown/index.js:224` |
| `presentation` | 有 | 有 | `github/index.js:196-201`、`markdown/index.js:230-235`；**契约 `BackendModule` 里没有这个键**（`contract.js:116-131` 逐条读过），接口必须补声明 |
| `setupPrompt` | 有 | 有 | `github/index.js:203-208`、`markdown/index.js:237-242` |
| `create` | 有 | 有 | `github/index.js:209`、`markdown/index.js:245` |
| `matches` | 有 | 有 | `github/index.js:210`、`markdown/index.js:246` |
| `describe` | 有 | 有 | `github/index.js:211`、`markdown/index.js:225` |
| `issueUrl` | 有 | 有 | `github/index.js:212`、`markdown/index.js:226` |
| `searchUrl` | 有 | 有 | `github/index.js:213`、`markdown/index.js:227` |
| `linkPattern` | 有 | 有 | `github/index.js:214`、`markdown/index.js:228` |
| `links` | 有 | 有 | `github/index.js:215`、`markdown/index.js:248` |
| `capabilities` | **有** | 无 | `github/index.js:216`；契约里是可选键（`contract.js:127`） |
| `openRepository` | 有 | 有 | `github/index.js:222`（值为 `'url'`，定义在 `github/repo.js:73`）、`markdown/index.js:249`（值为 `'folder'`）；两房取值同属 `'url' \| 'folder'` 一种联合类型，无类型差异 |
| `prompts` | 有 | 有 | `github/index.js:223`、`markdown/index.js:250` |
| `checks` | **有** | 无 | `github/index.js:224`；**契约里没有这个键**，接口必须补声明或标可选 |
| `fixes` | 有 | 有 | `github/index.js:225`、`markdown/index.js:251`；**契约里没有这个键**，接口必须补声明 |
| `labelPalette` | 无 | **有** | `markdown/index.js:244`；契约里是可选键（`contract.js:125`） |

差异合计：GitHub 独有 2 个（`capabilities`、`checks`），Markdown 独有 1 个（`labelPalette`），两房都有但契约没声明的 3 个（`presentation`、`checks`、`fixes`，其中 `checks` 又与上一条重叠）。

## 四、今天不被校验、改接口后新被编译器要求的键

`validateMod`（`src/host/tracker/registryShape.js:96-105`）今天只验五项：模块是对象、`id` 是非空字符串、`label` 是字符串、`create` 是函数、`matches` 是函数；`id:'other'` 拒收。除此之外一个键都不看。

于是写成一个 `BackendModule` interface 之后，下面这些会**新被编译器要求**（今天运行时完全不拦）：

1. **19 个操作的齐全与签名**：今天缺方法由 Proxy 自动补 `unsupported` 桩（`registryShape.js:89`），房可以少实现；改成 `implements Tracker` 后，少一个、参数个数不对、返回类型不对，编译期直接报错。**实测两房今天都齐**（第一节），所以这一条不会新报错，但从此不再依赖「补桩兜底」。
2. **`describe`、`issueUrl`、`searchUrl`、`setupPrompt`、`links`、`capabilities`、`openRepository`、`prompts`、`linkPattern`、`labelPalette`**：契约里都是可选键（`contract.js:121-130`），标可选就不报错；标必填会当场在两房报错（GitHub 缺 `labelPalette`，Markdown 缺 `capabilities`）。
3. **`presentation`、`checks`、`fixes`**：契约 `BackendModule` 里根本没声明，而两房都带（`presentation`、`fixes`）或 GitHub 带（`checks`）。TypeScript 的对象字面量赋值有多余属性检查，**这三个键会当场报「对象字面量只能指定已知属性」**，接口必须补声明。
4. **房内旁路键**：GitHub 的 `create()` 产物带 `describe`、`issueUrl`、`getRepoKey`、`listSubIssues`、`getRepoPermissions`（`github/backend.js:119-129`），Markdown 带 `ensureLabelColorsFile`、`normalize`、`parse`（`markdown/index.js:148-152`）。这些都不在 Tracker 的 19 个操作里；若把 `create` 的返回类型写死成 `Partial<Tracker>`，这 8 处会因多余属性报错。契约 `contract.js:23-25` 已写明「非 op 旁路豁免」，接口要给旁路留位置（例如索引签名或单独的旁路交叉类型），否则只能删功能。
5. **`id` 一致性**：`wrapTracker`（`registryShape.js:80-82`）今天在运行时拒绝「实现自报的 id 与模块 id 不一致」；改成类型后这条语义仍在运行时（类型管不了两个常量相等），接口注释要写明。

## 五、改 interface 后会新暴露的不一致（结论计数）

**编译器会挡下的，共 13 处**（前提：接口今天照 `contract.js` 原样写，不给旁路留位置）：

- GitHub 模块多余属性 3 处：`presentation`、`checks`、`fixes`（`github/index.js:196`、`:224`、`:225`）。
- Markdown 模块多余属性 2 处：`presentation`、`fixes`（`markdown/index.js:230`、`:251`）。
- GitHub `create()` 产物多余属性 5 处：`describe`、`issueUrl`、`getRepoKey`、`listSubIssues`、`getRepoPermissions`（`github/backend.js:119-129`）。
- Markdown `create()` 产物多余属性 3 处：`ensureLabelColorsFile`、`normalize`、`parse`（`markdown/index.js:148-152`）。

**文档与实现矛盾，1 处**：

1. 契约 `contract.js:50` 写 `initProject` 「markdown 幂等骨架」，实现是固定 `unsupported` 桩（`markdown/index.js:150`）。写接口时必须选一边：改文档说 Markdown 不支持，或补一个幂等骨架实现。

**语义差不报错、但接口评审必须定，共 8 处**（TypeScript 允许声明了参数却不用，所以编译器一声不响）：

1. Markdown `getDependencies` 收 `opts` 不传（`markdown/index.js:132`）。
2. Markdown `close` 收 `opts` 不传，`CloseOpts.reason` 等于没实现（`:134`）。
3. Markdown `setLabels` 收 `opts` 不传（`:138`）。
4. Markdown `setAssignees` 收 `opts` 不传（`:139`）。
5. Markdown `setParent` 收 `opts` 不传（`:140`）。
6. Markdown `setBlockedBy` 收 `opts` 不传（`:141`）。
7. 全屋「写前 If-Match 强一致」在 Markdown 上整类未实现：全房搜索 `expectedUpdatedAt` 零命中，GitHub 四处认它（`github/graph.js:61-65` 与 `:252-256`、`github/issues-write.js:288-292`、`github/labels.js:88-104`）。
8. 环检只有 GitHub 有：`github/graph.js:15` 引 `hasCycle`，Markdown 只挡自环（`markdown/issues-patch.js:186`），与契约 `contract.js:46` 的「写后环检，成环→conflict」不齐。

**未核实（3 条）**：

1. `setLabelColors` 两房返回的 `applied`/`failed` 逐字段形状（只看了 Markdown `:145` 与 GitHub `:91` 的转发，未展开两房实现）。
2. GitHub 房 `getRepoPermissions` 返回的 `perms` 完整字段（只见 `{push,triage}` 布尔用法）。
3. Markdown 房 `update` 对 `UpdatePatch` 里 `milestone`/`customFields` 两项的处理（未展开 `markdown/issues-patch.js` 全文）。

## 六、给写接口的人三条建议（从上面事实直接得出）

1. `BackendModule` 接口要补声明 `presentation`、`checks`、`fixes` 三个键（今天契约漏了三处），否则两房当场报多余属性。
2. `create` 的返回类型不要写死成 `Partial<Tracker>`：两房共有 8 个房内旁路键，接口要给它们一个明确位置（推荐在 `Tracker` 之外单独声明一个「房内旁路」交叉类型，把 `contract.js:23-25` 的豁免口径落成类型），否则会被迫删功能或加类型断言。
3. Markdown 丢 `opts` 的六处与缺环检的一处，属于「今天就这样、接口一写就看得见」的真差异：建议在接口注释里逐条写明「本房不实现 If-Match」与「本房无环检」，并单独立票决定是补齐还是长期豁免——不要用可选参数把差异藏起来。
