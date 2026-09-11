# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **写正文（新建或改写 issue 正文）**：正文先写成文件（真实换行），再调 `node scripts/fix-issue-body.mjs --issue <号> --body-file <文件>` 写回，不要把正文拼进命令行。
- **建子议题边**：调 `node scripts/wire-subissues.mjs --map <地图号> --children <子票号列表> --body-file <地图正文文件>`；正文文件里必须有 `## Destination` 一节，否则脚本会拒绝执行。
- **D 方案（降级路径：消费者机器上没有 `dsh` 命令可用时，才走这里；有 `dsh` 一律走提示词里的两步走——第 ① 步的 `dsh plugin` 必须带 `--profile`，填启动界面时用的那个 profile 名（Web 界面通常就是 `web`），省了 `dsh` 会直接报错）**：按定版版本号从 npm 取同版本发布包，解出里面的两条脚本，用 sha256 校验无误后再直连 `node` 调用——`npm pack dsh-mattpocock-skills-deck@<定版版本号>`（得到 tarball 后解开，取 `package/scripts/fix-issue-body.mjs` 与 `package/scripts/wire-subissues.mjs`）；校验：逐文件算 sha256，必须与该版本门禁报告里的“生成物与源一致”结论对得上（对不上就删掉重取，不要凑合用）；调用：`node "<解开后的绝对目录>/fix-issue-body.mjs" --issue <号> --body-file <绝对路径文件>`（`--body-file` 照样用绝对路径）。
- **D 方案走不通的两种情况**：无网络时不要走 D 方案——`npm pack` 取包和两条脚本调 `gh` 本来都要网络，先恢复网络再继续；全程不要手写 `gh issue edit` / `gh api` 代替脚本（门禁只认脚本回包 ok，手写命令等于白干还要返工）。

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
