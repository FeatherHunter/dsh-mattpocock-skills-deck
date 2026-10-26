# 02 The Main Flow —— 从想法到交付的主干

- 整理范围：本地随包自带的五个技能目录，分别是 `grill-with-docs`、`to-spec`、`to-tickets`、`implement`、`code-review`。每个目录下只有一个 `SKILL.md` 和一个 `agents/openai.yaml`，按要求只读了 `SKILL.md`，没有别的参考文件。
- 官网对这一组的说法：The idea→ship spine, in order.（这是一条有顺序的主干，从想法走到交付），并写明从 `/grill-with-docs` 开始。
- 下面每个技能都按同一组小标题逐项写，「原文没写」就是本地文件里确实找不到。

## 逐个技能

### /grill-with-docs

- **技能名**：`/grill-with-docs`
- **官方一句话**：原文是 `description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.` 中文转述：用一场不放松的追问把一个方案或设计问清楚，问的过程中顺手把架构决策记录（ADR）和术语表一起写下来。
- **它解决什么问题**：脑子里只有一个含糊的方案时，靠追问把边界、取舍问明白；同时把问出来的决策和说法落成文档，免得以后没人记得当初为什么这么定。
- **什么时候用它（进入条件）**：原文没写。YAML 里有 `disable-model-invocation: true` 这一行，意味着它不会被模型自己判断触发，只能由人显式点名。
- **用它之后通常接什么**：原文没写。
- **正文点名提到的其他技能**：
  - `/grilling` —— 调用。正文全文只有一句「Run a `/grilling` session」，即这个技能本身不做追问，而是开一场 grilling。
  - `/domain-modeling` —— 调用。同一句话里的「using the `/domain-modeling` skill」，即追问的同时用这个技能来维护术语和决策记录。
- **跨会话 / 跨代理用法**：没提到。
- **原文里对不上的地方**：YAML 的 `description` 说它会「creates docs (ADR's and glossary)」，但正文只有那一行转发，没有任何流程、产出物清单或结束条件。官网把这一棒放在主干最前面，本地正文却看不出它往后接谁；这一条主干的第一段衔接（`/grill-with-docs` → `/to-spec`）在它自己的文件里完全没有出现。

### /to-spec

- **技能名**：`/to-spec`
- **官方一句话**：原文是 `description: Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed.` 中文转述：把当前这次对话整理成一份规格说明并发布到项目的 issue tracker 上，不再访谈用户，只把已经聊过的内容综合起来。
- **它解决什么问题**：想法聊完了却散在对话里，谁也没法拿它当准绳；这个技能把对话沉淀成一份能发布、能照着做的规格说明。它明确不做访谈（「Do NOT interview the user」），所以适用于已经聊得差不多的时候。
- **什么时候用它（进入条件）**：正文写明前提是「This skill takes the current conversation context and codebase understanding and produces a spec.」——手上已经有一段对话上下文、也了解代码库现状时用它。另有一句前置条件：「The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.」也就是说，issue tracker 和 triage 标签词汇应该已经提供给你，没有就先跑 `/setup-matt-pocock-skills`。除这些之外，触发词和触发时机原文没写。
- **用它之后通常接什么**：正文写明：按模板写好的 spec「publish it to the project issue tracker」，并「Apply the `ready-for-agent` triage label - no need for additional triage.」（打上 `ready-for-agent` 标签，不需要再做额外分诊）。发布之后接哪个技能，原文没写。
- **正文点名提到的其他技能**：
  - `/setup-matt-pocock-skills` —— 调用（前置）。缺 issue tracker 配置时先跑它。
  - `prototype` —— 引用。正文在说明 spec 模板时写「if a prototype produced a snippet that encodes a decision more precisely than prose can」，允许把原型产出的片段贴进规格里。这里用的是普通名词 prototype，不是 `/prototype` 这样的技能调用写法。
  - 正文还提到要使用项目的 domain glossary（领域术语表）和尊重 ADR，但没有点名 `/domain-modeling` 这个技能。
- **跨会话 / 跨代理用法**：没提到。正文虽然要求「把当前对话综合成 spec」，但没有出现「换一个新会话」「交给另一个 agent」这类说法，也没写「这份文件给下一个人接着做」。
- **原文里对不上的地方**：官网说这一组「有顺序」，本地这一支却读不出前后关系——`description` 和正文都没有提到 `/to-tickets`，也没有写它由谁触发。也就是说官网意义上的「上一棒 grill-with-docs、下一棒 to-tickets」，在本地文件里两头都缺。

### /to-tickets

- **技能名**：`/to-tickets`
- **官方一句话**：原文是 `description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in one file per ticket locally, or native blocking links on a real tracker.` 中文转述：把一份计划、一份规格说明或当前这段对话拆成一组「曳光弹」小票，每张票写清它被哪些票挡住，然后发布到配置好的 issue tracker 上；如果在本地就用「一票一个文件、把依赖写成文字」的形式，如果在真实 tracker 上就用平台原生的阻塞关系。
- **它解决什么问题**：方案或规格说明的颗粒度太大，没法直接动手。这个技能把它切成一张张能独立跑通一条完整路径的小票，并写清先后依赖，让每张票的体量适合一次专注的工作。
- **什么时候用它（进入条件）**：正文写明「Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.」——即手上已有对话上下文，或用户直接给了引用（一份 spec 的路径、一个 issue 编号或链接），给了引用就要把它的正文和评论读全。前置条件和 `/to-spec` 相同：「The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.」。探索代码库这一步原文标成可选（「### 2. Explore the codebase (optional)」）。除此之外触发时机原文没写。
- **用它之后通常接什么**：正文写明产出物随 tracker 配置不同有两种形状：
  - 本地文件 —— 在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md` 下一票一个文件，从 `01` 开始按依赖顺序编号（先被挡住的排前面），每个文件的「Blocked by」写清它依赖哪几号票。
  - 真实 issue tracker（GitHub、Linear 等）—— 按依赖顺序一票一个 issue 发布，用平台原生的阻塞关系或子 issue 关系，没有这种关系就把被依赖的 issue 写进「Blocked by」；打上 `ready-for-agent` 标签（除非另外交代）。
  另外原文明确要求：不要关闭或修改任何父 issue（「Do NOT close or modify any parent issue.」）。发完票之后接哪个技能，原文没写——它没有点名 `/implement`，只有一句「Work the frontier: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.」（先做那些阻塞都清空的票；纯线性链就是从第一张往下做），这句像是在给执行的人指路，但没说交给哪个技能。
- **正文点名提到的其他技能**：
  - `/setup-matt-pocock-skills` —— 调用（前置）。正文写明发布方式取决于它配置好的 tracker。
  - `prototype` —— 引用。结尾关于模板的说明里同样写「if a prototype produced a snippet that encodes a decision more precisely than prose can」，允许贴原型片段。
  - 没有点名 `/to-spec`，虽然输入里明确包含 spec；也没有点名 `/implement`。
- **跨会话 / 跨代理用法**：有一句沾边的，但只是体量要求：垂直切片的规则里写「Each slice is sized to fit in a single fresh context window.」（每张票的体量要能塞进一个全新的上下文窗口）。这句把「新上下文」当成切票的尺子，但没有写「换一个新会话去做」「把活交给另一个 agent」。正文其余部分也没有这类说法。
- **原文里对不上的地方**：官网把这一棒排在主干中间，本地这一支读不出前后来路——输入只写成「a plan, spec, or conversation」这样的普通说法，没有写「来自 `/to-spec`」；输出也只停在「发布成票」，没有写「交给 `/implement`」。

### /implement

- **技能名**：`/implement`
- **官方一句话**：原文是 `description: "Implement a piece of work based on a spec or set of tickets."` 中文转述：按一份规格说明或一组小票，把这份活实际做出来。
- **它解决什么问题**：规格和小票都有了，缺一个明确的执行动作——把代码改出来、自己先验证一遍、提交，再送去评审。
- **什么时候用它（进入条件）**：原文没写触发时机。YAML 里有 `disable-model-invocation: true`，需要人显式点名。正文能看出的前提是「the user 描述的那份 spec 或那组 tickets 已经在手上」。
- **用它之后通常接什么**：正文把这几个动作都写明了（原文顺序）：「Use /tdd where possible, at pre-agreed seams.」——尽量在事先商量好的接缝上用 `/tdd`；「Run typechecking regularly, single test files regularly, and the full test suite once at the end.」——经常跑类型检查、经常跑单个测试文件，最后跑一次全量测试；「Once done, use /code-review to review the work.」——做完之后用 `/code-review` 审查；「Commit your work to the current branch.」——把改动提交到当前分支。所以它的产出物是当前分支上的一次提交，收尾动作是交给 `/code-review`。
- **正文点名提到的其他技能**：
  - `/tdd` —— 调用。条件是「where possible, at pre-agreed seams」（在事先约定好的接缝处，能这么做就这么做）。
  - `/code-review` —— 调用。做完之后必须交给它审查。
  - 没有点名 `/to-spec` 或 `/to-tickets`，只写了「spec or tickets」这样的普通说法。
- **跨会话 / 跨代理用法**：没提到。
- **原文里对不上的地方**：本地全文只有 15 行，除上面那几句外没有任何别的交代——没有写触发时机、没有写什么时候算做完、没有写评审发现问题怎么办。官网把它当作主干第四棒，本地没写它的输入来自 `/to-tickets`，所以「to-tickets → implement」这一段衔接在本地文件里是空的。

### /code-review

- **技能名**：`/code-review`
- **官方一句话**：原文是 `description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes — Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".` 中文转述：从用户指定的一个固定点（某次提交、某个分支、某个 tag 或合并基点）开始审查改动，分两条线看——Standards 线看代码有没有守住这个项目写下来的编码规范，Spec 线看代码有没有忠实实现当初那个 issue 或规格说明；两条线各起一个并行子代理，最后并排呈现。用户想审查一个分支、一个 PR、手头还没完成的改动，或者说「review since X」这类要求时用它。
- **它解决什么问题**：一次改动可能「处处守规矩但做错了事」，也可能「事情做对了但把项目约定破了」。两条线分开跑并分开报，避免一条线的问题把另一条线遮住。
- **什么时候用它（进入条件）**：`description` 里写了触发时机：「Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".」正文第 1 步写明固定点由用户给（「Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, ask for it.」），用户没说就直接问。另外，它是本组五个技能里唯一没有 `disable-model-invocation: true` 的一个，也就是说它允许被模型判断后自动调用。前置条件只针对 Spec 线：「The issue tracker should have been provided to you — run `/setup-matt-pocock-skills` if `docs/agents/issue-tracker.md` is missing.」
- **用它之后通常接什么**：正文写明产出和收尾方式是：第 5 步把两份报告并排呈现（「Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings」），最后加一行总结——每条线各有多少条发现、每条线各自最严重的问题是什么；不要跨线挑一个总的赢家，因为那样正是两条线分开所防止的事。报告给出之后要做什么、发现问题要不要回头改，原文没写。
- **正文点名提到的其他技能**：
  - `/setup-matt-pocock-skills` —— 调用（前置）。当 `docs/agents/issue-tracker.md` 不存在时先跑它。
  - 另外反复出现的是「parallel sub-agents」（并行子代理）这个概念：第 4 步要求一次性并行开两个子代理，并交代「the sub-agent has no other access to it」（子代理看不到别的上下文，所以要把它需要的东西都贴进去）。这不是点名别的技能，而是这个技能自己用子代理干活的方式。
  - 没有点名 `/implement`，全文没有出现实现类的技能名。
- **跨会话 / 跨代理用法**：有，写得最明确的一处就是它。原文：「Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.」（两条线各跑一个并行子代理，免得互相污染上下文，最后本技能汇总它们的发现。）第 4 步还写明每个子代理该收到哪些材料：完整的 diff 命令和提交列表、找到的规范来源清单（Standards 线还要把正文里那 12 条 Fowler 味道基线全文贴进去，因为子代理看不到别的地方）、以及各自的报告要求。此外第 2 步说明了如果找不到来源规格说明怎么问用户，找不到时「the **Spec** sub-agent will skip and report "no spec available"」。
- **原文里对不上的地方**：官网把它当作主干最后一棒，本地正文里看不出它接在谁后面（没有提到 `/implement`），也没有写评审之后有没有回头路。这一点比别的几个更值得记：主干的收尾到底是不是「评完就完」，本地原文没给答案。

## 本组内部能看出来的工作流

先说要紧的一句：官网首页写着这一组「in order」（有顺序），但本地这五个文件里，只有一处衔接是明写的，就是「`/implement` 做完交给 `/code-review`」。另外三处衔接——`/grill-with-docs` → `/to-spec`、`/to-spec` → `/to-tickets`、`/to-tickets` → `/implement`——在任何本地文件里都没有点名，属于官网说法和本地正文对不上的地方。

按官网顺序，逐步的输入、产出、结束点和回头路如下：

1. **`/grill-with-docs`**
   - 输入：一个还不够清楚的方案或设计（原文只说是「a plan or design」）。
   - 产出：被追问打磨过的方案，以及追问过程中写下的 ADR 和术语表。这两样只出现在 YAML 的 `description` 里，正文没有展开。
   - 走到哪一步算结束：原文没写。
   - 回头路：原文没写。

2. **`/to-spec`**
   - 输入：当前的对话上下文，加上对代码库现状的了解；开写之前要先探一遍仓库（「Explore the repo to understand the current state of the codebase, if you haven't already.」），并在规格里沿用项目术语表、尊重相关 ADR。
   - 中途的一个卡点：第 2 步要求先画出准备在哪里测试这个功能的接缝（seam），接缝优先用已有的、优先挑最高处、越少越好（「The fewer seams across the codebase, the better - the ideal number is one.」），然后「Check with the user that these seams match their expectations.」（跟用户确认这些接缝符合预期）。
   - 产出：按模板写好的规格说明（问题陈述、解决方案、尽量长的一串用户故事、实现决策、测试决策、不在范围内的事、补充说明），发布到项目 issue tracker，打上 `ready-for-agent` 标签。
   - 走到哪一步算结束：原文没有单独写「结束」，但流程最后一步就是发布出去，发布即这一棒收尾。
   - 回头路：只有上面那句「跟用户确认接缝」，属于这一步内部的核对，不是回到上一个技能。

3. **`/to-tickets`**
   - 输入：一份计划、一份规格说明，或当前这段对话；用户也可以直接给引用（spec 路径、issue 编号或链接），给了就要把它的正文和评论读全。探索代码库这一步标成可选，并提到可以顺手做 prefactor（先把改动变容易，再做那个容易的改动）。
   - 产出：一组曳光弹小票，每张都切穿所有层（schema、API、界面、测试）且能单独验证，并且写清它的阻塞边（被哪些票挡住）。发布形状二选一：本地就是 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，一票一个文件、从 `01` 起按依赖顺序编号；真实 tracker 就是一票一个 issue、按依赖顺序发布、用平台原生阻塞关系或写在「Blocked by」，并打上 `ready-for-agent` 标签。另外原文要求不要关闭或修改任何父 issue。
   - 走到哪一步算结束：第 4 步先把拆法作为编号清单摆给用户看（每张票的标题、被谁挡住、它交付什么端到端行为），问三件事——颗粒度是否合适、阻塞关系是否正确、有没有该合并或再拆的；「Iterate until the user approves the breakdown.」（反复到用户认可为止），然后第 5 步发布完成。
   - 回头路：有，但只在这一步内部循环——用户不认可就重新拆，直到认可。没有回到 `/to-spec` 的写法。
   - 另一条原文提到的推进方式：「Work the frontier: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.」（先做阻塞都清空了的票，纯线性链就是从第一张往下做。）这句是在指挥按票推进，但原文没有点名把它交给 `/implement`。

4. **`/implement`**
   - 输入：一份规格说明或一组小票（由用户描述）。
   - 产出：改好的代码，外加做过类型检查、单文件测试和一次全量测试；改动提交到当前分支。
   - 走到哪一步算结束：正文写的收尾动作是「Once done, use /code-review to review the work.」——交给 `/code-review` 就算这一棒走完。
   - 回头路：原文没写。

5. **`/code-review`**
   - 输入：用户给的固定点（某次提交、分支名、tag、`main`、`HEAD~5` 等），以及从这里到 `HEAD` 的 diff 和提交列表，命令是 `git diff <fixed-point>...HEAD`（三点写法，比较的是合并基点）。固定点必须先确认能解析出来、diff 非空，否则在这里就直接失败，不许把坏引用带进两个并行子代理里再报错。Spec 那条线还需要来源规格说明，找的顺序是：提交信息里的 issue 引用 → 用户作为参数给的路径 → `docs/`、`specs/`、`.scratch/` 下与分支名或功能名对应的 spec 文件 → 都找不到就问用户。Standards 那条线还需要仓库里记录编码规范的文件（例如 `CODING_STANDARDS.md`、`CONTRIBUTING.md`），外加正文里那 12 条 Fowler 味道基线。
   - 产出：并排的两份报告 `## Standards` 和 `## Spec`，照原样或轻微整理后呈现，不合并、不重新排序，最后一行给出每条线的发现条数和各自最严重的问题；不跨线选一个总冠军。
   - 走到哪一步算结束：报告给出即结束。原文没写之后要做什么。
   - 回头路：官网把这一棒当作主干最后一棒，但本地原文没有写「评审发现问题就回到 `/implement` 改」这类回头路。本组五个文件里唯一明写的循环是 `/to-tickets` 里「反复拆到用户认可」。所以「code-review 发现问题后回到 implement」这一点，本地原文没写。

## 本组原文没写清楚的地方（汇总）

- 三个衔接点没有点名：`/grill-with-docs` → `/to-spec`、`/to-spec` → `/to-tickets`、`/to-tickets` → `/implement`。官网说这组有顺序，本地正文只写出了 `/implement` → `/code-review` 这一段。
- `/grill-with-docs` 和 `/implement` 都只有几行，没有流程、没有结束条件、没有触发时机；`/grill-with-docs` 的「产出 ADR 和术语表」只出现在 YAML 的 `description` 里。
- 评审发现问题之后怎么回到实现，五个文件都没有写。
- 本组只有 `/code-review` 没有 `disable-model-invocation: true`，其余四个都有。这会不会影响「主干必须按顺序走」原文没有解释。
- 每个技能目录下除了 `SKILL.md` 只有一个 `agents/openai.yaml`（按要求没读），没有别的内容，所以上面这些「原文没写」不是漏读造成的。
