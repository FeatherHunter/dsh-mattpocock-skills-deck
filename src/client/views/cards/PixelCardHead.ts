/** views/cards/PixelCardHead.ts - header row molecule (shared). */
import type { CardHeadProps } from './cardBits';
declare const PixelCardNo: (props?: any) => any;
declare const PixelInlineSign: (props?: any) => any;
declare const PixelClosedSeal: () => any;
export const PixelCardHead = function (props?: { no?: any; sign?: string | null; closed?: boolean }): any {
  const p: CardHeadProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('div', { className: 'cd-hd' }, [
    p.no || null,
    p.sign ? h(PixelInlineSign, { key: 's', kind: p.sign }) : null,
    p.closed ? h(PixelClosedSeal, { key: 'c' }) : null,
  ]);
};
