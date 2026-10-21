# #1210 第二轮日志实证：2026-10-21 14:00 之后的六项埋点

本笔记按 task-32（lead 2026-10-21 派单）的要求，只读核对本轮新加的埋点在真机运行日志里是否真的出现。核对对象是 2026-10-21 14:00 之后、插件真机日志目录里的当天文件；核对时 HEAD 是 1471c4a1（任务开始时 git rev-parse 记录），本轮没有修改源码、测试、脚本、构建产物，也没有提交、关票或评论。

## 一、口径与方法

- 日志目录：C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\；文件为 2026-10-21.log。
- 时间窗：2026-10-21 14:00:00 起，最后一次扫描到的末行是 15:35:21.568（本地时间）。
- 扫描方式：逐行流式读取并按行解析 JSON，从不整文件读入；时间过滤用毫秒时间戳。扫描时全文件 262,949 行，其中落在窗口内的有 75,558 行（文件仍在增长，随后一次扫描是 75,651 行，相差约 90 行）。
- 日志不完整：窗口内有 2,978 行 log.rotate.degraded，说明轮转期间有缺片。因此下面的计数只是「已经落盘的部分」，不是当天全部；不过本轮要找的是「某些行有没有出现过」，这个方向的结论仍然成立。
- 事件字段一律按 src/ 与 package/ 里的实际实现核对；旧行号会漂移，笔记里的行号都以今天的树与今天的构建为准。

## 二、运行构建与加载时间线

先说清楚「日志里看到的事件，到底是哪份构建在跑」，后面的判断才有根。

### 2.1 运行构建里确实有这五个事件与宿主 waitedMs

- package/lib/client.js（2,123,402 字节，最后写入 2026-10-21 15:31:17）里：prompt.link 在第 5968 行，probe.loop 在第 12172 行，guide.banner 在第 24792 行。
- package/lib/git-process.js（15:31:21）里：gh.auth.env 在第 198 行，宿主 gh.exec 的 waitedMs 在第 119、140 行。
- package/lib/outbound/admission.js（15:31:21）里：gh.lane.saturated 在第 70 行。
- 这些都是看构建产物文本得到的直接证据；另外用 git show --stat c7a8cef4 核对过，提交确实同时改了这五个事件的源码与门禁。

### 2.2 两侧构建的加载时间不同（日志给出了证据）

客户端一侧：guide.banner、probe.loop、prompt.link 三条事件在当天全文件里第一次出现的时间分别是 14:08:24.547、14:09:20.305、14:09:31.659，14:00 之前一条也没有。这说明带这三条新事件的客户端构建大约在 14:08 已经加载。提交 c7a8cef4 的时间是 14:28，比日志里的第一次出现还晚，说明当时运行的是并行会话从工作树提前构建并重载的那份产物（与 #1220 复核笔记里记录的现象一致）；15:31 的最终构建同样包含这三条事件。

宿主一侧：窗口内 gh.exec 的字段形状出现了清晰的三段切换，可以据此判断宿主构建是什么时候换的：

| gh.exec 字段签名 | 行数 | 出现时间 | 说明 |
| --- | --- | --- | --- |
| argv0、cwdHash、exitCode、kind、latencyMs（无 waitedMs） | 1,236 | 14:00:01 至 15:10:03 | 旧宿主构建里 git-process 的 gh.exec |
| argv0、cwdHash、exitCode、kind、latencyMs、opId、via、waitedMs | 2,576 | 14:00:04 至 15:35:14 | 房间 client 路径（waitedMs 自 #1007 就有） |
| argv0、cwdHash、exitCode、kind、latencyMs、waitedMs | 383 | 15:10:13 至 15:34:24 | 新宿主构建里 git-process 的 gh.exec |

第二、三行的切换发生在 15:10:03 与 15:10:13 之间，也就是说宿主进程大约在 15:10:10 加载了包含 c7a8cef4 宿主改动的构建。gh.lane.saturated 第一次出现在 15:16:25，与「新宿主构建先就位、之后才真的排上队」这条时间线吻合。

结论：判定「运行构建里有没有这段埋点」时，客户端三条从 14:08 起就有；宿主侧的 gh.auth.env、gh.lane.saturated 与 gh.exec 的 waitedMs 从 15:10 起就有。15:31:21 之后客户端事件变稀（guide.banner 与 probe.loop 停在 15:31:21），合理推测是客户端包重载后页面状态被重置，这不影响上面的结论。

## 三、六项逐项核对

| 项目 | 命中行数 | 最早 | 最晚 | 结论 |
| --- | --- | --- | --- | --- |
| gh.auth.env | 0 | 无 | 无 | 代码已就绪，窗口内触发条件未出现，未获实证 |
| gh.lane.saturated | 335 | 15:16:25.669 | 15:28:41.966 | 已生效，且证明读桶真的排满 |
| guide.banner | 277 | 14:08:24.547 | 15:31:21.279 | 已生效 |
| probe.loop | 429 | 14:09:20.305 | 15:31:21.279 | 已生效 |
| prompt.link | 18,490 | 14:09:31.659 | 15:34:25.402 | 已生效，但体量偏大 |
| gh.exec 带非空 waitedMs | 1,065（带字段 2,959） | 窗口内持续出现 | 15:34 左右 | 已生效（宿主补的那部分按字段签名确认） |

### 3.1 gh.auth.env：0 条，问题在触发条件不在构建

这条事件的落点是 src/host/git-process.ts:270，只在宿主自己的 runGh 路径上、命令退出码非 0 且文本被判定成认证类失败（kind 等于 auth）时才记。字段是 signal、cwdHash、exitCode、proxySet、ghConfigDir，全是短枚举与布尔，不记 stderr 原文与变量值。房间 client 那条路径不会记这条事件。

窗口内 gh.exec 的 kind 分布是：房间路径 ok / network / env，新宿主路径 ok 373 条 / network 10 条，没有任何 auth。全文件唯一一条 kind 等于 auth 的 gh.exec 出现在 10:25:39，来自房间路径（via 是 preflight.auth），既不在窗口内，也不经过 gh.auth.env 的落点。

宿主新构建从 15:10 起已经在跑（见 2.2 的字段签名切换），所以 0 命中不能解释成「构建还是旧的」，而是这一段时间里没有出现过会被判成认证失败的 gh 命令。判定：埋点代码已就绪，但本窗口内没有得到一次真实命中，不能算「已实证生效」。

### 3.2 gh.lane.saturated：335 条，已生效，并证明读桶真的排满

全部是 debug 级、bucket 为 read，时间 15:16:25.669 至 15:28:41.966。一条原始样例（400 字符内）：

{"v":3,"ts":1792566985669,"level":"debug","event":"gh.lane.saturated","fields":{"bucket":"read","inflight":64,"max":64,"queued":194,"waitedMs":7034}}

335 条的等待统计：最小 0 毫秒，中位 14,585 毫秒，最大 15,126 毫秒；放行时的在飞数最高到 64（正好是读桶上限），队列长度最高到 194。判定：埋点已经生效；同时它给出一份很具体的现场——读桶在这十几分钟里被挤到上限，排队最长的等了两万多？不，最长是 15.1 秒，队列里同时最多排了 194 条。

### 3.3 guide.banner：277 条，已生效

info 级，14:08:24.547 至 15:31:21.279；其中 139 条是 outcome 为 shown、step 为 selection:backendSelected（banner 为 banner.gate、tone 为 info），138 条是 outcome 为 cleared、step 为空。一条样例：

{"v":3,"ts":1792562904547,"level":"info","event":"guide.banner","fields":{"step":"selection:backendSelected","banner":"banner.gate","tone":"info","outcome":"shown","ageMs":0}}

出现与消失成对（139 比 138 多一条，是因为最后一次出现后还没来得及消失），说明边沿触发的记录方式在真机上工作正常。判定：已生效。

### 3.4 probe.loop：429 条，已生效（内容同时是 #1220 的证据）

debug 级，14:09:20.305 至 15:31:21.279，全部 reason 为 no-timer，intervalMs 为 5000，visible 为 true。一条样例：

{"v":3,"ts":1792562960305,"level":"debug","event":"probe.loop","fields":{"reason":"no-timer","intervalMs":5000,"visible":true}}

判定：已生效。它同时是 #1220 复核里的直接真机证据：timer 包装没有 interval，活跃探测与心跳两处节拍都在守卫处退出，所以从来没有 scheduled。

### 3.5 prompt.link：18,490 条，已生效但偏吵

debug 级，14:09:31.659 至 15:34:25.402，全部是 prompt 为 inspect、backend 为 github、numKind 为 number、linkKind 为 url、verdict 为 ok。一条样例：

{"v":3,"ts":1792562971659,"level":"debug","event":"prompt.link","fields":{"prompt":"inspect","backend":"github","numKind":"number","linkKind":"url","verdict":"ok"}}

判定：已生效。但 85 分钟里 18,490 行，约合每秒 3.6 行，说明只要调试开关打开、面板在渲染提示词，这条事件就会持续大量落盘。按仓库日志纪律「高频不判开关直接记」的顾虑，建议后续单独评估：只在 prompt、verdict、linkKind 变化时记，或按时间窗限一条。本任务只记录现象，不改代码。

### 3.6 gh.exec 带非空 waitedMs：1,065 条，已生效

窗口内 gh.exec 共 4,195 条；其中 2,959 条带 waitedMs 字段，另外 1,236 条没有这个字段（就是 2.2 里旧宿主构建的 git-process 行，15:10:03 之后消失）。字段值大于 0 的有 1,065 条，窗口内最大 15,126 毫秒。一条原始样例：

{"v":3,"ts":1792566993823,"level":"info","event":"gh.exec","fields":{"argv0":"gh","via":"preflight.auth","opId":"","cwdHash":"aa408f24","latencyMs":15161,"waitedMs":15126,"kind":"network","exitCode":-1}}

要分开两件事：房间 client 路径的 waitedMs 字段从 #1007 就有，所以「房间行里 waitedMs 大于 0」只能说明排队在记录，不能证明今天这次宿主补丁；宿主补齐的是 git-process 那条路。按 2.2 的签名看，宿主机新形状从 15:10:13 起有 383 条，其中 129 条 waitedMs 大于 0，最大 9,650 毫秒，一条样例：

{"v":3,"ts":1792567721901,"level":"info","event":"gh.exec","fields":{"argv0":"gh","cwdHash":"8bb305ba","latencyMs":11022,"waitedMs":9650,"kind":"ok","exitCode":0}}

判定：宿主补的 waitedMs 已生效；房间路径的等待也一直在记录。总数 1,065 里，宿主新形状 129 条、房间路径 936 条（1,065 减 129）。

## 四、附带发现

1. gh.exec 现在有三种字段签名，可以直接从日志读出「这一行来自哪条路、哪一代构建」，以后排查构建是否加载时很好用，建议保留这个观察方法。
2. 15:16 到 15:28 的读桶饱和很重：在飞数打满 64，队列一度 194 条，中位等待 14.6 秒、最长 15.1 秒。结合 waitedMs 最大那条样例的 via 是 preflight.auth，这波排队主要看起来是探活类读取。这不是本任务要判的日志问题，但建议把这段数据留给准入上限相关的票（#960、#1007 一类的后续）当现场。
3. probe.loop 全部是 no-timer，与 #1220 的判定一致；guide.banner 里没有 tracker:initialized，也说明今天没有初始化黄条现场。两条互相对得上。
4. prompt.link 的体量偏大，见 3.5，建议另票评估节流。

## 五、结论

本轮要核的六项里，五项在 2026-10-21 14:00 之后的真机日志中已经出现，埋点生效：gh.lane.saturated、guide.banner、probe.loop、prompt.link，以及宿主 gh.exec 的 waitedMs（按字段签名区分，房间路径的 waitedMs 早于本轮改动）。gh.auth.env 是唯一 0 命中项，原因不是构建旧——新宿主构建 15:10 已在跑、package/lib/git-process.js 第 198 行有这段代码——而是窗口内没有出现认证类的 gh 失败，所以它「代码就绪、尚未获得真机实证」。

## 六、未决与建议

1. gh.auth.env 需要一次真实的认证类失败才能实证。不要为了验证主动破坏本机凭据；下次面板或宿主命令出现认证失败时，看同一时间窗是否出现 gh.auth.env，并用 signal 与 cwdHash 跟附近的 gh.exec（kind 为 auth）对时间即可。
2. prompt.link 的高频问题建议另票处理：只在关键字段变化时记录，或按秒/分钟节流；本任务不改。
3. 读桶饱和（队列 194、等待中位 14.6 秒）建议作为准入上限的观察项转给相关票，不要在本任务里调整数字。
4. 窗口内 2,978 行 log.rotate.degraded 说明日志有缺片；若以后要做精确计数，得先解决轮转缺口。

## 七、复查命令

时间窗起点（2026-10-21 14:00:00 +08:00）对应的毫秒时间戳是 1792562400000；逐行流式筛选用下面的思路（不是整文件读入）：

```powershell
$log = 'C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-21.log'
Select-String -Path $log -Pattern '"event":"gh.lane.saturated"' | Select-Object -First 2
```

需要按时间窗精确统计时，用仓库里现成的 Node 能力逐行读：开一个 readline，对每行取 "ts" 后面的数字，小于 1792562400000 的直接跳过，其余再 JSON.parse 后按 event 与 fields 统计。本轮就是这么做的，没有用 ConvertFrom-Json 全量解析。

写成一句结论：**14:00 之后，五个新事件里四个（gh.lane.saturated、guide.banner、probe.loop、prompt.link）已在真机日志中出现，宿主 gh.exec 的 waitedMs 也已生效；gh.auth.env 因窗口内没有认证类失败而 0 命中，属于「代码就绪、等待现场」，不是构建没加载。**