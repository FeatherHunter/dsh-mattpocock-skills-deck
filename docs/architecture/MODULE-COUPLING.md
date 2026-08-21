# 模块联动机制 · 架构设计

> 用途：回答「拆开后模块之间如何联动？会破坏架构吗？」
> 来源：`ARCHITECTURE-SPLIT.md` §4.3 + `ARCHITECTURE-CTX.md` + `docs/architecture/kernel-contract.md` G3 拍板 + 仓库实查（kernel/store.js、kernel/router.js、kernel/probe.js）

---

## 核心结论（一句话）

> **模块之间不直接对话——一切联动都经"内核 seam"转发（store 广播 / router 路由 / probe 全刷 / api 桥）。**
> 这是单向的"通知 → 总线 → 订阅"，不是"A → B 的调用"，所以**既支持联动又不破坏物理隔离**。

---

## 一、四种合法联动通道（架构白名单）

### 通道 ① Store 广播（最常用 · 数据/状态联动）

```
  ListTab.js 改了某 ticket 的 action 状态
        │
        │ ① 修改自己的 store 字段
        ▼
  ┌─────────────────────────────────────┐
  │ kernel/store.js                     │
  │   st.foo = ...; emit(st)            │  ← 触发订阅者列表
  └─────────────────────────────────────┘
        │
        │ ② 广播 tick++ 给所有 sub
        ▼
  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │ MapDetail   │ │ StatusBar   │ │ Settings    │  ← 通过 useStore() 自动重渲染
  └─────────────┘ └─────────────┘ └─────────────┘
```

**API**（来自 `src/client/kernel/store.js` L234-261）：
- `storeOf(sid) → st` —— 取会话级 store
- `emit(st)` —— 广播 tick++
- `sub(st, f) → dispose` —— 手动订阅（返回解订函数）
- `useStore(sid) → st` —— 组件用 hook 自动订阅（内部 `useEffect` + `set`）

**代码示例**：
```js
// A 模块：发出变化
import { storeOf, emit } from '../kernel/store'
const st = storeOf(sid)
st.myFlag = true
emit(st)

// B 模块：接收变化（任意深度）
import { useStore } from '../kernel/store'
function MyComponent({ sid }) {
  const st = useStore(sid)        // ← 自动订阅，自动重渲染
  return st.myFlag ? <Badge/> : null
}
```

**不破坏架构的原因**：B 没有 import A；A 不知道 B 存在。两者都只 import 内核。

---

### 通道 ② Router 路由（面板/标签切换联动）

```
  EnvBadge.onClick()
        │
        │ 调用 router.openPanel(st, 'checks')
        ▼
  ┌─────────────────────────────────────┐
  │ kernel/router.js                    │
  │   openPanel / togglePanel           │
  │   openDockPanel / openPagePanel     │
  │   openInSidebar / ensureSidebarTab  │
  └─────────────────────────────────────┘
        │
        │ 改 st.activeTab / st.panelOpen
        ▼
  ┌─────────────────────────────────────┐
  │ kernel/store.js emit()              │  ← 复用 store 广播
  └─────────────────────────────────────┘
        │
        ▼
  Dock / Overlay 内部根据 st.activeTab 渲染对应 view
```

**API**（来自 `src/client/kernel/router.js`）：
- `openPanel(st, tabName)` —— 智能选择（dock / sidebar / page）
- `togglePanel(st)` —— 开关当前面板
- `openDockPanel(st, tabName)` —— 强制 dock
- `openPagePanel(st, tabName)` —— 强制 page
- `openInSidebar(st)` —— sidebar tab

**典型用法**：状态栏的 EnvBadge 点击 → `router.openPanel(st, 'checks')` → Dock 自动切换到 ChecksTab。任何状态栏徽标都能触发面板切换，**Dock 自己感知不到是谁触发的**。

---

### 通道 ③ Probe 数据广播（数据/快照刷新联动）

```
  任意地方调用 refreshAll() 或 probeNow()
        │
        ▼
  ┌─────────────────────────────────────┐
  │ kernel/probe.js                     │
  │   probeNow / refreshAll             │
  │   loadSnapshot / broadcastCfg       │
  └─────────────────────────────────────┘
        │
        │ ① 调 host.call('wf.refresh', ...)
        │ ② 拿到新 snapshot → 写入所有 stores
        │ ③ diffSnapshots → rowFlash/issueFlash
        ▼
  所有用 useStore(sid) 的视图自动重渲染
  新增/变更的行自动高亮闪烁（rowFlash）
```

**API**（来自 `src/client/kernel/probe.js`）：
- `probeNow(fromFocus)` —— 立即探测
- `refreshAll(st)` —— 刷新本会话 + 联动其他会话
- `loadSnapshot(st, force, silent)` —— 加载快照
- `startAutoProbe()` —— 启动 60s 周期探测 + focus 事件
- `broadcastCfg()` —— 配置变更广播（影响所有会话的 stores）
- `scheduleActionProbe()` —— 操作后延迟探测（debounce）
- `diffSnapshots(oldS, newS)` —— 差分（产生 rowFlash / issueFlash）

**典型用法**：状态栏的「刷新」按钮 → `api.rpc('wf.refresh')` 或 `probe.refreshAll(st)` → 整个面板的所有视图都更新，**不需要任何视图手动监听**。

---

### 通道 ④ API Host 桥（持久化 / 副作用联动）

```
  任意组件调用
        │
        ▼
  ┌─────────────────────────────────────┐
  │ kernel/api.js                       │
  │   injectFixate / handoff 系列       │
  │   openInNewSession / copyText       │
  │   inject(text)                      │
  └─────────────────────────────────────┘
        │
        │ 调 host.call(endpoint, args)
        ▼
  DSH Host → 持久化或开新会话
```

**API**（来自 `src/client/kernel/api.js`，G3 表）：
- `injectFixate` / `inject(text)` —— 注入文本到主输入框
- `openInNewSession(text)` / `openTextInNewSession(text)` —— 开新 session
- `copyText(text)` —— 复制到剪贴板
- `handoff*` —— 交接（scan / read / doHandoff / doHandoffOpen）
- `extractIssueRefs(text)` —— 从文本里抓 #N 引用
- `openUrl(url)` —— 打开 URL

**典型用法**：ListTab 行动作「新建 wayfinder」 → `api.inject(text)` → host 写入主输入框 → 用户回车提交 → host 触发探测 → probe 广播 → 所有视图更新。

---

## 二、四种合法通道总览

| 通道 | 入口模块 | 典型场景 | 落点 |
|---|---|---|---|
| ① Store 广播 | `kernel/store` | 状态/计数/标记变化 | 所有 `useStore(sid)` 订阅者 |
| ② Router 路由 | `kernel/router` | 面板/tab 切换 | Dock/Overlay 内部渲染分支 |
| ③ Probe 数据 | `kernel/probe` | 数据/快照/环境检查刷新 | 所有 store.snapshot 订阅者 |
| ④ API Host 桥 | `kernel/api` | 持久化/副作用（注入/复制/开新会话/交接） | DSH Host → 触发新一轮 probe 广播 |

**关键事实**：① ② ③ 都共享 `kernel/store` 作为底层总线——`router` 改 store + emit、`probe` 改 store + emit，所有视图通过 `useStore` 自动响应。

```
                    ┌────────────────────────────┐
                    │   kernel/store (总线)       │
                    │   storeOf/emit/sub/useStore │
                    └────────────┬───────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
            ▼                    ▼                    ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
   │ kernel/router   │  │ kernel/probe    │  │ kernel/api      │
   │ (面板开关/tab)  │  │ (数据/快照/探测) │  │ (持久化/副作用) │
   │ 改 store + emit │  │ 改 store + emit │  │ 调 host + 触发  │
   └─────────────────┘  └─────────────────┘  └─────────────────┘
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 ▼
                    所有视图自动响应（useStore）
```

---

## 三、Cx 传递：让组件拿得到联动工具

模块要用 store / router / probe / api，必须先拿到 cx。**Ctx 通过 React Context 注入**：

```js
// src/client/kernel/ctx.js
export function createCx({ ctx, h, rdom, storeSvc, localeSvc, timer, api, router }) {
  return Object.freeze({ ctx, h, rdom, storeSvc, localeSvc, timer, api, router })
}
export const DswsCtx = React.createContext(null)

// 任意组件
function MyView({ sid }) {
  const cx = React.useContext(DswsCtx)
  if (!cx) return null
  const st = cx.storeSvc.useStore(sid)   // 订阅 store
  const onClick = () => cx.router.openPanel(st, 'checks')  // 路由跳转
  return h('button', { onClick }, 'env')
}

// 逻辑模块（非组件）
export function makeApi(cx) {
  return {
    inject: (text) => cx.api.inject(text),     // host 桥
    refresh: () => cx.api.refresh()             // 触发 probe 广播
  }
}
```

---

## 四、四个真实联动场景（实战代码轮廓）

### 场景 1：ListTab 行动作「开新会话讨论 #20」→ MapDetail 自动更新

```js
// views/ListTab.js
import { useContext } from 'react'
import { DswsCtx } from '../kernel/ctx'

export function ListTab({ sid }) {
  const cx = useContext(DswsCtx)
  const st = cx.storeSvc.useStore(sid)

  const onNewSession = (ticket) => {
    // 1. 调 api（host 桥）
    cx.api.openInNewSession(cx.router.newWayfinderText(st))
    // 2. host 完成后会自动触发 probeNow()
    // 3. probe 改 store.snapshot + emit
    // 4. MapDetail.js 用 useStore(sid) 自动重渲染
    // ✅ ListTab 没 import MapDetail.js
  }

  return st.snapshot?.maps.map(map => /* ... */)
}

// views/MapDetail.js（独立存在，不知道 ListTab 在哪）
export function MapDetail({ sid }) {
  const cx = useContext(DswsCtx)
  const st = cx.storeSvc.useStore(sid)   // 自动跟着广播更新
  return st.snapshot ? <Detail snap={st.snapshot}/> : null
}
```

### 场景 2：状态栏 EnvBadge 点击 → Dock 切到 ChecksTab

```js
// statusbar/EnvBadge.js
export function EnvBadge({ sid }) {
  const cx = useContext(DswsCtx)
  const st = cx.storeSvc.useStore(sid)

  return h('button', {
    onClick: () => cx.router.openPanel(st, 'checks')   // ← 改 store.activeTab + emit
  }, cx.localeSvc.tr('env.ready', { n: readyN }))
}

// panel/Dock.js（独立存在，不知道 EnvBadge 在哪）
export function Dock({ sid }) {
  const cx = useContext(DswsCtx)
  const st = cx.storeSvc.useStore(sid)   // 自动响应 activeTab 变化

  const tabs = ['list', 'map', 'skills', 'checks']
  return h('div', null,
    h(Tabs, { active: st.activeTab, tabs }),
    tabs[st.activeTab === 'list' ? 0 : st.activeTab === 'map' ? 1
       : st.activeTab === 'skills' ? 2 : 3]
  )
}
```

### 场景 3：Tabs 折叠级别变化 → 所有 tab 行重新布局

```js
// panel/Tabs.js 内部
function useTabFold(sid) {
  const cx = useContext(DswsCtx)
  const st = cx.storeSvc.useStore(sid)
  const width = useContainerWidth()
  // tabsLevelDecide 是 kernel/tabsfold.js 导出的纯函数
  return tabsfold.tabsLevelDecide(width, st.tabFoldTick || 0)
}

// 触发折叠变化（比如 window.resize 监听器）
window.addEventListener('resize', () => {
  const st = cx.storeSvc.storeOf(sid)
  st.tabFoldTick = (st.tabFoldTick || 0) + 1
  cx.storeSvc.emit(st)   // 广播
})
// 所有订阅者（包括 Tabs.js 自己）自动重渲染
```

### 场景 4：刷新按钮 → 整个面板所有视图刷新

```js
// statusbar/runcard.js 或任意地方
function RefreshButton({ sid }) {
  const cx = useContext(DswsCtx)
  const st = cx.storeSvc.useStore(sid)
  return h('button', {
    onClick: () => cx.api.refresh()    // → 内部触发 probe.refreshAll → 广播
  }, '↻')
}
```

---

## 五、反模式（**会破坏架构**）—— 这才是你真正担心的

### ❌ 反模式 ① 同层模块直接 import

```js
// ❌ views/ListTab.js
import { MapDetail } from './MapDetail'   // ← 违反同层禁互连
```

**为什么坏**：
- A 改 `MapDetail` 的导出 → B 编译失败 → **隐式强制串行**
- A 想给 MapDetail 加 prop → 改 MapDetail.js → 改 ListTab.js 调用 → 两个文件一起动
- 文件级冲突面被这两个文件绑在一起

**正确做法**：用 store 广播（场景 1）或 router 路由（场景 2）。

### ❌ 反模式 ② 直接改别人的 store.subs

```js
// ❌ statusbar/EnvBadge.js
import { storeOf } from '../kernel/store'
const st = storeOf(sid)
st.subs.push(myCallback)   // ← 绕过 sub API
```

**为什么坏**：
- 解除订阅时找不到自己的 callback
- 别人 emit 时机不明确，调试噩梦
- 没有 dispose 清理 → 内存泄漏

**正确做法**：用 `useStore(sid)`（自动订阅 + 自动解订）或 `sub(st, f) → dispose`。

### ❌ 反模式 ③ props 透传（A 方案的姊妹问题）

```js
// ❌ App → Sidebar → ListTab → TicketRow → ... 一路传 cx 下去
<App cx={cx}>
  <Sidebar cx={cx}>
    <ListTab cx={cx}>           ← 每个中间层都要当传话
      <TicketRow cx={cx}>       ← 改一次 cx 结构要改一串文件
```

**为什么坏**（这是已被否决的 B 方案）：
- 中间层都要当传话筒
- 改一次工具（cx 增字段）要改一串文件
- **把冲突请回来了**

**正确做法**：A 插座式（React Context）—— `const cx = useContext(DswsCtx)`，任意深度直接取。

### ❌ 反模式 ④ 跨模块共享可变对象（非 store）

```js
// ❌ 维护一个 views/shared.js 导出全局可变对象
export const sharedState = { currentTab: 'list' }
```

**为什么坏**：
- 谁都能改 → 调试时不知道是谁改的
- 测试需要清理这个全局对象
- 隐式耦合

**正确做法**：用 `storeOf(sid)`（会话隔离）+ emit。

---

## 六、判定清单：我要做联动，怎么判断走哪条通道？

| 联动需求 | 应该走 | 关键 API |
|---|---|---|
| A 改了某数据，B 的视图要跟着变 | Store 广播 | `cx.storeSvc.useStore(sid)` + `emit(st)` |
| A 点了按钮，要切到 B 视图 | Router 路由 | `cx.router.openPanel(st, tabName)` |
| A 做了某操作，要全模块刷新数据 | Probe 探测 | `cx.api.refresh()` / `cx.probe.refreshAll(st)` |
| A 要 host 做某事（注入/复制/开新会话） | API Host 桥 | `cx.api.inject/openInNewSession/copyText` |
| A 想给 B 发个事件，B 处理后不影响 A | Store 广播 + emit | 同上 |

**如果你的联动需求不在这四类里 → 90% 的概率你在做反模式**——回去重新设计。

---

## 七、回答你的问题

**Q：模块联动会破坏架构吗？**

A：**只要走内核 seam（store / router / probe / api），不会破坏。**

- 这些通道的 API 接口在 `docs/architecture/kernel-contract.md` G3 表里**已冻结**
- 模块之间不直接 import → 文件所有权清晰
- 单向"通知 → 广播 → 订阅"数据流 → 没有循环依赖
- 两个 session 改代码时，A 改自己模块 + 调用内核 seam，B 改自己模块 + 订阅内核 seam → **文件不相交，零冲突**

**会破坏架构的只有反模式**：
- 同层互 import
- 直接改别人 store.subs
- props 透传
- 共享可变对象

**判定口诀**：联动 → 问"我要走哪个内核？" → 找到对应 seam → 调它 → 完事。
不要问"我要不要 import B 模块？"——**永远不要**。