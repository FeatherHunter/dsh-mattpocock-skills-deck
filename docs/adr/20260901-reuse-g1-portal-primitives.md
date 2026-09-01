# ADR：前端控件复用化 — 封装边界与目录落位（G1）— #376/#391

> 日期：2026-09-01 定版（承 #373 地图，R1 #374 + R2 #375 研究已落盘，G1 #376 grilling 拍板方案一 91 分）
> 地位：前端复用体系的首个架构决策，落位底座与原子目录，后续所有新控件默认走此路径；与 `docs/architecture/kernel-contract.md` 冻结表与 `scripts/build.mjs` 拼装清单同级约束。
> 版本与效力：本文件落盘后，凡与本决策冲突的旧方案/契约/讨论，以本文件（更新日期者）为准；未来任何讨论若改动本决策，以未来版本为准（CONTEXT.md 同款两条规则）。

---

## 1. 背景

面板内多处需要同一种悬浮提示、挂顶、分段按钮、标签与弹窗效果，却各自写了一遍定位计算、翻转、挂到顶层、定时器与样式（R1 盘点 38 文件 × 29 画像，5 处高频重复证据：定位/翻转、portal、时序、Chip、Tabs）。新增一处就要再抄一遍，改一处易漏另一处，且难以单测验证翻转与跟随分支。需要把可复用能力抽为独立自定义控件，统一接口、样式与挂载契约。

约束：纯 JS + `React.createElement` 手写（无 TS/JSX/组件库）、闭包拼接（`src/client/index.js` 母板 + `scripts/build.mjs` 剥 `export` 拼回 `// ==== kernel:* / leaf:* ====`，一源两物）、`DswsCtx` 8 字段冻结（`kernel/ctx.js`）、同层禁互 `import`、产物双新鲜度门禁。

---

## 2. 决策

### 2.1 挂顶底座归属内核

- 底座 `portalTop` / `PortalOverlay` 定为平台抽象层的全局底座，与 `kernel/styles.js` 的 `styles.insert` 同级，仅依赖 `RDOM`（react-dom 三路探测）与 `document.body`，不含业务状态。
- 落位：`src/client/kernel/portal.js`（约 15 行，零业务状态），导出 `RDOM`、`portalTop(node)`、`PortalOverlay(props, children)`；`RDOM` 取不到为 null，`portalTop` 取不到 `RDOM` 或 `body` 时退化为原地渲染不抛错（见 `docs/architecture/kernel-contract.md` 冻结表新增一行）。
- 所有悬浮与弹窗统一经此底座挂载，避免各处自写挂顶与层级守卫，规避固定定位被祖先 `transform` 裁剪的陷阱（issue #3 / #22 同理）。
- 构建：`scripts/build.mjs` `KERNEL_MODULES` +1（portal），`src/client/index.js` 留 `// ==== kernel:portal (spliced by build) ====` 标记；双产物一源两物，`tests/verify-kernel.js` 校验导出齐全与拼装。

### 2.2 原子控件独立目录

- 原子控件（悬浮提示、分段按钮、数字区、分割按钮、标签族、弹窗基座、标签栏行）与分子/页面辅助控件物理分层，原子目录与大文件重构的单模块单文件约束正交，分子控件仍保留在原共享目录按需演进。
- 落位：新建 `src/client/views/primitives/`（原子目录），与 `views/shared/`（分子/页面辅助）、`floating/`、`statusbar/` 并列，语义正交，不受 #336 大文件拆分约束牵制。
- 首轮文件树：
  ```
  src/client/
    kernel/
      portal.js                 # 底座：RDOM 三路探测 + portalTop + PortalOverlay
    views/
      primitives/               # 新建：原子控件目录
        HoverTip.js             # 统一气泡：mode anchor|mouse|fixed, flip auto|bool, maxW, caret 翻转，h 工厂 + 局部 state（190 行）
        # 预留（G1 定版但次轮分批，G3 按阈值高者先抽）：
        # Seg.js, Num.js, Split.js, Chip.js (Chip/TypeChip/Dot), Modal.js, Tabs.js
      shared/                   # 保留：分子/页面辅助（ChainRenderer、md、BackendSelector、tagsFit 等次轮再议）
    floating/
      Pop.js                    # 保留但标记 deprecated，T2 后由 HoverTip 替代，次轮移除
      SkillFloatList.js         # 消费 HoverTip + portalTop，不自写定位翻转
  ```
- 构建：`LEAF_MODULES` 新增 `hoverTip` 项（`src/client/views/primitives/HoverTip.js`），母板留 `// ==== leaf:hoverTip (spliced by build) ====`；新增叶未登记即构建报错（防忘贴条）。

### 2.3 单文件单控件粒度

- 文件名与导出名一一对应，PascalCase，单文件 <200 行，仅依赖 `kernel/*` 与共享基础，不横向依赖同层其他原子控件。
- 例外：`Chip.js` 允许 `Chip`/`TypeChip`/`Dot` 同文件三导出（同家族同粒度）；`Seg.js` 双导出 `num+seg` 本次拆为 `Seg.js` + `Num.js`，此后不新增单文件多控件。
- 检测：`tests/verify-reuse.js` 校验粒度与横向依赖，`tests/verify-leaves.js` 校验 ≤350（primitives 勒紧至 ≤200）。

### 2.4 工厂形态与局部状态

- 复用控件对外呈工厂函数形态，内部可用局部状态与副作用实现跟随、翻转与定时器，对外仅暴露参数与回调。
- 取法：`const cx = React.useContext(DswsCtx); const h = cx ? cx.h : React.createElement`，渲染所需的创建函数与挂顶句柄经上下文注入，不自建实例。
- 样式单真源 `STYLE_TEXT` 保持不变，控件色值与尺寸经参数透传或变量覆盖，不在控件内自带样式文本。

### 2.5 阈值与门禁

- 阈值：2 处标记（`// TODO reuse:<key>`）、3 处即抽（当次 PR 必须抽或附 grilling 豁免）、5 处必卡（`verify-reuse` 报错，不抽不合入），底座 0 容忍。
- 门禁：新增 `tests/verify-reuse.js` 轻量文本扫描两问（Q1 全局 store 直读、Q2 portal/翻转重复），白名单仅 `kernel/portal.js` 与 `primitives/HoverTip.js`，与 `verify-kernel` / `verify-leaves` / `verify-no-cross-import` 并列执行，失败阻塞发布。

---

## 3. 后果

- 正向：后续所有新控件默认走复用路径不再各写定位/翻转/挂顶逻辑；首轮以悬浮提示为样板验证路径，其余原子控件按统一命名与粒度分批落地并完成对现有两处悬浮样板的迁移（`SkillFloatList` 锚点 + `SettingsPage` 鼠标）。
- 代价：新增 `kernel/portal.js` 与 `primitives/` 目录及构建与门禁白名单同步（约 2 行冻结表 + 1 行 KERNEL + 1 行 LEAF + 3 处门禁白名单）。
- 风险与缓解：漏改构建标记或冻结表会导致 `verify-kernel` 红，T1 单独 PR 验证 build 全绿；新建目录漏改门禁会 CI 红，决议附改动清单一次性改完；不定粒度会导致单文件膨至 300 行违背 #336，由本 ADR 锁 <200 行门禁。

---

## 4. 上游依据与引用

- R1 盘点：`_research/reuse-inventory.md`（38 文件扫描 + 29 画像 + 5 处重复）
- R2 阈值与模式：`_research/reuse-criteria.md` §1 三判定线 + §2 八项清单 + §3 阈值 2/3/5 + §4 h 工厂主路径 + §5 门禁两问
- G1 拍板：#376 方案一（kernel 底座 92 分 + primitives 新目录 88 分 + C1 单控件 90 分 + D1 单真源 85 分，综合 91 分）
- G2 契约：#377 / #393 HoverTip 接口定版（供 T2 直接落地）
- 落地：T1 #380 底座抽离 + T2 #381 HoverTip 首批落地与两处迁移（已验证 `verify-kernel` / `verify-skill-tooltip` / `npm run verify` 全绿）

---

## 5. 变更记录

- 2026-09-01 初版（G1 定版落盘，T1/T2 已落地验证）。
