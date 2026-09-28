# 打开那一下的取数与重渲染风暴：请求数与扇出范围（#755）

> 地图 #747 子票 #755 · 只读调查，不改生产代码，不加日志点 · 落盘日期 2026-09-26
> 读法：每条结论后面跟的 `文件:行号` 是静态源码位置，可直接打开核对。写着「没量到」的是只读代码回答不了、必须真机开调试开关量一次的数。

## 结论先行

1. 打开面板本身只有一条路：点胶囊或面板分段 → `openPanel` → 交进 DSH 原生右侧边栏 → `afterPanelOpened` 按缓存三选一（`src/client/kernel/router.js:59-80`）。打开那一下**至少带起 1 次链快照请求（`loadChain`，走 `wf.chain`），快照那一路（`loadSnapshot`，走 `wf.snapshot` 或 `wf.refresh`）在缓存新鲜时是 0 次、过期或首开时是 1 次**。两个数字都是「发起次数」，在途合并命中时会压成更少的真实网络请求（见第 2 章）。
2. 不是「一次打开就拉起整套重建加全组扇出」。整池重建（`wf.refresh`）只在三处发生：缓存过期或首开时的那 1 次 `loadSnapshot`（非强制，走 `wf.snapshot`，宿主侧按需重建）、人亲手点的刷新（`refreshAll`，强制，走 `wf.refresh`）、探测命中变化且宿主说该整池时（`probeNow` 的补量，走 `loadSnapshot(primary, true, true)`）。打开面板不调 `refreshAll`，所以**打开本身不强制整池**。
3. 扇出（一个会话取到数据后顺手把同工作区其他会话也更新了）确实存在，但只在「取到新快照」时发生，一次打开最多触发两轮扇出（快照一轮、链一轮），每轮同组每个会话各 `emit` 1 次。`emit` 一次的效果就是订阅了该会话的界面重渲染一次：该会话的状态栏重渲染 1 次；右侧面板如果正为该会话挂载着，也重渲染 1 次。组里有几个会话（N）是运行时数字，**没量到**（见第 3 章数法）。

## 1. 打开触发的取数链

### 1.1 打开的三选一（`afterPanelOpened`）

位置：`src/client/kernel/router.js:59-80`。

- 打开前先记一次常驻日志 `panel.open`（`router.js:102`），字段有缓存有没有（`hasCache`）、快照新不新鲜（`snapFresh`）、工作区键散列、快照版本号、后端标识。这是打开动作的时间锚点（数法见第 4 章）。
- 打开就是「我开始看这个工作区了」：先装一次注意力上报与心跳监听（`startAttentionSignals`，`router.js:61`，幂等），再按下面三档走：
  - 已有真实快照且新鲜（60 秒内，`SNAP_FRESH_MS`，`probe-auto.js:307-311`）：只 `emit` 1 次，**0 次新请求**（`router.js:69-71`）。
  - 有真实快照或有缓存但已过期：先 `emit` 1 次秒显旧数据，再 `loadSnapshot(st, false)` 发 1 次非强制快照请求（`router.js:72-75`）。
  - 首开（什么都没有）：`snapMode='loading'` 加 `emit` 1 次，再 `loadSnapshot(st, false)` 发 1 次（`router.js:76-80`）。
- 面板内容体是两跳后挂载（先画空壳、两帧后再挂 `DetailsDock`，`router.js:41-55`），所以上面的请求先发，面板第一帧不被取数挡住。

### 1.2 `loadSnapshot(st, force, silent)`：面板快照那一路

位置：`src/client/kernel/probe-snapshot.js:98-309`，去重与过期判据在 `src/client/kernel/probe-stale.js`，迟到回包落地在 `src/client/kernel/probe-select.js:104-127`。

触发条件与串行次数（按代码执行顺序）：

1. 在途复用先判（`probe-snapshot.js:107-108`，判据在 `probe-stale.js:51-66`）：同工作区键加同后端已有在途请求时直接搭车，**0 次新请求**，搭上后只做一次水合加 `emit`。例外：强制（`force=true`）不搭非强制的车（`probe-stale.js:56`），换过后端也不搭（键里带后端，`probe-stale.js:30-32`）。
2. 补工作区目录（`probe-snapshot.js:275-302`）：会话还没目录时先同步读（`getCwdSync`）或问一次 `wf.cwd`（1 次跨进程调用，顺手带回工作区根）；已有目录但还没问过工作区根时也补问 1 次 `wf.cwd`（`_wsRootAsked` 幂等，`probe-snapshot.js:295-302`）。
3. 进工作区补问一次后端（`askSelectionOnce`，`probe-snapshot.js:307`，实现在 `probe-select.js:45-83`）：手上没后端、有目录、且该工作区没问过时才问 1 次 `wf.selection`。问过就记在 `st._selAskedKey` 上，失败也不重问、不弹提示。回包空时什么都不做（「还不知道」不等「没有设置」）。
4. 主请求只发 1 次（`probe-snapshot.js:151-155`）：`force` 为真走 `wf.refresh`，否则走 `wf.snapshot`，参数带工作区目录、版本号（`ifNoneMatch`/`version`，命中则宿主回 304）、用户亲手选过的后端（`backendId`/`baseRev`，派生值不冒充，`probe-snapshot.js:143-147`）。发之前记一行按需 `host.call`（发起行，`latencyMs:0`），回包后记一行常驻 `host.call` 或 `host.call.fail`（带真实耗时，`probe-snapshot.js:172`）。
5. 30 秒死线（`probe-snapshot.js:156`）：`Promise.race` 对主请求计时，超时后本次等待结束、记错并 `emit`，但原始回包另挂一个迟到处理器（`probe-snapshot.js:166`），只补装选择与仓库引用那一小块（`probe-select.js:110-127`），不换用户正在看的画面。
6. 回包三判（`probe-snapshot.js:177-204`）：工作区换走（按请求发出时的目录比，`probe-select.js:94-102`）、序号过期或后端已换（`probe-stale.js:41-48`，落点 `probe-snapshot.js:190-193`，按需记 `snapshot.stale.drop`）、304（只合并权威选择，不换表，`probe-snapshot.js:195-204`）。三判都过才装表、做差异、写内存与磁盘两级缓存、记常驻 `snapshot.hydrate` 相关行、调 `startAutoProbe`（幂等）。
7. 附带 1 次 fire-and-forget（`probe-snapshot.js:240-246`）：快照里没带后端模块清单时补问 1 次 `wf.registry`，回来就 `emit`，不阻塞主流程。

在途合并语义：去重键是「工作区键 + 后端」（`probe-stale.js:30-32`，工作区键本身已锚到工作区根，`store-snapshot.js:60-72`）。同键同后端并发只发一次，后来者搭车（`probe-stale.js:59-64`，按需记 `dedup.hit` 十取一与 `snapshot.fanout`）。宿主侧还有第二道合并：在途合并表键不带强制标记，「强制只搭强制的车，非强制搭任何车」（`src/host/sessionSnapshot.js:87-90`，按需记 `dedup.hit`）。

### 1.3 `loadChain(st, force, trigger)`：检查链那一路

位置：`src/client/kernel/probe-chain.js:80-162`，事件入口 `chainEventRefresh` 在同文件 `73-79`。

触发条件与串行次数：

1. 四种事件都走同一个入口（`probe-chain.js:60-79`）：切进工作区（检查页挂载那一次，`force=false`）、人点重新检查（`force=true`，原因 `user-recheck`，永不降档）、做完可能改变链的动作（绑定后端、配置派生，`force=true`）、宿主侧写成功（只拉回退避档位，不直接发起）。原因以 `chain.event` 按需记一行（`probe-chain.js:76`）。
2. 非强制先看共享缓存（`probe-chain.js:86-103`）：键是「工作区键 + 后端 + 语言」（`probe-chain.js:29-34`），命中即秒显并直接返回，**0 次新请求**。强制一定真发一次。
3. 非强制有在途同键请求时搭车（`probe-chain.js:87-88`，十次记一次 `dedup.hit`）；强制每次都发（在途登记只在非强制时写入，`probe-chain.js:160`）。
4. 主请求只发 1 次 `wf.chain`（`probe-chain.js:111-117`），参数带目录、用户亲手选过的后端、语言、触发原因。回包记常驻 `host.call` 或 `host.call.fail`（带耗时，`probe-chain.js:118`），落共享缓存后对本会话 `emit` 1 次（`probe-chain.js:142-143`）。
5. 回包两问（`probe-chain.js:37-40`，落点 `128-131`，按需记 `chain.stale.drop`）：同键后来又发过更新的一次、或该会话现在要的已不是这条链（换后端、换工作区、换语言），任一不过就丢弃。判据落在回包一侧，发请求时不冻结结论。

### 1.4 `probeNow(fromFocus)`：自动与焦点探测（打开本身不调，但决定后台会不会叠加）

位置：`src/client/kernel/probe-auto.js:21-144`。

- 焦点来的那一下有节流：正在看的工作区按宿主给的间隔判，拿不到间隔退回 60 秒（`probe-auto.js:23-30`）。
- 按工作区键去重后，每个不同的工作区各发 1 次 `wf.probe`（`probe-auto.js:101-143`，实现 `refreshGroup` 在 `38-100`）。回包记常驻 `host.call`（`wf.probe`，带耗时，`probe-auto.js:39`），成功即走针（`touchProbeAt`，见 2.2）。
- 有变化才补量（`probe-auto.js:42-98`）：宿主已补好行级增量（`mode=patch`）时直接吃，**0 次大查询**；宿主说该整池或没给增量时走 `loadSnapshot(primary, true, true)`，即 1 次 `wf.refresh`，再扇出给组内其余会话；宿主说被推迟、失败或过期丢弃时什么都不做。
- 定时源两条（`probe-auto.js:157-216`）：60 秒兜底节拍（页签隐藏时不发）与只探正在看的工作区的活跃节拍（绿档 5 秒、黄档 120 秒、红档停，间隔真源在 `src/shared/refresh/budget.js`）。打开面板不调 `probeNow`，但打开后若正撞上节拍，日志里会多出一组 `wf.probe`。

### 1.5 `refreshAll(st)`：人亲手点的刷新（打开本身不调，列出以免混淆）

位置：`src/client/kernel/probe-auto.js:228-302`。

- 触发：状态栏刷新分段（`StatusBar.js:267`）、面板头部刷新按钮（`Dock.js:248`）、检查页重新检查（`ChecksTab.js:191` 附带按钮）、页签行刷新。永不因 `refreshing` 锁死（`probe-auto.js:229-231`）。
- 串行：链路（`chainEventRefresh(st,'user-recheck')`，15 秒兜底）与快照（`loadSnapshot(st,true,true)`，即 1 次 `wf.refresh`）并行发，先 `emit` 1 次转圈（`probe-auto.js:235-241`），都回来后做同工作区扇出（见 2.3），最后 `emit` 1 次收尾。拿不到新快照且开着调试时记一行 `host.call.fail`（`probe-auto.js:296-299`）。

### 1.6 `wf.snapshot` 在宿主侧的动作

位置：`src/host/sessionSnapshot.js:50-90`（入口与短路），扇出排队与记账在 `src/host/refresh/gate.js` 与 `src/host/refresh/ledger.js`。

- 每进一次先记常驻 `snapshot.request`（`sessionSnapshot.js:70`），字段有工作区散列、后端标识、`force` 是否强制。这是数强制与非强制各几次的依据。
- 非强制有内存缓存即短路返回（含 304 与权威选择合并，`sessionSnapshot.js:72-84`），强制必重建（`sessionSnapshot.js:85-86` 记 `snapshot.cache.miss`，原因 `force`）。
- 去 GitHub 的每一笔真实出站都经唯一出口闸排队逐条发（`gate.js:178-183` 注释「并发数恒为 1」），裁决记按需 `refresh.decide`（`gate.js:154-155`，`send` 与 `admitAiTool` 两处都调），花费记按需 `quota.spend`（`ledger.js:224`），被推迟或过期丢弃记按需 `refresh.skipped`（`gate.js:159-161`）。面板刷新按钮的调用点身份是 `panel.refresh`（人亲手做的动作），切进工作区那一次是 `workspace.enter`（生命周期），探测节拍是 `probe.tick`（后台），分类表在 `gate.js:34-48`。

### 1.7 打开时各挂载点的调用小结（一次打开最多几路）

| 挂载点 | 打开时会不会跑 | 跑什么 | 行号 |
|---|---|---|---|
| `afterPanelOpened`（点开必经） | 会 | 三选一：0 或 1 次 `loadSnapshot(false)` | `router.js:59-80` |
| `DetailsDock` 挂载（两跳后） | 会 | `useDockSync` 第二个副作用：`loadChain(false)` 一定跑；`loadSnapshot(false)` 只在污染或不新鲜时跑 | `panel/DockSync.js:112-122` |
| `useDockSync` 第一个副作用（工作区跟随） | 只有目录变了或污染才跑 | 变目录：`emit` + `loadChain(false)` + `loadSnapshot(false)`；污染：`loadSnapshot(false,true)` + `loadChain(false)` | `panel/DockSync.js:79-110` |
| `StatusBar`（输入区常驻，不随面板开关） | 打开不重挂，只在切换会话或换工作区时跑 | 换工作区：`loadChain(false)` + 按需 `loadSnapshot(false)`；挂载一次：同左 | `statusbar/StatusBar.js:72-95` |
| `ChecksTab`（面板正停在检查页时） | 会 | `chainEventRefresh(st,'enter-workspace',false)`，缓存命中则 0 网络 | `views/ChecksTab.js:17` |
| 页签切换 | 会 | 切页签且不新鲜时 `loadSnapshot(s,false)` | `views/shared/Tabs.js:24` |
| 插件启动（不是打开） | 与打开无关 | `loadSnapshot(shared,false)` 1 次 | `panelAssembly.js:154` |

合并后的上限（同一工作区、同一后端、同一语言）：快照那一路不同调用点互相搭车，真实网络一般压成 **1 次 `wf.snapshot`**；链那一路同样压成 **1 次 `wf.chain`**；外加按需的 `wf.cwd`（最多 1 次，问过即止）、`wf.selection`（每个工作区最多 1 次）、`wf.registry`（缺模块清单时 1 次，不阻塞）。检查页开着时链路多 1 次事件入口，但同键在途时同样搭车，不新增网络。

## 2. 一次重建的扇出范围

### 2.1 分组口径

同组 = 工作区键相同的全部会话：共享会话（`shared`）加 `stores` 里目录相同的所有会话。工作区键已锚到工作区根（子目录会话与根会话同组，`store-snapshot.js:60-72`，分组用法见 `probe-auto.js:50-58` 与 `refreshAll` 的 `248-252`）。设组大小为 N（含发起者自己）。**N 是运行时数字，没量到**（当前会话数不同则不同）。

### 2.2 `emit` 与渲染的换算关系

- `emit(st)` 的定义只有一行：序号加一并逐个调订阅回调（`store-snapshot.js:335`）。订阅来自 `useStore`（`store-snapshot.js:337-342`）。
- 状态栏每个会话挂 1 个 `useStore(sid)`（`StatusBar.js:48`），所以对某会话 `emit` 1 次 = 该会话的状态栏重渲染 1 次。
- 右侧面板每个挂载实例挂 1 个 `useStore(sid)`（`Dock.js:29`）加 2 个会话列表订阅（当前会话与工作区目录，`Dock.js:23-28`）。所以对某会话 `emit` 1 次 = 正为该会话挂载着的面板实例重渲染 1 次。侧边栏通常只为当前会话挂载 1 个实例（`router.js:41-55` 的单内容体），后台会话的面板实例平时不挂载。**到底几个面板实例挂着、每次重渲染几毫秒，没量到**（量法见第 4 章末尾）。
- 走针（`touchProbeAt`）本身就是一次扇出：同组每个会话各 `emit` 1 次（`store-snapshot.js:91-98`）。

### 2.3 各路径的扇出次数（公式，N 为组大小）

- 探测走针（每次 `wf.probe` 成功都跑，与有没有变化无关，`probe-auto.js:41`）：**N 次 `emit`**（组内每会话 1 次），即 N 次状态栏重渲染 + 已挂载的面板实例各 1 次。
- 探测命中且宿主已补好增量（`patch`，`probe-auto.js:93`）：走针 N 次 + `applySnap` N 次（其余会话逐个 `emit`，`probe-auto.js:75-88`，发起者 1 次在 `89`）= **每会话各 2 次 `emit`**，共 2N 次。
- 探测命中且走整池（`probe-auto.js:96-98`）：走针 N 次 + 主会话 `loadSnapshot` 本身的数次 `emit`（加载态 1 次在 `probe-snapshot.js:141`、装表 1 次在 `261` 或失败 1 次在 `271`，另有磁盘命中时多 1 次在 `129`）+ `applySnap` N 次。同组其余会话各至少 2 次，发起者 3–4 次。
- 人亲手刷新（`refreshAll`，`probe-auto.js:242-301`）：发起者先 `emit` 1 次转圈（`241`），快照装表时 `emit` 1 次（`probe-snapshot.js:261`），链装表时 `emit` 1 次（`probe-chain.js:143`），快照扇出给其余每会话 1 次（`253-272`，含差异闪烁标记），链扇出给其余每会话 1 次（`285-287`），最后发起者 `emit` 1 次收尾（`300`）。合计：**发起者 4 次，其余每会话各 2 次，总 2N+2 次**。每次 `emit` 按 2.2 换算成渲染。
- 在途搭车（`probe-stale.js:59-64`）：搭车者水合加 `emit` 1 次，按需记 `snapshot.fanout`（带组大小 `count`）。这是「后来打开的会话没发新请求却也更新了」的那一行。
- 广播类（与打开无关，列出以免误归因）：`broadcastCfg` 与 `broadcastLogSwitch` 对共享加全组逐个 `emit`（`store-snapshot.js:54-71`），改配置或切日志开关时才跑。

### 2.4 主线程占满问题的一句话回答

打开那一下的主线程工作 = 建一棵面板子树（`DetailsDock` 挂载，含标签行与头部两套同步测量，`Dock.js:75-170`）+ 最多 2N+2 次轻量 `emit`（每次只是序号加一与同步回调，回调里是 React 的 `setState`）。重的是子树初建与折叠测量，不是 `emit` 本身。初建耗时有专用计时（`panelClock`，起点在 `router.js:106-111`，渲染两时刻在 `Dock.js:16-20`，收口在 `DockSync.js:52-67`），**具体毫秒数没量到**（需真机开调试看 `panel.render` 的 `click-to-painted`）。

## 3. 没量到的清单

1. 同工作区会话数 N（决定扇出总次数 2N / 2N+2 到底是几）。
2. 打开一次的真实网络请求数（取决于缓存新不新鲜、在途有没有车、后端与语言键是否命中，静态只能给上限，不能给读数）。
3. `StatusBar` 与 `DetailsDock` 各重渲染几次（取决于 N 与当时挂载了几个面板实例；渲染层按纪律不记日志，见 `docs/design/335-logging-contract.md` 与 `tests/verify-log-truncate.js` 的点名文件规则）。
4. 每次重渲染几毫秒、点开到画完几毫秒（需 `panel.render` 的 `ms` 字段）。
5. 当前闸档位与剩余额度（运行时值，需 `refresh.decide` 的 `tier` 与 `quota.spend` 的 `remaining`）。

## 4. 不动代码的数法：开调试对齐打开动作

### 4.1 准备

1. 打开调试开关（常驻照常落盘，按需只在开着时落盘；`refresh.decide`、`quota.spend`、`panel.render`、`dedup.hit`、`snapshot.fanout`、`chain.stale.drop`、`snapshot.stale.drop` 全是按需，开关关着没有，见 `research/489-appendix.md` 第 1.5 节与 `gate.js:154-161`、`probe-chain.js:76` 的外层判断）。
2. 清掉或记下当前日志文件位置（宿主日志目录，`host.call` 与 `snapshot.request` 都在同一份日志里），记下你点开面板的墙上时间（精确到秒即可，毫秒靠日志自己的字段）。

### 4.2 时间锚点（打开动作）

- 主锚：常驻 `panel.open`（`router.js:102`），字段 `hasCache`、`snapFresh`、`keyHash`、`snapVersion`、`backendId`。它的 `ts` 就是点击后同步记下的那一批，离点击最近。用 `keyHash` 认准是哪个工作区，用 `hasCache`/`snapFresh` 预判后面该有 0 次还是 1 次快照请求。
- 耗时锚：按需 `panel.render`（`router.js:24-26`，阶段枚举见附录 1.5 第 59 号）：`native-open`、`native-opened`、`render-commit`、`render-paint`、`fit-measure`、`click-to-painted`，每行自带 `ms`。**不要用日志的 `ts` 相减**：同一批内所有行共享同一毫秒（`router.js:20-23` 注释），可信的是每行自带的 `ms` 与 `host.call` 的 `latencyMs`。

### 4.3 数请求（`host.call` + `snapshot.request`）

1. 以主锚 `panel.open` 的 `ts` 为起点，向后取 60 秒窗口（覆盖 30 秒死线与磁盘回放）。
2. 数客户端发起：过滤 `event=host.call` 且 `method` 为 `wf.snapshot`、`wf.refresh`、`wf.chain`、`wf.selection`、`wf.cwd`、`wf.registry` 的行。每行有 `latencyMs`（耗时）与 `kind`（`snapshot`/`refresh`/`chain`/`selection`/`cwd`，见 `probe-snapshot.js:154`、`172`、`probe-chain.js:118`、`probe-select.js:61-66`）。发起行（`latencyMs:0`，按需）与回包行（常驻，带真实耗时）配成一对，落单的发起行说明请求超时或被丢弃。
3. 数宿主收到：过滤 `event=snapshot.request` 的行，看 `force` 是否强制（`sessionSnapshot.js:70`）。`force=false` 对应打开与探测的 `wf.snapshot`，`force=true` 对应人亲手刷新的 `wf.refresh`。强制那几次还应有 `snapshot.cache.miss`（`reason=force`，`sessionSnapshot.js:85-86`）。
4. 对账：客户端发了几对 `host.call`，宿主就该有几行 `snapshot.request`（快照路）与链侧的求值记录；差值就是被客户端在途合并吃掉的次数，用下面的合并行验证。

### 4.4 数合并（在途与过期）

- 客户端快照搭车：按需 `dedup.hit`（`scope=snapshot`，`probe-stale.js:57`，十次记一次）与 `snapshot.fanout`（带 `count` 组大小，`probe-stale.js:60`）。有 `fanout` 即证明后来者没发新请求。
- 客户端链搭车：按需 `dedup.hit`（`scope=chain`，`probe-chain.js:88`）。
- 宿主侧合并：按需 `dedup.hit`（`scope=snapshot`，`sessionSnapshot.js:90`）。
- 过期丢弃：按需 `snapshot.stale.drop`（`probe-snapshot.js:191`，判据在 `probe-stale.js:41-48`）与 `chain.stale.drop`（`probe-chain.js:129`）。有这两行说明发了请求但回包没算数，不计入有效重建。
- 迟到落地：按需 `snapshot.late.install`（`probe-select.js:124`）。有这一行说明 30 秒死线后回包又补装了选择，不计入新请求。

### 4.5 数档位（`refresh.decide`）

- 过滤 `event=refresh.decide` 的行，看 `category`（打开相关的是 `lifecycle` 的 `workspace.enter`，人亲手的是 `user-action` 的 `panel.refresh`，探测的是 `background` 的 `probe.tick`，分类表在 `gate.js:34-48`）、`kind`、`verdict`（放行 `allow`、降级 `degrade`、推迟 `defer`、拒绝 `reject`）、`reason`（原因代号，取值表在 `src/shared/refresh/policy.js`）、`tier`（`green`/`yellow`/`red`）。
- 被推迟的去 `refresh.skipped` 看原因与当时队列长度（`gate.js:160`），花费去 `quota.spend` 看 `requests`/`points`/`remaining`（`ledger.js:224`）。这三行都是按需，开关关着没有。

### 4.6 数渲染（`StatusBar` / `DetailsDock` 各几次）

- 日志里没有这一行：渲染函数体内不许把对象转文本记日志（仓库日志纪律），`emit` 本身也没有计数日志。所以**不能用日志数渲染次数**，只能二选一：
  - 用 React 开发者工具的 Profiler 在点开期间录 10 秒，看 `StatusBar` 与 `DetailsDock` 各提交几次、每次几毫秒（已有现成指引，见 `research/748-input-render.md` 第 3 章末尾）。
  - 或在控制台给 `emit` 包一层 `performance.now` 只量耗时（不改生产代码），记每次 `emit` 到提交结束的间隔。
- 用第 2.3 节公式换算验证：先从日志数出 N（`snapshot.fanout` 的 `count`、或 `touchProbeAt` 覆盖的会话数），再按路径（打开走 `afterPanelOpened` 加 `useDockSync`，不是 `refreshAll`）算出期望 `emit` 数，最后与 Profiler 的提交次数对齐。对不上时先查 `snapshot.stale.drop` / `chain.stale.drop`（回包被丢也会少一次 `emit`）。

### 4.7 缺哪种日志（一句话）

- 取数、合并、档位、打开耗时四种日志全有（`host.call` 常驻、`snapshot.request` 常驻、`refresh.decide`/`quota.spend`/`panel.render`/`dedup.hit`/`snapshot.fanout` 按需），缺的只有**渲染计数**（`StatusBar`/`DetailsDock` 每次 `emit` 后的提交次数与毫秒，仓库纪律本来就不许在渲染路径记日志）。
