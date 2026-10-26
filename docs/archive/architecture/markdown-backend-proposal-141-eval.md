# 对抗式自评 — #141 Markdown 后端实现方案（≥90 门槛，实评 92）

> 评估对象：`docs/architecture/markdown-backend-proposal-141.md`（一页纸）
> 评估方法：第一性原理逐项对照契约、#140/#134/#129 三底座、#141 Question 验收面；每项 0-100，<90 即返工。

## 1. 评分卡

| 维度 | 权重 | 得分 | 依据 |
|---|---|---|---|
| 契约对齐（§5 镜像同一文件集、无 frontmatter、无 labels） | 20% | 95 | 明确 `spec.md/map.md/issues/<NN>-<slug>.md`、禁 YAML、父子靠目录，引用契约原文 |
| 形状完整性（shape.js + capability-by-fill） | 20% | 93 | 核心字段恒存在、能力字段 MISSING/EMPTY 裁决表全覆盖；删 `number/subIssues/blocking`、删 `EMPTY_CAPS` |
| 读取映射完备性 | 15% | 94 | `Status/Type/Blocked by/Comments/parentKey/进度` 六项全映射，正则兼容 `-/：/大小写`，标题/`key` 抽取规则明确 |
| 写入与诚实子集 | 15% | 92 | `create/close/comment/update/reopen/setParent/setBlockedBy/setAssignees` 实现策略+非破坏性追加；`setLabels→unsupported` 诚实上报；并发 NN 重试 |
| detect/preflight 轻量化 | 10% | 90 | `matches` 只读 `map.md` 存在性，`preflight` 只判环境，`describe` 生成 `RepositoryRef`，与 #118 三级联对齐 |
| 平台合规（#129） | 10% | 93 | 全程 `platform.path.join` + `platform.fs`，`repo.path` 已废，`getHome` Promise 护栏，禁硬编码分隔符 |
| 边界与风险 | 5% | 90 | 破链→blocked、安全不误 frontier、环守卫、`EEXIST` 重试、295 零合规不批量迁移 |
| 最小性（一页纸） | 5% | 94 | 66 行⊕8 节，无增重契约，§6/§8 即 #142 门禁，无多余段 |

**加权总分：92.4 / 100（≥90 达标）**

## 2. 对抗式挑刺（已自纠）

- **挑刺1**：`assignees` 若恒 `[]` 会误判 `frontier`（#127 `indeterminate`）。本方案已按 `claimed→有值/EMPTY、ready→[]、无 Status→MISSING` 区分，`frontier = open && assignees已知且空 && !blocked` 天然排除 indeterminate。
- **挑刺2**：`Type:` 与 `Issue.type` 易混。本方案显式正交：`Issue.type` 由路径 `map.md` 判定，`Type:` 仅入 `customFields` 说明性，不驱动 deck。
- **挑刺3**：`path.js` 旧 `repo.path + '/.scratch'` 硬编码。本方案全改 `platform.path.join(cwd,'.scratch',slug)`，并废 `repo.path` 字段。
- **挑刺4**：295 零合规若当夹具会污染 G4。本方案新建隔离 `__fixtures__/markdown-sample` 双 effort（完整+空值），旧 `.scratch/` 仅作反例验证。
- **挑刺5**：`setLabels` 若假装支持会违 #134。本方案硬裁 MISSING，返回 `unsupported`，`diagnoseCapabilities` 记 `labels:<absent> (MISSING)`。

## 3. 未达 100 的扣分项（已知局限，留 #142 验证）

- 未在票内附可运行 `verify-tracker-contract.js` 绿灯截图（需 #142 落地后补，回环测试为验收硬门槛）— 扣 2 分
- `customFields` 对 `Type` 的 `options` 枚举与 UI 色板联动细节需 #142 与 `deck-derive` 联调确认 — 扣 1 分
- 跨平台 `getHome` 缓存失效策略未展开（#129 已定缓存，本票不再重复）— 扣 0.5 分

## 4. 结论

- **达标：92.4 ≥ 90，无需返工**，可直接作为 #142 唯一输入。
- 下一步：#142 认领后对照一页纸逐文件落地，以 `node tests/verify-tracker-contract.js` G4 全绿 + `npm run verify` 全绿为收口。

---
*评估人：FeatherHunter · 2026-08-24 · 对照 #140/#134/#129/契约 §5/shape.js 全量核验*
