/** views/cards/PixelCardNote.ts - red footnote line (shared atom). */
import type { CardNoteProps } from './cardBits';
export const PixelCardNote = function (props?: { text?: string }): any {
  const p: CardNoteProps = props || {};
  if (!p.text) return null;
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('div', { className: 'cd-note' }, p.text);
};
