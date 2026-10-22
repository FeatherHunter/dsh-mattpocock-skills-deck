# 市场更新时插件 fiber 已被销毁：runGh 调 timer.timeout 撞上 INACTIVE_EFFECT（#1392 调查笔记）

> 票 #1392 · 只读调查，不改生产代码 · 落盘日期 2026-10-22
> 基线提交 35761d8b（2026-10-22 17:48:34 +0800，修好构建锁读时间参数时对旧生成物的误判，让合入后第一次构建能自动重算（#1390））
> 数据来源：本仓 src/host/git-process.ts 源码；本机 DSH 桌面 0.2.1-rc.2（D:/DeepseekHarness/resources/app.asar/dsh）自带的 @deepseek-ai/cordis 4.0.5、cordis-plugin-timer 1.1.7、dsh-plugin-manager、dsh-hmr、dsh-app-boot 包源码；本机两张历史崩溃日志；内存内最小复现。

## 一、结论（先看这七条）

1. `INACTIVE_EFFECT` 只在「往已经销毁的 cordis fiber 上建 effect」时抛出。计时器服务的 `timeout(毫秒)` 那一档内部就是 `ctx.effect(...)`，所以 fiber 销毁后调用必抛。已在内存里最小复现（见第二节）。
2. 本仓的触发点是 `src/host/git-process.ts:232` 的 `const to = timer.timeout(rkTimeout)`：它在 spawn 之后**同步**执行，而且不在 `:234` 那个 try 里面，抛出的 `CordisError` 会让 runGh 返回的 Promise 变成失败。
3. 崩溃范围是整个宿主，不是插件：宿主的 `installFailLoud` 把任何**未处理的 Promise 拒绝**当致命错误，打印 `dsh: fatal load failure: …` 后 `process.exit(1)`。「fatal load failure」只是标签，并不代表错误发生在加载期。
4. runGh 真正会被「隔空打断」的窗口是起进程前的两个 await：`:211` 等 gh 并发准入、`:213` 解析 gh 可执行文件。**票面写的「等 gh 子进程落定之后才调 timer.timeout」与源码不符**：timer.timeout 在 spawn 之后立刻同步调用，与子进程何时结束无关。
5. 市场更新路径会先动运行中的组合、后拒绝：`removeBundle` 先 `selectBundle(name,false)` + `reload()`（这一步会移除条目并 await fiber 销毁），之后才检查 `bundle-in-use`。所以「更新被拒绝」并不等于「插件没被动过」，在飞的那一趟 runGh 已经站在已销毁的 fiber 上。
6. 同一崩溃至少出现过三次：本机有两张同栈历史崩溃日志（2026-10-20、2026-10-21），票里报的 10-22 是第三次。
7. 本仓当前树没有修复，也没有相关分支/提交/CHANGELOG 记录；beta.5 的源码顺序与当前树一致。

## 二、INACTIVE_EFFECT 的产生机制（已复现）

- `cordis/lib/index.js:1131-1133` 的 `Fiber.assertActive()`：`this.uid !== null` 才通过，否则抛 `CordisError("cannot create effect on inactive context")`，code 是 `INACTIVE_EFFECT`。
- `Fiber.effect()` 在 `:1169-1171` 先调 assertActive，再判断 fiber 状态是否为已销毁（5）。
- `cordis-plugin-timer/lib/index.js:38` 的 Promise 档 `timeout(毫秒)` 实现：`Promise.withResolvers()` 后 `this.ctx.effect(() => { const timer = setTimeout(resolve, delay); return () => { clearTimeout(timer); reject(new Error("Context has been disposed")) } }, "ctx.timeout()")`，最后 `promise.finally(dispose)`。
- 服务方法经过 traceable 代理重绑到**调用方**的 ctx（`cordis/lib/index.js:117-145` 的 createShadowMethod / createTraceable），所以 `timer.timeout` 建的 effect 挂在调用插件的 fiber 上；调用方 fiber 一销毁，下一次调用就抛。
- `Context.get(name, strict=true)`（`cordis/lib/index.js:763`）只检查**服务提供方**的 fiber 是否活着，不检查调用方自己。因此销毁之后 `ctx.get('timer')` 照样返回服务对象，报错要等到真正建 effect 那一步。
- 内存复现（未改仓内文件）：`new Context()` → `root.plugin(TimerService)` → 子插件 `inject: ['timer']`，在 apply 里捕获 `ctx.get('timer')` → `await fiber.dispose()` → `timer.timeout(1000)` 抛 `CordisError code=INACTIVE_EFFECT message="cannot create effect on inactive context"`；此时 `root.get('timer')` 仍然返回服务。
- 票面建议的 `ctx.active` 判据不存在：访问未知属性会被当成服务查找，抛 `cannot get property "active" without inject`。宿主内部可用的判据是 `ctx.fiber.uid === null` 或 `ctx.fiber.state === 4`（销毁前 uid/state 都是 2），但 **git-process.ts 这一层没有 ctx**——它拿到的 `TimerLike`（`:82`）是 `src/host/index.ts` 从 `ctx.get('timer')` 取出来注入的，所以只能在调用点就地接住异常，或者由接线处注入一个「能判活」的包装。

## 三、为什么一次未处理拒绝会让整个宿主退出

- `dsh-app-boot/lib/index.js` 的 `installFailLoud`（`:4216-4254`）把 `unhandledRejection` 与 `uncaughtException` 都挂到自己身上：`onRejection` 调 `report(err, "fatal load failure")`，`onException` 调 `report(err, "fatal uncaught exception")`。
- `report` 先置 `exiting = true`，再把 `${binName}: ${label}: ${inspect(err, {depth:4, maxArrayLength:50})}` 写进 stderr；没有 release 回调时直接 `process.exit(1)`，有 release 时先 await release 与 `FAIL_LOUD_RELEASE_TIMEOUT_MS` 的赛跑再退出。
- 所以插件里任何没有被本地 try/catch 的异步拒绝，都会以「fatal load failure」的形式带走宿主。票面栈外面那层 `Error: dsh desktop host exited with 1: …` 是 Electron 主进程看到子进程退出后的包装，不是另一个错误。

## 四、市场更新时 fiber 是什么时候被销毁的（上游时序）

- dshmarket（本机 profile 里是 1.66.39）的 `installOrReinstall()`：先 `installBundle(spec)`；遇到 already-installed 就 `removeBundle(name)` 再重装（dsh 0.2.1 对「add 已存在依赖」直接拒绝，见 #896）；市场自身更新被 SELF_NAMES 拦住（#900，对应票里 10:01:51 那条 exit=1）。
- `dsh-plugin-manager/lib/index.js` 的 `removeBundle(name)`（`:2137-2164`）顺序是：
  1. `listBundles()` 找 bundle，不可移除 → `not-removable`；没有 hmr 且已启动/有活 fiber → `stop-profile`；
  2. 记下 `contributions = bundleRows(name)`；
  3. **如果 bundle 是启用状态，先 `await this.selectBundle(name, false)`，再 `await this.reload()`**；
  4. **之后**才检查 `bundle-in-use`：遍历 loader 条目，找 `fiber?.uid != null` 且 id/name 命中 contributions 的条目；
  5. 通过才 `runPnpm(["remove", name, ...])`。
- `reload()`（`:2360-2372`）在装了 hmr 时走 `await hmr.reconcileProfile(requiredIds)`。
- `dsh-hmr/lib/index.js` 的 `reconcileProfile`（`:1320` 起）最后调 `recomposeProfile(...)`；`dsh-app-boot/lib/index.js` 的 `recompose`（`:3794` 起）对「上一份补丁清单里有、新清单里没有」的条目做：`row.options.disabled = true`、`row.parent.remove(row.options.id)`、`await Promise.allSettled(fibers.map((fiber) => fiber.await()))`——即**等这些 fiber 销毁完成**，然后再发布新的 resolution、把保留的条目启动起来。
- 由此得到两个事实：
  1. `bundle-in-use` 的拒绝发生在「取消选择 + 重载」之后，此时这张票涉及的 fiber 已经被移除并 await 过销毁；拒绝之后也**没有回滚**动作。
  2. 不管拒绝的原因为何（见第九节未解问题），拒绝路径已经把组合动过；在飞的 runGh 从此落在已销毁的插件 fiber 上，等它走到 `:232` 就抛 INACTIVE_EFFECT。
- 票面给的复现时间线与此吻合：10:02:22 市场记录 `exit=1`、错误文本正是 `bundle-in-use` 的中英文案（`dshmarket/src/official-desktop.ts` 的 REFUSAL_COPY 原样），10:02:25 宿主崩溃。

## 五、runGh / execProc 的计时器边界（源码逐行）

- `runGh(args, cwd, via?)` 起于 `src/host/git-process.ts:194`：
  - `:196` 归一化字符串字段；`:201-204` 无 cwd 早返回；
  - `:211` `const rkRelease = await getGhLane(logCtx).acquire({ bucket: rkBucket })`；
  - `:213` `const exe = await resolveGh()`；
  - `:220` `handle = subprocess.spawn({...})`（在 try 内）；
  - `:232` `const to = timer.timeout(rkTimeout)`（**try 之外**，与 `:220` 之间没有 await，所以「子进程已结束」不是触发条件）；
  - `:234-243` `try { await Promise.race([handle.done, to.then(...)]) } catch` → 返回 `{ ok: false, kind: 'spawn', error }`。这个 catch 只包住 race，包不到 `:232` 的同步抛出。
- `execProc` 起于 `:310`：`:322` await 准入、`:328-336` spawn、`:342` `const to = timer.timeout(...)` 同样在 `:344` 的 try 之外 → 同类风险。
- `resolveGh` 起于 `:166`：`:168` await getPlatform、`:172` await platform.resolveExecutable、`:180` `timer.timeout` 在 `:176-183` 的 try 内，异常被 `:183` 的空 catch 吞掉 → 不会崩，但会静默。
- 结果类型：`GhCallResult`（`:93-96`）的失败支是 `{ ok: false; kind: string; error: string | null; code?: number; text?: string }`，`kind` 本来就是 string，新增 `kind: 'disposed'` 不需要改类型契约，但调用方对它的语义要交代清楚。
- 其余宿主侧 `timer.timeout` 调用点：`src/host/detectChain.ts:403`、`src/host/namingGuardian.ts:99,252`、`src/host/git-process.ts:180,232,342`、`src/host/platformChannel.ts:390`、`src/host/versionControl.ts:127`。它们是否同样能在销毁后被执行，本次没有逐一核查，列为待办（第九节）。

## 六、已有的相关笔记为什么不够用

- research/ 250 篇里 `INACTIVE_EFFECT` / `inactive context` / `fiber` / `销毁` 没有命中；最接近的三篇：
  - research/749-timers-streams.md：后台定时器清单，没有涉及 fiber 销毁后建 effect；
  - research/1333-host-remount-trigger.md：宿主重载触发点统计，不是市场 remove-then-install 这条路径；
  - research/1311-client-bundle-reload-signal.md：客户端 bundle 热更，和宿主 fiber 无关。
- 仓库已有一份相邻且有用的规范：src/shared/host-timer/src/host-timers.ts（#1115 的共用缝）。它的文件头已经写明「`timeout(毫秒)` 的 Promise 档外部撤不掉，只有所属 fiber 被销毁时才会被拒（'Context has been disposed'）」，并给出了宿主计时器服务两档形状的出处——本次结论与它一致，但那份缝只包了回调档，没有管 Promise 档的销毁判活。
- 本次的新结论见第一、四、五节，尤其是对票面第 147 行「子进程落定后才调 timer.timeout」这一说法的纠正。

## 七、修复选项与代价（给维护者拍板用）

- A. 本仓最小自保：在 `runGh` 与 `execProc` 的 `timer.timeout` 处包一层 `try/catch`，接住 `code === 'INACTIVE_EFFECT'` 后返回 `{ ok: false, kind: 'disposed', error: 'context disposed' }`。代价小，直接消掉宿主崩溃；不解决「已销毁还在跑」的更深问题，调用方若把 disposed 当普通失败可能多打一条日志。
- B. 接线处注入判活能力：`src/host/index.ts` 有 ctx，可以注入 `isActive()` 或包一层 timer。代价是注入面变大，而且 `ctx.fiber.uid` 属于宿主内部结构，DSH 升级时有失配风险。
- C. 收成共用缝：扩 `src/shared/host-timer/src/host-timers.ts`，把「Promise 档建 effect 前判活 / 接住 INACTIVE_EFFECT」做成一份，宿主侧全部同类点共用。代价中等，能防同类复发，但要先确认其余调用点确实会走进这条路径。
- D. 报上游：`removeBundle` 先取消选择并重载、后检查 `bundle-in-use`，且拒绝后不回滚；建议上游把这项检查前移到动组合之前，或者把 remove 做成原子操作。本仓改不了这一层。
- E. 组合：先做 A 止血，同时按 D 报上游，长期用 C 收口。

## 八、可验证性

- 单测可以在不碰真 fiber 的前提下写：tests/verify-1115-timer-handle.ts:360-383 已经用假 timer 服务验证过撤销形状，可照这个模式造一个「`timeout` 抛 INACTIVE_EFFECT」的 fake timer，断言 runGh / execProc 返回 `{ ok: false, kind: 'disposed' }` 而不是让 Promise 拒绝。
- 真机验收步骤与票面一致：让一条几秒的 gh 命令在飞，同时从市场更新本插件；修好后应当看到宿主不退出、日志里那一笔返回 disposed。
- 更彻底的上游验收要等上游修 removeBundle 的顺序，本仓无法验证。

## 九、未解问题与已知缺口

1. 为什么 reload 之后 `bundle-in-use` 还会成立：是 loader 条目的定位/时序问题，还是 profile 的 patch 文件仍然声明着这个 bundle？这一点需要上游源码或现场日志才能定，结论里只写到「拒绝路径已经先把组合动过」。
2. 票里提到的 `crash-2026-10-22T10-02-25-111Z-host.log` 在本机 `C:/Users/辰辰洋洋/AppData/Roaming/@deepseek-ai/dsh-desktop/logs/` 目录里找不到（可能被轮转或清理）；本次结论主要靠 10-20、10-21 两张同栈历史日志与源码复现。
3. 其余 5 处 `timer.timeout` 调用点（detectChain、namingGuardian、platformChannel、versionControl）是否同样能在销毁后被执行，尚未逐一核查。
4. 宿主日志里大量 `client loadSnapshot timeout 30s`、`Failed to fetch` 等 renderer 噪音与本崩溃无关，不要当证据。

## 只读声明与数据来源

- 本次调查没有修改任何生产代码，没有新增分支或提交；cordis 复现实验在内存里完成。
- 引用行号来自本机 DSH 桌面 0.2.1-rc.2 的包源码（D:/DeepseekHarness/resources/app.asar/dsh/node_modules/@deepseek-ai/…）与本仓基线 35761d8b。
- 崩溃日志：C:/Users/辰辰洋洋/AppData/Roaming/@deepseek-ai/dsh-desktop/logs/crash-2026-10-20T15-46-11-138Z-host.log、crash-2026-10-21T16-03-01-108Z-host.log。
