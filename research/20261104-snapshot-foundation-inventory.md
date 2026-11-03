# 面板快照：磁盘与内存的现状盘点（2026-11-04）

只读调研，回答「快照怎么存、怎么读、怎么合，离『文件是权威副本、内存只是工作副本』差在哪」。行号取自当前工作树，未改任何源码。

## 1. 落盘

- 目录是 `<DSH 进程启动目录>/.dsh-mattskillsdeck-cache/`，不是工作区目录 —— src/refresh/rooms/host/git-execution.ts:333-343。
- 这个落点是为绕开 fs 沙箱选的；仓库自己在 src/host/choiceStore.ts:10-11 里记着它「跟着进程启动目录跑（等于一半的记忆留在原地）」。
- 一个 GitHub 仓库一份文件，与工作区个数无关；文件名是 `owner__name.json` —— git-execution.ts:344-346。
- 认不出 GitHub 仓库的工作区（markdown / composer 后端）拿不到文件名，因此完全不落盘 —— git-execution.ts:345；写盘点只在 GitHub 分支，见 session-snapshot-cache.ts:422。
- 格式是「快照本体 + 两个信封键」：`cacheFormat=4` 与 `diskMeta{schema,source,completeness,sources,collapsed,writtenAtMs,groups}` —— src/refresh/kernel/disk-snapshot-format.ts:19-26、99-119。
- 读取判据：`ok===true`、maps 是数组、generatedMs 是数、版本是 3 或 4，任一不满足就整份丢弃 —— disk-snapshot-format.ts:153-167。
- 唯一写入函数是 `writeDiskCache`（git-execution.ts:367-383），调用者四处：
  - 整池快照建完 —— src/refresh/rooms/host/session-snapshot-cache.ts:422；
  - 强制刷新建完 —— src/refresh/rooms/host/session-refresh-schedule.ts:399；
  - 行增量的三种写回（增量合并 / 写回执 / 记待办）—— src/refresh/rooms/host/patch-wiring.ts:40-43；
  - 详情合并 —— src/refresh/rooms/host/detail-snapshot-merge.ts:98-102。
- 写之前先删掉只给界面用的 `diskReplay`，按上限淘汰按需细节，再整份 `JSON.stringify` 写一次 —— git-execution.ts:377-380。
- 没有节流：写多写少由上面四处的调用节拍决定；内存命中在 60 秒内直接回包，连盘都不读 —— session-snapshot-cache.ts:145、config/ttl.yaml:56。
- 不是原子写：`fs.writeText` 直接覆盖同名文件，没有临时文件、没有改名 —— git-execution.ts:380；同仓的选项库反倒做对了（临时文件+改名+失败清理）—— src/host/choiceStore.ts:288-303。
- 写失败被空 catch 吞掉，调用方拿不到成败，也没有重试与提示 —— git-execution.ts:382。
- 写失败时盘上留的是上一次成功的文件，而内存那份被置空并回 `ok:false` —— session-snapshot-cache.ts:424-426。
- 文件没有清理也没有迁移：仓库改名后新文件出现、旧文件永久留着；整个文件里搜不到 readdir/unlink —— git-execution.ts:344-346。

## 2. 读取与回放

- 重启后读盘入口有两个：客户端发 `wf.snapshot` 走到 session-snapshot-cache.ts:348；索引扫描用磁盘快照当第一次扫描的起点 —— src/refresh/rooms/host/issue-index-scan.ts:50-67。
- `wf.snapshot` 的顺序是：内存命中且 60 秒内直接回；否则（GitHub 分支）读盘 → 后端 id 相同且 `cacheSnapshotIsCurrent` 不为 false 就回放并标 `fromCache:true` → 都不行才联网重建 —— session-snapshot-cache.ts:145-151、348-352。
- composer 分支（markdown 等）整段没有 `readDiskCache`：全文件只在 348 读、422 写 —— session-snapshot-cache.ts:167-317。
- `wf.refresh` 同样只在 GitHub 分支读写盘，composer 分支在 258/277 就返回了 —— session-refresh-schedule.ts:139-258、318-400。
- 客户端是三级缓存：内存 → IndexedDB → 网络；内存未命中才 `diskGetSnapshot(wsKeyOf(cwd))`，命中后先装回内存再 hydrate —— src/refresh/rooms/client/snapshot-sync.ts:181-199。
- 客户端 IndexedDB 库名 `dsws-cache`、版本 1、store `snapshots`，按工作区根存，上限 24 份、按 ts 淘汰 —— src/refresh/rooms/client/snapshot-cache-store.ts:168-169、162、177-199。
- 落缓存前剥掉 `notModified/status/cached`（只属当次传输）与 `workRouteTable`（按请求它的会话算）—— snapshot-cache-store.ts:131-134。
- `diskReplay` 不剥：它跟着快照进内存、进 IndexedDB，只在写回磁盘时被删 —— snapshot-cache-store.ts:128-135、git-execution.ts:378。
- 读盘后的「上次已知（时间）」来自 `diskMeta.writtenAtMs`，挂在快照的 `diskReplay.lastKnownAtMs` —— disk-snapshot-format.ts:174-185。
- 列表行用它画「上次已知（时间）」—— src/client/views/shared/truthLines.ts:292-293。
- 详情页另有一条时间线：`lastKnownDetailAtMs` 与 `st.detailSeenAt` 取较大者，不看 `diskReplay` —— src/client/views/shared/detailProjection.ts:73、196-199、212。

## 3. 唯一写入入口

- `mergeSnapshot` 的 src 调用者只有三处：增量合并 row-patch.ts:338、写回执 row-patch.ts:447、详情 detail-snapshot-merge.ts:83；文件头自称唯一写入入口 —— src/refresh/kernel/snapshot-merge.ts:2。
- 它只并内容字段组（row/body/labels/parents/dependencies/subIssues/comments/review/mergeInfo），`version/generatedMs/updatedAt/deck` 由调用方合并后直接改 —— snapshot-merge.ts:38-57、row-patch.ts:371-374。
- 绕过一：整池建好后直接覆盖内存和磁盘，不经过 `mergeSnapshot` —— session-snapshot-cache.ts:416-422、session-refresh-schedule.ts:393-399。
- 绕过二：`adoptSnapshot` 只写内存、事件库与索引，不写盘、不合并 —— src/refresh/rooms/host/issue-list-fetch.ts:255-261。
- 绕过三：`patch-wiring.readSnapshot` 只读内存，没有「内存没有就读盘」的兜底 —— patch-wiring.ts:40-44。
- 绕过四：客户端详情直接赋 `st.issueDetail=issue`，再静默拉一次快照让投影读到 —— src/client/kernel/api-io.ts:270-272。
- 绕过五：评论分页只 push 进 `st.issueDetail.comments.nodes`、只记 `detailSeenAt`，不写快照 —— api-io.ts:336-338、345。
- 绕过六：宿主 `handleIssueComments` 只回评论 delta，不调详情合并 —— src/refresh/rooms/host/comment-thread-fetch.ts:254-301。
- 绕过七：发表评论成功后只把内存快照置空（`snapshot:null`），不合并、不写盘，下一次读可能回放发评论之前的那份 —— comment-thread-fetch.ts:328-331。
- 绕过八：通知历史是另一份文件、另一套整份覆写，与快照互不知情 —— src/refresh/rooms/host/notification-store.ts:42、108、133-147。
- 绕过九：工作条目（在办表）与写回执挂在响应的 `workRouteTable` 上、按会话现算，落缓存前剥掉 —— src/host/snapshotEnvelope.ts:176-186、snapshot-cache-store.ts:134。
- 详情结果会合并，但有三个前提：内存里有基线快照、认得出仓库、合并版本门不判旧；没有基线就返回 null，不凭空造 —— detail-snapshot-merge.ts:73-80、91-93、98-100。
- 所以「先点开详情、面板还没建过快照」这一常见次序下，详情只留在客户端内存，等主刷新再被覆盖；api-io.ts:271 那句「宿主已把这次详情写进快照」只在有基线时成立。

## 4. 生命周期

- 切换工作区在宿主侧没有快照动作：`wf.focus` 只更新视野模型（src/refresh/rooms/host/host-attention.ts:223-225）；「切进工作区先清待办」那条链的入口 `deltaEnter` 全仓无调用方，`enterWorkspace` 只被它和 `run()` 的 `o.entered` 分支调用，而 `o.entered` 也没人传 —— src/refresh/rooms/host/refresh-runtime.ts:492-495、row-patch.ts:217-228、268-269。
- 内存按工作区根分表、最多留 20 个，切走的工作区不丢，只排到 LRU 后面 —— src/host/index.ts:53-56。
- 客户端切工作区只是换 cwd 再 hydrate 新键的缓存，旧条目还在内存 Map 和 IndexedDB 里 —— snapshot-sync.ts:326、snapshot-cache-store.ts:123-135。
- 同一进程内多个会话共用一份内存快照（键是工作区根），所以按会话不同的 `workRouteTable` 必须落缓存前剥掉 —— snapshot-cache-store.ts:125-134。
- 跨进程（多窗口/多实例）没有任何锁：两边各自读盘、各自整份覆写，文件里没有版本比较或占用标记 —— git-execution.ts:367-383。
- 快照里确实带 `snapshot.merge.version`，同进程内的迟到合并靠它判旧；但两个进程「读—改—写」之间仍可互相覆盖 —— snapshot-merge.ts:299-328、461。
- 视野模型只决定谁被探测：客户端只探活跃工作区，后台一次都不探 —— src/refresh/rooms/client/refresh-timer.ts:304-309；90 秒没有「我在看谁」的上报，全部工作区降为后台档 —— src/refresh/kernel/host-budget.ts:86。
- 后台工作区因此不会有新的整池重建与写盘；切回来时（GitHub 分支）先靠磁盘回放，再由后台刷新补新 —— session-snapshot-cache.ts:348-352。
- 200 条 / 512KB 的按需细节上限也作用在磁盘上：读盘后一次、写盘前一次、行写回前两次 —— src/refresh/kernel/detail-eviction.ts:25-27、git-execution.ts:362、379、row-patch.ts:365、470。
- 它不作用在详情合并上：合并结果先 setCache，再交给 `writeDiskCache` 淘汰副本 → 内存可能超过上限，磁盘已经被截断 —— detail-snapshot-merge.ts:95-100、git-execution.ts:377-379。

## 5. 差距清单（验收标准：文件是权威副本，内存只是工作副本）

已有：

- 稳定的文件格式与版本号（4，兼容 3），读取有明确判据 —— disk-snapshot-format.ts:19-26、153-167。
- 「上次已知（时间）」与来源/完整度能带进界面 —— disk-snapshot-format.ts:174-185、truthLines.ts:292-293。
- 进程内合并版本门，迟到的结果不会盖掉更新的结果 —— snapshot-merge.ts:299-328。
- 按需细节淘汰只删内容字段、保留「曾取过」记号与计数，删除可解释 —— detail-eviction.ts:23-31。
- 重启后有磁盘回放（GitHub 分支）与索引起点复用 —— session-snapshot-cache.ts:348-352、issue-index-scan.ts:50-67。
- 客户端有 IndexedDB 兜底与 24 份淘汰 —— snapshot-cache-store.ts:177-214。

缺失：

- 文件不在工作区，而在 DSH 进程启动目录；换一个启动目录就换一份记忆，同一仓库的多个工作区共用一份 —— git-execution.ts:333-343。
- 非 GitHub 后端（markdown/composer）既不读盘也不写盘，重启即空 —— session-snapshot-cache.ts:167-317、session-refresh-schedule.ts:139-258。
- 写盘不是原子写，写一半崩掉会留下截断的 JSON —— git-execution.ts:380；同仓已有正确做法 —— choiceStore.ts:288-303。
- 写失败被静默吞掉：没有失败计数、没有下次重试、界面上看不出来 —— git-execution.ts:382。
- 没有「从内存合并进文件」的统一入口：整池重建直接覆写盘，绕过合并版本门 —— session-snapshot-cache.ts:416-422。
- 详情、评论分页、发评论、通知各自改内存或别的文件，没有一条回到快照文件 —— 见第 3 节各条。
- 详情合并写盘的条件太窄：无基线返回 null、认不出仓库不写、版本门判旧不写、无 writeDiskCache 不写 —— detail-snapshot-merge.ts:73-80、98-100。
- 客户端 IndexedDB 与宿主磁盘是两份独立副本，没有同步协议，客户端只按 generatedMs 决胜 —— snapshot-cache-store.ts:240-291。
- 多进程写同一文件没有锁、没有 compare-and-swap —— git-execution.ts:367-383。
- 磁盘写前会淘汰细节，内存那份在详情合并路径上不淘汰 → 两者内容不一致的窗口期 —— detail-snapshot-merge.ts:95-100。
- 旧文件没有迁移也没有清理：版本 3 只按「来源未知」回放；仓库改名后旧文件永久残留 —— disk-snapshot-format.ts:164-165、git-execution.ts:344-346。
- 结构版本变化时选择整份重建（legacy/future-structure），不做迁移 —— src/refresh/kernel/snapshot-diff.ts:384、402-408。
- 切工作区没有快照钩子：`deltaEnter` 无调用方、`o.entered` 无人传，切回来只能等下一轮探测触发回放或重建 —— refresh-runtime.ts:492-495、row-patch.ts:268。
- 失败时内存被置空，盘上旧文件仍是「上次好的」，界面可能把旧数据当新数据 —— session-snapshot-cache.ts:424-426。

不一致窗口期一句话：从「详情/评论写进内存」到「下一轮整池写盘」之间，内存比磁盘新；从「详情合并写盘」到「内存再读盘」之间，磁盘比内存新；两处都没有版本比对来发现。
