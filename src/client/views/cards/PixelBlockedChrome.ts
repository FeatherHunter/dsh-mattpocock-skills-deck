/** views/cards/PixelBlockedChrome.ts - 被阻塞卡上的斜封条、挡路卡上的红条、整卡暗层。 */
import type { BlockedInfo } from './cardProps';
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
