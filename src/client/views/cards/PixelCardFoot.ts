/** views/cards/PixelCardFoot.ts - footer row (shared atom). */
import type { CardFootProps } from './cardBits';
export const PixelCardFoot = function (props?: { left?: string; right?: string }): any {
  const p: CardFootProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('div', { className: 'cd-ft' }, [
    h('span', { key: 'l' }, p.left),
    h('span', { key: 'r' }, p.right),
  ]);
};
