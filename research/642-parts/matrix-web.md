# 25 个技能的官网详情页小表（从 web-01 ~ web-05 整理稿里抽出）

本文件只从这 5 份已有整理稿里抽表，没有重新联网、没有读别的目录：

- `research/642-parts/web-01.md`（ask-matt、setup-matt-pocock-skills、grill-with-docs、to-spec、to-tickets）
- `research/642-parts/web-02.md`（implement、code-review、wayfinder、prototype、research）
- `research/642-parts/web-03.md`（improve-codebase-architecture、diagnosing-bugs、resolving-merge-conflicts、triage、wizard）
- `research/642-parts/web-04.md`（grill-me、handoff、to-questionnaire、teach、wait-what）
- `research/642-parts/web-05.md`（writing-for-agents、codebase-design、domain-modeling、grilling、tdd）

表格约定：description 一栏照抄英文原文；「链上的位置」一栏只摘作者自己的英文措辞；抓不到的格子一律写「没写」，不猜不补。

| 技能名 | 官网 description 原文 | 它在链上的位置（作者原话关键词） | 它连到哪些技能 | tags | 页面里值得注意的对不上 |
| --- | --- | --- | --- | --- | --- |
| `/ask-matt` | "Find out which skill to use for the situation you are in." | `a standalone router that sits over the whole set`；`It is never a step in a chain` | grill-with-docs、triage、grill-me、wayfinder、to-spec、to-tickets、implement、handoff、grilling、resolving-merge-conflicts、tdd、writing-for-agents | 没写（该页 YAML 无 `tags` 字段） | 页面写 `Thirteen of the plugin's twenty-two skills carry the flag`（插件说 22 个技能），与本地 25 个 SKILL.md 的数字不一致；页面自认「手工维护、会落后于仓库」 |
| `/setup-matt-pocock-skills` | "Set up one repo so the other skills know how it works." | `the run-once setup for the engineering flow, the precondition everything else assumes rather than a step in the chain` | triage、to-spec、to-tickets、wayfinder、domain-modeling、ask-matt、grilling | 没写（该页 YAML 无 `tags` 字段） | 重跑条件有两套说法并存（Matt 在 v1.1 后口头说需要重跑，技能自己的收尾信息说只在换 tracker 或重来时才有必要）；已知问题「它写的是 CLAUDE.md，而我在 Codex」仍未修；没有 user-level / global 模式 |
| `/grill-with-docs` | "Get interviewed about a plan, and record the decisions." | `the head of the main build chain` | grill-me、wayfinder、to-questionnaire、grilling、domain-modeling、to-spec、to-tickets、implement、code-review、improve-codebase-architecture、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 在别的编排层里跑时「写文件那一半」被报告会静默不发生（已归档未修）；`SKILL.md` 只是一行委派，装载失败会退化成「无差别的问题倾泻」；页面自己写 `Nobody is happy with the name.` |
| `/to-spec` | "Turn an agreed conversation into a written spec." | `a step in the main build chain, and only on the multi-session branch of it` | grill-with-docs、wayfinder、to-tickets、implement、code-review、tdd、setup-matt-pocock-skills、ask-matt | `build-the-right-thing`、`phase-4` | `phase-4` 与它在链条上的实际位置（第 2 环）不是同一个数（原稿只记录不解释）；spec 带 `ready-for-agent` 标记，AFK runner 会试图把整份 spec 一次做完，页面说这是最常被报告的一条；模板偏向 user story，对重构／模块边界类工作不合适 |
| `/to-tickets` | "Split a spec into small tickets an agent can build." | `a step in the main build chain` | to-spec、implement、tdd、code-review、grill-with-docs、wayfinder、triage、setup-matt-pocock-skills、ask-matt | `build-the-right-thing`、`phase-5` | GitHub 上没把工单建成 spec issue 的子 issue（`Known and unfixed.`，最完整记录在 issue #554）；blocked-by 被写成正文而不是真正的阻塞链接（issue #513）；本地工单位置与 v1.1 说明不符（现为 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`） |
| implement | "Build a finished spec into code, test-first." | `the build step of the main chain, second from the end` | to-tickets、tdd、code-review、to-spec、grill-with-docs、grill-me、wayfinder、ask-matt、setup-matt-pocock-skills | 没写（该页 YAML 无 `tags` 字段） | 它在提交前跑 code-review，但 code-review 看的是 `git diff <fixed-point>...HEAD`，此时还没有提交可看，两边都未修；它没有完成步骤，不关工单、不勾 `- [ ]` |
| code-review | "Review a diff against your standards and against the spec." | `the review step at the tail of the build chain`；`It also stands alone on any branch or PR you point it at` | implement、to-spec、to-tickets、improve-codebase-architecture、tdd、diagnosing-bugs、setup-matt-pocock-skills、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 与 Claude Code 自带的同名 `/code-review` 冲突，页面称这是最常被报告且未修的问题；它不看未提交的改动；它的子代理会再次调用 `/code-review` 并继续扩散（有报告达到 50 个以上代理） |
| wayfinder | "Chart a large effort as a map of decisions, and settle them." | `a situational on-ramp, not the default front door`；`it merges back onto that chain at to-spec` | to-spec、to-tickets、implement、grill-with-docs、grill-me、grilling、domain-modeling、prototype、research、handoff、ask-matt、setup-matt-pocock-skills | 没写（该页 YAML 无 `tags` 字段） | 同一页里 `prototype` 出现两种链接目标（一处链技能页、一处链词典页）；本页把 prototype 与 research 写成 wayfinder 的票型（下层被调件），与本地是否写成平级未核 |
| prototype | "Answer a design question with code you then delete." | `a reach-for-it-anytime standalone`；`it is also machinery another skill runs on` | wayfinder、diagnosing-bugs、grill-me、grill-with-docs、to-spec、implement、handoff、ask-matt | `phase-3`、`build-the-right-thing` | description 说 `code you then delete`，但同一页正文明确说现在**不删了**（`Not any more.`）——同一页内部 description 与正文不一致 |
| research | "Get a cited answer, read from primary sources." | `A reach-for-it-anytime standalone that feeds the thinking skills rather than sitting in the build chain` | wayfinder、grilling、grill-with-docs、prototype、to-spec、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 与 wayfinder 页口径冲突：wayfinder 页把「研究票由 `/research` 子代理并行烧掉、放 `research/<name>` 分支」当作当前状态陈述，research 页说那是 `unreleased changes since v1.1`；另有一条明确否定——后来的会话不会自动复用之前的研究成果 |
| improve-codebase-architecture | "Find the modules worth refactoring, as a visual report." | `periodic maintenance`；`run it every few days, outside any chain, to queue up work rather than to do it` | codebase-design、grilling、domain-modeling、grill-with-docs、to-spec、to-tickets、implement、wayfinder、diagnosing-bugs、ask-matt | `ship-solid-code`（不是 `phase-N` 编号） | tags 只有一项且不是编号标签，拿不到 `phase-N`；FAQ 明确写 `the skill does not yet have a documented no-grill mode`；页面提到的 `TYPESCRIPT.md` `does not exist` |
| diagnosing-bugs | "Diagnose a hard bug, starting from a repro that fails." | `a reach-for-it-anytime standalone`；`it holds no state and needs no prior setup` | triage、improve-codebase-architecture、prototype、tdd、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 它和 triage 的关系只出现在读者转述加作者确认里，页面明写 `neither file mentions the other`（两个技能文件彼此都不提对方），这条缝仍未修；旧名 `/diagnose` 在 v1.0.0 改名，`The old name no longer exists.` |
| resolving-merge-conflicts | "Finish a merge or rebase conflict, hunk by hunk." | `A reach-for-it-anytime standalone with no dependencies on any other skill`；`It sits off the main idea-to-ship flow entirely` | diagnosing-bugs、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 站点版明确不给 `--abort` 选项（`--abort is not an option it has`），本地若写了 abort 即不一致；作者自己给它的长期价值打了折扣：有读者预测它随模型变强会变成 no-op |
| triage | "Sort raw issues into work someone can pick up." | `an on-ramp, not a step in the main chain` | implement、to-tickets、to-spec、diagnosing-bugs、grill-with-docs、grilling、domain-modeling、ask-matt、setup-matt-pocock-skills | 没写（该页 YAML 无 `tags` 字段） | 五个状态不够用的三种形态都还没发（`None of it has shipped.`，其中 blocked 这个名字还没定）；`setup-matt-pocock-skills` 只把标签词汇写进文档、不在 tracker 里真建标签（issue #616）；站点说类别标签（`bug` / `enhancement`）也是这套词汇的一部分，与本地 `AGENTS.md` 是否完全一致，原稿未作结论 |
| wizard | "Generate a script that walks a human through setup." | `a reach-for-it-anytime standalone, sitting at the line where automation stops and a human has to click` | grill-with-docs、to-spec、setup-matt-pocock-skills、implement、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 调用写法按 harness 不同（Claude Code 用 `/wizard`，Codex 用 `$wizard`），本仓库是 DSH 环境，是否相同原稿未作结论；v1.2 起从 `in-progress/` 迁到 `engineering/`；它从 user-invoked 改成了 model-invoked |
| grill-me | "Align on an idea before committing to it." | `a standalone you can run anywhere, on anything` | grill-with-docs、wayfinder、grilling、prototype、to-spec、ask-matt | `get-better-results`、`phase-1` | 它要求在一个**新会话**里启动，但在写 spec 之前又明确**不要**另起新会话（`No.`），两处方向相反；本页没有 `/compact`、`/clear`、子代理的说法 |
| handoff | "Write up a long session so another agent can continue it." | `a reach-for-it-anytime standalone that lives at the seam between sessions rather than inside a build chain` | prototype、ask-matt、grilling | `phase-6`、`get-better-results` | 页面自己承认 description 读起来像「会话续接」，因此常被略过，真正值钱的是「分叉（fork）」那种用法；它带 `phase-6`、`grill-me` 带 `phase-1`，这组编号的含义原稿不做推断；五个选项那棵有序树画在 `ask-matt` 页，不在本页 |
| to-questionnaire | "Turn open questions into a doc someone else fills in." | `a reach-for-it-anytime standalone`；`most often mid-flow` | grill-me、grill-with-docs、to-spec、prototype、ask-matt、grilling | 没写（该页 YAML 无 `tags` 字段） | 必须在**同一个会话**里跑（换会话会丢掉主题）；作者专门否认「这就是 `grill-me` 的批处理版」；文档不做分支设计，理由是模型超前两三个问题就会规划失当 |
| teach | "Learn a topic across many sessions that build on each other." | `a reach-for-it-anytime standalone`；`It is not a step in a build chain and shares no artifacts with the engineering flow` | handoff、wait-what、grill-me、research、ask-matt、wayfinder | 没写（该页 YAML 无 `tags` 字段） | 页面列了四个未修编号：`#559`（`GLOSSARY-FORMAT.md` 不再被 `SKILL.md` 引用）、`#377`（课程文件被写进 `~/.claude/skills`，实打实的 open bug）、`#335`（正确答案总在第一个选项）、`#725`（知识摸底测评仍只是需求）；连续性靠文件夹而不是靠对话 |
| wait-what | "Ask the agent to say that again, in plain English." | `at any point, in any conversation, inside any other skill` | grill-with-docs、domain-modeling、ask-matt、grilling | 没写（该页 YAML 无 `tags` 字段） | 页面自己强调「三行长是设计，不是没写完的草稿」；它的作用域只有当前对话里的上一条消息，本页完全没有跨会话、`/compact`、`/clear`、子代理的提法 |
| writing-for-agents | "How to write skills and other documents agents read." | `a reach-for-it-anytime standalone reference`；`It has no neighbour in the chain` | grill-with-docs、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 旧名 `writing-great-skills`（v1.1 改名，无别名，要按新名重装）；本页没有顺序衔接句，也没有跨会话提法 |
| codebase-design | "The vocabulary for designing deep modules." | `a reach-for-it-anytime standalone`；`the vocabulary layer underneath the engineering skills rather than a step in any chain` | domain-modeling、improve-codebase-architecture、grilling、tdd、ask-matt、grill-with-docs | 没写（该页 YAML 无 `tags` 字段） | `DESIGN-IT-TWICE.md` 用的是 Claude Code 的工具名（`spawn 3+ sub-agents in parallel using the Agent tool`），其它 harness 可能没有，可移植性不如技能元数据看起来那么好（issue #564 未关）；本页写 `grill-with-docs` 时没有给站内链接，而 `writing-for-agents` 页给的链接带 www，两页写法不一致 |
| domain-modeling | "Sharpen the words a project uses, and write them down." | `a model-invoked reference`；`runs underneath other skills more often than it runs on its own` | grill-with-docs、wayfinder、triage、improve-codebase-architecture、codebase-design、grilling、ask-matt | 没写（该页 YAML 无 `tags` 字段） | 作者自认自动调用是它最弱的一环——模型常把 `grilling` 装进来却跳过它，判别信号是一次 grilling 跑完而 `CONTEXT.md` 完全没被动过；跨引用只覆盖代码与已提交的 `CONTEXT.md`/ADR，不查 issue tracker（issue #717 未关）；`CONTEXT.md` 会膨胀这件事技能自身指引还不够防住 |
| grilling | "The interview other skills run to stress-test a plan." | `a primitive, not a step you schedule`（两个正门是 `grill-me` 与 `grill-with-docs`） | grill-me、grill-with-docs、to-spec、wayfinder、triage、improve-codebase-architecture、prototype、domain-modeling、ask-matt | 没写（该页 YAML 无 `tags` 字段） | description 说的是「别的技能跑的访谈」，但人也可以直接敲 `/grilling`（两种说法不矛盾，但摘录时不该简化成一种）；作者明确说不做异步模式；`batch-grill-me` 没有可装的独立技能，它已并入本技能 |
| tdd | "The rules of the red-green-refactor loop." | `the engine inside the build step of the main chain, rather than a step of its own`；`a reference, not a driver` | to-spec、implement、code-review、codebase-design、grill-with-docs、to-tickets、ask-matt | `phase-6`、`test-and-evaluate`、`ship-solid-code` | description 与正文对不上且作者自己承认：重构阶段已于 2026 年 6 月移除，正文只有 red → green（issue #589 未关），所以不要把 description 当作当前流程描述；配置、接线、胶水代码、类型标注这类改动是「真空洞」（issue #746 未关） |

## ① 作者反复给出的主链（原话）

同一条链在多个页面里逐字一致地出现：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review
```

- `web-01.md` 的整理里写明这条链「4 页原文出现过，逐字一致」；`web-02.md` 的 implement、code-review 两页与 `web-05.md` 的 tdd 页也照抄了这条链（tdd 页把它写在「Where it fits」里）。
- 作者在 `tdd` 页的措辞：`tdd is the engine inside the build step of the main chain, rather than a step of its own`。
- 作者在 `grilling` 页把链条起点单说了一句：`grill-with-docs is where the main build chain begins, ahead of to-spec`。
- `ask-matt` 页另给了一条「作者说这样写对多数情况是错的」静态表写法，作为对照：
  `wayfinder → to-spec → to-tickets → implement → code-review`
  原文：`A static table would say wayfinder → to-spec → to-tickets → implement → code-review and be wrong for most situations`。
- `ask-matt` 页对主流程的散文写法是 `Grill, spec, tickets, implement, review`，并说主流程里有两个分支：一个 prototype 绕行、一个 spec-and-tickets 拆分（后者只在跨多个会话时才值得）。

## ② 阶段边界的五个选项（作者写了哪几个、各保全什么）

五个选项的动作名（`handoff` 页原文）：`continue, clear, hand off, delegate or compact`，即 `continue`（继续，也就是留在原会话）、`/clear`、`/handoff`、`delegate`（委派子代理，即 subagent）、`/compact`。

各保全什么（作者原话）：

- `/compact preserves your intent`，且它是 `the bottom of the tree rather than the first reach`（树底而不是第一手），条件是「以上都不是」：`None of the above. The default, and it lands here often`。
- `/clear preserves nothing`；`Everything behind you is disposable. Cheapest move on the board, and one-way if you were wrong`。
- `/handoff preserves the work's ability to move`；它买到的就是可携带性：`portability is the whole of what it buys`，触发条件是 `Something has to travel: a new harness, a new directory, a colleague, a side task forked mid-phase`。
- `continue`：`The next phase wants this one verbatim, or you have smart zone left. It is the only move that keeps the session as a primary source, so rule it out first`。
- `delegate`（子代理）：`The task is scoped tightly enough to run with you away from the keyboard`。

作者另外强调两个常被搞错的点：`/handoff` 看起来像「会话之间通用的桥」但并不是；`/compact` 是兜底而不是第一手。这棵「有序树」的正文写在 `ask-matt` 页，`handoff` 页只说明树在别处、没有画出分支判断顺序。

## ③ 哪些页面没有 tags 字段

25 页里有 **18 页** 的 YAML 头部没有 `tags` 字段（照原稿「不是抓取失败」）：

- `web-01.md`：`/ask-matt`、`/setup-matt-pocock-skills`、`/grill-with-docs`（这批里只有 `/to-spec` 与 `/to-tickets` 有 tags）
- `web-02.md`：implement、code-review、wayfinder、research（这批里只有 prototype 有 tags）
- `web-03.md`：diagnosing-bugs、resolving-merge-conflicts、triage、wizard（这批里只有 improve-codebase-architecture 有 tags，且不是编号标签）
- `web-04.md`：to-questionnaire、teach、wait-what（这批里只有 grill-me 与 handoff 有 tags）
- `web-05.md`：writing-for-agents、codebase-design、domain-modeling、grilling（这批里只有 tdd 有 tags）

有 tags 的 **7 页** 及其 tags 原文：`/to-spec`（`build-the-right-thing`、`phase-4`）、`/to-tickets`（`build-the-right-thing`、`phase-5`）、prototype（`phase-3`、`build-the-right-thing`）、improve-codebase-architecture（`ship-solid-code`）、grill-me（`get-better-results`、`phase-1`）、handoff（`phase-6`、`get-better-results`）、tdd（`phase-6`、`test-and-evaluate`、`ship-solid-code`）。

也就是说：`phase-N` 编号只在 5 页上出现过（`phase-1`、`phase-3`、`phase-4`、`phase-5`、`phase-6`，其中 `phase-6` 出现在两个不同技能上），其余页面既没有 tags，也就没有编号可抄。
