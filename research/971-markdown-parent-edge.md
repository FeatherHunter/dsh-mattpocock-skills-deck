# #971 调查：markdown 后端父边 9/9 建边失败、快照数不清子票，今天的树里还能不能复现

> 调查日期 2026-10-15 · 只读调查，未改任何源码、测试或配置
> 现场：分支 `main`，HEAD `f3da13da`（与 `origin/main` 同一提交）
> 工作树另有别的会话正在改的东西：调查开始时未提交改动是 5 个文件（`src/tracker/contract/backend-module.ts`、`src/tracker/rooms/github/checks.ts`、`src/tracker/rooms/github/index.ts`、`src/tracker/rooms/gitlab/index.ts`、`src/tracker/rooms/markdown/index.ts`；markdown 那一处只是补了 `satisfies BackendModule` 与一行类型 import），调查期间又多出 `src/tracker/contract/README.md` 等改动，说明那个会话还在动。本次调查一个源码文件都没碰，本文的所有判断都不依赖这些改动。

## 一、票面症状（原话摘要）

票 #971 记录的是 v1.7.51 时代的一次真实事故：在 markdown 后端的工作区里，用 `deck_map_plan_create` 一次建 1 张地图票加 9 张子票加 9 条父边，10 张票全建成，但 9 条父边 9/9 失败，整体报 `status: partial, reason: backend-unsupported`；每条边都回 `status: failed, op: parent, target: 01`，落点是「做不到」，证据是「后端原话：markdown setParent unsupported (single-root)」。

连带的现象还有两条：一是子票文件里其实已经落了 `<!-- parentKey: 01 -->` 注释（9/9），也就是边接口拒了、文件层级关系却写了；二是 `deck_map_snapshot(01)` 报子票 0 张（`closed/total = 0/0`），并附注「这个后端的清单接口没带父子信息」，用户只能逐张 `deck_issue_get` 人肉数 parentKey。

票里的诊断把根因拆成两条：父子列写死成固定值而不是从文件读回（注释只写不读，扁平布局下地图不是 00 号，按地图筛选恒为 0），以及改父接口对同目录无条件报做不到（建图时建票已带父，随后为同值又补一次边，第二次必败）。当时的实施说明写明已按期望 A 修好并推到分支 `fix-971-markdown-parent`，待合入主分支后重跑一次再关票。

## 二、今天的代码对应物

### 1. 工具层（调用方）

- 建地图票：`src/deck/tools/map-plan-create.ts:264-267`，`t.create` 传 `type: 'map'`，不带 `parentKey`。子票：`src/deck/tools/map-plan-create.ts:320-324`，`parentKey: state.mapKey` 随建票一起传下去。
- 建父边：`src/deck/tools/map-plan-create.ts:370-378`，每张子票调一次 `applyParentEdge`（`src/deck/shell/edge-landing.ts:141-163`）。这个函数先调 `setParent`，再 `get` 读回一次，只有读回的 `parentKey` 等于目标才算落上（`edge-landing.ts:155-156`）。
- 逐项校验：`src/deck/tools/map-plan-create.ts:400-410`，用 `t.list(repo, { parentKey: state.mapKey })` 列一遍，再交给 `childrenOf` 挑子票。
- 挑子票的判据：`src/deck/shell/edge-landing.ts:89-106`。它先看这批行里有没有哪一行带了 `parentKey`：带了就按 `parentKey === mapKey` 筛；一行都没带，才回退成「原样列出」并附上那句「这个后端的清单接口没带父子信息……请逐张用 deck_issue_get 看 parentKey」。票面连带证据 2 里那句附注就是这一处发出来的。
- 快照：`src/deck/tools/map-snapshot.ts:119` 取 `t.list(repo, { parentKey: key })`，`map-snapshot.ts:136` 同样交给 `childrenOf` 数子票。
- 单张读回的落点判定：`src/deck/tools/issue-get.ts:205` 用 `EDGE_LANDING.CONTRACT_PARENT_FIELD`；纯判据在 `src/deck/rules/edge-landing.ts:150`（读回的 `parentKey` 等于目标就记「契约的父子列」）。

### 2. Markdown 房

- 读回父票编号：`src/tracker/rooms/markdown/parse.ts:78-92` 的 `parentKeyFromFile`，只认文件头（标题之前的那几行）里的 `<!-- parentKey: ... -->`，数字补成两位，空值/`null`/`none`/`-` 都归成「没有父票」。正文里举例写同样一行不算数。
- 读回时怎么用：`src/tracker/rooms/markdown/parse.ts:280-297`。地图文件恒为空父票（`parse.ts:282-283`），正文写着 `Type: map` 的计划外地图同样视作没有父票（`parse.ts:286-287`），其余票有注释就以注释为准，没有注释的老文件才回落到调用方递进来的固定值（今天是 `00`，`parse.ts:289`）。
- 建票写注释：`src/tracker/rooms/markdown/issues-create.ts:154` 把 `<!-- parentKey: X -->` 写在文件顶；`issues-create.ts:347-350` 地图的父为空，其余票没给父才回落 `00`。
- 改父：入口 `src/tracker/rooms/markdown/issues-patch.ts:341-347`，主体 `issues-patch.ts:400-447`。地图文件本身只有「解除」成功，其余一律如实报做不到（`issues-patch.ts:417`，原话是 `markdown setParent unsupported (map has no parent)`）；其余票在同一个工作单元内改父走 `writeParentLink`（`issues-patch.ts:425-437`），跨工作单元才失败（`issues-patch.ts:443`，原话 `markdown setParent unsupported (cross-effort A -> B)`），父票根本不存在报 not-found（`issues-patch.ts:446`）。
- 同值不再写、也不报失败：`src/tracker/rooms/markdown/issues-patch.ts:374-380`。写之前在写队列里先读盘上那一份，`cur.known && cur.key === want` 就直接返回「不用改」，整趟算成功。这正是票面「建票已带父、随后又为同值补一次边」那一趟。
- 列举按 parentKey 筛：`src/tracker/rooms/markdown/issues-read.ts:242-245`，`filter.parentKey` 给了值就按它筛，给了 `null` 就只留没有父的票。枚举阶段传下去的回落值在 `issues-read.ts:102-109`。
- 能力登记：`src/tracker/rooms/markdown/capability-register.ts:62-66`，`setParent` 今天记的是 `partial`，缺口只有一条——跨工作单元改父不认（「目录即父子」，跨目录等于搬文件）；`capability-register.ts:72` 里 `listSubIssues` 是 `unsupported-by-design`，房里在 `src/tracker/rooms/markdown/index.ts:294` 放了一条显式桩，回 `markdown listSubIssues unsupported`。`setParent` 的出口在 `index.ts:278`。
- 票面提到的 `single-root` 限制：今天在 `src/` 与 `tests/` 全树搜不到 `single-root` 这个词，也没有任何「单根」守卫。`src/tracker/rooms/markdown/write-guards.ts` 今天只管阻塞环判定（`write-guards.ts:78-80`），与父子无关。换句话说，那条措辞与它代表的那条规则都已经不在树上了。

### 3. 宿主与面板侧

- 宿主快照按 `(effortId, parentKey)` 分组：`src/host/tracker/snapshot.js:90-95`。
- 宿主电话 `wf.mapTickets` 是唯一还在调 `listSubIssues` 的地方：`src/host/mapTickets.js:107`、`mapTickets.js:121`、`mapTickets.js:126`。markdown 后端回的 `unsupported` 会被翻译成「这个后端不支持按需取一张地图的子票」（`mapTickets.js:126`）。
- 客户端不读 `parentKey`，也不调 `listSubIssues`（`src/client` 下只有提示词文案里出现过 `parentKey`，`src/client/kernel/prompts.js:224-225`），子票清单与统计都由工具层与宿主算好再下发。

## 三、判定

**（b）已被新结构消除**：今天在 `main`（`f3da13da`）上找不到一条能复现票面这条缺陷的代码路径。

依据：

1. 票面两条根因的代码都已经不在今天的树上。父子列不再写死：`parse.ts:280-290` 以文件头注释为准，地图恒为空。改父接口对同目录不再无条件报做不到：`issues-patch.ts:374-380` 同值直接在队内判「不用写」，`issues-patch.ts:425-437` 同单元改父照常成功。`single-root` 这句原话全树零命中，票面那条错误回执已经不存在。
2. 修复本身就在今天的主线上。票面实施说明里的两个提交 `5a79f44f`（第一次修复）与 `9d5dd3c8`（对抗审查加固）都是 HEAD 的祖先（`git merge-base --is-ancestor` 判定为是），防回归测试 `tests/verify-971-markdown-parent.js` 已跟踪并挂在 `package.json` 的 `verify` 链里。
3. 那条防回归测试今天跑出来 14 条全绿：扁平工作区建 1 地图加 2 子票加 2 父边整体 `ok`、边逐条 `ok`、地图自身没有父票、子票读回父是地图、快照子票数为 2 而不是 0、单根布局按 `00` 列出 2 张、不存在的父如实失败、同目录同值改父成功、正文举例注释不劫持归属、整份替换正文后父还在。票面连带证据 1（注释写了但接口拒了）与证据 2（快照 0/0 加那句附注）在这条路径上都不再出现。
4. 附注那句「这个后端的清单接口没带父子信息」今天还在代码里（`edge-landing.ts:96`），但触发条件是**整批行里没有任何一行带 `parentKey`**。markdown 房今天每张票读回来都带 `parentKey`（有注释用注释、地图为空），所以票面那个场景不再触发它——只有「按某张地图筛出来是空表」这类情况才会看到这句提示。

## 四、今天仍然存在的相邻限制（不是这条缺陷）

- **跨工作单元改父仍如实失败**：`issues-patch.ts:439-446`，能力登记表把它记成 `partial`（`capability-register.ts:62-66`），理由写得很清楚——本地是「目录即父子」，跨目录等于搬文件。走 `deck_map_plan_create` 建图不会碰到它：地图与子票都用同一个 repo（`map-plan-create.ts:264-267`、`map-plan-create.ts:320-324`），落在同一个工作单元里。只有人手工用 `deck_map_link` 把一张票挂到别的工作单元的地图上时才会看到这条失败，而且它是诚实失败、不是假装成功。
- **`listSubIssues` 在 markdown 房仍是不支持**：`index.ts:294` 与 `capability-register.ts:72`。但 deck 这一套工具与快照都不走它——快照与逐项校验走的是 `list({ parentKey })` 加 `childrenOf`（`map-snapshot.ts:119`、`map-plan-create.ts:400`），所以票面期望 A 里说的「快照要能按目录枚举子票、数得出来」是通过列举接口实现的，不需要 `listSubIssues`。真正受影响的是宿主那条 `wf.mapTickets` 电话（面板按需取一张地图的子票），它今天对 markdown 仍然回「这个后端不支持」。
- **没有父注释的老文件仍回落 `00`**：`parse.ts:289` 与 `issues-read.ts:102-109`。这是刻意保留的老数据行为。副作用是：在扁平布局（地图不是 `00` 号）里，一张从来没给过父票的根票读回来会显示父票 `00`，而那个编号可能根本不存在。这不是票面那条缺陷（票面场景里的子票文件都带着注释），但如果以后要清理这条回落，这是唯一还留着「固定值」味道的地方。

## 五、不确定处

- 票面说「待合入主分支后在 dsh-log 工作区用原计划标识重跑一次」再关票。本文只验证了代码与门禁，没有在 `D:\dsh-plugin\dsh-log` 那个真实工作区重跑建图，所以「原现场是否已经恢复正常」这件事本文不下结论。要落实的话，需要在那个工作区带同一个 `planId` 重跑一次 `deck_map_plan_create`，看整体是否 `ok`、快照子票数是否为 9。
- 本次没有跑 `npm run verify:all`（按要求不跑全链），只挑了与本票直接相关的几道门禁，结论以这几道为限。
- 工作树里别的会话留下的 5 个文件未提交改动没有参与判断；其中 `src/tracker/rooms/markdown/index.ts` 的改动只是补类型断言，不影响本文任何一条 `file:line` 的语义。

## 六、若真要处理该怎么做

这张票本身已经不需要再改代码：缺陷在今天的树上已被消除，剩下的只是「回原工作区重跑一次确认，然后关票」。如果还想再往前走一步，可以另立一张小票把 markdown 房的 `listSubIssues` 桩换成「按工作单元目录枚举子票」的真实现，让宿主那条 `wf.mapTickets` 电话在本地后端也能用——那是面板按需取子票的能力缺口，与 #971 的症状是两件事。

## 附：本次跑过的只读验证

- `node --import ./scripts/ts-hook.mjs tests/verify-971-markdown-parent.js` → 全部通过（14 条）
- `node --import ./scripts/ts-hook.mjs tests/verify-deck-tools.js` → 全部通过（九个工具 93 条）
- `node --import ./scripts/ts-hook.mjs tests/verify-790-parent-edge.js` → 全部通过（17 条）
- `node --import ./scripts/ts-hook.mjs tests/verify-1060-edge-log.ts` → 全部通过（关系与边的结论线每一档都走到）
- `node --import ./scripts/ts-hook.mjs tests/verify-691-map-subissues.js` → 全部通过
