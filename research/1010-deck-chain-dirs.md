# deck 工具从注册到最底层横跨了哪些源码目录（2026-10-11 调研，只写亲手核过的文件）

这次只看仓库里的原始文件，没有看任何二手总结。地图是 `1010`（标题“deck 工具故障修复和优化”，`wayfinder:map`，目的地是九个 deck 工具在 GitHub 后端下可用、批量写超时可续跑、后端选择一致、失败说清哪一步）。
已有两份同地图调研放在前面：`research/1010-deck-boundary-notes.md`（客户端快照等待与落地的事实与待定问题），
`research/deck-tools-language-1010.md`（九个工具今天全是 JavaScript，TypeScript 只在别处）。本文件接着它们，
只回答“从注册到使用到底层，到底经过哪些目录”，并给出一份 TypeScript 新目录提议，请人拍板。

## 调用链一句话

对话里看见的九个 deck 工具，走的是同一条路：行模块注册名字 → 宿主装配出一张表 → 每个工具的薄文件只收参数、
共用的壳做选后端与过闸 → 后端房间做真正的读写 → 最底下是起进程调 `gh`、剩余额度账本、文件读写这三条路。
每一层的目录见下表，顺序就是一次调用经过的顺序。

## 逐层目录表（层 → 目录 → 里面有什么 → 关键文件）

### 第 1 层：对话里注册名字（agent 层能看见的两个入口）

- 目录：`src/shared/deck-tools/` 里的 `agent-register.js`，`src/host/platform/` 里的 `deckToolsRow.js`。
- 里面有什么：把工具名字、描述、参数、输出形状交给对话，把执行函数包成永不抛的形状，执行前先看是不是被中止、参数是不是对象。
- 关键文件：
  - `src/shared/deck-tools/agent-register.js`（注册、参数翻译、输出渲染、诚实占位，`registerDeckAgentTools` 与 `hookDeckAgentTools`）。
  - `src/host/platform/deckToolsRow.js`（行模块，只交纯数据对象，不引用工具包，执行在通道接通前走诚实占位）。

### 第 2 层：九个工具的薄文件（只收参数，不写业务规则）

- 目录：`src/host/tools/`，共 9 个文件。
- 里面有什么：每个文件导出一份工具定义与一个创建函数，真正的规则（补标签、补正文、过闸、选后端）全部调共享层的壳。
- 九个文件与对外名字一一对应（顺序与 `src/shared/deck-tools/plan.js` 里的 `DECK_TOOL_ORDER` 一致，
  清单与 `src/host/platform/deckToolsAssembly.js` 里的 `DECK_TOOL_FILES` 一致）：
  - `src/host/tools/deckContext.js`（`deck_context`，先确认工作区与后端）。
  - `src/host/tools/deckIssueGet.js`（`deck_issue_get`）。
  - `src/host/tools/deckMapSnapshot.js`（`deck_map_snapshot`）。
  - `src/host/tools/deckIssueList.js`（`deck_issue_list`）。
  - `src/host/tools/deckIssueCreate.js`（`deck_issue_create`）。
  - `src/host/tools/deckMapPlanCreate.js`（`deck_map_plan_create`，一次建整张地图骨架）。
  - `src/host/tools/deckMapLink.js`（`deck_map_link`，补父子边与阻塞边）。
  - `src/host/tools/deckIssuePatch.js`（`deck_issue_patch`）。
  - `src/host/tools/deckIssueReport.js`（`deck_issue_report`，上报当前在办哪张票）。

### 第 3 层：共用的壳与最小规范（规则只有一份）

- 目录：`src/shared/deck-tools/`，共 10 个文件。
- 里面有什么：从会话上下文取工作区目录、按“人选大于锚文件大于自动识别”选后端、每次调用过宿主闸、
  三态返回且永不抛异常、写后失效缓存、批量建图的中间态说明。
- 关键文件：
  - `src/shared/deck-tools/shell.js`（薄壳：取会话、选后端、过闸、拼三态信封、记 `host.call` 与 `host.call.fail`）。
  - `src/shared/deck-tools/plan.js`（强制最小规范：必备标签、地图五个区块与进度区、幂等锚、装配口 `createDeckTools`）。
  - `src/shared/deck-tools/edges.js`（边的落点判定：原生边还是退回正文首行，批量部分成功的 `partial` 结论）。
  - `src/shared/deck-tools/session-resolve.js` 与 `call-scope.js`（会话目录与单次调用的超时余量）。
  - `src/shared/deck-tools/key-lock.js`、`plan-store.js`、`exec-cell.js`、`workspace-file.js`（同一边界同时只许一个写者、
    建图中间态、同进程共享表、工作区锚文件）。

### 第 4 层：装配与接线（把表装好，把依赖给全）

- 目录：`src/host/platform/deckToolsAssembly.js`，`src/host/refresh/wiring.js`（约第 300 到 362 行），
  同目录的 `src/host/platform/deckExec.js`、`deckQuotaSync.js`、`deckSandbox.js`。
- 里面有什么：把九个工厂函数装成一张表，把闸、后端注册表、额度常量、算账函数、会话对应句柄、
  后端上下文、写后失效、剩余额度读数这些依赖一次性给全，表装好就向对话注册。
- 关键事实：`src/host/refresh/wiring.js` 第 309 行在宿主启动时调用 `hookDeckAgentTools`，
  第 310 到 362 行的 `deckToolsForHost` 是唯一的装配函数；`planStore` 没有注入，
  所以批量建图的中间态退回进程内存，工具在返回值里如实说不可持久（该行注释原话）。

### 第 5 层：契约与注册表（后端怎么选、什么能写）

- 目录：`src/host/tracker/`（`contract.js`、`registryCore.js`、`registryShape.js`、`registryViews.js`、
  `generic.js`、`snapshot.js`、`detection/` 下的 `backendDecision.js` 与 `parseIssueTracker.js` 等），
  对应共享形状在 `src/shared/tracker/`（`deck-derive.js`、`link.js`、`sync.js` 等）与 `src/shared/refresh/`（`budget.js`、`tool-cost.js` 等）。
- 里面有什么：后端三级选择、写权限旁路、契约形状、花费估算。工具文件里没有任何一处自己判断后端是谁。

### 第 6 层：三个后端房间（真正的读写，只许一次改一房）

- 目录：`src/host/tracker/backends/github/`（约 28 个文件）、`src/host/tracker/backends/gitlab/`（约 14 个文件）、
  `src/host/tracker/backends/markdown/`（约 20 个文件）。
- 房规：禁止跨房引用，一次会话只改一房（门禁 `verify-no-cross-import` 与 `verify-no-mixed-session`，白名单在 `src/host/tracker/backends/README.md`）。
- GitHub 房关键文件：`client.js`（起 `gh` 进程那一层，默认超时 30000 毫秒，出去的每一笔报给闸）、
  `issues.js` 与 `issues-write.js`（读写）、`comments.js`、`sub-issues.js`、`graph.js`（边）、`queries.js` 与 `page.js`（分页）、
  `errors.js`（错误归一）、`idempotency.js`（幂等锚）。

### 第 7 层：最底下的三条路（进程、额度、文件）

- 起进程调 `gh`：`src/host/repoKeys.js`（找 `gh` 路径、起进程、超时 30000 毫秒），
  平台三底座 `src/host/platform/win32/index.js`、`linux/index.js`、`darwin/index.js`，
  宿主代执行电话 `src/host/platform/deckExec.js`（替行模块跑同一张表、同一份闸、同一个账本）。
- 剩余额度与闸：`src/host/refresh/gate.js`（唯一出口：定类、记账、裁决、推迟）、`ledger.js`（两个桶的用量与剩余额度档位）、
  共享 `src/shared/refresh/budget.js` 与 `tool-cost.js`（每笔调用的上限与估算）。
- 文件与快照：Markdown 后端读写 `.scratch/<工作单元>/` 下的票文件（`write-queue.js` 排队），
  宿主快照缓存 `src/host/sessionSnapshot.js`、`snapshotBuild.js`、`snapshotEnvelope.js`、`snapshotInflight.js`，
  客户端等待常量 `src/client/kernel/probe-snapshot.js`（`SNAP_WAIT_MS = 30000`）。

### 第 8 层：入口与构建（怎么变成运行起来的插件）

- 入口：`src/host/index.js`（宿主装配，只做装配与注册，实现在各自文件），`src/client/index.js`（面板入口），
  `src/seam/*`（运行、样式、远程调用、定时器、编辑器五件与门禁）。
- 构建：`scripts/build.mjs`（先把四个 TypeScript 核逐个翻译成 `src/shared/` 下的同名产物，再用 esbuild 打双入口：
  根 `client.js` 与 `host.js` 给开发调试，`package/lib/` 给发布包）。
- 今天 TypeScript 只在两处（都没有实现 deck 工具）：
  - 四个独立核：`label-color-core/src/`（3 个）、`refresh-core/src/`（14 个）、`version-control-core/src/`（14 个）、
    `config-store-core/src/`（4 个），各自带 `build.mjs` 与 `tsconfig.json`，产物是一对一进 `src/shared/` 对应目录。
  - 面板界面真源：`src/client/views/` 与 `src/client/kernel/locale-*.ts`（约 34 个加 4 个类型说明），
    由 `tsconfig.client.json` 做只检查不产出，真正的产物由构建里的 esbuild 翻译。

### 日志今天在哪里（改造要加量的起点）

- 事件名只有两个：`host.call`（成功）与 `host.call.fail`（失败），种类字段 `kind = deck-tool`，
  原因只记机器可读的短码与八位散列，不记令牌与路径原文（见 `shell.js`、`agent-register.js`、`deckExec.js`、`github/client.js` 的房内埋点注释）。
- 现行条数以 `research/489-appendix.md` 第 1 章对照表为准，开关与脱敏按 `docs/design/335-logging-contract.md` 第 3 章。
  这次“大量加日志”只能加在这套语义里：事件名与字段含义稳定，改含义就发新事件。

## 范围更正（2026-10-11 由维护者亲口更正，旧目的地只说 GitHub 可用是错的）

本次重构任务的目标共五条，原样记录：

1. 全面采用 TypeScript 实现。
2. 源码架构清晰。
3. deck 工具加底层 GitHub 加底层 Markdown，围绕 deck 工具的全部能力的每一份代码，都在本次任务内。
4. 源码中有大量日志。
5. 源码中有大量注释。

范围说明：后端范围是 GitHub 与 Markdown 两房，GitLab 房是否在内等维护者再定；
旧目的地里“只在 GitHub 后端下可用、故障修复”那套说法不再作为本次任务的目的地，
旧的 27 张故障票是先修完再重构还是重构时吞掉，也等维护者定。下面目录提议已按“两房全量在内”调整。

## 决议追记（2026-10-11 维护者拍板）

- GitLab 房不在本次任务内，但要留好以后迁移与开发的位置：房间目录不动，房间要实现的口子形状在新核契约里写清。
- 地图新目的地已用 `gh issue edit 1010 --body-file` 写回并读回核对（插件通道当时被“双后端未选定”与读票超时卡住，维护者明确用 `gh` 直写）。
- 旧故障票重构时顺手吞掉，不再逐张修完再重构。
- 2026-10-11 晚：维护者认可按功能起名的 `src/deck/` 新树（不跟 `-core` 后缀风）、绿色编译模型（源码只有 `.ts`、产物进 `.gitignore`、工程引用只能朝下、单测直跑 TS、旧路径门禁换标准依赖检查工具）、归属原则（deck 自有进 `src/deck/`、共用进 `src/tracker/` 与内核、面板不动、房间改叫 `rooms/`）与开工顺序（设计文档 → `contract/` 接口 → 两房 `implements` → 自上而下转）。完整决议以地图同日决议评论为准，未来会话搜 ISSUE 即得。
- 2026-10-11 深夜第一批收工：ADR、调用面清单、影响面清单经对抗审查（`research/1010-deck-review.md`，9 处必修）加补丁复验全过；开工令为 `contract/` 接口开写（单独评审再合）、getRepoPermissions 升契约另两个标房内扩展、改全手改 42 个文件；细则见地图同日开工结论评论。
- 2026-10-11 深夜第二份专审对账（`research/1010-deck-review-contract.md`，判 fail 小修即过）：零编造、零整类遗漏；7 条里 1 条第一轮已修，其余 6 条由决策人亲手核源码后落字——D2 标题 15 改 24（按 `backend.js:70-129` 逐个名字数出 24 个，审查员说 25 是他数多了）、B1-5 行号 `:129` 改 `:128`、A8 补可选端口 `resolveTimeoutMs`（`shell.js:218`，缺省与非法值都回落 8000）、A15 补空触达守卫（`shell.js:345`）、D3 模块键补 `presentation`（`markdown/index.js:230-235`）、A19 只读约定记为待定项（接口用只读类型在编译期定死，不改运行时）。对账全过。

## TypeScript 新目录提议（请拍板，共三问）

目标：调用链的顺序在目录上能一眼看出来；今天散在五处的实现按“经过顺序”收拢，但房间纪律、
同层互引门禁、构建产物的三条红线一条都不碰；日志与注释从第一天就有地方放。

推荐方案是方案甲（新核加原地转，两步走）：

```text
deck-core/                        # 新增，与 label-color-core 等并列的第五个核：纯规则，只放能进共享层的部分
  README.md                       # 这一核管什么、不管什么，调用链顺序图
  build.mjs                       # 与其余四核同一写法：一对一翻译加类型检查加新鲜度清单
  tsconfig.json                   # strict，noEmit 加 esbuild 转译，与其余四核同口径
  src/
    tools/                        # 九个薄工具的定义与参数形状（今天 src/host/tools 里不碰后端的半边）
      definition.ts               # 九个名字、描述、参数模式（今天的 definition 原样转类型）
      order.ts                    # DECK_TOOL_ORDER（今天 plan.js 里的顺序常量搬家，旧处留转发）
    shell/                        # 共用机制（今天 src/shared/deck-tools 整目录转过来，文件名不变只换后缀）
      shell.ts                    # 取会话、选后端、过闸、拼三态信封
      plan.ts                     # 必备标签、五个区块、幂等锚、装配口
      edges.ts                    # 落点判定与部分成功结论
      call-scope.ts               # 单次调用超时余量
      session-resolve.ts          # 会话目录唯一取法
      key-lock.ts                 # 同一边界同时只许一个写者
      plan-store.ts               # 建图中间态
      exec-cell.ts                # 同进程共享表
      workspace-file.ts           # 工作区锚文件
      agent-register.ts           # 注册、渲染、诚实占位
    contract/                     # 契约形状（与 deck 有关的全部转过来：contract、registry、detection 里被 deck 调用的部分，不是只挑三五件）
      link.ts                     # 边形状
      sync.ts                     # 同步形状
      derive.ts                   # 面板派生形状
    log/                          # 日志事件与字段（新增，不碰旧事件名，只加 deck 专用的字段表）
      events.ts                   # 事件名常量（沿用 host.call 与 host.call.fail，不新增事件名）
      fields.ts                   # 每个位置记什么字段、什么绝不记（令牌与路径原文永不落盘）

src/host/tools/*.ts               # 九个薄文件的执行半边，原地转后缀：只留“调壳”，实现搬进 deck-core
src/host/platform/deck*.ts        # 装配、行模块、代执行、额度同步、沙箱，原地转后缀，不新增宿主层引用边
src/host/tracker/backends/*/*.ts  # GitHub 房与 Markdown 房全量原地转后缀（本次任务内，目录名不变，房规门禁不变）；GitLab 房等维护者定是否在内
src/host/refresh/*.ts             # 闸、账本、接线里只与 deck 有关的调用处，原地转后缀
```

为什么是“新核加原地转”而不是“全搬进一个大目录”：后端房间与宿主接线依赖起进程、文件系统、定时器这些宿主能力，
不能进纯共享核（今天 `shell.js` 文件头写明“本文件自己不 import 任何东西”就是这条线）；
全搬会把纯规则与宿主能力混进同一层，门禁与构建都要重写。上面的分法保持“纯的进核、有宿主能力的原地转”，
消费者看到的产物路径不变（`src/shared/deck-tools/*.js` 仍由 `deck-core` 生成，只是换了真源）。

注释与日志的落点（随目录一起定）：

- 注释：每个 `.ts` 文件头写清这一文件在调用链的哪一段、为什么住在这里、什么约定不能改、一个真实反例；
  每个公开函数写清输入摘要、分支原因、失败时回什么三态。样板看 `label-color-core/src/colors.ts` 文件头。
- 日志：只在三类边界留整趟轨迹（进程或模块边界、持久化边界、时间边界），每趟含起点输入摘要、分支原因、
  外部调用结果加耗时、状态变化、终点结论；高频路径先判开关再组装字段；可重放的凭证原文永不落盘。
  新增字段先写进 `deck-core/src/log/fields.ts` 与 `research/489-appendix.md` 对照表，再写代码。

## 请你拍板的三件事（回话里直接说，不用弹窗）

1. 新核是按“调用顺序”分 `tools/shell/contract/log` 四组（如上），还是按今天的文件名平铺一层？你更顺眼哪种？
2. 三个后端房间是留在 `src/host/tracker/backends/` 原地转后缀，还是也搬进 `deck-core/src/backends/`？前者门禁零改，后者目录更拢但要改两道门禁的白名单。
3. 日志先按“每层两行”（起点与终点）起步，还是直接按“每步五段”（起点、分支、外部结果加耗时、状态变化、终点）写全？你倾向哪种密度？我按你定的密度写第一批。
