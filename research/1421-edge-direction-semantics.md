# #1421 研究笔记：deck_map_plan_create 依赖边的方向语义与写后读回证据（2026-10-23）

所属：GitHub issue #1421（外部报告）。本笔记只回答两个开放问题：问题 A「`edges` 的 `from`/`to` 在规格、文档、测试与实现里各自指谁阻塞谁」；问题 B「回执 `items[].evidence` 的 `ok=true` 是不是误报」。已有的 `research/790-silent-parent-edge-failure.md`、`research/898-blocked-by-overwrite.md`、`research/895-batch-write-timeout.md`、`research/971-markdown-parent-edge.md`、`research/1010-ticket-structure.md`、`research/1315-*.md` 都只回答「边落没落、有没有被覆盖、父边怎么落、超时怎么分」这类问题，没有一份写过 `from`/`to` 的方向定义，所以另做本次只读核查。

核查日期：2026-10-23。核查人：agent（会话内直读本仓源码与测试，用桩 tracker 跑了一次最小复现；没有修改业务代码、测试、脚本与构建产物，没有提交业务改动）。

口径：本文里的事实分三类，逐条标注。**读代码核实**的是源码与测试里能逐行指认的部分；**实测**的是用本仓桩 tracker 跑出来的写入与读回；**推断**的是只能按报告给出的数字推演、拿不到原始现场的部分。报告里的两张真实地图建在外部仓库（报告人写的是 `xingmulee/sdlcv2`），本次没有、也不适合去那边建票复验。

触发：报告人称 `deck_map_plan_create` 的依赖边方向存反（按直觉 `from`=阻塞者、`to`=被阻塞者，实际写入相反），且回执 `evidence` 误报成功；期望把方向改对，并让写后读回按方向断言。

---

## 一、结论速览

1. **方向从未被定义过。** 工具 schema、规格 `specs/1106-deck-tool-surface-spec.md`、面向人的文档与 bundled skills、git 提交说明，都没有写 `from`/`to` 谁阻塞谁；规格里还明确说这十二个缺说明的参数「该另立一张票」（`specs/1106-deck-tool-surface-spec.md:179`）。
2. **实现里的隐式约定是：`from` 永远是「被写字段的那张票」。** `type=blocked-by` 时 `from`=被阻塞票、`to`=阻塞它的票（写 `from.blockedBy = [to]`）；`type=parent` 时 `from`=子票、`to`=父票（写 `from.parentKey = to`）。这与 `deck_map_link` 的参数形状（`key`=被改的票、`blockedBy`=阻塞者）一致。
3. **现有测试把这条方向钉死了**：`tests/verify-898-block-merge.ts:149/:160` 与 `tests/verify-1413-map-plan-two-layer.ts:126/:215` 都按「`from`=被阻塞票」断言，且本次实跑通过（11/11、65/65）。所以「方向存反」不是相对某份契约的偏差，而是相对报告人直觉的偏差。
4. **`evidence` 的 `ok=true` 不是假的。** 它核对的是「`from` 的 `blockedBy` 里有没有 `to`」（`src/deck/rules/edge-landing.ts:81`），实测确实有；缺边与没读回两路都会给 `ok:false`。缺陷在文案与字段：整句不提「谁阻塞谁」，`key`/`target` 也没有语义标签，所以是「方向不可见的误导性回执」，不是数据造假。
5. **报告「全图四票互相锁死」按它自己给出的数字推演不成立**：那仍是一张有向无环图（DAG），只是前置关系整体反置。契约对真环会 conflict 且不落盘（`src/tracker/contract/operations.ts:199-200`）。
6. **报告「期望」第一句自相矛盾**：原文「from=被阻塞者、blockedBy=[from]」在字段关系上讲不通（若 `from` 是被阻塞者，`blockedBy` 应是 `[to]`）。结合前文「按直觉 from=阻塞者」，报告人的真实诉求更可能是**翻转现方向**；这句不能直接当验收标准，需要维护者拍板。

---

## 二、方向在实现里是怎么落的（读代码核实）

### 2.1 写入路径

- 参数面在 `src/deck/tools/map-plan-create.ts`：`:58-67` 定义 `edges` 数组；`:60` 原文只有「子票之间的边；from 是计划内的短标识（也可以是地图自己，写 @map）」；`:63` 的 `from`、`to`、`type` 三个属性都没有 `description`；`:202` 只按存在性筛一遍（`e && e.from && e.to`），`type` 不校验，非 `parent` 一律当 `blocked-by`。
- `:392` `keyOf` 把 `@map` 或短标识解析成真实票号；`:395-398` 逐条生成 `{ idx, from, to, parent: e.type === 'parent' }`。
- `:400-409` 按 `from` 分两组：`parentByFrom`、`blockByFrom`（同一条写出票的多条阻塞边合并成一次写）。
- `:416` 父边调 `applyParentEdge(t, repo, opCtx, j.from, j.to)`；`:424` 阻塞边调 `applyBlockEdges(t, repo, opCtx, from, g.targets, ...)`。
- 落点：`src/deck/shell/edge-landing.ts:148` `t.setParent(repo, from, want)` → `from.parentKey = to`；`:188-190` `t.setBlockedBy(repo, from, want)` → `from.blockedBy = [to, ...]`。
- **一句话：两条边类型都写「`from` 那张票的字段」，`to` 是放进去的值。** 阻塞边读起来就是「`from` 被 `to` 阻塞」。

### 2.2 写后读回的判据

- `src/deck/rules/edge-landing.ts:81`：`if (op === 'block') return rel.blockedBy.indexOf(want) >= 0 ? 'landed' : 'not-landed'`；`:82` 父边比 `parentKey === want`。
- `relationsOf`（`:128-136`）从读回的票（或其 `dependencies`）里取 `parentKey`、`blockedBy`、`blocking` 三列。
- 因此判据只回答「这条依赖在不在结构字段里」，不回答「方向是不是使用者想要的」。方向对不对，取决于写的时候 `from`/`to` 怎么解析。

### 2.3 回执怎么组装

- `src/deck/shell/edge-landing.ts:215` 把每条边的明细写成 `{ key: from, role: 'edge', status, ...edgeEvidence('block', to, ev) }`；`edgeEvidence`（`:66-76`）带上 `op`、`target`（这里是 `to`）、`landing`、`evidence`、`ok`。
- 于是回执里每条边的 `key` 是被写字段的票、`target` 是被写进去的那张票，但字段名本身没有语义标签（`:56-58` 的注释只写「这条明细记在哪张票上」「这一行的角色」）。
- plan 级读回（第④步的 `readbackMapPlan`）只核对五节、进度、标签、父票与 Type 行，**不核对 `blockedBy` 的内容**（`src/deck/tools/map-plan-readback.ts` 里 grep `blockedBy` 无命中）。所以方向反置时，顶层 `status` 仍是 ok，只能靠每条 edge item 自己说明方向。

### 2.4 实测（桩 tracker，未建真票）

- 复现脚本：`.tmp-1421/repro-edge-direction.mjs`（本仓桩 tracker，未跟踪文件）；跑法 `node --import ./scripts/ts-hook.mts .tmp-1421/repro-edge-direction.mjs`。
- 输入：children `[D1, D3]`，edges `[{ from: 'D1', to: 'D3', type: 'blocked-by' }]`。
- 录到的写入逐字：`writes: [{"op":"setBlockedBy","key":"2","value":["3"]}]`（地图=1，D1=2，D3=3）。
- 读回：D1 `blockedBy=["3"]`、D3 `blockedBy=[]`。
- edge item 逐字：`{"key":"2","role":"edge","status":"ok","op":"block","target":"3","landing":"原生依赖边","evidence":"写后读回：结构字段里有这条依赖、正文里没有那一行（后端把它放在自己的原生边上）","ok":true}`。
- 对照 `parent`：edges `[{ from: 'c1', to: '@map', type: 'parent' }]` → 写入 `[{"op":"setParent","key":"2","value":"1"}]`，读回 `parentKey=1`。
- 相关测试实跑：`node --import ./scripts/ts-hook.mts tests/verify-898-block-merge.ts` 11/11 PASS；`tests/verify-1413-map-plan-two-layer.ts` 65/65 PASS（真本地 Markdown 后端 + 临时目录）。

---

## 三、方向在规格与文档里有没有写（读代码核实）

### 3.1 工具 schema

- `src/deck/tools/map-plan-create.ts:60` 只定义 `from` 是「计划内的短标识」，没有说它代表阻塞者还是被阻塞者；`:63-65` 三个字段都没有各自的说明。

### 3.2 规格

- `specs/1106-deck-tool-surface-spec.md:30` 原文：「edges（每项必填 from、to；type 枚举 blocked-by / parent；from 写 @map 指地图自己）」——只定义取值，不定义方向。
- `:179` 原文明确把「十二个参数没有各自的说明（… edges 条目里的字段）」定性为「本来就有的粗糙处：本次只把它冻住，不动文案——补说明等于改模型看到的东西，该另立一张票」。**#1421 正属于这句预告的后续票。**

### 3.3 面向人的文档与 bundled skills

- `docs/tour/deck-call-end-to-end.md:558` 只写「③ 边：端点都在计划里才做（阻塞边同票合并一次写；@map 指地图票）」，无方向；`8.6、`8.7 都没有。
- `docs/agents/issue-tracker.md:152-154` 只写 `deck_map_link` 的票向语义（`blockedBy`=阻塞者；一张票要等所有阻塞它的票都关闭才解除阻塞），没写 `plan_create` 的 `edges` 方向。
- `package/bundled-skills/wayfinder/SKILL.md:69`、`package/bundled-skills/to-tickets/SKILL.md:3/:38/:47/:75/:99` 都只讲「票的 Blocked by 列阻塞者」，从不提 `from`/`to`，也没有 `deck_map_plan_create` 的调用示例（package 里 grep 无命中）。

### 3.4 测试与冻结门禁

- 钉死方向的测试：
  - `tests/verify-898-block-merge.ts:142-161`：A 节「整图建骨架：C 被 A、B 阻塞」，`:149` edges 是 `[{ from: 'c', to: 'a' }, { from: 'c', to: 'b' }]`，`:160` 读回 C 的 `blockedBy` 等于 `[a, b]`。即 `from`=被阻塞票。
  - `tests/verify-1413-map-plan-two-layer.ts:126` `edges = [{ from: 'bug', to: 'research', type: 'blocked-by' }]`；`:215` 断言缺陷票 `blockedBy` 含调研票（「它被调研票阻塞」）。同样 `from`=被阻塞票。
- 不钉方向的：`tests/verify-790-parent-edge.ts:349-372` 反向写 `{ from: '@map', to: 'c1' }` 且只断言 failed，不钉方向；金样 `tests/tracker-contract/fixtures/golden-receipts/06-deck_map_plan_create.golden.json` 的 `edges` 是 `[]`（`tests/verify-golden-receipts.ts:83` 传 `edges: []`），也不钉方向。
- 冻结面：`tests/verify-1106-deck-surface.ts:82` 把 `deck_map_plan_create` 的整段工具说明冻住（其中 `edges=子票之间的边；from 是计划内的短标识…`）；`:277-283` 的 `FROZEN_NO_DESC` 把 `edges[].from`/`.to`/`.type` 列进「没有各自说明」的名单。补说明要同时改这两处与 `specs/1106`，这是「一次评审」而不是纯代码改动。

### 3.5 git 溯源

- 首次引入 `edges` 的提交 `405bd676` 里，schema 描述与今天逐字相同；`git log --grep`、`git log -S` 都没有找到定义方向的提交（history-researcher 查证）。
- 最近一次动 `map-plan` 读回的提交是 `a85dfabb`（#1413，2026-10-23 合入），只加建后读回核对，不含 `blockedBy` 方向断言。

---

## 四、`evidence` 的 `ok=true` 是不是误报（读代码核实 + 实测）

- 成功文案逐字（`src/deck/rules/edge-landing.ts:196`）：「写后读回：结构字段里有这条依赖、正文里没有那一行（后端把它放在自己的原生边上）」；`:197` 是正文行版本。
- 缺边与没读回两路会诚实报失败：`src/deck/shell/edge-landing.ts:214`「写后读回：这条依赖不在票上（要 X，读回来 Y）」（`ok:false`、`status: failed`）；`:210`「写后没读回来，判不了这条依赖落上了没有…」。
- 实测里 `ok=true` 的依据是 `from.blockedBy` 确实含 `to`（见 2.4），所以**证据本身是真的**。
- 但证据只说「这条依赖」，不写「`from` 被 `to` 阻塞」；item 的 `key`/`target` 也没有语义标签；plan 级读回又不核对依赖边（见 2.3）。结论：**不是「没写却报成功」的假证据，是「方向不可见的误导性回执」。** 报告人「evidence 误报成功，与实际存储方向矛盾」的判断，只在「它没说方向」这层成立。

---

## 五、报告两处主张的复核

### 5.1 「方向存反」

- 成立的部分：按报告人直觉（`from`=阻塞者）写边，实际会得到反向前置关系。实测证实：`{from: D1, to: D3}` 落成 `D1.blockedBy=[D3]`（D1 被 D3 阻塞），与「D1 阻塞 D3」相反。
- 不成立的部分：这不是相对某份契约的偏差——契约里没有方向，现有测试反而把「`from`=被阻塞票」钉死（3.4）。所以这是**语义未定义 + 默认方向反直觉**的问题，不是实现写错了方向。

### 5.2 「evidence 误报成功」

- 见第四节：`ok=true` 在实现语义内为真，缺边与没读回都会失败；缺陷是文案与字段不暴露方向。报告人「更严重」的判断值一半。

### 5.3 「全图四票互相锁死，无票可开工」

- 按报告自己给的读回数字推演：map #7 实际 `D1←D3+D4`、`D2←D3`（`D1.blockedBy=[D3,D4]`、`D2.blockedBy=[D3]`），图仍是无环的，D3、D4 没有被谁阻塞，可以先开工；不能开工的是 D1、D2。**这不是死锁，是前置关系整体反置**：报告人以为能先做的票（D3、D4）其实要等 D1、D2 做完。
- 契约对真环会 conflict 且不落盘（`src/tracker/contract/operations.ts:199-200`，`tests/verify-898` E1「第一条保留、第二条拒」），所以不会静默写坏成环图。危害是「按回执选错了开工顺序」，是真实的，但表述应改成「方向反置」而不是「锁死」。

### 5.4 「期望」句自相矛盾

- 报告原文「建议对齐 issue tracker 原生『blocked by』方向：from=被阻塞者、blockedBy=[from]」：若 `from` 是被阻塞者，它被谁阻塞应写进 `blockedBy=[to]`；写成 `blockedBy=[from]` 只有 `from`=阻塞者才自洽。
- 结合前文「按直觉语义 from=阻塞者、to=被阻塞者」，最可能的情况是：报告人想要 `from`=阻塞者、`to`=被阻塞者（即翻转现方向），第二句只是笔误。**这句不能直接当验收标准**，需要报告人确认或维护者拍板。

---

## 六、处置选项与代价（只列，不实施）

### 选项 A：保持现方向，只补语义与回执（行为零变化）

- 改：`src/deck/tools/map-plan-create.ts:60`（写清 blocked-by 与 parent 各自方向）、可补 `:33`；`src/deck/shell/edge-landing.ts:66-76`（`edgeEvidence` 带方向字段或把方向写进 `text`）、`:194/:210-211/:214`；`src/deck/rules/edge-landing.ts:196-200/:202/:204-205`（文案点名「票 X 的 blockedBy 里有 Y，即 X 被 Y 阻塞」，需要把 `from` 传进 classify/evidence，签名扩参）。
- 同步：`specs/1106:30`、`specs/1106:179`（把 edges 三项从「没有说明」名单里去掉）；`tests/verify-1106-deck-surface.ts:82` 与 `:277-283`；金样 `07-deck_map_link.golden.json:59` 的 evidence 文案（`tests/verify-golden-receipts.ts --update` 重建）；`docs/tour/deck-call-end-to-end.md:558`；可选在 bundled skills 里补一句。
- 兼容风险：低（行为不变；回执文本变，金样与冻结门禁要一次评审）。

### 选项 B：翻转方向（`from`=阻塞者、`to`=被阻塞者，写 `to.blockedBy=[from]`）

- 改：`src/deck/tools/map-plan-create.ts:392-398`（端点语义）、`:400-409`（分组键由 `from` 改 `to`）、`:421-427`（写出票与目标翻转）、`:435`；`parent` 边若不动，同一工具里两类边的方向约定会不同，说明里必须分别写。
- 测试：`tests/verify-898-block-merge.ts:149/:160`、`tests/verify-1413-map-plan-two-layer.ts:126/:215` 必须翻转；`tests/verify-deck-tools.ts:264`、`tests/verify-deck-tools-matrix.ts:217/:350`、`tests/verify-895-bulk-deadline.ts:274` 一并更新；若补说明还要动 `tests/verify-1106-deck-surface.ts:63/:82/:277-283`。
- 规格/文档：`specs/1106:30/:179`、`docs/tour:558`（「阻塞边同票合并一次写」的合并维度会从「按写出票」变成「按被阻塞票」）、`docs/agents/issue-tracker.md` 可补一句、CHANGELOG 与发版说明。
- 兼容风险：高。已有按现方向写好的地图、脚本与会话调用会整体反置；旧 `planId` 游标与新版本混跑会把边写到相反票上（`edges` 每次重跑都重放，`state.done` 只写不读——推断自代码）。若形成 2 环，契约会 conflict 且不落盘（`src/tracker/contract/operations.ts:199-200`），边项 failed，不会静默写坏但需要人工修；另外与 `deck_map_link` 的参数形状（`key`=被改票、`blockedBy`=阻塞者）将不再一致，说明里要解释两种工具的对应关系。

### 选项 C：A + B 都做

- 文件是 A、B 并集，另需迁移/修图说明（报告人两张真实地图要人工用 `deck_map_link` 修，其 workaround 已验证有效）、发版说明、同时钉行为方向与回执方向措辞的回归测试。兼容风险最高（行为 + 文案 + 冻结门禁 + 旧游标）。

---

## 七、本次未能核实的部分

- 报告人两张真实地图的现场：只拿到报告里的两段读回数字，没去外部仓库建票复验；「实际方向与意图整批颠倒」按报告自述可信，但无法逐票核对。
- 报告人的真实意图：期望句自相矛盾（5.4），是否真要翻转现方向需要其本人或维护者确认。
- 冻结门禁对「补说明」的接受方式：「十二个参数缺说明」是既有粗处（`specs/1106:179`），补说明属于改模型看到的东西，是否随本票一起做、怎么评审，需要维护者决定。

---

## 八、主要源码位置索引

| 位置 | 作用 |
|---|---|
| `src/deck/tools/map-plan-create.ts:58-67` | `edges` 参数面（无方向说明） |
| `src/deck/tools/map-plan-create.ts:202` | 只按存在性筛边、不校验 type |
| `src/deck/tools/map-plan-create.ts:392-398` | `from`/`to` 解析 |
| `src/deck/tools/map-plan-create.ts:400-435` | 按 `from` 分组并写父边/阻塞边 |
| `src/deck/shell/edge-landing.ts:144-168` | 父边写入（`from.parentKey = to`）与读回 |
| `src/deck/shell/edge-landing.ts:178-218` | 阻塞边写入（`from.blockedBy = [to]`）与读回明细 |
| `src/deck/shell/edge-landing.ts:66-76` | `edgeEvidence` 组装（无方向标签） |
| `src/deck/rules/edge-landing.ts:81` | 阻塞边 `landed` 判据 |
| `src/deck/rules/edge-landing.ts:196-200` | 成功/缺边文案（不提方向） |
| `src/deck/tools/map-plan-readback.ts` | plan 级读回（不核对依赖边） |
| `tests/verify-898-block-merge.ts:142-161` | 钉死 `from`=被阻塞票 |
| `tests/verify-1413-map-plan-two-layer.ts:126/:215` | 同上 |
| `tests/verify-1106-deck-surface.ts:82/:277-283` | 冻结工具说明与「无说明」名单 |
| `specs/1106-deck-tool-surface-spec.md:30/:179` | 规格冻结面与「另立一张票」预告 |

---

## 九、一句话给分诊用

方向在仓里从未被定义；实现约定 `from`=被写字段的票（blocked-by 时 `from`=被阻塞票）；`evidence` 如实但不提方向；报告人「方向存反」是对未定义语义的直觉冲突，「evidence 误报」不成立（误导成立），「互相锁死」按数字推演不成立。是否翻转方向是维护者的决定。
