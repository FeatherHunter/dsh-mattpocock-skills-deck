# 契约层（src/tracker/contract）

这一目录是 deck 工具与面板**共用的那一份书面承诺**。它回答两个问题：

1. **一个后端要能做哪些事，每件事收什么、回什么** —— 见 `operations.ts`（操作名本身在 `operations-catalog.ts`）。
2. **票、仓库、失败这些东西长什么样** —— 见形状层的五件（`identity.ts`、`entities.ts`、`contexts.ts`、
   `results.ts`、`inputs.ts`，各自的读者见下面的文件清单）。

外加一份注册表真正读的「模块对象」形状（`backend-module.ts`）：进程刚启动、还没有工作区、
还没有登录的时候，界面靠它画出「有哪些后端可选」。

## 为什么契约要单独成一层

九个 deck 工具调 `tracker.preflight`、`tracker.list` 的时候，从不问「你是 GitHub 还是
本地 Markdown」。它们敢这么写，唯一的原因是有一份承诺摆在这里：不管哪个房间接手，
都回答同样的方法、收同样的参数、回同样的形状。没有这份承诺，每加一个后端，
上层就要多一堆「如果这个后端就……」的分支。

这份承诺写成 TypeScript 的 `interface` 之后，「有没有对上」由编译器回答：
GitHub 房与本地 Markdown 房用 `implements Tracker` 去实现，少一个参数、错一个返回类型，
编译当场报错，不必等运行时才发现。

## 谁实现、谁消费

- **实现方（房间）**：`src/tracker/rooms/github/`、`src/tracker/rooms/markdown/`。
  GitLab 房本轮不在改造范围内（房间目录留着，将来按同一份契约接进来）。
- **消费方**：deck 九个工具（经共享壳选好后端后直接调）、注册表（`core.ts`）、
  宿主电话与面板。

## 三条不变量（改了就是破坏承诺）

1. **失败是返回值，不是异常**：任何操作失败都回 `{ ok: false, error }`，
   `error.kind` 取 `identity.ts` 里那八个值。房间抛异常会让上层两条写路径同时开火。
2. **字段要么永远在、要么按能力省略**：核心字段永远存在（缺了用 `''`/`null` 补），
   能力字段能实现就给值或给空数组（EMPTY），不能实现就整个字段省略（MISSING）。
   「空数组」与「没有这个能力」是两件事，界面靠这个区别说话。
3. **没有能力清单**：没有一个 `supportedOps` 之类的表。能力是**运行时调用结果** ——
   能做的返回数据，不能做的当场返回 `unsupported`。这条叫 G5，是红线不是偏好。
   三个后端「哪几条我实现、哪几条我明确不支持」的逐条登记，是**审计用的文字**
   （写在各自实现里与票面上），不是运行时读的表。

## 能力的上限：25 条，全部写在这一层（2026-10-14 定的规矩）

这份契约管的是**能力上限**：一个后端最多能被要求做哪些事，名字都在这里。后端面对每一条只有两种回法——
**我实现**，或者**我不支持**。**后端不许有自己独有的对外方法**：凡是实例上叫得到名字的东西，
都必须先在这份契约里出现。

这条规矩买到的是一件很贵的东西：上层永远不必写「如果这个后端就……」的分支，
也就永远不会因为漏掉某个后端而在某一天炸掉。谁要加一个能力，先把名字加进 `operations-catalog.ts`
与 `Tracker`，再让后端去实现；实现不了就如实回 `unsupported`，不许换个名字偷偷提供。

25 条分两段，因为「没有答案」的含义不一样：

| 段 | 条数 | 名字 | 注册表怎么兜底 |
| --- | --- | --- | --- |
| **操作** | 22 | `preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`、`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile` | 缺的方法自动补一个「我不支持」的桩（`src/tracker/registry/shape.ts` 的 `unsupportedStub`）。调用方直接调，拿到 `error.kind === 'unsupported'` 这句回答 |
| **定位口** | 3 | `getRepoKey`、`describe`、`issueAddress` | 不补桩。它们没有「我不支持」这种答案：问「这个仓库叫什么」，答案是名字或者空，空也是答案。缺席就是缺席，调用方拿空值继续往下走 |

三条操作是 2026-10-14 从「某一个后端的私有扩展」收进来的，理由都是同一条——**它们的读者在后端之外**：

- `getRepoPermissions`：deck_context 的能力位与失败归因两边都要用「这个仓库能不能写」。
- `listSubIssues`：调用者是宿主电话 `src/host/mapTickets.js`。
- `ensureLabelColorsFile`：调用者是宿主「用户为工作区选定后端」那一步；它当时就做成「实现了就放、没实现就跳过」，
  但那句话得写进契约才算数。

收进来之前，这三个名字分别挂在 `GitHubRoomExtension`、`MarkdownRoomExtension` 上，
另有三个实例旁路口（`getRepoKey` / `describe` / `issueAddress`）挂在 `RoomAuxiliaries` 上。
**这三个类型已经删掉**，成员全部并进 `Tracker`；`BackendModule.create()` 的返回类型随之简化成
`RoomOperations`（`Tracker` 的子集）。同时删掉的还有本地 Markdown 房的两个解析口
`normalize` 与 `parse` 及它们的参数形状 `MarkdownParseMeta`：它们是房内模块的私有实现
（`parse.ts` / `normalize.ts`），别的文件直接 import，不经实例；挂在实例上只会让「后端有独有方法」这件事
继续存在，所以摘掉，不是收敛进契约。

**这条规矩怎么保证落地**：三个后端的工厂（`createGithubBackend` / `createMarkdownBackend` /
`createGitlabBackend`）都写了返回类型 `: RoomOperations`。写错参数、写错返回类型，编译器当场报错，
不需要另加一份手写的名字清单去数。今天这三份文件还没有被任何一份类型检查配置圈住
（整棵 `src/tracker/rooms/` 仍在「先修后转」的路上），标注先放在那里，配置一落地编译器就开始核对。

## 与今天的运行时真源的关系（迁移完成，必读）

运行时那份 JSDoc 真源（`contract.js` 与它的三份续篇）已在 #1019 退休，值搬进了
`src/tracker/contract/index.ts` 等本目录文件：**本目录就是唯一的真源**，没有第二份手写副本。注册表按本目录的
`OPERATIONS` 给没实现的后端补「做不到」的桩（`src/tracker/registry/shape.ts` 的 `unsupportedStub`）。

- 改形状或改操作签名 = 改本目录（操作名只改名录一处，类型跟着变）。
- 本目录不产出任何 `.js` 给构建拼（拼接拼的是构建机生成的
  `src/tracker/contract/vocabulary.js`，那是产物、不入库），但宿主在开发态经装载钩子
  直接读本目录的 `.ts` 真源——它出错，开发态当场就能看见。

## 怎么自检

```bash
node node_modules/typescript/bin/tsc -p tsconfig.contract.json
```

注意不要用 `npx tsc`：本仓的 `npx tsc` 是占位壳（会打印“This is not the tsc command you are looking for”），不是真编译器。

零错误才算通过。这一层没有构建步骤、没有派生产物、也不进 `scripts/build.mjs`。

## 文件清单

形状层按「谁读它」分成五件（2026-10-12 拆开，原先堆在一个 `ports.ts` 里）：五件之间
**引用方向永远单向**，地基在下、读者在上，不允许反过来（反过来就是循环引用，编译器会当场报）。

| 文件 | 装什么 | 读者 |
| --- | --- | --- |
| `identity.ts` | 身份与枚举：`BackendId`、`State`、`IssueType`、`ClosedReason`、`ActorKind`、`ErrorKind`、`Actor` | 其余四件、房间、注册表、工具、面板（谁都要用，所以它谁也不引） |
| `entities.ts` | 实体：`Issue`、`IssueRef`、`Label`、`Comment`、`Milestone`、`CustomField`、`Review`、`RepositoryRef`、`LabelColor`、`LabelColorChange` | 房间（造出它们）、工具与面板（消费它们） |
| `contexts.ts` | 调用上下文：`BackendContext`（这台机器能干什么）、`OpContext`（这一次调用是谁）、`RepoHandle` | 房间实现与装配那一层 |
| `results.ts` | **回给调用方**的形状：`TrackerError`、`OpResult`、`PreflightResult`、`Selection`、`RepoPermissions`、`SubIssueList`、`LabelColorsFilePlacement`、`Dependencies`、`Counts`、`PageResult`、`LabelColorBatchResult` | 工具、面板、注册表 |
| `inputs.ts` | **调用方交进来**的形状：`ListFilter`、`GetOpts`、`DepsOpts`、`CreateInput`、`InitProjectInput`、`UpdatePatch`、`CloseOpts`、`SetOpts`、`LabelInput`、`AssigneeInput`、`PageOpts` | 房间实现（当参数）、工具（当实参） |

两条容易问到的归位（都是有意的，不是搬错）：

- `Dependencies`、`Counts`、`PageResult` 三个写在旧文件的「入参与选项」一节里，其实是**回值**，
  按「谁读它」的尺子搬进了 `results.ts`。
- `LabelColorBatchResult`（逐条记账的结果）没有跟 `LabelColor` 放在实体那一件：它要用失败形状
  `TrackerError`，而失败形状属于 `results.ts`；放进实体会形成「实体引回值、回值引实体」的环。

其余文件：

- `operations.ts` —— 能力层：`Tracker` 接口（25 条能力 = 22 条操作 + 3 条定位口），
  以及后端能拿出来的那一份 `RoomOperations`（`Partial<Tracker>`：少实现几条是合规的常态，
  缺的操作由注册表补「我不支持」的桩）。三个后端工厂都标了这个返回类型，签名核对交给编译器。
- `operations-catalog.ts` —— **名录单源**：`OPERATIONS`（22 条操作名）、`LOCATORS`（3 条定位口名）
  两个 `as const` 数组，合起来是 `CAPABILITIES`（25 条）；`operations.ts` 的 `OpName` 由它生成
  （`typeof OPERATIONS[number]`），`index.ts` 的 `OPERATIONS` 从它转出
  （同一份数组、同一个引用，注册表读的那一份）。加一条能力只改这里一处。
- `backend-module.ts` —— 模块对象形状：`id` / `label` / `create` / `matches` 四件套，
  加品牌色板、设置页文案键、链接模板、界面能力位、检查目录、修复知识、默认调色盘。
