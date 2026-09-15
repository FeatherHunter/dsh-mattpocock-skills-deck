# 票 #642：网站详情页工作流整理（第 4 批，5 个技能）

本文只整理作者 Matt Pocock 网站上这 5 个技能详情页（markdown 版）里的工作流信息，供「按工作流分组的悬浮面板」参考。

抓取地址（规律：`https://www.aihero.dev/skills-<技能名>.md`）：

1. https://www.aihero.dev/skills-grill-me.md
2. https://www.aihero.dev/skills-handoff.md
3. https://www.aihero.dev/skills-to-questionnaire.md
4. https://www.aihero.dev/skills-teach.md
5. https://www.aihero.dev/skills-wait-what.md

说明：本文的摘录与说明用中文写，凡是引用作者原话一律保留英文原文。

---

## 1. grill-me

### 页面标题与 description 原文

- `title`: "The /grill-me Skill"
- `description`: "Align on an idea before committing to it."

（页面正文里的技能名写作 `/grill-me`，带斜杠。）

### tags 原文

```yaml
tags:
  - get-better-results
  - phase-1
```

### 「Where it fits」原文摘录

整节原文如下：

> `grill-me` is a **standalone you can run anywhere, on anything**. Being stateless is what makes it portable: no repo, no workspace, no setup, and no assumption that the idea is even about software. People point it at business decisions, at writing, at what to do next: anything that won't sit still in their head.
>
> That portability is the whole difference from [grill-with-docs](https://aihero.dev/skills-grill-with-docs), which runs the same interview but reads a codebase to align against and records what it learns as `CONTEXT.md` and ADRs. Both sit on the [grilling](https://aihero.dev/skills-grilling) primitive; `grill-me` is the user-invoked front door that carries nothing with it.
>
> If what you grilled does turn out to be software, you can hand the same conversation to [to-spec](https://aihero.dev/skills-to-spec) and carry on into the build flow (an option, not the point of the skill). When you're unsure which flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位结论：**这是一个「随时可用的独立件」，不是一条有顺序的路上的某一环。** 作者用 "standalone you can run anywhere, on anything" 明确说了这一点；它能接进建流程，但作者注明那是 "an option, not the point of the skill"（可选项，不是这个技能的本意）。

### 「When to reach for it」要点

这一节比通常的「什么时候用」更长，除了时机还写了怎么选、以及要避免的用法。

该用的情况：

- 只要有一个「值得认真对待的想法」（a feature, a product direction, a business call, a piece of writing）就该用它，**远在你搞清楚这件事涉及什么之前**。
- 原文："Vagueness is not a reason to wait; it is the thing the session eats."（含糊不是等待的理由，含糊正是这场会话要吃掉的東西。）
- 必须由人主动输入 `/grill-me` 触发：原文 "You invoke this by typing `/grill-me`; the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) won't reach for it on its own."
- 要在**新会话**里启动：原文 "Start it in a **fresh conversation**, not on top of a plan you already had an agent write."

不该用 / 不要这样做：

- 已经能精确说清楚这件事，就不需要再 grill：原文 "If you can already specify the thing precisely, you don't need to grill it."
- 不要开 plan mode：原文 "Leave [plan mode](https://www.aihero.dev/ai-coding-dictionary/agent-mode) off. Plan mode primes the agent to rush toward producing a plan, which is the opposite of staying in inquiry."
- 遇到「不可 grill 的问题」（需要看到东西才能反应的问题）就停下，别硬聊：原文把 `"One long form or three pages?"` 和 `"how should this interaction feel?"` 列为 **ungrillable**，并说 "When you hit one, stop grilling. Build the throwaway version with [prototype](https://aihero.dev/skills-prototype), look at it, then come back and answer in one line." 还警告："Talking your way through an ungrillable question is where sessions balloon."
- 反向的错误（较少见但真实）：一直待在访谈里，永远到不了代码：原文 "The opposite error is real but rarer: staying in the interview so long you never reach code."

三种 grilling 技能怎么选（原文）：

> Which of the three grilling skills you want depends on what is in front of you:
>
> - **Anything, anywhere**: `grill-me`. It needs no repo and writes no files, and the subject doesn't have to be code.
> - **A codebase to align against**: [grill-with-docs](https://aihero.dev/skills-grill-with-docs). The same interview, but [stateful](https://www.aihero.dev/ai-coding-dictionary/stateful): it reads your code and keeps what it learns in `CONTEXT.md` and ADRs.
> - **Too big for one session**: [wayfinder](https://aihero.dev/skills-wayfinder). It charts the effort as a map and runs grilling sessions inside it.

补充：「What it does」一节说它按 **rounds** 提问，每轮是整个 **frontier**（所有前置问题已解决的问题）；且它是 **[stateless](https://www.aihero.dev/ai-coding-dictionary/stateless)**："It writes no files and leaves no workspace behind. The only thing it leaves is a sharper version of the idea, in your own head."

### 这一页里出现的其它技能

| 技能 | 出现情境 |
| --- | --- |
| `grill-with-docs` | 对比 / 说明边界：同样一场访谈，但它 stateful，读代码库，把学到的记进 `CONTEXT.md` 和 ADR。作者用它来解释 `grill-me` 的可携带性差异。 |
| `wayfinder` | 对比 / 推荐：想法「一个会话装不下」时用它，它把整件事画成一张 map，并在 map 里跑 grilling 会话。 |
| `grilling` | 说明来源：`grill-me` 和 `grill-with-docs` 都建立在 `grilling` primitive 之上；`grill-me` 是 "the user-invoked front door that carries nothing with it"。 |
| `prototype` | 推荐 / 说明边界：遇到 ungrillable 问题时，先做个丢弃版原型看它一眼，再回来一句话回答。 |
| `to-spec` | 推荐 / 举例：如果 grill 的东西确实是软件，可以把**同一个会话**交给 `to-spec` 进入建流程。 |
| `ask-matt` | 推荐：不确定该走哪条流程时，由它来路由。 |

（注：本页链接里还出现 `session`、`stateless`、`stateful`、`agent`、`agent-mode`、`dumb zone`/`smart-zone`、`context window`、`model`、`context` 等词条，那些是词典条目，不是技能。）

### 页面里写明的顺序与衔接

作者明确写出的顺序／衔接句：

1. **grill → to-spec（同一个会话，不要开新会话）**
   - "Do I start a fresh session before writing the spec? **No.** The value of the session is the [context](https://www.aihero.dev/ai-coding-dictionary/context) you just built. Hand the same conversation straight to [to-spec](https://aihero.dev/skills-to-spec)."
2. **grill → prototype → 回到 grill**
   - "When you hit one, stop grilling. Build the throwaway version with [prototype](https://aihero.dev/skills-prototype), look at it, then come back and answer in one line."
3. **想不出来 → 去 prototype，而不是去猜**
   - "a question you can't answer is usually a sign to prototype rather than to guess."
4. **规模太大时的顺序：先拆分，再分别 grill**
   - "Usually the scope was too large. Ask the agent to break the work into smaller pieces first, then grill each one."
5. **grill → to-spec → 建流程**（一条完整的路，但作者注明是可选项）
   - "you can hand the same conversation to [to-spec](https://aihero.dev/skills-to-spec) and carry on into the build flow (an option, not the point of the skill)."
6. **不确定走哪条 → 先 ask-matt**
   - "When you're unsure which flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you."

### 跨会话用法相关（`/compact`、`/clear`、子代理、换会话）

本页**没有**出现 `/compact`、`/clear`、subagent、委派子代理的说法。

与「换会话」有关的只有两处，方向都是**不要换**：

- 开头要求在新会话里**启动**它："Start it in a **fresh conversation**, not on top of a plan you already had an agent write."
- 结尾要求**不要**在写 spec 前另起新会话："Do I start a fresh session before writing the spec? **No.**"

另外本页提到会话太长会漂到 dumb zone：原文 "Very long sessions also drift into the **[dumb zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)**, where the [context window](https://www.aihero.dev/ai-coding-dictionary/context-window) is full enough that the questions get worse."（这是提到上下文变满，但不是 `/compact` 操作。）

### 其它值得一提的原文

- 它不是面试而是会话，**范围由你掌控**："The skill asks the questions, but **you** own the scope."
- 失败模式是**被动**："The failure mode is **passivity**: answering 'agreed, agreed, agreed' for forty questions and coming out with a plan the agent wrote and you nodded at."
- 数轮次而不是数问题："Count rounds, not questions. Forty-six questions across four rounds is an ordinary session. It ends when the frontier is empty: every branch visited, nothing left silently assumed."
- 想改回一次一个问题，加进全局 `CLAUDE.md`：`When grilling, ask one question at a time.`
- 模型比多数技能更关键："Grilling leans on the [model](https://www.aihero.dev/ai-coding-dictionary/model)'s own sense of how systems break, so give it your best one. Implementation mostly follows context and tolerates a cheaper model."

---

## 2. handoff

### 页面标题与 description 原文

- `title`: "The /handoff Skill"
- `description`: "Write up a long session so another agent can continue it."

（页面正文里的技能名写作 `/handoff`。）

### tags 原文

```yaml
tags:
  - phase-6
  - get-better-results
```

（注意：`grill-me` 是 `phase-1`，`handoff` 是 `phase-6`。这个编号顺序和编号本身的含义，本文不做推断。）

### 「Where it fits」原文摘录

整节原文如下：

> `handoff` is a **reach-for-it-anytime standalone** that lives at the seam between sessions rather than inside a build chain, but a narrow one, and the honest map is that you'll use it less often than the other four options at a phase boundary. Its closest neighbour is [prototype](https://aihero.dev/skills-prototype), because a prototype lives in its own directory and the round trip out and back is exactly the crossing this skill is for. When you're at a boundary and unsure whether to continue, clear, hand off, delegate or compact, [ask-matt](https://aihero.dev/skills-ask-matt) carries the tree that orders those five, and routes you over the rest of the set.

定位结论：**「随时可用的独立件」，不在一条建流程（build chain）之内，它待的位置是会话与会话之间的接缝（the seam between sessions）。** 作者同时说明它是**窄的**一件工具，在阶段边界上它比另外四个选项用得少。

### 「When to reach for it」要点

要点如下：

- 必须由人主动输入 `/handoff` 触发；agent 不会自己用：原文 "You invoke this by typing `/handoff`; the agent won't reach for it on its own."
- 触发时要带一句话说明**下一个会话是用来干什么的**（原文："Pass a note about what the next session is for, and the document is written for it."），文档会按这个用途来写。
- 作者说触发情形一共四种，即下面这张表：原文 "Four situations are the whole trigger:"。**本页没有给出「什么时候不该用它」，同时也说了这是穷举。**
- 唯一一条明确的「改用别的」判据：除这四种之外，一律用 `/compact`。原文："For anything else (same harness, same directory, you are done [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) and moving to implementation), `/compact` is the move. [ask-matt](https://aihero.dev/skills-ask-matt) carries the ordered tree over all five options at a phase boundary."

**「四种该用它的情形」表格（整表原文照抄）：**

| Situation | Why a file |
| --- | --- |
| Swapping harness (Claude → Codex) | The new harness cannot see the old [context](https://www.aihero.dev/ai-coding-dictionary/context) |
| Moving to a different directory or repo | A prototype directory is the common case |
| Sending the work to a colleague | They need something they can read |
| Forking a side task found mid-phase | You keep working; a second agent takes the fork |

### 「Branching is the use people skip」整节原文摘录

**这是负责人点名要知道的那一节，整节照抄如下**（小节标题原文：`Branching is the use people skip`）：

> The skill's description reads like session resumption: write a summary, end here, resume there. Read that way it looks like a worse `/compact`, so it gets skimmed past. The fork case is the one worth knowing. You **stay in your session** and hand a copy of the accumulated context to a second agent working in parallel.
>
> That is what the detour through [prototype](https://aihero.dev/skills-prototype) uses. You are deep in a design conversation, you hit a question that only running code will settle, and you do not want to spend the thread you built on finding out. Hand off to a prototype session, get the answer, hand the answer back, and reference it from the original thread. Two crossings, one live conversation, nothing re-explained.
>
> Three of the five options at a phase boundary preserve different things: `/compact` preserves your intent, `/clear` preserves nothing, `/handoff` preserves the work's ability to move.

**「走两个来回」的用法：摘到了。** 原话就是上面第二段的 "Hand off to a prototype session, get the answer, hand the answer back, and reference it from the original thread. Two crossings, one live conversation, nothing re-explained."（交接给一个原型会话，拿到答案，把答案交回来，并在原线索里引用它。两次跨越，一条活着的会话，什么都不用重新解释。）关键点：**原会话不结束**（"You **stay in your session**"），只是把累积上下文的副本交给并行的第二个 agent。

### 阶段边界上的五个选项与那棵树

作者在两处提到这棵树，但**这棵树本身在这一页没有画出来**——他把树的正文放在 `ask-matt` 那一页。本页能摘到的相关原话有三处：

1. 五个选项的清单与「谁来带这棵树」：
   > If nothing is travelling, you do not need a handoff: staying in the [session](https://www.aihero.dev/ai-coding-dictionary/session), `/clear`, a [subagent](https://www.aihero.dev/ai-coding-dictionary/subagent) and `/compact` cover the ordinary end-of-phase case, and `/compact` covers it more often than this skill does.
   > [ask-matt](https://aihero.dev/skills-ask-matt) carries the ordered tree over all five options at a phase boundary.
2. 「Where it fits」里的第二次点名，并且**列出了这五个选项的动作名**：
   > When you're at a boundary and unsure whether to continue, clear, hand off, delegate or compact, [ask-matt](https://aihero.dev/skills-ask-matt) carries the tree that orders those five, and routes you over the rest of the set.
3. 三个选项各自「保住什么」的那一句（见上一节末句）："/compact preserves your intent, /clear preserves nothing, /handoff preserves the work's ability to move."

**五个选项合起来是**：continue（继续，即 staying in the session）／`/clear`／`/handoff`／delegate（委派子代理，即 subagent）／`/compact`。**本页没有给出这棵树的分支判断顺序**，只说明树在 `ask-matt` 那里，以及单独一条判据：「有什么东西要移动吗？没有就 `/compact`」。以「继续」为起点的那一句：原文 "Continuing is the only move that doesn't, which is why it's the first one to rule out."（继续是唯一一个不把原始对话降级成二手来源的动作，所以它是第一个要排除的选项。）——这句在 `Common questions` 里，见下节。

### 这一页里出现的其它技能

| 技能 | 出现情境 |
| --- | --- |
| `prototype` | 推荐 / 说明边界：作者说它是 `handoff` 最近的邻居（"Its closest neighbour is prototype"），因为原型住在自己单独的目录里，「出去一趟再回来」正是这个技能存在的意义；「Branching is the use people skip」整节也是围绕 prototype 讲那个来回。 |
| `ask-matt` | 推荐 / 说明分工：阶段边界上五个选项的**有序树**由 `ask-matt` 承载，它同时负责在整套技能里给你路由。本页两处点名。 |
| `grilling` | 举例：`/compact` 的判据里把「你 grill 完了、要转去实现」当成「同 harness、同目录」的典型场景。这里 `grilling` 是被指的词条链接（`ai-coding-dictionary/grilling`），用来说明工作阶段。 |

（注：链接到 `ai-coding-dictionary/` 的词条——`agent`、`harness`、`session`、`subagent`、`context`、`primary source`、`secondary source`——是词典条目；其中 **`subagent` 在本页是作为「阶段边界五个选项之一」（delegate）出现的**。）

### 页面里写明的顺序与衔接

逐句摘录作者写下的顺序／衔接：

1. **`/compact` 是默认，`/handoff` 是例外**
   - "`/compact` unless something is travelling. Staying on the same task is a compact, not a handoff: same harness, same directory, and you need to stay in the loop is where the phase-boundary tree lands most days."
2. **同 harness 同目录、grill 完转实现 → 用 `/compact`**
   - "For anything else (same harness, same directory, you are done [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) and moving to implementation), `/compact` is the move."
3. **设计对话卡住 → handoff 出去做原型 → 答案交回来**
   - "Hand off to a prototype session, get the answer, hand the answer back, and reference it from the original thread."
4. **拿回答案之后，下一个会话怎么接**
   - "Open the fresh session and point it at the path: read this file, then continue." 并且要点名文件路径而不是把摘要粘进 shell：原文警告摘要里的反引号或 `$(...)` 在插进 `claude "<summary>"` 时会被弄坏，且通常失败是**静默截断**而不是报错。
5. **跨环境时：文件一写完，立刻自己拷一份到持久位置**
   - "If the next session isn't starting within the hour, or is starting under a different harness, copy the file somewhere durable yourself as soon as it's written."
6. **交接前先自己读一遍，把「只是假设」的东西降级**
   - "Read the document before you hand it over, and downgrade anything you only assumed."
7. **文档里有一节专门告诉下一个 agent 该用哪些技能**
   - 原文（`What travels, and what doesn't` 节）："The document carries the live thread (what's in flight, why, and what's next) plus a **suggested skills** section naming what the next agent should reach for."

### 跨会话用法相关（`/compact`、`/clear`、子代理、换会话）

**本页是这 5 页里最集中讲跨会话的一页。** 摘录如下：

- 三个选项的对照（原文）：
  > Three different things being preserved. `/compact` compresses this context and keeps you going in a fresh window: intent survives. `/clear` empties the window and starts from nothing: correct when everything behind you is disposable, and one-way if it isn't. `/handoff` writes a portable file: the work survives the move to somewhere else. Note that all three turn a **[primary source](https://www.aihero.dev/ai-coding-dictionary/primary-source)** (the conversation as it happened) into a **[secondary source](https://www.aihero.dev/ai-coding-dictionary/secondary-source)** (a summary of it). Continuing is the only move that doesn't, which is why it's the first one to rule out.
- `/handoff` 的优势不在总结得更好：原文 "`/handoff`'s advantage is not that it summarises better; it's that the result is a file you can carry somewhere `/compact` can't reach."
- 与之类比但不等同的东西：原文 "Is this the same as `/branch`, `--fork-session`, or the built-in `/handoff`? Analogous, not identical, and `/branch` isn't a shipped skill here; `/handoff` is the canonical name." 并且：同机器、同 harness、同目录时，fork 更省事；一旦目的地是 fork 到不了的地方，文件就赢。
- 文件为什么放在临时目录：原文 "The temp directory... Temp is deliberate: a handoff is a transit document, not an artifact you maintain."；以及会消失的风险："Some environments clear temp between sessions (Codex is the reported case), and `/private/tmp` goes on reboot."
- 只带「还在飞的那条线」，已经写成文档的东西只引用不复制：原文 "Specs, plans, ADRs, issues, commits and diffs are referenced by path or URL, never copied. That keeps the file small, and it keeps the settled detail in one place instead of two that drift."
- 密钥会被打码：原文 "Secrets are redacted before it's written."
- 和 `CLAUDE.md` 的分工（原文）："Ask whether it's true next month. `CLAUDE.md` is standing context about the project, loaded into every session whether it's relevant or not. A handoff is about one piece of work in flight and is dead once that work lands."
- 一条已知批评：原文 "**It captures the what, not the why.** A fair and repeated criticism."

### 「It's working if」原文（判断它有没有起作用）

> - The document is a small fraction of the conversation, and the specs, issues and diffs appear in it as paths and URLs rather than as copied text.
> - You can read it cold, without the original session open, and know what to do next.
> - The fresh agent starts working instead of asking you to re-explain the setup.
> - In the fork case, your original session is still sitting there untouched when you come back to it.
> - The suggested-skills section names the skill you'd have reached for yourself.
> - Nothing in it is a key, a token, or a password.

---

## 3. to-questionnaire

### 页面标题与 description 原文

- `title`: "The /to-questionnaire Skill"
- `description`: "Turn open questions into a doc someone else fills in."

（页面正文里的技能名写作 `/to-questionnaire`。）

### tags 原文

**这一页的 YAML 头部没有 `tags` 字段。** 照抄这一页实际的头部：

```yaml
title: "The /to-questionnaire Skill"
slug: "skills-to-questionnaire"
type: "post"
description: "Turn open questions into a doc someone else fills in."
updatedAt: "2026-08-24T09:14:47.195Z"
```

与另外几页对比：`grill-me` 有 `tags: [get-better-results, phase-1]`，`handoff` 有 `tags: [phase-6, get-better-results]`。**这一页没有 `phase-` 标签可抄，也没有 `get-better-results` 标签。**（如实记录，不猜作者是不是漏了。）

### 「Where it fits」原文摘录

整节原文如下：

> `to-questionnaire` is a reach-for-it-anytime standalone. It sits at the boundary of your own knowledge, where the next move is another person rather than another skill, most often mid-flow, when planning has stalled on something that isn't yours to decide.
>
> Its neighbour is [grill-me](https://aihero.dev/skills-grill-me), and the two split on where the answers live: grilling mines you, a questionnaire mines someone else. What comes back is raw material: feed it into another grilling round, or into [grill-with-docs](https://aihero.dev/skills-grill-with-docs) or [to-spec](https://aihero.dev/skills-to-spec) if the work is heading for a build. When you're unsure which skill fits the moment, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位结论：**「随时可用的独立件」（reach-for-it-anytime standalone）**，不在一条建流程之内。作者给它的位置是「你自己知识的边界」——下一步是**另一个人**，而不是另一个技能；它常常出现在流程中间（mid-flow）。

### 「When to reach for it」要点

要点如下：

- 必须由人主动输入 `/to-questionnaire` 触发：原文 "You invoke this by typing `/to-questionnaire`; the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) won't reach for it on its own."
- 该用的时机：某个决定卡在**只存在于另一个人脑袋里的知识**上——客户、领域专家、持有业务规则的高管、不跟你坐一起的同事。原文："Reach for it when a decision is blocked on knowledge that lives in one other person's head: a client, a domain expert, an exec who owns the business rules, a colleague on a team you don't sit with."
- **最常见的情形（和 grill-me 的衔接）**：原文 "The common case is a [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) session that stalls: some of what surfaced isn't yours to answer. Run `/to-questionnaire` in that same conversation to take those questions offline, then bring the answers back and carry on."
- 「什么时候该用哪个技能」的判据表（**整表原文照抄**）：

  | The answers are in… | Reach for |
  | --- | --- |
  | Your own head, unsharpened | [grill-me](https://aihero.dev/skills-grill-me) |
  | The codebase | [grill-with-docs](https://aihero.dev/skills-grill-with-docs) |
  | Someone else's head | `to-questionnaire` |
  | Nobody's head yet, the question needs something to react to | [prototype](https://aihero.dev/skills-prototype) |

- **不该用 / 不该指望它的地方**（作者用「它故意不做的事」和问答两处来说明边界）：
  - 它不是 **branching**：原文 "It isn't **branching**: the questions are a flat, grouped list, not a tree that skips section D if you answered A."
  - 它不是 **multi-recipient**：原文 "And it isn't **multi-recipient**: one run produces one document for one person." 三个人握有三部分答案就跑三次，原文："If three people hold three parts of the answer, run it three times, once per person. Routing questions by discipline or role inside a single document is a request people have made; it isn't what shipped."
  - 它**不分发**："No. It writes a Markdown file in the current directory and tells you the path. Delivery is yours: paste it into a [ticket](https://www.aihero.dev/ai-coding-dictionary/ticket), drop it in a Slack thread, attach it to an email, or open it on a shared screen and work through it live."
  - 它**没有**读你 grill 会话的 ingest 阶段："The skill has no ingest phase: it asks about the send, then drafts." 所以必须**在同一个会话里**跑，否则它对新会话一无所知：原文 "Start it in a fresh session and it knows nothing about the grilling; you'll be re-supplying the topic yourself when you answer 'what do you need back?'."
  - 如果你已经有自己公司现成的格式，就不用它：原文 "If you already have a house format that works, the honest answer is that you don't need this."
  - 它不是 `/grill-me` 的批量版：原文 "`to-questionnaire` is about a different axis: not how the questions are delivered, but whose head the answers are in. Answering them yourself faster is `grill-me`; getting them out of someone else is this."

### 这一页里出现的其它技能

| 技能 | 出现情境 |
| --- | --- |
| `grill-me` | 对比 / 说明边界：两者按「答案在谁脑子里」分工——"grilling mines you, a questionnaire mines someone else"。另有一整条问答专门说「这不就是 `grill-me` 批处理版吗」并给出否定答案。 |
| `grill-with-docs` | 推荐 / 说明去向：拿回来的答案如果这件事正要进建流程，可以喂给 `grill-with-docs`。同时出现在「答案在代码库里」那一行判据表里。 |
| `to-spec` | 推荐 / 说明去向：同上，拿回来的答案可以喂进 `to-spec`。 |
| `prototype` | 对比 / 举例：判据表里「答案还不在任何人脑子里、问题需要有个东西可反应」那一行指向 `prototype`。 |
| `ask-matt` | 推荐：不确定当下该用哪个技能时，由它路由。 |
| `grilling` | 说明来源：本技能的最常见触发情形就是一场卡住的 grilling 会话；`grilling` 在这里也是词典链接。 |

（注：链接到 `ai-coding-dictionary/` 的词条——`agent`、`session`、`context`、`model`、`ticket`——是词典条目，不是技能。）

### 页面里写明的顺序与衔接

逐句摘录作者写下的顺序／衔接：

1. **卡住的 grilling → 在同一个会话里跑 `/to-questionnaire` → 把答案拿回来 → 继续**（作者说的最常见路径）
   - "Run `/to-questionnaire` in that same conversation to take those questions offline, then bring the answers back and carry on."
2. **答案回来之后的去向：再一轮 grilling，或 grill-with-docs／to-spec**
   - "What comes back is raw material: feed it into another grilling round, or into [grill-with-docs](https://aihero.dev/skills-grill-with-docs) or [to-spec](https://aihero.dev/skills-to-spec) if the work is heading for a build."
   - 「It's working if」里对这个衔接的判断标准：原文 "The answers that come back are usable input for a new grilling round, rather than a fresh set of questions."
3. **如果对方也不知道 → 文档会要求他们说出来**（衔接下一次的输入质量）
   - "a flagged uncertainty is worth more than a guess, because a vague answer and a confidently wrong one look identical once they're back in your context."
4. **不确定该用哪个 → 先 ask-matt**
   - "When you're unsure which skill fits the moment, [ask-matt](https://aihero.dev/skills-ask-matt) routes you."

### 跨会话用法相关（`/compact`、`/clear`、子代理、换会话）

本页**没有**出现 `/compact`、`/clear`、subagent、委派子代理的说法。

与「换会话」有关的只有一处，方向是**不要换**（因为技能没有 ingest 阶段，换了就丢上下文）：

- "What makes it work after a grilling session is that you run it in the **same conversation**, so the [session](https://www.aihero.dev/ai-coding-dictionary/session) is already in [context](https://www.aihero.dev/ai-coding-dictionary/context) and the drafting can draw on it."

这一条和 `grill-me` 一页里「写完 spec 前不要另起新会话」是同一个道理的两种用法。

### 其它值得一提的原文

- 「grill 的是发出去这件事，不是主题」：原文 "It grills you about the **send**, never the subject. Interviewing you about the topic is pointless here: not knowing the topic is why you're writing to someone else."
- 访谈只有两轮就结束（原文）："The interview is two exchanges, and then it stops." 两问是「发给谁」和「你需要拿回什么」。
- 产物落到哪里：原文 "The file lands at `to-questionnaire-<slug>.md` in the current directory. There is no setup, no workspace, and nothing to configure."
- 文档为什么这么排：原文 "Questions ordered **most-important-first** and grouped under themed headings, because async means you may only get one pass."
- 不做分支设计的理由（原文）："a [model](https://www.aihero.dev/ai-coding-dictionary/model) planning more than two or three questions ahead of a real answer plans badly, and a branching document has to plan all of them ahead of every answer."

### 「It's working if」原文

> - It asks about the recipient and about what you need back, then stops asking. A question about the subject itself is the skill off the rails.
> - Every item you named as "what I need back" is traceable to a question in the file.
> - The questions read as aimed at what the *recipient* knows, not as your own open questions copied down verbatim.
> - You could hand the file to someone who wasn't in the conversation and they would know why they got it and by when to reply.
> - The answers that come back are usable input for a new grilling round, rather than a fresh set of questions.

---

## 4. teach

### 页面标题与 description 原文

- `title`: "The /teach Skill"
- `description`: "Learn a topic across many sessions that build on each other."

（页面正文里的技能名写作 `/teach`。）

### tags 原文

**这一页的 YAML 头部同样没有 `tags` 字段。** 照抄这一页实际的头部：

```yaml
title: "The /teach Skill"
slug: "skills-teach"
type: "post"
description: "Learn a topic across many sessions that build on each other."
updatedAt: "2026-08-24T09:14:47.195Z"
```

（与 `to-questionnaire` 一样，没有 `phase-` 标签可抄。）

### 「Where it fits」原文摘录

整节原文如下：

> `teach` is a **reach-for-it-anytime standalone**. It is not a step in a build chain and shares no artifacts with the engineering flow; it owns its directory and lives there for as long as the topic lasts.
>
> Its one real neighbour is [handoff](https://aihero.dev/skills-handoff), through the composition Matt named as the answer to "what do I do if I'm being grilled about something I don't understand?": don't stop the grilling to learn: `/handoff` to a teaching workspace, learn it there with `/teach`, then go back and pick up where you left off. The nearby alternative is [research](https://aihero.dev/skills-research), for when what you want is a cited document rather than lessons and retention. When you are not sure which skill or flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you over the whole set.

定位结论：**「随时可用的独立件」（reach-for-it-anytime standalone）**，不在建流程里，也不跟工程流程共享任何产物（"shares no artifacts with the engineering flow"）。它独占一个目录，只要这个题目还在学，就住在那里。

### 「When to reach for it」要点

要点如下：

- 必须由人主动输入 `/teach` 触发：原文 "You invoke this by typing `/teach`; the [agent](https://www.aihero.dev/ai-coding-dictionary/agent) won't reach for it on its own."
- 该用的时机：**学习本身就是这件事**（"when the learning is the project"）——一门语言、一个框架、一个刚加入的代码库、瑜伽、shader、一张证书。
- 不该用的时机：**顺口解释一句**不用它：原文 "It is not the tool for one explanation in passing."
- 「你想要什么 → 该用什么」的判据表（**整表原文照抄**）：

  | What you want | What to reach for |
  | --- | --- |
  | To learn a topic over weeks, with sessions that accumulate | `teach` |
  | One idea explained inside the session you are already in | Just ask, in that session |
  | The agent's last message re-pitched because it didn't land | [wait-what](https://aihero.dev/skills-wait-what) |
  | To sharpen thinking you already have, rather than acquire new material | [grill-me](https://aihero.dev/skills-grill-me) |
  | A background agent to read [primary sources](https://www.aihero.dev/ai-coding-dictionary/primary-source) and leave you a cited document | [research](https://aihero.dev/skills-research) |
  | To learn something that came up mid-grilling, without derailing the [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) | [handoff](https://aihero.dev/skills-handoff) out to a teaching workspace, then `teach` there |

- **前提条件（`Prerequisites` 一节）**：它建的是一个目录而不是产出一个文件，而且**一个工作区只放一个题目**：原文 "`teach` builds a directory rather than producing a file, and the skill assumes one mission per workspace, so run it somewhere you are happy to give over to a single topic." 还有 "Keep it out of the project you are working in: a separate repo is the recommended home, rather than a global `~/.learnings/` folder or the working project itself."
- 这个目录里会累积什么（**整表原文照抄**）：

  | Path | What it holds |
  | --- | --- |
  | `MISSION.md` | Why you are learning this. Everything else hangs off it; if it is missing, the first thing `teach` does is interview you until it isn't |
  | `RESOURCES.md` | The vetted sources it teaches from, split into Knowledge and Wisdom (communities) |
  | `lessons/*.html` | The numbered lessons: the primary unit of teaching |
  | `reference/*.html` | Compressed cheat-sheets, algorithms, glossaries: the documents you actually return to |
  | `learning-records/*.md` | ADR-style notes on what you have demonstrably learned, used to decide what to teach next |
  | `assets/*` | Reusable components, starting with a shared stylesheet, so the lessons look like one course |
  | `NOTES.md` | Your stated teaching preferences |

### 这一页里出现的其它技能

| 技能 | 出现情境 |
| --- | --- |
| `handoff` | **推荐 / 组成一条跨技能用法（本页最值得注意的一处）**：`teach` 唯一真正的邻居。"Its one real neighbour is handoff"。作者把它写成 Matt 回答「我在被 grill 的东西我不懂怎么办」的组合。 |
| `wait-what` | 对比 / 说明边界：判据表里「上一条消息没讲明白、要重新讲一遍」那一行指向 `wait-what`（也就是「顺口解释一句」该用它，不该用 `teach`）。 |
| `grill-me` | 对比：判据表里「打磨你已有的想法，而不是吸收新知识」那一行指向 `grill-me`。 |
| `research` | 对比 / 说明边界：判据表里「要一个有引用来源的文档」那一行指向 `research`；「Where it fits」里也说它是近旁的替代品："for when what you want is a cited document rather than lessons and retention." |
| `ask-matt` | 推荐：不确定哪个技能或流程合适时，由它在整套技能里路由。 |
| `wayfinder` | 举例（出现在用户抱怨的引文里，不是作者推荐）：一位用户说在 wayfinder 流程里跑 `teach` 时抱怨它没先 grill 摸底——原文 "One user running it inside a wayfinder pipeline put it plainly: 'It never did grilling to establish my starting point so it made lots of assumptions of what I already knew.'" |

（注：链接到 `ai-coding-dictionary/` 的词条——`session`、`model`、`parametric-knowledge`、`stateful`、`agent`、`primary-source`、`grilling`、`effort`、`harness`——是词典条目，不是技能。）

### 页面里写明的顺序与衔接

逐句摘录作者写下的顺序／衔接：

1. **被 grill 到不懂的东西时：不要停下 grill 去学；先 handoff 到教学工作区 → 在那里 `/teach` → 再回去接着原来的线索**（本页最明确的一条跨技能顺序）
   - "don't stop the grilling to learn: `/handoff` to a teaching workspace, learn it there with `/teach`, then go back and pick up where you left off."
2. **`MISSION.md` 缺失时，`teach` 的第一件事是访谈你直到它存在**
   - "if it is missing, the first thing `teach` does is interview you until it isn't"
3. **先知识后操练的顺序**
   - "Knowledge comes first, where difficulty is the enemy because it eats the working memory you need in order to understand; then the skill is drilled through a tight feedback loop, where difficulty is the tool."
4. **先资源后有课**
   - "before it teaches, it goes and finds high-trust resources, records them in `RESOURCES.md`, and cites them inside every lesson."
   - 「It's working if」里的判断标准：原文 "`RESOURCES.md` fills up before the lessons do..."
5. **`learning-records/` 决定下一课教什么**
   - "ADR-style notes on what you have demonstrably learned, used to decide what to teach next"；以及 "From the mission and the learning records, `teach` picks the next lesson inside your **zone of proximal development**"
6. **纠正要说出声，因为它会变成下一条教学记录**
   - "correct the level out loud when a lesson misses, because the correction becomes a learning record and steers the next one."
7. **想要复习／操练而不是新内容时，得自己开口**
   - "If you want review or drilling instead of new material, ask for it; the skill will not propose the switch on its own."
8. **不确定哪个技能／流程合适 → 先 ask-matt**
   - "When you are not sure which skill or flow fits, [ask-matt](https://aihero.dev/skills-ask-matt) routes you over the whole set."

### 跨会话用法相关（`/compact`、`/clear`、子代理、换会话）

本页**没有**出现 `/compact`、`/clear`、subagent、委派子代理的说法。但它有一整条问答专门讲「跨会话怎么用」，结论很清楚，也很有用：

原文（`Common questions` 里 "Do I stay in one session, or start a new one per lesson?"）：

> All three approaches work: staying in the same session, re-invoking `/teach` in a new session, or opening a new session in the same folder. Each lesson is its own invocation. **The folder is the continuity, not the conversation.** Common practice is to open a fresh session in the workspace and say `/teach next lesson for <topic>`.

关键一句（原文加粗处即作者加粗）："**The folder is the continuity, not the conversation.**"（**连续性靠的是那个文件夹，不是那段对话。**）也就是这个技能把「跨会话」的载体从会话换成了目录里的文件——和 `handoff` 用临时文件做载体是两种不同的做法。

另外它把「跨会话」写进了验收标准（「It's working if」原文）："Opening a fresh session in the folder and saying 'next lesson' continues the course instead of restarting it."

还有一条与「文件落在哪个目录」有关的已知坑（原文）：

> **Where does it put the files? Mine ended up in `~/.claude/skills`.** A real, open bug ([#377](https://github.com/mattpocock/skills/issues/377)). ... An agent that resolves the first kind against the skill's install directory goes on to resolve the second kind there too, and writes your course into the skill folder. Check where the first lesson landed before you build on it, and name the directory explicitly when you start rather than relying on "the current directory" being understood.

### 其它值得一提的原文

- 「储存强度而不是流利感」：原文 "The word to think with is **storage strength**: long-term retention, as opposed to **fluency**, the in-the-moment recall that feels like mastery while you are reading and is gone a week later."
- 课程与参考文档的分工：原文 "The split worth knowing: lessons are rarely revisited, reference documents are."
- 它不靠模型自己的记忆教：原文 "It does not teach from what the [model](https://www.aihero.dev/ai-coding-dictionary/model) already knows. [Parametric knowledge](https://www.aihero.dev/ai-coding-dictionary/parametric-knowledge) is treated as untrusted"
- 一条已知的捏造案例：一位学 2x2 魔方的用户拿到了「解不开」的捏造转法序列。
- 已知未修的问题：正确答案总在第一个选项；`SKILL.md` 现在要求每个选项字数相同，但没说位置（"treat answer position as meaningless"）。
- 最常见的实质抱怨：没有摸底测评，第一课没有教学记录可依，于是乱假设你已有的水平；显式的知识摸底还只是需求（issue #725），没发。
- 它不只用于写代码：韩语、日语敬语、钢琴、吉他、桌游设计、OpenSCAD、电影情节、Azure 与 CCNA 认证、大学考试，还有八岁和十岁孩子要的逃生室和火蝾螈的可打印小书。

### 「It's working if」原文

> - The first thing it does in an empty directory is interview you about why you want this, rather than produce a lesson.
> - `RESOURCES.md` fills up before the lessons do, and each lesson names one primary source worth reading yourself.
> - Claims in a lesson carry links out. A lesson with no citations is the skill teaching from memory.
> - A lesson takes one sitting and leaves you able to do one thing you couldn't before.
> - Opening a fresh session in the folder and saying "next lesson" continues the course instead of restarting it.
> - `learning-records/` grows, and lessons stop re-teaching what you have already demonstrated.
> - The lessons look like one course: they link the stylesheet in `assets/` rather than each carrying its own.
> - A question that needs judgement gets you pointed at a forum, subreddit or class, not just an answer.

---

## 5. wait-what

### 页面标题与 description 原文

- `title`: "The /wait-what Skill"
- `description`: "Ask the agent to say that again, in plain English."

（页面正文里的技能名写作 `/wait-what`。）

### tags 原文

**这一页的 YAML 头部同样没有 `tags` 字段。** 照抄这一页实际的头部：

```yaml
title: "The /wait-what Skill"
slug: "skills-wait-what"
type: "post"
description: "Ask the agent to say that again, in plain English."
updatedAt: "2026-08-24T09:14:47.195Z"
```

（与本批另外两页一样，没有 `phase-` 标签可抄。）

### 「Where it fits」原文摘录

整节原文如下（这一节很短，整节照抄）：

> You can use `wait-what` at any point, in any conversation, inside any other skill. It repairs one message after the fact. The real cure is a shared language agreed upfront, and that is [grill-with-docs](https://aihero.dev/skills-grill-with-docs): a [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) session that runs [domain-modeling](https://aihero.dev/skills-domain-modeling) as it goes, so the words you both use land in your `CONTEXT.md`. If you're unsure which skill fits the moment, [ask-matt](https://aihero.dev/skills-ask-matt) routes you.

定位结论：**「随时可用的独立件」，而且是本批 5 个里最无位置限制的一个**——作者的原话是 "at any point, in any conversation, **inside any other skill**"（任何时刻、任何对话、**任何其它技能里面**都行）。它「事后修补一条消息」（"It repairs one message after the fact"），不在任何一条流程的路上。

### 「When to reach for it」要点

要点如下：

- 必须由人主动输入 `/wait-what`，而且**作者明确说 agent 不该自己触发**：原文 "You invoke it by typing `/wait-what`. The agent will not reach for it on its own, and it shouldn't. Only you know when you stopped following."（只有你自己知道你从哪儿开始跟不上了。）
- 该用的时刻：**一发现自己在「扫读」就用**（"Use it the second you notice you're skimming."）。原文列举的三种症状："The agent has drifted into jargon it invented, stacked five acronyms, or explained a decision whose premise you never saw."
- 它修的是**你正身处的这段对话**：原文 "It fixes the conversation you're already in."
- 「什么时候不用它、改用别的」：**想从根本上不让黑话出现**，用 `grill-with-docs`：原文 "To stop the jargon arriving at all, use [grill-with-docs](https://aihero.dev/skills-grill-with-docs), which builds the shared language upfront."

### 这一页里出现的其它技能

| 技能 | 出现情境 |
| --- | --- |
| `grill-with-docs` | **对比 / 说明边界（本页出现两次，是本页唯一的「另一个技能」）**：第一次在「When to reach for it」——想从根上不让黑话出现就先做它，因为它**提前**建好共用语言；第二次在「Where it fits」——作者说「真正的解药是提前商定一套共用的语言，那就是 grill-with-docs」。 |
| `domain-modeling` | 说明组成：`grill-with-docs` 是一场 grilling 会话，同时**跑着 `domain-modeling`**，这样双方用的词才会落进 `CONTEXT.md`。 |
| `ask-matt` | 推荐：不确定当下该用哪个技能时，由它路由。 |
| `grilling` | 说明来源：`grill-with-docs` 是一场 grilling 会话（词典链接）。 |

（注：链接到 `ai-coding-dictionary/` 的词条——`agent`、`model`、`token`、`grilling`——是词典条目，不是技能。）

### 页面里写明的顺序与衔接

本页**没有**写「做完 X 就去做 Y」这类有先后的步骤。它写的是一条**因果／替代关系**，不是顺序：

- **`grill-with-docs` 在前（提前商定共用语言）→ 黑话就不会出现 → 也就用不着 `wait-what`；没做 `grill-with-docs` → 事后用 `wait-what` 补。** 对应原文两句："To stop the jargon arriving at all, use [grill-with-docs](https://aihero.dev/skills-grill-with-docs), which builds the shared language upfront." 与 "The real cure is a shared language agreed upfront, and that is [grill-with-docs](https://aihero.dev/skills-grill-with-docs)".
- 唯一带一点顺序意味的是它对**回退范围**的说法：原文 "The skill says re-pitch **that**, not 'that last message'. What lost you is usually bigger than one paragraph, so the agent decides how far back to go."（要重讲的不是「上一条消息」，而是「那个让你跟不上的东西」，通常会往上多回溯一些。）

### 跨会话用法相关（`/compact`、`/clear`、子代理、换会话）

本页**没有**出现 `/compact`、`/clear`、subagent、委派子代理的说法，**也完全没有提到跨会话／换会话**。它的整个作用域是「当前这段对话里的上一条消息」。这与它在本批里的定位一致：它是最贴身的、最小的一个独立件。

### 其它值得一提的原文

- 「三行长」是设计而不是没写完：原文 "The skill is three lines long. That is the design, not an unfinished draft. Skills that fight verbosity fail by growing: a four-hundred-line concision skill still leaves the [model](https://www.aihero.dev/ai-coding-dictionary/model) verbose, because the model reads the volume, not the plea."
- 为什么带头的词是 `wait` 而不是「简洁点」（本页核心论点，原文）：
  > The leading word is **wait**. "Be concise" is an instruction about the agent's output, and the model obeys it by clipping words and losing you further. **Wait** is about *your* state. It says comprehension failed here. An agent that hears "be brief" writes telegrams. An agent that hears "wait, you lost me" backs up and explains.
  > That difference is the whole skill. Every popular fix for verbosity names the *output*: `/tldr`, `/no-fluff`, `/talk-normal`. The model over-corrects into a caveman register that is shorter and no clearer. Naming the *listener* asks for both halves at once: fewer words **and** the context you were missing.
- 它接的是一套已经在用的语言，不是新指令：原文 "The body reuses the leading words already in your global `CLAUDE.md` and your project's `CONTEXT.md`. ASD-STE100 Simplified Technical English sets the register. The ubiquitous language supplies the nouns." 以及 "invoking it is not a new instruction. It is a reminder of one the agent already agreed to."
- 没有 `CONTEXT.md` 也能用，只少一半：原文 "If you have no `CONTEXT.md` (and no `CONTEXT-MAP.md` pointing to one for the context at hand), the skill still works. You lose only the domain-vocabulary half."

### 「It's working if」原文

> - The re-pitch is **shorter and clearer**, not shorter and blunter.
> - It adds the premise you were missing, instead of only deleting words.
> - Project nouns replace invented ones. The terms in your `CONTEXT.md` come back.
> - You can use it twice in a row, and it does not degrade into terseness.

---

## 6. 跨页汇总（只做事实归纳，不给面板出主意）

### 6.1 这 5 个技能各自的定位（按作者原话）

| 技能 | 作者给它的定位原话 | 在不在一条有顺序的路上 |
| --- | --- | --- |
| `grill-me` | "a **standalone you can run anywhere, on anything**" | 不在。可选项接进建流程："an option, not the point of the skill" |
| `handoff` | "a **reach-for-it-anytime standalone** that lives at the **seam between sessions** rather than inside a build chain" | 不在，在会话与会话的接缝上 |
| `to-questionnaire` | "a **reach-for-it-anytime standalone**" | 不在，"most often mid-flow"（常在流程中间） |
| `teach` | "a **reach-for-it-anytime standalone**" | 不在，"It is not a step in a build chain and shares no artifacts with the engineering flow" |
| `wait-what` | "You can use `wait-what` at any point, in any conversation, **inside any other skill**" | 不在，最没有位置限制的一个 |

**5 个页面对自己定位的说法是一致的：全都是「随时可用的独立件」，没有一个说自己是某条顺序路上的固定某一环。** 其中 `grill-me` 和 `to-questionnaire` 都带出「接进建流程」的可选去向，`teach` 明确说不跟工程流程共享任何产物。

### 6.2 tags 对照（哪几页有，哪几页没有）

| 技能 | YAML 里的 tags |
| --- | --- |
| `grill-me` | `get-better-results`, `phase-1` |
| `handoff` | `phase-6`, `get-better-results` |
| `to-questionnaire` | （**这一页没有 tags 字段**） |
| `teach` | （**这一页没有 tags 字段**） |
| `wait-what` | （**这一页没有 tags 字段**） |

只有 2 页带 `phase-` 编号：`grill-me` 是 `phase-1`，`handoff` 是 `phase-6`。**另外 3 页没有编号，所以本批无法从 tags 得到 5 个技能的完整先后顺序。** 至于 `phase-1` / `phase-6` 这两个数字本身表示什么，这几页里没有解释。（本批不覆盖 `ask-matt` 那一页，作者说五个选项的「有序树」写在 `ask-matt` 页上，那页不在这 5 页里。）

### 6.3 本批出现的跨技能衔接关系清单

只列页面上**明确写出**的（原始句子见各节）：

1. `grill-me` → 同一个会话直接交给 `to-spec`（不要另起会话）。
2. `grill-me` → 遇到不可 grill 的问题 → 去做 `prototype` → 回来一句话回答。
3. `to-questionnaire` → 把答案拿回来 → 再一轮 grilling，或喂给 `grill-with-docs` / `to-spec`。
4. **`handoff` 出去做 `prototype` → 拿答案 → 交回来**（两次跨越，一条活会话；`handoff` 页专门有一节讲这个）。
5. **被 grill 到不懂的东西 → `/handoff` 到教学工作区 → 在那里 `/teach` → 回去接着原来的线索**（`teach` 页写出的组合）。
6. `wait-what` 是事后修补；提前做 `grill-with-docs` 才是根治（替代关系，不是顺序）。
7. 以上任何一处不确定时 → `ask-matt` 路由。
8. 阶段边界上（继续 / `/clear` / `/handoff` / 委派子代理 / `/compact`）五选一 → 那棵「有序树」由 `ask-matt` 承载（`handoff` 页两处点名，但本页没画出树）。

### 6.4 跨会话操作的提法分布

| 提法 | 出现在哪几页 |
| --- | --- |
| `/compact` | 只在 `handoff` 页（多处，作为默认选项）。其余 4 页都没有。 |
| `/clear` | 只在 `handoff` 页（"`/clear` preserves nothing"，以及 "one-way if it isn't"）。 |
| 子代理 / subagent / delegate | 只在 `handoff` 页（作为阶段边界五个选项之一，以及「分支」用法里的第二个 agent）。 |
| 换新会话 | `grill-me`（要求在新会话启动；但写 spec 前**不要**换）、`to-questionnaire`（必须**同一个会话**，否则丢主题）、`teach`（三种做法都行，"The folder is the continuity, not the conversation"）、`handoff`（文件承载移动）。`wait-what` 没有提。 |

**跨会话这件事在这 5 页里几乎全部集中在 `handoff` 一页**，其它页只在「要不要换会话」这一个点上碰一下，且倾向是「别换，因为上下文就是价值」。

---

## 7. 抓取情况与对不上的地方（如实记录，不猜）

1. **5 个地址全部抓到，无 404、无占位页。** 全部 HTTP 200，全部有正文内容，头部 YAML 都有 `title`、`slug`、`type`、`description`、`updatedAt`（都是 `2026-08-24T09:14:47.195Z`）。
2. **3 页缺 `tags`**：`to-questionnaire`、`teach`、`wait-what` 的 YAML 里没有 `tags` 字段（`grill-me`、`handoff` 有）。所以任务里说的「tags 例如 `phase-6` 这种编号」在这 3 页上**无内容可抄**，不是我漏抓。
3. **`handoff` 页提到的那棵树没有画在这一页上。** 页面两处说明「五个选项的有序树」由 `ask-matt` 承载（原文 "carries the ordered tree over all five options at a phase boundary"），并给出了五个动作名（continue / clear / hand off / delegate / compact）和其中三个「各保全什么」。**树的实际分支判断顺序不在本页**，也不在另外 4 页里。按纪律我不去抓 `ask-matt` 页，所以这里只报「树在别处」。
4. **本批未读本地技能文件**（按纪律不做），因此**无法核对**网站在这两处与本地 `SKILL.md` 的说法是否一致。需要核对时请另派人做对照。
5. **作者名字的写法**：`teach` 页正文里有一处用第三人称称呼作者本人，原文 "through the composition **Matt** named as the answer to..."，其余各页都用 "you"。这一点如实记录，不做解读。
6. **页面提到若干指向 GitHub issue 的编号**（都在 `teach` 页）：`#559`（`GLOSSARY-FORMAT.md` 不再被 `SKILL.md` 引用）、`#377`（课程文件被写进 `~/.claude/skills`）、`#335`（正确答案总在第一个选项）、`#725`（知识摸底测评仍是需求未发）。这些是网站页面自己写的编号，我没有去 GitHub 核对。
7. **`teach` 页引用了用户原话**（如 "It never did grilling to establish my starting point..." 与 "is good at making the next lesson, but not as good at knowing when to stop and switch to review or real practice."），这些是作者转述的用户反馈，不是作者自己的判断。
