/** views/cards/PixelCardBtns.ts - four-button action row with icons. */
import type { CardBtnsProps, CardIconProps } from './cardBits';
declare const cardInkOn: (hex: string) => string;
declare const cardBoostOn: (hex: string) => boolean;
declare const Tip: (props?: any) => any;
const ICB: Record<string, string> = {
  chat: "<path d=\"M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  play: "<path d=\"M8 5.5l11 6.5-11 6.5z\" fill=\"currentColor\" stroke=\"none\"/>",
  search: "<circle cx=\"11\" cy=\"11\" r=\"7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M21 21l-4.3-4.3\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>",
};
ICB.hammer = "<path d=\"M14 4l6 6-2.5 2.5-6-6z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M3 21l7.5-7.5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><path d=\"M12.5 9.5l2 2\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>";
ICB.proto = "<rect x=\"3\" y=\"8.5\" width=\"13\" height=\"9\" rx=\"2\" opacity=\"0.52\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/><rect x=\"7.8\" y=\"3.8\" width=\"13\" height=\"9\" rx=\"2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/>";
ICB.ext = "<path d=\"M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><polyline points=\"15 3 21 3 21 9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><line x1=\"10\" y1=\"14\" x2=\"21\" y2=\"3\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>";
ICB.clip = "<rect x=\"5\" y=\"4\" width=\"14\" height=\"16\" rx=\"2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M9 2h6v4H9z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M9 11h6M9 15h4\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>";
ICB.link = "<path d=\"M10 14a5 5 0 007.1 0l2.8-2.8a5 5 0 00-7.1-7.1L11 5.9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><path d=\"M14 10a5 5 0 00-7.1 0l-2.8 2.8a5 5 0 007.1 7.1L13 18.1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>";
export const PixelCardIcon = function (props?: CardIconProps): any {
  const p: CardIconProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const g = h("g", { dangerouslySetInnerHTML: { __html: ICB[p.n || ""] || "" } });
  return h("svg", { viewBox: "0 0 24 24", width: 12, height: 12, style: { display: "block", flex: "none" } }, g);
};
export const PixelCardBtns = function (props?: CardBtnsProps): any {
  const p: CardBtnsProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const bg = '#' + String(p.mainColor || '8b5cf6');
  // 日志标识由外层卡片传进来：同一屏可能同时摆着好几张卡，每张卡里的按钮要各认各的，不能共用一个名字。
  // 定位串的固定部分写成字面量、变化的部分（哪张卡）接在后面——门禁是按字面量查字符集与唯一性的。
  const logKey = String(((props as any) || {}).logKey || '');
  const ink = cardInkOn(bg);
  // #1388：罩纱标记只管「要不要」，颜色照旧由 cardInkOn 定；样式层的浅色规则认这个标记加罩纱。
  const boost = (typeof cardBoostOn === 'function') ? cardBoostOn(bg) : false;
  const boostMark = boost ? '1' : undefined;
  const stop = function (e: any): void { if (e && e.stopPropagation) e.stopPropagation(); };
  const st = { background: bg, color: ink };
  // #1792：动作门只作用在主按钮与新会话两颗上。置灰时给 aria-disabled、Tab 落不上、
  // 不挂 data-log（点了不该被记一条 ui.action）、不挂 data-press（按下不再有 dsws-pressing 的位移）；
  // 悬停说明为什么不能点，走 Tip 薄预设。verify-no-title 对 title 属性 ≥3 处即抽：这里只保留
  // 复制/打开两颗旧按钮的 2 处 title，主按钮与新会话不再新增。
  const disabled = !!p.disabled;
  const dis = disabled ? 'true' : undefined;
  const disTip = disabled && p.disabledTip ? p.disabledTip : undefined;
  const mainLabel = p.mainLabel;
  const newLabel = tr('card.newSession');
  const press = disabled ? undefined : 'button';
  // 置灰按钮自己带可见动作名作 aria-label：Tip 只补悬停说明，不能把按钮的可访问名换成整句原因。
  const mainProps: any = {
    className: 'cd-abtn label', style: st, 'aria-disabled': dis, tabIndex: disabled ? -1 : undefined,
    'aria-label': disabled ? mainLabel : undefined,
    'data-cd-boost': boostMark, 'data-press': press,
    'data-log': disabled ? undefined : 'card.btn.' + logKey + '.main',
    onClick: function (e: any): void { stop(e); if (disabled) return; if (p.onMain) p.onMain(); },
  };
  const newProps: any = {
    className: 'cd-abtn label', style: st, 'aria-disabled': dis, tabIndex: disabled ? -1 : undefined,
    'aria-label': disabled ? newLabel : undefined,
    'data-cd-boost': boostMark, 'data-press': press,
    'data-log': disabled ? undefined : 'card.btn.' + logKey + '.new',
    onClick: function (e: any): void { stop(e); if (disabled) return; if (p.onNew) p.onNew(); },
  };
  const mainKids = [h(PixelCardIcon, { key: 'i', n: p.icon }), h('span', { key: 't', className: 'cd-lbl' }, mainLabel)];
  const newKids = [h(PixelCardIcon, { key: 'i', n: 'ext' }), h('span', { key: 't', className: 'cd-lbl' }, newLabel)];
  // Tip 只克隆触发元素、不新增 DOM 层级，所以置灰包裹不会改变按钮行的排版；
  // 可点时保持原来的裸按钮，行为与外观一个字都不变。
  const mainNode = disTip ? h(Tip, { key: 'm', content: disTip }, h('button', mainProps, mainKids)) : h('button', Object.assign({ key: 'm' }, mainProps), mainKids);
  const newNode = disTip ? h(Tip, { key: 'n', content: disTip }, h('button', newProps, newKids)) : h('button', Object.assign({ key: 'n' }, newProps), newKids);
  return h('div', { className: 'cd-actions' }, [
    // 四颗按钮是像素风控件：只接 data-press 与 data-log，不加 dsws-hov（像素按钮自己有那套外观，
    // 悬停提亮与下沉位移由像素样式负责，叠两套会让按下时的位移对不上图标格）。
    // 复制与打开是纯图标按钮，按压形状记 icon；有文字的主按钮与新会话按钮记 button。
    mainNode,
    newNode,
    h('button', { key: 'c', className: 'cd-abtn paper icon', title: tr('card.copyLink'), 'data-press': 'icon', 'data-log': 'card.btn.' + logKey + '.copy', onClick: function (e: any): void { stop(e); if (p.onCopy) p.onCopy(); } }, h(PixelCardIcon, { n: 'clip' })),
    h('button', { key: 'o', className: 'cd-abtn paper icon', title: tr('card.openLink'), 'data-press': 'icon', 'data-log': 'card.btn.' + logKey + '.open', onClick: function (e: any): void { stop(e); if (p.onOpen) p.onOpen(); } }, h(PixelCardIcon, { n: 'link' })),
  ]);
};
