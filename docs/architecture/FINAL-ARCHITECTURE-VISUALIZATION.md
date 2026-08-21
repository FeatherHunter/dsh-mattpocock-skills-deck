# dsh-mattpocock-skills-deck · 最终态架构可视化

> 来源：issue #20（归档+推进中枢 map） + `ARCHITECTURE-SPLIT.md`（方案 v1） + `ARCHITECTURE-CTX.md`（Ctx 定案） + `docs/architecture/kernel-contract.md`（G3 接口冻结） + `ARCHITECTURE-SPLIT-DIAGRAM.svg`（原架构图）
> 状态：map 定稿、T0-T3 ✅ 完成、T4-T5 ⏳ 待推进；本图呈现**T5 收尾后的最终态**，即"未来长成什么样"

---

## 一、TL;DR：最终长成什么样（一句话）

仓库根除 `package.json` / `build.sh` / 配置外，**所有手写代码只存在于 `src/`**；`src/` 被切成「host 数据半 + client 表现半」两半，client 半内部立着一根「内核护栏」（9 个稳定接口模块），护栏四周长出 4 个模块组（statusbar / panel / views / floating），每模块 1 个文件、同层互不 import；esbuild 把 `src/` 唯一真源打包成两份产物（npm 版 `package/lib/*` + 动态版根 `client.js`/`host.js`），人手永不碰产物。

---

## 二、三视图：结构 / 依赖 / 构建

### 视图 ① 物理结构（一个真源 + 四层分区）

```
dsh-mattpocock-skills-deck/                  ← 仓库根
│
├── package.json                              ← 构建 scripts + dsh 配置上楼
├── build.sh / scripts/build.mjs              ← esbuild 双 entry 构建
├── docs/architecture/                        ← ARCHITECTURE-SPLIT + CTX + kernel-contract
├── tests/                                    ← verify-*.js（每模块一个测试文件）
│
└── src/                                      ★ 唯一真源：所有人手写代码只在这里
    │
    ├── host/                                 ★ 数据半（纯服务端逻辑，无 UI）
    │   ├── index.js                         【组装】apply(ctx) + RPC 注册表
    │   ├── gh.js                            命令行封装 (resolveGh/runGh/execProc)
    │   ├── repo.js                          仓库定位 + 磁盘缓存
    │   ├── snapshot.js                      快照构建（fetchMaps/fetchIssues/buildSnapshot）
    │   ├── parser.js                        纯函数解析（parseMapBody/parseProgress/computeLevels）★ 阶段1叶子
    │   ├── checks.js                        环境检查（9 项 → buildStatus）
    │   ├── handoff.js                       交接文档扫描（scanHandoffDir/pickLatestHandoff）
    │   ├── claim.js                         认领流程
    │   ├── rpc.js                           RPC 端点定义 + errText
    │   └── types.js                         类型联合（snapshot/ticket/check）
    │
    ├── shared/                               ★ host/client 共用纯函数（阶段1叶子落点）
    │   └── parser.js                        normalizeBody / parseMapBody
    │
    ├── seam/                                 ★ 6 个方言绑定（阶段0地基层）
    │   ├── index.js                         总装配
    │   ├── runtime.js                       运行时来源适配
    │   ├── rpc.js                           rpcCall 桥
    │   ├── style.js                         styles.insert 适配
    │   ├── timer.js                         setTimeout 兜底
    │   ├── editor.js                        editor 服务桥
    │   └── sidebar.js                       sidebar 适配
    │
    └── client/                               ★ 表现半（DSH 加载 = 单 bundle）
        │
        ├── index.js                         【组装】apply(ctx) → Provider → 渲染树
        │
        ├── kernel/                          ★ 内核护栏（G3 冻结 9 件·并发默认冻结）
        │   ├── ctx.js                       DswsCtx + createCx（React.createContext）
        │   ├── store.js                     Store / emit / sub / useStore + 派生统计
        │   ├── locale.js                    dsws zh/en 字典 + tr()
        │   ├── prompts.js                   PROMPTS 注册表 + promptText()
        │   ├── router.js                    openPanel / togglePanel / tab 导航
        │   ├── config.js                    cfg/templates 持久化 + renderTemplate
        │   ├── api.js                       host 桥（rpcCall/inject/openInNewSession）
        │   ├── probe.js                     loadSnapshot/probeNow/autoProbe/refreshAll
        │   ├── styles.js                    STYLE_TEXT 唯一真源
        │   ├── icons.js                     Icon / Ic / Dot / TypeChip
        │   └── tabsfold.js                  折叠机器（阶段1叶子·TABS_LEVELS/HYST）
        │
        ├── statusbar/                       ★ 模块组 1：状态栏面板
        │   ├── StatusBar.js                 胶囊组装 + 环境段/就绪计数
        │   ├── Seg.js                       分段按钮（go 到各 tab）
        │   ├── EnvBadge.js                  环境/技能就绪徽标
        │   ├── checksums.js                 7/9 等汇总徽标
        │   └── runcard.js                   运行卡（配置引导）
        │
        ├── panel/                           ★ 模块组 2：右侧面板容器
        │   ├── Tabs.js                      ⭐ 共享 tabs 行（去重：原 Dock+Overlay 重复两遍）
        │   ├── TabsFoldMachine.js           折叠等级机器引用
        │   ├── Tooltip.js                   portal 悬浮提示
        │   ├── Dock.js                      侧栏停靠容器
        │   ├── Overlay.js                   漂浮容器（拖拽/缩放）
        │   └── Shell.js                     Dock/Overlay 共享骨架
        │
        ├── views/                           ★ 模块组 3：右侧面板内容视图
        │   ├── ListTab.js                   列表（sorting/filter/chips/行动作）
        │   ├── TicketRow.js                 issue 行（含行级诊断/执行/讨论按钮）
        │   ├── MapDetail.js                 地图详情（漏斗分层/节点/gate）
        │   ├── SkillsTab.js                 技能（含 RingSkills 圆形技能环）
        │   ├── ChecksTab.js                 环境检查 9 项卡片
        │   ├── SettingsPage.js              设置页（配置/模板编辑器）
        │   ├── RunPanel.js                  运行卡（如独立）
        │   └── shared/                      ★ G3 裁定：同层共享件放这里
        │
        └── floating/                        ★ 模块组 4：技能悬浮列表
            ├── SkillFloatList.js            技能悬浮列表
            ├── Pop.js                       通用浮层（原 showPop 体系）
            └── tagsFit.js                   标签自适应 fitAllTags
```

### 视图 ② 依赖图（**唯一通道 = import 内核**，同层禁止互连）

```
                       ┌─────────────────────────────────────┐
                       │        src/client/index.js          │  ← 组装入口：建 cx → 包 Provider
                       │        apply(ctx) → 渲染树           │
                       └─────────────────┬───────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
    ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
    │ kernel/ctx.js     │       │ kernel/store.js  │       │ kernel/probe.js  │
    │ (DswsCtx Provider)│       │ (state container) │       │ (snapshot/refresh)│
    └────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
             │                          │                          │
             │      ┌──── kernel/* 9 件 ─┴────┐                    │
             │      │ locale / prompts / icons │ ← 并发默认冻结层   │
             │      │ styles / config / api   │                    │
             │      │ router / ctx / tabsfold │                    │
             │      └─────────────────────────┘                    │
             │                                                      │
   ═══════════════════════════════════════════════════════════════════════
             │                          │                          │
             │ 仅允许：模块组 → kernel/（单向绿色箭头）             │
             │ 禁止：模块组 A → 模块组 B（红色 ✗）                  │
   ═══════════════════════════════════════════════════════════════════════
             │                          │                          │
   ┌─────────┴────────┐    ┌────────────┴─────────┐   ┌────────────┴─────────┐
   ▼                  ▼    ▼                      ▼   ▼                      ▼
┌──────────┐    ┌──────────┐ ┌──────────┐    ┌──────────┐ ┌──────────┐    ┌──────────┐
│statusbar │    │  panel   │ │ statusbar│    │  panel  │ │  views   │    │ floating │
│  /       │    │   /      │ │  /       │    │   /     │ │   /      │    │   /      │
│StatusBar │    │  Tabs    │ │ EnvBadge │    │  Dock   │ │ ListTab  │    │SkillFloat│
│ Seg      │    │ Tooltip  │ │ checksums│    │  Overlay│ │ TicketRow│    │ Pop      │
│ runcard  │    │ Shell    │ │  ...     │    │   ...   │ │ MapDetail│    │ tagsFit  │
└──────────┘    └──────────┘ └──────────┘    └──────────┘ └──────────┘    └──────────┘
      ✗                 ✗          ✗                 ✗          ✗                ✗
   ───── 同层禁止互连（不同色模块组间不得互 import） ─────
```

**规则一句话**：从任意叶子出发只能走「模块 → kernel → 别的模块」的两跳，不能「模块 → 兄弟模块」一跳。

### 视图 ③ 构建管线（一源出两物）

```
                              src/  唯一真源
                                  │
                                  │  手写代码只在这里
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   esbuild 构建    │  scripts/build.mjs
                         │   (毫秒级)        │  双 entry + 双 wrapper
                         └────────┬─────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                │                                   │
                ▼                                   ▼
   ┌──────────────────────┐              ┌──────────────────────┐
   │  _pkg entry          │              │  _dev entry          │
   │  __ModuleLoader__    │              │  cordis_define       │
   │  .load({id, factory})│              │  函数体片段           │
   │  CJS bundle          │              │  ESM-style snippet   │
   └──────────┬───────────┘              └──────────┬───────────┘
              │                                      │
              ▼                                      ▼
   ┌──────────────────────┐              ┌──────────────────────┐
   │ package/lib/client.js│              │ 仓库根 client.js     │
   │ package/lib/index.js │              │ 仓库根 host.js       │
   │ ★ 真实加载对象        │              │ ★ 动态 runner 用      │
   │ gitignored · 人手不碰 │              │ gitignored · 人手不碰 │
   └──────────────────────┘              └──────────────────────┘
```

**关键事实**：DSH 加载契约 = 一插件一模块 id = 单 bundle（`window.__ModuleLoader__.load({id, factory})`，id 必须等于包名）。所以「多文件源码」必须经构建合并成单 bundle，否则 DSH 根本加载不了——这正是拆文件的物理前提。

---

## 三、并发趋零：两个 session 同时改代码时究竟发生了什么

### 场景：session A 改「列表视图」，session B 改「状态栏徽标」

```
   session A (改 ListTab)                   session B (改 EnvBadge)
            │                                       │
            ▼                                       ▼
   ┌─────────────────────┐                ┌─────────────────────┐
   │ 唯一接触的文件:       │                │ 唯一接触的文件:       │
   │ src/client/views/    │                │ src/client/statusbar/│
   │   ListTab.js         │                │   EnvBadge.js        │
   │ tests/verify-list.js │                │ tests/verify-env.js  │
   └─────────────────────┘                └─────────────────────┘
            │                                       │
            └─────────────┬─────────────────────────┘
                          ▼
              两个文件集合不相交
              → git 合并 = 追加式
              → 冲突概率 ≈ 0
```

### 反例：如果不拆会怎样

```
   两个 session 同时改 client.js（3700 行）
            │
            ▼
   ┌─────────────────────┐
   │ 同一份 3700 行文件    │  ← 不管你碰哪一行，
   │ + 镜像 package/lib/ │     我碰哪一行,
   │   client.js（3700）  │     都搅在一起
   └─────────────────────┘
            │
            ▼
   冲突概率 = 高（同文件 × 双源镜像）
   测试断言 = 镜像相等（verify-b5-quota.js L75-84 等）
   → 任何一方改完镜像对不上 = 测试全挂
```

---

## 四、设计理念（五大原则）

### 原则 ① 架构即契约（不要靠 AI 自觉）

| 错误思路 | 正确思路 |
|---|---|
| 写一份"哪些文件归谁"的契约，希望 AI session 都自觉遵守 | **让架构本身把会冲突的东西物理隔开**——AI 顺着一条路径改代码时，天然只落在一组文件里，够不到别的模块 |

> "契约防得住自觉的人，架构防得住大意双双落同文件。" —— 用户洞见，已被采纳为 §3 物理隔离原则。

### 原则 ② 一模块 = 一文件 = 一测试文件

| 文件 | 归属 |
|---|---|
| `views/ListTab.js` | 列表视图 owner |
| `statusbar/EnvBadge.js` | 环境徽标 owner |
| `kernel/store.js` | 共享状态 owner（**冻结层，conductor 单 session 改**） |
| `tests/verify-list.js` | 列表 owner 顺带维护 |
| `tests/verify-env.js` | 徽标 owner 顺带维护 |

**目录即所有权**——AI 改"技能"只碰 `views/SkillsTab.js` + `verify-skills.js`，物理上到不了 `views/ListTab.js`。

### 原则 ③ 唯一求变通道 = 内核 seam

```
  组件想"刷新"  →  api.refresh()    （走 kernel/api）
  组件想"翻译"  →  locale.tr()      （走 kernel/locale）
  组件想"开面板" →  router.open()    （走 kernel/router）
  组件想"存配置" →  config.set()    （走 kernel/config）

  AI 想加新功能 →  只调内核 seam →  别处零改动
```

### 原则 ④ 同层不互相 import（语法级硬隔离）

- 视图只 import 内核 seam，**禁止**视图 import 视图
- 容器只 import 内核 seam，**禁止**容器 import 容器
- 组件只 import 内核 seam + 自己的子组件
- **效果**：从语法上杜绝「改 A 被 B 牵连」——构建器一旦发现循环 import 直接报错。

### 原则 ⑤ Ctx 插座式 = 拆房间后公共物品怎么分发

> 3700 行代码原本在一个大闭包里，`store`/`h`/翻译机/定时器等公共物品随手放。拆文件后变成几十个小房间，**房间之间不能直接摸对方的东西**。

**定案 A：插座式（React Context）**

```
         大厅总电闸 (Provider) ── 供电 ──►
                                         │
   [状态栏]   [列表]   [技能]   [环境检查]   [map详情]   ...
        │       │        │         │            │
        └───┬───┴────────┴────┬────┴────────────┘
            │                 │
       标准插座孔         标准插座孔
       (useContext)       (useContext)
       要用就插上          要用就插上
```

| 方案 | 评估 |
|---|---|
| B 开会发文件（props 透传） | ❌ 中间每个房间都要当传话筒——把冲突请回来了 |
| C 大楼前台（模块级单例） | ❌ 谁都能从后门摸——回到大房间乱象；测试还得清理前台 |
| **A 插座式（React Context）** | ✅ 任意深度直接取，不用传话；测试时换「假电闸」就能单测一个房间 |

**关键设计**：cx = 模块级单例（引用永不变化），所以 Context 值变 → 全树重渲染的代价是 0；测试时只需 `React.createElement(DswsCtx.Provider, {value: fakeCx}, <被测组件/>)`，连真实 DSH 都不需要。

---

## 五、九字段 cx（Gx 冻结 8 + ctx 共 9 字段）

> 来源：`docs/architecture/kernel-contract.md` G3 拍板

```js
// src/client/kernel/ctx.js
export function createCx({ ctx, h, rdom, storeSvc, localeSvc, timer, api, router }) {
  return Object.freeze({ ctx, h, rdom, storeSvc, localeSvc, timer, api, router })
}

export const DswsCtx = React.createContext(null)
```

| 字段 | 来源（apply 闭包） | 用途 |
|---|---|---|
| `ctx` | `apply(ctx)` 参数 | cordis 上下文（effect 注册等） |
| `h` | 闭包 `h` | `React.createElement` 别名 |
| `rdom` | 闭包 `RDOM` | react-dom 访问器（createPortal） |
| `storeSvc` | kernel/store | Store / emit / sub / useStore |
| `localeSvc` | `ctx.get('locale')` | DSH locale 服务 |
| `timer` | `ctx.get('timer')` | DSH timer 服务 |
| `api` | kernel/api 包装 | host 桥（rpcCall + 可用性守卫） |
| `router` | kernel/router | 面板开关 / tab 导航 |

---

## 六、最终态 vs 当前进度（差多远）

| 模块 | 当前 | 最终 | 状态 |
|---|---|---|---|
| `package.json` + `build.sh` + `build.mjs` | ✅ 已就位 | 同 | T0 完成 |
| `src/seam/` 6 绑定 + 总装 | ✅ 已就位 | 同 | T0 完成 |
| `src/shared/parser.js` | ✅ 已就位 | 同 | T1 完成 |
| `src/client/kernel/tabsfold.js` | ✅ 已就位 | 同 | T1 完成 |
| `src/client/kernel/ctx.js` + 顶层 Provider | ✅ 已就位 | 同 | T2 完成 |
| `src/client/kernel/*` 9 模块 | ✅ 已就位 | 同 | T3 完成 |
| `src/host/index.js` + RPC 注册 | ✅ 已就位 | 进一步拆 `gh/repo/snapshot/parser/checks/handoff/claim/rpc/types` 8 件 | T4 ⏳ |
| `src/client/views/*` 7 视图 + `shared/` | ❌ 仍在 client.js apply 闭包内 | 全部抽成独立文件 | T4 ⏳ |
| `src/client/panel/*` 6 容器 | ❌ 同上 | 全部抽成独立文件 | T4 ⏳ |
| `src/client/statusbar/*` 5 徽标 | ❌ 同上 | 全部抽成独立文件 | T4 ⏳ |
| `src/client/floating/*` 3 浮层 | ❌ 同上 | 全部抽成独立文件 | T4 ⏳ |
| `tests/` 每模块专属 verify-*.js | 部分就位（kernel/parser/tabsfold） | 全模块覆盖 | T4 + T5 ⏳ |
| `tests/smoke-client.test.js`（jsdom） | ✅ T0 已就位 | 扩成完整冒烟网 | T5 ⏳ |
| 删除镜像断言（verify-b5-quota 等） | ❌ 镜像断言仍在 | 改为 src↔产物特征断言 | T5 ⏳ |
| DEV-WORKFLOW / README / CHANGELOG 更新 | ❌ | 同步构建流程 | T5 ⏳ |

**当前完成度**：~55%（结构地基 + 内核护栏全在，**叶子模块组尚未迁移**——这是 T4 的工作）

---

## 七、跨 session 并发模型（防冲突靠什么）

### 物理隔离矩阵

| 维度 | 机制 |
|---|---|
| 文件级 | 一模块一文件 → 不同 session 写不同文件，git 文本冲突 = 0 |
| 模块级 | 同层禁互 import → 改 A 的内部实现对 B 不可见，语义冲突 = 0 |
| 内核级 | kernel/ 默认冻结（接口表已落盘）→ 唯一会冲突的是 conductor 改内核 |
| 产物级 | `package/lib/*` gitignored → 脏树构建不会污染提交 |
| 测试级 | 每模块一测试 → 各自回归网，互不干扰 |

### 仍存在的共享文件（约 5 个，低频）

| 文件 | 冲突场景 | 兜底 |
|---|---|---|
| `package.json` | 加依赖 | 极低频，code review 一个文件 |
| `scripts/build.mjs` | 加 entry | 极低频 |
| `src/client/index.js` / `src/host/index.js`（组装入口） | 加新模块 import | 只 import，不改实现，append 一行 |
| `CHANGELOG.md` | 每人记录 | `merge=union` |
| `docs/architecture/*` | 文档 | 低频 |

**总共享文件 ≈ 5 个**，其余 35+ 文件 = 完全独立可并行。

---

## 八、一句话总结设计哲学

> **「不要相信 AI session 会自觉遵守契约，要把会冲突的东西物理隔开，让架构本身成为契约。」**
>
> 实现路径：
> 1. **构建管线** 消灭手写双源镜像（一源出两物）
> 2. **一模块一文件** 让文件所有权清晰
> 3. **同层禁互 import + 唯一通内核** 让依赖单向无环
> 4. **Ctx 插座式** 让公共物品分发显式且可测
> 5. **内核冻结** 让最易冲突的共享层有纪律
>
> 五个机制叠在一起，**两个 session 改代码 → 文件不相交 → git 冲突 ≈ 0**。