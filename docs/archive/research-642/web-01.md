# 网站详情页摘录（第 01 部分，5 个技能）

本文件只记录从 aihero.dev 的技能详情页 markdown 版本抓下来的原文信息，地址规律为
`https://www.aihero.dev/skills-<技能名>.md`。抓取时间：本次任务执行时。

本次负责的 5 页：

1. `/ask-matt` — `https://www.aihero.dev/skills-ask-matt.md`
2. `/setup-matt-pocock-skills` — `https://www.aihero.dev/skills-setup-matt-pocock-skills.md`
3. `/grill-with-docs` — `https://www.aihero.dev/skills-grill-with-docs.md`
4. `/to-spec` — `https://www.aihero.dev/skills-to-spec.md`
5. `/to-tickets` — `https://www.aihero.dev/skills-to-tickets.md`

---

## 1. `/ask-matt`

来源：`https://www.aihero.dev/skills-ask-matt.md`（HTTP 200，抓到内容）

### 页面头部 YAML（原文）

```yaml
title: "The /ask-matt Skill"
slug: "skills-ask-matt"
type: "post"
description: "Find out which skill to use for the situation you are in."
updatedAt: "2026-08-24T09:14:47.195Z"
```

**tags：这一页的 YAML 里没有 `tags` 字段。**（不是抓取失败；该页头部只有上面 5 个键。因此这个技能没有可照抄的 `phase-N` 编号。）

`updatedAt` 说明这一页最后更新于 2026-08-24。

### 「Where it fits」原文摘录（整节）

> `ask-matt` is a **standalone router** that sits over the whole set. It is never a step in a chain; it points into every chain, and it is the node the other docs pages link back to so none of them has to redraw the graph. From here you most often land on [grill-with-docs](https://aihero.dev/skills-grill-with-docs), the head of the main flow, or [triage](https://aihero.dev/skills-triage), the on-ramp for work that arrived rather than work you started.
>
> It is a [secondary source](https://www.aihero.dev/ai-coding-dictionary/secondary-source) over the skills it describes. Where the router and a `SKILL.md` disagree, the `SKILL.md` is right.

定位结论（照原文）：它是一个 **standalone router**，**never a step in a chain**——不是任何一条链上的一环，而是「指向每一条链」的节点。

### 「When to reach for it」要点

原文开头两句：

> You invoke this by typing `/ask-matt`; the agent won't reach for it on its own.

页面用一张表回答「什么情况下用它」，表格原文：

| Your situation | What the router gives back |
| --- | --- |
| An idea, and no idea where to start | The head of the main flow, and whether the build is small enough to skip the spec |
| Bugs and requests arriving from other people | The [triage](https://aihero.dev/skills-triage) on-ramp, and why [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) you generated yourself don't belong on it |
| Two skills that look interchangeable | The line between them, and it is usually one concrete test rather than a matter of taste. [grill-me](https://aihero.dev/skills-grill-me) or [grill-with-docs](https://aihero.dev/skills-grill-with-docs) turns on whether you are in a working directory; [grill-with-docs](https://aihero.dev/skills-grill-with-docs) or [wayfinder](https://aihero.dev/skills-wayfinder) turns on whether the effort fits one session |
| A long session and a decision about the [context](https://www.aihero.dev/ai-coding-dictionary/context) | The ordered tree over the five options at a phase boundary |
| A skill you have already picked | Nothing useful. Invoke that skill directly. |

不该用的情况（原文）：

> It recommends and stops. It does not grill, write a [spec](https://www.aihero.dev/ai-coding-dictionary/spec), open a file or fire the skill it just named; what you get back is the next thing to type, and you type it. It is also a hand-written map of the skills in this repo rather than a scan of what you have installed, so it will not route you over your own skills or another author's.

即：已经自己选好技能时它「Nothing useful」，直接调那个技能即可。

### 这一页里出现的其它技能（含出现情境）

| 技能 | 出现情境 |
| --- | --- |
| `triage` | 推荐：别人送来的 bug 与需求走 triage 这个 on-ramp；也是「从这里最常落到」的两个去处之一 |
| `grill-me` 与 `grill-with-docs` | 对比／划边界：「是否在 working directory 里」是两者的分界线 |
| `grill-with-docs` 与 `wayfinder` | 对比／划边界：「这件事能不能装进一个 session」是两者的分界线 |
| `grill-with-docs` | 推荐：主流程的头部（the head of the main flow），从 ask-matt 最常落到这里 |
| `wayfinder` | 举例／对比：与 grill-with-docs 构成二选一 |
| `to-spec`、`to-tickets`、`implement`、`triage` | 前提条件说明：这些「tracker-dependent routes」假设 `setup-matt-pocock-skills` 已经配置好 issue tracker |
| `to-spec` | 举例：已知 bug 里提到 router 曾依据一句 gloss 建议跳过 `to-spec`，代价是漏掉一次 seam check |
| `implement` | 举例：有人问怎么让 implement 自动关闭工单 |
| `writing-for-agents`、`to-spec`、`wayfinder` | 改名说明：`writing-great-skills` → `writing-for-agents`（无别名）、`to-prd` → `to-spec`、`pathfinder` → `wayfinder` |
| `ubiquitous-language`、`design-an-interface`、`qa`、`request-refactor-plan` | 已退役（retired outright），被吸收进别的技能 |
| `grilling`、`resolving-merge-conflicts` | 举例：这两个比 router 更早发布，router 迟迟没写进它们 |
| `tdd` | 举例：某个被报告过的 session 里，router 误判整套 spec-and-tickets 流程不存在，改道到裸的 `/grilling` 和 `/tdd` |
| `handoff` | 见下节，phase boundary 的五个选项之一 |

另有非技能链接（均为 aihero.dev 词典条目，非技能）：`session`、`spec`、`ticket`、`context`、`grilling`（词典义）、`subagent`、`smart zone`、`primary source`、`harness`、`afk`、`agent mode`、`model`、`secondary source`。

### 顺序与衔接（逐句摘录）

**流（flow）的四种路线**，原文：

> The word the skill gives you to think with is **flow**: a path *through* the skills, not a single one. Naming your situation places you on a flow at a step, which is a different answer from "here is the skill that matches your keywords". Four kinds of route exist, and the skill itself carries them in full:
>
> - **The main flow**, idea to ship. Grill, spec, tickets, implement, review, with two branches inside it: a prototype detour when a question needs runnable code to settle, and the spec-and-tickets split, which only earns its cost when the build spans more than one session.
> - **On-ramps**, for a situation that generates work and then merges onto the main flow: incoming bug reports, something broken, or an effort too foggy and too large to hold in one session.
> - **Standalones**, off every flow, reached for on their own terms: the prototype, the questionnaire, the merge conflict you are already sitting in.
> - **A vocabulary layer underneath**, the two references the other skills pull in when the words rather than the process are the problem.

（注意：主流程在这一页被写成 `Grill, spec, tickets, implement, review`。）

**phase boundary 与跨会话／上下文处理**——这一页写得最细，整张表与说明原文：

> The other idea it hands you is the **phase boundary**. A phase is a chunk of work inside a session (the [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling), the implementation, the QA), and the boundary between two of them is the only place the question "what do I do with this context?" belongs. Mid-phase there is nothing to decide: continue, or split what is left into [subagents](https://www.aihero.dev/ai-coding-dictionary/subagent).

| Option | Take it when |
| --- | --- |
| **Continue** | The next phase wants this one verbatim, or you have [smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone) left. It is the only move that keeps the session as a [primary source](https://www.aihero.dev/ai-coding-dictionary/primary-source), so rule it out first |
| **`/clear`** | Everything behind you is disposable. Cheapest move on the board, and one-way if you were wrong |
| **[handoff](https://aihero.dev/skills-handoff)** | Something has to travel: a new [harness](https://www.aihero.dev/ai-coding-dictionary/harness), a new directory, a colleague, a side task forked mid-phase |
| **Subagent** | The task is scoped tightly enough to run with you [away from the keyboard](https://www.aihero.dev/ai-coding-dictionary/afk) |
| **`/compact`** | None of the above. The default, and it lands here often |

> Two of those are routinely got wrong, which is why the router carries the order rather than the list. `/handoff` reads like the general bridge between windows and is not: portability is the whole of what it buys. `/compact` is the bottom of the tree rather than the first reach, because the four questions above it are each cheaper or more precise.

跨会话相关的关键点（原文逐句）：
- `/handoff`：`Something has to travel: a new harness, a new directory, a colleague, a side task forked mid-phase`，且 `/handoff` reads like the general bridge between windows and is not: portability is the whole of what it buys.
- `/clear`：`Everything behind you is disposable. Cheapest move on the board, and one-way if you were wrong`
- `/compact`：`None of the above. The default, and it lands here often`，且它是 `the bottom of the tree rather than the first reach`。
- 子代理：`Mid-phase there is nothing to decide: continue, or split what is left into subagents`，以及 `The task is scoped tightly enough to run with you away from the keyboard`。
- 只在这个 boundary 上问「what do I do with this context?」。

**关于「为什么不做成一张按顺序的静态表」**（原文）：

> A static table would say `wayfinder → to-spec → to-tickets → implement → code-review` and be wrong for most situations, because the interesting parts are the branches: is there a codebase, does the build span sessions, can this question be settled by talking.

即作者明确给出了一条会「写错」的静态链条供对比：`wayfinder → to-spec → to-tickets → implement → code-review`。

**其它顺序线索**（原文）：
- `The head of the main flow, and whether the build is small enough to skip the spec`（小改动可以跳过 spec）
- `the spec-and-tickets split, which only earns its cost when the build spans more than one session`
- `The tracker-dependent routes (triage, to-spec, to-tickets, implement) assume setup-matt-pocock-skills has already configured an issue tracker in the repo. The router will happily recommend them before that has happened.`

### 抓不到或对不上的地方

- 该页 YAML 无 `tags` 字段（其余四页待核），因此 `/ask-matt` 没有 `phase-N` 编号可抄。
- 页面自述的已知问题（原文照抄，供交叉核对时注意）：
  - `Most of the skills the router routes you through set disable-model-invocation: true … Thirteen of the plugin's twenty-two skills carry the flag`（这里写的是插件共 22 个技能，与本地 25 个 SKILL.md 的数字不一致——**如实记录，不下结论**）。
  - router 的推荐来自它自己的一行摘要而非技能正文，曾出现跳过 `to-spec` 导致 tickets 少算工作量的报告。
  - router 是手工维护的，会落后于仓库（`grilling`、`resolving-merge-conflicts` 都比它早发布）。

---

## 2. `/setup-matt-pocock-skills`

来源：`https://www.aihero.dev/skills-setup-matt-pocock-skills.md`（HTTP 200，抓到内容）

### 页面头部 YAML（原文）

```yaml
title: "The /setup-matt-pocock-skills Skill"
slug: "skills-setup-matt-pocock-skills"
type: "post"
description: "Set up one repo so the other skills know how it works."
updatedAt: "2026-08-24T09:14:47.195Z"
```

**tags：这一页的 YAML 里也没有 `tags` 字段。**（与 `/ask-matt` 相同，只有上面 5 个键。）

### 「Where it fits」原文摘录（整节）

> `setup-matt-pocock-skills` is the **run-once setup** for the engineering flow, the precondition everything else assumes rather than a step in the chain. Its neighbours are its readers: [triage](https://aihero.dev/skills-triage), which applies the label vocabulary written here; [to-spec](https://aihero.dev/skills-to-spec) and [to-tickets](https://aihero.dev/skills-to-tickets), which publish into the tracker named here; and [wayfinder](https://aihero.dev/skills-wayfinder), which reads the "Wayfinding operations" section of the same tracker file to know how maps and child [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) are stored. The domain-doc layout it records is the one [domain-modeling](https://aihero.dev/skills-domain-modeling) fills in later: it creates `CONTEXT.md` and ADRs lazily, when a term or decision actually gets resolved, so an empty repo after setup is the expected state. For which skill to reach for next, [ask-matt](https://aihero.dev/skills-ask-matt) routes the whole set.

定位结论（照原文）：**run-once setup**，是 `the precondition everything else assumes rather than a step in the chain`——「一次性的前置配置」，**不是链上的一步**，但被所有其它技能假设为已发生。

### 「When to reach for it」要点

原文：

> You invoke this by typing `/setup-matt-pocock-skills`; the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) won't reach for it on its own. It is deliberately marked non-invokable, so no other skill can fire it for you.
>
> Reach for it once per repo, before the first use of any other engineering skill. If [triage](https://aihero.dev/skills-triage), [to-spec](https://aihero.dev/skills-to-spec), [to-tickets](https://aihero.dev/skills-to-tickets) or [wayfinder](https://aihero.dev/skills-wayfinder) start guessing where your issues go, or apply labels your tracker doesn't have, they have not been set up here yet. A repo already halfway through a project is a fine place to run it; the skill reads what is already there and no earlier work is wasted.

要点：**每个 repo 一次**，在**第一次用任何其它工程技能之前**。触发信号是下游技能开始瞎猜 issue 去哪、或贴出不存在的 label。半途的项目也可以补跑，「no earlier work is wasted」。

「It's working if」里给的两条下游效果（原文）：

> - Afterwards, `/to-tickets` publishes without asking you where issues live, and `/triage` applies labels rather than inventing them.
> - Nothing in the skill files themselves changed. If setup edited a `SKILL.md`, something went wrong.

### 这一页里出现的其它技能（含出现情境）

| 技能 | 出现情境 |
| --- | --- |
| `triage` | 推荐／依赖关系：它使用这里写下的 label 词表；只有 triage 装了才写 `triage-labels.md`，「Triage labels」这一项也只有此时才问 |
| `to-spec` | 前提条件：属于「依赖 tracker 的路线」，需要先跑过 setup，否则会乱猜 issue 去哪 |
| `to-tickets` | 前提条件／效果验证：它会往 setup 指定的 tracker 里发工单；setup 之后 `/to-tickets` publishes without asking where issues live |
| `wayfinder` | 前提条件／边界说明：它读同一个 tracker 文件的 "Wayfinding operations" 一节；另有一条重要提醒——`wayfinder:map` 与 `wayfinder:<type>` 这两个 label **不在这里创建**，GitHub 上 `gh issue create --label <missing>` 会直接失败 |
| `domain-modeling` | 后续衔接：它认领 setup 记下的 domain-doc 布局，`CONTEXT.md` 与 ADR 由它**懒创建**（真正解决一个术语或决定时才建）；setup 之后仓库还是空的属于预期状态 |
| `ask-matt` | 指路：想知道下一个该用哪个技能，交给 ask-matt 路由 |
| `grilling` | 边界说明：有人问能不能在这里配置 grilling 的节奏／提问格式／语气，答案是不能 |

### 顺序与衔接（逐句摘录）

- `Reach for it once per repo, before the first use of any other engineering skill.` —— **任何其它工程技能之前**，每 repo 一次。
- `The tracker-dependent routes ... assume setup-matt-pocock-skills has already configured an issue tracker in the repo.`（该句式出现在 `/ask-matt` 页；本页对应表述为下一句）
- `It is deliberately marked non-invokable, so no other skill can fire it for you.` —— 不能被别的技能自动拉起，只能人手动敲 slash command。
- `The skills themselves are identical everywhere; they read docs/agents/issue-tracker.md at run time and do what it says.` —— 技能本体到处一样，**运行时**去读 `docs/agents/issue-tracker.md` 并照做。
- `the domain-doc layout it records is the one domain-modeling fills in later: it creates CONTEXT.md and ADRs lazily, when a term or decision actually gets resolved` —— setup 先记账，domain-modeling 之后才填。
- 本页**没有**提到 `/handoff`、`/compact`、`/clear`、subagent、换会话这类跨会话操作。
- 「Do I need to re-run it after updating the skills?」一节给的重复运行条件（原文）：
  > Asked directly after v1.1, Matt said yes. The skill's own closing message is softer: it tells you re-running is only needed to switch trackers or start over. Both are defensible and the reason for the gap is real: the seed templates change between versions, so a `docs/agents/issue-tracker.md` written by an older release can go stale against the skills now reading it. If a downstream skill starts doing something the docs describe differently, re-running is the cheap fix.

### 抓不到或对不上的地方

- 该页 YAML 同样无 `tags` 字段，没有 `phase-N` 编号可抄。
- 页面自述的已知缺口（原文照抄，供交叉核对）：
  - `It wrote to CLAUDE.md, but I'm on Codex.`：`The file-selection rule is "edit CLAUDE.md if it exists, else AGENTS.md": it checks which file exists, not which harness is running.`（已知问题，仍未修）
  - `It didn't create my triage labels.`：`docs/agents/triage-labels.md` 是一张**映射表**，不会执行 `gh label create`；`wayfinder` 的 `wayfinder:map` / `wayfinder:<type>` 标签也不在此创建。
  - 没有 user-level / global 模式：`There is no user-level or global mode: the config lives in the repo, so every repo gets its own copy.`（`~/.claude` 的诉求是一条 open request）
  - 关于「重跑」有两套说法并存：Matt 在 v1.1 后口头说需要重跑，技能自己的收尾信息说只有在换 tracker 或重来时才有必要——**两说并存，原文如实记录**。

---

## 3. `/grill-with-docs`

来源：`https://www.aihero.dev/skills-grill-with-docs.md`（HTTP 200，抓到内容）

### 页面头部 YAML（原文）

```yaml
title: "The /grill-with-docs Skill"
slug: "skills-grill-with-docs"
type: "post"
description: "Get interviewed about a plan, and record the decisions."
updatedAt: "2026-08-24T09:14:47.195Z"
```

**tags：这一页的 YAML 里也没有 `tags` 字段。**（前三页一致，均无 `tags`，故都没有 `phase-N` 编号。）

### 「Where it fits」原文摘录（整节，含代码块）

> `grill-with-docs` is the head of the main build chain:
>
> ```txt
> grill-with-docs → to-spec → to-tickets → implement → code-review
> ```
>
> It comes before anything is written down as a spec: it produces the shared understanding and settled vocabulary that [to-spec](https://aihero.dev/skills-to-spec) then synthesises without interviewing you again. Its close neighbours are [grill-me](https://aihero.dev/skills-grill-me), the same interview with no repo and no files, and [domain-modeling](https://aihero.dev/skills-domain-modeling), the glossary-and-ADR discipline it drives; both sit on the [grilling](https://aihero.dev/skills-grilling) primitive. Upstream of it, [wayfinder](https://aihero.dev/skills-wayfinder) charts efforts too large for one session and can hand parts of the map back down to it. When you're unsure which skill or flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位结论（照原文）：**the head of the main build chain**，是**一条有顺序的路上的第一环**；作者在本页给出了一条明确的链条：
`grill-with-docs → to-spec → to-tickets → implement → code-review`。

### 「When to reach for it」要点

原文：

> You invoke this by typing `/grill-with-docs`; the agent will not reach for it on its own.
>
> Reach for it at the start of a change, in a repo, when the plan is still fuzzy and the words for the thing are not settled yet. It is the single-session tool. Which grilling skill you want depends on what is in front of you:

| What you have | Reach for |
| --- | --- |
| You aren't working in a working directory at all | [grill-me](https://aihero.dev/skills-grill-me) |
| A repo, and a change you can settle in one session | `grill-with-docs` |
| An effort too big to hold in one session (a greenfield build, a large feature) | [wayfinder](https://aihero.dev/skills-wayfinder) |
| A repo with no domain docs at all, and no particular feature in mind | `grill-with-docs`, aimed at the repo rather than a change |
| A decision blocked on knowledge in someone else's head | [to-questionnaire](https://aihero.dev/skills-to-questionnaire) |

> The wayfinder split comes down to session count: `/grill-with-docs` for single-session planning, `/wayfinder` for multi-session planning.

不该用／不该指望的：它是**单会话工具**，`It is the single-session tool`；太大装不进一个 session 的（greenfield build、大特性）应走 wayfinder。作者另在常见问题里写：`Wayfinder is slower and denser, and reaching for it on a well-scoped feature is the common mistake.`（对已经切得够细的特性上 wayfinder 是常见错误。）

### 这一页里出现的其它技能（含出现情境）

| 技能 | 出现情境 |
| --- | --- |
| `grill-me` | 对比／划边界：不做 working directory 的情况用它；也是 `grill-with-docs` 的「近邻」——`the same interview with no repo and no files`（同一套访谈，但没有仓库、不落文件） |
| `wayfinder` | 对比／划边界：分界线是 session 数（单会话 vs 多会话）；也是**上游**——它给一个 session 装不下的大工程画地图，并把地图的某些部分「hand parts of the map back down to it」；且「It does not replace this skill: it can drop into a grilling session for the parts of the map that suit one」 |
| `to-questionnaire` | 推荐：某个决定卡在别人脑子里的情况改用它 |
| `grilling` | 依赖（前置）：提供面试（访谈）这块本事，`grill-with-docs` 自己的一行 `SKILL.md` 只是委派给它 |
| `domain-modeling` | 依赖（前置）：提供「写下来」的纪律（glossary 与 ADR），同样是被委派的对象 |
| `to-spec` | 后续衔接（主流程下一步）：`grill-with-docs` 之后由它综合成 spec，且**不再重新访谈你**；反复出现为「会话结束后下一步该做什么」的答案 |
| `to-tickets` | 链条中的下一环（见 Where it fits 的链条图） |
| `implement` | 链条中的一环；另一处用于「改动小到可以立刻做」时的替代去处：`go straight to implement instead` |
| `code-review` | 链条的最后一环（见链条图） |
| `improve-codebase-architecture` | 举例／社区用法：需要建立或修复 `CONTEXT.md` 时，社区做法是「用 `grill-with-docs` 搭配它」 |
| `ask-matt` | 指路：不确定用哪个技能或哪条 flow 时由它路由 |

### 顺序与衔接（逐句摘录）

- 主链（原文含代码块）：`grill-with-docs → to-spec → to-tickets → implement → code-review`。
- `Reach for it at the start of a change, in a repo, when the plan is still fuzzy and the words for the thing are not settled yet.` —— 用在**一次改动的开头**。
- `It comes before anything is written down as a spec: it produces the shared understanding and settled vocabulary that to-spec then synthesises without interviewing you again.` —— **spec 之前**先做它；to-spec 不再重复访谈。
- **跨会话／上下文相关的关键句一并摘出：**
  > A session that yields a sharper glossary and zero ADRs is working as designed, but it means the bulk of what you agreed exists only in the [context window](https://www.aihero.dev/ai-coding-dictionary/context-window) you agreed it in. Hand that same conversation to [to-spec](https://aihero.dev/skills-to-spec) rather than [clearing](https://www.aihero.dev/ai-coding-dictionary/clearing) it.
  （注意：这里用的是词典义的 clearing／`/clear` 链接，指向 aihero.dev 词典页，不是技能页。意思是：**不要 clear，把同一个会话直接交给 to-spec**。）
- 会话收尾（原文）：
  > **What should I do when the session ends?** The skill's closing message tends to be open-ended, which is a known rough edge. In the main flow the answer is [to-spec](https://aihero.dev/skills-to-spec), in the same conversation. If the change is small enough to build immediately, go straight to [implement](https://aihero.dev/skills-implement) instead.
  —— **在同一个会话里**进入 to-spec；改动小就直接去 implement。
- 关于「其它决定去哪了」的缓解办法（原文）：
  > The mitigation available today is to keep the session and feed it straight to [to-spec](https://aihero.dev/skills-to-spec), and to re-read the spec against your own answers rather than assuming it captured them.
  —— 再次强调 **keep the session**（保住会话，别清）；并要拿 spec 对着自己的答案重读。
- `Upstream of it, wayfinder charts efforts too large for one session and can hand parts of the map back down to it.` —— wayfinder 在上游，可以把地图的一部分**回交给它**。
- **本页没有提到 `/handoff`、`/compact`、子代理（subagent）。** 唯一贴近的是上面那句「不要 clear，把会话直接交给 to-spec」。

### 抓不到或对不上的地方

- 该页 YAML 无 `tags` 字段（第三页，仍无编号可抄）。
- 页面自述的已知问题（原文照抄，供交叉核对）：
  - 在别的编排层里跑时（spec-driven-development wrapper、multi-agent framework、把它当成别人流水线里的一步的规则），**写文件那一半会静默不发生**，访谈照跑：`the file-writing half is reported to silently not happen, while the interview still runs. This is filed and unfixed.` —— 有这条时 `CONTEXT.md` 与 ADR 都不会出现。
  - 依赖装载失败（最常被报告的问题）：`Because SKILL.md is a one-line delegation, an agent that does not pick up grilling and domain-modeling guesses at what grilling means, and you get an undifferentiated question dump.` 局部装载产生「好访谈但没 paper trail」。`It correlates with model and effort level`。
  - 最实质的一条公开抱怨：没有 ledger 把每个答案串到 spec／ticket／test 上，精确答案（ordering guarantees、negative requirements、numeric defaults）会在下游被稀释成弱化散文。
  - 该页还写明：有人公开质疑 glossary 是否真能提升 agent 表现（`the sharpest public pushback is that a term and its plain-English expansion get the same result from the model`），作者仍认为 glossary 有价值，但价值点变了（`it really compresses communication between the humans who share it`）。
  - 名字：`Nobody is happy with the name.` 有人提议改名为 `grill-domain-model`，尚未动。
- **本页内容全部是散文式的已知问题归纳，不是 SKILL.md 的逐字描述**——页面上明说 router／文档对技能行为的断言可能与 `SKILL.md` 不符。本次未读本地技能文件，故未做一致性比对。

---

## 4. `/to-spec`

来源：`https://www.aihero.dev/skills-to-spec.md`（HTTP 200，抓到内容）

### 页面头部 YAML（原文）

```yaml
title: "The /to-spec Skill"
slug: "skills-to-spec"
type: "post"
description: "Turn an agreed conversation into a written spec."
tags:
  - build-the-right-thing
  - phase-4
updatedAt: "2026-08-24T09:14:47.195Z"
```

**tags（原文照抄，不翻译）：`build-the-right-thing`、`phase-4`。**

→ 前 3 页（ask-matt、setup-matt-pocock-skills、grill-with-docs）的 YAML 里没有 tags，**本页是本次 5 页中第一个带 `tags` 的**。编号 `phase-4` 与作者在 `Where it fits` 里给的链条位置（grill-with-docs → to-spec → …，第 2 环）不是一个数，值得对照。

### 「Where it fits」原文摘录（整节，含代码块）

> `to-spec` is a step in the main build chain, and only on the multi-session branch of it:
>
> ```txt
> grill-with-docs → to-spec → to-tickets → implement → code-review
> ```
>
> Its neighbours upstream are [grill-with-docs](https://aihero.dev/skills-grill-with-docs), which does the deciding this skill only records, and [wayfinder](https://aihero.dev/skills-wayfinder), whose finished map merges onto the chain right here. Downstream, [to-tickets](https://aihero.dev/skills-to-tickets) cuts the spec into tracer-bullet tickets for [implement](https://aihero.dev/skills-implement) to build. When you're unsure which skill or flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位结论（照原文）：**a step in the main build chain, and only on the multi-session branch of it**——链条上的一环，**而且只在「跨多个会话」那条分支上**才存在这一步。

### 「When to reach for it」要点

> You invoke this by typing `/to-spec`; the agent won't reach for it on its own.
>
> Reach for it when the build is too big for one agent [session](https://www.aihero.dev/ai-coding-dictionary/session) and has to survive being split across several. That is the whole trigger:

| Where you are | What to run |
| --- | --- |
| You haven't decided anything yet | [grill-with-docs](https://aihero.dev/skills-grill-with-docs) first |
| Decided, and the work fits one [context window](https://www.aihero.dev/ai-coding-dictionary/context-window) | [implement](https://aihero.dev/skills-implement): skip the spec |
| Decided, and the work spans several sessions | `/to-spec`, then [to-tickets](https://aihero.dev/skills-to-tickets) |
| A [wayfinder](https://aihero.dev/skills-wayfinder) map has cleared | `/to-spec #<map_issue>` |

不该用／可以跳过的（原文）：

> It does not interview you. By the time you reach for it the deciding is already done…
> **Why not go straight from grilling to /to-tickets and skip the spec?** Often you should; the spec earns its step only on multi-session work. … On a single-session change that buys you nothing, and you have paid an extra synthesis step where the model can drift. Go grilling → `/implement`.

另一条容易被误解的边界（原文）：

> **Is the spec for me to review, or is it just for the agent?** Mostly for the agent, and it reads that way: complete, dense, reference-heavy. The parts worth your eyes are the seams and the out-of-scope section…

### 这一页里出现的其它技能（含出现情境）

| 技能 | 出现情境 |
| --- | --- |
| `grill-with-docs` | 上游前置：它「做决定」，to-spec 只「记录决定」；`You haven't decided anything yet → grill-with-docs first`；另用于让架构性决定以 ADR 形式落地 |
| `wayfinder` | 上游衔接：地图做完后 `merges onto the chain right here`；喂给 to-spec 的是**主地图 issue** `#<map_issue>`，不是各个决定 ticket；`to-spec` is the step that collapses them into one buildable document |
| `to-tickets` | 下游：把 spec 切成 tracer-bullet 工单交给 implement；也出现在「工单可丢、spec 不丢」的对比里 |
| `implement` | 下游链条一环；以及「工作装得进一个 context window 就直接用它、跳过 spec」的替代路径 |
| `code-review` | 链条最后一环；另有一处实质衔接：它**对照 spec 审 diff**，所以没被约定的 seam 会变成 review finding |
| `tdd` | 实质衔接：`tdd works only at pre-agreed seams`（tdd 只在事先约定的 seam 上工作） |
| `setup-matt-pocock-skills` | 硬前提：必须先配好 tracker 与 triage-label 词表，否则 to-spec 没法把 spec 作为 issue 发出去 |
| `ask-matt` | 指路：不确定用哪个技能或哪条 flow 时由它路由 |

### 顺序与衔接（逐句摘录）

- 主链（原文含代码块）：`grill-with-docs → to-spec → to-tickets → implement → code-review`。
- `Reach for it when the build is too big for one agent session and has to survive being split across several. That is the whole trigger:` —— **唯一触发条件**是「要跨多个会话」。
- `Decided, and the work spans several sessions → /to-spec, then to-tickets` —— 先 to-spec，**然后** to-tickets。
- `A wayfinder map has cleared → /to-spec #<map_issue>`；`The main map issue: /to-spec #<map_issue>, not the individual decision tickets.`；`Looping the map straight into /implement throws that collapse away.`
- `Downstream, to-tickets cuts the spec into tracer-bullet tickets for implement to build.`
- `tdd works only at pre-agreed seams, and code-review reviews the diff against the spec, so a seam nobody agreed to shows up as a review finding.` —— 约定好的 seam 会**顺着这份文档往下传**（`Those agreed seams then travel.`）。
- `By the time you reach for it the deciding is already done, so it synthesises what is known (from the thread, from the codebase, from your CONTEXT.md and ADRs) rather than opening a fresh round of questions.`
- **跨会话／上下文相关的关键句（本页写得最明确）：**
  > The spec exists because context windows end. Everything you settled while grilling … is in one conversation that is about to be cleared. The spec is what survives that.
  >
  > So it does not validate anything, and it does not decide anything. It captures what was decided, in your project's own vocabulary, so that a fresh session can pick the work up without you re-explaining it.
  >
  > **`/to-tickets` couldn't read my spec: it kept truncating.** Very large specs can outgrow what a tracker issue will serve back cleanly, and there is no local copy to fall back on. The fix is context hygiene: don't [clear](https://www.aihero.dev/ai-coding-dictionary/clearing) or [compact](https://www.aihero.dev/ai-coding-dictionary/compaction) between `/to-spec` and `/to-tickets`. Run them in the same window and the spec never has to be re-fetched at all.
  —— 明确指令：**`/to-spec` 与 `/to-tickets` 之间不要 clear、不要 compact，在同一个 window 里连跑。**
- 关于 spec 的时效（原文）：
  > Nothing keeps it in sync, so in practice it is a snapshot of what you knew at that moment, and it goes stale the first time implementation teaches you something. Treat it as throwaway once the work ships. The artifacts meant to outlive it are your `CONTEXT.md` and your ADRs…
- **本页没有提到 `/handoff`、subagent。** 提到了 `/clear` 与 `/compact`（如上，且是「不要用」的语境），以及「a fresh session can pick the work up」。

### 抓不到或对不上的地方

- 本页 **有** `tags`，其中 `phase-4` 是本次 5 页里第一个出现编号的。注意它与链条上的实际位置（第 2 环）不是同一个数——**如实记录，不解释**。
- 页面自述的已知问题／限制（原文照抄）：
  - 旧名：`/to-prd` 已在 v1.1 改名为 `/to-spec`，旧 slug 作废；`The pair that replaced the old vocabulary is spec and tickets`。
  - spec 会带 `ready-for-agent` 标签，含义是 `"no further triage needed"`，是**输入标记不是工单**；但跑 AFK agent 轮询 `ready-for-agent` 时它们分不清，会试图一次做完整个 spec。`This is the most-reported rough edge on the skill.`
  - 重命名后没有 sync 机制，spec 会 stale；`Treat it as throwaway once the work ships.`
  - 模板偏向 user story，**对重构或模块边界类工作不合适**：`Less well, and this is a known limitation.`（建议把架构性决定交给 grill-with-docs 变成 ADR）
  - 不查 tracker 里是否已有重叠工作，不引用它遵守的 ADR：`No to both.`
- 本页未提供 spec 模板本身，也未列出它会写哪些小节（仅在问答里间接提到 implementation-decisions、testing-decisions、seams、out-of-scope 几节）。

---

## 5. `/to-tickets`

来源：`https://www.aihero.dev/skills-to-tickets.md`（HTTP 200，抓到内容）

### 页面头部 YAML（原文）

```yaml
title: "The /to-tickets Skill"
slug: "skills-to-tickets"
type: "post"
description: "Split a spec into small tickets an agent can build."
tags:
  - build-the-right-thing
  - phase-5
updatedAt: "2026-08-24T09:14:47.195Z"
```

**tags（原文照抄，不翻译）：`build-the-right-thing`、`phase-5`。**

→ 与 `/to-spec` 同一组 `build-the-right-thing`，编号接在 `phase-4` 之后：**4 → 5**，与链条顺序一致。

### 「Where it fits」原文摘录（整节，含代码块）

> `to-tickets` is a step in the main build chain:
>
> ```txt
> grill-with-docs → to-spec → to-tickets → implement → code-review
> ```
>
> Upstream is [to-spec](https://aihero.dev/skills-to-spec), which hands it a settled spec to slice against; keep both in one unbroken context window. Downstream is [implement](https://aihero.dev/skills-implement), which builds one ticket per fresh session, driving [tdd](https://aihero.dev/skills-tdd) for the tests and closing with [code-review](https://aihero.dev/skills-code-review). When you're unsure which skill or flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位结论（照原文）：**a step in the main build chain**（无条件地是链条上的一环，不像 to-spec 那样限定在 multi-session 分支）；上游是 to-spec，**两者要保持在同一个不被切断的 context window 里**；下游是 implement。

### 「When to reach for it」要点

> You invoke this by typing `/to-tickets`. The [agent](https://www.aihero.dev/ai-coding-dictionary/agent) won't reach for it on its own.

| Where you are | What to run |
| --- | --- |
| You have a spec issue and the build spans several sessions | `/to-tickets`, or `/to-tickets #<spec_issue>` |
| The plan is only in the conversation, never written up | `/to-tickets` reads the thread directly, no spec needed |
| The whole change fits in one context window | [implement](https://aihero.dev/skills-implement), skip the tickets |
| Nothing is decided yet | [grill-with-docs](https://aihero.dev/skills-grill-with-docs), then [to-spec](https://aihero.dev/skills-to-spec) |
| A [wayfinder](https://aihero.dev/skills-wayfinder) map has cleared | [to-spec](https://aihero.dev/skills-to-spec) first, to collapse the map, then `/to-tickets` |

明确的边界（原文）：

> Tickets that `to-tickets` produced are agent-ready by construction. Don't run [triage](https://aihero.dev/skills-triage) over them. Triage is for work that arrived from someone else.

另一条底线（原文）：

> The deeper answer is that the tickets have a floor: if the whole change fits in one context window, you don't need this skill at all. Go straight to [implement](https://aihero.dev/skills-implement).

即：**一个 context window 装得下的改动就不要用它。**可以不需要 spec（直接从对话切），但仍要 setup 过的 tracker。

### 这一页里出现的其它技能（含出现情境）

| 技能 | 出现情境 |
| --- | --- |
| `to-spec` | 上游（决定性衔接）：to-spec 交出已定的 spec 供它切；必须与 to-spec 共用一个不被切断的 context window；wayfinder 地图清空后要先 to-spec 再它 |
| `implement` | 下游：`builds one ticket per fresh session`；以及「一个 context window 装得下就跳过 tickets 直接用它」；另有已知问题——implement 完成后**不可靠地关单/勾选**（GitHub 与本地 markdown 都是） |
| `tdd` | 下游内嵌：implement 会驱动 tdd 写测试 |
| `code-review` | 下游收尾：implement 以 code-review 收口 |
| `grill-with-docs` | 上游：`Nothing is decided yet → grill-with-docs, then to-spec` |
| `wayfinder` | 上游衔接：地图清空后要先 to-spec 把地图收拢（collapse the map），再 to-tickets |
| `triage` | 边界说明（**否定式**）：不要对本技能产出的工单跑 triage，`Triage is for work that arrived from someone else` |
| `setup-matt-pocock-skills` | 硬前提：必须先为该 repo 配好 tracker 与 triage-label 词表 |
| `ask-matt` | 指路：不确定用哪个技能或哪条 flow 时由它路由 |

### 顺序与衔接（逐句摘录）

- 主链（原文含代码块）：`grill-with-docs → to-spec → to-tickets → implement → code-review`。
- `Upstream is to-spec, which hands it a settled spec to slice against; keep both in one unbroken context window.` —— **to-spec 与 to-tickets 保持在同一个不被切断的 context window**。
- `Downstream is implement, which builds one ticket per fresh session, driving tdd for the tests and closing with code-review.` —— 下游每个工单**一个 fresh session**。
- `The whole change fits in one context window → implement, skip the tickets`。
- `A wayfinder map has cleared → to-spec first, to collapse the map, then /to-tickets`。
- 技能内部的顺序（原文）——**先 pre-factoring，再切分，最后才发布**：
  > Two things happen before anything is published. `to-tickets` looks for prefactoring (the principle "make the change easy, then make the easy change") and orders that work first. Then it presents the breakdown as a numbered list and quizzes you on it: is the granularity right, are the blocking edges real, should anything merge or split. Nothing reaches the tracker until you approve, and that quiz is the place to push back.
- 工单之间靠 **blocking edges** 排序（原文）：
  > Each ticket declares its **blocking edges**: the other tickets that have to finish before it can start.
  >
  > Local markdown: Text in one file per ticket under `.scratch/<feature>/issues/<NN>-<slug>.md`, numbered blockers-first … Top to bottom, by hand
  >
  > A real tracker (GitHub, Linear): Native blocking links, or sub-issues where the tracker has them … Any ticket whose blockers are done is on the **frontier** and can be grabbed
- **跨会话／上下文相关的关键句（逐句摘出）：**
  > It also sizes each ticket to fit in a single fresh [context window](https://www.aihero.dev/ai-coding-dictionary/context-window), because the thing that will pick the ticket up is a [session](https://www.aihero.dev/ai-coding-dictionary/session) that has never seen your spec.
  >
  > **It kept truncating when it tried to read my spec.** … Don't [clear](https://www.aihero.dev/ai-coding-dictionary/clearing) or [compact](https://www.aihero.dev/ai-coding-dictionary/compaction) between `/to-spec` and `/to-tickets`. Run them in the same context window and the spec never has to be fetched back at all.
  >
  > **The tickets are published. How do I actually run them?** The skill stops at the artifact, and there is no auto-dispatch mode. Dispatch is manual: look at the board, count the tickets with no open blockers, and open that many agent sessions. **One ticket per fresh context, cleared between them.** Be aware that [implement](https://aihero.dev/skills-implement) does not reliably close or check off the ticket when it finishes, on GitHub or in local markdown, so the ticket's state is yours to update.
  >
  > `to-tickets` produces the artifact; running it (one session at a time, or a fleet) is your job, not the skill's.
  —— 这一段是本次 5 页里对**跨会话开工方式**写得最实的一处：手动派活，**每个工单一个 fresh context，彼此之间要 cleared**；技能本身不做自动派发（no auto-dispatch mode）。
- **本页没有把 `/handoff`、`/compact` 写成推荐动作，也没有提到 subagent。** `/clear` 与 `/compact` 只出现在「to-spec 与 to-tickets 之间不要用」这条禁令里；「cleared between them」讲的是工单之间的 session 卫生。

### 抓不到或对不上的地方

- 本页 **有** `tags`：`build-the-right-thing`、`phase-5`（与 `/to-spec` 的 `phase-4` 连续）。前三页（ask-matt、setup、grill-with-docs）**均无 tags**——同一批页面头部格式不统一，如实记录。
- 页面自述的已知问题／限制（原文照抄，含两条 GitHub issue 号）：
  - **过度切分**：`Over-decomposition is the most reported friction on this skill`，模型默认切原子单位、丢掉能让它们有意义的归组；quiz 步骤就是为这个存在，叫它 merge 它会 merge。
  - **按层切**：`The tickets came out one per layer` —— 垂切规则就是针对这个失败写的，但技能有时还是这么产出。
  - **GitHub 上没建成 spec issue 的子 issue**：`Known and unfixed.` 报告横跨十几次运行与多个模型，`[most fully in issue #554](https://github.com/mattpocock/skills/issues/554)`，且在 Codex 上比 Claude 更严重。可用的原生命令：`gh issue create --parent <n>`、`gh issue edit <parent> --add-sub-issue <n>`。
  - **blocked-by 被写成正文而非真正的阻塞链接**：`[reported in issue #513](https://github.com/mattpocock/skills/issues/513)`，该 agent 甚至断言 GitHub 没有原生阻塞关系（实际有：`gh issue create --blocked-by 12,15`）。
  - **本地工单位置与 v1.1 说明不符**：v1.1 笔记说根级 `tickets.md`，作者认定为 bug（单文件并发写会 race），现改为 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，`NN` 是真工单 ID，所以 `/implement 03` 可用。
  - **验收标准可能什么都没验收**：模板只要求写标准、不要求能被判否，三种常见毛病被列了出来。
  - **无自动派发**，且 implement 不可靠地关单（见上）。
- 本页给了一个**真实案例的量化数字**（原文，供参考）：`One team ran a 26-ticket stack sliced by layer (corpus, producer, aggregator, selector) and got roughly twenty agent runs per closed ticket, about three quarters of them rework.`
- 本页另定义了 **wide refactor** 的例外走法（expand–contract：Expand → Migrate → Contract），以及「expand 被每个 migrate 批次阻塞、migrate 批次全部阻塞最终的 integrate-and-verify 工单」的顺序关系——这是本页独有的、别处没有的顺序结构。

---

## 5 页横向对照（仅记录各页原文事实，不作推断）

| 技能 | tags（原文） | Where it fits 的定位原话 | 是否在链条上 |
| --- | --- | --- | --- |
| `/ask-matt` | 无 tags | `a standalone router that sits over the whole set. It is never a step in a chain` | 否，指向每一条链 |
| `/setup-matt-pocock-skills` | 无 tags | `the run-once setup for the engineering flow, the precondition everything else assumes rather than a step in the chain` | 否，是前置条件 |
| `/grill-with-docs` | 无 tags | `the head of the main build chain` | 是，链头 |
| `/to-spec` | `build-the-right-thing`, `phase-4` | `a step in the main build chain, and only on the multi-session branch of it` | 是，仅多会话分支 |
| `/to-tickets` | `build-the-right-thing`, `phase-5` | `a step in the main build chain` | 是 |

**作者本人反复给出的同一条主链（4 页原文出现过，逐字一致）：**

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review
```

`/ask-matt` 那一页还额外记下了作者用来对照的「静态表写法」（他说这样写对多数情况是错的）：
`wayfinder → to-spec → to-tickets → implement → code-review`。

