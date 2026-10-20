// tests/verify-1237-mapdetail-copy.ts —— #1237 门禁：地图详情页子票行必须有四个动作（主动作/新会话/复制链接/外链打开）
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1237
// 门禁归属: src/client/views/MapDetail.ts
// 判据：
// 1. 用户在地图详情页点一张子票，能做的事情必须和列表页那一行一样多——四个都看得见、都点得动。
//    缺一个，就是把一条能走的路藏起来了，用户只能绕去列表页，之前 #1237 就是复制按钮没画出来。
// 2. 复制按钮的行为与列表页 ListTabRow.js 是同一套：点一下写剪贴板，成功变对勾 1.3 秒自退，
//    失败变叉号留到下一次操作。两边各搞一套反馈，用户会看到两种长相。
// 跑法：node tests/verify-1237-mapdetail-copy.ts
// 说明：按钮个数与顺序走 react-dom/server 静态渲染断（真组件、真 h、真身份算法，只把渲染之外的外部依赖换成假实现）；
//   反馈类名与列表页同口径走源码文本断（读文件不断行为，只防“自创第二套样式”这种两边各搞一套的情况）。
// 全程不用 DOM：静态字符串断言就够了。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// 2026-10-19（#1301 批C）：下面 C 组要读两份视图源码的原文。以前按 .js 路径直接用 readFileSync 读，
//   读到的其实是构建产物；这一阶段 src/client 下的同名 .js 产物已经删掉，直接读会 ENOENT。
//   改走共用取源入口 sourceText：问 .js 时同名 .ts 优先，读到的是手写真源，判据本身（五个反馈类名两边都在）没动。
import { sourceText } from './lib/source-text.ts'

const trFn = (key: any, params?: any) => {
  let s = String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m))
  return s
}
// 全局量必须在下面三个动态导入之前齐备（真源读的是同闭包全局量，不是 import）
globalThis.React = React
globalThis.tr = trFn
globalThis.emit = () => {}
globalThis.Ic = (props: any) => ('[icon:' + ((props && props.n) || '?') + ']')
// 身份算法走真实现（手写的假实现一旦与真实现不一致，门禁就测了个假环境）
const identityMod = await import('../src/tracker/kernel/identity-keys.js')
const linkMod = await import('../src/client/kernel/link.js')
const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
// #1296：身份色从中央色表取（改一处、整套面板跟着变）。这里注入真表与真容器判定函数，
//   徽章那条断言才能按容器类型分支：探索地图仍是探索紫，规格容器是规格蓝。
const cvMod = await import('../src/client/kernel/container-view.js')

globalThis.issueUrlFor = linkMod.issueUrlFor
globalThis.effortOf = identityMod.effortOf
globalThis.idOf = identityMod.idOf
globalThis.idOfParts = identityMod.idOfParts
globalThis.effortNamesOf = () => ['default']
globalThis.findMapByIdentity = () => null
globalThis.containerKindOf = cvMod.containerKindOf
globalThis.containerStateOf = cvMod.containerStateOf
globalThis.containerTriState = cvMod.containerTriState
globalThis.containerNumberColor = cvMod.containerNumberColor
globalThis.containerPromptText = cvMod.containerPromptText
globalThis.containerCountKey = cvMod.containerCountKey
globalThis.CONTAINER_ACCENT = cvMod.CONTAINER_ACCENT
globalThis.CONTAINER_TINT = cvMod.CONTAINER_TINT
globalThis.CONTAINER_CHIP_CLASS = cvMod.CONTAINER_CHIP_CLASS
globalThis.CONTAINER_CHIP_LABEL_KEY = cvMod.CONTAINER_CHIP_LABEL_KEY
globalThis.CONTAINER_CHIP_MARKER_CLASS = cvMod.CONTAINER_CHIP_MARKER_CLASS
globalThis.pushNav = () => {}
globalThis.openInNewSession = () => {}
globalThis.copyText = async () => true
globalThis.COPY_FLASH_MS = 1300
globalThis.mkRowAction = () => React.createElement('button', { className: 'dsws-btn primary' }, '主动作')
globalThis.actionColorOf = () => '#7aa2f7'
globalThis.isLightHex = () => false
globalThis.buildColorOf = () => () => '#7aa2f7'
globalThis.TypeChip = () => null
globalThis.useIssueDetailFold = () => null
globalThis.tProgressBar = () => null
globalThis.tStatusBadge = () => null
globalThis.blockerNames = () => ''
const TipStub = (props: any) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
globalThis.Tip = TipStub
globalThis.host = { call: () => Promise.resolve({ ok: true }) }

// 动态导入必须在全局量齐备之后
const { MapDetail } = await import('../src/client/views/MapDetail.js')
globalThis.DswsCtx = DswsCtx
// 同一闭包里的兄弟叶子走真实现（顶栏与头部的行为由它们自己的门禁守，这里只借它们的画法）
const headMod = await import('../src/client/views/MapDetailHead.js')
globalThis.MapDetailHead = headMod.MapDetailHead
const topMod = await import('../src/client/views/MapDetailTop.js')
globalThis.MapDetailTop = topMod.MapDetailTop

let failures = 0
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failures++ }
const countOf = (s: string, sub: string) => s.split(sub).length - 1
// 只看子票行自己的动作区：顶栏也有新会话/复制/外链三颗按钮（那是地图级的，由顶栏自己的门禁守），
// 全页数会把两处混在一起。动作区里没有嵌套 div，非贪心到第一个 </div> 即止。
function actsHtml(html: string) {
  const m = html.match(/<div class="acts">([\s\S]*?)<\/div>/g) || []
  return m.join('\n')
}

const services: any = {
  slots: { register: () => () => {}, inject: (name: string, fn: any) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn: any, ms: number) => setTimeout(fn, ms) },
}
const fakeStore: any = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
function makeCx(h: any) {
  return createCx({
    ctx: { get: (k: string) => services[k], effect: (fn: any) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps: any, cb: any) => { cb({ get: (k: string) => services[k] }); return { dispose: () => {} } } },
    h,
    rdom: {},
    storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
    localeSvc: services.locale,
    timer: services.timer,
    api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
    router: { open: () => {}, toggle: () => {} },
  })
}
function openTicket() {
  return { number: 1231, key: '1231', effortId: 'default', title: '子票', state: 'OPEN', blockedBy: [], labels: [{ name: 'bug' }], type: 'task', level: 0 }
}
function mapOf(tickets: any[], kind?: any) {
  return { number: 1228, key: '1228', effortId: 'default', title: '地图', state: 'OPEN', labels: [], type: kind === 'spec' ? 'spec' : undefined, tickets, stats: { levels: [{ open: tickets.length, closed: 0, total: tickets.length }], total: tickets.length, closed: 0 }, decisions: [], fog: [], outOfScope: [] }
}
function renderMap(tickets: any[], copyFlash: any, kind?: any) {
  const st: any = { snapshot: { issues: [], maps: [] }, mapTickets: null, reveal: {}, copyFlash, cwd: 'D:\\ws' }
  const g: any = { m: mapOf(tickets, kind) }
  return renderToStaticMarkup(React.createElement(DswsCtx.Provider, { value: makeCx(React.createElement) },
    React.createElement(MapDetail, { st, g, drill: false })))
}

// ---- A 组：OPEN 非雾票必须画出四个动作 ----
{
  const acts = actsHtml(renderMap([openTicket()], null))
  check(acts.includes('tip.newSession'), 'A1 地图子票行有新会话按钮（回归不动）')
  check(acts.includes('tip.copyLink'), 'A2 地图子票行有复制链接按钮（#1237 修的这一个）')
  check(acts.includes('[icon:clipboard]'), 'A3 复制按钮默认画剪贴板图标')
  check(acts.includes('list.openInTrackerTitle'), 'A4 地图子票行有外链打开按钮（回归不动）')
  const iNew = acts.indexOf('tip.newSession')
  const iCopy = acts.indexOf('tip.copyLink')
  const iOpen = acts.indexOf('list.openInTrackerTitle')
  check(iNew >= 0 && iCopy > iNew && iOpen > iCopy, 'A5 三个辅助按钮顺序是新会话→复制→外链（与列表页一致）')
}
// ---- B 组：复制反馈态（成功对勾 / 失败叉号） ----
{
  const t = openTicket()
  const key = identityMod.idOf(t)
  const htmlOk = actsHtml(renderMap([t], { key, kind: 'ok', at: Date.now() }))
  check(htmlOk.includes('[icon:check]') && htmlOk.includes('dsws-fb-okflash'), 'B1 复制成功画对勾并闪光')
  const htmlFail = actsHtml(renderMap([t], { key, kind: 'fail', at: Date.now() }))
  check(htmlFail.includes('[icon:x]') && htmlFail.includes('dsws-fb-errflash'), 'B2 复制失败画叉号并抖动')
}
// ---- C 组：与列表页同一套反馈类名（防分叉） ----
{
  // 取源见文件头：sourceText 按「同名 .ts 优先」找到真源原文；这里两处一处写 .ts、一处写 .js 说明符，
  //   两种写法都经过同一个入口，读到的都是手写真源而不是会过期的构建产物。
  const detailSrc = sourceText('src/client/views/MapDetail.ts')
  const rowSrc = sourceText('src/client/views/ListTabRow.js')
  const classes = ['dsws-fb-okflash', 'dsws-fb-success-ring', 'dsws-fb-pop', 'dsws-fb-errflash', 'dsws-fb-shake']
  for (const c of classes) {
    check(rowSrc.includes(c) && detailSrc.includes(c), 'C 反馈类名 ' + c + ' 两边都有（同一套，不过度另起）')
  }
}
// ---- D 组：回归不动（已关闭与被雾盖住的票不画动作） ----
{
  const closed = Object.assign(openTicket(), { state: 'CLOSED' })
  const htmlClosed = actsHtml(renderMap([closed], null))
  check(countOf(htmlClosed, 'tip.copyLink') === 0, 'D1 已关闭票不画复制按钮（动作区本就是空的）')
  const blocker = Object.assign(openTicket(), { number: 1, key: '1', title: '阻塞者' })
  const fogged = Object.assign(openTicket(), { blockedBy: [1] })
  // 阻塞者 OPEN → 被阻塞那张是雾态、动作区为空；这一屏恰好只剩阻塞者那一颗复制按钮
  const htmlFog = actsHtml(renderMap([blocker, fogged], null))
  check(countOf(htmlFog, 'tip.copyLink') === 1, 'D2 被雾盖住的票不画复制按钮（雾态动作区为空，没雾的那张不受影响）')
}

// ---- E 组：编号徽章与标题（2026-10-17 从 verify-t14-detail-badge 搬来） ----
// 来历：旧的那扇门禁从构建产物里切字符串，注释锚点随 #691 拆组件漂移，四个锚点全死、整扇红着。
// 这里改成渲染真组件再断 DOM 事实——同样是那三条契约（徽章在行首、文本是 #+编号、紫色且不缩放，
// 标题挂 dsws-mtitle 并有全文提示），但判据打在行为上，形态怎么重构都不会假红。
{
  const html = renderMap([openTicket()], null)
  const iBadge = html.indexOf('dsws-idnum')
  const iTitle = html.indexOf('dsws-mtitle')
  check(iBadge >= 0 && iTitle > iBadge, 'E1 编号徽章画在标题之前（行首那颗）')
  const badge = html.slice(iBadge, html.indexOf('</span>', iBadge))
  check(badge.includes('#1228'), 'E2 徽章文本是 # 加编号（实得 ' + badge.replace(/<[^>]*>/g, '') + '）')
  check(/color:\s*#c084fc/i.test(badge) && /flex:\s*none/i.test(badge), 'E3 探索地图徽章用中央色表的探索紫且不参与伸缩（flex:none）')
  // #1296 按容器类型分支：规格容器（type: 'spec'）的编号徽章必须改用规格蓝。
  //   以前这里只断一种紫色，中央化后若哪边写死一套色，另一种容器就会露馅。
  const specHtml = renderMap([openTicket()], null, 'spec')
  const iSpecBadge = specHtml.indexOf('dsws-idnum')
  const specBadge = iSpecBadge >= 0 ? specHtml.slice(iSpecBadge, specHtml.indexOf('</span>', iSpecBadge)) : ''
  check(/color:\s*#1D4ED8/i.test(specBadge) && /flex:\s*none/i.test(specBadge), 'E3b 规格容器徽章用中央色表的规格蓝且不参与伸缩（按容器类型取色）')
  const title = html.slice(iTitle, iTitle + 400)
  check(title.includes('dsws-tt-wrap'), 'E4 标题块挂了全文提示的包裹类')
  check(title.includes('地图'), 'E5 标题块里是地图标题正文')
}

console.log(failures ? `\n#1237 门禁失败 ${failures} 项（共 ${total} 条）` : `\n#1237 门禁全部通过（共 ${total} 条）`)
process.exit(failures ? 1 : 0)
