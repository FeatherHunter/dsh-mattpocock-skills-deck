# Tracker 契约测试 — Runner 与真实采样规约（#173）

本目录是 **Tracker 契约（主缝）**的验收入口。契约内容已定稿（#124/#125/#126/#127/#128），本目录只负责“**如何证明后端真的满足契约**”。

## 第一性原理

- 契约说真话：完整数据形状（`src/shared/tracker/shape.js`）+ 13 操作集（`src/host/tracker/contract.js`）+ capability-by-fill + registry 三级联，已由 #124-#128 定稿。
- 骨架已自洽：#132 门禁 `293 passed / 4 failed / CONTRACT SKELETON OK` 仅证明“桩能过、违规能逮”，测的是 `fixtures/compliant.js` 与 `violating.js`，不是真实适配器。
- 平台可测：#131 的 145+32 方法论（注入可判真 + 零手拼 + 双闸）已让次缝（平台层）单机判三端；主缝需复用同一方法论，但对象改为“后端适配器”。

推导：harness 必须从“**测试固件**”升级为“**真实适配器 + 真实采样固件**”，否则 #114/#115/#116 的“本后端真实适配器过 harness”无锚点。

## 目录结构

```
tests/tracker-contract/
├─ harness.js               纯形状断言（normalize → Issue 形状，EMPTY vs MISSING，frontier/indeterminate）
├─ runner/
│  └─ index.js              真实适配器 Runner（#173 新增）— 接受 Tracker 实例 + RepositoryRef + 夹具目录
├─ fixtures/
│  ├─ compliant.js          合规桩（最小形状，恒 EMPTY）
│  ├─ violating.js          违规桩（故意错映射 + MISSING，结果必须被 harness 逮住）
│  ├─ markdown.js           Markdown 真实适配器形状（parse/normalize 驱动）
│  ├─ gitlab.js             GitLab 双路径形状（free 回退 vs premium 原生）
│  └─ github-real/          GitHub 真实采样（#173 新增，至少一份）
│     ├─ metadata.json      来源/脱敏/时间/字段清单
│     ├─ raw-issue-173.json 原始 API 响应（已脱敏）
│     ├─ raw-list.json      近期列表 5 条（已脱敏）
│     ├─ normalized-173.json 归一化期望（由 normalizeIssue 生成，供比对）
│     └─ normalized-list.json
├─ sections/                行为段（contract/registry/preflight/deck/snapshot，每段含 ✗ probe 自证）
└─ ONBOARDING.md            每后端接入门槛（#173 验收③）
```

## Runner 使用（验收①）

Runner 的不变量：**工厂 ctx 注入 + platform 实例**。

```js
import { createRunnerContext, runWithAdapter, runPlayback } from './tests/tracker-contract/runner/index.js'
import { githubModule } from './src/host/tracker/backends/github/index.js'

// 1) 造 BackendContext（含已解析的 platform 实例，符合 #129 三底座可测性）
const backendCtx = await createRunnerContext({ cwd: '/repo', os: 'linux' })
// backendCtx.platform  // 已是 Platform 实例（getHome/path/resolveExecutable/fs/env）
// backendCtx.platform.os === 'linux'

// 2) 造真实 Tracker（经工厂注入）
const tracker = githubModule.create(backendCtx) // 或 createRegistry 后 wrap，但直连亦可

// 3) 选仓库与夹具
const repo = { backend: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'deck', url: '' }
const fixturesDir = 'tests/tracker-contract/fixtures/github-real'

// 4a) Live 模式（需网络 + gh 已登录 + ctx.exec 已注入真实 exec）：会调 list/get/getDependencies 并比对采样
const live = await runWithAdapter({ tracker, repo, fixturesDir, opCtx: { cwd: '/repo', signal: AbortSignal.timeout(8000) }, label: 'github-live' })
console.log(live.results.filter(r=>!r.ok))

// 4b) Playback 模式（CI 无网络亦可）：仅校验采样固件形状与脱敏，不调网络
const pb = await runPlayback({ fixturesDir, label: 'github-playback' })
console.log(pb.results.filter(r=>!r.ok))
```

关键：`BackendModule.create` 的入参是 `BackendContext`（含 `platform` 实参实例，非工厂），`OpContext` 每调注入 `cwd/signal/refId`。`createRunnerContext` 已按 #131 注入范式实现 OS 覆盖与 env/homedir 注入，单机可判三端。

## 真实采样生成（验收②）

每后端至少一份，采样 = **打真实 API → 脱敏 → 落盘 JSON + metadata**。

### GitHub

```bash
node scripts/generate-github-fixtures.js --repo FeatherHunter/dsh-mattpocock-skills-deck --issue 173 --out tests/tracker-contract/fixtures/github-real
```

来源记录于 `fixtures/github-real/metadata.json`：

- `source`: 具体 `gh api` 端点（`repos/<owner>/<repo>/issues/<n>` + list + comments）
- `sampledAt`/`repo`/`refId`/`issue`
- `desensitization.rules`: 四条规则（见脚本头注释；当前公开仓库无需改 body，但规则已固化）
- `fields`: 原始与归一化字段清单

脱敏规则（与 #131 平台采样一致“记录来源/脱敏”）：

1. 不记录 Authorization/token（脚本不取请求头）
2. `ghp_` / `github_pat_` → `[REDACTED]`
3. 邮箱 → `redacted@example.com`
4. 仅保留归一化所需字段，移除 etag/rate-limit 等头

生成后 `normalized-*.json` 由本仓库 `normalizeIssue` 生成，可被 `runPlayback` 直接校验形状（无 `number`/`subIssues`/`blocking`，`state` 二态，`labels` EMPTY 等）。

### Markdown / GitLab

- Markdown：采样为本地 `.scratch/<effort>/` 目录的真实 markdown 票据（Status/Type/Blocked by/Comments/Answer），生成脚本复用 `scripts/generate-markdown-fixtures.js`（待 #115 落地时提供），采样目录 `fixtures/markdown-real/`。
- GitLab：采样为 `glab api` 或 REST 的 `iid/title/state/description/labels/milestone`，生成脚本 `scripts/generate-gitlab-fixtures.js`（待 #116 落地时提供），采样目录 `fixtures/gitlab-real/`。能力响应（free vs premium）由同一 harness 的 `implementedFields/missingFields` 区分。

## 接入门槛（验收③）

详见 `ONBOARDING.md`。一句话：**新增后端需提交四件**：

1. `src/host/tracker/backends/<id>/` 适配器（`index.js` 导出 BackendModule，13 ops 按需实现，缺的由 registry Proxy 补 `unsupported`）
2. `tests/tracker-contract/fixtures/<id>-real/` 采样固件 + `metadata.json`（来源/脱敏/时间/字段）
3. `scripts/generate-<id>-fixtures.js` 生成脚本（可复现，记录来源/脱敏）
4. `verify-tracker-contract` 集成（`tests/verify-tracker-contract.js` 中 `runContractTests(<id>Fixture)` + `runPlayback`）并保持 `293/4/OK` 不回归（验收④）

## 门禁（验收④）

既有门禁不变：

```bash
node tests/verify-tracker-contract.js
# 期望：293 passed, 4 failed（4 条为 violating 桩，刻意 FAIL）, CONTRACT SKELETON OK, exit 0
# 回归红线：compliant 全 PASS、violating 至少一 FAIL、github/gitlab normalize 全 PASS、sections 全 PASS（含 ✗ probe）
```

新增 Runner 的门禁（同文件末尾，新增段）：

```bash
node tests/verify-tracker-contract.js  # 已集成 playback 段：github-real playback 全 PASS
# 或单独：node tests/tracker-contract/runner/smoke.js
```

新增后端未提供采样/脚本/门禁集成，视为未达接入门槛。

## 与 #131 的关系

- #131 = 次缝（平台层）真实采样（`getHome` 的 win32 盘符、`resolveExecutable` 的 PATH/PATHEXT）；对象是 OS 原语。
- #173 = 主缝（后端）真实采样（Issue/Label/Comment 等）；对象是 tracker 数据。
- 共享方法论：真实数据采样 + 脱敏 + 固件落盘 + 单机可判真（注入），但不同对象。

## 参考

- 契约定版：#124/#125/#126/#127/#128
- 骨架落地：#132（`src/host/tracker/*` + `tests/tracker-contract/*`）
- 平台可测性：#131（`src/host/platform/index.js` + `tests/verify-platform-contract.js`）
- 后端落地：#114/#115/#116（各后端首验收 = “本后端真实适配器过 harness”）
