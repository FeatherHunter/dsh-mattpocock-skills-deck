# 面板内做 git 写操作时，九组边界行为到底怎样：本机 git 2.49 实测

- 日期：2026-10-30
- 仓库：`D:\dsh-plugin\dsh-mattpocock-skills-deck`
- 票号：#1593（能力边界拍板票；父地图 #1588；本票结论会交给规格票 #1594）
- 读的对象：`research/1588-git-full-capability-surface.md` 与 `research/1592-handoff-actions-in-panel.md` 里标了「待核实」的 git 行为，以及地图 #1588 第五节的 12 条能力边界、笔记 #1592 第 8.3 节的 11 条问题所依赖的前提。
- 证据来源：git 官方文档（链接见第 11 节）、本机 `git 2.49.0.windows.1` 的实测、仓库里已有的宿主代码与配置。除标「文档」的条目外，正文结论都在本机跑过一遍。
- 这份笔记不是新查的外部资料：现有两份研究笔记已经把「哪些动作能进面板、要限定什么条件」讲完了，缺的只是把它们标了「待核实」的几处 git 行为真跑一遍，免得拍板时依赖猜测。

## 一句话结论

九组行为里，只有两件事会改变原来的判断：**强推不能用普通的 `--force-with-lease`**（它会静默覆盖别人刚推的提交），**被 drop 或 clear 的贮藏 reflog 救不回来**。其余七组都是「能做，但做法和直觉不一样」：逐块暂存不能靠 `git add -p` 的拆分，重命名在 git 层没有内容块可拆，交互式变基必须保留 git 自己插入的 `update-ref` 行，冲突的中间状态只能由界面自己保存。

## 0. 为什么现在写这份

地图 #1588 第五节要拍 12 条能力边界，#1592 第 8.3 节又补了 11 条，两边去重后 20 条。这些问题的共同前提是「git 能不能做到、做到要付什么代价」。已有的两份研究笔记对这些前提给了方向性判断，但至少在五处写着「待核实」：贮藏删除后还能不能救回、强推租约到底以什么为基准、交互式变基的待办清单怎么交给 git、冲突的逐块解决有没有 git 侧的中间状态、维护命令在非终端下有没有可解析的进度。

这些问题不该靠猜。2026-10-30 在隔离的临时仓库里把九组行为逐条跑了一遍，下面按组记录结论、命令与后果。每组开头一句是结论，后面是实测过程里真正会改变设计的细节。

## 1. 逐块暂存：能做，但不能指望 git 帮你拆

**结论：二进制文件只能整份暂存；纯重命名没有内容块可拆；同一行的删除与新增可以分开暂存，但必须自己拼 patch 或直接写 index。**

- **二进制文件**：`git diff` 只输出 `Binary files a/bin.dat and b/bin.dat differ`，`git add -p` 打印 `Only binary files changed.` 之后什么都不暂存。`git apply --cached --binary` 能把整份二进制补丁放进暂存区，但那是整份替换，没有一部分的概念。文档里 `--binary` 现在也只是一个兼容选项（「文档」）。
- **纯重命名**：`git mv old.txt new.txt` 之后暂存区里已经是重命名（`git status` 显示 `R  old.txt -> new.txt`），`git add -p` 报 `No changes.`；`git diff --cached` 只有 `similarity index 100%` 与 `rename from/to`，没有 `` 开头的改动块。所以重命名只能整份进暂存区；它后面的内容改动可以另按块处理。
- **同一行既删又增**：单行替换在普通 diff 与 `-U0` 下都是同一块（`-AAAA` 加 `+BBBB`），`git add -p` 按 `s` 会明确报 `Sorry, cannot split this hunk`。程序化可以做到，三条路都实测成功：只暂存删除用 `git apply --cached --no-add` 加完整 diff；只暂存新增用 `git apply --cached --unidiff-zero` 加 0 上下文加半块 patch；要任意中间内容，先用 `git hash-object -w` 造一个 blob，再 `git update-index --cacheinfo 100644,<blob>,<路径>` 直接写进 index。两半各落一次之后 `git status` 是 `MM`。顺序重要：先删后加，反过来会短暂得到 `BBBB` 换行 `AAAA` 换行 的插入态。
- 这组事实的用处：面板的逐块暂存必须自己解析 diff、按块选择、生成 patch 或直接写 index，不能复用 `git add -p` 的交互。二进制与纯重命名在界面上只能整份勾选，说清原因即可。

## 2. 交互式变基：待办清单能交给 git，但 git 自己插的行不能丢

**结论：把面板生成的待办清单覆盖到 git 给的路径上是可行的；但 Windows 上编辑命令必须是一个真脚本，不能写 `cmd /c copy`；如果开了 `--update-refs`，整份替换清单时必须保留 git 插入的 `update-ref` 行，否则分支不会被更新。**

- `GIT_SEQUENCE_EDITOR` 收到的参数就是待办清单路径，只有一个参数，排在命令最后（实测日志里参数个数是 1，最后一个是 `.git/rebase-merge/git-rebase-todo`）。
- Windows 上把 `GIT_SEQUENCE_EDITOR` 设成 `cmd /c copy /Y plan.txt`，正斜杠、反斜杠、带引号三种写法全部失败：git 用 sh 解析这个设置，`cmd /c` 被拆坏，报 `'ebase-merge' is not recognized` 与 `error: there was a problem with the editor`，变基中止。换成真的脚本文件（例如 `.ps1`，参数接待办清单路径）就成功；git 自带的 `cp` 加正斜杠绝对路径也可以用。
- 待办清单里可用的动作（实测与命令注释一致）：`p` 保留、`r` 改说明、`e` 编辑、`s` 压缩、`f` 合并进上一条并丢弃自己的说明、`x exec` 跑一条命令、`b break` 停下、`d` 丢弃、`l` 打标签、`t` 复位、`m` 合并、`u update-ref`。
- 一次五提交的变基实测（把第 4 条重排到第 3 条前，并改说明、压缩、丢弃）：退出码 0，提交数 5 变 3，重排与丢弃都生效，压缩出来的提交同时含两条提交的文件。压缩的默认说明是「This is a combination of 2 commits」加第一条说明加第二条说明，注释行不进最终说明。`fixup` 不调编辑器，也不保留自己的说明。
- 改说明（`reword`）时 `GIT_EDITOR` 收到的是 `.git/COMMIT_EDITMSG`，内容是原说明加标准注释模板。用脚本整份写预置文本成功，说明被替换成预置内容。所以「面板里先写好说明，再让脚本按路径覆盖文件」这条路成立。
- `--update-refs` 本机支持（git 2.38 引入）：机制是 git 在待办清单里自动插入 `u update-ref refs/heads/<分支>` 行，成功时输出 `Updated the following refs with --update-refs`。实测把整份清单替换成面板生成的版本、丢掉这些行，相关分支就不会更新（停在旧提交）；保留这些行才会更新到重写后的提交。面板要么原样保留这些行，要么最后自己 `git update-ref`。
- 冲突时变基退出码 1，打印 `CONFLICT (content): Merge conflict in <文件>` 与 `error: could not apply <提交>`，停在冲突状态；没解决时 `git rebase --continue` 退出 1 并说「needs merge」「You must edit all merge conflicts and then mark them as resolved using git add」；`git rebase --abort` 退出 0 回到变基前的分支与原提交。

## 3. 冲突解决：git 只认整文件，逐块中间态只能界面自己保存

**结论：index 里只有整文件的三个版本（共同祖先、我们这边、他们那边），没有「解决了一半」的状态；逐块选边在界面里做，保存后整文件一次 `git add`；`git add` 不检查冲突标记，所以保存前是否还有残留标记只能自己查。**

- `git ls-files -u` 的形状：两边都改（UU）有 3 行，stage 1 是共同祖先、2 是我们这边、3 是他们那边；两边都新增（AA）只有 2 与 3；一边删一边改（UD、DU）只有两行。冲突路径没有 stage 0（`git show :0:<文件>` 会报 `but not at stage 0`）。
- 往冲突文件里写一半解决、留一半冲突标记的内容，再 `git add`：退出码 0，git 不校验标记，冲突状态清空，`git show :0:<文件>` 原样返回带标记的内容。也就是说 git 层接受任意内容，面板必须自己保证写回的是人确认过的结果。
- 取三份内容用 `git show :1:<文件>`、`:2:`、`:3:`；整份选边用 `git checkout --ours` 或 `--theirs`（退出 0，但只改工作区，index 仍是三个未合并版本，必须再 `git add`）；重建冲突标记用 `git checkout -m`；自己做三路合并可以用 `git merge-file -p --object-id <我们> <祖先> <他们>`（退出码等于冲突数，`-L` 可改标签，`-h` 列出 `--diff3/--zdiff3/--ours/--theirs/--union/--marker-size` 这些模式）。
- 冲突时 `git status --porcelain` 的状态码：UU 两边都改、AA 两边都新增、UD 被他们删除、DU 被我们删除；文档的短码表里还有 DD/AU/UA。
- 这组事实的用处：面板的冲突编辑器可以完全自绘（用 `show` 取三段内容，或用 `merge-file` 先合并），逐块选择的结果在界面里保存，最后整文件写回并 `git add`；保存前用 `git diff --check` 查残留标记是必要动作。

## 4. 强推：普通租约不安全，必须用显式基准

**结论：`--force-with-lease` 的基准是本地记录的上次远端位置，不是远端此刻的真实位置。先 fetch 过再普通强推，会把别人刚推的提交静默覆盖掉（本机已复现）。要防住它，要么显式指定期望的提交，要么加 `--force-if-includes`（git 2.30 以上）。**

- 实测：另一个仓库先 fetch（本地记录刷新），远端此后没有新提交；本地分支已分叉且不含别人刚推的提交。此时 `git push --force-with-lease origin main` 退出 0，远端分支被覆盖，别人的提交丢失，输出里只有 `+ <旧>...<新> main -> main (forced update)`。文档 git-push 明说租约比较的是本地对这个远端分支的记录（remote-tracking 引用），不是远端真实值。
- 用显式基准就拦得住：`--force-with-lease=main:<操作前记下的提交>`，远端前进之后再推，报 `! [rejected] main -> main (stale info)`，退出 1。
- `--force-if-includes`（git 2.30 以上）配租约：远端最新提交没有被本地包含时，报 `! [rejected] main -> main (remote ref updated since checkout)`，退出 1；先 `git merge origin/main` 把远端集成进来再推就成功。
- 远端没有这个分支、本地也没有它的记录时，`--force-with-lease` 退出 0 直接新建分支；远端已有这个分支但本地从没 fetch 过，普通租约报 `stale info`，先 `git ls-remote origin refs/heads/<分支>`（不需要 fetch）拿到真实提交，再用显式租约推，就成功；显式租约指向一个不存在的分支仍然会创建它。注意本地已经与远端一致时推只报 `Everything up-to-date`，租约根本不会被求值。
- 这组事实的用处：面板的强推必须先 `git ls-remote` 取远端真实位置，再带显式租约推；不能把「刚才 fetch 过」当成安全依据，也不能只给一个普通的 `--force-with-lease` 按钮。

## 5. 贮藏删除：reflog 救不回，只能靠当场记下的提交号

**结论：`git stash drop` 与 `git stash clear` 之后，reflog 里找不到被删的贮藏；唯一的救法是用 drop 当时打印出来的提交号，或者在 git 清理不可达对象之前用 `git fsck --unreachable` 找回来。这个窗口到 `git gc --prune=now` 或自动清理过期对象为止（文档说默认两周）。**

- `drop` 时命令输出带完整提交号（`Dropped refs/stash@{0} (e6faac4d...)`）。drop 之后 stash 列表少一条，`git reflog show refs/stash` 里那条也消失，HEAD 的 reflog 里从来没有贮藏条目。但那个提交对象还在：`git fsck --unreachable` 会列出它，`git cat-file -e` 能确认存在，`git stash apply <提交号>` 能恢复内容，`git stash store -m <说明> <提交号>` 能把它重新放回列表；`git fsck --lost-found` 会把它写到 `.git/lost-found/commit/<提交号>`。
- `clear` 之后 stash 列表清空，`git reflog show refs/stash` 直接报 `fatal: ambiguous argument 'refs/stash'`；但 `git fsck --unreachable` 仍能列出所有不可达提交（两条贮藏加两条 index 提交）以及对应的 tree/blob，`cat-file` 与 `apply` 都还能用。
- `git gc --prune=now` 之后 `cat-file` 退出 1，`fsck` 也不再报，对象永久消失。普通的 `git gc` 不会立即删。
- 这组事实的用处：面板可以把「丢弃贮藏」做成**可撤销的删除**，但撤销不能靠 reflog，必须在丢弃前把提交挂到面板自己的本地引用（例如 `refs/<插件名>/trash/<时间>`），并提供一个「最近丢弃」恢复入口；否则确认卡里只能照实写「删了就找不回」。

## 6. 工作树移除：脏目录一次 `--force`，锁定要两次

**结论：有改动或未跟踪文件的工作树默认拒绝移除，一次 `--force` 就删；被锁定的工作树要两次 `--force`（实际是 `-f -f`），或者先解锁。**

- 脏工作树：`git worktree remove <路径>` 退出 128，提示 `fatal: '<路径>' contains modified or untracked files, use --force to delete it`；加一次 `--force` 成功，目录连同内容一起删除。
- 锁定工作树：退出 128，提示 `fatal: cannot remove a locked working tree, lock reason: <原因>` 并给出 `use 'remove -f -f' to override or unlock first`；加一次 `--force` 仍然 128，`-f -f` 才成功。
- 手工删掉目录之后，`git worktree list --porcelain` 的那一行会带 `prunable`；`git worktree prune -n -v` 只打印将删除什么、不动真格，`git worktree prune -v` 才真删并清空 `.git/worktrees`。
- 这组事实的用处：面板的「移除工作树」默认拒绝脏目录并列出脏在哪里；「强制移除」用一次 `--force` 并二次确认；被锁定的工作树只给「先解锁，再移除」两步，不给一键 `-f -f`。

## 7. 子模块：默认是游离状态，更新到远端才会离开登记的提交

**结论：`git submodule update` 之后子模块是游离 HEAD（正常状态，不是故障）；`update --remote` 会抓取并检出子模块远端的最新提交；`status` 的前导字符能区分未初始化、与登记一致、与登记不一致。**

- 添加子模块成功后，`git status` 的那一行形如 ` 58f5a0d... sub (heads/main)`：前导空格表示已初始化且与登记提交一致，前导 `-` 表示还没初始化，前导 `+` 表示当前提交与登记的不一致。刚添加的子模块在它的主分支上；`git submodule update --init` 之后变成游离 HEAD（`git rev-parse --abbrev-ref HEAD` 输出 `HEAD`）；`.git/config` 里会写 `submodule.<名字>.active` 与 `.url`。
- 默认的 `git submodule update` 停在父仓库登记的提交；`git submodule update --remote` 会抓取并检出子模块远端最新提交，父仓库 `status` 出现 ` M sub`，描述符变成 `(remotes/origin/HEAD)`，仍然是游离状态。
- 改地址用 `git submodule set-url`，输出 `Synchronizing submodule url for '<名字>'`，同时改 `.gitmodules` 与 `.git/config`；初始化输出 `Submodule '<名字>' (<地址>) registered for path '<路径>'`；`submodule add -b main` 会在 `.gitmodules` 里加 `branch = main`。
- 这组事实的用处：面板的子模块区要能显示「登记提交 vs 当前提交」的差异，并把游离 HEAD 当作正常状态说明；「更新到远端」与「检出登记的提交」是两个不同动作，确认卡要写清各自后果。

## 8. 维护命令：非终端下没有百分比，只有数字能显示

**结论：`gc`、`repack`、`maintenance` 在非终端下静默退出 0，没有可解析的进度百分比；能稳定显示的是 `git count-objects -v` 的数字、包文件数量与大小；`maintenance register` 会写用户全局配置。**

- `git fsck` 退出 0，输出在标准输出（例如 `dangling blob <提交号>`），标准错误为空；`--unreachable` 输出不可达对象；`--no-progress` 不影响形状；`-h` 退出 129 并打印用法。
- `git gc`、`git repack -ad`、`git maintenance run --task=gc`、`git gc --quiet` 都退出 0，非终端下标准输出与标准错误全空。`git repack -ad --progress` 直接报 `error: unknown option 'progress'`（2.49 的 repack 没有这个选项），`gc` 也没有 `--progress`。所以面板拿不到「完成了百分之多少」，只能显示转圈、已用时间与取消按钮。
- `git count-objects -v` 输出可解析的数字：gc 前 `count 13 / in-pack 0 / packs 0`，gc 后 `count 0 / in-pack 12 / packs 1 / size-pack 2`；`-vH` 给人读。正常 gc 之后没有 `.git/gc.log`，只有出错时才存在。`git maintenance register` 会往用户全局配置写 `maintenance.repo=<路径>`（`--global --get-all` 能看到），`unregister` 删除它；文档说 register 同时登记后台每小时运行一次维护任务。
- 这组事实的用处：维护折叠区常驻显示 `count-objects -v` 的数字、包文件数量与大小、`gc.log` 是否存在、维护任务是否已登记；动作只给「检查（fsck）」「整理（gc/repack，长任务、可取消）」，不单独给 prune；确认卡写清耗时长、临时磁盘占用、可能被锁挡住。

## 9. 其它可交互性结论

- 需要编辑器或交互的 git 命令只有几个：不带 `-m` 的 `git commit` 与 `--amend`、`git rebase -i`（以及其中 reword/squash 的说明编辑）、`git add -p` 的 `e` 键。其余命令都能用纯子进程加管道跑（diff、apply、checkout、hash-object、update-index、ls-files、show、cat-file、status --porcelain、rev-parse、for-each-ref、ls-remote、count-objects、fsck、worktree list/prune、submodule status、推送到本地文件远端等）。
- Windows 上「编辑器」必须写成脚本文件路径：`cmd /c exit 0` 这种写法会被 git 的 sh 拆坏（报 `'OMMIT_EDITMSG' is not recognized`），而 `git commit -m` 完全不调用编辑器。
- 进度与彩色只在终端里出现；被管道接走时默认没有，克隆与抓取要显式加 `--progress` 才有可解析的输出。
- 轨道之二：`git apply` 的 `--binary` 现在是空操作；`git apply` 的 `--unidiff-zero` 与 `--no-add` 是逐块暂存两条路的关键选项（第 1 节）。

## 10. 这些事实改变了哪几个问题的判断

| 问题（#1593 第 1 轮编号见本会话） | 事实 | 判断变化 |
| --- | --- | --- |
| 1 逐块暂存 | 二进制整份；重命名无内容块；同一行可拆但要自拼 patch | 做逐块，界面必须自己解析 diff；二进制与重命名整份勾选 |
| 2 交互式变基 | 待办清单可覆盖；Windows 要真脚本；`--update-refs` 行不能丢 | 做全套动作；编辑说明用脚本覆盖消息文件；是否开 `--update-refs` 需单独决定 |
| 3 冲突逐块 | index 只有整文件三版本；`git add` 不校验标记 | 逐块选边加手动改，保存后 `git diff --check` 查残留再 add |
| 4 强推 | 普通租约以本地记录为基准，会静默覆盖别人提交 | 必须 `ls-remote` 取真值加显式租约；2.30 以上加 `--force-if-includes` |
| 5 贮藏删除可救性 | reflog 救不回；只能用 drop 打印的提交号或在清理前 `fsck` | 面板自己挂本地引用做「最近丢弃」；否则按毁处理 |
| 6 工作树移除 | 脏目录一次 `--force`；锁定要两次 | 默认拒绝加二次确认；锁定只给先解锁再移除 |
| 7 子模块 | 默认游离 HEAD；`update --remote` 取远端最新 | 显示登记与当前差异；两个更新动作分开 |
| 8 维护按钮与进度 | 非终端无百分比；`count-objects` 有数字；register 写全局配置 | 数字常驻加转圈/计时/取消；只读状态说清仓库外影响 |
| 9 四域入口与 300 宽 | 与 git 行为无关，属信息架构 | 归 #1590，本票只定「四域入口不得因 300 宽被砍」 |
| 10 长任务与票据 | 只有 clone/bundle 真正需要任务通道；120 秒票据是启动前新鲜度 | 建通用任务通道，票据语义写死 |
| 11 config 写权限 | 与 git 行为无关，属策略 | 分组放行，见 #1592 的结论 |
| 12 仓库与多工作树 | 与 git 行为无关，属范围 | 一个面板一个仓库；多工作树列表加切过去 |
| 13 版本底线 | 显式租约 2.11 已有；`--force-if-includes` 2.30、`--update-refs` 2.38、维护 2.30、锁定/可清理 2.31 | 不抬高硬底线，按能力版本门做降级或隐藏 |
| 14 随包小程序 | Windows 编辑命令必须真脚本；`cp` 可用；无需常驻小程序也能表达 | 不随包发小程序，用 git 自带 sh 的 `cp` 与面板驱动的循环 |
| 15 检查清单范围 | 检查命令由面板固定参数跑，不经 shell | 第一期只认 `package.json` scripts 加用户自存 |
| 16-17 凭据 | 与 git 行为无关，属边界 | 面板内一次性手输兜底；不提供明文存 |
| 18 filter-branch | 参数全是 shell 命令 | 不给生成命令，只给诊断 |
| 19 svn 桥 | 与 git 行为无关，属边界 | 只读加抓取 |
| 20 全库重写备份 | 与 git 行为无关，属流程 | clone --mirror 优先，磁盘不够降级 bundle |

## 11. 证据与复现

- 环境：Windows，`git version 2.49.0.windows.1`，`node v24.19.0`；实验仓库在 `D:/Temp/wf1593-gitfacts/`（本轮结束后未清理，方便复核）。
- 隔离方式：`GIT_CONFIG_GLOBAL` 指向一个空文件，`GIT_CONFIG_NOSYSTEM=1`，`GIT_TERMINAL_PROMPT=0`，避免受本机与全局配置影响；涉及远端的实验用本地裸仓库当远端，不走网络。
- 官方文档（本轮引用的页面）：
  - [git-push](https://git-scm.com/docs/git-push)：租约基准、`--force-with-lease=<名称>:<期望值>`、`--force-if-includes`
  - [git-rebase](https://git-scm.com/docs/git-rebase)：交互式命令列表、`--update-refs`
  - [git-apply](https://git-scm.com/docs/git-apply)：`--unidiff-zero`、`--no-add`、`--binary`
  - [git-add](https://git-scm.com/docs/git-add)、[git-status](https://git-scm.com/docs/git-status)、[git-checkout](https://git-scm.com/docs/git-checkout)、[git-merge-file](https://git-scm.com/docs/git-merge-file)
  - [git-stash](https://git-scm.com/docs/git-stash)、[git-worktree](https://git-scm.com/docs/git-worktree)、[git-submodule](https://git-scm.com/docs/git-submodule)
  - [git-fsck](https://git-scm.com/docs/git-fsck)、[git-gc](https://git-scm.com/docs/git-gc)、[git-count-objects](https://git-scm.com/docs/git-count-objects)、[git-maintenance](https://git-scm.com/docs/git-maintenance)
  - [git-update-index](https://git-scm.com/docs/git-update-index)、[git-hash-object](https://git-scm.com/docs/git-hash-object)、[git-config](https://git-scm.com/docs/git-config)、[git-diff](https://git-scm.com/docs/git-diff)
- 本机文档副本（离线复核用）：`C:/Program Files/Git/mingw64/share/doc/git-doc/`。

## 12. 这一轮没验证到的

- 不同 git 版本的行为差异：本机只有 2.49，2.11 到 2.49 之间只在文档层面确认过选项存在（例如 `--force-with-lease` 与显式期望值很早就有了，`--force-if-includes` 是 2.30，`--update-refs` 是 2.38）。规格里凡依赖版本门的能力，都要在预检里按版本分支。
- Windows 之外的系统上「编辑命令写成脚本」与 `cp` 是否同样可用：本机只走了 Windows，规格里要写成可替换的一步，并在失败时给出可读原因。
- 图形界面里逐块暂存与逐块选边的性能（大文件、长行、CRLF 混合）没有实测，属于后续实施票的验收项。

## 13. 第二轮补的实测（2026-10-30 晚，支撑复核后修订的推荐答案）

复核 20 条推荐答案时，有几处机制原先只是推断，补跑了一遍。环境同上（`git 2.49.0.windows.1`，`GIT_CONFIG_GLOBAL` 指向空文件，`GIT_CONFIG_NOSYSTEM=1`），实验目录 `D:/Temp/wf1593-review3/`。

1. 用 `cp` 充当 `GIT_SEQUENCE_EDITOR` 时，路径含空格也能用。待办清单放 `D:/Temp/wf1593-review3/plan with space.txt`，仓库放 `.../repo with space/`，设 `GIT_SEQUENCE_EDITOR='cp "D:/Temp/wf1593-review3/plan with space.txt"'`，`git rebase -i --root` 退出 0，重排的 3 个提交按清单顺序生效。后果：不必随包发「写入器」；git 自带 sh 的 `cp` 足够覆盖待办清单。
2. 「改说明」与「压缩并自定说明」可以完全不经过编辑器：在待办清单里用 `pick`/`fixup` 加 `exec git commit --amend -F "<消息文件>"`。实测清单 `pick A`、`fixup B`、`exec ... -F msg1`、`fixup C`、`exec ... -F msg2`，退出 0，最终一个提交、说明精确等于 msg2 内容、文件集合等于 A+B+C。原因：`fixup` 不打开编辑器；`exec` 里的 `amend` 紧跟在刚生成的提交后面改说明。后果：交互式变基的清单只用 `pick`、`fixup`、`drop`、`exec` 四类行即可，不需要按原文匹配、也不需要 `GIT_EDITOR`；可以把 `GIT_EDITOR` 设成会失败的命令（如 `false`），意外触发时立刻中止而不是挂住。
3. 冲突解决后继续，紧随其后的 `exec` 行仍会执行。清单 `pick D`（与目标分支冲突）、`exec git commit --amend -F msg`；rebase 停在冲突，解决并 `git add` 后 `git rebase --continue` 退出 0，输出出现 `Executing: git commit --amend`，最终提交说明变成 msg、内容保留解决后的文件。后果：逐提交改说明与手解冲突可以共存，不用在冲突后重新生成清单。
4. 脏工作树可以先在它里面贮藏，再正常移除，不需要 `--force`。在链接工作树里改一个已跟踪文件、加一个未跟踪文件，`git stash push -u -m ...` 退出 0；回到主工作树 `git worktree remove <路径>` 退出 0；贮藏出现在共享的 stash 列表；在主工作树 `git stash apply` 退出 0，已跟踪改动与未跟踪文件都回来了。后果：面板可以「先贮藏再移除」，避免用 `--force` 毁掉未提交内容。

版本门的数字核对（官方发布说明与分版手册）：`git stash push` 2.13、`git worktree remove` 2.17、`git submodule set-url` 2.25、`git init -b` 2.28、`git maintenance` 2.30、`--force-if-includes` 2.30、`git worktree list` 的 prunable 标注 2.31、`git rebase --update-refs` 2.38。`git config --show-scope` 是否需要 2.26 没再核，因为修订后的方案不再依赖它（只改身份时作用域由面板自己知道）。

