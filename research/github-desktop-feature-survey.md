# 研究：GitHub Desktop 支持什么功能，以及 DSH 侧边栏要做到什么程度

这份底稿要回答一个问题：**如果要在 DSH 这类开发工具的侧边栏里做一个 Git 功能入口，做到什么程度才能让人不再需要另外打开 GitHub Desktop。**

做法是把 GitHub Desktop 官方文档站（docs.github.com 的 GitHub Desktop 章节）、GitHub Desktop 开源仓库（desktop/desktop）里的开发文档与源码、以及 Git 官方文档（git-scm.com）当作一手来源，逐条查清它有哪些能力、每条能力的边界在哪里。查完之后把能力分成"只读查看""低风险可逆的写操作""高风险或难做好的操作"三档，再对照几款同期工具看看业界的做法，最后给出 DSH 侧边栏第一版应该覆盖什么的排序。

来源分三类，文中逐条标注：一类是 GitHub 官方文档站的用户手册，二类是 desktop/desktop 仓库和 desktop/dugite 仓库里的开发文档与源码，三类是 git-scm.com 的 Git 官方命令手册。没有查到的结论一律写明"没有查到可靠出处"，不做推测。

补充一点：为了跟本仓库已有的调研笔记保持体例一致，读过 <research\github-api-rate-limits-2026-09-22.md> 这一个已有的调研文件作为格式参照。除此之外没有读本工作区的任何业务代码。

---

## 一、GitHub Desktop 的完整功能清单

### 1. 仓库视图与状态

- **添加本地仓库**：可以从菜单添加，也可以直接把文件夹拖进窗口；一次拖多个文件夹会各自添加为一个独立仓库。可以添加任何 Git 仓库，不要求托管在 GitHub 上。出处：[Adding a repository from your local computer to GitHub Desktop](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop)
- **仓库列表与切换**：按 `Command+T`（Windows 为 `Ctrl+T`）可以列出自己的所有仓库；从列表里移除一个仓库是 `Command+Delete`（Windows 为 `Ctrl+Delete`）。这说明 Desktop 允许同时登记多个仓库，但同一时刻只有一个是活动的。出处：[GitHub Desktop keyboard shortcuts](https://docs.github.com/en/desktop/overview/github-desktop-keyboard-shortcuts)
- **当前分支**：工具栏顶部的 **Current Branch** 下拉按钮，显示当前所在分支，可以下拉切换。下拉列表里带一个过滤框，可以按名字筛分支。出处：[Managing branches in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop)
- **worktree 选择器**：在 Repository 和 Branch 两个下拉之间还有一个 **Worktree** 下拉，详见第三节。
- **是否有未提交改动**：左侧边栏的 **Changes** 标签页直接列出所有改动文件，红色图标表示删除、黄色表示修改、绿色表示新增。出处：[Committing and reviewing changes to your project in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)
- **领先/落后状态**：工具栏上的 Fetch origin、Pull origin、Push origin 三个按钮是否可用，就代表本地与远端有没有差异；推送时如果远端有本地没有的提交，会弹出 "New Commits on Remote" 对话框要求先 fetch。出处：[Pushing changes to GitHub from GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/pushing-changes-to-github-from-github-desktop)
- **一键跳转到外部工具**：可以在终端里打开仓库（`Ctrl+\``）、在文件管理器里显示（`Ctrl+Shift+F`）、用默认编辑器打开（`Ctrl+Shift+A`）。出处：[GitHub Desktop keyboard shortcuts](https://docs.github.com/en/desktop/overview/github-desktop-keyboard-shortcuts)

### 2. 提交相关

- **暂存（按文件）**：在 Changes 列表里勾选文件，把文件整体加入本次提交；顶部总勾选框控制"所有文件的全部改动"。出处：[Committing and reviewing changes](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)
- **暂存（按行，做部分提交）**：官方文档有一节专门叫 "Creating a partial commit"。做法是在 diff 视图里点击具体的变更行，那一行的蓝色高亮会消失，表示这一行不进入本次提交，其余改动保留在工作区。这正是"staging 的部分选择"。出处：[Committing and reviewing changes — Creating a partial commit](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)
- **丢弃改动**：可以丢弃一个或多个文件的全部改动、丢弃所有文件的全部改动，也可以只丢弃某几行新增的改动。文档特别说明被丢弃的内容会存成回收站里的一个带日期的文件，清空回收站之前都能恢复。出处同上，节 "Discarding changes"。
- **写提交信息**：提交信息分 Summary（标题）和 Description（正文）两个输入框。如果账号有 GitHub Copilot 权限，可以点按钮自动生成提交信息，也可以指定用哪个模型。还可以给提交添加 co-author。出处同上，节 "Write a commit message and push your changes"；以及 [Configuring Copilot in GitHub Desktop](https://docs.github.com/en/desktop/configuring-and-customizing-github-desktop/configuring-copilot-in-github-desktop)
- **提交钩子**：仓库里的 pre-commit、commit-msg 钩子会在提交时自动运行，也可以针对某一次提交跳过钩子。出处：[Working with Git hooks in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/working-with-git-hooks-in-github-desktop)
- **提交历史**：左侧 **History** 标签页列出提交，每条显示提交信息、时间、作者用户名与头像、提交的 SHA-1 哈希值。可以用 Ctrl 或 Shift 选中一段连续的提交。出处：[Viewing the branch history in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/viewing-the-branch-history-in-github-desktop)
- **修改上一次提交（amend）**：可以改上一次提交的信息，也可以把新的改动并进上一次提交。出处：[Amending a commit in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/amending-a-commit-in-github-desktop)
- **撤销提交（undo）**：把某次提交的改动恢复到工作区，未推送时可用。出处：[Undoing a commit in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/undoing-a-commit-in-github-desktop)
- **重置到某次提交（reset）**：类似 undo，但把选中提交之前所有提交的改动一起恢复到工作区；只能重置到最后一次推送到远端的提交为止。出处：[Resetting to a commit in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/resetting-to-a-commit-in-github-desktop)
- **还原提交（revert）**：新做一次提交来抵消某次提交的改动，适合已经推送过的情况。出处：[Reverting a commit in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/reverting-a-commit-in-github-desktop)
- **摘取提交（cherry-pick）**：把一个分支上的某次提交复制到另一个分支。出处：[Cherry-picking a commit in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/cherry-picking-a-commit-in-github-desktop)
- **重排提交、压缩提交**：在历史里调整提交顺序、把多个提交合成一个。出处：[Reordering commits](https://docs.github.com/en/desktop/managing-commits/reordering-commits-in-github-desktop)、[Squashing commits](https://docs.github.com/en/desktop/managing-commits/squashing-commits-in-github-desktop)
- **检出历史提交**：可以直接 checkout 到某次历史提交。出处：[Checking out a commit in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/checking-out-a-commit-in-github-desktop)
- **上面这七种改历史的手段，官方在 [Options for managing commits in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/options-for-managing-commits-in-github-desktop) 里列成一张表，并逐条写明适用场景。**

### 3. 分支相关

- **新建分支**：可以从任意现有分支新建，也可以从历史里某次提交右键 "Create Branch from Commit" 新建。出处：[Managing branches in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop)
- **发布分支（设置上游）**：本地新建的分支要点 **Publish branch** 才会推到 GitHub 并建立跟踪关系。出处同上。
- **切换分支**：切换时如果工作区有已保存但未提交的改动，Desktop 会弹出窗口让你选"把改动留在当前分支"还是"把改动带到新分支"。这个默认行为可以在 Prompts 设置里改。出处同上。
- **重命名分支**：快捷键 `Shift+Command+R`（Windows 为 `Ctrl+Shift+R`），源码里有专门的 `BranchRenameFailed` 错误处理。出处：[GitHub Desktop keyboard shortcuts](https://docs.github.com/en/desktop/overview/github-desktop-keyboard-shortcuts)；错误码见 [app/src/lib/git/core.ts](https://github.com/desktop/desktop/blob/development/app/src/lib/git/core.ts)
- **删除分支**：菜单 Branch → Delete，快捷键 `Shift+Command+D`（Windows 为 `Ctrl+Shift+D`）。文档写明：有未关闭的 Pull Request 关联的分支不能删；**删掉的分支无法撤销**。出处：[Managing branches in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop)
- **保护分支与 rulesets**：受保护的分支不能删除也不能强制推送；rulesets 可以要求提交签名、要求提交信息以工单号开头、限制分支命名等，Desktop 会在不合规时给出警告并阻止操作。出处同上；以及 [Pushing changes to GitHub](https://docs.github.com/en/desktop/making-changes-in-a-branch/pushing-changes-to-github-from-github-desktop)

### 4. 历史查看与 blame

- **提交历史与文件历史**：见上文"提交历史"。点开某次提交后可以逐个文件看这次提交改了什么。
- **分支比较**：有 Compare 分支功能，快捷键 `Shift+Command+B`（Windows 为 `Ctrl+Shift+B`）。GitHub Desktop 仓库源码里确实有专门的比较界面组件 `app/src/ui/history/compare.tsx` 和 `app/src/ui/history/compare-branch-list-item.tsx`。出处：[GitHub Desktop keyboard shortcuts](https://docs.github.com/en/desktop/overview/github-desktop-keyboard-shortcuts)；组件见 [desktop 仓库 app/src/ui/history 目录](https://github.com/desktop/desktop/tree/development/app/src/ui/history)
- **blame（谁改了这一行）**：**没有查到可靠出处。** 依据是两点：一是 docs.github.com 的 GitHub Desktop 全部章节里没有 blame 页面；二是 desktop 仓库的 `app/src/ui/history` 目录里只有提交列表、文件列表、分支比较、合并入口等组件，没有 blame 相关组件。所以判断 GitHub Desktop 目前没有面向用户的 blame 功能，但这是"查不到"，不是官方声明"没有"。

### 5. 差异查看

- **显示方式可切换**：diff 视图右上角可以在统一视图（改动线性排列）和分栏视图（左旧右新）之间切换，也可以选择隐藏空白字符的改动。出处：[Committing and reviewing changes — Choosing how to display diffs](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)
- **展开完整文件**：默认只显示改动附近几行，可以点行号上下的箭头展开更多，也可以右键 "Expand Whole File" 展开整个文件。
- **单次改动 diff**：Changes 标签页里点某个文件就能看它的未提交改动。
- **两个提交之间的 diff**：History 标签页里点某次提交看它引入的改动；也可以多选一段连续提交。
- **分支之间比较**：见上一节的 Compare 分支。
- **Pull Request 预览**：点 **Preview Pull Request** 会打开一个对话框，显示当前分支与所选 base 分支之间的 diff，并明确提示当前分支能否自动合并进 base 分支。出处：[Creating an issue or pull request from GitHub Desktop](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop)

### 6. 同步相关

- **fetch**：工具栏 **Fetch origin** 按钮。
- **pull**：工具栏有 **Pull origin** 和 **Pull origin with rebase** 两个按钮，用户自己选合并式还是变基式。出处：[Syncing your branch in GitHub Desktop](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop)
- **push**：工具栏 **Push origin** 按钮。
- **推送被拒的处理**：如果远端有本地没有的提交，Desktop 先弹 "New Commits on Remote" 让你 fetch，而不是直接失败。源码里有专门的 `PushNotFastForward` 错误，对应提示语是"仓库在你上次拉取之后已被更新，请先拉取再推送"。出处：[app/src/lib/git/core.ts](https://github.com/desktop/desktop/blob/development/app/src/lib/git/core.ts)
- **强制推送**：有 **Force push origin** 按钮，但有一整套保护：只有"在 Desktop 内完成过变基"的分支才被标记为可强制推送；在 Desktop 之外变基的分支不被标记；默认开启"强制推送前显示确认对话框"，对话框会解释重写分支对其他协作者的影响；实际执行 `git push` 时会带上 `--force-with-lease` 标志，防止在你不知情的情况下覆盖别人刚推上去的提交。出处：[desktop 仓库 docs/technical/rebase-flow.md](https://github.com/desktop/desktop/blob/development/docs/technical/rebase-flow.md)
- **推送体积限制**：单个文件超过 100 MiB、整个推送超过 2 GiB 都会被拒绝；用 Git LFS 跟踪的大文件可以绕开。出处：[Pushing changes to GitHub](https://docs.github.com/en/desktop/making-changes-in-a-branch/pushing-changes-to-github-from-github-desktop)
- **改远端地址**：可以修改仓库的 remote URL（仓库改名或换了归属时用）。出处：[Changing the remote URL for a repository in GitHub Desktop](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/changing-the-remote-url-for-a-repository-in-github-desktop)
- **看 Pull Request、看并重跑 checks、接收通知**：都能在 Desktop 里做。出处：[Viewing a pull request](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/viewing-a-pull-request-in-github-desktop)、[Viewing and re-running checks](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/viewing-and-re-running-checks-in-github-desktop)、[Configuring notifications](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/configuring-notifications-in-github-desktop)

### 7. 标签（tag）

- **创建**：在 History 标签页里右键某次提交选 **Create Tag...**，创建的是附注标签（annotated tag）。出处：[Managing tags in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/managing-tags-in-github-desktop)
- **查看**：提交列表里带标签的提交会显示标签名和向上箭头（表示还没推送到远端）；点开提交详情能看到该提交上的所有标签。
- **删除**：可以删除标签，但**只能删还没推送出去的标签**。
- **推送**：默认创建标签后会随对应提交一起推送。

### 8. stash（储藏）

- **存起来**：在 Changes 标签页的文件列表标题上右键选 **Stash All Changes**。出处：[Stashing changes in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/stashing-changes-in-github-desktop)
- **取回来**：在 Changes 标签页点 **Stashed Changes**，点 **Restore** 恢复，或点 **Discard** 丢弃。
- **限制（重要）**：官方文档原文写的是 "You can only stash one set of changes at a time with GitHub Desktop"，也就是**一次只能存一套**；而且用 Desktop 存的时候是**把全部未保存的改动都存进去**，不能只存一部分。
- **和切换分支的关系**：带着未提交改动切分支时，Desktop 会提示你先暂存或者把改动带到新分支。

### 9. 合并、变基与冲突解决

- **合并一个分支进来**：在 Current Branch 下拉里选 "Choose a branch to merge into 当前分支"，再选目标分支点合并。**如果有冲突，Desktop 会在合并按钮上方给出警告，并且在冲突解决完之前合并按钮不可点。** 出处：[Syncing your branch in GitHub Desktop](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop)
- **压缩并合并**：菜单 Branch → Squash and merge into Current Branch，同样会在有冲突时禁用按钮。
- **变基**：菜单 Branch → Rebase Current Branch，选目标分支，点 Rebase，再点 Begin Rebase 确认。完成后推送时按钮会变成 **Force push origin**。出处同上。
- **冲突解决：GitHub Desktop 自己做不了。** 官方文档在讲完 fetch、pull、merge、rebase 之后，三处都写的是同一句话：让你用文本编辑器、命令行或者别的工具去解决冲突（原文 "Resolve any merge conflicts in your preferred way, using a text editor, the command line, or another tool"）。Desktop 只负责**告诉你有冲突、有几个文件冲突**，以及在 merge 入口处禁用按钮。
- **变基的内部实现值得单独看一眼**，因为它说明了这类操作有多难做：Desktop 用的就是最朴素的 `git rebase <上游> <分支>`。它会**先模拟一遍**来预测会不会冲突，但文档里第 2、3 步（生成补丁、测试补丁能否干净应用）明确写着"目前尚未实现"，追踪在 desktop 仓库的 issue #6960。而且它强制 `rebase.backend=merge`，因为只支持合并后端。出处：[desktop 仓库 docs/technical/rebase-flow.md](https://github.com/desktop/desktop/blob/development/docs/technical/rebase-flow.md) 与 [app/src/lib/git/core.ts 的 gitRebaseArguments](https://github.com/desktop/desktop/blob/development/app/src/lib/git/core.ts)

### 10. 子模块、Git LFS、Fork 与 Pull Request、多仓库并列

- **子模块**：有基本支持，但不是完整界面。源码里有三类专门的子模块错误处理：子模块已从 `.gitmodules` 移除但文件夹还在、子模块指向的位置不存在、子模块指向的提交不存在。另外 GitHub Desktop 自己的已知问题文档里，克隆失败日志显示它实际执行的是 `git lfs clone --recursive`。出处：[app/src/lib/git/core.ts](https://github.com/desktop/desktop/blob/development/app/src/lib/git/core.ts)、[desktop 仓库 docs/known-issues.md](https://github.com/desktop/desktop/blob/development/docs/known-issues.md)
- **Git LFS**：有官方页面，明确写"GitHub Desktop 自带 Git Large File Storage"。出处：[About Git Large File Storage and GitHub Desktop](https://docs.github.com/en/desktop/configuring-and-customizing-github-desktop/about-git-large-file-storage-and-github-desktop)
- **Fork 与克隆**：可以从 GitHub 克隆仓库，也可以 fork 仓库。出处：[Cloning and forking repositories from GitHub Desktop](https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-and-forking-repositories-from-github-desktop)
- **创建 Pull Request**：可以先在本地对话框里选 base 分支、看 diff、确认能否自动合并，然后点 **Create Pull Request** 或 **Create Draft Pull Request**，Desktop 会打开浏览器让你在 GitHub 网页上完成提交。出处：[Creating an issue or pull request from GitHub Desktop](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop)
- **创建 Issue**：Repository 菜单 → Create Issue on GitHub，跳到浏览器。
- **多仓库并列查看**：可以登记多个仓库并在它们之间切换（见第 1 小节），但**没有查到**可以在一屏里同时并列显示多个仓库的官方说明。从界面结构看，Desktop 是"一个窗口、一个活动仓库"。

### 11. 应用本身

- **快捷键**：有完整的官方快捷键页面，分 macOS 和 Windows 两套，分应用级、仓库级、分支级三类。出处：[GitHub Desktop keyboard shortcuts](https://docs.github.com/en/desktop/overview/github-desktop-keyboard-shortcuts)
- **偏好设置**：设置窗口里有 Git 配置、基础设置（含账号、隐私、提示行为）、Copilot 设置、默认编辑器、主题、LFS 等。Git 配置可以按仓库逐个管理。出处：[Configuring and customizing GitHub Desktop](https://docs.github.com/en/desktop/configuring-and-customizing-github-desktop)、[Configuring Git for GitHub Desktop](https://docs.github.com/en/desktop/configuring-and-customizing-github-desktop/configuring-git-for-github-desktop)
- **过滤框**：分支下拉、worktree 列表、创建分支对话框里都有过滤输入框。
- **全局搜索**：**没有查到可靠出处。** docs.github.com 的 GitHub Desktop 章节里没有关于"搜索提交信息"或"搜索文件内容"的页面；官方文档能证实的过滤能力只限于分支列表和 worktree 列表的过滤框。
- **命令行启动**：有一个 `github` 命令行入口，可以从命令行打开仓库。出处：[Launching GitHub Desktop from the command line](https://docs.github.com/en/desktop/overview/launching-github-desktop-from-the-command-line)
- **产品定位（官方自述）**：GitHub Desktop 团队在开发文档里写明，GitHub Desktop 不是 Git 全部功能的替代品，而是让常用工作流更好上手的工具；并且明确说"在高级 Git 用户的工作流和初学者的工作流之间做选择时，我们优先照顾初学者"。这解释了为什么功能重心在日常提交和同步，而不是变基和冲突解决。出处：[desktop 仓库 docs/process/what-is-desktop.md](https://github.com/desktop/desktop/blob/development/docs/process/what-is-desktop.md)

---

## 二、只读、低风险写操作与高风险操作的三档划分

划分标准是两条：一是**这条操作会不会改变工作区、索引或引用的状态**；二是**出错了以后能不能靠一条反向命令把状态恢复回来**。

### 第一档：只读查看，不改变任何状态

- 当前分支名、worktree 名、仓库路径
- 工作区有没有未提交改动、有哪些文件被改动、改动是增是删是改
- 哪些文件已经暂存
- 提交历史列表（时间、作者、提交信息、SHA）
- 某次提交改了哪些文件、每个文件的具体差异
- 分支列表、每个分支的远端跟踪关系、远端有没有我没拉的提交
- 两个提交之间、两个分支之间的差异
- 有没有标签、标签指向哪次提交
- 有没有暂存起来的改动
- 当前是否处于合并或变基进行中、`.git` 目录下遗留的冲突文件有哪些

这一档的特点是：调用的是 `git status`、`git log`、`git diff`、`git show`、`git branch --list`、`git worktree list` 这类纯查询命令，不会写任何文件，**执行错了也不会损坏仓库**。这一档是唯一一个"无论怎么实现都不可能出事故"的档次。

### 第二档：低风险、可逆的写操作

- **暂存与取消暂存**（`git add` / `git restore --staged`）：只动索引，源码文件本身不变，取消暂存就能回到原样。
- **创建分支**（`git branch` / `git switch -c`）：只是多了一个引用，删掉就恢复；不切分支的话连工作区都不动。
- **提交**（`git commit`）：会写历史，但只要没推送，就还能用 undo、amend、reset 找回来。GitHub Desktop 自己就把"未推送时不能 undo"作为能力边界写进了文档。
- **stash 存与取**（`git stash push` / `git stash pop`）：存起来之后改动只是换个地方放着，取回来就回来了。
- **fetch**（`git fetch`）：只更新远端引用，不动工作区也不动本地分支，是这一档里最安全的一条。
- **pull**（`git pull`）：在没有冲突的情况下等价于快进，本地历史不重写；**有冲突时会停在半路**，这时它就掉到第三档去了。

分在这一档的原因是：这些操作要么有明确的反向操作，要么在正常情况下不会破坏已有内容。真正的风险不在命令本身，而在"用户以为会回到原位、其实回不去"。

### 第三档：高风险，或者界面化很困难

- **变基（rebase）**：它会**重写提交历史**。GitHub Desktop 自己做这一块时都要写一整篇技术文档解释怎么模拟、怎么检测冲突、还哪些步骤没做（见 [docs/technical/rebase-flow.md](https://github.com/desktop/desktop/blob/development/docs/technical/rebase-flow.md)），这本身就说明难度。
- **强制推送（force push）**：直接改写远端历史，会覆盖别人已经推上去的提交。GitHub Desktop 为它加了三层保护（只在 Desktop 内变基过的分支才允许、默认弹确认框、实际执行带 `--force-with-lease`），说明这不是一个可以随手点一下的按钮。
- **冲突解决**：GitHub Desktop 干脆不做，只检测并把用户赶去外部工具。对比之下 IntelliJ 和 Fork 都做了自己的合并编辑器，可见这是一个投入产出比很低的功能。
- **丢弃改动**（`git restore` / `git checkout --`）：命令本身不可逆。GitHub Desktop 的做法是先把被丢弃的内容存成回收站文件、承诺清空前可恢复——这是用额外机制把第三档的操作拉回可逆，但也说明它知道这里危险。
- **reset --hard、clean、删除分支、删除 worktree**：删掉的东西 Git 不会主动帮你记着，删分支在 Desktop 里连确认弹窗之后的撤销都没有。
- **切换分支 / 切换 worktree**：单看这一下点击很轻，但它会把整个工作区换成另一个快照。如果在 AI 正在改代码的时候被误触，用户丢的是没提交的改动。**这是所有操作里最"轻点重灾"的一类**。

---

## 三、worktree 的现状

**结论：GitHub Desktop 现在正式支持 worktree，不是"不支持"。** 这点和很多人的印象不一样，官方文档有一整页专门讲这个。

出处：[Managing worktrees in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-worktrees-in-github-desktop)

具体支持到什么程度：

- **入口**：工具栏上 Repository 和 Branch 两个下拉之间，多出一个 **Worktree** 下拉。这个下拉**只有在你已经有至少一个关联 worktree 之后才会出现**；创建第一个要用 Repository 菜单或者右键 Repository 下拉里的 "New Worktree…"。
- **创建**：填一个名字，Desktop 自动按名字推导存放路径并把完整路径显示在对话框里；分支名可以留空（留空就建一个同名新分支），可以填已存在的本地分支名（把那个分支检出到新 worktree），也可以填远端分支名（从远端引用建一个本地分支）。创建完会自动切过去。
- **切换**：在 Worktree 下拉里点另一个 worktree，Desktop 会把工作目录切到那个 worktree 的路径。列表分成 "Main worktree" 和 "Linked worktrees" 两组，每项显示目录名和关联的分支名，顶部有过滤框。
- **重命名**：只能重命名关联的 worktree，**主 worktree 不能重命名**。
- **删除**：只能删关联的 worktree，**主 worktree 不能删，Git 锁定过的 worktree 也不能删**。删除前有确认弹窗，可以勾"以后不再提示"把这个确认关掉（关掉之后要回到设置里的 Prompts 重新打开）。如果删除失败（比如 worktree 里有未提交改动），Desktop 会弹错误框并**询问是否强制删除**；如果用户取消，Desktop 会把工作目录切回原来那个 worktree。
- **每个 worktree 关联一个分支，或者一个 detached HEAD 状态下的提交。** 主 worktree 就是你最初 clone 出来的那个目录。

要理解这些限制为什么存在，得看 Git 自己的定义。Git 官方手册 [git-worktree](https://git-scm.com/docs/git-worktree) 里说：一个仓库有一个主 worktree 和若干个关联 worktree；关联 worktree 和主仓库**共享同一个对象库和大部分引用，但 `HEAD`、索引这类"每个工作目录一份"的状态是各自独立的**；每个关联 worktree 在主仓库的 `.git/worktrees/` 下有一个私有子目录，里面有一个 `.git` 文件指回主仓库，并且用 `GIT_COMMON_DIR` 指回主仓库的 `.git`。所以 worktree 列表可以直接用 `git worktree list` 读，输出里会标出 locked 和 prunable 状态。**Desktop 的 Worktree 下拉本质上就是 `git worktree list` 的图形化。**

Git 官方手册在 BUGS 一节里还有一句要特别注意，原文是："Multiple checkout in general is still experimental, and the support for submodules is incomplete. It is NOT recommended to make multiple checkout of a superproject." 也就是说 **Git 官方自己都说多工作目录这件事整体上还是实验性的**，子模块支持不完整，不建议对包含子模块的仓库做多份检出。这对"要不要在侧边栏里支持 worktree"这个决定是很重要的约束。

**没有查到可靠出处的部分**：GitHub Desktop 官方 issue 追踪器里关于 worktree 的讨论我这次没有查（网页搜索工具不可用，只能直接抓取已知 URL，没能搜索 issue 列表），所以"社区反馈里 Desktop 的 worktree 支持有哪些已知毛病"这一块是空白。另外也没有查到 Desktop 是否支持**在 Desktop 之外用命令行创建的 worktree 能否被识别**——从 `git worktree list` 的机制看应该可以，但这是推测，没有官方文档背书。

---

## 四、GitHub Desktop 背后实际怎么干活

**结论：它既不是内嵌 libgit2，也不是内嵌 JGit。它调用的是真正的 `git` 命令行程序，只不过这个 git 是它自己下载并打包在应用里的，不依赖用户系统上装的那一份。**

证据链如下：

1. **Desktop 有一个自研的 git 调用层，叫 dugite。** 仓库地址 <https://github.com/desktop/dugite>，README 第一句自我描述是 "Dugite - JS bindings for Git"，并说它"让 Node 应用用**和 Git 核心提供的同一套命令行接口**去操作 Git 仓库"。出处：[dugite README](https://github.com/desktop/dugite/blob/main/README.md)
2. **dugite 自己的文档说得很直白**：原文是 "`dugite` is a wrapper on top of the Git command line interface"（dugite 是 Git 命令行接口之上的一层包装）。它暴露的 `exec` 是"怎么和 Git 交互"的核心函数，`spawn` 直接把子进程暴露出来。出处：[dugite docs/overview.md](https://github.com/desktop/dugite/blob/main/docs/overview.md)
3. **Desktop 所有 git 操作都走这个 exec。** 在 [app/src/lib/git/core.ts](https://github.com/desktop/desktop/blob/development/app/src/lib/git/core.ts) 里，核心函数 `git()` 的注释就是 "Shell out to git with the given arguments"（带着参数去 shell 调 git），它调用 dugite 的 `exec(args, path, ...)`，并对退出码和 stderr 做错误解析。文件里那一长串 `DugiteError` 分支（`RebaseConflicts`、`PushNotFastForward`、`LockFileAlreadyExists` 等等）就是它在解析 git 命令返回的英文报错。
4. **这个 git 是自带的那一份。** dugite 的 package.json 里有 `"postinstall": "node ./script/download-git.js"` 和 `"update-embedded-git"` 脚本，install 的时候会自己把 git 下载下来。出处：[dugite package.json](https://github.com/desktop/dugite/blob/main/package.json)。旁证是 Desktop 自己的已知问题文档里提到"Desktop 里自带的内嵌 Git"，并给出过 `resources/app/git/usr/bin/sh.exe` 这样的路径（那是 1.x 时期的路径，现在已不适用，但能说明"内嵌"这个事实）。出处：[desktop docs/known-issues.md](https://github.com/desktop/desktop/blob/development/docs/known-issues.md)

**这个结论对 DSH 的技术选型意味着什么：**

GitHub Desktop 这么成熟的工具都没能绕开 git 命令行程序，说明**用 libgit2 之类的内嵌库来做一个功能完整的 Git 客户端，代价很高**——libgit2 至今在合并、变基、凭证管理这些地方的行为和真正的 git 有细微差别，JGit 同理。GitHub Desktop 的选择是：老老实实 fork 出 git 进程执行，然后把精力花在"怎么把 git 的输出解析成人能看懂的状态"上。

**对 DSH 的直接建议是照抄这个选择：侧边栏调用系统里已经装好的 `git` 可执行文件，不要引入内嵌库。** 这条路已经被验证过，而且 DSH 场景下没有 Desktop 那种"必须自带 git 才能分发"的压力。VS Code 走的是同一条路，官方文档写的是 "Install Git on your machine. VS Code uses this installation for Git operations."，出处：[Source control in VS Code](https://code.visualstudio.com/docs/sourcecontrol/overview)。

需要留意的两个附带差异：Desktop 自带 git 意味着它的 git 版本固定、行为可预期，但也意味着它读不到你系统 git 的新特性；DSH 调系统 git 则相反，行为会随用户装的 git 版本浮动，这是一个需要在错误提示里照顾到的现实问题。

---

## 五、同期替代品的能力对比

目的是看清"业界认为一个 Git 面板应该做到什么程度"，每款列关键点。

**VS Code 的源代码管理面板**
最完整的一个，因为它是编辑器的一部分，可以复用编辑器的 diff 视图。官方文档列出的组成：源代码管理视图（选文件、选行暂存、提交）、diff 编辑器（对比并逐块暂存）、**源代码管理图表**（看提交和分支关系、进来的和出去的工作）、**时间线视图**（单个文件的提交和本地保存历史）、状态栏（当前分支加同步操作）。还有 **blame**、分支/stash/**worktree** 管理、三方合并冲突编辑器。按文件或按行暂存都支持。明确要求用户自己装 git。出处：[Source control in VS Code](https://code.visualstudio.com/docs/sourcecontrol/overview)、[Git branches and worktrees in VS Code](https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees)

**GitKraken**
主打提交图表和合并冲突解决，官网功能导航里有独立的 Commit Graph 和 Merge Conflict Resolution 两个功能页，产品线还有 GitLens（编辑器插件）、CLI、以及面向 AI 代理的集成（Kepler、GitKraken MCP）。定位是给团队用的完整 Git 客户端，比 Desktop 重。出处：[GitKraken 功能页](https://gitkraken.com/features/commit-graph)、[GitKraken Merge Conflict Resolution](https://gitkraken.com/features/merge-conflict-resolution-tool)、[GitKraken Desktop 产品页](https://gitkraken.com/git-client)。**没有查到可靠出处**说明它当前对 worktree 的支持程度。

**Fork**
macOS/Windows 的付费客户端，官网列了完整功能清单，能力明显比 Desktop 多：逐行暂存、blame、看任意提交时的仓库文件树、**可视化交互式变基**、合并冲突辅助工具、看 reflog 找回丢失的提交、在提交列表里直接看到 stash、git-flow、Git LFS、GPG、图片 diff。出处：[Fork 官网功能总览](https://git-fork.com/)

**GitButler**
思路和上面几家都不同，官方自述是"聚焦于你在编辑器里写完代码之后、把东西分享到 GitHub 之前的这一段"。核心概念是**并行分支（parallel branches）**：传统 git 一次只能在一个分支上工作，只有一个 HEAD 和一个索引；GitButler 允许多个分支同时"贴"在你的工作目录上，每个分支显示成一条竖着的泳道，可以把改动在泳道之间拖着走，各自有独立的暂存区。另外有**一等公民的冲突处理**（把冲突拆开）和**操作时间线**（任何操作都能撤销），还有堆叠分支、提交编辑、签名、AI 辅助。出处：[GitButler 文档首页](https://docs.gitbutler.com/)、[Parallel Branches](https://docs.gitbutler.com/features/branch-management/virtual-branches)。**注意它没有提 worktree**。

**OneUp / RelaGit**
没有查到可靠出处。OneUp 的 GitHub 仓库地址和官网在这次抓取中都失败了，无法确认它当前的能力和项目状态，RelaGit 同理。

**IntelliJ IDEA 等 JetBrains IDE 的版本管理面板**
成熟度很高，和 IDE 深度集成：确认提示、目录映射、**变更列表（Changelists）**、GitHub 与 Git 两套独立配置节点，另有主版本控制快捷键页。出处：[JetBrains 版本控制设置](https://www.jetbrains.com/help/idea/settings-version-control.html)、[版本控制集成](https://www.jetbrains.com/help/idea/version-control-integration.html)

**从这六家能读出来的一条行业共识**：真正被认为"够用"的 Git 面板，核心都是同一批东西——**看清当前状态（分支、worktree、改动）、看清历史与差异、选着暂存、提交、推送**。而 Desktop 明确放弃的三件事（做冲突合并编辑器、blame、交互式变基），恰恰是代价最高、最难做好而日常使用频率最低的三件。有意思的是，blame 在 VS Code 和 Fork 里都有，在 Desktop 里没有——说明它做不做是取舍问题，不是有没有能力的问题。

---

## 六、给 DSH 侧边栏场景的启示

**场景定义**：用户的日常是"AI 帮我改代码，我需要随时确认改动全貌、当前在哪个分支和工作区、有没有漏提交"。这个场景有三个特征决定了优先级：

1. **用户的主要焦虑是"不知道发生了什么"，不是"不知道怎么操作"。** 所以第一优先级是让人随时能看到全貌。
2. **用户最怕的是误操作丢改动。** 切分支、切 worktree 这类操作一旦误触，丢的是没提交的东西，代价不对称。
3. **这个场景不需要多任务并行。** Desktop 支持 worktree、GitButler 支持并行分支，都是为了一个人同时推多条线；DSH 场景下用户是"一次专注一件事加一个 AI 陪着改"，多 worktree 是后面的需求。

### 第一版排序

**第 1 优先：只读的状态面板。** 具体是四块：当前 worktree 名 + 当前分支名（并排显示，因为这两个搞混正是用户最怕的事）、工作区未提交改动的文件列表（新增/修改/删除分别标出来）、已暂存/未暂存分别列出、当前分支和远端的领先落后状态。
理由：这完全落在第一档，只用 `git status`、`git worktree list`、`git rev-parse --abbrev-ref HEAD` 这类纯查询命令，**执行错了也不可能损坏仓库**；而它精确命中了用户"随时确认改动全貌、当前在哪个分支/工作区"的核心诉求。

**第 2 优先：差异查看。** 未提交改动的 diff、某次提交的 diff、两个提交或两个分支之间的 diff。
理由：用户要判断"AI 到底改了什么"，diff 是唯一的直接答案；diff 是纯只读的；而且可以复用 DSH 已有的文件读取和渲染能力，成本不高。

**第 3 优先：提交历史。** 当前分支的提交列表，每条显示时间、作者、提交信息首行、SHA 短码；能点开看这次提交改了哪些文件。
理由：用户要确认"有没有漏提交"，需要能对照"AI 说它改了 A 和 B"和"历史里最后一次提交写的是什么"。仍然是纯只读。

**第 4 优先：低风险写操作。** 暂存与取消暂存（含按行选择）、提交、fetch、发布分支。
理由：这四条都在第二档，都有明确的反向操作，界面反馈也直观。**但每一条都必须有明确的二次确认或清楚的撤销提示**，因为用户对这个场景的心智模型是"这是我不懂的东西，AI 在动它"。

**第 5 优先：安全的分支与 worktree 只读列表。** 列出这个仓库下所有 worktree 和分支，标明哪个是当前的、哪个被别的 worktree 占用、哪些有未推送的提交。
理由：**列出**是只读的，让用户"知道有哪些选择"就已经解决了大部分焦虑；但**切换**要放到更后面。切换会让整个工作区换快照，代价不对称。

**第 6 优先：push / pull 这类需要联网的操作。**
理由：功能上必要，但慢、可能失败、会牵涉远端状态，交互上要给出清晰的等待与错误反馈，不适合跟本地操作混在一起。

**明确不放在第一版的：切换分支、切换 worktree、创建/删除 worktree、任何形式的变基、任何形式的强制推送。**
理由：前三项在桌面场景下轻点重灾，后两项 GitHub Desktop 自己做都要写一整篇技术文档加三层保护（见 [docs/technical/rebase-flow.md](https://github.com/desktop/desktop/blob/development/docs/technical/rebase-flow.md)）。**更关键的是：既然 DSH 的 git 视图是只读定位，用户要切换时本来就有一条零风险的出路——用 DSH 自带的侧栏终端手敲 git 命令**，这条出路的存在让"侧边栏不提供危险操作"从"功能缺失"变成了"合理的分工"。

### 一个额外建议

侧边栏除了"分支"之外，应该**把 worktree 名称放在和分支名同等显著的位置**。Desktop 现在就是把 Worktree 下拉放在 Repository 和 Branch 之间（见 [Managing worktrees in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-worktrees-in-github-desktop)），这个信息层级安排本身就说明"worktree 和分支是两件需要同时确认的事"。对一个用 worktree 做并行开发的用户来说，分支名对但 worktree 错了，是最容易犯也最难自己发现的错误。

---

## 七、给决策用的五条结论

1. **GitHub Desktop 现在正式支持 worktree，能新建、切换、重命名、删除，但主 worktree 不能改名不能删、被 Git 锁定的不让删。** 依据：官方有一整页专门文档 [Managing worktrees in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-worktrees-in-github-desktop)，工具栏上有专门的 Worktree 下拉。

2. **GitHub Desktop 底层调的是真正的 git 命令行程序，而且是自己打包的那一份，不是 libgit2 也不是 JGit。** 依据：它的 Git 调用层 dugite 自述是 "a wrapper on top of the Git command line interface"（[dugite docs/overview.md](https://github.com/desktop/dugite/blob/main/docs/overview.md)），Desktop 的核心函数注释是 "Shell out to git"（[app/src/lib/git/core.ts](https://github.com/desktop/desktop/blob/development/app/src/lib/git/core.ts)），dugite 的 package.json 有 `postinstall` 自动下载 git 的脚本（[package.json](https://github.com/desktop/dugite/blob/main/package.json)）。**这直接支持 DSH 侧边栏调用系统 git 的技术选型。**

3. **Git 官方自己说多工作目录（worktree）整体上还是实验性的、子模块支持不完整、不建议对含子模块的仓库做多份检出。** 依据：[git-worktree 官方手册的 BUGS 一节](https://git-scm.com/docs/git-worktree) 原文 "Multiple checkout in general is still experimental, and the support for submodules is incomplete."

4. **GitHub Desktop 主动放弃了冲突解决编辑器、blame 和交互式变基这三件最贵的功能，代价只是"用户偶尔要切到外部工具"。** 依据：冲突部分官方文档三处都写让你 "using a text editor, the command line, or another tool"（[Syncing your branch](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop)）；blame 在官方文档站和源码的 history 目录里都查不到；变基则要靠 [docs/technical/rebase-flow.md](https://github.com/desktop/desktop/blob/development/docs/technical/rebase-flow.md) 里一整套模拟和三层强制推送保护才敢做成按钮。**这印证了第一版应该只做只读展示。**

5. **DSH 侧边栏第一版应该把"worktree 名 + 分支名 + 未提交改动全貌"放在最显眼的位置，并且全部只读。** 依据：只读操作落在不可能出事故的一档，且精确命中"随时确认改动全貌、当前在哪个分支和工作区"这个核心焦虑；而切分支、切 worktree 这类操作轻点重灾，且用户手边已经有侧栏终端这条零风险出路。**排序理由的完整展开见第六节。**

---

## 附：这次没查到什么（诚实记录）

1. **GitHub Desktop 的 blame 功能**——官方文档站全站没有相关页面，源码 `app/src/ui/history` 目录里也没有相关组件。判断为"没有"，但这是查不到而非官方声明。
2. **GitHub Desktop 的全局搜索**（跨提交信息、跨文件内容）——官方文档站没有对应页面。能证实的过滤能力只有分支列表和 worktree 列表的过滤框。
3. **desktop/desktop 仓库 issue 追踪器里关于 worktree 的讨论**——这次环境里网页搜索工具不可用（没有配置搜索服务的密钥），只能直接抓取已知 URL，无法搜索 issue 列表。所以"社区反馈的 worktree 已知毛病"和"Desktop 能否识别命令行创建的 worktree"这两点没有结论。
4. **OneUp / RelaGit 的当前能力**——仓库地址和官网都抓取失败，状态不明。
5. **GitKraken 对 worktree 的支持程度**——抓到的页面是定价和导航，没有功能细节页。
