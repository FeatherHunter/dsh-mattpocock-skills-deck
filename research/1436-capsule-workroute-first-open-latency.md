# #1436 调研：打开会话时胶囊状态栏的工作路线入口为什么要等一阵才出现

> 票 #1436 · 只读调研，不改生产代码 · 落盘日期 2026-10-23
> 建单基线 06dea898（分支 main）；本轮复核基线 b322e6d8（分支 main）。#1419「刷新机制重构整批合入主分支：四处散落文件并入 src/refresh，零语义变化」把客户端九份刷新源码搬进 src/refresh/rooms/client/（迁移提交 3ceef916）、宿主源码搬进 src/refresh/rooms/host/；本文路径与行号统一按 b322e6d8。整文件搬运的偏移是可核对的：probe-snapshot.ts、probe-select.ts、probe-stale.ts 行号不变，store-snapshot.ts 因文件头多一行整体 +1，probe-auto.ts 整体 +2。工作树另有与本票无关的未提交改动，未触碰。
> 数据来源：本仓 src/、config/ttl.yaml、真机日志 C:/Users/辰辰洋洋/.dsh/profiles/desktop/.dsh-mattskillsdeck-cache/logs/2026-10-23.log（只读；本轮采样时间 17:25，文件 106,225,997 字节 / 631,843 行；建单时另有一轮 17:30 前后的采样）、票 #1436 正文、相关票 #1355 / #1358 / #1373 / #1395 的正文与评论，以及 research/1009-recheck-2026-10-21.md、research/1395-capsule-workroute-entry-missing.md。

## 一、结论

**一句话：不是渲染慢，也不是工作路线数据丢了；是在「plan 那一刻内存里已经有一份同工作区、被 #1355 剥掉表的缓存快照」这个温启动现场，缺表判据把一次补表请求翻译成了整份快照的强制重建。** 客户端水合缓存时剥表（src/refresh/rooms/client/snapshot-cache-store.ts:122-129、:234-246）；四道闸都过时，snapshotRequestPlan 第一条返回 force（src/refresh/rooms/client/snapshot-cache-store.ts:134-140、src/client/kernel/work-route-own.ts:68-75）；loadSnapshot 于是选 wf.refresh（src/refresh/rooms/client/snapshot-sync.ts:213-216）；宿主这一趟先 resetGhCache，再绕过内存与磁盘缓存、强制重跑列表/计数/仓库根/当前用户（src/refresh/rooms/host/session-refresh-schedule.ts:83-86、:114、:130、:296；src/host/tracker/snapshot.ts:112-132、:191），重建完才挂本会话的表（src/host/snapshotEnvelope.ts:125-135）。表回来之前，胶囊对 idle 判据整段不画（src/client/statusbar/SessionChainCapsule.ts:176-193、:382），所以用户看到的是空白，而不是加载中。

本机今天的强制刷新回包中位约 **24.8–25.1 秒**（两轮采样分别 408 条 / 306 条），p90 约 28.7 秒，最大 30,363 毫秒，贴住客户端 30,000 毫秒死线；同一份日志里非强制 wf.snapshot 的中位约 0.95 秒。也就是说，**首帧选错电话，代价从亚秒级变成二十多秒**。但这条链有明确边界：冷启动内存里没有快照时，plan 走非强制 wf.snapshot；GitHub 分支也不会把 304 透传给客户端。这两点决定了它不是「任何首帧」都必然如此；把结论写成「必然」会过度。反过来，冷启动虽然不是强制链，但宿主若既无内存也无磁盘缓存，wf.snapshot 仍会整份重建；本机 wf.snapshot 的 p99 约 25.4 秒，所以「要等一阵」不能全部归给 wf.refresh，具体是哪条电话要用 Q5 的标识去分。

| 层次 | 源码事实 | 一手位置 |
|---|---|---|
| 胶囊判据 | 表缺 → workRouteTableOf 回 idle → 胶囊组件 return null，整段不画、不留占位 | src/client/views/shared/workRouteTable.ts:147-182；src/client/statusbar/SessionChainCapsule.ts:176-193、:382 |
| 缓存水合 | 落缓存、水合都剥掉 workRouteTable；正常缓存条目永远无表 | src/refresh/rooms/client/snapshot-cache-store.ts:122-129、:234-246、:261-266 |
| 缺表补拉 | 只看「表缺不缺」；四道闸都过就强制，排在「已水合且 60 秒新鲜」早退之前 | src/refresh/rooms/client/snapshot-cache-store.ts:134-140；src/client/kernel/work-route-own.ts:68-75 |
| 请求选择 | force → wf.refresh；非 force → wf.snapshot | src/refresh/rooms/client/snapshot-sync.ts:213-216 |
| 宿主刷新 | 真正执行的那一趟 resetGhCache，composeSnapshot 传 force:true，绕过缓存重建整份快照，之后才挂表 | src/refresh/rooms/host/session-refresh-schedule.ts:83-86、:114、:130、:296；src/host/tracker/snapshot.ts:112-132、:191 |
| 等待与超时 | 客户端最多等 30 秒；超时后置 snapMode=err、snapPending=true，迟到回包仍整份落地 | src/refresh/rooms/client/snapshot-sync.ts:218-229、:288-311；config/ttl.yaml:82 |
| 对照路 | 非强制 wf.snapshot 命中缓存时立即回缓存对象，随后仍现挂本会话表 | src/refresh/rooms/host/session-snapshot-cache.ts:91-94、:119-131 |

本轮复核对建单时结论的收窄与纠正（票面已同步）：

1. 建单时写的「SessionChainCapsule.ts:273 return null」行号不对。return null 在 src/client/statusbar/SessionChainCapsule.ts:382；:273 是 chainMapIconOf。
2. 建单时写的「hydrateFromCache :225-246」只覆盖到剥表那一段。整个水合函数是 src/refresh/rooms/client/snapshot-cache-store.ts:226-314，剥表在 :234-246。
3. 「首帧必然有快照没表」只在「plan 时内存 LRU 里已有同工作区快照」（温启动）时成立；冷启动没有内存快照，plan 走非强制 wf.snapshot，但宿主也没有缓存时仍可能整份重建。
4. 304 不是 GitHub 现场的风险。GitHub 分支即使收到 tracker 的 304，也会用回包里的 snapshot 重建完整信封再返回 200；只有 composer/Markdown 分支会把 304 直接交给客户端，而那个 304 对象没有 workspaceRoot（见 Q3）。
5. 建单时引用的 src/host/sessionRefresh.ts、src/host/sessionSnapshot.ts 已随 #1419 搬进 src/refresh/rooms/host/（session-refresh-schedule.ts、session-snapshot-cache.ts），旧路径不再存在；本文统一引用 canonical 路径，行号按 b322e6d8 复核。

「干脆不出现」至少有三条可解释的走向，本单只对上了第一条的时间账，另外两条需要另查：(a) 30 秒后没有迟到回包或回包失败；(b) 回包按「工作区换走 / 后端换过 / 不是最新一次」被丢掉（src/refresh/rooms/client/snapshot-sync.ts:242-257）；(c) 表回来了但按本会话号过滤后一行不剩，判 empty 同样整段不画（src/client/statusbar/SessionChainCapsule.ts:185-188），这一支与 #1395 同源。

## 二、逐条回答

### Q1. 十秒到几十秒到底花在哪

**【已确认】wf.refresh 一次真正执行的固定动作。** refreshOf 先规范化工作区、selectEarly、记 panelSync.dirty，再按工作区键做在途去重（强制只搭强制的车），然后 refreshBuild：开头 resetGhCache（src/refresh/rooms/host/session-refresh-schedule.ts:114），composer 分支与 GitHub 分支都调 composeSnapshot(..., {force:true})（:130、:296）。composeSnapshot 在 force 下跳过 tracker 的内存 LRU 与 5 秒新鲜期（src/host/tracker/snapshot.ts:119-130、:191），走 tracker.list（GraphQL 分页 + REST 兜底）、countsFromBackend、assembleSnapshot、deriveDeck（:142-166）；刷新路还多 getRepoRoot、getCurrentUser、buildSnap、writeDiskCache、adoptSnapLog（src/refresh/rooms/host/session-refresh-schedule.ts:337-367）。重建完成后，handleRefresh 才调 withWorkRouteTable 现读工作路线存档（:83-86）。

**【已确认】本机这笔账。** 本轮 17:25 采样，wf.refresh 成功且 latencyMs>0 共 408 条，p50 24,750、p75 27,068、p90 28,727、p99 30,296、最大 30,363 毫秒；建单时另一轮采样（reason=work-route-missing 的真实回包）306 条，中位 25,146、p90 28,769 毫秒。两轮过滤口径不同，不追求逐位一致，但都落在 25 秒上下。同一份日志里 wf.snapshot 成功且 latencyMs>0 共 353 条，p50 951、p90 5,364、p99 25,439、最大 29,580 毫秒——便宜是常见情形，不是保证。

| 采样 | 过滤 | n | p50 | p90 | 最大 |
|---|---|---|---|---|---|
| 本轮 17:25 | wf.refresh 成功且 latencyMs>0 | 408 | 24,750 | 28,727 | 30,363 |
| 建单时 | reason=work-route-missing 真实回包 | 306 | 25,146 | 28,769 | 30,363 |
| 本轮 17:25 | wf.snapshot 成功且 latencyMs>0 | 353 | 951 | 5,364 | 29,580 |

**【已确认】时间在外部调用与排队，不在快照组装。** 本轮抽了 41 个可对齐的慢 refresh 窗口：窗口内 gh.exec 条数 p50=34、p90=171、最大 257；第一条事件距 start 的延迟 p50=171 毫秒、p90=828 毫秒；snapshot.built 自身 p50=226 毫秒、p99=626 毫秒。一个 26 秒的现场（trace 1f6478fbc4673756，08:58:20.398→08:58:46.467）窗口内只有 8 条 gh.exec api:--paginate（每条 0.7–1.1 秒）、若干 exec.run、一条 snapshot.built latencyMs=273；另一个 27,019 毫秒的窗口开始后 18.8 秒没有任何该文件的日志行，随后 8 条 gh.exec 约 8 秒。**这说明几十秒主要花在几十到上百次 gh 外部调用上，外加排队/主线程等待；不是渲染，也不是组装。** 注意 gh.exec 一条 api:--paginate 可能翻多页，按条数会低估 HTTP 往返；今天还有 issues.fallback 18,514 条，REST 兜底被大量使用。

**【推断】18.8 秒空档不能全算成「建快照」。** 它更像多会话并发时在 gh 车道或主线程上排队：今天 gh.lane.saturated 4,548 行、gh.timeout 1,159 行，说明车道经常满。现有日志没有 resetGhCache 的起止行，也没有「这一趟在等车道」的单行，所以只能把「外部调用 + 排队」作为一个整体说，不能把 25 秒逐项拆开。

**【已确认】research/1009 的 29,278 毫秒要照原样引用。** 该笔记 :24 写的是：2026-10-10 17:49:18 实测一次快照 29,278 毫秒，客户端死线 30,000 毫秒（host.call method=wf.snapshot latencyMs=29278）；2026-09-24 的现场（52 张地图、950 张票、9.7 MB 磁盘快照）第一次重建要几分钟。这是 **wf.snapshot 冷重建的一次实测**，不是 wf.refresh，也不能外推成普遍值；它能说明「整份重建可以贴到 30 秒死线」，不能单独证明本单的每一次等待。

**【已确认】能不能从日志区分缓存命中与强制重建：能，但要跨事件拼。**

| 想看什么 | 现有事件 | 能回答 | 缺口 |
|---|---|---|---|
| 这次是哪条电话、等了多久 | 客户端 host.call（成功行 method / latencyMs / kind / reason） | 单会话、时间窗清楚时能 | 不带 cwdHash/sidHash；失败行没有 latencyMs |
| 这次是不是强制 | host.call.reason=work-route-missing；宿主 panelSync.dirty；tracker 的 snapshot.cache.miss reason=force | 能互相印证 | 没有一条行同时带「会话 + 强制 + 耗时」 |
| 宿主是命中还是重建 | snapshot.request.force（仅 wf.snapshot 路）、snapshot.built（仅非 fromCache） | 能区分大部分 | snapshot.built 不带会话/force，wf.refresh 不发 snapshot.request |
| 胶囊当时是什么态 | statusbar.fallback（六档 reason + tableRows/ownRows） | 能看 idle/empty/unreadable 的形状变化 | 只在形状变化时记，没有 pending/force/等待时长 |

最小的判定法：单会话窗口里，先找 statusbar.fallback reason=work-route-idle，再找同一时刻的 host.call method=wf.refresh、reason=work-route-missing、latencyMs 二十多秒，基本就能对上；如果 method=wf.snapshot、latencyMs 亚秒级、又没有 snapshot.built，则更像缓存命中。**多会话并发时不要靠时间窗猜**，因为 host.call 没有会话散列，snapshot.built 也没有会话号。

### Q2. 为什么首帧会走 wf.refresh；是不是非它不可

**【已确认】四道闸在水合后的值。** snapNeedsOwnWorkRoute 要求 st.sessionId、st.snapshot、snapLoading!==true、selPending!==true，最后才看 st.snapshot.workRouteTable 是否 undefined/null（src/refresh/rooms/client/snapshot-cache-store.ts:134-140）。

| 闸 | 温启动（内存 LRU 已有同工作区快照） | 冷启动（内存 LRU 空） |
|---|---|---|
| st.sessionId | 有：storeOf 创建 store 时写入（src/refresh/rooms/client/snapshot-cache-store.ts:393） | 有 |
| st.snapshot | 有：storeOf 里 hydrateFromCache 同步装上（:398、:261-266）；cwd 晚到时由 apply 在 :167 水合 | 没有；磁盘水合要等 loadSnapshot 里 :180-194 才发生 |
| snapLoading | false；水合会置 false（:265） | false |
| selPending | false；只有 loadSnapshot 在无 selection 时置 true（src/refresh/rooms/client/snapshot-sync.ts:155） | false |
| workRouteTable | undefined：缓存条目被剥过（:127、:234-246） | 没有快照，判据直接 false |

所以温启动四道闸全过 → snapshotRequestPlan 第一条返回 {force:true, silent:true, why:'work-route-missing'}（src/client/kernel/work-route-own.ts:70）；冷启动因为 st.snapshot 为空，走到 :73 的 {force:false, silent:true}，发的是 wf.snapshot。**「首帧非走 wf.refresh 不可」这个说法过强；准确说法是「plan 时手上已有一份无表缓存快照，缺表首帧会走 wf.refresh」。** 票面断言 3 的代码事实成立，但适用范围要加这个前提。

**【已确认】有没有「有缓存快照但表没被剥」的入口。** 正常客户端缓存路径没有：setCachedSnapshot 在落缓存前 delete workRouteTable（src/refresh/rooms/client/snapshot-cache-store.ts:122-129）；hydrateFromCache 对老条目再剥一次（:234-246）；磁盘条目回放前也走 setCachedSnapshot（src/refresh/rooms/client/snapshot-sync.ts:185）。但 **st.snapshot 不是缓存条目**：一次 200 正文安装会 st.snapshot = snap（src/refresh/rooms/client/probe-scope-selection.ts:163），表留在这个会话手上；setCachedSnapshot 只剥缓存副本（:182）。所以同一 store 切走再切回不会重新缺表；新建 store 或重启后重新水合，才会又看到无表快照。

**【已确认】「同一份快照只补一次」在首帧不生效。** _workRoutePulledFor 只在 ensureOwnWorkRoute 里读写（src/client/kernel/work-route-own.ts:29-35）；StatusBar 走的是 runSnapshotRequestPlan → loadSnapshot，从不调用 ensureOwnWorkRoute。ensureOwnWorkRoute 的调用点只在 src/refresh/rooms/client/refresh-timer.ts（:139、:142、:365）。所以首帧没有这层按快照对象的去重；真正挡住重复请求的是 snapLoading、switch 的早退和 probe-stale 的在途复用。

**【已确认】首挂时三个 effect 的实际顺序与去重。** React 按声明顺序执行：apply（src/client/statusbar/StatusBar.ts:162）→ mount（:184）→ switch（:192）→ logStatusFallback（:195）。apply 只在 cwd && cwd!==s.cwd 时整段跑（:164）；首挂通常 summaryCwd 与 store 的 cwd 相等，apply 是 no-op。mount 调 runSnapshotRequestPlan(s, false, 'mount', ...)，注意第二个参数固定传 false，所以即使表在、快照新鲜，mount 也会发一次非强制静默刷新；缺表时则发强制。温启动有缓存时，loadSnapshot 会一路走到 :199 同步置 snapLoading=true；随后 switch 的计划看到 snapLoading=true、mode=switch，直接在 :71 返回 null。冷启动要先在 :182 await 磁盘，若 switch 在 await 期间跑，看到的是 snapLoading=false，但此时 st.snapshot 仍为空，缺表分支不成立，switch 同样返回 null。若 apply 先发了强制请求，mount 的计划因 snapLoading 走非强制，但 probe-stale 允许同会话非强制搭强制的车（src/refresh/rooms/client/staleness-indicator.ts:73-76），不会多发一次网络。结论：首帧通常只有一条请求；去重靠 snapLoading + switch 早退 + 在途复用，不靠 _workRoutePulledFor。

**【推断】真实使用中温启动占多数。** 日志没有标「这次 plan 是冷还是温」，但从 work-route-missing 一天 663 次、wf.refresh 成功 408 条看，温启动（同进程里别的视图/会话已经把同工作区快照放进内存 LRU）并不少见；冷启动的比例需要新增一条标记才能统计。

### Q3. 如果把缺表补拉改成非强制 wf.snapshot，会发生什么

**先给结论：内存命中时它会很快回包，并且回包带本会话表；磁盘回放要看 cacheSnapshotIsCurrent 是否要全仓库扫描；GitHub 现场不会碰到 304 丢表；composer 的 304 有一个真实的 workspaceRoot 缺口；在途去重和 #1358 的共享对象是剩余风险；#1355 的缓存隔离不被破坏。**

**【已确认】内存命中：立即回包，回包带表。** 非强制 wf.snapshot 命中宿主内存缓存时，snapshotOf 在 :119-131 直接 return shortCircuit()（GitHub 非 composer 分支 :125-127 没有年龄门槛），handleSnapshot 在 :94 随后调 attachWorkRouteTable，按 args.sessionId 现读表挂到回包上。回包带 workspaceRoot（缓存对象是 buildSnap 产出的），所以读数找得到根。客户端 _snapInstallBody 把整份（含表）装进 st.snapshot（src/refresh/rooms/client/probe-scope-selection.ts:163），setCachedSnapshot 只把无表副本写缓存（:182）。**「命中即回、且带本会话表」成立。** 本机日志里 wf.snapshot 的中位约 0.95 秒；命中路径本身不需要网络，但仍要 await selectEarly 与 readSetupLayoutOf（src/refresh/rooms/host/session-snapshot-cache.ts:99-100），并按会话读一次存档，不是零成本。

**【已确认】磁盘回放：可能便宜，也可能先扫几秒。** 宿主内存空时走 :316-320：readDiskCache 命中且 selection 一致，再 await cacheSnapshotIsCurrent；后者可能做一次全仓库扫描（:126 注释说约 4-5 秒），通过才 fromCache 回包并挂表，不通过才重建。**所以非强制不是永远便宜，但通常省掉 resetGhCache 与强制翻页；最坏情况仍可能接近一次重建。** 如果内存与磁盘都没有可用缓存，非强制也会走一次完整 compose，等待与强制同量级；它省掉的是清缓存与强制翻页，不是所有场景的抓取。

**【已确认】304 的真实归属：GitHub 不透传，composer 有缺口。** GitHub 分支即使 composeSnapshot 返回 notModified，也会用 res2.snapshot 继续走 :327，再用 buildSnap 重建完整信封（含 workspaceRoot）并 writeDiskCache，最后返回 200 形态（src/refresh/rooms/host/session-snapshot-cache.ts:325-327、:384-391）。tracker 的 304 自带 snapshot（src/host/tracker/snapshot.ts:123、:191），所以这条重建有数据可用。**#1373 修的那个客户端 304 分支，对 GitHub 现场不可达。**

composer/Markdown 分支不同：它的 304 回包只有 ok/notModified/status/version/cached/generatedMs + selection/rev/setupLayout，**没有 workspaceRoot**（src/refresh/rooms/host/session-snapshot-cache.ts:163-166）。经过 withWorkRouteTable 时，readout 在 src/refresh/rooms/host/work-route-readout.ts:96-97 找不到根，会挂 {ok:false, reason:'host.work-route.no-workspace'}。客户端 304 分支调 adoptWorkRouteTableIfNewer（src/refresh/rooms/client/snapshot-sync.ts:267）；本地缺表时它无条件收（src/client/kernel/work-route-own.ts:49-51），于是表变成失败对象，workRouteTableOf 在 :152 判 unreadable，胶囊画 11px 小图标，而且 snapNeedsOwnWorkRoute 因为「表已存在」不再补拉。**这不是「旧表被丢」，而是「缺表时收下一个坏表、之后不再重试」；它只在 composer/Markdown 工作区可达，与本单 GitHub 现场无关，但候选 a 若上线，必须一并修信封或让 adopt 拒收非 ok 的来者。**

#1373 的测试 tests/verify-1373-stale-table-graft.ts:240 直接用 {notModified:true, workRouteTable:fresh} 伪造回包，绕过了 withWorkRouteTable，所以它覆盖的是 adopt 规则，不是宿主信封；这一点在候选 a 的测试设计里要补上。

**【已确认】客户端会不会把表剥掉、st.snapshot 还留不留表。** 200 正文安装：st.snapshot = snap（含表），setCachedSnapshot 剥的是缓存副本（src/refresh/rooms/client/probe-scope-selection.ts:163、:182）。304：不替换正文，只调 adoptWorkRouteTableIfNewer，把来者挂到 st.snapshot 的浅拷贝上（src/client/kernel/work-route-own.ts:50、:61）；来者是坏对象时也照挂。水合：剥表后装进 st.snapshot（src/refresh/rooms/client/snapshot-cache-store.ts:234-246、:263）。所以「st.snapshot 上有没有表」取决于最后一步是哪条路，不能一概而论。

**【已确认】在途去重：非强制能搭强制车，但可能白等。** 客户端 _snapReuseInFlight 对 force=false 的请求，只要在途请求的 sessionId 相同就复用（src/refresh/rooms/client/staleness-indicator.ts:73-76）；如果那趟是强制刷新，它会跟着等二十多秒，不会更快。宿主 snapshotInflight 的键不含 sessionId，非强制可以搭任何车（src/refresh/rooms/host/session-snapshot-cache.ts:134-137）；每个 handleSnapshot 各自 attach 表，但大家拿到的是同一个回包对象，后挂的表会覆盖先挂的——这是 #1358 的共享对象问题，在候选 a 下会更频繁。

**【已确认】60 秒新鲜期与 #1355 的约束。** 缺表分支仍在 snapshotRequestPlan 最前（src/client/kernel/work-route-own.ts:70），改 force 不改变判据顺序，60 秒早退仍到不了；setCachedSnapshot 与 hydrateFromCache 仍剥表，表仍按请求会话现算，缓存层的 #1355 隔离不被破坏（共享回包对象那一层仍见 #1358）。代价是：非强制命中返回的正文可能旧（非 composer 没有年龄门槛，:125-127），generatedMs 可能已经超过 60 秒，下一次 mount（或换目录触发的 apply）会再发一次非强制请求；表是新的，正文下一次探测再刷新。这是「多几次便宜请求」，不是隔离被破坏。

**【推断】净效果。** 温启动、宿主内存有缓存时，等待从二十多秒降到亚秒级；宿主刚重启、磁盘回放又要全仓库扫描时，可能只降到几秒；如果正好搭上一趟强制刷新，仍会等二十多秒，但不额外增加重建。**候选 a 的价值主要在「多数打开」而不是「所有打开」。**

### Q4. 三条候选修法的代价与风险

| 方案 | 改点 | 能省到什么程度 | 已知风险/反例 | 会碰到的文件与门禁 |
|---|---|---|---|---|
| a) 缺表补拉改非强制 wf.snapshot | src/client/kernel/work-route-own.ts:70 把 force:true 改 false，why 保留；同步改注释与测试期望 | 内存命中通常亚秒级；磁盘回放几秒；搭上强制车或全都 miss 时仍可能二十多秒 | composer 304 挂坏表（见 Q3）；#1358 共享对象覆盖；冷宿主磁盘扫描；在途搭强制车 | work-route-own.ts、snapshot-sync.ts（日志方法名变化）、verify-1355、verify-1373、verify-729、verify-1082、verify-log-fields；若改 adopt 规则还要 verify-1355 的缺表断言 |
| b) 新增只读工作路线表的宿主电话 | 新 handler 只读 work-path 存档并复用 createWorkRouteTableReadout（refresh-runtime.ts:364 的 workRouteTableReadout 就是它的实例），不碰快照；客户端在缺表分支调它并 adopt 到 st.snapshot | 一次读盘 + 计算，通常几十毫秒到几百毫秒；不重建快照 | 新增 IPC 面与日志白名单；两套读数若不走同一出口会漂；不更新正文（可接受）；要处理失败/重试 | src/host/index.ts:243-269 注册、src/refresh/rooms/host/refresh-runtime.ts:279/:364、src/refresh/rooms/host/work-route-readout.ts:85-112、客户端 adopt；新电话沿用 host.call，若另开事件还要改 verify-log-fields、verify-log-count 的常驻/按需清单与计数、verify-log-artifacts、research/489-appendix.md |
| c) 首帧先画「读取中」占位 | src/client/statusbar/SessionChainCapsule.ts:382 之前加分支：idle + 有 cwd/snapshot + snapLoading/snapPending 时画占位，不 return null；补一条界面文案 | 不缩短等待，只给反馈；用户知道「在读」而不是「没有」 | 可能承诺一个永远不会来的入口（#1395 的 empty/失败）；超时/失败后要能退回；占位与真实胶囊的布局切换 | SessionChainCapsule.ts、src/client/kernel/locale-data.ts:1239-1257（中文词条）与 :1165-1183（键名清单）、verify-chain-capsule；若改状态判定还要补 statusbar/胶囊的现有断言 |

**#1358 会影响哪条：** 宿主把 workRouteTable 原地写进按工作区共享的缓存对象（src/host/snapshotEnvelope.ts:125-135；shortCircuit 返回同一对象，src/refresh/rooms/host/session-snapshot-cache.ts:105-116；setCache 存引用，src/host/index.ts:60）。候选 a 增加了非强制命中次数，也就增加了「两个会话先后 attach、后挂的表覆盖先挂的」的机会；候选 b 每次新造回包/新算表，能绕开；候选 c 不碰数据链路。**a 的实现必须带一条两会话并发的回归测试，不能只看单会话。**

**#1373 会影响哪条：** 它的修复里包含「304 来了新表，客户端要采纳」这条规则。在 GitHub 现场这条分支不可达（见 Q3），所以不影响 a 的 GitHub 主路径；但 composer 的 304 信封缺口仍在，a 若要在 composer 工作区上线，必须先让 304 带 workspaceRoot（或让 withWorkRouteTable 在缺根时用 args.cwd），否则会把坏表挂上去。b 不经过 304，不受影响；c 不受影响。

**排序建议：c 先做，a 作为主修，b 作为后续彻底解。** c 低风险、立刻消除「什么都没有」的观感；a 直接砍掉大部分等待，但要先补 304 信封与 #1358 并发测试；b 最干净，但要新增协议与门禁，适合在 a 之后做。若只能做一件事，做 a；若只能做一件低风险的事，做 c。

### Q5. 观测缺口：现有日志够不够证明「这次打开在等 wf.refresh」

**不够一条线回答完整问题。** 现有事件各自能答一半，但没有一行把「哪次打开、等了多久、等的是哪条电话、强制与否、回包里本会话几行、最后装没装上」串起来。

| 事件 | 位置 | 现有字段 | 能回答 | 缺口 |
|---|---|---|---|---|
| host.call（成功） | src/refresh/rooms/client/snapshot-sync.ts:236 | method、latencyMs、ok、kind、reason | 哪条电话、多久、是否缺表补拉 | 不带 cwdHash/sidHash；304 也算 ok |
| host.call（发起） | :215 | method、kind、ok、latencyMs=0、reason | 单会话配对 | 仅 debug 开时记 |
| host.call.fail | :290 | method、kind、errorHash | 失败方法 | 没有 latencyMs、没有 reason |
| snapshot.built | src/host/snapshotEnvelope.ts:110 | maps、specs、issues、labels、open、closed、partial、latencyMs | 重建规模与组装段耗时 | 不带会话/force；只在 fromCache!==true 时发；latencyMs 从 generatedMs 算起，只是组装段 |
| statusbar.fallback | src/client/statusbar/SessionChainCapsule.ts:227 | reason、tableRows、ownRows | 胶囊当时是 idle/empty/unreadable | 只在形状变化时记；没有 pending/force/等待时长 |
| workRoute.read | src/deck/shell/work-path-store.ts:107 | sidHash、rootHash、ok、why、detail | 读盘失败/坏形状 | 正常读不记；不记行数 |
| snapshot.request | src/refresh/rooms/host/session-snapshot-cache.ts:117 | cwdHash、backend、force | wf.snapshot 是否强制 | wf.refresh 不发这条 |
| snapshot.cache.miss | src/refresh/rooms/host/session-snapshot-cache.ts:133 | reason=force/empty/expired/backend-changed | 宿主为何没命中 | 不带会话/请求号 |
| snapshot.cache.hit | :124、:130 | kind、ageMs | 命中（debug，百分之一采样） | 缺失不能反证未命中 |
| panelSync.dirty | src/refresh/rooms/host/session-refresh-schedule.ts:98 | cwdHash、ageMs | 刷新开始 | 不带会话/请求号 |

**最小补充建议（只写建议，不改代码）：新增一条常驻事件 workRoute.pull，一趟补拉完成时记一行。** 字段：why（work-route-missing / fresh / switch）、force、method（wf.refresh / wf.snapshot）、sidHash、cwdHash、snapGenMs（安装后 st.snapshot.generatedMs）、waitMs、ok、outcome（installed / 304 / timeout / fail）、tableRows、ownRows、snapMode。落点：src/refresh/rooms/client/snapshot-sync.ts 的 loadSnapshot 完成/失败分支（why/force 已在闭包里），一趟一行；tableRows/ownRows 用 workRouteTableOf 在安装后读一次。失败也记，别只记成功；迟到安装另有现有的 snapshot.late.install 可对上。这样一条 trace 就能回答「这次打开等了多久、等的是哪条电话、强制否、回包本会话几行、最后装没装上」。

同步白名单：src/shared/log-event-list.ts（事件名与字段）、research/489-appendix.md 第 1 章（对照表）、tests/verify-log-fields.ts、tests/verify-log-count.ts（常驻/按需清单与计数）、tests/verify-log-artifacts.ts。候选 b 的新电话可以沿用 host.call；若另开事件，按同一套白名单改。次要建议：给 host.call.fail 补 latencyMs；给 statusbar.fallback 补 snapLoading/snapPending/snapGenMs（改现有事件字段，不新增事件）。

### Q6. 与 #1395 的关系

**结论：同源不同症，不是重复单。**

| 维度 | #1436（本单） | #1395 |
|---|---|---|
| 触发 | 处理过 ISSUE 的会话第一次打开；客户端有缓存快照，水合剥表后缺表 | 重启或运行中偶发；存档里明明有本会话记录 |
| 卡在哪 | 缺表 → 强制补拉在途的等待窗；idle 是暂时的 | 补拉完成/失败后仍无本会话行，或表永远不来；idle/empty 是持久的 |
| 典型判据 | work-route-idle 持续几秒到几十秒，随后 ok | work-route-idle / work-route-empty 长期不变，或先 ok 后消失 |
| 修法 | 降低补拉代价（a）、给首帧反馈（c）、加只读电话（b） | 修读数归属/行过滤、补拉判据与重试（#1395 的方向） |
| 交集 | 本单超时、刷新失败、或回包表无本会话行时，会落进 #1395 的症状 | #1395 的补拉若走强制，也会经历本单的等待窗 |

两单共用同一条链（水合剥表 → 缺表 → 补拉）和同一套判据（src/client/statusbar/SessionChainCapsule.ts:176-193、src/client/kernel/work-route-own.ts），观测也同用 statusbar.fallback；但本单修「等待与补拉代价」，#1395 修「归属与不恢复」。**给 #1436 的关联说明可以写：疑似同源、不同落点；本单修首帧等待与便宜补拉，#1395 修补拉后的归属与重试；不合并，互为关联。** #1395 已加的 statusbar.fallback 三档日志正好是本单 Q5 的基础；本单若新增 workRoute.pull，应与它用同一套 sidHash/cwdHash 口径。

## 三、仍未确认的问题

1. **composer/Markdown 的 304 缺口在真机上是否发生、频率多少。** 今天 statusbar.fallback 的 work-route-unreadable=0，说明这条路径至少今天没有被记到；但代码路径是实的（Q3），需要真机 composer 工作区验证。
2. **25 秒里 gh 外部调用与车道/主线程排队的占比。** 一个 18.8 秒空档样本不足以定量；需要 resetGhCache 起止、车道等待起止、或每个请求的 trace 级时间线。
3. **为什么一天有 663 次 work-route-missing、408 条 wf.refresh 成功回包。** 是每次打开会话都触发，还是同一会话多个 store/多次挂载重复触发？现有日志没有「这次打开」的会话标识，无法按打开次数归一。
4. **#1358 的共享对象在候选 a 下能否构造出跨会话串表。** 需要两个会话并发命中同一缓存对象的测试；静态读码只能证明「可能」，不能证明「必现」。
5. **冷启动与温启动的比例。** 冷启动首帧走非强制 wf.snapshot，不会命中本单的强制链；票面现象主要对应温启动。需要一条标记（例如 workRoute.pull 的 force 字段）才能统计。
6. **composer 304 不带 workspaceRoot 是有意还是遗漏。** 静态读码没有找到宿主在别处补根的地方；#1373 的测试又用伪造回包绕过了信封，所以不能从测试通过反推真机没问题。

## 四、给票的建议

1. **观测先行（最小改动）。** 加 workRoute.pull 一条常驻事件（字段见 Q5），把「这次打开」的 why/force/method/等待时长/表行数/结局串成一行；同步 src/shared/log-event-list.ts、research/489-appendix.md 第 1 章、tests/verify-log-fields.ts、tests/verify-log-count.ts、tests/verify-log-artifacts.ts。验收标准：下一次本机复现时，只看这一条就能判断「是不是在等 wf.refresh」，不需要跨事件猜。
2. **修法排序：c → a → b。** c 先给首帧反馈（SessionChainCapsule.ts:382 的 idle 分支），风险最低；a 把缺表补拉改成非强制 wf.snapshot（work-route-own.ts:70），是主修，但必须先补 composer 304 的 workspaceRoot 或让 adopt 拒收坏表，并加 #1358 的两会话并发回归；b 新增只读工作路线表电话，是彻底解，放在 a 之后，避免一次改太多协议面。
3. **测试与门禁。** 至少覆盖：有缓存快照但缺表时，plan 走非强制且回包能装上本会话表；304（composer）不把坏表挂上、缺表仍会重试；两个会话并发命中同一缓存对象时表不串；首帧 idle 时有占位、超时/失败后能退回；verify:parallel 全链通过；日志字段与附录同步。
4. **不要动的边界。** 不改工作路线的数据模型与行归属算法（src/deck/shell/work-path-readout.ts:151 的 currentSession 严格相等），不改 #1355 的「缓存不保留表」纪律，不改 60 秒新鲜期的语义；本单只解决「首帧拿表太贵/没有反馈」，归属与不恢复留给 #1395。
