# 1052 读路径日志缺口审计（GitHub 房）

**这份文件回答什么问题。** 票 #1052 点名的 13 份读路径文件（全在 `src/tracker/rooms/github/`），今天到底缺哪些日志点；每一条建议都按仓库自己的规矩判——只在三类边界留整趟轨迹（`AGENTS.md:79`），避开四种垃圾（`AGENTS.md:80`），并且能通过 #502 的验收分级「只看日志能不能定位」（`AGENTS.md:82`）。它只谈日志，不谈功能、不谈类型迁移。

**给谁用。** 做 #1052 的人照着落点补日志；复核埋点的人对照 `research/489-appendix.md` 第 1 章与四份日志门禁逐条核；评审的人看第 5 节「反面证据」，确认哪些地方我们**故意没加**。

**什么时候过期。** 本文件的行号是 2026-10-14 当天工作区的快照（`src/tracker/rooms/github/` 与 `tests/` 都是当天读的）。任何一次改名、加行、事件增删之后，行号与结论都要重核。**事件条数永远以 `research/489-appendix.md` 第 1 章为准**（`docs/design/335-logging-contract.md:10-11`、`AGENTS.md:82` 都这么写）；本文件只给「新事件该长什么样、加在哪一行」，编号排到几号由改附录的人定。

**本次没改什么。** 只读审计。没有改 `src/`、`tests/`、`scripts/` 下任何文件，唯一新增的就是本文件。姊妹文件是 `research/1052-capability-read-path.md`（13 份文件的逐条能力答案），本文件不重复那份的内容。

**动手之前先看这一条：这个目录在我审计期间正被同期改动。** 2026-10-14 我读这些文件的那段时间里，`src/tracker/rooms/github/` 与日志台账已经在被别人改：

- `labels.ts` 从 173 行长到 **195 行**（`setLabels` 拆出 `setLabelsInner`、引入 `IssueWriteTrail` 写路径轨迹，见 `labels.ts:115`、`:123`），所以本文件里 `labels.ts` 的行号按 195 行那一版写；同一天 `comments.ts`、`cycle-check.ts`、`graph.ts`、`issues-write.ts`、`parent-repair.ts`、`roster.ts` 也在改（`git status` 可查）。
- 房间目录里新出现 `write-log.ts`（写路径的常驻结论线 `issue.write`，自称附录 1.4 #104）与两个未跟踪文件 `__.client.ts.bak`、`__probe-1052b.ts`；后者是探查用脚本，**提交前应当清掉**（它们是房间目录里的散落文件，不属于任何一份读路径源码）。
- 附录与门禁正在同步往上走：`research/489-appendix.md:62` 已收录 #1054 的 #100～#103，`:66` 写着「现常驻 44 条、按需 50 条」；`tests/verify-log-count.js:15 / :21 / :23` 已按「常驻 44、按需 50、自监控 5、总数 99」对齐。
- 宿主侧 `src/host/git-process.ts`、`src/host/sessionSnapshot.ts`、`src/host/snapshotEnvelope.ts`、`src/host/refresh/*` 也在改动中——本文件第 2 节表里那几行「房外落点」的行号最可能随这次改动漂。

**结论怎么用**：本文件的价值在**判定与候选规范**（哪一处缺什么、该长什么样、为什么不加），行号只是定位线索。动手时按当时的文件重核一遍行号；条数一律以当时的附录 1.4/1.5 节标题为准。

---

## 1 审计依据（逐条带行号）

### 1.1 根 `AGENTS.md` 的「日志埋点纪律（先读总纲票 #502：日志体系采用总纲与查阅入口）」

- `AGENTS.md:77` 目标：「穿过不透明边界的流程做完，不用人补话，AI 只看本地诊断日志就能说出走到哪一步、停在哪个环节。日志多多益善，但只收信号、不收垃圾。」
- `AGENTS.md:79` 三类边界＝进程或模块边界、持久化边界、时间边界。每趟含**起点输入摘要、分支原因、外部调用结果加耗时、状态变化、终点结论**；异常行写清环节名、输入摘要、期望和实际差在哪、上游原因；同一趟先用现有键串起来（工作区短指纹、方法名、时间）。
- `AGENTS.md:80` 垃圾四种，一律不加：无变化的心跳重复记、只记结果不记原因、把整个对象倒进日志、高频不判开关直接记。**加前只问一句：这行能排除哪种故障、指到下一步查哪里，答不上就不加。** 事件名与字段含义稳定，改含义发新事件。
- `AGENTS.md:81` 量与内容分两层：常驻最小够用，按需可放宽；硬红线只有一条——可重放的凭证原文永不落盘。
- `AGENTS.md:82` 验收分级：新流程与核心链路用当天导出包走一遍**只看日志定位**，走不通就是埋点缺；纯重构与注释类型迁移免演练。动手前跑通相关 `tests/verify-log-*`，增删事件同步改 `research/489-appendix.md` 第 1 章对照表。
- `AGENTS.md:51` 同一条纪律被引到 TypeScript 迁移里：「转完顺手加日志，走下一节『日志埋点纪律』」——#1052 正是「读路径转 TypeScript 并补日志」，所以这一节就是本片的主要验收面。

### 1.2 `docs/design/335-logging-contract.md` 第 3 章与相关章节

- `335:118-120` 第 3 章怎么读：两张表按「运行阶段」分，**表里的每一行就是一条事件**，一个事件可能在多处落点（例：`gh.exec`）。列的含义：落地位置、允许字段（就是能记的全部字段，多一个都算越界）、守卫。改任何一条都要同步改 `research/489-appendix.md` 第 1 章。
- `335:122-155` 3.1 常驻表（本表 27 行）——与读路径直接相关的：#4 `repo.resolve.tier`（落点写的是 `src/host/index.js:601、605-638` 的三层兜底）、#5 `gh.exec`、#6 `gh.timeout`、#7 `gh.resolve.fail`、#8 `graphql.fallback`（落点「配额判断与降级」）、#9 `issues.fallback`、#42 `fallback.chain`。
- `335:157-178` 3.2 按需表（本表 16 行）——#43 `error.normalize`（落点写的是 `src/host/index.js` 类别归一与 `tracker/errors.js`）、#58 `exec.run`。`335:178` 有一句计数核对：27＋16＝43 条。
- `335:44-46` 落盘规则：`error` 与 `warn` **始终落盘**；`info` 里第 3 章常驻的那些落盘；其余 `info` 与全部 `debug` 只在调试开关打开时落盘。
- `335:48-54` 1.3 开关：全局整机一个开关，默认关闭；客户端键 `dsws.debug`、宿主 `log-switch.json`，对账以宿主为准。
- `335:56-61` 1.4 守卫纪律：(1) 高频调用点外层先判 `if (!isEnabled(level)) return`，关闭时不分配行对象、不拼串、不进队列；(2) 库体内再判一次兜底；(3) 高频手法＝按事件限量为主（有变化才记）、采样为辅、节流为辅（定时器只记调度与跳过原因，不记每次心跳）；(4) 错误与告警直通。
- `335:63-68` 1.5 渲染路径禁令与截断正例（错误 120 字、详情 160 字、标题前 80 字）。
- `335:209-222` 4.3 门禁断言八条：一字段白名单、二外层判断、三截断、四直通、五正则名、六计数（增删事件未同步附录即红）、七通道、八双产物。

> **一处必须知道的不一致**：335 文档自己的条数与路径已经过期——`335:214-219` 点名的 `verify-log-guards / verify-log-truncate / verify-log-flush / verify-log-scrub / verify-log-channel` 五份脚本，`tests/` 下今天不存在（今天只有 10 份 `verify-log-*`：`client / switch-526 / switch-597 / statusbar / selfmon / artifacts / store / exec-606 / fields / count`）；`335:201` 的房间口径还写着旧路径 `src/host/tracker/backends/<name>/`，而今天房间在 `src/tracker/rooms/<name>/`（`docs/adr/20261014-tracker-room-boundary.md:21`）。**引用条数与路径时以附录第 1 章与 ADR 为准，335 只引它的规则本身。**

### 1.3 `research/489-appendix.md` 第 1 章（现行条数的唯一依据）

- `489-appendix.md:175-179` 增补说明（#958 #97、#1048 #98、#1131 #99、#1054 #100～#103 等批次）。**计数字面今天正在往上走，引用时必须现读**：我读到 `:182`（#1131 那一段）时写的是「常驻 43 条、按需 47 条、自监控 5 条、总数 95 条」，而附录 `:62` 已经收录 #1054 的 #100～#103、`:66` 写着「现常驻 44 条、按需 50 条」、`:257` 的 1.5 节标题也写「按需 50 条」，`tests/verify-log-count.js:15 / :21 / :23` 已按「常驻 44、按需 50、自监控 5、总数 99」对齐。**加新事件时接在当时的末尾号之后**（今天分别是常驻 #104 已被 `issue.write` 占用、按需接在 #103 之后）。
- 1.4 常驻表标题与表体（**标题里的条数一直在变，现读现用**：我最早读到「43 条」、中间读到「44 条」、最后一次读到 `:185` 写的是「常驻 45 条」，并注明 #100 为 #1054、#104 为 2026-10-14 #1053 写路径新增）；`:189` 列说明「允许字段就是能记的全部字段」；`:187` 落点补充（#620 起 `gh.exec` 多一处落点）。
- 1.5 按需表标题与表体（最后一次读到 `:261` 写「按需 50 条」）；`:249` `exec.run` 的 `via` 取值表；`:266` `error.normalize` 一行（字段 `rawKind / mappedKind / layer / via / latencyMs / httpCode / exitCode / errCode`，落点 `src/tracker/error-rules.ts` 的 `emitNormalize`）；`:273` `exec.run`（落点 `host/platformChannel` 的 `detectionExec` 与 `host/repoKeys` 的 `execProc`，两处互斥、每条外部命令只落一行）；`:294` `chain.preflight.reuse`（登录态与仓库可达两条各只真问一次）。
- `:298-310` 1.6 自监控 5 条；`:312-316` 1.7 退役表（`:316` 定时器名只许 `naming-sweep`、`naming-persist`）。
- 读路径相关行（本审计的第 2 节表就是按这些行对号）：#4、#5、#6、#7、#8、#9、#42（1.4）；#43、#58（1.5）。
- `:230` 另有一行 **#74 `issues.page`**，落点是客户端 `src/client/kernel/api-io.js` 的 `fetchIssuesPage`，字段 `state / labelsCount / returned / total（拿不到 -1）/ latencyMs / ok / errorHash`，附录自己标注「无外层判断」——**分页读的另一半数字在这里，不在房内**。

### 1.4 与房间边界、能力上限相关的 ADR

先列目录（`docs/adr/` 下 30 篇），与本次相关的四篇：

- `docs/adr/20261014-tracker-room-boundary.md:21` 房间规则的起点改成 `^src/tracker/rooms/([^/]+)/`；`:29` 房间只许引 `contract/` + `kernel/` + 已登记的 `shared` 模块 + 自己 + Node 内置；`:33` 契约层「只有类型与数据、没有运行时实现」，`error-rules.ts` 这类带规则表的运行时实现进不了契约层；`:59` **常驻判据必须不需要注入就能判**。
- `docs/adr/20261014-error-classification-single-source.md:34` 判别结论是三段式 `{kind, message, raw}`，「原文」字段必填；`:38` 归一埋点提到跟踪器层——**凡判据都发一条 `error.normalize`**，只记归一前后的类别与状态码，不记原文；`:51-52` `fail(...)` 必须恰好三个参数（有门禁），且「原文里可能有路径、地址、令牌」，日志按既有白名单脱敏、凭据原文永不落盘。
- `docs/adr/20261014-tracker-capability-ceiling.md` 与 `docs/tracker/capability-github.md:11 / :28 / :29 / :30 / :31`：`preflight`、`counts`、`listPage`、`getRepoPermissions`、`listSubIssues` 都登记为「明确提供功能」——**这条对日志有直接后果**：既然都声称「实现」，那么它们失败时日志必须能回答「停在哪一环」，否则能力表说得响、现场查不动。
- `docs/design/335-logging-contract.md:201` 房间纪律：埋点落点进入某房间文件的事件随该房批次走，**埋点不得新增跨房引用**。本片所有新落点都必须留在 `src/tracker/rooms/github/` 内。

---

## 2 今天已经在发射的事件（房内 13 份文件逐个查过）

查法：在 `src/tracker/rooms/github/` 全目录 grep `logEvent(`、`emit[A-Z]*`、`isEnabled(`、`roomInfoEnabled`；另有直接命中 `logEvent` 的三份房内文件（`client.ts`、`issues.ts`、`page.ts`）与用 `ctx.logEvent` 的 `repo.ts`、`parent-repair.ts`、`graph.ts`、`cycle-check.ts`。**13 份读路径文件里真正在发事件的只有 4 份：`client.ts`、`issues.ts`、`page.ts`、`repo.ts`**；`errors.ts` 只有一句注释（`:22-24`）说明自己不再发一条。

| # | 文件·发射点（行号） | 函数 | 事件名 | 级别 | 字段 | 附录 | 外层开关 |
|---|---|---|---|---|---|---|---|
| 1 | `src/tracker/rooms/github/client.ts:185-191`（函数）→ 发射点 `:256 / :272 / :279 / :285 / :323 / :329 / :340 / :346` | `execGh` 的 `emitGhExec` | `gh.exec` | info | `argv0, cwdHash, latencyMs, waitedMs, kind, exitCode` | 1.4 #5 | **有**：`:187` 先问 `roomInfoEnabled(ctx)`（`:75-79`：`ctx.isEnabled('info')`，宿主没给 `isEnabled` 时按 `true`） |
| 2 | `client.ts:193-199`（函数）→ 发射点 `:257 / :324 / :350` | `emitGhTimeout` | `gh.timeout` | warn | `argv0, timeoutMs` | 1.4 #6 | 无（告警直通，`335:58-61` 第 4 条允许） |
| 3 | `client.ts:140-146`（函数）→ 发射点 `:154 / :172 / :177` | `emitResolveFail` | `gh.resolve.fail` | warn | `hasDSH_GH_PATH, errorHash` | 1.4 #7 | 无 |
| 4 | `issues.ts:50-56`（函数）→ 发射点 `:235 / :328` | `emitRestFallback` | `graphql.fallback` | warn | `scope, reason` | 1.4 #8 | 无 |
| 5 | 同上 | 同上 | `issues.fallback` | info | `from, to, reason` | 1.4 #9 | 无 |
| 6 | 同上 | 同上 | `fallback.chain` | info | `in, out, latencyMs` | 1.4 #42 | 无 |
| 7 | `issues.ts:62-66`（函数）→ 发射点 `:224 / :225 / :248` | `emitBadNodes` | `error.normalize` | debug | `rawKind, mappedKind` | 1.5 #43 | **有**：`:65` 先问 `ctx.isEnabled('debug')` |
| 8 | `page.ts:91-95`（函数）→ 发射点 `:166` | `emitBadNodes` | `error.normalize` | debug | `rawKind, mappedKind` | 1.5 #43 | **有**：`:94` |
| 9 | `repo.ts:102-108`（函数）→ 发射点 `:125 / :135 / :150 / :156 / :168 / :171` | `emitRepoTier` | `repo.resolve.tier` | info | `tier, ok, latencyMs` | 1.4 #4 | 无（低频，一层一次；严格说没有外层判断） |
| 10 | `src/tracker/rooms/github/parent-repair.ts:24-27`（函数）→ 发射点 `:67`；**由读路径 `issues.ts:240` 走进来** | `emitEdgeRepair` | `edge.repair` | debug | `maps, linked, failed, latencyMs` | 1.5 #103（#1054 新增；`parent-repair.ts:19` 自注） | **有**：`:26` 先问 `ctx.isEnabled('debug')` |
| 11 | `src/tracker/rooms/github/errors.ts:144` 的 `ghVerdictOf` 内部走判档/透传 → `src/tracker/error-rules.ts:366-393` 的 `emitNormalize` | `brevity` | `error.normalize` | debug | `rawKind, mappedKind, layer, via?, latencyMs?, httpCode?, exitCode?, errCode?` | 1.5 #43 | **有**：`error-rules.ts:389` 先问 `ctx.isEnabled('debug')`；宿主侧另一落点 `src/host/git-process.ts:128` 另带同档去重 |

房外、但属于同一趟链的行（记在这里是为了「串趟」，不要在房内重记一遍）：`src/host/git-process.ts:183` 记 `gh.resolve.fail`、`:195` 起在成功与失败两路记 `gh.exec`（字段比房内少一个 `waitedMs`）、`:245` 记 `gh.timeout`、`:247` 记 `error.normalize`（debug，同档去重）、`:437-459` 记 `repo.resolve.tier`（本行来自当天 grep，未逐行读）。另有客户端 `src/client/kernel/api-io.js` 的 `issues.page`（附录 `:230`）。

**这张表已经能回答的三件事**（写下来免得下次重查）：
1. 「起进程」这条边界是**盖住的**：`gh.exec` 每次调用一行，带命令名、耗时、退出码，还多一个房内特有的 `waitedMs`（出站准入等待多久）——比宿主侧那份字段更全。
2. 「REST 降级」这条边界是**盖住的**：`graphql.fallback` 说明为什么降（`reason` 四枚举）、`issues.fallback` 说明从哪到哪、`fallback.chain` 带耗时。
3. 剩下的缺口集中在**「命令成功了，可这一趟读仍然不成立」**这一形状上——`gh.exec` 会是 `exitCode: 0, kind: 'ok'`，然后函数直接 `return fail(...)`，中间一行日志都没有。第 3 节逐份点出这些落点。

---

## 3 逐份看缺什么（13 份，按票面点名顺序）

判定口径：这行日志能不能回答「为什么是这个结果」，并且指到下一步查哪里（`AGENTS.md:80`）。

### 3.1 `client.ts`（401 行，gh 执行器）

**今天有**：第 2 节 1-3 号三件事，进程边界完整。
**缺什么**：单看 `client.ts` 没有缺口。唯一的可议之处是 `gh.exec` 不含「这是哪一趟读」的关联键——但那是给常驻事件 #5 加字段/改含义，按 `AGENTS.md:80`「改含义发新事件」得另立事件名，收益与代价不成比例，见第 5 节第 1 条。
**判定**：本片不改 `client.ts`。它的调用方才是缺口所在。

### 3.2 `issues.ts`（372 行，列表读 + 单票读）

**今天有**：第 2 节 4-7 号（降级三连、坏节点归一）。
**缺什么**：

1. **三个静默截断**：
   - REST 降级分页 `:96-117`：`MAX_PAGES = 10`、`PAGE = 100`。尾页失败/非 JSON/非数组时，只要 `out` 里已经有东西就 `return { ok: true, data: out }`（`:101-102`、`:107-108`、`:111-112`）——**半份数据当成功返回，日志里只有几行 exitCode 0 或非 0 的 `gh.exec`，读不出「只拿到 3 页就断了」**。
   - GraphQL 列表上限 `:194`：`if (all.length >= 500) break` ——截断了，没有任何一行。
   - 拉取请求上限 `:220`：`if (all.length >= 1000) break` ——同上。
2. **多次降级原因只留第一条**（`:177 / :180 / :181 / :183 / :185 / :205 / :207 / :208 / :210 / :212` 一路 `if (!firstRestCause) firstRestCause = ...`）：最终 `graphql.fallback` 的 `reason`（`:235`）只反映第一页那一次失败，**后面几页为什么也失败、失败了几页，日志里读不出来**。
3. **`fail(...)` 分支**（`:157 / :274 / :276 / :279 / :291 / :294 / :328 / :332 / :343 / :350`）：`fail` 是纯函数（`src/tracker/preflight.ts:118-120`，只拼 `{kind, message, raw}`，不记日志），所以「入参形状不对」（`:157`、`:274-279`）这一类**连一行都没有**；「命令成功但回包不是合法 JSON」（`:291`、`:332`、`:343`）只有一行 exitCode 0 的 `gh.exec`。

**判定**：补 1（一条共享事件，见 4.1），2 与 3 纳入同一条事件的字段与 `reason`。

### 3.3 `counts.ts`（124 行，计数）

**今天有**：无自有事件；只有 `gh.exec` 一行与（判档那一路的）`error.normalize`（debug）。
**缺什么**：四个 `fail(...)`——`:78` `repo.refId` 缺失（**连进程都没起**，日志里一个字都没有）、`:96` 回包不是合法 JSON、`:107` 缺 `repository`、`:111` `totalCount` 不是非负整数（后三个都是**命令成功、`exitCode: 0`**）。读者看到面板数字出不来时，日志里只有一行成功的 `gh.exec`。
**判定**：补（共享事件 `read.degraded`，`op: 'counts'`，`reason` 区分 `shape / json / no-repository / no-total`）。

### 3.4 `page.ts`（188 行，分页读）

**今天有**：第 2 节 8 号（坏节点归一，debug）。
**缺什么**：六个 `fail(...)`——`:115` `refId` 缺失、`:140` 回包不是合法 JSON、`:147` **游标已失效（`kind: NOTFOUND`，请用户重新加载）**、`:156` 缺 `repository`、`:158` 缺 `issues.nodes`、`:160` `totalCount` 缺失（「拒绝猜一个数字」）、`:175` **`hasNextPage` 为真但 `endCursor` 缺失**。后两类是两种不同的现实故障（一个要用户刷新，一个是 API 异常），今天在日志里长得一模一样：一行 `gh.exec`（`exitCode: 0`）加一句都没有。
**判定**：补（`op: 'listPage'`，`reason` 区分 `cursor-stale / cursor-missing / json / no-repository / no-nodes / no-total`）。注意客户端已有一条 #74 `issues.page`（附录 `:230`），它记的是「翻页拿回几条」，**不记失败原因**，两条不重复。

### 3.5 `labels.ts`（173 行；本片只读「列标签」那半）

**今天有**：无自有事件。
**边界先说清**：文件头 `:12-14` 写明——2026-09-13（#620）起「列全部标签 / 批量改标签颜色」两条契约操作搬去了同目录的 `label-colors-ops.ts`，**本文件不再自己列标签**，留下的只有给票贴标签（写）和它要用的仓库名拆解。所以票面点名的「列标签」读能力，今天不在 `labels.ts` 里；`label-colors-ops.ts` 不在这 13 份名单内，本审计不展开。
**缺什么**：本文件里唯一的读路径行为是 `attributeLabelFailure`（195 行版本里的 `:93-104`）：写标签撞到疑似权限的 404 时，`:98` 去问一次仓库权限，只有 `triage === false` 才把档位**改判**成 AUTH 并换成人话（`:99-101`），问不出来（`perms` 为 `null`）就原样返回（`:103`）。它的两个调用点在 `:158` 与 `:163`。
- 「**改判**」是一件改变结论的事（同一次失败，日志之外的原因让它从疑似 NOTFOUND 变成 AUTH），今天没有任何一行；
- 「**问不出来所以不改判**」也没有一行——而这两种情况下用户看到的话术完全不同。
**判定**：补（共享事件，`op: 'labels.attribute'`，`reason` 区分 `downgrade-auth / cannot-tell`，带 `triage` 布尔值）。写路径那一族的 `fail(...)`（`setLabels` 与 `setLabelsInner` 里那几处）属 #1053，**本片不动**（票面边界：只改读路径）。注意这份文件今天正被写路径改造动过，行号会漂。

### 3.6 `preflight.ts`（123 行，三项门禁）

**今天有**：**一个自有事件都没有**（全文件 0 个 `logEvent`）。它是「起进程 + 查询」两种边界都经过的一趟，恰好是 `AGENTS.md:79` 说的「每趟含起点输入摘要、外部调用结果加耗时、终点结论」最该有整趟轨迹的地方。
**缺什么**：三项门禁顺序写死：
1. `:57-74` gh 可执行——`:63`（宿主没交 `resolveExecutable`）与 `:68`（解析回 null）**连进程都不起**，直接 `return`。这两条失败在日志里**一行都没有**；
2. `:76-88` 登录态——`:79` 跑 `gh auth status`，失败走 `:83` 原样回 `client` 归一好的那份；
3. `:90-120` 仓库可达——`:96` 可能先跑一次 `gh repo view`（失败时 `:97-100` 静默忽略）、`:105` 无 `refId` 且上面失败、`:109` `refId` 形状不对、`:111` 跑 `gh api repos/owner/name`，失败走 `:114`。

后果：任一项失败时，日志里只有 1-3 行 `argv0` 恒为 `'gh'` 的 `gh.exec`（命令名不在字段里），**「卡在第几项」只能靠「这一串命令里恰好只有 `auth status` 失败」去推**——而第 1 项失败干脆没有任何行。这正是 `AGENTS.md:82` 说的「只看日志定位走不通」。
**判定**：补（新事件，warn，只在失败时发；见 4.1）。成功不发，否则就是心跳。

### 3.7 `checks.ts`（60 行，检查目录定义）

**这份文件自己已经回答过**：`:8-11` 原文——「为什么这份文件一条日志也不记（#1052 逐份判过）：它只交出一份写死的常量表，没有外部调用、没有时间边界、也没有状态变化——在这里加日志属于『只记结果不记原因』，读了也指不出下一步该查哪里。真正会失败的判断在 `preflight.ts` 那三项门禁里。」
**判定**：**不加**，本审计同意，理由就是它自己写的那句（对应四种垃圾的第 2 种）。这条结论今天已经写在文件头里，不需要再动。

### 3.8 `sub-issues.ts`（125 行，子票拉全）

**先纠一处行号**：票面/提问里说的「同一页失败重试一次」在 `:69-70`，那是转写前的旧行号；今天（125 行的版本）在 **`:74-75`**，解释写在 `:71-73`。

**缺什么**：

1. **重试没有痕迹**（`:74-75`）：`let r = await c.execGh(...)`；`if (!r.ok) r = await c.execGh(...)`。两次调用字段完全相同，日志里就是**两行一模一样的 `gh.exec`**（同 `argv0`、同 `cwdHash`、同 `kind`），**读不出「这一页重试过」**，更读不出重试发生在第几页。
2. **三个诚实数字只在返回值里**（`:113-116`）：`fetched / capped / missing / dropped`。
   - `capped`（`:106`：`items.length >= MAX_SUB_ISSUES`（1000，`:41`）就 `break`）——被截断时 `total` 仍是后端总数，`items` 只有 1000。**读日志的人无法知道「这张地图其实还有更多」**；
   - `missing`（`:115`：没被上限卡住、数量却对不上时的差额）与 `dropped`（`:103`：归一失败计数）今天**只在返回值里**，日志里没有；
   - `total` 只在第一页取一次（`:98-101`），取不到就留 `null`，随后 `:116` 用 `fetched` 兜底——**这个兜底也没有痕迹**。
3. **两处静默停**（`:109`、`:111`）：`:111` 是「后端说还有下一页却没给游标」——一个真实的 API 异常，今天静默 `break`，日志里看不出「本来是 5 页，只走了 2 页」。
4. **两次都失败时不带页号**（`:77`）：返回的是最后一趟的错误，日志里也读不出是第几页失败。

**判定**：补（共享事件，`op: 'subIssues'`，字段 `pages / retriedPages / capped / missing / dropped / total / fetched`；`reason` 区分 `retry / page-failed / capped / cursor-missing / short`）。

### 3.9 `repo-permissions.ts`（105 行，仓库权限查询）

**要判的那句话**（文件头 `:17-18` 原文）：「日志：不新增事件名。这一路走 `ghClient.execGh`，调用成功与否由房内既有的常驻 `gh.exec` 记一行（只记命令名与耗时，不记仓库原文），这里不再另记。」

**判它站不站得住**：**只站得住一半。**

- 站得住的一半：命令**没跑成**时（`:82` `if (!r.ok) return null`），`gh.exec` 会带上非 0 的 `exitCode` 与 `kind`，能定位到「这一趟 gh 失败了」。
- 站不住的一半：另外四条「问不出来」的路，**命令都是成功的（`exitCode: 0`）**：
  1. `:54` spec 形状不对——**连进程都没起**，日志里一个字都没有；
  2. `:84-85` 回包是空串或字符串 `'null'`；
  3. `:88-90` JSON 解析失败；
  4. `:31-42` `pickPermissions` 读不出 `permissions.push / triage` 两个布尔值。
  这四种情况下，`gh.exec` 只会老老实实记一行「成功」，**读日志的人完全看不出「为什么权限是未知的」**——而 `gh.exec` 的字段里本来就没有回包形状这类信息（也不该有，`335:96-98` 的硬红线与 `tests/verify-log-fields.js:399` 的禁键名单都挡着）。
- 还有一处加重：操作口 `backend.ts:172-173` 把「`readRepoPermissions` 回了 `null`」一律落成同一句 `NETWORK`（「仓库权限问不出来（网络或仓库不可达），按未知处理」），**连调用方都分不清这五种原因**；`backend.ts:170` 的注释甚至写着「原因在它自己的日志里」——**而它自己的日志今天没有这行**。

**判定**：补。首选一个按需事件 `repoPermissions.miss`（debug，`reason` 五枚举 `shape / exec / empty / parse / fields`）；若想把事件数目压到最少，把它并进 4.1 的共享事件（`op: 'repoPermissions'`）。**顺带请把那句文件头注释改成实话**（`:17-18` 今天与实现不符，这是文档层面的缺陷，不是代码缺陷）。

### 3.10 `repo.ts`（173 行，定位口三层兜底）

**今天有**：第 2 节 9 号 `repo.resolve.tier`，三层各记一次（`:125 / :135 / :150 / :156 / :168`），全挂记 `:171`。
**逐条判**：
- 「仓库标识从哪来」（git remote / `.git/config` / `gh repo view`）——**已经能答**，这正是读路径最想要的一句话；
- 「`{tier: 3, ok: false}` 会不会分不出『第三层试过但失败』与『三层都没试成』」——**不会**：任何一层成功都会立刻带 `ok: true` 返回（`:125 / :135 / :150 / :156 / :168`），所以 `ok: false` 只可能出现在三层都走完之后的 `:171`。语义无歧义，不需要加字段。按 `AGENTS.md:80`，改字段含义反而要发新事件，得不偿失。
**判定**：**不加**。

### 3.11 `fallback-reason.ts`（75 行，降级原因判定）

**今天有**：无自有事件。四个枚举 `timeout / rate-limit / ghe-host / graphql-error`（`:56`，判定在 `:65-72`）。
**判定**：**不加**。它没有外部调用、没有时间边界，产出的原因已经由调用方写进 `graphql.fallback` / `issues.fallback` / `fallback.chain` 的 `reason` 字段（`issues.ts:235`、`:328`）。自己再记一遍就是「同一件事记两遍」。

### 3.12 `normalize.ts`（342 行，纯映射）

**今天有**：无自有事件；归一失败由调用方的 `try/catch` 计数（`issues.ts:188`、`:215`，`sub-issues.ts:103`，`page.ts:166` 附近）。
**判定**：**不加**（无外部调用、无时间边界、无状态变化；失败已经由 `error.normalize` 的 `bad-node:*` 一行计数）。唯一可议的是那条计数是 debug（开关关着看不见）——但数字本身随返回值给出（3.2 第 1 条与 3.8 第 2 条已把「有话说」的情况收进共享事件）。

### 3.13 `queries.ts`（221 行，GraphQL 字面量）

**今天有**：无（纯字符串常量）。
**判定**：**不加**，理由同 `checks.ts`（不对字符串常量记日志）。

---

## 4 建议新增的日志点（候选规范，一行式）

### 4.1 候选甲：`read.degraded`（常驻 warn）——一条顶九处

**为什么用一条而不是九条**：这九处落点问的是同一件事——「这一趟读**命令成功了但结论不成立**，为什么」。`AGENTS.md:80` 要求事件名与字段含义稳定；一条事件、`op` + `reason` 两个枚举字段，能把九处都装下，附录只加一行、门禁只改一处白名单。级别取 `warn`：按 `335:44-46`，`warn` **始终落盘**，所以在「只看日志定位」的验收里不必先打开调试开关（调试开关只管 `info` 与 `debug`）。

| 落点（文件:行号） | 事件名 | 级别 | 允许字段 | 守卫 | 能排除哪种故障 |
|---|---|---|---|---|---|
| `src/tracker/rooms/github/counts.ts:96 / :107 / :111` | `read.degraded` | warn | `op:'counts'`, `reason:'shape'\|'json'\|'no-repository'\|'no-total'`, `ok:false` | 有变化才发（只在失败分支） | 计数为什么出不来：是入参就错、回包不是 JSON、还是缺 `totalCount` |
| `src/tracker/rooms/github/page.ts:140 / :147 / :156 / :158 / :160 / :175` | `read.degraded` | warn | `op:'listPage'`, `reason:'cursor-stale'\|'cursor-missing'\|'json'\|'no-repository'\|'no-nodes'\|'no-total'` | 同上 | 翻页失败到底是「游标过期要刷新」还是「后端漏给游标」——今天这两件事在日志里长得一样 |
| `src/tracker/rooms/github/issues.ts:101 / :107 / :111` | `read.degraded` | warn | `op:'list'`, `reason:'rest-truncated'`, `pages`, `returned` | 同上 | REST 降级只拿到前几页就断了，却按成功返回 |
| `src/tracker/rooms/github/issues.ts:194 / :220` | `read.degraded` | warn | `op:'list'`, `reason:'cap-500'\|'cap-1000'`, `returned` | 同上 | 500/1000 条上限把结果截断了，调用方却以为拿到了全部 |
| `src/tracker/rooms/github/sub-issues.ts:74-77` | `read.degraded` | warn | `op:'subIssues'`, `reason:'retry'\|'page-failed'`, `page`, `retriedPages` | 同上 | 这一页重试过没有、第几页两次都没回来（`gh.exec` 的两行今天长得一模一样） |
| `src/tracker/rooms/github/sub-issues.ts:106 / :109 / :111 / :115` | `read.degraded` | warn | `op:'subIssues'`, `reason:'capped'\|'cursor-missing'\|'short'`, `total`, `fetched`, `missing`, `dropped` | 同上 | 子票数字为什么对不上：是被上限截断、后端没给游标，还是少了若干张 |
| `src/tracker/rooms/github/labels.ts:98-103` | `read.degraded` | warn | `op:'labels.attribute'`, `reason:'downgrade-auth'\|'cannot-tell'`, `triage` | 同上 | 同一次失败为什么被改判成「没有写权限」，或者为什么没能改判 |
| `src/tracker/rooms/github/preflight.ts:63 / :68 / :72 / :80-83 / :87 / :105 / :109 / :114` | `preflight.gate`（见候选乙） | warn | `gate:1\|2\|3`, `reason`, `latencyMs` | 同上 | 三项门禁卡在第几项——尤其第 1 项（不起进程那两条）今天一行都没有 |
| `src/tracker/rooms/github/repo-permissions.ts:54 / :82 / :84 / :88 / :31-42` | `repoPermissions.miss`（见候选丙） | debug（按需） | `reason:'shape'\|'exec'\|'empty'\|'parse'\|'fields'` | `ctx.isEnabled('debug')` | 权限为什么是未知的——那一行 `gh.exec` 今天显示的是「成功」 |

**字段取名注意**：`tests/verify-log-fields.js:399` 的禁键名单里有 `repo / owner / url / path / cwd / message / error / err / stack / text / title / body / args / argv / query / stdout / stderr / hint / token / password / …`。所以**不要**用 `repo`、`owner`、`url`、`message` 当字段名；上面这批字段名（`op / reason / gate / pages / returned / page / retriedPages / total / fetched / missing / dropped / triage`）都不在禁名单里，但仍要在附录的「允许字段」里逐字登记。

### 4.2 候选乙：`preflight.gate`（常驻 warn，只在失败时发）

- **落点**：`src/tracker/rooms/github/preflight.ts`——第 1 项失败的两处 `:63`、`:68`（这两条今天连进程都不起，**必须记**）；第 2 项 `:80-83`；第 3 项 `:105`（无 `refId` 且 `gh repo view` 失败）、`:109`（`refId` 形状不对）、`:112-114`（`gh api repos/...` 失败）。`:72 / :86-87 / :118-119` 三条 `catch` 也带上 `gate` 序号。
- **级别与守卫**：`warn`（始终落盘）；**只在失败时发**——成功不发，否则就是「无变化的心跳」（`AGENTS.md:80` 第 1 种）。
- **允许字段**：`gate: 1|2|3`、`reason`（枚举：`no-resolver / resolve-null / auth / no-refid / refid-malformed / api`）、`latencyMs`。
- **能排除哪种故障**：一眼看出「环境检查卡在第几项」，也就是 `docs/tracker/capability-github.md:11` 登记的那条能力到底死在哪一环；今天读者只能靠「这一串 `gh.exec` 里恰好只有 `auth status` 失败」去反推，第 1 项则完全无线索。
- 说明：这一条**不能**用「`auth` 与 `repo` 两条失败矩阵已经能推出第几项」来省掉——推是能推，但那要求读者先知道门禁顺序、先知道哪条命令属于哪一项，而 `gh.exec` 的字段里没有命令名（只有 `argv0: 'gh'`）。按 `AGENTS.md:79`「每趟含……终点结论」，这一趟该有自己的结论行。

### 4.3 候选丙：`repoPermissions.miss`（按需 debug）

- **落点**：`src/tracker/rooms/github/repo-permissions.ts:54 / :82 / :84 / :88 / :31-42`；`backend.ts:173` 的合并处可选带一次。
- **级别与守卫**：`debug`，先问 `ctx.isEnabled('debug')`（`335:56-61` 第 1 条：外层判断，关闭时零组装）。
- **允许字段**：`reason`（`shape / exec / empty / parse / fields`）、可选 `latencyMs`。
- **能排除哪种故障**：`deck_context` 能力位与写失败归因都依赖这个值（`repo-permissions.ts:11-13`）；今天「权限未知」时日志里那一行是「成功」，谁都读不出原因。
- 若嫌事件多，**并进候选甲**：`read.degraded` + `op:'repoPermissions'`，只是它会变成 `warn`（始终落盘）——「权限未知」值得常驻，本审计倾向并进甲。

### 4.4 加之前必须一起改的四处（`AGENTS.md:82` 要求）

1. `research/489-appendix.md` 第 1 章：新事件进 1.4（常驻）或 1.5（按需）表，并把当轮计数字面改对（**这条我一天里看到它变了三次**：43/47/5＝95 → 44/50/5＝99 → 我最后一次读到 1.4 标题是「常驻 45 条」、1.5 标题是「按需 50 条」，因为同期 #1054 的 #100～#103 与 #1053 的 #104 正在落地）。动手时先读 1.4/1.5 节标题，编号接在当时的末尾之后。
2. `tests/verify-log-count.js`：`:15` 的断言文字、`:21` 的 `RESIDENT` 数组、`:23` 的 `ONDEMAND` 数组、`:114` 附近的总数断言，一处不改就是红（我读到它时写的是「常驻 44、按需 50、自监控 5、总数 99」，与同时刻的附录标题已经差一条，说明它也在被追着改）。
3. `tests/verify-log-fields.js`：`:22` 起的 `ALLOWED` 表加事件与字段。新落点都在房内非 `client/issues/errors` 的文件里，按 `:288-290` 的 `rooms` 名单不参与房内形状检查；但 `:358-365`「未知事件名报红」与 `:399` 的禁键名单照样管。
4. 先跑 `tests/verify-log-count.js`、`verify-log-fields.js`、`verify-log-artifacts.js`、`verify-log-client.js`，再跑 `tests/verify-error-normalize-log.ts`（判档那条不许断）。最后按 `AGENTS.md:82` 用当天导出包走一遍「只看日志定位」。

---

## 5 反面证据：明确**不**建议改的地方（以及为什么）

按 `AGENTS.md:80` 那句「加前只问一句：这行能排除哪种故障、指到下一步查哪里，答不上就不加」，以下十条本审计**故意不加**：

1. **不给 `gh.exec` 加 `op` / 房间 / 命令名之外的新字段**。它是常驻 #5，字段含义稳定；按 `AGENTS.md:80` 改含义要发新事件名，而新事件名要连带改附录、两份门禁与「只管信号」的克制原则。`gh.exec` 今天要回答的那件事——「命令跑没跑成、跑了多久」——它已经答了；「这一趟读为什么失败」由候选甲承担。若确实需要请求级关联键，按 `AGENTS.md:79` 那句「先用现有键串起来（工作区短指纹、方法名、时间），不够串再单独立票做真正的请求 ID」**单独立票**。
2. **不在 `client.ts` 里给每次成功的 `execGh` 再加一行**。同一件事记两遍＝噪音；#5 已经一行。
3. **不把回包、`raw`、错误对象整份倒进日志**。`335:96-98` 红线：出现工作区原始路径、仓库地址原文、模板正文、快照全文即红；`tests/verify-log-fields.js:399` 也把 `message / error / args / argv / stdout / stderr / text / body / query` 列为禁键。诊断需要的那点信息（形状对不对、缺哪一格、几页）已经能由枚举与计数表达。
4. **不给 `repo.resolve.tier` 改字段、也不为「三层全挂」加新事件**。`{tier: 3, ok: false}` 已经唯一对应「三层都走完了且都没成功」——成功路径会在第一层成功处立刻返回（`repo.ts:125 / :135 / :150 / :156 / :168`），所以不存在歧义（详见 3.10）。
5. **不加「读成功」心跳**。`listIssues` / `countIssues` / `listIssuesPage` / `listSubIssues` 成功各记一行，属于「无变化的心跳重复记」；成功路径的数字已经随返回值交给调用方，分页那一半还有客户端 #74 `issues.page`（附录 `:230`）。
6. **不在 `normalize.ts` / `queries.ts` / `checks.ts` / `fallback-reason.ts` 加日志**。四份都是纯映射或常量，没有外部调用、没有时间边界、没有状态变化；`checks.ts:8-11` 甚至已经把这条判定写进文件头（属四种垃圾的第 2 种「只记结果不记原因」）。
7. **不把 `emitBadNodes`（`error.normalize`，debug）升成常驻**。它记的是「归一丢了几张票」，`issues.ts:224 / :225 / :248`、`page.ts:166` 已有；升级等于每遇到坏节点多发一条，而数字已经随返回值给出。要让默认档也看见，就让它作为候选甲的 `dropped` 字段出现（一条顶三条）。
8. **不给 `sub-issues.ts` 的「每页成功」记一行**。翻页成功是正常路径，记了就是心跳；有话说的是三种：重试过、被上限截断、数量对不上（见 3.8），这三种候选甲已经收下。
9. **不新增「分页进度」事件（第 n 页 / 共 m 页）**。进度不改变结论，而且高频；命中四种垃圾的第 4 种（高频不判开关直接记）与第 1 种。
10. **不在房内为宿主侧 `git-process.ts` / `detectionExec` 另立事件**。房间只许引 `contract/` + `kernel/` + 已登记 `shared` + 自己 + Node 内置（`docs/adr/20261014-tracker-room-boundary.md:29`），`335:201` 的房间纪律也写明「埋点不得新增跨房引用」。宿主那几行已经够串趟用。
11. **不动 `labels.ts` 的写路径 `fail(...)`（`setLabels` 与 `setLabelsInner` 里那几处）与 `comment / create / close` 那几条**。票面边界写的是「只改读路径；不改写语义，不改边语义」；而且这一族今天正在被 #1053/#1054 改写（`write-log.ts`、`IssueWriteTrail`），本片不掺进去。

---

## 6 本审计的不确定处（请复核这些，而不是相信我）

1. **`sub-issues.ts` 的行号已漂**：票面说「第 69-70 行」，今天该段在 `:74-75`（文件 125 行）。同类漂移可能还有；第 2、3 节所有行号都是 2026-10-14 当天读的。
2. **房外行号随时会漂**：`src/host/git-process.ts` 的 `gh.resolve.fail`（`:183`）、`gh.exec`（`:195 / :216 / :229 / :246 / :264`）、`gh.timeout`（`:245`）、`error.normalize`（`:247`）、`exec.run`（`:316 / :322`）、`repo.resolve.tier`（`:437 / :448 / :454 / :459`）是我当天 grep 到的位置，而这份文件正在被同期改动（`git status` 显示 `M src/host/git-process.ts`），引用前务必重核。`parent-repair.ts` 的 `edge.repair` 编号已核：附录 1.5 **#103**（`parent-repair.ts:19`）。
3. **`labels.ts:12-14` 说列标签能力搬去了 `label-colors-ops.ts`**：本审计按该注释的说法判定「列标签这半不在本文件」，没有审 `label-colors-ops.ts`（它不在 13 份名单里）。若那句话与事实不符，3.5 的结论要重写。
4. **候选甲/乙/丙的事件编号、以及是否合并成一条**：本文件只给事件名、级别、字段、守卫与落点；最终排到附录第几号、要不要合成一条，由动附录的人定（`335:10-11`：现行条数以附录为准）。
5. **「只看日志定位」的验收本次没有实跑**：那需要当天导出包，并且要分别在「调试开关关闭」与「打开」两种状态下各走一遍（`335:44-46` 决定哪些行落盘）。第 4 节的建议是按规矩推出来的**应该能**定位，不是实测过的**已经能**定位。
6. **`335` 文档自身的过期处**（第 1.2 节末尾已列）：`335:214-219` 点名的五份 `verify-log-*` 脚本今天不存在；`335:201` 的房间路径是旧的。引用规矩时用 `AGENTS.md:75-82` 与附录第 1 章，335 只引规则本身。
7. **同期改动会吃掉本文件的行号**（这一条最重要）：审计当天 `src/tracker/rooms/github/` 正在被 #1053/#1054 的人改（`labels.ts` 173→195 行、新增 `write-log.ts`、`parent-repair.ts` 与 `roster.ts` 等 6 份文件已改、还有 `__.client.ts.bak` 与 `__probe-1052b.ts` 两个未跟踪文件散在房间目录里）。本文件里凡是 `labels.ts`、`parent-repair.ts` 的行号都按改后的版本写；其余 13 份当天未改。第 2 节表里的「房外落点」行号最容易过期。
8. **本审计没有动任何仓库文件**，也没有跑门禁（只读任务）；第 4.4 节那四条「必须一起改」是从门禁源码读出来的要求（`tests/verify-log-count.js:15 / :21 / :23 / :114`、`tests/verify-log-fields.js` 的 `ALLOWED` 表与 `:399` 禁键名单），不是我实跑验证过的结论。
