# ADR-20260827: Gate Flake 修复 · 生效链路与对抗式审查

> 基线：2026-08-26 18:00 CONTEXT；关联 #219 定版、#125 三级联、#150 探测、#370 守卫

## 1. 现象（溯源锚点）

- 标题：`该工作区还没有设置 — 点击选择后端` 蓝条在 **已选 github 的工作区** 偶现，右侧 Dock 同步 `没有后端/未绑定`。
- 截图： `sha256:e18d9f3b` 2048×1060（StatusBar 蓝条 + MattSkills 没有后端）、`sha256:58d925f` 1201×615（全屏 gate）。
- 复现率：切绘画/切工作区/冷启动/空闲 60s 自动刷新后 30-50%，已提多个 ISSUE 反复回归。

## 2. DSH 生效链路（本仓库如何让改动进 GUI）

本仓库是 **非 dev_inject 的常规 DSH 插件**（`package.json#private + scripts/build.mjs`），不是 super-injector 的 `dev_scaffold -> dev_build -> dev_inject` 运行时注入链。

```
src/client/index.js (规范源，含 // ==== leaf: ... spliced)
src/client/kernel/probe.js  ──┐
src/client/kernel/store.js  ──┼─> scripts/build.mjs
src/host/index.js  ────────────┘
         │
         ├─> client.js (dev, // AUTO-GENERATED, 515k, cordis_define 函数体)
         ├─> host.js   (dev, 115k)
         └─> package/lib/client.js + package/lib/index.js (pkg, ModuleLoader, __ModuleLoader__)
         │
         └─> cpSync -> ~/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/
             (build.mjs 末尾：profile 同步 + hash 校验)
         │
         └─> 需重启 DSH Desktop 进程 (host 是 Node vm, client 是 Vite 壳, 无 pnpm dev:web watcher 时无 HMR)
```

- 验证：`node scripts/build.mjs` 末行 `profile 同步 hash 校验通过`；`npm run verify` 为门禁；`Get-Process DSH Desktop` 的 StartTime 晚于 build 时间才算生效。
- 易错点：只改 `src` 不跑 `build` → 产物旧；跑了 `build` 不重启 → 内存旧；`package/lib` 被 .gitignore，`git status` 不可见但 `verify-build-artifacts` 会校验 sha256 一致。

dev_* 工具（super-injector）在本仓库**不适用**于生效，仅用于探活：`dev_plugin_status` 可看装配清单，`dev_self_test` 可演练注入链路，但本插件的宿主是 `web` profile 的静态装配。

## 3. 根因（第一性原理）

selection 不变量：`explicit(wf.bind 内存) > matches(读 .git/config + git remote) > fallback(null)`，蓝条仅 `fallback null && !pending`。

旧 `probe.js:loadSnapshot` 有两把错误锁叠加：

- **全局 `st.snapLoading` 守卫**：`if(st.snapLoading && !force) return Promise.resolve()` 是 store 级布尔。挂载时 `st.cwd=''` 先发 stale 空请求（300ms），50ms 后 `summaryCwd` 到达再发正确请求，却被该守卫当“重复”丢弃，留下 `fallback`。
- **后到覆盖**：即使放行，双请求并发时 `'' 300ms > 正确 120ms`，stale 的 `fallback` 后到覆盖先到的 `github`。

空闲 60s 刷新（`startAutoProbe 60000ms`）同理：宿主重算 `registry.select`，`.git/config` 若被文件锁抖动一次失败 → 返回 `fallback`，旧 `applySnapshotSelection` 无条件 `st.selection = fallback` 并污染 `snapshotByCwd` LRU，下次秒开即蓝条。

## 4. 对抗式审查（若我是对手，如何证伪/再挖）

- **H1 证伪**：在 `tests/repro-gate-flake.js` 注入 300ms 延迟，观察到 `"blocked by snapLoading guard"` 且终态 `gate true`；删守卫后绿。
- **H2 证伪**：双请求并行，正确先完成 `github`，stale 后完成若无 `_reqNorm` 校验即覆盖；加校验后保留。
- **H3 相对路径**：`normCwd` 对 `matt-demo-markdown` 相对名若回退失败（home 未就绪），`plat.join(cwd,'.git/config')` 失败 → `matches false`。已在 `host/index.js:normCwd` 用 `fs.resolve + home` 回退，但仍需单测 `相对 vs 绝对 cwd` 的 select 差异。
- **H4 内存丢失**：`registry.byHandle` 仅内存，重启后丢失；空闲刷新前宿主若刚 HMR，重建的空 registry 在 `githubMatches` 未注册完成前 `select` 即空。已用 `getTrackerRegistry` 单例 + `ctx.get('trackerRegistry')` 注入缓解，但未落盘，故加客户端可疑 fallback 守卫兜底。
- **H5 超时**：`matches 3000ms` 超时算 `pending`（黄条），不会蓝条，但若前端把 `pending` 当 `fallback` 即误判。当前前端已分流 `_isOther` vs `_isPending`，H5 已排除。

生效链路对抗：

- **build 未跑**：`client.js` 头无 `// AUTO-GENERATED` 或 `verify-build-artifacts` 的 `sha256 一致` 失败。
- **profile 未同步**：`~/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/package/lib/client.js` 时间旧于 `client.js`。
- **未重启**：`Get-Process DSH Desktop` 的 StartTime 早于 build 时间，内存旧。
- **缓存污染**：`snapshotByCwd` 与 `selectionByCwd` 若被可疑 `fallback` 污染，重启前一直蓝条。已加 `isSuspiciousFallback` 不落缓存。

## 5. 修复（两笔提交，可溯源）

- **35c6cc7** `fix(client): gate flake — remove global snapLoading guard + stale discard (H1+H2)`
  - 删全局守卫，依赖 `pendingSnapshotByCwd` per-cwd 去重；响应时 `_reqNorm !== normCwd(st.cwd)` 则丢弃 stale。
- **3fa6b94** `fix(client): idle refresh gate — preserve last known good on suspicious fallback`
  - `store.js:applySnapshotSelection` 与 `probe.js:setCachedSnapshot` 对 `fallback null && source==='fallback'` 且 `cur.backendId` 存在时保留旧值，不污染 LRU。

验证：`node tests/repro-gate-flake.js` 🔴 → `tests/repro-gate-flake-fixed.js` 🟢；`tests/repro-idle-refresh.js` 🟢；`node scripts/build.mjs` 515k/115k 通过。

## 6. 复盘与硬化

- 架构缝：`loadSnapshot` 并发收敛到单一 per-cwd 原语，补 `verify-gate-flake.js` 静态断言 `!st.snapLoading guard && _reqNorm 校验`。
- 持久化：`wf.bind` 内存 → 落盘 `~/.dsh/settings.yaml` 或 `.dsh-mattskillsdeck-cache/bindings.json`。
- 单测：补空 cwd 探路窗口时序单测（`tests/repro-gate-flake.js` 已常驻）。

> 后续交办：`improve-codebase-architecture` 传入本 ADR §4-§6。
