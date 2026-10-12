# 研究：`npm run test:smoke` 四项红灯的成因判定（2026-10-12）

这份底稿只查一件事：六条冒烟里那四项红的断言，各自属于「生产代码真出了 bug」「测试断言的是已经被有意改掉的老行为」「测试自身有毛病（时序不稳、桩不准）」中的哪一类。

调查只做只读动作：读断言原文、读生产代码、用 git 定时间线、在 `.scratch/`（已被 gitignore）下把测试文件复制成探针改副本跑。仓库里被 git 跟踪的文件一字未改，没有提交、没有推送、没有开票。唯一新增的文件就是这份笔记。

四项红分别是：

- A `tests/smoke-host-dispatch.test.js` → `FAIL 索引差值 → numbered 订单（新号 42 归属最早候选取样）`
- B `tests/smoke-host-dispatch.test.js` → `FAIL 获号后 awaitCreatedIssue watching=false（不再等待）`
- C `tests/smoke-naming-persistence.test.js` → `FAIL 索引快照随账目落盘（差值底座持久化）`
- D `tests/smoke-naming-persistence.test.js` → `FAIL 重启后差值结算 → numbered 订单（#266 跨重启归属）`

## 一、一句话结论

| 项 | 位置 | 判定 |
| --- | --- | --- |
| A | `tests/smoke-host-dispatch.test.js:197` | **测试过时**：断言描述的行为今天仍然成立，但这份冒烟给登记会话喂的是 `cwd: ''`（空目录）；空目录兜底已在 2026-10-12 的 `855b34e1` 里被有意收掉，今天它是一条「如实拒绝」的输入，于是拉议题索引那一步根本没跑。 |
| B | `tests/smoke-host-dispatch.test.js:199` | **测试过时**：与 A 同一根因、同一处输入。它断言的是「拿到编号之后不再等待」，A 拿不到编号，它必红；把测试的目录改成真实目录后它与 A 一起转绿。本身没有独立缺陷。 |
| C | `tests/smoke-naming-persistence.test.js:150` | **测试过时**：同一根因。断言「索引底座随账目落盘」，但拉索引那次调用没成功过，底座压根没生成——不是落盘防抖窗口没到点。 |
| D | `tests/smoke-naming-persistence.test.js:167` | **测试过时**：同一根因，外加 C 的连带。差值结算要拿盘上的旧索引当基线（`newNumbersSince` 的约定：没有旧索引就不归属），C 的底座没落盘，重启后就没有可做差值的基线。 |

四项都不是生产代码新出的 bug：这条路上的生产逻辑（拉索引、算差值、挑候选、出单）今天依然成立，只是「空目录」这个输入在契约里被改成拒绝了，而这两份冒烟还在按老契约喂输入。

## 二、四项共同的直接原因：`855b34e1` 收掉了空目录兜底

时间线（都是本仓提交，提交信息原文）：

1. `f5b1d38b`（2026-08-27）「test(266): 冒烟扩套与桩修正 —— dispatch 冒烟新增建号感知三操作分发 + 索引差值结算端到端（stub gh 索引快照：基线不归属/新号 42 归属/获号收敛/取消清账）；持久化冒烟新增跨重启归属（盘上 indexes 差值底座 + 重启后 77 归属 numbered）」。这四项断言就是这一次加进来的；`git log -S'新号 42 归属最早候选取样' -- tests/` 与 `git log -S'索引快照随账目落盘' -- tests/` 各自只命中这一次。
2. `23f8ee42`（2026-09-24）最后一次改 `tests/smoke-naming-persistence.test.js`；`78cbfdc6`（2026-09-29）最后一次改 `tests/smoke-host-dispatch.test.js`。此后这两份测试再没动过。
3. 之后生产代码又改过几次。其中 `8a1c93ec`（2026-09-29，命名守护终局收敛与失败诚实）与 `98a8ab4e`（2026-10-03，标题来源判定改看底座记录）都在 `855b34e1` 之前就已在 HEAD 上（`git merge-base --is-ancestor` 三者皆为 HEAD 祖先），而且 `98a8ab4e` 对 `src/host/namingGuardian.js` 的改动只碰标题来源取值与删掉宿主直执行那一段，没碰索引、差值、归属。
4. `855b34e1`（2026-10-12 03:58:09）「收掉动作路径上的进程目录兜底值，缺目录的调用一律如实失败」——**这才是把这两份冒烟弄红的提交**。它做了三件事：`src/host/index.js:32` 的 `DEFAULT_CWD` 由 `process.cwd()` 改成 `''`；`src/host/repoKeys.js` 的 `runGh` 在 `:75-78` 新增空目录早返回；起进程处由 `cwd: cwd || DEFAULT_CWD` 改成 `cwd: cwd`。同一提交新增门禁 `tests/verify-1003-no-cwd-masquerade.js`（11 项，在 231 条链里）。
5. `fdd0c73d`（2026-10-12 06:26:22）「修好空目录会话里 gh 拿不到仓库的回归：会话目录一路传下去，去掉默认目录兜底」把 `src/host/namingGuardian.js:87` 的 `runGh([...], cwd || DEFAULT_CWD)` 改成 `runGh([...], cwd)`。此刻 `DEFAULT_CWD` 已经是空串，这一行对空目录会话没有行为差别（`'' || ''` 仍是空串），所以它不是红灯的来源，只是把同一件事做干净。

「不是最近一次改动引入」有据可查：同日的开工基线记录 `research/1010-verify-baseline.md:36` 写着 `tests/smoke-comment-passthrough.test.js` 失败三项、「另外 5 条冒烟全绿」，`:38` 写着「冒烟 5/6 绿」——即 03:31 那一刻这两份冒烟是绿的，当时唯一红的 `smoke-comment-passthrough` 现在已绿。

`runGh` 今天的实际写法（`src/host/repoKeys.js:75-78` 一带）：

```js
if (!(typeof cwd === 'string' && cwd.trim())) {
  // 记一条 gh.exec 日志（kind: 'no-cwd'）
  return { ok: false, kind: 'env', error: '这个工作区还没就绪（还没认出是哪个目录），所以这一次没有执行任何 gh 命令' }
}
```

命名守护拉索引的调用点是 `src/host/namingGuardian.js:129` 的 `const r = await namingFetchIndex(repoKey, grp.cwd)`，它在 `:126-130` 那个「按仓库分组循环」里；拿到失败结果就 `:130 continue`，既不归属也不落底座。目录是一路原样传下去的：`namingFetchIndex`（`:84-87`）把收到的 `cwd` 直接交给 `runGh(['api', '--paginate', ...], cwd)`，所以空目录在这里必然被拒——那条 `gh api` 命令连进程都没起（见 A 的探针证据）。而会话账目里的目录经过 `src/shared/naming-tracking.js:105` 的 `cwd: cwd || null`，空串会落成 `null`——所以测试里那句 `cwd: ''` 走到这里就是「没有目录」。

这次改动是有记录的决定，不是顺手改的：`src/host/index.js:31` 的注释原文写着「#1003（2026-10-12 维护者拍板）：这里原来是 DSH 进程的当前目录——那会把『还不知道工作区是哪条目录』冒充成一条真实存在的、别人的目录（桌面端上就是安装目录），所以改成空串：调用方拿到空目录一律如实失败，不许拿它去解析路径或起外部命令。」

## 三、逐项细查

### A. `索引差值 → numbered 订单（新号 42 归属最早候选取样）`

**断言原文**（`tests/smoke-host-dispatch.test.js:195-197`）：

```js
const planNum = await callHandler('namingPlan', {})
const numOrder = (planNum && Array.isArray(planNum.orders)) ? planNum.orders.find(function (o) { return o.sessionId === 'smoke-266' }) : null
check(!!numOrder && numOrder.kind === 'numbered' && numOrder.number === 42 && numOrder.title === '新建的修复需求', '索引差值 → numbered 订单（新号 42 归属最早候选取样）')
```

**桩喂进去的输入**：索引快照由 stub 的 `spawn` 统一返回（`tests/smoke-host-dispatch.test.js:12-23`）。基线快照 `GH_BASE`（`:12`）是两行 JSON Lines：

```
{"number":1,"title":"既有一","state":"OPEN","updatedAt":"u1"}
{"number":2,"title":"既有二","state":"CLOSED","updatedAt":"u2"}
```

`:184` 登记受踪会话：`registerNewSessionWatcher({ sessionId: 'smoke-266', baselineTitle: '[New] 新建需求', cwd: '', repoKey: 'acme/demo', hint: '新建的修复需求' })`——注意 `cwd: ''`。`:191` 把快照切成基线加一行新号 `{"number":42,"title":"新建的修复需求","state":"OPEN","updatedAt":"u42"}`，`:194` 等 600ms 让 nudge 的短窗结算。

**期望**：差值里出现新号 42，它带着标题「新建的修复需求」，于是给 `smoke-266` 出一张 `kind === 'numbered'`、`number === 42` 的单。

**实际**：拿到的还是一张草稿单。探针把 `planNum.orders` 打出来是：

```
[probe] planNum.orders = [{"sessionId":"smoke-266","kind":"draft","hint":"新建的修复需求","lock":{"lastMachineTitle":null,"baselineTitle":"[New] 新建需求","locked":false,"firstUserText":null,"titleSource":null}}]
```

同一份探针里 `:188` 的 `PASS 首轮基线仅 draft（存量不当编号）` 仍然绿，说明会话在账、在出单，只是永远升不到编号档。

**判定：测试过时。** 归属逻辑本身（`src/shared/naming-attribution.js` 的 `newNumbersSince` `:42-52`、`attributeNewNumbers` `:102-172`）今天照旧按「新号 + 标题相关 + 候选取最早」算，链上的纯函数门禁也照旧守着它；红的只是这份冒烟喂的输入——空目录在 `855b34e1` 之后不再被兜底，于是索引那一步就被拒绝了。

**两条硬证据**：

1. 把这份测试复制到 `.scratch/` 下，只把 `:184` 的 `cwd: ''` 改成 `cwd: process.cwd()`，其余一字不动（副本放在 `.scratch/` 里，`'../package/lib/index.js'` 的相对路径仍然指得到产物），A 与 B 立刻双双 PASS。
2. 另给副本的 stub `spawn` 打点记录每条命令的 `argv` 与 `cwd`，整趟跑下来出现的只有 `gh -C … rev-parse --show-toplevel` 与 `gh repo view --json nameWithOwner -q .nameWithOwner`，**没有一条 `argv` 以 `gh api` 开头**——命名守护拉议题索引的那次调用从未走到起进程这一步，与 `src/host/repoKeys.js:75-78` 在拿名额之前就早返回的写法一致。

### B. `获号后 awaitCreatedIssue watching=false（不再等待）`

**断言原文**（`tests/smoke-host-dispatch.test.js:198-199`）：

```js
const awaitB = await callHandler('awaitCreatedIssue', { sessionId: 'smoke-266' })
check(!!awaitB && awaitB.ok === true && awaitB.watching === false, '获号后 awaitCreatedIssue watching=false（不再等待）')
```

**期望**：上一步已经拿到编号，所以这次通话如实回报「不再等待」（`watching === false`）。

**实际**：因为 A 里编号从未到手，会话还在等待档，这条跟着红。它是 A 的连带，没有独立缺陷——同一份 `.scratch/` 探针（只改正目录一处）下它与 A 同时转绿，测试里其余断言（`:193` 的「等待中=true」、`:203` 的「renamed 回报受理」、`:205` 的「落定后不再出单」）从头到尾都是 PASS。

**判定：测试过时**（同一根因，连带项）。

### C. `索引快照随账目落盘（差值底座持久化）`

**断言原文**（`tests/smoke-naming-persistence.test.js:148-151`）：

```js
const jIdx = JSON.parse(readFileSync(stateFile, 'utf8'))
check(jIdx.indexes && jIdx.indexes['acme/demo'] && jIdx.indexes['acme/demo']['2'], '索引快照随账目落盘（差值底座持久化）')
```

读的是真实落盘的账目文件（这份冒烟把 fs 服务桥接成真实文件系统，见 `:38-44`）。

**桩喂进去的输入**：`:27` 的 `GH_BASE` 与 A 里那份逐字相同；`:144` 登记 `io-s4`（`cwd: ''`、`repoKey: 'acme/demo'`、`hint: '关闭期间建的需求'`）；`:146` 打一次 `awaitCreatedIssue`；`:147` 等 2600ms（注释写明是「注册 nudge 结算 800ms 窗 + 1.2s 防抖落盘窗」）。

**期望**：盘上账目里 `indexes['acme/demo']['2']` 存在——`2` 是基线快照里已有的号，基线只建档不归属。

**实际**（只加打印、`cwd` 保持 `''` 的探针）：

```
[probe] indexes={} s4cwd=null stage="placeholder"
```

`indexes` 是空对象——底座根本没写进去。而 2600ms 已经足够覆盖 800ms 的结算窗与 1.2s 的防抖落盘窗，所以这不是「窗口没到点」，而是压根没有快照可写：`s4cwd=null`（`src/shared/naming-tracking.js:105` 的 `cwd: cwd || null`）进 `namingFetchIndex` 就被 `repoKeys.js:75-78` 拒了，`namingGuardian.js:130` 直接 `continue`。

**判定：测试过时**（与 A 同一根因）。同一份探针只把 `:144` 的 `cwd: ''` 改成真实目录之后，这条与 D 一起转绿（打印变成 `indexes={"acme/demo":{"1":{…"OPEN"…},"2":{"title":"既有二","state":"CLOSED","updatedAt":"u2"}}}`）。

### D. `重启后差值结算 → numbered 订单（#266 跨重启归属）`

**断言原文**（`tests/smoke-naming-persistence.test.js:165-167`）：

```js
const plan4 = await callHandler('namingPlan', {})
const order4 = (plan4 && Array.isArray(plan4.orders)) ? plan4.orders.find(function (o) { return o.sessionId === 'io-s4' }) : null
check(!!order4 && order4.kind === 'numbered' && order4.number === 77 && order4.title === '关闭期间建的需求', '重启后差值结算 → numbered 订单（#266 跨重启归属）')
```

**桩喂进去的输入**：`:153` 把快照切成 `GH_BASE` 加一行 `{"number":77,"title":"关闭期间建的需求","state":"OPEN","updatedAt":"u77"}`；`:154-158` 加载一个新的模块实例模拟 DSH 重启（重启前先 `killInstance()` 让旧实例停手，见 `:17-25` 的注释与实现）。

**期望**：盘上有实例一留下的旧索引，重启后新实例拿新快照一比，多出来的 77 归给 `io-s4`。

**实际**：C 没落盘就无从做差值。差值函数的约定写在 `src/shared/naming-attribution.js:42-52`：`newNumbersSince(prevIndex, currIndex)` 把空的 `prevIndex` 当基线、返回空数组（首轮只建档不归属）。所以 D 是 C 的连带：`indexes` 是 `{}`，`prevIndex` 为 `null`，77 永远不会被归属。

**判定：测试过时**（同一根因 + C 的连带）。

## 四、删掉这两份冒烟，这些行为还有没有门禁在守

先说清覆盖面：231 条链（`node -e "console.log(require('./package.json').scripts.verify)"` 拆开正好 231 条）里没有任何一条提到冒烟（按名字过滤为 0 条）；CI 也不跑这六条——`.github/workflows/verify.yml:64` 跑 `node scripts/verify-all.mjs`，`:68` 与 `.github/workflows/matrix.yml:40` 跑 `node scripts/matrix-smoke.js`，而 `scripts/matrix-smoke.js` 只跑 `tests/tracker-contract` 下的 runner 与 fixtures（`:109`、`:159`、`:166`）。唯一入口是 `npm run test:smoke`。

逐项回答：

- **A「索引差值 → numbered 单」**：纯函数层**有**替代覆盖——`tests/verify-naming-guardian.js`（链里第 16 条）第 9 节「编号归属（索引差值 · 纯函数）」`:328-365` 覆盖差值升序（`:333`）、无变化/无基线/当前快照缺失（`:334-336`）、等待档四态（`:338-341`）、两个新号两个候选且歧义取最早（`createdAt: 100`）并保持编号升序、标题随号携带（`:349-355`）、候选耗尽即止（`:356-357`）、同时间戳以 `sessionId` 决胜（`:360-364`）。但**装配层没有**：把「会话登记 → 按仓库拉索引 → 落盘底座 → 差值结算 → 出 numbered 单 → 回报落定 → 取消清账」这一串主机侧接线连起来跑的，只有这两份冒烟（dispatch `:177-218`、naming `:142-174`）。
- **B「获号后不再等待」**：**没有**。全仓 `tests/` 里 `awaitCreatedIssue` 这个名字只出现在这两份冒烟里；`tests/verify-newsession-preset-guard.js:355` 与 `tests/verify-newsession-workspace-fallback.js:367` 是另一回事——那两处只是桩在记「客户端发出了 `wf.registerNewSessionWatcher` 这条电话」，不涉及编号与等待语义。
- **C「索引底座随账目落盘」**：**没有**。全仓 `tests/` 里 `naming-guardian.json` 与 `indexes[` 只出现在 `tests/smoke-naming-persistence.test.js:98`、`:150`。
- **D「跨重启归属」**：**没有**。跨重启这条线上另有覆盖的是 #267 的失败预算与定败清单（naming 冒烟 `:175-228` 读真实盘，链里 `tests/verify-naming-guardian.js` 第 10 节 `:367+` 覆盖纯函数层的预算、冷却、定败清单），但「索引底座跨重启、重启后按差值归属」只有这一处。

一句话：**删掉这两份文件，差值结算这段逻辑本身还有纯函数门禁守着，但它的主机侧装配、真实落盘与跨重启续跑就没人守了。**

## 五、要修的话怎么修

1. **最小改动路径（推荐，改测试）**：把两份冒烟里喂给登记会话的空目录换成测试自己造的真实目录。dispatch 那份是 `:184` 与 `:210` 两处 `cwd: ''`（`:210` 的 `smoke-prune` 只验取消清账，不改也能过，但同批改掉更整齐）；naming 那份是 `:144` 一处，用文件开头 `:11` 造出来的临时目录 `tmp` 比用 `process.cwd()` 更贴合它自己的语境。`.scratch/` 探针已经证明：只改目录，四项全绿。
2. **顺带值得补的一条断言**：这四项红之所以能藏这么久，是因为空目录上的失败在测试里表现为「订单一直停在草稿档」，看不出「是被拒绝」还是「是没等到」。建议在改成真实目录之后，另加一条把新契约正面钉住的断言：**空目录的受踪会话不出编号单、账目里也不落索引底座**（那就是今天的行为，只是没人把它写成期望）；要更靠前一步，还可以在链上直接断言 `runGh` 在空目录上返回 `{ ok: false, kind: 'env' }`。
3. **需要人拍板的两件，不要由改测试的人顺手做**：
   - 反过来在生产代码里恢复「空目录兜底成进程目录」等于把 `855b34e1`（#1003）反着做。那次是有意收掉的（维护者当日拍板选「同期收掉动作路径上的进程目录兜底值」），并配了 11 项门禁 `tests/verify-1003-no-cwd-masquerade.js`。恢复兜底会让空目录会话又把 `gh` 跑在插件的进程目录上——正是那一票要根除的「假成功」。
   - 这两份冒烟不在 231 条链里、CI 也不跑（见第四节）。这意味着今后任何一次「收掉某条兜底」都不会让它们在门禁上变红，只有人手动跑 `npm run test:smoke` 才会看到。要不要把它们挂进链或 CI，是需要人拍板的取舍（多了两条依赖真实磁盘与墙钟的耗时冒烟）。顺带一提，`docs/workflow/DEV-WORKFLOW.md:101-106` 对这份 dispatch 冒烟的描述还停在「dispatch ping → pong」，早已过期（`wf.ping` 在 #498 已退役），无论怎么决策都值得一并更新。
4. **一个仍然悬着的产品问题**：真机上 `registerNewSessionWatcher` 的 `cwd` 会不会真的空？测试作者当年在 `:184` 直接写 `cwd: ''`，说明当时认为「会话还没有目录」是常见情形。若真机上确实会出现，那么 #1003 之后这类会话就永远拿不到编号（不是测试问题，是行为问题），需要人拍板要不要另给一条「目录后补」的通路。

## 六、没能查清的部分

- 真机上 `registerNewSessionWatcher` 的 `cwd` 会不会为空、多久之后才补上目录，这次没追（要看 DSH 宿主侧怎么传会话目录，不属于判定这四项所必需的证据）。
- `tests/verify-naming-guardian.js` 第 9、10 节我只按节标题与行号范围核对了覆盖面，没有逐条比对它是否把主机侧装配的每个分支都复制了一遍（结论「装配层没有替代覆盖」是按全仓搜索 `awaitCreatedIssue`、`indexes[`、`naming-guardian.json` 的命中面得出的）。
- 探针只在 dispatch 冒烟的桩上给 `spawn` 打点，没有在真机上验证 `gh api` 那次调用被拒时的实际日志长什么样（`kind: 'no-cwd'` 那条 `gh.exec` 日志的内容是按代码读出来的，没有实跑核对）。
- `tests/smoke-comment-passthrough.test.js` 在 10-12 基线里那三项后来是怎么转绿的，与本次问题无关，没有查。
