# ADR：检查项 / 检查链条契约与 G5 双名制修订（#217，#219/#245 修订 2026-08-27）

> 日期：2026-08-26 定版 · 2026-08-27 修订（按 #219 grilling 定版与 #245 规约删 NA，状态集 5→4）
> 地位：承接 #215 地图与 #198 五票结论，作为 #215 后续编排链与 88 条硬编码下沉的共享约束。
> 版本与效力：本文件落盘后，凡与本决策冲突的旧方案/契约/讨论，**以本文件（更新日期者）为准**；未来任何讨论若改动本决策，**以未来版本为准**（CONTEXT.md 同款两条规则）。

---

## 1. 背景（第一性原理）

插件需从「只认 GitHub」的单后端演进为「后端感知 UI 架构」：UI 不识别后端、host 私货下沉后端、描述数据取代 id 分支。盘点清单 ` .scratch/research/ui-hardcode-inventory-20260826.md` 暴露 88 条硬编码，其中类别 8 有 14 项 host 检查链必迁（gh/gh auth/repo/技能探测等）。

旧语义把「操作能力（数据路径）」与「界面检查（UI 展示）」混为一谈，导致 UI 直接 `if (backendId === 'github')` 分支。需先定「检查项 / 链条」契约的一等公民形态与边界，再放行编排链与落地票。

---

## 2. 目标

为「检查项 / 检查链条」定**可被验收**的契约：

1. **检查项形状** `{check, onPass:{show,actions}, onFail:{show,actions}}` 的谓词形态、展示与动作数据结构；
2. **链条求值**：契约层纯函数求值器（喂状态 → 出步骤快照）、宿主谓词注册表、`done/current/fail/pending` 四态与推进规则（2026-08-27 起删 `na`）；
3. **动作词汇表 v1**：`inject-prompt / open-url / rpc / form / refresh` 是否够、`form` schema 是否接受、执行分发器归属；
4. **G5 双名制修订**：操作能力（运行时事实）vs 界面检查项（声明式 UI 语言），契约文档改写点；
5. **目录边界**：通用检查目录与后端检查目录的划分（技能探测等通用项 vs gh/glab/仓库定位等后端项）；通用恒脱离后端可检测，后端按物理隔离，N 动态。

---

## 3. 非目标（Out of scope）

- 第三方/新 tracker 后端的完整实现（仅保证形状可扩展）；
- 改造 DSH 官方 slots 系统或为壳层自创座位；
- 内部槽位 order 全局编号策略与扩展服务的装载/卸载契约（已由 #221 ADR 2026-08-27/28 定版五端口内部总线补完，不再 Not yet specified）。

---

## 4. 约束与原则

- **G5**：无能力表、无能力分支、调用即知；做不到返回 `unsupported` 桩诚实失败（数据路径）。
- **检查项永不进入数据路径**：只驱动 UI 展示与动作入口（声明式 UI 语言）。
- **链推进只来自重求值**：重新问谓词、探测真实状态，不来自动作回调；`open-url` 等为信息性动作，不宣称修复、不推进链。
- **五方职责**：UI（只消费契约产物渲染）/ 契约层（定义接口与求值）/ 后端层（声明目录与动作、实现操作）/ 平台抽象层（封装 OS 能力原语）/ OS 底座层（各 OS 具体实现）。
- **通用脱离后端**：通用检查的真值不随 backendId 改变，可在 OS 平台抽象层直接检测；准入通用目录的必要条件。
- **后端物理隔离**：不同后端的检测链按后端独立，Markdown 卷子上不出现 GitHub 行，跨后端误导靠行不存在根治，无需 NA。
- **N 动态**：`N = 通用链题数 + 当前后端链题数` 动态求和，分开计数、分开渲染。
- **高质量要求**：不计时间成本，不做最小可用；要求无 bug 且功能齐全（本票按此执行）。

---

## 5. 决策

### 5.1 检查项形状与谓词形态

- **形状**：

```ts
type CheckItem = {
  id: string,                 // 链内唯一，供 predicateResults 索引
  check: Check,               // 判别联合（见下）
  onPass: { show: Show|null, actions: Action[] },
  onFail: { show: Show|null, actions: Action[] },
  label?: string,
}
```

- **Check 判别联合**（契约层只定形状，语义在宿主谓词注册表）：

```ts
type Check =
  | { kind:'primitive', primitive:'commandExists'|'fileExists'|'env'|'skillProbe', command?:string, path?:string, key?:string, skill?:string }
  | { kind:'backend', id:string, backendId?:string, params?:Record<string,unknown> }
  | { kind:'preflight', id:string, params?:Record<string,unknown> }
```

  原语覆盖通用探测（gh/glab 存在性、文件存在性、环境变量、技能探测）；后端/preflight 覆盖专用门禁。

- **Show**：`{i18nKey, params?, fallback?, hint?}` —— i18n 单信源，UI 透传；允许 `null`。
- **FieldSchema（form）**：`{name, type:'text'|'number'|'date'|'single'|'multi', labelKey, required?, options?, placeholderKey?, defaultValue?}` —— v1 就完整，不做占位。

### 5.2 链条求值（纯函数）

- **位置**：`src/shared/tracker/chain.js` `evaluateChain(chain, predicateResults)` —— 纯函数，无 IO，宿主先 `resolveAll` 再喂入。
- **输入**：`predicateResults: Record<id, 'pass'|'fail'|null>`（`null`=pending，超时亦 pending；2026-08-27 起不再有 `'na'`）。
- **输出**：`ChainSnapshot{steps, currentIndex, doneCount, applicableCount, totalCount, chainState}` + `StepSnapshot{status, show, actions, isApplicable, blockedBy}`。
- **状态集**：`done（通过）/ current（链头可行动，含动作）/ fail（链头失败无动作，terminal）/ pending（探测中或被前步阻塞）` 四态（2026-08-27 起删 `na`）。
  - 顺序求值：前步非 `done` 则后步一律 `pending`（被阻塞）；
  - 有动作的失败 → `current`（高亮），无动作的失败 → `fail`（红态），二者皆为链头失败的两种视觉。
- **推进**：只来自重求值（宿主重新 `resolveAll` 后再调 `evaluateChain`）；动作回调不直接改 `status`。
- **口径**：`chainProgress` 分子 `doneCount` 分母 `applicableCount = total`（2026-08-27 起 `na` 已删，分母不再 `total - na`）；`capsuleSummary` 同口径。

### 5.3 动作词汇表 v1

- **枚举（契约层唯一真源）**：`inject-prompt / open-url / rpc / form / refresh` —— 已够 v1（toast 不进本票，见 #215 Not yet specified）。
- **分工**：`inject-prompt` 推进型（配合重求值）、`open-url` 信息型（不推进）、`rpc`/`form`/`refresh` 执行型（需重求值才推进）。
- **分层**：
  - 形状定义 + 类型枚举 → 契约层 `shared/tracker/chain.js`（生产者与消费者共读，防漂移；遇枚举外 `type` → 诚实 `unsupported`）；
  - 执行器 dispatcher → UI 层 `client/kernel/actions.js`（`inject` / `window.open` / `host.call` / 表单渲染器）；
  - 动作声明 → 后端模块 / 通用目录（检查项的 `onPass/onFail.actions`）。

### 5.4 G5 双名制修订

- **操作能力（capability）**：数据路径的能力 = 运行时调用结果（无能力表、无分支、调用即知；`unsupported` 桩诚实失败）—— 见 `src/host/tracker/capability.js` 与 `src/host/tracker/contract.js`。
- **界面检查项（check item）**：声明式 UI 语言的一等公民（本契约），永不进入数据路径。
- **改写点**：
  - `CONTEXT.md` 版本升至 2026-08-27，删 `na` 词条，增“通用脱离后端、后端物理隔离、N 动态”三词条，写明效力规则；
  - `docs/architecture/tracker-backend-design-contract.md` 保持最小，仅引用本 ADR，不随子图决定增重；
  - 全仓 `capability` 旧语义批改（本票执行时 grep 覆盖，不留残留）。

### 5.5 目录边界

- **判据**：真值是否随 `backendId` 改变 —— 不变 → 通用；改变 → 后端。形式化，可执行。
- **通用目录**（ `src/shared/tracker/check-catalog.js GENERIC_CATALOG` ）：技能探测（wayfinder/setup-mattpocock-skills/ask-matt）、用户主目录可解析、工作区已初始化（`docs/agents/issue-tracker.md` 存在）—— 5 项，适用于所有后端。
- **后端目录**：
  - GitHub：`gh:installed / gh:authed / gh:repoAccess / gh:labels`；
  - GitLab：`glab:installed / glab:authed / glab:repoAccess`；
  - Markdown：`md:scratchWritable / md:parseOk`。
- **迁移映射**：14 项必迁已在 `check-catalog.js MIGRATION_MAP` 逐条对齐，供下游 227-231 直接消费。

---

## 6. 选项权衡（已按高质量拍板）

| 议题 | 选项 | 决策 | 理由（高质量） |
|---|---|---|---|
| 交付物 | A 文档 only / B 文档+类型 / C 文档+类型+求值器+测试 | **C** | 可验才无 bug；类型 alone 无法被门禁卡死 |
| Check 形态 | string id / 函数 / 判别联合 | **判别联合** | string 丢参数，函数不可序列化；判别联合既类型安全又可落盘 |
| Show | 纯文案 / i18nKey | **i18nKey** | 单信源，消灭 `locale.js` 11 处硬编码 |
| Form | 占位 / 完整 schema | **完整** | 占位省今天成本，费明天质量；v1 需校验 |
| 状态 pending 归属 | 求值器 async / 宿主预 resolve | **宿主预 resolve** | 契约层纯函数才可离线枚举测试 |
| 通用判定 | 主观列表 / 形式化判据 | **形式化（随 backendId 变否）** | 可执行，无争议，AI 可自动分类 |
| 动作分层 | 契约不枚举 / 契约枚举+UI 执行 / 宿主执行 | **契约枚举+UI 执行** | 单信源防漂移，UI 明确知道自己有哪些功能 |
| 推进 | 回调推进 / 重求值推进 | **重求值** | 回调谎报修复，重求值才诚实 |

---

## 7. 后果

- **正向**：后续编排链（开门链 / 前置环境检测链）只需合并 `catalogFor(backendId)` 并喂 `evaluateChain`，UI 只消费快照，无需 `if (backendId==='github')` 分支；88 条硬编码可被 227-231 按 `MIGRATION_MAP` 逐条下沉，契约测试兜底。
- **代价**：新增 4 个源文件 + 1 个 ADR + 1 套测试；全仓术语批改需一次 grep 覆盖（本票已做）。
- **风险与缓解**：谓词超时按 `pending` 不抛，整链不被单点拖死；枚举外 action 按 `unsupported` 诚实失败，不静默吞。

---

## 8. 关联

- 输入：` .scratch/research/ui-hardcode-inventory-20260826.md`（88 条，67 必迁）、#215 原规约（评论区存档）、#198 五票结论、charting 讨论存档（动作三层分置 + 链推进原则）。
- 输出：`src/shared/tracker/chain.js`、`src/host/tracker/predicateRegistry.js`、`src/client/kernel/actions.js`、`src/shared/tracker/check-catalog.js`、本 ADR、`CONTEXT.md` 2026-08-27 升版、`tests/` 链契约测试。
- 下游：编排链设计票（合并目录成开门链/检测链）、227-231 落地票（消费 `MIGRATION_MAP`）。

---

## 9. 修订记录（2026-08-27，#219/#245，#246 落地）

- 删 `na`：通用恒脱离后端可检测、后端物理隔离、N 动态，跨后端误导靠行不存在根治，状态集 5→4，`applicableCount = total`，`predicateResults` 不再含 `'na'`，`CHECK_STATE.NA` 删除。