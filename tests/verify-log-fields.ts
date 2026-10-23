// verify-log-fields.ts —— #494 第三件事：日志门禁之字段白名单（#489 附录第 4 节断言一）。
// 用法：在插件根目录执行 node tests/verify-log-fields.ts，可独立运行。
// 断言文字：扫描全部埋点调用，每个事件只含第 1 节允许字段（2026-10-21 map 1010 wayfinder 逐票复核新增常驻 #120 gh.auth.env、#122 guide.banner 与按需 #121 gh.lane.saturated、#123 probe.loop、#124 prompt.link，共 124 事件（2026-10-23 #1409 新增按需 #127 suggest.bind、#128 suggest.call、#129 suggest.ready：界面借会话事件流取数的三条调试线，只记散列与计数，绝不记建议原文）；2026-10-20 #1295 新增按需 #114 container.split（列表页容器分拣这一趟：探索地图 / 规格 / 普通未关闭票 / 已关闭各几条，以及容器种类判定有没有退回文件内兜底）并给常驻 #10 snapshot.built 增补一格 specs（这一份快照里判成规格容器的几个；maps 是容器总数，条数不变）；2026-10-20 #1294 新增按需 #112 locale.registration（注册这一趟的结论：几门语言、新增几门、跳过几门、缺省语言、耗时）与常驻 #113 locale.registration.fail（注册失败那一步：读快照 / 新增语言 / 注册词表，哪门语言、回退目标、错误原文散列）；#746 增补常驻 #90 naming.summary，#782 增补常驻 #92 cwd.persisted，#817 增补常驻 #94 git.exec 与 #95 git.exec.fail，#864 增补按需 #96 vc.cache.screen，#958 增补按需 #97 labelColors.listed，#1048 增补按需 #98 detection.step 并给常驻 #16 detection.detect 补六键，#1131 增补按需 #99 detection.cache.hit（缓存命中那一行：这一次没重算、直接把上一次的判定回给了调用方），#1054 增补常驻 #100 edge.write（关系边写没写下去、走的哪条路、为什么）与按需 #101 edge.cycle、#102 edge.roster、#103 edge.repair（成环检查、邻接关系来源、REST 树边修复三条调试线），#1053 增补常驻 #104 issue.write（票的增删改评论贴标签：写没写下去、走的哪条路、为什么），#1048 收口补做增补按需 #105 detection.fallback（早快照兜底那一趟：探测服务没给出结论时才走，不与常驻 #16 同名不同形），#1053 同日增补常驻 #106 labelDefs.write（标签定义改写这一趟：打算动几个、真发几条、几条没改上）与 #107 repo.init（开仓发布这一趟：走新建还是推到已有远程、起了几条命令），#1083 退役常驻 #80 sessionTickets.chain（旧链落盘那一路随工作路线存档重写而退役）并增补常驻 #110 workRoute.write（工作路线写这一侧：记一笔、落盘、写后读回、按保留期裁旧）与 #111 workRoute.read（读这一侧失败时一行，文件不存在不记）；#1083 同日给这两条补上 why 与 detail：why 是失败原因代号（成功空串），detail 是给人指的字段路径或错误类名，不带被拦下的值）；2026-10-20 #1296 新增按需 #115 container.accent（启动时按调试档记一行界面实际取到的两色：explore 是中央色表 map 值、spec 是中央色表 spec 值）；
// 2026-10-21 第二轮逐票复核（map 1010 的 1000–1300 段）没有新增事件，只给四条既有事件补判定字段：
//   常驻 #5 gh.exec 增补 cmd（哪条 gh 子命令，例如 issue:create；从前只有 argv0='gh'，分不出查登录态还是改票）、
//   常驻 #6 gh.timeout 增补 layer（room-tier 房内自己掐表 / host-clamp 宿主外包钳制）、
//   常驻 #26 host.call 增补 reason（deck.quotaSync 同步失败、或 #1355 缺本会话工作路线表补拉时带原因码）、
//   按需 #76 refresh.decide 与 #77 refresh.skipped 在失败窗口里增补五个归因键（连续几次、窗口起点、最近一次类别与种类）。
//   事件总数仍 119，字段键数增加；字段含义见下面各行的中文注释与附录 1.4/1.5 对照表。
// 2026-10-24（#1444 收口，1445 起写会话也共用）：新增按需 #130 read.session（刷新后台开会话开不成的结局名一行；
//   成功不记，避免每趟刷新刷噪音）。字段说明见下面 read.session 一行与附录 1.5。
// 2026-10-21（#1101 排查）再给 #5 gh.exec 与 #6 gh.timeout 补归因格，并新增常驻 #125 gh.lane.wait
//   （排队等到三秒以上、按桶五分钟节流）；事件总数 119 → 120。字段说明见下面 gh.timeout 与 gh.lane.wait 两段注释。
//   为什么要补：#1007 要能分开查登录态与改票、#1006 要查配额同步为什么失败、#1008/#1218 要查退避窗口里那几次失败是谁攒的。
// 出现工作区原始路径、仓库地址原文、令牌原文、模板正文、快照全文即红。
// 做法：从宿主与客户端源码里找出全部日志调用，逐个事件收拢实际字段键，
// 与下面这张允许表逐项比对；未知事件名、未知字段键都算失败并打印清单。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('日志字段白名单门禁（#494/#498/#548/#618/#652/#655/#690/#709/#724/#782/#817/#864/#958/#1048/#1131/#1054/#1053/#1083/#1294/#1295/#1296：119 事件逐个只记已知安全字段，未知字段默认不记）')

// 允许表：事件名对应它能记的全部字段键，之外的键一律不许出现。
// 键名取自实现原文，语义与 #489 附录 1.4、1.5 节对照表一致。
// 其中 error.normalize 的 httpCode 只在归一出状态码时才带，其余两键常带。
const ALLOWED = {
  'snapshot.request': ['cwdHash', 'backend', 'force'],
  'snapshot.cache.hit': ['kind', 'ageMs'],
  'snapshot.cache.miss': ['reason'],
  'repo.resolve.tier': ['tier', 'ok', 'latencyMs'],
  // 2026-10-14（#1052）常驻 #5 `gh.exec` 增补一格 `via`：这一次 gh 调用是谁发的、走到哪一支
  //   （调用点写死的短标签，例如 list.gql / list.rest / get.rest / counts.gql；没给标签的调用点写空串）。
  //   为什么要有：一趟读操作会落好几行字段完全一样的 gh.exec，事后分不出哪行属于哪条操作、走的哪条路。
  //   只写短枚举，票号、仓库地址原文、路径原文一个字都不记。登记册与「读路径调用点必须带标签」那条
  //   断言在 tests/verify-github-gh-via.ts。
  // 2026-10-14（#1052 续）常驻 #5 `gh.exec` 再增补一格 `opId`：宿主起这一趟操作时生成的编号
  //   （形状 `<base36 毫秒时间戳>-<base36 计数器>`，例如 mg8xk1p-3），房间原样取 `ctx.opId` 记下来。
  //   为什么要有：`via` 只回答了「这一行是谁发的」，回答不了「这一行属于哪一趟操作」——同一时间有几趟
  //   读并行时，光看房间这一层仍然分不清哪几行是一伙的。宿主那层的 host.call / host.call.fail 记同一个
  //   编号，两层于是能靠一个键对上，不必再按时间戳猜。没给编号的调用方记空串，行为与从前一字不差。
  // 2026-10-21（#1007 复核）再增补一格 cmd：这一条 gh 命令是哪种子命令，形状是短标签
  //   （api:graphql / api:repos / issue:create / auth:status），第二段不是纯动词时只留第一段。
  //   为什么要有：从前只有 argv0='gh'，一次失败分不清是「查登录态失败」还是「改票失败」；命令参数与编号一律不进日志。
  //   落点：src/tracker/rooms/github/client.ts 与 src/refresh/rooms/host/git-execution.ts 的 gh.exec 调用点。
  'gh.exec': ['argv0', 'via', 'opId', 'cwdHash', 'latencyMs', 'waitedMs', 'kind', 'exitCode', 'cmd'],
  // 2026-10-14（#1052 补做）常驻 #108 `read.degraded`：一条读操作「本来能成、这一趟没成，或者成得不完整」
  //   的结论线，一趟一行（命令成功了、可回包不是合法 JSON / 缺东西 / 游标失效 / 只拿到前几页 / 被上限截断
  //   这类路，从前一个字都不留）。四个键全是短枚举与数字：op 哪条读操作、reason 为什么、latencyMs 这一趟
  //   从入口到这里花了多久（毫秒）、opId 这一行属于宿主哪一趟操作（#1052 续补，含义见上面 gh.exec 那一段）；
  //   票号、命令原文、上游报错原文一个字都不记。发射口在
  //   src/tracker/rooms/github/read-log.ts 的 emitReadDegraded。
  'read.degraded': ['op', 'reason', 'latencyMs', 'opId'],
  // 2026-10-14（#1052 补做）常驻 #109 `preflight.gate`：探测那三项门禁每过一项各落一行，第三项过了也落一行。
  //   为什么过了也记：三项门禁落三行长得一样的 gh.exec，没有这一行就读不出「探测走到底了」还是「第一关就没过」。
  //   四个键：gate 第几项（1 起 gh / 2 登录态 / 3 认得出仓库且连得上接口）、reason 为什么（过了一律写 ok）、
  //   latencyMs 这一项花了多久、opId 这一行属于宿主哪一趟操作（#1052 续补）。发射口在
  //   src/tracker/rooms/github/read-log.ts 的 emitPreflightGatePass。
  'preflight.gate': ['gate', 'reason', 'latencyMs', 'opId'],
  // 2026-10-21（#1007/#1224 复核）常驻 #6 gh.timeout 增补一格 layer：这次超时是谁掐的表——
  //   room-tier 是 GitHub 房自己按档位掐的（房间这一层），host-clamp 是宿主外包的一层钳制。
  //   为什么要分开：房内掐表后宿主仍可能再掐一次，只看到一条超时区分不了是档位设小了还是外层兜底被触发。
  // 2026-10-21（#1101 排查）常驻 #6 gh.timeout 再增补四格：via 这次超时是谁发的、cmd 是哪条 gh
  //   子命令、waitedMs 在名额队列里等了多久、phase 到点发生在哪一段（queue 还在排队没起进程 /
  //   inflight 进程已经起来）。为什么要有：「面板所有功能超时」时四类超时行从前长得一模一样，
  //   分不清是守在门口排到超时，还是命令自己跑到超时。
  'gh.timeout': ['argv0', 'timeoutMs', 'layer', 'via', 'cmd', 'waitedMs', 'phase'],
  'gh.resolve.fail': ['hasDSH_GH_PATH', 'errorHash'],
  'graphql.fallback': ['scope', 'reason'],
  'issues.fallback': ['from', 'to', 'reason'],
  // 2026-10-20（#1295）常驻 #10 `snapshot.built` 增补一格 `specs`：这一份快照里判成规格（实施地图）的容器有几个。
  //   为什么要有：`maps` 是容器总数（探索地图与规格都住在 maps 数组里，数组名是历史名），只有总数时分不清
  //   「这一份里根本没有规格」与「有规格却没认出来」；`specs` 与 `maps` 配对读：specs=0 且 maps>0 说明
  //   这一轮一张规格都没认出来（识别或数据来源问题），specs=maps 说明全是规格、没有探索地图。
  //   只记计数：容器键名、标题一个都不记。落点两处：src/host/snapshotEnvelope.ts 与 src/refresh/rooms/host/session-refresh-schedule.ts 的 adoptSnapLog。
  'snapshot.built': ['maps', 'specs', 'issues', 'labels', 'fallback', 'latencyMs', 'open', 'closed', 'partial'],
  'probe.eval': ['repoKeyHash', 'since', 'count', 'changed'],
  'panelSync.eval': ['repoKeyHash', 'baseline', 'dirty', 'failures'],
  'panelSync.dirty': ['cwdHash', 'ageMs'],
  'registry.select': ['cwdHash', 'backendId', 'source', 'latencyMs', 'caller'],
  'registry.stub': ['op', 'backendId'],
  // 2026-10-14（#1048）：常驻 #16 `detection.detect` 从「判定链条上的一处埋点」改成「统一判定出口
  //   每个工作区一条结论」，字段随之增补六键：origin 这条结论来自哪一层（workspace-file 工作区文件 /
  //   declaration 声明文件 / autodetect 各房认领）、state 三态（decided 判到了 / no-backend 确实没有 /
  //   undetermined 判不出来）、latencyMs 这一趟判了多久、conflict 有没有互相矛盾的两处认领（空串表示没有）、
  //   gap 判不出来时那一档的名字（空串表示没有这一档，取值见结果里的 gap.id）、coverage 这一趟真看了哪几层
  //   （形如 checked=workspace-file,declaration;skipped=autodetect:skipped-stronger-evidence）。
  //   后两键的意义：三态与档位必须与返回给调用方的那一份**同源**（从前结论线按赢家现推，四类「判不出来」
  //   的场景日志写 no-backend、结果写 undetermined —— 日志在骗人），覆盖度则回答「没发现矛盾是真没有，
  //   还是这一层根本没看」。原有五键一个不改：cwdHash 工作区散列、explicit 是不是文件里明写的、
  //   matches 命中数、pending 待定、selection 选中结果。落点由 src/refresh/rooms/host/check-chain-evaluation.ts 挪到
  //   src/tracker/detection/backendDecision.ts（出口一处）。
  'detection.detect': ['cwdHash', 'explicit', 'matches', 'pending', 'selection', 'origin', 'state', 'latencyMs', 'conflict', 'gap', 'coverage'],
  // 2026-10-14（#1048）新增按需 #98 `detection.step`：判定链每一步一行（看了哪一层、这一层什么结论、
  //   花了多久、为什么），只在调试开关打开时记；结论线（常驻 #16）不开开关也有。字段五个，全是短枚举、
  //   数字与后端标识，不记路径原文：step 哪一步（workspace-file / declaration / autodetect / claim-order）、
  //   outcome 这一步的结论、backendId 这一步认下的后端（没有记空串）、ms 这一步花了多少毫秒、reason 为什么。
  'detection.step': ['step', 'outcome', 'backendId', 'ms', 'reason'],
  // 2026-10-14（#1131）新增按需 #99 `detection.cache.hit`：探测服务这一次没有重算，直接把上一次的
  //   判定结果回给了调用方（命中了工作区缓存）。为什么定按需：每一次探测调用都可能落一行，属高频，
  //   所以调用处先判一次调试开关（logCtx.isEnabled('debug') 为真才 fire），关闭时连字段对象都不组装；
  //   不采样 —— 存储层那条 #17 workspaceStore.hit 有 1/100 采样，采样漏掉的那几趟正好是排查
  //   「改色电话为什么拿到了旧结论」时最需要的，这一条把它补上。字段三个，全是散列、字符串与数字，
  //   不记路径原文、不记后端内容：cwdHash 工作区键的短散列、caller 这一次是哪个调用方来问的
  //   （例如 wf.listLabels、detection-service）、ageMs 这一格缓存存了多久（毫秒）。落点：
  //   src/tracker/detection/detectionService.ts 的 detect 命中工作区缓存、直接返回上一次结果的那一支。
  'detection.cache.hit': ['cwdHash', 'caller', 'ageMs'],
  // 2026-10-14（#1048 收口补做）新增按需 #105 `detection.fallback`：早快照的兜底这一趟 —— 只有探测服务
  //   根本没给出结论（缺席或抛错）时，才直问注册表那条路的记录。为什么不借用常驻 #16 `detection.detect`：
  //   那不是同一件事，硬塞进去会让读日志的人以为出口答了两遍；出口那条结论线在自己的路径上照发。
  //   字段：cwdHash 工作区键的短散列、backendId 兜底这一趟拿到哪个后端、source 这个结论从哪来、
  //   pending 是不是还有房没答完、why 为什么要走兜底（service-missing / service-no-selection /
  //   service-threw，注册表也抛错时写成 `服务那一档+registry-threw`）、errorHash 抛错时的错误散列、
  //   latencyMs 这一次兜底问了多久。全是枚举、布尔、散列与数字，不记路径原文、不记上游报错原文。
  'detection.fallback': ['cwdHash', 'backendId', 'source', 'pending', 'why', 'errorHash', 'latencyMs'],
  // 2026-10-14（#1054）新增四条：关系（父子边与阻塞边）写入这一族的轨迹。为什么要有它们：
  //   写一条边要跨出进程问远端（原生旗或裸接口），而落点从前只有 gh.exec 那一层「命令跑了、退出码几」，
  //   回答不了「这条边到底挂上没挂上、走的哪条路、为什么没写成」—— #1100 报的「补边整批中止、
  //   一条都没落」正是从这个盲区里来的。
  //   ① 常驻 #100 `edge.write`（信息级）：setParent / setBlockedBy 各一趟一行，成功与失败都记。
  //      为什么定常驻：边是人和 AI 的显式动作（一次建图十几步），查「这条边怎么没挂上」的人不会先打开调试开关。
  //      允许字段八个，全是枚举、布尔与计数，**票号、命令原文、上游报错原文一个字都不记**：
  //      kind 这一次写的是父子边还是阻塞边（parent / block）、route 走的哪条路（none 没走到外部调用 /
  //      flag 原生旗 / rest 裸接口）、ok 成没成、added 真落了几条、removed 真撤了几条、
  //      kept 对账之后发现「本来就在位」几条（含上游回 already been taken 的那几条）、
  //      reason 为什么是这个结论（noop / added / removed / diff / fail:<档位>）、latencyMs 这一趟花了多久。
  //   ② 按需 #101 `edge.cycle`（调试级）：成环检查一趟的结论。为什么定按需：写一条阻塞边就可能查一次。
  //      字段四个：verdict 结论（ok 没成环 / conflict 成环 / unknown 邻接关系没取到、这一趟按不成环放行）、
  //      nodes 邻接表里几张票、blockers 这一次拟写入几条边、latencyMs。
  //   ③ 按需 #102 `edge.roster`（调试级）：邻接关系从哪儿来。字段四个：source 来源
  //      （roster 名册 / full-scan 整仓拉取 / none 一条都没走通）、complete 名册拿全没有、dirty 待定向重读几张、latencyMs。
  //      这个键叫 source 而不叫 path：#1054 初稿用了 path，而第四段的「原文类键名」名单里就有 path，当场红。
  //   ④ 按需 #103 `edge.repair`（调试级）：REST 降级回包里那次树边修复。字段四个：
  //      maps 这一趟问了几张地图、linked 认下几条子票边、failed 哪几张地图没补成、latencyMs。
  //   三条调试线都在调用处先判一次 `isEnabled('debug')`，关闭时连字段对象都不组装。
  //   落点：src/tracker/rooms/github/graph.ts（edge.write、edge.cycle）、cycle-check.ts（edge.roster）、
  //   parent-repair.ts（edge.repair）。
  'edge.write': ['kind', 'route', 'ok', 'added', 'removed', 'kept', 'reason', 'latencyMs'],
  'edge.cycle': ['verdict', 'nodes', 'blockers', 'latencyMs'],
  'edge.roster': ['source', 'complete', 'dirty', 'latencyMs'],
  'edge.repair': ['maps', 'linked', 'failed', 'latencyMs'],
  // 2026-10-14（#1053）新增常驻 #104 `issue.write`：写一张票这一趟的结论 —— 写没写下去、走的哪条路、
  //   为什么，一趟一行，成功与失败都记。为什么要有它：这一族从前只留下 gh.exec 那一层「命令跑了、
  //   退出码几」，而 gh.exec 的 argv0 是写死的字符串 `gh`、kind 记的是结果档位（network / cancelled /
  //   env / ok 或归一后的错误档位），于是建票的 `gh api --method POST` 与查票的 `gh api` 落下来长得
  //   一模一样，回答不了「这张票怎么没建上」「是不是建重了一张」「幂等锚命中复用了吗」「标签、认领、
  //   父边补挂了没有」；工具层的 host.call 记的是电话名（`deck.issueCreate` 这类），说的是「哪一类操作」，
  //   也说不出走了哪条路、停在哪一步。
  //   为什么定常驻：写票是人和 AI 的显式动作（一次会话几条到几十条），查这类问题的人不会先打开调试开关，
  //   而它是这一族里唯一一条「写没写下去」的结论线。无外层判断，成功与失败都记一行。
  //   允许字段七个，全是枚举、布尔与计数，**票号、票面标题正文、命令原文、上游报错原文一个字都不记**：
  //   kind 这一次写的是哪一件事（create 建票 / close 关闭 / reopen 重开 / update 改票 /
  //   setAssignees 改认领 / comment 评论 / setLabels 贴标签）、route 走到哪一层（none 没走到外部调用 /
  //   rest 走 gh api / cli 走 gh issue 子命令）、ok 成没成、written 真发出去几条写命令、
  //   failed 建完票之后补挂标签、认领、父边没挂上的步数、reason 为什么是这个结论
  //   （fresh 真新建 / reuse 幂等锚命中复用 / edited 改了已有票 / noop 一处没改 /
  //   partial 写成了但有补挂没挂上 / fail:<档位>）、latencyMs 这一趟花了多久。
  //   落点三处：src/tracker/rooms/github/write-log.ts 的 emitIssueWrite（一趟一行），由同目录的
  //   issues-write.ts（建票、关闭、重开、改票、改认领五件事）、comments.ts（评论）、labels.ts（贴标签）
  //   各调一次。同一天同一票增补的 #106 labelDefs.write 与 #107 repo.init 与它共用同一份机制，
  //   把同一片写路径剩下的两族（标签配色、开仓发布）也接上了结论线。
  'issue.write': ['kind', 'route', 'ok', 'written', 'failed', 'reason', 'latencyMs'],
  // 2026-10-14（#1053 增补）新增常驻 #106 `labelDefs.write`：仓库里的标签定义（名字、颜色、说明）改一趟的
  //   结论 —— 打算动几个、真发出去几条、几条没改上、成没成、为什么，一趟一行。为什么要有它：这一族从前只
  //   留下常驻 #60 labelColors.write（那一条记的是「本地配色文件写没写下去」，与「远端标签颜色改没改上」是
  //   两回事）与 gh.exec 那一层「命令跑了、退出码几」，回答不了「这次要动几个、真改上几个」。
  //   为什么定常驻：批量改色是用户点一次才发生一次的显式动作，查它的人不会先打开调试开关；无外层判断。
  //   允许字段六个，全是枚举、布尔与计数，**标签名、颜色值、命令原文、上游报错原文一个字都不记**：
  //   planned 打算动几个、written 真发出去几条、failed 几条没改上、ok 成没成、
  //   reason 为什么（edited 都改上了 / partial 有的改上有的没改上 / allfailed 一条都没改上 /
  //   noop 一条都不用改 / fail:<档位>）、latencyMs 这一趟花了多久。
  //   落点一处：src/tracker/rooms/github/label-colors-ops.ts 的 emitLabelDefsWrite（setLabelColors 这个
  //   对外入口调一次，一趟一行）。
  'labelDefs.write': ['planned', 'written', 'failed', 'ok', 'reason', 'latencyMs'],
  // 2026-10-14（#1053 增补）新增常驻 #107 `repo.init`：把工作区初始化并发布成 GitHub 仓库这一趟的结论 ——
  //   走的是新建仓库还是推到已有远程、这一趟一共起了几条外部命令、成没成、为什么，一趟一行。
  //   为什么要有它：这一族从前只留下按需 #58 exec.run 与宿主电话 wf.initPublish 的一行 host.call，
  //   出「仓库到底建没建起来、卡在推之前还是推之后」这类问题时读不出一条结论线。为什么定常驻：
  //   开仓是用户点一次才发生一次的显式动作，查它的人不会先打开调试开关；无外层判断。
  //   允许字段五个，全是枚举、布尔与计数，**仓库名、远端地址、命令原文、上游报错原文一个字都不记**：
  //   route 走的是新建远程仓库（created）还是推到已有远程（existing）、steps 这一趟一共起了几条外部命令
  //   （走到第几条）、ok 成没成、reason 为什么（done 走完了 / fail:<档位> 停在哪一档）、latencyMs 花了多久。
  //   落点一处：src/tracker/rooms/github/init-project.ts 的 emitRepoInitWrite（initProject 这个对外入口
  //   调一次，一趟一行；execProcLocal 与 ghStep 各计一步 steps，两条分支各写 route）。
  'repo.init': ['route', 'steps', 'ok', 'reason', 'latencyMs'],
  'workspaceStore.hit': ['keyHash', 'fresh', 'ttlMs'],
  // 2026-09-25 登记订正（#709 · T5）：这一条的落点已经变成「被退避挡下，直接把上一份快照回给界面」，
  //   实现记的是 keyHash、lang、deferred、reason、waitMs 五个键；从前的 ageMs 早已不再发射，
  //   按「允许字段就是能记的全部字段」的口径把它从白名单里去掉（落点：src/refresh/rooms/host/check-chain-evaluation.ts）。
  'chain.cache.hit': ['keyHash', 'lang', 'deferred', 'reason', 'waitMs'],
  'chain.predicate': ['id', 'status', 'latencyMs'],
  'skill.probe': ['name', 'level', 'via'],
  'skill.pending.cap': ['name', 'attempts', 'max'],
  'workspaceKey.canonical': ['rawHash', 'normalizedHash', 'fallback'],
  'platform.resolve': ['name', 'ok', 'latencyMs'],
  'naming.sweep': ['trigger', 'count'],
  // 2026-10-21（#1006 复核）常驻 #26 host.call 增补一格 reason：deck.quotaSync 同步失败那一行带原因码
  //   （sync-empty 读不出读数 / sync-threw 这一趟抛了 / ensure-threw 入口兜底）；#1355 起因缺本会话工作路线表而发的
  //   强制补拉也带 reason=work-route-missing。为什么要有：从前这些分支只回原因码、日志里一个字不留，事后查不出原因。
  'host.call': ['method', 'latencyMs', 'ok', 'kind', 'pluginId', 'opId', 'cwdHash', 'reason'],
  // 2026-10-14（#1052 续）`host.call` 与 `host.call.fail` 各增补两格：`opId` 与 `cwdHash`。
  //   为什么要有：一趟操作在日志里落成两层——宿主这一层说「调了哪条电话、成没成、花了多久」，
  //   房间那一层（gh.exec / read.degraded）说「里面起了哪几条外部命令、走到哪一支」。两层从前没有
  //   共同的键，排查时只能按时间戳排；同一时间有几趟读并行就分不清哪几行是一伙的。
  //   `opId` 是宿主起这一趟时生成的编号（形状 `<base36 毫秒时间戳>-<base36 计数器>`，例如 mg8xk1p-3），
  //   房间那一层靠 `ctx.opId` 取到同一个值，于是两层能对上；`cwdHash` 与房间那一层同一个算法，
  //   用来认「这一趟是给哪个目录干的」（两边都只记散列，路径原文一个字都不记）。
  //   谁在发：本仓每份宿主文件各有一份自己的 phoneLog，各自决定记不记。到 2026-10-14 为止，
  //   `src/host/mapTickets.js` 这一份已经带上这两格（票面点名的读路径就是它），其余几份按
  //   「谁动到谁补」的口径走——两格都是可选的，没带的那些照旧只记原来那几个键，行为与从前一字不差。
  'host.call.fail': ['method', 'kind', 'errorHash', 'pluginId', 'errorKind', 'opId', 'cwdHash'],
  'snapshot.hydrate': ['cwdHash', 'fresh', 'latencyMs', 'source', 'winnerVersion', 'loserVersion', 'outcome'],
  'snapshot.fanout': ['sessionIdHash', 'stale', 'force', 'count'],
  'dedup.hit': ['scope', 'keyHash'],
  'backend.switch': ['from', 'to', 'cwdHash'],
  'naming.guard': ['sidHash', 'outcome', 'hintHash'],
  'naming.lock': ['sidHash', 'reason'],
  'naming.summary': ['sidHash', 'outcome'],
  // #782 新增一条常驻事件（附录 1.4 节 #92 `cwd.persisted`）：落盘补问那一次的结论 ——
  //   问没问到（hit 布尔）、花了多久（latencyMs 数字）、走的哪条路（via 枚举 cache 缓存命中 /
  //   persist-open 按号直读 / query-filter 老查询过滤回退 / unavailable 两服务都没有）、
  //   结果是哪一档（outcome 枚举 hit 问到 / not-found 盘上没有或头里没目录 /
  //   no-service 两服务都没有 / error 打开或查询抛错）。只记布尔、数字与枚举，
  //   不记路径原文、不记会话号原文。落点一处：src/host/sessionLifecycle.js 的 persistedCwdOf。
  'cwd.persisted': ['hit', 'latencyMs', 'via', 'outcome'],
  // 2026-09-21：settings.save 随设置页的「打开位置」一项退役（那是它唯一的落点）；
  //   panel.open 去掉 mode 字段（面板只有 DSH 原生右侧边栏一条路，形态不再有第二种取值）。
  'panel.open': ['hasCache', 'snapFresh', 'keyHash', 'snapVersion', 'backendId'],
  'statusbar.hydrate': ['cwdSource'],
  // 2026-10-22（#1395）statusbar.fallback 增补两格：胶囊「工作路线」那一段画不画的判据结论从三档扩到六档
  //   （补 work-route-idle 有快照但还没有工作路线表 / work-route-empty 有表但没有本会话的行 /
  //   work-route-unreadable 工作路线表读坏了），另记 tableRows 这张表一共几行、ownRows 其中标了本会话的几行
  //   （没有表时两格都记 -1）。为什么要有：出事时日志里只有前三个 reason，分不清「还没有快照」与
  //   「有表但没有本会话的行」，而这两种分别指向补拉链路与「这张表是谁算的」两条完全不同的修法。
  //   只记枚举与计数，不记票号、路径、会话号原文。
  // 2026-10-23（#1436）再补两档：work-route-loading 还在读本机存档、胶囊在转圈；work-route-off 本机读法
  //   暂时不可用、已安静退回旧快照。字段不变，仍只有 reason / tableRows / ownRows 三格。
  'statusbar.fallback': ['reason', 'tableRows', 'ownRows'],
  'dock.rehydrate': ['sidHash', 'cwdChanged', 'polluted'],
  'storage.fail': ['key', 'op'],
  'chain.derive.error': ['stepId', 'errorHash'],
  'fallback.chain': ['in', 'out', 'latencyMs'],
  // 2026-10-14（#1111）：判档改成按证据分层之后，归一埋点由 src/tracker/kernel/error-rules.ts 的 emitNormalize
  //   统一发射，字段就是下面这八个键：五个必带（rawKind 原始类别、mappedKind 归一后的档位、layer 这条档位
  //   由哪一层证据给出、via 这条规则来自通用表还是各家扩展项、latencyMs 判这一趟花了多少毫秒），
  //   三个只在真有对应事实时带（httpCode 状态码、exitCode 退出码、errCode 错误码名）。
  'error.normalize': ['rawKind', 'mappedKind', 'layer', 'via', 'latencyMs', 'httpCode', 'exitCode', 'errCode'],
  'timer.schedule': ['name', 'intervalMs'],
  'chain.cache.miss': ['keyHash', 'lang', 'reason'],
  'workspaceStore.miss': ['keyHash', 'reason'],
  'client.snapshot.hit': ['keyHash', 'ageMs', 'kind'],
  'client.snapshot.miss': ['keyHash', 'reason'],
  'detail.cache.hit': ['numHash', 'ageMs'],
  // #606 新增两条按需事件（附录 1.5 节）：exec.run 记经 ctx.exec 起的外部命令，panel.render 记面板打开各阶段耗时。
  'exec.run': ['argv0', 'cwdHash', 'latencyMs', 'exitCode', 'via'],
  // mode 仍在白名单里，但只剩更新面板那条线在用（views/useUpdatePanel.js 记 mode:'update'，
  //   用来把它自己的阶段推进与「打开面板那一路的阶段」分开）；面板打开那一路（kernel/router.js 的
  //   logPanelStage）自 2026-09-21 起不再记 mode —— 面板只有一条路之后它没有第二种取值。
  'panel.render': ['stage', 'ms', 'mode'],
  'host.start': ['pid', 'startedAt', 'dir'],
  'update.install.exec': ['route', 'ok', 'exitCode', 'durationMs', 'pluginId'],
  // 2026-10-01 新增一条常驻事件（附录 1.4 节）：装更新返回后，代码横幅版本已是目标版本而身份证还旧时，把身份证补成真实版本；只记标识与两个版本号。
  'update.install.manifestSync': ['pluginId', 'fromVersion', 'toVersion'],
  'privacy.scrub': ['field', 'rule', 'hit'],
  // #618 新增两条（附录 1.4 / 1.5 节）：本地配色文件的写入记常驻、读取记按需。
  'labelColors.write': ['cwdHash', 'count', 'ok', 'reason', 'via'],
  'labelColors.read': ['cwdHash', 'present', 'count', 'ok', 'reason'],
  // #635 新增一条按需事件（附录 1.5 节）：保存成功后写进面板那份快照的颜色记录，只记工作区键散列、枚举与条数。
  'labelColors.panelPatch': ['cwdHash', 'kind', 'count'],
  // 2026-10-09 新增一条按需事件（#958，附录 1.5 节 #97）：调色盘弹窗权威清单进界面状态时记一行，只记行数、被过滤行数与行名散列，名字原文一个字都不记。
  'labelColors.listed': ['cwdHash', 'count', 'empty', 'namesHash'],
  // #652 新增一条按需事件（附录 1.5 节）：工作区根判定与它那层 30 秒缓存，只记两个散列与两个枚举。
  'workspaceRoot.resolve': ['cwdHash', 'rootHash', 'source', 'cache'],
  // #655 新增一条按需事件（附录 1.5 节）：初始化这段文案「这次该不该注入、按哪种布局注入」这个决定的结果，只记三个枚举。
  'inject.decision': ['prompt', 'kind', 'layout'],
  // #663 新增一条常驻事件（附录 1.4 节）：首开引导链那颗横幅按钮点下去给出去的是哪一类东西，只记两个短枚举（哪一步、哪一类）。
  'guide.inject': ['step', 'outcome'],
  // #685 新增一条常驻事件（附录 1.3 节）：KPI 那一行右边缘那颗「体检」按钮点下去，开一个新会话并把当前后端的体检提示词
  //   带过去 —— 照 #662 为横幅注入定的先例（用户点一下、插件往会话里写字），只记两个短枚举：哪个后端、注入成功还是失败。
  'healthCheck.inject': ['backend', 'outcome'],
  // 2026-09-21 新增一条按需事件（附录 1.5 节）：链快照回包时晚到的旧结果被丢弃（这一段里已经又发过新请求），只记一个散列。
  'chain.stale.drop': ['keyHash'],
  // 2026-09-21 新增一条按需事件（附录 1.5 节）：面板快照回包时这一次已经不算数（换过后端，或这个工作区上又发过更新的一次），只记一个散列。
  'snapshot.stale.drop': ['keyHash'],
  // 2026-09-27 新增一条按需事件（#727，附录 1.5 节 #89）：那次快照已经等超时了、可它后来还是回到了
  //   （客户端那条 30 秒死线只结束「这一次等待」，不判「这份结果作废」），这条轨迹记的是「这一小块补装上了没有」。
  //   两个键都好查也不会泄露东西：keyHash 是请求发出时那条目录的短散列，installed 是布尔（真的装上了才算）。
  'snapshot.late.install': ['keyHash', 'installed'],
  // 2026-09-28 新增一条按需事件（#776，附录 1.5 节 #91）：六组嫌疑的统一观测口 ——
  //   安装份数、发送遍数、节拍间隔、折叠耗时、缓存分支、列宽。只记枚举、数字与散列，信号两处不带键。
  'input.observe': ['kind', 'count', 'latencyMs', 'keyHash'],
  // 2026-09-22 新增五条（#683 F1 · 宿主侧那份「用户选的后端按工作区记着」的记忆）：读它命中/未命中按需记；
  //   文件坏与写失败是「出事了」的两档，告警级始终落盘；淘汰与「被更旧的顶回」按需记。都只记散列、枚举与数字。
  'choiceStore.read': ['keyHash', 'outcome'],
  'choiceStore.file.bad': ['reason'],
  'choiceStore.write.fail': ['keyHash', 'reason'],
  // 2026-10-12 退役一条：choiceStore.hint.reject（#1003 把上报优先与修订号仲裁从判定链里删掉之后，
  //   这一档在代码里不再存在；原行保留在附录里只作追溯，本表不再要求它有落点）。
  'choiceStore.evict': ['count', 'max'],
  // 2026-09-22 新增一条常驻事件（#690，附录 1.4 节）：界面向后端要一页历史票（展开折叠行 / 筛到已关闭 / 滚到底）。
  //   只记这一页要的是哪一档状态、筛了几个标签、取回几行、后端说一共多少行，以及耗时、成没成与失败散列。
  'issues.page': ['state', 'labelsCount', 'returned', 'total', 'latencyMs', 'ok', 'errorHash'],
  // 2026-09-23 #706（T2 第二批）新增三条按需事件（附录 1.5 节 #75～#77）：闸与账本自己产生的三条轨迹 ——
  //   一笔花费（哪一档、哪个桶、几条真实出站请求、几点、记完还剩多少）、一次裁决（类别、种类、结论、原因代号、档位）、
  //   一次跳过（工作区键散列、种类、原因、推迟队列里现在几条）。都只记枚举、散列与数字，不记路径原文与命令原文。
  'quota.spend': ['account', 'bucket', 'requests', 'points', 'remaining'],
  // 2026-10-21（#1008/#1218 复核）按需 #76 refresh.decide 与 #77 refresh.skipped 在「这个工作区还处在
  //   连续失败窗口里」时增补五个归因键，窗口外一个都不带（正常时段的这两行与从前一字不差）：
  //   failuresSinceSuccess 连续失败几次、backoffWindowStartedAt 这串从什么时候开始、lastFailureCategory 最近一次
  //   是哪一类、lastFailureKind 最近一次是什么种类、failureStreak 连续第几次。
  //   为什么要有：从前只记「推迟了」与推迟原因，回答不了「这 3 次是谁攒的」——同一窗口里可能既有登录失败又有网络失败。
  //   五个值都来自闸自己的记忆（src/refresh/rooms/host/refresh-gate.ts 的 WorkspaceState），不查账本、不联网。
  'refresh.decide': ['category', 'kind', 'verdict', 'reason', 'tier', 'cycle', 'keyHash', 'failuresSinceSuccess', 'backoffWindowStartedAt', 'lastFailureCategory', 'lastFailureKind', 'failureStreak'],
  'refresh.skipped': ['keyHash', 'kind', 'reason', 'pending', 'failuresSinceSuccess', 'backoffWindowStartedAt', 'lastFailureCategory', 'lastFailureKind', 'failureStreak'],
  // 2026-09-23 #708（T4 第三批）新增一条按需事件（附录 1.5 节 #82）：一次行级增量跑完之后的结论 ——
  //   这一次走的是哪一档（补那几条薄查询 / 该整池 / 没变 / 被推迟 / 过期丢弃）、为什么、变了几行、
  //   真发出去几条薄查询、水印推没推、待办里现在几条。只记短散列、枚举与数字，不记路径与命令原文。
  'refresh.patch': ['keyHash', 'mode', 'reason', 'changed', 'queries', 'watermark', 'pending'],
  // 2026-09-23 #707（T3 第二批）新增两条按需事件（附录 1.5 节 #78～#79）：视野模型自己产生的两条轨迹 ——
  //   一次上报（哪一种信号、窗口散列、工作区根散列、面板可不可见、这一笔算不算数）、
  //   一次收摊结论（活跃几个、保留几个定时器、停掉几个、有没有一个收尾节拍、整桌收没收、正在看的几个）。
  //   都只记枚举、散列与数字：心跳每 20 秒一次，所以上报那条按十取一采样。
  'attention.report': ['kind', 'windowHash', 'rootHash', 'visible', 'accepted', 'deduped'],
  'attention.sweep': ['active', 'keep', 'cancel', 'linger', 'collaped', 'keepers'],
  // 2026-10-19 #1083：旧链那条常驻 #80 sessionTickets.chain 退役 —— 工作路线整套换成新的存档之后，
  //   旧链落盘那一路不再发日志，换成下面两条常驻（附录 1.4 节 #110、#111）。写这一侧一趟一行：
  //   记一笔进链、释放一条（#1086 补：只删不记，写盘时的 action 固定是 release，只说明这次写盘
  //   是为了删一条，不是工作条目里的动作）、把整份写盘、写后读回核对、按保留期与体积裁旧，五类 kind 各一处；
  //   读这一侧只在读盘失败那一档记一行（文件不存在是第一次用的正常情况，不记）。
  //   why 是失败原因的短代号（rename-unavailable / rename-failed / privacy / write-failed /
  //   readback-bad / read-failed / threw，成功是空串）；detail 是给人指的简短说明 —— 隐私命中时是
  //   「$.workers[0].entries[0].title：像 GitHub 令牌」这种字段路径加原因，别的时候是错误类名或空串，
  //   被拦下的值本身一个字符都不进日志。count 除 prune 是裁掉的条数外，都是本会话条数（release 也是）。
  'workRoute.write': ['sidHash', 'rootHash', 'kind', 'ok', 'action', 'count', 'why', 'detail'],
  'workRoute.read': ['sidHash', 'rootHash', 'ok', 'why', 'detail'],
  // 2026-09-23 #710（T6 第二批）新增一条按需事件（附录 1.5 节 #81 `write.event`）：写事件订阅自己产生的轨迹 ——
  //   一次成功的工具调用被判成哪一档、凭什么判的、接下来要做什么、票号认没认出来、从哪条订阅路来的。
  //   只记一个散列、三个枚举与一个布尔：**命令原文一个字都不记**（参数只做瞬时匹配），也不记票号本身。
  'write.event': ['keyHash', 'shape', 'tool', 'tier', 'reason', 'action', 'hasTicket', 'cycle', 'result', 'waitedMs'],
  // 2026-10-20 刷新排查新增（附录 1.5 节 #118）：一次取数的结论与花费 —— 与上面那行 write.event 用 cycle 串起来；
//   2026-10-24 #1445 起写事件不再过闸：sent 表示「已交给管线」、verdict 恒 in-pipeline、requests/points 恒 0（读路径不记账，真实用量归 #1446）；
  //   上面那行只能说明「判成了什么、有没有被合并窗口吃掉」，走到闸之后的结论（发出/降档/推迟、花几点了）等闸回来才知道。
  'write.sent': ['keyHash', 'cycle', 'kind', 'sent', 'verdict', 'reason', 'requests', 'points', 'latencyMs'],
  // 2026-10-21 本次界面反馈需求新增（附录 1.5 节 #119）：用户点了页面上的哪一颗按钮 —— target 是同屏唯一的稳定英文枚举，
  //   kind 是按压形状枚举；两者都由 kernel/ui-feedback.ts 从 data-log / data-press 属性读出并限字符，不记按钮文字。
  'ui.action': ['target', 'kind'],
  // 2026-09-25 登记收口（#709 · T5 与并行各票新增的埋点，附录 1.4 / 1.5 节 #83～#87）：这五条在代码里
  //   早就发出去了，只是登记没跟上，本票把它们如实补进白名单。字段是各落点的并集（本表的既有口径：
  //   允许字段就是「这个事件名能记的全部字段」）：
  //   · chain.backoff 定常驻 —— 那条 8 秒自续循环拆掉之后，宿主侧不再有任何自续定时器，「这次为什么
  //     没查 / 还在等多久」只能靠这一条回答，而查它的人不会先打开调试开关；另外两处同族落点记的是
  //     它的子集，且都在同一行先判调试开关。
  //   · 其余四条都是调试级按需，同一行先判开关，字段只取散列、枚举、数字与布尔。
  'chain.backoff': ['keyHash', 'decision', 'reason', 'waitMs', 'step', 'trigger'],
  'chain.cache.write': ['keyHash', 'allGreen', 'doneCount', 'step', 'progressed'],
  'chain.event': ['reason'],
  'naming.guard.event': ['reason'],
  'chain.preflight.reuse': ['cwdHash', 'checks', 'reused', 'userAction'],
  // 2026-09-25 #724 新增一条常驻事件（附录 1.4 节 #88 `host.dispatch.empty`）：处理函数回话了、回话里却没有
  //   可用内容 —— 分发这一层唯一看得见这种形状的地方。三个键都是短的：哪条电话（method）、哪一种形状
  //   （shape：no-value / null-value / no-error，也就是缺的是哪一个键）、服务这一份的版本（version，
  //   读不到就是 unknown）。不记入参原文、不记回话内容、不记路径；业务性的正常失败回参不触发它。
  'host.dispatch.empty': ['method', 'shape', 'version'],
  // 2026-10-04 新增两条常驻事件（#817，附录 1.4 节 #94 / #95）：版本管理宿主侧 git 适配器每跑一次 git 外部命令落一行。
  //   git.exec 记成功与非零退出（只记命令名、工作目录散列、耗时、退出码与来源标记，命令输出正文一个字都不记）；
  //   git.exec.fail 记等超时与起进程失败两档（等超时那条带 timeoutMs，起进程失败那条带 errorHash，两条都带 cwdHash 与 via）。
  //   都只记短的枚举、散列与数字：不记命令行原文、不记路径原文、不记任何命令输出。落点一处：src/host/versionControl.js 的 runGitCommand。
  'git.exec': ['argv0', 'cwdHash', 'latencyMs', 'exitCode', 'via'],
  'git.exec.fail': ['argv0', 'cwdHash', 'via', 'timeoutMs', 'errorHash'],
  // #864 进出缓存：命中、未命中、淘汰三归宿同一事件（只记短散列、枚举与数字；工作区原文、读数内容一律不记）。
  'vc.cache.screen': ['cwdHash', 'outcome', 'ageMs'],
  // 自监控 4 条（#499，附录 1.6 节；#46 走宿主防火发射器 fireLog，调用形状不在本门禁扫描口径内，由 verify-log-selfmon.js 覆盖）。
  'log.persist.fail': ['op', 'reason', 'dirHash'],
  'log.forward.summary': ['droppedDelta', 'totalDropped', 'reason', 'windowMs'],
  'log.switch.watchdog': ['op', 'timeoutMs', 'stage'],
  'log.export.fail': ['op', 'reason', 'errorHash'],
  // 2026-10-20 #1294（T3 界面词表搬到 config/copy/）：插件激活时按语言清单把 dsws 命名空间逐门语言注册进宿主 locale 服务，
  //   原来这一趟一条日志都没有 —— 加完语言后成没成、卡在读快照 / 新增语言 / 注册词表哪一步、界面为什么退回缺省语言，
  //   事后只能猜。两条各记一半：
  //   · locale.registration 记这一趟的结论（几门语言、新增几门、宿主本来就有几门只补词表、缺省语言、耗时），定按需：
  //     激活时只发生一次，低频，调试开关打开才落盘；
  //   · locale.registration.fail 记失败那一步（stage 三档枚举、哪门语言、这一门该回退到哪门、错误原文散列），定常驻：
  //     注册失败会让界面语言整体退档，出问题时必须不用打开调试开关就能看见。
  //   只记数字、语言 id、枚举、布尔与散列：界面文案原文、词表键名、语言的显示名一个都不记。
  'locale.registration': ['langCount', 'addedCount', 'skippedCount', 'defaultLang', 'latencyMs', 'ok'],
  'locale.registration.fail': ['stage', 'lang', 'fallback', 'errorHash'],
  // 2026-10-20（#1295）：新增按需 #114 `container.split`。列表页把每张票分进四个桶之后原来一条日志都不留，
  //   出「这张规格怎么排在普通票堆里」「行画成地图、顺序却按普通票」这类问题时，分不清是分桶判错还是画错。
  //   这条记这一轮分桶的四个计数（标签筛选之前的分桶数），外加 degraded：容器种类判定有没有退回文件内兜底
  //   （false 内核 containerKindOf 在作用域内、正常；true 退回了兜底，此时四个桶本身可能不准，先查构建与拼接，
  //   别去查数据），以及 genMs：这一份快照的生成时刻，用来与同一份快照的宿主侧 #10 snapshot.built 对账。
  //   定按需：列表页每份快照都会走一遍，属界面渲染路径上的高频点，调试开关关闭时一行都不记；挂「按快照指纹
  //   只跑一次」的副作用里，且四组条数与 degraded 都没变化时不重复落行（切页签、改筛选会再跑一趟，但没有新信息）。
  //   字段名不用 maps/specs：那一对在 #10 snapshot.built 里是「容器总数 / 其中规格数」，含义不同，同名会误读。
  //   票号、标题、容器键名一个都不记。落点 src/client/views/ListTab.ts。
  'container.split': ['explore', 'spec', 'plain', 'closed', 'degraded', 'genMs'],
  // 2026-10-20（#1296）：新增按需 #115 `container.accent`。两套容器的身份色收进中央色表
  //   src/client/kernel/container-view.ts 的 CONTAINER_ACCENT 之后，宿主对账完成、调试开关确认为开时
  //   记一行本份构建产物里中央色表实际取到的两色：explore 是 map 值、spec 是 spec 值。
  //   排查「改了中央色表却没生效」时拿它跟工作区源码对照：记出来的两色与源码不一致，说明浏览器里跑的
  //   是旧构建产物；两色一致却仍看不出变化，说明改的不是这一处（或样式没重新构建），不用再靠猜。
  //   定按需：每次插件激活只对账一次，低频；调试开关关闭时一行都不记。
  //   只记两个设计常量色的字符串，不含路径、标题、凭证。落点 src/client/panelAssembly.ts 的启动对账
  //   之后（等 reconcileLogSwitch 的 Promise 兑现、宿主给出开关值才记；日志契约要求对账前不产生调试日志）。
  'container.accent': ['explore', 'spec'],
  // #1297：入口浮层打开 / 选卡两趟。from 从哪个入口打开的（panel / statusbar）；cards 给了几张卡；
  //   card 选了哪张（map / spec）；ok 开新会话的调用发出去没有；textLen 开场白的长度（只记长度不记正文）。
  'entry.open': ['from', 'cards'],
  'entry.pick': ['from', 'card', 'ok', 'textLen'],
  // 2026-10-21 map 1010 逐票复核（#916/#917）：gh 命令被归成登录态问题时记下归因线索 —— 命中的关键词组、
  //   宿主进程有没有代理变量、有没有换配置目录；不记 stderr 原文与变量值。
  'gh.auth.env': ['signal', 'cwdHash', 'exitCode', 'proxySet', 'ghConfigDir'],
  // 2026-10-21 map 1010 逐票复核（#960）：出站名额排队放行时一行，分开「命令本身慢」与「排队等」。
  'gh.lane.saturated': ['bucket', 'inflight', 'max', 'queued', 'waitedMs'],
  // 2026-10-21（#1101 排查）常驻 #125 gh.lane.wait：排队放行时等到三秒以上才记，同一只桶五分钟
  //   最多一行。与上面那条调试档的 gh.lane.saturated 同一处发射点：那条是逐条明细，这条是常驻摘要。
  //   为什么要有：调试开关默认关着，名额排满的风暴在普通用户日志里一行都不留。
  'gh.lane.wait': ['bucket', 'waitedMs', 'inflight', 'max', 'queued'],
  // 2026-10-21 map 1010 逐票复核（#891/#995/#916/#917）：状态栏黄条出现、消失或换文案时边沿记一行。
  // 2026-10-22（#1363）：黄条「该出没出、该消没消」的判定依据补齐 —— reason 为什么这么判（枚举）、
  //   decideStep 判定落在哪一步、backendId 当时选定的后端、steps 快照里实际有几行、wsHash 与 sidHash
  //   是哪个工作区哪个会话（各 8 位短散列，不记路径原文、不记会话标题）。
  'guide.banner': ['step', 'banner', 'tone', 'outcome', 'ageMs', 'reason', 'decideStep', 'backendId', 'steps', 'wsHash', 'sidHash'],
  // 2026-10-21 map 1010 逐票复核（#891）：活跃探测节拍「没排上」与「排上了」各一行。
  // 2026-10-22（#1363/#1220）提升为常驻：节拍没排上正是「初始化完了黄条还在」的根因，调试开关默认关着时
  //   一行都不留就等于根因永远看不见；timerOk 记这一拍有没有可用的定时器出口。
  'probe.loop': ['reason', 'intervalMs', 'visible', 'timerOk'],
  // 2026-10-21 map 1010 逐票复核（#996）：完成/检查提示词拼链接时记编号形态与链接空不空。
  'prompt.link': ['prompt', 'backend', 'numKind', 'linkKind', 'verdict'],
  // 2026-10-22（#1363）：每一次取环境链的请求与回包各一行（side 请求/回包、outcome 发出去/写进会话/
  //   旧回包丢弃/空回包/出错、reason 这一趟的来路、bypass 有没有绕缓存、backendId、lang、steps 快照里
  //   有几行、done 做完几步、ageMs 回包距发出多久、wsHash 与 sidHash 是哪个工作区哪个会话）。
  //   为什么要有：状态栏不出条时，光看 guide.banner 只知道「没显示」，不知道是没发请求、被退避挡回、
  //   还是回包写不进会话。
  'chain.flow': ['side', 'outcome', 'reason', 'bypass', 'backendId', 'lang', 'steps', 'done', 'ageMs', 'wsHash', 'sidHash'],
  // 2026-10-23（#1409）：界面借会话事件流取数这一层的三条调试线，只记散列与计数，绝不记建议提示词、
  //   理由原文与工具参数原文。suggest.bind 记绑定这一趟的结论（bound 绑上了 / no-service 客户端拿不到
  //   会话服务 / no-session 没有会话号 / no-binding 官方界面还没保持这个会话的订阅 / no-event-source
  //   有绑定却没有事件流 / error 取绑定或订阅时抛了；sidHash 哪个会话；reason 失败分在哪一步）；
  //   suggest.call 记每一次认出来的建议工具调用（seen 认出来在等整轮结束 / dup 同一调用重复到达 /
  //   bad-args 参数不是合法 JSON 或形状不对 / bad-shape 条目形状不对整组丢弃；callIdHash、turn、
  //   items 过滤后剩几条、clipped 被截断几条、reason 坏参数的具体档）；suggest.ready 记交付这一趟
  //   （queued 已收到在等整轮结束 / delivered 整轮结束时交出去 / already-ended 收到时这一轮已结束
  //   当场交出去）。为什么要有：界面不出建议时，光看界面分不清是拿不到事件流、认不出工具调用、还是
  //   等整轮结束的那一步没走到。
  'suggest.bind': ['outcome', 'sidHash', 'reason'],
  'suggest.call': ['outcome', 'sidHash', 'callIdHash', 'turn', 'items', 'clipped', 'reason'],
  'suggest.ready': ['outcome', 'sidHash', 'callIdHash', 'turn', 'items'],
  // 2026-10-24（#1444 收口）：刷新后台那条只读会话开会话失败时的一行调试线。只记两格：
  //   ok 恒为 false（成功开会话不记，避免每趟刷新刷一行噪音）、reason 没开成的结局名
  //   （workspace-not-ready 调用方没给目录 / no-registry 注册表没就绪 / open-failed 选后端失败 /
  //   no-backend、multi-match、pending 选后端的三种结局 / open-threw 开会话时抛了）。
  //   为什么要有：刷新读不到数据时，光看界面降级分不清是没后端可选、后端认不出、还是注册表没起来。
  'read.session': ['ok', 'reason'],
}
// 房内三点六个事件的精确字段形状（#494 房内落点，附录 1.4 原文；#1111 按新判档实现订正 error.normalize）：
// gh.exec 九键（六键照旧，cmd 为 2026-10-21 #1007 复核增补；`via` 与 `opId` 是 #1052 增补的两格）、gh.timeout 七键（layer 为同日 #1007/#1224 复核增补，via / cmd / waitedMs / phase 为 2026-10-21 #1101 排查增补）、gh.resolve.fail 两键，
// graphql.fallback 与 issues.fallback 各自两键与三键；error.normalize 必有 rawKind 与 mappedKind 两键，
// 另外三个码值键（httpCode 状态码、exitCode 退出码、errCode 错误码名）只在真有对应事实时带。
// 注意本门禁的字段收集器只看得见「调用点上写死的对象字面量」，而 error.normalize 现在由
// src/tracker/kernel/error-rules.ts 的 emitNormalize 统一发射（字段装在传进去的参数对象里），所以 layer、via、
// latencyMs 三个键在这里收不到，它们由上面 ALLOWED 的 error.normalize 那一行覆盖。
const ROOM_SHAPES = {
  // 2026-10-14（#1052）常驻 #5 `gh.exec` 增补一格 `via`：这一次 gh 调用是谁发的、走到哪一支
  //   （调用点写死的短标签，例如 list.gql / list.rest / get.rest / counts.gql；没给标签的调用点写空串）。
  //   为什么要有：一趟读操作会落好几行字段完全一样的 gh.exec，事后分不出哪行属于哪条操作、走的哪条路。
  //   只写短枚举，票号、仓库地址原文、路径原文一个字都不记。登记册与「读路径调用点必须带标签」那条
  //   断言在 tests/verify-github-gh-via.ts。
  // 2026-10-14（#1052 续）再增补一格 `opId`（含义见上面 ALLOWED 里同名的注释段）：
  //   宿主起这一趟操作时生成的编号，房间原样取 `ctx.opId`；不给编号的调用方记空串。
  'gh.exec': ['argv0', 'via', 'opId', 'cwdHash', 'latencyMs', 'waitedMs', 'kind', 'exitCode', 'cmd'],
  // 2026-10-14（#1052 补做）房内两条新结论线的形状（字段含义见上面 ALLOWED 里同名的两段注释）。
  'read.degraded': ['op', 'reason', 'latencyMs', 'opId'],
  'preflight.gate': ['gate', 'reason', 'latencyMs', 'opId'],
  'gh.timeout': ['argv0', 'timeoutMs', 'layer', 'via', 'cmd', 'waitedMs', 'phase'],
  'gh.resolve.fail': ['hasDSH_GH_PATH', 'errorHash'],
  'graphql.fallback': ['scope', 'reason'],
  'issues.fallback': ['from', 'to', 'reason'],
  'error.normalize': ['rawKind', 'mappedKind'],
}

function listJsFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      // #1095：搬家后埋点文件有 .ts（只扫 .js 会漏掉整棵新树，见出站闸同一教训）。
      else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.ts'))) out.push(p)
    }
  }
  walk(dir)
  return out
}

// 取对象字面量最外层全部键：跳过字符串与模板里的冒号，跳过三元问号冒号。
function topKeys(objText) {
  const keys = []
  let depth = 0
  // 括号深度（#1253 加）：源码转成 TypeScript 之后，值里常出现带类型标注的回调参数，例如
  //   namesHash: hash(rows.map(function (r: any) { ... }))
  // 里面那个 `r:` 会被原来的写法当成一个字段名（它确实处在对象体的第一层括号里），于是门禁
  // 报出并不存在的字段 `r`。参数列表、函数调用、分组括号里的冒号一律不是字段名，所以只在
  // 括号深度为 0 时才认字段；三元运算符的配对计数照旧，不受影响。
  let pdepth = 0
  let ternary = 0
  let instr = null
  let esc = false
  let buf = ''
  for (let i = 0; i < objText.length; i++) {
    const c = objText[i]
    if (instr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === instr) instr = null
      continue
    }
    if (c === '"' || c === "'" || c === '\u0060') { instr = c; continue }
    if (c === '{') { depth += 1; continue }
    if (c === '}') {
      depth -= 1
      if (depth === 0) break
      if (depth === 1) ternary = 0
      continue
    }
    if (c === '(') { pdepth += 1; continue }
    if (c === ')') { if (pdepth > 0) pdepth -= 1; continue }
    if (depth !== 1) continue
    if (c === '?') { ternary += 1; continue }
    if (c === ':' && ternary > 0) { ternary -= 1; buf = ''; continue }
    if (c === ':' && ternary === 0) {
      if (pdepth > 0) { buf = ''; continue }
      const m = buf.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)
      if (m) keys.push(m[1])
      buf = ''
      continue
    }
    if (c === ',' || c === ';') { buf = ''; continue }
    buf += c
  }
  return keys
}

// 调用点之后第一段字段对象体的起点：
// 直接对象取第一个大括号；包在取值函数里的取 return 后面的大括号。
function fieldsObjectStart(rest) {
  const lazy = rest.match(/function\s*\([^)]*\)\s*\{\s*return\s*\{/)
  if (lazy) return rest.indexOf('{', lazy.index + lazy[0].length - 1)
  const i = rest.search(/\{/)
  return i
}

function collectCalls() {
  const found = {}
  const rooms = ['github' + path.sep + 'client.js', 'github' + path.sep + 'issues.js', 'github' + path.sep + 'errors.js',
    // #1095：房间已搬进 src/tracker/rooms（.ts），旧地址的匹配留着（老文件若回来仍认），新地址逐项补上。
    'rooms' + path.sep + 'github' + path.sep + 'client.ts', 'rooms' + path.sep + 'github' + path.sep + 'issues.ts', 'rooms' + path.sep + 'github' + path.sep + 'errors.ts']
  const files = listJsFiles(path.join(ROOT, 'src', 'host')).concat(listJsFiles(path.join(ROOT, 'src', 'client')))
    // #1095：埋点跟着搬家走了（src/deck、src/tracker 新树），扫描根一起跟上；只读不断言，旧根不动。
    .concat(listJsFiles(path.join(ROOT, 'src', 'deck'))).concat(listJsFiles(path.join(ROOT, 'src', 'tracker')))
    // #1426：刷新埋点跟着宿主房搬进 src/refresh/rooms/host/，扫描根一起跟上；旧根不动。
    .concat(listJsFiles(path.join(ROOT, 'src', 'refresh')))
  // 2026-10-20 #1294：locale.ts 的埋点走一个 localeLogEmit 发射壳 —— 它把级别、事件名、字段原样转给 log，
  //   只是晚一拍进微任务写（这份内核排在 kernel:log 之前，激活过程中就要注册语言）。壳名不补进扫描口径，
  //   上面两条 locale.registration* 就会被判成「全仓未找到」，白名单也收不到它们的字段。
  const mainRe = /(?:^|[^A-Za-z0-9_$])(?:log|fire|rlog|logEvent|backendLogEvent|roomLogEvent|localeLogEmit)\s*\(\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*)?['"](error|warn|info|debug)['"]\s*,\s*['"]([a-z][a-zA-Z0-9.]*?)['"]\s*,/g
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const rel = path.relative(ROOT, f)
    const isRoom = rooms.some((r) => rel.endsWith(r))
    const patterns = [mainRe]
    if (isRoom) patterns.push(/(?:^|[^A-Za-z0-9_$])f\s*\(\s*['"](error|warn|info|debug)['"]\s*,\s*['"]([a-z][a-zA-Z0-9.]*?)['"]\s*,/g)
    for (const re of patterns) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) {
        const name = m[2]
        const after = text.slice(m.index + m[0].length)
        // 只看紧跟调用的头 120 字：直接对象、取值函数或变量三选一，不向后跨行借对象。
        const head120 = after.slice(0, 120)
        let keys = []
        const lazyHead = head120.match(/^\s*function\s*\([^)]*\)\s*\{\s*return\s*\{/)
        if (lazyHead) {
          const start = after.indexOf('{', lazyHead.index + lazyHead[0].length - 1)
          if (start >= 0) keys = topKeys(after.slice(start))
        } else if (/^\s*\{/.test(head120)) {
          keys = topKeys(after.slice(after.search(/\{/)))
        } else {
          // 字段先装进变量再传入：回头找该变量的对象字面量，并收拢后续逐个点赋的键。
          // 只有裸变量名（后面紧跟逗号或右括号）才走这条路，其余形状直接记空键。
          const varName = (head120.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[,)]/) || [])[1]
          if (varName) {
            const before = text.slice(0, m.index)
            const decls = Array.from(before.matchAll(new RegExp('(?:const|let|var)?\\s*' + varName + '\\s*=\\s*\\{', 'g')))
            if (decls.length) {
              const d = decls[decls.length - 1]
              keys = topKeys(before.slice(d.index + d[0].length - 1))
            }
            const scope = text.slice(m.index, m.index + 2500)
            for (const pm of scope.matchAll(new RegExp(varName + '\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*=', 'g'))) {
              if (!keys.includes(pm[1])) keys.push(pm[1])
            }
          }
        }
        if (!found[name]) found[name] = { keys: {}, sites: [] }
        for (const k of keys) found[name].keys[k] = (found[name].keys[k] || 0) + 1
        found[name].sites.push(rel + '（第 ' + (text.slice(0, m.index).split('\n').length) + ' 行）')
      }
    }
  }
  return found
}

const found = collectCalls()
const names = Object.keys(found).sort()

// 一、允许表里每个事件都有埋点落点（允许表 109 个事件；自监控那几条由 verify-log-selfmon 覆盖，退役的 5 个 —— issuePath.push、issuePath.record、settings.save、choiceStore.hint.reject、sessionTickets.chain —— 不在源码里）。
// #875 薄接线：update.install.exec 的发射器已收进已安装的更新包（事件保留、字段不变，落点改到包内编译产物）。
// 本仓 src 里不再有它的落点，这里到包内发射处核对事件名与五个字段，找不到仍红。
if (!found['update.install.exec']) {
  try {
    const evtDef = fs.readFileSync(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'shared', 'log-events.js'), 'utf8')
    const store = fs.readFileSync(path.join(ROOT, 'node_modules', 'dsh-plugin-update', 'dist', 'core', 'executor.js'), 'utf8')
    const named = evtDef.includes('"update.install.exec"')
    const at = store.indexOf('LOG_EVENT_INSTALL_EXEC, {')
    const near = at >= 0 ? store.slice(at, at + 900) : ''
    const fieldsOk = ['route', 'ok', 'exitCode', 'durationMs', 'pluginId'].every((k) => near.includes(k))
    if (named && at >= 0 && fieldsOk) found['update.install.exec'] = { keys: { route: 1, ok: 1, exitCode: 1, durationMs: 1, pluginId: 1 }, sites: ['node_modules/dsh-plugin-update/dist/core/executor.js（包内发射，常量名 LOG_EVENT_INSTALL_EXEC）'] }
  } catch {}
}
// 这一段必须留在上面的 if 之外：发射器今天在已安装的更新包里，条件为真时才会走进上面的委托核对；
// 哪天发射器搬回本仓，found['update.install.exec'] 直接有值，这 109 条存在性断言仍然要一条不少地跑。
for (const name of Object.keys(ALLOWED).sort()) {
  check(!!found[name], '事件有埋点落点 ' + name + (found[name] ? '（' + found[name].sites.length + ' 处）' : '（全仓未找到）'))
}
for (const name of names) {
  if (!ALLOWED[name]) check(false, '未知事件名须先更新附录与本门禁 ' + name + ' @ ' + found[name].sites.slice(0, 3).join('、'))
}
check(!found['issuePath.push'] && !found['issuePath.record'] && !found['sessionTickets.chain'], '已退役事件无埋点残留（issuePath.push、issuePath.record、sessionTickets.chain 只在附录追溯）')

// 二、每个事件的实际字段键都在允许表内（只许少记、不过多记）。
for (const name of Object.keys(ALLOWED).sort()) {
  if (!found[name]) continue
  const allowed = ALLOWED[name]
  const actual = Object.keys(found[name].keys).sort()
  const extra = actual.filter((k) => !allowed.includes(k))
  check(extra.length === 0, '事件只含允许字段 ' + name + '（实得 ' + (actual.join('、') || '空') + '）' + (extra.length ? ' —— 多出：' + extra.join('、') : ''))
}

// 三、房内三点六个事件字段形状一字不差（附录 1.4 原文）。
for (const name of Object.keys(ROOM_SHAPES).sort()) {
  if (!found[name]) continue
  const want = ROOM_SHAPES[name].slice().sort()
  if (name === 'error.normalize') {
    const actual = Object.keys(found[name].keys).sort()
    // 两键必带；三个码值键按事实带上（这次判档手里有什么码就记什么码）。这三个键之外多出来的才是漂移。
    const optional = ['httpCode', 'exitCode', 'errCode']
    const ok = ROOM_SHAPES[name].every((k) => actual.includes(k))
      && actual.every((k) => optional.includes(k) || ROOM_SHAPES[name].includes(k))
    check(ok, '房内事件字段形状 ' + name + '（实得 ' + actual.join('、') + '，' + optional.join('、') + ' 只在真有对应事实时带）')
    continue
  }
  const actual = Object.keys(found[name].keys).sort()
  check(JSON.stringify(actual) === JSON.stringify(want), '房内事件字段形状 ' + name + '（实得 ' + (actual.join('、') || '空') + '，应得 ' + want.join('、') + '）')
}

// 四、全局禁令抽查：全部事件的字段键并集里没有原文类键。
const allKeys = {}
for (const name of names) for (const k of Object.keys(found[name].keys)) allKeys[k] = true
// 原文类键精确名单：与这些一字相同的键名不许出现在任何事件里
// （是否配备用路径这类布尔键、带 Hash 后缀的散列键不在此列）。
const RAW_KEYS = ['token', 'password', 'passwd', 'pwd', 'secret', 'authorization', 'bearer', 'url', 'path', 'cwd', 'message', 'error', 'err', 'stack', 'text', 'title', 'body', 'content', 'template', 'snapshot', 'stdout', 'stderr', 'args', 'argv', 'query', 'cookie', 'session', 'hint', 'repo', 'owner']
const rawLike = Object.keys(allKeys).filter((k) => RAW_KEYS.includes(k))
check(rawLike.length === 0, '字段键无原文类键（令牌、路径、地址、文本原文都不许作键名）' + (rawLike.length ? ' —— 命中：' + rawLike.join('、') : '（共 ' + Object.keys(allKeys).length + ' 个键）'))

console.log(failed ? '\n存在失败 — verify-log-fields 未通过' : '\n全部通过 — 字段白名单门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
