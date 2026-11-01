// tests/verify-map-first-frame-freshness.ts —— #1696 门禁：地图详情首帧用快照已知数据画，加载与失败都不把已知画成空
// https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1696
// 门禁归属: src/host/tracker/snapshotAssemble.ts
// 门禁归属: src/host/tracker/snapshot.ts
// 门禁归属: src/client/views/mapDetailV2/view/MapDetailV2Page.ts
// 门禁归属: src/client/views/mapDetailV2/model/tickets/ticketFeed.ts
//
// 为什么这条门禁读构建产物：它判的是「进地图详情第一帧（按需取子票还没回来）画的是什么」，
// 那是构建后的客户端闭包与宿主快照一起决定的结果。按 scripts/verify-stages.json 的约定，
// 文件名带 freshness 落在最后一段（build 之后），所以这里能同时断源码行为与 package/lib/client.js 里
// 真的带着这几段投影代码——构建没跟上源码时判红，而不是拿旧产物自证。
//
// 判据（每条都要有反例，见 F 组）：
//   A 快照层：宿主重建时把子票归一成首帧可画的形状（数字票号/数字阻塞者/反向 blocks/认领人/层级/计数）；
//   B 首帧：没有按需取数桶时，页面直接用快照行画卡片与计数，被挡关系看得见、顺序在投影层；
//   C 失败：按需取数失败（mode=err）时计数与被挡关系一条不少，只是子票那句说失败；
//   D 加载中：bucket=loading 时计数用快照已知真数，不写短横占位；
//   E 降级：REST 降级/截断来源只补空缺，已知子票、阻塞边与计数不缩；
//   F 负例：绕过宿主归一（直接把 assembleSnapshot 的原始行交给页面）时被挡计数必须变成 0、被挡封印消失——
//     证明「首帧画得出关系与计数」这件事确实是本票修的那一段在起作用，而不是门禁自己凑出来的；
//   G 产物：package/lib/client.js 里确实有这页与投影函数（构建新鲜度）。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-map-first-frame-freshness.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { printGateResult } from './lib/gate-result.ts'
import { LOCALE_COPY } from '../src/client/kernel/locale-data.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const GATE = 'verify-map-first-frame-freshness'

let total = 0
let failed = 0
function check(ok: any, msg: string, detail?: any): void {
  total += 1
  if (!ok) failed += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

// ---- 界面词表：用生成物里的缺省语言（真 tr 的退化路径与它同口径），计数句要能读出数字 ----
const LANGS = Object.keys(LOCALE_COPY)
const LANG = LANGS[0]
const trFn = (key: any, params?: any) => {
  const doc: any = (LOCALE_COPY as any)[LANG] || {}
  let s = doc[key] !== undefined ? String(doc[key]) : String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m))
  return s
}

// ---- 全局量：真实现（身份算法、容器判定、词表、动作判定），只把渲染之外的外部依赖换成假实现 ----
globalThis.React = React
globalThis.tr = trFn
globalThis.emit = () => {}
globalThis.Ic = (props: any) => ('[icon:' + ((props && props.n) || '?') + ']')

const identityMod = await import('../src/tracker/kernel/identity-keys.js')
const linkMod = await import('../src/client/kernel/link.js')
const { DswsCtx, createCx } = await import('../src/client/kernel/ctx.js')
const cvMod = await import('../src/client/kernel/container-view.js')
const tlMod = await import('../src/client/kernel/ticket-label.js')
globalThis.issueUrlFor = linkMod.issueUrlFor
globalThis.openModeFor = linkMod.openModeFor
globalThis.openTrackerTarget = linkMod.openTrackerTarget
globalThis.effortOf = identityMod.effortOf
globalThis.idOf = identityMod.idOf
globalThis.idOfParts = identityMod.idOfParts
globalThis.ticketLabelOf = tlMod.ticketLabelOf
globalThis.ticketLabelNodesOf = tlMod.ticketLabelNodesOf
globalThis.TICKET_LABEL_MAX_WIDTH = tlMod.TICKET_LABEL_MAX_WIDTH
globalThis.ticketBadgeOf = (await import('../src/client/views/shared/ticketBadge.js')).ticketBadgeOf
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
globalThis.CONTAINER_EMPTY_COLOR = cvMod.CONTAINER_EMPTY_COLOR
globalThis.CONTAINER_DONE_COLOR = cvMod.CONTAINER_DONE_COLOR
globalThis.CONTAINER_CHIP_CLASS = cvMod.CONTAINER_CHIP_CLASS
globalThis.CONTAINER_CHIP_LABEL_KEY = cvMod.CONTAINER_CHIP_LABEL_KEY
globalThis.CONTAINER_CHIP_MARKER_CLASS = cvMod.CONTAINER_CHIP_MARKER_CLASS
globalThis.completePrompt = cvMod.completePrompt
globalThis.inspectPrompt = cvMod.inspectPrompt
globalThis.promptTextFor = cvMod.promptTextFor
globalThis.startText = cvMod.startText
globalThis.pushNav = () => {}
globalThis.popNav = () => {}
globalThis.openInNewSession = () => {}
globalThis.copyText = async () => true
globalThis.inject = () => {}
globalThis.isLightHex = () => false
globalThis.buildColorOf = () => () => '#7aa2f7'
const rowActionsMod = await import('../src/client/kernel/row-actions.js')
globalThis.rowActionKind = rowActionsMod.rowActionKind
globalThis.rowActionText = rowActionsMod.rowActionText
globalThis.enterSubDetail = (await import('../src/client/views/subIssueRouting.js')).enterSubDetail
globalThis.useIssueDetailFold = () => null
globalThis.TypeChip = () => null
globalThis.mdToHtml = () => ''
globalThis.mdImgOverlay = () => null
globalThis.Tip = (props: any) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
globalThis.host = { call: () => Promise.resolve({ ok: true }) }
// 首帧按需取数还没敲门：effect 在静态渲染里不跑；这里再放一个「被调用就抛」的桩，
// 万一将来有人把取数挪进渲染体，这条门禁会直接报出来，而不是悄悄发请求。
globalThis.fetchMapTickets = async () => { throw new Error('首帧不应发起按需取数请求') }

// ---- 真投影函数（拼接闭包里它们是同作用域兄弟，这里按生产顺序挂全局） ----
const feedMod = await import('../src/client/views/mapDetailV2/model/tickets/ticketFeed.js')
globalThis.ticketFeedOf = feedMod.ticketFeedOf
globalThis.mergeTicketRows = feedMod.mergeTicketRows
const factsMod = await import('../src/client/views/mapDetailV2/model/tickets/ticketCardFacts.js')
globalThis.ticketFactsContextOf = factsMod.ticketFactsContextOf
globalThis.ticketCardFactsOf = factsMod.ticketCardFactsOf
const boardMod = await import('../src/client/views/mapDetailV2/model/tickets/ticketBoard.js')
globalThis.orderTicketBoard = boardMod.orderTicketBoard
globalThis.boardCountsOf = boardMod.boardCountsOf
const profileMod = await import('../src/client/views/mapDetailV2/model/container/mapProfile.js')
globalThis.mapProfileOf = profileMod.mapProfileOf
const propsMod = await import('../src/client/views/mapDetailV2/model/assembly/cardPropsOf.js')
globalThis.cardPropsListOf = propsMod.cardPropsListOf
const pageModelMod = await import('../src/client/views/mapDetailV2/model/assembly/mapDetailPageModel.js')
globalThis.mapDetailPageModelOf = pageModelMod.mapDetailPageModelOf

// ---- 真组件（顺序与 scripts/build.mts 的拼接顺序一致：卡片小件 → 卡片 → 流 → 档案 → 顶栏 → 页） ----
for (const name of ['PixelCardPin', 'PixelCardNo', 'PixelCardTitle', 'PixelCardTags', 'PixelCardNote', 'PixelCardFoot', 'PixelCardStamp', 'PixelBlockedChrome', 'PixelCardBtns', 'PixelCardTheme', 'PixelIssueCard']) {
  const mod: any = await import('../src/client/views/cards/' + name + '.js')
  for (const k of Object.keys(mod)) (globalThis as any)[k] = mod[k]
}
globalThis.TicketCardFlow = (await import('../src/client/views/mapDetailV2/view/flow/TicketCardFlow.js')).TicketCardFlow
globalThis.MapProfileHeader = (await import('../src/client/views/mapDetailV2/view/profile/MapProfileHeader.js')).MapProfileHeader
globalThis.MapDetailTop = (await import('../src/client/views/MapDetailTop.js')).MapDetailTop
globalThis.pageActionHandlersOf = (await import('../src/client/views/mapDetailV2/wiring/pageActionHandlers.js')).pageActionHandlersOf
globalThis.useMapTicketsFeed = (await import('../src/client/views/mapDetailV2/wiring/useMapTicketsFeed.js')).useMapTicketsFeed
globalThis.MapDetailV2Page = (await import('../src/client/views/mapDetailV2/view/MapDetailV2Page.js')).MapDetailV2Page
globalThis.DswsCtx = DswsCtx

// ---- 假世界：真 assembleSnapshot + 真 carryOverMapTickets（宿主重建快照的同一段路） ----
const { assembleSnapshot } = await import('../src/host/tracker/snapshotAssemble.js')
const { carryOverMapTickets } = await import('../src/host/tracker/snapshotAssemble.ts')

function issue(n: number, extra: any = {}) {
  return Object.assign({
    key: String(n), number: n, effortId: 'default', type: 'issue', title: '票 ' + n,
    state: 'OPEN', body: '', url: 'https://x/' + n, createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z', closedAt: null, parentKey: null, labels: [], assignees: [],
    author: { login: 'me' }, blockedBy: [], comments: [], isPullRequest: false, mergedAt: null,
  }, extra)
}
// 容器 100：201 被 301 挡着，305 可接，401 已关闭；容器 500 已关闭（首帧子票为空是现行口径）。
function fullRows() {
  return [
    issue(100, { type: 'map', title: '地图 100' }),
    issue(201, { parentKey: '100', blockedBy: [{ key: '301' }], title: '子票 201' }),
    issue(301, { parentKey: '100', title: '阻塞者 301' }),
    issue(305, { parentKey: '100', title: '子票 305' }),
    issue(401, { parentKey: '100', state: 'CLOSED', title: '子票 401' }),
    issue(500, { type: 'map', state: 'CLOSED', title: '已关闭地图 500' }),
    issue(501, { parentKey: '500', state: 'CLOSED', title: '子票 501' }),
  ]
}
// 降级来源：REST 列表行没有父子边与依赖边（父边靠容器 sub_issues 兜底、依赖整份没表达），且只回了两行。
function degradedRows() {
  return [
    issue(100, { type: 'map', title: '地图 100' }),
    issue(201, { parentKey: '100', title: '子票 201（降级）', updatedAt: '2026-09-25T00:00:00Z' }),
  ]
}
const NOW = 1700000000000
const prevSnapshot: any = carryOverMapTickets(null, assembleSnapshot({ owner: 'o', name: 'r' }, fullRows()), { sourceComplete: true, nowMs: NOW - 60000 })
const firstSnapshot: any = carryOverMapTickets(prevSnapshot, assembleSnapshot({ owner: 'o', name: 'r' }, fullRows()), { sourceComplete: true, nowMs: NOW })
const degradedSnapshot: any = carryOverMapTickets(prevSnapshot, assembleSnapshot({ owner: 'o', name: 'r' }, degradedRows()), { sourceComplete: false, nowMs: NOW })
const rawSnapshot: any = assembleSnapshot({ owner: 'o', name: 'r' }, fullRows())

const mapOf = (snap: any, key = '100') => snap.maps.filter((m: any) => String(m.key) === key)[0]
const ticketOf = (snap: any, n: number) => (mapOf(snap).tickets || []).filter((t: any) => Number(t.number) === n)[0]

// ---- 渲染入口：真页面 + 真 cx；g 就是 Dock 传的同一个分组对象（g.m 是快照里那张地图行） ----
const services: any = {
  slots: { register: () => () => {}, inject: (name: string, fn: any) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn: any, ms: number) => setTimeout(fn, ms) },
}
function renderPage(snapshot: any, mapKey: string, bucket: any): string {
  const fakeStore: any = { snapshot, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false }, mapTickets: {}, navStack: [] }
  const cx = createCx({
    ctx: { get: (k: string) => services[k], effect: (fn: any) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (deps: any, cb: any) => { cb({ get: (k: string) => services[k] }); return { dispose: () => {} } } },
    h: React.createElement,
    rdom: {},
    storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
    localeSvc: services.locale,
    timer: services.timer,
    api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
    router: { open: () => {}, toggle: () => {} },
  })
  const map = mapOf(snapshot, mapKey)
  const st: any = { snapshot, mapTickets: bucket ? { [identityMod.idOfParts('default', Number(mapKey))]: bucket } : {}, cwd: 'D:\\ws', navStack: [] }
  return renderToStaticMarkup(React.createElement(DswsCtx.Provider, { value: cx }, React.createElement(globalThis.MapDetailV2Page, { st, g: { m: map } })))
}
const countOf = (s: string, sub: string) => s.split(sub).length - 1
const blockedCountText = (html: string) => {
  const m = html.match(/data-status="blocked">([^<]*)</)
  return m ? m[1] : ''
}
const cardIds = (html: string) => (html.match(/id="m2-default-100-(\d+)"/g) || []).map((x) => String(x).replace(/^.*-(\d+)"$/, '$1'))

// ---- A 快照层：归一化后的首帧形状 ----
{
  const map = mapOf(firstSnapshot)
  check(Array.isArray(map.tickets) && map.tickets.length === 4, 'A1 完整来源：容器首帧带四张子票（含已关闭那张）', map.tickets && map.tickets.length)
  check(map.tickets.every((t: any) => typeof t.number === 'number'), 'A2 子票票号是数字（客户端按数字查阻塞者）', map.tickets.map((t: any) => t.number))
  const blocked = ticketOf(firstSnapshot, 201)
  check(JSON.stringify(blocked.blockedBy) === JSON.stringify([301]), 'A3 阻塞边归一成数字票号', blocked.blockedBy)
  check((ticketOf(firstSnapshot, 301).blocks || []).indexOf(201) >= 0, 'A4 反向边 blocks 由阻塞关系推出来（被挡的那张挂在阻塞者上）', ticketOf(firstSnapshot, 301).blocks)
  check(map.stats && map.stats.total === 4 && map.stats.open === 3 && map.stats.closed === 1, 'A5 容器计数：四张、开着三张、关闭一张', map.stats)
  check(map.stats && map.stats.blocked === 1, 'A6 容器计数里有被挡一张', map.stats && map.stats.blocked)
  check(map.stats && Array.isArray(map.stats.levels) && map.stats.levels.length === 2, 'A7 层级随首帧一起算好（两层）', map.stats && map.stats.levels)
  check(Number(blocked.level) === 1 && map.stats.levelOf['201'] === 1, 'A8 被挡那张在第 1 层', { level: blocked.level, levelOf: map.stats.levelOf })
  check(Array.isArray(mapOf(firstSnapshot, '500').tickets) && mapOf(firstSnapshot, '500').tickets.length === 0, 'A9 已关闭容器首帧子票为空（现行口径不动）')
}

// ---- B 首帧渲染：没有按需取数桶时直接画快照行 ----
{
  const html = renderPage(firstSnapshot, '100', null)
  check(blockedCountText(html) === trFn('map.grpBlocked', { n: 1 }), 'B1 首帧计数：被阻塞 1（数字来自快照计数）', blockedCountText(html))
  check(html.indexOf('data-status="ready">' + trFn('map.grpTakeable', { n: 2 })) >= 0, 'B2 首帧计数：可接 2')
  check(html.indexOf(trFn('map.subCount', { n: 4, c: 1 })) >= 0, 'B3 首帧子票那句用快照已知总数与已关闭数')
  check(html.indexOf('data-log="card.blockedSeal"') >= 0 && html.indexOf('被 #301 阻塞') >= 0, 'B4 首帧画出被挡关系（被 #301 阻塞）')
  check(html.indexOf('id="m2-default-100-201"') >= 0 && /id="m2-default-100-201"[^>]*class="cd-card dim"|class="cd-card dim"[^>]*id="m2-default-100-201"/.test(html), 'B5 被挡那张画成暗态卡片')
  check(countOf(html, 'id="m2-default-100-') === 4, 'B6 首帧画出四张子票卡', countOf(html, 'id="m2-default-100-'))
  const ids = cardIds(html)
  check(ids.indexOf('201') > ids.indexOf('305') && ids.indexOf('201') < ids.indexOf('401'), 'B7 排序在投影层：被挡的排在可接之后、已完成之前（在办→可接→被挡→已完成）', ids)
  check(html.indexOf('id="m2-default-100-401"') >= 0, 'B8 已关闭那张也在首帧画出来（卡片流收在最后一段）')
}

// ---- C 失败：按需取数失败不清空已知 ----
{
  const errBucket = { mode: 'err', ts: NOW, error: 'boom', items: null, stats: null }
  const html = renderPage(firstSnapshot, '100', errBucket)
  check(blockedCountText(html) === trFn('map.grpBlocked', { n: 1 }), 'C1 取数失败后被阻塞计数仍是 1', blockedCountText(html))
  check(html.indexOf('id="m2-default-100-201"') >= 0, 'C2 取数失败后被挡卡片还在')
  check(html.indexOf('data-log="card.blockedSeal"') >= 0, 'C3 取数失败后被挡关系还在')
  check(html.indexOf('data-state="failed"') >= 0, 'C4 失败这件事由子票那句说出来（不隐藏失败）')
  check(html.indexOf(trFn('map.subCountFail', { msg: 'boom' })) >= 0, 'C5 失败时子票那句说失败（不是把已知数藏起来）', html.match(/class="m2v2-feed"[^>]*>[^<]*/))
}

// ---- D 加载中：计数用已知真数，不写短横占位 ----
{
  const loadingBucket = { mode: 'loading', ts: NOW, items: null, stats: null }
  const html = renderPage(firstSnapshot, '100', loadingBucket)
  check(blockedCountText(html) === trFn('map.grpBlocked', { n: 1 }), 'D1 加载中被阻塞计数是真数（不是 – 占位）', blockedCountText(html))
  check(html.indexOf('data-busy="0"') >= 0, 'D2 加载中计数已知时进度条不画未知占位')
  check(html.indexOf('id="m2-default-100-201"') >= 0, 'D3 加载中卡片照画（首帧不等取数）')
}

// ---- E 降级来源只补空缺：已知子票、阻塞边与计数不缩 ----
{
  const map = mapOf(degradedSnapshot)
  check(map.tickets.length === 4, 'E1 降级来源不缩子票：四张全在', map.tickets && map.tickets.length)
  check(JSON.stringify(ticketOf(degradedSnapshot, 201).blockedBy) === JSON.stringify([301]), 'E2 降级来源没表达的阻塞边沿用上次已知', ticketOf(degradedSnapshot, 201).blockedBy)
  check(map.stats.total === 4 && map.stats.blocked === 1, 'E3 降级来源计数不缩水', map.stats)
  check(map.carry && map.carry.kept >= 2, 'E4 补回了几张并留痕（carry.at/kept）', map.carry)
  const html = renderPage(degradedSnapshot, '100', null)
  check(blockedCountText(html) === trFn('map.grpBlocked', { n: 1 }), 'E5 降级快照首帧仍画被阻塞 1', blockedCountText(html))
  check(html.indexOf('id="m2-default-100-305"') >= 0, 'E6 本次没回的已知子票 305 仍画出来')
  check(html.indexOf('子票 201（降级）') >= 0, 'E7 本次回的新内容（改过的标题）按增量合并进来')
}

// ---- F 负例：绕过宿主归一，首帧就画不出关系与计数（本票修的那一段真的在起作用） ----
{
  const rawMap = mapOf(rawSnapshot)
  check(!rawMap.stats, 'F1 反例：未经宿主归一的快照行没有容器计数', rawMap.stats)
  const rawHtml = renderPage(rawSnapshot, '100', null)
  check(blockedCountText(rawHtml) === trFn('map.grpBlocked', { n: 1 }),
    'F2 反例：原始行的阻塞者是对象、读不出编号，首帧只能按安全侧兜底算被挡（#1768 之后不再默认算可接）', blockedCountText(rawHtml))
  check(rawHtml.indexOf('data-log="card.blockedSeal"') >= 0 && rawHtml.indexOf('被 #301 阻塞') < 0,
    'F3 反例：原始行画不出「被 #301 阻塞」——归一化补上的编号与引用态才是关系可画的原因', rawHtml.indexOf('被 #301 阻塞'))
}

// ---- J 跨容器阻塞者首帧真投影（#1768）：阻塞者不在本图，按引用态判并被卡片画出来 ----
// 阻塞者 6001/6002/6003 都不在容器 600 里：引用态 OPEN → 被挡；CLOSED → 可接；读不到状态 → 按安全侧算被挡。
{
  const crossRows = [
    issue(600, { type: 'map', title: '地图 600' }),
    issue(1602, { parentKey: '600', title: '跨图被挡', blockedBy: [{ key: '6001', title: '别图里开着', state: 'OPEN' }] }),
    issue(1603, { parentKey: '600', title: '跨图可接', blockedBy: [{ key: '6002', title: '别图里已关', state: 'CLOSED' }] }),
    issue(1604, { parentKey: '600', title: '读不到状态', blockedBy: [{ key: '6003', title: '读不到状态' }] }),
  ]
  const crossSnapshot: any = carryOverMapTickets(null, assembleSnapshot({ owner: 'o', name: 'r' }, crossRows), { sourceComplete: true, nowMs: NOW })
  const crossMap = mapOf(crossSnapshot, '600')
  check(crossMap.stats && crossMap.stats.total === 3 && crossMap.stats.blocked === 2 && crossMap.stats.frontier === 1,
    'J1 跨容器三态计数：OPEN 与未知各挡一张，CLOSED 放行一张', crossMap.stats)
  const crossBlocked = (crossMap.tickets || []).filter((t: any) => Number(t.number) === 1602)[0]
  check(!!crossBlocked && Array.isArray(crossBlocked.blockedByRefs) && crossBlocked.blockedByRefs[0].state === 'OPEN' &&
    crossBlocked.blockedByRefs[0].title === '别图里开着',
    'J2 首帧子票行带阻塞者引用态（编号/标题/状态）', crossBlocked && JSON.stringify(crossBlocked.blockedByRefs))
  const crossHtml = renderPage(crossSnapshot, '600', null)
  check(blockedCountText(crossHtml) === trFn('map.grpBlocked', { n: 2 }),
    'J3 真投影首帧：跨容器被挡计数是 2（不是 0，也不再算成可接）', blockedCountText(crossHtml))
  check(crossHtml.indexOf(trFn('map.grpTakeable', { n: 1 })) >= 0,
    'J4 真投影首帧：只有引用态明确关闭的那张算可接')
  check(crossHtml.indexOf('data-log="card.blockedSeal"') >= 0 && crossHtml.indexOf('被 #6001 阻塞') >= 0,
    'J5 首帧画出跨容器被挡封印（被 #6001 阻塞）')
  check(crossHtml.indexOf('被 #6003 阻塞') >= 0,
    'J6 读不到状态的阻塞者也画出来（按安全侧算被挡，不装作可接）')
}

// ---- G 构建产物：这页与投影函数确实在 package/lib/client.js 里（构建没跟上源码时判红） ----
{
  const bundlePath = path.join(ROOT, 'package', 'lib', 'client.js')
  const bundle = fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, 'utf8') : ''
  check(bundle.length > 0, 'G1 构建产物 package/lib/client.js 在盘上')
  check(bundle.indexOf('function MapDetailV2Page(') >= 0, 'G2 产物里有地图详情 V2 页')
  check(bundle.indexOf('function ticketFeedOf(') >= 0 && bundle.indexOf('function mergeTicketRows(') >= 0, 'G3 产物里有子票投影与增量合并')
  check(bundle.indexOf('m2v2-profile') >= 0, 'G4 产物里有地图档案区样式与结构')
}

console.log('')
console.log(failed ? '#1696 门禁失败 ' + failed + ' 项（共 ' + total + ' 条）' : '#1696 门禁全部通过（共 ' + total + ' 条）')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
