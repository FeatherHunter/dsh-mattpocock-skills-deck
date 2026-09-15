# 06 Reference Skills（官网首页第 06 组）

## 这一组是什么

官网对这一组的说明是「The reusable layer other skills invoke or cite.」（别的技能会调用或引用的那一层），并写着从 `/codebase-design` 开始。

本地这一组一共四个技能目录，每个目录里除 `SKILL.md` 之外还有参考文件：

- `codebase-design`：`SKILL.md`、`DEEPENING.md`、`DESIGN-IT-TWICE.md`（另有 `agents/openai.yaml`，是配置文件，本次跳过不读）
- `domain-modeling`：`SKILL.md`、`CONTEXT-FORMAT.md`、`ADR-FORMAT.md`（另有 `agents/openai.yaml`，跳过）
- `grilling`：`SKILL.md`（另有 `agents/openai.yaml`，跳过；本地这个目录里没有别的参考文件）
- `tdd`：`SKILL.md`、`tests.md`、`mocking.md`（另有 `agents/openai.yaml`，跳过）

下面四个技能逐个写。

---

## /codebase-design

- **技能名**：`/codebase-design`

- **官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

  > Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.

  中文转述：这是一套讲「深模块」设计的共同用词表。当你想设计或改进某个模块的对外接口、想找出哪里可以把模块做深、想决定接缝（seam）留在哪、想让代码更好测或更好被 AI 读懂时用它；另一个技能需要「深模块」这套词的时候也用它。

- **它解决什么问题**：让一起干活的人和 AI 用同一套词来描述代码结构，避免各说各的。它给出一批有明确定义的术语（模块、接口、实现、深度、接缝、适配器、杠杆、局部性），并要求「照这些词用，不要换成 component、service、API、boundary」。

- **什么时候用它（进入条件）**：`description` 里写了四种情形——想设计或改进一个模块的接口、想找出可以做深的地方（deepening opportunities）、想决定接缝放在哪、想让代码更好测或更好被 AI 读；以及「另一个技能需要这套深模块词汇」时。正文本身没有再写别的进入条件（正文开头只写「Use this language and these principles wherever code is being designed or restructured」，即凡是在设计或重构代码的地方都用它）。

- **用它之后通常接什么**：正文末尾「Going deeper」一节明确指向两份参考文件：
  - 要给一簇模块做深、并且已经知道它们有哪些依赖时，接 `DEEPENING.md`（依赖分类、接缝纪律、用「替换而不是叠层」的方式写测试）。
  - 要探索同一个模块的几种不同接口方案时，接 `DESIGN-IT-TWICE.md`（并行起多个子代理，各自设计出差别很大的接口，然后放在一起比）。

- **它在正文里点名提到的其他技能**：正文（`SKILL.md`、`DEEPENING.md`、`DESIGN-IT-TWICE.md`）里**没有点名提到任何一个别的技能**。它提到的是文件而不是技能：`DEEPENING.md`、`DESIGN-IT-TWICE.md`，以及 `DESIGN-IT-TWICE.md` 里要求子代理的提示词里同时包含「`CONTEXT.md` 的词汇」（这里只写了文件名，没有点名 `domain-modeling` 这个技能）。

- **跨会话 / 跨代理用法**：有。`DESIGN-IT-TWICE.md` 第 2 步原文要求：

  > Spawn 3+ sub-agents in parallel. Each must produce a **radically different** interface for the deepened module.

  > Prompt each sub-agent with a separate technical brief (file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), what sits behind the seam). The brief is independent of the user-facing problem-space explanation in Step 1.

  也就是把活拆给多个并行子代理来做，并且给每个子代理各写一份独立的技术简报。这里没有提到「换一个新会话」「写一份文件交接给下一个人」这类说法。

- **原文里对不上的地方**：
  1. 官网这一组只写了「从 `/codebase-design` 开始」，没有说 `codebase-design` 目录下还有两份独立的参考文件；本地实际存在 `DEEPENING.md` 与 `DESIGN-IT-TWICE.md`，这是官网首页没有列出来的内容。
  2. `codebase-design` 的 `description` 里写着「或者在另一个技能需要深模块词汇时用它」，也就是它自我定位是被别人引用的，但这一组四个技能的正文里，只有 `tdd` 明确点名引用了它（见下面 `/tdd` 一节和最后一节）。`grilling`、`domain-modeling` 的正文里都没有点名引用它。

---

## /domain-modeling

- **技能名**：`/domain-modeling`

- **官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

  > Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, record an architectural decision, or when another skill needs to maintain the domain model.

  中文转述：建立并打磨一个项目的领域模型。当用户想把领域里的一组术语、或者团队共用的那套说法（ubiquitous language）定下来、想记录一条架构决策，或者当另一个技能需要维护领域模型时用它。

- **它解决什么问题**：项目里同一个概念总有好几种叫法，越往后越乱，代码和人对不上。这个技能负责当场把词敲定、把决定写下来，并且要求只把「项目这个上下文里特有的概念」写进词汇表，通用编程概念不许写进去。

- **什么时候用它（进入条件）**：`description` 里写了两类情形：把领域术语或共用语言敲定下来、记录一条架构决策；以及「另一个技能需要维护领域模型」。正文里还补了一条很关键的分界：

  > (Merely *reading* `CONTEXT.md` for vocabulary is not this skill — that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

  也就是「只是读一眼 `CONTEXT.md` 查词」不算用这个技能，任何技能顺手就能做；只有当你真的要改动模型、而不是只消费它的时候才用它。

- **用它之后通常接什么**：产出两份东西，都写在项目仓库里：
  - 词汇表：根目录或各上下文目录下的 `CONTEXT.md`。正文原话是「`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.」（`CONTEXT.md` 里不许有任何实现细节，它只是一份词汇表。）格式见 `CONTEXT-FORMAT.md`。多个上下文时根目录放 `CONTEXT-MAP.md` 指路。
  - 架构决策记录：`docs/adr/` 下的 `0001-slug.md` 这种顺序编号的文件。格式见 `ADR-FORMAT.md`。正文明确要求少写：「Only offer to create an ADR when all three are true」，三个条件（难以回退、没有背景会让人奇怪、是真实取舍的结果）缺一个就不写。
  - 「创建文件要懒」：没有 `CONTEXT.md` 就在第一个词敲定时才建，没有 `docs/adr/` 就在第一条 ADR 需要时才建。

- **它在正文里点名提到的其他技能**：正文（`SKILL.md`、`CONTEXT-FORMAT.md`、`ADR-FORMAT.md`）里**没有点名提到任何一个别的技能**。它提到的是文件：`CONTEXT.md`、`CONTEXT-MAP.md`、`CONTEXT-FORMAT.md`、`ADR-FORMAT.md`、`docs/adr/`。反向的证据在 `tdd` 那边：`tdd` 的正文要求读 `CONTEXT.md`、遵守 ADR，但也没有点名 `domain-modeling`（见最后一节）。

- **跨会话 / 跨代理用法**：正文没有提到「换一个新会话」「把活交给另一个 agent」这类用法。它写的是**跨时间**的用法：`CONTEXT.md` 和 ADR 是写给以后读代码的人看的。最接近的原文是 ADR 三个条件里的第二条「Surprising without context — a future reader will wonder "why did they do it this way?"」，以及 `ADR-FORMAT.md` 里「a future reader will look at the code and wonder "why on earth did they do it this way?"」和「These stop the next engineer from "fixing" something that was deliberate.」。这些说的都是「以后的读者/下一位工程师」，不是明确的跨会话或跨代理交接。

- **原文里对不上的地方**：
  1. `description` 里写「record an architectural decision」（记录一条架构决策）是它的触发条件之一，但正文把 ADR 的触发收得很紧——三个条件必须同时成立，否则「skip the ADR」。看描述像是一个常用入口，看正文其实是个很少开的窄口。这是描述与正文语气上的落差，如实记下。
  2. 官网这一组对它的定位是「别的技能会调用或引用的那一层」，本组四个技能的正文里也确实有别的技能在用它的**产物**（`tdd` 要求读 `CONTEXT.md` 和 ADR，`codebase-design` 的 `DESIGN-IT-TWICE.md` 要求提示词里带上 `CONTEXT.md` 词汇），但**没有一个技能点名写出 `domain-modeling` 这个名字**。

---

## /grilling

- **技能名**：`/grilling`

- **官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

  > Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.

  中文转述：就一个方案、一个决定或一个想法，把用户追问到底。当用户想给自己的思路做压力测试，或者用了带「grill」的触发说法时用它。

- **它解决什么问题**：让人在动手之前把没想清楚的地方都想清楚，不留「默默地假设」。它把要讨论的事画成一棵「设计树」（每个决定都会生出挂在它下面的决定），按「轮」推进，每轮只问当前已经具备提问前提的那些决定（原文叫 frontier，即「前沿」）。

- **什么时候用它（进入条件）**：`description` 里写了两条：用户想对自己的思考做压力测试，或者用户用了任何带「grill」的触发说法。正文里没有另外写进入条件，但写了收尾条件：

  > The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

  也就是前沿问空了、设计树每个枝都走到、没有留下默认假设，这个会话才算完；并且在用户确认「我们已经达成共识」之前不许动手去做。

- **用它之后通常接什么**：产出是一轮一轮的问答本身，最后落到「用户确认已经达成共识」这个点上（原文：「Do not act on it until the user confirms you have reached a shared understanding.」）。正文没有写「接下来去做哪个技能的活」这类后续指向，也没有写除问答之外的产物文件。每轮问题的格式是固定模板：

  > ❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>
  >
  > ➡️ <your recommended answer>

  每一轮要把当前前沿上的问题**一次性问完**，每个问题编号，并给出自己推荐的答案；然后等用户回答，再重算前沿、问下一轮。依赖本轮其它未决问题的问题，属于**后面**的轮次，这一轮不问。事实由自己查、决定交给用户：需要环境里的事实就叫子代理去找，但不要卡住，只把下游的问题留到子代理回报之后再问。

- **它在正文里点名提到的其他技能**：**没有**。`grilling` 的 `SKILL.md` 是本组四个技能里最短的一份（共 22 行），全文没有出现任何一个别的技能名。也就是说，正文里**没有**写「别的技能应该怎么调用我」这段话——虽然它的 `description` 里留了「uses any 'grill' trigger phrases」，即靠触发词被别人（或用户）唤起。这是本组最值得注意的一处：`grilling` 只有被**用户直接触发**这一条路在正文里被写明。

- **跨会话 / 跨代理用法**：有一处跨代理用法，原文是：

  > Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now.

  即：自己去查事实，需要环境事实时派一个子代理去找，而且不要阻塞——正在跑的探查算作「未定前提」，只有它下游的问题等，其余问题照问。「换一个新会话」「写一份文件给下一个人接着做」这类说法**没提到**。

- **原文里对不上的地方**：
  1. 官网这一组说这一层是「别的技能会调用或引用」，`grilling` 的 `description` 也留了「uses any 'grill' trigger phrases」这个被动入口，但它的**正文完全没有写「别的技能应该怎么调用我」**，也没有写调用后要传什么、要接什么产物。谁、在什么时机、拿什么来调它，原文没写。
  2. 它标注自己位于「那一层」里，但从正文看它更像一条**独立的用户路径**（有触发词、有一轮轮问答、有明确的收尾条件），不像被别的技能内部引用的规矩。这一点在下游做面板时要注意区分。

---

## /tdd

- **技能名**：`/tdd`

- **官方一句话**（`SKILL.md` 头部 YAML 里 `description:` 的原文）：

  > Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.

  中文转述：测试驱动开发。当用户想先写测试再写功能或修 bug、提到「red-green-refactor」（红-绿-重构），或者想要集成测试时用它。

- **它解决什么问题**：TDD 本身只是「红 → 绿」这个循环，容易写出一堆没价值的测试。这个技能是那份「让这个循环产出值得留下的测试」的参考：什么样的测试是好测试、测试该放在哪里、有哪些反模式、循环里要守哪些规矩。正文原话：「Every section applies on every cycle — consult them before and during the loop, not after.」（每一节每个循环都适用，要在循环之前和之中查，不是事后查。）

- **什么时候用它（进入条件）**：`description` 里写了三条：用户想先写测试再做功能或修 bug、提到「red-green-refactor」、或者想要集成测试。正文另有一条**硬性前置**：

  > **Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam.

  即写任何测试之前，先把要测的接缝写下来并和用户确认，没确认的接缝上不写测试。正文还给了提问原话：「Ask: "What's the public interface, and which seams should we test?"」

- **用它之后通常接什么**：产出是按「垂直切片」推进的一轮轮循环：一个测试 → 一份最小实现 → 重复，每个测试是一个「曳光弹」（tracer bullet），根据上一轮学到的东西调整。规矩三条：红先于绿（先写失败的测试，再写刚好能过的代码，不做投机性的预防）；一次一个切片（一个接缝、一个测试、一份最小实现）；**重构不属于这个循环**，它属于 review 阶段（正文点名说见 `code-review` 技能）。正文提到的参考文件是 `tests.md`（好测试与坏测试的示例）与 `mocking.md`（什么时候该 mock、怎么设计好 mock 的接口）。

- **它在正文里点名提到的其他技能**：两个，都是**引用**性质：
  1. `/codebase-design` —— 正文原话：

     > When the shape of that interface is itself in question — how deep the module is, where the seam belongs, what the interface should expose — use the `/codebase-design` skill for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms, and **it is a reference to consult, not a session to run.**

     即接口形状本身有疑问时，用 `/codebase-design` 这套词汇；并且写明它是「拿来查阅的参考，不是要开一场会话去跑的技能」。
  2. `code-review` —— 正文原话：「**Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.」即重构归 review 阶段，见 `code-review` 技能。属于**引用**（指路）。

  另外正文要求读 `CONTEXT.md` 并遵守所在区域的 ADR，但**没有点名** `domain-modeling`，只写了文件名 `CONTEXT.md`。

- **跨会话 / 跨代理用法**：没有提到「换一个新会话」「把活交给另一个 agent」「写一份文件给下一个人接着做」。它写到的跨人协作方式是**同一个会话里和用户确认**：「Before writing any test, write down the seams under test and confirm them with the user.」以及「Ask: "What's the public interface, and which seams should we test?"」

- **原文里对不上的地方**：
  1. 官网说这一组是「别的技能会调用或引用」的那一层，而 `tdd` 自己的正文**引用了别的技能**（`/codebase-design`、`code-review`），方向是反的：它是引用方，不是被引用方（至少在这四份本地原文里找不到任何别的技能引用 `tdd`）。
  2. 任务描述里举例提到「`tdd` 是不是被 `implement` 那类技能当规矩引用」——`tdd` 的本地原文里**没有**出现 `implement` 或任何同类技能名，本地这一组四个目录里也没有任何一处引用 `tdd`。这一点只能写「原文没写」/「本组原文里找不到」，不能替它推断。

---

## 这一组和别的技能是怎么挂上的

把本组四份 `SKILL.md` 与它们的参考文件正文全部过了一遍，能拿出来的最明确证据只有下面这几条。**结论是：这一组里「挂」的方向主要是往外的（它们引用别人、或把自己的产物留给别人用），本组内部四者之间几乎没有互相点名。**

**1. 最明确的一条：`tdd` 引用 `/codebase-design`，而且明确说了是「查阅」不是「开一场会话」。**

`tdd/SKILL.md` 的「Seams — where tests go」一节原文：

> When the shape of that interface is itself in question — how deep the module is, where the seam belongs, what the interface should expose — use the `/codebase-design` skill for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms, and it is a reference to consult, not a session to run.

- 谁引用谁：`tdd` 引用 `/codebase-design`。
- 引用的是什么：那套词（module、interface、depth、seam、adapter、leverage、locality），不是某一份文件。
- 时点：接口的形状本身有疑问时（模块该多深、接缝该放哪、接口该暴露什么）。
- 这一条正好印证了 `codebase-design` 的 `description` 里那句「or when another skill needs the deep-module vocabulary」。这是本组里唯一一处「另一个技能点名调用本组技能」的原文证据。

**2. `tdd` 引用 `code-review`，并划清一条边界。**

`tdd/SKILL.md` 的「Rules of the loop」原文：「**Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.」——重构不在红绿循环里，归 review 阶段，见 `code-review`。这是引用（指路），承接的产物是「循环跑完之后的代码」。

**3. `codebase-design` 用 `domain-modeling` 的产物，但没有点它的名。**

`codebase-design/DESIGN-IT-TWICE.md` 第 2 步原文：「Include both [SKILL.md](SKILL.md) vocabulary and CONTEXT.md vocabulary in the brief so each sub-agent names things consistently with the architecture language and the project's domain language.」——要求给子代理的技术简报里同时带上 `codebase-design` 的词汇和 **`CONTEXT.md` 的词汇**，让每个子代理的命名既符合架构语言、又符合项目领域语言。

- 谁引用谁：`codebase-design`（的 `DESIGN-IT-TWICE.md`）使用 `CONTEXT.md` 这份产物。
- 引用的是哪一份产物：`CONTEXT.md`（也就是 `domain-modeling` 产出的词汇表文件）。
- 引用方式：**没有点名** `domain-modeling` 这个技能，只写了文件名。所以这是「引用产物」，不是「调用技能」。

**4. `tdd` 也要求读 `domain-modeling` 的产物，同样没有点名技能。**

`tdd/SKILL.md` 开头原文：「When exploring the codebase, read `CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.」——探索代码库时读 `CONTEXT.md`（如果存在），让测试名和接口词汇跟项目的领域语言一致；并且遵守你要碰的那块地方的 ADR。

- 谁引用谁：`tdd` 使用 `CONTEXT.md` 与 `docs/adr/` 这两份产物。
- 引用的是哪一份产物：`CONTEXT.md`（词汇表）与 ADR（架构决策记录），都是 `domain-modeling` 写下的东西。
- 引用方式：同样**没有点名** `domain-modeling`，但 `domain-modeling/SKILL.md` 自己留了话解释这种用法——「Merely *reading* `CONTEXT.md` for vocabulary is not this skill — that's a one-line habit any skill can do.」即「读一眼 `CONTEXT.md` 查词」被明确认定为**任何技能都顺手能做的一个习惯**，不算调用 `domain-modeling`。这句话是本组关于「谁用谁」最关键的一条原文依据。

**5. 找不到的挂接（如实写明）：**

- `grilling` 的正文里**没有**写「别的技能应该怎么调用我」。它只留了被动入口：`description` 里的「or uses any 'grill' trigger phrases」。谁在什么时机、拿什么材料来调它，原文没写。本组其它三个技能的正文也**都没有**点到 `grilling`。
- 本组四个技能的正文里，**没有任何一处**点到 `tdd`。除 `tdd` 自身外，`codebase-design`、`domain-modeling`、`grilling` 三份 `SKILL.md` 及其参考文件里都没有出现 `tdd` 这个词。
- `domain-modeling` 的正文也**没有**写到「别的技能该怎么调用我」；它的被使用方式全部体现在别人写的那两处（上面第 3、4 条），而且是「消费产物」而不是「调用技能」。
- `codebase-design` 的 `SKILL.md`、`DEEPENING.md` 两份正文里**没有**出现任何其它技能名；只有 `DESIGN-IT-TWICE.md` 提到 `CONTEXT.md` 的词汇。

**一句话总结挂接关系**：`tdd` → 引用 `/codebase-design`（取词汇，明确说明是查阅型参考）和 `code-review`（重构归它）；`tdd` 与 `codebase-design` 都消费 `domain-modeling` 写下的 `CONTEXT.md`（以及 ADR），但都只写文件名、不点技能名；`domain-modeling` 自己把这种「只读文件查词」定性为任何技能都能有的习惯，不算调用自己；`grilling` 与本组其它三者之间，原文里没有任何挂接。

---

## 哪些是「使用者会自己去点的一条路」，哪些是「别的技能内部的规矩」

判断依据只用原文。四个技能逐个给结论：

### 使用者会自己去点的一条路（有进入条件、有产出）

**1. `/grilling` —— 是。**

- 进入条件：`description` 写了用户侧触发（想给思路做压力测试，或用任何带「grill」的触发说法）。
- 产出：一轮轮的问答，格式固定（编号问题 + 推荐答案），最后落到用户确认「我们已经达成共识」。
- 原文关于它「被别的技能调用」的部分：正文没写，`description` 只留了触发词入口。
- 补充判断：它的 `SKILL.md` 通篇在讲「怎么和用户对话」，没有一句「别的技能该怎么用我」。所以它是一条实打实的用户路径。

**2. `/tdd` —— 是。**

- 进入条件：`description` 里的三条（先写测试再写功能或修 bug、提到「red-green-refactor」、想要集成测试），外加正文的硬前置「先把要测的接缝写下来和用户确认」。
- 产出：红绿循环跑出来的测试与实现（垂直切片，一个测试接一份最小实现）。
- 补充判断：虽然官网把它放在「别的技能会调用或引用」的那一层，但它的正文方向相反——是它在引用 `/codebase-design` 与 `code-review`；本组原文里**没有任何**技能引用它。所以它更像是「使用者自己会开的一条路」。

**3. `/domain-modeling` —— 有保留地算「是」。**

- 支持它是用户路径的原文：`description` 里给了用户侧触发（想把领域术语或共用语言定下来、想记录一条架构决策）。
- 支持它偏「内部规矩」的原文：`description` 里同时写着「or when another skill needs to maintain the domain model」；正文明确规定「只是读 `CONTEXT.md` 查词不算这个技能，那是任何技能顺手一行的习惯」，并说「This skill is for when you're changing the model, not just consuming it」；ADR 的开口收得很紧，三条件缺一就不写。
- 结论：它介于两者之间——**用户偶尔会自己开一次（要定词、要记决策时）**，但大量被别的技能用到的只是它写下的文件（`CONTEXT.md`、ADR），而那部分原文明确不算「用这个技能」。这条分界有原文出处，是下游做面板时最该留意的一处。

**4. `/codebase-design` —— 有保留地算「是」。**

- 支持它是用户路径的原文：`description` 给了用户侧触发（想设计或改进模块接口、想找做深的机会、想决定接缝放哪、想让代码更好测或更好被 AI 读）。
- 支持它偏「内部规矩」的原文：`description` 里同时写着「or when another skill needs the deep-module vocabulary」，正文开头也写「Use this language and these principles wherever code is being designed or restructured」——「凡是在设计或重构代码的地方都用这套语言」，这是一句覆盖式的规矩，而不是一个单独要开的会话。`tdd` 更是把它定性为「a reference to consult, not a session to run」（拿来查阅的参考，不是要开一场会话去跑的技能）。
- 结论：同样是两者兼有——**使用者可以自己开它来设计某个模块的接口**（尤其走到 `DESIGN-IT-TWICE.md` 那套并行子代理流程的时候），但更多时候它是被别的技能当成一套词来查的。

### 别的技能内部的规矩（基本不会有人单独去点）

按原文严格看，**没有一个技能是纯粹的「内部规矩」**：四个技能的 `description` 都给了用户侧触发条件。但下面这两条最接近「内部规矩」：

- `/codebase-design`：`tdd` 的原文明确说它是「a reference to consult, not a session to run」，并且 `description` 自己在用户侧触发之外专门列了「另一个技能需要这套词汇」这一条。它作为「词表」被查的成分，比作为「一场会话」被开的成分更被原文强调。
- `/domain-modeling`：正文把「读 `CONTEXT.md` 查词」明确划出去，说那是任何技能顺手一行的习惯；真正的技能只用于**改动模型**。也就是说，别的技能在干活时用到的绝大多数只是它的产物，而不是这个技能本身。

### 原文没说清楚的地方

- `grilling` 怎么被别的技能调用：原文**没写**（只有 `description` 里的触发词入口，没有调用约定、没有传入材料、没有交接产物）。
- `tdd` 有没有被某一类「实现功能」的技能当成规矩引用：本组原文里**找不到任何证据**，四个目录里没有出现 `implement` 或同类技能名，也没有任何技能提到 `tdd`。这项判断**不能替它下**——需要看别的组（例如做实现类技能的那份原文）才能回答。
- `codebase-design` 与 `domain-modeling` 在面板上到底算「一条路」还是「一份规矩」：原文**没有给出唯一答案**，两边的话都写了（用户侧触发 + 另一技能需要）。上面给的是按原文逐条对照后的倾向，不是原文的定论。
