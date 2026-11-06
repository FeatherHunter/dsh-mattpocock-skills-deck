# workspace-snapshot —— 工作区快照库

这一层把一份 SQLite 文件当作工作区数据的权威副本：刷新流程把后端读到的一批结果写进来，
列表与详情从这里读，不再各自留一份内存或磁盘快照。本文件说明每层职责与依赖方向，
具体表结构见 `research/20261104-snapshot-database-schema-proposal.md` 第 3 节（以它为准）。

## 分层与依赖方向

```
contract/      对外类型与门面（唯一被上层 import 的入口）
    ↓
runtime/       生命周期：开库、身份校验、租约、事务、整库重建
    ↓
persistence/   建表语句、SQLite 连接/损坏处理，以及三组写入的具体 SQL
projection/    只读投影：把库里的行拼成列表要的形状；counts.ts 一条 SQL 算面板六个数字 + 完整度
merge/         纯合并规则（三态 + 版本门），不碰数据库
    ↓
model/         领域值类型（票行、标签、指派人、三态）
sources/       后端读结果归一（本票只留占位，1863+ 填）
```

箭头表示「左边可以 import 右边」。`merge/` 是纯函数：只接受「旧值 + 写入」并回答
「保留 / 替换 / 清空 / 补缺」，不碰数据库；`persistence/` 的写入模块按这个答案执行具体 SQL
（`issue-row-write.ts`、`issue-groups-write.ts`），所以依赖方向是 persistence → merge。
`projection/` 只读数据库，不写。

票面把方向写成 `contract ← model ← merge ← persistence ← runtime ← projection ← sources`，
落地时按上面的方向（门面在最外、合并规则是纯函数）实现；语义没有变化，只是把
「谁依赖谁」摆成可以直接照着 import 的样子。

## 库文件位置

默认 `<工作区根>/.dsh-mattskillsdeck-cache/snapshot/<backend>.sqlite`。工作区根按仓库既有规则
从传入目录向上最多 64 层找 `docs/agents/workspace.yaml` 的第一个命中层；找不到就把传入目录
自己当根（与 `src/host/workspaceKey.ts:224-267` 的 resolveWorkspaceRoot 同一口径）。
测试可以传 `dbPath` 注入临时路径。

## 写模型：本地多写者、网络盘回退（#1932，规格 #1930 §2.2）

同一份库文件可能被两个窗口（两个进程）同时打开。能不能两边都写，取决于库放在哪种存储上；
判定住 `runtime/storage-kind.ts` 的 `detectStorageKind()`，结论在句柄上叫 `storageKind`。

- **本地磁盘（local）**：所有进程都能打开可写句柄，**不抢租约、不启心跳、空闲不占写权**。
  每一次写仍然是一次 SQLite 短写事务（`BEGIN IMMEDIATE` + `busy_timeout=5000`），
  多个写者按数据库的写锁排队；写事务的锁只在事务期间持有。关掉一个窗口、或它崩溃了，
  另一个窗口不需要重启就能继续写（没有租约可等、也没有心跳可丢）。
- **网络盘 / UNC（network）**：保留旧的单写者回退。多进程写 SMB/NFS 上的同一份 SQLite 不保证安全，
  所以这里仍然抢租约：抢到可写并每 5 秒续期，抢不到关掉写连接、以只读连接重开（诊断
  `lease-held-readonly`），心跳丢了降级只读（`lease-lost-readonly`）。`lease_owner` /
  `lease_heartbeat_ms` / `lease_expires_ms` 三列与两个时长配置**一律保留**，不许删。
- **路径怎么判**：UNC（`\\server\share` 与 `//server/share` 两种写法都算）直接判 network；
  Windows 盘符路径查一次系统网络盘集合（`Get-CimInstance Win32_LogicalDisk` 里 DriveType=4 的
  DeviceID，结果按进程缓存），命中判 network；系统盘（`%SystemDrive%`）不可能是映射的网络驱动器，
  直接判本地，省掉那一次约 300 毫秒的查询。POSIX 用 `statfs` 的 f_type 认 NFS / SMB / SMB2 /
  CIFS / FUSE / AFS / 9P。**判不出来（没有 PowerShell、statfs 失败）就按本地多写者处理**：
  宁可多窗口可写，也不把一个人的本地库锁成只读；这条取舍是有意的，改之前先读门禁 verify-1932。
- **mode 的语义收紧了**：`readonly` 只表达「真的写不了」——网络盘回退，或文件系统不可写
  （诊断 `readonly-filesystem`）。它**不再表达「另一个窗口拿着租约」**：本地路径不会因为别的窗口
  而只读。
- **回退原因只在设置页与日志**：网络盘抢不到写权时，列表上方不出现「只读」「写锁」这类内部状态
  （#1928 删掉了那条映射，#1933 的门禁用负例守着）。原因只在设置页能力诊断的「写模型」一行
  （`wf.snapshotStoreStats` 回包的 storageKind / mode / legacyWriterBlocked，五档说法见
  `config/copy/panel.yaml` 的 `env.diagWriteModel.*`）与开库日志 `workspaceSnapshot.lease` 里说明。
  列表状态行只说「数据为什么旧」，不说底层哪把锁在谁手里。
- **升级要重启所有窗口**：旧版本在本地路径留下的未过期租约会被认出来，本窗口仍能读、mode 仍是
  writable，但每一次本地写都回 `legacy-writer`，设置页「写模型」一行显示「还有窗口在用旧版本写
  这个工作区，请重启所有窗口」。不升 schema 版本，升级保护靠这句话与旧租约检测（下一小节），
  不靠版本号挡。

### 升级：旧租约还在 meta 里怎么办（#1932 验收 5）

旧版本的代码会在本地路径上写租约。新代码开本地库时读 `meta.lease_owner / lease_expires_ms`：

- 没有租约，或已经过期：把残留的租约行清掉（`UPDATE meta SET lease_owner = NULL …`），正常写。
  过期是下一次写自动恢复的判据——**不要求用户重启本窗口**。
- 有未过期的租约：说明可能还有旧版本窗口在写这个库。这时不把句柄改成只读（那会把「升级现场」
  伪装成一个正常的只读环境），而是让每一次本地写回 `legacy-writer`（ingest / writeSyncBookkeeping /
  markMissing 都回它，rebuild 直接抛一句人话），并落诊断 `legacy-writer-restart`，文案是
  「还有窗口在用旧版本写这个工作区，请重启所有窗口」。每次写之前都会重查一次租约是否已过期。
- **不升 schema 版本**：旧代码看到比它新的 `user_version` 会整库重建（`resetForSchema`），
  那会毁掉数据。升级保护靠旧租约检测 + 文档要求全窗口重启，不靠版本号挡。

网络盘路径的写者标识用 `rw-<进程号>-<序号>` 前缀（旧代码是 `refresh-…` / `snapshot:…`），
只为日志与排查能一眼分出「读写锁版本写下的」还是「旧版本留下的」；判断只看租约有没有过期。

## 存储不设上限、不淘汰（2026-11-05，#1922）

有了 SQLite 做存储之后，按需细节（正文、评论、评审、子票清单）不再设条数或字节上限，
也不做「超出上限就丢掉」的清理——不设上限、不淘汰。维护者的决定：「我们就不限制上限了，
也不要淘汰了。数据库里面存的数据，除非源头被删除，否则不会再消失。」

- **为什么不设**：淘汰是当年为「单份 JSON 快照整体读写」设计的成本模型；今天按行存、按需查，
  那套成本模型不再成立，而容量清理会与「库是唯一真相」冲突——同一张票今天有正文、
  明天因为最近没打开就没了，用户会当成数据丢失。
- **不设上限不等于不看住**：`runtime/storage-stats.ts` 的 `readStorageStats()` 报库文件字节数
  与票行数，环境检查页的能力诊断把这两个数显示出来（`wf.snapshotStoreStats`）。
  它们只用于观察增长，不参与任何删除决定。
- **两个口径**：字节数只算主文件与 WAL（`-shm` 是进程共享内存在盘上的映射，不是数据）；
  行数是 `issue` 表的行数（一行 = 一张票，墓碑不删行，所以行数只随票的出现增长）。
- **守它的门禁**：`tests/verify-1922-retire-eviction.ts`——源码里不再有淘汰规则与调用、
  库里没有容量清理路径、诊断读数在真库上能读出字节数与行数。

## 三态与版本门（速记）

- 一组数据有四种库内状态：没有行 = 从没取过；`complete` = 完整；`truncated` = 只拿到一部分；
  `unknown` = 明确不知道（带 reason）。
- `complete` 可以整组覆盖或清空（值为 null / 空数组 = 确认没有）；`truncated` 只补空缺，
  不删旧值；`unknown` 与没表达都不动值。
- 一批写入带 `startMergeVersion`。事务里发现任一被表达组的 `written_version` 大于它，
  整批丢弃（stale），库里一个字节不改。
- 八个字段组各有一个主人：`row`（票骨架列）、`body`（正文，独立表）、`labels`、`assignees`、
  `parents`（父票边）、`blockedBy`（阻塞边）、`subIssues`（子票计数三列）、`mergeInfo`（合并时间）。
  子票计数与合并时间不放进 `row`：行组是「整行我都知道」的语义，详情读结果未必知道这两项，
  混进去会把列表学到的值一起抹掉。
- 评论与评审是另外两组（`comments`、`review`，十组只有详情会读）：评论按页取，`truncated`
  只覆盖从头数的那几条、不删已知的后面几条，`complete` 才整组换掉；取到第几条记在
  `fetch_cursor`（游标只许前进，`complete` 时可以跟着上游一起回退）。评审没有 id，整组替换，
  `complete` 时的空数组才是「确认没有评审」。
- 写回执追加一条评论（#1866）走 `IssueGroupsWrite.commentReceipt`，不走 `comments` 那一组：
  它只知道「多了一条、在最后」，不是从头上数的一页。位置用票面总数（新评论的下标），
  那个位置已经有评论就往后挪，宁可位置不精确也不删已知的那条；游标只在评论组本来完整时
  跟着条数走，只有一部分时一个字节都不动 —— 动了会让「加载更多」跳过中间那几条。
- 关系只有一张边表：父是谁、谁阻塞我、我阻塞谁、谁是我的子票四个方向都从它读出
  （`projection/edges.ts` 的正向与反向查询），不各存一份，所以不会互相矛盾。
- 拉取请求与工单一样落库（#1870）：库是工作区数据的权威副本，面板的拉取请求页签读的就是这些行
  （接口里的 `isPullRequest`、`merged_at_ms` 与 `review` 表都是为它们准备的）。只有「算增量索引」
  那两处把它们排除在外——远端索引的来源只翻普通工单列表，PR 混进去会被每一轮探测判成「有票被删掉」。

## 版本、墓碑与迁移（#1886 起）

- **版本**：每次提交让库版本（`meta.merge_version`）+1；行上的 `last_change_version` 记这一行最后一次
  被写的版本，「v12 之后变了哪几行」靠它回答。
- **墓碑**：删除不物理删行——`issue_tombstone` 记「某票在某版本被确认不存在」，列表投影与变化集都读它；
  同一张票再被写入时墓碑自动清掉（它只表达「这一版里不在」）。
- **迁移**：结构升级走 `persistence/migrate.ts` 的加列/建表语句，不再整库重建；只有迁移失败、或库结构
  比本代码新，才回退到整库重建并落诊断。
- **变化集**（#1890）：`readChangeSet` 按 `last_change_version` 与 `issue_tombstone.version` 回「从某个版本到现在」
  变了哪些行、哪些行被判不存在；变化的行与墓碑各说各的，墓碑行不进变化的行。超过行数上限或客户端
  落后超过时间上限、客户端版本比库里大、或没有基线时 `full` 为真，调用方必须整份重取——
  这一层不交一份截断的变化集。
- **同步簿记**：水印、世代号、待办与「整仓是否完整取过」的标记都在 `meta` 里，与数据同生共死。
  句柄上读写的口是 `readSyncBookkeeping()` / `writeSyncBookkeeping()`；行级增量要把「变化的那几行」
  与簿记一起提交时，用 `ingest({ startMergeVersion, writes, sync })` 一个事务写下去（#1888）。
  `sync.expectedGeneration` 是库这一侧的世代门：库里世代号与它不等就整批丢弃（回 `stale`），
  行与簿记一个字节都不动。只写簿记的那一趟不动 `merge_version`（版本号只由数据提交推进）。

## 写回执与回执优先窗口（#1889 起）

- **写回执**：写操作成功之后 tracker 交回来的那张票，按组并进库（调用方传 `ingest({ kind: 'receipt' })`）。
  每一组在 `issue_group.receipt_ms` 上记下「上次由回执写入的时刻」；提交之后界面才该更新。
- **回执优先窗口**：回执提交后的一个短窗口（`config/ttl.yaml` 的 `snapshotReceiptPriorityMs`，
  经生成器进 `SNAPSHOT_RECEIPT_PRIORITY_MS`）之内，任何**读结果**都不得覆盖回执表达过的字段组。
  它补的是版本门挡不住的那种迟到：写已经在 v10 提交，一趟读 v10 才开始、却从远端拿到写之前的状态。
- **按组判，不是整行挡**：回执表达过的组让给回执，其余组照常更新；窗口一过读结果照常覆盖。
  `unknown`（只盖章不动值）的读结果不受影响。全部组都被挡下时这一趟不推进库版本——什么都没写，
  不该让客户端以为有变化。判据住 `merge/receipt-priority.ts`（纯函数），接线在 `runtime/ingest.ts`。

## 写路径清单（#1889 盘点结果）

| 写路径（文件:入口） | 行为 | 证据 |
| --- | --- | --- |
| 建票 `create`（`src/deck/tools/issue-create.ts` → 写事件 → `thin-row-fetch.ts` 的 receipt 回调） | 经库 | V1889 B11 |
| 关票 / 重开 `close`/`reopen`（`src/deck/tools/issue-patch.ts` → `recordWriteReceipt`） | 经库 | V1889 B1 |
| 发评论 `comment`（`issue-patch.ts` / 面板 `comment-thread-fetch.ts` 的 `storeCommentReceipt`） | 经库 | V1889 B9、verify-1866 |
| 改标题与正文 `update`（`issue-patch.ts` → `receiptIssueWriteOf`） | 经库 | V1889 B1/B2 |
| 改标签 `setLabels`（`issue-patch-labels.ts`） | 经库 | V1889 B3 |
| 改指派人 `setAssignees`（`issue-patch.ts` → `issueWriteOf` 的指派组） | 经库 | V1889 B4 |
| 父子边 `setParent`（`map-link.ts` → `parentsGroupOf`） | 经库 | V1889 B5 |
| 阻塞边 `setBlockedBy`（`map-link.ts` → `blockedByGroupOf`） | 经库 | V1889 B6 |
| 子票计数与合并信息（`issue-patch.ts` 的回执带 fieldStates） | 经库 | V1889 B7/B8 |
| `deck_issue_patch` / `deck_issue_create` / `deck_map_link` / `deck_map_plan_create` | 经库 | V1889 B1-B9/B11 |
| 面板发评论 `panel-comment`（`comment-thread-fetch.ts` 的 `storeCommentReceipt`） | 经库 | verify-1866-replay |
| `initProject` / `setLabelColors` / `ensureLabelColorsFile`（仓库级元数据） | 不经库 | 回执无票级字段；标签颜色随 labels 组入库 |
| `deck_issue_report`（在办表） | 不适用 | 规格 D2：在办表会话私有 |
| `publishFlow`（发布 npm 包） | 不适用 | 写的是注册表，不是工作区数据 |
| `handoffClaim`（会话交接） | 不适用 | 会话私有状态 |
| `namingGuardian`（命名持久化） | 不适用 | 规格 D2：不进库 |
| 拉取请求合并 | 不适用 | 本仓没有发起合并的写路径；合并信息走 mergeInfo 组（V1889 B8），S7 另票 |

「经库」= 写回执先提交进库、成功之后才更新界面；失败一个字节不改。表里每一条在
`tests/verify-1889-write-receipts.ts` 里都有对应的断言组。

## 统计（#1887 起）

面板顶上的六个数字（总数 / 开放 / 已关闭 / 可接 / 阻塞 / 已认领）由 `projection/counts.ts` 一条 SQL
从库里的行、指派与阻塞边算出，不再向后端要计数。口径写在 `model/types.ts` 的 `SnapshotCounts`
注释里，三条要点：

- **已关闭的票参与统计**：库装的是全仓票，首屏收窄发生在投影层，统计不受影响；
- **拉取请求与墓碑不算**：PR 有自己的页签，墓碑只表达「这张票不在集合里」；
- **可接 / 阻塞 / 已认领只数还开着的票**，并且「可接」要求指派组完整且为空、没有未关闭（或状态未知）
  的阻塞者 —— 不知道有没有人认领时不算可接（三态：不知道 ≠ 空）。

每个数字带一份完整度：库级同步簿记里的 `meta.full_enumeration_ms` 写过（整仓完整枚举被采用）就是
`complete`，否则是 `known`。写入点在整仓索引扫描的采用口：`issue-index-scan.ts` 的
`commitIssueIndex` 只在调用方明确说「这一趟是完整枚举、没被截断、行也确实写进库」时才回调
`issue-list-fetch.ts` 的 `markFullEnumeration`。窗口扫描、翻页被页上限或请求预算拦住、被推迟 /
丢弃 / 失败、以及行没写进库的那几趟都不写 —— 否则「完整」就是假的。界面按完整度选措辞：
完整直接说数字，没取全说「已知 N 张（未取全）」。

## 拉取请求的合并状态怎么进库（#1898 起）

首屏那条整份取数只问开放工作集（`composeSnapshot` 传 `state: 'open'`），索引扫描只翻
`repository.issues` —— 已关闭 / 已合并的拉取请求两条路都进不来，页签于是永远挂着「打开」。
补这一页的是 `issue-list-fetch.ts` 的 `refreshClosedPulls`：探针每拍探成之后顺手调一次，
节拍与页上限都由它自己判。

- **节拍**：同一工作区 10 分钟内最多跑一趟（`config/intervals.yaml` 的
  `closedPullRefreshIntervalMs`），不跟着 5 秒一拍的探测走；失败也算跑过，下一个窗口再试，
  不会每拍重试把额度烧在同一个失败上。
- **请求上限**：每轮最多翻一页（`kernel/host-budget.ts` 的 `CLOSED_PULL_REFRESH_MAX_PAGES`，
  一页 50 条、一条请求）。`OpContext.listMaxPages` 把它交给读路径，翻到这一页就停并如实记成截断。
  按更新时间倒序取，刚合并的那几条就在第一页里；更早的历史不会被翻到。
- **写什么**：行、合并时间（`mergeInfo` 组）、评审（`review` 组）一起进库，来源仍是
  `refresh-list`。页签读的是库里的行（`prStateKind` 按 `mergedAt` 判「已合并」），
  所以关掉面板重开之后仍然是已合并。
- **已知边界**：只补最近更新的一页。很久以前合并、又不在那一页里的拉取请求不会因此翻新；
  逐条翻历史是另一件事（会把额度吃穿，本票不做）。

## 门禁

- `tests/verify-1862-snapshot-merge.ts`：纯合并规则与版本门判据，不碰数据库。
- `tests/verify-1862-snapshot-database.ts`：真实临时目录 + 真 SQLite，覆盖关库重开、
  失败回滚、两个本地写者都提交、版本门、损坏重建、身份不符重建、列表投影与构建登记。
- `tests/verify-1932-multi-window.ts`：本地多窗口可写——两个句柄与两个真子进程同时写同一份库、
  空闲窗口不占写权、关掉一个另一个照写、旧租约未过期时拒绝本地写并在过期后自动恢复、
  网络盘仍是单写者回退、设置页「写模型」三格读数（storageKind / mode / legacyWriterBlocked）
  与 UNC / 盘符 / POSIX 三路路径判定。
- `tests/verify-1933-network-fallback.ts`：网络盘 / UNC 单写者回退与设置页诊断——路径判定与
  storageKind 覆盖、第二个句柄只读但仍能读、关掉第一个之后第三个接手写、本地盘两个句柄都可写、
  写模型五档文案键与中英词条、列表不出现回退原因（损坏重建仍要说）、租约三列与两个时长配置保留。
- `tests/verify-1863-snapshot-edges.ts`：父子边与阻塞边的三态写入、引用骨架、删除级联。
- `tests/verify-1863-snapshot-library-replay.ts` 与 `verify-1863-snapshot-cold-start.ts`：
  列表读结果按组写库、断网冷启动首屏只读库。
- `tests/verify-1864-snapshot-detail.ts`：详情按组写库（正文、标签、父票、阻塞、子票计数、
  合并信息）、四个方向同一份边表、确认没有与不知道分得开、引用骨架、关库重开。
- `tests/verify-1865-snapshot-comments.ts`：评论按页写库并推进游标、评论正文与作者落库、
  评审整组替换不残留、版本门对这两组同样生效、关库重开后都还在。
- `tests/verify-1865-snapshot-comments-replay.ts`：宿主两条电话把评论按页写库、重启后详情与
  「加载更多」都从库出（取数次数为 0）、断网时交回上次已知。
- `tests/verify-1866-write-receipt.ts`：写回执落库（评论、状态、标签三类，真 SQLite）：
  回执里的值与库里读回来的逐项相同、关库重开后仍在、整批事务、库不可用时明示降级。
- `tests/verify-1866-write-receipt-replay.ts`：宿主那两条路（面板发评论、写事件补行）先落库
  再更新界面；发评论失败时库不改；落库失败时不并进快照（界面保持旧值）。
- `tests/verify-1866-write-ui.ts`：评论输入框的判据（库里评论组知道就给）、写失败不乐观更新、
  「发出去了但没存进本地库」这句文案中英各一份。
- `tests/verify-1922-retire-eviction.ts`：按需细节的淘汰机制退役——源码里不再有淘汰规则模块、
  调用与日志字段，界面只剩三态（没有「曾取过但被淘汰」），库里没有容量清理路径，
  环境检查页的诊断读数在真库上读得出库文件字节数与票行数（关库重开后数据还在）。
- `tests/verify-1890-read-channels.ts`：真 SQLite 临时库 + 假后端驱动版本查询与变化集两条读口——
  版本查询只回三格且与库里的版本一致、变化集含变化行与墓碑且条数与库一致、行数与时间越线回整份、
  版本回退回整份、快照与探针回包键集不变、环境检查页的诊断读数显示当前库版本。
- `tests/verify-1887-counts-from-library.ts`：真 SQLite 临时库 + 假后端——六个数字与另一条独立 SQL
  逐项相等（含已关闭票、墓碑、拉取请求、缺指派组、部分指派、阻塞目标不存在），完整枚举被采用之后
  完整度变「完整」、被截断与窗口扫描之后仍是「已知」、关库重开后仍「完整」，变化集回包带同一时刻
  六个数字，一条 SQL 与 1000 张票上的 5 毫秒预算。
- `tests/verify-1888-changes-to-store.ts`：后台发现的变化先写进库——差分基线从库读、水印/世代号/待办
  写进库级元信息并在关库重开后仍在、库写入失败时内存副本不改、迟到的整池结果被世代号挡住、
  行级增量的回包键集与改造前一致。
- `tests/verify-1898-pr-merged-refresh.ts`：已关闭 / 已合并的拉取请求被取回（只问拉取请求那条查询、
  CLOSED + MERGED 两档）、受页上限约束地补一页进库（行 + 合并时间 + 评审）、关库重开后仍是
  「已关闭 + 合并时间」、页签渲染出「已合并」、补取节流与探针接线。
- `tests/verify-1889-write-receipts.ts`：写路径清单与操作百科逐条对账（经库 / 不经库 / 不适用）、
  十类写各自先落库再显示、整批失败不留半写、回执优先窗口的字段组粒度与时间边界（真 SQLite + 假时钟）。

单扇跑法：`node --import ./scripts/ts-hook.mts tests/verify-1862-snapshot-database.ts`。
