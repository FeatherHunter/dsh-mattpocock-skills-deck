# Tracker 契约层 · 目录架构决策记录

> 日期：2026-08-23 初版 · 2026-08-26 18:00 增补 #217 链契约（chain.js / predicateRegistry / actions / catalog）· 决策者：FeatherHunter（维护者）
> 范围：本文件记录「定稿 Tracker 契约」MAP（#112）的一处**架构级目录决定**——契约层及其配套（后端、平台层、测试）的目录/文件如何组织。此决定是子图 #113（平台层）、#114–#116（各后端）的**实现骨架**。
> 约束：讨论假设读者只懂「用户角度功能」，不预装插件内部知识——概念与理由在正文内即席解释。

---

## 1. 背景（用户视角）

MattSkillsDeck 是 DeepSeek Harness（DSH）里的「地图/任务」生态：一张张地图（map）由一组 issue（票）构成，面板显示每张图的状态（frontier / claimed / blocked），可开新会话、点「执行」。

- 目前它**只认 GitHub issue**（通过 `gh` 命令行工具读写 GitHub）。
- 目标：跨平台、可换 tracker（GitLab / 本地 markdown / 第三方），且 UI 不用重写。

**解法**：在 UI 与后端之间插一层**契约层**——一份「大家都遵守的接口 + 标准数据形状」。UI 只跟契约层说话，不知道后端是谁；每个后端把**自己平台的数据翻译**成标准形状；翻译不了的部分给**确定空值**（`[]`/`''`/`null`），或如实上报「我这项不能」（能力如实上报，不硬装）。

### 插件内部名词（解释）

- `host/`：DSH **宿主（Node）**侧——真去读 GitHub/文件、算状态的那半边。
- `client/`：**浏览器**侧——用户看到的面板 UI。
- `shared/`：host 与 client **都要用**的类型/公共代码（纯数据，无 IO）。
- `bridge/`（原 `seam/`）：host 与 client 之间的**绑定桥**（RPC 传输、定时器、样式注入等），与业务无关的胶水。

### 两条缝（架构核心词）

- **主缝** = UI ↔ 后端（契约层，本 MAP）。
- **次缝** = 后端 ↔ 操作系统（平台抽象层，`#113` 设计）。
- **后端访问 OS 只能走次缝**——这样「getHome 只认 Windows」「路径硬编码反斜杠」这类 bug 被结构性消灭。

---

## 2. 决策

1. `src/seam/ → src/bridge/`（DSH host↔client 绑定桥；「缝」一词还给架构语义）。「已定、**重构时应用**」——改名牵动 build.mjs 与全部 import，属后续 God-file 拆分轮（#113/#114），本骨架未涉及；骨架期间代码仍在 `src/seam/`。
2. **契约层分两处**：
   - `shared/tracker/`：**形状 + 常量 + 检查链条契约**（host/client 共用、纯类型/纯函数无 IO；新增 `chain.js` 一等公民 + `check-catalog.js` 目录边界）—— #217 定版。
   - `host/tracker/`：**契约/registry/capability/preflight/backends/predicateRegistry**（host 侧逻辑；新增 `predicateRegistry.js` 宿主谓词注册表，纯函数 `evaluateChain` 的异步前置）。
   - `client/kernel/`：新增 `actions.js` 动作分发器（UI 层执行器，契约层形状的唯一消费者）。
3. **后端 = 目录，按操作域拆文件**（避免单文件过大、AI 实现不漏分支）。
4. **平台层 = 接口 + 每 OS 一个子目录**（`darwin/` `win32/` `linux/`），内部归 `#113` 设计。
5. **测试用领域名，不用缩写**（无 `g4.test` 这类命名）：`tests/tracker-contract/` + `tests/verify-tracker-contract.js` + `tests/tracker-contract/sections/chain.js`（#217 链契约测试）。
6. **ADR**：`docs/adr/20260826-check-item-chain-contract.md`（#217 本票定版，版本与效力 2026-08-26 18:00）。

---

## 3. 目标目录树

```
src/
├── bridge/                        ⌈ 原 seam/ ⌉ DSH host↔client 绑定桥
│   ├── rpc.js  runtime.js  timer.js  style.js  editor.js  sidebar.js  gate.js  index.js
│
├── shared/                        ⌈ host + client 共享，纯数据/类型，无 IO ⌉
│   ├── parser.js                  (existing)
│   └── tracker/
│       ├── shape.js               ← 归一化完整形状（RepositoryRef/Issue/Comment/Label/MapNode/BackendStatus）
│       ├── constants.js           ← backend kind / state / capability-signal 枚举
│       ├── chain.js               ← 检查项/链条/动作词汇表一等公民 + 纯函数求值器（#217，契约层唯一真源）
│       └── check-catalog.js       ← 通用/后端检查目录边界与迁移映射（#217，14 必迁对齐）
│
├── host/
│   ├── index.js                   ← 插件入口（瘦）：装配 platform + tracker + rpc，注册即止
│   ├── platform/                  ⌈ 次缝 · #113 设计 ⌉
│   │   ├── index.js               ← 平台抽象接口（原语：os/env/path/fs/resolve）
│   │   ├── darwin/  win32/  linux/   ← 每 OS 一个子目录（本 MAP 占位，实现归 #113）
│   │   └── README.md              ← 占位说明 + 给 #113 的建议
│   ├── tracker/                   ⌈ 主缝 —— 本 MAP ⌉
│   │   ├── contract.js            ← Tracker 接口 + 归一化约定（正常化规则）
│   │   ├── registry.js            ← trackerRegistry + 插件注册钩子 + 按 workspace 缓存
│   │   ├── capability.js          ← capability-by-fill 推导（纯诊断视图，G5）
│   │   ├── preflight.js           ← detect / preflight / 错误 kind 分类
│   │   └── backends/              ⌈ 各后端适配器（#114–#116）⌉
│   │       ├── github/            ⌈ 每后端一个目录，按操作域拆文件 ⌉
│   │       │   ├── index.js       ← 薄适配器：把下面文件装成「Tracker」实现
│   │       │   ├── client.js      ← gh CLI 封装（resolve / 超时 / terminate）
│   │       │   ├── queries.js     ← GraphQL 查询/片段
│   │       │   ├── normalize.js   ← 原始形状 → 契约标准形状（+反向）
│   │       │   ├── errors.js      ← 错误 → 契约 kind（auth/rateLimit/notfound/unsupported）
│   │       │   ├── preflight.js   ← 探测/登录/API 可达
│   │       │   ├── issues.js      ← list/get/create/close
│   │       │   ├── comments.js    ← list/create
│   │       │   ├── labels.js      ← list/create
│   │       │   └── graph.js       ← subIssue / blockedBy / blocking
│   │       ├── markdown/          ← 结构同（path/parse/read/write/normalize/issues/comments/graph/preflight）
│   │       └── gitlab/            ← 结构同（glab）
│   └── rpc/
│       ├── status.js  snapshot.js  issue.js  claim.js  ...   ← wf.* 薄编排（调 tracker → 回 client）
│
├── client/                        ⌈ UI（不变，#217 新增 actions dispatcher）⌉
│   ├── kernel/
│   │   ├── actions.js             ← 动作分发器（UI 层执行器，#217）
│   │   └── ...  panel/  statusbar/  views/  views/shared/
│
└── tests/
    ├── tracker-contract/
    │   ├── harness.js             ← 共享断言运行器（后端必须过）
    │   └── fixtures/
    │       ├── compliant.js       ← 合规桩
    │       └── violating.js       ← 违规桩
    └── verify-tracker-contract.js ← 入口（对齐 verify-* 约定）
```

---

## 4. 为什么这样（理由）

- **AI 开发正确性**（维护者判据）：
  - 形状只在 `shared/tracker/shape.js` 一处 → host/client 不会各写一套而漂移。
  - 行为只在 `host/tracker/` → 不会把 host IO 拖进 client 包。
  - 后端按操作域拆文件 → 单文件体积小、AI 实现某类操作直奔对应文件、不漏分支。
- **两层缝同构**：主缝（Tracker = 接口 + 每后端一个适配器）、次缝（Platform = 接口 + 每 OS 一个适配器），同一 ports-and-adapters 范式，认知负担低。
- **契约最小**：`shared/tracker/` 只放形状/常量；`contract.js` 只定「规矩」（接口+归一化规则），各后端的「翻译方法」在自己 `normalize.js`。

---

## 5. 平台层（#113）方向 / 建议

- **结构**：`platform/index.js`(抽象接口) + `platform/<os>/`(实现)，与主缝同构。
- **原语**：`os`(平台探测) / `env`(用户主目录/HOME 优先级) / `path`(跨平台拼接) / `fs`(DSH 沙箱封装) / `resolveExecutable`(gh/glab/sh/cmd)。
- 本 MAP 只占位 + 上述建议；**实现细节归 #113**，`#110`(macOS getHome/反斜杠) 与 PR `#106` 收尾归此层。

---

## 6. 契约测试（领域名）

- 断言方向：来源有数据 → 必映射；来源无 → 必 `EMPTY`（`[]`/`''`/`null`）；能实现的能力字段必 `EMPTY` 而非 `MISSING`；不能实现的必 `MISSING` 而非 `EMPTY`。
- 夹具与断言实现归各后端子图；本骨架用合规桩/违规桩证明契约本身可被满足/可被验收。

## 7. 第三方扩展（#117 #148 范式）

- 范式样板：`examples/demo-mini/`（`demo-mini` 4 ops + `matches` + `normalize`，余下 9 ops 由 `registry.js` Proxy 补 `unsupported`，`describe` 复用骨架，不默认装配，零发包）。
- 指导文档（主入口）：`docs/architecture/third-party-tracker.md`（注册/探测/能力/测试/打包/更新六章 + Checklist/FAQ，接真实工具步骤）。
- 检验：`tests/verify-tracker-contract.js` 织入 `runContractTests(demoFixture)` + `runPlayback({fixturesDir:'examples/demo-mini/fixtures/demo-real'})`（`359/4/OK`）。
- 后端实现索引：`src/host/tracker/backends/README.md` 增“第三方章”。