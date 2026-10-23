# #1436 调研：打开会话时胶囊状态栏的工作路线入口为什么要等一阵才出现

> 票 #1436 · 只读调研，不改生产代码 · 落盘日期 2026-10-23
> 基线提交 `06dea898`（分支 `main`；动笔时工作树里另有与本票无关的未提交改动，主要是 `package/` 下被删的一批文件，本票没有触碰它们）。
> 数据来源：本仓 `src/`、`config/ttl.yaml`、真机日志 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-23.log`（只读；下文数字的采样时间逐条注明）、相关票 #1395 / #1355 / #1358 / #1373 的正文，以及 `research/1395-capsule-workroute-entry-missing.md`、`research/1009-recheck-2026-10-21.md`。

## 一、结论

**一句话：不是渲染慢，也不是工作路线数据丢了，而是首帧为了一张工作路线表，发了一次最贵的请求。** 客户端把缓存快照水合回来时按 #1355 的设计把 `workRouteTable` 剥掉（`src/client/kernel/store-snapshot.ts:121-128`、`:225-246`）；缺表判据 `snapNeedsOwnWorkRoute` 于是压过「60 秒新鲜期」，直接要求强制补拉（`src/client/kernel/work-route-own.ts:68-75`）；强制补拉走的是 `wf.refresh`（`src/client/kernel/probe-snapshot.ts:213-216`），宿主这条路径每次都会 `resetGhCache()` 再绕过内存与磁盘缓存重建整份快照（`src/host/sessionRefresh.ts:112-114`、`:130`、`:291-296`；`src/host/tracker/snapshot.ts:112-132`、`:191`）。重建回来之前，胶囊对 `idle` 判据「整段不画」（`src/client/statusbar/SessionChainCapsule.ts:176-193`、`:273`），所以用户看到的是空白，而不是加载中。本机今天这段强制重建的回包中位 **25,146 毫秒**，多数落在 20–29 秒，贴住客户端 30,000 毫秒的死线——这就是「要等一阵子」；超过死线先超时、靠迟到回包再补上，再加上回包可能按「过期」被丢掉或补拉失败，就是「干脆不出现」。

| 层次 | 这一层做了什么 | 一手位置 |
|---|---|---|
| 胶囊判据 | 表缺 → `workRouteTableOf` 回 `idle` → 胶囊组件 `return null`，整段不画、不留占位 | `src/client/statusbar/SessionChainCapsule.ts:176-193`、`:273`；`src/client/views/shared/workRouteTable.ts:147-182` |
| 缓存水合 | 落缓存、水合都先剥掉 `workRouteTable`（表带着请求它的会话视角，不能跨会话共享） | `src/client/kernel/store-snapshot.ts:121-128`、`:225-246` |
| 缺表补拉 | 只看「表缺不缺」，缺表就强制，排在 60 秒新鲜期早退之前 | `src/client/kernel/store-snapshot.ts:133-139`、`src/client/kernel/work-route-own.ts:68-75` |
| 请求选择 | 强制 → `wf.refresh`；非强制 → `wf.snapshot` | `src/client/kernel/probe-snapshot.ts:213-216` |
| 宿主刷新 | `resetGhCache` + `composeSnapshot({force:true})` 绕过缓存，重建整份快照后才挂表 | `src/host/sessionRefresh.ts:83-87`、`:112-114`、`:130`、`:291-296`；`src/host/snapshotEnvelope.ts:125-135` |
| 等待与超时 | 客户端最多等 30 秒；超时后 `snapMode='err'`、`snapPending=true`，回包迟到仍整份落地 | `src/client/kernel/probe-snapshot.ts:218-229`、`:288-311`；`config/ttl.yaml` 的 `snapWaitMs: 30000` |

两条最可能的观感来源：

1. **「要等一阵子」**：这一次 `wf.refresh` 的回包耗时中位 25,146 毫秒；入口要等这份整份重建回来才画得出来（见第四节）。
2. **「干脆不出现」**（推断，尚未逐次对到现场）：一种可能是等过 30 秒后没有迟到回包（或回包失败）；另一种是回包按「过期」被丢掉（`src/client/kernel/probe-snapshot.ts:242-257`）；还有一种是表回来了但按本会话号过滤后一行不剩，判 `empty` 同样整段不画——这一支与 #1395 的调查同源（`research/1395-capsule-workroute-entry-missing.md` 第一节）。

## 二、逐条回答

### Q1. 首帧为什么是空白，而不是「读取中」

【已确认】胶囊只有四个判据态：`idle`、`empty`、`unreadable`、`ok`。表缺时 `workRouteTableOf` 落到 `idle`（`src/client/views/shared/workRouteTable.ts:147-182`：没有快照、字段是 `undefined` 或 `null` 都回 `idle`），而组件对 `idle` 与 `empty` 直接 `return null`（`src/client/statusbar/SessionChainCapsule.ts:273`）——注释写明「没快照、没记录、当前会话没记录：调用方整段不画」。只有 `unreadable` 会留一枚 11 像素小图标（`:274-278`）。

【已确认】这条判据现在有日志：`logStatusFallback` 把判据与行数写进 `statusbar.fallback`（`src/client/statusbar/SessionChainCapsule.ts:204-229`，同形状只记一次）。本机日志今天有 550 行（采样时间 17:31），其中 `work-route-idle` 269 行、`work-route-empty` 111 行、`no-snapshot` 153 行、`snap-error` 17 行（此前 17:19 的读数是 539 行：151 / 261 / 110 / 13）。`work-route-idle` 就是「快照在、表还没到」的那一段，正是用户看到的空白。

【已确认】等待超过 30 秒以后，界面也不会一直沉默：超时把 `snapMode` 置 `err`、`snapPending` 置真（`src/client/kernel/probe-snapshot.ts:296-311`），状态区据此改说「仍在等，拿到后自动更新」（`src/client/views/shared/truthLines.ts:101-104`）。但在 0 到 30 秒之间，这一块没有可见的加载态——`force` 且 `hasCache` 为真时连 `snapMode='loading'` 都不会设（`src/client/kernel/probe-snapshot.ts:199-203`），所以用户先看到的就是「什么都没有」。

### Q2. 表为什么会缺；它是设计还是丢失

【已确认】是设计：#1355（已关闭，修复 `4c4f6e82`）解决「胶囊把别的会话的行当成本会话」，办法就是水合缓存时先剥表、由每个会话按自己的会话号重新补拉。代码在落缓存前 `delete s2.workRouteTable`（`src/client/kernel/store-snapshot.ts:121-128`），水合回来时同样剥（`:225-246`）。因此**任何有缓存快照的会话，首帧必然是「有快照、没有表」**——睡眠/重启/换视图后重新打开都会命中。

【已确认】表本身在宿主回包里是临时挂上去的：每个 `ok:true` 的回包交出去之前，`withWorkRouteTable` 现场读一次工作路线存档并把结果写进 `reply.workRouteTable`（`src/host/snapshotEnvelope.ts:125-135`；`src/host/sessionRefresh.ts:83-87`）。它不进缓存对象，也不跟着磁盘缓存回放。

### Q3. 缺表之后为什么选的是最贵的 `wf.refresh`

【已确认】请求计划只有四条路，缺表判据排第一条：`snapshotRequestPlan` 里 `if (snapNeedsOwnWorkRoute(st)) return { force: true, silent: true, why: 'work-route-missing' }`，这条排在「换过会话」与「已水合且 60 秒内新鲜」两条早退之前（`src/client/kernel/work-route-own.ts:68-85`；`snapNeedsOwnWorkRoute` 见 `src/client/kernel/store-snapshot.ts:133-139`）。所以表缺时，即使缓存快照只有几秒新，也会照样发起强制请求。

【已确认】`force` 直接决定方法名：`const callMethod = force ? 'wf.refresh' : 'wf.snapshot'`（`src/client/kernel/probe-snapshot.ts:213-216`）。客户端发起时会先记一行耗时 0 毫秒、带 `reason=work-route-missing` 的 `host.call`（`:212-215`），回包再记一行带真实耗时的，这也是下文统计的依据。

【已确认】对照：非强制的 `wf.snapshot` 在缓存命中时直接回缓存对象、随后现挂本会话的表（`src/host/sessionSnapshot.ts:91-94`、`:119-131`）——缺表补拉本来可以走这条便宜路，现在却走了最贵的强制重建。

### Q4. 这笔强制重建为什么值 25 秒

【已确认】宿主 `wf.refresh` 的路径是「先清 gh 解析缓存，再强制重建」：`refreshOf` 首先按工作区规范化键与在途去重（`src/host/sessionRefresh.ts:91-109`、`src/host/snapshotInflight.ts:26-33`，强制只搭强制车），然后 `resetGhCache()`（#195，`src/host/sessionRefresh.ts:112-114`），再 `composeSnapshot(..., { force: true })`（`:130`；注释在 `:291-296` 说明强制刷新绕过磁盘缓存，#366）。快照模块本身对 `force` 也绕过内存与磁盘缓存（`src/host/tracker/snapshot.ts:112-132`、`:191`）。重建完才在外层挂表（`:83-87`）。

【已确认】代价主要是 GitHub 读数子进程，不是渲染：本机日志今天 `gh.exec` 104,843 次，单次中位 932 毫秒、p90 1,650 毫秒；`gh.lane.saturated` 4,548 行（read 桶最多 64 条在飞，排队 25–28 条）；`gh.timeout` 1,159 行（12 秒钳制）；`snapshot.built` 266 次，平均每次重建对应约 390 条 `gh.exec`（采样时间 17:19）。一次重建就是把整个仓库几百个读数重新取一遍。

【已确认】实测等待分布（采样时间 17:30，日志 106,210,437 字节 / 631,596 行）：`wf.refresh` 全部 `host.call` 行 884 行（含客户端发起行、回包行与宿主行）；带 `reason=work-route-missing` 的 663 行，其中客户端发起行 357 行（耗时 0 毫秒）、真实回包 306 行。回包耗时：中位 25,146 毫秒、p75 27,359、p90 28,769、p99 30,358、最大 30,363 毫秒。分桶：5 秒以下 20 行、5–10 秒 13 行、10–20 秒 23 行、20–29 秒 225 行、29 秒以上 25 行、30 秒及以上 6 行。**九成以上的等待落在 20–30 秒这一段**，与「等一阵子才出现」的观感一致。

【已确认】现场样貌（trace `1f6478fbc4673756`）：一次 `wf.refresh` 回包耗时 25,667 毫秒；同一毫秒里又有 9 条 `reason=work-route-missing` 的补拉发起（多个界面存储同时缺表），下一批回包再等 25,754–25,943 毫秒。多路齐发会被宿主按同一工作区键合并成同一趟（`snapshotInflight.ts:26-33`），但第一趟回包落地后，后到的存储仍可能各补一趟。

### Q5. 为什么有的很快就出现、有的干脆不出现

【已确认】客户端只等 30 秒（`snapWaitMs: 30000`，`config/ttl.yaml`；`src/client/kernel/probe-snapshot.ts:218-220`）。到点后：`snapMode='err'`、`snapPending=true`、横幅改说「仍在等」（`:296-311`、`truthLines.ts:101-104`），但**这不会取消已经发出的请求**；它回来时仍按「这次等待作废、结果整份落地」处理（`:225-229`、`_installLateSnapshot`），所以「过一会儿突然出现」是正常路径，不是幻觉。

【推断】「不出现」有三种可解释的走向，本次没有逐次对上现场：

1. 30 秒后没有迟到回包，或回包失败（`host.call.fail` 会记一行；今天 `snap-error` 17 行，但日志没有把失败直接串到某个会话的入口是否出现）。
2. 回包按「过期」被丢掉：请求发出后工作区根真的换了（`:242-251`，此时会写进旧工作区缓存，不装给当前视图），或后端换过 / 不是这把键上最新的一次（`:252-257`，`snapshot.stale.drop`）。
3. 表回来了，但按本会话号过滤后一行不剩，判 `empty` 同样整段不画（`SessionChainCapsule.ts:185-188`）——这一支与 #1395 的「显示过之后消失」共用一个判据，需另查。

【已确认】只要表到达且本会话有行，下一次打开就快：表装在快照对象上，60 秒新鲜期内 `snapshotRequestPlan` 会早退；超过新鲜期也只是后台静默刷新，不影响已画出来的入口。所以「同一个会话第二次打开很快」并不矛盾。

### Q6. 往哪修，风险在哪

按代价从低到高（都需另立实现步骤，本票只记录方向）：

1. **首帧先画「读取中」占位**：不动数据链路，只把 `idle` 的「整段不画」改成有反馈的占位。风险最低，但不缩短等待。
2. **缺表补拉改发非强制 `wf.snapshot`**：缓存命中即回旧快照并现挂表，通常几百毫秒到一两秒。风险是 304 与在途去重两处可能让表丢失，要绕开 #1373 的老坑（304 回包旧表被丢，修复 `35b32e04`）。
3. **新增一条只读工作路线的宿主电话**：宿主侧已有现成的读出口 `workRouteRead`（`src/host/refresh/wiring.ts:417-418`、`src/host/refresh/workRouteReadoutForHost.ts:85-109`，工具回执的 `data.workRoute` 走的就是它），首帧只取表、不碰快照重建。代价是要新增协议、缓存与节流，并想清楚与快照表的一致性。
4. **缩短强制重建本身**（例如只刷与工作路线相关的读数）：不在本票范围，风险最大。

共同的边界：**不改工作路线的数据模型与行归属算法**（按请求里的会话号判「这一行是不是本会话」，见 `src/deck/shell/work-path-readout.ts:151`）——那是 #1355 的修复面，本票只解决「首帧拿表太贵」。

## 三、证据与来源

代码（基线 `06dea898`）：

- `src/client/statusbar/StatusBar.ts:162-192`：`apply` / `mount` / `switch` 三处都跑 `runSnapshotRequestPlan`。
- `src/client/kernel/store-snapshot.ts:121-128`、`:133-139`、`:225-246`：落缓存与水合剥表；`snapNeedsOwnWorkRoute` 的四道闸。
- `src/client/kernel/work-route-own.ts:68-85`：缺表补拉排第一条，强制且静默，`why='work-route-missing'`。
- `src/client/kernel/probe-snapshot.ts:150-236`、`:242-257`、`:288-311`：请求选择、30 秒死线、迟到落地、超时与过期丢弃。
- `src/host/sessionRefresh.ts:83-87`、`:91-114`、`:130`、`:291-296`；`src/host/snapshotInflight.ts:26-33`；`src/host/tracker/snapshot.ts:112-132`、`:191`：宿主强制重建与去重。
- `src/host/snapshotEnvelope.ts:125-135`；`src/host/sessionSnapshot.ts:91-94`、`:119-131`：表怎么挂上回包，非强制路径怎么回缓存。
- `src/client/views/shared/workRouteTable.ts:147-182`；`src/client/statusbar/SessionChainCapsule.ts:176-193`、`:204-229`、`:273-278`：判据、日志与「整段不画」。
- `src/client/views/shared/truthLines.ts:101-104`；`config/ttl.yaml`：超时后的「仍在等」与 30 秒死线。

真机日志（`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-23.log`，只读 grep，未抄任何票标题）：

- `statusbar.fallback` 550 行（17:31）：`work-route-idle` 269 / `work-route-empty` 111 / `no-snapshot` 153 / `snap-error` 17。
- `wf.refresh` 与 `reason=work-route-missing` 的耗时分布（17:30）：663 行 = 发起 357 + 回包 306；p50 25,146ms、p90 28,769ms、p99 30,358ms、max 30,363ms。
- `gh.exec` 104,843 次、中位 932ms、p90 1,650ms；`gh.lane.saturated` 4,548 行；`gh.timeout` 1,159 行；`snapshot.built` 266 次（17:19）。
- trace `1f6478fbc4673756`：一次 25,667ms 的回包，同一毫秒 9 条新一轮补拉。

既有笔记：

- `research/1395-capsule-workroute-entry-missing.md`：胶囊 `idle`/`empty` 都整段不画；水合剥表是设计；补拉判据只看表缺不缺。
- `research/1009-recheck-2026-10-21.md`：2026-10-10 实测一次快照 `latencyMs=29278`，大仓第一次重建可到分钟级。
- `research/1221-recheck-2026-10-21.md`、`research/907-recheck-2026-10-21.md`：胶囊数据源与真机存档/日志落点的既有核对。

## 四、开放问题

1. 「不出现」的现场到底是「超时后没有迟到回包」「回包按过期被丢」还是「表回来了但零行」？现有日志能分到 `statusbar.fallback` 的档位，但没有一条把「这次请求」与「这个会话最终有没有画出入口」串起来；要坐实得加一个请求号或会话号字段。
2. 缺表补拉改非强制 `wf.snapshot` 后，304 与在途去重两处会不会让表再次丢失？这是 #1373 的老坑，需要先补一条会造「有缓存快照但没表」局面的自动化判据。
3. #1395 的「显示过之后整段消失」与本票的「第一次打开要等」是否同一根因？目前只能确认共用「水合剥表 → 缺表 → 补拉」这一段链路，未逐现场比对。
