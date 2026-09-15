# 作者网站技能详情页摘录（web-03）

本文件由 GitHub 研究票 #642 派生，负责 5 个技能详情页的 markdown 版本摘录。

抓取地址规律：`https://www.aihero.dev/skills-<技能名>.md`

本文件负责的 5 页：

1. `https://www.aihero.dev/skills-improve-codebase-architecture.md`
2. `https://www.aihero.dev/skills-diagnosing-bugs.md`
3. `https://www.aihero.dev/skills-resolving-merge-conflicts.md`
4. `https://www.aihero.dev/skills-triage.md`
5. `https://www.aihero.dev/skills-wizard.md`

摘录规则：中文写说明，作者原话一律保留英文原文，不做翻译改写。

---

## 1. improve-codebase-architecture

抓取状态：HTTP 200，内容完整（非占位）。

### 页面头部 YAML 原文

```yaml
title: "The /improve-codebase-architecture Skill"
slug: "skills-improve-codebase-architecture"
type: "post"
description: "Find the modules worth refactoring, as a visual report."
tags:
  - ship-solid-code
updatedAt: "2026-08-24T09:14:47.195Z"
```

- `title` 原文：`The /improve-codebase-architecture Skill`
- `description` 原文：`Find the modules worth refactoring, as a visual report.`
- `tags` 原文：只有一项 `ship-solid-code`。**这一页没有 `phase-N` 这种编号标签**，和本组其它页的情况需要逐页比对（见下面第 5 页的说明）。

### 「Where it fits」整节原文摘录

> `improve-codebase-architecture` is **periodic maintenance**: run it every few days, outside any chain, to queue up work rather than to do it. Its neighbours are [codebase-design](https://aihero.dev/skills-codebase-design), which owns the depth-and-seam vocabulary every candidate is written in, [grilling](https://aihero.dev/skills-grilling), which walks the decision tree once you have chosen a candidate, and [domain-modeling](https://aihero.dev/skills-domain-modeling), which keeps `CONTEXT.md` and the ADRs current as the decision settles. What it produces is an idea, which re-enters the main build flow at [grill-with-docs](https://aihero.dev/skills-grill-with-docs) or [to-spec](https://aihero.dev/skills-to-spec). For which skill fits a situation, [ask-matt](https://aihero.dev/skills-ask-matt) is the router over the whole set.

定位归纳（用大白话）：这个技能**不在主链路上**，是「隔几天跑一次的定期体检」，负责把待办攒出来，而不是把活干完。它产出的东西是「一个想法」，要回到主干流程才继续往下走。

### 「When to reach for it」一节要点

原文关键句：

> You invoke this by typing `/improve-codebase-architecture`; the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) will not reach for it on its own.
>
> It sits outside the build loop: it is not a step in the main loop but something you run periodically to queue up more work to improve the codebase.

四个使用场景（原文表格）：

| Situation | How it is used |
| --- | --- |
| Routine upkeep | Run it every few days, or whenever a spare moment appears, to stop structure rotting between features. |
| Before a big build | Point it at the [spec](https://www.aihero.dev/ai-coding-dictionary/spec): "how can we make this change easy?" This is the most effective prompt for it. |
| Brownfield audit | Run it on a large, unstructured or [vibe-coded](https://www.aihero.dev/ai-coding-dictionary/vibe-coding) repo to find out what shape it is actually in. |
| Legacy test work | Use it to find the missing seams first, before writing tests against untestable code. |

何时**不该**用（原文）：

- 已经选定某一个模块要设计时，用 codebase-design：`For designing one module you have already chosen, use [codebase-design](https://aihero.dev/skills-codebase-design): that is the bench, this is the survey that finds what to put on it.`
- 整个活太大、一个会话装不下时，用 wayfinder。
- 「某个具体的东西坏了」时，用 diagnosing-bugs。

### 这一页里出现的其它技能（含出处情境）

| 技能名 | 提及情境（作者原话要点） |
| --- | --- |
| `grilling` / `/grilling` | 推荐兼后续衔接：`and then [grills](https://www.aihero.dev/ai-coding-dictionary/grilling) you through whichever one you pick`；`Picking a candidate starts a [grilling](https://aihero.dev/skills-grilling) session over it`。也出现在抱怨里：作者说「不要 grill 我」这种关闭方式是用户自报的用法。 |
| `codebase-design` | 划边界／对比：`For designing one module you have already chosen, use [codebase-design](...): that is the bench, this is the survey...`；另有 FAQ：`/codebase-design` is a reference, not a session driver... Drive with this skill; consume that one. |
| `wayfinder` | 划边界：`For a whole effort too big to hold in one session, use [wayfinder](https://aihero.dev/skills-wayfinder).` |
| `diagnosing-bugs` | 划边界：`For "this specific thing is broken," use [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs). It hands back here when the real finding is that there is no good seam to lock the bug down.`（注意：这里写了**反向回流**——诊断完发现没有合适的缝，会交回本技能。） |
| `grill-with-docs` | 入口／举例：产出物 `re-enters the main build flow at [grill-with-docs](https://aihero.dev/skills-grill-with-docs) or [to-spec](...)`；FAQ 里也提到 `If the codebase has no shared vocabulary at all, [grill-with-docs](https://aihero.dev/skills-grill-with-docs) to establish one first tends to make this skill's output much better.` |
| `to-spec` | 流程衔接：`take the decision into [to-spec](https://aihero.dev/skills-to-spec), then [to-tickets](https://aihero.dev/skills-to-tickets), then [implement](https://aihero.dev/skills-implement).` |
| `to-tickets` | 同上流程链：`then [to-tickets](https://aihero.dev/skills-to-tickets), then [implement](https://aihero.dev/skills-implement).` |
| `implement` | 同上流程链末端。 |
| `domain-modeling` | 相邻技能：`[domain-modeling](https://aihero.dev/skills-domain-modeling), which keeps CONTEXT.md and the ADRs current as the decision settles.` |
| `ask-matt` | 路由：`For which skill fits a situation, [ask-matt](https://aihero.dev/skills-ask-matt) is the router over the whole set.` |
| `/refactor` | 反面举例（说明缺口）：`There is no dedicated /refactor skill for that case yet.` |

本页没有提到的本组其它技能：`resolving-merge-conflicts`、`triage`、`wizard` 均未出现。

### 页面里写明的顺序与衔接（逐句摘）

- `The refactor itself happens later, in a separate [session](https://www.aihero.dev/ai-coding-dictionary/session), through the normal build flow.`
- `The output of that session is a decision, not a diff. From there the normal flow applies: take the decision into [to-spec](https://aihero.dev/skills-to-spec), then [to-tickets](https://aihero.dev/skills-to-tickets), then [implement](https://aihero.dev/skills-implement).`
- `It hands back here when the real finding is that there is no good seam to lock the bug down.`（来自 diagnosing-bugs 条目，指回流到本技能）
- **跨会话用法（重要）**：`One candidate per session. Working through several in one conversation fills the [context window](https://www.aihero.dev/ai-coding-dictionary/context-window) with the report, the grilling, the domain-model edits and the code changes all at once. The report only lives in a temp file, so carry the candidate itself rather than the file: pick one, grill it, take the decision into /to-spec, and turn the rest into [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) you can pick up independently later. Put the chosen improvement into a spec rather than going straight to implementation.`
- **子代理相关**：`The exploration step names Claude Code's` `` `Agent` `` `tool with` `` `subagent_type=Explore` `` `directly, so a [harness](https://www.aihero.dev/ai-coding-dictionary/harness) without that tool may skip the parallel exploration rather than substitute its own.`
- 本页**没有**提到 `/handoff`、`/compact`、`/clear`。

### 抓不到或对不上的地方

- 标签不是编号标签：`tags` 只有 `ship-solid-code`，没有 `phase-N`。如果面板要按 phase 编号排序，这一页给不出编号。
- 本页更新时间为 `updatedAt: "2026-08-24T09:14:47.195Z"`（原样照抄）。该日期看起来晚于常识中的当前时间，疑似作者站点的时间戳写法或未来排期，这里只如实记录，不做推断。
- 本页 FAQ 明确说 `the skill does not yet have a documented no-grill mode`，即「不要 grill」并非官方文档化模式，只是用户自报可行。摘录时请勿当成官方能力。
- 本页提到的 `TYPESCRIPT.md` 「does not exist」，即该指引缺失，属作者自述的缺口。

---

## 2. diagnosing-bugs

抓取状态：HTTP 200，内容完整（非占位）。

### 页面头部 YAML 原文

```yaml
title: "The /diagnosing-bugs Skill"
slug: "skills-diagnosing-bugs"
type: "post"
description: "Diagnose a hard bug, starting from a repro that fails."
updatedAt: "2026-08-24T09:14:47.195Z"
```

- `title` 原文：`The /diagnosing-bugs Skill`
- `description` 原文：`Diagnose a hard bug, starting from a repro that fails.`
- `tags` 原文：**这一页的 YAML 里没有 `tags` 字段**，完全没有标签。这里如实记录「无 tags」，而不是猜一个。

### 「Where it fits」整节原文摘录

> `diagnosing-bugs` is a reach-for-it-anytime standalone. You drop into it when something is broken and drop out when the fix and its regression test are in; it holds no state and needs no prior setup. [ask-matt](https://aihero.dev/skills-ask-matt) routes "Something's broken" here.
>
> Two neighbours matter. [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) takes the [handoff](https://www.aihero.dev/ai-coding-dictionary/handoff) when the real finding is that the code has no seam to lock the bug down; the recommendation is made after the fix is in, when there is more information. [triage](https://aihero.dev/skills-triage) sits upstream of it for bugs that arrive as raw reports from other people, and does a shallower version of the same first two phases.

定位归纳（用大白话）：这个技能是**随时可用的独立件**，不在某条有顺序的路上。进去的时候是「有东西坏了」，出来的时候是「修复加回归测试都落地」。它不保存状态、不需要前置准备。它有两个邻居：`triage` 在它**上游**（接收别人给的原始 bug 报告），`improve-codebase-architecture` 在它**下游**（发现代码没有能锁住 bug 的缝时，接手过去）。

### 「When to reach for it」一节要点

原文关键句：

> Type `/diagnosing-bugs`, or the agent reaches for it on its own when a task fits: it is model-invoked, and fires on "diagnose" / "debug this" or on a report that something is broken, throwing, failing, or slow.
>
> Reach for it on the hard ones: a bug that resists a first look, an intermittent flake, a regression that crept in between two known-good states. It is heavy by design, and the wrong tool for a question you want answered in one message.

该用／不该用对照表（原文）：

| Your situation | Where to go |
| --- | --- |
| A specific defect you can describe as a symptom | This skill |
| A slow endpoint or a timing regression with a known before-and-after | This skill: it has a performance branch (measure a baseline, then bisect) |
| "Where are the bottlenecks in this codebase?", no specific symptom | Not this skill. It diagnoses one known failure, it does not audit |
| A raw bug report from someone else, not yet confirmed or written up | [triage](https://aihero.dev/skills-triage) first |
| Throwaway code to answer a design question, not chase a defect | [prototype](https://aihero.dev/skills-prototype) |
| Building a planned behaviour test-first | [tdd](https://aihero.dev/skills-tdd) |
| No good seam exists to lock the bug down | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture): this skill hands off there itself |

作者强调这个技能**本身很重**（`It is heavy by design`），并且**会被模型自己触发**（`it is model-invoked`）——对本组其它技能而言这条差别很关键。

### 这一页里出现的其它技能（含出处情境）

| 技能名 | 提及情境（作者原话要点） |
| --- | --- |
| `triage` | **上游顺序衔接**（两处）：对照表 `A raw bug report from someone else, not yet confirmed or written up | [triage](https://aihero.dev/skills-triage) first`；Where it fits 里 `[triage](https://aihero.dev/skills-triage) sits upstream of it for bugs that arrive as raw reports from other people, and does a shallower version of the same first two phases.` |
| `improve-codebase-architecture` | **下游交接**（三处）：对照表 `No good seam exists to lock the bug down | [improve-codebase-architecture](...): this skill hands off there itself`；正文 Phase 5 说明 `That absence is itself the finding, and it is what routes the post-mortem to improve-codebase-architecture.`；Where it fits 里 `improve-codebase-architecture takes the handoff when the real finding is that the code has no seam to lock the bug down; the recommendation is made after the fix is in, when there is more information.` |
| `prototype` | 划边界（对照表一行）：`Throwaway code to answer a design question, not chase a defect | prototype` |
| `tdd` | 划边界（对照表一行）：`Building a planned behaviour test-first | tdd` |
| `ask-matt` | 路由：`[ask-matt](https://aihero.dev/skills-ask-matt) routes "Something's broken" here.` |
| `/diagnose` | 旧名说明：`What happened to /diagnose? Renamed to /diagnosing-bugs in v1.0.0. The old name no longer exists.` |
本页**没有**提到：`resolving-merge-conflicts`、`wizard`、`codebase-design`、`wayfinder`、`grilling`、`to-spec`、`to-tickets`、`implement`、`grill-with-docs`。

### 页面里写明的顺序与衔接（逐句摘）

- `A raw bug report from someone else, not yet confirmed or written up | [triage](https://aihero.dev/skills-triage) first`
- `[triage](https://aihero.dev/skills-triage) sits upstream of it for bugs that arrive as raw reports from other people, and does a shallower version of the same first two phases.`
- `[improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) takes the [handoff](https://www.aihero.dev/ai-coding-dictionary/handoff) when the real finding is that the code has no seam to lock the bug down; the recommendation is made after the fix is in, when there is more information.`
- `That absence is itself the finding, and it is what routes the post-mortem to improve-codebase-architecture.`
- `Phase 5 has an escape hatch worth knowing about. The regression test is written before the fix, but only if a **correct seam** exists for it... Where the only available seam is too shallow, the skill is told to say so rather than write a test that gives false confidence.`
- 内部阶段顺序（本技能自述的六阶段）：`build a repro, minimise it, rank hypotheses, instrument, fix with a regression test, clean up`；门槛表里进一步写明 `Into Phase 2`→`Into Phase 3`→`Into Phase 4`→`Into Phase 5`→`Done` 各自必须成立的条件。

**关于与 triage 衔接的关键一条（原文，作者自己点出的盲区）：**

> **I already ran `/triage` on this bug report. Is this the same work again?**
> Partly, and neither skill admits it. As one reader put it: "Triage's step 3 is essentially a shallow, bounded instance of diagnosing-bugs Phase 1–2, but neither file mentions the other." Triage does a bounded "is this actually a bug, and what is the surface" pass; this skill does the thorough version. Running triage first is not wasted (its verification often gives you most of Phase 1's raw material), but expect to redo it properly here, and expect no cross-reference to tell you that.

**跨会话／子代理相关**：本页提到 [session] 的只有 `For a bug that only shows up sometimes...` 相关的循环构造，以及六阶段内部流程；**没有**提到 `/handoff`、`/compact`、`/clear`，**没有**提到 subagent（只在 HITL 里提到 `[human-in-the-loop](...)` bash script 与随技能附带的 `scripts/hitl-loop.template.sh`）。注意本页出现的 `handoff` 是词典词条链接（`ai-coding-dictionary/handoff`，意为交接），不是 `/handoff` 斜杠命令的用法说明。

### 抓不到或对不上的地方

- **`tags` 字段缺失**：本页 YAML 完全没有 `tags`。如果面板靠 `phase-N` 分组，这一页拿不到任何编号。
- 针对 `triage` 的关系，本页明确说**两个技能文件之间互相不引用**：`neither skill admits it` / `neither file mentions the other`。所以「diagnosing-bugs 与 triage 怎么接」这件事，站点上只有这一句读者转述加作者的确认，**技能文件里是没有的**。摘录时不要把「文件里有写」当成事实。
- 本页提到旧名 `/diagnose` 在 v1.0.0 改名为 `/diagnosing-bugs`，`The old name no longer exists.` 如果本地面板里还写着 `/diagnose`，属于过期叫法。
- 本页记录了两个仍未实装的诉求：缺少「写修复前的确认门槛」（[Issue #124](https://github.com/mattpocock/skills/issues/124)）与缺少输出脱敏护栏（[Issue #674](https://github.com/mattpocock/skills/issues/674)）；另有 `proactive` 性能巡检技能被 [proposed and closed](https://github.com/mattpocock/skills/issues/431)，`there is currently no skill for it`。这些都是作者自述的缺口，不是能力。
- 本页 `updatedAt` 同样为 `2026-08-24T09:14:47.195Z`，与第 1 页一致，故多页共享同一更新时间戳；仅如实记录。

---

## 3. resolving-merge-conflicts

抓取状态：HTTP 200，内容完整（非占位）。

### 页面头部 YAML 原文

```yaml
title: "The /resolving-merge-conflicts Skill"
slug: "skills-resolving-merge-conflicts"
type: "post"
description: "Finish a merge or rebase conflict, hunk by hunk."
updatedAt: "2026-08-24T09:14:47.195Z"
```

- `title` 原文：`The /resolving-merge-conflicts Skill`
- `description` 原文：`Finish a merge or rebase conflict, hunk by hunk.`
- `tags` 原文：**这一页的 YAML 里没有 `tags` 字段**，完全没有标签。如实记录「无 tags」。

### 「Where it fits」整节原文摘录

> A reach-for-it-anytime standalone with no dependencies on any other skill: it starts when git stalls and ends when the tree is clean and committed. Its only real neighbour is [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs), which takes over at the point where a merge resolved cleanly but the merged code misbehaves: a diagnosis problem, not a conflict one. It sits off the main idea-to-ship flow entirely, so [ask-matt](https://aihero.dev/skills-ask-matt) is the map for what runs before and after it.

定位归纳（用大白话）：**随时可用的独立件，不依赖任何其它技能**。从「git 卡住了」开始，到「工作区干净、已经提交」结束。它唯一真正的邻居是 `diagnosing-bugs`——接手的情形是「合并本身顺利解决了，但合完之后的代码行为不对」。作者明确说它**完全不在 idea-to-ship 主干流程上**。

### 「When to reach for it」一节要点

原文关键句：

> Type `/resolving-merge-conflicts`, or the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) reaches for it automatically when a task fits.
>
> Reach for it when git has already stopped on conflicts it could not resolve itself. It is scoped to the conflict in front of you, not to anything either side of it:

对照表（原文）：

| Your situation | Skill |
| --- | --- |
| Mid-merge or mid-rebase, conflict markers in the tree | This one |
| Merge finished, something now misbehaves for reasons you can't see | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) |
| Planning how to slice work so branches collide less | Neither: see the parallel-work question below |

不该用／边界（原文要点）：

- `It refuses to treat a conflict as a text problem.` 它拒绝把冲突当文本问题处理；先回溯两侧的 [primary source](https://www.aihero.dev/ai-coding-dictionary/primary-source)（commit message、PR、原始 issue），再动 hunk。
- `--abort` 不是它的选项：`--abort is not an option it has: the merge is always carried to a finished commit.` 以及 FAQ `Why never --abort?` 中：`Aborting throws away the resolution work and returns you to the same conflict, unchanged, the next time you try. The skill is written for the case where the merge is going to happen. If you have decided it should not happen, that is a decision to make before invoking, not a branch inside the loop.`
- `It invents no new behaviour to paper over a clash.`

### 这一页里出现的其它技能（含出处情境）

| 技能名 | 提及情境（作者原话要点） |
| --- | --- |
| `diagnosing-bugs` | 下游接手／划边界（两处）：对照表 `Merge finished, something now misbehaves for reasons you can't see | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs)`；Where it fits 里 `Its only real neighbour is [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs), which takes over at the point where a merge resolved cleanly but the merged code misbehaves: a diagnosis problem, not a conflict one.` |
| `ask-matt` | 路由／地图：`so [ask-matt](https://aihero.dev/skills-ask-matt) is the map for what runs before and after it.` |

本页**没有**提到：`triage`、`wizard`、`improve-codebase-architecture`、`codebase-design`、`prototype`、`tdd`、`grilling`、`wayfinder`、`to-spec`、`to-tickets`、`implement`。

### 页面里写明的顺序与衔接（逐句摘）

- `Its only real neighbour is [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs), which takes over at the point where a merge resolved cleanly but the merged code misbehaves: a diagnosis problem, not a conflict one.`（本技能 → 诊断技能的交接点）
- `so [ask-matt](https://aihero.dev/skills-ask-matt) is the map for what runs before and after it.`
- `It is scoped to the conflict in front of you, not to anything either side of it.`
- 触发条件：`Reach for it when git has already stopped on conflicts it could not resolve itself.`

**跨会话／子代理相关（本页出现了一条明确讲过会话边界的用法）：**

> One caveat from a user report on parallel worktrees: when sibling [sessions](https://www.aihero.dev/ai-coding-dictionary/session) each build a ticket in their own tree, the merge back is best done by the session that wrote the change, because it is the one that already knows the intent. Batching everybody's conflicts onto one agent at the end throws away exactly the [context](https://www.aihero.dev/ai-coding-dictionary/context) step 2 of this skill has to go and reconstruct.

以及关于并行代理的纪律：

> **Should I keep parallel agents off the same files to avoid conflicts in the first place?**
> Mostly no. Zoning files off between parallel tasks costs more than it saves, because agents are good enough at merge conflicts that the tradeoff is not as harsh as it looks. The one piece of discipline worth keeping is to do large refactors first. A large rename landing after ten branches have forked off it is the case that stays expensive.

本页**没有**提到 `/handoff`、`/compact`、`/clear`，也没有用「subagent」这个词（讲并行时用的是 `parallel agents`、`sibling sessions`、`worktrees`）。

### 抓不到或对不上的地方

- **`tags` 字段缺失**：本页 YAML 完全没有 `tags`，拿不到 `phase-N` 编号。
- 本页作者自己给这个技能的长期价值打了折扣：`That is a thin margin over a good [model](...), and it is meant to be: at least one reader has predicted this is a whole skill that becomes a no-op as models improve.` 摘录时请如实带上，这是个「可能将来没用」的自我评价，不是单纯的推荐语。
- 本页与本地技能可能有说法差异：站点版**明确排除 `--abort`**，且要求把多提交 rebase 里的每个剩余提交都做完（`including every remaining commit in a multi-commit rebase`）。如果本地 SKILL.md 里给了 abort 选项，那是站点与本地的不一致，本文件只记录站点原文，不做判断。
- `updatedAt` 同样是 `2026-08-24T09:14:47.195Z`。

---

## 4. triage

抓取状态：HTTP 200，内容完整（非占位），信息量是本组最大的一页之一。

### 页面头部 YAML 原文

```yaml
title: "The /triage Skill"
slug: "skills-triage"
type: "post"
description: "Sort raw issues into work someone can pick up."
updatedAt: "2026-08-24T09:14:47.195Z"
```

- `title` 原文：`The /triage Skill`
- `description` 原文：`Sort raw issues into work someone can pick up.`
- `tags` 原文：**这一页的 YAML 里没有 `tags` 字段**，完全没有标签。如实记录「无 tags」。

### 「Where it fits」整节原文摘录

> `triage` is an **on-ramp**, not a step in the main chain. The main flow runs from an idea you had (grill, spec, tickets, implement, review), and `triage` is the parallel lane for work that arrived instead. It merges at the same place: an issue labelled `ready-for-agent` with a brief on it, which [implement](https://aihero.dev/skills-implement) picks up exactly as it would a ticket from [to-tickets](https://aihero.dev/skills-to-tickets). When a request needs sharpening before it can be briefed, `triage` runs [grilling](https://aihero.dev/skills-grilling) and [domain-modeling](https://aihero.dev/skills-domain-modeling) together, a round of questions at a time, so decisions land in `CONTEXT.md` and the ADRs as they're made. When you're not sure which lane you are in, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位归纳（用大白话）：`triage` 是**入口匝道**，不是主链上的一环。主干流程是「你自己想出来的想法」（grill → spec → tickets → implement → review）；`triage` 是给「别人送上门来的活」准备的**平行车道**。两条道在**同一个位置汇合**：一个被打上 `ready-for-agent`、附有 agent brief 的 issue，`implement` 会像捡自己票子一样把它捡走——它和 `to-tickets` 产出的工单在这一点上完全等价。

### 「When to reach for it」一节要点

原文关键句：

> You invoke this by typing `/triage` and then describing what you want in plain language. The [agent](https://www.aihero.dev/ai-coding-dictionary/agent) won't reach for it on its own. "Show me anything that needs my attention", "let's look at #42", "move #42 to ready-for-agent".

注意：与 `diagnosing-bugs` 相反，**这一页明确说 agent 不会自己用它**。

对照表（原文）：

| What you have | Where to go |
| --- | --- |
| A tracker full of raw reports from other people | `/triage` |
| A rough idea of your own, nothing written down | [grill-with-docs](https://aihero.dev/skills-grill-with-docs) |
| A settled conversation to turn into a [spec](https://www.aihero.dev/ai-coding-dictionary/spec) | [to-spec](https://aihero.dev/skills-to-spec) |
| A spec to split into agent-ready tickets | [to-tickets](https://aihero.dev/skills-to-tickets) |
| A confirmed bug that needs a root cause, not a label | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) |

**不该用（作者写成「平面的规则」）原文：**

> It is only for issues **you didn't create**. Raw bug reports, incoming feature requests, an external pull request that arrived unannounced: work that landed in the tracker from outside, in whatever shape the reporter left it. [Tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) that [to-tickets](https://aihero.dev/skills-to-tickets) produced are already agent-ready by construction, and running `triage` over them is wasted work at best. The rule is flat: `/triage` is only for incoming issues, not for issues you created yourself.

以及 FAQ 中同一件事的另一种说法：

> **Is `triage` still relevant now that there's a `to-spec` → `to-tickets` → `implement` flow?**
> Only if you have inbound work. `triage` predates that spine and does a different job: it is the lane for reports other people filed. If everything in your tracker came out of your own planning, you will rarely open it. If you maintain anything public, or your team files bugs at you, it is the front door. The main use is open-source repos taking issues from external contributors.

前提条件（原文要点）：依赖 `setup-matt-pocock-skills` 先把 issue tracker 与其标签词汇配对；

> `triage` reads and writes your issue tracker, so [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) has to have configured that tracker and its label vocabulary first. The role names below are **canonical**; the label strings in your tracker may differ, and the mapping is what setup provides.

### 这一页里出现的其它技能（含出处情境）

| 技能名 | 提及情境（作者原话要点） |
| --- | --- |
| `implement` | **汇合点衔接**（核心）：`It merges at the same place: an issue labelled ready-for-agent with a brief on it, which [implement](https://aihero.dev/skills-implement) picks up exactly as it would a ticket from [to-tickets](...)` |
| `to-tickets` | 对比／汇合参照（两处）：同上句；以及 `Tickets that [to-tickets](https://aihero.dev/skills-to-tickets) produced are already agent-ready by construction, and running triage over them is wasted work at best.` |
| `to-spec` | 平行车道上的相邻步骤：对照表 `A settled conversation to turn into a spec | [to-spec](https://aihero.dev/skills-to-spec)`；FAQ 里 `Is triage still relevant now that there's a to-spec → to-tickets → implement flow?` |
| `diagnosing-bugs` | 划边界（对照表 + 专门一段 FAQ）：对照表 `A confirmed bug that needs a root cause, not a label | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs)`；FAQ `How is this different from /diagnosing-bugs?` 全文见下 |
| `grill-with-docs` | 划边界：对照表 `A rough idea of your own, nothing written down | [grill-with-docs](https://aihero.dev/skills-grill-with-docs)` |
| `grilling` | 内部调用的子流程：`When a request needs sharpening before it can be briefed, triage runs [grilling](https://aihero.dev/skills-grilling) and [domain-modeling](https://aihero.dev/skills-domain-modeling) together, a round of questions at a time, so decisions land in CONTEXT.md and the ADRs as they're made.` |
| `domain-modeling` | 同上，与 grilling 一起被 triage 调用。 |
| `ask-matt` | 路由：`When you're not sure which lane you are in, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.` |
| `setup-matt-pocock-skills` | 前置依赖：见上面 Prerequisites 原文。 |

本页**没有**提到：`resolving-merge-conflicts`、`wizard`、`improve-codebase-architecture`、`codebase-design`、`wayfinder`、`prototype`、`tdd`。

### 页面里写明的顺序与衔接（逐句摘）

**（一）与主干流程的汇合点（本组最重要的一条）：**

- `triage` is an **on-ramp**, not a step in the main chain.
- `It merges at the same place: an issue labelled ready-for-agent with a brief on it, which [implement](https://aihero.dev/skills-implement) picks up exactly as it would a ticket from [to-tickets](https://aihero.dev/skills-to-tickets).`
- FAQ：`They meet at ready-for-agent, not before.`
- FAQ 原文：`No. They are already agent-ready, because to-tickets applies the ready-for-agent label as it publishes, precisely so an AFK runner picks them up without another pass. The user who hit this had run the spec flow, seen needs-triage on the output, and found their AFK runner ignoring everything. triage is the on-ramp for work that arrives from outside; the spec flow is the lane for work you originate. They meet at ready-for-agent, not before.`

**（二）与 `diagnosing-bugs` 的边界与「怎么接」（整段原文，此条对这一组尤其关键）：**

> **How is this different from `/diagnosing-bugs`?**
> The verification step here is deliberately shallow (enough to answer "is this real, and roughly where does it live"), not to find a root cause. When a bug won't reproduce from the reporter's steps in a few minutes, the honest move is `needs-info`, or [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) if you want to chase it now. Neither skill's text currently mentions the other; a user found that seam, and it is still open.

即：triage 的核对**刻意做浅**，只回答「是不是真的、大概在哪」；几分钟复现不出来，就标 `needs-info`，或者**你此刻就想追根因，就直接上 `diagnosing-bugs`**。作者同时承认**两个技能文件彼此都没写对方**，这条缝是用户发现的，**仍未修**。

**（三）triage 内部的顺序（原文）：**

- 状态机：`Every triaged item ends up carrying exactly one category role and one state role.` 两个类别（`bug` / `enhancement`）与五个状态（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。其中 `needs-info` 的说明里写明回流：`Waiting on the reporter. Returns to needs-triage when they reply.`
- 核对先于写简报：`Before any [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling), triage checks that the claim actually holds.`（先复现或检出 PR 并跑测试，再产出 `agent brief`）
- 查重与查旧否决：`It runs two more checks against the codebase in the same pass: **redundancy**... and **prior rejection** (does .out-of-scope/ already say no?). Both are cheap, and both produce a wontfix when they hit.`
- `triage` reads the whole directory before it evaluates anything
- 产出契约：`Once it's posted, the brief is the contract and the original report is only context. Briefs are written to be **durable** rather than precise... So they name types, signatures and behavioural contracts, and never file paths or line numbers.`

**（四）跨会话／子代理相关：**

- 本页明确用到了 [AFK](https://www.aihero.dev/ai-coding-dictionary/afk) agent（无人值守跑任务的代理）：`ready-for-agent` 状态说明 `Fully specified, with an agent brief attached. An AFK agent can take it.`；FAQ 里 `to-tickets applies the ready-for-agent label as it publishes, precisely so an AFK runner picks them up without another pass.`，以及缺终态的后果 `without which an AFK runner can re-queue finished tickets.`
- 关于「一次跑一整个 backlog」的会话风险：`The "show what needs attention" pass is a cheap listing meant for *selection*, where you pick one, and then it gathers full context on the one you picked. Run it across twenty issues at once and an agent can quietly fall back to that cheap listing as its evidence base...`（作者建议：`If you want a bulk pass, say explicitly that comments must be read per issue.`）
- 关于 brief 的耐久性，隐含跨时间而非跨会话：`an issue can sit in ready-for-agent for weeks while the code moves underneath it`
- 本页**没有**提到 `/handoff`、`/compact`、`/clear`，也没有用「subagent」这个词。

### 抓不到或对不上的地方

- **`tags` 字段缺失**：本页 YAML 完全没有 `tags`，拿不到 `phase-N` 编号。
- 作者自述的**未修缺口**（如实照抄，不要当成能力）：五状态不够用是被提得最多的缺口，三种形态（blocked 被另一 issue 卡住 [#139](https://github.com/mattpocock/skills/issues/139)、trigger-gated 未来工作 [#297](https://github.com/mattpocock/skills/issues/297)、缺 `implemented` 终态），`None of it has shipped.` 作者已承认 blocked 这个情况真实存在，但**名字还没定**（`blocked` 还是 `paused`）。
- 已知 bug：`setup-matt-pocock-skills` 只把标签词汇写进 `docs/agents/triage-labels.md`，**不会在 tracker 里真建标签**（[#616](https://github.com/mattpocock/skills/issues/616)，需手工 `gh label create`）；GitHub 模板里的外部 PR 列举命令请求了 `gh` 不提供的 `authorAssociation` 字段，**照写就会失败**（[#468](https://github.com/mattpocock/skills/issues/468)）；本地 markdown tracker 模板可能把验收标准写两遍（[#200](https://github.com/mattpocock/skills/issues/200)）。
- 与本地文件的**可能不一致**（只记录站点说法，不做判断）：站点说标签角色名是 **canonical**（规范名），而具体标签字符串由 setup 映射；仓库 `AGENTS.md` 里写的是「五个 canonical triage 角色（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）」——名字对得上，但站点还强调**类别标签**（`bug` / `enhancement`）也是这套词汇的一部分，且站点说「创建这五个状态标签和两个类别标签要你自己做一次」。两地是否完全一致，本文件不作结论。
- 站点提到社区派生版额外加了 `needs-slicing`、`tracking` 和 effort 标签：`That works, but it is theirs, not the skill's.` 不要当成官方词汇。
- `updatedAt` 同样是 `2026-08-24T09:14:47.195Z`。

---

## 5. wizard

抓取状态：HTTP 200，内容完整（非占位）。

### 页面头部 YAML 原文

```yaml
title: "The /wizard Skill"
slug: "skills-wizard"
type: "post"
description: "Generate a script that walks a human through setup."
updatedAt: "2026-08-24T09:14:47.195Z"
```

- `title` 原文：`The /wizard Skill`
- `description` 原文：`Generate a script that walks a human through setup.`
- `tags` 原文：**这一页的 YAML 里没有 `tags` 字段**，完全没有标签。如实记录「无 tags」。

**关于 tags 的汇总（本组 5 页的实情）**：只有第 1 页 `improve-codebase-architecture` 带标签，且标签是 `ship-solid-code`，**不是 `phase-N` 编号**；其余 4 页（`diagnosing-bugs`、`resolving-merge-conflicts`、`triage`、`wizard`）的 YAML 里都没有 `tags` 字段。也就是说，**本组这 5 页都拿不到 `phase-N` 这种顺序编号**，不能按编号给它们排先后。

### 「Where it fits」整节原文摘录

> `wizard` is a reach-for-it-anytime standalone, sitting at the line where automation stops and a human has to click. Its nearest neighbour is [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills), because both exist to get a repo into a working state: that one configures this skill set, while `wizard` generates a setup path for everything else. It also pairs with [implement](https://aihero.dev/skills-implement): when a build lands a feature that needs credentials or a manual cutover, a wizard is how the human half gets done. When you're unsure which skill fits the moment, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位归纳（用大白话）：**随时可用的独立件**，站在「自动化到头了、接下来只能人来点」的那条线上。最近的一个邻居是 `setup-matt-pocock-skills`——两者都是把仓库弄成可用状态，区别是**那个配的是这一整套技能，`wizard` 生成的是「其它一切东西」的搭建路径**。它还和 `implement` 搭配：构建交付了一个需要凭据或需要人工切换的功能时，人手那一半用 wizard 来走。

### 「When to reach for it」一节要点

原文关键句：

> You can type `/wizard`, and the agent can also reach for it on its own. When it hits a step you have to take (a key it can't mint, a dashboard it can't click), it builds you a wizard instead of writing the instructions into the chat, where they scroll away.

即：**用户可调，agent 也会自己调**（model-invoked）。

适用情形对照表（原文）：

| Situation | What the wizard does |
| --- | --- |
| A new dev needs six services configured before the app boots | Opens each dashboard in order, captures the keys, writes them to `.env` and CI |
| A one-off migration needs switches flipped in a specific order | Sequences the irreversible steps behind confirmation gates |
| A project has to move from state A to state B once | Walks the transition and reports what it could not do |
| You are about to write those steps into a README | Writes an executable version instead, which can't rot as quietly |

不该用（原文）：

> Don't reach for it to *decide* what to build; for that, [grill-with-docs](https://aihero.dev/skills-grill-with-docs) and [to-spec](https://aihero.dev/skills-to-spec) are the tools.

### 这一页里出现的其它技能（含出处情境）

| 技能名 | 提及情境（作者原话要点） |
| --- | --- |
| `grill-with-docs` | 划边界（两处）：`Don't reach for it to decide what to build; for that, [grill-with-docs](https://aihero.dev/skills-grill-with-docs) and [to-spec](...) are the tools.`；FAQ 里作为常见猜测链的一环 `The common guess is /grill-with-docs → /to-spec → /wizard, and that sequence is fine, but the trigger is a manual procedure showing up, which can happen at any point` |
| `to-spec` | 同上两处（划边界与常见猜测链）。 |
| `setup-matt-pocock-skills` | 最近邻居／对比：`Its nearest neighbour is [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills), because both exist to get a repo into a working state: that one configures this skill set, while wizard generates a setup path for everything else.` |
| `implement` | 搭配使用：`It also pairs with [implement](https://aihero.dev/skills-implement): when a build lands a feature that needs credentials or a manual cutover, a wizard is how the human half gets done.` |
| `ask-matt` | 路由：`When you're unsure which skill fits the moment, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.` |
| `grilling` | 只在 FAQ 的猜测链里以 `/grill-with-docs → /to-spec` 相邻出现，本页没有单独展开讲 grilling。 |

本页**没有**提到：`diagnosing-bugs`、`triage`、`resolving-merge-conflicts`、`improve-codebase-architecture`、`codebase-design`、`wayfinder`、`prototype`、`tdd`。

### 页面里写明的顺序与衔接（逐句摘）

**（一）关于「它是不是链路里的一步」，本页给的是最明确的否定（本组关键一条）：**

> **Where does it sit in the workflow, after grilling and the spec?**
> Nowhere in particular. It's a standalone, not a chain step. The common guess is `/grill-with-docs → /to-spec → /wizard`, and that sequence is fine, but the trigger is a manual procedure showing up, which can happen at any point: before you start, mid-build, or long after ship. It also works as a discovery tool: scoping surfaces the hidden prerequisites of a task, like the three API keys you hadn't thought about, before you commit to the work.

**（二）与 `implement` 的搭配（唯一一处正向搭配描述）：**

- `It also pairs with [implement](https://aihero.dev/skills-implement): when a build lands a feature that needs credentials or a manual cutover, a wizard is how the human half gets done.`

**（三）脚本内部的顺序（原文，属技能内部流程而非跨技能衔接）：**

- `You author stages in dependency order and set TOTAL_STAGES, which drives the progress display.`
- `Scoping happens before a line is written.` → 先扫仓库找出要产出的值 → `It then shows you the ordered stage list to confirm, and only after that maps each stage to the exact path a human follows`
- 无回退：`There is no back button: the stages run forward, and a wrong answer on stage 3 means Ctrl-C and re-run.`

**（四）跨会话／子代理相关：**

- 本页讲的是**人机分工**而不是跨会话：`The [agent](https://www.aihero.dev/ai-coding-dictionary/agent) writes the script; it never runs it. You do, on your own machine.` / `The agent that writes a wizard never runs it end to end, because it opens browsers and waits for human input. It verifies statically instead... Set your expectations accordingly: the first run is yours, and that run is the test.`
- 秘密不进模型上下文：`You run the script yourself, and it captures the key with hidden terminal entry and writes it straight to .env or gh secret. The wizard is a CLI, and the model is not connected to it.`
- 本页**没有**提到 `/handoff`、`/compact`、`/clear`，也没有用「subagent」这个词。

### 抓不到或对不上的地方

- **`tags` 字段缺失**：本页 YAML 完全没有 `tags`，拿不到 `phase-N` 编号。
- 调用方式与本地环境可能不一致：站点说 `typing /wizard`，并说它在 Claude Code / Codex / 其它 harness 都能用（`type /wizard in Claude Code or $wizard in Codex`）。本仓库是 DSH 环境，命令写法是否相同，本文件不作结论。
- 站点记录了作者自述的**未修缺口**（如实照抄，不要当能力）：没有回退按钮（`There is no back button`，来自启动周反馈，`hasn't been closed since`）；`ask` 提示里方向键会插入 `^[[D` / `^[[C` 而不能移动光标，因为提示用的是 `read -r` 而不是 Readline（[issue #741](https://github.com/mattpocock/skills/issues/741)），退格可用、方向键不可用。
- 站点提到相关的外部缺陷：[#693](https://github.com/mattpocock/skills/issues/693) 里 Claude 的桌面端与网页端会把*用户可调*的技能从模型清单里丢掉并报成未安装。这是作者解释「本技能改为 model-invoked 反而更稳」的论据，不是本技能自身的缺陷。
- 站点说这个技能**原来放在 `in-progress/`，v1.2 起改到 `engineering/`**：`engineering/, as of v1.2. It graduated out of the beta bucket and now ships in the plugin... Its behaviour didn't change on graduation.` 如果本地目录结构用的是 `in-progress/`，那是旧位置。
- 站点说它**曾经是 user-invoked，现在是 model-invoked**：`It did. It's now model-invoked... Nothing you could do before stopped working: model-invocation *adds* the agent's reach, it never removes yours`。本地技能文件若写「不要主动调用」属过期说法，但这属本地文件问题，本文件只记录站点原文。
- `updatedAt` 同样是 `2026-08-24T09:14:47.195Z`。

---

## 抓取过程汇总（只写事实）

| # | 技能 | HTTP | 是否有 tags 字段 | tags 原文 | 「Where it fits」定位 |
| --- | --- | --- | --- | --- | --- |
| 1 | improve-codebase-architecture | 200 | 有 | `ship-solid-code`（非 phase 编号） | periodic maintenance，在主链之外，定期跑，产出「想法」再回主干 |
| 2 | diagnosing-bugs | 200 | **无** | 无 | reach-for-it-anytime standalone，进出自由、不留状态；上游是 triage，下游交 improve-codebase-architecture |
| 3 | resolving-merge-conflicts | 200 | **无** | 无 | reach-for-it-anytime standalone，不依赖任何其它技能，完全在 idea-to-ship 主干之外 |
| 4 | triage | 200 | **无** | 无 | on-ramp，不是主链的一步；是「外来活」的平行车道，在 `ready-for-agent` 处与主干汇合 |
| 5 | wizard | 200 | **无** | 无 | reach-for-it-anytime standalone，位于「自动化停止、人必须动手」的分界线上 |

5 页全部 200，没有 404、没有明显占位内容。5 页的 `updatedAt` 全部相同：`2026-08-24T09:14:47.195Z`。

（说明：以上「定位」一栏是对原文英文表述的中文转写，只有栏目内容是转写，原文摘录部分一律保留英文。）
