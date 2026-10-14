# 地图03讨论底稿：名字怎么进入对话（注册与装配六件的现状、约束、失败路径）

> 只读调研，为 issue #1030（地图03讨论）打底，不写产品代码，不动 issue 正文。
> 调研日期：2026-10-13；基线提交：`d0fdb277 目录归位：deck 工具与 tracker 三房按目标树一次搬完（#1019）`（`git log` 首行）。
> 路径说明：任务书写的六个旧路径在基线之后已不存在，内容已搬进新树。旧→新对照以 `research/1010-migration-map.json:225-286` 与 `research/1010-adversarial-coverage-files.txt:8-14` 为准，正文每节同时写旧路径与新路径，行号一律指新树文件现状。

## 一、现状（每个文件一段）

### 1. 注册选项与参数翻译：`src/deck/registration/register-options.ts`（旧 `src/shared/deck-tools/agent-register.js`，全长 437 行）

- 这个文件只做“把工具定义翻译成注册表能收的注册选项”，自己不读写后端、不起进程（文件头 `src/deck/registration/register-options.ts:1-6`）。
- 参数翻译规则只有三条，译失败回空是故意的容错：必填数组转成按属性的必填标记，对象节点必带显式的 `additionalProperties`（原文没写就按“开”处理，和今天不校验时的行为一致），注册表不认的键直接丢掉；任何一步译不出来回 `null`，调用方记缺件、不硬上（`src/deck/registration/register-options.ts:24-63`；顶层入口 `toAgentParameterSpec` 空属性即无参工具，子项任一失败整表回 `null`，见 `:69-80`）。
- 注册选项拼装同样失败回空：名字或描述缺失、参数表译不出，`buildAgentToolOptions` 回 `null`（`src/deck/registration/register-options.ts:217-224`）。
- 输出形状有两份同一内容：官方写法 `deckAgentOutputSpec`（必填按属性标，`src/deck/registration/register-options.ts:178-190`）与退路原生写法 `deckAgentOutputSchemaRaw`（必填写成字符串数组挂在对象节点上，`:198-211`）。注释写明退路存在的原因是 2026-09-26 真机验证时官方写法被注册表当场拒绝（`:192-197`）。
- 渲染交给模型的全部内容是一句摘要加提示加明细，提示排在明细前面，明细有 8000 单段与 60000 总量两道上限，超了原地写明截断（`src/deck/registration/register-options.ts:82-87`、`140-171`）。
- 批量注册 `registerDeckAgentTools` 在有 `defineTool` 时走官方写法，没有时走退路原生形状；返回 `{registered, missing, reason}`，`reason` 空串表示全交出去了；空表、服务不在、表里没有可执行的 `run`、拼不出选项、注册表拒绝，全部记进 `missing` 再返回，不抛错，宿主不因此起不来；重复调用是安全的（`src/deck/registration/register-options.ts:306-362`）。
- 自举钩子 `hookDeckAgentTools` 是防御式即发即忘：表与工具服务都可重试等待，缺省五轮、每轮 2000 毫秒；任何一步走不通只吞掉，终点经 `report` 回报一次（`src/deck/registration/register-options.ts:393-437`）。
- 报告 `makeDeckRegisterReport` 只落在既有事件上：交出去至少一个记 `info` 的 `host.call`，一个没交出去记 `warn` 的 `host.call.fail`，原因只记散列不记原文（`src/deck/registration/register-options.ts:370-383`）。
- 单次执行允许的最长时间是 120000 毫秒，注释说是盖住批量建票在正常网络下的最坏情况（`src/deck/registration/register-options.ts:15-16`）。
- 探针只报有无不报值：`PROBE_SERVICES` 14 个键（`src/deck/registration/register-options.ts:238`），定义 `probeDefinition` 不要参数（`:241-245`），`probeServices` 只记有无（`:248-256`）。

### 2. 行模块：`src/deck/registration/agent-row.ts`（旧 `src/host/platform/deckToolsRow.js`，全长 341 行）

- 这一行跑在 agent 层，职责是把九个工具定义以纯数据对象形状交出去，与宿主插件那一行互不干扰；住在平台区是为了不新增宿主层内部引用边（`src/deck/registration/agent-row.ts:1-9`）。
- 不引用工具包是故意的：发布清单里带上工具包依赖会多装一份，真机上全部工具调用一起失败（`Cannot read properties of undefined (reading 'prepare')`，摘掉即恢复，见 2026-09-26 交接记录），所以只交纯数据对象（`src/deck/registration/agent-row.ts:11-18`）。
- 行模块读九个工具文件的 `definition`（`src/deck/registration/agent-row.ts:19-29`），变量名仍叫 `SEVEN` 但数组里实际是九个定义（`:34`）。
- 注册入口 `apply` 要求 `ctx.tools.register` 是函数，否则直接抛错；逐个经 `toRawRegistration` 拼原生形状，拼不出的跳过，注册时抛错的也跳过；最后另注册一个探针工具（`src/deck/registration/agent-row.ts:319-341`）。
- 代执行 `makeDelegatedExecute` 有三条路由：先同进程共享格，再直连调用面，再同源请求，都不通才回诚实占位；会话目录只从调用方上下文里取，不从模型参数里取（`src/deck/registration/agent-row.ts:156-160`、`276-317`）。
- 超时与中止一律收成做不到的三态，不抛：中止回 `aborted`，参数非对象回 `bad-args`，无会话线索直接走诚实占位（`src/deck/registration/agent-row.ts:280-291`）。同进程格等待用 25000 毫秒（`:296`），跨进程时格子是空的直接跳过（`:293-306` 注释）。
- 会话线索取值口径与壳的 `sessionContextOf` 同源，另加 `header` 位，因为真机探针证明目录住在 `header` 里（`src/deck/registration/agent-row.ts:162-202`）。
- 探针扩展只加在行里：旧的 14 个有无原样保留，新加的只报键名与有无，不报任何值；还带一次干跑，只报阶段码与状态码，正文一律不报（`src/deck/registration/agent-row.ts:38-42`、`58-139`）。

### 3. 宿主装配：`src/deck/registration/host-assemble.ts`（旧 `src/host/platform/deckToolsAssembly.js`，全长 117 行）

- 这个文件只做一件事：把九个工具文件里的工厂函数读进来，交给共享层的装配口 `createDeckTools` 装成一张表（`src/deck/registration/host-assemble.ts:1-7`）。
- 住在平台区不是因为与操作系统有关，而是为了守住“不给宿主层新增 7 条同层边”的形状（`src/deck/registration/host-assemble.ts:8-18`）。
- 九个工厂顺序与 `plan.js` 的 `DECK_TOOL_ORDER` 一致（`src/deck/registration/host-assemble.ts:37-47`），九个文件清单另存 `DECK_TOOL_FILES` 供门禁与排查一眼看见（`:49-60`）。
- 装配入口 `createDeckToolsForHost` 把接线方现取现传的依赖原样递给 `createDeckTools`，自己不判断业务；依赖含闸、注册表、额度、算账、会话到句柄、后端上下文、写后失效缓存等，与门禁里直接喂给工厂的那一份同形（`src/deck/registration/host-assemble.ts:62-67`、`116`；接线方实际给全的位置见 `src/host/refresh/wiring.js:329-357`）。
- 声明文件缺席时的兜底由装配层现拼：经文件服务读 `docs/agents/issue-tracker.md`，与探测器同路径同口径解析，未注册的标识只透传文本结论（`src/deck/registration/host-assemble.ts:89-115`）。读取用 `withCap` 加 8000 毫秒上限（`src/deck/registration/host-assemble.ts:71-77`、`98-101`，常量 `:77`）。
- 双命中保护写口当前恒回空：多命中或身份待定时不许猜，由调用方如实拒绝并引导去面板选一次；旧的自动写 GitHub 默认值已删（`src/deck/registration/host-assemble.ts:78-85`）。
- 本文件自己不记日志，调用日志由共享壳落在既有 `host.call` 与 `host.call.fail`（`src/deck/registration/host-assemble.ts:19-21`）。

### 4. 宿主代执行：`src/deck/registration/host-delegate.ts`（旧 `src/host/platform/deckExec.js`，全长 95 行）

- 这条电话只做一件事：替 agent 层把工具真正跑一次，跑的是宿主里同一张表、同一份闸、同一个账本（`src/deck/registration/host-delegate.ts:1-7`）。
- 入口 `createDeckExec` 的依赖全部显式传入（`getTable` 与 `logCtx`），由宿主入口动态引入接线（`src/deck/registration/host-delegate.ts:36-39`；接线点 `src/host/index.js:238-240`）。
- 失败一律回做不到的三态，不抛：工具名不在 `DECK_TOOL_ORDER` 里回 `bad-args`，参数非对象回 `bad-args`，拿不到工作区目录回 `no-session-context`，表没装好回 `not-wired`，内部抛错或回包形状不对回 `backend-threw`（`src/deck/registration/host-delegate.ts:57-87`）。
- 日志沿用既有的 `host.call` 与 `host.call.fail`，不新增事件名；成功与部分成功记 `host.call` 带耗时，失败记 `host.call.fail` 带原因散列（`src/deck/registration/host-delegate.ts:11`、`41-46`、`88-91`）。
- 本文件自己没有超时数字：超时由注册选项的 120000 毫秒（`src/deck/registration/register-options.ts:16`）与行模块的同进程格等待 25000 毫秒、直连与同源请求的 120000 毫秒（`src/deck/registration/agent-row.ts:250`、`296`）承担。

### 5. 剩余额度同步：`src/deck/registration/quota-sync.ts`（旧 `src/host/platform/deckQuotaSync.js`，全长 126 行）

- 只讲一件事：闸的裁决要看剩余额度，而读数原来没有任何一路写入，重启后恒为零；修法不是改裁决数字，而是把设计好的同步接上（`src/deck/registration/quota-sync.ts:1-13`）。
- 读数来源是免费的 `gh api rate_limit`：经闸打一次 `quota-read`（恒放行、不扣配额），读数落账后再走原流程（`src/deck/registration/quota-sync.ts:8-11`；接线把 `gate.send`、`ledger.syncDue`、`ledger.syncServer`、`gate.noteRetryAfter`、`runGh` 递进来的位置见 `src/host/refresh/wiring.js:109-119`）。
- 解析要求两桶齐全：`resources.core` 与 `resources.graphql` 的 `limit`、`remaining`、`reset` 缺任何一格都算失败回 `null`（`src/deck/registration/quota-sync.ts:20-42`）。
- 动手前 `ensureReading` 先问账本差不差读数，不差直接过，差才打一次；任何一步走不通都回不成功，调用方照旧走原流程（闸会诚实推迟）；本函数永不抛（`src/deck/registration/quota-sync.ts:108-123`）。
- 节流有两道：进程里 60 秒最多打一次（冷却缺省 60000 毫秒，成功清零、失败记时，冷却内直接认失败），并发调用只打一次（本实例内并单 `flying`）（`src/deck/registration/quota-sync.ts:11`、`54-55`、`63-106`、`117`）。
- 三种失败（`gh` 不在、没登录、解析不出）都认失败并让原流程照旧被闸推迟，如实、不抛、不替工作区攒失败计数（`src/deck/registration/quota-sync.ts:12-13`、`75-95`）。
- 读数里哪一桶剩 0，就按服务端给的重置时刻降档到那时为止；拿不到正秒数就不报（`src/deck/registration/quota-sync.ts:81-93`）。
- 日志不新增：成功记既有 `host.call`（`deck.quotaSync`），失败靠既有的 `gh.exec` 那几行（`src/deck/registration/quota-sync.ts:17`、`57-61`）。接线层另加 15000 毫秒的外层超时，超时按保不住走老路（`src/host/refresh/wiring.js:29`、`124-131`）。

### 6. 沙箱判定：`src/deck/registration/sandbox-guard.ts`（旧 `src/host/platform/deckSandbox.js`，全长 29 行）

- 输入是 `{cwd, sessionId}`，输出是 `Promise<{policy, sessionId}>`；口径与电话侧 `resolveSandboxPolicy` 同源（`src/deck/registration/sandbox-guard.ts:1-6`）。
- 判定顺序：显式会话号优先，否则按工作区根找唯一归属会话；归一规则是统一斜杠、去尾斜杠、转小写；同目录精确命中恰好一个才认，无精确命中时子目录包含恰好一个才认；无归属回空，不自己拼宽松政策（`src/deck/registration/sandbox-guard.ts:9-23`）。
- 任何缺件与抛错都收成 `{policy: undefined, ...}`：沙箱服务不在、无 `resolve`、会话服务不在、查不到会话、`resolve` 抛错、外层抛错，全部如此，永不抛（`src/deck/registration/sandbox-guard.ts:11-27`）。
- 接线位置有两处：一处是工具接线递给装配口的 `sandboxPolicyFor`（`src/host/refresh/wiring.js:342`），另一处是宿主入口检查链的同源内联实现（`src/host/index.js:137` 起）。后者与本文件逻辑同源但不是同一份引用。

## 二、改造约束

- 地图03的目的与边界以计划层口径为准：目的是让 AI 在对话里第一次能看见这个工具；边界是名字怎么进入对话（注册选项、行模块、宿主装配与代执行）；做完是九个名字可用、与实现同一张表、额度与沙箱判定不变；交给下一环是一张装好的工具表（`research/1010-ticket-structure.md:211`）。
- 先后顺序按编号保留：03/04 先冻对外形状，再做 05 里面；给 #1039 加一条硬约束是壳的拆分不得改动工具入口用到的 `import` 路径，同路径换实现，03/04 不需要二次返工（`research/1010-adversarial-fixes.md:29`）。
- “行为零变化”有可判的定义：对外可观测三样是对上层返回的结构与字段值、落盘数据的字节内容、`tests/verify-*` 的通过集合；日志与注释不计入行为（`research/1010-adversarial-fixes.md:35-36`）。
- 门禁口径是本票相关门禁全绿，且全仓红点不比开工时多；现行链上与 deck 无关的红如实记在 #1010 笔记里，不塞给 deck 的票（`research/1010-adversarial-fixes.md:37`）。
- 日志按 `AGENTS.md` 日志埋点纪律的垃圾四条判；注释只判公开函数、类型、关键分支有中文原因句，不判行数（`research/1010-adversarial-fixes.md:38`）。
- 讲解票保留 15 张、内容分单元；11 张逐字相同的三看问句改成本单元的具体问题；每张讲解票的产出必须汇进同一份全程索引，不能只是一场对话（`research/1010-adversarial-fixes.md:45`）。
- 三类票票面各加一句边界以本图讨论票结论为准；#1010 正文加一条票面只保证目的与做完，边界以讨论票结论为准（`research/1010-adversarial-fixes.md:47`）。
- #1031 票面已按落地记录补过文件清单（`research/1010-adversarial-fixes.md:71`）。
- 讨论票 48 小时没回话就按票面默认走，并在评论记默认执行加日期（`research/1010-adversarial-fixes.md:43`；规格同口径见 `specs/1010-ts-rewrite-spec.md:28` 用户故事 6）。
- 六件在迁移映射表的登记是六条 `move-rename`：`agent-register.js → registration/register-options.ts`、`deckToolsAssembly.js → registration/host-assemble.ts`、`deckToolsRow.js → registration/agent-row.ts`、`deckExec.js → registration/host-delegate.ts`、`deckQuotaSync.js → registration/quota-sync.ts`、`deckSandbox.js → registration/sandbox-guard.ts`（`research/1010-migration-map.json:225-286`；逐份清单同口径见 `research/1010-adversarial-coverage-files.txt:8-14`）。
- 零变化验收在规格里是四条用户故事：每个单元的完成判据是死的（相关门禁全绿、行为对照有证据）（`specs/1010-ts-rewrite-spec.md:31`）；行为零变化的对照证据是同一输入新旧产出一致（`:32`）；AI 既有用法的三样不变（同样的参数、同样的三态回执、同样的必备标签与进度区自动补全）（`:46`）；工具写得不对时回执仍然诚实（`:47`）。测试缝在工具表这一层，喂调用、看三态回执（`:131`）；迁移期每个单元要求相关门禁全绿加行为对照证据（`:138`）；日志验收是每个单元一次只看日志定位演练（`:140`）。范围外是客户端行为只跟随路径改名轻微适配（`:144`）与 GitLab 房只改名不转写（`:145`）。
- deck 重构词条：改写单元是一个 issue 负责的一段源码，对应一次旧 JavaScript 变成 TypeScript 的落地与一次讲解；讲解三看是方法封装、参数形状、边界与失败路径三个请维护者表态的位置（`CONTEXT.md:144-148`）。
- 日志体系词条：现行条数以 `research/489-appendix.md` 第 1 章对照表为准；令牌与登录态原文永不落盘，路径与仓库地址不记原文（`CONTEXT.md:87-91`）。
- TypeScript 优先：以后动到手写代码一律优先用 TypeScript 写，存量 JavaScript 不单独立项重写，动到哪里转到哪里；以文件为单位，先修后转、两次提交，不再新增手写 JS，转完行为零变化（`AGENTS.md:44-48`）；转完接上构建（`tsconfig` 的 `include` 与 `scripts/build.mjs` 清单，`target ES2020`、`strict`、`noEmit` 加 `esbuild` 转译，`tsc -p`、构建、相关 `tests/verify-*` 与冒烟跑通才算完）（`AGENTS.md:49`）；注释用中文完整句写清为什么与不能改的约定（`AGENTS.md:50`）；转完顺手加日志，以排查优先、多记但无垃圾为准（`AGENTS.md:51`）。
- 日志埋点纪律：只在进程或模块边界、持久化边界、时间边界留整趟轨迹；垃圾四种一律不加；可重放的凭证原文永不落盘；纯重构注释类型迁移免演练，增删事件同步改 `research/489-appendix.md` 第 1 章对照表（`AGENTS.md:75-82`）。
- 人类第一次阅读就能准确理解是第一标准：只用 `CONTEXT.md` 词典或已确立含义的词语，新概念写成完整平实的描述，不造当次会话才明白的速记（`AGENTS.md:23-30`）。

## 三、失败路径（今天的代码行为）

### 1. 注册失败（`defineTool` 传不进来）

- 接线今天固定传 `null`：`src/host/refresh/wiring.js:306-309` 写明插件不 `import` 框架包，`loadDefineTool` 固定给 `null`，走原生形状直接注册；退路输出与参数形状见注册文件。
- `defineTool` 不在时走退路分支：参数用定义里编好的那份原样交，输出用原生形状，行为一致，只是少了调前的参数预检，而参数非对象这一档执行入口自己拦（`src/deck/registration/register-options.ts:296-301`、`335-348`）。
- 拼不出选项记缺件：`buildAgentToolOptions` 回 `null` 时记 `unsupported-definition`（`src/deck/registration/register-options.ts:326`）；退路分支里名字、描述、参数任一缺失同样记 `unsupported-definition`（`:338-340`）。
- 注册表拒绝记缺件：`toolsSvc.register` 抛错时把错误文本前 200 字符记进 `missing`，继续交下一个（`src/deck/registration/register-options.ts:350-355`）。
- 服务不在与表不在分开标：空表回 `empty-table`，服务不在回 `no-tools-service` 并把全部名字记进 `missing`（`src/deck/registration/register-options.ts:312-315`）。
- 自举时服务晚就绪会等：缺省五轮、每轮 2000 毫秒，用完认了并回报 `no-tools-service`；表晚就绪同样等，拿不到回报 `no-table`（`src/deck/registration/register-options.ts:415-420`、`405-414`）。
- 报告只记散列：失败原因只记散列不记原文，缺依赖与跑起来失败分开标（`missing-dep` 与 `throw`）（`src/deck/registration/register-options.ts:378-380`）。

### 2. 装配缺件

- 装配缺注册表直接回空表：`src/host/refresh/wiring.js:314-315` 在注册表不在或没有 `select` 时回 `{tools:{}, names:[], definitions:[], missing:[], reason:'no-registry'}`。
- 装配抛错收成 `assembly-failed`：`src/host/refresh/wiring.js:358` 在装配 promise 抛错时回空表并带 `reason:'assembly-failed'`。
- 声明文件读不到按缺席跳过：装配层现拼的 `readDeclarationId` 在文件服务缺席、读失败、解析无显式后端、抛错时一律回 `null`，未注册的标识只透传文本结论（`src/deck/registration/host-assemble.ts:92-114`）。
- 保护写口恒回空：`createDoubleHitProtector` 返回的函数恒回 `null`，由调用方如实拒绝并引导去面板选一次（`src/deck/registration/host-assemble.ts:78-85`）。
- 行模块缺定义跳过：`toRawRegistration` 在名字、描述、参数任一缺失时回 `null`，`apply` 循环里跳过（`src/deck/registration/agent-row.ts:141-154`、`323-329`）。

### 3. 额度同步失败

- 依赖缺失直接认失败：`send`、`runGh`、`syncServer` 任一不是函数时 `doSync` 回 `missing-dep`（`src/deck/registration/quota-sync.ts:70`）；账本两件都不在时 `ensureReading` 回 `missing-dep`（`:116`）。
- `gh` 起不来或解析不出只记失败：`perform` 内永不抛，不进工作区的失败退避计数（`src/deck/registration/quota-sync.ts:73-96`）；落账没写成回 `sync-empty`，外层抛错回 `sync-threw`（`:99-101`）。
- 冷却内直接认失败：上次失败 60 秒内回 `sync-cooldown`（`src/deck/registration/quota-sync.ts:117`）。
- 调用方照旧走原流程：任何不成功都由闸诚实推迟，同步函数永不抛（`src/deck/registration/quota-sync.ts:108-123`）；接线层再包一层 15 秒超时，超时按 `sync-timeout` 走老路（`src/host/refresh/wiring.js:124-131`）。

### 4. 沙箱误判

- 无归属回空，不拼宽松政策：按工作区根找不到唯一归属会话时回 `{policy: undefined, sessionId}`（`src/deck/registration/sandbox-guard.ts:23`）。
- 服务缺席回空：沙箱服务不在或无 `resolve` 时回 `{policy: undefined, sessionId}`（`src/deck/registration/sandbox-guard.ts:11`）。
- 会话多选一不清时回空：同目录精确命中不是恰好一个、且无精确命中时包含不是恰好一个，都不认，直接回空（`src/deck/registration/sandbox-guard.ts:21`）。
- `resolve` 抛错回空：`svc.resolve` 抛错时 `policy` 置空（`src/deck/registration/sandbox-guard.ts:24`）；外层任何抛错同样收空（`:27`）。
- 归一大小写折叠是判定的一部分：比较前统一斜杠、去尾斜杠、转小写（`src/deck/registration/sandbox-guard.ts:15`）。

## 四、未定项（需要问维护者的事，不要自己定）

1. 七与九哪个是 #1031 的 scope：六件文件头与变量名多处写“七个工具”（`src/deck/registration/register-options.ts:1`、`src/deck/registration/agent-row.ts:5-8`、`src/deck/registration/host-delegate.ts:3`、`src/host/refresh/wiring.js:300-301`），而装配清单与行数组里实际是九个（`src/deck/registration/host-assemble.ts:37-47`、`src/deck/registration/agent-row.ts:34`），地图03口径是九个名字可用（`research/1010-ticket-structure.md:211`）。请维护者定 #1031 是按九个做，还是另有七个的所指。
2. 沙箱判定的两份同源实现要不要合一：新树 `src/deck/registration/sandbox-guard.ts:6-28` 与宿主入口 `src/host/index.js:137` 起的内联实现逻辑同源但不是同一份引用。请维护者定 #1031 是否把入口那份改成调新树那份，还是保持两份各自存在。
3. 代执行自己没有超时数字是否保留：今天超时全靠注册选项的 120000 毫秒与行模块的三路等待（同进程格 25000 毫秒见 `src/deck/registration/agent-row.ts:296`，直连与同源请求 120000 毫秒见 `:250`），`src/deck/registration/host-delegate.ts` 自己不计时。请维护者定 #1031 是否保持这个分工。
4. 三个超时数字是否一起转写：工具注册 120000 毫秒（`src/deck/registration/register-options.ts:16`）、装配声明文件读取 8000 毫秒（`src/deck/registration/host-assemble.ts:77`）、接线层保读数 15000 毫秒（`src/host/refresh/wiring.js:29`）。请维护者定转 TypeScript 时数字与位置都不动，还是趁机调。
5. `defineTool` 退路是不是主路径：接线今天固定给 `null`（`src/host/refresh/wiring.js:306-309`），退路即线上实际走的路。请维护者定 #1031 的类型与测试重心放在退路还是两条路同等对待。
6. 日志事件名是否冻结：注册结果用 `deck.agentRegister`（`src/deck/registration/register-options.ts:376-380`），代执行用 `wf.deckExec`（`src/deck/registration/host-delegate.ts:41-46`），额度同步用 `deck.quotaSync`（`src/deck/registration/quota-sync.ts:59-61`）。请维护者定转写时事件名与字段一字不动，还是允许顺手规范。
7. 文件头里“七个工具”的说法要不要在 #1031 里改成九个：涉及 `src/deck/registration/register-options.ts:1`、`src/deck/registration/agent-row.ts:5`、`src/deck/registration/host-delegate.ts:3` 三处中文注释。请维护者定是 #1031 顺手改，还是另立文字票。
