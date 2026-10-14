# #1136 决议：房间纪律那条规则怎么修，以及怎么让它以后不能再假绿

调查过程与四份路线报告在同目录：`research/1136-adversarial-graph.md`（依赖图与机制核验）、`research/1136-adversarial-firstprinciples.md`（第一性原理）、`research/1136-adversarial-coverage.md`（覆盖面）、`research/1136-adversarial-executability.md`（可执行性）。本文只写决议，以及作出决议所依据、我亲手复核过的事实。

## 一句话结论

这不是「路径写错了」这么简单。起点指向一个不存在的目录、白名单还是搬家前那份、喂给依赖图的根清单里根本没有 `src/tracker` 这棵树、门禁又只核对「十条规则都在、severity 都是 error」而从不过问规则有没有命中过任何模块——四件事叠在一起，才有「往房间里塞一条真跨房引用，门禁照样判绿」。所以本票要一次落四件：改对起点、补齐白名单、把 `src/tracker` 加进根清单、加一条真正有牙的防复发判据。只做第一件，结果要么是把假绿换成一个常红的门禁，要么是换成「白名单放宽到什么都放行」的更大假绿。

## 一、确认成立的问题（含推翻我自己先前的判断）

1. **直接成因在 git 里坐实**：`d0fdb277`（#1019 目录归位，动了 142 个文件）删掉 `src/host/tracker/backends/`，而相关名单里只有 `tests/gate-map.json` 与 `tests/same-layer-baseline.json` 两行——规则文件与所有 `verify-*` 一个都没跟着改。cross-room 起点命中从 63 个模块掉到 **0**。第一路核对时磁盘上该目录 `Test-Path` 为 False。
2. **假绿可复现，而且绿灯是写死的字符串**：往 `src/tracker/rooms/github/index.ts` 加一行 `import '../gitlab/index.js'`，门禁退出码 0，末行照样是「引用方向门禁通过（同层 …，房间纪律与禁循环零违规）」。那句「房间纪律零违规」来自 `tests/verify-dependency-rules.ts:637-640` 的固定字符串，与引擎结果无关。
3. **「搬家前有牙」只对一半，这解释了为什么三个月没人发现**：第一路在搬家前的提交 `95a1acfe` 上注入真跨房边（当时两房都是 `.js`），那条边 `couldNotResolve=true`、依赖类型 `unknown`，cross-room 仍然 0，只被「第三方包」那条规则吃掉（12→13），等于被错记成「引了第三方包」。**绿灯的样子没变，守的东西没了。** 顺带撤回第一路自己的一次初判：它在搬家前的检出上跑出的 exit=1 是「没跑构建」的假红——CI 是 `.github/workflows/verify.yml:59-60` 先 `node scripts/build.mjs`、`:63-64` 才跑门禁。
4. **只改起点会一次性涌出 62 条（4 个根）/ 80 条（补 `src/tracker` 为根）**，按目标分组是 contract 48、`preflight.ts` 26、`host/outbound` 2、`host/refresh` 1、`detection` 1、`error-rules.ts` 1、`identity-keys.ts` 1——**房间与房间之间的真跨房边是 0 条**，这 80 条全是白名单缺口。所以改起点不能单独发。
5. **引擎没有「规则零命中」信号**：dependency-cruiser **18.6.0** 的 `ruleSetUsed` 是把规则从 options 原样抄一遍（`node_modules/dependency-cruiser/src/analyze/summarize/index.mjs:182`），消费点只有四个 reporter。「报 0 条违规」与「判据写死」在输出上完全同形。所以防复发判据不是重造轮子，但必须自己写。
6. **根清单里没有 `src/tracker`**：`tests/verify-dependency-rules.ts:44` 的 `SCAN_TREES = ['src/host','src/shared','src/seam']`，可选根只有 `src/deck`（`:51`），送引擎的根由 `cruiseRoots()`（`:242-243`）拼、在 `:515` 使用。后果是盘上 65 个房间源码只有 **56** 个进图，缺的 9 个是 gitlab 房 8 个 `.js`（被当依赖扫到但 `followable:false`）与 `markdown/normalize.ts`。补根后模块 389→412（去重 301→316），房间起点命中 56→**65**。
7. **我自己在 triage 时提的防复发判据（「每条规则的起点在图上至少命中一个模块」）不成立**，两条路都证伪了：
   - 漏报：把起点改对、再把白名单放宽成 `^src/tracker/`、`^src/host/` 两行，规则命中 65 个房间模块、门禁 exit 0、末行照旧，注入的真跨房边被吃掉——白名单是单向的（只能压制、不能补充），抄宽的错误在判绿时不可观测，而「图上命中」这条判据照样判绿。
   - 误伤：`from: '^src/client/'` 在磁盘上有 208 个源码文件，图上 0 个模块（根清单只扫 4 棵树），它是一条正常规则，不是坏规则。
   - 根子在于「图上命中 = 磁盘存在 ∧ 解析成功 ∧ 根清单覆盖 ∧ 依赖装齐」，四项里三项是环境态：同一个提交，未构建时 176 文件 / 364 模块 / 12 条 unknown，构建后 212 / 396 / 3。
8. **两处我先前写错、已按实测更正**（原 triage 评论里的说法要一并作废）：
   - `tests/verify-gate-map.js` 今天**能**在跑过构建的检出上判绿——先跑一次 `node scripts/gate-map.mjs` 即可，85 条断言全过；代价是 `tests/gate-map.json` 那份 229KB 派生文件被重写。它今天在干净检出上红（6 条 FAIL，构建后 1 条）是另一回事，与本票根因无关。
   - 「`verify-no-mixed-session` 今天会真判红」不成立：它算 `base...head`，未提交改动算 0 个文件，实测 PASS。房间纪律的另一半仍然有牙，但票面那句表述要改。
9. **白名单今天 7 条里 2 条已死**（`^src/shared/labels\.js$` 盘上已无该文件、`^src/host/tracker/preflight\.js$` 对应今天 `src/tracker/preflight.ts`），而 `src/tracker/rooms/README.md:40-49` 与规则文件这两处**今天就不一致**（README 多 `canonical-labels.ts`、`preflight.ts`；配置多 `labels\.js$`）。
10. **同一份修好的配置在不同检出上给出不同的数**：4 个根 62 条、5 个根 80 条、`origin/main` 再往前走一步后 176 条（差 95 条集中在 `src/tracker/contract`，是 type 化后 JSDoc 里的 `import('...')` 变成边、叠上 `tsPreCompilationDeps: true` 造成的）。**两态的目标目录集合完全相同**，这正是「白名单按目录前缀写」能成立、而不必等迁移落地的原因。

## 二、我拍的决定

**决定 1（起点判据不写房名）**：`cross-room-import` 的起点写成 `from: { path: '^src/tracker/rooms/([^/]+)/' }`，同房间放行的 `pathNot` 第一项写成 `'^src/tracker/rooms/$1/'`；`room-imports-third-party-package` 的起点写成 `'^src/tracker/rooms/'`。
理由：仓里今天没有权威的房间登记表——`src/tracker/rooms/README.md` 的表、配置里的字面量、`scripts/matrix-full.js:110-112`、`tests/verify-no-mixed-session.js:21`（只登记 github 与 gitlab 两间房）四处互相不一致；写死 `(github|gitlab|markdown)` 会把这份不一致复制进判据，以后加一间房就要改第四处。第一性原理那路实测：`([^/]+)` + `$1` 与写死三房名的违规集合完全相同、同房误伤 0。**`$1` 是同房间放行的全部机制，不许改成不捕获的组。**

**决定 2（白名单一次补齐，按目录前缀写）**：最终 12 条，`ROOM_WHITELIST` 与 `src/tracker/rooms/README.md` 的房间纪律一节逐条一致：

```
^src/tracker/contract/                     契约层，三房唯一公共面（#1014 Q2）
^src/tracker/preflight\.(ts|js)$           归位前是 src/host/tracker/preflight.js（#326）
^src/tracker/error-rules\.(ts|js)$
^src/tracker/identity-keys\.(ts|js)$
^src/tracker/detection/workspace-ownership\.(ts|js)$
^src/shared/tracker/                       盘上仍在（11 个文件），文档里写着是给房间用的共享面；今天没有房间再引它，保留不动是「不顺手收紧」
^src/shared/label-color/                   #629
^src/shared/refresh/                       #711
^src/shared/config-store/                  #1012
^src/host/platform/                        #113
^src/host/outbound/                        搬家表：shared/tracker/outbound-*.js → host/outbound/
^src/host/refresh/                         搬家表：shared/refresh/chain-ride.js → host/refresh/
```

删掉两条死条目：`^src/shared/labels\.js$`、`^src/host/tracker/preflight\.js$`。
单文件条目写成 `(ts|js)` 两种后缀、目录条目只写目录前缀：同一份源码在已构建与未构建的检出上会分别解析到构建产物与源码，写死 `.ts` 会在已构建的检出上漏判（第四路实测：只把白名单按目录前缀写，cross-room 从 80 压到 0）。每条后面写清来由。

**决定 3（`src/tracker` 进根清单）**：`SCAN_TREES` 补上 `src/tracker`，让房间的 `.js` 半边也进图，房间覆盖数从 56/65 变成 65/65。
这是一次**非中性**改动：别的规则判域会从 364 个模块涨到约 420 个（第一性原理那路专门标了这一点）。所以要求执行者把八条规则的违规数改前改后各跑一遍，有变化就在票里写清是哪些、为什么，不许默认无害。

**决定 4（防复发判据：按磁盘判空 + 正控 + 负控，否决「图上命中」）**：写进 `tests/verify-dependency-rules.ts`，对每条 `severity: 'error'` 的 forbid 规则：
1. **作用域非空按磁盘判**：`from.path` 必须匹配 ≥1 个磁盘上存在的源码文件（`git ls-files` / `existsSync`），否则判红并提示「起点可能仍指向搬家前的旧目录」。`from` 为空的规则跳过（今天只有 `circular-dependency`）；只约束未来文件的规则必须显式登记 `intentionalEmptyScope` 加理由与票号，不许静默留空。
2. **正控（有牙）**：注入一条确定违规的边，断言判红且点名该边；**注入目标必须落在该规则所有合法目标类之外**（房间规则就注入别房的源码模块），否则白名单一放宽，正控自己就假绿。
3. **负控**：注入一条确定合法的边，断言不判红（例如同房间引用）。
4. **白名单可核对**：`ROOM_WHITELIST` 每条必须在磁盘上匹配到至少一个源码文件，一条都匹配不到就判红——死条目以后当场可见。
5. **打印但不判红**：每条规则的图上命中数、房间进图数 / 磁盘数（今天 56/65，改完 65/65）。
实现边界：`from` 是 `{}` 的规则跳过；`from.pathNot` 为空时当没写——仓库原文里 `deck-deep-import` 是**空数组**（`const DECK_DEEP_IMPORT_WHITELIST = []`，`.dependency-cruiser.cjs:46`；第四路报告写成「空字符串」，以原文为准）：空数组、空字符串、字段不存在三种形态都当没写，拿去当正则会匹配一切→假红；`from.pathNot` 可能是字符串而不是数组，不许直接调数组方法。②③ 用仓内夹具或临时配置做，跑完不留痕。**不新增配置里的规则**，所以 `EXPECTED_RULES`（`:58-69`）不用动。

**决定 5（绿灯行报分母）**：`:637-640` 那句改成报出分母，例如「房间纪律零违规（命中 65 个房间模块 / 65 个在图上）」。分母为 0 时一眼可见，比再加一条自检更便宜，也是这次假绿最直接的报警器。

**决定 6（那 22 条边先登记，不搬代码）**：房间今天引的 `preflight.ts`（19 条）、`error-rules.ts`、`identity-keys.ts`、`detection/workspace-ownership.ts`（各 1 条），以及 `host/outbound/`（2）、`host/refresh/`（1），本票一律按共享件登记进白名单，**不搬进契约层**——搬代码要同时改三间房，而这三间房此刻正在别人手里做 `.js`→`.ts` 迁移（#1064）。「这 22 条边该不该搬进契约层」「反方向规则要不要立」这两个是设计取舍，不在本票改。

**决定 7（gate-map 不进本票验收）**：只留一句操作提示——改完 `tests/**` 后要跑一次 `node scripts/gate-map.mjs` 再跑 `tests/verify-gate-map.js`（这是机械重生成，不是本票要修的缺陷）。生成物与新鲜度门禁的存废归 **#1124**，它正文写着「生成物若保留，只作人读报告，不进任何判据」。

**决定 8（不等迁移，但要对齐并发改动）**：不必等 #1064 那 42 个房间文件迁移落地——白名单按目录前缀写，两态都成立（决定 2 的理由）。但基线要用**当前** `origin/main`（本文写下时是 `5e1ab300`，票面原来钉的是 `474602bd`，已落后 5 个提交），并且动手改 `tests/verify-dependency-rules.ts` 之前先看 **#1148** 是否还在改这个文件（它一小时内落过两个提交，动的正是同一份门禁的归属对账）。

## 三、要落的改动

**A. 跟踪器（本票 #1136）**
- 正文重写：保留现象、证据、影响、关联；把「证据第 4 条」「验收第 2 条」「修的时候要注意」换成执行口径与新的验收清单；未确认的三条改成已决议。
- 发一条决议评论，把本文的决定逐条落到票上（AI 写的评论要标明）。
- 标签保持 `bug` + `ready-for-agent`。

**B. 跟踪器（不在本票做，另立票）**
1. **#1152**：`src/tracker/**` 整棵树没有任何「同层互引」判据（`same-layer-import-host` 的 `from` 只写 `^src/host/`），树内非房间件互引 22 条无人判；同一个词横跨两棵树（`src/host/tracker` 5 件仍受管、`src/tracker` 99 件不受管）。
2. **#1153**：`room-imports-third-party-package` 把「解析不到的边」（`unknown` / `undetermined`）当第三方包：同一个提交在未构建检出上多报 9 条、构建后 0 条；房间引的共享件写成产物路径（`scripts/ts-hook.mjs` 只改同目录 `./x.js`→`./x.ts`），CI 先构建看得见、人看不见。
3. **#1154**：归位之后残留的旧路径表述：91 个文件仍写着 `tracker/backends`（含 `scripts/matrix-full.js:110-112`、`tests/verify-no-mixed-session.js:21` 只登记两间房、`tests/verify-deck-tools-host-wiring.js:41,46` 里 54 条永不匹配的房间登记、`tests/handwritten-js-baseline.json:245-307` 的 125 条陈旧条目）。#1118 已关闭，这些今天没有归属。

**C. 本地文件**
- 本文（`research/1136-adversarial-decision.md`）与四份路线报告。
- 不动业务代码：本票的修复由拿到 `ready-for-agent` 的执行者做。

**D. 明确不在本票做**：搬契约层、立「反方向」规则（`.dependency-cruiser.cjs:147-152`）、白名单改成带票号的结构化登记表、`^src/client/` 这类「判域不在根清单里」的规则怎么登记、`verify-gate-map` 转绿、91 个文件的路径刷新、`tests/verify-no-mixed-session.js` 的口径改动。

## 四、落地记录

- 2026-10-14：四路对抗式审查全部交卷（依赖图 35,978 字节 / 第一性原理 36KB / 覆盖面 48KB / 可执行性 8 节），主工作树在这轮调查里只新增这五份研究笔记，业务代码一行未改。
- 2026-10-14：本决议写入 `research/1136-adversarial-decision.md`；#1136 正文按执行口径重写（现象/证据/影响保留并标注两处更正，新增「决议」「执行口径」「验收」三节），决议评论落票（含三处自我更正与留给维护者的三件待拍板），标签由 `wayfinder:grilling` 换成 `wayfinder:task`（地图子票各带一个 wayfinder 标签），`bug` 与 `ready-for-agent` 不变。
- 2026-10-14：本文第三节 B 的三件另立成票——**#1152**（同层互引判据在 `src/tracker` 缺席）、**#1153**（第三方包规则把「没解析出来」当第三方包）、**#1154**（归位残留的旧路径表述没有归属），三张都挂在 #1013 下。
- 2026-10-14：本轮从头到尾没改业务代码；主工作树的改动只有这五份研究笔记（本决议 + 四份路线报告），其余 79 个未提交文件是别人正在做的迁移与 #1148 的收尾，没有碰。
