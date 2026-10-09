/** views/cards/PixelMapCard.ts - map wall organism (S1/p2). */
import type { MapCardProps, MapDotItem } from './cardProps';
declare const PixelCardPin: (props?: any) => any;
const DOT_RANK: Record<string, number> = { c: 0, f: 1, w: 2, b: 3 };
export const PixelMapCard = function (props?: MapCardProps): any {
  const p: MapCardProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const ds = (p.dots || []).slice().sort(function (x, y) {
    return (DOT_RANK[x.cls || 'c'] || 0) - (DOT_RANK[y.cls || 'c'] || 0);
  });
  const hovPair = React.useState(null as string | null);
  const hov = p.hoverNo !== undefined ? p.hoverNo : hovPair[0];
  const setHov = function (v: string | null): void {
    if (p.hoverNo === undefined) hovPair[1](v);
    if (p.onHover) p.onHover(v);
  };
  const cur = ds.filter(function (x) { return x.no === hov; })[0] || null;
  const wall = ds.map(function (x, i) {
    return h('i', { key: x.no + '-' + i, className: x.cls + (x.no === hov ? ' lit' : ''),
      onMouseOver: function (): void { setHov(x.no || null); } });
  });
  const lg = function (k: string, c: string, label: string): any {
    return h('span', { key: k }, [h('i', { key: 'i', className: c }), label]);
  };
  const ro = cur
    ? h('div', { key: 'ro', className: 'cd-readout ' + cur.cls }, [
      h('span', { key: 'k', className: 'ro-k' }, '#' + cur.no),
      h('span', { key: 's', className: 'ro-s' }, cur.stateText),
      h('span', { key: 't', className: 'ro-t' }, cur.title),
    ])
    : h('div', { key: 'ro', className: 'cd-readout idle' }, tr('card.readoutIdle'));
  return h('div', { className: 'cd-card mapcard' }, [
    h(PixelCardPin, { key: 'pin', kind: 'big' }),
    h('div', { key: 'hd', className: 'cd-hd' }, [
      h('b', { key: 'n' }, '#' + (p.mapNo || '')),
      h('span', { key: 'm' }, tr('card.mapSign')),
      h('span', { key: 's', className: 'cd-st' + (p.open ? ' open' : '') }, p.open ? tr('card.openState') : tr('card.closedState')),
    ]),
    h('h3', { key: 'tt' }, p.title),
    h('div', { key: 'wall', className: 'cd-wall' }, wall),
    h('div', { key: 'lg', className: 'cd-legend' }, [
      lg('f', 'f', tr('card.legendReady')), lg('b', 'b', tr('card.legendBlocked')),
      lg('w', 'w', tr('card.legendClaimed')), lg('c', 'c', tr('card.legendClosed')),
    ]),
    ro,
    h('div', { key: 'ft', className: 'cd-ft' }, h('span', null, tr('card.lastUpdate', { n: p.updatedText || '', d: p.dateText || '' }))),
  ]);
};
