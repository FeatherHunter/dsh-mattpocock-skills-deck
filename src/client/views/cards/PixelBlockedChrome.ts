/** views/cards/PixelBlockedChrome.ts - 被阻塞卡上的斜封条、挡路卡上的红条、整卡暗层。 */
import type { BlockedInfo } from './cardProps';
/** 红封条多一个「点它查挡路关系」的回调；可跳转的卡上整卡点击已用于进详情，点亮挡路关系就落在这条封条上。 */
interface BlockedSealProps extends BlockedInfo { onActivate?: (() => void) | null; }
export const PixelBlockedSeal = function (props?: BlockedSealProps): any {
  const p: BlockedSealProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const onActivate: (() => void) | null = typeof p.onActivate === 'function' ? p.onActivate : null;
  const attrs: any = { className: 'cd-bseal' + (onActivate ? ' act' : '') };
  if (onActivate) {
    attrs['data-press'] = 'row';
    attrs['data-log'] = 'card.blockedSeal';
    attrs.onClick = function (e: any): void {
      // 封条在卡片内部：不拦下这一下，卡片自己的 onClick 会紧接着把详情页打开。
      try { if (e && e.stopPropagation) e.stopPropagation(); } catch (err) { void err; }
      if (onActivate) onActivate();
    };
  }
  return h('div', attrs, tr('card.blockedSeal', { n: '#' + (p.no || '') }));
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
