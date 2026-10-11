# ADR：deck 工具链整体改写 TypeScript（纯 TypeScript 项目形态 · 地图 #1010）

> 日期：2026-10-11 定版（维护者当日逐项拍板）。
> 地位：本文件是「deck 工具链改写 TypeScript」这件事的唯一依据——改哪些代码、新目录长什么样、契约是什么、编译怎么做、先做哪一步。凡与本文冲突的旧说法，以本文为准；未来任何讨论若改动本决策，以未来版本为准（与 `CONTEXT.md` 开头两条版本与效力规则同款）。
> 关联：#1010（地图「deck 工具故障修复和优化」）· 地图评论区 2026-10-11 决议评论（七节写全五项目标、执行决议、目录树、契约解释、归属原则、编译模型、开工顺序）· `research/1010-deck-chain-dirs.md`（调用链八层目录表与决议追记）

---

## 1. 背景与五项目标

1. 地图 #1010 原来的目的地写的是「deck 开头的工具在 GitHub 后端下能建票、查票」，等于把这次任务说成了一次只管 GitHub 可用的故障修复。维护者在 2026-10-11 亲口更正：这句是错的，作废。本次任务是整体重写，不是修故障。
2. 重写目标共五条，原样记录：第一，全面采用 TypeScript 实现；第二，源码架构清晰；第三，deck 工具加底层 GitHub 加底层 Markdown，围绕 deck 工具全部能力的每一份代码，都在本次任务内；第四，源码中有大量日志；第五，源码中有大量注释。
3. 现状证据（`research/deck-tools-language-1010.md` 逐文件核过）：对外九个 deck 工具的每一行实现代码今天全是 JavaScript，仓库里的 TypeScript 只在别处——四个独立计算核（配色、刷新、版本、配置读写）与面板界面，没有一件实现 deck 工具。
4. 一次调用今天经过八层：对话注册、九个薄工具文件、共用壳与最小规范、装配接线、契约与注册表、三个后端房间、进程额度文件三条底路、入口与构建。完整目录表见 `research/1010-deck-chain-dirs.md`，本文件不再复述，只写新家。
5. 本决策不管旧约束。旧的「摸到谁再转谁、不搞大爆炸」口径是仓库日常改动的纪律，本次是一次性重写，维护者明确按未来纯 TypeScript 项目的样子设计。用旧纪律卡新设计，是本末倒置。

## 2. 三项执行决议（2026-10-11 与目标同日定）

1. **GitLab 房不在本次任务内，但留好以后迁移与开发的位置**：房间目录不动，新增 `MIGRATION-SLOT.md` 写清转入条件，房间要实现的形状在新契约里写清（见第 4 节）。
2. **地图正文用 `gh` 直写**：插件自带的写票通道当时被两件事卡住——工作区同时被两个后端认出、面板未选定，以及读票接口超时。重放写操作不安全，维护者明确本次用 `gh` 命令直写，已写回并读回核对。
3. **旧故障票重构时顺手吞掉**：地图里原来 27 张故障票不再逐张修完再重构；重构中解决的问题随重构关闭，重构后不再出现的问题直接关闭。

## 3. 目录与归属（新树已获认可）

### 3.1 归属原则只有一条

谁用它，它归谁；两家共用的，归共用的家，谁也不许独占。只有 deck 用的进 `src/deck/`；面板与 deck 共用的（契约接口、注册表、后端识别、三个房间、闸与账本里被调用的行）进 `src/tracker/` 与共用内核；只有面板用的不动，不在本次任务内。依赖永远单向往下，deck 只引用契约接口，永远不深引用房间文件。

### 3.2 `src/deck/` 新树（层级即调用顺序，文件名说清功能）

```text
src/deck/
  README.md                    # 全域唯一索引：一次调用经过八层的目录地图，新人先读这一个文件
  tools/                       # 九个薄工具：只收参数，业务调壳
    context.ts                 # 确认工作区与后端（对外名 deck_context）
    issue-get.ts               # 读一张票
    map-snapshot.ts            # 看一张地图的全部子票
    issue-list.ts              # 按状态标签认领列薄行
    issue-create.ts            # 建一张票
    map-plan-create.ts         # 一次建整张地图骨架
    map-link.ts                # 补父子边与阻塞边
    issue-patch.ts             # 改一张票
    issue-report.ts            # 上报当前在办哪张票
    tool-order.ts              # 九个名字的顺序唯一真源
  shell/                       # 共用机制：规则只有一份
    call-shell.ts              # 壳：取会话、选后端、过闸、拼三态信封
    minimal-spec.ts            # 最小规范：必备标签、地图五个区块、幂等锚
    tool-table.ts              # 装配口：把工厂装成一张表
    edge-landing.ts            # 边落点判定：原生边还是退回正文首行
    call-budget.ts             # 单次调用超时余量
    session-workdir.ts         # 会话目录唯一取法
    write-mutex.ts             # 同一边界同时只许一个写者
    plan-cursor.ts             # 建图续跑游标
    table-cell.ts              # 同进程共享表
    workspace-anchor.ts        # 工作区锚文件读写
  registration/                # 注册与装配：名字怎么进对话
    register-options.ts        # 拼注册选项、参数翻译、输出渲染
    agent-row.ts               # 行模块：只交纯数据对象
    host-assemble.ts           # 宿主装配：九个工厂装表
    host-delegate.ts           # 宿主代执行：替行跑同一张表
    quota-sync.ts              # 剩余额度同步
    sandbox-guard.ts           # 沙箱判定
  contract/                    # 见下方注：契约不在这里，归 src/tracker/contract/
  log/                         # 日志落点
    deck-events.ts             # 事件常量：沿用既有事件名，不新增
    deck-fields.ts             # 字段表：每处记什么、什么绝不记
```

注（2026-10-12 修定，与 3.1 归属原则对齐）：契约接口归 `src/tracker/contract/`，**不放** `src/deck/contract/`。理由是契约是面板与 deck 共用的承诺，deck 引用它、不拥有它；放在 `src/deck/` 下面等于让 deck 独占两家共用的东西，与 3.1 那条自相矛盾。该目录第一批已落地，形状见下一节。

### 3.3 命名细目（2026-10-12 定，来自迁移映射表要人拍板的三处）

命名规矩只有一条：**目录名已经说清的事，文件名不再重复**；文件名要说清它装的是什么，而不是它属于谁。

- 契约目录 `src/tracker/contract/`：`ports.ts`（核心类型）、`operations.ts`（19 个操作的签名与两房扩展）、`backend-module.ts`（房间模块对象形状）、`operations-catalog.ts`（运行时数据：19 个操作名录与契约版本，从今天的 `src/host/tracker/contract.js` 余留下来的那半）、`index.ts`（统一出口，外部只从这里进）。这样分是因为「签名」与「名录」是两件事：前者编译期管形状，后者运行时给注册表用。
- 注册表 `src/tracker/registry/`：今天叫 `registryCore.js` / `registryShape.js` / `registryViews.js`，住进 `registry/` 目录后前缀重复，改叫 `core.ts`、`shape.ts`、`views.ts`。
- 房间 `src/tracker/rooms/`：三个房间统一搬进来（GitHub、Markdown、GitLab），**文件名一个不改**（`client`、`issues`、`comments`、`graph`、`queries` 本来就是功能名）。GitLab 房只随目录改名、代码一个字不转，另放 `MIGRATION-SLOT.md` 写清以后怎么按契约补齐；不搞「两房在新目录、一房留在旧目录」的分裂布局。

### 3.4 故意不动的三处（是设计，不是遗漏）

- GitHub 与 Markdown 两房留在跟踪器目录下，文件名不动（`client`、`issues`、`issues-write`、`comments`、`graph`、`queries` 本来就是功能名），因为房间是面板与 deck 共用的，不归 deck 独有，搬进 `src/deck/` 会撒谎。房间目录按仓库词典改叫 `rooms/`（词典原话：三座内置后端各自的目录就叫房间）。
- 闸、账本、注册表只转被 deck 调到的行，不整文件扫荡，因为它们另有主人（面板刷新）。
- 四个已有的 TypeScript 计算核不受影响，继续走自己的构建形状；将来若要统一形态，另立决策，不在本文件里顺手改。

## 4. 契约是什么：上层敢无知的书面承诺（家落在 `src/tracker/contract/`）

九个工具调 `t.preflight`、`t.list` 时，从不问后端是谁，九个文件加十个共享文件里零个后端分支。这怎么可能？因为有一份承诺保证：不管哪个房间，都回答同样的方法、收同样的参数、回同样的形状。没有这份承诺，每加一个后端，上层就要加一堆分支。

今天这份承诺是散的：`src/host/tracker/contract.js` 用注释写类型，房间靠照着写对上，跑起来再验一遍。重构后它写成 TypeScript 的 `interface`，两房用 `implements` 去实现，写错编译直接报错。没有人工清单，是编译器检查。

家落在 `src/tracker/contract/`（面板与 deck 共用，按 3.1 归共用家）：`ports.ts` 放核心类型、`operations.ts` 放 19 个契约操作的签名、`backend-module.ts` 放房间模块对象形状、`README.md` 放这一目录的说明。三个非契约面各有去处：`getRepoPermissions` 升进契约（读写权限是工具诚实回执的通用依据）；`listSubIssues` 与 `ensureLabelColorsFile` 标房内扩展，不进契约。

## 5. 绿色编译模型（纯 TypeScript 项目的样子）

1. 源码只有 `.ts`，产物全部进 `.gitignore`，`prepare` 脚本负责构建，发包形状不变，只是源头干净了。
2. 按域拆 TypeScript 工程引用：`deck` 引用 `tracker`，`tracker` 引用内核，引用只能朝下，写反编译不过。方向由编译器保证，不用人肉门禁。
3. 单测直接跑 `.ts`，不再有「改了真源忘生成产物」这种事，因为没有入库的产物可忘。
4. 今天约三十个按路径文本断言的旧门禁，换成标准依赖检查工具（禁循环、禁跨层深引用、单文件行数上限），保证不变，工具换成社区的。
5. 两条物理事实保留：Node 运行不了 `.ts`，宿主加载的是构建产物。除此之外，旧构建形态一律不继承。

## 6. 开工顺序

决议记设计文档（即本文件）→ 写 `contract/` 接口 → 两房 `implements` 对上 → 自上而下转 `src/deck/`。旧故障票与旧路径断言在这趟里一起消失，不单独修。

## 7. 后果、代价与风险

- 正：一个模块只有一个手写真源；依赖方向由编译器卡死；新人顺 `src/deck/README.md` 一页纸走通全链；日志注释从第一天就有地方放。
- 代价：约三十个验证脚本里写死的旧路径要一次改全（点名最重的几个：`tests/verify-deck-tools.js`、`tests/verify-deck-tools-matrix.js`、`tests/verify-784-effortId.js`、`tests/verify-deck-tools-host-wiring.js`、`tests/verify-deck-tools-agent-register.js`，以及装配常量与两份基线文件）；发包镜像（`package/shared`、`package/lib`）同步改；测试工具链换成直接跑 TypeScript；另有 4 个 src 内部引用文件（宿主入口动态引入一处、锚文件读写三处引用）加 1 处发包手写映射（`package/package.json` 的 `"./tools"` 出口）同步改。
- 风险：红窗口期——全量验证与构建全绿之前主分支不可发布；接口先行写错会带着两房一起错，所以 `contract/` 接口要单独评审一次，不与实现同一次合并。

## 8. 引用

- 地图 #1010 及评论区 2026-10-11 决议评论（七节：目标、执行决议、目录树、契约解释、归属原则、编译模型、开工顺序）。
- `research/1010-deck-chain-dirs.md`（调用链八层目录表、新树、范围更正与决议追记）、`research/deck-tools-language-1010.md`（九个工具今天全是 JavaScript 的证据）。
- `docs/adr/20260913-builtin-ts-shape.md`（四个计算核的形态先例；本决策不改它，将来统一另立决策）。

## 9. 变更记录

- 2026-10-11 初版（维护者当日拍板五项目标、三项执行决议、新树、编译模型与开工顺序）。
- 2026-10-12 修定：契约的家从树里的 `src/deck/contract/` 挪到 `src/tracker/contract/`，与 3.1 归属原则对齐（共用归共用家，deck 引用不拥有）；§4 补该目录四个文件与非契约面三处定案。
- 2026-10-12 补 3.3 命名细目：契约目录五个文件名、注册表三件改名去重前缀、三房统一搬进 `rooms/`（GitLab 只改名不转码）。依据是迁移映射表（`research/1010-migration-map.md`）要人拍板的三处。
