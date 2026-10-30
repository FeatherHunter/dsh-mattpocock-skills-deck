// src/client/statusbar/suggestAppearance.ts —— 「下一步建议」气泡的外观旋钮与层级常量（#1411）
//
// 职责：把气泡所有「看得见的尺寸、比例、颜色」与层级集中在这一个文件里，样式叶子与组件都从这里取；
// 动效时长不在这里——它们统一住在 src/client/kernel/motion.ts 的 MOTION.suggest* 里（#1236）。
// 票面要求「外观旋钮常量集中一处」：以后调外观只改这里，不再散落到 CSS 文本或组件内联样式里。
//
// 层级契约（#1411 验收①，经 #1665 修正）：SUGGEST_Z 与状态栏胶囊同层（0，不抢全局顶层）。
// 为什么是 0：胶囊本体是正常文档流（没有 z-index）；气泡层挂 body 的时间比胶囊晚，
// 同层里按后来居上压住胶囊；宿主设置面板这类宿主界面与仓库顶层浮层（胶囊菜单与悬停提示，
// 那一层用 2147483000）都带更高的层级，自然盖住气泡。反例：以前这里是 2147482000，
// 打开宿主设置面板时气泡还浮在上面（#1665 现象一），所以不许再调回抢顶的值。
// 层级由数值直接决定，所以这里写死一个具名常量，另由
// tests/verify-1411-suggest-appearance.ts 钉住它的具体值不变。
//
// 契约（与仓库其它叶子文件同一套，见 scripts/build.mts 里的叶子清单）：
//   模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply 闭包；运行时不许跨文件 import；
//   不许 export default；只写可剥离的 TypeScript（不用 enum、不用构造函数参数属性）。

/** 建议气泡那一层的 z-index：与状态栏胶囊同层（0），宿主设置面板与仓库顶层浮层自然盖住它（#1665）。 */
export const SUGGEST_Z = 0

/**
 * 气泡的全部外观旋钮（长度单位是 CSS 像素）。数值口径与规格 #1397 定稿的原型 C 版（上浮小泡方案）
 * 一致；改这里就能整体改外观。
 */
export const SUGGEST_APPEARANCE = {
  /** 气泡底边离胶囊顶边的距离（锚点跟胶囊走：胶囊外框不随对话框内容增高，输入框撑高时气泡不飘，#1665）。 */
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
  /** 磨砂：选项药丸的背景模糊半径（backdrop-filter:blur），越大越看不清底字；配下面加实的底色一起用。 */
  pillBlurPx: 12,
  /** 悬停浮层：底边离选项框顶边的距离、最大宽度、圆角与内边距（#1451 后续：选项框上只留
   *  简介，理由收进框正上方的浮层，不跟鼠标走）。 */
  popGapPx: 6,
  popMaxWidthPx: 280,
  popRadiusPx: 8,
  popPadY: 6,
  popPadX: 10,
  /** 悬停浮层的背景模糊半径（与药丸同一套磨砂）。 */
  popBlurPx: 10,
  /** 浮层里评分泡与后面理由正文的间距：评分贴在第一行开头，跟字之间留一点空，别贴死。 */
  scoreGapPx: 6,
  /** 选项行与关闭按钮行之间的间距。 */
  groupGapPx: 7,
  closeRowMarginTopPx: 10,
  /** 关闭按钮：字号、内边距、空闲时的不透明度（悬停升到 1）。 */
  closeFontPx: 13,
  closePadY: 2,
  closePadX: 10,
  closeIdleOpacity: 0.6,

  // —— 小泡的尺寸、比例与曲线（#1397 定稿原型 C 版，经 #1451 按「出场面要看清、整体约 2 秒」重定）——
  //   出发延迟、飞行时长、清尾与淡出这些毫秒数不在这里：见 kernel/motion.ts 的 MOTION.suggest*（#1236）。
  /** 每颗选项配几颗小泡：每 bubblePxPerPill 像素一颗，最少 bubbleMinPerPill 颗。 */
  bubblePxPerPill: 20,
  bubbleMinPerPill: 4,
  /** 一行选项都没量到宽度时，整组退回这么多颗（正常路径量得到宽度，用不到）。 */
  bubbleFallbackCount: 8,
  /** 小泡直径：bubbleSizeMin 到 bubbleSizeMin + bubbleSizeRange 之间随机。
   *  #1451 按「出场的小泡太小、看不清」放大五成：3.5~9.5 → 5.25~14.25。 */
  bubbleSizeMin: 5.25,
  bubbleSizeRange: 9,
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
  /** 选中一条后的退场：整组选项胶囊化作小泡向上飘走，关闭按钮同时消失（#1451 用户拍板）。
   *  每颗胶囊按宽度分 pickBubblePxPerPill 像素一颗，至少 pickBubbleMinPerPill、至多 pickBubbleMaxPerPill 颗。 */
  pickBubblePxPerPill: 60,
  pickBubbleMinPerPill: 2,
  pickBubbleMaxPerPill: 5,
  /** 向上飘多远（比胶囊顶边再高这么多像素）与横向摆动幅度。 */
  pickBubbleRiseMinPx: 70,
  pickBubbleRiseMaxPx: 130,
  pickBubbleSwayPx: 10,
  /** 小泡飞行的五条速度曲线（随机挑一条）。 */
  easeList: ['ease-out', 'ease-in-out', 'cubic-bezier(.25,.6,.3,1)', 'cubic-bezier(.4,0,.6,1)', 'cubic-bezier(.2,.7,.35,1.1)'],

  // —— 颜色与光感（C 版玻璃质感；亮色主题另给一组，避免深色描边在浅底上看不清；
  //    #1451 后续按「磨砂＋底色加实」把深浅两底都加实，配上面的模糊半径一起用）——
  pillBg: 'linear-gradient(180deg,rgba(208,228,250,.55),rgba(198,218,242,.38) 46%,rgba(150,170,205,.32))',
  pillBorder: 'rgba(170,195,235,.34)',
  pillHoverBorder: 'rgba(182,206,242,.52)',
  pillHoverShadow: '0 1px 14px rgba(150,190,255,.14)',
  pillShadow: 'inset 0 1px 0 rgba(255,255,255,.24),0 1px 10px rgba(140,180,255,.06)',
  pillTextShadow: '0 1px 1px rgba(0,0,0,.3)',
  /** #1451 后续：悬停浮层的底色要比选项框再淡一档（更白、更透）。
   *  浮层与选项框只隔几个像素，两层玻璃若用同一个底色会糊成一整块，看不出哪层是提示。 */
  popBg: 'linear-gradient(180deg,rgba(216,234,254,.56),rgba(211,230,251,.50) 46%,rgba(201,221,246,.46))',
  bubbleBg: 'radial-gradient(circle at 34% 28%,rgba(255,255,255,.55),rgba(186,210,242,.22) 52%,rgba(150,180,220,.07) 78%)',
  bubbleBorder: 'rgba(200,220,250,.35)',
  bubbleGlow: '0 0 6px rgba(150,190,255,.25)',
  lightPillBg: 'linear-gradient(180deg,rgba(255,255,255,.88),rgba(244,248,255,.68) 46%,rgba(226,235,248,.62))',
  lightPillBorder: 'rgba(120,150,190,.32)',
  lightPillHoverBorder: 'rgba(96,130,180,.5)',
  lightPillHoverShadow: '0 1px 14px rgba(90,130,190,.18)',
  lightPillShadow: 'inset 0 1px 0 rgba(255,255,255,.8),0 1px 8px rgba(90,120,160,.12)',
  /** #1451 后续：浅色主题下浮层也要比选项框淡一档（更白、更浅），不能直接复用 lightPillBg。 */
  lightPopBg: 'linear-gradient(180deg,rgba(255,255,255,.97),rgba(254,255,255,.95) 46%,rgba(252,254,255,.93))',
  lightBubbleBg: 'radial-gradient(circle at 34% 28%,rgba(160,190,230,.5),rgba(180,205,240,.25) 52%,rgba(200,220,245,.1) 78%)',
  lightBubbleBorder: 'rgba(120,150,190,.25)',
  lightBubbleGlow: '0 0 6px rgba(120,160,220,.18)',
}
