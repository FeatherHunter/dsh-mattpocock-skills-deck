# 原作者网站上全部可用的工作流（研究票 #642）

本文件是 wayfinder 地图 #641（「悬浮技能面板按工作流分组」）下研究票 #642 的交付物。它回答一个问题：**原作者 Matt Pocock 这套技能里，人到底可以照着走哪些路**——每条路上技能按什么顺序、什么时候进入、走到哪一步算结束或者回到哪一步。

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
- **走到哪算结束（或回到哪）**：`code-review` 是链尾（`the review step at the tail of the build chain`）。**评审发现问题之后要不要回到 `implement`，两边原文都没写**。
- **纪律**：`to-spec` 与 `to-tickets` 之间**不要** `/clear`、不要 `/compact`，同一个上下文窗口连着跑；`to-tickets` 之后每张票各占一个干净上下文，票与票之间要清干净。

### B. 短路径：同一个会话直接做完

- **适合什么场景**：改动小，一个会话装得下。
- **技能顺序**：`grill-with-docs` → `implement`〔内含 `tdd`〕→ `code-review`。
- **什么时候进入**：聊完发现没那么大，就不用拆规格与工单。
- **说明**：`to-spec` 那一棒只在「跨多个会话」的分支上才存在，不是每次都要走。

### C. 大工程先划路（`wayfinder` 情境入口）

- **适合什么场景**：一大块活，一个 agent 会话装不下，路还看不清。
- **技能顺序**：`wayfinder`（把这件事画成一张决策地图）→ 逐张解票（票型有四种：`research`、`prototype`、`grilling`、`task`）→ 地图清明 → 交接给 `to-spec` → 并回上面 A 那条主干。
- **什么时候进入**：作者原话是 `a situational on-ramp, not the default front door`（情境入口，不是默认前门），由人手动唤起。
- **走到哪算结束**：走到「前方再没有要拍板的事」就结束，`wayfinder` 自己不写代码，收尾交接给 `to-spec`。
- **注意**：作者专门说过，把主干写成 `wayfinder → to-spec → to-tickets → implement → code-review` 是**错的**——那是把情境入口当成了必经的第一棒。

### D. 接收外来活（`triage` 这条并行车道）

- **适合什么场景**：活是外面报进来的（别人的 issue、外部 PR），不是你自己起的事。
- **技能顺序**：`triage`（分类 → 轻量核验 → 需要时 `grilling` + `domain-modeling` → 写一份 agent brief）→ 在 `ready-for-agent` 汇合 → 由 `implement` 领走。
- **什么时候进入**：作者原话 `only for incoming issues, not for issues you created yourself`。
- **走到哪算结束**：交出 agent brief（一份给无人值守 agent 照着做的说明书）就算这一棒结束；**核验成真的 bug 交给谁修，原文没写**。

### E. 定期保养（`improve-codebase-architecture`）

- **适合什么场景**：每隔几天扫一次代码库，攒活，不干活。
- **技能顺序**：`improve-codebase-architecture`（扫出「值得加深的模块」→ 一份可视化 HTML 报告）→ 人挑一条 → `grilling`〔含 `domain-modeling` 当场写 `CONTEXT.md`、必要时提 ADR〕→ 产出的想法回流主干的 `grill-with-docs` 或 `to-spec`。
- **什么时候进入**：`periodic maintenance`，`run it every few days, outside any chain, to queue up work rather than to do it`。
- **走到哪算结束**：报告出来、人挑定一条、当场 grill 完。**那份重构清单交给谁领走，原文没写。**

### F. 难 bug 诊断（`diagnosing-bugs`）

- **适合什么场景**：难修的 bug、性能退化——从一个「能复现的失败」开始。
- **技能顺序**：`triage`（如果这活是外面报进来的）→ `diagnosing-bugs` → 修完并补回归测试 → 若顺带发现代码没有缝、不好测，则 hand off 给 `improve-codebase-architecture`。
- **什么时候进入**：人可以喊它；它是少数模型也能自己触发的技能（没有 `disable-model-invocation`）。
- **走到哪算结束**：结论写进提交信息或 PR 说明，让下一个调试的人能接上。
- **一处要留意的缝**：`triage` 与 `diagnosing-bugs` 的交接，作者自己承认**两个技能文件里都没写对方**，是用户发现后反馈的。

### G. 冲突收尾（`resolving-merge-conflicts`，完全独立）

- **适合什么场景**：merge 或 rebase 冲突正卡着。
- **技能顺序**：`resolving-merge-conflicts`，逐个 hunk 解决。
- **什么时候进入**：任何冲突现场。
- **走到哪算结束**：冲突清完。它在主干之外（`It sits off the main idea-to-ship flow entirely`），且作者明确说它**不提供 `--abort`**。

### H. 跨会话走两个来回（`handoff` ↔ `prototype`）—— 负责人点名要的那条

- **适合什么场景**：你已经在一个设计对话里陷得很深，遇到一个「只有跑代码才能回答」的问题，而你不想把好容易建立起来的这条线索花在试错上。
- **技能顺序**：原对话 → `handoff` 把上下文交接出去 → 新会话（在原型目录里）用 `prototype` 把问题答出来 → 把答案 `handoff` 交回来 → 原对话引用这份答案。
- **作者原话**：`Hand off to a prototype session, get the answer, hand the answer back, and reference it from the original thread. Two crossings, one live conversation, nothing re-explained.`（走两个来回，一条活着的对话，不用重讲一遍。）
- **关键点**：**原对话不结束**（`You stay in your session`）。这跟「会话快满了换个窗口」完全不是一回事。
- **什么时候进入（作者给的四种情形，就是全部触发条件）**：

  | 情形 | 为什么需要一份文件 |
  | --- | --- |
  | 换工具（Claude → Codex） | 新工具看不见旧的上下文 |
  | 换目录或换仓库 | **做原型目录是最常见的一种** |
  | 交给同事 | 对方需要一份他能读的东西 |
  | 中途发现的支线任务 | 你继续干，另起一个 agent 去做那条支线 |

- **走到哪算结束**：答案交回原对话、原对话引用它。
- **要留意的坑**：交接文档写在操作系统的临时目录里（**明确不是当前工作区**），而临时目录可能被系统清掉；接手方怎么找到它、路径怎么传，技能原文没写全。

### I. 阶段边界五选一（`continue` / `/clear` / `/handoff` / 委派子代理 / `/compact`）

- **适合什么场景**：一个阶段做完了，下一步该不该换上下文。
- **谁掌管这棵树**：`ask-matt`（作者说这棵**有序树**画在它那里）。
- **五个选项各保全什么**（作者原话）：

  | 选项 | 保全什么 | 什么条件下选 |
  | --- | --- | --- |
  | 继续（留在原会话） | 唯一保持「会话本身是主源」 | 下一阶段需要这一段的原样上下文，或者你还有可用余量 |
  | `/clear` | 什么都不保 | 身后的一切都可丢 |
  | `/handoff` | 「这份活能移动」 | 有东西要**搬**：换工具、换目录、交给同事、分叉支线 |
  | 委派子代理 | 你不在键盘边也能跑 | 任务边界足够紧 |
  | `/compact` | 你的意图 | 以上都不是（兜底，且大多数时候落在这里） |

- **纠偏**：`/handoff` 看着像「会话之间的通用桥」，**它不是**；`/compact` 是树底兜底，**不是第一手**。

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

- `resolving-merge-conflicts` 完全在主干之外，不接任何人也不回到哪里。
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

- 主干那条回头路：`code-review` 审出问题之后怎么办。
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

## 进度：95%

下一步：等负责人确认这份清单是否完整、有没有漏掉的工作流；确认后关闭本票，并把它作为原型票 #643 与定版票 #644 的输入。
