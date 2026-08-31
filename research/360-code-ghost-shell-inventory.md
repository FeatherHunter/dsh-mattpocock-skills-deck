# 研究：code 幽灵空壳盘点与不可切契约边界

> Ticket: [#360](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/360) — 研究：code 幽灵空壳盘点与不可切契约边界
> Parent: [#358](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/358)
> 日期: 2026-08-31
> 范围: 只依据一手源码与落盘文件，不引用二手转述
> 关键词: code 幽灵空壳 / blank 会话 / agentPreset / PresetLockedError / UnknownPresetError / reuseSid / workspaceId / cwd / 不可切契约

---

## 摘要

本研究回答 Parent #358 所指的“右侧面板新会话空白且为 code 模式”迷雾中的两个子问题：

1. **code 幽灵空壳是什么、现在在哪里、怎么被造、怎么被复活**；
2. **“创后不可切”到底被哪些契约、在何时、以何种错误锁死**。

一手溯源结论：

- **code 不是现行预设**。DSH 底座 `@deepseek-ai/dsh-agent-presets` 落盘仅含四目录 `standard / ptc / minimal / cordis`，无 `code` 目录（`D:\0Tools\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-agent-presets\presets` 实测仅四目录）。任何历史以 `code` 落盘的会话，其 `header.agentPreset` / 投影 `agentPreset` 均指向一个当前不可解析的标识，宿主解析时抛出 `UnknownPresetError`，而非“可正常挂载的第五预设”。
- **幽灵空壳 = `blank === true` 的持久会话**。该标志由会话投影暴露，经 `sessions.list.getSnapshot().byId[sid]` 呈现，含义为“尚未产生任何已落盘轮次”（`turn/start` 未落盘）。幽灵空壳的额外特征是同时满足 `projectionValues.agentPreset === 'code'`（或历史上遗留的 `header.agentPreset === 'code'`）与（常见）`cwd` 为空或为历史目录。
- **库存位置五处**：`sessions.list` 快照的 `byId` 空白行（主库存）、`sessions.scope` 立即可读的投影值（同源投影）、`workspaces` 侧的归档秩序（`archivedSessionIds` 与 `sessionIds` 不参与空壳过滤）、`storeOf(sid)` 的面板侧工作区共享缓存（按 `keyOf(cwd)` 分桶）、以及旧版 `.dsh` 会话持久化目录中已落盘的 `agentPreset: code` 头部（进程重启仍可见）。
- **产生链三叉**：旧版未传 `agentPreset` 时回落默认、未传 `workspaceId` 导致悬空 `cwd`、以及当前 `reuseSid` 复用旧空白而不校验预设——三者叠加使历史 `code` 空壳得以长期滞留并被新入口反复命中。
- **复活链两级**：`openTextInNewSession` 先判“当前会话是否本身就是可复用空白”再扫“全量最久更新者”，两级均以 `keyOf(cwd)` 归一后比对，且对空 `cwd`（`!normRow`）无条件放行，直接命中历史 `code` 空壳。
- **不可切边界两类锁死**：`UnknownPresetError`（请求预设不在四预设之列）与 `PresetLockedError`（会话已落盘 `turn/start` 后不可切）。前者在解析/挂载期抛出，后者在 `swap` / `select` 入口处以“是否存在 `turn/start` 事件”为唯一判据抛出，错误经 Typert 映射为 `agent-preset-not-found` 与 `agent-preset-locked` 稳定码。创后补救不可行，唯一正解是“创时即正”——创建请求中原子化携带 `agentPreset: 'ptc'` 与 `workspaceId`。

本报告为后续 #361 提供可直接引用的判定与处置清单，并给出可在 `pwsh` / `host.call` / `sessions.list` 上复现的探针片段。

---

## 1 定义：什么算 code 幽灵空壳

### 1.1 空白（blank）的语义

空白不是“界面上看起来空”，而是会话投影的权威标志：一个会话自创建以来尚未产生任何会话事件中的 `turn/start`。客户端通过 `sessions.list.getSnapshot().byId[sid].blank` 读取该投影（见 `src/client/kernel/api.js:385-390, 395-397` 的复用判定：`if (!row || !row.blank) continue`），宿主侧则通过 `agent.session.events.some(e => e.type === "turn/start")` 判定是否已开始（见 `D:\0Tools\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-agent-presets\lib\index.js:1631` 与 `lib/index.js:1631` 的 `swap` 守卫）。

因此：

> 一个会话是空白，当且仅当它的已落盘事件序列中不存在 `turn/start`。该事实由 `agentPreset` 投影之外的会话事件投影独立决定，不因标题、`cwd` 或预设是否可解析而改变。

来源：
- 客户端空白过滤：`src/client/kernel/api.js:386` `if (curRow && curRow.blank)`、`src/client/kernel/api.js:397` `if (!row || !row.blank) continue`
- 宿主不可切判定：`lib/index.js:1631` `if (agent.session.events.some((event) => event.type === "turn/start")) throw new PresetLockedError(...)`

### 1.2 预设字段（agentPreset）的语义

会话的预设由两层记录共同决定：

- **创建时头部**：`header.agentPreset`（见 `dsh-session/lib/types` 的 `validateSessionHeader` 对 `agentPreset` 的字符串校验，以及 `dsh-agent-presets/lib/index.js:972-978` 的投影定义 `init: (header) => header.agentPreset ?? null`）。
- **运行时投影**：`agentPreset` 投影（`lib/index.js:974-982` `agentPresetProjectionDefinition`，`key: "agentPreset", init/apply/view`），其状态经 `agent-preset/selected` 事件推进，宿主侧通过 `sessionProjections.stateOf(session, "agentPreset")` 或 `observation.projections.values.agentPreset` 读取（见 `dsh-api-session-controller/lib/index.js:340-341 presetForSession` 与 `478-482 presetForObservation`）。

对本研究而言，**code 幽灵空壳的预设特征**是：其投影值（或头部回退值）恰为字符串 `"code"`。该值在当前四预设之外部署中不可解析（下节证明无此目录）。

来源：
- 投影定义：`D:\0Tools\...\dsh-agent-presets\lib\index.js:972-978`
- 宿主读取：`dsh-api-session-controller/lib/index.js:340-341`, `478-482`
- 头部校验：`dsh-session/lib/index.js` `validateSessionHeader` 中 `if (record.agentPreset !== undefined && typeof record.agentPreset !== 'string') throw ...`

### 1.3 工作区归属（cwd 存在性）

历史空壳常见 `cwd` 为空字符串或缺失。客户端复用链对空 `cwd` 显式放行（`!normRow`），使其成为“跨工作区幽灵”——任何新会话的工作区都能命中它（见 4.2 节）。新版契约要求创建时显式携带 `workspaceId` 而非隐式 `cwd`，且 `workspaceId` 与 `cwd` 互斥（见 5.2 节）。

### 1.4 历史 code 预设缺失的证明

盘内证据：

| 检查项 | 结果 | 来源 |
|---|---|---|
| `presets` 目录枚举 | 仅四目录：`cordis / minimal / ptc / standard`，无 `code` | `D:\0Tools\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-agent-presets\presets` 目录实测（本研究 `listDir` 探针） |
| `presets/code/preset.yml` | `ENOENT` | 同上路径 `scandir` / `readFile` 探针 |
| 各现存预设元数据 | `name/order` 均存在且可读（standard/ptc/minimal/cordis 各自 `preset.yml`） | `presets/<id>/preset.yml` 实测 |
| 包内可见预设数 | `package.json` 声明仅打包 `presets` 与 `lib`，无 `code` | `dsh-agent-presets/package.json` `files: ["lib/index.js", "lib/...", "presets", ...]` |

结论：**code 不是“被隐藏的第五预设”，而是历史遗留标识**。任何以 `code` 创建的会话在当前部署上均满足“预设不可解析”条件。

---

## 2 库存清单：当前盘内真实 code 空壳在哪里

### 2.1 位置分类

| 位置 | 形态 | 判定键 | 检出方法 | 是否为真库存 |
|---|---|---|---|---|
| **A. 会话列表快照空白行** | `sessions.list.getSnapshot().byId[sid]` 中 `blank === true` 的行 | `row.blank === true && row.projectionValues?.agentPreset === 'code'` 或回退读 `row.header?.agentPreset` | `pwsh` / `host.call` 探针（见 7.1） | **是**，主库存，决定复用命中 |
| **B. 会话投影作用域值** | `sessions.scope(sid)` 经 `scopeOf / scopeParentOf` 映射的立即可读预设 | `presetForSession(session)` / `presetForObservation(observation)` 返回 `"code"` | `dsh-api-session-controller/lib/index.js:340-341` 定义的读取路径；在面板侧可经 `sessions.list` 行的 `projectionValues` 间接验证 | **是**，与 A 同源，仅访问路径不同 |
| **C. 工作区注册表的归档秩序** | `workspaceRegistry` 的 `global.archivedSessionIds` 与各 `WorkspaceEntity.record.sessionIds` | 空壳可能仍在某工作区的 `sessionIds` 数组或全局 `archivedSessionIds` 中 | 宿主侧 `workspaceRegistry` 持久化域（`dsh-workspace/lib/index.js` 的 `workspaceDomainSpec`：`archivedSessionIds: z.array(SessionId).default([])`） | **是**，但不参与客户端复用过滤，仅影响工作区切换与归档计数 |
| **D. 面板侧工作区共享缓存** | `storeOf(sid)` 与 `getCachedSnapshot(cwd)` 按 `keyOf(cwd)` 分桶的面板快照 | 空壳所在的 `ns.cwd` 经 `keyOf` 归一后与新会话同桶时，旧快照可能被二次水合 | `src/shared/workspaceKey.js: keyOf` 与 `src/host/workspaceKey.js: canonicalWorkspaceKey`，客户端 `api.js:412-430 hydrateFromCache` | **否**（非幽灵库存），但若命中空 `cwd` 空壳，会把“空工作区”快照误水合到新会话 |
| **E. 旧 .dsh 会话持久化遗留** | 磁盘上已落盘的会话事件日志与头部的 `agentPreset: "code"` | `sessionPersistence` 观察到的 `header.agentPreset === "code"` 且无 `turn/start` 事件 | 宿主侧 `sessionQuery.observeSession`（`dsh-api-session-controller/lib/index.js:138-160 inspectApiSession`）或直接列 `.dsh` 会话目录 | **是**，重启后仍可见，是 A/B 的持久化源头 |

来源：
- 客户端复用库存读取：`src/client/kernel/api.js:380-407`（`sessions.list.getSnapshot()` 遍历 `byId`）
- 工作区字符串键同形：`src/shared/workspaceKey.js: keyOf`、`src/host/workspaceKey.js: canonicalWorkspaceKey / normalizeWorkspacePath`
- 工作区归档域：`dsh-workspace/lib/index.js: workspaceDomainSpec` 的 `archivedSessionIds` 定义
- 会话观察：`dsh-api-session-controller/lib/index.js:138-160 inspectApiSession`、`478-482 presetForObservation`

### 2.2 数量与分布的测量方法（非一次性快照）

幽灵空壳的数量随用户创建/归档而变，本研究不固化数字，给出可重复的测量探针：

- **精确计数**：对 `sessions.list.getSnapshot().byId` 做双判据过滤（见 6.1 节），分别统计 `blank` 总数、`agentPreset === 'code'` 总数、以及交集（真幽灵），按 `cwd` 归一键分组即得分布。
- **投影校验**：对可疑 `sid` 再经 `host.call('wf.cwd', {sessionId})` 或 `sessionQuery.observeSession` 二次确认其落盘头部与投影是否一致（防止界面快照滞后）。
- **工作区归属分布**：对每个幽灵 `sid` 读其 `row.cwd` 经 `keyOf` 归一，空字符串单独计为“悬空桶”。

探针代码见第 7 章；本研究在溯源机上的实测仅用于验证路径可达性，不作为仓库常驻数量断言。

---

## 3 产生链：如何被造

### 3.1 分支一：旧版未传 agentPreset，默认回落链

旧版客户端在若干入口以 `{cwd}` 单参创建会话，未显式携带 `agentPreset`。宿主侧创建路径为：

```
SessionCommandController.create({cwd}) 
  -> ApiSessionAgentController.ensureSession(sessionId, cwd, ..., presetId=undefined)
    -> createOrAdopt(..., presetId=undefined)
      -> composeAgent(presetId=undefined) -> resolveMountable(defaultId)
```

其中 `presetId === undefined` 时，`AgentPresets.resolve(undefined)` 回落到 `defaultId`（见 `lib/index.js:1321-1324 resolve`：`const wanted = id ?? this.defaultId`），而 `defaultId` 又为 `settings.get().default ?? config.default`（见 `lib/index.js:1277-1279`）。若部署的 `~/.dsh/settings.yaml: agent-presets.default` 曾指向 `code` 或部署的 `config.default` 曾为 `code`，则该批次会话全部以 `code` 落盘。

Parent #358 已确证现行 `settings.yaml` 已为 `ptc`，但历史头部不会因设置改动而迁移——已落盘的 `header.agentPreset` 是冻结事实（见 `dsh-session` 的 `validateSessionHeader` 与 `snapshotSessionHeader` 的冻结语义）。

来源：
- 创建参数互斥与回落：`dsh-api-session-controller/lib/index.js:579-583`（`workspaceId/cwd` 解析）、`413-455 createOrAdopt`（`composeAgent(presetId)`）、`lib/index.js:1277-1279 defaultId`、`1321-1324 resolve`
- 头部不可变：`dsh-session/lib/index.js: validateSessionHeader / snapshotSessionHeader`（`deepFreeze`）

### 3.2 分支二：未传 workspaceId 导致悬空

现行前端已在 `src/client/kernel/api.js:338-374 ensureWorkspaceId` 中尝试把 `cwd` 解析为 `workspaceId`，并在创建时优先以 `{workspaceId}` 发起（见 `api.js:476 createOpts = workspaceId ? {workspaceId} : {cwd}`）。但若 `workspaces.list` 快照尚未就绪或匹配失败，仍会回落到 `{cwd}`，而 `cwd` 链在 Windows 上依赖 `fs.realpath` 规范化（见 `dsh-workspace/lib/index.js: realpathNormalize`），不存在的目录或相对路径可能导致“创建成功但未归属工作区”的悬空会话。

悬空的直接后果是其 `row.cwd === ''`，成为复活链中“无条件命中”的钥匙。

来源：
- 前端回落：`src/client/kernel/api.js:339-377`（`ensureWorkspaceId` 遍历 `workspaces.list`）、`api.js:476`
- 宿主互斥校验与工作区归属：`dsh-api-session-controller/lib/index.js:576-599`（`if (request.workspaceId !== void 0 && request.cwd !== void 0) reject`、`workspace?.path ?? request.cwd ?? defaultCwd`、`workspace.attachSession`）
- 路径规范化：`dsh-workspace/lib/index.js: realpathNormalize`

### 3.3 分支三：reuseSid 复用旧空白而不校验预设

即使新版已做到“创时即正”，当前 `reuseSid` 逻辑仍不检查候选空白的预设是否为 `code`，导致历史幽灵被新入口反复复活（详见第 4 章）。

来源：
- 复用判定无预设过滤：`src/client/kernel/api.js:378-408` 全段无 `agentPreset` 读取

---

## 4 复活链：reuseSid 的两级复用为何能接住 code 空壳

### 4.1 两级复用全代码

当前真源位于 `src/client/kernel/api.js:378-408`：

```js
let reuseSid = null
try {
  if (sessions.list && typeof sessions.list.getSnapshot === 'function') {
    const snap = sessions.list.getSnapshot()
    const normCwd2 = keyOf(cwd) // 第二参数省略则按运行时推断 win/posix
    const curSid = st.sessionId
    // 第一级：优先当前会话本身是空白
    if (curSid) {
      const curRow = snap.byId[curSid]
      if (curRow && curRow.blank) {
        const rowCwd = curRow.cwd || ''
        const normRow = keyOf(rowCwd)
        if (normRow === normCwd2 || !normRow) reuseSid = curSid
      }
    }
    // 第二级：全量最久更新者
    if (!reuseSid) {
      let best = null; let bestTime = -1
      for (const sid in snap.byId) {
        const row = snap.byId[sid]
        if (!row || !row.blank) continue
        if (row.id === curSid) continue
        const rowCwd = row.cwd || ''
        const normRow = keyOf(rowCwd)
        if (normRow !== normCwd2 && normRow) continue
        const t = row.updatedAt || 0
        if (t > bestTime) { bestTime = t; best = sid }
      }
      if (best) reuseSid = best
    }
  }
} catch(eReuse) {}
```

命中后直接进入复用分支（`api.js:409-475` 的 `if (reuseSid) { ... pendingDraft/face.rename/open ... return }`），不再走创建分支（`api.js:476-536 sessions.create`）。

### 4.2 normCwd 匹配与空 cwd 放行逻辑

- `keyOf` 定义见 `src/shared/workspaceKey.js`：Windows 下小写折叠、斜杠归一、去尾；POSIX 下保留大小写仅斜杠归一。宿主侧 `canonicalWorkspaceKey` 在此之上再经 `platform.path.normalize` 与 `fs.resolve` 解析相对路径（见 `src/host/workspaceKey.js`）。
- 复用条件为 `normRow === normCwd2 || !normRow`（第一级）与 `normRow !== normCwd2 && normRow) continue`（第二级，语义相同：仅当“非空且不等”才跳过）。
- **空 `cwd` 放行**：当历史幽灵的 `row.cwd === ''` 时，`normRow === ''` 为假值，`!normRow === true`，条件恒真。于是“悬空幽灵”对任何 `cwd` 的新会话都可命中，实现跨工作区污染。

### 4.3 为何能复活 code 空壳

1. 历史 code 空壳满足 `blank === true`，因此能通过两级的首道过滤（`if (!row || !row.blank) continue`）。
2. 其 `cwd` 常见为空，满足空放行条件，工作区隔离失效。
3. 两级逻辑**不读取** `row.projectionValues.agentPreset`，也不读取 `row.header.agentPreset`，因此 `code` 与 `ptc` 在复用眼中无差别。
4. 第二级按 `updatedAt` 取“最久更新者”（实现为 `t > bestTime` 最大值，实为“最新更新者”——命名与实现相反，但效果是稳定挑一个旧空白中的最新者），使同一幽灵可被反复挑中。

### 4.4 复用分支的副作用

命中后，复用分支会：

- 以新 `cwd` 覆盖 `ns.cwd` 并尝试 `hydrateFromCache`（`api.js:412-430`），但不重建会话头部，幽灵的 `header.agentPreset === 'code'` 保持不变；
- 尝试 `face.rename(title)` 与 `pendingDraft = text; pendingDraftTargetSid = sid`（`api.js:432-474`），使新会话的预填看似正常，但底座预设仍为 `code`，后续任何 `turn/start` 后切预设将触发锁死。

---

## 5 不可切契约边界

### 5.1 DSH 底座：四预设、两类锁死、何时不可切

#### 5.1.1 仅四预设，无 code

- 落盘：`D:\0Tools\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-agent-presets\presets` 仅含 `cordis / minimal / ptc / standard` 四目录，无 `code`（见 1.4 节探针）。
- 发现：`discoverPresets(resolvedRoots, harnessBase)` 每次调用重读根目录（见 `lib/index.js:462-470 discoverPresets` 与 `1284-1285 list()`），因此“无 code”是实时事实，非缓存假象。
- 元数据：每预设的 `preset.yml` 仅含 `name/description/order`（见 `lib/index.js:49-76 readPresetMetadata`），不含可执行语义；可执行语义在 `agent.cordis.yml`。

#### 5.1.2 两类锁死

| 锁死类 | 触发时机 | 判定条件 | 抛出错误 | Typert 稳定码 | 来源 |
|---|---|---|---|---|---|
| **未知预设** | 解析期（`resolve`）或挂载期（`resolveMountable`） | `presets.find(p => p.id === wanted) === undefined` 或 `preset.broken !== undefined` | `UnknownPresetError(presetId, available)` / `PresetMountError` | `agent-preset-not-found` / `agent-preset-invalid` | `lib/index.js:113-122 UnknownPresetError`, `1321-1324 resolve`, `1336-1340 resolveMountable`, `1058-1067 presetFailure` |
| **已开始后锁死** | 切预设期（`swap` / `select`） | `agent.session.events.some(e => e.type === "turn/start")` 为真 | `PresetLockedError(sessionId, presetId)` | `agent-preset-locked` | `lib/index.js:127-136 PresetLockedError`, `1631 swap`, `1616-1633 select/swap` |

错误消息形如：

- 未知：`agent-presets: preset "code" not found (available: cordis, minimal, ptc, standard)`（`lib/index.js:117`）
- 锁死：`agent-presets: session "xxx" has already started; its agent preset is fixed`（`lib/index.js:131`），经 `presetFailure` 映射为 `agent-preset-locked`（`lib/index.js:1075-1077`）

#### 5.1.3 何时创后不可切

**唯一判据**：会话事件中是否存在 `turn/start`。该事件由宿主在轮次开始时追加，落盘后即不可逆。实现上 `swap` 不检查 `blank`，只检查事件存在性（`lib/index.js:1631`）。因此：

- 空白会话（无 `turn/start`）**可切**（经 `agentPresets.select` / `recompose` 重链父作用域，见 `lib/index.js:1385-1399 recompose` 的 `bindScopeParent / rebind`）。
- 一旦用户发送首条消息或宿主注入首条轮次，产生 `turn/start`，**永久不可切**，任何 `select` 均抛 `PresetLockedError`。宿主侧 `ApiSessionPresetConflict`（`dsh-api-session-controller/lib/index.js:83-94`）在 `ensureSession` 的幂等采纳路径上也会校验请求预设与已存预设一致性（`273 assertPresetUnchanged`、`427-428 storedPreset 校验`），形成第二道“创后不可改”防线。

> 契约表述（源自 `lib/index.js:122-127` 注释）：“The session's composition is fixed: its conversation has started, so its history was produced under the preset it runs and swapping the composition would leave logged tool calls the new one cannot make.”

### 5.2 会话预设与工作区：workspaceId vs cwd 的演进与兼容矩阵

#### 5.2.1 参数演进

- **旧**：`sessions.create({cwd})` 单参，隐式经 `defaultCwd` 或 `fs.mkdir` 落盘（见 `dsh-api-session-controller/lib/index.js:446-455` 的 `mkdir(cwd)`）。
- **新**：`sessions.create({workspaceId})` 显式，宿主经 `workspaceRegistry.get(workspaceId).path` 解析真实目录（见 `lib/index.js:579-583`），并在创建后 `workspace.attachSession(sessionId)` 建立归属（`594-599`）。

客户端当前实现为兼容态：`const createOpts = workspaceId ? {workspaceId} : {cwd}`（`src/client/kernel/api.js:476`），即“能解析到 `workspaceId` 就用新参，否则回落旧参”。宿主则严格互斥：`if (request.workspaceId !== void 0 && request.cwd !== void 0) reject("bad-request", "session.create accepts workspaceId or cwd, not both")`（`dsh-api-session-controller/lib/index.js:576`）。

#### 5.2.2 工作区一旦创建后是否可改

- **会话的 `cwd`**：经 `header.cwd` 冻结，幂等采纳时若请求 `cwd` 与已存 `cwd` 不等则抛 `ApiSessionCwdConflict`（`lib/index.js:87-94`, `274 if (agent.session.header.cwd !== cwd) throw`, `427 if (observation.header.cwd !== cwd) throw`）。
- **会话的 `agentPreset`**：同理，经 `assertPresetUnchanged` 抛 `ApiSessionPresetConflict`（`83-94`, `273`, `428`）。
- **工作区的归属**：会话一旦经 `attachSession` 归属某工作区，其 `header.cwd` 已与该工作区 `path` 经 `realpathNormalize` 校验一致（见 `dsh-workspace/lib/index.js: AttachSession` 的 `realpathNormalize(header.cwd) !== record.path` 抛错）。后续不可“改工作区”，只能 `detachSession` + `attachSession` 到另一工作区（需 `cwd` 本身变更，这又受上一条锁死）。

结论：**工作区归属在创建时原子化确定，创后不可改**。因此 #358 的三要素（`agentPreset:'ptc'` + `workspaceId` + 首条注入）必须在同一次 `sessions.create` 调用中原子化落盘，任何“先建再补”均与底座契约冲突。

### 5.3 契约层与门禁：verify-* 双门禁对跨房/混会话的硬卡

本仓库的契约层与门禁对“不可切”与“工作区隔离”的保障体现在两类 `verify-*` 脚本（见 `package.json: scripts.verify` 串联的 30 余个校验）：

| 门禁 | 校验对象 | 与本研究的关联 |
|---|---|---|
| `verify-no-cross-import` | 禁止跨“房间”（`src/host/tracker/backends/<name>/`）引用 | 保证多后端化后 `code` 不会因跨房引入被隐式复活；属“房间纪律” |
| `verify-no-mixed-session` | 禁止一次会话改多房 | 同上，防止一次修复同时触及多后端会话投影 |
| `verify-panel-workspace-shared` / `verify-panel-workspace-isolation` / `verify-3-workspace-switch` | 工作区共享数据按 `keyOf(cwd)` 分桶、隔离、切换不串台 | 保证新会话的水合与旧幽灵的悬空桶不混淆；若 `keyOf` 不一致，悬空幽灵的快照会污染新会话 |
| `verify-tracker-contract` / `verify-ctx` / `verify-kernel` / `verify-build-artifacts` | 契约形状、上下文冻结、内核迁移、双源同步 | 保证 `api.js` 的真源与 `index.js` 产物的双源一致性，使 4.1 节的复用逻辑在产物中同样可审计 |
| `verify-naming-guardian` / `verify-newsession-blank-seed-315` / `verify-naming-isolation-315` | 命名守护、空白会话种子隔离 | 与幽灵空壳的“空白判定”直接相关，防止命名守护把幽灵标题误判为手改锁定 |

这些门禁在 `docs/architecture/tracker-backend-normalized-model.md` 与 `docs/adr/20260828-workspace-key-unification.md` 等 ADR 中有设计依据。对 #360 结论的依赖：后续 #361 的“创时即正”实现必须通过上述门禁，否则跨工作区污染会以另一种形式复活。

来源：
- 门禁清单：`package.json: scripts.verify`、`tests/verify-*.js`
- 工作区键统一：`src/shared/workspaceKey.js`, `src/host/workspaceKey.js`, `docs/adr/20260828-workspace-key-unification.md`
- 房间纪律：`docs/adr` 与 `tests/verify-no-cross-import.js` / `verify-no-mixed-session.js`

---

## 6 判定与处置建议

### 6.1 对后续 #361 的精确判据

**不要**以单一 `presets.list().broken` 作为幽灵判定。

| 判据 | 含义 | 是否足够 |
|---|---|---|
| `presets.list()` 返回的 `broken` | 某预设目录存在但其 `agent.cordis.yml` 不可解析（`preset.broken !== undefined`） | **不足**：`code` 目录根本不存在时，不会出现在 `list()` 中，也无 `broken`，判据恒假 |
| `projectionValues.agentPreset === 'code'` | 会话投影记录的预设恰为 `code` | **必要**，但需与 `blank` 组合，否则会误伤已产生有效对话的历史 `code` 会话（后者虽也为 `code`，但已不可切且不应静默删除） |
| `blank === true` | 会话尚未开始 | **必要**，幽灵的本质是“可被复用的空白”，非空白的 `code` 会话是“已锁死的实体”，处置策略不同 |

**推荐判据（供 #361 直接引用）**：

```js
// 幽灵空壳（可安全归档/删除）：空白 + 预设为 code
const isGhostShell = (row) =>
  row && row.blank === true
  && (row.projectionValues?.agentPreset === 'code' || row.header?.agentPreset === 'code')

// 已锁死的 code 实体（不可切，需提示而非静默复活）：非空白 + 预设为 code
const isLockedCodeEntity = (row) =>
  row && row.blank === false
  && (row.projectionValues?.agentPreset === 'code' || row.header?.agentPreset === 'code')

// 未知预设的广义幽灵（防御未来）：空白 + 预设不在可用之列
const isGhostUnknownPreset = (row, availableIds) =>
  row && row.blank === true
  && typeof row.projectionValues?.agentPreset === 'string'
  && !availableIds.includes(row.projectionValues.agentPreset)
```

其中 `availableIds` 来自 `await agentPresets.list().then(ps => ps.map(p=>p.id))`（见 `lib/index.js:1284-1285 list()`），当前为 `["cordis","minimal","ptc","standard"]`。

来源：
- `broken` 语义：`lib/index.js:1336-1340 resolveMountable` 与 `discoverPresets` 的健康检查
- `agentPreset` 投影：`lib/index.js:972-978`、`dsh-api-session-controller/lib/index.js:340-341, 478-482`
- `blank` 语义：`lib/index.js:1631` 与 `src/client/kernel/api.js:386,397`

### 6.2 归档/删除旧幽灵的策略选项与取舍

| 策略 | 动作 | 优点 | 风险/代价 | 适用信号 |
|---|---|---|---|---|
| **A. 仅过滤不删（推荐过渡态）** | 在 `reuseSid` 两级筛选中增加预设过滤：`if (row.projectionValues?.agentPreset === 'code') continue`，幽灵仍在但永不被命中 | 零数据丢失、可回滚、门禁零改 | 幽灵仍占 `sessions.list` 行数，用户会话列表可见“空标题 code 会话” | #361 首版，验证复活链已切断后再做清理 |
| **B. 归档（archive）** | 对 `isGhostShell` 的 `sid` 调用 `workspaceRegistry.archiveSession` 或宿主归档 RPC，使其从主列表消失但仍可恢复 | 列表干净、可恢复 | 需宿主暴露归档能力；归档后 `archivedSessionIds` 仍占域存储，`sessionPersistence` 日志仍在 | 用户已确认无有效草稿时 |
| **C. 删除（delete）** | 直接删除会话持久化日志与头部 | 最干净 | **不可逆**；若判据误伤 `isLockedCodeEntity`，会丢失用户已产生的对话历史 | 仅当双判据（`blank + code`）且经用户显式确认 |
| **D. 批量迁移（re-preset）** | 对空白幽灵尝试 `agentPresets.select(sid, 'ptc')` 重链 | 复用旧 `sid`，省一次创建 | 仅对 `blank === true` 有效；实现需走宿主 `select` 通道，客户端无直调权限，且需处理并发 `switches` 队列 | 不推荐，违背“创时即正”原则，易与复用分支竞态 |

**取舍建议（供 #361 定版引用）**：

1. #361 先落地 **A**（复用过滤），并在 `sessions.create` 侧做到三要素原子化（`agentPreset:'ptc'` + `workspaceId` + 首条注入原子化），使新幽灵不再产生。
2. 另起一次性 **B** 脚本（或宿主侧 `wf.archiveGhostSessions`）对存量 `isGhostShell` 做归档，用户可在设置中“查看已归档会话”中恢复。
3. **C** 仅作为用户手动“清理归档”后的二次确认，不由 #361 自动执行。

---

## 7 可验证探针

以下片段均可在不改动仓库的前提下于 `pwsh` 或宿主 `host.call` / 客户端控制台复现。所有路径均为一手来源中的真实路径。

### 7.1 列出会话快照中空白且预设为 code 的行

```js
// 在面板客户端控制台或宿主侧 JS 上下文执行
// 依赖：一手来源 src/client/kernel/api.js 的 sessions.list 快照形状
const snap = ctx.get('sessions').list.getSnapshot()
const rows = Object.values(snap.byId)
const ghosts = rows.filter(r => r.blank && (r.projectionValues?.agentPreset === 'code' || r.header?.agentPreset === 'code'))
console.table(ghosts.map(r => ({ sid: r.id, cwd: r.cwd, preset: r.projectionValues?.agentPreset ?? r.header?.agentPreset, updatedAt: r.updatedAt, title: r.title })))
console.log('blank total', rows.filter(r=>r.blank).length, 'code total', rows.filter(r=> (r.projectionValues?.agentPreset==='code')).length, 'ghost', ghosts.length)
```

宿主侧 `pwsh` 变体（经 `host.call` 间接）：

```powershell
# PowerShell 中经 DSH host 调用列空白（需在 DSH 进程内注入的 host 上下文；此处示意 host.call 形态）
# host.call('sessions.list') 非公开 RPC，探针以客户端控制台为准；宿主侧可用 dsh-session 持久化直接观察
```

### 7.2 检查设置默认预设

```powershell
# 落盘设置（Windows 典型路径；一手来源 lib/index.js 的 settingsNamespace 与 dshHomePath）
Get-Content "$env:USERPROFILE.dshsettings.yaml" | Select-String "agent-presets"
# 预期：default: ptc
# 来源：lib/index.js:1277-1279 defaultId getter 的 settings.get().default
```

```powershell
# 列 shipped 预设目录（无 code 的直接证据）
Get-ChildItem "D: ToolsDSH Desktopesourcesapp.asar.unpacked
ode_modules@deepseek-aidsh-agent-presetspresets" -Directory | Select-Object Name
# 预期：cordis, minimal, ptc, standard
```

### 7.3 列出可用预设与 broken 状态

```js
// 宿主侧（需 agentPresets 服务句柄）
const presets = await ctx.get('agentPresets').list()
console.table(presets.map(p => ({ id: p.id, trust: p.trust, broken: p.broken ?? null })))
// 预期：4 行，无 code；若曾手建 code 目录但 composition 缺失，则 broken 为字符串

// Typert 远端（客户端经 host.call 路径，Typert 定义见 lib/typert.host.js）
const roster = await host.call('agentPresets.list', {})
console.table(roster.presets)
// 字段：id/trust/isDefault/name/description/broken（见 lib/typert.host.js: AgentPresetRoster schema）
```

### 7.4 复现复活链的命中

```js
// 在 openTextInNewSession 调用前，打印 reuseSid 的两级命中
// 一手来源：src/client/kernel/api.js:378-408
const snap = ctx.get('sessions').list.getSnapshot()
const cwd = ctx.get('sessions').get(st.sessionId)?.cwd ?? st.cwd
const normCwd2 = keyOf(cwd)
console.log('target normCwd2', normCwd2)
for (const sid in snap.byId) {
  const r = snap.byId[sid]
  if (!r.blank) continue
  const normRow = keyOf(r.cwd || '')
  const hit = (normRow === normCwd2 || !normRow)
  if (hit) console.log('candidate hit', sid, { cwd: r.cwd, normRow, preset: r.projectionValues?.agentPreset, updatedAt: r.updatedAt })
}
```

### 7.5 复现不可切锁死

```js
// 空白会话可切
await ctx.get('agentPresets').select(agent, 'ptc') // agent 为空白会话的 live Agent
// 预期：ok，返回 "ptc"，并追加 agent-preset/selected 事件

// 已开始会话不可切（需先使会话产生 turn/start，例如发送一条消息）
// 预期：抛 PresetLockedError，Typert 码 agent-preset-locked
try { await ctx.get('agentPresets').select(agentStarted, 'ptc') } catch(e) { console.log(e.name, e.message) }

// 未知预设（code）直接抛 UnknownPresetError
try { await ctx.get('agentPresets').resolve('code') } catch(e) { console.log(e.name, e.available) }
// 预期：UnknownPresetError: preset "code" not found (available: cordis, minimal, ptc, standard)
```

---

## 8 引用索引

| 编号 | 来源 | 说明 |
|---|---|---|
| S1 | `D:\0Tools\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-agent-presets\presets\*`（目录枚举与 `preset.yml`） | 四预设存在性、无 code 的直接证据 |
| S2 | `D:\0Tools\...\dsh-agent-presets\lib\index.js:113-142`（`UnknownPresetError / PresetLockedError / PresetMountError` 类定义） | 两类锁死的错误类型与消息模板 |
| S3 | `lib/index.js:972-982`（`agentPresetProjectionDefinition`） | 预设投影的 init/apply/view 契约 |
| S4 | `lib/index.js:1277-1324`（`defaultId / list / resolve / resolveMountable`） | 默认回落、发现重读、无 code 即未知 |
| S5 | `lib/index.js:1631`（`swap` 的 `turn/start` 守卫） | 何时不可切的唯一判据 |
| S6 | `lib/index.js:1616-1633`（`select / swap / switches` 串行） | 切预设的入口与并发串行 |
| S7 | `lib/index.js:1058-1086`（`presetFailure / rejectPreset`） | Typert 稳定码 `agent-preset-not-found / agent-preset-locked / agent-preset-invalid` |
| S8 | `lib/typert.host.js`（`AgentPresetRoster / select` schema） | 远端契约的 wire 形状 |
| S9 | `dsh-api-session-controller/lib/index.js:340-341, 478-482`（`presetForSession / presetForObservation`） | 投影值的宿主读取路径 |
| S10 | `dsh-api-session-controller/lib/index.js:413-455`（`createOrAdopt`） | 未传预设时的 `composeAgent(undefined)` 回落链 |
| S11 | `dsh-api-session-controller/lib/index.js:576-599`（`SessionCommandController.create` 的 `workspaceId/cwd` 互斥与归属） | 新版显式 `workspaceId` 契约 |
| S12 | `dsh-api-session-controller/lib/index.js:87-94, 273-274, 427-428`（`ApiSessionPresetConflict / ApiSessionCwdConflict`） | 幂等采纳时的“创后不可改”第二道防线 |
| S13 | `dsh-session/lib/index.js: validateSessionHeader / snapshotSessionHeader` | 头部冻结、不可迁移的持久化事实 |
| S14 | `dsh-workspace/lib/index.js: realpathNormalize / WorkspaceEntity.attachSession / workspaceDomainSpec.archivedSessionIds` | 路径规范化、归属校验、归档域 |
| S15 | `src/client/kernel/api.js:323-337`（`ensureCwd`） | 同步读 `sessions.list` 的 cwd 权威 |
| S16 | `src/client/kernel/api.js:338-374`（`ensureWorkspaceId`） | `cwd -> workspaceId` 解析与回落 |
| S17 | `src/client/kernel/api.js:378-408`（两级 reuseSid） | 复活链主逻辑，含空 cwd 放行 |
| S18 | `src/client/kernel/api.js:409-475`（复用分支的 `pendingDraft/rename/open`） | 复用命中后的副作用 |
| S19 | `src/client/kernel/api.js:476`（`createOpts` 分支） | 兼容态创建参数 |
| S20 | `src/shared/workspaceKey.js: keyOf` 与 `src/host/workspaceKey.js: canonicalWorkspaceKey` | 工作区键同形，Windows 大小写折叠 |
| S21 | `src/host/index.js`（全文件无 preset 命中，经 grep 验证已迁移至 DSH 底座） | 宿主侧无本地预设逻辑的反证 |
| S22 | `package.json: scripts.verify` 与 `tests/verify-*.js`（`verify-no-cross-import / verify-no-mixed-session / verify-panel-workspace-*` 等） | 双门禁与工作区隔离的硬卡 |
| S23 | `docs/adr/20260828-workspace-key-unification.md` | 工作区键统一的设计依据 |
| S24 | Parent #358 关键事实（已确证，不重做） | 三要素原子化、`~/.dsh/settings.yaml: agent-presets.default: ptc`、门禁与真机验证目标 |

---

## 附：术语对齐（人类第一次阅读）

- **幽灵空壳**：指一个已落盘但尚未产生任何轮次的空白会话，其记录的预设恰为当前部署不存在的 `code`，因客户端复用逻辑未过滤预设而可被新会话入口反复命中。
- **空白会话**：会话事件中不存在 `turn/start` 的会话，经 `sessions.list` 的 `blank` 投影暴露。
- **不可切**：会话已开始后，任何切预设请求均被宿主以 `PresetLockedError`（`agent-preset-locked`）拒绝；会话创建后其头部 `cwd` 与 `agentPreset` 也分别被 `ApiSessionCwdConflict` / `ApiSessionPresetConflict` 锁定。
- **工作区键**：判定“两个会话是否在同一文件夹”的唯一归一字符串（`keyOf(cwd)`），Windows 折叠大小写、统一斜杠，宿主侧再经文件系统解析相对路径。

