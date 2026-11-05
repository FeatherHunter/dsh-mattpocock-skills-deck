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

## 门禁

- `tests/verify-1862-snapshot-merge.ts`：纯合并规则与版本门判据，不碰数据库。
- `tests/verify-1862-snapshot-database.ts`：真实临时目录 + 真 SQLite，覆盖关库重开、
  失败回滚、第二写者只读、版本门、损坏重建、身份不符重建、列表投影与构建登记。
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
- `tests/verify-1889-write-receipts.ts`：写路径清单与操作百科逐条对账（经库 / 不经库 / 不适用）、
  十类写各自先落库再显示、整批失败不留半写、回执优先窗口的字段组粒度与时间边界（真 SQLite + 假时钟）。

单扇跑法：`node --import ./scripts/ts-hook.mts tests/verify-1862-snapshot-database.ts`。
