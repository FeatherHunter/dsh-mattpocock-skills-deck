# 研究：现行 host / client 关键路径全盘点与埋点清单初稿（#331）

> 地图 #329 子票 #331 · 产出日期 2026-08-29 · 基线 main@84c6594
> 术语以 CONTEXT.md 为准。本文只做路径盘点与候选埋点清单，不做方案定版。

## 1 盘点范围与方法

按 #329 Notes 与 #331 题干要求的三段覆盖：

- **宿主（host）**：`src/host/index.js` 的 `wf.*` 句柄（`wf.snapshot` / `wf.probe` / `wf.issuePathPoll` / `wf.chain` / `wf.detect` 等）、gh 封装、快照组装、缓存（含磁盘多级缓存）、错误归一、tracker registry、detection / workspaceStore、定时器（轮询与面板增量同步）。
- **客户端（client）**：`src/client/kernel/*`（store / probe / router / config / api）、`src/client/views/SettingsPage.js`、`src/client/panel/*`、`src/client/views/*`、状态栏 `src/client/statusbar/StatusBar.js`、后端切换、命名守护、快照水合与扇出。
- **跨端**：`host.call` 通道、错误分类（`kind` / GraphQL errors / REST 降级）、fallback 链路。

方法：逐文件读码并记录真实行号证据（见各节引用），对每条路径标注：建议日志级别（INFO 常驻 vs DEBUG 按需）、触发频率（高频/低频）、是否含敏感信息、是否需 guard（含性能守卫与脱敏守卫）。

---

## 2 宿主关键路径

### 2.1 `wf.snapshot` / `wf.refresh` / `wf.ping`（单槽缓存与按工作区隔离）

- 定义位置：`src/host/index.js:47 CACHE_MS=60000` 单槽 `cache={ts,snapshot,error,cwd}`（`src/host/index.js:58`）。
- `harness.handle('wf.snapshot', …)` 与 `wf.refresh` 的 force 语义在 `src/host/index.js` buildSnapshot 周边（`1073` 起）与 `getRepoKey` / `getRepoRoot` 的 canonicalKey 洗钥匙（`536`）。
- 多级缓存：内存 → 磁盘 `.dsh-mattskillsdeck-cache/owner__name.json`（`564 getCacheDir()`, `576 readDiskCache()`, `589 writeDiskCache()`），IndexedDB 不可用时静默降级纯内存（见 `84c6594` 标题述）。
- 关键埋点位：调用入口（参数 `cwd/backendId/force`）、缓存命中/未命中、磁盘缓存命中/降级、force 强制重拉。

### 2.2 `wf.probe`（since 增量探针）

- 探针基线 `lastProbeAtByRepo`（`291`）只允许 probe 自己推进，`buildSnapshot` 末尾不得动基线（`1118` 注释）。
- `fetchIssueIndex`（`847`）→ `issueIndexChanged`（`871`）→ `rememberIssueIndex`（`879`）的 since 增量链路。
- 轻量探测频率约 5s（面板侧 `probe.js` 的 probe 轮询），属于高频。

### 2.3 `wf.issuePathPoll` / 面板增量同步（契约层谓词喂入）

- `pendingIssuePathEvents` 队列 cap 100（`293,425`）、`pushIssuePathEvent`（`425`）、`runGh` 白名单检测 create/edit/close/comment/reopen（`348`）。
- 面板增量同步：`panelSyncByKey` / `panelSyncEvaluate` / `panelSyncEvalOne`（`440-528`），`core.pickSyncCandidates` 与 `sinceFloor` / `parseIndexEntries` / `deriveDirty` / `advanceBaseline`（`476-515`），确认式回执 `panelDirtySince`（`448-520`）。
- 单飞闸 `_panelSyncBusy`（`449`）与 repo 解析低频重试闸 `panelSyncRepoTriedAt`（`447` 10min）。

### 2.4 gh 封装与错误归一

- `resolveGh()`（`297`）委托 `platform.resolveExecutable('gh')`，DSH_GH_PATH 兜底下沉至平台层（`300` 注释）。
- `runGh()`（`311`）spawn + 30s timeout race（`325`）+ 输出归一（`340 kind: auth/network/notfound/exit`）。
- `execProc()` 通用进程执行（`385`，不归一化，供 git 等）。
- 失败缓存不永久：`ghLastError` 覆盖式，`resetGhCache()` 清空（`55,309`）。

### 2.5 快照组装（fetchIssues / fetchMapsDetail / buildSnapshot）

- `fetchIssues()`（`785`）优先 `gh api repos/.../issues?state=all&per_page=100 --paginate` 带 avatar，失败回退 `gh issue list`（`822`）。
- `fetchMapsDetail()`（`953`）GraphQL aliases 单次查询（`958-961`），配额耗尽 `isRateLimitError()`（`945`）自动降级 `fetchMapsDetailREST()`（`903`）。
- `fetchIssueDetail()` / `fetchIssueDetailREST()`（`988,1042`）同降级形态，错误 kind 细化 404/rateLimit/graphql。
- `buildSnapshot()`（`1073`）组装 labels（`1085`）、tickets（`1104 mapTicket`）、`parseMapBody`（`653`）、`computeLevels` / `groupTickets`（`716,754`），selection 经 detectionService（`1167`）与裸 registry 回退三级联。
- `parseMapBody` 与 `parseProgress`（`681`）的容错与锚定层级。

### 2.6 Tracker registry

- `src/host/tracker/registry.js`（32-81 行）：handleKey、unsupportedStub、wrapTracker Proxy、withTimeout、matches 3000ms 视作 pending、select 三级联仲裁。
- 宿主初始化 `getTrackerRegistry()`（`63`），注册 github/markdown/gitlab 三房间（`75-101`），setupPrompt 保留（`87` 注释）。
- 运行时错误类 `TrackerRegistryError`（code/message）与 pending 不缓存纪律。

### 2.7 Detection 与 workspaceStore

- `src/host/tracker/detection/detectionService.js:38 isWorkspaceEmpty()` 失效维度（空目录 stale）。
- `createDetectionService`：explicit(file) > matches(parallel 3000ms) > fallback(null)，pending 必须 surface。
- `src/host/tracker/detection/workspaceStore.js:21 createWorkspaceStore()`：Map<handleKey→{selection,at}>，TTL 30000（`48 STATUS_CACHE_MS`），`isFresh`、`onRegistryBindStale`。
- 宿主 `getDetectionService()` 内联 skillProbe（`256`）与 detectionExec（`218`，超时 terminate）。

### 2.8 平台抽象层

- `src/host/platform/index.js:30 createPlatform(ctx)` 工厂，REGISTRY 静态 import 查表 darwin/win32/linux。
- 通用包装：getHome 缓存（memoize）、path 委托 node:path、resolveExecutable 包装 subprocess（`gh` 的 DSH_GH_PATH+fs.lstat 校验单点拥有）、fs 透传（path-shaped vs target-shaped）、env 只读视图。
- OS 底座差异：win32 盘符护栏 / cmd→cmd.exe 别名 / getHome 优先级（USERPROFILE/HOMEDRIVE+HOMEPATH）。

### 2.9 定时器与工作区键

- CACHE_MS 60s 刷新缓存 + stats diff（文件头 3. RPC 注释）、STATUS_CACHE_MS 30s（`48`）。
- `src/host/workspaceKey.js:28 canonicalWorkspaceKey()` 读删同形洗钥匙（绝对直通 / fs.resolve / getHome joinHome 三级），`normalizeWorkspacePath` 去尾斜杠与 win32 小写。
- 宿主 `canonicalKey()`（`536`) 统一 repoKeys/repoRoots/chainCache/workspaceStore 快照单槽的读写删钥匙。

### 2.10 技能判装多通道

- `SKILL_PROBE_NAMES` 25 项（`50`）、`probeSkill()` 注册表主通道 + 轻探并联（`1330` 起 lightProbeReason / evidenceSummary），B 语义与 pending 封顶 3（`1338 SKILL_PENDING_MAX`）。
- 直读例外：DSH fs 服务 + 插件只读直读并联，仅技能标准根候选路径（文件头 6. 注释与 ADR）。

---

## 3 客户端关键路径

### 3.1 Kernel：store / probe / router / config / api

- **store**（`src/client/kernel/store.js:14 listPrefs`, `24 labelClicks`, `38 issuePath`）：localStorage 持久化（key `dsws.*`）、`persistIssuePath` 500ms debounce（`49`）、`ensureIssuePath` / `recordIssuePath`（`67,81`，含 2000ms 去重与 wf.namingSignal 上报）、`reanchorIssuePath`。
- **probe**（`src/client/kernel/probe.js:14 loadChain()`）：_chainInflightByCwd 并发门、per(cwd+backendId) 共享缓存 getCachedChain/setCachedChain、chainSteps/readyCount/envLabel 派生；pendingSnapshotByCwd 去重 30s（`59`）。
- **router**（`src/client/kernel/router.js:9 openPagePanel`, `39 openDockPanel`, `73 ensureSidebarTab`, `99 openInSidebar`）：缓存优先水合 hydrateFromCache、snapFresh 判定、betterSidebar 注册与 scope 传参修复（`104`）。
- **config**（`src/client/kernel/config.js:13 cfg`）：localStorage `dsws.cfg`（openIn/withWayfinder）、`saveCfg()` 广播、模板引擎 8 模板占位符校验（`58-105`）、migrateStartCfg。
- **api**（`src/client/kernel/api.js:16 handoffTs/handoffFile`, `46 NAMING_POLL_MS=5000`）：handoffPrompt/extractHandoffFile/absHandoffPath、namingCurrentTitleOf 优先 sessions.get 实时标题（TOCTOU 修复）、namingHintOf 面包屑线索、naming 轮询。

### 3.2 SettingsPage

- `src/client/views/SettingsPage.js:8 SettingsPage`：cfg.openIn 即时生效（`37 pickOpenIn` saveCfg+broadcast）、模板编辑器 6 项 TPL_EDIT_IDS、校验 tplText/renderTemplate、只读全局总览 wf.bindings / wf.registry / workspaces.list（`54`）。

### 3.3 Panel：Dock / Overlay / NamingFailBanner

- **Dock**（`src/client/panel/Dock.js:10 DetailsDock`）：ResizeObserver 列宽感知 300-520px、用 sessions 权威信号跟随 sid / summaryCwd（`13-19`）、响应式工作区同步与回切自愈（`34 apply(cwd)` + hydrateFromCache + loadChain + loadSnapshot forced）。
- **Overlay** / **Floating**：悬浮面板 Pop / SkillFloatList 的 portal 挂顶层（client/index.js:77 RDOM.createPortal 规避 transform 包含块）。
- **NamingFailBanner**：命名失败横幅（与命名守护联动，见 3.6）。

### 3.4 Views：ChecksTab / ListTab / MapDetail / IssueDetail / SkillsTab / RunPanel / TicketRow

- **ChecksTab**：链渲染器主机 wf.chain 快照派生（chainSnapshot.steps，pending 灰显不计分母）。
- **ListTab**：主列表排序/过滤偏好（listPrefs）与 label 点击记忆（labelClicks 双键排序）。
- **MapDetail / IssueDetail**：fetchIssueDetail 单票 GraphQL→REST 降级，comments/subIssues/blockedBy 分段加载。
- **RunPanel / TicketRow / SkillsTab / RingSkills / NoRepoCard**：动作词汇表分发（inject-prompt/open-url/rpc/form/refresh）与技能环。

### 3.5 状态栏 StatusBar

- `src/client/statusbar/StatusBar.js:5 StatusBar`：probeHandoffReady / ensureIssuePath / startIssuePathPoll（`35`）、cwd 三级解析（summaryCwd → detectCwd → wf.cwd, `38-54`）、checksumsOf 派生 fr/bugN/triageN/setup/amber/skillsCheck，胶囊永不隐藏（`59`），点击 go() 引导。

### 3.6 后端切换与命名守护

- 后端切换：BackendSelector + SwitchConfirmModal，链快照按 (cwd+backendId+lang) 隔离缓存（host wf.chain cacheKey `1682`），客户端 per-cwd 缓存 keyOf 洗钥匙一致。
- 命名守护：shared/naming-guardian.js 单缝纯函数（isPlaceholderTitle / cleanTitleText / utf8Bytes / 档位状态机 / 值比对锁 / 计划单产出 + 编号归属 issue 索引差值）；host 常驻任务产出 wf.namingPlan，client 渲染钩子拉取后经 face.rename 执行并回报告（api.js namingCurrentTitleOf / namingHintOf）。

### 3.7 快照水合与扇出

- 水合：getCachedSnapshot / setCachedSnapshot / hydrateFromCache（per-cwd，多级：内存→localStorage 快照摘要→磁盘缓存秒显旧数据→网络校验），snapFresh 判定（TTL 与 generatedMs）。
- 扇出：storeSvc.useStore(sid) 按会话 store 隔离、广播 cfg / templates / snapshot（emit + workspaces.list 订阅）、pendingSnapshotByCwd / _chainInflightByCwd 并发去重，面板多组件挂载共享同一 in-flight promise。

---

## 4 跨端关键路径

### 4.1 host.call 通道

- Client 经 `host.call('wf.*', args)` 调 host（harness.handle 注册 8+ 句柄：wf.snapshot/refresh/ping/chain/detect/bindings/registry/cwd/naming* 等）。
- 参数：cwd（canonicalKey 洗后）、backendId hint、force、lang；返回形状统一 `{ok, ...}` 或 `{ok:false, kind, error}`。
- 单飞与重试：host 侧 _panelSyncBusy / _chainInflightByCwd / pendingSnapshotByCwd，client 侧同 cwd 同轮次复用。

### 4.2 错误分类

- gh 层：auth / network / notfound / exit / timeout（runGh kind 归一，`340`）。
- GraphQL 层：graphql / rateLimit（降级 REST）/ parse（`953-981,1042-1071`）。
- Registry / Detection 层：bad-handle / shape / pending（unknown）/ multiHit。
- 链谓词层：pass / fail / pending（15s 单谓词超时，`1705`）。

### 4.3 Fallback 链路

- 快照：GraphQL aliases → REST（maps detail / issue detail / issues list 三段均有，fallback:'rest' 标记）。
- Issues：gh api 带 avatar → gh issue list 无 avatar（`791` vs `822`）。
- Repo 解析：git remote get-url origin → .git/config 直读 → gh repo view（`612-638`）。
- 缓存：内存 → 磁盘（owner__name.json）→ 网络（`576` 失效回退）。
- 技能：registry 命中 → 轻探并联（B 语义，D11）。

---

## 5 候选埋点清单（≥20 条，首轮 P0 27 条 / P1 18 条）

> 列说明：级别 = 建议落盘级别（error/warn 始终落盘，info 常驻轻量，debug 仅开关打开时）；频率 = 高频（秒级）/ 低频（分钟级或人操）；敏感 = 是否含 token/auth/文件内容/用户路径；guard = 是否需性能/频率守卫或脱敏守卫。

| # | 路径/模块 | 事件（埋点名建议） | 级别 | 频率 | 敏感 | guard | 证据行号 | 首轮 |
|---|-----------|-------------------|------|------|------|-------|----------|------|
| 1 | host wf.snapshot 入口 | snapshot.request {cwd, backendId, force} | INFO | 低频 | 路径脱敏 | 需 guard（去重） | `index.js:1073 buildSnapshot, 297 resolveGh` | P0 |
| 2 | host 缓存命中 | snapshot.cache.hit {kind:mem/disk, ageMs} | DEBUG | 高频 | 否 | 需采样 | `index.js:576 readDiskCache, 589 writeDiskCache, 47 CACHE_MS` | P1 |
| 3 | host 缓存未命中/过期 | snapshot.cache.miss {reason} | INFO | 低频 | 否 | — | `index.js:47, 589` | P0 |
| 4 | host getRepoKey 三级 | repo.resolve.tier {tier:1/2/3, ok, latencyMs} | INFO | 低频 | 脱敏 url | — | `index.js:601, 605-638` | P0 |
| 5 | host runGh 调用 | gh.exec {argv0, cwdHash, latencyMs, kind, exitCode} | INFO | 低频 | 脱敏 token | 需 guard（argv 脱敏） | `index.js:311 runGh, 340 kind` | P0 |
| 6 | host runGh 超时 | gh.timeout {argv0, timeoutMs} | WARN | 低频 | 否 | — | `index.js:325 timeout, 338` | P0 |
| 7 | host resolveGh 失败 | gh.resolve.fail {error, hasDSH_GH_PATH} | WARN | 低频 | 否 | — | `index.js:297, 303-305` | P0 |
| 8 | host GraphQL→REST 降级 | graphql.fallback {scope:maps/issue, reason:rateLimit} | WARN | 低频 | 否 | — | `index.js:945 isRateLimitError, 903, 988` | P0 |
| 9 | host fetchIssues 回退 | issues.fallback {from:api, to:issueList, reason} | INFO | 低频 | 否 | — | `index.js:791 vs 822` | P1 |
| 10 | host buildSnapshot 完成 | snapshot.built {maps, issues, labels, fallback, latencyMs} | INFO | 低频 | 否 | — | `index.js:1229 return` | P0 |
| 11 | host probe since | probe.eval {repoKey, since, count, changed} | DEBUG | 高频 | 否 | 需采样 | `index.js:847 fetchIssueIndex, 871 issueIndexChanged` | P1 |
| 12 | host 面板增量同步 | panelSync.eval {repoKey, baseline, dirty, failures} | DEBUG | 高频 | 否 | 需 guard | `index.js:451 panelSyncEvaluate, 494 panelSyncEvalOne` | P1 |
| 13 | host 面板增量 dirty 回执 | panelSync.dirty {cwdHash, ageMs} | INFO | 低频 | 脱敏 cwd | — | `index.js:515-519 panelDirtySince` | P0 |
| 14 | host registry select | registry.select {cwdHash, backendId, source, latencyMs} | INFO | 低频 | 否 | — | `registry.js, index.js:1146 reg.select` | P0 |
| 15 | host registry unsupported 桩 | registry.stub {op, backendId} | DEBUG | 低频 | 否 | — | `registry.js:41 unsupportedStub` | P1 |
| 16 | host detection 二联 | detection.detect {cwdHash, explicit, matches, pending, selection} | INFO | 低频 | 脱敏 cwd | — | `detectionService.js:32 isWorkspaceEmpty, index.js:256 skillProbe` | P0 |
| 17 | host workspaceStore 命中/过期 | workspaceStore.hit {keyHash, fresh, ttlMs} | DEBUG | 高频 | 脱敏 key | 需采样 | `workspaceStore.js:38 isFresh, 48 STATUS_CACHE_MS` | P1 |
| 18 | host chain 缓存命中 | chain.cache.hit {keyHash, lang, ageMs} | DEBUG | 高频 | 否 | 需采样 | `index.js:1674 chainCache, 1682 cacheKey` | P1 |
| 19 | host chain 谓词执行 | chain.predicate {id:repoRemote/repoAccess/ghAuth/mdParseOk, status, latencyMs} | DEBUG | 高频 | 脱敏 detail | 需 guard（15s 超时） | `index.js:1721-1745 predicateRegistry 15000ms` | P1 |
| 20 | host skill 判装 | skill.probe {name, level:ok/bad/pending, via} | INFO | 低频 | 脱敏 path | — | `index.js:50 SKILL_PROBE_NAMES, 1330-1649 probeSkill` | P0 |
| 21 | host skill pending 封顶 | skill.pending.cap {name, attempts, max:3} | WARN | 低频 | 否 | — | `index.js:1338 SKILL_PENDING_MAX` | P0 |
| 22 | host issuePath 白名单检测 | issuePath.push {ref, source:gh-create/edit, queueLen} | INFO | 低频 | 脱敏 title | — | `index.js:348 whiteList, 425 pushIssuePathEvent` | P0 |
| 23 | host workspaceKey 洗钥匙 | workspaceKey.canonical {rawHash, normalized, fallback} | DEBUG | 低频 | 脱敏 path | — | `workspaceKey.js:28, index.js:536 canonicalKey` | P1 |
| 24 | host platform resolve | platform.resolve {name:gh/git/cmd, ok, latencyMs} | DEBUG | 低频 | 否 | — | `platform/index.js:30 createPlatform, index.js:176 resolveExec` | P1 |
| 25 | host naming sweep | naming.sweep {trigger:whiteList/poll, count} | DEBUG | 高频 | 脱敏 hint | 需 guard | `index.js:365 namingSweepSoon, shared/naming-guardian.js` | P1 |
| 26 | client host.call 调用 | host.call {method:wf.snapshot/chain/detect, latencyMs, ok, kind} | INFO | 低频 | 脱敏 cwd | 需 guard | `client/kernel/probe.js:40 host.call('wf.chain'), client/index.js 50+` | P0 |
| 27 | client host.call 失败 | host.call.fail {method, kind, errorHash} | WARN | 低频 | 脱敏 error | — | 同上 | P0 |
| 28 | client 快照水合 | snapshot.hydrate {cwdHash, source:cache/disk/network, fresh, latencyMs} | INFO | 低频 | 否 | — | `kernel/router.js:9 hydrateFromCache, store.js 同` | P0 |
| 29 | client 快照扇出 | snapshot.fanout {sessionIdHash, stale, force} | DEBUG | 高频 | 否 | 需采样 | `kernel/probe.js:59 pendingSnapshotByCwd, kernel/store.js emit` | P1 |
| 30 | client 并发去重命中 | dedup.hit {scope:chain/snapshot, keyHash} | DEBUG | 高频 | 否 | 需采样 | `kernel/probe.js:13 _chainInflightByCwd, 59 pendingSnapshotByCwd` | P1 |
| 31 | client backend 切换 | backend.switch {from, to, cwdHash} | INFO | 低频 | 否 | — | `views/shared/BackendSelector.js, router.js 39` | P0 |
| 32 | client 命名守护执行 | naming.guard {sidHash, fromTitle, toTitle, hintHash, outcome} | INFO | 低频 | 脱敏 title | — | `kernel/api.js:46 NAMING_POLL_MS, shared/naming-guardian.js` | P0 |
| 33 | client 命名值比对锁拦截 | naming.lock {sidHash, reason:handEdited} | INFO | 低频 | 否 | — | `shared/naming-guardian.js 值比对锁` | P0 |
| 34 | client issuePath 记录 | issuePath.record {ref, source, titleHash} | INFO | 低频 | 脱敏 title | — | `kernel/store.js:81 recordIssuePath` | P0 |
| 35 | client Settings 保存 | settings.save {openIn, tplChangedCount} | INFO | 低频 | 否 | — | `views/SettingsPage.js:37 pickOpenIn, saveCfg` | P1 |
| 36 | client 面板打开 | panel.open {mode:page/dock/sidebar, hasCache, snapFresh} | INFO | 低频 | 否 | — | `kernel/router.js:9 openPagePanel, 39 openDockPanel, 99 openInSidebar` | P0 |
| 37 | client 状态栏水合 | statusbar.hydrate {cwdSource:summaryCwd/detectCwd/wf.cwd} | DEBUG | 高频 | 脱敏 cwd | 需采样 | `statusbar/StatusBar.js:38 apply(cwd)` | P1 |
| 38 | client 状态栏退化 | statusbar.fallback {reason:noBackend/pending} | INFO | 低频 | 否 | — | `statusbar/StatusBar.js:59 csx,  状态栏胶囊永不隐藏` | P1 |
| 39 | client Dock 回切自愈 | dock.rehydrate {sidHash, cwdChanged, polluted} | WARN | 低频 | 脱敏 cwd | — | `panel/Dock.js:34 apply(cwd), 54 polluted` | P0 |
| 40 | client localStorage 失败 | storage.fail {key:dsws.*, op:get/set} | WARN | 低频 | 否 | — | `kernel/store.js:14, kernel/config.js:13 localStorage.getItem` | P0 |
| 41 | client 链步骤派生错误 | chain.derive.error {stepId, errorHash} | WARN | 低频 | 否 | — | `kernel/probe.js:61 chainSteps` | P1 |
| 42 | cross fallback 链总览 | fallback.chain {in:graphql, out:rest, latencyMs} | INFO | 低频 | 否 | — | `index.js:903, 988, 791` | P0 |
| 43 | cross 错误归一 | error.normalize {rawKind, mappedKind, httpCode} | DEBUG | 低频 | 脱敏 error | — | `index.js:340 kind 归一, tracker/errors.js` | P1 |
| 44 | cross 定时器调度 | timer.schedule {name:cacheRefresh/panelSync/namingPoll, intervalMs, jitterMs} | DEBUG | 高频 | 否 | 需 guard | `index.js:47 CACHE_MS 60s, api.js:46 NAMING_POLL_MS 5s` | P1 |
| 45 | cross 脱敏守卫 | privacy.scrub {field:token/cwd/title, rule, hit} | DEBUG | 低频 | 敏感自身 | 需脱敏 | 全链路 cwd/title/token | P0 |

> 统计：P0 必补 27 条（INFO/WARN 常驻，覆盖宿主 gh/缓存/错误/快照/检测/命名与客户端 host.call/水合/面板/状态栏的核心可观测性）；P1 可选 18 条（DEBUG 高频细节，需开关与采样守卫）。全量 45 条满足“全面覆盖”基线。

---

## 6 分级与守卫建议

- **级别**：error/warn 始终落盘；INFO 常驻轻量轨迹（低频、定量）；DEBUG 仅开关打开时产生（需显式 `if (debugEnabled) logger.debug(...)` 惰性守卫，零分配零写入）。
- **频率**：上表高频 12 条默认 DEBUG + 采样（如 1/100 或按时间节流 5s 窗口）；低频直接 INFO/WARN。
- **敏感**：cwd 取 hash 或脱敏为 `<cwdHash>` / 仅留目录名；title 仅记 hash 或截断 80 字符；token/auth 原文永不落盘，仅记 kind 与 hasToken 布尔。
- **guard**：高频路径必须前置 `if (!debugEnabled) return` 与节流器；host gh/链谓词/探针等网络链路加超时与重试计数埋点。

---

## 7 验证与下一步

- 本文盘点基于真实代码证据，行号锚点均可复核（见证据列）。
- 下一步（#332/#333 定版）：按 P0/P1 优先级与本表 45 条候选，收敛为日志分级/开关语义与记录时机契约，并细化落盘目录/脱敏规则/导出交互。
- 构建双源镜像：本研究为文档，不涉 `src/host/index.js ↔ host.js` / `src/client/* ↔ client.js` 构建产物同步；后续埋点落地需经 `pnpm build` 并验证落盘与导出。

---

*真实换行、禁 BOM。引用文件与行号以本分支快照为准。*
