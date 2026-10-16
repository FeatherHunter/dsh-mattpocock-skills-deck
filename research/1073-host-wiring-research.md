# #1073 地图12引用点收尾 · 现状调研（只给事实，不做决策）

- 调研日期：2026-10-15（Asia/Shanghai）
- 基线 commit：`9b3bd395df924546532168d3fd8c2184e67c4fbb` —— 2026-10-15 14:57:05 +0800 ——「把 #895 的两道门禁从 JS 转成 TypeScript：只改文件名与接线，判据一条没动（#895）」（`git log -1` 实测）。
- 范围：#1074 列出的引用点、#1072 地图状态、#1073 讨论状态、面板与链快照读数、相关约束。结论都有来源，不写推荐方案。

## 1. 票面现状（#1072 / #1073 / #1074）

- #1074（开发票）目的原文：「宿主入口、平台通道、接线、工作区锚、详情、远端谓词六处转 TypeScript 并补日志，同时核对面板与快照读数。边界：只改引用点与读数。做完：没有指向旧路径的活引用，读数一致。」（来源：`gh issue view 1074` 票面正文）
- #1074 正文另有三段：「第 7 件」段称除六件外还要把 `src/host/tracker/detection/detectChain.js` 一起归位；「本票文件清单」段列出 `src/host/index.js`、`platformChannel.js`、`workspaceCwd.js`、`issueDetail.js`、`remotePredicates.js`、`src/host/tracker/detection/detectChain.js`；「更正一条路径」段称第 7 件路径写错，正确路径是 `src/host/detectChain.js`（不是 `src/host/tracker/detection/detectChain.js`），并称它在 `:22` 与 `:224` 两处 import 会被改名或换目录的文件，是链上唯一「不搬家、不在任何票里、却引用两个改名件」的件。（来源：同上）
- #1074 正文还有「动手前先读」段：「本图的结论在两处：讨论票 #1073 的评论与地图 #1072 的 ## Decisions so far。本票边界与讨论结论冲突时，以讨论结论为准，并把冲突写进本票评论。」（来源：同上）
- #1074 评论：截至本次调研 `gh issue view 1074 --comments` 返回空（无评论）。（来源：同命令实测输出）
- #1072（地图）目的/边界/做完标志：「把新树接回宿主与面板，让『搬家』这件事真正收尾」「引用点与展示读数」「全仓没有指向旧路径的活引用（历史文档除外）、面板读数与今天一致」。（来源：`gh issue view 1072` 票面正文）
- #1072 的 `## Decisions so far` 当前写法：「本图结论：暂无，等本图讨论票贴出后写在这里。」加一行对抗式审查定案链接（`research/1010-adversarial-fixes.md`，2026-10-12）。（来源：同上）
- #1072 的 `## Not yet specified` 当前写法：「暂无。本图讨论票贴出后，未定项写在这里。」（来源：同上）
- #1073（讨论票）目的/边界/做完：「把六个引用点与面板读数的收尾做法讲清」「只讨论」「维护者表态，约定写进本票评论」；另有「维护者没回话怎么办」段（48 小时无回复按票面默认方案往下走，结论写进地图 Decisions so far）与「收尾时把结论落在三处」段（本票评论、地图 #1072 的 Decisions so far、受影响的开发票正文或评论）。（来源：`gh issue view 1073` 票面正文）
- #1073 评论：截至本次调研 `gh issue view 1073 --comments` 返回空（无评论），即讨论尚无落定的评论结论。（来源：同命令实测输出）
- #1072 评论：截至本次调研 `gh issue view 1072 --comments` 返回空（Decisions so far 仍是票面那两行）。（来源：同命令实测输出）
- 文件清单口径有一处票面间不一致（只记录，不裁决）：`research/1010-ticket-structure.md:39` 把地图 12 写成「引用点 6 件（`src/host/index.js`、`platformChannel.js`、`refresh/wiring.js`、`workspaceCwd.js`、`issueDetail.js`、`remotePredicates.js`）+ 面板与快照读数」，即第六件是 `refresh/wiring.js`；而 #1074 票面六件＋第 7 件的写法里没有 `refresh/wiring.js`，第 7 件是 `src/host/detectChain.js`（经更正）。（来源：`research/1010-ticket-structure.md:39` 对 `gh issue view 1074` 票面正文）

## 2. 六件＋第 7 件：存在性、扩展名、头部注释

实测（`Get-ChildItem src/host/`＋逐文件 `Test-Path`）：

| 票面所列 | 磁盘现状 | 头部注释说什么 |
|---|---|---|
| `src/host/index.js` | 存在 `.js`（无同名 `.ts`），350 行 | `src/host/index.js:1-5`：「Host 半（数据层实现 · T3 #345）」「这是宿主入口：装配动态加载的各个工作模块与几十条宿主电话」「装配分组的从哪来、为什么留在这里、搬走的实现去了哪见 `docs/design/837-host-index-wiring-ledger.md`」 |
| `src/host/platformChannel.js` | 已是 `.ts`（`platformChannel.ts` 存在，同名 `.js` 不存在） | `src/host/platformChannel.ts:1-7`：「平台与探测通道（H1 #445 从 host/index.js 259–491 搬出，纯结构、行为零变化）」「2026-10-14（#1161）从 `.js` 转成 `.ts`：只加类型标注与注释，逻辑一行未动」「以后谁改它：改平台抽象、后端注册表或探测级联的人」「接线：由 index.js 动态 import 动态加载」；`:6-7` 记装配点改为 `src/tracker/registry/builtins.ts`（规则 `rooms-imported-only-by-assembly`） |
| `src/host/workspaceCwd.js` | 仍是 `.js`（无同名 `.ts`），文件头自述贴着 350 行上限（见 `src/host/workspaceLabelColors.js:3` 转述） | `src/host/workspaceCwd.js:1-3`：「工作区归一、绑定选择与工作区配置文件落盘（H5 #449 从 host/index.js 302–388 搬出电话体，纯结构、行为零变化；#957 起标签配色两条电话搬到 `./workspaceLabelColors.js`）」「接线：由 index.js 动态 import 加载」 |
| `src/host/issueDetail.js` | 已是 `.ts`（`issueDetail.ts` 存在，同名 `.js` 不存在） | `src/host/issueDetail.ts:1-9`：「单详情与快照拼装（H2 #446 从 host/index.js 546–840 搬出）」「2026-10-14（#1161）从 `.js` 转成 `.ts`」「#1161 起宿主不许直接深引房间实现（规则 `rooms-imported-only-by-assembly`），改经装配点取」「#1170 起装配点自己取出这几件交给宿主（`builtins.ts` 的 `loadGithubHostExtras`）」 |
| `src/host/remotePredicates.js` | 已是 `.ts`（`remotePredicates.ts` 存在，同名 `.js` 不存在） | `src/host/remotePredicates.ts:1-4`：「H3 #447 从 host/index.js 242-309 搬出」「2026-10-14（#1161）从 `.js` 转成 `.ts`」「接线：由 index.js 动态 import 加载；本文件除装配点（`src/tracker/registry/builtins.ts`）外不引其他新文件」 |
| 第 7 件 `src/host/detectChain.js` | 已是 `.ts`（`detectChain.ts` 存在，同名 `.js` 不存在；`src/host/tracker/detection/detectChain.js` 不存在） | `src/host/detectChain.ts:1-3` 首行仍写 `// src/host/detectChain.js —— H3 #447 从 host/index.js 639-884 搬出`（文件名还是旧 `.js`，内容已是 `.ts`，属于头部自述名未随改名更新）；`:3`：「接线：由 index.js 动态 import 加载；harness 注册留守 index，处理器体经 handleDetect/handleChain 供给」 |

- 迁移映射登记：`research/1010-migration-map.json:742-767` 登记四件 `stay-ext-change`（`platformChannel.js→.ts`、`workspaceCwd.js→.ts`、`issueDetail.js→.ts`、`remotePredicates.js→.ts`）；`:933-934` 登记 `src/host/detectChain.js → src/host/detectChain.ts`。（来源：该 JSON 对应行）
- 棘轮名单现状：`tests/handwritten-js-baseline.json:184` 仍列 `src/host/index.js`，`:226` 仍列 `src/host/workspaceCwd.js`（即这两件仍被计为手写 JS 存量；已转的三件不在该名单里）。（来源：该 JSON 对应行）
- 类型检查缺口背景（只记录 research 已有结论）：`research/1013-src-host-type-config.md:31` 列 13 份缺口清单含 `src/host/detectChain.ts` 等；`research/1048-red-baseline-audit.md:37` 称 `src/host` 下 13 份 `.ts` 没有任何配置检查。（来源：该两份 research 对应行）

## 3. 活引用核查（排除 research/、docs/ 历史记录）

### 3.1 入口对六件的引用（仍是 `.js` 后缀写法，靠装载钩子解析到 `.ts`）

`src/host/index.js` 内仍用 `.js` 说明符动态引用已转 `.ts` 的文件（来源：该文件对应行）：

- `:68`：`await import('./platformChannel.js')`
- `:102`：`await import('./snapshotBuild.js')`（快照组装；`snapshotBuild.ts` 存在，同名 `.js` 不存在）
- `:103`：`await import('./issueDetail.js')`
- `:128`：`import('./remotePredicates.js')`
- `:137`：`await import('./detectChain.js')`
- `:212`：`await import('./sessionSnapshot.js')`（`sessionSnapshot.ts` 存在，同名 `.js` 不存在）
- `:262`：`await import('./workspaceCwd.js')`
- `:93`：`import('./refresh/wiring.js')`（刷新接线，常驻 `.js`）

- 这套写法能跑通的机制：`scripts/ts-hook.mjs`（磁盘存在，已验证 `Test-Path` 为真）把「引用仍写 `./x.js`、同目录有同名 `.ts`」的说明符改指 `.ts`；同名 `.ts` 不存在时原样交回 Node。`npm test`／`npm run verify:parallel`／`node scripts/verify-all.mjs` 三个入口都会自动挂钩子。（来源：`AGENTS.md`「测试怎么直接加载 .ts」一节；`scripts/ts-hook.mjs` 存在性实测）
- 电话注册仍在入口：`src/host/index.js:206` 注册 `wf.detect`／`wf.chain`（经 `_detectChain()` 进同一编排）；`:101` 注释写明快照组装与单票详情的组合点落在入口（同层互引门禁不许两个干活文件互引）。（来源：该文件对应行）

### 3.2 “旧目录路径”（`src/host/tracker/**` 等搬家前路径）是否还有活 import

- `tracker/detection/detectChain` 全仓零命中：`grep "tracker/detection/detectChain" -- D:\dsh-plugin\dsh-mattpocock-skills-deck` 返回 `No matches found`（即 #1074 更正前的错误路径已无任何引用，连注释都没有）。（来源：该 grep 实测）
- `src/host/tracker/` 目录今天仍然存在，内有 `capability.js`、`generic.js`、`predicateCore.js`、`predicatePrimitives.js`、`snapshot.js`（`Get-ChildItem src/host/tracker` 实测）。`src/tracker/index.ts:12-19` 注释写明「快照组装那几件留在 `src/host/tracker/` 没搬，今天仍是手写 `.js`」；`:27、:29` 把 `../host/tracker/capability.js` 与 `../host/tracker/snapshot.js` 再导出（即仍是活的再导出边，不是历史记录）。（来源：该目录实测＋该文件对应行）
- 第 7 件当前 import 的是新路径：`src/host/detectChain.ts:169` 为 `await import('../tracker/detection/preflightScope.js')`，`:379` 为 `await import('../tracker/fix-contract.js')`；类型引用 `:22-23` 指向 `../tracker/detection/preflightScope.js` 与 `../tracker/fix-contract.js`。（来源：该文件对应行）
- 旧路径字样仍以「注释」形式散在源码里（不是可执行引用，改 import 时顺手改的对象；`research/1010-deck-blast-radius.md:91` 原话也是这么归类的）：例如 `src/host/detectChain.ts:18` 注释提到 `src/host/tracker/predicatePrimitives.js`，`:164` 注释提到 `src/host/tracker/detection/preflightScope.js`；`src/shared/refresh-workspace-key.js:10` 注释提到 `src/host/detectChain.js`；`src/host/refresh/chainBackoff.js:76`、`src/client/statusbar/bannerChain.js:6`、`src/client/kernel/api-io.ts:189` 等注释提到 `src/host/detectChain.js`／`src/host/issueDetail.js` 等旧扩展名。（来源：`grep "host/index\.js|host/platformChannel\.js|…"` 全仓 69 命中清单，详见第 5 节证据包说明）
- 历史成因（research 已有结论，不复核只引用）：`research/1010-adversarial-coverage.md:11` 称调用链上有 `src/host/detectChain.js` 这种「不搬家、不在任何清单里、却 import 两个会被改名的文件」的件；`:156-158` 点名它的 `:22` 与 `:224` 两处 import；`research/1010-deck-blast-radius.md:67-74` 列出 `platformChannel.js` 9 条、`issueDetail.js` 1 条、`remotePredicates.js` 1 条、`workspaceCwd.js` 1 条、`detectChain.js` 1 条旧引用；`research/1010-migration-map.md:73-76` 同口径复述。（来源：各 research 对应行）

## 4. 面板读数：快照与链当前读哪份数据、CONTEXT 定义

- CONTEXT 定义（唯一口径）：`CONTEXT.md:69` 把「工作区共享数据」定义为宿主按工作区键求值、多会话共用一份的数据，含面板快照、后端选择集、仓库信息、后端模块与链快照；`:71` 定义「面板快照」为按工作区键缓存的面板主数据；`:72` 定义「链快照」为环境检查链的结果（全链＋后端链），按「工作区键＋后端 id」共享。（来源：`CONTEXT.md:69-72`）
- 面板快照组装：`src/host/snapshotBuild.ts:207` 的 `buildSnapshot(cwd, hintBackendId)` 负责「按工作区组装整份快照」（该文件 `:1-8` 自述：拉地图详情与子票、拼 maps/issues/labels、报选择与仓库身份；从 `issueDetail.js` 拆出是因为 350 行门禁）。入口经 `_issueSnap()` 组合后调用（`src/host/index.js:102、:120`）。（来源：各文件对应行）
- 面板快照缓存：`src/host/index.js:35` `CACHE_MS = 60000`；`:45-48` `snapshotByRoot` 按工作区根分桶（最多 20 条，LRU）。会话快照电话 `src/host/sessionSnapshot.ts:59` 的 `createSessionSnapshot` 另有一套「早选＋信封＋读写盘缓存」路径（依赖含 `canonicalKey`、`selectEarly`、`envelope`、`chainReadout`、`chainField` 等，见 `:46-55` 类型清单）；`:250、:268` 注释写「统一契约：所有后端均走 composeSnapshot」「GitHub 同样走编排器（经 `registry.get('github').list`），不再直调 buildSnapshot 硬走 gh」。（来源：各文件对应行）
- 处理链读数挂载：`src/host/refresh/sessionChainReadout.js:28` 定义 `SESSION_CHAIN_FIELD = 'sessionTickets'`；`:14-16` 声明不 import 同层 `sessionTickets.js`（同层互引门禁），只要求调用方交入有 `snapshot()` 的对象；`src/host/refresh/wiring.js:8-13` 自述装起来的四件含会话↔票处理链并把界面读数交给快照回包；`src/host/index.js:212` 把 `chainReadout` 与 `chainField` 注入会话快照组装。（来源：各文件对应行）
- 链快照求值：`src/host/detectChain.ts:190` `handleDetect`（探测）、`:208` `handleChain`（通用链＋当前后端链，两段求值拼成一份快照）；`:220` 缓存键为 `cwd + '|' + backendId + '|' + chainLang`；`:219-233` 退避裁决（人亲手 `trigger='user-recheck'` 永不降档；挡下直接回上一份快照并记 `chain.cache.hit`，穿透记 `chain.cache.miss`）；`:157` 在途合并用进程单例 `getChainRide()`；`:176-184` 链求值经闸记账（条数报 0，防与传输层重复计数）。（来源：该文件对应行）
- 日志对照（只记录落点，不评价够不够）：`research/489-appendix.md` 登记 `chain.cache.hit`（落点 `detectChain.js` 的 handleChain）、`chain.cache.miss`（落点 `host/detectChain.js` 链缓存穿透）、`chain.preflight.reuse`（落点 `detectChain.js` 的 handleChain）等；2026-10-14 #1048 起结论线 `detection.detect` 从 `src/host/detectChain.ts` 挪到 `src/tracker/detection/backendDecision.ts`（该附录修订注记）。（来源：该附录对应行；`src/host/detectChain.ts:196-200` 注释同口径复述了迁移）

## 5. 相关约束对这批文件的影响（只转述条文与落点，不推导做法）

- TypeScript 优先（`AGENTS.md:44-51`）：最终手写代码只留 TS；动到的文件「以文件为单位，先修后转、两次提交，不再新增手写 JS」（先一次纯修复，再一次转 TS，转完行为零变化；只转本次真正动到的文件；新增一律 `.ts`）；转完要接构建（登记对应 `tsconfig` 的 `include` 与 `scripts/build.mjs` 清单，`tsc -p`＋构建＋相关 `tests/verify-*` 与冒烟跑通），并清两份棘轮名单（`tests/handwritten-js-baseline.json` 删行；测试文件还要重录 `tests/unmigrated-tests-baseline.json`）；转完要补中文注释（样板 `src/shared/label-color/src/colors.ts`）。——落到本批：已转 4 件（`platformChannel.ts`、`issueDetail.ts`、`remotePredicates.ts`、`detectChain.ts`）与未转 2 件（`index.js`、`workspaceCwd.js`，棘轮名单仍在列，见第 2 节）的区分正好卡在这条「动到哪里转到哪里」上。（来源：`AGENTS.md:44-51` 对第 2 节实测）
- 日志埋点纪律（`AGENTS.md:75` 起 stanza，标题行点名先读总纲票 #502；现行条数以 `research/489-appendix.md` 第 1 章对照表为准；验收分级要求动手前跑通相关 `tests/verify-log-*`，增删事件同步改该附录）：#1074 目的里「并补日志」四字正好落在这条纪律的管辖里；本调研不统计现有日志点数量。（来源：`AGENTS.md` 该节标题行＋`research/489-appendix.md` 第 1 章）
- 房间纪律（`CONTEXT.md:36`）：两条——禁止跨房引用与一次会话只改一房，分别由 `verify-dependency-rules.ts`（判据是依赖图，规则写在根目录 `.dependency-cruiser.cjs`）与 `verify-no-mixed-session` 门禁在 CI 硬卡；房间能引哪些房外目录的唯一真源是 `tests/tracker-room-imports.json`；`src/tracker/rooms/README.md` 只指路；来龙去脉见 `docs/adr/20261014-tracker-room-boundary.md`。——落到本批：三件头部已自述遵守 `rooms-imported-only-by-assembly`（`platformChannel.ts:6-7`、`issueDetail.ts:6-9`、`remotePredicates.ts:40-47`），`detectChain.ts:17-18` 注释解释了谓词上下文类型为何就地声明（同层互引门禁＋`tests/same-layer-baseline.json` 只许减不许增）；`snapshotBuild.ts:10-12` 注释写明组合点放入口的原因（同层互引门禁＋入口 25 条同形先例）。`.dependency-cruiser.cjs` 与 `tests/tracker-room-imports.json` 经 `Test-Path` 确认存在。（来源：`CONTEXT.md:36`、各文件头对应行、`docs/adr/20261014-tracker-room-boundary.md:62-63` 决定五）
- 文件粒度门禁：`src/host` 单文件 ≤350 行（`snapshotBuild.ts:3` 自述拆分原因；`src/host/refresh/wiring.js:6` 自述单开文件的原因是 `index.js` 贴着 350 行上限；`src/host/index.js:206` 行内注释「本文件已顶 350 行上限」）。——落到本批：这就是 `workspaceCwd.js` 拆出 `workspaceLabelColors.js`（见其头部与 `workspaceLabelColors.js:3`）与快照拆出 `snapshotBuild.ts` 的直接背景。（来源：各文件对应行）
- 提交信息规范与及时提交（`AGENTS.md` 同文件两节）：所有 `git commit` 信息用中文完整句、标题至少 10 字；每个可独立交付模块完即提交推送；只用不丢文件不改写历史的命令。（来源：`AGENTS.md` 对应两节）

## 6. 给 grilling 讨论的事实基线一览（不写结论）

1. 六件中四件已是 `.ts`（`platformChannel`、`issueDetail`、`remotePredicates`、`detectChain`，其中三件头部自述 2026-10-14 #1161 只加类型与注释；`detectChain` 头部首行仍写旧 `.js` 名），两件仍是 `.js`（`index`、`workspaceCwd`，棘轮名单仍在列）。
2. #1074 更正前的错误路径 `src/host/tracker/detection/detectChain.js` 全仓零命中；正确路径 `src/host/detectChain.ts` 存在且正被入口 `:137` 动态引用（写法仍是 `./detectChain.js`，靠 `ts-hook` 解析）。
3. 入口对已转 `.ts` 文件的引用写法全部仍是 `.js` 说明符（`:68、:102-103、:128、:137、:212`），与「清零口径是手写 `.js` 归零」的条文之间是什么关系，票面没有写。
4. 地图 #1072 的 Decisions so far 与 Not yet specified 都是「暂无」；#1073 讨论评论数为零；#1074 评论数为零；#1074 要求动手前以讨论结论为准，而讨论结论目前不存在。
5. 面板快照与链快照的 CONTEXT 定义（`:71-72`）与当前组装落点（`snapshotBuild.ts:207`、`sessionSnapshot.ts:59`、`detectChain.ts:190、:208`）如第 4 节所列；「读数一致」的比对判据票面没有写。
6. 地图 12 的文件清单在 `research/1010-ticket-structure.md:39`（含 `refresh/wiring.js`）与 #1074 票面（含 `detectChain`、无 `wiring.js`）之间不一致，#1074 另有「以讨论结论为准」条款。

## 7. 证据包（复核用，不展开）

- 票面：`gh issue view 1072／1073／1074` 正文（第 1 节已逐段引用）；评论三条命令实测皆空。
- 文件头：`src/host/index.js:1-5`、`src/host/platformChannel.ts:1-7`、`src/host/workspaceCwd.js:1-3`、`src/host/issueDetail.ts:1-9`、`src/host/remotePredicates.ts:1-4`、`src/host/detectChain.ts:1-3`。
- 接线：`src/host/index.js:68、93、101-103、128、137、206、212、262`；`src/host/refresh/wiring.js:1-13、20`；`src/host/refresh/sessionChainReadout.js:14-16、28`。
- 快照/链：`src/host/snapshotBuild.ts:1-12、207`；`src/host/sessionSnapshot.ts:46-59、250、268`；`src/host/detectChain.ts:157、169、176-184、190、208-233、379`；`src/host/index.js:35、45-48`；`CONTEXT.md:69-72`。
- 旧引用扫描：`grep "host/index\.js|host/platformChannel\.js|host/workspaceCwd\.js|host/issueDetail\.js|host/remotePredicates\.js|host/tracker/detection/detectChain\.js|host/detectChain\.js" -- src`（69 命中，多为注释提及旧扩展名）；`grep "tracker/detection/detectChain" -- 全仓`（零命中）；`grep "host/tracker/|host/platform/|host/refresh/|…​" -- src`（112 命中，活边为 `src/tracker/index.ts:27、29` 再导出仍在的 `src/host/tracker/*.js`，其余多为注释）。
- 约束：`AGENTS.md:44-51`（TS 优先）、`AGENTS.md`「测试怎么直接加载 .ts」节（`scripts/ts-hook.mjs`）、`AGENTS.md:75` 起（日志纪律）、`CONTEXT.md:36`（房间纪律）、`docs/adr/20261014-tracker-room-boundary.md:62-63`（决定五）、`tests/handwritten-js-baseline.json:184、226`。
- research 前史：`research/1010-ticket-structure.md:39、281`、`research/1010-migration-map.json:742-767、933-934`、`research/1010-adversarial-coverage.md:11、67、70、75、83、156-158`、`research/1010-deck-blast-radius.md:67-74、91`、`research/1010-migration-map.md:73-76`、`research/1010-adversarial-fixes.md:71、78`、`research/1013-src-host-type-config.md:31`、`research/1048-red-baseline-audit.md:37`、`research/489-appendix.md` 第 1 章。
