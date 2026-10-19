# 本地 Markdown 后端的规格容器（#1277）

这份文档记本地 Markdown 后端怎么支持「规格作为容器」这件改造：做什么、分成哪两半、票面文件长什么样、
快照怎么组装、旧的票怎么兼容、哪些视图先兜住、哪些刻意不做。上游定版见
`docs/adr/20261020-object-kind-identification.md`（#1275）与地图 #1274；视觉那一半见
`docs/design/1286-implementation-map-visual.md`（#1286）。

## 1. 为什么要做

探索地图（map）已经是容器：一张 `map.md` 下面挂一堆 `issues/NN-slug.md`，快照把地图放进
`snapshot.maps`、把子票放进地图的 `tickets`。实施地图要的是同一种结构再深一层——规格（spec）当容器，
实施票（ticket）挂在规格下面。GitHub 后端已经能靠正文首行的隐藏标记认出规格（#1286 落地）；本地
Markdown 后端的读取逻辑只认地图，规格要么变成普通票、要么根本认不出来，所以本票把本地这一条车道补齐。

改造按两张地图上已经定下的口径分成两半，两半合起来才算完成：

- **A 是模型改造**：标记语法与搬回规则落成一个共享包；本地房建票时写标记、读票时认标记、整份替换正文
  时保住标记；`deck_issue_create` 的 `kind` 认识规格与实施票，并自动把标记写进正文。
- **B 是视图兜底**：宿主组装快照时，遇到「后端没把类型标成规格、但票面文件头里明明有规格标记」的行，
  仍然把它当成规格容器放进快照。这样别的后端（今天最现实的是 GitHub 写侧，见第 7 节）暂时没跟上时，
  界面不会把规格降级成一张普通票。

两张地图的正文里只写了「A（模型改造）+ B（视图兜底）」这两个词，没有写它们的边界；上面这两段就是本票
对它们的定义，后面所有改动都按这两段分。

## 2. A：本地房的票面长什么样

规格票就是 effort 里的一张普通票文件，和其他票同一个目录、同样编号：

```
<effort>/issues/NN-<slug>.md
```

文件头从第一行开始按固定顺序排列注释行，然后才是一级标题与字段行：

```
<!-- DSH-IDEMPOTENCY-KEY: ... -->   ← 幂等锚，建票时由 deck 工具给
<!-- DSH-ISSUE-KIND: spec -->       ← 对象类型标记，本票新增
<!-- parentKey: 00 -->              ← 归属：规格挂在探索地图下
<!-- created: 2026-10-20T...Z -->
# 规格标题

## 问题陈述
...
Status: ready-for-agent
Blocked by:
Labels: ready-for-agent

## Comments


## Answer

```

四条约定，改代码时不能破：

1. **标记是唯一真源，`Type:` 行不再承担规格**。ADR 2.1 已把 `Type:` 候选值收回到
   `research / prototype / grilling / task` 四个老值，本地房不再写、也不再读 `Type: spec`。票面标题里
   说的「Type: spec」在实现上落成上面那行文件头标记。创建时如果调用方传进来一个 `Type: spec`，按标记
   处理并把这行丢掉，不写进文件。
2. **标记只写类型名**，不写父票号、不写引用。归属一律走父子关系：本地房是文件头
   `<!-- parentKey: NN -->`，规格挂探索地图（`00`），实施票挂规格的票号。
3. **标记允许丢失**。整份替换正文时以盘上那一份为准把标记搬回来；建票时把传入正文里已有的标记行剥掉，
   最多写一条；读票时标记丢了就按普通票处理，不因此判错（ADR 2.4：没有「没认出来」这一档）。
4. **标记语法只写一份**。标记的语法、识别、写行、剥行，都放在新共享包 `src/shared/issue-file/` 里；
   本地房、宿主组装层、deck 工具都引这一份，不各写一遍。「这段正文算不算一整份票面」的判据
   （`isWholeIssueBody`）这次**不**搬：纯规则目录 `src/deck/rules/` 今天只许引契约层，把判据搬进
   共享包等于给规则层开一条新依赖；两份手写继续互相盯着（`src/deck/rules/minimal-spec.ts` 与
   `src/tracker/rooms/markdown/parse.ts` 的注释里已有「改一处必须改另一处」的约定），等 #1275
   落地清单里那次规则层改造一起收。

共享包里的对外函数（名字就是调用方看到的名字）：

- `markerLineFor(kind)`：给一行可写入的标记文本，结尾带换行。
- `markerKindOnLine(line)`：只认整行、去首尾空白后精确等于 `<!-- DSH-ISSUE-KIND: <kind> -->`。
- `markerKindInHeader(text)`：只看文件头——第一个一级标题之前（没有一级标题时只看前 10 行，与本地房
  读 `parentKey` 的口径一致），返回第一枚合法标记的类型。
- `markerKindAtStart(text)`：只看第一个非空行（GitHub 正文与 deck 工具注入的正文都是这个形状）。
- `stripMarkerLines(text)`：剥掉所有合法标记行，用于建票与整份正文合并。
- `countMarkerLines(text)`：数整行标记有几条（建票单例核对、整份替换的「不许变多 / 不许弄丢」核对用；
  不在别处用正则数子串，否则正文里引用一句标记写法也会被算成一条）。
- `isHeaderOnlyKind(kind)`：这个类型是不是「只在文件头写标记」的两类（spec / ticket）；deck 规则与工具
  靠它判断要不要补进度区、要不要往正文写标记。
- `isSpecHeaderMarked(text)`：票面文件头写的是不是 spec 标记；快照组装层与 deck 列表的视图兜底共用这一处。
- `OBJECT_KINDS` / `ObjectKind` / `isObjectKind`：九个合法类型值与类型收窄（ADR 2.1），写侧用它挡住
  拼错的类型名。

## 3. 读、写、改三条路各改哪里

**读（`src/tracker/rooms/markdown/parse.ts`）**：`parseMd` 在决定 `type` 的那一行之前先看文件头标记；
标记是 `spec` 时把契约类型置成 `spec`，其余情况维持今天的行为（地图文件仍由 `isMap` 决定）。标签与
`Type:` 行不参与这里的判定。

**写（`src/tracker/rooms/markdown/issues-create.ts`）**：`buildIssueText` 在「幂等锚之后、parentKey 与
created 之前」写标记行；标记值从调用方传进来的 `type`（`spec` 或 `ticket`）取，也接受正文第一行的标记
（deck 工具就是往正文最前面写标记的）。`cleanWholeBodyForCreate` 与 `checkSingletonsForCreate` 同步
加两条：剥掉正文里的标记行、文件头标记至多一条。`spec` 与 `ticket` 不写 `Type:` 行。

**改（`src/tracker/rooms/markdown/patch-body.ts` 与 `issues-patch.ts`）**：整份替换正文时
`mergeWholeBodyForPatch` 把盘上的标记搬回锚之后；`checkNoWorseForPatch` 加两条判据——标记变多或盘上
有的标记被改丢，都判「改正文核对没过」。补父票注释的插入位置必须认得标记行：父注释插在锚与标记之后，
不把标记挤到一级标题后面。

## 4. B：快照怎么把规格兜成容器

`src/host/tracker/snapshotAssemble.ts` 在组装前先做一遍「行种类归一」：

1. 行上 `type` 是 `map` 或 `spec`：原样采用（后端已经标对了）。
2. 否则看 `row.body` 的文件头——第一个一级标题之前（没有一级标题时看前 10 行，与本地房读
   `parentKey` 的口径一致）：标记是 `spec` 就浅拷贝一份、把 `type` 改成 `spec`，
   后续容器判定、`issues` 池过滤、子票挂载全用归一后的行。
3. 其余行保持普通票。

归一之后，今天那段「`maps` 收 `map`/`spec`、`issues` 排除容器与已挂载子票」的逻辑不再改口径。三层结构
因此天然成立：地图的 `tickets` 里有规格行，规格的 `tickets` 里有实施票；实施票不再作为普通票重复出现
在 `issues` 里。`deck` 派生层（`src/tracker/deck-derive.ts`）仍然把「各容器的子票并集 + 普通票」当
票池，实施票会通过规格的 `tickets` 正常进池、进统计，不需要另开一条路。

B 兜底先覆盖这三处视图（由快照数据喂，不单独改界面）：

- 容器列表里的规格卡与它的三态按钮（`container-view.ts` 已经按 `type==='spec'` 认容器）；
- 规格详情页的七节正文与实施票清单；
- `deck_issue_list` 的按类型过滤：加 `spec` 一档，`type=issue` 时排除地图与规格，`type=spec` 只回规格
  （读回的行用同一份标记兜底判据）。

B **不**覆盖：GitHub 房的写侧（见第 7 节）、GitLab 房（#326 一房一票门禁，留给后续票）、界面置信度
那枚「推断」小标（文案归 #1281）。

## 5. 三层快照与编号规则

```
snapshot.maps = [
  地图行（tickets 里有规格行）,
  规格行（tickets 里有实施票）,
]
snapshot.issues = 普通票（不含地图、规格、实施票）
```

- 规格票挂探索地图：`parentKey` 写 `00`。地图子票里出现规格不算重复——规格同时出现在
  `snapshot.maps` 与地图的 `tickets` 里，这是容器的正常形状（#1280 验收要求同一张票两条车道判出的对象
  类型一致）。
- 实施票挂规格：`parentKey` 写规格的票号；不挂 `00`，也不靠标记里写引用。
- 编号照本地房今天的规则：目标 effort 内取现有最大编号加一，文件名 `NN-slug.md`；本次顺带修了
  `slugify`——标题转文件名后缀保留中文等各语言的字母与数字，不再把中文删光、落成 `NN-untitled.md`
  （#1280 验收要求）。票面那句「占 01」按「规格通常是最早建的那张、自然落在 01」理解：本票不为了凑 01
  去重排已有编号（重排会让盘上已有票号变化）；新建规格 maps 的场合它就是 01。
- 旧数据兼容：旧文档约定的 `.scratch/<feature-slug>/spec.md` 从此只是普通文档，不再被当票读取；不做
  数据迁移，也不给老票回填标记（ADR §5：老票不回填，按标签与正文形状理解）。

## 6. deck 工具侧的改动

- `deck_issue_create` 的 `kind` 枚举加 `spec` 与 `ticket`；两种新种类的必备标签都是
  `ready-for-agent`（不带 wayfinder 标签），正文不补「## 进度」区。建票时工具把标记行写在正文最前面
  （后端建房时再把它挪进文件头；GitHub 房今天挪不了，见第 7 节）。
- **实施票的父必须是规格票**：`kind=ticket` 没带 `parentKey` 时工具直接拒绝（ADR 2.1 的建票约束）；
  本地房在建票时再核一遍父票——找不到父票、或父票文件头没有 spec 标记，都如实失败、不落盘
  （#1280 验收②「不能挂到探索地图」）。只给「显式父票号」这一层是两层保险：工具挡住「忘了给父票」，
  后端挡住「给了一张不是规格的父票」。
- `deck_issue_list` 的 `type` 枚举加 `spec`；内存过滤按「地图 / 规格 / 普通票」三种判，不再只分
  「是不是地图」。
- `deck_issue_create` 的描述与 `tests/verify-1106-deck-surface.ts` 里逐字钉住的期望串同步改。

## 7. 已知缺口与后续票

1. **GitHub 写侧**：`src/tracker/rooms/github/idempotency.ts` 的 `withAnchor` 把幂等锚固定在正文第一
   行，工具写进去的标记落到第二行，`src/tracker/rooms/github/normalize.ts` 的 `isSpecBody` 只认第一
   行。本票不能动 GitHub 房（#326 一次改动只动一个房间），所以「用 deck 工具在 GitHub 上建规格票」这
   条路今天建出来的票在 GitHub 房内认不出规格；B 兜底能让界面照样显示成规格。修它要单独开票（用户父
   票与写侧标记写入口）。
2. **GitHub REST 降级**：`src/host/tracker/parent-repair.ts` 只给 `wayfinder:map` 修父子关系，规格在
   降级路径上会变成没有子票的空容器（#1286 设计文档 §4.1 ③）。本票不修。
3. **规则层九值改名**：`DeckKind` 只扩到本票需要的 `map / task / bug / spec / ticket`，改名
   `objectKind` 与另外四个值归 #1275 的落地清单（ADR 2.6、§4）。
4. **形状兜底与「推断」小标**：ADR 2.3 的正文形状判定与界面小标不在本票范围（归 #1275 与 #1281）。
5. **旧 `spec.md` 文档**：`docs/architecture/tracker-backend-design-contract.md` 与本地技能说明里的
   `spec.md` 约定本票一并改成「规格票」，历史提案文档只加一句「已被 #1277 取代」。
6. **远端后端「整份替换正文」搬回标记**：ADR 2.5 的保护①在本地房由 `mergeWholeBodyForPatch` 做；
   GitHub 房没有等价保护，`deck_issue_patch` 这一层今天也没有搬回逻辑——远端轨道用整段 body 改规格票
   正文时，标记可能被冲掉。本票只在设计里记账，不实现（要动 deck 改票工具 + GitHub 房，另开票）。
7. **两条车道的判定宽窄**：GitHub 房只认正文第一行，本地房认文件头（首个一级标题之前任意一行），
   这是 ADR 2.5 给两种载体的不同落点；快照的 B 兜底让界面两边显示一致，但后端 `get` 回来的契约类型
   今天仍可能不同。标记串在 `src/tracker/contract/vocabulary.ts`（`SPEC_BODY_MARKER`）与共享包各一份：
   契约目录按门禁不许引共享包，等 GitHub 房改为读文件头时一起并（#1275 落地清单）。
8. **规格关闭前核对实施票**：#1280 验收里「实施票没全关时关规格必须失败并说清缺哪几张」全仓还没有
   落点；它要多读一次子票清单，本票不实现，留给后续票（关闭动作那一路）。

## 8. 验收与门禁

验收直接照 #1280 那张清单里与本票相关的条目走，端到端一条链：

1. 用 `deck_issue_create`（`kind=spec`）在本地工作区建一张规格票 → 盘上文件头出现标记、不出现
   `Type: spec`；读回来的契约类型是 `spec`。
2. 再建一张实施票（`parentKey` 指向规格）→ 盘上文件头父注释指向规格；读回来的父关系一致。
   负例：没带父票的 ticket、父票是探索地图或普通票的 ticket，都要如实失败且盘上不落盘。
3. 组装快照 → 规格进容器列表，实施票在规格的 `tickets` 里，两处都不出现在普通票池。
4. 用整份正文改一次规格票的正文（不带标记）→ 盘上标记仍在，读回来还是 `spec`。
5. 构造「类型没标对、正文文件头有规格标记」的行喂给快照组装 → 仍然当规格容器（B 兜底）。
6. `deck_issue_list`（`type=spec`）只回规格；`type=issue` 不把规格混进来。
7. 门禁：新测试 `tests/verify-1277-md-spec-container.ts` 覆盖上面 1-6 的纯逻辑与本地后端回环；契约
   测试的拼装分区补「规格合规 / 违规样本」；`tests/verify-deck-tools.ts` 补规格与实施票两条正例；
   `tests/verify-1106-deck-surface.ts` 同步工具描述；跑 `node scripts/gate-map.mts` 刷新门禁归属表。

日志：这次没有新增事件。三条改动路径都落在已有的持久化边界上——建票与整份替换正文都会走
`issue.write` 那条既有事件（本地房建票/改票的结论行一直由它记），快照归一住在纯函数
`assembleSnapshot` 里、本身不写日志，取数那一趟由宿主既有的快照日志记录。对照日志纪律检查过：
「建票写标记」「整份替换搬标记」属于既有事件覆盖的同一趟写，「快照归一」没有新的外部调用与状态变化，
不需要再补心跳。
