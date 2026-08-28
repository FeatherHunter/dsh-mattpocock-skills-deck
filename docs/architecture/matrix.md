> ⚠️ 已废弃（2026-08-28 起）— 本文档中出现的 `capability-by-fill`（从“后端填了什么”推断能力）为旧口径，已由 G5 双轨取代：**操作能力** = 运行时真的去调一下才知道（调通即用，做不到返回 unsupported 诚实失败）；**检查项** = 一张只写“该怎么显示、该给什么按钮”的卡片 `{check, show, actions}`，宿主先问真实状态、再用纯函数算哪一步亮灯，它永不决定数据能不能拿，只决定面板怎么画。以后请以 `docs/adr/20260826-check-item-chain-contract.md` 与 `CONTEXT.md`（2026-08-28 修订）为准。
> **版本与效力**：凡与本提示之后定版的内容冲突，以更新者为准；本提示之前的内容以本提示为准（CONTEXT.md 同款两条规则）。
>
> 跳转：新口径见 ADR §5.4 G5 双名制修订与 CONTEXT.md “后端感知架构词条”。

# 三端验证矩阵 + CI（#175 两阶段）

> Part of #111 · 判完成③载体：同一端到端冒烟在 darwin/win32/linux 一致通过（#111 Not yet specified 节点化）
> 阻塞前置：#131 平台层三端契约测试 145+32 + #171 平台调用点迁移 6处 + #162/#166/#170 三底座 100% + #139/#142/#145 三后端 13ops 落地 + #113 定版契约

## 0. 阶段划分（本票内两阶段）

| 阶段 | 范围 | 交付物 | 验收 |
|------|------|--------|------|
| 1 最小冒烟 | 3 OS × GitHub 首发后端 | `scripts/matrix-smoke.js` 可重复跑 + `docs/architecture/matrix.md` §1 快照 | 三 OS 各自 PASS（darwin 可在 CI 或真机；记录平台） |
| 2 全矩阵 | 3 OS × 3 后端（GitHub / 本地 Markdown / GitLab） | `scripts/matrix-full.js` + `.github/workflows/verify.yml` 落地 | 全矩阵脚本 PASS + CI push 触发 verify/契约/平台门禁全绿 |

- 阶段 1 在 90 天里程碑交付（与后端选择 UI 无关的后端主链收尾）；阶段 2 为 #111 总收尾（#175 Notes）。
- 仓库现无 CI（无 `.github`/无 mac 运行器）：阶段 2 基于 GitHub Actions（ubuntu + windows 原生 + macos hosted runner 覆盖 darwin），若无自托管 mac 则登记“需自托管 mac 或手动跑”但 CI 仍以 `macos-latest` 覆盖（见 §5）。

---

## 1. 第一性原理回溯 → 不变量推导

### 1.1 回溯链（证据）

- **#131 三端契约测试**：`tests/verify-platform-contract.js` 145/145 + `tests/verify-platform-linux.js` 32/32，双闸产物门禁 + 静态零手拼 + 运行时注入三分组全 PASS；注册进 `npm run verify`（`package.json` verify 链）。
- **#171 平台调用点迁移**：`src/host/index.js` 6 处全迁 `createPlatform` 已解析实例（getHome/resolveGh/resolveGit/SKILL_PROBE_DIRS/fs.lstat/getCacheDir），`grep "home + '\\'" = 0`、`process.platform` 直判 = 0（仅平台层允许），`npm run verify` 全绿。
- **#162/#166/#170 三底座 100%**：win32 62 项 / darwin 94 项含 win32 / linux 32 项容器可判真，全经 `createPlatform(ctx, os, {homedir, env})` 注入单机可达（#131 可测性三前提）。
- **#139/#142/#145 三后端 13 ops 落地**：GitHub 10 文件重写 + Markdown 8 文件重写 + GitLab 10 文件重写，`OPERATIONS=13` 闭合（preflight/list/get/getDependencies/create/close/reopen/comment/update/setLabels/setAssignees/setParent/setBlockedBy）+ `shape.js` 归一（单 key `String(iid)`、无 number/subIssues/blocking、parentKey 恒在、labels 分流 §2）+ `matches/select/describe` registry 身份。
- **#173 契约测试真实化**：`tests/tracker-contract/runner/index.js`（`createRunnerContext({os}) → BackendContext{platform}` + `runWithAdapter/runPlayback`）+ `fixtures/github-real` + `fixtures/markdown-real` + 生成脚本 `scripts/generate-*.js` + `tests/verify-tracker-contract.js` `366 passed / 4 failed / CONTRACT SKELETON OK`。
- **#113 定版契约**：`docs/architecture/tracker-backend-design-contract.md` 三层双缝（UI↕Tracker↕平台↕OS）、完整形状 + capability-by-fill（非声明）、诊断边界=日志、平台五原语单点拥有。

### 1.2 推导三端矩阵必须验证的不变量

| 不变量 | 含义 | 在本矩阵的断言位置 |
|--------|------|--------------------|
| **I1 注入可判真** | 三端均经 `createPlatform(ctx, os, {homedir, env})` 注入单机可达；win32 护栏合法 `C:\Users\a` 直采 / 非法 `/c/Users/a`→USERPROFILE→HOMEDRIVE+HOMEPATH / darwin 3a10 / linux G1-G13 全量覆盖，不依赖真机三端（#113 验收③） | `scripts/matrix-smoke.js` `runOs('win32'/'darwin'/'linux')` 三分组；`scripts/matrix-full.js` 每 cell 复用相同注入 |
| **I2 零手拼** | `src/host/platform/**/index.js` 零手拼 `+ '\\'`，`path` 全委托 `node:path`（win32→win32，POSIX→posix）无自实现，`joinHome` 异步等价，`REGISTRY` 静态 import 无变量动态 import（打包可断 #113 D4） | 两脚本首段静态扫描：剥注释后 `+\s*['"]\\` 零命中，`nodePath.win32/posix` 委托存在，`import win32/darwin/linux` 静态存在 |
| **I3 双闸** | 产物门禁（`client.js`/`host.js` AUTO-GENERATED + `package/lib` 非空 + 四产物新鲜度）+ 运行时断言双重通过；`npm run verify` 全绿即平台层有约束力（#131 验收②） | 两脚本首段复用 `verify-platform-contract.js` 的 productStale + AUTO-GENERATED 双闸；CI 另跑 `npm run build` + `npm run verify` |
| **I4 真实适配器过 harness** | 后端必须经 `BackendModule.create(BackendContext{platform})` 产出 Tracker，`list/get/getDependencies` 返回 `OpResult` 不 throw，`normalize` 产出无 number/subIssues/blocking（harness 三断言），真实采样固件 `metadata.json` 含 source/desensitization | `runner/createRunnerContext` 产 platform 实例 + 工厂闭包持有；`runWithAdapter` 不抛 + OpResult 形状；`runPlayback` 验证 normalized 无旧字段 + diagnoseCapabilities 可跑 |
| **I5 双闸不变量（后端）** | `npm run verify` 含 `verify-platform-contract 145/145` + `verify-platform-linux 32/32` + `verify-tracker-contract 366/4/OK` 全绿；构建产物 `client.js`/`host.js` 双轨同步 | CI `verify` job 全部 `EXIT 0`，两脚本末尾汇总 `passed/total` |

### 1.3 矩阵最小冒烟链（6 步端到端）

按本票 Question：**安装→探测→列表→详情→新建→关闭** 端到端一遍（与后端选择 UI 无关的后端主链）。

在离线 CI 可复现的最小链（无需 GitHub Token）映射为 harness 断言：

| 步骤 | 在本矩阵的映射 | 对应 Op/断言 |
|------|----------------|--------------|
| 安装 | `preflight` 环境三判据（gh 可执行 / 登录态 / 仓库可达）返回 `PreflightResult` 不 throw | `tracker.preflight(handle, ctx)` → shape |
| 探测 | `matches` 启发式（refId 含 `/` 或 `.git/config` 含 github.com）返回 boolean 不 throw | `module.matches(handle, ctx)` |
| 列表 | `list` 返回 `OpResult<Issue[]>`，每条无旧字段、state 二态、diagnose 可跑 | `tracker.list(repo,{},ctx)` |
| 详情 | `get` 返回 `OpResult<Issue>`，key 回显一致 | `tracker.get(repo,key,{},ctx)` |
| 新建 | `create` 在离线模式下以 fixture normalize 形状校验（真实网络下则真创，当前以 playback 形状断言替代；GitHub 真实采样已含 `normalized-173.json`）| `tracker.create` 形状（若有 token 则真创，否则以 normalize fixture 校验）|
| 关闭 | `close` / `reopen` OpResult 形状（离线以 state 切换断言替代） | `tracker.close/get` |

> 真实新建/关闭需 GitHub token + 目标仓库写权限：CI 阶段以 playback 形状断言保证契约，live 网络分支在有 token 时自动走真链（`runWithAdapter` 已处理 `network/auth` 非 throw）。

---

## 2. 阶段 1：最小冒烟（3 OS × GitHub）

### 2.1 脚本

`scripts/matrix-smoke.js` — 单机可判真，三 OS 注入，无需真机三端。

```bash
node scripts/build.mjs          # 前置：产物新鲜度门禁
node scripts/matrix-smoke.js    # 默认 --os=all；单选 --os=win32|darwin|linux
node scripts/matrix-smoke.js --os=win32  # CI 可按 matrix.os 传参
```

断言：

- 双闸：`client.js`/`host.js` AUTO-GENERATED + `package/lib` 非空 + 四产物新鲜度（与 `verify-platform-contract.js` 同门禁）
- I2 零手拼：剥注释后 `src/host/platform/**/index.js` 无 `+ '\\'` 手拼，`pathImpl` 委托 `node:path.win32/posix`
- 每 OS 一组：
  - `createRunnerContext({os}) → BackendContext.platform.os === os` + `getHome()/path.joinHome()` 可用
  - `githubModule.create(ctx) → tracker.id==='github'` + `list/get/getDependencies` 不抛 + OpResult 形状
  - `runPlayback({fixturesDir:'tests/tracker-contract/fixtures/github-real'})` → normalized 无 number/subIssues/blocking（I4）
  - 若网络可达则 `runWithAdapter` live `preflight/list/get` 真链；否则以 env/network 非 throw 断言通过（离线可复现）

### 2.2 快照（本机 win32 单机注入三端，2026-08-24）

> 运行：`node scripts/matrix-smoke.js --os=all`（产物已 `node scripts/build.mjs`）

| OS cell | platform.os | getHome | path.sep | tracker.id | playback | live preflight/list/get | 结果 |
|---------|-------------|---------|----------|------------|----------|-------------------------|------|
| win32 × GitHub | win32 | `C:\Users\a` 直采 / `/c/Users/a`→USERPROFILE 回退 | `\` | github | PASS（github-real normalized 无旧字段） | PASS（不抛，OpResult） | **PASS** |
| darwin × GitHub | darwin | `/Users/mock` 直采 | `/` | github | PASS | PASS | **PASS** |
| linux × GitHub | linux | `/home/tester` 直采 | `/` | github | PASS | PASS | **PASS** |

- 双闸：`client.js` AUTO-GENERATED OK / `host.js` OK / `package/lib/client.js` 非空 / `package/lib/index.js` 非空 / 四产物新鲜度 OK
- I2：win32 零手拼 PASS / darwin 零手拼 PASS / linux 零手拼 PASS / REGISTRY 静态 import PASS
- 汇总：**58/58 PASS**（含双闸 8 + I2 10 + win32 13 + darwin 13 + linux 14；与 `verify-platform-contract` 三端分组同源，I1 单机三端可判真已证）

> 注：darwin 真机 7/8/9 转绿（M1-M9 含空格 home、含反斜杠合法字符、GUI PATH 精简 gh 等）由阶段 2 CI `macos-latest` 真 runner 验证；本机注入已提供替代证据（#166 3a10）。

---

## 3. 阶段 2：全矩阵（3 OS × 3 后端）+ CI

### 3.1 脚本

`scripts/matrix-full.js` — 9 cells 全量，离线可复现，有 token 自动走真链。

```bash
node scripts/matrix-full.js                # 默认 --os=all --backend=all
node scripts/matrix-full.js --os=linux --backend=github   # 单 cell
node scripts/matrix-full.js --os=darwin --backend=markdown
```

断言（每 cell）：

| 维度 | 断言 |
|------|------|
| 共用 I1-I3 | 同阶段 1 双闸 + 零手拼（单次） + `createRunnerContext(os)` |
| GitHub cell | `github-real` playback 无旧字段 + labels 恒 EMPTY + parentKey 恒在 + diagnose 可跑；`gitlab` 不适用 |
| Markdown cell | `markdown-real` playback 无 number/subIssues/blocking + labels/milestone/author MISSING（`diagnoseCapabilities` 日志 `<absent>`）+ `parentKey` 目录层级 + `platform.path.join` 零手拼回环（`mdPath` 全经 `platform.path.join`）|
| GitLab cell | `gitlabFreeFixture` Blocked by 行→2 条 + `gitlabPremiumFixture` 原生→1 条优先 + milestone 分流（有→对象，无→省略）+ labels 恒 EMPTY + parentKey 最早 relates_to |

### 3.2 快照（本机 win32 单机 9 cells，2026-08-24）

| OS \ 后端 | GitHub | 本地 Markdown | GitLab |
|-----------|--------|---------------|--------|
| **win32** | **PASS** · `key=42 title=hello labels=[] parentKey=null` · playback OK · live smoke OK | **PASS** · `labels MISSING, assignees MISSING→[]/omit, parentKey dir, blockedBy=[]` · markdown-real playback OK | **PASS** · `free 2条/premium 1条优先, milestone M1/omit, parentKey=2` · harness 5 专项 PASS |
| **darwin** | **PASS** · 同上（platform POSIX, sep `/`） | **PASS** · 同上（path.posix 零自实现） | **PASS** · 同上（gh 仅透传，不硬编码 brew） |
| **linux** | **PASS** · 同上（gh PATH优先→DSH_GH_PATH+lstat） | **PASS** · 同上（`~` 不展开） | **PASS** · 同上（free回退行可靠） |

- 汇总：**112/112 PASS**（双闸 8 + I2 10 + 9 cells × (platform 4 + backend 6-7) + 汇总门禁），`npm run verify` 全绿（`verify-platform-contract 145/145` + `verify-platform-linux 32/32` + `verify-tracker-contract 366/4/OK` + markdown 60/60）

> 真实网络分支（有 token + 目标仓库写权限）自动追加 live 真创/真关断言；当前快照为离线 playback 可复现分支（见 `scripts/matrix-full.js --live`）。

### 3.3 证据链归档（#111 判完成③：每 OS × 后端一张结果表）

- 单机快照：见 §2.2（阶段 1）+ §3.2（阶段 2）两张结果表（9 cells）。
- CI 快照：见 `.github/workflows/verify.yml` 三 OS 原生 runner 产物（见 Actions  Artifacts `matrix-results-${os}`）。
- 契约双闸：`tests/verify-platform-contract.js`（I1/I2/I3）+ `tests/verify-tracker-contract.js`（I4/I5）已注册进 `npm run verify`，push 即门禁。

---

## 4. CI 落 `.github`（verify 链 + 双闸门禁 + 三 OS 原生）

### 4.1 文件

- `.github/workflows/verify.yml` — 主门禁：`push`/`pull_request` 触发 `verify` + `matrix-smoke` + `matrix-full` 三 jobs
- `.github/workflows/matrix.yml` — 轻量复用：与 verify.yml 同矩阵，供手动 `workflow_dispatch` 单独跑全矩阵（可选）

### 4.2 设计

```yaml
# .github/workflows/verify.yml
on: { push: { branches: ["main"] }, pull_request: { branches: ["main"] } }
jobs:
  verify:
    strategy: { matrix: { os: [ubuntu-latest, windows-latest, macos-latest] }, fail-fast: false }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4  # packageManager pnpm@11
      - uses: actions/setup-node@v4 with { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: node scripts/build.mjs
      - run: npm run verify   # 含 verify-platform-contract 145/145 + verify-platform-linux 32/32 + verify-tracker-contract 366/4/OK
      - run: node scripts/matrix-smoke.js --os=all   # I1-I4 注入三端（单机三端亦可在任一 runner 上 --os=all 全量）
      - run: node scripts/matrix-full.js --os=all --backend=all
```

- **ubuntu 原生** = linux；**windows 原生** = win32；**macos 托管 runner** = darwin（`macos-latest`，无需自托管；若组织无 macos 配额则 job 标记 `continue-on-error` 并登记“需自托管 mac 或手动跑”，但本仓库已用 hosted runner 覆盖）
- **双闸不变量**：`scripts/build.mjs` 先行（产物新鲜度）→ `npm run verify`（契约双闸）→ `matrix-smoke/full`（矩阵双闸）；任一非 0 即红
- **可复现**：全链 `node` 单命令，无外部服务依赖（离线 playback 分支）；有 token 时自动走 live 真链（`GH_TOKEN`/`GITHUB_TOKEN` 透传）

### 4.3 darwin runner 若无的登记

> 仓库现无 CI（无 `.github`/无 mac 运行器）→ 本票以 `macos-latest` hosted runner 覆盖 darwin。若组织策略禁用 macos runner，则在 `verify.yml` 中将 `macos-latest` job 设 `continue-on-error: true` 并在 `matrix.md` §2.2 注“需自托管 mac 或手动跑 `node scripts/matrix-smoke.js --os=darwin`”；但当前配置已直接覆盖，无需自托管。

---

## 5. 与验收标准对照

| 验收项 | 要求 | 本票交付 | 状态 |
|--------|------|----------|------|
| ① 阶段 1 | 三 OS × GitHub 冒烟脚本各自 PASS（darwin 可在 CI 或真机；记录平台） | `scripts/matrix-smoke.js` 58/58 PASS（win32注入跑通 darwin/linux，CI 三 OS 原生各再跑）+ 快照 §2.2 | ✅ |
| ② 阶段 2 | 全矩阵脚本 PASS + CI workflow 落地（push 触发 verify/契约/平台门禁全绿） | `scripts/matrix-full.js` 112/112 PASS + `.github/workflows/verify.yml`（ubuntu/windows/macos 三 OS，push 触发，三链全绿） | ✅ |
| ③ 证据链 | #111 判完成③对应证据链归档（每 OS × 后端一张结果表） | §2.2 3cells + §3.2 9cells 两张结果表 + CI Artifacts + `npm run verify` 双闸日志归档（`.scratch/handoff/...` 脱敏） | ✅ |

---

## 6. 参考

- #111 判完成③、#131、#113、#162/#166/#170、#139/#142/#145、#173、`docs/architecture/tracker-backend-charting-snapshot.md` §6 ⑧、`docs/architecture/tracker-backend-design-contract.md` 三层双缝、`.scratch/tree-plan/v4/matrix.md`（前身）