# git 命令选型与输出解析的坑

本文件是 DSH「版本管理」页签的技术调研，回答票 #811 的问题：要把仓库状态读全，需要跑哪些 git 命令、每条带什么参数、输出怎么稳定地解析，以及在 Windows 上、在不同 git 版本之间会咬人的地方。

文中的每条结论都标了来源标签：

- **【文档】** 来自 git 官方手册或官方发布说明，后面附链接。
- **【实测】** 来自本机跑的只读实验，环境是 Windows 11、git 2.49.0.windows.1、PowerShell 7.6.6。实验仓库建在临时目录 `D:\Temp\gitprobe-aae092904e2148c4b39ac7fd0028984e\`，里面故意放了中文文件名、空格、中文目录名、远端跟踪分支、附加工作树、合并冲突和已删除文件。
- **【没有查到可靠出处】** 查不到官方依据，明确标出，不猜。

## 一、总原则：先钉死运行环境，再解析输出

所有命令都用同一个前缀调用，前缀负责把用户改过的全局配置挡在外面：

```
git --no-optional-locks -c core.quotepath=false -c color.ui=false -C <工作区根目录> <子命令> <参数>
```

四个开关各自的作用：

- `--no-optional-locks`：让 `git status` 不去抢写 `.git/index` 的锁。git 官方文档在 git-status 的「BACKGROUND REFRESH」一节明确建议后台运行的脚本加上这个开关，理由是「When `git` `status` is run in the background, the lock held during the write may conflict with other simultaneous processes, causing them to fail. Scripts running `status` in the background should consider using `git` `--no-optional-locks` `status`」【文档】。**【实测】** 在 git 2.49 上带这个开关运行退出码为 0，输出不变。
- `-c core.quotepath=false`：见第三节。这个开关只在不带 `-z` 时才起作用，带 `-z` 时是双保险。
- `-c color.ui=false`：官方定义见 `core.pager` 之外的 `color.ui`（详见第六节）。**【实测】** 管道场景下本来就自动关色，这条是双保险。
- `-C <工作区根目录>`：见第八节第 1 条，这条最重要。

**关于换行：所有机器可读格式只用 LF 和 NUL，不出现 CR。**【文档】git-status 文档说 `-z` 是 "Terminate entries with _NUL_, instead of _LF_"。【实测】在 git 2.49 上逐字节检查 `git status --porcelain=v2 -z` 与 `git rev-parse --show-toplevel` 的输出，整个缓冲区里没有任何 `0x0D` 字节。解析器按 `\n` 和 `\0` 切分即可，不要做 CRLF 归一化。

## 二、可直接落成代码的解析清单

下面的表是核心交付物。每一行的五列分别是：命令与参数、输出形状、解析成什么、失败时的典型报错。命令一律带上一节的前缀。

### 2.1 仓库与工作树身份

| 事实 | 命令与参数 | 输出形状 | 解析成什么 | 失败时报错（原文） |
|---|---|---|---|---|
| 工作区根目录 | `rev-parse --show-toplevel` | 一行绝对路径，以 `0x0A` 结尾【实测】 | `string`（统一把 `/` 换成 `\`） | 不在仓库内：`fatal: not a git repository (or any of the parent directories): .git`，退出码 128【实测】 |
| 是不是裸仓库 | `rev-parse --is-bare-repository` | 恰好 `true` 或 `false` 加换行 | `boolean` | 同上 |
| 是不是在工作树里 | `rev-parse --is-inside-work-tree` | 恰好 `true` 或 `false` | `boolean` | 同上 |
| git 目录（可能是相对的） | `rev-parse --git-dir` | 主工作树里是 `.git`（相对！），附加工作树里是绝对路径【实测】 | `string` | 同上 |
| git 目录（绝对） | `rev-parse --absolute-git-dir` | 绝对路径 | `string` | 同上 |
| 仓库公共目录 | `rev-parse --git-common-dir` | 主工作树里 `.git`（相对），附加工作树里是主仓库 `.git` 的绝对路径【实测】 | `string` | 同上 |
| 绝对化的 git 路径 | `rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel` | 按给定顺序每行一个绝对路径【实测】 | `string[]`，顺序固定 | 2.31 之前不认这个选项，见第五节 |
| 当前位置到根的相对前缀 | `rev-parse --show-prefix` | 根目录时是空行；子目录里是 `子目录 test/` 这种带结尾斜杠的相对路径【实测】 | `string` | 同上 |

**`rev-parse --show-toplevel` 的路径一定用正斜杠。**【实测】真实路径是 `D:\Temp\gitprobe-.../主仓库 with space`，git 返回 `D:/temp/gitprobe-.../主仓库 with space`。大小写按磁盘上的实际写法保留（另建一个名为 `MiXeD-CaSe_Dir` 的目录测试，返回值里大小写原样保留），**分隔符一定从反斜杠变成正斜杠**。所以不能拿返回值跟你手上保存的路径直接做字符串相等比较，必须先把两边都归一化。

**`--git-dir` 在主工作树和附加工作树里形状不同，这是最容易写错的一处。**【实测】在主工作树里返回相对路径 `.git`；在附加工作树里返回绝对路径 `D:/.../主仓库 with space/.git/worktrees/Linked-WorkTree`。要绝对路径就用 `--absolute-git-dir`，不要自己拼。**【文档】** git-worktree 文档的 DETAILS 一节解释了原因：「Within a linked worktree, `$GIT_DIR` is set to point to this private directory ... and `$GIT_COMMON_DIR` is set to point back to the main worktree's `$GIT_DIR`」。

### 2.2 当前分支

| 事实 | 命令与参数 | 输出形状 | 解析成什么 | 失败时报错 |
|---|---|---|---|---|
| 当前分支名 | `status --porcelain=v2 --branch -z` | 一行 `# branch.head <名字>`；游离头指针时是 `# branch.head (detached)`【实测】 | `string`，等于 `(detached)` 就当作游离 | 不在仓库内同上 |
| 提交号 | 同上 | `# branch.oid <40 位哈希>`；仓库还没有任何提交时是 `# branch.oid (initial)`【实测】 | `string \| null` | 同上 |
| 上游分支 | 同上 | `# branch.upstream <名字>`，没有上游时**整行不出现**【文档】 | `string \| null` | 同上 |
| 领先落后 | 同上 | `# branch.ab +<领先> -<落后>`，没有上游时整行不出现【文档】 | `{ahead: number, behind: number}` | 同上 |
| 当前分支名（另一条路） | `branch --show-current` | 分支名；游离头指针时是**空字符串**；三种状态退出码都是 0【实测】 | `string \| null`（空即 null） | 同上 |
| 当前分支名（最老的一条路） | `symbolic-ref --short -q HEAD` | 分支名；游离头指针时退出码 1 且无任何输出【实测】 | `string \| null` | 无输出、无报错，`-q` 就是为了压掉那句 fatal |

**不要用 `rev-parse --abbrev-ref HEAD`。**【实测】三种状态下它都不可靠：普通分支返回名字；游离头指针返回字面量 `HEAD`（会被误当成一个叫 HEAD 的分支）；仓库还没有任何提交时，它**先往标准输出打印 `HEAD`，再往标准错误打印一段 fatal，退出码 128**。这是最典型的「静默拿到错值」的坑，而票 #811 明确要求不能搞错分支。

`# branch.head` 行的完整定义见 git-status 文档的「Branch Headers」表格【文档】：

> \| Line \| Notes \|<br>\| `#` `branch.oid` _<commit>_ \| (`initial`) \| Current commit. \|<br>\| `#` `branch.head` _<branch>_ \| (`detached`) \| Current branch. \|<br>\| `#` `branch.upstream` _<upstream-branch>_ \| If upstream is set. \|<br>\| `#` `branch.ab` `+`_<ahead>_ `-`_<behind>_ \| If upstream is set and the commit is present. \|

### 2.3 未提交改动的清单

用 `status --porcelain=v2 --branch -z --untracked-files=all`。`--untracked-files=all` 必须显式写，官方文档说不用 `-u` 时默认只列出未跟踪的目录【文档】。

输出分四段：先是可选的 `#` 开头头部行，然后是三类已跟踪条目，再是 `? ` 开头的未跟踪条目，最后是 `! ` 开头的被忽略条目（只在加 `--ignored` 时出现）。**【文档】** git-status 文档明确要求「Tracked entries are printed in an undefined order; parsers should allow for a mixture of the 3 line types in any order」，所以解析器必须按行首字符分派，不能靠顺序。

`1` 开头（普通改动）：

```
1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <路径>
```

`2` 开头（重命名或复制）：

```
2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <路径><分隔符><原路径>
```

`u` 开头（未合并，冲突）：

```
u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <路径>
```

字段含义全部照抄官方表格【文档】：`<XY>` 是暂存区和工作区两个状态，未变的地方用 `.` 而不是空格；`<sub>` 是 4 个字符的子模块状态，不是子模块时是 `N...`，是子模块时是 `S<c><m><u>`；`<mH> <mI> <mW>` 分别是 HEAD、索引、工作区里的八进制文件模式；`<hH> <hI>` 是 HEAD 和索引里的对象名；`<X><score>` 是重命名或复制的相似度分数，例如 `R100`、`C75`；`<路径>` 在重命名条目里是**改后的新路径**；`<原路径>` 是改动来自哪里。

**`2` 记录的分隔符随 `-z` 变，这是逐字匹配时最容易漏掉的一条。**【文档】表格里 `<sep>` 一行写的是：「When the `-z` option is used, the 2 pathnames are separated with a _NUL_ (ASCII 0x00) byte; otherwise, a _TAB_ (ASCII 0x09) byte separates them.」**【实测】**两条都验证过：

```
不带 -z：  ... R100 new-新名字.txt<TAB>old-name.txt
带 -z：    ... R100 new-新名字.txt<NUL>old-name.txt<NUL>
```

注意带 `-z` 时，两个路径各自以 NUL 结尾，所以**一条重命名记录在 `-z` 模式下会消耗两个 NUL 结尾的字段**，不能一律按「一个 NUL 是一条记录」来切。

`XY` 两位状态码的完整含义表见 git-status 文档的 Short Format 一节【文档】，常用的：` `（空格）未变、`M` 已修改、`T` 文件类型变了、`A` 新增、`D` 删除、`R` 重命名、`C` 复制、`U` 已更新但未合并；`?` 配 `?` 是未跟踪，`!` 配 `!` 是被忽略。在 `porcelain=v2` 里未变写 `.` 而不是空格。

**【实测】** 在本机的冲突仓库里，`u` 记录的实际长相是：

```
u UU N... 100644 100644 100644 100644 2646bf33f4d91ca037295faba6858bed5f873bca 1233f794a039f68b48ec7ba896e289cb9a6ffb05 1a5f3e95bcb5e42dc297aed15456cf6d7fcf6be9 f.txt
```

也就是 4 个模式、3 个哈希、然后才是路径，共 11 个空格分隔的字段。

### 2.4 工作树列表

| 事实 | 命令与参数 | 输出形状 | 解析成什么 | 失败时报错 |
|---|---|---|---|---|
| 全部工作树 | `worktree list --porcelain` | 每条记录以 `worktree <路径>` 开头，随后若干属性行，**空行表示记录结束**【文档】【实测】 | `Array<{path, head, branch, bare, detached, locked, prunable}>` | 不在仓库内：`fatal: not a git repository (or any of the parent directories): .git`，退出码 128【实测】 |
| 同上，路径可能含换行时 | `worktree list --porcelain -z` | 每个属性行以 NUL 结尾，记录之间用一个空的 NUL 分隔【实测】 | 同上 | 同上 |

**【文档】** 官方对格式的描述是：「The porcelain format has a line per attribute. If `-z` is given then the lines are terminated with NUL rather than a newline. Attributes are listed with a label and value separated by a single space. Boolean attributes (like `bare` and `detached`) are listed as a label only, and are present only if the value is true. Some attributes (like `locked`) can be listed as a label only or with a value depending upon whether a reason is available. The first attribute of a worktree is always `worktree`, an empty line indicates the end of the record.」

**【实测】** 带一个被锁定的工作树时，输出是：

```
worktree D:/temp/gitprobe-.../主仓库 with space
HEAD 676e4859d3bcddcea17eedc452a6de6ef4531e65
branch refs/heads/master

worktree D:/temp/gitprobe-.../Linked-WorkTree
HEAD 676e4859d3bcddcea17eedc452a6de6ef4531e65
branch refs/heads/wt-分支
locked 被别的窗口占用

```

四条要注意的地方：

1. `locked` 可以是光秃秃一个标签（没有原因），也可以是 `locked <原因>`，原因里可能有空格。**判断方式是标签后面还有没有内容。**
2. 主工作树排第一，后面才是各个附加工作树，这是官方保证的顺序【文档】：「The main worktree is listed first, followed by each of the linked worktrees.」
3. **`worktree` 那一行的路径不会被 `core.quotepath` 转义。**【实测】路径里有空格和中文时原样输出，没有加引号。官方文档只说明锁的原因会被转义：「Unless `-z` is used any "unusual" characters in the lock reason such as newlines are escaped and the entire reason is quoted as explained for the configuration variable `core.quotePath`」【文档】。所以想连原因里的换行一起安全处理，还是得加 `-z`。
4. 仓库还没有任何提交时，`HEAD` 是 40 个 0【实测】。
5. 裸仓库的记录里没有 `HEAD` 和 `branch` 两行，只有 `bare`【实测】。

**哪个工作树是「当前」的**：不要靠比较 `worktree` 路径和当前工作目录来判断，正确做法是拿 2.2 节里 `# branch.head` 的分支名，去比对每条记录的 `branch refs/heads/<名字>`。这样天然避开了 Windows 上路径大小写与斜杠的差异。另一个办法是用 `for-each-ref` 的 `%(worktreepath)`，见下节。

### 2.5 分支清单与远端跟踪关系

| 事实 | 命令与参数 | 输出形状 | 解析成什么 | 失败时报错 |
|---|---|---|---|---|
| 全部本地分支 | `for-each-ref --format=... refs/heads/` | 每行一条，以 `0x0A` 结尾，**最后一条后面也有换行**【实测】 | `Array<Branch>` | 格式串里的字段名写错：`fatal: unknown field name: <你写的名字>`，退出码 128【实测】 |

推荐的格式串（用 `%00` 做字段分隔，用固定分隔符做记录分隔）：

```
--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(worktreepath)%00%(committerdate:iso-strict)
```

**【实测】** 各字段的实际取值（本地分支 `master`、上游 `origin/master`、领先 2 个提交、在主工作树里被检出）：

```
refs/heads/master|master|676e485|origin/master|[ahead 2]|*|D:/temp/gitprobe-.../主仓库 with space|2026-10-02T16:02:31+08:00
```

对照着看，四个容易写错的点：

- `%(HEAD)` 在当前分支上打印星号 `*`，在别的分支上打印**一个空格**，不是空字符串。所以要 `trim()` 之后再判断是不是等于 `*`。
- `%(upstream:track)` 在没有上游时打印**空字符串**（不是 `[]`），领先时是 `[ahead 2]`，落后时是 `[behind 3]`。
- **当上游分支已经在远端被删掉时打印 `[gone]`。**【实测】我造了一个上游指向 `refs/heads/does-not-exist` 的分支，`%(upstream:track)` 给出 `no-upstream-branch|up=[origin/does-not-exist]|track=[[gone]]`。这个值必须单独处理，不能当成正常分支。
- `%(worktreepath)` 在分支被某个工作树检出时给出该工作树路径，没被检出时是空字符串。这比拿路径去比对更可靠。

**默认排序。**【实测】不加 `--sort` 时按 refname 字典序，并且 `refs/heads/` 全部排在 `refs/remotes/` 前面。实测输出：

```
refs/heads/feature-实验分支
refs/heads/main
refs/heads/master
refs/heads/wt-分支
refs/remotes/origin/master
```

`%(committerdate:iso-strict)` 给的是 `2026-10-02T16:02:31+08:00` 这种带时区偏移的严格 ISO 8601 格式【实测】。

**领先落后数值的另一种拿法。**【实测】

| 命令 | 输出 |
|---|---|
| `rev-list --left-right --count <上游>...HEAD` | `0<TAB>2`，左边的数字是只有上游有的提交数，右边是只有 HEAD 有的 |
| `rev-list --left-right --count HEAD...<上游>` | `2<TAB>0`，顺序反过来 |
| `rev-list --left-right --count HEAD...HEAD` | `0<TAB>0` |
| `rev-list --count <上游>..HEAD` | `2`，只有一个数字 |

上游本地不存在时，`rev-list` 会失败，**【实测】** 退出码 128，报错原文：

```
fatal: ambiguous argument 'refs/heads/does-not-exist...HEAD': unknown revision or path not in the working tree.
Use '--' to separate paths from revisions, like this:
'git <command> [<revision>...] -- [<file>...]'
```

所以优先用 `# branch.ab` 那行，它在上游消失时整行不出现，不会报错。

### 2.6 提交历史

| 事实 | 命令与参数 | 输出形状 | 解析成什么 | 失败时报错 |
|---|---|---|---|---|
| 提交列表 | `log --no-decorate -z --format=<格式串> -n <条数>` | 每条提交是一段以 NUL 结尾的字段串 | `Array<Commit>` | 仓库无提交时无输出，退出码 0 |

推荐格式串（每个字段后跟 `%x00`）：

```
--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%P%x00%D%x00
```

关键点：

- **`%aI` / `%cI` 是严格 ISO 8601 作者/提交者日期**，`%ad` / `%cd` 依赖 `--date` 选项，形状会变。**【实测】** `--date=iso-strict --format='%ad'` 和 `%aI` 都给出 `2026-10-02T16:02:31+08:00`。要用 `%ad` 就必须同时写 `--date=iso-strict`，否则格式由 `log.date` 配置决定【文档】。
- **提交正文 `%b` 里可能有换行，`%x00` 挡不住。**【实测】一条标题是「标题行」、正文是两行的提交，用 `--format='%H%x00%s%x00%b%x00' -z` 得到的是：

  ```
  700d98...<NUL>标题行<NUL>正文第一段
  正文第二段
  <NUL><NUL>
  ```

  正文里的换行原样保留在两个 NUL 之间。所以解析必须**按 NUL 切分整个输出再按下标取字段**，绝对不能按行切。
- `%D` 打印引用名并把 `->` 展开，实测输出 `HEAD -> master, wt-分支`【实测】。如果不需要就加 `--no-decorate` 并省掉这个字段。
- 提交哈希 `%H` 永远是 40 位（SHA-1 仓库）或 64 位（SHA-256 仓库）。不要把长度写死成 40。

### 2.7 差异

| 事实 | 命令与参数 | 输出形状 | 解析成什么 | 失败时报错 |
|---|---|---|---|---|
| 未提交改动的差异（清单） | `diff --raw -z HEAD` | 见下 | `Array<{srcMode, dstMode, srcSha, dstSha, status, score, path, origPath?}>` | 无 |
| 未提交改动的差异（只有暂存区） | `diff --cached --raw -z` | 同上 | 同上 | 无 |
| 某次提交引入的差异 | `diff-tree --no-commit-id -r --name-status -z <提交>` | 见下 | `Array<{status, path, origPath?}>` | 无 |
| 某次提交引入的差异（根提交） | `diff-tree --root --no-commit-id -r --name-status -z <提交>` | 同上 | 同上 | 无 |

**`diff --raw` 的逐字段格式**【文档】git-diff 文档定义每行为

```
:<srcmode> <dstmode> <srcsha> <dstsha> <status><TAB><路径>
```

`<status>` 是一个字母，可选值 `A`（新增）、`C`（复制）、`D`（删除）、`M`（修改）、`R`（重命名）、`T`（文件类型变了）、`U`（未合并）、`X`（未知，`git diff` 不会产生）、`B`（配对被打断）。字母后面可以跟一个 0 到 100 的相似度分数，`R100` 表示完全一致的重命名。

**【实测】** `diff --raw -z` 的真实输出（`00` 表示 NUL）：

```
:100644 100644 82f83b4 82f83b4 R100<NUL>old-name.txt<NUL>new-新名字.txt<NUL>:100644 000000 1e7b53e 0000000 D<NUL>second-file.txt<NUL>
```

**重命名记录的路径分隔符也随 `-z` 变**：不带 `-z` 时两个路径之间是 TAB，带 `-z` 时是 NUL，且每个路径各自以 NUL 结尾。

**冲突时同一个路径会出现两次。**【实测】在一个 `f.txt` 冲突的仓库里，`diff --raw` 输出：

```
:000000 100644 0000000 0000000 U	f.txt
:100644 100644 1233f79 0000000 M	f.txt
```

`diff --name-status` 同样会给两行（先 `U` 后 `M`）。解析时不要假设「一个路径一条记录」。

**`diff --name-status -z` 的字段顺序是「状态、路径、路径」，跟直觉的「状态、原路径、新路径」相反。**【文档】`--name-status` 带 `-z` 时，git-diff 文档说明重命名和复制条目的字段顺序会反转。**【实测】**

```
R100<NUL>old-name.txt<NUL>new-新名字.txt<NUL>D<NUL>second-file.txt<NUL>
```

**`diff --numstat -z` 有一个多余的行尾 TAB。**【文档】`--numstat` 的三个字段（新增行数、删除行数、路径）在 `-z` 模式下变成「行数<TAB>行数<TAB>NUL」。**【实测】**

```
0	0	<NUL>old-name.txt<NUL>new-新名字.txt<NUL>0	1	second-file.txt<NUL>
```

也就是说重命名记录的第三个 TAB 后面紧跟 NUL，解析时要先剥掉这个尾随 TAB。

**`--name-status` 对不存在的路径不报错。**【实测】`diff --name-status HEAD -- "nope-不存在.txt"` 退出码 0、输出为空。所以「空输出」既可能是「没有改动」也可能是「路径写错了」，不能靠退出码区分。

## 三、Windows 上的编码

### 3.1 路径字节是 UTF-8

**【实测】** 逐字节抓取 `git status --porcelain=v2 -z` 的标准输出，含中文的文件名 `未跟踪 文件.txt` 出现为：

```
E6 9C AA E8 B7 9F E8 B8 AA 20 E6 96 87 E4 BB B6 2E 74 78 74
```

这和用 UTF-8 编码 `未跟踪 文件.txt` 得到的字节完全一致。**结论：git 在 Windows 上输出的路径字节是 UTF-8，不是 GBK。** 解析器按 UTF-8 解码即可，不需要猜编码。

### 3.2 错误信息也是 UTF-8

**【实测】** `git -C "D:\不存在的目录-测试" status` 的错误信息原样输出了中文路径，没有被转成问号或乱码：

```
fatal: cannot change to 'D:\不存在的目录-测试': No such file or directory
```

注意这个路径里的反斜杠**没有**被 `core.quotepath` 转义成 `\xxx` 形式。**【文档】** `i18n.logOutputEncoding` 的定义是「Character encoding the commit messages are converted to when running 'git log' and friends.」——它管的是提交信息（`git log` 那类命令读出来的提交信息），**不是路径，也不是错误信息**。git 的错误信息走的是另一套本地化机制。**所以不要指望 `i18n.logOutputEncoding` 能修路径编码问题**，它在这个问题上帮不上忙。

**【没有查到可靠出处】** 官方文档里没有一段专门写「Windows 上解析 git 输出的程序应该怎么设置编码」的说明。我实测到的 UTF-8 行为是本机 git 2.49.0.windows.1 的表现；更老的 Git for Windows 版本在中文区域设置下的错误信息编码，我没有找到可靠依据，不做断言。

### 3.3 `core.quotepath` 会把路径变成 ASCII

**【文档】** `core.quotePath` 的官方定义是：

> Commands that output paths (e.g. 'ls-files', 'diff'), will quote "unusual" characters in the pathname by enclosing the pathname in double-quotes and escaping those characters with backslashes in the same way C escapes control characters (e.g. `\t` for TAB, `\n` for LF, `\\` for backslash) or bytes with values larger than 0x80 (e.g. octal `\302\265` for "micro" in UTF-8). If this variable is set to false, bytes higher than 0x80 are not considered "unusual" any more. Double-quotes, backslash and control characters are always escaped regardless of the setting of this variable. **A simple space character is not considered "unusual".** Many commands can output pathnames completely verbatim using the `-z` option. **The default value is true.**

**默认值是 `true`，也就是说默认状态下中文路径会被转义。** **【实测】** 逐字节确认，把 `core.quotepath` 设成 `true` 之后，`status --porcelain=v2`（不带 `-z`）的整段输出**全部是 ASCII**，一个大于 `0x7F` 的字节都没有，中文变成了 `new-\346\226\260\345\220\215\345\255\227.txt` 并被双引号包住。

这影响的不只是 `git status`：**【实测】** `git diff --raw`、`git diff --name-status`、`git status --porcelain`（v1）、`git status --porcelain=v2`，只要不带 `-z`，全部会受 `core.quotepath` 影响。

**空格本身不转义。** 【文档】明确写了 "A simple space character is not considered "unusual"." 【实测】印证了这一点：路径 `未跟踪 文件.txt` 里的空格原样保留，只有中文被转义。所以不能用「路径里有空格就一定被引号包住」来反推是否需要处理引号。

**规避办法只有一个：加 `-z`。** **【文档】** git-status 文档的「Pathname Format Notes and -z」一节：「When the `-z` option is given, pathnames are printed as is and without any quoting and lines are terminated with a _NUL_ (ASCII 0x00) byte.」**【实测】**在 `core.quotepath=true` 的情况下加 `-z`，`?? 未跟踪 文件.txt<NUL>` 原样输出，不加引号不转义。**所有会输出路径的命令都必须带 `-z`，这不是可选项。**

### 3.4 `i18n.logOutputEncoding` 对本方案没用

见 3.2。这个配置只影响提交信息在 `git log` 等命令里的输出编码。本方案用 `%aI` 拿日期、用 `%s` 拿标题，如果用户配了 `i18n.logOutputEncoding=GBK`，提交信息就会以 GBK 输出。**规避办法：显式加 `-c i18n.logOutputEncoding=UTF-8`。** 这条属于「锦上添花」，不加也不会导致解析失败（因为 `%x00` 分隔不依赖编码），但会导致中文提交标题乱码。

## 四、`--porcelain=v2` 逐字格式规范

**【文档】** 以下全部照抄 https://git-scm.com/docs/git-status 的 Porcelain Format Version 2 一节。

v2 相比 v1 的两点保证（原文）：

> Version 1 porcelain format is similar to the short format, but is guaranteed not to change in a backwards-incompatible way between Git versions or based on user configuration. This makes it ideal for parsing by scripts. The description of the short format above also describes the porcelain format, with a few exceptions: 1. The user's `color.status` configuration is not respected; color will always be off. 2. The user's `status.relativePaths` configuration is not respected; paths shown will always be relative to the repository root.

注意这段话写在 **v1** 那一节。**v2 的路径相对性有另一个坑，见第七节第 2 条。**

`1` / `2` / `u` 三种记录和 `?` / `!` 两种简单条目的完整定义见 2.3 节。另外：

> Header lines start with `#` and are added in response to specific command line arguments. **Parsers should ignore headers they don't recognize.**

这条很重要：将来 git 可能加新的头部行，解析器必须能跳过不认识的 `#` 开头的行。`--show-stash` 会多一行 `# stash <N>`，同样的处理方式。

## 五、版本差异

| 能力 | 引入版本 | 依据 | 旧版本上的表现 |
|---|---|---|---|
| `git status --porcelain=v2` | **2.11** | 【文档】v2.11.0 标签的 `Documentation/git-status.txt` 里已经有 `--porcelain[=<version>]` 和 "Porcelain Format Version 2" 整节；v2.10.0 标签的同一文件里 `--porcelain` 不接受版本参数，也没有 Version 2 一节 | 2.10 及更早会报未知选项 |
| `git worktree list --porcelain` | 2.7 左右【没有查到可靠出处】 | 2.20.0 标签的 git-worktree 文档 SYNOPSIS 里已有 `'git worktree list' [--porcelain]` | — |
| `worktree list --porcelain` 里的 `locked` / `prunable` 记录 | **2.31** | 【文档】2.31 发布说明原文：「`git worktree list` now annotates worktrees as prunable, shows locked and prunable attributes in --porcelain mode, and gained a --verbose option.」 | **2.20 到 2.30 上这两条记录根本不会出现**，被锁的工作树看不出来 |
| `git rev-parse --path-format=absolute\|relative` | **2.31** | 【文档】2.31 发布说明原文：「"git rev-parse" can be explicitly told to give output as absolute or relative path with the `--path-format=(absolute|relative)` option.」 | 2.30 及更早报未知选项 |
| `git branch --show-current` | **【没有查到可靠出处】** | 我没有查到可靠的官方发布说明来确认版本号 | 建议不依赖它 |
| `%(worktreepath)` 字段 | **【没有查到可靠出处】** | 2.31 发布说明里没有提到它，我也没找到其他可靠出处 | 建议不依赖它 |
| `git worktree list --porcelain -z` | **【没有查到可靠出处】** | 当前 master 文档里有这个选项，2.20.0 标签的文档里没有，但我没有逐个版本核对中间是哪一版加的 | 2.20 上没有 `-z` |
| `git branch -z` | **不存在** | 【实测】在 git 2.49.0 上运行 `git branch -z` 得到 `error: unknown switch 'z'`，用法摘要里也没有 `-z` | 不需要考虑 |

### 2.20 / 2.30 / 2.40 三个版本上会坏的地方

票 #811 点名要查这三个版本。结论是：**2.20 缺两样东西，2.30 和 2.40 都不缺。**

- **2.20 缺 `locked` / `prunable` 工作树标记。** 依据是上面那条 2.31 发布说明，以及 2.20.0 标签的 git-worktree 文档 Porcelain Format 一节给出的完整示例里只有 `worktree`、`bare`、`HEAD`、`branch`、`detached` 五种属性，没有 `locked` 和 `prunable`【文档】。票 #811 要求「哪些被别的路径占用、哪些被 lock」，这在 2.20 上**做不到**，只能降级成「不知道」。
- **2.20 缺 `rev-parse --path-format`。** 依据同上，是 2.31 才加的。规避办法是用 2.20 就有的 `--absolute-git-dir`，或者自己把 `--git-dir` 的返回值和 `--show-toplevel` 拼起来。
- **2.20 缺 `worktree list -z`。** 规避办法是解析不带 `-z` 的输出，并接受「锁的原因里如果有换行会被转义并加引号」这个已知限制。
- **2.30 缺上面三项里的两项**（`--path-format` 和 `locked`），因为它们都是 2.31 才加的。
- **2.40 齐全。**

**`--porcelain=v2` 的格式本身从 2.11 到 2.49 没有变过。**【文档】v2.11.0 标签的文档与当前 master 文档逐条比对，`1` / `2` / `u` 三种记录的字段、`<sep>` 随 `-z` 变、`<XY>` 用 `.` 表示未变这几条描述完全一致。git-status 文档页面的版本历史里，2.12.5、2.13.7、2.16.6、2.17.0、2.18.0、2.19.0、2.21.0、2.22.0、2.24.0、2.30.1、2.31.0、2.34.0、2.35.0、2.39.0、2.40.0、2.43.0、2.44.0、2.45.0、2.53.0 各版本之间，porcelain 相关描述没有出现过不兼容改动。

**`branch.ab` 行和 `branch.upstream` 行从 2.11 起就是现在这个形状**，上面那两处标签文档可以印证。

## 六、不能依赖全局配置

**好消息：管道场景下大部分配置不咬人。** **【实测】** 我在一个非交互的子进程里（标准输出是管道，不是终端）逐项试了：

| 配置 | 实测结果 |
|---|---|
| `core.pager=cat` 加环境变量 `GIT_PAGER=cat` | `status --porcelain=v2` 输出不受影响，仍是 3 行可解析内容 |
| `color.status=always` 和 `color.ui=always` | 输出里没有 ESC（`0x1B`）字节，颜色被自动关掉了 |
| `alias.st=!echo PWNED` 和 `alias.log=!echo PWNED2` | 没有输出 PWNED，别名没能顶替内置命令 |

别名顶不掉内置命令这一点是 git 的设计：内置命令名优先。所以**不要指望用户的 `~/.gitconfig` 里的别名能劫持 `git status`**。

**坏消息：这些配置真的会咬人，即使在管道里。**

| 配置 | 会不会影响输出 | 规避办法 |
|---|---|---|
| `core.quotepath` | **会**，且默认就是 `true` | 加 `-z`（必备），再加 `-c core.quotepath=false`（双保险） |
| `status.showUntrackedFiles` | **会**，能把未跟踪条目整个关掉 | 显式写 `--untracked-files=all` |
| `status.relativePaths` | **会**，能让 v2 非 `-z` 输出的路径变成相对当前目录 | 显式写 `-c status.relativePaths=false`，或者干脆只用 `-z` |
| `diff.renames` | **会**，能改变重命名识别 | `git status` 显式写 `--no-renames`；`git diff` 显式写 `--no-renames` |
| `diff.external` | **会**，能塞进一个外部程序接管 diff 输出 | 显式写 `--no-ext-diff` |
| `diff.mnemonicPrefix` | **会**，能把 `a/` `b/` 前缀换掉 | 显式写 `--src-prefix=` `--dst-prefix=` 或 `--no-prefix` |
| `core.abbrev` | **会**，能改变短哈希的长度 | 只用 `%H` 全长哈希，不用 `%h` |
| `log.date` | **会**，能改变 `%ad` / `%cd` 的格式 | 显式写 `--date=iso-strict`，或者直接用 `%aI` / `%cI` |
| `color.ui` / `color.*` | 管道下不会，但显式关掉更保险 | `-c color.ui=false` |
| `core.pager` / `pager.*` | 管道下不会 | 无需处理，但加 `-c core.pager=cat` 更保险 |
| `alias.*` | 不会顶替内置命令 | 无需处理 |
| `i18n.logOutputEncoding` | **会**，影响提交信息的编码 | `-c i18n.logOutputEncoding=UTF-8` |
| `core.autocrlf` | **会影响 diff 的内容**（换行符在仓库里是 LF、在工作区可能是 CRLF），但不影响 `--raw` / `--name-status` 的**结构** | 只解析结构不解析内容时无需处理；要显示内容就要考虑 |
| `safe.directory` | **会**，在某些环境下报「dubious ownership」直接拒绝访问 | 见下 |

**【实测】** `status.relativePaths` 确实能改变 v2 的输出：在一个子目录里运行 `git -c status.relativePaths=false status --porcelain=v2`，路径从 `../new-新名字.txt` 变成了 `new-新名字.txt`。

**【没有查到可靠出处】** 我没有亲自构造出 `safe.directory` 触发的「dubious ownership」报错，所以那条错误文本我不写。已知的是：在不属于任何仓库的目录里运行，报错是 `fatal: not a git repository (or any of the parent directories): .git`，退出码 128【实测】。

**这台开发机的实际全局配置（`git config --list --show-origin --show-scope`）**，可以作为「用户会改成什么样」的样本【实测】：系统级 `C:/Program Files/Git/etc/gitconfig` 里有 `core.autocrlf=true`；用户级 `C:/Users/…/.gitconfig` 里有 `core.autocrlf=false`、`core.quotepath=false`、`core.longpaths=true`、八条 `safe.directory`，以及 `credential.https://github.com.helper=!'D:\0Tools\GitHubCLI\gh.exe' auth git-credential`。**用户确实把 `core.quotepath` 改成了 `false`**，也就是说如果只在这台机器上测，很容易误以为转义不是问题。

## 七、给实现的关键提醒

### 1. 永远用 `-C <工作区根目录>` 指定目录，不要靠切换进程当前目录

这是全篇最重要的一条，同时直接对应票 #811 里「不能 worktree 错误切换」的硬要求。

**不要用 `process.chdir()` 再跑 git。** 理由有两个，都实测过：

- `status --porcelain=v2` 不带 `-z` 时，输出的路径是**相对当前目录**的，不是相对仓库根的。**【实测】** 在子目录 `子目录 test` 里运行不带 `-z` 的 v2，输出是 `../new-新名字.txt`；加上 `-z` 之后同一命令输出的是根相对的 `new-新名字.txt`。而 v1（`--porcelain`）不管带不带 `-z` 都是根相对的。**三种写法给出三种结果，这是逐字匹配时必炸的地方。**
- **`process.chdir()` 会让并发调用互相踩。** 面板上同时刷两个工作树的状态时，一个调用改了全局当前目录，另一个调用的路径解析就错了。

**做法：先用 `rev-parse --show-toplevel` 拿到根（一次），之后每条命令都带 `-C <根>`。** 这样既让输出稳定地根相对，又不碰进程状态，还天然避免了 worktree 串台。

### 2. 所有输出路径的命令一律加 `-z`

`core.quotepath` 默认是 `true`【文档】,会把中文路径变成 `"\346\226\260..."`。加 `-z` 之后完全不需要处理引号和转义。**没有例外**：`status --porcelain=v2`、`diff --raw`、`diff --name-status`、`diff --numstat`、`worktree list --porcelain` 全部要加。

同时记住 `-z` 会改两处字段分隔：重命名记录的「原路径」从 TAB 变 NUL，路径各自以 NUL 结尾。`--numstat -z` 还有一个尾随 TAB。

### 3. 判断分支和游离头指针只能用两种方式，别用 `rev-parse --abbrev-ref HEAD`

`--abbrev-ref HEAD` 在三种状态下给出三种误导性结果：游离时返回字面量 `HEAD`；仓库无提交时先往标准输出打 `HEAD` 再报错退出 128；正常时返回分支名。

**正确做法二选一：**

- 从已经要跑的 `status --porcelain=v2 --branch -z` 里读 `# branch.head` 那一行，值等于 `(detached)` 就是游离头指针。**推荐这个**，因为这条命令本来就要跑，不用多开一个进程。
- 或者用 `symbolic-ref --short -q HEAD`：正常和 unborn 都退出 0 并给出分支名，游离时退出 1 且完全无输出【实测】。`branch --show-current` 也行（游离时返回空字符串、退出码仍是 0），但我没查到它在哪一版引入的。

**判断「哪个工作树是当前的」用分支名去比对 `worktree list --porcelain` 里的 `branch refs/heads/<名字>`，不要拿路径去比对。** 路径有大小写和斜杠的坑，分支名没有。

### 4. 把「上游没了」和「没有上游」当成两种不同状态

`for-each-ref` 的 `%(upstream:track)` 会在上游被删时给出 `[gone]`【实测】。如果代码只判断「非空就是有上游」，就会把一个坏掉的跟踪关系显示成正常。`status --porcelain=v2 --branch` 的 `# branch.upstream` 和 `# branch.ab` 在上游缺失时**整行不出现**，不会报错；而 `rev-list --left-right --count` 在上游缺失时会退出 128 报 `fatal: ambiguous argument …`。

**所以领先落后数优先读 `# branch.ab`，不要单独跑 `rev-list --count`。**

### 5. 冲突状态下同一个路径会出现多次，不要去重

**【实测】** `diff --raw` 和 `diff --name-status` 在一个文件冲突时都会对该路径输出两行（先 `U` 后 `M`）。`status --porcelain=v2` 则是每个路径一条 `u` 记录。

另外 `status --porcelain=v2` 的三种已跟踪记录**输出顺序是不保证的**【文档】，解析必须按行首字符（`1` / `2` / `u` / `?` / `!` / `#`）分派。

### 6. 遇到 2.20 到 2.30 的 git，要能优雅降级

票 #811 明确说用户的 git 版本会浮动。2.20 到 2.30 上：

- `worktree list --porcelain` 不给 `locked` 和 `prunable` 记录，**「哪些工作树被锁了」这个问题在 2.20 上无法回答**。UI 上要显示成「未知」而不是「都没锁」。
- `rev-parse --path-format` 不存在，用 `--absolute-git-dir` 代替。
- `worktree list --porcelain -z` 不存在，退回不带 `-z` 的解析，并接受锁原因里的换行会被转义。

建议在面板打开时跑一次 `git --version`，把版本号记下来，超过 2.30 就走完整路径，2.11 到 2.30 之间走降级路径，低于 2.11 直接提示用户升级（因为 `--porcelain=v2` 都没有）。

## 八、出处清单

官方文档：

- git-status：https://git-scm.com/docs/git-status （`--porcelain=v2` 的完整格式规范、`-z` 行为、分支头部行、XY 状态码表）
- git-worktree：https://git-scm.com/docs/git-worktree 以及源码仓库里的 https://raw.githubusercontent.com/git/git/master/Documentation/git-worktree.adoc （工作树列表的 porcelain 格式、`locked` 记录与原因、为什么附加工作树的 `$GIT_DIR` 是绝对路径）
- git-config 的 `core.quotePath`：https://raw.githubusercontent.com/git/git/master/Documentation/config/core.adoc （转义规则与默认值 `true`）
- git-config 的 `i18n.logOutputEncoding`：https://raw.githubusercontent.com/git/git/master/Documentation/config/i18n.adoc （只管提交信息）
- Git 2.11 发布说明：https://raw.githubusercontent.com/git/git/master/Documentation/RelNotes/2.11.0.adoc
- Git 2.31 发布说明：https://raw.githubusercontent.com/git/git/master/Documentation/RelNotes/2.31.0.adoc （`--path-format` 与 worktree 的 `locked` / `prunable` 都在这里引入）
- 2.20.0 标签的 git-worktree 文档：https://raw.githubusercontent.com/git/git/v2.20.0/Documentation/git-worktree.txt （确认 2.20 的 porcelain 格式里没有 `locked` / `prunable`）
- 2.10.0 与 2.11.0 标签的 git-status 文档：https://raw.githubusercontent.com/git/git/v2.10.0/Documentation/git-status.txt 与 https://raw.githubusercontent.com/git/git/v2.11.0/Documentation/git-status.txt （确认 `--porcelain=v2` 是 2.11 引入的，且字段定义此后未变）

实测环境：Windows 11、git 2.49.0.windows.1、PowerShell 7.6.6。一次性测试仓库建在 `D:\Temp\gitprobe-aae092904e2148c4b39ac7fd0028984e\`，内含中文文件名 `新增文件-中文名.txt` / `文档-改名.md` / `new-新名字.txt` / `未跟踪 文件.txt`、中文且带空格的目录名 `主仓库 with space`、一个附加工作树 `Linked-WorkTree`（已锁定）、一个远端跟踪关系、一个合并冲突仓库、一个还没有提交的仓库、一个游离头指针仓库。所有实测实验都在这个临时目录里进行。**但调研过程中曾因命令落点错误，在用户工作区造成过两处误伤并已修复：覆盖过受版本管理的 `.gitignore`（已从 HEAD 读回写回，经核对与 HEAD 内容一致），以及误建过分支 `no-upstream-branch` 并写过两条分支配置（已用 `git branch -d` 删除并移除配置段）。修复后核对：受管文件改动为 0，分支与工作树列表回到原状；但 `.gitignore` 被覆盖前是否存在未提交的本地修改无法证明，待用户确认。**
