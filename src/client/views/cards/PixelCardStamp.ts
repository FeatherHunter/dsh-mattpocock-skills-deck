/** views/cards/PixelCardStamp.ts - corner marks, inline signs, seals (shared). */
import type { CornerMarkProps } from './cardBits';
export const PixelCornerMark = function (props?: { kind?: string }): any {
  const p: CornerMarkProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  if (p.kind === 'bug') return h('span', { className: 'cd-corner' }, h('b', null, tr('card.bug')));
  if (p.kind === 'doing') return h('span', { className: 'cd-ckb' }, h('b', null, tr('card.doing')));
  if (p.kind === 'ready') return h('span', { className: 'cd-ckj' }, h('b', null, tr('card.pickReady')));
  return null;
};
export const PixelInlineSign = function (props?: { kind?: string }): any {
  const p: CornerMarkProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  if (p.kind === 'doing') return h('span', { className: 'cd-mstate', style: { background: '#2b62b0' } }, tr('card.doing'));
  if (p.kind === 'ready') return h('span', { className: 'cd-mstate', style: { background: '#10b981' } }, tr('card.pickReady'));
  return null;
};
export const PixelClosedSeal = function (): any {
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('span', { className: 'cd-sealcn' }, tr('card.closedSeal'));
};
