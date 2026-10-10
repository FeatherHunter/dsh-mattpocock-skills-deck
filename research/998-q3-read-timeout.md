# 998 问三深查：单票读那一次远端调用没回来，是偶发还是读路径本来就紧

> 只读研究，不改代码，不动任何票与标签。覆盖写 `research/998-q3-read-timeout.md`。
> 时间：2026-10-10。范围只看一手来源里的字，不猜真机上那一次的原文。
> 一手来源：`src/shared/deck-tools/call-scope.js`、`src/host/tools/deckIssueReport.js`、`src/host/tools/deckContext.js`、`src/shared/deck-tools/shell.js`、`src/host/platform/deckExec.js`、`src/host/tracker/backends/github/*`、`src/shared/tracker/outbound-tiers.js`、`src/host/refresh/gate.js`、`CONTEXT.md`、`research/489-appendix.md`、`CHANGELOG.md`、`refresh-core/src/failure-window.ts`。

## 0 先说结论

- 那一次 `backend-threw` 写着“远端调用在限时内没回来”，和主故障的 `gate-defer` 不是同一条路，码不一样，重试说法也不一样。（来源：`src/shared/deck-tools/shell.js:32-40,306-321`、`src/host/tools/deckIssueReport.js:27-32,96-98`）
- 只看代码，读路径确实偏紧：外层一次调用 120 秒、收尾留 10 秒，单次远端调用最多给 30 秒；上报那条路只读一张票，全量取数那条路要翻很多页，一次逻辑调用会扇出成很多条真出站命令，30 秒要包住全部。（来源：`src/shared/deck-tools/call-scope.js:16-20,164-171`、`src/host/tracker/backends/github/issues.js:128-231`）
- 但现在还不能定性为结构性故障：本轮三次调用全成功，那一次没有留下操作名、耗时、哪一层掐的这三样，真机日志按白名单只记四元组，原文不落盘。（来源：`research/489-appendix.md:70-98,181-182,193-194`、`CONTEXT.md:87-92`）
- 推荐：另开一张窄的归因单，先补能定位的那几格日志，再等复现，不要现在就改重试或调大超时。（理由见第 4 节）

## 1 现状证据

### 1.1 那一次和主故障不是同一个码

- 998 修的是“连续失败到门槛之后，所有工具一直被推迟，只能重启进程”。修法是退避走完一整轮就放一笔探针进来试，成功就归零开锁。（来源：`CHANGELOG.md:1-11`、`refresh-core/src/failure-window.ts:8-20`、`src/host/refresh/gate.js:20,152-161,230-233`）
- 推迟走的是壳里的 `gate-defer`：闸说不发，就回做不到，话里带闸的原话“我没有动手”。（来源：`src/shared/deck-tools/shell.js:316-321`，选后端那一步的推迟见 `src/shared/deck-tools/shell.js:210-213`）
- 末条评论那一次是 `backend-threw`，话是“远端调用在限时内没回来”。它是执行层拦下来的抛错，不是闸推迟。（来源：`src/shared/deck-tools/call-scope.js:132-134,205`、`src/shared/deck-tools/shell.js:306-314`）
- 结论：主故障是闸不让发，这一次是发了没回来。两条路不同，不能用“闸修好了”解释这一次。（来源同上两段）

### 1.2 本轮三次全成功，说明不了偶发，也说明不了必然

- 任务背景说本轮三次调用又全成功。这只能说明这条路现在能走，不能说明上一次为什么没回来。
- 单票读带同一次调用里的记忆缓存：同一票号在同一次调用里只真读一次。但每一次工具调用都新建一份记忆，跨调用不共享。（来源：`src/shared/deck-tools/call-scope.js:160,231-239`）
- 所以三次成功可能是网络好了，也可能是缓存命中掩盖了慢，代码里看不出来。没有那一次的耗时与操作名，就没法选边。（来源同上，加 `research/489-appendix.md:193-194` 的字段清单解释为什么看不出来）

### 1.3 代码里的三组数字

- 外层一次调用 120 秒，剩余额度到 10 秒就停发新调用，单次远端调用默认钳制 30 秒。（来源：`src/shared/deck-tools/call-scope.js:16-20,164-166`）
- 去 GitHub 的分档超时现在是读 12 秒、写 30 秒、探活 3 秒，拿不到档位才沿用旧的 30 秒。文件头写明这是暂定值，终值等测出耗时分布后回填。（来源：`src/shared/tracker/outbound-tiers.js:1-20,65-83`）
- GitHub 房里那处旧的 30 秒字面量还在，但真正等多久由分档函数定，调用方显式传的优先。（来源：`src/host/tracker/backends/github/client.js:44,147-153,179`）
- 结论：单操作钳制 30 秒是调用执行上下文那一层的帽子，真起进程那一层读操作现在只等 12 秒。两层都要看，只看一层会误判松紧。（来源同上三处）

### 1.4 26.3 秒与 26 次在仓库里没有原文

- 全仓搜 `26.3` 没有命中，`26 次`这类计数也没有以字面量落在源码里。任务里写的“全量取数 26.3 秒实测”与“30 秒被杀 26 次”应来自 998 那张票里的真机日志与时间线，不是代码里的常量。（来源：本次只读搜仓结果，无命中；`refresh-core/src/failure-window.ts:12-13` 说时间线在票里）
- 代码能解释为什么这两个数字 plausibly 会出现，但不能证实它们：全量取数那条路是分页循环加拉取请求再加备用通道，页数随仓大小涨；单条命令的超时日志只记命令名与超时毫秒，不记是哪条操作、哪个仓。（来源：`src/host/tracker/backends/github/issues.js:68-92,128-200`、`research/489-appendix.md:181-182`）
- 所以本报告把 26.3 秒当“任务给的待核对输入”用，不当已证实的仓库事实。缺的直接证据见第 5 节。

## 2 四码辨析：timeout、aborted、over-budget、backend-threw

四码都住在 `src/shared/deck-tools/call-scope.js:132-140,167-206`，上报与取上下文两条路用同一个篮子收它们。（来源：`src/host/tools/deckIssueReport.js:27-32`、`src/host/tools/deckContext.js:24-29`）

### 2.1 timeout：这一次远端调用在限时内没回来，是否生效说不清

- 触发：执行上下文里那只定时器先响，掐断信号，之后不管后端回什么都判超时。（来源：`src/shared/deck-tools/call-scope.js:179-191`）
- 钳制值取两者的较小值：单次默认 30 秒，与剩余额度减去收尾 10 秒。（来源：`src/shared/deck-tools/call-scope.js:171`）
- 回执原话：“是否生效说不清：先按返回里说的办法核对现状再续，不要直接重放写操作。”（来源：`src/shared/deck-tools/call-scope.js:132-134`）
- 后续动作：读可重调一次；写必须先核对再续，不能直接重放。（来源：同一句回执文案）
- 在上报这条路里，单票读拿到 timeout 会被当传输层失败直接抛给壳，壳收成 `backend-threw`。（来源：`src/host/tools/deckIssueReport.js:96-98`、`src/shared/deck-tools/shell.js:306-314`）这一步把细码折成了粗码，界面只看到粗码。（来源同上）

### 2.2 aborted：这次调用被中止了，没做完就是没做

- 触发：调用方取消信号到了，或执行中信号已中止。（来源：`src/shared/deck-tools/call-scope.js:170,188,192`）
- 回执原话：“没做完就是没做：按需重调一次即可。”（来源：`src/shared/deck-tools/call-scope.js:135-137`）
- 后续动作：按需重调一次即可，不要求先核对。（来源同上）
- 与 timeout 的差别：aborted 说没做，timeout 说不清做没做。重试前要不要核对，分界在这里。（来源：两句回执文案对照）

### 2.3 over-budget：剩余额度不够再发一次了，这次没动手

- 触发：剩余额度小于等于收尾 10 秒，发新调用前直接拒绝，不起进程。（来源：`src/shared/deck-tools/call-scope.js:164-169`）
- 回执原话：“这次没动手：带同样参数重调一次即可接着做。”（来源：`src/shared/deck-tools/call-scope.js:138-140`）
- 后续动作：带同样参数重调一次即可，因为根本没动手，不存在生效一半。（来源同上）
- 与 timeout 的差别：一个是没发，一个是发了没回来。日志里不记剩余额度与钳制值时，事后分不清是哪种。（来源：第 5 节清单）

### 2.4 backend-threw：这一次远端调用抛错了，已拦下

- 触发：执行抛了错，且不是上面三种（超时、中止、预算不够）。还包括没拿到后端实现这种装配问题。（来源：`src/shared/deck-tools/call-scope.js:200-206,215-217`）
- 回执是把错误正文截到 200 字拼在后面。（来源：`src/shared/deck-tools/call-scope.js:205`）
- 壳里还有两处同名兜底：工具真正跑的那一步抛错，或回包形状不对，都收成 `backend-threw`。（来源：`src/host/platform/deckExec.js:79-86`、`src/shared/deck-tools/shell.js:306-314`）
- 后续动作：壳的注释写“可重试”，但没有写读与写是否都要先核对。（来源：`src/host/tools/deckIssueReport.js:25-26`、`src/host/tools/deckContext.js:22-23`）
- 结论：`backend-threw` 是个筐，超时折进去之后就看不出是等满了还是真抛错了。那一次写着“限时内没回来”却落在 `backend-threw` 名下，原因就在这里：细码在执行上下文里是 timeout，抛给壳时被收成了筐。（来源：`src/host/tools/deckIssueReport.js:96-98` 加 `src/shared/deck-tools/shell.js:306-314`）

## 3 代价分析

### 3.1 上报那条路：只读一张票，加一次 5 秒竞速的记链

- 上报先调单票读，参数是评论取 0 条，不翻页。（来源：`src/host/tools/deckIssueReport.js:96`）
- 单票读的主路是一条按号查工单的查询，不中再查拉取请求，网络或配额类失败才走单条备用通道，最多两三条命令。（来源：`src/host/tracker/backends/github/issues.js:241-281,290-317`、`src/host/tracker/backends/github/queries.js:43-47,213-217`）
- 记链那一步另有 5 秒竞速：超时按没记进走老路，不抛错，不影响上报成败。（来源：`src/host/tools/deckIssueReport.js:23,114-129`）
- 上报声称的花费是请求 1 条、点数 3 点。（来源：`src/host/tools/deckIssueReport.js:109,144-145`）
- 结论：上报的正常代价是轻的，一次没回来更可能是那一两条命令慢，而不是页数多。（来源：上述单票读代码与声称花费对照）

### 3.2 取上下文那条路：一次逻辑调用，里面是多页串行

- 取上下文并行发预检与地图清单，权限旁路符合条件时也并行，最后等最慢的那一份。（来源：`src/host/tools/deckContext.js:74-88`）
- 但清单本身是串行翻页：工单按 100 条一页翻到头，最多 500 条；拉取请求再翻一轮，最多到 1000 条；主路一坏就整批走备用通道，备用通道最多 10 页，每页 100 条，还要再拉拉取请求页并逐页修树边。（来源：`src/host/tracker/backends/github/issues.js:128-200,201-230`、`src/host/tracker/backends/github/queries.js:33-40,203-210`）
- 取上下文声称的花费是请求 3 条、点数 2 点。（来源：`src/host/tools/deckContext.js:130`）
- 结论：声称的 3 条是逻辑步数，真出站条数随页数涨。闸记的是真发出去的条数，调用方报的数只用来对账，对不上会记一次对不上。（来源：`src/host/refresh/gate.js:11-12,88-96,193-220`）分页、重试、兜底链、扇出都要算进去，是闸文件头写明的第 2 条硬要求。（来源：`src/host/refresh/gate.js:8-12`）

### 3.3 外层 120 秒与单操作 30 秒有多紧

- 可用的时间是 120 秒减去收尾 10 秒，还剩 110 秒。单操作钳制取 30 秒与剩余额度减 10 秒的较小值，调用刚开始时就是 30 秒。（来源：`src/shared/deck-tools/call-scope.js:16-20,164-171`）
- 全量取数若真要 26.3 秒，离 30 秒只剩 3.7 秒余量，一次网络抖动或多一页就顶穿。单票读若走分档读超时 12 秒，两条慢读就 24 秒，同样逼近 30 秒。（来源：外层数字见上一段，分档数字见 `src/shared/tracker/outbound-tiers.js:15-17`）
- 更紧的是：清单那一整轮只占一个单操作名额，里面的每一页并不各给 30 秒。页数一多，总时长必然逼近单操作线。（来源：`src/shared/deck-tools/call-scope.js:240-248` 的清单包装只有一次 `execOp`，内部分页循环见 `src/host/tracker/backends/github/issues.js:144-169`）
- 结论：结构性偏紧的证据在代码里能成立，但它只证明“容易顶穿”，不能证明那一次就是顶穿。没有那一次的操作名与耗时，紧不紧和那一次是不是超时之间还缺一环。（来源：第 5 节）

### 3.4 26 次 30 秒被杀与超时的关联

- 房内每起一条命令都会记一行，成功与非零退出都记，只写命令名、目录散列、耗时、退出码与归一类别；等超时与起进程失败另记一行，只写命令名、目录散列与超时毫秒或错误散列。（来源：`src/host/tracker/backends/github/client.js:125-138`、`research/489-appendix.md:181-182`）
- 超时判两条满足一条即算：文案含超时特征，或耗时已到本档超时（执行器杀掉时未必留文案）。（来源：`src/host/tracker/backends/github/client.js:192-199,218-219`）
- 所以“30 秒被杀”在日志里是两行：一行执行行（类别为网络、退出码多为拿不到），一行超时行（带超时毫秒）。数 26 次时要说明数的是哪一行，去重口径是什么，否则分页里的每一页会被重复计数。（来源同上）
- 分页与重试是否计入花费：计入。闸按真发条数记账，账本那一行记请求条数、点数与剩余额度。（来源：`src/host/refresh/gate.js:193-220`，账本字段见 `research/489-appendix.md` 里账本三事件的登记，任务背景要求按白名单只记四元组）
- 结论：26 次若数的是超时行，它支持“读路径经常等满”；若数的是执行行里类别为网络的行，还要排除登录态与环境失败。没有原始行与去重口径，现在没法用 26 这个数字定性。（来源：第 5 节清单）

### 3.5 当前归因缺的三样

- 缺操作名：宿主那两行只记电话名与命令名，不记是单票读还是清单里的第几页。（来源：`research/489-appendix.md:181-182,193-194`、`src/shared/deck-tools/shell.js:99-105`）
- 缺耗时对齐：执行行有耗时，超时行只有超时毫秒，壳的失败行只有错误散列，三行靠散列对不上同一笔。（来源同上）
- 缺哪层掐的：调用执行上下文那一层的钳制值、剩余额度、信号中止这三样一行都没记；真起进程那一层的分档值也没记。事后只能看到“没回来”，看不到是谁先掐的。（来源：`src/shared/deck-tools/call-scope.js:167-198` 全函数无日志，见文件头 `13` 行“不新增事件名、不记新字段”）
- 这三样缺了，任何单子都无法验收：复现了也不知道是不是同一层。（来源：白名单只记四元组不记原文，见 `CONTEXT.md:87-92`、`research/489-appendix.md:70-98`）

## 4 推荐与风险：另开窄单 vs 视为偶发不单开

### 4.1 视为偶发不单开

- 支持的说法：本轮三次全成功，主故障已修，单次超时在慢网下本来就会发生；单票读失败按“可重试”走面板或重调一次就能过。（来源：任务背景的三次成功、`src/host/tools/deckIssueReport.js:25-26` 的可重试注释）
- 风险：若偏紧是结构性的（清单翻页扇出、单操作 30 秒包全轮、分档读 12 秒偏短），不单开等于把“容易顶穿”留在原地，下一次全量取数还会撞线；而且闸的连续失败计数只认真失败，超时多了会把工作区推向退避，界面变慢。（来源：`src/host/refresh/gate.js:211-219` 的失败计数、`src/shared/tracker/outbound-tiers.js:8-10` 的暂定值说明）
- 票噪音：不开就没有噪音，但省掉的是一张能收敛证据的单子，不是省掉了故障本身。

### 4.2 另开归因与安全重试单，先埋点再等复现（推荐）

- 单子只做两件事，不调超时数字，不改重试策略：
  1. 补能定位的那几格：操作名（单票读、清单、预检、权限旁路、第几页、主路还是备用通道）、真耗时、哪一层掐的（执行上下文钳制值与剩余额度、真起进程那一档的超时值）、折成粗码前的细码。字段必须落在白名单里，只记枚举、数字与散列，不记标题与错误原文。（来源：白名单纪律见 `CONTEXT.md:87-92`、`research/489-appendix.md:70-98`；现有两行字段见 `research/489-appendix.md:181-182,193-194`）
  2. 等复现并写明验收：复现到一次能对上三行的超时（执行行、超时行、壳失败行是同一笔），再谈读可重调、写须先核对的安全重试文案是否要分开；复现不到就只留埋点，不扩改动。（来源：四码不同的后续动作见第 2 节）
- 为什么先埋点：没有归因的单子无法验收，改了超时数字也不知道改没改对。分档文件头自己都写着终值等测出分布后回填。（来源：`src/shared/tracker/outbound-tiers.js:8-10`）
- 票噪音控制：单子标题写清“先埋点再等复现”，不承诺修；落点只加在已有两行与壳那一行里，不新开事件、不加字段之外的原文。（来源：`research/489-appendix.md:30` 的只新增落点先例、`src/shared/deck-tools/call-scope.js:13` 的不新增事件名口径）
- 风险：多一张票，多几行日志；若一直不复现，单子会长期开着。 mitigation 是单子里写清关闭条件（例如观察期无复现就关，埋点保留）。

### 4.3 本报告的取舍

- 推荐另开窄单。不是因为已经证实结构性故障，而是因为“偏紧”在代码里可证，“那一次”在日志里不可证，不补定位信息就永远停在猜。
- 不推荐现在就调大超时或加自动重试：写操作是否生效说不清，直接重放会 double 写；读操作分档值是暂定值，没有分布就调等于拍脑袋。（来源：`src/shared/deck-tools/call-scope.js:132-134`、`src/shared/tracker/outbound-tiers.js:8-10`）

## 5 缺的直接证据清单（按能定位一次超时所需的顺序）

1. 那一次是哪个电话、哪步操作：上报的单票读，还是取上下文的清单或预检，还是权限旁路。现在壳只记电话名，房内只记命令名，对不上步。（来源：`src/shared/deck-tools/shell.js:99-105`、`research/489-appendix.md:181-182,193-194`）
2. 每一笔的真耗时与等满值：执行行的耗时、超时行的超时毫秒、执行上下文那一层的钳制值与剩余额度。现在只有前两者，没有后两者。（来源：`src/shared/deck-tools/call-scope.js:164-171` 无日志、`research/489-appendix.md:181-182`）
3. 哪一层先掐的：是执行上下文的定时器，还是真起进程那一层的分档超时，还是调用方取消。现在三层各记各的，没有同一笔标识。（来源：`src/shared/deck-tools/call-scope.js:179-198`、`src/host/tracker/backends/github/client.js:147-153,179`）
4. 折码前的细码：抛给壳之前是 timeout、aborted、over-budget 还是真抛错。现在壳只看到折后的筐。（来源：`src/host/tools/deckIssueReport.js:96-98`、`src/shared/deck-tools/shell.js:306-314`）
5. 26 与 26.3 的口径：数的是超时行还是执行行，是否按同一笔去重，全量取数的页数、通道（主路还是备用通道）、每页耗时。现在只有任务背景的数字，没有可复核的行。（来源：第 1.4 节搜仓无命中、`src/host/tracker/backends/github/issues.js:68-92,128-230` 的页循环）
6. 真出站条数与声称条数的差：上报声称 1 条、取上下文声称 3 条，真发了几条，对不上几次。现在闸有对不上计数，但没有按电话分桶的明细。（来源：`src/host/tools/deckIssueReport.js:109`、`src/host/tools/deckContext.js:130`、`src/host/refresh/gate.js:200-210`）
7. 慢分布：读 12 秒、写 30 秒、探活 3 秒这组暂定值在真机上的命中率。分档文件写明等测分布后回填，测之前不要动数字。（来源：`src/shared/tracker/outbound-tiers.js:8-10`）

---

## 出处索引（本报告每条结论的落点）

- 外层 120 秒、收尾 10 秒、单次 30 秒、四码文案、钳制算法、记忆缓存：`src/shared/deck-tools/call-scope.js:16-20,132-140,160-171,179-206,231-248`
- 上报只读一张票、传输层篮子、抛给壳、记链 5 秒竞速、声称花费：`src/host/tools/deckIssueReport.js:23-32,96-98,114-129,109,144-145`
- 取上下文并行三路、声称花费、用法说明里的薄读指引：`src/host/tools/deckContext.js:74-88,110-131`
- 壳的三态、选后端与真调用两处的推迟与抛错兜底、日志两行：`src/shared/deck-tools/shell.js:27-40,99-105,209-213,269-314`
- 代执行通道的两处筐：`src/host/platform/deckExec.js:79-86`
- 房内默认 30 秒、执行与超时两行、分档覆盖、超时双判据、取消不算失败：`src/host/tracker/backends/github/client.js:44,125-138,147-153,179,192-199,208-219`
- 清单翻页、拉取请求再翻页、备用通道 10 页、树边修复、单票读两查加备用：`src/host/tracker/backends/github/issues.js:68-92,128-231,241-317`
- 查询形状（单票按号、清单批量）：`src/host/tracker/backends/github/queries.js:33-47,203-210`
- 分档读 12 秒写 30 秒探活 3 秒与暂定说明：`src/shared/tracker/outbound-tiers.js:1-20,65-83`
- 闸的唯一出口、真发出站计数、失败计数与窗口、推迟不等失败：`src/host/refresh/gate.js:8-20,152-161,193-220,230-242`
- 连续失败修的是什么：`CHANGELOG.md:1-11`、`refresh-core/src/failure-window.ts:8-20`
- 日志只记四元组不记原文、白名单截断散列、现有两行字段：`CONTEXT.md:85-92`、`research/489-appendix.md:62-98,181-182,193-194`
