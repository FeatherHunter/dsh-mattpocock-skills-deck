/** views/cards/PixelCardBtns.ts - four-button action row with icons. */
import type { CardBtnsProps, CardIconProps } from './cardBits';
declare const cardInkOn: (hex: string) => string;
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
  const ink = cardInkOn(bg);
  const stop = function (e: any): void { if (e && e.stopPropagation) e.stopPropagation(); };
  const st = { background: bg, color: ink };
  return h('div', { className: 'cd-actions' }, [
    h('button', { key: 'm', className: 'cd-abtn label', style: st, onClick: function (e: any): void { stop(e); if (p.onMain) p.onMain(); } }, [h(PixelCardIcon, { key: 'i', n: p.icon }), p.mainLabel]),
    h('button', { key: 'n', className: 'cd-abtn label', style: st, onClick: function (e: any): void { stop(e); if (p.onNew) p.onNew(); } }, [h(PixelCardIcon, { key: 'i', n: 'ext' }), tr('card.newSession')]),
    h('button', { key: 'c', className: 'cd-abtn paper icon', title: tr('card.copyLink'), onClick: function (e: any): void { stop(e); if (p.onCopy) p.onCopy(); } }, h(PixelCardIcon, { n: 'clip' })),
    h('button', { key: 'o', className: 'cd-abtn paper icon', title: tr('card.openLink'), onClick: function (e: any): void { stop(e); if (p.onOpen) p.onOpen(); } }, h(PixelCardIcon, { n: 'link' })),
  ]);
};
