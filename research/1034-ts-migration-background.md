# 地图 04 讨论背景：九个工具对外形状冻死，再转十个文件为 TypeScript

## 0. 目的、问题边界、与相邻票的关系

**目的**：为 #1034（地图 04 的讨论票）提供背景材料，让讨论时只对焦“九个 deck 工具的对外形状要冻死哪些条目、十个文件转 TypeScript 时什么能动什么不能动”。本文件是只读调研，不下结论代替讨论。

**问题边界**：只讨论，不改代码。本文不改 `src/` 下任何文件，不动任何 issue。所有结论来自一手来源（本仓源码、配置、契约、金标准回执、TypeScript 与 Node 官方文档），每节结论后标注来源。

**与 #1033 / #1035 的关系**：
- #1033 是地图 03（注册与装配，`src/deck/registration/` 6 件）的讨论票，决定工具定义如何被翻译成宿主注册表写法。本文引用它的输入输出边界，但不重复讨论注册表内部。
- #1034 是地图 04（九个工具的入口，`src/deck/tools/` 10 件）的讨论票，本文直接服务它。
- #1035 是地图 05（工具壳，`src/deck/shell/` 10 件）的讨论票，决定壳的预算、互斥、游标等实现细节。本文把“壳提供的能力”当作已冻结的前提，只列出工具侧必须遵守的形状，不替 #1035 做决定。

- 来源：`research/1010-ticket-structure.md`（地图 03/04/05 的划分与顺序）、`docs/adr/20261011-deck-ts-rewrite.md`（开工顺序与目录划分）

**一个先说清的事实**：任务描述里写的“现状是全通的 JS”（`src/host/tools/deck*.js` 共 9 个加 `src/shared/deck-tools/plan.js`）描述的是旧树。主干上这 10 个文件已经不在旧位置：9 个工具已经是 `src/deck/tools/*.ts`，壳已经是 `src/deck/shell/*.ts`。旧 JS 只在打包产物与旧工作树里留作对照。所以 #1034 讨论的真实对象不是“把 JS 文件改名”，而是“确认当前 TypeScript 入口的对外形状与旧 JS 行为逐字等价，并把对照面写死”。

- 来源：`src/deck/tools/`（当前 9 工具加 `tool-order.ts`、`tool-table.ts` 共 11 件）、`src/deck/shell/`（当前 10 件）、`package/shared/deck-tools/`（旧 JS 产物对照）、`.worktrees/963-*/src/host/tools/deck*.js`（旧工作树对照）

---

## 1. 本仓现状：转写时必须冻死的对外清单

### 1.1 九个工具的调用顺序（冻死）

九个工具的对外顺序是固定的，宿主按此顺序装配与展示：

`deck_context`、`deck_issue_get`、`deck_map_snapshot`、`deck_issue_list`、`deck_issue_create`、`deck_map_plan_create`、`deck_map_link`、`deck_issue_patch`、`deck_issue_report`

- 来源：`src/deck/tools/tool-order.ts`（`DECK_TOOL_ORDER` 数组）

### 1.2 每个工具的参数名、必填、枚举、缺省（冻死）

下表是“讨论时逐项念一遍、有一项对不上就不准转”的清单。`required` 为空数组表示无必填参数，但 `additionalProperties: false` 本身也是冻死的（多传一个键就拒绝）。

| 工具 | 必填 | 参数、枚举与缺省 |
| --- | --- | --- |
| `deck_context` | 无 | 无参数，`properties: {}`。调用时并行做三件事：预检、列地图、读仓库权限，回执里带限额与长指引。 |
| `deck_issue_get` | `key` | `comments` 数字缺省 50；`section` 字符串缺省全文前 2000 字，找不到指定小节就回空、不猜；`blocking` 布尔缺省要反向边，传 `false` 跳过一次全仓扫描、反向边记空；`effortId` 字符串，本地后端必填。 |
| `deck_map_snapshot` | `key` | `detail` 枚举 `full`/`thin` 缺省 `full`（`thin` 只要键、标题、状态、标签、认领人、阻塞关系，不要正文与进度，但统计与进度表照算）；`frontierOnly` 布尔缺省全量；`effortId` 同上。 |
| `deck_issue_list` | 无 | `state` 枚举 `open`/`closed`/`all` 缺省 `open`；`type` 枚举 `issue`/`map`/`all` 缺省 `all`；`labels` 数组表示同时满足；`assignee`、`query` 字符串；`limit` 数字缺省 50，钳在 1 到 200 之间；`effortId` 同上。 |
| `deck_issue_create` | `title` | `kind` 枚举 `task`/`bug`/`map` 缺省 `task`；`body`、`parentKey`、`labels`、`assignees`、`idempotencyKey`、`effortId`。 |
| `deck_map_plan_create` | `title`、`children` | `children` 每项必填 `key`、`title`，`kind` 枚举同上；`edges` 每项必填 `from`、`to`，类型枚举 `blocked-by`/`parent`，`from` 可写 `@map` 表示地图自己；`planId` 缺省由幂等锚推导；`labels`、`effortId`。 |
| `deck_map_link` | 无（但 `key` 与 `edges` 二选一，两个都空就回参数错误） | `key`、`parentKey`、`blockedBy` 数组（整批替换语义）、`edges` 每项必填 `key`、`effortId`。不同票并行、同票串行。 |
| `deck_issue_patch` | `key` | `comment`、`addLabels`、`removeLabels`、`assignees`（整批替换，空数组表示取掉认领）、`title`、`body`、`progress`（只换进度小节）、`close` 布尔、`effortId`。 |
| `deck_issue_report` | `key` | `note` 不超过 200 字、只回显不进调用链；`effortId`。先校验票存在，再记调用链，记不上就走老路、不报错。 |

- 来源：`src/deck/tools/context.ts`、`src/deck/tools/issue-get.ts`、`src/deck/tools/map-snapshot.ts`、`src/deck/tools/issue-list.ts`、`src/deck/tools/issue-create.ts`、`src/deck/tools/map-plan-create.ts`、`src/deck/tools/map-link.ts`、`src/deck/tools/issue-patch.ts`、`src/deck/tools/issue-report.ts`（各文件的 `definition` 段）

### 1.3 返回信封（冻死）

每个工具的回执都是同一个信封形状，字段一个不能多、一个不能少：

- 顶层：`tool`（工具名）、`status`（`ok`/`partial`/`unsupported` 三选一）、`ok`（布尔，与 `status` 一致）、`reason`（机器可读的原因码，成功时为空字符串）、`text`（给人读的一句话）、`backend`（`{id, source}`）、`repo`（`{backend, refId, name, url}`）、`workspace`（`{root, key, sessionId, source}`）、`data`（各工具自己的数据）、`items`、`notes`、`readBack`（写后读回，无写操作时为 `null`）、`touched`、`cost`（`estimated` 与 `actual`，含点数、请求数、是否在硬顶内、剩余、档位）、`claimed`（透出记账点数，见下节）。
- 状态只有三种：`ok`（全成）、`partial`（部分成，如逐项改票时有成有败）、`unsupported`（后端明确不支持）。失败不抛异常，一律转成信封回出去。
- 原因码是固定字符串：`no-session-context`（无会话）、`ai-tool-refused`（超限额）、`no-backend`（无后端）、`gate-defer`（闸推迟）、`backend-threw`（后端抛错）、`backend-unsupported`（后端不支持）、`bad-args`（参数错）。

- 来源：`src/deck/shell/call-shell.ts`（`envelope`、`mergeOutcome`、`DECK_STATUS`、`REFUSAL_REASONS`）、`tests/tracker-contract/fixtures/golden-receipts/01-deck_context.golden.json`（信封实例）

### 1.4 记账点数 claimed（冻死）

每次调用透出的记账点数是行为的一部分，转写时不能变。已核实的点位：`deck_context` 花 3 条请求、2 点；`deck_issue_list` 失败 1 条 3 点、成功 2 条 5 点；`deck_issue_create` 建失败 1 条 4 点、读回等 3 条 6 点；`deck_issue_get` 是否要反向边决定是 2 条 6 点还是 1 条 3 点。讨论时要把剩下工具的点数逐个念出并写入对照表。

- 来源：`src/deck/tools/*.ts`（各文件 `claimed` 段）、`src/deck/shell/call-shell.ts`（`claimed` 透出逻辑）

### 1.5 可以动的实现细节（不冻）

以下内容是壳与工具内部的做法，转 TypeScript 时可以换写法，只要对外清单不变：

- 超时钳制：工具总超时 120000 毫秒、留边 10000 毫秒、单操作 30000 毫秒；缺席超时按 8000 毫秒竞速补引用。
- 沙箱等待与预算：`withCallScope` 返回的记忆、预算、剩余时间计算；超时、中止、超预算时回诚实语（`timeout`/`aborted`/`over-budget`）。
- 内部函数：幂等锚哈希、游标读写、互斥队列、标签补全、正文小节替换、边落点判定等，只要输入输出不变，内部可用更地道的 TypeScript 重写。
- 日志与注释：按全仓纪律补中文注释与边界日志，不计入对外形状。

- 来源：`src/deck/shell/call-shell.ts`、`src/deck/shell/call-budget.ts`（`withCallScope`）、`src/deck/shell/write-mutex.ts`（`withKeyLock`）、`src/deck/shell/plan-cursor.ts`（游标）、`src/deck/shell/minimal-spec.ts`（锚与补全）、`src/deck/shell/edge-landing.ts`（边落点）、`src/deck/registration/register-options.ts`（`AGENT_TOOL_TIMEOUT_MS`）

---

## 2. 权威 TypeScript 与 Node 项目做法

### 2.1 编译选项：`strict` 为底，`isolatedModules` 与 `verbatimModuleSyntax` 防迁移坑

- **强推荐**：保持 `strict: true`。它是所有严格检查的总开关，转写全程靠它把空值、隐式 `any`、未处理分支拦在编译期。本仓两个已落地的契约配置（客户端与契约）都已开 `strict`，地图 04 的十个文件沿用即可。
- **强推荐**：开 `isolatedModules`（或等价的按文件转译假设）。本仓构建用 esbuild 按文件转译（见构建脚本），跨文件类型推导指望不上。`isolatedModules` 会提前报错“需要跨文件信息才能转的写法”（如转译器各说各话的枚举与命名空间），避免“`tsc` 能过、esbuild 产物跑偏”。
- **可二选一**：`verbatimModuleSyntax` 开与不开都可，但开了更省心。它要求类型引用写 `import type`，杜绝“引用一个类型却在运行时留下空导入”。本仓已禁止同层互引，类型只能从契约层来，顺手写 `import type` 代价很小。

- 来源：`tsconfig.client.json`、`tsconfig.contract.json`（`strict: true`、`target ES2020`、`noEmit` 加 esbuild 转译口径）、`scripts/build.mjs`（esbuild 按文件转译）、`https://www.typescriptlang.org/tsconfig/#strict`、`https://www.typescriptlang.org/tsconfig/#isolatedModules`（官方 tsconfig 文档）

### 2.2 运行环境：ESM 写法、`node:` 前缀、Promise 计时器

- **强推荐**：导入一律带文件扩展名、用 `node:` 前缀引用内置模块（`node:timers/promises` 而非裸 `timers`）。这是 Node ESM 的强制规则，相对路径缺扩展名在 ESM 下直接失败，与 CommonJS 行为不同。
- **强推荐**：超时与取消用 `node:timers/promises` 加 `AbortSignal`（`signal` 传进去、取消时按 `AbortError` 处理），而不是手写 `setTimeout` 回调接力。官方文档明确给出“传 `signal`、按 `AbortError` 接住”的标准形状，与本仓“超时不抛、回诚实语”的约定正好对上。
- **不建议**：在工具入口里用 `__dirname`、`require`、`module.exports`。ESM 下它们不存在，对应物是 `import.meta.dirname` / `import.meta.filename` / `import`。本仓构建把源码拼成闭包，这些 CommonJS 变量迟早失效。

- 来源：`https://nodejs.org/api/esm.html`（Node ESM：扩展名强制、`node:` 前缀、与 CommonJS 互操作、`import.meta`）、`https://nodejs.org/api/timers.html#timerspromisessettimeoutdelay-value-options`（`timers/promises` 的 `signal` 与 `AbortError` 约定）

### 2.3 类型放哪：共享契约层，工具内只放窄化后的入参与出参

- **强推荐**：跨工具共享的形状（信封、分页、票、边、后端、成本）只放在契约层（`src/tracker/contract/`），工具文件用 `import type` 引用，不许自立第二套。这是开工顺序决议（先定契约接口、两房对上、再自上而下转）定死的单向引用：工具引用契约、契约不引用工具。
- **可二选一**：单个工具独有的入参形状可以内联在工具文件里，但必须是从契约类型的窄化（`Pick`/`Extract`），不得重写一份同名不同义的类型。

- 来源：`docs/adr/20261011-deck-ts-rewrite.md`（契约先行、单向引用）、`src/tracker/contract/`（`ports.ts`、`operations.ts`、`backend-module.ts`、`operations-catalog.ts`）、`scripts/typecheck.mts`（层级边界由依赖图守、tsconfig 禁不了向上引用）

### 2.4 运行时校验放哪：手写守卫，拒绝引入 zod 或 io-ts

- **强推荐**：参数校验用手写守卫（判空、判枚举、判范围、钳 `limit`），不引入 `zod`/`io-ts` 等运行时校验库。理由有三：本仓参数形状很浅（枚举加缺省加钳制），手写十几行足够；引入新依赖要过构建闭包与发布链，代价远大于收益；`additionalProperties: false` 的“多一个键就拒”语义手写最直白，库反而要配一整套严格模式。
- 校验失败的出口只有一种：回 `status: partial` 或 `unsupported` 加 `bad-args` 原因码，永不抛。

- 来源：`src/deck/tools/*.ts`（各 `definition` 的枚举与钳制现状）、`src/deck/shell/call-shell.ts`（永不抛约定）

### 2.5 错误三态如何建模：可辨识联合类型

- **强推荐**：把 `ok`/`partial`/`unsupported` 建模成以 `status` 为辨识键的联合类型（三个分支各有自己的 `data` 与 `reason` 约束），而不是一个万能的可空大对象。调用方用 `switch (receipt.status)` 穷尽三个分支，漏一个编译器就报错。这正是“永不抛”的类型表达：失败是值，不是异常。

- 来源：`src/deck/shell/call-shell.ts`（三态与原因码现状）；类型手法为 TypeScript 官方手册的联合类型与穷尽检查做法（`https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html`，本次抓取未展开、只列口径，讨论时可现场翻手册）

### 2.6 对外定义如何做到编译期与运行时同源

- **强推荐**：工具的 `definition`（给宿主看的 JSON 形状）与 TypeScript 参数类型必须同源：以 `definition.parameters` 为唯一事实，类型从它推导（`AsConst` 加 `FromSchema` 式推导），或反过来由类型生成 `definition`。不许两边各写一份。本仓注册表翻译函数（把必填数组转按属性必填、对象必带 `additionalProperties`）是检验同源的现成探针：翻译返回 `null` 就说明定义写劈了。
- **强推荐**：金标准回执夹具（`tests/tracker-contract/fixtures/golden-receipts/`）是冻结对照面的机器判据，转写后逐字节对比，差一个键即红。

- 来源：`src/deck/registration/register-options.ts`（`toAgentParameterSpec` 翻译与缺件规则）、`tests/tracker-contract/fixtures/golden-receipts/01-deck_context.golden.json`（信封实例）

### 2.7 如何避免同层互引

- **强推荐**：沿用现有门禁：工具层文件之间不许互相导入，共享能力下沉到壳或经工厂参数传进来。门禁由依赖图检查器执行（八条规则：同层导入、跨房导入、深导入、循环等），存量豁免只许减少。转写时把“顺手引用隔壁工具的函数”改成“从壳里拿”或“从契约类型里拿”。

- 来源：`tests/verify-dependency-rules.ts`、`.dependency-cruiser.cjs`（八规则）、`tests/same-layer-baseline.json`（豁免只许减）、`tests/verify-file-granularity.js`（350 行上限，超了就拆）

---

## 3. 从第一性原理推一遍：为什么是这个顺序、这个分层、这几个数据结构

### 3.1 为什么“先冻对照面、再转”是最小风险顺序

推理链条只有三步。第一，风险来自“行为变化混在写法变化里”：转写同时改形状，出问题时说不清是转坏了还是本就该改。第二，对照面（参数、信封、点数、金标准回执）是唯一能在转写前后逐字节对比的东西，它不依赖实现语言。第三，先冻对照面等于先立判据：转写票的完成标准变成“同一个输入、同一个回执、零变化”，门禁与回放都能自动判，讲解时也能一句话说清。所以冻对照面不是仪式感，而是把“改对了没有”变成机器可判的问题。

- **强推荐**：#1034 讨论的交付物就是这份对照表（本文件第 1 章的表格化定稿），开发票开工前先合入，开发时只许对照表绿。
- 来源：`research/1010-ticket-structure.md`（改写单元判据：行为零变化）、`tests/tracker-contract/fixtures/golden-receipts/`（机器判据）、`docs/adr/20261011-deck-ts-rewrite.md`（绿色编译模型）

### 3.2 为什么推荐外生接缝（薄壳加注册表加闸），而不是每个工具自带逻辑

每个工具要做的事（过闸、选后端、取会话、计时、记账、容错）是完全相同的，不相同的只是“调哪个后端操作、怎么拼回执”。如果每个工具自带一套，会出现九份超时、九份选后端、九份记账，改一个数字要改九处，这正是旧树难转的原因。外生接缝把相同的部分抽到壳（`call-shell.ts`）、装配抽到注册表（`registration/`）、权限抽到闸，工具只剩“参数形状加一次后端调用加拼回执”。新增第十个工具时，复制一个入口文件、登记顺序表即完，不用重写超时与记账。测试也有了统一的缝：把壳的依赖换成假后端，就能不联网测九个工具的全部失败路径。

- **强推荐**：保持“薄工具、厚壳”：工具文件只做三件事（定义形状、调一次壳、拼回执），超时、互斥、游标、记账一律不进工具文件。
- 来源：`src/deck/shell/call-shell.ts`（四硬要求头注释）、`src/deck/registration/`（装配 6 件）、`research/1010-deck-contract-surface.md`（表 B：九工具对壳的调用关系）

### 3.3 数据结构与算法：三个现成设计有没有更优的 TypeScript 表达

**幂等锚（5 分钟桶哈希）**：锚的算法是“桶时间戳加 djb2 哈希 8 位十六进制”，输入为工具名、会话、标题、标签、桶号，输出 `deck-<8位>-<桶号>`。5 分钟桶的含义是“同一计划在 5 分钟内重跑视为同一次”，桶外视为新一次。转 TypeScript 时保持算法逐字等价（连位运算的无符号右移都要保留），类型上把输入收成一个只读对象、输出收成模板字面量类型。**不建议**换哈希算法：锚已经写进旧票正文，换算法等于旧锚全失效。

- 来源：`src/deck/shell/minimal-spec.ts`（`anchorKeyFor`）、`src/deck/tools/map-plan-create.ts`（`planId` 缺省由锚推）

**计划游标（planStore）**：游标只是加速器，锚永远是权威。内存与落盘同一套异步形状（`load`/`save`/`remove` 全回 Promise），落盘一个计划一个小 JSON、成功即删、7 天过期。TypeScript 表达上用 `Map<string, PlanState>` 配只读接口，**不建议**换成普通对象字典：`Map` 的键是任意字符串、无原型污染问题，且“有无计划”用 `has` 一句话说清。

- 来源：`src/deck/shell/plan-cursor.ts`（内存与落盘两套实现、TTL 7 天）、`src/deck/tools/map-plan-create.ts`（`ACTIVE_PLANS` 并发拒绝）

**同票串行（key-lock）**：键为“仓库标识加票键”，`Map` 存队尾 Promise，先到先服务、单锁不可死锁，超时回“超时了、没做”而不抛。TypeScript 表达保持 `Map<string, Promise>` 链，**可二选一**是否把超时错误收成联合类型的一个分支（与 2.5 的三态建模一致）。

- 来源：`src/deck/shell/write-mutex.ts`（`withKeyLock`、`keyLockSnapshot` 只报数量不报键名）

**`Result<T,E>` 对 `throw`**：本仓约定永不抛，失败是值。**强推荐**用联合类型表示结果（成功带值、失败带原因与诚实语），**不建议**在工具与壳的任何一层抛异常。异常只允许出现在“程序员写错了”（如缺装配）这种连信封都拼不出的位置，且必须在壳的最外层被收成信封。

- 来源：`src/deck/shell/call-shell.ts`（永不抛）、`src/deck/shell/call-budget.ts`（超时、中止、超预算的诚实语）

---

## 4. 设计模式：给九个工具推荐 2 到 3 个模式

### 4.1 外观模式（Facade）：壳是九个工具唯一的脸

**解决的痛点**：九个工具都要过闸、选后端、计时、记账、容错。如果每个工具各写一遍，转写时九份一起改，门禁的 350 行上限也压不住。外观模式把这些收进壳的四个统一入口（会话、选后端、调后端、沙箱策略），工具只调壳、不碰外部。讨论时要确认：工具文件里出现 `process`、`fetch`、`gh` 进程字样即视为越界，打回。

- **强推荐**。
- 来源：`src/deck/shell/call-shell.ts`（四硬要求）、`research/1010-deck-contract-surface.md`（表 A：壳调外部 20 点，工具不直调）

### 4.2 适配器模式（Adapter）：注册表是定义与宿主之间的翻译层

**解决的痛点**：工具写的 `definition` 是 JSON 形状语言，宿主要的是注册表写法（必填数组转按属性必填、标量透枚举与常量、不认的键丢弃）。适配器把翻译收在一个文件里，翻不出就记缺件、不补桩。转写时工具侧只管把形状写对，宿主侧只管按注册表写法消费，两边不直接耦合。金标准回执是适配是否正确的最终证据。

- **强推荐**。
- 来源：`src/deck/registration/register-options.ts`（`toAgentProperty`/`toAgentParameterSpec`、翻不出回 `null`）、`src/deck/tools/tool-table.ts`（缺件记 `missing` 不补桩）

### 4.3 命令模式加依赖注入（Command + 经工厂注入）：每个工具是一个可重跑的命令

**解决的痛点**：批量建图是多步写，任何一步都可能超时；同票并发写要串行；测试要不联网覆盖全部失败路径。把每个工具做成“经工厂函数创建的命令”（`createDeckX(deps)`：依赖由参数传进来，不在文件顶层抓单例），命令自带幂等锚与游标键，重跑时跳过已建。工厂参数就是测试的缝：传假后端即测失败路径，传真后端即走真仓。可续跑（游标加锚双保险）与同票串行（键锁）都是这个模式的自然推论，不是另起的机制。

- **强推荐**。
- 来源：`src/deck/tools/tool-table.ts`（`createDeckTools(factories, deps)` 装表）、`src/deck/tools/map-plan-create.ts`（`ACTIVE_PLANS`、`planStore` 双保险）、`src/deck/shell/write-mutex.ts`（同票串行）、`src/deck/shell/plan-cursor.ts`（游标只是加速器）

---

## 5. 给 #1034 讨论的待表态清单（本文件不代答）

1. 第 1.2 节的参数表是否就是冻结稿，有无漏掉本地后端必填的 `effortId` 口径。
2. 第 1.4 节的记账点数是否补齐九个工具，缺的点数由谁在讨论后写入对照表。
3. 第 2.4 节“不引入校验库”是否接受，接受则手写守卫的 reviewers 是谁。
4. 第 2.6 节“定义与类型同源”的方向：从定义推类型，还是从类型生成定义。
5. 第 4.3 节工厂注入的依赖清单是否冻结（会话、后端选择、计时、记账、游标、互斥），有无多余。
