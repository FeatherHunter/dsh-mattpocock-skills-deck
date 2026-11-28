# 调查：DSH 插件 dsh-mattpocock-skills-deck 为什么不支持 Gitea / tea 作为 Issue Tracker 后端

调查日期：2026-11-09
插件版本：dsh-mattpocock-skills-deck 1.9.0-beta.33（安装路径 `~/.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck/`）
上游项目：https://github.com/mattpocock/skills （当日 clone 主分支 HEAD）
（handoff 迁移副本：原稿在 jap_data_analysis 仓库 docs/ 下同名文件）

## 核心结论（TL;DR）

1. **上游 mattpocock/skills 其实也没有内置的 Gitea/tea 后端。** 它内置的三个模板同样是 GitHub / GitLab / 本地 Markdown。它对 Gitea 的"支持"走的是 **"Other" 自定义 prose 路径**：把工作流用自然语言写进 `docs/agents/issue-tracker.md`，下游 skill 运行时读这个文件照做。官方 FAQ 明确举例"用户已经这样用过：一个 Gitea CLI shaped like `gh`"（docs/engineering/setup-matt-pocock-skills.md:49）。
2. **DSH 插件把这套"prose 文件"机制替换成了编译式的硬编码后端注册表**，内置后端白名单只有 `["github", "markdown", "gitlab"]`（tracker/registry/builtins.js:2，`BUILTIN_ROOM_IDS`）。声明解析器也只识别 github/gitlab/markdown 三个关键词，`# Issue tracker: gitea` 会落入 `unknown-backend` → `no-backend`。
3. 所以答案是**结构性硬编码**，而非依赖 gh CLI 或"没来得及做"：上游的开放性来自"任何 prose 都能当 tracker"，插件把它收敛为"只有注册过的房间（room）才存在"，Gitea/tea 既没有对应的 room 实现（tracker/rooms/ 下只有 github、gitlab、markdown 三个目录），也没有被声明解析器收录。

## 证据明细

### 1. DSH 插件侧：后端是硬编码白名单

- **内置后端白名单**：`tracker/registry/builtins.js:2`
  ```js
  const BUILTIN_ROOM_IDS = ["github", "markdown", "gitlab"];
  ```
  每个后端对应一个动态 import 的 room 模块（`../rooms/github/...`、`../rooms/gitlab/index.js`、`../rooms/markdown/index.js`，builtins.js:4-17）。`tracker/rooms/` 目录下只有 `github/`、`gitlab/`、`markdown/` 三个子目录——**不存在 gitea room**。
- **多后端冲突时的裁决顺序**也是这三个：`tracker/detection/backendDecision.js:4`
  ```js
  const MULTI_CLAIM_ORDER = ["github", "markdown", "gitlab"];
  ```
- **声明解析只认三个关键词**：`tracker/kernel/issue-tracker-declaration.js:5-25`。只有 `# Issue tracker: github|gitlab|markdown|local` 标题（及正文 keyword 回落）能产出 `explicitBackendId`；"gitea" 或 "tea" 不在正则里，会被判为 `unknown-backend`，最终在 `backendDecision.js:274-275` 归为 `no-backend` / `undetermined` 状态——即 `deck_context` 返回"这个 workspace 还没有选 backend"，插件停用。
- **GitLab 后端走 glab CLI**：`tracker/rooms/gitlab/index.js:156`
  ```js
  commandVocabulary: { cli: "glab", cliBrand: "GitLab" },
  ```
  说明插件采用"一个后端 = 一个专用 room + 一个专用 CLI"的设计；要支持 Gitea 就得新写一个 `rooms/gitea/`，把 `cli: "tea"` 全套 preflight、错误分类、fixture/合同（tracker/contract/、capability-assertions.js）都配齐，工作量不小。
- **README 宣称的后端集合**：README.md:113「根据办公环境不同提供多样后端：GitHub、本地 Markdown、GitLab。」——Gitea 从未出现在承诺列表里。全仓 `grep -i gitea` 为 0 命中。

### 2. 上游 mattpocock/skills 侧："支持 Gitea"只是 prose 自定义路径

- **内置模板同样只有三个**：`skills/engineering/setup-matt-pocock-skills/` 下只有 `issue-tracker-github.md`、`issue-tracker-gitlab.md`、`issue-tracker-local.md`；`issue-tracker-gitlab.md` 全文用 `glab` 命令模板。**仓库内没有任何 `tea` 命令模板文件**。
- **Gitea 的支持方式是"Other"**：`docs/engineering/setup-matt-pocock-skills.md:49`
  > "Other" is a full option too. It is how Jira, Linear, Azure DevOps and Beads all work. You describe the workflow, the skill records your prose in `docs/agents/issue-tracker.md` … Users have already built this: a Jira-over-MCP variant, **a Gitea CLI shaped like `gh`**, a hand-built local dashboard.
- **开放性的机制根源**：同文件 :5
  > The skills themselves are identical everywhere. They read `docs/agents/issue-tracker.md` at run time and do what it says. That is why the set is not tied to GitHub…

## 本仓库外的实测复现（jap_data_analysis，2026-11-09）

- 已按 prose 路径写好 `docs/agents/issue-tracker.md`（标题 `# Issue tracker: Gitea (tea CLI)`）并加 remote 指向自建 Gitea（gitea.vvmath.com:8443，tea 0.16.0 已登录）；
- `deck_context` 仍返回 `{"reason":"no-backend"}`；
- 源码验证：`parseIssueTracker` 三条标题正则 + 两条 keyword 回落均不含 gitea/tea；`tracker/detection/` 全目录不读 git remote。
