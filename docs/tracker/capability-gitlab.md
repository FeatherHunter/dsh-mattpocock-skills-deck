# GitLab 后端能力登记表

`#1147` 决策 9 的交付物（2026-10-14）。登记口径同 GitHub 那份（三类定义见规格票）：**明确提供功能**——今天就能干活且有调用方在用；**明确不支持**——形态不合、永远不会有；**当前不支持、未来会开发**——说得通、今天没做。一条一条审过实现才落笔，不估。

实现真源：`src/tracker/rooms/gitlab/index.ts`（工厂 25 个成员）+ 各实现文件。这一家今天**没有欠账**：名录上的 26 条，24 条真提供、1 条明确不支持、1 条未来会开发（读预算，承接 #1439，实现之前那一条要靠注册表补桩）。

## 操作（23 条中提供 21 条，1 条未来会开发）

| 能力 | 登记 | 依据 |
|---|---|---|
| preflight | 明确提供功能 | `preflight.ts`，识别链每轮调用 |
| list | 明确提供功能 | `issues.ts`，票列表主路径 |
| get | 明确提供功能 | `issues.ts`，取单张票 |
| getDependencies | 明确提供功能 | `graph.ts`，读依赖边 |
| create | 明确提供功能 | `issues.ts` + `create-write.ts`（建票收敛成单条写路径） |
| close | 明确提供功能 | `issues.ts`，关票 |
| reopen | 明确提供功能 | `issues.ts`，重开票 |
| comment | 明确提供功能 | `comments.ts`，写评论 |
| update | 明确提供功能 | `issues.ts`，改票 |
| setLabels | 明确提供功能 | `labels.ts`，给票改标签（milestone 分流见 `#135`） |
| setAssignees | 明确提供功能 | `graph.ts`，改认领 |
| setParent | 明确提供功能 | `graph-membership.ts`，**落在票正文顶部的 `Part of #<地图>` 声明行**——归属的唯一真相是子票自己写下的这一行，建票时带 `parentKey` 直接写进去，挂载/拆除走同一行（幂等改写）；不再写任何 links（`relates_to` 是对称的平级关联，分不出哪一头是父，链上它反而污染归属）。原生层级在 work items 那条路上，入口是界面与 GraphQL，本房不走 |
| setBlockedBy | 明确提供功能 | `graph-blocking.ts`，阻塞边走原生 `is_blocked_by`：有能力就逐条真写（POST 加、DELETE 删，删边拿链接自己的 `issue_link_id`）、写后读回核对；免费档常拿不到原生能力，滚回干净后才回落到正文首行的降级写法。读的顺序是原生优先、没有读那一行，对端开关状态逐张落实 |
| counts | 明确提供功能 | `counts.ts`，走 `issues_statistics` 拿三个数 |
| listPage | 明确提供功能 | `pages.ts`，分页读票 |
| listLabels | 明确提供功能 | `labels-ops.ts`，翻页拉全，取不全就整体失败 |
| setLabelColors | 明确提供功能 | `labels-ops.ts`，逐条改色、逐条记账；GitLab 只有单个 `color` 字段，没有 GitHub 那种前景/背景双色 |
| getCurrentUser | 明确提供功能 | `identity-ops.ts`，`glab api user` |
| getRepoPermissions | 明确提供功能 | `identity-ops.ts`，读 `permissions` 里的 access level 折算 push / triage |
| listSubIssues | 明确提供功能 | `sub-issues.ts`，读票正文顶部的 `Part of #<地图>` 声明行（**不是远端认的层级子条目**，见下面的实话）：有这一行就是子票，没有就不是，不猜、不按 links 方向推断；翻页扫仓，拿不全就整体失败 |
| initProject | 明确提供功能 | `init-project.ts`，`glab repo create` + git 初始化 |
| ensureLabelColorsFile | 明确不支持 | 这条能力承诺的是「在工作区放一份用户可以手改、**改了就生效**的标签配色文件」。GitLab 这一家的颜色真源是远端仓库的标签，工作区里那份文件没有任何读者，手改也不会影响颜色——放一份改了不算数的文件只会误导人，属于形态不合。要读颜色用 `listLabels`，要改颜色用 `setLabelColors`。理由与 GitHub 那家同一条，见 `capability-github.md` 的变更段。 |
| readBudget | 明确提供功能 | 规格 1439 新增、#1446 落地：`budget.ts` 经 `glab api --include` 读响应头里的 `RateLimit-Limit` / `RateLimit-Remaining`，只读不花；量不到时回「读数未知」并带原因（没装 glab 记 not-measured，请求失败或响应头缺数记 unavailable），不回 0、不抛。 |

## 定位口（3 条全部提供）

| 能力 | 登记 | 依据 |
|---|---|---|
| getRepoKey | 明确提供功能 | `repo.ts`，三层兜底：git remote → `.git/config` → `glab repo view` |
| describe | 明确提供功能 | `index.ts` 内联，refId 含 `/` 即拼出 GitLab 地址 |
| issueAddress | 明确提供功能 | `index.ts` 内联，拼 `/-/issues/` 地址 |

## 变更

- 2026-10-14（地图 10 开发票 `#1064`）：**9 条由「当前不支持、未来会开发」改成「明确提供功能」，1 条改判成「明确不支持」，1 条定位口补上。**

  做成功能的九条：`counts`、`listPage`、`listLabels`、`setLabelColors`、`getCurrentUser`、`getRepoPermissions`、`listSubIssues`、`initProject`、`getRepoKey`。它们此前只是「说得通、还没做」，这一轮逐条落地，做法与依据写在上面两表的依据列。

  `ensureLabelColorsFile` 改成「明确不支持」的理由与 GitHub 那家完全一样：这条能力有前后两半，前半是「放一份文件」，后半是「改了算数」，而这家的颜色真源在远端仓库标签上，工作区里那份文件没有读者，后半做不到。**这是判定，不是欠账**——欠账是「形态成立、只是没做」，它连形态都不成立。

  改完之后这一家与 GitHub 那家一样，名录上没有任何一条要靠注册表补桩。

## 两条不能忘的实话

- `listSubIssues` 在 GitLab 上读的是子票自己正文顶部的 `Part of #<地图>` 声明行，不是远端认的层级子条目。人手工加的 `relates_to` 关联不参与归属判定。拿到的东西能用来画关系，但别把它当成原生层级去用。
- GitLab 平台有原生的父子层级（work items 那条路，入口是界面与 GraphQL），但本房不走那条路；免费档的阻塞原生能力也常常拿不到，拿不到时按登记表与代码注释回落到正文行。不要把声明行说成原生层级，也不要把「本房这条路拿不到」说成「GitLab 做不到」。

## 交接

本表随地图 10（GitLab 房，`#1062`）的开发票 `#1064` 交付。本表由 `#1147` 预交付，开发票不再重审，只需在实现偏离本表时回来改表。

接手这一房的人先读 `src/tracker/rooms/gitlab/README.md`——那一份写的是这一房与另外两房不一样的地方。