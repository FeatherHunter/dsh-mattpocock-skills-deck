/** views/cards/PixelCardPin.ts - pin/tape/sealtop (S1/S6/S7 shared atom). */
import type { PinProps } from './cardBits';
export const PixelCardPin = function (props?: { kind?: string }): any {
  const p: PinProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  if (p.kind === 'tape') return h('span', { className: 'cd-tape', 'aria-hidden': true });
  if (p.kind === 'sealtop') return h('span', { className: 'cd-sealtop', 'aria-hidden': true });
  if (p.kind === 'big') return h('span', { className: 'cd-pin big', 'aria-hidden': true });
  return h('span', { className: 'cd-pin', 'aria-hidden': true });
};
