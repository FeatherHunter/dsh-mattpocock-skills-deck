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
}
