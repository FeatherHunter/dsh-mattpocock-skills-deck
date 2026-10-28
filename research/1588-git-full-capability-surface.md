# git 面向用户的全部能力，以及 300–520 像素面板能装下哪些

- 日期：2026-10-28
- 仓库：`D:\dsh-plugin\dsh-mattpocock-skills-deck`
- 问题：如果做一个不绑定任何托管平台的版本管理页面，git 本身提供了哪些用户可用的能力？哪些适合放进宽 300–520 像素的面板，哪些只能交给终端或外部编辑器？
- 证据来源：`—` 命令与选项的细节来自每条命令链接对应的 git 官方文档；命令条数来自本机 `git help -a`（git 2.49.0.windows.1）；从文档推出来、没有实测过的结论，在正文里标「待核实」。

## 先看仓库里已经有什么，这份笔记补什么

已有三份材料，读的时候按这个顺序：

1. `docs/design/20261026-version-control-page-research.md`：现有版本管理页的现状调研。它只覆盖当前页面真正有的东西——三个视图（改动、提交历史、工作树）、顶部信息条、四个写命令（暂存、提交、拉取、推送），末尾列了九条遗留缺口。它回答的是「现在这一页做了什么」，不是「git 一共有什么」。
2. `docs/prototype/vc-redesign/README.md` 和 `docs/prototype/vc-redesign/src/domain/session.ts`：可点原型。四个页签（改动、提交历史、工作树、贮藏）加一个分支浮层，`Action` 联合类型里约五十个动作，已经验证了「预检 → 内联确认卡 → 结果贴触发点」这套交互，也定下了 300 / 380 / 460 / 520 四档宽度和不出现「复制命令」的规矩。它回答的是「面板长什么样」。
3. 规格票 #1586（`gh issue view 1586`）：把能力分成 A 组（原型已验证）、B 组（必须补）、C 组（不做），但分组是按「页面要不要做」来的，不是按 git 命令表来的，所以矩阵不全，也没有写每个动作的前置状态。

`research/` 下还有两篇近邻笔记，都需要指路：

- `research/github-desktop-feature-survey.md`：以 GitHub Desktop 的官方文档和 desktop 源码为轴，属 GUI 客户端视角，git 只是背景。**它是二手视角，不能拿来当 git 能力的全集。**
- `research/git-command-parse-survey.md`（票 #811）：只讲读状态要跑哪些命令、输出怎么解析，不判断哪些动作该进面板。

这三份加上两篇近邻，缺的是同一件事：**以 git 自己的命令表为全集，以 300–520 像素的宽度为判据，逐条判断每个能力归谁，并写清它依赖什么前置状态、面板要预检什么、确认卡要写什么、结果贴在哪里。** 这份笔记补的就是这张表。

## 1. 一句话结论

git 的 156 条命令（149 条核心 + 7 条本机外部命令，见第 3 节）按用户工作流可以归成 14 个域、162 条用户向能力；其中 42 条适合主面板直接做，62 条适合折叠区或二级页，34 条只值得做成只读诊断，剩下 24 条只能交给终端或外部编辑器。分界线不是「命令难不难」，而是三件事：这个动作要不要人看见并操作一份 git 之外的产物（编辑器、合并工具、任意命令），要不要系统级权限或密钥交互，以及失败之后面板能不能把状态讲清楚。

## 2. 能力矩阵

### 2.0 怎么读这张表

**级别**四级，在常见的「读 / 写 / 危险」上把危险再拆开，因为确认卡要写的话不一样：

| 级别 | 含义 | 确认卡要不要拦 |
| --- | --- | --- |
| 读 | 只读，不改仓库任何东西 | 不拦 |
| 写 | 改索引、工作区文件、引用，但原有提交不动 | 轻确认或不确认 |
| 改写 | 重写已有提交，旧提交还能从 reflog 找回 | 要写清「旧的在 reflog 里」 |
| 毁 | 丢文件或丢对象，reflog 也找不回 | 要写清「找不回」并二次确认 |

**归属**四级，判断的是「300–520 像素宽的面板里值不值得有」：

| 归属 | 含义 |
| --- | --- |
| 直 | 主面板一个按钮，或一行输入加内联确认卡，就能闭环 |
| 折 | 需要多输入或多步，放进折叠区、二级页或浮层 |
| 诊 | 只读诊断，写操作与收益不成比例，只显示信息 |
| 外 | 只能交给终端、外部编辑器或外部图形工具 |

**面板表达**固定三段：`预检：… ｜ 确认：… ｜ 结果：…`。只读能力没有确认段。结果落点只用原型里已经有的词：文件行、分组头、提交区、历史列表、顶部身份条、顶部同步带、分支浮层、工作树行、贮藏行、诊断页、按钮下、整页替换。

**前置状态**只写「面板必须能判断出来」的那些，判断方法不展开（读状态的命令与解析坑见 `research/git-command-parse-survey.md`）。常见的有：在仓库内、有上游、工作区干净、有冲突中、merge / rebase / cherry-pick / revert / am / bisect 进行中、HEAD 存在、该分支已被某个工作树占用、远端可达且已认证。

### 2.1 域一：工作区与暂存

**结论：这是最适合面板的一域，几乎全部能闭环。** 因为这些动作的输入永远是「改动页上已经列出来的路径」，不需要文件选择器，也不需要编辑器；唯一要降级的是逐块挑选——`git add -i` 的菜单式交互做不进面板，但面板可以用「读 diff、勾块、`apply --cached`」自己实现同样的效果。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 1.1 | 看工作区状态 · [git status](https://git-scm.com/docs/git-status) `--porcelain=v2 --branch -z` | 读 | 在仓库内；裸库没有「改动」概念 | 结果：改动页三组（已暂存 / 未暂存 / 冲突）计数与文件行 | 直 |
| 1.2 | 逐块暂存 · [git add](https://git-scm.com/docs/git-add) `-p`（面板等价于读 diff 后 `apply --cached`） | 写 | 该文件有可拆分的改动块 | 预检：块清单与行号 ｜ 确认：无 ｜ 结果：块行打勾，文件行显示剩余块数 | 折 |
| 1.3 | 暂存单个文件 · [git add](https://git-scm.com/docs/git-add) `-- <path>` | 写 | 该路径有未暂存或未跟踪改动 | 预检：状态字母与增删行 ｜ 确认：无 ｜ 结果：文件行移进「已暂存」，提交区亮起 | 直 |
| 1.4 | 暂存全部 · [git add](https://git-scm.com/docs/git-add) `-A` | 写 | 至少有一个改动 | 预检：N 个文件、+M/−K 行 ｜ 确认：无 ｜ 结果：分组头计数更新 | 直 |
| 1.5 | 撤回暂存 · [git restore](https://git-scm.com/docs/git-restore) `--staged -- <path>` | 写 | 该路径在索引里 | 预检：无 ｜ 确认：无 ｜ 结果：文件行回「未暂存」组 | 直 |
| 1.6 | 丢弃单个文件的未暂存改动 · [git restore](https://git-scm.com/docs/git-restore) `-- <path>` | 毁 | 有未暂存改动，且不是未跟踪文件 | 预检：会丢 N 行、这份内容没进过任何提交 ｜ 确认：只动工作区，暂存区里的那份不动；删了找不回 ｜ 结果：该行消失、计数减一 | 直 |
| 1.7 | 丢弃全部未暂存改动 · [git restore](https://git-scm.com/docs/git-restore) `-- .` | 毁 | 同上 | 预检：文件数与总行数，列前三个文件名 ｜ 确认：写清「找不回」，并说明未跟踪文件不在其中 ｜ 结果：分组头 | 直 |
| 1.8 | 删除未跟踪文件 · [git clean](https://git-scm.com/docs/git-clean) `-fd -- <path>` | 毁 | 有未跟踪文件或目录 | 预检：路径、体积、其中多少条被忽略（`-x` 才动忽略文件） ｜ 确认：git 从来没记录过这些文件，删了找不回 ｜ 结果：行消失 | 直 |
| 1.9 | 删除已跟踪文件 · [git rm](https://git-scm.com/docs/git-rm) `-- <path>` | 写 | 已跟踪；有未提交改动时要 `-f` | 预检：文件会从磁盘删掉，但能从 HEAD 恢复 ｜ 确认：无 ｜ 结果：文件行进「已暂存（删除）」 | 直 |
| 1.10 | 只停止跟踪、保留磁盘文件 · [git rm](https://git-scm.com/docs/git-rm) `--cached -- <path>` | 写 | 已跟踪 | 预检：文件留在磁盘，下次提交后不再跟踪 ｜ 确认：无 ｜ 结果：同上 | 折 |
| 1.11 | 重命名或移动 · [git mv](https://git-scm.com/docs/git-mv) `<old> <new>` | 写 | 源已跟踪，目标不存在 | 预检：目标是否已存在、是否只改大小写 ｜ 确认：无 ｜ 结果：行改名并进暂存区 | 折 |
| 1.12 | 加进忽略清单 · [gitignore](https://git-scm.com/docs/gitignore) + [git check-ignore](https://git-scm.com/docs/git-check-ignore) `-v` | 写 | 该路径是未跟踪的 | 预检：命中的现有规则（`check-ignore -v` 给出文件与行号） ｜ 确认：写进哪个 `.gitignore`、会影响哪些同级文件 ｜ 结果：文件行移进「已忽略」组 | 直 |
| 1.13 | 查这条路径为什么被忽略 · [git check-ignore](https://git-scm.com/docs/git-check-ignore) `-v` | 读 | 路径存在 | 结果：文件行下一行小字「被 .gitignore 第 12 行命中」 | 诊 |

### 2.2 域二：提交

**结论：普通提交能直接做，但「提交」这个词在 git 里有歧义——合并、拣选、变基、`am` 中间敲 `git commit` 会「完成那个操作」，所以面板的提交按钮必须先判断有没有进行中的操作，否则会做出用户没想做的事。** 另一个硬边界是编辑器：不带 `-m` 的提交会把说明交给 `core.editor`，面板拿不到编辑器里写了什么。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 2.1 | 提交已暂存内容 · [git commit](https://git-scm.com/docs/git-commit) `-m` | 写 | 暂存区非空；无未解决冲突；**不在 merge / rebase / cherry-pick / revert 中间** | 预检：N 文件 +M/−K，暂存区为空则禁用并写原因 ｜ 确认：主按钮沿用现有做法不弹卡，但按钮下要列出将进提交的文件 ｜ 结果：提交区结果条 + 历史列表首行 | 直 |
| 2.2 | 提交全部已跟踪改动 · [git commit](https://git-scm.com/docs/git-commit) `-a -m` | 写 | 有未暂存改动 | 预检：列出会被一并提交的文件 ｜ 确认：写清「未暂存的改动也进这次提交，新文件不进」 ｜ 结果：同 2.1 | 折 |
| 2.3 | 修订上一条提交 · [git commit](https://git-scm.com/docs/git-commit) `--amend`（可只改说明） | 改写 | HEAD 存在；暂存区可以为空；已推送则之后要强推 | 预检：HEAD 短号与说明、这条是否已经推上去 ｜ 确认：换掉的是哪一条、旧提交还能从 reflog 找回、已推送的话远端会分叉 ｜ 结果：提交区与历史首行原地替换 | 直 |
| 2.4 | 生成 fixup / squash 提交 · [git commit](https://git-scm.com/docs/git-commit) `--fixup` / `--squash` | 写 | 有目标提交 | 预检：目标提交与将生成的标题 ｜ 确认：无 ｜ 结果：历史行标 fixup / squash，等下一次 `rebase --autosquash` 吸收 | 折 |
| 2.5 | 跳过提交钩子 · [git commit](https://git-scm.com/docs/git-commit) `--no-verify` | 写 | 有钩子，且刚刚失败过 | 预检：哪个钩子、退出码、最后几行输出 ｜ 确认：这次只跳过 pre-commit 与 commit-msg，钩子本身不改 ｜ 结果：结果条标「已跳过钩子」 | 折 |
| 2.6 | 签名提交 / 追加签名行 · [git commit](https://git-scm.com/docs/git-commit) `-S` / `-s` | 写 | 配好 `user.signingkey` 或 `gpg.format`；签名口令可能要交互（待核实） | 预检：签名方式、密钥指纹 ｜ 确认：无 ｜ 结果：历史行显示「已签名」 | 折 |
| 2.7 | 用编辑器写完整说明 · [git commit](https://git-scm.com/docs/git-commit)（不带 `-m`） | 写 | 配了 `core.editor` | 面板拿不到编辑器里写了什么，也拿不到「用户中途放弃」以外的信号 ｜ 替代：面板只给标题 + 正文两栏，提交模板与注释预填 | 外 |
| 2.8 | 套用提交说明模板 · [git commit](https://git-scm.com/docs/git-commit) 的 `commit.template` | 写 | 配了 `commit.template` | 预检：模板路径 ｜ 结果：说明栏预填模板内容 | 折 |

### 2.3 域三：历史查看

**结论：历史查看几乎全适合面板，但宽度决定了「看什么」——520 像素只够一列提交列表加一个详情面板，逐文件 diff、逐行追溯、按代码搜索都要放进二级页。** 这一域没有写操作，唯一要小心的是 `git show <rev>:<path>` 这类「取旧版本文件」的能力，它只读，但结果可能很大，面板要截断而不是整页渲染。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 3.1 | 提交列表 · [git log](https://git-scm.com/docs/git-log) | 读 | HEAD 存在（空仓库没有历史） | 结果：历史列表，首列短号、说明首行、作者与时间 | 直 |
| 3.2 | 单条提交详情 · [git show](https://git-scm.com/docs/git-show) | 读 | 该提交存在 | 结果：历史列表下方的详情区（整页替换或侧滑） | 直 |
| 3.3 | 提交内逐文件差异 · [git show](https://git-scm.com/docs/git-show) `<oid> -- <path>`（根提交加 `--root`） | 读 | 该提交存在 | 结果：详情区里的 diff，按文件折叠 | 折 |
| 3.4 | 单文件历史 · [git log](https://git-scm.com/docs/git-log) `--follow -- <path>` | 读 | 该路径曾经存在 | 结果：历史列表过滤成该文件，行首标重命名 | 折 |
| 3.5 | 行级追溯 · [git blame](https://git-scm.com/docs/git-blame) `-L` | 读 | 该文件在当前版本存在 | 结果：诊断页或二级页，行号 + 短号 + 作者 | 诊 |
| 3.6 | 按说明搜提交 · [git log](https://git-scm.com/docs/git-log) `--grep -i` | 读 | 有历史 | 结果：历史列表带搜索框，命中高亮 | 折 |
| 3.7 | 按代码变化搜提交 · [git log](https://git-scm.com/docs/git-log) `-S` / `-G` | 读 | 有历史 | 结果：历史列表，命中行标「新增/删除了这段文字」 | 折 |
| 3.8 | 比较两个引用 · [git diff](https://git-scm.com/docs/git-diff) `a..b` / `a...b` | 读 | 两个引用都存在 | 预检：两端的短号与关系（`...` 是从分叉点算） ｜ 结果：二级页的 diff | 折 |
| 3.9 | 两组提交对照 · [git range-diff](https://git-scm.com/docs/git-range-diff) | 读 | 两组提交都存在 | 结果：诊断页，按「已被改写 / 新增 / 删除」分组 | 诊 |
| 3.10 | 版本名 · [git describe](https://git-scm.com/docs/git-describe) `--tags --dirty --always` | 读 | 有标签或至少一个提交 | 结果：顶部身份条，`v1.2.3-4-gabc1234` 或 `abc1234` | 直 |
| 3.11 | 引用日志 · [git reflog](https://git-scm.com/docs/git-reflog) `show` | 读 | 有引用变动历史（`core.logAllRefUpdates` 开着，默认开） | 结果：诊断页，逐行列出 HEAD 与分支的移动 | 诊 |
| 3.12 | 提交备注 · [git notes](https://git-scm.com/docs/git-notes) `show` | 读 | 该提交有备注 | 结果：详情区多一段「备注」 | 折 |
| 3.13 | 取某版本的文件内容 · [git show](https://git-scm.com/docs/git-show) `<rev>:<path>` | 读 | 该版本里该路径存在 | 结果：二级页只读文本，超长截断并提示 | 诊 |

### 2.4 域四：引用与标签

**结论：分支的增删改查全部适合面板，因为「分支」本身就是一个名字加一个指针，没有额外产物。** 两处要退让：分离头指针的状态解释起来费劲，面板要么不做、要么在顶部身份条常驻「现在不在任何分支上」；签名标签的验签需要本地有公钥，面板只能显示结果、不能替人管理密钥。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 4.1 | 分支列表 · [git branch](https://git-scm.com/docs/git-branch) `-vv` / [git for-each-ref](https://git-scm.com/docs/git-for-each-ref) | 读 | 在仓库内 | 结果：分支浮层，每行带上游与领先/落后数 | 直 |
| 4.2 | 新建并切换 · [git switch](https://git-scm.com/docs/git-switch) `-c` | 写 | 新名字合法（`check-ref-format --branch` 能过）、不重名 | 预检：名字合法性、从哪个起点建 ｜ 确认：无 ｜ 结果：分支浮层新行 + 顶部身份条切换 | 直 |
| 4.3 | 切换分支 · [git switch](https://git-scm.com/docs/git-switch) | 写 | 目标分支存在；工作区改动不冲突 | 预检：目标分支、会不会被本地改动挡住 ｜ 确认：有本地改动且要带过去时写清「改动会跟着走」 ｜ 结果：顶部身份条 + 改动页整体刷新 | 直 |
| 4.4 | 切到某提交（分离头指针） · [git switch](https://git-scm.com/docs/git-switch) `--detach` | 写 | 目标提交存在 | 预检：写清「现在不在任何分支上，新提交没人接着」 ｜ 确认：要接着干活就建分支 ｜ 结果：顶部身份条显示短号 + 「分离」 | 折 |
| 4.5 | 重命名分支 · [git branch](https://git-scm.com/docs/git-branch) `-m` | 写 | 当前分支或目标分支存在；新名字不重名 | 预检：旧名 → 新名、上游会不会跟着改 ｜ 确认：无 ｜ 结果：分支浮层行原地改名 | 直 |
| 4.6 | 删除分支 · [git branch](https://git-scm.com/docs/git-branch) `-d` / `-D` | 改写 | 不是当前分支；未被工作树占用 | 预检：这条分支上有没有未合并提交（`-d` 会拒绝） ｜ 确认：写清「提交对象还在，reflog 里能找回，但名字没了」；`-D` 要二次确认 ｜ 结果：分支浮层行消失 | 直 |
| 4.7 | 设置或取消上游 · [git branch](https://git-scm.com/docs/git-branch) `-u` / `--unset-upstream` | 写 | 本地分支存在；远端分支存在（设置时） | 预检：远端/分支名是否存在 ｜ 确认：无 ｜ 结果：分支行显示 `origin/main` 与领先/落后 | 直 |
| 4.8 | 哪些分支已并入 · [git branch](https://git-scm.com/docs/git-branch) `--merged` / `--no-merged` | 读 | 有多个分支 | 结果：分支浮层里给已并入的加「可安全删除」标记 | 诊 |
| 4.9 | 标签列表 · [git tag](https://git-scm.com/docs/git-tag) `-l` | 读 | 至少一个标签 | 结果：折叠区「标签」，附注标签显示说明首行 | 折 |
| 4.10 | 建标签 · [git tag](https://git-scm.com/docs/git-tag)（轻量）/ `-a`（附注）/ `-s`（签名） | 写 | 名字合法且不重名 | 预检：指向哪个提交、轻量还是附注 ｜ 确认：无 ｜ 结果：折叠区新行 + 历史列表该提交旁出现标签 | 折 |
| 4.11 | 删标签 · [git tag](https://git-scm.com/docs/git-tag) `-d` | 毁 | 标签存在 | 预检：这个标签有没有推到远端 ｜ 确认：本地删了远端还在，要另推一次删除 ｜ 结果：折叠区行消失 | 折 |
| 4.12 | 验签 · [git verify-commit](https://git-scm.com/docs/git-verify-commit) / [git verify-tag](https://git-scm.com/docs/git-verify-tag) | 读 | 本地有对应公钥 | 结果：历史行或标签行显示「签名有效 / 无法验证 / 没有公钥」 | 诊 |
| 4.13 | 分支说明 · [git branch](https://git-scm.com/docs/git-branch) `--edit-description` | 写 | 分支存在；配了编辑器 | 面板拿不到编辑器内容 ｜ 替代：只读显示现有的 `branch.<name>.description` | 外 |

### 2.5 域五：历史改写

**结论：这是「面板能做，但每一步都要人看清」的一域。** 撤销上一条提交、反向提交、拣选都能做成按钮；交互式变基只能做最小集（改说明、压缩、丢弃、重排），因为完整的待办清单编辑本身就是编辑器交互。批量重写（`filter-branch`、`fast-import`、`replace`）一律交出去——它们不是「一个动作」，是一段脚本或一次全库扫描，面板既没有进度条也没有回滚。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 5.1 | 撤销上一条提交、改动回暂存区 · [git reset](https://git-scm.com/docs/git-reset) `--soft HEAD~1` | 改写 | HEAD 存在；建议未推送 | 预检：要撤销的那条、它是否已推送 ｜ 确认：提交没了、改动还在暂存区、旧提交可从 reflog 找回 ｜ 结果：历史列表首行消失 + 提交区出现改动 | 直 |
| 5.2 | 撤销提交并取消暂存 · [git reset](https://git-scm.com/docs/git-reset) `HEAD~1` | 改写 | 同上 | 预检：同 5.1 ｜ 确认：改动回到工作区，不再暂存 ｜ 结果：历史首行消失 + 改动页 | 折 |
| 5.3 | 硬重置到某提交 · [git reset](https://git-scm.com/docs/git-reset) `--hard` | 毁 | 目标提交存在 | 预检：会丢哪些未提交改动（逐文件列）、当前 HEAD 与目标的差距 ｜ 确认：工作区与暂存区都会被覆盖，未提交内容找不回 ｜ 结果：整页刷新 | 折 |
| 5.4 | 反向提交 · [git revert](https://git-scm.com/docs/git-revert) | 写 | 目标提交存在；工作区干净 | 预检：要反向哪条、会不会冲突 ｜ 确认：这是「新增一条抵消提交」，历史不动 ｜ 结果：历史列表新行，说明以 `Revert` 开头 | 直 |
| 5.5 | 拣选提交 · [git cherry-pick](https://git-scm.com/docs/git-cherry-pick) | 写 | 目标提交存在；工作区干净 | 预检：目标提交、会落到当前分支哪个位置 ｜ 确认：新提交的哈希与原提交不同 ｜ 结果：历史列表新行；冲突则切到冲突向导 | 直 |
| 5.6 | 交互式变基（最小集：改说明、压缩、丢弃、重排） · [git rebase](https://git-scm.com/docs/git-rebase) `-i` | 改写 | 有上游或指定基座；工作区干净；未推送更安全 | 预检：将被重放的提交清单（从基座到 HEAD）、每条要做的动作 ｜ 确认：所有哈希都会变、已推送的话要强推 ｜ 结果：历史列表整段替换 | 折 |
| 5.7 | 换基座 · [git rebase](https://git-scm.com/docs/git-rebase) `--onto` | 改写 | 三个点都存在且关系清楚 | 预检：把哪一段搬到哪个基座上 ｜ 确认：同 5.6 ｜ 结果：同 5.6 | 折 |
| 5.8 | 自动吸收 fixup / squash · [git rebase](https://git-scm.com/docs/git-rebase) `-i --autosquash` | 改写 | 有对应的 fixup 提交 | 预检：哪些提交会被吸进哪条 ｜ 确认：同 5.6 ｜ 结果：历史列表行数减少 | 折 |
| 5.9 | 同步其他分支指针 · [git rebase](https://git-scm.com/docs/git-rebase) `--update-refs` | 改写 | 有其他分支指向被重写的提交 | 预检：哪些分支会被一起移动 ｜ 确认：这些分支的远端会分叉 ｜ 结果：分支浮层多处指针变化 | 折 |
| 5.10 | 保留合并结构 · [git rebase](https://git-scm.com/docs/git-rebase) `--rebase-merges` | 改写 | 区间里有合并提交 | 预检：合并结构会怎么重建 ｜ 确认：同 5.6 ｜ 结果：同 5.6 | 折 |
| 5.11 | 批量重写历史 · [git filter-branch](https://git-scm.com/docs/git-filter-branch) | 毁 | 全库；建议先备份 | 官方文档自己在顶部警告「改用 git-filter-repo」，面板不该提供入口 ｜ 替代：只读显示「本仓库历史很大，需要重写请用专用工具」 | 外 |
| 5.12 | 替换对象 · [git replace](https://git-scm.com/docs/git-replace) | 改写 | 目标对象存在 | 替换只影响本地读取，推送不带走；面板只读显示现有替换 | 外 |
| 5.13 | 导出 / 导入历史 · [git fast-export](https://git-scm.com/docs/git-fast-export) / [git fast-import](https://git-scm.com/docs/git-fast-import) | 毁 | 有完整历史；导入前通常要空库 | 这是一条流水线，不是一个动作 ｜ 替代：只读显示「导出用 git bundle，见 11.13」 | 外 |

### 2.6 域六：合并、变基与冲突

**结论：合并与「继续 / 跳过 / 中止」很适合面板，冲突解决只适合「整文件选一边 + 标记已解决」。** 中间那段「逐行看懂两边在争什么、手改文件」必须交给编辑器，原因不是面板画不出 diff，而是改完的内容得由人写回文件、再由 git 重新读；面板能做到的极限是：把冲突块原样显示出来、给出两边各自改了什么，然后等人回来点「已标记解决」。

有一处必须写进预检，否则一定会误导人：**变基冲突里的 `ours` 和 `theirs` 是反的**——`ours` 是已经重放好的那一串（基座那一侧），`theirs` 是正在被重放的提交。官方文档在 `git rebase` 页里明写了这一点。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 6.1 | 合并分支 · [git merge](https://git-scm.com/docs/git-merge) | 写 | 目标分支存在；不在 merge / rebase / cherry-pick / revert 中间；工作区干净 | 预检：目标分支、能不能快进、会不会冲突（可先用 `merge-tree` 预演） ｜ 确认：会产生合并提交还是直接快进 ｜ 结果：历史列表新行 + 顶部同步带 | 直 |
| 6.2 | 只允许快进 · [git merge](https://git-scm.com/docs/git-merge) `--ff-only` | 写 | 目标分支是当前分支的祖先 | 预检：不能快进就禁用，并写「先把当前分支变基或合并」 ｜ 确认：无 ｜ 结果：同 6.1 | 直 |
| 6.3 | 禁止快进 · [git merge](https://git-scm.com/docs/git-merge) `--no-ff` | 写 | 同上 | 预检：即使能快进也会建合并提交 ｜ 确认：写清「历史里会多一个合并节点」 ｜ 结果：同 6.1 | 折 |
| 6.4 | 压缩合并 · [git merge](https://git-scm.com/docs/git-merge) `--squash` | 写 | 目标分支存在 | 预检：结果是暂存区里的一堆改动，不是合并提交 ｜ 确认：之后要自己再提交一次 ｜ 结果：改动页出现已暂存改动 | 折 |
| 6.5 | 冲突文件清单 · [git status](https://git-scm.com/docs/git-status) / [git diff](https://git-scm.com/docs/git-diff) `--diff-filter=U` | 读 | 有冲突中 | 结果：改动页「冲突」组，逐文件标「两边都改 / 一边删了一边改」 | 直 |
| 6.6 | 整文件选一边 · [git checkout](https://git-scm.com/docs/git-checkout) `--ours` / `--theirs` | 写 | 有冲突，且该文件是内容冲突 | 预检：**变基时 ours / theirs 是反的**，按钮上要写「保留基座那侧 / 保留被重放的那侧」而不是 ours / theirs ｜ 确认：整份文件被一边覆盖，另一边这段改动没了 ｜ 结果：文件行变「已解决」 | 折 |
| 6.7 | 手工编辑冲突 · 外部编辑器 | 写 | 有冲突 | 面板只能显示冲突块与两边的差异，改内容要编辑器 ｜ 替代：文件行给「在编辑器里打开」，人回来后用状态刷新 | 外 |
| 6.8 | 标记已解决 · [git add](https://git-scm.com/docs/git-add) `-- <path>` | 写 | 文件里没有残留标记（`diff --check` 能查） | 预检：还有没有 `<<<<<<<` ｜ 确认：无 ｜ 结果：冲突组计数减一 | 直 |
| 6.9 | 外部合并工具 · [git mergetool](https://git-scm.com/docs/git-mergetool) | 写 | 配了 `merge.tool` | 起的是外部程序，面板拿不到结果，也拿不到退出原因 ｜ 替代：只显示「已配置哪个工具」 | 外 |
| 6.10 | 预演合并 · [git merge-tree](https://git-scm.com/docs/git-merge-tree) `--write-tree` | 读 | 两个提交存在 | 结果：诊断页「能干净合并 / 有 N 个文件冲突」 | 诊 |
| 6.11 | 继续 · `--continue`（merge / rebase / cherry-pick / revert / am 共用） | 写 | 冲突都已标记解决 | 预检：还剩几个冲突文件、待办还剩几步 ｜ 确认：无 ｜ 结果：冲突向导收起 + 历史与分支更新 | 直 |
| 6.12 | 跳过这一步 · `--skip` | 写 | 该步解决不了或不想解决 | 预检：这一步的改动会被丢掉、丢的是什么 ｜ 确认：写清丢什么 ｜ 结果：待办少一步 | 折 |
| 6.13 | 中止 · `--abort` | 写 | 有进行中的操作 | 预检：会回到操作前的哪个提交；`merge --abort` 官方文档明写「可能无法完全重建」 ｜ 确认：已经解好的冲突改动会丢 ｜ 结果：整页刷新 | 直 |
| 6.14 | 复用冲突解法 · [git rerere](https://git-scm.com/docs/git-rerere) | 读 | `rerere.enabled` 为真 | 结果：诊断页「这个冲突上次是这么解的」 | 诊 |
| 6.15 | 提交前查残留标记 · [git diff](https://git-scm.com/docs/git-diff) `--check` | 读 | 有暂存或未暂存改动 | 结果：文件行标「第 N 行还有冲突标记」 | 诊 |

### 2.7 域七：贮藏

**结论：贮藏的全部动作都能进面板，它是「把改动临时收走」的最短路径。** 唯一反直觉的地方是 `pop` 在冲突时不会删除记录，`apply` 永远不删——面板的结果文案要把这件事写出来，否则人会以为记录没了。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 7.1 | 贮藏当前改动 · [git stash](https://git-scm.com/docs/git-stash) `push -m` | 写 | 有改动；不在冲突中（冲突时会被拒绝） | 预检：会收走哪些文件、未跟踪的算不算 ｜ 确认：工作区会变干净 ｜ 结果：贮藏行新增 + 改动页清空 | 直 |
| 7.2 | 连未跟踪一起贮藏 · [git stash](https://git-scm.com/docs/git-stash) `push -u` | 写 | 有未跟踪文件 | 预检：未跟踪文件也会从工作区消失（在贮藏里） ｜ 确认：写清 ｜ 结果：同 7.1 | 折 |
| 7.3 | 只贮藏暂存区 · [git stash](https://git-scm.com/docs/git-stash) `push --staged` | 写 | 暂存区非空 | 预检：只收已暂存的那部分 ｜ 结果：贮藏行 + 暂存区清空 | 折 |
| 7.4 | 列出 · [git stash](https://git-scm.com/docs/git-stash) `list` | 读 | 至少一条贮藏 | 结果：贮藏页 / 折叠区，每条带说明首行 | 直 |
| 7.5 | 看内容 · [git stash](https://git-scm.com/docs/git-stash) `show -p` | 读 | 有贮藏 | 结果：贮藏行展开的 diff | 折 |
| 7.6 | 应用并保留记录 · [git stash](https://git-scm.com/docs/git-stash) `apply` | 写 | 有贮藏；工作区状态相容 | 预检：会不会冲突 ｜ 确认：记录不会自动删 ｜ 结果：改动页出现改动 + 贮藏行仍在 | 直 |
| 7.7 | 应用并删记录 · [git stash](https://git-scm.com/docs/git-stash) `pop` | 写 | 同上 | 预检：冲突时记录**不会**被删（官方文档明写） ｜ 确认：成功才删 ｜ 结果：改动页 + 贮藏行消失 | 直 |
| 7.8 | 从贮藏建分支 · [git stash](https://git-scm.com/docs/git-stash) `branch` | 写 | 有贮藏；新分支名合法 | 预检：新分支名与起点；成功后该贮藏会被删 ｜ 结果：分支浮层新行 + 改动页 + 贮藏行消失 | 折 |
| 7.9 | 删记录 · [git stash](https://git-scm.com/docs/git-stash) `drop` | 毁 | 有贮藏 | 预检：这条里有哪些文件 ｜ 确认：删了找不回（reflog 里可能还能捞，待核实） ｜ 结果：行消失 | 直 |
| 7.10 | 全清 · [git stash](https://git-scm.com/docs/git-stash) `clear` | 毁 | 有贮藏 | 预检：N 条 ｜ 确认：二次确认 ｜ 结果：贮藏区空 | 折 |

### 2.8 域八：远端与同步

**结论：日常的抓取、拉取、推送是三颗按钮，但每一颗的预检都比按钮本身重。** 面板必须能回答「我现在领先几条、落后几条、远端有没有在我上次抓取之后又前进」，否则拉取会莫名其妙建出合并提交、推送会被非快进拒绝。**强推是本域唯一要单独设计的动作**：`--force-with-lease` 的租约基准是本地保存的远端跟踪引用，只要面板替人抓取过，租约就被刷新了，保护会失效——这一点必须在确认卡里写出来。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 8.1 | 远端列表 · [git remote](https://git-scm.com/docs/git-remote) `-v` | 读 | 至少配了一个远端 | 结果：折叠区「远端」，名字 + 抓取地址 + 推送地址 | 折 |
| 8.2 | 新增 / 改名 / 删除远端 · [git remote](https://git-scm.com/docs/git-remote) `add` / `rename` / `remove` | 写 | 名字合法且不重名 | 预检：会影响哪些本地分支的上游（改名与删除会一起改 / 断） ｜ 确认：写清 ｜ 结果：折叠区行变化 | 折 |
| 8.3 | 改地址 · [git remote](https://git-scm.com/docs/git-remote) `set-url` | 写 | 远端存在 | 预检：旧地址 → 新地址；凭据可能要重输 ｜ 确认：无 ｜ 结果：折叠区行更新 | 折 |
| 8.4 | 看远端分支与标签 · [git ls-remote](https://git-scm.com/docs/git-ls-remote) / [git branch](https://git-scm.com/docs/git-branch) `-r` | 读 | 远端可达（`ls-remote` 要网络） | 结果：分支浮层的远端组 / 折叠区标签 | 折 |
| 8.5 | 抓取 · [git fetch](https://git-scm.com/docs/git-fetch) `[--all] [--prune] [--tags]` | 写 | 有远端且已认证 | 预检：哪个远端、`--prune` 会不会删掉本地跟踪分支 ｜ 确认：无 ｜ 结果：顶部同步带 + 分支浮层领先/落后 | 直 |
| 8.6 | 拉取并合并 · [git pull](https://git-scm.com/docs/git-pull) | 写 | 有上游；工作区干净 | 预检：领先/落后数、会不会分叉、会不会冲突 ｜ 确认：分叉时写清「会建一个合并提交」 ｜ 结果：顶部同步带 + 历史列表 | 直 |
| 8.7 | 拉取并变基 · [git pull](https://git-scm.com/docs/git-pull) `--rebase` | 改写 | 有上游；本地未推送的提交会被重写 | 预检：本地有几条会被重放、哈希会变 ｜ 确认：写清「已经推上去的话，远端会分叉」 ｜ 结果：同 8.6 | 折 |
| 8.8 | 只允许快进 · [git pull](https://git-scm.com/docs/git-pull) `--ff-only` | 写 | 有上游 | 预检：不能快进就禁用并写原因 ｜ 结果：同 8.6 | 直 |
| 8.9 | 推送当前分支 · [git push](https://git-scm.com/docs/git-push) | 写 | 有上游；远端没有新提交（非快进会被拒） | 预检：领先几条、上次抓取是什么时候 ｜ 确认：无 ｜ 结果：顶部同步带「已同步」 | 直 |
| 8.10 | 首次推送并设上游 · [git push](https://git-scm.com/docs/git-push) `-u` | 写 | 远端存在；远端没有同名分支 | 预检：会在远端新建一条分支 ｜ 结果：分支行出现上游 | 直 |
| 8.11 | 删远端分支 / 标签 · [git push](https://git-scm.com/docs/git-push) `--delete` | 毁 | 远端分支 / 标签存在 | 预检：删的是远端，本地分支还在 ｜ 确认：二次确认 + 写清谁可能会用到这条分支 ｜ 结果：分支浮层远端组行消失 | 折 |
| 8.12 | 强推（带租约） · [git push](https://git-scm.com/docs/git-push) `--force-with-lease` | 毁 | 本地与远端历史已分叉 | 预检：会覆盖远端哪几条提交、租约基准是什么 ｜ 确认：写清「别人可能已经推了新提交；租约只在没重新抓取时有效」 ｜ 结果：顶部同步带 + 历史列表整段变化 | 折 |
| 8.13 | 原子推送 · [git push](https://git-scm.com/docs/git-push) `--atomic` | 写 | 一次推多个引用 | 预检：要么全成、要么全不成 ｜ 结果：同 8.9 | 折 |
| 8.14 | 推送标签 · [git push](https://git-scm.com/docs/git-push) `--follow-tags` / `--tags` | 写 | 有标签 | 预检：哪些标签会被推 ｜ 结果：折叠区标签行标「已推送」 | 折 |
| 8.15 | 认证与凭据 · [git credential](https://git-scm.com/docs/git-credential) / [git-credential-cache](https://git-scm.com/docs/git-credential-cache) / [git-credential-store](https://git-scm.com/docs/git-credential-store) | 写 | 远端要认证 | 面板不该碰凭据原文（`credential-store` 是明文落盘） ｜ 替代：只显示「已认证为 X / 未认证」，认证交给系统凭据管理器或终端 | 外 |
| 8.16 | 克隆 · [git clone](https://git-scm.com/docs/git-clone) | 写 | 有目标地址与本地路径；要选目录 | 面板没有文件选择器，也没有长任务的进度与取消 ｜ 替代：只读显示「当前仓库来自哪里」 | 外 |

### 2.9 域九：工作树与多开

**结论：工作树是「同一个仓库开多份目录」的机制，列表与删除适合面板，新建要选路径所以只能放进带路径输入的折叠区。** 它和分支的区别必须在预检里写清：一个分支同时只能被一个工作树占用；主工作树不能删、不能移。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 9.1 | 工作树列表 · [git worktree](https://git-scm.com/docs/git-worktree) `list` | 读 | 在仓库内 | 结果：工作树页，每行路径 + 分支 + 锁定标记 | 直 |
| 9.2 | 新建工作树 · [git worktree](https://git-scm.com/docs/git-worktree) `add` | 写 | 目标目录不存在或为空；分支没被别的工作树占用 | 预检：路径、分支、是否新建分支 ｜ 确认：会在磁盘上建一个目录 ｜ 结果：工作树行新增 | 折 |
| 9.3 | 用已有分支建工作树 · [git worktree](https://git-scm.com/docs/git-worktree) `add <path> <branch>` | 写 | 该分支没被占用（占用时 `-f` 才让过，面板不该给 `-f`） | 预检：占用情况，被占用就禁用并指出哪条工作树占着 ｜ 结果：同 9.2 | 折 |
| 9.4 | 删除工作树 · [git worktree](https://git-scm.com/docs/git-worktree) `remove` | 毁 | 不是主工作树；目录干净（脏目录要 `--force`，面板不该给） | 预检：有没有未提交改动、未跟踪文件 ｜ 确认：目录会被删掉，提交不受影响 ｜ 结果：行消失 | 直 |
| 9.5 | 清理失效登记 · [git worktree](https://git-scm.com/docs/git-worktree) `prune` | 写 | 有目录已经不存在的登记 | 预检：会清掉哪几条 ｜ 结果：行消失 | 直 |
| 9.6 | 锁 / 解锁 · [git worktree](https://git-scm.com/docs/git-worktree) `lock` / `unlock` | 写 | 工作树存在；锁要 `--reason` | 预检：锁的原因 ｜ 结果：行上出现锁标记与原因 | 折 |
| 9.7 | 移动工作树 · [git worktree](https://git-scm.com/docs/git-worktree) `move` | 写 | 目标路径不存在；主工作树不能移 | 预检：新旧路径 ｜ 结果：行路径更新 | 折 |
| 9.8 | 稀疏检出 · [git sparse-checkout](https://git-scm.com/docs/git-sparse-checkout) | 写 | 仓库支持；默认 cone 模式 | 预检：会隐藏哪些目录、磁盘能省多少 ｜ 确认：文件从工作区消失（历史里还在） ｜ 结果：改动页只显示保留的路径 | 折 |

### 2.10 域十：子模块

**结论：子模块的面板价值主要是「看懂现在是什么状态」，写动作只值得做三个：新增、初始化并检出、改地址。** 原因：子模块把「一个仓库」变成「仓库里嵌仓库」，任何一步失败都要人进到子模块目录里单独处理，面板给不了那种上下文。批量执行（`foreach`）本质是任意命令，不能进面板。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 10.1 | 列表与状态 · [git submodule](https://git-scm.com/docs/git-submodule) `status` | 读 | 仓库里有 `.gitmodules` | 结果：折叠区「子模块」，每行路径 + 当前提交 + 是否已初始化 | 折 |
| 10.2 | 新增子模块 · [git submodule](https://git-scm.com/docs/git-submodule) `add` | 写 | 父仓库工作区干净；URL 可达 | 预检：URL、路径、会写 `.gitmodules` 与一个 gitlink ｜ 确认：会在仓库里多一个目录 ｜ 结果：改动页出现 `.gitmodules` 与子模块目录 | 折 |
| 10.3 | 初始化并检出 · [git submodule](https://git-scm.com/docs/git-submodule) `update --init [--recursive]` | 写 | `.gitmodules` 存在 | 预检：哪些子模块没初始化、会检出哪个提交（默认 detached HEAD） ｜ 结果：子模块行「已就绪」 | 折 |
| 10.4 | 批量执行 · [git submodule](https://git-scm.com/docs/git-submodule) `foreach` | 写 | 子模块已初始化 | 面板不给任意命令 ｜ 替代：只读显示「N 个子模块，M 个已就绪」 | 外 |
| 10.5 | 改地址 / 同步 · [git submodule](https://git-scm.com/docs/git-submodule) `set-url` / `sync` | 写 | 子模块存在 | 预检：旧 URL → 新 URL；`sync` 把新地址写进 `.git/config` ｜ 结果：子模块行更新 | 折 |
| 10.6 | 改跟踪分支 · [git submodule](https://git-scm.com/docs/git-submodule) `set-branch --branch` | 写 | 子模块存在 | 预检：从「跟提交」改成「跟分支」，之后 update 的行为会变 ｜ 结果：子模块行标分支名 | 折 |
| 10.7 | 取消登记 · [git submodule](https://git-scm.com/docs/git-submodule) `deinit` | 毁 | 子模块工作区干净 | 预检：工作目录会被清空（历史里还在） ｜ 确认：写清 ｜ 结果：行消失 | 折 |
| 10.8 | 吸收子模块的 .git · [git submodule](https://git-scm.com/docs/git-submodule) `absorbgitdirs` | 写 | 子模块的 `.git` 是独立目录 | 面板只放在诊断页，给「把 .git 收进父仓库」一个按钮 ｜ 结果：行上不再显示「独立 .git」 | 诊 |

### 2.11 域十一：仓库维护与迁移

**结论：这一域几乎全是「诊断可以、按钮不行」。** 原因是它们的输入不是仓库里的一个对象，而是「时间 + 磁盘 + 系统调度」：`gc` 要判断多久没跑、`prune` 要知道哪些对象已经过期、`maintenance start` 要往系统里装定时任务、`scalar` 要接管整个克隆流程。面板能给的最多是「现在仓库多大、有多少松散对象、上次打包是什么时候」，然后把重活交出去。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 11.1 | 初始化仓库 · [git init](https://git-scm.com/docs/git-init) `[--bare]` | 写 | 目标目录存在或可建 | 面板没有目录选择器 ｜ 替代：只显示「这个目录还不是仓库」 | 外 |
| 11.2 | 检查完整性 · [git fsck](https://git-scm.com/docs/git-fsck) | 读 | 仓库存在 | 结果：诊断页，几行问题、丢失对象、悬空提交 | 诊 |
| 11.3 | 找还能捞回来的对象 · [git fsck](https://git-scm.com/docs/git-fsck) `--unreachable` / `--lost-found` | 读 | 同上 | 结果：诊断页列出不可达提交，带「从这里建分支」入口 | 诊 |
| 11.4 | 统计对象与体积 · [git count-objects](https://git-scm.com/docs/git-count-objects) `-vH` | 读 | 仓库存在 | 结果：诊断页「松散对象 N 个 / 打包 M 个 / 共 X MB」 | 诊 |
| 11.5 | 垃圾回收 · [git gc](https://git-scm.com/docs/git-gc) | 写 | 仓库存在；会按过期时间清掉不可达对象 | 预检：上次 gc 时间、会清掉多少 ｜ 确认：写清可能清掉悬空对象 ｜ 结果：诊断页 | 折 |
| 11.6 | 清理不可达对象 · [git prune](https://git-scm.com/docs/git-prune) | 毁 | 有不可达对象 | 预检：对象数与最后修改时间 ｜ 确认：找不回 ｜ 结果：诊断页 | 折 |
| 11.7 | 重新打包 · [git repack](https://git-scm.com/docs/git-repack) | 写 | 仓库存在 | 预检：会重写 pack 文件、可能很慢 ｜ 结果：诊断页 | 诊 |
| 11.8 | 自动维护 · [git maintenance](https://git-scm.com/docs/git-maintenance) `run` / `start` / `stop` / `register` | 写 | 仓库存在；`start` 要装系统定时任务 | 预检：会注册到哪个调度器（crontab / systemd / launchctl / schtasks） ｜ 确认：会改系统计划任务 ｜ 结果：诊断页开关 | 外 |
| 11.9 | 提交图 · [git commit-graph](https://git-scm.com/docs/git-commit-graph) | 写 | 仓库存在 | 只是加速，面板只显示「有没有」 | 诊 |
| 11.10 | 多包索引 · [git multi-pack-index](https://git-scm.com/docs/git-multi-pack-index) | 写 | 有多个 pack | 同上 | 诊 |
| 11.11 | 打包引用 · [git pack-refs](https://git-scm.com/docs/git-pack-refs) | 写 | 有松散引用 | 同上 | 诊 |
| 11.12 | 归档导出 · [git archive](https://git-scm.com/docs/git-archive) | 写 | 引用存在 | 要选输出文件与格式（zip / tar） ｜ 替代：只显示「可导出为 zip」 | 外 |
| 11.13 | 离线包 · [git bundle](https://git-scm.com/docs/git-bundle) `create` / `verify` / `unbundle` | 写 | 引用存在；要选文件 | 离线传输与全量备份 ｜ 替代：诊断页显示「上次导出时间」 | 外 |
| 11.14 | 引用存储格式迁移 · [git refs](https://git-scm.com/docs/git-refs) `migrate` | 毁 | 仓库存在；新版 git；旧客户端可能读不了 | 预检：备份、旧客户端兼容性 ｜ 确认：写清不可逆（待核实） ｜ 结果：诊断页 | 外 |
| 11.15 | 大仓库工具 · [scalar](https://git-scm.com/docs/scalar) | 写 | 仓库存在 | 面向超大仓库的封装，面板只显示「这个仓库适合用 scalar」 | 外 |

### 2.12 域十二：配置与钩子

**结论：配置只适合「看 + 改少数几个键」，钩子只适合「看 + 手动跑」。** 原因：配置的键有上千个、作用域有四层（系统 / 全局 / 本地 / 工作树），面板做一个通用键值编辑器就是把 `git config` 的坑原样搬进来；钩子的问题相反——它是一段任意可执行文件，面板能显示「装了什么、上次退出码多少」，但不能替人改脚本。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 12.1 | 读配置 · [git config](https://git-scm.com/docs/git-config) `--list --show-origin` | 读 | 仓库内或 `--global` | 结果：诊断页，按来源分组（系统 / 全局 / 本地 / 工作树） | 诊 |
| 12.2 | 写配置 · [git config](https://git-scm.com/docs/git-config) `set` | 写 | 作用域明确 | 预检：写到哪一层、会覆盖什么 ｜ 确认：无 ｜ 结果：诊断页行更新 | 折 |
| 12.3 | 删配置 · [git config](https://git-scm.com/docs/git-config) `unset` | 写 | 键存在 | 预检：删哪一层 ｜ 结果：行消失 | 折 |
| 12.4 | 身份 · [git config](https://git-scm.com/docs/git-config) `user.name` / `user.email` | 写 | 无 | 预检：当前身份与它来自哪一层 ｜ 结果：顶部身份条 | 折 |
| 12.5 | 钩子清单 · [githooks](https://git-scm.com/docs/githooks) + `core.hooksPath` | 读 | 仓库内 | 结果：诊断页「装了哪些钩子、哪些可执行、目录被改到哪」 | 诊 |
| 12.6 | 手动跑一个钩子 · [git hook](https://git-scm.com/docs/git-hook) `run` | 写 | 钩子存在 | 预检：会以当前工作区状态跑、可能改文件 ｜ 确认：写清 ｜ 结果：输出贴按钮下 | 折 |
| 12.7 | 属性规则 · [git check-attr](https://git-scm.com/docs/git-check-attr) / [gitattributes](https://git-scm.com/docs/gitattributes) | 读 | 有 `.gitattributes` | 结果：诊断页，某路径的换行 / 过滤 / 合并规则 | 诊 |
| 12.8 | 邮件映射 · [git check-mailmap](https://git-scm.com/docs/git-check-mailmap) / [gitmailmap](https://git-scm.com/docs/gitmailmap) | 读 | 有 `.mailmap` | 结果：历史列表里作者显示为映射后的名字 | 诊 |

### 2.13 域十三：调试与底层命令

**结论：这一域大部分是「面板内部用的零件」，不是按钮。** `rev-parse`、`for-each-ref`、`merge-base --is-ancestor`、`rev-list --left-right` 这些正是面板判断「能不能快进」「领先几条」时要跑的东西，它们不该出现在界面上；真正值得露出来的只有二分定位和全库搜索。

| # | 能力 · 命令 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 13.1 | 二分定位 · [git bisect](https://git-scm.com/docs/git-bisect) `start` / `bad` / `good` / `skip` / `reset` | 写 | 有一个已知好版本与一个已知坏版本 | 预检：当前第几步、还剩几次、区间里还有几条提交 ｜ 确认：无 ｜ 结果：顶部身份条常驻「二分进行中，还剩 N 步」 | 折 |
| 13.2 | 二分可视化 / 重放 · [git bisect](https://git-scm.com/docs/git-bisect) `visualize` / `replay` | 读 | 二分进行中 | 结果：诊断页 | 诊 |
| 13.3 | 按内容搜工作区 · [git grep](https://git-scm.com/docs/git-grep) | 读 | 工作区有文件 | 结果：整页搜索（原型列为未实现项） | 折 |
| 13.4 | 按条件列文件 · [git ls-files](https://git-scm.com/docs/git-ls-files) | 读 | 在仓库内 | 结果：诊断页「索引里 N 个文件」 | 诊 |
| 13.5 | 看对象内容 · [git cat-file](https://git-scm.com/docs/git-cat-file) `-p` / `-t` | 读 | 对象存在 | 结果：诊断页只读文本 | 诊 |
| 13.6 | 看树 · [git ls-tree](https://git-scm.com/docs/git-ls-tree) | 读 | 树对象存在 | 结果：诊断页目录清单 | 诊 |
| 13.7 | 解析引用与路径 · [git rev-parse](https://git-scm.com/docs/git-rev-parse) | 读 | 在仓库内 | 面板内部用，不暴露按钮 | 诊 |
| 13.8 | 枚举引用 · [git for-each-ref](https://git-scm.com/docs/git-for-each-ref) | 读 | 有引用 | 面板内部用（分支、标签列表都靠它） | 诊 |
| 13.9 | 包含关系 · [git merge-base](https://git-scm.com/docs/git-merge-base) `--is-ancestor` | 读 | 两个提交存在 | 面板内部用（判断能不能快进） | 诊 |
| 13.10 | 补丁等价 · [git cherry](https://git-scm.com/docs/git-cherry) / [git patch-id](https://git-scm.com/docs/git-patch-id) | 读 | 两个提交存在 | 结果：诊断页「这条提交在那边有没有等价补丁」 | 诊 |
| 13.11 | 计数与左右差 · [git rev-list](https://git-scm.com/docs/git-rev-list) `--count` / `--left-right` | 读 | 两个引用存在 | 面板内部用（领先 / 落后数） | 诊 |
| 13.12 | 应用补丁 · [git apply](https://git-scm.com/docs/git-apply) `--check` / `--3way` | 写 | 有补丁文本 | 面板不给任意补丁输入 ｜ 替代：只显示「这个 diff 能不能干净应用」 | 诊 |
| 13.13 | 尾部签名 · [git interpret-trailers](https://git-scm.com/docs/git-interpret-trailers) | 写 | 有提交说明文本 | 面板在说明栏里加 `Signed-off-by` 时内部用 | 诊 |
| 13.14 | 图形历史浏览器 · [gitk](https://git-scm.com/docs/gitk) | 读 | Tcl/Tk 可用 | 外部窗口，面板不嵌 | 外 |

### 2.14 域十四：托管平台相关、但不是 git 原语

**结论：这一域全部不做，但要写清「不做」的边界在哪里。** git 自己能做的只到「把提交推上去、把补丁发出去、把凭据交给 helper」；PR、Issue、Release、Actions、账号权限、分支保护规则都是平台 API 的事。面板如果显示这些，就必须绑定平台，违背「不绑定任何托管平台」的前提。

| # | 能力 | 级别 | 前置状态 | 面板里怎么表达 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 14.1 | 生成补丁邮件 · [git format-patch](https://git-scm.com/docs/git-format-patch) | 写 | 有提交区间 | 要选输出目录、会生成多个文件 ｜ 替代：只显示「这条分支上有 N 条待发补丁」 | 外 |
| 14.2 | 发补丁邮件 · [git send-email](https://git-scm.com/docs/git-send-email) | 写 | 配了 SMTP 与账号 | 面板不碰邮件与凭据 ｜ 替代：只显示「有 N 条补丁待发」 | 外 |
| 14.3 | 请求拉取的说明 · [git request-pull](https://git-scm.com/docs/git-request-pull) | 读 | 有起止点与仓库地址 | 结果是给邮件用的文本，面板只读显示 | 诊 |
| 14.4 | PR / Issue / Release | —（非 git） | 平台 API | 不做（票 #1586 的 C 组） | 外 |
| 14.5 | Actions / CI 状态 | —（非 git） | 平台 API | 不做 | 外 |
| 14.6 | 账号与权限 | —（非 git） | 平台 API | git 只到 credential helper（8.15） | 外 |
| 14.7 | 分支保护 / 禁止强推 | —（非 git） | 平台 API | git 端只有 `--force-with-lease`（8.12） | 外 |
| 14.8 | 仓库转移 / 归档 | —（非 git） | 平台 API | 不做 | 外 |

## 3. 全集命令附录

`git help -a` 在本机（git 2.49.0.windows.1）输出 175 个条目：**156 条命令**（149 条核心 + 7 条 Git for Windows 自带的外部命令）+ 19 个文档主题。下面按用途重排成四组，不是 `git help -a` 原来的分组；每条给一句用途和它在第 2 节矩阵里的位置，`—` 表示矩阵没有对应按钮（多半是面板内部用的零件，或这件事根本不该由面板做）。

### 3.1 porcelain：日常命令（60 条）

| 命令 | 一句话用途 | 矩阵覆盖 |
| --- | --- | --- |
| add | 把文件内容加进索引（暂存） | 1.3 |
| am | 从邮箱格式的补丁串依次应用 | 6.11 |
| annotate | 给文件每一行标上提交信息（`blame` 的别名） | 3.5 |
| bisect | 二分查找引入问题的提交 | 13.1 |
| blame | 显示每一行最后由哪次提交、谁改的 | 3.5 |
| branch | 列出、新建、删除分支 | 4.1 |
| checkout | 切换分支，或把文件恢复到某个版本 | 1.6 / 4.3 |
| check-attr | 显示某路径命中的属性规则 | 12.7 |
| check-ignore | 查一条路径为什么被忽略 | 1.13 |
| check-mailmap | 显示作者名与邮箱映射后的规范写法 | 12.8 |
| check-ref-format | 校验引用名是否合法 | 4.2 |
| cherry-pick | 把已有提交的改动搬到当前分支 | 5.5 |
| clean | 删掉工作区里未跟踪的文件 | 1.8 |
| clone | 把仓库克隆到新目录 | 8.16 |
| commit | 把暂存内容记成一条提交 | 2.1 |
| config | 读写仓库或全局配置 | 12.1 |
| credential | 从凭据助手取、存、拒收凭据 | 8.15 |
| credential-cache | 把凭据临时放在内存里 | 8.15 |
| credential-store | 把凭据明文存在磁盘上 | 8.15 |
| describe | 用最近的标签给一个对象起可读名字 | 3.10 |
| diff | 显示提交之间、提交与工作区之间的差异 | 3.3 |
| difftool | 用外部工具显示差异 | 6.7 |
| fetch | 从别的仓库下载对象与引用 | 8.5 |
| format-patch | 把提交导出成邮件格式的补丁 | 14.1 |
| grep | 在文件里按模式找行 | 13.3 |
| hook | 手动跑一个钩子 | 12.6 |
| init | 建一个空仓库，或重新初始化 | 11.1 |
| interpret-trailers | 在提交说明末尾加、解析结构化签名 | 13.13 |
| log | 显示提交历史 | 3.1 |
| merge | 把两条开发历史合到一起 | 6.1 |
| merge-tree | 不碰索引与工作区，预演一次合并 | 6.10 |
| mergetool | 起外部工具解决冲突 | 6.9 |
| mv | 移动或重命名文件、目录、符号链接 | 1.11 |
| notes | 给对象加备注、看备注 | 3.12 |
| patch-id | 算一个补丁的稳定标识 | 13.10 |
| pull | 抓取并整合另一个仓库或本地分支 | 8.6 |
| push | 把本地引用与对象推到远端 | 8.9 |
| range-diff | 比较两组提交（例如同一分支的两版） | 3.9 |
| rebase | 把提交重新应用到另一个基座上 | 5.6 |
| reflog | 管理引用移动的日志 | 3.11 |
| remote | 管理被跟踪的远端集合 | 8.1 |
| replace | 建、列、删「替换对象」的引用 | 5.12 |
| rerere | 复用以前记录过的冲突解法 | 6.14 |
| reset | 把当前 HEAD 重置到某个状态 | 5.1 |
| restore | 恢复工作区文件 | 1.5 |
| revert | 用一条新提交抵消已有提交 | 5.4 |
| rm | 从工作区与索引里删文件 | 1.9 |
| shortlog | 把 `log` 输出按作者汇总 | — |
| show | 显示各种对象 | 3.2 |
| show-branch | 显示分支与它们的提交 | — |
| sparse-checkout | 把工作区缩到一部分已跟踪文件 | 9.8 |
| stash | 把脏工作区的改动收走 | 7.1 |
| status | 显示工作区状态 | 1.1 |
| submodule | 初始化、更新、查看子模块 | 10.1 |
| switch | 切换分支 | 4.3 |
| tag | 建、列、删、验签标签 | 4.9 |
| verify-commit | 检查提交的签名 | 4.12 |
| verify-tag | 检查标签的签名 | 4.12 |
| whatchanged | 显示每次提交引入的差异（旧命令） | — |
| worktree | 管理同一仓库的多份工作目录 | 9.1 |

### 3.2 plumbing：底层命令（40 条）

| 命令 | 一句话用途 | 矩阵覆盖 |
| --- | --- | --- |
| apply | 把补丁应用到文件或索引 | 13.12 |
| cat-file | 输出对象的内容或类型 | 13.5 |
| checkout-index | 把索引里的文件写回工作区 | —（内部） |
| cherry | 找出还没进上游的提交 | 13.10 |
| commit-graph | 写、校验提交图文件 | 11.9 |
| commit-tree | 直接创建一个提交对象 | —（内部） |
| diff-files | 比较工作区与索引 | —（内部） |
| diff-index | 比较一棵树与工作区或索引 | —（内部） |
| diff-tree | 比较两棵树的内容与模式 | —（内部） |
| for-each-ref | 逐个引用输出信息 | 13.8 |
| for-each-repo | 对一组仓库逐个跑命令 | —（内部） |
| get-tar-commit-id | 从 `archive` 产物里取出提交号 | —（诊断） |
| hash-object | 算对象号，可选地写成对象 | —（内部） |
| index-pack | 给已有的 pack 建索引 | —（内部） |
| ls-files | 列出索引与工作区里的文件 | 13.4 |
| ls-remote | 列出远端仓库的引用 | 8.4 |
| ls-tree | 列出一棵树的内容 | 13.6 |
| merge-base | 找两个提交的最佳共同祖先 | 13.9 |
| merge-file | 对单个文件做三方合并 | —（6.7 用它） |
| merge-index | 对需要合并的文件批量跑合并 | —（内部） |
| mktag | 带额外校验地建标签对象 | —（内部） |
| mktree | 从 `ls-tree` 文本建树对象 | —（内部） |
| multi-pack-index | 写、校验多包索引 | 11.10 |
| name-rev | 给提交找符号名 | —（内部） |
| pack-objects | 把对象打成包 | —（内部） |
| pack-redundant | 找出重复的包文件 | —（诊断） |
| prune-packed | 删掉已经在包里的松散对象 | —（内部） |
| read-tree | 把树信息读进索引 | —（内部） |
| replay | 把提交重放到新基座（实验性） | —（实验性） |
| rev-list | 按时间倒序列出提交 | 13.11 |
| rev-parse | 解析引用、路径与参数 | 13.7 |
| show-index | 显示包索引内容 | —（诊断） |
| show-ref | 列出本地引用 | —（内部） |
| symbolic-ref | 读、改、删符号引用 | —（内部） |
| unpack-file | 把一个 blob 落成临时文件 | —（内部） |
| unpack-objects | 从包里解出对象 | —（内部） |
| update-index | 逐项登记工作区文件到索引 | —（内部） |
| update-ref | 安全地移动一个引用 | —（内部） |
| verify-pack | 校验包文件 | —（诊断） |
| write-tree | 把当前索引写成树对象 | —（内部） |

### 3.3 maintenance：维护、服务端与迁移（21 条）

| 命令 | 一句话用途 | 矩阵覆盖 |
| --- | --- | --- |
| archive | 从某个树导出 zip / tar | 11.12 |
| backfill | 补下载部分克隆里缺的对象（实验性） | —（实验性） |
| bundle | 把对象与引用打包成一个文件搬运 | 11.13 |
| count-objects | 数松散对象并算磁盘占用 | 11.4 |
| daemon | 一个很简单的 git 协议服务端 | —（服务端） |
| fast-export | 把历史导出成流 | 5.13 |
| fast-import | 从流快速导入历史 | 5.13 |
| fetch-pack | 从另一个仓库接收缺的对象 | —（传输） |
| filter-branch | 重写分支历史 | 5.11 |
| fsck | 检查对象连通性与有效性 | 11.2 |
| gc | 清理无用文件并优化本地仓库 | 11.5 |
| http-backend | Git over HTTP 的服务端实现 | —（服务端） |
| maintenance | 跑优化仓库数据的任务 | 11.8 |
| pack-refs | 把引用打包，加快访问 | 11.11 |
| prune | 清掉所有不可达对象 | 11.6 |
| refs | 底层查看引用存储、迁移格式 | 11.14 |
| repack | 把松散对象重新打包 | 11.7 |
| scalar | 管理超大仓库的工具 | 11.15 |
| send-pack | 通过 git 协议把对象推到另一个仓库 | —（传输） |
| survey | 量仓库的规模维度（实验性） | —（实验性） |
| update-server-info | 更新哑服务器要用的信息文件 | —（服务端） |

### 3.4 其他：图形界面、平台桥接、诊断与外部命令（35 条）

| 命令 | 一句话用途 | 矩阵覆盖 |
| --- | --- | --- |
| archimport | 把 GNU Arch 仓库导入 git | —（迁移） |
| askpass | Git for Windows 的图形口令输入框 | —（外部） |
| askyesno | Git for Windows 的图形确认框 | —（外部） |
| bugreport | 收集信息让用户去报 bug | —（诊断） |
| citool | `commit` 的图形替代 | —（外部） |
| column | 把数据排成列 | —（内部） |
| credential-helper-selector | Git for Windows 选凭据助手 | —（外部） |
| credential-manager | Git for Windows 的凭据管理器 | —（外部） |
| cvsexportcommit | 把单条提交导出到 CVS 检出目录 | —（迁移） |
| cvsimport | 从 CVS 抢救数据 | —（迁移） |
| cvsserver | 模拟一个 CVS 服务端 | —（迁移） |
| diagnose | 生成一个诊断 zip | —（诊断） |
| flow | Git for Windows 的 git flow 封装 | —（外部） |
| fmt-merge-msg | 生成合并提交的说明 | —（内部） |
| gitk | 图形化的仓库浏览器 | 13.14 |
| gitweb | git 的网页前端 | —（服务端） |
| gui | 可移植的图形界面 | —（外部） |
| help | 显示帮助 | — |
| imap-send | 把补丁串发进 IMAP 目录 | —（邮件） |
| instaweb | 立刻用 gitweb 浏览当前仓库 | —（服务端） |
| lfs | Git LFS（大文件存储） | —（外部） |
| mailinfo | 从一封邮件里抽出补丁与作者 | —（内部） |
| mailsplit | 拆 mbox 文件 | —（内部） |
| merge-one-file | `merge-index` 用的单文件合并助手 | —（内部） |
| p4 | 与 Perforce 互相导入、提交 | —（迁移） |
| quiltimport | 把 quilt 补丁串应用到当前分支 | —（迁移） |
| request-pull | 生成一份「待拉取改动」的说明 | 14.3 |
| send-email | 把补丁串当邮件发出去 | 14.2 |
| sh-i18n | 给 shell 脚本做 i18n 初始化 | —（内部） |
| sh-setup | shell 脚本的公共初始化 | —（内部） |
| stripspace | 去掉多余的空白行与行尾空白 | —（内部） |
| svn | 与 Subversion 双向操作 | —（迁移） |
| update-git-for-windows | 升级 Git for Windows | —（外部） |
| var | 显示 `GIT_EDITOR` 这类逻辑变量 | —（内部） |
| version | 显示 git 的版本号 | — |

## 4. 必须交出去的部分

先划清一件事：**折叠区（折）和只读诊断（诊）不算「交出去」**，它们仍然在面板里，只是不在主面板。本节只列矩阵里标「外」的动作，按「面板为什么做不了」分组；每组末尾写面板该显示什么替代信息——交出去不等于在界面上留一片空白。

### 4.1 要人操作 git 之外的产物：编辑器

- 不带 `-m` 的 [git commit](https://git-scm.com/docs/git-commit)、[git rebase](https://git-scm.com/docs/git-rebase) `-i` 的待办清单、[git branch](https://git-scm.com/docs/git-branch) `--edit-description`、[git config](https://git-scm.com/docs/git-config) `edit`。
- 为什么：git 把「写什么」交给 `core.editor` 指向的程序，进程退出才算完成；面板既拿不到中途内容，也分不清「保存退出」和「清空退出」。
- 面板替代：说明栏给标题 + 正文两栏，`commit.template` 预填；变基只做结构化最小集，不打开待办清单；分支说明只读显示。

### 4.2 要执行任意命令

- [git submodule](https://git-scm.com/docs/git-submodule) `foreach`、[git bisect](https://git-scm.com/docs/git-bisect) `run`、[git rebase](https://git-scm.com/docs/git-rebase) `--exec`、[git filter-branch](https://git-scm.com/docs/git-filter-branch) 的各类 filter、[git fast-import](https://git-scm.com/docs/git-fast-import)、钩子脚本本体。
- 为什么：这些命令的输入是一段 shell。面板一旦接受任意命令，「预检 → 确认 → 结果」三件事同时失效：预检没法预测，确认没法写清会动什么，结果没法结构化展示。
- 面板替代：`foreach` 只显示「N 个子模块，M 个已就绪」；二分只做手工标好 / 标坏；钩子只显示清单、路径与上次退出码。

### 4.3 要文件选择器或长任务进度

- [git init](https://git-scm.com/docs/git-init)、[git clone](https://git-scm.com/docs/git-clone)、[git archive](https://git-scm.com/docs/git-archive)、[git bundle](https://git-scm.com/docs/git-bundle)、[git format-patch](https://git-scm.com/docs/git-format-patch)。
- 为什么：要么要选一个在仓库之外的路径（300–520 宽放不下目录树），要么是一次可能几分钟的传输（要进度、取消、断点续传）。这两件事都不是「一个按钮 + 一张确认卡」的规模。
- 面板替代：只显示「当前仓库来自哪个地址」「这条区间可以导出为 zip / bundle」，把动作留给终端。

### 4.4 要系统权限、密钥或凭据交互

- [git maintenance](https://git-scm.com/docs/git-maintenance) `start`（往 crontab / systemd / launchctl / schtasks 装计划任务）、[git credential-store](https://git-scm.com/docs/git-credential-store)（明文落盘）、签名提交时的口令、SSH 密钥口令。
- 为什么：装系统计划任务要管理员权限；口令与凭据是「可重放的秘密」，面板不该持有，仓库的日志纪律也禁止把凭证原文落盘。
- 面板替代：显示「自动维护未开启 / 已注册到 schtasks」；认证状态只写「已认证为 X / 未认证」，认证动作交给系统凭据管理器或终端。

### 4.5 外部图形工具

- [gitk](https://git-scm.com/docs/gitk)、[git gui](https://git-scm.com/docs/git-gui)、`git citool`、[git mergetool](https://git-scm.com/docs/git-mergetool)、[git difftool](https://git-scm.com/docs/git-difftool)。
- 为什么：它们各自开窗口、各自维护状态，面板嵌不进去，也没法把结果读回来（只能等退出码）。
- 面板替代：只显示「已配置哪个工具」，把「用外部工具打开」写成交接说明；原型约定不出现「复制命令」，所以不要给命令行。

### 4.6 全库重写与迁移

- [git filter-branch](https://git-scm.com/docs/git-filter-branch)（官方文档顶部已建议改用 git-filter-repo）、[git fast-export](https://git-scm.com/docs/git-fast-export) / [git fast-import](https://git-scm.com/docs/git-fast-import)、[git replace](https://git-scm.com/docs/git-replace)、[git svn](https://git-scm.com/docs/git-svn) / [git p4](https://git-scm.com/docs/git-p4) / [git cvsimport](https://git-scm.com/docs/git-cvsimport) / [git archimport](https://git-scm.com/docs/git-archimport) / [git quiltimport](https://git-scm.com/docs/git-quiltimport)、[git refs](https://git-scm.com/docs/git-refs) `migrate`。
- 为什么：它们不是「一个动作」，是一次全库扫描或一段外部协议会话。失败之后没有「重试这一步」，只有「从备份恢复」；面板给不了这个兜底。
- 面板替代：诊断页显示「历史 N 条、最大对象 X MB、引用格式是 files / reftable」，并注明这类操作建议用专用工具；不提供入口。

### 4.7 服务端与托管平台

- [git daemon](https://git-scm.com/docs/git-daemon)、[git http-backend](https://git-scm.com/docs/git-http-backend)、[git update-server-info](https://git-scm.com/docs/git-update-server-info)、[gitweb](https://git-scm.com/docs/gitweb)、[git instaweb](https://git-scm.com/docs/git-instaweb)；以及 PR / Issue / Release / Actions / 账号权限 / 分支保护规则。
- 为什么：前者要把当前仓库当服务器对外提供；后者根本不是 git 的能力，是平台 API。
- 面板替代：无——这些不该出现在这个页面里（票 #1586 的 C 组已经这么定）。

## 5. 需要人拍板的开放问题

1. 逐块暂存要不要做？做的话，二进制文件、纯重命名、同一行里既有新增又有删除这三类怎么处理？
2. 交互式变基的「最小集」到底含哪几个动作：只改说明，还是也含压缩、丢弃、重排？
3. 冲突解决只做「整文件选一边」，还是也给「逐块选」？逐块选择在 520 宽里怎么摆？
4. 面板要不要提供强推？如果提供，怎么避免「面板自己抓取过，租约基准被刷新，保护失效」？
5. `stash drop` / `stash clear` 算「毁」还是「改写」？reflog 能不能把它们捞回来（待核实）？
6. `worktree remove` 遇到脏目录：面板只拒绝，还是给 `--force` 并二次确认？
7. 子模块做到「只读 + 新增 / 初始化 / 改地址」够不够？`update` 默认 detached HEAD，要不要在面板里提示「建一条分支」？
8. `fsck` / `gc` / `repack` 要不要给按钮，还是只显示数字？
9. 贮藏、标签、远端、子模块四个折叠区，在 300 宽下会不会太深？要不要合成一个「更多」二级页？
10. 哪些动作需要真进度条（fetch / push / gc），哪些转圈就够？现有「120 秒票据」的时限够不够覆盖一次大抓取？
11. 面板要不要允许写 `git config`？如果只允许改身份，其余键怎么表达「请去终端」？
12. 一个面板只看一个仓库，还是要支持切换？「同一仓库的多份工作树」和「多个仓库」是两件事，要不要都做？

## 6. 来源与复核

**一手来源（每条命令的链接都指到对应页）**

- git 官方文档总表：https://git-scm.com/docs
- 命令清单（本笔记第 3 节的分组依据之一）：https://git-scm.com/docs/git#_git_commands
- 概念指南（`git help -g` 的 13 篇，本笔记用到的）：https://git-scm.com/docs/giteveryday 、https://git-scm.com/docs/gitworkflows 、https://git-scm.com/docs/gitrevisions 、https://git-scm.com/docs/gitcli 、https://git-scm.com/docs/gitrepository-layout 、https://git-scm.com/docs/githooks 、https://git-scm.com/docs/gitignore 、https://git-scm.com/docs/gitattributes 、https://git-scm.com/docs/gitmodules 、https://git-scm.com/docs/gitcredentials 、https://git-scm.com/docs/gitmailmap
- 本机实测：`git help -a`（156 条命令 + 19 个文档主题）、`git help -g`（13 篇指南），git 2.49.0.windows.1，Windows 11
- 本机官方手册副本（与站点同源，用来核对选项细节）：`C:\Program Files\Git\mingw64\share\doc\git-doc\`

**仓内材料**

- `docs/design/20261026-version-control-page-research.md`
- `docs/prototype/vc-redesign/README.md`、`docs/prototype/vc-redesign/src/domain/session.ts`
- 规格票 #1586（`gh issue view 1586 --repo FeatherHunter/dsh-mattpocock-skills-deck`）
- 近邻笔记：`research/github-desktop-feature-survey.md`（二手：GUI 客户端视角）、`research/git-command-parse-survey.md`（读状态与输出解析）

**二手信息说明**：本文没有用任何 GUI 客户端的功能列表当结论依据。唯一提到 GUI 覆盖情况的地方是 `research/github-desktop-feature-survey.md` 那篇近邻笔记，它属于二手观察，只用来交叉检查「哪些动作连成熟客户端也选择不做」，不作为 git 能力的证据。

**怎么复核**

1. 重跑 `git help -a`，命令条数应为 156（149 条核心 + 7 条外部）。
2. 数第 3 节四张表的数据行，加起来应等于 156；每条命令只出现一次。
3. 数第 2 节矩阵里 `| 域.序号 |` 开头的行：域数、能力条数、归属四级的分布应与第 1 节写的一致。
4. 抽任何一行命令页链接，应为 200；`survey` 是已知例外——git-scm.com 上没有它的页面（实验性功能，站点未发布），所以附录里只在用途一栏写了「实验性」，没有给链接。

