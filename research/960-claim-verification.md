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
