# Tracker 后端接入门槛（每后端必交四件）— #173

本文件是“新增一个 tracker 后端”在契约测试侧的 **checklist**。契约内容已定稿（#124-#128），门槛只约束“**如何证明你满足契约**”，不改契约。

## 结论先行

> 一个后端只有在 **同时**满足以下四件时，才算“接入完成”：
> 1. 适配器代码  2. 真实采样固件  3. 生成脚本  4. 门禁集成且不回归

下游三张后端图（#114/#115/#116）的“落地”验收即“**本后端真实适配器过 harness**”，以本文件为判据。

## 四件清单

### ① 适配器代码 — `src/host/tracker/backends/<backendId>/`

- 目录即后端：`<backendId>` 为开放 string（推荐 `publisher.name`），`'other'` 禁用（→ `selection.backendId: null`）。
- 入口 `index.js` 必须导出 `BackendModule`：

  ```js
  export const myModule = {
    id: 'my-backend',           // 唯一非空 string
    label: 'My Backend',        // UI 微标/显示名
    create: createMyBackend,    // (ctx: BackendContext) => Partial<Tracker>
    matches: myMatches,         // (handle: RepoHandle, ctx: OpContext) => boolean
  }
  ```

- `create(ctx)` 的 `ctx` 是 **BackendContext**（含 **已解析的 `platform` 实例**，见 `src/host/tracker/contract.js`），不是工厂。
  - `platform`: 已按 #129 三底座实现的 OS 抽象（`getHome/path/resolveExecutable/fs/env`），**不可**在后端内自拼 `C:\` 或直接 `import('node:fs')`。
  - `fs`/`exec`/`timers`/`log` 由宿主经此 `ctx` 注入；后端只用它们。
  - 实现**只写你真会的**：`create` 返回对象里只放你实现的 op；**缺的方法不手写，由 `registry.js` 的 Proxy 自动补 `unsupported` 桩**（能力零声明，G5）。
- 13 `OpName`（`OPERATIONS`）按需实现：

  ```
  preflight, list, get, getDependencies, create, close, reopen, comment, update, setLabels, setAssignees, setParent, setBlockedBy
  ```

  - 未实现 → 返回 `{ ok:false, error:{ kind:'unsupported' } }`（由 Proxy 兜底，你也可显式返回）。
  - 写后语义：`create/update` 多字段原子；`set*` 整集替换；增量后端用 `read→diff→N写` 且接受 Last-write-wins；`expectedUpdatedAt` 不匹配 → `conflict`。
  - 环检：`setBlockedBy` 自环/成环 → `conflict` 不落盘。
- 错误分类：失败**返回**而非抛；`kind` 仅八种（`env/auth/rate-limit/conflict/unsupported/not-found/network/parse`），`classifyError` 顺序（`env>not-found`, `auth>rate-limit`, 兜底 `network`）已在 `host/tracker/preflight.js` 固化，后端显式产 `conflict/unsupported`。

- 按操作域拆文件（避免 God file）：`issues.js`/`comments.js`/`labels.js`/`graph.js`/`normalize.js`/`client.js`/`errors.js`/`preflight.js` 等，`index.js` 仅装配。

### ② 真实采样固件 — `tests/tracker-contract/fixtures/<backendId>-real/`

- 每后端至少一份，来源 **真实 API 打一次**（`gh`/`glab`/本地文件），不是手写桩。
- 目录约定：

  ```
  fixtures/<backendId>-real/
  ├─ metadata.json              # 必含：source / sampledAt / repo / refId / desensitization / fields / notes
  ├─ raw-*.json                 # 原始响应（已脱敏）
  ├─ normalized-*.json          # 归一化期望（由本仓库 normalize 生成，供 harness 比对）
  └─ raw-list.json / raw-comments-*.json 等
  ```

- `metadata.json` 模板（见 `fixtures/github-real/metadata.json`）：

  ```json
  {
    "source": "gh api repos/<owner>/<repo>/issues/<n> ...",
    "repo": "<owner>/<repo>",
    "refId": "<owner>/<repo>",
    "sampledAt": "ISO-8601",
    "sampledBy": "scripts/generate-<id>-fixtures.js",
    "desensitization": { "rules": ["..."], "applied": true },
    "fields": { "raw": ["number","title", ...], "normalized": ["key","title", ...] }
  }
  ```

- 归一化期望必须满足 harness 形状断言：单 `key` string、无 `number/subIssues/blocking`、核心字段齐、`state` 二态、`labels` 等能力字段 EMPTY/MISSING 正确、`diagnoseCapabilities` 可跑、frontier/indeterminate 分流正确。

### ③ 生成脚本 — `scripts/generate-<backendId>-fixtures.js`

- 可复现：`node scripts/generate-<id>-fixtures.js --repo <ref> --out fixtures/<id>-real` 一键重采。
- 记录来源：脚本头注释与 `metadata.json.source` 双处记录端点/API。
- 记录脱敏：脚本头注释与 `metadata.json.desensitization.rules` 双处记录规则（token/邮箱/内部 URL 等），并**实做**脱敏（正则替换）。
- 归一化产物：脚本内 `import('../src/host/tracker/backends/<id>/normalize.js')` 生成 `normalized-*.json`，保证“采样→归一”链路与 harness 同款 normalize。

参考实现：`scripts/generate-github-fixtures.js`（GitHub 已落地）。

### ④ 门禁集成且不回归 — `tests/verify-tracker-contract.js`

- 在 `verify-tracker-contract.js` 追加：

  ```js
  import { myFixture } from './tracker-contract/fixtures/<id>.js' // 或直接测 normalize
  import { runPlayback } from './tracker-contract/runner/index.js'
  // 1) normalize 形状：runContractTests(myFixture) 必须全 PASS
  results.push(...runContractTests(myFixture))
  // 2) playback：采样固件形状（无网络亦可）
  const pb = await runPlayback({ fixturesDir: 'tests/tracker-contract/fixtures/<id>-real', label: '<id>-playback' })
  results.push(...pb.results)
  ```

- 回归红线（验收④）：

  - 既有 `293 passed / 4 failed / CONTRACT SKELETON OK` 仍成立（`4 failed` 全为 `violating` 桩，刻意 FAIL）。
  - `compliant` 全 PASS、`violating` 至少一 FAIL、`github`/`gitlab` normalize 全 PASS、`sections/*` 全 PASS（含 ✗ probe 自证）。
  - 新增后端的 `runContractTests` 与 `runPlayback` 全 PASS，`CONTRACT SKELETON OK` 仍 `exit 0`。

## 最小可跑示例（GitHub）

```bash
# 生成采样
node scripts/generate-github-fixtures.js --repo FeatherHunter/dsh-mattpocock-skills-deck --issue 173

# 纯形状门禁（无网络亦可）
node tests/verify-tracker-contract.js
# 期望：293 passed, 4 failed, CONTRACT SKELETON OK
# 新增段：github-playback · metadata exists 等全 PASS
```

## 常见坑

- 在后端内 `import { fs } from 'node:fs'` 直读文件 → 破坏 #129 次缝；必须经 `ctx.platform.fs`。
- 自拼 `C:\\Users\\` 路径 → 破坏零手拼；必须用 `platform.path.join` / `joinHome`。
- 手写 `capabilities` 表 → 破坏 capability-by-fill；能力由 `diagnoseCapabilities` 事后推导。
- 采样手写而非打 API → 破坏“真实性”；必须脚本可复现且记录来源/脱敏。

## 参考

- 契约：#124/#125/#126/#127/#128；目录架构：#132；平台可测：#131；Runner：`tests/tracker-contract/runner/index.js`
