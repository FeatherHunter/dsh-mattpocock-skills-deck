# 查清真实桌面宿主里插件被重复装配的触发点：链接开发期每次「重配 + 换模块」都再跑一次 apply，装成 npm 包后消失

> 地图 [#1314](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1314) 子票 [#1348](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1348) · 只读调查，不改生产代码、不动票、不提交 · 落盘日期 2026-10-26 凌晨（Asia/Shanghai）
> 前置笔记：`research/1333-host-remount-trigger.md`（结论：一行启动头 = 一次 `apply`；门禁测试解释约十行；真实宿主的重复装配没查清）
> 数据来源：桌面 profile 的插件日志（现存 `2026-10-25.log`、`2026-10-26.log` 与三个轮转残留目录）、插件管理器操作记录、市场日志、DSH 桌面应用包 `D:\DeepseekHarness\resources\app.asar` 里的宿主源码、仓库 git 历史与 `CHANGELOG.md`。所有行号以本次实际读到的文件为准。

## 一、结论

**一句话：** 桌面宿主里能让插件 `apply` 再跑一次的路径只有五条（进程重启、该行配置变化、它注入的服务被重新提供、整树重配、HMR 换模块）；票面那几天（2026-10-20、10-21）profile 里的插件是**本地链接的开发构建**，每次重新构建后只要发生一次「重配」动作，HMR 就会发现链接目录里的文件变了、把旧 fiber 停掉、重新 import 新代码再跑一次 `apply`——这正是「第一行没有 pluginVersion、第二行起才有 `1.9.0-beta.7`」的唯一解释。2026-10-22 凌晨 profile 改成从 npm 正规安装之后，现存日志里「同一个进程号多行启动头」就再也没出现过。

**证据强度分级（本文所有结论都标了级）：**

| 级别 | 含义 | 本文里的例子 |
|---|---|---|
| 已证实 | 源码或记录直接写着 | 桌面宿主一个进程只跑一次 `runProfile`；HMR 的比较根包含链接目录；`beta.6`/`beta.7` 从没发过 npm |
| 强证据 | 多条一手记录互相对上，但没有直接日志 | 10-22 那三次重复装配是「deck 这一行被单独重启」，不是整棵树重配 |
| 推测 / 待证 | 只能给出候选与排除理由 | 10-20 那 11 次分别对上哪个动作（原始日志已被清理，无法逐条对时间） |

## 二、证据基座变了：票面引用的 10-20 / 10-21 日志已经不在了

票面写的是 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\` 里 2026-10-18 到 10-21 的日志。**现在这个目录只剩两份日文件**：

| 文件 | 大小 | 行数 |
|---|---|---|
| `2026-10-25.log` | 134,090,820 字节 | 791,509 |
| `2026-10-26.log` | 3,885,772 字节 | 21,057 |

另有三个轮转残留目录（`.2026-10-22.log.3592.….tmpdir`、`.2026-10-24.….tmpdir`、`.2026-10-25.….tmpdir`），其中 10-22 那个残留文件覆盖 `2026-10-21T15:59:59.898Z` 到 `16:02:59.136Z`（本地 10-22 00:00:00 到 00:03:00），**是现存日志里唯一一段真实宿主的进程内重复装配**（见第四节）。

所以本文的一手证据基座是：**10-25 / 10-26 的同类日志 + 10-22 那三分钟残留 + 安装/更新/配置记录 + 宿主源码**。票面 10-20 / 10-21 的原始行无法再逐条核对，凡是涉及那两天的判断都在文中标了「推测」。

## 三、先把「一行启动头 = 一次 apply」这条链再钉一遍

1. 取日志库的变量 `_logP` 与函数 `_log()` 声明在装配函数体 `bootBody` 内部（`src/host/index.ts:326-327`），没有进程级单例，**每次 `apply` 都会新建一份实例**。
2. 实例建好后写启动头：`src/host/index.ts:343` 传 `pluginVersion: _rc.readServingPackageVersion()`，`:357` 调 `h.writeStartupHeader()`。
3. 日志包对**单个实例**写启动头幂等：`node_modules/dsh-log/dist/store.js:333-370`，已经写过就 `return`；`pluginVersion` 是空串时 `:360-361` 干脆不写这个键。
4. 插件入口注入三个服务（`src/host/index.ts:14-22`）：`inject: ['connection', 'llm', 'sessionQuery']`；`apply` 先直接试一次 `bootBody()`（`:378`），依赖不齐才走 `ctx.inject(['subprocess','timer'], bootOnce)`（`:379-381`）。

因此：**同一个进程号出现 N 行启动头 = 这个进程里 `apply` 被成功执行了 N 次**，且每次都是不同实例。

## 四、现存日志能证实的三件事

### 4.1 10-25 / 10-26：每条启动头都对应一次进程启动，没有进程内重复装配

10-25 共 6 行、6 个不同进程号；10-26 共 9 行、9 个不同进程号，每号 1 行。每条 `host.start` 之前 0.5~2 秒都有一条市场插件的 `boot` 记录（`.dsh-market\log.ndjson`），例如：

- 市场 `2026-10-25T15:58:39.443Z` → `host.start` `15:58:41.891Z`（进程号 63464，`1.9.0-beta.18`）
- 市场 `2026-10-26T16:05:27.532Z` → `host.start` `16:05:29.314Z`（进程号 56828）
- 市场 `2026-10-26T16:29:33.790Z` → `host.start` `16:29:34.717Z`（进程号 18496）

市场那条 `boot` 是市场插件自己在 `apply` 时打的（`dshmarket/src/routes.ts:760-771`：`mount()` 里把被停用的插件逐个关掉，成功才记 `boot` / `plugin kept off`），**它和启动头成对出现，说明那一刻整个宿主进程是刚起来的**。10-26 00:15:20 那条的 `dir` 是另一个 profile（`…\dsh-diag\home3\profiles\desktop\…`），属于诊断用的第二套 profile，不影响结论。

### 4.2 10-22 那三分钟：同一进程号 3592 连跑三次，且是「这一行被单独重启」

残留文件 `…\.2026-10-22.log.3592.….tmpdir\2026-10-22.log.tmp`（2,843,353 字节）里有三行启动头，全部 `pid=3592`、`pluginVersion=1.9.0-beta.7`：

| 写入时刻（UTC） | 本地时间（Asia/Shanghai） | `startedAt`（实例建库时刻） |
|---|---|---|
| `2026-10-21T16:01:47.034Z` | 10-22 00:01:47 | `16:01:46.969Z` |
| `2026-10-21T16:02:44.583Z` | 10-22 00:02:44 | `16:02:44.493Z` |
| `2026-10-21T16:02:47.301Z` | 10-22 00:02:47 | `16:02:47.231Z` |

同一窗口里**没有**整树重配的痕迹：

- 插件管理器的操作目录在 `00:01~00:03` 之间没有（最近的一次是 `operation-YAG7gd`，本地 10-22 00:13:38）。
- 市场日志在 UTC `2026-10-21T16:01Z~16:03Z`（本地 10-22 00:01~00:03）之间没有 `boot` 行；离得最近的两条是 UTC `2026-10-21T16:05:51.100Z`（本地 00:05:51）与 UTC `2026-10-22T12:47:14.353Z`。整树重配会让市场插件也重新 `apply` 一次；它没有，说明**只有 deck 这一个 entry 被重启**。
- 三行前后是密集的业务事件（`host.call` 里的 `wf.selection`/`wf.focus`、`preflight.gate`、`detection.detect`、`exec.run(git, exitCode -1)` 等），没有配置或插件类事件。
- 第二次启动头之前 0.5 秒有一条 `log.persist.fail {"pluginId":"wf","op":"persistSwitch","reason":"dir-conflict","dirHash":"5d981477"}`（`16:02:43.959Z`）——旧实例还占着缓存目录、新实例已经起来，这是「换模块」时新旧实例短暂并存的形状，不是干净的一次进程启动。

### 4.3 版本字段的来历：那几天跑的是本地链接的开发构建

- `pluginVersion` 这个字段是提交 `9bd7e920`（2026-10-21 01:02:53 +0800）才加进 `src/host/index.ts` 的；**在此之前所有版本的 `apply` 都不写这个键**。所以「第一行没有、后面才有」本身就说明同一进程里先跑了旧代码、后跑了新代码。
- 日志包只在版本号非空时写这一格：`src/host/logFromPackage.ts:103` 原话是「pluginVersion 是 #1305 加的第四件『环境自述』，只在读得到服务那一份的版本号时才递（读不到就不写这一格，绝不编）」；`node_modules/dsh-log/dist/store.js:358-364` 判「空值不进行」。
- 「服务这一份」= 插件自己旁边的 `package.json`：`src/host/rpcChannel.ts:51-55` 的候选是 `../package.json` 与 `../../package/package.json`（dev/link 形态读到的是仓库 `package/package.json`，随本地构建的版本号变），`:61-73` 读不到返回空串并缓存。
- 本地构建写出的版本号也不是每行都变：版本推进提交 `8f9a4a57`（2026-10-20 23:56「版本号推进到 1.9.0-beta.7：双轨形态落地后的本地验收版」）之后、`d29562ba`（2026-10-22 01:43，beta.8）之前，所有本地构建都写 `1.9.0-beta.7`——这解释了那 11 行里从第二行起版本值完全相同。
- `CHANGELOG.md:251`（v1.9.0-beta.8 节）原文：「**npm 官方源上对外最新的仍是 1.9.0-beta.5**，`beta.6` 与 `beta.7` 两个版本号从没发过 npm」。
- 插件管理器记录：`operation-jcQPCs`（本地 10-19 00:35:55）装的是 `1.9.0-beta.5`；`operation-CKCRUV`（10-22 02:47:50）先移除 `1.9.0-beta.5`，`operation-h9t27D`（10-22 02:47:51）装 `1.9.0-beta.8`。
- `CHANGELOG.md:267` 原文：「本机 desktop profile 这一轮改为从 npm 正规安装（不再走本地链接），装上的就是这版发布包。」

三条一对：**10-19 到 10-22 之间，profile 里的 deck 不是 pnpm 装的那份 beta.5，而是本地链接的开发构建**（否则跑不出 `1.9.0-beta.7` 这个从没上过 npm 的版本号）；10-22 02:47 换成 npm 的 beta.8 之后，「同进程多行」在现存日志里消失（4.1 与 4.2 的对照）。

还有一条时间口径要写清：插件日志按**本地日期**切文件（实测 `2026-10-25.log` 的行从 `2026-10-24T15:59:59.403Z` 到 `2026-10-25T15:59:37.976Z`，`2026-10-26.log` 从 `2026-10-25T15:59:39.048Z` 起，边界落在本地午夜前后几秒）。票面那 11 行里有带 `beta.7` 的行，而 beta.7 的构建最早只能出现在 10-21 01:02 之后，所以这些行落在 10-21 凌晨那一侧——**11 行横跨了 10-20 与 10-21 两份日文件**；`research/1333` 第五节把它记在「2026-10-20」，应是按「这个进程号第一次出现的那天」分组，但那张表没写分组口径，原始文件今天也不在了。

## 五、源码里所有能让 `apply` 再跑一次的路径（这是本票的核心答案）

| # | 路径 | 触发条件 | 关键位置 | 会不会重跑 `apply` |
|---|---|---|---|---|
| 1 | 进程重启 | 宿主进程退出再起 | `dsh-desktop-host/lib/index.js:219-350` 的 `main()` 只调一次 `runProfile`；`app.asar/lib/main.js:3793-3811` 用 spawn 起它并带 `--expose-internals` | 会，但**换进程号** |
| 2 | 该行配置变化 | `entry.update` 后 `fiber.update(config, true)` | `cordis-plugin-loader/src/config/entry.ts:105-107`、`:142-156`（只有 `volatile` 配置能免重启，`:146-151`） | 会 |
| 3 | 注入的服务被重新提供 | provider fiber 的 uid 变 → epoch 变 → `_reload()` | `cordis.js:1317-1329`（epoch 拼 `impl.fiber.uid`）、`:1330-1344`、`:1349-1371`（`_reload` 重跑 runner）、`:1410-1415` | 会 |
| 4 | 整树重配 | 根 Include 的 `entry.update({config:{…,patches}})` | `dsh-app-boot/lib/index.js:3782-3784`、`:3851-3859`；但 Include 用 `ctx.on('internal/update')` **否决 fiber 重启**、改成行级 diff（`cordis-plugin-include/src/index.ts:190-201`） | **只重跑配置变了或文件变了的行** |
| 5 | HMR 换模块 | `reconcileProfile()` 发现已加载文件与磁盘不一致 → 停 fiber、evict、重新 `import` | `dsh-hmr/lib/index.js:1320-1385`、`:645`（`loader.import`）、`:660`（换上新 plugin） | 会，**且换上新代码** |
| 6 | 全量重启 | HMR 命中 `externals`（框架依赖）时调 `loader.exit()` | `cordis-plugin-loader/src/index.ts:196-198`；`dsh-hmr` README「框架依赖变化」一节 | 不是进程内重跑，是让宿主退出 |

### 5.1 第 5 条（HMR 换模块）就是票面那个现象的答案

`dsh-hmr` 的比对规则（`dsh-hmr/lib/index.js`）：

- 比较根 = profile 目录 + **profile 的 `node_modules` 下每一个符号链接指向的目录**（`:1449-1453` 的 `profileRoots()`：`lstatSync(path).isSymbolicLink()` 的包都算）。本地链接的开发构建正好落在里面。
- 判定「过期」= 已加载模块文件的 `ino:size:mtimeMs` 与上次记录不一致（`:415-418`）。**重新构建一次产物，mtime 与 size 必然变**。
- 过期后：`planReplacement` → `stopPlanned` 停掉受影响的 fiber → 重新 `import` → `recomposeProfile` 的 `resume` 把没有活 fiber 的行重新 `update`（`dsh-hmr:1345-1349`、`dsh-app-boot:3926-3930`）→ **`apply` 再跑一次，读到的是新代码**。
- 基线在应用就绪时记一次（`dsh-hmr:838`），之后每次 `reconcileProfile` 都比一遍。

这条路径也解释了 4.3：只有它能解释「同一进程里代码换了、`pluginVersion` 从无到有」。

### 5.1.1 为什么「重新构建一次」必然改文件身份

构建脚本复制完产物后，会把目标目录里每个文件的 mtime 统一 touch 到当前时刻（`scripts/build.mts:1645-1660`，见 `research/1311-client-bundle-reload-signal.md:168`）——一次真构建必然改掉 `package/lib/*` 的 inode、size 或 mtime；缓存命中路径一个字节都不写（`scripts/build.mts:237-239`），但要到 #1325（提交 `ecadaab3`，2026-10-21 02:22「构建缓存命中时不再改动产物文件，并把命中与真构建的日志分开」）之后才如此，**在那之前连没有改动的构建也会碰文件**。链接目标正是 5.1 里的比较根之一，所以「一次真构建 + 之后任意一次重配」就是一次重复装配；反过来，只有构建、没有重配时不会多行（因为桌面默认 `root: []`，见 5.2）。

### 5.2 谁会去调 `reconcileProfile`（全仓只有两处）

1. **HMR 自己的配置监视**：监视 profile 的 `cordis.patch.yml`、家目录的同名 patch 文件、profile 的 `package.json`（`dsh-hmr:849-873`）。patch 文件内容变了、或 `dsh.profile.bundles` 变了，才调 `reconcileProfile()`（`:853-871`）；只改 `package.json` 里的依赖版本、bundle 列表没变，**不会**触发（`:855` 先比 bundles）。
2. **插件管理器的 `reload()`**：安装、更新、启用、停用、删包之后调（`dsh-plugin-manager/lib/index.js:2360-2372`，调用点 `:1646`、`:1936`、`:1952`、`:2146`）。桌面端有 HMR 时走 `hmr.reconcileProfile(requiredIds)`；没有 HMR 时只回 `restart-required` / `no-hmr`（`:2381-2382`）。

**重配机会还能直接数出来：** 插件管理器每跑一次 pnpm 都会在 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.plugin-manager\logs\` 下建一个 `operation-*` 目录并打开 `pnpm.log`（`dsh-plugin-manager/lib/index.js:534-540`）；命令行操作时输出留在终端，日志文件是 0 字节。这个目录现有 323 个，把它们按创建时间排出来，就是那几天的重配机会清单：10-19 00:33-00:46、07:45-07:54、09:13-09:24、13:07-13:37、17:51-17:53、18:46、19:27、22:22；10-20 00:26、00:30-00:46 约六次、02:12、04:12-04:24 十余次、11:36、17:31、17:39、23:45:58、23:46:02；10-21 00:10:39、01:21:11、01:28:50、01:35:58（这四次都是 0 字节 = 命令行操作）。

**注意**：HMR 自己的模块监视在桌面默认是**关的**。`dsh-base` 的 patch 把 `hmr` 行写成 `config: { root: [] }`（注释原文「Profile configuration reloads by default; module roots are opt-in.」），而 `root.length === 0` 时监视器立即就绪、不监视任何路径（`dsh-hmr:883-889`、`:938-939`）。所以「构建产物变了」本身不会触发任何东西，必须**先有一次重配**（改 patch、改 bundles、或插件管理器操作）把比对带起来。

## 六、把票面那几天对上路径：能说到哪一步

### 6.1 本插件自己在那个窗口装过什么（先排除「被市场升级」）
市场日志（`.dsh-market\log.ndjson`，时间字段是 UTC，下面已转本地）里本插件的全部记录只有五条：10-15 04:36:00 安装 1.8.0-rc.7（`pinned to the registry's latest`）、04:36:02「the host's own replay activated it; adopted instead of mounting a second copy (#814, #827)」与 `exit=0 hot=true`；10-17 17:06:43 更新到 beta.2（`exit=0`）；10-19 00:34:18 更新到 beta.5 被拒（`exit=1 err=… the plugin is in use … (bundle-in-use)`），00:36:02 再试 `exit=0`。**此后到日志结束（10-25）没有本插件的任何市场事件。**

插件管理器操作目录里能看到内容的本插件操作（本地时间）：10-15 04:36:00、10-17 17:06:41、10-18 01:25:08/10（beta.3 → beta.4）、10-19 00:35:52/55（beta.4 → beta.5）、**空窗**、10-22 02:47:50/51（beta.5 → beta.8）、10-22 20:44:15/17、10-23 03:25:05/09（link）、10-23 11:59:13、10-23 19:10:26、10-23 20:14:25/29、10-24 16:15:05/09、18:02:14/17、19:55:31/33、22:52:52/54、10-25 04:53:39/41、16:29:28/37。

**10-19 00:35:55 到 10-22 02:47:51 之间没有任何一次内容可见的本插件操作**——那段时间的 link 切换只可能是命令行操作（`pnpm.log` 0 字节，内容看不到）。所以「10-20、10-21 本插件被市场升级过」这条不成立。10-23 那几次 pnpm 输出里写着 `dsh-mattpocock-skills-deck is linked to …\profiles\desktop\node_modules from D:\dsh-plugin\dsh-mattpocock-skills-deck\package`，与 4.1 的引文一致。

### 6.2 10-20 那 11 行的窗口（推测，但可以收窄）

票面只给了「进程号 35932、11 行、跨度 3 小时 40 分」。市场日志里 10-20 的 `boot`（= 进程启动）时刻是本地 `00:23:36`、`08:16:01`、`08:16:10`、`08:16:59`、`08:22:24`、`14:09:46`、`15:47:10`、`16:30:37`。能装下 3 小时 40 分的进程存活区间只有两段：`00:23–08:16` 与 `08:22–14:09`。

而插件管理器的操作目录在 **10-20 00:25:09 到 04:24:57 之间有 34 个**（跨度 3 小时 59 分），`08:22–14:09` 之间只有 `10:47:49`、`11:36:21` 两个。**若那 11 行落在凌晨那段，重配机会（34 次操作）与 3 小时 40 分的跨度都对得上**；这是本文对 10-20 最合理的候选，但原始日志已毁，无法逐条验证。

### 6.3 为什么 34 次操作只对应 11 次装配

因为第 5 条路径只在「链接目录里的文件自上次比对后变过」时才换模块（`dsh-hmr:415-418` 的 `ino:size:mtimeMs` 比较）。两次重配之间没有重新构建，比对结果不变，`apply` 就不会重跑。**11 次装配 = 11 次「先重新构建、后遇到重配」的时刻**；34 次操作只是 34 次比对机会。

### 6.4 10-22 那三次（强证据，但触发者未定）

四次事实指向「deck 这一行被 HMR 单独换掉」：没有整树重配（市场没有 `boot`）、没有插件管理器操作、三次都带 `beta.7`（说明链接目录里是 beta.7 的构建）、第二次之前有新旧实例抢目录的 `dir-conflict`。

但**触发那三次 `reconcileProfile` 的动作没有留下来**：那个时段没有操作目录，市场也没有记录；唯一还能产生重配的是「有人写了 `cordis.patch.yml`」——那个文件的修改时间现在已被后续操作覆盖（当前 `2026-10-26 00:29:39`），查不到 10-22 的历史。这一段只能标「待证」。

### 6.5 三种行数形状

- **1 行**：进程正常启动，之后的重配里本插件文件没变（或者根本没有重配）。
- **2 行**：一次 bundle 级变化（本插件自己的更新、link 切换）必然重启一次；或者「文件变过 + 随后一次重配」。10-18 那个 2 行的进程号与 10-18 01:25 的 beta.3 → beta.4 操作同在凌晨，形状正好对上；10-21 的四个 2 行进程号间隔 16 到 55 分钟，同形（数字见 `research/1333-host-remount-trigger.md` 第五节）。
- **3 到 11 行**：链接期反复构建，每次构建之后的第一轮重配各算一次；10-22 那三行是「只有 deck 这一行被换掉」的现存样本。

## 七、已排除的候选（连同排除理由）

1. **客户端连接 / 界面刷新 / 面板重载 / 会话切换**：deck 注入的 `connection` 服务由 `dsh-client-connection` 插件自己的 fiber 提供（`client-connection.js:709-722` 的 `super(ctx, "connection")`、`:1027-1035` 的 `apply`），客户端连上或断开不会重新 `provide` 这个服务，也就不会改 deck 的 epoch。反证：10-25 / 10-26 有大量会话活动（新会话、面板刷新），却没有一条同进程多行。
2. **门禁测试**：那十行写在**仓库检出目录**的缓存里（`research/1317-host-start-real-counts.md`），与 profile 缓存目录是两套日志，不能混用。
3. **`update-queue`**：两个队列目录里装的是 life-pack 家族（`life/batch.json` 的 order 是 life-pack、bill、calorie、memo、schedule、home、chef），与 deck 无关；它只能证明「安装类操作会写 `restartRequired`」，不能解释 deck 的重复装配。
4. **文件监视 / HMR 自动热更**：桌面默认 `root: []`（见 5.2），不监视任何模块根，构建产物变化本身不会触发重载。
5. **宿主启动失败重试**：`dsh-app-boot` 的 `StartupError` 是启动期一次性判定；桌面壳的崩溃日志（`C:\Users\辰辰洋洋\AppData\Roaming\@deepseek-ai\dsh-desktop\logs\crash-*-host.log`）显示的是 `Error: desktop welcome: Web authentication failed`（`lib/main.js:8886` 的 `connectDesktopWelcome`）导致**整个进程重启**——那会换进程号，表现为「一天很多个进程号、每号一行」，不是同号多行。
6. **`loader.exit()`（第 6 条路径）**：它让宿主退出，不是进程内重跑；票面现象是同一进程号内多行，排除。

## 八、仍不确定 / 需要人拿主意的

1. **10-20 那 11 行的逐条时间**：原始日文件已被轮转清理，本文只能给出窗口与候选动作（6.2），无法逐条对时间（窗口在 6.2）。要彻底钉死，只能等下次复现。
2. **10-22 那三次的触发者**：能证明「是 deck 这一行被换掉」，不能证明「谁触发的重配」（6.4）。
3. **桌面宿主是否真的加载了 `hmr` 行**：本文的证据是间接的——`dsh-base` 的 patch 用 `profileContext` 作开关、桌面宿主 spawn 时带 `--expose-internals`（HMR 的构造硬闸在 `dsh-hmr:786`），两件事都指向「启用」；但没有运行时快照能直接看到 `hmr` 服务存在。若这一条不成立，第 5 条路径整体不成立，那 10-20 的现象就只能回到第 2/3 条（配置变化或服务级联）——但那样解释不了「代码换了、版本字段从无到有」。
4. **`research/1311-client-bundle-reload-signal.md:191` 转述的「桌面端无 HMR」需要复核**：那条转述自 `docs/research/424-refresh-dual-channel-spec.md:49` 与 `:76`，与本文读到的宿主源码（`--expose-internals` + `dsh-base` 里 `hmr` 行默认开启）冲突。可能那条说的是**客户端** bundle 的热更通道，不是宿主插件树，措辞需要改。
5. **10-20、10-21 实际保存过几次设置（写了几次 profile 补丁）查不到**：文件只留下最后一次内容与修改时间。本机没有 `C:\Users\辰辰洋洋\.dsh\cordis.patch.yml` 这份 home 补丁，设置落在 profile 的 `cordis.patch.yml` 里（本次读到 `locale` 等条目）；`research/1284-locale-data-contract.md:26` 记的落点是 `$DSH_HOME\cordis.patch.yml`，两种写法都在 HMR 的监听范围内，但笔记与实际落点不一致，订正留给后续。
6. **本次没有构造受控实验**（例如「改一个链接目录里的文件、触发一次操作、看启动头是否加 1」）：本票是只读研究，且要在正在运行的桌面宿主上操作；机制与现场证据已经够支撑结论，实验留给 #1374 落地时的最小复现去覆盖。

## 九、给下游票的口径与埋点建议

### 9.1 把词定下来

- **一次重载** = 插件 Loader 条目的一次「停止 → 启动」，也就是又调了一次 `apply`。
- **重复装配** = 同一个进程号里第 2 行起的启动头；跨进程号的多行是「多次启动」，不是重复装配。

### 9.2 旧验收要改

`research/1333-host-remount-trigger.md` 第七节的验收原话是「真实宿主进程重载时每次重载仍会有 1 行（这个行为是对的，因为『一次重载就是一次新启动』）」。本票之后这后半句要作废：重载不换进程，日志实例应当跟进程走；治本修法（子票「实现进程级日志单例：一个进程只建一个日志实例」，#1374）的验收应改为——**同一个进程号只有 1 行启动头**，重载之后继续使用同一个日志实例；再配一条最小复现（同一进程模拟装配两次）证明不会多行。

### 9.3 给「实现进程级日志单例」的设计提醒

进程级单例要处理「旧实例的冲刷定时器在 fiber 销毁时被停掉」的情况：第二次装配时要么复用还能工作的实例，要么重建但**不再写启动头**（写头的幂等键放在进程级，而不是实例级）。另外，4.2 那种「新旧实例短暂并存、抢缓存目录」的形状（`dir-conflict`）正是单例要消掉的东西。这条由 #1374 验证，本票只提口径。

### 9.4 若要下次能逐条复核

- 把 `apply` 计数挂进程级（例如 `globalThis` 上以 `Symbol.for(…)` 为键），写进 `host.start` 的字段（如 `applySeq`）：同一进程号第二行起就自证是重复装配，不用再靠版本字段反推。
- 想记「每次重载的时刻」，可在装配入口顺手写一行带计数与 `process.uptime()` 的事件；事件名与字段要进日志事件白名单。
- 「重配是谁发起的」插件侧拿不到（`app-boot/config-reload` 是宿主内部事件）；要拿只能改应用包内宿主侧，或按第十节的调试办法临时开 `enableLogs`——不建议把宿主改动纳入本仓修法。

### 9.5 顺带给「订正日志事件附录里启动头的字段口径」（#1332）

`pluginVersion` 只在 2026-10-21 01:02（#1305）之后的构建里出现；`src/host/logFromPackage.ts:103` 的原话是「读不到就不写这一格，绝不编」。订正字段口径时把这条写进去，免得把「没有版本字段」误读成「旧版本插件」。

## 十、可复核方法

### 10.1 重新提取启动头（大文件必须流式读）

```js
// 存成 %TEMP%\dsh1348\hosts.mjs，node hosts.mjs <日志文件>
import fs from 'node:fs'
import readline from 'node:readline'
const rl = readline.createInterface({ input: fs.createReadStream(process.argv[2], 'utf8'), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.includes('"host.start"')) continue
  try {
    const o = JSON.parse(line)
    if (o.event !== 'host.start') continue
    const d = new Date(o.ts)
    console.log(o.ts, d.toISOString(), d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      'pid=' + o.fields?.pid, 'ver=' + (o.fields?.pluginVersion ?? '(无)'), o.fields?.dir)
  } catch {}
}
```

对现存文件跑：`node %TEMP%\dsh1348\hosts.mjs "C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-25.log"`；10-22 那三行要把路径换成 `…\logs\.2026-10-22.log.3592.….tmpdir\2026-10-22.log.tmp`。

### 10.2 核对「那一刻是不是进程启动」

```powershell
$f='C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-market\log.ndjson'
Get-Content -LiteralPath $f | Where-Object { $_.Contains('"event":"boot"') } |
  ForEach-Object { ($_ | ConvertFrom-Json).at }
```

市场 `boot` 与启动头成对 = 那次是进程启动；只有启动头、没有 `boot` = 进程内重装配（4.2 就是这么判的）。

### 10.3 核对安装/更新记录

```powershell
$d='C:\Users\辰辰洋洋\.dsh\profiles\desktop\.plugin-manager\logs'
Get-ChildItem -LiteralPath $d -Directory | Sort-Object CreationTime |
  ForEach-Object { $p=Join-Path $_.FullName 'pnpm.log'; if (Test-Path $p) {
    $h=Select-String -LiteralPath $p -Pattern 'mattpocock' -SimpleMatch
    if ($h) { $_.Name + ' | ' + $_.CreationTime.ToString('yyyy-MM-dd HH:mm:ss'); $h | ForEach-Object { '    ' + $_.Line.Trim() } } } }
```

### 10.4 下次复现时怎么一次抓准

1. 给 profile 的根 include 行加 `enableLogs: true`（`cordis-plugin-include/src/index.ts:153-154`），或从命令行跑同一 profile 看 stdout——loader 会打 `apply` / `reload` / `unload`（`cordis-plugin-loader/src/index.ts:181-198` 的 `showLog`）。
2. 或临时把 `hmr` 行的 `config.root` 从 `[]` 改成 `["."]`，让模块变化自己触发重载，再对照启动头的时间。
3. 或给 `reconcileProfile` 的调用方各加一条日志（HMR 的 `refresh` 与插件管理器的 `reload` 各一处），这样「谁触发的」当场可见。

## 十一、只读声明

本次调查没有改生产代码、没有提交、没有动票、没有跑门禁；只在 `%TEMP%\dsh1348\` 下写临时脚本、从 `app.asar` 里按需解出几个文件；另在仓库 `.scratch\1348\` 下放了几个调查脚本（临时文件，不入库）。仓库里**只新增了本文件**。

## 十二、附：本次读到的关键行号索引

- 插件侧：`src/host/index.ts:14-22`（inject 列表）、`:326-327`（`_logP`/`_log()` 在 bootBody 内）、`:343`（pluginVersion）、`:357`（writeStartupHeader）、`:378-381`（bootOnce）；`src/host/rpcChannel.ts:52`、`:54-55`、`:61-73`（版本读取与缓存）。
- 日志包：`node_modules/dsh-log/dist/store.js:333-370`（写启动头幂等）、`:360-361`（版本为空不写键）。
- 宿主启动：`app.asar/lib/main.js:3793-3811`（spawn `dsh-desktop-host`，带 `--expose-internals`）；`dsh-desktop-host/lib/index.js:219-350`（`main()` → 一次 `runProfile`）。
- loader：`cordis-plugin-loader/src/config/entry.ts:105-107`、`:118-157`（`update` 与 `volatile` 例外）、`:223-238`（`_init` 每次都调 `registry.plugin` → `apply`）；`src/index.ts:181-198`（showLog 与 `exit()`）。
- cordis：`cordis.js:1317-1329`、`:1330-1344`、`:1349-1371`、`:1410-1415`（epoch 与重跑 apply）。
- HMR：`dsh-hmr/lib/index.js:786`（`--expose-internals` 硬闸）、`:830-873`（配置监视与 `refresh`）、`:883-889`、`:938-939`（`root: []` 不监视）、`:415-418`（过期判据）、`:645`、`:660`（换模块）、`:1320-1385`（`reconcileProfile`）、`:1449-1453`（比较根含符号链接目标）。
- app-boot：`dsh-app-boot/lib/index.js:3782-3784`、`:3851-3859`（重配与 `resume`）、`:3904-3912`（发布 resolution）、`:3926-3930`（重启没有活 fiber 的行）。
- include：`cordis-plugin-include/src/index.ts:190-201`（否决 fiber 重启、行级 diff）。
- 插件管理器：`dsh-plugin-manager/lib/index.js:1646`、`:1936`、`:1952`、`:2146`（reload 调用点）、`:2360-2372`（有 HMR 走 reconcile）、`:2381-2382`（无 HMR 只报重启）。
- 记录与文档：`CHANGELOG.md:251`、`:267`；`dshmarket/src/routes.ts:515`（市场日志路径）、`:760-771`（`boot` 行）、`:776-779`（自愈守卫）。
- 构建与日志日期：`scripts/build.mts:1645-1660`（复制产物后统一 touch mtime，见 `research/1311-client-bundle-reload-signal.md:168`）、`:237-239`（缓存命中不写盘）；#1325 提交 `ecadaab3`（2026-10-21 02:22）。
- 插件管理器操作目录：`dsh-plugin-manager/lib/index.js:534-540`（`operation-*` 与 `pnpm.log`）；`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.plugin-manager\logs\` 现有 323 个。
- 市场日志里本插件的记录：10-15 04:36:00、04:36:02 两条，10-17 17:06:43，10-19 00:34:18、00:36:02。
- 版本字段：`src/host/logFromPackage.ts:103`（注释原话）、`src/host/rpcChannel.ts:51-55`、`:61-73`、`src/host/index.ts:343`。
