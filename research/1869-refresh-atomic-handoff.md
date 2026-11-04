# #1869 刷新写库与整轮原子：交接记录（2026-11-04）

## 现在到哪了

- #1869 已由人指令重开（open，进度 80%）。
- #1663 的 `1869-02` 已从「通过」改为「失败（→ #1869 重验）」，并追加了更正评论；历史结果评论没有改写。
- 当前分支 `integ/1861-snapshot-sqlite`，HEAD `01c3efae`；刷新写库的修复在本次提交里（全链 570/570 绿）。
- 根因：手动刷新 `wf.refresh` 从来没有把行写进快照库。
  - `src/host/index.ts` 的 `_sessRef` 没有注入 `getSnapshotLibrary`（`_sessSnap` 有）。
  - `src/refresh/rooms/host/session-refresh-schedule.ts` 的 `ComposerOpts` 没有 `onRows`，两条 composer 路径都没传。
  - 只有 `src/refresh/rooms/host/session-snapshot-cache.ts` 的 `wf.snapshot` 在「库为空、没有回放」时传 `onRows: first.writeRows`；库一旦有数据，首屏回放，composer 不跑。
  - 结果：库只在第一次空库加载时写；手动刷新永远不写，重启回到旧数据。

## 已实现（本次提交）

1. `recordIssueRows` 增加 `atomic: true`：整批只调一次 `handle.ingest`，一个 SQLite 事务；stale 整批重试一次；失败整批回滚。
2. `snapshot-library-first-screen.ts`：`writeRows` 只把行收在内存里，新增 `commitRows()` 在组装成功后整批写库；`session-snapshot-cache.ts` 在两条 composer 路径成功后 `await first.commitRows()`。
3. `session-refresh-schedule.ts`：两条 composer 路径接 `onRows: collectRows`；组装成功后 `persistRefreshRows(cwd, backendId, repoRef)` 调 `recordIssueRows({ atomic: true })`；写库失败整趟刷新失败（不再只更新内存）。
4. `src/host/index.ts`：`_sessRef` 补 `getSnapshotLibrary: function () { return _snapLib() }`。
5. composer 接 `logCtx`；`LOG_EVENT_LIST` 补 `snapshot.workingSet` 常驻申报（字段与 appendix #149 / `tests/verify-log-fields.ts` 一致）。

改动清单（`git status`）：
- `scripts/generated/logKernel.derived.js`
- `src/host/index.ts`
- `src/refresh/rooms/host/session-refresh-schedule.ts`
- `src/refresh/rooms/host/session-snapshot-cache.ts`
- `src/refresh/rooms/host/snapshot-library-first-screen.ts`
- `src/refresh/rooms/host/snapshot-library.ts`
- `src/shared/log-event-list.ts`

## 已经验证到的

- 重建后（含 `_sessRef` 的 `getSnapshotLibrary`）用 Markdown 夹具 2000 张票做了正常刷新：
  - 刷新前库是「旧标题」，磁盘票文件是「新标题」；
  - 刷新后日志：`workspaceSnapshot.ingest committed:true writes:2001 startMergeVersion:11 mergeVersion:12 elapsedMs:1084`，第二次 `writes:2001 … elapsedMs:739`；都是**一条整批**，不是 11 条 200 的分批；
  - 面板显示「新标题」。
- 修之前同一现场：`host.call wf.refresh ok latencyMs:20196`，没有任何 `workspaceSnapshot.ingest`，库文件停在刷新前，重开仍是旧标题。
- 已跑过的单测（修 `atomic` 与首屏整批提交之后）：`verify-1863-snapshot-cold-start` 33/33、`verify-1867-snapshot-gitlab` 51/51、`verify-1868-snapshot-markdown` 44/44、`verify-1869-offline-first-screen` 39/39；`node scripts/build.mts --pkg-only` 通过。
- **全链已跑：570/570 步、主链真红 0、冒烟 8/8 真红 0**（2026-11-04 收尾）。`logCtx` 与 `snapshot.workingSet` 已进本次构建，但真机日志里还没确认这一行；写事务中间强杀复验还没做。

## 接下来按这个顺序做

1. **重建 + 复验写前标记**：`node scripts/build.mts --pkg-only`，把 `package/` 复制到 `D:\Temp\matt-rm\home\profiles\web\node_modules\dsh-mattpocock-skills-deck`，启动实例，打开 Markdown 工作区，确认刷新时日志里出现 `snapshot.workingSet`（`logCtx` 已接；如果仍没有，先查 composer 的 `fire` 与 `LOG_EVENT_LIST`）。
2. **写事务中间强杀**：
   - 当前夹具 DB 是「新标题」，票文件也是「新标题」；把票文件改成 `v2-<i>`；
   - 点刷新；用 `snapshot.workingSet` 作为「工作集已取齐、马上开始写」的标记，100–300ms 后 `SIGKILL` DSH 宿主；
   - 重开面板（或直接读库），数标题：必须**全是新标题**或**全是 v2**，不能一半一半；
   - 再跑一次不杀的刷新，重开必须是全是 v2。
   - 夹具：`D:\Temp\matt-rm\md-workspace`（2000 张票，`.scratch/atomic/issues/0001-atomic.md …`；地图 `.scratch/atomic/map.md`）。
   - 现有脚本：`.scratch/rm/md-refresh2.mjs`（normal/kill 两种模式；kill 模式已在 `snapshot.workingSet` 后 100ms 杀）；`.scratch/rm/retitle-md.mjs`（当前写「新标题」，改成 v2 用）。
3. **补门禁**：
   - 宿主层：`handleRefresh` 必须让库的 `mergeVersion` 前进，或至少 `recordIssueRows` 被调用；不能只测 `wf.snapshot`。
   - 库层：子进程在 `handle.ingest` 事务中间被 kill，重开仍是旧库（原子回滚）；再写一次成功，全部变新。
   - 新门禁按仓库规矩登记：文件头 `// 门禁归属: …`、`scripts/gate-map.mts` 的 `COMPLETION_RECORDED_GATES` 实测条数、`node scripts/gate-map.mts` 重生成 `tests/gate-map.json`。
4. **全链 + 提交**：已完成，全链 570/570 绿；提交标题「刷新整轮写进快照库：补 onRows 与一个事务的整批提交（#1869）」，已推送。
5. **新候选 + 复验**：冻结新批次（建议 `rm-1869c`），装 `D:\Temp\matt-rm\home`，按 #1663 的场景块 1869 复验；至少 02，01/03/04 因宿主改动也建议一起复验。结果评论带验证身份行，更新 #1663 正文 1869-02 回「通过」，再关 #1869。

## 现场与路径

- 工作树：`D:\dsh-plugin\dsh-mattpocock-skills-deck\.worktrees\1104snapshotsqlite`
- 批次 home：`D:\Temp\matt-rm\home`（web profile，已装旧候选；重建后需覆盖插件）
- 批次工作根：`D:\Temp\matt-rm\work`
- Markdown 夹具：`D:\Temp\matt-rm\md-workspace`
- 证据：`D:\Temp\matt-rm\evidence`；旧批次归档 `D:\Temp\matt-rm\archive\rm-1869b-2026-11-04T14-02-50-215-08-00`
- 正常刷新证据日志：`D:\Temp\matt-rm\work\instances\977df1f95f8f659f\workdir\.dsh-mattskillsdeck-cache\logs\2026-11-04.log`
- 修前证据日志：`D:\Temp\matt-rm\work\instances\b278493ba734df07\workdir\.dsh-mattskillsdeck-cache\logs\2026-11-04.log`
- 当前实例已停；`dsh-verify` CLI 路径：`node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js`
