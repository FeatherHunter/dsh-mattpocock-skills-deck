# ADR：前端控件复用化 — HoverTip 接口与挂载契约（G2）— #377/#393

> 日期：2026-09-01 定版（承 #373 地图，G1 #391 已落盘底座与目录，G2 #377 grilling 拍板推荐打包 91 分，本规格 #393 首轮定版）
> 地位：复用体系的第二个架构决策，定版 HoverTip 单一样板与挂顶契约，后续所有悬浮需求默认走此路径；与 `docs/adr/20260901-reuse-g1-portal-primitives.md`、`kernel/portal.js`、`views/primitives/HoverTip.js` 同级约束。
> 版本与效力：本文件落盘后，凡与本决策冲突的旧悬浮实现/定位分支/全局提示键，以本文件（更新日期者）为准；未来任何讨论若改动本契约，以未来版本为准（CONTEXT.md 同款两条规则）。

---

## 1. 背景

面板内两套悬浮提示各自手写定位、翻转、挂顶与定时器：
- `src/client/views/SettingsPage.js:13-15` 鼠标跟随（offset 14,12 / 260×40 阈值）
- `src/client/floating/SkillFloatList.js:98-117` 锚点跟随（maxWidth 220 / 实宽 238 翻转）

新增一处就要再抄一遍，改一处易漏另一处，视口边缘一处翻一处不翻，快速划过抖动，深层容器下被裁剪（R1 五处重复证据之一定位/翻转 + portal + 时序）。需要一套统一悬浮契约，让后续所有提示默认走同一路径，不再各写定位与翻转分支。

约束：沿用 G1 底座与目录落位（portal 归 kernel、HoverTip 落 primitives、单文件 <200 行、样式单真源 STYLE_TEXT、闭包拼接一源两物、DswsCtx 8 字段、同层禁互 import）。

---

## 2. 决策

### 2.1 范围收敛 — 仅 HoverTip 单一样板

- 首轮仅定版 HoverTip 单一样板与挂顶底座的契约，不将通用定位抽为独立钩子（place/usePlacement）；
- 通用能力若需后续经原型验证后再议，避免为未验证的复用提前抽象；
- 固定定位模式与自定义挂载容器不纳入首轮，首轮仅 anchor 与 mouse 两档并锁 document.body。

### 2.2 接口表（HoverTip）

```js
HoverTip(props) // h 工厂，局部 useState/useRef/useEffect 闭环，经 DswsCtx 取 h/timer/localeSvc，消费 kernel/portal.js 的 portalTop
// props
{
  content?: string | VNode | () => VNode, // 主入口，富内容支持，content != null 时忽略 children
  children?: string | VNode,              // 别名，当 content 与 children 同时为触发器元素时，children 视为包裹对象
  mode?: 'anchor' | 'mouse',              // 默认 'anchor'，首轮不做 'fixed'
  targetRef?: Ref<Element>,                // mode=anchor 时锚点（可选，与内部包裹二选一）
  offset?: { x: number, y: number },      // 默认 anchor {8,0} / mouse {14,12}
  maxWidth?: number,                       // 默认 220（实宽 238 = 220+16+2）
  flip?: boolean,                          // 默认 true（auto 按 window 视口，caret 随翻转自动左右）
  delay?: { show: number, hide: number }, // 默认 {show:0, hide:160}
  visible?: boolean,                       // 受控优先，未传则非受控局部 state
  onVisibleChange?: (next: boolean) => void, // 受控回抛，受控下不自动改值
  onShow?: () => void,                     // 非受控立显回调
  onHide?: () => void,                     // 非受控延迟关回调
  zIndex?: number,                         // 默认 2147483000，透传覆盖
}
```

状态归属：默认非受控局部 state，支持 visible 受控兜底；T2 一次性删除全局提示键（s.skillTip/s.cfgTip 等），不留 shim。受控下仅经回调通知由调用方决定是否改值，内部不双写。

内容入口：主入口与别名共存，主入口优先；主入口支持字符串、视图节点或懒求值函数，首轮两处迁移用字符串，后续富内容不改接口。样式单真源 STYLE_TEXT，气泡本身 pointerEvents none。

### 2.3 跟随与翻转

- 仅 anchor|mouse 两档，默认 anchor；offset 按跟随分档默认值，限宽 220 为基线，翻转默认开启并统一按视口判定；
- 定位：anchor 读 targetRef.getBoundingClientRect()，mouse 跟 clientX/Y；以 window.innerWidth/Height 为界，超出视口时左右钳制、上下翻转且小三角同步；
- 阈值统一：estW = maxWidth + 16 + 2 = 238，x + estW > vpW 时翻到另一侧，y 越界时 clamp，caret 边框色走 var(--dsw-alias-border-l2)，随 flippedX 在 -4px 与 -4px 左右切换并 45deg/225deg 旋转；
- 私有性：place 计算私有于 HoverTip 内，不对外暴露为独立 API，P1 验证后再议是否独立为 usePlacement。

### 2.4 时序与事件

- 显隐延迟拆档，默认立显与延迟消失，快速划过时进入即清定时、移开即重计时，单一定时器驱动不另写硬编码；
- 事件：非受控下提供 onShow/onHide，受控下提供统一 onVisibleChange，两者互斥，受控下时序不自动改值；失败不抛。

### 2.5 挂顶与叠放

- 所有悬浮统一经平台抽象层的挂顶底座落到文档顶层（portalTop），底座内含渲染器缺失时的原地退化；控件内私有定位函数不对外暴露，滚动与视口变化时统一重算（scroll capture + resize + ResizeObserver），失败不抛；
- 叠放：统一定位层级 2147483000，高于面板 9999/modal 10000/note 10001，复用既有技能浮层的已验证层级，避免被面板裁剪。

### 2.6 架构边界

- 控件经上下文注入所需的创建函数、计时与多语言能力（DswsCtx），不横向依赖同层其他原子控件，单文件粒度 <200 行，与目录分层与闭包拼装约束保持一致；
- 构建与产物：内核底座与叶侧原子控件分别经构建清单拼回拼接母板（KERNEL_MODULES portal + LEAF_MODULES hoverTip），一源两物双形态，相关门禁白名单随清单同步。

---

## 3. 后果

- 正向：后续所有悬浮需求默认走 HoverTip 契约不再各写定位/翻转/挂顶逻辑；首轮两处迁移已完成（SkillFloatList 锚点 + SettingsPage 鼠标，含芯片与工作区后端总览的 mouse 提示），移除手算定位与全局提示键，滚动与视口边缘翻转走同一契约，三件套用例覆盖挂顶/翻转/跟随。
- 代价：新增 primitives/HoverTip.js 单文件 + 轻量门禁 verify-hovertip.js + 本 ADR，构建与门禁白名单同步（约 1 行 LEAF + 1 行 verify 串联 + 2 处白名单）。
- 风险与缓解：漏改构建标记或冻结表会导致 verify-kernel 红，T2 单独验证 build 全绿；阈值分裂由 estW 统一，时序竞态由单 timer 统一，叠放被裁由 portalTop 统一，底座缺失由 RDOM 兜底；新增重复由 verify-reuse 按 2 标记 3 即抽 5 必卡拦截。

---

## 4. 上游依据与引用

- R1 盘点：research/reuse-inventory#0a506be（38 文件扫描 + 29 画像 + 5 处重复）
- R2 阈值与模式：research/reuse-criteria#813a0e5（§1 三判定线 + §2 八项清单 + §3 阈值 2/3/5 + §4 h 工厂主路径 + §5 门禁两问）
- G1 落位：#376 / #391 方案一（91 分）— portal 归 kernel、primitives 新目录、单文件单控件、样式单真源
- G2 契约：#377 grilling 推荐打包 91 分（本 ADR 正文为首，P1 原型与 T1/T2 直接落地）
- 原型：#379 prototype/hovertip-379#9ec8ab9 — mode 一键切换、翻转/maxWidth/offset 参数化、portalTop 挂顶一致性以 3 态呈现，5 处需求均可由同一接口覆盖
- 落地：T1 #380 底座抽离 + T2 #381 HoverTip 首批落地与两处迁移（verify-kernel / verify-skill-tooltip / verify-hovertip / verify-reuse / npm run verify 全绿，node scripts/build.mjs 一源两物）

---

## 5. 变更记录

- 2026-09-01 初版（G2 定版落盘，T1/T2 已落地验证，P1 原型 3 态通过）。
