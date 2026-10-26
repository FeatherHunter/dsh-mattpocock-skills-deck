# 网站详情页摘录（第 5 组，5 页）

本文件只整理作者 Matt Pocock 官网技能详情页的 markdown 版本（`https://www.aihero.dev/skills-<技能名>.md`），逐页一节。原文引用一律保留英文。

---

## 1. writing-for-agents

来源：`https://www.aihero.dev/skills-writing-for-agents.md`（HTTP 200）

### 页面标题与 description 原文

文件头部 YAML：

```yaml
title: "The /writing-for-agents Skill"
slug: "skills-writing-for-agents"
type: "post"
description: "How to write skills and other documents agents read."
updatedAt: "2026-08-24T09:14:47.195Z"
```

### tags 原文

**本页 YAML 里没有 `tags` 字段。** 头部只有 `title` / `slug` / `type` / `description` / `updatedAt` 五项，没有 `phase-N` 之类的编号。照实记录，不补。

### 「Where it fits」原文摘录（整节）

> This is a reach-for-it-anytime standalone reference. It has no neighbour in the chain because it sits underneath the whole set rather than beside any one skill: every skill here was written against it, and the documents the other skills leave behind (a `CONTEXT.md` and its ADRs, a spec, a ticket) are exactly the text it governs once an agent has to read them. When you're unsure which skill or flow fits a task, [ask-matt](https://aihero.dev/skills-ask-matt) routes you over the whole set.

要点（供参考）：本页明确写它是 **reach-for-it-anytime standalone reference**（随时可取的独立参考件），且 **has no neighbour in the chain**——不在任何链条里，因为它垫在整个技能集下面，而不是挨着某一个技能。它管的是别的技能留下的文档（`CONTEXT.md` 及其 ADR、spec、ticket）在被 agent 阅读时的写法。另提到拿不准该用哪个技能或哪条流程时，由 `ask-matt` 负责在整个技能集上做路由。

### 「When to reach for it」要点

原文整节：

> Type `/writing-for-agents`, or the agent reaches for it on its own when you're creating or editing a skill, or modifying `AGENTS.md` or `CLAUDE.md`.
>
> Reach for it by hand for everything else an agent reads: your docs, specs and [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket), system and [AFK](https://www.aihero.dev/ai-coding-dictionary/afk) prompts. The test is one question: does an agent read this? And it does not matter how the document gets in front of it, whether a pointer names it, a human pastes it, or it simply sits in the repo. For working out what a codebase actually contains in the first place, use [grill-with-docs](https://aihero.dev/skills-grill-with-docs); this reference governs how a document reads, not what it knows.

- 该用的场景：创建 / 编辑技能；改 `AGENTS.md` 或 `CLAUDE.md`（这两类 agent 会自己伸手拿）。手动触发的场景：任何「agent 会去读」的文档——docs、spec、ticket、system prompt、AFK prompt。判断标准只有一个问题：**does an agent read this?**
- 不该用的场景（边界）：要先摸清代码库里到底有什么内容，那是 `grill-with-docs` 的活；本技能只管文档「读起来怎样」，不管文档「知道什么」。
- 触发方式：可打字 `/writing-for-agents`，也可由 agent 自己在上述场景自行取用。

### 这一页里出现的其它技能

| 技能名 | 出现情境 |
| --- | --- |
| `grill-with-docs` | 说明边界：要弄清代码库实际包含什么内容时用它，而不是用 `writing-for-agents`。原文：`For working out what a codebase actually contains in the first place, use grill-with-docs` |
| `ask-matt` | 推荐 / 路由：不确定哪个技能或哪条流程合适时，由它负责在整个技能集上做路由 |

另：本页提到旧名 `writing-great-skills`（v1.1 之前叫这个名字，现已改名）。

### 页面里写明的顺序与衔接

- 本页**没有**写「做完 X 就去做 Y」式的顺序衔接；相反，它明确说自己不在链条上（`It has no neighbour in the chain`）。
- 本页**没有**提到 `/handoff`、`/compact`、`/clear`、子代理（subagent）、换会话这类跨会话用法。
- 与顺序相关的唯一一句是改名沿革：`It was called writing-great-skills until v1.1.`（v1.1 改的名，没有 alias，需按新名重装）。

### 抓不到或对不上的地方

- 本页 YAML 无 `tags` 字段，因此拿不到 `phase-N` 编号，无法判断作者给它排的先后位置。如实记录，不猜。
- 页面本身抓取正常，内容不是占位。

---

## 2. codebase-design

来源：`https://www.aihero.dev/skills-codebase-design.md`（HTTP 200）

### 页面标题与 description 原文

文件头部 YAML：

```yaml
title: "The /codebase-design Skill"
slug: "skills-codebase-design"
type: "post"
description: "The vocabulary for designing deep modules."
updatedAt: "2026-08-24T09:14:47.195Z"
```

### tags 原文

**本页 YAML 里没有 `tags` 字段。** 头部同样只有 `title` / `slug` / `type` / `description` / `updatedAt` 五项，没有 `phase-N` 编号。照实记录，不补。

### 「Where it fits」原文摘录（整节）

> `codebase-design` is a **reach-for-it-anytime standalone**, and the vocabulary layer underneath the engineering skills rather than a step in any chain. Its closest neighbour is [domain-modeling](https://aihero.dev/skills-domain-modeling), the parallel reference for the *problem domain*'s words rather than the module's shape. The two are usually wanted together, since naming a deep module well needs both. [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) is the other: it surveys a codebase for deepening candidates and writes every one of them in this glossary, so it finds the module and this skill is the bench you design it on. When you're unsure which skill or flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

要点：本页明确写它是 **reach-for-it-anytime standalone**，是垫在工程类技能下面的**词汇层**，而**不是任何链条上的一步**（`rather than a step in any chain`）。它最贴近的邻居是 `domain-modeling`（那是「问题域」用词的对位参考件，本技能管的是「模块形状」用词），作者说两者**通常要一起用**，因为要给一个深模块起好名字两样都需要。另一个是 `improve-codebase-architecture`：它负责在代码库里普查出可以加深的候选，并且把每一个都写成这套词汇，所以「它找出模块，本技能是你设计该模块的工作台」。拿不准时由 `ask-matt` 路由。

### 「When to reach for it」要点

原文：

> Type `/codebase-design`, or the agent reaches for it automatically when a design task fits.
>
> Reach for it when you already know which code you're redesigning and you need to think about its shape: where the seam goes, how small the interface can get, whether an extraction is earning its keep. It is also what you reach for to settle an argument about what a word means.
>
> Several skills sit close to it. Which one you want depends on what the actual problem is:

| The problem | The skill |
|---|---|
| The shape of one module: its interface, its seam, its depth | `codebase-design` |
| The *words of the domain*: "account" means three things, two people mean different things by "cancellation" | [domain-modeling](https://aihero.dev/skills-domain-modeling) |
| You don't yet know *which* module to redesign | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) (the survey that finds candidates) |
| You want the design argued with, not just named | [grilling](https://aihero.dev/skills-grilling) |
| There's a concrete behaviour to build and you want tests that survive a refactor | [tdd](https://aihero.dev/skills-tdd) |

- 该用：你**已经知道**要重设计哪块代码、需要想它的形状（接缝放哪、接口能多小、某次抽取是否划算）时；也可以用来「裁定一个词到底什么意思」的争论。
- 不该用 / 边界：还不知道该改哪个模块时用 `improve-codebase-architecture`（普查找候选）；要用词的问题归 `domain-modeling`；要有人跟你的设计争辩而不是只给它命名，用 `grilling`；有具体行为要建、且要能扛住重构的测试，用 `tdd`。
- 本页反复强调它是**参考件而非流程**：`It is a reference, not a process. There is no loop to run, no artifact it produces, no checkpoint where it asks you a question.` 并且警告：没有流程也没有停止规则的技能，你对着一个会话说 "go" 时它就会自己临时编一套。已知问题 issue #449：有人拿它烧了 100k tokens 去重设计没要求的东西。作者的变通做法是**点名一个「驱动型技能」而让本技能垫在下面**：`/grill-with-docs`、`/improve-codebase-architecture` 或 `/tdd` 搭配 `codebase-design` 作为词汇。该 issue 仍未关闭。

### 这一页里出现的其它技能

| 技能名 | 出现情境 |
| --- | --- |
| `domain-modeling` | 对比 / 分工：管「问题域的用词」，与本技能（模块形状用词）是并行的参考件，通常要一起用；对照表里也作为「词的问题」那一行的答案 |
| `improve-codebase-architecture` | 分工 / 衔接：还不知道该重设计哪个模块时用它做普查找候选；它把候选全写成这套词汇，是「找出模块」的一方，本技能是设计该模块的工作台 |
| `grilling` | 对比：想让设计被争辩（而非只被命名）时用它 |
| `tdd` | 对比 / 衔接：有具体行为要建、要能扛重构的测试时用它。本页另有一大段说明二者关系：`tdd` 曾经自带深模块注释，v1.0 移出改为共用本技能，但替代的指针当时忘了加，导致 `tdd` 自己定义 "seam" 而不引用本技能；**现在缺口已补上**——当开放问题是接口形状而不是测试时，`tdd` 里的指针就会指过来。分工是：`tdd` 仍然拥有「你测试时所处的边界」这层 seam 含义，本技能拥有其背后的模块形状 |
| `ask-matt` | 推荐 / 路由：不确定用哪个技能或流程时由它路由 |
| `setup-ts-deep-modules` | 举例：仓库 `in-progress/` 目录下的技能，铺 `src/packages/<name>/index.ts` 约定，属于 beta 通道、**没有详情页**，也不带 lint 规则。本页提到它但站上没有对应 .md 页 |
| `design-an-interface` | 沿革说明：该技能已被移除并并入本技能，其 "design it twice" 手法以 `DESIGN-IT-TWICE.md` 形式在本技能里发布 |
| `grill-with-docs` | 举例：作为「驱动型技能」的推荐搭配之一（`/grill-with-docs` 配 `codebase-design` 当词汇） |
| `/interface-design` | 说明：有人要求单独做一个 `/interface-design` 技能，作者说该理念已在本技能里，**不打算再开单独技能**；若你是来找这两个名字的，就是这一页 |

（注：`design-an-interface`、`setup-ts-deep-modules`、`/interface-design` 三项在本页是作为「改名 / 移除 / 被要求新增」的说明出现的，不是本页链接出去的技能页。）

### 页面里写明的顺序与衔接

- 本页清楚写明**没有链条顺序**（`rather than a step in any chain`），也没有「做完 X 就去做 Y」的句式。放出的衔接关系都是**搭配式**而非先后式：`improve-codebase-architecture` 找出候选 → 本技能提供设计该模块的词汇台（作者原话：`it finds the module and this skill is the bench you design it on`）；`domain-modeling` 与本技能「usually wanted together」。
- 关于跨会话：本页**没有**提 `/handoff`、`/compact`、`/clear`、换会话。
- 本页**提到了子代理（sub-agents）**，但不是在讲跨会话：`DESIGN-IT-TWICE.md` 会「spins up parallel sub-agents」并行产出 3 个以上截然不同的接口设计，再按 depth、locality、seam placement 比较。同一段后面又指出该做法可移植性差：`DESIGN-IT-TWICE.md` 写的是「spawn 3+ sub-agents in parallel using the Agent tool」，用的是 Claude Code 的工具名，其它 harness（如 Codex）可能没有这个名字下的东西，该并行设计阶段不如技能元数据看起来那么可移植（issue #564，未关闭）。
- 另有用例提到：agent 被要求「resume in /codebase-design and drive the open decisions」时，会去抓 `DESIGN-IT-TWICE.md` 里的并行子代理那段最像「动作」的内容——这是作者举的反面例子，不是推荐用法。

### 抓不到或对不上的地方

- 本页 YAML 无 `tags` 字段，拿不到 `phase-N` 编号。如实记录，不猜。
- 本页提到的 `setup-ts-deep-modules` 明确写着 **no docs page**（beta 通道技能，没有详情页），所以它没有 `skills-setup-ts-deep-modules.md` 可抓。
- 本页提到 `grill-with-docs` 但没有给它站内链接（只写了 `/grill-with-docs` 名字，链接指向的是 `domain-modeling` / `improve-codebase-architecture` / `grilling` / `tdd` 等）。另外 `writing-for-agents` 页里的 `grill-with-docs` 链接是 `https://aihero.dev/skills-grill-with-docs`（无 www）。两页对同一技能给的链接写法不一致，照实记录。
- 页面本身抓取正常，内容不是占位。

---

## 3. domain-modeling

来源：`https://www.aihero.dev/skills-domain-modeling.md`（HTTP 200）

### 页面标题与 description 原文

文件头部 YAML：

```yaml
title: "The /domain-modeling Skill"
slug: "skills-domain-modeling"
type: "post"
description: "Sharpen the words a project uses, and write them down."
updatedAt: "2026-08-24T09:14:47.195Z"
```

### tags 原文

**本页 YAML 里没有 `tags` 字段。** 头部同样只有 `title` / `slug` / `type` / `description` / `updatedAt` 五项，没有 `phase-N` 编号。照实记录，不补。

### 「Where it fits」原文摘录（整节）

> `domain-modeling` is a **model-invoked reference** that runs *underneath* other skills more often than it runs on its own. [grill-with-docs](https://aihero.dev/skills-grill-with-docs) drives it through a grilling session, [wayfinder](https://aihero.dev/skills-wayfinder) loads it while charting a map, [triage](https://aihero.dev/skills-triage) uses it to keep [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) in the project's own words, and [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) calls it as decisions crystallise. Its closest sibling is [codebase-design](https://aihero.dev/skills-codebase-design): the two are the vocabulary layer under everything else, this one for the *domain*, that one for the module's *shape*. It is also reachable directly, when you want the discipline without committing to the steps of whatever skill would normally pull it in. When you are unsure which skill fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

要点：本页定位是 **model-invoked reference**（由模型调用，不是人来点的驱动件），而且**跑在别的技能下面的时候比单独跑的时候多**。四个调用它的地方：`grill-with-docs` 在一次 grilling 会话里驱动它、`wayfinder` 画地图时加载它、`triage` 用它让 ticket 保持项目自己的用词、`improve-codebase-architecture` 在决策成形时调用它。最贴近的同类是 `codebase-design`——两者共同构成垫在一切下面的词汇层，一个管**域**，一个管**模块形状**。它**也可以被人直接取用**（`It is also reachable directly`），当你只想要这份纪律、不想跟着那个通常会拉起它的技能走完整套步骤时。拿不准用哪个时由 `ask-matt` 路由。

### 「When to reach for it」要点

原文：

> Type `/domain-modeling`, or the agent reaches for it automatically when a task fits. In practice, automatic invocation is the weakest part of the skill: when `grill-with-docs` or `wayfinder` say to load it, [models](https://www.aihero.dev/ai-coding-dictionary/model) frequently load `grilling` and skip this one. If a [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) session runs and `CONTEXT.md` is untouched at the end, that is what happened; invoke it by name alongside the other skill.
>
> Reach for it when the *words* are the problem:

| The situation | The move |
| --- | --- |
| Two people mean different things by "cancellation" | `domain-modeling`: pick the canonical term, list the other under `_Avoid_` |
| "Account" is doing three jobs in three files | `domain-modeling`: split it into Customer and User |
| You just made a hard-to-reverse architectural choice | `domain-modeling`: it offers an ADR, if the choice clears the bar |
| The module's *shape* is the problem: where the seam goes, how deep the interface is | [codebase-design](https://aihero.dev/skills-codebase-design) |
| You want the whole plan interrogated before you build | [grill-with-docs](https://aihero.dev/skills-grill-with-docs), which drives this skill underneath |
| You want a term looked up, not changed | Nothing. Read `CONTEXT.md`. It is a file. |

- 该用：**问题出在「词」上**的时候。三个典型情境：两人对 "cancellation" 理解不同（选定规范词，另一个列入 `_Avoid_`）；"Account" 在三个文件里干三份活（拆成 Customer 和 User）；刚做了一个难以逆转的架构决定（达到门槛就出一份 ADR）。
- 不该用 / 边界：模块**形状**问题（接缝放哪、接口多深）归 `codebase-design`；要整份计划先被审问归 `grill-with-docs`（它在下面驱动本技能）；只是想**查**一个词、不是要改它——什么都不用，直接读 `CONTEXT.md`，它就是个文件。
- 作者自陈的弱点：自动调用在这个技能上表现最差——当 `grill-with-docs` 或 `wayfinder` 叫人加载它时，模型经常加载成 `grilling` 而跳过它。判别方法：一次 grilling 会话跑完而 `CONTEXT.md` 完全没被动过，就是发生了这件事；这时**按名字明确点名**它，与另一个技能并列调用。

### 这一页里出现的其它技能

| 技能名 | 出现情境 |
| --- | --- |
| `grill-with-docs` | 主要调用方 / 衔接：在一次 grilling 会话里驱动本技能；用户可用 `/grill-with-docs ...` 直接下指令（例：`/grill-with-docs make my CONTEXT.md more concise...`、`/grill-with-docs help me scaffold my existing repo with a CONTEXT.md`）；「要整份计划先被审问」那一行的答案，且注明它会在下面驱动本技能 |
| `wayfinder` | 调用方：在 charting a map 时加载本技能 |
| `triage` | 调用方：用它让 ticket 保持项目自己的用词 |
| `improve-codebase-architecture` | 调用方：在决策成形（decisions crystallise）时调用本技能 |
| `codebase-design` | 对比 / 姊妹技能：两者是垫在一切下面的词汇层，本技能管 domain，它管模块 shape；模块形状类问题归它 |
| `grilling` | 对比 / 失败模式：`grill-with-docs` 或 `wayfinder` 叫人加载本技能时，模型常错加载 `grilling` 而跳过本技能；诊断信号是 `CONTEXT.md` 没变。页内 `grilling` 是作为 AI 编码词典词条链接的，不是技能页链接 |
| `ask-matt` | 推荐 / 路由：不确定用哪个技能时由它路由 |
| `/ubiquitous-language` | 沿革说明：已移除（且不是废弃），职责移入本技能——本技能持续维护整个模型，而不是从一次对话里倾倒出一份词汇表；词汇强制现在跑在 grilling、triage、mapping **下面**，不再是一道独立的手工步骤 |

### 页面里写明的顺序与衔接

- 本页**没有**写「做完 X 就去做 Y」式的硬顺序；它给的是**「被谁调用」**的关系图，并在正文里说明这个技能是「在下面跑」而不是「排在哪一步之后」。
- 值得注意的**触发时机**衔接（原文）：`when grill-with-docs or wayfinder say to load it ... invoke it by name alongside the other skill.`——即由别的技能发起加载，但要人点名以免被错加载。
- 另有两条**时机 / 内联**规定（原文）：`It writes a resolved term into CONTEXT.md at the moment it is resolved, in the middle of the conversation, rather than producing a tidy glossary at the end`；以及 `CONTEXT.md changes during the conversation, not in a burst at the end.`
- 产物是**懒惰创建**的：`Nothing needs to exist before you start, and nothing is created speculatively.` `CONTEXT.md` 由第一个定下来的词创建；`docs/adr/` 由第一份够门槛的 ADR 创建。
- 关于跨会话：本页**没有**提 `/handoff`、`/compact`、`/clear`、子代理（subagent）、换会话。但有一句明确涉及跨会话后果的警示：`an unreviewed, agent-authored glossary is worse than none: it becomes confident-sounding lore that later sessions treat as truth.`（未经审阅、由 agent 撰写的词汇表比没有更糟——它会变成说得头头是道的传说，被后续会话当作事实）。

### 抓不到或对不上的地方

- 本页 YAML 无 `tags` 字段，拿不到 `phase-N` 编号。如实记录，不猜。
- 本页没有「做完 X 就去做 Y」的链条句，也没有链条编号，叙事方式是「被谁调用」。
- 页面自己承认的两处权威缺口，照实记录：跨引用只覆盖**代码**与已提交的 `CONTEXT.md`/ADR，**不查 issue tracker**，所以几个月前在已关闭 issue 里争定过的命名冲突会被当成新问题再抛出来（issue #717 未关闭，变通办法是把指令写进自己的 `docs/agents/domain.md`）；`CONTEXT.md` 会膨胀，技能自身的指引「还不足以在一开始就防止它长大」（对应 issue 未关闭）。
- 页面本身抓取正常，内容不是占位。

---

## 4. grilling

来源：`https://www.aihero.dev/skills-grilling.md`（HTTP 200）

### 页面标题与 description 原文

文件头部 YAML：

```yaml
title: "The /grilling Skill"
slug: "skills-grilling"
type: "post"
description: "The interview other skills run to stress-test a plan."
updatedAt: "2026-08-24T09:14:47.195Z"
```

### tags 原文

**本页 YAML 里没有 `tags` 字段。** 头部同样只有 `title` / `slug` / `type` / `description` / `updatedAt` 五项，没有 `phase-N` 编号。照实记录，不补。

### 「Where it fits」原文摘录（整节）

> `grilling` is a **primitive**, not a step you schedule: the single source of truth for the interview technique, kept in one place so every skill that needs an interview reaches for it instead of inventing one. [grill-me](https://aihero.dev/skills-grill-me) and [grill-with-docs](https://aihero.dev/skills-grill-with-docs) are its two user-invoked front doors, and `grill-with-docs` is where the main build chain begins, ahead of [to-spec](https://aihero.dev/skills-to-spec). [wayfinder](https://aihero.dev/skills-wayfinder) runs it to resolve decision tickets, [triage](https://aihero.dev/skills-triage) to grill a vague report into a workable one, and [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) to walk the tree once you have picked a candidate to deepen. When you are unsure which entry point fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

要点：本页定位是 **primitive（基元）**，明确写 **not a step you schedule**（不是你去排的一步）——它是「访谈技术」这件的唯一出处，集中放一处，让每个需要访谈的技能都来取，而不是各自造一个。`grill-me` 与 `grill-with-docs` 是它**两个由用户触发的正门**（`two user-invoked front doors`）。本页另有一句关键的链条定位：**`grill-with-docs` 是主建造链条的起点，排在 `to-spec` 之前**（原文：`grill-with-docs is where the main build chain begins, ahead of to-spec`）。三个调用方：`wayfinder` 用它解决 decision ticket、`triage` 用它把含糊报告 grill 成能做的、`improve-codebase-architecture` 在选定要加深的候选后用它走这棵树。拿不准用哪个入口时由 `ask-matt` 路由。

### 「When to reach for it」要点

原文：

> Type `/grilling`, or the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it on its own when a task fits. It is the only [skill](https://www.aihero.dev/ai-coding-dictionary/skill) in the grilling family that is model-invoked, which is why you rarely type it: usually a skill you *did* type is running it for you.
>
> Typing `/grilling` directly gets you the plain interview and nothing else. Where you want something more than that:

| What you have | Reach for |
| --- | --- |
| You aren't working in a working directory | [grill-me](https://aihero.dev/skills-grill-me): the same [session](https://www.aihero.dev/ai-coding-dictionary/session), under a name the agent will never fire by itself |
| You are in a working directory | [grill-with-docs](https://aihero.dev/skills-grill-with-docs): the same session, and it writes `CONTEXT.md` and ADRs as it goes |
| An effort too big to hold in one session | [wayfinder](https://aihero.dev/skills-wayfinder): it charts a map and runs grilling inside the decision tickets |
| A question that talking cannot settle: how something should look or feel | [prototype](https://aihero.dev/skills-prototype): build the throwaway version, then come back |
| A skill of your own that needs an interview | Invoke `/grilling` from it, rather than writing another interview |

- 该用：整份计划、决定或想法在被执行之前要先被压力测试时。它是 grilling 家族里**唯一由模型调用**的技能，所以人很少直接打它——通常是「你确实打了的那个技能」在替你跑它。
- 入口选择与边界：不在工作目录里 → 用 `grill-me`（同一个会话，但用了一个 agent 永远不会自己触发的名字）；在工作目录里 → 用 `grill-with-docs`（同一个会话，并且会顺手写 `CONTEXT.md` 和 ADR）；一件事大到一次会话装不下 → 用 `wayfinder`（画地图，在 decision ticket 里面跑 grilling）；靠说话定不下来的问题（该长什么样、什么感觉）→ 用 `prototype`（先做扔掉版，再回来）；你自己写的技能需要一个访谈 → 从里面调 `/grilling`，不要再写一个访谈。
- 直接打 `/grilling` 只得到**光杆访谈**，别的什么都没有。作者强调：会自己回答自己问题的 agent 是**破坏了技能，不是宽松解读**（`An agent running grilling that answers its own decisions has broken the skill, not interpreted it liberally.`）

### 这一页里出现的其它技能

| 技能名 | 出现情境 |
| --- | --- |
| `grill-me` | 两个正门之一 / 入口推荐：没有工作目录时用它（同一个会话，名字 agent 不会自己触发）；也是「一个人装 grill-me 却什么都没发生」那条的说明对象——它整个正文就是一句「run a /grilling session」，所以必须同时装本技能 |
| `grill-with-docs` | 两个正门之一 / 链条定位：有工作目录时用它，同一个会话并顺手写 `CONTEXT.md` 与 ADR；**主建造链条的起点，排在 `to-spec` 之前**；它同时还需要装 `domain-modeling`；另有条目说明 `grill-with-docs` 跑起来却没加载 `grilling`（同时点了两个技能名，但「一个技能点另一个技能名」并不能可靠地让那个技能被加载），识别信号是「一次把所有问题全问出来、且不带建议」 |
| `to-spec` | 链条顺序：主建造链条里排在 `grill-with-docs` **之后**（`ahead of to-spec`） |
| `wayfinder` | 调用方 / 入口推荐：一次会话装不下的大工程用它，它在 decision ticket 里跑 grilling |
| `triage` | 调用方：用它把一个含糊的报告 grill 成能做的报告 |
| `improve-codebase-architecture` | 调用方：选定要加深的候选之后，用它走这棵树 |
| `prototype` | 入口推荐 / 边界：靠谈话定不下来的问题（该长什么样、什么感觉）用它，先做扔掉版再回来 |
| `domain-modeling` | 依赖说明：装 `grill-with-docs` 时还需要它 |
| `ask-matt` | 推荐 / 路由：不确定用哪个入口时由它路由 |
| `/batch-grill-me` | 沿革说明：轮次式提问曾短暂作为独立技能发布，随后并入 `grilling` 本身，因此建在这个基元上的一切（`grill-me`、`grill-with-docs`、`triage`、`wayfinder`）同时拿到了它。**没有 `batch-grill-me` 可装**，也没有单独的「一次一问」技能 |
| `grilling` 家族（family） | 本页自称 grilling family，成员含 `grill-me` / `grill-with-docs` / 本技能等 |

### 页面里写明的顺序与衔接

- **顺序（原文）**：`grill-with-docs is where the main build chain begins, ahead of [to-spec](...)`——`grill-with-docs` 是主建造链条的起点，在 `to-spec` 之前。这是本页唯一一条明确的链条先后句。
- 会话**结束条件（原文）**：`The session ends when the frontier is empty, and it will not act on what you agreed until you confirm you have reached a shared understanding.` 另有一条针对「问完了就开始动手」的说明：确认门（confirmation gate）就是为此存在的——前沿空了不算完，你说理解一致了才算完。低性能模型仍会破坏它，可靠修法是在自己的 `AGENTS.md` 或 `CLAUDE.md` 里写明**未经许可不得开始实现**。
- 会话内节奏（原文）：`Each **round** asks the whole **frontier**`；举例 `Thirteen questions typically land in about three rounds rather than thirteen.` 想退回一次一问，作者给的官方办法是在全局 `CLAUDE.md` 里写一行：`When grilling, ask one question at a time.`
- **子代理（subagent）**：本页明确使用它，但**用于会话内查事实，不是跨会话**。原文：`when a frontier question needs something the environment can settle, it dispatches a sub-agent to go and find out rather than asking you. It does not block on that; only the questions downstream of a running exploration wait.`「它正在工作」的判据里也有一条：`It goes and looks facts up (reading files, dispatching a sub-agent) rather than asking you something it could have found out.`
- 关于跨会话：本页**没有**提 `/handoff`、`/compact`、`/clear`。唯一贴近的是「一次会话装不下的大工程 → 用 `wayfinder`」，以及「不要设问题数上限，会话跑太久通常是范围太大，把工作拆开分别 grill」；作者另提到有人要求做「读一个 GitHub issue 然后发一份合并决定备忘」的**异步变体**，作者说那是**另一个技能**，理由是「没人回答的 grilling 会话产出的是 agent 的意见而不是你的意见」，所以本页**没有**异步模式。

### 抓不到或对不上的地方

- 本页 YAML 无 `tags` 字段，拿不到 `phase-N` 编号。如实记录，不猜。
- 本页描述里 `description` 用的是 `The interview other skills run to stress-test a plan.`——注意它是「**别的技能跑**的访谈」。而「Where it fits」又说它是可以被人直接 `/grilling` 调的（`Typing /grilling directly gets you the plain interview and nothing else.`）。两种说法并不矛盾，但摘录时不要把它简化成单一说法。
- 本页**没有**写到 `wayfinder`、`triage`、`to-spec`、`prototype` 各自在本技能之外的顺序细节（那些应在各自的详情页上），本页只给了关系与入口选择。
- 页面本身抓取正常，内容不是占位。

---

## 5. tdd

来源：`https://www.aihero.dev/skills-tdd.md`（HTTP 200）

### 页面标题与 description 原文

文件头部 YAML：

```yaml
title: "The /tdd Skill"
slug: "skills-tdd"
type: "post"
description: "The rules of the red-green-refactor loop."
tags:
  - phase-6
  - test-and-evaluate
  - ship-solid-code
updatedAt: "2026-08-24T09:14:47.195Z"
```

### tags 原文

**本页有 `tags` 字段**，照抄不翻译：

- `phase-6`
- `test-and-evaluate`
- `ship-solid-code`

（对照：本组另 4 页 YAML 里都没有 `tags`。所以本组 5 页里只有 `tdd` 一页带编号标签，编号是 `phase-6`。）

### 「Where it fits」原文摘录（整节）

> `tdd` is the engine inside the build step of the main chain, rather than a step of its own:
>
> ```txt
> grill-with-docs → to-spec → to-tickets → implement → code-review
> ```
>
> [to-spec](https://aihero.dev/skills-to-spec) agrees the test seams up front, [implement](https://aihero.dev/skills-implement) drives `tdd` per ticket, and [code-review](https://aihero.dev/skills-code-review) checks afterwards that only the agreed seams were used, and owns the refactoring `tdd` no longer does. Its other neighbour is [codebase-design](https://aihero.dev/skills-codebase-design), the shared source of the seam and deep-module vocabulary `tdd` speaks. You can also reach for it on its own, whenever there is a concrete behaviour to build and no full spec in play. When you're unsure which skill fits your situation, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

要点：本页定位是**主链条建造环节里的发动机**，而不是自己单独的一步（`the engine inside the build step of the main chain, rather than a step of its own`）。作者贴出完整链条（原文照抄）：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review
```

三个邻居的分工：`to-spec` 在前把测试接缝**预先议定**；`implement` **按 ticket 逐个驱动** `tdd`；`code-review` 事后检查**只用过议定过的接缝**，并接管了 `tdd` 不再做的重构。另一个邻居是 `codebase-design`——seam 与 deep-module 词汇的共同出处。**也可以单独取用**（`You can also reach for it on its own`），当有具体行为要建、且手上没有完整 spec 时。拿不准时由 `ask-matt` 路由。

页面另在「What it does」里明确：`tdd` 是 **reference, not a driver**（参考件，不是驱动件）——它持有循环的规则，而由别的东西（你，或 `implement`）跑应用这些规则的会话。

### 「When to reach for it」要点

原文：

> Type `/tdd`, or the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it automatically when a task fits: building a feature or fixing a bug test-first, or when you say "red-green-refactor".
>
> Reach for it when there is a concrete behaviour to build, with an input and an observable output, and you want tests that survive a refactor.

| Your situation | Where to go |
| --- | --- |
| A behaviour with defined inputs and outputs (business logic, a request/response contract, a transformation, validation) | `tdd` |
| The behaviour isn't pinned down yet | [to-spec](https://aihero.dev/skills-to-spec), which also agrees the test seams before any code is written |
| The question is really the shape of the interface, not the tests | [codebase-design](https://aihero.dev/skills-codebase-design) |
| You have a [spec](https://www.aihero.dev/ai-coding-dictionary/spec) or [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) and want the whole build run for you | [implement](https://aihero.dev/skills-implement), which drives `tdd` per ticket |
| Config, wiring, glue, type annotations, straight CRUD delegation | Nothing here fits well; see the open gap below |

- 该用：有具体行为要建、**有输入和可观察的输出**，并且你想要**能扛住重构**的测试时；或当你说 "red-green-refactor" 时。
- 不该用 / 边界（上面表格后三行）：行为还没定下来 → 用 `to-spec`（它也会在写任何代码之前议定测试接缝）；真正的问题是**接口形状**而不是测试 → 用 `codebase-design`；已经有 spec 或 ticket 且想让整个建造过程替你跑 → 用 `implement`（它按 ticket 驱动 `tdd`）。
- **明确的空洞（本页原话）**：配置、接线、胶水代码、类型标注、直接转发到 CRUD——`Nothing here fits well; see the open gap below`。作者明说这不是「风格偏好」而是真的洞：`That last row is a real hole, not a stylistic preference.` 技能只决定接缝**放哪**，没有任何东西决定这次改动**值不值得**跑循环。对没有独立事实来源可断言的改动跑它，得到的就是「把实现重述一遍的测试」，正是技能自己警告的同义反复反模式，只是从另一个方向到来。issue #746，未关闭。在它关掉之前，这个判断归你或你的 `CLAUDE.md`。

### 这一页里出现的其它技能

| 技能名 | 出现情境 |
| --- | --- |
| `to-spec` | 链条前置 / 分工：把测试接缝**提前**议定（`agrees the test seams up front`），「行为还没定下来」那一行的去处；另在「它让我选测试接缝我却不知道选哪个」里被解释为：链条在 `to-spec` 阶段就把接缝定好，因为那时你看到的是整个功能而不是一个提示 |
| `implement` | 链条中驱动方 / 分工：按 ticket 逐个驱动 `tdd`；有 spec/ticket 想让人整个跑完时用它；`/implement` 是极简的 work→feedback→commit 循环，是课程里 `/do-work` 的直接替代品 |
| `code-review` | 链条后续 / 接管方：事后检查只用过议定过的接缝，并**接管 `tdd` 不再做的重构**（`owns the refactoring tdd no longer does`），带 Fowler smell 基线 |
| `codebase-design` | 邻居 / 前置依赖：seam 与 deep-module 词汇的共同出处；**必须先安装**（`codebase-design needs to be installed`）；接口形状问题归它 |
| `grill-with-docs` | 链条位置：主链条的第一个箭头（`grill-with-docs → to-spec → ...`） |
| `to-tickets` | 链条位置：链条上 `to-spec` 之后、`implement` 之前的一环（只出现在链条图里） |
| `ask-matt` | 推荐 / 路由：不确定用哪个技能时由它路由 |
| `/do-work` | 沿革说明：课程里单一的 `/do-work` 一步现在拆成 `/implement`、`/tdd`、`/code-review` 三个。问「拿一个 ticket 该跑哪个」时，答案几乎总是 `/implement` |
| `refactoring.md` | 沿革说明：与深模块注释同一时间离开 `tdd`，重构现在是 `code-review` 的活 |
| `/interface-design`、deep-modules 指引 | 沿革说明：v1.0 移入 `codebase-design` 并一般化，好让多个技能共用一个词汇表 |

### 页面里写明的顺序与衔接

- **链条（原文，本组最强的一条顺序证据）**：

  ```txt
  grill-with-docs → to-spec → to-tickets → implement → code-review
  ```

  这句话把 `grill-with-docs` 放在**起点**，`code-review` 放在**终点**，`tdd` 是其中 `implement` 这一环里的发动机。这一条与 `grilling` 页写的 `grill-with-docs is where the main build chain begins, ahead of to-spec` 相互印证。
- `to-spec` **之前先**议定测试接缝（原文）：`to-spec agrees the test seams up front`；`which also agrees the test seams before any code is written`；`no test at an unconfirmed seam`；`"/tdd is told to only work at pre-agreed test seams, /code-review checks that only agreed-upon test seams were used."`
- `code-review` **之后**检查接缝并用接缝之外的重构（原文）：`code-review checks afterwards that only the agreed seams were used, and owns the refactoring tdd no longer does`。
- **重构被移除（原文）**：`There is no refactor phase: it was dropped in June 2026 because agents essentially never performed it, and because review and implementation work better as separate sessions.`（所以 description 里仍写 "red-green-refactor" 但正文只有 red → green，这个不一致被记为 issue #589，未关闭。）
- 关于跨会话：本页**没有**提 `/handoff`、`/compact`、`/clear`、子代理（subagent）、换会话。唯一贴边的一句是重构被移除的理由：`because review and implementation work better as separate sessions`——即作者主张**实现与评审分开在不同的会话里做**（这正是把重构挪给 `code-review` 的原因）。摘录时请按原文理解为「分开的会话效率更好」，不要引伸成具体命令。

### 抓不到或对不上的地方

- 本页是这 5 页里**唯一带 `tags` 的页**，tags 为 `phase-6` / `test-and-evaluate` / `ship-solid-code`。另 4 页无 tags，因此本组内部无法靠 tags 排出其它 4 个技能的 phase 编号。
- **description 与正文对不上（作者自己承认）**：`description` 是 `The rules of the red-green-refactor loop.`，但重构阶段已在 2026 年 6 月移除，正文只有 red → green。作者原话：`Because the refactor step was removed and the description was not.` issue #589 未关闭，所以 "red-green-refactor" 仍可作为触发词使用。**摘录时不要把 description 当作当前流程描述。**
- 本页给出的链条图上出现了 `to-tickets`，但本页**没有**给 `to-tickets` 任何站内链接，也没有说明它的细节；本组只有 `tdd` 这一页写出了这条完整链条。
- 本页两处用 Markdown **加粗**写成 `` **Red-green.** `` / `` **Vertical slice.** `` / `` **Pre-agreed seam.** ``, 而不是用小标题（`##`）。这不影响内容，但结构上与前几页的小标题写法不同，照实记录。
- 页面本身抓取正常，内容不是占位。

---

## 本组 5 页横向小结（仅供上层取用，不代表面板设计的决定）

| 技能 | 「Where it fits」里的自我定位原文关键词 | 在链条上的位置 |
| --- | --- | --- |
| `writing-for-agents` | `reach-for-it-anytime standalone reference`；`It has no neighbour in the chain` | 不在链条上，垫在整套技能下面 |
| `codebase-design` | `reach-for-it-anytime standalone`；`the vocabulary layer underneath the engineering skills rather than a step in any chain` | 不在链条上，工程类技能下面的词汇层 |
| `domain-modeling` | `model-invoked reference`；`runs underneath other skills more often than it runs on its own` | 不在链条主线上，被 `grill-with-docs` / `wayfinder` / `triage` / `improve-codebase-architecture` 在下面调用；也可被人直接取用 |
| `grilling` | `a primitive, not a step you schedule`；两个 user-invoked front doors 是 `grill-me` 与 `grill-with-docs` | 本身是基元；其正门 `grill-with-docs` 是主建造链条的起点，在 `to-spec` 之前 |
| `tdd` | `the engine inside the build step of the main chain, rather than a step of its own`；`a reference, not a driver` | 主链条 `grill-with-docs → to-spec → to-tickets → implement → code-review` 中 `implement` 一环里的发动机；也可单独取用 |

跨会话相关：本组 5 页**均未提到** `/handoff`、`/compact`、`/clear`。提到子代理（subagent）的只有 `codebase-design`（`DESIGN-IT-TWICE.md` 并行子代理产接口设计，且可移植性存疑）与 `grilling`（会话内派子代理去查事实，不阻塞当前轮次）。`tdd` 页有一句主张「实现与评审分开在不同会话里更好」（`review and implementation work better as separate sessions`）。


---
