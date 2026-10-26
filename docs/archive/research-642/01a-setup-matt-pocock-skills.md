# 技能整理：/setup-matt-pocock-skills

## 技能名

`/setup-matt-pocock-skills`

## 官方一句话

`SKILL.md` 头部 YAML 里 `description:` 那一行的原文：

> Configure this repo for the engineering skills — set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills.

中文转述：给当前仓库做一次配置，把工程类技能所需要的那套前提条件搭起来——这个仓库的 issue 记在哪里、三个字的分类标签怎么叫、领域文档放哪里；在第一次用其它工程技能之前跑一次就行。

另外头部 YAML 里还有一行 `disable-model-invocation: true`（模型不能自己主动调用它，只能由人来触发），以及 `name: setup-matt-pocock-skills`。

## 它解决什么问题

其它工程技能（尤其是管 issue 那几个）默认假设仓库里已经有一套约定：issue 记在哪儿、五个分类角色叫什么名字、领域文档 `CONTEXT.md` 和 ADR 放在哪儿。可每个仓库的情况都不一样，这些约定光靠猜会出错。这个技能就是一次性问清楚、写下来，让后续技能有据可依。

## 什么时候用它（进入条件）

原文写明的触发时机只有一句：

> Run once before first use of the other engineering skills.

也就是：在使用其它工程技能之前，先跑一次。原文接着说：

> This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

它是一个靠对话驱动的技能，不是一段照着跑的死脚本：先探查、再把发现摆给用户看、得到确认、最后才写文件。配合头部 YAML 的 `disable-model-invocation: true`，它应当由人主动发起，而不是模型自行决定调用。

## 它做完产出什么、之后接什么

产出（第 4 步「Write」）：改一处、新建若干文件。

1. 在 `CLAUDE.md` 或 `AGENTS.md` 二者之一里，写入（或原地更新）一个 `## Agent skills` 段落。
2. 在 `docs/agents/` 下写入 `issue-tracker.md`、`domain.md`，以及在装了 `triage` 技能时写 `triage-labels.md`。

之后接什么（第 5 步「Done」）：告诉用户配置完成，并说明**哪些工程技能从此会读这些文件**；同时提示用户以后可以直接改 `docs/agents/*.md`，只有在想换 issue 跟踪方式或者从零重来时，才需要再跑一次这个技能。

## 它点名提到的其他技能

逐个如下：

- `triage` —— **可选（决定分支）**。原文要求探查「`triage` 技能装了没有」（旁边有 `triage` 技能文件夹，或可用技能列表里有 `triage`）。装了才跑 B 段、才写 `triage-labels.md`；没装就整段跳过，连 `### Triage labels` 子块和 `docs/agents/triage-labels.md` 都不写。理由原文给了：「an uninstalled skill needs no labels」（没装的技能不需要标签）。
- `to-tickets` —— **引用**。出现在 A 段解释里，作为「会读写 issue tracker 的技能」的例子。
- `triage` —— **引用**。同上，作为会读 issue tracker 的技能的第二个例子。
- `to-spec` —— **引用**。同上，第三个例子。

原文对这三个的说法是：

> Skills like `to-tickets`, `triage`, and `to-spec` read from and write to it — they need to know whether to call `gh issue create`, write a markdown file under `.scratch/`, or follow some other workflow you describe.

除此之外，`SKILL.md` 正文没有点名别的技能。它也没有写「调用某个技能」的调用语法，只是在探查和说明里引用了这几个名字。

**注意区分**：那几份种子模板里还出现了一批技能名——三份 tracker 模板都引了 `/wayfinder`（wayfinding 那几节标注「Used by `/wayfinder`」），`domain.md` 引了 `/domain-modeling`、`/grill-with-docs`、`/improve-codebase-architecture`，`issue-tracker-local.md` 还引了 `triage-labels.md`。这些是**模板正文**里的引用，来自被写进用户仓库的那几份文档，不是 `SKILL.md` 自己的点名，所以没有并进上面的清单。

## 跨会话 / 跨代理用法

有提到，但角度是「写入文件、留给以后读」，不是「交给另一个 agent 去做事」。

原文里指向跨会话/跨代理的部分：

- `## Agent skills` 这个段落本身就是要写进 `AGENTS.md` / `CLAUDE.md`——那是给「以后的 agent 会话」看的仓库级说明文件。
- `docs/agents/` 下的三份文件被定位成后续技能的输入：`to-tickets`、`triage`、`to-spec` 会读它；第 5 步还专门说「which engineering skills will now read from these files」（哪些工程技能从此会读这些文件）。
- 「write a markdown file under `.scratch/`」这一选项，是把 issue 落成文件供下一轮接手。

原文没有出现「换一个新会话」「交给另一个 agent」「写一份交接文件给下一个人」这类字眼。所以准确说法是：**文件是留给后续的 agent 会话与技能读的，但没有直接把「跨会话/跨代理交接」写成使用场景。**

## 它产出的文件清单

落在用户仓库里的文件：

| 路径 | 干什么用 | 何时写 |
| --- | --- | --- |
| `CLAUDE.md` 或 `AGENTS.md` 里的 `## Agent skills` 段 | 仓库级的技能配置摘要，给人和其他 agent 会话看，指向下面几份文档 | 总是（二者选其一，见下） |
| `docs/agents/issue-tracker.md` | issue 记在哪里、用什么命令去读写 | 总是 |
| `docs/agents/domain.md` | 领域文档的读者规则 + 布局（单上下文 / 多上下文） | 总是 |
| `docs/agents/triage-labels.md` | 五个分类角色对应的标签字符串映射 | 仅当 `triage` 技能已安装、B 段跑过 |

`## Agent skills` 段的原文模板（照抄）：

```markdown
## Agent skills

### Issue tracker

[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout — "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

**选哪个文件来编辑**（第 4 步原文规则）：

- `CLAUDE.md` 存在，就编辑 `CLAUDE.md`。
- 否则 `AGENTS.md` 存在，就编辑 `AGENTS.md`。
- 两个都不存在，问用户要建哪一个 —— 不许替他决定。
- 已有 `CLAUDE.md` 时绝不新建 `AGENTS.md`，反之亦然。
- 若选定文件里已经有 `## Agent skills` 段，就原地更新内容，不要追加出第二份重复段落；同时不要覆盖用户对其它段落的改动。

**那几份 `docs/agents/*.md` 的模板来源**：以本技能目录里的种子文件为起点，原文列了这一组（原文是相对链接，这里写成路径）：

- `issue-tracker-github.md` —— GitHub issue tracker
- `issue-tracker-gitlab.md` —— GitLab issue tracker
- `issue-tracker-local.md` —— 本地 markdown issue tracker
- `triage-labels.md` —— 标签映射（仅当 `triage` 已安装）
- `domain.md` —— 领域文档的读者规则 + 布局

这 5 份种子文件各自写些什么，见下面「种子模板里都写些什么」一节。

若用户选的是「其它」issue 跟踪方式（Jira、Linear 之类），则按用户的一段话描述，从零手写 `docs/agents/issue-tracker.md`。

## 种子模板里都写些什么

### `domain.md` —— 领域文档的读者规则 + 布局

它的定位一句话：「How the engineering skills should consume this repo's domain documentation when exploring the codebase.」（工程技能在探索代码库时，该怎么读这个仓库的领域文档。）

**探索之前先读这三样**：仓库根的 `CONTEXT.md`；若存在 `CONTEXT-MAP.md`，它指向每个上下文各自的 `CONTEXT.md`，把与当前话题相关的都读一遍；`docs/adr/` 下与你要动的区域相关的 ADR，多上下文仓库里还要看 `src/<context>/docs/adr/` 里上下文范围内的决策。

一个关键行为约定：这些文件不存在时**安静跳过**——不要点名说它们缺失，也不要一上来就提议创建。这些文件是由 `/domain-modeling` 技能按需懒创建的（该技能经由 `/grill-with-docs` 和 `/improve-codebase-architecture` 到达）。

**两种布局的目录示意**（模板里画成了目录树）：

单上下文（大多数仓库）—— 根 `CONTEXT.md`，`docs/adr/` 里放 `0001-event-sourced-orders.md`、`0002-postgres-for-write-model.md` 这类编号决策，外加 `src/`。

多上下文（判据就是根上有 `CONTEXT-MAP.md`）—— 根 `CONTEXT-MAP.md`；`docs/adr/` 放系统级决策；`src/` 下每个上下文（示例是 `ordering/`、`billing/`）各有自己的 `CONTEXT.md` 和 `docs/adr/` 放本上下文的决策。

**借用术语表的词汇**：输出里一旦点到领域概念（issue 标题、重构建议、猜想、测试名字），就用 `CONTEXT.md` 里定义的那个词，不要漂到术语表明确不用的同义词上。要用的概念术语表里还没有，这本身是个信号——要么你在造项目不用的词（重新想想），要么确实有缺口（记下来交给 `/domain-modeling`）。

**撞上 ADR 要挑明**：输出与既有 ADR 冲突时，明确摆出来，不要默默覆盖。模板给了句现成写法：*Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…*

（注：`domain.md` 里点到了 `/domain-modeling`、`/grill-with-docs`、`/improve-codebase-architecture` 三个技能名。这是种子模板的内容，不是 `SKILL.md` 正文的点名，所以没有并入上面「它点名提到的其他技能」一节。）

### `triage-labels.md` —— 标签映射表

开头说明：技能们用五个规范分类角色说话，本文件把这些角色映射到本仓库 issue tracker 里实际用的标签字符串。

| 在 mattpocock/skills 里的标签 | 在我们的 tracker 里的标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者需要评估这个 issue |
| `needs-info` | `needs-info` | 在等报告人补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已完全写清楚，可以交给 AFK agent |
| `ready-for-human` | `ready-for-human` | 需要人来实现 |
| `wontfix` | `wontfix` | 不会处理 |

用法一句话：「When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.」（技能提到某个角色时，比如「打上 AFK-ready 分类标签」，就用表里对应的标签字符串。）

改法是「Edit the right-hand column to match whatever vocabulary you actually use.」（改右列，让它对上你实际在用的那套叫法。）注意表头左列写的是 `mattpocock/skills`，也就是这套技能的出处仓库名，本模板默认左列等于右列。

### `issue-tracker-github.md` —— GitHub 版

开头：这个仓库的 issue 和 spec 放在 GitHub issues 里，所有操作都用 `gh` 命令行。

**日常约定（原文给了具体命令）**：建 issue 用 `gh issue create --title "..." --body "..."`，多行正文用 heredoc；读 issue 用 `gh issue view <number> --comments`，配合 `jq` 过滤评论、同时取标签；列 issue 用 `gh issue list --state open --json number,title,body,labels,comments --jq '...'` 加相应的 `--label` / `--state` 过滤；评论用 `gh issue comment`；加/去标签用 `gh issue edit --add-label` / `--remove-label`；关闭用 `gh issue close <number> --comment "..."`。仓库从 `git remote -v` 推断——在克隆目录里跑 `gh` 它自己就认。

**PR 当分类界面**：这一节开头写着「**PRs as a request surface: no.**」（并附小注：若这个仓库把外部 PR 当特性请求，就改成 `yes`，`/triage` 会读这个开关。）设成 `yes` 后，PR 走与 issue 相同的标签与状态，命令换成 `gh pr` 那一套：读 PR 用 `gh pr view <number> --comments` 加 `gh pr diff <number>`；为分类列外部 PR 用 `gh pr list --state open --json ...` 再只留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR`、`NONE` 的（丢掉 `OWNER`/`MEMBER`/`COLLABORATOR`）；评论、打标签、关闭分别用 `gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。还提醒 GitHub 的 issue 和 PR 共用一个编号空间，所以光看 `#42` 分不清是哪一种——先用 `gh pr view 42` 试，不成再退回 `gh issue view 42`。

**两句固定话术**：技能说「publish to the issue tracker」——就是建一个 GitHub issue；技能说「fetch the relevant ticket」——就是跑 `gh issue view <number> --comments`。

**Wayfinding 操作**（标注由 `/wayfinder` 使用；map 是一个 issue，ticket 是它的子 issue）：

- **Map**：一个打了 `wayfinder:map` 标签的 issue，正文里装 Notes / Decisions-so-far / Fog。用 `gh issue create --label wayfinder:map` 建。
- **子 ticket**：按 GitHub 子 issue 关联（走 `gh api` 的子 issue 端点）。子 issue 功能没开的地方，就把子项加进 map 正文的任务列表，并在子 issue 正文顶部写 `Part of #<map>`。标签用 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。一经认领，ticket 指派给动手的开发者。
- **阻塞**：用 GitHub **原生 issue 依赖**——这是标准、界面上看得见的表达方式。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 加边，其中 `<blocker-db-id>` 是阻塞方的数字**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id` 拿，**不是** `#number` 也不是 `node_id`）。GitHub 用 `issue_dependencies_summary.blocked_by` 报（只算还开着的阻塞方——这才是活的闸门）。依赖功能不可用时，退回在子 issue 正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞方都关闭，ticket 才算解除阻塞。
- **前沿查询**：列出 map 还开着的子项（`gh issue list --state open`，范围限定在 map 的子 issue / 任务列表），剔掉有未关闭阻塞方（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 那行里还有开着的 issue）的，以及已经有指派人的；按 map 里的顺序，靠前的先赢。
- **认领**：`gh issue edit <n> --add-assignee @me`——这是本次会话的第一次写操作。
- **完结**：先 `gh issue comment <n> --body "<answer>"`，再 `gh issue close <n>`，最后把一段上下文指针（要点 + 链接）追加到 map 的 Decisions-so-far 里。

### `issue-tracker-local.md` —— 本地 markdown 版

开头：这个仓库的 issue 和 spec 是 `.scratch/` 下的 markdown 文件。

**约定**：一个特性一个目录 `.scratch/<feature-slug>/`；spec 是 `.scratch/<feature-slug>/spec.md`；实现用的 issue 是一票一个文件放在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 编号起——**永远不要合并成一个 tickets 文件**；分类状态记在每个 issue 文件靠近顶部的 `Status:` 行里（角色字符串见 `triage-labels.md`）；评论和对话历史追加到文件底部的 `## Comments` 标题下。

**两句固定话术**：技能说「publish to the issue tracker」——在 `.scratch/<feature-slug>/` 下新建文件（目录不存在就建）；技能说「fetch the relevant ticket」——读那个路径的文件，用户一般会直接给路径或 issue 号。

**Wayfinding 操作**（标注由 `/wayfinder` 使用；map 是一个文件，每张 ticket 一个**子**文件）：

- **Map**：`.scratch/<effort>/map.md`，装 Notes / Decisions-so-far / Fog 正文。
- **子 ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号起，正文明写问题。`Type:` 行记票的类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记 `claimed`/`resolved`。
- **阻塞**：顶部附近的 `Blocked by: NN, NN` 行。它列出的每个文件都 `resolved` 了，这张票才解除阻塞。
- **前沿**：扫 `.scratch/<effort>/issues/`，找还开着、没被阻塞、也没被认领的文件；编号靠前的先赢。
- **认领**：动手之前先写 `Status: claimed` 并存盘。
- **完结**：把答案追加到 `## Answer` 标题下，置 `Status: resolved`，再把一段上下文指针（要点 + 链接）追加到 `map.md` 的 Decisions-so-far。

（注：两份模板里都出现了 `/wayfinder` 技能名，`issue-tracker-local.md` 还引了 `triage-labels.md`。同 `domain.md` 的情况，这些是种子模板的内容，没有并入上面「它点名提到的其他技能」一节。）

### `issue-tracker-gitlab.md` —— GitLab 版

开头：这个仓库的 issue 和 spec 放在 GitLab issues 里，所有操作都用 `glab` 命令行（原文链到 `https://gitlab.com/gitlab-org/cli`）。

**日常约定（原文给了具体命令）**：建 issue 用 `glab issue create --title "..." --description "..."`，多行描述用 heredoc，`--description -` 则打开编辑器写；读 issue 用 `glab issue view <number> --comments`，`-F json` 出机器可读的输出；列 issue 用 `glab issue list -F json` 加相应的 `--label` 过滤；评论用 `glab issue note <number> --message "..."`——GitLab 管评论叫「note」；加/去标签用 `glab issue update <number> --label "..."` / `--unlabel "..."`，多个标签可以逗号分隔或重复给这个参数；关闭用 `glab issue close <number>`。这里有个坑原文专门点出：`glab issue close` 不接受关闭用的评论，所以要先 `glab issue note` 把解释发出去，再关。合并请求方面，GitLab 管 PR 叫「merge request」，用 `glab mr create`、`glab mr view`、`glab mr note` 等——形状和 `gh pr ...` 一样，只是把 `pr` 换成 `mr`、把 `comment`/`--body` 换成 `note`/`--message`。仓库同样从 `git remote -v` 推断。

**MR 当分类界面**：这一节开头写着「**MRs as a request surface: no.**」（并附小注：若这个仓库把外部的合并请求当特性请求，就改成 `yes`，`/triage` 会读这个开关。）设成 `yes` 后，MR 走与 issue 相同的标签与状态，命令换成 `glab mr` 那一套：读 MR 用 `glab mr view <number> --comments` 加 `glab mr diff <number>`；为分类列外部 MR 用 `glab mr list -F json`，再只留作者不是项目成员/所有者的（也就是贡献者提交的 MR，不是维护者手上在做的工作）；评论、打标签、关闭分别用 `glab mr note`、`glab mr update --label`/`--unlabel`、`glab mr close`。与 GitHub 不同的是，GitLab 的 issue 和 MR 分开编号，所以只要知道维护者说的是哪一面，`#42` 就没有歧义。

**两句固定话术**：技能说「publish to the issue tracker」——就是建一个 GitLab issue；技能说「fetch the relevant ticket」——就是跑 `glab issue view <number> --comments`。

**Wayfinding 操作**（标注由 `/wayfinder` 使用；map 是一个 issue，ticket 是它的子 issue）：

- **Map**：一个打了 `wayfinder:map` 标签的 issue，正文里装 Notes / Decisions-so-far / Fog。用 `glab issue create --label wayfinder:map` 建。（原文补一句：在带原生 epic 的 GitLab 档位上，map 也可以放在一个 epic 里；但打了标签的 issue 到处都能用。）
- **子 ticket**：一个 issue，描述顶部带 `Part of #<map>`，标签是 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。一经认领，ticket 指派给动手的开发者。
- **阻塞**：用 GitLab **原生 blocking link**——这是标准、界面上看得见的表达方式。用 `/blocked_by #<n>` 快速操作来加，当成一条 note 发出去（`glab issue note <child> --message "/blocked_by #<blocker>"`）。原生 blocking link 是 Premium/Ultimate 档位的功能；免费档位（或功能不可用时）退回在描述顶部写 `Blocked by: #<n>, #<n>`。所有阻塞方都关闭，ticket 才算解除阻塞。
- **前沿查询**：`glab issue list -F json`，范围限定在 map 的子项，剔掉有未关闭阻塞方的——不管是原生 `blocked_by` 链到还开着的 issue（`glab api projects/:id/issues/:iid/links`），还是 `Blocked by` 那行里还有开着的 issue——以及已经有指派人的；按 map 里的顺序，靠前的先赢。
- **认领**：`glab issue update <n> --assignee @me`——这是本次会话的第一次写操作。
- **完结**：先 `glab issue note <n> --message "<answer>"`，再 `glab issue close <n>`，最后把一段上下文指针（要点 + 链接）追加到 map 的 Decisions-so-far 里。

### 三份 tracker 模板的对照

| | GitHub | GitLab | 本地 markdown |
| --- | --- | --- | --- |
| 工具 | `gh` | `glab` | 无，直接读写 `.scratch/` 下的文件 |
| map 是什么 | 打了 `wayfinder:map` 标签的 issue | 同上（有 epic 的档位也可用 epic） | `.scratch/<effort>/map.md` |
| 阻塞怎么表达 | 原生 issue 依赖；不可用时退化成正文一行 | 原生 blocking link（付费档）；免费档退化成正文一行 | 正文顶部 `Blocked by:` 行 |
| 认领怎么写 | `--add-assignee @me` | `--assignee @me` | 文件里写 `Status: claimed` |
| PR/MR 开关默认 | `no`，别主动提 | `no`，别主动提 | 没有 PR 概念，不涉及 |

## 三个决策段的原文要点

### A 段 —— issue tracker

解释原文：

> The "issue tracker" is where issues live for this repo. Skills like `to-tickets`, `triage`, and `to-spec` read from and write to it — they need to know whether to call `gh issue create`, write a markdown file under `.scratch/`, or follow some other workflow you describe. Pick the place you actually track work for this repo.

默认取向：这套技能是为 GitHub 设计的。`git remote` 指向 GitHub 就推荐 GitHub；指向 GitLab（`gitlab.com` 或自建）就推荐 GitLab；否则（或用户另有偏好）给出四个选项：

- **GitHub** —— issue 放在仓库的 GitHub Issues 里，用 `gh` 命令行。
- **GitLab** —— issue 放在仓库的 GitLab Issues 里，用 `glab` 命令行。
- **本地 markdown** —— issue 就是本仓库 `.scratch/<feature>/` 下的文件；适合单人项目或没有远端仓库的情况。
- **其它**（Jira、Linear 等）—— 让用户用一段话描述工作流，技能把它原样记成散文。

选择结果记进 `docs/agents/issue-tracker.md`。GitHub 与 GitLab 两份模板里带一个「PRs as a request surface」开关，默认**关**——原文明确要求保持关闭且不要主动提起；用户以后想要外部 PR 进分类队列，自己去文件里翻开关。

### B 段 —— 分类标签词汇

原文明确：如果 `triage` 技能没装，**整段跳过**。装了的话也只问一个问题：

> Do you want to keep the default triage labels? (recommended: **yes**)

默认就是五个规范角色，每个的标签字符串等于它自己的名字：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。答「是」就照写。只有用户说不 —— 通常是因为他们现有的跟踪系统用了别的名字（例如用 `bug:triage` 表示 `needs-triage`）—— 才收集覆盖映射，好让 `triage` 沿用已有标签而不是创建重复标签。

### C 段 —— 领域文档

默认**单上下文**：仓库根一个 `CONTEXT.md` 加 `docs/adr/`。原文说这适合几乎每一个仓库，直接写，不用问。

只有探查发现了 monorepo 信号，才提出**多上下文**方案：根本一个 `CONTEXT-MAP.md`，指向各个上下文自己的 `CONTEXT.md`。这时才让用户确认选哪种布局。

## 探查清单（第 1 步原文）

原文要求「Read whatever exists; don't assume」（有什么就读什么，不要假设）：

- `git remote -v` 和 `.git/config` —— 是不是 GitHub 仓库？哪一个？
- 仓库根的 `AGENTS.md` 和 `CLAUDE.md` —— 存在吗？其中是否已有 `## Agent skills` 段？
- 仓库根的 `CONTEXT.md` 和 `CONTEXT-MAP.md`
- `docs/adr/` 以及任何 `src/*/docs/adr/` 目录
- `docs/agents/` —— 本技能上次的产出是否已经在了？
- `.scratch/` —— 是否已有本地 markdown 记 issue 的迹象
- `triage` 技能装没装 —— 这决定 B 段跑不跑
- monorepo 信号：`pnpm-workspace.yaml`、`package.json` 里的 `workspaces` 字段、或 `packages/*` 里有自己的 `src/`。只有真正的大型多包仓库才有；没有这些信号就按单上下文处理，而「almost every repo」（几乎所有仓库）都是这种情况。

## 与官网对不上的地方

官网首页把它归在 **01 Getting Started** 那一组，配的说法是「Set up once, then find your way around.」（配置一次，然后自己找到路）。

与本地文件对不上的地方，如实记录：

1. **「then find your way around」没有被写成一个后续步骤。** 原文第 5 步只说告诉用户「配置完成」以及哪些工程技能会读这些文件，并提示以后可以直接改 `docs/agents/*.md`、只有换跟踪方式或从零重来才需要再跑。原文没有「配置完之后去看/去逛/去找路」这一步，也没有指向任何导览文档。
2. **「Set up once」这一半能对上。** 原文确有「Run once before first use of the other engineering skills.」（第一次用别的工程技能之前跑一次），与「配置一次」意思一致；只是「一次」在原文里还带了例外——换 issue 跟踪方式或想从零重来时，可以再跑。
3. **官网把它放在 Getting Started 组，原文则只强调它是前置。** 原文一遍遍说的都是「其它技能的前置条件」（configure this repo for the engineering skills、before first use of the other engineering skills、后续哪些技能会读这些文件），至于它在整个技能体系里排第几组、是入门还是配置，原文没有表态。
4. **官网那句读起来像是一个入门导览入口，本地文件其实是一个配置向导。**「find your way around」暗示配置完还有一个「到处逛」的动作，可原文的落点全在写文件上；`disable-model-invocation: true` 加「prompt-driven skill, not a deterministic script」也说明它靠人对话推进，不具备「让人自己去逛」的性质。
5. **官网那句还把范围说窄了：它只提 issue tracker，没提另外两件事。** 本地原文一句话里含三件事——issue tracker、分类标签词汇、领域文档布局；官网那句只留了「Set up once」。同样地，官网的 Getting Started 定位会让人以为它是「第一个要读的说明」，而本地原文的定位是「其它技能的前置条件」，两件事不完全一样。

（说明：官网首页除这一句之外的上下文，本地材料里没有，本文件不做补充推断。）

---

<!-- 本文件第一版在只读完 SKILL.md 之后立即写盘；随后依次并入 domain.md、triage-labels.md、issue-tracker-local.md、issue-tracker-github.md、issue-tracker-gitlab.md 的内容。6 份正文文件（不含 agents/openai.yaml）已全部读完并入。 -->
