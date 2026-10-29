/**
 * views/primitives/tipPlace.ts — 悬停提示落在触发控件哪一边的纯位置规则（规格 #1651，地基票 #1652）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 后拼回
 * src/client/index.ts 的 `// ==== leaf:tipPlace (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 *
 * 为什么这份文件只做几何、不碰界面：位置算得对不对应该脱离浏览器就能证明，
 * 所以这个函数只吃数字、只出数字，不读 DOM，不读 window，不读 document，
 * 屏幕宽高由调用方传进来。渲染、测量、挂到屏幕上这些事仍然住在 HoverTip 那一份里。
 *
 * 为什么放在 views 叶子、不放内核：它是提示控件自己的零件，不是全仓共用的基础设施，
 * 内核契约表也早已冻结、不再逐行加东西。两者登记成本一样，放在零件身边更容易找到。
 *
 * 约束（后人改这里之前先读完）：文件里不写运行时 import，闭包拼接时残留 import 就是语法错；
 * 跨文件名字只许 ambient declare，本文件零依赖所以一个 declare 也没有；只写可剥离的类型，
 * 不用 enum，不用构造函数参数属性；8 与 4 两个数字只许出现在这一个函数里，调用方不许重复写。
 *
 * 宽度口径（#1660）：本函数里所有宽度都是「渲染外框宽」——调用方量到的 tip.width 是外框宽（可能带小数），
 * maxWidth 与返回的 effectiveMaxWidth 也都是外框宽上限。渲染侧按 border-box 限宽，所以这里不需要、
 * 也不许替调用方换算内边距与边框：排位和渲染只认这一个宽度，两个口径并存就会重新长出「算出来的位置」
 * 与「画出来的盒子」对不上这类缺陷（#1660 的右偏 7～13 像素与右缘负边距就是这么来的）。
 */
export type TipPlacement = 'above' | 'below' | 'left' | 'right';
export type TipPlaceRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type TipPlaceSize = { width: number; height: number };
export type TipPlaceViewport = { width: number; height: number };
export type TipPlaceResult = { placement: TipPlacement; x: number; y: number; effectiveMaxWidth: number };

/**
 * 算出提示应该落在触发控件的哪一边，以及提示左上角应该放在哪里。
 * 输入触发控件的矩形、提示自身的宽高、屏幕的宽高、提示宽度的上限，
 * 输出提示的方位、提示左上角的坐标、实际生效的宽度上限。
 * 方位一共四种：在触发控件的上方、下方、右侧、左侧，命中一个就停，不会继续往下试。
 * 判定按顺序来：先在触发控件正上方水平居中，再翻到下方，再到右侧，再到左侧，
 * 四面都放不下时选剩余空间最大的一侧。任何方位下正交轴只做整体平移，
 * 上方或者下方形态只平移左右，左侧或者右侧形态只平移上下，所以平移本身不会把提示推到触发控件身上。
 * 两条不变式对任何输入都成立：提示按实际生效宽度渲染后不越出屏幕，提示不盖住触发控件。
 * 调用方注意：返回的坐标一律是提示左上角，渲染处不许再加中心位移；
 * 渲染时必须按返回的实际生效宽度上限去限宽，否则量出来的尺寸和定位用的尺寸对不上。
 * 返回的横纵坐标都是整数像素：夹取时先把目标坐标取整，右边界与下边界向下取整，这样外框宽、外框高
 * 带小数时，取整后的左边界或上边界加上外框尺寸也不会把右缘或下缘顶出屏幕。
 */
export const computeTipPlace = function (anchorRect: any, tipSize: any, viewport: any, maxWidth?: any): TipPlaceResult {
  // 提示底边离触发控件顶边的间隙是 8 像素，提示离屏幕边缘至少留 4 像素。
  // 这两个数是规格写死的，改只改这里，不许在调用方重复写一遍。
  const GAP = 8;
  const EDGE = 4;
  // 触发控件矩形按 getBoundingClientRect 的形状读，缺哪个字段就按剩下的推出来，读不到就按 0 算。
  // 这样合成矩形和真实矩形都能直接传进来，不用调用方先洗一遍形状。
  const raw: any = anchorRect || {};
  const numOr = function (v: any, fb: number): number { return (typeof v === 'number' && isFinite(v)) ? v : fb; };
  const aLeft: number = numOr(raw.left, numOr(raw.x, 0));
  const aTop: number = numOr(raw.top, numOr(raw.y, 0));
  const aWidth: number = numOr(raw.width, numOr(raw.right, aLeft) - aLeft);
  const aHeight: number = numOr(raw.height, numOr(raw.bottom, aTop) - aTop);
  const aRight: number = numOr(raw.right, aLeft + aWidth);
  const aBottom: number = numOr(raw.bottom, aTop + aHeight);
  const aCenterX: number = (aLeft + aRight) / 2;
  const aCenterY: number = (aTop + aBottom) / 2;
  // 提示自身的宽高是调用方量出来的真实尺寸，量不到就按 0 算，不抛异常。
  const tip: any = tipSize || {};
  const tipW: number = Math.max(0, numOr(tip.width, 0));
  const tipH: number = Math.max(0, numOr(tip.height, 0));
  // 屏幕宽高由调用方传进来，本函数不读 window，所以在单测里可以用合成数字穷举边界。
  const vp: any = viewport || {};
  const vpW: number = Math.max(0, numOr(vp.width, numOr(vp.w, 0)));
  const vpH: number = Math.max(0, numOr(vp.height, numOr(vp.h, 0)));
  // 宽度上限走调用方给的值；不传时按默认 320，与 Tip 预设一致（在办表那一行自己传 520，状态栏胶囊那扇门自己传 220）。
  const asked: number = (typeof maxWidth === 'number' && isFinite(maxWidth) && maxWidth > 0) ? maxWidth : 320;
  const availW: number = Math.max(0, vpW - EDGE * 2);
  const availH: number = Math.max(0, vpH - EDGE * 2);
  // 实际生效的宽度上限是调用方上限与屏幕可用宽度里更小的那个，窄屏下自动收窄，不会横向溢出。
  const baseEffective: number = Math.max(0, Math.min(asked, availW));
  // 定位时用的宽高先夹到生效上限与屏幕里面，避免按溢出的尺寸算出一个根本不存在的落点。
  const placeW: number = Math.max(0, Math.min(tipW, baseEffective, availW));
  const placeH: number = Math.max(0, Math.min(tipH, availH));
  // 水平整体平移：只动左右，保证提示左右不越界；上方或者下方形态调这里。
  // 先取整再夹、右边界向下取整：外框宽可能带小数，右缘要按 floor 留出边界，
  // 取整后再夹才不会把带小数的右缘推出屏幕（#1660 旧实现在夹取之后才取整，右缘越出 0.43 像素）。
  const clampX = function (x: number, w: number): number {
    if (w >= availW) return EDGE;
    return Math.max(EDGE, Math.min(Math.round(x), Math.floor(vpW - w - EDGE)));
  };
  // 垂直整体平移：只动上下，保证提示上下不越界；左侧或者右侧形态调这里。
  // 与水平方向同一套取整规则：先取整再夹、下边界向下取整，带小数的外框高才不会把下缘顶出屏幕（#1660）。
  const clampY = function (y: number, h: number): number {
    if (h >= availH) return EDGE;
    return Math.max(EDGE, Math.min(Math.round(y), Math.floor(vpH - h - EDGE)));
  };
  // 第一步放在触发控件正上方、水平居中，提示底边离触发控件顶边留 8 像素。
  // 上方放得下整块提示才命中，左右越界只做水平整体平移，上下一格不动。
  const yAbove: number = aTop - GAP - placeH;
  if (yAbove >= EDGE) {
    return { placement: 'above', x: clampX(aCenterX - placeW / 2, placeW), y: Math.round(yAbove), effectiveMaxWidth: baseEffective };
  }
  // 第二步翻到触发控件正下方、水平居中，同样留 8 像素，同样只做水平整体平移。
  const yBelow: number = aBottom + GAP;
  if (yBelow + placeH <= vpH - EDGE) {
    return { placement: 'below', x: clampX(aCenterX - placeW / 2, placeW), y: Math.round(yBelow), effectiveMaxWidth: baseEffective };
  }
  // 第三步退到触发控件右侧、垂直居中，提示左边离触发控件右边留 8 像素，只做垂直整体平移。
  const xRight: number = aRight + GAP;
  if (xRight + placeW <= vpW - EDGE) {
    return { placement: 'right', x: Math.round(xRight), y: clampY(aCenterY - placeH / 2, placeH), effectiveMaxWidth: baseEffective };
  }
  // 第四步退到触发控件左侧、垂直居中，同样留 8 像素，同样只做垂直整体平移。
  const xLeft: number = aLeft - GAP - placeW;
  if (xLeft >= EDGE) {
    return { placement: 'left', x: Math.round(xLeft), y: clampY(aCenterY - placeH / 2, placeH), effectiveMaxWidth: baseEffective };
  }
  // 第五步是四面都放不下时的保底：选剩余空间最大的一侧落下去。
  // 并列时按上方、下方、右侧、左侧的次序取先遇到的，保证同样的输入永远得到同样的输出。
  // 为什么左右两侧要收窄生效宽度：提示在左右两侧时，宽度方向就是主轴方向，
  // 不收窄的话，夹回屏幕内那一步会把提示推到触发控件身上，违反不盖住触发控件；
  // 收窄到该侧可用空间之后，提示左边天然落在触发控件右边之外，正交轴只平移，
  // 所以提示按生效宽度渲染后两条不变式仍然成立。调用方必须按返回的生效宽度去渲染。
  const spaceAbove: number = aTop - EDGE;
  const spaceBelow: number = vpH - aBottom - EDGE;
  const spaceRight: number = vpW - aRight - EDGE;
  const spaceLeft: number = aLeft - EDGE;
  let best: TipPlacement = 'above';
  let bestSpace: number = spaceAbove;
  if (spaceBelow > bestSpace) { best = 'below'; bestSpace = spaceBelow; }
  if (spaceRight > bestSpace) { best = 'right'; bestSpace = spaceRight; }
  if (spaceLeft > bestSpace) { best = 'left'; bestSpace = spaceLeft; }
  if (best === 'right') {
    const sideAvail: number = Math.max(0, vpW - aRight - GAP - EDGE);
    const eff: number = Math.max(0, Math.min(baseEffective, sideAvail));
    return { placement: 'right', x: Math.round(Math.max(EDGE, aRight + GAP)), y: clampY(aCenterY - placeH / 2, placeH), effectiveMaxWidth: eff };
  }
  if (best === 'left') {
    const sideAvail: number = Math.max(0, aLeft - GAP - EDGE);
    const eff: number = Math.max(0, Math.min(baseEffective, sideAvail));
    const fw: number = Math.max(0, Math.min(placeW, sideAvail));
    return { placement: 'left', x: Math.round(Math.max(EDGE, aLeft - GAP - fw)), y: clampY(aCenterY - placeH / 2, placeH), effectiveMaxWidth: eff };
  }
  // 上下两侧是保底时主轴在高度方向，宽度本来就是整屏可用，所以生效宽度不需要再收窄，左右只做水平整体平移。
  // 这两个分支只有提示比屏幕上最大的纵向空闲还高时才走得到，真实提示到不了那么高，单测的保底用例走左右两侧。
  if (best === 'below') {
    return { placement: 'below', x: clampX(aCenterX - placeW / 2, placeW), y: Math.round(Math.max(EDGE, aBottom + GAP)), effectiveMaxWidth: baseEffective };
  }
  return { placement: 'above', x: clampX(aCenterX - placeW / 2, placeW), y: Math.round(Math.max(EDGE, aTop - GAP - placeH)), effectiveMaxWidth: baseEffective };
};
