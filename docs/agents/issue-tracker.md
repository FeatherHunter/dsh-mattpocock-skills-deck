# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues.

## 怎么做（先看这一节）

**这个仓库的票，用插件自带的工具来读写，不要手敲跟踪器命令。** 这些工具坐在插件的契约层之上：工具自己
按当前后端把事情做完，并且读回来核对；同一个工具在后端不是 GitHub 时照样能用，所以这份说明里不写命令。

- 建一张票 → `deck_issue_create`
- 读一张票 → `deck_issue_get`
- 看有哪些地图、有哪些开放票 → `deck_context`
- 看一张地图的子票与进度 → `deck_map_snapshot`
- 一次建出一整张地图（地图本身 + 子票 + 它们之间的边）→ `deck_map_plan_create`
- 补一条边（父子边或阻塞边）→ `deck_map_link`
- 改一张票（评论 / 标签 / 认领 / 关闭 / 改正文）→ `deck_issue_patch`

工具管不到的地方只剩两件事，它们都发生在跟踪器之外：

- **登录**：运行 `gh auth login` 并按提示在浏览器完成授权，再用 `gh auth status` 确认已经登录。
- **建仓库**：用 `gh repo create` 建好远端仓库并推上去。面板上的「创建并发布」向导会替你做这一件事，
  所以正常情况下不需要手敲它。

除了上面这两件事，这份说明里不再出现任何 `gh` 命令。

### 写正文时的一条通用规则

正文先写成文件（文件里是真实换行：每个 `## 章节` 独占一行、段落之间留一个空行），再交给工具写回；
不要把正文拼进命令行，也不要把换行写成字面的 `\n` 两个字符，更不要让正文以不可见字符（BOM）开头。
写完读回来核对一遍。这条规则三个后端通用，不是 GitHub 专有的。

### 拿不到原生能力时的降级写法

工具会优先用后端自己的原生能力（GitHub 上是原生子议题与原生依赖边）。真拿不到时，才退回在子票正文首行
写一行 `Blocked by: #n`（多个阻塞票号用逗号隔开）。这一行是三后端共用的降级写法，不许拿它当默认做法。

## Mandatory label set

This repo uses a mandatory label set — the three labels below must exist in the tracker, and every new issue carries at least one of them (missing = invalid, per the deck's convention):

- `bug` — something is broken; drives the deck's fix action and BUG filter
- `needs-triage` — unexamined issue awaiting diagnosis; drives the deck's diagnose action and TRIAGE filter
- `wayfinder:grilling` — an open decision/discussion ticket; drives the deck's discuss action

建票时必备标签由 `deck_issue_create` 一并补上；改标签用 `deck_issue_patch`。

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

这一项写成 `yes` 之后，PR 与 issue 走同一套标签与状态流转，按当前后端自己的方式读写 PR（在这条后端上就是
命令行里把 issue 那一族子命令换成 PR 那一族）。GitHub 把 issue 与 PR 编在同一套号码里，所以正文里光写
`#42` 分不清是哪一个 —— 遇到这种编号要么把两种都查一遍，要么直接向用户确认是哪一个。

## When a skill says "publish to the issue tracker"

用 `deck_issue_create` 建一张票。

## When a skill says "fetch the relevant ticket"

用 `deck_issue_get` 读那张票（连同它的评论与标签）。

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets. 下面这几件事全部走工具，
一处都不手敲命令。

- **Map**: 一张打了 `wayfinder:map` 标签的票，正文里放着 Notes / Decisions-so-far / Fog。用
  `deck_map_plan_create` 建（它会把目的地、Notes 与计划写成一张地图）。
- **Child ticket**: 挂在这张地图下的子票。用 `deck_map_link` 传 `parentKey` 建这条父子边；工具会按当前后端
  的能力落下去，并如实回报这条边落在哪一列（原生边，还是退回任务清单 + 正文首行 `Part of #<map>`）。
  标签取 `wayfinder:<类型>`（`research` / `prototype` / `grilling` / `task`）。票被认领之后，认领人就是驱动
  这件事的开发者（认领用 `deck_issue_patch`）。
- **Blocking**: 阻塞关系优先落成后端自己的原生依赖边（GitHub 上是原生的 issue dependencies，界面上看得见）。
  用 `deck_map_link` 传 `blockedBy`，工具自己判断能不能落原生边、落不了就退回正文首行的 `Blocked by: #n`，
  并把落在哪一列告诉你。一张票要等所有阻塞它的票都关闭了才算解除阻塞。
- **Frontier query**: 用 `deck_map_snapshot` 读这张地图的开放子票，去掉还能被阻塞的（依赖边指向仍未关闭的
  票，或正文 `Blocked by` 那行里还有没关的票）与已经被认领的；剩下的按地图里的先后顺序取第一条。
- **Claim**: 用 `deck_issue_patch` 把这张票指给当前用户 —— 这是本会话的第一笔写操作。
- **Resolve**: 用 `deck_issue_patch` 先发一条评论写清结论，再关闭这张票；然后到地图的 Decisions-so-far 里
  补一行指针（一句话结论 + 链接）。
