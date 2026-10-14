# GitHub 后端能力登记表

`#1147` 决策 9 的交付物（2026-10-14）。登记口径见规格票：**明确提供功能**——今天就能干活且有调用方在用；**明确不支持**——形态不合、永远不会有；**当前不支持、未来会开发**——说得通、今天没做。一条一条审过实现才落笔，不估。

实现真源：`src/tracker/rooms/github/backend.ts`（工厂 24 个成员）+ 各实现文件。缺的那条由注册表按名录自动补桩（`src/tracker/registry/shape.ts`），调用方拿到的是诚实的 `unsupported`，不是“方法不存在”。

## 操作（22 条中提供 21 条）

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
| ensureLabelColorsFile | 当前不支持、未来会开发 | 今天只有 Markdown 实现（往工作区放默认配色文件）；语义是本地放文件、与远端无关，GitHub 工作区同样用得上，今天没排期 |

## 定位口（3 条全部提供）

| 能力 | 登记 | 依据 |
|---|---|---|
| getRepoKey | 明确提供功能 | `repo.ts`（三层兜底：git remote → 配置 → gh 视图），宿主快照与工具壳多处在用 |
| describe | 明确提供功能 | `repo.ts`，注册表识别链产出身份靠它 |
| issueAddress | 明确提供功能 | `repo.ts`，远端票网址 |

## 交接

随地图 08 开发票交付（`#1052/#1053/#1054`）。本表由 `#1147` 预交付，开发票不再重审，只需在实现偏离本表时回来改表。
