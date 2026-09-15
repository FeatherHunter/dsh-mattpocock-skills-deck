# 04 Upkeep（官网首页第四组：让代码库与议题列表保持健康）

资料来自插件自带的本地权威原文（只读），路径：`C:\Users\辰辰洋洋\.dsh\profiles\web\node_modules\dsh-mattpocock-skills-deck\bundled-skills\` 下本组五个技能目录。每个技能下面按同一组项目逐项写清，最后另附一节本组内部的工作流接口。

---

## 1. `/improve-codebase-architecture`

**技能名**：`/improve-codebase-architecture`

**官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

> Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.

中文转述：扫一遍代码库，找出「可以把浅模块加深」的机会，把它们做成一份可视化的 HTML 报告给你看，然后针对你挑中的那一条，用不断追问的方式把方案聊透。

**它解决什么问题**：代码库被切成一堆浅模块——接口跟实现差不多复杂，改一个概念要在好几个小文件之间来回跳，测试也没有合适的下手地方。这个技能专门把这些「别扭」的地方找出来，并提出来怎么改。

**什么时候用它（进入条件）**：原文没写自然语言的触发时机。本地 `SKILL.md` 的 YAML 里写了 `disable-model-invocation: true`，也就是只能由人手动唤起，不能凭一句话自动触发。正文里另写了扫描范围怎么定：用户指名了方向（某个模块、某个子系统、某个痛点）就按用户说的来；没指名就翻一段提交历史（`git log --oneline`）找出改动最密集的地方，让这些路径先吸引注意力；如果改动很分散、看不出热点，就把网撒大一点。

**用它之后通常接什么**：写一份 HTML 报告——报告写到操作系统的临时目录，不落进仓库，用 `xdg-open`／`open`／`start` 打开，并把绝对路径告诉用户；报告结尾要给一段「最推荐先做哪一条」。报告写完、接口还没提，先问用户一句「Which of these would you like to explore?」。用户挑定之后，进入第 3 步 Grilling 环节，跟用户一起走决策树。整个技能以「下一步交给 `/grilling`」收尾，产出物是报告和使用者的选择。

**它在正文里点名提到的其他技能**：

- `/codebase-design`——**引用**（拿它的架构词汇和原则，原文要求建议里严格用这套词，不许换成 component、service、API、boundary；另有一处是**调用**：想给加深后的模块试几种不同接口时，跑这个技能里的「设计两遍」并行子代理套路）。
- `/grilling`——**调用**（用户选定候选之后跑它，跟用户一起过约束、依赖、模块形状、接缝后面放什么、哪些测试能留下来）。
- `/domain-modeling`——**调用**（决定逐渐成形时当场跑它，把新概念写进 `CONTEXT.md`、把模糊的词当场改清楚、必要时提议记一条 ADR）。
- 另外正文点名了 `CONTEXT.md` 和 `docs/adr/` 这两处文件（不是技能），要读，也要顺手更新。

**跨会话 / 跨代理用法**：没有「换一个新会话」的写法，也没写「写一份文件给下一个人接着做」。有一处代跑：第 1 步让一个子代理去走代码库（"Then spawn a sub-agent to walk the codebase"）；还有一处并行子代理——用 `/codebase-design` 的 design-it-twice 模式起并行子代理，同时试几种备选接口。

**原文里对不上的地方**：本地 `SKILL.md` 比官网那句一句话说明少内容，而且缺的是官网最看重的部分。官网说这一组「从 `/improve-codebase-architecture` 开始」，本地没有这句先后关系的说法，也没有「产出一份重构清单（backlog）交给主干流程、被别人领走」这一步：本地只做到给报告、用户挑一条、当场进 grilling，随后怎么交给别的技能，原文没写。

---

## 2. `/diagnosing-bugs`

**技能名**：`/diagnosing-bugs`

**官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

> Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.

中文转述：针对难修的 bug 和性能退化的诊断循环。用户说「diagnose」「debug this」，或者说某个东西坏了、报错、失败、变慢时使用。

**它解决什么问题**：难修的 bug 和性能退化，往往卡在「没有可靠的判断信号」上，人只能盯着代码猜。这个技能先把「造出一个能变红的判断信号」这一步做扎实，之后才允许往下推理。

**什么时候用它（进入条件）**：YAML 的 `description` 里写了——用户说「diagnose」「debug this」，或者报告某个东西坏了、报错、失败、变慢时用它。正文另写一条纪律：循环没造出来之前，不要开始读代码编理论（"jumping straight to a hypothesis is the exact failure this skill prevents"）。有一个前提要先做：探索代码库时读 `CONTEXT.md`（如果存在），并查看所碰区域的 ADR。

**用它之后通常接什么**：先产出一个「反馈循环」（第 1 阶段，本技能的重点），再依次是复现并最小化、给 3–5 条可证伪的假设、定向插桩（性能问题走单列的测量与二分分支）、先写回归测试再修、最后清理与复盘。第 6 阶段的收尾是交接：如果复盘答案是「这个 bug 本来可以靠架构避免」（没有好的测试接缝、调用方纠缠、隐藏耦合），就把具体情况交给 `/improve-codebase-architecture` 技能，并且要在修完之后再给这个建议。固化的产出物还有几样：最小化后的回归测试、把真正正确的假设写进 commit／PR 信息（让下一个调试的人看到）、删掉所有带标记的调试日志（用前缀 `grep` 清理）、删掉一次性原型。

**它在正文里点名提到的其他技能**：

- `/improve-codebase-architecture`——**调用**（第 6 阶段的明确交接，原文用 "hand off to the `/improve-codebase-architecture` skill with the specifics"）。
- `scripts/hitl-loop.template.sh` 这个脚本文件——**引用**（造循环的第 10 种办法，人必须在环里时的最后手段）。
- 另外正文点名了 `CONTEXT.md`、ADR、以及 commit／PR 信息（不是技能）。

**跨会话 / 跨代理用法**：没有「换一个新会话」这种写法，也没有「写一份文件交给下一个人接着做」。有两处跨代理／跨人的安排：一是反馈循环的完成标准里明确要求「agent-runnable」——「你可以无人值守地运行它；人只在环里时只能通过 `scripts/hitl-loop.template.sh`」；二是第 6 阶段要求把正确的假设写进 commit／PR 信息，「so the next debugger learns」（让下一个调试的人学到），这算是把结论交给后来的人。

**原文里对不上的地方**：这一条官网上没有可对照的说法，只有本地 YAML 里的一句英文说明；本地文件内容很完整，没看到比官网少的迹象。唯一要留意的是：YAML 里的触发条件写的是「用户说 diagnose／debug，或者报告东西坏了、报错、失败、变慢」，而它实际会接手的是「难修的 bug 和性能退化」这种定位，触发面比适用范围宽。

---

## 3. `/resolving-merge-conflicts`

**技能名**：`/resolving-merge-conflicts`

**官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

> "Use when you need to resolve an in-progress git merge/rebase conflict."

中文转述：当你需要处理一个正在进行中的 git 合并或变基冲突时使用。

**它解决什么问题**：合并或变基已经卡在冲突上，得有人把每个冲突块判清楚、改对、再把流程走完，而不是中途放弃。

**什么时候用它（进入条件）**：YAML 里写了——需要解决一个正在进行中的 git 合并／变基冲突时用它。正文没有另外写触发条件，进入时机的判断就靠「git 正处于合并或变基状态」这一点。

**用它之后通常接什么**：产出一个走完了的合并或变基——冲突全部解决、项目的自动化检查（一般是先类型检查、再测试、后格式化）跑过、改动暂存并提交；如果是变基，就要继续推进到所有提交都变基完成。整个技能只有 5 个编号步骤，没有写「之后交给谁」。

**它在正文里点名提到的其他技能**：一个都没提。

**跨会话 / 跨代理用法**：没提到。

**原文里对不上的地方**：本地文件比官网首页给的信息少得多。官网首页的组说明是一句话概括，本地 `SKILL.md` 全文只有 5 条编号步骤、14 行，没有交代进入时机以外的协作方式，也没有产出物归谁、冲突该往哪个方向判（除了「按合并自身的目标来选，并写明取舍」这一条原则）。哪一步交给哪个技能来做，原文也没写。

---

## 4. `/triage`

**技能名**：`/triage`

**官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

> Move issues and external PRs through a state machine of triage roles — categorise, verify, grill if needed, and write agent-ready briefs.

中文转述：把议题和外部 pull request 推过一个「分诊角色状态机」——先分类，再核验，必要时深入追问，最后写出能被 agent 直接领走的简报。

**它解决什么问题**：维护者需要一眼看清「哪些议题在等自己」，把要交给 AI agent 的活整理成有明确边界、有验收标准、有排斥范围的简报，免得 agent 接到活还得来回问。已经做过的功能会被认出来（不被重复立项），被拒过的请求会留下记录。

**什么时候用它（进入条件）**：两个明确的入口。一是维护者主动唤起 `/triage`，用自然语言说自己想干什么，原文给了四个例子：「Show me anything that needs my attention」「Let's look at #42」（issue 或 PR 都行）「Move #42 to ready-for-agent」「What's ready for agents to pick up?」。二是不用开口的入口：查询议题库后，把三种东西按时间旧到新列出来——从未分诊过的（没标签）、处于 `needs-triage` 的、以及标记为 `needs-info` 但报告人上次分诊记录之后又有新活动的；让维护者挑。另外本地 YAML 里写了 `disable-model-invocation: true`，只能由人手动唤起。如果仓库把外部 PR 也当作请求入口（看议题库配置），这些 PR 同样进入分诊：原文的说法是「PR 就是带代码的议题」，同一套角色、同一套状态，只有少量差异标为 "for a PR"；一个光秃秃的 `#42` 到底指 issue 还是 PR，按议题库配置来解析。

**用它之后通常接什么**：按结果分几种产出：移到 `ready-for-agent` 时，在议题上贴一条 agent brief 评论；移到 `ready-for-human` 时，结构跟 agent brief 一样，但要写明为什么不能委托出去（判断类决策、外部权限、设计决策、需要人工测试）；`needs-info` 时按模板贴分诊记录（把已经谈定的事写进 "What we've established so far"，把还没解决的问题写成具体、可回答的提问）；`wontfix` 时关闭，并分三种情况处理——已经实现就指出功能现在在哪、不要写进 `.out-of-scope/`，被拒的功能请求要写进 `.out-of-scope/` 并从评论里链接过去，被拒的 bug 只给礼貌说明然后关闭。还有一条快速通道：维护者说「把 #42 移到 ready-for-agent」就照做、跳过追问，只在「移到 ready-for-agent 但没经过追问」时问一句要不要写 agent brief。分诊过程中发的每条评论或议题都必须以声明开头：`> *This was generated by AI during triage.*`。

**它在正文里点名提到的其他技能**：

- `/grilling`——**调用**（第 4 步「需要把请求谈清楚时」跑它）。
- `/domain-modeling`——**调用**（同一步，跟 `/grilling` 一起跑，边问边把领域词写清、当场更新 `CONTEXT.md`／ADR）。
- `/setup-matt-pocock-skills`——**引用**（原文只说标签映射本该已经给你了，没给就跑这个命令；这个名字不在本组五个技能里，本地这个目录下也没有它）。
- 另外点名了三份参考文件（不是技能）：同目录的 `AGENT-BRIEF.md`、同目录的 `OUT-OF-SCOPE.md`、以及议题库配置。

**跨会话 / 跨代理用法**：有，这是本组里写得最明确的一处。

- 交给另一个代理接着做：agent brief 的定位就是「一条贴在 GitHub 议题或 PR 上的结构化评论，在议题移到 `ready-for-agent` 时贴出。它是一份权威说明，供一个无人值守（AFK）的 agent 照着做。原议题正文和讨论只是背景材料，agent brief 才是契约。」原文明确要求它「耐久优先于精确」：议题可能在 `ready-for-agent` 待上几天甚至几周，期间代码库会变，所以 brief 要写接口、类型、行为契约，不要写文件路径和行号（会过期）。
- 换一个新会话接着做：原文专门有一节「Resuming a previous session」——如果议题或 PR 上已有之前的分诊记录，读出来，看报告人有没有回答掉还没解决的问题，先把更新后的情况摆出来再继续，不要重复问已经解决的问题。
- 「写一份文件给下一个人接着做」：`.out-of-scope/` 这个知识库就是给后来人看的（为什么一个功能被拒、同一个请求被提过多少次），配套的 `OUT-OF-SCOPE.md` 还专门写了文件格式与写作标准。

**原文里对不上的地方**：官网首页把这一组说成「按仓库自己的标签体系走」，本地 `SKILL.md` 用的是五个正统角色名，并且明确写了「实际标签字符串可能不一样，映射本该已经给你了，没给就跑 `/setup-matt-pocock-skills`」——也就是说，本地原文并不能保证仓库里真的就有叫 `ready-for-agent` 这个标签。另外官网说这一组从 `/improve-codebase-architecture` 开始，分诊这一步被验证成真 bug 之后交给谁，本地原文没写（见下一节）。

---

## 5. `/wizard`

**技能名**：`/wizard`

**官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

> Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself.

中文转述：生成一个交互式的 bash 向导弹脚本，一步一步带着人做那些只有人才能做的操作。用在准备基础设施、配置凭据或 CI secret、在陌生的第三方控制台里点来点去、或者做一次性的数据迁移或切换的时候。不要去用它处理 agent 自己能做的步骤。

**它解决什么问题**：有些手工流程每次都得重新给 AI 讲一遍，讲着也累；这个技能把这些流程做成一个会自己开网页、告诉你点哪里、把抄回来的值写进 `.env` 和 CI secret 的脚本，人只负责点。

**什么时候用它（进入条件）**：YAML 里写了四类场景——准备基础设施、配置凭据或 CI secret、在陌生的第三方控制台里操作、做一次性的迁移或切换；同时写了反面条件：agent 自己能做的步骤不要用它。正文另有一层进入标准：这个技能本身不描述流程内容，它先替你把要人做的步骤和要采集的值理清楚（第 1 步），确认清单之后才动手写脚本。

**用它之后通常接什么**：产出一份 bash 脚本——把一个写好的模板（`template.sh`）复制到目标位置，把示例阶段换成一步一步的真实阶段，脚本顶部的总阶段数要跟实际阶段数对得上；里面那种「好用的界面」已经由模板解决了，作者只需要确定流程范围和写各个阶段。脚本默认是一次性的：为一个这次要跑的任务而做，存到临时目录或 `scripts/` 路径下，做完就删；只有在用户希望这是一条可重复的初始化路径、该留在仓库里时，才提交它。收尾动作是交付使用方式并做静态检查——跑 `bash -n` 看语法、有 `shellcheck` 就跑一下、`chmod +x` 加上可执行权限；不要自己从头到尾跑一遍（它会开浏览器、会卡在人输入上），改成静态核对：第 1 步列出的每个值都被采集并且落到了第 1 步说好的位置，每个写进 GitHub 的 secret 名字都能对到 CI 里的 `secrets.*`。如果是可重复的初始化路径，提交它并从 README 链接过去，好让下一个人直接跑脚本，而不是再来问 AI。

**它在正文里点名提到的其他技能**：正文没有点名提到任何别的技能（只反复点名 `template.sh` 这个同目录模板文件，属于引用，不是技能）。

**跨会话 / 跨代理用法**：没提到「换一个新会话」，也没提到「交给另一个 agent」。唯一的交汇点是 YAML 里那句反面条件——「不要去用它处理 agent 自己能做的步骤」。原文另有一处是面向下一个人（人，不是代理）的：如果是可重复的初始化路径，就提交脚本并从 README 链接过去，让下一个人跑脚本而不用再问 AI。

**原文里对不上的地方**：这一条官网上没有可对照的说法。要看的是它和同组其他技能的定位差别：`/wizard` 产出的是给人执行的脚本，而 `/triage` 产出的是给无人值守代理执行的简报，两者面向的对象刚好相反，本地原文里两边都没有互相引用。

---

## 本组内部能看出来的工作流

先说明一点：这五个技能原文都没有把自己写成一条从头到尾的流水线，能看出来的接口主要是下面三条，其中只有第一条是原文里明确写明的交接。

**接口一：`/diagnosing-bugs` 修完之后交给 `/improve-codebase-architecture`（明确写了）。**
谁产出什么：`/diagnosing-bugs` 的第 6 阶段要求复盘「这个 bug 本来可以靠什么避免」，如果答案是架构层面的（没有好的测试接缝、调用方纠缠、隐藏耦合），就把具体情况**移交**给 `/improve-codebase-architecture`。交给谁、什么时候给也写明了：要在修完并上完回归测试之后再用这个技能，不要在修之前提，因为那时掌握的信息比一开始多。另一个方向没有写：`/improve-codebase-architecture` 的报告里如果挑出一条重构，产出是报告加用户的选择，随后进 `/grilling`，原文没有说要把结果交回 `/diagnosing-bugs` 或任何别的技能。

**接口二：`/triage` 是主干的入口，产出是「可以被 agent 领走」的简报（本组里唯一直接面向另一个代理的产出）。**
谁产出什么：`/triage` 把议题推过状态机，产出物按状态分四种，其中 `ready-for-agent` 那一种是贴在议题上的 agent brief——原文称它为「一个无人值守的 agent 将照着做的权威说明……原议题正文与讨论只是背景，agent brief 才是契约」。交给谁：topic 上没写是哪一个技能，只写着给「一个 AFK 的 agent」，并且特别要求写耐久一点（不写文件路径、不写行号），因为议题可能在那里等好几天甚至几周，中间代码库会变。中途它还会调用 `/grilling` 和 `/domain-modeling` 一起把请求谈清楚，并当场更新 `CONTEXT.md`／ADR。要说清一点：`/triage` 的「核验」只是自己复现 bug、跑相关测试看主张站不站得住，它并不修 bug，原文也没有说核验出的 bug 后续接给哪个技能——这条接口原文没写。

**接口三：`/wizard` 站在主干旁边，产出给人用的脚本。**
谁产出什么：`/wizard` 产出的是一个 bash 向导弹脚本（加上它的静态核对结论），脚本走的是「只有人能做的步骤」，默认一次用完即删，只有用户希望它是可重复的初始化路径时才提交进仓库并从 README 链接。它和主干流程的接口原文没写——没说脚本跑完之后哪一步接着走，也没说这组里的哪个技能会用到它配出来的值（只有脚本本身的写法要求把值写进 `.env` 和 GitHub 的 secret／variable）。

**这组里看不出来的东西**：谁唤起 `/improve-codebase-architecture` 的扫描、以及扫完那份 HTML 报告之后除了当场 grilling 还通向哪里，原文都没写；`/triage` 核验成立的真 bug 该交给谁修，原文没写；`/resolving-merge-conflicts` 完全不与其它四个发生引用关系，谁在冲突时唤起它、做完之后回到哪条主线，原文也没写。另外，`/triage` 和 `/wizard` 都在 YAML 里标了 `disable-model-invocation: true`（`/improve-codebase-architecture` 也标了），这三个都只能由人主动唤起；`/diagnosing-bugs` 和 `/resolving-merge-conflicts` 没有这个标记，可以靠自然语言的触发条件被唤起。
