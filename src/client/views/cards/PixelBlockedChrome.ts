/** views/cards/PixelBlockedChrome.ts - 被阻塞卡上的斜封条、挡路卡上的红条、整卡暗层。 */
import type { BlockedInfo, DimVeilProps } from './cardProps';
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
  const noText = '#' + (p.no || '');
  const firstLine = tr('card.blockedSeal', { n: noText });
  const title = p.title || '';
  // 封条同时说清两件事：被哪张票挡住（编号），那张票叫什么（标题）。只有编号时，人还得点开
  // 详情才知道是谁挡着。标题太长会撑破斜贴的纸条，所以第二行单行省略，完整标题放进 title
  // 属性（鼠标停住可看全）；没有标题就只画第一行，旧数据照常显示。
  if (title) attrs.title = firstLine + ' ' + title;
  const lines: any[] = [h('span', { key: 'l1', className: 'cd-bseal-l1' }, firstLine)];
  if (title) lines.push(h('span', { key: 't', className: 'cd-bseal-t' }, title));
  return h('div', attrs, lines);
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
/** 暗层上要不要写提示字，由调用方按当前数据决定：有挡路票标题时封条已经横过卡片中部，居中的
 *  提示字会正好压在封条第二行（挡路票标题）上，两层字互相盖住看不清。此时暗层只负责压暗卡面，
 *  点击提示已经在封条本身上（封条可点、有鼠标移上去的完整标题、键盘聚焦也会点亮）。没有标题的
 *  旧数据封条只有一行，碰不到居中提示字，照旧写提示。 */
export const PixelDimVeil = function (props?: DimVeilProps): any {
  const p: DimVeilProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const quiet = !!p.quiet;
  return h('div', { className: 'cd-dimveil' + (quiet ? ' quiet' : '') }, quiet ? null : tr('card.blockedDim'));
};
