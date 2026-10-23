/** views/cards/PixelCardTags.ts - label chips in real label colors (shared). */
import type { CardTagsProps } from './cardBits';
import type { CardTagItem } from './cardProps';
declare const cardInkOn: (hex: string) => string;
declare const cardBoostOn: (hex: string) => boolean;
export const PixelCardTags = function (props?: { tags?: CardTagItem[] }): any {
  const p: CardTagsProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const tags = p.tags || [];
  return h('div', { className: 'cd-lbrow' }, tags.map(function (t, i) {
    const c = String(t.color || '8b5cf6').replace(/^#/, '');
    // #1388：罩纱标记只管「要不要」，颜色照旧由 cardInkOn 定；样式层的浅色规则认这个标记加罩纱。
    const boost = (typeof cardBoostOn === 'function') ? cardBoostOn(c) : false;
    return h('span', { key: String(i), className: 'cd-chip', 'data-cd-boost': boost ? '1' : undefined, style: { background: '#' + c, color: cardInkOn(c) } }, t.text);
  }));
};
