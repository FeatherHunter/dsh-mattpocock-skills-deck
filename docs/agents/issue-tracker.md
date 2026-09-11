# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **写正文（新建或改写 issue 正文）**：正文先写成文件（真实换行；每个 `## 章节` 独占一行、段落间留空行），再跑 `gh issue edit <号> --body-file <文件>` 写回。不要把正文拼进命令行，也不要把换行写成字面的 `\n` 两个字符，或让正文以不可见字符（BOM）开头。
- **建子议题边**：先用 `gh api repos/<owner>/<repo>/issues/<子票号> --jq .id` 取子票的数据库编号，再建原生子议题边 `gh api repos/<owner>/<repo>/issues/<地图号>/sub_issues -X POST -F sub_issue_id=<子票数据库编号>`；建完用 `gh api repos/<owner>/<repo>/issues/<地图号>/sub_issues --jq length` 核对张数与预期一致。
- **建阻塞关系**：用原生依赖边 `gh api repos/<owner>/<repo>/issues/<子票号>/dependencies/blocked_by -X POST -F issue_id=<阻塞它的那张票的数据库编号>`；只有拿不到原生能力时，才退回在子票正文首行写一行 `Blocked by: #n` 文字。
- **可选工具（不是必走路径）**：仓库里带两条脚本 `scripts/fix-issue-body.mjs` 与 `scripts/wire-subissues.mjs`，它们把上面几件事一次做完——写回时剥掉开头的不可见字符、按阈值把字面 `\n` 还原成真实换行、格式只告警不改写、失败自动重试一次并在票下留一条固定格式评论；建子议题边与阻塞边，并读回校验张数。装了本插件的机器上可以直接用（脚本在插件安装目录的 `scripts/` 下）；没有它时，照上面的 `gh` 命令手做即可。两条路都算完成，没有哪条是「白干」。

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Mandatory label set

This repo uses a mandatory label set — the three labels below must exist in the tracker, and every new issue carries at least one of them (missing = invalid, per the deck's convention):

- `bug` — something is broken; drives the deck's fix action and BUG filter
- `needs-triage` — unexamined issue awaiting diagnosis; drives the deck's diagnose action and TRIAGE filter
- `wayfinder:grilling` — an open decision/discussion ticket; drives the deck's discuss action

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
