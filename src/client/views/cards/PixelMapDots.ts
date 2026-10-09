/** views/cards/PixelMapDots.ts - mini dot wall + stats strip (shared). */
import type { MapDotsProps, MapStatsProps, CardIconProps } from './cardBits';
export const PixelMapDots = function (props?: { cells?: { color: string; n: number }[] }): any {
  const p: MapDotsProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const cells: any[] = [];
  (p.cells || []).forEach(function (c, gi) {
    for (let j = 0; j < (c.n || 0); j++) cells.push(h("i", { key: gi + "-" + j, style: { background: c.color } }));
  });
  return h('div', { className: 'cd-grid2' }, cells);
};
export const PixelMapStats = function (props?: { kids?: number; ready?: number; blocked?: number }): any {
  const p: MapStatsProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const cell = function (k: string, label: string, v?: number): any {
    return h('span', { key: k }, [label + ' ', h('b', { key: 'b' }, String(v || 0))]);
  };
  return h('div', { className: 'cd-mstats' }, [
    cell('k', tr('card.sub'), p.kids),
    cell('r', tr('card.pickReady'), p.ready),
    cell('b', tr('card.blockedCount'), p.blocked),
  ]);
};
export const PixelMapCorner = function (): any {
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  return h('span', { className: 'cd-mapcorner' }, h('b', null, tr('card.map')));
};
