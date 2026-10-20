# #1312 产物新鲜度门禁盘点：哪些地方还在比修改时间，能不能改用构建缓存里的内容摘要

- 调查对象：GitHub 票 #1312（地图 #1310「本地 link 开发闭环的构建抖动与面板闪烁」的研究子票），结果喂给实施票 #1326。
- 代码基线：分支 main，HEAD = `ecadaab3`（#1325「构建缓存命中时不再改动产物文件」），工作区里只有本笔记这一条新增未跟踪文件。
- 范围：以只读源码与本机缓存文件为主；为核对缓存行为另跑过一次 `node scripts/build.mts`（命中缓存、没有写盘，见 2.6），没有跑验证链、没有改任何源码。

**开头先交代一件旧笔记没交代的事**：`research/662-consumers-map.md`、`research/613-builtin-ts.md`、`research/1020-类型检查与层级边界判据查证.md` 都没有回答本票的问题——前两份只写到 `tests/verify-kernel.ts` 的源码集合如何机械展开成产物新鲜度基准，第三份讲的是 `tsc -b` 那条别的工具链，三份都没给完整清单、没评估构建缓存里的摘要能不能替代、也没给缓存缺失时的回落方案；而实施票 #1325（提交 `ecadaab3`）已经把「缓存命中时顺手把产物修改时间提到现在」这个前提改掉了，旧笔记里依赖这个前提的判断必须按今天的代码重看。本笔记补齐这三块。

## 0. 三句话结论

1. **今天有 10 处用「源码修改时间 vs 产物修改时间」判断产物是否过期**：`tests/` 下 8 扇门禁（`verify-ctx`、`verify-kernel`、`verify-leaves`、`verify-parse-leaf`、`verify-platform-contract`、`verify-tabsfold-leaf`、`verify-log-client`、`verify-log-artifacts`），加上 `scripts/matrix-full.ts` 与 `scripts/matrix-smoke.ts` 两个矩阵脚本。10 处全是逐文件比修改时间，没有一处逐字节比对。
2. **构建缓存里的产物摘要可以替代它，但必须和「输入指纹」一起用**：只用产物摘要会在「改了源码、还没构建」时假绿；只用输入指纹又回答不了「产物有没有被人手改」。两条都满足，才等价于今天这句判据想表达的意思——「产物就是当前源码构建出来的那一份」。
3. **替代的代价与前提**：每扇门禁多一次约 110 毫秒的输入扫描（实测 1049 个输入文件、14.4 MB）；缓存缺失、损坏、版本升级、只有局部构建记录时必须能退回旧判据，且退回时要说明原因，不能悄悄判绿。

## 1. 门禁清单

### 1.1 统一形状

8 扇门禁里有 6 扇用的是同一个函数，逐字相同或只差类型标注（另外两扇的写法见 1.2 第（7）（8）条）：

```text
产物不在盘上        → '缺失（请先运行 node scripts/build.mts）'
src.mtimeMs > 产物.mtimeMs + 1000 → '过期（<源> 比产物新，请重新运行 node scripts/build.mts）'
```

断言统一写成 `产物门禁 <产物>：<原因>`（`tests/verify-ctx.ts:33` 等）。判据形式一律是**逐文件修改时间循环**：拿每一份源码的 `mtimeMs` 和产物的 `mtimeMs` 比，源只要比产物新超过 1 秒就判过期；没有任何一扇去读产物字节、算摘要或比对内容。

### 1.2 逐扇明细

**（1）`tests/verify-ctx.ts`（Ctx 接线）**
- 判据函数 `:18-27`，断言 `:30-34`。
- 源码集合 `:16`：`src/client/kernel/ctx.ts`、`src/client/index.ts`、`scripts/build.mts`、`package/package.json`。
- 盯的产物 `:15`：`client.js`、`package/lib/client.js`。
- 报错原文：`缺失（请先运行 node scripts/build.mts）`、`过期（<源> 比产物新，请重新运行 node scripts/build.mts）`。

**（2）`tests/verify-kernel.ts`（内核模块拼接）**
- 判据函数 `:93-102`，断言 `:105-108`。
- 源码集合 `:83-91`：`src/client/index.ts`、`scripts/build.mts`、`package/package.json`，加上 `.build/shared/label-color/colors.js`、`.build/shared/label-color/prompt.js`，再加上每个内核模块按 `kernelFileOf()`（`:77-82`：同名 `.ts` 优先，否则 `.js`）展开出的路径。
- 盯的产物：`client.js` 与 `package/lib/client.js`。
- **特例**：它的源码集合里有两项本身就是**构建产物**（`.build/shared/label-color/*.js`，它们是拼接的输入）。这扇门禁比的是「产物比产物新」，用内容摘要判断反而更自然（缓存对这两份文件也有记录，见 2.6）。

**（3）`tests/verify-leaves.ts`（叶子模块）**
- 判据函数 `:126-135`，断言 `:138-141`。
- 源码集合 `:118-124`：`src/client/index.ts`、`scripts/build.mts`、`package/package.json`，加 `LEAVES` 每一项的 `.js` 路径与同名 `.ts` 路径（两种都收）。
- 盯的产物：`client.js`、`package/lib/client.js`。

**（4）`tests/verify-parse-leaf.ts`（解析叶子）**
- 判据函数 `:39-48`，断言 `:77-80`。
- 源码集合 `:29-37`：`src/host/index.js` 的 `sourcePath`、`mapBody`、`ticketGrouping`、`issueList`、`issueDetail`、`scripts/build.mts`、`package/package.json`。
- 盯的产物 `:20`：`host.js`、`package/lib/index.js`。

**（5）`tests/verify-platform-contract.ts`（平台契约）**
- 判据函数 `:42-49`，断言 `:64-67`，`:68` 一失败就 `process.exit(1)` 中止后续断言。
- 源码集合 `:34-41`：`src/host/platform/{win32,index,darwin,linux}/index.ts`、`scripts/build.mts`、`package/package.json`。
- 盯的产物 `:33`：`client.js`、`host.js`、`package/lib/client.js`、`package/lib/index.js`。
- 报错文案与上面同款，只是断言前缀是 `产物新鲜度 <产物>`（`:66`）。

**（6）`tests/verify-tabsfold-leaf.ts`（Tab 折叠叶子）**
- 判据函数 `:24-33`，断言 `:50-53`。
- 源码集合 `:22`：`src/client/index.ts`、`src/client/kernel/ctx.ts`、`scripts/build.mts`、`package/package.json`。
- 盯的产物 `:20`：`client.js`、`package/lib/client.js`。
- 文件头 `:7` 自述「产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；防止陈旧产物假绿）」。

**（7）`tests/verify-log-client.ts`（客户端日志埋点）**
- 不是独立函数，是内联循环 `:218-223`。
- 源码集合 `:220`：`src/client/kernel/log.ts`、`src/client/kernel/probe-snapshot.ts`、`src/client/panelAssembly.ts`、`src/client/index.ts`、`scripts/build.mts`。
- 盯的产物：只有开发产物 `client.js`（不看 `package/lib/client.js`）。
- 判据 `:221`：`statSync(源).mtimeMs > statSync(client.js).mtimeMs + 1000` 就塞进 `stale`；断言 `:223` 原文是「产物新鲜（已同步/过期：…，请重跑 node scripts/build.mts）」。

**（8）`tests/verify-log-artifacts.ts`（日志双产物）**
- 判据 `:96`，方向与其它几扇相反：`statSync(镜像).mtimeMs + 1000 < statSync(真源).mtimeMs` → `problems.push(<相对路径> + ' 镜像比真源旧（请重跑 node scripts/build.mts）')`。
- 对象 `:81-98`：`src/host` 下每个含已知日志事件的真源（今天 78 份 `.ts`）与它的打包镜像 `package/lib/<同相对路径>.js`（`:91` 把 `.ts` 换成 `.js`）。
- 断言 `:100`：「打包镜像与真源事件一致且新鲜」。

**（9）`scripts/matrix-full.ts`（全矩阵脚本）**
- 判据函数 `:43-50`，断言 `:74-77`，失败即中止（`:78`）。
- 源码集合 `:35-42`、产物 `:34`：与第（5）扇门禁**一模一样**（六项源码、四项产物）。
- 报错是精简版：`缺失`、`过期：<源>`。

**（10）`scripts/matrix-smoke.ts`（最小冒烟矩阵脚本）**
- 判据函数 `:40-47`，断言位置与上面同构（`:58` 起是产物双闸）。
- 源码集合 `:32-39`、产物 `:31`：同样复制了第（5）扇的清单。
- 报错文案与门禁同款：`过期（<源> 比产物新，请重新运行 node scripts/build.mts）`。

后两处不在验证链上（`tests/verify-*` 才是链上的条目，见 `scripts/verify-stages.json` 与 `scripts/verify-chain.ts:5-7`），是人工跑矩阵时用的脚本（`scripts/matrix-full.ts:20-21` 指向 `docs/architecture/matrix.md` §3）。它们与本票相关，因为同一段判据被抄了三份：改判据时三处得一起改，这正是「共用一份实现」的理由（见 3.4）。

再补两句位置信息：链上八扇里，`verify-leaves` 落在「build」段（`scripts/verify-stages.json:7-14`），其余七扇落在默认的「behavior」段（`:29-32`）；两个矩阵脚本不在链上，但 CI 的 `.github/workflows/verify.yml:60-72` 与 `.github/workflows/matrix.yml:36-42` 都是先跑构建、再跑它们，所以它们同样会遇到「缓存命中、产物一个字节没写」的场景——#1325 之前正是它们最容易要求「把产物时间提到现在」。

### 1.3 那一秒容差从哪来

- 10 处判据里写的都是 `源.mtimeMs > 产物.mtimeMs + 1000`（8 扇 tests 门禁加 2 个矩阵脚本）。
- **代码里没有任何注释解释这个 1000**；`git log -S "pm + 1000"` 显示它由提交 `998854a8`（#94 T1 阶段 1，2026-08-21）引入，提交正文只写了「产物缺失或过期（晚于 src/build.mjs/package.json）→ FAIL」，没写为什么留一秒。在 `tests/` 与 `docs/` 里搜「容差 / 一秒 / 同一秒」也没有一条是针对它的说明（搜到的都是别的门禁的像素容差、虚拟时间之类）。
- **效果**：允许产物比源最多旧 1 秒；换句话说是「同一秒内写完的源和产物不算过期」。至于当初是不是为了躲开文件系统时间精度，仓库里没有留下证据，本笔记不替它编理由。
- 对 #1326 的意义：内容判据不需要任何时间容差——摘要要么相等要么不等。但回落路径用的是旧判据原样，回落时这一秒仍然保留。

### 1.4 名字带 freshness 的门禁已经不存在（与任务说明不符）

任务说明里提到的 `verify-config-store-freshness`、`verify-label-color-freshness`、`verify-update-freshness`、`verify-version-control-freshness`，**今天一扇都不存在**：

- `tests/` 下 `verify-*.ts` 共 318 个，文件名含 `freshness` 的 0 个（`node -e` 统计目录得出）。
- `docs/adr/20260913-builtin-ts-shape.md:134` 明确写着这四扇以及更早的 `verify-update-freshness.js`「都不再存在」，接替它们的是一条结构性判据（ADR 原文写作 `tests/verify-build-artifacts.js`，这个文件后来转成了 `.ts`）：域目录里每份产物都要能追溯到同名源码、反过来每份源码都要有产物，两棵树的逐字节一致由构建每次自己核对。同一条还给理由：产物改由构建现场生成、不再入库，CI 与测试入口都先跑构建，「于是『改了源码忘了重建』这个状态本身不再存在」。
- 今天 `freshness` 只是验证链的**阶段名**：`scripts/verify-stages.json:34-44` 里有一个 stage 叫 `freshness`，它按文件名匹配 `freshness`、`verify-readme-sync`、`verify-star-history`、`verify-locale-completeness`、`verify-locale-config`；`tests/verify-1125-gate-coverage.ts:46` 断言四个阶段的顺序是 `build, contract, behavior, freshness`，`:64` 断言四段都非空。落进这个阶段的几扇门禁都不比修改时间（这四份文件里 grep `mtime`、`statSync`、`utimes` 命中 0 条），它们比的是内容或键集合。
- **结论**：这几扇「名字带 freshness」的门禁不属于本票范围，理由不是「它们按字节比」，而是「它们已经被删除、职责并入了 `verify-build-artifacts.ts` 的内容判据」。顺带一提，`AGENTS.md` 里「产物有没有跟上源码，是 `verify-*-freshness` 那几条门禁的职责」这句是过时措辞，今天该指向第 1 节这 8 扇。

### 1.5 `verify-587` 的 utimes 兜底：被修改时间判据逼出来的局部补丁

`tests/verify-587-update-live.ts` 是本机 link 安装下的真机测试，它会把仓库里的 `package/package.json` 版本临时改成 `9.9.9`（`:49-55`、`:77-79`），跑完在 `finally` 里写回原文（`:98`）并把修改时间用 `fs.utimesSync` 一起还原（`:100`）。

它为什么非还原时间不可，注释 `:51-54` 写得很直白：内容能还原，修改时间却会停在当前；链上有几扇门禁按「产物比源新」判过期（#1325 之前缓存命中会顺手把产物修改时间提到现在，把这些假红盖住了）。`:109-110` 还专门断言「清单还原后修改时间也回到原样」，并解释 2 毫秒余量是 Windows `utimes` 的毫秒精度。

这段兜底与本票的关系：

- `package/package.json` 正好在第（1）（2）（3）（4）（5）（6）扇门禁的源码集合里，改它一次就会让 6 扇同时判过期——这是「按时间判断」的直接副作用。
- 它同时还在构建的输入清单里（`scripts/build.mts:105` 的 `INPUT_EXTRA`），所以它一被改，缓存指纹也会变。
- **判据改成内容摘要以后，这段 `utimesSync` 与 `:109-110` 那条断言都可以删**：内容写回原样，指纹就回到原样，门禁不再看时间。删之前要先确认没有别的地方还依赖这个时间戳（`:102-104` 的注释就是为这件事留的线索）。

### 1.6 全仓 `mtime` / `utimes` / `statSync` 用法分类（哪些是判据、哪些无关）

用 `mtimeMs >`、`utimesSync`、`mtime:\s*0` 三种模式扫全仓 `*.ts`，结果分五类：

| 类别 | 位置 | 是不是本票的判据 |
| --- | --- | --- |
| 产物新鲜度判据 | 第 1.2 节那 10 处 | **是** |
| 被判据逼出来的还原 | `tests/verify-587-update-live.ts:100`（还原清单 mtime）、`:109-110`（断言还原成功） | 是，属于连带要改的地方 |
| 被判据逼出来的构建侧动作 | `scripts/build.mts:1645-1660`：真构建末尾递归 `utimesSync` 把 `package/lib`、`package/shared`、`package/deck`、`package/tracker`、`package/scripts` 下每个文件的时间提到当前，注释原文「确保产物新鲜度门禁（verify-parse-leaf 检查产物 mtime > 源 mtime），原样复制需显式 touch」 | 是，判据换掉后这一段可以一起删（见 3.6 第 11 条） |
| 被测对象本身 | `tests/verify-1325-build-cache-nowrite.ts`：逐产物记 `mtime` 与大小（`:118-126`），断言缓存命中不改产物修改时间、缓存文件自己也不被重写（`:157-170`） | 不是判据，是 #1325 的回归门禁；改判据时不要连带改它 |
| 与产物新鲜度无关 | 假文件系统的 `mtime: 0`（`tests/verify-922-ticket-file-queue.ts:71-72`、`verify-928-field-line-rewrite.ts:74-75`、`verify-970-whole-document.ts:34-35`、`verify-972-title-body.ts:33-34`、`verify-markdown-label-colors.ts:94-95`）；夹具摆顺序（`verify-691-markdown-counts-page.ts:180`）；业务排序（`tests/verify-handoff-latest-sort.ts:139` 一带，handoff 文档按 mtime 排序）；幂等性（`tests/tracker-contract/sections/idempotency.ts:168`、`:426-441`，两次写同一张工单，断言修改时间没变） | 不是 |

`scripts/` 下除第 1.2 节的 `matrix-*` 与 `build.mts` 的 touch 段，没有别的 `mtime` 比较。`tests/` 里也没有别的 `statSync(...).mtimeMs >` 形式的产物判据。

## 2. 构建缓存现状

### 2.1 位置与开关

- 缓存文件：`node_modules/.cache/dsh-build.json`（`scripts/build.mts:94`，以仓库根为基准拼接）。
- 版本：`CACHE_VERSION = 2`（`:93`）；文件里的 `version` 与它不等时整份当空（`:197-204`）。
- 跳过缓存的办法：`--force`，或环境变量 `DSH_BUILD_NO_CACHE=1`（`:217-220`）。

### 2.2 条目形状

`:246-258`：构建成功后，对 `listOutputs()` 每个产物算一次 `sha256`，写进

```text
{ version: 2,
  entries: { "<构建模式>": { fingerprint: "<64 位十六进制>",
                              outputs: { "<仓库相对路径>": "<sha256>" },
                              at: "<ISO 时间>" } } }
```

`<构建模式>` 是 `buildModeKey()` 的结果（`:192-195`）：把命令行里所有以 `--` 开头的参数排序后用空格连起来，一个都没有就是 `full`。所以 `--force` 也自成一档（实测见 2.6）。

### 2.3 输入指纹怎么算

- `inputFingerprint()`（`:185-190`）先往 sha256 里放 `v<CACHE_VERSION>|node<process.version>|mode:<构建模式>|`，再对每个输入放 `相对路径 + \0 + 文件 sha256 + \n`。
- 输入范围（`listInputs()`，`:159-171`）：`src`、`scripts`、`tests`、`config/copy` 四棵树（`:104`）逐文件走一遍，排除 `scripts/generated/`，排除派生文件，再补 `INPUT_EXTRA`（`:105`，含 `package.json`、`package/package.json`、`README.md`、两份 tsconfig、四份 YAML、五份提示词 YAML、`scripts/lib/prompt-config.mts`、`scripts/lib/copy-config.mts`）。
- 派生文件判定 `looksDerived()`（`:119-126`）：读文件前 300 个字符，出现 `AUTO-GENERATED`、`人手不改`、`DO NOT EDIT` 任一个就算派生、不算输入（否则构建一跑指纹就变，永远命中不了）。
- 为什么收 `tests`：`:97-102` 写的是测试树里住着构建要读的样本（`tests/fixtures/version-control/`），代价是改任何测试文件都会触发全量重建，「这是正确行为」。

### 2.4 产物清单怎么算

`listOutputs()`（`:174-183`）收三部分：

- 固定文件 `:106`：`client.js`、`host.js`、`package/README.md`；
- 整目录 `:116`：`.build`、`package/lib`、`package/deck`、`package/tracker`、`scripts/generated`、`package/scripts`、`package/bundled-skills`；
- `src` 树里 `looksDerived()` 为真的派生文件（今天 3 份，见 2.6）。

`:107-110` 解释了为什么 `package/lib` 要整目录收：`verify-log-artifacts` 比的是「`package/lib` 里的镜像 vs `src` 里的真源」，两边必须一起提时间。换句话说，**缓存收产物清单的动机，本来就是为了伺候那几扇按时间判的门禁**。

### 2.5 命中判定

`tryBuildCacheHit()`（`:216-243`）在一切写盘之前调用（`:1753`），顺序是：

1. 有 `--force` 或 `DSH_BUILD_NO_CACHE=1` → 不用缓存；
2. 取 `entries[buildModeKey()]`，没有这个模式、或条目缺 `fingerprint`/`outputs` → 不走缓存；
3. 指纹不等 → 打印「`[build] 手写输入有变化 → 正常构建。`」；
4. 逐个比对 `entry.outputs` 里记的路径：文件不在、或 sha256 不等，收进 `bad`（超过 5 个就停），打印「`[build] 产物与上次成功构建不一致 → 正常构建（…）。`」；
5. 全对 → 打印命中信息（`:239`），**一个文件都不写**（`:237-242`，这是 #1325 的改动），`process.exit(0)`。

### 2.6 本机实际缓存文件核对

读 `node_modules/.cache/dsh-build.json`（146,023 字节，文件本身的时间是 2026-10-21 02:21）：

- `version = 2`；`entries` 三个：`full`、`--pkg-only`、`--force`，`at` 分别是 2026-10-20T18:21:06Z、18:20:49Z、18:12:26Z。`--force` 独立成档，验证了 `:192-195` 的行为。
- 每档 `outputs` 都是 445 条；三档的清单完全相同——说明条目记的是「这一趟结束时 `listOutputs()` 看到的树」，不是「这一趟真的写了哪些文件」。
- 445 条的分布：`package/tracker` 125、`package/bundled-skills` 109、`package/lib` 79、`.build/shared` 63、`package/deck` 45、`scripts/generated` 3、`package/scripts` 2、`src/client` 2、`src/shared` 1、`package/README.md` 1、`client.js` 1、`host.js` 1，另有 `.build/` 下 14 个临时工作文件（`tmp-index`、`post-commit-chain.log`、`commit-msg.txt`、`verify-parallel-20261020-181646.log` 之类）。
- `src` 树里被当作产物的 3 份派生文件：`src/client/kernel/locale-data.ts`、`src/client/kernel/prompt-data.ts`、`src/shared/time-config/src/values.ts`。
- 本票关心的产物都在：`client.js`、`host.js`、`package/lib/client.js`、`package/lib/index.js`、`.build/shared/label-color/colors.js`、`.build/shared/label-color/prompt.js`；`src/host` 下 78 份 `.ts` 对应的 78 个 `package/lib/<同相对路径>.js` 镜像，**一个不少**全在清单里（`node -e` 逐个核对过）。
- 复核：按同一份缓存再跑一次 `node scripts/build.mts`，退出码 0、只打印缓存命中一行，四份产物大小与文件时间都没变——#1325 的「命中不写盘」在真环境里成立，这是本票所有判据改动的前提。

### 2.7 它记录了什么、没记录什么

**记了**：一份「手写输入合起来」的指纹；445 个产物各自的 sha256；这份记录属于哪个构建模式；什么时候写的；缓存格式版本。指纹里还混进了 node 版本与缓存格式版本。

**没记**：

- 哪一份源码编出哪一个产物（没有依赖关系，也不可能有：构建是整棵树的转译 + 拼接）；
- 每份输入文件各自的摘要（所以判据只能回答「输入整体变没变」，说不出「是谁变了」）；
- 产物的大小、修改时间（大小能从盘上现读，时间没记）；
- 「这一趟真实写了哪些文件」（记的是这一趟结束时的产物全集）；
- 构建环境里除 node 版本以外的东西（操作系统、esbuild 版本、环境变量都没进指纹）。

## 3. 用缓存里的产物摘要替代修改时间判据

### 3.1 两条判据各自在说什么

- 修改时间判据表达的是：**「产物比这几份源码新，说明构建跑过、而且跑在这些源码之后」**。它是一句间接的推断，靠时间先后代替「内容一致」这个真正的意思。
- 内容摘要在缓存里能表达的是两句合起来：**「产物的字节与某一次成功构建记下的一模一样」** 且 **「那次成功构建的输入指纹与当前输入指纹相同」**。两句都成立，就等于说「当前源码构建出来的就是盘上这份产物」。

后者是直接证据，比时间先后强；但它的成立依赖三个前提：缓存文件可读、条目属于当前构建模式、构建本身是确定性的（同样的输入产出同样的字节）。前两条要写进判据，第三条仓库里已有别的证据支撑：`tests/verify-1325-build-cache-nowrite.ts` 断言两次构建的产物清单一致，`docs/adr/20260913-builtin-ts-shape.md` 那条也建立在「构建现场生成、可重现」上。

### 3.2 哪些场景等价、哪些不等价

| 场景 | 修改时间判据 | 内容摘要判据 | 谁对 |
| --- | --- | --- | --- |
| 改了源码 → 跑构建 | 绿（产物被重写并 touch） | 绿（指纹与摘要都更新） | 一致 |
| 改了源码 → 没构建 | 红（源比产物新） | 红（指纹不等） | 一致 |
| 只 touch / 编辑器保存但内容没变 / `git` 重写同一份内容 | **红（假红）** | 绿 | 内容对 |
| 产物被人手改，改完时间变新 | **绿（假绿）** | 红（摘要不等） | 内容对 |
| 产物被手改，还把时间回拨到源码之前 | 红 | 红 | 一致 |
| 构建模式不同（`--dev-only` / `--pkg-only`） | 不受影响 | 取决于查哪一档记录（见 3.6 第 1 条） | 要设计 |
| node 版本变了 | 不受影响（多半假绿） | 红（指纹里含 node 版本） | 内容对 |
| 跨机器 / 新克隆 / `node_modules` 被清 | 照常工作 | 缓存不存在 → 必须回落 | 要回落 |
| 缓存文件被删 | 照常工作 | 同上 | 要回落 |
| 缓存文件被手改（伪造摘要） | 不受影响 | 会假绿 | 两者都可伪造，不是新增风险 |
| 产物清单变了（新增产物目录） | 不受影响（门禁各自列产物） | 门禁点名的产物不在记录里 → 要能识别 | 要回落/报错 |

一句话：两者在「正常改代码 → 构建 → 跑门禁」这条主路上等价；在「时间变了内容没变」（今天会假红）和「内容被手改」（今天会假绿）这两个方向上，内容摘要严格更好；代价是把「缓存可用」变成了判据的前提。

### 3.3 落到每扇门禁：是不是都只需要一个全仓级答案

**是。** 10 处门禁盯的产物，都只问「这个文件是不是当前源码构建出来的」，没有一处需要知道「哪一份源码编出哪一个产物」。所以新判据可以是一个全仓级函数：`judgeProducts([...产物]) → 新鲜 / 过期 / 无法判断（附原因）`。每扇门禁只需要把**自己那份产物清单**传进去，源码清单只留给回落时用。

逐扇核对「源码是否都在构建输入范围内、产物是否都在产物清单里」：

| 门禁 | 源码是否都在输入范围 | 产物是否都在输出清单 |
| --- | --- | --- |
| `verify-ctx` | 是（`src`、`scripts`、`package/package.json` 都在） | 是（2/2，实测在缓存里） |
| `verify-kernel` | 是；其中两分 `.build/shared/label-color/*.js` 是**产物**，也在输出清单里 | 是 |
| `verify-leaves` | 是（叶子源码在 `src`，两种后缀都在 `src` 下） | 是 |
| `verify-parse-leaf` | 是 | 是 |
| `verify-platform-contract` | 是 | 是（4/4） |
| `verify-tabsfold-leaf` | 是 | 是 |
| `verify-log-client` | 是 | 是（`client.js`） |
| `verify-log-artifacts` | 是（`src/host` 全在 `src`） | 是（78 个镜像全部在记录里） |
| `matrix-full` / `matrix-smoke` | 是 | 是 |

**要注意的一处副作用**：构建的输入范围包含整棵 `tests` 树（`scripts/build.mts:97-104`），而全局输入指纹说不出「是门禁自己的源码变了」还是「只是无关文件（例如某个测试）变了」。所以指纹不等时有两条路：

- **回落旧判据（推荐）**：指纹不等就按修改时间判，行为与今天一致；只在文案里多打一行「这次是回落判断，原因是……」。改无关测试的人不会因此多花 30 秒，代价是那一次的内容保护暂时失效（源码真变旧了，仍然由修改时间判据抓）。
- **判红**：任何输入变了就红、要求先构建。判据最严，但改一个无关测试也会让 10 处门禁同时红，比今天更吵，与「宁可与今天等价」的目标冲突。

想把这条也分清，就得让构建在缓存里记「逐文件输入摘要」（见 3.7 末尾的第三条路），让门禁只比自己的窄源码集。

### 3.4 共用一份实现放在哪

**建议：新建 `scripts/lib/build-cache.mts`，把 `scripts/build.mts` 里那套缓存事实搬过去，构建反过来 import 它。**

理由：

1. **事实只有一个生产者**。输入范围、派生文件判定、产物清单、指纹算法都只在构建里定义（`scripts/build.mts:104-190`）。门禁要用这些事实，只有「构建产出、门禁读取」和「门禁自己抄一份」两条路。抄一份一定会漂移——今天 `matrix-full` / `matrix-smoke` 已经各抄了一份源码清单，就是活例子。
2. **方向对**。`build.mts` 已经在从 `scripts/lib/` 里 import（`:55-56` 的 `transpile-domains.mts`、`transpile-unit.mts`），说明「构建依赖 lib」是本仓既有形状；反过来让 lib 依赖构建不行，因为 `build.mts` 是一路写到底的顶层脚本，没有 `main()` 守卫，一旦被 import 就会真跑一遍构建（`tests/verify-build-artifacts.ts:118` 的注释把这一点写明了：「构建脚本一被引用就跑整趟构建（它不是纯模块）」）。
3. **门禁侧加载它没有障碍**。门禁是 `.ts`、由 `scripts/ts-hook.mts` 直接加载，用 `require('../scripts/lib/xxx.mts')` 拿 ESM 模块已有先例：`tests/verify-1207-splice-ts.ts:40-41`（`transpile-unit.mts`、`transpile-domains.mts`）、`tests/lib/source-text.ts:57-58`、`tests/verify-1206-glossary-naming.ts:128`、`tests/verify-file-granularity.ts:25`。`tests/lib/gate-result.ts:29-30` 还把这条约定写成了话：「它同时被 .js 门禁（require）与 .mts 执行器（import）加载，所以里面只写 ESM 语法」。
4. **归属表会自己跟上**。`scripts/gate-map.mts:19-25` 推导「每扇门禁守着哪些源码」时会看 `require(...)` 的说明符；门禁 require 了这个模块，归属表就会把它记成这些门禁守着的文件，之后改这个模块，`npm run verify:changed` 会把相关门禁挑出来。代价是**改完必须重跑 `node scripts/gate-map.mts` 重新生成 `tests/gate-map.json`**，否则 `tests/verify-gate-map.ts:70`（「归属表是最新的」逐字节比）会判红。

模块里应该有什么（都是纯函数，加载时不许有副作用）：

- 读缓存并给出「为什么读不到」：文件不存在 / JSON 解析失败 / `version` 不符 / 没有对应模式的条目 / 条目缺字段；
- 计算当前输入指纹（含 `listInputs`、`looksDerived`、`walkTree`）；
- 判一扇门禁的产物：逐个 `existsSync` + `sha256File` 与记录比；
- 回落用的旧判据（逐文件比修改时间）。

门禁侧只多两行：把产物清单传进去、把返回的原因拼进断言文案。**源码清单不要搬进模块**——每条门禁自己列着，既是回落时要用的输入，也是归属表认路径的依据（`scripts/gate-map.mts:565` 起优先看文件头的 `// 门禁归属:` 注释，其次才看代码里的路径字面量）。搬走了会让这些门禁变成「推不出守着谁」。

备选方案与代价：

- **给 `build.mts` 加一个 `--check-products` 子命令，门禁 spawn 它**：不用搬代码，但每扇门禁多一次进程启动（几百毫秒），而且把「构建脚本」变成了门禁的运行时依赖，出错时的错误边界更模糊。
- **在 `tests/lib/` 里抄一份**：改动最小，但两套算法迟早分叉；一旦分叉，「构建判命中、门禁判过期」会变成最难查的一类假红。

### 3.5 报错文案要能分开四种情况

现在的文案只有两种（缺失、过期），改完要能分清「真的过期」与「缓存读不到」：

| 情况 | 判据看到什么 | 建议文案（要点） | 让用户跑什么 |
| --- | --- | --- | --- |
| 产物缺失 | 文件不在盘上 | 保持原样：`缺失（请先运行 node scripts/build.mts）` | `node scripts/build.mts` |
| 产物内容不一致（真过期，或产物被手改） | 摘要与记录不等 | `产物与上次成功构建不一致：<产物>（可能被人手改过，或构建没跑完）。请运行 node scripts/build.mts。` | `node scripts/build.mts` |
| 输入变了（源码、测试或配置改过，还没构建） | 指纹不等 | 先说事实：「构建输入在上次成功构建之后有变化（缓存里没有逐文件摘要，无法指出是哪一份）。这次退回按修改时间判断。」若修改时间也判旧，再补一句「请运行 node scripts/build.mts」。 | 视修改时间判据的结果而定 |
| 缓存不可读（缺失/解析失败/版本不符/没有这一档） | 读不到记录 | `构建缓存<原因>，这次退回按修改时间判断（受影响产物：<清单>）。要恢复内容判据请运行 node scripts/build.mts。` | `node scripts/build.mts` |

两条原则：一是**回落不能静默**——即使按旧判据算绿，也要打一行「这次是按修改时间判断的，原因是……」，否则「缓存坏了所以门禁变弱」这件事没人知道；二是**文案里不要出现只有本仓开发者懂的缩写**（比如「指纹」「模式键」要写成人话）。

如果 #1326 选「指纹不等即判红」那条路（见 3.3），第三行改成：不回落到修改时间，直接报「构建输入在上次成功构建之后有变化，无法确认产物是否最新，请运行 node scripts/build.mts」。

### 3.6 风险清单与处置

1. **缓存按构建模式分档**（`full` / `--dev-only` / `--pkg-only` / `--force`，实测三档）。门禁拿哪一档？建议**只认 `full`**：验证链的预构建（`scripts/verify-parallel.mts:299-310`）与 `npm test`（`package.json:17`）跑的都是不带参数的全量构建，`full` 档必然存在；局部模式不会改变「输入 → 产物」的映射，只是少写几个包。处置：门禁按 `full` 算指纹、查 `full` 条目；没有 `full` 条目就回落。备选是把构建模式从指纹里拆出来单独存一个字段（要升 `CACHE_VERSION`），那样任何一档的记录都能互相比较，但这是构建侧的改动，得由 #1326 决定。
2. **并发会话踩缓存**。`writeBuildCache()` 是整文件覆盖写（`:253-254`），没走临时文件加改名。两个构建同时写，后写的赢；读的一方读到半截 JSON 时 `readCacheFile()` 会当成空（`:197-204`），门禁这边要能识别成「不可读」而不是「过期」。处置：回落路径覆盖这种情况即可；顺手把写缓存改成先写临时文件再改名，是低风险改进，但属于构建侧改动。
3. **缓存只在构建成功后写**（`:2106` 在文件末尾）。构建中途失败时，缓存里留的是上一次成功构建的记录：如果输入没变，摘要仍应匹配盘上的旧产物（安全）；如果输入变了，指纹不等（判过期，安全）；如果产物被写坏一半，摘要不等（判过期，安全）。不需要额外处置，但要在注释里写清这个推理。
4. **缓存版本升级**（`CACHE_VERSION` 一改，旧文件整份失效）。处置：把「版本不符」当成一种「缓存不可读」的原因报出来，不要笼统说「缓存缺失」。
5. **CI / 新克隆没有缓存**。CI 走 `scripts/verify-all.mts`、且 `npm test` 先构建，所以正常情况下缓存一定刚写过；但如果有人把构建与门禁拆到两个作业、或构建后清了 `node_modules`，就会落到回落路径。处置：回落的提示要说「这不是源码过期，是本机没有可用的构建记录」，避免维护者误以为代码坏了。
6. **缓存文件被手改**。有人把摘要改成「都对」，内容判据就会假绿。这与今天的修改时间同样可伪造（`touch` 一下也行），不算新增风险；但注释里要写明缓存是「本机便利记录」，不是信任边界。
7. **产物清单本身会变**。`listOutputs()` 是按当前树算的（`:174-183`），新加一个产物目录、或门禁新增一个产物，上一次的缓存记录里就没有它。处置：门禁点名的产物不在记录里时，明确报「缓存里没有这个产物的记录（可能是新加的产物，或缓存来自旧版本），请运行 node scripts/build.mts」，不要静默回落成绿。
8. **`.build/` 里混着临时工作文件**。实测 445 条产物记录里有 14 条是 `.build/tmp-index`、`commit-msg.txt`、`post-commit-chain.log` 这类临时文件。它们被删掉后，构建自己的命中判定会判「产物不一致」而白跑一次全量（`:228-236` 比的是记录里的每一条）。这不会让门禁判错（门禁只查自己点名的产物），但会拖低命中率。处置：本票不改，建议另立一张小票，把 `.build` 的临时文件挪出产物目录，或在 `listOutputs()` 里按白名单收。
9. **门禁自己也会写文件**。`verify-587` 改 `package/package.json`（输入之一），`verify-691` 用 `utimes` 摆夹具（`tests/verify-691-markdown-counts-page.ts:180`）。前者在改的窗口里会让输入指纹短暂变化——如果恰好有并发构建，可能写下一个「版本号 9.9.9」的缓存条目，之后那次构建自然又会因为指纹不等而重跑，不会留下假绿。处置：内容判据下 `verify-587` 不必再还原 mtime（见 1.5），但改文件这件事本身仍要和并发构建错开，这条写进 #1326 的验收里。
10. **门禁侧新增的耗时**。实测：输入指纹要读 1049 个文件、14.4 MB，约 107 毫秒；4 个根/包产物算 sha256 只要 4 毫秒。8 扇门禁各算一次，全链多出约 0.9 秒；并行链（8 路）里几乎看不出来。处置：接受；若要省，可以让并行执行器先算一次再传给子进程，但那是另一件事。
11. **构建末尾那一段 touch**（`:1645-1660`）。它存在的唯一理由是让修改时间判据不误报（注释自己写着）。判据换成内容摘要以后，这段可以删——但删之前要确认 DSH 侧的文件监听不靠「时间变了」来发现「内容变了」（地图 #1310 把 DSH 侧判据划在范围外，这里只记一句：真构建写产物时内容变了、时间自然也会变，只有原样复制的文件才需要 touch，而那些文件的内容本来就没变）。处置：留给 #1326 与地图的边界一起拍。
12. **确定性假设**。内容判据证明的是「盘上产物等于上一次成功构建的产物」，不是「等于此刻重新构建会得到的产物」。只有构建对同一输入确定性地产出同一批字节，这两句才等价。仓库已有 `verify-1325` 的「两次构建产物清单一致」与 ADR 的「构建现场生成」作支撑，但没有任何一条门禁真的比对「重跑一次是否逐字节相同」。处置：写进新判据的注释，别让后来的人以为它证明了更强的东西。

### 3.7 缓存缺失/损坏/模式对不上时的回落方案

**要点四条：**

1. **共用同一段代码**。回落不是每个门禁各写一遍，而是同一个函数返回 `{status: 'fresh' | 'stale' | 'unknown', reason, products}`。门禁只负责把 `status` 翻译成断言，不再各写一套 `for (const s of SOURCES)`。
2. **提示里要有原因与受影响产物**。原因取 `readCacheFile` 分类的五种之一（不存在 / 解析失败 / 版本不符 / 没有这一档 / 条目缺字段），产物列出这一扇门禁盯的那几个。维护者看到「缓存不存在」和看到「源码过期」，处理动作完全不同。
3. **不静默判绿**。回落时哪怕结论是绿，也要打一行「这次按修改时间判断，因为……」。一行成本，换掉一整类「门禁为什么突然变弱」的排查。
4. **回落仍然只判红不修**。门禁不许自己跑构建，也不许去修缓存；唯一的动作是给人一句可以照抄的命令。

**「内容不变但时间旧」要不要在回落路径里也判绿？——不能，也不该假装能。**

回落的触发条件就是「没有可用的构建记录」，这时候手上的证据只有文件的修改时间；「内容没变」这句话在没有基准摘要的情况下无法验证（现算一个 sha256 也没有东西可比）。所以回落只能照旧：时间旧就判红，并在文案里说清这是降级判断。这里有一个让人安心的性质：**缓存文件缺失时，`node scripts/build.mts` 必然走真构建**（`readCacheFile()` 拿到空壳，`:221-222` 直接返回 false），真构建会重写并 touch 产物，所以按提示跑一次构建之后，旧判据就会变绿——回落路径给的命令是有效的，不会让人卡在假红里。

如果非要让回落也「内容不变就绿」，只有两条路：一是回落时重跑一次构建来比字节（把门禁变成构建，30 秒，且会写盘，正是本票要消灭的抖动）；二是回落时直接判绿（把「构建没跑过」当成「没问题」，等于删掉这道门禁）。两条都不建议。

还有第三条路，介于两者之间，建议 #1326 在实施前权衡：让构建在缓存条目里多记一份「逐文件输入摘要」（`CACHE_VERSION` 从 2 升到 3）。门禁就能只拿自己那份窄源码集去比，把「本门禁的源码变了」与「无关文件（例如测试）变了」分开：前者可以直接判红并点名是哪一份，后者回落。它同时消掉 3.6 第 10 条那 110 毫秒的全仓扫描，代价是缓存文件变大（约多 84 KB）、要升缓存版本、构建每次成功构建多写一张表，以及升级后第一次仍要真构建一次。全局指纹方案（本笔记主推）改得少、不动缓存格式；逐文件摘要方案语义更准。两者都能满足本票验收，属于实现选择，建议在 #1326 里二选一并写进验收；若选全局指纹，就把「指纹不等怎么处理」也定下来（3.3 的两条路）。

## 4. 结论

### 4.1 门禁 → 现在判据 → 改后用哪条缓存事实 → 风险/注意

| 门禁 | 现在判据 | 改后用的缓存事实 | 风险/注意 |
| --- | --- | --- | --- |
| `tests/verify-ctx.ts`（:18-27、:30-34） | 4 份源码的 mtime 对 2 个产物 | `full` 条目的指纹 + `client.js`/`package/lib/client.js` 的摘要 | 两行改动；源码清单留着给回落 |
| `tests/verify-kernel.ts`（:93-102、:105-108） | 3 份源码 + 2 份 `.build` 产物 + 内核模块，对 2 个产物 | 同上，另加两份 `.build/shared/label-color/*.js` 的摘要 | 源码集合里有产物，属特例；产物清单要含它们 |
| `tests/verify-leaves.ts`（:126-135、:138-141） | 叶子源码的 `.js`/`.ts` 双路径 + 3 项，对 2 个产物 | 指纹 + 2 个产物摘要 | 双路径都在 `src`，不影响判据 |
| `tests/verify-parse-leaf.ts`（:39-48、:77-80） | 5 份源码 + 2 个产物 | 指纹 + `host.js`/`package/lib/index.js` 摘要 | 无 |
| `tests/verify-platform-contract.ts`（:42-49、:64-68） | 6 份源码 + 4 个产物 | 指纹 + 4 个产物摘要 | `:68` 失败即中止，新判据要保留这个行为 |
| `tests/verify-tabsfold-leaf.ts`（:24-33、:50-53） | 4 份源码 + 2 个产物 | 指纹 + 2 个产物摘要 | 无 |
| `tests/verify-log-client.ts`（:218-223） | 5 份源码对 `client.js` | 指纹 + `client.js` 摘要 | 只看开发产物，别顺手加包产物（会改变门禁覆盖面） |
| `tests/verify-log-artifacts.ts`（:96、:100） | 78 个镜像的 mtime 对 78 份真源 | 指纹 + 78 个镜像的摘要 | 方向相反，别抄错；镜像缺一个就红 |
| `scripts/matrix-full.ts`（:43-50、:74-77） | 6 份源码 + 4 个产物 | 同 `verify-platform-contract` | 不在链上；同一段判据的第三份拷贝 |
| `scripts/matrix-smoke.ts`（:40-47） | 同上 | 同上 | 同上 |

### 4.2 验收三问，一句话各答一次（外加一个常被追问的）

- **现在哪些门禁拿源码时间与产物时间比？** 10 处：`tests/` 下 8 扇门禁，加 `scripts/matrix-full.ts`、`scripts/matrix-smoke.ts`；全是逐文件比 `mtimeMs`，容差都是 1 秒，没有一处按字节比。
- **构建缓存里记的产物摘要能不能替代？** 能，但要用「输入指纹相同 + 产物摘要相同」两条一起判；这 10 处盯的源码与产物全部落在缓存已记录的范围内（78 个宿主镜像也逐一核对过）。
- **缓存缺失时怎么办？** 退回旧的修改时间判据，但必须把「为什么退回」和「哪几个产物受影响」打出来；退回时不能假装「内容没变」——没有基准摘要就证明不了，提示里给的那条构建命令会让它自己恢复。
- **为什么缓存命中还得碰产物？** 命中本身已经一个字节都不写（#1325，见 2.5）；剩下的是真构建末尾那段 `utimesSync`（`scripts/build.mts:1645-1660`）与 `verify-587` 的还原（1.5、3.6 第 11 条）。判据换掉后两处都能去，见 4.3 与 1.5。

### 4.3 判据之外还要动的文件（改动清单的其余部分）

第 4.1 节按门禁列了判据改动，验收要的「改动清单」还包括这些，实施时按票分工处理：

1. `scripts/build.mts`——把缓存事实抽到 `scripts/lib/build-cache.mts`（3.4 的方案）；决定是否删 `:1645-1660` 的 touch 段（3.6 第 11 条）；是否顺手把缓存写入改成「先写临时文件再改名」（3.6 第 2 条）；`.build` 临时文件是否移出产物清单（3.6 第 8 条，建议另立小票）。
2. `tests/verify-587-update-live.ts:98-110`——判据换掉后可删 `utimesSync` 还原与那条断言，文件内容还原仍要留（1.5）。
3. `tests/gate-map.json`——新增或搬动任何被门禁 require 的文件之后，必须重跑 `node scripts/gate-map.mts` 重新生成；否则 `tests/verify-gate-map.ts:70`（「归属表是最新的」逐字节比）判红（3.4 第 4 条）。
4. `tests/verify-1325-build-cache-nowrite.ts`——不要改。它守的是「缓存命中不写盘」，改判据时它应保持全绿（1.6 表）。
5. 文档与注释（归 #1328，但必须与判据同批发布，否则会有人按旧说法手动 touch 产物）：`docs/agents/verification.md:49-52`（缓存段落补一句「产物过期改由内容摘要判、缓存不可用时回落修改时间」）、`docs/workflow/DEV-WORKFLOW.md:110-119`（现在还写着旧 `.js` 文件名与「产物 mtime ≥ src mtime」）、`docs/architecture/matrix.md:40、:70、:77、:172`（四产物新鲜度与「构建先行」的说法）、`docs/releases/RELEASE-RUNBOOK.md:68`（发布检查里的「mtime 新于源码」）、`scripts/node-ambient.d.ts:117`（注释「产物新鲜度门禁拿它比先后」）、以及 `AGENTS.md:79` 里「`verify-*-freshness` 那几条门禁」这句过时措辞（1.4）。
6. 新回归门禁（归 #1327）：建议 `tests/verify-1327-freshness-content.ts`，四组行为——内容相同但时间旧判绿；只改源码不构建判红（或按 3.5 的设计回落并判红）；产物被手改判红并点名；缓存缺失或损坏回落并打印可见提示。新文件按目录约定自动进链，但必须重跑 `node scripts/gate-map.mts`（同第 3 条）。

## 5. 需要 #1326 拍板的点（这里只列选项与利弊，不替它决定）

1. **门禁查哪一档缓存记录？**
   - 只认 `full`：实现最简单，链上与会话里正常都有这一档；缺点是只跑过 `--dev-only` 的机器上会回落。
   - 把构建模式从指纹里拆出来单独存字段（升 `CACHE_VERSION`）：任何一档记录都能用；缺点是动了构建侧的缓存语义，要重测 #1325 的回归门禁。
   - 任选一档，只要指纹对得上就用：命中率最高，但「这一档没写全部产物」会让摘要判断漏掉几个产物（`--dev-only` 不写 `package/lib`）。
2. **判据的顺序？**
   - 内容优先（每扇门禁先算指纹，再比摘要）：判据最准，每扇多约 110 毫秒。
   - 修改时间当快路、内容只用来「撤销假红」：多数情况下零成本；缺点是「产物被手改且时间变新」仍然假绿，等于保留了今天的漏洞。
3. **共用实现放哪？** `scripts/lib/build-cache.mts` 抽出来（推荐，见 3.4）／给 `build.mts` 加 `--check-products` 让门禁 spawn 它／在 `tests/lib/` 抄一份。三个选项的取舍见 3.4，代价分别是「改构建侧并重生成归属表」「每扇门禁多一次进程启动」「迟早分叉」。
4. **回落算红还是算「无法判断」？** 都要求跑构建，区别只在退出码与文案：算红简单、与今天一致；算「无法判断」更诚实，但要改链执行器对退出码的约定（见 `tests/lib/gate-result.ts` 那套完成记录）。建议至少把原因写进断言文案。
5. **要不要同时删掉 `scripts/build.mts:1645-1660` 的 touch 与 `verify-587` 的 `utimesSync`？** 只改门禁不改构建，会留下两段没人需要的时间操作；一起删最干净，但要先确认 DSH 侧文件监听不依赖「时间变了」（地图 #1310 把这条划在范围外）。
6. **接受「改测试文件也要先重建」这个摩擦吗？** 输入范围包含整棵 `tests`（`scripts/build.mts:97-104`）。要么接受（与构建自身行为一致），要么让构建额外记一份「影响产物的输入」指纹，门禁只比这一份——后者是新的设计，成本和收益都要另算。
7. **`.build` 里的临时文件要不要挪出去？** 它们现在被当成产物记进缓存（实测 14 条），会让构建白跑全量。与本票可分开处理，但同一片区域，适合一起排期。
8. **判据用全仓输入指纹，还是让构建多记一份逐文件输入摘要？**
   - 全仓指纹：不改缓存格式，实现最小；代价是「输入变了」分不出是哪一份，只能回落（3.3）或整树判红，且每扇门禁多扫 14.4 MB。
   - 逐文件摘要（`CACHE_VERSION` 升 3）：门禁只比自己的窄源码集，能点名是哪一份变了，也省掉全仓扫描；代价是缓存变大、构建侧多写一张表、升级后第一次真实构建（3.7 末尾）。
   - 建议：若 #1326 想保持「与今天判据等价、落在同一批源码上」的语义，选逐文件摘要；若优先最小改动，选全仓指纹并把 3.3 的两条路定下来。

## 6. 附：这次调查用过的命令与实测数字

- `git show 998854a8 --stat`、`git show 998854a8 -- tests/verify-parse-leaf.js`：确认 1 秒容差由哪次提交引入、提交正文没写理由。
- `node -e` 读 `node_modules/.cache/dsh-build.json`：`version`、三档 `entries`、每档 445 条产物、`at` 时间、14 条 `.build` 临时文件、`src/host` 78 个镜像是否齐全。
- `node -e` 模拟 `listInputs()` 做一次输入指纹：**1049 个文件、14.4 MB、约 107 毫秒**；四个根/包产物算 sha256 共 **4 毫秒**；全部 445 个产物共 7.5 MB。
- 目录统计：`tests/verify-*.ts` 共 **318** 个，文件名含 `freshness` 的 **0** 个。
- 全仓 `grep`：`mtimeMs >`、`utimesSync`、`mtime:\s*0` 三种模式，用来把「判据」与「无关用法」分开（见 1.6）。
- 复核时另跑过一次 `node scripts/build.mts`：退出码 0、只打印缓存命中一行、四份产物大小 1996240 / 58123 / 1998679 / 58078 字节，产物与缓存文件都没被写。
- 除这次缓存命中的构建外没有跑别的构建、没有跑验证链、没有改任何源码；本笔记是本次唯一的产出。
