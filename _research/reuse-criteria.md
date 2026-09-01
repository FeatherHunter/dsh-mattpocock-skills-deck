# 研究：封装判定标准与复用阈值调研（#375 · R2）

> 归属地图：[#373](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/373) 前端控件复用化：可封装自定义控件的体系定版与首轮抽离
> 版本：2026-09-01 研究版（只做研究，不改业务代码）
> 存放：`_research/reuse-criteria.md` · 分支 `research/reuse-criteria`
> 上游：[#374 R1 盘点](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/374)（38 文件 × 29 画像，2 套半悬浮为对照）· 下游直引：[#376 G1](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/376) 封装边界与目录落位、[#377 G2](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/377) 接口与挂载契约
> 约束锚点：纯 JS + `React.createElement` 手写（无 TS/JSX/组件库）· 闭包拼接（`src/client/index.js` 母板 + `scripts/build.mjs` 剥 `export` 拼回 `// ==== kernel:* / leaf:* ====`，一源两物）· `DswsCtx` 8 字段冻结（`kernel/ctx.js` · `docs/architecture/kernel-contract.md`）· 同层禁互 `import`（`verify-no-cross-import`）· 产物双新鲜度门禁

---

## 0 研究问题与拆解

原问题（#375 Question）：何时算可封装为独立自定义控件。

拆为 4 个可判定子问题：① 三判定线的硬门槛是什么（通过/不通过看文本特征，不看主观感受）；② 几处重复即抽与力度分级；③ 纯 JS `h` + `DswsCtx` + 闭包拼接下哪种轻量封装可行；④ 是否新增 `verify-reuse`、以何种计数卡住新增重复。

方法为源码直读（`index.js:101-109` portalTop、`SkillFloatList.js:98-117` 锚点跟随、`SettingsPage.js:13-15` 鼠标跟随、`Pop.js:9-56` 翻转弹窗、`Tabs.js:8-22` 折叠提示、`kernel/ctx.js` 8 字段、`kernel/styles.js` 全局变量、`scripts/build.mjs` 拼接清单、`tests/verify-*.js` 门禁形态）+ 构建与契约文档交叉（`docs/architecture/kernel-contract.md`、`docs/adr/20260826-deck-slots-five-seats.md` 五端口）。

判定对象仅限 `src/client` UI 叶（`floating/*`、`views/*`、`views/shared/*`、`statusbar/*`、`panel/*` 与 `kernel` 中 UI 相关），不含 `host` 与 `shared/tracker` 数据层。

---

## 1 可封装三判定线

> 三线同时满足才算可封装；任一线不满足即判定不可抽（先解耦再议）。G1 用此表做 go/no-go，G2 用此表定接口是否需 props 化。

| 判定线 | 一句话定义 | 通过的文本特征 | 不通过的文本特征 |
|--------|------------|----------------|------------------|
| **独立性** | 不读全局可变状态，可用 `props + 局部 state` 闭环渲染与交互，不把 `store` 当隐式入参 | 仅读 `props`、局部 `useState/useRef`、`DswsCtx` 的 `h/rdom/localeSvc`；状态经 `props.onXxx` 回抛 | 直接 `import { useStore, emit }` 或读 `s.xxx` 全局字段；跨文件读写同一 `s` 键（如 `s.skillTip`） |
| **可参数化** | 样式、跟随模式、翻转、尺寸均可由调用方覆盖，不把变体写死在实现里 | 颜色/尺寸/文案来自 `props` 或 `STYLE_TEXT` 变量；跟随分 `anchor/mouse` 枚举；翻转经 `props.flip` 或自动计算 | 硬编码色值/像素（如 `260` 限宽写死）、`tr()` 文案写死、跟随逻辑与具体锚点选择器耦合 |
| **可测试性** | 可在 JSDOM 单测中挂载并断言 DOM 与翻转分支，不依赖真实页面布局与宿主服务 | 导出的 `h` 工厂产出固定 DOM；定位分支可注入 `getBoundingClientRect` 桩；定时器可用 `timer` 注入 | 顶层直接 `document.body.appendChild` 无注入点；强依赖 `window.innerWidth` 真值与 `ResizeObserver` 真实例 |

判定流程（3 步串行）：`独立性?` → 否则先解耦全局依赖；`可参数化?` → 否即将硬编码提为 props；`可测试性?` → 否即补注入点与桩。任一步失败即回炉，不进入阈值计数。

证据锚点：`portalTop` 底座 `src/client/index.js:101-109`（全局挂顶样板）；鼠标跟随 `SettingsPage.js:13-15`（`showCfgTip/moveCfgTip` 14px 偏移 + 260/40 限界）；锚点跟随 `SkillFloatList.js:98-117`（`placeOverlay` 右/左对齐 + 160ms 延迟关 + ResizeObserver）；固定翻转 `Pop.js:9-56`（`left/top/flip/caret` 三分支）；折叠提示 `Tabs.js:8-22`（`collapsed` 门控 + `portalTop` 挂顶）。

---

## 2 可封装检查清单（8 项，G1/G2 直接勾选）

> 8 项全勾才进封装；缺 1 项记为待解耦项，随票注明解耦路径。CI 可将此清单转为 `verify-reuse` 的正则（见 §5）。

- [ ] **无全局 store 直读**：文件内不出现 `useStore` / `emit(s` / `s\.skillTip\|s\.cfgTip` 等全局键直读（检索 `grep -rn "useStore\|emit(" src/client` 为 0）
- [ ] **props + 局部 state 闭环**：可变状态仅 `props.value + useState/useRef`，回抛经 `props.onChange/onClose`，无跨文件共享可变键
- [ ] **h/rdom 由调用方注入或 DswsCtx 取**：不自建 `React` 实例；`h = cx.h || React.createElement`，`portalTop` 走内核底座而非自写 `createPortal`
- [ ] **样式无硬编码**：色值/圆角/阴影走 `kernel/styles.js STYLE_TEXT` 或 `props.style/className` 覆盖，不出现裸色值 `#c084fc` 直写（除图标语义色经 props 透传）
- [ ] **跟随/翻转/尺寸可参数化**：跟随模式 `mode: 'anchor'|'mouse'|'fixed'`、翻转 `flip: 'auto'|boolean`、限宽 `maxW` 均可配；分支可单测覆盖
- [ ] **可在 JSDOM 单测挂载**：导出的 `h` 工厂在 `jsdom` 中 `render(h(Comp, props))` 不抛错；定位分支可桩 `getBoundingClientRect` 断言 `left/top/flip`
- [ ] **无 portal/翻转样板重复**：不自写 `getBoundingClientRect + left/top/flip + caret` 第二遍，复用底座或 `HoverTip` 工厂
- [ ] **单文件 <200 行且无同层跨 import**：符合闭包拼接约束（叶模块仅依赖 `kernel/*` 与 `shared`，不横向 `import ../views/...`）

使用法：G1 评审时逐项勾选并贴行号；G2 将未勾项转为接口 props（如翻转未参数化则加 `flip` prop）；T1/T2 落地前复核清单，缺项不合入。

---

## 3 复用阈值与力度分级

### 3.1 计数阈值（以 R1 实测为基线）

| 阈值 | 含义 | 动作 | 证据标尺 |
|------|------|------|----------|
| **2 套重复即标记** | 同类逻辑出现 2 处 | 代码旁加 `// TODO reuse:<key>` 并记入 `_research/reuse-inventory.md` 增量 | 当前即此档：鼠标跟随 vs 锚点跟随 2 套半（R1 §3 证据1） |
| **3 处即抽** | 同类逻辑出现 3 处 | 当次 PR 必须抽为复用控件或在 PR 描述中写明不抽理由（经 grilling 拍板） | 预期：悬浮 2 套 + 折叠提示 1 套 = 3 处（Tabs + SkillFloatList + SettingsPage） |
| **5 处必抽** | 同类逻辑出现 5 处及以上 | 合并门禁直接卡住（`verify-reuse` 报错），不抽不合入 | 目标态：5 处及以上同效果不再各写一遍（#373 Destination） |

计数口径：文本特征计数而非文件数。悬浮类计 `placeOverlay/getBoundingClientRect + fixed + zIndex:2147483000`；Chip 类计 `hexA/darken + .dsws-chip`；Tabs 折叠计 `collapsed + portalTop tooltip`。同一文件内两处同特征算 2 处。

示例：若新增 `StatusBar.js` 第四套气泡（再写一遍 `getBoundingClientRect + flip + caret`），计数由 3 升 4，触发 3 处即抽，PR 必须复用 `HoverTip` 或写 grilling 豁免。

### 3.2 力度分级（底座必抽 vs 业务控件分级）

| 分级 | 对象 | 判定 | 首轮动作 |
|------|------|------|----------|
| **底座必抽** | `portalTop/PortalOverlay`、`STYLE_TEXT`、`DswsCtx` 取法 | 任意业务控件依赖即算重复，0 容忍 | #380 单独抽为 `kernel/portal.js`，全量悬浮/弹窗改走底座 |
| **P0 必含样板** | `HoverTip`（统一两套悬浮 + 折叠提示） | 满足 §2 且阈值≥2 即必含 | #381 首批落地，迁移 `SkillFloatList` 与 `SettingsPage` |
| **P1 原子控件** | `Seg / Split / Chip+Dot / Modal / Tabs` | 满足 §2 且阈值≥3 | G3 拍优先级后分批进 `views/shared/` 或新建 `views/primitives/` |
| **P2 复合控件** | `tagsFit 贪心 +N`、`ChainRenderer`、`md` | 满足 §2 但耦合度高 | 次轮按需抽，保留页面组合形态 |

R1 结论复用：首轮 5+底座覆盖 70% 重复（R1 §2.1 A1-A8），与本级联一致。G3 选型时按此分级排序，P0 不可后移，P1 按阈值高者先抽。

---

## 4 轻量封装模式对比（本仓库约束下）

约束重申：纯 JS `h`（无 JSX 编译）、`DswsCtx` 8 字段冻结且由 `createCx` 单例注入、闭包拼接要求叶模块为 ESM 真源且剥 `export` 后文本拼回（不能出现跨叶相对 import 横向依赖）。

| 模式 | 形态 | 贴合度 | 代价 | 在本仓库的可用性 |
|------|------|--------|------|------------------|
| **h 工厂** | `export function makeHoverTip(h, deps){ return function HoverTip(props){...} }` 或 `export function HoverTip(props){ const cx=useContext(DswsCtx); const h=cx.h... }` | 高：与现有 `kernel/*` 工厂（`createCx/makeStore`）同构；闭包拼接友好（单文件 ESM 叶，剥 export 即拼）；调用方仅传 `props` | 需约定 `h` 来源（优先 `cx.h`） | **推荐主路径** |
| **hook** | `export function useHoverTip(ref, opts){ useEffect(...); return {x,y,show} }` | 中：可抽定位/翻转纯逻辑，但调用方必须是组件且遵守 Rules of Hooks；与闭包拼接兼容，但单独 hook 不能产出 DOM，仍需配 h 工厂 | 增加调用方心智（必须在组件顶层调用） | 推荐作 h 工厂内部实现，不单独作为复用交付物 |
| **HOC** | `export function withHoverTip(Comp){ return function Wrapped(props){...} }` | 低：多一层嵌套与 prop 透传；与 `DswsCtx` 取值冲突（HOC 层与内层各取一次）；调试栈深；在闭包拼接下无额外收益 | 嵌套地狱、类型（虽无 TS）与 ref 转发成本 | **不推荐** |

**推荐：h 工厂 + 局部 useState/useRef/useEffect**。工厂内部可用 hook 实现跟随/翻转/定时器，外部呈纯 `h` 组件形态（`h(HoverTip, {mode, target, text, maxW, flip})`）。鼠标跟随与锚点跟随收敛为同一工厂的 `mode` 分支，翻转收敛为 `flip='auto'` 分支，彻底消除两套半样板。

```js
// 推荐签名（G2 细化，示意非可运行代码）
export function HoverTip(props) {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const [pos, setPos] = React.useState(null) // 局部 state，不读全局 store
  // mode: 'mouse' 用 clientX/Y + 14px 偏移；'anchor' 用 anchorRef.getBoundingClientRect()
  // flip: 'auto' 时测 window.innerHeight 翻转，caret 同步旋转 45°/225°
  return pos ? portalTop(h('div', { style: { position:'fixed', left:pos.x, top:pos.y, zIndex:2147483000 } }, props.text)) : null
}
// 调用：h(HoverTip, { mode:'anchor', anchorRef: ref, text: tr('...'), maxW: 260, flip:'auto' })
```

反模式：把 `useStore` 读进工厂内部（破坏独立性）；把 `260/40` 限界写死（破坏可参数化）；把 `createPortal` 自写第二遍（破坏底座复用）。

---

## 5 门禁建议（verify-reuse 轻量检查）

是否新增：建议新增 `tests/verify-reuse.js`，轻量文本扫描而非 AST，成本与现有 `verify-no-cross-import / verify-leaves` 同级。

卡点两问（任一命中即 warn/error）：

1. **是否含全局 store 读**：扫描 `src/client/**/*.js` 是否新增 `useStore\|emit(s\|s\.cfgTip\|s\.skillTip\|s\.bugMenu` 等全局键直读；新增复用控件文件命中即 error（应改为 props 注入）。
2. **是否含 portal/翻转重复**：扫描是否新增 `getBoundingClientRect\)\s*[,;]\s*.*flip\|caret.*rotate\|zIndex:\s*2147483000` 等翻转样板第二遍；计数≥2 即 error（应走底座/ HoverTip）。

阈值联动：命中 2 处重复记 warn（注 TODO reuse），3 处 error 并要求当次 PR 抽离或附 grilling 豁免，5 处必 error 不豁免。实现参考 `verify-no-cross-import.js` 的文件遍历 + 正则 + 白名单（白名单仅 `kernel/portal.js` 与 `HoverTip` 真源）。

与既有门禁的关系：不替代 `verify-ctx / verify-leaves / verify-kernel`（产物新鲜度）与 `verify-no-cross-import`（房间纪律），仅补 UI 复用维度；CI 中与它们并列执行，失败信息指向本文件 §2 清单。

开闭原则：新增白名单需经 G1 grilling 拍板并在本文件增量记录；门禁只卡新增重复，不回溯已标记的 2 套半存量（存量由 #380/#381 迁移消化）。

---

## 6 给 G1/G2 的直接引用句

- G1 落位：叶复用控件落 `src/client/views/primitives/`（或复用 `views/shared/`），内核底座落 `src/client/kernel/portal.js`；每叶单文件 <200 行、仅依赖 `kernel/*` 与 `shared`，满足闭包拼接与同层禁互 import。
- G2 接口：对外统一 `h` 工厂形态（内部可用 hook），`h/rdom` 经 `DswsCtx` 取、样式经 `STYLE_TEXT` 与 `props` 覆盖、翻转/跟随经 `props` 枚举，JSDOM 可挂载为验收门槛。
- 阈值执行：2 标记 3 抽 5 必抽；底座 0 容忍；首轮以 `HoverTip` 为样板验证 h 工厂路径。
- 门禁执行：新增 `verify-reuse` 仅两问（全局 store 读、portal 翻转重复），2 warn 3 error 5 必卡，白名单归 G1 管。

---


---

## 7 附：快速判定卡与术语

**一句话判定卡（贴 PR 模板）：** 独立性（无全局 store 直读）∧ 可参数化（样式/跟随/翻转可配）∧ 可测试性（JSDOM 可挂）→ 可封装；2 处标记 3 处抽 5 处必抽；底座 0 容忍。

| 术语 | 本研究含义 | 非术语说法 |
|------|------------|------------|
| 底座 | `portalTop/PortalOverlay` 等挂顶与样式底座，必抽为 `kernel/*` | 基础设施 |
| 原子控件 | 单职责叶控件（Seg/Chip/Modal/Tabs/HoverTip），`h` 工厂形态 | 小组件 |
| 复合控件 | 由原子控件组合的页面级控件（tagsFit/ChainRenderer） | 大组件 |
| 闭包拼接 | `build.mjs` 剥 `export` 拼回母板的构建方式，决定叶间禁互 import | 构建拼接 |

引用规范：G1 引用 §1-§2 做落位与清单勾选；G2 引用 §4 签名与 §2 清单定接口；G3 引用 §3 分级做优先级；门禁引用 §5 两问与阈值。

变更记录：2026-09-01 初版（R2 研究，不改业务代码）；后续 G1/G2 定版后本文件增量补白名单与豁免记录，不改判定线。

*证据一手来源：`src/client/index.js:101-109`、`floating/SkillFloatList.js:98-117`、`views/SettingsPage.js:13-15`、`floating/Pop.js:9-56`、`views/shared/Tabs.js:8-22`、`kernel/ctx.js`、`kernel/styles.js`、`scripts/build.mjs`、`tests/verify-*.js`；交叉 `docs/architecture/kernel-contract.md`、`docs/adr/20260826-deck-slots-five-seats.md`。*