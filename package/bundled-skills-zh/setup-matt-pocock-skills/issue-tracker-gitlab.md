# 议题跟踪器：GitLab

这个仓库的议题和规格说明都以 GitLab 议题的形式存在。所有操作都用 [`glab`](https://gitlab.com/gitlab-org/cli) CLI 完成。

## 约定

- **创建议题**：`glab issue create --title "..." --description "..."`。描述有多行时用 heredoc。传 `--description -` 会打开编辑器。
- **读取议题**：`glab issue view <number> --comments`。需要机器可读的输出时，加 `-F json`。
- **列出议题**：`glab issue list -O json`，配合合适的 `--label` 过滤条件。
- **给议题写评论**：`glab issue note <number> --message "..."`。GitLab 把评论叫作「note」。
- **加标签 / 去标签**：`glab issue update <number> --label "..."` / `--unlabel "..."`。多个标签可以用逗号分隔，也可以把同一个参数重复写几遍。
- **关闭**：`glab issue close <number>`。`glab issue close` 不接受随关闭一起写的评论，所以先用 `glab issue note <number> --message "..."` 把说明发出去，再关闭。
- **合并请求**：GitLab 把 PR 叫作「merge request」。用 `glab mr create`、`glab mr view`、`glab mr note` 等命令，写法和 `gh pr ...` 一样，只是把 `pr` 换成 `mr`，把 `comment`/`--body` 换成 `note`/`--message`。

仓库可以从 `git remote -v` 推断出来；在克隆目录里运行时，`glab` 会自动完成这件事。

## 合并请求作为分诊入口

**MR 作为请求入口：否。** _（如果这个仓库把外部合并请求当作功能请求，就把 `MRs as a request surface` 这个开关设成 `yes`；`/triage` 会读它。）_

设成 `yes` 之后，MR 会和议题走同一套标签和状态，只是改用一一对应的 `glab mr` 命令：

- **读取 MR**：`glab mr view <number> --comments`，要看差异用 `glab mr diff <number>`。
- **列出需要分诊的外部 MR**：`glab mr list -O json`，然后只保留作者不是项目成员或所有者的 MR（也就是贡献者提交的 MR，而不是维护者手头正在做的工作）。
- **评论 / 加标签 / 关闭**：`glab mr note`、`glab mr update --label`/`--unlabel`、`glab mr close`。

与 GitHub 不同，GitLab 的议题和 MR 分开编号，所以只要知道维护者指的是哪一种，`#42` 就不会有歧义。

## 当技能说「发布到议题跟踪器」时

创建一个 GitLab 议题。

## 当技能说「取出相关工单」时

运行 `glab issue view <number> --comments`。

## 寻路操作

供 `/wayfinder` 使用。**地图**是一个单独的议题，它下面的**子议题**就是工单。

- **地图**：一个打了 `wayfinder:map` 标签的议题，正文里放 Notes、Decisions so far 和迷雾这些内容。`glab issue create --label wayfinder:map`。（在带原生 epic 的 GitLab 套餐上，也可以让一个 epic 承载地图；打标签的议题在任何套餐上都能用。）
- **子工单**：一条描述最上面带 `Part of #<map>` 的议题，要链接到地图（`glab issue create --linked-issues <map> --link-type relates_to`），并带上 `wayfinder:<type>` 标签（`research`/`prototype`/`grilling`/`task`）。一旦认领，工单就会指派给负责推进的开发者。
- **阻塞**：用 GitLab 的**原生阻塞链接**，这是规范做法，界面上直接看得见。用 `/blocked_by #<n>` 快捷操作添加，以 note 的形式发出去（`glab issue note <child> --message "/blocked_by #<blocker>"`）。原生阻塞链接是 Premium/Ultimate 功能；在免费套餐上（或功能不可用时）退回成在描述最上面写一行 `Blocked by: #<n>, #<n>`。等所有阻塞项都关闭，这张工单就解除阻塞了。
- **前沿查询**：用 `glab api projects/:id/issues/<map>/links` 列出地图的子议题，只保留带 `wayfinder:<type>` 标签的未关闭议题；再去掉有未关闭阻塞项的那些：指向未关闭议题的原生 `blocked_by` 链接（用 `glab api projects/:id/issues/<child-iid>/links` 查）、`Blocked by` 行里还有未关闭的议题，或者已经指派给人；按地图顺序最靠前的优先。
- **认领**：`glab issue update <n> --assignee @me`，这是本次会话的第一次写入。
- **解决**：先用 `glab issue note <n> --message "<answer>"` 把答案发出去，再 `glab issue close <n>` 关闭，然后把一条上下文指针（要点 + 链接）追加到地图的 Decisions so far。
