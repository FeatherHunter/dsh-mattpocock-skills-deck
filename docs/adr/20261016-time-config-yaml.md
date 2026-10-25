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
| `config/timeouts.yaml` | 单次等待的上限，到点没回来就按失败或放弃处理 | 74 |
| `config/intervals.yaml` | 节拍间隔、一次性延时，以及末尾的退避序列（`chainBackoffMs`、`ownRouteRetryMs`） | 39 |
| `config/ttl.yaml` | 有效期，一份数据或一次判断过多久算过期 | 48 |

三份合计 161 个键（数字随每次加键变化，以 `scripts/generate-time-config.mts` 的 KEYS 表为准）。
2026-10-26 门禁重新入链时又补了 9 个键：工作路线回执的三个时间窗（`workRouteInProgressWindowMs`、
`workRouteActiveWindowMs`、`workRouteCollisionWindowMs`）、存档保留期 `chainKeepMs`、写事件补丁的
`writePatchTtlMs`、视野模型上报去重窗 `attentionReportDedupeMs`、出站排队段的两档日志节流
（`laneLongWaitLogMs`、`laneWaitLogIntervalMs`），以及客户端的两档重试退避 `ownRouteRetryMs`。
它们此前都是源码里的裸数字——门禁当时不在链上，没人看见。

单位一律毫秒。唯一一处单位换算在 `src/host/gitCredentialExec.js`：git 的 `http.lowSpeedTime` 只认秒，那里把 `gitLowSpeedTimeoutMs`（20000）除以 1000，除法本身由门禁锁在中央键上（派生行右边引用已登记的生成常量才放行），因为改错单位就是真故障。每个键住哪份文件由 `scripts/generate-time-config.mjs` 的 KEYS 表第三列（分组）决定：
分组 `timeouts` → timeouts.yaml，`intervals` 与 `backoff` → intervals.yaml，`ttl` → ttl.yaml。
把某个键写错文件、同一个键出现在两份文件里、写了一个表里没有的键，生成器一律报错停下（拼错时按编辑距离提示最像的那个键）。

生效处是生成的 `src/shared/time-config/src/values.ts`（构建与 typecheck 时现场生成、不入库，diff 即调参记录看 YAML 的 diff），由同一个生成器写出；配套的类型声明 `src/shared/time-config/values.d.ts`（只有声明、没有值）与域构建产物 `src/shared/time-config/values.js` 同理不入库。

三条配套纪律，违反即判红：

1. **人手不改生成物**：`generate-time-config.mjs --check`（挂在 `npm run typecheck` 最前面）与 `tests/verify-time-config.ts` 第一节同时看守。
2. **YAML 缺键是故障**：缺的键生成器直接报错退出，没有回落——回落表本身就是第二份数字拷贝。未知键同样报错（多半是拼错，静默忽略等于让拼错的键看起来生效了）。
3. **新参数必须先登记**：`tests/verify-time-config.ts` 第四节（无字面量）与第五节（覆盖率）扫描全部 `src/**/*.ts` 与 `.js`，新冒出来的时间常量要么入表（REFERENCES/CLIENTS），要么在 PERMANENT/EXEMPTS 里写明理由。理由写不清的就不该豁免——那是漏登记的参数。

### 2.1 单源头改造（#1215 收尾）：源码里不再有第二份数字

第二轮落地时还有三类“合法的第二份”：宿主 `.js` 里的“别名接中央、缺表回落原数字”
（`const X = CENTRAL ?? 数字`）、共享层的字面量保留（`budget.ts` 等 18 项，由门禁锁值）、
界面半边的 `declare const` 与缺省回落（`typeof X === 'number' ? X : 数字`）。用户决断：
这些全部整改，不留“永久冲突”的借口——要么搬进 YAML 走真引用，要么写进 PERMANENT/EXEMPTS
讲清为什么不是时间。改造后：

1. **宿主与共享层一律真 import**：`import { X } from '…time-config/values.js'`，裸用名字；
   别名只许改名（`import { X as Y }`）。`?? 数字` / `|| 数字` 这类缺省回落一律删除——
   回落本身就是第二份数字，门禁第四节把它当独立的一种藏法来扫。
2. **界面半边同样写 import**：构建在拼接时把中央引用行整行删掉（只认单行），名字由闭包里
   另一片 timeConfig 提供（构建按 `CLIENT_TIME_NAMES` 名单从 `values.js` 摘 `const X = 值` 拼进去）。
   名单由门禁第三节与 CLIENTS 表双向对账（名单多一个名字 = 白拼进闭包，表多一行 = 用了却没人拼）。
   共享层里被拼进闭包的三份（`budget.js`、`sync.js`、`naming-tracking.js`）同理：
   它们的函数体里裸用中央名字，import 行剥掉之后声明只能由 timeConfig 片段给。
3. **二传是禁区**：`export { X } from '…time-config…'` 与同文件的 `import { X }` 并存时，
   esbuild 会给其中一个起别名（`X2 as X`），域转译当场失败。要值的调用方直接从 time-config 引，
   不要经 `budget.js` / `write-ticket.js` / `naming-tracking.js` 倒一手——改造中这三处的转出
   行已全部删除，调用方（宿主、测试）各自直连中央。
4. **域产物跨目录引用减一层**：域构建把 `<域>/src/*.ts` 转译到域表层时，跨出源码目录的相对引用
   要重算（`rebaseEscapingImports`），否则产物里的 `../../time-config/values.js` 在运行时指到
   `src/time-config/` 那个不存在的地方去——门禁第二节与运行时会一起倒下。
5. **测试里的注入器跟着改**：`policyLimits` / `attentionLimits` 这类“给一套就用给的、不给就用中央”
   的口子，缺省源写成 `Object.assign({}, budget, { 中央名… })`；直接拿 `budget` 命名空间当缺省源
   会读到 undefined（中央名字已经不在 budget 上了），verify-998 与视野模型两道门禁就是这么红的。
   同理，拿编译后源码当函数跑的门禁（如 verify-visible-truth 的 loadModule）要在求值作用域里预埋中央值。

### 2.2 生效时机：编译期配置，不做运行期可调（维护者 2026-10-16 决断）

三份 YAML 只活在仓库里：`package/package.json` 的 files 白名单里没有 `config`，装到用户机器上的插件里没有它们；运行期也没有任何代码读它们——唯一的读者是构建期的 `scripts/generate-time-config.mjs`。调一个时间的完整动作是「改 YAML → 跑生成器 → 重新构建 → 重新发版」，装好插件的人在本机改不到。

维护者明确决定**不做**运行期读取（例如从插件目录读同名文件、缺文件回落生成值）。后来的人不要顺手加这一层：那会把「值从哪来」变成运行期问题，而本方案的门禁（生成新鲜度、值一致、覆盖率、界面拼接名单对账）全都建立在“值在构建期就定死”之上。

同一天还做了两处加固（对抗式审查的第二轮）：

- 门禁在第二节之前先看域根的 `src/shared/time-config/values.js` 在不在（构建产物、不入库）。新克隆或刚清理过产物时，它现在直说“生成物不在，先跑一次 `node scripts/build.mjs`，这不是值不一致”，不再抛看不懂的 `Cannot find module`。
- 生成器在某个值越过 JavaScript 定时器能表达的上限（`2147483647` 毫秒，约 24.8 天）时发告警：这类数只有做大小比较（有效期、窗口）才安全，直接当延时会被运行时折成 1 毫秒。今天的 `inFlightKeepAliveMs` 正好等于上限，是刻意的“永不”。

补的四个键分别是 `predicateTimeoutMs`（15000，`src/host/detectChain.ts` 传给谓词表的单谓词超时）、`predicateFallbackTimeoutMs`（3000，`src/host/tracker/predicateCore.js` 不传时的兜底）、`tipShowDelayMs`（500）与 `tipHideDelayMs`（160）（`src/client/views/primitives/Tip.js` 的悬停提示）。前三类写法（裸 `timeout:`、`? opts.timeout : 3000`、`delay: { show, hide }`）原来的时间味判据都认不出，所以调查脚本与门禁一起漏掉了它们；判据这次补上了整词时间名、秒/分钟/小时/天单位，以及“时间味的键挂一个对象”这第三种藏法。



## 3. 五条架构约束（单源头改造后重核：①②③的旧口径已废止，见 §2.1）

1. ~~`register-options.ts:37` 零导入约束~~（废止）：该文件现直接 import 中央常量（`TOOL_TIMEOUT_MS`、`REGISTER_RETRY_WAIT_MS`），当时的“零导入”是因为调用链没理顺，不是架构红线。
2. ~~共享域之间不许互相 import~~（对本域开唯一例外）：`budget.ts`、`tuning.ts`、`write-ticket.ts`、`indexWindow.js` 现全部真引用中央常量。例外成立的理由只有一条——本域是纯数据，没有运行时逻辑，只被 import、不 import 任何人；其他共享域之间的互相引用仍是红线。
3. ~~客户端 `.ts` 写 `declare const`~~（废止）：界面文件与共享拼片现在同样写真 import，构建在拼接时剥掉中央引用行（`stripTimeConfigRefs`，只认单行），名字由 timeConfig 片段提供。门禁 CLIENTS 表与 `CLIENT_TIME_NAMES` 双向对账（谁多谁少都判红）。
4. 房间可引 `^src/shared/`（`tests/tracker-room-imports.json:7`，#1159）：房间侧 import 无需改 allowlist。
5. `yaml@^2.9.1` 已是正式依赖：生成器不引入新包。

## 4. 永久留数字的清单（单源头改造后：源码里没有第二份“时间”，只有三类不是时间的数字）

| 类别 | 例子 | 为什么留 |
| --- | --- | --- |
| 单位换算（数学定义，不是旋钮） | `HOUR_MS = 3_600_000`、`TRUTH_MINUTE_MS = 60000` | 调它没有意义 |
| “还没有”哨兵（0 / -1，不是时长） | `commitMs: -1`、`sinceMs: 0`、各种 `latencyMs = 0` 与 `X \|\| 0`、`setTimeout(…, 0)` | 0 表示还没发生过，不是可调时长；门禁遇到 0/-1 一律放行 |
| 单位不是毫秒（调它等于改语义） | `MIN_BACKOFF_STEPS = 2`（退避步数下限，几档） | 改它等于改校验语义，不是调时间 |

每一项都由门禁 PERMANENT 表锁死“文件 + 片段”（改了数字、改了写法都判红）；`gitCredentialExec.js` 那处“毫秒 ÷ 1000 换成秒”是派生（右边引用已登记的中央键），不在此表，由覆盖率那节的“右边引用中央即放行”认领。原来 §4 表里的 18 项字面量（`budget.ts` 等）已全部搬进 YAML，真引用代替锁值。

## 5. 明确不入 YAML 的（门禁 EXEMPTS 表逐条有理由，这里只记分类）

- 非时间数字：点数、条数、单价、比例、页数、次数（`budget.ts` 三十余项）、桶容量、`MIN_BACKOFF_STEPS` 步数。
- 单位换算常量：`HOUR_MS`（1 小时）、`TRUTH_MINUTE_MS`（1 分钟）——调它没有意义。反过来，`gitCredentialExec.js` 里那处“毫秒 ÷ 1000 换成 git 认的秒”不豁免：派生行的右边引用了已登记的中央键（门禁第五节“右边引用中央即放行”认领），因为改错单位就是真故障。
- 值为 0 或 -1 的“还没有”哨兵：`NAMING_HINT_GRACE_MS = 0`（关掉宽限窗）、界面里 `setTimeout(…, 0)`、
  `latencyMs = 0` 初值、`X || 0` 缺席回落——门禁第四节遇到 0/-1 一律放行，不必逐行登记。
- 透传与计算值：函数内局部变量（接已登记参数）、注入结构体的字段、别名、读钟得到的时刻与耗时（`nowMs`/`elapsedMs`/`latencyMs`/`watermarkMs` 一类）、退避结论输出的等待结果、快照里读出的生成时刻。
- 名字里带时间词但不是时间的：`timeOfMs`（格式化函数名）、`_hadToWait`（布尔）、`fitMs`/`commitMs`（滚动位置回正的状态字段）、`inWindow`（候选数组）。
- 界面那三处「SYNC 缺席时的兜底」不算第二份数字：兜底值取自拼进闭包的中央常量（`probe-auto.js` 三处），正常路径取 `sync.js` 里那份已锁的值；另有三个文件会退回同一个数字，那是为了让门禁能把它们当普通模块 import 跑起来，理由与锁法见 §4 末段。
- `scripts/**` 下的开发脚本（例如 `scripts/browser-host.mjs` 的保活间隔）、`tests/**`、`examples/**`、`docs/prototype/**` 与临时目录（`.scratch/`、`.r1047tmp/` 一类）不进范围：它们不是产品运行时行为，改了不影响插件。
- 样式类时长（CSS 与样式字符串里的 `.12s`、`2.4s`、`300ms`，界面动画与过渡在用）不是“不收”，而是**另有一份**：它们的单位是 CSS 时间字符串，判红只能是“动画观感不对”，与“毫秒超时”不是一个验收口径，混进这三份文件会让门禁的每条规则都要分情况讨论。那一件事单独立了票 **#1236**，逐条清单在 `research/1236-style-durations.md`（42 处、8 个文件，去重后 19 个时长档位）。
  在 #1236 落地之前，界面动画时长只许住在外观旋钮文件 `src/client/statusbar/suggestAppearance.ts`
  （#1411 定的“气泡所有看得见的数字集中一处”），由门禁的 **STYLE 表**逐行锁死“文件 + 片段 + 理由”。
  STYLE 表不是永久豁免：#1236 落地后应逐行删掉，改用那份样式配置。

## 6. 与 #1069（tuning.ts）的关系

`tuning.ts` 是“只搬运不统一”的第一步（它的文件头自己就是这么写的），本票是第二步：中央登记。
单源头改造后 `tuning.ts` 的 `deckEnsureTimeoutMs` 直接引用中央 `DECK_ENSURE_TIMEOUT_MS`
（门禁断言两者相等）；那张票定的“本轮不统一数值”（同值不同命的不合并）继续有效，
本票的键里同值不同命的各自保留独立的键（例如 `deckStoreMs` 10000 与 `deckEnsureMs` 15000 是两件事，
`deckLocalReadMs` 5000 与 `deckEnsureMs` 15000 也是两件事）。

## 7. 怎么判（门禁总览）

`tests/verify-time-config.ts` 六节（第零节是链位置，前五节是实质）：

0. **链位置**：本门禁不许躺在 `scripts/verify-stages.json` 的排除表里（被排除 = 今天不跑，等于没看门）。
   2026-10-26 之前这一节数的是“文件原文里有没有本文件路径”，而排除表那条记录同样含这个路径——
   判据被自己的排除记录骗过，门禁在排除表里躺了十天、自己一直报“已挂进验证链”，58 处违例没人看见。
   现在改成按排除表点名判断：不在排除表里，规划器就会把它排进默认段。
1. **生成新鲜度**：`generate-time-config.mjs --check` 必须过（生成物与三份 YAML 一致）。
2. **真引用**：REFERENCES 表逐行断言“调用方拿到的就是中央那一份，不是抄的数字”——
   模块导出的比值（数字）或比引用（数组）；只在内部用、不导出的名字（`import { X }` 裸用、
   动态 `import()` 取命名空间）退到源码断言（import 行存在 + 第四节无字面量，两件事合在一起才是真引用）。
3. **界面半边拿不拿得到值**：CLIENTS 表三件事一次对上——`values.ts` 里有这个常量、
   `scripts/build.mjs` 的 `CLIENT_TIME_NAMES` 里有这个名字、文件里确实在用它；
   名单与表还双向对账（名单多一个名字 = 白拼进闭包，表多一行 = 用了却没人拼）。
   拼进闭包的共享文件（`budget.ts`、`sync.js`、`naming-tracking.js`）也在同一张表里：
   它们的 import 行会被剥掉，声明只能由 timeConfig 片段给。
4. **无字面量**：时间味的位置上不许出现数字。五种藏法——声明挂数字、属性挂数字、对象里藏数字、
   定时器参数位、缺省回落位；0 与 -1 一律放行（“还没有”哨兵，不是时长）。唯一出口是两张表：
   **PERMANENT**（行为时间）与 **STYLE**（样式类时长，见 §5）；两表都逐行锁死“文件 + 片段”
   （改了数字、改了写法都判红；片段从源码里消失也判红，表不许留空头支票）。
5. **覆盖率**：扫描全部 `src/**/*.ts` 与 `.js`，新冒出来的时间名字必须先登记——
   已在 REFERENCES/CLIENTS/PERMANENT/STYLE 里出现的自动认得；声明右边引用已登记的生成常量
   （派生、透传、别名）自动放行；剩下的必须在 EXEMPTS 里写明理由。

配套：

- `node scripts/generate-time-config.mjs --check`：挂在 `npm run typecheck` 最前面（typecheck 先于 build，生成物不对时检查期就停，不进构建）。
- `node scripts/build.mjs`：进域循环之前先按三份 YAML 重算生成物（改了 YAML、生成物没提交时，构建按 YAML 重算，不读旧数字）；三份 YAML 都进了构建输入指纹（`INPUT_EXTRA`）。
- `tests/verify-file-granularity.js`：`GENERATED_FILES` 名单里的生成源码不参与“拆到 350 行以内”这条棘轮——生成物的行数由键的个数决定，不是人手写出来的结构；正确性由本门禁第一节（生成新鲜度）钉住。名单今天只有 `src/shared/time-config/src/values.ts` 一项。

## 8. 改一个时间的操作口径

1. 只改 `config/` 下对应那份 YAML 里的那个键（不确定住哪份就看生成器 KEYS 表第三列）。
2. 跑 `node scripts/generate-time-config.mjs`（忘了跑也没关系，`--check` 会在 typecheck 阶段判红）。
3. 跑 `node --import ./scripts/ts-hook.mjs tests/verify-time-config.ts`。
4. 新增的键如果要给界面半边用，还要把常量名加进 `scripts/build.mjs` 的 `CLIENT_TIME_NAMES`
   （漏加或多加都会被门禁第三节挡住），并在 CLIENTS 表里加一行（file 填真源）。
5. 门禁第四节（无字面量）与第五节（覆盖率）会告诉你 `src/` 里还有没有没登记的时间常量；
   新写法只能用 README 里那三种（真 import、剥离 import、注入器缺省拼中央），
   `?? 数字` 回落与 `export-from` 二传一律不许写。
