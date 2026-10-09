/** views/cards/PixelIssueCard.ts - issue card organism (S6, 8 actions). */
import type { IssueCardProps, BlockerTicketProps } from './cardProps';
declare const PixelCardPin: (props?: any) => any;
declare const PixelCardNo: (props?: any) => any;
declare const PixelCardTitle: (props?: any) => any;
declare const PixelCardTags: (props?: any) => any;
declare const PixelCardNote: (props?: any) => any;
declare const PixelCardFoot: (props?: any) => any;
declare const PixelCornerMark: (props?: any) => any;
declare const PixelClosedSeal: () => any;
declare const PixelBlockerBox: (props?: any) => any;
declare const PixelBlockedSeal: (props?: any) => any;
declare const PixelBlockerChip: (props?: any) => any;
declare const PixelDimVeil: () => any;
declare const PixelCardBtns: (props?: any) => any;
declare const CARD_ACTION_STYLE: Record<string, { colorKey: string; icon: string; hollow: boolean }>;
declare const cardColorOf: (c: string, m?: Record<string, string> | null) => string;
export const PixelIssueCard = function (props?: IssueCardProps): any {
  const p: IssueCardProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const st = CARD_ACTION_STYLE[p.action || "execute"] || CARD_ACTION_STYLE.execute;
  const mainColor = cardColorOf(st.colorKey, p.colorOf || null);
  const blocked = !!(p.blockedBy && p.blockedBy.no);
  const ini = p.lit === undefined ? false : !!p.lit;
  const pair = React.useState(ini);
  const lit = p.lit !== undefined ? !!p.lit : pair[0];
  const setLit = pair[1];
  const flip = function (v: boolean): void {
    if (p.lit === undefined) setLit(v);
    if (p.onLitChange) p.onLitChange(v);
    try {
      const doc: any = (typeof document !== "undefined") ? document : null;
      const o = doc && p.linkedId ? doc.getElementById(p.linkedId) : null;
      if (o && o.classList) { if (v) o.classList.add('lit'); else o.classList.remove('lit'); }
    } catch (err) { void err; }
  };
  const cls = "cd-card" + (p.closed ? " old closed" : "") + (blocked && !lit ? " dim" : "") + (lit ? " lit" : "");
  const corner = p.bugCorner ? "bug" : (p.closed ? null : (p.pickCorner === "ready" ? "ready" : (p.pickCorner === "doing" ? "doing" : null)));
  const setLitNow = function (e: any, v: boolean): void {
    // 立刻给本卡加上或摘掉 lit，让红条与暗层不依赖这一次 React 重渲染是否发生
    // （右边的挡路卡本来就是直接改 DOM 类；两边走同一套，才是同一件事）。
    try {
      const el = e && e.currentTarget ? e.currentTarget : null;
      if (el && el.classList) { if (v) el.classList.add('lit'); else el.classList.remove('lit'); }
    } catch (err) { void err; }
  };
  const kids: any[] = [];
  kids.push(h(PixelCardPin, { key: 'pin', kind: p.closed ? 'tape' : undefined }));
  if (corner) kids.push(h(PixelCornerMark, { key: 'cor', kind: corner }));
  const headNo = h(PixelCardNo, { key: 'no', text: p.noText, action: p.action, colorOf: p.colorOf || null });
  kids.push(h('div', { key: 'hd', className: 'cd-hd' }, [headNo, p.closed ? h(PixelClosedSeal, { key: 'c' }) : null]));
  if (blocked && p.blockedBy) kids.push(h(PixelBlockerBox, { key: 'bb', no: p.blockedBy.no, title: p.blockedBy.title }));
  if (blocked && p.blockedBy) kids.push(h(PixelBlockedSeal, { key: 'bs', no: p.blockedBy.no }));
  const suffix = p.claimedBy ? h("span", { className: "cd-take" }, tr("card.claimedBy", { n: p.claimedBy })) : null;
  kids.push(h(PixelCardTitle, { key: 'tt', text: p.title, suffix }));
  kids.push(h(PixelCardTags, { key: 'tg', tags: p.tags || [] }));
  if (p.note) kids.push(h(PixelCardNote, { key: 'nt', text: p.note }));
  kids.push(h(PixelCardBtns, { key: 'ab', mainLabel: tr('card.act.' + (p.action || 'execute')), icon: st.icon, mainColor, onMain: p.onMain || null, onNew: p.onNew || null, onCopy: p.onCopy || null, onOpen: p.onOpen || null }));
  kids.push(h(PixelCardFoot, { key: 'ft', left: tr('card.updated', { n: p.updatedText || '' }), right: p.footActionText || '' }));
  if (blocked) kids.push(h(PixelDimVeil, { key: 'veil' }));
  if (p.linkedId || blocked) kids.push(h(PixelBlockerChip, { key: 'chip', no: (p.blockedBy && p.blockedBy.no) || '', title: (p.blockedBy && p.blockedBy.title) || '' }));
  const attrs: any = { className: cls, style: { "--cd-act": "#" + mainColor } };
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
  }
  return h("div", attrs, kids);
};
export const PixelBlockerTicket = function (props?: BlockerTicketProps): any {
  const p: BlockerTicketProps = props || {};
  const cx = React.useContext(DswsCtx);
  const h = cx ? cx.h : React.createElement;
  const setLitNow = function (e: any, v: boolean): void {
    // 立刻给本卡加上或摘掉 lit，让红条与暗层不依赖这一次 React 重渲染是否发生
    // （右边的挡路卡本来就是直接改 DOM 类；两边走同一套，才是同一件事）。
    try {
      const el = e && e.currentTarget ? e.currentTarget : null;
      if (el && el.classList) { if (v) el.classList.add('lit'); else el.classList.remove('lit'); }
    } catch (err) { void err; }
  };
  const kids: any[] = [];
  kids.push(h(PixelCardPin, { key: 'pin' }));
  kids.push(h('div', { key: 'hd', className: 'cd-hd' }, h(PixelCardNo, { text: p.noText, action: 'execute', colorOf: p.colorOf || null })));
  kids.push(h(PixelCardTitle, { key: 'tt', text: p.title }));
  if (p.tags) kids.push(h(PixelCardTags, { key: 'tg', tags: p.tags }));
  if (p.full) kids.push(h(PixelCardBtns, { key: 'ab', mainLabel: tr('card.act.execute'), icon: 'play', mainColor: cardColorOf('wayfinder:task', p.colorOf || null) }));
  kids.push(h(PixelCardFoot, { key: 'ft', left: tr('card.updated', { n: p.updatedText || '' }), right: p.footActionText || '' }));
  kids.push(h(PixelBlockerChip, { key: 'chip', no: p.chipNo || p.noText, title: p.chipTitle || p.title }));
  const cls = "cd-card" + (p.lit ? " lit" : "");
  const attrs: any = { className: cls, style: { "--cd-act": "#a3231a" } };
  if (p.cardId) attrs.id = p.cardId;
  return h("div", attrs, kids);
};
