# GitHub 后端能力登记表

`#1147` 决策 9 的交付物（2026-10-14）。登记口径见规格票：**明确提供功能**——今天就能干活且有调用方在用；**明确不支持**——形态不合、永远不会有；**当前不支持、未来会开发**——说得通、今天没做。一条一条审过实现才落笔，不估。

实现真源：`src/tracker/rooms/github/backend.ts`（工厂 25 个成员）+ 各实现文件。唯一一条按设计不支持的（配色文件）由注册表按名录自动补桩（`src/tracker/registry/shape.ts`），调用方拿到的是诚实的 `unsupported`，不是“方法不存在”；读预算从 #1443 起由房间自己实现（`budget.ts`）。

## 操作（23 条中：22 条明确提供功能、1 条明确不支持）

| 能力 | 登记 | 依据 |
|---|---|---|
| preflight | 明确提供功能 | `preflight.ts`，识别链每轮调用 |
| list | 明确提供功能 | `issues.ts`，票列表主路径 |
| get | 明确提供功能 | `issues.ts`，取单张票 |
| getDependencies | 明确提供功能 | `graph.ts`，读阻塞边 |
| create | 明确提供功能 | `issues-write.ts`，建票 |
| close | 明确提供功能 | `issues-write.ts`，关票 |
| reopen | 明确提供功能 | `issues-write.ts`，重开票 |
| comment | 明确提供功能 | `comments.ts`，写评论 |
| update | 明确提供功能 | `issues-write.ts`，改票 |
| setLabels | 明确提供功能 | `labels.ts`，改标签 |
| setAssignees | 明确提供功能 | `issues-write.ts`，改认领 |
| setParent | 明确提供功能 | `graph.ts`，原生父子边 |
| setBlockedBy | 明确提供功能 | `graph.ts`，原生阻塞边 |
| getCurrentUser | 明确提供功能 | 工厂内联实现（`gh api user`），面板“本人不显”过滤在用 |
| initProject | 明确提供功能 | `init-project.ts`，建仓初始化流程在用 |
| listLabels | 明确提供功能 | `label-colors-ops.ts`，标签配色弹窗在用 |
| setLabelColors | 明确提供功能 | `label-colors-ops.ts`，批量改色在用 |
| counts | 明确提供功能 | `counts.ts`，面板数字由它出 |
| listPage | 明确提供功能 | `page.ts`，分页读票在用 |
| getRepoPermissions | 明确提供功能 | `repo-permissions.ts`，`deck_context` 能力位与失败归因在用 |
| listSubIssues | 明确提供功能 | `sub-issues.ts`，宿主电话 `wf.mapTickets` 在用 |
| ensureLabelColorsFile | 明确不支持 | 这条能力承诺的是「在工作区放一份用户可以手改、**改了就生效**的标签配色文件」。GitHub 这一家的颜色真源是仓库标签，工作区里那份文件今天没有任何读者，手改也不会影响颜色——放一份改了不算数的文件只会误导人，属于形态不合。要读颜色用 `listLabels`，要改颜色用 `setLabelColors`（界面入口是仓库标签页）。 |
| readBudget | 明确提供功能 | 规格 1439 新增（读缓存里的剩余额度，只读不花）；#1443 起房间自己读 gh（`budget.ts`，三态回未知带原因，成功回两桶），经会话直达，不裁决不记账。 |

## 定位口（3 条全部提供）

| 能力 | 登记 | 依据 |
|---|---|---|
| getRepoKey | 明确提供功能 | `repo.ts`（三层兜底：git remote → 配置 → gh 视图；真起 gh 的那一级在回包上自报 usage，交给会话管线记账）。房间这一份由会话补身份与工具壳在用；宿主快照另有一份只读本地证据的解析（`src/refresh/rooms/host/git-execution.ts`） |
| describe | 明确提供功能 | `repo.ts`，注册表识别链产出身份靠它 |
| issueAddress | 明确提供功能 | `repo.ts`，远端票网址 |

## 变更

- 2026-10-24（#1453）：定位口 `getRepoKey` 的 gh 那一级只在会话内走。刷新后台开会话时缺 refId，改问会话自己的 `getRepoKey` 能力（先过裁决、再按后端口径记账）；宿主那一份（`src/refresh/rooms/host/git-execution.ts`）只读 git remote 与 .git/config，答不上来就回 null，不再起 gh。房间真起 gh 时把这一笔用量（requests / points）挂在裸值回包上自报，账本按后端的两桶口径记得到；只读本地证据答上来的调用不带用量，也就不记账。
- 2026-10-23（规格 #1439、#1443 落地）：新增第 26 条能力 `readBudget`，登记为「明确提供功能」——房间自己读 gh（`budget.ts`：成功回 REST 与 GraphQL 两桶，读不到时回未知并带原因，不回 0、不抛）。本表按新的总数与档位订正导语与表头：名录 26 条 = 23 条操作 + 3 条定位口，GitHub 25 条真提供、1 条按设计明确不支持；今天名录上唯一要靠注册表补桩的只剩 `ensureLabelColorsFile`。
- 2026-10-14：`ensureLabelColorsFile` 由「当前不支持、未来会开发」改判成「明确不支持」。

  改判前，同一件事在仓库里写了两处，两处互相矛盾：本表原来的依据是「语义是本地放文件、与远端无关，GitHub 工作区同样用得上，今天没排期」，而契约里那条同名注释的依据是「它的标签颜色存在仓库标签上，没有本地文件可放」。两句各说了一半——前者只看到「放文件」这个动作，没有问「放下去谁读」；后者只看到「颜色在远端」，没有说清工作区里那份文件为什么不能存在。

  按本表自己的三类口径重判：这条能力承诺的不只是文件存在，还有「改了算数」，而这个后端做不到后半句，所以是**形态不合、永远不会有**，不是欠账。契约里那段注释已在同一天按同一口径改准（`src/tracker/contract/operations.ts` 的 `ensureLabelColorsFile`）。

  将来若确实想要一份「把仓库标签颜色抄到工作区、供人离线翻看」的东西，那是一件新能力：它要有自己的刷新时机，并且先回答「这份文件的读者是谁」。不要借这一条的名字把它放回来。

## 交接

随地图 08 开发票交付（`#1052/#1053/#1054`）。本表由 `#1147` 预交付，开发票不再重审，只需在实现偏离本表时回来改表。