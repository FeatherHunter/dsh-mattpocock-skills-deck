# 版本管理页面现状调研笔记（只读）

> 调研日期：2026-10-26 ｜ 仓库：`D:\dsh-plugin\dsh-mattpocock-skills-deck`
> 目的：为「版本管理页面整合重构设计稿」提供**现有**功能设计与 UI 设计的事实底稿。
> 方法：只读源码、文案配置、ADR、设计文档、历史评审与 git 记录。**未修改任何文件**；未运行 checkout/reset/clean 之类会动工作区的命令。
> 口径：本文只写事实与证据。凡属推断、或需要在改动前再核一次的，标 **待确认**。
> 落点：`docs/design/` 目录在仓库中已存在，因此笔记直接落在这里，不另建 `research/`。

---

## 0. 页面由谁组成（先看这张图再读四章）

页签的入口是一个客户端组件，构建时把 `src/client/views/versionControl/` 下的模块剥掉行首 `export` 拼回 `src/client/index.ts`（`src/client/views/versionControl/VersionControlTab.ts:2-3`）。

| 层 | 位置 | 职责（证据） |
|---|---|---|
| 入口组件 | `src/client/views/versionControl/VersionControlTab.ts`（461 行） | 状态、effect、渲染分派；`node(b)` 按块的 `kind` 画（`VersionControlTab.ts:300-400`） |
| 模型/块 | `vcBlocks.ts`、`vcData.ts`、`vcViews.ts`、`vcRows.ts`、`vcFold.ts`、`vcText.ts` | 把首屏快照切成块（identity / band / stats / changes / commits / other / terminal / hint / error） |
| 写操作 | `vcWrite.ts`、`vcWriteUi.ts`、`vcWriteOps.ts`、`vcWriteRun.ts`、`vcWriteView.ts` | 预检 → 确认 → 执行 → 结果话术 |
| 差异 | `vcDiff.ts`、`vcDiffOps.ts`、`vcCache.ts`、`vcInView.ts`、`vcTabVisible.ts` | 按需读差异、回包两道闸、缓存、进入视野继续显示 |
| AI 交接 | `vcAiHandoff.ts` | 把面板解决不了的事写成 prompt 开新会话 |
| 样式 | `vcStyles.ts` | 深色 A / 浅色 C 两套皮肤 |
| 宿主取数 | `src/host/versionControl.ts` + `versionControlBasis.ts` / `versionControlFiles.ts` / `versionControlCheck.ts` / `versionControlWrite.ts` | 起 git 进程、解析、组装、七条写电话 |
| 纯核心 | `src/shared/version-control/src/`（commands / parse-* / state / rules / write-ticket / push-plan / ports） | 命令口径 + 解析 + 判定，**不碰进程与磁盘**（`src/shared/version-control/src/commands.ts:4-5`） |
| 文案真源 | 三份 YAML：`config/copy/panel.yaml`（vc 键 zh 在 222–307、en 在 521–606）、`config/copy/vcwrite.yaml`（218 行，zh 13–115、en 116–218）、`config/copy/flow.yaml`（vc 键 zh 在 222–254、en 在 464–496） | 三份都由生成器写成 `src/client/kernel/locale-data.ts`（不入库的生成物，`src/client/kernel/locale-data.ts:1-11`） |

**三种视图**：`VC_VIEWS = ['changes', 'commits', 'worktrees']`（`vcViews.ts:14`），块按视图分流，`other` 与 `terminal` 两块归 `worktrees`（`vcViews.ts:41`）。

---

## 1. 顶部仓库信息条

### 1.1 显示哪些字段

渲染在 `VersionControlTab.ts:313-333`，按 854 布局 C 并成**两行**（注释明写：`VersionControlTab.ts:313`）。

首行（`:315-322`）：

| 字段 | 节点/钩子 | 数据 | 证据 |
|---|---|---|---|
| 仓库（工作树）名 | `data-vc-worktree` | `b.name`，悬停给完整路径（`b.nameTip`） | `VersionControlTab.ts:316` |
| 分隔斜杠 `/` | — | 常量 | `VersionControlTab.ts:318` |
| 分支 | `data-vc-branch` | `b.branchText`；游离头时换成 `b.oidTip`，颜色 `b.branchTone` | `VersionControlTab.ts:319` |
| 提交短号 | `.dsws-vc-mono` | 仅游离头等场景才画 `b.oidText` | `VersionControlTab.ts:320` |
| 超前/落后 | `data-vc-sync` | `b.sync.text`，右对齐（`marginLeft:auto`），悬停 `b.sync.tip` | `VersionControlTab.ts:321` |

次行（`:323-332`）：路径 `data-vc-path`（`:324`），「读取于」`data-vc-readat` 里的 `when`（`:327`），「远端信息更新于」`data-vc-basis`（`:329`），「重新读取」按钮 `data-vc-reload`（`:331`）。三段之间用中点 中点（U+00B7） 分隔，**有哪段才画哪段前面的点**（`:326,328`）。

### 1.2 数据来源

一条电话 `wf.gitStatus` 拿全首屏，宿主 `readScreen` 串起下面这些命令（`src/host/versionControl.ts:242-306`）：

1. 第 0 步判仓库：`rev-parse --absolute-git-dir --is-inside-work-tree --is-bare-repository`（`src/shared/version-control/src/commands.ts:52-54`；调用 `src/host/versionControl.ts:165`），再 `rev-parse --show-toplevel` 拿仓库根（`versionControl.ts:171`）。
2. 版本下限：`git --version` + `tierFor(parseVersion(...))`，低于 2.11 直接回 `unsupported`（`versionControl.ts:245-250`）。
3. 状态：`status --porcelain=v2 --branch -z --untracked-files=all --find-renames`（`commands.ts:73`；调用 `versionControl.ts:263`）。超前/落后取自 `# branch.ab`，上游缺失形态取自 `# branch.upstream`，游离头取自 `# branch.head`（ADR 表见 `docs/adr/20261002-version-control-readonly-no-network.md:32-38`）。
4. 「远端信息更新于」（依据时间）：`git reflog show --date=iso-strict --format=%gD -1 <upstream>` 取末条时间；取不到退**这个上游自己的**松散引用文件 `refs/remotes/<upstream>` 的落盘时间；两条都不通回 `null`（`src/host/versionControlBasis.ts:69-77`、`:51-66`）。**不许**拿 `packed-refs` 的 mtime 顶替（`versionControlBasis.ts:47-50`；ADR `docs/adr/20261002-version-control-readonly-no-network.md:21`）。
5. `readAtMs` 由宿主在组装完成时写一个 `Date.now()`（`versionControl.ts:305`），即「读取于」。

五种分支状态与界面话术的对应见 ADR 表格（`docs/adr/20261002-version-control-readonly-no-network.md:32-38`），词条为 `vc.sync.aheadBehind` / `vc.sync.noUpstream` / `vc.sync.upstreamGone` / `vc.sync.detached` / `vc.basis.at` / `vc.basis.unknown`（`config/copy/panel.yaml:238-246`）。

### 1.3 可点操作与状态

| 操作 | 忙 | 空/禁用 | 错误 | 证据 |
|---|---|---|---|---|
| 重新读取 | 按钮加 `dsws-fb-busy`，文字换成 `fb-t` + `dsws-spinner` 两段（文字与转圈都 `aria-hidden="true"`），并 `disabled` | 非忙时是可点的链接形态按钮 | 由 `hint`/`error` 块承载（下同） | `VersionControlTab.ts:331`；`:301`（hint+重试）、`:302-308`（error+重试） |
| 仓库名 / 分支 / 同步 / 路径 / 依据时间 | — | — | — | 全是 `tipNode(...)` 包一层悬停，**没有键盘入口**（见 §5.5） |

「重新读取」是这一页唯一的刷新入口，明确**不是定时器**（`VersionControlTab.ts:223-224`）。此前的「重新读一次」一度是链接形态，后来改回按钮（提交 `ba5e31ac`）。

### 1.4 分页与加载策略

身份条不分页；整条随首屏一起到。首屏未到时的占位是骨架块（`#857` P5 的修法，见 `docs/design/857-version-control-perf-review.md:44-52`；提交 `92049512` 按真实块尺寸重画骨架）。页签进出有按工作区暂存的缓存：先画旧的再后台验新（提交 `ec49b7b6`；`vcCache.ts`）。

### 1.5 文案来源

`vc.sync.*`、`vc.basis.*`、`vc.readAt`、`vc.reload`、`vc.identity.worktreeTip`、`vc.detached*`（`config/copy/panel.yaml:235-247,296-298`；en 段 `:546,596`）。依据时间那句悬停解释在 `vc.basis.tip`（`panel.yaml:246`）——注意它与页面自带的「更新」按钮在语义上相抵，评审已记为 P1-12（`docs/review/20261026-version-control-ui-review.html:836`）。

### 1.6 键盘与 aria

- 身份行全部字段都是 `span` + 悬停包裹，**无 `tabIndex`、无 `role`**（`VersionControlTab.ts:316-330`）。
- 「重新读取」是真 `<button type="button">`，`disabled` 时同时仍是原生可聚焦语义（`VersionControlTab.ts:331`）。
- 焦点样式：只有输入框有明确焦点环（`vcStyles.ts:113`，评审记 P2-5：`docs/review/20261026-version-control-ui-review.html:842`）。

---

## 2. 「改动」页签

### 2.1 显示哪些字段

- **数字条**：`vc.stats.conflict` / `staged` / `unstaged` 三个计数（`vcViews.ts:66-85`；词条 `config/copy/vcwrite.yaml:49-51`）。三个数字口径不同却并排，评审记 P1-9（`docs/review/20261026-version-control-ui-review.html:833`）。
- **变更分组**：已暂存 / 存在冲突 / 未暂存 三组，组标题带数量（`vc.group.staged|conflict|unstaged`，`config/copy/panel.yaml:252-254`）；`已暂存 0` 时该组不渲染（`vcBlocks.ts:176-181`；评审 P2-2 `:839`）。
- **文件行**：两行排布，首行徽章 + 状态词 + 路径（`vcMiddle` 砍中段、保留文件名那头，`vcText.ts:68-78`），次行行数 / `add` 按钮（`VersionControlTab.ts:264-291`；提交 `f1c557bd`「文件行改两行排布」）。
- **提示带**：合并 / 变基 / 拣选 / 回退 / 冲突，左侧 3px 语气色条 + `!` 标记 + 主句 + 正文 + 右侧 AI 交接按钮（`VersionControlTab.ts:309-312`，注释明写「按 854 原型画」`VersionControlTab.ts:310`；词条 `panel.yaml:224-232`）。
- **提交区**（视图条，两行）：首行「提交」标签 + `add 全部` + 「提交说明」标签；次行输入框 + `提交 N 个文件`（提交 `ce26f468`「视图条改成原型两行排布」；渲染见 `vcWriteView.ts:116-145`，评审证据 `docs/review/20261026-version-control-ui-review.html:826-827`）。
- **差异视图**：点开一行后原地展开：`scopeText`（说明这段差异指哪一段）+ hunk 标题与行区间 + 逐行 `add/del/context/hunk/filehead` 着色 + `shownNote`（`VersionControlTab.ts:243-262`）。

### 2.2 数据来源

| 数据 | 来源 |
|---|---|
| 三组文件清单与计数 | `status --porcelain=v2 --branch -z`（`commands.ts:73`）解析后由核心 `assemble` 组装（`src/host/versionControl.ts:296-303`） |
| 每文件增删行数 | `diff --numstat -z --no-ext-diff --find-renames HEAD`（`commands.ts:86-87`） |
| 单个文件补丁 | `diff --unified=3 --no-color --no-ext-diff --no-prefix --find-renames HEAD -- <path>`（`commands.ts:90-91`），走 `wf.gitDiff` 电话（`src/host/versionControl.ts:315-318` → `versionControlFiles.ts`） |
| 补丁行数上限 | 每份最多 200 行（`#857` P3 记账：`docs/design/857-version-control-perf-review.md:33`） |

命令前缀挡掉用户全局配置：`--no-optional-locks`、`--literal-pathspecs`、`push.followTags=false`、`push.default=nothing`、`core.quotepath=false`、`color.ui=false`、`i18n.logOutputEncoding=UTF-8`（`commands.ts:32-49`）。

### 2.3 可点操作与状态

| 操作 | 忙 | 空 | 错误 | 禁用判据 |
|---|---|---|---|---|
| 单行 `add` | `vc.op.running`（`vcwrite.yaml:84`） | 无未暂存 → `vc.block.nothingToStage` | 结果条/横幅（见下） | `judgeStage`：裸仓库 block、无未暂存 block、进行中 warn（`src/shared/version-control/src/rules.ts:41-47`） |
| `add 全部` | 同上 | 同上 | 同上 | 同上；**无确认、无「撤回全部」**（评审 P1-6 `:830`） |
| 行内 `撤回`（unstage） | 同上 | 暂存区为空 → `vc.block.nothingStaged` | 同上 | 暂存与撤回都**不走票据**：`handleGitStage`（`src/host/versionControlWrite.ts:191`）与 `handleGitUnstage`（`:205`）直接 `runOne`，票据比对在 `:160` 的共用门里、只服务提交/拉取/推送；`reset HEAD -- <路径>`（`commands.ts:120-122`） |
| 提交 `提交 N 个文件` | 忙态 spinner + 禁用（`vcWriteUi.ts:102-106`，评审 P1-11 `:835`） | 未填说明 → `vc.commitArea.needMessage`（`vcwrite.yaml:83`）；暂存为空 → `vc.block.nothingStaged` | 失败话术见 `vc.writeErr.*` | `judgeCommit`：裸仓库/冲突/暂存空 block，游离头/进行中 warn（`rules.ts:49-58`） |
| 展开/收起一行差异 | 读取中画三条骨架条（`VersionControlTab.ts:247-251`） | — | `d.text` + 重试按钮（`VersionControlTab.ts:252-254`） | 同键在途不重复发（`vcDiffOps.ts`；`#857` P4 修法 `docs/design/857-version-control-perf-review.md:37-42`） |
| 让 AI 帮我解决 | — | — | — | `vc.action.aiHandoff`（`vcwrite.yaml:98`）；按钮在提示带右侧（`VersionControlTab.ts:311`） |
| 拉取 / 更新 / 推送 | 见 §2.6 | — | 见 §2.6 | 模型仍在身份块里，**控件搬进了视图条**（`VersionControlTab.ts:313` 注释） |

写操作统一走「预检 → 票据 → 执行」：预检电话 `wf.gitWriteCheck` 读一次首屏 → `rules.judge` → 发票（id + 120 秒有效期 + headOid + repoRoot + 索引指纹 + 目标）；执行电话先过纯判定再比状态，**任何写命令之前必须先过票据门**（`docs/adr/20261004-version-control-write-path.md:35-40`）。推送三档 `existing` / `set-upstream` / `recreate`（同上 `:13`），永远显式 refspec、不裸 push（`commands.ts:129-141`）。

### 2.4 分页与加载策略

- 文件行首批 10 条、每批 +10（`vcBlocks.ts:41,43`）。
- 「还能显示更多」不靠点击，靠 `IntersectionObserver`：这句话进入视野且还有没显示的，就接着显示下一批（`vcInView.ts:13-18`，提交 `c14ec7ad`「三处统一成进入视野就接着显示」）。三处落点：改动页每个文件分组、工作树页、提交历史页（`vcInView.ts:13-15`）。
- 折叠阶梯按面板高度决定每组行数与「其他工作树」是列表还是摘要（`vcFold.ts:179-189`）。
- 单批行数上限 200，因此**没有上虚拟滚动**——理由记在 `docs/design/857-version-control-perf-review.md:72`。
- 差异缓存只留 40 条、按首次写入顺序淘汰（不是 LRU，注释如实写清）：`docs/design/857-version-control-perf-review.md:35`。
- 每次 `setReads` 整块重建 DOM，无 memo，**记账为非缺陷**：同上 `:62-63`。

### 2.5 文案来源

- 动作词：`vc.action.stage` / `stageAll` / `unstage` / `commit`（`config/copy/vcwrite.yaml:14-17`）。注意行内动作就叫「add」「add 全部」，与页面其余中文脱节，评审记 P2-1（`docs/review/20261026-version-control-ui-review.html:838`）。
- 提交区：`vc.commitArea.placeholder` / `hint` / `needMessage`（`vcwrite.yaml:47-48,83`）；`vc.viewbar.submit` / `inputLabel`（`:52-53`）。
- 阻塞理由：`vc.block.*`（`vcwrite.yaml:24-34`），理由标识符在 `rules.ts:15-31` 的 `REASONS` 表，**中文话术只在客户端词表里**（`rules.ts:6`）。
- 警告：`vc.warn.*`（`vcwrite.yaml:35-37`）。
- 失败：`vc.writeErr.*` 每条带一句主话 + 一句 `*.limit`（面板能力边界），`vcwrite.yaml:56-77`。
- 结果：`vc.op.running|done|failed|unknown`、`vc.op.doneStage|doneUnstage|doneCommit`（`vcwrite.yaml:84-93`）。
- 生成链：YAML → `node scripts/generate-locale-config.mts` → `src/client/kernel/locale-data.ts`（`vcwrite.yaml:3-11`；`src/client/kernel/locale-data.ts:1-11`）。

### 2.6 拉取 / 更新 / 推送的状态矩阵（`rules.ts`）

| 操作 | block 的情形 | warn 的情形 | 证据 |
|---|---|---|---|
| 拉取 | 裸仓库、游离头、无上游、上游已删、有冲突、进行中（合并/变基/拣选回退） | 工作区不干净（**#976 起不再一律拦住**）、依据时间未知 | `rules.ts:60-73` |
| 推送 | 裸仓库、游离头、无上游、上游已删、有冲突、进行中、落后远端 > 0 | 依据时间未知 | `rules.ts:75-89` |
| 更新（fetch） | 只有裸仓库 | 无 | `rules.ts:94-97` |

- 拉取只认 `git pull --ff-only`（`commands.ts:126-128`）。
- 更新只取远端跟踪引用、不合并、不碰工作树（`commands.ts:142-147`），电话 `wf.gitFetch`（`src/host/versionControl.ts:374`），话术 `vc.action.fetch` / `vc.op.doneFetch` / `vc.pickRemote.fetch*`。
- 多远端不替用户挑，回候选让用户选（ADR `docs/adr/20261004-version-control-write-path.md:13`；词条 `vc.pickRemote.*` `vcwrite.yaml:78-81`）。
- 确认框是**跟在按钮下面的气泡**（不再贴底整宽），点外面与 Esc 都能关（提交 `bcd84cf9`；`vcWriteView.ts:179-182` 的 `role="dialog"` + `position:absolute` + `data-vc-popover`；`VersionControlTab.ts:435-443` 的 Esc）。
- 确认框有效期 120 秒，词条 `vc.confirm.ttl`（`vcwrite.yaml:82`）。

### 2.7 键盘与 aria

- 视图条按钮是真 `<button type="button">`（`vcWriteView.ts:122,140`，评审证据）。
- 文件行是**带 `onClick` 的 `div`，无 `tabIndex` / `role` / 键盘事件**——评审 P1-8 与本轮 §8 场景都指着这一条（`docs/review/20261026-version-control-ui-review.html:786,794,832`，证据行 `VersionControlTab.ts:264-291`）。
- 禁用原因只进自定义悬停层，`disabled` 元素又不可聚焦，键盘用户拿不到原因（评审 `:788,796`）。
- 忙态无 `aria-busy`，结果区无 `role="status"` / `aria-live`（评审 P1-11 `:835`）。
- 差异的 scope / hunk 说明是普通文本，没有 `aria-describedby` 关联（`VersionControlTab.ts:258-259`）。
- 确认框 `role="dialog"` 但**没有焦点陷阱与初始焦点**（`vcWriteView.ts:179`，**待确认**：是否有别处补焦点）。

---

## 3. 「提交历史」页签

### 3.1 显示哪些字段

- 提交行：编号徽章打头 + 短号 + 标题居中 + 时间右对齐（提交 `c34fd794`「提交历史行与工作树行按原型补徽章」）。解析字段来自 `log --format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%P%x00`（`commands.ts:82`），即完整哈希、短哈希、作者名与邮箱、作者时间、提交时间、标题、父提交。
- 空仓库：`vc.noCommits` + `vc.noCommitsTip`（`config/copy/panel.yaml:233-234`）。
- 点开某个提交后的详情：标题 `vc.commit.title`（`panel.yaml:285`）、返回 `vc.commit.back`（`:286`）、文件数 `vc.commit.files`（`:294`）、空提交 `vc.commit.empty`（`:293`）、合并提交两种说法 `vc.commit.merge` 与 `vc.diff.mergeCommit`（`:291-292`）、过大 `vc.commit.truncated`（`:290`）、失败 `vc.commit.fail`（`:289`）、读取中 `vc.commit.loading`（`:288`）。

### 3.2 数据来源

- 首屏那一枪 `wf.gitStatus` **已经带了 `commits`**（`src/host/versionControl.ts:284-291`，一次 50 条：`versionControl.ts:57`）。`#857` 曾误判「历史要等第二条电话」，复查后推翻并如实记录（`docs/design/857-version-control-perf-review.md:65-66,75-79`）。
- 往回翻更早的走 `wf.gitLog`：`log -n (count+1) --skip=<skip>`，多要一条用来判 `hasMore`（`commands.ts:79-83`；`versionControl.ts:321-340`），批大小上限 200（`versionControl.ts:58`）。
- 单提交的变更清单：`show --numstat -z --no-ext-diff --find-renames --format= <rev>`（`commands.ts:86`）。
- 单提交里某文件的补丁：`show --unified=3 --no-color --no-ext-diff --no-prefix --find-renames --format= <rev> -- <path>`（`commands.ts:90`）。
- 提交号形状只许 4–64 位十六进制（`commands.ts:64` 的 `REV_PATTERN`），**路径、分支名、选项一律不许从这里进 argv**（`commands.ts:66-68`）。
- 合并提交的两条真机事实：`show --numstat` 给的是「相对第一个父提交」的行数；`show -p` 走组合差异、默认不展开（空）——后者必须由宿主如实说明，不能当成「没有改动」（`commands.ts:14-17`）。

### 3.3 可点操作与状态

| 操作 | 忙 | 空 | 错误 | 证据 |
|---|---|---|---|---|
| 点开一次提交 | 清单还在读时先画**三条骨架条**占位，「正在读」那句保留 | 空提交 / 合并提交各一句话 | `vc.commit.fail` + 重试 | 提交 `08ce3537`；骨架渲染同 `VersionControlTab.ts:247-251` 一族的画法 |
| 返回未提交改动 | — | — | — | `vc.commit.back`（`panel.yaml:286`） |
| 点开提交里的一个文件看差异 | 骨架 | — | 失败 + 重试 | `vcDiffOps.ts` 的 `vcReadCommitFileDiff` / `vcApplyCommitFileDiffReply`（`VersionControlTab.ts:215`） |
| 加载更多（更早的提交） | — | `vc.commits.allLoaded` | `vc.commits.fail` + `vc.retry` | `vcBlocks.ts:255-257` |

历史上一处已修的坑：点开提交时**先切视图再记录**，否则记录被清空盖掉（提交 `dffef336`）；页签点击同时离开提交详情，显示与记忆不再分叉（提交 `753e61fa`）。

### 3.4 分页与加载策略

- 首屏 50 条（`versionControl.ts:57`），往回翻按 `skip` 递增（`vcData.ts:311-315` 的 `vcNextSkipOf = screen.commits.length + log.fetched`）。
- 「还能显示更多」进入视野自动加载（`vcInView.ts:13-18`）。
- 面板高度不够时提交历史会收成折叠档（`vcFold.ts:179-189` 的 `commitsCollapsed`）。
- 提交详情视图与「改动」视图互斥：一次只看一件事（854 布局 C 的设计前提，见 §6.3）。

### 3.5 文案来源

**这一页的文案分在三份 YAML 里，不是一份**：

- 提交详情与空仓库：`vc.commit.*`（`config/copy/panel.yaml:285-294`）、`vc.diff.mergeCommit`（`panel.yaml:292`）、`vc.noCommits` / `vc.noCommitsTip`（`panel.yaml:233-234`）、`vc.row.typeUnknown`（`panel.yaml:295`、「仅有路径与增删行数时无法判定变更类型」）、`vc.retry` / `vc.staleHint`（`panel.yaml:222-223`）。
- 列表与页签：`vc.commits.title`（=「提交历史」，同时充当页签名）、`more` / `loading` / `allLoaded` / `fail` / `expand` / `tip`（`config/copy/flow.yaml:248-254`；en `:490-496`）。
- 另两页页签名：`vc.views.changes`、`vc.views.worktrees`（`config/copy/vcwrite.yaml:54-55`）——**没有 `vc.views.commits`**，提交页签借的是 `vc.commits.title`（`vcViews.ts:61-63`）。

### 3.6 键盘与 aria

- 提交行同样是可点的行，评审把「行不可聚焦」列为 P1-8 的一部分（`docs/review/20261026-version-control-ui-review.html:832`，证据 `VersionControlTab.ts:264-291`）。
- 「编号徽章」是展示性文字，未标 `aria-hidden`，读屏会念出短号（**待确认**：是否有意为之）。
- 页签本身有 `role="tab"` + `aria-selected`（`vcViews.ts:58`），外层是 `role="tablist"`（`vcViews.ts:60`）；三颗页签的文案与数字是拼在一个 `<button>` 里的（`vcViews.ts:61-63`），**没有 `aria-controls`，也没有 `role="tabpanel"`**（全目录只有 `vcViews.ts:58,60` 与 `vcWriteView.ts:179` 三处 `role=`）。

---

## 4. 「工作树」页签

### 4.1 显示哪些字段

两块，都归 `worktrees` 视图（`vcViews.ts:41`）：

1. **其他工作树**（`vcBlocks.ts:274-288`）：标题 `vc.other.title` 带数量（`:276`）、悬停说明 `vc.other.tip`（`:278`，明写「此处不列出未检出的本地分支，因此不是分支全貌」`panel.yaml:256`）、每行由 `vcOtherRowOf` 生成（`:262`）、两档形态 `list` / `summary`（`fold.otherMode`）、摘要档最多列 20 个名字（`VC_OTHER_SUMMARY_NAMES`，`vcBlocks.ts:45`）其余明说还有几棵（`:271-285`）、空 `vc.other.empty`（`:287`）。
2. **需手动处理的事项**（`vcBlocks.ts:289`）：一行 `vc.terminal`，悬停 `vc.terminalTip`，右侧挂 AI 交接按钮（`ai: { kind: 'boundary' }`）。渲染在 `VersionControlTab.ts:386-391`，`data-vc-terminal`；AI 按钮 `:390`。

行内语气词：`vc.other.locked`（已被占用）、`vc.other.lockUnknown`（无法显示，且明写「无法判断不等于未被占用」）、`vc.other.prunable`（目录不存在）、`vc.other.prunableUnknownTip`、`vc.other.bare`（裸仓库）、`vc.other.noBranch`、`vc.other.more`（`config/copy/panel.yaml:261-268,306-307`）。

### 4.2 数据来源

- `git worktree list --porcelain -z`（`commands.ts:76`）；老版本 git 不认 `-z` 时退回换行形态，并把这次用的哪一种写进回包（`src/host/versionControl.ts:269-271` 的 `worktreesNul`，回包字段见 `:305`）。
- 解析器 `parseWorktrees`（`import` 见 `versionControl.ts:38`）；读不全就整体失败，**不给半份列表**（`versionControl.ts:274`）。
- 「需手动处理的事项」这一行没有数据来源，是**常量文案**（`vcBlocks.ts:289`）。
- AI 交接的 prompt 由当前快照拼成：`vcAiHandoffOf({ ai, t, screen })`（`VersionControlTab.ts:211`），标题与正文词条是 `vc.ai.*`（`vcwrite.yaml:99-115`），**只填能自动填的事实，目标与补充留给用户**（提交 `e94b0a44`）。开新会话用 `opener(st, body, title, { kind: 'fix' })`（`vcAiHandoff.ts:85`），opener 缺席或抛错都回 `false` 不崩（`:84`）。

### 4.3 可点操作与状态

| 操作 | 忙 | 空 | 错误 | 证据 |
|---|---|---|---|---|
| 加载更多工作树 | — | 不存在其他工作树 → `vc.other.empty` | — | `VersionControlTab.ts:384`（`data-vc-other-more`，进入视野自动加载 `vcInView.ts`） |
| 让 AI 帮我解决（边界那条） | 无忙态 | — | — | `vcBlocks.ts:289` + `VersionControlTab.ts:390` + `vcAiHandoff.ts:78` |
| 去命令行做具体操作 | — | — | — | 只有文字说明，**没有按钮、没有命令可复制**（`panel.yaml:269-270`） |
| 切换 / 创建工作树 | **不存在** | — | — | 见 §8 遗留 |

**明确的能力边界**：面板不做部分暂存、合并、变基、冲突解决、切分支/工作树、强推、amend、stash、子模块、tag，一律指命令行（`docs/adr/20261004-version-control-write-path.md:57`）。「需手动处理的事项」这块就是这句话的界面化身（`panel.yaml:270`）。

### 4.4 分页与加载策略

- 其他工作树同样「默认 10 条 + 分批展开」，一千个工作树时不该一次画一千行（`vcBlocks.ts:266-269`）。
- 面板高度不够时收成摘要档（`vcFold.ts:179-189`）。
- `vc.other.more` 文案写「下滑会自动显示」（`panel.yaml:306`），与 `vcInView.ts` 的进入视野即加载一致。

### 4.5 文案来源

`vc.other.*`（`config/copy/panel.yaml:255-268,306-307`）、`vc.terminal` / `vc.terminalTip`（`:269-270`）、`vc.action.aiHandoff` + `vc.ai.*`（`config/copy/vcwrite.yaml:98-115`）。AI 交接这一族 2026-10 才重写过预填内容（提交 `e94b0a44`）。

### 4.6 键盘与 aria

- 工作树行与「加载更多」是 `div`/`span` + `onClick`（`VersionControlTab.ts:384`），无 `tabIndex`/`role`。
- AI 按钮是真 `<button type="button">`，带 `data-vc-ai`、`data-press`、`data-log`（`vcAiHandoff.ts:78`），可聚焦。
- 「需手动处理的事项」整块无标题语义（只是 `div`，`VersionControlTab.ts:386`），读屏不会把它报成一个区块。

---

## 5. 横切事实

### 5.1 视图切换与记忆

`vcViews.ts:14` 定义三视图；模块级 `vcViewMemory` 跨挂载记住上次视图，`vcResetViewMemory` 回 `changes`（`vcViews.ts:16-19`）。页签按钮：`role="tab"` + `aria-selected` + `data-vc-view` + `data-press="tab"` + `data-log="vc.tab.<key>"`（`vcViews.ts:58`），外层 `role="tablist"`（`vcViews.ts:60`）。三颗页签的数字是**拼进按钮文字**里的、不加括号（`vcViews.ts:54-55,61-63`，注释说「原型里这三颗不收数字，数字已经并进 label 了」）：改动按文件数（冲突+已暂存+未暂存）、提交历史按已读条数、工作树按棵数（`vcViews.ts:21-29`）。

### 5.2 缓存

已读数据按工作区暂存，进页签先画旧的后台再验新（提交 `ec49b7b6`；`vcCache.ts`），命中/未命中/淘汰只记 `debug` 级日志、目录用散列前 8 位（`vcCache.ts:5-6,17`）。

### 5.3 折叠与「分批显示」

`vcFoldOf` 按面板高度算 `band / otherMode / commitsCollapsed / ladder`（`vcFold.ts:179-189`）。折叠不是隐藏，而是换形态并在悬停里给全文（规格第 5 条，`vcBlocks.ts:270`）。

### 5.4 日志

`git.exec` / `git.exec.fail`（起进程）+ `host.call` / `host.call.fail`（电话层，失败带 `errorKind`），`via` 一律 `version-control`；提交信息原文、凭据、远端地址原文一律不进日志（ADR `docs/adr/20261004-version-control-write-path.md:61`；实现 `src/host/versionControl.ts:52,147,349-355`）。目录只记 `dirHash`（`versionControl.ts:78-82`）。

### 5.5 键盘与 aria 的全局现状（汇总）

| 项 | 现状 | 证据 |
|---|---|---|
| 页签 | `role="tab"` + `aria-selected`，外层 `role="tablist"`，可聚焦；缺 `aria-controls` 与 `role="tabpanel"` | `vcViews.ts:58,60` |
| 按钮 | 真 `<button type="button">`，可聚焦 | `vcWriteView.ts:122,140`；`vcAiHandoff.ts:78`；`VersionControlTab.ts:331` |
| 文件行 / 提交行 / 工作树行 / 「加载更多」 | `div`/`span` + `onClick`，**无 tabIndex / role / 键盘事件** | `docs/review/20261026-version-control-ui-review.html:786,794,832`（证据行 `VersionControlTab.ts:264-291,384`） |
| 禁用原因 | 只进自定义悬停层；`disabled` 元素不可聚焦 | 评审 `:788,796` |
| 焦点样式 | 只有输入框明确指定；页签与按钮吃浏览器默认 | `vcStyles.ts:113`（评审 P2-5 `:842`） |
| 忙态 | spinner + 禁用；**无 `aria-busy`** | 评审 P1-11 `:835`；`VersionControlTab.ts:331` 的 `aria-hidden` 用法 |
| 结果播报 | 无 `role="status"` / `aria-live` | 评审 P1-11 `:835` |
| 确认框 | `role="dialog"`，Esc 可关 | `vcWriteView.ts:179`；`VersionControlTab.ts:435-443`（焦点陷阱：**待确认**） |
| 窄屏 | 视图条靠 `flex-wrap` 任意换行，标签与输入框会分离 | `vcStyles.ts:143-144`（评审 P1-10 `:834`） |

### 5.6 门禁（tests/）

`verify-818-version-control-view`、`verify-version-control-host`、`verify-version-control-parsers`、`verify-version-control-rules`、`verify-841-write-phones`、`verify-842-version-control-write-view`、`verify-847-stall-watch`、`verify-976-pull-dirty-warn`、`verify-997-vc-sight`、`verify-997-vc-sight-browser`（文件在 `tests/` 下，均为 `verify-*.ts`）。此外 `#857` 记账的门禁相关约定见 ADR `docs/adr/20261004-version-control-write-path.md:62`。

---

## 6. 设计稿、原型与被放弃的方案

### 6.1 原型家族（都在 `docs/prototype/`，是「抛弃式设计稿」）

| 文件 | 轮次与作用 |
|---|---|
| `852-vc-index.html`、`852-vc-readonly.html`、`852-vc-write.html`、`852-vc-diff.html`、`852-vc-controls.html`、`852-vc-kit.css` | 第一轮全套原型（被 853 的页面链接为「上一轮全套原型」，`docs/prototype/854-vc-layouts.html:20`） |
| `853-vc-styles.css` / `853-vc-styles.html` / `853-vc-readonly.html` / `853-vc-write.html` / `853-vc-diff.html` / `853-vc-controls.html` / `853-vc-lib.ts` | 第二轮：换**视觉语言**，给三套风格（A 工程台账 / B 终端记录 / C 纸质便签） |
| `854-vc-layouts.html` / `.css` / `.ts` | 第三轮：换**信息架构**，三套布局（A 状态优先 / B 双栏工作台 / C 视图切换） |
| `855-vc-dark.html` / `.css` | 深色皮肤 |
| `856-vc-header-4variants.html` | 顶部信息条四变体 |

### 6.2 854 的出发点（设计意图原文）

- 「上一轮（853）换的是视觉语言；这一轮换的是**东西摆在哪**」——起因是「原设计把功能从上到下顺排，要用一个功能就得往下翻」（`docs/prototype/854-vc-layouts.html:9-13`）。
- 设计师第一眼要看三样：① 我在哪（工作树、分支、超前落后）；② 现在有几件事（冲突/已暂存/未暂存，表格数字对齐）；③ **我现在能干什么，而且不用往下翻**（拉取、推送、全部暂存、提交说明、提交按钮必须一直在手边）。第 ③ 条被点名为「原设计最缺的地方」（`854-vc-layouts.html:38-42`）。
- 两条自定规矩：全页只有「冲突」用红色；读参考信息（其他工作树、提交历史）**不与要做的动作混排**（`854-vc-layouts.html:43`）。

### 6.3 布局 C（被采纳的那一套）与它的代价

- C 的名字与理由：「C 视图切换，一次只看一件事」——把改动、提交历史、工作树拆成三个视图，页签上带数量；每个视图只放它自己的动作：改动页放暂存与提交，历史页放加载更多，工作树页放去终端（`docs/prototype/854-vc-layouts.ts:155-156`）。
- **记下来的冲突**：「代价：与 #821 已定的『首屏顺序』冲突（它要求其他工作树与提交历史出现在首屏），采用它需要改那张规格单」（`854-vc-layouts.ts:157`）。这是本页最明确的一条「采纳某方案必须改规格」的书面记录。

### 6.4 落地过程（把原型变成代码的那串提交）

| 提交 | 做了什么 |
|---|---|
| `8711044f` | 布局 C 落地：改动 / 提交历史 / 工作树三个视图，一次只看一件事（#853 第三步） |
| `20bb8c3a` | 面板解决不了时，一个按钮把当前问题写成 prompt 交给 AI（#854） |
| `ba5e31ac` | 身份区按原型对齐：分支改回绿色，重新读一次改回链接形态，次级行收成灰小字 |
| `92049512` | 按 854 布局 C 复刻改动视图：身份区并两行，补数字条与视图条，三视图各配同结构骨架屏 |
| `0f3e6fc0` / `c34fd794` / `ce26f468` / `fddd4d42` / `f1c557bd` | 补分隔符、补徽章、视图条改两行、五处百分百还原、最后 10% 微差 |
| `fb93e35e` | 面板换上自己的皮肤：深色 A、浅色 C，跟 DSH 主题切换（#853 第二步） |
| `230bd84e` | 清掉「去侧栏终端」那类提示，改成说清「在命令行里怎么做」（#853 第一步） |
| `44783372` | #1387 深色残留五项收口（含「版本控制输入框跟随宿主焦点环」） |

### 6.5 ADR（唯一依据级文档）

- `docs/adr/20261002-version-control-readonly-no-network.md`（60 行）：第一版只读不联网；领先落后只读本地缓存；**永远显示依据时间、不设阈值**；依据时间读得到/读不到必须画成两样；五种分支状态各有说法；平台契约（`stat(target)` 吃 `resolve()` 产物、`lstat(path)` 才是路径式、缺失 code 是 `FS_NOT_FOUND`）。第 5 节写明「将来放开联网」的前置条件与当下唯一出口是命令行。
- `docs/adr/20261004-version-control-write-path.md`（62 行）：写操作最小集 D1–D14、两条总工裁决、四处订正、参数注入面五条加固、一次性票据与执行门、非交互执行边界、**看门狗 pull/push 不开**及其三条开启前提、限制（TOCTOU/钩子/指纹拦不住并发）、明确不做的清单。
- 相关：`docs/adr/20260913-builtin-ts-shape.md`（TypeScript 与 JavaScript 的分界线，ADR 20261002 第 4 节引用）、`docs/adr/20261020-ui-copy-data-driven.md`、`docs/adr/20261021-config-ownership.md`（文案/配置归属）。

### 6.6 性能对抗式审查（`docs/design/857-version-control-perf-review.md`，79 行）

- P1 未提交那一路的差异读取没有序号防乱序 → 界面会把 A 的补丁挂在 B 的行上（`:9-18`）。
- P2 换工作区后旧工作区在飞的差异回包会写进新工作区（`:20-28`）。
- P3 差异缓存只增不减（`:30-35`）→ 只留 40 条、按首次写入顺序淘汰。
- P4 连点同一行会起两个 git 进程（`:37-42`）→ `loading` 也跳过。
- P5 首屏完全空白（`:44-52`）→ 骨架块。
- P6 差异读取中只有一句文字、位置会跳（`:54-58`）→ 骨架条。
- **这一版不做**：虚拟滚动（单批 200 行有界）、给 diff 加 abort 通道（宿主那条电话没有取消协议，用「回包落地前比对」更便宜）（`:70-73`）。
- **查完推翻的一条**：初判「提交历史要等第二条电话所以天生慢」是错的，如实留在第五节（`:75-79`）。

### 6.7 历史评审（`docs/review/20261026-version-control-ui-review.html`，971 行，当日）

标题一句就是结论：「这页现在像 git 命令面板，不像任务面板」（`:233`）。结构：先立尺子 → 8 个场景 diff（刚打开 / 只提交一个文件 / 写提交说明 / 点完更新 / 拉取该不该点 / 没有新提交却点得下推送 / 两份改动哪份进历史 / 窄屏与键盘）→ 问题总表 → 三档落地建议 → 验收与代价。

问题总表 **24 条**（P0 5 / P1 12 / P2 7），每条都给了证据行号（`:805-848`）。其中直接关系本页结构的高价值几条：

- P0-1 操作结果固定装配在整页末尾，与触发按钮之间隔着页签与整张列表；没有时间与对象数，清空时机散落（`:819`）。
- P0-2 超前为 0 时「推送」仍是可用主按钮，点下去照样报「推送完成」（`:820`）。
- P0-3 工作区有未提交改动时「拉取」仍可点（只给 warn），提示语却写「请先提交再拉取」，状态与文案互相否定（`:821`）。
- P0-4 已修改 / 已暂存 / 从未跟踪三类文件同表同权；未跟踪文件只有「add」，没有丢弃、忽略、删除（`:822`）。
- P0-5 结果不可追溯：没有时间、对象数、远端名与提交号，远端名只藏在悬停里（`:823`）。
- P1-1 提交说明只有单行 `input`，命令侧只拼一条 `-m`，仓库规范的标题+正文无处填写（`:825`；`vcWriteView.ts:134-138`、`commands.ts:124`）。
- P1-4「只提交已暂存的文件」这句说明在模型里有值，但视图没有渲染入口（`:828`；`vcWriteUi.ts:124`）。
- P2-7 代码里存在三个**未被使用**的渲染节点，与现行视图条各画一套提交区（`:844`；`vcWriteView.ts:51,76,87`）。这条是「有旧方案残留」的直接证据。

三档建议：P0 止血 5 项 / P1 结构 7 项 / P2 体系 6 项（`:856-897`）。

---

## 7. 被放弃 / 已改口的设计（带理由）

| 原方案 | 现在 | 理由与证据 |
|---|---|---|
| 「依据旧 / 依据新」两套样式 + 魔数阈值 | 只有「读得到 / 读不到」两档 | 不设阈值就无法判「旧」，按字面不可实现；`tracked-stale/fresh` 改名 `tracked-known/unknown`（ADR `docs/adr/20261002-version-control-readonly-no-network.md:26`） |
| 拿 `packed-refs` 的 mtime 当依据时间 | 拿该上游自己的松散引用文件；打包了就回 `null` | 实测跑一次 `git gc` 就让它往后跳约 1.2 秒，上游已删的仓库也会凭空得到时间（`src/host/versionControlBasis.ts:47-50`） |
| 第一版做 fetch / pull / push | 第一版完全不联网 | 无终端子进程里 `git fetch` 撞凭据提示会挂住；钉死 `GIT_TERMINAL_PROMPT=0` 属独立的一层（ADR `20261002` `:13-15`） |
| 工作区不干净 = 不能拉 | 只 warn，不再一律拦住 | 只快进的拉取在不相交时本来能成；相交时命令行会如实拒绝（`rules.ts:68-70`，#976） |
| 裸 push | 永远显式 `<remote> <local>:<branch>` | 裸 push 会被 `push.default` / `remote.<name>.push` / `push.followTags` 改道（ADR `20261004` `:13`；`commands.ts:110-112,129-141`） |
| 用一次就烧掉的票据 | requestId 去重 + 状态比对 | 真正挡住重复执行的是「票里记的仓库状态与此刻不一致」（ADR `20261004` `:22`） |
| 写路径开看门狗 `stallMs` | pull/push **不开** | 实测 `fetch --progress` 8.1 秒里 32 次采样全是 0 字节，看门狗会在 2.5 秒杀掉**健康**传输（ADR `20261004` `:46-50`） |
| 侧栏终端当出口 | 命令行 | 「去侧栏终端」那类提示被清干净，改成说清「在命令行里怎么做」（提交 `230bd84e`；ADR `20261002:50` 仍留着旧说法，**两处口径已分叉，待确认以哪份为准**） |
| 首屏先空着 | 骨架块 | 用户分不清「正在来」与「坏了」（`docs/design/857-version-control-perf-review.md:44-52`） |
| 「还能显示更多」要点击 | 进入视野自动加载 | 提交 `c14ec7ad`（#997） |

---

## 8. 遗留 TODO 与缺口（只列事实）

1. **24 条评审问题全部还在工作树上**（`docs/review/20261026-version-control-ui-review.html:805-848` 的「现在」列）；截至本笔记，源码里 P0-1~P0-5、P1-1~P1-12、P2-1~P2-7 的证据行仍然成立（本文第 1–4 章已逐条核到）。
2. **三个未被使用的渲染节点**（`vcWriteView.ts:51,76,87`）：旧提交区的残留，与现行视图条各画一套（评审 P2-7）。
3. **853 的三套视觉风格**里只有 A（深色）与 C（浅色）落地（`#853` 第二步，提交 `fb93e35e`）；B 终端记录没有对应的实现文件（**待确认**是主动放弃还是未排期）。
4. **856 顶部信息条四变体**没有对应的落地记录落在 `src/client/views/versionControl/` 的提交里（`git log --oneline -40 -- src/client/views/versionControl` 未见 856 相关提交）。
5. **工作树页只有「看」与「交给 AI」**：没有切换、创建、prune 工作树的入口（ADR `20261004:57` 明写不做）。
6. **提交说明不支持标题+正文**（`vcWriteView.ts:134-138` + `commands.ts:124` 只有一条 `-m`），与本仓库自己的提交规范（`docs/agents/commit-convention.md`）不一致；ADR 把它明确成「不强制本仓库规范」（`docs/adr/20261004-version-control-write-path.md:11`）。
7. **`vc.basis.tip` 与页面自带的「更新」按钮语义相抵**（`panel.yaml:246` vs `wf.gitFetch`；评审 P1-12）。
8. **`vc.terminal` 一族的 `aria` 缺口集中于「行」这一级**：行可点不可聚焦，禁用原因不可达（§5.5）。
9. **文案分散在三份 YAML**（`panel.yaml` / `vcwrite.yaml` / `flow.yaml`）：「提交历史」这颗页签借的是 `vc.commits.title`（`config/copy/flow.yaml:248`），并不存在 `vc.views.commits` 这个键（`config/copy/vcwrite.yaml:54-55` 只有 changes 与 worktrees）。整合重构改文案时三处要一起改。

---

## 9. 快速索引（要改哪一块先看这几行）

| 想动的东西 | 先读 |
|---|---|
| 身份条 | `VersionControlTab.ts:313-333`；依据时间 `src/host/versionControlBasis.ts:69-77` |
| 视图条 / 提交区 | `vcWriteView.ts:116-145`；`VersionControlTab.ts:313` 注释（拉取推送搬进视图条） |
| 文件行 | `VersionControlTab.ts:264-291`；`vcRows.ts:69,77`；`vcText.ts:68-78` |
| 分组与计数 | `vcBlocks.ts:176-181`；`vcViews.ts:66-85` |
| 提交历史 | `commands.ts:79-83`；`src/host/versionControl.ts:321-340`；`vcBlocks.ts:255-257` |
| 单提交视图 | `commands.ts:86-92`；`vcDiffOps.ts`；`VersionControlTab.ts:243-262` |
| 工作树 | `vcBlocks.ts:260-289`；`VersionControlTab.ts:368-391` |
| 能不能点 | `src/shared/version-control/src/rules.ts:41-108` |
| 命令口径 | `src/shared/version-control/src/commands.ts:32-166` |
| 全部界面字 | `config/copy/panel.yaml:222-307`（zh）、`config/copy/vcwrite.yaml:13-115`（zh） |
| 既定决策 | `docs/adr/20261002-version-control-readonly-no-network.md`、`docs/adr/20261004-version-control-write-path.md` |
| 设计意图 | `docs/prototype/854-vc-layouts.html:8-14,37-44`、`docs/prototype/854-vc-layouts.ts:149-157` |
| 已知问题 | `docs/review/20261026-version-control-ui-review.html:805-848` |
