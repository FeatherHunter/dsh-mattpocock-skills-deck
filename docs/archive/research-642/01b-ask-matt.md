# /ask-matt

## 技能名

`/ask-matt`

本地原文位置：`C:/Users/辰辰洋洋/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/bundled-skills/ask-matt/SKILL.md`（同一目录下另有 `PHASE-BOUNDARIES.md`）

## 官方一句话

原文（`SKILL.md` 头部 YAML 的 `description:` 一行，照抄）：

> Ask which skill or flow fits your situation. A router over the skills in this repo.

中文转述：不知道该用哪个技能时，问它——它把这套技能里的所有技能按「流程」串成一张地图，告诉你当前处境该走哪一条；它是这套技能内部的**路由器**。

同一段 YAML 里还有一行 `disable-model-invocation: true`：意思是这个技能不由模型自动触发，要人来点名调用。原文头部 YAML 三行如下（照抄）：

```
name: ask-matt
description: Ask which skill or flow fits your situation. A router over the skills in this repo.
disable-model-invocation: true
```

## 它解决什么问题

技能太多，人记不住每一个，也不知道手上这件事该从哪个技能开始、下一步接哪个。这个技能就是那张「我该用哪个」的对照表：先判断你现在处在哪种处境（有新想法要做、有 bug 要修、有一堆别人提的 issue、有一大团看不清的活儿、只是想让代码结构变好），再顺着对应的路线把该用的技能一个个点出来。

## 什么时候用它（进入条件）

原文只在标题下一句话里给了触发时机：

> You don't remember every skill, so ask.

即「你记不住每个技能，所以问」。原文没有写更具体的进入条件（比如什么关键词、什么场景下必须用），也**没有写「什么时候不要用它」**。

可以算作反面线索的一条是 `disable-model-invocation: true`：它明说了这个技能**不是模型自己判断该用就去用的**，要人主动调用。

## 它怎么工作

它是路由。原文的核心结构是把全部技能分成「一条主干 + 两个入口 + 若干旁支」，按**你手头这件事的性质和规模**来分发。

### 原文里的三句判断线索

1. **你有没有一个工作目录（working directory）？**——决定「面试类」技能用哪个：有仓库 → `/grill-with-docs`（会留下 `CONTEXT.md` 和 ADR 的记录）；没有仓库 → `/grill-me`（不留任何本地记录，无状态）。
2. **能不能靠对话把问题问清楚？**——如果某个问题需要「跑起来才能有答案」（状态、业务逻辑、必须眼见为实的界面），就要绕道去做原型。
3. **这活儿是不是要跨好几个会话才能做完？**——是 → 先出规格、再拆票、再逐票实现；不是 → 就在当前上下文里直接实现。

### 原文画出的路线

**主干：想法 → 交付（idea → ship）**

1. `/grill-with-docs`——用访谈把想法磨清楚。
2. 分支：能不能全部靠对话定下来？有需要跑起来才知道答案的问题，就中途绕去原型，两头都用 `/handoff` 搭桥：`/handoff` 出去 → 开一个**新会话**对着那份文件干活 → `/prototype` 用抛弃型代码回答问题 → `/handoff` 把学到的带回来，并让原来的想法线索引用它。
3. 分支：是不是多会话的工程？
   - 是 → `/to-spec`（把线索变成一份规格），再 `/to-tickets` 拆成「曳光弹」式的小票，每张票写明它的**阻塞边**。本地 issue 跟踪器上就是 `.scratch/<feature>/issues/` 下一个票一个文件、人工按「先做阻塞方」的顺序推；真跟踪器上这些边会变成原生的 blocking 链接，于是任何「阻塞方都做完」的票都可以抓起来做——每张票启动一次 `/implement`，**每张之间要 `/clear` 上下文**。
   - 否 → 就地 `/implement`，同一个上下文窗口里做完。
   - 两条路都一样：`/implement` 内部靠驱动 `/tdd` 来做每一张票（一次一个红—绿切片），收尾时跑 `/code-review`（对 diff 做两个维度的评审：标准 + 规格），然后才提交。

**上下文卫生（Context hygiene）**

- 第 1 到第 3 步要保持**同一个不中断的上下文窗口**，在 `/to-tickets` 之前不要压缩也不要清空，让磨想法、写规格、拆票都建立在同一套思考上。
- 每一次 `/implement` 都是全新开始，靠那张票工作。
- 限制来自「smart zone」（原文链接到 aihero.dev 的 AI coding dictionary）：大约 15 万 token，模型在这个窗口内还思考得锋利。如果还没到 `/to-tickets` 就快撑满了，不要在退化状态下硬推——在最近的**阶段边界**处 `/compact` 再继续。

**两个入口（On-ramps）**：先产生活儿，再并到主干上。

- **bug 和需求堆积** → `/triage`。它把 issue 推过各个 triage 角色、产出「agent 可直接接手」的 issue，之后由 `/implement` 接手。边界：triage **只处理不是你创建的 issue**（bug 报告、外部来的功能请求、一切原始到来的东西）；`/to-tickets` 产出的票本身已经是 agent-ready，**不要再去 triage 它们**。
- **有东西坏了** → `/diagnosing-bugs`。用于难啃的那些：一眼看不出的、时有时无的、两个已知良好状态之间溜进去的回归。它坚持在拿到**紧的反馈闭环**（一条已经能对这个 bug 报红的命令）之前不许空想理论，然后带回归测试地修掉。它的复盘在发现「根本没有好的接缝能把 bug 锁住」时，会交给 `/improve-codebase-architecture`。
- **一大团看不清的活儿**（绿地项目、一次会话装不下的巨型功能）→ `/wayfinder`，原文称它是这里**认知负担最重**的一条流程。看不清从这儿到终点怎么走时，它在 issue 跟踪器上画出一张**共享地图**，由**决策票**组成，一次解决一张——产出的是**决策，不是交付物**——直到雾被推开、路变清楚。它和 `/grill-with-docs` 的分界是：你一次会话里抱得住的想法用 `grill-with-docs`，抱不住的才用 wayfinder；它更慢也更密，所以只留给这种，绝不要用在范围清楚的功能上。
- wayfinder 的收尾：**它交接，不建设**。地图清明之后要并到主干上的 `/to-spec`，由它把地图上互相链接的决策收拢成一份可建设的计划，然后照常 `/to-tickets`、`/implement`。把地图直接接进 `/implement` 会跳过这次收拢、把链式细节扔掉——只有在事情其实很小的时候才直接去 `/implement`。

**代码库健康（Codebase health）**：不是做功能，是养护。

- `/improve-codebase-architecture`——有空就跑去跑，让代码库对 agent 更容易操作。它浮出**可加深之处**；挑一个就**产生一个想法**，可以带去主干上的 `/grill-with-docs`。它是找出候选者的勘测；`/codebase-design` 才是在选中的那个上面做设计的台子。

**底下的词汇层（Vocabulary underneath）**：两个由模型自行调用的参考，跑在其它技能**底下**，各自是自己那套词汇的唯一出处。当问题出在**词**上而不是流程上时直接去找它们，或者让上面的技能把它们拉进来。

- `/domain-modeling`——磨项目**领域**的说法：挑战一个含糊的词、拆掉一个被过度负载的词（比如 "account" 同时干三份活）、把难以逆转的决定记成 ADR。它是 `/grill-with-docs` 驱动的那门主动纪律，用来让 `CONTEXT.md` 保持一份干净的词表。
- `/codebase-design`——深模块的那套词汇（module、interface、depth、seam、adapter、leverage、locality），用来设计一个模块的**形状**：在一个干净的接缝上，用小接口盖住大量行为。`/tdd` 和 `/improve-codebase-architecture` 都说这套话。

**阶段边界（Phase boundaries）**

原文定义：一个**阶段**是一次会话里的一坨活儿（磨想法、实现、QA）。在两个阶段的**边界**上有五个选项，原文说「在这里挑哪个是整张地图上最含糊的决定」：

- **Continue**——就待着不动。不花成本，也不丢东西。
- `/clear`——把窗口清空，当这里的一切对下一步都不重要时用。
- `/handoff`——写一份可携带的 markdown 文件。窄：只用于**新 harness**、**新目录**、**同事**，或者**阶段中途**分叉出的支线任务。它买到的是可携带性。
- **Subagent**——把一个范围很紧的任务送到它自己的窗口，然后拿一份报告回来。
- `/compact`——压缩当前上下文，再用它开一个新会话。是**默认项**，在决策树的底部，而不是第一个伸手去拿的。

原文指向 `PHASE-BOUNDARIES.md`（见本文下方「阶段边界：来自 PHASE-BOUNDARIES.md 的补充」一节），说明那里有排好序的决策树、五个问题、每个分支背后的理由，以及为什么「一手资料的成本」让 **Continue 成为第一个该排除的选项**。并给出一条纪律：决定要**在边界上**做；如果是阶段中途，就继续、或者把剩下的部分拆给 subagent。

**独立使用（Standalone）**：完全不在主干上。

- `/grill-me`——和 `/grill-with-docs` 同样 relentless 的访谈，但是**无状态**：不往本地存东西，也不建 `CONTEXT.md`。当你**不在工作目录里**时用它——磨一个计划、一个设计、一篇文字，任何下面没有仓库的东西。如果你在工作目录里，就该用 `/grill-with-docs`。
- `/grilling`——访谈原语本身：轮次、前沿（frontier）、事实归 agent 管、决定归你管。`/grill-me` 和 `/grill-with-docs` 是两个具名入口，`/triage`、`/wayfinder`、`/improve-codebase-architecture` 都在内部跑它。只有当你想不带任何包装地做这场访谈时才直接用它。
- `/resolving-merge-conflicts`——把进行中的 merge 或 rebase 冲突一个 hunk 一个 hunk 地处理，按**意图**（追溯到两侧各自的一手资料）解，而不是按挑哪几行来解，然后把这个操作收尾。它永远不跑 `--abort`。独立、且不在任何流程上：你已经卡在冲突里时才伸手用它。
- `/prototype`——一个小而抛弃型的程序，回答一个设计问题：这个状态模型感觉对不对，或者这个界面该长什么样。「抛弃型」是对代码怎么写的一个约束，不是承诺要销毁它：答案会折进真实代码，原型本身作为**一手资料**保留在从 main 分出的 `prototype/<name>` 分支上，并由实现那张票指向它。它是主干第 2 步里的绕道，但任何「在纸上难以定下来的设计问题」都可以随时伸手用它。
- `/research`——把读资料的腿脚活交给**后台 agent**：它针对**一手资料**调查一个问题，然后在仓库里留下一份带引用的 Markdown 文件。它读的时候你可以继续干活。它产出的文件是要**带进**主干上的 `/grill-with-docs` 的——研究喂思考，不替代思考。
- `/to-questionnaire`——当卡住你的东西不在你脑子里、也不在代码库里，而**在别人脑子里**时，它替你写一份问卷给对方填。它是 `/grill-me` 的反面：不是访问你关于这个题目，而是访问你关于**这次发送**（发给谁、你要拿回什么），把问题对准那个缺口。拿回来的东西是 `/grill-with-docs` 或 `/to-spec` 的材料。
- `/wizard`——给只有**人**能做的步骤：开基础设施、配凭据或 CI secret、在一个不熟悉的第三方后台里点来点去、跑一次性的迁移或切换。它生成一个交互式 bash 脚本，逐个打开 URL、逐个捕获取值，写进 `.env` 和 GitHub secrets——这样这套流程就不再是需要反复向 agent 解释的东西了。模型可自行调用，所以 agent 一撞上只有你能过的墙就会去拿它。如果 agent 自己能做，它就该自己做；这是留给「人确实在环里」的地方。
- `/wait-what`——给「没听懂/没落地」的消息用的纠偏。在任何其它技能里、对话中途使用，agent 就会用你缺的那点上下文、用平实的英语、用 `CONTEXT.md` 的词汇，把刚才说过的话重新讲一遍。它是事后补救；`/grill-with-docs` 才是前置的解药，因为早早上桌的共同语言才能从根上挡住行话。
- `/teach`——跨多个会话学一个概念，把当前目录当有状态的工作区。
- `/writing-for-agents`——写「给 agent 看的文档」时的参考：技能、AGENTS.md、被指向的文档。

**前置条件（Precondition）**

- `/setup-matt-pocock-skills`——在第一次走工程流程之前先跑，配好 issue 跟踪器、triage 标签和文档布局，其它技能都假设这些已经就位。自定义的 issue 跟踪器也能用。

## 它点名提到的其他技能

下面按原文出现顺序列出**每一个**被点名的技能/命令，并注明它是在什么情境下被提到的。

| 技能名 | 出现情境 | 类型 |
| --- | --- | --- |
| `/grill-with-docs` | 主干第 1 步，推荐「在有工作目录时从这里开始」；有状态，把学到的留在 `CONTEXT.md` 和 ADR 里；与 `/grill-me` 对比说明边界；也是 `/research` 产出和 `/improve-codebase-architecture` 产出的去处；`/wait-what` 条目里作为「前置解药」被对比 | 推荐使用 + 说明边界 |
| `/grill-me` | 主干第 1 步的括号里作为「没有工作目录时」的替代；`Standalone` 一节里正式说明它与 `/grill-with-docs` 的区别 | 说明边界 |
| `/handoff` | 主干第 2 步，绕道做原型时「两个方向」的桥；`Phase boundaries` 一节作为五个选项之一，并说明它「窄」的适用面 | 推荐使用 |
| `/prototype` | 主干第 2 步的绕道；`Standalone` 一节再次给出独立用法；与 `/handoff` 配套 | 推荐使用 + 举例 |
| `/to-spec` | 主干第 3 步「是多会话工程」时的第一步；也是 `/wayfinder` 地图清明后的并入口；也是 `/to-questionnaire` 产出材料的去处 | 推荐使用 |
| `/to-tickets` | 主干第 3 步，把规格拆成曳光弹式小票；上下文卫生里说明「在它之前不要压缩/清空」；triage 条目里说明它产出的票不要再去 triage | 推荐使用 + 说明边界 |
| `/implement` | 主干第 3 步两条分支的收敛点；由 `/triage` 产出物接续；`/wayfinder` 条目里说明「什么时候可以跳过 `/to-spec` 直接用它」 | 推荐使用 + 说明边界 |
| `/clear` | 主干第 3 步多会话分支里「每张票之间清上下文」；`Phase boundaries` 里作为五个选项之一 | 推荐使用 |
| `/tdd` | `/implement` 内部驱动它，一次一个红—绿切片；也被建议独立使用（只想先测后建某个具体行为、没有完整规格时） | 推荐使用（含独立用法） |
| `/code-review` | `/implement` 收尾时跑，两个维度的评审（Standard + Spec）；也被建议独立使用（想评审某个分支或 PR 相对某个固定点） | 推荐使用（含独立用法） |
| `/compact` | 上下文卫生：接近 smart zone 时「在最近的阶段边界处 `/compact`」；`Phase boundaries` 里是被列为**默认**的选项 | 推荐使用 |
| `/triage` | On-ramps：bug 和需求堆积时进；并明确划边界——只管不是你创建的 issue | 推荐使用 + 说明边界 |
| `/diagnosing-bugs` | On-ramps：有东西坏了时进；说明它坚持先要反馈闭环 | 推荐使用 |
| `/improve-codebase-architecture` | `/diagnosing-bugs` 复盘的交接对象；`Codebase health` 一节的主条；也提到它内部跑 `/grilling`、说 `/codebase-design` 的词汇 | 推荐使用 + 说明边界 |
| `/wayfinder` | On-ramps：一大团看不清的活儿；与 `/grill-with-docs` 划边界；收尾要交接给 `/to-spec` | 推荐使用 + 说明边界 |
| `/domain-modeling` | `Vocabulary underneath`：领域语言的词汇层；被 `/grill-with-docs` 作为主动纪律驱动 | 说明边界（词汇层，可被拉进来） |
| `/codebase-design` | `Vocabulary underneath`：深模块词汇层；`/tdd` 与 `/improve-codebase-architecture` 都说这套话；`Codebase health` 里与它分工（勘测 vs 设计台） | 说明边界（词汇层，可被拉进来） |
| `/grilling` | `Standalone`：访谈原语本身；说明它被 `/grill-me`、`/grill-with-docs` 具名入口使用，也被 `/triage`、`/wayfinder`、`/improve-codebase-architecture` 在内部跑 | 说明边界 + 举例 |
| `/resolving-merge-conflicts` | `Standalone`：已经在合并/变基冲突里时用 | 推荐使用（独立） |
| `/research` | `Standalone`：把读资料的活交给后台 agent；产出带引用的 markdown；产出要带进 `/grill-with-docs` | 推荐使用（独立） |
| `/to-questionnaire` | `Standalone`：卡点在别人脑子里时；与 `/grill-me` 作反向对比 | 推荐使用（独立） |
| `/wizard` | `Standalone`：只有人能做的步骤；模型可自行调用 | 推荐使用（独立） |
| `/wait-what` | `Standalone`：消息没落地的纠偏；与 `/grill-with-docs` 作前后对比 | 推荐使用（独立） |
| `/teach` | `Standalone`：跨会话学一个概念 | 举例（一句话带过，无进一步说明） |
| `/writing-for-agents` | `Standalone`：写给 agent 看的文档时的参考 | 推荐使用（独立） |
| `/setup-matt-pocock-skills` | `Precondition`：第一次走工程流程之前先跑 | 前置条件（必跑） |

原文里被点名但**不是技能**的两项，为免下游误当技能，单列：

- **Subagent**——不是斜杠技能，是 `/ask-matt` 描述的一个选项：把范围很紧的任务送到它自己的窗口去。
- **smart zone**——不是技能，是原文外链到 aihero.dev 的一个概念（约 15 万 token 的有效思考窗口）。

补充：读完 `PHASE-BOUNDARIES.md` 后确认，那个文件**没有引入任何新的技能名**——它只用 `/clear`、`/handoff`、`/compact` 三个斜杠命令，其余两个选项是 Continue 和 Subagent，与上表一致。所以上表就是 `/ask-matt` 点名技能的全集（26 个斜杠名，其中 `/ask-matt` 本身不计）。

## 跨会话 / 跨代理用法

有提到，而且分散在好几处：

- **换一个新会话**（主干第 2 步，绕道做原型时）：`/handoff` 出去，然后 **open a fresh session against that file**——对着那份文件开一个新会话。
- **换一个新会话**（阶段边界）：`/compact` 的定义就是「压缩这段上下文，再用它开一个新的（fresh）会话」；`Continue` 一栏里也出现「nothing here matters to what's next」的措辞。
- **每张票之间清上下文**（主干第 3 步）：kick off `/implement` per ticket, **`/clear`ing context between each one**；理由是每张票自包含，上一张的上下文可以丢弃。上下文卫生里进一步说每一次 `/implement` 都是 fresh start。
- **交给另一个 agent / 别的窗口**：`Phase boundaries` 里的 **Subagent** 选项——把范围很紧的任务送到它自己的窗口，拿一份报告回来；以及「mid-phase 时，继续、或把剩下的拆给 subagents」。
- **交给另一个人**：`/handoff` 的适用面里明确有 **a colleague**（同事）；`/to-questionnaire` 是写给「别人」填的问卷。
- **写文件给下一个人读**：`Phase boundaries` 里 `/handoff`——**write a portable markdown file**（写一份可携带的 markdown 文件），买到的是可携带性；适用面是「new harness、new directory、colleague、或阶段中途分叉支线」。
- **换 harness（换一套 agent 工具）**：`PHASE-BOUNDARIES.md` 第 3 问把条件写得更具体——swapping to a **new harness**（Claude → Codex）。这是 `/handoff` 存在的理由之一。
- **把带上下文的新会话种起来**：`PHASE-BOUNDARIES.md` 第 5 问——`/compact` 是「压缩这段上下文、用摘要**种**一个 fresh session」，并且可以**给它一句指令**（原文例子：`/compact we're going to QA this area`），让摘要保留下一阶段需要的东西。
- **清空后旧会话还能回去**：`PHASE-BOUNDARIES.md` 第 2 问——`/clear` **不是终结性的**，旧会话仍然可以恢复（resumable）。
- **无人值守地交给另一个窗口**：`PHASE-BOUNDARIES.md` 第 4 问——任务范围内的紧到「你离开键盘（AFK）也能跑、不需要人 steering」时，就送去 **subagent**，本会话原封不动；原文点名的标准例子是自动化评审。
- **后台 agent**：`/research` 把读资料的腿脚活交给 background agent，人继续干活，产物是一份留在仓库里的带引用 markdown。
- **跨会话学习的技能**：`/teach` 明说「learn a concept over multiple sessions」。

## 与官网对不上的地方

官网首页把 `/ask-matt` 放在 **01 Getting Started** 那一组，一句话是 **"Find out which skill to use for the situation you are in."** 本地文件与这个说法的出入：

1. **本地确实有另一条更靠前的路。** 原文末尾单列了 `Precondition`：`/setup-matt-pocock-skills`「run before your first engineering flow」——第一次走工程流程之前先跑。也就是说按原文，Getting Started 的第一件事是配置 issue 跟踪器、triage 标签和文档布局，`/ask-matt` 是配置完之后用的地图，而不是起点本身。官网把它归在 01 Getting Started 里，会让人以为它是第一个该点的东西。
2. **本地明写它不由模型自动触发。** `disable-model-invocation: true`。官网只说「Find out which skill to use」，读起来像是一个随时会被拉起来的入口；本地文件则要求**人**主动点名，模型不会自己判断该用就去用。
3. **本地把范围限定在「this repo」。** YAML 的 `description` 原文是 "A router over the skills in **this repo**."（加粗为整理者所加）。官网的说法是「你所在的处境该用哪个技能」，没有限定到某个仓库。
4. **本地多了「flow（流程）」这个概念。** 官网只说 find out which **skill**；本地描述是 which **skill or flow**，正文也以 flow 为单位组织（主干、入口、旁支、词汇层），而不是一份平铺的技能清单。官网首页的措辞里看不到这层结构。
5. **本地只有一处像「判定流程」，而且它管的是阶段边界，不是「你该用哪个技能」。** 官网的说法暗示它会根据你描述的处境来回答。原文只给了三句判断线索（有没有工作目录、能不能靠对话定下来、是不是多会话），其中真正的判定树在 `PHASE-BOUNDARIES.md` 里——按顺序问五个问题、第一个 yes 就赢——但那是「在一个阶段的边界上该不该换上下文」的判定，不是「我这种情况该用哪个技能」的判定；而且该文件末尾自己承认这些问题「不是客观的」，同一个边界不同日子可能有两个答案。所以，从本地这两份文件看不出它有一套稳定的「处境 → 技能」判定法，更多是按图索骥。

另需注明（不属于官网口径差异，但下游排「工作流清单」时会撞上）：本会话可见的技能目录里，确实有一批与原文对得上的名字（`grilling`、`prototype`、`research`、`resolving-merge-conflicts`、`wizard`、`writing-for-agents`、`domain-modeling`、`codebase-design`、`tdd`、`code-review`、`diagnosing-bugs`）；但原文里另有一批名字在本会话技能目录里**没有**对应条目，例如 `/grill-with-docs`、`/grill-me`、`/wayfinder`、`/to-spec`、`/to-tickets`、`/implement`、`/handoff`、`/triage`、`/setup-matt-pocock-skills`。本次整理按要求**没有**去读本目录之外的任何技能文件，所以这些名字是原文这样写的、还是有本地对应物，本文不作判断，留给下游核实。

---

## 阶段边界：来自 PHASE-BOUNDARIES.md 的补充

`SKILL.md` 只给了五个选项的名字和一句话说明，`PHASE-BOUNDARIES.md` 给出的是「按顺序问问题、第一个 yes 就停」的决策树。这个文件**没有引入任何新技能名**，只在已有的五个选项里补细节。

### 阶段和边界的定义

- **阶段（phase）**：一次会话里的一坨活儿——磨想法、实现、QA。原文说这个定义**故意是模糊的**：当你想「好，这个弄完了」的时候，一个阶段就结束了。
- **阶段边界**：两个阶段之间的空隙，而且原文强调这是这个决定**唯一该待的地方**。半路（mid-phase）没有决定可做——要么继续，要么把剩下的活拆给 subagent。原话：**在半路压缩会让 agent 丢掉线索（正在想的那条线）。**

### 决策树：从上往下问，第一个 yes 就赢

1. **你能不能在这次会话里继续做？** 两个理由可以说 yes：下一阶段需要这一阶段当**一手资料**，或者你剩下的 smart zone（约 15 万 token）够装下一阶段。原文点名「磨想法 → 实现」是标准的 yes：实现要的是这份推理的**原文**，不是它的摘要。结论：Continue 不花成本也不丢东西，所以**先排除它**，再考虑别的。
2. **这段上下文对后面要做的事是不是无关？** 这次会话里的一切（探索、决定、走错的路）是不是都可以扔？如果是，就 `/clear`。原文说它是**这盘棋上最便宜的一步**：不花时间，整个窗口还回来。另外 `/clear` 不是终结性的——旧会话仍然可以恢复。
   - 判断错的代价是**单向**的：把一个**有用的**上下文清掉了，你就丢了「当初为什么要这么做」的那层**为什么**，事后怎么读 diff 都读不回来。
3. **你需要交接吗？** 原文说 `/handoff` 是**窄**的，只在下面这四种情况下需要：
   - 换到**新的 harness**（原文举例：Claude → Codex），
   - 换到**新的目录**或仓库，
   - 把活交给**同事**，
   - 或者在阶段中途发现了一个支线任务、要分叉它、又不想把手上正做的事带歪。
   - 原文补一句：**这份清单（加起来）就是全部的适用条件。** `/handoff` 买到的是**可携带性**——一份能到处走的文件。如果没有东西要「走」，就不需要它。
4. **这件事能不能在无人值守（AFK）下做完？** 范围是不是紧到「你离开键盘、不需要人 steering」也能跑完？那就把它送给 **subagent**，本次会话一点不动。原文说**自动化评审是标准例子**：agent 读 diff、写报告，它做这件事的过程中不需要你。
5. **否则，`/compact`。** 上下文有用、harness 一样、目录一样，而且你得留在环里——这就是树落地的地方，而且**它经常落在这里**。可以**给它一句指令**（原文例子：`/compact we're going to QA this area`），让摘要保住下一阶段需要的东西。
   - 原文再强调一次：`/compact` 是**默认项，不是第一个伸手去拿的**。它待在底部，是因为它上面那四个问题要么更便宜、要么更精确。**人们一上来就用它时的失败模式是：新会话对某个被摘要压平了的决定自信地做错。**

### 一手资料 / 二手资料

- 除了 **Continue** 以外的每一个动作，都在把一份**一手资料**变成**二手资料**——把「事情本来是怎么发生的」的那次会话，换成关于它的一份摘要。
- 原文给的权衡表（照抄结构）：

| 资料 | 信息 | 噪声 | 可动的余地 |
| --- | --- | --- | --- |
| 一手（Continue） | 全 | 多 | 少 |
| 二手（`/compact`、`/handoff`） | 有损 | 少 | 多 |

- 这也就是为什么第 1 问排在最前面：只有「留下来」的代价比它省下的还大时，你才付这份有损的代价。

### 原文自己承认这是判断

最后一段：这些问题**不是客观的**，每一个里面都有品味（taste）的成份，**同一个边界在今天和明天可能走向两个不同的答案**。价值在于**按顺序**问它们，并且在**边界上**问，而不是在干活干到一半的时候问。

### 这一节对「跨会话 / 跨代理用法」的追加

这一节是目前我读到的原文里**最集中讲跨会话、跨代理的那一段**：换 harness、换目录、交同事、中期分叉都归 `/handoff`；无人值守给 subagent；`/compact` 是把摘要种进新会话（还可以带一句指令）；`/clear` 之后旧会话还能回得去。见上文「跨会话 / 跨代理用法」一节。
