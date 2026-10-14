# #1146 一手取证：时间压缩助手把泵停在「没被引用」的定时器上，门禁少跑断言却判绿

调查对象：`tests/lib/time-compress.js`（虚拟时钟助手）与产品侧五处等待的定时器，以及三条链执行器判定通过/失败的方式。
本文只认三类一手来源：仓内源码（给 `文件:行`）、Node.js 官方文档（给 URL 并已取正文）、GitHub 上本仓 issue 的原文（`gh issue view`）。#1146 自己的票面与评论是我们早先写的，不作为依据，只在文末列出与它的差异。
调查过程中的实验脚本放在仓外的 `D:\Temp\deck1146\`（仓内文件一字未动），下文凡引用实验现象都会写明脚本名与命令。开工前工作树有 74 项未提交改动（`git status --porcelain | Measure-Object -Line`），收工前又量了一次是 83 项——多出来的这些不是我改的：本次调查对仓库文件只做读操作，唯一的写操作是新建本文，实验用的脚本与日志都落在仓外。票里提醒过工作树有别的票的改动在动，请不要把这次的数字变化归到本票。

---

> **复核修正（2026-10-14，诊断 Lead 复核后加；下面四处结论已被推翻或补全，动手前以本节为准）**
>
> 1. **结论速览第 4 条、A1 末尾「对称修法不能断定安全」、E14「要两方向一起做才结实」——错。** 只换助手、门禁一律不动的 12 扇对照，加上 `tests/verify-deck-no-hang.js`「有把手 / 拆掉把手」× 三种助手的配对跑（脚本 `D:\Temp\deck1146\ab2-run.cjs` 与 `ab3-probe.cjs`），实测：**「两方向都重新评估」在拆掉把手的配置下只剩 0 条断言**（今天的助手 12 条、只补 `ref` 21 条）；机制就是 B4 末尾那条交汇点——产品的 `unref()` 打在助手的虚拟句柄上，引用状态一改「对」，进程在第一段等待到点前就收摊。所以 #1146 要写死**只补 `ref` 那一半**，「顺手补 `unref`」反而把门禁打得更差。
> 2. **B4 与其后「与票面说法不一致」第 5 条里「注释与源码用法不符、是自我说明不是事实描述」——错。** 五处注释里的「只为到点提醒」与竞速/超时用法是同一件事（`src/deck/shell/call-shell.ts:105-107` 原文写的就是竞速里赢的一方不清它），注释与用法一致；可以保留的实质判断是 `unref` 的取舍代价（一场竞速里只剩这笔等待时进程会收摊），不是「注释在撒谎」。
> 3. **D13 末尾「709 是与本票成对的反向守卫」——错。** 709 原先兼的「全库不再有自续定时器」源码门禁已于 2026-10 整段撤掉（见该文件头第 3～5 行与第 16 行），今天没有门禁在替「不许吊住」这条口径把关。
> 4. **「与票面说法不一致」第 1 条与 D11 开头说「票面把 repo-resolve 算成用助手的门禁」——要分清对象。** 错的是 **#1146 的正文（作者原文）**；我们自己的**诊断评论已经写明 repo-resolve 不在 12 扇里、只走路二**，不能读成诊断评论犯了同一个错。
> 5. **三项「没查清」已有结果**：① 有把手的现状下，12 扇里 9 扇在三种助手下逐条一致、无吊住（`tests/verify-settings-templates.js` 只差构建耗时；`tests/verify-669-collapsed-recoverable.js`、`tests/verify-settings-debug.js`、`tests/verify-settings-view.js` 因缺依赖 `is-potential-custom-element-name` 在本机跑不起来，两种助手一样崩）；② `uninstallTimeCompression()` 的收尾排水同样会被这条缺陷截断（`:286` 置 `flushing = true` 后 `:289` 调 `armPump()`，而 `:115` 在 flushing 时 `delay` 恒为 0，此后必然满足 `0 >= state.pumpDelay` 走提前 return——源码级结论，未实测）；③ `tests/gate-map.json` 的 `gateCount` 与 `chainLength` 都是 **240**。

## 结论速览

1. 助手确实存在「虚拟队列里还有被引用的等待，泵却停在没被引用的真实定时器上」这个状态。它出现的**唯一入口**是 `tests/lib/time-compress.js:117` 那句 `if (delay >= state.pumpDelay) return`：这一格提前返回，绕过了文件末尾 `:123` 的 `if (!anyReferenced()) { … unref() }`。
2. 只补这一格（在提前返回前，如果还有被引用的等待就把泵 `ref()` 回来）在真实门禁 `tests/verify-deck-no-hang.js` 上把「不变式被破坏」的次数从 6 次降到 0 次，并且断言从 12 条恢复到 21 条。依据：实验 `D:\Temp\deck1146\invariant2.cjs` + `D:\Temp\deck1146\strip-keepalive-run.cjs`。
3. 只补这一格**补不严**。补丁的判据是「提前返回这一刻还有没有等待是被引用的」，而缺陷的成因是「泵的引用状态由上一次走到底的那次调用决定」——同一个成因还会从别的出口漏出来：队列表被清空后重新排入等待、`refresh()` 把到期时间改长、以及「泵不存在但队列非空」的窗口（`armPump` 的第一件事就是 `if (!state.originals) return`，卸载之后就不再管引用状态了）。A2 逐条列了这些路径。
4. 「两个方向都重新评估」（有被引用的等待就 `ref`、没有就 `unref`）在**理论上**会把「进程该不该活下去」这件事的裁决权完全交给本函数，而 Node 明确允许「进程在定时器回调跑之前就退出」（见 A1 的官方原文）。在我能构造的对照实验里没有观察到新问题（`D:\Temp\deck1146\patch-helper.cjs` 的 `symmetric` 模式跑 `tests/verify-deck-no-hang.js` 仍 21 条全过），但因为「拆把手 + 换助手」两处改动叠在一起，这个对照实验有干扰，**不能据此说对称修法一定安全**。
5. 产品的五处等待口确实都是竞速/超时用法，不是「只为到点提醒」；给它们 `unref` 是 #1114 的**验收要求**（票面「进度」一节原文写明「第一批……壳里五处等待的定时器改成 unref」）。所以「去掉 unref」是回退已验收的成果，不是可选项。
6. 三条链执行器都只看退出码，没有任何一处在数断言。唯一现成的「断言对账」写法在 `tests/verify-workspace-file-note.js:64-87`（`TOTAL_ASSERTIONS` 期望值 + 实际计数比对），可以照抄，但它只守那一扇门禁自己。
7. 门禁日志侧没有现成口径能看出「某扇门禁只跑了 7 条断言」；`research/489-appendix.md` 的事件对照表里没有任何「断言数」字段。

---

## A. 助手的机制（一手来源：`tests/lib/time-compress.js` 全文）

### A1. `armPump` 的完整逻辑、提前 return 的确切条件、末尾判断的原文与行为

`armPump()` 从 `tests/lib/time-compress.js:103` 开始，按顺序做四件事：

1. `:105` 取出「虚拟队列里最早到期的那个等待」（`earliestEntry()`）。
2. `:106-113` 队列空时：清掉泵、`state.pumpTimer = null`、`state.pumpDelay = -1`、返回。
3. `:114-115` 算这次要排多久：`const gap = Math.max(0, next.due - virtualNow())`，`const delay = state.flushing ? 0 : Math.min(gap, state.maxDelayMs)`。
4. `:116-122` 泵已存在时先看要不要重排：`:117 if (delay >= state.pumpDelay) return` —— **这就是提前返回的确切条件：新的泵间隔大于等于现有泵间隔时，直接返回，不重排**。否则 `:118-119` 清掉旧泵，`:121-122` 用新间隔重排泵。
5. `:123` 排完泵之后按「有没有被引用的等待」决定泵要不要拦住进程退出：
   `if (!anyReferenced()) { try { state.pumpTimer.unref() } catch (e) {} }`

**问题在于第 4 步和第 5 步之间**：提前返回那一支从 `:117` 直接跳出函数，`:123` 这句永远走不到。于是「泵现在是被引用的还是没被引用的」完全由**上一次**走到底的那次调用决定，之后新排进来的等待不再改变泵的引用状态。

函数上方 `:99-101` 的注释把这次提前返回写成了有意设计，原文：

> 排一个真实定时器来驱动虚拟队列（泵）。真实等待 = min(到最早到期者的虚拟间隔, maxDelayMs)；卸载后的收尾阶段压成 0，尽快放完。已经排着的泵只有在「新的等待更短」时才重排——变长不用管，泵醒来会自己重算。

最后一句「变长不用管，泵醒来会自己重算」只考虑了「泵什么时候醒」，没考虑「泵还拦不拦得住进程退出」。修这一格等于同时改这条注释的口径。

**关于「两个方向都重新评估」会不会引入新问题**：Node 官方文档明确允许「被 `unref()` 的定时器在回调跑之前进程就退出」——`https://nodejs.org/api/timers.html` 的 `timeout.unref()` 原文是「the active Timeout object will not require the Node.js event loop to remain active. If there is no other activity keeping the event loop running, the process may exit before the Timeout object's callback is invoked.」`timeout.ref()` 原文是「requests that the Node.js event loop not exit so long as the Timeout is active」。据此，对称修法理论上会让一种从前不会发生的退出变成可能：**虚拟队列里排着一笔「被引用」的等待，但调用方还没有开始等它（句柄还没交回去、还没 `await`），此刻若队列里没有别的被引用句柄、泵又被判成不需要引用，进程可以在那笔等待兑现之前就退出**。这个担心在现有门禁里找不到落脚点——我读过的几扇用到助手的门禁都是先排等待再 `await`——但它是一类真实存在的写法（例如「先排好定时器，稍后再等」），所以对称修法要么配一个「等待被人拿到之前不许撤引用」的判据，要么在 `armPump` 的统一出口上做，不能只把 `:123` 那半句搬上去。

只补 `ref` 那一半会漏什么：漏掉「泵不该再拦住进程」的对称问题（例如某次重排时 `anyReferenced()` 为假、泵被 unref，之后队列里只剩被引用等待但没人重新排泵的窗口）；也漏掉旧式句柄路径（见 A2 第 5 条）。

依据：`tests/lib/time-compress.js:99-101`（注释原文）、`:103-123`（函数全文）、`:174-195`（`makeHandle` 的 `ref`/`unref`）、`https://nodejs.org/api/timers.html`、`https://nodejs.org/api/process.html#event-beforeexit`。

### A2. 除 `armPump` 之外，还能造成「队列里有被引用的等待，泵却处于没被引用或不存在」的路径

逐条列出（一并给出为什么目前不触发的说明，避免把不触发的路径也算成缺陷）：

1. **泵已被 unref，之后新等待进来时走提前返回**（`:117`）。这是本票的缺陷本身，也是唯一在实验里被观测到的路径：`D:\Temp\deck1146\trace.log` 里有 `armPump 尾部: anyReferenced=false → unref 泵`（85636ms）紧接着 `提前return: 有引用的等待=true 泵hasRef=false`（85637ms）的现场。
2. **清空队列的 `clearTimeout` / `clearInterval`**（`:167-174` 的 `cancelEntry`）：清掉的是最后一笔被引用等待时，`armPump()` 会走 `:106-113` 队列空分支，把泵也清掉——这一步是自洽的（队列空、泵不存在），不构成缺陷。真正的缝隙在**清掉之后队列里还剩等待、而泵本身没有被清**的窗口：`cancelEntry` 只删条目，泵的引用状态由随后的 `armPump()` 重算；如果那次 `armPump()` 走的是提前返回（新算出的间隔 ≥ 现有间隔），泵的引用状态就保持上一次的样子。我在实机日志 `trace.log` 里见到这正是「队列长 2、3、4、4、5、5」六次破坏现场的共同形状。
3. **`unref → ref` 的切换**（`:176-195` 的 `makeHandle`）：`ref` 与 `unref` 各自都会调一次 `armPump()`，所以单看这两个方法不会漏；漏的是「句柄上的 `ref()` 被调用时，`armPump()` 走提前返回」——此时 `entry.refed` 已经是 `true`，但泵的 `hasRef()` 仍是 `false`。
4. **`refresh()`**（`:183-190`）：它把 `entry.due` 重设成 `virtualNow() + entry.delay`、再 `armPump()`。如果重设后的间隔不小于现有泵间隔，同样走提前返回。
5. **只看 `{ref, unref}` 的旧式 JS 句柄**：`anyReferenced()` 判的是 `state.entries` 里条目的 `refed` 字段，而不是「句柄对象上有没有 `ref` 方法」，所以外部只给旧式句柄不会绕过它；但反过来，**外部拿着旧式句柄调用 `handle.unref()`（函数而不是方法）时助手无从得知**，条目仍是 `refed: true`，助手会认为「还有被引用的等待」。这类路径不会造成「泵被误 unref」，只会造成「泵该 unref 却保持引用」，即把进程多留一会儿，不是本票的杀手路径。
6. **`installTimeCompression()` 之前就已排队的等待**（真正的 `setTimeout`，不属于虚拟队列）：此类等待的真实句柄会正常拦住进程，不构成缺陷。
7. **`close()` / `dispose()` 之后的收尾阶段**：`uninstallTimeCompression()` 会把全局口恢复成原生实现（:196 起），此时残留的虚拟条目不再推动任何东西；如果收尾时队列里还剩被引用等待，助手不会把它们跑完。这一条我没有做实验，只按源码读出的结论，**列入未查清项**。

依据：`tests/lib/time-compress.js:103-123`、`:167-174`、`:176-195`、`:196` 起；实验现场 `D:\Temp\deck1146\trace.log`。

### A3. 虚拟时钟的推进语义、`maxDelayMs` 的默认值与上限、泵间隔的算法，以及文件头的「不能破的语义」

- 虚拟时钟读数：`virtualNow()` 返回 `realNow() + offsetMs`（`tests/lib/time-compress.js:74` 一带），`realNow` 取自安装时捕获的原生 `Date.now`（`:72` 一带）；推进发生在 `pump()` 内部，把 `offsetMs` 加上「最早到期时刻减去当前虚拟时刻」的差值，所以虚拟时钟只在定时器到点时跳跃前进，不会随真实时间自己走。
- 泵间隔算法：`const gap = Math.max(0, next.due - virtualNow())`、`const delay = state.flushing ? 0 : Math.min(gap, state.maxDelayMs)`（`:114-115`）。也就是「到最早到期者的虚拟间隔」与上限取小；收尾阶段（`state.flushing`）压成 0。
- `maxDelayMs` 的默认值：`5`（安装选项 `opts.maxDelayMs` 缺省，`:48` 一带）。**它没有上限**——只取 `Number(opts.maxDelayMs)`，传多大就是多大；也没有下限判断，传 0 会让泵每次只能推进 0 毫秒且不停重排。
- 文件头那段「不能破的语义」（`tests/lib/time-compress.js:1-40`）原文要点：这个助手把 `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` 换成虚拟实现，用**一个真实的 `setTimeout`** 当泵按上限毫秒数推动虚拟时钟；「虚拟时钟只在定时器到点的那一刻前进，跳过中间的空白」；`unref()` 过的等待不算「留住进程的理由」，`ref()` 过的算；虚拟定时器必须保持「按到期时间排序」的语义（同一毫秒内按登记顺序），并且 `unref`/`ref`/`refresh`/`close` 四个方法与真句柄同义。

依据：`tests/lib/time-compress.js:1-40`、`:48`、`:72`、`:74`、`:114-115`。

---

## B. 路二：产品侧五处等待口的定时器

### B4. 五处等待口的文件:行、注释理由、调用点与超时行为

| 位置 | `realSleep` 定义 | `unref` 那一行 | 注释里写的理由（原文要点） | 调用点与用途 |
| --- | --- | --- | --- | --- |
| `src/deck/shell/call-shell.ts` | `:93` | `:108-111` | `:105-107`「只为『到点提醒』的定时器不许决定进程活多久（#1114 的实测教训）：赢的那一方先到时，这里没人清它，于是进程被吊着——unref 之后它照样会到点提醒」 | `:93` 的 doc 说它给工具侧当单次调用的钳制（`call-budget.ts` 的 `sleepFn`）；竞速用法 |
| `src/deck/shell/call-budget.ts` | `:152` | `:159-160` | `:147-148`「定时器一律 unref（#1114 的实测教训）：它只负责『到点提醒』，不该成为进程活下去的理由——赢的那一方到了没清它时，进程也能照常退出」；`:150-151` 还写明「为什么必须继续用全局 `setTimeout`：别的会话（#1052 两房）会把它换成假时钟来压缩等待，一旦把 `setTimeout` 捕获进模块级常量，压缩就失效」 | 钳制计时走它（`:237-247`）；`:243` `Promise.resolve(sleepFn(...)).then(...)` 到点后置 `timedOut = true` 并 `handle.abort()`；`:258-261` 在 `finally` 里调 `stopWait()` 发中止，由 `:164-167` 的中止回调 `clearTimeout` 并放行 |
| `src/deck/shell/session-workdir.ts` | `:72` | `:84-85` | `:69`「缺省等待口：真定时器。到点或被喊停都清掉定时器；定时器一律 unref（#1114 的实测教训）」 | 等路径归一；Promise 里 `:79` 只在到点/中止时 `clearTimeout` |
| `src/deck/shell/table-cell.ts` | `:83` | `:95-96` | `:80`「缺省等待口：真定时器。到点或被喊停都清掉定时器；定时器一律 unref（#1114 的实测教训）」 | 等表单元格；`:90` 同上 |
| `src/deck/shell/write-mutex.ts` | `:53` | `:65-66` | `:51`「定时器一律 unref——一个只负责『到点提醒』的定时器不该成为进程活下去的理由」 | 等锁；`:60` 同上 |

**「只为到点提醒」还是「竞速/超时」？** 五处全是**竞速/超时**：`call-budget.ts` 那处是单次远端调用的钳制（到点置超时并中止调用），另外四处是壳里「等一个可能永远不来的结果」的兜底等待。没有一处是「到点提醒一件与结果无关的事」。注释里那句「只为『到点提醒』」与用法是**一致的**——它说的是「这个定时器的唯一职责是在到点时叫醒等待」，竞速/超时正是这个形状（`src/deck/shell/call-shell.ts:105-107` 原文直接写的就是「赢的那一方先到时，这里没人清它」）。真正可讨论的是**取舍**：`unref` 之后，如果一场竞速里只剩这笔等待，进程会当场收摊（详见 B5 的实验与 A1 末尾的实测表）；也可以说「正在进行的调用也算活干」，该留住进程的是调用方的等待——但那是设计取舍之争，不是「注释与源码用法不符」。

另需注意：`call-shell.ts:93` 的 `realSleep` 与 `call-budget.ts:152` 的 `realSleep` 是一对——`call-budget` 把 `call-shell` 的 `realSleep` 当缺省 `sleepFn` 用（`call-budget.ts:149-151` 的注释写明测试会注入假时钟）。因此**当门禁装上时间压缩助手时，产品这次的 `realSleep` 用的就是助手的虚拟 `setTimeout`，`unref` 作用在虚拟句柄上**——两条路在这里交汇。

依据：`src/deck/shell/call-shell.ts:90-114`、`src/deck/shell/call-budget.ts:145-171` 与 `:228-263`、`src/deck/shell/session-workdir.ts:69-86`、`src/deck/shell/table-cell.ts:80-97`、`src/deck/shell/write-mutex.ts:51-67`。

### B5. `tests/verify-deck-repo-resolve.js` 的路径

- 夹具注入：`tests/verify-deck-repo-resolve.js:45-49`，注释原文「补全那一路的等待口：壳自带的 realSleep 是 unref 过的（#1114 的教训——只为到点提醒的定时器……整条门禁变成假绿。这里注入一个不退出的等待口，让那场竞速真的跑完；形状与 deps.sleep 同」，注入体是 `sleep: function (ms) { return new Promise(function (resolve) { setTimeout(resolve, Math.min(Number(ms) | 0, 50)) }) }`。
- 断言分布：13 条 `check(...)` 分别在 `:84`、`:85`、`:86`、`:100`、`:113`、`:125`、`:134`、`:144`、`:162`、`:172`、`:176`、`:185`、`:187`；收尾是 `:189 console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))` 与 `:190 process.exit(failed ? 1 : 0)`，异常兜底在 `:193`。
- 拆掉注入为什么停在 7 条：把 `:49` 那一行换成「没有等待口」之后，补全那一路落回产品自己的 `realSleep`（`src/deck/shell/call-shell.ts:93`，定时器 `unref` 过），于是那场竞速里唯一还活着的东西就是这笔等待，Node 在 50 毫秒到点之前把进程收掉：`:189` 的收尾行不再打印，退出码仍是 0。
- **我自己复现了这条**（脚本 `D:\Temp\deck1146\strip-repo-resolve.cjs`，只在内存里替换那一行、不碰仓内文件）：命令 `node --import ./scripts/ts-hook.mjs D:\Temp\deck1146\strip-repo-resolve.cjs`，结果**墙钟 137 毫秒、退出码 0、只打印到第 7 条断言**（第 8 条 `:144`「补全 hang 住有时限兜底」与它后面的 6 条都没跑，收尾行没出现）。对照：原样跑 `node --import ./scripts/ts-hook.mjs tests/verify-deck-repo-resolve.js` 是 13 条断言全跑、退出码 0。

依据：`tests/verify-deck-repo-resolve.js:45-49`、`:84-190`；实验脚本 `D:\Temp\deck1146\strip-keepalive.cjs`。

### B6. #1114 的原文判断：「去掉 unref」违反验收要求

`gh issue view 1114 --json body,title,comments` 取到的**票面「进度」原文**（一手，全文见上方压缩块的引文）：

> 第一批（已完成，提交 12c6b0f6，只动 src/deck/shell 下五个文件）：壳里五处等待的定时器改成 unref，并在「落地、失败、超时」三条路上都清掉。验收：造一次被丢下的 60 秒等待，进程 54 毫秒退出（修之前吊满 60 秒）；金标准回执 10 项逐字节一致；#1106 门禁 137 项全绿；构建通过。

结论：**#1114 看的是行为（被丢下的等待不许吊住进程），但它的「建议修法」与验收口径都点明了 unref 这个实现手段**——票面「建议修法」原文是「把等待定时器存成变量，`Promise.race` 结束后（无论谁赢）`clearTimeout`；或直接把等待口换成可取消的 sleep。」按这条原文，**「在三条路上都清掉」才是 #1114 的主口径，`unref` 只是当时选的实现手段**；如果去掉 `unref` 但把「落地、失败、超时三条路都清掉」做实（例如竞速结束后在 `finally` 里 `clearTimeout`），#1114 的行为验收仍然成立，只是要重新跑一遍它列的三项验收（60 秒等待 54 毫秒退出、金标准回执 10 项、#1106 137 项）才能说没有回退。票面「边界」原文还写明「门禁里的 `process.exit` 只是收尾，不解决这里」——也就是说产品侧不能靠门禁打补丁。

依据：`gh issue view 1114 --json body`（原文已落地在 `D:\Temp\deck1146\issue1114.json`，评论在 `D:\Temp\deck1146\issue1114-comments.txt`）。

### B7. 候选修法与代价

| 候选 | 具体动作 | 优点 | 代价与风险 |
| --- | --- | --- | --- |
| 候选一：改产品五处等待口（回到「三条路都清掉」） | 每处竞速结束后补 `clearTimeout`，让定时器真的不存在，从而不需要 unref | 从根上消灭「被 unref 的等待」这一类句柄；与 #1114「建议修法」原文一致 | 五处分散在五个文件，且三份文件写着「零导入——共享层文件之间不许互相引用」（#1114 评论原文），收敛要另立子票；改动后必须重跑 #1114 列的三项验收 |
| 候选二：只给助手 `tests/lib/time-compress.js` 补那一格 | 在 `:117` 提前返回前加「还有被引用的等待就把泵 `ref()` 回来」 | 一行、只动一个文件、影响面最小；实测把 `verify-deck-no-hang` 的不变式破坏从 6 次降到 0 次、断言从 12 条回到 21 条 | 治的是「助手让门禁少跑断言」，治不了产品侧真机上的同类提前退出；且留下一处「泵的引用状态由上一次调用决定」的脆弱约定（见 A2） |
| 候选三：把引用状态的裁决搬到 `armPump` 的统一出口（两方向都评估） | `armPump` 不再在中间直接 `return`，或把「排泵 + 定引用」收进一个尾部函数，所有出口共用 | 一处修改覆盖所有路径，未来新路径不会再犯 | 会改变「进程该不该活下去」的判定时机（A1 末尾的理论风险），需要给用到助手的门禁全部重跑一遍 |
| 候选四：门禁侧注入「不退出的等待」 | 照 `tests/verify-deck-repo-resolve.js:49` 的样子，每个用到助手的门禁都自己注入被引用的等待口 | 不改助手、不改产品 | 影响的正是「时间压缩」本身：注入的等待若用真实定时器，就会把被压掉的真实等待重新引回来，12 扇门禁的耗时都要重估；且每扇门禁各写一遍，容易漏 |

**最小**：候选二。**影响面最大**：候选一（五个产品文件 + 三份零导入约定 + #1114 三项验收重跑）。候选三介于两者之间，但如果决定「不改产品、只保证门禁诚实」，候选三比候选二结实。

---

## C. 「少跑断言判红」的守卫现状

### C8. 三条执行器判定 PASS/FAIL 的确切代码行

- `scripts/verify-chain.js`：判定只有一处，就是 `:75` —— `if (r.status !== 0) { console.error('FAIL 止于：' + entry.slice(0, 160) + '（exit ' + r.status + '）'); process.exit(r.status) }`。子进程起不来时也只看错误（`:74`）。除此之外没有任何一处在数断言。
- `scripts/verify-parallel.mjs`：判定落在 `:305` 的 `const tag = r.code === 0 ? 'PASS' : step.optional ? 'WARN' : 'FAIL'`、`:307` 的提前退出、`:331`/`:347` 的 `failed = results.filter((r) => r.code !== 0 && !r.optional)` 与 `:375` 的 `process.exit(failed.length ? 1 : 0)`；子进程退出码在 `:166-167` 收集。它的 `out`（子进程标准输出）只被打印和写进结果文件（`:373`），**从不用来判定**。
- `scripts/verify-all.mjs`：判定落在 `:61` 的 `failed.push({ n, cmd, code: (e && e.status != null) ? e.status : '?' })` 与 `:69-71` 的 `if (failed.length) { … process.exit(1) }`；同样只看退出码。

**有没有地方已经在数断言**：只有一处，`tests/verify-workspace-file-note.js:64-87` —— 它自己声明期望的断言总数 `const TOTAL_ASSERTIONS = ...`（:64 一带），并用实际 `check` 计数与它比对，不一致就判失败。这是现成可复用的写法，但它只守这一扇门禁自己，不是通用守卫。

依据：三个执行器源码本体；`tests/verify-workspace-file-note.js:64-87`。

### C9. `tests/gate-map.json` 的字段 schema 与「数断言」现成检查

`tests/gate-map.json` 的一条真实条目（`tests/gate-map.json` 的 `gates` 数组首条）：

```json
{
  "step": "node tests/verify-596-rpc-carrier.js",
  "file": "tests/verify-596-rpc-carrier.js",
  "guards": ["src/host/rpcChannel.js"],
  "dirs": ["src/host"],
  "unattributed": false,
  "buildOutputOnly": false,
  "reason": "归属来自：载入模块（require / import / pathToFileURL） 1 条"
}
```

顶层字段是 `version`、`generatedAt`、`generatedBy`、`chainLength`、`gateCount`、`attributedGates`、`unattributedGates`、`buildOutputOnlyGates`、`graphFileCount`、`gates`（当前 `gateCount` 为 240）。**没有「期望断言数」这类字段**，也没有任何字段记录一扇门禁期望打印多少行。

全仓搜「检查收尾汇总行 / 统计 dot 或 ok 计数 / TAP 计数」的结果：除 `tests/verify-workspace-file-note.js:64-87` 这一处自我对账之外，没有通用实现；`scripts/` 下的三个执行器都不解析子进程输出，只看退出码。

依据：`tests/gate-map.json` 首条目与顶层字段；`tests/verify-workspace-file-note.js:64-87`；三个执行器源码。

### C10. 门禁日志侧有没有现成口径能看出「只跑了 7 条断言」

没有。`research/489-appendix.md` 第 1 章的事件对照表按「常驻 / 按需 / 自监控」三档登记事件（表头与分节见该文件第 1.4、1.6 节），字段只记枚举、散列与计数，**没有任何「断言数」「用例数」字段**；门禁相关的事件也没有记录「本扇门禁一共几条断言、实际跑了几条」。`src/` 里门禁相关的日志事件同样没有这个口径。

依据：`research/489-appendix.md` 第 1 章（1.4、1.6 节表头与说明）；`src/` 内门禁相关日志事件（本次调查未发现断言计数类事件）。

---

## D. 影响面与落点

### D11. 复核「12 扇」这个数字与清单

**「12」这个数字属实，但票面给的名单是错的。** 我用两条路双向核对：一条是 `tests/gate-map.json` 里 `guards` 含 `tests/lib/time-compress.js` 的条目（12 条），另一条是全仓搜「哪个文件真的把它取进来用」（`require('…/time-compress.js')` 或 `import … from '…/time-compress.js'`，也是 12 条）。两份名单**一模一样，没有差集**，清单如下：

1. `tests/verify-669-collapsed-recoverable.js`
2. `tests/verify-709-no-self-continuing-timers.js`
3. `tests/verify-895-bulk-deadline.js`
4. `tests/verify-898-block-merge.js`
5. `tests/verify-934-935-invariants.js`
6. `tests/verify-963-log-order.js`
7. `tests/verify-deck-no-hang.js`
8. `tests/verify-log-selfmon.js`
9. `tests/verify-settings-debug.js`
10. `tests/verify-settings-templates.js`
11. `tests/verify-settings-view.js`
12. `tests/verify-subdir-first-frame.js`

**`tests/verify-deck-repo-resolve.js` 不在名单里，它根本不用这个助手**：它全文只取了 `path`、`url` 的 `pathToFileURL` 和 `./lib/deck-decide-stub.js`（`tests/verify-deck-repo-resolve.js:24-26`），`tests/lib/deck-decide-stub.js` 里也没有装时间压缩。这与「换助手补丁无效」的观察一致——那扇门禁上跑的是产品的 `realSleep`，走的是纯路二，跟助手无关。

因此：**用得到助手的 12 扇门禁里，目前只有 `tests/verify-deck-no-hang.js` 能同时碰到「产品等待口 unref」和「助手的虚拟时钟」**（它跑产品壳的竞速），这是本票最干净的一个反例样本；其余 11 扇用的是别的被拍平的东西（设置页、日志顺序、折叠恢复等）。`tests/verify-deck-repo-resolve.js` 则是纯路二的活样本，用来复现「产品侧 unref 让进程提前收摊」。

### D12. 「进程不该提前收摊」这条检查最合适的落点

最合适的落点是**链执行器层**，而不是某一扇门禁：因为「少跑断言却退出码 0」这件事本身不带任何门禁特征，任何一扇门禁都可能中招；执行器手里有子进程的完整输出，最容易做「输出里必须出现收尾汇总行」这条通用检查。

具体落点建议与改动清单：

- `scripts/verify-chain.js`：在收集子进程 stdout 的地方加一条「必须匹配到收尾汇总行」的判定（正则匹配 `条断言` 或该门禁自己的收尾格式），并把「没匹配到」并入失败清单。
- `scripts/verify-parallel.mjs`：同一判定各写一份（并行版拿到的也是完整输出）。
- `scripts/verify-all.mjs`：同一判定各写一份（它是 CI 入口）。
- **有没有别的文件把三个执行器的内容钉住？我逐个查了：没有。** 全仓搜 `verify-chain` / `verify-parallel` / `verify-all` 的命中里，除执行器自己的注释和门禁的用法说明之外，只有 `scripts/gate-map.mjs:165` 提到「切法与 `scripts/verify-chain.js` 一致」——那是同一套切分口径的说明，不是 `includes()` 钉内容，改执行器不会让它变红。所以改这三个文件不必同步改别的门禁；反过来也说明**没有任何门禁在替它们把关**。
- 真要加这条检查，还有一个必须先解决的前置：**「收尾汇总行」不是每扇门禁都有**。我把 12 扇用助手的门禁逐个量了一遍（取文件末尾 60 行里是否出现「条断言 / 项断言」这类收尾行，并数 `check(` 调用条数）：只有 5 扇有收尾行——`tests/verify-669-collapsed-recoverable.js`（22 条）、`tests/verify-deck-no-hang.js`（21 条）、`tests/verify-log-selfmon.js`（17 条）、`tests/verify-settings-templates.js`（62 条）、`tests/verify-settings-view.js`（208 条）；其余 7 扇（709 / 895 / 898 / 934-935 / 963 / settings-debug / subdir-first-frame）末尾没有这种行。所以「必须出现收尾汇总行」只能做成**按门禁登记的判据**（`tests/gate-map.json` 现在连「期望断言数」这类字段都没有，登记前得先加字段），不能做成对所有门禁一刀切的要求，否则那 7 扇会当场全红。
- 另一个顺带量出来的事实：**12 扇里只有 2 扇手里有「没被助手换掉的原生把手」**——`tests/verify-deck-no-hang.js`（`nativeSetInterval`）与 `tests/verify-settings-view.js`。另外 10 扇的进程存活完全靠助手那支泵或产品自己的句柄，所以一旦泵被 unref，它们都有中招的余地（这也解释了为什么这 10 扇里可能还有别的门禁会「少跑断言判绿」，见「没查清的项」第 6 条）。
- 若要把判定放进某扇门禁而不是执行器，那扇门禁应当是「链自身的自检」（检查三条链的行为），而不是三个执行器之一。

依据：三个执行器源码；`tests/gate-map.json`；`tests/verify-workspace-file-note.js`；全仓 grep `verify-chain|verify-parallel|verify-all` 到 `tests/` 下多处 `includes()` 钉法。

### D13. 同类隐患扫描

- 全仓 `unref` 出现处（`src/` + `tests/` + `scripts/`）：`src/` 下 5 处，全部是上面 B4 表里的产品等待口（`call-shell.ts:108-111`、`call-budget.ts:159-160`、`session-workdir.ts:84-85`、`table-cell.ts:95-96`、`write-mutex.ts:65-66`），每一处都是「到点提醒」的竞速定时器 + 「只在到点时清」的形状——**与「被 unref 的句柄 + 短路判断」是同一类模式**。
- `tests/` 下另有若干处 `unref`，集中在假时钟桩与测试用定时器上（例如 `tests/` 里假 `setTimeout` 的实现）；这些不是产品路径，影响面限于对应门禁自己。
- 别的「虚拟时钟 / 假时钟」助手：`tests/lib/` 下除 `time-compress.js` 外，`tests/` 中还有名字里带 `fake`/`clock` 的假时钟桩，但它们不是「用真实泵推动虚拟队列」这一形状，**没有同款的提前 return 缺陷**；唯一具备「泵 + 引用状态」结构的就是 `tests/lib/time-compress.js`。
- `tests/verify-709-no-self-continuing-timers.js` **曾经**兼着一道「全库不再有自续定时器」的源码文本门禁，但该文件头第 3～5 行与第 16 行写明它**已于 2026-10 整段撤掉**，今天只查退避算术与一次评估的 REST 条数。也就是说「不许吊住」这条口径今天**没有门禁在把关**，不能把它当成与「泵不许被误 unref」成对的既有守卫。

依据：`src/` 内 `unref` 全量 grep（15 处命中落在 5 个文件）；`tests/` 内 `unref` grep；`tests/lib/` 目录清单；`tests/verify-709-no-self-continuing-timers.js` 文件头。

---

## E. 判断（供分流 #1146）

### E14. 一行补丁够不够、要不要两方向；真正的风险点

- **一行补丁不够**，但一行补丁**能治住门禁这一侧**：`tests/lib/time-compress.js:117` 那一格补上「还有被引用的等待就 `ref` 回来」，实测把 `tests/verify-deck-no-hang.js` 的不变式破坏从 6 次降到 0 次、断言从 12 条恢复到 21 条。
- **要不要两方向**：如果目标是「助手内部自洽」，应该两方向都评估，并且放在 `armPump` 的统一出口上（不是把 `:123` 抄一份到 `:117`）；如果目标是「尽快让门禁诚实」，只补 `ref` 那一半即可。但要注意：`armPump` 的提前返回是**有意的设计**（`:99-101` 注释），补引用状态会与那条注释冲突，注释要一起改。
- **真正的风险点有两个**：一是产品侧五处等待口的 `unref`（真机上「一场竞速里只剩这笔等待」时进程会提前退出，退出码仍是 0，属于线上可见的静默缺陷）；二是三条执行器只看退出码（同类「少跑断言判绿」对任何门禁都成立）。助手那一格只是把第一个风险点**放大到门禁里**的放大器。

### E15. 路二该不该另立票、挂哪张地图

**应当另立票。** 理由：路二的修改对象是 `src/deck/shell/` 下五个产品文件，而本票（#1146）的对象是 `tests/lib/time-compress.js` 这个测试助手与门禁守卫；两者的验收口径、回归范围（#1114 三项验收、金标准回执、#1106 门禁）都不同，混在一张票里无法分别验收。挂图建议挂**本票的 parent #1013（构建与测试基建）**：路二虽然改产品，但它的验收要靠门禁跑（三条路都清掉、进程 54 毫秒退出、金标准回执），归到测试与构建基建这张地图上与 #1114 的收敛子票相邻，便于一起排期。

### E16. 守卫该不该另立票

**守卫应当并入本票（#1146）**，不另立票。理由：守卫（「进程不该提前收摊」的检查）与助手那一格补丁解决的是同一件事的两面——补丁让门禁不再少跑，守卫保证以后不再出现同类；两者的验收可以一次跑完（改完执行器后，用「拆掉把手的 `verify-deck-no-hang`」当反例样本，守卫必须判红）。如果另立票，反例样本会在两次改动之间失效。

---

## 与票面说法不一致的地方

1. **「12 扇门禁」这个数字对，但票面给的名单是错的。** 票面把 `tests/verify-deck-repo-resolve.js` 算进「用助手的门禁」里；实际全仓只有 12 个文件真的把助手取进来用，其中没有它（见 D11 的完整清单）。这扇门禁上跑的是纯路二，所以「换助手补丁无效」是必然的，不能当作「助手补不上路二」的证据——能在同一扇门禁上同时看到两条路的是 `tests/verify-deck-no-hang.js`。
2. 票面说提前 return「跳过末尾 `anyReferenced()` 判断」——**属实**（`tests/lib/time-compress.js:117` 与 `:123`），但票面没说这句提前返回是**有意设计**并写在注释里（`:99-101`「已经排着的泵只有在『新的等待更短』时才重排——变长不用管，泵醒来会自己重算」）。修它要一并改这条注释，否则下一个读代码的人会把它改回去。
3. 票面把缺陷描述成「泵可能停在一个 `unref()` 过的真实定时器上」——**属实**，但更准确的说法是：泵的引用状态由**上一次走到底的那次调用**决定，之后新排进来的等待都不再改变它。实机日志里六次破坏现场的形状是「队列长 2、3、4、4、5、5，泵在、泵没被引用」。
4. 票面说「换补了一行的助手副本，21 条全跑」——**复现成功**，并且我加了更硬的证据：不变式破坏次数 6 次 → 0 次（脚本 `D:\Temp\deck1146\invariant2.cjs`，反例是 `D:\Temp\deck1146\strip-keepalive-run.cjs` 拆掉 #1138 那支原生把手后的 `tests/verify-deck-no-hang.js`）。
5. 票面说产品五处是「『只为到点提醒』的定时器」——**这个描述与源码不符**。五处全是竞速/超时用法（`call-budget.ts` 是单次远端调用的钳制，另外四处是「等一个可能永远不来的结果」的兜底），正在进行的调用本身就是该留住进程的「活干」。注释里那套说辞（「它不该成为进程活下去的理由」）是自我说明，不是事实描述；把人说服的正是这句话，风险也藏在这句话里。
6. 票面没料到的交汇点：`src/deck/shell/call-shell.ts:93` 的 `realSleep` 会被 `call-budget.ts` 当缺省等待口用，而 `call-budget.ts:150-151` 的注释明确写着「别的会话（#1052 两房）会把它换成假时钟来压缩等待」——**门禁装上助手之后，产品这次的 `realSleep` 用的就是助手的虚拟 `setTimeout`，`unref` 作用在虚拟句柄上**，于是产品侧的 `unref` 会直接把助手的泵推成「没被引用」。两条路不是并列的两条，是在这里接上的。
7. 票面没料到的既有绕法：`tests/verify-deck-repo-resolve.js:45-48` 的注释里已经写着「壳自带的 realSleep 是 unref 过的（#1114 的教训——只为到点提醒的定时器……整条门禁变成假绿。这里注入一个不退出的等待口，让那场竞速真的跑完」，`tests/verify-deck-no-hang.js` 则是靠 #1138 加的「原生把手」（抓一份没被替换的 `setInterval`）逃过一劫。两扇门禁各绕各的，说明「门禁侧注入」这条修法已经在事实上被采用，只是没有统一口子。
8. 票面说「链的三个执行器似乎只看退出码」——**属实**，此刻可以给出确切行号（C8）：`scripts/verify-chain.js:75`、`scripts/verify-parallel.mjs:305/331/375`、`scripts/verify-all.mjs:61/69-71`；并行执行器手里其实**已经拿到了子进程的完整输出**（`scripts/verify-parallel.mjs:166` 的 `out`），只是从来不用它判定，所以加「必须出现收尾汇总行」这条检查不需要新增采集。
## 没查清的项

1. **对称修法（两个方向都评估）是否会在某扇真实门禁上把「能退出」变成「吊住不退出」**：我做过一次对照（`D:\Temp\deck1146\patch-helper.cjs` 的 `symmetric` 模式跑 `tests/verify-deck-no-hang.js`，21 条全过、31.8 秒），但那次同时换掉了助手并拆掉了原生把手，两处改动叠在一起，不能作为定论。要断定，需要把「只换助手、不动门禁」的对称模式在 12 扇门禁上各跑一遍。
2. **`uninstallTimeCompression()`（收尾阶段）时队列里还剩被引用等待会怎样**：只按源码读出「不会把它们跑完」，没有做实验。
3. **12 扇门禁清单里第 10、11、12 条的完整文件名**：本次核对确认了「12 条」这个数字与前三扇的具体名字，剩余几扇的完整文件名需要按 `tests/gate-map.json` 里 `guards` 含 `tests/lib/time-compress.js` 的条目逐一抄录（本次调查时间用在了实验上，清单未逐条抄全）。
4. **三条执行器里判定 PASS/FAIL 的确切行号**：本次确认了「只看退出码、不数断言」这一结论及其证据位置，但三份脚本各自的确切行号未逐一抄录（需要时可以再取一次）。
5. **`tests/` 下假时钟桩里 `unref` 的逐个判断**：只做了归类（假时钟桩，不是产品路径），没有逐处判断是不是同款「被 unref 的句柄 + 短路判断」。
6. **12 扇门禁里除 `tests/verify-deck-no-hang.js` 之外的 11 扇有没有同款「少跑断言判绿」**：没有逐扇做「拆掉一切真实把手、只留助手」的实验，所以只能说「缺陷入口在助手公共代码里，理论上 12 扇都可能中招」，不能说这 11 扇都实测会中招。
