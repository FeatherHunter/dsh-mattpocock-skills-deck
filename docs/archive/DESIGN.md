# DSH-Waystation · 设计文档（规划稿）

> **归档**：本文为 `dsh-waystation` 时期（v1.5 前）规划稿，已冻结。当前品牌为 `dsh-mattpocock-skills-deck`（Matt Skills Deck，v1.7.1+），实现以 `src/` 真源 + `DESIGN.md` 归档对照为准，新设计见 `docs/adr/` 与 `ARCHITECTURE-SPLIT.md`。

> wayfinder 的 DSH 驿站：不开网页，实时看地图、认领 frontier、固化决策、按需点亮技能。
>
> 本文件为**规划稿**，尚未实现。插件名「DSH-Waystation」已确认（2026-08-14）。

---

## 0. 一句话定位

一个 DSH **动态 Cordis 插件**（Host + Client 双端），做 Matt wayfinder 的**驾驶舱**：

- **前置就绪检查**：wayfinder 技能 / setup-matt-pocock-skills / gh CLI / Token / tracker 模式 —— 每项一个绿点，缺什么明说什么。
- **Issue 状态追踪**：把 GitHub Issues 上的 `wayfinder:map` 与子票（含阻塞关系、frontier）拉进 DSH 面板，实时刷新，不再开网页。
- **两个高频动作一键化**：①「开始此 Issue」→ 自动把 `/wayfinder` + issue 链接 + 工作指令注入输入框；②「固化」→ 把当前讨论的关键结论存本地 + 评论到 Issue。
- **技能雷达**：把 Matt 技能放在边上，按当前 ticket 类型 / map Notes / 就绪状态智能推荐，随手 `/skill` 加载。

---

## 1. 命名

所有候选都以 `DSH-` 开头（沿用 dsh-opencode-tui-theme 的命名惯例）。

| 候选名 | 含义 | 评价 |
|---|---|---|
| **DSH-Waystation**（✅ 已确认） | wayfinder 的「驿站」：途中歇脚、看地图、领任务、补给技能 | 贴题、有记忆点；pluginId 前缀 `wfst` |
| DSH-Frontier | 强调「可接任务前沿」概念 | 概念准确但偏窄（丢失地图/固化） |
| DSH-MapWatch | 直白描述「盯地图」 | 太功能化 |
| DSH-IssueScope | 强调 issue 状态追踪 | 丢了 wayfinder 语义 |
| DSH-Waypoint | 航点 | 与 wayfinder 词根重复度高 |

pluginId：`cordis_define` kind `new`，idPrefix 用 `wfst`（3–6 小写字母），Host 分配最终 `wfst-N`。

---

## 2. 背景与目标

### 2.1 现状

- 本仓库（`FeatherHunter/SKILLS`）已跑 `/setup-matt-pocock-skills` 并选择 **GitHub Issue** 追踪（见 `docs/agents/issue-tracker.md`，含「Wayfinding operations」协议：原生 sub-issues + 原生阻塞，`gh ≥ 2.63 / 2.97`）。
- 用户本地装有 Matt 技能包（`~/.agents/skills/`、`~/.minimax/skills/`）：`wayfinder`、`ask-matt`、`setup-matt-pocock-skills`、`triage`、`grilling`、`research`、`prototype` 等。
- **关于「/wifi」**：经用户确认（2026-08-14），「/wifi」是**麦克风语音输入的文字错误**，实际是 **`/wayfinder`** —— 即「开始此 Issue」时自动输入的加载技能命令。wayfinder 技能本体已装在 `~/.agents/skills/wayfinder`（SKILL.md 128 行 + agents/openai.yaml）。
- DSH 会话的技能目录只挂载了 Matt 技能的一个子集（`code-review`、`grilling`、`research` 等在，`wayfinder`、`ask-matt`、`setup-matt-pocock-skills` 不在）——所以「本地有文件」≠「会话可用」，检测要两层都查（§4.7）。

### 2.2 目标

1. **前置条件可视化**：wifi / setup / gh / Token 等，缺哪项一眼看到，且有「怎么补」的提示。
2. **不开网页看 Issue**：地图、子票、阻塞、frontier、claim、评论，全部进 DSH 面板。
3. **两个高频动作一键化**：开始新 Issue（自动 `/wayfinder` + 链接 + 指令）、固化讨论（本地 + GitHub 备注）。
4. **技能侧边栏 + 智能提醒**：Matt 技能放边上，按场景推荐。

---

## 3. 与 wayfinder 数据模型对齐

插件必须忠实 wayfinder 语义（来源：`~/.agents/skills/wayfinder/SKILL.md` + `docs/agents/issue-tracker.md`）：

| wayfinder 概念 | 本仓库的物理表达 | 插件用途 |
|---|---|---|
| Map（地图） | 一张 label 为 `wayfinder:map` 的 issue | 面板的「地图列表 / 地图详情」 |
| Map body | `## Destination` / `## Notes` / `## Decisions so far` / `## Not yet specified` / `## Out of scope` | 解析渲染；**Notes 里的技能名**用于技能雷达置顶 |
| Ticket（子票） | map 的**原生 sub-issue**，label `wayfinder:research/prototype/grilling/task`，body `## Question` | ticket 行 + label chip |
| 阻塞 | GitHub **原生依赖**（`gh issue edit --add-blocked-by`） | 阻塞箭头、blocked 分组 |
| Claim | assignee 即认领 | 「已认领 🔵」分组；开始时可一键 assign |
| Frontier | open + unblocked + unclaimed 的子票 | 面板核心视图「可接 🟢」 |
| 决议 | resolution comment + close + map 的 Decisions-so-far 追加 | 固化流程的落点（comment） |

---

## 4. 前置检查（状态检测 · 小绿点设计）

### 4.1 检查清单

每项：`名称 / 状态点 / 详情 / 修复提示 / 可选动作`。

| # | 检查项 | 判定方式 | 失败提示 |
|---|---|---|---|
| 1 | 仓库定位 | `git remote -v` → `owner/repo` | 提示在 GitHub 仓库内使用 |
| 2 | setup 已执行 | `docs/agents/issue-tracker.md` 存在 | 「请先跑 /setup-matt-pocock-skills」+ 一键注入命令 |
| 3 | tracker = GitHub | 解析上述文件（GitHub 模板特征） | 提示切换 tracker 或改配置 |
| 4 | gh CLI 可用 | `subprocess.resolveExecutable('gh')`；兜底 `DSH_GH_PATH` 环境变量（本仓库实测 gh 不在 PATH，见 issue-tracker.md） | 显示找到/未找到的路径，提示安装 |
| 5 | gh 已登录 | `gh auth status`（keyring 或 GH_TOKEN） | 提示 `gh auth login` |
| 6 | API 可达 | `gh api repos/<owner>/<repo>` 200 | 提示网络/权限 |
| 7 | **wayfinder 技能** | 见 §4.7（双层探测） | 红点 + 安装提示 |
| 8 | ask-matt 技能 | 见 §4.7（可选） | 灰色提示 |

### 4.2 状态点语义

- 🟢 就绪 / ⚪ 未检测 / 🟡 部分就绪（如 gh 装了但未登录）/ 🔴 缺失
- 顶部汇总行：`就绪 7/9 · 🧭`，任一项 🔴 时整体显示琥珀/红色点。

### 4.3 触发时机

插件启动、打开面板、手动「重新检查」；结果缓存 30s 防抖。

### 4.4 检测实现（Host 侧）

- `fs` 服务读 `docs/agents/issue-tracker.md` 与 git 配置；
- `subprocess` 跑 `gh`（executable 解析 + 兜底路径列表，可配置）；
- `skills` 服务（`skills.get(name)` / `skills.list()`）查 DSH 会话级技能；
- 全部结果归并为 `{ ok, level, detail, hint }[]`，经 `harness.handle('wf.status')` 给 Client。

### 4.5 与 /setup-matt-pocock-skills 的联动

检测到 setup 未跑（#2 🔴）时：

- 面板顶部琥珀横幅：「本仓库尚未初始化 Matt 技能配置」；
- 按钮「帮我执行 /setup-matt-pocock-skills」→ 把 `/setup-matt-pocock-skills`（+ 期望选择 GitHub 的一句话）注入输入框，用户回车即由 agent 执行。

### 4.6 与 wayfinder 技能的联动

检测到 wayfinder 未就绪（#7 🔴/🟡）时：

- 横幅：「开始 wayfinder 工作前需要 wayfinder 技能可用」；
- 🔴 未安装 → 显示安装指引（装 Matt 技能包 / 放入 `~/.agents/skills/wayfinder`）；
- 🟡 已安装未挂载到当前会话 → 提示用 `/wayfinder` 加载或配置会话技能目录；
- 装好后点「重新检查」即变绿。

### 4.7 wayfinder 技能检测（双层探测，避免误报）

**检测 = 两层探测：**

1. **DSH 会话层**：`ctx.get('skills')` → `skills.get('wayfinder')`（能拿到定义 = 会话可用）。
2. **文件系统层**（会话没挂载但本地已装）：探测常见技能目录
   `~/.agents/skills/wayfinder`、`~/.minimax/skills/wayfinder`、`~/.claude/skills/wayfinder`。

   - 两层都无 → 🔴「未安装」；
   - 仅文件层有 → 🟡「已安装但未挂载到当前会话」→ 提示用 `/wayfinder` 或会话配置加载；
   - 两层都有 → 🟢。

> 说明：用户原话「/wifi」为语音输入错误，实为 `/wayfinder`（2026-08-14 确认）。本插件的技能检测按**可配置的技能名列表**实现（默认 `wayfinder`、`ask-matt`、`setup-matt-pocock-skills`），检测目录也可配置，未来如真引入 wifi 技能无需改代码。

---

## 5. 核心功能：GitHub Issue 状态追踪

### 5.1 数据流（Host 侧）

```
timer interval 60s ─┐
手动刷新 ───────────┼─→ gh 封装层 ─→ 内存快照 ─→ harness.handle('wf.snapshot') ─→ Client 面板
打开面板触发 ────────┘
```

1. **枚举地图**：`gh issue list --state open --label "wayfinder:map" --json number,title,body,labels,assignees,updatedAt`（closed 的地图保留最近 N 张，供回顾）。
2. **枚举子票**：对每张 map 拉 sub-issues。优先 GitHub 原生接口（`gh api` REST/GraphQL，构建时核实 `/sub_issues` 与 `/blocks` 端点方向）；**降级方案**：解析 body 里的「⛓ 阻塞」文字约定（issue-tracker.md 提到该历史约定）。
3. **组装模型**（纯 JSON，可序列化）：

```json
{
  "updatedAt": "…",
  "maps": [{
    "number": 200, "title": "[私家大厨] 实施编排 map · v4.0 落地",
    "state": "OPEN",
    "destination": "…", "notes": "…",
    "decisions": [{"title": "…", "url": "…", "gist": "…"}],
    "fog": ["…"], "outOfScope": ["…"],
    "tickets": [{
      "number": 201, "title": "…", "type": "research",
      "state": "OPEN", "claimedBy": "…" ,
      "blockedBy": [202], "blocks": []
    }],
    "stats": { "total": 12, "open": 5, "closed": 7, "frontier": 2, "blocked": 2, "claimed": 1 }
  }]
}
```

4. **增量感知**：与上次快照 diff → 新 closed / 新 frontier / 新评论 → Client toast（v2 功能）。
5. **手动刷新**：面板按钮 + 打开面板即刷。

### 5.2 展示（Client 面板，shell.overlay 内）

**地图列表视图**：所有 open maps → 标题（Refer by name 原则，不裸用 #号）、目的地一行摘要、进度 `n/N`、frontier 数、更新时间。点击进详情。

**地图详情视图**：body 四段（Destination / Notes / Decisions so far / Not yet specified / Out of scope）折叠渲染。

**Tickets 视图**（按状态分组，wayfinder 语义）：

- 🟢 **可接（frontier）**：open + 无阻塞 + 未认领 —— 高亮
- 🔵 **已认领**：assignee 显示
- 🔒 **被阻塞**：列出阻塞它的 ticket 名（Refer by name）
- ✅ **已关闭**：最近 N 条（点开看 resolution comment）

每张 ticket 行：标题 + `#号` + 类型 chip（research/prototype/grilling/task 四色）+ 阻塞箭头 + 动作按钮（开始 / 固化 / 打开 GitHub）。阻塞关系 v1 用「被谁阻塞」文字链，v2 画简单层叠图。

### 5.3 gh 封装层要点

- 可执行文件解析顺序：`resolveExecutable('gh')` → `DSH_GH_PATH` 环境变量兜底 → 报错进检测项 #4。
- 所有命令带超时与错误归一化（auth 失败 / 网络失败 / 404 分开展示）。
- 动作类命令（comment / assign / close）**只在用户从 UI 明确点击后执行**，且 UI 内二次确认。

---

## 6. 功能 A：任务固化提醒

### 6.1 触发

- **主动**：任意 ticket 详情页「💾 固化」按钮。
- **智能**（v1 简化版）：`conversation.chat.turnTail` 挂一条提醒——当会话最近一 turn 涉及某个 open ticket（检测 user/assistant 文本含该 issue 链接或用户当前在面板选中该票）时，渲染：
  `💡 本轮讨论要固化到「<ticket 标题> #N」吗？ [固化] [稍后]`

### 6.2 固化弹窗

- 标题预填：`【固化 YYYY-MM-DD HH:MM】<ticket 标题> #N`
- 内容：多行文本框（v1 用户粘贴关键结论；v2 尝试从最近 turn 自动摘录，client 侧有 ConversationSnapshot 可读）
- 按钮：**[仅本地保存]** / **[保存并评论到 Issue]** / [取消]

### 6.3 落点

1. **本地**：追加写入 `.scratch/wayfinder-notes/<map-slug>/<N>-<ticket-slug>.md`（时间戳分节，只追加不覆盖；不碰任何数据库，遵守仓库 DB 隔离红线）。
2. **GitHub**：`gh issue comment <N> --body-file <tmp>` —— 经 **approval** 服务确认后执行（构建时核实 `approval.request` 用法；若不可用则 UI 强确认 + 执行结果回显）。

### 6.4 成功反馈

toast「已固化 → 本地 <路径> · GitHub #<N>」；GitHub 侧给 comment 链接。

---

## 7. 功能 B：开启新 Issue

用户原话流程：面板显示各 issue → 点击 → 选择「开始此 Issue」→ 自动输入 `/wifi` + issue 地址 + 简短说明。

### 7.1 交互

1. Ticket 行点「▶ 开始此 Issue」→ 弹出确认框：
   - ticket 标题 + 类型 + 推荐技能（按类型：research→`/research`；grilling→`/grilling` + `/domain-modeling`；prototype→`/prototype`；task→`/implement`）
   - 开关：「同时认领（assign 给自己）」（默认开）
   - 确认 / 取消
2. 确认后：
   - （认领开）Host 执行 `gh issue edit <N> --add-assignee @me`
   - **注入输入框**（见 7.2）：

```text
/wayfinder
https://github.com/FeatherHunter/SKILLS/issues/<N>

请按 wayfinder 流程处理这个 ticket：先加载所属 map 的低分辨率视图对齐 Destination，认领该 ticket，再用 Notes 中指定的技能（如 /research）解析它；完成后以 resolution comment 收尾并关闭 issue。本 session 只解析这一个 ticket。
```

3. toast「已注入输入框，发送即可」；模板可在插件设置里改（含是否带 `/wayfinder` 前缀、用哪个技能）。

### 7.2 注入实现（已验证可行）

`conversation.input.dock` 的 standard props 提供 `useInput` + **`inputActions`**（可写输入状态）——插件在该 slot 注册一个轻量占位（渲染 null 或极简状态条），通过 `inputActions` 设置输入文本。兜底：复制到剪贴板 + toast（参照 Base Skill 的 copy 组件模式）。

### 7.3 与 setup / wayfinder 联动

若 §4 检测 #2 或 #7 未就绪，确认框顶部先出黄条「前置未就绪：… [一键补]」，不阻断但明示。

---

## 8. 功能 C：技能雷达（侧边展示 + 智能提醒）

### 8.1 数据源

1. **DSH 会话技能**：Host `skills.list()`（动态、权威）。
2. **静态目录**：内置 Matt 技能描述表（名称 / 一句话用途 / 适用时机 / 是否已装）——覆盖 `ask-matt`、`setup-matt-pocock-skills`、`wayfinder`、`triage`、`code-review`、`codebase-design`、`diagnosing-bugs`、`domain-modeling`、`grilling`、`handoff`、`implement`、`improve-codebase-architecture`、`prototype`、`research`、`resolving-merge-conflicts`、`tdd`、`teach`、`to-spec`、`to-tickets`、`writing-great-skills`。描述直接取自本仓库 `matt技能解析/` 的既有成果。
3. **状态合成**：✓ 已装（会话级）/ ✗ 未装（文件系统探测兜底）。

### 8.2 展示位置

- 面板内「🧭 技能」tab（地图/票务之外的第三页）；
- 用户要求的「放在边上」：面板本身是 shell.overlay 浮动层，可拖到右侧常驻（v1 提供「置右停靠」开关）。

### 8.3 智能推荐规则（按场景排序）

1. **当前选中 ticket 的类型** → 推荐对应技能（§7.1 映射表）；
2. **当前 map 的 `## Notes`**：解析出其中提到的技能名，置顶显示「本 map 指定技能」；
3. **就绪状态**：setup 未跑 → 置顶 `/setup-matt-pocock-skills`；wayfinder 未挂载 → 置顶 `/wayfinder` 加载提示；
4. **会话场景**（turnTail 智能提醒）：按最近一条 user 消息关键词（「issue / 地图 / 阻塞 / research / 审代码」…）提示 1 条技能，附「加载」按钮 → 注入 `/skill-name`。

每个技能条目：名称 + 用途一行 + 状态点 + [注入 /skill] [详情]。

---

## 9. Agent 侧能力（模型工具，P1）

让 agent 也能在对话中直接回答 issue 状态（不靠用户开面板）：

| 工具 | 作用 |
|---|---|
| `wayfinder_status` | 前置检查结果 + maps 列表 + 各 map 的 frontier（open/unblocked/unclaimed） |
| `wayfinder_issue <n>` | 单票详情（body / 阻塞 / 子议题 / 评论 / assignee） |
| `wayfinder_fixate <n> <summary>` | 固化：本地追加 + （可选）gh comment |

注册方式：`harness.registerTool`（Host），工具名避免与现有工具冲突（构建时 `Tool.listTools` 核对）。

---

## 10. UI 入口与 Slot 选型（已对运行时核实）

| 需求 | Slot / 机制 | 理由 |
|---|---|---|
| 全局入口按钮 | `sidebar.footer.action`（list，additive） | 设置在侧栏脚部旁边，不替换产品 UI |
| 主面板 | `shell.overlay`（list，frame-wide） | 唯一的框架级浮动层；地图/票务/技能三页 + 右侧停靠 |
| 状态条 + 注入输入框 | `conversation.input.dock`（list；props 含 `inputActions`） | 全宽一行；顺手做「就绪 7/9」常驻显示与快速动作 |
| 会话尾智能提醒 | `conversation.chat.turnTail`（chain） | 每 turn 后追加提醒条（固化/技能） |
| Run 卡控制面板 | `tool.view.cordis`（key `self`） | 加载后的启停/刷新/状态面板（同主题插件先例） |
| 配置页（可选） | `settings.section`（list） | gh 路径、刷新频率、注入模板、技能检测目录 |

Client 样式：局部 `styles.insert(css)` + 主题 CSS 变量（沿用 dsh-opencode-tui-theme 的做法，不碰全局 token 也行；若做全局只动必要项）。

---

## 11. Host 服务依赖清单（已核实存在）

| 服务 | 用途 |
|---|---|
| `skills` | 技能存在性检测（`get` / `list`） |
| `subprocess`（`resolveExecutable` / `spawn`） | 跑 gh CLI |
| `fs` | 读 issue-tracker.md / git 配置 / 写固化笔记 |
| `timer` | 60s 轮询刷新 |
| `harness`（`handle` / `registerTool`） | Client RPC + 模型工具 |
| `approval`（P1 核实） | gh 写操作前的授权 |
| `slots`（Client） | 上述 UI 注册 |

---

## 12. 文件清单（仓库落盘）

```
dsh-plugin/dsh-waystation/
├── README.md      # 使用说明（仿 dsh-opencode-tui-theme/README.md 风格）
├── DESIGN.md      # 本文档
├── RESEARCH-NOTES.md  # T1 研究产出（构建期端点/签名核实）
├── host.js        # cordis_define 的 code.host 函数体
└── client.js      # cordis_define 的 code.client 函数体
```

加载方式（与主题插件一致）：DSH 会话中 `cordis_define`（kind new，idPrefix `wfst`）→ `cordis_run`（首次需批准）；动态插件进程内生效，DSH 重启后需重新加载。

### 12.1 开发追踪（wayfinder 制图 · 2026-08-14）

本插件开发按 **wayfinder 规范**走 GitHub 地图，标签命名空间 `dsh:plugin:waystation`（已创建，紫色）+ `wayfinder:*`：

- **地图**：[#342 [dsh-waystation] 实施 map · DSH-Waystation P0 落地](https://github.com/FeatherHunter/SKILLS/issues/342)
- **子票**（原生 sub-issue + 原生阻塞，gh 2.97.0）：
  - [#343 research](https://github.com/FeatherHunter/SKILLS/issues/343) 核实 gh sub-issues/blocks 端点与 inputActions 签名 ← **✅ 已关闭**（父会话亲自完成，产出 `RESEARCH-NOTES.md`）
  - [#344 task](https://github.com/FeatherHunter/SKILLS/issues/344) 前置检查绿点模块（被 #343 阻塞 → 已解锁）
  - [#345 task](https://github.com/FeatherHunter/SKILLS/issues/345) gh 数据层 + 快照 + 轮询 + wf.snapshot（被 #343 阻塞 → 已解锁）
  - [#346 task](https://github.com/FeatherHunter/SKILLS/issues/346) Client 面板 UI（被 #343/#344/#345 阻塞）
  - [#347 task](https://github.com/FeatherHunter/SKILLS/issues/347) 开始此 Issue 流程 ← **✅ 已关闭**（"wf.claim" RPC："gh issue edit --add-assignee @me" 实测可用 + 缓存失效；确认框真实认领 + inputActions 注入 + 模板配置 + 前置黄条；顺带修复 #345 QUERY 少一个 "}" 致 map 详情全挂的 bug）
  - [#348 grilling](https://github.com/FeatherHunter/SKILLS/issues/348) P0 验收与 UX 细节拍板（被 #344–#347/#355 阻塞）
  - [#355 prototype](https://github.com/FeatherHunter/SKILLS/issues/355) UX 原型 · 假数据可交互面板（评审后定稿 UX）← **已认领（FeatherHunter），当前工作中**，阻塞 #348
- 已核实事实（供 T1 参考）：`gh issue view --json subIssues/blockedBy/blocking` 返回 connection 对象（`.nodes[]` 含 id/number/state/title/url + totalCount）；地图 progress 由 GitHub 原生子议题进度条维护。
- ⚠️ 并发干扰记录（2026-08-14）：并行会话正在制卡路里地图，issue 号分配竞态 —— 曾把 `--add-blocking 348` 误接到卡路里地图 #349，已用 `--remove-blocking` 纠正并重接到 #355。**后续对票操作前先 `gh issue view <n>` 核验标题**。

### 12.2 Grill 对齐记录（2026-08-14 · 两轮，全部采纳推荐）

Round 1（Q1–Q12）：
- Q1 浮动面板+可停靠右侧（shell.overlay）；Q2 侧栏脚部 🧭 入口带状态徽标；Q3 多地图列表为根视图；
- Q4 刷新 = 手动 + 关键动作触发（60s 轮询留 P1）；Q5 状态条 = 就绪 n/8 + frontier 数 + 更新时间 + 刷新；
- Q6 注入输入框、用户确认后发送（不自动发送）；Q7 默认勾选认领 + 他人已认领禁用开始仅查看；Q8 被阻塞票不能开始；Q9 setup 一键补 = 注入 `/setup-matt-pocock-skills` 文本；
- Q10 技能雷达 = Matt 工程技能全目录 + 已装/未装状态；Q11 智能提醒 = 确认框按类型 + turnTail 按会话双路；
- Q12 固化 = ticket 按钮 + turnTail 提醒条 → 本地追加 + gh comment（UI 内两按钮二次确认）。

Round 2（Q13–Q18）：
- Q13 原型载体 = 动态 Cordis 插件（本会话真实加载）；Q14 数据 = 假数据起步 + 接口抽象可一键切换真假；
- Q15 范围 = 五大块全进原型，按「看完一块确认一块」节奏；Q16 原型即 P0 client.js 骨架，评审后只换数据源不重写；
- Q17 原型有票（#355，阻塞 #348）；Q18 评审 = 用户在 DSH 界面实操 + 自检清单兜底。

用户总方针：**面板形态/状态刷新/开始Issue/技能雷达/固化 全部先看原型效果再定细节**。

Round 3（原型实操评审 → 全部定稿，2026-08-14）：

| 模块 | 定稿 |
|---|---|
| 1 状态栏 | **A 居中胶囊**：固定宽 560 居中；「Waystation」=开关、段=导航直达视图；时间固定格式 `MM-DD HH:MM`；反馈文字不进状态栏 |
| 2 面板首页 | **A 仪表盘**：环境行 + KPI + 可接聚合 + 底部地图列表 |
| 3 地图详情 | **A 垂直走廊**：Destination 置顶 → 可接/已认领/被阻塞/已走过分层，阻塞链行内缩进，每票带外链按钮 |
| 4 技能雷达 | **A 推荐+列表**（正式版面板内支持 A/B 双形态切换：列表 / 圆形技能环） |
| 5 环境检查 | **A 横幅+分组**：红色横幅 + 红/黄/绿分组卡（名称/影响/动作），只提示不代装 |
| 6 沉淀弹窗 | **A 居中模态**（锚定当前任务，含自动摘录候选） |
| 7 提醒条 | **A 行内条**：只在「当前任务接近 close」时出现一次（信号：测试全过/问题解决/完成话/里程碑），保守策略宁缺毋滥 |
| 8 当前任务 | **显式指针模型**：唯一当前任务 + 本会话认领列表（当前高亮可切换）+ 对话提及识别提示确认 + 状态徽标（进行中/接近完成/已关闭） |
| 9 交接 | **定向传递**：点交接后台生成文档（不注入命令）→ 聊完「交接给新会话」→ 左侧开新会话 + 输入框预填路径；普通新会话不加载 |
| 10 感知中心 | **四感知**（map 位置/当前 bug/正在做什么/GitHub 全局）+ 标签过滤（chip → 该标签 issue 列表）+ 行级动作（分流 → `/triage`+URL；开始修复 → `/wayfinder`+URL） |

明确不做：gh 命令复制；不自动执行 triage/wayfinder（只注入入口，由用户发送后 agent 执行）。

---

## 13. 分阶段路线图

- **P0 · v1 MVP**：前置检查绿点清单（含 wayfinder 双层探测）+ input.dock 状态条 + 面板（地图列表 / 票务分组：frontier/blocked/claimed/closed）+ 「开始此 Issue」注入输入框 + 手动刷新。
- **P1**：固化（本地 + gh comment + turnTail 提醒）+ 技能雷达（类型/Notes/就绪三路推荐）+ 模型工具 ×3 + 60s 自动轮询 + 配置页。
- **P2**：阻塞关系图可视化 / 子票树 / 状态变化 toast 通知 / map Notes 解析置顶 / 多仓库支持 / 固化自动摘要。

---

## 14. 风险与开放问题

| # | 问题 | 状态 |
|---|---|---|
| 1 | ~~wifi 技能来源~~（已澄清：为 `/wayfinder` 语音输入错误） | ✅ 已解决 |
| 2 | 插件名确认 | ✅ 已确认 DSH-Waystation |
| 3 | GitHub 原生 sub-issue / blocks 的读取端点方向 | 制图期已部分实测（`subIssues/blockedBy/blocking` 为 connection 对象）；REST 端点与方向由 T1 #343 研究子代理核实 |
| 4 | `inputActions` 写输入框的确切签名 | T1 #343 研究子代理核实中（`conversation.input.dock` 契约） |
| 5 | `approval` 服务用于 gh 写操作 | T1 #343 研究子代理核实中（P1 备用） |
| 6 | 会话中 wayfinder/ask-matt 未挂载（本地有文件） | 插件只检测与提示；加载动作交给 `/wayfinder` 或用户配置 |
| 7 | 轮询频率与 GitHub API 限额 | 60s + 全量快照较轻；必要时按 updatedAt 增量 |

---

## 15. 变更记录

- 2026-08-14 初稿：完整规划（命名 / 前置检查 / 追踪面板 / 固化 / 开始 Issue / 技能雷达 / 路线图）。
- 2026-08-14 修订：① 用户确认插件名 **DSH-Waystation**；② 确认 P0 范围（绿点检查 + 面板 + 开始 Issue）；③ 澄清「/wifi」为语音输入错误，实为 **`/wayfinder`**，技能检测改为按可配置技能名列表（默认 wayfinder / ask-matt / setup-matt-pocock-skills）双层探测，「开始此 Issue」注入命令改为 `/wayfinder`。
- 2026-08-14 制图：目录改小写 `dsh-waystation`；创建标签 `dsh:plugin:waystation`；按 wayfinder 规范创建地图 **#342** 与子票 #343–#348（research×1 / task×4 / grilling×1），原生阻塞接线完成，frontier = #343；触发 T1 研究子代理。
- 2026-08-14 对齐：grill 两轮（Q1–Q18）全部按推荐采纳，用户总方针「五大块先原型后定细节」；T1 子代理两轮无产出，改父会话实测完成并收尾 #343（RESEARCH-NOTES.md：GraphQL 单查询方案 / inputActions.setDraft / approval 结论 / PowerShell 引号坑）；新增原型票 **#355**（wayfinder:prototype，阻塞 #348）并已认领，当前工作中。
- 2026-08-14 定稿：HTML 原型（`dsh-plugin/dsh-waystation/prototype.html`，10 模块）实操评审三轮，全部定稿（见 §12.2 Round 3 表）；#355 原型票收尾（resolution comment + close）。后续实现按定稿组合：1A+2A+3A+4A+5A+6A+7A + 显式当前任务 + 定向交接 + 感知中心。
- 2026-08-14 拍板（#348 · 问卷 5 题全按推荐采纳）：① 票务分组 ✅已关闭默认折叠（操作面常显、历史面点开展开）；② 地图详情折叠块保持现状（Decisions 查阅型）；③ **关闭 60s 自动轮询**（480 GraphQL/h ≈ 2400–4800 points/h 贴 5000 限额），刷新 = 纯手动 + 打开面板即刷；④ 注入模板默认带 /wayfinder 前缀（可设置关闭）；⑤ 已关闭票显示「✅ 已关闭」，决议摘要留 P2（避免 N+1 评论查询拖慢快照）。
- 2026-08-18 拍板（#2 · issue "GitHub issue 新增/变化后右侧面板无定时刷新"）：两轮 grill 拍板 —— **类别**：`bug` → `enhancement`（代码层是按规格运行，从产品视角是设计升级）；**方向**：A · 缩短 probe 间隔 **+** since 扩范围；**间隔值**：**60s**（REST 5000/h 池 60s × 10 repos = 600/h，12% 占用，安全）；**probe 范围**：A · `since=<ISO>` 时间戳增量探测（1 次 REST 覆盖全 issue，含地图 + 子票）；**状态机**：ready-for-agent → needs-triage → ready-for-agent（重诊断后流转）；**MVP-first 原则**：契约层接受 UI/UX 验收反向校验，phase 2（配置 UI / UI 时间戳 / 错误可视化）由 UI/UX 验收决定。MVP 实施（2026-08-18）：probe `labels=wayfinder:map` 仅匹配地图本身，**漏检所有子票变化**（可接 / 阻塞 / 已认领 / 已关闭分组都是子票 —— DESIGN.md §5.2）—— 改为 `since=<lastProbeAt>` 时间戳探测；模块级 `lastProbeAtByRepo`（按 repoKey 隔离）；`PROBE_MS` 300000 → 60000；保留 `FOCUS_PROBE_MIN_MS = 60000` + 关键动作 8s 延迟探测 + 错误静默。
- 2026-08-18 E2E 修正（#2 · R2-fix-5/6）：**R2-fix-5** —— changed 后必须 `await loadSnapshot(shared, true, true).then(...)` 完成再无条件复制新快照到**所有** store + `emit`（修复「数据层 OK / UI 层不响应」，served bundle 未部署旧逻辑的坑）；**R2-fix-6** —— 撤销「buildSnapshot 末尾初始化 `lastProbeAtByRepo[rk]=now`」：build 只代表快照生成，不代表 client 已渲染，build 推进基线会**吞掉同窗口编辑**（编辑被推进到基线之前的永久漏检）；基线**只由 probe 检测到 change 时滑动**（`lastProbeAtByRepo[rk1] = new Date().toISOString()`）。E2E 实证：编辑 #18 后 ≤10s（probe 60s 周期）UI 自动出现唯一 marker，无 reload。文档/测试契约同步：`verify-b5-quota.js` 54 项 + `verify-probe-since.js` 26 项全过。