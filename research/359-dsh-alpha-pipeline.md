# 研究：DSH 新版 alpha 会话创建管线与预设解析真实路径 (#359)

> 归属地图：#358 DSH 新版 alpha 适配：新建会话三要素原子化
> 版本：2026-09-01 alpha 验证版
> 状态：研究完成，待 map 侧 grilling 拍板
> 存放：.scratch/research-359.md（主存档）

## 研究问题与决策依赖

**原问题（#359 Question）：厘清 DSH alpha 管线真实路径**

拆解为 4 个决策依赖（对应 #358 Not yet specified 迷雾）：

1. **入参真实形态**：alpha 底座是否新增/更名会话创建入参（如 agentPreset 更名、workspaceId 必填化），旧 {cwd} fallback 兼容矩阵是什么？
2. **复用链拒 code 精确判据**：当前 reuseSid 不过滤 preset，正确判据应按 projectionValues.agentPreset === "code" 还是按 presets.list().broken？
3. **工作区无值退化**：ensureCwd 取不到 cwd 时是直接 doFallback 还是建空工作区？
4. **验收形态**：alpha 上真机验收是 headless pwsh 扫 gh issue view 首行，还是 ui_drive 截图断言输入框文案？

## 方法与主证据链

- **源码直读（primary）**：
  - src/client/kernel/api.js 全量 725 行（openTextInNewSession 313-539 行）
  - src/client/kernel/store.js 的 getCwdSync/hydrateFromCache/storeOf/keyOf
  - src/host/index.js（host 半数据层）
  - DSH alpha 底座：app.asar.unpacked/node_modules/@deepseek-ai/dsh-agent-presets/lib/index.js、dsh-api-session-controller/lib/index.js、dsh-api-workspace-controller/lib/index.js
  - ~/.dsh/settings.yaml（agent-presets.default: ptc）
  - 门禁：tests/verify-issue60-cwd.js、tests/verify-newsession-blank-seed-315.js
- **CLI 探查**：gh issue view 358/359、dsh --version → 0.1.2-alpha.1

## 发现

### 1. 客户端管线真实路径（当前代码）

**位置**：src/client/kernel/api.js:313-539

**完整调用链**：

~~~js
openTextInNewSession(st, text, title)
  ├─ ensureCwd()  // 323-337
  │    ├─ 同步：getCwdSync(st.sessionId)  // sessions.list.getSnapshot().byId[sid].cwd
  │    ├─ 回退1：st.cwd
  │    └─ 回退2：host.call('wf.cwd', {sessionId}) // 异步兜底
  │         取不到 → null → doFallback()
  ├─ ensureWorkspaceId(cwd)  // 338-374
  │    ├─ 扫描 workspaces.list.getSnapshot().items[]
  │    ├─ 归一化 keyOf(cwd) 大小写/斜杠/尾斜杠 不敏感对比
  │    ├─ 命中 → 返回 wid = w.workspaceId || w.id
  │    └─ 未命中且 workspaces.create 存在 → workspaces.create({path:cwd}) → wid
  ├─ reuseSid 判定  // 378-408  ★缺陷处
  │    ├─ 优先：curSid 的 row.blank === true 且 (normRow === normCwd2 || !normRow) → reuse curSid
  │    └─ 次优：遍历 snap.byId 所有 blank 行（排除 curSid），cwd 匹配且 updatedAt 最大者 → best
  │         ★ 未检查 agentPreset / broken，任何 blank 空壳均可复用
  ├─ 若 reuseSid 命中（409-474）：
  │    ├─ storeOf(reuseSid).cwd = cwd；hydrateFromCache
  │    ├─ face.rename(title) → host.call wf.registerNewSessionWatcher
  │    └─ pendingDraft = text; pendingDraftTargetSid = sid; sessions.open(sid)
  └─ 否则 create (476-537)：
       ├─ createOpts = workspaceId ? {workspaceId} : {cwd}  // ★ 未显式传 agentPreset:'ptc'
       ├─ sessions.create(createOpts) → sid
       └─ sessions.open(sid)
~~~

**证据**：
- ensureCwd 见 api.js:324-327 getCwdSync(st.sessionId)；host 兜底 330-334 host.call('wf.cwd')
- ensureWorkspaceId 见 338-374，keyOf 归一 357、361
- reuseSid 无 preset 过滤见 392-405 循环仅 blank、cwd、updatedAt 三条件
- createOpts 构造见 476：const createOpts = workspaceId ? { workspaceId: workspaceId } : { cwd: cwd }
- pendingDraft 双变量见 39-40 声明及 531-532 pendingDraft = text; pendingDraftTargetSid = sid
- doFallback 见 316-318 注入 + warn toast

**关键事实**：当前 sessions.create 未显式传 agentPreset:'ptc'，依赖底座 default 兜底。若 default 被改，将复现 code 幽灵。

### 2. 预设解析与锁定契约（底座真相）

**包**：@deepseek-ai/dsh-agent-presets（app.asar.unpacked）

- **UnknownPresetError**（lib/types/preset.js）：preset "code" not found (available: standard, ptc, minimal, cordis) — 当 presets.resolve(presetId) 未找到时抛。源码：class UnknownPresetError extends Error { presetId; available }
- **PresetLockedError**：session "xxx" has already started; its agent preset is fixed — 当 agent.session.events.some(e=>e.type==="turn/start") 时 swap 抛。源码：if (agent.session.events.some(...)) throw new PresetLockedError(agent.id, agentPreset)
- **defaultId**：AgentPresets.defaultId getter 返回 settingsNamespace('agent-presets').default，实测 ~/.dsh/settings.yaml:48-51 为 ptc，盘内 4 预设无 code
- **健康检查**：discovery.scanRoot 对每个 <root>/<id>/agent.cordis.yml 做 compositionProblem，缺文件或不可解析 → broken: string
- **失败映射**：Typert 层映射为 agent-preset-not-found / agent-preset-locked / agent-preset-invalid

**结论**：code 判据应以 UnknownPresetError 或 roster .broken 为准，而非仅字符串对比。

### 3. 会话创建签名（alpha 真实 API）

**包**：dsh-api-session-controller / dsh-api-workspace-controller

**Session create 请求**：

~~~ts
// SessionCommands.create(request: { sessionId?: string, workspaceId?: string, cwd?: string, agentPreset?: string })
if (request.workspaceId !== void 0 && request.cwd !== void 0)
  reject("bad-request", "session.create accepts workspaceId or cwd, not both")
const sessionId = request.sessionId ?? SessionId('session-'+randomUUID())
let workspace = request.workspaceId ? ctx.workspaceRegistry.get(request.workspaceId) : undefined
const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd
adopted = await this.agents.ensureSession(sessionId, cwd, request.sessionId !== void 0, request.agentPreset)
~~~

证据：typert.host.js 中 agents.create({ ...composition.agentPreset ? {agentPreset} : {} }) 多处出现。

**Workspace**：WorkspaceCommands.create({path: cwd}) 先 resolveByPath 命中则返回 existing，否则 workspaceRegistry.create(path)；视图 {workspaceId, path, title, sessionIds}

**兼容矩阵**：

| 调用形态 | alpha 行为 | 备注 |
|---|---|---|
| sessions.create({workspaceId, agentPreset:'ptc'}) | ✅ 权威推荐 | 显式锚 ptc，绕过 default 漂移 |
| sessions.create({workspaceId}) | 隐式取 defaultId | 若 settings default 被改则继承错误 |
| sessions.create({cwd, agentPreset:'ptc'}) | ✅ 兼容 | 归属 defaultCwd，非原子化 |
| sessions.create({cwd}) | 隐式 default | 当前插件降级路径，alpha 仍支持 |
| sessions.create({workspaceId, cwd}) | ❌ bad-request | Typert 直接 reject |
| workspaces.create({path:cwd}) | 幂等 | 适合 ensureWorkspaceId |

**版本**：dsh --version 0.1.2-alpha.1 即 alpha，lib 为 unpacked 实时代码。

### 4. 复用链缺陷精确定位

- **位置**：api.js:392-405 best 循环仅检查 blank + cwd + updatedAt，无 preset 过滤。
- **强判据（推荐）**：复用前读 sessions.list.getSnapshot().byId[sid].projectionValues?.agentPreset 或 session.projections.values.agentPreset，若 === "code" 或命中 presets.list() 中 broken 项，则 continue 跳过。
- **弱判据（兜底）**：至少拒字面 "code"。但 broken 残留可绕过。
- **处置**：不应静默删除；推荐归档/隔离：对 code/broken 的 blank 行调 workspaces.archiveSession 或标记隔离，UI 不计入 frontier。
- **门禁缺口**：verify-newsession-blank-seed-315.js 仅守护 pendingDraft 与 workspaceId，未覆盖 preset 过滤 — 需新增 verify-newsession-preset-guard.js。

### 5. 工作区无值退化

- **当前**：ensureCwd().then(cwd=> if(!cwd) doFallback()) — 取不到 cwd 时直接当前会话注入，不建空工作区。
- **推荐分治**：cwd 为空 → doFallback 不建；有 cwd 无 wid → 建 workspace 再归属。此分治与 #60 修复一致，已被 tests/verify-issue60-cwd.js 覆盖。

### 6. 首条注入真实路径

- **写入**：api.js:531-532 及 reuse 分支 468-469 均为 pendingDraft = text; pendingDraftTargetSid = sid（sid 锚定，r4 修复 #62/#63）。
- **消费**：消费侧仅当 pendingDraftTargetSid === props.sessionId 时写入 st.injector(text) 或 setDraft，避免旧会话抢消费（注释 36-40）。
- **约束**：#315 回滚版要求草稿-only，不自动 face.prompt（见 528-529 注释“先填草稿”）。
- **Alpha 兼容**：InputActions.setDraft 为公开唯一草稿写路径（RESEARCH-NOTES.md §2）。

### 7. 验收形态

- **Headless pwsh**：RESEARCH-NOTES 1.4 已验证 gh api / graphql 可用，仅验 GitHub 数据层，不验输入框预填。适合快照层回归。
- **ui_drive**：dsh-plugin-ui-debug 支持 ui_drive 按动作脚本驱动并分步截图，ui_shot 存 PNG 后 read_image 断言。适合验证预设与首条 prompt，但需 pnpm run dev:web watcher。

### 8. 版本与效力

- 基线：DSH 0.1.2-alpha.1、settings default ptc、src 725 行 api.js、unpack Typert/Preset/Session/Workspace controllers（2026-09-01）。
- 后续改动以更新日期者为准（CONTEXT.md 规则）。

## 引用清单（primary）

- src/client/kernel/api.js:39-40 pendingDraft 双变量
- src/client/kernel/api.js:313-320 openTextInNewSession 签名与 doFallback
- src/client/kernel/api.js:323-337 ensureCwd
- src/client/kernel/api.js:338-374 ensureWorkspaceId
- src/client/kernel/api.js:378-408 reuseSid（无 preset 过滤）
- src/client/kernel/api.js:476 createOpts（未含 agentPreset）
- src/client/kernel/api.js:477 sessions.create(createOpts)
- src/client/kernel/api.js:531-532 pendingDraft 挂载
- src/client/kernel/api.js:528-529 #315 回滚注释
- src/host/index.js:44 DEFAULT_CWD = process.cwd()
- ~/.dsh/settings.yaml:48-51 agent-presets.default: ptc
- @deepseek-ai/dsh-agent-presets/lib/index.js：UnknownPresetError / PresetLockedError、defaultId、discovery.broken
- @deepseek-ai/dsh-api-session-controller/lib/index.js：create(request) 的 workspaceId/cwd 互斥、ensureSession(agentPreset)
- @deepseek-ai/dsh-api-workspace-controller/lib/index.js：WorkspaceCommands.create
- dsh --version → 0.1.2-alpha.1
- tests/verify-issue60-cwd.js:21-22 / tests/verify-newsession-blank-seed-315.js:103
- docs/architecture/kernel-contract.md 对 kernel/api.js 接口冻结

## 决策建议（给 map 的下一步）

1. **入参原子化（task）**：createOpts 改为 {workspaceId, agentPreset:'ptc'} 优先，缺 wid 时 {cwd, agentPreset:'ptc'}；新增门禁“必含 agentPreset=ptc”。
2. **拒 code 守护（task）**：reuseSid 循环前拉 presets.list() 或 projectionValues.agentPreset，跳过 code/broken；幽灵走 archiveSession 隔离。
3. **工作区归属原子化（task）**：保持 ensureWorkspaceId；cwd 为空仍 doFallback。
4. **验收双轨（grilling）**：门禁 = pwsh headless；发布手工 = ui_drive 截图。
5. **命名守护不变**：维持草稿-only。

## 未解决与需 grilling 澄清

- 复用判据用 “字面 code + broken” 还是仅 “broken”？
- 幽灵归档后是否自动重建归属？
- workspaces.create 失败时是否回落 {cwd, agentPreset:'ptc'} 还是直接 fallback？
