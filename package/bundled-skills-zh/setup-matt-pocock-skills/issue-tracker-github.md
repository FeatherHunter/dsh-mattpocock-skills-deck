# 议题跟踪器：GitHub

这个仓库的议题与规格说明都以 GitHub 议题的形式存放。所有操作都用 `gh` CLI。

## 约定

- **创建议题**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读取议题**：`gh issue view <number> --comments`，用 `jq` 过滤评论，同时取出标签。
- **列出议题**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合合适的 `--label` 和 `--state` 过滤条件。
- **给议题写评论**：`gh issue comment <number> --body "..."`
- **加标签 / 去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

从 `git remote -v` 推断仓库；在克隆目录里运行时，`gh` 会自动完成这件事。

## PR 作为分诊入口

**PR 作为请求入口：否。** _（如果这个仓库把外部 PR 当成功能请求，就把 `PRs as a request surface` 这个开关设成 `yes`；`/triage` 会读它。）_

当它设成 `yes` 时，PR 会像议题一样经过同一套标签和状态，用的是一一对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number> --comments`，看 diff 用 `gh pr diff <number>`。
- **列出需要分诊的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，然后只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的条目（丢掉 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的议题和 PR 共用一套编号，所以光写一个 `#42` 可能指其中任何一个：先用 `gh pr view 42` 解析，找不到再回退到 `gh issue view 42`。

## 当技能说「发布到议题跟踪器」

创建一个 GitHub 议题。

## 当技能说「取出相关工单」

运行 `gh issue view <number> --comments`。

## 寻路操作

供 `/wayfinder` 使用。**地图**是一个议题，**子**议题就是工单。

- **地图**：一个打了 `wayfinder:map` 标签的议题，正文里放 Notes、Decisions so far 和战争迷雾这些内容。`gh issue create --label wayfinder:map`。
- **子工单**：一条作为 GitHub 子议题（sub-issue）与地图关联的议题（对 sub-issues 端点调用 `gh api`）。子议题功能没开启时，把子工单加进地图正文里的任务列表，并在子工单正文最上面写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。一旦认领，工单会指派给负责推进的开发者。
- **阻塞**：用 GitHub 的**原生议题依赖关系**，这是规范表示，在界面上看得见。加一条边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞项的**数据库数字 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number`，也不是 `node_id`）。GitHub 会在 `issue_dependencies_summary.blocked_by` 里报告当前仍打开的阻塞项（这是实际生效的门）。依赖功能不可用时，回退成在子工单正文最上面写一行 `Blocked by: #<n>, #<n>`。所有阻塞项都关闭时，工单才算解除阻塞。
- **前沿查询**：列出地图下所有打开的子议题（`gh issue list --state open`，范围限定在地图的子议题 / 任务列表），去掉有打开阻塞项的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里还有打开的议题）或已有指派的；按地图顺序最先的胜出。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写入。
- **解决**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，再把一条上下文指针（要点 + 链接）追加到地图的 Decisions so far 段。
