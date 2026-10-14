# 覆盖对账的 20 条「重复归属」怎么收口：三条现成路加一条实测出来的路（#1148 调查）

- 调查时间：2026-10-14（Asia/Shanghai），只读调查。唯一写入的文件是本文件。
- 环境：Node v24.19.0；TypeScript **7.0.2**（`node_modules/typescript/package.json` 的 `version` 字段）。
- 探针一律建在系统临时目录（`$env:TEMP`），或在仓库内建好后与测量放在同一条 `pwsh` 命令里删掉；收尾核对过 `git ls-files --others --exclude-standard ':(glob)**/tsconfig*.json'`，除并发会话正在写的 `src/tracker/tsconfig.json` 之外没有任何多余配置（见 3.1 末）。
- 期间另一个会话正在同一棵树上改 `src/tracker/`（`git status` 有 87 项改动），所以下面所有「错误条数」都是当时快照，会漂移；结论只用可复现的**归属集合**（哪些文件落在谁的声明里），不用错误条数。

## ① 结论先行

**推荐走第 4 条路：改配置——给 `src/tracker/tsconfig.json` 的 `include` 配一份 `exclude`，把契约配置已经声明的那 20 份排除掉（7 个模式）。** 一句话理由：这是唯一一条不改判据、不新增机制、实测能让 C 真的变绿、又不会碰坏 B 的路（实测：排除后 tracker 配置的声明清单里那 20 份剩 0 份，程序闭包里仍有 14 份，剩下 6 份由契约配置声明并仍在它的闭包里，所以「有没有人检查」一条不变）。

**必须在三条现成路里选一条时，排序是：改对账口径 > 记成已知债 > 合配置。**

- 改对账口径（例如「仓库根上的配置声明域内文件不算重复归属」）改动最小、当天就能让 20 条消失，代价是把「一个文件只被一份配置当作根输入」这条约定缩成「域配置之间不重复」——是有意的收窄，不是假绿，但要在票面与文档里写明缩窄到哪。
- 记成已知债最诚实但最贵：这份门禁今天**没有**给 C/D 用的基线机制（`compareBaseline` 只管手写 JS 棘轮 F），要走这条路等于新建机制（新基线文件 + 改 `judge()` + 改假事实自查）。为一个 7 行的配置改动新造一套机制，不划算。
- 合配置今天走不通：把 tracker 与 contract 两边圈进一份配置后 `tsc -p` 报 223 条错误（同刻 tracker 配置自己报 249 条），契约门禁第 1 项当场红；而且它会把契约门禁从「契约层自洽」放大成「整棵 tracker 干净」，信号变差。

**三条路都不解决今天的红。** 20 条重复归属只是 35 条不通过里的一桶（另两桶：13 条 `src/host` 缺口、1 条 tracker 配置的类型错误、1 条手写 JS 棘轮涨了）。任何一条路最多把 35 条变成 15 条。

**关于二分法（问题四最后一句）：站得住，不用退回去，但要说清它是本仓自定的约定、不是 TypeScript 的规则。** 详见 ④ 末尾。

## ② 四条路对照表

| 路 | 改动面 | 新机制 | 风险 | 会不会制造假绿 | 证据 |
|---|---|---|---|---|---|
| 1 合配置（tracker 与 contract 并成一份） | 删/改 `tsconfig.contract.json`；改契约门禁的配置路径（现在是缺省值 + `DSH_CONTRACT_TSCONFIG` 覆盖）；改 `scripts/build.mjs:82` 的 `INPUT_EXTRA`；改 `src/tracker/contract/README.md:93` 的用法行；改多处注释 | 不需要新机制，但要改 4 处既有接线 | 今天 `tsc -p` 报 **223 条**错误，契约门禁第 1 项直接红；契约门禁的判定范围从「契约层」变成「整棵 tracker」，出红时要人去分辨哪些是契约的问题；`composite` 的 `rootDir`/必须登记两条约束（TS6059／TS6307）今天也用不上（本仓没有一份配置开 `composite`） | 不会——它是把问题暴露得更多 | 3.3；`tests/verify-contract-types.js:81`（缺省路径 + 环境变量覆盖）、`:375-381`（第 1 项）、`scripts/build.mjs:82`、`src/tracker/contract/README.md:93` |
| 2 改对账口径 | `scripts/typecheck.mts` 的 `judge()` 里 C 断言加一个豁免条件（约 3 行）；改 `tests/verify-typecheck.mts` 里钉住口径的假事实（现有 5 条，`:81/:96/:109/:119/:129`） | 不需要（改的是判据本身） | 豁免一旦写宽（例如「任何根配置都不算重复」），下一次真的「两份配置各按自己的编译选项把同一份文件检查两遍」也会被放过——那正是这道门禁出生时要治的病（`scripts/typecheck.mts:12-16`） | **有可能**，取决于豁免写多宽；写成「只豁免 `dir === ''` 的配置」时，`tsconfig.client.json`（事实上就是 client 域的配置，只是住在根上）也一并被豁免，范围没人看得出来 | 3.4；`scripts/typecheck.mts:459-467`（C 判据）、`tests/verify-typecheck.mts:96-107`（钉住 C 的假事实） |
| 3 记成已知债（基线） | 新增一份基线文件；`judge()` 读它并对账（只许减不许增）；`tests/verify-typecheck.mts` 加夹具 | **要新建**：这道门禁今天只对 F（手写 JS）有基线，C/D 没有白名单/基线机制 | 机制建成后要长期维护；基线把「今天已知」冻住，但重复归属本身（同一份文件被两份配置当根输入、各按自己的编译选项解释）一天不解决就一天在账上；另外要防「基线只增不减」的老化 | 会——门禁转绿，但 20 份文件仍被检查两遍；诚实的说法是「转绿=记账，不是解决」 | 3.4；`scripts/typecheck.mts:51`（唯一的基线路径）、`:378-388`（`compareBaseline` 只比名单）、`:502-509`（只有 F 用它）；先例是 `tests/verify-dependency-rules.ts:19-53/216` 的 `tests/same-layer-baseline.json` |
| **4 改配置：tracker 配置加 `exclude`（本次推荐）** | `src/tracker/tsconfig.json` 一个文件：`exclude` 写 7 个模式（契约目录 + 6 份点名文件），并在注释里指向 `tsconfig.contract.json` | 不需要 | 排除名单要跟着契约配置的 `include` 走：契约配置将来多圈一份域内文件，tracker 这边要补一条 exclude（不补 → C 会红，正是想要的报警方向）；另外这份配置现在是并发会话 #1147 的未提交文件（`git status` 显示 `?? src/tracker/tsconfig.json`），要由那一票或紧随其后落地，避免两人同时改 | 不会——B 判据实测不变（闭包仍看到 14 份，另 6 份由契约配置声明并仍在它的闭包里），C/D 是集合意义上真的空了 | 3.2；`src/tracker/tsconfig.json:39`（今天的 `include`）、`tsconfig.contract.json:33-48`（契约侧的 20 份声明） |

## ③ 实测记录

### 3.1 今天的基线（`node scripts/typecheck.mts`，退出码 1）

9 份配置，逐份「声明 N 个源码文件／顺 import 共看到 M 个」：

```
src/deck/tsconfig.json —— 声明 37，闭包 52
src/shared/config-store/tsconfig.json —— 声明 4，闭包 4
src/shared/host-timer/tsconfig.json —— 声明 1，闭包 1
src/shared/label-color/tsconfig.json —— 声明 3，闭包 3
src/shared/refresh/tsconfig.json —— 声明 14，闭包 14
src/shared/version-control/tsconfig.json —— 声明 14，闭包 14
src/tracker/tsconfig.json —— 声明 99，闭包 115（未通过）
tsconfig.client.json —— 声明 39，闭包 39
tsconfig.contract.json —— 声明 20，闭包 21
src/ 下源码 227 份，被配置看到 214 份
手写 JavaScript 名单 590 份，基线 714 份
不通过：35 条
```

35 条的构成（原文摘要）：

- **缺口 13 条，全在 `src/host`**：`detectChain.ts`、`git-process.ts`、`platform/darwin/index.ts`、`platform/linux/index.ts`、`platform/win32/index.ts`、`refresh/gate.ts`、`refresh/ledger.ts`、`refresh/refusal-text.ts`、`sessionRefresh.ts`、`sessionSnapshot.ts`、`snapshotBuild.ts`、`snapshotEnvelope.ts`、`snapshotInflight.ts`。
- **重复归属 20 条**，每条都写「同时落在这些配置里：`src/tracker/tsconfig.json`、`tsconfig.contract.json`」。20 份 = 契约目录 14 份（`backend-module`、`canonical-labels`、`contexts`、`contract-idempotency`、`contract-label-colors`、`contract-page`、`entities`、`identity`、`index`、`inputs`、`operations-catalog`、`operations`、`results`、`vocabulary`）+ 点名暂住的 6 份（`src/tracker/identity-keys.ts`、`label-names.ts`、`fix-contract.ts`、`ui-description.ts`、`error-rules.ts`、`rooms/markdown/error-fail.ts`）。
- **越界 0 条**（#1148 改口径后清零，本次复现）。
- **类型错误 1 条**：`src/tracker/tsconfig.json 报了 249 条类型错误`，前三条原样是
  `src/host/refresh/chain-ride.ts(19,33): error TS7006: Parameter 'opts' implicitly has an 'any' type.`、
  `src/host/refresh/chain-ride.ts(25,17): error TS7006: Parameter 'key' implicitly has an 'any' type.`、
  `src/host/refresh/chain-ride.ts(33,17): error TS7006: Parameter 'key' implicitly has an 'any' type.`
- **棘轮涨了 1 条**：`tests/verify-1150-plan-store-durable.js`。

（背景材料里说这条类型错误「515 条、源头在 src/host」——那是更早的一次读数；本次实测 249 条，几分钟后同一棵树用合并配置再跑是 223 条，且**绝大多数落在 `src/tracker` 自己身上**，见 3.3。数字在动是因为 #1147 正在改这批文件。）

探针清理核对（收尾时）：

```
$ git ls-files --others --exclude-standard ':(glob)**/tsconfig*.json'
src/tracker/tsconfig.json        # 并发会话 #1147 正在写的文件，不是探针
$ (Get-ChildItem -Recurse -Filter '*probe1148*').Count
0
```

### 3.2 实验 a：给 tracker 配置的等价物加 `exclude`

探针 `src/tracker/tsconfig.probe1148a.json`（与 `src/tracker/tsconfig.json` 同目录、同一份 `compilerOptions`，`include: ["**/*.ts"]`，`exclude: ["node_modules","bower_components","jspm_packages","contract/**","identity-keys.ts","label-names.ts","fix-contract.ts","ui-description.ts","error-rules.ts","rooms/markdown/error-fail.ts"]`），测量与删除在同一条命令里：

```powershell
node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.probe1148a.json --showConfig    > $env:TEMP\a-show.json
node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.probe1148a.json --listFilesOnly > $env:TEMP\a-list.txt
Remove-Item src/tracker/tsconfig.probe1148a.json     # 同一条命令内删除
```

实测结果（原始 JSON 摘要，已滤掉 `node_modules` 下的库文件）：

```json
{ "trackerClaimedCount": 79,            // 改之前 99
  "trackerClosedCount": 109,            // 改之前 115
  "contractClaimedCount": 20,
  "contractClosedCount": 21,
  "duplicatesAfterExclude": [],         // C 判据的交集：空
  "overlap20_inTrackerClaimed": 0,
  "overlap20_inTrackerClosure": 14,
  "overlap20_inContractClaimed": 20,
  "overlap20_inContractClosure": 20 }
```

逐条读法（这是「C 能不能变绿、会不会伤 B」的直接答案）：

- `--showConfig` 的 `files`（= 这份配置**自己声明**的清单）从 99 降到 79，那 20 份一份不剩 → **C（重复归属）在这两份配置之间真的清零**。
- `--listFilesOnly`（= 程序闭包，顺 import 带进来的也算）少了 6 份，仍有 14 份：被 tracker 自己 import 的契约文件照样进程序。
- 走掉的那 6 份逐一核对：`contract-idempotency.ts`、`contract-label-colors.ts`、`contract-page.ts`、`fix-contract.ts`、`label-names.ts`、`ui-description.ts`——**全部**既在 `tsconfig.contract.json` 的声明清单里（20 份之一），也在它的闭包里（21 份之一）。B（缺口）判的是所有配置闭包的并集，所以 B 一条不多。
- D（越界）今天本来就是 0：根上的配置按判据跳过（`scripts/typecheck.mts:472-476`），tracker 配置排除之后声明全在自己目录内。

结论：**改配置这条路能让 C 变绿，且实测不伤 B。**

### 3.3 实验 b：把契约配置的 `include` 收窄，契约门禁会不会红

探针建在 `$env:TEMP\tsconfig.contract.probe1148b.json`（`compilerOptions` 与 `tsconfig.contract.json` 完全一致，`include` 只留一项：`["<仓库绝对路径>/src/tracker/contract/**/*.ts"]`），用门禁自带的覆盖开关跑：

```powershell
$env:DSH_CONTRACT_TSCONFIG = "$env:TEMP\tsconfig.contract.probe1148b.json"
node tests/verify-contract-types.js
```

先确认探针真圈到了文件：`--showConfig` 的 `files` 是 **14** 条（契约目录 14 份 .ts，全中）。门禁输出（退出码 1）：

```
  PASS 五样输入齐（契约目录 src\tracker\contract、..\..\Temp\tsconfig.contract.probe1148b.json、operations.ts、两份探针），五样都在
  PASS tsc -p ..\..\Temp\tsconfig.contract.probe1148b.json 零错误
  PASS 契约目录 14 个 .ts 全部进了这次编译（tsc 清单里本目录 14 个）
  PASS 22 个契约操作名全部出现（22 个逐个查过，含名录件 operations-catalog.ts）
  PASS 3 条定位口名全部出现（共 25 条能力）
  PASS 契约目录下 14 个 .ts 文件都没有运行时实现（只许类型与数据，目录内数据互引除外）
  PASS 两份探针文件自己零报错（0 条；…）
  FAIL 后端文件内部报错 187 条，与基线 183 条相等——多了是新增债务，少了是有人动了实现面：先把基线数改过来，并考虑把探针收紧
  PASS 缺 matches 的假后端编不过、且报错点名 matches
  PASS 探针那条路也断得住缺成员：…（宽松开关 + 弱化形状，证明tests/contract-probe-github.ts 的 ProbeShape 不是摆设）
  PASS github / markdown / gitlab 模块对象与快照一致
存在失败 — 契约层类型门禁没通过
```

**对照实验（同一时刻，不设环境变量、用真的 `tsconfig.contract.json`）：输出逐条相同，失败也只有同一条「187 条，与基线 183 条相等」。**

所以：这一条 FAIL 与「收窄 include」无关——第 5 项探针是拿命令行开关直编的（`tests/verify-contract-types.js:112-116/448-450`），根本不读我那份配置；187 对 183 是并发会话 #1147 正在改后端实现面造成的既有漂移。**结论：收窄契约配置的 `include` 不会让契约门禁本身的断言变红。**

补充一句方向性的话：收窄契约配置**单独并不能清掉那 20 条**。契约目录那 14 份文件必须留在契约配置的声明里（门禁第 2 项要求契约目录 14 个 .ts 全进这次编译，`tests/verify-contract-types.js:385-414`），而 tracker 配置的 `include: ["**/*.ts"]` 同样声明了它们——两边都声明，C 就还红。所以「改配置」这一路只能从 tracker 侧排除。

### 3.4 实验 c：真做「合配置」会怎样

探针 `$env:TEMP\tsconfig.merge.probe1148c.json`（`compilerOptions` 与 tracker 配置一致，`include: ["<仓库绝对路径>/src/tracker/**/*.ts"]`，即一次圈住 tracker 与 contract 两边）。先确认范围等价：`--showConfig` 的 `files` = **99** 条，与真 tracker 配置声明的 99 条一致。

```powershell
node node_modules/typescript/bin/tsc -p $env:TEMP\tsconfig.merge.probe1148c.json
# 退出码 1，223 条错误行
```

按目录与错误码归类（原始统计）：

```json
{ "TOTAL_ERROR_LINES": 223,
  "BY_DIR": { "src/host/refresh": 10, "src/tracker/capability-assertions.ts": 4, "src/tracker/detection": 56, "src/tracker/rooms": 153 },
  "BY_CODE": { "TS7006": 130, "TS2339": 59, "TS2322": 10, "TS18046": 5, "TS2344": 4, "TS2554": 3, "TS18048": 3, "TS18047": 2, "TS7034": 2, "TS7005": 2, "TS7022": 1, "TS7023": 1, "TS2304": 1 },
  "FIRST3": [
    "src/host/refresh/chain-ride.ts(19,33): error TS7006: Parameter 'opts' implicitly has an 'any' type.",
    "src/host/refresh/chain-ride.ts(25,17): error TS7006: Parameter 'key' implicitly has an 'any' type.",
    "src/host/refresh/chain-ride.ts(33,17): error TS7006: Parameter 'key' implicitly has an 'any' type." ] }
```

223 条只落在 **7 个文件**里（路径逐条核对过在磁盘上存在，脚本自己算的相对路径）：`src/host/refresh/chain-ride.ts`（10 条）与 `src/tracker/` 下 6 个文件（213 条，其中 `rooms/` 153、`detection/` 56、`capability-assertions.ts` 4）。**「源头在 src/host」这句话在今天这棵树上不成立**——今天九成以上的错误在 `src/tracker` 自己身上；`src/host` 那 10 条是被 tracker 顺 import 拉进来的。

把这份合并配置喂给契约门禁（`$env:DSH_CONTRACT_TSCONFIG = 合并配置`）：

```
  PASS 五样输入齐（契约目录 src\tracker\contract、..\..\Temp\tsconfig.merge.probe1148c.json、operations.ts、两份探针），五样都在
  FAIL tsc -p ..\..\Temp\tsconfig.merge.probe1148c.json 零错误（退出码 1，错误见上面原样透出）
  PASS 契约目录 14 个 .ts 全部进了这次编译（tsc 清单里本目录 14 个）
  PASS 22 个契约操作名全部出现（22 个逐个查过，含名录件 operations-catalog.ts）
  PASS 3 条定位口名全部出现（共 25 条能力）
  PASS 契约目录下 14 个 .ts 文件都没有运行时实现（只许类型与数据，目录内数据互引除外）
```

契约门禁那几条断言在「合配置」下的存活情况（逐条读 `tests/verify-contract-types.js`）：

| 断言 | 落点 | 合配置下还立不立得住 |
|---|---|---|
| 配置路径必须存在（五样输入之一） | `:81`（缺省 `tsconfig.contract.json`，可用环境变量覆盖）、`:341-356` | **路径是缺省值，不是写死的常量**：可以指到别的文件；但若把 `tsconfig.contract.json` 删掉/改名，`node tests/verify-contract-types.js` 不带环境变量就跑不动第 0 项——要让链上入口继续跑，得同时改门禁缺省值（或留一份只指向合并配置的壳） |
| `tsc -p <配置>` 零错误 | `:375-381` | **不立**：223 条错误，红 |
| 契约目录 14 个 .ts 全进这次编译 | `:385-414`（`listTsFiles` + `--listFiles`） | 立得住（合并配置圈住了契约目录） |
| 22 个操作名 + 3 条定位口齐 | `:166-176`、`:416-429` | 立得住（读文本，与配置无关） |
| 契约目录无运行时实现 | `:431-446` | 立得住 |
| 探针直编 + 后端内部报错基线 183 | `:448-487` | 与配置无关（命令行开关直编）；今天已是 187 对 183，既有红 |
| 两条反面证明、运行时腿 | `:489-620` | 与配置无关 |

删除/改名 `tsconfig.contract.json` 的连带面（读代码与文档得到）：`scripts/build.mjs:82`（`INPUT_EXTRA` 五项之一，进构建指纹）、`src/tracker/contract/README.md:93`（写给人看的用法行）、`tests/verify-contract-types.js:81`、`docs/adr/20261014-error-classification-single-source.md:51`、`src/shared/host-timer/tsconfig.json:11`（注释里引用它做先例）、`research/1027-status-2026-10-14.md:108/121-122` 等调研记录。

### 3.5 实验 d：「记成已知债」今天有没有落点

**没有。这条路等于新建机制。** 逐条读 `scripts/typecheck.mts`：

- C（重复归属）在 `:459-467`，D（越界）在 `:469-485`，两条都是无条件断言，没有任何白名单、豁免表或基线对账。
- 文件里唯一的基线机制是 F（手写 JavaScript 棘轮）：`BASELINE_PATH`（`:51`）指向 `tests/handwritten-js-baseline.json`，`compareBaseline()`（`:378-388`）只比两份「文件名清单」，`judge()` 只把它用在棘轮那一段（`:502-509`）。它数的是「手写 .js 有哪些」，与「哪份配置声明了谁」不是一套数据。
- `tests/` 下现存的四份基线各有其主，都不是给覆盖对账用的：
  - `tests/handwritten-js-baseline.json` —— 本门禁 F（`scripts/typecheck.mts:51`）；
  - `tests/file-granularity-baseline.json` —— `tests/verify-file-granularity.js:29`、`tests/verify-leaves.js:18`、`tests/verify-refresh-adr.js:90`；
  - `tests/unmigrated-tests-baseline.json` —— `tests/verify-unmigrated-tests.ts:31`；
  - `tests/same-layer-baseline.json` —— `tests/verify-dependency-rules.ts:53`、`tests/verify-729-force-dedup.js:251`。
- 最接近的可抄先例是依赖图门禁的「存量豁免，只许减不许增」（`tests/verify-dependency-rules.ts:19`、`:216`，落点 `tests/same-layer-baseline.json`）。也就是说，真要走「已知债」，形状是现成的：**新开一份基线文件 + 让 `judge()` 读它 + 给 `tests/verify-typecheck.mts` 加夹具**，三处都要动。

另外提醒一句：`tests/verify-typecheck.mts` 用 5 组假事实把 B/C/D 的口径钉住了（`:81`「顺 import 看到别人目录的文件：不报越界、不报重复归属」、`:96`「两份配置都声明同一个文件：报重复归属」、`:109`「声明自己目录之外的文件：报越界」、`:119`「仓库根上的配置：跳越界」、`:129`「缺口仍按程序闭包判」）。**改对账口径或加基线，都要同步改这几条夹具**，改不动它们说明口径没想清楚。

### 3.6 TypeScript 语义两条微实验（临时项目，跑完即删）

1）**被 `exclude` 的文件，还会不会被 import 拉进程序**：临时项目 `a.ts` 里 `import { b } from "./b"`，配置 `include: ["**/*.ts"]`、`exclude: ["b.ts"]`：

```
--showConfig 的 files： [ "./a.ts" ]          ← 只有 a.ts
--listFilesOnly：      D:/Temp/exclprobe1148/b.ts
                       D:/Temp/exclprobe1148/a.ts
把 b.ts 改成 export const b: number = "not a number" 再跑 tsc -p：
退出码 1，../../Temp/exclprobe1148/b.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
```

`--showConfig` 里没有它，程序里有它、而且真的会被类型检查——这正是「声明」与「看没看过」必须分开的实测依据。

2）**`composite` + `references` 能不能表达「域之间只许单向依赖」**：临时项目 a、b 各一份 `composite: true` 的配置，b 的配置 `references: [{ "path": "../a" }]`，b/x.ts 向下引用 a/y.ts，a/z.ts 向上引用 b/x.ts：

```
$ tsc -p a/tsconfig.json      # 退出码 2
../../Temp/refprobe1148/a/z.ts(1,19): error TS6059: File 'D:/Temp/refprobe1148/b/x.ts' is not under 'rootDir' 'D:/Temp/refprobe1148/a'. 'rootDir' is expected to contain all source files.
../../Temp/refprobe1148/a/z.ts(1,19): error TS6307: File 'D:/Temp/refprobe1148/b/x.ts' is not listed within the file list of project 'D:/Temp/refprobe1148/a/tsconfig.json'. Projects must list all files or use an 'include' pattern.
$ tsc -b b/tsconfig.json      # 同样两条（a 作为被引用项目也要构建）
删掉 a 的向上引用之后，$ tsc -b b/tsconfig.json 退出码 0
```

读法：**开了 `composite` 就有编译器级的「文件归属」约束**——不在本项目文件清单里的文件进不来（TS6307），不在 `rootDir` 下的文件进不来（TS6059）。这比今天这套手工对账强。但它管的是「你没登记」，**不管「两个项目都登记了同一份文件」**：本仓 #1020 那次调研实测过，两个 `composite` 项目同时包含同一个文件时「什么都不报」（`research/1020-类型检查与层级边界判据查证.md:363-409`），官方只有一句对后果的描述（见 4.1），给的解法是约定不是开关。另外本仓今天九份配置**没有一份开 `composite`**（同文件 `:30`），而 tracker 配置是 `noEmit: true` + esbuild 转译，换成工程引用是一次形态改动，不是收这 20 条的顺手活。

## ④ 一手来源逐条

### 4.1 TypeScript 官方文档（具体 URL）

- `files`：<https://www.typescriptlang.org/tsconfig/#files> 原文「Specifies an allowlist of files to include in the program. An error occurs if any of the files can't be found.」「Include a list of files. This does not support glob patterns, as opposed to `include`.」
- `include`：<https://www.typescriptlang.org/tsconfig/#include> 原文「Specifies an array of filenames or patterns to include in the program. **These filenames are resolved relative to the directory containing the `tsconfig.json` file.**」「If the last path segment in a pattern does not contain a file extension or wildcard character, then it is treated as a directory, and files with supported extensions inside that directory are included …」
- `exclude`：<https://www.typescriptlang.org/tsconfig/#exclude> 原文（三段全引，这段是「exclude 不是把文件从编译里拿掉」的**官方依据**）：
  > Specifies an array of filenames or patterns that should be skipped when resolving `include`.
  > **Important**: `exclude` _only_ changes which files are included as a result of the `include` setting. A file specified by `exclude` can still become part of your codebase due to an `import` statement in your code, a `types` inclusion, a `/// <reference` directive, or being specified in the `files` list.
  > It is not a mechanism that **prevents** a file from being included in the codebase - it simply changes what the `include` setting finds.
  （文档正文的 Markdown 源，本次实际抓取并逐字核对：<https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/tsconfig-reference/copy/en/options/exclude.md>，HTTP 200；`include`／`files` 同目录下的 `include.md`／`files.md` 亦为 HTTP 200。）
- 工程引用与 `composite`：<https://www.typescriptlang.org/docs/handbook/project-references.html>。本仓 #1020 那次调研已逐字引过其中两段，这里转引它的行号（`research/1020-类型检查与层级边界判据查证.md:419-432`）：官方建议「solution 文件只有 `references`、`files` 设成空数组」（原句 “otherwise the solution file will cause double compilation of files”），以及 `composite` 带来的两条约束（`rootDir` 默认锁在配置所在目录、所有实现文件必须被登记）——这两条正是 TS6059 与 TS6307 的来源。该调研同时明确记下：**「一个文件只能属于一个项目」在官方文档里没有成文规则**（同文件 `:1059`）。

### 4.2 仓内 `node_modules/typescript`（版本 7.0.2）

- `node_modules/typescript/package.json`：`"version": "7.0.2"`，`"bin": { "tsc": "./bin/tsc" }`。
- `node_modules/typescript/bin/tsc`（44 字节）内容是 `#!/usr/bin/env node` + `import "../lib/tsc.js"`；`node_modules/typescript/lib/tsc.js`（609 字节）用 `getExePath()` 找出原生可执行文件后 `execFileSync(exe, process.argv.slice(2), { stdio: "inherit" })`。**这版 TypeScript 是原生实现（TS 7 线），没有可读的 JS 编译器源码**，所以本文件里凡涉及实现细节的结论一律以实测为准（与 `research/1020-…:1062` 记的边界一致）。
- 编译器自己的说明文字（`node node_modules/typescript/bin/tsc --help --all`，逐字）：
  - `--showConfig` —— `Print the final configuration instead of building.`
  - `--listFilesOnly` —— `Print names of files that are part of the compilation and then stop processing.`
  - `--listFiles` —— `Print all of the files read during the compilation.`
  - `--composite` —— `Enable constraints that allow a TypeScript project to be used with project references.`
  - `--excludeFiles` —— `Remove a list of files from the watch mode's processing.`（与配置里的 `exclude` 不是一回事，别混）
  这四句就是「`--showConfig` 打印的是**最终配置**（含 `files` 这份算完 include/exclude 的清单）」「`--listFilesOnly` 打印的是**属于这次编译的文件**（程序闭包）」的官方出处（编译器自带文档），3.6 的微实验是它们的实测对照。

### 4.3 仓内关键落点（file:line）

- `scripts/typecheck.mts`
  - `:147-151` `findConfigs()`：判据是「磁盘上有这份配置」（`git ls-files ':(glob)**/tsconfig*.json'`），所以临时探针必须删干净。
  - `:207-293` `measureConfig()`：`:215` 跑 `--listFilesOnly` 得闭包（`files`），`:255-258` 跑 `claimFiles()` 得声明（`claimed`），`:267` 再跑一次真编译收诊断。
  - `:305-331` `claimFiles()`：`--showConfig` 的 `files` 字段，按**配置文件所在目录**解析、丢到仓库外或磁盘上不存在的项。
  - `:437-452` B（缺口，用闭包）；`:454-467` C（重复归属，用声明）；`:469-485` D（越界，用声明；`:472-476` 根上的配置跳过）；`:487-496` E（类型错误）；`:498-513` F（手写 JS 棘轮，唯一用基线的判据）。
  - `:51` `BASELINE_PATH`（`tests/handwritten-js-baseline.json`）、`:378-388` `compareBaseline()`。
- `tests/verify-contract-types.js`：`:81` 配置路径（缺省 `tsconfig.contract.json`，`DSH_CONTRACT_TSCONFIG` 可覆盖）；`:112-116` 探针直编开关；`:166-176` 22 个操作名 + 3 条定位口；`:341-356` 缺件即红；`:375-381` 第 1 项 `tsc` 零错误；`:385-414` 第 2 项契约目录 .ts 全进编译；`:448-487` 第 5 项探针与 183 条基线。
- `tests/verify-typecheck.mts`：`:81/:96/:109/:119/:129` 五条钉住 B/C/D 口径的假事实。
- `tests/verify-dependency-rules.ts:19/:53/:216`：「存量豁免、只许减不许增」的既有先例（`tests/same-layer-baseline.json`）。
- `scripts/build.mjs:82`：`INPUT_EXTRA` 里含 `tsconfig.contract.json`（合并/改名会动到构建指纹）。
- `src/tracker/tsconfig.json`（**未提交**，`git status` 显示 `??`）：`:39` `include: ["**/*.ts"]`；`:8-14` 自己写着「重复归属的最终解法（合配置或改对账口径）是架构级选题，另立一票定，不在本票（#1147）范围内」。
- `src/deck/tsconfig.json:18-21`：`#1148` 那条口径的现场注释——「归属对账只认 include 声明……拿它当越界去报，是任何配置都改不绿的一条假红」。
- `tsconfig.contract.json:33-48`：契约侧的 20 份声明（契约目录通配 + 6 份点名文件，每份都写了「暂住」的理由与将来收口的票号）。

### 4.4 提交与票的既定口径（`git log`）

- **#1020（这道门的出生票，已关闭）**
  - `aa85ecdd`「类型检查入口与手写 JS 棘轮基线落地，六份配置打开混编开关」：新增 `scripts/typecheck.mts`，「拿两个集合对账——仓库里有哪些源码（判据走 git，外部事实）与各份配置看见了哪些源码（判据走编译器）」，「同时断言同一个源文件不落在两份配置里（TypeScript 不会为这种重复报错，只能自己断言）」；新增 `tests/handwritten-js-baseline.json`（716 条），棘轮只许减不许增。**风向：这门禁的两条判据从一开始就是「集合对账」，重复归属是自定不变量。**
  - `cbbb1ae4`「票 1020 查证记录」→ `research/1020-类型检查与层级边界判据查证.md`（76 KB）：逐条记下每条断言的依据与「未找到一手依据」的部分。本次调查的 4.1／4.2／3.6 与它的结论一致。
- **#1107（src/deck 配置放宽，已关闭）**：落点是 `5490e4a3`「把 src/deck 的类型配置从只圈 rules 放宽到整片域……」（`src/deck/tsconfig.json:8-9` 明写「#1107 把它放宽到整片域」）。正文两条与今天直接相关：一是放宽后 28 份源码首次进检查、deck 缺口清零；二是「随之暴露出来的是远离本域的一件事……类型检查顺着 import 走进了 src/tracker，那 4 份……有 117 条错误」——**风向：允许一份域配置顺 import 看到别的域（那是真依赖），代价由被看到的那一方自己还。**
- **#1147（src/tracker 配置，在办）**：`474602bd`「决策 11 按 A 落地」；`src/tracker/tsconfig.json` 本身尚未提交（`??`）。这份配置的注释明写：重复归属的最终解法（合配置或改对账口径）是架构级选题，另立一票定，不在 #1147 范围内。**风向：本票只负责「让 tracker 有人检查」，重叠问题明确外推。**
- **#1148（改口径的那笔）**：`da3c0fc6`「覆盖对账分开『顺 import 看到』与『include 声明』：归属判据改看声明，deck 那条的越界与重复归属清零」——正文记着实跑结果「越界 17 条 → 0 条，重复归属 31 条 → 20 条（剩下的是 src/tracker 与契约两份配置之间的重叠，属并发会话 #1147 的配置范围），不通过 64 条 → 35 条」，并说明 `tests/verify-typecheck.mts` 加了 5 条假事实自查把口径钉住。另两支：`a743c0eb`（声明清单过滤后一个不剩时退回闭包，防静默漏判）、`d7ca179a`（把 deck 顺带看到的那 4 份 tracker 文件真转成 TS，117 条清零）。

### 4.5 本仓既定的架构口径

- `docs/adr/20261011-deck-ts-rewrite.md` **§5「绿色编译模型（纯 TypeScript 项目的样子）」**原文（`:93-99`）：
  > 1. 源码只有 `.ts`，产物全部进 `.gitignore`，`prepare` 脚本负责构建，发包形状不变，只是源头干净了。
  > 2. 按域拆 TypeScript 工程引用：`deck` 引用 `tracker`，`tracker` 引用内核，引用只能朝下，写反编译不过。方向由编译器保证，不用人肉门禁。
  > 3. 单测直接跑 `.ts`，不再有「改了真源忘生成产物」这种事，因为没有入库的产物可忘。
  > 4. 今天约三十个按路径文本断言的旧门禁，换成标准依赖检查工具（禁循环、禁跨层深引用、单文件行数上限），保证不变，工具换成社区的。
  > 5. 两条物理事实保留：Node 运行不了 `.ts`，宿主加载的是构建产物。除此之外，旧构建形态一律不继承。

  这就是「ADR 第 5 节『按域拆工程引用』」那一节：**目标形态是每域一份工程、引用单向朝下**，而今天这九份配置里没有一份开 `composite`——眼下的手工对账是过渡形态（第 2 条那句「不用人肉门禁」还没兑现）。
- `CONTEXT.md:145-149`「deck 重构词条」：定义「改写单元」（一个 issue 负责的一段源码，通常是一棵新树里的一个目录或一个房间）与「随重构收口」。按这套词，「一个域一份配置」是重构的既定形状。
- `docs/agents/domain.md:41`：本仓是 **single-context**（根 `CONTEXT.md` + `docs/adr/`）；`:49-53` 要求「输出与既有 ADR 冲突要显式说出来，不许悄悄覆盖」。本文件若被用来改归属判据，必须显式引用 ADR §5 第 2 条。
- `src/deck/tsconfig.json:46`、`src/tracker/tsconfig.json:38`：两份域配置都把「一个文件只属于一个域目录」写给读者看（后者注明出自 #1098 第 5 条）。

### 4.6 「二分法」站不站得住（问题四最后一句）

**站得住，不用退回去，但要说清它不是 TypeScript 的规则，而是本仓自定的约定。**

- 缺口（B）看程序闭包：依据是官方对 `exclude` 的说明（被 exclude 的文件仍可因 import 成为程序的一部分）与 `--listFilesOnly` 的定义（打印机密「属于这次编译的文件」），再加上 3.6 的实测（被 exclude、被 import 的文件照样被类型检查）。**「顺 import 看过就算有人检查」是对事实的准确描述，不是近似。**
- 归属（C/D）看 `--showConfig` 的声明清单：`--showConfig` 打印的是「最终配置」，那份 `files` 就是 include 展开、exclude 过滤之后的**根文件清单**；一份配置声明了谁，谁就是它的根输入，也一定在它的程序里。所以 C 断言的准确含义是「同一份文件不许被两份配置同时当成根输入」——**这正是官方唯一提到过的那个后果**（solution 文件的 double compilation），而 TypeScript 自己不会为此报错（两个 composite 项目都圈同一文件时零诊断，`research/1020-…:363-409`）。也就是说：C/D 是往 TypeScript 的空白处补的一条本仓约定，代码注释（`scripts/typecheck.mts:12-16`、`:241-254`）已经把这件事说清楚了。
- 两处要当心的措辞（都已做到，继续别退）：报数必须把「声明 N 个」与「顺 import 看到 M 个」分开印（`scripts/typecheck.mts:543-546`）；读不到声明时退回闭包并留痕（`:256-258`、`:185` 的 `claimedFrom`），否则「声明得少、全靠蹭检查」与「压根没读到声明」在输出里长得一样。
- 唯一真正的风险是话术：如果对外说成「TypeScript 规定一个文件只能属于一个项目」，下次有人查官方文档会找不到依据（#1020 的调研已经明说「官方没有这条成文规则」）。正确的说法是：「这是本仓按 ADR §5 第 2 条定的约定，工具负责把它变成可判定的」。

## ⑤ 未解问题（本文件没证实的部分）

1. **「exclude 会替换默认排除项」这条没直接实测到位**：微实验里 `exclude: ["b.ts"]` 不含 `node_modules` 时，`node_modules/pkg/i.ts` 也没进 `--showConfig` 的 `files`（说明这份编译器的通配展开本来就不进 `node_modules`）。但 `bower_components`／`jspm_packages` 与「显式列 `node_modules/**` 会不会又把默认项弄丢」没测；推荐的第 4 条路里写默认项只是稳妥写法，不是有依据的必需项。
2. **合配置后契约门禁该长什么样，没做设计**：只证实了「今天合配置 → 第 1 项红（223 条）」。要合，得先决定合并后的配置叫什么、契约门禁的缺省路径怎么改、`build.mjs` 的指纹输入怎么改，以及「契约层自洽」这条窄信号由谁接。
3. **走「改对账口径」时的豁免边界没有定论**：能想到的最窄写法是「C 只在两份配置的 `dir` 都非空时成立」，但它会连带豁免 `tsconfig.client.json`（事实上就是 client 域的配置，只是住在根上），范围是否可接受要维护者拍板。
4. **错误条数会继续漂移**：223／249 两个数都是当天快照，且都随 #1147 的改动变化；本文件没有把它们当结论用。要一个稳定数，得等 `src/tracker` 那批改写落定后重跑。
5. **契约门禁今天本来就是红的**（探针后端内部报错 187 条 vs 基线 183 条），与本题无关但会干扰所有「跑一遍看看」的判断：任何拿这条门禁当对照的实验，都要先跑一次不带环境变量的对照（本次已这么做，见 3.3）。
