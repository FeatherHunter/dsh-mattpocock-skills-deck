# #1787 调研：backdrop-filter 浮层会不会闪，以及 WCAG 对比度在半透明背景上怎么算

> 本文件由 AI 在 /research 阶段写成；只查外部一手资料（W3C 规范与 WAI 文档、MDN、Chromium 源码 / Gerrit 改动 / 缺陷记录、web-platform-tests），不改业务代码、不动票面、不提交。文中每条结论后面都给了来源 URL；标「只有二手」的说法是本次找不到一手来源的，不能当证据用。检索日期 2026-11-01。

## 调查范围

- 问题一：`backdrop-filter` 元素放在 `position: fixed`、并带 `transform: translateX(-50%)` 的浮层里（水平居中常产生亚像素偏移），祖先的 `opacity` 又被 `requestAnimationFrame` 逐帧改动，Chromium / Electron 会不会出现闪烁（flicker）、重采样抖动（shimmer）。
- 问题二：WCAG 2.2 的 4.5:1 与 3:1、大字号到底是多少 px / pt；文字落在半透明或已被 `backdrop-filter` 模糊的背景上、背后像素不确定时，官方要求怎么估算与验证。
- Electron 沿用 Chromium 的 Blink 与 cc 合成器，所以下文一律以 Chromium 的规范、源码与缺陷记录为准。
- 不做什么：不设计修法、不测本仓代码、不判断票面里某段 CSS 具体由哪一条属性触发。

## 一句话结论

**问题一：机制上这条组合正好踩在 backdrop root 会被反复重建的路径上，但本次没有找到任何一条点名「fixed + translateX(-50%) + 祖先 opacity 逐帧动画」的一手记录。** 能确定的是三件事：规范要求凡是会创建 backdrop root 的取值（含 `opacity < 1`）都必须立刻把 root 建好，理由原文就是避免动画期间渲染外观改变；Chromium 2025-05 与 2026-02 各修了一次 backdrop root 创建错误，另有一条标题写着 still has significant flicker 的缺陷；wpt 对 backdrop-filter 叠 transform 的组合放宽到每像素最多差 200/255。所以只能写到「落在已知会变化的渲染条件里、风险高」，写不到「Chromium 已确认该组合必然闪烁」。

**问题二：正文 4.5:1、大字号 3:1；大字号指不小于 18pt（约 24px）或不小于 14pt 粗体（约 18.5px）；`bold` 在 WCAG 里没有数值定义，业界按 `font-weight: 700`。** 背景不确定时，WCAG 要求对着「正常使用时文字背后的颜色」算；技术 G18 允许把文字背后那块背景加深，或给文字加至少 1px 描边；W3C 的 ACT 规则示范了做法——半透明文字分别与黑、白背景合成后各算一次，报成一个区间（2.3:1–4.2:1），并写明「通过该规则不等于满足 SC」。被模糊过的背景没有专门条款，只能按模糊邻域的最坏取值估算。

## 一、backdrop-filter 在 Chromium 里是怎么被画出来的

### 1.1 它只模糊到 backdrop root 为止，不是模糊「屏幕后面的一切」

MDN 原文：backdrop-filter applies filter effects to the pixels painted behind an element, up to the nearest ancestor that is a backdrop root. Content above the backdrop root is not affected.（https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter）

同一页列出会形成 backdrop root 的取值：根元素；`filter` 不为 `none`；`opacity` 小于 1；`mask` / `mask-image` / `mask-border` / `clip-path` 不为 `none`；`backdrop-filter` 不为 `none`；`mix-blend-mode` 不为 `normal`；以及 `will-change` 指名上述任一属性。

MDN 举的例子正是本题的形状：if a parent element has opacity: 0.9, it becomes a backdrop root and any child's backdrop-filter will only blur the content between that parent and the child - not the content behind the parent. This is a common source of confusion（同上）。

### 1.2 祖先的 opacity 一旦变化，backdrop root 的范围就跟着变

CSS Filter Effects 2 的 Backdrop Root Triggers 一节（https://drafts.csswg.org/filter-effects-2/）先说清自己还不是定论：This section is non-normative；This specification does not yet have Working Group consensus, specifically on the definition of Backdrop Root. See discussion in issue 53. 然后给出一条对本题最关键的规定：

> The will-change hint means that the element might take on a value that creates a Backdrop Root. For this reason, the Backdrop Root should be created immediately, to avoid changing it (and therefore changing the rendered appearance) during animation.

也就是说：规范自己承认，backdrop root 在动画期间被创建或取消会改变渲染外观，所以要在动画开始前就把它固定下来。同节把 `opacity` 列入触发条件时给的理由是它会被应用两次、效果相当于 (Opacity)²；并把「嵌套 backdrop-filter 会让重绘呈指数增长」「放宽触发条件会带来 CPU/GPU 内存与带宽开销大约翻倍」写成限制理由（同上）。这两条解释了为什么本组合在渲染成本上本来就敏感。

### 1.3 transform 让 fixed 浮层的包含块换人

CSS Transforms 1 原文：any value other than none for the transform property also causes the element to establish a containing block for all descendants. Its padding box will be used to layout for all of its absolute-position descendants, fixed-position descendants, and descendant fixed background attachments.（https://drafts.csswg.org/css-transforms-1/#transform-rendering）

所以浮层自己带 `translateX(-50%)` 之后，它内部的 `position: fixed` 子孙已经不再相对视口定位，而是相对这块被平移过的 padding box 定位。这一点与闪烁不直接等价，但它决定了「固定」在合成器里到底固定在哪一层上，排查时需要一起看。

### 1.4 Chromium 确实为 backdrop-filter 单独建渲染表面

- `third_party/blink/renderer/core/paint/compositing/compositing_reason_finder.cc:235-237`：`HasBackdropFilter()` 直接返回 `CompositingReason::kBackdropFilter`，带 backdrop-filter 的元素必然被提升为合成层（https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/paint/compositing/compositing_reason_finder.cc）。
- 同一文件 `:620-626` 的注释：Only composite a backdrop-filter animation if the value may change, because a composited backdrop-filter effect requires render surfaces for the element and for its backdrop root. An animation whose value can't change still makes the element a stacking context…（同上）——一个 backdrop-filter 效果要两个渲染表面：元素自己一个、backdrop root 一个。
- `cc/trees/effect_node.h:35-50` 的 `RenderSurfaceReason` 枚举里有 `kBackdropScope`（注释 Defines the scope of the backdrop for child blend mode or backdrop filter.）、`kBackdropFilter`、`kBackdropFilterAnimation`（https://chromium.googlesource.com/chromium/src/+/main/cc/trees/effect_node.h）。
- `cc/trees/draw_property_utils.cc:784-845`：backdrop-filter（包括只是可能变成动画的那种）会让 `lcd_text_disallowed_by_backdrop_filter` 成立，并沿 effect tree 向上传播，即关闭 LCD 文本抗锯齿（https://chromium.googlesource.com/chromium/src/+/main/cc/trees/draw_property_utils.cc）。这解释了为什么带 backdrop-filter 的浮层里文字观感会和别处不同。

### 1.5 已知缺陷：只能拿到标题级证据

issues.chromium.org 的正文由脚本渲染，本次抓取只拿到标题与少量元数据，所以下表只能当「存在这么一条记录」的弱证据，不能引用其中的复现步骤或结论。

| 编号 | 标题（原文） | 它能说明什么 | 它不能说明什么 |
| --- | --- | --- | --- |
| [366415129](https://issues.chromium.org/issues/366415129) | Inconsistent backdrop-filter painting still has significant flicker | 组件 Blink>Paint 下有一条明确以 flicker 为题的记录，2024-09-13 创建，2026-02 仍在更新 | 它的复现场景、是否已修、是否与本组合一致 |
| [40040614](https://issues.chromium.org/issues/40040614) | backdrop-filter: blur has large discontinuity on chrome due to clipping backdrop | backdrop 被裁剪时会出现大片不连续，方向与 backdrop root 范围变化一致 | 是否为同一根因 |
| [40067168](https://issues.chromium.org/issues/40067168) | Backdrop-filter:blur transition glitches | 过渡期间 backdrop-filter 会出 glitch | 具体触发属性 |
| [407785181](https://issues.chromium.org/issues/407785181) | backdrop-filter 和 mix-blend-mode affect subpixel text antialiasing differently | 亚像素文本抗锯齿在 backdrop-filter 下行为不同 | 是否表现为整块闪烁 |
| [323735424](https://issues.chromium.org/issues/323735424) | backdrop-filter not working with transform-style:preserve-3d | 与 3D 变换组合时失效 | 与本题的 2D 平移无关 |
| [40256713](https://issues.chromium.org/issues/40256713) | backdrop-filter effects don't scale with the browser window | 缩放/尺寸变化下不跟随 | 与 opacity 动画无关 |

### 1.6 Chromium 到 2026 年还在修 backdrop root 的创建逻辑

下面都是已合并的改动（Gerrit，URL 形如 https://chromium-review.googlesource.com/c/chromium/src/+/<编号>）：

| 改动 | 合并时间 | 与本题的关系 |
| --- | --- | --- |
| 6470926（Bug 338250112） | 2025-05-23 | 原文：Current backdrop-filter spec requires that a root is created for any element with a will-change: on a property that would create a backdrop root… will-change does not. This change ensures an EffectNode is created in this case. 即 2025 年 5 月之前，`will-change` 并没有按规范提前建 root |
| 7425346（Bug 474391730） | 2026-02-05 | 补 `kAuxiliaryReasonsForBackdropRoot`：`mask` 之前没按规范建 root；`will-change: clip-path` 在子树没有 backdrop filter 时反而多建 root |
| 8674102（Bug 575318807） | 2026-10-30 | 原文：pixel-moving backdrop-filter operations (such as blur() and drop-shadow()) do not affect layer bounds，带 reference filter 时不能合成，得回主线程 |
| 8510816（Bug 569098933） | 2026-10-07 | 静态的 backdrop filter 动画不再合成 |
| 7207992（Bug 40846369） | 2025-12-05 | 支持非合成的 CSS backdrop-filter |
| 6916525 | 2025-09-04 | 给 `backdrop-filter-basic-opacity-2` 加模糊容差：差异在 GPU 附近，result may be either 128 or 127 |

一条一条读下来，结论是：backdrop root 的「什么时候建、建在哪」在 Chromium 里是一个 2025–2026 还在变动的地方，而祖先 opacity 正是触发条件之一。这与「该组合风险高」一致，但它仍然不是对该组合的直接确认。

### 1.7 wpt 自己就把 backdrop-filter 叠变换当成「允许有像素差」的场景

- `css/filter-effects/backdrop-filter-transform.html`（backdrop-filter 叠 `rotate(30deg)`）声明 `<meta name=fuzzy content="maxDifference=0-200; totalPixels=0-2000">`，即允许单像素最多差 200/255、最多 2000 个像素不同（https://raw.githubusercontent.com/web-platform-tests/wpt/master/css/filter-effects/backdrop-filter-transform.html）。
- `css/filter-effects/backdrop-filter-backdrop-root-animation-in-effect.html` 测的正是「父元素 opacity 动画 + 子元素 backdrop-filter」：动画是 `animation: fadeIn 1s steps(3, jump-none) -0.9s; animation-fill-mode: forwards`，注释引 Web Animations 规范的 side effects 一节说明动画结束后仍生效的效果要当作存在对应的 `will-change`，这里等价于 `will-change: opacity`；断言用 `document.getAnimations()[0].finished.then(takeScreenshot)`，**只比对终帧**，`-ref.html` 用 `will-change: opacity` 代替动画（https://raw.githubusercontent.com/web-platform-tests/wpt/master/css/filter-effects/backdrop-filter-backdrop-root-animation-in-effect.html）。

这两份测试合起来说明：这个组合在规范侧被承认会因实现不同产生像素差异，因此测试只敢卡容差与终帧；中间帧的稳定性不是被断言的对象。

### 1.8 规范与源码里能找到的规避方向（不是修法设计）

1. **让 backdrop root 在动画全程保持不变。** 规范要求 `will-change` 情形立刻建 root，就是为了不在动画期间改变外观（https://drafts.csswg.org/filter-effects-2/）。推论：不要在一段动画里让 `opacity` 从 1 走到小于 1 再走回去，也不要在动画期间增删 `filter` / `clip-path` / `mask`。
2. **不要在动画祖先里嵌套 backdrop-filter。** 规范把「嵌套会指数级增加重绘」写成限制触发条件的理由（同上）。
3. **静态的 backdrop-filter 不该被动画牵着走。** Chromium 只在取值可能变化时才合成 backdrop-filter 动画，因为每个这样的效果要元素与 backdrop root 两个渲染表面（compositing_reason_finder.cc:620-626）。
4. **pixel-moving 的 backdrop-filter 操作（`blur()`、`drop-shadow()`）与 reference filter 不能混着合成**，会被拉回主线程（CL 8674102）。

### 1.9 只有二手来源、不能当证据的说法

下面这些在社区博客与问答里很常见，但本次没有找到一手来源，本笔记不采用：

- 「`translateX(-50%)` 造成的半像素偏移必然导致 backdrop-filter 闪烁」——一手侧只有 wpt 的像素容差与 issue 407785181 的标题，二者都不能支撑「必然」。
- 「给浮层加 `will-change: transform` 就能消除闪烁」——规范里 `will-change` 对 backdrop root 的作用是「立刻创建」，与消除闪烁不是一回事；把它当成修复手段没有依据。
- 「`backdrop-filter` 放在 fixed 元素上会重绘整个视口」——没有找到量化来源。
- 「加 `contain: paint` 或 `will-change: opacity` 即可稳定」——`will-change: opacity` 在规范里恰恰会创建 backdrop root（https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter），是改变行为而不是消除问题；`contain` 与 backdrop-filter 的相互作用本次没有找到一手说明。

## 二、WCAG 2.2 的对比度口径

### 2.1 数字：4.5:1 与 3:1

SC 1.4.3 Contrast (Minimum) 原文：The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for the following: Large Text — Large-scale text and images of large-scale text have a contrast ratio of at least 3:1; Incidental…; Logotypes…（https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html，规范正文见 https://www.w3.org/TR/WCAG22/#contrast-minimum）。AAA 的 1.4.6 是 7:1，本次不展开。

### 2.2 大字号是多少 px / pt

- 术语定义：large scale (text) — with at least 18 point or 14 point bold or font size that would yield equivalent size for Chinese, Japanese and Korean (CJK) fonts（https://www.w3.org/TR/WCAG22/#dfn-large-scale，源码 https://raw.githubusercontent.com/w3c/wcag/main/guidelines/terms/20/large-scale.html）。
- 单位换算原文：Point sizes are based on the CSS pt size as defined in CSS3 Values. The ratio between sizes in points and CSS pixels is 1pt = 1.333px, therefore 14pt and 18pt are equivalent to approximately 18.5px and 24px.（https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html）
- 判定口径：字号取「交付时的大小」，不含用户缩放；拿不到就按用户代理给出的值或按字体度量算（同上与术语页）。
- 中文等 CJK 字体允许「等效字号」，即不必死守 18pt/14pt 的拉丁字形尺度（术语页）。
- `bold` 的数值：WCAG 正文与术语页都只用 bold 一词，没有给字重数值（同上）。CSS 侧 `font-weight: bold` 对应 700（https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight，规范见 https://drafts.csswg.org/css-fonts-4/#font-weight-prop），验证工具通常按 700 及以上当作粗体。

### 2.3 比值怎么算

- 定义：(L1 + 0.05) / (L2 + 0.05)，L1 是较亮色的相对亮度、L2 是较暗色（https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio，源码 https://raw.githubusercontent.com/w3c/wcag/main/guidelines/terms/20/contrast-ratio.html）。
- 相对亮度：L = 0.2126R + 0.7152G + 0.0722B，单通道不超过 0.04045 时除以 12.92，否则取 ((c + 0.055) / 1.055)^2.4（https://www.w3.org/TR/WCAG22/#dfn-relative-luminance）。
- 可以在关闭抗锯齿的情况下取值：Because authors do not have control over user settings as to how text is rendered (for example font smoothing or anti-aliasing), the contrast ratio for text can be evaluated with anti-aliasing turned off.（contrast-ratio 术语页）

### 2.4 背景不确定时，官方到底要求对着什么算

- 基准是「正常使用时文字背后的那个颜色」：For the purpose of Success Criteria 1.4.3 Contrast (Minimum) and 1.4.6 Contrast (Enhanced), contrast is measured with respect to the specified background over which the text is rendered in normal usage. If no background color is specified, then white is assumed.（https://raw.githubusercontent.com/w3c/wcag/main/guidelines/terms/20/contrast-ratio.html）
- 背景会变化时，以文字紧邻的那块背景为准，并允许改造它：If the background or the letters vary in relative luminance (or are patterned) then the background around the letters can be chosen or shaded so that the letters maintain a 4.5:1 contrast ratio with the background behind them even if they do not have that contrast ratio with the entire background. 并建议加深字后背景、或加至少 1px 的黑色描边、或加 halo（https://www.w3.org/WAI/WCAG22/Techniques/general/G18）。
- 背景是图片时，比最不利的那部分：For pictures, this means that there would need to be sufficient contrast between the text and those parts of the image that are most like the text and behind the text.（https://www.w3.org/WAI/WCAG22/Techniques/failures/F83）

### 2.5 半透明背景：W3C 的示范做法是「先合成、再取区间」

W3C 的 ACT 规则 afw4f7（https://www.w3.org/WAI/standards-guidelines/act/rules/afw4f7/）是官方对这条 SC 的机器可判定化尝试，它的示例把做法演示得很清楚：

- Failed Example 7 用 `color: rgba(90, 90, 90, 0.8)` 的半透明文字压在黑白各半的背景上，描述写的是 a contrast ratio between 2.3:1 and 4.2:1 on the black and white background，即把半透明前景分别与黑、白背景合成后各算一次，报成区间。
- Passed Example 2 是白到蓝的渐变背景，写 contrast ratio between 12.6:1 and 5:1；Passed Example 3 是图片背景加 `text-shadow`，写 between 13:1 and 5:1。三个例子都是「取两端、报区间」，没有把背景当成一个确定的单色。
- 规则自己声明通过不等于达标：Passing this rule does not mean that the text has sufficient color contrast. If all background pixels have a low contrast with all foreground pixels, the success criterion is guaranteed to not be satisfied. When some pixels have sufficient contrast, and others do not, legibility should be considered. There is no clear method for determining legibility when some but not all pixels have sufficient contrast, which is why passing this rule does not necessarily mean the corresponding success criterion is met.

合成公式来自 CSS Compositing and Blending Level 1 的 simple alpha compositing 一节：co = Cs x αs + Cb x αb x (1 - αs)，αo = αs + αb x (1 - αs)；其中 co 是合成后的预乘像素值，Cs/αs 是前景，Cb/αb 是背景（https://www.w3.org/TR/compositing-1/#simplealphacompositing）。当合成结果的 αo 小于 1 时，还需除以 αo 才得到用于算相对亮度的颜色值。

### 2.6 把上面几条落到「文字压在 backdrop-filter 上」

按规范原文可以确定的部分：基准是「正常使用时文字背后的颜色」，也就是把文字下方所有层按上面的公式合成之后、真正显示出来的那个颜色；不是设计稿上气泡的填充色。模糊会把这个颜色变成邻域像素的混合，所以它逐点不同，只能用区间描述。

本次从规范推出来的部分（规范没有逐条写，属于合理外推，写作时不要当成原文）：

1. 先算出文字下方各层合成后的颜色，而不是拿某一层的 `background-color` 直接当背景。
2. 模糊半径范围内的背景要取极值：最亮的可能背景算一次、最暗的算一次，两个比值都报出来，按最差的那个判定是否达到 4.5:1（示例形式与 ACT 的区间写法一致）。
3. 如果极值跨不过 4.5:1（比如气泡后面的内容是一张照片或一段视频），按 G18 的路子改设计：给文字一块足够不透明或足够暗的底，或者给文字加至少 1px 的描边/halo，让「文字背后的背景」重新变成确定的。
4. 报告时给区间与取值依据，不要只报一个数——W3C 自己的示例就是这么写的。

### 2.7 这部分找不到一手来源的地方

- WCAG 2.2 正文与 Understanding 文档里没有出现 backdrop-filter / blur 字样，没有针对滤镜或模糊背景的条款（https://www.w3.org/TR/WCAG22/）。
- ACT 规则没有说明背景是模糊产物时如何采样，也没给出「取极值」的明文，只能从示例反推。
- WCAG 没有给 bold 的字重数值定义（见 2.2）。
- 「半透明背景必须先合成再算」这句话在任何 W3C 文档里都没有以这一句出现；能引的只有 CSS Compositing 的合成公式与 ACT 示例的做法。

## 三、本仓实证：祖先 opacity 动画会让药丸的 backdrop-filter 实际失效

调查范围里说过这条笔记不测本仓代码。诊断 #1787 时为了回答「闪烁是不是界面自身造成」，我另做了一个最小复现页与逐像素比较，结论记在这里；证据文件在仓库外的临时目录，路径一并写出，方便复核。

实验页 `D:/Temp/dsh-suggest-bug/glass-repro.html`：深色背景 + 背后有真实聊天文字 + 一层浅色面板；容器 `.row` 里一颗药丸 `.pill`，药丸的 `backdrop-filter: blur(12px) saturate(1.2)` 与底色渐变照搬本仓 suggestAppearance 的取值。用 CDP 驱动 headless Chrome 156 截取药丸区域（deviceScaleFactor 2，351×86 PNG），再用自写的纯 Node PNG 解码器逐像素比较（阈值 16/255，22px 网格，共 30186 像素）。

| 对比 | 差异像素占比 |
| --- | --- |
| 祖先 opacity 1 vs 完全无 opacity 属性 | 0 |
| 祖先 opacity 0.999 vs 1 | 27.16% |
| 祖先 opacity 0.9999 vs 1 | 34.21% |
| 祖先 opacity 0.99 vs 1 | 40.53% |
| 祖先 opacity 0.5 vs 1 | 75.08% |
| 祖先 0.9999、药丸 `backdrop-filter:none` vs 祖先 0.9999、blur 开启 | 0 |
| 药丸自己 opacity 0.9999 vs 全 1 | 0 |
| 药丸自己 opacity 0.5 vs 全 1 | 70.46% |

两条决定性结果：

1. **祖先 opacity 0.9999 时，把药丸的 backdrop-filter 关掉，画面差 0 像素**——祖先不到 1 的时候，药丸的毛玻璃在画面上根本不存在。
2. **祖先保持 1、只把药丸自己的 opacity 设成 0.9999，画面差 0 像素**——把淡入做在药丸自己身上，毛玻璃完整保留。

对照实验里，祖先 1、药丸无 blur 与基线的差异也是 34.21%，与祖先 0.9999 那组的最差网格位置相同，说明两次观察的是同一个机理：毛玻璃的有无，而不是亮度变化（两种画面的均值颜色几乎相同：151.9/163.5/176.4 对 151.5/163.7/175.9）。

这与规范对 Backdrop Root 的定义一致：祖先 opacity 小于 1 会让它成为 backdrop root，药丸的背板被截到祖先内部，而祖先内部除此之外是空的。于是「逐帧改祖先 opacity」的入场动画，实际上是在逐帧关掉又打开毛玻璃；opacity 恰好等于 1 的那一帧，27%–41% 的像素会跳变超过 16 级。

对本仓的对应关系：`suggestEngine.ts` 第 167、194 行逐帧写的是祖先 `.dsws-sugg-row` 的 opacity，所以设计里最长约 1.5 秒的入场，毛玻璃全程关着，到最后一帧才突然打开；如果同时还存在计时缺陷（见 #1787 诊断记录），这段会被压成 1–2 帧，看起来就是「一闪」。

修法方向（本轮只记录，不实施）：不要动祖先 row 的 opacity；把淡入做在每颗药丸自己的 opacity 上（实测像素级无损），或者用 transform 做入场。不要用 `will-change: opacity` 当偏方——按规范它恰恰会常驻一个 backdrop root，让毛玻璃永久失效。

限制：实验页是照着本仓样式做的最小复现，不是 DSH 桌面端本身；headless Chrome 156（`--disable-gpu`）与真实桌面的渲染路径可能不同；截图是 deviceScaleFactor 2 下的药丸区域，阈值 16/255 只统计肉眼可辨的差异，不代表逐帧时序。结论的适用范围是「机制成立」，不是「真机上每一次闪烁都由它造成」。

## 对本仓的含义

若本仓界面里的气泡用 backdrop-filter 做毛玻璃，那么逐帧改祖先 opacity 正好会让 backdrop root 在动画期间反复变化——这正是规范要求提前固定、Chromium 到 2026 年还在修的那条路径，所以「看起来闪」不应先怀疑显示器或 GPU，而应先看气泡上方有没有动画中的祖先。对比度这边，气泡文字不能按设计稿上的填充色算比值：必须先按 CSS 合成公式算出文字背后真实显示的颜色，再对模糊邻域的极值取最差情况，必要时按 G18 给文字加底或描边，让背景重新确定下来。

## 出处

规范与文档：

- CSS Filter Effects 2（Backdrop Root Triggers，非规范性草稿）：https://drafts.csswg.org/filter-effects-2/
- CSS Transforms 1（transform 建立包含块）：https://drafts.csswg.org/css-transforms-1/#transform-rendering
- CSS Compositing and Blending Level 1（simple alpha compositing）：https://www.w3.org/TR/compositing-1/#simplealphacompositing
- CSS Fonts 4（font-weight）：https://drafts.csswg.org/css-fonts-4/#font-weight-prop
- MDN backdrop-filter：https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter
- MDN font-weight：https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight
- Web Animations 1（动画结束后的 side effects）：https://drafts.csswg.org/web-animations-1/#side-effects-section

Chromium 与 wpt：

- compositing_reason_finder.cc：https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/paint/compositing/compositing_reason_finder.cc
- effect_node.h：https://chromium.googlesource.com/chromium/src/+/main/cc/trees/effect_node.h
- draw_property_utils.cc：https://chromium.googlesource.com/chromium/src/+/main/cc/trees/draw_property_utils.cc
- Gerrit 6470926：https://chromium-review.googlesource.com/c/chromium/src/+/6470926
- Gerrit 7425346：https://chromium-review.googlesource.com/c/chromium/src/+/7425346
- Gerrit 8674102：https://chromium-review.googlesource.com/c/chromium/src/+/8674102
- Gerrit 8510816：https://chromium-review.googlesource.com/c/chromium/src/+/8510816
- Gerrit 7207992：https://chromium-review.googlesource.com/c/chromium/src/+/7207992
- Gerrit 6916525：https://chromium-review.googlesource.com/c/chromium/src/+/6916525
- issue 366415129：https://issues.chromium.org/issues/366415129
- issue 40040614：https://issues.chromium.org/issues/40040614
- issue 40067168：https://issues.chromium.org/issues/40067168
- issue 407785181：https://issues.chromium.org/issues/407785181
- issue 323735424：https://issues.chromium.org/issues/323735424
- issue 40256713：https://issues.chromium.org/issues/40256713
- wpt backdrop-filter-transform.html：https://raw.githubusercontent.com/web-platform-tests/wpt/master/css/filter-effects/backdrop-filter-transform.html
- wpt backdrop-filter-backdrop-root-animation-in-effect.html：https://raw.githubusercontent.com/web-platform-tests/wpt/master/css/filter-effects/backdrop-filter-backdrop-root-animation-in-effect.html

WCAG 与 WAI：

- WCAG 2.2 正文（1.4.3）：https://www.w3.org/TR/WCAG22/#contrast-minimum
- Understanding 1.4.3：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- 术语 large scale：https://www.w3.org/TR/WCAG22/#dfn-large-scale
- 术语 contrast ratio：https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
- 术语 relative luminance：https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
- 技术 G18：https://www.w3.org/WAI/WCAG22/Techniques/general/G18
- 失败技术 F83：https://www.w3.org/WAI/WCAG22/Techniques/failures/F83
- ACT 规则 afw4f7：https://www.w3.org/WAI/standards-guidelines/act/rules/afw4f7/
