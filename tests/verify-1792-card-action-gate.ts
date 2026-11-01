// 门禁归属: src/client/views
// 门禁归属: src/client/kernel/detail-top-gate.ts
/**
 * tests/verify-1792-card-action-gate.ts —— #1792 的专属门禁：地图详情页 V2 卡片流里，
 * 已结案（含已合并）的卡片与「被明确未完成票阻塞」的卡片，主按钮与新会话按钮必须置灰、
 * 点不动、Tab 落不上，悬停说明原因；复制链接与「在跟踪器打开」保持可用；
 * 阻塞状态未知/缺失/认不出时保持可点；未结案且未被阻塞的卡片行为与今天一致。
 *
 * 为什么单独一扇：这条判据横跨模型层（票行 → 卡片刻画）与卡片组件（刻画 → DOM），
 * 只测一边都可能「模型对了但按钮没接上」或「按钮支持了但模型没给值」。这里两边都测。
 *
 * 被测对象：真源，不是产物。
 *   - src/client/views/mapDetailV2/model/tickets/ticketCardFacts.ts（判据与刻画）
 *   - src/client/views/mapDetailV2/model/assembly/cardPropsOf.ts（刻画 → 卡片 props）
 *   - src/client/views/cards/PixelIssueCard.ts / PixelCardBtns.ts / PixelCardsStyles.ts（渲染与灰态）
 *   - src/client/views/mapDetailV2/wiring/pageActionHandlers.ts（执行前再拦一次）
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1792-card-action-gate.ts
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { compileFn } = require('./lib/eval-probe.ts')
const { spliceableJs } = require('./lib/source-text.ts')
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = React

let passed = 0
let failed = 0
function check (ok: unknown, msg: string): void {
  if (ok) { passed += 1; console.log('  PASS ' + msg) } else { failed += 1; console.log('  FAIL ' + msg) }
}
function section (title: string): void { console.log(''); console.log('== ' + title + ' ==') }
const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : String(v))

const ROOT = path.resolve(__dirname, '..')
const CARDS_REL = 'src/client/views/cards'

// 与 scripts/build.mts 的 LEAF_MODULES 登记次序一致（先主题与皮肤，再共享小件，最后大卡）。
const LEAF_ORDER = [
  'PixelCardTheme', 'PixelCardsStyles', 'PixelCardPin', 'PixelCardTitle', 'PixelCardNo',
  'PixelCardTags', 'PixelCardNote', 'PixelCardFoot', 'PixelCardStamp', 'PixelBlockedChrome',
  'PixelCardBtns', 'PixelMapDots', 'PixelCardHead', 'PixelIssueCard', 'PixelIssueMapCard', 'PixelMapCard',
]

/** 去掉行首 export：闭包拼接就是这么拼的。 */
function stripExports (text: string): string { return text.replace(/^export\s+/gm, '') }

/** 真字典 + index.ts 里 locale 服务缺失时的退化实现（读 zh 字典、替换 {n}）。 */
function loadTr (): (key: string, params?: Record<string, unknown>) => string {
  const src = spliceableJs('src/client/kernel/locale-cards.js').replace(/\r\n/g, '\n') + '\nreturn L_CARDS;'
  const L = compileFn([], src)()
  return function (key: string, params?: Record<string, unknown>): string {
    let s = L.zh[key] !== undefined ? L.zh[key] : key
    if (params) s = s.replace(/\{(\w+)\}/g, function (m: string, name: string) { return name in params ? String(params[name]) : m })
    return s
  }
}

const tr = loadTr()
const DswsCtx = React.createContext(null)
globalThis.MOTION = require('../src/client/kernel/motion.ts').MOTION

/**
 * Tip 的测试替身：真 Tip 会克隆触发元素、只在触发元素没有显式 aria-label 时补一条；
 * 这里做同样的选择，好让门禁能看出「按钮自己的可访问名有没有被提示整句换掉」。
 */
const tipCalls: string[] = []
function TipStub (props: any): any {
  const p = props || {}
  if (p.content !== undefined) tipCalls.push(String(p.content))
  const child: any = p.children
  if (p.content !== undefined && child && child.props &&
      child.props['aria-label'] === undefined && child.props['aria-labelledby'] === undefined) {
    return React.cloneElement(child, { 'aria-label': String(p.content) })
  }
  return child
}

function loadCards (): Record<string, any> {
  const body = LEAF_ORDER.map((name) => stripExports(spliceableJs(CARDS_REL + '/' + name + '.js').replace(/\r\n/g, '\n'))).join('\n')
  const factory = compileFn(['React', 'DswsCtx', 'tr', 'Tip'], body + '\nreturn { PIXEL_CARDS_STYLE_TEXT: PIXEL_CARDS_STYLE_TEXT, PixelIssueCard: PixelIssueCard, PixelCardBtns: PixelCardBtns };')
  return factory(React, DswsCtx, tr, TipStub)
}

// ===========================================================================
// 0. 模型层：判据与刻画
// ===========================================================================
section('0. 模型层：已结案 / 被明确未完成票阻塞 / 未知三种来路的动作门')
// ticketCardFacts 是叶子：生产里 detailTopGate 与 prStateKind 都由 kernel 拼进同一个闭包；
// 这里直接 require 时把它们挂到 globalThis，让门禁验的就是同一个判据。
// 外面再包一层计数：断言「已结案/已合并也真的走进 detailTopGate」，而不是被调用方提前短路。
globalThis.prStateKind = require('../src/client/views/shared/stateKind.ts').prStateKind
const realDetailTopGate = require('../src/client/kernel/detail-top-gate.ts').detailTopGate
const gateStates: string[] = []
globalThis.detailTopGate = function (issue: any, nodes?: any): any {
  gateStates.push(String(issue && issue.state))
  return realDetailTopGate(issue, nodes)
}
const facts = require('../src/client/views/mapDetailV2/model/tickets/ticketCardFacts.ts')
const cardProps = require('../src/client/views/mapDetailV2/model/assembly/cardPropsOf.ts')

/** 词条桩：只回固定中文，断言的是「用了哪条词条、票号怎么拼」，不是某段真实文案。 */
function textOf (key: string, params?: Record<string, unknown>): string {
  if (key === 'tip.detailClosedReadonly') return 'CLOSED_TIP'
  if (key === 'tip.detailBlockedBy') return 'BLOCKED_TIP:' + String((params && params.n) || '')
  if (key === 'tip.detailBlockedByJoin') return '、'
  return key
}
const ENV = { cardIdPrefix: 't1792', colorOf: {}, actionOf: function () { return 'execute' }, textOf: textOf }
const ROWS = [
  { key: 'i-1', number: 1, title: '一号', state: 'OPEN' },
  { key: 'i-10', number: 10, title: '已结案的票', state: 'CLOSED' },
  { key: 'i-11', number: 11, title: '挡路甲', state: 'OPEN' },
  { key: 'i-12', number: 12, title: '挡路乙', state: 'OPEN' },
  { key: 'i-20', number: 20, title: '被本图两张票挡住', state: 'OPEN', blockedBy: [12, 11] },
  { key: 'i-30', number: 30, title: '阻塞状态未知', state: 'OPEN', blockedBy: [99] },
  { key: 'i-40', number: 40, title: '图外明确开着', state: 'OPEN', blockedBy: ['041'], blockedByRefs: [{ key: '041', title: '图外那张', state: 'OPEN' }] },
  { key: 'i-50', number: 50, title: '图外明确已关', state: 'OPEN', blockedBy: [51], blockedByRefs: [{ key: 51, state: 'CLOSED' }] },
  { key: 'i-60', number: 60, title: '在办但有明确开着的阻塞者', state: 'OPEN', claimedBy: '张三', blockedBy: [11] },
  { key: 'i-70', number: 70, title: '补零与重复', state: 'OPEN', blockedBy: ['01', '1'] },
  { key: 'i-80', number: 80, title: '票号认不出', state: 'OPEN', blockedBy: ['x'] },
  { key: 'i-90', number: 90, title: '已合并（MERGED）', state: 'MERGED' },
  { key: 'i-91', number: 91, title: '已合并（mergedAt）', state: 'OPEN', mergedAt: '2026-10-31T12:00:00Z' },
  { key: 'i-92', number: 92, title: '被已合并票阻塞', state: 'OPEN', blockedBy: [90] },
  { key: 'i-93', number: 93, title: '被带合并时间的票阻塞', state: 'OPEN', blockedBy: [91] },
]
const CTX = facts.ticketFactsContextOf(ROWS, ENV)
const factOf = function (no: number) { return facts.ticketCardFactsOf(ROWS.filter(function (row) { return row.number === no })[0], CTX) }

{
  const f = factOf(10)
  check(f.actionGate.clickable === false && f.actionGate.reason === 'closed' && f.actionGate.blockedNumbers.length === 0,
    '已结案卡片的动作门：不可点、原因 closed、不列阻塞票（实得 ' + show(f.actionGate) + '）')
  check(f.actionTip === 'CLOSED_TIP', '已结案卡片的悬停说明取「已关闭」词条（实得 ' + show(f.actionTip) + '）')
}
{
  const f = factOf(20)
  check(f.actionGate.clickable === false && f.actionGate.reason === 'blocked' && show(f.actionGate.blockedNumbers) === '11,12',
    '被本图两张明确开着的票阻塞：不可点、原因 blocked、票号去重升序（实得 ' + show(f.actionGate) + '）')
  check(f.actionTip === 'BLOCKED_TIP:#11、#12', '被阻塞卡的悬停说明点名票号，分隔符取词条（实得 ' + show(f.actionTip) + '）')
}
{
  const f = factOf(30)
  check(f.status === 'blocked', '阻塞状态未知时，卡片仍按安全侧画成「被挡」（实得 ' + show(f.status) + '）')
  check(f.actionGate.clickable === true && f.actionGate.reason === 'none' && f.actionTip === '',
    '但阻塞状态未知时两颗动作按钮保持可点、不给说明（实得 ' + show(f.actionGate) + ' / ' + show(f.actionTip) + '）')
}
{
  const f = factOf(40)
  check(f.actionGate.clickable === false && show(f.actionGate.blockedNumbers) === '41',
    '图外阻塞者明确写着 OPEN：同样不可点并点名（实得 ' + show(f.actionGate) + '）')
}
{
  const f = factOf(50)
  check(f.status === 'ready' && f.actionGate.clickable === true,
    '图外阻塞者明确写着 CLOSED：卡片可接、动作可点（实得 ' + show(f.status) + ' / ' + show(f.actionGate) + '）')
}
{
  const f = factOf(60)
  check(f.status === 'doing' && f.actionGate.clickable === false && show(f.actionGate.blockedNumbers) === '11',
    '在办卡也照同一判据：有明确开着的阻塞者就不可点（实得 ' + show(f.status) + ' / ' + show(f.actionGate) + '）')
}
{
  const f = factOf(70)
  check(f.actionGate.clickable === false && show(f.actionGate.blockedNumbers) === '1',
    '补零票号归一后只点名一次（实得 ' + show(f.actionGate) + '）')
}
{
  const f = factOf(80)
  check(f.actionGate.clickable === true && f.actionTip === '',
    '阻塞者票号认不出时按未知处理，保持可点（实得 ' + show(f.actionGate) + '）')
}
{
  const f = factOf(90)
  check(f.status === 'closed' && f.actionGate.clickable === false && f.actionGate.reason === 'closed' && f.actionTip === 'CLOSED_TIP',
    'MERGED 行按已结案处理：卡片结案、两颗动作按钮不可点（实得 ' + show(f.status) + ' / ' + show(f.actionGate) + '）')
  const f91 = factOf(91)
  check(f91.status === 'closed' && f91.actionGate.clickable === false && f91.actionGate.reason === 'closed',
    'state 仍写 OPEN、另带 mergedAt 的行也按已结案处理（实得 ' + show(f91.status) + ' / ' + show(f91.actionGate) + '）')
  const f92 = factOf(92)
  check(f92.status === 'ready' && f92.actionGate.clickable === true,
    '被已合并（MERGED）票阻塞不算被明确未完成票阻塞，动作保持可点（实得 ' + show(f92.status) + ' / ' + show(f92.actionGate) + '）')
  const f93 = factOf(93)
  check(f93.status === 'ready' && f93.actionGate.clickable === true,
    '被带 mergedAt 的票阻塞同样不算未完成，动作保持可点（实得 ' + show(f93.status) + ' / ' + show(f93.actionGate) + '）')
  check(gateStates.indexOf('CLOSED') >= 0 && gateStates.indexOf('MERGED') >= 0,
    '已结案与已合并都真的走进 detailTopGate（实得 ' + show(gateStates.join(',')) + '）')
}
{
  const p = cardProps.cardPropsOf(factOf(20), null, null)
  check(!!p.actionGate && p.actionGate.disabled === true && p.actionGate.reason === 'blocked' &&
    show(p.actionGate.blockedNumbers) === '11,12' && p.actionGate.tip === 'BLOCKED_TIP:#11、#12',
    '适配层把动作门原样交给卡片（实得 ' + show(p.actionGate) + '）')
  const p10 = cardProps.cardPropsOf(factOf(10), null, null)
  check(!!p10.actionGate && p10.actionGate.disabled === true && p10.actionGate.reason === 'closed' && p10.actionGate.tip === 'CLOSED_TIP',
    '已结案卡片的动作门也交给卡片（实得 ' + show(p10.actionGate) + '）')
  const p30 = cardProps.cardPropsOf(factOf(30), null, null)
  check(!!p30.actionGate && p30.actionGate.disabled === false && p30.actionGate.tip === '',
    '未知阻塞的卡片交给卡片的是「可点」（实得 ' + show(p30.actionGate) + '）')
}

// ===========================================================================
// 1. 卡片组件：aria-disabled / tabIndex / data-log / Tip 说明 / 点击
// ===========================================================================
const M = loadCards()
const STYLE_TEXT = M.PIXEL_CARDS_STYLE_TEXT.join('\n')
let WIN: any = null
let DOC: any = null
function setupDom (css: string): void {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:19387/' })
  const style = dom.window.document.createElement('style')
  style.textContent = css
  dom.window.document.head.appendChild(style)
  global.window = dom.window
  global.document = dom.window.document
  global.IS_REACT_ACT_ENVIRONMENT = true
  WIN = dom.window
  DOC = dom.window.document
}
setupDom(STYLE_TEXT)
async function mount (element: unknown): Promise<any> {
  const host = DOC.createElement('div')
  DOC.body.appendChild(host)
  const reactRoot = ReactDOMClient.createRoot(host)
  await act(async () => { reactRoot.render(element) })
  return {
    host,
    q: (sel: string) => host.querySelector(sel),
    qa: (sel: string) => Array.from(host.querySelectorAll(sel)),
    text: (sel: string) => { const el = host.querySelector(sel); return el ? String(el.textContent || '') : null },
    attr: (sel: string, name: string) => { const el = host.querySelector(sel); return el ? el.getAttribute(name) : null },
    async click (target: any) {
      const el = typeof target === 'string' ? host.querySelector(target) : target
      if (!el) { check(false, '点不到元素：' + String(target)); return }
      await act(async () => { el.dispatchEvent(new WIN.MouseEvent('click', { bubbles: true })) })
    },
    async unmount () { await act(async () => { reactRoot.unmount() }); host.remove() },
  }
}

async function main(): Promise<void> {
section('1. 卡片组件：置灰的只有主按钮与新会话，复制与打开照旧')
{
  const calls: string[] = []
  const h = await mount(React.createElement(M.PixelIssueCard, {
    action: 'execute', noText: '#20', title: '被挡的票', footActionText: '被挡',
    actionGate: { disabled: true, tip: '被 #11、#12 阻塞，等它们关闭后才能执行。', reason: 'blocked', blockedNumbers: [11, 12] },
    onMain: function () { calls.push('main') }, onNew: function () { calls.push('new') },
    onCopy: function () { calls.push('copy') }, onOpen: function () { calls.push('open') },
    onCard: function () { calls.push('card') },
  }))
  const btns = h.qa('.cd-actions .cd-abtn')
  check(btns.length === 4, '置灰卡仍画出 4 颗按钮（实得 ' + btns.length + '）')
  check(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'aria-disabled') === 'true' && h.attr('.cd-actions .cd-abtn:nth-child(1)', 'tabindex') === '-1',
    '主按钮：aria-disabled=true、tabindex=-1（实得 ' + show(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'aria-disabled')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'tabindex')) + '）')
  check(h.attr('.cd-actions .cd-abtn:nth-child(2)', 'aria-disabled') === 'true' && h.attr('.cd-actions .cd-abtn:nth-child(2)', 'tabindex') === '-1',
    '新会话：aria-disabled=true、tabindex=-1（实得 ' + show(h.attr('.cd-actions .cd-abtn:nth-child(2)', 'aria-disabled')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(2)', 'tabindex')) + '）')
  check(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'data-log') === null && h.attr('.cd-actions .cd-abtn:nth-child(2)', 'data-log') === null,
    '置灰的两颗不挂 data-log（点了不该被记一条 ui.action 日志）')
  check(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'aria-label') === '执行' && h.attr('.cd-actions .cd-abtn:nth-child(2)', 'aria-label') === '新会话',
    '置灰按钮的可访问名仍是可见动作名，不被提示整句换掉（实得 ' + show(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'aria-label')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(2)', 'aria-label')) + '）')
  check(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'data-press') === null && h.attr('.cd-actions .cd-abtn:nth-child(2)', 'data-press') === null,
    '置灰的两颗不挂 data-press，按下不再出现 dsws-pressing 的位移（实得 ' + show(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'data-press')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(2)', 'data-press')) + '）')
  check(tipCalls.length === 2 && tipCalls[0] === '被 #11、#12 阻塞，等它们关闭后才能执行。' && tipCalls[1] === tipCalls[0],
    '两颗置灰按钮各挂一条同样的 Tip 说明（实得 ' + show(tipCalls) + '）')
  check(h.attr('.cd-actions .cd-abtn:nth-child(3)', 'aria-disabled') === null && h.attr('.cd-actions .cd-abtn:nth-child(3)', 'data-log') === 'card.btn.issue.20.copy',
    '复制按钮没有置灰，定位串照旧（实得 ' + show(h.attr('.cd-actions .cd-abtn:nth-child(3)', 'aria-disabled')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(3)', 'data-log')) + '）')
  check(h.attr('.cd-actions .cd-abtn:nth-child(4)', 'aria-disabled') === null && h.attr('.cd-actions .cd-abtn:nth-child(4)', 'data-log') === 'card.btn.issue.20.open',
    '打开按钮没有置灰，定位串照旧（实得 ' + show(h.attr('.cd-actions .cd-abtn:nth-child(4)', 'aria-disabled')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(4)', 'data-log')) + '）')
  await h.click(btns[0])
  await h.click(btns[1])
  check(calls.join(',') === '', '点置灰的主按钮与新会话什么都不做（实得 ' + show(calls.join(',')) + '）')
  await h.click(btns[2])
  await h.click(btns[3])
  check(calls.join(',') === 'copy,open', '复制与打开仍然打到各自的回调（实得 ' + show(calls.join(',')) + '）')
  await h.click('.cd-card')
  check(calls.join(',') === 'copy,open,card', '整卡点按仍然进详情（实得 ' + show(calls.join(',')) + '）')
  await h.unmount()
}
{
  const calls: string[] = []
  const h = await mount(React.createElement(M.PixelIssueCard, {
    action: 'execute', noText: '#50', title: '可接的票',
    actionGate: { disabled: false, tip: '', reason: 'none', blockedNumbers: [] },
    onMain: function () { calls.push('main') }, onNew: function () { calls.push('new') },
  }))
  check(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'aria-disabled') === null && h.attr('.cd-actions .cd-abtn:nth-child(1)', 'data-log') === 'card.btn.issue.50.main' && h.attr('.cd-actions .cd-abtn:nth-child(1)', 'data-press') === 'button',
    '可点卡片的主按钮不带 aria-disabled、定位串与 data-press 照旧（实得 ' + show(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'aria-disabled')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'data-log')) + ' / ' + show(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'data-press')) + '）')
  await h.click('.cd-actions .cd-abtn:nth-child(1)')
  await h.click('.cd-actions .cd-abtn:nth-child(2)')
  check(calls.join(',') === 'main,new', '可点卡片的主按钮与新会话照常回调（实得 ' + show(calls.join(',')) + '）')
  await h.unmount()
}
{
  const calls: string[] = []
  const h = await mount(React.createElement(M.PixelCardBtns, {
    mainLabel: '实施', icon: 'play', mainColor: 'd73a4a', disabled: true, disabledTip: '不能点',
    onMain: function () { calls.push('main') }, onNew: function () { calls.push('new') },
    onCopy: function () { calls.push('copy') }, onOpen: function () { calls.push('open') },
  }))
  check(h.attr('.cd-actions .cd-abtn:nth-child(1)', 'aria-disabled') === 'true' && h.attr('.cd-actions .cd-abtn:nth-child(2)', 'aria-disabled') === 'true',
    '按钮行单独使用时也支持 disabled：主按钮与新会话都置灰')
  check(h.attr('.cd-actions .cd-abtn:nth-child(3)', 'aria-disabled') === null && h.attr('.cd-actions .cd-abtn:nth-child(4)', 'aria-disabled') === null,
    '按钮行单独使用时复制与打开不置灰')
  await h.click('.cd-actions .cd-abtn:nth-child(1)')
  await h.click('.cd-actions .cd-abtn:nth-child(2)')
  check(calls.join(',') === '', '按钮行单独使用时置灰的两颗点了也不回调（实得 ' + show(calls.join(',')) + '）')
  await h.unmount()
}

section('2. 灰态样式：透明度、禁用光标与悬停复位都在皮肤里')
{
  check(/\.cd-abtn\[aria-disabled="true"\]\{[^}]*opacity:/.test(STYLE_TEXT),
    '皮肤里有 aria-disabled 的透明度规则')
  check(/\.cd-abtn\[aria-disabled="true"\]\{[^}]*cursor:not-allowed/.test(STYLE_TEXT),
    '皮肤里有 aria-disabled 的禁用光标')
  check(/\.cd-abtn\[aria-disabled="true"\]:hover\{[^}]*transform:none/.test(STYLE_TEXT),
    '悬停时压掉像素按钮的位移（灰态不能看起来还能按）')
  check(!/\.cd-abtn\[aria-disabled="true"\]\{[^}]*filter:/.test(STYLE_TEXT),
    '灰态不再叠去饱和滤镜，只靠透明度与禁用光标')
}

// ===========================================================================
// 3. 接线层：执行前再拦一次
// ===========================================================================
section('3. 接线层：页面回调执行前再拦一次，复制与整卡点按不受影响')
{
  const deps = ['inject', 'rowActionText', 'openInNewSession', 'copyText', 'issueUrlFor', 'openTrackerTarget', 'effortOf', 'enterSubDetail', 'tr']
  const body = spliceableJs('src/client/views/mapDetailV2/wiring/pageActionHandlers.ts').replace(/\r\n/g, '\n') + '\nreturn { pageActionHandlersOf: pageActionHandlersOf };'
  const factory = compileFn(deps, body)
  const calls: Record<string, number> = { inject: 0, newsession: 0, copy: 0, open: 0, card: 0 }
  const handlerMod = factory(
    function () { calls.inject += 1 },
    function () { return 'prompt' },
    function () { calls.newsession += 1 },
    function () { calls.copy += 1 },
    function () { return 'https://example.test/issue/20' },
    function () { calls.open += 1 },
    function () { return '' },
    function () { calls.card += 1 },
    function (key: string) { return key },
  )
  const handlers = handlerMod.pageActionHandlersOf(null, ROWS)
  const blocked = factOf(20)
  const clickable = factOf(50)
  handlers.onMain(blocked)
  handlers.onNew(blocked)
  check(calls.inject === 0 && calls.newsession === 0, '置灰卡的主按钮与新会话在接线层也不执行（实得 ' + show(calls) + '）')
  handlers.onCopy(blocked)
  handlers.onOpen(blocked)
  handlers.onCard(blocked)
  check(calls.copy === 1 && calls.open === 1 && calls.card === 1, '置灰卡的复制、打开、整卡点按照常执行（实得 ' + show(calls) + '）')
  handlers.onMain(clickable)
  handlers.onNew(clickable)
  check(calls.inject === 1 && calls.newsession === 1, '可点卡的主按钮与新会话照常执行（实得 ' + show(calls) + '）')
}

}

main().then(() => {
  console.log('')
  console.log(failed ? '存在失败：' + passed + ' 条通过 / ' + failed + ' 条未过' : '卡片动作门禁全部通过（' + passed + ' 条断言）')
  process.exitCode = failed ? 1 : 0
}).catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exitCode = 1
})
