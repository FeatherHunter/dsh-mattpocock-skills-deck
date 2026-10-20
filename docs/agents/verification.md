# 门禁怎么挑、怎么跑

这份文档写给第一次接手这个仓库的人。它讲清四件事：仓库里的门禁分几档、每档什么时候跑；
「按这次改了哪些文件来挑门禁」这套规则是怎么定的；这套规则有哪些已知漏洞；以及怎么重跑归属表、
怎么加一扇新门禁。第五节最后还有一小节「读一扇大门禁」，讲上下文有限时怎么只看判据、不整份读。

文中的具体数字（多少步、覆盖多少文件）取自 2026-10-12 与 2026-10-20 的实测，只用来帮你建立数量感；
链还在变长，你读到的时候数字多半已经不一样了，跑一次 `node scripts/gate-map.mts --print`
就能看到当前的值。推算以准的只有两处：链的名单与阶段在 `scripts/verify-stages.json`，
归属表是生成出来的 `tests/gate-map.json`。

## 一、先认清三样东西

- **`scripts/verify-stages.json`**：链的名单与阶段（目录约定加显式排除表，#1125）。每一步形如
  `node tests/verify-xxx.ts`，跑的是 `tests/` 下一个独立的 Node 脚本。**这是门禁名单的唯一来源**，
  由 `scripts/lib/discover-gates.ts` 的 `planGates()` 算出：`tests/` 下符合 `verify-*` 命名的脚本
  自动被发现，按阶段表的 `match` 归段，默认落在 `match` 为空的那一段。`package.json` 的
  `scripts.verify` 现在只是 `node scripts/verify-chain.ts` 一句，别在别处再抄一份清单——抄一份就一定会跟它走散。
- **`tests/gate-map.json`（门禁归属表）**：生成物，回答「每一扇门禁守着哪些源码路径」。
  由 `node scripts/gate-map.mts` 扫描生成，**不要手工改**。
- **`scripts/lib/select-gates.mts`（挑选规则）**：回答「这次改了这些文件，该跑哪些门禁」。
  输入是改动清单，输出是 `verify` 链上该跑的那些步，外加每一步被选中的理由。

门禁本身是 `tests/verify-*`。当前 `tests/` 下有三百来个这样的脚本，挂在链上的约三百步；
没挂上的是本地排查用的，不会在提交前自动跑。

## 二、门禁分三档

| 档 | 怎么跑 | 什么时候跑 |
| --- | --- | --- |
| 快档（只跑一扇或几扇） | `node --import ./scripts/ts-hook.mts tests/verify-xxx.ts`；按名字抽查用 `node scripts/verify-chain.ts --only <文件名里的一段>` | 写代码的过程中，改一处验一处 |
| 受影响档（只跑这次改动碰得到的门禁） | `npm run verify:changed`（读 git 里这次的改动清单）或 `node scripts/lib/select-gates.mts <改了哪些文件...>`（自己报改动清单） | 一个模块写完、提交之前自查 |
| 全链档（约三百步全跑） | `npm run verify:parallel`（8 路并发，红也跑完再汇总，失败的那几步会自动串行重跑一次以排除互相干扰） | 提交之前、推送之前，**每次都要跑** |
| 全链·串行 | `node scripts/verify-chain.ts`（第一扇红了就停，方便先修）或 `node scripts/verify-all.mts`（全部跑完再汇总） | 想按顺序看输出、或者并发下出过怪事时用 |

2026-10-12 的实测（28 核机器）：当时 228 步串行 517 秒；8 路并发在源码没动过时约 36 秒，
源码刚改过（要真跑一次构建）时约 66 秒。链今天约三百步，量级不变，绝对值会跟链长一起涨。
并发跑的日志里每一步的起止与耗时都打了时间戳；并发跑红的步骤会自动串行重跑一次，
重跑才红的会被标成 `flaky`（说明是并发互相干扰，不是代码坏了），重跑仍然红才是真红。

并发跑得快，靠三件事，都不改任何一条断言的判据：

1. **慢步在等，不在算。** CPU 采样显示最慢那扇 31.8 秒里 31.7 秒是 idle，所以并发几乎能线性省时间。
2. **按耗时从长到短排程，互斥的步骤合成一节车厢。** 每步上一轮的实测耗时记在
   `node_modules/.cache/dsh-verify-times.json`（不进版本库）；会互相抢资源的步骤（`npm pack`、真跑构建）
   合成一节车厢，由同一个工人依次跑完，免得两个工人同时 `npm pack` 造成假红。车厢最前面会先跑一次
   预构建，后面的门禁就都命中构建缓存，也不会读到半旧产物。看排程用
   `node scripts/verify-parallel.mts --tasks`。
3. **构建有缓存。** `node scripts/build.mts` 会先比「手写输入的内容指纹」与「上次成功构建的产物哈希」，
   两者都没变就跳过这 30 秒（链上有十几扇门禁各自跑一次构建）。缓存落在 `node_modules/.cache/dsh-build.json`，
   要强制重建用 `node scripts/build.mts --force`。判定口径是「产物与上次成功构建逐字节相同」，
   不是「构建没跑过所以不知道」；输入变了、产物被人改过删过，都会照常完整重建。

三档不是三选一，是三层筛子：写代码时用快档，模块收尾用受影响档，**提交前必须用全链档**。
下面第四节会说明为什么受影响档一定不能替代全链档。

## 三、挑选规则（完整版）

`selectGates({ changedPaths, map, chainSteps })` 返回
`{ steps, reasons, fullChain, fullChainReason }`：`steps` 是 `verify` 链上该跑的步骤（按链上的原顺序），
`reasons` 与 `steps` 一一对应、写清每一步为什么被选中，`fullChain` 为 `true` 时表示「别挑了，整条链都跑」。
整套规则**处处往「宁可多跑，不许漏跑」的一侧偏**：拿不准就多跑几扇，绝不猜着少跑。

**规则 1：改的是横切文件，直接跑全链。** 命中任意一条就 `fullChain: true`：

- 仓库根目录下的文件（构建入口、发布清单、仓库配置——根目录的东西谁都在用）；
- `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`；
- 任何位置的 `tsconfig*.json`；
- `scripts/**`（生成器、发布脚本、检查链自己）；
- `tests/**`（门禁与测试夹具）；
- `docs/**`、`research/**`、`specs/**`，以及任何位置的 `*.md`；
- `package/**`（构建产物）；
- `src/**/contract/**`（契约层——它是跨模块的约定，改一处几个模块一起受影响）。

**规则 2：改的是有归属的源码文件，按目录层层上溯选门禁，再加反向依赖。**

- 取这个文件所在的目录，沿父目录一路上溯到仓库根，例如
  `src/client/views/versionControl/VersionControlTab.ts` 会走出
  `src/client/views/versionControl` → `src/client/views` → `src/client` → `src` → `.`；
- 归属表里这些目录**各自直接守着**的门禁全选上。注意是「各自直接守着」而不是「含子目录累计」：
  改 `src/client/views/versionControl/` 不会连带选中只守 `src/client/views/cards/` 的门禁，
  这正是维护者要的「改 E 跑 E、B、A 三层，不碰兄弟目录 C、D」；
- **再加反向依赖**：谁的 import 图里能走到这个文件（直接或传递），守着那些文件的门禁也要跑。
  这一步是关键。`src/shared/refresh/src/budget.ts` 就被好几个模块直接 import，还有更多模块间接依赖它；
  光按目录走，改了它只会跑守 `src/shared/refresh/src/` 的那几扇，上层消费者坏了本地看不到。

**规则 3：改的文件没有归属，跑全链。** 「没有归属」是指它所在目录在归属表里查不到任何门禁
（目录键不存在，或者对应的是空列表）。没人看着它，就猜不出影响面，只能全跑。

**规则 4：改的是门禁或测试自己。** `tests/**` 已经在规则 1 里命中，整条链都会跑，那扇测试自然在里头。

**规则 5：只验构建产物的门禁跟着源码一起跑。** 有几十扇门禁只读 `package/` 下的产物
（例如 `tests/verify-958-label-name-visible.ts` 读 `package/lib/client.js`）。
脚本看不出产物是哪个源码文件编出来的，所以只要这次动到了源码，这些门禁一律跟着跑。

补充两条边界：改动清单为空（比如你没传参数）按全链处理；传进来的路径既支持
`src/client/kernel/styles.ts` 这种仓库相对路径，也支持从仓库根写起的 `./src/client/kernel/styles.ts` 和反斜杠写法。

**一个真实例子**（改 `src/client/views/versionControl/VersionControlTab.ts`）：
选中 75 步 / 全链约三百步。这 75 步是几路来源并起来的结果（取并集，不是相加）——守
`src/client/views/versionControl/` 的那几扇、守 `src/client/views/` 的、守 `src/client/` 的、守 `src/` 的，
加上反向依赖这个文件的那些门禁，最后并上只看构建产物的那几十扇。改一个文件就从约三百步降到 75 步，
而守这几层的门禁一扇不少。同一张表里，改 `src/shared/refresh/src/budget.ts` 这种底层共享模块要跑 156 步——
比 75 多得多，因为反向依赖把上游消费者都拉了进来，这正是它该有的样子。

命令行直接看挑选结果（人读得懂的那种输出）：

```
node scripts/lib/select-gates.mts src/client/views/versionControl/VersionControlTab.ts
```

改动清单通常来自 `git status --porcelain` 或 `git diff --name-only` 的输出。

## 四、这套规则的已知漏洞

**这些漏洞都真实存在，而且都验证过，所以提交前必须跑一次全链。** 受影响档是用来省时间的，
不是用来替代全链的。

1. **动态拼出来的路径认不出来。** 归属是从门禁文件里的**字符串字面量**推的；
   路径一旦是拼出来的（变量、模板串、从配置里读出来的目录名），脚本就看不见它读的是什么。
   真实例子：`scripts/gen-fixture-423.ts` 从 `src/client/kernel/styles.ts` 里抽出 CSS 规则，
   生成夹具 `tests/fixtures/423-clamp-repro.html`，而门禁 `tests/verify-423-title-clamp-browser.ts`
   只读那个 html 夹具。于是你改了 `styles.ts`，这扇浏览器门禁**不会被选中**——
   它守着的路径落在 `tests/fixtures/` 下，跟 `styles.ts` 之间没有任何一条字面量线索。
   识别不出来的门禁在表里会被标成「没有源码归属」：按目录挑的时候永远轮不到它，
   只有整条链全跑时才会跑到它。兜底也救不了它——兜底看的是**你改的那个文件**有没有归属，
   而这类门禁的问题出在**门禁自己**说不清守着谁。
2. **构建产物与源码的对应关系看不出来。** 有几十扇门禁只读 `package/` 下的产物，脚本不知道
   `package/lib/client.js` 是 `src/client/**` 编出来的。规则 5 用「动到源码就全带上」硬兜，
   代价是一改源码就多跑几十扇，好处是不会漏。
3. **跨目录的公共约定没有自己的目录。** 有些约定是几个目录一起遵守的（后端适配的字段名、
   面板与状态栏之间的消息格式），改一处可能同时影响几个包。这种影响面既不在目录层级里，
   也不在 import 图里，规则 2 兜不住。这类东西一旦成形，应该给它一个目录（例如
   `src/**/contract/`），让规则 1 的契约层兜底。
4. **构建时生成的文件。** 有些被门禁盯着的文件不是手写的，而是构建时从别处生成（文件头通常写
   AUTO-GENERATED）。改生成它的源文件，不会让「只读生成物」的门禁被选中——两者之间没有 import 边。
   这类文件要么让它的门禁同时守着源文件，要么在生成器跑完之后补一次全链。
5. **「有门禁」和「有专属门禁」是两件事，别混。** 归属写成目录的门禁（`tests/verify-reuse.ts`、
   `tests/verify-no-title.ts` 点名了 `src/client/views`）是**递归**扫那个目录的，所以它守着的文件算「有门禁」——
   覆盖面这一栏因此是满的（`src/` 下 524 个文件、0 个无人守）。但「这一层自己有没有被点名」是另一回事：
   `tests/gate-map.json` 的 `coverage.dedicatedDirs` 记的就是后者，`coverage.dirsWithoutDedicated`
   列出没有专属门禁的目录和它们的文件数；这两个数以生成器跑出来的为准，别手抄。
   想让某个目录有专属门禁，要么给它写一扇门禁，要么在既有的、确实守着它的门禁里加一条
   `// 门禁归属:` 注释——注意注释会**取代**该门禁原有的全部线索，写的时候要写全。

一句话：**归属表是「谁守着谁」的地图，不是「谁影响谁」的证明。** 它能把大部分改动的影响面框出来，
框不全，所以最后那道闸是提交前的全链。

## 五、日常操作

### 重跑归属表

```
node scripts/gate-map.mts            # 重新推导并写回 tests/gate-map.json
node scripts/gate-map.mts --print    # 只看推导结果，不落盘
node tests/verify-gate-map.ts        # 给归属表和挑选规则把关的新鲜度检查
```

必须在这些时候重跑，否则 `tests/verify-gate-map.ts` 会因新鲜度断言变红（它失败时会打印
「哪一段、第几个字符不一样」，照着重跑一次即可）：

- `scripts/verify-stages.json` 变了（加了一扇、删了一扇、换了阶段或排除项）；
- 新增或删除**挂在链上**的 `tests/verify-*.ts`（没挂上链的脚本不进归属表）；
- `src/`（含四个计算核所在的 `src/shared/<功能名>/`，它们原先平铺在仓库根的
  `refresh-core/`、`label-color-core/`、`version-control-core/`、`config-store-core/`，
  2026-10-13 按 #1023 搬进来）下新增、删除、移动了文件——表的目录层级会跟着变；
- 任何门禁新写了 `// 门禁归属:` 注释，或者改了它读的文件。

**加一扇新门禁之后也要重跑一次**：表里存着「链上多少步」，链一变就对不上了。

### 加一扇新门禁

1. 在 `tests/` 下新建 `verify-xxx.ts`（以后新增一律写 `.ts`），写法照抄既有门禁：`check(ok, msg)` 逐条断言、
   末尾打印通过条数、失败 `process.exit(1)`。要让执行器校验「完成证据」（#1158），按
   `tests/lib/gate-result.ts` 的约定交出 `GATE-RESULT` 行。
2. 约定是「目录约定加显式排除表」：`tests/` 下符合 `verify-*` 命名的脚本会被自动发现、自动进链，
   默认落在 `scripts/verify-stages.json` 里 `match` 为空的那一段；只有长期不进链的样本门禁才需要登记进
   `exclude` 表，且理由与票号缺一不可（看守门禁 `tests/verify-1125-gate-coverage.ts` 会查这两项）。
3. 在文件开头写 `// 门禁归属:` 注释，写清它守着哪些源码路径（格式见下一节）。这一步可选，
   但强烈建议写——不写就只能靠「它读了哪些字面量路径」去猜，猜不准。
4. 重跑 `node scripts/gate-map.mts` 更新归属表，再跑 `node tests/verify-gate-map.ts` 确认全绿。
5. 自己把那扇门禁跑一遍，确认它**能红也能绿**（故意改坏一处看它是不是真的拦得住）——
   一扇永远绿的门禁比没有门禁更糟。

### `// 门禁归属:` 注释怎么写

```js
// 门禁归属: src/client/views/versionControl/vcRows.ts
```

- 写在文件**前 4000 个字符以内**（脚本只看开头这一段），一行一条路径；写多条就是多行。
- `//`、`/* */` 都行，冒号用中文 `：` 或英文 `:` 都行；路径写到文件或目录都行，
  目录末尾带不带斜杠都可以。
- 路径按**仓库相对路径**写（`src/...`、`src/shared/refresh/...`）。
- **写了它就以它为准，别的线索全不看**（读文件、import、字符串字面量都不再参与）。
  所以写的时候要写全：漏写的那条路径就等于没人守。
- 一扇门禁如果只是「顺手读了一下」某个文件，不算守它——只写它坏了该拦住谁。

### 挑选这次该跑哪些门禁

```
node scripts/lib/select-gates.mts <改了哪些文件...>
```

输出要么是「只跑 N / 全链 M 步」加每一步的理由，要么是「跑全链」加跑全链的理由。
在脚本里用就是 `import { selectGates } from './lib/select-gates.mts'`。

### 读一扇大门禁（省上下文、又不漏判据）

`tests/verify-prompts.ts` 这类门禁有两千多行；整份读进上下文很贵，注意力也会被排版细节吃掉。
按下面四步走，读到的正好是判据本身：

1. **先读文件头。** 前 50 行一般写着它守什么、判哪几条（R1–R8 这类口径）、产出哪些汇总计数。
   先知道「这扇门禁回答什么问题」，再决定要不要往下读。
2. **用 grep 找锚点，不整份读。** 常量名（`EXPECT_`、`PROTECTED`、`LOCK_`）、节标题、主要函数名、
   汇总行（`PASS` / `FAIL`）都是好锚点：
   `Select-String -Path tests/verify-xxx.ts -Pattern 'EXPECT_|PROTECTED|LOCK_|^(export )?(const|function) '`。
3. **先单跑一次，看它自己报什么。** 门禁末尾的汇总行（例如 `S1=28 S2=28/28 …`）会告诉你它扫了
   哪几个面、每面多少条，比读代码更快建立结构感；红了也直接看到是哪条判据在报。
4. **要旧版本时用 `git show` 读。** `git show <commit>:tests/verify-xxx.ts` 直接输出旧内容；
   要逐段比就 `git diff <commit> -- tests/verify-xxx.ts`。不要整份复制到临时文件再读一遍。

定点读文件用 `read` 工具的 `offset` / `limit`（或 `Get-Content ... | Select-Object -Skip N -First M`）。
同一个文件不要两次整份读：之前读过的区间记下来，只补没读过的段。

动手改之前，先跑一次这扇门禁确认它本来是全绿的——否则分不清「自己的改动弄红了」还是「本来就有问题」。

## 六、门禁红了先看哪里

- **`tests/verify-gate-map.ts` 报「归属表过期」**：重跑 `node scripts/gate-map.mts`，
  然后看 `git diff tests/gate-map.json` 里变了什么——变的地方通常就是这次真正动到的归属关系。
- **报「某个文件既没有门禁也没有理由」**：说明 `src/` 下多了一个没人守的文件。
  正确做法是给它补一扇门禁或补一条 `// 门禁归属:` 注释；如果它确实不需要门禁
  （纯类型文件、派生产物、原型页面），就在 `scripts/gate-map.mts` 的 `ungatedReasonFor(rel)`
  里加一条归类规则，把理由写清楚，让归属表把它归到「没有门禁但知道原因」那一类。
  **不要为了让门禁变绿去删断言。**
- **报挑选规则的场景测试失败**：说明挑选规则被改坏了，某个场景开始漏跑门禁。
  先想清楚是不是真的漏，再改规则；这些场景断言是防止「悄悄少跑」的最后一道防线。
