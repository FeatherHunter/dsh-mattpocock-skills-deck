# ADR 20261027 · 低置信正文提及只当证据，不参与后端判定

> 日期：2026-10-27 深夜定版（维护者认可「方案 A」）。
> 地位：本文取代 ADR `20261012-backend-decision-two-classes.md` 第 10 节最后一句「低置信的正文兜底留给判定层」。判定顺序（用户的手动选择 > 锚文件 > 自动识别）仍以 ADR `20260921-tracker-choice-precedence.md` 为准，本文不改它。凡与本文冲突的旧说法，以本文为准；未来任何讨论若改动本决策，以未来版本为准（与 `CONTEXT.md` 开头两条版本与效力规则同款）。
> 关联：#1572（收尾）· #1555（认领层只认声明形状）· #1048（一次读取一份结论、证据分层）· #277（标题优先）· 代码落点 `src/tracker/detection/readEvidenceLayers.ts`、`src/tracker/detection/backendDecision.ts`、`src/tracker/detection/explicitDetector.ts`、`src/refresh/rooms/host/check-chain-evaluation.ts`

---

## 1. 问题：低置信正文提及会压过硬证据，也会冒充「你亲手选的」

`docs/agents/issue-tracker.md` 的解析器按两种置信给结论：标题行（`# Issue tracker: GitHub` 这类）是高置信；正文里出现后端名（例如「以前这里用 GitLab 管票，后来迁到别处了」）是低置信。

#1555 之后，认领层已经只认高置信标题，但判定层仍然把低置信当结论。真实现场：一个 GitHub 远端的工作区，说明文件没有标题、正文里历史提过 GitLab。判定顺序是工作区文件 → 声明文件 → 自动识别；声明层一旦给出「命中」，自动识别就被跳过，于是这个工作区被判定成 GitLab，GitHub 远端根本没人看。猜的压过了现场事实。

同一份低置信结论还会冒充身份：

- 探测器 `detectExplicit` 把它当成 `Selection.source = 'explicit'` 交出去；
- 检查链把 `explicitBackendId` 当「明确选定」，通过说明写成 `explicit:gitlab`；
- 界面工作区来源标成「显式」，悬停文案说「你在右侧面板亲手选过」。

一句话：只是正文提到过，却被说成人选的、写明的。

## 2. 裁决

1. **解析层形状不动**：`parseIssueTracker` 继续给两种置信，`explicitBackendId` 仍可能装低置信的 id（这是 #1555 之后留下的兼容形状，Q2=A 的边界）。它从今往后只作证据，不是身份。
2. **读取层把低置信记成「看过了，没有结论」**：`readEvidenceLayers.ts` 对低置信返回 `outcome: 'abstain'`（日志里 outcome 词是 `miss`），reason 仍带 `declaration-low-` 前缀。高置信照旧 `hit`。
3. **判定层只从「给出结论」的证据里取结论**：`kind = verdict` 之外不取；低置信不产 `Verdict`，因此自动识别（各房认领）一定有机会跑并可能胜出。
4. **自动识别也认不出时，如实说「未识别」**：判定结果没有后端，界面上等用户在右侧面板选一次，写进工作区配置文件。不拿正文猜一个后端。
5. **身份面只认高置信**：`Selection.source` 没有 `hint` 取值（上一版加过又撤回）；探测器只有高置信标题（或工作区文件）才产 `Selection`；检查链只对高置信解析撑 `explicit:<id>`；界面「显式」只给真正写明的结论。
6. **认领层不变**：各房 matches 继续只认高置信标题（#1555 已定）。

## 3. 理由

- **猜的不能变成选的。** 用户原话：「不能让低置信度污染我们插件。」低置信只是一个提示，不是一次选择。
- **低置信压过硬证据是实质错误。** GitHub 远端明明摆在那里，却被一句历史提及挡住，用户看到的结论与仓库事实相反。
- **#1555 之后，低置信只剩判定层这一处特殊通道。** 认领层不认它、界面也不该认它，只剩决策层认它，收益（省一次手动选择）抵不过代价（选错、身份说不清）。
- **线索不能丢。** 低置信仍留在 `parsed`、步骤日志与诊断里（reason 带 `declaration-low-` 前缀），排查的人能看到「这里提过一句，但没当结论」。

## 4. 影响（用户能看到的行为）

- 只有正文提及、没有标题行的旧文档：不再自动选中那个后端。有远端、目录名等现场事实时按现场事实选；都没有时显示「未识别」，等用户选一次。
- 读日志：`detection.step` 的 declaration 步骤 outcome 从 `hit` 变 `miss`，reason 仍带 `declaration-low-` 前缀；`detection.detect` 的 origin 不再出现 `declaration-low`。
- 界面：工作区来源只出现「显式 / 自动 / 未指定」三种，不再出现「推测 / 正文提及」这类词（上一版的 `hint` 方案已整体撤回）。
- 写权限：低置信从来不给写权限（`canWrite: false`），这一条不变。

## 5. 以后写新代码要注意

`explicitBackendId` 仍可能装低置信的 id，它 **不是身份**。新读取方只有两条正路：

1. 走判定出口拿结论（`decideBackend`），不要自己读解析结果下判断；
2. 确实要读解析结果时，必须检查 `confidence === 'high'` 才能把它当「明确声明」。

反例：拿 `explicitBackendId` 直接拼 `explicit:<id>`、直接当 `Selection`、直接写进「用户已选定」的文案。

## 6. 门禁

- `tests/verify-detection-evidence.ts`：低置信不产结论（backendId 为空、state=undetermined、gap=autodetect-unavailable），步骤 outcome=`miss` 且 reason 带 `declaration-low-`；读法两种形状（字符串 / 带 confidence）都钉。
- `tests/verify-detection-cascade.ts`：探测器低置信不产 `Selection`；判定服务低置信回 `fallback`；自动识别能胜出（`matches`）。
- `tests/verify-1505-chain-env-selection.ts`：检查链「已选后端」的通过说明写 `backend:<id>`，不写 `explicit:<id>`。
- `tests/verify-1555-gitlab-claim-declaration.ts`、`tests/verify-1129-markdown-claim.ts`：认领层只认高置信标题（沿用 #1555）。
