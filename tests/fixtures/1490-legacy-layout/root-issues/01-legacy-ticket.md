<!-- DSH-IDEMPOTENCY-KEY: legacy-fixture-ticket-01 -->
<!-- created: 2026-10-23T02:10:00.000Z -->
# 旧布局普通票：同步脚本一次全量覆盖

## What to build

把同步脚本改成一次全量覆盖，不再逐文件挑拣。

## Acceptance criteria

- 跑一次同步脚本，五个仓的中英文 README 联系区块全部更新。
- 重复执行结果不变（幂等）。

Status: open
Blocked by:
Labels: ready-for-agent
