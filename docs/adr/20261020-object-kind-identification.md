# ADR：对象类型的判定口径（#1275）

> 日期：2026-10-20 定版（#1275 讨论票的结论；地图 #1274「双轨插件形态：探索地图与实施地图」下的落地前置）
> 地位：本文件是「一张票是什么对象、怎么认出来、认不出时怎么办」的唯一依据。凡与本文冲突的旧写法以本文为准；未来任何讨论若改动本决策，以未来版本为准（根 `GLOSSARY.md`「版本与效力」同款两条规则）。
> 关联：#1275（讨论票，结论落点）· #1274（地图，本决策的来源）· #1277（本地 Markdown 房落地）· #1280（验收与门禁）· #1281（提示词与按钮文案）· `GLOSSARY.md` 的「对象类型词条」· `research/1275-object-kind-identification.md`（外部资料调研，175 行）· `src/deck/rules/minimal-spec.ts`（规则侧现状）· `src/tracker/rooms/markdown/parse.ts`（本地房现状）· `src/tracker/rooms/markdown/patch-body.ts`（整段替换正文的搬回逻辑）· `src/client/kernel/store-derived.ts`（动作类型那条阶梯）· `src/shared/refresh/src/idempotency.ts`（判据只写一份的先例：deck 侧 `src/deck/tools/map-plan-create.ts:19` 与三个后端房 `github/issues-write.ts:24`、`markdown/issues-create.ts:25`、`gitlab/issues.ts:20` 引同一份）

---

## 1. 背景

双轨插件形态里，面板要把探索地图与实施地图分开，实施票要挂到规格下面，提示词与收口逻辑要知道自己在跟哪种对象打交道。所以插件得在只有「一张票的正文与标签」的情况下，认出它是什么对象。

能用的线索只有三样：

1. **正文里的隐藏标记。** 本仓已有先例是幂等锚 `<!-- DSH-IDEMPOTENCY-KEY: ... -->`：写在票面首行、渲染时看不见、整份替换正文时以盘上那一份为准保住。
2. **标签。** 表达对象类型的标签今天已有六枚：wayfinder:map、wayfinder:research、wayfinder:prototype、wayfinder:grilling、wayfinder:task、bug。另有 triage 五角色（needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix），它们说的是流程状态，不是对象类型。
3. **正文形状。** 地图五节、to-spec 的七节、to-tickets 的四节，是三套有专属结构的模板。

三样各有各的短处：

- 标记只有新建的票才有，仓库里现存的票一张都没有。
- 标签认不出规格与实施票（它们按已定决策不带任何 wayfinder 标签），也认不出普通票——普通票的定义就是「什么特征都没有」。
- 形状认不出四种寻路票：wayfinder 技能规定它们正文都只有 `## Question` 一节（`package/bundled-skills/wayfinder/SKILL.md:60-63`），四种票在正文里长得一模一样。而且形状判据本身脆：外部资料调研逐条取证了标题层级不统一、表单生成的正文事后仍可改、模板互转会撞名、平台类型体系本身在改、章节顺序无官方保证、中英混写等反例（见 `research/1275-object-kind-identification.md` 第二节「证据链」）。

还有一件必须先分清的事：仓里「这张票现在该做什么动作」的判定已经存在（`src/client/kernel/store-derived.ts:269-283` 的阶梯：无标签或 needs-triage → 诊断、ready-for-human → 接手、needs-info → 补充、bug → 修复、wayfinder:grilling → 讨论、wayfinder:research → 研究、wayfinder:prototype → 原型、其余 → 执行），它只看标签、不看正文。对象类型是另一件事，不能跟它混。

## 2. 决策

### 2.1 唯一真源是正文首行的隐藏标记

对象类型的唯一真源是票面首行、一级标题之前的那行隐藏注释：

`<!-- DSH-ISSUE-KIND: <kind> -->`

标记里只放类型名这种短词，不放秘密、不放长文：它会随 GitHub 的 webhook 负载原样流出，也会被站内搜索按词命中。

本地 Markdown 房票面上那行 `Type:` 字段降级为**派生显示**——由标记翻译而来，两边不一致时以标记为准；`Type:` 的候选值只保留原有的 research / prototype / grilling / task 供老票读，不再往里加 spec 与 ticket。不接 GitHub 原生 issue type 字段：它是组织设置决定的、值域与本仓九种不同构，等于新开一个槽位。

标记允许丢失：丢了退回标签与正文形状，不因此判错。

### 2.2 判定顺序：标记 → 类型标签 → 正文形状

一条链，不分层，前一步能定就不再往下走。**形状是最后的兜底。**

| 步骤 | 认什么 | 认出哪些取值 |
|---|---|---|
| 1. 正文首行隐藏标记 | 九个合法值 | 地图、规格、实施票、调研票、原型票、讨论票、任务票、缺陷票、普通票 |
| 2. 类型标签 | 六枚：wayfinder:map / wayfinder:research / wayfinder:prototype / wayfinder:grilling / wayfinder:task / bug | 地图、调研票、原型票、讨论票、任务票、缺陷票 |
| 3. 正文形状（兜底） | 三种专属形状 | 地图、规格、实施票 |

triage 五角色标签不参与判定。第 3 步只认三种专属形状：

- **地图**：`Destination` / `Notes` / `Decisions so far` / `Not yet specified` / `Out of scope` 五节全在（`src/deck/rules/minimal-spec.ts:32-34`；中英两版 wayfinder 模板里同名）。
- **规格**：to-spec 七节全在（英文 Problem Statement、Solution、User Stories、Implementation Decisions、Testing Decisions、Out of Scope、Further Notes；中文 问题陈述、解决方案、用户故事、实现决策、测试决策、不在范围内、补充说明）。
- **实施票**：to-tickets 议题模板四节全在（英文 Parent、What to build、Acceptance criteria、Blocked by；中文 父议题、要构建什么、验收判据、被谁阻塞），外加本地文件模板那种写法（一级标题 + `**What to build:**` / `**Blocked by:**` / `**Status:**` 三条加粗行 + 验收复选框，`package/bundled-skills/to-tickets/SKILL.md:69-82`）。

四种寻路票共有的 `## Question` **不算**专属形状：它们都有类型标签，第 2 步已经认过。所以「含 `## Question` 但没有类型标签」的票落普通票。

### 2.3 形状判据取严

全齐才算；允许附加章节、顺序无关、只认二级标题（`##`）。多个形状同时命中时按具体 > 泛化（规格 > 实施票 > 地图 > 普通票）。缺节单列为「形状不全」这一档。

节名清单只从技能模板取（`package/bundled-skills/to-spec/SKILL.md` 与 `SKILL.zh.md`、`to-tickets/SKILL.md` 与 `SKILL.zh.md`），识别器不另抄一份；实现走生成器（照 #1278 定的 config/ 下 YAML 单一真源 + 生成器套路），并有门禁保证模板改了清单会重生成。

### 2.4 没有「没认出来」这一档

判定结果永远是九个取值之一。第三方提交的无标签、无章节 issue 就是普通票：界面与流程与今天完全一样（继续走 triage 诊断），不加徽章、不加提示、不进任何实施地图分组。

只有两种「票自己露出了线索、但线索对不上」才提示：正文出现了专属结构的特征节但节不齐（提示缺哪几节）；标记行的值不合法（提示九个合法值是什么）。

### 2.5 标记行的位置与写路径保护

标记行紧跟幂等锚之后，判据是「必须出现在一级标题之前」（前面允许隔着 `created` / `parentKey` 两行注释）。

写路径照幂等锚的既有做法三处：①整份替换正文时以盘上那一份为准把标记行搬回新正文首行（本地 Markdown 房在 `mergeWholeBodyForPatch` 里做；GitHub 房没有房内这层保护，要做在 deck 工具层的 `deck_issue_patch`）；②建票时剥掉传入正文里已有的标记行；③建票的单例校验要求标记行至多一条。

### 2.6 判据只写一份

标记的语法与搬回规则下沉到 `src/shared/` 下的一个新包，deck 侧、三个房、客户端引同一份。先例是幂等锚判据放在 `src/shared/refresh/src/idempotency.ts`，deck 侧与三个后端房共同引用。

`src/deck/rules/minimal-spec.ts:116-118` 那条「房规不许后端引用纯规则目录，所以两份各自手写」的注释随之改掉；已存在的同类重复（`isWholeIssueBody` 在规则侧 `src/deck/rules/minimal-spec.ts:119-125` 与房侧 `src/tracker/rooms/markdown/parse.ts:59-66` 各手写一份）一并收口到同一处。

### 2.7 动作类型与对象类型分开

动作按钮的判定一行不改，继续只读标签、按「状态优先于类型」的阶梯算。对象类型只用于面板分组、徽章、提示词与收口逻辑。一张同时带 needs-triage 与 wayfinder:grilling 的票：动作是「诊断」、对象类型是「讨论票」——这是今天已有的现象，不是本决策引入的。

## 3. 两个必须记住的坑

1. **标签排在形状前面，所以标签错一次就判错。** `ensureLabels`（`src/deck/rules/minimal-spec.ts:49-62`）与 `deck_map_plan_create`（`src/deck/tools/map-plan-create.ts:359`）现在对认不出的 kind 一律落回 task、必贴 `wayfinder:task`。扩到九种时必须把 spec 与 ticket 从这两张落回表里显式排除，否则一张被误贴 `wayfinder:task` 的规格票会在第 2 步就被判成「任务票」，形状那一步根本轮不到。
2. **形状判据宁可偏严。** 误判成规格（会被画成实施地图的容器卡）比落到普通票更糟。外部资料调研也指向同一边：判据要写成子集匹配、顺序无关、允许附加章节、双语清单，判不出就落普通票。

## 4. 落地时要做的事

- 新建判据包（标记语法、搬回规则、形状清单的读取），以及把形状清单从技能模板生成出来的那一步与对应门禁。
- 改 `ensureLabels` 与 `deck_map_plan_create` 的 kind 落回表。
- 把 `isWholeIssueBody` 的两份手写收口到判据包。
- 标记行在 GitHub、GitLab 两个后端与本地 Markdown 房各验一遍：读回保留、渲染剥掉、整份替换正文不丢。
- 老票不用回填标记：按新顺序，老票靠类型标签就全部认得对（地图、寻路票、缺陷票都有标签），规格票与实施票本来一张都还没有。

## 5. 边界

- 不加新标签（地图 #1274 已定）。
- 面板长什么样、验收清单、提示词文案、本地 Markdown 房的具体改造点，分别归 #1279、#1280、#1281、#1277。
- 地图 #1274 下所有子票完成后，才对这个地图执行 to-spec 与 to-tickets；本决策是那两步的输入。
