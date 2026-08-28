> ⚠️ 已废弃（2026-08-28 起）— 本文档 §2 中“`capability-by-fill（非声明）`”一节为旧口径，已由 G5 双轨取代：**操作能力** = 运行时调用结果、**检查项** = 声明式 UI 卡片 `{check, show, actions}`。该节仅作历史留存，新口径请以 `docs/adr/20260826-check-item-chain-contract.md` §5.4 与 `CONTEXT.md`（2026-08-28）为准。
> **版本与效力**：凡与本提示之后定版的内容冲突，以更新者为准（同 CONTEXT.md 两条规则）。
>
> 跳转：见 ADR G5 双名制修订。

# Tracker 后端设计契约（Binding — 各子图会话必读）

> 本文件是本次重构的**已定设计**，是子图 #112–#119 的共享约束。**新会话打开任何一张子图前，先读本契约。** 其中任何一条若要修改，须在对应子图内先明确推翻它（第一性原理：先定契约，再谈子图内部的决定）。

> **※ 契约的自我约束（防增重）**：本契约**只放「跨子图都成立的横切不变量」**，且**保持最小、稳定**。任何**只对某个子图成立**的具体决定（如 Markdown 的 labels 兼容方案、GitLab 的 free-tier 回退、探测级联的轻量化细则、GitHub 的图表承载）一律**写在对应子图及其票里，不要写进本契约**；本契约**不随子图决定增长**。读本契约时，各子图只需关注与其相关的节，其余可略读——本契约很小（全读≈2K token，远小于一票 100K 上限）。


## 1. 三层（含双缝）架构

```
UI（已解耦，对后端无感）
  ↕ 主缝：Tracker 抽象接口 + trackerRegistry（后端可插拔）
Tracker 后端层（GitHub / 本地 Markdown / GitLab / 第三方）
  ↕ 次缝：平台抽象层（OS 可插拔，deck 全域唯一 OS 真相源）
OS 底座（darwin / win32 / linux）
```

- **主缝**保证「UI 不知道后端是谁」；**次缝**保证「后端不知道自己在哪个 OS」。

## 2. Tracker 契约

- **完整数据形状**：interface 定义**全部**字段；**后端负责归一化成完整形状**，来源给不了的用确定空值（`[]` / `''` / `null`）补齐。
- **capability-by-fill（非声明）**：能力 = 从「后端填了什么」推导；**不引入**手写的 capabilities 声明清单。操作未实现 / 字段缺失 → 该能力缺失；「字段在但为空」= 该能力存在但无内容。
- **UI 假设所有字段必填**，不写守卫；**空值按现有渲染逻辑处理**（label 空则不渲染 label 胶囊）。**不新增隐藏逻辑**。
- **诊断边界 = 日志**：host 记录归一化后每字段填/空（`title:"" (EMPTY)`、`labels:[] (EMPTY)`）；client 记录渲染/隐藏。跑 bug 靠日志二分——host 空 → 后端问题；host 有但 UI 未渲染 → 前端问题。**不引入运行期形状内省或能力分支**。
- **G4 契约测试**：每个后端须过共享契约测试（来源有数据 → 必映射；来源无 → 必空值）。

## 3. 平台抽象层（deck 全域）

- 原语：`getHome` / `path` / `resolveExecutable` / `fs` / `env`；**OS 正确性单点拥有**。
- 范围：宿主（Node 侧）OS 交互在范围；client 浏览器/DSH-Runtime API（剪贴板、文件选择等）**不属** OS 抽象。
- 存量 bug 收尾：**PR「fix: macOS 用户主目录探测 + 路径分隔符适配」与实际链接的 issue「[macOS] 环境检查技能探测失败」→ 归平台层**，不在探测逻辑里打补丁。

## 4. 后端 cut 线

- 一等后端：**GitHub（首发）/ 本地 Markdown（独立适配）/ GitLab（独立适配）**。
- 其余（Gitea / Linear / Jira / 公司自建）→ **Other 逃生舱（自由散文）**，不做全特性后端。
- 任意公司 Git：仅当「能迁到主流」或「提供兼容 issue 级 REST」才可适配；此条另议中间适配方案，**非关键路径**。

## 5. 本地 Markdown 格式（镜像 matt 契约，勿自造）

- 位置：`.scratch/<feature-slug>/`——`spec.md` 为 spec，`<effort>/map.md` 为 map，票为 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`（NN 两位零填充、充当 ticket ID，如 `/implement 03`）。
- **不是** YAML frontmatter、**不是** `docs/maps/`、**不是**纯 `<number>.md`。
- 状态/类型/依赖用**行内字段**：`Status:`（claimed/resolved/ready-for-agent）、`Type:`（research/prototype/grilling/task）、`Blocked by:`；会话追加 `## Comments`，解答写 `## Answer`。
- **无 labels**（用 Status / Type 表达语义），父子靠 `.scratch/<effort>/` 目录层级。

## 6. 图表语义（wayfinder 决定树）

- 总 Map = 决定树；**子 Map 递归**（打开 = 再开一张新决定树）；**子 Issue = 可执行**（决策 + 落地）。
- 先后顺序用 **`blocked_by`（依赖）** 表达，不用嵌套。**嵌套只在子 Map 打开、征集它自己的子票/子图时加深**。
- 各决定记在各自票上（resolution comment + 父图 Decisions-so-far）；本契约只定跨子图的公约，不重复各票结论。

## 7. 相关快照

- 讨论全史（含每条的证据与来龙去脉）：`docs/architecture/tracker-backend-charting-snapshot.md`。