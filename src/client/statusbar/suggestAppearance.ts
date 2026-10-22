// src/client/statusbar/suggestAppearance.ts —— 「下一步建议」气泡的外观旋钮与层级常量（#1411）
//
// 职责：把气泡所有「看得见的数字」与层级集中在这一个文件里，样式叶子、动效和组件都从这里取。
// 票面要求「外观旋钮常量集中一处」：以后调外观只改这里，不再散落到 CSS 文本或组件内联样式里。
//
// 层级契约（#1411 验收①）：SUGGEST_Z 排在状态栏胶囊之上、仓库顶层浮层（胶囊菜单与悬停提示，
// 那一层用 2147483000）之下。层级由数值直接决定，所以这里写死一个具名常量，另由
// tests/verify-1411-suggest-appearance.ts 钉住它的具体值不变。
//
// 契约（与仓库其它叶子文件同一套，见 scripts/build.mts 里的叶子清单）：
//   模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply 闭包；运行时不许跨文件 import；
//   不许 export default；只写可剥离的 TypeScript（不用 enum、不用构造函数参数属性）。

/** 建议气泡那一层的 z-index：高于状态栏胶囊、低于仓库顶层浮层（菜单与悬停提示，2147483000）。 */
export const SUGGEST_Z = 2147482000

/**
 * 气泡的全部外观旋钮（长度单位是 CSS 像素）。数值口径与原型 C 版定稿一致，
 * 来源见 D:/temp/sns1397/notes/ui-bubble.md 的数值清单；改这里就能整体改外观。
 */
export const SUGGEST_APPEARANCE = {
  /** 气泡底边离状态胶囊顶边的距离。 */
  gapAboveCapsule: 9,
  /** 整组气泡的最大宽度：窄栏靠它和视口宽度一起收，不横向溢出。 */
  maxWidthPx: 720,
  /** 选项药丸：字号、行高、圆角、内边距、彼此间距、单颗最大宽度。 */
  pillFontPx: 12.5,
  pillLineHeight: 1.5,
  pillRadiusPx: 99,
  pillPadY: 3,
  pillPadX: 12,
  pillGapPx: 6,
  pillMaxWidthPx: 360,
  /** 选项行与关闭按钮行之间的间距。 */
  groupGapPx: 7,
  closeRowMarginTopPx: 10,
  /** 关闭按钮：字号、内边距、空闲时的不透明度（悬停升到 1）。 */
  closeFontPx: 13,
  closePadY: 2,
  closePadX: 10,
  closeIdleOpacity: 0.6,

  // —— 小泡与动效（原型 C 版定稿的数值，口径见 D:/temp/sns1397/notes/ui-bubble.md）——
  /** 每颗选项配几颗小泡：每 bubblePxPerPill 像素一颗，最少 bubbleMinPerPill 颗。 */
  bubblePxPerPill: 20,
  bubbleMinPerPill: 4,
  /** 一行选项都没量到宽度时，整组退回这么多颗（正常路径量得到宽度，用不到）。 */
  bubbleFallbackCount: 8,
  /** 小泡直径：bubbleSizeMin 到 bubbleSizeMin + bubbleSizeRange 之间随机。 */
  bubbleSizeMin: 3.5,
  bubbleSizeRange: 6,
  /** 每颗小泡的出发延迟上限、飞行时长区间（毫秒）。 */
  bubbleDelayMaxMs: 360,
  bubbleTravelMinMs: 320,
  bubbleTravelMaxMs: 660,
  /** 出发地：八成从关闭按钮下方，两成从对话区（组底边下方）游离过来。 */
  bubbleFromButtonRatio: 0.8,
  bubbleButtonSpreadPx: 90,
  bubbleClampPx: 40,
  bubbleStartTopOffset: 14,
  bubbleStartTopSpread: 116,
  bubbleStartBottomOffset: 8,
  bubbleStartBottomSpread: 122,
  /** 落点：在自己那颗选项的宽度 15%~85%、高度 25%~80% 之间。 */
  bubbleArriveMinRatio: 0.15,
  bubbleArriveSpanRatio: 0.7,
  bubbleArriveRowMinRatio: 0.25,
  bubbleArriveRowSpanRatio: 0.55,
  /** 飞行途中的横向摆动幅度。 */
  bubbleSwayPx: 20,
  /** 选项行共用透明度：基数 + 跨度 * (已落/总数) 的曲线次方；关闭按钮行用另一条更慢的曲线。 */
  rowOpacityBase: 0.04,
  rowOpacitySpan: 0.96,
  rowOpacityCurve: 0.8,
  closeRevealCurve: 2,
  /** 全部小泡落完后，再等这么久就把小泡节点清掉。 */
  bubbleCleanupDelayMs: 260,
  /** 选中一条后整组退场的时长；关闭与第二组覆盖用另一档。 */
  pickMs: 280,
  fadeMs: 170,
  /** 小泡飞行的五条速度曲线（随机挑一条）。 */
  easeList: ['ease-out', 'ease-in-out', 'cubic-bezier(.25,.6,.3,1)', 'cubic-bezier(.4,0,.6,1)', 'cubic-bezier(.2,.7,.35,1.1)'],

  // —— 颜色与光感（C 版玻璃质感；亮色主题另给一组，避免深色描边在浅底上看不清）——
  pillBg: 'linear-gradient(180deg,rgba(208,228,250,.13),rgba(198,218,242,.04) 46%,rgba(150,170,205,.06))',
  pillBorder: 'rgba(170,195,235,.34)',
  pillHoverBorder: 'rgba(182,206,242,.52)',
  pillHoverShadow: '0 1px 14px rgba(150,190,255,.14)',
  pillShadow: 'inset 0 1px 0 rgba(255,255,255,.24),0 1px 10px rgba(140,180,255,.06)',
  pillTextShadow: '0 1px 1px rgba(0,0,0,.3)',
  bubbleBg: 'radial-gradient(circle at 34% 28%,rgba(255,255,255,.55),rgba(186,210,242,.22) 52%,rgba(150,180,220,.07) 78%)',
  bubbleBorder: 'rgba(200,220,250,.35)',
  bubbleGlow: '0 0 6px rgba(150,190,255,.25)',
  lightPillBg: 'linear-gradient(180deg,rgba(255,255,255,.78),rgba(244,248,255,.55) 46%,rgba(226,235,248,.5))',
  lightPillBorder: 'rgba(120,150,190,.32)',
  lightPillHoverBorder: 'rgba(96,130,180,.5)',
  lightPillHoverShadow: '0 1px 14px rgba(90,130,190,.18)',
  lightPillShadow: 'inset 0 1px 0 rgba(255,255,255,.8),0 1px 8px rgba(90,120,160,.12)',
  lightBubbleBg: 'radial-gradient(circle at 34% 28%,rgba(160,190,230,.5),rgba(180,205,240,.25) 52%,rgba(200,220,245,.1) 78%)',
  lightBubbleBorder: 'rgba(120,150,190,.25)',
  lightBubbleGlow: '0 0 6px rgba(120,160,220,.18)',
}
