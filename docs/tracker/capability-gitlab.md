# GitLab 后端能力登记表

`#1147` 决策 9 的交付物（2026-10-14）。登记口径同 GitHub 那份（三类定义见规格票），一条一条审过实现才落笔，不估。

实现真源：`src/tracker/rooms/gitlab/index.ts`（工厂注释自己写的边界：“13 条操作 + describe/issueAddress 两条定位口”，缺的“都还没做”）。缺的操作由注册表按名录自动补桩（`src/tracker/registry/shape.ts`），调用方拿到诚实的 `unsupported`。

## 操作（22 条中提供 13 条、未来开发 9 条）

| 能力 | 登记 | 依据 |
|---|---|---|
| preflight | 明确提供功能 | `preflight.js`（转 TS 进行中），识别链在用 |
| list | 明确提供功能 | `issues.js` |
| get | 明确提供功能 | `issues.js` |
| getDependencies | 明确提供功能 | `graph.js` |
| create | 明确提供功能 | `issues.js` |
| close | 明确提供功能 | `issues.js` |
| reopen | 明确提供功能 | `issues.js` |
| comment | 明确提供功能 | `comments.js` |
| update | 明确提供功能 | `issues.js` |
| setLabels | 明确提供功能 | `labels.js`（milestone 分流见 `#135`） |
| setAssignees | 明确提供功能 | `graph.js` |
| setParent | 明确提供功能 | `graph.js`（落成 relates_to 平级链接，原生父子边 GitLab 没有，见文件注释） |
| setBlockedBy | 明确提供功能 | `graph.js` |
| counts | 当前不支持、未来会开发 | 工厂自己说“还没做”；远端票仓计数语义说得通 |
| listPage | 当前不支持、未来会开发 | 同上；分页语义说得通 |
| listLabels | 当前不支持、未来会开发 | 同上；标签配色语义说得通 |
| setLabelColors | 当前不支持、未来会开发 | 同上 |
| getCurrentUser | 当前不支持、未来会开发 | 同上；`glab api user` 能问到 |
| initProject | 当前不支持、未来会开发 | 同上；`glab repo create` 能建 |
| getRepoPermissions | 当前不支持、未来会开发 | 同上；成员权限能问到 |
| listSubIssues | 当前不支持、未来会开发 | 同上；注意 GitLab 没有原生子票，落成什么样动手时再定 |
| ensureLabelColorsFile | 当前不支持、未来会开发 | 同上；语义是本地放文件，与远端无关 |

## 定位口（提供 2 条、未来开发 1 条）

| 能力 | 登记 | 依据 |
|---|---|---|
| describe | 明确提供功能 | 工厂实例成员 + 模块对象都有（`index.ts` 的 `describe` 函数）：refId 含 `/` 即拼出 GitLab 地址 |
| issueAddress | 明确提供功能 | 工厂实例成员 + 模块对象都有：拼 `/-/issues/` 地址 |
| getRepoKey | 当前不支持、未来会开发 | 实例与模块都没有；从 git remote 解析 owner/project 语义说得通，今天没做；调用方缺席即跳过 |

## 交接

本表随地图 10（GitLab 房，`#1062`）交付使用。本表由 `#1147` 预交付，地图 10 动工时不再重审，只需在实现偏离本表时回来改表。
