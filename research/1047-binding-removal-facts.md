# #1047 · 「取消注册表里那份进程内绑定副本」影响面事实清单

只报事实与影响面，不含方案与决策。每条给来源 `文件:行`；查不到的一律写「没查到」，不猜。

对象：`src/tracker/registry/registryCore.ts` 里的 `byHandle`（内存 Map）。下文「内存绑定 / 进程内副本」都指它。

> **同一轮核查还改了四处票面口径**（票面已更正，这里留摘要供对照）：① `tests/verify-1003-single-outlet.js` 的基准桩在 `:56`，**拒绝**那一半在 `:116`（canWrite）／`:119`（工具壳）／`:123`（改色），`:127-131` 是「补上人的绑定后放行」的对照；② 「写失败被吞」应改说成「顶层 `ok` 恒真（`src/host/workspaceCwd.js:75`）＋ 两种「跳过」无声（`:174` 后端未注册、`:175` 注册表问不到）」；③ 「明确没有后端」这条逃生舱今天没有活调用者，且空 id 走写文件那条路会被直接跳过（`src/host/workspaceCwd.js:171` 回 `skipped: 'explicit-none'`），重启后落回自动识别；④ Markdown 房扫目录的候选数是「1 + `.scratch` 下所有非点开头条目（含普通文件）」= 1916 条（2026-10-14 本机实测：198 个子目录 + 1718 个文件），不是 199。

---

## 一、谁在读、谁在写这份内存绑定

**定义与唯一写口**

- `byHandle` 的定义：`const byHandle = new Map() // handleKey -> {backendId: string|null, handle}`（`src/tracker/registry/registryCore.ts:54`；键的算法是 `handle.cwd || handle.refId`，`src/tracker/registry/registryShape.ts:56`）。
- 唯一写入点：`bind(handle, backendId)` 里的 `byHandle.set(k, { backendId, handle })`（`src/tracker/registry/registryCore.ts:184`），随后 `emit('bind', { handle, backendId })`（`src/tracker/registry/registryCore.ts:185`）。
- `bind` 的拒绝规则：`backendId !== null && !byId.has(backendId)` 时抛 `TrackerRegistryError('unknown-backend')`（`src/tracker/registry/registryCore.ts:181-183`）——即**只允许「已注册的 id」或 `null`**。
- 另一个删除点：`unregister(id)` 把指向该 id 的记录从 `byHandle` 删掉（`src/tracker/registry/registryCore.ts:72-78`），广播 `unregister`（`:79`），并对每个受影响句柄广播 `bind`，载荷 `{ handle, backendId: null, stale: true }`（`src/tracker/registry/registryCore.ts:80`）——注意这条 `bind` 事件是**回退通知**，不是写 `byHandle`。
- `select()` 不写 `byHandle`，只读（`src/tracker/registry/registryCore.ts:141-146`）。
- 注释口径：`bind` 的文档注释写「显式绑定（backendId=null = 显式无后端，逃生舱）；'other' 等未注册 id 拒绝」（`src/tracker/registry/registryCore.ts:178`）；`byHandle` 存的是真实 handle，理由是 stale 通知要带真句柄（`src/tracker/registry/registryCore.ts:184`）。

**读点一：选择函数的第一级**

- `select` 的① `if (byHandle.has(k))`（`src/tracker/registry/registryCore.ts:141`）：
  - `id === null` → 回 `{ backendId: null, source: 'explicit' }`（`:143`，注释：ref 省略，无后端不造假）；
  - `byId.has(id)` → 回 `{ backendId: id, source: 'explicit', ref: describe(...) }`（`:144`）；
  - 指向已卸载后端 → 落到② matches（`:145`）。

**读点二：三态查询 `bound()`**

- `bound(handle)`：`undefined` = 从未绑过；`null` = 显式无后端；字符串 = 已绑定（`src/tracker/registry/registryCore.ts:188-192`）。

**读点三：`allBindings()` 列表**

- `allBindings()` 把 `byHandle` 整个摊平成 `{ handleKey, cwd, backendId, handle }` 数组（`src/tracker/registry/registryCore.ts:119-121`）。

**读点四：显式探测器首读内存绑定**

- `detectExplicit` 第一件事就是 `registry.bound(handle)`（`src/tracker/detection/explicitDetector.ts:28`）：
  - `boundId === null` → 直接回 `selection: { backendId: null, source: 'explicit' }`，`parsed.reason: 'memory-none'`，**不读任何文件**（`src/tracker/detection/explicitDetector.ts:29`）；
  - 非空字符串且已注册 → 回 `{ backendId, source: 'explicit', ref }`，`reason: 'memory-bound'`（`src/tracker/detection/explicitDetector.ts:30-33`）。
  - 该文件顶部写明「唯一显式写路径 = `wf.bind(handle, backendId|null) → registry.bind`」（`src/tracker/detection/explicitDetector.ts:5`），且「不写 byHandle，避免文件监听竞态」（`:7`）。

**读点五：统一判定出口**

- `decideBackend` 在读完目录后先问 `registry.bound(handle)`（`src/tracker/detection/backendDecision.ts:189-194`），命中非空字符串且已注册 → `{ source: 'explicit', origin: 'user-memory-bind', canWrite: true }`（`src/tracker/detection/backendDecision.ts:195-197`）。
- **`null` 在这里被明确排除**：条件写了 `boundId !== undefined && boundId !== null && boundId !== ''`（`src/tracker/detection/backendDecision.ts:195`）；纯核同款排除（`src/tracker/detection/backendDecision.ts:81`）。
- 出口注释把四层归两类并点名第 1 层是「本次进程内那份副本（origin 记成 `user-memory-bind`）」（`src/tracker/detection/backendDecision.ts:163-181`）。

**全仓调用点（src 下，直调注册表对象）**

- `src/host/workspaceCwd.js:56` — `reg.bind(handle, backendId === undefined ? null : backendId)`：**唯一生产写入口**。
- `src/host/workspaceCwd.js:111` — `reg.allBindings()`：`wf.bindings` 的数据源。
- `src/host/workspaceCwd.js:134` — `reg.bound({ cwd })`：`wf.registry` 回包里的 `bound`。
- `src/host/refresh/wiring.js:335` — `handleFor`：遍历 `registry.allBindings()`，按 cwd 找回**真 handle** 交给 deck 工具壳；找不到就退 `{ cwd: want }`。这是除 workspaceCwd 外唯一的 `allBindings` 调用点。
- `src/host/platformChannel.js:190` — `reg.on('bind', (evt) => { if (evt && evt.stale) _workspaceStore.onRegistryBindStale(evt.handle) })`：内存绑定失效驱动探测缓存失效。
- `src/tracker/detection/explicitDetector.ts:28`、`src/tracker/detection/backendDecision.ts:191` — 见上。
- 契约声明处（类型注释，非调用）：`src/tracker/registry/registryCore.ts:40-49`。
- **`src/deck/` 与 `src/client/` 全仓没有直接调用**：客户端只能经 `wf.*` 电话拿；deck 侧只经 `handleFor` 间接依赖 `allBindings`（上面那条）。
- 相邻但不同的一条读口（容易混淆，先记下）：`src/host/refresh/wiring.js:339` 的 `readChoice` 读的是**宿主侧选择记忆 H**（`choiceStore`），不是本问题的 `byHandle`。

---

## 二、哪些宿主电话与界面在读它

**四条电话**

- `wf.bind` → `handleBind`（`src/host/workspaceCwd.js:46-82`）：`:56` 写内存绑定（唯一写点）；`:58-59` 清快照缓存与探测缓存；`:75` 回包 `{ ok, cwd, backendId, labelColorsFile, workspaceFile, rev, persisted }`。
- `wf.bindings` → `handleBindings`（`src/host/workspaceCwd.js:107-121`）：数据完全来自 `allBindings()`（`:111`），每行 `source` 硬编码为 `'explicit'`（`:117`）。
- `wf.registry` → `handleRegistry`（`src/host/workspaceCwd.js:122-137`）：`:131` 空 cwd 时回 `{ ok: true, modules, bound: undefined }`；`:134` 有 cwd 时 `bound = reg.bound({ cwd })`，`:135` 放进回包。`:127-129` 的注释说明入参必须先洗成与绑定同一把钥匙（#652）。
- `wf.selection` → `handleSelection`（`src/host/workspaceCwd.js:138-153`）：**直接调 `reg.select`**（`:148`，caller `'wf.selection'`），**不经过** `decideBackend` / `detectionService`；`:141` 空 cwd 回 `{ backendId: null, source: 'unknown', origin: 'unknown-workspace', canWrite: false, reason: 'workspace-not-ready' }`；回包 `{ ok, selection, repository }`（`:151`）。

**客户端谁在调、拿到值干什么**

- `wf.bindings`：
  - `src/client/views/SettingsWorkspaces.js:24` 取列表 → 与 `workspaces.list` 合并成 `all`（`:36`）→ `isBound` 分成已绑定/未绑定两组（`:102-107`）→ 表头显示「已绑定 N」（`:114`）→ 每行有后端就显示后端名、否则显示 `cfg.wsUnbound`「未绑定」（`:121`）。
  - `src/client/views/SettingsPage.js:159`、`:190` — 注释写明设置页只读总览（`wf.bindings` + `workspaces.list` + `wf.registry` 色值，不调 `wf.bind`）。
- `wf.registry`：
  - 调用点：`src/client/panel/Dock.js:70`、`:268`；`src/client/statusbar/StatusBackend.js:190`；`src/client/panel/OverlayGate.js:18`；`src/client/kernel/probe-select.js:176`；`src/client/views/SettingsWorkspaces.js:25`。
  - 它们**只取回包的 `modules`**（`:modules`），并过滤掉 id 为 `other` 的项（例如 `src/client/panel/Dock.js:70` 的 `filter(x=>String(x.id).toLowerCase()!=='other')`、`src/client/panel/OverlayGate.js:25-26`、`src/client/statusbar/StatusBackend.js:190`）。
  - **回包里的 `bound` 在 `src/client` 下没查到任何消费点**（全仓 grep `.bound` / `bound` 只命中局部变量与无关词）。
- `wf.selection`：
  - `src/client/kernel/probe-select.js:45-70` `askSelectionOnce`：进工作区补问一次——`:48` 手上有后端就不问；`:49` cwd 不认识不问；`:52` 每个工作区只问一次（`st._selAskedKey`）；`:56` 置 `st.selPending = true`（状态栏据此不说「还没有设置」，见该文件 `:54-55` 与 `src/client/statusbar/StatusBar.js` 的 `_selReading`）；`:62` 发电话；`:69-70` 取回包 `selection`。文件头 `:36-44` 写明「宿主那边这条电话本来就有，只是界面进工作区时一条都不用——全仓原先只有设置页在调」。
  - `src/client/views/SettingsWorkspaces.js:38`：对 `all`（workspaces.list + bindings + 当前 cwd 去重）里的**每个 cwd 顺序 await `wf.selection`**，结果存 `selections[cwd]`。
  - 合并口：`src/client/kernel/store-snapshot.js:252-271` `mergeSelection`——`:255` 无 `backendId` 时：`:257` `source === 'explicit'` 直接覆盖当前值；`:263` `fallback` 的 null 且当前有值则**不覆盖**。
  - 迟到回包落地：`src/client/kernel/probe-select.js:168` 判 `isSuspicious = nxt.backendId===null && !nxt.pending && nxt.source==='fallback' && cur && cur.backendId`（即只拦 `fallback` 的 null，`explicit` 的 null 照收）；`src/client/kernel/store-snapshot.js:281` 同款判据。
- 面板「切换后端」按钮靠哪个值：`src/client/panel/Dock.js:229` —— `_isOther` 时返回 `null`（不渲染按钮）；`_sel.backendId` 为 `null`/`undefined` 时也不渲染；`pending` 时置灰（`aria-disabled`）。标签里的来源档位另有 `src/client/views/shared/BackendSelector.js:45-46`（`explicit` → 「显式绑定」、`matches` → 「自动匹配」、其它 → 「回退」）。
- 面板「Other / 无后端卡」靠哪个值：
  - `src/client/panel/Dock.js:66-68`：`_isOtherRaw = !!(sel && sel.backendId===null && !sel.pending)`，再叠加 `s.cwd && s.snapMode==='real' && s.snapshot` 才成立；`:68` 用它开整屏卡（`_showBackendFullscreen`）；`:281` 隐藏标签栏；`:296` 渲染卡体。
  - `src/client/views/NoRepoCard.js:26-29`：注释「#155：Selection 三态优先于 checkRepo（显式无后端/pending 态不走 NoRepo 红卡分支）」；`:29` `isOther = !!(sel && sel.backendId===null && !sel.pending)`；`:46` 起渲染 Other 卡（区别于 `:31` 的 pending 卡）。
  - `src/client/statusbar/StatusBar.js:105-111`：`_isOtherSBGateRaw`（同款判据）成立时点面板分段跳到设置页；`:183` 用它决定门控态。
  - 横幅变体也吃这条值：门禁里用 `{ backendId: null, source: 'explicit' }` 直接喂横幅（`tests/verify-subdir-first-frame.js:253`）。
  - 三者都**不区分 source**（只看 `backendId === null && !pending`）。
- 状态栏自己不打这条电话：`src/client/statusbar/StatusBar.js:107` 用 `s.selection || (s.snapshot && s.snapshot.selection)`；`:88`、`:100` 走 `loadSnapshot` / `loadChain`。
- 写回本地缓存/乐观态的位置（都造 `source: 'explicit'`）：`src/client/kernel/store-prefs.js:256-257`（`userPickSelection`）、`src/client/kernel/store-switch.js:156`、`src/client/statusbar/StatusBackend.js:201`、`src/client/panel/Dock.js:70`（`_confirmGate` 内）、`src/client/panel/OverlayGate.js:44`。

---

## 三、「显式无后端」这条逃生舱

**生产侧：今天谁会把 null 写进去**

- `src/host/workspaceCwd.js:50` 把入参洗成 `backendId`（`args.backendId ?? args.backend`），`:56` 在**入参根本没有 backendId 键**时写 `null`；`:55` 注释「null = 显式无后端（Other 逃生舱）；'other' 已弃用按 registry 拒绝」。
- **界面侧没有生产者**：`src/client/kernel/store-switch.js:278-282` 的注释记「「清除后端选择」（显式无后端 `wf.bind(null)`）2026-09-21 随 ADR 20260921 退役……本函数连同调用它的那颗按钮一起删除」。
- 三个写入口（门控窗、切换弹窗、状态栏门控）传的都是具体 id 字符串（`src/client/panel/Dock.js:70`、`src/client/panel/OverlayGate.js:50`、`src/client/statusbar/StatusBackend.js:201`）。**没查到任何界面会给 `wf.bind` 传 `null`**。
- 测试里有一处直接调 `r.bind(handle, null)`（`tests/tracker-contract/sections/registry.js:216`）。

**消费侧：谁把 null 当「明确表示没有后端」用**

- 认它的：
  - `select` ① 直接回 `{ backendId: null, source: 'explicit' }`（`src/tracker/registry/registryCore.ts:143`）；
  - `detectExplicit` 直接回 `source: 'explicit'` 的选择并标 `reason: 'memory-none'`（`src/tracker/detection/explicitDetector.ts:29`）；
  - `detectionService`：`explicitRes.selection` 先落到 `selection`（`src/tracker/detection/detectionService.ts:187`），出口回包只有在「有 backendId」时才覆盖它（`:209-211`），或只在 `selection` 为空时才用出口的 null（`:212-215`）——即显式 null **会原样传出去**；
  - 客户端把它当「真相」：`src/client/kernel/store-snapshot.js:257`（`explicit` 的 null 覆盖当前值，与 `:263` 的 fallback null 区别对待）；
  - 界面把它当「已决无后端」：`src/client/views/NoRepoCard.js:29`、`src/client/panel/Dock.js:66`、`src/client/statusbar/StatusBar.js:108`。
- **不认它的**（明确排除 null）：
  - `src/tracker/detection/backendDecision.ts:195`（`boundId !== null` 才算人选，否则继续读文件）；
  - `src/tracker/detection/backendDecision.ts:81`（纯核同款）。
  - 后果（事实陈述）：同一条 null 内存绑定，经 `wf.selection`（直调 `select`）会显示成「显式无后端」，经统一判定出口（`decideBackend`）则被当成「没有内存绑定」，继续往工作区文件、声明文件、自动识别走。
- `'other'` 这条旧串：注册侧当场拒绝并指名用 `backendId: null`（`src/tracker/registry/registryShape.ts:102-103`，另见 `:9`、`:16`）；契约与词汇表也记「保留串已弃用」（`src/tracker/contract/vocabulary.ts:17`、`src/tracker/contract/index.ts:109`、`src/tracker/contract/identity.ts:28-33`、`src/tracker/contract/backend-module.ts:17`、`:149`）；宿主两条旧守卫里仍写着 `!== 'other'`（`src/host/handoffClaim.js:129`、`src/host/sessionLifecycle.js:173`）。

---

## 四、工作区文件能不能表达「明确无后端」

**真源：`src/shared/config-store/src/workspace.ts`**

- 认识版本 2（`WORKSPACE_KNOWN_VERSION = 2`，`src/shared/config-store/src/workspace.ts:24`）；允许的来源 `SOURCES_V2 = ['user','migrated','detected']`、`SOURCES_V1 = [... ,'auto']`、版式 `['single','multi']`、已知键 `['version','backendId','pickedAt','source','layout']`（`src/shared/config-store/src/workspace.ts:41-44`）。
- 未知键直接判坏：`fail('unknown-keys', '工作区配置文件里有多出来的名字，核不认识它们：…')`（`src/shared/config-store/src/workspace.ts:128-131`）——**加不了自定义字段来表达「无后端」**。
- `version` 必须是整数（`:132`）；`version > 2` → `ok: true, readonly: true`（可读不可写，`:134-141`）；`version` 只认 1 与 2（`:142`）。
- **`backendId` 不允许空**：`if (typeof doc['backendId'] !== 'string' || doc['backendId'].trim() === '') return fail('bad-shape', '工作区配置文件里的 backendId 必须是一段非空文字（…）')`（`src/shared/config-store/src/workspace.ts:143-145`）。
- `pickedAt` 必须是非负整数（`:146-148`）；`source` 必须在允许集合内，否则按版本给两条不同文案（`:149-157`）；`layout` 可选，但一旦出现必须是 `single`/`multi`（`:160-162`）；归一化后返回 `{ version, backendId: trim(), pickedAt, source, layout? }`（`:163-170`）。
- 写出侧一律版本 2、拒绝高版本（`src/shared/config-store/src/workspace.ts:173-179` 起）。
- 派生件 `src/shared/config-store/workspace.js` 是构建产物：`// AUTO-GENERATED by node scripts/build.mjs — DO NOT EDIT. Source: src/shared/config-store/src/workspace.ts`（`src/shared/config-store/workspace.js:1`），常量同源（`:3-5`）。

**纯侧编解码：`src/deck/rules/workspace-file.ts`**

- 协议版本自述 `WORKSPACE_FILE_PROTOCOL_VERSION = 2`（`src/deck/rules/workspace-file.ts:80`）；`auto` 只在读老文件时认（`:83`）。
- `parseWorkspaceFile`：编解码器抛错 / `ok !== true` / `readonly === true` → 一律 `null`（`:110-115`）；`backendId` 非字符串或 trim 后为空 → `null`（`:117-118`）；`pickedAt` 非有限数 → `null`（`:119`）；通过才出 `{ backendId, pickedAt, source, layout? }`（`:120-122`）。
- `stringifyWorkspaceFile`：版本收口、`pickedAt` 缺省 0、`source` 缺省取调用方给的默认；写不出直接抛错（`:132-149`）。
- 宿主侧门面：`src/deck/shell/workspace-anchor.ts:34-39`（路径与版本/来源常量：`WORKSPACE_FILE_REL = WORKSPACE_YAML_REL`、`WORKSPACE_FILE_SOURCE = 'user'`），`:46-49` 把核的编解码器接给纯侧，`:58-70` 转发两个翻译函数。`explicitDetector` 引的正是这个门面（`src/tracker/detection/explicitDetector.ts:14`）。

**结论（能不能表达「明确无后端」）**

- 不能。文件侧的字段校验只承认「非空 backendId + 允许的 source + 非负 pickedAt」，**没有空值通道，也没有哨兵值**；`backendId` 为空/缺键一律判坏形状（`src/shared/config-store/src/workspace.ts:143-145`），纯侧读到坏形状或只读只回 `null`（`src/deck/rules/workspace-file.ts:115-118`）。
- 「文件不存在 / 读不出」在两边都与「没有这一层」同义（`src/deck/rules/workspace-file.ts:101-106`、`src/tracker/detection/backendDecision.ts:113-116`），所以文件侧**无法区分「没有记录」与「记录说没有后端」**。
- 第三种表达方式（后端名写 `none` / `other`）：**没查到**。`'other'` 在注册侧被明确拒绝（`src/tracker/registry/registryShape.ts:102-103`）；`'none'` 在本仓只作为其它语义的取值出现（例如 `confidence: 'none'`，`src/tracker/detection/parseIssueTracker.ts:24`、`:56`），与后端名无关。
- 一处文案与代码的措辞差异（记录事实，不作解释）：`src/tracker/detection/explicitDetector.ts:25` 的注释写「空串是显式无后端逃生舱」，而代码判的是 `boundId === null`（`:29`），写入口传的也是 `null`（`src/host/workspaceCwd.js:56`）。

---

## 五、写文件失败时今天会怎样

**分支清单（`writeWorkspaceFileOnFirstBind`，`src/host/workspaceCwd.js:165-214`）**

- 跳过（`ok: true`，算正常不做）：
  - 入参是空 / 非字符串 / trim 后为空 → `{ ok: true, skipped: 'explicit-none' }`（`src/host/workspaceCwd.js:171`）；注释口径「只记人选：入参是空（显式无后端逃生舱）不写」（`:162`）。
  - 后端没注册 → `{ ok: true, skipped: 'unregistered' }`（`:174`）；注册表拿不到 → `{ ok: true, skipped: 'registry-unavailable' }`（`:175`）。
- 失败（`ok: false`）：
  - 拿不到可用的文件通道（`fs.resolve/readText/writeText` 缺一）→ `{ ok: false, error: { kind: 'env', message: '首选后端已记下，但工作区配置文件没能存进工作区（这次没拿到可用的文件通道）。绑定与本机记忆不受影响，仍按这次选定的后端走。' } }`；同时记 `host.call.fail`，`errorHash: hash8('no-fs')`（`src/host/workspaceCwd.js:181-183`）。
  - 写过程抛错（先重试一次，重试前再建一次父目录）→ `{ ok: false, error: { kind: 'env', reason: fileWriteReasonOf(eW), message: '首选后端已记下，但工作区配置文件没能存进工作区（' + msg 前 120 字 + '）。绑定与本机记忆不受影响，仍按这次选定的后端走。' } }`；记 `host.call.fail`，`errorHash: hash8(msgOf(eW))`（`src/host/workspaceCwd.js:205-206`、`:211-213`）。
  - `reason` 四档由 `fileWriteReasonOf` 分：`no-permit`（EACCES/EPERM/permission/denied/permit/沙箱）、`readonly`（EROFS/read-only/readonly）、`no-dir`（ENOENT/not found/不存在）、`other`（`src/host/workspaceCwd.js:10`）。
- 写成功的日志与缓存动作：记 `host.call`（`method` 按来源分 `wf.bind.workspaceFile` / `wf.bind.migrate`，`src/host/workspaceCwd.js:166-167`、`:207`），失效探测缓存与宿主快照缓存（`:208-209`），回 `{ ok: true, placed: true, reason: existed ? 'overwritten' : 'created' }`（`:210`）。
- 来源标记：人当场点 → `source: 'user'`；迁移 → `'migrated'`（`:169-170`）。

**`handleBind` 失败后的回包长什么样**

- 写文件失败**不会**让 `wf.bind` 回 `ok: false`：`out` 永远带 `ok: true`，把 `workspaceFile` 原样挂在回包上（`src/host/workspaceCwd.js:75`）；`persisted` 只取决于宿主侧记忆 `wr.ok`（同处）。
- 回 `ok: false` 的只有三种：空 cwd → `{ ok: false, error: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }`（`:48`）；注册表不可用 → `{ ok: false, error: 'registry unavailable' }`（`:53`）；异常 → `unknown-backend` 带 `kind`（`:77-80`）或 `{ ok: false, error: msg }`（`:80`）。

**界面拿到失败后怎么显示**

- 回包里的 `workspaceFile` 被记进会话状态：`adoptBoundRev`（`src/client/kernel/store-prefs.js:262-265`，`st.workspaceFileResult`）；调用点 `src/client/panel/OverlayGate.js:53`、`src/client/panel/Dock.js:70`、`src/client/statusbar/StatusBackend.js:201`、`src/client/kernel/store-switch.js:180`。
- 翻成人话：`workspaceFileNoteOf`（`src/client/kernel/store-prefs.js:271-282`）——`ok !== true` 且有 error 时回「这次没能把选择写进工作区里的配置文件（绑定照旧有效，下次再选一次可以重试）。」（`:275`）；`skipped` 有值回空串不打扰（`:278`）；`reason === 'overwritten'` → 「已把这次选择写进工作区里的配置文件（覆盖了原来那一条）。」（`:279`）；否则「已把这次选择写进工作区里的配置文件。」（`:280`）；形状对不上又没带失败原因 → 回空串（`:274-276`）。
- 显示位置：状态栏那行小灰字 `workspaceFileNoteEl`（`src/client/kernel/store-prefs.js:284-290`），挂在 `src/client/statusbar/StatusBar.js:300`、`:336`。
- 另一条独立提示（宿主侧记忆没写成）：`persisted === false` 时 flash `tr('switch.bindFail')` 配 `tr('switch.bindNotPersisted')`（`src/client/statusbar/StatusBackend.js:201`）；`ok` 为假时切回旧选择并 flash `switch.bindFail`（`src/client/panel/Dock.js:71`，文本取 `res.error || res.message` 前 120 字）。

**「内存绑定仍生效」这句话在代码里的依据**

- 顺序：`reg.bind(...)` 在 `src/host/workspaceCwd.js:56`，写文件在 `:74`；写文件失败分支只回错误对象，不动 `byHandle`（`:211-213`），也不撤销 `:56` 那一步。
- 文案两次明说：`src/host/workspaceCwd.js:183`、`:213`（「绑定与本机记忆不受影响，仍按这次选定的后端走」）；`:162` 注释「失败不回滚绑定与 H，但如实放进回包」。
- 判定侧不看文件也能答：`detectExplicit` 首读内存绑定即返回（`src/tracker/detection/explicitDetector.ts:28-33`），`decideBackend` 同理（`src/tracker/detection/backendDecision.ts:191-197`），`wf.selection` 更是直调 `reg.select`（`src/host/workspaceCwd.js:148`）。
- 迁移那条路另有独立守卫：`migrateChoiceToFile` 每工作区每进程只试一次（`const migratedAttempted = new Set()`，`src/host/workspaceCwd.js:221`；`:225` 命中即 `skipped: 'already-tried'`；`:224` 空 cwd 回 `'empty-cwd'`），它在 `wf.selection` 里后台捎带、不挡回包（`src/host/workspaceCwd.js:143-144`）。

---

## 六、读盘成本与调用频次

**探测服务的缓存与失效**

- `workspaceFileMs(cwd, platform)`：依次 `resolve` + `stat` 新 yaml、老 json，取 `mtimeMs`（取不到回 `null`），只读时间不读内容（`src/tracker/detection/detectionService.ts:99-115`）。
- 缓存命中判定：`if (!force && store)`（`:152`）→ `store.get(handle)`（`:153`）→ `pending` 不命中（`:154`）→ env 失败不缓存（`:156-157`）→ 有 `backendId` 时查 `isWorkspaceEmpty`（`:160-162`）→ `cached.fileMs !== nowMs` 判过期（`:169-174`）→ 过期 `store.invalidate`（`:176`）否则**直接 return 缓存**（`:178`）。
- 即：**命中一次缓存仍要花 1 次 `stat`（yaml）**，yaml 不存在时再试 1 次 json；未命中则要走完整判定链。
- 每次都读声明文件：`detectExplicit` 在缓存之后无条件再跑一次（`src/tracker/detection/detectionService.ts:184-188`），它的第二层就是读 `docs/agents/workspace.yaml`（`src/tracker/detection/explicitDetector.ts:43-51`），第三层读 `docs/agents/issue-tracker.md`（`:53-59`）。
- 写缓存时再取一次 mtime：`result.fileMs = await workspaceFileMs(...)` 然后 `store.set`（`src/tracker/detection/detectionService.ts:272-276`）。

**`select` 的①命中省掉什么**

- ① 命中直接 return（`src/tracker/registry/registryCore.ts:141-146`，`null` 走 `:143`、字符串走 `:144`），其后的②完全跳过：`AbortController`（`:148`）、`byId` 全体 `Promise.all`（`:152-156`，每路可能是读 `.git/config` 或起外部命令）、`withTimeout(..., matchesTimeout, ...)`（`:153`，缺省 3000ms，`:52`）、pending 收集（`:158`）、`describe` 出 ref（`:164`）、fallback 与 `pending` 语义（`:169-175`）。
- ② 的每一路都是「调用方交给注册表的模块自己的 matches」，注册表本身不做 IO，但超时与中止信号由它管（`:152-156`、`:14-31` 的 `withTimeout`）。

**高频热路径（事实与频次）**

- 进工作区首帧：`askSelectionOnce` 每个工作区**每进程一次**（`src/client/kernel/probe-select.js:52`），首帧就走（同文件 `:11-14` 的设计说明）；它打的是 `wf.selection`（`:58`、`:62`）。
- 设置页：打开一次就对「workspaces.list ∪ bindings ∪ 当前 cwd」去重后的**每个 cwd 顺序 await 一次 `wf.selection`**（`src/client/views/SettingsWorkspaces.js:36-38`）。
- 状态栏：自身不打 `wf.selection`，每次渲染读 `s.selection || s.snapshot.selection`（`src/client/statusbar/StatusBar.js:107`），数据来自快照/链（`:88`、`:100`）。
- 定时轮询：本仓 `src/` 下 **grep 不到 `statusbar-poll`、`checks-poll` 这两个名字**（`research/489-appendix.md` 的附录里把它们列为定时器名）。这一层没查到，不代表没有定时器。
- 面板刷新/重试会重打 `wf.detect`（force）与快照：例如 `src/client/panel/Dock.js:268`、`src/client/views/NoRepoCard.js:91`、`src/client/kernel/slotRenderer-repo-sync.js:57`、`:70`、`src/client/statusbar/bannerChain.js:165`、`:217`。
- 改用「只读文件」后的固定成本（事实陈列，不含判断）：每次判定至少多出 `resolve + readText(WORKSPACE_FILE_REL)`（`src/tracker/detection/backendDecision.ts:100-117`，或经 `explicitDetector` 的 `:43-51`），以及 `workspaceFileMs` 的那次 `stat`（`src/tracker/detection/detectionService.ts:99-115`、`:275`）；这些在内存绑定命中的今天，`explicitDetector` 已在 `:28-30` 提前返回、不再读 yaml 与声明文件。

---

## 七、依赖内存绑定的测试与门禁

**直接断言「内存绑定」语义的**

| 文件:行 | 断言什么 |
| --- | --- |
| `tests/tracker-contract/sections/registry.js:212-220` | `bound()` 三态：未绑 = `undefined`（`:215`）、`bind(handle, null)` 后 = `null`（`:216-217`）、`bind(handle, 'bnd')` 后 = `'bnd'`（`:218-219`）；断言名「bound() 三态（undefined/null/id）」 |
| `tests/tracker-contract/sections/registry.js:147-153` | 「explicit: bind → select 命中且出 ref」：`bind(handle,'hitA')`（`:150`）后 `select` 回 `backendId==='hitA' && source==='explicit' && ref.backend==='hitA' && multiHit===undefined`（`:152`） |
| `tests/tracker-contract/sections/registry.js:154-159` | 「explicit null: 无后端（ref 省略）」：`bind(handle, null)`（`:156`）后 `select` 回 `backendId===null && source==='explicit' && !('ref' in sel)`（`:158`） |
| `tests/tracker-contract/sections/registry.js:208-211` | 绑未注册后端抛 `unknown-backend` |
| `tests/tracker-contract/sections/registry.js:226` | `MIGRATE_KEY.other === null`（旧串迁移表） |
| `tests/verify-detection-cascade.js:118-124` | `reg.bind(h,'github')` 后 `select` 首判 `explicit`（`:122`）；`:124` 那条断言恒真（`… ? false : true || true`），文案写「覆盖层唯一写路径 registry.bind」 |
| `tests/verify-detection-cascade.js:134-140` | `unregister` 后 stale → `wsStale.onRegistryBindStale` 清掉缓存（`:140`） |
| `tests/verify-947-workspace-file.js:103` | 「W3 内存胜一切」：内存绑定的后端压过文件里的值 |
| `tests/verify-1003-unified-decision.js:178-181` | 纯核 `decidePure`：`boundId` 优先（`:179`）、文件胜声明（`:181`） |
| `tests/verify-1003-single-outlet.js:56`、`:127-131` | 桩 `bound: () => undefined` 为基准；把 `bound` 换成回 `'github'` 后工具壳 `pickBackend` 与改色写用途**才放行**（`:129`、`:131`） |
| `tests/lib/deck-decide-stub.js:39`、`:43-44` | 桩先问 `registry.bound(handle)`；字符串 → `{ backendId, source:'explicit', canWrite:true }`（注释写「含「显式无后端」的 null：绑定是唯一真源，照实回」，但 `null` 分支实际回的是 `fallback`） |
| `tests/verify-957-workspace-writer.js:80` | 显式无后端时回包 `workspaceFile.skipped === 'explicit-none'` |
| `tests/verify-workspace-file-note.js:9`、`:100`、`:327` | 跳过档三值 `explicit-none/unregistered/registry-unavailable`（`:100`）；有 `h` 时跳过不占位、回 `null`（`:327`） |
| `tests/verify-992-readonly-labels.js:76`、`:179`、`:193`、`:263` | 注释与用例都以 `registry.bind(handle, ...)` 作为「用户亲手选过这个工作区」的前提，写用途才放行 |
| `tests/verify-656-subworkspace-acceptance.js:349-360` | `allBindings()` 行数（`:349`）；根/子/深目录 `bound === 'github'`、兄弟目录 `undefined`（`:355-360`） |
| `tests/verify-656-subworkspace-acceptance.js:367`、`:461` | `wf.bindings` 只回根一条（`:367`）；探测结果 `source === 'explicit'`（`:461`） |
| `tests/verify-subdir-first-frame.js:96`、`:137`、`:151`、`:232-235`、`:409` | 首帧确实打 `wf.selection`（`:232`）、每个工作区只打一次（`:235`、`:409`）、桩回 `source:'explicit'`；`:253` 用 `{ backendId: null, source: 'explicit' }` 喂横幅变体 |
| `tests/verify-markdown-label-colors.js:491` | 伪造 registry 时给 `allBindings: () => []` |

**把 `registry.bind` 当夹具前置条件（不改注册表语义，但都靠它拿写权限/来源）**

- `tests/verify-deck-tools.js:79`、`:92`、`:149`、`:301`、`:310`、`:337`、`:344`、`:408`
- `tests/verify-deck-tools-matrix.js:101`、`:140`；`tests/verify-deck-tools-host-wiring.js:94`、`:125`
- `tests/verify-1106-deck-surface.ts:164`、`:325`、`:341`
- `tests/verify-723-gate-wiring.js:234`（绑定句柄带 `refId: '.scratch/demo'`）
- `tests/verify-784-effortId.js:53`、`:131`、`:136`；`tests/verify-790-parent-edge.js:161`、`:209`；`tests/verify-829-parent-reread.js:109`；`tests/verify-895-github-memo.js:38`；`tests/verify-929-batch-cycle.js:60`；`tests/verify-934-935-invariants.js:97`；`tests/verify-971-markdown-parent.js:64`；`tests/verify-github-label-colors.js:439`；`tests/verify-golden-receipts.ts:211`；`tests/verify-refresh-workspace-key.js:107`

**只断言客户端 `source:'explicit'` 字面（与 `byHandle` 无关，一样会出现在改动的影响面里）**

- `tests/verify-683-choice-rev.js:79`、`:82`、`:102`、`:113`、`:115`；`tests/verify-669-choice-precedence.js:141-146`、`:168`、`:181`、`:259`；`tests/verify-669-chain-after-pick.js:142`；`tests/verify-698-switch-asks-layout.js:121`；`tests/verify-665-fresh-workspace-chain.js:162`；以及一批把 `selection: {backendId, source:'explicit'}` 写进夹具快照的界面门禁（`tests/verify-667-dock-header-no-brand.js:175`、`tests/verify-671-modal-global-overlay.js:99`、`tests/verify-669-switch-visible.js:63`、`tests/verify-669-collapsed-recoverable.js:142`、`tests/verify-958-label-name-visible.js:50`、`tests/verify-cap-fold.js:350`、`tests/verify-capsule-layout.js:62`、`tests/verify-cap-fold-browser.js:46`、`tests/verify-chain-view-ui.js:110`、`tests/verify-b2-map-newsession.js:153`）。

**门禁脚本里对 `origin`/出口的锁定**

- `tests/verify-1003-single-outlet.js:115-131`、`:196-199`（S5：判定链不再拿记忆回答，`asked === 0`）。
- `tests/verify-1003-unified-decision.js:118`、`:122`、`:138`、`:145`、`:156-165`、`:172`。
- `tests/verify-log-fields.js:36`（`detection.detect` 事件的字段表里含 `explicit`）。

**`research/1010-migration-map.json` 里 `registryCore` 归哪张地图**

- 该表里的条目是 `{"old": "src/host/tracker/registryCore.js", "new": "src/tracker/registry/registryCore.ts", …}`（`research/1010-migration-map.json:657-658`），**是 move-rename 条目，没有 `map` 字段**——即在这张表里它不归任何一张地图。
- 相关记载：`research/1010-adversarial-coverage.md:66` 把「L4 契约与注册表」归到**地图 02（#1024）+ 地图 06（#1042）**；`research/1010-migration-map.md:83` 记「`src/tracker/**` 一律不重命名，只换扩展名」。
- **没查到**把 `registryCore` 挂到「地图 07 识别判定」的记录。另有一份背景研究专讲它：`research/1043-map06-background.md:46-53`、`:134`。

---

## 八、文档里对这份副本的既有定版口径（逐条抄原话）

**`docs/adr/20261012-backend-decision-two-classes.md` 第 2 节「裁决：四层只有两类」（`:23-34`）**

- `:27` 「| 第 1 层 `user-memory-bind`（本次进程内的绑定副本） | **人选** | 人在界面上点确认那一下 | 能写 |」
- `:28` 「| 第 2 层 工作区配置文件 `docs/agents/workspace.yaml` | **人选** | 同上，同一个动作写下 | 能写 |」
- `:29` 「| 第 3 层 `declaration`（声明文件 `docs/agents/issue-tracker.md`） | **程序自己认** | 初始化那一步的 AI（插件自己不写） | 不能写 |」
- `:30` 「| 第 4 层 `autodetect`（后端 matches 命中） | **程序自己认** | 没有谁写，是读现场读出来的 | 不能写 |」
- `:32` 「**第 1、2 层是同一件事的两份记录，不是两个来源。** 证据：`src/host/workspaceCwd.js` 的 `handleBind` 一次动作同时写三处——内存绑定（`reg.bind`）、宿主侧记忆（`rememberWorkspace`）、工作区配置文件（`writeWorkspaceFileOnFirstBind`）；写文件那处的注释写明「唯一真源意味着用户明确选择时必须能覆盖它」。所以「人绑定」与「工作区文件」是同一个动作留下的当次副本与落盘真源。」
- `:34` 「**第 3、4 层是同一类，都是程序按规则自己认出来的。**……同一个文件被读两遍、贴了两个标签，但它属于哪一类是确定的：**程序自己认**。」

**同文第 4 节「唯一真源与另外两份记录」（`:40-44`）**

- `:42` 「- **工作区配置文件 `docs/agents/workspace.yaml`**（兼容读老 `docs/agents/workspace.json`）：人选的**唯一真源**，判定第 2 层读它，跨重启、跨机器都在。」
- `:43` 「- **本次进程内的绑定副本**：判定第 1 层，与上面那份由同一个动作写下，进程结束即失。」
- `:44` 「- **宿主侧选择记忆**（#683 的 H，`src/host/choiceStore.js`）：2026-10-12 起**不再参与后端判定**……**记录本身不删**（维护者拍板「只停用不删记录」）。」
- 另两处相邻口径：`:48`（九个 deck 工具与改色两类写操作「结论必须来自**人选**（第 1、2 层）才放行」）、`:52`（「工作区配置文件今天只有两个写者，都是人的动作」）、`:54`（`origin` 字段仍是平铺字符串，本轮只改注释）。

**`CONTEXT.md` 「后端判定来源词条（2026-10-12 定版 · #1003，承接 #669 与 #683）」（`:150-154`）**

- `:152` 「- **人选（user choice）**: 人在界面上点确认选定的那个后端（面板的「切换后端」弹窗、蓝条那颗「选择后端」的门控窗都算）。它只有两份记录，而且来自同一个动作：工作区配置文件 `docs/agents/workspace.yaml` 是**唯一真源**（跨重启、跨机器都在），本次进程内那份绑定副本只是同一次动作写下的当次副本。本机还存着一份按工作区记的选择（#683 的宿主侧记录），2026-10-12 起不再参与后端判定，只用来把工作区文件生成一次。 _Avoid_: 把「进程内绑定」与「工作区文件」当成两个来源（它们是同一件事的两份记录）、把本机那份记忆当成还有话语权的来源」
- `:153` 「- **程序自己认（auto detection）**: ……两条都不是人选，所以今天一律不给写权限——要写先请人去界面选定。」
- `:154` 「- **声明文件（declaration file）**: …… _Avoid_: 把它当成人选（人选是界面上点的那一下，落盘在工作区配置文件里）、把它与 `docs/agents/workspace.yaml` 混为一谈（后者是人选的唯一真源）」
- `:71` 「- **后端选择集（backend selection）**: 工作区共享数据之一：该工作区绑定哪个后端（GitHub / GitLab / Markdown / Other）；跨会话下次水合生效，不即时跳变。」

**`docs/adr/20260921-tracker-choice-precedence.md`**

- `:13` 「已查明（见 `#669` 的两条评论）：绑定成功（`wf.bind` 没有报错、日志里没有失败行），但**面板与引导链的取数不看用户那一下** —— 它们先问锚文件 `docs/agents/issue-tracker.md`……客户端再把「真相」合并回来，把用户的选择盖掉并写进本地缓存。」
- `:22` 「| **用户的手动选择** | **意图**：我现在要用哪个 | 用户在面板上点的那一下（`wf.bind` + 按工作区的持久缓存） | 一直有效，直到用户再改 | 不会 |」
- `:36` 「5. 插件**自己不写用户的仓库文件**（Q4：唯一显式写路径仍是 `wf.bind`）。」
- `:48` 「用户选择存在**按工作区的浏览器本地缓存**里；换台机器或清缓存之后，锚文件就赢了 —— 因为那时唯一的「意图」证据已经没了（**宿主里那份绑定是进程内的，重启即失**）。」
- `:60` 「不会。`hintBackendId` 只在客户端**确实有选择**时才上报；没有选择时判定链与今天一字不差（锚 → matches → 兜底）。」
- `:74` 「……但 `wf.bind` 是宿主进程内的一次调用，几十毫秒就回来了，紧接着就把弹窗关掉 —— 这一句**本来就不可能被看清**。」
- `:91` 「`loadSnapshot` 的第一句是 `hydrateFromCache(st)`，它会把**内存里那份旧快照**（还写着切换前的后端）的 selection 合并进会话……」（合并规则「真相 > 意图」，`src/client/kernel/store-snapshot.js:248-271` 是它的今天实现）

**`docs/adr/20260921-persist-user-choice-host-side.md`**

- `:17` 「本票把用户的选择**多存一份在宿主侧**（插件自己的状态文件，按工作区键），让它跨 DSH 重启、跨访问地址、跨桌面端/浏览器都还在。**同时必须解决维护者点出的第二个问题**：两份存储并存时，**旧值不许压新值**……」
- `:24` 「| **H**（新增） | 插件状态文件（宿主侧，按工作区键存**散列**） | 宿主（收到用户的那通绑定电话时） | …… | 不会自己没；只在淘汰上限时被丢掉 |」
- `:30` 「- **R1 只有「用户亲手选」与「一次性迁移」两条路写 H**：用户亲手选的那通电话是 `wf.bind(handle, backendId)`（由两个门控窗与面板「切换后端」弹窗调用）……**探测结论（锚文件、matches、兜底）一律不写 H**……」
- `:37` 「- **用户当场点确认的那一通 `wf.bind` 永远采纳**（不管 `baseRev`）……」
- `:42` 「- **R4 客户端以宿主回的答复为准，且**每一次**答复都要带权威 selection**……」——这一条是今天 `wf.snapshot` 回包必带 `{selection, rev}` 的上游依据）。
- `:53` 「- **R7b 客户端写 C 要按「键」读-改-写**……」

**代码内与其它已落盘研究里的同口径原文**

- `src/tracker/detection/backendDecision.ts:163-181`（「下面这四层只有两类……第 1 层是本次进程内那份副本（origin 记成 user-memory-bind；这个名字是历史遗留……）；第 2 层是工作区配置文件 docs/agents/workspace.yaml，它是人选的唯一真源……两份都由同一个动作写下，见 src/host/workspaceCwd.js 的 handleBind……写权限今天只给人选：第 1、2 层 canWrite: true」）。
- `src/tracker/detection/explicitDetector.ts:5-9`（唯一显式写路径 = `wf.bind(handle, backendId|null) → registry.bind`；「不写 byHandle，避免文件监听竞态」）。
- `src/tracker/contract/results.ts:66`（`origin` 取值表里第一项就是 `user-memory-bind`（本次进程内人亲手绑定））。
- `research/1043-map06-background.md:48`、`:49`、`:50`、`:51`、`:52`（把「显式记忆优先 / 存空表示显式无后端这个逃生舱 / 三态查询 / 空作为逃生舱让用户能明确说这里没有后端而不被程序改写 / 绑定表存的是真实句柄」逐条写成词条并标注 `src/tracker/registry/registryCore.ts` 行号）；`:134` 把「显式记忆优先然后并行布尔识别然后回落，缺省等三千毫秒」列成待保留项。
- `research/1047-detection-background.md:74`（「契约层 `Selection.origin` 今天仍是平铺字符串（`user-memory-bind`／`user-file` 等／`declaration`／`autodetect`／`unknown-workspace`／`pending`／`none`），“出处到两类”的机器可判表另起一笔，本轮只改注释不动形状」）。

---

## 附：本次没查到的项

- `wf.registry` 回包里 `bound` 字段的客户端消费点（`src/client` 下没查到）。
- 工作区文件表达「明确无后端」的第三种方式（含把后端名写成 `none`/`other`）。
- 「地图 07 识别判定」与 `registryCore` 的归属记录（`research/1010-migration-map.json:657-658` 无 `map` 字段；`research/1010-adversarial-coverage.md:66` 归地图 02 + 地图 06）。
- `src/` 下的 `statusbar-poll` / `checks-poll` 定时器名（只在 `research/489-appendix.md` 的附录里见过名字）。
