# 研究：现行 issuePath 检测链路与持久化轮询准确性全盘点（#346）

> 关联：#345 · S-rec 面包屑（StatusBar 状态栏当前处理 Issue 轨迹）
> 范围：src/client/kernel/store.js:33-199、src/client/kernel/api.js:440-600（及 inject/link）、src/host/index.js:309-390、src/host/tracker/*、StatusBar.js、src/shared/tracker/sync.js
> 方法：静态链路还原 + 行号证据 + 最小复现推演（不改代码，仅盘点）
> 结论先行：**三路触发均能工作，但在「去重粒度」「会话隔离」「持久化节拍」「脏上报」四处各有一个已被代码自注释承认的残留竞态/漏记窗口；准确率初判：同会话连续操作 ≈ 98%，跨会话/多工作区/后台页签场景 ≈ 85-90%，宿主重启/高频突发场景存在可复现的丢失。**

---

## 1 三路触发条件（S-rec）还原

### 1A host runGh 白名单（gh-create / gh-edit）

**真源** `src/host/index.js:362-396`

```js
// 362-365: 仅成功路径、仅五动词
if (a.length >= 2 && a[0] === 'issue' && /^(create|edit|close|comment|reopen)$/.test(String(a[1]))) {
  if (String(a[1]) === 'create') { /* 369-382 解析 url/number/json 并 pushIssuePathEvent(n,'gh-create') */ }
  else {
    const hasAssignee = a.indexOf('--add-assignee') >= 0
    if (!hasAssignee) { /* 387-392 扫首个 /^\d+$/ 命中 pushIssuePathEvent(hit,'gh-edit') */ }
  }
}
```

- **create 解析鲁棒性**：优先 `\/issues\/(\d+)`，回退 JSON `number|id`，再回退任意 `\b(\d{1,6})\b`（`index.js:371-376`）。对 `gh issue create --json number,title,url` 等 JSON 输出能命中；但对混文本（多行 + url + number）可能误取第一串小数字（如正文含 `#42`）——属**误判窗口**。
- **edit/close/comment/reopen 共用 edit 通道**：`--add-assignee` 被显式排除（`385-386`），避免与 1B 认领重复记账；但 `gh issue edit 12 --add-label bug` 会被记为 `gh-edit`，而用户语义只是打标签而非处理流转——**噪声误判**（面包屑把标签操作也视作流转）。
- **失败不记**：`outcome.exitCode !==0` 提前返回（`354-360`），污染被挡。超时 30s（`TIMEOUT_MS:45`）经 `Promise.race(handle.done, timer.timeout)` 终止，已设 `graceMs:2000`。
- **快照失效联动**：命中即 `cache={ts:0}`（`379,391`），并对 create 额外 `namingSweepSoon(500)`（`381`）提前结算建号归属。

**初判**：白名单**偏宽**（把 close/comment 也算 edit）、create 解析**偏松**（数字回退）。绝大多数真实 `gh issue create/edit` 能捕获；边缘是标签/评论被算作流转与 JSON 输出含干扰数字误取。

### 1B wf.claim（认领）

**真源** `src/host/index.js:3069-3133` + 队列 `pushIssuePathEvent`

- UI `wf.claim` 先经 `getDetectionService` + `getTrackerRegistry` 判定是否走 tracker 分发表（`3073-3091`），`backendId !== 'github'` 时走 `tracker.setAssignees`（`3117`），否则走 `gh issue edit <n> --add-assignee @me`（`3125`）。
- 成功后**必** `pushIssuePathEvent(n,'claim')`（`3120,3132`），无论哪条分支。GitHub 分支复用 `runGh`，但因带 `--add-assignee`，1A 白名单已显式避让，不会重复产生 `gh-edit`——**去重正确**。
- 失败（无 repoKey、tracker 未实现 `setAssignees`、gh 返回 kind=auth/network）**不入队**，不污染。
- 客户端侧见 `store.js:177-179`，`pollIssuePathHost` 收到 `claim` 事件还会再 `host.call('wf.awaitCreatedIssue',{sessionId})` 做等待建号 nudge，但事件本身**不携带 sessionId**（注释亦自述不做 per-session 绑定），建号归属仍由 host 的同仓库最早占位/草稿档裁决。

**初判**：认领链路**最干净**，无误判；漏记仅当宿主判定 `useTracker` 分支错误（例如 markdown 工作区却解析出 github repoKey 导致走错分支）——此类已在 #227/#231 的 describe 回退里收敛。

### 1C client URL 提及经 linkPatternSource

**真源** `src/client/kernel/link.js:30-105`、`src/client/kernel/api.js:588-599`（inject）、`src/client/kernel/api.js:440-445,519`（新会话）

```js
// link.js:89-105 — 扫描式样只来自各后端 links.linkPatternSource；无数据→无识别
export function issueRefNumbersFrom(text, st){
  const srcs = __patternSources(st) // st.backendModules 优先，fallback shared.backendModules
  if(!srcs.length) return []
  // 对每条 pattern new RegExp(src,'g') 抽 m[1]
}
// api.js:588-599 — inject 触发
export const inject = (st,text)=>{
  const refs = extractIssueRefs(text) // → issueRefNumbersFrom
  if(refs.length){ recordIssuePath(st, refs[0],'mention', titleGuess)
    for(i=1;...) recordIssuePath(st, refs[i],'mention','')
    host.call('wf.issuePathPush',{number:refs[0], source:'mention', title:titleGuess})
  }
}
```

后端声明（唯一真源）：

| 后端 | linkPatternSource | 含义 | 证据 |
|------|-------------------|------|------|
| github | `github\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/issues\\/(\\d+)` | 仅完整 GitHub issue URL | `src/host/tracker/backends/github/index.js:72` |
| gitlab | `gitlab\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/-\\/issues\\/(\\d+)` | 仅 GitLab URL | `gitlab/index.js:97` |
| markdown | `#(\\d+)` | 任意 #数字 | `markdown/index.js:199,72` |

- **github/gitlab 零误判**：要求完整 URL，粘贴 `#12` 不会触发（符合注释主路径 URL 扫描，零误判；#\\d+ 辅路径待确认）。
- **markdown 宽匹配**：`#(\d+)` 会把正文任意 `#12` 都算提及。设计如此（本地文件引用），但**跨后端污染**：当 `shared.backendModules` 同时含 github+markdown 时，`__patternSources` 会**合并所有** pattern（`link.js:35-38` 遍历全部 backendModules），导致 GitHub 会话里粘贴 `#12` 也被识别为 mention（因 markdown 模板在全局共享缓存中）。——**串味窗口**。
- **空元数据诚实回退**：`srcs.length===0 → []`，无后端信息时**漏记而非误判**（符合无数据无识别），发生于极早窗口（StatusBar 挂载时快照尚未到达）。
- **仅首条带 title，其余空标题**：`api.js:595-598` 首条取前 3 行 80 字做 titleGuess，其余 `''`；host 侧 `wf.issuePathPush` 亦只推送首条（`598`），剩余提及**仅本地**可见，不会经污染广播。
- **新会话锚点**：`api.js:440-445,519` 在 `openTextInNewSession` 复用会话时对首个 ref 记 `claim`、后续记 `mention`，走同一识别器，语义是复用空白会话视同认领首票。

**初判**：GitHub/GitLab **零误判但存在启动漏记**；Markdown **有意宽匹配**；混合安装时对 GitHub 会话存在 **#数字串味** 的可复现误判。

---

## 2 去重与防污染

### 2.1 2s 窗口去重（client）

**证据** `src/client/kernel/store.js:91-99`

```js
const last = ip.nodes.length ? ip.nodes[ip.nodes.length-1] : null
if(last && last.ref===n && (now-last.ts)<2000){
  last.ts=now; if(source) last.source=source; if(title && !last.title) last.title=...
  ip.current=n; ip.updatedAt=now; persistIssuePath(st); emit(st); return true
}
```

- 仅对**队尾连续同一 ref** 在 2s 内**就地刷新**而非追加，避免用户连击/轮询重放导致队尾刷屏。
- **非队尾不去重**：序列 `12 → 13 → 12` 在 2s 内会追加第二个 12（非队尾），属设计取舍（保留路径分叉语义）。但对 burst `12,12,12` 1.5s 内连发三条 `gh-create` 事件，host 队列会有三条，client 第一次追加、后两次合并，最终只增 1——**正确防刷**。
- **仅 2s，超窗即追加**：同一票隔 2.1s 再次提及会再追加一条，节点会膨胀；但 cap 100 会裁最旧。

### 2.2 100 cap

- client `ISSUE_PATH_MAX=100`（`store.js:35`）对 `ip.nodes.push` 后 `shift`（`102`）。
- host `pendingIssuePathEvents` 同为 100 cap（`index.js:309,444-445`，`shift` 丢最旧）。
- 两端一致，但**丢失语义不同**：client 是保留最近 100 步路径，host 是保留最近 100 条待拉取事件。突发 >100 条（如脚本批量 `gh issue edit` 100 票）会静默丢最旧，且 host 无持久化，重启即清。

### 2.3 500ms debounce 持久化

**证据** `store.js:36-66`

```js
export const ISSUE_PATH_DEBOUNCE_MS=500
export let _issuePathSaveTimer=null // 模块全局单例
export const persistIssuePath=function(st){
  if(_issuePathSaveTimer) clearTimeout(_issuePathSaveTimer)
  _issuePathSaveTimer=setTimeout(()=>{ const map=loadIssuePathMap(); map[key]=...; saveIssuePathMapNow(map)},500)
}
```

- 单例定时器：**跨会话共享**。会话 A 记录后 200ms 内会话 B 再记录，A 的待写入被 `clearTimeout` 取消，仅 B 的闭包执行时读 map 并写回 `map[B]=...`，而此时 `map[A]` 仍是 500ms 前的旧快照——若 A 在这 500ms 内被 8-LRU 裁剪逻辑重算，A 的最新节点可能**丢失一次**（需再一次 500ms 周期才追上）。属**轻度竞态**，实际因人手操作间隔通常 >500ms，命中率低。
- **掉电窗口**：500ms 内关闭宿主/刷新页面，`localStorage` 尚未落盘，最新 1-2 步丢失（与 4s 轮询无关，纯本地持久化）。

### 2.4 防污染补充

- 1A 仅成功路径记（`runGh` exitCode 非 0 不进检测）；1B 仅成功后记；1C 对 github 要求 URL——三路均有失败不记闸。
- host 侧 `runGh` 30s 超时 + grace 2s，未防重放：超时后 `handle.terminate()` 但底层 gh 可能已在远端建号成功，client 侧**漏记**（远端已创建但本地未 push gh-create）。

---

## 3 会话隔离与 8 会话 LRU 持久化

**证据** `store.js:49-66,67-79`

- key：`st.sessionId || '__shared'`（`56,69`）。无 sessionId（如宿主尚未分配）的操作落 `__shared` 桶，多标签/无痕会话可能**互串**。
- 持久化形态：`localStorage['dsws.issuePath'] = JSON.stringify(map)`（`34,47`），map 为 `{ sessionId: {sessionId,anchor,nodes,current,updatedAt} }`（`78`）。
- 8 会话上限：`keys.length>8` 时按 `updatedAt` 升序裁最旧（`59-62`）。`updatedAt` 在每次 `recordIssuePath/reanchor/clear` 时置 `Date.now()`（`96,105,118`）。
- 水合：`ensureIssuePath` 优先内存 `st.issuePath`，否则按 key 从 map 恢复（`70-76`），缺 anchor/current 时回填首/尾 ref。

**隔离性初判**：

- ✅ 同工作区多会话**已隔离**（各写各 key），看板侧无共享。
- ⚠️ **轮询写入不隔离**：见 §5 竞态——`pollIssuePathHost(st)` 的 `st` 钉死首次挂载的 store（`store.js:135` 注释自述），之后所有 `recordIssuePath(st,...)` 都写该钉死会话，无论当前激活会话是谁。效果是：**后台会话触发的 gh-create 也会出现在前台钉死会话的面包屑里**（串味），而真正触发的会话反而没记。

---

## 4 轮询与脏上报

### 4.1 4s 轮询（client→host）

**证据** `store.js:190-198` + `src/shared/tracker/sync.js:20-52` 常量

```js
export const startIssuePathPoll=function(st){
  if(_issuePathPollTimer) return
  const tick=function(){ if(st) pollIssuePathHost(st)
    _issuePathPollTimer=setTimeout(tick, SYNC.POLL_GRID_MS||4000)} // POLL_GRID_MS=4000
  tick()
}
export let _issuePathPollTs=0, _issuePathPolling=false
export const pollIssuePathHost=function(st){
  if(_issuePathPolling) return // 单飞
  _issuePathPolling=true
  const cwdsOut=[...] // 见下
  host.call('wf.issuePathPoll',{since:_issuePathPollTs,cwds:cwdsOut}).then(res=>{
    res.events.forEach(ev=> recordIssuePath(st,ev.ref,...))
    _issuePathPollTs = max(serverNow, maxEvTs)
  })
}
```

- 节拍真源：`SYNC.POLL_GRID_MS=4000`（`sync.js:47`），client 仅派生引用；StatusBar 挂载即 `ensureIssuePath(s); startIssuePathPoll(s)`（`StatusBar.js:35`）。
- 单飞闸 `_issuePathPolling` 防并发；失败分支 `catch(()=>_issuePathPolling=false)`。
- `_issuePathPollTs` 推进到 `serverNow`（host 的 `Date.now()`），而 host 侧事件过滤为 `e.ts > since`（`index.js:3159`）。若 host 授时快于 client 且事件在 serverNow 之后 1ms 产生，下轮 since 已跳过该事件——**理论漏记窗口**（实际因 host 与 client 同机，时钟同源，且事件 ts 与 serverNow 同为 `Date.now()`，窗口 < 4s 轮询间隔内可被下轮 since 重叠容忍；但宿主高负载下仍可复现）。

### 4.2 cwds 脏上报与探针联动（#232 视线门控）

**证据** `store.js:136-160`（cwdsOut）、`index.js:3137-3185`（wf.issuePathPoll）、`sync.js:20-52`（常量）

- `cwdsOut` 取：`document.visibilityState==='visible'` 时才上报，否则 `[]`（`139-146`）；内容为 `shared.cwd` + `stores[*].cwd` 去重，截断 `MAX_POLLED_CWDS=12`（`148`）。
- R1-R4 语义由注释完整自述（`130-135`）：R2 切工作区靠 `StatusBar.apply` 换绑 `shared.cwd`，轮询主体随队列转移；R3 hidden 时报空表且探针同闸；R4 在途结果落 `per-cwd LRU` 不直接换视图。
- host 侧 `panelSyncEvaluate(cwdsIn)`（`3151-3157`）带 3.5s 竞速护栏，超时余波下轮以 `dirtyCwds` 送达；内部按 `SYNC.EVAL_GAP_MS=4500`、`EVALS_PER_TICK=2`、`OVERLAP_SKEW_MS=90000` 做增量 since（`sync.js:28-34`），并经 `deriveDirty` 验证差值后才 `panelDirtySince[cwd]=Date.now()`（`535`）。
- 脏回执：`dirtyCwds` 每轮把 `panelDirtySince` 中未过期（TTL 60s）者全量回执（`3162-3172`），仅当 `visible && cwdsIn includes k` 才 `delete panelDirtySince[k]`（`3180-3182`），属**确认式消费**；TTL 自愈防孤儿（`3171`），cap 50 裁最旧（`3175-3178`）。
- client 侧命中 `dirtyCwds` 即 `scheduleDirtyProbe()`（`156-159`，1.2s 短窗合并，区别于动作长窗 8s），而事件侧 `needProbeSource(ev.source)`（`174`）对 `gh-create/gh-edit/claim/index-dirty` 且走 `scheduleActionProbe()`（8s）。

**准确性初判**：

- ✅ 脏检测**不直接写面包屑**，仅调度探针；真实行级变更仍经 `probeNow→wf.probe changed→silent reload→diff`，零乐观插入，**无误判**。
- ⚠️ `needProbeSource` 的 `index-dirty` 分支**永不命中**——host 从未把 dirty 当 `issuePathEvent` 推送（`pushIssuePathEvent` 仅 gh-create/gh-edit/claim/mention），dirty 经 `dirtyCwds` 独立通道，已由 `scheduleDirtyProbe` 处理。属**死分支**，不影响正确性但注释与实现不一致。
- ⚠️ hidden 页签：`cwdsOut=[]` 时 host 跳过 `panelSyncEvaluate`，但仍回执旧 `dirtyCwds`。若用户在 hidden 期间远端被他人修改，切回 visible 后首轮 tick 才会重求值，最长**延迟=切回后首个评估 gap（~4.5s）**，期间面板仍旧数据（旧 60s 全量探针兜底）。

---

## 5 已知竞态 / 串味 / 丢失 场景（带最小复现）

| # | 现象 | 根因（行号） | 最小复现 | 影响 |
|---|------|--------------|----------|------|
| R1 | **轮询钉死导致串味**：B 会话的 gh-create 出现在 A 会话面包屑 | `store.js:135` 注释自述、`store.js:168-170 recordIssuePath(st,...)` st 为首次挂载钉死对象；`StatusBar.js:35 startIssuePathPoll(s)` 仅一次 | 1. 打开会话 A（StatusBar 挂载） 2. 新开会话 B（同窗口） 3. 在 B 的终端执行 `gh issue create --title test --body x` 成功 4. 切回 A 观察面包屑已多一条 gh-create，B 却没有 | 中：面包屑归属错位，但命名守护的 hint 仍按 claim 源选择首节点，影响会话标题 |
| R2 | **500ms 单例 debounce 跨会话丢步** | `store.js:37 _issuePathSaveTimer` 全局单例，`49-52 clearTimeout` | 1. 会话 A 记录 #12 2. 200ms 内会话 B 记录 #13（需两 store 并发，改代码或用两窗口） 3. 仅 B 落盘，A 的最新步在刷新后丢失 | 低：人手间隔通常 >500ms |
| R3 | **#12 串味误判（GitHub 会话被 markdown 规则污染）** | `link.js:35-38` 合并所有 backendModules 的 linkPatternSource；markdown 的 `#(\\d+)` 与 github 的 URL 规则并存 | 1. 安装含 markdown 后端的工作区（或仅让 shared.backendModules 含 markdown） 2. 在 GitHub 工作区的输入框粘贴 `see #12` 并注入 3. 面包屑出现 mention #12（本应仅 URL 才记） | 低-中：取决于是否混用后端 |
| R4 | **host 100 cap + 无持久化导致突发丢失** | `index.js:444-445 shift`、`pendingIssuePathEvents` 内存态 | 1. 脚本 110 次循环 `gh issue edit <n> --add-label x`（或批量 create） 2. 立即 `wf.issuePathPoll({since:0})` 3. 仅后 100 条可取，最旧 10 条丢失 | 低：人手难触发，脚本可复现 |
| R5 | **hidden 页签脏延迟 + since 跳变漏记** | `store.js:139 hidden→[]`、`index.js:3159 e.ts > since` 与 `store.js:182 serverNow` 推进 | 1. 切到 hidden 页签 4s 2. 在此期间远端他人创建 issue 3. host 因 cwds=[] 跳过评估，不标 dirty 4. 切回后首轮评估才标 dirty，期间 `issuePathPoll` 的 since 已跳到 serverNow，若该 issue 的 gh-create 是经 AI 会话 shell 产生（非本 host runGh），则永不进入 pending 队列，面包屑漏记（仅 dirty 探针能让面板刷新，但面包屑仍缺） | 低：仅 AI 旁路写 + hidden 叠加 |
| R6 | **极早窗口 1C 漏记** | `link.js:93` srcs 为空→[]；StatusBar 挂载时 snapshot 未到 | 1. 刷新后在快照返回前（<1s）立即粘贴 GitHub URL 并注入 2. `issueRefNumbersFrom` 返回 []，本地不记、亦不 push | 已知取舍（诚实缺位），下次粘贴即可补 |

> 注：除 R1 外，其余均需苛刻并发/脚本条件，日常人手路径准确率不受重创。R1 是唯一日常可复现的归属错位，已被代码注释显式承认并在 #232 的 R4 H2 分支中通过 per-cwd LRU 补偿面板数据，但面包屑仍钉死。

---

## 6 常量与阈值一览（便于后续 grilling 票调参）

| 符号 | 值 | 定义处 | 语义 |
|------|----|--------|------|
| ISSUE_PATH_MAX | 100 | `store.js:35` | 单会话面包屑节点上限 |
| ISSUE_PATH_DEBOUNCE_MS | 500 | `store.js:36` | persist 单例 debounce |
| 去重窗 | 2000ms | `store.js:91` | 队尾同 ref 去重 |
| POLL_GRID_MS | 4000 | `sync.js:47` | issuePath 拉取栅格 |
| EVAL_GAP_MS | 4500 | `sync.js:28` | 同 repo 增量求值最小间隔 |
| EVALS_PER_TICK | 2 | `sync.js:30` | 每 tick 至多评估 cwd 数 |
| DIRTY_PROBE_DEBOUNCE_MS | 1200 | `sync.js:32` | 脏→探针短窗合并 |
| ACTION_PROBE_WINDOW_MS | 8000 | `sync.js:49` | 动作→探针长窗 |
| FALLBACK_PROBE_MS | 60000 | `sync.js:51` | 兜底全量探针 |
| OVERLAP_SKEW_MS | 90000 | `sync.js:34` | since 回看重叠 |
| FAILURE_SUSPEND_AT / BACKOFF | 3 / 300000 | `sync.js:36-37` | 熔断阈值/时长 |
| DIRTY_ECHO_TTL_MS / CAP | 60000 / 50 | `sync.js:39-41` | 脏回执 TTL/容量 |
| MAX_POLLED_CWDS | 12 | `sync.js:43` | 上报 cwd 上限 |
| 会话 LRU | 8 | `store.js:59` | localStorage map 保留会话数 |
| host 队列 cap | 100 | `index.js:445` | pendingIssuePathEvents |

---

## 7 准确率初判（分场景）

- **同会话、手操、单工作区、前台**：三路 + 去重 + 轮询均命中，面板增量探针与面包屑一致，**≈ 98%**（扣 2% 为注释/标签误算作流转的噪声）。
- **多会话同窗（日常）**：R1 钉死导致面包屑归属错位，面板数据因 per-cwd LRU 仍正确；面包屑准确率 **≈ 85%**。
- **多工作区/多面板并列（MAX 12 内）**：EVALS_PER_TICK=2 轮转，4-9s 内收敛，准确率 **≈ 90%**。
- **后台 hidden / 宿主重启 / 脚本突发 100+**：R4/R5 丢失窗口打开，准确率 **≈ 70-80%**，但由 60s 兜底探针与 host 重启后重建档自愈。

**总体**：把面包屑视作尽力而为的 S-rec 提示轨迹是准确的；若视作强一致的审计日志，则 R1/R4/R5 已构成反例，需在后续 grilling 票中决定是否修钉死/落盘 host 队列/拆分 markdown 的 # 规则域。

---

## 8 给后续 grilling 票的抓手（不做改动，仅提问）

1. 是否将 `_issuePathSaveTimer` 改为 per-session（或以 map key 分桶），消除 500ms 跨会话 cancel？
2. 是否将 `startIssuePathPoll` 的钉死 st 改为当前激活会话或按 dirtyCwds 分发到对应 store，根治 R1 串味？代价与 #213 先例的兼容性如何取舍？
3. `__patternSources` 合并多后端是否应改为按当前会话 backendId 过滤而非 union？markdown 的 `#(\\d+)` 是否应限域到 markdown 工作区？
4. host `pendingIssuePathEvents` 是否需要落盘或至少在 `wf.issuePathPoll` 返回后做确认式删除（现为时间过滤，非消费删除）以避免重启丢与重放？
5. `needProbeSource` 的 `index-dirty` 死分支是否清理或改为真由 host 推送该 source？
6. 1A 白名单是否应把 `comment` 剔除（评论不应算流转），或至少 source 区分 `gh-comment`？

---

## 9 证据索引（便于复核）

- 检测链路：`store.js:33-199`、`api.js:588-600,440-445,519`、`link.js:30-105`、`index.js:309-446,3069-3185`、`sync.js:20-183`、`StatusBar.js:33-36`
- 去重/防污染：`store.js:91,35,36,49-65`、`index.js:354-396,444-445`
- 会话隔离/LRU：`store.js:56-62,67-79`
- 轮询/脏：`store.js:124-199`、`index.js:3137-3185`、`sync.js:47-52,69-72,99-107,164-183`
- 后端链接契约：`tracker/contract.js:110`、`tracker/backends/github/index.js:64-72`、`markdown/index.js:72,199`

*— 完 —*
