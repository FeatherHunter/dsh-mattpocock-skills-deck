# markdown 后端的面板看不到子 ISSUE、还提示「取数太慢」：按需读子票与 30 秒耐心的只读取证（2026-11-03）

这份调查只读代码、日志和磁盘上的工作区文件，不改业务代码，也不开始修复。要回答的是报告人在 2026-11-03 03:10–03:13 看到的现象：本地 Markdown 工作区 `D:\dsh-plugin\featherhunter-plugin-manage` 的 `.scratch/evidence-obligation` 这个目录，右侧面板显示不到子 ISSUE，并且提示取数太慢；报告人的判断是「md 后端应该百分百拿到，不该像 GitHub 那样出现取数失败」。

**一句话结论：** 这一次不是 md 后端「取不到」子票——同一时段 `wf.mapTickets` 用 6.7 秒成功返回、`wf.snapshot` 也在 24 秒后建出了包含这 3 张新票的快照（`issues` 从 2 涨到 5、`open` 从 1 涨到 4）；真正发生的是「面板上那份快照还是建票之前的旧数据」加上「新快照从请求到送达用了 38 秒，超过界面 30 秒的耐心」，于是界面停在旧快照并显示「取数较慢，仍在等待」。子票已经在 03:13:02 的迟到快照里落地，但用户看到的窗口正好卡在落地之前。

## 0. 取证方式

读源码（行号按当前工作树 HEAD 1f710162）、读今天整份诊断日志 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-11-03.log`（57 MB，02:59:59 前一天起至 03:31:44）、读磁盘上的工作区与一份 01:44 写下的快照缓存文件、查 git log 与提交祖先关系。没有启动 DSH、没有复现界面、没有跑构建与测试；凡是推断而非直接观测到的地方都写明「待确认」。

日志里同一个工作区有三种散列写法，对号时容易看错，先列出来（hash8 是 djb2 算法，我按路径复算过，见附录）：`cwdHash=959b00dd` 是 `d:\dsh-plugin\featherhunter-plugin-manage`（反斜杠小写），`cwdHash=2e9460bd` 是同一路径的原样大小写，`keyHash=881dfae3` 是 `d:/dsh-plugin/featherhunter-plugin-manage`（正斜杠小写）。本仓（dsh-mattpocock-skills-deck）对应 `8bb305ba`（反斜杠小写）与 `d11bd700`（正斜杠小写）。

## 1. 先看既有笔记：哪几份还适用

- `research/1009-recheck-2026-10-21.md`（#1009 复核，30 秒等待与迟到快照）：**机制仍然适用**，但它记的源码路径已经搬家。它写的 `src/client/kernel/probe-select.ts` 现在在 `src/refresh/rooms/client/probe-scope-selection.ts`，它写的提示行 `truthLines.ts:101-103` 现在是 `:273-274`；30 秒死线也搬到了 `src/refresh/rooms/client/snapshot-sync.ts:222-225`。它统计的「迟到快照整份落地、旧不盖新」结论与今天日志里的 `snapshot.late.install installed=true` 对得上。
- `research/1537-blocked-ref-title-missing-2026-10-26.md`（#1537，md 后端详情读不回填 blockedBy 引用的标题）：**不适用**。它说的是单张票详情的引用标题缺口，与「子票清单为空」不是同一条路；但它提醒的一件事今天仍然成立：md 后端的 list 与 get 两条路读同一批文件，口径会漂。
- `research/569-subissue-wiring.md`、`research/677-field-consumption.md`（#1431 时代引用）：**没有直接沿用**，它们描述的是更早的子票接线与字段消费，本次结论以当前树的代码与今天的日志为准。
- `research/1833-list-head-and-truth-row-2026-11-03.md`：同一天的分诊笔记，讲的是列表上方那条状态行（`div.dsws-truth`）。「取数较慢」这句提示就长在那条行的最前面，机制描述可互相参照。

## 2. md 后端怎么把 spec.md 与 issues/*.md 读成「容器行」与「子票」

先把两个词说清楚。**容器行**指一个工作单元（`.scratch` 下的一个目录）自己的那一行，代表一张规格或一张探索地图；**子票行**指 `issues/` 目录下的票文件读出来的行。面板的「子 ISSUE」区画的就是容器行下面挂的那批子票。

### 2.1 磁盘上的文件怎么变成行

md 后端列举时按「工作单元」走：一个目录只要有 `map.md`、`spec.md` 或 `issues/` 三者之一，就算一个工作单元（`src/tracker/rooms/markdown/issues-read.ts:185` 起，发现逻辑在同文件的 `listWorkUnits`）。每个单元里：

- 有 `map.md` 就读成地图容器行，有 `spec.md` 就读成规格容器行，两者都固定是 `key: '00'`、`parentKey: null`，`effortId` 取目录名（地图行 `issues-read.ts:121`；规格行 `:144-151`，其中 `:146` 就是 `{ key: '00', parentKey: null, isMap: false, effortId, route: 'spec' }`）。
- 然后进 `issues/` 目录，把每个「编号 + 短横线开头」的 `.md` 读成一行；这个单元**有容器**时，子票行的 `parentKey` 统一给 `'00'`，没有容器（只有 issues 目录的普通票目录）时给 `null`（`issues-read.ts:162-180`，`:178` 调 `pushTicketRow(tf.path, key, effortId, parentKey, route)`）。`key` 是两位编号（`:173` 的 `ticketKey`）。
- 票面自己的 `<!-- DSH-PARENT: 00 -->` 与目录归属在 `loadIssueFromFile` 里合成同一个 `parentKey`（文件头注释 `src/tracker/rooms/markdown/sub-issues.ts:8-13` 说明了「新旧布局合成同一个 parentKey」这条约定）；子票的状态由票面 `**Status:**` 行归一，`ready-for-agent`、`claimed` 这类都算 open（`src/tracker/rooms/markdown/status.ts:122-127`）。

### 2.2 首屏只取「开放」的行，所以闭着的子票要靠工作集补

首屏那条 `wf.snapshot` 现在只向 md 后端要开放行：`src/host/tracker/snapshot.ts:312` 是 `const res = await tracker.list(ref, { state: 'open' }, ctx)`。只取开放行以后，一个**开放容器下已关闭的子票**就不会出现在这一趟列表里——这正是 #1796 与 #1826 要处理的缺口。

补法是「工作集」：组装前先筛出开放的容器行（`src/host/tracker/snapshotWorkingSet.ts:210`，条件是 `type === 'map' || type === 'spec'` 且没关闭），对每个容器再问一次子票清单（`:211` 先看后端有没有 `listSubIssues`，`:221-223` 把工作单元放进 `effortId` 再调 `tracker.listSubIssues(scopedRef, containerKey, {}, ctx)`），把结果逐张并回池里（`:236-240`，合并规则在同文件 `:120-141`：缺 parentKey 就填容器的、缺 effortId 就填容器的，按 (effortId, key) 去重）。后端的 md 实现就是 `src/tracker/rooms/markdown/sub-issues.ts`：

- `:77` 导出 `listSubIssues(ctx, repo, containerKey, opts)`；`:79-84` 把容器编号归一成两位（`'00'`），不是数字就判 `PARSE` 错并记 `listSubIssues:bad-key`；
- `:90` 先按 `keys: ['00']` 枚举一遍找容器行，`:91` 只认 `isContainerRow(row) && String(row.key) === '00'`（`:39-41` 的容器判据是 `type` 为 SPEC 或 MAP）；
- `:92-95` 没找到就 `listSubIssues:notfound`；`:96-108` 一个容器编号可能对应多个工作单元，多于一个就 `listSubIssues:ambiguous`，拒绝猜；
- `:111` 再全量枚举一遍，`:112-116` 只要有任何读不动的票就整条失败（`listSubIssues:read-fail`），理由写在注释里：宁可失败也不回一份缺行的清单；
- `:117-121` 筛 `row.parentKey === '00'` 且不是容器行，按编号升序回 `{ items, total, fetched, capped: false, missing: 0, dropped: 0 }`。

**#1826 的修复就是这一整份文件**：在它之前，md 房间没有 `listSubIssues`，工作集那一步的 `canFetch` 为假（`snapshotWorkingSet.ts:211`），于是「开放容器下的已关闭子票」既不在这趟开放列表里、也不会被补回来，面板上的子票只剩开着的那些，进度环的分母也跟着偏小（这与 #1826 票面描述一致）。修复由 `fd78434b`（2026-11-02 21:51:28）与 `3319f08b`（2026-11-02 22:05:27）两笔组成，`git log -- src/tracker/rooms/markdown/sub-issues.ts` 只有这两笔。

### 2.3 这对本次现象意味着什么

本次报告涉及的三张子票（`01-判定闭环…`、`02-人读证据卡…`、`03-过渡策略…`）在磁盘上都是 `**Status:** ready-for-agent`，按 `status.ts:122-127` 归一为 open，磁盘修改时间分别是 03:10:56 / 03:11:03 / 03:11:10。**开放子票不需要 #1826 也能挂上**：它们本来就在 `list({state:'open'})` 的结果里，组装时按 (effortId, parentKey) 配对（`src/host/tracker/snapshotAssemble.ts:132-170`，配对键在 `:143` 的 `byParent.get(idOfParts(effortOf(m), m.key))`）。

所以「看不到子 ISSUE」不能由「beta.34 缺 #1826」解释；缺 #1826 只会让**已关闭**的子票看不见。这也和磁盘证据对得上：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\FeatherHunter__featherhunter-plugin-manage.json`（315,263 字节，2026-11-03 01:44:35 写入）里，容器 `00` 下挂着 8 张子票，其中 7 张是 CLOSED——那是另一个更早的进程留下的快照，至少说明 md 房的挂载在更早的时候就成功过。

## 3. 面板这边怎么取子 ISSUE，「取数较慢」又是怎么来的

面板上有两条取数路，别混在一起：

1. **首屏快照**（`wf.snapshot`）：`src/host/tracker/snapshot.ts:312` 取开放行 → `:327` 先粗装一遍 → `:329-337` 走工作集补子票 → `:341-354` 记一行 `snapshot.workingSet` → `:361-365` 正式组装 + 上一份快照的补回（`carryOverMapTickets`）→ `:374` 问后端要计数 → `:378-396` 算出 `deck.counts / partial / missingOpen`。面板上「SUB ISSUE」区画的就是这份快照里容器行的 `tickets`。
2. **详情页按需取一张地图的子票**（`wf.mapTickets`）：客户端 `src/client/kernel/api-io.ts:449-504` 的 `fetchMapTickets(st, n, opts)`，桶键是 `idOfParts(effortId, mKey)`（`:455-456`），成功时把 `{mode:'real', items, stats, total, fetched, capped, missing}` 写进 `st.mapTickets[bucketKey]`（`:475-485`），失败写 `mode:'err'`（`:491/:497`）。页面读同一个桶：`src/client/views/mapDetailV2/wiring/useMapTicketsFeed.ts:23-45`。这条路的失败不会让首屏消失，它只在详情页那块提示。宿主侧实现在 `src/host/mapTickets.ts:168-217`：没有 cwd 直接失败、非 GitHub 且不是组合选择就 `unsupported`、后端没有 `listSubIssues` 也 `unsupported`、其余才真的去调（`:203`），成功后逐行 `prepareRow` 再分组（`:214-217`）。

**30 秒死线**：客户端在 `src/refresh/rooms/client/snapshot-sync.ts:222-225` 起一个 30 秒计时器，到点就 abort 并抛 `client loadSnapshot timeout 30s`；值来自 `config/ttl.yaml:94` 的 `snapWaitMs: 30000`（同一份值也写在 `src/shared/time-config/src/values.ts:197`，注释说「只留一条界面耐心 30 秒」，:61-66）。超时分支在 `:295-319`：标记这次请求已经放弃（`:296`）、记一条 `host.call.fail`（`:297`）、**只有错误原文包含那句 timeout 时**才把 `st.snapPending` 置真（`:307`），然后 `st.snapMode='err'` 并写下 `snapError`（`:317-318`）。

**提示的显示条件**：`src/client/views/shared/truthLines.ts:273-274` —— `snapMode === 'err' && snapError && snapPending === true` 时返回一条 `truth.pendingLate`（黄色、pending 类）。文案现在住在 `config/copy/pages.yaml:35`（中文「取数较慢，仍在等待，拿到后自动更新」）与 `:122`（英文）；任务书给的 `src/client/kernel/locale-data.ts:1308` 是搬家之前的旧位置，按 ADR 20261020-ui-copy-data-driven，现行真源是 YAML，`locale-data.ts` 里已经没有这条（在 src 下检索这句中文只有 pages.yaml 命中）。

**迟到快照**：放弃之后并不是白等。晚到的响应会走 `src/refresh/rooms/client/probe-scope-selection.ts:279-321` 的 `_installLateSnapshot`：要求这次请求确实放弃过、没被取消、工作区没换走，再比 `generatedMs`（`:295-309`，最新者胜），通过就整份装进状态（`:313` 调 `_snapInstallBody`，`:216-268`）。装完会把 `snapMode` 改回 `'real'`、`snapError` 清空（`:235-236`），于是「取数较慢」那句自动消失。装与不装都记一条 `snapshot.late.install`，只有 `keyHash` 与 `installed` 两个字段（`:300/:305/:319`）。

**附带发现（与本案现象不同，但会加重「数据不完整」的观感）**：这个工作区的每一次快照都带着 `partial: true`。原因是口径不一致——`planDeckCounts` 判断 partial 时会拿「快照里 state 不是 CLOSED 的行数」跟「后端的 open 计数」比（`src/tracker/deck-counts.ts:114`，行数由 `:137-153` 的 `openRowsOf` 数，**包含容器行**），而 md 后端的计数明确把容器行排除在外（`src/tracker/rooms/markdown/counts.ts:91`：`if (!row || row.type === ISSUE_TYPE.MAP || row.type === ISSUE_TYPE.SPEC) continue`）。只要有一个开放容器，快照的开放行数就比后端 open 多 1，`missingOpen` 仍是 0（`snapshot.ts:396` 用减法并取非负），`partial` 却永远为真。今天 87 条 `snapshot.built` 里 featherhunter 那几组全是 `partial=true`，01:44 那份磁盘快照也把 `conflictWith` 一起写了下来，可以作为旁证。#1826 修的是分母，这一条是不是同一张票覆盖的范围，待确认。

## 4. 今日日志：03:10–03:13 到底发生了什么

时间都是本地 +0800，事件名与字段直接来自日志（字段在 `fields` 下，这里只摘相关项）。

| 时间 | 事件 | 关键字段 |
| --- | --- | --- |
| 03:10:05.519 | `snapshot.request` | `cwdHash=959b00dd backend=markdown force=false` |
| 03:10:09.547 | `snapshot.built` | `maps=1 specs=1 issues=2 open=1 closed=84 partial=true missingOpen=0` |
| 03:10:12.411 | `host.call` | `wf.snapshot latencyMs=4714 ok=true` —— 这一份在 30 秒内送达，是子票文件出现**之前**的最后一份 |
| 03:10:56 / 03:11:03 / 03:11:10 | （磁盘） | 三张子票文件写出（`evidence-obligation/issues/01、02、03`） |
| 03:12:02.904 | `snapshot.request` | `cwdHash=959b00dd backend=markdown` |
| 03:12:27.068 | `snapshot.built` | `maps=1 specs=1 issues=5 open=4 closed=84 partial=true missingOpen=0` —— 2 涨到 5、1 涨到 4，正是新增的三张票 |
| 03:12:40.322 | `host.call` | `wf.mapTickets cwdHash=959b00dd latencyMs=6729 ok=true opId=mvzmysl6-1` —— 详情页那条路成功 |
| 03:12:41.271 | `host.call` | `wf.snapshot latencyMs=26893 ok=true traceId=54ba254ca4a3008d` —— 响应在请求后 38.4 秒才到 |
| 03:12:41.271 | `snapshot.stale.drop` | `keyHash=881dfae3` —— 已过 30 秒耐心（请求 + 30 秒 = 03:12:32.9），这份被当成过期回包丢掉 |
| 03:12:41.271 | `host.call.fail` | `wf.refresh errorHash=246ae7f1` —— 246ae7f1 就是那句 `client loadSnapshot timeout 30s` 的散列 |
| 03:12:48.665 / .672 | `host.call.fail` | `wf.snapshot errorHash=246ae7f1`（两条，同一 trace） |
| 03:13:01.601 | `snapshot.built` | 同形：`maps=1 specs=1 issues=5 open=4 partial=true` —— 第二次建好 |
| 03:13:02.876 / .877 | `snapshot.late.install` | `keyHash=881dfae3 installed=true`（两条，trace 54ba254c 与 c8a2ffe8）—— 迟到快照整份落地 |

把这三段连起来看：

1. **03:10:09 那一份快照里根本没有子票**（`issues=2` 是「1 个容器行 + 1 张别的开放票」）。它 4 秒就建好、4.7 秒送达，是 03:10–03:12 面板上唯一有效的数据。三张子票是 03:10:56 之后才写出来的，所以在那之前面板老老实实是空的——**这不是缺陷，是数据还没产生**。
2. **第一份包含子票的快照，建了 24 秒、路上又花了 14 秒，总共 38.4 秒**，超过界面 30 秒的耐心，因此被 `stale.drop` 丢掉、同时触发超时分支；界面此时进入 `snapMode='err' + snapPending=true`，于是那句话出现了。
3. **第二份同样的快照在 03:13:01.601 建好，03:13:02.876 作为迟到快照装了进来**（`installed=true`）。按 `_snapInstallBody` 的收尾，这一装完成 `snapMode` 会回到 `real`、`snapError` 清空，提示消失，子票也应该出现。也就是说：**只要用户在这一刻之后看一眼，数据就是有的**。

再看这段时间为什么会慢。03:12:20–03:13:10 这两分钟的日志里，宿主不是「md 这一条路慢」，而是整体堵：`wf.probe` 44 次调用**全部**不短于 2 秒、最长 39.9 秒；`wf.listLabels` 10 次全部不短于 2 秒、最长 29.5 秒；9 条 trace 同时在跑。相比之下 03:10:09 那份同工作区快照只用了 4.0 秒——同样 88 张票文件、同样 17 个工作单元。这组对照说明：**慢的主要变量不是「文件多」，而是那一时段宿主里同时在跑的活太多**（probe、标签、快照、详情各条路挤在一起）。md 房本身的读法也确实偏重（见下一节），但单靠它解释不了 4 秒到 24 秒的差距。

所以第 3 问的判断是：**更像「前端还在等（pending）＋屏幕上画的是建票之前的旧快照」，而不是「快照缺分组」或「详情取数失败」**。详情那条 `wf.mapTickets` 在 03:12:40 是成功的（6.7 秒）；首屏也没有出现 `subIssuesFailed`（`snapshot.workingSet` 一行都没记，见下节；`read.degraded` 里也没有任何 `listSubIssues:*`）。

## 5. md 这一侧为什么本来就容易慢（机制，未逐次计时）

一份 md 快照要把同一批票文件读好几遍：

- 第一遍：`list({state:'open'})` 走 `enumerateIssueRows`，逐个工作单元读 `map.md`/`spec.md`、列 `issues/`、逐张读票（`src/tracker/rooms/markdown/issues-read.ts:62-219`）。
- 第二遍：`counts` 是另一趟同样的枚举，注释写明「枚举那一段与 list 共用同一份实现」（`src/tracker/rooms/markdown/counts.ts:62-74`，`:74` 就是那次 `enumerateIssueRows`）。
- 第三、四遍：`listSubIssues` 自己又是两趟（`sub-issues.ts:90` 找容器行、`:111` 全量取子票）。

而每读一张票，实际至少是两次沙箱文件调用：`src/tracker/rooms/markdown/read.ts:14` 是 `fs.resolve(fullPath)` 再 `fs.readText(t)`；更费的是 **list 这条路把同一张票读了两遍**——`loadIssueFromFile` 读一遍正文，紧接着为了检查 `DSH-FORMAT` 版本号又读一遍原文（`issues-read.ts:132`，容器行同病，见 `:110` 与 `:147`）。按该工作区 88 张票 + 8 份规格 + 17 个单元算，一趟快照的文件往返在千次量级。这个工作区里绝大多数是已关闭的老票，却也每趟都要打开一遍。

这条机制解释「md 后端为什么本来就慢」，但**不能单独解释 03:12 那 24 秒**（同一工作区 03:10 只要 4 秒）。要证实还缺逐次文件调用的耗时记录，日志里没有。

## 6. 版本对齐：#1826 的修复（fd78434b）会不会已经在 03:07 启动的那份构建里

这一节把「能」与「不能」两边的证据都摆出来，不替读者下断言。

### 6.1 倾向「不在」的证据（较强）

1. **日志里一整天没有 `snapshot.workingSet` 这一行**（0 条），而同一条组装路径上的 `snapshot.cache.miss` 有 103 条——说明不是日志通道坏了，而是**运行中的宿主构建里没有那段代码**。`snapshot.workingSet` 这一行是提交 `50f58a6b`（2026-11-02 00:33:43，「面板首屏装齐未关闭票」）才加进去的（`git log -S 'snapshot.workingSet' -- src/host/tracker/snapshot.ts` 只有这一笔）。如果构建停在它之前，自然也在 `fd78434b`（11-02 21:51）之前。
2. **启动时间与版本串对不上修复的日期**：`host.start` 全天只有一条，03:07:09.988，`pluginVersion 1.9.0-beta.34`，pid 42616。而 `1.9.0-beta.34` 这个版本串没有对应的 tag（最新 tag 是 `v1.9.0-beta.33`，2026-11-01 12:21），推版本号的提交 `2068b76b`（11-01 16:36）也不是 `fd78434b` 的祖先（`git merge-base --is-ancestor` 退出码 1）。所以「beta.34」这四个字定位不到任何包含修复的提交。
3. 03:07 启动之后，`package/lib/client.js` 在 03:21:48 与 03:36:56 两次被别的会话重建，`package/lib/*.js` 其余文件在 03:37:06 重建——**启动时加载的那份内容已经被覆盖**，文件时间不再能证明当时装的是什么。

### 6.2 不能排除「在」的残余可能

1. **安装目录是 junction**：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck` 是指向本仓 `package\` 的 ReparsePoint，本仓工作区随时可能被别的会话构建。03:07 那一刻磁盘上到底是哪一版，日志里没有构建哈希或文件指纹可查（`host.start` 只记版本串）。
2. **客户端与宿主是两份产物**：`lib/client.js` 由 WebView 另外加载，浏览器缓存可能让它与宿主不同步；这一点本机无法证伪。
3. **反证材料本身不干净**：桌面安装目录旁边有一份 `.dsh-mattpocock-skills-deck-beta33-backup-20261102-192134`，里面的 `package.json` 也写着 `1.9.0-beta.34`，但 `lib/tracker/snapshot.js` 与当前同哈希、引用了 `snapshotWorkingSet`，却**缺** `lib/tracker/snapshotWorkingSet.js` 与 `tracker/rooms/markdown/sub-issues.js`——这份备份内部不自洽，不能当作 03:07 运行代码的证据。

### 6.3 无论答案如何，都不改变本案结论

因为这次涉及的三张子票是**开放**的，它们在 `list({state:'open'})` 里本来就有，走的是「按 parentKey 配对挂到容器」那条老路，不需要 `listSubIssues`（`snapshotAssemble.ts:143`；对照 `snapshotWorkingSet.ts:210-241` 只对开放容器补子票）。#1826 解决的是「开放容器下已关闭的子票看不到、进度环分母偏小」，与本次「刚建出来的开放子票在旧快照里看不见」不是同一个成因。

## 7. 还没确认的点

1. **03:13:01 那份快照里，三张子票到底挂没挂到容器 `00` 下面**。日志只记 `issues=5 / open=4`（这是「容器 + 子票」的行数与后端计数），不记每张容器的 `tickets` 张数；`wf.mapTickets` 也只记耗时、不记返回几条（`src/host/mapTickets.ts:102-111` 的 `phoneLog` 字段就这些）。要钉死，需要给这两处补一个「张数」字段，或在下一次复现时抓一份快照缓存。
2. **24 秒到底花在哪**。03:12:2x 那一波里 `wf.probe` 全部 ≥2 秒、最长 39.9 秒，说明宿主整体在排队；但日志没有排队时长字段，也没法区分「md 枚举占住主线程」与「别的长任务占住、md 只是排在后面」。三种可能都还开着：md 全量枚举本身、并发请求互相挤、宿主的串行处理。
3. **每次快照都 `partial=true` 是不是已知问题**。按 `deck-counts.ts:114` 与 `counts.ts:91` 的口径，只要有一个开放容器就会假报不完整；#1826 只修了分母，这一条是否被别的票覆盖，没有查到。
4. **30 秒这条耐心对本地后端是否合适**。本地后端理论上「百分百拿得到」，但它比远端更容易被本机并发拖慢；这一次 4 秒与 24 秒的差距说明，慢的时候不是后端的错，而是整机在忙。给 md 单独放宽死线、或把「慢」与「失败」分成两句提示，都是可选方向，本次不展开。

## 附录：复现这次取证的关键命令与数据

- 日志筛选：按 `ts` 落在 03:09–03:21、`fields.keyHash` 或 `fields.cwdHash` 属于 `881dfae3 / 959b00dd / 2e9460bd / d11bd700`，事件取 `snapshot.request / snapshot.built / snapshot.late.install / snapshot.stale.drop / host.call / host.call.fail`。
- 磁盘快照：`FeatherHunter__featherhunter-plugin-manage.json` 顶层 `generatedMs=1793641475111`（= 2026-11-03 01:44:35）、`cacheFormat=4`；`maps` 1 条（`base-package-rollout` 的规格容器 `00`，8 张子票）、`issues` 9 条、`deck.counts {open:1, closed:83, total:84}` 且带 `conflictWith`。
- 工作区实况：`.scratch` 下 17 个工作单元、8 份 `spec.md`（只有 `evidence-obligation` 是 `ready-for-agent`，其余 closed）、0 份 `map.md`、`issues/` 下 88 个 `.md`。
- hash8（djb2）：`h = 5381; h = (h * 33 + code) >>> 0`，对路径取小写、反斜杠或正斜杠，再取 8 位十六进制；上面列的四种散列都是这样复算出来的。
