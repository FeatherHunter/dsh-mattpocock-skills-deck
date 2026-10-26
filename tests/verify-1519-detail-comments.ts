#!/usr/bin/env node
/**
 * #1519 门禁：详情页评论区必须认得出宿主交回来的评论。
 *
 * 为什么单独立这扇门：评论数据要从 GitHub 房间一路走到右侧面板，中间换过两次手 ——
 * 房间契约交回的是「评论数组」（Comment[]），详情页只读 GraphQL 那一套连接形状
 * （comments.nodes）。#1444 把详情读路径从旧 fetchIssueDetail 换成经会话 get 之后，
 * 宿主（src/refresh/rooms/host/comment-thread-fetch.ts）把数组原样透传，界面读不到
 * comments.nodes，于是任意票的评论区都显示「评论 (0)」「无评论」，输入框却在 ——
 * 两头各自的门禁都绿：宿主那扇（tests/verify-1444-comments.ts）当时就断言了「回包是数组」，
 * 界面那扇只拿 {nodes,pageInfo} 的夹具渲染。丢形状这件事正好落在两道门禁的缝里。
 *
 * 做法（判据）：按房间契约的真实回包形状造三條评论（其中一条正文里带截图 markdown），
 * 原样喂给宿主的 wf.issueDetail 处理器；再把宿主交回来的详情喂给真正的详情页组件渲染。
 * 断言标题写「评论 (3)」、三条正文都看得见、作者看得出、截图的地址进了 <img> 且带放大定位串。
 * 修前这条链必红（数组透传 → 界面 0 条），修后变绿；它守的是「宿主交出的详情形状」与
 * 「界面读评论的方式」之间的那道缝，不是任何一边单独的样子。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1519-detail-comments.ts
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(resolve(ROOT, rel)).href)
let failed = 0
const check = (ok: any, msg: string) => {
  if (ok) console.log('  PASS ' + msg)
  else { failed++; console.log('  FAIL ' + msg) }
}

// ---------------------------------------------------------------------------
// 一、宿主侧：按房间契约回包造票，过真实的 wf.issueDetail 处理器
// ---------------------------------------------------------------------------
// 房间契约里 issue.comments 是 Comment[]（见 src/tracker/contract/entities.ts），不是连接。
// 三条评论里第二条正文带一张截图 —— 验收要求「每条作者/时间/正文 + 截图可点开大图」，
// 截图的地址必须原样穿过宿主与渲染两层，任何一层丢了它，这里都看得见。
const TRACKER_COMMENTS = [
  {
    id: 'c1',
    author: { login: 'alice' },
    authorAssociation: 'OWNER',
    body: '第一条评论：评论区应该显示这一条。',
    createdAt: '2026-10-24T01:02:03Z',
    updatedAt: '2026-10-24T01:02:03Z',
  },
  {
    id: 'c2',
    author: { login: 'bob' },
    authorAssociation: 'MEMBER',
    body: '第二张截图：![截图](https://example.com/shot-1519.png)',
    createdAt: '2026-10-24T02:03:04Z',
    updatedAt: '2026-10-24T02:03:04Z',
  },
  {
    id: 'c3',
    author: { login: 'carol' },
    authorAssociation: 'NONE',
    body: '第三条评论。',
    createdAt: '2026-10-24T03:04:05Z',
    updatedAt: '2026-10-24T03:04:05Z',
  },
]
const TRACKER_ISSUE = {
  key: '7',
  title: '票 7',
  state: 'open',
  body: '票的正文',
  url: 'https://github.com/o/r/issues/7',
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  closedAt: null,
  author: { login: 'alice' },
  labels: [],
  assignees: [],
  comments: TRACKER_COMMENTS,
  blockedBy: [],
}
const session = {
  get: async function (_repoRef: any, _key: any, _opts: any) {
    return { ok: true, data: TRACKER_ISSUE }
  },
}
const deps = {
  openSession: async function () {
    return {
      ok: true,
      backendId: 'github',
      repoRef: { backend: 'github', refId: 'o/r', name: 'o/r', url: 'https://github.com/o/r' },
      call: async function (fn: any) { return fn(session, { cwd: 'D:\\ws', caller: 'refresh' }) },
    }
  },
  // 读路径迁移后这些旧口一次都不该被碰；真被碰到就在这里炸出来，不是悄悄走老路。
  normCwd: async function (x: any) { return x },
  selectEarly: async function () { throw new Error('详情读路径不应再调 selectEarly') },
  isComposerSelection: function () { throw new Error('详情读路径不应再调 isComposerSelection') },
  getTrackerRegistry: async function () { return { get: function () { throw new Error('详情读路径不应再经注册表 tracker.get') } } },
  getPlatform: async function () { return {} },
  ctx: { get: function () { return undefined } },
  timer: { timeout: function () { return function () {} } },
  DEFAULT_CWD: '',
  errText: function (e: any) { return String((e && e.message) || e) },
  isRateLimitError: function () { return false },
  getRepoKey: async function () { return { owner: 'o', name: 'r' } },
  execProc: async function () { throw new Error('详情读路径不应直调 exec') },
  fetchIssueDetail: async function () { throw new Error('详情读路径不应回退旧详情路') },
  fetchIssueIndex: async function () { throw new Error('详情读路径不应回退旧索引路') },
  issueIndexFromSnapshot: function () { return { ok: false } },
  setCache: function () {},
  logCtx: { fire: function () {} },
}
const { createCommentThreads } = await imp('src/refresh/rooms/host/comment-thread-fetch.ts')
const handlers = createCommentThreads(deps)
const CWD = 'D:/work/repo'

const detail = await handlers.handleIssueDetail({ number: 7, cwd: CWD })
check(detail && detail.ok === true, '详情：经只读会话 get 成功')
const commentsSource = detail && detail.issue && detail.issue.comments
// 这一条就是 #1519 的回归点：数组原样透传，界面就只认不出节点，评论区永远 0 条。
check(!!commentsSource && !Array.isArray(commentsSource), '详情：comments 是 {nodes,pageInfo} 连接，不是把数组原样透传')
check(!!commentsSource && Array.isArray((commentsSource as any).nodes) && (commentsSource as any).nodes.length === 3,
  '详情：三条评论都在 nodes 里（got ' + (commentsSource && (commentsSource as any).nodes && (commentsSource as any).nodes.length) + '）')
const n0 = commentsSource && (commentsSource as any).nodes && (commentsSource as any).nodes[0]
const n1 = commentsSource && (commentsSource as any).nodes && (commentsSource as any).nodes[1]
check(!!n0 && n0.author && n0.author.login === 'alice', '详情：评论作者带在 author.login 上')
check(!!n0 && n0.createdAt === '2026-10-24T01:02:03Z', '详情：评论时间原样带回来（界面要显示日期）')
check(!!n0 && n0.body === TRACKER_COMMENTS[0].body, '详情：评论正文原样带回来')
check(!!n1 && String(n1.body).indexOf('https://example.com/shot-1519.png') >= 0, '详情：评论里的截图地址没有被丢掉')
check(!!commentsSource && (commentsSource as any).pageInfo && (commentsSource as any).pageInfo.hasNextPage === false && (commentsSource as any).pageInfo.endCursor === '3',
  '详情：分页信息按这一趟取到的条数给出（三项都在）')

// ---------------------------------------------------------------------------
// 二、界面侧：把宿主交回来的详情喂给真正的 IssueDetail 渲染
// ---------------------------------------------------------------------------
// 详情页是独立叶模块（靠构建拼进界面闭包），单独加载时闭包里的名字要在这里接上：
// 真实现能接的都接真实现，接不到的用最小桩 —— 桩只顶住与评论无关的分支，不参与判据。
const trFn = (key: any, params: any) => {
  let s = String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m))
  return s
}
const hostCalls: any[] = []
;(globalThis as any).host = { call: (m: any, a: any) => { hostCalls.push([m, a]); return Promise.resolve({ ok: true }) } }
;(globalThis as any).tr = trFn
;(globalThis as any).emit = () => {}
;(globalThis as any).Ic = (props: any) => '[' + ((props && props.n) || '?') + ']'
;(globalThis as any).Tip = (props: any) => React.createElement('span', { 'data-tip': String(props.content) }, props.children)
;(globalThis as any).React = React
;(globalThis as any).h = React.createElement
;(globalThis as any).peekNav = () => null
;(globalThis as any).repoStr = () => ''
;(globalThis as any).useIssueDetailFold = () => null
;(globalThis as any).findMapByIdentity = () => null
;(globalThis as any).pushNav = () => {}
;(globalThis as any).popNav = () => {}
;(globalThis as any).copyText = async () => true
;(globalThis as any).openInNewSession = () => {}
;(globalThis as any).inject = () => {}
;(globalThis as any).buildColorOf = () => ({})
;(globalThis as any).rowActionText = () => ''
;(globalThis as any).rowActionKind = () => ''
;(globalThis as any).actionColorOf = () => '#8b949e'
;(globalThis as any).isLightHex = () => false
;(globalThis as any).hexA = () => ''
;(globalThis as any).darken = () => ''
;(globalThis as any).prStateKind = (x: any) => (String((x && x.state) || '').toUpperCase() === 'CLOSED' ? 'closed' : 'open')
;(globalThis as any).effortNamesOf = () => []
;(globalThis as any).enterSubDetail = () => {}
;(globalThis as any).containerKindOf = () => null
;(globalThis as any).containerStateOf = () => 'open'
;(globalThis as any).containerTriState = () => null
;(globalThis as any).ISSUE_DETAIL_CONFIRM_MS = 1500
;(globalThis as any).CONTAINER_ACCENT = { map: '#bc8cff' }

// 身份与链接算法走真实现：手写桩一旦与真源分叉，门禁就测了个假环境。
const identityMod = await imp('src/tracker/kernel/identity-keys.ts')
;(globalThis as any).effortOf = identityMod.effortOf
;(globalThis as any).idOfParts = identityMod.idOfParts
;(globalThis as any).ticketLabelOf = (await imp('src/client/kernel/ticket-label.ts')).ticketLabelOf
;(globalThis as any).ticketLabelNodesOf = (await imp('src/client/kernel/ticket-label.ts')).ticketLabelNodesOf
;(globalThis as any).TICKET_LABEL_MAX_WIDTH = (await imp('src/client/kernel/ticket-label.ts')).TICKET_LABEL_MAX_WIDTH
// 动态导入必须在全局量齐备之后（ctx.js 顶层就要读 React，静态 import 会先于赋值执行）
const { DswsCtx, createCx } = await imp('src/client/kernel/ctx.ts')
;(globalThis as any).DswsCtx = DswsCtx
const linkMod = await imp('src/client/kernel/link.ts')
;(globalThis as any).issueUrlFor = linkMod.issueUrlFor
;(globalThis as any).openIssueUrl = linkMod.openIssueUrl
// markdown 渲染走真实现：截图能不能进 <img>、能不能点开放大，判据都靠它。
const mdMod = await imp('src/client/views/shared/md.ts')
;(globalThis as any).mdToHtml = mdMod.mdToHtml
;(globalThis as any).mdImgOverlay = mdMod.mdImgOverlay
const { renderIssueDetailComments } = await imp('src/client/views/IssueDetailComments.ts')
;(globalThis as any).renderIssueDetailComments = renderIssueDetailComments
const { IssueDetail } = await imp('src/client/views/IssueDetail.ts')

const services = {
  slots: { register: () => () => {}, inject: (_name: string, fn: any) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn: any, ms: any) => setTimeout(fn, ms) },
}
const fakeStore = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:\\ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
const fakeCx = createCx({
  ctx: { get: (k: any) => (services as any)[k], effect: (fn: any) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, inject: (_deps: any, cb: any) => { cb({ get: (k: any) => (services as any)[k] }); return { dispose: () => {} } } },
  h: React.createElement,
  rdom: {},
  storeSvc: { shared: fakeStore, stores: {}, makeStore: () => fakeStore, storeOf: () => fakeStore, emit: () => {}, sub: () => () => {}, useStore: () => fakeStore },
  localeSvc: services.locale,
  timer: services.timer,
  api: { call: async () => ({ ok: true }), inject: () => {}, copyText: async () => {} },
  router: { open: () => {}, toggle: () => {} },
} as any)

const st = {
  cwd: 'D:\\ws',
  activeIssue: 7,
  activeEffortId: '',
  issueDetail: detail && detail.issue,
  issueMode: 'real',
  snapshot: { issues: [{ number: 7, key: '7', title: '票 7', state: 'OPEN', labels: [], assignees: [], url: 'https://github.com/o/r/issues/7' }], maps: [] },
}
const html = renderToStaticMarkup(
  React.createElement(DswsCtx.Provider as any, { value: fakeCx }, React.createElement(IssueDetail as any, { st }))
)
check(html.indexOf('评论 (3)') >= 0, '界面：评论区标题写真实条数「评论 (3)」')
check(html.indexOf('第一条评论') >= 0 && html.indexOf('第三条评论') >= 0, '界面：评论正文看得见')
check(html.indexOf('@bob') >= 0, '界面：评论作者看得见（@bob 只出现在评论里）')
check(html.indexOf('https://example.com/shot-1519.png') >= 0, '界面：截图地址进了渲染结果（<img> 里）')
check(/data-log="md\.img\.zoom\.\d+"/.test(html), '界面：截图带放大定位串（点得开大图）')
check(html.indexOf('评论 (0)') < 0, '界面：不再显示「评论 (0)」')

console.log(failed ? '\n#1519 门禁失败 ' + failed + ' 项' : '\n#1519 门禁全部通过')
process.exit(failed ? 1 : 0)
