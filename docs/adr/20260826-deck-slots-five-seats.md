# ADR：内部 UI 槽位架构（五端口内部总线，不对外）—— #221

> 日期：2026-08-27 定版 · 2026-08-28 grilling 定版（承 #217 2026-08-26 18:00 基线，#221 15 问全 A）
> 地位：承 #215 地图与 #217 契约，作为编排链与 88 条硬编码下沉的 UI 总线约束。
> 版本与效力：本文件落盘后，凡与本决策冲突的旧方案/契约/讨论，以本文件（更新日期者）为准；未来任何讨论若改动本决策，以未来版本为准（CONTEXT.md 同款两条规则）。

---

## 1. 背景（第一性原理）

#217 已立检查项/链条契约（声明式 UI 语言 + 纯函数求值 + 动作词汇表 + 推进只来自重求值），但契约产出无稳定落点，UI 仍在 leaves 中 if(backendId) 分支。需在面板内立 5 个稳定渲染端口，使新增后端 UI 零分支。

调研底稿 .scratch/research/ui-slots-boundary-20260826.md 已探明官方 46 座位、4 kind、register/inject/order 竞态、children 才能声明子座位。

---

## 2. 目标

为插件面板内立一座私有渲染总线（非壳层能力）：

1. 五端口完备分区（按 生命周期×作用域 正交划分）；
2. 与官方 slots 治理同构（children 声明、priority→order、inject 等待、scope 隔离）；
3. 与检查链渲染器单向挂接（ChainSnapshot → 端口分发，推进只来自重求值）；
4. 后端可插拔（本插件内多后端），UI 不对外。

---

## 3. 非目标

- 不把整个 UI 槽位化（仅 5 条缝上的总线，非全量重写）；
- 不改造官方 slots、不新增壳层座位；
- 不把 toast 纳入链（仅承载 dispatcher 结果）。

---

## 4. 约束与原则

- 契约是真理，总线是舞台：UI 只消费快照，不自解释。
- 壳层只消费不发明：内部 5 端口复用已占据的 3 官方父槽，不自创顶级 root 子。
- 推进只来自重求值：动作不承诺修复。
- 高质量：C 档（文档+真源+测试），可被门禁卡死。

---

## 5. 决策

### 5.1 五端口视觉锚定

| 端口 | 视觉 | 官方父槽 | scope | kind |
|---|---|---|---|---|
| banner-seat | 主区顶部 42px 满宽横幅，同槽互斥（蓝/黄/红） | shell.overlay | root | list |
| dock-seat | 右栏 details 内的 Tab 栏（非整列外壳） | details | session-maybe | list |
| statusbar-seat | 输入区胶囊区（输入框正上方药丸横排） | conversation.input.dock | session | list |
| modal-seat | 主区居中遮罩弹窗 | shell.overlay | root | single |
| toast-seat | 右下角轻提示队列 | shell.overlay | root | list |

完备性：root×常驻、session-maybe×常驻、session×常驻、root×瞬时独占、root×瞬时非独占 = 5。

> 2026-08-28 拷问澄清（#221 15 问全 A）：banner 容器 root 常驻但内容随活跃会话瞬切（允许瞬切）；dock 的 session-maybe 在无会话/开门链未过时显示“请选择后端”占位；shell.overlay 托 3 端口 z 序为 弹窗>提示>横幅；右栏多后端 Tab order 定死 10/20/30 永不开放用户重排；父槽更名时静默不渲染不回退自建容器。

### 5.2 治理

- 声明：5 端口在已占据父槽的 children 中声明，随父坍缩自动回收；存量 4 槽保留历史不迁，仅新 5 端口走此规范。
- 排序：priority→order 双层（SYSTEM_SHADOW:-1/DEFAULT:0/FALLBACK:1，插件段 [100,1000]；内部定死 10/20/30，忠于官方 lowest wins，不开放用户重排）。
- 范围：scope 固化，越权视为非法不渲染。
- 状态：na 三处消隐（不阻塞、不计分母、不弹条）；current 有动作高亮、fail 无动作红态、pending spinner。

### 5.3 形态

C 档：Service 包一层（内核走 ctx.slots children，外观收敛校验/幂等/回收），不经 ctx.get 对外发布。形态 A 复刻与 B 直连不作为终态。

### 5.4 挂接

- banner 取 current 单条
- dock 取全量步骤分区
- statusbar 取 capsuleSummary done/applicable
- modal 仅 fail+form
- toast 仅 dispatcher 结果

时序：predicateRegistry.resolve → evaluateChain → 总线分发 → 动作 → refresh → 重求值。

### 5.5 扩展

后端可插拔指本插件内多后端（GitHub/GitLab/Markdown/通用）经 checkCatalog 声明，UI 自动经 5 端口呈现；不开放跨插件直接注册端口（扩展服务句柄仅为本插件内样板，非公共 API）。未来对外需另起 ADR + allowlist，总线保持私有。

---

## 6. 选项权衡

| 议题 | 选项 | 决策 | 理由 |
|---|---|---|---|
| 全量槽位化 vs 5 缝总线 | 全量/5 缝 | 5 缝 | 全量治理成本与节点数成正比，收益仅 5 面 |
| 形态 | A 复刻/B 直连/C 包一层 | C（内核 B） | C 集中治理，B 留债，A 漂移 |
| 排序 | 全局递增/分区段/priority→order | priority→order | 忠于官方真语义 |
| 对外 | 开放/封闭 | 封闭 | 泄漏私有不变量，成本不对称 |

---

## 7. 后果

- 正向：新增后端 UI 零分支，88 条硬编码可按 MIGRATION_MAP 经 5 端口收敛。
- 代价：新增总线真源与门禁。
- 风险与缓解：同父槽多端口 z-index 竞争（分容器+分区间+portalTop）。

---

## 8. 关联

- 输入：ui-slots-boundary、#217 ADR、#216 清单
- 输出：src/shared/ui/slots.js、src/client/kernel/slots.js、src/client/kernel/slotRenderer.js、tests/verify-deck-slots.js、本 ADR
- 下游：编排链设计票、227-231 落地票