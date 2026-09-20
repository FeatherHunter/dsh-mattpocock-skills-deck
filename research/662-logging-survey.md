# 662 日志纪律调研：新首次打开工作区的引导链要加哪些日志点

调查目的：这次改动有三件事——状态栏横幅改成一条显式的有序步骤链（选后端 → gh cli 已装 → gh 已登录 → 已关联 GitHub 远程仓库 → 工作区已初始化 → 技能）、新增一段「还没关联远程仓库」的横幅按钮（点开既有的两步建仓向导）、gh 安装那条横幅的按钮改成注入维护者原话 `/wizard 帮用户安装gh cli 官方地址：https://cli.github.com/`。本文只回答纪律要求什么、会影响哪些文件，不做设计定案。

读过的文件：`docs/design/335-logging-contract.md`、`research/489-appendix.md`、`tests/verify-log-fields.js`、`tests/verify-log-guards.js`、`tests/verify-log-count.js`、`tests/verify-log-coverage.js`、`src/client/statusbar/StatusBar.js`、`src/client/statusbar/checksums.js`、`src/client/statusbar/StatusBackend.js`、`src/client/kernel/prompts.js`，以及旁证文件 `src/host/detectChain.js`、`src/host/tracker/backends/github/index.js`、`src/host/publishFlow.js`、`src/client/kernel/actions.js`、`src/client/statusbar/StatusLogMenu.js`、`AGENTS.md`、`package.json`。

## 1 日志纪律要求什么（335 契约）

### 1.1 一件事该记常驻还是该记按需，判定规则在哪一章、原文怎么写

契约第 3 章把事件分成两张表（这一章的条数「常驻 29 条 / 按需 16 条」是立项当时的历史快照，现行条数以附录第 1 章为准，见本文第 2 节），分表的两个标题就是判定规则的落点文字：

- 第 3.1 节标题（`docs/design/335-logging-contract.md:121`）：`### 3.1 常驻 29 条（P0，始终落盘，低频轻量，采样率全量 1/1 不采样）`
- 第 3.2 节标题（`docs/design/335-logging-contract.md:157`）：`### 3.2 按需 16 条（P1，只在调试开关打开时记，全部调试级别，外层判断必须）`

第 3 章的列说明（`docs/design/335-logging-contract.md:119`）写明这一章怎么读：`列说明：级别沿 #332 定版；守卫列写该事件必须的守卫手法；采样率列写初值（真机验证后可微调，调整同步更新门禁）；落点列转引 #331 证据（旧基线行号只作追溯）；字段列引用 #489 附录第 1 节对应条目，不复抄。`

同一条规则在 `AGENTS.md:40` 里写成一句更好懂的话，这也是仓库里最常被引用的一句：`调用次数少、跨边界的记成常驻（一直落盘）；调用很频繁的记成按需（只在用户打开调试开关时才记，还要加采样或节流）。拿不准该常驻还是按需时，去问总指挥，不要自己默认一种。`

把两处合起来说：一次调用发生得少、又跨出插件边界（打给宿主、起外部程序、往会话里写字），记常驻；一次调用在一条会被反复走过的路上（每次渲染、每个缓存查一遍、每条电话都经过），记按需并配采样或节流。拿不准就问总指挥，规则明确禁止自己默认。

另外两类不受常驻/按需名单管：

- `error` 与 `warn` 两个级别始终落盘（`docs/design/335-logging-contract.md:44`：`落盘规则：error 与 warn 始终落盘；info 中第 3 章常驻 29 条落盘，其余 info 与全部 debug 只在调试开关打开时落盘。`）。
- 日志管道自己的故障行（自监控，编号 #46 至 #50）取错误与告警级、始终落盘（`research/489-appendix.md:166` 起的第 1.6 节）。

### 1.2 字段白名单规则

- 白名单的意思在 `research/489-appendix.md:34` 定义：`白名单的意思是只记已知安全的字段，未知字段默认不记。允许字段列就是每个事件能记的全部字段，之外的字段一律不记。`
- 每个事件的允许字段写死在附录第 1 章的对照表里，契约不另抄一遍（`docs/design/335-logging-contract.md:95`）：`字段白名单以 research/489-appendix.md 第 1 节为执行清单，本设计不再复抄：45 事件逐条允许字段、截断代号……`。
- 全局脱敏规则所有事件共用（`research/489-appendix.md:42` 至 `:46`）：令牌与登录态只记有无与类别（键名 `hasToken` 与 `kind`）；工作区原始路径只记散列（键名 `cwdHash`、`keyHash`、`rawHash`）；仓库地址只记名称与标识；标题截断 80 字或只记散列；错误截断 120 字、详情截断 160 字并标注已截断；要看分布只记计数与前几个编号。
- 自由文本还有第二道具名正则网（`research/489-appendix.md:48` 至 `:58`，例如 `R_TOKEN_BEARER`、`R_GH_TOKEN`、`R_WIN_ABS`、`R_HOME_PATH`、`R_REPO_URL`），命中只记规则名不记原文；白名单是主防线，正则只是兜底。
- 红线（`docs/design/335-logging-contract.md:97`）：`红线（门禁断言一）：出现工作区原始路径、仓库地址原文、令牌原文、模板正文、快照全文即红。`

### 1.3 守卫规则：「外层先判开关」

- 第 1.4 节第 1 条（`docs/design/335-logging-contract.md:57`）：`高频调用点外层先判断：if (!isEnabled(level)) return 走原逻辑，不碰日志参数。关闭时直接返回，不分配行对象，不拼接字符串，不做对象转文本，不进队列，不排定时器，不写盘。`
- 第 1.4 节第 2 条（`docs/design/335-logging-contract.md:58`）：`log 函数体内仍判断一次并直接丢弃，做漏加外层判断的兜底。但兜底拦不住调用前已求值的拼接，所以外层判断不许省略。`
- 第 1.4 节第 3 条（`docs/design/335-logging-contract.md:59`）写高频路径的三种手法：按事件限量为主（有变化才记）、采样为辅（缓存命中类按次数采样或时间窗口首条）、节流为辅（定时器只记调度与跳过原因，不记每次心跳）。
- 渲染路径另有禁令（`docs/design/335-logging-contract.md:64`）：`渲染函数体内禁止为日志做对象转文本与字符串拼接。需要记行状态时只记编号与计数，不记整行对象。` 正例是错误文本截断 120 字、详情 160 字、标题留前 80 字（`:66`）。
- 对应门禁：`docs/design/335-logging-contract.md:214`（断言二）与 `:215`（断言三）。

### 1.4 事件名单变了，哪些东西必须同步更新

- 第 4 章断言六（`docs/design/335-logging-contract.md:218`）：`计数：常驻 29 条、按需 16 条、总数 45 不变；纠偏编号清单一致（含 #9、#35、#38、#41，不含 #45 的常驻；含 #45 的按需）；增删事件未同步更新附录对照表即红`。
- 第 4 章总则（`docs/design/335-logging-contract.md:222`）：`8 个脚本全部加入 npm run verify 链；不过即阻塞发布，不靠人工去看。`
- 第 5.2 节熔断（`docs/design/335-logging-contract.md:241`）：`熔断：门禁不过阻塞发布；计数变更未同步更新附录对照表阻塞发布（断言六）……`
- 附录第 4 章断言六（`research/489-appendix.md:242`）写着现行数字与编号：`断言常驻 31 条、按需 26 条、自监控 5 条、总数 62（……）；增删事件必须同步更新本附录对照表，否则红。`
- `AGENTS.md:42` 把动作写得更具体：`动手改代码之前，先把 tests/verify-log-* 里相关的自动检查跑通；如果常驻名单（P0，始终落盘的 30 条）或按需名单（P1，只在调试开关打开时记的 22 条）增删了事件，就同步改 research/489-appendix.md 里第 1 章的对照表，让表和代码对得上。条数会随票变化，现行数字以该附录第 1 章为准（本条 2026-09-12 按 #606 落定后的数字更新）。`

一句话结论：条数一变，要动的是「附录第 1 章的对照表（含标题、增补说明与总章断言六）」加「tests/verify-log-* 里守着条数与清单的那几个脚本」，然后重跑门禁；契约 335 自己不再追改数字（`docs/design/335-logging-contract.md:10` 已声明「现行条数以 research/489-appendix.md 第 1 章的对照表为准」），CONTEXT.md:87 也声明词条里不写死条数。

## 2 现状条数与我们要碰的那几类事件（489 附录第 1 章）

### 2.1 现行条数（第 1 章里的原文）

第 1 章里当前生效的一组数字出现在三处，互相一致：

- 第 1.3 节最后一条增补说明（`research/489-appendix.md:87`，2026-09-19，#655）：`增补后现行清单：常驻 31 条，编号为 1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、35、36、38、39、40、41、42、51、55、57、60；按需 26 条，编号为 2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64。计数为常驻 31 条、按需 26 条、自监控 5 条、总数 62 条。`
- 第 1.4 节标题（`research/489-appendix.md:89`）：`### 1.4 常驻 31 条（P0，始终落盘，低频轻量；#22、#34 已退役，原行保留只作追溯；#51、#55 为 #498 新增，#57 为 #548 新增，#60 为 #618 新增）`
- 第 1.5 节标题（`research/489-appendix.md:133`）：`### 1.5 按需 26 条（P1，只在调试开关打开时记，高频要守卫；#52、#53、#54、#56 为 #498 新增，#58、#59 为 #606 新增，#61 为 #618 新增，#62 为 #635 新增，#63 为 #652 新增，#64 为 #655 新增）`

所以回答「现行 P0 与 P1 各多少条」：**常驻（P0）31 条、按需（P1）26 条，自监控 5 条，总数 62 条**。

第 1 章内部还有两处落后于这三个数字的历史字面，读的时候要知道它们不是现行值：

- `research/489-appendix.md:37`（第 1.1 节）写 `常驻的意思是首轮必补、始终落盘的轻量轨迹（P0，31 条……）。按需的意思是只在调试开关打开时才记的详尽轨迹（P1，24 条，#498 新增 #52、#53、#54、#56，#606 新增 #58、#59，#618 新增 #61，#635 新增 #62）` —— 按需那里停在 24 条，没算后来的 #63、#64。
- `research/489-appendix.md:30`（第 1 章标题）写 `## 1 六十事件对照表……` —— 与现行总数 62 不符。

第 1 章之外还有两处旧数字：`research/489-appendix.md:218`（第 3.1 节写 `常驻 30 条……按需 22 条`）与 `AGENTS.md:42`（写 `常驻（P0，始终落盘的 30 条）……按需（P1，只在调试开关打开时记的 22 条）`）。

### 2.2 我们要碰的那几类前缀下，当前登记的全部事件

按附录第 1 章逐行核对，前缀像 `inject`、`chain`、`detect`、`banner`、`ui`、`setup` 的日志事件一共 6 条；`banner`、`ui`、`setup` 三个前缀下**没有任何日志事件**。以下逐条给出事件名、常驻还是按需、以及附录那一行的字段清单原文。

1. `inject.decision` —— 按需（P1），第 64 号，`research/489-appendix.md:164`：

   `| 64 | inject.decision | 调试（#655 新增） | prompt 这次要注入的是哪段文案（枚举，今天恒为 setupRun）、kind 决定了哪一种（枚举 setup 注入初始化全文 / repo 缺仓库改发建仓指引 / setup-card 布局还没选先问、不注入）、layout 按哪种布局（枚举 single 根目录一份 CONTEXT.md / multi 子项目各一份 CONTEXT.md，根目录 CONTEXT-MAP.md / unset 还没选） | —（只记枚举，不记仓库、路径与文案原文） | — | 外层判断（同一行先判调试开关，关闭时不组装字段对象；用户点击触发，一次操作最多一条，低频） | src/client/kernel/prompts.js 的 injectSetupDecision（初始化文案的唯一注入出口：状态栏黄条、检查页红牌那颗执行初始化按钮、开门链与切换后端的两个弹窗、建仓成功后的自动补发都经过它） |`

2. `chain.derive.error` —— 常驻（P0），第 41 号，`research/489-appendix.md:126`：

   `| 41 | chain.derive.error | 告警（纠偏纳入） | stepId 步骤标识、errorHash 错误散列 | H_ERR、T120 | R_TOKEN_BEARER | kernel/probe.js:61 链派生 |`

3. `chain.cache.hit` —— 按需（P1），第 18 号，`research/489-appendix.md:144`：

   `| 18 | chain.cache.hit | 调试 | keyHash 键散列、lang 语言、ageMs 缓存多久 | 散列键 | — | 采样 | index.js:1674 链缓存、1682 键 |`

4. `chain.cache.miss` —— 按需（P1），第 52 号，`research/489-appendix.md:155`：

   `| 52 | chain.cache.miss | 调试（#498 新增） | keyHash 键散列、lang 语言、reason 未命中原因（枚举 force、empty、key-changed、expired） | 散列键 | — | 按事件 | host/detectChain.js 链缓存穿透 |`

5. `chain.predicate` —— 按需（P1），第 19 号，`research/489-appendix.md:145`：

   `| 19 | chain.predicate | 调试 | id 谓词标识枚举、status 通过或失败或待定、latencyMs | 详情不记 | R_TOKEN_BEARER | 节流（15 秒超时只记状态变化） | index.js:1721-1745 谓词注册 15000 毫秒 |`

6. `detection.detect` —— 常驻（P0），第 16 号，`research/489-appendix.md:110`：

   `| 16 | detection.detect | 信息 | cwdHash、explicit 是否显式、matches 命中数、pending 是否待定、selection 选中结果 | H_CWD | R_WIN_ABS | detectionService.js:32 空目录判断、index.js:256 技能探测 |`

补充说明两件事：

- 源码里搜不到 `banner.*`、`ui.*`、`setup.*` 形状的日志事件名。搜得到的是界面文案键与提示词键（例如 `banner.fold`、`setup.layoutSingle`、`setup.github.trackerLine`），它们不是日志事件，不进事件名单。
- 与状态栏直接相关的两条事件不在上面那几类前缀里，但这次改动会用到，顺带列出：`statusbar.fallback`（常驻 P0，第 38 号，字段 `reason 退化原因（枚举）`，`research/489-appendix.md:123`）与 `statusbar.hydrate`（按需 P1，第 37 号，字段 `cwdSource 工作区来源枚举`，`research/489-appendix.md:151`）。

## 3 四个门禁脚本各断言什么、怎么算、写死了哪些数字

四个脚本都能独立运行；我实跑了一遍，四个当前都是绿的：`verify-log-fields` 130 项断言通过、`verify-log-guards` 22 项通过、`verify-log-count` 73 项通过、`verify-log-coverage` 99 项通过。四个都在 `package.json` 的 `verify` 链里（`node tests/verify-log-fields.js && node tests/verify-log-guards.js && … && node tests/verify-log-count.js && … && node tests/verify-log-coverage.js`）。

### 3.1 `tests/verify-log-fields.js`

断言四件事：

1. 允许表 `ALLOWED` 里的每个事件都能在源码里找到一个埋点落点（`tests/verify-log-fields.js:218` 至 `:220`）；源码里出现而允许表里没有的事件名判红，提示语是 `未知事件名须先更新附录与本门禁`（`:222`）；已退役的两个事件名（`issuePath.push`、`issuePath.record`）不许有残留（`:224`）。
2. 每个事件实际记的字段键必须都在允许表里（`:227` 至 `:233`），只许少记、不许记多。
3. 房内（GitHub 房间）三点六个事件（`gh.exec`、`gh.timeout`、`gh.resolve.fail`、`graphql.fallback`、`issues.fallback`、`error.normalize`）的字段形状一字不差（`:236` 至 `:247`，形状表在 `:92` 至 `:99`）。
4. 所有事件字段键的并集里不许出现原文类键名（`RAW_KEYS` 名单，`:254`，键名清单字面为 `token`、`password`、`path`、`cwd`、`message`、`url`、`title`、`snapshot` 等 30 个）。

怎么算：递归扫遍 `src/host` 与 `src/client` 下的全部 `.js`（`:165`），用主正则 `mainRe`（`:166`，形状是 `log|fire|rlog|logEvent|backendLogEvent|roomLogEvent('级别','点分事件名',`）逐个找调用；房内三个文件 `github/client.js`、`github/issues.js`、`github/errors.js` 额外套一条房间专用正则 `f('级别','事件名',`（`:164`、`:170` 至 `:172`）。字段键由 `topKeys`（`:115`）取对象字面量最外层键，三种形状都认：直接内联对象、惰性取值函数 `function(){return{…}}`、先把对象装进变量再逐个点赋（`:179` 至 `:204`）。

写死的数字与字面：

- 没有条数断言，这张表就是判定依据；`ALLOWED` 表当前有 **61 个事件条目**（脚本自己的说明注释写的是别的数字，见下）。
- 打印出来的横幅写 `日志字段白名单门禁（#494/#498/#548/#618/#652/#655：57 事件逐个只记已知安全字段，未知字段默认不记）`（`:15`）—— 57 是旧数字。
- 第 218 行那句注释写 `（55 个事件里自监控 #46 由 verify-log-selfmon.js 覆盖，退役的 2 个不在源码里）` —— 55 也是旧数字。
- 现行事实是 62 个事件，其中自监控 #46 `host.dispatch.error` 的调用形状（宿主防火墙 `fireLog`）不在本脚本扫描口径内，由 `tests/verify-log-selfmon.js` 覆盖，所以允许表里是 61 条（62 减 1）。这两个旧数字只出现在说明文字与注释里，不参与判定。
- 实跑输出末行：`全部通过 — 字段白名单门禁生效（130 项断言）`，另有 `字段键无原文类键（……）（共 93 个键）`。

扫的源码文件（字面）：`path.join(ROOT, 'src', 'host')` 与 `path.join(ROOT, 'src', 'client')` 下所有 `.js`（`:165`），另加房内三文件（`:164` 的 `rooms` 数组）。

### 3.2 `tests/verify-log-guards.js`

断言七段，核心是第一段与第二至第七段的逐项点名：

1. 第一段（`:32` 至 `:58`）：扫 `src/host` 与 `src/client` 下全部 `.js`，逐行找「调试级调用」（行内同时满足 `['"]debug['"]` 加一个点分事件名，且含记日志函数名或 `f(`），每一行都必须同行出现 `isEnabled(`；两处例外逐项点名放行：`src/host/tracker/backends/github/errors.js`（判断写在归一函数入口）与 `src/host/detectChain.js` 的 `'debug', 'chain.predicate'`（判断写在外层大括号并带 15 秒节流）。
2. 第二段（`:60` 至 `:72`）：读 `src/host/tracker/backends/github/errors.js`，断言归一函数签名是 `classifyGhError(err, ctx)`、含 `isEnabled('debug')`、含上次结果记忆 `lastNormalizeKind` 与 `mapped === lastNormalizeKind`，并断言房内三路调用传上下文的位置不少于 5 处。
3. 第三段（`:74` 至 `:86`）：读 `github/client.js`，断言信息开关判断函数 `roomInfoEnabled` 体内 300 字内含 `isEnabled('info')`；`emitGhExec` 体内先判开关再落事件；`emitGhExec` 被调用处不少于 5 处；超时输出另记 `emitGhTimeout`。
4. 第四段（`:88` 至 `:96`）：读 `github/issues.js`，断言降级函数 `emitRestFallback` 体内同时落 `'warn', 'graphql.fallback'` 与 `'info', 'issues.fallback'`，且体内不含 `isEnabled`（常驻直发不判开关）。
5. 第五段（`:98` 至 `:105`）：读 `src/host/namingGuardian.js`，命名守护启动那一行必须同行含 `isEnabled` 与 `debug`。
6. 第六段（`:107` 至 `:115`）：读 `src/host/detectChain.js`，`'debug', 'chain.predicate'` 之前 600 字内必须含 `isEnabled('debug')`、`15000`、`lastPredStatus`。
7. 第七段（`:117` 至 `:127`）：断言体内兜底仍在——`src/host/logStore.js` 的 `function log(level` 后第一行判级别、`src/client/kernel/log.js` 的 `export const log = function` 后第一行判级别。

写死的数字：

- `check(debugSites >= 16, '调试级调用点不少于 16 处（实得 ' + debugSites + ' 处，覆盖全部按需事件）')`（`:49`），第一段的注释也写 `调试级事件共 16 个（按需），关闭时一律不产生；同行判断保证字段函数不求值。`（`:33`）—— 16 是当年按需条数的下限，现行按需 26 条，这里数的是调用点不是事件数，所以断言仍然绿。
- `check(unexplained.length === 0 && bad.length === 2, '例外恰为点名的两处（归一函数、链谓词）' …)`（`:57`）—— 例外必须**恰好两处**。新加一个调试级调用点如果没有同行判断，或者多出一处没被点名的例外，这条就红。
- `withCtx >= 5`（`:71`）、`emitCalls >= 5`（`:84`）、`600` 字（`:111`）、`15000`（`:113`）、`300` 字（`:77`）。

扫的源码文件（字面）：第一段扫 `src/host` 与 `src/client` 下全部 `.js`；其余各段分别读 `src/host/tracker/backends/github/errors.js`（`:62`）、`github/client.js`（`:76`）、`github/issues.js`（`:90`）、`src/host/namingGuardian.js`（`:100`）、`src/host/detectChain.js`（`:109`）、`src/host/logStore.js`（`:119`）、`src/client/kernel/log.js`（`:123`）。

实跑输出末行：`全部通过 — 外层判断门禁生效（22 项断言）`。

### 3.3 `tests/verify-log-count.js`

断言三件事：

1. 读工作区本地附录 `research/489-appendix.md`（`:28`），逐条核对字面：附录里必须含 `常驻 31 条、按需 26 条、自监控 5 条、总数 62 条`（`:36`），必须含 31 个编号的常驻清单字面 `1、3、4、5、6、7、8、9、10、13、14、16、20、21、26、27、28、31、32、33、35、36、38、39、40、41、42、51、55、57、60`（`:37`），必须含 26 个编号的按需清单字面 `2、11、12、15、17、18、19、23、24、25、29、30、37、43、44、45、52、53、54、56、58、59、61、62、63、64`（`:38`），必须记明 #22 与 #34 已退役（`:39`），必须记明自监控编号 46～50（`:40`）。
2. 扫 `src/host` 与 `src/client` 下全部 `.js`（剥掉注释，`:44`、`:47` 至 `:66`），收集所有带引号的点分名字；`RESIDENT` 31 个、`ONDEMAND` 26 个、`SELFMON` 5 个每个都必须有落点；`RETIRED` 2 个（`issuePath.push`、`issuePath.record`）不许出现。
3. 断言数组长度与总数：`check(RESIDENT.length === 31 && ONDEMAND.length === 26 && SELFMON.length === 5 && known.length === 62, '清单总数 62（常驻 31、按需 26、自监控 5）')`（`:86`），并断言 62 个事件全部有落点、无缺口（`:87`）。

写死的字面（逐条给出）：

- 事件清单数组：常驻 31 个名字（`:18`）、按需 26 个名字（`:20`）、自监控 5 个名字（`:23`）、退役 2 个名字（`:21`）。
- 数字 31、26、5、62 同时出现在：文件头注释（`:1`、`:3`）、打印横幅 `日志计数门禁（…：常驻 31、按需 26、自监控 5、总数 62，与附录修订版字面一致）`（`:15`）、附录字面断言（`:36`）、长度断言（`:86`）。
- 附录里必须出现的两条编号清单字面（`:37`、`:38`）与那句 `常驻 31 条、按需 26 条、自监控 5 条、总数 62 条`（`:36`）。

扫的源码文件（字面）：`research/489-appendix.md`，以及 `path.join(ROOT, 'src', 'host')` 与 `path.join(ROOT, 'src', 'client')` 下的全部 `.js`（`:63`、`:64`）。

2026-09-19 加进来的 #64 `inject.decision` 就在按需数组里（`:20` 末位），附录里 26 个编号那串字面也含 `64`（`:38`）。

实跑输出末行：`全部通过 — 计数门禁生效（73 项断言）`，倒数第二行是 `62 个事件全部落点无缺口（命中 62 个）`。

### 3.4 `tests/verify-log-coverage.js`

断言五段：

1. 第一段（`:59` 至 `:79`）：读 `src/host/index.js`，用正则 `harness.handle\('wf.<名字>`（`:66`）抽出实际注册的电话名，断言 `PHONES` 里每条都已注册、`RETIRED` 两条零注册、注册总数恰好等于现役清单长度（`check(reg.size === PHONES.length, …)`，`:71`），再加一条反向断言：注册了的电话必须都在清单里，否则判红（`:74` 至 `:75`）。最后断言退役实现留守（`src/host/sessionLifecycle.js` 的 `handlePing`、`src/host/handoffClaim.js` 的 `handleClaim`，`:76` 至 `:78`）。
2. 第二段（`:80` 至 `:99`）：把 `src/host` 与 `src/client` 下全部 `.js` 读成文本，对每条电话要求「有方法可识的日志发射」——认 `method: 'wf.x'` 字面，或同一文件里 `loggedPhone('wf.x'` 与 `'host.call'`、`'host.call.fail'` 同时出现（`:88` 至 `:91`）；三条日志电话成功行豁免（`PHONE_EXEMPT`，`:44`）；`wf.snapshot` 与 `wf.refresh` 允许用专属事件名覆盖（`PHONE_EVENT_COVERS`，`:45` 至 `:48`）。
3. 第三段（`:100` 至 `:124`）：扫 `src/client`（路径里含 `seam` 的文件跳过，`:108`）里字面调用点 `host.call('wf.<字母…>`（正则 `:103`），断言调用点数量大于 20（`:116`）；每个调用点要么周围 ±8 行内有 `log|fire('info|warn|debug', 'host.call'` 这一行（正则 `:104`），要么被调电话在 `CALLEE_COVERS` 名单里（`:49` 至 `:57`，名单含 `wf.initPublish`、`wf.retryPush`、`wf.bind`、`wf.registry`、`wf.listLabels` 等 26 个），要么是三条豁免电话。
4. 第四段（`:125` 至 `:131`）：动态透传点单列——`src/client/panelAssembly.js` 必须含 `return host.call(endpoint, args)`、`src/client/kernel/slotRenderer-modal-view.js` 必须含 `host.call(method,`。
5. 第五段（`:132` 至 `:148`）：点名六类动因——6 个新事件的字面（`chain.cache.miss`、`workspaceStore.miss`、`client.snapshot.hit`、`client.snapshot.miss`、`detail.cache.hit`、`host.start`，`:137`）、6 个定时器名（`naming-guardian`、`naming-sweep`、`naming-persist`、`naming-poll`、`statusbar-poll`、`checks-poll`，`:139`）、至少 2 个客户端文件含 `log-resolve`（`:145`）、`src/host/tracker/registryCore.js` 里 `caller:` 至少 4 处（`:147`）。

写死的数字与字面：

- `PHONES` 清单 **38 条**（`:31` 至 `:42`；第 30 行注释写 `电话清单：35 注册减退役 2 个，现役 33 个，加 #541 只读更新电话 2 个，现役 35 个，加 #542 装更新电话 1 个，现役 36 个，加 #627 标签配色电话 2 个（wf.listLabels / wf.setLabelColors），现役 38 个。增删电话必须同步改本表、附录 1.7 与计数门禁。`）。
- `RETIRED` 2 条（`:43`）、`PHONE_EXEMPT` 3 条（`:44`）、`CALLEE_COVERS` 26 条（`:49` 至 `:57`）。
- 注册总数等于清单长度（`:71`）、字面调用点数量大于 20（`:116`）、`resolveKinds >= 2`（`:145`）、`caller:` 至少 4 处（`:147`）。

扫的源码文件（字面）：`src/host/index.js`（`:61`）、`src/host/sessionLifecycle.js`（`:76`）、`src/host/handoffClaim.js`（`:77`）、`src/host` 与 `src/client` 下全部 `.js`（`:82`、`:84`、`:102`、`:134`、`:142`）、`src/client/panelAssembly.js`（`:127`）、`src/client/kernel/slotRenderer-modal-view.js`（`:128`）、`src/host/tracker/registryCore.js`（`:146`）。

实跑输出末行：`全部通过 — 覆盖门禁生效（99 项断言）`。脚本在失败时还会打印几句提示，其中一句正是本次要引的规则来源：`常驻还是按需看 docs/design/335-logging-contract.md 第 3 章，字段只取 research/489-appendix.md 白名单；补完重跑本脚本，绿了再谈功能。`（`:154`）。

## 4 要碰的四个文件里现有的日志点

先说结论：四个文件里现有 5 个日志点，分布在两个文件；`checksums.js` 与 `StatusBackend.js` 一个日志点都没有。5 个当中**只有 1 个是常驻（P0）**，就是 `StatusBar.js:60` 的 `statusbar.fallback`；另外 4 个都是按需（P1）。

### 4.1 `src/client/statusbar/StatusBar.js`

- `src/client/statusbar/StatusBar.js:42` —— 事件名 `statusbar.hydrate`，按需（P1，附录 1.5 第 37 号）。原文：

  `try { dswsStatusHydN.n += 1; if (isEnabled('debug') && dswsStatusHydN.n % 100 === 0) log('debug', 'statusbar.hydrate', { cwdSource: String(src || 'unknown') }) } catch (eL) {}`

  判定依据：同一行先判 `isEnabled('debug')`，再按百分之一采样（模块级计数器 `dswsStatusHydN`，定义在 `:6`），符合第 1.4 节的外层判断与采样纪律。记的字段：`cwdSource`。**不在 P0 名单**。

- `src/client/statusbar/StatusBar.js:60` —— 事件名 `statusbar.fallback`，常驻（P0，附录 1.4 第 38 号）。原文：

  `React.useEffect(function () { try { const r = !s.snapshot ? 'no-snapshot' : (!s.cwd ? 'no-cwd' : (s.snapMode === 'err' ? 'snap-error' : '')); if (r !== dswsStatusFbLast.reason) { dswsStatusFbLast.reason = r; if (r) log('info', 'statusbar.fallback', { reason: r }) } } catch (eL) {} }, [s.snapshot, s.cwd, s.snapMode])`

  判定依据：`log('info', …)` 没有 `isEnabled` 守卫，属常驻直发；用模块级 `dswsStatusFbLast`（`:7`）做「变了才记」的按事件守卫。记的字段：`reason`。**这是四个文件里唯一在 P0（始终落盘）名单上的日志点**，附录 1.4 的落点列写的就是 `statusbar/StatusBar.js:59 胶囊永不隐藏`（`research/489-appendix.md:123`）。

- `src/client/statusbar/StatusBar.js:126` —— 事件名 `timer.schedule`，按需（P1，附录 1.5 第 44 号）。原文：

  `const poll = setInterval(applyAll, 2000); try { if (isEnabled('debug')) log('debug', 'timer.schedule', { name: 'statusbar-poll', intervalMs: 2000 }) } catch (eL) {}`

  判定依据：同一行先判调试开关。记的字段：`name`（取值 `'statusbar-poll'`）、`intervalMs`；附录允许的第三个字段 `jitterMs` 这里没记（只许少记）。**不在 P0 名单**。定时器名口径见附录 1.7 末尾（`research/489-appendix.md:184`）。

### 4.2 `src/client/statusbar/checksums.js`

没有任何日志调用（全文 44 行，只有 `export const checksumsOf = function (s) {…}`，定义在 `:9`）。它算的是横幅要用的布尔量与计数（`:36` 至 `:42` 读 `gh:installed` 与 `gh:authed` 两个链步骤，`:43` 返回 `ghCliBad`、`ghAuthBad`、`ghCliPending`、`ghAuthPending` 等）。属于第 1.5 节点名的渲染路径，本身不许做对象转文本或字符串拼接。

### 4.3 `src/client/statusbar/StatusBackend.js`

全文 96 行（`:1` 至 `:96`），搜 `log`、`Log`、`isEnabled` 都没有命中，一个日志点都没有。这个文件里确实有跨进程调用——`host.call('wf.registry', …)`（`:58`、`:89`）与 `host.call('wf.bind', …)`（`:76`、`:95`），但它们靠宿主侧的 `loggedPhone` 覆盖（两条电话都在 `tests/verify-log-coverage.js:49` 起的 `CALLEE_COVERS` 名单里），所以覆盖门禁不会因为客户端这四处没有相邻日志行而判红。

### 4.4 `src/client/kernel/prompts.js`

两个日志点，都是同一个事件 `inject.decision`，按需（P1，附录 1.5 第 64 号，2026-09-19 由 #655 新增）：

- `src/client/kernel/prompts.js:174`（布局卡那一档出口）原文：

  `try { if (isEnabled('debug')) log('debug', 'inject.decision', { prompt: 'setupRun', kind: 'setup-card', layout: 'unset' }) } catch (eL) {}`

  记的字段：`prompt`、`kind`、`layout`。**不在 P0 名单**。

- `src/client/kernel/prompts.js:185`（决定已定、准备注入那一档出口）原文：

  `try { if (isEnabled('debug')) log('debug', 'inject.decision', { prompt: 'setupRun', kind: kind, layout: String(usedLayout) }) } catch (eL) {}`

  记的字段：`prompt`、`kind`（取自 `setupOrRepoPrompt` 的 `dec.kind`，今天是 `setup` 或 `repo`）、`layout`。**不在 P0 名单**。

两处都在同一行先判 `isEnabled('debug')`，符合按需埋点的外层判断纪律；第 171 至 `:173` 行的注释也把这条纪律写在了现场。

同一个文件里还有三处**裸控制台输出**，它们不是日志点（不落盘、不受调试开关管、不进白名单门禁的字段扫描）：`src/client/kernel/prompts.js:145`（`console.log('[MattSkillsDeck] setup-inject decision needsRepo=' …)`）、`:184`（`console.log('[MattSkillsDeck] setup-inject applied kind=' + kind)`）、`:197`（`console.log('[MattSkillsDeck] setup-inject reissued after repo ready (once)')`）。附录 1.3 的 #655 增补说明（`research/489-appendix.md:87`）说的「此前只写在两个裸控制台输出里」指的就是这一类；`:184` 至今仍与 `:185` 的正式日志点并存。

### 4.5 顺带一提：同目录的 `StatusLogMenu.js` 有一处可复用的先例

`src/client/statusbar/StatusLogMenu.js`（不在这次点名的四个文件里，但同属状态栏）有三行日志：`:32` 是 `host.call.fail`（告警，常驻 P0 第 27 号），`:45` 与 `:52` 是同一事件 `host.call`（信息，常驻 P0 第 26 号），后者用 `kind` 字段区分两条客户端路径（`'log-resolve-cache'` 与 `'log-resolve'`）。这是「同一个电话、不同入口 → 复用既有事件、用 `kind` 值区分」的现场榜样，第 5 节会用到。

## 5 结论：新流程要不要加日志点、加在哪、要不要常驻

先把纪律的五类触发条件摆出来（`AGENTS.md:38`）：跨过进程或模块边界的调用、新增的宿主接口方法（电话）、面板打开与刷新读数据的链路、新增的内存或磁盘缓存、新增的定时触发的活。只要动了其中一种，就必须同步加一条日志点。

### 5.1 新增的状态栏横幅分段（按钮点开既有的两步建仓向导）

分段本身：`checksums.js` 新增一个派生布尔量、`StatusBar.js:142` 那行 `firstBlock` 的三元链多一档。逐条对照五类触发条件：这不是跨进程/跨模块调用，不是新电话，不是新的面板读取链路，不加缓存，不加定时器——它是渲染层对已有链快照的派生，属于第 1.5 节管的渲染路径。**按规则字面，这一段本身不要求新增日志点**（而且渲染函数体内本来就不许做对象转文本，只许记枚举与编号）。

按钮那一步：`客户端 → 建仓向导 → actions.js 分发 → wf.initPublish → gh/git 子进程`，是实打实的跨进程调用。但这条路已经存在且已经有日志点：

- 宿主侧 `src/host/publishFlow.js:189` 写着 `return { handleInitPublish: loggedPhone('wf.initPublish', 'publish', handleInitPublish), handleRetryPush: loggedPhone('wf.retryPush', 'publish', handleRetryPush) }`，即每条都由既有的常驻 #26 `host.call`（信息）与 #27 `host.call.fail`（告警）承接，电话名写在 `method` 字段里。
- 它起的外部命令也各有日志点：`git` 命令经 `src/host/publishFlow.js:8` 的 `const gitExec = function (argv, cwd) { return execProc(argv, cwd, 'publish') }` 落按需 #58 `exec.run`（附录 1.5 的 via 取值表里 `publish` 一项写的就是「初始化仓库与推送（本文件里全部 git 命令）」）；`gh` 命令经 `runGh` 落常驻 #5 `gh.exec`（`publishFlow.js:37`、`:48`、`:101`、`:114`、`:154`）。
- 覆盖门禁也认这条：`wf.initPublish` 在 `tests/verify-log-coverage.js:49` 起的 `CALLEE_COVERS` 名单里。

所以：**不新增事件也能合规**。这是「没有新增事件、只新增落点」那一类，先例写得很清楚——附录 1.3 的 #620 与 #627 两条增补说明（`research/489-appendix.md:83`、`:84`）就是同一个处理办法：新加一条调用路径，日志落在既有的事件上，条数不变，只在附录里补一句落点说明。

真正可能留下的缺口不是「谁被调用了」，而是「这次建仓是从状态栏那一段点开的，还是从检查页红牌点开的」这类入口上下文。要补的话有两个现成的承载体，不需要新事件：一是 #26 `host.call` 的 `kind` 字段（同目录 `StatusLogMenu.js:45`、`:52` 就是这么区分两条路的）；二是宿主侧选择事件 #14 `registry.select` 的 `caller` 字段（#498 专门加过，`research/489-appendix.md:79`）。用哪一个、要不要加，是人的取舍，规则没有强制。

要不要 P0：如果人决定为「点了哪颗按钮、开了哪个向导」单独立一个事件，它由用户点击触发、次数少、跨边界，按 `AGENTS.md:40` 的字面倾向常驻；如果记的是「当前横幅正显示哪一段」，那它每次渲染都要算，属高频渲染路径，只能是按需（并配采样或按状态变化），不可能进常驻名单。

### 5.2 新增的注入决定分支（安装横幅按钮注入维护者原话）

这一条与上一条不同，**纪律要求它有日志点**。理由是仓库自己写下的先例：附录 1.3 的 #655 增补说明（`research/489-appendix.md:87`）为 `inject.decision` 写的存在理由就是「这条决定此前只写在两个裸控制台输出里，既不落盘也不受调试开关管，事后查『为什么点了初始化没反应』没有任何可看的轨迹」，而它计入名单的依据正是「仍是跨出插件边界往会话里写字的动作」。新的注入分支如果是「同一个按钮改注入另一段文案」，同样落在「跨出插件边界往会话里写字」这一条上。

加在哪里，取决于分支写在哪：

- 如果新分支写在 `src/client/kernel/prompts.js` 的 `injectSetupDecision` 里，最省且与现行结构一致：走既有出口的话，`:185` 那行日志自动带上新的 `kind` 取值；如果是**新的提前返回出口**，就在那个出口旁边照 `:174` 的写法补一行 `try { if (isEnabled('debug')) log('debug', 'inject.decision', { prompt: 'setupRun', kind: '…', layout: … }) } catch (eL) {}`，字段仍是 `prompt`、`kind`、`layout` 三个。
- 如果新分支写在 `src/client/statusbar/StatusBar.js:259`（现状就是那条 ghcli 按钮的 `inject(s, h)` 直接注入，不经决策函数），那就是在 `injectSetupDecision` 之外开了第二个注入出口，与 #655 定的「injectSetupDecision 是初始化文案的唯一注入出口」（同一行注释与附录 #64 的落点说明都这么写）相冲突，而且这条路上一个日志点都没有。要么把新分支挪进决策函数，要么在新落点补一行日志并说明字段。

需要同步更新的东西（**只在新增事件名时才需要**；沿用既有 `inject.decision` 就不需要）：

- 附录第 1 章第 1.5 节 #64 `inject.decision` 那一行（`research/489-appendix.md:164`）的 `kind` 枚举说明要补上新取值（现在写死的是 `setup` / `repo` / `setup-card`），顶部修订行、第 0 节结论先行、第 1.3 节增补说明、第 4 章断言六（`research/489-appendix.md:242`）随之同步。
- 若只是沿用既有事件、只多一个落点，则按 #620/#627 的先例，附录里补一句「只新增落点」即可，`tests/verify-log-fields.js` 的 `'inject.decision': ['prompt', 'kind', 'layout']`（`:82`）不用改，计数门禁也不会红——因为它只查键名，不查枚举取值。
- 若新立事件名：`tests/verify-log-fields.js` 的 `ALLOWED` 表要加一条（否则 `:222` 的「未知事件名须先更新附录与本门禁」判红），`tests/verify-log-count.js` 的数组与第 36 至 38 行的字面要改，`tests/verify-log-guards.js` 的调试级调用点要同行带 `isEnabled`，然后重跑 `tests/verify-log-*`。

要不要 P0：按 `AGENTS.md:40` 的字面（「调用次数少、跨边界的记成常驻」），用户点击触发、一次操作最多一条、又跨出插件边界——这是倾向常驻的一侧；但同一个决策函数里的兄弟决定 #64 已经定了按需，并写明了理由（`research/489-appendix.md:87`）：`级别定按需：它由用户点击触发，一次操作最多一条，但仍是跨出插件边界往会话里写字的动作，按「调用次数少、跨边界的记成常驻」这条纪律本可记常驻；这里记按需，是因为它一次会话里至多几条、且只在排查注入行为时才需要，而常驻名单的门槛是「首轮必补、始终落盘」——真机验收时若发现排查需要它常年在场，再按纪律补进常驻名单。`

两条路各有代价：沿用 #64 记按需，条数不变（常驻 31、按需 26、自监控 5、总数 62 全保持），门禁不受影响；另立新事件并定常驻，则常驻从 31 变 32，附录与计数门禁整套要改。**这正是规则明说交人定的情形**——`AGENTS.md:40` 最后一句：`拿不准该常驻还是按需时，去问总指挥，不要自己默认一种。` 本文只报告现状与代价，不代做这个决定。

### 5.3 一句话总结

新横幅分段本身不触发加日志点的要求；它按钮点开的建仓向导是既有流程，日志已由常驻 #26/#27 与按需 #58 承接，即使要补入口上下文，也是「只新增落点、不新增事件」。真正需要处理的只有注入那条分支：按 #655 的先例，它应当有日志点，最省的落法是沿用按需 #64 `inject.decision`、在 `src/client/kernel/prompts.js` 的 `injectSetupDecision` 里照 `:174` 的写法补一行；至于「沿用按需」还是「另立常驻」，规则要求问总指挥，不要自己选。
