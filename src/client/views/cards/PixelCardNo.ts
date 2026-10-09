/** views/cards/PixelCardNo.ts - number badge (shared atom). */
import type { CardNoProps } from './cardBits';
import type { CardActionKind } from './cardProps';
declare const cardColorOf: (c: string, m?: Record<string, string> | null) => string;
declare const cardInkOn: (hex: string) => string;
declare const CARD_ACTION_STYLE: Record<string, { colorKey: string; icon: string; hollow: boolean }>;
export const PixelCardNo = function (props?: { text?: string; action?: CardActionKind; hollow?: boolean; colorOf?: Record<string, string> | null }): any {
  const p: CardNoProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const st = (CARD_ACTION_STYLE as any)[p.action || 'execute'] || { colorKey: 'wayfinder:task', hollow: false };
  const c = cardColorOf(st.colorKey, p.colorOf || null);
  const hollow = p.hollow !== undefined ? p.hollow : st.hollow;
  const style = hollow
    ? { borderColor: '#' + c }
    : { background: '#' + c, color: cardInkOn(c) };
  return h('span', { className: 'cd-nonum' + (hollow ? ' line' : ''), style }, p.text);
};
