# 1167 降级原因门禁为什么从 #1147 起一直是红的：一次只读取证

> 这是一次只读调研的记录。核对时间是 2026-10-14 19:30 前后（Asia/Shanghai），工作区 HEAD 是提交 `bb084b23`（19:20:01）。
> 每一条结论都写了文件路径加行号，或者写了当时跑的命令和实测输出。没有亲手读到、跑过的东西一律写「未核实」，不猜。
> 本次没有改动任何源码、测试或脚本，唯一新增的就是本文件。

## 零、结论先说清

1. 门禁 `tests/verify-rest-fallback-reason.js` 今天整份跑不起来，退出码 1，只打两行 FAIL。
2. 根因是它把真源的**整份文本**当函数体交给 `vm.compileFunction` 求值；而这份真源在 #1147 里被加进了一行 `import type`，函数体里出现 `import` 就当场抛错。
3. **票面有一处事实要改**：`.js → .ts` 的改名不是 #1147 干的，是 #1019 干的，而且是一次 R100 纯改名（内容逐字节不变）；#1147 只是**修改**了那时候已经是 `.ts` 的那份文件。真正弄坏门禁的是那行类型 import，不是改名。
4. 它不在 `package.json` 的验证链上，而 `npm test`、全链脚本、CI 三处都只认这条链，所以三处都跑不到它。
5. 在本次扫到的同类候选里，红的只有它一份。

## 一、被推翻的、被确认的、没 settle 的

### 已被推翻

- **票面原话：「这份源在 #1147（提交 `2482604f`）里从 `.js` 转成了 `.ts`」——推翻了。**
  三条证据叠在一起：
  1. `git show --name-status -M --format="" 2482604f` 里与这份源有关的只有一行 `M src/tracker/rooms/github/fallback-reason.ts`（是修改，不是改名）；
  2. `git ls-tree 2482604f^ src/tracker/rooms/github/` 在**父提交**里就已经有 `src/tracker/rooms/github/fallback-reason.ts`（blob `2288819…`），提交后变成 blob `80dc270…`；
  3. `git log --diff-filter=R -M --name-status -- '*fallback-reason*'` 给出改名那一次是 `d0fdb277`（2026-10-13，「目录归位：deck 工具与 tracker 三房按目标树一次搬完（#1019）」），记录是 `R100 src/host/tracker/backends/github/fallback-reason.js → src/tracker/rooms/github/fallback-reason.ts`。R100 意思是相似度 100%，也就是除了文件名什么都没动。
  `git show --numstat -M --format="" 2482604f` 显示这次修改是 29 行新增、5 行删除。
  这一处对修法有影响：纯改名永远不会弄坏按文本求值的门禁（文本没变），坏的是那行类型 import。
- 顺着这条，「转写当时没同步改这份测试，于是门禁从那天起一直红着」里的「转写」如果指的是改名，就解释不了红；红的起点是 #1147 那一次修改。

### 已被确认

- **现象逐字复现。** 在仓库根跑 `node tests/verify-rest-fallback-reason.js`，退出码 1，输出就是票面那两行：

  ```
  FAIL 求值 fallback-reason.js 拿不到 pickFallbackReason：Cannot use import statement outside a module
  FAIL 没有 pickFallbackReason 这个分类函数
  ```

  实测环境 Node v24.19.0。

- **机制，一手读到。** `tests/lib/eval-probe.js:55-56`：

  ```js
  function compileFn(params, body) {
    return vm.compileFunction(String(body), splitParamNames(params), { filename: 'eval-probe.js' })
  }
  ```

  也就是说传进去的文本**就是函数体**。而 `src/tracker/rooms/github/fallback-reason.ts:12` 是：

  ```ts
  import type { OpContext } from '../../contract/contexts.js';
  ```

  门禁 `tests/verify-rest-fallback-reason.js:32` 读这份源的全文，`:35` 用两条正则剥掉行首的 `export`，`:37` 把剩下的**整份文本**当函数体交给 `compileFn`。函数体里出现 `import` 就抛「Cannot use import statement outside a module」，`:38-40` 捕获后只打一行 FAIL，`:41-44` 直接 `process.exit(1)`。
  被剥掉的只有 `export`，`import`、`interface`、类型标注都留在文本里——这正是票面记的「已经试过、没走通的修法」走不通的原因。

- **红从 #1147 起（这一段严格说只核到分类函数那一关）。** 把 `git show 2482604f^:src/tracker/rooms/github/fallback-reason.ts` 取出来的**转换前文本**喂给同一个 `compileFn` 转换逻辑（同一个剥 `export` 的正则、同一个调用方式），能求值出 `pickFallbackReason`，三条断言全过：

  ```
  限流文案 → rate-limit
  非配额 403 → graphql-error
  EOF → graphql-error
  ```

  转换前那一版里没有 `import`、没有 `interface`、没有 `type` 行，只有四个 `export`（`readGhHost`、`isGheHostName`、`pickFallbackReason` 与一行 `export default`），`git show 2482604f^:… | Select-String '^\s*import|^interface|^type '` 一条也没命中。
  **这句话的边界写在这里**：我核到的是「#1147 之前分类函数那一段能求值、三条断言全过」。要说「整份门禁从 #1147 起才是红的」，还需要「#1147 之前后两段也是绿的」；而后两段我只验了**今天**是绿的（见下一条），没有回到 `2482604f^` 那一刻验。所以「绿的起点」这一半是实测，「之前从没红过」这一半是推断。

- **整份门禁今天一条断言都没跑，不是只坏了前半。** 第一个 `process.exit(1)` 停在 `tests/verify-rest-fallback-reason.js:43`，所以 `:46-50` 三条原因分类断言、`:69-92` 八条选句断言、`:94-120` 的词条与产物断言全都没被执行过。运行输出里只有那两行 FAIL，没有任何 PASS。
- **后半段一旦被执行是通的。** 我照 `:54-68` 的原文把 `src/client/views/shared/truthLines.js` 取出来（这份文件至今没有顶层 `import`，`:141-161` 的 `restFallbackView` 仍是普通 JS），配同样的五个替身跑 `:77-92` 那八条断言，八条全绿：新鲜 quota → `list.restFallback`；新鲜的 other / 缺原因 / 原因显式为 null → `list.restFallbackNonQuota`；超一小时的 quota → `list.restFallbackStale`；超一小时的 other / 没给时刻 → `list.restFallbackStaleNonQuota`；干净快照 → `null`。
- **第四段的前置条件今天也齐备。** `:94-112` 要的四个词条在 `src/client/kernel/locale-*.js` 里各命中 2 处（中英各一条）；`:113-120` 要的两份产物 `client.js` 与 `package/lib/client.js` 今天都存在，且都含 `list.restFallbackNonQuota` 与 `fallbackReason`。（这只说明跑到那一段时它不会因为前置缺失而红；那一段本身没被执行过。）
- **它不在验证链上。** `package.json` 的 `scripts.verify` 今天是一条 245 步的长命令，里面搜不到 `verify-rest-fallback-reason`；仓库里除了它自己的文件头、它自己的注释和 `tests/verify-rest-fallback-banner.js:54` 的一句注释，没有任何地方引用这个名字。
- **三处入口都只认那条链。** `scripts/verify-all.mjs:20-26` 读 `package.json` 的 `scripts.verify` 并注明「名单只有这一个来源，不另抄一份」；`docs/agents/verification.md:13-15` 写着同一条：「`package.json` 的 `scripts.verify`……**这是门禁名单的唯一来源**」。所以 `npm test`、`node scripts/verify-all.mjs`、CI 都跑不到链外的这一份。
- **链上的步骤会自动挂 TypeScript 装载钩子。** `scripts/verify-all.mjs:34-38` 的 `withTsHook` 只对形如 `node tests/…` 的步骤加 `--import scripts/ts-hook.mjs`，注释里写明同一个判定分散在四个入口（`scripts/verify-chain.js`、`scripts/verify-parallel.mjs`、本文件、`package.json` 的 `test:smoke`）。所以挂上链之后这一步会自动拿到钩子。
- **覆盖面账本不会报这个洞。** `tests/gate-map.json` 里 `src/tracker/rooms/github/fallback-reason.ts` 出现在 `verify-error-single-source.ts` 的守卫名单里（该条目的 `guards` 数组，约 `:4898`），而这张表的 `ungated` 是空数组（`tests/gate-map.json:6795-6796`，`ungatedFileCount` 为 0），`tests/verify-gate-map.js` 的覆盖面那一条今天全绿（我跑过整份，退出码 0，85 条断言）。也就是说：没有任何一条会因为「这份源没人守」而变红。

### 没 settle（说清边界，不猜）

- **我没有逐份跑完全部走共用求值入口的测试**（`tests/lib/eval-probe.js` 的 `compileFn` / `evalWithScope` / `evalInWindow` 合计六十来处调用，其中不少要起 jsdom 或先跑构建）。我扫的是「引用了 `eval-probe` 又按字面路径读 `src/**.ts`」这个交集，19 份，逐份看了在不在链上、不在链上的亲手跑。**用变量拼路径、或路径从别处传进来的调用方可能落在这次扫描之外。** 所以下面表格里那句「红的只有它一份」只在这 19 份的范围里成立。
- 我也没有回到 `2482604f^` 那一刻去验后两段（原因见上）。

## 二、影响范围（实测）

扫描口径：在 `tests/` 下找「文本里出现 `eval-probe`」且「文本里出现按字面写的 `src/**.ts` 路径」的文件，再逐份判在不在链上。

| 文件 | 在链上 | 实测 |
| --- | --- | --- |
| `tests/verify-rest-fallback-reason.js` | 不在 | **红**（退出码 1，只两行 FAIL） |
| `tests/verify-b2-map-newsession.js` | 不在 | 绿（退出码 0，2/2 文件通过） |
| 其余 17 份（`verify-656` / `verify-663-gh-install-inject` / `verify-665` / `verify-669-choice-precedence` / `verify-683-host-wiring` / `verify-chain-env-e2e` / `verify-chain-view` / `verify-issue297` / `verify-label-color-core` / `verify-map-drill` / `verify-multi-effort-panel` / `verify-newsession-blank-seed-315` / `verify-newsession-preset-guard` / `verify-newsession-workspace-fallback` / `verify-parse-leaf` / `verify-prompts` / `verify-visible-truth`） | 都在 | 未逐份跑；它们在链上，真坏了会在 CI 现形 |

**坏与不坏的分界线**：`tests/verify-chain-view.js`（在链上、我实测绿）也走 `compileFn` 吃 `.ts` 真源，但它是把 `src/tracker/identity-keys.ts` 里**一个个函数**用正则切出来再求值（该文件 `:55-57`），所以顶层 `import` 不会落进函数体。本票这一份是把**整份文件**当函数体，只要顶层有任何 `import`、`interface`、类型标注就必死。也就是说：这是「整份文件当函数体」这类写法的毛病，不是「compileFn 碰上 .ts 就坏」。

两处对外的依赖与邻票：

- **链上另一扇门承认这块归它管。** `tests/verify-rest-fallback-banner.js:54` 写着「缺原因的中性档由 verify-rest-fallback-reason.js 钉住」。那扇门本身是绿的（我跑过，退出码 0）。它把「非配额降级走中性句」这一部分保证转交给了本票这一扇。
- 同一类毛病有先例：`research/662-gates-survey.md:208`（#662 那次门禁调查）记过「四道不在链上，其中两道已经是红的」。
- 同一场 `.js → .ts` 迁移留下的邻票：#1116（夹具按 `.js` 找兄弟文件，而它只以 `.ts` 存在）、#1165（新门禁没上链）、#1166（手写 `.js` 测试被棘轮判红）。机制层面的治理在 #1121 / #1122 / #1125。

## 三、修法可行性（只取证，不实施）

票面建议的修法（改成直接引真源）**站得住**，但要留意说明符怎么写，因为它决定「人手单跑」能不能成功：

- **一般规律：裸跑一个 import 真 `src/` 源码的 `.ts` 门禁会失败。** 我实测 `node tests/verify-github-gh-via.ts`（在链上的一份 `.ts` 门禁）：裸跑是 `ERR_MODULE_NOT_FOUND`，挂上 `--import ./scripts/ts-hook.mjs` 再跑退出码 0。原因是真源内部用 `.js` 说明符引兄弟文件，Node 自己不会把它解析到同目录的 `.ts`，只有 `scripts/ts-hook.mjs` 会。
- **但本票这一份真源是个例外，裸跑能成。** 它唯一的 import 是 `import type`（加载时会被剥掉），没有别的运行时依赖，所以显式写出 `.ts` 结尾就能裸跑。两种写法我都实测过：
  - `node -e "const m = require('./src/tracker/rooms/github/fallback-reason.ts'); …"` → 拿到函数，返回 `rate-limit`，退出码 0；
  - `node --input-type=module -e "const m = await import('./src/tracker/rooms/github/fallback-reason.ts'); …"` → 同上。
- 因此：验收标准里那句「`node tests/verify-rest-fallback-reason.js` 退出码 0」**只在用显式 `.ts` 说明符时才成立**；写成 `.js` 结尾就需要钩子，人手裸跑会红。挂上链之后两种写法都能跑（链会自动挂钩子），差别只在人手单跑。
- **后半段建议照旧，别一起改。** `truthLines` 那一段走文本求值是有理由的：`restFallbackView` 的自由变量（`freshnessLevel`、`PATCH_MERGE_WINDOW_MS`、`lagPromiseFor`、`PROBE_INTERVAL_MS`、`idOfParts`）本来就要靠参数名注入替身，直接把那份文件当模块引进来会缺这几个名字。它今天八条全绿，没有非改不可的理由。
- **挂了链之后要跟着办的三件事**（都写在 `docs/agents/verification.md`）：① `:163-170` 链一变就要重跑 `node scripts/gate-map.mjs` 重录归属表，否则 `tests/verify-gate-map.js` 的新鲜度断言会红；② `:172-182` 加新门禁的四步（`check(ok,msg)` 逐条断言、可选写 `// 门禁归属:`、请维护者加进链、重跑归属表）；③ `:178` 那句原文是「请 `package.json` 的维护者把它加进 `scripts.verify`。本仓 `package.json` 只有一位写者，别自己动」。
- **转成 `.ts` 的话要动的账本**：`tests/unmigrated-tests-baseline.json`（本文件在 `:301` 有它；消费方是 `tests/verify-unmigrated-tests.ts:31`，判据是「今天树上的旧语言文件必须是基线的子集」，迁移之后可以 `--record-baseline` 重录）与 `tests/handwritten-js-baseline.json`（在 `:681` 有它；消费方是 `scripts/typecheck.mts:51`，棘轮「只许减不许增」，少一条走信息级的「棘轮已缩」，见 `research/1013-src-host-type-config.md:57`、`:129`）。

## 四、反证要改哪里（票面验收标准 3）

票面写的「把选句改坏（所有原因都说配额句）」落在 `src/client/views/shared/truthLines.js:152`：

```js
const isQuota = (snap.fallbackReason === 'quota')
```

把它改成恒真（`const isQuota = true`）之后，`:158` 的四选一会全部走配额句，于是门禁 `:80-85`、`:88-91` 那五条中性句断言会红。今天这个反证是**失效**的——门禁跑不到那一段就退出了。

如果想连前半段也做反证，要动的是 `src/tracker/rooms/github/fallback-reason.ts:66` 那条限流正则（`:65` 是 timeout、`:67-70` 是企业版主机、`:72` 是兜底的 `graphql-error`）。把 `:66` 放宽成恒真，门禁 `:48-50` 两条「不算限流」的断言会红。

## 五、仓库规矩里与本票直接相关的几条（都读到原文）

- `docs/agents/verification.md:11-22`：链是门禁名单的唯一来源；`tests/` 下有 303 份 `verify-*` 脚本，挂上链的是 228 份，没挂的是本地排查用的、不会在提交前自动跑。
- `docs/agents/verification.md:150-170`：重跑归属表的时机与命令。
- `docs/agents/verification.md:172-182`：加一扇新门禁的四步，含「请维护者加进链」与「自己跑一遍确认它能红也能绿——一扇永远绿的门禁比没有门禁更糟」。
- `AGENTS.md`：手写代码一律优先 TypeScript，存量 JS「动到哪里就转到哪里」，以文件为单位**先修后转、两次提交**。
- `docs/agents/triage-labels.md:9-25`：五个分流标签的字符串与含义。

## 六、动手之前要知道的一件现场情况

**核对这一刻，工作区正在被别人改，而且改的正是本票要碰的那几份。** `git status --short` 当时给的是：

```
 M src/host/publishFlow.ts
 M tests/unmigrated-tests-baseline.json
R  tests/verify-1150-plan-store-durable.js -> tests/verify-1150-plan-store-durable.ts
```

同时 HEAD 在我核对期间前进到了 `bb084b23`（19:20:01）。也就是说：**「未迁移测试基线」和「某份测试改名成 `.ts`」这两件事正在被另一手同时做** —— 这正是 #1150 / #1165 当初把「挂链 + 重录归属表」推迟掉的那个理由（见 #1165 正文「同一份工作区里有另一批在途的手写 JavaScript 转 TypeScript 改动正在改链上步骤与 `tests/gate-map.json`」）。
所以本票第 2、3 步（挂链、重录归属表）与「顺手转 `.ts`」都要**排在那一批落地之后**，否则会在 `package.json`、`tests/gate-map.json`、`tests/unmigrated-tests-baseline.json` 三处三方并写。

## 七、本次读过的材料与跑过的命令

一手读过的文件：`tests/verify-rest-fallback-reason.js`（123 行全文）、`tests/lib/eval-probe.js`（78 行全文）、`src/tracker/rooms/github/fallback-reason.ts`（75 行全文）、`src/client/views/shared/truthLines.js`（141-161 行）、`tests/verify-gate-map.js`（前 70 行）、`scripts/verify-all.mjs`（前 45 行）、`docs/agents/verification.md`（1-40、140-199 行）、`docs/agents/triage-labels.md`（全文）、`tests/verify-unmigrated-tests.ts`（前 60 行）、`tests/verify-rest-fallback-banner.js`（相关行）、`tests/gate-map.json`（相关条目）、`research/662-gates-survey.md:196-211`、`research/1013-src-host-type-config.md:57`、`:129`。

跑过的命令（都在仓库根）：`node tests/verify-rest-fallback-reason.js`；`node tests/verify-rest-fallback-banner.js`；`node tests/verify-gate-map.js`；`node tests/verify-github-gh-via.ts`（裸跑与挂 `--import ./scripts/ts-hook.mjs` 各一次）；`node --import ./scripts/ts-hook.mjs tests/verify-b2-map-newsession.js`；两个 `node -e` 裸引 `.ts` 真源的探针；把 `2482604f^` 那一版真源文本喂给同一套 `compileFn` 转换逻辑的探针；照 `:54-68` 原文单独跑后半八条断言的探针；`git show --name-status -M`、`git show --numstat -M`、`git ls-tree`、`git log --diff-filter=R -M --name-status`、`git log -S`、`git status --short`。
