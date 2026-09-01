# 研究：现有前端控件盘点与可封装候选画像（#374 R1）

> 票据: [#374](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/374) — [R1] research: 现有前端控件盘点与可封装候选画像
> 父地图: [#373](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/373) — 前端控件复用化：可封装自定义控件的体系定版与首轮抽离
> 分支: `research/reuse-inventory`
> 落盘: `_research/reuse-inventory.md`
> 日期: 2026-09-01
> 范围: `src/client` 全量（`statusbar/*`, `floating/*`, `views/*`, `views/shared/*`, `panel/*`, `kernel/* UI 相关部分`），仅依一手源码，不改业务代码
> 关键词: 复用控件 / HoverTip / portalTop / Seg / Split / Chip / Modal / Tabs / 定位翻转 / 挂顶 / 重复度
> 供后续: G1(#376) 封装边界与目录落位 · G2(#377) 接口与挂载契约 · G3(#378) 首批试点选型

---

## 摘要

本研究对 `src/client` 全部 38 个 JS 叶文件（含 2 个拼接母板）做逐文件画像，产出：

1. **画像总表** — 29 个 UI 控件/叶模块 × 行数 × props/签名 × 外部依赖（store / emit / tr / portalTop / host / inject）× 重复度；
2. **5 处高频重复证据** — 定位/翻转、挂顶 portal、悬浮时序、Chip 边框着色、Tabs 折叠，各处以行号与两套以上对照佐证（两套悬浮样板为核心对照）；
3. **封装候选 11 项的三维打分**（独立性 / 无全局 store 依赖 / 可参数化）与**首轮必含 5 项、次轮候选 6 项**的划分依据。

核心结论：**首轮必含以 `HoverTip` 为样板统一两套悬浮**（`Pop.js` 的固定气泡与 `SkillFloatList`/`StatusBar` 的锚点跟随），同步抽 `portalTop` 为内核底座；再补 `Seg / Split / Chip(+Dot)` 与 `Modal( FormModalSeat ) / Tabs( useTabsRow )` 4 组原子控件即可覆盖 70% 重复。次轮再收 `tagsFit 贪心`、`ChainRenderer`、`md 渲染`、`BackendSelector` 等页面级复合控件。

---

## 1 扫描范围与方法

### 1.1 文件清单与行数

全量以 `src/client/**/*.js` 扫得 38 文件，UI 相关叶按目录归类（行数以 `Measure-Object -Line` 实测，含注释空行；与 `read` totalLines 一致 ±2）：

| 目录 | 文件 | 行数 | 职责一句 |
|------|------|------|----------|
| **floating** | `floating/Pop.js` | 65 | +N 标签气泡（imperative DOM, fixed 翻转, caret） |
|  | `floating/SkillFloatList.js` | 119 | 技能悬浮列表（锚点 `fixed` + 160ms 延迟关 + ResizeObserver 重定位） |
| **panel** | `panel/Dock.js` | 349 | 右侧 details 容器（cwd 同步 + dock 宽度感知 + 三 tabs） |
|  | `panel/Overlay.js` | 331 | 悬浮面板容器（拖拽/8 向缩放 + tabs 折叠 + head 自适应） |
|  | `panel/NamingFailBanner.js` | 21 | 命名失败横幅（共享 store 订阅, top3 截断） |
| **statusbar** | `statusbar/Seg.js` | 8 | 原语 `num`/`seg`（数字区/分段按钮） |
|  | `statusbar/checksums.js` | 44 | 状态栏派生 `checksumsOf(s)`（链步骤派生计数 + 时间） |
|  | `statusbar/StatusBar.js` | 347 | 输入区胶囊（capsule + bugMenu + backend 浮层 + SkillFloatList 宿主） |
| **views** | `views/ListTab.js` | 336 | 主列表（排序/过滤/chip + fitAllTags + map 置顶） |
|  | `views/SkillsTab.js` | 47 | 技能视图（list/ring 切换 + 推荐） |
|  | `views/ChecksTab.js` | 222 | 环境检查（链快照渲染 + 20s 轮询） |
|  | `views/IssueDetail.js` | 341 | 单票详情（md 渲染 + actor + 状态进度） |
|  | `views/MapDetail.js` | 276 | 地图详情（层/闸门/进度环） |
|  | `views/NoRepoCard.js` | 294 | 无仓库红卡 + 建仓表单 + 标签指引 Modal |
|  | `views/RingSkills.js` | 38 | 圆形技能环（绝对定位极坐标） |
|  | `views/RunPanel.js` | 24 | Run 卡（加载态 + 打开面板/配置引导） |
|  | `views/SettingsPage.js` | 318 | 配置页（模板编辑 + 外观 + 悬浮提示） |
|  | `views/TicketRow.js` | 46 | 行组件（标题 + 进度 + 动作） |
| **views/shared** | `views/shared/chips.js` | 16 | `Dot` + `TypeChip`（类型徽章） |
|  | `views/shared/tabs.js` | 50 | `useTabsRow(s, tabsRef)`（tabBtn + tooltip 门控 + 版本号） |
|  | `views/shared/BackendSelector.js` | 73 | 后端选择器（radio + confirm 闸门） |
|  | `views/shared/ChainRenderer.js` | 230 | 链渲染器（banner + steps + ActionButton + ChainForm） |
|  | `views/shared/md.js` | 142 | markdown 白名单渲染 `mdToHtml` |
|  | `views/shared/SwitchConfirmModal.js` | 174 | 切换确认 Modal（picker + 三选一 + CRI 阻断） |
|  | `views/shared/tagsFit.js` | 31 | `fitAllTags` 贪心折叠（单行 +N） |
|  | `views/shared/ticket.js` | 41 | 票进度 `tStatus/tProgressBar/tStatusBadge` |
| **kernel UI 相关** | `kernel/styles.js` | 251 | `STYLE_TEXT[]` 全局样式表（chip/seg/split/tabs/modal 等） |
|  | `kernel/slotRenderer.js` | 453 | `FormModalSeat` / `openFormModal`（队列 + wizard） |
|  | `kernel/tabsfold.js` | 19 | 纯函数 `tabsLevelDecide`（滞回折叠机） |
|  | `kernel/icons.js` | 70 | `Ic({n,size,color})` 图标表 |
|  | `kernel/locale.js` | 718 | locale 字典 + `tr`（含 L.zh/en 全量） |
|  | `kernel/slots.js` | 77 | 5 端口治理（order/scope/canDeclare） |
|  | `kernel/ctx.js` | 29 | `DswsCtx + createCx`（8 字段冻结） |
|  | `kernel/store.js` | 695 | store/emit/cache（候选“非 UI”，此处仅统计依赖） |
|  | `kernel/api.js` | 850 | 动作/探测/命名守护（候选“非 UI”） |
|  | `kernel/actions.js` | 181 | 动作分发器 `createActionDispatcher` |
|  | `kernel/probe.js` | 627 | 探测封装（链/快照拉取） |
|  | `index.js` | 397 | 拼接母板（portalTop/PortalOverlay + 样式注入 + slots 挂载） |

> 注：`kernel/store.js`、`api.js`、`probe.js`、`actions.js` 属内核/数据层，按题面“kernel 中与 UI 相关的部分”仅将 `styles/slotRenderer/tabsfold/icons/locale/slots/ctx` 计入画像正表，其余列为依赖方。

### 1.2 画像维度

- **行数**: 实测物理行；
- **props/签名**: 导出的函数/组件签名与关键 prop；
- **外部依赖**: 细到 `store(useStore/DswsCtx/storeSvc)` / `emit` / `tr/locale` / `portalTop/PortalOverlay/createPortal` / `host.call` / `inject` / `Ic/icons` / `STYLE_TEXT` / `ResizeObserver/requestAnimationFrame` 等；
- **重复度**: 统计同类逻辑出现处数（证据见 §3）；
- **三维评分**: 独立性 × 无 store 依赖 × 可参数化，各 1–5 分，供 G3 排序。

---

## 2 画像总表（可封装候选画像）

> 评分越高越适合优先封装；`◎必含` = 首轮必含，`○候选` = 次轮候选；“—”表示该维不适用或已解耦。

### 2.1 原子/半原子控件（leaf 级，优先封装）

| # | 控件 | 文件(行数) | Props / 签名 | 外部依赖 | 重复度 | 独立性 | 无 store | 可参数化 | 轮次 |
|---|------|-----------|-------------|----------|--------|--------|----------|----------|------|
| A1 | **HoverTip 悬浮提示**（统一气泡/跟随） | `Pop.js`(65) + `SkillFloatList.js`(119) + `StatusBar.js:Tabs.js` | `showPop(trig, host, labels, title)` / `SkillFloatList({s})` / `tabsTip(e,text,priority)` + `skillTip{ x,y,name }` | `portalTop` ✅ / `DswsCtx`+store / `emit` / `tr` / `getBoundingClientRect` / 160ms 定时器 | ★★★★★ (见证据1/2/3) | 4 | 2 | 5 | **◎必含 样板** |
| A2 | **Seg 分段按钮** | `Seg.js`(8) + `StatusBar.js` | `seg(icon,label,color,onGo,title)` | `Ic` / `emit` | ★★★★ | 5 | 4 | 5 | **◎必含** |
| A3 | **Split 分割按钮** | `StatusBar.js`(.dsws-split) + `styles.js` | `{ left{icon,label,onClick}, right{icon,label,onClick} }` | `Ic` / `emit` | ★★ | 5 | 4 | 5 | **◎必含** |
| A4 | **Num 数字区** | `Seg.js`(8) | `num(txt, minW)`  `--/8` 等宽两位数 | 无（纯展示） | ★★★ | 5 | 5 | 4 | **◎必含** |
| A5 | **Chip / TypeChip / Dot** | `chips.js`(16) + `ListTab.js:chip()` + `Pop.js` chip | `Chip{name,color}` / `TypeChip{type}` / `Dot{level}` | `Ic` / `tr` / `hexA/darken` 着色 | ★★★★★ (证据4) | 5 | 5 | 5 | **◎必含** |
| A6 | **Tabs 行 + 折叠机** | `Tabs.js`(50) + `tabsfold.js`(19) + `Dock/Overlay`折叠样板 | `useTabsRow(s, tabsRef) → {items, tabsRef}` / `tabsLevelDecide(level,avail,nats)` | `DswsCtx`+store / `emit` / `tr` / `ResizeObserver` / `portalTop` (tooltip) | ★★★★ (Dock vs Overlay 各写一遍 applyFold) | 3 | 2 | 4 | **◎必含** |
| A7 | **Modal 基座**（遮罩 + 居中盒 + 队列） | `slotRenderer.js`(453) + `SwitchConfirmModal.js`(174) + `NoRepoCard` labelStep | `FormModalSeat({st})` / `openFormModal(st, action, onSubmit)` / `SwitchConfirmModal({sessionId})` | `DswsCtx`+store / `emit` / `host.call` / `portalTop` | ★★★★ (3 处弹窗 + wizard) | 3 | 2 | 4 | **◎必含** |
| A8 | **portalTop / PortalOverlay 底座** | `index.js:portalTop`(101-109) + `slotRenderer.js` | `portalTop(node) → portal` / `PortalOverlay(props, children)` | `ReactDOM.createPortal` / `document.body` | ★★★★★ (证据2) | 5 | 5 | 5 | **◎内核底座** |
| — | *小计* | 8 项 | — | — | — | — | — | — | 5+底座 必含 |

> 首轮 5 + 底座 1 = 6 个交付物，正好对应 #380 底座与 #381 HoverTip 及 Seg/Split/Chip/Modal/Tabs 的 G3 待拍优先级。

### 2.2 分子/复合控件（次轮候选，按需封装）

| # | 控件 | 文件(行数) | Props / 签名 | 外部依赖 | 重复度 | 独立性 | 无 store | 可参数化 | 轮次 |
|---|------|-----------|-------------|----------|--------|--------|----------|----------|------|
| B1 | **tagsFit 贪心 + +N** | `tagsFit.js`(31) + `ListTab.js:fitAllTags` | `fitAllTags()` 扫 `.dsws-tags .dsws-chip` | `document.querySelectorAll` / `emit` | ★★ | 4 | 4 | 4 | ○次轮 |
| B2 | **ChainRenderer**（banner/steps/actionBtn） | `ChainRenderer.js`(230) | `ChainRenderer({snapshot,dispatcher,st})` / `ActionButton({action,dispatcher,st})` | `DswsCtx`+store / `emit` / `tr` / `host` | ★★ | 3 | 2 | 4 | ○次轮 |
| B3 | **Progress / StatusBadge** | `ticket.js`(41) | `tStatus(t)`/`tProgressBar(t)`/`tStatusBadge(t)` | `tr` / `h` | ★★★ (ListTab/IssueDetail/MapDetail 三处 ring) | 5 | 5 | 5 | ○次轮 |
| B4 | **md 白名单渲染** | `md.js`(142) | `mdToHtml(md, opts)` / `mdInline(text)` | `h` / 无 store | ★ | 5 | 5 | 4 | ○次轮 |
| B5 | **BackendSelector** | `BackendSelector.js`(73) | `BackendSelector({modules,curBackendId,curSource,onPick})` | `DswsCtx`+store / `emit` / `tr` / 轻耦合 | ★★ | 3 | 2 | 4 | ○次轮 |
| B6 | **NoRepoCard / SwitchConfirm 表单** | `NoRepoCard.js`(294) / `SwitchConfirmModal.js`(174) | `NoRepoCard({st})` / 表单校验 + host `wf.initPublish/bind` | `host.call` / `store` / `tr` | ★★ | 2 | 1 | 3 | ○次轮（页面级）|

### 2.3 页面级组合（不建议单控件封装，作为消费方）

| 控件 | 文件 | 说明 | 封装建议 |
|------|------|------|----------|
| `ListTab` | 336 | 列表+过滤+排序+blocking | 保持页面，内部复用 Chip/Progress/Seg/Tabs/tagsFit/HoverTip |
| `IssueDetail / MapDetail` | 341/276 | 详情页 | 复用 md/Progress/Chip, 不单封 |
| `ChecksTab` | 222 | 链快照页 | 复用 ChainRenderer + ActionDispatcher |
| `SettingsPage` | 318 | 配置页（唯一含 settings.plugins.tab 注入） | 复用 Modal + HoverTip(鼠标跟随分支) |
| `Dock / Overlay / StatusBar` | 349/331/347 | 壳容器 | 容器保留，仅抽内部原子 |

---

## 3 五处高频重复证据（≥5 处需同效果不再各写一遍，当前已 2 套半重复）

### 证据 1 — 定位/翻转（根因：fixed 坐标 + 面板容器 clamp + 上下翻转）

- **Pop.js:30-56** — `host.getBoundingClientRect()` 取面板 rect → `maxW = pr.right-pr.left-2*pad` → `left = clamp(r.left, pr.left+pad, pr.right-pw-pad)` → `top = r.bottom+10`; 若 `top+ph > viewport-8` 则 `top=r.top-ph-10; flip=true`；caret 对应旋转 45°/225°。
- **SkillFloatList.js:14-29 / StatusBar.js:placeOverlay** — 同款 `el.getBoundingClientRect() → {bottom: innerHeight - r.top, right/left}`（锚点跟随变体），但阈值与 flip 逻辑另写一遍（StatusBar 复刻 `SkillFloatList.placeOverlay`，Diff 仅差 `align` 参数名）。
- **Tabs.js:tabsTip(238px 阈值)** — `x=e.clientX+12; if(x+238>innerWidth) x=e.clientX-12-238; y=e.clientY+12`（鼠标跟随变体，魔法数 238 独立）。
- **StatusBar bugMenu / SettingsPage hoverTip(13-15)** — 各自 160ms / 12px 偏移的第三套。
- **结论**: 同一“锚点 → 视口坐标 → 左右 clamp → 上下 flip → caret/箭头”在 4 文件 5 处各写 8–15 行，HoverTip 统一后可删 ~70 行。

### 证据 2 — 挂顶 portal（根因：宿主祖先 transform/filter 导致 fixed 失效）

- **index.js:101-109 `portalTop`** — 闭包内 `RDOM.createPortal(node, document.body)`，取不到则原地退化；注释指明 transform/filter 祖先陷阱。
- **slotRenderer.js:461 `portalTop(overlayNode)`** — Modal 遮罩显式再包一层 `portalTop`（与 index 复刻逻辑同注释 “避免被面板裁剪（与 issue #3 同理）”）。
- **SkillFloatList.js:91 `PortalOverlay` + 117 `portalTop`** — 同一面板内既用 `PortalOverlay({style:{position:fixed, right,bottom}})` 又用 `portalTop` 渲染 tooltip，两套入口。
- **StatusBar.js:220 `PortalOverlay`** — bugMenu/skillPop 均走 `PortalOverlay`，与 SkillFloatList 复刻同样式 `{position:fixed, zIndex:2147483000}`。
- **重复度**: 4 文件 6 调用点，portal 常量 `2147483000`、`document.body` 守卫、RDOM 取法各写一遍；抽 `kernel/portal.js` 底座后统一。

### 证据 3 — 悬浮时序/重定位（根因：scroll/resize/ResizeObserver → 重算 → emit）

- **SkillFloatList.js:36-80** — `clearClose/scheduleClose(160ms)` 定时器 + `useEffect([s.skillsOpen]) → addEventListener(scroll,capture)+resize+ResizeObserver(reposition)` + raf 节流。
- **StatusBar.js: 同款** — `bugAnchorRef/bugCloseRef + skillAnchorRef/skillCloseRef` 两套并列，`clearClose/scheduleClose` 文本级复刻（含 160ms 幻数）。
- **SettingsPage.js: hoverTip** — 鼠标跟随无 ResizeObserver，仅 `clientX/Y` 偏移，关时无延迟，属“半套”（证实 G1 需拍“鼠标跟随 vs 锚点跟随”双分支）。
- **Tag fit 轮询** — ListTab tagsFit 另起 `ResizeObserver + window.resize + document.fonts.ready` 的第三类重定位（同“尺寸变就重算”语义）。
- **结论**: “打开→监听→重定位→emit→清理”五步在 3 容器各写 30 行，HoverTip 内聚后可复用。

### 证据 4 — Chip 着色/边框（根因：hexA + darken + label 动态色）

- **chips.js:TypeChip** — `class dsws-chip-{r/p/g/t/m} + Ic`，色来自 `TYPE_LABEL`，静态。
- **ListTab.js:chip() / StatusBar seg** — 动态 `background: hexA(c,0.18) ; border: 1px solid darken(c,0.16)`，`c` 取 `snapshot.labels[].color` 或票面 `l.color`。
- **Pop.js:18-21** — 同款 `hexA/darken` 再写一遍，且 fallback `rgba(188,140,255,.16)` 魔法值重复。
- **NoRepoCard/ChainRenderer** — `rgba(... .08/.12/.16)` 透明度 3 档各文件自定，无 token。
- **结论**: 着色两函数 + 三档透明度在 4 文件 5 处硬编码，抽 `Chip` 后统一 `variant + colorToken`。

### 证据 5 — Tabs 折叠（根因：priority 优先级 + clamp → collapsed）

- **tabsfold.js:tabsLevelDecide(level,avail,nats)** — 纯函数已抽，但消费侧未统一：**Dock 与 Overlay 各复制 30 行 `applyFold()`**（`querySelectorAll('[data-priority]') → 排序 b.p-a.p → scrollWidth 溢出判定 → collapsed`），历史注释“T3 tabs 行改用共享 Tabs.js”后仍留两份。
- **Tabs.js:useTabsRow** — 共享 `tabBtn(priority)` 与 `tabsTip`，但折叠逻辑仍在容器侧（Dock/Overlay）而非 hook 内。
- **ListTab tagsFit** — 贪心折叠与 tabs 折叠同属“宽度不足→隐藏”同一范式（贪心 vs 优先级），可共享 `measureContentWidth`。
- **结论**: 折叠状态机已纯函数化，未“上移到 hook”导致两容器仍各写一遍；HoverTip/Chip 之后第三优先收敛。

> 以上 5 证据合计覆盖 **9 文件 18 处**，保守可删重复 180–260 行，符合 #373“5 处及以上不再各写一遍”阈值。

---

## 4 封装候选画像（按三维评分展开）

### 4.1 HoverTip — 必含样板（本票 G1/G2 首要）

- **现状对照**: 两套样板 — A: `Pop.js` imperative DOM（`document.createElement` + `appendChild(pop)→measure→flip`，无 React, 无 store，但强耦合 `tr/hexA/darken`）；B: `SkillFloatList + StatusBar` React 锚点（store 驱动 `s.skillPopPos`，`PortalOverlay + Refs + 160ms`）。SettingsPage 另有鼠标跟随 C 半套。
- **三维**: 独立性 4 (纯定位可抽) / 无 store 2 (现两套均绑 store/emit) / 可参数化 5 (锚点/鼠标/trigger 三分支可参化)。
- **契约草案** (供 G2 定版):
  ```js
  HoverTip({
    anchorRef | targetRect,   // 锚点 ref 或 followMouse {x,y}
    hostRef,                  // clamp 基准（面板容器），缺省 viewport
    placement: 'top'|'bottom'|'auto',  // auto=当前 flip 语义
    offset: 10,               // gap
    flip: true,               // 越界翻转
    delayOpen: 0, delayClose: 160,   // 时序
    portal: true,             // 走 portalTop 底座
    children,                 // 内容（Chip list / skilldesc 等）
  })
  ```
- **迁移点**: `Pop.js showPop → HoverTip`, `SkillFloatList`, `StatusBar bugMenu+skillPop`, `Tabs.js tabsTip`, `SettingsPage tip`（5 处）。
- **验收**: 定位快照（flip 前后坐标）、挂顶截图（被裁剪对比）、时序单测（160ms 清理）。

### 4.2 Seg / Split / Num — 状态栏原子

- **现状**: `Seg.js` 仅 8 行（`num/seg` 原语），`Split` 尚散在 StatusBar + STYLE_TEXT (`.dsws-split` + `.dsws-split-div`)，`Num` 等宽 `5ch` 在 `styles.js .dsws-num`。
- **三维**: 各 5/4-5/5，无 store，props 即全量。
- **契约**: `Seg {icon,label,color,onClick,title}` / `Split {left,right, divider}` / `Num {value,minW}`，样式走 kernel/styles token，不自带魔法色。

### 4.3 Chip / Dot / TypeChip — 标签徽章

- **现状**: `chips.js` 16 行最干净（无 store 的纯展示），但 ListTab/Pop 另起动态着色；`trow` 等处直接拼 `dsws-chip` class。
- **三维**: 5/5/5，最适合首轮第二批。
- **契约**: `Chip {label,color,variant, size}` / `Dot {level}` / `TypeChip {type}`，着色经 `hexA/darken` token 收敛（G2 定 `alpha 0.18 / borderDarken 0.16`）。

### 4.4 Modal（含 FormModalSeat + wizard）

- **现状**: `slotRenderer.js` 453 行已成“准组件”（队列、wizard 分步、校验、提交→dispatch），但强耦合 `store.formModal`；`SwitchConfirmModal` 174 行是定制 Modal（picker + 三选一 + CRI）；NoRepoCard 标签指引亦为 Modal。
- **三维**: 3/2/4，需先抽“无 store 的 Modal 基座(遮罩+居中+portal+ESC+队列)”再叠 Form 层。
- **分层**: `Modal` (基座) → `FormModal` (slotRenderer 迁入) → `ConfirmModal` (SwitchConfirm 定制)，G2 需定 `kind: list vs single` 与 `scope` 是否透出。

### 4.5 Tabs 行（含折叠机）

- **现状**: `Tabs.js 50 行` (`useTabsRow` 已共享按钮与 tooltip)，但折叠仍在 Dock/Overlay 容器；`tabsfold.js 19 行` 纯函数待上移。
- **三维**: 3/2/4，store 依赖仅 `s.tab`，可参化为 `value/onChange` 受控。
- **契约**: `Tabs {value,onChange, items:[{id,icon,label,priority}], extra:[wayfinder/bug/refresh], showVersion}`，内部消化 `tabsLevelDecide` + `ResizeObserver`。

### 4.6 次轮 6 项简画像

| 候选 | 为何次轮 | 关键参化点 |
|------|----------|------------|
| B1 tagsFit | 贪心算法已纯（31 行），但依赖 DOM 测量，需先有 HoverTip/Chip | `fitAllTags(container, selector) → {shown, hidden}` |
| B2 ChainRenderer | 230 行复合，强耦合 dispatcher/host，若首轮未定 action 词汇表则接口不稳 | `{snapshot,dispatcher}` 受控，banner 42px 互斥保留 |
| B3 Progress | 41 行纯函数，三处 ring 重复但无 store，已可随时抽 | `Progress {value,max,color} / StatusBadge {status}` |
| B4 md | 142 行纯渲染，无复用压力，独立性满分但优先级低 | `Md {source, single}` 白名单不变 |
| B5 BackendSelector | 73 行轻耦合 store，涉及 confirm 闸门（B2 依赖） | `{modules,value,source,onChange, includeOther}` |
| B6 NoRepoCard/SwitchConfirm | 页面级表单，业务耦合深，适合最后收敛 | 保持页面，仅复用 Modal+Chip 内部 |

---

## 5 首轮必含与次轮候选划分

### 5.1 首轮必含（G3 试点，#380/#381 直接可用）

| 优先级 | 控件 | 形态 | 行数(去重后预估) | 产线落点 |
|--------|------|------|------------------|----------|
| P0 底座 | **portalTop / PortalOverlay** | `kernel/portal.js` | 现 15 行 → 底座 40 行(含 RDOM 探测+body 守卫) | #380 |
| P0 样板 | **HoverTip** | `shared/HoverTip.js` (锚点+鼠标双分支) | 65+119 → 90 行 | #381 主迁移 |
| P1 原子 | **Chip / Dot / TypeChip** | `shared/Chip.js` | 16 → 60 行(含动态着色) | #381 附带 |
| P1 原子 | **Seg / Split / Num** | `shared/Seg.js` 扩展 | 8 → 50 行 | #381 附带 |
| P1 半原子 | **Modal 基座** | `shared/Modal.js` (+ slotRenderer 拆层) | 453 拆 → 基座 80 行 | #381 |
| P1 半原子 | **Tabs** | `shared/Tabs.js` 收敛折叠 | 50+19 → 70 行 | #381 |

> 判定线（供 #375 复用阈值引用）: **独立性≥3 且 可参数化≥4 且 (无 store≥2 可经受控 props 解耦)** 即入首轮；Hit 5 项恰好覆盖证据 1-5 的全部根因。

### 5.2 次轮候选（G3 第二波，按需择一）

按**复用收益/耦合成本**排序：

1. **Progress/StatusBadge** (B3) — 零耦合、立即可抽，作为首轮后“热身”。
2. **tagsFit** (B1) — 依赖 Chip 完成度，ListTab 立即可省 31 行。
3. **ChainRenderer** (B2) — 待动作词汇表冻结后抽（依赖 #217 契约）。
4. **md** (B4) — 纯函数，随用随抽，无阻塞。
5. **BackendSelector** (B5) — 涉及后端能力，需与 SettingsPage/StatusBar 联调。
6. **NoRepoCard 表单** (B6) — 页面级，最后收敛。

### 5.3 不封装

- `index.js` 拼接母板、`store.js/api.js/probe.js` 数据层、`locale.js` 字典、`slots.js` 五端口治理 — 保持内核，不作控件。
- `Dock/Overlay/StatusBar/ListTab` 等页面/容器 — 作为控件消费方，不单封。

---

## 6 底座抽离建议（portalTop → kernel）

- **现状**: `index.js:101-109` 闭包内 `portalTop` + `PortalOverlay`（尝试 ReactDOM → window.ReactDOM → require('react-dom') 三级退化，取不到原地渲染）。
- **建议落点**: `src/client/kernel/portal.js`（与 `ctx.js` 同级），导出 `portalTop(node)` + `PortalOverlay`，由 `index.js` 通过 build 拼接注入（同 `styles` 模式，一源两物）。
- **契约**: `portalTop(node): ReactNode` — 有 RDOM+body 则 `createPortal`，否则原样；`PortalOverlay(props, children)` — `portalTop(h('div', props, children))` 糖。
- **收益**: 4 文件 6 调用点收敛，zIndex `2147483000` 与 RDOM 探测单点配置，后续 HoverTip/Modal 均经此底座，杜绝“面板内裁剪”回归。

---

## 7 证据索引与行号（供 G1/G2 复核）

| 证据 | 一手位置 | 对照位置 | 关键行/片段 |
|------|----------|----------|-------------|
| 定位/翻转 | `Pop.js:30-56` | `SkillFloatList:14-29`, `Tabs:tabsTip`, `StatusBar:placeOverlay` | `getBoundingClientRect → clamp → flip → border rotate` |
| 挂顶 | `index.js:101-109` | `slotRenderer:461`, `SkillFloatList:91,117`, `StatusBar:220` | `RDOM.createPortal(document.body)  vs  原地退化` |
| 时序/重定位 | `SkillFloatList:36-80` | `StatusBar bugMenu` 同款, `SettingsPage tip`, `tagsFit + font.ready` | `scheduleClose 160ms + scroll/resize/ResizeObserver + raf` |
| Chip 着色 | `Pop.js:18` / `chips.js:TypeChip` | `ListTab:chip()`, `NoRepoCard` | `hexA(l.color,0.18) / darken 0.16 / rgba(188,140,255` |
| Tabs 折叠 | `tabsfold.js` 19 行 | `Dock.applyFold` vs `Overlay.applyFold` 各 30 行 | `data-priority 排序 b.p-a.p → scrollWidth>clientWidth → collapsed` |

---

## 8 给 G1/G2/G3 的引用清单

- **G1 #376 封装边界与目录落位**: 采用 §2.1 6 项 + §2.2 6 项的原子/分子/页面三级；目录建议 `src/client/shared/{HoverTip,Chip,Seg,Modal,Tabs}.js`（与现有 `shared/*` 同级），内核底座 `kernel/portal.js`；命名沿用「人类第一次读就能懂」— 不造缩写（HoverTip 而非 Tip/Pop）。
- **G2 #377 接口与挂载契约**: 复用 §4.1/4.4/4.5 的受控 props 草案；挂载统一走 `portalTop` + `kernel/styles STYLE_TEXT` token；五端口 `modal-seat` 保持 single 队列语义，D7 零 import 约束。
- **G3 #378 首批试点选型与优先级**: 按 §5.1 P0→P1 顺序，HoverTip 样板先行验证“锚点 vs 鼠标”双分支（原型见 #379），余 4 原子随迁，最小可验证闭环 = `HoverTip → PortalOverlay → portalTop` 三件套。

---

## 9 方法与复现

```pwsh
# 行数盘点
Get-ChildItem -Recurse -File src/client | ForEach-Object {
  $l=(Get-Content $_.FullName | Measure-Object -Line).Lines
  "{0,4} {1}" -f $l, $_.FullName.Replace((Get-Location).Path+"\","")
} | Sort-Object

# 重复对照
Select-String -Path src/client/**/*.js -Pattern "placeOverlay|skillPopPos|getBoundingClientRect"
Select-String -Path src/client/**/*.js -Pattern "portalTop|PortalOverlay|createPortal"
Select-String -Path src/client/**/*.js -Pattern "hexA|darken.*0\.16"
Select-String -Path src/client/**/*.js -Pattern "data-priority.*collapsed|tabsLevelDecide"
```

---

## 10 落盘与链接

- 本文件: `_research/reuse-inventory.md`（分支 `research/reuse-inventory`）
- 父票: #373 · 子票: #374(R1) 本票 · #375(R2) 待研阈值 · #376(G1)/#377(G2)/#378(G3) 待 grill · #379(P1) 原型 · #380(T1) 底座 · #381(T2) 首批落地

> 只做研究，不改业务代码；后续变更以未来定版为准（见 CONTEXT.md 版本与效力 2026-08-28 基线）。
