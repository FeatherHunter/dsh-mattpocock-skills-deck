# Ctx 设计说明（插座式 · 定案版）

> 状态：✅ 已定案（用户拍板选 A · 2026-08-18）
> 用途：阶段 2 开工前把「拆房间后公共物品怎么分发」这个命门钉死，避免拆到一半返工。
> 读者：① 用户（看「大白话」部分）；② 实施 AI（看「技术规格」部分）。

---

## 第一部分 · 大白话（给用户看）

### 问题回顾
现在 3700 行代码是一个大房间，`store`/`h`/翻译机/定时器这些公共物品随手放，谁要谁拿。
拆文件后变成几十个小房间（模块文件），JavaScript 规矩：**房间之间不能直接摸对方的东西**。

### 选定的做法：插座式（A）
在「大厅」装一个总电闸（Provider），公共物品接好电；每个房间墙上装标准插座孔（Context），谁要用就插上。

```
大厅总电闸(Provider) ──供电──► [状态栏] [列表] [技能] [环境检查] [map详情] …
                               每个模块墙上的插座孔，插上就能用公共物品
```

### 为什么不是另外两种
- **B 开会发文件（props 透传）**：中间每个房间都要当传话筒，改一次工具要改一串文件——把冲突请回来了。❌
- **C 大楼前台（模块级单例）**：谁都能从后门摸公共物品，等于回到大房间乱象；测试还得清理前台。❌
- **A 插座式（React Context）**：任何深度的房间直接插电，不用传话；测试时换个「假电闸」就能单测一个房间。✅

### 对你的意义
- 你按模块分任务（状态栏 / map 详情 / …），代码结构匹配任务结构；
- 以后给 AI 提需求，AI 改的是对应模块文件，插头自动从插座取电，**不需要人管公共物品怎么传**；
- 唯一需要串行的事：**改电闸本身（内核）**——公共工具箱只有一份，两个人同时伸手进去改箱子会打架。

---

## 第二部分 · 技术规格（给实施 AI 看）

### 1. 决策记录

| 决策点 | 定案 | 理由 |
|---|---|---|
| 跨层级共享机制 | **React Context（`React.createContext` + `React.useContext`）** | React 官方机制；本仓库已是 `React.createElement` + hooks 风格（`useStore` L1160、`React.useEffect` 等），无 JSX 但 hooks 可用 |
| 逻辑模块（非组件）如何拿依赖 | **工厂注入**（`makeProbe(cx)` 显式传参） | `useContext` 只能在组件里用；probe/router 等逻辑模块用构造注入，测试直接传假依赖 |
| 组件如何拿依赖 | `const cx = React.useContext(DswsCtx)` | 任意深度直接取，不经过中间组件 |
| cx 对象内容 | `{ ctx, h, rdom, storeSvc, localeSvc, timer, api, router }` | 与现有 apply 闭包变量一一对应，不新增概念 |
| cx 对象稳定性 | **模块级单例（只创建一次）** | Context 值变 → 全树重渲染；cx 必须引用稳定（`useMemo` 或模块级常量） |
| Provider 缺失兜底 | `useContext` 返回 null → 组件渲染降级（不 crash） | 防御性，测试/异常时可用 |

### 2. 文件与接线

```
src/client/kernel/ctx.js        ← 新增：createCx(...) 建 cx + DswsCtx = React.createContext(null)
src/client/index.js             ← 组装：apply(ctx) 里建 cx → 用 <DswsCtx.Provider value={cx}> 包住现有渲染树
src/client/**/*.js (组件)        ← 迁移后：export function ListTab() { const cx = React.useContext(DswsCtx); ... }
src/client/kernel/probe.js 等   ← 迁移后：export function makeProbe(cx) { ... }（逻辑模块，构造注入）
```

接线顺序（阶段 2 第一步，先接线后搬家）：
1. 建 `ctx.js`（createCx + DswsCtx）；
2. `index.js` 顶层包 Provider（**此时不搬任何组件，行为零变化**，跑测试确认全绿）；
3. 逐模块迁移：把组件从「闭包内定义」移到「独立文件 + useContext」——每迁一个，跑一轮全绿再迁下一个。

### 3. 测试策略

- 单测组件：`React.createElement(DswsCtx.Provider, { value: fakeCx }, <被测组件/>)`——**无需真实 DSH**，fakeCx 里放假 store/假翻译即可；
- 逻辑模块：`makeProbe(fakeCx)` 直接测；
- 与现有测试关系：现有 `verify-*.js` 全部保留，作为迁移回归网；迁移完成一个模块，其对应特征断言切换为「src 特征 ↔ 产物特征」。

### 4. 风险与对策（不回避）

| 风险 | 对策 |
|---|---|
| Context 值变化引发全树重渲染 | cx 为模块级单例，引用永不变化；只有内部字段的读取在渲染期发生 |
| 组件忘了取 cx 就渲染 → undefined 报错 | Provider 缺失时 `useContext` 返回 null，组件内 `if (!cx) return null` 降级 |
| 迁移过程中「闭包版」与「Context 版」并存 | 接线阶段不搬组件；搬一个删一个内联定义，测试断言防止残留双份 |
| 纯 JS 无 JSX，createContext 使用是否顺畅 | 完全可行：`React.createElement(DswsCtx.Provider, {value}, child)` 与 hooks 风格一致，仓库已有大量这种写法 |

### 5. 明确不做的事（防止范围蔓延）

- 不引入 TS / JSX / 任何新语言（文件一律 `.js`）；
- 不引入状态管理库（redux/zustand 等）——现有 `storeOf/emit/sub` 已够用，包进 cx 即可；
- 不做「跨 session 共享内存」类魔法——那是 DSH 宿主的事，不是本插件的事。

---

## 第三部分 · 现状核对（✅实测 / 🧠设计）

| 项 | 状态 |
|---|---|
| 仓库现有 hooks 风格（useStore/useEffect） | ✅ 实测（client.js L1160 / L3173） |
| React.createContext 在无 JSX 下的可用性 | ✅ 事实（React 公开 API，与 JSX 无关） |
| 本方案采用 A 插座式 | ✅ 用户拍板（2026-08-18） |
| 阶段 2 迁移顺序（接线→逐模块） | 🧠 设计决策（可调整） |
