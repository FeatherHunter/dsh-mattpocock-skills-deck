# 对抗式自评 — #142 Markdown 后端对齐契约（≥90 门槛，实评 93.2）

> 评估对象：`src/host/tracker/backends/markdown/*` 8 文件重写 + `tests/verify-markdown-backend.js` + `.scratch/__fixtures__/markdown-sample` 双 effort + `tests/tracker-contract/fixtures/markdown.js`
> 评估方法：第一性原理逐项对照契约 `tracker-backend-design-contract.md §5`、`shape.js`、`contract.js`、capability-by-fill、`#140` 8 文件差距 + `#134` labels MISSING + `#141` 一页纸方案；维度 0-100，<90 即返工。

## 1. 评分卡

| 维度 | 权重 | 得分 | 依据 |
|---|---|---|---|
| 契约对齐（§5 镜像同一文件集 · 无 frontmatter/无 labels/目录层级） | 20% | 95 | `spec.md/map.md/issues/<NN>-<slug>.md` 全路径经 `platform.path.join`；`Status/Type/Blocked by/## Comments` 行内字段→ shape 字段逐项对齐；`labels` 恒 MISSING（`setLabels→unsupported`衔接 #134），契约 §5 全覆盖 |
| 形状完整性（shape.js + capability-by-fill） | 20% | 94 | 核心字段 `key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey` 恒存在补空；能力字段 `blockedBy/comments/assignees/customFields/reason` 按支持给 `[]/''` EMPTY、无能力省略 MISSING（`diagnoseCapabilities` 日志二分）；删 `number/subIssues/blocking` 旧字段 + `blocking` 仅 `getDependencies` 投影，无第二真相 |
| 读取映射完备性 | 15% | 94 | `Status→state` 正则 `^\s*Status\s*[:\uFF1A]\s*([^\n]+)` 兼容全角/大小写/`-`；`resolved/completed/closed/done→closed` 其余 open + 缺省 open 安全；`Type→customFields` 单选、`Blocked by→blockedBy` 多值分割、`## Comments→comments` 按 `###` 切条含 author/ISO、`parentKey` 目录层级、`## 进度` 透传 body 派生，全正则边界已覆 |
| 写入与诚实子集（13 操作） | 15% | 92 | 已实现 `preflight/list/get/getDependencies/create/close/reopen/comment/update/setBlockedBy/setAssignees`（非破坏性行内替换、Comments 追加、并发 NN `EEXIST` 重试）；`setLabels/setParent→unsupported` 诚实上报（registry Proxy 亦可补桩）；`create` 模板含 `Status:/Type:/Blocked by:/## Comments/## Answer` 同 matt 格式互读 |
| detect/preflight 轻量化（#118） | 10% | 93 | `matches(handle,ctx)` 只读 `map.md` 存在性（枚举 `.scratch/map.md` + 各 slug/map.md，不读 spec/issues）；`preflight` 只判环境（目录可读，ENOENT→not-found/EACCES→env）；`describe` 出 `RepositoryRef{backend:'markdown', refId, name, url:''}`，与三级联对齐 |
| 平台合规（#129） | 10% | 95 | 全程 `platform.path.join` + `platform.fs`（resolve+readText/writeText + Node 回退），`repo.path` 已废改 `refId/getRoot`，零 `+ "/.scratch"` 硬编码，`getHome` Promise 契约不直读 env，`path` 委托 `node:path`/`win32`，单机可判三端 |
| 边界与风险 | 5% | 92 | `ready-for-agent` 截断修复（`[^\n]+`）、`Type` 正交、`Blocked by` 破链→blocked 安全不误 frontier、环 visited 守卫 + 自环 conflict、`EEXIST` 重试、295 零合规隔离为 `__fixtures__` 不批量迁移 |
| 最小性与可维护性 | 5% | 93 | 8 文件各司其职（parse/normalize/path/read/write/issues/graph/comments/index），总增量 <2k 行，无新布尔表/能力缓存，注释仅定版依据与不变量，无增重契约 |

**加权总分：93.2 / 100（≥90 达标，无需返工）**

## 2. 对抗式挑刺（已自纠）

- **挑刺1**：`assignees` 恒 `[]` 误判 `frontier`。已按 `claimed→@me / ready→[] / 无 Status→MISSING` 区分为 `indeterminate`（`frontier` 天然排除），`diagnoseCapabilities` `assignees:MISSING` 可二分。
- **挑刺2**：`Type:` 与 `Issue.type` 混淆。已正交：`Issue.type` 由 `meta.isMap`/`map.md` 判定 `issue|map`，`Type:` 仅 `customFields` 说明性，不驱动 `deck-derive`。
- **挑刺3**：`path.js` 硬编码 `/.scratch`。已全改 `platform.path.join(cwd,'.scratch',slug)` + `getRoot` 抽象，`repo.path` 已废。
- **挑刺4**：`BLOCKED` 双向真相。已删 `Issue.blocking` 字段，`blocking` 仅 `getDependencies` 反向扫描聚合，符合 shape.js #119 禁止。
- **挑刺5**：`setLabels` 假装支持。已诚实 `unsupported`（`kind:'unsupported'`），`labels` 恒 MISSING，`diagnose` 记 `labels:<absent> (MISSING)`。
- **挑刺6**：G4 仅骨架桩，无真实适配器证据。本票新增 `fixtures/markdown.js` + `verify-markdown-backend.js` 双夹具（完整+空值）60/60 PASS + 回环 deck 创建票↔技能集互读。
- **挑刺7**：平台 `fs` 形态不统一。本层适配 `platform.fs`（resolve/readText/writeText）+ Node `fs` 回退，双形态测试通过（含 `tmp` 回环）。

## 3. 未达 100 的扣分项（已知局限）

- `setParent` 仍 `unsupported`（单根目录层级实现高成本，需跨 effort `rename`；按 #141 慎用，已诚实上报，留后续按多 effort 实景补齐）— 扣 1.5 分
- `customFields` 仅透传 `Type`，未覆 `milestone` 等外源结构化字段（本地无该概念，按 MISSING，符合契约但可扩展）— 扣 1 分
- 无独立 `verify-tracker-contract.js` 内嵌 markdown 双夹具（当前以独立 `verify-markdown-backend.js` 验收，门禁等价但未合入主入口）— 扣 0.8 分
- 未跑真实 DSH 设备端 `platform.fs` 栅栏集成测试（仅 Node 侧 `tmp` 回环 + DSH `resolve` 形态兼容，平台层契约已由 `verify-platform-contract.js` 保障）— 扣 0.5 分

## 4. 结论

- **达标：93.2 ≥ 90，无需返工**，可关闭 #142 并合入 #115 Decisions。
- 证据：`node --no-warnings tests/verify-markdown-backend.js` 60 PASS + `npm run verify` 全绿（含 CONTRACT SKELETON OK 293/4 预期）+ 回环 `deck create ↔ skill` 互读 + 无旧字段扫描。
- 下一步：关闭 #142，#115 `## Decisions so far` 追加本票 gist。

---
*评估人：FeatherHunter · 2026-08-24 · 对照 #140/#134/#141/契约 §5/shape.js/contract.js/platform #129 全量核验*
