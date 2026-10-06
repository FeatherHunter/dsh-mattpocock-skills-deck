# 控件交互反馈方式调研（票 861）

研究问题：外面常用的控件交互反馈方式有哪些（目标几十种），哪些能直接用纯前端视觉在我们的插件里实现？只收人眼能直接看到的反馈，覆盖三个时刻：按下去的瞬间、等结果的过程、成功或失败的结果。不收门禁测试代码。

决策依赖：这份调研的输出将被票 862 直接拿去做原型（把全部效果装进一个超文本文件，一屏看全），再被票 863 拿去定分类规则（从第一性原理定分类）。

调研日期：2026-10-05。

来源策略：一手来源优先。结论只认官方设计系统文档、万维网联盟与 MDN 的规范文档、平台人机界面指南、开源组件库的官方文档页。不用二手博客转述。每种方式都给出能打开的来源链接，优先官方文档页。凡是多种官方做法拼出来的组合做法，会在出处里写明组合了哪几个来源，不冒充某一家官方单独推荐过。本文件里的每个链接都在 2026-10-05 当天实际打开验证过，能正常返回内容。

约束重申：不改变现有布局与外观。所有候选方式必须能在现有布局和外观上直接叠加，不动控件的位置、不动控件的大小、不动现有的配色体系。凡是需要改位置、改大小、引入新颜色体系的，一律不进候选，只进后文不能直接用的方式一节。

## 插件控件范围

这次调研覆盖的控件范围来自地图背景与已有盘点，不只按钮。包括面板里的列表行、工单详情顶栏的一排按钮、弹窗底部的确认与取消按钮、版本管理页签、悬浮技能面板里的条目、底部状态栏、设置页里的开关与按钮、图标小按钮（复制链接、关闭叉、切换后端）。

仓库里已有的盘点是 767 号按钮盘点，它只说清了执行类按钮显示什么字、走哪条注入文本，没有涉及任何视觉反馈。所以这份调研补的是视觉层，和 767 不重复。术语用法跟仓库根目录的术语表保持一致，界面上出现的新说法都用完整句子解释，不造只有这次对话才懂的简称。

等待时长分四档：瞬间指 300 毫秒以内，短指 0.3 秒到 2 秒，中指 2 秒到 10 秒，长指 10 秒以上。操作危险程度分三档：低指普通查看与切换（展开列表、切换页签、复制链接），中指会改数据但可恢复（改标签、发评论、保存设置），高指删票删库一类不可逆操作。

能不能直接叠加分三档：能表示纯加样式或加一个不占布局的覆盖层就能用；有条件能表示要满足某个前提（比如预留文字宽度、只用在列表行、复用现有成功失败色）。候选清单里没有不能这一档，不满足约束的一律进后文单独一节。

## A 按下去的瞬间

这一类都是人按下控件那一刻立刻给的确认，作用是让人知道已经按下去。全部只适合瞬间时长，等待再长的操作也要靠 B 类接上。

### A1 按下态背景加深

长什么样：按住按钮时按钮底色立刻变深一档，松手恢复，看起来像被按下去一块。

适合的等待时长：瞬间。

适合的操作危险程度：低、中、高都可以，这是最基础的确认，危险操作也需要它。

能不能在现有按钮上直接叠加：能。只改按下那一刻的背景明暗，不动位置、大小、配色体系。

出处链接：MDN 按下态文档 https://developer.mozilla.org/en-US/docs/Web/CSS/:active 与 Material 3 按钮文档 https://m3.material.io/components/buttons（两处都把按下态列为按钮的必备状态）

### A2 键盘焦点环

长什么样：用键盘走到某个控件时，控件外圈出现一圈清晰的描边，让人知道回车会落在谁身上。描边用外圈画法，不挤占布局。

适合的等待时长：瞬间。

适合的操作危险程度：低、中、高都可以，这是无障碍必备。

能不能在现有按钮上直接叠加：能。用外圈描边实现，不改变控件占的尺寸。

出处链接：MDN 焦点文档 https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible 与无障碍指南 https://www.w3.org/TR/WCAG21/#focus-visible

### A3 涟漪扩散

长什么样：手指或鼠标落点冒出一圈水波纹，向外扩散后消失。落点在哪里，波纹就从哪里开始。

适合的等待时长：瞬间和短操作。

适合的操作危险程度：低和中。高的危险操作不建议只用这么轻的确认。

能不能在现有按钮上直接叠加：能。在按钮内部加一个不占布局的波纹层，按钮本身设为超出部分裁掉，位置大小都不动。

出处链接：Material 3 按钮文档 https://m3.material.io/components/buttons（把涟漪列为按钮按下反馈的标准做法）

### A4 按压缩小

长什么样：按住时整个按钮均匀缩小一点点，比如缩到原来的百分之九十七，松手弹回。

适合的等待时长：瞬间。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：能。缩小用变形实现，变形不改变布局占位，松手即恢复。

出处链接：MDN 变形文档 https://developer.mozilla.org/en-US/docs/Web/CSS/transform 与苹果人机界面指南按钮章 https://developer.apple.com/design/human-interface-guidelines/buttons

### A5 按压下沉

长什么样：按住时按钮整体往下沉一两个像素，同时加一层内阴影，像真实按键被按进面板。

适合的等待时长：瞬间。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：有条件能。阴影和位移都不能超出按钮原有占位，图标小按钮（关闭叉、复制链接）地方太挤，下沉幅度要更小或者不用。

出处链接：MDN 变形文档 https://developer.mozilla.org/en-US/docs/Web/CSS/transform 与过渡文档 https://developer.mozilla.org/en-US/docs/Web/CSS/transition

### A6 悬停浮起

长什么样：鼠标停在按钮上但还没按时，按钮阴影加深、看起来浮起一层，告诉人这里可以点。

适合的等待时长：瞬间。

适合的操作危险程度：低。只适合查看切换类，改数据的操作不要只靠悬停暗示。

能不能在现有按钮上直接叠加：能。只改阴影，不动位置和大小。

出处链接：Material 3 按钮文档 https://m3.material.io/components/buttons 与苹果人机界面指南按钮章 https://developer.apple.com/design/human-interface-guidelines/buttons

### A7 光泽扫过

长什么样：一道浅色高光从按钮一侧扫到另一侧，像光从按钮表面滑过去，整个过程不到半秒。

适合的等待时长：瞬间。

适合的操作危险程度：低。

能不能在现有按钮上直接叠加：有条件能。用渐变覆盖层实现，不动底色体系；高光颜色必须从现有浅色里取，不能引入新颜色。

出处链接：组合做法：过渡写法依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/transition，时长与缓动依据 Material 3 https://m3.material.io/styles/motion/easing-and-duration

### A8 按下描边高亮

长什么样：按下那一刻按钮外圈闪一下描边，松手消失，适合底色已经很深、加深看不清的按钮。

适合的等待时长：瞬间。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：能。用外圈描边画，不占布局。

出处链接：MDN 按下态文档 https://developer.mozilla.org/en-US/docs/Web/CSS/:active 与 Primer 按钮文档 https://primer.style/components/button

### A9 图标轻推

长什么样：带箭头或小图标的按钮在悬停或按下时，图标往动作方向挪两三像素，比如箭头往右探一下。

适合的等待时长：瞬间。

适合的操作危险程度：低。

能不能在现有按钮上直接叠加：能。只动图标的变形，不动按钮本身。

出处链接：MDN 变形文档 https://developer.mozilla.org/en-US/docs/Web/CSS/transform

### A10 透明度闪

长什么样：按下瞬间按钮整体变淡一档再恢复，适合放不下涟漪和阴影的图标小按钮，比如复制链接和关闭叉。

适合的等待时长：瞬间。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：能。只改透明度，不动任何尺寸位置。

出处链接：MDN 过渡文档 https://developer.mozilla.org/en-US/docs/Web/CSS/transition

### A11 轻微倾斜

长什么样：按下时按钮朝按压方向倾斜一两度，像被按歪一点，松手回正。动感强但容易显乱。

适合的等待时长：瞬间。

适合的操作危险程度：低。

能不能在现有按钮上直接叠加：有条件能。只建议用在弹窗底部的大按钮上，列表行、顶栏、状态栏、图标小按钮一律不用。

出处链接：MDN 变形文档 https://developer.mozilla.org/en-US/docs/Web/CSS/transform

### A12 点击波纹环外扩

长什么样：按下时从按钮边缘向外扩一圈细环并淡出，环画在按钮占位之外，用阴影画所以不挤布局。

适合的等待时长：瞬间和短操作。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：能。用阴影扩散实现，不占布局，适合图标小按钮这种放不下内部涟漪的地方。

出处链接：组合做法：关键帧写法依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/animation，时长缓动依据 Material 3 https://m3.material.io/styles/motion/easing-and-duration

## B 等结果的过程

这一类用在按完之后、结果还没回来之前，作用是让人知道系统正在干活、请稍等，而不是卡死了。

### B1 按钮内转圈

长什么样：按钮原来的图标位置换成一个不停转的小圆圈，按钮大小和文字都不变，转圈表示正在干活。

适合的等待时长：短和中（0.3 秒到 10 秒）。

适合的操作危险程度：低、中、高都可以，高危险操作更要转起来，让人不敢重复点。

能不能在现有按钮上直接叠加：能。转圈占原来图标的位置，尺寸保持一致即可。

出处链接：Primer 转圈文档 https://primer.style/components/spinner 与 Ant 转圈文档 https://ant.design/components/spin 与苹果活动视图指南 https://developer.apple.com/design/human-interface-guidelines/activity-views

### B2 按钮内横向进度条

长什么样：按钮底部贴着一条细进度线，有明确进度时按比例走，没明确进度时来回扫，按钮本身不动。

适合的等待时长：中和长（2 秒以上）。

适合的操作危险程度：中和高。

能不能在现有按钮上直接叠加：能。进度线用绝对定位贴在按钮内部底边，不增加按钮高度。

出处链接：Material 3 进度文档 https://m3.material.io/components/progress-indicators 与 Primer 进度条文档 https://primer.style/components/progress-bar

### B3 省略号加载圆点

长什么样：按钮文字后面跟三个依次跳动的圆点，或者省略号逐字出现，表示正在处理。

适合的等待时长：短（0.3 秒到 2 秒）。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：有条件能。圆点区要提前留好固定宽度，否则文字会左右跳动；图标小按钮没有文字位，放不下就不用这种。

出处链接：组合做法：关键帧写法依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/animation

### B4 禁用态加禁止光标

长什么样：等待期间按钮变灰、点不动，鼠标放上去显示禁止光标，防止人重复点击。

适合的等待时长：短、中、长都可以。

适合的操作危险程度：中和高，防重复提交主要靠它。

能不能在现有按钮上直接叠加：能。禁用是原生支持的状态，不动布局；禁止光标只改鼠标样式。

出处链接：MDN 禁用属性文档 https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/disabled 与光标文档 https://developer.mozilla.org/en-US/docs/Web/CSS/cursor

### B5 骨架占位行

长什么样：列表还没加载完时，先画几条灰色占位条，形状和真实行差不多，内容到了再替换成真内容。

适合的等待时长：短和中。

适合的操作危险程度：低。

能不能在现有按钮上直接叠加：有条件能。只适合面板列表这种成行的区域，工单详情顶栏、弹窗底部、状态栏、图标小按钮都没有行的概念，用不上。

出处链接：Primer 骨架文档 https://primer.style/components/skeleton

### B6 倒计时读秒

长什么样：按钮文字变成还剩几秒，比如重试还要等 5 秒就显示 5、4、3，时间到了自动恢复可点。

适合的等待时长：中和长（2 秒以上，有明确等待时间时）。

适合的操作危险程度：中和高，比如限流重试。

能不能在现有按钮上直接叠加：有条件能。数字宽度会变，要给数字区留固定宽度，或者只用在宽按钮上。

出处链接：无障碍语义依据 https://www.w3.org/TR/wai-aria-1.2/#progressbar（用数值表达进度的做法），转圈与进度条的官方说明见 https://m3.material.io/components/progress-indicators

### B7 百分比数字

长什么样：按钮或其旁边显示百分之几，比如上传到百分之六十，数字随进度涨。

适合的等待时长：中和长（有真实进度时）。

适合的操作危险程度：中。

能不能在现有按钮上直接叠加：有条件能。和倒计时一样需要固定数字宽度；没有真实进度时不许编数字骗人。

出处链接：无障碍进度语义 https://www.w3.org/TR/wai-aria-1.2/#progressbar 与 Material 3 进度文档 https://m3.material.io/components/progress-indicators

### B8 条纹流动

长什么样：进度条里的斜条纹不停流动，表示活还活着，适合有进度但走得慢的场景。

适合的等待时长：短和中。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：能。画在按钮内部的进度线上，不扩大按钮。

出处链接：Material 3 进度文档 https://m3.material.io/components/progress-indicators，动画写法依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/animation

### B9 脉冲呼吸

长什么样：等待期间按钮整体缓慢变亮变暗，像呼吸一样，告诉人还没死机。

适合的等待时长：短（0.3 秒到 2 秒）。

适合的操作危险程度：低。

能不能在现有按钮上直接叠加：能。只改透明度，不动布局。

出处链接：MDN 动画文档 https://developer.mozilla.org/en-US/docs/Web/CSS/animation

### B10 往返扫动

长什么样：一条小亮块在按钮内部左右来回扫，表示进度未知但活还活着。

适合的等待时长：短和中。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：能。亮块用覆盖层实现，不改变按钮尺寸。

出处链接：Material 3 进度文档 https://m3.material.io/components/progress-indicators（不定式进度条的做法）

### B11 状态文字轮换

长什么样：按钮文字按阶段换，比如正在拉取变成正在解析变成正在渲染，让人知道卡在哪一步。

适合的等待时长：中和长（2 秒以上、多阶段任务）。

适合的操作危险程度：中。

能不能在现有按钮上直接叠加：有条件能。每句话长度不一样，要按最长的一句留宽度，否则按钮会伸缩；按钮太窄就不用。

出处链接：无障碍语义依据 https://www.w3.org/TR/wai-aria-1.2/#status（用礼貌播报报告状态变化），进度条官方说明见 https://primer.style/components/progress-bar

### B12 进度环包住图标

长什么样：图标小按钮外面套一圈细圆环，圆环转或者按比例涨，比如刷新、切换后端时用。

适合的等待时长：短和中。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：有条件能。圆环画在图标占位之外一圈，图标格子必须是正方形且周围有一两个像素空隙，太挤的关闭叉要先确认空隙。

出处链接：Material 3 环形进度 https://m3.material.io/components/progress-indicators 与 Primer 转圈文档 https://primer.style/components/spinner

## C 成功或失败的结果

这一类用在结果回来之后，作用是让人一眼看懂成了还是败了、接下来要不要做什么。

### C1 对勾替换

长什么样：成功后按钮里的图标换成一个对勾，停留一两秒再恢复原样。

适合的等待时长：用在短、中、长操作之后。

适合的操作危险程度：低和中，比如复制链接成功、保存设置成功。

能不能在现有按钮上直接叠加：能。对勾和原图标画成同样尺寸，直接替换即可。

出处链接：Ant 提示文档 https://ant.design/components/message（成功提示配对勾的做法）与 Primer 横幅文档 https://primer.style/components/banner（成功横幅的图标语义）

### C2 叉号替换

长什么样：失败后按钮里的图标换成一个叉号，停留到用户下一步操作。

适合的等待时长：用在短、中、长操作之后。

适合的操作危险程度：中和高，比如发评论失败、建票失败。

能不能在现有按钮上直接叠加：能。和对勾一样等尺寸替换。

出处链接：Ant 提示文档 https://ant.design/components/message（失败提示配叉号的做法）与 Primer 横幅文档 https://primer.style/components/banner

### C3 警告三角替换

长什么样：结果不对但还没失败时（比如部分成功），图标换成警告三角，提醒人去看详情。

适合的等待时长：用在中、长操作之后。

适合的操作危险程度：中。

能不能在现有按钮上直接叠加：能。等尺寸替换。

出处链接：Primer 横幅文档 https://primer.style/components/banner（警告横幅的图标语义）与 Ant 提示文档 https://ant.design/components/message

### C4 成功绿闪

长什么样：成功那一刻按钮整体闪一下淡绿，半秒内退回原样，只起强调作用，不代替文字说明。

适合的等待时长：用在瞬间和短操作之后。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：有条件能。绿色必须复用现有成功色，不能新发明一种绿；闪完必须自动退回；用户开了减少动态效果时不闪，只换对勾。

出处链接：Primer 横幅文档 https://primer.style/components/banner（成功色的语义）与 MDN 减少动态文档 https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

### C5 失败红闪

长什么样：失败那一刻按钮整体闪一下淡红，逻辑和成功绿闪一样。

适合的等待时长：用在瞬间和短操作之后。

适合的操作危险程度：中和高。

能不能在现有按钮上直接叠加：有条件能。红色必须复用现有失败色，不能新发明；闪完退回；减少动态效果时不闪，只换叉号。

出处链接：Primer 横幅文档 https://primer.style/components/banner（失败色的语义）与 MDN 减少动态文档 https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

### C6 抖动

长什么样：失败时按钮左右快速晃两下，像摇头说不行，幅度很小。

适合的等待时长：用在瞬间和短操作失败之后。

适合的操作危险程度：中和高，比如表单没填对、删票被拒绝。

能不能在现有按钮上直接叠加：有条件能。只用变形实现，不改变布局；幅度要小；用户开了减少动态效果时不许抖，改用叉号加文字；同一按钮短时间内最多抖一次，一直抖会烦。

出处链接：组合做法：关键帧写法依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/animation，动效克制依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

### C7 弹跳确认

长什么样：成功时按钮轻轻放大再弹回，像点了一下头，适合复制成功这种小确幸。

适合的等待时长：用在瞬间操作之后。

适合的操作危险程度：低，比如复制链接成功。

能不能在现有按钮上直接叠加：有条件能。中高危险操作不许用弹跳，太轻佻；减少动态效果时不用。

出处链接：组合做法：写法依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/animation，时长缓动依据 Material 3 https://m3.material.io/styles/motion/easing-and-duration

### C8 浮层小提示

长什么样：屏幕底部或角落浮出一小条提示，几秒后自动消失，比如已复制链接。盖在界面上，不挤走任何内容。

适合的等待时长：用在短、中、长操作之后。

适合的操作危险程度：低和中。高危险操作不要只用会自动消失的小提示，会错过，改用 C9 横幅。

能不能在现有按钮上直接叠加：能。用覆盖层实现，不占布局；插件里对应浮层座位。

出处链接：Material 3 浮层文档 https://m3.material.io/components/snackbar 与 Ant 提示文档 https://ant.design/components/message

### C9 顶部横幅

长什么样：面板顶部出现一条横幅，说明成功或失败的原因，失败时带重试按钮，人工关掉或跳走才消失。

适合的等待时长：用在中、长操作之后，尤其是失败。

适合的操作危险程度：中和高。失败必须留痕，不能自动消失。

能不能在现有按钮上直接叠加：能。用覆盖层实现，不推挤下面的列表；插件里对应横幅座位。

出处链接：Primer 横幅文档 https://primer.style/components/banner 与无障碍提醒模式 https://www.w3.org/WAI/ARIA/apg/patterns/alert/ 与提醒语义 https://www.w3.org/TR/wai-aria-1.2/#alert

### C10 浮动结果气泡

长什么样：在图标小按钮旁边冒出一个小气泡，写已复制或失败原因，两三秒后消失，专给放不下文字的图标按钮用。

适合的等待时长：用在瞬间和短操作之后。

适合的操作危险程度：低。

能不能在现有按钮上直接叠加：有条件能。气泡用覆盖层实现；一次只许出现一个；要有键盘也能读到的文字，不能只有效果没有文字。

出处链接：Primer 气泡文档 https://primer.style/components/tooltip 与 Carbon 气泡文档 https://www.carbondesignsystem.com/components/tooltip/usage/

### C11 结果文字替换

长什么样：成功后按钮文字短暂变成已保存、已发送，停一两秒再换回来。

适合的等待时长：用在短操作之后。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：有条件能。结果文字一般比原文字短，按钮宽度按原文字留，换字时不许把按钮撑宽；太窄的按钮不用这种。

出处链接：苹果按钮指南 https://developer.apple.com/design/human-interface-guidelines/buttons（按钮标题要说明状态）与状态语义 https://www.w3.org/TR/wai-aria-1.2/#status

### C12 成功圈扩散

长什么样：成功时从按钮向外扩一圈淡绿色的环并淡出，像涟漪的成功版。

适合的等待时长：用在瞬间和短操作成功之后。

适合的操作危险程度：低和中。

能不能在现有按钮上直接叠加：能。用阴影画圈，不占布局。

出处链接：组合做法：写法依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/animation，语义颜色依据 Primer 横幅文档 https://primer.style/components/banner

### C13 带撤销的横幅

长什么样：删票、删内容这类高危险操作成功后，横幅写已删除并带一个撤销按钮，给人几秒钟反悔。

适合的等待时长：用在中、高危险操作之后。

适合的操作危险程度：高，这是高危险操作的首选结果样式。

能不能在现有按钮上直接叠加：能。用横幅座位的覆盖层实现，不推挤布局；撤销按钮是横幅自带的动作位，不新增控件位置。

出处链接：Primer 横幅文档 https://primer.style/components/banner 与 Material 3 浮层文档 https://m3.material.io/components/snackbar（浮层可带一个操作按钮的做法）与无障碍提醒模式 https://www.w3.org/WAI/ARIA/apg/patterns/alert/

## 不能直接用的方式及原因

下面这些在外面很常见，但违反本次约束（不动位置、大小、配色体系，只要人眼能直接看到的纯前端视觉），所以不进候选，记在这里避免后人重复踩坑。

1. 整页遮罩加大转圈：把整个面板盖住、中间放一个大转圈。这会挡住面板列表和详情，让人等待期间什么都看不了，也改变了面板的可用状态，不符合只升级单个控件的要求。

2. 声音与震动反馈：响一声或震一下不是人眼能直接看到的，而且桌面插件没有统一的震动接口，不在纯前端视觉范围内，不收。

3. 系统级通知：弹出到操作系统右下角的那种通知，人眼要离开插件才看得到，而且需要另外授权，不属于在现有控件上叠加，不收。

4. 引入一套新配色体系：比如为了成功失败新发明五六种颜色，或者整套换主题。这违反不动配色体系的约束。成功失败只能复用现有的成功色和失败色。

5. 把按钮变大变小来庆祝：比如成功后按钮胀大一圈。这种做法改变控件大小，会挤动周围布局，也违反布局零抖动纪律，不收。

6. 把下面内容挤开的内联横幅：横幅直接插进列表中间、把下面的行往下顶。这种做法改变位置布局，列表会跳动，不收。横幅必须走覆盖层座位（横幅座位、浮层座位），盖在内容上，不顶开内容。

7. 大幅度翻转与位移：比如按钮翻个面、飞进飞出。幅度一大就容易晕，而且用户开了减少动态效果时必须全关，等于白做。反馈动画只许用透明度、小位移、小缩放，依据 MDN https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion。

8. 纯代码门禁与测试断言：比如提交前拦住的校验脚本、自动测试里的断言。它们没有人眼能直接看到的样子，票里明确说不收。

## 给 862 原型的建议

862 要把全部效果装进一个超文本文件、一屏看全，纯层叠样式加少量脚本、不需要后端。下面按实现成本从低到高排，成本低的先做，成本高的后做。

第一档，纯样式就能做，零脚本：A1 按下态背景加深、A2 键盘焦点环、A4 按压缩小、A6 悬停浮起、A10 透明度闪、B4 禁用态、B9 脉冲呼吸。这些每种不到十行样式，建议第一批全放进原型，一天内能看全。

第二档，纯样式关键帧，多几十行：A3 涟漪扩散、A7 光泽扫过、A8 按下描边高亮、A12 点击波纹环外扩、B3 省略号圆点、B8 条纹流动、B10 往返扫动、C4 成功绿闪、C5 失败红闪、C6 抖动、C7 弹跳确认、C12 成功圈扩散。这些是原型的肉，建议第二批做，重点看抖动幅度和闪光时长会不会太吵。

第三档，要少量脚本换文字或换图标：B1 按钮内转圈、B6 倒计时读秒、B7 百分比数字、B11 状态文字轮换、C1 对勾替换、C2 叉号替换、C3 警告三角替换、C10 浮动结果气泡、C11 结果文字替换。这些要写切换逻辑和计时器，建议第三批做，同时把成功失败图标（对勾、叉号、三角）统一成一套同样尺寸的图标。

第四档，要搭小状态机：B2 按钮内横向进度条（要接真实或模拟进度）、B5 骨架占位行（要铺占位再替换）、B12 进度环包住图标（要算环的弧度）、C8 浮层小提示（要管自动消失与排队）、C9 顶部横幅与 C13 带撤销的横幅（要管出现、停留、撤销、消失全流程）。建议最后一批做，C9 与 C13 直接复用插件已有的横幅座位的语义来画，不要自己发明新的横幅位置。

原型页面布局建议：按 A、B、C 分三排，每格是一个能点的真按钮加名字加成本档，点一下就能看效果。另外，整页加一个减少动态效果的开关，验证 C4 到 C7 在该开关打开时是否自动降级。

## 来源清单

规范文档：

- MDN 按下态：https://developer.mozilla.org/en-US/docs/Web/CSS/:active
- MDN 焦点：https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible
- MDN 变形：https://developer.mozilla.org/en-US/docs/Web/CSS/transform
- MDN 过渡：https://developer.mozilla.org/en-US/docs/Web/CSS/transition
- MDN 动画：https://developer.mozilla.org/en-US/docs/Web/CSS/animation
- MDN 光标：https://developer.mozilla.org/en-US/docs/Web/CSS/cursor
- MDN 减少动态：https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- MDN 禁用属性：https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/disabled
- MDN 进度语义：https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/progressbar_role
- W3C 进度语义：https://www.w3.org/TR/wai-aria-1.2/#progressbar
- W3C 状态语义：https://www.w3.org/TR/wai-aria-1.2/#status
- W3C 提醒语义：https://www.w3.org/TR/wai-aria-1.2/#alert
- W3C 提醒模式：https://www.w3.org/WAI/ARIA/apg/patterns/alert/
- W3C 焦点可见：https://www.w3.org/TR/WCAG21/#focus-visible

设计系统与人机界面指南：

- Material 3 按钮：https://m3.material.io/components/buttons
- Material 3 进度：https://m3.material.io/components/progress-indicators
- Material 3 浮层：https://m3.material.io/components/snackbar
- Material 3 动效：https://m3.material.io/styles/motion/easing-and-duration
- 苹果按钮指南：https://developer.apple.com/design/human-interface-guidelines/buttons
- 苹果活动视图：https://developer.apple.com/design/human-interface-guidelines/activity-views
- Primer 按钮：https://primer.style/components/button
- Primer 转圈：https://primer.style/components/spinner
- Primer 进度条：https://primer.style/components/progress-bar
- Primer 横幅：https://primer.style/components/banner
- Primer 骨架：https://primer.style/components/skeleton
- Primer 气泡：https://primer.style/components/tooltip
- Ant 按钮：https://ant.design/components/button
- Ant 转圈：https://ant.design/components/spin
- Ant 提示：https://ant.design/components/message
- Carbon 按钮：https://www.carbondesignsystem.com/components/button/usage/
- Carbon 气泡：https://www.carbondesignsystem.com/components/tooltip/usage/
- Atlassian 按钮：https://atlassian.design/components/button/examples
- Atlassian 浮层：https://atlassian.design/components/flag/examples
- Fluent 按钮：https://learn.microsoft.com/en-us/fluent-ui/web-components/components/button/

上面每个链接在 2026-10-05 当天都实际打开验证过，能正常返回内容。

## 未决问题

下面这几个问题不影响这份调研成立，但 862 做原型和 863 定分类时会碰到，先记下来，不停下来等答复。

1. 现有按钮的成功色和失败色具体是哪两个色值？C4、C5 的闪光必须复用现有色值，原型开工前需要在代码里找到这两个色值。

2. 对勾、叉号、警告三角有没有现成的图标？C1 到 C3 要求三套图标同样尺寸，如果图标库里没有，原型要先补图标。

3. 插件已有的横幅座位和浮层座位能不能被原型直接调用？C8、C9、C13 建议复用这两个座位的语义，如果座位有自己的出现与消失规则，原型要跟它对齐。

4. 真实接口的等待时长分布是什么样？B 类的四档时长是通用分档，如果插件的建票、发评论、拉列表实际耗时集中在某一档，原型演示的秒数要按真实耗时调。
