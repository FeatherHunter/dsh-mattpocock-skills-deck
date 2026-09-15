# 原作者网站上全部可用的工作流（研究票 #642）

本文件是 wayfinder 地图 #641（「悬浮技能面板按工作流分组」）下研究票 #642 的交付物。它回答一个问题：**原作者 Matt Pocock 这套技能里，人到底可以照着走哪些路**——每条路上技能按什么顺序、什么时候进入、走到哪一步算结束或者回到哪一步。

> **本文件已过一轮独立核验（2026-09-16）。** 核验用一次多代理编排完成：15 条工作流每条派一个独立代理回原始整理稿逐句核对，再从 8 个角度找漏掉的路，最后对每一条被标记的问题派第二个代理**试着推翻它**（16 条主张里 6 条被推翻、10 条留下）。结论：15 条里只有 1 条完全无异议，共改掉 9 处硬伤，补进 14 条新路（见下节 1.1）。**被改掉的 9 处里有 3 处是我把话说反或说过了头**，都在原处写明了改前那句话错在哪，方便读者判断该信哪一版。

## 0. 一页结论

1. **这套技能不是「25 个平铺的工具」，而是「一条主干 + 几条入口 + 一批随时可用的独立件 + 一层给别人用的规矩」。** 作者在网站上对每个技能都写了一节 `Where it fits`，用他自己的话给它定位；这是本次整理最可靠的一类材料。
2. **主干是一条五棒的链**，作者在至少四个页面上逐字重复同一句：

   ```txt
   grill-with-docs → to-spec → to-tickets → implement → code-review
   ```

3. **但这条主干与「25 个技能」不是一回事**：`to-spec` 只在「这件事要跨多个会话」那条分支上才存在，改动小的时候 `grill-with-docs` 之后直接 `implement` 就行。
4. **面板最该教给人的那条路，恰恰是两个会话之间走两个来回那条**（在原对话里卡住 → 交接出去做原型 → 把答案交回来 → 原对话引用它）。作者自己说这是「最常被跳过的用法」，而且**它只写在网站上，本地技能文件里一个字都没有**。
5. **有一处必须纠正的常见误解**：上下文快满了该用的是 `/compact`，不是 `/handoff`。`/handoff` 只在「这份活要搬到别处去」时才用（换工具、换目录、交给同事、分叉一个支线）。面板上若写成「上下文满了就 handoff」，教的是错的。
6. **本地技能文件不是工作流知识的来源。** 主干四跳里，本地原文只明写了一跳（`implement` → `code-review`），另外三跳两头全缺；跨会话那条路整条是空的。唯一把全图编码进去的本地文件是 `/ask-matt`——它把 24 个技能名排成了「主干 / 入口 / 旁支 / 词汇层」并写了 handoff 出去再回来这条。**所以做面板时，内容要照网站和 `ask-matt`，不能照技能自己的 `SKILL.md`。**

## 1. 全量工作流清单

下面每一条都可以照着走。顺序里的方括号是「这一棒内部会跑谁」。

### A. 主建造链（多会话分支）

- **适合什么场景**：有一个想法，要一路做到能合并的代码，而且这件事大到值得分成多个会话。
- **技能顺序**：`grill-with-docs` → `to-spec` → `to-tickets` → `implement`〔内含 `tdd`〕→ `code-review`。
- **什么时候进入**：想法还没想清楚的时候进入，`grill-with-docs` 是这条链的链头（作者原话：`the head of the main build chain`）。它只能由人手动敲（带 `disable-model-invocation: true`）。
- **走到哪算结束（或回到哪）**：`code-review` 是链尾（`the review step at the tail of the build chain`）。**官网上写明了评审之后怎么办，而且不是「回到 `implement` 重跑」**：先提交，再对着你分叉出来的那个点评审，拿到发现之后用 `amend` 或加一个 fixup 提交（`Commit first, then review against the point you branched from.`）；`implement` 不会去处理评审发现的那些问题、也不会去勾原工单上的复选框——工单与验收标准由人自己收（`Close the ticket and reconcile the criteria yourself.`）。**本地技能文件里这条回头路一个字都没写**。
- **纪律**：`to-spec` 与 `to-tickets` 之间**不要** `/clear`、不要 `/compact`，同一个上下文窗口连着跑；`to-tickets` 之后每张票各占一个干净上下文，票与票之间要清干净。

### B. 短路径：跳过规格与工单，但最后一棒要换一个干净会话

- **适合什么场景**：这条改动装得进一个上下文窗口，不值得为它拆规格与工单。
- **技能顺序**：`grill-with-docs`（不在工作目录里时换成 `grill-me`）→ `implement`〔内含 `tdd`〕→ 换一个干净会话 → `code-review`。
- **什么时候进入**：动手前就能判断出「装得进一个上下文窗口」时就跳过下面两棒——作者的两条对照口径是「装得进一个上下文窗口就跳过 spec」「装得进一个上下文窗口就跳过 tickets」，不是聊完以后回头才发现。
- **说明一（哪些留在同一个会话里）**：前三棒留在同一个会话里跑，`grill-with-docs` 结束时不要 `/clear`，直接把同一个会话交给 `implement`。
- **说明二（哪些必须换会话，这一条容易漏）**：**最后一棒作者明确要求换会话**。原文问答：`Should I run it in the same session that wrote the code? — Prefer a fresh one.`，理由是 `Same context reviewing itself isn't review, it's confirmation bias with a slash command.`；从干净会话自己敲 `/code-review` 才是「诚实的版本」。另外 `implement` 是在提交之前调用评审的，而评审只看 `git diff <固定点>...HEAD`（不含暂存区与工作区改动），所以规矩是**先提交，再对着分叉点评审**。
- **说明三**：`to-spec` 那一棒只在「跨多个会话」的分支上才存在，不是每次都要走。

### C. 大工程先划路（`wayfinder` 情境入口）

- **适合什么场景**：一大块活，一个 agent 会话装不下，路还看不清。
- **技能顺序**：`wayfinder`（把这件事画成一张决策地图）→ 逐张解票（票型有四种：`research`、`prototype`、`grilling`、`task`）→ 地图清明 → 交接给 `to-spec` → 并回上面 A 那条主干。
- **什么时候进入**：作者原话是 `a situational on-ramp, not the default front door`（情境入口，不是默认前门），由人手动唤起。
- **走到哪算结束**：走到「前方再没有要拍板的事」就结束，`wayfinder` 自己不写代码。常规收尾是交接给 `to-spec`（由它把地图上互相链接的决策收拢成一份可读的规格，再照常往下走），**但作者留了例外**：只有这活其实很小时，才允许从地图直接进 `implement`（`Go straight to implementation only when the effort turned out genuinely small.`）；直接接进 `implement` 会跳过这次收拢、把链式细节丢掉，所以那是例外不是常规。
- **注意（两件事分开说，别混成一句）**：一是作者在 `ask-matt` 页给出一条会写错的静态表写法 `wayfinder → to-spec → to-tickets → implement → code-review`，并说它 `for most situations` 是错的，**他给的理由是「真正有意思的是那些岔路」**（有没有代码库、这次建造是否跨会话、这个问题能不能靠谈话定下来）。二是作者在 `wayfinder` 详情页把它定位成 `a situational on-ramp, not the default front door`（情境入口，不是默认前门）。把这两处并成「作者说把情境入口当必经第一棒所以错」是我上一版的过度归纳，作者并没有就静态表说过这句话。

### D. 接收外来活（`triage` 这条并行车道）

- **适合什么场景**：活是外面报进来的（别人的 issue、外部 PR），不是你自己起的事。
- **技能顺序**：`triage`（分类 → 轻量核验 → 需要时 `grilling` + `domain-modeling`）→ 按核验结果走到四个出口之一 → 其中一个出口在 `ready-for-agent` 汇合 → 由 `implement` 领走。
- **什么时候进入**：作者原话 `only for incoming issues, not for issues you created yourself`。
- **走到哪算结束（四个出口，不是一个）**：移到 `ready-for-agent` 时贴一份 agent brief（给无人值守 agent 照着做的说明书）；移到 `ready-for-human` 时贴同结构的一份说明并写明为什么这事不能委托出去；复现不出来时挂 `needs-info` 等报告人回话，**报告人一回复就回到 `needs-triage`**；查重命中或被拒过则 `wontfix` 关掉。所以这条车道上**相当一部分活走不到 agent brief**。
- **核验成真的 bug 交给谁**：`triage` 自己的原文没写；`/ask-matt` 那一份写了——它产出「agent 可直接接手」的工单，之后由 `/implement` 接手。

### E. 定期保养（`improve-codebase-architecture`）

- **适合什么场景**：给代码库攒活，不干活；大部分时候是「每隔几天扫一次或空当出现时扫一次」，但它还有另外三种用法（见下）。
- **技能顺序**：`improve-codebase-architecture`（扫出「值得加深的模块」→ 一份可视化 HTML 报告）→ 人挑一条 → `grilling`〔含 `domain-modeling` 当场写 `CONTEXT.md`、必要时提 ADR〕→ 把这条决定带进 `to-spec` → 其余候选变成以后可以各自独立领走的工单。
- **什么时候进入（作者给了四种，我只写了第一种是漏的）**：① 例行保养：每几天一次，或空当出现时；② **大改动之前**：把规格丢给它问一句「怎么改才容易」，作者说这是它**最有效的用法**；③ 老仓库体检（大而无当或随手 vibe 出来的代码库）；④ 补测试的活：先找缺失的接缝，再补测试。
- **触发方式**：**只能人手动唤起**（`You invoke this by typing /improve-codebase-architecture; the agent will not reach for it on its own.`），本地也带 `disable-model-invocation: true`。
- **走到哪算结束**：报告出来、人挑定一条（作者纪律：**一次会话只做一条候选**）、谈定、写进规格。之后重构本身在另一段会话里、走正常建造流程做。**报告只活在临时文件里**，所以跨会话要带走的是那一条候选本身，不是那份文件。
- **还有一个邻居**：`codebase-design` 提供这些候选所用的深模块与接缝词汇，是它的第一个邻居；要试几种不同接口时还会调它的「设计两遍」并行子代理。

### F. 难 bug 诊断（`diagnosing-bugs`）

- **适合什么场景**：难修的 bug、性能退化——从一个「能复现的失败」开始。
- **技能顺序**：`triage`（如果这活是外面报进来的）→ `diagnosing-bugs`：先造出一个能跑的反馈循环、复现、最小化、提假设、插桩定位 → **先写回归测试，再修**（`The regression test is written before the fix`，这一句我上一版写反了）→ 复盘时若发现的是架构层面的原因（没有好的测试接缝、调用方纠缠、隐藏耦合），**在修完之后**才把活交接给 `improve-codebase-architecture`（作者的纪律是「修完之后再提，不要提前给」）。
- **什么时候进入**：人可以喊它；它是少数模型也能自己触发的技能（没有 `disable-model-invocation`）。
- **走到哪算结束**：结论写进提交信息或 PR 说明，让下一个调试的人能接上。
- **一处要留意的缝**：`triage` 与 `diagnosing-bugs` 的交接，作者自己承认**两个技能文件里都没写对方**，是用户发现后反馈的。

### G. 冲突收尾（`resolving-merge-conflicts`）

- **适合什么场景**：merge 或 rebase 冲突正卡着。
- **技能顺序**：`resolving-merge-conflicts`，逐个 hunk 解决。
- **什么时候进入**：任何冲突现场。
- **走到哪算结束**：不是「冲突标记消失」就结束——作者的终点是**树干净且已提交**（`it starts when git stalls and ends when the tree is clean and committed`），而且是**把这次合并一路带到一个完成的提交**；变基时还要把剩下的每个提交都做完。
- **它的位置（改一处我上一版的错）**：它的入向确实不依赖任何技能（`no dependencies on any other skill`）、也完全不在主干上，但**有一个明确的邻居**：合干净了、可合完代码行为不对，就从这里转去 `diagnosing-bugs`（那是诊断问题，不是冲突问题）。我上一版把它写成「不接任何人也不回到哪里」，与原文不符。另外作者明确说它**不提供 `--abort`**。

### H. 跨会话走两个来回（`handoff` ↔ `prototype`）—— 负责人点名要的那条

- **适合什么场景**：你已经在一个设计对话里陷得很深，遇到一个「只有跑代码才能回答」的问题，而你不想把好容易建立起来的这条线索花在试错上。
- **技能顺序**：原对话 → `handoff` 把上下文交接出去 → 新会话（在原型目录里）用 `prototype` 把问题答出来 → 把答案 `handoff` 交回来 → 原对话引用这份答案。
- **作者原话**：`Hand off to a prototype session, get the answer, hand the answer back, and reference it from the original thread. Two crossings, one live conversation, nothing re-explained.`（走两个来回，一条活着的对话，不用重讲一遍。）
- **关键点**：**原对话不结束**（`You stay in your session`）。这跟「会话快满了换个窗口」完全不是一回事。
- **什么时候进入**：先把一件事说清——下面这四种是 **`/handoff` 自己的触发条件**（`Four situations are the whole trigger:`），**不全是这条路的触发条件**。其中只有**换目录或换仓库**（做原型目录是常见情形）与**中途分叉一条支线**这两种会走成「出去再回来」这条路；**换工具**（Claude → Codex）与**交给同事**不会走回来：

  | 情形 | 为什么需要一份文件 | 会走成这条路吗 |
  | --- | --- | --- |
  | 换工具（Claude → Codex） | 新工具看不见旧的上下文 | 不会（单程） |
  | 换目录或换仓库 | **做原型目录是最常见的一种** | 会 |
  | 交给同事 | 对方需要一份他能读的东西 | 不会（单程） |
  | 中途发现的支线任务 | 你继续干，另起一个 agent 去做那条支线 | 会 |

- **走到哪算结束**：答案交回原对话、原对话引用它。
- **要留意的坑**：交接文档写在操作系统的临时目录里（**明确不是当前工作区**），而临时目录可能被系统清掉。交出去的那一步**网站上写了**——开新会话、把文件路径指给它（`Open the fresh session and point it at the path: read this file, then continue.`），并且要点名文件路径而不是把摘要粘进 shell 命令；一个小时内不开始或换了工具时，自己把文件拷到持久位置。**这些只有本地 `SKILL.md` 没写**。

### I. 阶段边界五选一（`continue` / `/clear` / `/handoff` / 委派子代理 / `/compact`）

- **适合什么场景**：一个阶段做完了，下一步该不该换上下文。
- **谁掌管这棵树**：`ask-matt`（作者说这棵**有序树**画在它那里）。
- **五个选项各保全什么**（**只有三格是作者原话，另两格是我按他的原话折算的**，见下表右列）：

  | 选项 | 保全什么 | 什么条件下选 | 这一格的出处 |
  | --- | --- | --- | --- |
  | 继续（留在原会话） | 唯一保持「会话本身是主源」 | 下一阶段需要这一段的原样上下文，或者你还有可用余量 | 作者原话（`the only move that keeps the session as a primary source`）；「什么时候选」那半句是我按上下文补的 |
  | `/clear` | 什么都不保 | 身后的一切都可丢 | 作者原话（`preserves nothing`） |
  | `/handoff` | 「这份活能移动」 | 有东西要**搬**：换工具、换目录、交给同事、分叉支线 | 作者原话（`preserves the work's ability to move`） |
  | 委派子代理 | 你不在键盘边也能跑 | 任务边界足够紧 | **不是「保全什么」，是作者给的「什么时候选」**（`The task is scoped tightly enough to run with you away from the keyboard.`） |
  | `/compact` | 你的意图 | 以上都不是（兜底，且大多数时候落在这里） | 作者原话（`preserves your intent`）；另外同工具同目录同任务时它是默认项而不是第一手 |

- **纠偏**：`/handoff` 看着像「会话之间的通用桥」，**它不是**；`/compact` 是树底兜底、不是第一手，而且**它可以带一句指令**（作者举的例子是 `/compact we're going to QA this area`）。
- **这张表不等于那棵树**：作者说分支判断的有序树画在 `ask-matt` 那里（本地对应 `PHASE-BOUNDARIES.md`），按顺序问下来第一个 yes 就赢；但那份文件自己承认这些判断**不客观**，同一个边界换一天可能得到两个答案。所以**别把上面这张表当成可以照着跑死的判定顺序**。

### J. 脱离仓库先把想法锤一遍（`grill-me` → `grilling`）

- **适合什么场景**：有个想法，先别碰代码，先把想法本身问穿。
- **技能顺序**：`grill-me` → `grilling`（`grill-me` 的正文全部内容就是一句「跑一次 `/grilling`」）。
- **什么时候进入**：人手动敲。
- **一处站点自相矛盾**：它要求在一个新会话里启动，但在「写 spec 之前」又明确说**不要**另起新会话。

### K. 在仓库里对齐并留下记录（`grill-with-docs` → `grilling` + `domain-modeling`）

- **适合什么场景**：有仓库、要一边被问一边把决定记下来。
- **技能顺序**：`grill-with-docs`〔内部跑 `grilling` 与 `domain-modeling`〕→ 产出 ADR 与 `CONTEXT.md` 术语表。
- **走到哪算结束**：**会话结束时不要 `/clear`**，直接把同一个会话交给 `to-spec`。
- **要留意的坑**：在别的编排环境里跑时，「写文件」那一半会被报告为静默不发生（已归档、未修）。

### L. 有个问题得问别人（`to-questionnaire`）

- **适合什么场景**：有个决定你自己答不了，边界在你自己的知识之外。
- **技能顺序**：`to-questionnaire` 产出一份问卷 → 由**一个人**填（异步填或开会一起填）→ 回答回来。
- **注意**：下一步是另一个人，不是另一个技能；必须在**同一个会话**里跑（换会话会丢掉主题）。

### M. 跨多次会话学一件事（`teach`）

- **适合什么场景**：学一门新东西，要跨很多次会话、一节课接一节课。
- **技能顺序**：`teach`（工作区里有 mission、资源清单、课程、学习记录）。
- **关键点**：作者原话 `The folder is the continuity, not the conversation.`（连续性是那个文件夹，不是对话。）
- **一条组合用法**：跟 `grilling` 聊到某个不懂的东西 → 用 `handoff` 交接去教学工作区 → 在那里 `teach` → 回来接着原来的线索（原话意思：别为了学东西把 grill 停下来）。

### N. 听不懂就让重讲（`wait-what`）

- **适合什么场景**：上一条消息没听懂。
- **技能顺序**：`wait-what`，原地重讲一遍。
- **作用范围**：`at any point, in any conversation, inside any other skill`（任何时刻、任何对话、任何技能内部都能用）；它只管当前对话的上一条消息。

### O. 参考层（不是路，是别人用的规矩）

`codebase-design`、`domain-modeling`、`grilling`、`tdd`、`writing-for-agents` 这五个，作者对它们的定位是「别的技能调用的那一层」，不是让人按顺序点的路：

- `codebase-design`：深模块设计词汇，**不在任何链上**（`not a step in any chain`）。
- `domain-modeling`：模型自动调用的参考件，`runs underneath other skills more often than it runs on its own`（跑在别的技能下面比单独跑多）。
- `grilling`：一个**基元**，不是你去排的一步；两个正门是 `grill-me` 与 `grill-with-docs`。
- `tdd`：主链**建造环节里的发动机**，不是独立的一步。
- `writing-for-agents`：写给 agent 看的文档的写法，**在链上没有邻居**。

## 1.1 核验后补充的工作流（P 到 AF）

下面这些是独立核验从原始整理稿里另外找出来的路，A 到 O 没覆盖到。每条末尾的括号是核验代理自己给的把握程度。

### P. 开工前把仓库配好（一次性前置配置）〔把握高〕

- **适合什么场景**：第一次在一个仓库里用这套技能，或者半途接手一个仓库、下游技能开始瞎猜 issue 记在哪、贴出你 tracker 里根本没有的标签。
- **技能顺序**：`setup-matt-pocock-skills`（探查仓库现状 → 把三段决策摆给人确认：issue tracker 走哪个、标签词汇是否沿用默认五个角色、领域文档是单上下文还是多上下文 → 写文件）→ 之后所有工程技能才有据可依。
- **走到哪算结束**：`AGENTS.md` 或 `CLAUDE.md` 里出现 `## Agent skills` 段、`docs/agents/` 下出现那几份文件。

### Q. 把读资料的活交出去，再带着事实回到主干〔把握高〕

- **适合什么场景**：关键动作是「去搞清楚一个外部事实」（第三方 API 怎么表现、规范原文怎么写、某个版本说法站不站得住），而你不想为此停下手上这条线。
- **技能顺序**：`research`（起一个后台代理去读一手来源，你继续干别的）→ 产出一份留在仓库里、每条结论带出处的 Markdown → **由人把这份文件主动带进下一步**：喂给 `grill-with-docs`（事实摆上桌，问题更利）或 `to-spec`（贴着它写规格），也可以让某张票指向它。
- **关键点**：它不会自动接回去——作者明确说后面的会话不会自动复用以前的研究文件，必须人主动指过去。

### R. 访谈里撞到「不跑代码定不下来」的问题：中途做一次丢弃型原型〔把握高〕

- **适合什么场景**：在一场 `grilling` 里遇到靠说话定不下来的问题（状态模型的边界情形、界面该长什么样）。硬聊正是会话失控膨胀的地方。
- **技能顺序**：`grill-me` 或 `grill-with-docs` 的访谈 → 撞到不可 grill 的问题 → 停下访谈 → `prototype` 做一次性版本 → 看一眼 → **把一句话答案带回原访谈继续**。
- **与 H 条的区别**：这一条不换会话、不写交接文档；换会话的那个版本才是 H 条。

### S. 票发完之后：每张票一个干净会话的实现循环〔把握高〕

- **适合什么场景**：规格已经切成多张票，要一张张做出来。
- **技能顺序**：`to-tickets` 发完票 → 人手动数出阻塞已清空的票 → 开一个干净会话做 `implement <票号>` → 提交、清掉上下文 → 再开下一个会话做下一张票（循环）。
- **要留意的**：**没有自动派发**，开几个会话、按什么顺序做，都得人自己数、自己派。

### T. 评审的两条节奏（一票一审 + 分支点总审），并且换干净会话〔把握中等，建议负责人过一眼〕

- **适合什么场景**：票做完了，评审该什么时候跑、跑几遍。
- **技能顺序**：实现并提交 1 号票 → `code-review` 对这张票的 diff → 实现并提交 2 号票 → `code-review` → …… → 整条分支做完 → 对着你分叉出来的那个固定点做最后一次总审。
- **作者的补充**：逐票评审让每次 diff 足够小、Spec 轴只对一个清晰的规格负责；攒到最后总审能捞出票与票之间的相互作用；拿不准就两个都做。另外每次评审都可以换成干净会话里的 `/code-review`（理由见 B 条）。

### U. 架构报告之后：挑一条 → 谈定 → 写进规格 → 其余转工单〔把握高〕

- **适合什么场景**：翻新普查扫出一批「值得加深的模块」，你要把其中一条真正做成。
- **技能顺序**：`improve-codebase-architecture` → 人挑**一条**（一次会话只做一条）→ `grilling`〔含 `domain-modeling`〕→ 把决定写进 `to-spec`（作者原话：把选好的改进放进规格，不要直接冲进实现）→ `to-tickets` → `implement`；**其余候选不是丢掉，而是变成以后可以各自独立领走的工单**。

### V. 合并合干净了但行为不对：转去做诊断〔把握高〕

- **适合什么场景**：冲突已经解完、树是干净的，但合完之后代码行为不对，而你看不出为什么。
- **技能顺序**：`resolving-merge-conflicts` → 发现行为不对 → `diagnosing-bugs`（当 bug 诊断，不是继续解冲突）→ 若复盘发现代码没有能锁住这个 bug 的接缝 → 修完之后再交接给 `improve-codebase-architecture`。

### W. 性能退化：先量基线，再二分〔把握中等〕

- **适合什么场景**：一个端点变慢，或某次提交之后出现时序回退，而且你有「之前好／之后坏」两个状态可比。
- **技能顺序**：`diagnosing-bugs` 的性能分支——先保持一个能跑的反馈循环 → 量一条基线 → 在两个已知良好的状态之间二分缩小范围 → 定位后**先写回归测试再修** → 收尾。

### X. 功能落地后补上人手那一半：`wizard` 配 `implement`〔把握高〕

- **适合什么场景**：功能已经由 agent 建出来、代码也合并了，但要真正跑起来还差只有人能做的步骤——申请凭据、把 key 填进 CI secret、在第三方控制台里点开关、做一次性的切换。
- **技能顺序**：`implement`（遇到只有人能过的步骤）→ `wizard`（先生成有序阶段清单给人确认，再产出脚本，逐个开页面、逐项收值）→ **人**在自己机器上跑脚本，值直接落进 `.env` 与 GitHub secret（密钥不进模型上下文）→ 回到 `implement` 把功能走完。
- **可选收尾**：这条流程以后还要重复的话，脚本提交进仓库并从 README 链接过去；否则默认一次性、做完即删。

### Y. 动手前先用 `wizard` 摸底〔把握中等〕

- **适合什么场景**：还没决定做什么，但这件事很可能藏着只有人能办的前置条件（作者举的例子是「你没想到的那三个 API key」）。
- **技能顺序**：`wizard`（先划范围、扫出要人做的步骤与要采集的值）→ 想清楚要不要做 → 再走 `grill-with-docs` / `to-spec` 那条决定「做什么」的主干。
- **作者的分工**：决定做什么不是 `wizard` 的活，是 `grill-with-docs` 与 `to-spec` 的活。

### Z. 不写完整规格，直接测试先行建一个具体行为〔把握高〕

- **适合什么场景**：有一个具体行为要建、输入输出说得清（业务逻辑、请求/响应契约、一次转换、校验），但手里没有完整规格、也不想为它走 `to-spec` 那一棒。
- **技能顺序**：手上先有「具体行为 + 可观察的输出」→ 敲 `tdd` 开一场会话 → **先确认要测的接缝**（它的硬前置：写任何测试之前先把接缝写下来并问人；没确认过的接缝上不写测试）→ 按垂直切片跑红→绿（一个测试接一份最小实现）。
- **要留意的**：循环里若发现接口形状本身有疑问，转去查 `codebase-design` 的词汇；重构不属于这个循环，归评审阶段。

### AA. 设计一个已经选定好的模块〔把握高〕

- **适合什么场景**：你已经知道要动哪一块代码，要决定它的形状（接缝放哪、接口能压多小、某次抽取划不划算）。
- **技能顺序**：先确认「模块已经选定」（还不知道改哪个 → 走 E 或 U 条的普查）→ **点名一个驱动型技能来跑会话**（`grill-with-docs`、`improve-codebase-architecture`、`tdd` 三者之一）→ 把 `codebase-design` 垫在下面当词汇层（不是单独对着它说「开始」）。

### AB. 会话装不下时，把活交接进 `wayfinder`〔把握高〕

- **适合什么场景**：你正在一个会话里聊一个大工程，聊到会话本身已经撑不住，但这件事还没定稿；继续做只会一路退化。
- **技能顺序**：原会话 → `handoff`（把这次会话交接出去）→ 在新会话里用 `wayfinder` 把它画成决策地图 → 逐张解票 → 地图清明 → 交接给 `to-spec` → 并回主干。
- **与 H 条的区别**：H 条是「出去做一次原型再回来」，这一条是「换一条更宽的路继续走」。

### AC. 上下文快满但还没到拆票那一步：在阶段边界压缩〔把握高〕

- **适合什么场景**：你走在主链上（比如磨完想法、准备拆票），会话明显已经很长了，但还没走到 `to-tickets`。
- **技能顺序**：先判断「现在是不是阶段边界」→ 是边界 → `/compact`（**可以带一句指令**，作者的例子是 `/compact we're going to QA this area`）→ 在新会话里继续。
- **不要在阶段中途压缩**：还没到边界时，选「继续」或者把剩下的活拆给子代理。

### AD. 让探索的结果活过这次会话〔把握高〕

- **适合什么场景**：你做了原型或查了研究，答案拿到了，但东西本身（那段能跑的原型、那份带出处的研究笔记）不想丢、也不想留在主分支上发霉。
- **技能顺序**：探索（`prototype` 做出能跑的东西 / `research` 查出带出处的 Markdown）→ 答案定下来 → 原型提交到主分支之外的一次性分支 `prototype/<名字>`（不合并；研究结论放 `research/<名字>`）→ **在相关 issue 或地图那张票上留一个指回这条分支的指针** → 下一个接手的人顺着指针找到它。

### AE. 问卷带出去、再带回来〔把握高〕

- **适合什么场景**：一场 `grilling` 走到某一步停住了，而冒出来的问题只有别人能答——客户、领域专家、握有业务规则的高管、不跟你坐一起的同事。
- **技能顺序**：`grilling` 或 `grill-with-docs` 的会话卡住 → **在同一个会话里**跑 `to-questionnaire`（只问两轮：这份问卷给谁、你需要拿回什么）→ 产出一份文档 → 由**一个人**填（异步填或开会一起填）→ 答案回来后接三种去处之一：再跑一轮 `grilling`（作者列的第一个）、交给 `grill-with-docs`、或交给 `to-spec`（如果这件事正要进建造）。

### AF. `wayfinder` 把地图的一段交回 `grill-with-docs`〔把握中等〕

- **适合什么场景**：一张地图里，某一段的答案其实已经定了、只是还没写成文档。
- **技能顺序**：`wayfinder` 画地图、逐张解票 → 地图里有一部分可以就地交给 `grill-with-docs`（在仓库里把它问清楚，顺手把决定记进 `CONTEXT.md` 与 ADR）→ 再从 A 条主链往下走。
- **与 C 条的关系**：C 条写的是「整张地图清完之后交接给 `to-spec`」，这一条是「地图里的一段就地交给 `grill-with-docs`」，两种接法作者都写过。

### 另外三条不算「路」，但面板可能想显示

- **让 `domain-modeling` 真的跑起来**：在会话入口就**按名字点名**它、和驱动它的那个技能并列调用，别指望它被自动加载——作者自己说自动调用是它最弱的一环，判别信号是一场 `grilling` 跑完而 `CONTEXT.md` 完全没被动过。〔把握中等〕
- **自己写技能时，访谈那一段直接调 `/grilling`**：不要另写一套问题，调它能拿到同一套行为（按轮问整个前沿、每轮给推荐答案、前沿问空且用户确认才算完）。〔把握中等〕
- **黑话的两条路**：想从根上避免 → 开工时先做 `grill-with-docs`（它一边访谈一边把双方用的词落进 `CONTEXT.md`）；已经跟不上了 → 在当前这段对话里直接 `/wait-what` 让它重讲一遍。两者是替代关系，不是先后步骤。〔把握低，仅供参考〕

## 2. 每个技能一句话

「官网一句话」是官网详情页 `description` 的原文（照抄，未翻译）；「大白话」是我用中文说的意思；「在路里的位置」取作者自己的定位原话。

| 技能 | 官网一句话（原文） | 大白话 | 在路里的位置 |
| --- | --- | --- | --- |
| `/setup-matt-pocock-skills` | Set up one repo so the other skills know how it works. | 把一个仓库配好，后面所有技能才知道它怎么运转 | `the run-once setup for the engineering flow`，是别人都默认的前置，不是链上一步 |
| `/ask-matt` | Find out which skill to use for the situation you are in. | 不知道该用哪个技能时问它 | `a standalone router that sits over the whole set`，`never a step in a chain` |
| `/grill-with-docs` | Get interviewed about a plan, and record the decisions. | 被追问一遍方案，同时把决定记下来 | `the head of the main build chain`（主链链头） |
| `/to-spec` | Turn an agreed conversation into a written spec. | 把已经聊定的对话变成一份书面规格 | 主链一步，**只在跨多会话那条分支上**才存在 |
| `/to-tickets` | Split a spec into small tickets an agent can build. | 把规格拆成 agent 能一件件做的小工单 | 主链一步（常驻） |
| `/implement` | Build a finished spec into code, test-first. | 把定稿的规格做成代码，测试先行 | 主链的建造棒，倒数第二环 |
| `/code-review` | Review a diff against your standards and against the spec. | 拿改动对照标准和规格审一遍 | 主链链尾；也能单独用在任何分支或 PR 上 |
| `/wayfinder` | Chart a large effort as a map of decisions, and settle them. | 把一大块活画成一张决策地图，再逐条敲定 | `a situational on-ramp, not the default front door`；在 `to-spec` 处并回主链 |
| `/prototype` | Answer a design question with code you then delete. | 用一段做完就删的代码回答一个设计问题 | 随手可用的独立件；同时是别的技能会开的机器（`machinery another skill runs on`） |
| `/research` | Get a cited answer, read from primary sources. | 读一手资料，给一个带出处的答案 | 随手可用的独立件，喂给「想事情」的技能，不在建造链上 |
| `/improve-codebase-architecture` | Find the modules worth refactoring, as a visual report. | 找出值得重构的模块，出一份可视化报告 | `periodic maintenance`，在主链之外定期扫 |
| `/diagnosing-bugs` | Diagnose a hard bug, starting from a repro that fails. | 从一个失败的复现开始诊断难修的 bug | 随手可用的独立件，不留状态、不需要前置 |
| `/resolving-merge-conflicts` | Finish a merge or rebase conflict, hunk by hunk. | 一块一块把合并或变基冲突解决掉 | 随手可用的独立件，不依赖任何技能，完全在主干之外 |
| `/triage` | Sort raw issues into work someone can pick up. | 把原始议题整理成有人能领走的活 | `an on-ramp, not a step in the main chain` |
| `/wizard` | Generate a script that walks a human through setup. | 生成一个脚本，牵着人一步步做设置 | 随手可用的独立件，站在「自动化停止、人必须动手」那条线上 |
| `/grill-me` | Align on an idea before committing to it. | 在为某个想法投入之前先对齐 | 一个随处可用的独立件（`you can run anywhere, on anything`） |
| `/handoff` | Write up a long session so another agent can continue it. | 把一段长会话写下来，让另一个 agent 接着做 | 随手可用的独立件，位置在**会话与会话的接缝**上，不在建造链里 |
| `/to-questionnaire` | Turn open questions into a doc someone else fills in. | 把开放问题变成一份让别人填的文档 | 随手可用的独立件，**常在流程中间**用 |
| `/teach` | Learn a topic across many sessions that build on each other. | 跨多次会话、一层层往上地学一个主题 | 随手可用的独立件，不在建造链上，与工程流程不共享任何产物 |
| `/wait-what` | Ask the agent to say that again, in plain English. | 让 agent 用大白话把刚才那段重讲一遍 | 任何时刻、任何对话、任何技能内部都能用 |
| `/writing-for-agents` | How to write skills and other documents agents read. | 怎么写技能和别人给 agent 读的文档 | 随手可用的独立参考件，**在链上没有邻居** |
| `/codebase-design` | The vocabulary for designing deep modules. | 设计深模块用的那套词汇 | 工程类技能下面的词汇层，不是任何链上的一步 |
| `/domain-modeling` | Sharpen the words a project uses, and write them down. | 把项目用的词磨准，并且写下来 | 模型自动调用的参考件，跑在别的技能下面比单独跑多 |
| `/grilling` | The interview other skills run to stress-test a plan. | 别的技能用来把方案问穿的访谈 | 一个基元，不是你排的一步；两个正门是 `grill-me` 与 `grill-with-docs` |
| `/tdd` | The rules of the red-green-refactor loop. | 红绿重构循环的规矩 | 主链建造环节里的发动机，不是独立的一步 |

**注意 `tdd` 那一行**：官网描述还写着 red-green-**refactor**，但作者自己承认重构那一段已在 2026 年 6 月移除（issue #589 未关），现行只有 red → green。**面板上不要照抄这句 description。**

## 3. 跨会话与非顺序用法

这一节是「不看过教程就猜不到」的那部分，也是面板最该教的东西。

### 3.1 走两个来回那条（最重要）

见上面第 H 条。要点三个：原对话**不结束**；交出去是为了「搬」不是为了「省上下文」；答案要**交回来并引用**，不是开一条新主线。

### 3.2 上下文不够了该用哪个（一遍纠偏）

- 上下文快满、还是在做同一件事 → `/compact`（保意图）。
- 身后的一切都可丢 → `/clear`（什么都不保，且是单程票）。
- **这份活要搬到别的地方去** → `/handoff`（保「能移动」）。
- 任务边界够紧、你能离开键盘 → 委派子代理。
- 下一阶段需要这一段原样上下文 → 留在原会话继续。

作者另外提醒：`/handoff` 看着像通用桥、其实不是；`/compact` 是兜底而不是第一手。

### 3.3 哪些技能之间**必须**在同一个上下文里连着跑

- `to-spec` 与 `to-tickets` **之间不要** `/clear`、不要 `/compact`——同一个上下文窗口连跑。
- `grill-with-docs` 结束时**不要** `/clear`，把同一个会话直接交给 `to-spec`。
- `to-questionnaire` 必须同一个会话里跑（换会话会丢主题）。
- `grill-me` 要求在新会话里启动，但写 spec 之前又不要另起新会话（站点自相矛盾，见第 4 节）。

### 3.4 反过来，哪些地方要「开干净上下文」

- `to-tickets` 拆出来的每张工单**各占一个干净上下文窗口**，票与票之间要清干净；没有自动派发，要人手动派活。
- `code-review` 两条线各跑一个并行子代理，**以免互相污染上下文**，最后汇总。
- `teach` 靠文件夹而不是靠对话保持连续性。

### 3.5 不进主干的用法

- `resolving-merge-conflicts` 完全在主干之外、入向不依赖任何技能，但有一个明确的邻居：合干净了但行为不对时转去 `diagnosing-bugs`。
- `wizard` 站在「自动化止步、人必须动手」那条线上，产出给人跑的脚本。
- `wait-what` 可以在任何技能内部直接用。
- `to-questionnaire` 的下一个环节是**一个人**，不是另一个技能。
- `diagnosing-bugs` 修完之后，如果发现代码没有缝，会把活交接给 `improve-codebase-architecture`（这是维护组里唯一写明的交接）。

## 4. 不确定、对不上、以及原文没写的地方

这一节请原样保留给下游：面板上要显示的内容，凡是这里标了不确定的，都别写成确定的话。

### 4.1 网站与本地技能文件对不上（最要紧的一类）

1. **主干四跳里，本地只写了一跳。** 网站四个页面逐字给出 `grill-with-docs → to-spec → to-tickets → implement → code-review`；本地技能文件里只有 `implement` → `code-review` 是明写的，另外三跳（`grill-with-docs`→`to-spec`、`to-spec`→`to-tickets`、`to-tickets`→`implement`）**两头全缺**，`code-review` 发现问题后回到 `implement` 这条回头路也没写。
2. **跨会话那条路本地整条是空的。** `/handoff` 的本地原文没写什么时候该用、没写接手的人做完怎么办、没写「做完交回来」，也没写临时目录里的文件怎么被接手方找到；它要求文档里写一节「建议技能」，却一个技能名都不给。`/handoff` 与 `/prototype` 之间那座桥只写在 `/ask-matt` 一份里。
3. **`wayfinder` 与 `prototype` / `research` 是上下级，不是并列。** 网站把这三个放在同一组（03 Shaping），但网站详情页与本地原文都把 `prototype`、`research` 写成 `wayfinder` 地图上的票型；`prototype` 自己的原文**从不回头提 `wayfinder`**。
4. **`ask-matt` 说的技能总数是 22 个**，本地随包自带的 SKILL.md 是 25 个（官网首页也写 25）。作者在页面上自认这张表是手工维护、会落后于仓库。
5. **`/ask-matt` 的分法与官网首页 6 组不一样**：它自己在正文里就把技能分成主干 / 入口 / 词汇层 / 独立 / 前置五类（例如 `wayfinder` 归「入口」而官网归 03 Shaping；`tdd` 归主干而官网归 06 参考层）。
6. **`/diagnosing-bugs` 与 `/triage` 之间的缝**：作者在网站上写了它们怎么接，但同时承认 `neither file mentions the other`（两个技能文件彼此都不提对方），这条缝仍未修。

### 4.2 网站自身的矛盾（同一页或两页之间）

1. **`prototype` 的 description 说「用完就删」，同一页正文说现在不删了**（`Not any more.`，改成放在 `prototype/<名字>` 分支里、不合并）。
2. **`research` 票能不能并行**：`wayfinder` 页把「研究票由 `/research` 子代理并行跑」当现状讲，`research` 页说那是「v1.1 之后未发布的改动」。两页口径不一致。另外它明确说**后来的会话不会自动复用以前的研究文件**。
3. **`tdd` 的 description 还在说 red-green-refactor**，作者自己承认没跟着改（issue #589 未关）。
4. **`implement` 在提交前跑 `code-review`，而 `code-review` 看的是 `git diff <某个锚点>...HEAD`**——这时候还没有提交可看，两边都没修。
5. **`grill-me` 要求在新会话里启动，但写 spec 之前又明确不要另起新会话。**
6. **`code-review` 与 Claude Code 自带的同名命令冲突**，页面说这是最常被报告且未修的问题；它也不看未提交的改动；它的子代理会再调用 `/code-review` 并继续扩散（有报告超过 50 个代理）。

### 4.3 原文压根没写的地方

- 主干那条回头路：**官网上写了**（先提交、对着分叉点评审、拿到发现用 amend 或 fixup；`implement` 不处理评审发现、不勾工单复选框），**本地技能文件里没写**。
- `triage` 核验成立的真 bug 交给谁修。
- `improve-codebase-architecture` 那份报告与重构清单交给谁领走；谁在什么时机唤起它这次扫描。
- `wizard` 脚本跑完之后接着走哪一步；哪个技能会用到它配出来的值。
- `to-questionnaire` 收到答复之后接什么。
- `grilling` 被别的技能调用时的约定：`wayfinder`、`triage`、`improve-codebase-architecture` 都点名会跑它，但它的正文一个字都没写「传什么材料、接什么产物」。
- 谁在什么时机该唤起那些只能人手动敲的技能（本地有 12 个技能带 `disable-model-invocation: true`）。
- 阶段边界那棵**有序树的分支判断顺序**：只有 `ask-matt` 页承载，`handoff` 页只说树在别处，没画出怎么判。

### 4.4 编号与标签的可用性（做排序时要知道）

- 25 个详情页里**只有 7 页**头部带 `tags`，18 页没有这个字段（不是抓取失败，是站点格式不统一）。
- `phase-N` 编号只在 5 个技能上出现过：`grill-me` `phase-1`、`prototype` `phase-3`、`to-spec` `phase-4`、`to-tickets` `phase-5`、`handoff` 与 `tdd` 都是 `phase-6`。
- 而且编号与链条位置**对不上**（`to-spec` 是链上第 2 环却是 `phase-4`）。**所以 phase 编号不能直接当面板排序用**，含义站点也没解释。
- 另一类 tags 是主题词（`build-the-right-thing`、`ship-solid-code`、`get-better-results`、`test-and-evaluate`），不是顺序。

### 4.5 三条互不相同的分组依据（交给定版票拍板）

本次整理手里出现了三套都「有出处」的分组，它们不一样，面板只能选一套或做映射：

| 分组依据 | 出处 | 分出来长什么样 |
| --- | --- | --- |
| 官网首页 6 组 | `aihero.dev/skills` 首页 | 01 入门 / 02 主干 / 03 塑形 / 04 维护 / 05 生产力 / 06 参考 |
| 作者自己的路由器 | 本地 `/ask-matt` 正文 | 主干 / 入口 / 词汇层 / 独立 / 前置 |
| 每页 Where it fits | 各技能详情页 | 主链第 n 环 / 情境入口 / 并行车道 / 独立件 / 参考层 |

第一轮 grill 已经定下「界面先按官网 6 组保底」，但**第二套与第三套更贴近技能的真实用法**（例如 `tdd` 官网归参考层、实际是主链的发动机；`wayfinder` 官网与别人并列、实际是它们上位的调度方）。

## 5. 证据在哪里

本报告是综合稿，原始整理稿全部留在 `research/642-parts/` 下，引用原文时可回查：

| 文件 | 内容 |
| --- | --- |
| `01a-setup-matt-pocock-skills.md`、`01b-ask-matt.md` | 入门组两个技能的本地原文整理 |
| `02-main-flow.md` | 主干五个技能的本地原文整理 |
| `03-shaping.md` | 塑形组三个技能的本地原文整理 |
| `04-upkeep.md` | 维护组五个技能的本地原文整理 |
| `05-productivity.md` | 生产力组六个技能的本地原文整理 |
| `06-reference.md` | 参考层四个技能的本地原文整理 |
| `web-01.md` 到 `web-05.md` | 官网 25 个详情页（`.md` 镜像）的整理，英文原文引用 |
| `matrix-local.md` | 25 个技能的本地对照小表 + 本地缺失衔接清单 |
| `matrix-web.md` | 25 个技能的官网对照小表 + 主链原话 + 阶段边界五选项 |

来源网址：官网首页 `https://www.aihero.dev/skills`，每个技能详情页 `https://www.aihero.dev/skills-<技能名>`（markdown 版为同址加 `.md`）；本地原文取自插件随包目录 `bundled-skills/<技能名>/`。

## 6. 这一票没做什么

- 没有设计界面、没有写生产代码、没有替人拍板面板该放几条工作流——那是原型票 #643 与定版票 #644 的事。
- 没有核对本会话技能目录里少了一半技能名这件事：本会话只挂了插件自带的几个技能，与这套技能本身的完整性无关，不当作问题。
- 没有推断 `phase-N` 编号的含义，也没有用它排序。

## 7. 这次的核验是怎么做的、还剩什么没查

核验用一次多代理编排跑完（不是人工抽查）：

1. **逐条核验**：A 到 O 十五条各派一个独立代理，先读报告里这一条，再回原始整理稿逐句核对，专门找「没依据、说过头、与原始稿对不上」的地方。
2. **找漏网的路**：从 8 个角度（官网 6 组 + 跨会话与换上下文 + 作者路由器 `ask-matt` 的分类）扫，提出报告没覆盖的路。
3. **对抗复核**：对每一条被标记的问题与新提议，派第二个独立代理**默认立场是「这条不成立」**，去原始整理稿找反证；找不到反证才留下来。

结果：15 条里只有 1 条完全无异议；标记出 41 处问题；提出 28 条新路（去重后补进 17 条，见 1.1 节）。复核阶段 16 条主张里推翻了 6 条，留下的 10 条已经改进报告。

**还没查的（交由下游票与负责人决定）**：

- 这次核验只覆盖了 A 到 O；1.1 节补进来的 P 到 AF 是**核验代理提出的、尚未经过同等强度的复核**（各自带了把握程度，中等与低的那几条请过一眼）。
- 报告里写的英文原话都来自 `research/642-parts/` 那 14 份整理稿，**没有回到官网页面逐字比对过一遍**；如果面板要直接展示某句英文原文，落地前值得再核一次。
- 三套分组依据的冲突（第 4.5 节）没有在这次核验里判谁对，那是定版票的事。

## 进度：95%

下一步：等负责人确认这份清单是否完整（现在是 A 到 AF 共 32 条）、有没有漏掉的工作流；确认后关闭本票，并把它作为原型票 #643 与定版票 #644 的输入。报告已按核验结果改过一轮，本轮改什么见文件开头那段提示。
