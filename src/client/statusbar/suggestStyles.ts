// src/client/statusbar/suggestStyles.ts —— 「下一步建议」气泡的视觉语言（#1411）
//
// 职责：只产出一段 CSS 文本（SUGGEST_STYLE_TEXT），由入口真源 src/client/index.ts 在
// kernel:styles 的同一个接缝上 styles.insert 一次。为什么另起一个样式叶子：kernel/styles.ts
// 已经贴着单文件 350 行上限（#851 先例，反馈样式 feedback-styles.ts 同款做法）。
//
// 所有看得见的数字与颜色都从 suggestAppearance 的 SUGGEST_APPEARANCE 取，本文件不写死；
// 深色主题走 C 版玻璃质感（半透明渐变、内高光、细描边），亮色主题在下面另给一组覆盖，
// 避免深色描边与高光在浅底上糊在一起。小泡（.dsws-sugg-bub）的节点由 suggestEngine 生成。
//
// 契约（与仓库其它叶子文件同一套）：模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply
// 闭包；运行时不许跨文件 import；不许 export default；只写可剥离的 TypeScript。
declare const SUGGEST_APPEARANCE: any;

/** 建议气泡的全部样式（字符串在模块求值时拼好，所以外观叶子必须排在它之前）。 */
export const SUGGEST_STYLE_TEXT: string = [
  // 整组：竖排，选项行在上、关闭按钮行在下，居中；本身不吃鼠标事件，两个行的子控件各自开。
  '.dsws-sugg-layer{display:flex;flex-direction:column;align-items:center;gap:' + SUGGEST_APPEARANCE.groupGapPx + 'px}',
  // 选项行：居中横排，窄栏自动换行；每颗按钮自己收宽度，不把整行撑出视口。
  '.dsws-sugg-row{position:relative;z-index:2;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:' + SUGGEST_APPEARANCE.pillGapPx + 'px;max-width:100%;pointer-events:none}',
  // 选项药丸：C 版玻璃质感（渐变底、内高光、细描边、文字投影）；框里只印简介（#1451 后续），
  // 完整提示词点选时才填进输入框。单行省略留着兜底（旧事件没有简介时退回显示提示词）。
  '.dsws-sugg-pill{position:relative;pointer-events:auto;box-sizing:border-box;max-width:' + SUGGEST_APPEARANCE.pillMaxWidthPx + 'px;font:inherit;font-size:' + SUGGEST_APPEARANCE.pillFontPx + 'px;line-height:' + SUGGEST_APPEARANCE.pillLineHeight + ';padding:' + SUGGEST_APPEARANCE.pillPadY + 'px ' + SUGGEST_APPEARANCE.pillPadX + 'px;border-radius:' + SUGGEST_APPEARANCE.pillRadiusPx + 'px;border:1px solid ' + SUGGEST_APPEARANCE.pillBorder + ';background:' + SUGGEST_APPEARANCE.pillBg + ';color:var(--dsw-alias-label-primary,#e6edf3);box-shadow:' + SUGGEST_APPEARANCE.pillShadow + ';text-shadow:' + SUGGEST_APPEARANCE.pillTextShadow + ';cursor:pointer;backdrop-filter:blur(' + SUGGEST_APPEARANCE.pillBlurPx + 'px) saturate(1.2);-webkit-backdrop-filter:blur(' + SUGGEST_APPEARANCE.pillBlurPx + 'px) saturate(1.2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .14s ease,border-color .14s ease,box-shadow .14s ease}',
  // 左上角那团柔光：C 版药丸的「玻璃反光」，不参与布局、不吃事件。
  '.dsws-sugg-pill::before{content:"";position:absolute;left:4%;top:0;width:56%;height:50%;border-radius:50%;pointer-events:none;background:radial-gradient(ellipse 62% 58% at 34% 28%,rgba(255,255,255,.20),transparent 72%)}',
  '.dsws-sugg-pill:hover{border-color:' + SUGGEST_APPEARANCE.pillHoverBorder + ';box-shadow:' + SUGGEST_APPEARANCE.pillHoverShadow + '}',
  '.dsws-sugg-pill:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff));outline-offset:2px}',
  // 简介这段：说清这一步做什么，加粗；它是框里唯一的文字。
  '.dsws-sugg-intro{font-weight:600;letter-spacing:.01em}',
  // 选项框的定位壳：给悬停浮层当锚点（浮层按「框顶边正上方」摆，不跟鼠标走）。
  '.dsws-sugg-pill-wrap{position:relative;display:inline-flex;pointer-events:auto}',
  // 悬停浮层：平时透明，悬停或聚焦时在框正上方浮现；内容是推荐理由（打了分的在第一行开头先印一颗分数泡）；不吃鼠标事件所以不闪烁。
  '.dsws-sugg-pop{position:absolute;bottom:calc(100% + ' + SUGGEST_APPEARANCE.popGapPx + 'px);left:50%;transform:translateX(-50%) translateY(3px);width:max-content;max-width:' + SUGGEST_APPEARANCE.popMaxWidthPx + 'px;padding:' + SUGGEST_APPEARANCE.popPadY + 'px ' + SUGGEST_APPEARANCE.popPadX + 'px;border-radius:' + SUGGEST_APPEARANCE.popRadiusPx + 'px;border:1px solid ' + SUGGEST_APPEARANCE.pillBorder + ';background:' + SUGGEST_APPEARANCE.pillBg + ';color:var(--dsw-alias-label-primary,#e6edf3);box-shadow:' + SUGGEST_APPEARANCE.pillShadow + ';font-size:' + SUGGEST_APPEARANCE.pillFontPx + 'px;line-height:1.5;text-align:left;white-space:normal;opacity:0;pointer-events:none;transition:opacity .12s ease,transform .12s ease;z-index:3;display:block;backdrop-filter:blur(' + SUGGEST_APPEARANCE.popBlurPx + 'px) saturate(1.2);-webkit-backdrop-filter:blur(' + SUGGEST_APPEARANCE.popBlurPx + 'px) saturate(1.2)}',
  '.dsws-sugg-pill-wrap.dsws-sugg-show-pop .dsws-sugg-pop{opacity:1;transform:translateX(-50%) translateY(0)}',
  // 浮层里的分数泡：把模型打的分（比如 9.5）做成一颗小气泡，贴在第一行开头，用户一眼看到这条有多优先。
  '.dsws-sugg-score{display:inline-block;margin-right:' + SUGGEST_APPEARANCE.scoreGapPx + 'px;padding:0 8px;border-radius:99px;border:1px solid ' + SUGGEST_APPEARANCE.pillHoverBorder + ';background:rgba(150,190,255,.16);font-size:' + SUGGEST_APPEARANCE.pillFontPx + 'px;line-height:1.5;font-weight:600}',
  // 浮层里的理由正文：紧跟分数泡排在同一行；文字折行后从分数泡正下方接着排（不缩进、也不另起一段）；
  // 没打分时分数泡缺席，它自己就是浮层的全部内容。
  '.dsws-sugg-reason{display:inline}',
  // 关闭按钮行：整行居中；按钮平时半透明，悬停或聚焦才实。
  '.dsws-sugg-xrow{position:relative;z-index:2;display:flex;justify-content:center;margin-top:' + SUGGEST_APPEARANCE.closeRowMarginTopPx + 'px;pointer-events:none}',
  '.dsws-sugg-close{pointer-events:auto;font:inherit;font-size:' + SUGGEST_APPEARANCE.closeFontPx + 'px;line-height:1.5;padding:' + SUGGEST_APPEARANCE.closePadY + 'px ' + SUGGEST_APPEARANCE.closePadX + 'px;border-radius:' + SUGGEST_APPEARANCE.pillRadiusPx + 'px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);cursor:pointer;opacity:' + SUGGEST_APPEARANCE.closeIdleOpacity + ';transition:opacity .12s ease,background .12s ease}',
  '.dsws-sugg-close:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.10))}',
  '.dsws-sugg-close:focus-visible{opacity:1;outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff));outline-offset:2px}',
  // 小泡：绝对定位于整组之内，落在选项行下面一层（z-index 1），由引擎逐颗安排出发与落点。
  '.dsws-sugg-bub{position:absolute;z-index:1;left:0;top:0;border-radius:50%;pointer-events:none;background:' + SUGGEST_APPEARANCE.bubbleBg + ';border:1px solid ' + SUGGEST_APPEARANCE.bubbleBorder + ';box-shadow:' + SUGGEST_APPEARANCE.bubbleGlow + ';opacity:0;will-change:transform,opacity}',
  // 关闭与第二组覆盖的退场：整组淡出；选中一条的退场不再走整组 CSS 动画，
  // 改由引擎按每颗胶囊的位置生成小泡向上飘走（见 suggestEngine 的 playOut('pick')）。
  '@keyframes dsws-sugg-fade{to{opacity:0}}',
  '.dsws-sugg-layer.dsws-sugg-fading{animation:dsws-sugg-fade ' + SUGGEST_APPEARANCE.fadeMs + 'ms ease-in forwards}',
  // 读屏专用播报节点：视觉上不占位，只让读屏软件念出「有几条建议」。
  '.dsws-sugg-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',
  // 亮色主题：玻璃质感换成浅底半透明，去掉深色文字投影（深色主题保持 C 版原样）。
  'body:not([data-ds-dark-theme]) .dsws-sugg-pill{background:' + SUGGEST_APPEARANCE.lightPillBg + ';border-color:' + SUGGEST_APPEARANCE.lightPillBorder + ';box-shadow:' + SUGGEST_APPEARANCE.lightPillShadow + ';text-shadow:none}',
  'body:not([data-ds-dark-theme]) .dsws-sugg-pill:hover{border-color:' + SUGGEST_APPEARANCE.lightPillHoverBorder + ';box-shadow:' + SUGGEST_APPEARANCE.lightPillHoverShadow + '}',
  'body:not([data-ds-dark-theme]) .dsws-sugg-pop{background:' + SUGGEST_APPEARANCE.lightPillBg + ';border-color:' + SUGGEST_APPEARANCE.lightPillBorder + ';box-shadow:' + SUGGEST_APPEARANCE.lightPillShadow + '}',
  'body:not([data-ds-dark-theme]) .dsws-sugg-bub{background:' + SUGGEST_APPEARANCE.lightBubbleBg + ';border-color:' + SUGGEST_APPEARANCE.lightBubbleBorder + ';box-shadow:' + SUGGEST_APPEARANCE.lightBubbleGlow + '}',
  // 系统要求减少动效：去掉过渡与淡出动画（小泡由引擎直接跳过）。
  '@media (prefers-reduced-motion: reduce){.dsws-sugg-pill,.dsws-sugg-close,.dsws-sugg-pop{transition:none}.dsws-sugg-layer.dsws-sugg-fading{animation-duration:1ms}}',
].join('\n')
