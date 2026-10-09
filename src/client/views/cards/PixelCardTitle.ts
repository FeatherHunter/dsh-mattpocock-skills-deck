/** views/cards/PixelCardTitle.ts - two/three-line clamp title (shared atom). */
import type { CardTitleProps } from './cardBits';
export const PixelCardTitle = function (props?: { text?: string; tall?: boolean; suffix?: any }): any {
  const p: CardTitleProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('h3', { className: 'cd-tt' + (p.tall ? ' tall' : '') }, [p.text, p.suffix || null]);
};
