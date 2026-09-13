# ADR：本地 Markdown 后端的地图文件、单根树与标签调色盘（#312 定版）

> ⚠️ 「标签调色盘」这部分已被取代（2026-09-13 起）——
> 本文件以下三处**已作废**：「决策」一节里「标签改为『调色盘』模型：调色盘与 setup 同位（`docs/agents/triage-labels.md` 扩 Color 列并增 `wayfinder:map`、`wayfinder:<type>` 等行）」那一段、「为什么」第 3 条「调色盘（真正的取舍）」、以及「后果」里「调色盘文件需存在（setup 写入或 fallback 灰色）；色值不随票走，若用户只想对某张票改色需在总表全局改」。
> 为什么改：旧做法把色值放在「与 setup 同位」的技能产物文档里，改色要靠初始化时注入的一段文案让 AI 去改那张 markdown 表（用户自己改不了，只有 AI 才能改）；而后来要做到的事是「在面板上直接改色，GitHub 与本地 Markdown 两个后端都能改」，色值必须住在插件自己能读写、用户自己也能手改的地方。
> 新决策见 `docs/adr/20260913-builtin-ts-shape.md`（§2.8「与「标签配色可编辑」功能的关系」）：颜色的真源改成工作区里的 `docs/agents/label-colors.json`（插件自己放置、用户可以手改，改色由面板上的改色弹窗完成），旧的 `docs/agents/triage-labels.md` 调色盘表不再被读（干净切断：不迁移、不回填），初始化注入也不再教人去建那张表。配套契约由 #615 定版、#627 写定规格，#618 / #619 / #620 / #621 / #622 落地。
> 推动这次取代的是地图 #610（父图）与它的落地票；本段说明由验收票 #623 追加。为保留追溯，标题与正文的旧段落一律不改写，只加本提示。
> 本文件其余内容（`.scratch/<努力目录>/map.md` 作为一张图的锚点、`issues/NN-<slug>.md` 单根树、一次快照全量枚举后聚合）**仍然有效**。

> 日期：2026-08-28 定版（承接 #309 图谱，对应 #312 与 #322）
> 地位：本决策修订 `20260826-check-item-chain-contract.md` 相关旧口径中「markdown labels 恒 MISSING」的一处（#134 注释），落地为本仓库 Markdown 后端的文件契约。与旧文档冲突以本文件（更新日期者）为准；未来任何讨论若改动本决策，以未来版本为准（CONTEXT.md 同款两条规则）。
> 关联：#312（定版）· #322（落地规格）· #309（父图）

---

## 决策

本地 Markdown 后端以 `.scratch/<努力目录>/map.md` 为一张图的封面（`Issue{key:"00", type:"map", parentKey:null}`），
`issues/NN-<slug>.md` 为子票（`NN` 两位补零、`parentKey` 恒为 `"00"`），恒为单根树、不支持图嵌图，故 `setParent` 为 `unsupported`。
一次快照对 `cwd/.scratch` 下所有含 `map.md` 的努力目录全量枚举、逐一成图后聚合为单一 `Snapshot` 并全局 `deriveDeck`。
标签改为「调色盘」模型：调色盘与 setup 同位（`docs/agents/triage-labels.md` 扩 Color 列并增 `wayfinder:map`、`wayfinder:<type>` 等行），
票内 `Labels:` 行只写名字、由宿主读调色盘染色，未收录名 fallback 灰色；`setLabels` 因此从 `unsupported` 转为文件实现（重写 `Labels:` 行）。

## 为什么

1. **map.md 锚点**：`wayfinder` 本体不硬编码路径，真源头在 `setup-matt-pocock-skills/issue-tracker-local.md`（AI 执行 wayfinder 前必读），以之为硬依据可消除「路径不确定」类静默丢票。
2. **全量枚举**：工作区就是要看见全部（用户拍板），现行 `list` 单根与 `matches` 枚举分叉需收敛；`deriveDeck` 已是全局 key 空间，聚合不需要改算法。
3. **调色盘（真正的取舍）**：色值若写在每张票里，改色要逐票改、且种子模板不负责颜色；色值放与 setup 同位的总表，改一处全票生效，并保持与 GitHub「仓库级标签、票只引用名」的同构心智。此取舍同时修订了旧 #134 口径（labels 恒 MISSING → 有调色盘参与即支持）。

## 后果

- 正：新术语入 `CONTEXT.md`（地图文件/努力目录/编号/标签调色盘/单根树）；#322 按此兑现，含行语法 fallback（缺行按空、未知标签名回灰、非法段丢弃）。
- 负：`Labels:` 行是文件契约的新写法，旧文件无此行按「无标签」处理；规则需经 deck 的 `setupRun` 注入通道联动（另有联动票 #323；不改 setup-matt-pocock-skills 技能目录模板）。
- 代价：调色盘文件需存在（setup 写入或 fallback 灰色）；色值不随票走，若用户只想对某张票改色需在总表全局改。
