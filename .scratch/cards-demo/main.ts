// 演示页入口：给卡片模块补上闭包里的自由变量，再把三张卡的全部形态摆出来。
import * as ReactLib from 'react';
import { createRoot } from 'react-dom/client';
import { L_PANEL } from '../../src/client/kernel/locale-panel';
import { L_FLOW } from '../../src/client/kernel/locale-flow';
import { L_WORD } from '../../src/client/kernel/locale-word';
import { L_LABELS } from '../../src/client/kernel/locale-labels';
import { L_PAGES } from '../../src/client/kernel/locale-pages';
import { L_VCWRITE } from '../../src/client/kernel/locale-vcwrite';
import { L_SKILLDESC } from '../../src/client/kernel/locale-skilldesc';
import { L_SKILLDETAIL } from '../../src/client/kernel/locale-skilldetail';
import { L_CARDS } from '../../src/client/kernel/locale-cards';
import { PixelIssueCard } from '../../src/client/views/cards/PixelIssueCard';
import { PixelIssueMapCard } from '../../src/client/views/cards/PixelIssueMapCard';
import { PixelMapCard } from '../../src/client/views/cards/PixelMapCard';
import { PIXEL_CARDS_STYLE_TEXT } from '../../src/client/views/cards/PixelCardsStyles';
import * as AllCards from './all';
import { ROWS } from './data';
import { DOTS810, DOTS919, CELLS810, CELLS919, BLK, T919, T810 } from './data2';

const ZH = Object.assign({}, L_PANEL.zh, L_FLOW.zh, L_WORD.zh, L_LABELS.zh, L_PAGES.zh, L_VCWRITE.zh, L_SKILLDESC.zh, L_SKILLDETAIL.zh, L_CARDS.zh);
// 与 locale.js 的合并器同一套：演示页只用中文，但走的是同一批片段，缺一个都会露出键名。
const tr = function (k: string, prm?: Record<string, string | number>): string {
  let s = ZH[k] !== undefined ? ZH[k] : k;
  const p = prm || {};
  Object.keys(p).forEach(function (key) { s = s.split('{' + key + '}').join(String(p[key])); });
  return s;
};
const W = globalThis as any;
W.React = ReactLib;
W.DswsCtx = { h: (ReactLib as any).createElement };
W.tr = tr;
// 真实闭包里 16 个叶子拼在同一个作用域，跨文件引用靠全局名字；这里照同一做法挂回全局。
Object.keys(AllCards).forEach(function (k) { W[k] = (AllCards as any)[k]; });
const e = (ReactLib as any).createElement;

const H = String.fromCharCode(35);
const tagsOf = function (lb: any[]): any[] { return lb.map(function (x) { return { text: x[0], color: H + x[1] }; }); };
const colorOf: Record<string, string> = {};
const sec = function (title: string, kids: any[]): any {
  return e('div', { className: 'sec' }, [e('h2', { key: 'h' }, title), e('div', { key: 'g', className: 'grid' }, kids)]);
};
const boxes: any[] = [];
ROWS.forEach(function (r: any) {
  const base: any = { action: r.a, noText: r.no, title: r.t, tags: tagsOf(r.lb), note: r.fn, updatedText: r.up, footActionText: r.foot, bugCorner: !!r.bug };
  base.claimedBy = r.claim ? 'FeatherHunter' : null;
  base.colorOf = colorOf;
  const normal: any = {};
  const closed: any = {};
  const keys = Object.keys(base);
  for (let i = 0; i < keys.length; i++) { normal[keys[i]] = base[keys[i]]; closed[keys[i]] = base[keys[i]]; }
  normal.pickCorner = r.claim ? 'doing' : (r.bug ? null : 'ready');
  closed.closed = true;
  closed.pickCorner = null;
  boxes.push(sec(r.a + ' 正常 / 结案', [e(PixelIssueCard, Object.assign({ key: 'n' }, normal)), e(PixelIssueCard, Object.assign({ key: 'c' }, closed))]));
});
const blkCard = e(PixelIssueCard, { key: 'b1', action: 'execute', noText: '#922', title: '本地票文件并发写保护怎么做', tags: tagsOf([['任务', '10b981']]), note: '被 #921 挡住，等它先收口', updatedText: '10-08', footActionText: '执行', blockedBy: Object.assign({ cardId: 'blk-921' }, BLK), colorOf });
const blockerCard = e(PixelIssueCard, { key: 'b2', action: 'execute', noText: '#921', title: BLK.title, tags: tagsOf([['任务', '10b981']]), updatedText: '今天', footActionText: '执行', cardId: 'blk-921', blocksChip: { no: '921', title: BLK.title }, colorOf });
boxes.push(sec('阻塞联动（点左卡，亮右卡）', [blkCard, blockerCard]));
const im919 = { mapNo: '919', title: T919, open: true, kids: 6, ready: 3, blocked: 2, updatedText: '10-08' };
const imClaim = Object.assign({}, im919, { claimedBy: 'FeatherHunter', sign: 'doing' });
const imBlk = Object.assign({}, im919, { sign: 'ready', blockedBy: Object.assign({ cardId: 's7-blk-921' }, BLK) });
const im810 = { mapNo: '810', title: T810, open: false, kids: 30, ready: 0, blocked: 0, updatedText: '10-05' };
boxes.push(sec('issue卡片-map：开态可接 / 已认领 / 被阻塞 / 已结案', [
  e(PixelIssueMapCard, Object.assign({ key: 'm1' }, im919, { sign: 'ready', dots: CELLS919 })),
  e(PixelIssueMapCard, Object.assign({ key: 'm2' }, imClaim, { dots: CELLS919 })),
  e(PixelIssueMapCard, Object.assign({ key: 'm3' }, imBlk, { dots: CELLS919 })),
  e(PixelIssueCard, { key: 'm3b', action: 'execute', noText: '#921', title: BLK.title, tags: tagsOf([['任务', '10b981']]), updatedText: '今天', footActionText: '执行', cardId: 's7-blk-921', blocksChip: { no: '921', title: BLK.title }, colorOf }),
  e(PixelIssueMapCard, Object.assign({ key: 'm4' }, im810, { dots: CELLS810 })),
]));
boxes.push(sec('map卡片：919 在办 / 810 已结案', [
  e(PixelMapCard, { key: 'p1', mapNo: '919', title: T919, open: true, updatedText: '今天', dateText: '10-08', dots: DOTS919 }),
  e(PixelMapCard, { key: 'p2', mapNo: '810', title: T810, open: false, updatedText: '3 天前', dateText: '10-05', dots: DOTS810 }),
]));
const ctl = e(PixelIssueCard, { key: 'ctl', action: 'execute', noText: '#922', title: '受控模式：lit 由外面传 false，点它暗层也要退掉', tags: tagsOf([['任务', '10b981']]), note: '被 #921 挡住，等它先收口', updatedText: '10-08', footActionText: '执行', blockedBy: BLK, lit: false, colorOf });
boxes.push(sec('受控模式（lit 由外面传，不自管）', [ctl]));
const root = document.getElementById('root');
const head = document.createElement('style');
head.textContent = PIXEL_CARDS_STYLE_TEXT.join('\n');
document.head.appendChild(head);
document.body.style.background = '#8a6f4d';
document.body.style.padding = '18px';
try {
  createRoot(root as Element).render(e('div', null, boxes));
  (document.getElementById('root') as any).setAttribute('data-smoke', 'RENDER-CALLED');
} catch (err: any) {
  root!.textContent = 'RENDER FAIL: ' + ((err && err.message) || err);
}
