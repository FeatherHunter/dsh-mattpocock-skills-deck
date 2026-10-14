# 提交 f086a8e3（票 #1048）落地之后，这个仓库现在有几处红点

调查对象：提交 `f086a8e3`（`f086a8e33fc7b40fb58a31f664a7f0580759af72`，作者 FeatherHunter，2026-10-14 15:53:27 +0800，提交信息「判定收全证据再合成，每一步都能从日志读出为什么这么判（#1048）」）。

调查时间：2026-10-14 16:34–16:47（Asia/Shanghai）。工作目录 `D:\dsh-plugin\dsh-mattpocock-skills-deck`，Node v24.19.0，包版本 `dsh-mattpocock-skills-deck@1.8.0-rc.7`。

调查方式：只读。只跑门禁、读代码、读 git 历史、读锁文件与 CI 配置；没有改仓库里任何文件，没有装包，没有构建，没有 `git add`/`commit`/`checkout`。

用词说明（第一次读这份记录的人看这里就够）：

- **门禁**：仓库里那些自己判断「通过 / 不通过」并给出退出码的检查脚本，名字多是 `tests/verify-*.js`、`scripts/typecheck.mts`。
- **红点**：某道门禁报出的**一条不通过条目**。一条红点不等于一个 bug——比如「13 条缺口」是 13 条红点，它们说的是 13 个文件没人检查。
- **缺口**：类型检查门禁的一种结论，指某个 TypeScript 源文件不在**任何**一份 `tsconfig*.json` 的检查范围内，也就是一次类型检查都没过。
- **重复归属**：同一个源文件被两份 `tsconfig*.json` 同时圈住，会被检查两遍，而且两边各按自己的编译选项解释它。
- **棘轮**：一条「手写 JavaScript 只许减少、不许新增」的门禁，靠 `tests/handwritten-js-baseline.json` 里记的旧文件名单对账。

---

## 一句话结论

现在有**三处**红，**没有一处是 #1048 造成的**：

1. **类型检查 `node scripts/typecheck.mts` 报 35 条不通过**。拆开是：13 条「缺口」+ 20 条「重复归属」+ 1 条「类型错误」（这一条里面装着 57 行编译器错误）+ 1 条「棘轮涨了」。其中 20 条重复归属与那条类型错误，是今天 16:35 才建出来的新配置文件 `src/tracker/tsconfig.json`（票 #1147）带来的；13 条缺口是「`src/host` 这一片代码没有任何一份配置管」的老状态；1 条棘轮是票 #1150 新增的一个手写 JavaScript 测试文件触发的。
2. **`npm run test:smoke` 的六条冒烟里三条不过**。`smoke-client` 与 `smoke-render` 是本机 `node_modules` 里有 4 个包只剩空目录、文件不见了（本机装包坏了，与代码无关）；`smoke-host-dispatch` 是它的测试夹具还在用「只读时代」的假文件通道，而票 #1138 从今天起要求「绑后端必须真的写进工作区文件」，两者对不上。
3. 传闻里的第三条「日志门禁报未知事件 `detection.cache.hit`」**今天已经不存在**。那条事件在 15:55:40 由 #1131 自己登记进了 `research/489-appendix.md` 的对照表（第 245 行第 99 号）与字段白名单；门禁 `tests/verify-log-fields.js` 现在 196 条断言全部通过。

**#1048 有没有新增红点：没有，一条都没有。** 证明方式见第一节末尾——#1048 这次提交没有改任何一份 `tsconfig*.json`，只新增了一个 `tests/` 下的 `.ts` 文件，所以它动不了「缺口 / 重复归属 / 越界」这三个桶的判定；四个桶逐一对上归属之后，35 条全部落在别的提交或既存状态上。

另外有一条要如实说清的细节：#1048 那次提交**不是一次干净的提交**——它的提交信息自己写明，这条线里还捎带了 #1131 当时没提交的改动。因此 `src/tracker/detection/detectionService.ts` 里 57 行编译器错误中，有 5 行落在 #1048 最后改过的那几行上。但这是同一个既存缺陷的搬运，不是新缺陷，也没有新增任何一条门禁条目。

---

## 一张表：红点、证据、归属、建议

| 红点 | 一手证据（命令 + 关键输出 + 文件:行） | 归属于 | 建议怎么办 |
| --- | --- | --- | --- |
| 「缺口」13 条：`src/host` 下 13 份 `.ts` 没有任何配置检查 | `node scripts/typecheck.mts` 输出第 15–27 行，逐条点名 `src/host/detectChain.ts`、`src/host/git-process.ts`、`src/host/platform/{darwin,linux,win32}/index.ts`、`src/host/refresh/{gate,ledger,refusal-text}.ts`、`src/host/{sessionRefresh,sessionSnapshot,snapshotBuild,snapshotEnvelope,snapshotInflight}.ts`；`git grep -n "src/host" f086a8e3 -- "tsconfig*.json" "*/tsconfig.json"` 无命中（退出码 1） | 早于 #1048 的既存状态：`src/host` 这一片从来没有过自己的 `tsconfig.json`，8 份配置谁都没圈它 | 另开一张票：给 `src/host` 建一份配置（或把它圈进某份现有配置的 include）。这是架构决定，不该塞进 #1048 |
| 「重复归属」20 条：`src/tracker/contract/` 14 份 + 根下散件 6 份被两份配置同时圈住 | 输出第 28–47 行，每条原文都是「…同时落在这些配置里：src/tracker/tsconfig.json、tsconfig.contract.json」；`git log --oneline -6 -- src/tracker/tsconfig.json` 显示这份配置由 `2482604f`（#1147）在 16:35:10 新建；`git cat-file -e f086a8e3:src/tracker/tsconfig.json` 报 `fatal: path … does not exist`（退出码 128） | `2482604f`（票 #1147）。配置自己的注释第 12–16 行也写着「【重复归属】20 条……这 20 条怎么收口……在 #1147 / #1148 里定」 | 票 #1147 还开着，就地收口：`src/tracker/tsconfig.json` 的 `include` 从 `["**/*.ts"]`（第 41 行）改成排除契约子树与那 6 个散件，或者让 `tsconfig.contract.json` 让位 |
| 「类型错误」1 条：`src/tracker/tsconfig.json` 报 57 条编译器错误 | 输出第 48 行；`node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json --noEmit` 拿到全 57 行：`src/tracker/detection/detectionService.ts` 56 条 + `src/tracker/rooms/github/graph.ts(242,28): error TS2304: Cannot find name 'listIssues'.` 1 条 | 条目本身归 `2482604f`（#1147）新建的配置——那份配置在 #1048 落地时还不存在；错误本身是既存代码缺陷（`git blame` 显示 21 个出错行里只有 173、175、266 三行归 #1048，其余归 `99c5c22b`/`23f91cd6`/`85b98bd5`/`907ea085`/`21f3ca1d` 等更早的提交） | 另开一张票修这 57 条：先是 `detectionService.ts` 里 `opts` 被推成 `{}` 那一族（6 处），再是 `graph.ts:242` 的 `listIssues`。修完这条红点自然消失 |
| 「棘轮涨了」1 条：新增了手写 JavaScript `tests/verify-1150-plan-store-durable.js` | 输出第 49 行原文；`git log --oneline -3 -- tests/verify-1150-plan-store-durable.js` 显示加入它的提交是 `0ebd8943`「深挖补上计划游标的一道守卫……（#1150）」；`git merge-base --is-ancestor 0ebd8943 f086a8e3` 退出码 0（是 #1048 的祖先） | `0ebd8943`（票 #1150） | 由 #1150 的处理人二选一：把这个测试改名成 `.ts`，或者按 AGENTS.md 允许的「门禁夹具确有必要」重录基线并把理由写进提交信息 |
| `smoke-client` / `smoke-render`：`Error: Cannot find module 'is-potential-custom-element-name'` | `npm run test:smoke` 输出只有 34 行就停住，第一条 `tests/smoke-client.test.js` 直接抛错，requireStack 指向 `node_modules\.pnpm\jsdom@30.1.2\…`；单独跑 `node --import ./scripts/ts-hook.mjs tests/smoke-render.test.js` 报同一个错、同一条 requireStack。现场核查：`node_modules/.pnpm/is-potential-custom-element-name@1.0.1/node_modules/is-potential-custom-element-name` 是个**空目录**；同样为空的还有 `bidi-js@1.1.0`、`css-tree@3.2.1`、`lru-cache@11.5.3` 三个包 | 本机 `node_modules` 装坏了，不是代码问题。这个包在锁文件里有登记（`pnpm-lock.yaml` 第 669、1357 行声明 `is-potential-custom-element-name@1.0.1`，第 891、1370 行把它记成 `jsdom` 的依赖），只是磁盘上的文件不见了 | 本机重装一次依赖即可：用 **pnpm**（仓库是 pnpm 管的，`package.json` 写着 `"packageManager": "pnpm@11.22.0"`，只有 `pnpm-lock.yaml`、没有 `package-lock.json`），并且建议加 `--ignore-scripts`，避免 `pnpm install` 顺带触发 `package.json` 里那条 `"prepare": "node scripts/build.mjs"` 去抢构建产物 |
| `smoke-host-dispatch`：`FAIL 前置：把这一跑的工作区显式绑到 markdown 后端（让后面两条电话有确定的后端可选）`，随后两条调用拿到 `{"ok":false,"error":{"kind":"conflict",…}}` | `node --import ./scripts/ts-hook.mjs tests/smoke-host-dispatch.test.js` 输出末行 `dispatch 冒烟失败 1 项`、退出码 1。夹具 `tests/smoke-host-dispatch.test.js:36` 给的 `fsSvc` 只有同步的 `readFileSync/writeFileSync/…`，第 38 行给的 `platformSvc.fs` 只有 `mkdir` 与 `resolve`；而 `src/host/workspaceCwd.js:245` 要求文件通道同时具备 `resolve`/`readText`/`writeText` 三个函数，缺了就在第 247 行返回 `reason: 'no-channel'` | `64dfe6b7`（票 #1138）改了绑后端的写入口；这条冒烟的夹具没跟上（夹具写在只读时代）。**与 #1048 无关**：`git merge-base --is-ancestor 64dfe6b7 f086a8e3` 退出码 0，#1138 早于 #1048 | 改夹具：给 `platformSvc.fs` 补上 `readText`/`writeText` 两个假实现（改代码的方向是错的，理由见第四节）。属于 #1138 的收尾 |
| 日志门禁「未知事件 `detection.cache.hit`」（**已消失**） | `node --import ./scripts/ts-hook.mjs tests/verify-log-fields.js` 输出「全部通过」、196 条断言全 PASS、退出码 0；登记在 `research/489-appendix.md:245`（第 99 号 `detection.cache.hit`，级别「调试」）与第 60、180 行的修订说明；字段白名单在 `tests/verify-log-fields.js:56`（`cwdHash`/`caller`/`ageMs`） | `d255f2b7`（票 #1131，15:55:40）自己登记掉了。#1048 的提交在 `research/489-appendix.md:58` 就写明「这条事件由 #1131 自己登记，本票不代它占号位与计数」 | 不用做。若要顺手，把附录第 58 行那句「还没登记……门禁在本票改动之前就是红的」补一句「已由 #1131 登记」，免得后来人读到自相矛盾 |

---

## 一、typecheck 的 35 条：逐类归属

### 怎么跑的

```
node scripts/typecheck.mts
```

输出共 175 行，末尾原文：

```
不通过：35 条，逐条见上。
```

分类计数来自输出第 14 行 `【不通过】35 条`，四个桶的实际条数是我按逐条前缀数出来的：`[缺口]` 13 条（第 15–27 行）、`[重复归属]` 20 条（第 28–47 行）、`[类型错误]` 1 条（第 48 行）、`[棘轮涨了]` 1 条（第 49 行），13+20+1+1 = 35。（此前听到的说法里写「19 条重复归属」，实测是 20 条；写「类型错误若干」，实测是**一条**条目，里面装着 57 行编译器错误。）

另外两行状态数字也一并记下，后面判断「有没有新增」时要用：这次运行里 `src/` 下源码 227 份、被编译器看到 214 份，手写 JavaScript 590 份（基线 714 份）。

测量条件：跑了两次，一次在 HEAD 还是 `2482604f` 时，一次在 HEAD 前进到 `40c222dd`、工作区干净（只有 7 份未跟踪的 `research/` 笔记）之后；两次都是 35 条、四个桶的条数完全相同，所以这个基线是稳的，不是抓到了某个瞬间。

### 四个桶分别是谁的

**13 条缺口——既存状态，谁也不欠。** 这 13 个文件全部在 `src/host` 下，而且全部是 `.ts`：

```
src/host/detectChain.ts             src/host/refresh/gate.ts
src/host/git-process.ts             src/host/refresh/ledger.ts
src/host/platform/darwin/index.ts   src/host/refresh/refusal-text.ts
src/host/platform/linux/index.ts    src/host/sessionRefresh.ts
src/host/platform/win32/index.ts    src/host/sessionSnapshot.ts
                                    src/host/snapshotBuild.ts
                                    src/host/snapshotEnvelope.ts
                                    src/host/snapshotInflight.ts
```

`#1048` 落地那个时刻的配置文件一共 8 份（`git ls-tree -r --name-only f086a8e3` 过滤 `tsconfig.*.json`）：`src/deck/tsconfig.json`、`src/shared/config-store/tsconfig.json`、`src/shared/host-timer/tsconfig.json`、`src/shared/label-color/tsconfig.json`、`src/shared/refresh/tsconfig.json`、`src/shared/version-control/tsconfig.json`、`tsconfig.client.json`、`tsconfig.contract.json`——没有一份提到 `src/host`（`git grep -n "src/host" f086a8e3 -- "tsconfig*.json" "*/tsconfig.json"` 无命中，退出码 1）。今天多出来的是第 9 份 `src/tracker/tsconfig.json`，它只管 `src/tracker`，也管不到 `src/host`。

所以这 13 条是「谁都没给 `src/host` 建配置」这个状态一路带过来的，**归不到任何一次具体提交**。能确定的是它早于 #1048：这 13 个文件在被查的那个提交里就已经是 `.ts` 了（逐个 `git cat-file -e f086a8e3:<路径>` 全部退出码 0），而且最容易看错的那个 `src/host/detectChain.ts`，在 #1048 的父提交 `00cacee3` 里也已经是 `.ts`、并且没有同名的 `.js` 版本（`git cat-file -e 00cacee3:src/host/detectChain.ts` 退出码 0；`…detectChain.js` 报 `does not exist`，退出码 128）。

**20 条重复归属——票 #1147 今天下午新建的配置带来的。** 判定条件我直接从输出原文读：每条都写「同时落在这些配置里：`src/tracker/tsconfig.json`、`tsconfig.contract.json`」。左边那份配置是今天 16:35:10 由提交 `2482604f`（票 #1147，标题「契约层补齐能力上限：25 条能力定稿、三条编译期断言、门禁先建后删」）新建的，`include` 写的是整片目录通配 `["**/*.ts"]`（`src/tracker/tsconfig.json:41`），而 `tsconfig.contract.json` 早就用点名清单圈了同一批文件（契约子目录 + `identity-keys.ts`、`label-names.ts`、`fix-contract.ts`、`ui-description.ts`、`error-rules.ts`、`rooms/markdown/error-fail.ts`），于是两边同时圈住 20 份。这份新配置自己的注释第 12–16 行把这个数字与收口去向都写明了：

```
// 【越界】按 include 声明判，本配置是 0 条；【重复归属】20 条——契约子目录，加上散在跟踪器根下的
// identity-keys.ts / label-names.ts / fix-contract.ts / ui-description.ts / error-rules.ts /
// rooms/markdown/error-fail.ts，被两边都圈了。
// 这 20 条怎么收口（二选一：本配置 exclude 掉契约子树与散件，还是契约配置让位）是架构选题，
// 在 #1147 / #1148 里定，不在这次提交里动——动之前先保证门禁不比今天更红。
```

硬证据：`git cat-file -e f086a8e3:src/tracker/tsconfig.json` 返回 `fatal: path 'src/tracker/tsconfig.json' does not exist in 'f086a8e3'`（退出码 128）——#1048 落地时这份配置根本不存在，那 20 条当时不可能出现。

顺带纠正一个容易搞错的地方：这 20 条不是「新写的代码有问题」，而是**两个覆盖范围重叠**，属于配置的账。顺带说明「缺口从哪来又去哪了」：这份新配置把 `src/tracker` 整片圈了进来，所以覆盖对账里原来的大片缺口被填上了——配置注释第 5 行写「本域之前的状态是 85 份 `.ts` 一次都没被检查过（覆盖对账里 76 条缺口中的跟踪器部分）」，而现在的缺口只剩 13 条（全在 `src/host`）。也就是说，同一份配置把缺口从 76 条压到 13 条，代价是换来 20 条重复归属与 1 条装着 57 行错误的类型错误条目。

**1 条类型错误——条目归 #1147 的新配置，错误本身是既存缺陷。** 输出第 48 行的判定对象是**配置文件**（`src/tracker/tsconfig.json 报了 57 条类型错误`），而这份配置今天 16:35 才出现，所以这条条目在 #1048 落地时也不存在。它里面那 57 行编译器错误的分布是：

```
src/tracker/detection/detectionService.ts -> 56
src/tracker/rooms/github/graph.ts -> 1
src/tracker/rooms/github/graph.ts(242,28): error TS2304: Cannot find name 'listIssues'.
```

（56 条那一份用 `node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json --noEmit` 单独跑出来的，57 行全量落在 `%TEMP%\tsc-tracker.txt`。）

这 57 行是谁写的？我把出错行去重成 21 行，逐行 `git blame … f086a8e3 -- src/tracker/detection/detectionService.ts` 查最后一次改动，结果是：**只有 173、175、266 三行归 `f086a8e3`（#1048）**，其余归 `99c5c22b`、`23f91cd6`、`85b98bd5`、`907ea085`、`21f3ca1d`、`454ba246` 等更早的提交。而 #1048 改到的那三行上的 5 条错误，原文是同一族：

```
detectionService.ts(173,33): error TS2339: Property 'caller' does not exist on type '{}'.
detectionService.ts(173,61): error TS2339: Property 'caller' does not exist on type '{}'.
detectionService.ts(173,76): error TS2339: Property 'caller' does not exist on type '{}'.
detectionService.ts(175,29): error TS2339: Property 'withOutlet' does not exist on type '{}'.
detectionService.ts(266,117): error TS2339: Property 'signal' does not exist on type '{}'.
```

同一族在 #1048 没碰过的行上一样在报（第 256、296、305、315 行，归属是更早的提交），根因是函数选项参数 `opts` 在调用处被推成了 `{}`。也就是说：**这 5 条是既存缺陷落在 #1048 改过的行上，不是 #1048 新写坏的**。

而 #1048 为什么会碰到 #1131 的代码，它自己的提交信息里就交代了（这也是「混合提交」这件事的第一手来源，不是我推测的）：这条提交承载了 #1131 当时尚未提交的那部分工作。所以严格的说法是——#1048 这次提交不干净，但它没有让门禁多出任何一条红点。

**1 条棘轮涨了——票 #1150 的。** 输出第 49 行点名 `tests/verify-1150-plan-store-durable.js`；`git log --oneline -3 -- tests/verify-1150-plan-store-durable.js` 的第一行是 `0ebd8943 深挖补上计划游标的一道守卫：没有 resolve 的宿主不许把裸路径递下去（#1150）`，而 `git merge-base --is-ancestor 0ebd8943 f086a8e3` 退出码 0——这个文件是在 #1048 之前就进来的。

### #1048 没有新增红点的证明

不用「文件名字求交集」这种容易看错的比法（这里有个陷阱：`src/host/detectChain.ts` **既是** #1048 那次改的 15 个文件之一，**又**是 13 条缺口名单里的第一条——光按文件名求交集会得出错误的结论，因为那条红点说的是「这个文件没人检查」，跟文件内容是谁改的无关，而且它在 #1048 之前就已经没人检查了）。用判定条件比：

1. **#1048 没有改任何一份 `tsconfig*.json`。** `git show --name-only --format="" f086a8e3` 列出的 15 个文件是：`package.json`、`research/489-appendix.md`、`src/host/detectChain.ts`、`src/host/workspaceLabelColors.js`、`src/tracker/detection/backendDecision.ts`、`src/tracker/detection/detectionService.ts`、`tests/gate-map.json`、`tests/tracker-contract/sections/labels.js`、`tests/verify-1003-single-outlet.js`、`tests/verify-730-cwd-consistent.js`、`tests/verify-963-log-order.js`、`tests/verify-detection-evidence.ts`、`tests/verify-github-label-colors.js`、`tests/verify-log-count.js`、`tests/verify-log-fields.js`——里面没有 tsconfig。而「缺口 / 重复归属 / 越界」这三个桶**只由「哪些文件存在」和「哪份配置圈了谁」决定**，配置没动，这三个桶的判定就不可能因为它变化。
2. **#1048 只新增了一个文件，是 `tests/verify-detection-evidence.ts`。** `git show --diff-filter=A --name-only --format="" f086a8e3` 只输出这一行。缺口对账统计的是 `src/` 下的源码（本次运行的原话是「`src/` 下源码 227 份」），`tests/` 下的新文件不进这个桶；它又是 `.ts`，而「棘轮涨了」只对新增的手写 `.js` 报警（第 49 行原文点名的是 `.js`），所以这个新增文件哪个桶都动不了。
3. **四个桶逐一归属完毕**：13 缺口 = 既存状态（`src/host` 从没有配置），20 重复归属 = `2482604f`（#1147），1 类型错误 = 同一份新配置 + 既存代码缺陷，1 棘轮 = `0ebd8943`（#1150）。四条归属里没有一条落到 #1048，也没有一条落到 #1048 的父提交之后、由 #1048 直接或间接引起的位置。
4. 最后只剩「#1048 是不是把已有红点改得更红」这一问：它改到的文件里，只有 `detectionService.ts` 出现在错误名单上，而那 5 条属于既存族（见上），另外 2 条最早的错误（第 111、129 行）在 #1048 的父提交 `00cacee3` 里逐字相同，根本没被这次提交碰过。

**这条我有几分把握：** 归属结论把握很高（每一条都有提交哈希、配置存在性检查与 `git blame` 支撑，而且两次运行结果一致）。剩下不确定的是：我**没有**在一个只回退到 #1048 的独立工作树里重跑一遍类型检查来量「当时的红点数」——那需要 `git worktree add`，会改动仓库状态，超出本次只读授权。所以「#1048 当时是 77 条还是别的数字」我给不出实测值，只能给出结构性的结论：它落地时是 8 份配置、`src/tracker/tsconfig.json` 不存在，因此今天这 21 条（20 重复归属 + 1 类型错误）当时必然不存在，而 13 条缺口当时已经存在。

---

## 二、`detection.cache.hit`：这条红已经不存在了

**发射点**（文件:行，一手）：

```
src/tracker/detection/detectionService.ts:217
                logCtx.fire('debug', 'detection.cache.hit', { cwdHash: hash8(cwd), caller: caller, ageMs: Date.now() - (Number(cached.at) || 0) })
```

**谁引进的**：`git log -S "detection.cache.hit" --oneline -- src` 只输出一条 `f086a8e3`。也就是说这行代码是在 #1048 那次提交里进的仓库——但它属于 #1048 捎带进来的 #1131 那部分工作（提交信息自述），附录第 60 行把它记成「#1131 新增」。

**有没有登记**：登记了，而且在三个地方：

- `research/489-appendix.md:245` 的对照表里有一行：`| 99 | detection.cache.hit | 调试（2026-10-14 #1131 新增） | cwdHash 工作区键的短散列（不记路径原文）、caller 这一次是哪个调用方来问的（字符串，例如 wf.listLabels、detection-service）、ageMs 这一格缓存存了多久（毫秒） | … | src/tracker/detection/detectionService.ts 的 detect（命中工作区缓存、直接返回上一次结果的那一支） |`
- `research/489-appendix.md:60` 与 `:180` 是这次登记的修订说明，写明计数改为「常驻 43 条、按需 47 条、自监控 5 条、总数 95 条」。
- 字段白名单在门禁里：`tests/verify-log-fields.js:56`，允许的三个字段正是 `cwdHash`、`caller`、`ageMs`。

**门禁现在什么状态**：`node --import ./scripts/ts-hook.mjs tests/verify-log-fields.js` 输出「全部通过」，196 条断言全 PASS，退出码 0。另外我确认过：整个 `tests/` 目录里含「未知事件」这四个字的门禁**只有这一个文件**（`git grep -ln "未知事件" -- tests` 只列出 `tests/verify-log-fields.js`），所以不存在「另一道日志门禁还在报这条」。

**这句「门禁是红的」曾经是对的**——#1048 自己的附录第 58 行就写着：

```
另记一笔**不在本票范围**的事：`src/tracker/detection/detectionService.ts` 里 #1131 那条 `detection.cache.hit`
（缓存命中那一行）还没登记到本附录与字段白名单，所以 `tests/verify-log-fields.js` 在本票改动之前就是红的
（那条事件由 #1131 自己登记，本票不代它占号位与计数）。
```

而在 #1048 落地之后 2 分钟（15:55:40），提交 `d255f2b7`（#1131）就把它登记掉了，附录第 60 行是那次登记的原文。

**这条红该谁收：已经由 #1131 收完了**（票 #1131 现在是 CLOSED，关闭时间 2026-10-14T07:57:20Z，即北京时间 15:57:20）。不用再开票；唯一残留的是附录第 58 行那句「还没登记」的陈述现在已经过时，读起来会和第 60 行打架。

**这条我有几分把握：** 把握很高——发射点、登记行号、门禁输出都是当场跑出来的。唯一不确定的是「此前别人看到的那条 FAIL 是在什么状态下跑出来的」：今天 16:34 前后这个工作区里有别的会话在批量把 `.js` 改名成 `.ts`（当时 `git status` 有 95 条未提交改动），我无法还原对方跑命令那一刻的文件内容，只能说**现在**这条门禁是绿的。

---

## 三、缺包那条：本机 `node_modules` 装坏了，用 pnpm 重装

### 这个仓库用哪个包管理器

判据只有一条：看锁文件和目录布局。

| 判据 | 结果 |
| --- | --- |
| `package.json` 的 `packageManager` | `pnpm@11.22.0`（带 sha512 校验串） |
| `pnpm-lock.yaml` | 存在（60496 字节，修改时间 2026-10-13） |
| `package-lock.json` | **不存在** |
| `yarn.lock` | 不存在 |
| `node_modules/.pnpm` | 存在（pnpm 的依赖布局） |
| `pnpm-workspace.yaml` | 存在 |
| `.npmrc` | 存在 |

结论：**pnpm**。CI 也是 pnpm（`.github/workflows/verify.yml:24-31` 的 `pnpm/action-setup`，第 43 行 `pnpm install --no-frozen-lockfile`）。AGENTS.md 里说 npm 与 pnpm 两套装包守卫都存在（`.npmrc` 的 `engine-strict=true` 管 npm 的人，`pnpm-workspace.yaml` 的 `engineStrict: true` 管 pnpm 的人），那是为了照顾两种人，不代表这个仓库有两套锁文件。

### 这个包是谁的依赖、有没有被声明

- 它是 `jsdom` 的依赖：`pnpm-lock.yaml` 第 891、1370 行把 `is-potential-custom-element-name` 记在 `jsdom` 的依赖表里。
- **声明是有的**：`pnpm-lock.yaml` 第 669 行是它的包键、第 1357 行是 `is-potential-custom-element-name@1.0.1: {}`，版本 `1.0.1`。
- 谁要 `jsdom`：根 `package.json` 的 `devDependencies` 写着 `"jsdom": "^30.0.1"`，锁文件实际解析到 `30.1.2`。

所以**不是少声明了一个包**——锁文件里一切都对，是磁盘上那份装好的拷贝坏了。

### 现场：4 个包只剩空目录

```
node_modules/.pnpm/is-potential-custom-element-name@1.0.1/node_modules/is-potential-custom-element-name
```

这个目录存在，但它是**真实的空目录**（不是链接，里面一个文件都没有），所以 `require('is-potential-custom-element-name')` 直接 `MODULE_NOT_FOUND`。把 `node_modules/.pnpm` 下所有包目录扫一遍，同样是空目录的还有 4 个（前三个和它是同一棵 jsdom 依赖树上的）：

```
bidi-js@1.1.0
css-tree@3.2.1
is-potential-custom-element-name@1.0.1
lru-cache@11.5.3
```

报错原文（`npm run test:smoke` 的第一段）：

```
Error: Cannot find module 'is-potential-custom-element-name'
Require stack:
- D:\dsh-plugin\dsh-mattpocock-skills-deck\node_modules\.pnpm\jsdom@30.1.2\node_modules\jsdom\lib\jsdom\living\helpers\custom-elements.js
- D:\dsh-plugin\dsh-mattpocock-skills-deck\node_modules\.pnpm\jsdom@30.1.2\node_modules\jsdom\lib\generated\idl\Attr.js
…
  code: 'MODULE_NOT_FOUND',
```

### 修它的正确命令

**`pnpm install`，不是 `npm install`。** 理由：这个仓库的依赖树只认 `pnpm-lock.yaml`；`npm install` 会另建一套扁平的 `node_modules` 并生成一份 `package-lock.json`，既不会去修 `.pnpm` 目录里那几个空目录（问题依旧），又给仓库留下一份不该有的锁文件。

**会不会改锁文件**：正常情况下不会。`package.json` 与 `pnpm-lock.yaml` 是同步的（CI 每次都用 `--no-frozen-lockfile` 装，说明锁文件被视为可再生成的产物，而不是必须冻结的凭据），pinning 一致的安装不会重写它。我不能保证「一定不写」——只有在跑完那条命令之后用 `git status --porcelain -- pnpm-lock.yaml` 才能确认，而本次调查不许装包。

**有没有风险**：有两条，都要先说清楚再动手。

1. **`pnpm install` 会顺带跑 `package.json` 里那条 `"prepare": "node scripts/build.mjs"`。** 这条 prepare 脚本就是构建。本次调查被明确要求不许跑 `node scripts/build.mjs`（会和别的会话抢构建产物），所以如果你要在这台机器上重装，建议用 **`pnpm install --ignore-scripts`**：它照样从本地 store 把缺的文件补回 `node_modules`，但不跑任何生命周期脚本，也就不会去动 `src/client/views/**` 那些构建产物。
2. **别的会话正在同一个工作区里跑测试。** 重装过程中 pnpm 会重写 `node_modules`（至少是那几个包的目录），正在跑的测试可能瞬时读到半截状态、报一阵 `MODULE_NOT_FOUND`。建议等这台机器上的门禁跑完再装，或者接受一次噪音。
3. 补充一条实操提示：pnpm 判断「装好了没有」看的是目录与锁文件，这几个包的**目录是在的**，只是里面空了。所以第一次 `pnpm install` 有可能被判成「已经是最新」而跳过修复。如果跑完仍然报同一个错，就把那 4 个空目录删掉再跑一次（`node_modules/.pnpm/<包名>@<版本>` 是依赖缓存，不是仓库文件，删了不会丢源码）。

### `smoke-render` 与 `smoke-client` 是不是同一个根因

**是。** 单独跑 `node --import ./scripts/ts-hook.mjs tests/smoke-render.test.js` 得到的是**逐字相同**的报错与 requireStack（同一份 `jsdom@30.1.2` 调用链）。

但这里要纠正一处容易被误读的地方：**`npm run test:smoke` 这一次运行根本没有跑到 `smoke-render`。** 那六条命令是用 `&&` 串起来的（`package.json` 的 `scripts.test:smoke`），第一条 `smoke-client` 直接崩了，后面的五条一条都没启动——整个输出只有 34 行。所以「`smoke-client` 与 `smoke-render` 都报错」这个说法，靠单次 `npm run test:smoke` 是看不出来的，是我把两条分别单独跑才确认的。

顺带把六条冒烟的真实战果记全（逐条单独跑）：
`smoke-client` 失败、`smoke-render` 失败、`smoke-host-dispatch` 失败；`smoke-host`、`smoke-naming-persistence`、`smoke-comment-passthrough` 三条通过。**六条里三条不过**，而只要 `smoke-client` 还坏着，`npm run test:smoke` 永远只会显示第一条。

**这条我有几分把握：** 「本机装包坏了、用 pnpm 重装」把握很高（空目录是我自己 `Get-ChildItem` 看到的，锁文件行号是直接读的，报错原文与 requireStack 是当场跑出来的）。不确定的是**为什么会坏**——可能是某次装包被打断、也可能是杀毒/清理工具动了这些目录，我没有证据说明是哪一种，也不敢说重装一次就一定永久好。另外「`pnpm install` 会不会改写锁文件」我按锁文件与清单一致来推断为「不会」，但没有实测。

---

## 四、`no-channel` 那条：夹具没跟上 #1138 的新写入口

### 先证明引进它的提交早于 #1048

```
git merge-base --is-ancestor 64dfe6b7 f086a8e3   → 退出码 0
```

退出码 0 表示 `64dfe6b7` 是 `f086a8e3` 的祖先，也就是 #1138 那次改动**早于** #1048。`64dfe6b7` 的提交信息是「人选只留工作区文件一份：删掉注册表里的进程内副本，写不进文件就如实报（#1138）」，改动 23 个文件，其中包含 `src/host/workspaceCwd.js`（152 行增删）；它**没有**改 `tests/smoke-host-dispatch.test.js`（`git show --name-only --format="" 64dfe6b7 | Select-String smoke` 无命中）——这就是夹具落后的由来。

### 判定路径（文件:行）

`src/host/workspaceCwd.js:64-115` 是 `handleBind`。它第 86 行把写文件这件事交给 `writeWorkspaceRecord`，然后第 87 行判「写成功没有」，不成功就走 90–94 行这条分支：

```js
90:        return {
91:          ok: false, kind: 'workspace-file-failed', cwd: cwd, backendId: backendId, workspaceFile: workspaceFile,
92:          errorKind: (why && why.reason) || 'other',
93:          error: '这次没能把选择写进这个工作区里的配置文件（' + bindFailAdviceOf(why && why.reason) + '），所以这次选择没有生效。请确认这个目录可以写，然后重新选一次。',
94:        }
```

第 82–84 行是 #1138 写下这条分支的理由（原文）：

```js
82:      // #1138 唯一写入口，一次动作只写一份：先写工作区文件，**写成功才算这次选择生效**。
83:      //   以前这里同时写进程内绑定、本机记忆与工作区文件三处，顶层 ok 却恒为真 —— 文件写失败照样回 ok，
84:      //   界面于是显示「已切换」，而重启之后又变回原来的后端。今天写不进去就当场说没生效。
```

`no-channel` 这个具体原因是 `writeWorkspaceRecord` 给的，`src/host/workspaceCwd.js:231-248`：

```js
240:    let fsSvc = null
241:    try {
242:      const platform = await getPlatform()
243:      fsSvc = (platform && platform.fs) || null
244:      if (!fsSvc && ctx && typeof ctx.get === 'function') { try { fsSvc = ctx.get('fs') } catch (eG) { fsSvc = null } }
245:      if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.writeText !== 'function') {
246:        try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('warn', 'host.call.fail', { method: _method, kind: 'bind', errorHash: hash8('no-fs') }) } catch (eL) {}
247:        return { ok: false, error: { kind: 'env', reason: 'no-channel', message: '这次没拿到可用的文件通道（写工作区文件要用它）。' } }
```

第 245 行就是那道门：文件通道必须同时有 `resolve`、`readText`、`writeText` 三个函数，缺一个就算「没通道」，第 247 行返回 `reason: 'no-channel'`，这个 `reason` 顺着上一条分支的 `errorKind`（第 92 行）冒到信封顶层。

（另有一处也写着 `no-channel`，是给「布局」那条动作用的，`src/host/workspaceCwd.js:128` 的 `let why = usable ? 'no-record' : 'no-channel'`；`bind` 走的是上面那条路，不是这一条。）

### 夹具为什么拿不到文件通道

`tests/smoke-host-dispatch.test.js` 的夹具（原文）：

```js
36: const fsSvc = { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: async () => {}, readdirSync: () => [], statSync: () => ({ isDirectory: () => false }) }
38: const platformSvc = { getHome: async () => '', path: { join: (...a) => a.join('/') }, fs: { mkdir: async () => {}, resolve: async (k) => String(k) }, resolveExecutable: async () => 'gh', env: { get: () => undefined } }
39: const services = {
40:   subprocess, timer, fs: fsSvc, platform: platformSvc,
…
43: const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} } }
…
94:     const bind = await callHandler('bind', { cwd: process.cwd(), backendId: 'markdown' })
95:     check(!!bind && bind.ok === true, '前置：把这一跑的工作区显式绑到 markdown 后端（让后面两条电话有确定的后端可选）')
```

答案是：**不是「宿主没接上」，也不是「夹具没给 fs/platform」——两样它都给了，但给的文件接口是旧形状。** 第 245 行那道门找的是异步文件通道（`resolve` / `readText` / `writeText`），而：

- 第 38 行挂在 `platform.fs` 上的只有 `mkdir` 和 `resolve`，**没有 `readText`、没有 `writeText`**；
- 第 36 行那个 `fs` 服务是**同步**接口（`readFileSync` / `writeFileSync` / `existsSync` …），第 244 行的兜底分支即使取到它，也过不了第 245 行的检查。

于是 `writeWorkspaceRecord` 走第 247 行返回 `no-channel`，`handleBind` 把整件事包成 `kind: 'workspace-file-failed'`（第 90–94 行）。这条冒烟是「只读时代」写的：那时候绑后端只是记在内存里，随便给个假对象就行；#1138 之后，绑后端**必须真的写进工作区文件**，夹具的假文件系统就跟不上了。

测试自己只打印真假、不打印信封（`tests/smoke-host-dispatch.test.js:58` 的 `check` 只输出 PASS/FAIL），所以 bind 那条信封的原文看不到；但从上面两处代码可以断定它的形状是：

```json
{"ok":false,"kind":"workspace-file-failed","backendId":"markdown","workspaceFile":{"ok":false,"error":{"kind":"env","reason":"no-channel","message":"这次没拿到可用的文件通道（写工作区文件要用它）。"}},"errorKind":"no-channel"}
```

这个判断在输出里能找到侧面印证：bind 失败之后，后面两条调用拿到的都是「后端尚未确定」的冲突信封（原文）：

```
  FAIL 前置：把这一跑的工作区显式绑到 markdown 后端（让后面两条电话有确定的后端可选）
  listLabels 结果: {"ok":false,"error":{"kind":"conflict","message":"这个工作区使用哪个后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试（这个工作区尚未选定后端，请在面板中选定这个工作区使用的后端，然后重试）"}}
  setLabelColors 结果: {"ok":false,"error":{"kind":"conflict","message":"这个工作区使用哪个后端尚未确定：请在面板中选定这个工作区使用的后端，然后重试（这个工作区尚未选定后端，请在面板中选定这个工作区使用的后端，然后重试）"}}
dispatch 冒烟失败 1 项
```

（文件里用「电话」指一次 RPC 调用，是这个仓库既有的叫法，见第 74、83 行。）

### 两种修法各自的代价

**修法一：改夹具（推荐）。** 给第 38 行的 `platformSvc.fs` 补上 `readText: async () => ''` 与 `writeText: async () => {}`，让假文件通道长得像真通道。

- 代价小（两三行），方向也对：这条冒烟要证明的是「RPC 路通、信封形状对」，不是「真的写了一个工作区文件」，所以拿假通道把形状凑齐是合理的。
- 但要预判一件事：bind 一旦「成功」，后面 `listLabels` / `setLabelColors` 就会真的走进后端线路，而夹具里没有后端房间的实现，红点会平移一步到那里。可能还要顺带把这两条断言的期望改成「信封形状对即可」，不能让这条冒烟变红——它第 87 行原本就写着这个意思（「所以下面只断言信封的形状，不断言『后端还没实现』」）。
- 另一条更彻底但更重的路：让夹具直接用真的平台/文件服务，而不是手搓假对象。那条路最接近生产，但要求跑测试的机器上有真的 DSH 宿主环境，冒烟就不再是自足的了。

**修法二：改代码，让 `writeWorkspaceRecord` 接受同步文件接口当兜底。** 代价明显更大，而且方向是错的：#1138 那次改动要治的病正是「写不进去却回 ok，界面显示已切换、重启又变回去」（第 82–84 行的原话），而夹具里那个同步 `fs` 是个什么都不做的空壳（`writeFileSync: () => {}`）——一旦让它算数，bind 就会在什么都没写的情况下回 ok，等于把 #1138 刚堵上的洞重新打开。所以这条不做。

**归属**：这条红是 #1138 的收尾工作（#1138 票已 CLOSED），与 #1048 无关——技术上无关（不是它引进的）也因果上无关（它改的文件里没有这条冒烟、也没有那条判定路径）。

**这条我有几分把握：** 判定路径与夹具形状把握很高（都是逐行读出来的原文）。两处不确定：一是 bind 那条信封的**字面原文**我没拿到（测试不打印它，我没有为了拿它而临时写探针脚本），我给的是从代码推出来的形状；二是「补上 `readText`/`writeText` 之后这条冒烟能不能直接转绿」我没有实测（那要改文件，超出本次只读授权），所以我把它写成「要预判红点可能平移到后端房间那一层」。

---

## 五、CI 会不会看到这些红点

### CI 跑什么（`.github/workflows/verify.yml`，共 91 行）

矩阵是三个操作系统（`ubuntu-latest` / `windows-latest` / `macos-latest`），步骤依次是：

| 步骤 | 行号 | 命令 |
| --- | --- | --- |
| 装 pnpm | 24-31 | `pnpm/action-setup`，版本只从 `package.json` 的 `packageManager` 取 |
| 装 Node | 33-39 | `node-version: 22`，缓存 pnpm |
| **装依赖** | 41-44 | `pnpm install --no-frozen-lockfile` |
| 装浏览器 | 49-57 | `npx playwright install … chromium` |
| 构建 | 59-61 | `node scripts/build.mjs` |
| **门禁链** | 63-65 | `node scripts/verify-all.mjs` |
| 冒烟一 | 67-69 | `node scripts/matrix-smoke.js --os=all` |
| 冒烟二 | 71-73 | `node scripts/matrix-full.js --os=all --backend=all` |
| 上传产物 | 75-84 | `actions/upload-artifact` |

### CI 装依赖用哪条命令 → 缺包那条在 CI 会不会出现

`pnpm install --no-frozen-lockfile`（第 43 行），在干净的检出上从 registry 装全 `pnpm-lock.yaml` 里声明的树。所以**本机那 4 个空目录的情况不会在 CI 出现**——那是这台机器的 `node_modules` 现状，不是仓库内容。这条红只在本机存在。

### 冒烟套件在 CI 里跑不跑

**不跑那六条。** 两条证据：

1. `scripts/matrix-smoke.js` 与 `scripts/matrix-full.js` 里根本没有出现六条冒烟的文件名（`git grep -ln "smoke-render" -- scripts tests .github` 的结果是 `tests/handwritten-js-baseline.json`、`tests/smoke-render.test.js`、`tests/unmigrated-tests-baseline.json`、`tests/verify-530-pr-tab.js`——没有一条在 `scripts/` 或 `.github/` 下）。CI 里那两个 "smoke" 步骤是**操作系统 × 后端的矩阵冒烟**，跟 `tests/smoke-*.test.js` 不是一回事。
2. 六条冒烟只挂在两处：根 `package.json` 的 `test:smoke`（六条用 `&&` 串起来），以及 `npm test` 的最后一段（`npm run typecheck && node scripts/build.mjs && node scripts/verify-chain.js && npm run test:smoke`）。CI 不跑 `npm test`。

所以 CI **看不到**那三条冒烟红。

### typecheck 在不在 CI 的必过集合里

**在，而且现在就是红的。** `node scripts/verify-all.mjs` 不自己写名单，它读 `package.json` 里 `scripts.verify` 那条长串、按 `&&` 切开逐条跑，逐条记账，最后「有没有失败」决定退出码（`scripts/verify-all.mjs:1-23` 的注释与文件末的 `process.exit(1)`）。那条长串的最后一项是 `node tests/verify-typecheck.mts`，它把 `scripts/typecheck.mts` 跑一遍并把结论原样透出去：

```ts
// tests/verify-typecheck.mts
const facts = mod.collectFacts()
const findings = mod.judge(facts)
mod.report(facts, findings)
const auditFailed = findings.some((f) => f.level === 'fail')
process.exitCode = auditFailed || caseFailures.length ? 1 : 0
```

35 条里有 35 条 `level === 'fail'`，所以这一项退出码是 1，`verify-all.mjs` 会把它记进失败清单并让整个 job 失败。**结论：这 35 条在 CI 上是真红**，不是只在本机红。至于「哪几条在 CI 上看着更红」：CI 装的是干净依赖，所以 CI 上只有类型检查这一类红，本机多两类（缺包、夹具）。

（另有一个 Windows 本机专用的小差别：`npm test` 走的是 `scripts/verify-chain.js` 而不是 `verify-all.mjs`，因为 `package.json` 里那条 verify 长串有 8639 字，超过 Windows cmd 单条命令上限；两者的名单同源，`verify-chain.js` 是首红即停，`verify-all.mjs` 是逐道跑完再汇总。这一点不影响上面的结论。）

**这条我有几分把握：** 把握很高——CI 的入口、装依赖命令、冒烟步骤都是逐行读的配置原文；`verify-all.mjs` 的行为、`verify-typecheck.mts` 的退出码写法也是读的源码原文。不确定的是：我**没有**真的在 CI 上跑一遍，也没有 `gh run list` 去看最近一次 workflow 的真实结论（本次只读范围内我只查了票的状态）。所以「CI 现在是红的」是从脚本逻辑推出来的必然结论，不是看到的运行结果。

---

## 六、修还是不修：分开说

**属于 #1048 该管的：没有。** 这次提交没有新增红点，也没有把既存红点改得更红。#1048 票本身已经是 CLOSED（关闭时间 2026-10-14T07:55:37Z，即北京时间 15:55:37），不需要为它再开修复票。唯一可以顺手做的是把 `research/489-appendix.md:58` 那句已经过时的「还没登记」补一笔指向第 60 行的说明。

**属于 #1147 收口的（票还开着，最适合就地解决）：21 条。**

- 20 条重复归属：把 `src/tracker/tsconfig.json:41` 的 `include: ["**/*.ts"]` 收窄，排除 `contract/` 子树与那 6 个散件，或者反过来让 `tsconfig.contract.json` 让位。这是配置的账，改完那 20 条直接消失。
- 1 条类型错误：这条是**代码**的账，配置改不动它——`detectionService.ts` 那 56 条与 `graph.ts:242` 那 1 条修完才会消失。建议单独立票，别塞在 #1147 里（#1147 是「契约层补齐能力上限」，性质不同）。

**该另开票的：14 条。**

- 13 条缺口：给 `src/host` 定归属——建一份 `src/host/tsconfig.json`，或把它圈进某份现有配置。这是个架构决定（`src/host` 是宿主边界，跟 `src/deck`、`src/tracker` 同级），值得单独一张票，不要顺手改。
- 1 条棘轮涨了：`tests/verify-1150-plan-store-durable.js` 改名成 `.ts`，或按 AGENTS.md 的例外重录基线。归 #1150 的处理人。

**只需要本机重装一次依赖：2 条冒烟（`smoke-client`、`smoke-render`）。** 用 `pnpm install --ignore-scripts`（加 `--ignore-scripts` 是为了不触发 `package.json` 里那条 `prepare` 构建，避免和别的会话抢产物）。装完确认 `node_modules/.pnpm` 下那 4 个包目录里有文件，再跑一次 `npm run test:smoke`。

**该改夹具的：1 条冒烟（`smoke-host-dispatch`）。** 给 `tests/smoke-host-dispatch.test.js:38` 的 `platformSvc.fs` 补 `readText`/`writeText`。属于 #1138 的收尾，可以并进上面那张 `src/host` 的票里一起做（两件事都在宿主边界上），也可以单独一张小票。

**已经不用做的：1 条（日志门禁的 `detection.cache.hit`）。** #1131 在 15:55:40 已经收掉了，现在门禁是绿的。

按「修完能少几条红」排个序：重装依赖少 2 条（最省事，纯本机）→ 改夹具少 1 条（3 行）→ #1147 收口 20 条（改配置）→ 棘轮 1 条（改名或重录）→ `src/host` 缺口 13 条（要定架构）→ 57 行类型错误 1 条（要真改代码，工作量最大）。

---

## 七、这份结论是怎么来的（可复现的命令）

全部只读；`.ps1` 之外的命令都能直接照抄。

```bash
# 被调查提交的基本信息与它改了什么
git log --oneline -3 f086a8e3
git show --name-status --format="" f086a8e3
git show --diff-filter=A --name-only --format="" f086a8e3     # 只新增了 tests/verify-detection-evidence.ts
git show --name-only --format="" f086a8e3 | Select-String tsconfig   # 空：没碰任何配置

# 类型检查基线（慢，耐心等；输出 175 行）
node scripts/typecheck.mts

# 那 57 行编译器错误的全文与分布
node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json --noEmit

# 归属：配置是哪来的、出错行是谁最后改的
git log --oneline -6 -- src/tracker/tsconfig.json
git cat-file -e f086a8e3:src/tracker/tsconfig.json      # fatal: not in that commit（退出码 128）
git ls-tree -r --name-only f086a8e3 | Select-String 'tsconfig.*\.json$'   # 当时 8 份
git grep -n "src/host" f086a8e3 -- "tsconfig*.json" "*/tsconfig.json"     # 无命中（退出码 1）
git blame -L 173,175 f086a8e3 -- src/tracker/detection/detectionService.ts
git blame -L 266,266 f086a8e3 -- src/tracker/detection/detectionService.ts

# 日志事件
git log -S "detection.cache.hit" --oneline -- src
git grep -n "detection.cache.hit" -- src research
node --import ./scripts/ts-hook.mjs tests/verify-log-fields.js

# 冒烟（六条逐条跑，别用 npm run test:smoke：它首条失败就停，后面的看不见）
node --import ./scripts/ts-hook.mjs tests/smoke-client.test.js
node --import ./scripts/ts-hook.mjs tests/smoke-host.test.js
node --import ./scripts/ts-hook.mjs tests/smoke-host-dispatch.test.js
node --import ./scripts/ts-hook.mjs tests/smoke-render.test.js
node --import ./scripts/ts-hook.mjs tests/smoke-naming-persistence.test.js
node --import ./scripts/ts-hook.mjs tests/smoke-comment-passthrough.test.js

# 依赖现场
Get-ChildItem node_modules/.pnpm -Directory | Where-Object { -not (Get-ChildItem $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Select-Object -First 1) }
Select-String -Path pnpm-lock.yaml -Pattern 'is-potential-custom-element-name'

# #1138 早于 #1048
git merge-base --is-ancestor 64dfe6b7 f086a8e3; echo $LASTEXITCODE   # 0

# CI 与门禁入口
Get-Content .github/workflows/verify.yml
Get-Content scripts/verify-all.mjs
```

测量时的现场：HEAD 是 `40c222dd`，`git status --porcelain` 只有 7 份未跟踪的 `research/` 笔记（`1136-*` 五份、`1146-time-compress-unref-facts.md`、`1148-ownership-audit-options.md`），没有任何已跟踪文件处于修改状态（本文件写完之前）。调查开始时这个工作区有 95 条未提交改动（另一个会话正在批量把 `.js` 改名成 `.ts`），到 16:41 前后那批改动已经落盘，所以本记录引用的都是落盘之后的稳定状态。
