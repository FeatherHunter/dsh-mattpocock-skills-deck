# 决策人自己的第一性原理复核（2026-10-12）

这一份是决策人亲手做的复核，不复述四路对抗式审查员的结论，只记我自己量到的数字与判断，便于以后对照。
四路审查员的报告另见 research/1010-adversarial-coverage.md、1010-adversarial-executability.md、1010-adversarial-graph.md、1010-adversarial-firstprinciples.md。

## 一、量的数字（可复核）

- 跟踪在库的 `.js` 共 859 个；排除 `package/`、`lib/`、`src/host/logPkg/`、`scripts/generated/` 与带 `AUTO-GENERATED` 头的派生产物之后，**手写 `.js` 共 705 个，约 13.5 万行**；手写 `.ts` 85 个。
- 按目录看手写 `.js`：`src/host` 162、`src/client` 135、`src/shared` 44、`tests/tracker-contract` 19、`src/seam` 7、`tests/fixtures` 7、`tests/lib` 5，其余散在 `tests/` 各 verify 脚本、`examples/`、`docs/prototype`。
- 「deck 链路 + 两个后端房间 + 最底层」这几个目录下，去掉派生产物后手写 `.js` 共 **141 个**；其中 **112 个**在迁移映射表 `research/1010-migration-map.json` 里，**23 个不在**（映射表把 `src/client/**`、`src/shared/** 其余件` 一刀切成范围外）。

## 二、我自己找到的覆盖漏洞（比审查员先量到的部分）

### 2.1 一刀切把 deck 链路真正引用的共享件切掉了

映射表范围外那句「`src/client/**`、`src/shared/** 其余件`、`refresh-core` 等四个计算核：不在本次任务内」是**按目录切**，但 deck 链路实际 import 了 `src/shared/` 下若干手写文件。用 grep 逐个查到引用者：

| 文件 | 行数 | 谁在用（deck 链路内） |
| --- | --- | --- |
| `src/shared/tracker/constants.js` | 145 | 两房与跟踪器核心里约 40 处；契约里的 `ErrorKind` 八值、`STATE`、`ISSUE_TYPE` 就是它的形状 |
| `src/shared/tracker/outbound-tiers.js` | 83 | `src/host/tracker/backends/github/client.js:15`（gh 分档超时） |
| `src/shared/tracker/outbound-admission.js` | 181 | `src/host/tracker/backends/github/client.js:16`（同时在飞的 gh 进程上限，就是那道闸） |
| `src/shared/refresh/chain-ride.js` | 53 | `src/host/repoKeys.js:13`、`.../github/client.js:17`、`src/host/detectChain.js:6` |
| `src/shared/refresh/refusal-text.js` | 33 | `src/host/refresh/gate.js:25`（被拒时回给 AI 的话） |
| `src/shared/labels.js` | 25 | `.../github/index.js:16`（`CANONICAL_LABELS` 单源标签清单） |
| `src/shared/tracker/initProjectErrorKinds.js` | 42 | `.../github/init-project.js:12` |
| `src/shared/tracker/workspaceOwnership.js` | 84 | `.../github/init-project.js:13` |
| `src/shared/tracker/deck-derive.js` | 243 | `src/host/tracker/index.js:17`、`snapshot.js:26`（面板与 deck 共用投影） |
| `src/shared/parser.js` | 117 | `src/host/tracker/snapshot.js:27`（`parseProgress`，正是能力图 15 要用的进度解析） |

十份合计约 1000 行。对照 #1010 的范围第 3 条「围绕 deck 工具全部能力的每一份代码，都在本次任务内」，这十份在范围内却在计划外；
而且其中 `constants.js` 是契约词表、`outbound-admission.js` 就是那道闸、`parser.js` 的 `parseProgress` 是能力图 15 的原料，
漏掉它们会让「契约写得对」「闸转了」「进度能读」三件事都悬空。

生成物不在手写范围，已核实三份：`src/shared/refresh/idempotency.js`（由 `refresh-core` 生成）、`src/shared/label-color/colors.js`（由 `label-color-core` 生成）、`src/shared/config-store/labels.js`（由 `config-store-core` 生成）。

### 2.2 规格与票结构已经对不上（规格要改）

`specs/1010-ts-rewrite-spec.md:30`（用户故事 9）说票号按「注册与装配 → 工具入口 → 工具壳 → **日志** → 契约 → 注册表 → 识别判定 → GitHub 房 → Markdown 房 → 宿主接线 → 横切」编，`:85` 写的新树也把「日志」当成一个单元；
但第二轮审查已判定「日志是横切，不该独占旅途的一段」，最终票结构里没有「日志」地图，日志改成两处承载：地图 01 的 `#1016`（机制、字段表、门禁、《日志导读》）加每张开发票的一句验收（`#1016` 票面已写明）。
规格里那两处需要改成最终结构，否则以后有人照规格找「日志那一票」会找不到。

### 2.3 有一张票的边界已经做掉大半

`#1026`（地图 02：`getRepoPermissions` 升进契约与门禁收尾）——契约里已经落地：`src/tracker/contract/operations.ts:238` 已有 `getRepoPermissions?`，`results.ts:81`、`README.md:46`、`backend-module.ts:10` 都写了它的归属；
现在真正剩的是「为什么仍是可选、两房各自怎么实现、门禁怎么覆盖」。票面要么改窄，要么并进 `#1027`。

### 2.4 第 0 层能开工的票是 14 张讨论票

按依赖边算，现在零前置的是 14 张讨论票（地图 13 没有讨论票）。这与维护者「严格串行推进」的偏好看起来冲突，但维护者也说过「可以开出来让他挑感兴趣的」——我判断这是特性不是缺陷，需要维护者一句话确认；如果要真串行，只需给讨论票之间加一条链式边。

### 2.5 票面与文档里两个计数是错的（已确认，待改）

- `#1010` 正文的决策行、我那条建票评论、`research/1010-ticket-structure.md` 第十二与十三节里写的「68 张子票」「101 条原生阻塞边」**都不对**。
- 实测（`gh api` 逐图读 `sub_issues_summary.total`）：地图 01 十张、02 四张、03–07 共十六张、08–12 共二十一张、13–15 共十五张 = **66 张子票**；加 15 张地图共 81 个节点。
- `.tmp/graph-check.ps1` 读回全部 81 个节点的 `blocked_by`：**118 条边**，全部指向本批内部（0 条指向旧票），无环，最长链 10 层。
- 开工面：第 0 层 29 个节点 = 15 张地图 + 14 张讨论票。

### 2.6 契约层现在是「没人用的孤岛」，而且已经被别人改了两轮

- `src/` 下没有任何文件 import `src/tracker/contract`（唯一命中是 `tests/.tmp-repo-out/registry.js` 这类临时产物），也就是说契约眼下只被它自己的门禁检查，还没有约束任何真实代码。
- 契约刚立起来就被同一批工作线改了两轮：`186865a0`「契约类型按真实读法修正，让两个房间照契约实现时编译得过」、`172334ac`「补上契约里两处接不住房间真实读法的成员」。文件从拆完时的 `contexts.ts` 70 行、`results.ts` 121 行、`backend-module.ts` 206 行、`inputs.ts` 120 行、`operations.ts` 349 行，长到现在 188 / 132 / 221 / 129 / 352 行。
- 结论：契约「写得对」这件事靠人工两轮纠错才勉强站住，说明缺一条自动的「房间照契约实现」探针。地图 02 的开发票里必须加一件：写一份只做类型检查的贴合探针（在 `.ts` 里 import 那座房间的 JS 入口，把它的导出赋给契约的 `BackendModule` 类型），房间与契约不一致时当场变红——两房各一份，各自加进门禁。
- 今天这扇门禁是绿的（我跑 `node tests/verify-contract-types.js`，七项 PASS，exit 0），但它只查类型自身，不查房间。

### 2.7 两道相邻边界都说自己做完了

- `#1003` 最新评论：「维护者拍板的五件事已落地，六扇门禁全绿……本票可以关」，补记里说上次那条红已由并发线修好。
- `#1012` 最新评论：「交接文档里剩下的四件事已经全部落地……全链在 `9a57ee9d` 上跑完 231/231 步、真红 0 步」。
- 若属实，我先前担心的「13 个文件重叠、要等它们收口」这层风险基本消失（审查员正在逐条量）。但 `#1012` 那条评论还报了一处**尚未拍板的缺口**：调试开关的真源搬到本机设置文件之后，宿主 `src/host/logStore.js:104-107` 仍拿旧副本当闸门，日志被静默丢掉，`handleLogBatch` 还回 `dropped:0`。这一处正落在我们的日志地图（`#1016`）地界里，票面要写进去。

### 2.8 工作区还留着两个未跟踪文件

- `research/1010-adversarial-lead.md`（本文件，等四路报告到齐后定稿提交）与 `research/_scratch_referrers.txt`（我做引用面统计时的临时输出，提交前删掉）。

### 2.9 一整套 4055 行的契约验收套件不在任何票里

- `tests/tracker-contract/` 共 23 个文件、4055 行：`harness.js` 133 行、`runner/index.js` 299 行、`sections/` 十一个断言段（`contract.js`、`deck.js`、`registry.js`、`labels.js` 737 行、`snapshot.js` 433 行、`idempotency.js` 500 行、`listPage.js`、`counts.js`、`preflight.js`、`chain.js`、两份反证）、`fixtures/` 里 GitHub 与 Markdown 两房的真实回执（raw 与归一化各若干）、`README.md` 与 `ONBOARDING.md`；入口 `tests/verify-tracker-contract.js` 就挂在验证链里。
- 我把计划文档翻了一遍：`research/1010-*.md`、`specs/1010-ts-rewrite-spec.md`、`docs/adr/20261011-deck-ts-rewrite.md` 里**一处都没提它**。也就是说这 4000 多行手写 JS 既没人认领转 TypeScript，也没人负责在房间改写时保它绿——而房间一改，它就会红。
- 它还正好是两样东西的现成缝：`fixtures/github-real/` 与 `fixtures/markdown-real/` 里的真实回执是「金标准回执」的雏形（`#1015` 要建的那个）；`harness.js` 与 `sections/contract.js` 已经在按契约验收后端实现，两房「贴合探针」（2.6 的 P4）应当长在这里，而不是另起一套。
- 它引用了迁移映射表判为范围外的 `src/host/tracker/capability.js`（`harness.js:16`），说明这个文件的去留也被这条线牵着。
- 另有一处口径冲突：映射表 `outOfScope` 写着「`src/shared/**` 其余件不在本次任务内」，但 11 号地图的覆盖对象里明确列了 `src/shared/refresh/budget.js`、`tool-cost.js`；`unchangedSpecifiers` 也把 deck 工具对这两份的引用记为「不进本次搬家」。同一个文件在两份计划里一处「不动」一处「要转」，必须由票面拍一个说法。

### 2.10 映射表判为「deck 调用链不经过」的文件里，有几个其实经过

映射表 `outOfScope` 把 `src/host/tracker/{capability,generic,predicateCore,predicatePrimitives,snapshot}.js` 判为「属检查链与谓词那一摊，deck 调用链不经过」。实测引用面：

- `src/host/tracker/snapshot.js` 被 `src/host/sessionRefresh.js:68`、`:239` 与 `src/host/sessionSnapshot.js:107`、`:272` 引用——而快照四件正是 11 号地图的覆盖对象，这条链就是面板与 `deck_map_snapshot` 取数的那条。判错。
- `src/host/tracker/generic.js`、`predicateCore.js`、`fixContract.js` 被 `src/host/detectChain.js:112`、`:113`、`:224` 引用，而识别判定正是 07 号地图。
- `capability.js` 只被 `tests/tracker-contract/harness.js:16` 引用（见 2.9）。
- `predicatePrimitives.js` 全仓无引用（死件，另立判断）。

结论：这几份不该按「不经过」一刀切掉；要么进范围，要么写明为什么真的不动。

## 三、我不同意审查员的地方（等四路报告到齐后补）

## 四、我据此决定要动的票与文件（等四路报告到齐后一起动手）

- **P1 计数更正**：`#1010` 评论区补一条更正（66 张子票、118 条阻塞边），作废我那条建票评论里的 68 与 101。正文里那两处**已经改好**（2026-10-12 13:20 用 `gh api -X PATCH` 写回并读回确认）。
- **P2 `#1010` 正文重排**：现在正文把决策写在 `## Decisions-so-far`（带连字符）里，规范名字是 `## Decisions so far`；而 `src/shared/parser.js:38` 只把 `- [` 开头的行当决策，所以这些决策在面板与地图视图里**一条都看不见**；末尾还留着两个空区块（`## Decisions so far`、`## Not yet specified`）。重排：改名成规范标题、决策条改成 `- [标题](链接) — 一句话`、`## Fog` 的内容挪进 `## Not yet specified`、边界归属表单独成区。
- **P3 `#1026` 收窄**：`getRepoPermissions` 已在契约里落地（`operations.ts:238`、`results.ts:81`），票面要改窄或并入 `#1027`。
- **P4 地图 02 开发票补一件**：两房「贴合探针」——在 `.ts` 里 import 房间 JS 入口并把导出赋给契约类型，房间与契约不一致当场变红（见 2.6）。
- **P5 规格对齐**：`specs/1010-ts-rewrite-spec.md` 两处改成最终结构（用户故事 9 的编号顺序、新树里的「日志」单元）。
- **P6 覆盖漏洞落地**：2.1 那十份 `src/shared` 手写件要进票结构（`constants.js` 靠近契约图、`outbound-*` 靠近闸/房图、`parser.js` 靠近能力图 15、`deck-derive.js` 靠近快照或注册表图）。按「谁在用」先排一版落点，等审查员报告到齐再定：
  1. `constants.js` → 地图 06（跟踪器顶层与共享词表；它是契约里 `ErrorKind` 八值的真源）
  2. `tracker/outbound-tiers.js`、`tracker/outbound-admission.js` → 地图 11（出站分档与在飞上限就是那道闸）
  3. `refresh/chain-ride.js` → 地图 11（`repoKeys.js` 与 GitHub 房都用它串链），`detectChain.js` 那一头同时挂到地图 07
  4. `refresh/refusal-text.js` → 地图 11（被拒时回给 AI 的话，就在闸里）
  5. `labels.js`（`CANONICAL_LABELS`）、`tracker/initProjectErrorKinds.js`、`tracker/workspaceOwnership.js` → 地图 08（三份都只被 GitHub 房用）
  6. `tracker/deck-derive.js` → 地图 06 或 12（面板与 deck 共用的投影，`snapshot.js` 在用）
  7. `parser.js` → 地图 15（它里面的 `parseProgress` 正是进度解析要改的那件）
- **P7 日志票补缺口**：`#1016` 票面写进 `src/host/logStore.js:104-107` 那个「副本仍是实际闸门、`dropped` 恒 0」的问题（`#1012` 报的）。
- **P8 收尾**：删掉 `research/_scratch_referrers.txt`，把本文件定稿后提交推送。
- **P9 契约套件要有归属**：`tests/tracker-contract/`（2.9）在 01 号地图下新开一张开发票（暂名「地图01开发：契约验收套件与两房贴合探针」），内容是这 4000 多行转 TypeScript、`#1015` 的金标准回执不要另起一套而是长在 `fixtures/*-real/` 上、两房贴合探针长在 `harness.js` 旁边；同时把 `#1015` 票面改成「扩现成缝」而不是「从零建」。
- **P10 范围口径要拍一个说法**：映射表说 `src/shared/**` 其余件不动，11 号地图却点名要转 `budget.js`、`tool-cost.js`；2.10 又查出 `tracker/snapshot.js`（被快照四件用）、`tracker/generic.js`、`predicateCore.js`、`fixContract.js`（被 `detectChain.js` 用）不是「deck 调用链不经过」。改法：11 号地图的开发票正文里列全它要碰的文件清单，映射表 `outOfScope` 那一行改成写清「哪些真不动、为什么」。
- **P11 待维护者一句话（终稿要问）**：14 张讨论票同时可开工，与「严格串行推进」的偏好相反；要真串行只需在讨论票之间加一条链式边。这一条要写进汇报里请他拍板。

