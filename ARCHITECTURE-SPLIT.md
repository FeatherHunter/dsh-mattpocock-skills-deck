# dsh-mattpocock-skills-deck · 源码拆分架构方案（并发趋零）

> 状态：方案稿 v1（AFK 2026-08-18 · 待人工审阅）
> 目标：多 session 并发开发插件各模块时，**文件级冲突趋近于零**。
> 依据：issue #15 修复中发现的「同机并行 session 在共享 checkout 上提交 #14/#15」真实冲突案例 + 本仓库代码实剖 + DSH 内核/官方插件事实查证。

---

## 0. 结论先行（TL;DR）

1. **拆文件的物理前提 = 引入构建管线**。DSH client 加载契约是「一插件一模块 id = 单 bundle 文件」（`window.__ModuleLoader__.load({id, factory})`，id 必须等于包名，`manifest.d.ts` 明示）。因此**运行时交付物必须是单文件 `lib/client.js`**；多源拆分只能靠「`src/` 多文件 → 构建 → 单 bundle」。这是官方范式（实查 `dsh-better-sidebar`：`src/client/*.{ts,tsx}` → `tsc + tsdown` → 单 `lib/client.js`）。
2. **构建不影响 DSH 实现**：加载契约、`?rev` 内容哈希刷新、`dsh.client.inject`（=依赖边，不是文件列表）、`immediately`（=prefetch）全部不动。改变的只是 `lib/client.js` 从「人手写」变成「构建生成」。
3. **消灭双源镜像**：`client.js ↔ package/lib/client.js`、`host.js ↔ package/lib/index.js` 两对手写镜像，是冲突×2 的根源 → 全部改为「`src/` 唯一真源 → 构建同时产出动态版片段 + npm 版 bundle」，人手不再同步。
4. **模块树按「host/client × 内核/模块/组件」分层**，每模块一个文件（+各自专属测试文件），模块间只依赖稳定接口（内核 seam）。两个 session 各认领不相交的子树 → git 冲突趋零。
5. **分 4 阶段迁移**，每阶段保持 bundle 全绿；**第一阶段先落「构建管线 + 纯函数叶子模块」**，风险最低。

---

## 1. 现状体检（为什么会冲突）

### 1.1 文件布局（实剖）

| 文件 | 行数 | 角色 | 双源镜像 |
|---|---|---|---|
| `client.js` | 3724 | 动态版 UI（`cordis_define` 函数体 `return {apply(ctx){...}}`） | 与 package 版镜像 |
| `package/lib/client.js` | 3741 | npm 版 UI（`__ModuleLoader__.load({id,factory})` CJS bundle）**← 真实加载对象** | 与根版镜像 |
| `host.js` | 804 | 动态版服务端（同镜像） | 与 package 版镜像 |
| `package/lib/index.js` | 51K | npm 版服务端 **← 真实加载对象** | 与根版镜像 |
| `tests/verify-*.js` | ×N | 行为回归 + **双源镜像断言** | —— |

**client.js 现有分区（apply 内，行号按根文件实剖）**——拆分时的「拆迁清单」：

| 行号(根 client.js) | 内容 | 目标归属（§4 模块树） |
|---|---|---|
| 55 / 66 / 356 / 821 / 880-890 / 944 | RDOM createPortal / DSW_VERSION / locale 字典 L / tr / Icon·Ic / PROMPTS | `kernel/`（可以先按原样搬） |
| 1004-1135 | cfg / saveCfg / templates / renderTemplate / migrateStartCfg / listPrefs / labelClicks | `kernel/config.js` |
| 1136-1330 | makeStore / storeOf / useStore / compute / loadChecks / buildColorOf | `kernel/store.js` + `host/checks` 数据 |
| 1342-1667 | detectCwd / loadSnapshot / probeNow / startAutoProbe / refreshAll | `kernel/probe.js` |
| 1751-1933 | openPanel / togglePanel / newWayfinderText / newBugWayfinderText / injectFixate / doHandoff / openInNewSession / inject / copyText | `kernel/router.js` + `kernel/api.js` + `host/handoff` |
| 1942-2181 | Dot / TypeChip / **StatusBar**(状态栏) | `client/statusbar/` |
| 2238-2358 | mdToHtml / tStatus / **MapDetail 上半** | `views/` + `kernel`（md 可作工具） |
| 2323 / 2687-2896 | TicketRow / **ListTab**(列表) | `views/ListTab.js` + `views/TicketRow.js` |
| 2973-3045 | RingSkills / **SkillsTab**(技能) | `views/SkillsTab.js` |
| 3046-3158 | **ChecksTab**(环境检查 9 项) | `views/ChecksTab.js` |
| 3167-3286 | **DetailsDock**(右栏详情·Dock) | `panel/Dock.js` |
| 3287-3455 | **OverlayPanel**(覆盖/悬浮) | `panel/Overlay.js` |
| 3456-3660 | **SettingsPage**(设置页) / **RunPanel**(运行卡) | `views/` |

### 1.2 冲突放大因素（按危害排序）

1. **手写双源镜像**：一个 3700 行的 UI 文件有 `client.js` 和 `package/lib/client.js` 两份，任何 UI 改动 = 两个文件都改。两个 session 同时碰 = **冲突 ×2**，且测试断言镜像相等（`verify-b5-quota.js` L75-84、`verify-capsule-narrow.js` L201 等）。
2. **单文件 monolith**：`client.js` 把所有 UI 塞进一个闭包（状态栏/右侧面板/列表/技能/环境检查/设置全在 apply 里）。改动任何模块 = 编辑同一份 3700 行文件。
3. **无构建、无模块边界**：无法 `import`，无法按模块抽文件，只能整份手改。
4. **共享可变状态**（内核 & 竞态源）：`storeOf/emit/sub/useStore`、`loadSnapshot/probeNow`、`cfg/templates`、`locale/prompts` 全部在一个闭包内，模块间隐式耦合——就算文件不冲突，语义上也会互相踩。
5. **现实中已发生**：issue #15 记录「实施过程中发现同机并行 session 在共享 checkout 上提交了 #14（`da9d2e4`），已核对未相互污染」——目前靠「小心」侥幸没坏，但不可持续。

### 1.3 目标定义

「冲突趋零」= 两个 session **各自只编辑自己认领的源文件（不相交子树）**，且因为：
- 每个模块一个文件 → git 层面文本冲突趋于 0；
- 模块间只依赖稳定接口 → 语义冲突趋于 0（A 改内部实现，B 无感）；
- 构建产物（`lib/*`、动态版片段）**永不人手编辑** → 镜像冲突 = 0。

---

## 2. 物理层：构建管线决策（回答「要不要引入构建」）

### 2.1 会不会影响 DSH 插件实现？—— 不会，且是官方范式

事实证据（子代理实查 `@deepseek-ai/dsh-client-modules` 内核 + 官方插件，未改任何文件）：

**① 加载契约（内核源码，`…\agent\node_modules\@deepseek-ai\dsh-client-modules\`）**
- `window.__ModuleLoader__` 由该内核在解析完 `window.__DSH_BOOT__` 后安装，一页只装一次；`load` 只是把 `{id, factory}` 注册进模块表（`lib/client.js` L70-75）。
- `id` = **注册键，且必须是「包名 == graph 行 id」**（`lib/types/client/manifest.d.js` L100-110）。Boot 图是**扁平表**：一条目 = 一个 `id` = 一个端点 `/plugins/<id>/client.js?rev=...`（L46-73，L37 注释 "module-graph boundary, flat today"）。
- `dsh.client.inject` **不是**「额外 client 文件列表」，而是 **package-name 依赖边**（preflight/HMR diff 用，L54-57）。`immediately` = stage-one prefetch（只注册 factory 不物化，L56）。
- 主 bundle 文件 = `exports["./client"]` 解析出的文件，`serveBundle` 直接读它（`lib/index.js` L255-258、L313-344）。
- **明确结论**：同包「多个 client 模块 id」不被 boot 契约支持（id 唯一、graph 扁平）；官方内部的拆分走「async 子 chunk」（`globalThis.__dshChunks__` + `import()`，共享同一模块表，非独立模块 id），或「包内第二个独立 entry = 第二个 boot 行」（独立 id + URL）。

**② 运行时落地**

- 运行时 `http://127.0.0.1:59519/plugins/dsh-mattpocock-skills-deck/client.js?rev=…` 磁盘指向已装副本 `C:\Users\辰辰洋洋\.dsh\profiles\web\node_modules\dsh-mattpocock-skills-deck\lib\client.js`（**不是**仓库根 `client.js`），`?rev` 内容哈希 → 构建产物带新哈希，刷新即生效。

**③ 官方范式（实证 `dsh-better-sidebar`）**

- `src/` 大量源文件（host `src/index.ts` 等 + `src/client/*.{ts,tsx}` 几十个 UI 源）；`package.json` scripts：`"build": "rm -rf lib && tsc -p tsconfig.build.json && tsdown"`，devDep = `tsdown + typescript`。
- 产物 `lib/client.js`（`./client` export）是**单 bundle**，head 即 `window.__ModuleLoader__.load({ id: "dsh-better-sidebar", … })`。官方约定 client = **构建产出物**，非源码。
- **因此：引入构建 = 向官方范式对齐，不是特立独行；本仓库要拆源必须先引入构建管线并输出单 bundle 到 `package/lib/client.js`。**

> ⚠ 选型注意：官方用 `tsdown + TS`，本方案默认用 **esbuild + 纯 JS**（§2.4 有理由：零类型迁移、反馈快、AI 开发循环更稳）。两者都满足「src/ 多源 → 单 bundle」；若你后续想对齐官方或要类型安全，把构建器换成 `tsdown` 即可，迁移路子不变。

### 2.2 收益（Why build）

| 收益 | 说明 |
|---|---|
| 🎯 消灭双源镜像 | `src/` 唯一真源，`package/lib/*` 与动态版片段都由构建生成 → 最大冲突源归零 |
| 🎯 文件级隔离 | 每模块一个文件，session 各改各的 |
| 🎯 模块边界/可复用 | 可 `import`，公共件只写一次（如 #15 的 tabs 行在 Dock+Overlay **重复实现两遍** → 抽成共享组件） |
| 类型/语法检查前置 | tsc/vm 编译在构建时快失败，不用等人手跑 |
| 官方一致 | 后续入 market/与其他官方插件协作零摩擦 |
| 增量可测 | 每阶段先抽纯函数叶子，逐步替换，随时可回退 |

### 2.3 风险与对策（Why risk & mitigation）

| 风险 | 对策 |
|---|---|
| 迁移 3700 行 monolith 工作量大 | **分 4 阶段**，每阶段小步、bundle 全绿、可回退（§5） |
| 行为漂移（迁移改变运行时行为） | 迁移期间保留现有镜像断言直到切换点；切换后镜像断言改为「src 特征 ↔ 产物特征」 |
| dev loop 变长（改→build→refresh） | ① 构建工具用 watch 模式；② 动态版片段同源生成，dev 端体验不变 |
| 工具链依赖（tsdown/node） | 仓库本来就用 node 跑测试；devDep 可控；失败路径 = 退回人手同步（有 git 历史可还原） |
| 双 wrapper 复杂性（动态版 vs npm 版差异） | 差异已被源码头注释明示（React 来源 / styles 注入 / host.call 桥）；构建时用**两个 entry wrapper** 统一出两种产物，一个真源两处消费（§4.4） |

### 2.4 选型（推荐 · 针对「AI 开发、人类只看成果」）

你的项目是 **AI 写代码、人类审结果**。这改变选型逻辑——不选「最官方」，选「**让 AI 开发循环最快最稳**」：

| 维度 | esbuild（选） | tsdown + TS（不选） |
|---|---|---|
| 构建速度 | 毫秒级，`改→构建→刷新→看成果` 反馈延迟最小 | 秒级+（tsc 全量） |
| 配置/心智 | 单命令 `entry→outfile`，零魔法 | 需要 tsconfig.build / dts / 约定 |
| 源码迁移 | 3700 行 ES5 JS **原样搬**，零类型体操 | 先过 TS 类型关，AI 维护 `.d.ts` |
| 解决什么问题 | **并发趋零（拆文件+接口稳定）** | 类型安全 |
| 失败模式 | 极少、易诊断 | 类型报错/构建配置错，面更大 |

**结论**：你要的是「拆」，不是「换语言」。**用 esbuild 做纯 JS 的模块化拆分**——把 `apply(ctx)` 闭包拆成能 import 的 ES 模块文件，构建直出 bundle。TS 完全不需要，也不引入。

- **构建器**：`esbuild`（devDep 引入，`node esbuild src/client/index.entry.js --bundle --outfile=..`）。
- **源码语言**：保持 **JS**（仓库现 3700 行全是 ES5 风格，原样拆分，不重写）。**文件一律 `.js`（UI 组件也是 `.js`，因为本仓库用 `React.createElement` 手写、无 JSX 标签）——不引入 `.ts`/`.tsx`。**（官方插件用 `.tsx` 是因为他们用了 TS + JSX，与本方案无关。）
- **目录**：`src/host/`、`src/client/`（见 §4 模块树）。
- **产物（双 entry）**：
  - `_pkg` → `package/lib/client.js`（`__ModuleLoader__.load` CJS bundle，**真实加载**）
  - `_dev` → 仓库根 `client.js`（动态 runner 的 `cordis_define` 函数体片段）
  - host 同理 → `package/lib/index.js` + 根 `host.js`
- **根文件去留（拍板）**：**保留 `client.js`/`host.js` 为构建产物**（`_dev` entry 同源生成）——两条消费路径（动态 runner / npm 加载）都不变，只是源头从「人手写」变「构建出」；删除会破坏动态 runner 开发路径。彻底消灭的是**手写镜像**，不是文件本身。

> 决策已定，无需人工复核此条；若你后续想要类型安全再谈 TS，与本次无关。

---

## 3. 并发趋零：靠架构物理隔离，不是靠契约

> ⚠ **第一性原理修正**（你提出、我认可）：**不要指望「AI 看契约后自觉不碰别人」——契约是人的纪律，AI session 之间没人约定就照冲。** 真正的解法是：**架构本身把「会冲突的东西」物理分隔开，让 AI 顺着一条路径改代码时，天然只落在一组文件里，永远够不到别的模块的文件。** 契约只作为兜底，不作为主手段。

### 3.1 物理隔离原则（架构即契约）

| # | 原则 | 机制（AI 不必读契约也天然遵守） |
|---|---|---|
| 1 | **一模块 = 一文件 = 一测试文件** | 目录即所有权。AI 改「技能」只碰 `views/SkillsTab.js` + `verify-skills.js`，物理上到不了 `views/ListTab.js` |
| 2 | **同层不互相 import** | 视图只 import 内核 seam，**禁止**视图 import 视图/容器 import 视图 → 从语法上杜绝「改 A 被 B 牵连」 |
| 3 | **唯一求变通道 = 内核 seam** | 状态/文案/路由/API 只经 `kernel/*`；AI 想加「刷新」按钮只需 `api.refresh()`，别处零改动 |
| 4 | **产物不可手编** | `lib/*`、动态片段由构建生成 → AI 永远不该 edit 它们（file 权限/只读声明也行） |
| 5 | **依赖单向、无环** | src 依赖图单向流动，构建器报 circular import 即自动化拦住乱改 |

**结果**：即使两个 session **根本不知道对方存在**、不看任何契约、并行改代码——它们的文件集合不相交，git 合并=追加式，冲突趋零。这比你设想的「契约」强一个量级：**契约防得住「自觉的人」，架构防得住「大意双双落同文件」**。

### 3.2 仅剩的共享文件（极小，且无文件级隔离的必然存在）

这 5 个文件跨模块天然共享，靠「小 + 串行 + 合并友好」兜底：

| 文件 | 冲突场景 | 兜底 |
|---|---|---|
| `package.json`（构建 scripts/devDeps） | 加依赖 | 改动极低频；代码 review 一个文件 |
| `esbuild.config` | 加 entry | 同上 |
| `src/*/index.js`（组装入口） | 加/改模块 | 只 import，不改实现，append 一行 |
| `CHANGELOG.md` | 每人记录 | **每人一行 append** + `.gitattributes` `merge=union`（可选） |
| `README/ARCHITECTURE` | 文档 | 低频 |

> 共享文件总共 ~5 个且都极小、低频、append 式——不是冲突面，是「编年记录面」。

---

## 4. 目标模块树（第一性原理分层）

> 树 = 「host 数据半 / client 表现半」×「内核(共享/底层) / 模块(中台) / 组件(叶子)」。
> 叶子越小、依赖内核 seam 越专一、越少碰别的叶子 → 并发越安全。

### 4.1 总览

```
dsh-mattpocock-skills-deck/            （唯一真源根）
├── package.json                        （构建 scripts / dsh 配置上楼）
├── tsconfig.json / tsdown/esbuild 配置
├── build.sh                            （DSH 插件生产线惯例：junction + 构建 + 同步 profile）
├── src/
│   ├── host/                           ★ host 半（拆自 host.js，纯服务端逻辑，无 UI）
│   │   ├── index.js                    【组装】apply(ctx) + RPC 注册表
│   │   ├── gh.js                       【模块】gh 封装（resolveGh/runGh/execProc/……）
│   │   ├── repo.js                     【模块】仓库定位/根检测/磁盘缓存（getRepoRoot/readDiskCache/writeDiskCache）
│   │   ├── snapshot.js                 【模块】快照构建（fetchMaps/fetchIssues/buildSnapshot/mapTicket/groupTickets/……）
│   │   ├── parser.js                   【模块】纯函数解析（parseMapBody/parseProgress/computeLevels）
│   │   ├── checks.js                   【模块】前置检查（checkRepo/setup/tracker/ghcli/auth/api/skill）→ buildStatus
│   │   ├── handoff.js                  【模块】交接文档扫描/最新（scanHandoffDir/pickLatestHandoff）
│   │   ├── claim.js                    【模块】认领流程（T5）
│   │   ├── rpc.js                      【模块】端点定义 + 参数整理 + errText（可测）
│   │   └── types.js                    【内核】快照/票/检查的类型联合
│   └── client/                         ★ client 半（拆自 client.js；**node_modules 里真实加载 = 单 bundle**）
│       ├── index.js                   【组装】apply(ctx) 挂载 + 根渲染 + 生命周期
│       ├── kernel/                     【内核：稳定 seam，并发时默认冻结】
│       │   ├── store.js                Store 工厂 / emit / sub / useStore（会话级状态）
│       │   ├── locale.js               dsws zh/en 字典 + tr()（命名空间）
│       │   ├── prompts.js              PROMPTS 注册表 + promptText()（双语动作文案）
│       │   ├── router.js               面板开关 / tab 切换（openPanel/openDockPanel/togglePanel）
│       │   ├── config.js               cfg/templates 持久化 + 广播（旧 startCfg 迁移）
│       │   ├── api.js                  host 桥（rpcCall/inject/openInNewSession/copyText）
│       │   ├── probe.js                loadSnapshot/probeNow/diffSnapshots/refreshAll/autoProbe
│       │   ├── styles.js               STYLE_TEXT 唯一真源 + 两类注入适配（styles.insert vs <style data-plugin>）
│       │   └── icons.js               Icon / Ic / Dot / TypeChip 通用图标
│       ├── statusbar/                  ★ 状态栏面板（用户指定模块 1）
│       │   ├── StatusBar.js           胶囊组装 + 环境段/就绪计数
│       │   ├── Seg.js                 分段按钮（go 到各 tab）
│       │   ├── EnvBadge.js            环境/技能就绪徽标
│       │   ├── checksums.js           7/9 等汇总徽标
│       │   └── runcard.js             运行卡/配置引导（RunPanel 的 statusbar 侧）
│       ├── panel/                      ★ 右侧面板容器（用户指定模块 2 的外壳）
│       │   ├── Tabs.js                ⭐ 共享 tabs 行（**现在 Dock+Overlay 重复两遍** → 抽一次，两边 import）
│       │   ├── TabsFoldMachine.js      折叠等级机器 tabsLevelDecide + TABS_LEVELS + 滞回（拆出 #15 逻辑，纯函数可测）
│       │   ├── Tooltip.js             portal 悬浮提示（技能同款，tabsTip 复用）
│       │   ├── Dock.js                侧栏停靠容器（原 DetailsDock）
│       │   ├── Overlay.js             漂浮容器（原 OverlayPanel，含拖拽/缩放）
│       │   └── Shell.js               Dock/Overlay 共享的骨架（头/内容/尾）
│       ├── views/                      ★ 右侧面板内容视图（用户指定模块 3）
│       │   ├── ListTab.js             【视图】列表（含 sorting/filter/chips/行动作）
│       │   ├── TicketRow.js           【视图】issue 行（含行级诊断/执行/讨论按钮）
│       │   ├── MapDetail.js           【视图】地图详情（漏斗分层/节点/gate）
│       │   ├── SkillsTab.js           【视图】技能（含 RingSkills 圆形技能环）
│       │   ├── ChecksTab.js           【视图】环境检查（9 项检查卡片）
│       │   ├── SettingsPage.js        【视图】设置页（配置/模板编辑器）
│       │   └── RunPanel.js            【视图】运行卡（如需独立）
│       └── floating/                   ★ 技能悬浮列表 & 浮层（用户指定「技能悬浮列表」）
│           ├── SkillFloatList.js      技能悬浮列表
│           ├── Pop.js                 通用标签/悬浮浮层（原 showPop 体系）
│           └── tagsFit.js             标签自适应（fitAllTags）
├── tests/
│   ├── verify-<module>.js              ★ 每模块专属（如 verify-status/verify-panel/verify-tabs-narrow……保留，改对 src 或产物断言）
│   ├── verify-mirror.js                （改）双源断言 → 「src 特征 ↔ 产物特征」一致
│   └── …（其余保留）
└── scripts/publish-login-window.ps1    （保留）
```

### 4.2 模块与用户描述的对应

| 你说的模块 | 映射到树 | 说明 |
|---|---|---|
| 状态栏面板 | `client/statusbar/` | 一组组件（Seg/EnvBadge/checksums/runcard），内部按钮各自成文件 |
| 右侧面板 | `client/panel/` + `client/views/` | 容器(Dock/Overlay/Tabs/Shell) 与 内容视图(列表/技能/环境) 分开 |
| 列表 | `client/views/ListTab.js` | 独立 |
| 技能 | `client/views/SkillsTab.js` (+RingSkills) | 独立 |
| 环境检查 | `client/views/ChecksTab.js` | 独立 |
| 新增需求 / 新增bug / 刷新 | `client/panel/Tabs.js` 或 `kernel/router.js` 的动作 | 属 tabs 行按钮动作 → 由 actions 内核 seam 提供 |
| 技能悬浮列表 | `client/floating/SkillFloatList.js` | 独立 |
| 底层逻辑 | `src/host/*` + `client/kernel/*` | host 数据流 + client 内核 store/probe/api |

### 4.3 内核接口（seam 契约，稳定就好并发）

- `store.of(sids) → { state, emit }`；模块不得直接碰别人的 `store.subs`。
- `locale.tr(key, params)` / `prompts.text(id, params)`：文案统一入口，别处无硬编码中文。
- `router.open(tab)` / `router.toggle()`：所有「去哪个面板/哪个 tab」只经这里。
- `api.rpc(endpoint, args)` / `api.inject(text)` / `api.openNewSession(text)`：一切 host 交互走这里。
- `config.get/set`：持久化唯一入口。
- 组件 → 只 import 内核 seam + 自己的子组件，**不** import 同级别视图/容器。

### 4.3.1 跨模块上下文传递（关键机制 · 防止「拆完装不回」）

现在 3700 行全在 `apply(ctx)` 一个闭包里，`h`(React.createElement)、`ctx`、`storeOf/emit/sub/useStore`、`localeSvc`、`cfg/templates`、`promptText` 都是闭包局部变量。拆成 ES 模块后**这些共享物不能靠闭包继承**，必须有显式传递机制。选型：**单一 `Ctx` 对象 + 构造函数注入**（不搞 IoC 容器，不搞全局）。

```js
// src/client/kernel/ctx.js —— 所有共享依赖的唯一载体
export function createCtx({ ctx, h, rdom, localeSvc, storeSvc, timer }) {
  return { ctx, h, rdom, localeSvc, storeSvc, timer }
}
```
- 每个视图/容器模块**导出工厂**（`export function ListTab(cx) { return (props) => {...} }`），由 `index.js` 在 apply 时统一建 cx 后**调用各工厂**，把组件函数塞回一棵渲染树。
- 纯逻辑模块（probe/store 派生）同理：`export function makeProbe(cx) {...}`，注入依赖、返回方法集。
- **效果**：模块之间**零隐式全局**；某模块内部怎么改都不影响别的模块；测试时只需 `createCtx(fake)` 即可单测该模块，连 DSH 都不需要。

> ✅ **Ctx 机制已定案（2026-08-18 · 用户拍板选 A 插座式）**：详见 `ARCHITECTURE-CTX.md`。组件用 React Context（`useContext`）取依赖，逻辑模块用工厂注入（`makeProbe(cx)`），cx 为模块级单例；接线顺序 = 先建 `ctx.js` + 顶层 Provider（行为零变化）→ 逐模块迁移，每迁一个跑一轮全绿。此前的「工厂注入」描述被定案文档取代（组件改为 Context 取用，逻辑模块保留工厂注入）。

⚠ 这是**拆分能成立的前提**：如果跳过它、靠「每个文件自己 `require('react')` + 自己造 store」，就会变成一个新的隐式耦合 monolith，并发趋零目标作废。故列为阶段 2 的第一步、且是唯一硬性约束。

源码头注释已记载 4 个差异：React 来源 / styles 注入 / host.call 桥 / timer 兜底。构建时：
- **entry `_pkg`**（默认）：产出 `__ModuleLoader__.load({id, factory})` 的 CJS bundle → `package/lib/client.js`（真实加载）。
- **entry `_dev`**：产出 `cordis_define` 的 `code.client` 函数体 → 仓库根 `client.js`（动态 runner 用）。
- host 同理：`_pkg` → `package/lib/index.js`，`_dev` → `host.js`。
- 两 entry 都从**同一批** `src/client/*` 来，React/styles/host.call 由 wrapper 各自适配（和小型 shim），功能逻辑零手写差异。

---

## 5. 迁移路线（分 4 阶段，每阶段全绿可回退）

> 每阶段结束：`node tests/*.js` 全 PASS + build 产物能 serve（`?rev` 变）+ 手动冒烟。

### 阶段 0 · 搭建构建管线（不搬任何代码，先让「构建=复制」成立）
- 根 `package.json` 加 `devDependencies` + `scripts.build`（esbuild/tsdown）；
- `build.sh`：构建 → 产出 `package/lib/*` + 同步 `~/.dsh/profiles/web/node_modules/...`（沿用 DEV-WORKFLOW §3 ④流程）；
- 先让「构建产物 == 现有 `package/lib/*` 内容（特征抽查一致）」；
- ✅ 验收：build.sh 跑通、QA 加载仍是原样。
> 🛡 阶段 0 不改变任何运行时行为，只是把「人手 Copy-Item」变成「构建产出 Copy-Item」。

### 阶段 1 · 抽纯函数叶子（零依赖、行为风险≈0）【✅ 已完成 2026-08-18 · commit 见 git log】
- 从 host 抽 `src/shared/parser.js`（`normalizeBody/parseMapBody/parseProgress/computeLevels/groupTickets` 纯函数，ESM 命名导出）；
- 从 client 内核抽 `src/client/kernel/tabsfold.js`（`tabsLevelDecide + TABS_FOLD_HYST(=4) + TABS_LEVELS(=3)`，纯函数，**#15 逻辑就地沉淀**）；
- 新测试 `tests/verify-parse-leaf.js` + `tests/verify-tabsfold-leaf.js`：**差分测试**（叶子 === host.js/package/lib 内联版本，同一批输入逐字节一致）+ 行为真值表 + 双源镜像特征断言——既钉住「搬坏」探测器，又防「双源一起错」；
- ✅ 验收：两个新测试全 PASS + 既有回归（verify-progress/tabs-narrow/status 23/23/panel 14/14/t3-locale）全绿，生产行为不变。
> ⚠ **状态说明**：阶段 1 的叶子是「**唯一真源 + 测试基准**」但**尚未被生产代码 import**（host.js/client.js/package/* 仍内联同逻辑，行为零变化）。真正「接手」在阶段 2 引入构建 + Ctx 注入时完成。不要在阶段 1 就把生产文件改成 import 叶子——那跨过了构建前提。
> 🛡 叶子模块没有共享状态、不碰 DOM，抽出去几乎不可能回归。

### 阶段 2 · 领域模块化（中台 + host）
- `src/host/*`：按 §4.1 拆 `gh/repo/snapshot/checks/handoff/claim/rpc`，RPC 表不动；
- `src/client/kernel/*`：store/probe/api/router 从闭包抽成带接口的模块；
- `src/client/panel/Tabs.js + Tooltip.js`：把 **Dock/Overlay 重复的 tabs 行抽成共享组件**（顺带把 #15 修复从两处合成一处，杜绝二次失步）；
- ✅ 验收：现有全部 verify 迁移到对 src 断言（或经构建后对产物断言），全绿。
> 🛡 阶段 2 是主体工作量；每拆一个模块，就当次 bundle 全绿再动下一个。

### 阶段 3 · 视图与浮层 + 收尾
- `src/client/views/*`、`src/client/floating/*`、`src/client/statusbar/*` 拆出；
- 删除手写镜像断言（`verify-mirror` 改为 src↔产物）；
- 更新 `DEV-WORKFLOW.md`（同步流程 = 构建）、`README`、`CHANGELOG`；
- ✅ 验收：`client.js`/`package/lib/client.js` 源码级删除或降级为产物，仓库只见 `src/`。

### 迁移期间的多 session 纪律
- 并发 session 只 claim 阶段未交叠的叶子/模块文件；**但按 §3 修正——主防不是「登记」，而是架构的物理隔离本身**（模块文件不相交 + 同层禁止互 import）。登记表仅作辅助，非必需。
- 阶段 0/1 可并行（各自独立文件）。
- 阶段 2 拆「store/probe」与拆「panel/Tabs」彼此不相交，可拆成两个 session 各干一半。

---

## 6. 收益量化（主观但可验）

| 度量 | 现状 | 目标 |
|---|---|---|
| 人手同步的文件对 | 4（2 对镜像 × 2） | 0 |
| UI 单文件行数 | 3724（人人必碰） | 每模块 < 300（只被 owner 碰） |
| 两个 session 改不冲突的概率 | 低（同 3700 行文件） | 高（不相交文件 + 同层禁互 import + 冻结内核） |
| 新增一个 tab/按钮 | 改 3700 行 + 镜像 3700 行 + 同步 | 改自己视图文件 + 走 router seam |
| #16 类「两处实现失步」风险 | 高（Dock+Overlay 各写一遍） | 低（Tabs.js 一处） |
| 防冲突手段 | 靠 session「自觉」(失败过) | 靠架构物理隔离（语法级，不看契约也成立） |

---

## 7. 决策状态（已按沟通定稿，剩余 1 项等你发令）

| # | 决策 | 状态 |
|---|---|---|
| 1 | 构建器/语言：**esbuild + 纯 JS**（不引入 TS） | ✅ 已定（§2.4 有完整理由） |
| 2 | 根 `client.js`/`host.js`：**保留为 `_dev` 构建产物**，不删 | ✅ 已定 |
| 3 | **OWNERS 表**：**不建表**——防冲突靠 §3 架构物理隔离（你提出的洞见，已采纳） | ✅ 已定 |
| 4 | **Ctx 机制**：**A 插座式（React Context）**，逻辑模块工厂注入；详见 `ARCHITECTURE-CTX.md` | ✅ 已定（2026-08-18 你拍板 A） |
| 5 | 是否执行**阶段 0**（搭构建管线，不搬代码）：**等你审完方案发令** | ⏸ 待你启动 |

> 说明：§5 阶段 0 是「只架构建、零行为变化、风险最低」的冷启动步骤。Ctx 命门已钉死（`ARCHITECTURE-CTX.md`），阶段 2 可随时安全开工。
