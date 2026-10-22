// src/client/statusbar/suggestStyles.ts —— 「下一步建议」气泡的视觉语言（#1411）
//
// 职责：只产出一段 CSS 文本（SUGGEST_STYLE_TEXT），由入口真源 src/client/index.ts 在
// kernel:styles 的同一个接缝上 styles.insert 一次。为什么另起一个样式叶子：kernel/styles.ts
// 已经贴着单文件 350 行上限（#851 先例，反馈样式 feedback-styles.ts 同款做法）。
//
// 所有看得见的数字都从 suggestAppearance 的 SUGGEST_APPEARANCE 取，本文件不写死尺寸；
// 颜色走宿主主题 token（--dsw-alias-*），亮色与暗色主题因此都不用另写一套。
//
// 契约（与仓库其它叶子文件同一套）：模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply
// 闭包；运行时不许跨文件 import；不许 export default；只写可剥离的 TypeScript。
declare const SUGGEST_APPEARANCE: any;

/** 建议气泡的全部样式（字符串在模块求值时拼好，所以外观叶子必须排在它之前）。 */
export const SUGGEST_STYLE_TEXT: string = [
  // 整组：竖排，选项行在上、关闭按钮行在下，居中；本身不吃鼠标事件，两个行的子控件各自开。
  '.dsws-sugg-layer{display:flex;flex-direction:column;align-items:center;gap:' + SUGGEST_APPEARANCE.groupGapPx + 'px}',
  // 选项行：居中横排，窄栏自动换行；每颗按钮自己收宽度，不把整行撑出视口。
  '.dsws-sugg-row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:' + SUGGEST_APPEARANCE.pillGapPx + 'px;max-width:100%;pointer-events:none}',
  // 选项药丸：可点、可聚焦；超长提示词单行省略，不撑破气泡。
  '.dsws-sugg-pill{pointer-events:auto;box-sizing:border-box;max-width:' + SUGGEST_APPEARANCE.pillMaxWidthPx + 'px;font:inherit;font-size:' + SUGGEST_APPEARANCE.pillFontPx + 'px;line-height:' + SUGGEST_APPEARANCE.pillLineHeight + ';padding:' + SUGGEST_APPEARANCE.pillPadY + 'px ' + SUGGEST_APPEARANCE.pillPadX + 'px;border-radius:' + SUGGEST_APPEARANCE.pillRadiusPx + 'px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e6edf3);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s ease,border-color .12s ease}',
  '.dsws-sugg-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.14));border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.28))}',
  '.dsws-sugg-pill:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff));outline-offset:2px}',
  // 斜杠命令与普通提示词字面区分（原型 C 版同一处做法）。
  '.dsws-sugg-pill.cmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  // 关闭按钮行：整行居中；按钮平时半透明，悬停或聚焦才实。
  '.dsws-sugg-xrow{display:flex;justify-content:center;margin-top:' + SUGGEST_APPEARANCE.closeRowMarginTopPx + 'px;pointer-events:none}',
  '.dsws-sugg-close{pointer-events:auto;font:inherit;font-size:' + SUGGEST_APPEARANCE.closeFontPx + 'px;line-height:1.5;padding:' + SUGGEST_APPEARANCE.closePadY + 'px ' + SUGGEST_APPEARANCE.closePadX + 'px;border-radius:' + SUGGEST_APPEARANCE.pillRadiusPx + 'px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);cursor:pointer;opacity:' + SUGGEST_APPEARANCE.closeIdleOpacity + ';transition:opacity .12s ease,background .12s ease}',
  '.dsws-sugg-close:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.10))}',
  '.dsws-sugg-close:focus-visible{opacity:1;outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff));outline-offset:2px}',
  // 读屏专用播报节点：视觉上不占位，只让读屏软件念出「有几条建议」。
  '.dsws-sugg-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',
  '@media (prefers-reduced-motion: reduce){.dsws-sugg-pill,.dsws-sugg-close{transition:none}}',
].join('\n')
