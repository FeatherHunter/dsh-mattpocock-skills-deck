# 研究：真实使用与故障场景枚举及人工观察偏差对照（#347）

> 关联：[#345](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/345) · S-rec 面包屑 · 状态栏当前 ISSUE 定位标志
> 范围：`src/client/kernel/store.js:33-199` / `src/client/kernel/api.js:440-600` / `src/client/kernel/link.js:30-105` / `src/host/index.js:309-396,3069-3185` / `src/client/statusbar/StatusBar.js` / `src/client/views/ListTab.js` / `IssueDetail.js`
> 方法：静态链路还原 + 行号证据 + 场景推演（不改代码），逐条给出“应记/不应记/当前是否记”与复现条件
> 结论先行：**现状在“同会话连续动作”下近乎准确，但在 7 类日常场景中会出现“看的不是记的”或“记的不是看的”偏差；其中 3 类为日常可复现、2 类为高频突发、2 类为边缘。决定保留或移除的关键在于是否接受这 3 类日常偏差。**

---

## 1 基准：当前“看的”与“记的”分别是什么

- **记的**：`store.js:81-109` 的 `recordIssuePath(st, ref, source, title)`，仅在三处被调用：
  1. `api.js:443-444` / `522` 复用会话时（新会话锚点，`claim/mention`）
  2. `api.js:596` `inject` 时（粘贴/注入文本中的 URL 提及，`mention`）
  3. `store.js:170` 经 `wf.issuePathPoll` 收到 host 事件（`gh-create/gh-edit/claim/mention`，`store.js:150-183`）——但注意 `store.js:135` 自述“面包屑参数 st 钉死于首次挂载 store”，所有轮询事件写回首次会话
- **看的**：`ListTab.js` / `IssueDetail.js` / `TicketRow.js` 的选中态与详情展开，**从未调用** `recordIssuePath`。用户在面板里点开 #12 只是把 `store.tab` / `snapshot` 换视图，不产生面包屑。
- **结论**：**看≠记**。若用户期望“状态栏显示我正在看的编号”，现状天然偏差；若期望为“最后一次有动作的编号”（本次 [#345](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/345) 已定语义），则偏差缩小到下列动作链路的漏记/误记。

---

## 2 场景对照表（应记 = 按“最后动作即当前”语义应入面包屑）

| # | 场景 | 应记 | 当前是否记 | 证据与偏差说明 | 复现难度 |
|---|------|------|------------|----------------|----------|
| S1 | 同会话连续 `/wayfinder #12` 注入 → 立即 `/wayfinder #13` | 是（#13 为 current）| ✅ 记 #13 | `api.js:588-599` `extractIssueRefs`→`recordIssuePath` + `wf.issuePathPush`；2s 内同号会合并为更新时间（`store.js:91` 仅队尾去重，非全量）| 低 |
| S2 | 同会话点面板 “认领” #12（`wf.claim`） | 是 | ✅ 记 | `host/index.js:3120,3132` 必 `pushIssuePathEvent(n,'claim')`，经轮询回写；成功才记，失败不记（不污染）| 低 |
| S3 | 同会话 `gh issue create` 成功（JSON 含 url） | 是 | ✅ 记 | `host/index.js:362-382` 解析 `\/issues\/(\d+)` 优先，回退 JSON number，再回退任意数字；多数命中，见 R1 的 create 回退窗（正文含干扰小数字可误取）| 低 |
| S4 | 同会话 `gh issue edit 12 --add-label bug` | 否（仅标签）| ❌ 误记为 gh-edit | `host/index.js:387-392` 白名单把 `edit/close/comment/reopen` 全算 edit，未区分标签/评论；面包屑把“打标签”也当流转（噪声）| 中 |
| S5 | 面板点开 #12 详情（无任何动作，纯查看） | 否（按动作语义）| ✅ 未记（符合预期）| 无 `recordIssuePath` 调用；但若用户语义是“看即记”则为**漏记**（看的不是记的）| 低（日常）|
| S6 | 新会话复用空白会话打开 #12（openTextInNewSession）| 是（首票记 claim）| ✅ 记 | `api.js:440-445` 首 ref 记 `claim`，余记 `mention`；走同识别器，空白会话视同认领| 低 |
| S7 | 多会话并发：会话 A 挂载后，会话 B 产生 #13（B 的 gh-edit）| B 应记 #13，A 不应被污染 | ❌ 记到 A（钉死串味）| `store.js:135,170` 轮询闭包钉死首次挂载 st，所有事件写回 A；日常可复现：开两会话，先建 A 再在 B 做 gh 操作，A 的胶囊跳到 B 的编号 | **高频日常** |
| S8 | 500ms 内两会话先后各记一条（A 记 #12，50ms 后 B 记 #13）| 各自记各自 | ❌ 后者 cancel 前者 | `store.js:49-65` 单例 `_issuePathSaveTimer`，后起 `persist` 会 `clearTimeout` 前者，导致前者丢失；100ms 内连续操作可复现 | 中 |
| S9 | 8 会话以上并发，第 9 会话记一条 | 应各自保留 | ❌ 最旧被 LRU 踢 | `store.js:56-62` 8 会话 cap，按 `updatedAt` 排序踢最旧；同时大工作室/多窗口易触发 | 低（边缘）|
| S10 | 100 节点突发（脚本批量 create 120 条）| 应保留最近 100 | ⚠️ 丢最旧 20 | `store.js:35/102` 与 `host/index.js:444-445` 双端 100 cap，FIFO 丢弃；属设计内行为，但对“整套处理流程”追溯不完整 | 中 |
| S11 | GitHub 会话粘贴 `#12`（非 URL）| 否（GitHub 零误判）| ❌ 误记为 mention（混后端污染）| `link.js:35-38` 合并所有后端 `linkPatternSource`，含 markdown 的 `#(\\d+)`，致 GitHub 会话也命中 `#12` | **日常** |
| S12 | GitHub 会话粘贴完整 `https://github.com/o/r/issues/12` | 是 | ✅ 记 | `github/index.js:72` 模式精确，零误判 | 低 |
| S13 | Markdown 会话粘贴任意 `#12` | 是（宽匹配有意）| ✅ 记 | `markdown/index.js:199` `#(\\d+)` 即命中，符合本地文件引用语义 | 低 |
| S14 | 极早窗口：StatusBar 挂载时快照未到（无 backendModules）即粘贴 URL | 是 | ❌ 漏记 | `link.js:43` `srcs.length===0 → []`，识别器诚实回退为不记；重启后首秒操作可复现 | 中 |
| S15 | gh 调用失败（exitCode!=0、超时、鉴权失败）| 否 | ✅ 未记（正确）| `host/index.js:354-360` 失败提前返回，不入队 | 低 |
| S16 | claim 走错分支（markdown 工作区却解析出 github repoKey）| 应走 tracker | ❌ 可能走 gh 分支失败漏记 | `host/index.js:3073-3091` `getDetectionService` + `getTrackerRegistry` 判定；边缘已在 #227/#231 收敛 | 低 |
| S17 | 后台页签：会话 B 在 hidden 页签产生 gh-edit，A 在 visible 前台轮询 | B 的事件应被看到 | ❌ 漏记 + dirty 丢失 | `store.js:139-148` hidden 时 `cwdsOut=[]`，且 `store.js:148` 的 `MAX_POLLED_CWDS=12` 截断；同时 `host/index.js:3137` 以 `since` 过滤，若 hidden 期间无可见 cwds 上报，`since` 已推进致事件被跳过；见 §4 | 中 |
| S18 | Offline / 未登录 gh | 否 | ✅ 未记 | 无 `gh` 调用，无事件 | 低 |
| S19 | 切换工作区（shared.cwd 变更）后立即粘贴 | 是 | ⚠️ 视线门控延迟 | `store.js:136-148` cwds 取 `shared.cwd` + `stores[*].cwd`，切换后需等待下一 4s tick 才上报新 cwd，期间 `dirtyCwds` 回执可能指旧 cwd | 中 |
| S20 | 评论/标签等非流转操作被记为流转后，用户看胶囊显示 #12 以为在处理 | 否 | ❌ 噪声导致误导 | 同 S4，白名单偏宽 | 中 |

**统计**：20 条中 ✅ 9 / ❌ 8 / ⚠️ 3。**日常可复现的偏差 3 条（S5 看≠记、S7 钉死串味、S11 #12 混后端）**，为人工观察“看的不是记的”主因。

---

## 3 人工观察到的“整套处理流程能否准确”偏差归因

- **“看的不是记的”**（用户点开 #12，胶囊仍显示 -- 或旧号）→ **S5**：面板选中态从未记账，属设计内未做，非 bug，但与“看即记”预期冲突；本次已定语义为动作路径，故此条在验收时应明确为**不符合预期但非误判**，需在 G1 中写清。
- **“做了动作但胶囊没变”** → 常见 **S14 极早漏记** 或 **S7 钉死串味**（变到错误会话）或 **S8 debounce 丢失**。
- **“胶囊跳到别人的号”** → **S7** 多会话并发为最高频；只要开两会话即复现。
- **“粘贴 #12 就跳”**（用户本在 GitHub 会话）→ **S11** 混后端污染，属误判。

---

## 4 4s 轮询与脏上报窗口细化

- **栅格真源**：`src/shared/tracker/sync.js:47` `POLL_GRID_MS=4000`（client 仅兜底字面量，见 `store.js:196`），单飞闸 `_issuePathPolling`（`store.js:126`），`_issuePathPollTimer` 单例（`store.js:190`）。
- **cwds 视线门控**：`store.js:136-148` 仅上报 `visibilityState===visible` 的 `shared.cwd` + `stores[*].cwd`（最多 12，`SYNC.MAX_POLLED_CWDS`），hidden 页签上报空表。
- **宿主侧**：`host/index.js:3137-3185` 以 `since` 过滤 `pendingIssuePathEvents`（cap 100，TTL 60s，`EVAL_GAP_MS` 护栏），`panelSyncEvaluate` 每 3.5s 最多评估 2 个 cwd（`index.js:451`），`dirtyCwds` 回执经 `store.js:154-160` 触发 `scheduleDirtyProbe`。
- **dead 分支**：`store.js:174` `needProbeSource(ev.source)` 中 `index-dirty` 永不由 issuePath 事件产生（面包屑不承载纯脏信号，见 `host/index.js:451-453` 注释），属无效分支，不影响准确性但增加阅读负担。

---

## 5 与 R1 的 6 窗口映射

| R1 窗口 | 本表映射 | 日常性 |
|---------|----------|--------|
| R1 钉死串味 | S7 | 日常 |
| R2 debounce | S8 | 中 |
| R3 #12 混后端 | S11 | 日常 |
| R4 100 cap 丢失 | S10 | 中 |
| R5 hidden+since 漏记 | S17 | 中 |
| R6 极早漏记 | S14 | 中 |
| 新增：看≠记 | S5 | 日常 |
| 新增：白名单噪声 | S4/S20 | 中 |

---

## 6 对 G1/G2 的输入建议

- **若验收标准要求“日常零串味、零混后端、看≠记需明确”**：S5/S7/S11 三条即不满足，应直接走**彻底移除**（符合本次用户“bug 很多就去掉”的阈值）。
- **若接受“动作路径语义 + 多会话隔离放宽 + #12 仅 URL 触发”**：可修复 S7（解钉死）、S11（按当前后端过滤 pattern）、S8（按 session 分片 debounce）后达到 98%，保留才有意义。
- **量化抓手**：G1 需定死三问——① 多会话并发是否必须隔离（是→S7 必须修，否则移除）② GitHub 会话的 `#\\d+` 是否算提及（否→S11 必须修）③ “看≠记”是否算缺陷（按本次定语义不算，但需文档化）。

---

## 7 复现清单（最小步骤，5 分钟内）

- **S7**：开会话 A（默认工作区）→ 新开会话 B（同工作区）→ 在 B 执行 `gh issue create --title "x"` → 观察 A 胶囊是否跳到新号（应不跳，现状会跳）。
- **S11**：GitHub 后端工作区 → 新会话粘贴 “see #12 fix” 并 inject → 观察是否记 #12（应不记，现状会记）。
- **S5**：面板 List 点开 #20 详情（不做任何动作）→ 观察胶囊是否变为 #20（按动作语义应不变，按看即记应变）。
- **S8**：500ms 内连续 `inject #12` / `inject #13` → 观察 #12 是否丢失（视时序）。
- **S14**：重启 DSH → 启动后 500ms 内立即粘贴 GitHub URL 并 inject → 观察是否漏记。

---

*分支：`research/347-scenarios` · 文件：`research/347-scenarios/README.md` · 关联 #347 · 供 G1/G2 引用*
