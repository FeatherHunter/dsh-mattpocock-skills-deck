# 市场更新把插件 fiber 摘掉之后，那一趟 runGh 还在往已销毁的上下文上建计时器（#1392 调查笔记）

> 票 #1392 · 只读调查，不改生产代码 · 落盘日期 2026-10-22
> 基线提交 `b2bdfbcf`（2026-10-22 19:16:09 +0800，提交标题「把构建生成的包内说明版本注释更新到 beta.9，使构建后工作树保持干净（#1389 收尾）」），当前分支 `main`，动笔时工作树干净。下文凡写「当前树」都指这个提交。
> 数据来源：本机 DSH 桌面 0.2.1-rc.2 自带的包源码（`D:/DeepseekHarness/resources/app.asar/dsh/node_modules/@deepseek-ai/…`，那是 asar 归档；普通独立 node 进程读不到归档内部的路径，带 asar 支持的运行时（宿主进程与本会话的 DSH 工具运行时）可以，下文行号都按归档内原始文件算）、本仓 `src/` 与 `package/lib/`、npm 上 `dsh-mattpocock-skills-deck@1.9.0-beta.5` 的包（解包在 `%TEMP%\1392`）、本机桌面端的崩溃日志与 profile 清单、一次在内存里跑通的最小复现。

## 一、结论

**一句话：** 崩溃不是「等 gh 子进程落定之后才建计时器」，而是**市场更新先把这条插件从运行中的组合里摘掉、销毁了它的 fiber，随后那一趟还没跑完的 `runGh` 醒来，在已经销毁的上下文上同步调 `timer.timeout(毫秒)`**；计时器的 Promise 档内部要 `ctx.effect(...)`，cordis 对已销毁的 fiber 直接抛 `INACTIVE_EFFECT`，这个 Promise 拒绝没人接，被宿主「任何未处理拒绝都致命」的出口带走整个进程。

| 层次 | 谁的问题 | 一手证据 |
|---|---|---|
| 计时器服务 | `timeout(毫秒)` 那一档建 effect 前不判「所属 fiber 还在不在」，把 cordis 的异常原样抛给调用方 | `…/@deepseek-ai/cordis-plugin-timer/lib/index.js:37-45` |
| cordis | `Fiber.effect` 先 `assertActive()`；fiber 销毁时 `uid` 被清成 `null`，再建 effect 即抛 `INACTIVE_EFFECT` | `…/cordis/lib/index.js:1131-1134`、`:1169-1171`、`:1078` |
| 宿主插件管理器 | `removeBundle` 先取消选择并 `reload()`（组合被重算、条目被停），**之后**才查 `bundle-in-use` 并拒绝 | `…/dsh-plugin-manager/lib/index.js:2144-2148` |
| 宿主启动/退出 | `installFailLoud` 把任何未处理的 Promise 拒绝当致命错误，打一行标签后 `exit(1)` | `…/dsh-app-boot/lib/index.js:4171-4254` |
| 本插件 | `runGh` 在两个 await 之后、且不在 `try` 里同步调 `timer.timeout`；撞上已销毁就没人接这一下 | `src/host/git-process.ts:211`、`:213`、`:232`、`:234-243` |

## 二、逐条回答

### Q1. `INACTIVE_EFFECT` 的准确机制

- 抛错的判定只有一句：`Fiber.assertActive()` 里 `if (this.uid !== null) return`，否则抛 `new CordisError('INACTIVE_EFFECT')`（`…/@deepseek-ai/cordis/lib/index.js:1131-1134`）；错误正文来自 `CordisError.Code.INACTIVE_EFFECT = 'cannot create effect on inactive context'`（同文件 `:999`）。`Fiber.effect()` 在 `:1169-1171` 先调 `assertActive()`，再判 `state === 5`（正在卸载）。
- `uid` 什么时候变 `null`：fiber 的销毁器一进来就 `this.uid = null`（`:1078`），然后才 `_setEpoch(INACTIVE)` 与 `_unload()`。源码注释写明这个字段的含义是「位于注册表里的唯一编号；根 fiber 是 0，销毁后是 null」（`:1012-1013`）。所以「已经销毁」的判据就是 `uid === null`。
- 为什么 `ctx.get('timer')` 在销毁之后仍返回服务：`Context.get(name, strict)` 只检查**服务提供方**的 fiber 是否活着（`:763-772` 的 `_getImpl`：`if (strict && impl.fiber.state !== 2) return`），从不检查调用方自己。提供方（计时器插件）好端端活着，所以服务照给，报错要等到真正建 effect 那一步。
- effect 建在谁身上：服务的方法经 traceable 代理重绑到**调用方**的 ctx。`getTraceable` 给函数成员包一层 `createShadowMethod`，`apply` 里 `if (thisArg === outer) thisArg = shadow`，再 `return getTraceable(ctx, Reflect.apply(...))`（`:117-122`；崩溃栈里 `Object.apply (…/cordis/lib/index.js:120:36)` 就是这一行）；访问器的 `get` 在 `prop === tracker.property` 时直接返回调用方 ctx（`:128`），而计时器插件的 `ctx.mixin('timer', …)` 走的是这条访问器（`…/cordis-plugin-timer/lib/index.js:4-15`）。所以 `timer.timeout(...)` 里的 `this.ctx` 是**本插件那条 fiber 的 ctx**，`this.ctx.effect(...)` 的 effect 挂在本插件身上，本插件一销毁，下一次调用就抛。
- 计时器 Promise 档的原话（`…/cordis-plugin-timer/lib/index.js:37-45`）：

  ```js
  const { promise, resolve, reject } = Promise.withResolvers();
  const dispose = this.ctx.effect(() => {
    const timer = setTimeout(resolve, delay);
    return () => { clearTimeout(timer); reject(new Error("Context has been disposed")); };
  }, "ctx.timeout()");
  return promise.finally(dispose);
  ```

  崩溃栈里的 `Proxy.timeout (…/cordis-plugin-timer/lib/index.js:38:29)` 就是这一段的 `this.ctx.effect(` 处。

### Q2. 为什么一次拒绝能带走整个宿主

- 出口：`…/@deepseek-ai/dsh-app-boot/lib/index.js:4216-4254` 的 `installFailLoud`。它注册 `onRejection = (err) => report(err, 'fatal load failure')`（`:4240-4243`）与 `onException = (err) => report(err, 'fatal uncaught exception')`（`:4244-4245`）；`report` 先往 stderr 写 `${binName}: ${label}: ${inspect(err, {depth:4, maxArrayLength:50})}`，没有 release 回调就直接 `process.exit(1)`，有 release 就与 `FAIL_LOUD_RELEASE_TIMEOUT_MS`（2 秒，`:4172-4175`）赛跑后再退。
- 安装时机：`…/@deepseek-ai/dsh/lib/profile-boot-C14i-8IN.js:286` 在 `runProfile` 里、`boot()`（`:302`）之前调用它，之后从不卸载。**所以它覆盖整个运行期，不是只在加载那一刻生效**；`fatal load failure` 只是写在 `onRejection` 里的固定标签，与「错误发生在加载期」无关。
- 有没有「任何未处理拒绝都退出」的明说：有。同一函数的文档注释（`:4171-4215`）原话是 `turn an unhandled rejection or an uncaught exception, at any point in the process lifetime, into one labelled stderr diagnostic and exit(1)`，并解释了为什么不回到失败的现场：`Control never returns to the failed operation after either: only the throw site knows which state is intact …`。所以这是有意的设计，不是意外。
- 从 `runGh` 到出口中间经过谁：`runGh` 是 async 函数，`:232` 的同步抛出让它返回的 Promise 变成拒绝；`src/host/index.ts:92` 的包装 `async function runGh(...args){ const h = await _repo(); return h.runGh.apply(h,args) }` 原样把拒绝交上去；调用方（我没有定位到具体是哪一个，见第五节）没有接，于是成为进程级未处理拒绝。
- 现场的旁证：本机 `C:/Users/辰辰洋洋/AppData/Roaming/@deepseek-ai/dsh-desktop/logs/` 下有两张同栈历史崩溃日志——`crash-2026-10-20T15-46-11-138Z-host.log` 与 `crash-2026-10-21T16-03-01-108Z-host.log`，都写着 `dsh: fatal load failure: CordisError: cannot create effect on inactive context`、`code: 'INACTIVE_EFFECT'`，栈同样穿过 `Fiber.assertActive → Fiber.effect → Proxy.timeout → Object.apply → Object.runGh`（10-21 那张落在 `D:/dsh-plugin/dsh-mattpocock-skills-deck/package/lib/git-process.js:149:22`）。同一崩溃至少出现过三次（10-20、10-21、票里的 10-22），不是偶发。

### Q3. 市场更新时 fiber 到底在哪一刻被销毁

**已证实（读到源码与清单）：**

1. `removeBundle(name)` 的顺序（`…/dsh-plugin-manager/lib/index.js:2137-2164`）：先取 bundle、判可移除；记下 `contributions = this.bundleRows(name)`（`:2143`，即这个 bundle 在补丁层里插入/修改的行）；**如果这个 bundle 处于启用状态，就先 `await this.selectBundle(name, false)`、再 `Object.assign(result, await this.reload())`**（`:2144-2147`）；做完这些，才在 `:2148` 扫一遍 `this.ctx.loader.entries()`，只要有一个 `entry.fiber?.uid != null` 且 id 与 name 都命中 `contributions`，就抛 `ManagementFailure('bundle-in-use')`。也就是说，**「拒绝」发生在组合已经被动过之后**，拒绝本身不回滚。
2. `selectBundle(name,false)` 只改 profile 清单里 `dsh.profile.bundles` 那一串（`:2280-2306`，写的是 `manifest.dsh.profile.bundles`）。
3. `reload()` 在有 hmr 时走 `await hmr.reconcileProfile(requiredIds)`（`:2360-2372`）。`reconcileProfile` 的文档注释把「取消选择」的后果写得很清楚：`Recompose the profile from its manifest and patch files, replacing running plugins whose loaded files … changed on disk … Afterwards the modules below the mappings the recomposition dropped are evicted, so a removed or deselected package is imported afresh when it returns.`（`…/@deepseek-ai/dsh-hmr/lib/index.js:1307-1319`）。实现上它先按「磁盘上文件变过的模块」挑出要停的条目（`:1339-1348`），再 `await recomposeProfile(root, patches, 'dsh', { requiredIds, running })`（`:1359-1362`）。
4. `recomposeProfile` 里，新一代不再列出的行会被 `row.parent.remove(row.options.id)`，然后 `await Promise.allSettled(fibers.map(f => f.await()))` 等这些 fiber 销毁完（`…/dsh-app-boot/lib/index.js:3821-3836`）；注释说明这个先后顺序是刻意的：`The rows the generation no longer lists are removed first and their disposal finishes while their packages are still mapped`（`:3765-3772`）。
5. 拒绝给用户看的文案来自 dshmarket 对错误码的渲染，不是现场再查一次：`…/dshmarket/src/official-desktop.ts:52-77` 的 `REFUSAL_COPY` 把 `bundle-in-use` 翻成「这个插件正在使用中，桌面端不允许现在移除 / the plugin is in use, and the desktop app will not remove it right now」（`:61-64`）。它的 `installOrReinstall()` 是「先 install，遇到 already-installed 再 `removeBundle`、然后重装」（`:127-154`，`:150`）。本机 profile 里装的是 **1.66.39**，不是票面写的 1.66.38（`C:/Users/辰辰洋洋/.dsh/profiles/desktop/node_modules/dshmarket/package.json`）。
6. 本插件这个 bundle 的补丁层插的是**两行**，不是一行（`C:/Users/辰辰洋洋/.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck/cordis.patch.yml`，beta.5 包里的同名文件与之同形）：

   ```yaml
   - insert:
       - id: dsh-mattpocock-skills-deck
         name: 'dsh-mattpocock-skills-deck'
         config: {}
       - id: dsh-mattpocock-skills-deck-tools
         name: 'dsh-mattpocock-skills-deck/tools'
         config: {}
   ```

   `:2148` 的判据是「**任意一个** id+name 都命中的活条目」，所以这两行里只要有**一行**在检查那一刻还活着，整次移除就被拒绝；而崩溃只需要**宿主那一行**的 fiber 已经被销毁。两件事可以同时成立，并不矛盾。

**推断（没有现场日志，只能列候选）：**

- 候选一：`:2148` 看到的是另一行（`dsh-mattpocock-skills-deck-tools`）还活着，或者新一代把同一行重新建了出来；崩溃的那条 `runGh` 属于刚被销毁的宿主行。这与「拒绝文案成立、fiber 又被销毁过」两个事实都相容。
- 候选二：这次 `removeBundle` 根本没进 `:2144` 的分支（`bundle.enabled` 为假，`:1700` 的判据是「名字是否在 `dsh.profile.bundles` 里」），于是没有 `reload()`、也没有销毁，检查直接看到原来的活行；那么销毁发生在此前另一次重算里（例如市场先把新包落盘，HMR 发现模块文件变了就停旧行再起新行，`:1339-1348`）。
- **查不到**：10:02 那次更新的直接记录。`.dsh-market/log.ndjson` 的最后一条是 `2026-10-21T18:46:59.328Z`（本地 2026-10-22 02:46），之后没有 10-22 的记录；profile 目录在 09:58–10:10 之间也没有任何文件被写（`package.json` 的 mtime 已被 19:10 的后续操作覆盖）。所以「这次更新走的是市场页还是应用内更新入口」也定不下来。

### Q4. `runGh` 的真实销毁窗口（票面那句话不成立）

- 当前树 `src/host/git-process.ts` 里 `runGh` 起于 `:194`，关键几行是：`:211` `const rkRelease = await getGhLane(logCtx).acquire({ bucket: rkBucket })`；`:213` `const exe = await resolveGh()`；`:217` `reportOutbound(args)`（同步）；`:220` `handle = subprocess.spawn({...})`（同步，在 try 内）；`:232` `const to = timer.timeout(rkTimeout)`。
- **`:220` 到 `:232` 之间没有 await**，`reportOutbound` 是同步函数（`:154-162`，内部 try/catch 掉一切异常）。所以「等 gh 子进程落定之后才调 `timer.timeout`」与源码不符：子进程刚刚起、`handle.done` 还没被 await，计时器就已经建好了。
- 真正的销毁窗口只有两处：等 gh 并发名额的 `:211`（排到队时是纯 Promise，`src/host/outbound/admission.ts:137-200`，不碰 fiber）与解析 gh 可执行文件的 `:213`（`resolveGh` 里 `:168` 等 platform、`:172` 等 `platform.resolveExecutable('gh')`）。fiber 在这两个 await 的任意一个里被销毁，醒来后就会在 `:232` 撞上。
- 还有一种同样落在这个栈上的情形：fiber 在 `runGh` 被**调用之前**就已经销毁——那时 `:211` 的 acquire 通常立即返回、`:213` 命中 `getGhPath()` 早返回（`:167`），一路同步走到 `:232` 抛。这两种情形从栈上分不开。
- 顺带一个真问题（票面没提）：`:232` 在 `try`（`:234`）之外，抛出时 `:220` 起的子进程与 `:211` 拿到的名额都没人收——`rkRelease` 只在 `:228` 与 `:241` 的 catch 里调，`handle.terminate()` 只在 `:237` 的超时分支里调。崩溃那一刻正在跑的 gh 子进程会自己结束（或变成孤儿），但**准入名额会一直占着**，直到插件重载。

### Q5. beta.5 与当前树的差异

- beta.5 的构建产物不在 git 里：`.gitignore:37` 把 `/package/lib/` 整个忽略了，`git show ea0dc073:package/lib/git-process.js` 会报 `fatal: path 'package/lib/git-process.js' exists on disk, but not in 'ea0dc073'`。要看那一版只能看 npm 包——我 `npm pack dsh-mattpocock-skills-deck@1.9.0-beta.5` 解包到 `%TEMP%\1392\pkg\package`。
- beta.5 的 `lib/git-process.js`（489 行）：`:106` `async function runGh(args, cwd)`；`:117` `await getGhLane().acquire(...)`；`:118` `await resolveGh()`；`:129-135` `subprocess.spawn({...})`；**`:147` `const to = timer.timeout(rkTimeout);`（第 22 列正是 `timeout`）**；`:150-156` 才 `await Promise.race([handle.done, to.then(...)])`。所以票面栈里的 `lib/git-process.js:147:22` 就是这一条「spawn 之后、等子进程之前」的 `timer.timeout`。
- 当前树 `package/lib/git-process.js`（514 行）里 `timer.timeout` 在 `:59`、`:150`、`:301`，与 beta.5 的 `:147` 是同一条语句，只多了 3 行偏移。
- 当前树**没有任何防护**：在 `src/` 里 grep `INACTIVE_EFFECT` / `ctx.active` / `ctx.fiber` / `Context has been disposed`，只命中一处注释（`src/shared/host-timer/src/host-timers.ts:26`），没有一处判活或接异常。历史崩溃日志里那一版落在 `:149`，说明 10-21 跑的也是同一形状的本地链接包。

### Q6. 修复选项与代价（只评估，不实施）

| 选项 | 具体写法 | 代价 | 覆盖多少同类点 | 判断 |
|---|---|---|---|---|
| A. 在 `runGh` 的就地接住 | `try { const to = timer.timeout(rkTimeout) } catch (e) { if (e && e.code === 'INACTIVE_EFFECT') { 补 release 与 terminate；log；return { ok:false, kind:'disposed', error:'插件上下文已销毁' } } throw e }` | 小；不动类型（`GhCallFail.kind` 本来就是 `string`，`src/host/git-process.ts:93-96`），不动调用方（49 处调用点里没有按 `kind` 穷举的） | 只覆盖 `:232`（+ 同形的 `:342` 若一起改） | **这一票该做的止血**。必须同时补上名额释放与子进程收尾，否则等于用一个泄漏换一次不崩 |
| B. 建 effect 前判活 | issue 建议的 `ctx.active` 不存在：会被当成服务查找，抛 `cannot get property "active" without inject`（`…/cordis/lib/index.js:676-698`，最小复现里实测到）。可用 `ctx.fiber.uid === null`（`:1054` 保证 `fiber` 是 ctx 的自有属性）或 `ctx.fiber.state === 4` | 中：`git-process.ts` 这一层**没有 ctx**，手里只有 `TimerLike`（`:81-82`）；要在 `src/host/index.ts:82` 的接线处多注入一份「判活/包装过的 timer」，`HostCtx`（`:12`）也要跟着加字段 | 覆盖所有经同一个包装的调用点，但每处都得改成走包装 | 可以做，但单独做 B 解决不了「判完到建 effect 之间」以外的语义问题（同一 tick 内没有别的代码能插入，所以 B 在正确性上够用）；建议与 C 合并成一层，而不是散在调用点 |
| C. 收成共用缝 | 在 `src/shared/host-timer/` 里加一个「Promise 档」的包装：先判活、再建 effect，撞上 `INACTIVE_EFFECT` 归一成一个可辨认的拒绝 | 中；要新增接口与门禁，且这个目录不许 import 宿主专属能力（`host-timers.ts:39-41`） | 宿主侧 Promise 档共五处：`platformChannel.ts:390`、`detectChain.ts:403`、`git-process.ts:180/:232/:342`、`versionControl.ts:127`（回调档 `namingGuardian.ts:99/:252`、`logStore.ts:87` 不同病） | 正确的长期解法，**但比 A 大一档**；#1115 已经把回调档收成 `hostTimers`/`cancelHostTimer`，且文件头明说 Promise 档「外部撤不掉、只有所属 fiber 被销毁时才会被拒」（`:25-26`）、`cancelHostTimer` 对 Promise 形状是空操作（`:66`）——所以 C 不是改 `cancelHostTimer`，而是新加一档 |
| D. 上游修 | 把 `bundle-in-use` 检查前移到动组合之前；或让 remove 变成原子操作、拒绝时回滚；或把 `unhandledRejection` 分级（插件级拒绝只停插件） | 本仓改不了；要报给上游 DSH | 覆盖面最大（所有插件都受益），但周期不由我们定 | 另立「报上游」的事，不塞进这一票 |
| E. 生命周期钩子里统一撤销在飞计时器 | 在插件的 dispose 钩子里把所有 Promise 档 timer 撤掉 | 大；而且**治不了这一处**——崩溃恰恰是「fiber 已经销毁、计时器还没建出来」，此时没有任何句柄可撤 | 只对「销毁前已建好」的那些有用，而那一档本来就会以 `Context has been disposed` 被拒（最小复现第 10 步） | 不推荐做成本票方案 |

结论：**这一票做 A，并把「名额与子进程收尾」写进验收**；同时开一张新票做 C（把 Promise 档收进 `src/shared/host-timer/`，五个调用点一起换），再单独给上游报 D。别把 A 写成「只 catch 不收尾」，也别用 E 糊过去。

另外两处相邻但不同的票：#1114（open，「工具等待超时的定时器用完不清」）讲的是定时器不该活那么久；本票讲的是「fiber 没了还要建」。两者都在 `timer.timeout` 这一族上，但修法不重叠。

### Q7. 能不能写一条不碰宿主的门禁

能，但要分清它能证到哪一层。

- **能证（建议写）**：`tests/verify-1115-timer-handle.ts` 已经用假计时器服务验证过句柄撤销形状（文件 25.8 KB）；照它的模式造一个 `timeout` 直接抛 `Object.assign(new Error('cannot create effect on inactive context'), { code:'INACTIVE_EFFECT' })` 的假 timer，传一个假的 `subprocess.spawn`（返回 `{ done: Promise, terminate(){}, collected }`）与假 lane，断言：`runGh` 返回 `{ ok:false, kind:'disposed' }` 而不是让 Promise 拒绝、`rkRelease` 被调用、`handle.terminate()` 被调用。这能锁住 A 的回归。
- **实测（已做，见第三节）**：在内存里装**真的** cordis 4.0.5 与真的 `@deepseek-ai/cordis-plugin-timer@1.1.7`，销毁 fiber 后调 `timeout(毫秒)`，能复现出一模一样的四层栈，并证明拒绝会以 `dsh: fatal load failure: …` 的形式让进程 `exit(1)`。
- **测不到**：真宿主里「市场更新那一刻恰好有一趟 `runGh` 在飞」这个时序。要真验，只能按票面的现场步骤（让一条慢 gh 命令在飞，同时更新本插件）；这一条不适合进常跑门禁。
- 限制：门禁用的假 timer 只复现「抛什么」，不复现 cordis 的内部状态；真 cordis 那份要靠第三节的实验脚本，而那个脚本依赖本机安装包，**不能进仓库、也不能进 CI**（DSH 版本一变，行号与行为都可能变）。

## 三、最小复现（脚本在 `%TEMP%\1392`，不进仓库）

目的：把「销毁之后仍能用抓在手里的 timer，但一调就抛」这件事从源码推断变成可重复的实测。

做法：`app.asar` 是归档，普通独立 node 进程读不到里面的文件；我用带 asar 支持的 DSH 工具运行时把三个包（`@deepseek-ai/cordis@4.0.5`、`@deepseek-ai/cordis-plugin-timer@1.1.7` 及其依赖 `@deepseek-ai/cosmokit@1.8.6`）原样拷到 `%TEMP%\1392\node_modules`，再用普通 node 跑。两个脚本：

- `repro.mjs`：`new Context()` → `root.plugin(TimerService)` → 再装一个「受害者」插件，在它的 `apply(ctx)` 里 `ctx.get('timer')` 抓下服务（等价于 `src/host/index.ts:26`）→ 起一趟「先 await 30 毫秒、再同步调 `captured.timeout(5000)`」的调用（等价于 `git-process.ts:211/213` 与 `:232` 的形状）→ 在那一趟 await 期间 `await victimFiber.dispose()`。
- `fail-loud.mjs`：同样的形状，但按 `installFailLoud` 的语义挂一个 `process.on('unhandledRejection', …)`，一种模式让拒绝无人接，另一种模式在 `:232` 的位置 try/catch 后返回 `{ ok:false, kind:'disposed' }`。

实测输出（节选）：

```text
cordis 4.0.5 | timer @deepseek-ai/cordis-plugin-timer@1.1.7
1) 根上下文上 timer 服务可用: true
2) 插件存活时抓到的 timer 是: timer | 插件 fiber.uid = 2 | state = 2
3) 销毁后: fiber.uid = null | state = 4
4) 那一趟 runGh 形状的调用 -> REJECTED: Error: cannot create effect on inactive context | code = INACTIVE_EFFECT
     at Fiber.assertActive (…/cordis/lib/index.js:1133:9)
     at Fiber.effect (…/cordis/lib/index.js:1170:8)
     at Proxy.timeout (…/cordis-plugin-timer/lib/index.js:38:29)
     at Object.apply (…/cordis/lib/index.js:120:36)
5) 销毁后 ctx.get('timer') 仍返回服务: true
6) 销毁后再调 captured.timeout(5000) -> THROW: … code = INACTIVE_EFFECT
7) 读 victimCtx.active -> THROW: cannot get property "active" without inject
8) 读 victimCtx.fiber.uid -> OK: null
9) 读 victimCtx.fiber.state -> OK: 4
10) 销毁前就建好的 timer 档: rejected: Context has been disposed
```

```text
=== baseline ===            （没人接这次拒绝）
dsh: fatal load failure: CordisError: cannot create effect on inactive context
    at Fiber.assertActive (…:1133:9) … at Object.apply (…:120:36) … EXITCODE=1
=== guarded ===             （在调用的地方接住）
guarded -> returned: {"ok":false,"kind":"disposed","error":"cannot create effect on inactive context"} | 进程仍然活着, exitCode = 0
```

证明了三件事：(1) 四层栈与票面逐帧一致，说明票面栈确实是这条语句；(2) `ctx.get('timer')` 在销毁后照给服务，报错只在建 effect 那一步；(3) 这一次拒绝不被接住就走 `exit(1)`，接住则进程活着。
没有证明：真宿主里销毁的时机是不是恰好落在 `:211/:213`（本机没点市场更新复现）；也没证明拒绝的调用方是谁。

## 四、不确定与没有验证的

1. **没有在真宿主里复现这次更新**：本机市场日志最后一条是 `2026-10-21T18:46:59.328Z`，此后没有更新记录；profile 目录在 09:58–10:10 之间没有任何文件被写。所以「10:02 那次是市场页发起的 remove-then-install」目前只是间接推断（文案与 `REFUSAL_COPY` 完全一致），不是直接证据。
2. **Q3 的两个候选没有分辨出来**：是另一行（`…-tools`）还活着，还是新一代把同一行重建了出来，还是这次根本没进 deselect 分支，需要那天的宿主日志或上游源码才能定。
3. **是哪个调用方起的这趟 gh 也没查到**：`~/.dsh/logs/dsh-mattpocock-skills-deck` 只有 2026-10-15 的一行、当天没有 `startup-*.log`；10-22 那张崩溃日志在 `logs/` 里也不存在（只有 10-20、10-21 两张）。
4. **版本是否完全对齐**：崩溃时是插件 1.9.0-beta.5、dshmarket 1.66.38；本机现在装的是 beta.8 / dshmarket **1.66.39**，profile 里的 `package.json` 也在 19:10 被改过。我核过的 DSH 运行时是 0.2.1-rc.2，与票面一致；beta.5 的产物取自 npm 包，而不是崩溃机器上的那一份字节。
5. **其余几处 `timer.timeout` 是否会走进同一条路**：`execProc`（`git-process.ts:342`）、`detectChain.ts:403`、`platformChannel.ts:390`、`versionControl.ts:127` 的形状相同（await 之后同步建），但我只逐行核了 `execProc`，其余没有逐个确认调用时机。
6. **客户端侧不算在内**：`src/client/**` 另有十来处 `timer.timeout`，跑在另一套上下文里，本票没有涉及。

## 五、数据来源与只读声明

读过的文件与版本：

- DSH 运行时：`D:/DeepseekHarness/resources/app.asar/dsh/package.json`（`@deepseek-ai/dsh-desktop-runtime` 0.2.1-rc.2）。`app.asar` 是归档（182 MB），普通独立 node 进程读不到里面的路径；带 asar 支持的运行时（宿主进程、本会话的 DSH 工具运行时）可以。下文行号都按归档里的原始文件算。
- `…/node_modules/@deepseek-ai/cordis/lib/index.js`（4.0.5，1830 行）：`:999`、`:1012-1013`、`:1054`、`:1078`、`:1131-1134`、`:1169-1171`、`:117-122`、`:128`、`:676-698`、`:763-772`、`:1288-1292`。
- `…/node_modules/@deepseek-ai/cordis-plugin-timer/lib/index.js`（1.1.7，152 行）：`:4-15`、`:24-47`。
- `…/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js`（2421 行）：`:1700`、`:2137-2164`、`:2280-2306`、`:2360-2372`、`:2373-2401`。
- `…/node_modules/@deepseek-ai/dsh-hmr/lib/index.js`（1466 行）：`:1307-1319`、`:1320-1385`。
- `…/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`（4567 行）：`:3765-3772`、`:3821-3836`、`:4171-4254`。
- `…/node_modules/@deepseek-ai/dsh/lib/profile-boot-C14i-8IN.js`（`:286` 安装 fail-loud）。
- profile：`C:/Users/辰辰洋洋/.dsh/profiles/desktop/package.json`（`dsh.profile.bundles` 含本插件）、同目录 `cordis.patch.yml`（没有本插件的行）、`node_modules/dshmarket/package.json`（1.66.39）、`node_modules/dshmarket/src/official-desktop.ts`（`:52-77`、`:116-154`）、`node_modules/dsh-mattpocock-skills-deck/cordis.patch.yml`（两行 insert）、`.dsh-market/log.ndjson`（最后一条 `2026-10-21T18:46:59.328Z`）。
- 崩溃日志：`C:/Users/辰辰洋洋/AppData/Roaming/@deepseek-ai/dsh-desktop/logs/crash-2026-10-20T15-46-11-138Z-host.log`、`…/crash-2026-10-21T16-03-01-108Z-host.log`（两张同栈，后者落在 `package/lib/git-process.js:149:22`）。
- 本仓（基线 `b2bdfbcf`）：`src/host/git-process.ts`（`:81-82`、`:93-96`、`:154-162`、`:166-187`、`:194-243`、`:310-358`）、`src/host/index.ts`（`:12`、`:22-28`、`:82`、`:92`）、`src/shared/host-timer/src/host-timers.ts`（全 83 行）、`src/host/outbound/admission.ts`（`:137-200`）、`.gitignore:37`、`tests/verify-1115-timer-handle.ts`（存在，25.8 KB）。
- npm：`dsh-mattpocock-skills-deck@1.9.0-beta.5` 的 tarball，解包在 `%TEMP%\1392\pkg\package`（`lib/git-process.js` 489 行，`:147` 是 `timer.timeout`）。

相关票（只取标题，没读全文）：#1115（closed，宿主计时器交回可调用句柄）、#1114（open，工具等待超时的定时器用完不清）、#1314（open 地图，插件日志持久化读回失败与宿主反复启动）、#1348（open，查清真实宿主进程一天里被重复装配一到十一次的触发点）。仓内既有笔记里最接近的两篇是 `research/1311-client-bundle-reload-signal.md` 与 `research/206-session-naming.md`，前者讲客户端 bundle 热更、后者讲会话命名，都不涉及宿主 fiber 销毁，所以本次不重复调研它们。

只读声明：本次没有改任何生产代码、没有提交、没有跑市场更新或桌面端；实验脚本与解包目录都在 `%TEMP%\1392` 下，仓库里唯一新增的文件就是本笔记。
