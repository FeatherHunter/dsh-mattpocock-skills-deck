/** views/cards/PixelIssueMapCard.ts - map sub-ticket organism (S7 C1). */
import type { IssueMapCardProps } from './cardProps';
declare const PixelCardPin: (props?: any) => any;
declare const PixelCardNo: (props?: any) => any;
declare const PixelCardTitle: (props?: any) => any;
declare const PixelCardFoot: (props?: any) => any;
declare const PixelInlineSign: (props?: any) => any;
declare const PixelClosedSeal: () => any;
declare const PixelBlockedSeal: (props?: any) => any;
declare const PixelBlockerChip: (props?: any) => any;
declare const PixelDimVeil: () => any;
declare const PixelCardBtns: (props?: any) => any;
declare const PixelMapDots: (props?: any) => any;
declare const PixelMapStats: (props?: any) => any;
declare const PixelMapCorner: () => any;
export const PixelIssueMapCard = function (props?: IssueMapCardProps): any {
  const p: IssueMapCardProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const blocked = !!(p.blockedBy && p.blockedBy.no);
  const ini = p.lit === undefined ? false : !!p.lit;
  const pair = React.useState(ini);
  const lit = p.lit !== undefined ? !!p.lit : pair[0];
  const flip = function (v: boolean): void {
    if (p.lit === undefined) pair[1](v);
    if (p.onLitChange) p.onLitChange(v);
    try {
      const doc: any = (typeof document !== "undefined") ? document : null;
      const o = doc && p.linkedId ? doc.getElementById(p.linkedId) : null;
      if (o && o.classList) { if (v) o.classList.add('lit'); else o.classList.remove('lit'); }
    } catch (err) { void err; }
  };
  const selPair = React.useState(false);
  const sel = selPair[0];
  const cls = "cd-card wide" + (p.open ? "" : " old closed") + (blocked && !lit ? " dim" : "") + (lit ? " lit" : "") + (sel ? " on" : "");
  const setLitNow = function (e: any, v: boolean): void {
    // 立刻给本卡加上或摘掉 lit，让红条与暗层不依赖这一次 React 重渲染是否发生
    // （右边的挡路卡本来就是直接改 DOM 类；两边走同一套，才是同一件事）。
    try {
      const el = e && e.currentTarget ? e.currentTarget : null;
      if (el && el.classList) { if (v) el.classList.add('lit'); else el.classList.remove('lit'); }
    } catch (err) { void err; }
  };
  const kids: any[] = [];
  kids.push(h(PixelCardPin, { key: 'pin', kind: 'sealtop' }));
  const noEl = h('span', { key: 'no', className: 'cd-nonum', style: { background: '#8b5cf6', color: '#fff' } }, '#' + (p.mapNo || ''));
  kids.push(h('div', { key: 'hd', className: 'cd-hd' }, [noEl, p.sign ? h(PixelInlineSign, { key: 's', kind: p.sign }) : null, p.open ? null : h(PixelClosedSeal, { key: 'c' })]));
  const suffix = p.claimedBy ? h("span", { className: "cd-take" }, tr("card.claimedBy", { n: p.claimedBy })) : null;
  kids.push(h(PixelCardTitle, { key: 'tt', text: p.title, tall: true, suffix }));
  if (blocked && p.blockedBy) kids.push(h(PixelBlockedSeal, { key: 'bs', no: p.blockedBy.no }));
  kids.push(h(PixelMapDots, { key: 'dots', cells: p.dots || [] }));
  kids.push(h(PixelMapStats, { key: 'st', kids: p.kids || 0, ready: p.ready || 0, blocked: p.blocked || 0 }));
  kids.push(h(PixelCardBtns, { key: 'ab', mainLabel: tr('card.execute'), icon: 'play', mainColor: '8b5cf6' }));
  kids.push(h(PixelCardFoot, { key: 'ft', left: tr('card.updated', { n: p.updatedText || '' }), right: '' }));
  kids.push(h(PixelMapCorner, { key: 'mc' }));
  if (blocked) kids.push(h(PixelDimVeil, { key: 'veil' }));
  if (blocked && p.blockedBy) kids.push(h(PixelBlockerChip, { key: 'chip', no: p.blockedBy.no, title: p.blockedBy.title }));
  const attrs: any = { className: cls, style: { "--cd-act": "#8b5cf6" } };
  if (p.cardId) attrs.id = p.cardId;
  if (p.linkedId) attrs["data-link"] = p.linkedId;
  if (blocked || p.linkedId) {
    attrs.tabIndex = 0;
    attrs.onClick = function (e: any): void { setLitNow(e, true); flip(true); };
    attrs.onFocus = function (e: any): void { if (e && e.target === e.currentTarget) { setLitNow(e, true); flip(true); } };
    attrs.onBlur = function (e: any): void {
      setLitNow(e, false);
      try { if (e && e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return; } catch (err) { void err; }
      flip(false);
    };
  } else {
    attrs.onClick = function (): void { selPair[1](!sel); };
  }
  return h("div", attrs, kids);
};
