# 页签与筛选药丸的「液态」动效：在本插件里能做到什么、代价在哪

> **起因**：右侧面板顶部页签（列表 / 技能 / 版本管理 / 拉取请求 / 环境检查）、列表页三组筛选药丸，以及按钮、列表卡片、文字链接，要加「液态 tab 效果 + 按压反馈 + 悬停反馈」。视觉方向还没定，候选是 A 滑动选中块、B 玻璃材质、C 纯弹跳回弹。这篇笔记回答：每一条在 CSS 里能做到什么程度、会不会拖慢面板、要不要先做原型。
>
> **结论先行**：
> 1. 选中块滑动用**共享指示器 + `transform` 过渡**（方案 A）。它天然可被打断：过渡被改目标时从当前值继续走（规范行为，本机实测一致）。View Transitions 不做主路径——它默认把**整份文档**做交叉淡入，而插件面板与 DSH 外壳共享同一份文档。
> 2. 「液态拉伸」不需要逐帧脚本。`transform` 过渡配 `linear()` 多段缓动（Chromium 113 起）或一段两相 `@keyframes`，就能做出「起手拉长、落定回弹」。
> 3. `@property` 只在要把数值插值到**非 `transform` 属性**（颜色、模糊半径、圆角）时才值得引入；纯位移不注册也能动，但注册了才平滑。
> 4. 玻璃材质只建议铺在页签条这一条上，不要铺到列表行和卡片：`backdrop-filter` 会改动子元素 `position: fixed` 的包含块（本仓 `src/client/kernel/portal.ts:18` 已记过这个坑），而且在 320px 宽的面板里，模糊会让 11–12px 小字的对比度不可控。
> 5. 按压反馈用 `:active` 打底，但必须补「按下后拖走」的撤销——`:active` 不会自己松开，祖先可点元素还会一起亮；减弱动效用**替换**（换成底色 / 描边变化）而不是全关，颜色、焦点、命中面积这三条底线要一起守。

**日期**：2026-10-21　**环境**：本机 DSH 的 Electron 44.7.0 / Chromium 152.0.7977.130；行为实验用系统 Chrome 155.0.8059.85（headless + DevTools 协议）。**适用范围**：Electron 壳内的这份面板；不覆盖浏览器扩展注入、移动端与 Safari。凡是只在一版 Chromium 上验过的结论，下文都单独标注。

## 0. 版本基线：后面每条判断都挂在这张表上

版本号取自 Google 的 Web Platform Status 接口（`api.webstatus.dev`），语义以 MDN 为准；MDN 的兼容表由脚本渲染，静态抓取拿不到版本，所以只当定义来源。

| 能力 | 桌面 Chromium 起始版本 | 与本需求的关系 |
| --- | --- | --- |
| View Transitions（同文档） | 111（2023-03-07） | 方案 A 的可选替代 |
| View Transitions（跨文档） | 126 | 与面板无关 |
| `Element.startViewTransition`（元素作用域） | 147（2026-04-07，MDN 标实验性） | 若走 View Transitions，用它把范围收到面板内 |
| `view-transition-class` | 125 | 少量元素共用一套过渡样式 |
| `@property` 注册自定义属性 | 85（2020-08-25） | 液态形变插值 |
| `linear()` 缓动 | 113（2023-05-02） | 一段缓动里塞多段节奏 |
| `backdrop-filter` | 76（2019-07-30） | 玻璃材质 |
| `:focus-visible` | 86 | 键盘焦点与鼠标点击分开画 |
| `prefers-reduced-motion` | 74 | 减弱动效 |
| `prefers-reduced-transparency` | 119（Baseline 有限） | 玻璃材质降级 |
| `prefers-contrast` | 96 | 高对比偏好降级 |

本机 Electron 的 Chromium 是 152，上表全部能力都在内——**不需要为兼容性做降级分支，只需要为「偏好」做降级分支**。这条对方案取舍很关键：选型可以只看性能与手感，不看版本。

## 1. 选中块滑动：三种实现怎么选

### 1.1 共享指示器 + `transform` 过渡（方案 A）

原理：页签行是 `position: relative`，里面放一颗绝对定位、不参与 flex 排布的「墨块」；点中某颗页签时，读一次它的位置，把两个 CSS 变量（横向偏移、宽度）写上去，墨块用 `transform: translateX()` 滑过去。

- **会不会引起布局抖动**：不会。`transform` 是合成器处理的属性，动画期间不重排、不重绘（Web 性能指南把 `transform` / `opacity` 列为合成友好属性：[web.dev 动画指南](https://web.dev/articles/animations-guide)）。前提是**宽度也不要跟着动**——墨块的 `width` 直接设成目标值（瞬间生效），参与动画的只有 `transform`。
- **能不能被打断 / 快速连点**：能，而且不用写任何取消逻辑。CSS 过渡被改目标时从当前计算值继续走，这是规范明确规定的（[CSS Transitions §3 启动过渡](https://drafts.csswg.org/css-transitions-1/#starting)），本机实测：`translateX` 走到 39.99px 时把目标从 100px 改成 20px，立刻取样仍是 39.99px（不跳），250ms 后为 34.3px（按新目标继续）。
- **和本仓的「零布局抖动」约定冲不冲突**：不冲突，但有一条线不能踩。优化记录 `docs/adr/20260911-zero-layout-jitter.md` 禁的是「测量—修改交替」，尤其是循环次数随数据量放大的那种。页签总数固定 5 颗，一次点击只读一次 `getBoundingClientRect()`、写完就结束，属于该记录第 3 条明确放行的「次数固定」情况。反例是：在列表渲染里对每一行都量一次卡片位置——那会随行数放大，绝对不能做。

### 1.2 FLIP（First / Last / Invert / Play）

Chrome 团队 2015 年的经典手法（[FLIP Your Animations](https://aerotwist.com/blog/flip-your-animations/)）：先记下旧位置，改完 DOM 后再记新位置，用 `transform` 把元素「倒推」回旧位置，然后放开让它自然过渡到新位置。对页签来说，1.1 其实就是 FLIP 的特例（只动一颗元素、位置可以直接算出来），没必要单独引入这套流程；它的价值在「一整排元素重排」的场景，本需求的页签与药丸都是固定几颗，用不上。**不推荐**，理由是复杂度换不到收益。

### 1.3 View Transitions API

写法是 `document.startViewTransition(() => { 改状态 })`，浏览器给新旧状态各拍一张快照，自动补间（[MDN View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)）。本机在 Chromium 155 上实测了三条：

1. **默认会整页交叉淡入**。一次最普通的调用之后，`document.getAnimations({ subtree: true })` 里出现 `::view-transition-group(root)`、`::view-transition-old(root)`、`::view-transition-new(root)` 共 5 条动画。也就是说：不额外关掉 root 的交叉淡入，整个 DSH 界面会跟着闪一下——面板和外壳是同一份文档。
2. **快速连点不抛错，也不能靠异常判断被打断**。连续调两次，第一次的 `finished` 在第二次调用后约 4.7ms 就 resolve（不是 reject）。MDN 对 `finished` 的说明也是这个口径：只有当回调抛错或返回被拒绝的 Promise 时才 reject；被 `skipTransition()` 跳过时终态照常到达，`finished` 仍然履行（[MDN ViewTransition.finished](https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition/finished)）。所以要接管连点，只能自己记调用序号或比对 `document.activeViewTransition`。
3. **范围可以先收到元素上**。`Element.startViewTransition` 从 Chromium 147 起可用，只对某个元素的子树拍快照（[MDN 元素作用域](https://developer.mozilla.org/en-US/docs/Web/API/Element/startViewTransition)），本机 152 已支持。但它仍是实验性 API，且过渡期间的层叠上下文、`overflow` 裁剪行为需要真机确认。

| 实现 | 是否引发布局 | 打断 / 连点 | 对共享文档的副作用 | 结论 |
| --- | --- | --- | --- | --- |
| 1.1 共享指示器 + `transform` | 否（仅点击时读一次位置） | 过渡自动从当前值改道，无需取消 | 无 | **主路径** |
| 1.2 FLIP | 否 | 需自己写 invert 逻辑 | 无 | 本需求用不上 |
| 1.3 View Transitions | 快照期间整页参与 | 第二次调用会接管，但旧 promise 静默履行 | **会**（root 交叉淡入） | 只做实验，不做主路径 |

## 2. 「液态形变」在 CSS 里能做到哪一步

| 手法 | 实测/规范结论 | 代价 | 适用 |
| --- | --- | --- | --- |
| `transform: scaleX()` 过渡 | 合成器处理，平滑 | 几乎为零 | **首选**：拉长、压扁、回弹都靠它 |
| 未注册的自定义属性 | 不插值，直接跳到终点（实测：位移从 0 直接变 30px） | 无 | 只当开关用 |
| `@property` 注册的属性 | 平滑插值（实测：同一场景中途 13.0px，符合线性） | 声明三行；`inherits: false` 时不影响后代 | 需要把数值喂给颜色、模糊、圆角时用 |
| `clip-path` 变形 | 点数不同就**不插值**，中途直接是终点形状（实测 4 点 → 5 点） | 每次变化重绘，边缘要开抗锯齿 | 只做同点数（如 4 点矩形）的圆角/斜切变化 |
| `filter: blur()` 动画 | 每帧重绘，模糊半径越大越贵 | 中高 | 只做一次性短促高光，不做常驻 |
| `linear()` 缓动 | Chromium 113 起，可在一段过渡里定义多段节奏 | 无 | **推荐**：用一段过渡做出「冲出去—回弹」 |

要点：

- **位移不需要注册属性**。只有当你想让颜色、`filter`、`border-radius` 这类属性跟着一个数值平滑变化时，才需要 `@property`（[MDN @property](https://developer.mozilla.org/en-US/docs/Web/CSS/@property)）。少用一个就少一处可能被后人误解的声明。
- **`clip-path` 的插值是逐点匹配的**，形状类型和点数都必须一致，否则退化成跳变（[CSS Shapes §3.4](https://drafts.csswg.org/css-shapes-1/#interpolation-of-basic-shapes)）。想要「液态融合」那种效果，靠 `clip-path` 基本做不到，别在这上面花时间。
- **`linear()` 是「一段过渡里做多段节奏」的最省办法**：`transition-timing-function: linear(0, .6 25%, 1.08 55%, .98 78%, 1)` 就能让一颗药丸冲出去、略微过冲、再落定，全程只有一次 `transform` 过渡、可被打断、不需要脚本计时。
- **`will-change` 只在真的会动的元素上写**，而且别撒给整排。MDN 的原话是「把它当最后手段，不要用来提前预防性能问题」「给太多元素加会拖慢页面」（[MDN will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change)）。本需求里最多给那一颗墨块写。

## 3. 玻璃 / 模糊材质：代价在哪

`backdrop-filter: blur()` 的做法是：把元素背后的画面当作输入，模糊后画进元素自己的层。规范把它背后的那个范围定义为 backdrop root，而一些属性会创建新的 backdrop root（[Filter Effects Level 2 §3](https://drafts.csswg.org/filter-effects-2/#BackdropRoot)）。工程上要记住三件事：

1. **每块玻璃都要单独一层，且背后一变就要重算**（这一条是实现推论，不是规范原文）。页签条下面如果压着会滚动的列表，滚动时每一帧都在重新模糊。铺得越宽、层数越多，代价按面积乘层数上涨。面板宽约 320–400px，一条 30px 高的页签条是可以接受的；铺到每一行列表就是另一回事。
2. **它会改变后代 `position: fixed` 的包含块**。本仓 `src/client/kernel/portal.ts:18` 已经记过：祖先带 `transform` / `filter` / `backdrop-filter` / `will-change` / `contain` 时，`fixed` 元素的包含块会降级成该祖先，出现坐标偏移和被 `overflow` 裁剪。如果给面板容器加玻璃，弹出层、提示框的定位会一起受影响。
3. **可读性比性能更容易翻车**。面板里的正文是 11–12px、次要文字是灰色（`#a1a1aa` 一档），背后一旦是变化的画面，同一行文字的对比度会在滚动中反复越过 4.5:1 的界线（[WCAG 1.4.3 对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)）。所以玻璃要么只铺在稳定的底（页签条常驻、背后是自己画的底色），要么在玻璃上再垫一层半透明实色。

降级手段是现成的：`@media (prefers-reduced-transparency: reduce)`（Chromium 119 起）里换成不透明底色；`@media (forced-colors: active)` 里完全去掉（[MDN prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency)）。

**不确定的地方**：Chromium 缺陷库里关于 `backdrop-filter` 与 `overflow: hidden`、圆角裁切、与 `transform` 组合时的已知缺陷，本次没能取到具体条目（缺陷库是脚本渲染的页面，静态抓取只剩脚本），所以上面只写规范层面的机制，不写「某版本有某 bug」。

## 4. 密集小控件：hover 与 press 的成熟做法

### 4.1 先用媒体查询把触屏隔离掉

悬停样式一律包在 `@media (hover: hover) and (pointer: fine)` 里。`hover: none` 的语义是「主输入机制无法方便地悬停」，在触屏上长按会被系统解释成模拟悬停，把 hover 效果直接暴露给手指用户（[MDN @media hover](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover)）。本机桌面 Chromium 实测：`(hover: hover)` 为真、`(pointer: fine)` 为真；headless 也是同样结果，所以不能在 headless 里验证触屏分支，得真机或 DevTools 设备模拟。

### 4.2 `:active` 与 `pointerdown` 的差别：按下后拖走会不会「粘住」

**会。** 本机实测：鼠标在按钮上按下后把指针移到 300px 外，按钮仍然匹配 `:active`，背景保持按下色，直到松开才恢复；这次松开不会触发 `click`（释放点不在元素上）。同一时刻 `document.body` 也匹配 `:active`——按选择器规范，激活态会向上传给祖先（[MDN :active](https://developer.mozilla.org/en-US/docs/Web/CSS/:active)）。

后果有两层：

- 单层按钮：手指或鼠标拖走时按钮一直亮着，看起来像卡住。
- 嵌套可点元素（卡片里的图标按钮、列表行里的药丸）：**祖先和子元素会一起亮**，因为 `:active` 同时命中两者。

对策：

- 只用 `:active` 做「瞬间变暗」这类不强调的反馈，可以不管；
- 要做「按下—抬起」两段式的明显反馈，就用指针事件自己管状态：`pointerdown` 时加一个类，`pointerup` / `pointercancel` / `pointerleave` 时去掉，并配合 `setPointerCapture`（否则拖出元素就收不到 `pointerup`）。这样「拖走」等于取消，语义才对。
- 嵌套场景把视觉反馈绑在最小可点元素上（子按钮自己 `stopPropagation`，卡片只做背景微调），避免整行一起发光。

### 4.3 焦点可见性

鼠标点击不该画焦点框，键盘操作必须画。这条用 `:focus-visible` 表达，Chromium 86 起可用（[MDN :focus-visible](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible)）。底线是：**永远不要 `outline: none` 而不给替代**；页签是 `<button>`，药丸目前是带点击的 `<span>`——没有 `tabindex` 就根本进不了 Tab 序列，加动效时顺手补上键盘可达性，比事后补便宜。

### 4.4 命中面积

列表页药丸按现有样式算出来约 21px 高（`font-size: 11px` 乘 `line-height: 1.7` 得 18.7，加 1px 上下内边距与 1px 边框），低于 WCAG 2.5.8「最小 24×24 CSS 像素」（AA）的要求；该条款允许「间距例外」——只要以目标为中心的 24px 圆互不相交也算通过，而药丸之间是 `margin-right: 4px`，大概率不满足（[WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)）。加动效会让人更想去点，所以至少把可点区域用 `::before { inset: -2px }` 撑到 24px。

## 5. 减弱动效与可访问性底线

- **不是全关，是替换**。规范给出的方向是：减少或替代那些会引发不适的运动，而不是让界面变得没有反馈（[WCAG 2.3.3 交互动画](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)，AAA）。落到本仓：`prefers-reduced-motion: reduce` 下把位移改成 120ms 的底色 / 描边渐变，选中块直接跳到目标位。现有代码里已有 7 处这样处理（例如 `src/client/views/feedback/feedback-styles.ts:26` 与 `:47` 把动画换成 `brightness`），照这个写法扩展即可。
- **hover 不能是唯一线索**。现在的页签提示挂在 `onMouseMove` 上，键盘聚焦时不会出现；凡是「悬停才出现的信息」，WCAG 1.4.13（AA）要求它能被关闭、指针能移进移出而不消失、且不自动过期（[WCAG 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)）。补一个 `onFocus` 触发是最低成本的修法。
- **对比度按最坏情况算**：玻璃、半透明高光、按下态变暗都会改变实际对比度。选中态使用 `rgba(255,255,255,.14)` 这类叠加时，要在最亮的底色上验一遍。
- **状态不能只靠颜色**：当前页签已经有底色 + 边框 + 文字色三重区分，药丸只有底色 + 边框，对色弱用户偏弱；动效不能替代「选中态本身足够明显」。

## 6. 给本仓的三套方案

三套都能落进现有结构：页签在 `src/client/views/shared/Tabs.ts:58` 生成，样式在 `src/client/kernel/styles.ts:33-45`；药丸在 `src/client/views/ListTab.ts:423-447`，基础样式 `src/client/kernel/styles.ts:63`。

### 方案 A：共享墨块 + `linear()` 缓动（推荐做主路径）

要点：墨块绝对定位、不吃点击（`pointer-events: none`）；只做一次布局读；宽度瞬间设值、位移走过渡；拉伸用独立的 `scale` 属性配 `@keyframes`，和 `transform` 分开（两者是独立属性，按 translate → rotate → scale → transform 的顺序合成，互不覆盖）。

```js
// 点击时只做一次读、一次写。页签固定 5 颗，符合第 1.1 节说的「次数固定」放行条件。
function moveInk(row, activeBtn) {
  const b = activeBtn.getBoundingClientRect()   // 唯一一次布局读
  const r = row.getBoundingClientRect()
  row.style.setProperty("--ink-x", (b.left - r.left) + "px")
  row.style.setProperty("--ink-w", b.width + "px")
  const ink = row.querySelector(".dsws-ink")
  ink.classList.remove("dsws-ink-squash")
  void ink.offsetWidth                           // 固定一次，用来重启动画
  ink.classList.add("dsws-ink-squash")
}
```

```css
.dsws-tabs { position: relative; }
.dsws-ink {
  position: absolute; inset-block: 0; left: 0;
  width: var(--ink-w, 0px);
  border-radius: 6px;
  background: rgba(255, 255, 255, .14);
  border: 1px solid var(--dsw-alias-border-l1, #2a2d35);
  transform: translateX(var(--ink-x, 0px));   /* 只有它参与过渡 */
  transition: transform 240ms linear(0, .55 30%, 1.06 62%, .99 84%, 1);  /* Chromium 113+ */
  pointer-events: none;                        /* 不抢页签的点击 */
}
@keyframes dsws-ink-squash {
  0%   { scale: 1 1; }
  38%  { scale: 1.07 .93; }   /* 起手拉宽压扁；压扁量别超过 7%，否则像故障 */
  100% { scale: 1 1; }
}
.dsws-ink.dsws-ink-squash { animation: dsws-ink-squash 260ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .dsws-ink { transition: none; }
  .dsws-ink.dsws-ink-squash { animation: none; }
}
```

取舍：改动集中在页签行一层，药丸共用同一套变量；快速连点由过渡自己接管，不用写取消逻辑；只用一次布局读，同时最多 2 条动画。风险是 `linear()` 若被后人换回普通 `cubic-bezier`，拉伸感会消失——在样式旁边写一句注释说明用途。

### 方案 B：页签条一层玻璃 + 方案 A 的墨块

要点：玻璃只铺页签条（高度约 30px、宽度不超过面板），不铺列表行与卡片；背后必须有自己画的稳定底色，不让滚动内容直接透上来；同时给出减弱透明度与高对比两种偏好的降级。

```css
.dsws-tabs {
  position: relative;
  background: linear-gradient(180deg, rgba(24,24,27,.72), rgba(24,24,27,.55));
  backdrop-filter: blur(10px) saturate(1.08);
  border-bottom: 1px solid rgba(255, 255, 255, .06);
}
@media (prefers-reduced-transparency: reduce) {
  .dsws-tabs { background: #18181b; backdrop-filter: none; }
}
@media (forced-colors: active) {
  .dsws-tabs { background: Canvas; backdrop-filter: none; }
}
```

取舍：视觉上最接近「液态材质」，但收益集中在一处、代价也集中在一处——只要不开到列表行，滚动时的重模糊就只有这一条。注意不要让**面板容器**（而不是页签条）带玻璃，否则 `src/client/kernel/portal.ts:18` 记的 `fixed` 包含块问题会波及所有浮层。

### 方案 C：纯弹跳回弹，不引入墨块与玻璃

要点：每颗页签自己换底色，选中时做一次短促的缩放弹跳；按下态用 `:active` 变暗并微缩。改动最小、可回退性最好。

```css
.dsws-tab {
  transition: background-color 160ms ease, color 160ms ease,
              scale 200ms cubic-bezier(.34, 1.56, .64, 1);  /* 末段超过 1 就是回弹 */
}
.dsws-tab.on  { background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,.14));
               animation: dsws-tab-pop 220ms cubic-bezier(.34, 1.56, .64, 1); }
@keyframes dsws-tab-pop { from { scale: .94; } to { scale: 1; } }
.dsws-tab:active { scale: .97; }
@media (hover: hover) and (pointer: fine) {
  .dsws-tab:not(.on):hover { background: rgba(255, 255, 255, .06); }
}
```

取舍：没有「滑动」的连续感（用户要的 A 方向没有完全满足），但没有新增元素、没有布局读、没有合成层，是「先上线再迭代」的稳妥版本。`cubic-bezier` 最后一段超过 1 就是回弹，这也是唯一需要手调的参数。

### 三者对比

| | 视觉达成 | 改动面 | 性能风险 | 可回退性 | 何时选 |
| --- | --- | --- | --- | --- | --- |
| A 墨块 | 滑动 + 拉伸 + 回弹，完整 | 页签行一层 + 一次布局读 | 低 | 好（删一个元素） | **默认** |
| B 玻璃 + A | 完整，且带材质 | 页签条背景 + 两组降级分支 | 中（滚动期重新模糊） | 中（要同时撤降级） | 用户明确要「玻璃 / 液态材质」时 |
| C 弹跳 | 只有回弹，没有滑动 | 三条 CSS 规则 | 极低 | 最好 | 想先小步验证手感时 |

## 7. 要不要先做可交互原型

**要，但只做一次，而且先放在插件外面。** 理由是两件事混在一起会互相污染：面板与 DSH 外壳共享同一份文档，强制重排按整棵文档收钱（见 `docs/adr/20260911-zero-layout-jitter.md` 的实测），在真面板里量一个 240ms 动画的开销，量到的其实是外壳的账；而从空页面量的数，又回答不了「在 320px 宽、11px 字、5 颗页签挤在一起时好不好看」。

分两步：

1. **独立 HTML 单页对照**（一个文件、无构建、不装库）：把 A / B / C 三套并排放在 320px 与 400px 两种宽度下，页签 5 颗、药丸三组、列表 50 行，鼠标与键盘都能操作。只看三件事：选中的那颗是不是一眼能认出来、连点 10 次会不会飘、开着「减弱动效」时是否还读得懂。
2. **真机一次**：装进 DSH 后在真实面板里点开列表页，用 Chrome DevTools 的 Performance 面板看两笔账——连点 5 次页签时的最长帧，滚动 50 行列表时的最长帧。判据沿用上面那份优化记录：长动画帧与提交时间不因动效明显抬高；如果有，先摘 B（玻璃），A 的 `transform` 通常不会成为瓶颈。

不建议跳过原型直接改源码：三套方案在代码上互相重叠（都要动页签行与药丸样式），改完再比就等于先选了一个再论证它。

## 8. 一手来源

- View Transition API 定义与降级写法：<https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>、<https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition>；`finished` 的履行 / 拒绝条件：<https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition/finished>
- 元素作用域的 View Transition：<https://developer.mozilla.org/en-US/docs/Web/API/Element/startViewTransition>；过渡被打断时重定目标：<https://drafts.csswg.org/css-transitions-1/#starting>
- 形状插值规则（点数必须一致）：<https://drafts.csswg.org/css-shapes-1/#interpolation-of-basic-shapes>；注册自定义属性：<https://developer.mozilla.org/en-US/docs/Web/CSS/@property>；`linear()` 缓动：<https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear>
- `will-change` 的使用警告：<https://developer.mozilla.org/en-US/docs/Web/CSS/will-change>；backdrop root 与会触发它的属性：<https://drafts.csswg.org/filter-effects-2/#BackdropRoot>
- `backdrop-filter`：<https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter>；合成友好的属性：<https://web.dev/articles/animations-guide>；FLIP 的四步：<https://aerotwist.com/blog/flip-your-animations/>
- `hover` 媒体特性：<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover>；`:active` 语义与祖先传递：<https://developer.mozilla.org/en-US/docs/Web/CSS/:active>；`:focus-visible`：<https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible>
- 减弱动效与减弱透明度：<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>、<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency>
- WCAG 2.3.3 交互动画：<https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html>；1.4.13 悬停或聚焦出现的内容：<https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html>
- WCAG 2.5.8 目标尺寸：<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>；1.4.3 对比度：<https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
