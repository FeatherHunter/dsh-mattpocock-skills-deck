# ADR：全仓时间参数收进中央 YAML（#1215）

> 日期：2026-10-16 定版；同日增补第二轮（全量收拢，见 §2.1）
> 地位：本文件是「时间参数该放哪、谁能改、改了谁说了算」的唯一依据。凡与本文冲突的旧写法以本文为准；未来任何讨论若改动本决策，以未来版本为准（CONTEXT.md 同款两条规则）。
> 关联：#1215（落地票）· `research/timeout-centralization-inventory.md`（收拢前的完整清单）· `src/shared/refresh/src/tuning.ts`（#1069 的旧收拢，本文件将其定位为“只搬运的第一步”，见 §6）· `tests/verify-895-bulk-deadline.ts` 第⑦节（双生子同值断言，见 §4）

---

## 1. 背景

时间参数（超时、节拍间隔、一次性延时、有效期、退避序列）散在约 80 个文件里：改一个时间要先找到它，搜出来还经常是三四个同值不同命的写法（8 秒在 GitLab 房里同时是常规读、列表查询与建票重试）。

- **第一轮（只收 TypeScript）**：收拢前排查出 TS 侧 63 个键（含函数级默认值这种第二层，例如配额同步冷却 60000 与注册重试等待 2000）。存量 `.js` 当时按“用户决断不动”留在原地。
- **第二轮（全量收拢）**：用户要求“对整个源码做全量充分调查，把所有跟时间相关的参数也提取为配置文件”，并明说存放位置可由实现决定（可以放同一份，也可以放到同目录下另起的配置文件）。这一轮把存量 `.js`（宿主侧、共享层、界面半边）与界面里的裸字面量一起收了进来，新增 69 个键（第一轮 63 个 + 本轮 69 个 = 132 个）。第一轮“`.js` 不动”的口径自本轮起废止。

## 2. 决策

人改的唯一地方是 `config/` 下的三份 YAML——按“这个时间在管什么”分家，而不是按文件或按层分：

| 文件 | 管什么 | 键数 |
| --- | --- | --- |
| `config/timeouts.yaml` | 单次等待的上限，到点没回来就按失败或放弃处理 | 68 |
| `config/intervals.yaml` | 节拍间隔、一次性延时，以及末尾的退避序列 `chainBackoffMs` | 31 |
| `config/ttl.yaml` | 有效期，一份数据或一次判断过多久算过期 | 38 |

三份合计 137 个键（第二轮 133 键 + 对抗式审查补的四个，见 §2.2 末段）。

单位一律毫秒。唯一一处单位换算在 `src/host/gitCredentialExec.js`：git 的 `http.lowSpeedTime` 只认秒，那里把 `gitLowSpeedTimeoutMs`（20000）除以 1000，除法本身由门禁 TEXT 表锁住。每个键住哪份文件由 `scripts/generate-time-config.mjs` 的 KEYS 表第三列（分组）决定：
分组 `timeouts` → timeouts.yaml，`intervals` 与 `backoff` → intervals.yaml，`ttl` → ttl.yaml。
把某个键写错文件、同一个键出现在两份文件里、写了一个表里没有的键，生成器一律报错停下（拼错时按编辑距离提示最像的那个键）。

生效处是生成的 `src/shared/time-config/src/values.ts`（签入版本库，diff 即调参记录），由同一个生成器写出。

三条配套纪律，违反即判红：

1. **人手不改生成物**：`generate-time-config.mjs --check`（挂在 `npm run typecheck` 最前面）与 `tests/verify-time-config.ts` 第一节同时看守。
2. **YAML 缺键不炸**：缺的键用回落底座顶上（值 = 收拢当天各文件的数字），只告警。所以“先加调用、后补 YAML”合法；未知键一律报错（多半是拼错，静默忽略等于让拼错的键看起来生效了）。
3. **新参数必须先登记**：`tests/verify-time-config.ts` 第四节扫描全部 `src/**/*.ts` 与 `src/**/*.js`，新冒出来的时间常量要么入表（IMPORT/TEXT/CLIENT），要么在 EXEMPTS 里写明理由。理由写不清的就不该豁免——那是漏登记的参数。

### 2.1 第二轮为什么这样落地（三条与直觉不同的地方）

1. **存量 `.js` 不是“随改随迁”，是一次性收干净**。宿主侧的 `.js`（`versionControl*.js`、`gitCredentialExec.js`、`logStore.js`、`namingGuardian.js`、`skillProbe*.js`、`tracker/snapshot.js` 等）本来可以正常 import 生成值，本轮全部改成“别名接中央常量”（写法照 `src/host/refresh/chain-ride.ts`）：文件里留一个和原来同名的常量，值取中央常量、缺表回落原数字。调用点一行没动，行为零变化。共享层的 `src/shared/tracker/indexWindow.js` 不能这样办——`src/shared/` 里的文件互相 import 是依赖门禁的红线（`same-layer-import-shared`），所以它和 `budget.ts` 一样保留字面量、由门禁锁值。
2. **界面半边只能靠构建拼接**。`src/client/**` 在构建时被整份拼进一个大闭包（`scripts/build.mjs` 的 SHARED_SPLICE），文件里出现 import 语句在闭包里就是语法错误。所以界面要用的中央常量走“构建时摘名字拼进闭包”那条路：名单是 `scripts/build.mjs` 的 `CLIENT_TIME_NAMES`，`src/client/index.js` 里有拼接标记位（放在闭包体最前面，避免 `const` 暂时性死区）。界面文件直接引用常量名，`.ts` 文件在模块级写 `declare const`。
3. **七处界面常量坚持留在源码里**（见 §4），不是因为漏了，而是被测试按源码文本读取：`tests/verify-log-client.js:35` 断言源码里有 `LOG_FLUSH_MS = 1000` 这段文字，`tests/verify-subdir-first-frame.js:73` 拿 `'SNAP_WAIT_MS = 30000'` 当替换锚点，`tests/verify-kernel.js:46` 把 `ATTENTION_SILENT_MS` 列为导出契约，`tests/verify-rest-fallback-banner.js`、`tests/verify-842-version-control-write-view.js`、`tests/verify-settings-*.js` 同样按名字取用。把它们删掉改成拼接常量会同时打断这些测试的取用方式，得不偿失；改成“留字面量、门禁锁值”。

### 2.2 生效时机：编译期配置，不做运行期可调（维护者 2026-10-16 决断）

三份 YAML 只活在仓库里：`package/package.json` 的 files 白名单里没有 `config`，装到用户机器上的插件里没有它们；运行期也没有任何代码读它们——唯一的读者是构建期的 `scripts/generate-time-config.mjs`。调一个时间的完整动作是「改 YAML → 跑生成器 → 重新构建 → 重新发版」，装好插件的人在本机改不到。

维护者明确决定**不做**运行期读取（例如从插件目录读同名文件、缺文件回落生成值）。后来的人不要顺手加这一层：那会把「值从哪来」变成运行期问题，而本方案的门禁（生成新鲜度、值一致、覆盖率、界面拼接名单对账）全都建立在“值在构建期就定死”之上。

同一天还做了两处加固（对抗式审查的第二轮）：

- 门禁在第二节之前先看域根的 `src/shared/time-config/values.js` 在不在（构建产物、不入库）。新克隆或刚清理过产物时，它现在直说“生成物不在，先跑一次 `node scripts/build.mjs`，这不是值不一致”，不再抛看不懂的 `Cannot find module`。
- 生成器在某个值越过 JavaScript 定时器能表达的上限（`2147483647` 毫秒，约 24.8 天）时发告警：这类数只有做大小比较（有效期、窗口）才安全，直接当延时会被运行时折成 1 毫秒。今天的 `inFlightKeepAliveMs` 正好等于上限，是刻意的“永不”。

补的四个键分别是 `predicateTimeoutMs`（15000，`src/host/detectChain.ts` 传给谓词表的单谓词超时）、`predicateFallbackTimeoutMs`（3000，`src/host/tracker/predicateCore.js` 不传时的兜底）、`tipShowDelayMs`（500）与 `tipHideDelayMs`（160）（`src/client/views/primitives/Tip.js` 的悬停提示）。前三类写法（裸 `timeout:`、`? opts.timeout : 3000`、`delay: { show, hide }`）原来的时间味判据都认不出，所以调查脚本与门禁一起漏掉了它们；判据这次补上了整词时间名、秒/分钟/小时/天单位，以及“时间味的键挂一个对象”这第三种藏法。



## 3. 五条架构约束（定版时逐条核实过，违反任何一条本方案即不成立）

1. `register-options.ts:37` 零导入约束：`AGENT_TOOL_TIMEOUT_MS` 保留字面量，门禁只断言值相等（该文件永久 literal）。
2. 共享域之间不许互相 import（`tests/verify-dependency-rules.ts` 红线）：`budget.ts`、`tuning.ts`、`write-ticket.ts` 保留自己的常量，门禁只断言值相等。
3. 客户端无运行时 import：界面用的中央常量走构建 splice（`build.mjs` 的 `shared:timeConfig` 标记位 + `CLIENT_TIME_NAMES` 名单），消费处 `.ts` 写 `declare const`、`.js` 直接引用；门禁 CLIENT 表与那份名单双向对账（谁多谁少都判红）。
4. 房间可引 `^src/shared/`（`tests/tracker-room-imports.json:7`，#1159）：房间侧 import 无需改 allowlist。
5. `yaml@^2.9.1` 已是正式依赖：生成器不引入新包。

## 4. 永久 literal 清单（不是没迁完，是架构上不能迁）

| 文件 | 项 | 为什么不能迁 |
| --- | --- | --- |
| `src/shared/refresh/src/budget.ts` | 18 项 | 共享域之间不许互相 import |
| `src/shared/refresh/src/tuning.ts` | `deckEnsureTimeoutMs` | 同上（另见 §6） |
| `src/shared/version-control/src/write-ticket.ts` | `TICKET_TTL_MS` | 同上 |
| `src/deck/registration/register-options.ts` | `AGENT_TOOL_TIMEOUT_MS` | 零导入约束（§3.1） |
| `src/host/index.ts` | `TIMEOUT_MS` 30000、`CACHE_MS` 60000、入口延迟启动 30000 | 插件入口禁静态 import（该文件 H7 #515 注释的 D7 约束，构建 host-dev 产物要过 `vm.Script` 语法预检） |
| `src/client/kernel/log.js` | `LOG_FLUSH_MS`、`LOG_WATCHDOG_MS` | 界面半边不能 import，且被测试按源码文本读取 |
| `src/client/kernel/probe-snapshot.js` | `SNAP_WAIT_MS` | 同上（测试拿它当替换锚点） |
| `src/client/kernel/settings-view-write.js` | `VIEW_FLAG_WRITE_DEBOUNCE_MS` | 同上 |
| `src/client/kernel/attention-heartbeat.js` | `ATTENTION_SILENT_MS` | 同上（导出契约；与 budget 的 `ATTENTION_EXPIRY_MS` 同一个数，共用 `attentionExpiryMs` 一档） |
| `src/client/views/shared/truthLines.js` | `REST_FALLBACK_STALE_MS` | 同上 |
| `src/client/views/versionControl/vcText.js` | `VC_RELATIVE_WINDOW_MS` | 同上（导出契约） |
| `src/shared/tracker/sync.js` | `SYNC` 里 12 个时间项 | 整份拼进界面闭包 |
| `src/shared/naming-tracking.js` | `NAMING_RETRY_COOLDOWN_MS` | 同上 |
| `src/shared/tracker/indexWindow.js` | `MAX_WINDOW_MS`、`SKEW_MS` | 共享域之间不许互相 import（依赖门禁的 `same-layer-import-shared` 红线） |

上表每一项都由本门禁锁在 YAML 生效值上（能 import 的按模块导出比，不能 import 的按源码字面出现次数比）。双生子（`call-budget.ts` 的 `DEFAULT_TOOL_TIMEOUT_MS` 与 `register-options.ts` 的 `AGENT_TOOL_TIMEOUT_MS`）的三方同值另由 `tests/verify-895-bulk-deadline.ts` 第⑦节看守（S6 起断言“两处字面量与 YAML 同值”）。

另有一类「同一个数字的兜底」，写在界面文件里而不是留在原处不动：`store-prefs.js`、`store-switch.js`、`api-new-session.js` 这三个文件会被几道门禁当普通模块直接 import 进来跑，那时构建时拼进闭包的常量并不存在，直接引用就是 `ReferenceError`（第二轮实测把 7 道门禁带红，症状是 `switch.bindFail{"err":"STORE_SWITCH_CONFIRM_MS is not defined"}` 一类）。所以这三处写成 `typeof 常量 === 'number' ? 常量 : 原数字`：产品里走拼进来的中央值，门禁里走同一个数字；那几处片段、出现次数与值都由本门禁的 TEXT 表锁住。`probe-auto.js` 的三处不在此列——没有门禁单独 import 它，读值只发生在拼好的闭包里，所以那里不写第二份数字。

## 5. 明确不入 YAML 的（门禁 EXEMPTS 表逐条有理由，这里只记分类）

- 非时间数字：点数、条数、单价、比例、页数、次数（`budget.ts` 三十余项）、桶容量、`MIN_BACKOFF_STEPS` 步数。
- 单位换算常量：`HOUR_MS`（1 小时）、`TRUTH_MINUTE_MS`（1 分钟）——调它没有意义。反过来，`gitCredentialExec.js` 里那处“毫秒 ÷ 1000 换成 git 认的秒”不豁免：它由 TEXT 表锁在中央键上，因为改错单位就是真故障。
- 值为 0 表示“关掉/立即/下一帧”的语义常量：`NAMING_HINT_GRACE_MS`、界面里 `setTimeout(..., 0)` 那一类。
- 透传与计算值：函数内局部变量（接已登记参数）、注入结构体的字段、别名、读钟得到的时刻与耗时（`nowMs`/`elapsedMs`/`latencyMs`/`watermarkMs` 一类）、退避结论输出的等待结果、快照里读出的生成时刻。
- 名字里带时间词但不是时间的：`timeOfMs`（格式化函数名）、`_hadToWait`（布尔）、`fitMs`/`commitMs`（滚动位置回正的状态字段）、`inWindow`（候选数组）。
- 界面那三处「SYNC 缺席时的兜底」不算第二份数字：兜底值取自拼进闭包的中央常量（`probe-auto.js` 三处），正常路径取 `sync.js` 里那份已锁的值；另有三个文件会退回同一个数字，那是为了让门禁能把它们当普通模块 import 跑起来，理由与锁法见 §4 末段。
- `scripts/**` 下的开发脚本（例如 `scripts/browser-host.mjs` 的保活间隔）、`tests/**`、`examples/**`、`docs/prototype/**` 与临时目录（`.scratch/`、`.r1047tmp/` 一类）不进范围：它们不是产品运行时行为，改了不影响插件。

## 6. 与 #1069（tuning.ts）的关系

`tuning.ts` 是“只搬运不统一”的第一步（它的文件头自己就是这么写的），本票是第二步：中央登记。两者不冲突——`tuning.ts` 的时间字段保留，值由本门禁看守与 YAML 一致；那张票定的“本轮不统一数值”（同值不同命的不合并）继续有效，本票的键里同值不同命的各自保留独立的键（例如 `deckStoreMs` 10000 与 `deckEnsureMs` 15000 是两件事，`deckLocalReadMs` 5000 与 `deckEnsureMs` 15000 也是两件事）。

## 7. 怎么判（门禁总览）

`tests/verify-time-config.ts` 四节：

1. **生成新鲜度**：`generate-time-config.mjs --check` 必须过（生成物与三份 YAML 一致）。
2. **值一致**：IMPORT 表按模块导出比（`imported` 断言“就是同一个导出”，`literal` 断言值相等；`SYNC.X` 这种对象属性写法走 PROP 分支）、TEXT 表按“这段源码写法在文件里出现几次”比，每行同时锁文件写法与 YAML 生效值。
3. **界面半边拿不拿得到值**：CLIENT 表三件事一次对上——`values.ts` 里有这个常量、`scripts/build.mjs` 的 `CLIENT_TIME_NAMES` 里有这个名字、界面文件里确实在用它；名单与表还双向对账（名单多一个名字 = 白拼进闭包，表多一行 = 用了却没人拼）。
4. **覆盖率**：扫描全部 `src/**/*.ts` 与 `.js`（生成物自己除外），命中的时间常量必须已在 IMPORT/TEXT/CLIENT 表登记，或在 EXEMPTS 里写明理由。

配套：

- `node scripts/generate-time-config.mjs --check`：挂在 `npm run typecheck` 最前面（typecheck 先于 build，生成物不对时检查期就停，不进构建）。
- `node scripts/build.mjs`：进域循环前先按三份 YAML 重算生成物（改了 YAML、生成物没提交时，构建按 YAML 重算，不读旧数字）；三份 YAML 都进了构建输入指纹（`INPUT_EXTRA`）。
- `tests/verify-file-granularity.js`：`GENERATED_FILES` 名单里的生成源码不参与“拆到 350 行以内”这条棘轮——生成物的行数由键的个数决定，不是人手写出来的结构；正确性由本门禁第一节（生成新鲜度）钉住。名单今天只有 `src/shared/time-config/src/values.ts` 一项。

## 8. 改一个时间的操作口径

1. 只改 `config/` 下对应那份 YAML 里的那个键（不确定住哪份就看生成器 KEYS 表第三列）。
2. 跑 `node scripts/generate-time-config.mjs`（忘了跑也没关系，`--check` 会在 typecheck 阶段判红）。
3. 若这个键的某个调用方属于 §4 的永久 literal，手工把那处字面量改成同值——门禁第二节会先判红并指出是哪个文件哪一行。
4. 跑 `node --import ./scripts/ts-hook.mjs tests/verify-time-config.ts`。
5. 新增的键如果要给界面半边用，还要把常量名加进 `scripts/build.mjs` 的 `CLIENT_TIME_NAMES`（漏加或多加都会被门禁第三节挡住）。
6. 门禁第四节会告诉你 `src/` 里还有没有没登记的时间常量。
