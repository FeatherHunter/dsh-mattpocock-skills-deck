# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues.

## 怎么做（先看这一节）

**这个仓库的票，用插件自带的工具来读写，不要手敲跟踪器命令。** 这些工具坐在插件的契约层之上：工具自己
按当前后端把事情做完，并且读回来核对；同一个工具在后端不是 GitHub 时照样能用，所以这份说明的正常路径里不写命令。

**这些工具回给你的是三段**：一段人话摘要、一段「本次调用的提示」（工具对这次拿得全不全的如实警告，
有降级时才有，比如按节标题只取到一段正文），然后是一段标着「明细（JSON）」的明细。明细里装的是这次真正
查到的内容——票正文、评论、标签、子票、地图五区块、补边时每条边落在哪一列的证据，按需给到。总量超过上限
时压掉的是尾部条目并在原地写明「还有几项未带回」，不会让你把缺了东西的当完整的用。想要更小但完整的一段，
就调该工具自己的参数（读一张票的评论条数、列票的条数、只看可接子票），而不是硬等。

- 建一张票 → `deck_issue_create`
- 读一张票 → `deck_issue_get`
- 看有哪些地图、有哪些开放票 → `deck_context`
- 看一张地图的子票与进度 → `deck_map_snapshot`
- 按状态与标签和认领列薄行 → `deck_issue_list`
- 一次建出一整张地图（地图本身 + 子票 + 它们之间的边）→ `deck_map_plan_create`
- 补一条边（父子边或阻塞边）→ `deck_map_link`
- 改一张票（评论 / 标签 / 认领 / 关闭 / 改正文）→ `deck_issue_patch`
- 查本工作区在办（谁在处理哪张票、有没有撞车）→ `deck_work_route`（写回执里不带表，要看在办就调它）

工具管不到的地方只剩两件事，它们都发生在跟踪器之外：

- **登录**：运行 `gh auth login` 并按提示在浏览器完成授权，再用 `gh auth status` 确认已经登录。
- **建仓库**：用 `gh repo create` 建好远端仓库并推上去。面板上的「创建并发布」向导会替你做这一件事，
  所以正常情况下不需要手敲它。

除了上面这两件事，正常路径里不写任何 `gh` 命令。工具本身出问题、或刚升级完插件时，按下节「工具故障」处理。

### 工具故障

这一节只在工具本身出问题、或刚升级完插件时用；正常路径仍走上面的工具，不手敲跟踪器命令。

**升级后 / 工具异常时的自检**：依次调 `deck_context`、`deck_issue_list`（`limit: 3`）、`deck_issue_get`（读最近一张票）。任一条报错就停手排查，不要带着坏工具继续干活；但报的如果是下一条说的已知回归，按替代命令绕开就行，不必重新诊断。每次升级只跑一次，不必每轮跑（三条加起来点数不多，别每轮都跑）。

**报 `gh not found` 但 `gh --version` 有输出**：说明 gh 已安装，只是它的目录不在 DSH 启动时继承的 PATH 里（deck 工具与插件都只从这份 PATH 解析 gh，不探测已知安装目录）。先重启 DSH Desktop，重启时从开始菜单、桌面或资源管理器启动（不要从旧终端或旧 IDE 会话启动，它们的进程环境可能还是旧的）；重启后仍失败，则在启动 DSH 前把 gh 所在目录加入用户级或系统级 PATH，或将本插件读取的 `DSH_GH_PATH` 设为 gh 可执行文件的绝对路径（Windows 默认安装位置是 `C:\Program Files\GitHub CLI\gh.exe`）。不要直接建议重装 gh。

**按版本自过期的已知回归**：安装版本 ≤ `1.9.0-beta.26` 时，`deck_issue_list` 报 `ToolOutputError` / `value is not lossless JSON` 属已知回归（回执的 `data` 里带了 `undefined`，修复见 #1559，代码已进 main 但还没发版），不要重新诊断；等 npm 上出了含修复的版本、安装版本越过它，本条自动失效。

**替代命令**（应急用，不进日常）：列票 `gh issue list --state open --label bug --limit 200 --json number,title,labels,updatedAt`；读回 `gh api repos/{owner}/{repo}/issues/{n}`；关单 `gh api -X PATCH repos/{owner}/{repo}/issues/{n} -f state=closed`；摘标签 `gh api -X DELETE repos/{owner}/{repo}/issues/{n}/labels/{name}`。同一套动作也封装成了 `scripts/issue-emergency.ps1`（`-Action read|close|unlabel|body`，加 `-DryRun` 只打印将要执行的命令）：四个动作都先读回、再写、写后核对，写失败还会读回确认是否其实已经落盘。

**版本三查**：本机装的是哪个版本 —— `(Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Raw | ConvertFrom-Json).dependencies.'dsh-mattpocock-skills-deck'`；工作区 `package.json` 的版号；`npm view dsh-mattpocock-skills-deck version` 的远端最新。三个数一起看：工作区版号是正在开发的版本，不是本机跑着的版本。

**失败回执怎么读**：`status`、`reason` 都在回执的「明细（JSON）」那一段里。`status` 三态（`ok` / `partial` / `unsupported`）；`reason` 按下一步分四档——可重试（`backend-threw` 等）/ 等额度（`ai-tool-refused`）/ 后端做不到（`backend-unsupported`）/ 超时（`backend-timeout`）；另外几种少见原因码（`gate-defer` / `bad-args` / `no-backend`）遇到时直接看回执里的说明文字。`items` 里逐条看哪一步失败、原因是什么；`notes` 里若写「这份清单可能不全」，就收窄条件再查一次。整份回执被判非法（报 `invalid output`）时，先按上面的自检确认是哪把工具坏了，再按替代命令绕开。

**铁律**：写操作超时、报错（网络中断、EOF、回执判失败）后一律先读回现状，不许直接重发——超时或报错往往意味着写入其实已经落盘，重发会产生重复评论或重复关闭；只有读回确认没落盘，才允许重试。

### 读票时省上下文（正文与评论按需取）

`deck_issue_get` 缺省只给够定位的量，不把整张票一次倒进上下文：正文只回前 2000 字（回执里同时告诉你全文多长、全文指纹是多少），评论一条正文都不回、只告诉你一共有几条。反向阻塞边与地图快照的缺省口径不变（不传就是全量）。

- 要看全文：带 `body: 'full'` 再调一次。全文按 7000 字一块分块回来（单块留足渲染余量），带全文的 SHA-256 指纹；把分块按顺序拼回去就是原文，一个字节不少。写回整段正文之前，先用这一档读一次，把拿到的指纹记下来。
- 要看评论正文：带 `comments: N` 再调一次（最多 200）。总数那一次已经给了，这次只补正文。
- 写整段正文：必须同时带 `bodyDigest`（上一次用 `body: 'full'` 拿到的指纹）。工具先读当前正文算指纹，对不上就一个字不动地拒绝——这是防止两个人同时改正文时，后写的把先写的覆盖掉。只改评论、标签、认领、进度、原话时不用它。
- 同一张票一轮只读一次全文：第一次用 `body: 'full'` 拿到全文与指纹后记下来；后面只为核对写没写上时，用缺省档读标签、状态与指纹核对，不再重复拉全文。


### 写正文时的一条通用规则

正文先写成文件（文件里是真实换行：每个 `## 章节` 独占一行、段落之间留一个空行），再交给工具写回；
不要把正文拼进命令行，也不要把换行写成字面的 `\n` 两个字符，更不要让正文以不可见字符（BOM）开头。
写完读回来核对一遍。这条规则三个后端通用，不是 GitHub 专有的。

正文按下面的顺序排。排在前面的章节写下来之后很少再动，排在后面的会一直追加，所以把会一直变长的放在最后。

| 顺序 | 章节 | 写什么 |
| --- | --- | --- |
| 1 | `## 目的` | 这张票要解决什么问题、给谁带来什么改变。一句话说清，不写实现方案。 |
| 2 | `## 维护者原话` | 维护者本人说过的原话（有才写；没有就整节不出现）。写法见下面「维护者原话区怎么写」。 |
| 3 | `## 边界` | 这次做到哪、不做什么，把容易越界的地方提前说清。 |
| 4 | `## 做完` | 怎么算做完：能逐条核对的验收条件。 |
| 5 | 按需章节 | 调查、讨论结论、收尾步骤之类，需要才有；每个 `##` 标题独占一行。 |
| 6 | `## 进度` | 走到哪儿了的日志，永远是正文最后一节，后面不再跟别的章节。写法见下面「进度区怎么写」。 |

**进度区怎么写**

标题固定写 `## 进度`，标题里不带百分比。记录一条一行，**最新的一条放在最上面**，所以读的人看一眼第一条，就知道这张票现在走到哪儿了。

一条记录固定写成这样：

- 进度：{百分比}%（{ISO 8601 时间，带时区}）：{做到哪一步了的一句说明}

例如：

- 进度：90%（2026-10-21T20:15:32+08:00）：写完了读侧，正在跑门禁
- 进度：40%（时间未记录）：从旧票的标题里搬过来的百分比

几条规矩：

- **说明必填**，只给百分比的更新会被拒绝写进去：百分比回答「做了多少」，说明回答「做到哪一步」，读的人要的是后者。
- **时间由工具盖**，写的人不要自己编。老记录没有时间时写「时间未记录」，不去猜。
- 条数不限，旧记录原样留着，不删也不搬走。
- 整张票正文超过 60KB 时，写进度会被拒绝，工具不会自动搬走旧记录；先由人决定怎么缩短正文，再写。
- 老票不批量迁移，等它下一次被写进度时自然换成新写法。

写进度用 `deck_issue_patch` 的 `progress: {percent, note}` 参数：`percent` 是 0 到 100 的整数，`note` 是必填的一句话（不能换行）。工具负责盖时间、写回正文，再把正文读回来核对一遍。

**维护者原话区怎么写**

标题固定写 `## 维护者原话`，紧跟在 `## 目的` 后面（没有目的就放正文最前面）。它是正文的一部分，不是评论：维护者本人说了一句需要留档的话，就把它追加进来。

一条原话由出处行和引用块两部分组成：

- **出处行**：在引用块外面单独一行，以 `出处：` 开头，写清这句话是从哪儿来的，读的人才能自己去核对。票面上说的写完整链接；本会话里说的写「本会话（时间）」；文件里写的写 `路径:行号`；提交里说的写短哈希。
- **引用块**：紧跟在出处行下面，放原话本身：每一行前面加 `>`，原话里的空行也写成单独一行 `>`。

例如（整段照下面这种形状写进正文）：

```text
## 维护者原话

出处：本会话（2026-10-21T20:05+08:00）
> 第一段原话，一个字都不改地抄在这里。
>
> 第二段原话；原话里本来有空行的地方，保留成单独一行 `>`。
```

几条规矩：

- **一字不改**：不润色、不改标点、不翻译、不摘要、不合并。要解释就写到别的章节里，引用块里保持原样。
- **只追加**：不编辑、不删除、不排序、不合并；同一句话带同一个出处已经记过，就跳过，不再记第二遍。
- 条数不限，和正文共用一个 60KB 上限。

写这一区用 `deck_issue_create` 与 `deck_issue_patch` 的 `originalWords: {text, source}` 参数（#1091 已落地）：`source` 必填，工具负责按上面的规则追加、只追加、同一段原话配同一个出处时幂等跳过，写完再把正文读回来逐字核对。

读这一区有两个入口（#1092 已落地）：

- `deck_issue_get` 回 `originalWords: [{text, source, recordedAt}]`：`text` 与引用块逐字相同（只去掉每行一个 `>` 前缀，原话里的空行照旧是空行，不做 trim）；`source` 是出处行原文；`recordedAt` 只从出处文字里认带 `T` 的 ISO 8601 时间并原样返回，出处没写时间时是 `null`（不拿票的修改时间顶替）。只想看整区原文（含 `>` 前缀）时，给同一个工具传 `section: '维护者原话'`。
- `deck_map_snapshot` 的 full 行带同一份 `originalWords`，thin 行故意不带（要原话的人逐张读 `deck_issue_get`）。

解析只有一处实现：`src/shared/issue-file/src/original-words.ts` 的 `parseOriginalWords`，读工具与写侧共用同一套按行扫描。

**这两个区的写法以 #1089 的定稿为准**：上面的区块顺序与两个区的规则出自票 [#1089 地图15讨论：进度写哪、原话区的写法](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1089) 正文的「讨论结论（2026-10-21 定稿）」一节；当初为什么这样定、查过哪些一手材料，见 `research/1089-progress-and-user-voice.md`（每条结论都注了来源）。以后要改这套写法，先回那张票的定稿里改，再改这份文档——不要让规则只活在口口相传里。

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
  的能力落下去，并如实回报这条边落在哪一列（原生边，还是任务清单 + 票正文的归属标记；GitLab 房落在文件头的隐藏标记 `<!-- DSH-PARENT: <地图> -->`）。
  标签取 `wayfinder:<类型>`（`research` / `prototype` / `grilling` / `task`）。票被认领之后，认领人就是驱动
  这件事的开发者（认领用 `deck_issue_patch`）。
- **Blocking**: 阻塞关系优先落成后端自己的原生依赖边（GitHub 上是原生的 issue dependencies，界面上看得见）。
  用 `deck_map_link` 传 `blockedBy`，工具自己判断能不能落原生边、落不了就退回正文的阻塞写法（GitLab 房是成对降级：可见行 `Blocked by: #n` + 隐藏机器表 `<!-- DSH-BLOCKED-BY: … -->`），
  并把落在哪一列告诉你。`blockedBy` 里列的是**阻塞这一方的票**（先把它们关掉才轮到这张票）；回执会点名
  「票 #A 的 blockedBy 里有 #B，也就是 #A 被 #B 阻塞」，读回执时按这个方向核对。一张票要等所有阻塞它的票都关闭了才算解除阻塞。
- **Frontier query**: 用 `deck_map_snapshot` 读这张地图的开放子票，去掉还能被阻塞的（依赖边指向仍未关闭的
  票，或正文 `Blocked by` 那行里还有没关的票）与已经被认领的；剩下的按地图里的先后顺序取第一条。
- **Claim**: 用 `deck_issue_patch` 把这张票指给当前用户 —— 这是本会话的第一笔写操作。
- **Resolve**: 用 `deck_issue_patch` 先发一条评论写清结论，再关闭这张票；然后到地图的 Decisions-so-far 里
  补一行指针（一句话结论 + 链接）。
