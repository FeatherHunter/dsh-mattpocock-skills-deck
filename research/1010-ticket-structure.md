# 票结构草案：地图 #1010 下面挂什么（待维护者拍板，尚未建票）

这份文件把「这次改造在跟踪器上长什么样」先写成人能读的一张图，避免只留在对话里。拍板之后照它建票；建票用插件的 deck 工具（一张地图一次调用，地图 + 子票 + 依赖边一起落），不动 #1010 的正文。

## 一、形态：两种地图，都挂 #1010 下

```text
#1010（总图，已存在，正文不动）
├── 改写单元地图 × 12 + 横切收口（判据：行为零变化）
└── 新增能力地图 × 2（判据：新行为可用、有验收）
```

**为什么不把新需求塞进模块地图**：改写单元的完成判据是「同一个输入、同一个回执、零变化」；新需求是**故意改行为**。混在一张地图里两条判据互相打架，讲解时也说不清「这行为是搬家的还是新加的」。分开以后改写票照旧零变化，能力票单独验收。

**每张地图下的固定子票**（修复票按需另开，不预留）：

| 子票 | 类型 | 交付什么 |
| --- | --- | --- |
| 讨论 | `wayfinder:grilling` | 与维护者对齐本单元的做法、边界、名字、参数、失败路径；产出约定评论，列出请他表态的点 |
| 开发 | `wayfinder:task` | 搬文件 / 转 TypeScript / 补日志注释 / 门禁全绿 / 行为对照证据 |
| 讲解 | `wayfinder:grilling` | 带维护者读代码、用当次代码讲 TypeScript 概念、请他就「讲解三看」表态 |
| 修复 | `wayfinder:task` | 讲解或门禁发现的问题（按需开） |

## 二、改写单元地图（编号＝阅读顺序，由外向内；动手顺序写在依赖边上）

| 号 | 地图名 | 覆盖对象 |
| --- | --- | --- |
| W1 | 注册与装配 | `src/deck/registration/` 6 件（含行模块） |
| W2 | 九个工具的入口 | `src/deck/tools/` 10 件 |
| W3 | 工具壳 | `src/deck/shell/` 10 件 |
| W4 | 日志 | `src/deck/log/` 2 件 + 事件对照表 + 《日志导读》 |
| W5 | 契约 | 接口已落地；剩两房 `implements` 对上、`getRepoPermissions` 升契约、门禁收尾 |
| W6 | 注册表与跟踪器顶层 | `src/tracker/registry/` 3 件 + `index` / `preflight` |
| W7 | 识别判定 | `src/tracker/detection/` 6 件 |
| W8 | GitHub 房 | `src/tracker/rooms/github/` 28 件 |
| W9 | Markdown 房 | `src/tracker/rooms/markdown/` 23 件 |
| W10 | GitLab 房 | 14 件：只随目录改名、代码不转 + 迁移说明 |
| W11 | 宿主接线 | `src/host/` 6 件（入口、平台通道、接线、工作区锚、详情、谓词） |
| W12 | 构建与测试基建（横切，动手第一步） | 工程引用、`prepare`、产物出仓、测试框架、门禁换轨；含收口票「`src/deck/README.md` 全域索引」 |

**动手顺序（依赖边）**：W12 基建 → W5 契约收尾 → W1→W2→W3→W4 自上而下 → W8/W9 两房 → W7、W6、W11 → 收口。

## 三、新增能力地图

### C1「会话与在办票可见性」（维护者想法 1 + 补充 3 条）

| 子票 | 内容 |
| --- | --- |
| 讨论 | 在办表读出口长什么样；**给人看的会话身份用什么**（今天落盘只有散列，认不出是谁，与隐私纪律正面冲突）；展示面挂回哪里 |
| 开发 ① | **在办票一览**（新工具，读）：这个工作区有哪些票在办、谁在办、多久没动、进度多少 |
| 开发 ② | **落盘加固**：原子写 + 加锁 + 过期（今天无锁、非原子、无 TTL） |
| 开发 ③ | **上报扩展**：`deck_issue_report` 加进度自评与会话身份 |
| 开发 ④ | **冲突提醒**：上报或改票时撞车就直说 |
| 开发 ⑤ | **认领与释放**：有上报就要有撤销，否则在办表会烂 |
| 讲解 | 带维护者走一遍这条链从写入到展示的全程 |

### C2「工单正文的进度与用户原话」（维护者想法 2、3 + 补充 1 条）

| 子票 | 内容 |
| --- | --- |
| 讨论 | 进度写标题行还是标题下第一行；`## 用户原话` 区的位置与出处写法；要不要顺手把「票正文区块表」写进文档 |
| 开发 ① | 进度入口补齐（create / patch / report 三处口径一致） |
| 开发 ② | **用户原话区**：新参数收原话（一字不改、不做任何格式化）、写入指定区块、两房解析与面板渲染跟上 |
| 开发 ③ | **原话回读**：保证存进去能一字不差取出来 |
| 讲解 | 带维护者走一遍「AI 说的一句话怎么进票、怎么被读回来」 |

## 四、补充的工具与能力（维护者想法 4，共 5 条）

1. **在办票一览（读工具）**——最高价值：链里已有数据、状态栏已有读数，唯独 AI 看不见。
2. **认领与释放**——有写就得有撤，否则「别人在看什么」这天会撒谎。
3. **冲突提醒**——撞车时在回执里直说，不用人自己比对。
4. **原话回读**——原话存了取不出来等于没存。
5. **进度留痕**——进度区每次改动留一行带时间，一眼看出是卡住了还是在推进。

## 五、三路只读调研的事实（2026-10-12，均可复核）

### 5.1 想法 1 在今天的真实现状

- 写入：`src/host/tools/deckIssueReport.js:118-122` 把 `sessionId`、工作区根、后端、票键、时间、动作类别交给处理链；注入点 `src/host/refresh/wiring.js:345` → `sessionTickets.note()`。
- 落盘：`src/host/refresh/sessionTickets.js`，文件 `<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/session-tickets.json`（`:40`；目录算法 `src/host/repoKeys.js:262-270`）。**JSON、全文覆写、无锁、非原子**（`:98-99`；对比 `src/host/choiceStore.js:9` 要求临时文件 + 改名，这条没照做）。形状 `src/shared/refresh/chain.js:294`：`{v:2, at, shards:[{s,r,b,e:[[ticketKey, effortId, at, action]]}]}`。
- 留存：每会话最近 20 张（`CHAIN_SESSION_CAP=20`），**无 TTL、无过期清理**（`sessionTickets.js:29-30`）。
- 隐私：落盘只存散列与票键；会话 id 原文、路径原文、命令原文、票标题都不落（`:17-19`，落盘前过 `chainPrivacyViolations`，见到路径形状整份不写）。
- 键三层：工作区根散列 `chainRootHash`（`chain.js:33-37`）、会话散列 `chainSessionShardId`（`:38-42`，16 位）、记忆键 `chainEntryKey`（`:95-104`）。
- 读出口**有**（三个，但都不是给 AI 的）：宿主读数 `src/host/refresh/sessionChainReadout.js:78`（字段名 `sessionTickets`，`:28`），接进快照 `src/host/snapshotEnvelope.js:67`、`src/host/sessionSnapshot.js:45`；状态栏胶囊 `src/client/statusbar/SessionChainCapsule.js:56-74`，挂载 `src/client/statusbar/StatusBar.js:245`（显示「图钉 + #票号」，界面词「在办」`src/client/kernel/locale-pages.js:81,92`，不写标题）；日志事件 `sessionTickets.chain`（白名单 `src/host/logPkg/store.js:187`）。
- 面板那条展示面**已下线未挂载**：`src/client/views/shared/sessionChainView.js:4-15`（2026-09-24 维护者定「UI 先不显示、能力保留」），原挂载点 `src/client/panel/Dock.js:333` 已摘。
- 九个 deck 工具里**没有任何一个读处理链**（`src/host/tools/deck*.js` 只有 report 自己写）。
- 本次在本仓缓存目录**没找到** `session-tickets.json` 实物（只有 per-repo 快照）→ 当前 DSH 进程 cwd 不是本仓，状态落在别处；这条链的位置取决于进程启动方式，本身就脆。
- `issuePath` **今天已不存在**：随 #345 整块退役、#494 落定（`research/489-appendix.md:111,196,203`），只剩删旧 localStorage 键那一行（`research/1012-final-plan.md:140`）。历史形态见 `research/346-issuePath-accuracy/README.md:118-142`。

### 5.2 想法 2（进度）在今天的真实现状

- 机制齐全：写入在 `src/host/tools/deckIssuePatch.js` 的 `progress` 参数（声明 `:50`，定位 `replaceProgressSection` `:64-104`，按标题行正则、右边界是字段行 Status/Type/Blocked by/Labels，无进度区时三档插入，写后读回 `:257-259`）；读取三级锚定 `src/shared/parser.js:49-59`（clamp 0-100），另有两份同口径解析 `src/shared/tracker/deck-derive.js:33-38`、`src/host/mapBody.js:45-50`；展示在票行与地图行进度条（`src/client/views/shared/ticket.js:23`、`src/client/views/MapDetail.js:151`）；`deck_map_snapshot` 按票算进度统计。
- 真实写法先例：`.scratch/map610/map-610-body.md:110` 实际写着 `## 进度：96%（22 张子票…）`——标题行带百分比 + 括号说明，就是「AI 自评」的现成形态。
- 建票骨架：`src/shared/deck-tools/plan.js:44-63`；地图补五区块（`:23`），别的票只补 `## 进度`（`:59`）；调用点 `deckIssueCreate.js:86`、`deckMapPlanCreate.js:164/218`。
- 正文区块**没有文档契约**：只有代码里两处硬约定（`plan.js:22-23`、`57-61`）；`docs/agents/issue-tracker.md:33-37` 只管写法；v1.7.29 已删「`## 进度：N%` 固定写法」的提示词契约（`CHANGELOG.md:412`）。

### 5.3 想法 3（用户原话）在今天的真实现状

- 全仓**没有** `## 用户原话 / 原声 / 原话摘录` 区块（grep 0 命中）。
- 两个近似先例：`.tmp-666-brand.md:1-3`（`.tmp-667-body.md:1-3` 同）用 `## 诉求（维护者 2026-09-19 原话）` + 引用块；`docs/prototype/474-feeling-notes.md:7` 用 `## 一、你留在票里的原话`。
- 加一个新区块要改的地方比预想少：骨架 `plan.js:44-63`；patch 的 `:50` 声明、`:132` wants.text、`:219-228` 读改写与正则边界 `:73-74`；**Markdown 房不用改**（`src/host/tracker/backends/markdown/parse.js:209` 正文原文透传，只结构化 `## Comments` `:136`）；**面板也不用改**（正文整体走 mdToHtml，`src/client/views/IssueDetail.js:172`）。要一起改的是两份逐字相同的「整份 vs 片段」判据：`markdown/parse.js:44-51` 与 `plan.js:75-82`。要结构化展示才动 `src/shared/parser.js:24-46`、`src/host/mapBody.js:17-39`、`src/host/snapshotBuild.js:81-89`、`src/host/tracker/snapshot.js:112-123`、`src/client/views/MapDetail.js:224`。

### 5.4 顺手记下的两处待查（不阻塞建票）

1. `tests/verify-prompts.js:1302` 的 F22 样例（`## 进度：90%` 独占一行）与 `CHANGELOG.md:412`「已删进度契约」口径疑似未同步，动手碰 W4 时核一次。
2. 必备标签两套口径不一致：代码 `src/shared/deck-tools/plan.js:16-20` 是 map→`wayfinder:map`、task→`wayfinder:task`、bug→`bug`+`needs-triage`；文档 `docs/agents/triage-labels.md:41-45` 说必备三枚是 `bug` / `needs-triage` / `wayfinder:grilling`。按代码，一张用 `deck_issue_create` 建的 task 票不带那三枚里的任何一枚。属 W2 讨论票的话题。

## 六、待维护者拍板的 6 条（建票前必须问清）

1. **地图粒度**：12 张改写单元地图 + 2 张能力地图，行不行？要不要把 W10（GitLab，只改名）并进 W5？
2. **两房要不要再拆**：GitHub 房 28 件、Markdown 房 23 件，一张开发票吃不下一个上下文窗口。建议在同一张地图下按「读 / 写 / 关系与边」拆 2-3 张开发票。
3. **固定三票**（讨论→开发→讲解）够不够？还是讨论票只在本单元真有取舍时才开？
4. **能力票的先后**：建议讨论票现在就能做（纯讨论不写码），开发票排在它要动的模块改写完之后（同一批文件不两头改）。
5. **补充的 5 条**要几条、砍哪些。
6. **旧 27 张票怎么收**：按既定「随重构收口」——已明确修好的（790/829/898/971/895）等对应模块开发票跑完真仓回放再关；不归本次的（1009/995/918/916/917 等）留着不动。
