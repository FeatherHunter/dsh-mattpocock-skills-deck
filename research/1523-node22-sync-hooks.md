# #1523 调研笔记：Node 22 与 Node 24 上同步装载钩子、CJS require 与 require(esm) 的差异

本文件是 GitHub issue #1523 的调研笔记。查询日期：2026-10-26（Asia/Shanghai）。
证据强度标记：【源码】指直接读过该版本 Node 源码；【文档】指 Node 官方 API 文档或 changelog；【推断】指由源码事实推出、尚未实测；【待验证】指需要在本机或 CI 上跑对照实验确认。

## 0. 这次要查清的问题

同一份代码在本地 Node v24.19.0 上跑 verify 全绿；CI 的 setup-node 写 `node-version: 22`，实际拿到 v22.23.3，同一个提交上 382 道门禁在 ubuntu 失败 176 道、windows 与 macOS 各 177 道。失败分两类：约 99 次 `ERR_VM_MODULE_LINK_FAILURE`（消息 `request for 'node:fs' is from a module not been linked`），约 70 次 `MODULE_NOT_FOUND`（如 `./lib/eval-probe.js`），后者栈里能看到 `scripts/ts-hook.mts` 的 resolve 钩子参与，但 CJS 的 require 仍按 `.js` 找文件。

## 1. 既有笔记查过了，为什么还不够

仓内 `research/1014-q7-node-qa.html` 记的是：Node 的同步 `module.registerHooks()` 从 Node 22.15 才有；同步钩子同时管 ESM 的 import 与 CommonJS 的 require，异步的 `module.register()` 管不到 require；本机 Node v24.19.0 实测 `registerHooks` 是函数、TypeScript 是 strip 模式。

一句话说它为什么不够：那份笔记只回答了「Node 22.15 这个版本下限从哪来」和「同步钩子理论上管得到 CJS require」，没有回答「为什么在 Node 22.23.3 上、在 `--import` 装载钩子的入口路径里，CJS require 实际没有走钩子，以及 require(esm) 为什么会在内置模块上抛链接失败」——这是两个不同层面的问题，前者是能力检测，后者是 Node 22 内部装载路径的具体缺陷，必须去读 22 与 24 两个版本的源码与 changelog 才能定论。本次调研因此以 Node 官方文档、指定 tag 的源码和 nodejs/node 的 issue/PR 为主来源。

## 2. 问题 1：同步 resolve 钩子对 CommonJS require 提供的 context（parentURL 等），Node 22.x 与 24.x 有什么差别

### 2.1 文档层面：两版写法一致，没有文档化的差异【文档】

- `module.registerHooks()` 在 v22.15.0 / v23.5.0 加入（PR #55698），v22 文档的稳定度标为 1.1（Active development），v24 文档标为 1.2（Release candidate）。
- 两版都明确：钩子可以在应用代码运行前用 `--import` 或 `--require` 注册，例如 `node --import ./register-hooks.js ./my-app.js`、`node --require ./register-hooks.js ./my-app.js`；并写明 “Using --import or --require ensures that the hooks are registered before any application code is loaded, including the entry point of the application and for any worker threads by default as well.”
- resolve 钩子的 context 两版都写成 `{ conditions, importAttributes, parentURL }`；parentURL 的说明一字不差：“The module importing this one, or undefined if this is the Node.js entry point.”
- 结论：官方文档没有写 22 与 24 对 CJS require 的 parentURL 存在差别。

### 2.2 源码层面：authentic（真实）的 CJS require 两版计算 parentURL 的逻辑相同【源码】

- v22.23.3 `lib/internal/modules/cjs/loader.js`：`resolveForCJSWithHooks` 定义在 1021 行；`Module._load` 在 1216 行调用它（`const resolveResult = resolveForCJSWithHooks(request, parent, isMain, options.shouldSkipModuleHooks);`）；parentURL 在 1049-1056 行计算，规则是 parent.filename 存在时用 `convertCJSFilenameToURL` 换出 parentURL，然后在 1084 行走 `resolveWithHooks`。
- v24.19.0 `lib/internal/modules/cjs/loader.js`：同名函数在 1116 行，参数多了一个 internalOptions，从中解构出 `{ requireResolveOptions, shouldSkipModuleHooks }`；parentURL 计算在 1125-1132 行，逻辑与 v22 相同。v24 另有 `wrapModuleLoad`（loader.js:238）只负责在 `Module._load` 外面包一层 diagnostics_channel 的 trace，不改变解析语义。
- 因此：普通（真实的、由 CJS 装载器自己执行的）CJS require，在 v22.23.3 与 v24.19.0 上都会调用同步 resolve 钩子，parentURL 的算法也没有变化。Node 22.23.3 并没有「同步钩子对 CJS require 一律不生效」这种问题。

### 2.3 真正的差别不在 context 字段，而在「这一次 require 由谁执行」【源码】

差别出在「模块本身是被 ESM 装载器当作 CJS 加载的」那条路径上（也就是 CJS-in-ESM，见 3.1）。这时 CJS 模块里拿到的 `require` 不是真实的 require，而是 ESM 装载器重造出来的一个函数。v22.23.3 的 `lib/internal/modules/esm/translators.js` 里，重造 require（126-198 行的 `loadCJSModule`）对非 node:、非内置的说明符直接调用 `CJSModule._resolveFilename(specifier, module)`（142 行），完全绕过 `resolveForCJSWithHooks`，因此钩子不生效；`requireFn.resolve` 也走 `_resolveFilename`。v24.19.0 的同一段（111-190 行，已改名 `loadCJSModuleWithSpecialRequire`）在 143-144 行有一段注释：“This re-invented require() is only used on the loader-hook worker thread. On the main thread, the authentic require() is used instead (fixed by #60380).”

### 2.4 已知的 parentURL 类 bug（与 #1523 症状不同，但属于同一片区域）【文档】

- issue nodejs/node#60973“Incorrect parentURL for registerHooks when using require(esm)”（2025-12-06，v25.2.1 报告，已关闭）：用 `createRequire(import.meta.url + '?test')` 时，钩子拿到的 parentURL 丢了查询串。PR #60974 修复（合并 2025-12-13），在 `createRequireFromPath` 里补 `m[kURL] = fileURL.href`，并新增回归测试 `test/module-hooks/test-module-hooks-create-require-with-url.mjs`。
- 这是已知的 parentURL bug，但只影响带查询串的 `createRequire` 场景，和 #1523 的两种报错症状都不同；v22 线是否回填此修复本次未查到，待验证。

## 3. 问题 2：ERR_VM_MODULE_LINK_FAILURE 在什么条件下抛出，和同步钩子、CJS 与 ESM 互操作有没有关系

### 3.1 抛出点【源码】

- v22.23.3 `src/module_wrap.cc` 的 `ModuleWrap::ResolveModule`（1030-1071 行）：当 V8 在链接期要求某个 ModuleWrap 解析一个依赖，而该 referrer 在 Node 侧不算已链接时抛出。1053-1058 行是：

  `if (!dependent->IsLinked()) { THROW_ERR_VM_MODULE_LINK_FAILURE(env, "request for '%s' is from a module not been linked", cache_key.specifier); }`

  1047-1052 行对 dependent 为空的情况抛 “from invalid module”；1061-1066 行还有 “not in cache” 变体。错误码定义在 `src/node_errors.h:123`（`V(ERR_VM_MODULE_LINK_FAILURE, Error)`）。
- v24.19.0 同函数（约 1072-1099 行）的消息已改成 “request for '%s' can not be resolved on module '%s' that is not linked”（PR #60157 只修了措辞，没有改触发条件）。
- 官方错误文档只有一句话：doc/api/errors.md 中 v22.23.3 的 3269-3273 行、v24.19.0 的 3353-3357 行——“The module was unable to be linked due to a failure.”

### 3.2 这条错误的语义

它说的是 V8 链接回调里「referrer 模块还没被链接」这一状态不合法，不是「找不到模块」，也不是「require 了 ESM」这类格式错误。它既可能由 vm.SourceTextModule 场景触发（issue #60157，v24.9.0 报告，只改了错误消息），也可能由更新状态竞态触发（issue #52187：v20.11.1 上 `Promise.all` 并行 dynamic import 偶发 “request for 'node:process' is not in cache”，串行 import 则报真正的 SyntaxError）。

### 3.3 和同步钩子、CJS 与 ESM 互操作的关系

- 与同步钩子的改写逻辑无关：ts-hook 只改写以 ./、../、file: 开头或绝对路径、且以 .js 结尾的说明符；`node:fs` 是内置模块说明符，ts-hook 的 `tsSiblingURL` 不会碰它（条件在 scripts/ts-hook.mts:50-54 与 17-18 行的约定一）。
- 与 CJS、ESM 互操作有关，但关系是间接的：报错发生在 require(esm) 把 ESM 模块连同其依赖一起同步实例化的时候；触发入口是「CJS 模块被 ESM 装载器当作入口加载」这条路径，而这条路径是被 `--import` 打开的（见 4.1）。
- 关键源码差异：v22.23.3 的 `lib/internal/modules/esm/module_job.js` 里，`ModuleJob.runSync`（293-330 行）在模块未实例化时直接调用 `this.module.instantiateSync()`（302 行），代码上方 299-300 行自带 FIXME：“this cannot fully handle < kInstantiated. Make the linking fully synchronous instead.”；v24.19.0 的同一函数（382-426 行）已改为无依赖请求时先 `this.module.link([])`，再 `this.module.instantiate()`，不再使用 `instantiateSync`。v22.23.3 的 CI 栈帧 `at ModuleJob.runSync (node:internal/modules/esm/module_job:302:39)` 正对 302 行。
- 另一条证据：v22.23.3 的 `lib/internal/modules/esm/loader.js` 里，真正的 `require(esm)` 用 `ModuleJobSync`（module_job.js:362）——它的构造函数先把每个 `moduleRequests` 解析成 job 并 `this.module.link(modules)`（396 行），然后 `runSync` 才 `instantiateSync`（440 行），即真实 require(esm) 是先链接再实例化的；而 `ModuleJob.runSync` 这条 imported-CJS 路径没有这一步。

## 4. 问题 3：综合出一个能解释「Node 24 全绿、Node 22 大面积红」的机制

以下机制中，路径部分是【源码】直证，因果部分标注【推断】，验证方法在 4.4。

### 4.1 第一类：MODULE_NOT_FOUND（约 70 次）【源码 + 与 CI 栈逐帧吻合】

1. 门禁通过 `node --import ./scripts/ts-hook.mts tests/x.ts` 启动（见 scripts/verify-chain.ts:35-38、scripts/verify-parallel.mts:184-187、scripts/verify-all.mts:38-42 三处 argvOf，以及 package.json:18 的 smoke 串）。
2. v22.23.3 `lib/internal/modules/run_main.js` 的 `shouldUseESMLoader(mainPath)`（64-100 行）在 76-77 行判断：“const userImports = getOptionValue('--import'); if (userLoaders.length > 0 || userImports.length > 0) { return true; }”——只要传了 `--import`，入口点就交给 ESM 装载器，哪怕入口是 .ts/.js 的 CJS 文件。
3. 入口 .ts 没有 `type` 字段时按 CJS 格式处理（92-99 行按最近 package.json 的 type 判定；84-90 行是 strip-types 的判定，.mts 返回 true、.cts 返回 false）。于是入口文件被 ESM 装载器的 `loadCJSModule` 当 CJS 翻译，模块里所有顶层 `require` 都变成重造 require（3.1 节的 translators.js:138-195）。
4. 重造 require 在 translators.js:142 调 `CJSModule._resolveFilename`，绕过 `module.registerHooks`，所以 `require('./lib/eval-probe.js')` 不会改指同目录的 `eval-probe.ts`，直接抛出 MODULE_NOT_FOUND。CI 栈里的 `at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15) / at require (node:internal/modules/esm/translators:142:30)` 与这条路径逐帧吻合。

一句话：`--import` 把入口推进了 ESM 装载器，而 Node 22 的 ESM 装载器给 CJS 模块发的是绕过钩子的重造 require，于是同名 .ts 解析整条链路失效。

### 4.2 第二类：ERR_VM_MODULE_LINK_FAILURE（约 99 次）【源码路径 + 部分推断】

1. 同一个入口路径下，测试文件里的 `require('../scripts/lib/transpile-domains.mts')`（tests/verify-1207-splice-ts.ts:41 就是这样写的）由重造 require 转成 file URL，走 `getModuleJobForRequireInImportedCJS`（v22.23.3 esm/loader.js:333）拿到一个 `ModuleJob`，然后 `job.runSync()`（translators.js:159-160）。
2. `ModuleJob.runSync`（module_job.js:293-330）看到模块未实例化，直接 `instantiateSync()`（302 行）。V8 链接这个 .mts 模块的依赖（如 `node:fs`）时，回调进 `ModuleWrap::ResolveModule`，发现 referrer 的链接状态不合法，按 1053-1058 行抛出 ERR_VM_MODULE_LINK_FAILURE “request for 'node:fs' is from a module not been linked”。CI 栈的 `at ModuleJob.runSync (module_job:302:39) / at require (esm/translators:160:9)` 正对这条路径。
3. 【推断】为什么 24 正常：v24 线在 v24.9.0 前已把 `runSync` 改成先 link 再 instantiate（module_job.js:388-396，另见提交 2fafe4c3bb “esm: link modules synchronously when no async loader hooks are used”），到 v24.15.0 起主线程的 imported-CJS 又彻底改用真实 require（PR #60380 的注释与代码），这条重造 require → runSync → instantiateSync 的链路在 Node 24.15+ 上根本走不到。v22 线没有拿到任何一项回填（见 4.3）。
4. 需要说明：这一类的「具体哪一步让 referrer 未链接」还没有最小复现逐帧证据，因此 4.2 第 2 步是源码可证的路径，第 3 步是解释性推断；4.4 给了验证方法。

### 4.3 版本分界与上游记录【文档】

- PR nodejs/node#60380 “esm: use sync loading/resolving on non-loader-hook thread”（合并 2025-10-31，base main，修复 issue #59666）：把 ESM 解析与加载在非 loader-hook 线程上一律改成同步，避免异步钩子与同步钩子共享缓存时的竞争，并让 “asynchronous loader hooks now works with require(esm)”。它随 v25.2.0（2025-11-11）进入主线，随 v24.15.0（2026-04-15）进入 24 线。
- 逐 tag 核对 raw 源码：v24.10.0、v24.11.0、v24.11.1、v24.12.0、v24.13.0、v24.14.0 的 translators.js 都没有 #60380 的痕迹，module_job.js 仍是旧写法；v24.15.0 与 v24.19.0 有 “fixed by #60380” 注释与真实 require；v22.23.3 有 `instantiateSync()`、没有这些改动。
- v24.15.0 的 changelog 里与本题直接相关的条目还有：`module: mark require(esm) as stable (#60959)`、`module: do not invoke resolve hooks twice for imported cjs (#61529)`、`module: run require.resolve through module.registerHooks() (#62028)`。
- v22 线没有回填：issue #61801“Request: Backport loader fix to v22.x”（2026-02-13 创建，2026-08-07 因 stale 关闭）讨论过回填；PR #62029“[v22.x] backport module loader & loader hook fixes” 最终 state=closed、merged_at 为空，没有进入 v22.x-staging。v22.23.3 是 2026-09-23 发布的，仍带着旧的同步模块作业实现。
- 因此「v24 全绿」的直接解释是：本地 v24.19.0 同时具备 v24.9.0 前完成的 runSync 改动与 v24.15.0 的主线程真实 require，而 v22.23.3 两样都没有。

### 4.4 可验证的推断与验证方法（建议按顺序做）

1. 基线复现：在 Node 22.23.3 上跑 issue 给的命令（`node --import ./scripts/ts-hook.mts tests/verify-1207-splice-ts.ts`），确认两类错误都能出现；在 v24.19.0 上同一命令应该全绿。这条是 #1523 正文已给出的观察，只需固定成可重复记录。
2. 对照实验 A——把 `--import` 换成不注册任何钩子的空 ESM 预载（或改用 `--require` 预载一个 CJS 形态的钩子）：预测 MODULE_NOT_FOUND 类在空预载下仍会出现（因为改指失效），而 ERR_VM_MODULE_LINK_FAILURE 类如果仍出现，就说明第二类与 ts-hook 的改写逻辑无关、只与入口被推进 ESM 装载器有关。这条最能区分两类的成因。
3. 对照实验 B——把入口改成「ESM 包装脚本用 createRequire 加载 CJS 测试文件」（入口仍是 ESM，但测试文件由真实 CJS require 执行）：预测第一类消失（真实 require 走钩子），第二类是否消失取决于 require(esm) 是否回到 ModuleJobSync 路径，需实测。
4. 版本对照：v24.14.0 预期第一类仍红、第二类已绿；v24.15.0 起两类都应绿；v22.23.3 两类都红。若 v24.14.0 上第一类也绿，则说明第一类的边界比「#60380」更早，需要再二分。

## 5. 问题 4：修复方向候选（只列选项、代价与风险，不实施）

### 5.1 方向（i）：让「同名 .js → .ts」解析在 Node 22 上生效的具体做法

a) 把钩子注册方式从 `--import` 改为 `--require`，钩子文件改成 CJS 可加载形态（例如 `scripts/ts-hook.cts`，Node 22.18+ 默认类型剥离下 .cts 按 CommonJS 运行，doc/api/typescript.md 第 109 行写明 .cts 永远按 CJS 跑；能否用 `--require` 直接预载 .cts 需要实测，标待验证）。文档保证 `--require` 与 `--import` 一样在应用代码（含入口点）之前注册钩子。代价：三个链执行器要改（scripts/verify-chain.ts:36-38、scripts/verify-parallel.mts:185-187、scripts/verify-all.mts:39-42），package.json:18 的 smoke 串、tests/gate-map.json 里的冒烟步骤、约 9 处测试内自 spawn 子进程（如 tests/verify-1159、verify-1161、verify-1152、verify-1136、verify-1157、verify-1146、verify-1323、verify-prompts、verify-issue-body-script）、以及 verify-1158 复制钩子文件的清单都要跟着改；文档（AGENTS.md:67/75/78、docs/workflow/DEV-WORKFLOW.md:110-115）也要同步。风险：需要确认 v22 的真实 require(esm) 路径（ModuleJobSync）不会再抛第二类错；不确认就改，可能只治好一半。

b) 不改钩子注册方式，改入口：新增一个 ESM 包装脚本（如 `scripts/run-gate.mts`），用 `createRequire(import.meta.url)` 加载真正的 CJS 测试文件；链执行器改成 `node --import ./scripts/ts-hook.mts scripts/run-gate.mts tests/x.ts`。代价：新增一个脚本文件加三处 argv 改动，外加同样要处理约 9 处测试内子进程与调用文档。风险：进程参数（process.argv、require.main）语义变化，测试里如果有对 argv 或主模块的判断会受影响；也要确认 CJS 测试文件里的 require(esm) 在 Node 22 上走 ModuleJobSync 后不再抛链接失败。

c) 机械替换测试里的 `require('./x.js')` 为显式 `require('./x.ts')`：仓内 tests 目录下 `require('./…js')` 形状共 139 处、分布在 100 个 .ts 测试文件里。代价与风险最大：与「保留 .js 说明符、由构建产物使用」的仓内约定相悖，tsc 侧还需要 allowImportingTsExtensions 一类的配置，且只能解决 CJS→CJS，对 `.mts` 的 require(esm) 无效，不推荐作为主方案。

d) 为迁移后的文件生成同名 `.js` 薄壳（构建产物、gitignored），让 Node 22 的重造 require 能直接解析到壳：能绕开第一类，但壳与源码/产物的新鲜度要新加判据；且第二类（`.mts` 依赖）仍无解，不推荐。

### 5.2 方向（ii）：把 engines.node 最低线抬到 24

- 现状：根 package.json:9-10 的 engines 是 `"^22.22.2 || ^24.15.0 || >=26.0.0"`；CI 的 .github/workflows/verify.yml 目前写 `node-version: 22`。
- 影响：Node 22（Jod）处于维护期（2025-10-21 起），到 2027-04-30 结束；Node 24（Krypton）2026-10-20 进入维护期，到 2028-04-30 结束（nodejs/Release 的 schedule.json）。抬到 `^24.15.0` 与本地复现版本、与已验证的修复落地版本一致，改动小：改 engines、CI 的 node-version、文档与 AGENTS.md 里的下限说明，并复核 .npmrc 与 pnpm-workspace.yaml 的 engineStrict 双守卫。
- 代价与风险：明确放弃 Node 22 用户与 CI 的 22 覆盖；22.22.2 这个旧下限是照最严依赖 jsdom 抄来的（AGENTS.md 有记录），抬线前要确认没有别的依赖仍要求 22 线；#1523 正文明确说「不得简单把 CI node-version 抬到 24 掩盖」，所以这一项只能作为需要人拍板的产品决策，不能当技术修复的替代品。

### 5.3 方向（iii）：其他替代

- 去掉对同步钩子与 CJS require 的依赖（长期）：把测试与链上脚本逐步改成 ESM 加显式 .ts 说明符，最终删除 ts-hook。这是 AGENTS.md「最终只留 TS」方向的自然终点，但工作量按 139 处/100 文件量级，属于长期项。
- 换外部 TS 加载器（tsx、esbuild-register 等）：可能避开 Node 22 的这条路径，但新增依赖，且这些工具自身在 Node 22 的 require 路径上也要用 loader hooks，需要先评估，本次未查。
- 门禁改跑构建产物（先 build 再跑 .js）：能绕开钩子，但会让「测试加载源码」与「产物新鲜度判据」两件事混在一起，与现有设计相悖。
- 等 Node 22 回填：PR #62029 已关闭未合并、issue #61801 因 stale 关闭，v22 已进入维护期，实际不可作为主路径。

### 5.4 关于「有没有官方推荐的替代做法」

- Node 官方文档只给出「用 --import 或 --require 在应用代码前注册钩子」这一种做法，没有针对 Node 22 的额外推荐或 workaround；文档层面 v22 的 registerHooks 仍是 1.1 Active development，v24 是 1.2 Release candidate。
- 上游的实际修法是升到包含 #60380 的版本（24.15.0 / 25.2.0 及以上）；本次没有找到官方为 v22 提供的回填或替代 API。

## 6. 未找到上游记录 / 待验证清单

- 未找到针对「Node 22 上 CJS-in-ESM 重造 require + require(esm) 内置模块抛 ERR_VM_MODULE_LINK_FAILURE」这一具体组合的 nodejs/node issue 或 changelog 条目；目前以 4.2 的源码路径与 4.4 的对照实验为据，结论按【推断】计。
- 待验证：`--require` 预载 .cts 在 Node 22.23.3 上是否可直接工作；改用 --require 或包装入口后第二类错误是否消失；v24.14.0 / v24.15.0 上的实际表现是否与 4.4 的预测一致（需要能装这几个 Node 版本的环境）。
- 待验证：v22 线是否回填过 #60974（createRequire 的 parentURL 修复）；本次未查到。

## 7. 本地复现与 CI 取证（2026-10-26 补）

### 7.1 本机按 CI 同版本复现（只做诊断，未改仓库文件）

- 环境：Node v22.23.4 与 v22.23.3 官方 win-x64 解压包（`.tmp-1523/repro/node-v22.23.4-win-x64/node.exe`、`node-v22.23.3-win-x64`）；本机对照 Node v24.19.0。
- `node --import ./scripts/ts-hook.mts tests/verify-1207-splice-ts.ts`：22.23.4 退出码 1，`ERR_VM_MODULE_LINK_FAILURE: request for 'node:fs' is from a module not been linked`（报错点 `tests/verify-1207-splice-ts.ts:41:67`）；24.19.0 退出码 0。
- `node --import ./scripts/ts-hook.mts tests/verify-663-banner-chain.ts`：22.23.4 退出码 1，`Cannot find module './lib/eval-probe.js'`（`tests/verify-663-banner-chain.ts:11:23`）；24.19.0 退出码 0。
- `node --import ./scripts/ts-hook.mts tests/verify-1082-work-route-table.ts`（ESM 格式入口）：22.23.4 退出码 1，同类 link failure（`tests/lib/source-text.ts:57:81`）；24.19.0 退出码 0。
- 最小对照（`.tmp-1523/repro/min/`，同一份输入分别给 22 与 24）：把 `--import` 换成「什么都不注册的空模块」，第一类错误照样出现 → 与 `registerHooks` 的内容无关；入口改成 `.cjs`/`.js` 时 require 会正常进钩子、不再报错；不含 `--import` 时 `.ts` 入口 require 带依赖的 `.mts` 也正常 → 入口扩展名 + `--import` 是分水岭。
- `--require` CJS 预载的实验副本（`.tmp-1523/repro/hook-preload.cjs`）在 22.23.4 上救回 5 道 CJS 入口门禁（verify-1207 / 663 / leaves / deck-tools / 1090 全退出码 0），但 **verify-1082 仍退出码 1**（ESM 入口路径不被覆盖）。

### 7.2 CI 日志取证（`.tmp-1523/ci/`）

- 门禁级分类（40202924113 / 40218365816 / 40220822929）：387 道门禁里 LINK（`ERR_VM_MODULE_LINK_FAILURE`）98–105 道、MODULE_NOT_FOUND 72–76 道；逐行出现次数 LINK 197–213 次、MNF 75–76 次。
- 真内容失败只有 2–4 道，与 Node 22 无关：跨 OS 的 `tests/verify-detail-levels.ts`、`tests/verify-wizard-exit-609.ts`；仅 windows 的 `tests/verify-cap-fold-browser.ts`；仅 macOS 的 `tests/verify-issue-body-script.ts`。
- 实际 Node 版本：ubuntu v22.23.3、windows v22.23.4、macOS 两者之间摆动；三类系统的报错结构相同，与 4.1/4.2 的源码路径逐帧吻合。

### 7.3 完整取证记录

- `.tmp-1523/repro/findings.md`：本地 Node 22 全量复现与最小实验矩阵（本节的本地部分）。
- `.tmp-1523/ci/findings.md`：CI 运行清单、每类错误计数、失败门禁清单与代表性堆栈（本节的 CI 部分）。
- 两处都是本次诊断的临时取证目录，未纳入 Git；结论已收进本笔记，原始日志按需可重抓。

本地环境旁注：本机 `D:/Temp` 会让 `verify-1207` 在 Node 22 上 `mkdtemp` 报 EPERM，把 `TEMP` 指到 `.tmp-1523/repro/tmp` 可绕过；CI 的 /tmp 不受影响。

## 8. 来源

Node 文档（按版本 tag 固定，均为本次查询时读取的原文）：

- Node v22.23.3 `doc/api/module.md`：https://raw.githubusercontent.com/nodejs/node/v22.23.3/doc/api/module.md
- Node v24.19.0 `doc/api/module.md`：https://raw.githubusercontent.com/nodejs/node/v24.19.0/doc/api/module.md
- Node v22.23.3 `doc/api/errors.md`：https://raw.githubusercontent.com/nodejs/node/v22.23.3/doc/api/errors.md
- Node v24.19.0 `doc/api/errors.md`：https://raw.githubusercontent.com/nodejs/node/v24.19.0/doc/api/errors.md
- Node v22.23.3 `doc/api/typescript.md`（.cts 永远按 CommonJS 运行）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/doc/api/typescript.md

Node 源码（按版本 tag 固定）：

- v22.23.3 `lib/internal/modules/run_main.js`（shouldUseESMLoader 64-100 行）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/lib/internal/modules/run_main.js
- v22.23.3 `lib/internal/modules/cjs/loader.js`（resolveForCJSWithHooks 1021 行、Module._load 1216 行、parentURL 1049-1056 行）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/lib/internal/modules/cjs/loader.js
- v24.19.0 `lib/internal/modules/cjs/loader.js`：https://raw.githubusercontent.com/nodejs/node/v24.19.0/lib/internal/modules/cjs/loader.js
- v22.23.3 `lib/internal/modules/esm/translators.js`（loadCJSModule 126-198 行，重造 require 142 行）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/lib/internal/modules/esm/translators.js
- v24.19.0 `lib/internal/modules/esm/translators.js`（loadCJSModuleWithSpecialRequire 111-190 行，143-144 行注释）：https://raw.githubusercontent.com/nodejs/node/v24.19.0/lib/internal/modules/esm/translators.js
- v22.23.3 `lib/internal/modules/esm/module_job.js`（ModuleJob.runSync 293-330 行、instantiateSync 302 行、ModuleJobSync 362 行起）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/lib/internal/modules/esm/module_job.js
- v24.19.0 `lib/internal/modules/esm/module_job.js`（runSync 382-426 行）：https://raw.githubusercontent.com/nodejs/node/v24.19.0/lib/internal/modules/esm/module_job.js
- v22.23.3 `lib/internal/modules/esm/loader.js`（getModuleJobForRequireInImportedCJS 333 行、getModuleJobForRequire 456 行）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/lib/internal/modules/esm/loader.js
- v22.23.3 `src/module_wrap.cc`（ResolveModule 1030-1071 行）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/src/module_wrap.cc
- v24.19.0 `src/module_wrap.cc`：https://raw.githubusercontent.com/nodejs/node/v24.19.0/src/module_wrap.cc
- v22.23.3 `src/node_errors.h`（123 行错误码定义）：https://raw.githubusercontent.com/nodejs/node/v22.23.3/src/node_errors.h

nodejs/node 的 PR、issue 与 changelog：

- PR #55698（module: implement module.registerHooks()）：https://github.com/nodejs/node/pull/55698
- Issue #56241（module.registerHooks() tracking issue）：https://github.com/nodejs/node/issues/56241
- PR #60380（esm: use sync loading/resolving on non-loader-hook thread）：https://github.com/nodejs/node/pull/60380
- Issue #59666（Always run async loader hooks synchronously from the non-loader thread）：https://github.com/nodejs/node/issues/59666
- Issue #60973（Incorrect parentURL for registerHooks when using require(esm)）：https://github.com/nodejs/node/issues/60973
- PR #60974（module: preserve URL in the parent created by createRequire()）：https://github.com/nodejs/node/pull/60974
- Issue #61801（Request: Backport loader fix to v22.x）：https://github.com/nodejs/node/issues/61801
- PR #62029（[v22.x] backport module loader & loader hook fixes，closed 未合并）：https://github.com/nodejs/node/pull/62029
- Issue #57125（require(esm) always feeds full filepaths to customization hooks but require.resolve doesn't）：https://github.com/nodejs/node/issues/57125
- Issue #60157（VM Module linking unclear error message）：https://github.com/nodejs/node/issues/60157
- Issue #52187（Error: request for 'node:process' is not in cache）：https://github.com/nodejs/node/issues/52187
- v24.15.0 changelog（2026-04-15）：https://nodejs.org/en/blog/release/v24.15.0
- v24.19.0 release（2026-08-03）：https://nodejs.org/en/blog/release/v24.19.0
- v22.23.3 release（2026-09-23）：https://nodejs.org/en/blog/release/v22.23.3
- nodejs/Release 的发布日期表（v22 维护至 2027-04-30，v24 维护至 2028-04-30）：https://raw.githubusercontent.com/nodejs/Release/main/schedule.json

仓内来源：

- 根 `package.json:9-10`（engines）与 `package.json:18`（smoke 串里的 --import）
- `scripts/ts-hook.mts`（同步 registerHooks 与同名 .ts 解析规则，50-54 行是说明符过滤条件）
- 三个链执行器的装载钩子判定：`scripts/verify-chain.ts:36-38`、`scripts/verify-parallel.mts:185-187`、`scripts/verify-all.mts:39-42`
- `tests/verify-1207-splice-ts.ts:41`（`require('../scripts/lib/transpile-domains.mts')`）
- `tests/lib/eval-probe.ts`（说明调用方写 './lib/eval-probe.js'，靠 ts-hook 改指 .ts）
- `.github/workflows/verify.yml`（setup-node 写 node-version: 22）
- `research/1014-q7-node-qa.html`（既有笔记：registerHooks 从 Node 22.15 才有、同步钩子管得到 CJS require；本笔记第 1 节说明它为何不够）

查询日期：2026-10-26（Asia/Shanghai）。
