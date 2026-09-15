# 05 Productivity Skills 逐技能整理

本文件整理的是官网首页「05 Productivity Skills」这一组，共 6 个技能。官网对这一组的说明是「Human-facing workflows you run, not about code.」（给人用的工作流，不围着代码转），并写着从 `/grill-me` 开始。

整理来源：插件随包自带的本地原文，即
`C:\Users\辰辰洋洋\.dsh\profiles\web\node_modules\dsh-mattpocock-skills-deck\bundled-skills\`
下面这 6 个目录里的全部文件（每个目录下的 `agents/openai.yaml` 按要求跳过）。

一个贯穿全组的观察写在最前面，后面各技能里不再重复：**这 6 个技能里，有 5 个在 YAML 头部写着 `disable-model-invocation: true`，也就是只能由人手动打出技能名来启动，agent 自己碰不到它们、别的技能也调不动它们。只有 `writing-for-agents` 没有这一行，它是模型可调用的（agent 自己可以触发它，其他技能也可以调它）。** 这一点官网首页没有说。

---

## 1. `/grill-me`

**技能名**：`/grill-me`

**官方一句话**：`A relentless interview to sharpen a plan or design.`
中文转述：一场不留情面的连珠追问，目的是把一份计划或设计磨得更锋利。

**它解决什么问题**：你手里有一份计划或一个设计，自己看着还行，但可能经不起推敲。这个技能负责把它拖出来问个透，把站不住的地方问出来。

**什么时候用它（进入条件）**：原文没写。正文只有一句话，没有任何触发时机的说明。YAML 头部里也没有 `argument-hint`。

**用它之后通常接什么**：原文正文的全部内容是「Run a `/grilling` session.」（跑一场 `/grilling` 会话）。这一句本身就是下一步：它立刻把活交给另一个技能。至于那场会话产出什么，本目录里没写，要去看 `/grilling` 的原文。

**它在正文里点名提到的其他技能**：
- `/grilling` —— 调用。正文只有这一句，整份技能就是在调用它，没有别的内容。注意 `/grilling` 不在本组（本组 6 个名字里没有它）。

**跨会话 / 跨代理用法**：原文没写。

**原文里对不上的地方**：
- 本地这一份一共只有 7 行：YAML 头部 5 行，正文 1 行。官网把这组说成「从 `/grill-me` 开始」，但本地这份自身不含任何实质内容，只是转手交给 `/grilling`。要描述「从它开始之后到底发生什么」，必须去读 `/grilling`，本组里读不到。
- 官网按名单顺序把 `grill-me` 排在第一个；本组内部唯一一条原文写明了的连线，就是这一条连到组外的。

---

## 2. `/handoff`

**技能名**：`/handoff`

**官方一句话**：`Compact the current conversation into a handoff document for another agent to pick up.`
中文转述：把当前这段对话压缩成一份交接文档，让另一个 agent 能接着往下做。

YAML 头部里还有一行 `argument-hint: "What will the next session be used for?"`（提示：下一个会话打算拿来干什么？）。

**它解决什么问题**：一段对话里攒了很多只有这段对话才知道的上下文，干到一半要换人接手。这个技能负责把当前这段对话压成一份文档，让一个全新的 agent 能从这份文档接着干，而不是从头再来。

**什么时候用它（进入条件）**：原文没有直接写「什么时候该用」这一条。最接近的是 `argument-hint` 那句「下一个会话打算拿来干什么？」，以及正文第一句里的「让一个全新的 agent 能接着把活干下去」。也就是说原文默认的进入条件是「有一个新的 agent 要接手」，但这句话是隐含在写法里的，没有写成一条触发条件。

**用它之后通常接什么**：产出一份交接文档本身。原文没有写给谁看之外的其他下一步，也没写接手的人干完之后做什么。

**它在正文里点名提到的其他技能**：**一个都没有**。原文没有点名任何技能。正文提到文档里要包含一节叫 "suggested skills"（建议技能），内容是「建议接手的那位 agent 应该去调用哪些技能」，但原文没有列出任何具体的技能名，也没说这节该怎么写。

**跨会话 / 跨代理用法**：这一份的正文几乎全部都在说这件事。原文里关于「交给别的 agent / 新会话」的句子，逐句摘出来如下：

- YAML 的 `description` 里：「...into a handoff document **for another agent to pick up**.」——给另一个 agent 接手用。
- YAML 的 `argument-hint` 里：「**What will the next session be used for?**」——下一个会话要用它干什么。
- 正文第 1 句：「Write a handoff document summarising the current conversation so **a fresh agent can continue the work**.」——写一份总结当前对话的交接文档，好让一个全新的 agent 能接着把活干下去。
- 正文第 1 句后半：「**Save to the temporary directory of the user's OS - not the current workspace.**」——写到操作系统的临时目录里，**不要**写进当前工作区。
- 正文第 5 句：「If the user passed arguments, treat them as a description of **what the next session will focus on** and tailor the doc accordingly.」——如果用户传了参数，就把它当成「下一个会话要专注什么」的说明，据此裁剪文档。
- 另外两句不是关于人的，但和「交给别人」直接相关，也一并摘出来：
  - 「Include a **"suggested skills" section** in the document, which suggests skills that the agent should invoke.」——文档里要有一节「建议技能」，写明建议接手的那位 agent 去调用哪些技能。
  - 「**Do not duplicate content already captured in other artifacts** (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.」——不要把已经落在别的产物里的内容再抄一遍（原文举例：规格说明、计划、架构决策记录、issue、提交、差异），改成按路径或链接指过去。

它建议把交接文档写到哪里、里面要包含什么，原文的原话是：

- **写到哪里**：「Save to the temporary directory of the user's OS - not the current workspace.」——操作系统的临时目录，明确不是当前工作区。原文没有说临时目录的具体路径长什么样，也没有说怎么让接手的人找到它。
- **里面要包含什么**：
  1. 对当前这段对话的总结（第 1 句「summarising the current conversation」）。
  2. 一节「建议技能」，写明建议接手的那位 agent 调用哪些技能。
  3. 对别处已有产物的**引用**（按路径或链接），不重复抄写。
  4. 敏感信息要抹掉：「Redact any sensitive information, such as API keys, passwords, or personally identifiable information.」——例如接口密钥、密码、能认到具体个人的信息。
  5. 如果用户带了参数，按参数说明的「下一个会话要干什么」来裁剪整份文档。

**关于上下文快满、以及「做完再 handoff 回来」**：本地原文里**没有**这两件事。
- 原文一句都没提「上下文快满了」这个触发时机，也没把 handoff 和「省上下文」联系起来。
- 原文一句都没提「交接出去之后，做完再用 handoff 交回来」，也没有任何「来回收尾」的说法。仓库负责人举的那个例子（快满了 → handoff 出去 → 新会话做原型 → 做完 handoff 回来），在本地这一份里找不到对应的文字。

**原文里对不上的地方**：
- 原文明确要求写到**操作系统的临时目录**，而不是当前工作区。这一点和「写一份文件给下一个人接着做」的常规做法不一样，而且原文没有交代临时目录里的文件如何被接手方找到、会不会被系统清掉。
- 原文列举了「规格说明、计划、架构决策记录、issue、提交、差异」这些已有产物，说明这套技能里应该存在产出这些东西的技能；但 `handoff` 原文没有点名其中任何一个技能，本组另外 5 个技能也都不产这些东西。也就是说这些产物从哪来，本组里查不到。
- 原文要求文档里写一节「建议技能」并写明建议调用哪些技能，但整份原文一个技能名都没给。

---

## 3. `/to-questionnaire`

**技能名**：`/to-questionnaire`

**官方一句话**：`Turn a decision you can't fully answer into a questionnaire for someone else to fill in.`
中文转述：把一个你自己没法完全拿定的决定，变成一份问卷，交给别人来填。

**它解决什么问题**：你卡在一个决定上，因为答案在你之外的某个人脑子里——他知道的东西你不知道。这个技能负责做一份问卷，把那份知识从对方身上问出来。正文原话是：「The recipient holds knowledge the user lacks; the questionnaire pulls it out of them.」（收件人握着用户缺的知识，问卷负责把它拽出来。）

**什么时候用它（进入条件）**：原文没有写「什么时候该用」这一条触发条件。但正文开头给了一句贯穿全篇的判别口令：「**Grill the send, not the subject.**」——只就「这次发送」去采访用户，不要去采访题目本身。它解释得很清楚：用户对「发给谁、要拿回什么」这两件事永远答得上来，所以只采访这两件。文档里的问题，瞄准的是「收件人知道什么」和「用户需要什么」之间的那道**缺口**。

正文把过程写成 3 步，每步都带一个「Done when」（什么算做完了）：

1. **Who is it going to?（发给谁？）** 在**一次**对话里问清收件人的角色、专业水平、和用户的关系。这决定问卷的语气，以及问卷需要自带多少背景。完成的标志：你知道收件人是谁，也知道他知道哪些用户不知道的事。
2. **What do you need back?（你要拿回什么？）** 在**一次**对话里问清用户单独解决不了、必须从这个人身上得到的那些**具体决定或事实**。完成的标志：你拿到一张清单，上面写明了用户看完答复之后必须能够做/能够定的事。
3. **Write the questionnaire.（写问卷。）** 按第 1、2 步找出的缺口起草问题，照下面的文档结构写。**写到当前目录下的 `to-questionnaire-<slug>.md`（slug 取自题目），并报告路径。** 完成的标志：文件存在，且第 2 步里用户点名的每一项都被某个问题覆盖到了。

**用它之后通常接什么**：产出 `to-questionnaire-<slug>.md` 这一个文件，然后报告路径。文档的用途原文写明了两种：一种是交给**一个人异步填**，另一种是**开会时一起填**。原文没有写「用户拿回答复之后接什么」。

问卷的文档结构（原文给的模板）：
- 标题。
- `Purpose:` 这份问卷为什么存在、上面挂着什么决定。
- `From:`（用户）— `To:`（收件人）— `How your answers will be used:`（答复会流向哪里）。
- `## Context` —— 一段话，给一个没进过用户脑子的人指方向。够他答好就行，不要写成一整页。
- `## How to answer` —— 截止时间和大致要花多少工夫。原文特别强调：**答一半也有用**，「我不知道」也有用；拿不准的地方要标出来，别跳过。
- 若干个 `## 主题` 小节 —— 问题按**最重要优先**排序（原文理由：异步意味着你可能只有一轮机会），超过几个就用 `##` 按主题分组。每个问题只讲**一件事**、不许复合；问题下面直接留作答位；只有当问题可能被误读、或者容易被敷衍一句时，才加一行斜体 *Why this matters*（这为什么重要）。原文给了一个例子：`### What load is the system expected to handle at launch?` 下面跟着一行 *Why this matters: it decides whether we provision for burst traffic now or defer it.*，再下面是空的作答位。
- `## Anything else?` —— 结尾兜底：还有什么我们没问、但你应该让我们知道的？

**它在正文里点名提到的其他技能**：**一个都没有**。正文里出现过 grill 这个词（「Grill the send, not the subject.」），但那是当动词用的一句话，不是技能名。

**跨会话 / 跨代理用法**：原文写的是把问卷**交给一个人**填（异步，或者开会一起填），**不是**交给另一个 agent，也没有提「换一个新会话」。原文没写。

**原文里对不上的地方**：官网说这一组是「给人用的工作流」，这一份和这个说法完全对得上，看不出矛盾。原文没有和本地其它任何技能产生冲突的地方。

---

## 4. `/teach`

**技能名**：`/teach`

**官方一句话**：`Teach the user a new skill or concept, within this workspace.`
中文转述：在当前这个工作区里，教用户学会一项新技能或一个新概念。

YAML 头部里还有一行 `argument-hint: "What would you like to learn about?"`（提示：你想学什么？）。

**它解决什么问题**：用户要学一个主题，而且是**跨多次会话**地长期学。这个技能规定怎么把当前目录当成一个「教学工作区」，把学习的进展落成文件，好让下一次会话能接着教，而不是每次都从零开始。

**什么时候用它（进入条件）**：正文第一句写明了：「The user has asked you to teach them something. This is a stateful request - they intend to learn the topic over multiple sessions.」——用户开口让你教他东西时用它；原文特别点出这是一件**有状态**的事，用户打算跨多次会话学这个主题。

正文里还有几个更靠后的进入条件：
- 如果用户讲不清为什么想学、或者 `MISSION.md` 还没填，**第一件事就是去问用户为什么想学这个**。原文：「your first job should be to question the user on why they want to learn this」。
- 用户可能指定了具体要学的东西；如果没指定，就从 `learning-records` 和 mission 推算他当前的最近发展区（zone of proximal development），教最贴合那个区间的东西。

**用它之后通常接什么**：在工作区里铺开一组文件，然后一节课一节课地走。原文规定的文件如下：

- `MISSION.md` —— 记录用户**为什么**对这个主题感兴趣。原文说所有教学决策都要挂在这份文档上、由它来定根。格式见 `MISSION-FORMAT.md`。
- `./reference/*.html` —— 速查材料目录，是课程的压缩成果：速查表、参考算法、语法、瑜伽体式、术语表。原文称它们是「学习的原始单位」，要做得好看、打印出来也好看、是为快速查阅设计的。
- `RESOURCES.md` —— 可信资源清单。格式见 `RESOURCES-FORMAT.md`。
- `./learning-records/*.md` —— 学习记录目录，编号 `0001-<dash-case-name>.md`，每次递增。格式见 `LEARNING-RECORD-FORMAT.md`。
- `./lessons/*.html` —— 课程目录。一节课（lesson）是一份自成一体的 HTML 文件，讲一件紧扣 mission 的、范围很窄的事；原文说这是这个工作区里**教学的主要单位**。命名 `0001-<dash-case-name>.html`，编号递增。
- `./assets/*` —— 跨课复用的**组件**：样式表、quiz 小工具、模拟器、画图助手等，凡是第二节课还能用的东西都放这里。
- `NOTES.md` —— 给 agent 用的草稿本，记用户的偏好或者工作笔记。

每一节课的硬性要求（原文逐条写明）：
- 要**好看**：排版干净可读（原文说「Think Tufte」——往 Tufte 那种排版风格想），因为用户以后会回来复习。
- 要**短**、能很快做完。理由是学习者的工作记忆很小，必须待在里头。
- 每节课要给用户一个**实在的小赢**，能往上叠。
- 要直接挂在 mission 上，而且要落在用户的最近发展区里。
- 尽量用一条命令行命令把课件文件打开给用户看。
- 每节课要用 HTML 锚点链到别的课和参考文档。
- 每节课要推荐一份**首要资源**让用户去读或看——必须是找到的最高质量、最高可信度的那一份。
- 每节课里要写一句提醒，让用户**向 agent 追问**；agent 就是他的老师，任何不清楚的地方都可以帮忙。

关于 `./assets/`：原文说「Reuse is the default, not the exception.」——复用是默认，不是例外。写新一节课之前先读 `./assets/`，用已有的组件搭；需要新的可复用东西，就把它写成组件放进去并链过去，绝不把未来课程会重复的代码内联进去。原文还规定：**每个工作区挣到的第一个组件应该是共享样式表**，每节课都链它，这样课看起来像一门完整的课，而不是一堆各做各的散件。

关于 mission 变了：原文说这是正常的，但要**先和用户确认**，再更新 `MISSION.md`，并补一条 learning record 把这次变化记下来。

关于术语表：`SKILL.md` 正文写「Glossaries, in particular, are an essential reference. Once one is created, it should be adhered to in every lesson.」——术语表尤其重要，一旦建出来，每一节课都要遵守它。（格式见 `GLOSSARY-FORMAT.md`。）

关于 wisdom（智慧）：用户问到看起来需要「智慧」的问题时，默认先试着回答，但**最终要把人交给一个 community（社群）**——一个能让用户在真实世界里检验自己本事的地方，可能是论坛、subreddit、线下课（预算允许的话）或者本地兴趣小组。要去找声誉高的社群推荐给用户；如果用户表示不想加入社群，就尊重这个偏好。

**它在正文里点名提到的其他技能**：**一个都没有**。原文里出现的全是文件（`MISSION.md`、`RESOURCES.md`、`NOTES.md`、`GLOSSARY.md`、`learning-records/`、`lessons/`、`assets/`、`reference/`）和外部资源/社群。没有点名任何技能，也没说该跟哪个技能配合。

**跨会话 / 跨代理用法**：**有，而且跨会话是这一份的核心设计**，但原文说的是「跨会话」，**不是**「交给另一个 agent」，全文没有出现 handoff 或派子 agent 的说法。摘录如下：

- `SKILL.md` 开头：「This is a stateful request - **they intend to learn the topic over multiple sessions**.」——用户打算跨多次会话学这个主题。
- 整个「Teaching Workspace」一节就是把当前目录当成跨会话的记忆：`MISSION.md`、`RESOURCES.md`、`learning-records/`、`lessons/`、`assets/`、`NOTES.md` 都是为了未来的会话能读到而存在的。
- `LEARNING-RECORD-FORMAT.md`：「they capture non-obvious lessons, key insights, and stated prior knowledge that **will steer future sessions**」——学习记录记载不明说的经验、关键洞察、用户自己交代过的已有知识，用来指引未来的会话。
- `LEARNING-RECORD-FORMAT.md` 里「when to write a learning record」第 2 条：「The user disclosed prior knowledge — "I already know X." **Record it so future sessions don't re-teach it.** Also record the depth claimed.」——用户交代已有知识时要记下来，好让未来会话不要重教。
- `LEARNING-RECORD-FORMAT.md`：「This sets a new floor **for what to teach next**.」——新记下的一条会把「下一次该教什么」的下限抬高。
- `LEARNING-RECORD-FORMAT.md` 的 Supersession 一节：后一条记录推翻前一条时，把旧的标成 `Status: superseded by LR-NNNN`，不要删掉——「The history of how understanding evolved is itself useful signal.」（理解怎么演变的过程本身就是有用的信号。）
- `MISSION-FORMAT.md` 的 Rules：「**Revise when reality shifts.** Missions change. When the user's goal moves, update this file — **don't leave a stale mission steering future sessions**.」——目标变了就改这份文件，别留一份过期的 mission 去带偏未来的会话。
- `MISSION-FORMAT.md` 的 Template 里有一节 `## Out of scope`，说明是「用户这次明确不想追的相邻主题 —— 用来保护最近发展区」。
- `RESOURCES-FORMAT.md` 的 Rules 最后一条：「**Record community preferences.** If the user has opted out of joining communities, note it here **so future sessions don't keep proposing them**.」——把用户不想加入社群这个偏好记下来，免得未来会话反复推荐。
- `GLOSSARY-FORMAT.md`：「`GLOSSARY.md` is the canonical language for this teaching workspace. All explainers, exercises, and learning records should adhere to its terminology.」——它是这个教学工作区的标准语言，所有讲解、练习、学习记录都要遵守它的用词。

**原文里对不上的地方**：
- **`GLOSSARY.md` 没被列进工作区文件清单。** `SKILL.md` 的「Teaching Workspace」一节列了 7 项文件，里面**没有** `GLOSSARY.md`；但 `GLOSSARY-FORMAT.md` 明确把它写成这个工作区的文件（「`GLOSSARY.md` is the canonical language for this teaching workspace」），`LEARNING-RECORD-FORMAT.md` 里也用了 `[[GLOSSARY.md]]` 的双链交叉引用它。这是原文内部的一处对不上。
- 官网把这组说成「不围着代码转」，但 `teach` 的正文大量借用软件工程词汇：学习记录被说成「loosely equivalent to architectural decision records in software development」（大致相当于软件开发里的架构决策记录），`assets` 被说成「组件」、还规定了共享样式表这种做前端才会有的东西。这些说法不影响它「给人用」，但确实和官网那句口径不太一样。
- `SKILL.md` 里说 `./reference/*.html` 里包含「glossaries（术语表）」，而 `GLOSSARY-FORMAT.md` 把 `GLOSSARY.md` 写成一个独立的顶层文件。术语表到底是 `reference/` 下的 HTML，还是根目录下的 `GLOSSARY.md`，原文两种说法并存，没说清哪个为准。
- `MISSION-FORMAT.md` 规定「**One mission per workspace.** If the user wants to learn two unrelated things, that is two workspaces.」（一个工作区一个 mission；要学两件不相关的事就是两个工作区），`SKILL.md` 的 `description` 也说是「within this workspace」。但 `SKILL.md` 正文没有重复这条「一个工作区一个 mission」的限制。

---

## 5. `/wait-what`

**技能名**：`/wait-what`

**官方一句话**：`Stop. That last message did not land — re-pitch it.`
中文转述：停一下，你上一条消息我没听懂，重新讲一遍。

**它解决什么问题**：agent 刚发的那条消息没让人听懂。这个技能负责让它原地重讲一遍，并且用大白话讲。原文明确列了三个要求。

**什么时候用它（进入条件）**：原文没有写「什么时候该用」这一条说明。整份技能的正文本身就是那句触发时该说的话——你直接打出 `/wait-what`，就等于说了这句话。最接近说明的是 `description` 里的「那上一条消息没落地 —— 重新投一次」。

**用它之后通常接什么**：产出是一段重讲的消息，没有文件产出。正文对这段重讲提了三个硬要求，原文一字不差是：「**give me a little bit of context**（给我一点上下文），**talk in ASD-STE100 Simplified Technical English**（用 ASD-STE100 简化技术英语说），and **use the ubiquitous language from `CONTEXT.md`**（用 `CONTEXT.md` 里的通用语言）。」

**它在正文里点名提到的其他技能**：**一个都没有**。正文只提到一个文件 `CONTEXT.md`，那不是技能。

**跨会话 / 跨代理用法**：原文没写。

**原文里对不上的地方**：
- 官网说这组「不围着代码转」，但 `wait-what` 要求 agent 用 `CONTEXT.md` 里的通用语言重讲——那是仓库里的领域词典，明显是项目语境里的东西。
- 原文没有说如果 `CONTEXT.md` 不存在该怎么办。它直接要求「用 `CONTEXT.md` 里的通用语言」，一个字都没写这份文件没有时的退路。原文没写。
- 原文提到的 `ASD-STE100 Simplified Technical English` 是一个外部标准（航空业用的简化技术英语），原文只写了这个标准名，没有解释它是什么、也没给替代说法。一个不知道这个标准的人读到这句会卡住。
- 整份技能只有 7 行（YAML 头部 5 行，正文 1 行），正文一句话。官网名单把它单列成一个技能，但它自身没有任何展开内容。

---

## 6. `/writing-for-agents`

**技能名**：`/writing-for-agents`

**官方一句话**：`Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md.`
中文转述：怎么写「给 agent 看的文档」；在你**新建或修改技能**、或者**改 `AGENTS.md` / `CLAUDE.md`** 的时候用它。

注意：这一份的 `description` 在 6 个技能里是唯一一个带了明确触发条件（`Use when ...`）的，而且也是本组唯一一个**没有** `disable-model-invocation: true` 的，也就是说它是模型可调用的。

**它解决什么问题**：写给 agent 看的文档（技能、`AGENTS.md` / `CLAUDE.md`、被指针指到的文档）该怎么写。正文第一句就把范围定死了：「Reference for writing any document an agent consumes — a skill, an `AGENTS.md` / `CLAUDE.md`, a doc reached by a pointer.」——凡是 agent 要读的文档都算。原文还说，包装形式（技能、规则文件、被指向的文档）不一样，但写法是一样的：同一批杠杆让每一份文档变得**可预期**——让 agent 每次跑都走同一个**过程**，而不是产出同一个结果。

**什么时候用它（进入条件）**：
- `description` 里写明了：在你**新建或修改技能**、或者**改 `AGENTS.md` / `CLAUDE.md`** 的时候用。
- 正文里还写了一条更细的进入条件：「When the document you're writing is a skill, read [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md) for frontmatter, invocation choice, and router skills.」——当你写的文档**是技能**时，去读同目录下的 `SKILL-MECHANICS.md`，里面讲 frontmatter、调用方式怎么选、以及路由技能。

**用它之后通常接什么**：它本身是一份「该怎么写」的参考，不产出文件。产出的是**你正在写的那份文档**。原文没有写这条之后该接什么别的技能。

**它在正文里点名提到的其他技能**：**没有点名任何具体技能名**。内容里讲到的是**两类做法**，不是技能：
- 「router skill（路由技能）」——`SKILL-MECHANICS.md` 里讲的一类做法：当人手动调用的技能多到记不住时，做一个「路由技能」，由它一份来点名其他技能、说明每一份什么时候该翻。它只能提示，永远不能代替人去触发那些技能。
- 文件层面提到了会去改的 `AGENTS.md` / `CLAUDE.md`，那是文件不是技能。

**这份技能正文里的主要说法**（下面用大白话逐条写清，因为这组的 Other 技能都没内容、这一份是唯一有实质参考的）：
- **上下文指针（context pointer）**：agent 上下文里握着的一个引用，它点名了某个不在上下文里的材料，并且写明了「够到它的条件」。技能的 `description` 是一个上下文指针；`AGENTS.md` 里点名某份文档的一行也是同一个东西。决定 agent 什么时候去够、够得可不可靠的，是**指针的措辞**，不是它指向的目标。必须有的材料却配了一个措辞很弱的指针，那是一个「该来的时候不来」的毛病：**先把措辞改锋利**，改不动才把内容搬进主文件。
- 指针干两件事：说明那份材料**是什么**，以及列出**该触发它去够的分支**（branch，指这份文档要处理的一个独立情况，所以不同的运行会走不同的路径）。常驻的指针，**每一个字在每一轮都要花钱**，所以它比正文更该被狠狠修剪。三条：把最关键的词放到最前面；一个分支只留一个触发词（改个名字说同一件事的同义词，是同一个分支写了两遍，合并掉）；正文已经说了的身份信息，从指针里删掉。
- **两种负担**：`context load`（上下文负担）——常驻材料压在 agent 上下文窗口上的成本：`AGENTS.md` 的一行、一个技能的 `description`、任何每一轮都待在上下文里的东西，不管用不用得上，都在花 token 和注意力。`cognitive load`（认知负担）——压在**人**身上的成本：有哪些文档存在、什么时候该翻哪一份。原文说得很清楚：**人是索引；这不是一种要尽量削减的成本，它是人的主动性的代价** —— 该花在需要人的判断的地方，不该花的地方就去掉。
- 只靠指针够到的材料，省下了上下文负担，代价是那个指针自己那一行；**完全没有指针的材料，就整个压在认知负担上**。
- **信息层级（information hierarchy）**：一份文档由两种内容构成——`steps`（agent 按顺序做的动作）和 `reference`（定义、规则、事实，按需查阅），两者可以自由混合（全是步骤像菜谱、全是参考像一份评审规则、或者两者都有）。核心决定是每一块材料待在层级的哪一级：1) **文件内的步骤**——主层，agent 按顺序做的事；2) **文件内的参考**——按需查；常常是一组平级的同类（一份评审的每一条规则都在同一级上），原文说这是挺好的安排，不算毛病；3) **藏起来的参考（disclosed reference）**——推到单独一个文件里，靠一个上下文指针去够，指针着火时才加载；小到同一个文件夹里的兄弟文件，大到任何地方的外部文档。
- 原文说：往下推得太少，顶层会臃肿；推得太多，会把 agent 真正需要的材料藏起来。这个拉扯就是整个决定。
- **渐进披露（progressive disclosure）** 就是往层级下面挪的那个动作——从主文件里挪出去、藏到指针后面，好让顶层保持清楚可读。原文强调它**主要不是省 token 的优化，它是保护层级的方式**。判断该披露什么，最干净的试金石是分支：**每个分支都要用的就写在文件里，只有部分分支会够到的就推到指针后面**。文档里有步骤时，本该被披露的文件内参考会把步骤埋掉，让「去关注步骤」变成掷硬币——这不只是可读性问题，它是一个让结果飘忽的因素。
- **就近放置（co-location）** 是文件内部的配套动作：层级决定一块东西待得多靠下，就近放置决定它到了那儿之后**旁边坐着谁**。一个概念的定义、规则、注意事项放在同一个标题下面，别散开，这样读一处就会连着读到它的邻居。试金石：这份文档读起来应该像**专门给 agent 写的文档**——围着主题聚在一起的材料读起来就是这样，散开的不是。（原文特别区分：这和重复不一样——重复是把同一个意思写在两个地方；散开是把一个意思撕成碎片散在好多地方。）
- **臃肿（sprawl）** 是这里的失败模式：文档就是太长了，哪怕每一行都是活的、都是独一无二的。注意力会在多余的部分上变薄，而且多出来的每一行都要人去维护它的相关性。解法就是层级：把参考披露到指针后面，并且按分支或按顺序拆开，让每条路径只带它需要的东西。
- **步骤和完成条件（completion criteria）**：每一步都要以一个**完成条件**结尾——就是那个告诉 agent 「活干完了」的条件。两个属性让它成为一个杠杆：
  - **清楚（clarity）**——agent 分得清「做完了」和「没做完」吗？含糊的界限（原文举例：「understanding reached」理解达成了）会招来**提前收工**：还没真做完就收手，注意力滑向「我完事了」这件事。原文解释了这个机制：后面还看得见的步骤带来拖拽的拉力，而完成条件的清楚程度就是那个阻力。防御按顺序来：**先修界限**（本地、便宜）；只有当界限实在含糊得没法修、**而且**你真的观察到它抢跑时，才用拆分序列的办法把后面的步骤藏起来——而**藏只在真正的上下文边界上才有效**（一次**交接**，或者派一个子 agent；在同一个上下文里内联调用，后面的步骤还留在上下文里，什么也没清掉）。
  - **要求（demand）**——它要求多少。「每一个改过的模型都交代清楚」逼出的工夫，比「给一份改动清单」多得多。要求驱动**笨功夫（legwork）**——agent 在这件活里面自己去挖的功夫，它藏在措辞里，而不是被写成单独一步。而且它不限于步骤：一句「每一条规则都套用上」绑定一组平铺的参考，就像「每一步都做完」绑定一串步骤一样，这就是一份全是参考的文档照样能带一条「穷尽」标准的原因。
  - 原文的结论：最强的完成条件，既**查得出来**，又**穷尽**。
- **什么时候该拆（when to split）**：把一份文档拆成两份，要花掉两种负担里的一种，所以只有当这一刀值这个价时才拆。两种拆法：
  - **按序列拆**：一串步骤里，如果后面那些步骤会诱使 agent 抢跑眼前这一步，就把它们拆出去——把它们挪出视野能让 agent 在当前这件事上多下功夫。反过来要警惕：把两个序列合起来，会让每一步的后续步骤暴露给紧跟其后的内容，招来提前收工。
  - **按调用方式拆**：这是技能专属的，看 `SKILL-MECHANICS.md`。
- **领头词（leading words）**：一个已经在模型预训练里活着的紧凑概念词（原文举例：_lesson_、_fog of war_、_tracer bullets_），agent 拿着它来想事。它当成一个 token 反复出现（**不是当成一句话**），于是攒出一个分布式的定义，用最少的 token 锚住一整片行为，靠的是调用模型本来就已经有的先验。自己造一个词也行，只要把定义写清楚；但自己造的词不借用任何先验，等于用定义那几个 token 去付预训练现成词免费给你的东西——**能找现成的词就先找现成的**。
- 领头词锚两次。在正文里锚**执行**：每次这个词出现，agent 就去够同一套行为；在一组平铺的参考里，它把注意力聚到「要找的那一类东西」上。在指针里锚**触发**：当同一个词同时活在你的提示词、你的文档、你的代码库里，agent 就会把这种共同语言和那份材料连起来，更可靠地够到它。
- 原文要求主动去找用领头词重构的机会：一个三件套在三个地方被逐字写开、一个指针花一整句话去指一个概念——每一处都是求着你把它压成单个 token 的段落。原文给了两个例子：「fast, deterministic, low-overhead」→ _tight_（一个 _tight_ 循环）；「a loop you believe in」（一个你能信得过的循环）→ _red_——一个含糊的关卡变成一个二值的、看得见的状态（循环在那个 bug 上变 _红_，或者没变）。原文说这样赢两次：token 更少，而且给了 agent 一个更锋利的、挂住思考的钩子。原文还要求：**假定每一份文档里都带着可以用领头词替掉的重复表述，去找出来。**
- **否定（negation）** 是领头词旁边的失败模式：靠禁止来指挥，会把被禁止的行为拖进上下文，让它变得**更可得**，而不是更不可得。原文举例：「别想大象」，结果满脑子都是大象；否定是一个很弱的修饰语，被它旁边那个被强烈激活的概念压过去，于是那条禁令有一半读起来像是在叫你去干那件事。**要写正面的**——直接把目标行为说出来（「写单行注释」），被禁掉的那件事压根不用说出口。一条禁令只有在「实在没法正面表达、要当硬护栏用」时才配留下；即便那样，也要配一个正面目标，好让注意力落在要做的事上。
- **修剪（pruning）** 一节，原文给了四条：
  - 每一个意思只留**一个权威出处**（single source of truth），这样改行为就是改一个地方。**重复（duplication）**——同一个意思出现在不止一个地方——既花维护、又花 token，还会把一个意思在层级上的分量抬到超过它真实的位置。（原文点出：这是领头词的意外反面——领头词是**故意**重复一个 token，从来不重复意思。）
  - **环境本身也是权威出处**：`package.json` 的脚本、配置文件、目录结构、`--help` 的输出。一份复述环境的文档是一层**缓存**：一份对某次查询的拷贝，只有当那次查询本身很贵时，这层缓存才值它的负担。要缓存的是 agent **查不到**的东西：不成文的约定、某个选择背后的理由、任何配置文件都不肯承认的坑。一个文件、一条命令就能查到的，留给环境，那儿它们不会过期。
  - 对每一行查**相关性（relevance）**：它是不是还在对这份文档要做的事起作用？一行失去相关性有两种方式：从来没起过作用（单纯的铺陈，或者一个本该被披露出去的分支），或者它描述的行为和世界变了之后变馊了。文档短一点更容易保持相关。原文警告：没有修剪纪律，默认的归宿是**沉积（sediment）**——陈旧的层一层层沉下来，因为「加进去感觉安全、拿掉感觉冒险」，直到你必须往下一层层钻才能找到还有用的东西。
  - 逐句捉 **no-op（空操作）**：一条指令如果模型默认就已经照做，那它花了负担却什么也没说。检验方法是「**相比默认行为，它改变了行为吗？**」——这个检验是**相对于模型**的，不是相对于读者：两个人吵某句话是不是 no-op，其实吵的是「默认是什么」，这种事靠**跑这份文档**来定，不靠辩论。一句话没过就**整句删掉**，不要在那句里抠字。原文说这个检验也用来给领头词打分：一个弱到打不过默认值的词（agent 本来就还算仔细的时候你写 _be thorough_）就是 no-op，修法是换一个更强的词（_relentless_），而不是换一种技术。

**`SKILL-MECHANICS.md` 里的说法**（写技能的专属分支，用大白话记）：
- **调用方式（invocation）** 有两种选择，代价就是那两种负担的交换：
  - **模型可调用（model-invoked）** 的技能保留 `description`，所以 agent 能自己触发它，别的技能也能够到它。你照样可以打它的名字：**模型可调用总是包含人手动调用**；`description` 只是加上「agent 自己发现」这条路，从不拿走人本来就能走的那条。`description` 是这个技能最顶层的上下文指针，被迫一直加载——用**永久的上下文负担**换可发现性。一份模型可调用的技能如果内容全是参考，它也是共享参考的一个家：别的技能能调它，所以好几个技能都要用的参考，可以只放在这一个地方。做法：不写 `disable-model-invocation`，并且写一个面向模型的 `description`，把触发分支带进去（`SKILL.md` 里那套写指针的规矩完全适用）。
  - **用户可调用（user-invoked）** 的技能把 `description` 从 agent 的可达范围里拿掉：只有人打出它的名字才能调，别的技能也调不了。零上下文负担，但要花认知负担——**你就是那个必须记住它存在的索引**。做法：设 `disable-model-invocation: true`；`description` 变成面向人的——一行摘要，触发清单去掉。
  - 选择标准：只有「agent 必须自己够到它」，或者「另一个技能必须调它」时，才选模型可调用。如果它永远只靠手打，就做成用户可调用，不花上下文负担。
  - 一份共享参考如果两个用户可调用的技能都需要，那它谁那儿都放不了——都没有 `description`，谁也触发不了谁。这时把它推到技能系统之外的普通文件里，变成任何技能都能指过去的外部参考。
  - **按调用方式拆**（拆分的另一种切法，按序列拆在 `SKILL.md` 里）：当你有一个独特的领头词、该由它自己触发这个技能时（一个你真在提示词里用的触发词），或者另一个技能必须够到它时，就拆出一个模型可调用的技能。你要为新技能那个一直加载的 `description` 付上下文负担，所以这份独立的可达性得值这个价。
  - **路由技能（router skills）**：当你手动调用的技能多到记不住时，那堆起来的认知负担的解法就是一个**路由技能**——一个用户可调用的技能，由它点名其他技能、说明每一份什么时候该翻，于是人只需要记一个技能而不是一堆。它**只能提示，永远不能触发**它们：用户可调用的技能没有 `description`，除了人以外谁也够不到。

**跨会话 / 跨代理用法**：**提到了一次，角度是「上下文边界」**。`SKILL.md` 里讲「完成条件」和「什么时候该拆」时写着：想靠藏起后面的步骤来让 agent 在眼前这步多下功夫，**只在真正的上下文边界上才有效**，原文括号里举例就是「a hand-off or a subagent dispatch」——一次**交接**，或者**派一个子 agent**；并且补了一句「an inline call leaves the later steps in context and clears nothing」（在同一个上下文里内联调用，后面的步骤还留在上下文里，什么也没清掉）。

注意：这里的 `hand-off` 是小写带连字符的普通名词，说的是「交接这件事」，**并不是在点名 `/handoff` 这个技能**——本份原文里没有出现任何技能名。但两处显然指的是同一件事（把上下文交给另一段会话）。

**原文里对不上的地方**：
- **和官网这组的口径最不合的一份。** 官网说这组是「Human-facing workflows you run, not about code.」（给人用的工作流，不围着代码转），而 `writing-for-agents` 恰恰是「怎么写**给 agent 看**的文档」的指南，内容全在 `AGENTS.md`、`CLAUDE.md`、技能文件、`package.json` 脚本这些工程语境里。它放在这一组，是官网名单和本地原文之间最明显的一处不一致。
- **它是本组唯一模型可调用的技能**（没有 `disable-model-invocation: true`），另外 5 份都写着 `disable-model-invocation: true`。这一点官网首页没有说。（对照来看：`SKILL-MECHANICS.md` 自己就写了选模型可调用的标准是「agent 必须自己够到它，或者另一个技能必须调它」——一份纯参考、只在人想写文档时才会翻的技能，按它自己的标准更像该做成用户可调用的。）
- `SKILL.md` 说「写技能时去读 `SKILL-MECHANICS.md`」，但 `description` 里的触发条件没把这件事带出来，只说「Use when creating or editing skills...」。也就是说：agent 如果只看了 `description` 就触发它，不会知道还要顺手去读那份配套文件。
- 原文里那句「a hand-off or a subagent dispatch」把「交接」当成一种能清空上下文的边界在用，但本组 `handoff` 的原文完全没接这话——`handoff` 那边既没说自己是「用来清上下文的」，也没说和「藏步骤」这件事有什么关系。两边各说各的，本组里没有把它们连起来的文字。

---

## 本组内部能看出来的工作流

先把话说在前面：**本组 6 个技能之间，原文里写明了的连线只有一条，而且是连到组外的。** 其余任何「谁接谁」的排法，原文都没写，本文件不替它编。

### 唯一一条原文写明的连线

`/grill-me` → `/grilling`（组外）
- **进入**：人手动打出 `/grill-me`。
- **内部**：`/grill-me` 的正文只有一句「Run a `/grilling` session.」，它不自己干活，直接转手。
- **退出**：`/grilling` 会话跑完，产出什么 —— **本组里读不到，原文没写**（内容在 `/grilling` 里，那个技能不在本组）。
- 官网说这组「从 `/grill-me` 开始」，但这句话只到这个转手为止；转手之后这组名单里的下一个是谁，官网和原文都没说。

### 其余能看出来的路（每一条都单独成立，彼此之间原文没有连线）

下面是「从本地原文能辨认出的、可以自己走完的一条路」，**不是**一条串起来的连续流程：

1. **`/grill-me` 起手**：手打 `/grill-me` → 跑一场 `/grilling` → 把计划或设计磨锋利。出什么，本组读不到。
2. **信息在别人手里时走 `/to-questionnaire`**：进入是「你卡在一个自己答不上来的决定上，答案在别人脑子里」。三步走完（收件人是谁 → 你要拿回什么 → 写问卷），退出是**当前目录下多一个 `to-questionnaire-<slug>.md`**，并报告路径。产出物交给**一个人**异步填，或者开会一起填。**拿回答复之后接什么，原文没写。**
3. **没听懂时走 `/wait-what`**：进入是「agent 上一条消息没让人听懂」。退出是 agent 补一点上下文、用简化技术英语、用 `CONTEXT.md` 里的通用语言**重讲一遍**。从写法上看它是「回到上一条消息重来」，是一个原地重启的入口 —— 原文没有用「回到」这样的词，这句是我根据它要求重讲推出来的，**原文没写它之后接什么**。
4. **要换人接手时走 `/handoff`**：进入是「有一个新的 agent 要接手」。退出是**操作系统临时目录里多一份交接文档**（明确不是工作区），里面含当前对话总结、一节建议技能、对别处已有产物的引用，敏感信息已抹掉。下一个会话（新的 agent）拿着它接着干。**接手的人干完之后怎么办，原文没写。**
5. **真正学一样东西走 `/teach`**：进入是「用户开口让教东西，而且打算跨多次会话学」。退出是工作区里铺开 `MISSION.md`、`RESOURCES.md`、`NOTES.md`、`reference/`、`learning-records/`、`lessons/`、`assets/`，然后一节课一节课地走；每节课留一份文件，会话结束时留下 learning record。**这一条是这组里唯一被原文明确写成「跨会话」的路**（「stateful request ... they intend to learn the topic over multiple sessions」），下一步靠读上次留下的文件决定（读 `learning-records`，按 mission 推算最近发展区）。
6. **写文档时翻 `/writing-for-agents`**：进入是「你在新建或修改技能，或者改 `AGENTS.md` / `CLAUDE.md`」。它不产出文件、不产生下一步，是一份「写东西时的规矩」。写技能时它要求再去读配套的 `SKILL-MECHANICS.md`。

### `/handoff` 在这套技能里的位置

**从原文看，它被写成「一条独立的路」，不是「任何走到一半的路都能用的逃生口」。** 理由：

- 它的正文**没有一句说「什么时候该用」**，也没和本组其他任何一个技能接起来。它说的只是一件事：有另一个 agent 要接手时，怎么把当前会话压成一份文档。
- 它没有写成可以插进任何流程的样子。原文里没有「任何走到一半都可以用它」「上下文快满了用它」这类话。
- 唯一的例外是 `writing-for-agents`：那里写着「藏步骤只在真正的上下文边界上才有效（一次 hand-off，或者派一个子 agent）」。这是**别的技能**在讨论「怎么让 agent 在当前这步多下功夫」时顺手把「交接」当成一种上下文边界来用，**不是** `handoff` 自己的说明，两边也没有互相引用。

**原文没说清楚、本文件不替它补的地方**：
- `handoff` 什么时候该用 —— 原文没写。
- 交出去之后做完要不要交回来、怎么交回来 —— 原文没写。仓库负责人举的那个「上下文快满 → handoff 出去 → 新会话做原型 → 做完 handoff 回来」的例子，在本地这 6 个目录里**找不到对应的文字**。
- 交接文档写到操作系统临时目录之后，接手的人怎么找到它 —— 原文没写。
- 「suggested skills」那一节具体该建议哪些技能 —— 原文没写。
- `handoff` 原文提到的那些别处已有产物（规格说明、计划、架构决策记录、issue、提交、差异）由哪些技能产出 —— 本组里查不到。
- 这 6 个技能按什么顺序连成一条路、谁是第二个 —— 除了 `grill-me` → `/grilling` 这一条，原文全没写。
