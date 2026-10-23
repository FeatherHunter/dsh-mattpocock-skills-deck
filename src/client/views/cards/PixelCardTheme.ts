/** views/cards/PixelCardTheme.ts - card theme truth (S1/S6/S7). 纯函数；按钮与状态的中文文案一律走
 *  config/copy/cards.yaml（经 tr() 读），这个文件里只写颜色与图标这类结构值。 */
export const CARD_ACTION_COLORS: Record<string, string> = {
  diagnose: 'fbca04', fix: 'd73a4a', execute: '10b981', claim: 'b60205',
  supplement: '5319e7', research: '0ea5e9', grill: '9d7cd8', proto: 'f59e0b',
  map: '8b5cf6', block: 'a3231a',
  // 实施（implement）这一档没有自己的固定色：它在实施地图的子票上出现，底色就是实施地图的身份色
  // （kernel/container-view.ts 的 CONTAINER_ACCENT.spec）。那个色值全仓只许在中央色表写一次，
  // 所以卡片层不抄第二份，也不在注释里写它的字面量；页面层把身份色放进 colorOf 表交给卡片
  // （MapDetailV2Page.ts 里 buildColorOf(st) 之后补 implement 这一项）。
};
export interface CardActionStyle { colorKey: string; icon: string; hollow: boolean; }
export const CARD_ACTION_STYLE: Record<string, CardActionStyle> = {
  diagnose: { colorKey: 'needs-triage', icon: 'chat', hollow: false },
  fix: { colorKey: 'bug', icon: 'hammer', hollow: false },
  execute: { colorKey: 'wayfinder:task', icon: 'play', hollow: false },
  claim: { colorKey: 'ready-for-human', icon: 'play', hollow: false },
  supplement: { colorKey: 'needs-info', icon: 'play', hollow: false },
  research: { colorKey: 'wayfinder:research', icon: 'search', hollow: true },
  grill: { colorKey: 'wayfinder:grilling', icon: 'chat', hollow: true },
  proto: { colorKey: 'wayfinder:prototype', icon: 'proto', hollow: true },
  // #1401：实施以前没有自己的样张，卡面按执行画；现在补上。图标沿用 hammer（实施与修复都是
  //「把改法落下去」），颜色与实心形态靠 implement 这一档区分，不再借 execute 的绿。
  implement: { colorKey: 'implement', icon: 'hammer', hollow: false },
};
export const cardColorOf = function (c: string, m?: Record<string, string> | null): string {
  const tab = m || {};
  const v = tab[c] || CARD_ACTION_COLORS[c] || '8b5cf6';
  return String(v).replace(/^#/, '').toLowerCase();
};
export const cardLum = function (hex: string): number {
  const h = String(hex).split('#').join('');
  const ch = function (i: number): number { return parseInt(h.substr(i * 2, 2), 16) / 255; };
  const f = function (x: number): number {
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(ch(0)) + 0.7152 * f(ch(1)) + 0.0722 * f(ch(2));
};
export const cardInkOn = function (hex: string): string {
  const l = cardLum(hex);
  return ((l + 0.05) / 0.05) >= (1.05 / (l + 0.05)) ? '#1c1004' : '#fff9ec';
};
/** #1388：浅色罩纱标记。白字与深字都到不了 4.5 的彩色底（动作紫 #8b5cf6 一带、
 * 压线的 ready 绿 #0e8a16），浅色下由样式层加一层深墨罩纱补对比。
 * 这里只算「要不要罩纱」，不改颜色本身：深色主题与门禁渲染都走老样子，一字不变。
 * 白字按纯白算（罩纱配的是宿主浅字，接近纯白），4.6 留一点余量，
 * 免得 4.50 这种压线值在真机上差之毫厘。 */
export const cardBoostOn = function (hex: string): boolean {
  try {
    if (typeof cardLum !== 'function') return false;
    const lb = cardLum(hex);
    const wOk = 1.05 / (lb + 0.05) >= 4.6;
    const dOk = (lb + 0.05) / (cardLum('1c1004') + 0.05) >= 4.5;
    return !wOk && !dOk;
  } catch (e) { return false; }
};
