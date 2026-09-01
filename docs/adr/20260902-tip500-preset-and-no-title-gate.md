# Tip500 薄预设与 verify-no-title 门禁定版（T1 #403）

> 状态：✅ 已定版（承 #402 地图 · #373 复用体系 G1/G2）  
> 生效：2026-09-02  
> 关联：#402 地图 · #403 T1 本票 · #404 T2 壳层迁移 · #405 T3 内容区迁移  

## 背景

全量 44 处（轻量扫描实测 79 处，含双写行重复计数的上限口径）title 原生提示散在 8 类文件：panel/Dock 7、Overlay 12、statusbar 4、floating/SkillFloat 1、views/ListTab 9、MapDetail 9、IssueDetail 7、ChecksTab 2。HoverTip 已支持 `delay` 与 `mode:mouse`，但各处仍手写 `title:` 触发原生气泡，样式与时序不统一。需以最小增量提供唯一真源预设与门禁，让 T2/T3 一行包裹即可完成迁移，同时不影响现有 `HoverTip(mode=0/160)` 在 SkillFloatList/SettingsPage 的手感。

## 决策

### 1. 预设落位与命名

- **落位**：新建 `src/client/views/primitives/Tip.js` 薄封装，复用底座 `kernel/portal.js` 与样板 `views/primitives/HoverTip.js`，不二次封装定位/翻转。
- **命名**：选 `Tip`（短、与 HoverTip 同家族、调用形 `<Tip content>trigger</Tip>` 或 `Tip({content, children})`）。否决 `HoverTip500`（冗长）与 `withTitleTip`（动词前缀偏 HOC）。`Tip` 即 `Tip500` 预设别名，文件即预设即组件。
- **形态**：单文件单控件、零横向 import、样式走 HoverTip 的 `STYLE_TEXT` 与 `portalTop`，单文件 ≤50 行（实测 30 行）。

### 2. 预设接口表

| 键 | 预设值 | 说明 | 可覆盖 |
|---|---|---|---|
| `mode` | `'mouse'` | 鼠标跟随，非锚点 | 是（显式传入时以传入为准） |
| `delay` | `{show:500, hide:160}` | 停留 500ms 出现、160ms 消失；与 HoverTip 默认 0/160 区分，手感不回退 | 是 |
| `maxWidth` | `220` | 与 HoverTip 默认一致，超长换行 | 是 |
| `flip` | `true` | 视口自动翻转（等价 auto） | 是 |
| `zIndex` | `2147483000` | 挂顶顶层，与 HoverTip 一致 | 是 |
| `content` | `props.content` | 提示内容，支持 string｜VNode｜()=>VNode（经 HoverTip resolveContent 惰性） | 必传其一 |
| `children` / 触发元素 | `props.children` | 被包裹的触发节点；若 `content` 与 `children` 同时为元素，按 HoverTip 约定 `content` 优先、`children` 为触发 | 必传 |
| 透传 | `targetRef/visible/onVisibleChange/onShow/onHide/caret/offset` | 透传至 HoverTip，不丢失受控/锚点等能力 | 透传 |

调用示例：

```js
// 1. 文案来自 locale
h(Tip, { content: tr('nav.skillsTitle') }, h('span', null, Ic({n:'skills'})))

// 2. 长标题变量
h(Tip, { content: title }, h('span', { className:'dsws-tt-wrap' }, title))

// 3. 覆盖预设（仅当需要）
h(Tip, { content: tr('x'), delay:{show:300, hide:160} }, trigger)
```

底座链路：`Tip -> HoverTip({mode,delay,maxWidth,flip,zIndex,...}) -> portalTop -> document.body`，单例互斥、翻转阈值 `estW = maxWidth+16+2 (=238)`、滚动/ResizeObserver 重算均由 HoverTip 统一承载。

### 3. 构建清单

- `scripts/build.mjs` 的 `LEAF_MODULES` 新增一行：`{ id: 'tip', file: 'src/client/views/primitives/Tip.js' }`（紧随 hoverTip，保序）。
- `src/client/index.js` 新增标记：`// ==== leaf:tip (spliced by build) ====`（hoverTip 之后、backendSelector 之前），构建时剥 `export` 拼回闭包，一源两物（`client.js` /`package/lib/client.js`）。
- 产物校验：`client.js` 与 `package/lib/client.js` 均含 `Tip` 与 `HoverTip`，双产物一致，无标记残留（`verify-kernel`/`verify-leaves` 保鲜）。

### 4. 门禁清单

- **新增**：`tests/verify-no-title.js` 轻量文本扫描，扫描范围 `src/client/views + panel + statusbar + floating`（约 17 文件，实测 79 处 `title:` 上限口径；与调查报告 44 处为同一集合的不同计数口径，差异来自双写行二次计数与注释过滤差异，阈值按同一口径生效）。
- **阈值**：`0 通过 / 1 通过（未达 2 标记） / 2 WARN 标记（// TODO no-title） / ≥3 ERROR 即抽 / ≥5 ERROR 必卡（合并门禁）`，与 `verify-reuse` 同口径（2 标记 3 即抽 5 必卡）。
- **白名单**：仅测试文件（`tests/` 不在扫描范围，天然豁免）与 `aria-label`（含 `aria-label` 行天然不命中 `title:` 正则，显式豁免）；数据字段 `title` 若与提示同名需后续以豁免清单或重命名收敛，门禁按文本计，T3 清零后以 0 为绿。
- **接入**：T1 阶段门禁可独立 `node tests/verify-no-title.js` 检出残留（当前 79 处必卡，驱动 T2/T3）；**暂不并列接入** `npm run verify` 全链（避免 T1 落地即红），于 T3 全量 44 处清零后并列接入并要求 `npm run verify` 全绿（与 `verify-reuse` 同列）。T2 要求壳层 0 残留单测通过，T3 要求全量清零。
- **粒度与依赖**：门禁同时校验 `Tip.js ≤50 行`、消费 `HoverTip`、含 500/160/220/2147483000/mouse 预设、零横向 import（`^\\s*import\\s`）。

## 后果

- T2/T3 调用方一行即可完成包裹：去掉 `title:` 属性，外层包 `h(Tip, {content: ...}, trigger)`，a11y 视情况补 `aria-label`；Seg 的 `title` 透传参数去除，由调用方包 Tip。
- 复用闸口生效：后续新增提示不再手写 `title`，统一走 Tip，门禁按 2/3/5 阈值卡住重复；存量 HoverTip(0/160) 在 SkillFloatList/SettingsPage 的锚点/鼠标手感不受影响。
- 构建与门禁白名单已同步：`verify-reuse` 的 `ALLOWLIST` 新增 `Tip.js`，Q2 复用重复 0 处通过。
