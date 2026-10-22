/** views/cards/PixelIssueCard.ts - issue card organism (S6, 8 actions). */
import type { IssueCardProps } from './cardProps';
declare const PixelCardPin: (props?: any) => any;
declare const PixelCardNo: (props?: any) => any;
declare const PixelCardTitle: (props?: any) => any;
declare const PixelCardTags: (props?: any) => any;
declare const PixelCardNote: (props?: any) => any;
declare const PixelCardFoot: (props?: any) => any;
declare const PixelCornerMark: (props?: any) => any;
declare const PixelClosedSeal: () => any;
declare const PixelBlockedSeal: (props?: any) => any;
declare const PixelDimVeil: () => any;
declare const PixelBlockerChip: (props?: any) => any;
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
  // 整卡点按只有页面明确给了 onCard 才接：卡片在别处（例如原型演示）仍可以只做「点一下点亮挡路关系」，
  // 不会因为组件升级就悄悄多出一个跳转。
  const onCard: (() => void) | null = typeof p.onCard === 'function' ? p.onCard : null;
  const canOpen = onCard !== null;
  const ini = p.lit === undefined ? false : !!p.lit;
  const pair = React.useState(ini);
  const lit = p.lit !== undefined ? !!p.lit : pair[0];
  const setLit = pair[1];
  const flip = function (v: boolean): void {
    if (p.lit === undefined) setLit(v);
    if (p.onLitChange) p.onLitChange(v);
    try {
      const doc: any = (typeof document !== "undefined") ? document : null;
      const o = doc && p.blockedBy && p.blockedBy.cardId ? doc.getElementById(String(p.blockedBy.cardId)) : null;
      if (o && o.classList) { if (v) o.classList.add('lit'); else o.classList.remove('lit'); }
    } catch (err) { void err; }
  };
  // 卡片身份取票号：票号是数字文本，清洗成小写字母数字后能进定位串（票标题是自由文本，不能进定位串）。
  // 票号缺失时给个占位值 x，保证同屏两张卡不会撞成同一个名字。
  const logKey = 'issue.' + (String(p.noText || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'x');
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
  // 可跳转的卡上，整卡点击已经用于「进详情」，点亮挡路关系挪到红封条上（封条上写着被谁挡住，
  // 点它看挡路的那张；点卡片其余地方一律进详情）。不能跳转的卡保持旧行为：点整张卡点亮。
  if (blocked && p.blockedBy) kids.push(h(PixelBlockedSeal, { key: 'bs', no: p.blockedBy.no, onActivate: canOpen ? function (): void { flip(!lit); } : null }));
  const suffix = p.claimedBy ? h("span", { className: "cd-take" }, tr("card.claimedBy", { n: p.claimedBy })) : null;
  kids.push(h(PixelCardTitle, { key: 'tt', text: p.title, suffix }));
  kids.push(h(PixelCardTags, { key: 'tg', tags: p.tags || [] }));
  if (p.note) kids.push(h(PixelCardNote, { key: 'nt', text: p.note }));
  // 按钮组把自己的定位名前缀传下去：同一屏里多张票卡各带各的前缀，组里四颗按钮才认得出自己属于哪张卡。
  kids.push(h(PixelCardBtns, { key: 'ab', logKey: logKey, mainLabel: tr('card.act.' + (p.action || 'execute')), icon: st.icon, mainColor, onMain: p.onMain || null, onNew: p.onNew || null, onCopy: p.onCopy || null, onOpen: p.onOpen || null }));
  if (p.blocksChip) kids.push(h(PixelBlockerChip, { key: 'chip', no: p.blocksChip.no, title: p.blocksChip.title }));
  kids.push(h(PixelCardFoot, { key: 'ft', left: tr('card.updated', { n: p.updatedText || '' }), right: p.footActionText || '' }));
  if (blocked) kids.push(h(PixelDimVeil, { key: 'veil' }));
  const attrs: any = { className: cls, style: { "--cd-act": "#" + mainColor } };
  if (blocked || canOpen) attrs.style.cursor = 'pointer';
  if (p.cardId) attrs.id = p.cardId;
  if (blocked) {
    // 被挡住的票卡可以聚焦：聚焦（键盘 Tab 过来）时点亮它自己与挡路的那张，暗层让开、红条出现。
    // 鼠标点击在可跳转的卡上另有含义（进详情），所以点亮挡路关系只留两条路：聚焦，或点红封条。
    Object.assign(attrs, {
      tabIndex: 0,
      onFocus: function (e: any): void { if (e && e.target === e.currentTarget) { setLitNow(e, true); flip(true); } },
      onBlur: function (e: any): void {
        setLitNow(e, false);
        try { if (e && e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return; } catch (err) { void err; }
        flip(false);
      },
    });
    // 不能跳转的卡保持旧行为：点整张卡就是点亮挡路关系（原型里的「点我看阻塞在哪里」）。
    // 能跳转的卡不接这一下，整卡点击留给详情；点亮改由红封条与键盘聚焦触发。
    if (!canOpen) {
      attrs['data-press'] = 'row';
      attrs['data-log'] = 'card.issue.' + logKey + '.row';
      attrs.onClick = function (e: any): void { setLitNow(e, true); flip(true); };
    }
  }
  if (canOpen) {
    // 整卡点按进详情。卡内四颗按钮与红封条各自 stopPropagation，点它们不会顺带把详情页打开。
    // 键盘用 Enter / 空格，与 IssueDetail 的子票行同一套手感；只认卡片自己收到的事件，
    // 避免焦点在按钮上按回车时既点按钮又跳详情。
    attrs.tabIndex = 0;
    attrs.role = 'button';
    attrs['data-press'] = 'row';
    attrs['data-log'] = 'card.issue.' + logKey + '.card';
    attrs.onClick = function (e: any): void {
      try { if (e && e.stopPropagation) e.stopPropagation(); } catch (err) { void err; }
      if (onCard) onCard();
    };
    attrs.onKeyDown = function (e: any): void {
      if (!e || e.target !== e.currentTarget) return;
      const k = e.key;
      if (k === 'Enter' || k === ' ') {
        try { if (e.preventDefault) e.preventDefault(); } catch (err) { void err; }
        if (onCard) onCard();
      }
    };
  }
  return h("div", attrs, kids);
};
