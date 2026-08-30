# ADR：本地 Markdown 后端的地图文件、单根树与标签调色盘（#312 定版）

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
