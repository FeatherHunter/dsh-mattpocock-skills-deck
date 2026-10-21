# 960 根因 claim 代码层验证（只研究，未改代码）

> 来源：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/960
> 方法：只认一手源码（src/host、src/shared、tests 门禁、research 一手实测），每个结论带文件行号。grep 零命中即记零，不猜。
> 结论日期：2026-10-09

## 总表：他给的原因对不对

| claim | verdict | 一句话 |
|---|---|---|
| ① execGh 唯一出口缺并发准入 | 部分成立 | 缺准入成立，唯一不成立（房间内唯一，真出口三处） |
| ② 慢 gh 占位 + 新请求堆成自激，empty 87% 故调大 TTL 无用 | 成立（方向），数字待复核 | 机制已定位：force:true 风暴 + 永不缓存三路 + 广播清缓存 |
| ③ 终端放大器（3 AV + 内存超配 + 代理，23 条即开火） | 无法证实 | 仓内零采集、白名单不允许，23 重合是巧合 |
| 宿主 10s×2 杀渲染 kill 链 | 无法证实 | 插件独立进程，本仓无宿主源码与日志第二出处 |
| 单跑 5–7s vs 并发撞 30s 墙故差异只在并发 | 成立一半 | 拥挤是主因成立，排除网络/配额成立，但放大器归因缺对照 |
| 补丁 A/B/C/D | 方向对、落点/值/契约错 | 见第 5 节，不可按字面合入 |

对抗式结论：已找到可定位的明显 bug（见第 6 节），等于定位到传输层缺口 + 触发源。

## 1. claim①：唯一出口缺并发准入

### 1.1 TIMEOUT 30s：成立，单源

- `src/host/tracker/backends/github/client.js:41` `export const TIMEOUT_MS = 30000`，注释写明全仓唯一字面量。
- 同值分发：`src/host/index.js:33`（注入 repoKeys/platformChannel）、`src/host/detectChain.js:30` fallback 30000（经 ghTimeoutMs 统一）、`src/host/repoKeys.js:86,151` `timer.timeout(TIMEOUT_MS)`、`src/host/platformChannel.js:221` 默认 timeout。

### 1.2 只记账不拦：成立，三处同形

- 房内 `client.js:56-63` reportOutbound：拿不到 gate 直接 return，catch 注释“报账失败不许影响已经起来的这一条命令”。
- 同形：`src/host/repoKeys.js:30-38`、`src/host/platformChannel.js:198-209`、`src/host/versionControl.js:49`。
- 闸侧 `src/host/refresh/gate.js:246-252` noteOutbound 只做 stats.transport 累加，无等待/抛错/verdict。
- 房内从不调 gate.send（只调 noteOutbound）；detectChain noteChainEval 以 {requests:0} 记身份，避免重复计数（:34-39）。

### 1.3 闸无上限/队列/信号量：成立，带术语修正

- gate.js 全文件无 Semaphore/p-limit/acquire/maxConcurrent 语义；头注释 :13 明写“不排队、按步记账”。
- 唯一类队列 deferred (:124,219-225) 是裁决推迟队列（同工作区只留最后一次，5 分钟过期），不是执行限流。
- #923 复核“d9663ad 后无队列无信号量”与现状一致；#923 定版 64“实现属新功能、另排”，即缺口真实存在。

### 1.4 唯一出口：证伪（房内真、仓内假），runJson 不存在

- 房内：client.js execGh :144-199，execJson :205-216 调 execGh，run :219-224 调 execGh，导出 :226-231 仅 {execGh,execJson,run}。无 runJson 实体。
- 真起进程三处（门禁 tests/verify-gh-gateway.js:67-71 登记表自证，LEGACY_MAX=0 :84）：
  - repoKeys runGh :67-126（:73 报账 + :76 spawn）与 execProc :133-168（:139 报账 + :142 spawn）；
  - platformChannel detectionExec :190-246（:198-208 报账 + :212 spawn）；
  - client 的 exec 最终落到上二者（getExec :43-48 取 ctx.exec；BackendContext.exec 即 detectionExec）。
- 房外直调绕行：detectChain ghAsk/preflightScope 经 runGh、快照/探测经 detectionExec、commentThreads/snapshotBuild 经 execProc，均不经过 client 信号量。只改 client.js 会漏。
- 点数口径：graphql 点数只记账，信号量按条数卡会把高点数与 REST 等同。

## 2. claim②：自激 + empty 87%

### 2.1 preflight 惰性：成立，但只挡两档

- detectionService.js:264-279 注释“惰性 preflight：仅命中且非 pending 时调”，selection 空/pending 不调。
- 命中直接 return（:145-175），未命中必重跑；preflightScope 只单轮复用（preflightScope.js:17-25 用完即弃、只复用成功、失败不留）。

### 2.2 缓存两级：键与 TTL 已核

- workspaceStore（内存，挡 preflight）：键 handleKey = cwd || refId（workspaceStore.js:16-24，先有者，非拼接；头注释 cwd|refId 易误读）；TTL 30s（:12）；miss 分 empty（:46）/expired（:47，顺手 delete）；写守卫 pending 不入（:54-55），调用方再判 pending/env（detectionService:302-308）。
- choiceStore（H，磁盘，无 TTL，按 rev）：键 sha256 前 24（choiceStore.js:49-55），missing/unreadable 分流（:150-174）。

### 2.3 每次都排一条 gh 的 7 条路：成立，已定位触发源

1. force:true 直通（detectionService:145）：客户端 10+ 处全是 force:true（ChecksTab:91、NoRepoCard:91、bannerChain:165,217、slotRenderer-modal-view:202、slotRenderer-repo-sync:48,61、ChainRenderer:133 等），点一次面板即一次真 gh，缓存形同虚设。
2. env 失败永不缓存（:143,149-150,304-307）：无 gh 机器每次走 resolveGh + gh --version 探测（client:104-112，repoKeys:54-58，后者也报账）。
3. pending 永不缓存（:147/304 + store:54-55）：skills 不可用窗口（SKILL_PENDING_MAX=3）内每次全量。
4. workspace-empty 判 stale（:151-156 + isWorkspaceEmpty:58-97）。
5. rev 对不上判 stale（:162-167）。
6. 链未全绿不写 30s 缓存（detectChain:317-324）+ 退避 8s→30s→2m→5m（:41-43），事件（enter/actionDone/writeDone）判 needed 即整轮重算（含 3 条 gh：登录态、仓库可达、api user）。
7. 跨评估无复用 + 失败不复用 + skills 广播清缓存（skillProbe:31-35 ws.clear + resetChainCache）。

### 2.4 “调大 TTL 无用”：成立方向

- 若 miss 主因是 empty（从未入缓存：force/env/pending/广播清），调大 TTL 只影响 expired，不治本。87% 数字本身待日志包复核，但方向与代码形状一致。

### 2.5 skill.probe 2068/min：不正常，是计数器不是源头

- probe 本身不 spawn gh（skillProbe.js:258-342 只读 registry/fs/直读），每次 fire info 即计数。
- 量级：完整 detect 约 27 技能（shared/matt-skills.js）→ 2068÷27≈76 轮/分钟≈1.3 轮/秒；chain 路径 3 技能 → ≈689 轮/分钟。事件驱动应分钟级 0-2 次，远超正常。
- 结论：优先查触发源（force 重入、invalidate 广播、多组件并发挂载），而非给 preflight 加缓存。

## 3. claim③：终端放大器

### verdict：无法证实（假设）

- 零采集：搜 AV/内存超配/提交内存仅命中无关项；白名单 research/489-appendix 只允许散列/枚举/数字，不收 AV 名、内存数、代理配置。
- research/607 明确进程级内存/CPU 不可归因；research/750 开发机对照（spawn 同步 3-7ms）在途不阻塞，不能外推到 stressed 终端。
- “23 条压垮”与 #923“日常上界 23”数值重合但因果缺一环；单跑 vs 并发只证明拥挤，缺关 AV/换小仓库/bypass 代理对照。

## 4. 宿主 kill 链

### verdict：无法证实

- 本仓是插件仓：RENDERER_SURFACE_PROBE=0，四行宿主日志关键词=0，electron-runtime 仅 WebContentsView 四开关抄录，无 10s/2次/terminate 语义。
- 反向证据：research/607 插件跑在 --type=utility NodeService 独立进程，“宿主卡几毫秒不直接卡浏览器界面”。gh 风暴经 CPU/内存/IPC 让渲染 10s 无响应的链路缺一环。
- 要证实须：宿主安装目录 electron-runtime-*.js 段落原文 + 宿主日志文件原文 + 插件风暴分钟可复核片段。

## 5. 补丁 A-D

- A（并发 4 排队）：方向对（与 #923 落点“满了等”一致），位置错（只改房间漏三出口）、值小（快照 11 条基线，4+4 易队头阻塞）、缺 abort 出队/嵌套占位/fail-open，否则死锁。已有 4 只是改色批内限流。
- B（30s→12s）：单源可改但全局收紧不可；detectChain 15s 谓词 + 30s 兜底、probe-select 30s 死线都假设 30s；无重试，超时即 NETWORK；请回 TLS 慢网 bug；写操作“写上没”无法区分，重试会重复。替代：分档（读 12s/写 30s）+ 先看 P50/P95/P99。
- C（probe 10s）：无 TTL 现状；键须 name|lang|canonicalCwd，只缓存 ok，pending/bad 不缓存；广播同步清；新增缓存补日志点 + 附录表。
- D（采样 0.05）：违反契约（gh.exec/gh.timeout P0 全量 1/1）；红 verify-log-count，逆转 #606 补盲。替代：P0 全量、批量聚合一行 + 成功明细 P1 确定性采样。

## 6. 定位：明显的 bug（等于定位到）

1. 无全局准入（设计缺口，#923 已定版未实现）：同时在飞由调用方并行分组决定，风暴无顶。
2. force:true 风暴（触发源）：客户端 10+ 处 force:true，每次 bypass 缓存产 2-3 gh + 25 probes；pending/env/广播清叠加，高频重入。
3. 30s 持有槽位：超时进程 graceMs 2000 内仍占位，新 force 继续堆，旧的不放、新的堆，即自激。

终端环境只调阈值，不改回路；kill 链待宿主证据。

## 7. 还缺的证据

- 插件日志包风暴分钟 + host 日志原文 + 宿主看门狗源码段。
- gh.exec latencyMs 与同时在飞分布（P50/P95/P99）+ force 来源 + chain.preflight.reuse 对齐。
- 关 AV / 换小仓库（<100 issue）/ bypass 代理三对照。

## 8. 后续（不实施，只指路）

- 先测再定值，按 #923 落点在传输层做准入（含 gh/git/glab），信号量只包 spawn 段 + abort 出队 + fail-open。
- B/C/D 按第 5 节替代重做，拆票；落地前跑 tests/verify-log-* 并同步附录。

## 补记（迟到两路深查增量，2026-10-09）

### claim①增量（fae3da16）
- runJson 不存在：仅 client.js:141/218 注释提及，无定义无导出；旧调用方用 run。
- spawn 字面全仓 6 处：repoKeys:55（--version）/76（runGh）/142（execProc）、platformChannel:212（detectionExec）、versionControl:72（runGit）、platform/index:138（打开文件，not-github）。GitHub 出站相关 4 处 + git 只读仍报闸。
- gate.send 调用者仅 detectChain:37、wiring:109/375/404、writeEvents:266、shell:196/228/296；github 房内零调用。
- deferred 是推迟槽（同 key 只留最后一次，5 分钟过期丢），不是队列；唯一 4 路是 label-colors-ops:155-181 房内自限。
- #923/64：该 subagent 本地 grep 零引用 + gh 未登录取不到票面，故标“本地无对应物”。注：本票此前已用 deck 工具读回 #923 票面（closed，定版 64、日常 23、59<64<297、落点传输层满了等），故 64 口径以票面为准，不以本地 grep 缺席为否证。

### claim③增量（2f697b7e）
- 同步段仅组装 + 调 spawn（微秒~毫秒），5-7s/30s 皆异步等待；插件与渲染隔离，kill 中间链缺一环。
- 看门狗错位：gh 三路全无 stallWatch（仅 git runGit 可选 stallWatch，默认不开）；“看门狗开火”只能指桌面宿主渲染看门狗，仓内零证据。
- 白名单字段已核（gh.exec/exec.run/gh.timeout），收 AV/内存/代理须新增事件 + 附录 + 门禁。
- 单跑 vs 并发缺 10 组对照：同命令/同仓/三代理×两档/AV 逐一/内存压力/顺序批量/DSH 内外/去噪（force/命中/rev/skip）/服务端限流/宿主取证。缺任一组不定量放大器。

## 补记三（claim②深查增量 d11c5947，2026-10-09）

- 自激机制修正：不是“占名额不放”（闸本无槽），是“慢调用重叠 + 缓存全被绕过/清空，越慢越问”。
- 2068/min ≈ 76.6 轮/min（27 技能/轮，0.78s/轮），相对最快节拍 5s/8s 高出约 6-10 倍，只能是自激；skill.probe 自带×27 放大，行数≠轮数。
- empty 830 vs expired 126（87%）说明调大 TTL 只收 126，830 救不回；hit 按 1/100 采样、miss 全记，empty 显多但结构性结论不变。
- 三条独立重入路：A 链未全绿永不写链缓存（detectChain:317-324，未全绿即每次真算）；B rev 抖动直接作废（多壳 baseRev 旧 + bind 推高）；C 技能广播全清（ws.clear + chainByKey.clear）。force:true 16 处（探测 9 处）绕过一切，且 force 自带 resetGhCache 清缓存，下轮必 miss。
- 治本顺序：先收 force 入口与广播粒度，再谈 TTL；preflightScope 用完即弃、寿命归 backoff，不另起缓存。

## 补记四（看门狗深查增量 69904884，2026-10-09）

- verdict 不变：宿主 10s×2 杀渲染本仓无法证实（PROBE=0、四行日志=0、electron-runtime 仅 2 处转述无阈值语义）。
- 进程隔离：插件在独立 utility NodeService（607:330），非渲染进程；起进程异步、同步段 3-7ms、在途不抖（607:287-330），直接卡渲染结构上不成立。
- 扇出是次数×串行非一次卡 10s：重建约 11 条串行、issueList 降级串行、命名守护全量 vs 增量 2.84 倍、三扫描器最大 7 并发、wf.refresh 中位 15.2s（0 条 gh 仍 12-14s）。
- CPU/内存/IPC/事件循环无直证；749/755/757 的互堵指面板自身主线程，非壳看门狗。
- 要证实缺 6 样：宿主源码段 + 宿主日志原文 + 时间对齐（风暴分钟 vs 开火±秒）+ 渲染 longtask 证明 + 资源 10 组对照 + 上限拍板。行号速查见 subagent 正文。

## 补记五（补丁深查增量 cbb5c663，2026-10-09）

- 超时单源修正：房内单源成立（client:41），宿主级非单源（index:33 另有，注入 repoKeys/platformChannel；call-scope:20 另有）。只改房内不收全局。
- execGh 三失败路已核（resolve/无exec/非零/抛错），调用方假设 error恒{kind,message,code}、code4认 auth、无重试、只记账。A/B 动 emit 或账即红门禁。
- detectChain 15s 谓词故意小于 30s 兜底；B 改 12s 反转语义，请回 TLS 慢网；写超时不可区分，重试会重复。
- skillProbe pending(3次)/广播清已核；C 须 canonical 键、只存 ok、同步清、防 stampede、补日志点。
- log 契约 P0 全量 1/1，D 改 0.05 必红 count/fields/guards/flush/coverage；替代为 P0 全量 + P1 聚合。
- label 4 路只是批内限流；全局 4 与批内 4 嵌套 + 快照串行叠加即队头阻塞。快照已非 11 并行（9 次 + aliases 1 次），真扇出在调用方分组。
- 四项分结论见 subagent 第 7 节；横切：拆四票，落地前跑 verify-log-* 并同步附录。

## 2026-10-21 复核（单票核实员 recheck-960，基线 dd827466）

本节是 2026-10-21 的复核增量，前面的历史内容不动。今天工作区分支 HEAD 是 dd827466；工作树里另有别的会话留下的改动（docs/star-history-*.svg、scripts/generate-star-history-svg.mts、tests/verify-star-history.ts、research/998-recheck-gate-defer.md），本次一点都没有碰。全阶段只读：没有改 src/、tests/、scripts/、package/，没有提交、没有关票、没有发评论，唯一写入就是本节。

### 一、票面症状摘要

票面（#960，2026-10-09，v1.7.51 实测）说的是：桌面版用着用着界面消失、随后又自己重开（「闪退又重进」）；归因是 GitHub 出站调用没有并发准入，一波并发把机器拖慢，宿主每 10 秒一次的看门狗连判两次「无响应」就杀掉渲染进程再重载。票面同时给了四项补丁：A 给房间客户端的 execGh 加信号量（最多 4 个在飞，满了排队）、B 把读超时从 30 秒改 12 秒、C 给技能探测加 10 秒缓存、D 把日志采样从 1 降到 0.05。票面写的复现判据是：插件日志里 latencyMs 贴近 30000、exitCode 为 -1、且 via 为 detect-preflight 的行密集出现。

票面里的行号是 v1.7.51 的，今天已经漂移；下文一律按今天的源码实际行号写。

### 二、今天的实现锚点（HEAD dd827466）

准入本体在 src/host/outbound/admission.ts（原 src/shared/tracker/outbound-admission.js 归位而来）：第 28、29 行是读桶 64、写桶 16 的缺省值；第 82 行 createGhAdmission；第 100～117 行 pump（有空名额就放行队首，已中止的只记取消不占名额）；第 120 行 acquire（有空位直接给，没空位进队列等，排队期间 signal 中止按取消返回）；第 130 行排队计数；第 166 行 releaseOf 幂等释放；第 178 行 snapshot 把在飞数、排队数、峰值、等待次数、取消数都算出来了；第 197 行 getGhLane 是进程级单例。第 12～22 行的头注释写明：64 是保险丝不是油门（2026-10-10 实测在飞峰值 12），真正让名额不被长期占住的是房内那只表（读 12 秒、写 30 秒、探活 15 秒，含排队段）。

参数真源两处：src/shared/refresh/src/tuning.ts 第 43、44 行（readBucketMax 64、writeBucketMax 16）；config/timeouts.yaml 第 26、27 行（outboundReadMs 12000、outboundWriteMs 30000）。

三条 gh 出站路径都接在同一道闸上，这是本票要核的重点：

1. 宿主取数层 src/host/git-process.ts（旧 repoKeys.js）：runGh 在第 203 行拿名额、各失败路分别在第 205、219、232、250、269 行释放；execProc 在第 290 行拿名额、在第 306、319、325 行释放。文件第 12 行只 import 了 getGhLane，全文再没有第二个起 gh 进程的地方——不存在绕过名额的 spawn。
2. 探测通道 src/host/platformChannel.ts 的 detectionExec：第 342 行拿名额（排队被取消时第 343 行起按取消返回 code -1）、第 365 行 spawn、第 372 行与第 400 行释放，超时按档在第 376 行。
3. GitHub 房客户端 src/tracker/rooms/github/client.ts：第 287 行按命令分读/写桶，第 289 行按档取超时，第 290～312 行起步表（计时从拿名额之前开始，所以排队时间算在里面），第 342 行拿名额与房内截止时间赛跑，第 346 行算 slotWaitedMs，第 347～352 行排队取消按取消返回，第 371 行拿到名额之后才报出站账，第 432～437 行 finally 释放。第 282～285 行是关键的一道保险：取不到出站控制面时直接返回 ENV 错误「出站控制面没有接上……这一笔不发出去」，也就是关不上闸就不发（fail-closed），不是静默放行。

另外两处相关接线：src/host/platform/outbound-control.ts 第 31～43 行把同一道闸转给房间用（acquire 直接转 getGhLane().acquire）；src/host/versionControl.ts 第 44 行 import withGhLane、第 107 行用它包住 git 出站。全仓起 gh 进程的位置只找到 git-process.ts 第 179、211、297 行、versionControl.ts 第 111 行、platformChannel.ts 第 365 行、platform/index.ts 第 232 行（这一处不是 GitHub 出站）；前五处都在名额之内，第 179 行的 gh --version 也在 resolveGh 内部、调用方已经持有名额。

git 证据：初版准入是 ebac4124（2026-10-09，#965，读 8 写 2）；2e5f5fba（2026-10-10「修复出站 gh 调用排队段没有上限的问题：房内自己掐表，并放宽读写并发名额」）；42f324a8（2026-10-15 调参表改成 64/16）；67bec02c（2026-10-17 #1160 探活提到 15 秒）。git merge-base --is-ancestor 2e5f5fba HEAD 的退出码是 0，即修复提交已经在今天的 HEAD 里。

运行中的构建（用户最担心的「HEAD 有、真机没有」）：package 是指到 profile 的 node_modules 的 Junction，版本 dsh-mattpocock-skills-deck 1.9.0-beta.7，构建时间 2026-10-21 13:24:25。package/lib/outbound/admission.js 里有 64/16 与 createGhAdmission；package/tracker/rooms/github/client.js 里有 waitedMs、取不到控制面时的 fail-closed、以及 acquire 调用；package/lib/git-process.js 第 3 行与 platformChannel.js 第 3 行都引用 admission。结论：今天日志反映的这份构建已经含着全部修复。

### 三、修复与门禁实跑

只跑了本票专属的一扇门，没有跑全链、没有构建：

命令：node --import ./scripts/ts-hook.mts tests/verify-965-admission.ts

结果：退出码 0，13 项断言全 PASS。覆盖到的行为包括：缺省读 64 写 16；16 路并发读的峰值不超过 4（这是用自造的小上限验证计数没有漏）；名额满了排队等待而不是直接失败；等待计数 12 次；读写两只桶互不抢名额；排队期间取消返回 admission-cancelled 且真从队列里出去了；上限可以按需配成 3 与 5；默认单例是同一个对象。

### 四、真机日志证据

查的目录：C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\，每天一个 YYYY-MM-DD.log，本次查了 2026-10-15 到 2026-10-21 共七天。文件大小：10-15 6.6MB、10-16 24.2MB、10-17 66.8MB、10-18 56.8MB、10-19 55.5MB、10-20 134.4MB、10-21 27MB（到 13:37）。做法一律是 PowerShell 单遍流式扫描（Select-String 按行读），没有整文件读入、没有 ConvertFrom-Json 全量解析。

按天统计（gh.exec 行数 / 其中 waitedMs 大于 0 的行数 / 最大等待毫秒 / 成功 / 网络失败 / 取消 / 缺环境 / gh.timeout 行数 / detect-preflight 的 exec.run 行数 / 技能探测行数 / 「出站控制面没有接上」行数）：

| 日期 | gh.exec | 有等待 | 最大等待 | ok | network | cancelled | env | gh.timeout | 其中 detect-preflight | skill.probe | 控制面未接 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10-21（到 13:37） | 18574 | 4608 | 15040ms | 15630 | 2780 | 0 | 11 | 2971 | 6903 | 90 | 0 |
| 10-20 | 97168 | 21546 | 16279ms | 70258 | 16981 | 9 | 124 | 20816 | 28749 | 2319 | 0 |
| 10-19 | 38705 | 2130 | 12011ms | 36955 | 1203 | 1 | 25 | 1142 | 26930 | 21021 | 0 |
| 10-18 | 40283 | 2361 | — | — | 802 | — | — | 753 | 28686 | 18759 | 0 |
| 10-17 | 46201 | 2108 | — | — | 774 | — | — | 703 | 34016 | 22998 | 0 |
| 10-16 | 17404 | 559 | — | — | 663 | — | — | 652 | 11207 | 13182 | 0 |
| 10-15 | 5323 | 0 | — | — | 406 | — | — | 709 | 84 | 13656 | 0 |

等待时长直方图（0、1～5 毫秒、6～50 毫秒、51～200 毫秒、201 毫秒～1 秒、1～5 秒、5～10 秒、10 秒以上）：

- 10-21（18574 行）：13963 / 477 / 293 / 268 / 937 / 1399 / 161 / 1076
- 10-20（97168 行）：75622 / 2057 / 1622 / 686 / 3757 / 3879 / 731 / 8814
- 10-19（38705 行）：36575 / 1478 / 255 / 54 / 255 / 39 / 3 / 46

超时按档：10-21 是 12 秒档 808 行、15 秒探活档 2165 行、30 秒档 0 行；10-20 是 12 秒档 3556 行、15 秒档 17260 行、30 秒档 0 行；10-19 是 12 秒档 856 行、15 秒档 276 行、30 秒档 10 行。detect-preflight 这一族里 exitCode 为 -1 的行：10-21 有 293 行（总 6903 行）、10-20 有 1653 行（总 28749 行）、10-19 有 47 行（总 26930 行）；latencyMs 大于等于 29 秒的 detect-preflight 行，三天都是 0 行。

结论分四点：

1. 闸确实在真机上跑着。waitedMs 非零的行每天都有（10-21 4608 行、10-20 21546 行、10-19 2130 行），最大等待 15.0、16.3、12.0 秒；七天日志里「出站控制面没有接上」一次都没有出现，说明三条出口都接到了同一道闸上，没有漏出去的。
2. 票面写的那个判据今天已经不存在。detect-preflight 的 exec.run 里没有一行延迟到 29 秒以上，gh.timeout 也没有 30 秒档（10-21、10-20 都是 0）；今天剩下的超时是 12 秒读档与 15 秒探活档。所以票面说的「latencyMs 贴 30000、via detect-preflight 密集」这种形态，今天看不到了。
3. 但闸不是「永不介入」。10-20 有 8814 行等待超过 10 秒（占那天 gh.exec 的 9%），今天到 13:37 已经有 1076 行；10-20 等待超过 200 毫秒的合计 17066 行。也就是说，在飞数经常顶到 64 这个上限。超时量也大：10-20 有 20816 行 gh.timeout（其中 17260 行是 15 秒探活档）、16981 行 network 失败；今天到 13:37 分别是 2971 行与 2780 行。作为对照，10-15 一整天只有 5323 行 gh.exec、0 行等待，10-16 起涨到 1.7 万行，10-19、10-20 是 3.9 万与 9.7 万行——这一周机器上的活动量本身变了很多，绝对值只能同一天内比，不能拿 10-15 的安静日子当常态。
4. 闪退这一侧，今天有一份可疑实例，但归因证据不在本机可读的地方。宿主崩溃转储目录 C:\Users\辰辰洋洋\AppData\Roaming\@deepseek-ai\dsh-desktop\logs 里一共 10 份文件，今天只有一份 crash-2026-10-21T03-26-00-909Z-renderer.log（494 字节，本地时间 11:26:00）：source=renderer、phase=running、Error 一行写的是「Desktop renderer exited: killed」，栈落在 main.js:12933，并且注明没有抓到 error 级的渲染控制台输出。这个形态与「渲染进程被外部杀掉」一致，但只看这一行分不清是看门狗、手动关窗还是别的退出路径。进程列表显示 11:26 之后确实又起了渲染进程（pid 13856 起于 11:41:53；pid 30980 起于 12:46:37，它下面 12:46:38 又起了四个子进程），说明今天至少重开过一次；但宿主的 10 份崩溃日志里搜 watchdog、did not respond、unresponsive、renderer recovery 这些词全部零命中，C:\Users\辰辰洋洋\.dsh\logs 下只有各插件子目录，%APPDATA%\DSH Desktop\logs 不存在，D:\DeepseekHarness\debug.log 只有 714 字节的 crashpad 行。所以：今天确有一次渲染进程被杀记录，但「看门狗开的火」这一句在本机没有日志落点。

另外一个诚实说明：日志里 log.rotate.degraded 行很多（10-20 有 30954 行、10-19 有 37872 行、今天到 13:37 有 9768 行），说明日志轮转本身在丢片，上面的统计是「留下的这部分日志」的统计，可能比实际少；但 waiting 与 timeout 的数在三天里相互一致，方向性结论不受影响。

### 五、判定

判「不确定」，拆成两句话：

- 票面点名的那个机制——「gh 出站缺并发准入」——在今天的树与今天的运行构建里已经不存在了：三条出口都接同一道闸（文件与行号见第二节）、本票单扇门禁 13 条亲手跑过全 PASS、运行构建里也带着这份实现、七天真机日志里 waitedMs 非零且「控制面没有接上」零命中。这一半可以判「已修复并守住」。
- 但票面末端的现象——界面消失又自己重开——今天仍有一起可疑实例（11:26 渲染进程被杀），而「系统被大批 gh 拖慢 → 宿主 10 秒看门狗连判两次 → 杀渲染进程」这条链在本机没有可读日志；同时今天日志显示 64/16 这个上限经常被顶满（10-20 有 8814 行等待超过 10 秒），所以「并发已经足够低、机器不会再被拖慢」这句话也没有证据支撑。

缺的两块证据是：一是宿主那侧看门狗有没有真的开火、开火那一刻渲染进程在等什么（本机没有宿主运行日志，只有崩溃转储）；二是闸内部各桶的队列深度、峰值、排队取消数与等待分布——现在这些数只在 snapshot() 里算了，没有任何一行日志把它们写出去，所以光靠 gh.exec 的 waitedMs 分不清是读桶满了还是写桶满了、队排了多深。

### 六、埋点方案（本阶段只写方案，不改代码）

目标：回答「闸有没有顶满、顶满时是哪只桶、排了多深、谁等了多久、有多少被取消」，并把它和渲染进程被杀的时间点对上。事件名按仓里现行风格（族.动作，小写点号，例如 gh.exec、write.event、edge.write），建议新增两条：

1. 常驻一条 `gh.lane.saturated`（告警级）：某只桶的排队数第一次达到阈值（读桶取 max(4, 上限/8) 即 8，写桶取 4）时落一行，之后同一只桶每 30 秒最多再落一行，正常日子 0 行，10-20 那样的一天最多几百行。字段五个，全是短枚举与数字：bucket（read 或 write）、inflight（这一刻该桶在飞数）、max（该桶上限）、queued（这一刻排队数）、peak（该桶历史峰值）。
2. 按需一条 `gh.lane.poll`（调试级，先用 logCtx.isEnabled('debug') 判断，形状照 src/host/refresh/writeEvents.ts 第 267 行那种写法）：调试开关打开时每 10 秒每只桶最多一行，字段七个：bucket、inflight、queued、max、peak、waited（累计等待次数）、cancelled（累计取消数）。排查「服务变卡」时用它看趋势，平时一条都不落。

落点与接线：

- src/host/outbound/admission.ts 第 82 行起给 createGhAdmission 的选项加一个可选的 onEvent 回调（形状 GhAdmissionOpts 在第 42～45 行）；在 acquire 进队列那一段（第 130 行前后）判断是否首次越过阈值并节流后发出 gh.lane.saturated；在 pump 与 acquire 的取消分支（第 106～110 行、第 124 行）累计 cancelled；在 releaseOf（第 166 行）只做计数、不落行。
- 因为闸是模块级单例（第 194、197 行懒创建），接线不要靠「创建时传一次」，改成 adadmission.ts 再导出一个 setGhLaneReporter(fn)，把回调存在模块级变量里，每次 emit 现取。宿主在 src/host/index.ts 第 72 行建好 logCtx 之后调用一次 setGhLaneReporter，回调用 logCtx.fire('warn', 'gh.lane.saturated', ...) 与 logCtx.isEnabled('debug') 判断后的 gh.lane.poll。这样不新增单例、不改 outbound-control.ts 的第 31～43 行。
- 顺带补一格现有事件：src/host/git-process.ts 第 197、218、231、248、266 行这几处宿主 gh.exec 行没有 waitedMs（只在房间客户端的第 259 行有），所以从日志上看不出宿主取数这一路排队排了多久。建议在这几处补 waitedMs（拿到名额后记 Date.now() 减拿名额前那一刻），字段白名单本来就允许 waitedMs，不新增事件、不动条数。门禁 tests/verify-github-gh-via.ts 第 302 行只对房间 execGh 那八格做断言，宿主这一路补一格不会被它判红，但落地时要顺手跑一遍。
- 白名单与附录同步：tests/verify-log-fields.ts 里的 ALLOWED 表要加 `gh.lane.saturated`（bucket、inflight、max、queued、peak）与 `gh.lane.poll`（bucket、inflight、queued、max、peak、waited、cancelled）两行，注意这份文件里常驻与按需各有自己的一段（第 35 行与第 390 行附近都能看到 gh.exec 那一行，说明两段都要改）；tests/verify-log-count.ts 要改三处——文件头断言文字（第 3 行）的条数从「常驻 53、按需 56、自监控 5、总数 114」改成「常驻 54、按需 57、自监控 5、总数 116」，第 149 行的总数断言，以及第 78～86 行那种「附录字面必须有这一句」的检查要再加一条「常驻 54 条、按需 57 条、自监控 5 条、总数 116 条」；research/489-appendix.md 第 1 章常驻表加 gh.lane.saturated、按需表加 gh.lane.poll，并在 1.4 节落点说明里写清落点是 src/host/outbound/admission.ts 的 createGhAdmission、经 src/host/index.ts 的 logCtx 注入，不在房内。事件编号接在当天最大号后面（今天最大是常驻「locale.registration.fail」与按需「ui.action」，落地时以附录为准，建议暂写常驻第 120 号、按需第 121 号，编号与条数以改完附录后的字面为准）。
- 落地前的门禁：node --import ./scripts/ts-hook.mts tests/verify-log-fields.ts、node --import ./scripts/ts-hook.mts tests/verify-log-count.ts、node --import ./scripts/ts-hook.mts tests/verify-log-switch-526.ts 与 tests/verify-log-switch-597.ts（这两扇管调试开关档位与事件名登记，新增按需事件要看它们认不认）；改完再跑一遍 node --import ./scripts/ts-hook.mts tests/verify-965-admission.ts，确认那 13 条不回归。凭证纪律照旧：只记计数与桶名，命令原文、路径、令牌一个字都不记。

落盘之后怎么判：

- 如果 gh.lane.saturated 一天只有零星几行、queued 基本是 0 或在个位数：说明闸平时不介入，票面那个机制确已不在，可以按「已修复」关票。
- 如果同一分钟里反复出现、queued 一直大于 0、inflight 贴着 max：说明闸仍然长期饱和，剩下的风险是「上限偏高、慢调用占槽」，该另开票按真机测量把 64/16 往下压，而不是把这票当成已解决关掉。
- 如果渲染进程再次被杀的时间点前后，gh.lane.poll 显示 inflight 贴着 max、queued 很大：就把「gh 出站爆炸」和「宿主看门狗开火」在时间上对上了，可以作为重新开案或转给宿主侧的直接证据；反过来，如果那段时间两份日志都很平静，就该转向查宿主，不要再改插件。

### 七、未决问题

1. 宿主看门狗在本机没有日志落点。崩溃转储里搜不到 watchdog、did not respond、unresponsive 这类字样，也没有可疑的宿主运行日志文件；今天 11:26 的渲染进程被杀只能确认「发生了」，不能确认「是谁杀的」。要补这一块，需要 dsh-desktop 那侧把「渲染进程无响应判定」与「开火」写成日志，或者让插件侧的 gh.lane 日志能和宿主日志按时间对齐——这超出本插件仓库范围，建议另立票给宿主。
2. 64/16 这两个上限还没有「是否足够低」的本机证据。今天日志里 10-20 有 8814 行等待超过 10 秒、17260 行探活超时，说明慢调用长期占槽的老问题还在（这正是 2026-10-10 加房内截止时间时想兜的同一件事）；是否要按真机测量调低上限、或把探活超时再压，需要看 gh.lane 落地后的队列数据再决定。
3. 票面 B、C、D 三项今天的落地情况没有逐项复核：12 秒读超时已经落在 config/timeouts.yaml 第 26 行；技能探测缓存与日志采样率这两项，本票没有回头核对它们是被后续票吸收还是已经改变，若这张票要关，建议先确认这三项的去向，避免把还没落地的补丁一起关掉。
4. 今天日志里的高值（10-20 9.7 万行 gh.exec、1.7 万行 15 秒探活超时）可能有一部分是本次 13 人并行核实会话自己造成的，不能直接当常态；但 10-19、10-20 的高值出现在本次并行核实之前，那两天的量也明显高于 10-15，值得单独看一眼是哪个功能在放大 gh 调用，另立票更稳。

