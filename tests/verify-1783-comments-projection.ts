#!/usr/bin/env node
/**
 * #1783 门禁：GitLab 票详情在默认读投影下评论显示 0 条、发评论输入框消失。
 *
 * 根因链（B3 #1716 实测）：GitLab 列表行天然带正文 → 快照投影只凭「行里有正文」就认定这行有详情并
 * 立刻采用 → 但这一行里的 comments 是空数组（列表不取评论），投影把它装成一个「明确没有评论」的空连接 →
 * 详情页于是画「评论 (0)」「无评论」，且因为来源不是 live 而把输入框藏起来（read-only 提示）。
 * 宿主随后取回的 20 条评论从未被采用。
 *
 * 修法有两条判据：
 *   一、投影：行里有正文但没取过评论（comments 数组为空、commentCount 却大于 0）时，不造空连接；
 *       这一趟详情成功取回时用 live（它比快照行新，评论齐不齐只有它说得清），快照只做首帧与失败回退。
 *   二、界面：评论未知时不许说「评论 (0)」「无评论」「只读」；live 详情带回 20/56 条时
 *       标题写 20 条、有输入框、有「已显示 20 / 共 56」和「加载更多」。
 *
 * 门禁覆盖两种「评论未知」的形状：
 *   - GitLab 行：有正文、comments 是空数组、票面总数 56（A/B 组）；
 *   - GitHub 行：有正文、没有 comments、没有票面总数（A6-A8、G 组）——这是 GitHub 的常规列表行，
 *     「总数缺失」曾被误判成「已知」，导致首帧与取数失败回退时仍说「评论 (0)」「无评论」「只读」。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1783-comments-projection.ts
 */
// 门禁归属: src/client/views/shared/detailProjection.ts
// 门禁归属: src/client/views/IssueDetail.ts
// 门禁归属: src/client/views/IssueDetailComments.ts
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(resolve(ROOT, rel)).href)
let failed = 0
function check (cond: any, msg: string): void {
  if (cond) console.log('  PASS ' + msg)
  else { failed++; console.log('  FAIL ' + msg) }
}

// ---------------------------------------------------------------------------
// 一、投影层：快照行说不出评论时不要把它说成「没有评论」；这一趟详情成功时用 live
// ---------------------------------------------------------------------------
const storeMap: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: function (k: string) { return Object.prototype.hasOwnProperty.call(storeMap, k) ? storeMap[k] : null },
  setItem: function (k: string, v: string) { storeMap[k] = String(v) },
  removeItem: function (k: string) { delete storeMap[k] },
}
const trFn = (key: any, params?: any): string => {
  let s = String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, n: string) => (n in params ? String(params[n]) : m))
  return s
}
;(globalThis as any).tr = trFn
;(globalThis as any).idOfParts = function (a: any, b: any) { return String(a) + '\u0000' + String(b) }
;(globalThis as any).log = function () {}
;(globalThis as any).emit = function () {}
const identityMod = await imp('src/tracker/kernel/identity-keys.ts')
;(globalThis as any).effortOf = identityMod.effortOf

const proj = await imp('src/client/views/shared/detailProjection.ts')
const CLOCK0 = 1761900000000
function row (n: number, extra?: any): any {
  return Object.assign({ number: n, key: String(n), title: '票 ' + n, state: 'OPEN', updatedAt: '2026-11-01T00:00:00Z', labels: [], assignees: [], createdAt: '2026-11-01T00:00:00Z' }, extra || {})
}
function snap (issues: any[]): any {
  return { version: 'v0', issues: issues, maps: [], deck: {}, merge: { version: 7, lastStartMs: 0, groups: { body: { version: 7, atMs: CLOCK0, source: 'gitlab-api', operation: 'get', completeness: 'partial' } } } }
}
// GitLab 列表行：有正文、comments 是空数组（列表不取评论），commentCount 说明真实有 56 条。
const gitlabRow = row(28, {
  body: '这张票用来验评论列表、加载更多与发评论写回。',
  comments: [],
  commentCount: 56,
  url: 'https://gitlab.example.com/group/proj/-/issues/28',
})
// GitHub GraphQL 列表行：列表查询带正文、不带 comments、也不带票面评论总数
// （src/tracker/rooms/github/channels/graphql/queries.ts 的 LIST_ISSUE_FRAGMENT）。
// 这是 GitHub 的常规列表行，也是「有正文、评论未知」的第二种形状：评论数组与总数字段都缺。
const githubRow = row(930, {
  body: 'GitHub 常规列表行：有正文、没有评论数组、没有评论总数。',
  url: 'https://github.com/o/r/issues/930',
})
{
  const view = proj.detailViewFor({ snapshot: snap([gitlabRow]), issueDetail: null, issueCache: {} }, 28, '')
  check(view && view.source === 'snapshot', 'A1 没有这一趟详情时读快照投影')
  check(!!view.issue, 'A2 行里有正文，投影出详情（标题与正文能先画出来）')
  check(!!view.issue && view.issue.comments === undefined, 'A3 行里没取过评论时不要造一个空连接（「没取过」不是「没有」）')
  check(!!view.issue && view.issue.commentCount === 56, 'A4 投影知道真实总数 56（后续界面要用来写「共 56」）')
  check(view.lastKnownAtMs === CLOCK0, 'A5 投影标出这份数据的时刻（上次数据提示用）')
}
{
  // GitHub 的常规列表行：有正文，但评论数组与票面总数都没有（列表查询不取评论）。
  // 投影不能把「没取过」说成「评论 0 条」——那正是 #1783 修好 GitLab 形状之后残留的缺陷形状。
  const view = proj.detailViewFor({ snapshot: snap([githubRow]), issueDetail: null, issueCache: {} }, 930, '')
  check(view && view.source === 'snapshot' && !!view.issue, 'A6 GitHub 形状的列表行（有正文、无评论数组、无总数）也能先投影出正文')
  check(!!view.issue && view.issue.comments === undefined, 'A7 评论和总数都不知道时不要造空连接（「未知」不是「没有」）')
  check(!!view.issue && view.issue.commentCount === undefined, 'A8 评论总数不知道时不要写 commentCount（不许拿 0 冒充总数）')
}
{
  // 快照行评论齐全（明确 0 条）：此时投影可以给一个空连接，界面说「评论 (0)」是真话。
  const emptyKnownRow = row(29, { body: '正文', comments: [], commentCount: 0 })
  const view = proj.detailViewFor({ snapshot: snap([emptyKnownRow]), issueDetail: null, issueCache: {} }, 29, '')
  const c = view && view.issue && view.issue.comments
  check(view.source === 'snapshot' && !!c && Array.isArray(c.nodes) && c.nodes.length === 0, 'B1 行里评论齐全（明确 0 条）时投影给出空连接')
  check(!!c && c.totalCount === 0 && c.pageInfo && c.pageInfo.hasNextPage === false, 'B2 明确没有评论：总数 0、没有下一页')
}

// 这一趟成功取回的详情：20 条评论 + 总数 56（宿主修复后首屏 50 条同理，这里用 20 条覆盖 #28 的实测形状）。
const liveNodes: any[] = []
for (let i = 1; i <= 20; i++) {
  liveNodes.push({ author: { login: 'u' + i }, authorAssociation: 'NONE', body: 'c' + i, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' })
}
const liveDetail = {
  number: 28,
  effortId: '',
  title: '评论加载测试票（56 条评论）',
  state: 'OPEN',
  body: '这张票用来验评论列表、加载更多与发评论写回。',
  url: 'https://gitlab.example.com/group/proj/-/issues/28',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T01:00:00Z',
  closedAt: null,
  author: { login: 'alice' },
  labels: { nodes: [] },
  assignees: { nodes: [] },
  comments: { nodes: liveNodes, pageInfo: { hasNextPage: true, endCursor: '20' }, totalCount: 56 },
  subIssues: { totalCount: 0, nodes: [] },
  blockedBy: { nodes: [] },
  blocking: { nodes: [] },
}
{
  const view = proj.detailViewFor({ snapshot: snap([gitlabRow]), issueDetail: liveDetail, issueMode: 'real', issueCache: {} }, 28, '')
  check(view && view.source === 'live', 'C1 这一趟详情成功取回时用 live（#1783：评论齐不齐只有这一趟说得清）')
  check(!!view.issue && view.issue.comments && view.issue.comments.nodes.length === 20, 'C2 live 详情里的 20 条评论原样投影出来')
  check(!!view.issue && view.issue.comments && view.issue.comments.totalCount === 56, 'C3 详情带着总数 56（界面「共 N」用）')
  check(view.lastKnownAtMs === 0 && !view.notice, 'C4 live 成功时不标「上次数据」')
}
{
  const view = proj.detailViewFor({ snapshot: snap([gitlabRow]), issueDetail: liveDetail, issueMode: 'err', issueCache: {} }, 28, '')
  check(view && view.source === 'snapshot', 'D1 取数失败时退回快照投影（行里的正文仍可画）')
}

// ---------------------------------------------------------------------------
// 二、界面层：把真详情喂给真正的 IssueDetail 渲染，断言评论区说的是真话
// ---------------------------------------------------------------------------
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
;(globalThis as any).detailTopGate = () => ({ clickable: true, reason: 'none', blockedNumbers: [] })
;(globalThis as any).effortNamesOf = () => []
;(globalThis as any).enterSubDetail = () => {}
;(globalThis as any).containerKindOf = () => null
;(globalThis as any).containerStateOf = () => 'open'
;(globalThis as any).containerTriState = () => null
;(globalThis as any).ISSUE_DETAIL_CONFIRM_MS = 1500
;(globalThis as any).CONTAINER_ACCENT = { map: '#bc8cff' }
;(globalThis as any).ticketLabelOf = (await imp('src/client/kernel/ticket-label.ts')).ticketLabelOf
;(globalThis as any).ticketLabelNodesOf = (await imp('src/client/kernel/ticket-label.ts')).ticketLabelNodesOf
;(globalThis as any).TICKET_LABEL_MAX_WIDTH = (await imp('src/client/kernel/ticket-label.ts')).TICKET_LABEL_MAX_WIDTH
;(globalThis as any).ticketBadgeOf = (await imp('src/client/views/shared/ticketBadge.ts')).ticketBadgeOf

const { DswsCtx, createCx } = await imp('src/client/kernel/ctx.ts')
;(globalThis as any).DswsCtx = DswsCtx
const linkMod = await imp('src/client/kernel/link.ts')
;(globalThis as any).issueUrlFor = linkMod.issueUrlFor
;(globalThis as any).openIssueUrl = linkMod.openIssueUrl
;(globalThis as any).openModeFor = linkMod.openModeFor
;(globalThis as any).openTrackerTarget = linkMod.openTrackerTarget
const mdMod = await imp('src/client/views/shared/md.ts')
;(globalThis as any).mdToHtml = mdMod.mdToHtml
;(globalThis as any).mdImgOverlay = mdMod.mdImgOverlay
;(globalThis as any).detailViewFor = proj.detailViewFor
;(globalThis as any).knownBlockedNodes = proj.knownBlockedNodes
const commentsMod = await imp('src/client/views/IssueDetailComments.ts')
;(globalThis as any).renderIssueDetailComments = commentsMod.renderIssueDetailComments
const detailMod = await imp('src/client/views/IssueDetail.ts')

const services = {
  slots: { register: () => () => {}, inject: (_name: string, fn: any) => { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => trFn },
  timer: { timeout: (fn: any, ms: any) => setTimeout(fn, ms) },
}
const fakeStore = { snapshot: null, sessionId: 'test', tab: 'list', cwd: 'D:/ws', issuePath: { current: null, nodes: [] }, noRepoCard: { expanded: false } }
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

function render (st: any): string {
  return renderToStaticMarkup(
    React.createElement(DswsCtx.Provider as any, { value: fakeCx }, React.createElement(detailMod.IssueDetail as any, { st }))
  )
}

// E 这一趟详情成功：20 条评论、总数 56 → 标题写 20、有输入框、有「已显示 20/56」与加载更多
{
  const st = {
    cwd: 'D:/ws',
    activeIssue: 28,
    activeEffortId: '',
    issueDetail: liveDetail,
    issueMode: 'real',
    snapshot: { issues: [gitlabRow], maps: [] },
  }
  const html = render(st)
  check(html.indexOf('评论 (20)') >= 0, 'E1 详情页标题写真实条数「评论 (20)」（实得片段 ' + html.slice(0, 120) + '）')
  check(html.indexOf('评论 (0)') < 0, 'E2 不再显示「评论 (0)」')
  check(html.indexOf('<textarea') >= 0, 'E3 详情取回评论后给出发评论输入框')
  check(html.indexOf('detail.readOnlyHint') < 0, 'E4 不显示只读提示（评论齐全且来源是这一趟详情）')
  check(html.indexOf('detail.noComments') < 0, 'E5 不显示「无评论」（真的有 56 条）')
  check(html.indexOf('detail.commentsShownMore') >= 0, 'E6 显示「已显示 20/共 56 · 可加载更多」')
  check(html.indexOf('detail.commentsMore') >= 0, 'E7 给出「加载更多」按钮')
}
// F 快照首帧：这一趟详情还没回来，行里只有正文、没取过评论 → 说加载中，不说「没有」、不说只读、不给输入框
{
  const st = {
    cwd: 'D:/ws',
    activeIssue: 28,
    activeEffortId: '',
    issueDetail: null,
    issueMode: 'loading',
    snapshot: { issues: [gitlabRow], maps: [] },
  }
  const html = render(st)
  check(html.indexOf('这张票用来验评论列表、加载更多与发评论写回。') >= 0, 'F1 快照行里的正文先画出来（秒开）')
  check(html.indexOf('评论 (0)') < 0, 'F2 没取到评论时不说「评论 (0)」')
  check(html.indexOf('detail.noComments') < 0, 'F3 没取到评论时不说「无评论」')
  check(html.indexOf('detail.readOnlyHint') < 0, 'F4 没取到评论时不说「只读」')
  check(html.indexOf('<textarea') < 0, 'F5 评论未知时不给输入框')
  check(html.indexOf('list.loading') >= 0, 'F6 评论区说加载中（评论还没拿到）')
}
// G GitHub 形状的首帧与取数失败回退：评论数组与票面总数都没有（GitHub 的常规列表行）。
// 旧判据把「总数缺失」误当成「已知」，于是造出空连接，界面说「评论 (0)」「无评论」「只读」。
function renderGithubShape (mode: string, detail: any): string {
  return render({
    cwd: 'D:/ws',
    activeIssue: 930,
    activeEffortId: '',
    issueDetail: detail,
    issueMode: mode,
    snapshot: { issues: [githubRow], maps: [] },
  })
}
{
  const html = renderGithubShape('loading', null)
  check(html.indexOf('GitHub 常规列表行：有正文、没有评论数组、没有评论总数。') >= 0, 'G1 GitHub 形状首帧先把正文画出来')
  check(html.indexOf('评论 (0)') < 0, 'G2 GitHub 形状首帧不说「评论 (0)」')
  check(html.indexOf('detail.noComments') < 0, 'G3 GitHub 形状首帧不说「无评论」')
  check(html.indexOf('detail.readOnlyHint') < 0, 'G4 GitHub 形状首帧不说「只读」')
  check(html.indexOf('<textarea') < 0, 'G5 GitHub 形状首帧不给输入框（评论还没取到）')
  check(html.indexOf('评论 · list.loading') >= 0, 'G6 GitHub 形状首帧评论区说加载中')
}
{
  // 取数失败回退：失败横幅之外，评论区仍要说「还没取到」，不能退化成「评论 (0) / 无评论 / 只读」。
  const html = renderGithubShape('err', liveDetail)
  check(html.indexOf('评论 (0)') < 0, 'G7 GitHub 形状取数失败回退不说「评论 (0)」')
  check(html.indexOf('detail.noComments') < 0, 'G8 GitHub 形状取数失败回退不说「无评论」')
  check(html.indexOf('detail.readOnlyHint') < 0, 'G9 GitHub 形状取数失败回退不说「只读」')
  check(html.indexOf('<textarea') < 0, 'G10 GitHub 形状取数失败回退不给输入框')
  check(html.indexOf('评论 · detail.notYet') >= 0, 'G11 GitHub 形状取数失败回退评论区说「尚未取到」')
}

if (failed) {
  console.log('\n[verify-1783] FAIL（' + failed + ' 项）')
  process.exit(1)
}
console.log('\n[verify-1783] GREEN 评论投影与详情页说法就绪')
