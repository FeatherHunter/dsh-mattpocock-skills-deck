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

- **实现方（房间）**：`src/host/tracker/backends/github/`、`src/host/tracker/backends/markdown/`。
  GitLab 房本轮不在改造范围内（房间目录留着，将来按同一份契约接进来）。
- **消费方**：deck 九个工具（经共享壳选好后端后直接调）、注册表（`registryCore.js`）、
  宿主电话与面板。

## 三条不变量（改了就是破坏承诺）

1. **失败是返回值，不是异常**：任何操作失败都回 `{ ok: false, error }`，
   `error.kind` 取 `identity.ts` 里那八个值。房间抛异常会让上层两条写路径同时开火。
2. **字段要么永远在、要么按能力省略**：核心字段永远存在（缺了用 `''`/`null` 补），
   能力字段能实现就给值或给空数组（EMPTY），不能实现就整个字段省略（MISSING）。
   「空数组」与「没有这个能力」是两件事，界面靠这个区别说话。
3. **没有能力清单**：没有一个 `supportedOps` 之类的表。能力是**运行时调用结果** ——
   能做的返回数据，不能做的当场返回 `unsupported`。这条叫 G5，是红线不是偏好。

## 三个房内扩展的定位（这一轮定的）

有三个方法不在 19 条契约操作里，但确实有房外的读者，所以要写清楚它们各自是什么身份：

| 名字 | 身份 | 为什么这么定 |
| --- | --- | --- |
| `getRepoPermissions` | **本轮升为契约操作**（进 `Tracker`） | 「这个仓库能不能写」deck 与面板两边都要用；只挂在 GitHub 房上会让本地 Markdown 那一侧没有答案 |
| `listSubIssues` | GitHub 房扩展（`GitHubRoomExtension`，**不进契约**） | 它是读路径的实现细节，唯一调用者是宿主电话；没实现它的后端由那条电话按「做不到」退化 |
| `ensureLabelColorsFile` | 本地 Markdown 房扩展（`MarkdownRoomExtension`，**不进契约**） | 宿主在「用户选定后端」那一步要放一份默认配色文件，但**不许问后端是谁**；做成「实现了就放、没实现就跳过」的口子，只有本地 Markdown 房实现它 |

另外两类名字也住在两个房间的**实例**上（`create()` 造出来的那一份），不在这 19 条里，本轮都给它们定了类型位置，写法与理由如下：

- **实例旁路口三个**：`getRepoKey`、`describe`、`issueUrl`，落在 `RoomAuxiliaries`（三个成员全可选），
  由 `BackendModule.create()` 的返回类型交叉进来。它们今天真实挂在 GitHub 实例上
  （`backends/github/backend.js:119`、`:120`、`:124`），本地 Markdown 实例上没有 ——
  所以三个都标可选，谁有谁写。有两个真实读者：注册表视图的回退链
  （`registryViews.js:32-46` 与 `:59-64`，先问模块对象、再问实例、最后按后端 id 拼骨架）与
  共享壳取仓库标识那一处（`src/shared/deck-tools/shell.js:216-227`，先看有没有这个方法再调，
  外加竞速上限）。**缺席不是故障**：没有方法时前两条路各自回退，壳按「补不出来」如实往下走。
- **本地 Markdown 房的两个解析口**：`normalize` 与 `parse`，落在 `MarkdownRoomExtension` 的可选成员上。
  它们只有本地文件后端有（`backends/markdown/index.js:151`、`:152`），返回的是房间自己的完整解析结果，
  所以契约层把返回类型写成 `unknown` 而不复制房间私有形状；参数形状记在 `MarkdownParseMeta`。
  本轮在 `src/host` 与 `tests` 里没有查到房外调用方（房内别的文件直接 import `parse.js` / `normalize.js`，
  不经实例），是否有别处动态取用未核实。**注意**：早先这一版 README 写它们「不建模」，
  2026-10-12 补丁时改成建模为可选成员 —— 理由是不建模的话，房间照原样实现时这两个键会因
  多余属性检查当场报错，迁移第一步就卡住。

## 与今天的运行时真源的关系（迁移完成，必读）

运行时的 JSDoc 真源（`src/host/tracker/contract.js` 与它的三份续篇）已在 #1019 退休，
值住进了本目录：**本目录就是唯一的真源**，没有第二份手写副本。注册表按本目录的
`OPERATIONS` 给没实现的后端补「做不到」的桩（`registryShape.js` 的 `unsupportedStub`）。

- 改形状或改操作签名 = 改本目录（操作名只改名录一处，类型跟着变）。
- 本目录不产出任何 `.js` 给构建拼（拼接拼的是构建机生成的
  `src/tracker/contract/vocabulary.js`，那是产物、不入库），但宿主在开发态经装载钩子
  直接读本目录的 `.ts` 真源——它出错，开发态当场就能看见。

## 怎么自检

```bash
npx tsc -p tsconfig.contract.json
```

零错误才算通过。这一层没有构建步骤、没有派生产物、也不进 `scripts/build.mjs`。

## 文件清单

形状层按「谁读它」分成五件（2026-10-12 拆开，原先堆在一个 `ports.ts` 里）：五件之间
**引用方向永远单向**，地基在下、读者在上，不允许反过来（反过来就是循环引用，编译器会当场报）。

| 文件 | 装什么 | 读者 |
| --- | --- | --- |
| `identity.ts` | 身份与枚举：`BackendId`、`State`、`IssueType`、`ClosedReason`、`ActorKind`、`ErrorKind`、`Actor` | 其余四件、房间、注册表、工具、面板（谁都要用，所以它谁也不引） |
| `entities.ts` | 实体：`Issue`、`IssueRef`、`Label`、`Comment`、`Milestone`、`CustomField`、`Review`、`RepositoryRef`、`LabelColor`、`LabelColorChange` | 房间（造出它们）、工具与面板（消费它们） |
| `contexts.ts` | 调用上下文：`BackendContext`（这台机器能干什么）、`OpContext`（这一次调用是谁）、`RepoHandle` | 房间实现与装配那一层 |
| `results.ts` | **回给调用方**的形状：`TrackerError`、`OpResult`、`PreflightResult`、`Selection`、`RepoPermissions`、`Dependencies`、`Counts`、`PageResult`、`LabelColorBatchResult` | 工具、面板、注册表 |
| `inputs.ts` | **调用方交进来**的形状：`ListFilter`、`GetOpts`、`DepsOpts`、`CreateInput`、`InitProjectInput`、`UpdatePatch`、`CloseOpts`、`SetOpts`、`LabelInput`、`AssigneeInput`、`PageOpts` | 房间实现（当参数）、工具（当实参） |

两条容易问到的归位（都是有意的，不是搬错）：

- `Dependencies`、`Counts`、`PageResult` 三个写在旧文件的「入参与选项」一节里，其实是**回值**，
  按「谁读它」的尺子搬进了 `results.ts`。
- `LabelColorBatchResult`（逐条记账的结果）没有跟 `LabelColor` 放在实体那一件：它要用失败形状
  `TrackerError`，而失败形状属于 `results.ts`；放进实体会形成「实体引回值、回值引实体」的环。

其余文件：

- `operations.ts` —— 操作层：`Tracker` 接口（19 条契约操作 + 本轮新升的 `getRepoPermissions`，
  共 20 个成员）、房间能拿出来的那份（`RoomOperations`）、两个房内扩展（`GitHubRoomExtension`、
  `MarkdownRoomExtension`）、实例旁路口（`RoomAuxiliaries`）、房间私有解析口的参数（`MarkdownParseMeta`）。
- `operations-catalog.ts` —— **操作名录单源**：19 个操作名的 `as const` 数组；`operations.ts` 的
  `OpName` 由它生成（`typeof OPERATIONS[number]`），`index.ts` 的 `OPERATIONS` 从它转出
  （同一份数组、同一个引用，注册表读的那一份）。加一条操作只改这里一处。
- `backend-module.ts` —— 模块对象形状：`id` / `label` / `create` / `matches` 四件套，
  加品牌色板、设置页文案键、链接模板、界面能力位、检查目录、修复知识、默认调色盘。
