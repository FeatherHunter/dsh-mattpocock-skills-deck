---
name: setup-matt-pocock-skills
description: "为这个仓库配置好这几项工程技能所需的东西：搭好它的议题跟踪方式、分类标签词汇表和领域文档布局。在第一次使用其它工程技能之前运行一次。"
disable-model-invocation: true
---

# 配置 Matt Pocock 的技能

把这几项工程技能所假定的、按仓库分别配置的内容搭好：

- **议题跟踪**：议题放在哪里（默认是 GitHub；本地 markdown 也开箱即用）
- **分类标签**：那五个固定分类角色所用的字符串
- **领域文档**：`GLOSSARY.md` 和 ADR 放在哪里，以及读取它们的消费方规则

这是一个由提示词驱动的技能，不是一段确定性脚本。先探查，把你发现的东西摆出来，跟用户确认，然后再写。

## 流程

### 1. 探查

看看当前仓库，弄清它的起始状态。有什么就读什么，不要凭空假设：

- `git remote -v` 和 `.git/config`：这是个 GitHub 仓库吗？是哪一个？
- 仓库根目录的 `AGENTS.md` 和 `CLAUDE.md`：两者存在吗？其中是否已经有 `## Agent skills` 小节？
- 仓库根目录的 `GLOSSARY.md` 和 `GLOSSARY-MAP.md`
- `docs/adr/` 以及任何 `src/*/docs/adr/` 目录
- `docs/agents/`：这个技能上一次的产物是不是已经在这里了？
- `.scratch/`：这是本地 markdown 议题跟踪约定已经在用的迹象
- `triage` 技能装了吗？（在这技能旁边有个 `triage` 技能文件夹，或者你的可用技能列表里有 `triage`。）这决定要不要跑 B 部分。
- 单体仓库的信号：有 `pnpm-workspace.yaml`，`package.json` 里有 `workspaces` 字段，或者 `packages/*` 下有内容并且自带 `src/`。这些只在真正的大型多包仓库里才会出现；没有它们就意味着单上下文布局，而几乎所有仓库都是这样。

### 2. 摆出发现并提问

先总结哪些东西已经有了、哪些还缺。然后按顺序过各个部分。一个部分，一个答复，再进下一个。

每个部分都先把推荐答案放在最前面，这样用户一个字就能接受。只有在选择真的会分岔时才给一句说明；如果探查阶段已经定了，就整段跳过（没装 `triage` 时跳过 B 部分，没有单体仓库时跳过 C 部分）。

**A 部分：议题跟踪。**

> 说明：「议题跟踪」指的是这个仓库的议题放在哪里。`to-tickets`、`triage`、`to-spec` 这类技能会读写它。它们需要知道该调用 `gh issue create`、在 `.scratch/` 下写一个 markdown 文件，还是走你描述的其他某种流程。请选你实际用来跟踪这个仓库工作的地方。

默认立场：这些技能是为 GitHub 设计的。如果某个 `git remote` 指向 GitHub，就提议用它。如果某个 `git remote` 指向 GitLab（`gitlab.com` 或自建主机），就提议 GitLab。否则（或者用户更愿意的话），提供这些选项：

- **GitHub**：议题放在仓库的 GitHub Issues 里（用 `gh` CLI）
- **GitLab**：议题放在仓库的 GitLab Issues 里（用 [`glab`](https://gitlab.com/gitlab-org/cli) CLI）
- **本地 markdown**：议题以文件形式放在这个仓库的 `.scratch/<feature>/` 下（适合个人项目或没有远端的仓库）
- **其他**（Jira、Linear 等）：请用户用一段话描述工作流；技能会把这段描述原样记成自由文本

把选择记录到 `docs/agents/issue-tracker.md`。GitHub 和 GitLab 模板里带一个 "PRs as a request surface" 开关，默认是**关**。保持关闭，也别去提它：想把外部 PR 放进分类队列的用户，之后可以在文件里把这个开关打开。

**B 部分：分类标签词汇表。** 如果 `triage` 技能没装（探查阶段已经告诉你结论了），就整段跳过，因为没装的技能不需要标签。

如果装了，就只问一个问题：

> 你想保留默认的分类标签吗？（推荐：**是**）

默认值就是那五个固定角色，每个标签字符串与它的名字相同：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。如果回答**是**，就原样写下来。只有当用户说不要——通常是因为他们的跟踪系统已经在用别的名字（比如用 `bug:triage` 表示 `needs-triage`）——才去收集这些覆盖值，好让 `triage` 套用已有的标签，而不是创建重复标签。

**C 部分：领域文档。** 默认用**单上下文**（仓库根目录放一个 `GLOSSARY.md` 加 `docs/adr/`）。这适合几乎所有仓库；不用问，直接写。

只有当探查阶段发现了单体仓库信号时，才提供**多上下文**选项（一个根 `GLOSSARY-MAP.md` 指向各上下文的 `GLOSSARY.md` 文件）。然后再确认他们想要哪种布局。

### 3. 确认并编辑

给用户看一份草稿：

- 要加进 `CLAUDE.md` / `AGENTS.md` 之中正在被编辑的那个文件里的 `## Agent skills` 区块（选择规则见第 4 步）
- `docs/agents/issue-tracker.md`、`docs/agents/domain.md` 和 `docs/agents/triage-labels.md` 的内容（最后一个只在装了 `triage` 时才有）

让他们先改，再落笔。

### 4. 写入

**选定要编辑的文件：**

- 如果 `CLAUDE.md` 存在，就编辑它。
- 否则如果 `AGENTS.md` 存在，就编辑它。
- 如果两个都不存在，问用户要创建哪一个；不要替他决定。

`CLAUDE.md` 已经存在时，绝不要再去创建 `AGENTS.md`（反过来也一样）；永远编辑已经在那里的那个。

如果选中的文件里已经有 `## Agent skills` 区块，就原地更新它的内容，而不是再追加一份重复的。不要去覆盖用户对周围小节的改动。

该区块：

```markdown
## Agent skills

### Issue tracker

[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout: "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

只有 `triage` 已安装且 B 部分跑过时，才包含 `### Triage labels` 子区块，并写出 `docs/agents/triage-labels.md`。没跑过时，两者都省略。

然后以这个技能文件夹里的种子模板为起点，写出那些文档文件：

- [issue-tracker-github.md](./issue-tracker-github.md)：GitHub 议题跟踪
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md)：GitLab 议题跟踪
- [issue-tracker-local.md](./issue-tracker-local.md)：本地 markdown 议题跟踪
- [triage-labels.md](./triage-labels.md)：标签映射（只在装了 `triage` 时）
- [domain.md](./domain.md)：领域文档的消费方规则 + 布局

对于「其他」议题跟踪方式，按用户的描述从零写出 `docs/agents/issue-tracker.md`。

### 5. 收尾

告诉用户配置已经完成，以及从现在起哪些工程技能会读这些文件。顺便提一句，他们之后可以直接编辑 `docs/agents/*.md`；只有想切换议题跟踪方式或推倒重来时，才需要重新运行这个技能。
