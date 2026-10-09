/** views/cards/PixelCardTags.ts - label chips in real label colors (shared). */
import type { CardTagsProps } from './cardBits';
import type { CardTagItem } from './cardProps';
declare const cardInkOn: (hex: string) => string;
export const PixelCardTags = function (props?: { tags?: CardTagItem[] }): any {
  const p: CardTagsProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const tags = p.tags || [];
  return h('div', { className: 'cd-lbrow' }, tags.map(function (t, i) {
    const c = String(t.color || '8b5cf6').replace(/^#/, '');
    return h('span', { key: String(i), className: 'cd-chip', style: { background: '#' + c, color: cardInkOn(c) } }, t.text);
  }));
};
