# 研究：会话创建链路与 DSH Session 重命名能力盘点 · 票 #206 结论报告

> Map #204 新命名契约 `[#n] <标题>` + `[New]` 占位→重命名 的前置盘点；对 T1/T3/T4 的阻塞性建议见 §4。
> 产出路径：`.scratch/research-session-naming-204.md` · 分支：`research/session-naming-206`

## 1 调用点清单（6 类入口 + Map 推进 · 含行号/标题构造/标签/调用链路）

### 1.1 内核定义层（唯一真源）

| 文件 | 行号 | 符号 | 当前值 / 构造 | 备注 |
|---|---|---|---|---|
| `src/client/kernel/router.js` | 182 | `SESSION_TITLE_PREFIX` | `'[MattSkills]'` 常量 | 旧前缀，待改 `[#n]` |
| `src/client/kernel/router.js` | 183 | `newSessionTitle(t)` | `'[MattSkills] ' + t.title + ' #' + t.number` | 旧后缀式：标题 + 空格 + #n；用于所有 `openInNewSession` |
| `src/client/kernel/router.js` | 187 | `newWayfinderText(st)` | `promptText('newWayfinder',{repo}) + BODY_FORMAT + 末尾输入位` | 新建需求模板文本 |
| `src/client/kernel/router.js` | 192 | `newBugWayfinderText(st)` | `promptText('newBugWayfinder',{repo}) + BODY_FORMAT + 字段集` | 新建 BUG 文本 |
| `src/client/kernel/api.js` | 125-223 | `openTextInNewSession(st,text,title)` | 唯一更名入口；见 1.3 链路 | 失败降级：本会话 inject + `toast.newSessionManual` |
| `src/client/kernel/api.js` | 225-227 | `openInNewSession(st,x)` | `openTextInNewSession(st, rowActionText(st,x), newSessionTitle(x))` | 行级封装，x={number,title,labels} |

`locale.js` 关键键（`src/client/kernel/locale.js`）：

- `panel.newWayfinder`（164 zh `+ 需求` / 457 en `+ Requirement`）、`panel.newBug`（166/459）、`map.newSessionTitle`（231/524）、`list.newSessionLabel`（163/456 `新会话`）、`toast.newSessionOpened`（158/451）、`toast.newSessionManual`（159 含 `{title}` 占位，用于 fallback）（452 en）。

### 1.2 六类入口 + Map 推进（当前标题构造）

| 序号 | 场景 | 标签归类 | 文件:行 | 当前标题构造（代码实证） | prompt 文本 | 调用链路 |
|---|---|---|---|---|---|---|
| A1 | 列表主视图：每行「执行/诊断/修复/讨论」旁的「新会话」按钮 | 执行/讨论/修复/分流四选一（`rowActionText`） | `src/client/views/ListTab.js:259` | `newSessionTitle(x)` → `[MattSkills] {title} #{n}` | `rowActionText(st,x)`（`store.js:563-570`：诊断→tpl.diagnose、bug→tpl.fix、grilling→tpl.discuss、否则 `startText(st,x)` 清单式 wayfinder+链接） | `onClick → openInNewSession(st,x) → openTextInNewSession` |
| A2 | TicketRow（Map 详情内票务行） | 同 A1 | `src/client/views/TicketRow.js:37` | 同 `newSessionTitle(t)` | `rowActionText(st,t)` | 同上 |
| B | Issue 详情页「新会话」 | 同 A1（按详情 labels 判定） | `src/client/views/IssueDetail.js:117` | `newSessionTitle({number:issueNumber,title,labelArr})` | 同 `rowActionText` / `startText` | `openInNewSession(st,{number,title,labels})` |
| C | Map 详情页「在新会话打开（推进该 map）」 | `wayfinder:map`（Map） | `src/client/views/MapDetail.js:154` | `newSessionTitle(m)`（m 为聚合 map 对象，含 number/title/labels/stats） | `rowActionText` 会走 `startText → mapExecute` 分支（prop `mapExecute` 含 map 标识头 + 闸门，全自包含） | `openInNewSession(st,m)` |
| D1 | Tabs 行「+ 需求」（面板 Tab 行右侧） | 新建需求（占位） | `src/client/views/shared/Tabs.js:35` | `SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')` → zh `[MattSkills] + 需求` / en `[MattSkills] + Requirement`（**无编号**） | `newWayfinderText(s)` | `openTextInNewSession(s, newWayfinderText(s), 标题)` |
| D2 | Tabs 行「+ bug」 | 新建 bug（占位） | `src/client/views/shared/Tabs.js:39` | `SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')` → `[MattSkills] + bug/BUG`（无编号） | `newBugWayfinderText(s)` | 同上 |
| D3 | 状态栏 BUG 悬停菜单「新增」 | 新建 bug（与 D2 同构） | `src/client/statusbar/StatusBar.js:255` | 同 D2：`SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')` | 同 `newBugWayfinderText` | 同上（在胶囊内 portal 弹层） |
| E | 交接「新会话交接」 | 交接（非 #204 覆盖） | `src/client/kernel/api.js:94-120` `doHandoffOpen` | 另链路：`workspaces.startSession()` + `pendingDraft/handoffReadText`（不走 sessions.create 重命名） | `handoffReadText(file,cwd)` | 不在本次命名治理范围，仅列作边界 |

> **fallback toast**（已核实）：`toast.newSessionManual`（`locale.js:159/452`）文案含 `{title}`，在 `sessions.create` 缺失或 `ensureCwd/ensureWorkspaceId` 失败时触发：本会话 `inject(text)` + `flash(warn)`，不新建会话。

### 1.3 `openTextInNewSession` 完整调用链（行号锚定）

```
Tabs/StatusBar/ListTab/TicketRow/IssueDetail/MapDetail 的 onClick
  → openInNewSession(st, x)                             // api.js:225
    → openTextInNewSession(st, rowActionText, title)    // api.js:125
      → sessions = ctx.get('sessions'); workspaces = ctx.get('workspaces')
      → ensureCwd()                                     // api.js:135-149 ① getCwdSync(sessionId) 同步读 sessions.list ② st.cwd ③ host.call('wf.cwd')
      → ensureWorkspaceId(cwd)                          // api.js:151-191  cwd→workspaceId 映射；workspaces.list 快照匹配，失配则 workspaces.create({path:cwd})
      → sessions.create({workspaceId|cwd})              // api.js:196  返回 sid: string (SessionId branded)
      → storeOf(sid) 快照继承 + issuePath 锚点           // api.js:198-208
      → sessions.scope(sid) → sessions.sessionOf(ctx)   // api.js:211-212
      → face.rename(title)                              // api.js:213  .catch 忽略
      → pendingDraft = text; pendingDraftTargetSid = sid
      → sessions.open(sid) + flash(toast.newSessionOpened)
      .catch → doFallback() // inject + toast.newSessionManual
```

跨会话预填时序：`StatusBar.js:14-32` 的 `useEffect([sessionId])` 仅当 `pendingDraftTargetSid===props.sessionId` 才消费（r4 修过抢先竞态）；旧会话重渲染不会触发。

---

## 2 DSH 会话 API 能力、语义与约束

### 2.1 签名（以 `node_modules/@deepseek-ai/dsh-client-runtime` 与 `dsh-session-title` 为权威）

| API | 签名 | 返回 | 备注 |
|---|---|---|---|
| `sessions.create(opts)` | `create(opts?: {cwd?: string, workspaceId?: string, sessionId?: string})` → Promise<string>` | `sessionId`（branded string） | 见 `dsh-client-runtime/lib/client.js: create`：内部 `manager.create` 后同步 `projectList()`，**resolve 时已在 list store 且可同步 `scope(sid)` 定址**；失败抛 `SessionCreateError`（含 requested id） |
| `sessions.scope(id)` | `scope(id: SessionId) → ctx|undefined` | Agent-scoped ctx（use-and-discard） | 懒铸 scope+binding；eligibility = 已列于 host 或 subagent 保留；见同文件 `:scope` 注释 |
| `sessions.sessionOf(ctx)` | `sessionOf(ctx: AgentContext) → SessionFace|undefined` | SessionFace | 置于 `ctx.sessions` 服务方法边界，跨 bundle 需经此面（tag Symbol 隔离） |
| `SessionFace.rename(title)` | 实为 `SessionTitleService.rename(session, rawTitle)`（host 侧 `dsh-session-title`） | 见下 | client 透过 `session.rename(title)`（manager 暴露的 session 对象）调用；本插件实证 `face.rename(title).catch(()=>{})` |

### 2.2 `rename` 真实语义（`dsh-session-title/lib/index.js`）

- **正规划 + UTF-8 字节截断**：`normalizeSessionTitle(input, maxTitleBytes)` 先 `cleanTitleText`（剥 OSC/CSI/ESC、C0/C1、方向/隐形字符，空白归一并 trim），再按 `maxBytes` 逐 code point 累加 `Buffer.byteLength` 截断（不拆字符），末尾 `trimEnd`。
- **空标题拒绝**：归一后长度 0 → 抛 `SessionTitleInvalidError`（调用方以 `title-invalid` 窄化；空值失活/销毁为普通 Error）。本插件捕获忽略属合理。
- **落盘模型**：`rename` 同步 `session.append('session/title', {title: normalized, messageSeqs: [], source:{kind:'user'}})`，并`supersede` 掉在途 provider 自动生成（all-prompts / first-prompt），**固定为 pinned**（后续 user message 不再触发自动标题，唯 `refresh()` 可显式解绑）。`get(session)` 即 fold 最新 `session/title` 事件。
- **幂等与二次 rename 时序**：
  - `user` 源的 title 固定优先级最高；连续 `rename` 以最后一次 `append` 为准，事件 seq 单调递增，无竞态错误，能覆盖。
  - 不必等待 `open(sid)` 完成：`create` resolve 后即可 `scope → rename`，时序独立（插件现行先 rename 后 `sessions.open` 正确，新会话前台可见即带新名）。
  - host 的 fallback/provider 分支与 `user rename` 互斥：已 pinned 后 `onUserMessage` 早退，不会回写覆盖（图 2.3）。
- **失败可重试**：仅两种失败——输入归一为空、或 session 非 live / 服务 disposed（抛 Error）。前者不可重试；后者换 live session 重试即愈。无速率或配额限。
- **配置约束（未在插件 cordis.patch.yml 暴露，取 harness 默认）**：
  - `maxTitleBytes`（标题 UTF-8 字节上限）、`fallbackMaxWords`/`fallbackMaxBytes` 为必配正整数且 `fallbackMaxBytes ≤ maxTitleBytes`（`SessionTitleService.Config` z 校验）。
  - 经验值（由 harness 侧常量推断，与通用会话上限一致）：常见默认约 200-400 bytes；具体以宿主启动日志/envelope 为准。建议 T1 截断预算按 **120 bytes** 对齐（足够 `[#12345] 中文标题约 30 字`）。
- **与 `fork({increaseTitle})` 的区别**：`fork` 的 `increaseTitle` 是创建后对子会话的 `renamed = await child.rename(increasedForkTitle(parentTitle))`（失败抛 Error），与本插件的 `rename` 同通道，本需求不走 fork。

### 2.3 `sessions.create` 创建语义

- **多态 opts**：优先 `{workspaceId}`（插件 #60 修复：显式映射后传入）；缺省回退 `{cwd}`。
- **同步可定址保证**：文档明确"by the time the promise resolves, the created session is in the list store and binding resolves"；无需等待 notifier flush 即可 `scope(sid)` → `sessionOf` → `rename`。
- **失败**：抛 `SessionCreateError`（插件捕获走 `doFallback`）。

---

## 3 新建后获知新编号的可靠机制

### 3.1 GitHub 侧：`gh issue create` 回包是否直返编号

**是。** 协议与本仓库实现互证：

- `gh issue create` 支持 `--json number,title,state,body,url,...` 结构化输出（help 示：EXAMPLES 含该 flag；`src/host/tracker/backends/github/issues.js: createIssue` 走 `altArgs=['issue','create',...,'--json','number,title,...','--repo','owner/name']`，并对 `stdout` 做 `JSON.parse` 取 `j2.number`，再 `normalizeIssue` 为 `Issue{key,number}`）。
- 故：**创建成功即同步获知 `number` + `url`**，无需轮询。失败分支经 `classifyGhError` 归一为 `OpResult{ok:false,error}`。

### 3.2 Wayfinder 新需求/新 bug 流程中 AI 侧创建是否可回传

wayfinder/issue 创建本质走同一 `tracker.backends.*.createIssue` 通道（host 侧 `src/host/tracker/` registry），结果以 `OpResult<Issue>` 返给 agent 工具调用。分两种消费：

- **人机同会话观测**：新需求/bug 的「新建」会话即 AI 执行会话——AI 成功执行 `gh issue create` 后，通常会在下一条工具返回或总结文本中显式给出 `Created issue #<n> https://github.com/owner/repo/issues/<n>`（wayfinder 技能自带产出约束）。宿主可监听该会话的流式文本（tool/result 或 assistant 文本）。
- **跨会话感知**：原触发会话（用户点按钮的会话）不在同一执行轨迹。要把新编号传回该会话，需**显式链路**，不能依赖"AI 会主动回调"。

### 3.3 链路方案对比

| 方案 | 机制 | 延迟 | 可靠性 | 适用 |
|---|---|---|---|---|
| **A 首选：事务内回传（契约微调）** | host 侧为 `openTextInNewSession` 创建的占位会话注册一次性 watcher：当该子会话出现首个 `gh issue create --json` 成功结果时，host 推送事件给父会话（或直接对子会话二次 `rename`）；或把 tracker create 的结果经 `wf.issuePathPoll / host.call` 同步暴露为可轮询状态 | 0~2s | 最高（结构化，非文本解析） | T3 首选；需 host 小幅改动，本 map 原定"UI 层零改动"需申请豁口 |
| **B 次选：文本解析（零契约改动）** | 新会话的 issuePath / 会话文本轮询：扫描 `https://github.com/owner/repo/issues/<n>` URL（`extractIssueRefs` 同正则）或 `#<n>` 提及；首次命中即 `sessions.scope(newSid) → sessionOf.rename('[#<n>] ...')` | 取决于 AI 执行时长（数秒~数十秒） | 中（AI 可能只说句式变体；需 URL 正则锚定，误命中率低） | 零侵入兜底 |
| **C 兜底：定时 `gh issue list --search` 轮询** | 对新建 pid / repo 最新 N 条 `--search` 比对创建时间/作者 | ≥3-5s，且受 API 缓存/限流影响 | 低；时序抖动大 | 仅作 C 兜底，不推荐 |
| **D 预生成** | 预先 `gh issue create` 再开会话（编号前置） | 需阻塞 UI | 高，但破坏"新会话先开、AI 再建图"的 UX | 否 |

**结论：A 事务内回传为首选，B 文本解析作零契约兜底。**

本插件已具备两项可复用设施：

- `extractIssueRefs(text)`（`api.js:228`）已扫描 `github.com/.../issues/(\d+)`，且 `recordIssuePath` 会把新会话的首个引用记为 `claim`。
- `startIssuePathPoll` / `pollIssuePathHost`（`store.js:xx`，`StatusBar.js:34-36` 自启）已对 `wf.issuePathPoll` 长轮询，天然可承载"A"的事件总线。

**首选链路（A）细化**（契约层微调申请点）：

1. `openTextInNewSession` 创建时把 `{newSid, parentSid, expectedRepo}` 登记到 host 侧 watcher map；
2. host 监听 `dsh-session` 事件流中子会话的 `tool/result` / `session/title`，或直接复用 `tracker.createIssue` 的 `OpResult`；
3. 解析到 `number+title` 后，host 对 `newSid` 执行一次 `SessionTitleService.rename(`[#${n}] ${sanitizedTitle}`)`（等同用户 rename，pinned），并可选向父会话 flash `已重命名为 [#n]`。

**兜底链路（B）细化**（纯 client）：

- 对新 sid 设 1s 轮询，最多 120s：读 `sessions.get(newSid).events` 或经 `wf.issuePathPoll` 取最新文本，跑 `extractIssueRefs`；首个新 URL 命中即取同条文本附近标题（或 `gh issue view <n> --json title` 拉标题），做 `face.rename(`[#${n}] ${title}`)`，成功即停。
- 失败保持 `[New]` 占位并 `flash(tr('toast.newSessionManual')变体)`（复用现有文案结构）。

---

## 4 约束、边界与对 T1/T3/T4 的建议

### 4.1 标题约束（待 T1 定版）

- **格式**：`[#<number>] <title>`（中括号+井号+数字，空格分隔标题）；移除 `[MattSkills]`；Map 入口以 Map 编号为前缀（例 `[#198] 全新工作区后端优先…`），不展开 frontier 票。
- **语言**：标题原样跟随 issue 原标题语言，不翻译；`[New]` 占位跟随 harness 语言（zh `[New] 新建需求` / en `[New] New Requirement`，当前值为 `[MattSkills] + 需求/Bug`，T1 替换为该格式）。
- **长度与截断**：建议按 **120 UTF-8 bytes 预算** 约束全标题（含前缀），超长对 `title` 部分做 `truncateTitleUtf8` 尾截 + `…` 尾缀一字符；编号前缀永不截断、且保证唯一可搜。T1 需定：截断后是否保留完整前缀可排序性实验。
- **字符清洗**：复用 DSH `cleanTitleText` 规则（剥控制/方向/ANSI/C0C1，空白归一为单空格并 trim）；emoji 保留（非控制字符），但计入字节预算。
- **已关闭/分流消歧**：暂不加 `[closed]` 标记（待 map 讨论）；跨仓库同号消歧暂不加 `owner/repo` 短缀，仅编号（Not yet specified，T1 记录为开放）。
- **排序**：仅提供前缀可排序形态，不强制后端排序。

### 4.2 状态与机类

- 已盘点全部调用点与失败分支；历史会话批量迁移属 Out of scope，仅新会话生效。
- 占位→重命名并发：多窗口同建各自独立 sid watcher，互不互斥；用户手动改名在 pinned 语义下会被二次 rename 覆盖，T3 需决定是否保留"用户已改则不再自动覆盖"门控（建议：若用户 5s 内已 rename，则跳过自动）。

### 4.3 对后继票的阻塞性建议

| 票 | 标题 | 是否阻塞 | 建议 |
|---|---|---|---|
| T1 | 格式定版（前缀/截断/字符/占位文案） | **否** | 可并行。输入：本报告 §4.1 约束；输出：冻结 `truncateTitleUtf8` 预算、占位文案 zh/en、是否保留用户改名门控。 |
| T3 | 新建两入口占位 → 获号后自动重命名 | **是（需决策）** | 选择 A（host 事务回传）或 B（client 文本轮询）二选一；A 需申请本 map"UI 层零改动"的豁口（最小改动：host 新增 watcher + 对子会话 rename）；B 可零改动但需定 120s/1s 轮询与失败 toast。建议 **A 主 + B 兜底**。 |
| T4 | 存量入口前缀统一（6 类） | **否** | 可并行：纯 client 改动（`router.js:182-183` + 各入口处标题构造），无 host 依赖。建议在 T1 截断规则落定后一次性改完，避免二次 rename。 |

**契约层微调申请点**（若选 A）：`src/host/tracker` 暴露"最新创建 issue 事件"给 `wf.issuePathPoll` 或新增 `wf.awaitCreatedIssue({newSid, timeoutMs})` RPC；`src/host` 侧持有 `SessionTitleService` 对 `newSid` 的二次 `rename` 权限。影响面仅 host 侧数十行，零 tracker 后端改动。

---

## 5 证据与可复现

- 代码证据：`src/client/kernel/router.js:182-183,187,192`、`src/client/kernel/api.js:94-227`、`src/client/views/shared/Tabs.js:35,39`、`src/client/statusbar/StatusBar.js:255`、`src/client/views/ListTab.js:259`、`src/client/views/TicketRow.js:37`、`src/client/views/IssueDetail.js:117`、`src/client/views/MapDetail.js:154`、`src/client/kernel/locale.js:158-167`、`src/host/tracker/backends/github/issues.js: createIssue（gh issue create --json）`、`dsh-client-runtime/lib/client.js: sessions.create/scope/sessionOf`、`dsh-session-title/lib/index.js: rename/normalize/truncate`。
- 验证：`gh issue create --help`、`Get-Content DSH unpacked node_modules`、`gh issue view 204/206 --json`。

---

— 研究子智能体 · 2026-08-26 · 用于 #204 Decision 记录与 #206 resolution comment。
