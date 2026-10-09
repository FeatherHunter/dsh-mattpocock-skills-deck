/** views/cards/PixelBlockedChrome.ts - blocker box, seal, chip, veil. */
import type { BlockedInfo } from './cardProps';
export const PixelBlockerBox = function (props?: BlockedInfo): any {
  const p: BlockedInfo = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('div', { className: 'cd-blocker' }, [
    h('div', { key: 'k', className: 'bk' }, tr('card.blockedBy', { n: '#' + (p.no || '') })),
    h('div', { key: 't', className: 'bt' }, p.title),
  ]);
};
export const PixelBlockedSeal = function (props?: BlockedInfo): any {
  const p: BlockedInfo = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('div', { className: 'cd-bseal' }, tr('card.blockedSeal', { n: '#' + (p.no || '') }));
};
export const PixelBlockerChip = function (props?: BlockedInfo): any {
  const p: BlockedInfo = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('span', { className: 'cd-bchip' }, [
    h('b', { key: 'b' }, tr('card.blockerIs')),
    h('i', { key: 'i' }, '#' + (p.no || '') + ' ' + (p.title || '')),
  ]);
};
export const PixelDimVeil = function (): any {
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('div', { className: 'cd-dimveil' }, tr('card.blockedDim'));
};
