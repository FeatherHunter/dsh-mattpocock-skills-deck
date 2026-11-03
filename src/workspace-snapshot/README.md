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
projection/    只读投影：把库里的行拼成列表要的形状
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

## 门禁

- `tests/verify-1862-snapshot-merge.ts`：纯合并规则与版本门判据，不碰数据库。
- `tests/verify-1862-snapshot-database.ts`：真实临时目录 + 真 SQLite，覆盖关库重开、
  失败回滚、第二写者只读、版本门、损坏重建、身份不符重建、列表投影与构建登记。

单扇跑法：`node --import ./scripts/ts-hook.mts tests/verify-1862-snapshot-database.ts`。
