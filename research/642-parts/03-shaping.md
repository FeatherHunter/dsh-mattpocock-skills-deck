# 官网首页第 03 组 Shaping：wayfinder、prototype、research

官网对这一组的说明是：「Explore an open question and produce a decision/answer that feeds the flow.」（探索一个还没答案的问题，产出一个决定或答案，喂回主干流程。）官网写着从 `/wayfinder` 开始。

本组名单（按官网顺序）：`wayfinder`、`prototype`、`research`。

下面每一条都来自本地随包自带的原文，路径是 `bundled-skills/<技能名>/` 下的全部文件（`agents/openai.yaml` 这类配置文件跳过）。

## wayfinder

**技能名**：`/wayfinder`

**官方一句话**：

> Plan a huge chunk of work — more than one agent session can hold — as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.

中文转述：把一大块工作（大到一次代理会话装不下）规划成 issue tracker 上的一张共享地图，拆成一张张「要做什么决定」的票，一次解决一张，直到通往目的地的路清清楚楚。

**它解决什么问题**：一个还含糊的大想法来了，但从现在的位置到「目的地」的路线还看不清。这个技能负责把路线画出来，而不是直接冲过去把活干了。它管的是「该做什么决定」，不是「把东西做出来」。

**什么时候用它（进入条件）**：原文写了两种进入方式。

- **画地图（Chart the map）**：「User invokes with a loose idea.」用户带着一个松散的想法来调。
- **走地图（Work through the map）**：「User invokes with a map (URL or number).」用户带着一张已有的地图来，给链接或给编号。票是可选的——没给票的时候「you pick the next decision, not the user」，由代理来挑下一个要解决的决定。

原文另外提醒一句：这个技能的头部写着 `disable-model-invocation: true`，也就是不允许模型自己主动发起，得由人来点名。

**用它之后通常接什么**：

- 画地图这条路走到第 6 步就停：「Stop — charting is one session's work; it hand-resolves nothing.」画地图只占一次会话，它自己一张票都不解决。产出物是 issue tracker 上的一张地图 issue（带 `wayfinder:map` 标签）和它的子 issue，也就是票。如果第 2 步广度优先 grill 一遍之后发现根本没有雾（路线本来就清楚、整个旅程一次会话装得下），原文说这时候不需要地图：停下来问用户想怎么办。
- 走地图这条路，每张票的产出是：把答案作为一条 resolution comment 发出去，关闭这张 issue，并往地图的 Decisions-so-far 里追加一行指针。票上冒出来的新问题变成新票（先建后接线），雾里已经能说清的部分毕业成票，越过目的地的关掉并写进 Out of scope。

**它在正文里点名提到的其他技能**：

| 技能 | 算什么 | 原文依据 |
| --- | --- | --- |
| `/setup-matt-pocock-skills` | 引用 | 「The issue tracker should have been provided to you — run `/setup-matt-pocock-skills` if not.」没给 tracker 的时候跑它 |
| `/research` | 调用 | 第一，它是票的四种类型之一（`research`，AFK）；第二，画地图第 5 步「Fire the research subagents」：「For each `research` ticket you just created, spin up a `/research` subagent to resolve it in parallel」 |
| `/prototype` | 调用 | `prototype` 票（HITL）写着做一个便宜、粗糙、能对着反应的具体东西，「or UI/logic code via the /prototype skill」 |
| `/grilling` | 调用 | `grilling` 票是默认类型：「Always invoke the /grilling and /domain-modeling skills.」画地图第 1 步也要跑一次 `/grilling` 和 `/domain-modeling` 把目的地钉死 |
| `/domain-modeling` | 调用 | 和 `/grilling` 成对出现（见上一条）；走地图第 3 步还写着「If in doubt, use `/grilling` and `/domain-modeling`」 |

地图正文模板里还有一行占位「skills every session should consult」，那是 Notes 段落要填的内容，不是具体技能名。

**跨会话 / 跨代理用法**：有，而且这是这个技能的骨架。原样摘出来：

- 「never resolve more than one ticket per session — with the exception of research tickets.」
- 「A session claims a ticket by assigning it to the dev driving the map, first, before any work, so concurrent sessions skip it.」
- 「The whole map at low resolution, loaded once per session.」
- 「The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.」
- 「Every map and ticket is an issue, so it has a name — its title.」一切用名字指代，不用裸编号，人和别的会话都能读
- 「spin up a `/research` subagent to resolve it in parallel, capturing its findings on a throwaway `research/<name>` branch with a context pointer from the ticket.」
- 「This is the one type that does rather than decides... otherwise it hands the human a precise checklist (HITL).」Task 票要么代理自己干，要么给人一份精确的清单

**原文里对不上的地方**：

- 官网首页把 `wayfinder`、`research`、`prototype` 并列放在 03 Shaping 一组，并说从 `/wayfinder` 开始。本地 wayfinder 原文里没有这种并列关系：它把 `research` 和 `prototype` 写成地图上票的两种类型，也就是 wayfinder 在上、另外两个是它内部的手段。官网的并列说法在原文里找不到对应的句子。
- wayfinder 正文里点名的 `/grilling`、`/domain-modeling`、`/setup-matt-pocock-skills` 都不在官网这一组的名单里。
- wayfinder 的头部带 `disable-model-invocation: true`，官网首页没有提到这一点。

## research

**技能名**：`/research`

**官方一句话**：

> Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.

中文转述：对着高可信度的第一手来源把一个问题的答案查出来，把结论写成一个放在仓库里的 Markdown 文件；当用户想让人查一个主题、想收一份文档或 API 事实、或者想把读资料的体力活交给一个后台代理时用它。

**它解决什么问题**：省掉翻一堆官方文档、源码、规范的体力活。派一个后台代理去读，人继续干自己手上的活；读完拿回来的是一份每条结论都写清出处的仓库笔记。

**什么时候用它（进入条件）**：原文的 `description:` 里写着「Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.」也就是用户想查一个主题、想收集文档或 API 事实、或者想把读资料的活交给一个后台代理的时候。正文没有写别的触发条件。

**用它之后通常接什么**：一个 Markdown 文件。原文列的三件事：第一，对着第一手来源查（官方文档、源码、规范、第一方 API），「not a secondary write-up of them. Follow every claim back to the source that owns it.」；第二，把结论写进一个 Markdown 文件，每条结论注明来源；第三，放在仓库本来就放这类笔记的地方，「match the existing convention, and if there is none, put it somewhere sensible and say where.」原文没有写这个文件接下来交给谁。

**它在正文里点名提到的其他技能**：没有点名任何其他技能。整个 `SKILL.md` 只有 12 行，只讲「起后台代理、查第一手来源、写成一份带出处的 Markdown 文件」这三件事。

**跨会话 / 跨代理用法**：有，是它开篇第一句：

> Spin up a background agent to do the research, so you keep working while it reads.

`description:` 里也写着「reading legwork delegated to a background agent」。产物是一份写进仓库的文件，这个形态本身就是给下一个人接着看的东西，但原文没有明说这个文件是交给下一个人接着做，只说了写进仓库、放在约定位置。

**原文里对不上的地方**：

- 官网说这一组是产出一个决定、喂回主干流程。research 的原文只讲到查清楚、写成一份仓库里的 Markdown 文件，没有写这个结论喂回哪个流程，也没有写它和 wayfinder 的关系。这层关系只写在 wayfinder 那一侧（见上面 wayfinder 的点名技能）。
- 它是本组三个技能里正文最短的一个（12 行），官网一行 `description:` 之外没有更多内容可以对照。

## prototype

**技能名**：`/prototype`

**官方一句话**：

> Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.

中文转述：做一个用完就丢的原型来回答一个设计问题；当用户想验证一个状态模型或逻辑「感觉对不对」，或者想探索界面该长什么样时用它。

**它解决什么问题**：有些设计问题在纸上看着都合理，只有真的按着按钮走一遍，才会发现「这不对」。这个技能用一次性的、丢掉不心疼的代码，把这类问题快速问出一个答案。

**什么时候用它（进入条件）**：用户想验证一个状态模型或逻辑对不对，或者想探索 UI 该长什么样。原文要求先分清问的是哪个，因为两条分支产物完全不同，选错就白做了：

- 问「这段逻辑 / 这个状态模型感觉对吗」→ 读 `LOGIC.md`：一个独立的 HTML 文件，带自由按的按钮和分标签的引导走查，非开发人员也能自己按。
- 问「这东西该长什么样」→ 读 `UI.md`：在同一个路由上生成若干个结构上差异很大的 UI 变体，用 URL 查询参数（`?variant=`）和屏幕底部的一个悬浮小条切换。
- 问题真的两边都像、用户又联系不上：默认选更贴近周围代码的那条（后端模块 → 逻辑；页面或组件 → 界面），并把这个假设写在原型最上面（「state the assumption at the top of the prototype」）。

**用它之后通常接什么**（原文写明的收尾动作）：

- 「Fold any validated decision into the real code.」把验证过的决定折进真代码。
- 原型本体当成第一手来源留下来：「commit it to a throwaway branch, out of main, and leave a context pointer to that branch on the implementation issue.」提交到一个一次性分支（离开 main），并在实现那张 issue 上留一个指向该分支的关联指针。
- 答案也要留：「Capture the answer too — the verdict and the question it settled — in the issue or a commit.」
- 「The main branch keeps only the validated decision.」main 分支上只留那个验证过的决定。
- 两条分支各有更细的收尾。逻辑分支里，纯模块（reducer / 状态机 / 一组纯函数）抬进真模块，HTML 外壳跟着去一次性分支（`LOGIC.md` 第 58 行）。界面分支里，胜出的变体折进真页面或提升成真正的路由，落选变体和切换条从 main 上删掉，整套变体留到一次性分支（`UI.md` 第 100 到 105 行）。

**它在正文里点名提到的其他技能**：`SKILL.md` 本身没有点名任何别的技能，只指了同目录的两个参考文件 `LOGIC.md` 和 `UI.md`，而且两者互相指认：「If the question is "what should this look like" — wrong branch. Use UI.md.」和「If the question is about logic/state rather than what something looks like — wrong branch. Use LOGIC.md.」。注意方向：wayfinder 会点名 prototype，prototype 从不回头点名 wayfinder。

**跨会话 / 跨代理用法**：有，而且写得挺多，原型天生就是给别人异步按的东西。原样摘出来：

- 「you can hand it to a non-developer — a designer, a PM, a domain expert — and let them feel the model for themselves.」（`LOGIC.md`）
- 「make the question explicit so it can be checked later, whether the user is watching now or returning to it AFK.」（`LOGIC.md`）
- 「Send them the file, or open it for them. They'll click through the walkthroughs and free-play whenever they get to it.」（`LOGIC.md`）
- 「Surface the URL (and the `?variant=` keys). The user will flip through whenever they get to it.」（`UI.md`）
- 交付形态本身就是为了传给别人：「everything inline so it opens by double-click and survives being emailed around」（`LOGIC.md`）
- 留痕给下一个人：「leave a context pointer to that branch on the implementation issue」（`SKILL.md`）；「variant components and the switcher left in the main branch rot fast and confuse the next reader」（`UI.md`）

**原文里对不上的地方**：

- 官网这一组写着从 `/wayfinder` 开始，但 prototype 的原文（`SKILL.md`、`LOGIC.md`、`UI.md` 都是）完全没提 wayfinder，也没说自己是「被 wayfinder 派出来的一张票」或「产物要回到那张地图」。这层关系只写在 wayfinder 那一侧。
- 本地比官网多内容：官网只有一行 `description:`，本地这里有 `SKILL.md` 加两个分支参考文件（`LOGIC.md` 67 行、`UI.md` 112 行），把逻辑分支和界面分支的具体做法写得非常细，官网没有体现这两个分支。

## 本组内部能看出来的工作流

先说结论：原文里能确认的只有一条主路（wayfinder 自己的两个模式），加上两条被它派出去的分支（research、prototype）。research 和 prototype 之间没有先后关系，原文没写。

### 主路：wayfinder 画地图，然后 wayfinder 走地图

1. **进入**：人带着一个松散的大想法，调 `/wayfinder` 的画地图模式。
2. **钉住目的地**（画地图第 1 步）：跑一次 `/grilling` 加 `/domain-modeling`，把这张地图要通向的目的地定死——它可能是一份要交出去迭代的 spec、一个动手规划前必须先锁的决定、或者一个就地做的改动（例如数据结构迁移）。原文说目的地决定了范围，所以先定它。
3. **画出前沿**（画地图第 2 步）：再 grill 一次，这次广度优先，把整个空间铺开，找出还没定的事和现在就能迈的第一步。**出口检查**：如果这一遍发现没雾——路线本来就清楚、整个旅程一次会话装得下——就「你不需要一张地图」，停下来问用户想怎么办。
4. **建地图**（画地图第 3 步）：建一个带 `wayfinder:map` 标签的 issue，填好 Destination 和 Notes，Decisions-so-far 空着，把已知的雾草草写进 Not yet specified。
5. **建票、再接边**（画地图第 4 步）：把现在就能说清的票建出来，作为地图的子 issue；然后第二遍才接阻塞关系，因为 issue 要拿到编号才能互相引用。接完，票就分成了前沿（能拿的）和被阻塞的，说不太清的全部留在雾里。
6. **并行起 research 代理**（画地图第 5 步）：给刚刚建的每一张 `research` 票起一个 `/research` 子代理，并行去解决，结论记在一个一次性分支 `research/<name>` 上，票上留一个关联指针。
7. **出口**：第 6 步直接停——画地图只占一次会话，它自己一张票都不解决。交出去的东西是地图加一串票。
8. **第二次进入**：另一次会话（人或代理）带着这张地图回来，调走地图模式。载入的是低分辨率的地图，不是每张票的正文。
9. **选票加认领**（走地图第 2 步）：用户点名了就用他点的那张；没点名就取前沿里的第一张。动手之前先认领——把票 assign 给自己，别的并行会话就会跳过它。
10. **解决**（走地图第 3 步）：按需展开相关票（包括已经关掉的）的完整正文；跑地图 Notes 里点名的技能；拿不准就用 `/grilling` 加 `/domain-modeling`。
11. **记录**（走地图第 4 步）：答案是 resolution comment，然后关 issue，再往地图的 Decisions-so-far 追加一行指针（答案只有一份，就放在票上，地图只放摘要加链接）。
12. **推进前沿**（走地图第 5 步）：新冒出来的问题建新票再接线；答案让雾里某块能说清了就毕业成票，并从那一段雾里删掉；如果发现某张票（这张或别的）已经越过目的地，就把它关掉并写进 Out of scope，不要在路线上解决它；这个决定让地图别处失效的，就更新或删掉那些票。
13. **退出**：「never resolve more than one ticket per session — with the exception of research tickets.」一次会话只解决一张票，research 票除外。

### 主路派出去的分支一：research（查资料）

- **进入**：wayfinder 画地图第 5 步，为每张 `research` 票起一个 `/research` 子代理。另外，`description:` 里写了「用户想查主题、想收文档或 API 事实、想把读资料的活交给后台代理」时可以用它——这是原文写在 description 里的使用条件，但正文没有写不经 wayfinder 时它自己怎么收尾。
- **处理**：对着第一手来源查，每条结论追到拥有它的那个来源。
- **退出**：一个 Markdown 文件，每条结论带出处，放在仓库已有的约定位置。
- **回到主路**：wayfinder 那一侧写了结论怎么回——「capturing its findings on a throwaway `research/<name>` branch with a context pointer from the ticket.」；research 自己的原文没有写任何回程。

### 主路派出去的分支二：prototype（做原型）

- **进入**：wayfinder 的 `prototype` 票（HITL，适用于「该长什么样」或「该怎么表现」是关键问题的时候）。另外，`description:` 里写了用户想验证状态模型或逻辑、想探索界面时可以用它。
- **处理**：先分清是逻辑问题（读 `LOGIC.md`）还是界面问题（读 `UI.md`），照着那一条分支做；原型从第一天起就明确标成一次性的东西，放在将来真正会用它的代码旁边。
- **退出**：把验证过的决定折进真代码，原型本体提交到一次性分支、在实现 issue 上留指针，答案（结论和它回答的问题）记在 issue 或提交里。main 上只留那个决定。
- **回到主路**：wayfinder 那一侧说这张票解决时把原型的资产链到票上（「Assets created while resolving a ticket are linked from the issue, not pasted in.」）；prototype 自己的原文没有写回程。

### research 和 prototype 之间的先后

**原文没写。** 两个技能的 `SKILL.md` 里都没有出现对方的名字；wayfinder 正文把它们写成票的两种并列类型，只给了各自的适用判断（需要当前工作目录以外的知识 → research；「该长什么样」或「该怎么表现」是核心问题 → prototype），没有写「先 research 再 prototype」或「遇到查资料就用 research，遇到设计问题就用 prototype」这样一句统摄的话。research 票还能在地图刚画完时就并行开跑，而 prototype 票要等人参与（HITL），所以原文里能看出的只是两者可以同时存在于一张地图上、各自独立解决，先后关系原文没写。

### 三个技能一起看，原文没说清楚的地方

- **整体顺序**：官网把三个技能并成一组的第 03 组 Shaping，本地原文里没有这个分组概念；wayfinder 是唯一的入口技能，另外两个只作为它的票类型出现。
- **「喂回主干流程」具体喂回哪**：官网这么说，但三个 `SKILL.md` 都没有写主干流程是谁。prototype 写到折进真代码，wayfinder 写到该有人去做那件事了（「nothing left to decide before someone goes and does the thing... the signal you've reached the edge of the map and it's time to hand off.」），research 只写到写一份文件。这三个说法之间原文没有把它们连起来。
- **research 和 prototype 能不能不用 wayfinder 单独用**：两个技能的 `description:` 都写了自己的适用条件，看起来能单独用；但原文没有写不经过 wayfinder 时它们怎么收尾，只有 wayfinder 那一侧写了收尾方式（票上留指针、资产链到 issue）。
