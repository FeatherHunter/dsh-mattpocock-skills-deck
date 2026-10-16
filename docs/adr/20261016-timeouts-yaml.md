# ADR：全仓 TypeScript 时间参数收进中央 YAML（#1215）

> 日期：2026-10-16 定版
> 地位：本文件是「时间参数该放哪、谁能改、改了谁说了算」的唯一依据。凡与本文冲突的旧写法以本文为准；未来任何讨论若改动本决策，以未来版本为准（CONTEXT.md 同款两条规则）。
> 关联：#1215（落地票）· `research/timeout-centralization-inventory.md`（收拢前的完整清单）· `src/shared/refresh/src/tuning.ts`（#1069 的旧收拢，本文件将其定位为“只搬运的第一步”，见 §6）· `tests/verify-895-bulk-deadline.ts` 第⑦节（双生子同值断言，见 §4）

---

## 1. 背景

时间参数（超时、节拍间隔、有效期、退避序列）散在约 40 个文件里：改一个时间要先找到它，搜出来还经常是三四个同值不同命的写法（8 秒在 GitLab 房里同时是常规读、列表查询与建票重试）。收拢前排查出 TypeScript 侧 63 个键（含函数级默认值这种第二层，例如配额同步冷却 60000 与注册重试等待 2000），另有 `.js` 存量按用户决断不动。

## 2. 决策

人改的唯一地方是 `config/timeouts.yaml`（四组：timeouts 单次等待上限、intervals 节拍间隔、ttl 有效期、backoff 退避序列，单位一律毫秒）。生效处是生成的 `src/shared/time-config/src/values.ts`（签入版本库，diff 即调参记录），由 `scripts/generate-time-config.mjs` 写出。

三条配套纪律，违反即判红：

1. **人手不改生成物**：`generate-time-config.mjs --check`（挂在 `npm run typecheck` 最前面）与 `tests/verify-time-config.ts` 第一节同时看守。
2. **YAML 缺键不炸**：缺的键用回落底座顶上（值 = 收拢当天各文件的数字），只告警。所以“先加调用、后补 YAML”合法；未知键一律报错（多半是拼错，静默忽略等于让拼错的键看起来生效了），拼错时生成器按编辑距离提示最像的那个键。
3. **新参数必须先登记**：`tests/verify-time-config.ts` 第三节扫描全部 `src/**/*.ts`，新冒出来的时间常量要么入表（IMPORT/TEXT），要么在 EXEMPTS 里写明理由。理由写不清的就不该豁免——那是漏登记的参数。

## 3. 五条架构约束（定版时逐条核实过，违反任何一条本方案即不成立）

1. `register-options.ts:37` 零导入约束：`AGENT_TOOL_TIMEOUT_MS` 保留字面量，门禁只断言值相等（该文件永久 literal）。
2. 共享域之间不许互相 import（`tests/verify-dependency-rules.ts` 红线）：`budget.ts`、`tuning.ts`、`write-ticket.ts` 保留自己的常量，门禁只断言值相等。
3. 客户端无运行时 import：客户端吃的两个值（`settingsDebugPushWaitMs`、`mapTicketsTtlMs`）走构建 splice（`build.mjs` 的 refreshBudget 先例），S5 已落地（`shared:timeConfig` 标记位，消费处写 `declare const`）。
4. 房间可引 `^src/shared/`（`tests/tracker-room-imports.json:7`，#1159）：房间侧 import 无需改 allowlist。
5. `yaml@^2.9.1` 已是正式依赖：生成器不引入新包。

## 4. 五个永久 literal（不是没迁完，是架构上不能迁）

`budget.ts`（18 项）、`tuning.ts`（`deckEnsureTimeoutMs`，另见 §6）、`write-ticket.ts`（`TICKET_TTL_MS`）、`register-options.ts`（`AGENT_TOOL_TIMEOUT_MS`）、`src/host/index.ts`（`TIMEOUT_MS` 30000 与 `CACHE_MS` 60000）。其中宿主入口这两项是 S4 落地时加进来的：入口禁静态 import（该文件 H7 #515 注释的 D7 约束，构建 host-dev 产物过 `vm.Script` 语法预检，静态 import 当场判红），所以沿用“留字面量、门禁锁值”的口径，调时间同样改 YAML。双生子（`call-budget.ts` 的 `DEFAULT_TOOL_TIMEOUT_MS` 与 `register-options.ts` 的 `AGENT_TOOL_TIMEOUT_MS`）的三方同值由 `tests/verify-895-bulk-deadline.ts` 第⑦节（S6 起断言“两处字面量与 YAML 同值”）与本门禁第二节共同看守。

## 5. 明确不入 YAML 的（门禁 EXEMPTS 表逐条有理由，这里只记分类）

- 非时间数字：点数、条数、单价、比例、页数、次数（`budget.ts` 三十余项）、桶容量（tuning 的两个）、`HOUR_MS` 单位换算、`MIN_BACKOFF_STEPS` 步数。
- 透传与计算值：函数内局部变量（接已登记参数）、注入结构体的字段（attention/policy/write-detect 三处）、别名（`ledger.ts` 的 `SYNC_INTERVAL_MS` 恒等于 `QUOTA_SYNC_INTERVAL_MS`）、读钟测量值（`nowMs`/`elapsedMs`/`latencyMs` 一类）、verdict 输出的等待结果。
- 纯界面闪停（`views/*.ts` 的 600/1300/1500 等）与客户端调度节拍（`api-io.ts` 的 120/0）：不是超时语义，不入。
- `.js` 存量全部不动（用户决断）：`versionControlWrite.js` 的总预算 10000、`skillProbeCache.js`、`predicateCore.js` 的 3000 pending 判定等，动到谁再按“随改随迁”转 TS，届时再入 YAML。这条口径已经实际走了一次：`src/host/refresh/wiring.js` 转成 `wiring.ts`（#1155 那条线）之后，它本地读等待的 5000 按本条入了 YAML（`deckLocalReadMs` → `DECK_LOCAL_READ_TIMEOUT_MS`），装配层传给壳的 resolve 步 8000 改读已登记的 `shellResolveMs`。

## 6. 与 #1069（tuning.ts）的关系

`tuning.ts` 是“只搬运不统一”的第一步（它的文件头自己就是这么写的），本票是第二步：中央登记。两者不冲突——`tuning.ts` 的时间字段保留，值由本门禁看守与 YAML 一致；那张票定的“本轮不统一数值”（同值不同命的不合并）继续有效，本票的键里同值不同命的各自保留独立的键（例如 `deckStoreMs` 10000 与 `deckEnsureMs` 15000 是两件事，`deckLocalReadMs` 5000 与 `deckEnsureMs` 15000 也是两件事）。

## 7. 怎么判（门禁总览）

- `tests/verify-time-config.ts`：新鲜度（生成物与 YAML 一致）＋ 值一致（IMPORT 按导出比、TEXT 按字面出现次数比，每行同时锁文件写法与 YAML 生效值）＋ 覆盖率（新常量先登记）。
- `node scripts/generate-time-config.mjs --check`：挂在 `npm run typecheck` 最前面（typecheck 先于 build，生成物不对时检查期就停，不进构建）。
- `node scripts/build.mjs`：进域循环前先重算生成物（YAML 改了、生成物没提交时，构建按 YAML 重算，不读旧数字）；`config/timeouts.yaml` 已进构建输入指纹。
