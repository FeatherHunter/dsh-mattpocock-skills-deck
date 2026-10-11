# 票面核实（第三路）：1007、1008、999、960、962

核实人：票面核实员（fork 自决策会话）。核实时间：2026-10-12 凌晨。
核实方法：先用 `gh issue view <号> --json title,body,state,labels` 逐张读正文，再亲手打开票面点到的源码核行号，最后对照 `research/1010-migration-map.json` 判该文件在不在本次重构的搬家与转码范围内。

判定基准（决策会话给定）：重构范围 = `src/deck/**`、`src/tracker/contract/**`、`src/tracker/registry/**`、`src/tracker/rooms/github/**`、`src/tracker/rooms/markdown/**`、`src/tracker/detection/**`，以及 `src/host/refresh/**` 里被 deck 调到的行。不在内：`src/client/**`、提示词文案、`scripts/**`、GitLab 房、四个计算型核心、闸与账本本体。

一句先说的话：**这五张票的票面行号普遍已经漂移**（代码在票写下之后又改过），所以每一条判定我都以今天源码的实际行号为准，并把漂移如实写出来。

---

## #1007 修复：去 GitHub 的通路失败要报出是哪条命令，并让房内自己掐表、通路不通时立刻失败

**判定：部分。** 房内那一半归我们（而且其中大半已经落地，重构时原样搬），通路冷却那一半不归我们。

**票面要求四件事，逐件核今天的实现：**

1. **房内自己掐表（读 12 秒 / 写 30 秒 / 探活 3 秒）——已经落地。** `src/host/tracker/backends/github/client.js:153` 分读写信封，`:155` 用 `timeoutForGhArgs(args)` 取分档值（来自 `src/shared/tracker/outbound-tiers.js`），`:161` 建 `AbortController`，`:171-172` 房内起截止计时器，`:192` 收尾清计时器。也就是说票面抱怨的「房内不起表、把超时外包给执行器」今天已经不成立。
2. **通路不可达时快速失败（同桶冷却窗口内不再起进程）——没有落地，且不归我们。** 在 GitHub 房全目录搜 `cooldown`／`通路不通`／`failFast` 零命中；今天已有的「同时在飞上限」落在 `src/shared/tracker/outbound-admission.js`（`READ_BUCKET_MAX = 64`、`WRITE_BUCKET_MAX = 16`，第 25 至 26 行，另有 `acquire({bucket, signal})` 排队实现）。按 `research/1010-migration-map.json`，这个文件 **0 命中**，不在本次搬家与转码范围。
3. **失败要带得出名字（记子命令）——没有落地，落在我们范围内。** 今天的 `gh.exec` 字段是 `argv0 / cwdHash / latencyMs / waitedMs / kind / exitCode`（`client.js:128-131`），`gh.timeout` 是 `argv0 / timeoutMs`（`:136-138`），**都没有子命令**。要加这一格得动日志白名单 `research/489-appendix.md` 与 `tests/verify-log-fields.js`；这与我们新写的 `src/deck/log/deck-fields.ts` 是同一处规矩，两边必须对齐（见本文件末尾「给决策人的提醒」）。
4. **读写后续动作分开写死（读可重调、写不许直接重放）——归契约注释。** 这条是语义承诺，落点是 `src/tracker/contract`（我们的范围），实现留在房与工具里。

**顺带核实的一件事（票面没写、但对判定有用）：** `gh.exec` 今天多了一格 `waitedMs`，注释原文写着「#1007 起多记一格 waitedMs：这一笔在名额队列里等了多久」（`client.js:126-127`）。这说明 #1007 的落地是分次做的：掐表与准入已经进代码，子命令与冷却没有。

**重构后靠什么保证不再犯：** 房间侧「自己掐表、不外包执行器」这条随 `client.js` 搬进 `src/tracker/rooms/github/client.ts`，转码时行为零变化；子命令字段与日志白名单由 `src/deck/log/deck-fields.ts` 统一收口；读写回执口径写进契约注释。

---

## #1008 落地：闸的裁决日志补上「当时连续失败几次、上一笔真失败是谁」

**判定：不归我们。**

**依据：** 票面通篇指向 `src/host/refresh/gate.js`（`fireDecide`、`fireSkipped`、`workspaceView`）加上日志白名单 `research/489-appendix.md` 与 `tests/verify-log-fields.js`；票面在「不在本票范围」里明确写了三条不动：不改门槛 3、不改半开那 5 分钟、不改退避序列，并且「计数形状不变：仍然是一个工作区一个数，不分组」。`research/1010-migration-map.json` 里 `refresh/gate.js` **0 命中**，不在搬家与转码范围；决策会话给定的范围也把「闸与账本本体」列在范围外。

**唯一交叉点（不是代码，是流程）：** 新字段要落 `research/489-appendix.md` 的对照表。我们的重构也会往这张表里加 deck 这一侧的字段（`src/deck/log/deck-fields.ts` 是它的 deck 段真源）。两边改的是同一张表的不同段，**要错开或合并成一次改**，否则谁后改谁把对方那段覆盖掉。

**重构后靠什么保证不再犯：** 不适用（这张票治的是闸的日志）。我们对它的义务只有一条：别在重构里顺手改 `gate.js`。

---

## #999 同一类毛病：错误分类认不出来时借一个真实档位（契约层兜底 network、重试界面兜底 network）

**判定：部分。** 票面点名的三处里，一处已经修好（属 #993），一处是我们转码范围但票面结论是「先别动」，一处归客户端。

**逐处核今天的状态：**

1. **`publishFlow.js:16` 与 `backends/github/init-project.js:77` 那两处「借 permission」——已经修好。** 两处今天都改走共享分类器 `src/shared/tracker/initProjectErrorKinds.js` 的 `makeCreateErrorClassifier`（`init-project.js:12` 与 `:76`、`publishFlow.js:12` 与 `:22`），该分类器第 38 至 40 行的兜底是 `return KIND_UNKNOWN`，注释原文：「兜底：#993 之前这里是 'permission'。认不出来就说认不出来（unknown）」。票面点名的行号今天已经是空行（`init-project.js:77`）与解构行（`publishFlow.js:16`），这正是行号漂移的来源。这两处票面自己也写明「归 #993」。
2. **`tracker/preflight.js:57` 那一处「契约层兜底 network」——今天仍在。** 实际是第 58 行 `return ERROR_KIND.NETWORK`（第 57 行是解释这条来历的注释：「兜底：未知错误归 NETWORK（#124 定版「④ 兜底 network」）」）。票面自己的结论是「**先别动**，除非将来有证据表明它产出了用户可见的误报——改它要动契约层通用分类，影响面比收益大」，并明确「不做给 `ERROR_KIND` 枚举新增 `unknown`」。该文件在映射表里（`src/host/tracker/preflight.js` → `src/tracker/preflight.ts`，move-rename），所以**它在我们搬家范围内，但我们只搬不改语义**。
3. **两处界面兜底——今天仍在，且不归我们。** `src/client/kernel/slotRenderer-repo-sync.js:111` 与 `:116` 仍写 `: 'network'`（票面写的是 102 与 107，同样漂移）。`src/client/**` 在范围外。

**我们能为这张票做的（建议写进契约）：** 在 `src/tracker/contract` 的 `ErrorKind` 注释里把票面那条原则写死——「只给日志与分支看的分类，猜一个最可能的档位代价很小；要变成用户眼前那句话的分类，认不出来就必须说认不出来」。今天 `ErrorKind` 的八个值（`src/tracker/contract/ports.ts:88-96`）与 `src/shared/tracker/constants.js` 的 `ERROR_KIND` 逐字一致，正是这条原则的落点；把受众原则写在旁边，后人就不会再借档位糊过去。

**重构后靠什么保证不再犯：** 契约里 `ErrorKind` 是唯一真源加一条受众原则注释；转码 `preflight.ts` 与 `init-project.ts` 时用新鲜度与门禁保证行为零变化。

---

## #960 [Bug] 桌面版「闪退又重进」：gh 出站缺并发准入把系统拖死

**判定：部分（大头不归我们）。**

**票面点到的两处，今天实况：**

- `lib/tracker/backends/github/client.js:41` 的 `TIMEOUT_MS = 30000`——今天在 **第 44 行**（票面写 41）。该文件在映射表内（`src/tracker/rooms/github/client.ts`，move-rename）。
- `client.js:56` 的 `reportOutbound`「只记账、不拦不排队」——今天在 **第 62 至 64 行**（`if (!gate || typeof gate.noteOutbound !== 'function') return` 与 `gate.noteOutbound({requests: 1, points: …})`），票面写 56。

**为什么大头不归我们：** 票面自己的「诊断补记（2026-10-09 追加）」已经修正过一次结论：`execGh` 只是 GitHub 房间内的出口，真正起进程的是 `repoKeys.js` 的 `runGh/execProc` 与 `platformChannel.js` 的 `detectionExec`（门禁 `tests/verify-gh-gateway.js` 的登记表自证），「所以只在 client.js 加信号量会漏」，修复落点按 #923 是传输层准入。对照映射表：`repoKeys.js` **0 命中**（不在范围）；`platformChannel.js` 是「原地换后缀」（stay-ext-change，只在原文件改后缀与引用，不改语义）；`skillProbe.js`（补丁 C 的落点）**0 命中**；日志采样（补丁 D）也不在我们范围。

**我们唯一的义务是一条反向纪律：** 转码 `client.ts` 时必须保住 `reportOutbound`「只记账、不排队」的原语义。准入现在由 `src/shared/tracker/outbound-admission.js` 统一做（读 64 / 写 16，见 #1007 一节），**重构里不许在房间里顺手加第二道闸**——那会与闸「不排队」的不变量正面冲突，票面补记已把这条列为风险（「与 gate.js『不排队』不变量直接冲突」）。

**重构后靠什么保证不再犯：** 不适用（我们不修准入）；但「同一件事只有一道闸」这条可以由新架构保证：房间不再自己管名额，名额只有 `outbound-admission.js` 一处。

---

## #962 落地：960 桌面闪退 gh 出站准入与重查搭车（规格）

**判定：不归我们。**

**依据（规格自己写的四件加两件，逐件看落点）：**

- **传输层准入**（同时在飞计数、满了等不是失败、读写分桶）：落点是传输层；实现今天已存在于 `src/shared/tracker/outbound-admission.js`（映射表 0 命中）。
- **分档超时**（读短写长探活最短、取消信号能杀排队与在飞、写超时不许重放）：房内那一半已落地（见 #1007 第 1 条）；数字终值与「上限值先测再定」归本票。
- **技能按需**（链上只问三项、全量只在重查与设置页问、短时缓存与按工作区清缓存）：落点 `platformChannel.js` 与 `skillProbe.js`（后者 0 命中；前者只是原地换后缀）。
- **同钥匙搭车**（钥匙 = 工作区键 + 后端 + 语言；旧没回新不起；写过、失败、超 30 秒都不搭）：落点是宿主电话层（探测、链、快照、列表），不在我们范围。
- **日志策略**（关键与告警全量、高频成功明细降为按需或聚合）：与我们无关，但要动同一张 `research/489-appendix.md`（同 #1008 的提醒）。
- **上限值测量**：归本票。

**唯一擦到我们的两点：**

1. 房间侧的**超时数字**：如果本票把 `timeoutForGhArgs` 的分档值改了，那处住在 `src/shared/tracker/outbound-tiers.js`（0 命中），而消费它的房内代码在我们搬家范围。改数字时须同时看两边。
2. **「写超时后不许重放」这条契约语义**：规格第 4 条用户故事与 Testing Decisions 都点了它（「写操作超时后知道到底写上没，不敢重试也不会写两遍」）。这条应由我们在 `src/tracker/contract` 的注释里定调（读可重调、写不重放），实现归 #962 与相关票。**若不写进契约，房与工具两边会各写一套说法。**

**重构后靠什么保证不再犯：** 不适用；我们的贡献是把「写不重放」写成契约语义，而不是留在某个工具的回执文案里。

---

## 汇总（给决策人）

| 票 | 判定 | 归我们的部分 | 不归我们的部分 | 已落地的现状（重构要原样搬） |
| --- | --- | --- | --- | --- |
| #1007 | 部分 | 房内掐表（已在 `client.js:153-192`）、`gh.exec` 记子命令（未做）、读写回执口径（契约注释） | 通路冷却窗口（传输层与 `outbound-admission.js`） | 分档超时、`waitedMs` 字段、读 64 写 16 准入 |
| #1008 | 不归我们 | 无（只共改日志附录表） | 全部（`gate.js` 与日志白名单） | — |
| #999 | 部分 | 契约 `ErrorKind` 受众原则注释；转码 `preflight.ts`/`init-project.ts` 保持行为 | 客户端两处界面兜底（`slotRenderer-repo-sync.js:111/116`）；是否改契约层分类（票面结论：先别动） | #993 已把两处 permission 兜底改成 `unknown` |
| #960 | 部分 | 转码 `rooms/github/client.ts` 时保住「只记账不排队」 | 传输层准入（`repoKeys.js`、`platformChannel.js` 的 `detectionExec`）、技能缓存、日志采样 | 出站准入已在 `outbound-admission.js` |
| #962 | 不归我们 | 「写不重放」写进契约注释（唯一擦边点） | 四件加日志策略与上限测量全部 | 准入已存在，分档超时已落地 |

**吞并结论：这五张里没有一张能「重构即吞掉」。** 两张完全不归我们（#1008、#962），三张只是「文件在我们的搬家范围内」——而它们在那些文件上的现状**已经落地或已有结论**，重构的正确做法是**原样搬、行为零变化**，不是顺手改造。真正能从重构里拿到的三个好处是：房间不再自己管名额（同一件事只有一道闸）、日志字段只有一张表、契约里写死「读可重调、写不重放」。

**两条流程提醒（给决策人）：**

1. `research/489-appendix.md` 是三方共改的表（#1007 的子命令字段、#1008 的闸归因字段、我们 deck 段的字段）。建议决策人指定「一次改一处、改完通知其余两方」，或索性把这三段合成一次改，避免互相覆盖。
2. 票面行号已经漂移（本文件逐条列出了漂移后的实际行号）。后续谁按票面行号动手，先按本文件的实测行号校准，别照抄票面。
