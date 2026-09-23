# 研究：插件宿主能不能自己把 GitHub CLI（gh）装到用户机器上（#700）

调查票 #700 的安装半边。维护者原话：「我们是否插件可以做到直接帮用户把 GH CLI 给安装好并且帮助用户配置好吗？我不确定可以做到，也不知道怎么做到。」本报告只回答「装」这一半；「登录与配置」是另一张票的事，这里只在两者交界处画一条线，不往下查。

**一句话结论：这台机器上的插件确实能把安装程序起起来并拿到退出码，但只有三步里的一步半是插件自己能走完的——把安装包下载下来、把不需要管理员权限的那条安装路（Windows 的 winget 用户范围、macOS 的 Homebrew、Linux 的官方压缩包解到用户目录）跑完可以由插件独自完成；凡是要管理员权限的安装方式（Windows 的机器范围安装包、Linux 的 apt/dnf/pacman、Homebrew 装到 /usr/local），都会在权限那一步停下来等人点一下，插件没有任何办法替你点；而「装完立刻就能用」这件事故障率最高：已经开着的 DSH 进程拿不到新装的 gh，必然出现「插件装好了，插件自己还是看不见」这个结果。**

下面按票面给的五个子问题各占一节，最后是证据索引与「还没确定的事」。

---

## 1 插件宿主起一个外部程序，到底能干哪些事

### 1.1 方法表

插件拿到的子进程能力是 `ctx.get('subprocess')`（本仓库 `src/host/index.js:29` 就是这么取的），它的实现是 DSH 的本地提供方 `@deepseek-ai/dsh-subprocess-local`。可以调用的方法有三个：

| 方法 | 作用 | 证据 |
|---|---|---|
| `resolveExecutable(名字[, 环境])` | 把 `gh` 这种裸名字按 PATH 解析成绝对路径；解析不到就抛错 | `dsh-subprocess-local/lib/index.js:966-984` |
| `spawn(请求)` | 起一个普通子进程，同步返回一个句柄；句柄上有 `done`（等退出事实）、`terminate()`（终止整棵进程树）、`waitForExit()`、`collected`（收集到的输出） | `dsh-subprocess-local/lib/index.js:990-1006`；`dsh-subprocess/README.zh.md` 第 41 行 |
| `spawnTerminal(请求)` | 起一个挂在真实终端（伪终端）上的会话，可以往里写字符、读输出、给前台进程组发信号 | `dsh-subprocess-local/lib/index.js:1028-1074`；`dsh-subprocess/README.zh.md` 第 69 行 |

本机实测（第 1.6 节那段探针）打印出 `typeof subprocess.spawnTerminal = function`，说明终端原语在这台机器上确实存在。

### 1.2 spawn 的每个参数是什么意思

请求对象的字段都在 `targetEnvironment()`、`validateSubprocessSpec()` 与 `bindManagedProcess()` 里被读：

| 字段 | 含义 | 证据 |
|---|---|---|
| `argv` | 程序加参数的数组，第一项是程序名；**不经过任何 shell 解释**，参数里有空格、引号也不会被拆开 | `dsh-subprocess/README.zh.md` 第 107 行；`dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:891-892` |
| `cwd` | 子进程的工作目录；为空时本仓库一律补上 `DEFAULT_CWD` | `src/host/repoKeys.js:48`、`:107` |
| `env` | 本次调用额外带的（或覆盖的）环境变量；不传就是「清理后的父环境」 | `runner-launch-COYGu0Dl.js:1618-1628` |
| `stdio` | 三条流各自的处置方式：`'ignore'`（不接）、`'pipe'`（原始管道，调用方自己读）、`'inherit'`（直接接父进程）、或 `{ maxBytes, spill? }`（有界收集一段尾部，还可以另存完整输出文件） | `dsh-subprocess/README.zh.md` 第 55-61 行；`dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:970-986` |
| `graceMs` | 终止宽限期，必须是正的有限数；先按正常流程终止，宽限到了再强杀 | `runner-launch-COYGu0Dl.js:883`；`dsh-subprocess-local/README.zh.md` 第 12 行 |
| `signal` | 取消信号；调用前就已取消会直接抛出「aborted before spawn」不启动 | `runner-launch-COYGu0Dl.js:884-890` |

`spawnTerminal` 的请求多两个字段：`rows` 与 `cols`，就是终端窗口的行列数（`runner-launch-COYGu0Dl.js` 的 `spawnTerminal` 把它们直接交给 node-pty 的 `options.rows/cols`）。

一个要点：**服务本身没有「死线」（超时）这个概念。** 时限归调用方所有——仓库里所有调用都是拿 `timer.timeout(...)` 和 `handle.done` 赛跑，谁先到就终止（`src/host/repoKeys.js:56-62`）。所以「插件跑安装程序跑到一半挂住」这件事，要靠插件自己设时限，服务不会兜。

### 1.3 一次调用可以带自己算出来的环境变量

**可以，而且是官方设计里的一条正常通道。** 服务文档原文：子进程环境会「先移除环境中的凭据与 `DSH_*` 值，再应用显式覆盖」（`dsh-subprocess/README.zh.md` 第 12 行、第 73 行）。具体三步：

1. 先取清理过的父环境 `scrubbedParentEnv()`——把形似凭据的名字（正则 `KEY|PASSWORD|SECRET|TOKEN`，`dsh-subprocess/lib/index.js:32`）与全部 `DSH_` 开头的名字删掉（同文件第 50-56 行）；`PATH`、`HOME`、本地化变量、代理变量都保留下来。
2. 再把请求里显式给的 `env` 合并上去，同名覆盖（`runner-launch-COYGu0Dl.js:649-662`）。
3. 显式给 `undefined` 表示「删掉这个变量」（`runner-launch-COYGu0Dl.js:1623`）。

本机实测（第 1.6 节）：调用处显式传 `env: { DSH_GH_PATH: ..., FOO: ... }` 时，子进程里两个名字**都看得见**（`{"DSH_GH_PATH":"explicit-value","FOO":"kept"}`）。所以「调用方故意转发的环境变量不会被清理掉，反而活得更久」这条是成立的。

这一条已经在产品里被用上了：DSH 桌面端自己的 pnpm 服务就是用同一个 `subprocess.spawn`，并显式传了一整包环境（`PATH`、`NODE`、`ELECTRON_RUN_AS_NODE`、`DSH_HOME` 等，见 `D:\0Tools\DSH Desktop\resources\app\lib\pnpm.js:108-129`）。

### 1.4 可以喂交互输入，也可以挂伪终端

- **喂输入**：`stdio.stdin` 只要不是 `'ignore'`，底层就拿一条管道接住，句柄的 `stdin` 是一条可写流（`runner-launch-COYGu0Dl.js:1140-1141`、`:1496`）。**但有两条限制**：一是 DSH 的普通 `spawn` 只给「管道」，不给控制终端，程序如果非要问终端要密码（不带 `-S` 的 `sudo` 就是这样），管道救不了它；二是普通 `spawn` 的调用方要自己写、自己读，仓库里目前所有调用都写了 `stdin: 'ignore'`，没有任何一处写过字符进去。
- **挂伪终端**：可以，走 `spawnTerminal`（`dsh-subprocess-local/lib/index.js:1028-1074`）。它用的是本项目真装在依赖里的 `node-pty`（同文件第 5 行 `import * as nodePty from "node-pty"`），分配的是一块真的终端，能写字符、能读输出、能查前台进程组。文档把它描述为「对于交互式程序……分配真实 PTY」（`dsh-subprocess/README.zh.md` 第 69 行）。

### 1.5 提权：Windows 弹的框插件答不了，Linux 的密码有办法，但都要人

**先说 Windows。** DSH 起的普通子进程一律是「当前用户令牌」创建的，没有任何提权位：`dsh-subprocess-local` 在 Windows 上走的是 `CreateProcessW`，调用处传的令牌是 `null`（意思是用当前进程自己的身份），创建标志只有 `1028`（`CREATE_UNICODE_ENVIRONMENT`，只为把环境块按 Unicode 传过去），没有 `CREATE_NEW_CONSOLE`、没有 `runas`、没有提权相关标志（`dsh-win32-process/lib/index.js:614-617`）。

这带来一个很干脆的后果：**如果安装程序要求管理员权限，`CreateProcessW` 这个调用根本不会走通，它会当场返回 740（ERROR_ELEVATION_REQUIRED，「The requested operation requires elevation.」，见微软系统错误码 500-999 的第 740 条），而不是弹一个框等人。** DSH 把这个错误码映射成 `EACCES`（`dsh-subprocess-local/lib/runner.js:19-26` 与第 36-42 行），于是插件拿到的是一个「拒绝访问」的失败，不是卡住的等待。

那如果插件绕开 `spawn`、去找系统帮你提权呢？Windows 的登录管理员批准框（UAC）由一个独立的安全桌面进程弹出来，只有坐在机器前的人能按。**DSH 子进程服务里没有任何一处能构造它、没有一处能读它的结果**——`spawn` 的世界里只有 argv、cwd、env、stdio、graceMs、signal 六样东西。所以「插件帮用户点掉 UAC」在结构上就不存在；能做的是「插件把需要提权的那一步做成一句看得懂的话，交给用户自己跑」。

**再说 Linux 的 sudo。** sudo 要密码时默认直接读终端，不接受管道——所以普通 `spawn` 喂不进去。但有两件事让它比 Windows 好办：

1. `spawnTerminal` 给的是真终端，sudo 可以直接在它里面问密码；`sudo -S`（从标准输入读密码）配合管道也是一条路。也就是说**通道存在**；
2. 但密码还是只有人知道。插件最多是开一个终端把 sudo 跑起来、让用户在终端里敲；它没法「知道密码并代填」——那样做等于让插件持有一个它不该有的秘密。

还有一层现实差别：**sudo 会在一段时间内记住这次授权**，期间同一终端里的后续 sudo 不再问密码。所以 Linux 上「一次点击之后插件把剩下的活干完」在原理上是可能的，而 Windows 上不行。

### 1.6 本机实测（一段可以在 30 秒内复验的探针）

我在这台机器上用本机真装的 `@deepseek-ai/dsh-subprocess-local`（profile 里那份，与桌面端 `resources/app/node_modules` 下的那份**三个文件逐字节相同**：`index.js`、`runner.js`、`runner-launch-COYGu0Dl.js` 的 SHA256 一致）直接构造了服务对象，跑了一次探针，只读、只起子进程、不写任何被测文件，跑完已删除。结果逐字如下：

```
A1 resolveExecutable(gh) 不给 env = D:\0Tools\GitHubCLI\gh.EXE
A2 resolveExecutable(gh, PATH 补上 GitHub CLI) = D:\0Tools\GitHubCLI\gh.EXE
A3 spawn(gh --version, 显式 env) exitCode = 0
A3 输出首行 = gh version 2.97.0 (2026-07-31)
A4 显式 env 里的 DSH_GH_PATH / FOO 到子进程 = {"DSH_GH_PATH":"explicit-value","FOO":"kept"} (exitCode=0)
A5 typeof spawnTerminal = function
```

读这段输出的四个要点：

- **A2、A3 是核心对照**：给 `env` 里补上 `C:\Program Files\GitHub CLI`，`resolveExecutable` 会去那儿找；`spawn` 带 `env` 起 `gh --version` 拿到退出码 0 与真实版本号。**「按本次调用临时给一条 PATH」这条路在本机是通的。**
- **A4 纠正一个直观上的误解**：`DSH_` 开头的名字是被「清理父环境」那一步删掉的，但调用处**显式**给的值在这之后才合并，所以照样到得了子进程。
- **A5**：终端原语存在。
- 注意 A1 也返回了一个 gh——那是这台机器另一处自己装的 gh，不是我们要研究的目标；A1 想说明的是「不给 env 时用的是父进程那份 PATH」，这一点由第 1.3 节的代码与第 4 节的环境快照事实共同支撑。

---

## 2 这个仓库已经在起哪些外部程序、怎么起的

仓库里所有起外部程序的地方（用 `subprocess.spawn` 的都算）如下表。**共同点有三条：走的都是同一个服务、`cwd` 都会补上默认目录、并且没有任何一处传过 `env`。**

| 地方 | 起什么 | 参数怎么给 | `cwd` | `stdio` |
|---|---|---|---|---|
| `src/host/repoKeys.js:28` | `gh --version`（探测 gh 在不在） | `argv: ['gh', '--version']` | `DEFAULT_CWD` | `stdin` 忽略、标准输出与错误各留 1024 字节 |
| `src/host/repoKeys.js:46-51` | gh 的正式调用（`runGh`） | `argv: [解析出的 gh 路径].concat(参数)` | 调用方给的工作区目录，缺省 `DEFAULT_CWD` | `stdin` 忽略、标准输出 4MB、错误 256KB |
| `src/host/repoKeys.js:105-110` | 通用外部程序（`execProc`，实际用于 `git rev-parse`、`git remote get-url` 等） | `argv: [git 绝对路径, '-C', 目录, ...]` | 同上 | `stdin` 忽略、标准输出 1MB、错误 256KB |
| `src/host/platformChannel.js:190-195` | 环境检查链与后端操作要用到的外部命令（`detectionExec`，gh / glab 等） | `argv: [命令名, ...参数]` | 调用方给的目录，缺省 `DEFAULT_CWD` | `stdin` 忽略、标准输出 4MB、错误 256KB |
| `src/host/platform/index.js:138` | 打开本机可见的目录或文件（Windows 上是 `cmd` 跑 `start`，macOS/Linux 是 `open`/`xdg-open`） | 由各系统底座给的配方拼 | 目标所在的目录 | `stdin` 忽略、标准输出与错误各 64KB |
| `src/host/updateStore.js:282-287` | 插件给自己升级时，起一个安装进程 | `argv: [当前运行时, ...运行时参数, CLI 的 JS 入口, 'plugin', '--profile', 使用范围名, 'add', '--save-exact', '包名@版本', '--registry=...']` | 插件所在的使用范围目录 | `stdin` 忽略、标准输出与错误各 64KB |

两处要单独说清楚：

- **不同给 `env` 的后果**：因为没人传 `env`，这些子进程拿到的 PATH 永远是「DSH 宿主进程启动时那份 PATH 清理过之后的样子」。这是第 4 节那个故障的机制来源。
- **自我升级那条路有两条分支**（`src/host/updateStore.js:294-300` 的注释写得很清楚）：桌面端走桌面服务 `desktopPnpm.runPlugin(参数数组, 使用范围目录)`（同文件第 255-269 行），普通命令行环境才自己起进程（同文件第 273-292 行）。桌面服务那一侧我也看了实现：它同样是把参数交给 `subprocess.spawn`，并且显式带上一包环境（`D:\0Tools\DSH Desktop\resources\app\lib\pnpm.js:87-102`、`:108-129`），`stdio` 是 `stdin: 'ignore'` 加两条管道。**这条路的成功先例值得记下来：插件已经很熟练地做完了一件「起外部程序来改本机安装」的事**，只不过改的是它自己的安装，而且全程不需要管理员权限（它写的是用户家目录下的使用范围）。
- 源码里另有一份同样逻辑的副本 `src/host/updatePkg/store.js:300-318`（同为 `dsh-plugin-update` 时留下的双份实现），写法与上面一致，不再重复列举。

**一个对照事实**：仓库里今天已经写着「按操作系统给安装命令」的提示词——`src/host/publishFlow.js:36` 与 `src/host/tracker/backends/github/init-project.js:84` 里都是同一套话术（Windows → `winget install --id GitHub.cli`；macOS → `brew install gh`；Linux → `sudo apt install gh`），GitLab 后端对着 glab 也有一份同样的（`src/host/tracker/backends/gitlab/index.js:131-132`）。也就是说，**今天产品的做法是「把命令写给用户，让用户自己敲」**，这份研究要回答的正是「能不能不要用户敲」。

---

## 3 gh 的官方安装渠道，以及每条渠道有多「无人值守」

### 3.1 Windows

| 渠道 | 要不要管理员权限 | 能不能全程无声、无提示 | 装到哪个目录 | 新 PATH 什么时候生效 |
|---|---|---|---|---|
| **winget**（官方推荐，`winget install --id GitHub.cli --source winget`） | 看包：gh 的目录里只有机器范围的安装包（清单里三个架构的安装包都写着 `Scope: machine`），所以实际会走需要提权的那条 | 可以做到「不弹安装界面」：winget 有 `--silent`（官方说明是「Runs the installer in silent mode. This suppresses all UI.」），另有 `--accept-package-agreements`、`--accept-source-agreements` 专门把许可确认的提问压掉 | 清单声明的默认位置是 `%ProgramFiles%/GitHub CLI`（32 位机上是 `%ProgramFiles(x86)%` 下的同名目录） | 官方安装页原话：「The Windows installer modifies your PATH. When using Windows Terminal, you will need to **open a new window** for the changes to take effect.（仅仅开一个新标签页不够。）」 |
| **官方 MSI 安装包**（`gh_x.y.z_windows_amd64.msi`） | 要。清单把它标成 `Scope: machine`，是装给整台机器的 | 可以：这是标准 Windows 安装包，用 `msiexec /i 包 /qn` 这类参数就没有界面。但**前提是你已经拿到了管理员权限** | 同上，`%ProgramFiles%\GitHub CLI`（本报告开头引的缺陷票 #427 里，用户用 winget 装完，gh.exe 也正落在 `C:\Program Files\GitHub CLI\gh.exe`） | 同上：写进 PATH 之后，已经在跑的进程（包括资源管理器启动的 DSH）读不到 |
| **Chocolatey**（`choco install gh`，社区维护，官方页标为「Community (Unofficial)」） | 要。Chocolatey 自己的安装与绝大多数包都要求管理员权限的终端 | 命令本身不弹包安装界面，但拿不到管理员权限就装不了 | 由包脚本决定，走 Chocolatey 自己的 `bin` 垫片目录 | 同 Windows 的通用规则 |
| **Scoop**（`scoop install gh`，社区维护，官方页标为「Community (Unofficial)」） | **不要**——这是 Windows 上少见的「不碰系统目录」的路子 | 可以，全程用户目录内 | Scoop 自己的用户目录（默认在家目录下的 `scoop` 里） | Scoop 的做法是把安装目录放进当前用户自己的 PATH，新开的进程就能用 |

这一节里对「不需要管理员权限」这条要补一句现实提醒：**Scoop 本身得先装上**，而新机器上通常没有它；也就是说，走 Scoop 这条不需要提权的路，先要解决「怎么装 Scoop」。

### 3.2 macOS

| 渠道 | 要不要管理员权限 | 能不能全程无声、无提示 | 装到哪个目录 | 新 PATH 什么时候生效 |
|---|---|---|---|---|
| **Homebrew**（`brew install gh`，官方推荐） | **不要**。Homebrew 的基本立场是「拒绝以 sudo 身份工作」（官方 FAQ 原话：Homebrew refuses to work using sudo） | 命令不弹任何需要回答的界面。gh 的配方里带瓶装二进制，装的是预编译好的产物，不需要现场编译 | 默认前缀：Apple 芯片是 `/opt/homebrew`，Intel 是 `/usr/local`；配方把 `gh` 装到 `bin` 下，也就是 `$(brew --prefix)/bin/gh` | Homebrew 用的是**已经存在**于 PATH 里的那个前缀目录，所以「装完这一条就能用」取决于启动 DSH 的那个程序有没有把前缀放进 PATH |
| **官方预编译包**（releases 页的 zip 与 `.pkg`） | zip 解到用户目录不需要；`.pkg` 是系统安装器，要管理员权限 | zip 天然无声；`.pkg` 也能无声 | 解压到哪儿由人决定 | 由人决定，落到哪就配哪 |
| MacPorts / Conda / Spack / Webi 等 | 各不相同 | 各不相同 | 各不相同 | 各不相同 |

**macOS 上有一条与 Windows 同形、容易漏掉的坑，值得写下来**：Homebrew 的官方 FAQ 明写「GUI apps on macOS don't have Homebrew's prefix in their `PATH` by default.」——也就是说，如果 DSH 是从访达（Finder）或程序坞启动的图形程序，它可能**从一开始就没有 Homebrew 的目录在 PATH 里**；这时就算 gh 早就装好了，插件也照样找不到它。这个问题与第 4 节的 Windows 问题不是同一个根，但表现一模一样。

### 3.3 Linux

| 渠道 | 要不要管理员权限 | 能不能全程无声、无提示 | 装到哪个目录 | 新 PATH 什么时候生效 |
|---|---|---|---|---|
| **apt（Debian / Ubuntu，官方推荐）** | 要。官方给出的整段安装命令里，凡是要写系统目录的每一句前面都带 `sudo`（`sudo mkdir -p -m 755 /etc/apt/keyrings`、`sudo tee`、`sudo apt update`、`sudo apt install gh -y`） | 只能做到「不弹 apt 自己的提问」：结尾那句带 `-y`。**但命令开头的 sudo 要密码，这一步没有参数能跳过** | 系统包目录（`/usr/bin/gh` 这一类） | 系统目录本来就在 PATH 里，装完新开的进程就能用 |
| **dnf / yum / zypper（Fedora、RHEL、openSUSE 等，官方推荐）** | 要。官方给的每一条都以 `sudo` 开头（`sudo dnf install gh` 等） | 同 apt：命令本身不提问，但 sudo 要密码 | 系统包目录 | 系统目录本来就在 PATH 里 |
| **pacman（Arch，社区维护）** | 要（`sudo pacman -S github-cli`） | 同 apt | 系统包目录 | 同 apt |
| **官方压缩包（`.tar.gz`）** | **不要**。它是官方发布里唯一一条完全不需要系统权限的路 | 可以，全程无声 | 解到哪个目录由人决定；官方页面上这一步没有指定位置 | 由人选定的目录要不要进 PATH、怎么进，也由人决定；进了之后对新开的进程生效 |
| **官方 `.deb` / `.rpm` 包** | 要（装系统包就是提权操作） | 可以无声，但同样要先有权限 | 系统包目录 | 同 apt |

三条跨系统的话：

1. **「无需提权」的那几条路，装的都是用户范围内的东西**：Windows 的 winget 用户范围与 Scoop、macOS 的 Homebrew、Linux 的官方压缩包。它们的共同代价是「装到哪儿、PATH 怎么配」变成了要自己安排的事。
2. **「无声」和「无人」不是一回事。** winget 的 `--silent` 管的是安装程序那个窗口，apt 的 `-y` 管的是 apt 自己的提问；两者都不管操作系统弹出的那个要人按的授权框。
3. **PATH 的生效时间在四个系统上是一致的规律：写进配置不等于写进正在跑的进程。** Windows 上官方安装页特意叮嘱「要新开一个窗口」；Linux 上因为装进的是本来就在 PATH 里的系统目录，所以这个问题不出现；macOS 取决于启动方式（见 3.2 节最后一段）。

---

## 4 装完之后，已经在跑的 DSH 进程能不能看见这个新装的 gh

### 4.1 本仓库三张缺陷票已经把这个问题查过一遍

我通过 `gh` 命令行把 #427、#428、#429 三张票的正文读了下来（只读，票面没有评论）。三张票记的是同一台全新 Windows 电脑上的两起现象，正好是这一节要问的事：

- **#427**：用户「已经用 winget 安装了 gh（gh.exe 位于 `C:\Program Files\GitHub CLI\gh.exe`，版本 2.98），并且已经把 GitHub CLI 目录写入了用户级 PATH（HKCU\Environment\Path）」，面板却报「未找到命令 gh（可能还没安装）」。票里对根因的初步判断第一条是：「winget 安装 gh 后不修改运行中 shell 的 PATH；用户级 PATH 补丁写进 HKCU\Environment，但由 Explorer 启动的 DSH Desktop 进程环境仍是启动时的快照——而 adapter 的 env 落点就是 process.env（src/host/platform/win32/index.js 的 resolveDeps 默认 process.env），DSH 衍生的所有 gh 子进程都拿不到新 PATH」。
- **#428** 是同一台机器的另一半现象：外部验证全部正常（`gh --version` 是 2.98.0、`gh auth status` 已登录、`git remote get-url origin` 正常、直接读 `.git/config` 正常、`gh repo view` 正常），面板右上角却仍是「未识别仓库」。票里列的四个待复核分叉点，第一个就是「宿主进程实际环境是否含 DSH_GH_PATH（GUI 进程环境是否随用户级环境变量补丁刷新）」。
- **#429** 把这两起现象收成一张待定票，把上面四个分叉点写成诊断计划，等维护者决定要不要做。

**这三张票已经把「环境快照」这条根因写在正文里了，但没有在运行中的宿主进程里实测过。** 下面是我今天补的两段核实。

### 4.2 今天代码里的三层解析，和它读的那份环境

插件判断「gh 在不在」走的是这条链（`src/host/repoKeys.js:17-36` 的 `resolveGh`）：

1. 先看内存里缓存的上一次成功结果；有就返回（`:18`）；
2. 再问平台层 `platform.resolveExecutable('gh')`（`:23`）；
3. 平台层内部**还有三层**（`src/host/platform/index.js:111-129`）：先问 DSH 子进程服务 `subprocess.resolveExecutable(名字)`；这一层失败（返回 null 或抛错）且名字正好是 `gh` 时，读环境变量 `DSH_GH_PATH` 并做一次文件存在性检查（`fs.lstat`），存在就用它；两者都落空返回 null；
4. 平台层也落空时，`resolveGh` 还有最后一道回退：直接起一次 `gh --version`，退出码为 0 且输出里有 `gh version` 才认（`:28-31`）。这条回退同样是「起进程按 PATH 找」，所以不改变结论。

关键在于**这两层读的环境分别来自哪里**：

- `subprocess.resolveExecutable` 不传环境时用清理后的父环境（`dsh-subprocess-local/lib/index.js:966-984`，内部 `childEnv(env)`），也就是 **DSH 宿主进程自己的环境**；
- `DSH_GH_PATH` 这条兜底读的是 `envSource`。它的来源有两个，都指向同一处：适配器测试注入时可以是外部给的对象，否则就是 `process.env`（`src/host/platform/win32/index.js:29-35` 的 `resolveDeps`；通用层 `src/host/platform/index.js:107` 的 `envSource`）。

**所以这两层读到的都是「DSH 宿主进程启动时那份环境」，没有任何一层会去读注册表里刚刚改过的 PATH。** 插件里也**没有**任何一处直接读 Windows 的用户级 PATH 注册表项。

### 4.3 为什么「写进 HKCU\Environment」不等于「正在跑的进程看得见」

在 Windows 上，用户级 PATH 的存放位置是注册表 `HKCU\Environment` 的 `Path` 值，进程运行时用的 PATH 则是它启动时操作系统交给它的那一份内存副本。两者不会自动同步：

- 微软关于设置环境变量的官方文档说：用 `setx` 设的变量「are available in future command windows only, not in the current command window.」（只在之后新开的命令窗口里可用，当前窗口不用。）
- 本报告引的缺陷票 #427 记的正是这个现象：用户把目录写进了用户级 PATH，但没有重新登录、也没有重启 DSH，面板依然看不见。

### 4.4 本机实测：宿主这一侧的对照

我在本会话的侧栏终端里做了一次只读对照。这个终端是由 DSH 起的，它的环境就是宿主那份环境的延续：

```
HKCU_Entries=27        （注册表里用户级 Path 的条目数）
Proc_Entries=50        （这个进程 PATH 的条目数）
Equal=False            （两者不相等）
UserHasGitHubCLI=False （注册表里没有 GitHub CLI 目录）
ProcHasGitHubCLI=False
```

条目数 27 对 50、且两者不相等，说明**进程里这份 PATH 与注册表里那份不是同一个东西**（这台机器上进程的 PATH 还要多出系统级 PATH 的条目与各安装器加进去的目录）。这台机器上恰好两处都没有 gh，所以说明不了「装了之后会不会看得见」——这一条只能靠票 #427 的现场记录（用户装了、注册表里也有，面板仍然看不见）来支撑。两台机器合起来是同一句话：**判断「看得见看不见」的依据是进程那份快照，不是注册表里那份配置。**

### 4.5 「插件装好了、插件自己看不见」会不会发生

**会，而且这不是小概率的边角情况，是 Windows 上默认的结局。** 只要满足这三件事，就必然发生：

1. 用的是需要提权、把 gh 装到 `%ProgramFiles%\GitHub CLI` 并顺手改 PATH 的那条路（也就是 winget 与官方 MSI 在 gh 这个包上的实际行为）；
2. DSH 进程在这之前就已经启动；
3. 插件没有在起 gh 的时候显式补 PATH。

这时候文件真的在盘上（`C:\Program Files\GitHub CLI\gh.exe`），注册表里的 PATH 也真的改了，但插件的三层解析读的是宿主进程启动时那份 PATH，里面没有这个目录，于是三层全部落空 → 面板显示「未找到命令 gh」→ 引导用户「再装一遍」。**#427 记的就是这个结果。**

反过来，在同一份代码上，「插件装好了、插件自己却看得见」也是可以做到的，有两条路，都不需要重启：

- **按绝对路径找**：gh 的入口路径是可预期的（winget 与 MSI 都是 `%ProgramFiles%\GitHub CLI\gh.exe`），插件可以自己把这个路径拼出来（`env.ProgramFiles` 加固定后缀），验证文件存在之后直接用绝对路径起进程。平台的解析方法对绝对路径是直接放行的（`dsh-subprocess-local/lib/index.js:966-984`），不需要 PATH 配合。
- **按路径兜底找**：把 `DSH_GH_PATH` 这个环境变量设成上面那个绝对路径。**但这里有一个必须说清的限制**——这个变量只有在宿主进程启动时就存在于它的环境里才有用（因为读的是 `process.env`），插件的进程改不了自己进程的环境；而且它只被平台解析那一层读（`src/host/platform/index.js:119-127`），也就是说它只服务走这一层的调用，不能指望它顺带影响别的路径。

另外，起 gh 的时候**显式把 `env.PATH` 补上那个新目录**这条也是通的——这一条在第 1.6 节的实测里验证过（A2、A3）。它和上面的绝对路径办法解决的是同一件事的两半：「怎么起」和「怎么找」。

最后给一处边界：**凡是「等进程环境自己刷新」这种期待都不成立**。Windows 不会推着正在跑的进程去读新注册表值；微软自己的说法也是「只对以后新开的窗口生效」。

---

## 5 一句话结论与三句话分档

**一句话结论（与开头同一个）：把安装程序下载下来并起起来、把「不需要管理员权限」的那条安装路跑完，插件自己就能做到；凡是要管理员权限的安装方式，都会停在权限那一步等人点一下，插件没有任何办法替人点；而「装完马上就能用」需要插件自己把生效问题解决掉——否则必然出现「插件装好了，插件自己还是看不见」的结果。**

拆成三档：

1. **插件自己能做完的（不需要人）**：下载安装程序；跑 Windows 的 winget 用户范围安装或 Scoop、macOS 的 `brew install gh`、Linux 的官方压缩包解到用户目录；确认文件落盘与版本号；把新目录显式补进之后每次调用 gh 时用的环境变量，或者干脆用绝对路径起 gh。
2. **卡在「需要人点一下」的（插件能准备、不能完成）**：Windows 上任何要求管理员权限的安装方式（gh 的 winget 与 MSI 都是这一类）——插件的子进程只能以当前用户身份启动，碰到要求提权的程序会当场拿到「拒绝访问」，它连把框弹出来都做不到；Linux 上 apt / dnf / pacman 前面的 sudo 要密码，其中管道的路走不通，插件的出路是开一个终端让用户自己敲；macOS 上如果非要装到 `/usr/local` 之类的系统范围，同理（而 Homebrew 本身不走提权，所以 macOS 反而最顺）。
3. **做不到的（结构性不可能）**：替用户点掉 Windows 的 UAC；知道并代填 Linux 的 sudo 密码；让已经在跑的 DSH 进程「刷新一下环境」去读刚写的注册表。

**明确回答票面第 5 问：会。** 「插件把它装上了，插件自己却看不见」是 Windows 上一条需要提权的安装路走完之后默认会发生的结果，不是异常；#427 就是现场记录。

**与另一张票的边界**：本报告只到「gh 可执行文件可用」为止。「登录、令牌、代理、按仓库授权」是另一张票的事，这里一句不碰。

---

## 6 证据索引

### 6.1 插件仓库（工作目录 `D:\dsh-plugin\dsh-mattpocock-skills-deck`）

| 位置 | 内容 |
|---|---|
| `src/host/index.js:29` | 宿主从 `ctx.get('subprocess')` 取子进程能力 |
| `src/host/repoKeys.js:17-36` | `resolveGh`：缓存在先，平台层解析其次，最后起一次 `gh --version` 回退；失败文案与告警日志 |
| `src/host/repoKeys.js:28` | 探测用的 `gh --version`：不传 `env`，`stdin` 忽略 |
| `src/host/repoKeys.js:40-93` | `runGh`：每次 gh 调用的 argv、cwd、`stdio`、`graceMs`；成功与失败分支 |
| `src/host/repoKeys.js:100-130` | `execProc`：通用外部程序执行（git 等），同样不传 `env` |
| `src/host/repoKeys.js:132-135`、`:174-181`、`:235-263` | `git` 的解析与使用（仓库根、remote 解析三层） |
| `src/host/platform/index.js:106-129` | 三层解析：DSH 解析 → `DSH_GH_PATH` 兜底（`fs.lstat` 校验）→ null |
| `src/host/platform/index.js:107` | `envSource` 默认 `process.env`（这层读的就是宿主进程启动时那份环境） |
| `src/host/platform/index.js:133-144`、`:145-172` | `spawnOpen` / `openTarget`：本机可见打开，起 `cmd start` 一类程序 |
| `src/host/platform/win32/index.js:22-35` | `resolveDeps`：环境来源的默认值是 `process.env`；`getHome` 的取值顺序 |
| `src/host/platformChannel.js:183-213` | 环境检查链与后端操作用的 `detectionExec`：argv、`stdio`、超时、日志 |
| `src/host/updateStore.js:139-144` | 安装子进程的 `stdio` 形状与 3 秒终止宽限期 |
| `src/host/updateStore.js:184-216` | `resolveCliEntry`：从正在运行的入口反查 CLI 的 JS 入口，绝不用 PATH 上的 `dsh` 名字 |
| `src/host/updateStore.js:254-270` | 桌面端路由：`desktopPnpm.runPlugin(参数数组, 使用范围目录)` |
| `src/host/updateStore.js:272-292` | 命令行路由：`subprocess.spawn({ argv, cwd, stdio, graceMs })`，起进程装插件自己 |
| `src/host/updatePkg/store.js:286-318` | 上一行的历史副本（同一套逻辑的第二份实现） |
| `src/shared/update/commands.js:37-51` | 安装配方的参数数组 `['add', '--save-exact', '<包>@<版本>', '--registry=…']` 与 15 分钟时限 |
| `src/host/publishFlow.js:36`、`src/host/tracker/backends/github/init-project.js:84`、`src/host/tracker/backends/gitlab/index.js:131-132` | 今天产品里的做法：按操作系统把安装命令写给用户，由用户自己执行 |

### 6.2 DSH 实现本体

profile 里那份（`C:\Users\辰辰洋洋\.dsh\profiles\node_modules\@deepseek-ai\`，版本 `0.1.5-rc.2`）与桌面端那份（`D:\0Tools\DSH Desktop\resources\app\node_modules\@deepseek-ai\`）的 `dsh-subprocess-local` 三个文件经 SHA256 比对**完全一致**（`index.js`、`runner.js`、`runner-launch-COYGu0Dl.js`），所以下表行号对两份都成立。

| 位置 | 内容 |
|---|---|
| `dsh-subprocess-local/lib/index.js:966-984` | `resolveExecutable`：绝对路径直接放行；裸名字按清理后环境的 PATH 与 PATHEXT 拼候选并逐个验文件 |
| `dsh-subprocess-local/lib/index.js:990-1006` | `spawn`：校验请求 → 组装最终环境 → 选受管范围（Linux 走临时 user scope，Windows 走 Job）→ 返回句柄 |
| `dsh-subprocess-local/lib/index.js:1028-1074` | `spawnTerminal`：走 node-pty 分配真实终端；行列数、cwd、最终环境交给它 |
| `dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:649-662` | `childEnv`：父环境清理结果与调用方显式 `env` 的合并规则（Windows 下按大小写不敏感覆盖） |
| `dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:882-893` | 请求的同步校验：`graceMs`、取消信号、`argv[0]` 非空 |
| `dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:970-986` | `bindManagedProcess`：三条流的四种处置方式与有界收集 |
| `dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:1133-1158` | 无原生受管范围时的回退启动：`stdin` 非 `ignore` 就开管道；Windows 隐藏窗口 |
| `dsh-subprocess-local/lib/runner-launch-COYGu0Dl.js:1618-1628` | `targetEnvironment`：最终环境 = 清理父环境 + 显式覆盖，`undefined` 表示删除 |
| `dsh-subprocess-local/lib/runner.js:19-26`、`:36-42` | Windows 错误码映射：740 → `EACCES` |
| `dsh-subprocess/lib/index.js:32` | 形似凭据的名字正则：`/KEY|PASSWORD|SECRET|TOKEN/i` |
| `dsh-subprocess/lib/index.js:50-56` | `scrubbedParentEnv`：删掉形似凭据的名字与全部 `DSH_` 名字，保留 PATH/HOME/本地化/代理 |
| `dsh-subprocess/README.zh.md` | 请求字段（argv/cwd/stdio/env/graceMs/signal）、「每一条流一种 stdio 处置方式」（第 41、55-61 行）、`spawnTerminal` 是「真实 PTY」（第 69 行）、显式 `env` 在清理之后合并（第 12、73 行）、「`argv` 绝不经过 shell 解释」（第 107 行） |
| `dsh-subprocess-local/README.zh.md` | 无配置字段（第 32 行）、裸名字按清理后 PATH 解析（第 41 行）、Windows 上普通子进程隐藏窗口（第 28 行） |
| `dsh-win32-process/lib/index.js:614-618` | `spawnCurrentTokenJobProcess`：`CreateProcessW(…, null, …, 1028, 环境, cwd, …)`——当前用户令牌、无提权、无新控制台 |
| `D:\0Tools\DSH Desktop\resources\app\lib\pnpm.js:87-102`、`:108-129` | 桌面端 pnpm 服务：用 `subprocess.spawn` 起插件安装，显式传一包环境，`cwd` 是本机可见的目录 |

### 6.3 GitHub CLI 与操作系统的官方资料

| 来源 | 用到的内容 |
|---|---|
| <https://cli.github.com/> | 官方推荐渠道：macOS 用 Homebrew、Windows 用 WinGet，另给 Linux 的 apt/dnf/zypper 与各系统下载入口 |
| <https://github.com/cli/cli/blob/trunk/docs/install_windows.md> | Windows 的 winget 与预编译包；**「The Windows installer modifies your PATH … you will need to open a new window for the changes to take effect.」**；Chocolatey、Conda、Scoop、Webi 被列为社区维护 |
| <https://github.com/cli/cli/blob/trunk/docs/install_macos.md> | macOS 的 Homebrew 与预编译包；社区渠道清单 |
| <https://github.com/cli/cli/blob/trunk/docs/install_linux.md> | Debian 与 RPM 族的官方命令（每一句都带 `sudo`）、Homebrew、预编译包；Arch 的 `sudo pacman -S github-cli` 等被列为社区维护 |
| <https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/g/GitHub/cli/2.98.0/GitHub.cli.installer.yaml> | gh 2.98.0 的 winget 清单：安装包类型 `wix`、**`Scope: machine`**、默认安装位置 `%ProgramFiles%/GitHub CLI`、支持的安装模式含 `silent` |
| <https://learn.microsoft.com/en-us/windows/package-manager/winget/install> | `--silent`（「Runs the installer in silent mode. This suppresses all UI.」）、`--accept-package-agreements`、`--accept-source-agreements`、`--scope` 的含义 |
| <https://raw.githubusercontent.com/microsoft/winget-cli/master/doc/Settings.md> | winget 的默认范围偏好：默认想装「当前用户」，用户范围不可选时才落到机器范围 |
| <https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/gh.json> | Scoop 的 gh 定义：从官方 zip 取 `bin\gh.exe`，不写系统目录 |
| <https://docs.brew.sh/FAQ> | Homebrew 的默认前缀（Apple 芯片 `/opt/homebrew`、Intel `/usr/local`、Linux `/home/linuxbrew/.linuxbrew`）；**「Homebrew refuses to work using sudo.」**；**「GUI apps on macOS don't have Homebrew's prefix in their `PATH` by default.」** |
| <https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/g/gh.rb> | gh 的 Homebrew 配方：有瓶装二进制，`bin.install "bin/gh"` |
| <https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--500-999-> | 第 740 条 `ERROR_ELEVATION_REQUIRED`：「The requested operation requires elevation.」 |
| <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setx> | 环境变量写入注册表后的生效范围：「available in future command windows only, not in the current command window.」 |

### 6.4 本仓库的缺陷票（用 `gh issue view` 读的正文）

| 票 | 用到的内容 |
|---|---|
| [#427](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/427) | 「新电脑已装 gh cli 仍报未找到命令 gh」；用户侧事实（winget 装到 `C:\Program Files\GitHub CLI`、目录已写入 `HKCU\Environment\Path`）；根因第一条就是「DSH Desktop 进程环境仍是启动时的快照，adapter 的 env 落点就是 `process.env`」 |
| [#428](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/428) | 同一台机器的另一半现象；四个待复核分叉点（宿主环境是否含 `DSH_GH_PATH`、子进程内 PATH、cwd、fs 沙箱根） |
| [#429](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/429) | 把上面两起现象收成待定票与诊断计划，等维护者决定是否解决 |

### 6.5 本机实测的两段

1. **探针脚本**：用 profile 里那份 `@deepseek-ai/dsh-subprocess-local` 构造服务对象，只读、只起子进程，跑完已从临时目录删除。逐字输出见第 1.6 节。
2. **环境对照**：在侧栏终端里比较注册表 `HKCU\Environment` 的 `Path` 与本进程 `$env:Path` 的条目数与是否相等，结果见第 4.4 节。只读。

本次调查在仓库里建的临时文件（三张票的正文与注释转存）收尾时已全部删除；本次没有运行过任何写仓库的命令，也没有改过任何被跟踪文件。

---

## 7 还没确定的事

1. **只装了 gh 之后、宿主进程那一侧的实测没做。** 第 4.4 节的对照说明「进程 PATH 与注册表 PATH 不是同一份」，但「装完之后注册表有了、进程没有」这半步是靠缺陷票 #427 的现场记录支撑的，不是我在这台机器上复现的（这台机器上两处都没有 GitHub CLI 目录，而且我不应该为了研究去装一个软件）。
2. **winget 在提权这一步的精确表现没在本机验。** 这台机器上 `winget` 命令不在 PATH 里（第 2 节那批探测结果），所以我只能从三份官方资料推：gh 包的清单写的是机器范围、winget 文档说默认偏用户范围、Windows 的 `CreateProcessW` 碰到要求提权的程序会返回 740 而不是代弹框。**「插件起 winget 装 gh 时到底是拿到一个失败，还是先弹出一个要人按的框」，没有实测。** 这一条要真机确认，缺的是一次在全新 Windows 上的实跑。
3. **`DSH_GH_PATH` 在运行中能不能被改活，没有查。** 从代码看它读的是宿主进程启动时那份环境（`process.env`），所以「装完之后由插件把这个变量设进系统、再让宿主读到」这条路在同一个进程里不成立；但「DSH 是否有别的机制在运行中重读环境」我没有全仓库查证。
4. **macOS 与 Linux 上的实测一点没做。** 第 3 节里每条渠道的「要不要提权、能不能无声、装到哪里」都来自各项目官方文档；「DSH 从程序坞启动时 PATH 里到底有没有 Homebrew 前缀」这一条，我只找到 Homebrew 官方 FAQ 那句面向所有图形程序的说明，没有在 Mac 上验证过 DSH 的实际情形。
5. **「插件下载安装包」这一步的具体做法没有查。** 本报告只确认了「起一个外部程序并给它环境变量」这件事的边界；至于下载用哪个接口、要不要校验签名或哈希、下载物放哪儿，属于下一张票的设计范围，本票没有查证。
6. **`desktopPnpm` 这个桌面服务是什么时候由谁注册的，没查到。** 我能确认的是插件拿到它时的形状与它内部怎么起进程（第 2 节），但它的注册方在桌面端打包产物里，本次没有定位到。
