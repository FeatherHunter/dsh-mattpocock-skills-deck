# 网站详情页整理（第 2 批：implement / code-review / wayfinder / prototype / research）

来源：`https://www.aihero.dev/skills-<技能名>.md`，逐个用 `web_fetch` 抓取的 markdown 版本。

抓取顺序与写入方式：抓完一页立刻写一节，避免中途上下文不足导致整份文件为空。

---

## 1. implement — `https://www.aihero.dev/skills-implement.md`

抓取状态：HTTP 200，内容完整。

### 页面标题与 description 原文

- title: `The /implement Skill`
- description: `Build a finished spec into code, test-first.`

（另注：该页 YAML 还有 `slug: "skills-implement"`、`type: "post"`、`updatedAt: "2026-08-24T09:14:47.195Z"`。）

### tags 原文

**该页 YAML 里没有 `tags` 字段**，只有 title / slug / type / description / updatedAt。所以这一页拿不到 `phase-N` 之类的编号，如实记录，不猜。

### 「When to reach for it」要点

作者先强调「谁来触发」：这个技能必须由人自己敲 `/implement`，agent 不会自发调用，因为它带 `disable-model-invocation: true`，别的技能也不能调它。原文：

> You invoke this by typing `/implement` yourself: the agent won't reach for it on its own. It ships with `disable-model-invocation: true`, so no other skill can call it either. Wherever ask-matt or to-tickets says "then `/implement` per ticket", that is an instruction to you, not something the agent will do unprompted.

然后是「工作现在放在哪里决定该不该用它」的对照表，原文整表如下：

| The work is… | Reach for |
| --- | --- |
| A ticket on the tracker | `/implement #42`, one ticket per session, clearing context between tickets |
| A spec, not yet split up, and the build spans sessions | to-tickets first, then `/implement` per ticket |
| A spec, and the build is small | `/implement` directly against the spec |
| Only in the conversation you just had, and it's still small | `/implement` right there, in the same window |
| Not written down anywhere yet | grill-with-docs, or grill-me if there's no codebase |
| One concrete behaviour you want test-first, with no spec | tdd directly |
| Already built, and you want it checked | code-review directly |

作者特别点出「同一会话内」这个情形技能自己的正文没覆盖，原文：

> The same-session case is worth naming because the skill's own first line doesn't cover it. `SKILL.md` says "the spec or tickets", which nudges the model to go hunting for a file that doesn't exist. If the plan lives only in the thread, say so when you invoke it.

### 「Where it fits」这一节原文摘录（完整）

> `implement` is the build step of the main chain, second from the end:
>
> ```txt
> grill-with-docs → to-spec → to-tickets → implement → code-review
> ```
>
> Its neighbours are to-tickets, which produces the tickets it consumes and declares the blocking edges that decide their order; tdd, which it drives internally at each seam; and code-review, which it runs before committing. It sits downstream of the planning skills and trusts them. It does not re-validate the shape of what it was handed, so a badly-structured map or a horizontally-layered ticket gets built as written.
>
> That trust is why wayfinder merges onto the chain at to-spec rather than looping its map straight into `implement`. Go straight to `implement` from a map only when the effort turned out genuinely small.
>
> ask-matt is the router over the whole set when you are not sure which flow you are in.

**定位结论：`implement` 是主链上「第二位从后数」的一环（主链倒数第二步），是一条有严格顺序的路上的某一环，不是随时可用的独立件。**

### 这一页里出现的其它技能

- **tdd** — 推荐 + 内部依赖。`implement` 在每个 seam 上驱动 tdd；对照表里「One concrete behaviour you want test-first, with no spec」直接推荐 `tdd`。
- **code-review** — 推荐 + 内部依赖。`implement` 在提交前运行它；对照表里「Already built, and you want it checked」直接推荐 `code-review`。另在 Common questions 里说明两者冲突。
- **to-tickets** — 上游依赖。它产出 `implement` 消费的 ticket，并声明决定顺序的阻塞边；也是它配置的 tracker（经由 setup-matt-pocock-skills）。
- **to-spec** — 上游衔接点。wayfinder 在 `to-spec` 处并入主链。
- **grill-with-docs / grill-me** — 对照表里的上游推荐（「Not written down anywhere yet」时用它；没有代码库时用 grill-me）。
- **wayfinder** — 说明边界：wayfinder 在 `to-spec` 处并入主链，而不是把它的 map 直接喂进 `implement`。
- **ask-matt** — 路由作用：不确定自己在哪条 flow 时用它。
- **setup-matt-pocock-skills** — 说明前置配置：tracker 由它配置，`code-review` 读同一份配置去找源 spec。

### 页面里写明的顺序与衔接

- 主链顺序原文：`grill-with-docs → to-spec → to-tickets → implement → code-review`
- 顺序性原文：`A spec, not yet split up, and the build spans sessions` → `to-tickets first, then /implement per ticket`
- 一次运行的五拍（有明确先后）原文：
  > 1. Read the ticket or spec and work out the seams.
  > 2. Drive tdd at the pre-agreed seams, one red-green slice at a time.
  > 3. Typecheck often, run single test files as it goes.
  > 4. Run the full test suite once, at the end.
  > 5. Run code-review, then commit to the current branch.
- 跨会话原话（换会话 / 清上下文，**明确提到 clearing context 与 session**）：

  > A ticket on the tracker | `/implement #42`, one ticket per session, clearing context between tickets

  > One run covers one ticket. The tickets to-tickets produces are tracer-bullet vertical slices sized to fit a single fresh context window, so the intended rhythm is: clear context, implement one ticket, commit, clear again. Each ticket is self-contained, which is what makes the previous ticket's context disposable.

- 「做完 X 就去做 Y」式的上游衔接原话：

  > Wherever ask-matt or to-tickets says "then `/implement` per ticket", that is an instruction to you, not something the agent will do unprompted.

- 提到 **subagent** 的原话（明确否定了并行 fan-out）：

  > No. One invocation, one ticket. Batch dispatch across a ticket queue and subagent fan-out are both requested repeatedly, and neither exists. Running several `/implement` sessions side by side in one checkout is worse than unsupported: one field report describes a `git commit --amend` in one session landing on another session's commit, a stash vanishing from `refs/stash`, and commits landing on the wrong branch, all in a single afternoon across three issues. The sessions share one working directory, one index, and one HEAD. Git worktrees are the community workaround, and note that `refs/stash` is shared across worktrees too, so worktrees alone do not fix the stash case. If you want parallelism today, you are assembling it yourself.

- 本页**没有**提到 `/handoff`，**没有**提到 `/compact`，**没有**提到 `/clear` 这个命令名本身（只用了不带斜杠的 `clearing context` 与 `clear context` 说法）。

### 其它值得记的原文（前置条件与常见坑）

- 前置条件原文：
  > `implement` commits to the branch you are on. It does not create one, and it does not ask. Check you are on the branch you want the work on before you start.
- `implement` 把 seam 的约定甩给了上游，原文：
  > The word "pre-agreed" is doing real work, and it is also the skill's weakest joint. Nothing inside `implement` agrees the seams. `tdd` is the skill that asks, and it refuses to write a test at an unconfirmed seam. So in practice the agreement happens either upstream in the spec, or in the first exchange of the run. If it happens nowhere, the precondition never fires and the run quietly becomes "just write the code". Naming the seams in the spec is what stops that.
- 完成度边界原文：
  > Correct, and expected. `implement` has no completion step. It ends at the commit and never touches the work item, confirmed on GitHub Issues and on the local markdown tracker, so it is not a tracker integration problem. It also does not act on the findings `code-review` produced, and does not tick the `- [ ]` boxes on the originating issue. Close the ticket and reconcile the criteria yourself.
- 与 `code-review` 的已知不一致原文：
  > `code-review` reviews `git diff <fixed-point>...HEAD`, which excludes staged and working-tree changes. `implement` runs it before committing, so unless an interim commit already exists there is nothing in that diff to review. Multiple people have reported this and it is unfixed on both sides. Commit first, then review against the point you branched from.
- 另一条把 review 移到新会话的建议原文：
  > Separately, some people deliberately do not want the review inside the run at all, because an agent reviewing the code it just wrote is biased toward its own solution. Running code-review in a fresh session against a fixed point is a legitimate alternative, and is the same reason that skill runs its two axes in separate sub-agents.

### 抓不到或对不上的地方

- 该页 YAML **没有 `tags` 字段**，所以第 1 节拿不到 `phase-N` 编号。
- 「Where it fits」里插入了一个 ```txt 代码块，`web_fetch` 返回的文本里它作为缩进引用出现，链条内容我按原文照抄。

---

## 2. code-review — `https://www.aihero.dev/skills-code-review.md`

抓取状态：HTTP 200，内容完整。

### 页面标题与 description 原文

- title: `The /code-review Skill`
- description: `Review a diff against your standards and against the spec.`

（另注：该页 YAML 还有 `slug: "skills-code-review"`、`type: "post"`、`updatedAt: "2026-08-24T09:14:47.195Z"`。）

### tags 原文

**该页 YAML 里同样没有 `tags` 字段**。如实记录，不猜。

### 「When to reach for it」要点

触发方式原文：

> Type `/code-review`, or the agent reaches for it automatically when you ask to review a branch, a PR, work in progress, or anything "since X".

注意与 `implement` 的差别：这个技能 **agent 可以自己调用**，不限于人手动敲。

对照表原文：

| Your situation | Reach for |
| --- | --- |
| A diff exists and you want to know if it is built right *and* is the right thing | `code-review` |
| You want bugs hunted in the diff: null paths, races, off-by-one | Claude Code's own built-in review, not this one (see the name clash below) |
| Nothing is written yet and you want it written test-first | tdd |
| A whole spec needs building, review included | implement, which calls this skill itself |
| The whole codebase has drifted, not one diff | improve-codebase-architecture |
| Something is broken and you do not know why | diagnosing-bugs |

边界原文（不用它的情况）：

> You must supply the fixed point. If you do not, the skill asks for one rather than guessing; it then checks the ref resolves and the diff is non-empty before spawning anything, so a typo'd branch name fails in front of you instead of inside two sub-agents.

### 「Where it fits」这一节原文摘录（完整）

> `code-review` is the review step at the tail of the build chain: `grill-with-docs → to-spec → to-tickets → implement → code-review`. It also stands alone on any branch or PR you point it at.
>
> - implement is the closest neighbour: it drives the build and calls this skill as its own closing review before committing.
> - to-spec and to-tickets produce the document the Spec axis checks against; a vague spec makes that axis vague.
> - improve-codebase-architecture is the whole-codebase counterpart: this skill only ever looks at one diff.
>
> ask-matt routes across the whole set when you are unsure which skill the situation wants.

**定位结论：双重身份——既是主链尾端「有顺序的路上的最后一环」，也可以「stand alone on any branch or PR you point it at」（随时可用的独立件）。**

### 这一页里出现的其它技能

- **implement** — 上游/最紧邻居。原文：`it drives the build and calls this skill as its own closing review before committing`；对照表里「A whole spec needs building, review included」指向 implement。
- **to-spec / to-tickets** — 上游依赖。它们产出的文档就是 Spec 轴检查的依据；spec 模糊则这一轴也模糊。
- **improve-codebase-architecture** — 对比/边界。全代码库层面的对应物；本技能只看单个 diff。对照表里「The whole codebase has drifted, not one diff」指向它。
- **tdd** — 对照表推荐（「Nothing is written yet and you want it written test-first」）。
- **diagnosing-bugs** — 对照表推荐（「Something is broken and you do not know why」）。
- **setup-matt-pocock-skills** — 前置说明：Spec 轴第 1 步依赖它写出的 `docs/agents/issue-tracker.md`。
- **ask-matt** — 路由作用。
- **Claude Code 内置的 `/code-review`** — 不是本套技能，但是本页重点讨论的「同名冲突」对象，见下面「抓不到或对不上的地方」旁的原话。

### 页面里写明的顺序与衔接

- 主链顺序原文：`grill-with-docs → to-spec → to-tickets → implement → code-review`
- 「做完 X 再 Y」原文：

  > A whole spec needs building, review included | implement, which calls this skill itself

  > Commit first, then review, then amend or add a fixup.

- 跨会话 / 换会话相关原文（**明确提到 session 与 fresh session，但没有出现 `/handoff`、`/compact`、`/clear` 命令名**）：

  > Should I run it in the same session that wrote the code? — Prefer a fresh one. As one reader put it: "Same context reviewing itself isn't review, it's confirmation bias with a slash command." The reviewing agent in the authoring session holds every assumption that shaped the code, which is exactly the context an independent reviewer would not have. This is also why people ask for implement without its built-in review step: it runs the review inside the session that just wrote the diff. Invoking `/code-review` yourself from a clean session is the honest version.

  > After every ticket, or once at the end? — Both work, and the skill does not decide for you. Per-ticket keeps each diff small enough that the Spec axis has one clear spec to check against, which is the mode `implement` uses. Batching to the end of a branch catches interactions between tickets that the per-ticket passes each miss. If you are unsure, review per ticket and run one final pass against the branch point.

- 明说 **sub-agent**（子代理）的原文：

  > Each axis runs in its own sub-agent so neither sees the other's reasoning.

  > It then checks the ref resolves and the diff is non-empty before spawning anything, so a typo'd branch name fails in front of you instead of inside two sub-agents.

  > Can I trust the findings? — Not without checking. Sub-agent output is a hypothesis, not evidence: one team reported a dozen breaking changes that prose-based reviews had waved through.

- 子代理失控的已知问题原文（与跨会话/子代理用法直接相关）：

  > **Its sub-agents keep invoking `/code-review` again and spawn more agents.**
  >
  > Known open bug, reproduced by several people and in more than one harness. The Standards and Spec prompts do not forbid delegation, so a sub-agent can rediscover the skill and fan out again: one report reached 50-plus agents. The fix people have applied on forks is one line appended to both sub-agent briefs: "Do not invoke `/code-review` or spawn additional agents: perform this review directly."

### 其它值得记的原文

- 两条轴的核心设计（面板若按「用途」分组可能用得上）原文：

  > The two axes are never merged and never re-ranked. The report ends with a worst issue *per axis* and refuses to name a single winner across them, because a change can pass one axis and fail the other: code that follows every convention while implementing the wrong thing passes Standards and fails Spec; code that does exactly what the ticket asked while breaking the repo's conventions does the reverse.

- 两条轴对照表原文：

  | | Standards | Spec |
  | --- | --- | --- |
  | Question | Is it built right? | Is it the right thing? |
  | Reads | The repo's documented standards, plus the smell baseline | The originating issue or spec |
  | Reports | Documented breaches (can be hard), and smells (always judgement calls) | Missing or partial requirements, scope creep, requirements implemented wrongly |
  | Every finding cites | The standards file and the rule, or the named smell plus the hunk | The line of the spec |

- Spec 轴的查找顺序原文：

  > 1. Issue references in the commit messages (`#123`, `Closes #45`, a GitLab `!67`), fetched through `docs/agents/issue-tracker.md`.
  > 2. A path you pass in as an argument.
  > 3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch or feature name.
  > 4. Asking you.

- 收敛性警告原文：

  > Why does it find new problems every single time I run it? — Because fixes create new surface, and because the judgement-call half of the Standards axis is not deterministic between runs. … There is no convergence guarantee. Treat a pass as a list of leads, act on the ones with a cited rule behind them, and stop: do not run it in a loop until it comes back clean, because it will not.

### 抓不到或对不上的地方

- 该页 YAML **没有 `tags` 字段**（与第 1 节相同情况）。
- 本页出现了一个**与本地技能文件说法可能不一致的关键点**：本页明确警告「`code-review` 这个名字与 Claude Code 自带的 `/code-review` 冲突」，且以插件市场方式安装时本地技能会被加 `mattpocock-skills:` 前缀。这属于网站侧的安装说明，本地 `SKILL.md` 是否提到，我未核对（本轮不允许读本地技能文件）。原文：

  > This is the most reported problem with the skill, and it is not fixed. Claude Code ships its own `/code-review`, which does something different: it hunts bugs in the diff, where this one checks spec compliance and repo standards. Installing this library means one of them wins, and which one wins depends on how you installed. Via the plugin marketplace, everything is aliased under a `mattpocock-skills:` prefix and the built-in becomes hard to reach at the unqualified name; via a plain skills install, the local file wins and this skill shadows the built-in.

- `code-review` 与 `implement` 之间的**已知未修复缺陷**（`implement` 在提交前调用 review，但 review 看的是 `<fixed-point>...HEAD`，此时没有提交可看）。原文：

  > Does it review my uncommitted work? — No. It diffs `<fixed-point>...HEAD`, three-dot, which is measured from the merge-base and excludes staged and working-tree changes. If `implement` has not made an interim commit, the work about to be committed is invisible to the review. Commit first, then review, then amend or add a fixup.

---

## 3. wayfinder — `https://www.aihero.dev/skills-wayfinder.md`

抓取状态：HTTP 200，内容完整。

### 页面标题与 description 原文

- title: `The /wayfinder Skill`
- description: `Chart a large effort as a map of decisions, and settle them.`

（另注：该页 YAML 还有 `slug: "skills-wayfinder"`、`type: "post"`、`updatedAt: "2026-08-24T09:14:47.195Z"`。）

### tags 原文

**该页 YAML 里同样没有 `tags` 字段**。如实记录，不猜。

### 「When to reach for it」要点

触发方式与适用边界原文：

> You invoke this by typing `/wayfinder`; the agent won't reach for it on its own.
>
> It is the heaviest, densest flow in the set, so the trigger is narrow: the effort has to be genuinely larger than one agent session can hold, and the route to the destination has to be foggy. The split is a clean one: `/grill-with-docs` for single-session planning, `/wayfinder` for multi-session planning.

对照表原文：

| What you have in front of you | What to run |
| --- | --- |
| A well-scoped feature you can settle in one sitting | grill-me, or grill-with-docs when there is a codebase |
| A greenfield project, or a build spanning many sessions, with the route still unclear | `/wayfinder` |
| A thread where the deciding is already done | to-spec: skip straight past the map |
| A cleared wayfinder map | to-spec, then to-tickets and implement |
| An existing session that has already grown too big | say "hand off to `/wayfinder`" (handoff bridges into a map as well as out of one) |

「不该用」的边界原文：

> Greenfield is not a requirement. Wayfinder is used routinely on legacy and half-built codebases, and it is arguably sharper there, because a lot of the fog is "what is already true here" rather than "what should we do".

> Session count, not project size. `/grill-with-docs` is single-session planning; wayfinder is multi-session planning. If you can hold the whole thing in one conversation, grilling is the cheaper and better tool, and wayfinder is genuinely slower and denser for that case. The community shorthand that has settled on it: wayfinder only makes sense if the work doesn't fit into a single session.

### 「Where it fits」这一节原文摘录（完整）

> `wayfinder` is a **situational on-ramp**, not the default front door. The grill-led idea → ship chain is still where most work starts; wayfinder is what you climb onto when the idea is too big to hold in one session, and it merges back onto that chain at to-spec, because a cleared map hands off rather than builds.
>
> Underneath, it is mostly other skills wearing wayfinder's scheduling: grilling and domain-modeling resolve the default ticket type, prototype resolves the tickets that talking cannot, and research runs as a subagent so its reading never lands in your session. handoff is the bridge in and out: into a map from a conversation that outgrew itself, out of one when a side quest appears mid-session. For anything else, ask-matt routes over the whole set.

**定位结论：`wayfinder` 是「situational on-ramp（特定情形才上的入口）」，不是默认入口。它是一条有顺序的路上的「中途并入点」——在 `to-spec` 处并回主链，而不是自己走到底。它与 `prototype`、`research` 不是并列关系：后两者是 wayfinder 用来「解决某类 ticket」的底层技能（wayfinder 是调度方、上层）。**

### 这一页里出现的其它技能（注意：本页是 5 页里出现其它技能最多的一页）

- **to-spec** — 上游并入点 + 下游衔接。原文：`it merges back onto that chain at to-spec, because a cleared map hands off rather than builds`；对照表 `A cleared wayfinder map | to-spec, then to-tickets and implement`；也用于 `/to-spec #<map_issue>`。
- **to-tickets** — 下游衔接，把 spec 切成 tracer-bullet 实现票。
- **implement** — 下游（但**不是**直接下游）。原文：`Looping the map straight into implement skips the collapse and throws the linked detail away. Go straight to implementation only when the effort turned out genuinely small.`
- **grill-with-docs / grill-me** — 对比 + 分流边界。单会话规划用它俩，多会话规划才用 wayfinder；有代码库时用 grill-with-docs。
- **grilling** — 内部组成：解决默认票型（`grilling` 票）。
- **domain-modeling** — 内部组成，与 grilling 一起解决默认票型。
- **prototype** — 内部组成（**上下级关系**）。原文：`prototype resolves the tickets that talking cannot`，即 wayfinder 的 `prototype` 类型 ticket 由 `prototype` 技能来解。另外在「瀑布陷阱」段落里以词典链接形式出现：
  > And [prototype](https://www.aihero.dev/ai-coding-dictionary/prototyping) aggressively: the whole reason the route stays current is that uncertainty is flushed out by cheap concrete artifacts before implementation depends on it. Wayfinder is "prototypemaxxing", not "planmaxxing".
- **research** — 内部组成（**上下级关系，且明确以 subagent 形式运行**）。原文：`research runs as a subagent so its reading never lands in your session`。
- **handoff** — 跨会话桥梁（桥进也桥出）。原文：`handoff is the bridge in and out: into a map from a conversation that outgrew itself, out of one when a side quest appears mid-session`。
- **ask-matt** — 路由作用。
- **setup-matt-pocock-skills** — 前置条件：由它铺好 tracker 接线（写 "Wayfinding operations" 一节）。
- **已废弃名 `decision-mapping`** — 说明沿革：`It is this skill, renamed to wayfinder in v1.1 and invoked as /wayfinder.`

### 四种决策票型（本页核心结构，含 `prototype` 与 `research` 的确切位置）

原文表格整表照抄：

| Type | Mode | Reach for it when | Resolved by |
| --- | --- | --- | --- |
| `grilling` | HITL | The default. The question can be settled by talking it through. | grilling plus domain-modeling, in a fresh session |
| `prototype` | HITL | "How should this look" or "how should this behave": a question talking cannot settle. | prototype, with the built artifact linked from the ticket as an asset |
| `research` | AFK | A fact outside the working directory is blocking a decision. | A research subagent, fired at charting time and burned down in parallel on a `research/<name>` branch |
| `task` | Either | Nothing to decide, but manual work blocks a decision, such as provisioning access, signing up for a service, or moving data so its shape can be seen. | The agent alone where it can, or a precise checklist for the human |

补充原文：

> `task` is the only type that *does* rather than decides, and it earns its place by unblocking a decision, never by delivering a piece of the destination. This is the type that goes wrong most often in practice: agents interpret it as an implementation step and start writing product code inside the map.
>
> Research is the only exception to *one ticket per session*.

**关于「prototype / research 与 wayfinder 是并列还是上下级」的直接结论（据本页）：上下级。** `prototype` 和 `research` 都是 **wayfinder 的票型**，由 wayfinder 调度、在需要时被调用去解票；它们不是与 wayfinder 平行的入口。而且 `research` 明确以 **subagent + 独立分支 `research/<name>`** 的方式并行跑（这是本页唯一一处「一张票可以跨并行会话」的例外）。

### 页面里写明的顺序与衔接（逐句摘）

- 主链并回点原文：

  > A cleared wayfinder map | to-spec, then to-tickets and implement

  > Wayfinder's tickets are decision tickets, and by the time the map closes they are all closed too. What is left is a map full of linked decisions, which is not a build plan. to-spec collapses those linked decisions into one spec (`/to-spec #<map_issue>`) and to-tickets slices that into tracer-bullet implementation tickets. Looping the map straight into implement skips the collapse and throws the linked detail away. Go straight to implementation only when the effort turned out genuinely small. People do run the abbreviated pipeline and report it working; the two extra steps buy you an explicit spec artifact that a reviewer or a colleague can read, which matters more the less solo you are.

- 「做完 X 就去做 Y」原文：

  > Resolving a ticket clears the fog ahead of it and graduates whatever is now specifiable into fresh tickets.

  > When the map clears, wayfinder hands off; it does not carry on into code.

  > A session resolves one ticket, posts the answer as a resolution comment, closes it, and leaves one line on the map's *Decisions so far*. Then it stops.

  > The session that finishes the map hands you toward a spec, not a pull request.

- 跨会话原话（**本页是全组里跨会话说明最密集的一页**）：

  > A session claims a ticket by assigning it to itself before doing any work, so the assignee *is* the claim and concurrent sessions skip it.

  > grilling | HITL | The default. … | grilling plus domain-modeling, in a fresh session

  > research | AFK | A fact outside the working directory is blocking a decision. | A research subagent, fired at charting time and burned down in parallel on a `research/<name>` branch

  > Can the destination mean the end of this session or the end of everything? — The whole map. That means the destination of the entire map, not just the initial session. The question reads ambiguously because wayfinder is by definition a multi-session tool, so a session-scoped answer never makes sense.

  > My agent started writing production code in the middle of a wayfinder session. … keep implementation in its own sessions …

  > Can I work several tickets in parallel? — The frontier is built to show you what is takeable, and blocking edges are there so parallel work is safe on paper. In practice one-at-a-time is the safer default. Users working two grilling tickets at once get asked in one session a question they just answered in the other, because the sessions share no context.

  > one user watched an agent write "this map carries execution" into its own Notes and then read it back in later sessions as its own licence, building on a live server.

  > An existing session that has already grown too big | say "hand off to `/wayfinder`" (handoff bridges into a map as well as out of one)

- **明确提到 `/handoff` 技能**（本组 5 页里，`handoff` 只在 wayfinder 这一页被明确写成「桥」）：见上面 `When to reach for it` 对照表末行与 `Where it fits` 里的 `handoff is the bridge in and out`。
- 本页 **没有**出现 `/compact`、`/clear` 这两个命令名；跨会话只用了 session / fresh session / hand off / handoff 的说法。
- **提到 subagent 的原文**：

  > research runs as a subagent so its reading never lands in your session.

  > research | AFK | … | A research subagent, fired at charting time and burned down in parallel on a `research/<name>` branch

### 其它值得记的原文（面板做「分组」时可能用到的结构词）

- 地图四要素原文：

  > Four things live on it:
  >
  > - **Destination**: what reaching the end of this map looks like. Naming it is the first act of charting, before any ticket exists, because the destination fixes the scope every ticket is measured against.
  > - **Decisions so far**: one line per closed ticket, each linking to where the detail actually lives.
  > - **Not yet specified**: the **fog of war**. Decisions you can tell are coming but cannot yet phrase sharply. The test for fog versus ticket is whether you can state the question precisely *now*, not whether you can answer it. Resolving a ticket clears the fog ahead of it and graduates whatever is now specifiable into fresh tickets.
  > - **Out of scope**: work ruled beyond the destination. Fog only ever gathers *toward* the destination, so out-of-scope work is closed and never graduates.

- 地图是索引不是仓库的原文：

  > It is an **index, not a store**: a decision lives in exactly one place, its ticket, and the map only gists it and links. A session loads the map at low resolution and zooms into individual tickets on demand, which is what lets a map keep growing without every session paying for its whole history.

- 定位一句话原话（很适合面板分组标题参考）：

  > `wayfinder` is a **situational on-ramp**, not the default front door.

- 与 `prototype` 有关的一句口号原文：

  > Wayfinder is "prototypemaxxing", not "planmaxxing".

### 抓不到或对不上的地方

- 该页 YAML **没有 `tags` 字段**。
- 本页在 `prototype` 出现处混用了两个不同链接目标：票型表格里链到 `https://aihero.dev/skills-prototype`（技能页），而「prototype aggressively」那句里链到 `https://www.aihero.dev/ai-coding-dictionary/prototyping`（词典页）。两者指的是同一件事，但链接类型不同，如实记录。
- 本页与「本地技能文件」的潜在对不上点（**我未核对本地文件，本轮不允许**）：本页明确说 `prototype` 与 `research` 是 wayfinder 的票型（即被 wayfinder 调度的下层技能），并说 `handoff` 是进出地图的桥。若本地 `SKILL.md` 把三者写成平级，需要人工核。

---

## 4. prototype — `https://www.aihero.dev/skills-prototype.md`

抓取状态：HTTP 200，内容完整。

### 页面标题与 description 原文

- title: `The /prototype Skill`
- description: `Answer a design question with code you then delete.`

### tags 原文（照抄，不翻译）

```yaml
tags:
  - phase-3
  - build-the-right-thing
```

注意：本页**有** `tags`，且第一项是 `phase-3`。这是本批 5 页里**唯一**带 tags 的页面（其余 4 页 YAML 里都没有 `tags` 字段）。

### 「When to reach for it」要点

触发方式原文：

> Type `/prototype`, or the agent reaches for it automatically when a task fits.

适用原文：

> Reach for it the moment you hit a question you can't settle by talking: a state machine whose edge cases you can't hold in your head, a screen you can't picture until you see three versions side by side. Grilling sessions balloon on exactly these questions: the agent rephrases, you guess, and the scope grows to fill the uncertainty. Stop grilling, build the throwaway version, look at it, then answer in one line.

不该用的原文（边界一：诊断类问题不走这里）：

> If instead something already built is misbehaving and you want to know why, use diagnosing-bugs; prototyping explores what to build, not why the built thing is broken.

不该用的原文（边界二：设计已定就别再 prototype）：

> An agent told me to `/prototype` when I should have been implementing. — Known, and it is a naming problem. `prototype` is a generic, appealing word that reads to a flow-unaware agent as "the obvious next step" once tickets exist, so it gets recommended by name even where the design was fully settled in conversation. If you already know what to build, the next step is `/implement`, per ticket. Reach for a prototype only when a specific design question is genuinely unresolved and talking won't resolve it.

不该用的原文（边界三：不是全应用原型）:

> That is a different artifact wearing this skill's name. A prototype here is scoped to one question, and "what is the whole app?" isn't one. A full-app prototype has no natural stopping point, so it becomes the production app by momentum: the cleanup pass never happens, and code written under prototype rules (no tests, no error handling) ends up in front of users.

「你也会被动来到这里」原文（与 wayfinder 的关系）：

> You will also arrive here without choosing to. wayfinder files `prototype` decision tickets on its map, and working one is this skill.

### 「Where it fits」这一节原文摘录（完整）

> `prototype` is a **reach-for-it-anytime standalone**: you drop into it to settle one design question, then drop back out, and it is also machinery another skill runs on.
>
> Its largest consumer is wayfinder. A wayfinder map is made of **decision tickets**, and `prototype` is one of the four types a ticket can be: the one used when the blocking question is "how should this look" or "how should it behave", which no amount of discussion resolves. Wayfinder raises the fidelity of a foggy discussion by making something concrete to react to, and this skill is how that concrete thing gets built. A prototype ticket is resolved by the answer, and the prototype is linked from the map as an asset.
>
> The other neighbours are upstream and downstream of that. grill-me and grill-with-docs answer grillable questions; the ungrillable ones come here instead, and the one-line answer goes back into the interview. Downstream, a validated state model or UI direction becomes settled input for to-spec, which can inline the decision-rich snippet the prototype produced rather than describing it in prose. For anything else, ask-matt routes you over the whole set.

**定位结论（这就是负责人最关心的那条）：两句话合起来说——`prototype` 本身是「reach-for-it-anytime standalone（随时可用的独立件）」，但它同时是「machinery another skill runs on（另一个技能跑在上面的机器）」，是 **wayfinder 四种决策票型之一**。所以它与 wayfinder **不是并列关系**：它既可以被单独使用，也是 wayfinder 的下层被调件（wayfinder 是调度方）。**

### 这一页里出现的其它技能

- **wayfinder** — 上下级关系（本页写得最明确）：`Its largest consumer is wayfinder`；`prototype is one of the four types a ticket can be`；`Wayfinder raises the fidelity of a foggy discussion by making something concrete to react to, and this skill is how that concrete thing gets built`。
- **diagnosing-bugs** — 说明边界：已经建好的东西出毛病要查原因时用它，不要用 prototype。
- **grill-me / grill-with-docs** — 上游分流。原文：`grill-me and grill-with-docs answer grillable questions; the ungrillable ones come here instead, and the one-line answer goes back into the interview`。
- **to-spec** — 下游衔接受益方。原文：`Downstream, a validated state model or UI direction becomes settled input for to-spec, which can inline the decision-rich snippet the prototype produced rather than describing it in prose`。
- **implement** — 对比说明（在「agent 叫错技能」那条里）：设计已定时的正确下一步是 `/implement`，per ticket。
- **handoff** — 跨会话桥梁（本页明确点名）。见下。
- **ask-matt** — 路由作用。

### 页面里写明的顺序与衔接

- 「做完 X 就去做 Y」/「X 之前先做 Z」原文：

  > Stop grilling, build the throwaway version, look at it, then answer in one line.

  > If you already know what to build, the next step is `/implement`, per ticket.

  > Downstream, a validated state model or UI direction becomes settled input for to-spec …

  > The **answer** (the verdict plus the question it settled) is captured durably: a commit message, an ADR, the implementation issue.

- 跨会话 / 换会话原文（**本页明确点名 `/handoff`**）：

  > **How do I run it in its own session?**
  >
  > A prototype lives in its own directory and generates a lot of context you don't want in the thread that asked the question, so run it somewhere else and bring back only the answer. handoff is the bridge in both directions.

  > The sharpest objection to that was never about speed: it was *who picks up the work next session, and what do they have to work from?* A prose summary of a prototype loses the thing that made it convincing.

- 原型成果**跨会话保留**的原文（这对「跨会话」这条线很重要：原型不删，放 `prototype/<name>` 分支，主分支不留）：

  > The **prototype** is the runnable evidence the answer came from, and it is not deleted. It doesn't belong in main either: there is nothing there to maintain and it rots fast. So it is committed to a throwaway `prototype/<name>` branch out of main, never merged, with a context pointer to that branch left on the implementation issue. Main stays clean; the exploration stays findable and re-runnable by whoever picks the work up next.

- **提到 subagent / 子代理**：本页 **没有**出现 subagent 字样（提到的是其它技能被 wayfinder 当票型调用）。
- **`/compact`、`/clear`**：本页 **没有**出现。

### 其它值得记的原文

- Throwaway 的准确定义（容易被误解，照抄）：

  > Throwaway is a constraint on how the code is *written*, not a promise to destroy it. No tests, no error handling beyond what makes it run, no abstractions, no persistence, because none of that helps you learn the one thing you're trying to learn. What survives is the answer, folded into the real code, and the prototype itself, parked on a branch out of main as the evidence the answer came from.

- 两条分支原文（面板若要按形态分组可能用得上）：

  > The question picks the branch, and the branches produce very different artifacts:
  >
  > - **"Does this logic / state model feel right?"**: a **single shareable HTML file**. One self-contained page, no build and no server, that someone opens by double-clicking. … The logic behind the page is a small pure module (a reducer, a machine, a set of functions) kept clean of the DOM so the validated version lifts straight into the real code.
  > - **"What should this look like?"**: several **radically different** UI variations on one route, switchable from a floating bottom bar and a `?variant=` URL param. Variants must disagree about structure, not colour; three tweaked card grids is wallpaper, not a prototype. …

- 停止 prototype 的信号原文：

  > The moment you find yourself hardening one (adding a test, wiring the real database, generalising for a case you might want later), you have stopped prototyping.

### 抓不到或对不上的地方

- 本页 **tags 有，但只有两项**：`phase-3` 与 `build-the-right-thing`。本批其它页（implement / code-review / wayfinder / research）都没有 tags，所以「编号可能是作者心里的先后顺序」这条线索在本批只有 `phase-3` 一个数据点，无法从这 5 页交叉验证。
- 页面 description 说 `code you then delete`，但正文明确说**现在不删了**（`Wait, isn't the prototype supposed to be deleted? — Not any more.`）。这是**同一页内部的 description 与正文不一致**，如实记录，不猜作者意图。原文：

  > **Wait, isn't the prototype supposed to be deleted?**
  >
  > Not any more. It used to be: build it, keep the answer, bin the code. … So the prototype is now treated as a primary source: it lands on a `prototype/<name>` branch out of main and the implementation issue points at it. What changed is where the code lives, not the discipline; it still never merges into main.

---

## 5. research — `https://www.aihero.dev/skills-research.md`

抓取状态：HTTP 200，内容完整。

### 页面标题与 description 原文

- title: `The /research Skill`
- description: `Get a cited answer, read from primary sources.`

### tags 原文

**该页 YAML 里没有 `tags` 字段**，只有 title / slug / type / description / updatedAt。如实记录，不猜。

### 「When to reach for it」要点

触发方式原文：

> Type `/research`, or the agent reaches for it automatically when a task turns into reading legwork.

适用条件原文：

> Reach for it when the next step is *finding something out* from outside the working directory (how a third-party API behaves, what a spec actually says, whether a version claim holds), and you'd rather not stall your own thread doing the reading.

分流对照表原文（区分 research 与它的邻居）：

| What you need | Reach for |
| --- | --- |
| An external fact a decision is waiting on | `research` |
| A decision made *with* you, by interview | grilling |
| A durable architecture decision, written into `CONTEXT.md` and ADRs | grill-with-docs |
| To find out whether an approach works in your codebase | prototype |
| A plan too big to hold in one session | wayfinder |

分流判据原文（**很重要：research 与 grilling 的界线是「产出物的保质期」**）：

> The line between `research` and `grill-with-docs` is the **shelf life of what comes back**. Research produces short-lived assets: what this library's auth mechanism does as of this week. An ADR records a decision you keep. If what you are producing is a decision rather than a fact, you are grilling, not researching.

不该用的原文（小问题就别用它）：

> Why not just ask the agent to go read the docs? — You can, and a two-line prompt saying exactly that was the practice this skill replaced. … If a two-line prompt gets you what you need on a small question, use the two-line prompt.

范围没定就别用它原文：

> When does it stop reading? — There is no stopping criterion in the skill … Scoping is on you. A narrow, answerable question (one API, one behaviour, one version claim) comes back far better than "research X".

### 「Where it fits」这一节原文摘录（完整）

> A reach-for-it-anytime standalone that feeds the thinking skills rather than sitting in the build chain. Its file is something to take *into* the flow: grilling and grill-with-docs ask sharper questions when the facts are already on the table, and to-spec can synthesise against it. wayfinder is the one skill that invokes it directly, resolving each research ticket on its map with a `/research` subagent. For the whole map, see ask-matt.

**定位结论：`research` 是「reach-for-it-anytime standalone（随时可用的独立件）」，**不在**构建链上，而是「喂给思考类技能」的旁路件。同时它**也是** wayfinder 的下层被调件——`wayfinder is the one skill that invokes it directly`。所以与 wayfinder **不是并列**，是上下级（被 wayfinder 直接调用）。**

### 这一页里出现的其它技能

- **wayfinder** — 上下级关系（明确）。原文：`wayfinder is the one skill that invokes it directly, resolving each research ticket on its map with a /research subagent`；对照表里「A plan too big to hold in one session」指向 wayfinder。
- **grilling / grill-with-docs** — 分流对比（decision vs fact、保质期长短）。原文见上面分流判据；另 `grilling and grill-with-docs ask sharper questions when the facts are already on the table`。
- **prototype** — 分流对比。原文：`To find out whether an approach works in your codebase | prototype`。
- **to-spec** — 下游消费者。原文：`to-spec can synthesise against it`。
- **ask-matt** — 路由作用。

### 页面里写明的顺序与衔接

- 「做完 X 就去做 Y」原文：

  > In practice the file earns its keep by being fed into the next step deliberately: attach it to a spec, quote it into a grilling session, point a ticket at it.

  > Its file is something to take *into* the flow: grilling and grill-with-docs ask sharper questions when the facts are already on the table, and to-spec can synthesise against it.

- 跨会话相关原文（**明确否定了「后续会话自动复用之前的研究成果」**，是跨会话这条线上的负面结论）：

  > **Does a later session reuse what an earlier run found?**
  >
  > No. Nothing auto-loads a past research file; it is a document sitting in the repo until a human or a skill points at it. This was raised early as the strongest challenge to the design: "the value's the markdown becoming context the agent re-reads later, not the fetch itself. A write-once dead file is just a fancy search." The shipped skill does not solve it. In practice the file earns its keep by being fed into the next step deliberately: attach it to a spec, quote it into a grilling session, point a ticket at it.

  > The output is a file, written where the repo already keeps such notes, with a link on each claim. That is the point: a document you can react to, hand to another agent, or throw away, rather than an answer that vanishes when the session ends.

- **明确提到 subagent / 子代理的原文**（跨会话 + 子代理双线都命中）：

  > The defining move is that the reading runs as a **background agent**. You keep working; it goes off, follows each claim to its primary source, writes one Markdown file, and reports back. Research is legwork you delegate, not thinking you outsource: you get a document to grill, plan, or design against, and you still make the call.
  >
  > The delegation is unguarded, and the background agent can spawn a further background agent of its own. This is the skill's best-documented rough edge.

  > wayfinder is the one skill that invokes it directly, resolving each research ticket on its map with a `/research` subagent.

  > `/wayfinder` created research tickets. Do I resolve those myself? — No, it now fires them for you. In the unreleased changes since v1.1, a charting session spawns a `/research` subagent per research ticket and burns them down in parallel, capturing findings on a throwaway `research/<name>` branch with a context pointer from the ticket. Research tickets are the one exception to wayfinder's one-ticket-per-session rule, because they are AFK: nothing waits on you.

- 跨会话相关的已知缺陷原文（分支删除会打断 context pointer）：

  > Two known snags with those branches: the subagent has been seen opening a draft PR from a branch that is never meant to merge (issue #576), and deleting the branch later breaks the context pointers the tickets hold.

- **`/handoff`、`/compact`、`/clear`**：本页 **都没有**出现。
- 子代理嵌套（自我递归）的已知 bug 原文（提到了具体 issue 号 #530，且提到其它 harness）：

  > It spawned a second research agent. Is that meant to happen? — No. This is an open bug, issue #530. The skill tells its caller to spin up a background agent but does not restrict the agent type, so the agent it spawns is a `general-purpose` one that holds the `Agent` tool and the same instructions, and fires them again. One reporter measured a single research task costing roughly 450k tokens across three overlapping runs, with the duplicate finishing half an hour later entirely out of view. It reproduces outside Claude Code too; the same nesting was confirmed in Codex with GPT-5.6-sol. There is no shipped fix. …

  > The opposite failure exists as well: if your own global instructions forbid an agent from re-delegating work, the background agent will politely decline the task and the skill quietly does nothing.

### 其它值得记的原文

- 输出形态原文：

  > It does not answer you in the conversation. The output is a file, written where the repo already keeps such notes, with a link on each claim.

- 主源纪律原文：

  > It works only from **primary sources**: official docs, source code, specs, first-party APIs. It follows every claim back to the source that owns it, so it will not repeat a blog post's account of an API when the API's own docs are reachable.

- 「没人把关主源」的已知争议原文：

  > What counts as a "high-trust" primary source, and who decides? — The model does. The skill names the *kinds* of source that qualify (official docs, source code, specs, first-party APIs), and there is no allowlist, no domain gate, and no verification pass. …

- 研究文件该不该留在仓库的社区共识原文：

  > The skill puts the file where the repo already keeps notes and does not have an opinion beyond that. The community one is fairly settled: ADRs are kept, research files are not. The sharpest version of it, from a Discord thread on exactly this question: "ADRs yes. Everything else archive or delete after done. It otherwise becomes cruft of work and can poison future repo reads if you've drifted away from the spec/research." A research file records what was true on the day it was written, so a stale one is worse than none.

### 抓不到或对不上的地方

- 该页 YAML **没有 `tags` 字段**。
- **与 wayfinder 页的交叉不一致（重要）**：`wayfinder` 页把「研究票由 research subagent 在 charting 时并行烧掉、放 `research/<name>` 分支」当作**当前状态**陈述；而 `research` 页明确说这是 **unreleased changes since v1.1（尚未发布的改动）**。两页原话分别见第 3 节与本节对应引用。这是网站自身两页之间的口径差，如实记录，不猜哪个是对。**另外补一点**：`research` 页说「research tickets 是 wayfinder 一条票一会的唯一例外，因为是 AFK」，与 `wayfinder` 页里 `Research is the only exception to *one ticket per session*.` 一致，这一条**不冲突**。
- 本页 `research` 页把 `prototype` 列为「找外部事实」的分流对照项（`To find out whether an approach works in your codebase | prototype`），与 `prototype` 页自身「prototyping explores what to build, not why the built thing is broken」不冲突，但两页对 `prototype` 用途的表述角度不同（一页说「验证某个做法在你的代码库里行不行」，另一页说「回答问题/看长什么样」），如实并列记录。

---

## 附：本批 5 页的 tags 汇总（照抄）

| 页面 | YAML 是否有 tags | tags 原文 |
| --- | --- | --- |
| implement | 无 | —（YAML 无此字段） |
| code-review | 无 | —（YAML 无此字段） |
| wayfinder | 无 | —（YAML 无此字段） |
| prototype | 有 | `phase-3`, `build-the-right-thing` |
| research | 无 | —（YAML 无此字段） |



