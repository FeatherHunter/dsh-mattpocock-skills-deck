# 宿主入口装配账本：src/host/index.js 每一段是怎么来的

这份文档回答三个问题：入口文件里的装配分组分别由哪张票拆出来、**为什么剩下的代码只能留在入口文件里**、以及搬走的实现在哪个文件。

入口文件只做装配与注册，篇幅上限 350 行（`tests/verify-file-granularity.js` 的门禁）。所以「哪张票搬走了什么」这类历史叙述收在本账本，代码旁边只留一行指针。**动了装配分组就同步改这里**，别让指针指向空处。

账本由 #837 建立：那一票只把入口文件里成段的历史叙述搬到这里（代码一行没改），入口从 372 行降到 339 行。复核办法（去掉注释后两版代码逐行相同、每段原文都在本账本里）写在该票正文。

## 0. 为什么入口文件里还留着这些代码

想再拆小之前先看这四类东西为什么搬不走：

1. **注册语句留在入口，是设计选择**（#837 复审把原来那句「必须同步注册，晚一个微任务就是电话没注册」改准了）：`harness.handle('wf.x', ...)` 只做一件事 —— 把处理函数塞进 `__DSW_HANDLERS__` 这张表；通道那一侧拿的是这张表本身的引用、每次请求现查（`src/host/rpcChannel.js` 里 `const handlers = deps.handlers` 与请求时的 `handlers.get(endpoint)`），而通道注册本身也是在动态 import 之后才做的。所以真实的约束只有「第一个请求到达之前注册完」，晚一点不会丢电话。留在入口的理由是：端点表与各处理函数在同一个作用域里最容易一眼看全；宿主层又禁止静态 import（D7），把注册搬进别的文件就得再造一套「注册回调」的穿线，得不偿失。

2. **单一持有的状态**：`ghPath` / `ghLastError` / `repoKeys` / `repoRoots` / `snapshotByRoot` / `chainByKey` / `lastProbeAtByRepo` / `lastIssueIndexByRepo`。入口外的代码要用只能走显式存取器（把 `function () { return ghPath }` 这种取值函数传进去），不能各存一份，否则「谁在什么时候改的」就说不清。

3. **同步可用的纯函数**：`upcaseState` / `upcaseSnapStates` / `issueIndexFromSnapshot` / `issueIndexChanged` / `rememberIssueIndex` / `isRateLimitError` / `parseGithubRepo`。它们被同步上下文（分组、探测取值、同刻写表）直接调用，道理同第 1 条：只能留在入口，或作为参数传给别的文件（代码里的「留守」就是这个意思）。

4. **惰性加载器与机械委托**：`_xxx()` 这种「第一次用到才 import」的加载器，和一行一个的委托函数。搬走要把几十个依赖项再穿一遍，收益是零、风险不小，留在原地。

## 1. 启动门：subprocess / timer 晚到时怎么办

框架给的 `subprocess` 与 `timer` 可能晚到。旧写法是「不齐就 return」，后果是 wiring 与工具注册 hook 从来没跑起来、deck 工具永不注册还查无对证；现在的写法是先试一次（`bootBody()`），不齐就挂到框架依赖门上等人齐（`ctx.inject(['subprocess', 'timer'], bootOnce)`），并在 30 秒后落一条 warn 说明「宿主启动被推迟」。

这一段只有启动门本身能留在这里（它决定后面所有装配跑不跑），所以文件里的原注释合并成了一行，末尾加一句指向本节。

## 2. H1 #445：bundled provider、平台通道、仓库键

这一票把三块搬出入口：bundled provider 与技能名单进 `bootstrap.js`，注册表 / 平台 / 探测进 `platformChannel.js`，仓库键 / 仓库根 / 缓存目录进 `repoKeys.js`。入口只留加载器（`_boot()` / `_plat()` / `_repo()`）与一行一个的委托。原注释原文：

~~~text
// H1 #445：原 31–215 行（bundled provider）已搬到 ./bootstrap.js，下见动态接线。
// B3 rpc host 侧 shim：harness.handle('wf.x') → 本 Map；对外分发见文件末尾的
// connection.fetch.register('/api/dsws') 注册段（#596 由 connection.rpc.handle 换过来）。
// 方案 C 原样复制后 pkg 入口不再经 build.mjs 注入 shim，改为源文件自带，避免 ReferenceError: harness is not defined
~~~

## 3. H2 #446：正文解析、票列表与索引、单票详情

搬走的是地图 / 票正文解析（`mapBody.js`）、列表与索引（`issueList.js`）、单票详情（`issueDetail.js`）；#599 起快照组装进 `snapshotBuild.js`，两边共享的东西由入口组合后传进去 —— 同层互引门禁不许两个干活的文件互相引用，所以组合点落在入口。原注释原文：

~~~text
// ---- H2 #446 委托：原函数名与签名不变，外部调用方零改动 ----
~~~

## 4. H3 #447：远程谓词、技能探测、探测编排

三块分别进 `remotePredicates.js`、`skillProbe.js`、`detectChain.js`；对外仍是 `wf.detect` 与 `wf.chain` 两条电话。原注释原文：

~~~text
// ---- H3 #447 委托：原函数名与签名不变，外部调用方零改动 ----
~~~

同一票在文件里留过四个「见上接线区」的占位，它们只说「实现不在这一段」，没有别的信息。原文照存：

~~~text
// H3 #447 留守：见上接线区。

// H3 #447：见上接线区（原本地图谱谓词）。

// H3 #447：见上接线区（原技能探测通道）。

// H3 #447：见上接线区（原探测编排处理器）。
~~~

## 5. H4 #448：会话生命周期、快照、地图子票、刷新

四块分别进 `sessionLifecycle.js`、`sessionSnapshot.js`、`mapTickets.js`（#691 地图子票按需取）、`sessionRefresh.js`；入口留 `wf.cwd` / `wf.snapshot` / `wf.mapTickets` / `wf.refresh` 四条注册。原注释原文：

~~~text
// ---- H4 #448 委托：电话名与签名不变，外部调用方零改动 ----
~~~

## 6. H5 #449：工作区、评论、历史票翻页

三块分别进 `workspaceCwd.js`、`commentThreads.js`、`issuePage.js`（#690 历史票按页取）。原注释原文：

~~~text
// ---- H5 #449 委托：原函数名与签名不变，外部调用方（含 H6 认领/交接）零改动 ----
~~~

## 7. H6 #450：认领交接、命名守护、发布、目录选择、分组纯函数

五块分别进 `handoffClaim.js`、`namingGuardian.js`、`publishFlow.js`、`pickerShell.js`、`ticketGrouping.js`（最后一件是压线追加：分组纯函数搬出去，H2 / H4 的加载器取值后转供给）。另有 H7 #515：分发异常行的归类进 `dispatchMeta.js`。

## 8. 定时纪律：#348 Q3 的轮询关闭与 #709（T5）的命名守护改事件驱动

这里记的是「哪些定时器不在、为什么不在了」——查「宿主为什么不自个儿刷新」时先看这一段。原注释原文：

~~~text
// 轮询已按 #348 Q3 关闭（60s 全量贴配额上限）：纯手动刷新 + 打开面板即刷，自动待 P1 再议。
// #709（T5）：命名守护改事件驱动——从前这里启动的 15 秒自续 tick 已整体退役。现在启动动作
//   只做一次性铺垫（预热跟踪态、把可能已经攒下的脏账落盘），此后每一跳都由事件带起来：
//   `gh issue create` 被拦截、新会话注册、认领推送，以及客户端那四种事件顺带上报的兜底（10 分钟至多一次，每次只轮转扫一个仓库）。
//   宿主侧没有任何自续定时器（T5 起这条纪律由门禁守着）。
~~~

配套门禁：`tests/verify-709-no-self-continuing-timers.js` 扫全库，宿主侧出现自续定时器就红。

## 9. 分组与文件对照表

| 分组（票） | 搬去的文件 |
|---|---|
| H1 #445 | `bootstrap.js`（bundled provider、技能名单）、`platformChannel.js`（注册表 / 平台 / 探测）、`repoKeys.js`（仓库键 / 根 / 缓存目录） |
| H2 #446 | `mapBody.js`、`issueList.js`、`issueDetail.js`、`snapshotBuild.js`（#599） |
| H3 #447 | `remotePredicates.js`、`skillProbe.js`、`detectChain.js` |
| H4 #448 | `sessionLifecycle.js`、`sessionSnapshot.js`、`mapTickets.js`（#691）、`sessionRefresh.js` |
| H5 #449 | `workspaceCwd.js`、`commentThreads.js`、`issuePage.js`（#690） |
| H6 #450 | `handoffClaim.js`、`namingGuardian.js`、`publishFlow.js`、`pickerShell.js`、`ticketGrouping.js` |
| H7 #515 | `dispatchMeta.js` |
| #723（T19） | `refresh/wiring.js`（闸 + 账本 + 写事件订阅 + 视野模型 + 会话↔票处理链），`refresh/chainBackoff.js`（#709） |
| #490 / #586 / #875 | `logFromPackage.js`、`updateFromPackage.js`（#875 起更新只走已安装包，无回退分支；旧实现已删） |
| #596 | `rpcChannel.js`（把端点表交给 `/api/dsws` 通道） |
| #817 | `versionControl.js`（三条只读电话 `wf.gitStatus` / `wf.gitDiff` / `wf.gitLog`，地图 #810） |

RPC 通道与日志口另有两段历史叙述留在入口的合并注释里（`_rpcChannel` 与 `_log` 处），因为它们的执行路径就在入口文件里。

入口另有**三处直接动态 import**，不属于任何搬迁分组（它们不是「从入口搬走的块」，只是一次性取用）：`tracker/backends/github/client.js`（取超时常量）、`snapshotEnvelope.js`（快照信封）、`platform/deckExec.js`（deck 工具代执行）。本表只登「搬走的块」，这三处不列。

