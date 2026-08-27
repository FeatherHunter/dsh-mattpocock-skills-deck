# #290 研究：前端顶部 Tab 体系与动态增页可行性（含 Tabs.js 硬编码现状、折叠滞回与 store 响应式）

> Issue #290 | Branch `research/290-tabs-dynamic` | Date 2026-08-28 | Author: Research 子代理
> Parent #288 | 依赖：`src/client/views/shared/Tabs.js`、`src/client/panel/Dock.js`、`src/client/kernel/tabsfold.js`、`src/client/kernel/store.js`

## 0. 结论先行（供选型直接使用）

**支持动态增页，但必须放弃 Tabs.js 的硬编码分支，改为能力门控的动态列表**。可行性为高，成本为低（3 文件 + 1 样式分支，约 30 行）。推荐路径为 **A 独立 PR Tab 并列于 list/skills/checks**，而非 B 列表内混入。原因是 PR 是跨后端能力差异最敏感的资源（GitHub 有、Markdown/Other 无），独立 Tab 能复用现有的 `s.tab` 路由分支、状态隔离与窄屏折叠机器，而混入列表会把状态过滤、排序、标签 chips 与 PR 筛选耦合。

能力门控信号不要硬编码 `backend === 'github'`，而是用 `"tracker 是否在当前工作区返回了 PR 资源"` 这一运行时探测结果：优先复用宿主已有的 `snapshot.selection / snapshot.repository` 权威信号，外加一个可选的 `snapshot.prSummary` 或 `host.call('tracker.capability', {cwd, kind:'pullRequest'})` 的轻量探测，返回存在即显 Tab，不存在即藏，切换工作区时跟随 `s.selection.backendId` 变化自动显隐。

新增 1 个 Tab 后现有的溢出折叠测量仍稳定，风险可控，前提是把新增 Tab 的 `priority` 插到现有 4-6 之间或复用 6 之后，并修正 `measureContentWidth` 与 `TABS_FOLD_HYST` 的交互边界（见 §3）。

---

## 1. 硬编码现状盘点

### 1.1 `Tabs.js`：三 Tab 写死 + priority 贪心折叠

文件 `src/client/views/shared/Tabs.js:8-49`：

```js
export const useTabsRow = function (s, tabsRef) {
  const tabBtn = (id, icon, label, priority) => h('button',
    { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority,
      onClick: function(){ s.tab=id; emit(s); if(!snapFresh(s)) loadSnapshot(s,false) } }, …)
  const items = [
    tabBtn('list','list', tr('panel.tabList'), 4),
    tabBtn('skills','compass', tr('panel.tabSkills'), 5),
    tabBtn('checks','gear', tr('panel.tabChecks'), 6),
    h('span',{style:{flex:1}}),
    // 动作按钮区
    h('button',{'data-priority':2}, …), // wayfinder 紫描边
    h('button',{'data-priority':1}, …), // newBug 红描边
    h('button',{'data-priority':3}, …), // refresh
    h('span',{className:'dsws-ver'}, DSW_VERSION),
  ]
  return {tabsRef, items}
}
```

- **硬编码点**：三 Tab 的 `id/icon/label/priority` 在 `items` 数组字面量内固定写死，未接受外部配置或能力注入。新增 Tab 必须改此文件。
- **优先级语义**：数字越大越不重要，折叠时从大到小逐个加 `collapsed`。现有分配是：
  - `1 = newBug`（最重要，红描边，最后才折叠）
  - `2 = newWayfinder`
  - `3 = refresh`
  - `4 = list`、`5 = skills`、`6 = checks`（最不重要，最先折叠）
- **滞回**：本文件内未使用 `TABS_FOLD_HYST` 常量，实际折叠由 `Dock.js` 与 `Overlay.js` 的 `applyFold()` 贪心实现，见 §1.3。

### 1.2 `Dock.js` / `Overlay.js`：响应式容器与宽度记忆

`src/client/panel/Dock.js:10-248`（`DetailsDock`）：

- **store 响应式**：`const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)`（`Dock.js:21`），其中 `useStore` 来自 `src/client/kernel/store.js:556-561`：`React.useState` 订阅 `st.subs`，`emit(st)` 触发 `tick++` 重渲染。`s.tab` 是 `makeStore()` 的普通字段（`store.js:412: tab:'list'`），写入后 `emit(s)` 即可驱动 Tab 切换，无持久化到 `localStorage`（切换工作区后回到默认值 `list`）。
- **宽度 300-520**：注释 `Dock.js:8-9` 说明 300-520px 可拖拽，本实现用 `ResizeObserver` 监听 `dockRef` 并写入 `dw`（`Dock.js:26-34`），窄阈值为 `dw < 380` 时加 `dsws-narrow` 类（影响 ListTab 的芯片折叠与按钮纯图标回退）。
- **头部自适应**：`headRef` 监听 `measureContentWidth(hd) <= hd.clientWidth`（`Dock.js:198-200`），三阶段退化：完整 `owner/name` → 隐藏标题 → 仅 `name` → `flex:0 1 auto` ellipsis。
- **Overlay 复用**：`src/client/panel/Overlay.js:7-15` 用同样 `useTabsRow(s, tabsRef)` 与同样的 `applyFold()`，容器为悬浮面板 `s.size.w`，逻辑同 Dock。

### 1.3 溢出折叠实现：两套机器并存

#### 机器 A：内核纯函数 `tabsfold.js`（当前未被 Dock 调用）

`src/client/kernel/tabsfold.js:10-30`：

```js
export const TABS_FOLD_HYST = 4
export const TABS_LEVELS = 3
export function tabsLevelDecide(level, avail, nats){ … }
  while(cur < nats.length-1 && nats[cur] > avail+1) cur++
  while(cur > 0 && avail >= nats[cur-1] + TABS_FOLD_HYST) cur--
```

设计为 3 档：0 全显、1 动作按钮转图标、2 Tab 也转图标，靠 `avail` 与 `nats[cur]` 的 1px 容差与 4px 滞回防抖。以 `src/client/index.js:223-245` 的 `measureContentWidth(t)`（取 `children` 的 `getBoundingClientRect` 横跨宽，避免 `scrollWidth` 被容器钳制死锁）判定自然宽。

**现状是该叶子是阶段 1 的测试基准，Dock/Overlay 尚未 import，真实折叠走机器 B**。

#### 机器 B：Dock/Overlay 内联贪心（真实生效）

`src/client/panel/Dock.js:140-185` 与 `Overlay.js:16-61`：

```js
const applyFold = function(){
  const btns = t.querySelectorAll('[data-priority]')
  t.classList.add('dsws-no-anim')
  for(btn of btns) btn.classList.remove('collapsed'); ver.classList.remove('collapsed')
  void t.offsetWidth // 强制 reflow 拿基准
  const items = Array.from(btns).map(b=>({el:b, p:Number(b.dataset.priority)})).sort((a,b)=>b.p - a.p)
  for(it of items){ if(t.scrollWidth <= t.clientWidth+1) break; it.el.classList.add('collapsed'); void t.offsetWidth }
  if(refreshCollapsed) ver.classList.add('collapsed')
  t.dataset.tabsLevel = String(querySelectorAll('.collapsed').length)
  t.classList.remove('dsws-no-anim')
}
```

监听 `ResizeObserver(tabsRef) + window.resize + document.fonts.ready`。无滞回带，仅靠 `scrollWidth <= clientWidth+1` 一次性贪心，靠 `dsws-no-anim` 禁用 `max-width` 过渡避免测量抖动。

---

## 2. 可观测信号：无需新增全局状态即可驱动显隐

### 2.1 store 真源

`src/client/kernel/store.js:411-432`  的 `makeStore()` 字段：

| 字段 | 类型 | 来源 | 用途 |
|---|---|---|---|
| `s.tab` | `'list'|'skills'|'checks'|未来'prs'` | 本地写入 `emit(s)` | 路由分支 |
| `s.snapshot` | 对象或 null | `loadSnapshot` 写入 + `applySnapshotSelection` | 权威后端与 PR 资源 |
| `s.selection` | `{backendId, source, ref, multiHit?, pending?}` | `snapshot.selection` + per-cwd 缓存 `selectionByCwd` | 后端身份 |
| `s.repository` | `RepositoryRef {backend,name,url}` | `snapshot.repository` + per-cwd 缓存 | 仓库身份 |
| `s.backendModules` | 数组或 null | `snapshot.backendModules` | presentation 颜色与品牌 |
| `s.cwd` | string | `getCwdSync(sid)` + `loadSnapshot` | 工作区键 |

### 2.2 已可直接使用的门控信号（按优先级推荐）

**信号 1（权威）：`s.selection.backendId`**

`Dock.js:131,237-241` 已有使用：

```js
const _sel = s.selection || (s.snapshot && s.snapshot.selection) || null
const bid = sel ? sel.backendId : null
```

`pending=true` 时为探测中（`Dock.js:132`），`backendId===null && !_sel.pending` 为 Other 逃生舱（`_isOther`）。切换工作区时 `useEffect([sid, summaryCwd])` 会同步 `s.cwd` 并触发 `loadSnapshot(s)`，`applySnapshotSelection` 会把 `snapshot.selection` 回写 `s.selection` 并 `emit`，Tabs 的显隐因此自动跟随，无需新全局状态。

**信号 2（更稳妥）：`s.snapshot.repository` 与 `s.backendModules`**

`store.js:475-504` 的 `applySnapshotSelection` 已做可疑 fallback 保护：若快照是 `backendId:null + source:fallback` 的 transient 空，保留旧 `s.selection`。`s.repository.backend` 与 `s.snapshot.repository.backend` 同源，可做二次校验。

**信号 3（推荐新增的 PR 能力探测，非硬编码 backend 名）**

不要写 `bid === 'github'`。建议宿主在 `buildSnapshot(cwd)` 中对当前 backend 的 `tracker` 模块做一次轻量能力探测（例如 `host.call('tracker.capability', {cwd, kind:'pullRequest'})` 或在 `snapshot` 中追加 `prs` / `pullRequests` 数组字段），client 侧仅判断 `Array.isArray(s.snapshot.prs) || s.snapshot.pullRequests` 是否存在或 `snapshot.capabilities.pullRequest === true`。这样 Markdown/Other 后端自然返回空或 missing，UI 按空值分支不渲染 PR Tab，符合 `CONTEXT.md` 定义的 `capability-by-fill` 与 `操作能力=G5 调用即知`。

当前快照形状中尚未出现 `prs`，需新增契约字段（见 §5）。

### 2.3 响应式路径

`s.tab` 与 `s.selection` 同属一个 store 对象，任何写入后 `emit(s)` 会使 `DetailsDock` 与 `OverlayPanel` 同时重渲染（两者都 `useStore(sid)`）。Tabs 行的显隐判定应在渲染期计算：

```js
const showPrTab = canShowPrTab(s) // 读 s.selection + s.snapshot.prs
// Tabs.js 内部：if(showPrTab) items.push(tabBtn('prs', …))
// Dock.js 路由：s.tab==='prs' ? h(PrTab,{st:s}) : …
```

注意：若当前 `s.tab==='prs'` 且切换到不支持 PR 的工作区，应自动回退 `s.tab='list'`，逻辑可在 `applySnapshotSelection` 后或 `useEffect([s.selection])` 中做一次：

```js
if(s.tab==='prs' && !canShowPrTab(s)){ s.tab='list'; emit(s) }
```

---

## 3. 溢出折叠与新增 1 Tab 后的稳定性

### 3.1 稳定性结论：稳定，但需补一档 priority

现有 7 个带 `data-priority` 元素（3 Tab + 3 动作 + 刷新归一为 priority 3，与版本号联动）。贪心算法时间复杂度 O(n log n)（n=7），新增 1 Tab 后 n=8，测量一次 `scrollWidth` + 至多 8 次 `offsetWidth` reflow，性能无影响。

稳定性依赖的两个细节：

- **正向折叠稳定**：从全展开基准开始，按 priority 降序逐个 `collapsed` 直到 `scrollWidth <= clientWidth+1`。新增 Tab 只要有明确 priority，就会被正确纳入排序，阈值行为线性扩展。
- **反向展开当前无滞回**：Dock 内联实现没有 `TABS_FOLD_HYST`，窗口从窄拉宽时会在 `scrollWidth === clientWidth` 临界反复横跳 1px（机器 B 的容差仅 1px）。内核的 `tabsLevelDecide` 用 4px 滞回解决抖动，但未接入。新增 Tab 会让该抖动概率略升（多一个临界点），但不会死锁，因为每次展开前都会 `remove('collapsed')` 重测基准。

### 3.2 与 `measureContentWidth` / `TABS_FOLD_HYST` / `dw` 宽度的交互

- **measureContentWidth** 仅用于头部 `headRef`（repo 芯片），tabs 行用 `scrollWidth`。头部测量取 children 的 `getBoundingClientRect` 横跨，避免 `scrollWidth` 被 flex 钳制，与 tabs 折叠无关，不会因新增 Tab 而失效。
- **TABS_FOLD_HYST = 4**（`tabsfold.js:11`）若未来把 Dock 的一次性贪心改为三档 `tabsLevelDecide`，则需把新增 Tab 的自然宽算入 `nats[level]`，否则档位误判。短期保持贪心机器不变即可，无需改动。
- **Dock 宽度 300-520 与窄阈 380**：`dw<380` 时加 `dsws-narrow`，影响 ListTab 的 `fitAllTags` 与按钮纯图标（`ListTab.js:34-66` 的 `fitMapRows` 监听 `dsws-panel` 的 ResizeObserver）。tabs 行的折叠阈值与 `dw` 无关，仅与 `tabsRef.clientWidth` 相关，故拖拽 Dock 宽度时 tabs 会跟随正确重算（已监听 `ResizeObserver(tabsRef)`）。

### 3.3 priority 分配建议

复用现有 4-6 区间的下一个整数：

| 元素 | 建议 priority | 说明 |
|---|---|---|
| newBug | 1 | 最高，保留 |
| newWayfinder | 2 | 次高，保留 |
| refresh | 3 | 中高，保留 |
| list | 4 | 高 |
| skills | 5 | 中 |
| checks | 6 | 低 |
| **prs (新增)** | **7** | 最低，最先折叠 |

或把 PR 插到 5 与 6 之间（priority 5.5→6，原 checks 升至 7），让 PR 比环境检查更重要。两种均可，关键是保持唯一且可排序，CSS 中 `.dsws-tab.collapsed span{display:none}` 与 `.dsws-btn.collapsed span{…}` 已支持纯图标回退，新增 Tab 自动继承。

---

## 4. 两条路径对比：A 独立 PR Tab vs B 列表内混入

### 4.1 总览表

| 维度 | A 独立 PR Tab（与 list/skills/checks 并列） | B 列表内混入（筛选/分区） |
|---|---|---|
| **复用度** | 高：复用 `s.tab` 路由、`useTabsRow` 渲染分支、`loadSnapshot` 触发、面板持久化（无需新持久化键） | 中：复用 ListTab 的 chips/排序/过滤管线，但需新增 PR 筛选状态（`stateFilter` 扩展或新 `prFilter`），并与标签过滤正交，易耦合 |
| **状态隔离** | 高：`s.tab==='prs'` 独占视口，`s.activeMap/s.activeIssue` 互斥逻辑（`store.js:217-231`）可平移为 `s.activePr`，与 maps/issues 互斥清晰 | 低：同一视口内混排 issues 与 PRs，滚动、选中、详情回退（`clearActiveIssue`）需区分 `type`，状态机分支增多 |
| **后端切换显隐一致性** | 高：门控在 Tabs 渲染期计算，切换工作区时 `applySnapshotSelection` 回写后一次 `emit` 即显隐，回退 `list` 逻辑集中一处 | 中：列表内需在每次渲染时把 PR 行过滤掉（无能力时不渲染），但空态与"无 PR"空态文案需二选一，显隐散落在 `filteredOpen` 计算中，易遗漏 |
| **priority 分配** | 高：新增 priority 7，折叠机器直接生效，窄屏纯图标回退自动继承 tooltip 门控（`tabsTip` 仅在 `collapsed` 时显示） | 无：复用现有 Tab 的 priority，PR 筛选控件需自行处理窄屏折叠（chips 行已有 `fitAllTags`，但 PR 分区标题无现成折叠） |
| **窄屏纯图标回退** | 高：`collapsed` 类已对 `.dsws-tab` 与 `.dsws-btn` 生效，PR Tab 在 <360px 时自动变图标，版本号随 refresh 联动隐藏 | 低：列表内 PR 分区在窄屏下仍占纵向空间，需额外 `@media` 或 `ResizeObserver` 处理，ListTab 已有三套监听（tags/rows/head），再加则复杂度叠加 |

### 4.2 路径 A 细节（推荐）

**前端**：`Tabs.js:28-31` 新增 `tabBtn('prs','git-pull-request', tr('panel.tabPrs'), 7)`（icon 复用 `icons.js` 的 `pullRequest` 或新增）。`Dock.js:336-338` 路由分支新增 `s.tab==='prs' ? h(PrTab,{st:s}) : null`。新建 `src/client/views/PrTab.js` 叶子（同 `ListTab.js` 隔离约束，禁止 import 其他视图，仅经 `DswsCtx` 取 `store/api`）。

**后端**：在 `host/src/host/index.js` 的 `buildSnapshot` 中为当前 backend 的 tracker 追加 `prs` 拉取（GitHub 用 `gh pr list` 或 GraphQL `pullRequests`，Markdown 返回空数组），组装到快照 `{..., prs:[], prsTotal}`。

**优势**：与现有 `MapDetail` / `IssueDetail` 的 `activeMap/activeIssue` 三态互斥同构（`store.js:217-231`），可新增 `activePr` 与 `setActivePr`，详情页复用 `IssueDetail` 的 `fetchIssueDetail` 管道（仅换 endpoint）。

### 4.3 路径 B 细节（备选，仅当 PR 量极小且不需独立详情时考虑）

在 `ListTab.js:68-150` 的 `openRows` 计算后插入：

```js
const prs = (st.snapshot && Array.isArray(st.snapshot.prs)) ? st.snapshot.prs : []
const showPrs = canShowPrTab(s) && prs.length
const mixedRows = showPrs ? prs.concat(openFiltered) : openFiltered // 分区或混排
```

筛选可用 `st.stateFilter` 新增 `'prs'` 档位，或新增 `st.prFilter` 独立于标签过滤。标签统计 `stat` 需合并 PR 的 labels，排序 `sortIssues` 复用。

**劣势**：PR 与 Issue 共享 `labelClicks` 持久化与 `lblFilters`，语义混淆；PR 详情需在同一列表视口内以内联展开或复用 `IssueDetail`，与 `activeMap` 的互斥关系需额外分支；后端切换时列表空态需区分"无 Issue"与"无 PR 能力"，文案易错。

---

## 5. 最小改动点位清单

### 5.1 Tabs 渲染分支

- `src/client/views/shared/Tabs.js:28-31`：把 `items` 改为动态：

  ```js
  const showPr = canShowPrTab(s) // 读 s.selection + s.snapshot
  const base = [tabBtn('list',…4), tabBtn('skills',…5), tabBtn('checks',…6)]
  if(showPr) base.splice(1,0, tabBtn('prs','pullRequest', tr('panel.tabPrs'), 7))
  const items = [...base, h('span',{style:{flex:1}}), wayfinderBtn, bugBtn, refreshBtn, ver]
  ```

  若暂时不想改 `Tabs.js` 真源，可在 `Dock.js` 中对 `tabs.items` 做后处理（splice），但会破坏单真源约束，不推荐。

### 5.2 Dock 路由分支

- `src/client/panel/Dock.js:336-338`：

  ```js
  s.tab==='list' ? (active ? h(MapDetail…) : hasIssueDetail ? h(IssueDetail…) : h(ListTab…)) : null,
  s.tab==='skills' ? h(SkillsTab…) : null,
  s.tab==='checks' ? h(ChecksTab…) : null,
  s.tab==='prs' ? h(PrTab,{st:s}) : null,
  ```

  同步改 `src/client/panel/Overlay.js:101-103` 的相同分支（两处需一致，build 脚本会从 `Dock.js` 真源 splice 到 `index.js`）。

- `src/client/kernel/store.js:412`：为 `activePr` 新增状态机（同 `activeMap/activeIssue`）：

  ```js
  export const setActivePr = function(st,n){ st.activePr = n!=null?Number(n):null; if(st.activePr!==null){st.activeMap=null; st.activeIssue=null} emit(st) }
  export const clearActivePr = function(st){ st.activePr=null; emit(st) }
  ```

  并在 `makeStore` 中初始 `activePr:null`。

### 5.3 状态持久化

- `s.tab` 当前无持久化，切工作区后回 `list`。若需跨会话记忆 PR Tab 偏好，可新增 `localStorage` 键 `dsws.tabPrefs`（同 `ListTab` 的 `listPrefs` 模式 `store.js:13-22`），但非必需。推荐先不持久化，保持现状（切换不支持 PR 的工作区自动回退 `list` 已足够）。
- PR 筛选若独立，需新增 `st.prStateFilter` 与 `st.prSortKey`，持久化同 `listPrefs`，但路径 A 下 PrTab 内部自持即可，无需全局。

### 5.4 契约与宿主

- 快照新增字段：`snapshot.prs: Array<{number,title,state,author,labels,url}>` 与 `snapshot.prsTotal: number`，或统一为 `snapshot.pullRequests`。shape 定义在 `src/shared/tracker/shape.js`（若存在）或 `docs/architecture/tracker-backend-design-contract.md`。
- 宿主 `buildSnapshot` 中按 `selection.backendId` 分发拉取，Markdown/Other 返回空数组，GitHub 走 `gh pr list --limit 100`（复用现有 `fetchIssues` 的 gh 调用模式）。

---

## 6. 能力门控信号推荐（不硬编码 github）

**推荐信号栈（按优先级）**：

1. `snapshot.prs !== undefined`（或 `snapshot.capabilities.pullRequest === true`）—— 最直接的运行时能力探测，有即显。
2. `s.snapshot.repository.backend` 存在且 `s.backendModules.find(m=>m.id===bid).capabilities.includes('pullRequest')` —— 若后端模块声明了能力表，可读表（但违背 CONTEXT 的"无能力表、调用即知"原则，故仅作降级）。
3. `s.selection.backendId !== null && !s.selection.pending` —— 只要有明确后端且非 Other/pending，就尝试拉取，空数组即空态，不隐藏 Tab（适合 PR 为通用能力的假设，但与 Markdown 不符，故不推荐单独使用）。

**实现**：

```js
// src/client/kernel/store.js 或 Tabs.js 附近
export const canShowPrTab = function(st){
  const snap = st.snapshot
  if(snap && Array.isArray(snap.prs)) return snap.prs.length >= 0 // 有字段即显（含空态，空态文案由 PrTab 负责）
  if(snap && snap.capabilities && typeof snap.capabilities.pullRequest === 'boolean') return snap.capabilities.pullRequest
  // 降级：按 backendModules 声明（若有）
  const bid = (st.selection && st.selection.backendId) || (snap && snap.repository && snap.repository.backend) || null
  if(!bid) return false
  const mods = st.backendModules || (snap && snap.backendModules) || []
  const mod = mods.find(function(m){return m.id===bid})
  if(mod && Array.isArray(mod.capabilities)) return mod.capabilities.indexOf('pullRequest')>=0
  return false
}
```

**关键**：显隐跟随 `s.snapshot + s.selection` 的 `emit` 而自动更新，切换工作区时 `applySnapshotSelection` 与 `hydrateFromCache` 已保证 per-cwd 隔离，无需额外监听。

---

## 7. 不改契约即可先做低保真验证的步骤

1. **本地 mock**：在 `loadSnapshot` 返回前注入 `snap.prs = [{number:1,title:'Mock PR: 标题',state:'OPEN',author:'alice',labels:[],url:'https://github.com/owner/repo/pull/1'}]`，不改宿主，验证 Tabs 渲染与折叠。
2. **Tabs 验证**：在 `Tabs.js` 临时硬编码 `showPr=true`，观察 320/360/460/520px 四档下的折叠（Chrome DevTools 拖拽 Dock，使用 `ResizeObserver` 日志 `t.dataset.tabsLevel`）。
3. **路由验证**：在 `Dock.js` 路由分支临时`s.tab==='prs' ? h('div',null,'PR placeholder') : …`，点击 Tab 切换，验证 `s.tab` 写入与 `emit` 驱动。
4. **后端切换验证**：开两个工作区（github repo 与 markdown repo），切换时观察 PR Tab 是否按 mock 显隐与自动回退 `list`。
5. **窄屏回退验证**：Dock 拖至 300px，检查 PR Tab 是否变纯图标且悬浮 tooltip 按 `collapsed` 门控显示。

---

## 8. 风险清单

| 风险 | 级别 | 缓解 |
|---|---|---|
| `priority` 冲突致折叠顺序错乱（两元素同 priority） | 中 | 保持唯一整数，新增用 7，CSS 依赖 `collapsed` 数量而非具体值，排序稳定 |
| `scrollWidth` 测量在 `display:none` 容器时为 0（隐藏的 Dock） | 低 | Dock 关闭时子树不卸载但 `display:none` 时 `applyFold` 取不到宽，展开时 `applyFold` 会重跑（已监听 ResizeObserver），无需额外处理 |
| 新 Tab 图标缺失导致空白 | 低 | 复用 `icons.js` 现有 `pullRequest` 或补 SVG，路径 `src/client/kernel/icons.js` |
| 快照新增 `prs` 字段增大 payload（100 条 PR ≈ 10KB） | 低 | 默认 `--limit 50`，分页或仅取 open，Markdown 返回空数组零成本 |
| 两处路由分支（Dock + Overlay）不一致导致单容器下 PR 可见另一不可见 | 中 | 保持 `Dock.js` 为真源，`Overlay.js` 同步，构建脚本 `scripts/build.mjs` 剥 `export` 后双产物一致，改后跑 `verify-*` |
| 硬编码 `backend === 'github'` 回归 | 高 | Code Review 卡点：搜索 `github` 字面量，门控必须走 `canShowPrTab` |
| `s.tab='prs'` 持久化缺失导致刷新后回 list 的体验落差 | 低 | 接受现状，或后续加 `localStorage` 持久化（非阻断） |

---

## 9. 原型建议

先按 §7 的 mock 三步做出可拖拽验证的低保真分支（`research/290-tabs-dynamic` 上直接改 3 文件，不改宿主契约，1 小时内可演示），演示通过后再提契约改动（快照加 `prs`）与正式 `PrTab.js` 落地票。

---

## 附录：关键文件与行号索引

- `src/client/views/shared/Tabs.js:8-49` — useTabsRow 硬编码与 priority
- `src/client/panel/Dock.js:21,26-34,140-185,198-229,289,336-338` — store 响应式、ResizeObserver、applyFold、measureContentWidth、tabs 路由
- `src/client/panel/Overlay.js:7-61,101-103` — 同 Dock 的复用分支
- `src/client/kernel/tabsfold.js:10-30` — 纯函数滞回机器（当前未接入）
- `src/client/kernel/store.js:411-432,475-504,556-561` — makeStore、applySnapshotSelection、useStore
- `src/client/index.js:223-245` — TABS_FOLD_HYST / measureContentWidth 定义
- `src/client/views/ListTab.js:34-66,70-150` — 列表过滤/排序管线（路径 B 复用点）
- `CONTEXT.md` — 操作能力/G5/检查链术语

