# #1136 对抗式审查·可执行性（2026-10-14）

审查路线：可执行性（一个不了解上下文的 AI，拿到这张票的 Agent Brief，能不能一次做对）。
审查对象：issue #1136 的 Agent Brief（评论，FeatherHunter 2026-10-14 07:25:06）+ 正文现象/验收两节。
所有实验都在 `git worktree add --detach` 拉出来的独立工作树上做（`D:\Temp\1136-exec`、`D:\Temp\1136-exec2`，均钉 `474602bd`），主工作树只读、一行未改。
**注意：审查中途别人往 `main` 推了 4 个提交，`origin/main` 已从 `474602bd` 走到 `a743c0eb`**，下文凡写 `474602bd` 的都是这个被票面钉住的提交，凡写「主工作树」的都是 `a743c0eb` 加快照那一刻的 65 项未提交改动。

---

## 0. 一句话结论（这张票现在能不能直接派给 AI）

**不能直接派。** 三处硬伤，任何一处都会让执行者在半路做出错误决定：

1. **验收 c「改动之后整道门禁判绿」在干净检出上做不到。** 票面给的那条命令是裸跑 `node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts`，不经过构建。我把票面要求的改动全做完（`from`/`pathNot` 改到 `^src/tracker/rooms/...`、白名单按搬家表翻译成 11 条、根清单补 `src/tracker`、新判据加上），在**没跑过构建**的干净检出上仍然是 **9 条红**，全部是 `room-imports-third-party-package`，全部由构建产物缺失造成，**加白名单压不掉**（那条规则的 `to` 只有 `dependencyTypes`，没有可挂白名单的 `path`）。同一份改动搬到**跑过构建**的检出上：退出码 0、`引用方向门禁通过`。
2. **验收 e 的「65 个」没有给口径，而票面建议的举证方式（「门禁打印的模块数覆盖得住」）是错的。** 门禁打印的「图上 N 个模块」按 `modules.length` 算，同一个文件会被计两次：`474602bd` 上 4 根是 364 条 / **305 个不同源**，5 根是 420 条 / **323 个不同源**；房间子树 5 根下是 **73 条 / 65 个不同源**。要断言覆盖必须按 `modules[].source` 去重。
3. **票面也压在 `474602bd`，而 `origin/main` 已经在 `a743c0eb`，主工作树还有 65 项未提交改动横跨三个房间**（github 7 个、gitlab 14 个含 13 个 `.js`→`.ts` 改名、markdown 21 个）。实测同一份修好的配置，同一棵树在两个状态下 cross-room 违规是 **80 条 → 176 条**。受影响的是条数，不是目标目录集合——**按目录前缀写白名单在两个状态下都成立**，所以不必等迁移落地，但票面里那些具体条数（63、81、44、26…）在迁移落地后全部作废。

补上 §4 的 6 条「必须补」，这张票就能一次做对。

---

## 1. 逐条验收演练

### a) 在 `src/tracker/rooms/github/index.ts` 临时加一条跨房引用 → 判红并点名那条边；去掉后判绿

**先回答「门禁的扫描根能不能看见这个文件」：能，但靠的是 import 边，不是根清单。**

- 门禁喂给引擎的根是 `SCAN_TREES = ['src/host', 'src/shared', 'src/seam']`（`tests/verify-dependency-rules.ts:44`）加 `OPTIONAL_TREES = ['src/deck']`（`:51`）——**`src/tracker` 不在根清单里**。房间文件是靠 `src/host/**` 的 import 边被带进图的。
- 实测（干净检出 `474602bd`）：加探针前「176 个源码文件，图上 364 个模块、**651** 条依赖边」；加探针后「364 个模块、**652** 条依赖边」。模块数不变、边数 +1 → **探针那条边确实进了图**。
- 因此「加在 `src/tracker/rooms/github/index.ts`」有效；但**换成别的房间文件可能完全无效**：4 根下盘上 65 个房间源码只有 56 个进图，缺的 9 个是 `src/tracker/rooms/gitlab/` 下 8 个没人引的 `.js`（client / create-write / errors / graph-blocking / graph-membership / idempotency / normalize / queries）与 `src/tracker/rooms/markdown/normalize.ts`。探针加在 `markdown/normalize.ts` 上，4 根配置下**当场假绿**。

**探针有效性（实测，干净检出）：**

- 未修配置：探针在场，退出码 **0**，末行仍打印「引用方向门禁通过（同层 3 + 70 + 27 + 6 条存量已记名，房间纪律与禁循环零违规）」——票面说的假绿**复现成立**。
- 只把两条规则的 `from` 与 `to.pathNot` 第一项改到 `^src/tracker/rooms/...`（白名单一个字不改）：退出码 **1**，判红行逐字是
  `FAIL cross-room-import：src/tracker/rooms/github/index.ts -> '../gitlab/index.js'（解析为 src/tracker/rooms/gitlab/index.ts）`。

**结论：AC-a 可执行。但票面必须点名探针文件**（「必须加在 `src/tracker/rooms/github/index.ts`（或 gitlab 的 `index.ts`、markdown 的 `index.ts`），这三个文件才保证在图上」），否则执行者随手挑一个房间文件，会得到一个假的「规则没牙」结论。

### b) 同房引用不判红

- 实测：把探针换成 `import './backend.js'`（github 房内部），图上 cross-room 违规从 63 条回到 **62 条**，探针那条消失、其余一条不多不少。退出码仍是 1（因为白名单还没改，62 条存量还在），但**没有新增误伤**。
- 机制在 `to.pathNot: ['^src/tracker/rooms/$1/'].concat(ROOM_WHITELIST)`（`.dependency-cruiser.cjs:99-100`）：`$1` 是 `from.path` 里捕获的房间名。**这是同房间放行的全部机制**，把 `from.path` 的捕获组写成 `(?:...)` 就会当场误伤全部同房引用。
- **结论：AC-b 可执行**，但「$1 不许改成不捕获的组」要写进票面。

### c) 改动之后整道门禁判绿；新判据能判红

**这是本票最大的一处不可执行——必须先说清「在哪种检出上」。** 实测矩阵见 §2。结论：

- **在没跑过构建的干净检出上，这条 AC 做不到。** 我把四件事全做完（`from`/`pathNot` 改对、白名单翻译成 11 条、根清单补 `src/tracker`、新判据加上），门禁仍退出 **1**，9 条红全部是
  `FAIL room-imports-third-party-package：src/tracker/rooms/github/idempotency.ts -> '../../../shared/refresh/idempotency.js'（解析为 ../../../shared/refresh/idempotency.js）`
  这一类，一共 9 条（4 根）/ 12 条（5 根）。
- **在跑过构建的检出上，四件事做完就是绿的。** 实测输出：
  ```
  PASS 扫描域成立：311 个源码文件，图上 420 个模块、713 条依赖边
  INFO 图上违规合计 106 条：same-layer-import-host 70 条、same-layer-import-platform 3 条、same-layer-import-seam 6 条、same-layer-import-shared 27 条
  引用方向门禁通过（同层 3 + 70 + 27 + 6 条存量已记名，房间纪律与禁循环零违规）
  ```
  退出码 **0**。（这是 `SCAN_TREES` 补了 `src/tracker` 之后的数；不补根清单时是「212 个源码文件，图上 396 个模块、653 条依赖边」，同样退出码 0。）
- **新判据的负向验证**：把 `cross-room-import` 的 `from.path` 临时改成 `^src/no/such/room/dir/(github|gitlab|markdown)/`，当场
  `FAIL 规则起点在图上一个模块都没命中（规则空转）：cross-room-import，from.path=^src/no/such/room/dir/(github|gitlab|markdown)/`，退出码 1。
- **新判据的正向验证（不误报）**：9 条有 `from.path` 的规则全部命中，命中数依次 7 / 66 / 59 / 7 / 56 / 56 / 37 / 9 / 9；`circular-dependency` 因为 `from` 是 `{}` 被正确跳过。

### d) 白名单每条都能在磁盘上找到对应目录/文件；已死条目已删

**今天的 7 条里 2 条已经死了**（逐条 `Test-Path` 实测）：

| 白名单条目 | 对应路径 | 在盘上 |
|---|---|---|
| `^src/shared/tracker/` | `src/shared/tracker` | ✅ |
| `^src/shared/labels\.js$` | `src/shared/labels.js` | ❌ **死条目** |
| `^src/shared/label-color/` | `src/shared/label-color` | ✅ |
| `^src/shared/refresh/` | `src/shared/refresh` | ✅ |
| `^src/shared/config-store/` | `src/shared/config-store` | ✅ |
| `^src/host/tracker/preflight\.js$` | `src/host/tracker/preflight.js` | ❌ **死条目** |
| `^src/host/platform/` | `src/host/platform` | ✅ |

**但「每条都能在磁盘上找到对应目录/文件」这句话本身有一个陷阱，票面没说**：验证方式必须是「把正则剥成目录前缀再 `Test-Path`」。实测发现 **`src/tracker/contract/vocabulary.js` 是构建产物**（`.gitignore:54: /src/shared/*/*.js` 这类规则之外还有其它派生物），于是同一个 import 在两种检出上解析到不同文件：

- 没构建的检出：`src/tracker/rooms/github/backend.ts -> '../../contract/vocabulary.js'（解析为 src/tracker/contract/vocabulary.ts）`
- 已构建的检出：`src/tracker/rooms/github/backend.ts -> '../../contract/vocabulary.js'（解析为 src/tracker/contract/vocabulary.js）`

**所以白名单条目只能写目录前缀，不能写精确到 `.ts` 的文件名**——写死 `^src/tracker/contract/vocabulary\.ts$` 在已构建的检出上会漏。我实测的那份 11 条白名单全部用目录前缀，在已构建检出上把 cross-room 从 80 条压到 **0 条**。

### e) 房间源码全部进图（今天 65 个）

**数字核实：「65」是对的，但票面没给口径，而可能的口径有三个答案。**

`474602bd` 上：

| 口径 | 数 |
|---|---|
| `git ls-tree -r HEAD -- src/tracker/rooms` 全部文件 | 66（含 `README.md`） |
| 其中扩展名是 `.js`/`.ts` 的 | **65**（`.js` 13 + `.ts` 52） |
| 门禁自己的口径 `SOURCE_EXTS = ['.js','.mjs','.cjs','.ts','.mts','.cts']`（`tests/verify-dependency-rules.ts:55`） | **65** |
| 只看 `*.ts` | 52 |

- **「源码文件」= 门禁自己的 `SOURCE_EXTS` 口径，65 成立。** 构建产物不计（房间下没有），`.md` 不计。
- 这个数在 gitlab 迁移落地前后**不变**：13 个 `.js` 变成 13 个 `.ts`，总数仍是 65。主工作树实测 `Get-ChildItem src\tracker\rooms -Recurse -File | ? Extension -in .js,.ts,...` = **65**。
- **进图情况（实测）**：门禁那 4 个根下只有 **56/65** 进图；补 `src/tracker` 为根后 **65/65**（模块条目 73 条、去重后 65 个源，8 条重复来自「既是根、又被 import」的 gitlab 文件）。
- **票面建议的举证方式（「门禁打印的模块数覆盖得住」）是错的**：`parsed.modules.length` 不去重。`474602bd` 上 4 根 364 条 / 305 个不同源；已构建的 4 根 396 条 / 308 个不同源；5 根 420 条 / 323 个不同源。拿「420 个模块」去证「65 个房间源码都进图」是拿一个重复计数的数字凑结论。
- **AC-e 还需要补一句话：用哪个数字判**。今天门禁里**没有任何按树统计覆盖的断言**，`scopeProblems`（`:272-284`）只判「三棵树在不在、扫到 0 个文件没有、图上 0 个模块没有」。要让 AC-e 可机器判，得新增一段按 `modules[].source` 去重后数 `^src/tracker/rooms/` 的断言。

### f) 四处文档与规则文件白名单逐条一致

**先回答「到底指哪四处」**：`CONTEXT.md:35`（房间词条）、`CONTEXT.md:36`（房间纪律词条）、`src/tracker/rooms/README.md` 的「房间纪律」一节、`tests/same-layer-baseline.json:4` 的 `note`、`.dependency-cruiser.cjs` 的 `:31,95,127,133,148` 五处注释。**票面写的是「四处」，实际点名了 5 个位置（CONTEXT 两行算一处还是两处没写清）。**

**再回答「有没有机器可判的一致性口径」：没有，而且今天这两处就已经不一致。**

- 规则文件 `ROOM_WHITELIST`（`.dependency-cruiser.cjs:34-42`）7 条正则；
- `src/tracker/rooms/README.md` 的「房间纪律」一节 9 条人类可读项，其中
  - `src/tracker/contract/canonical-labels.ts` —— **配置里没有**
  - `src/tracker/preflight.ts` —— **配置里没有**
  - `node 内置模块`、`同房间内相对路径` —— 配置里**根本没有对应正则**（前者靠 `to.path` 只收 `^src/`、内置模块不匹配；后者靠 `pathNot` 的 `$1`）
  - 反过来，配置有的 `^src/shared/labels\.js$` —— **README 没列**

- 所以 AC-f 的「逐条一致」今天既不成立，也没有给出「以谁为准、怎么算一条、两处怎么比」的口径。**这是必须补的一条。**
- **另一处必须说清的边界**：全仓还有 **91 个受版本控制的文件**写着 `tracker/backends`（`.md` 61、`.html` 10、`.ts` 8、`.js` 6、`.json` 4、`.cjs` 1、`.txt` 1）。落在 `src/` + `tests/` + 根目录的有 22 个，包括 **`tests/verify-deck-tools-host-wiring.js:41,46`（那是功能代码，不是注释）** 与 **`tests/handwritten-js-baseline.json:245-307`（63 条旧路径，是别人 `.js`→`.ts` 迁移的对账基线）**。票面说这四处之外归 #1118，但没点名这些「看上去也该顺手改」的东西。

### 附带核对：正文的「证据 4」不成立

正文说 `verify-gate-map.js` 的 6 条 FAIL 全部指向 `src/host/tracker/backends`。实测在**没构建**的 `474602bd` 干净检出上是 6 条 FAIL，但内容是：

```
FAIL 归属表是最新的：重新推导的结果与 tests/gate-map.json 一致（不一致就重跑 node scripts/gate-map.mjs）
FAIL 归属表里记的每个 guards 路径都在磁盘上真实存在（不存在的 200 条）
FAIL 覆盖面记的文件数与磁盘上 src/ 的文件数一致（表里 534，磁盘上 462）
FAIL guardedFiles 里没有磁盘上已经不存在的文件（多出来 72 个）
FAIL 底层共享模块 src/shared/refresh/budget.js 还在（场景三要用它）
FAIL 场景三：反向依赖 src/shared/refresh/budget.js 的那些门禁全被选中（该选 13 扇，漏 7 扇：…）
```

**一条都没提 `src/host/tracker/backends`**；`tests/gate-map.json` 里搜 `tracker/backends` 命中 0 行（`git grep -c` 实测）。这 6 条红全部由「没跑过构建」造成（缺构建产物 → `src/` 文件数 462 vs 表里 534）。Agent Brief §4.1 已经指出了这点，我这次是直接复现。

**并且 Agent Brief §4.2 的建议是错的**：它说「`verify-gate-map.js` 判绿在本票里做不到」。实测在**已构建**的检出上，`verify-gate-map.js` 只剩 **1 条** FAIL（`归属表是最新的`），跑一次 `node scripts/gate-map.mjs` 之后 **`全部通过（85 条断言）`，退出码 0**。也就是说**正文原版验收第 2 条（`verify-gate-map.js` 判绿）是可做的**，不该被删。代价是 `tests/gate-map.json`（229186 字节的派生文件）会跟着重写。

---

## 2. 环境依赖陷阱：验收该在哪跑

### 实测矩阵（`474602bd`，引擎直跑）

命令：`node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs <roots> --config .dependency-cruiser.cjs --output-type json --no-progress`

| 检出 | 配置 | 4 根：cross-room / third-party | 5 根：cross-room / third-party |
|---|---|---|---|
| 没构建 | 原样（指向空目录） | 0 / **0** | 0 / **0** |
| 没构建 | 只把 `from`/`pathNot` 改对 | 62 / **9** | 80 / **12** |
| 已构建 | 原样 | 0 / 0 | 0 / 0 |
| 已构建 | 只把 `from`/`pathNot` 改对 | **62** / **0** | **80** / **0** |

（4 根 = `src/host src/shared src/seam src/deck`，即门禁今天的实际根；5 根 = 再补 `src/tracker`。）

### 结论与机制

1. **那 9（4 根）/ 12（5 根）条 `room-imports-third-party-package` 纯粹是「没跑过构建」造成的假红。** 房间引的
   - `../../../shared/label-color/colors.js`（源在 `src/shared/label-color/src/colors.ts`）
   - `../../../shared/refresh/idempotency.js`、`../../../shared/refresh/create-write.js`
   - `../../../shared/config-store/labels.js`

   都是构建产物，被 `.gitignore:54` 的 `/src/shared/*/*.js` 挡在版本控制之外。没构建时解析不到 → dependency-cruiser 把这些依赖归成 `unknown` 类 → 撞上 `room-imports-third-party-package` 的 `to.dependencyTypes` 列表（配置里含 `'unknown'` 与 `'undetermined'`，`.dependency-cruiser.cjs:111-121`）。构建后就落回 `local` 类，一条都不报。

2. **这 9 条长得和 62 条真违规一模一样。** 同一个 `fail()`、同一种输出格式 `FAIL <规则名>：<from> -> '<unresolvedTo>'`，而且因为解析不到，`unresolvedTo` 就是说明符本身、`解析为` 后面跟的也是它自己（`FAIL room-imports-third-party-package：src/tracker/rooms/github/label-colors-ops.ts -> '../../../shared/label-color/colors.js'（解析为 ../../../shared/label-color/colors.js）`）。一个没上下文的 AI 在干净检出上会看到 **72 行红**，无法从格式上分辨哪 9 行与自己无关。

3. **这 9 条加白名单也压不掉。** `room-imports-third-party-package` 的 `to` 里只有 `dependencyTypes`，**没有 `path` / `pathNot`**，`ROOM_WHITELIST` 对它完全不起作用。要压掉只有两条路：(a) 构建；(b) 改这条规则的判据（把 `unknown` 从列表里删掉、或给它加一条 `pathNot`）——**而这条规则正是本票要修的**，等于用改松判据换绿。

4. **全绿的正确做法：先 `node scripts/build.mjs`，再跑门禁。** 我在已构建的 `474602bd` 上把票面要求的四件事全做完，门禁退出码 0。

5. **为什么这个陷阱特别容易踩**：`npm test` 的顺序是 `typecheck && build && verify-chain && smoke`（`package.json:scripts.test`），CI 会先构建，**所以 CI 永远看不见这 9 条**；而票面给的验收命令 `node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts` 是裸跑，**看不见构建那一步**。执行者在本地干净树上跑票面命令，必然撞上。

6. **同一条陷阱还有第二个受害者**：`tests/verify-gate-map.js` 在没构建的干净检出上 6 条 FAIL（见 §1 附带核对），在已构建检出上 1 条 FAIL，跑 `node scripts/gate-map.mjs` 后 85 条断言全过。

### 明确建议（要写进票面）

> 本票的验收统一在「跑过 `node scripts/build.mjs` 的检出」上做。在没跑过构建的检出上跑门禁时，只认 `cross-room-import` 的红；`room-imports-third-party-package` 的红一律先构建再看，那 9～12 条与本票无关，**不要为了它们加白名单，更不要改这条规则的 `to` 判据**。

同一句话也解掉 Agent Brief §4.2 的误判：既然已构建检出上 `verify-gate-map.js` 能过，原版验收第 2 条就不该被删，只需补一句「跑 `node scripts/gate-map.mjs` 重新生成 `tests/gate-map.json`」。

---

## 3. 新判据可实现性

**结论：用今天 `tests/verify-dependency-rules.ts` 已有的输入就实现得了，不需要引擎加任何东西，也不需要新依赖。但票面没写的三个边界会造成假红或崩溃。**

### 输入齐不齐（实测）

- `ruleSetUsed.forbidden` **带 `from` / `to`**。实测 `474602bd` 的 JSON：`cross-room-import` 返回 `from={"path":"^src/host/tracker/backends/(github|gitlab|markdown)/"}`，而它当时命中了 **0 条边**——**规则一条边都不命中时它照样出现在 `ruleSetUsed` 里**（10 条全在、severity 全是 error）。这正是本票能假绿的直接成因：现有的「规则清单齐全（10 条）」只按名字核对存在性。
- 模块清单 `modules[].source` 就是模块路径，可以直接拿去跑正则。
- 因此判据实现 = 对每条规则取 `from.path`，对**去重后**的 `source` 集合做 `new RegExp(p).test()`，命中 0 判红。我照这个写了一版（20 行），正反两向都验过（见 §1-c）。

### 今天代码里挡路的两处（不是障碍，是工作量，票面该提一句）

- `ruleSetUsed` 被声明成 `Violation['rule'][]`（`tests/verify-dependency-rules.ts:506`），而 `Violation['rule']` 只有 `{name, severity, comment}`（`:72-77`）——**类型里没有 `from`**，要加宽。
- `parsed` 是 `else` 块内的局部量（`:524-542`），模块清单要提到外层才能在后置判据里用。

### 三个必须写进票面的边界（都会造成假红或当场崩）

1. **`circular-dependency` 的 `from` 是 `{}`**（`.dependency-cruiser.cjs:209`），没有 `from.path`。必须显式跳过，否则这条规则永远判红。实测：加上跳过之后它是 `INFO 规则起点是全局判据、没有 from.path，跳过空转检查：circular-dependency`。
2. **`deck-deep-import` 的 `from.pathNot` 在 JSON 里是空字符串 `""`**（实测 `deck-deep-import :: from={"path":"^(src/deck/|src/host/tools/|src/shared/deck-tools/)","pathNot":""}`）。若实现者写 `pathNot !== undefined` 就当正则用，`new RegExp("")` **匹配一切** → 这条规则的有效命中变成 0 → **假红**。空串必须当没写（我的实现里用 `from.pathNot ? ... : null` 恰好躲过，纯属运气好，票面不能靠运气）。
3. **`from.pathNot` 的类型不稳定**：配置里是数组（`same-layer-import-host` 的 `pathNot: ['^src/host/platform/', '^src/host/tracker/backends/']`），引擎 JSON 里被压成**字符串** `'^src/host/platform/|^src/host/tracker/backends/'`（实测）。按数组调 `.map()` 会当场崩。

### 替代实现路径与代价（如果这条判据不加）

没有等价替代。

- 退而求其次可以「把 `from.path` 里明显的目录前缀剥出来 `existsSync` 一下」——但它只覆盖 `^src/xxx/` 这种纯目录形态，`^src/host/`（今天存在）、`^(src/deck/|src/host/tools/|src/shared/deck-tools/)`（分组）、`^src/tracker/contract/` 里带 `\.` 转义的都判不了，写出来是一段更脆的启发式。
- 而 `ruleSetUsed` 恰好已经把「引擎真正用的那份判据」原样交出来了，不用白不用。

### `EXPECTED_RULES` 要不要连着改

**不用**——`missing = EXPECTED_RULES.filter((n) => !got.has(n))`（`:548`）是子集核对，多一条规则不会被报出来，也不会对不上。

**但有一个票面必须给的分叉**：如果实现者把新判据写成 `.dependency-cruiser.cjs` 里的**第 11 条规则**，那 `ruleSetUsed` 会有 11 条，而 `EXPECTED_RULES` 只有 10 条——子集核对仍然通过，**新规则从此没人管**。所以：
- 加在 `tests/verify-dependency-rules.ts`（推荐）→ `EXPECTED_RULES` **不动**；
- 加成配置里的新规则 → **必须**同票把名字加进 `EXPECTED_RULES`，否则这条判据自己就是下一个「没人查的规则」。

---

## 4. 票面缺口清单（必须补 / 建议补 / 可以不补 + 建议措辞）

### 必须补（6 条，不补就会让执行者猜）

**M1. 验收在哪种检出上跑。**
> 本票的验收统一在跑过 `node scripts/build.mjs` 的检出上做。在没跑过构建的检出上，`room-imports-third-party-package` 会因为 `src/shared/label-color/colors.js`、`src/shared/refresh/idempotency.js`、`src/shared/config-store/labels.js` 这些构建产物缺失而多报 9 条（补了 `src/tracker` 为根是 12 条）。这 9 条与本票的改动无关，不要为了它们加白名单，也不要改那条规则的终点判据。

**M2. 两条规则的起点判据写成什么正则原文。**
> `cross-room-import` 的 `from.path` 改成 `'^src/tracker/rooms/(github|gitlab|markdown)/'`；同一条规则 `to.pathNot` 的第一项改成 `'^src/tracker/rooms/$1/'`。`room-imports-third-party-package` 的 `from.path` 改成 `'^src/tracker/rooms/'`。`$1` 这个反向引用是「同房间放行」的全部机制，不许改成不捕获的组（改成 `(?:...)` 会当场误伤所有同房引用）。

**M3. 白名单该有哪几条（今天的真实房外引用面）。**
> `ROOM_WHITELIST` 按下面 11 条重写，顺序照写：
> `'^src/tracker/contract/'`（旧条目 `^src/shared/tracker/` 搬家后的新名字，契约层是搬家后新立的，实际引用面是整个目录而不是 README 里写的那一个文件）、
> `'^src/tracker/preflight\\.ts$'`（旧条目 `^src/host/tracker/preflight\\.js$` 的今天位置）、
> `'^src/tracker/error-rules\\.ts$'`、`'^src/tracker/identity-keys\\.ts$'`、`'^src/tracker/detection/workspace-ownership\\.ts$'`（三条搬家后的共享件，都是真值引用不是 `import type`）、
> `'^src/host/outbound/'`（旧的 `src/shared/tracker/outbound-tiers.js` 与 `outbound-admission.js` 搬成了 `src/host/outbound/tiers.ts` 与 `admission.ts`）、
> `'^src/host/refresh/'`（旧的 `src/shared/refresh/chain-ride.js` 搬到 `src/host/refresh/chain-ride.ts`）、
> `'^src/shared/label-color/'`、`'^src/shared/refresh/'`、`'^src/shared/config-store/'`、`'^src/host/platform/'`（这四条照旧）。
> 删掉两条已死的旧条目：`'^src/shared/labels\\.js$'`、`'^src/host/tracker/preflight\\.js$'`（对应文件在磁盘上已经不存在）。
> **每条只写目录前缀，不要写精确到 `.ts` 的文件名**：已构建的检出上房间引 `../../contract/vocabulary.js` 会解析到构建产物 `src/tracker/contract/vocabulary.js`，写死 `.ts` 会漏。
> （实测：这 11 条在已构建的检出上把 cross-room 违规从 80 条压到 0 条。）

**M4. 「四处」逐个点名，并说清其余不碰。**
> 本票只改这四处的路径说法：`CONTEXT.md` 第 35 行与第 36 行、`src/tracker/rooms/README.md` 的「房间纪律」一节（含白名单）、`tests/same-layer-baseline.json` 第 4 行的 `note`、`.dependency-cruiser.cjs` 的 31、95、127、133、148 五行注释。全仓还有 91 个受版本控制的文件写着 `src/host/tracker/backends`（含 `tests/verify-deck-tools-host-wiring.js` 这类功能代码与 `tests/handwritten-js-baseline.json` 这 63 条迁移对账基线），本票一律不动，归 #1118。

**M5. 「两处白名单逐条一致」的可判口径。**
> 规则文件里的 `ROOM_WHITELIST` 是白名单的唯一真源；`src/tracker/rooms/README.md` 的「房间纪律」一节按它的目录逐条重写。`node` 内置模块与「同房间内相对路径」两条不属于 `ROOM_WHITELIST`（它们分别由 `to.path` 只收 `^src/`、以及 `to.pathNot` 里的 `$1` 实现），在 README 里保留为说明、不参与逐条比对。`CONTEXT.md` 与 `tests/same-layer-baseline.json` 只写路径说法，不列白名单。

**M6. 新判据的三条边界与判红文案。**
> 新判据读引擎返回的 `ruleSetUsed.forbidden[].from.path` 与**去重后**的 `modules[].source`，命中 0 个判红。`from` 是 `{}`（没有 `path`）的规则跳过——今天只有 `circular-dependency` 一条属于这种。`from.pathNot` 是空字符串时当作没写（今天 `deck-deep-import` 就是空串，当正则用会匹配一切、把这条规则误判成空转）。`from.pathNot` 可能是字符串而不是数组，不许直接调数组方法。判红文案要同时写出规则名与 `from.path` 原文。

### 建议补（3 条）

**S1. 「65 个」的口径与举证方式。**
> 65 = `src/tracker/rooms/**` 下扩展名属于 `{js, mjs, cjs, ts, mts, cts}` 的文件数（即门禁 `SOURCE_EXTS` 的口径），不含 `README.md`。要断言「都进图」必须按 `modules[].source` **去重后**再数——`modules.length` 会把同一个文件计两次（`474602bd` 上 4 根是 364 条 / 305 个不同源，5 根是 420 条 / 323 个不同源），门禁打印的「图上 N 个模块」不是覆盖数。

**S2. 改完要跑哪几道门禁、什么顺序。**（见 §5。）

**S3. 新判据走哪条路、`EXPECTED_RULES` 动不动。**
> 新判据加在 `tests/verify-dependency-rules.ts` 里，**不加**进 `.dependency-cruiser.cjs`。走这条路就不动 `EXPECTED_RULES`（它是子集核对，多一条规则不会被发现）；若改成在配置里加第 11 条规则，则必须同票把这个规则名加进 `EXPECTED_RULES`，否则这条新判据自己就会变成下一个没人查的规则。

### 可以不补（2 条）

**N1. 待确认第 1 条**（`src/tracker/detection/workspace-ownership.ts`、`src/tracker/error-rules.ts`、`src/tracker/identity-keys.ts` 三条共享件放不放行）——票面已给推荐「放行并在注释里写明来由」，理由（搬家后的共享件、真值引用）成立，照做即可，不必等维护者回复。
**N2. 探针加在哪一行、什么形态**——`import '../gitlab/index.js'` 已经实测有效（边进图、判红行点名该边），够了。

---

## 5. 顺序与依赖、要重跑的门禁命令

### 与主工作树正在做的 gitlab 迁移会不会撞车——会，而且已经在撞

**审查期间主工作树发生了移动**（不是我的操作，我全程只读）：

- 我进来时（15:30）：HEAD = `474602bd`，70 项未提交。
- 现在：HEAD = **`a743c0eb`**，`origin/main` 也是 `a743c0eb`（中途落了 4 个提交：`ffd5848a` #1144、`d7ca179a`/`da3c0fc6`/`a743c0eb` #1148）。**票面钉住的 `474602bd` 已落后 4 个提交。**
- 未提交项仍有 65 个，**横跨三个房间**：`src/tracker/rooms/github` 7 个、`src/tracker/rooms/gitlab` 14 个（13 个是 `.js`→`.ts` 改名）、`src/tracker/rooms/markdown` 21 个，合计 42 个房间文件。

**撞车的实测证据**：同一份「只改 `from`/`pathNot`、白名单原样」的配置，5 根下

- 在 `474602bd` 上：cross-room **80 条**；目标目录分布 `src/tracker/contract` 48、`src/tracker` 28、`src/host/outbound` 2、`src/host/refresh` 1、`src/tracker/detection` 1。
- 在今天的主工作树上：cross-room **176 条**；目标目录分布 `src/tracker/contract` 143、`src/tracker` 29、`src/host/outbound` 2、`src/host/refresh` 1、`src/tracker/detection` 1。

**差的 95 条不是新架构，是「一条边算几条」**：`type` 化之后 JSDoc 里的 `import('../../contract/identity.js')` 这类类型引用被 TypeScript 提取成依赖边，而配置里 `tsPreCompilationDeps: true`（`.dependency-cruiser.cjs:25`）把类型级引用也算边。

**结论：不必等迁移落地，但票面必须改成「白名单按目录前缀写、不要照抄条数」。** 目标目录集合在两个状态下完全一样（还是 contract / preflight / error-rules / identity-keys / detection / host-outbound / host-refresh 这几处），所以 M3 那份 11 条白名单在两个状态下都成立；而票面里所有具体条数（63、81、44、26、9）在迁移落地后全部作废。执行者动手前应先 `git rev-parse HEAD` 确认基准，凡引用数字都当场重测。

**另有一处口径要顺带纠正**：Agent Brief 说「房间纪律的另一半（`verify-no-mixed-session`）今天会真判红」。**实测今天不成立**——在未提交的主工作树上跑 `node --import ./scripts/ts-hook.mjs tests/verify-no-mixed-session.js` 得到 `[verify-no-mixed-session] PASS`、退出码 0，它自己打印「基准: a743c0eb 的改动: 0」。它算的是 `base...head`，未提交的工作区改动算 0 个文件。等那 42 个跨房改动一提交它才会红——那是别人的事，不是本票的（本票也明确不动它）。

### 改完必须重跑（命令原文，按顺序）

```
node scripts/build.mjs
node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts
node --import ./scripts/ts-hook.mjs tests/verify-gate-map.js
```

- 第 1 条**必须有**：不构建就会看见那 9 条与本票无关的假红（§2）。证据：同一份改动，未构建检出退出码 1、9 条 `room-imports-third-party-package`；已构建检出退出码 0。
- 第 2 条：本票的主门禁。
- 第 3 条：`tests/verify-dependency-rules.ts:32-33` 自己写着「本文件读的 `.dependency-cruiser.cjs` 与 `tests/same-layer-baseline.json` 会被 `verify-gate-map.js` 算成归属依据」。实测**改规则文件本身不会让 `tests/gate-map.json` 失效**（在已构建检出上把 `from` 改对之后再跑 `verify-gate-map.js`，仍是 85 条断言全过）；但已构建检出上 `tests/gate-map.json` 会因构建产物与磁盘文件数对不上而红，需要跑一次 `node scripts/gate-map.mjs` 重新生成。
  **注意这一条是票面与 Agent Brief 的冲突点**：正文原版验收第 2 条要求 `verify-gate-map.js` 判绿，Agent Brief §4.2 说本票不背。我在 §1/§2 用实测支持「能背」——只要加一句「跑 `node scripts/gate-map.mjs` 重新生成归属表」。**派单前必须由人拍板这一条背不背**，否则执行者会照 Brief 把一条本来能过的验收删掉。
- 收尾：`npm run verify:changed`（或 `npm run verify:parallel`）把链上相关门禁跑一遍。

---

## 6. 三种翻车剧本与前兆

### 剧本一：把 9 条构建假红当成自己的锅，动手改松被修的那条规则

**路径**：按票面的实验姿势 `git worktree add --detach` 拉一棵干净树（没构建）→ 改 `from`/`pathNot` → 跑票面给的命令 → 看到 **72 行 FAIL**，其中 9 行是 `room-imports-third-party-package：… -> '../../../shared/label-color/colors.js'` → 试着往 `ROOM_WHITELIST` 加条目，发现完全无效（这条规则没有 path 白名单）→ 得出结论「必须改这条规则才行」→ 给它加一条 `to.pathNot`，或者把 `'unknown'` 从 `dependencyTypes` 列表里删掉 → 门禁绿了，但**这条规则从此不再管解析不到的第三方引用**，等于用改松判据换绿，而且改的正是本票要修的那条规则。

**前兆信号**：
- diff 里出现对 `room-imports-third-party-package` 的 `to` 字段的任何改动（本票只该动它的 `from.path`）；
- `ROOM_WHITELIST` 里出现 `colors.js` / `idempotency.js` / `config-store/labels.js` / `create-write.js` 这类**构建产物文件名**；
- 报告里出现「未构建检出上有 9 条无法解释的违规，已通过调整规则解决」。

### 剧本二：把「模块总数」当覆盖数，用没去重的计数自证 AC-e

**路径**：加了根清单、看到门禁打印「图上 420 个模块」（或 396 / 364）→ 420 > 65，判定 AC-e 达成 → 从没真去数 `src/tracker/rooms/` 子树。实际在**不补根清单**的配置下只有 **56/65** 进图（缺 gitlab 8 个没人引的 `.js` + `markdown/normalize.ts`），而这 9 个文件上的边一条都不会被判。另一种变体：执行者真去数了，但数的是模块条目数，得到 **73**，误以为「房间源码有 73 个」或「有 8 个文件重复了」，去查一个不存在的问题。

**前兆信号**：
- 报告或注释里出现「图上 420（或 396 / 364）个模块，覆盖得住 65 个房间源码」而没有出现「去重」二字；
- 出现「房间源码共 73 个」这种数；
- 门禁的输出里没有一条按 `^src/tracker/rooms/` 统计覆盖的 PASS 行——说明 AC-e 根本没有机器判据，只是被一个更大的数字糊过去了。

### 剧本三：做「四处一致」时顺手全仓替换 `tracker/backends`，撞上 #1118 与别人的迁移

**路径**：为了满足 AC-f，用 `git grep tracker/backends` 找目标 → 命中 **91 个受版本控制的文件**（`.md` 61、`.html` 10、`.ts` 8、`.js` 6、`.json` 4、`.cjs` 1、`.txt` 1）→ 顺手全改 → 撞上两处**不是注释**的东西：`tests/verify-deck-tools-host-wiring.js:41,46`（功能代码里的路径分区判定）与 `tests/handwritten-js-baseline.json:245-307`（63 条旧路径，是别人 `.js`→`.ts` 迁移的对账基线）→ 同时 diff 里混进别人正在改的 42 个房间文件，把一张小票变成一张几百行的大票。

**前兆信号**：
- `git status` 里出现 `tests/handwritten-js-baseline.json`、`tests/verify-deck-tools-host-wiring.js`、`CHANGELOG.md`、任何 `.html`、或 `src/client/**`；
- 改动文件数超过 ~10 个（本票的合理面是：`.dependency-cruiser.cjs`、`tests/verify-dependency-rules.ts`、`CONTEXT.md`、`src/tracker/rooms/README.md`、`tests/same-layer-baseline.json`，加一条探针的临时改动）；
- 提交信息里出现「顺带把活文档路径也刷新了」。

---

## 附：读过的一手材料与跑过的命令

### 读过的一手材料

- `gh issue view 1136 --json title,body,labels,state` 与 `gh issue view 1136 --comments`（Agent Brief 全文 6168 字符，FeatherHunter 2026-10-14 07:25:06）。
- `tests/verify-dependency-rules.ts`（640 行全文，在读）；`.dependency-cruiser.cjs`（223 行全文，在读）。
- `src/tracker/rooms/README.md`（全文，「房间纪律」一节）；`tests/same-layer-baseline.json`（头部 12 行）；`CONTEXT.md` 第 25–50 行。
- `package.json` 的 `scripts` 全表；`scripts/build.mjs` 头部 40 行；`scripts/gate-map.mjs` 与 `tests/verify-gate-map.js` 的写文件点。
- `git grep tracker/backends`（91 个文件）；`git ls-tree -r HEAD -- src/tracker/rooms`。

### 跑过的命令（全部在临时工作树或只读主工作树上）

```powershell
# 建树与借依赖
git worktree add --detach D:\Temp\1136-exec  474602bd
cmd /c mklink /J D:\Temp\1136-exec\node_modules D:\dsh-plugin\dsh-mattpocock-skills-deck\node_modules

# 假绿复现（票面现象 1/2）
node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts            # 退出码 0
node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs src/host src/shared src/seam src/deck `
  --config .dependency-cruiser.cjs --output-type json --no-progress             # 364 模块 / 651 边

# 探针与反证
Add-Content src\tracker\rooms\github\index.ts "`nimport '../gitlab/index.js'`n"  # → 652 边，仍退出码 0
# 改 from/pathNot 到 ^src/tracker/rooms/... 后 → 退出码 1，判红行点名该边
# 换成 import './backend.js' → cross-room 63 → 62 条，无新增误伤

# 环境矩阵（4 根 / 5 根 × 构建前 / 构建后 × 原配置 / 修好的配置）
node scripts/build.mjs                                                          # BUILD_EXIT=0

# 白名单翻译后的实测：11 条 → 已构建检出 cross-room 80 → 0
# 根清单补 src/tracker 后：扫描域 311 个源码文件 / 420 个模块 / 713 条边
# 新判据（20 行）正反两向验证：9 条规则全命中；from.path 指空目录当场判红

# 门禁地图
node --import ./scripts/ts-hook.mjs tests/verify-gate-map.js                    # 未构建 6 条 FAIL；已构建 1 条 FAIL
node scripts/gate-map.mjs                                                       # 已写入 tests/gate-map.json（229186 字节）
node --import ./scripts/ts-hook.mjs tests/verify-gate-map.js                    # 全部通过（85 条断言），退出码 0

# 主工作树只读测量
node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs src/host src/shared src/seam src/deck src/tracker `
  --config $env:TEMP\1136-dc-fixed.cjs --output-type json --no-progress         # cross-room 176 条
node --import ./scripts/ts-hook.mjs tests/verify-no-mixed-session.js            # PASS（「基准: a743c0eb 的改动: 0」）

# 清理（先拆 junction 再删树，主仓 node_modules 未受影响）
cmd /c rmdir D:\Temp\1136-exec\node_modules ; cmd /c rmdir D:\Temp\1136-exec2\node_modules
git worktree remove --force D:\Temp\1136-exec ; git worktree remove --force D:\Temp\1136-exec2
```

### 本次审查的写入物

只有本文件（`research/1136-adversarial-executability.md`）。主工作树的源码、测试、配置一行未改，未 `git add`/`commit`/`stash`/`checkout`/`reset`/`clean`；两棵临时工作树已删除。主工作树在我进来前后 `git status` 项数从 70 变成 65、HEAD 从 `474602bd` 走到 `a743c0eb`，**均为他人提交所致，非本次审查造成**（我全程只跑读取类命令）。
