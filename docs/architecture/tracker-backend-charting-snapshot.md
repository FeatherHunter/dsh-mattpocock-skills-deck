# Tracker 后端抽象 · 建图讨论快照（零丢失）

> 性质：wayfinder 建图的前置讨论快照，记录从「修 PR #106 / issue #110」到「把插件打磨成跨平台 + 可插拔 tracker 后端」的完整决策史。每条结论尽量附证据。
> 日期：2026-08-22 · 参与者：维护者（FeatherHunter / 王辰浩）+ agent（wayfinder 会话）
> 第一性原理：结论直接对着代码/制品/官方契约核验，不引用转述。

---

## 0. 触发器

- PR「fix: macOS 用户主目录探测 + 路径分隔符适配」（#106，作者 Shimmernight，FIRST_TIME_CONTRIBUTOR）
- issue「[macOS] 环境检查技能探测失败」（#110，作者 hyperion2144）
- 维护者自述真实意图：**插件原本只为自己 Windows 电脑开发，未考虑开源给别人用；本次要把现有功能打磨到「任何人在 Windows/Linux/Mac 上都能跑通」。**

---

## 1. 事实调查

### 1.1 PR #106 + issue #110 对抗性审查（第一性原理核验）

- **bug 真实**，且在 main（1.7.0 未发布）与 1.6.19 产品上均存在：
  - `getHome()` 只认 `cmd.exe`：`src/host/index.js:158-172`（1.6.19 `lib/index.js:176-190`），`resolveExecutable('cmd.exe')` 失败即 `return null`。
  - `SKILL_PROBE_DIRS` 反斜杠：`src/host/index.js:38`（`lib:56`）。
  - `fs.lstat(home + '\\' + ...)` 拼接反斜杠：`src/host/index.js:842`（`lib:772`）。
- **issue 引用行号（约 176-190 / 56 / 772）与 1.6.19 产物逐行吻合** → 诊断准确、可复现。
- **PR 方向正确**（env 读 HOME + 正斜杠）但有三处缺陷：
  1. 「Windows 行为不变」不成立：Tier 1 优先 `process.env.HOME`，Windows 下 Git Bash / MSYS2 / WSL 可能设 HOME 为 `/c/Users/...`（POSIX 风格），Node 在 win32 按盘符相对解析 → 探测回归。
  2. Tier 3（`sh -c 'echo $HOME'`）冗余：子进程 env 派生自同一 `process.env`，宿主无 HOME 则子进程也无 → 恒为空。
  3. 零回归测试：仓库 50+ verify-*.js 无一覆盖 `getHome`/`probeSkill`。
- **相邻缺陷（双方都没发现）**：
  - 检查 8 标签错位：`CHECK_NAMES[7]` =「ask-matt 技能」（`src/host/index.js:868-869`）但 `c8 = probeSkill(SKILL_PROBE_NAMES[1], ...)`，而 `SKILL_PROBE_NAMES[1]` = `triage`（`:40`、`:880`）。
  - 检查 9 缺口：`SKILL_PROBE_NAMES` 只查 9 名，而 `installSkills` 契约要求 10 名（漏 `setup-matt-pocock-skills`，`src/client/kernel/prompts.js`）。

### 1.2 DSH 宿主运行时事实（子代理核验，含文件:行号）

- `ctx.get('fs')` 存在，是 DSH **沙箱文件系统**（dsh-fs-sandbox / dsh-fs-local），非 Node fs 透传。**读取（含 lstat）穿透沙箱，栅栏只拦写**：`dsh-fs-sandbox/lib/index.js:74`（"...Reads pass through untouched, every mode permits"）。
- 插件宿主在 DSH **主 Node 进程内**直接执行（无 fork/worker）：`dsh-app-boot` boot 链。`process.env` 是真实用户环境 → Tier 1 在 macOS 成立。
- 子进程 env 由 `scrubbedParentEnv()` 派生（`dsh-subprocess/lib/index.js:18-39`），只清 `DSH_*`/`KEY|PASSWORD|SECRET|TOKEN`，`HOME`/`USERPROFILE`/`PATH` 保留 → Tier 3 冗余。
- `ctx.get('skills')` 存在（`dsh-skill`），`get(name)` 返回 `undefined` = 未装；`~/.agents/skills` 是 user-agents root（rank 500），`~/.dsh/skills` 是 user-dsh（rank 400）。代码层支持 win32/darwin/linux。

### 1.3 Matt 技能集 tracker 模型（子代理核验）

- 技能集的 tracker 抽象是**文档级**：每仓生成 `docs/agents/issue-tracker.md`（由每后端模板生成），技能运行时读它、按它做事；官方承认「每个后端把一套 CLI 形态硬编码进技能，每加一个后端就是永久维护面」——**不是代码级 ports-and-adapters**。
- 第一方后端 = **GitHub + GitLab + Local Markdown（`.scratch/`）**；其余（Jira/Linear/Gitea/Azure DevOps/自建）走 **Other 自由散文**逃生舱；官方政策「主流才一等，小众/新 tracker 属 out-of-scope」（先例：`#99` 加 dex 被拒，dex 3 个月大、300 star）。
- **本地 markdown 真实格式**（纠正此前误猜的 frontmatter / `docs/maps/`）：
  - effort 一目录：`.scratch/<feature-slug>/`，spec = `.scratch/<feature-slug>/spec.md`，map = `.scratch/<effort>/map.md`。
  - 每票一文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`（NN 两位零填充、充当 ID，如 `/implement 03`）。
  - 状态/类型为**行内字段**：`Status:`（claimed/resolved/ready-for-agent）、`Type:`（research/prototype/grilling/task）、`Blocked by:`；会话追加 `## Comments`，解答写 `## Answer`。
  - **无 labels**（用 Status/Type 行替代语义），**无 frontmatter**，父子靠目录层级。
- GitLab：用 `glab`；原生 blocking 仅 Premium/Ultimate，free/CE 回退 `Blocked by: #n` 行。
- 探测 = `git remote` 推荐 + 用户确认（`setup-matt-pocock-skills`）；wayfinder 无 tracker 时兜底 local-markdown。

---

## 2. 关键架构认知（第一性原理）

1. **两层抽象要分清、且要说同一种话**：技能集用「文档级抽象」（读 issue-tracker.md）；deck 是 GUI，需要**代码级归一模型**（面板要结构化数据）。deck 的 markdown 后端必须**镜像 matt 的 `.scratch/` 格式**，否则 deck 与技能读写两套文件，互相不认。
2. **deck 要保 UI 尽量不变**，但「不变」的正确读法是「能力如实上报 + UI 只在真有差异处诚实降级」，不是硬造两个一模一样的东西。
3. **后端可插拔 → 借鉴 DSH「一切皆插件」**：把 tracker 后端做成**可拓展模块/适配器**，第三方能写、维护者把主流平台做成模块——这比写死两个后端高一层，也是本快照最重要的架构转向。
4. **cut 线可判定**（官方背书）：主流（GitHub/GitLab/本地）一等；其余 Other 逃生舱；任意公司 Git 若「能迁到主流 / 提供兼容 issue REST」才可适配，否则 cut。

---

## 3. 决定记录（decision record）

> 维护者分两段回答，存在前后不一致处见「3.6 矛盾裁决」。

### 3.1 目的地（Destination）

> 让 deck 在 Windows / macOS / Linux 跑通全部现有功能，并把「后端 tracker」抽成可插拔：GitHub 首发；本地 Markdown 与 GitLab 各作为**独立模块**开发；第三方可通过插件机制拓展后端。

### 3.2 最早五问（Q1-Q5）结论

- **Q1 目的地范围 = A**：跨平台 + 可插拔后端，GitHub 首发出厂；本地 Markdown / 其他 VCS 作为接口就位后的第二、第三实现，按可行性逐个做、做不动 cut。
- **Q2 技能安装耦合 = A**：检测 + 引导（缺哪个、装哪个、怎么装，用户确认后执行、按 installSkills 契约复验，绝不静默自动装）。**另**：提供技能 GitHub 地址 / 安装方式 / TIPS 等辅助信息，但不过于耦合。
- **Q3 三步引导 = 同意**：Step1 探测（技能 + gh CLI 已装/已登录/功能流通 + tracker 接通）；Step2 引导修复（缺什么补什么、用户确认、执行后复验）；Step3 接通（定位仓库、铺齐标签集）。gh 的解耦/封装属于中间层设计（见 3.4）。
- **Q4 一等后端 = GitHub + 本地 Markdown 必须都做**，以证明架构健壮性；**上层（UI）最好不知道底层是 GitHub 还是 markdown**，这才是解耦目标。
- **Q5 架构 = 需设计/思考/讨论/调研**（本轮已完成调研，见 1.3 + 3.4）。

### 3.3 检测技术（D1 最终）

- 认可**三级联**：显式声明 > 自动探测 > 引导用户选择。
- **每工作区可不同后端**：DSH 里工作区 A 用 A 底层、工作区 B 用 B 底层 → 探测/状态必须按 cwd/per-repo 隔离（复用现有 `wf.snapshot args.cwd` / `repoKey` 缓存思想）。
- **右侧面板提供配置项**（手动覆盖/纠错）：把「用户说了算」做成显式可改，探测结果只是默认建议。
- 探测主锚 = 读仓库 `docs/agents/issue-tracker.md`（技能集唯一后端指针）→ 解析后端 + 是否配置；git remote / gh 可达作辅助。

### 3.4 中间层架构（Q5 落地）

- 缝 = **代码级归一模型**，非「把 gh 包一层」：
  - 操作集：`detect / list / get / create / comment / close / label / subIssue / blockedBy / syncSnapshot / preflight`。
  - 能力声明：`capabilities = { labels, subIssue, depGraph, liveUpdates, remoteSharing, ... }`。
- **后端 = 可拓展模块/适配器**（借鉴 DSH「一切皆插件」；第三方可写，维护者把主流平台做成模块）。GitHub 实现 = 现有 `runGh`/GraphQL `QUERY` 包一层；本地 Markdown = 镜像 `.scratch/` 格式；GitLab = `glab`（另见 3.5-D3）。
- **背道不背 UI**：`wf.status` 前置检查与 RPC 全部改走 tracker 接口；第 3 项检查从「认 GitHub 模板」改成「认 tracker 通用契约」；UI 层不动（UI 已解耦）。

### 3.5 五问 D1-D5 最终回答

- **D1 检测技术**：同意分析（三级联 + per-workspace + 面板覆盖，主锚读 issue-tracker.md）。
- **D2 本地 markdown label**：**目标全部完成**（markdown 尽量做到与 GitHub 同等的 labels 效果，非简单降级）；但 markdown 作为**独立模块**开发并**单独开一张地图**设计，labels 兼容方案在该模块设计时再定。`capabilities` 机制保留，用于真正做不到的点（如 remoteSharing）。
- **D3 后端集合 = B**：GitHub + GitLab + 本地 Markdown 三个一等；**GitLab 单独开一张地图/module** 开发。
- **D4 本地后端契约**：严格按 mattpocock 的 SKILL 规则读写**同一个文件集**（`.scratch/...`、行内字段），不发明第二套格式。
- **D5 其他 VCS cut 线**：采纳官方主流政策（GitHub/GitLab/本地一等；其余 Other 逃生舱）；但「任意公司 Git 平台只有『能迁到主流 / 提供兼容 REST』如何实现」需**专门一张决策票**讨论——从公司角度与我们角度**相向而行的中间适配方案**，方便任何人开发。

### 3.6 双轮对应澄清（不是矛盾——两轮问题不同）

我此前误把「两轮不同的问题」记成「一处矛盾」，维护者纠正：**D1/D2/D3 出现过两套，答案各归其问。**

**Round A · 调研返回前的「三、下一轮前沿」D1-D3**（这三条「现在就能定，不依赖调研」）：

| 轮 | 问题 | 维护者回答 | 取 |
|---|---|---|---|
| A-D1 | 探测技术：三级联（显式>自动>引导） vs 纯显式（单配置开关） | 还想再讨论；认可级联但担心开发量；纯显式也要支持用户轻松调整/纠错 | 级联为主，**开发量做轻 + 面板可改**（待定） |
| A-D2 | 能力契约「降级」哲学：归一模型+capabilities 允许 UI 降级 vs markdown 必须无差别还原全部 GitHub 特性 | markdown 目标=全部完成；但作为独立模块+单独地图，labels 方案在模块设计时再定 | 朝「全部完成」；capabilities 保留用于真做不到的点；细节另定 |
| A-D3 | 后端选择放引导流哪一步：setup 第 3 步 vs 单独配置项 | 按推荐 = **setup 第 3 步** | 放 setup 第 3 步 |

**Round B · 调研返回后的「最终决定」D1-D5**（这三条（D1/D2/D3）在 Round A 之后重新以调研为据提出）：

| 轮 | 问题 | 维护者回答 | 取 |
|---|---|---|---|
| B-D1 | 检测技术（以调研为据，主锚读 issue-tracker.md） | 同意分析（级联 + per-workspace + 面板覆盖） | 采纳 |
| B-D2 | 本地 markdown 的 label：镜像+降级 vs 镜像+加字段 | 需讨论「是否有兼容方案让本地 markdown 也做到 labels 效果」 | markdown 朝完整；方案待 markdown 模块地图定 |
| B-D3 | 一等后端集合：A（GitHub+本地） vs B（GitHub+GitLab+本地） | **B**，GitLab 额外一个 map/module 开发 | 三等后端 |
| B-D4 | 本地后端契约 | 严格按 mattpocock 的 SKILL 规则读写同一文件集 | 镜像 `.scratch/` |
| B-D5 | 其他 VCS cut 线 | 同意主流政策；「任意公司 Git 平台如何兼容」需专门 ticket | 主流一等 + Other 逃生舱 + 中间适配票 |

**结论：不存在「同题两答」的矛盾。** A-D3 与 B-D3 不是同一个问题（一处是「选择放哪一步」，一处是「做几个后端」）。此前的 C1/C2 撤销。唯一仍开放的是 A-D1 里的**开发量轻量化程度**（见第 4 节雾）。

---

### 3.7 后端抽象契约 · 定版（G1-G5 + ① ② ③ 已闭环）

> 多态语义：`Tracker` 抽象 + 每后端一个适配器（归一化到**同一完整形状**）= 子类型多态；「能力」由后端归一化时**填了什么**决定（capability-by-fill）——形状总完整，无法靠形状区分「设计缺失 vs bug」。

- **G1/G2**：一个完整 `Tracker` 接口（全部操作 + 完整数据形状）；后端按自身现状填能填的，缺的用确定空值（`[]`/`''`/`null`）补齐；**无**核心/可选之分；能力 = 从「后端填了什么」推导（capability-by-fill），**非**手工声明。
- **G3**：`trackerRegistry`（按 backend id）+ 插件注册钩子 + 按 workspace 缓存；第三方注册 `Tracker` 实现 + 探测规则，UI 零改动。
- **G4**：共享接口契约测试套件（夹具断言：来源有数据→必映射；来源无→必空值）。
- **G5**：host 计算能力视图随 `wf.status`/`wf.snapshot` 下发（作**诊断/信息**用，不驱动 UI 隐藏）。
- **①**：UI 假设所有字段必填（完整形状）；后端负责在缺数据时补齐必填。
- **②**：后端总会给；前端**不需要新增隐藏逻辑**——空值按现有逻辑不显示（label 空则不渲染 label 胶囊；此逻辑已存在）。
- **③**：「诊断边界」= **可观测/日志**，不是运行期内省。人眼看到某控件没内容（如 issue 无标题）→ 靠日志二分：host 记录归一化后每字段填/空（`title:"" (EMPTY)`、`labels:[] (EMPTY)`），client 记录渲染/隐藏决定。host `title:""` → 后端没给；host `title:"hello"` 但 UI 未渲染 → 前端问题。**正确性由 G4 契约测试在 CI 兜底，运行时靠日志人肉二分。** 不引入运行期形状内省或能力分支。

### 3.8 平台层（次缝 · 共享平台层——A 已定）

> 三层嵌套架构：「可插拔」哲学在两层重复出现。主缝 = UI ↔ Tracker 抽象接口 ↔ 后端（后端可插拔）；**次缝 = 后端 ↔ 平台抽象层 ↔ OS（OS 可插拔）**。主缝保证「UI 不知后端是谁」，次缝保证「后端不知自己在哪个 OS」。

**共享平台层（共享平台层，A）**：建一个平台原语服务，收敛所有「OS 相关 + 跨后端通用」的原语——`getHome()`、路径拼接（`path.join`）、`resolveExecutable`（gh/glab/sh/Cmd）、`fs` 读写、`env`。一处写对、三种 OS 测过，所有后端与探测复用。

第一性原理依据：①两正交变化轴（后端轴 × OS 轴）分两层，验证面从乘积（3×3=9）降到和（3+3=6）；②跨切面原语只留一处真相，防 N 套实现漂移；③PR「fix: macOS 用户主目录探测 + 路径分隔符适配」的 bug 类本质 = **缺了这条次缝**（`getHome()` 只认 cmd.exe、反斜杠拼接泄漏进探测逻辑），补上它则整类 bug 消失；④平台层可独立契约测试；⑤OCP——增后端/增 OS 都在各自层做受控扩展。

→ PR「fix: macOS 用户主目录探测 + 路径分隔符适配」与 issue「[macOS] 环境检查技能探测失败」的收尾，**归入平台层**而非在探测逻辑里打补丁。


---

## 4. 开放问题 / 雾（fog，未定）

- D1 自动探测的增量开发量 vs 收益（做到多轻）。
- D2 markdown 的 label 兼容方案（在 markdown 模块地图里定；方向朝「全部完成」）。
- D5 任意公司 Git 的「中间适配」方案（专门决策票）。
- capabilities 半套语义落地：哪些点允许降级、降级时 UI 具体怎么表现。
- per-workspace 后端状态如何管理（status 按 cwd/后端隔离、跨 workspace 切换）。
- 后端模块的插件接口 / 第三方拓展规范（对照 DSH 插件模型，何时开放、如何文档化）。

## 5. 出范围（out of scope）

- 小众/新 tracker 作为一等后端（官方主流-only 政策）。
- 任意公司 Git 平台的全特性后端（仅 Other 逃生舱 + 中间适配票）。
- 强制本地 markdown 与 GitHub 完全等同（它们是替代品非分层；能力如实上报，而非强行拉平）。

## 6. 下一步

> ⚠️ **已落地**：同一时刻的真实形态是已创建的**总 Map + 8 子图**（见 §7）。本节「首批票候选」是落地前的中间产物，仅供追溯。
> **绑定设计已提炼为**：`docs/architecture/tracker-backend-design-contract.md`（各子图会话必读）。

- 按 wayfinder 建图：创建 map issue（目的地/Notes/决策/雾/出范围），首批票候选：
  - ① 平台层设计（共享平台层：getHome / path / resolveExecutable / fs / env；PR「fix: macOS 用户主目录探测 + 路径分隔符适配」与 issue「[macOS] 环境检查技能探测失败」收尾归此）
  - ② 中间层归一模型（Tracker 抽象接口 + 完整数据形状 + trackerRegistry + G4 契约测试骨架；含 capability-by-fill）
  - ③ 探测 + 三步引导流（含 per-workspace + 右侧面板覆盖；A-D1 轻量化程度在此定）
  - ④ 本地 Markdown 后端模块（含 D2 labels 方案 —— 独立地图）
  - ⑤ GitLab 后端模块（独立地图）
  - ⑥ 任意公司 Git 的中间适配方案（决策票，D5）
  - ⑦ 后端模块插件接口 / 第三方拓展规范（对照 DSH 插件模型）
  - ⑧ 三端（win/darwin/linux）验证矩阵（配合 ① 平台层契约测试 + CI，若无 CI 则先建）

## 7. 已落地图表（2026-08-22）

按 wayfinder 递归决定树落地。总 Map 下挂 8 张子 Map，`blocked_by` 已按依赖接线；**frontier = 子图「定稿 Tracker 契约」与「定稿平台抽象层」**（0 blocker）。

| 节点 | 号 | 角色 | blocked_by |
|---|---|---|---|
| 总 Map：跨平台 · 可插拔 tracker 的 deck | #111 | 根（决定树） | — |
| 定稿 Tracker 契约 | #112 | 子 Map | 0（frontier） |
| 定稿平台抽象层（全 deck OS 可插拔） | #113 | 子 Map | 0（frontier） |
| 定稿 GitHub 后端（首发） | #114 | 子 Map | #112,#113 |
| 定稿本地 Markdown 后端 | #115 | 子 Map | #112 |
| 定稿 GitLab 后端 | #116 | 子 Map | #112 |
| 定稿第三方拓展（demo + 指导） | #117 | 子 Map | #112 |
| 定稿探测 + 三步引导流 | #118 | 子 Map | #112,#113 |
| 定稿后端选择 UI 改造 | #119 | 子 Map | #112,#113,#118 |

> 每张子 Map 打开时再 grill 其内部票（本图为决定树；子 Issue 可执行）。
