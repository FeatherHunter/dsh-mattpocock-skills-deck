# #1418 复核：刷新机制重构之后，「探测轮询烧穿 REST 配额」和「限流闸停掉整轮 deck 工具」还在不在

> 票 #1418 · 只读复核（triage 用，不改生产代码）· 落盘 2026-10-24
> 基线：main 分支 448a2869。工作区里另有别的会话的未提交改动，本文没有触碰。
> 一手来源：本地源码，行号以当前 HEAD 为准；没有启动插件做 2 小时真机 soak，也没有跑门禁。
> 既有笔记 research/998-q2-quota-cooldown.md（2026-10-10，讲剩余额度读数同步的失败冷却）、research/1027-probe-handoff.md（2026-10-13，讲契约探针的形状）、research/github-api-rate-limits-2026-09-22.md（讲 GitHub REST/GraphQL 两族限额的事实）都早于 #1419 / #1439 / #1443 / #1444 / #1445 / #1446 这一轮重构，主题也不同，回答不了「重构后 #1418 是否还在」；本次复核落盘在 research/1418-refresh-refactor-recheck-2026-10-24.md。

## 一、结论

**一句话：②「任一桶不够就停掉所有 deck 工具」原样还在；① 里由探测扫描烧穿 GitHub REST 的那一半已经改掉（不是整个 ① 都不成立），但「按客户端记住的所有工作区各发一次探测、每次全仓翻页」的探测需求没变，成本只是从 REST 换成了 GraphQL；而每页 GraphQL 仍被记成 1 条本地 rest 请求，所以探测还能把本地 rest 桶推到写保底，反过来让 deck 工具全停。**

拆开说：

1. **探测仍然对每个记住的工作区各发一次。** 面板客户端每一拍收集 shared.cwd 和全部 stores 的 cwd，按工作区根去重后逐个调 wf.probe；自动定时器 60 秒一轮，活跃循环 5 秒/15 秒一轮，两个定时器同时存在，活跃循环最后也调同一个会遍历全部 cwd 的函数。**【已确认】**
2. **每次探测仍然把整仓翻到底。** 索引扫描每页 200 条、最多 100 页，since 只在内存里过滤返回行，不减少请求页数；没有条件请求，也没有「同一仓库刚扫过就不再扫」的跨工作区合并。**【已确认】**
3. **探测扫描的 REST 字面症状不在了。** 索引扫描的每一页走 gh api graphql，不是 gh api repos/.../issues；2026-10-23 那种 REST 计数不会再由这条扫描产生。**【已确认，按代码路径】**
4. **但账本仍把每页 GraphQL 记成 1 条 rest 请求。** gh 客户端每发一条命令都记 requests:1，GraphQL 额外记 points:1；记账把 requests 记进 rest 桶，把 points 记进 graphql 桶。探测的闸又把 probe 映射到 rest 桶，所以探测页数会把本地 rest 桶的 used 推高；used 到 1225（rest 剩余 5000 时，插件额度 1750，写保底 525）附近，读类探测就会被判 reserve-kept-for-writes。**看账本的 rest.used 不能当成 GitHub REST 真实用量。**【已确认；到门槛的时间是推算】**
5. **探测扫描本身不过闸。** handleProbe 先做全仓扫描，只有 changed=true 之后才调 deltaRefresh；闸在 row-patch 里，只拦「补行」这一步，不拦前面的扫描。所以即使闸已经把探测判为推迟，下一次探测仍然会先扫一遍。**【已确认】**
6. **② 的旧「整工作区布尔锁」没了，但等效拒绝还在。** 旧 quota-sync 里「任一池 remaining=0 就把整个工作区标成限流到 reset」的代码现在已不在（src/refresh/registry/quota-sync-bridge.ts 文件头标注 #1443 改道）；refresh-gate 的 noteRetryAfter 仍会写 workspace.rateLimitedUntil，但全仓没有生产调用方，这条旧机制是睡着的。醒着的是 decideByBudget：两桶独立时逐桶看 remaining <= writeReserve(limit)，任一桶到写保底就拒掉这一笔；所有非 readBudget 的 deck 工具操作都走这条管线。**阈值不是 0，是 30% 的写保底；剩余 5000、额度 1750 时就是 525。**【已确认】

所以对维护者的问题，准确的回答不是「两个都没了」，也不是「两个都原样还在」，而是：**① 里由探测扫描产生的 REST 烧穿被改掉了，但探测需求侧的扇出与全仓翻页还在，成本换到了 GraphQL，并且仍通过本地记账耦合到 rest 桶；② 原样还在，而且探测自己就能把 rest 桶推到保底，从而触发 ②。**

## 二、探测需求：扇出与全仓扫描

### 2.1 客户端每一拍探全部记住的工作区

- probeNow 在 src/refresh/rooms/client/refresh-timer.ts:70。它先收 shared.cwd（:157），再遍历 Object.keys(stores) 取每个 store 的 cwd（:158-161），按 wsKeyOf 去重（:154-156），最后逐个 refreshGroup(cwd)（:196）；如果当前没有任何 cwd，还会用 sessionId 反查一轮，仍然对找到的每个 cwd 各发一次（:163-193）。**这是「按客户端记住的所有工作区扇出」的直接证据。**
- 自动定时器 startAutoProbe 在 :210-233：:218 用 setInterval(PROBE_MS) 排节拍，:221 在页签隐藏时直接 return，:222 调 probeNow(false)；另外 :225 监听 window focus、:229-231 监听 visibilitychange，各调一次 probeNow(true)。PROBE_MS 在 :64 取 SYNC.FALLBACK_PROBE_MS，配置值是 60000（config/intervals.yaml:40 的 syncFallbackProbeMs）。
- 活跃循环 startActiveProbeLoop 在 :241-289：:243 没有 _attentionPlan.intervalMs 就退出；:253-277 的 step 依次检查页签可见（:255）、宿主说当前在活跃集合里（:256）、当前 store 有 cwd（:257-259）、距上次探测不满一个间隔（:260-261），然后 :266 调 probeNow(false)，:286 用 timer.interval(step, _attentionPlan.intervalMs) 排节拍。活跃时是 5 秒、刚离开是 15 秒（config/intervals.yaml:17、:21；src/refresh/kernel/attention-model.ts:250、:216）。
- 两个定时器**同时存在**，没有互斥：startAutoProbe 只看 shared._probeTimer（:211），不看 shared._activeTimer。所以活跃时除了 5 秒一拍，60 秒的自动拍也会继续，60 秒边界附近可能两拍挨着发生。
- 这段代码上方 :234-239 的注释说「只探我这个会话正在看的那个工作区根」「后台那些工作区一次都不探」，但 :266 调用的 probeNow 本身仍然遍历全部 cwd（:154-196）。**注释与实现相反**，读代码时不要被注释带偏。
- 自动探测由 src/refresh/rooms/client/probe-scope-selection.ts:194 在 _snapInstallBody 里调用，也就是每装一份快照就调一次；startAutoProbe 靠 shared._probeTimer 幂等，不会重复排。客户端闭包由 scripts/build.mts:571 把 refresh-timer.ts 拼成 probeAuto 片。**【已确认】**
- 「装快照」不只发生在打开右侧面板：输入区的状态栏也由插件客户端挂载（src/client/panel/panelAssembly.ts:124 把 statusbar 注册到 conversation.input.dock），挂载时 src/client/statusbar/StatusBar.ts:187-191 就调 runSnapshotRequestPlan(s, false, 'mount', snapFresh(s), loadSnapshot)；src/client/work-route-own.ts:191-197 的 snapshotRequestPlan 只要 !(hydrated && fresh) 就返回 load 计划（mount 传 hydrated=false），于是 loadSnapshot → _snapInstallBody → startAutoProbe。换目录（StatusBar.ts:195 的 switch 效果）、手动刷新、打开面板同样会装快照。**所以「没有打开右侧面板」不等于「没有探测定时器」：只要这个客户端装过任意一份快照，60 秒定时器就会在页签可见时持续跑。**【已确认，第二遍复核补充】
- probeNow(true)（焦点/可见性恢复）有 FOCUS_PROBE_MIN_MS 限流（:72-79），probeNow(false)（定时器/活跃循环）没有全局节流；refreshGroup 里也没有按时间跳过（:85-153），每一拍都会发 host.call('wf.probe', { cwd })（:87）。**【已确认】**

### 2.2 房间里的扫描不看活跃集合、不做仓库级去重、不带条件请求

- 入口 handleProbe 在 src/refresh/rooms/host/probe-handler.ts:46-132。:48-49 只挡空 cwd；:53 选后端；composer / markdown 路径在 :64 调 tracker.list(repoRef, {}, opCtx) 做全量列表，也没有节流；github 路径在 :92 调 fetchIssueIndexWindowed(cwd)，只有 changed=true 才在 :105 调 deltaRefresh(cwd, {})。
- handleProbe 没有「这个工作区现在在不在活跃集合」的检查，没有按仓库或工作区的并发/时间去重，也没有条件请求。lastProbeAtByRepo 只在 :77 / :97 被写入，随后作为回包的 since 字段回显；全仓没有任何地方比较它来做节流。**【已确认】**
- 索引扫描 scan 在 src/refresh/rooms/host/issue-index-scan.ts:78-101：每次调 d.fetchIssueIndex(cwd, w.sinceIso)（:92）；水印与基线按仓库键 owner/name 存（:82-89），但**没有 in-flight 去重**：两个 cwd 同时扫同一个仓库，会各自翻一遍。水印推进只发生在 commit（:99），而 handleProbe 只在没变（:99-102）或变化真的并进列表（:106-109、:116-118、:126-130）时提交；推迟/失败/丢弃时不动水印（:120-123）。
- 取数 fetchIssueIndex 在 src/refresh/rooms/host/issue-list-fetch.ts:146-185：每页 session.listPage(ref, {}, { limit: 200 }, ctx)（:157-160），INDEX_PAGE_LIMIT=200、INDEX_MAX_PAGES=100（:28-30）；since 只用来在内存里过滤 updatedAt >= since（:171-177），**不减少页数**；没有 If-None-Match / ETag。
- 列表页本身在 src/tracker/rooms/github/page.ts:120-209：:135-145 用 gh api graphql -f query=...，按 cursor 翻页；没有 REST 兜底，也没有 since 参数。**【已确认】**
- 变化时同一次探测会扫两遍：probe-handler.ts:92 先扫一次拿 changed，deltaRefresh 进 src/refresh/rooms/host/row-patch.ts:239 又调 d.probeIndex(cwd, win.sinceIso) 扫一次；只有没变化时是一遍。**【已确认】**
- 探测用的只读会话在 src/refresh/rooms/host/session-opener.ts:94-97 把裁决口写成 readAdmit，恒回 {allowed:true, reason:'read-path'}；:167 读会话用它，:169 仍然挂记账口；src/tracker/session/pipeline.ts:66-84 对 readBudget 直达，其余操作 :96 过 admit，这里就是恒真，:120 照常记账。**所以扫描「过了管线、但裁决恒放行」；不是没接闸，是接了一条永远开着的闸。**【已确认】
- probe-handler.ts:41-45 的注释仍写「1 次 REST 调用覆盖全仓库变化」「配额仍走 REST 5000/h 池」，与 :92 的 GraphQL 实现不符，是过期注释。**【已确认】**

## 三、成本到底记在哪一族

这一节是这次复核最重要的更正。票面说「烧穿 REST 配额」；今天要分「GitHub 实际 REST 计数」和「插件账本 rest 桶」两件事看，两者不是一回事。

1. 探测的索引扫描走 GraphQL：github/page.ts:135-145 的 gh api graphql；每页一次真实出站。
2. gh 客户端把每次出站记成 { requests: 1, points: isGraphql ? 1 : 0 }（src/tracker/rooms/github/client.ts:185-192）。GraphQL 也报 requests:1。
3. 房间操作表外层把这次操作的累计用量附到成功信封上（src/tracker/rooms/github/op-usage.ts:52-72），管线在 pipeline.ts:120 交给记账。
4. 记账按后端两桶口径分：requests > 0 记 rest 桶，points > 0 记 graphql 桶（src/refresh/kernel/backend-accounting.ts:67-90）。
5. 账本 spend 对 rest 桶记 requests、对 graphql 桶记 points（src/refresh/rooms/host/quota-ledger.ts:400-409）；b.used 是整桶共享的，不按 plugin / ai-tool 分（accounts 只分档计数，见 :411-416）。
6. 闸读账本：src/refresh/rooms/host/refresh-gate.ts:184-188 把 probe 映射到 rest 桶；admission-policy.ts:262-265 对读类操作在 quota.remaining <= quota.reserve 时回 reserve-kept-for-writes。quota-ledger.ts:365-383 的 view.remaining 是 lowerBound（:343-349）：min(allowance - used, reading.remaining - spentSinceSync)。

按当前算式推一遍（以 rest 服务端剩余 5000 为例）：

- allowance = min(5000 * 0.35, 1750) = 1750（src/refresh/kernel/host-budget.ts:160-163、:89-92）。
- reserve = writeReserve(allowance) = floor(1750 * 0.3) = 525（:171-173）。
- view.remaining = min(1750 - used, 5000 - spentSinceSync)；同步每 60 秒把 spentSinceSync 清零，但**不清 used**（quota-ledger.ts:427-450；used 只在整点 rollHour 清零，:255-260）。
- 所以 used 到 1225 时 remaining=525，探测（读类）被判推迟；used 到 1750 时 remaining=0。
- 每页 GraphQL 记 1 条 rest。按「2 个工作区、每 5 秒各 1 页」算，约 24 页/分钟，约 51 分钟到 1225；每工作区 2 页则约 48 页/分钟，约 25 分钟。**这是按代码算的推断，不是实测；实际页数随仓库大小变。**

关键在顺序：扫描发生在 probe-handler.ts:92，闸发生在 deltaRefresh 里的 row-patch.ts:230-233。所以一旦 rest 桶到保底，probe 被判 reserve-kept-for-writes，**被停的是「补行」这一步，不是前面的扫描**；下一拍仍然先扫一遍，used 继续涨。也就是说，闸没有把探测的成本关掉，它把探测的下游关掉了。**【已确认】**

这还带来一个反向耦合：deck 工具的 getCachedReading 也是从这本账读的（src/refresh/registry/deck-tool-bridge.ts:126-151），两桶读数里 limit 取的是 allowance（:147-148）。探测页数把 rest 桶的 used 推高，deck 工具下一次读到的 rest remaining 就更低；低到 525，decideByBudget 就把包括 GraphQL-only 在内的所有操作拒掉。**探测自己能把 deck 工具停掉，即使 GitHub REST 一点没花。** 这是 ① 与 ② 今天仍然连在一起的方式。

## 四、限流闸与 defer 文案

- 管线裁决在 src/refresh/kernel/budget-admission.ts:111-148。两桶独立口径时，:141-146 遍历 bucketLevelsOf(reading) 的两个桶，任一 level.remaining <= limits.writeReserve(level.limit) 就回：
  { allowed:false, kind:'rate-limit', reason:'exhausted', message:'额度的一个桶已经见底，这次先不执行。' }
  这里没有「这次操作只花 REST 还是只花 GraphQL」的输入，所以无法只拦依赖耗尽那一族的操作。**阈值是 writeReserve(level.limit)，不是 0；level.limit 在 deck 工具这条路上是账本的 allowance（1750），所以写保底是 525。**
- 管线在 src/tracker/session/pipeline.ts:56-126：readBudget 在 :66-84 直达、不裁决；其余操作 :87 读缓存读数，:96 调 admit，:102-109 只要 allowed !== true 就回 pipelineFail（沿用裁决的 kind / message）。**所以每笔非 readBudget 的 deck 工具操作都过这道两桶裁决，包括只需 GraphQL 的写入。**
- 兜底裁决 fallbackAdmit 在 src/deck/tools/tracker-session.ts:74-94，同样按两桶循环、同样用 writeReserve(limit)，文案同为「额度的一个桶已经见底，这次先不执行。」（:90-92）。
- 工具入口还有一道只看单桶的预检：src/deck/tools/tracker-session.ts:149 对两桶后端固定取 graphql（bucketFor），:161 先拿一次 1 请求的探针、:165 再按估算量调 gate.admitAiTool；src/refresh/rooms/host/refresh-gate.ts:519-534 的 admitAiTool 只按 req.bucket 选一桶（slotOf 在 :279-293），只把这一桶喂给 aiToolAdmission。**预检看 graphql 一桶，管线裁决看两桶，两处口径不一致；预检放过了，管线仍可能拒。**
- 旧「整工作区布尔锁」的现状：refresh-gate.ts:490-503 的 noteRetryAfter 仍会写 wsState(r.workspaceKey).rateLimitedUntil，但全仓 grep 只命中定义（:490）与导出（:556），没有生产调用方（只有 tests/verify-gate-accounting.ts:132 这类测试）。admission-policy.ts:250-252 的 workspace.rateLimited 分支因此是睡着的。src/refresh/registry/quota-sync-bridge.ts:95-139 现在只把读数经 readBudget 同步进账本，没有「remaining=0 标整个工作区」的代码；文件头标注 #1443 改道，旧代码现在已不在。**【已确认】**
- 文案：decideByBudget 的固定句只说了「一个桶」，没有说是 REST 还是 GraphQL，也没有说何时恢复；refresh-gate 的 detail 取 admission-policy.ts:139-157 的原因句（例如 reserve-kept-for-writes 对应「读的额度已用完，只剩给写留的保底：读让路，写保住」），同样没有桶名与恢复时刻。**不满足「准确写出哪个族、何时恢复」。**

## 五、对 #1418 验收标准的逐条对照

| 验收标准 | 结论 | 证据与说明 |
|---|---|---|
| 多仓库、多并行会话、面板开着连续 2 小时，REST 用量 ≤ 限额 60% | **探测这条路径：不再产生 REST；全仓 2 小时总量：未核实；插件账本 rest 桶：不成立。** | 索引扫描已改走 GraphQL（github/page.ts:135-145），这条路径不再产生 REST 调用；但每页 GraphQL 仍记 1 条 rest（client.ts:185-192、backend-accounting.ts:81-85），会把本地 rest 桶推到 525 保底；快照等其它路径的 REST 用量这次没有逐条统计，也没有跑 2 小时真机 soak。 |
| 没有面板打开时探测请求为 0（或每分钟 ≤1 次） | **不成立（按代码路径不能保证）。** | 探测定时器确实由「装快照」启动（probe-scope-selection.ts:194），但装快照不只发生在打开右侧面板：状态栏注册在输入区（panelAssembly.ts:124），挂载即可能 loadSnapshot（StatusBar.ts:187-191；work-route-own.ts:191-197 在 !(hydrated&&fresh) 时给 load 计划），换目录、手动刷新、打开面板也会装。装过一次之后，60 秒定时器在页签可见时就持续跑（refresh-timer.ts:221 只判隐藏）；只有「这个客户端从未装过任何快照」才可能是 0。多工作区时每拍还会扇出多份。未真机 soak。 |
| 面板可见、有变化时探测延迟 ≤ 现在的 5 秒档 | **成立，但代价是每拍探全部记住的工作区。** | 活跃循环 5 秒（refresh-timer.ts:253-266、:286；config/intervals.yaml:17），但 :266 调用的 probeNow 遍历全部 cwd（:154-196）。 |
| 人为把 REST 配额打到 0：只需要 GraphQL 的操作仍成功 | **不成立。** | budget-admission.ts:141-146 两桶循环，任一桶 remaining <= writeReserve 就拒；REST 0 必然拒掉所有非 readBudget 操作。而且阈值是 525，不是 0。 |
| defer 文案准确写出哪个族、何时恢复，不再提二级限流 Retry-After | **不成立。** | budget-admission.ts:144 固定句；admission-policy.ts:139-157 的原因句也没有桶名/时刻。 |
| 同一仓库多个工作区只扫一次 | **不成立；只对「同一个工作区根下的多个会话」成立。** | refresh-timer.ts:154-162 只按 wsKeyOf（工作区根）去重；不同根（不同 clone / worktree）各扫各的。扫描层 issue-index-scan.ts:78-101 没有 in-flight 去重，水印按 owner/name 存也不减少页数（issue-list-fetch.ts:146-185）。 |
| 连续无变化时条件请求 304 路径生效 | **不成立（探测链路）。** | fetchIssueIndex 没有 If-None-Match / ETag（issue-list-fetch.ts:146-185）；304 只出现在快照取数与缓存回放（src/host/tracker/snapshot.ts、src/refresh/rooms/host/session-snapshot-cache.ts、src/refresh/rooms/client/snapshot-sync.ts 等）。 |
| 日志能看出每族预算、探测被节流或暂停的原因 | **部分成立。** | refresh.decide 记 category / kind / verdict / reason / tier / keyHash（refresh-gate.ts:352）；refresh.patch 记 mode / reason / watermark / pending（row-patch.ts:104）；probe.loop 记 intervalMs / visible（refresh-timer.ts:287）；quota.spend 有 bucket / remaining（quota-ledger.ts:418）。但裁决与补行日志没有 rest/graphql 桶字段与 remaining / reserve，也没有「这一拍为什么没探某个工作区」的逐工作区记录；只看日志仍难把「哪个族不够、何时恢复」说全。 |
| 相关 verify-log-* 门禁通过 | **未跑。** | 诊断不改代码，门禁留给实施票。 |

## 六、这次没有做的事

- 没有启动插件跑 2 小时真机 soak，所以「每小时实际多少次」「多少页」没有重新量；第三节的时间数字是按代码算式推的，不是实测。
- 没有跑 tests/verify-* 门禁；建议实施票至少跑 verify-1443-github-readbudget、verify-1446-backend-ledger、verify-gate-accounting、verify-attention-model。
- 没有改任何业务代码、issue 标签或 issue 评论；除本文件外没有动仓库文件。

## 七、来源

- 票 #1418 正文与维护者原话（2026-10-23T02:18、02:48）。
- src/refresh/rooms/client/refresh-timer.ts、probe-scope-selection.ts、client-attention-heartbeat.ts、snapshot-cache-store.ts
- src/refresh/rooms/host/probe-handler.ts、issue-list-fetch.ts、issue-index-scan.ts、row-patch.ts、session-opener.ts、refresh-runtime.ts、quota-ledger.ts、refresh-gate.ts
- src/refresh/kernel/budget-admission.ts、admission-policy.ts、host-budget.ts、backend-accounting.ts
- src/refresh/registry/deck-tool-bridge.ts、quota-sync-bridge.ts
- src/tracker/session/pipeline.ts、open-tracker.ts、src/tracker/rooms/github/page.ts、client.ts、op-usage.ts、src/tracker/contract/budget-model.ts
- src/deck/tools/tracker-session.ts
- scripts/build.mts、config/intervals.yaml
- docs/adr/20260924-refresh-budget-architecture.md
- git log --all --grep=1418（无提交）、git status -sb（main 448a2869，工作区有别的会话未提交改动）

## 八、2026-10-24 20:00–20:30 真机复核（修正上一节第 4 条的当下适用性）

**这一段来自运行中的安装版，不是静态读码**：安装目录 C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck，版本 1.9.0-beta.15，构建时间 16:15；其 refresh/tracker 产物与 origin/main 2ece732c 一致（git diff origin/main..HEAD -- src/refresh src/tracker 为空），所以下面的现象就是最新代码的现场。

**新发现：探测从 16:15 部署起 100% 失败，一次都没成功。** 插件日志 .dsh-mattskillsdeck-cache/logs/2026-10-24.log 里，最后一条旧 REST 翻页 api:--paginate 在 16:14:47；16:15:19 起出现 listPage.gql，之后 6,282 条 network 失败、141 条 rate-limit、**ok=0**；read.degraded op=listPage reason=listPage:transport 6,386 次，host.call.fail method=wf.probe 5,919 次。逐小时失败数：16 点 1,263、17 点 1,125、18 点 1,415、19 点 2,133、20 点到 22 分 487。活跃探测每 5 秒一拍、每个记住的工作区各一次（本次 2 个），所以每分钟约 20–22 次 listPage，全部失败。

**根因：请求页大小超过了 GitHub GraphQL 的硬上限。** 索引扫描写死 INDEX_PAGE_LIMIT = 200（src/refresh/rooms/host/issue-list-fetch.ts:29、:157），能力层 limitMax: 200（src/tracker/contract/pagination.ts:34），limitOf 原样拼进 -F first=200（src/tracker/rooms/github/page.ts:50、:130-145），没有任何地方夹到 100。用 gh 实测：issues(first: 200) 报 Requesting 200 records on the issues connection exceeds the first limit of 100 records.（EXCESSIVE_PAGINATION，gh 退出码 1）；改成 first: 100 成功，totalCount=1419、hasNext=true、rateLimit.cost=2。日志把它归成 network（gh 退出码 1 → transport），所以只看日志会误以为是网络抖动。

**修正上一节第 4 条：现在探测并没有推高本地 rest 桶。** 记账只在操作成功时带上 usage（src/tracker/rooms/github/op-usage.ts:52-75；src/refresh/kernel/backend-accounting.ts:52-60 对 ok:false 返回 null），失败这一笔不记账。20:25 附近本地 rest 桶 remaining 1484–1530（额度 1750，used≈220–266），最近 45 分钟 refresh.decide 全是 allow，没有 deny/deferred。也就是说：探测坏着，所以 deck 工具暂时没被它停。

**实时配额（两次采样，用户在此期间没有操作 gh）**：30.6 秒窗口 graphql.used +28（≈55 点/分），core.used +4（≈7.8 次/分）；窗口内 gh 调用是 14 次失败的 listPage、4 次成功的 list、1 次 list.pr、6 次 preflight REST。另一段 153 秒窗口 graphql +101（≈40 点/分）。结论：GitHub REST 不再被探测烧（这是重构真正改掉的），但探测仍在烧 GraphQL 点数，且产出为零。

**如果只把 200 改成 100，会立刻放大成两个新事故**（推算，不是实测）：一次全仓扫描 1419 条按 100/页 = 15 页；每次探测 2 个工作区、活跃时 12 拍/分 → 360 页/分。每页被客户端记成 1 条 requests（src/tracker/rooms/github/client.ts:185-198：args[0] 是 api 不是 graphql，所以 isGraphql=false、points=0），这 360 条/分全进本地 rest 桶；按 rest 额度 1750、写保底 525 的口径，used 到 1225 就拒，约 3.4 分钟 deck 工具全停。同一条链上 GraphQL 真实消耗约 15 页 × 2 点 × 24 次/分 = 720 点/分，约 7 分钟烧完 5000/小时。**所以 200→100 只是把「探测全失败」换成「探测成功但很快同时烧穿两本账」，必须和探测范围收敛、按族准入一起改。**

**对票面验收的影响**：第①条（2 小时 REST≤60%）因为探测根本不发 REST，现在「低」得没有意义；第②条（无面板探测为 0）仍不成立；第③条（REST=0 时 GraphQL 操作仍成功）仍不成立；第④条（同仓库多工作区只扫一次）仍不成立；第⑤条（日志能看出节流原因）仍不成立，而且现在多了失败刷屏。另新增一个 P0 回归：最新构建的自动探测完全失效。

**来源**：安装版产物与源码行号；运行日志 2026-10-24.log；gh api graphql 实测（first=200 失败 / first=100 成功）；gh api rate_limit 两次采样；gh issue view 1418（票面验收）。

## 九、2026-10-24 20:40 交接文件并入与票面拍板

**交接文件**：`D:/Temp/handoff-2026-10-24-probe-index-first-limit.md`（96 行，20:30 写）。一句话结论：探测把全量票索引每页设成 200，超过 GitHub issues 连接的 first 上限 100，每次 wf.probe 都被 EXCESSIVE_PAGINATION 回绝；回绝被判成 network，界面不显示失败，面板停在上次快照。它与第八节的实测互相印证；交接文件按代码根因说「不是同一个 bug」，按功能（刷新不可用）与 #1418 是同一个问题，维护者要求并入本票。

**并入时更正的一处适用性**：第八节第 4 条说「探测推高本地 rest 桶」在当下不成立——失败不记账；deck 工具暂时没停是因为探测没花钱。若修好页大小，这条会立刻重新成立（见第八节 200→100 推算）。

**票面已改（#1418）**：正文加入维护者原话（功能验收：刷新正常 + GitHub 后端正常；技术细节由 AI 决定）；替换旧的「待拍板 Q1–Q3」为拍板结果与 P0/P1 实施顺序；进度加一条；评论一条 Triage Notes；标签 `bug` + `ready-for-agent`（移除 `needs-info`）。拍板：Q1=B、Q2=不拆票（P0/P1 两段）、Q3=记账口径放 P1。

**P0 的最小范围**：页大小 200→100 与 page.ts 夹取、EXCESSIVE_PAGINATION 判档、失败 stderr 落日志、扫描改增量并把稳态成本写进进度、失败可见、门禁。验收按功能三条（刷新 / GitHub 后端 / 限流），不是「代码改完就算」。

**来源**：交接文件；gh issue view/edit 1418 前后正文与标签；deck_issue_report 回执。


