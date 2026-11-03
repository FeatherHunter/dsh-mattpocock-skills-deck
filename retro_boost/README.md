# retro_boost —— 把「验证、建树、暂存、复盘」里反复出现的操作压成脚本

这个目录来自一次 69 分钟工具时间的复盘（2026-11-03 的 #1839 / #1852 任务）。复盘发现时间主要花在四类重复动作上：反复起全链并轮询、在干净工作树里踩缺依赖/缺构建产物、在主树很脏时手工暂存、事后手写脚本分析会话日志。下面六个脚本各管一段，全部只用 Node 与 git，没有第三方依赖。

## 先看数字：一次长任务的时间去哪了

同一段会话日志跑 `session-stats` 的结果：

| 项目 | 数值 |
| --- | --- |
| 前台工具总时长 | 73.1min（其中 turn5 占 56.6min） |
| `job_output` 等待 | 42.5min / 17 次调用（11 次 `wait=true`，单次常 4–5min） |
| `pwsh` 调用 | 19.2min / 173 次 |
| 后台任务总时长 | 91.6min / 166 个（最长三条：两次无效全链 21.8 / 21.6min，进程扫描轮询 17.1min） |
| `deck_*` 工具 | 约 9.5min（含后端超时重试） |

所以可压的部分很集中：**同一段等待被拆成十几次 `job_output`**、**两次白跑的全链**、**建工作树后的第一次失败**、**手工暂存时的试错**，以及**事后为统计又写一遍脚本**。

## 六个脚本

### `chain.mts` —— 提交前只起一次全链

```powershell
node retro_boost/chain.mts                       # 跑 npm run verify:parallel 等价的全链
node retro_boost/chain.mts --log D:\temp\chain.log --result D:\temp\chain.json
```

直接 spawn `scripts/verify-parallel.mts --keep-going --json <本次专属结果文件>`，只打「进度 / 全绿或失败清单」，不刷几千行 PASS。结果文件每次带 pid 与时间戳，**不和别的会话共用** `node_modules/.cache/dsh-verify-last.json`。默认还加一把仓库级串行锁（`node_modules/.cache/retro-chain.lock`）：别的会话正在跑时排队等待，持有进程退出或锁超过 4 小时自动失效；确实要并发时加 `--no-lock`。注意直接跑 `npm run verify:parallel` 的会话不认这把锁，所以它只能减少、不能彻底消除并发争用。`--log`、`--result` 只允许仓库内或系统临时目录。`--cmd` 是给脚本自身拍字节用的逃生口，必须显式加 `--allow-cmd` 才会执行。

### `quickcheck.mts` —— 改完一处，只跑点名的几扇门禁

```powershell
node retro_boost/quickcheck.mts verify-1852 verify-1839
```

每个名字只在 `tests/verify-*.ts` 里找，并发跑，解析 `GATE-RESULT` 后只打一行结论（失败时附前三行原文）。实测两扇 2.5 秒。名字解析后做真实路径校验，`../`、软链接、绝对路径都进不来。

### `worktree-bootstrap.mts` —— 一次建好「能直接跑门禁的工作树」

```powershell
node retro_boost/worktree-bootstrap.mts 1852-budget-model --ref f003c705 --files src/a.ts,tests/b.ts
node retro_boost/worktree-bootstrap.mts 1852-budget-model --ref f003c705 --regen --dry-run
```

建树 → 把主树的 `node_modules` 以 junction 接进来 → 复制你正在改的文件 → 构建（干净工作树没有构建产物，不建直接跑必报 `ERR_MODULE_NOT_FOUND`，白等二十分钟）→ 可选重录归属表。名字有白名单、`--ref` 先解析成提交哈希、`--files` 必须落在工作树内；工作树路径限定在 `.worktrees/` 下。构建会执行该提交里的 npm 脚本，只对可信提交跑。

### `stage-mine.mts` —— 主树很脏时，只把自己的文件写进索引

```powershell
node retro_boost/stage-mine.mts --from .worktrees/1852-budget-model
node retro_boost/stage-mine.mts --from .worktrees/1852-budget-model --files src/a.ts --dry-run
```

用 `git hash-object -w` + `git update-index --cacheinfo` 把工作树里的文件对象直接写进主树索引，**主树工作区里别人的改动一个字不动**。先校验两个目录属于同一个仓库（比较 `git-common-dir`），路径必须是相对路径且不越界；删除项只从索引移除，不碰磁盘。以前用「导出 patch 再 apply」会被换行符坑（`patch does not apply`），这条路不会。

### `precommit.mts` —— 提交前自检「暂存的是不是自己要的」

```powershell
node retro_boost/precommit.mts --expect src/refresh/,tests/verify-1852
```

只读：列出暂存清单、标记不在 `--expect` 前缀里的文件、跑 `git diff --cached --check` 查空白与冲突标记、提醒未跟踪文件与大文件。有意外文件或空白问题 exit 1。多会话共用索引时，这一下能拦住「把别人的改动卷进自己的提交」。

### `session-stats.mts` —— 回答「时间都去哪了」

```powershell
node retro_boost/session-stats.mts --session latest --top 10
node retro_boost/session-stats.mts --json
```

读 `DSH_HOME/sessions/` 下的会话日志，输出每轮墙钟/步数/前台工具占比、按工具耗时排名、最慢调用、后台任务按类型与清单、`wait=true` 的等待合计、LLM 重试次数。会话文件是「多个连续 zstd 帧直接拼接」，Node 的 `zstdDecompressSync` 只解第一帧、流式会报 `Unknown frame descriptor`，脚本按帧魔数切帧逐个解。解压有上限（512MB / 20000 帧），输出会把常见凭证形状打码，但日志里仍可能有命令原文，贴到公开处前请再检查。

## 场景 → 用什么脚本

| 场景 | 用哪个 |
| --- | --- |
| 改完一处，想确认没弄坏相关门禁 | `quickcheck.mts <门禁名>` |
| 一个模块写完 / 提交前 | `chain.mts`（全链仍是唯一裁决入口） |
| 并行会话要求开独立工作树 | `worktree-bootstrap.mts <名字> --ref <提交> --files <文件>` |
| 主树混着别人的改动，只想暂存自己的 | `stage-mine.mts --from .worktrees/<名字>`，然后 `precommit.mts --expect …` |
| 复盘一个长任务为什么耗时间 | `session-stats.mts --top 20` |
| 怀疑某个门禁其实在空跑 | `quickcheck.mts` 单跑对比；再看 `chain.mts` 的结果文件 |

## 能加速多少（估算）

| 操作 | 现在（本次实测） | 用脚本后 |
| --- | --- | --- |
| 提交前全链 | 10–17 次调用、约 40min 工具时间、数十 K 输出 | 1 次调用、约 20min、约 1K 输出 |
| 单跑 1–3 扇门禁 | 2–4min（逐条起进程并读输出） | 2–5s（并发 + 只读结论行） |
| 新工作树准备到第一次门禁 | 5–8 次调用、一次 21.8min 空跑、build 1min、排错约 10min | 1 次调用，约 2min |
| 脏主树暂存 | patch 试错约 10min（本次失败 2 次） | 1 次调用，约 2s |
| 会话复盘 | 手写脚本到这个程度约 35min | 1 次调用，约 2s |

按本次 73.1min 前台工具时间推算，这套脚本覆盖掉的主要是「等待与试错」部分，**预计可压到 30–38min（省约一半）**；剩下的 deck 工具、读证据、写代码、跑有效全链的 18–22min 是省不掉的真实工作。

## 边界与注意

- **不替代仓规**：提交前仍必须跑全链，本地验证仍是唯一裁决口径；`chain.mts` 只是把「跑 + 看」压成一次调用。
- `retro_boost/` 不属于任何门禁的归属范围，按 `docs/agents/verification.md` 规则 3，改动它会触发全链——**提交这六个脚本本身要付一次全链的代价**。第一次入库时已付过：在干净工作树（`.worktrees/retro-boost-commit`，HEAD `a31007fc`）跑全链 550/550 步，唯一的红是「构建缓存不是合法的 JSON 文件」这类环境问题，重建后该门禁 23/23 通过。
- 只在 Windows + Node 24 上实跑过；junction 在别的系统会退化成目录软链接。
- 索引是主树共享的：`stage-mine` 暂存完请立刻 commit，别和别的会话抢同一个索引。
- `worktree-bootstrap` 接进来的 `node_modules`（含其中的构建缓存）也是主树共享的：同一台机器上同时跑两三条全链时，构建缓存可能被并发写坏（实测会冒出「构建缓存不是合法的 JSON 文件」这类与环境有关的假红）。遇到时等别的会话跑完再跑一次，或先看失败是否集中在缓存/子进程类门禁。
- 还没脚本化的候选：真机批次证据汇总（`D:\temp\matt-batches` 的 run.json/evidence 摘要）、门禁失败归因（把 `dsh-verify-last.json` 的失败按归属目录分组）、技能导航指针（减少 8.9min 级别的目录搜索）。需要时再加。
