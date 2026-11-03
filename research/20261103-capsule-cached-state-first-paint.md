# 打开会话时胶囊只有票号、没有状态：本机存档里本来就没有票的状态

> 委派调研（只读，不改生产代码）· 落盘日期 2026-11-03 · 基线 79b5b0af（1.9.0-beta.34，分支 main）
> 数据来源：本仓 src/ 与 docs/adr/ 的当前源码（逐条注到行）、research/1436-capsule-workroute-first-open-latency.md、research/1395-capsule-workroute-entry-missing.md、research/1009-recheck-2026-10-21.md、research/1838-triage-2026-11-03.md。工作树另有与本调研无关的未提交改动，未触碰。
> 旧笔记为什么不适用：#1436 回答的是「胶囊那一行什么时候出现」（首帧改读本机 work-path 存档），没回答「状态从哪来」；#1395 回答的是「整段胶囊为什么消失」（idle / empty 两档，src/client/statusbar/SessionChainCapsule.ts:221-222），与「有行、无状态」是相反形态；#1009 只给冷启动快照 29.3 秒的时间账，是本文时序一节的背景，不是答案。

## 一、结论

**一句话：本机工作路线存档只有票号、标题、动作与时刻，没有票的开/闭状态（src/deck/shell/work-path-readout.ts:39-50、src/deck/shell/work-path-ledger.ts:98-109）；胶囊的状态只认 st.snapshot 一个来源（src/client/statusbar/SessionChainCapsule.ts:93-126、:153）。首帧工作路线读数（wf.workRoute）先回来、行先画出来（:218-229），而快照要么还没到（markdown 仓宿主没有磁盘回放，只能整份重建），要么到了也不含这张票（首屏只取未关闭工作集）——查不到状态就写空串（:153），渲染把空状态画成近白 #e6edf3（:458-460）。** 这不是缓存丢了，是「状态从来没有第二个来源，也没有『上次已知』的降级画法」。

| 层次 | 源码事实 | 一手位置 |
|---|---|---|
| 存档形状 | 工作路线条目只有 ticketKey / title / action / actionAt / active / currentSession，没有状态字段 | src/deck/shell/work-path-readout.ts:39-50；src/deck/shell/work-path-ledger.ts:98-109 |
| 胶囊取状态 | 票池只由 st.snapshot 的 issues / maps[].tickets / thinTickets 建；查不到就是空串 | src/client/statusbar/SessionChainCapsule.ts:93-126、:145、:153 |
| 空状态的样子 | eState 为空 → 无状态字，颜色落到 --dsw-alias-label-primary/#e6edf3 | src/client/statusbar/SessionChainCapsule.ts:458-460 |
| 宿主取数 | markdown/composer 分支内存没命中就整份重建，全程不读磁盘；只有 GitHub 支路读盘回放 | src/refresh/rooms/host/session-snapshot-cache.ts:167-299、:347-352 |
| 首屏口径 | 只取未关闭票（state:'open'）；thinTickets 只补「已关闭容器里已关闭的子票」 | src/host/tracker/snapshot.ts:312；src/host/tracker/snapshotAssemble.ts:145-152 |
| 点开票 | wf.issueDetail 只写 st.issueDetail，不合并回 st.snapshot | src/client/kernel/api-io.ts:235-261 |

## 二、逐条回答

### Q1. 首帧的票号 / 标题 / 状态分别从哪来

**【已确认】票号、标题、动作、时刻来自本机 work-path 存档，经一条只读电话 wf.workRoute 回来。** 电话在 src/host/index.ts:257 注册，实现是 src/host/snapshotEnvelope.ts:220-278：只调 deps.readout 读存档、回 { ok:true, workRouteTable }，没有 cwd 回 no-workspace、没有会话号回 no-session。客户端 src/client/kernel/work-route-own.ts:104-154 先置 loading 再发这条电话，成功置 ready 并带读数时刻 readout.at。

**【已确认】存档里没有票的状态。** WorkPathReadoutEntry（src/deck/shell/work-path-readout.ts:39-50）与盘上同形的 StoredEntry（src/deck/shell/work-path-ledger.ts:98-109）都只有票号、标题、动作、时刻、来源、是否本会话；状态字段不存在，所以宿主这一路给不出 OPEN/CLOSED。

**【已确认】状态只从快照取。** capsuleTitlesOf（SessionChainCapsule.ts:93-126）只读 st.snapshot：没有快照直接回空表（:96-97），有则按 issues（:114-115）、maps[].tickets（:116-120）、thinTickets（:123-124）建票池，行的状态读 x.state 归成 OPEN/CLOSED（:104、:110）。capsuleRowOf 逐行补格时，票池里查不到就把 ticketState 写空串（:153），标题则回落读数自带的那份（:151）。首帧判据 sessionChainCapsuleOf 的行来自 work-route 读数（:218-229），标题/状态来自上面这张票池（:227）——**两个来源拼出来的一行：行很快，状态要等快照。**

### Q2. 打开会话时快照怎么来

**【已确认】客户端先吃两份本地缓存，再发一次请求。** StatusBar 挂载时（src/client/statusbar/StatusBar.ts:189-193）与 cwd 变化时（:167-188）都调 loadSnapshot，并同时调 loadOwnWorkRoute。loadSnapshot（src/refresh/rooms/client/snapshot-sync.ts:151-358）先看内存快照（:181），内存没有才 await 磁盘（IndexedDB）回放（:185-199：diskGetSnapshot → setCachedSnapshot → hydrateFromCache → emit），然后才发请求（:204-225，30 秒死线）。304 只合并工作路线表与选择、布局（:265-280），200 整份装（:282-285）。

**【已确认】宿主侧：内存缓存只活一个进程，重启即空。** src/refresh/rooms/host/session-snapshot-cache.ts:139-152 内存命中就直接回（useComposerEarly 时看 CACHE_MS，否则任何年龄都立刻回）；composer/markdown 分支（:167-299）内存没命中就整份重建，中间不读磁盘。tracker 那层还有 LRU20 加 TTL：同版本命中回 304（src/host/tracker/snapshot.ts:286-290）、TTL 内直接回缓存（:291-295）、否则重建（:298-312）。**这些缓存全在进程内存里，DSH 重启或界面刷新换一个进程，第一趟必然重建。**

**【已确认】首屏只取未关闭票。** src/host/tracker/snapshot.ts:312 用 tracker.list(ref, { state:'open' })；组装层只为「已关闭容器里已关闭的子票」留瘦身行（src/host/tracker/snapshotAssemble.ts:145-152），顶层已关闭票不进 issues、不进 thinTickets。

### Q3. ADR §2.3「先画磁盘里的上次快照」在胶囊上生效了吗

**【已确认】要求写得很明确，但只落在客户端一路。** docs/adr/20261030-panel-snapshot-single-source.md:46-51 §2.3：TTL 只决定新鲜不决定能否显示（:48）、取数失败保留上次数据（:49）、「快照落盘；跨重启先画磁盘里的上次快照，再在后台校准。界面要能分辨『这是上次的快照、什么时候的』」（:50）、回放带 schema 版本与来源、完整度降为「上次已知（时间）」（:51）。门禁与结论见 :77、:114（ADR 自称已由 #1692 落地）。

**【已确认】宿主一路只有 GitHub 支路读盘。** 磁盘回放发生在 src/refresh/rooms/host/session-snapshot-cache.ts:347-352：先 getRepoKey 拿 owner/name，readDiskCache(repo0b) 命中才回 Object.assign({}, diskb, {fromCache:true,...})。markdown/composer 分支（:167-299）没有任何读盘调用；缓存目录按 owner/name 命名（src/refresh/rooms/host/git-execution.ts:333-345），本仓（markdown 后端）从不生成快照文件（research/1838-triage-2026-11-03.md:33、:104）。**所以本仓重启后，第一份到达客户端的快照响应是宿主整份重建的结果（200），不是磁盘回放。**

**【已确认】客户端回放存在，但到不了胶囊。** IndexedDB 回放确实实现了（src/refresh/rooms/client/snapshot-cache-store.ts:163-214、:240-328，无年龄门槛，直接把旧快照装进 st.snapshot）。但它落盘时就被剥掉了 workRouteTable（:128-135，:134 是 delete），而胶囊那一行本来也不由它给：strip 之后 workRouteTableOf 只从 st.snapshot 读那个字段（src/client/views/shared/workRouteTable.ts:204-207），读出 idle，胶囊整段不画（SessionChainCapsule.ts:221）；等 wf.workRoute 读数回来，行才出现，而状态要等快照——回放里的那份快照若不含这张票，状态还是空。**结论：§2.3 的「先画上次快照」在胶囊上没有生效；胶囊的「上次」是存档读数，不是快照。**

### Q4. 为什么胶囊第一帧读不到缓存里的状态

三层原因叠在一起，按确定性排序：

1. **【已确认】回放的那份快照被剥了表，行不归它给。** 见 Q3（snapshot-cache-store.ts:134、workRouteTable.ts:204-207）：回放负责的是「表」，可表被剥了；而行的来源是 wf.workRoute 存档，存档没有状态。两个缓存各管一半，拼不出一行完整的「票号 + 状态」。
2. **【已确认】markdown 仓根本没有宿主侧回放。** 见 Q3（session-snapshot-cache.ts:167-299 vs :347-352）：重启后的第一份快照要等整份重建；#1436 量过强制重建 p50 约 25 秒，#1009 量过冷启动快照 29,278 毫秒，两个数都贴 30 秒死线（snapshot-sync.ts:223-225）。
3. **【已确认】快照到了也未必有这张票。** 首屏只取未关闭票（snapshot.ts:312）：票已关闭、或落在 500 条窗口外，就永远不在 issues / maps[].tickets / thinTickets 里，状态永远空着。

**【推测】还有一条键对不上的可能。** 客户端缓存按 wsKeyOf 分桶：认不出工作区根时用所选目录本身（snapshot-cache-store.ts:103-114）；界面刚刷新时那张「目录 → 根」的表是空的（:96-111，表不落盘），读键可能与写键不同，回放整个 miss。这一条需要用真机日志的 client.snapshot.hit 计数证实或排除。

**另外，报告人期望的「点开票之后再按实际刷新」今天不成立**：打开票走 wf.issueDetail，结果只写 st.issueDetail（src/client/kernel/api-io.ts:235-261），不合并回 st.snapshot，胶囊不会因此拿到状态。状态要等下一次整份快照或写事件回执。

### Q5. 胶囊有没有「这是上次快照、什么时候的」标记

**【已确认】没有，而且连快照时刻都不显示。** 胶囊表头的时间取的是读数时刻 workRouteTableClock(e.atIso)（SessionChainCapsule.ts:455、:384），不是快照时刻；checksumsOf 里算过 snapshot.generatedMs 的 timeStr（src/client/statusbar/checksums.ts:45-49），但 StatusBar.ts:202 解构后正文再没引用它。「磁盘回放 · 上次已知 HH:MM」这套文案只画在面板列表那一行（src/client/views/shared/truthLines.ts:290-296，读 snap.diskReplay.lastKnownAtMs），状态栏这边不读。

**【已确认】设计上是允许怎么标记的。** ADR 给了三条可用的口径：未知 ≠ 空、来源没有表达某个字段时保留上次已知（:40）；每个字段组记「上次已知」的来源与时间（:42）；回放内容的完整度降为「上次已知（时间）」（:51）。换句话说，允许的画法是「把空状态降级成上次已知 + 时间并标灰/标斜」，而不是画成默认证色的空白——后者恰好把「不知道」冒充成了「没有状态」。

### Q6. 结论：缺口在哪一层

**缺口在主数据形状与判据的接缝上，不在渲染。** 具体三处：(a) 数据形状——工作路线存档不带状态，状态只有快照一条路（work-path-readout.ts:39-50 vs SessionChainCapsule.ts:93-126）；(b) 判据——胶囊只在快照里找状态，查不到写空串（:153），没有「上次已知」降级；(c) 时序——markdown 仓没有宿主侧磁盘回放（session-snapshot-cache.ts:167-299），客户端回放又被剥表（:134），两者合起来保证首帧一定有一段「有行无状态」。表现层的近白色只是这三个缺口的可视化（:460），改颜色不解决问题。

## 三、可选修法方向（只写方向，未实施）

1. **给存档补状态，胶囊就地降级。** 宿主写 work-path 存档时把票状态与观察时刻一起记下，wf.workRoute 回包带上；胶囊的票池在快照查不到时用这份「上次已知」，并按 Q5 的口径标时间与灰阶。改动面最小，直接命中报告人期望（先按以前的缓存显示状态，点开票再校准）。
2. **让客户端回放真正喂到胶囊。** 落缓存别把 workRouteTable 剥掉（或另存一份只读的「与会话无关」的表），并让 capsuleTitlesOf 也吃回放快照与它的 replay 时间，而不是只吃在线快照。
3. **补齐 markdown 仓的宿主侧落盘。** 要么按 §2.3 给 composer 分支也写盘回放（现在只有 GitHub 支路，session-snapshot-cache.ts:347-352），要么把「工作路线涉及的票」一律留进 thinTickets（现在只留已关闭容器里已关闭的子票，snapshotAssemble.ts:145-152），让状态迟早能到。

三条不互斥：1 解决首帧，3 解决重启后的第一趟，2 是 1 的替身方案（状态跟着快照走、不另存一份）。
