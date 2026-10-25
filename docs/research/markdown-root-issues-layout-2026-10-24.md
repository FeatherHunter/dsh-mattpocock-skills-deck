# featherhunter 管理仓的票为什么在根目录 issues/，以及合不合 /to-spec 与 /to-tickets

日期：2026-10-24。
要回答的三个问题：（1）`D:\dsh-plugin\featherhunter-plugin-manage\issues\` 里的票都在这个目录，正常吗；（2）这符合 `/wayfinder` 的规定吗；（3）这些票是我们 deck 代码控制的吗。

**补记（2026-10-24，用户更正口径）**：这批票与 `/wayfinder` 无关。实际路线是 `/to-spec` 写出规格票（01、06），再用 `/to-tickets` 拆实施票（02-05、07-09），实施走 `/implement-spec` 的降级流程。第 2 条结论回答的是"它们算不算 wayfinder 产物"，结论仍然成立（不是）；但它们该拿 `/to-spec` 与 `/to-tickets` 的原文来量，逐条核对见下文「### 6.」一节。第 3 节保留，作为当时那个问题的记录。

方法：读那个工作区的实际文件、deck 仓源码与已安装的插件、deck 仓的 ADR / 设计文档 / git 历史；按 `/research` 技能的要求，只认一手来源（源码、提交、技能原文、磁盘上的真实文件），每条结论都回引到出处。

## 结论

1. **这些文件是 deck 的本地 Markdown 后端写的，位置也是 deck 代码挑的，不是人手抄的、也不是别的插件写的。** 13 张票的文件头（幂等锚 → 类型标记 → 父注释 → 建票时间）、字段骨架（`Status:` / `Assignees:` / `Type:` / `Blocked by:` / `Labels:` + `## Comments` / `## Answer`）、文件名规则（`NN-<标题>.md`）逐项对得上 deck 的建票实现（`src/tracker/rooms/markdown/issues-create.ts:145-200`、`src/tracker/rooms/markdown/path.ts:32-39`）。它们落在工作区根 `issues/` 而不是文档常说的 `.scratch/<努力目录>/issues/`，原因是那个工作区**一个努力目录（effort）都没有**——没有 `.scratch/<名字>/map.md`，也没有根级 `.scratch/map.md`——建票时走到 `resolveCreateTarget` 的最后一个分支，把票落到 `issuesDir(repo)`，也就是 `<工作区根>/issues`（`src/tracker/rooms/markdown/issues-create.ts:54-76`；`src/tracker/rooms/markdown/path.ts:20-30,63-67`）。读端有同款兜底，所以 deck 的面板和工具能把这些票读回来（`src/tracker/rooms/markdown/issues-read.ts:151-175`、`src/tracker/rooms/markdown/issues-locate.ts:89-131`）。这套行为在已安装的 1.9.0-beta.15 里与源码一致（安装目录 `tracker/rooms/markdown/issues-create.js:37`、`tracker/rooms/markdown/path.js:16-27`），不是只在未发布的代码里才有。
2. **不符合 `/wayfinder` 的产物形态，因为这 13 张票不是 wayfinder 跑出来的。** 它们是"规格容器 + 实施票"这条路线的产物：01 和 06 是 `kind=spec` 的规格容器（文件头有 `<!-- DSH-ISSUE-KIND: spec -->`），02-05 与 07-09 的 `parentKey` 分别指向 01、06，是规格下的实施票。wayfinder 要求的是另一套形态：一张带 `wayfinder:map` 标签的**单张**地图票、每张票是地图的 child issue 并各带一枚 `wayfinder:research|prototype|grilling|task` 标签、认领用 assignee、阻塞用 tracker 原生依赖、地图正文分 Destination / Notes / Decisions so far / Not yet specified / Out of scope 五个区块（`package/bundled-skills/wayfinder/SKILL.md:21,25,57,65,67,69,84-99`）。逐票检查：没有地图文件、没有任何 `wayfinder:*` 标签、也没有那五个区块。所以准确的回答是：**它们不满足 wayfinder 的产物形态，但它们本来就不是 wayfinder 产物**——如果这个工作区想要一张 wayfinder 地图，第一步"建图"还没做。
3. **顺带纠正一个容易混的口径：deck 自己走 wayfinder 时，地图不是 `.scratch/<努力目录>/map.md`，而是一张普通的票。** deck 的地图对象是 `kind=map` 的顶层票，带 `wayfinder:map` 标签，正文写五个区块（`src/deck/rules/object-kind.ts:9-21,66-69`）。读回来时，老文件里的 `Type: map`、`wayfinder:map` 标签、以及 `map.md` 文件本身都会被认成地图（`src/tracker/rooms/markdown/parse.ts:288-319`）；`deck_map_snapshot` 也是按票号 `t.get` 加 `parentKey` 列子票读的（`src/deck/tools/map-snapshot.ts:131-157`）。`.scratch/<努力目录>/map.md` 是随包 tracker 模板和旧 ADR 写给"人直接手写 .scratch 文件"那条流程的；它仍然被支持（存在 map.md 时 effort 成立，建票落该 effort 的 `issues/`），但不是 deck 工具流程的硬要求。

## 证据

### 1. 工作区实况（一手：磁盘上的文件）

`D:\dsh-plugin\featherhunter-plugin-manage` 顶层：`.dsh-src`、`.dsh-vision-router`、`.local`、`.tmp`、`docs`、`issues`、`scripts`、若干图片资产、`AGENTS.md`、`GLOSSARY.md`。**没有 `.scratch` 目录，没有 `map.md`，也没有 `.git`**（`Get-ChildItem -Force` 与全树 `-Filter map.md` 均为空）。

`issues/` 下 13 个文件，扁平一层：

| 文件 | 文件头对象标记 | 父票 | Status | Labels |
| --- | --- | --- | --- | --- |
| 01-三群联系区块统一-5-仓中英-readme-同一段反馈与联系.md | `DSH-ISSUE-KIND: spec` | 无 | resolved | ready-for-agent |
| 02-源头定稿加同步脚本一句话全量覆盖b.md | 无 | `01` | resolved | ready-for-agent |
| 03-中文-5-处统一替换为反馈与联系.md | 无 | `01` | resolved | ready-for-agent |
| 04-英文-4-处统一为-feedback-and-contact.md | 无 | `01` | resolved | ready-for-agent |
| 05-对账加微信周更演练.md | 无 | `01` | resolved | ready-for-agent |
| 06-spec-调色板-readme-基础使用演示-折叠7段视频.md | `DSH-ISSUE-KIND: spec` | 无 | resolved | ready-for-agent |
| 07-中文页演示章落地-7段嵌套-兜底.md | 无 | `06` | resolved | ready-for-agent |
| 08-英文页镜像同步-复用同一批视频.md | 无 | `06` | resolved | ready-for-agent |
| 09-门禁回归与验收-双页对齐-既有门禁全绿.md | 无 | `06` | resolved | ready-for-agent |
| 10-英文演示视频重录-替换中文录制-摘英文页共用注.md | 无 | 明确写 `parentKey: null` | ready-for-agent | 空 |
| 11-demo-章双播放器-去-video-标签留裸链接-删中文冗余注.md | 无 | 无 | resolved | 空 |
| 12-demo-章标题重复-删-7-段加粗标题行-标题只留折叠标签.md | 无 | 无 | resolved | 空 |
| 13-demo-章-7-段之间加分隔线.md | 无 | 无 | resolved | 空 |

每张票的文件头都带 `<!-- DSH-IDEMPOTENCY-KEY: ... -->` 与 `<!-- created: ... -->`：01 是 `deck-9328da37-5975794`，06 是 `deck-e9ddd96c-5975870`，10 是 `deck-f111283a-5975889`，02-05 是调用方自定的 `tryB-001` / `conv-zh-001` / `conv-en-001` / `conv-verify-001`，07-09 是 `demo-cn-002` / `demo-en-001` / `demo-verify-001`。幂等锚是 `#711` 给契约里的"建票幂等"加的落盘标记，只由建票实现写入（`src/tracker/rooms/markdown/issues-create.ts:81-83,198-199`），调用方可以把自定的键传进来。

该工作区自己的 `docs/agents/issue-tracker.md` 写明票仓是本地 Markdown 后端、所有读写走 `deck_*` 工具、不要手写票文件（第 3 行），并把"规格是票""实施票用 `deck_issue_create` 建、`parentKey` 填规格票号""地图是 `kind=map` 顶层容器、地图工单是 `kind=map-ticket` 带一枚 wayfinder 标签"写成约定（第 7-12 行），`## Wayfinding operations` 一节也是同一口径（第 25-34 行）。**这份文档没有写票文件放在哪个目录**，所以"票都堆在根 `issues/`"在它自己的约定里既没被要求、也没被禁止。

### 2. deck 代码怎么选目录（一手：源码 + 已安装插件 + git 历史）

路径规则只有一处真源（`src/tracker/rooms/markdown/path.ts`）：

- `getRoot`：`repo.refId` 非空 → 绝对路径直接当仓库根，相对路径拼在 cwd 下；否则 `repo.name` 非空且不等于 `refId` → `<cwd>/.scratch/<repo.name>`；否则 `<cwd>/.scratch`（`:20-30`）。
- `mdPath`：夹具形态（有 `repo.path` 且无 `refId`）下 spec → `<path>/spec.md`、map → `<path>/map.md`、issue → `<path>/issues/<文件名>`；其余一律先取 `getRoot`（`:40-62`）。文件名规则：纯数字补成 `NN-untitled.md`，`NN-` 开头补 `.md`，其余补 `.md`（`:32-39`）。
- `issuesDir` = `getRoot + 'issues'`（`:63-67`）。带 effort 范围时另有 `<cwd>/.scratch/<effortId>/` 这一组（`:69-86`）。

`src/tracker/rooms/markdown/issues-locate.ts` 里，effort 的判据是**只看 `map.md`**：`.scratch/map.md` 存在算 effortId `''`，`.scratch/<名字>/map.md` 存在算 effortId `<名字>`，其他目录一律不算（`:50-67`）。找票时先扫各 effort 的 `issues/`，零命中再兜底 `issuesDir(repo)` 与 `repo.path/issues`（`:89-131`，注释原话是"夹具形态兜底：repo.refId / repo.path 直接当仓库根（单 effort、无 .scratch）"）。找地图时先扫各 effort 的 `map.md`，零命中再兜底 `issuesDir/../map.md` 与 `repo.path/map.md`（`:133-155`）。

建票落点的选择是 `resolveCreateTarget`（`src/tracker/rooms/markdown/issues-create.ts:54-76`）：

- 传了 `repo.effortId` → 必须命中那个 effort，否则报 NOTFOUND，绝不猜；
- 仓库恰好一个 effort → 自动用它；
- 多个 effort 又没指定 → 报 conflict；
- **一个 effort 都没有 → `target = null`，落 `issuesDir(repo, ctx)`**（`:75`）。

这条"零 effort 落根目录"的分支不是新加的：`#712` 修并发丢票时把这段抽成函数，抽取之前的实现里同样是 `const idir = target ? plat.join(target.dir,'issues') : issuesDir(repo,ctx)`（`git show 302ccfbba^:src/host/tracker/backends/markdown/issues-create.js` 第 38 行；`git blame` 也把 `issues-create.ts:75` 记在 `302ccfbba`，2026-09-23）。

已安装插件 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck`（`package.json` version `1.9.0-beta.15`）的编译产物与源码同构：`tracker/rooms/markdown/path.js` 的 `getRoot` / `issuesDir`（`:16-27`、`:60-68`）和 `tracker/rooms/markdown/issues-create.js:37` 的 `idir` 表达式都是同一段逻辑。因此"票落根 `issues/`"在发布版里就能发生。

另外，"没有地图"并不是 deck 工具会拒绝的状态：Markdown 后端的 `preflight` 会在三处找地图（各 effort 的 `map.md`、`/map`、根级 `.scratch/map.md`），都没有就返回 NOTFOUND（`src/tracker/rooms/markdown/index.ts:213-262`），但开会话不跑 preflight（`src/tracker/session/open-tracker.ts` 里没有 preflight 调用，失败原因只有 workspace-not-ready / no-backend / multi-match / pending / budget），`deck_context` 把预检失败只写成一句提示、不拦操作（`src/deck/tools/context.ts:203`）。工具壳里也搜不到 `preflight` 的闸门。所以即使 preflight 判"没有地图"，建票、读票仍然能照常工作。

### 3. `/wayfinder` 的硬要求（一手：技能原文）

`package/bundled-skills/wayfinder/SKILL.md`：

- `:21` 地图是**一张** issue，标 `wayfinder:map`，是这套东西的"正规产物"；它的票是这张地图的 child issue。
- `:25` 地图、child 票、阻塞、frontier 查询**在物理上放哪**由具体 tracker 决定，要查该仓 tracker 文档的 "Wayfinding operations" 一节；没有 tracker 文档时默认 local-markdown。
- `:57` 每张票是地图的 child issue，正文写问题本身。
- `:65` 每张票带一枚 `wayfinder:<类型>` 标签，取值 research / prototype / grilling / task。
- `:67` 认领 = 把票 assign 给开车的人（assignee 就是认领，未指派就是未认领）。
- `:69` 阻塞用 tracker **原生**依赖关系；frontier = open + unblocked + unclaimed 的 child 票。
- `:84-99` 地图正文五区块的写法：Destination、Notes 与 Decisions so far、Not yet specified（雾区）、Out of scope；越过目的地的工作关票并写进 Out of scope。

这个工作区的 `docs/agents/issue-tracker.md:25-34` 也按这个口径写了 `## Wayfinding operations`：地图是 `kind=map` 顶层票，child 是 `kind=map-ticket` + 一枚 wayfinder 标签 + `parentKey` 指向地图票，阻塞用 `blockedBy` 边，认领用 `deck_issue_patch` 写 `Assignees` 行，frontier 用 `deck_map_snapshot(detail=thin)` 过滤。

**逐票对照**：13 张票里没有一张带 `wayfinder:*` 标签；01 和 06 是 `kind=spec`（规格容器，不是地图）；02-05、07-09 的父票是规格票，不是地图票；10-13 既没有地图也没有 wayfinder 标签。所以按 wayfinder 的判据，这个工作区目前处于"没有地图"的状态；这些票是规格路线（`/to-spec` → `/to-tickets` 一类）的产物。

### 4. 随包模板与这个工作区文档的差别（一侧证：为什么文档说法会打架）

- 随包的发 tracker 文档模板仍是老 `.scratch/<feature-slug>/` 布局：规格是 `.scratch/<feature-slug>/spec.md`，票在 `.scratch/<feature-slug>/issues/NN-<slug>.md`（`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md:1-30`；已安装插件里的同名文件与它逐字相同）。
- 这份模板在 `70addb90`（2026-10-22，"技能原文还原成上游原文并加一字不差门禁"）被还原成上游原文；在那之前 `65af9f2e`（2026-10-20，"技能与架构文档改成规格票口径，本地不再产出孤儿 spec.md（#1277）"）曾把它改成"规格也是 `.scratch/<努力目录>/issues/` 里的一张票"的写法。两次改动都不含这个工作区文档里的措辞（"never hand-write ticket files""deck_context 先确认"等）。
- 在 deck 仓全历史里搜 `never hand-write ticket files` 没有命中（`git log --all -S` 为空），安装包里也搜不到；`docs/reports/20261022-bundled-skills-private-additions.html` 记录的是随包模板的四处私有补丁（规格是票、用 `deck_issue_create` 建规格、子票带类型标记、认领写 `Assignees`），并没有"根目录 `issues/`"这一条。**所以那个工作区的 tracker 文档是它本地写下的文档，不是插件随包生成的**，它和随包模板口径不同是预期内的事。
- 另外，`docs/adr/20260828-markdown-map-and-label-palette.md`、`docs/architecture/tracker-backend-design-contract.md` 第 5 节、`docs/tour/deck-call-end-to-end.md:49-81` 都按 `.scratch/<努力目录>/` 描述本地布局；ADR 20260828 同时明确"恒为单根树、不支持图嵌图"。这些文档描述的是"有地图的本地仓"，没有覆盖"一个 effort 都没有时票落哪"这种情况——这正是缺口所在。

### 5. 逐票里唯一的异常：10 号票的文件头顺序

现行建票写的文件头顺序是**幂等锚 → 类型标记 → 父注释 → 建票时间**（`src/tracker/rooms/markdown/issues-create.ts:193-199`）。补父注释的 `upsertParentComment` 也只在幂等锚与类型标记之后插入（`src/tracker/rooms/markdown/issues-patch.ts:304-322`）。

10 号票实际是：`<!-- parentKey: null -->` → `<!-- created: ... -->` → `<!-- DSH-IDEMPOTENCY-KEY: ... -->`。这个顺序**建票与补父两条现行路径都排不出来**，说明它的文件头被第三条路径改过（手工编辑、复制改写，或更早版本的构建）。它的正文也写明"本票为独立后续工作，不属于规格 06 本次交付范围，故不挂父子边"——那条 `parentKey: null` 是刻意显式写下的。这不影响其它 12 张票的判断，但建议顺手核实来源；不要为了"对齐格式"去手改这个文件。

### 6. 按 /to-spec 与 /to-tickets 逐条核对（用户更正后的口径）

核对对象是这两个技能的原文（本仓 `package/bundled-skills/to-spec/SKILL.md`、`package/bundled-skills/to-tickets/SKILL.md`）与磁盘上那 13 张票。10-13 不是这两个技能的产物（见本节末），不计入。

**/to-spec（规格 01、06）**

- 模板七段：两份规格都按 `## Problem Statement` → `## Solution` → `## User Stories` → `## Implementation Decisions` → `## Testing Decisions` → `## Out of Scope` → `## Further Notes` 的顺序写全（`to-spec/SKILL.md:23-71` 是模板原文）。符合。
- User Stories：01 有 12 条、06 有 16 条，都是编号的 "As … I want … so that …" 句；"LONG, numbered list" 这一条符合。小偏差：01 写成 "As a 插件读者，I want a 在任何一个仓的 README 里能一眼看到同一段……"，"a" 后面接中文从句，是把模板英文直译后的语法错误；意思读得懂，但不算通顺的英文句式。
- Implementation Decisions：两份规格只写决定（统一词、"反馈与联系"与"Feedback and Contact"两串锁死、图片统一 260、同步脚本做唯一执行缝、7 段视频用折叠嵌套等），没有写具体文件路径或代码；文件路径只出现在评论里。符合（模板在这段明确要求不写文件路径与代码片段）。
- Testing Decisions：两份都写了"只测外部行为"的原则、要测哪些模块、参照物与不测项（01 拿现有 README 渲染出的联系块当参照；06 拿文档纯文本当参照）。符合。
- Out of Scope / Further Notes：都有；Further Notes 里记了词汇依据和触发口令（01）、资产票与踩坑（06）。符合。
- 发布与标签：`to-spec/SKILL.md:19` 要求发布到项目 issue tracker 并打 `ready-for-agent`；两张规格都是 `kind=spec` 票、`Labels: ready-for-agent`，发布时（文件头 `created` 时间 06:50 / 13:12）即带该标签。符合。
- 测试缝（`:15` 要求选最高、最少的缝；`:17` 要求跟用户确认）：两份规格都把缝写进了决策——01 选"README 渲染后的联系块"这个最高缝、不新增测试缝；06 只用文档纯文本一处缝。但"与用户确认"这个动作没有留在文件里，无法核实。
- 不访谈用户（`:7`）：无法从文件核实；06 的"例外留痕：用户拍板用嵌套"说明这个决定来自另行发生的对话，没有在 spec 阶段重新访谈，方向上不冲突。

**/to-tickets（实施票 02-05、07-09）**

- 一票一文件、按依赖顺序发布：创建时间戳是 02 07:07:42 → 03 07:08:38 → 04 07:08:39 → 05 07:08:39，以及 07 13:33:19 → 08 13:33:28 → 09 13:33:36；被阻塞的票都在阻塞票之后建。符合 `to-tickets/SKILL.md:60-63`。
- 票面模板：7 张票都按 issue-template 写了 `## Parent`、`## What to build`、`## Acceptance criteria`、`## Blocked by` 四段（`to-tickets/SKILL.md:79-99`）。符合。
- 阻塞边：02 无阻塞；03、04 被 02 阻塞；05 被 03、04 阻塞；07 无阻塞；08 被 07 阻塞；09 被 07、08 阻塞；同时写在正文 `## Blocked by` 与字段行 `Blocked by: #02` / `#03, #04` / `#07` / `#07, #08`。边都是真依赖（02 是同步脚本与事实源定稿，03/04 才动正文；05 是两种语言都改完后的对账与演练）。符合 `:38`。
- 垂直切片与可验证：02 是"先让改动容易"的前置改善（技能允许先做 prefactor），03/04 按语言各切一条完整内容路径，05、09 是验收票；技能允许"verifiable on its own"的切片（`:31`）。大体符合。可挑剔的是 05 与 03/04 的边界：若把 05 并进 03/04，粒度会更粗但也站得住；这是粒度口味，不是违规。
- `ready-for-agent`：7 张票发布即带该标签（`:63`），实现完成后状态改 `resolved`。符合。
- 发布前的用户过目（`:42-53` 要求把票单编号列表给用户看粒度、依赖、合并拆分，迭代到批准）：文件里没有这一步的记录；从建票时间看，02-05 在约 1 分钟内连续建完、07-09 在十几秒内连续建完，像是用户在对话里一次批准后连续发布。无法核实。
- 本地文件形态（`:62`）：技能对 "Local files" 的字面要求是"每张票一个文件，放在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 起按依赖顺序编号"。实际放在工作区根 `issues/`，编号是全仓累计（01…13，06 的实施票从 07 起），不是每个 feature 从 01 重排。这两点与字面不符；但该仓 `docs/agents/issue-tracker.md:15-17` 写明 "If the skill text tells you to hand-write files, the deck usage in this document wins"，且根 `issues/` 是 deck Markdown 后端在"一个 effort 都没有"时的兜底落点（`issues-create.ts:75`），不是执行者绕开工具手写。所以按"技能字面"不符合，按"技能 + 该仓已配置的 tracker 文档"符合。
- 不关闭、不改父票（`:67`）：01、06 最后的 `resolved` 是 `/implement-spec` 收尾时按流程关的，不是 `/to-tickets` 这一步干的；10 号票摘父边也发生在后续工单里。没有发现违反这一条的痕迹。

**不属于这两个技能的票**：10 是 06 交付完另立的后续工作票（06 收尾评论写"英文重录已立独立后续票 #10（已摘除父子边）"），11-13 是按用户截图与反馈随手建的修复票；它们只写 `## Acceptance criteria`，没有 Parent / What to build，不该拿 to-tickets 的模板去要求。真要统一，补上三段没有实际收益。

**小结**：内容、关系、标签、发布顺序基本符合两个技能；与字面不符的只有两处——User Stories 的中英混插句式，以及本地文件目录与"每个 feature 从 01 编号"；无法从文件核实的是三处过程动作（测试缝与用户确认、发布前的票单过目、to-spec 的不访谈）。没有发现"技能禁止却做了"的事。

## 建议（三选一，先说清代价）

1. **继续走"规格 + 实施票"路线**：票留在根 `issues/` 是 deck 代码的正常兜底行为，工具能读能写。建议把"该仓的票放在工作区根 `issues/`，因为该仓没有 `.scratch/<努力目录>/map.md`"补进那个工作区的 `docs/agents/issue-tracker.md`（它现在只讲对象类型与标签，不写文件位置），并在 `AGENTS.md` 里点一句。代价：一次文档改动，不动任何票。
2. **要在这个仓跑 `/wayfinder`**：第一张地图用 `deck_issue_create` 建（`kind=map`）——它会落在根 `issues/NN-<slug>.md` 并带 `wayfinder:map` 标签（这是 deck 工具流程支持的形态），之后的 map-ticket 子票同样落根 `issues/`。不要先手写 `.scratch` 文件，也不要以为文档里的 map.md 布局是前提。
3. **要老的 `.scratch/<努力目录>/` 布局**：先让 `.scratch/<名字>/map.md` 出现（这一步 deck 工具不做，属于"人直接写文件"的旧流程），之后这个 effort 成立，deck 建票会自动落该 effort（单 effort 自动选，多 effort 必须给 `effortId`）。代价：13 张存量票要不要迁得单独决定；迁过去要重写父边与编号，容易把信息弄丢，只为"符合目录规范"不建议迁。

## 未解问题

- 13 张票具体是哪几次会话、由哪些工具调用建的：那个工作区没有版本库、没有会话日志，仓内证据只能判到"本地 Markdown 房间的建票格式"，判不到具体调用方；2026-10-23 当天安装的是哪个插件版本也无从考。
- 10 号票文件头顺序的来源（见上）。
- 两个技能里"过程性"的动作——to-spec 的测试缝与用户确认、to-tickets 的发布前票单过目、to-spec 的不访谈——文件里都没有记录，只能判"没证据"，不能判"没做"。
- deck 侧测试缺口：`tests/verify-1403-kind-two-layer.ts` 与 `tests/verify-1413-map-plan-two-layer.ts` 的夹具都先造 `.scratch/demo/map.md` 再用 `refId: '.scratch/demo'` 开会话（`verify-1413` :31-33、:71；`verify-1403` :32、:69），没有覆盖"零 effort 的根级 `issues/` 工作区 + 地图票"这个组合。如果这条布局要算正式支持，值得补一扇门禁。

## 来源清单

- deck 源码（仓库 `D:\dsh-plugin\dsh-mattpocock-skills-deck`，下同）：`src/tracker/rooms/markdown/path.ts`、`issues-create.ts`、`issues-locate.ts`、`issues-read.ts`、`parse.ts`、`issues-patch.ts`、`index.ts`；`src/tracker/session/open-tracker.ts`；`src/deck/rules/object-kind.ts`；`src/deck/tools/context.ts`、`map-snapshot.ts`。
- deck 文档：`docs/adr/20260828-markdown-map-and-label-palette.md`、`docs/adr/20260909-effort-identity-in-repository-ref.md`、`docs/adr/20260918-subworkspace-identity-root.md`、`docs/architecture/tracker-backend-design-contract.md`（§5）、`docs/tour/deck-call-end-to-end.md`、`docs/design/1277-md-spec-container.md`、`docs/research/markdown-init-wayfinder-panel-investigation-2026-08-28.md`、`docs/reports/20261022-bundled-skills-private-additions.html`。
- deck 技能原文：`package/bundled-skills/wayfinder/SKILL.md`；`package/bundled-skills/to-spec/SKILL.md`、`package/bundled-skills/to-tickets/SKILL.md`；随包 tracker 模板 `package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md`。
- 被调查的票正文：`D:\dsh-plugin\featherhunter-plugin-manage\issues\01-…` 至 `13-…`（逐张读过标题、七段或四段结构、用户故事条数、字段行与评论）。
- 已安装插件：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck`（version 1.9.0-beta.15）的 `tracker/rooms/markdown/path.js`、`issues-create.js`。
- 被调查的工作区：`D:\dsh-plugin\featherhunter-plugin-manage` 的 `issues/*.md`、`docs/agents/issue-tracker.md`、`docs/agents/workspace.yaml`、`AGENTS.md`。
- git 提交：`302ccfbba`（2026-09-23，抽取 `resolveCreateTarget`）、`65af9f2e`（2026-10-20，随包模板改成规格票口径）、`70addb90`（2026-10-22，随包模板还原上游原文）。
