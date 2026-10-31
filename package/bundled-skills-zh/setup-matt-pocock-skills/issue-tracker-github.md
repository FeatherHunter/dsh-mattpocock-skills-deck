# 议题跟踪器：GitHub

这个仓库的议题和规格说明都存放在 GitHub 议题里。所有操作都用 `gh` CLI。

## 约定

- **创建议题**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读取议题**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出议题**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，再配合合适的 `--label` 和 `--state` 过滤条件。
- **把一张议题设为某个父议题的子议题**：用 `gh issue create --parent <parent> ...`，或者事后再用 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（传的是数据库 id，与下面 **阻塞** 一节的做法相同）。没有子议题功能时，在子议题正文最上面写 `Part of #<parent>`。
- **阻塞**：用 GitHub 的**原生议题依赖**，这是规范做法，也是在界面上直接看得见的表示。加一条边可以用 `gh issue create --blocked-by <n>,<n> ...`，或者用 `gh issue edit <child> --add-blocked-by <blocker>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞项的**数据库数字 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number`，也不是 `node_id`）。依赖功能不可用时，回退成在子议题正文最上面写一行 `Blocked by: #<n>, #<n>`。所有阻塞项都关闭之后，这张工单才算解除阻塞。
- **统计还没关闭的阻塞项**：`gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只数还没关闭的阻塞项；结果为 0 表示可以开工）。`gh issue view <n> --json blockedBy` 也会列出已经关闭的阻塞项，所以要再过滤一下：`--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`。
- **给议题写评论**：`gh issue comment <number> --body "..."`
- **加标签 / 去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：先用 `gh issue comment <number> --body "..."` 把说明发出去，再执行 `gh issue close <number>`。对已经关闭的议题，`gh issue close --comment` 会把那条评论丢掉，但退出码仍然是 0。

从 `git remote -v` 推断仓库；在克隆目录里运行时，`gh` 会自动完成这件事。

只往用户自己的仓库里建议题。不要往 `mattpocock/skills`（这些技能来自的那个仓库）里建，除非用户就是它的所有者。在 fork 里，`gh` 可能默认指向上游父仓库，所以在一次会话里第一次执行 `gh issue create` 之前，先用 `gh repo view --json nameWithOwner` 检查目标仓库；如果它不是用户的仓库，就跟用户确认。

## PR 作为分诊入口

**PR 作为请求入口：否。** _（如果这个仓库把外部 PR 当作功能请求，就把它设成 `yes`；`/triage` 会读这个开关。）_

设成 `yes` 之后，PR 会和议题一样走同一套标签和状态，用的是一一对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number>`；然后看评论用 `gh pr view <number> --comments`（不在 TTY 里时，`--comments` 只打印评论、不打印正文）；看 diff 用 `gh pr diff <number>`。
- **列出需要分诊的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的议题和 PR 共用一套编号，所以光写一个 `#42` 可能指其中任何一个：先用 `gh pr view 42` 解析，解析不到再回退到 `gh issue view 42`。

## 当技能说「发布到议题跟踪器」

创建一个 GitHub 议题。

## 当技能说「取出相关工单」

按上面 **读取议题** 一节的做法读取它。

## 寻路操作

供 `/wayfinder` 使用。**地图**是一张单独的议题，它的**子议题**就是工单。

- **地图**：一张打了 `wayfinder:map` 标签的议题，正文里放 Notes / Decisions so far / 迷雾这些内容。创建用 `gh issue create --label wayfinder:map`。
- **子工单**：一张作为 GitHub 子议题与地图关联的议题（见 **把一张议题设为某个父议题的子议题**）。子议题功能没启用时，把子议题加进地图正文里的任务列表，并在子议题正文最上面写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。一旦认领，这张工单会指派给负责推进的开发者。
- **阻塞**：见「约定」一节里的 **阻塞**。
- **前沿查询**：列出地图下所有还没关闭的子议题（`gh issue list --state open`，范围限定在地图的子议题 / 任务列表），去掉有未关闭阻塞项的（见 **统计还没关闭的阻塞项**，或者 `Blocked by` 行里还有未关闭议题的）和已经有指派的；按地图顺序，最靠前的胜出。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写入。
- **解决**：先用 `gh issue comment <n> --body "<answer>"` 写下答案，再用 `gh issue close <n>` 关闭，最后把一条上下文指针（要点 + 链接）追加到地图的 Decisions so far 一节。
