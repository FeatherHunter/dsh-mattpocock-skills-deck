# 门禁怎么挑、怎么跑

这份文档写给第一次接手这个仓库的人。它讲清四件事：仓库里的门禁分几档、每档什么时候跑；
「按这次改了哪些文件来挑门禁」这套规则是怎么定的；这套规则有哪些已知漏洞；以及怎么重跑归属表、
怎么加一扇新门禁。

文中的具体数字（多少步、覆盖多少文件）取自 2026-10-12 上午的一次运行，只用来帮你建立数量感；
链还在变长，你读到的时候数字多半已经不一样了，跑一次 `node scripts/gate-map.mjs --print`
就能看到当前的值。以准的只有 `package.json` 里那条 `scripts.verify` 和生成出来的 `tests/gate-map.json`。

## 一、先认清三样东西

- **`package.json` 的 `scripts.verify`**：一条用 ` && ` 把两百多步串起来的长命令，每一步形如
  `node tests/verify-xxx.js`，跑的是 `tests/` 下一个独立的 Node 脚本。**这是门禁名单的唯一来源**，
  别在别处再抄一份清单——抄一份就一定会跟它走散。
- **`tests/gate-map.json`（门禁归属表）**：生成物，回答「每一扇门禁守着哪些源码路径」。
  由 `node scripts/gate-map.mjs` 扫描生成，**不要手工改**。
- **`scripts/lib/select-gates.mjs`（挑选规则）**：回答「这次改了这些文件，该跑哪些门禁」。
  输入是改动清单，输出是 `verify` 链上该跑的那些步，外加每一步被选中的理由。

门禁本身是 `tests/verify-*`。当前 `tests/` 下有 303 个这样的脚本，挂在链上的是 228 个；
没挂上的是本地排查用的，不会在提交前自动跑。

## 二、门禁分三档

| 档 | 怎么跑 | 什么时候跑 |
| --- | --- | --- |
| 快档（只跑一扇或几扇） | `node tests/verify-progress.js`；按名字抽查用 `node scripts/verify-chain.js --only <文件名里的一段>` | 写代码的过程中，改一处验一处 |
| 受影响档（只跑这次改动碰得到的门禁） | `npm run verify:changed`（读 git 里这次的改动清单）或 `node scripts/lib/select-gates.mjs <改了哪些文件...>`（自己报改动清单） | 一个模块写完、提交之前自查 |
| 全链档（230 步全跑） | `npm run verify:parallel`（8 路并发，红也跑完再汇总，失败的那几步会自动串行重跑一次以排除互相干扰） | 提交之前、推送之前，**每次都要跑** |
| 全链·串行 | `node scripts/verify-chain.js`（第一扇红了就停，方便先修）或 `node scripts/verify-all.mjs`（全部跑完再汇总） | 想按顺序看输出、或者并发下出过怪事时用 |

2026-10-12 的实测（28 核机器）：228 步串行 517 秒；8 路并发在源码没动过时约 36 秒，
源码刚改过（要真跑一次构建）时约 66 秒。并发跑的日志里每一步的起止与耗时都打了时间戳；
并发跑红的步骤会自动串行重跑一次，重跑才红的会被标成 `flaky`（说明是并发互相干扰，不是代码坏了），
重跑仍然红才是真红。

并发跑得快，靠三件事，都不改任何一条断言的判据：

1. **慢步在等，不在算。** CPU 采样显示最慢那扇 31.8 秒里 31.7 秒是 idle，所以并发几乎能线性省时间。
2. **按耗时从长到短排程，互斥的步骤合成一节车厢。** 每步上一轮的实测耗时记在
   `node_modules/.cache/dsh-verify-times.json`（不进版本库）；会互相抢资源的步骤（`npm pack`、真跑构建）
   合成一节车厢，由同一个工人依次跑完，免得两个工人同时 `npm pack` 造成假红。车厢最前面会先跑一次
   预构建，后面的门禁就都命中构建缓存，也不会读到半旧产物。看排程用
   `node scripts/verify-parallel.mjs --tasks`。
3. **构建有缓存。** `node scripts/build.mjs` 会先比「手写输入的内容指纹」与「上次成功构建的产物哈希」，
   两者都没变就跳过这 30 秒（链上有十几扇门禁各自跑一次构建）。缓存落在 `node_modules/.cache/dsh-build.json`，
   要强制重建用 `node scripts/build.mjs --force`。判定口径是「产物与上次成功构建逐字节相同」，
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
  `src/client/views/versionControl/VersionControlTab.js` 会走出
  `src/client/views/versionControl` → `src/client/views` → `src/client` → `src` → `.`；
- 归属表里这些目录**各自直接守着**的门禁全选上。注意是「各自直接守着」而不是「含子目录累计」：
  改 `src/client/views/versionControl/` 不会连带选中只守 `src/client/views/cards/` 的门禁，
  这正是维护者要的「改 E 跑 E、B、A 三层，不碰兄弟目录 C、D」；
- **再加反向依赖**：谁的 import 图里能走到这个文件（直接或传递），守着那些文件的门禁也要跑。
  这一步是关键。`src/shared/refresh/budget.js` 就被九个模块直接 import，还有更多模块间接依赖它；
  光按目录走，改了它只会跑守 `src/shared/refresh/` 的那几十扇，上层消费者坏了本地看不到。

**规则 3：改的文件没有归属，跑全链。** 「没有归属」是指它所在目录在归属表里查不到任何门禁
（目录键不存在，或者对应的是空列表）。没人看着它，就猜不出影响面，只能全跑。

**规则 4：改的是门禁或测试自己。** `tests/**` 已经在规则 1 里命中，整条链都会跑，那扇测试自然在里头。

**规则 5：只验构建产物的门禁跟着源码一起跑。** 有 20 扇门禁只读 `package/` 下的产物
（例如 `tests/verify-958-label-name-visible.js` 读 `package/lib/client.js`）。
脚本看不出产物是哪个源码文件编出来的，所以只要这次动到了源码，这 20 扇一律跟着跑。

补充两条边界：改动清单为空（比如你没传参数）按全链处理；传进来的路径既支持
`src/a/b.js` 这种仓库相对路径，也支持从仓库根写起的 `./src/a/b.js` 和反斜杠写法。

**一个真实例子**（改 `src/client/views/versionControl/VersionControlTab.js`）：
选中 60 步 / 全链 228 步。这 60 步是几路来源并起来的结果（取并集，不是相加）——守
`src/client/views/versionControl/` 的 5 扇、守 `src/client/views/` 的 21 扇、守 `src/client/` 的 17 扇、
守 `src/` 的 3 扇，加上反向依赖这个文件的那些门禁，最后并上那 20 扇只看构建产物的。
改一个文件就从 228 步降到 60 步，而守这三层的门禁一扇不少。同一张表里，改
`src/shared/refresh/budget.js` 这种底层共享模块要跑 144 步——比 60 多得多，因为反向依赖把上游消费者
都拉了进来，这正是它该有的样子。

命令行直接看挑选结果（人读得懂的那种输出）：

```
node scripts/lib/select-gates.mjs src/client/views/versionControl/VersionControlTab.js
```

改动清单通常来自 `git status --porcelain` 或 `git diff --name-only` 的输出。

## 四、这套规则的已知漏洞

**这些漏洞都真实存在，而且都验证过，所以提交前必须跑一次全链。** 受影响档是用来省时间的，
不是用来替代全链的。

1. **动态拼出来的路径认不出来。** 归属是从门禁文件里的**字符串字面量**推的；
   路径一旦是拼出来的（变量、模板串、从配置里读出来的目录名），脚本就看不见它读的是什么。
   真实例子：`scripts/gen-fixture-423.js` 从 `src/client/kernel/styles.js` 里抽出 CSS 规则，
   生成夹具 `tests/fixtures/423-clamp-repro.html`，而门禁 `tests/verify-423-title-clamp-browser.js`
   只读那个 html 夹具。于是你改了 `styles.js`，这扇浏览器门禁**不会被选中**——
   它守着的路径落在 `tests/fixtures/` 下，跟 `styles.js` 之间没有任何一条字面量线索。
   识别不出来的门禁在表里会被标成「没有源码归属」：按目录挑的时候永远轮不到它，
   只有整条链全跑时才会跑到它。兜底也救不了它——兜底看的是**你改的那个文件**有没有归属，
   而这类门禁的问题出在**门禁自己**说不清守着谁。
2. **构建产物与源码的对应关系看不出来。** 有 20 扇门禁只读 `package/` 下的产物，脚本不知道
   `package/lib/client.js` 是 `src/client/**` 编出来的。规则 5 用「动到源码就全带上」硬兜，
   代价是一改源码就多跑 20 扇，好处是不会漏。
3. **跨目录的公共约定没有自己的目录。** 有些约定是几个目录一起遵守的（后端适配的字段名、
   面板与状态栏之间的消息格式），改一处可能同时影响几个包。这种影响面既不在目录层级里，
   也不在 import 图里，规则 2 兜不住。这类东西一旦成形，应该给它一个目录（例如
   `src/**/contract/`），让规则 1 的契约层兜底。
4. **躺在 `src/` 里的自动生成文件。** `src/shared/refresh/budget.js` 是
   `src/shared/refresh/build.mjs` 从 `src/shared/refresh/src/budget.ts` 生成的（文件头写着 AUTO-GENERATED）。
   改 `.ts` 源文件，不会让「只读 `src/shared/refresh/budget.js`」的门禁被选中——
   两者之间没有 import 边。这类文件要么让它的门禁同时守着源文件，要么在生成器跑完之后补一次全链。
5. **「有门禁」和「有专属门禁」是两件事，别混。** 归属写成目录的门禁（`tests/verify-reuse.js`、
   `tests/verify-no-title.js` 点名了 `src/client/views`）是**递归**扫那个目录的，所以它守着的文件算「有门禁」——
   覆盖面这一栏因此是满的（510/510）。但「这一层自己有没有被点名」是另一回事：`coverage.dedicatedDirs`
   记的就是后者，`coverage.dirsWithoutDedicated` 列出没有专属门禁的目录和它们的文件数。
   2026-10-13 这一版（#1016 删掉 `src/host/logPkg` 之后按磁盘实况数）：43 个目录里 42 个有专属门禁，
   唯一没有的是 `src/shared/config-store/src`（4 个文件）。`tests/gate-map.json` 那份表已经跟着重算过
   （`node scripts/gate-map.mjs`，`tests/verify-gate-map.js` 82 条断言全过），表里的数与这里一致。
   想让某个目录有专属门禁，要么给它写一扇门禁，要么在既有的、确实守着它的门禁里加一条
   `// 门禁归属:` 注释——注意注释会**取代**该门禁原有的全部线索，写的时候要写全。

一句话：**归属表是「谁守着谁」的地图，不是「谁影响谁」的证明。** 它能把大部分改动的影响面框出来，
框不全，所以最后那道闸是提交前的全链。

## 五、日常操作

### 重跑归属表

```
node scripts/gate-map.mjs            # 重新推导并写回 tests/gate-map.json
node scripts/gate-map.mjs --print    # 只看推导结果，不落盘
node tests/verify-gate-map.js        # 给归属表和挑选规则把关的新鲜度检查
```

必须在这些时候重跑，否则 `tests/verify-gate-map.js` 会因新鲜度断言变红（它失败时会打印
「哪一段、第几个字符不一样」，照着重跑一次即可）：

- `package.json` 的 `verify` 链变了（加了一扇、删了一扇、换了命令）；
- 新增或删除**挂在链上**的 `tests/verify-*.js`（没挂上链的脚本不进归属表）；
- `src/`（含四个计算核所在的 `src/shared/<功能名>/`，它们原先平铺在仓库根的
  `refresh-core/`、`label-color-core/`、`version-control-core/`、`config-store-core/`，
  2026-10-13 按 #1023 搬进来）下新增、删除、移动了文件——表的目录层级会跟着变；
- 任何门禁新写了 `// 门禁归属:` 注释，或者改了它读的文件。

**把新门禁挂到链上之后也要重跑一次**：表里存着「链上多少步」，链一变就对不上了。

### 加一扇新门禁

1. 在 `tests/` 下新建 `verify-xxx.js`，写法照抄既有门禁：`check(ok, msg)` 逐条断言、
   末尾打印通过条数、失败 `process.exit(1)`。
2. 在文件开头写 `// 门禁归属:` 注释，写清它守着哪些源码路径（格式见下一节）。这一步可选，
   但强烈建议写——不写就只能靠「它读了哪些字面量路径」去猜，猜不准。
3. 请 `package.json` 的维护者把它加进 `scripts.verify`。本仓 `package.json` 只有一位写者，
   别自己动。挂上去时注意用 ` && ` 串，跟前后的步骤保持同一个写法。
4. 重跑 `node scripts/gate-map.mjs` 更新归属表，再跑 `node tests/verify-gate-map.js` 确认全绿。
5. 自己把那扇门禁跑一遍，确认它**能红也能绿**（故意改坏一处看它是不是真的拦得住）——
   一扇永远绿的门禁比没有门禁更糟。

### `// 门禁归属:` 注释怎么写

```js
// 门禁归属: src/client/views/versionControl/vcRows.js
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
node scripts/lib/select-gates.mjs <改了哪些文件...>
```

输出要么是「只跑 N / 228 步」加每一步的理由，要么是「跑全链」加跑全链的理由。
在脚本里用就是 `import { selectGates } from './lib/select-gates.mjs'`。

## 六、门禁红了先看哪里

- **`tests/verify-gate-map.js` 报「归属表过期」**：重跑 `node scripts/gate-map.mjs`，
  然后看 `git diff tests/gate-map.json` 里变了什么——变的地方通常就是这次真正动到的归属关系。
- **报「某个文件既没有门禁也没有理由」**：说明 `src/` 下多了一个没人守的文件。
  正确做法是给它补一扇门禁或补一条 `// 门禁归属:` 注释；如果它确实不需要门禁
  （纯类型文件、派生产物、原型页面），就在 `scripts/gate-map.mjs` 的 `ungatedReasonFor(rel)`
  里加一条归类规则，把理由写清楚，让归属表把它归到「没有门禁但知道原因」那一类。
  **不要为了让门禁变绿去删断言。**
- **报挑选规则的场景测试失败**：说明挑选规则被改坏了，某个场景开始漏跑门禁。
  先想清楚是不是真的漏，再改规则；这些场景断言是防止「悄悄少跑」的最后一道防线。
