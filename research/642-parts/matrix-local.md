# 本地 25 个技能的对照小表

本表只从 `01a-setup-matt-pocock-skills.md`、`01b-ask-matt.md`、`02-main-flow.md`、`03-shaping.md`、`04-upkeep.md`、`05-productivity.md`、`06-reference.md` 这 7 份整理稿里抽取，`description` 一列照抄本地 `SKILL.md` 头部 YAML 的英文原文，查不到的写「没写」，不猜不补。

| 技能名 | 本地 YAML description 原文 | 正文点名的其它技能 | 跨会话/跨代理用法 | 本地原文没写清的地方 |
| --- | --- | --- | --- | --- |
| `/setup-matt-pocock-skills` | Configure this repo for the engineering skills — set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills. | `triage`（装了才写标签映射，可选分支）、`to-tickets`、`to-spec`（只作「会读写 issue tracker 的技能」的举例引用） | 有，但只是「写文件留给以后的会话读」：`## Agent skills` 段进 `AGENTS.md`/`CLAUDE.md`，`docs/agents/*.md` 被后续技能读；没有「换会话/交给别的 agent」的字眼 | 官网那句「then find your way around」没有对应步骤；只说自己是他人的前置，没说自己排第几组 |
| `/ask-matt` | Ask which skill or flow fits your situation. A router over the skills in this repo. | 几乎全部：`/grill-with-docs`、`/grill-me`、`/handoff`、`/prototype`、`/to-spec`、`/to-tickets`、`/implement`、`/tdd`、`/code-review`、`/triage`、`/diagnosing-bugs`、`/improve-codebase-architecture`、`/wayfinder`、`/domain-modeling`、`/codebase-design`、`/grilling`、`/resolving-merge-conflicts`、`/research`、`/to-questionnaire`、`/wizard`、`/wait-what`、`/teach`、`/writing-for-agents`、`/setup-matt-pocock-skills`，另加 `/clear`、`/compact` 两个命令 | 写得最多：`/handoff` 出去→开新会话干活→`/prototype` 答问题→`/handoff` 带回来；每张票之间 `/clear`；阶段边界用 `/compact`、Continue、Subagent、`/handoff`、`/clear`；`/research` 交后台代理 | 没有「什么时候不要用它」；看不出稳定的「处境 → 技能」判定法（真正的判定树在 `PHASE-BOUNDARIES.md`，且那份自称问题「不是客观的」） |
| `/grill-with-docs` | A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. | `/grilling`（调用，「Run a `/grilling` session」）、`/domain-modeling`（调用，同一句里维护术语与决策记录） | 没写 | description 说会产出 ADR 和术语表，正文只有那一行转发；没有进度、产出物清单、结束条件；看不到它往后接谁 |
| `/to-spec` | Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed. | `/setup-matt-pocock-skills`（前置调用）；`prototype`（只作普通名词引用，允许把原型片段贴进规格）；提到要用领域术语表和 ADR，但没点名 `/domain-modeling` | 没写 | 没写由谁触发；没写下一步接谁，也没点名 `/to-tickets`；正文只到「发布到 issue tracker + 打 `ready-for-agent` 标签」 |
| `/to-tickets` | Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in one file per ticket locally, or native blocking links on a real tracker. | `/setup-matt-pocock-skills`（前置调用）；`prototype`（引用，允许贴原型片段）；没点名 `/to-spec`，也没点名 `/implement` | 只有一句沾边：每张票「sized to fit in a single fresh context window」，把新上下文当切票尺子 | 输入只写成「plan / spec / conversation」，没写来自 `/to-spec`；输出停在发完票，没写交给 `/implement`；只说「work the frontier」这种给执行人的指路话 |
| `/implement` | "Implement a piece of work based on a spec or set of tickets." | `/tdd`（调用，在事先约定的接缝上）、`/code-review`（调用，做完必须交它审）；没点名 `/to-spec`、`/to-tickets` | 没写 | 全文 15 行：没写触发时机、没写什么时候算做完、没写评审发现问题怎么办；没写输入来自 `/to-tickets` |
| `/code-review` | Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes — Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X". | `/setup-matt-pocock-skills`（前置调用，缺 `docs/agents/issue-tracker.md` 时）；并行子代理干活（不是点名技能）；没点名 `/implement` | 有，本组最明确：两条线各跑一个并行子代理以免互相污染上下文，本技能汇总；写明每个子代理要收到哪些材料 | 没写它接在谁后面；没写评审之后有没有回头路（「评完就完」还是回去改，原文没答） |
| `/wayfinder` | Plan a huge chunk of work — more than one agent session can hold — as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear. | `/setup-matt-pocock-skills`（引用）、`/research`（调用，票的一种类型 + 画地图第 5 步起子代理）、`/prototype`（调用，prototype 票）、`/grilling` 与 `/domain-modeling`（调用，成对出现） | 有，是它的骨架：一次会话只解一张票（research 票除外）、开工前先把票指派给自己、每会话加载一次全图、允许多会话并行改 tracker、一切用票的标题指代 | 官网说这组三个技能并列且从 wayfinder 开始，本地把 research/prototype 写成它票的两种类型；正文点名的 `/grilling`、`/domain-modeling`、`/setup-matt-pocock-skills` 都不在官网这组名单里 |
| `/research` | Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent. | 没点名任何其它技能（全文 12 行） | 有，是开篇第一句：起一个后台代理去读，人继续干活；产物是仓库里的带引用 Markdown | 没写结论喂回哪个流程、也没写它与 wayfinder 的关系；没写这个文件交给谁接着做 |
| `/prototype` | Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like. | `SKILL.md` 没点名任何技能，只指同目录的 `LOGIC.md` 与 `UI.md`（两者互相指认）；wayfinder 会点名 prototype，prototype 从不回头点 wayfinder | 有：可交给非开发者（设计、PM、领域专家）异步按；AFK 回来看；HTML 自带内联可直接双击/邮件传；在实现那张 issue 上留指向一次性分支的指针 | 完全没提 wayfinder，也没说自己是「被派出来的一张票」、产物要回到地图；不经过 wayfinder 单独用时怎么收尾，原文没写 |
| `/improve-codebase-architecture` | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. | `/codebase-design`（引用它的架构词汇，另调用它「设计两遍」的并行子代理）、`/grilling`（调用，用户选定候选后跑）、`/domain-modeling`（调用，当场写 `CONTEXT.md`、必要时提议 ADR） | 没有「换会话/交给下一个 agent」的写法；有两处子代理：第 1 步起子代理去走代码库、用 `/codebase-design` 的 design-it-twice 起并行子代理 | 没写自然语言触发时机（只能人手动唤起）；没有「产出一份重构清单交给主干、被别人领走」这一步；报告加用户选择之后怎么交给别的技能，原文没写 |
| `/diagnosing-bugs` | Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow. | `/improve-codebase-architecture`（调用，第 6 阶段明确 hand off）；`scripts/hitl-loop.template.sh`（引用，非技能） | 没有「换会话/写文件给下一个人」；要求反馈循环「agent-runnable」可无人值守跑，人只在环里时走 hitl-loop 脚本；结论写进 commit／PR 信息「so the next debugger learns」 | 触发面比适用范围宽（触发写「坏了/报错/失败/变慢」，实际定位是难修 bug 与性能退化）；官网无可对照说法 |
| `/resolving-merge-conflicts` | "Use when you need to resolve an in-progress git merge/rebase conflict." | 一个都没提 | 没提到 | 全文只有 5 条编号步骤、14 行；没写进入时机以外的协作方式，没写产出物归谁、哪一步交给哪个技能，没写冲突该往哪个方向判（只有「按合并自身的目标来选并写明取舍」） |
| `/triage` | Move issues and external PRs through a state machine of triage roles — categorise, verify, grill if needed, and write agent-ready briefs. | `/grilling`（调用，第 4 步）、`/domain-modeling`（调用，同一步）、`/setup-matt-pocock-skills`（引用，标签映射没给时跑）；另点名 `AGENT-BRIEF.md`、`OUT-OF-SCOPE.md`（非技能） | 写得最明确：agent brief 就是给无人值守（AFK）agent 的契约，要求耐久优先于精确（不写路径行号）；专有一节「Resuming a previous session」换会话接着做；`.out-of-scope/` 留给后来人 | 本地用五个正统角色名，但明说实际标签字符串可能不一样、不保证真有 `ready-for-agent`；核验成立的真 bug 交给谁修，原文没写；`/wizard` 与它面向对象相反却互不引用 |
| `/wizard` | Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself. | 没有点名任何技能（只反复点名同目录 `template.sh`，非技能） | 没写「换会话/交给别的 agent」；唯一交汇是 YAML 那句反面条件「agent 自己能做的步骤别用它」；可重复的初始化路径提交脚本并从 README 链接，给下一个人跑 | 官网无可对照说法；没说脚本跑完之后哪一步接着走，也没说本组哪个技能会用到它配出来的值 |
| `/grill-me` | A relentless interview to sharpen a plan or design. | `/grilling`（调用，正文全部内容就是这一句「Run a `/grilling` session.」，`/grilling` 不在本组） | 原文没写 | 没写触发时机；全文 7 行只有一句转发，产出什么必须去看 `/grilling`；官网说这组从它开始，这组里读不到 |
| `/handoff` | Compact the current conversation into a handoff document for another agent to pick up. | 一个都没有（正文要求文档里写一节 "suggested skills" 说该调哪些技能，却没给任何具体技能名） | 正文几乎全在说这件事：写交接文档给全新 agent 接手，存到操作系统临时目录、**明确不是当前工作区**；含对话总结、建议技能一节、对已有产物的引用（不重复抄）、抹掉敏感信息；参数当「下个会话专注什么」裁剪 | 没写什么时候该用（只是隐含）；没写接手的人干完之后怎么办；没写临时目录路径、接手方怎么找到、会不会被系统清掉；没写「上下文快满」触发与「做完 handoff 回来」；举了规格/计划/ADR/issue/提交/差异却一个技能名都不点，本组另外 5 个也不产这些 |
| `/to-questionnaire` | Turn a decision you can't fully answer into a questionnaire for someone else to fill in. | 一个都没有（正文出现过 grill 这个词，但那是当动词用） | 没写「交给另一个 agent/换新会话」；原文是交给**一个人**填（异步，或开会一起填） | 没写触发条件（只有「Grill the send, not the subject.」这句判别口令）；没写用户拿回答复之后接什么；与本地其它技能无冲突 |
| `/teach` | Teach the user a new skill or concept, within this workspace. | 一个都没有（出现的全是文件与外部资源：`MISSION.md`、`RESOURCES.md`、`NOTES.md`、`GLOSSARY.md`、`learning-records/`、`lessons/`、`assets/`、`reference/`） | 有，跨会话是它的核心设计（有状态请求，打算跨多次会话学）：整个工作区就是跨会话记忆，下节课靠读 `learning-records` 和 mission 决定；全文没出现 handoff 或派子 agent | `GLOSSARY.md` 没被列进工作区 7 项文件清单却被格式文件写成工作区文件；术语表是 `reference/*.html` 还是根目录 `GLOSSARY.md` 两说；「一个工作区一个 mission」正文没重复；正文大量借软件工程词汇 |
| `/wait-what` | Stop. That last message did not land — re-pitch it. | 一个都没有（只提到 `CONTEXT.md` 这个文件） | 原文没写 | 没写触发条件；没写 `CONTEXT.md` 不存在时怎么办；`ASD-STE100 Simplified Technical English` 只给标准名、不解释；全文 7 行一句正文 |
| `/writing-for-agents` | Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md. | 没有点名任何具体技能名（讲的是两类做法与 `SKILL-MECHANICS.md` 这份文件） | 提到一次，角度是「上下文边界」：藏起后面步骤只在真正的上下文边界上才有效，举例「a hand-off or a subagent dispatch」，并说内联调用什么也清不掉（`hand-off` 是小写普通名词，不是点名 `/handoff`） | 与官网这组「不围着代码转」口径最不合；它是本组唯一模型可调用（其余 5 个都 `disable-model-invocation: true`）；`description` 没带出「写技能还要读 `SKILL-MECHANICS.md`」；它说的 hand-off 与本组 `handoff` 原文互不引用 |
| `/codebase-design` | Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary. | 正文里没有点名任何一个别的技能（只提 `DEEPENING.md`、`DESIGN-IT-TWICE.md` 两份文件）；反向：`tdd` 正文点名引用了它 | 有：`DESIGN-IT-TWICE.md` 要求并行起 3+ 个子代理各做一份差别很大的接口，并给每个子代理一份独立技术简报；没有「换新会话/写文件交接」 | 官网只说「从 codebase-design 开始」，没说目录下还有两份独立参考文件；它自称被别人引用，但本组只有 `tdd` 点名引它，`grilling`、`domain-modeling` 正文都没点名 |
| `/domain-modeling` | Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, record an architectural decision, or when another skill needs to maintain the domain model. | 正文里没有点名任何一个别的技能（只提 `CONTEXT.md`、`CONTEXT-MAP.md`、`CONTEXT-FORMAT.md`、`ADR-FORMAT.md`、`docs/adr/`） | 没有「换会话/交给另一个 agent」；写的是**跨时间**——`CONTEXT.md` 与 ADR 是给以后的读者、下一位工程师看的 | `description` 把「记录一条架构决策」写成触发条件之一，正文把 ADR 收得极紧（三个条件缺一不写）；官网把它定位成「别的技能会调用或引用的那一层」，但本组没有一个技能点名写出它这个名字（只是用它的产物） |
| `/grilling` | Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases. | **没有**（全文 22 行，没有出现任何一个别的技能名） | 有一处跨代理：环境事实派子代理去查且不阻塞（正在跑的探查算未定前提，只有它下游的问题等）；「换新会话/写文件给下一个人」没提到 | 正文完全没写「别的技能应该怎么调用我」（没有调用约定、传什么、接什么产物），只有 description 留的触发词入口；从正文看它更像独立用户路径而非被引用的规矩；收尾条件是「前沿问空 + 用户确认达成共识」 |
| `/tdd` | Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests. | `/codebase-design`（引用，接口形状本身有疑问时用它那套词汇，并明说它「a reference to consult, not a session to run」）、`code-review`（引用，重构不属于本循环、归 review 阶段）；要求读 `CONTEXT.md` 与 ADR 但没点名 `domain-modeling` | 没有提到「换新会话/交给别的 agent/写文件给下一个人」；写到的跨人协作是同一个会话里和用户确认接缝 | 与官网「被别的技能调用或引用」的方向相反：它是引用方；本地原文没出现 `implement` 或同类技能名，本组四份里也没有任何一处引用 `tdd`；硬前置是「只在事先确认过的接缝上写测试」 |

## ① 本地原文里写明的衔接

只有下面这些是本地原文里确实写了「做完 A 去做 B」或「A 内部要跑 B」的，其余一律没有：

- `/implement` → `/code-review`：「Once done, use /code-review to review the work.」主干五棒里唯一明写的一跳。
- `/implement` → `/tdd`：「Use /tdd where possible, at pre-agreed seams.」
- `/grill-me` → `/grilling`：正文全文只有「Run a `/grilling` session.」
- `/grill-with-docs` → `/grilling` 与 `/domain-modeling`：正文那一句同时点名这两个技能。
- `/diagnosing-bugs` → `/improve-codebase-architecture`：第 6 阶段明确 hand off；并且要求修完、上完回归测试之后再给，不要提前给。
- `/improve-codebase-architecture` → `/grilling`（用户挑定候选之后跑）；同一技能还在正文里调用 `/domain-modeling`（决定成形时写 `CONTEXT.md`），并在要试多种接口时调用 `/codebase-design` 里的 design-it-twice。
- `/wayfinder` → `/research`：画地图第 5 步为每张 `research` 票起一个 `/research` 子代理并行解。
- `/wayfinder` → `/prototype`：`prototype` 票里写明「or UI/logic code via the /prototype skill」。
- `/wayfinder` → `/grilling` 与 `/domain-modeling`：「Always invoke the /grilling and /domain-modeling skills.」；走地图第 3 步也写「If in doubt, use `/grilling` and `/domain-modeling`」。
- `/triage` → `/grilling` 与 `/domain-modeling`：第 4 步「需要把请求谈清楚时」两个一起跑。
- `/tdd` → `/codebase-design`（接口形状有疑问时用它那套词汇）、`/tdd` → `code-review`（重构归 review 阶段）：两处都是引用指路，不是接手干活。
- 前置型（不是「做完 A 做 B」，但也写了先后）：`/to-spec`、`/to-tickets`、`/code-review`、`/triage` 都写着「标签/配置没给你就先跑 `/setup-matt-pocock-skills`」；`/setup-matt-pocock-skills` 自己写着「Run once before first use of the other engineering skills」，并在「`triage` 装了才写 `triage-labels.md`」。
- `/ask-matt` 是路由：它把 24 个技能名加 `/clear`、`/compact` 排成主干、两个入口、旁支，并写出「`/implement` 收尾时跑 `/code-review`」「`/triage` 的产出物之后由 `/implement` 接手」「`/wayfinder` 收尾要交接给 `/to-spec`」这类排法。注意：这些衔接只出现在 `/ask-matt` 这一份里，相关技能自己的原文没有重述。

## ② 本地原文里明显缺失的衔接

主干那几跳（负责人最关心的部分）：

- `/grill-with-docs` → `/to-spec`：两头都缺。`/grill-with-docs` 正文只有一行转发，`/to-spec` 也没写由谁触发。
- `/to-spec` → `/to-tickets`：两头都缺。`/to-spec` 一个字都没提 `/to-tickets`；`/to-tickets` 的输入只写成「a plan, spec, or conversation」。
- `/to-tickets` → `/implement`：两头都缺。`/to-tickets` 只有「Work the frontier…」这种给执行人的指路话，没点名 `/implement`；`/implement` 也没写自己的输入来自它。
- `/code-review` → 回到 `/implement`（评审发现问题怎么办）：没写。本组五份里唯一明写的循环是 `/to-tickets` 内部「反复拆到用户认可」。
- `/setup-matt-pocock-skills` 配置完之后接什么：没写。官网那句「then find your way around」在本地没有对应步骤。

handoff 那条跨会话的路：

- `/handoff` 自己：没写什么时候该用；没写接手的人干完之后怎么办；没写「做完 handoff 回来」；没写临时目录里的文件怎么被接手方找到、会不会被系统清掉；文档里要求写一节「建议技能」却一个技能名都不给；它举了规格、计划、ADR、issue、提交、差异，却没点名产出这些东西的技能。
- `/handoff` 与 `/prototype` 的那座桥（handoff 出去 → 新会话 → 用 prototype 答问题 → handoff 回来）：只写在 `/ask-matt` 里，`/handoff` 与 `/prototype` 两份自己的原文都没有。
- `/writing-for-agents` 是唯一在另一份原文里把「a hand-off or a subagent dispatch」当成上下文边界用的地方，但 `/handoff` 那边完全没接这话，两边互不引用。

其它缺口：

- `/triage` 核验成立的真 bug 交给谁修：没写（只有 `/ask-matt` 写「之后由 `/implement` 接手」）。
- `/improve-codebase-architecture` 那份报告和重构清单交给谁：本地只到「给报告 → 用户挑一条 → 当场 grilling」就断了；谁唤起它这次扫描，也没写。
- `/wayfinder` 地图清明之后并回主干：只有 `/ask-matt` 写「收尾要交接给 `/to-spec`」，`/wayfinder` 自己没写。
- `/research` 的产物喂回哪个流程：`/research` 那边没写；只有 `/wayfinder` 那边写了（票上留指针）；`/ask-matt` 又说产出要带进 `/grill-with-docs`。三处说法不在一份文件里。
- `/resolving-merge-conflicts` 彻底孤立：谁在冲突时唤起它、做完之后回到哪条主线，原文都没写。
- `/wizard` 与主干的接口：没说脚本跑完之后接着走哪一步，也没说本组哪个技能会用到它配出来的值。
- `/to-questionnaire` 收到答复之后接什么：没写。
- `/grilling` 被别的技能调用：有调用方（`/wayfinder`、`/triage`、`/improve-codebase-architecture` 都点名会跑它）却没有约定——传什么材料、接什么产物，正文一个字都没写。
- 谁在什么时机该唤起 `/setup-matt-pocock-skills` 之外那几个只能人手动唤起的技能（`/grill-with-docs`、`/improve-codebase-architecture`、`/triage`、`/wizard`、`/implement`、`/grill-me`、`/handoff`、`/to-questionnaire`、`/teach`、`/wait-what`、`/wayfinder`、`/ask-matt` 都标了 `disable-model-invocation: true`）：除 `/ask-matt` 那张图，原文没写。

## ③ 本地与官网对不上的地方

按 part 文件里记的逐条列，注明是哪个技能。

**01a `/setup-matt-pocock-skills`**

1. 官网那句「then find your way around」没有被写成一个后续步骤，原文第 5 步只说告诉用户配置完成、哪些技能会读这些文件、以后可直接改 `docs/agents/*.md`。
2. 「Set up once」这一半能对上，但原文带了例外：换 issue 跟踪方式或想从零重来时可以再跑。
3. 官网把它放在 Getting Started 组，原文只一遍遍强调它是「其它技能的前置条件」，对自己排第几组没表态。
4. 官网那句读起来像入门导览入口，本地实际是一个靠人对话推进的配置向导（`disable-model-invocation: true`，且自称「prompt-driven skill, not a deterministic script」）。
5. 官网那句范围说窄了：只提 issue tracker，本地一句话里含三件事——issue tracker、分类标签词汇、领域文档布局。

**01b `/ask-matt`**

1. 本地有一条更靠前的路：原文末尾单列 `Precondition`，`/setup-matt-pocock-skills` 要「run before your first engineering flow」，`/ask-matt` 是配置完之后用的地图，不是起点本身。
2. 本地明写它不由模型自动触发（`disable-model-invocation: true`），官网读起来像随时能被拉起来的入口。
3. 本地把范围限定在「this repo」（description 原文「A router over the skills in this repo.」），官网的说法没有限定到某个仓库。
4. 本地多了「flow」这个概念：官网只说 which skill，本地是 which skill or flow，正文也按流程组织（主干、入口、旁支、词汇层）。
5. 本地唯一像「判定流程」的东西在 `PHASE-BOUNDARIES.md`（按顺序问五个问题、第一个 yes 就赢），但那是「阶段边界上该不该换上下文」的判定，不是「我这种情况该用哪个技能」；而且那份文件自己承认这些问题「不是客观的」，同一个边界不同日子可能有两个答案。

**02-main-flow**

1. `/grill-with-docs`：官网把这组说成「有顺序」并把这一棒放在主干最前面，本地正文却看不出它往后接谁——主干第一段衔接 `/grill-with-docs` → `/to-spec` 在它自己的文件里完全没有出现；description 说会产出 ADR 和术语表，正文没有任何流程、产出物清单或结束条件。
2. `/to-spec`：description 和正文都没有提到 `/to-tickets`，也没写它由谁触发；官网意义上的「上一棒 grill-with-docs、下一棒 to-tickets」在本地两头都缺。
3. `/to-tickets`：官网把这棒排在主干中间，本地读不出前后来路——输入只写成「a plan, spec, or conversation」，输出只停在「发布成票」，没写交给 `/implement`。
4. `/implement`：官网当作主干第四棒，本地没写它的输入来自 `/to-tickets`；全文 15 行，没有触发时机、没有结束条件、没有评审发现问题怎么办。
5. `/code-review`：官网当作主干最后一棒，本地正文看不出它接在谁后面（没提 `/implement`），也没写评审之后有没有回头路。
6. 汇总一句：官网写这一组「in order」，但本地五份里只有一处衔接是明写的——`/implement` 做完交给 `/code-review`；另外三处（`/grill-with-docs` → `/to-spec`、`/to-spec` → `/to-tickets`、`/to-tickets` → `/implement`）在任何本地文件里都没有点名。

**03-shaping**

1. `/wayfinder`：官网把 wayfinder、research、prototype 并列放一组并说从 `/wayfinder` 开始，本地把 research 和 prototype 写成地图上票的两种类型（wayfinder 在上，另两个是它内部的手段），官网的并列说法在原文里找不到对应的句子；wayfinder 正文点名的 `/grilling`、`/domain-modeling`、`/setup-matt-pocock-skills` 都不在官网这一组的名单里。
2. `/research`：官网说这一组「产出一个决定、喂回主干流程」，本地只讲到查清楚、写成一份仓库里的 Markdown 文件，没写结论喂回哪个流程，也没写它和 wayfinder 的关系（这层关系只写在 wayfinder 那一侧）；它还是本组正文最短的一份（12 行）。
3. `/prototype`：官网说这一组从 `/wayfinder` 开始，prototype 的原文（`SKILL.md`、`LOGIC.md`、`UI.md`）完全没提 wayfinder，也没说自己是「被派出来的一张票」、产物要回到那张地图；反过来本地比官网多内容——官网只有一行 description，本地多出逻辑分支与界面分支两个参考文件（`LOGIC.md` 67 行、`UI.md` 112 行）。另外 research 和 prototype 之间没有先后关系，原文没写。

**04-upkeep**

1. `/improve-codebase-architecture`：官网说这一组「从它开始」，本地没有这句先后关系的说法；也没有「产出一份重构清单（backlog）交给主干流程、被别人领走」这一步，本地只做到给报告、用户挑一条、当场进 grilling。
2. `/diagnosing-bugs`：官网没有可对照的说法；要留意的是 YAML 的触发条件写的比它实际接手的面宽（触发写「坏了/报错/失败/变慢」，实际定位是难修 bug 与性能退化）。
3. `/resolving-merge-conflicts`：本地比官网首页给的信息少得多，全文只有 5 条编号步骤、14 行，没有交代进入时机以外的协作方式，也没有产出物归谁、哪一步交给哪个技能。
4. `/triage`：官网把这一组说成「按仓库自己的标签体系走」，本地用五个正统角色名，并明说实际标签字符串可能不一样、映射本该已经给你——也就是说本地不保证仓库里真有叫 `ready-for-agent` 的标签；官网说这一组从 `/improve-codebase-architecture` 开始，但分诊核验成真 bug 之后交给谁，本地没写。
5. `/wizard`：官网没有可对照的说法；要看的是它与同组 `/triage` 的定位差别——`/wizard` 产出给人执行的脚本，`/triage` 产出给无人值守代理执行的简报，面向对象刚好相反，本地原文两边都没互相引用。

**05-productivity**

1. 全组：6 个技能里有 5 个写着 `disable-model-invocation: true`，只有 `/writing-for-agents` 没有——这一点官网首页没有说。
2. `/grill-me`：官网说这组「从 `/grill-me` 开始」，但本地这一份只有 7 行、自身不含实质内容，只是转手交给 `/grilling`；转手之后这组名单里的下一个是谁，官网和原文都没说。
3. `/handoff`：原文明确要求写到操作系统临时目录、不是当前工作区（和「写一份文件给下一个人接着做」的常规做法不一样），且没交代临时目录里的文件如何被接手方找到、会不会被清掉；原文列举了规格、计划、ADR、issue、提交、差异这些已有产物，说明技能体系里该有产出这些东西的技能，但 `/handoff` 一个都没点名，本组另外 5 个也都不产这些；它要求写「建议技能」一节，却一个技能名都不给。
4. `/to-questionnaire`：官网说这一组是「给人用的工作流」，这一份和这个说法完全对得上，看不出矛盾，也没有与本地其它技能冲突的地方。
5. `/teach`：`GLOSSARY.md` 没被列进「Teaching Workspace」那 7 项文件清单，却被 `GLOSSARY-FORMAT.md` 写成这个工作区的文件、还被 `LEARNING-RECORD-FORMAT.md` 用双链引用（原文内部的一处对不上）；术语表到底是 `./reference/*.html` 里的还是根目录下的 `GLOSSARY.md`，原文两种说法并存没说清哪个为准；`MISSION-FORMAT.md` 规定「一个工作区一个 mission」，`SKILL.md` 的 description 也说是 within this workspace，但正文没有重复这条限制；另外它大量借用软件工程词汇，与官网那句「不围着代码转」口径不太一样。
6. `/wait-what`：官网说这组「不围着代码转」，它却要求用 `CONTEXT.md` 里的通用语言重讲（那是仓库里的领域词典，明显的项目语境）；原文没说 `CONTEXT.md` 不存在时怎么办；`ASD-STE100 Simplified Technical English` 只给了标准名、没解释是什么；整份只有 7 行、没有任何展开内容。
7. `/writing-for-agents`：与官网这一组的口径最不合——它恰恰是「怎么写给 agent 看的文档」的指南，内容全在 `AGENTS.md`、`CLAUDE.md`、技能文件、`package.json` 脚本这些工程语境里；它是本组唯一模型可调用的技能，而按 `SKILL-MECHANICS.md` 自己写的标准（只有「agent 必须自己够到它」或「别的技能必须调它」才选模型可调用），它更像该做成用户可调用的；`description` 的触发条件没带出「写技能时还要去读 `SKILL-MECHANICS.md`」；它用「a hand-off or a subagent dispatch」讲上下文边界，本组 `/handoff` 原文完全没接这话，两边各说各的。

**06-reference**

1. `/codebase-design`：官网这一组只写「从 `/codebase-design` 开始」，没说这个目录下还有两份独立参考文件；本地实际存在 `DEEPENING.md` 与 `DESIGN-IT-TWICE.md`。它的 description 自称「另一个技能需要深模块词汇时用它」，但本组四个技能的正文里只有 `/tdd` 明确点名引用它，`/grilling`、`/domain-modeling` 的正文都没点名。
2. `/domain-modeling`：description 把「记录一条架构决策」写成触发条件之一，正文却把 ADR 的触发收得很紧（三个条件必须同时成立，否则「skip the ADR」）——描述像常用入口，正文其实是个很少开的窄口。官网把它定位成「别的技能会调用或引用的那一层」，本组也确实有技能在用它的产物（`/tdd` 读 `CONTEXT.md` 与 ADR，`DESIGN-IT-TWICE.md` 要求提示词带上 `CONTEXT.md` 词汇），但**没有一个技能点名写出 `domain-modeling` 这个名字**。
3. `/grilling`：官网说这一层「别的技能会调用或引用」，它的 description 也留了「uses any 'grill' trigger phrases」这个被动入口，但**正文完全没有写「别的技能应该怎么调用我」**，也没写调用后要传什么、要接什么产物；从正文看它更像一条独立的用户路径（有触发词、一轮轮问答、明确的收尾条件）。
4. `/tdd`：官网说这一组是「别的技能会调用或引用」的那一层，`/tdd` 的正文却是引用方（引 `/codebase-design`、`code-review`），方向是反的——至少在这四份本地原文里找不到任何别的技能引用 `tdd`；`/tdd` 的本地原文里也没有出现 `implement` 或任何同类技能名，这一点只能写「原文没写」，不能替它推断。

