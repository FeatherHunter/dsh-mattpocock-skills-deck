# #891 复核笔记：初始化完成后黄条仍提示未初始化（2026-10-21）

- 复核日期：2026-10-21（Asia/Shanghai）。
- 复核开始前的工作区基线：`dd827466`（`git rev-parse --short HEAD`）。
- 运行中的插件构建：`package/`，版本 1.9.0-beta.7，`package/lib/client.js` 最后修改时间 2026-10-21 13:24:20；桌面 profile 的 `node_modules/dsh-mattpocock-skills-deck` 是指向该 `package/` 的 Junction。
- 证据等级：今天的源码与构建产物逐行核对、本票专属单扇门禁实跑、真机诊断日志逐日统计。
- 阶段纪律：本次完全只读，没有修改 `src/`、`tests/`、`scripts/`、`package/` 的任何文件，没有提交、没有关票、没有发评论；本笔记是唯一新增文件。

## 一、票面症状摘要

票 #891 的标题是「初始化完成后黄条仍提示未初始化，疑似刷新机制不再定期刷新」。票面状态 open，标签为 bug、ready-for-agent、wayfinder:task，指派给 FeatherHunter，父票是地图 #1010，承接票是 #1220（只读参考）。票面描述的现象是：在全新工作区里走完初始化 setup（注入 setupRun 提示词、AI 回报完成）之后，顶部黄条仍然提示这个工作区尚未初始化——上面是细黄条「该工作区尚未初始化」，下面跟着警告卡「工作区未初始化／docs/agents/issue-tracker.md 不存在／prompt:setupRun」。

票面记录的实施提交是 c16f139c（2026-10-07，「修复初始化后黄条常驻：活跃探测时顺带重算检查链（#891）」）。当时的方案是：复用「正在查看才跑」的活跃探测节拍，仅在链快照里 tracker:initialized 这一步不是 done 时顺带调用 chainEventRefresh(st, 'setup-pending')；不新开定时器，不新增日志事件。票面带出的门禁是 `tests/verify-891-setup-refresh.js`，当时 18 项全绿。2026-10-08 的评论说 c16f139c 已经在主干 v1.7.46、18 项全绿、`package/lib/client.js` 含 setup-pending 钩子，「只差真机确认」。

已有的两份调查结论：`research/1010-ticket-scope-4.md` 第 17-23 行把本票判成「不归我们」，认为属于客户端链加宿主检查链；`research/1077-closeout-table.md` 第 28 行写的是「#891 黄条待真机（开）｜绿（18 项，票面）｜只差真机确认｜转 #1220」。

本次复核要回答的是三件事：修复提交到底在不在今天的 HEAD 与运行构建里；门禁今天还能不能过；真机日志能不能证明修复真的在运行。

## 二、今天的实现锚点（行号按 HEAD dd827466 复核）

### 2.1 黄条是怎么判出来的

- `src/shared/tracker/guide-steps.ts:76-139` 是引导清单 GUIDE_STEPS。第 4 步 id 是 `gh:remote`，带 blocksSetup:true；第 5 步 id 是 `tracker:initialized`，checks 是 `['tracker:initialized']`，横幅文案是 BANNER.setup，missing 是 MISSING.setupRun，blocksSetup:false——票面那条「该工作区尚未初始化」黄条就是这一步。第 6 步是 `skill:wayfinder`。同文件 `:164-178` 的 guideStepDone 要求这一步的全部 checks 都是 done 才算过。
- `src/client/statusbar/bannerChain.ts:94-114` 的 guideBannerStep 决定「这一屏出哪条横幅」：按清单顺序走，遇到 blocksSetup 且这一行还不在链快照里就返回 null（:106，避免黄条提前出现）；没有 banner 的步跳过；ready==='gate' 的步读界面门控；步不在链快照里 continue；guideStepDone 为假就返回这一步。也就是说，**黄条的显隐直接读链快照，不读本地文件现状**——链快照旧了，黄条就会按旧快照常驻。
- `src/client/statusbar/StatusBar.ts:269` 是 `const bannerStep = guideBannerStep(s, _gateActive || _backendUndecided)`；:376 是无横幅分支（只画胶囊与收起按钮）；:386 画黄条（div.dsws-banner.warn）；:398 画蓝条那一档；:408 画黄条正文并绑 runGuideMissing。横幅上那颗按钮点下去走 `bannerChain.ts:236-283` 的 runGuideMissing，:291-293 落常驻 info 日志 `guide.inject` {step, outcome}——这是横幅按钮被点击的唯一日志落点，只记枚举、不记文案。

### 2.2 初始化注入这条路

- 黄条那颗「初始化」按钮在 `src/client/statusbar/StatusBackend.ts:204-207` 的 onStatusSetupInit，它调 injectSetupDecision(s, id, {allowCard:true, askLayout:true})，也就是每次都先弹布局卡。
- `src/client/kernel/prompts-setup.ts:35-76` 的 injectSetupDecision：:48 先判 `!guideBlocked && opts.allowCard && layoutCardShouldOpen`，成立就开卡、:58 落 debug 日志 `inject.decision` {prompt:'setupRun', kind:'askLayout', layout:'unset'} 并返回 'askLayout'；否则走 :63 之后的 fallback，:72 打一条 console（setup-inject applied kind=…），:73 落 debug `inject.decision`，:74 调 inject(st, dec.text) 把 setupRun 提示词写进会话。之后 AI 执行初始化，写文件发生在链外——这就是票面说的「链的四种事件里没有这一路」。
- 切换后端那条路在 `src/client/kernel/store-switch.ts:265-281` 用同一份决策函数并带 source:'switch'、askLayout:true，随后 `store-switch.ts:307` 自己会调一次 chainEventRefresh(st, 'action-done')。

### 2.3 #891 的自动重算原本挂在哪

- `src/client/kernel/probe-chain.ts:85-91` 定义 CHAIN_EVENT_REASONS，含 setupPending:'setup-pending'；:96-107 的 setupPendingOf(st) 在链快照里有 id==='tracker:initialized' 这一行时返回 status!=='done'，无快照、无该行、null 都返回 false；:121-127 的 chainEventRefresh 先落 debug 日志 `chain.event` {reason}（:124），再调 loadChain；:128-210 的 loadChain 里 :158 把 trigger 一起传给宿主，:164-165 调 host.call('wf.chain', args) 成功时落 info `host.call` {method:'wf.chain', latencyMs, ok, kind:'chain'}，:179-194 应用快照并 emit(st)。注释 `:72-90` 说明 #709 已经退役了 8 秒自轮询：链只由四路事件触发——切进工作区（enter-workspace）／人点重新检查（user-recheck）／动作完成（action-done）／宿主侧写入成功（write-done）。
- 钩子本体在 `src/client/kernel/probe-auto.ts:241-271` 的活跃探测 step 里：:243 要 attentionVisible()，:244 要 standing==='active'，:247 要有 cwd，:249-250 有节流；:253 在 setup 判断之前无条件落 debug `input.observe` {kind:'probe-tick', count:1, latencyMs, keyHash}；:254 probeNow(false)；:255-263 才轮到 #891 的钩子——若 setupPendingOf(st) 为真，就 chainEventRefresh(st, 'setup-pending')，兜底 loadChain(st,false,'setup-pending')。step 定义完之后，:266-270 是排节拍的地方。

### 2.4 视野节拍与 timer 的真实来源（本次复核的关键发现）

- 节拍排程在 `src/client/kernel/probe-auto.ts:266-271`：`if (timer === undefined || typeof timer.interval !== 'function') return;`（:266-269），否则 `shared._activeTimer = timer.interval(step, _attentionPlan.intervalMs)`（:270）。心跳那条同理，`src/client/kernel/attention-heartbeat.ts:186-197` 的 startAttentionHeartbeat 在 :193 有同一个守卫，:194 才调 timer.interval。
- 这个代码里的 `timer` 是构建拼进 `src/client/index.ts` 闭包的自由变量：`src/client/index.ts:75` 的 `// ==== leaf:hostShim (spliced by build) ====` 把 `src/client/hostShim.ts` 拼在 apply 闭包最前面，之后所有叶子共用它。`src/client/hostShim.ts:23-48` 的实现是：`const _timerRaw = ctx.get('timer')`，然后 `export const timer = { timeout, setTimeout, clearTimeout }`——**只有三个方法，没有 interval**。注释 :18-22 讲的是宿主 timer 服务可能缺失、可能只有 setTimeout，所以恒给一个非空包装对象兜底；没有任何地方说 interval 该不该转发。
- 运行构建 `package/lib/client.js` 与源码同形：:128 `const _timerRaw = ctx.get("timer")`、:129-166 `const timer = { timeout, setTimeout, clearTimeout }`（包装对象同样没有 interval）。全文件只有两处 timer.interval：:12149 的同一个守卫（后跟 :12152 `shared._activeTimer = timer.interval(...)`）和 :12515 的心跳守卫（:12516）。全文件也搜不到给 timer.interval 赋值或补丁的语句。
- 因此：`typeof timer.interval !== 'function'` 在真机上恒为真，两处都在排节拍之前 return。**活跃探测 step 与心跳从未排上过，probe-tick 那行日志永远不可能出现，#891 的 setup-pending 钩子也就永远不会被执行。**
- 时间线：带守卫的视野模型提交 8b6ab95c 是 2026-09-23；#891 的修复 c16f139c 是 2026-10-07，直接加在这套已经排不上节拍的 step 里。换句话说，这个修复从落地那天起就是不可达代码。

### 2.5 除死路之外，还有哪些事件会让链刷新

今天 chainEventRefresh 的调用点只有这几处：

- `src/client/views/ChecksTab.ts:47`（打开检查页挂载，enter-workspace）；
- `src/client/views/ChecksTab.ts:123`（人点「重新检查」，user-recheck）；
- `src/client/statusbar/bannerChain.ts:257`（横幅提示重查，user-recheck）；
- `src/client/kernel/slotRenderer-repo-sync.ts:73`（重查仓库路，user-recheck）、`:85`（同一路收尾，action-done）；
- `src/client/kernel/store-switch.ts:307`（切换后端成功后，action-done）；
- `src/client/kernel/probe-auto.ts:309`（refreshAll，即人点「更新／刷新／重新检查」那颗按钮，user-recheck）；
- `src/client/kernel/probe-auto.ts:260`（setup-pending，就是上面判定排不上的死路）。

写入侧只有 `src/host/git-process.ts:263`：写成功后调 `getChainBackoff().noteWriteActivity()`，而 `src/host/refresh/chainBackoff.ts:172-175` 的 noteWriteActivity 只让退避回第一档并落一条 debug `chain.backoff` {decision:'write-reset', reason:'write-done', trigger:'write-done'}，**不会触发一次链重算**。

结论：初始化注入完成之后，如果用户不点刷新、不打开检查页、不做切换后端这类动作，就没有任何路径会自动重算链；黄条会一直按旧快照显示。票面要修的正是「初始化完成后自动重算」这一条，而它唯一的自动通路已经死了。

## 三、修复与门禁实跑结果

### 3.1 修复提交在不在

- `git cat-file -t c16f139c` → commit。
- `git merge-base --is-ancestor c16f139c HEAD` → 退出码 0，说明它在今天 HEAD 的祖先链上。
- HEAD 源码含钩子：`probe-chain.ts:85-91` 有 setupPending:'setup-pending'，`probe-auto.ts:255-263` 有 setupPendingOf → chainEventRefresh(st,'setup-pending') 分支。
- 运行构建也含钩子：`package/lib/client.js:11001` 有 setupPending:'setup-pending'，:11003 有 setupPendingOf，:11025 有 debug chain.event 行，:12112-12155 是 startActiveProbeLoop，:12132-12134 是 probe-tick 日志，:12138-12143 是 setupPendingOf → chainEventRefresh(st,"setup-pending") 分支。
- 结论：**修复文本确实在 HEAD，也在运行中的构建里**。但这只证明「写着」，不证明「跑着」（见 3.3 与第四节）。

### 3.2 门禁实跑

命令：`node --import ./scripts/ts-hook.mts tests/verify-891-setup-refresh.ts`。

结果：退出码 0，输出 9 项断言全部 PASS（末行「全部通过 — 9 项断言」），stderr 只有一条 MODULE_TYPELESS_PACKAGE_JSON 警告（这是挂 ts-hook 时的已知噪音，不算故障）。

票面写的是 18 项，今天为什么是 9 项：`git log` 显示 0f1f576b（2026-10-12「删掉「读源码文本钉形状」这一类门禁：整份删 27 个，另 121 个只摘钉死断言」）从这个测试里删掉了 9 条「源码文本长成什么样」的钉死断言（例如 CHAIN_EVENT_REASONS 含 setup-pending、setupPendingOf 导出存在、autoSrc.includes('setupPendingOf')、autoSrc 含 'setup-pending'、chainEventRefresh&&loadChain、timer.interval 计数==1、setInterval 计数==1、钩子段不含 debug log、hookWin 含 attentionVisible），行为断言一条没动。今天的 9 项是：源码可提取（1 项）、setupPendingOf 是函数（1 项）、7 条纯函数行为（fail→true、current→true、done→false、空快照→false、无该行→false、无链快照→false、null→false）。

局限必须写清楚：这个门禁用 spliceableJs 从 `src/client/kernel/probe-chain.js` 里抽出 setupPendingOf 一个函数单独执行，只验证这个纯函数的返回值，**不验证它有没有被调用、也不验证节拍有没有排上**。所以 9 项全绿与真机不生效可以同时成立——本次复核的结果正是如此。

### 3.3 机制层面的结论

修复代码在，但修复挂靠的节拍因为 `timer` 包装对象没有 interval 而永远排不上（2.4 节的证据链），因此 #891 的自动重算在今天的 HEAD 与运行构建里都不生效。

## 四、真机日志证据

### 4.1 日志位置、范围与查询方法

- 目录：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\`，每天一个 YYYY-MM-DD.log，本次可用范围是 2026-10-15 到 2026-10-21。
- 文件大小依次为 7／24／67／57／56／134／27 MB；内容是 JSONL，含 debug 级。
- 查询方法：用 `Select-String` 先限定日期文件与事件名或关键词，再用 `Select-Object -First` 截断；没有整文件读入，也没有对整文件做 ConvertFrom-Json。
- 已知限制：日志里 log.rotate.degraded 很多，可能缺片；2026-10-21 的文件在查询时被运行中的插件进程独占锁住过，Select-String 曾报 "being used by another process"，因此 10-21 单日的计数可能偏少。关键结论不依赖 10-21 单日。

### 4.2 查了哪些事件、命中多少

下面是按日期（10-15 到 10-21）逐个文件统计的命中数，横杠表示当天该事件为 0：

- `input.observe` 且 kind:'probe-tick'（活跃探测每跑一拍就必落这一行，且在 setup 判断之前）：**7 天合计 0 条**。
- `attention.report` 且 kind:'heartbeat'（心跳每拍一条）：**7 天合计 0 条**。作为对照，其余 kind 的 attention.report 每天有 74／1551／3778／3990／4751／11297／1995 条，而且 visible:true 占绝大多数（如 10-20 是 10515 条 true 对 782 条 false），说明不是「面板不可见」也不是「日志开关没开」——同一天 debug 级的 chain.event、input.observe 其它 kind 都在落盘。
- `chain.event` 的 reason：7 天分别是 0／1／3／9／4／8／4 条，出现过 enter-workspace、user-recheck、action-done，**从来没有 setup-pending**。
- `chain.backoff` 的 trigger：每天 62／88／118／77／78／2058／745 条，出现过默认的 "event"、action-done、user-recheck-bypass，**从来没有 setup-pending**。按代码，setup-pending 一旦真被触发，宿主 chain.backoff 必有一条 info 级记录（src/host/refresh/chainBackoff.ts:138），不依赖 debug 开关。
- `chain.predicate` 里 id=tracker:initialized 的行：每天 0／6／15／10／14／34／10 条；status 有 fail 的日子是 10-17（pass 14、fail 1）与 10-18（pass 8、fail 2），其余日子全是 pass。这说明链求值本身在跑，也出现过「初始化那一步没过」的真实读数。
- `chain.cache.write` 的 allGreen:false：每天 0／0／5／5／1／5／3 条（例如 10-20 的 keyHash 95ddfe37 doneCount 6、566a1082 doneCount 8、026c18a5 doneCount 8），说明链确实有「没全绿」的时段。
- 初始化注入相关：`guide.inject` 全期 0 条；console 的 setup-inject applied 全期 0 条；`inject.decision` 全期只有 4 条（10-16 两条、10-21 两条），10-21 那对是 ts 1792516153849（13:09:13.849）的 prompt:"setupRun" kind:"askLayout"，紧接着 ts 1792516157016（13:09:17.016）的 prompt:"switchSettle" kind:"align" layout:"single"，traceId c7bb5eef149b7e2f。按代码，askLayout 后紧跟 switchSettle 是「切换后端」那条路的配对；黄条按钮点下去会落 guide.inject（全期 0），所以这一对不能当成「黄条被点过、初始化跑过」的证据。
- 宿主调用侧对照：`wf.focus` 每天 3307／3405／3778／3383／4751／11518 条，10-20 的 `wf.probe` 约 36833 条且当天前 15 分钟每分钟稳定 6 条——这是 v1.3 那条原生 setInterval 兜底探针（package/lib/client.js:12091-12109）在跑，与 active probe 无关，不能用来证明视野节拍正常。

### 4.3 日志能证明什么、不能证明什么

能证明：**#891 修复所依赖的活跃探测节拍在真机上从未执行**（7 天 0 条 probe-tick、0 条 heartbeat，同期其它 debug 日志正常），因此 setup-pending 这条自动重算从未被触发过（chain.event 与 chain.backoff 里都没有 setup-pending）。

不能证明：日志窗口里没有一次「真正走完初始化注入」的现场实例（guide.inject 为 0、inject.decision 里没有 kind:'setup' 的真注入、没有 setup-inject applied 的 console 行），所以无法从日志里直接截到「初始化完成后黄条仍然在」的那一屏；也无法从日志确认 10-21 13:24 这份构建之后用户有没有再遇到该现象。

## 五、判定

**判定：存在（机制层面）。**

给出今天仍可复现的路径：

1. 用户点黄条「初始化」→ `StatusBackend.ts:204-207` → `prompts-setup.ts:48-59` 开布局卡 → 确认后 `prompts-setup.ts:74` 调 inject(st, dec.text) 把 setupRun 提示词注入会话（此时的状态栏黄条由链快照驱动，见 `bannerChain.ts:94-114`）。
2. AI 执行初始化、往工作区写文件。写入发生在链外；`git-process.ts:263` 只做 noteWriteActivity（让退避回档），不重算链。
3. 初始化完成后，本该由 `probe-auto.ts:255-263` 的 setup-pending 钩子自动重算链；但 `probe-auto.ts:266-269` 的守卫读到的 `timer` 是 `hostShim.ts:23-48` 那个没有 interval 的包装对象，函数在排节拍之前 return；构建产物 `package/lib/client.js:12149` 同形。
4. 于是链快照保持初始化之前的状态，`guideBannerStep` 里 `tracker:initialized` 这一步的 checks 仍然是旧读数，`guideStepDone` 为假，黄条按旧快照常驻；除非用户亲手触发四路事件之一（点刷新／打开检查页／切换后端等），否则不会自己消失。

三条最强证据：

- `src/client/hostShim.ts:23-48` 的 timer 包装只有 timeout、setTimeout、clearTimeout，没有 interval；`src/client/kernel/probe-auto.ts:266-269` 与 `src/client/kernel/attention-heartbeat.ts:193` 的守卫因此恒真、直接 return；运行构建 `package/lib/client.js:129-166`、:12149、:12515 完全同形，全文件没有给 timer.interval 补丁的语句。
- 门禁实跑 9 项全 PASS，但它只测 setupPendingOf 的纯函数返回值，不测调用链、不测节拍；票面的 18 项是 2026-10-12 被 0f1f576b 摘掉了 9 条源码形状断言，行为断言没丢，只是本票最关键的「钩子挂在哪个节拍、节拍排没排上」不再被任何门禁覆盖。
- 真机日志 2026-10-15 到 10-21：`input.observe` kind:'probe-tick' 0 条、`attention.report` kind:'heartbeat' 0 条，同期同文件其它 debug 日志（chain.event、input.observe 的 focus-send/width-link 等每天数千到数万条）正常落盘，且 attention.report 的 visible 绝大多数为 true；`chain.event` 与 `chain.backoff` 里从来没有 setup-pending。

补充：本票没有现场实例，不等于「不存在」。票面故障的机制（初始化完成后没有自动链刷新）在今天的树与运行构建里仍在；缺的是「修好节拍之后复跑一次初始化、看到新日志」这一步现场验收。因此建议不要按「已修复」关票，而应转给承接票 #1220（或新开一张修复票）处理 timer 包装缺 interval 这一根因。

## 六、埋点方案（本阶段只设计，不改代码）

如果要在修复前后各拿一次真机证据，建议加三条按需日志。事件名沿用仓库 CRITICAL 风格（小写点分），字段只记枚举、散列与计数，不记路径原文、仓库地址原文、提示词原文与任何凭证。

### 6.1 事件一：横幅出现、消失与它当时读到什么（本票最直接的证据）

- 落点：`src/client/statusbar/StatusBar.ts:269` 算出 bannerStep 之后、:270 之前（同一个渲染函数里）。
- 事件名：`guide.banner`，info 级（横幅变化是低频事件，不依赖 debug 开关；参考现有 `guide.inject` 的常驻口径）。
- 去重：模块级 Map，键用 cwd 的短散列（复用 `dswsLogHash`），值是上一次落盘的 step id（无横幅记空串）；只有 step 变了才落一行，避免每次重渲染都写。
- 字段：
  - `step`：当前横幅步的 id，没有横幅时写空串（这就是「黄条出现／消失」的时刻标记）；
  - `tone`：横幅档位，黄条写 'warn'、蓝条写 'info'；
  - `trackerInit`：链快照里 tracker:initialized 这一行的 status（done／fail／current／missing，没有快照写 none）；
  - `chainSteps`：这次判横幅时链快照里的步骤数；
  - `backendId`：当前后端 id（枚举）；
  - `gateActive`：布尔，门控是否还开着；
  - `keyHash`：cwd 短散列。
- 落盘后怎么读：初始化注入之后，如果只看到 step='tracker:initialized'、trackerInit 不是 done，后面很久都没有 step='' 的那一行，说明黄条常驻（故障存在）；如果在几秒内出现 step='' 或 step 前进到 `skill:wayfinder`，说明链自动重算生效（故障不存在）。若 step='' 与 setup-inject 的时刻对不上，还能反过来判断是「横幅判据」还是「链刷新」哪一层出的问题。

### 6.2 事件二：这一趟链刷新把快照换成什么

- 落点：`src/client/kernel/probe-chain.ts:179-194` 应用快照成功的那一段（建议在 :190 emit(st) 之后），只记信息级一行。
- 事件名：`chain.refresh`，info 级；不要改写现有 `chain.event`（它只有 reason 一个字段，改含义要发新事件，这是 AGENTS.md 日志埋点纪律第 2 条）。
- 触发条件：只在 trigger==='setup-pending'，或 tracker:initialized 的 status 前后发生变化时落一行（其余高频路不记）。
- 字段：
  - `trigger`：enter-workspace／user-recheck／action-done／setup-pending；
  - `ok`：这一趟回包是否成功；
  - `steps`：应用后链快照的步骤数；
  - `trackerBefore`／`trackerAfter`：tracker:initialized 前后 status（done／fail／current／missing／none）；
  - `latencyMs`：从发请求到应用快照的耗时；
  - `keyHash`：链共享键的短散列（与现有 chain.backoff 的 keyHash 同口径）。
- 落盘后怎么读：如果看到 trigger='setup-pending' 且 trackerBefore≠done、trackerAfter=done，说明修复链路成立；如果 setup-pending 从没出现，说明节拍仍未排上；如果 setup-pending 出现但 trackerAfter 仍不是 done，问题在宿主链求值或快照安装，不在这条钩子。

### 6.3 事件三：节拍到底排没排上、卡在哪一道门

- 落点：`src/client/kernel/probe-auto.ts:241-271`，在四个早退分支（:243 不可见、:244 standing 不对、:247 无 cwd、:266 无 timer.interval）前各记同一个「原因」，在 :270 排上之后记 'scheduled'。
- 事件名：`probe.loop`，info 级。
- 去重：模块级变量记住上次原因，只有原因变化才落一行；同一天同一原因最多几条，不会刷屏。
- 字段：
  - `reason`：visible-hidden／not-standing／no-cwd／no-timer／scheduled；
  - `intervalMs`：本次打算用的间隔（_attentionPlan.intervalMs）；
  - `standing`：'active'／'collapsed'／'evicted'／空串；
  - `hasTimer`：布尔，typeof timer.interval==='function' 的结果；
  - `keyHash`：cwd 短散列。
- 落盘后怎么读：如果修复前持续看到 reason='no-timer' 且从来没有 'scheduled'，本次结论就被日志直接证实；修复后若看到 'scheduled'，再用 6.1、6.2 两条看 setup-pending 与快照变化。

### 6.4 要同步的白名单与附录

- `tests/verify-log-fields.ts`：第 20 行起的 ALLOWED 表要加三个新事件及其字段（现有 `input.observe` 在 :262、`chain.backoff` 在 :318、`chain.event` 在 :320，可参考它们的登记写法）；文件头第 1-3 行的说明也要按惯例补一句日期、票号与新增内容。
- `research/489-appendix.md` 第 1 章对照表：按现有编号顺序追加三条事件（含字段含义、常驻或按需、发射口文件与行）；第 1 章顶部的修订说明补一条。
- 相邻门禁要一并检查：`tests/verify-log-coverage.ts`（覆盖口径）、`tests/verify-log-truncate.ts`（渲染目录只许点名文件写日志的纪律）、`tests/verify-log-artifacts.ts`、`tests/verify-log-client.ts`；改完以附录条数为准。
- 纪律：不记工作区路径原文、不记仓库地址原文、不记提示词正文、不记令牌与任何凭证；高频事件必须先判开关或变化才落。

## 七、未决问题

1. **没有现场实例。** 7 天日志里没有一次真正走完初始化注入（guide.inject 0、没有 setup-inject applied），因此没有截到「初始化完成后黄条仍在」的屏幕证据；现有「存在」判定是机制层面的（代码路径加 0 probe-tick 的日志反证）。若 lead 或用户要求现场证据，需要先修 timer 包装或加 6.1-6.3 的埋点，再让用户复跑一次全新工作区初始化。
2. **10-21 当天日志被运行进程占用。** 查询时出现过文件被占用，10-21 的计数可能偏少；好在 10-15 到 10-20 六天的 probe-tick 与 heartbeat 都是 0，结论不依赖 10-21。
3. **hostShim 缺 interval 是不是有意为之。** `hostShim.ts:18-22` 的注释只解释了 timer 服务缺失与 timeout 降级，没有说明 interval 该不该转发；需要人确认「timer 包装是否应当补 interval（宿主有就转发，没有就落全局 setInterval）」。这属于修复，不在本阶段做，建议交给 #1220 或新票。
4. **门禁缩水的风险。** 18 项变 9 项后，行为断言还在，但「钩子挂在哪个节拍、定时器怎么排」不再被钉；建议在修复票里补一条集成断言（或在日志门禁里补 6.3 那条 probe.loop 的覆盖），避免下次再出现「测试全绿、真机不跑」。
5. **宿主 timer 服务到底有没有 interval 能力。** 本次没法从日志或现有门禁里确认；但从 shim 实现看，即便宿主有 interval，包装对象也不会把它暴露出来，所以不影响本次结论，只影响修复方式的选择。
