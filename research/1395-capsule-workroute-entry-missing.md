# #1395 调研：胶囊状态栏的工作路线入口为什么会在「存档里有记录」时整段消失

> 票 #1395 · 只读调研，不改生产代码 · 落盘日期 2026-10-22
> 基线提交 `90be46cf`（当前分支 `main`；动笔时工作树里另有与本票无关的未提交改动：`src/host/git-process.ts`、`src/shared/command-cleanup/**`、`tests/gate-map.json`、`tests/verify-1392-disposed-timer.ts`）。下文行号都以这个提交为准。
> 数据来源：本仓 `src/`、`tests/`、`config/ttl.yaml`、`research/489-appendix.md`；本机工作路线存档文件（只读，只看会话号的形状与条数，不抄任何标题）；相关票 #1355、#1358、#1373 的正文。

## 一、结论

**一句话：** 胶囊整段消失只可能是两种判据状态——**没有可用的在办表**（判据叫 `idle`），或者**在办表是空的、或表里一行都不属于本会话**（判据叫 `empty`）；这两种状态在源码里都是「整段不画」（`src/client/statusbar/SessionChainCapsule.ts:273`）。重启本身只能造出前一种：客户端把磁盘缓存水合回来时会先把表剥掉（`src/client/kernel/store-snapshot.ts:233-245`），所以重启后的第一帧必然是「有快照、没有表」。能不能恢复，全看紧接着那次强制补拉有没有发出去、回包有没有带表；而「工作路线存档里明明有本会话记录、客户端却拿到零条本会话行」这一头，源头是读数按请求里的会话号现场算「这一行是不是本会话」（`src/deck/shell/work-path-readout.ts:151`），客户端从不核对归属，现有日志也没有任何一行记录「表里有几行、其中几行属于本会话」。

| 层次 | 这一层做了什么 | 一手位置 |
|---|---|---|
| 胶囊判据 | 四态里 `idle` 与 `empty` 都 `return null`；只有 `unreadable` 会留一枚 11 像素小图标 | `src/client/statusbar/SessionChainCapsule.ts:272-278` |
| 表的判据 | 没快照 / 字段缺失 → `idle`；有 `ok:true` 的表但零行 → `empty`；本会话行靠 `currentSession === true` 过滤 | `src/client/views/shared/workRouteTable.ts:147-182`、`src/client/statusbar/SessionChainCapsule.ts:185-188` |
| 客户端缓存 | 落缓存、水合都剥表，所以重启后不可能把重启前的表带回来 | `src/client/kernel/store-snapshot.ts:121-128`、`:233-245` |
| 补拉判据 | 只看「表缺不缺」，不看「行是不是自己的」；缺表才强制补拉 | `src/client/kernel/store-snapshot.ts:129-139`、`src/client/kernel/work-route-own.ts:68-75` |
| 读数的归属 | `currentSession: r.session === sessionId`，会话号只从本次请求的参数来，空就全 false | `src/deck/shell/work-path-readout.ts:151`、`src/host/refresh/workRouteReadoutForHost.ts:100-104`、`src/host/snapshotEnvelope.ts:130` |
| 存档 | 30 天保留期与 2MB 上限裁不掉刚写的条目；但**换后端会把整份存档改名留档、新账从空开始** | `src/deck/shell/work-path-store.ts:170-186`、`:191`、`src/shared/refresh/src/chain-prune.ts:16-18` |

最可能的两条失败路径（详见 Q5）：

1. **读数算了、但一行都不属于本会话** → 胶囊 `empty` → 整段不画，而且永远不会自愈（补拉判据只看表缺不缺）。触发点集中在会话号：请求里没带会话号（`src/client/kernel/probe-snapshot.ts:208`），或带的是 A、存档里写的是 B（`src/deck/shell/work-path-readout.ts:151` 严格相等，没有别名解析）。
2. **补拉没发出去，或发了但回包没有表** → 一直停在 `idle`。`snapNeedsOwnWorkRoute` 有四道闸（`src/client/kernel/store-snapshot.ts:135`），`ensureOwnWorkRoute` 对同一份快照只补一次（`src/client/kernel/work-route-own.ts:32-33`），切会话那条分支在新 store 没有快照时直接不发请求（`src/client/kernel/work-route-own.ts:71`）；而一旦发出去找了车，回包还可能按「过期」被丢掉（`src/client/kernel/probe-stale.ts:58-64`）。

## 二、逐条回答

### Q1. 胶囊里「工作路线（在办）」这一段在哪个组件、哪一行绘制，四态各怎么画

【已确认】画在 `SessionChainCapsule` 里，由状态栏直接挂：`src/client/statusbar/StatusBar.ts:372` 是 `h(SessionChainCapsule, { st: s, sid: sid })`，它坐在胶囊那一行 `div.dsws-capsule` 里面（同一行从 `StatusBar.ts:360` 起）。

【已确认】判据是 `sessionChainCapsuleOf(st, sid)`，只有这一个调用点：`src/client/statusbar/SessionChainCapsule.ts:176-193` 定义，`src/client/statusbar/SessionChainCapsule.ts:272` 调用。

【已确认】四态的判据怎么分（`src/client/statusbar/SessionChainCapsule.ts:181-192`）：

- `idle`：读数本身给出 `state === 'idle'`（`:182`）。
- `empty`：读数给出 `state === 'empty'`（`:183`），或者表里有行、但按 `currentSession === true` 过滤后一行不剩（`:185-188`），或者取到行之后 `capsuleRowOf` 又把它筛没了（`:190-191`）。
- `unreadable`：读数不是 `ok`（`:184`），`reason` 缺省写 `host.work-route.shape`。
- `ok`：过滤后还有本会话行，取第一条当门面、整份列表留着展开（`:192`）。

【已确认】四态各怎么画（`src/client/statusbar/SessionChainCapsule.ts:273-278`）：

- `idle` 与 `empty`：`return null`（`:273`）——**整段不画、不占位**。
- `unreadable`：画 `span.dsws-capsule-chain-broken`，里面一枚 `Ic({ n:'alert', size:11 })`，悬停提示写「读不出来」与原因（`:274-278`）——**留下一个 11 像素小图标**。
- `ok`：进 `:279` 起的正常版面，图钉或地图图标加 `#号`（`:292-297`），悬停单子从旧到新往下排（`:291`），同一份判据顺带数了别的会话有几条（`:283-288`）。

【已确认】`idle` 与 `empty` 是从哪一步判出来的，都在 `workRouteTableOf(st)`：`src/client/views/shared/workRouteTable.ts:147-182`。

- 没有快照 → `idle`（`:148`）。
- 回包里有这个字段但值是 `undefined` 或 `null` → `idle`（`:150`）。
- 字段不是对象、或者 `readout.entries` 不是数组 → `unreadable('host.work-route.shape')`（`:151`、`:154`）。
- `raw.ok !== true` → `unreadable(reason || 'host.work-route.read-failed')`（`:152`）。
- 都过了就逐条收形，`currentSession: e.currentSession === true`（`:169`），最后 `state: rows.length > 0 ? 'ok' : 'empty'`（`:176`）。

【推断】由此可以把用户报的「整段消失」**排除掉读盘失败那一档**：真读坏了会留一枚小图标，不会连图标都没有。所以现场只可能是 `idle` 或 `empty`。缺的一环：这条推论只能把范围收窄，没法分清是两者中的哪一个——现有日志没有任何一行记录判据落到了哪一态（见 Q6）。

### Q2. `workRouteTable` 的生产与消费，`currentSession` 怎么算，缺表补不补拉，304 怎么换表，60 秒新鲜期在哪些入口生效

**生产侧（宿主）。**

【已确认】每个回包交出去之前现挂一次：`src/host/snapshotEnvelope.ts:125-135` 的 `withWorkRouteTable(reply, args)`——回包不是 `ok:true` 就原样返回（`:126`），没接读出口也原样返回（`:127`），否则 `reply[field] = await d.workRouteTableReadout(reply, { sessionId: args && args.sessionId })`（`:130`），抛错时写 `{ ok:false, reason:'read-failed' }`（`:132`）。写的是回包对象本身，不是拷贝（读出口那侧的 `put` 在 `src/host/refresh/workRouteReadoutForHost.ts:91-94`，直接赋值给 `reply[WORK_ROUTE_TABLE_FIELD]`）。

【已确认】快照与刷新两条路都是「先取数、再在外层挂表」：`src/host/sessionSnapshot.ts:94`（`handleSnapshot`）与 `src/host/sessionRefresh.ts:83-87`（`handleRefresh`，`:86` 那行）。

【已确认】读出口：`src/host/refresh/workRouteReadoutForHost.ts:85-111` 的 `createWorkRouteTableReadout`。它先判回包 `ok === true`（`:90`），没有读出口或没有 `rootKeyOf` 回 `{ ok:false, reason:'host.work-route.no-binding' }`（`:95`），回包没有工作区根回 `host.work-route.no-workspace`（`:96-97`），然后 `read({ rootKey: String(rootKeyOf(root)), sessionId: ctx && ctx.sessionId ? String(ctx.sessionId) : '', at: now() })`（`:100-104`）；读不出来回 `{ ok:false, reason: out.reason || 'read-failed' }`（`:108`），成功回 `{ ok:true, readout: out.readout }`（`:109`）。

【已确认】读出口的真身：`src/deck/shell/work-path-bindings.ts:54-72`——`store.readSnapshotInfo({ rootKey, sessionId })`（`:59`），读失败回 `{ ok:false, reason:'read-failed' }`（`:62`），否则 `buildWorkPathReadout(ledger, { sessionId: sid, at })`（`:65`）再按 `standard` 投影（`:67`）。

【已确认】`currentSession` 的算法只有一句：`src/deck/shell/work-path-readout.ts:151` 的 `currentSession: r.session === sessionId`。行从工作路线存档的每个会话页里来（`:109-207` 遍历 `ledger.workers`，要求 `w.session` 是非空字符串、`ticketKey` 非空、`actionAt` 是数字，且时间落在 30 天窗口内，`:122-123`），排序是本会话优先、其次按动作时间倒序（`:137-142`）。会话号只从本次请求的参数来：客户端 `props.sessionId` → `src/client/kernel/probe-snapshot.ts:208` → 宿主 `args.sessionId` → `src/host/snapshotEnvelope.ts:130` → `src/host/refresh/workRouteReadoutForHost.ts:102`。**传空串时，全部行的 `currentSession` 都是 `false`。**

**消费侧（客户端）。**

【已确认】界面唯一取数口是 `workRouteTableOf(st)`（`src/client/views/shared/workRouteTable.ts:147-182`），胶囊只是其中一位用户；它只认 `raw.ok === true` 且 `entries` 是数组的表，`currentSession` 原样信任（`:169`），不参与过滤，只用来画「本会话」那枚小徽章。

【已确认】缺表会补拉：`src/client/kernel/work-route-own.ts:68-75` 的 `snapshotRequestPlan` 把「缺自己的表」排在所有早退之前（`:70`），回 `{ force:true, silent:true, why:'work-route-missing' }`，于是走 `wf.refresh` 而不是 `wf.snapshot`（`src/client/kernel/probe-snapshot.ts:213`）。扇出之后另有一条同样判据的补拉：`src/client/kernel/probe-auto.ts:137`、`:140` 调 `ensureOwnWorkRoute`（`src/client/kernel/work-route-own.ts:29-36`）。

【已确认】**有表、但一行都不属于本会话时，不补拉**：`src/client/kernel/store-snapshot.ts:133-139` 的 `snapNeedsOwnWorkRoute` 只看 `const t = st.snapshot.workRouteTable; return t === undefined || t === null`（`:136-137`），源码注释自己写明了原因：「只回答『缺不缺』，不回答『行是不是自己的』——读数里没有会话号，判不出归属」（`:129-132`）。这就是本症状能长期不自愈的根。

【已确认】304 回包也要换表：`src/client/kernel/probe-snapshot.ts:260-274` 的 304 分支在 `:267` 调 `adoptWorkRouteTableIfNewer`；迟到的回包走同一条判据（`src/client/kernel/probe-select.ts:136`）。

【已确认】换表规则只在 `src/client/kernel/work-route-own.ts:43-64` 一处：来者没有表不换（`:45`）；本地没有表就收（`:49-52`）；来者不是 `ok:true` 不换（`:53`）；本地是坏的则收（`:54-57`）；两边都好的时候，**来者的 `readout.at` 必须严格更新才换**（`:58-62`），换法是浅拷贝挂到 `st.snapshot` 上，不原地改旧对象（`:61`）。

【已确认】60 秒新鲜期：值在 `config/ttl.yaml:66`（`syncSnapFreshMs: 60000`），生成到 `src/shared/time-config/src/values.ts:299`，经 `src/shared/tracker/sync.ts:93` 进契约，客户端在 `src/client/kernel/probe-auto.ts:396`、`:399` 用它算 `snapFresh(st)`（看的是 `st.snapshot.generatedMs`）。生效的入口有四处：

- 状态栏三条接线：`src/client/statusbar/StatusBar.ts:165`、`:180`、`:185`。它只影响 `snapshotRequestPlan` 的最后一条分支（`src/client/kernel/work-route-own.ts:72` 的 `hydrated && fresh` 不请求），缺表那条（`:70`）排在它前面，所以缺表时新鲜期挡不住补拉。
- 打开面板：`src/client/kernel/router.ts:106-117`——新鲜就只 `emit`，**一次取数都不发**；另外 `router.ts:137` 把 `snapFresh` 记进了 `panel.open`。
- 面板同步：`src/client/panel/DockSync.ts:150`（不新鲜才 `loadSnapshot`）。
- 点页签：`src/client/views/shared/Tabs.ts:63`（不新鲜才 `loadSnapshot`）。

【推断】60 秒窗口配合上一条能解释「偶发且拖很久」：只要手上那份表还在 60 秒以内，打开面板与点页签都不会去刷新，旧表（或零本会话行的表）就一直挂着，直到下一次自动探测或某处强制刷新。缺的一环：自动探测那条定时链本次没有逐行核完（`src/client/kernel/probe-auto.ts` 的定时器部分），所以「最长多久能自愈」给不出定数。

### Q3. 重启之后：第一次请求带的是哪个会话号，磁盘缓存会不会把旧表水合回来，在途去重会不会把 A 的表给 B

**第一次请求带哪个会话号。**

【已确认】号码来自 `props.sessionId`：`src/client/statusbar/StatusBar.ts:124` 取 `sid`，`:127` 交给 `useStore(sid)`，`src/client/kernel/store-snapshot.ts:388-392` 的 `storeOf` 在新建 store 时写 `st.sessionId = sid`（`:392`；`!sid` 时直接返回模块级共享 store，`:389`）。请求时只有 `st.sessionId` 为真才带：`src/client/kernel/probe-snapshot.ts:208` 的 `st.sessionId ? { sessionId: st.sessionId } : {}`。所以**有号就带，没号就整条不带**（宿主那边按空串算，`src/host/refresh/workRouteReadoutForHost.ts:102`）。

【已确认】重启后第一枪是谁开的：`src/client/statusbar/StatusBar.ts:177-181` 的挂载副作用，第二参写死 `false`（`:180`）；同一次渲染里还有切会话那条（`:185`）与换目录那条（`:155-176`，`:165`）。挂载那次基本都会发（`snapshotRequestPlan` 在无快照时回 `{ force:false, silent:true }`，`src/client/kernel/work-route-own.ts:73`），除非此刻 cwd 还没就绪——`src/client/kernel/probe-snapshot.ts:159-163` 遇到空 cwd 直接返回，一个字节都不发。

**磁盘缓存会不会把重启前的旧表水合回来。**

【已确认】**不会。**落盘时就剥掉了：`src/client/kernel/store-snapshot.ts:121-128` 的 `setCachedSnapshot` 要求 `ok === true` 且有 `maps`（`:121`），然后 `delete s2.workRouteTable`（`:127`，注释写了原因：这份视角只属于当时请求它的会话，不进按工作区共享的缓存）。水合时再剥一遍：`:233-245` 发现缓存条目上还挂着表就浅拷贝删表、必要时重写磁盘。水合还会按 `generatedMs` 大者胜（`:260-262`）。库名 `dsws-cache`、表名 `snapshots`（`:156-168`）。

【已确认】于是重启后的第一帧必然是「有快照、没有表」→ `idle` → 整段不画（见 Q1）。**这不是故障，是设计**；故障是它没能恢复。

**在途去重会不会把一份按会话 A 算的表给到会话 B。**

【已确认】去重键确实没有会话号：`src/host/snapshotInflight.ts:20-22` 是 `cwd|backendId|lang|version`；搭车规则在 `:26-33`（强制只搭强制的车，非强制搭任何车）；快照与刷新两条路共用这张表（`src/host/sessionSnapshot.ts:136-137`、`src/host/sessionRefresh.ts:104-105`）。

【已确认】但「搭车拿到 A 的表」在单次请求上不成立：搭车返回的是 `snapshotOf` / `refreshOf` 内部的原始回包，挂表发生在**搭车之后**、用**本次调用的** `args.sessionId` 现算（`src/host/sessionSnapshot.ts:94`、`src/host/sessionRefresh.ts:86`、`src/host/snapshotEnvelope.ts:130`）。客户端那一层也已按会话挡过：租到别人的在途请求之前先比会话号，不同就不复用（`src/client/kernel/probe-stale.ts:74-76`，注释写明理由是「回包里的表是按它那个会话算好的」）。

【已确认】真正能出问题的是**同一份回包对象被两次挂表先后改写**：`shortCircuit()` 命中缓存时返回缓存里那**同一个对象**（`src/host/sessionSnapshot.ts:105-116`，`:114`），挂表又是就地写（`src/host/refresh/workRouteReadoutForHost.ts:91-94`、`src/host/snapshotEnvelope.ts:130`）。两个会话几乎同时要快照时，后挂的那一份会盖掉先挂的。这正是 #1358（仍在打开）记录的事，票面写明「目前没有已知的可复现路径，属预防性加固」。

【推断】若 A 的回包在 B 挂完表之后才被宿主序列化发出去，A 就会收到 B 的表，里面 A 的行全是 `currentSession:false` → `empty` → 整段不画；这条与「不重启的某些时刻」吻合，也与重启与否无关。缺的一环：**宿主把 handler 的返回值交给 IPC 序列化的时机**——这一步在 DSH 宿主里，本仓看不到，所以没法从源码上断定它能不能发生。

【已确认】另外有两个会让症状**持续**的守卫，值得单独记：

- 补拉对同一份快照只补一次：`src/client/kernel/work-route-own.ts:32-33` 用 `st._workRoutePulledFor === st.snapshot` 挡住重复请求；失败也「等下一份快照再试」（同处注释）。
- 补拉的四个前置条件：`src/client/kernel/store-snapshot.ts:135` 要求 `st.sessionId`、`st.snapshot` 都真，且 `snapLoading !== true`、`selPending !== true`。重启那一下这三个旗子里常有一个不满足，补拉就被跳过。

【已确认】还有一条切会话的缺口：`snapshotRequestPlan` 在 `mode === 'switch'` 时直接回 `null`（`src/client/kernel/work-route-own.ts:71`），而它对「缺自己的表」的判据要求 `st.snapshot` 已经存在（`src/client/kernel/store-snapshot.ts:135`）。**所以切到一个本进程里还没拿过快照的会话时，这一条一次请求都不发**，只能指望换目录那条（`src/client/statusbar/StatusBar.ts:155-176`）接手——而它只在 cwd 变了才动（`:157` 的 `cwd !== s.cwd`），同一工作区里 cwd 不变，它就整个不跑。注释（`:182-184`）承认了「切会话时 cwd 往往已经由会话摘要同步就位，apply 那条整个不跑」，只是没覆盖「新 store 连快照都没有」这一档。

### Q4. 工作路线存档这一侧的读、写、裁剪，会不会把本会话行裁掉；`session` 字段从哪来；重启后会话号稳不稳

【已确认】文件按工作区根的散列命名：`src/deck/shell/work-path-store.ts:73-75`，即 `<家目录>/.dsh/mattskillsdeck/work-path/<根散列>.json`。

【已确认】读：`src/deck/shell/work-path-store.ts:334-355` 的 `readSnapshotInfo`。`rootKey` 空回 `{ ledger:null, failed:false }`（`:340`）；读文件失败回 `failed: raw.failed` 并记一条 `workRoute.read`（`:345-346`）；形状不认识回 `failed:true`（`:349`）；读成功回整份账（`:350`）。**文件不存在不算失败**（`:332`、`:344-347`）——读出口拿到的是「读到了、就是空的」。

【已确认】写：`src/deck/shell/work-path-store.ts:136-235` 一整趟——读旧文件（`:155`，读不出来也照写，`:163-168`），换后端处理（见下），合并（`:189` 的 `applyNote`），裁剪（`:191` 的 `pruneLedger`），隐私自检（`:199-205`），临时文件加改名（`:210`），读回核对（`:218-223`）。回执里那句「在办 N 条」用的是裁剪之后**本会话**的条数（`:227-229`）。

【已确认】裁剪不会裁掉刚写的本会话行：

- 保留期按条目时间算，`cutoff = at - keepMs` 之后只留 `actionAt >= cutoff` 的条目（`src/deck/shell/work-path-ledger.ts:340`、`:347`），不按会话整页删。
- 体积上限 2MB，超了按时间从旧到新裁，二分找能装下的最长一段（`src/shared/refresh/src/chain-prune.ts:16-18`、`:28`、`:31`、`:57`），注释明写「最新的条目一定还在」。
- 常量就是 30 天与 2MB（`chain-prune.ts:28`、`:31`），在 `work-path-store.ts:191` 传入。

【已确认】**但换后端会整份清空**：`src/deck/shell/work-path-store.ts:170-186`——本次 `backend` 与账上的 `ledger.backend` 不同时，先把旧文件改名成 `<根散列>.<旧后端>.json` 留档（`:178`，命名规则在 `:82-86`），然后 `ledger = emptyLedger()`（`:184`），新账从空开始。`ledger.backend` 是随每次写入落盘的（`src/deck/shell/work-path-ledger.ts:203-204`、`:258`）。于是**同一个工作区从 github 换到 markdown 再换回来，读数会依次变成「零条」**：表是 `ok:true`、`entries` 为空 → `empty` → 胶囊整段不画；而旧记录确实还「在存档里」，只是躺在了留档文件里。本机存档目录里只有 `.json` 与一个 `.tmp`，没有 `.<后端>.json`，所以这一次没有发生——但它与「存档里有记录、胶囊却没入口」逐字吻合，是 30 天/2MB 之外唯一会主动清空整份账的行为。

【已确认】`session` 字段的来源：`src/deck/shell/work-path-ledger.ts:202-233` 的 `applyNote` 按 `input.sessionId` 分页（`:205`，没有就新建一页，`:207`），条目字段是 `ticketKey/effortId/title/action/actionAt/source`（`:220-227`），回写时 `workers.push({ session, label, labelAt, entries })`（`:274`）——**存档里那个 `session` 就是写这一笔时会话号的原文，没有被规范化过**。

【已确认】写这一笔的会话号从哪来：`src/deck/shell/work-path-record.ts:246` 取 `s.sessionId`（`:274-282` 组输入、`:286` 调 `note`），`s` 是 `call-shell.ts` 里的 `meta.session`（`src/deck/shell/call-shell.ts:374`），它在 `src/deck/shell/session-workdir.ts:132` 与 `src/deck/registration/agent-row.ts:220-233` 两处按同一套优先级取：`session.id` → `session.sessionId` → `session.header.id` → `session.header.sessionId` → `agent.sessionId`。**插件自己不生成会话号**，用的是 DSH 交下来的。

【已确认，数据层面】本机存档目录里两种形状并存：绝大多数页是 `session-<uuid>`（44 字符），另有 6 页是裸 uuid（36 字符，都在 `8a34cd1cc9fea496.json` 里，其中 4 页是 2026-10-22 的，各 1 条）。这说明那套优先级的取值在不同上下文里会落到不同格子。**是不是主会话也会两侧不一致，仓库内证据不足**（见第三节）。

【已确认】一条本仓内旁证，说明插件自己也不假定「入口给的号」与「会话对象的 id」相同：按 cwd 兜底找到会话时，沙箱那一侧会把传进来的号换成 `found.id`（`src/deck/registration/sandbox-guard.ts:55`，返回 `{ policy, sessionId: realId }` 在 `:56`）。

【推断】「重启之后会话号是否保持稳定」——**仓库内证据不足**。能确认的只有：存档里同一个工作区文件跨 10-20 到 10-22 记了 76 个不同的会话页，说明这个号在盘上是一个稳定标识；但 DSH 重启后交给面板的 `props.sessionId` 是否与当时写进存档的那个号逐字相同，由 DSH 的会话生命周期决定，本仓看不到。缺的一环：一次同时带 `sidHash`（写侧 `workRoute.write`）与 `sidHash`（读侧新增日志）的对照。

### Q5. 穷举「存档里有本会话行、胶囊却没有入口」的失败路径

判定口径：胶囊整段不画 ⇔ 判据落在 `idle` 或 `empty`（`src/client/statusbar/SessionChainCapsule.ts:273`）。

| # | 失败路径 | 胶囊表现 | 判定证据（源码分支与字段） |
|---|---|---|---|
| 1 | 宿主根本没把表挂上：没接读出口，或回包不是 `ok:true`，`withWorkRouteTable` 原样返回 | `idle`，整段不画 | `src/host/snapshotEnvelope.ts:125-127`、`src/host/sessionSnapshot.ts:91-93`、`src/client/views/shared/workRouteTable.ts:150` |
| 2 | 宿主如实报了读不到（`no-binding` / `no-workspace` / `read-failed`） | `unreadable`，有一枚 11 像素小图标 | `src/host/refresh/workRouteReadoutForHost.ts:95`、`:96-97`、`:108`；`src/client/views/shared/workRouteTable.ts:152`；`src/client/statusbar/SessionChainCapsule.ts:274-278`。**出现小图标就不是本症状** |
| 3 | 客户端根本没有快照：重启首帧只有磁盘水合、cwd 还没就绪、host 不可用、请求失败或 30 秒超时 | `idle`，整段不画 | `src/client/kernel/probe-snapshot.ts:159-163`（空 cwd）、`:169`（没 host）、`:288-311`（失败与超时）；`src/client/views/shared/workRouteTable.ts:148`；`src/client/statusbar/StatusBar.ts:186` 的 `statusbar.fallback` 会记 `no-snapshot` / `no-cwd` / `snap-error` 三档之一 |
| 4 | 存档读到了但是空的：文件不存在（读出口回 `ok:true` 空表），或换后端把整份改名留档、新账从空开始 | `empty`，整段不画 | `src/deck/shell/work-path-store.ts:332`、`:344-347`、`:170-186`；`src/client/views/shared/workRouteTable.ts:176` |
| 5 | 表里有行、但一行都不属于本会话：请求没带会话号（空串）或两侧号不同 | `empty`，整段不画 | `src/deck/shell/work-path-readout.ts:151`（严格相等）；`src/client/kernel/probe-snapshot.ts:208`（没号就不带）；`src/host/refresh/workRouteReadoutForHost.ts:102`（空串照算）；`src/client/statusbar/SessionChainCapsule.ts:185-188`（过滤后空） |
| 6 | 补拉压根没发：四道前置闸（`st.sessionId` / `st.snapshot` / `snapLoading` / `selPending`）任一不满足，或同一份快照已经补过一次 | 停在 `idle` 或旧表 | `src/client/kernel/store-snapshot.ts:135`；`src/client/kernel/work-route-own.ts:32-33`；另见 `:71`（切会话分支直接不发） |
| 7 | 补拉发了，回包被当成过期丢掉：同工作区另一个会话发了更新的请求 | 停在原态 | `src/client/kernel/probe-stale.ts:58-64`；`src/client/kernel/probe-snapshot.ts:254-257`（记 `snapshot.stale.drop`） |
| 8 | 补拉成功了，但那份回包没有表（宿主那一下没接上读出口） | `idle` | `src/host/sessionSnapshot.ts:91-93`；`src/host/snapshotEnvelope.ts:127` |
| 9 | 迟到的 304 带了表，但被判「不比本地新」而拒收 | 旧表继续挂着（可能零本会话行） | `src/client/kernel/work-route-own.ts:58-62`；`src/client/kernel/probe-select.ts:136` |
| 10 | 写盘成功、回执里也有表，但快照没刷新：`onDeckWrite` 只做命名摘要，写事件那次取数是空实现 | 存档有行、回执有表，胶囊照旧不画 | `src/host/refresh/wiring.ts:167`、`:177-189`（只调 `namingSummary.onDeckWrite`）；`:162-165`（`fetchForWriteEvent` 直接回 `{ requests:0, points:0 }`）；`src/deck/shell/call-shell.ts:433-447`（表只进工具回执） |
| 11 | 60 秒新鲜期内，打开面板 / 点页签 / 面板同步都不刷新 | 旧表或缺失一直挂着 | `src/client/kernel/router.ts:106-117`；`src/client/views/shared/Tabs.ts:63`；`src/client/panel/DockSync.ts:150` |

【推断】把上面 11 条按「能不能解释本症状」分两堆：

- **能解释「整段消失」的**：1、3、4、5、6、7、8、9、10、11——它们都通向 `idle` 或 `empty`。
- **不能的**：2（会留小图标）。
- **最贴合「存档里有记录」这句描述的**：4（换后端清空）、5（会话号对不上）、10（写了但没刷新）、6 与 7（补拉没发或被丢）。其中 5 与 6 最能解释「偶发 + 不自愈」：5 一旦发生，补拉判据（只看缺不缺）永远不会再触发；6 一旦把「补过一次」的守卫写上，同一份快照也不会再试。

【推断】以上都是源码分支的判定，没有一条被真机日志证实发生在这次现场。缺的一环：能记录「判据落在哪一态、表里有几行属于本会话」的那一行日志（Q6 给出建议）。

### Q6. 观测建议：要判断「这一次胶囊为什么没画」，最小需要补哪个事件

【已确认】先核现有事件能不能覆盖——**都覆盖不到**：

- `snapshot.built`（`research/489-appendix.md` 第 1 章 #10，表在第 `:252` 行）：字段只有 `maps/specs/issues/labels/open/closed/partial/fallback/latencyMs`，**没有会话号，也不记工作路线表**；落点是 `adoptSnapLog`（`src/host/snapshotEnvelope.ts:104-114`，刷新路另有一份在 `src/host/sessionRefresh.ts:78`）。
- `host.call` 的 `reason`（#26，附录 `:259`）：`work-route-missing` 只出现在**成功行**（`src/client/kernel/probe-snapshot.ts:215-216`、`:236`），失败行 `host.call.fail` 不带 reason（附录 #27，`:260`）。它只能证明「客户端认为缺表、发过一次强制补拉」，分不出「发了但失败」与「根本没发」，更答不了「回来的表里有几行属于本会话」。
- `statusbar.fallback`（#38，附录 `:268`；`src/client/statusbar/StatusBar.ts:186`）：只有一个 `reason`，枚举是 `no-snapshot` / `no-cwd` / `snap-error`。**恰好缺「有快照、但没有可用的表」这一档**，也分不出 `idle` 与 `empty`。
- `workRoute.write` / `workRoute.read`（#110 / #111，附录 `:317`、`:318`；`src/deck/shell/work-path-store.ts:99-108`）：`workRoute.read` 只在读盘失败时发一行（`:105-108`、`:345`、`:349`、`:352`），正常读回**一条都不记**，也不记「读到几条、其中几条是本会话」。`workRoute.write` 记的是写侧，回答不了读侧。
- 宿主挂表这一层（`src/host/refresh/workRouteReadoutForHost.ts`）**一行日志都没有**。

【建议】加一条常驻事件 `statusbar.chain`，落点在判据算完、画之前——即 `src/client/statusbar/SessionChainCapsule.ts:272` 之后：

- 字段（只记条数、散列、枚举，不记标题、不记会话号原文）：`state`（`idle` / `empty` / `unreadable` / `ok`）、`why`（`no-snapshot` / `no-table` / `no-session-id` / `zero-own` / `read-failed` / `shape`）、`own`（本会话行数）、`others`（其它会话行数）、`tableRows`（表里总行数）、`snapGenMs`（快照生成时刻，用来分辨是不是水合来的旧快照）、`sidHash`（与 `workRoute.write` 同一个散列口径，两者能串起来）、`cwdHash`。
- 触发时机：只在 `state` 或 `own` 与上一次不同时记一行。状态不变就不记，避免每帧刷屏。
- 该不该常驻：**该**。它只在状态变化时落一行，量极小；而这类故障是「事后才来查」，等按需开关打开时现场早就过去了。同一个理由也适用于把它写进 `research/489-appendix.md` 第 1 章（按仓里的日志纪律，增删事件要同步改那份对照表，并跑 `tests/verify-log-*`）。
- 可选第二步（本次不建议一起做）：在宿主挂表成功之后（`src/host/refresh/workRouteReadoutForHost.ts:109` 之前）补一条 `workRoute.attach`，字段 `ok` / `rows` / `own` / `sidHash` / `rootHash`，用来分辨「宿主没算对」与「客户端没收到」。它比客户端那条多一层判断力，但会动宿主回包路径的日志面，值得单独立票。

## 三、仍未确认的问题

以下几条只能靠真机与日志定，源码上再翻也翻不出结论：

1. **`props.sessionId` 的真实取值形状，以及重启后是否稳定。** 它由 DSH 注入（`src/client/panelAssembly.ts:124` 把 StatusBar 注册到 `conversation.input.dock`），本仓只消费不生产；`src/deck/registration/agent-row.ts:220-233` 与 `src/deck/shell/session-workdir.ts:132` 的取值链能证明「两种形状都可能被写进存档」，但不能证明「同一个会话两侧同形」。需要一次对照：同一次操作里写侧 `workRoute.write` 的 `sidHash` 与读侧新增 `statusbar.chain` 的 `sidHash` 是否相同。
2. **宿主把 handler 的返回值交给 IPC 序列化的时机。** 这决定 #1358 那条「同一份回包对象被两次挂表改写」能不能被对面的会话看见（`src/host/snapshotEnvelope.ts:130` 就地写、`src/host/sessionSnapshot.ts:114` 返回缓存同一对象）。这一段在 DSH 宿主里，本仓看不到。
3. **这一次现场到底落在 `idle` 还是 `empty`。** 两者都表现为整段消失，源码上没有区分手段；需要 `statusbar.chain` 的 `state` 与 `why`。
4. **发生那一刻表里有没有行、其中几行属于本会话。** 现在没有任何一行日志记这件事；`workRoute.read` 只在读盘失败时发。
5. **换后端改名在本机是否发生过。** 存档目录里没有 `.<后端>.json` 留档文件（`src/deck/shell/work-path-store.ts:82-86` 的命名），说明截至核对时没发生；若用户报的时段里切过后端，这条就会成立，需要看目录里有没有新增留档文件。
6. **补拉被「同一份快照只补一次」的守卫挡掉之后，下一份快照从哪来、多久来一次。** 自动探测那条定时链本次没有逐行核完（`src/client/kernel/probe-auto.ts` 的定时器部分），所以「最长多久能自愈」给不出定数。
