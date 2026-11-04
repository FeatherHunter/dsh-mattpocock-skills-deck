/**
 * tests/verify-1864-snapshot-detail-view.ts —— 详情页把「确认没有」与「不知道」分开画（#1864）
 *
 * 守什么：详情从本地快照库出之后，界面不能把「还没取过」画成「确认没有」。
 *   A 正文：完整取过且为空 → 画「无描述」；库里不知道 → 画「正文还没拿到 · 上次数据（时间）」；
 *   B 被阻塞关系：确认没有 → 整段不画；不知道 → 画一行「被阻塞关系还没拿到 · 上次数据（时间）」；
 *   C 从库读回来的详情要标「上次数据（时间）」，并让评论区按「还没取过」处理（评论是 #1865 的事）；
 *   D 这一趟真取回来的详情（live）照旧按「有正文 / 无描述」两档画，不误标成上次数据；
 *   E 按需细节被淘汰过、或取数失败时，正文格各画各的话，不冒充「无描述」。
 *
 * 为什么测这个模块：判据与画法都收在 views/shared/detailProjection.ts 的纯函数里，视图只消费；
 * 直接调用这几个纯函数就能断言「两句话不同」，不用起浏览器。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1864-snapshot-detail-view.ts
 */
// 门禁归属: src/client/views/shared/detailProjection.ts
// 门禁归属: src/client/views/IssueDetail.ts

import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(resolve(ROOT, rel)).href)
const GATE = 'verify-1864-snapshot-detail-view'
const CLOCK = 1762310000000
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

// 客户端这几个名字是构建时拼进同一个闭包的全局；门禁里给最小替身。
const storeMap: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(storeMap, k) ? storeMap[k] : null),
  setItem: (k: string, v: string) => { storeMap[k] = String(v) },
  removeItem: (k: string) => { delete storeMap[k] },
}
;(globalThis as any).tr = (key: any, params?: any): string => {
  let s = String(key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m: string, n: string) => (n in params ? String(params[n]) : m))
  return s
}
;(globalThis as any).idOfParts = (a: any, b: any) => String(a) + '\u0000' + String(b)
;(globalThis as any).log = () => {}
;(globalThis as any).emit = () => {}
;(globalThis as any).mdToHtml = (text: any) => String(text)
;(globalThis as any).CONTAINER_ACCENT = { map: '#a371f7' }
;(globalThis as any).MOTION = { inlineSpinnerMs: 700 }

const proj: any = await imp('src/client/views/shared/detailProjection.ts')

/** 造一份「从库读回来的详情」：只有写进来的字段，没写的就是不知道。 */
function libraryDetail(extra?: any): any {
  return Object.assign({
    number: 5,
    key: '5',
    effortId: '',
    title: '子票五',
    state: 'OPEN',
    labels: { nodes: [] },
    assignees: { nodes: [] },
    blockedBy: { nodes: [] },
    subIssues: { totalCount: 0, nodes: [] },
    fromSnapshot: true,
    lastKnownAtMs: CLOCK,
    snapshotGroups: {
      row: { completeness: 'complete', reason: null, lastQueriedMs: CLOCK },
      body: { completeness: 'complete', reason: null, lastQueriedMs: CLOCK },
      labels: { completeness: 'complete', reason: null, lastQueriedMs: CLOCK },
      assignees: { completeness: 'complete', reason: null, lastQueriedMs: CLOCK },
      parents: { completeness: 'complete', reason: null, lastQueriedMs: CLOCK },
      blockedBy: { completeness: 'complete', reason: null, lastQueriedMs: CLOCK },
      subIssues: { completeness: 'unknown', reason: 'not-applicable', lastQueriedMs: CLOCK },
      mergeInfo: { completeness: 'complete', reason: null, lastQueriedMs: CLOCK },
    },
  }, extra || {})
}

function stateWith(detail: any, mode = 'real'): any {
  return { issueDetail: detail, issueMode: mode, snapshot: { issues: [], maps: [] }, detailSeenAt: {}, issueCache: {} }
}

// ── A. 正文：确认没有 / 不知道 ────────────────────────────────────────────────
const withBody: any = proj.detailViewFor(stateWith(libraryDetail({ body: '这是正文。' })), 5, '')
check(withBody.source === 'snapshot', 'A1 从库读回来的详情按快照投影处理（不当成 live）', withBody.source)
check(withBody.noticeKey === 'detail.lastKnownData' && withBody.lastKnownAtMs === CLOCK,
  'A2 从库读回来的详情标出上次数据时刻', { key: withBody.noticeKey, at: withBody.lastKnownAtMs })
check(typeof withBody.notice === 'string' && withBody.notice.indexOf('detail.lastKnownData') >= 0,
  'A3 上次数据那句用的是既有词条', withBody.notice)
const bodyText: any = withBody.bodySlot
check(bodyText.kind === 'text' && bodyText.text === '这是正文。', 'A3 有正文就画正文', bodyText)

const emptyBody: any = proj.bodySlotOf(libraryDetail({ body: '' }), withBody, null, 'real')
check(emptyBody.kind === 'none', 'A4 完整取过且为空 = 确认没有正文', emptyBody)
check(String(emptyBody.caption).indexOf('detail.noBody') >= 0, 'A5 确认没有正文画「无描述」', emptyBody.caption)

const unknownBody: any = proj.bodySlotOf(libraryDetail({}), withBody, null, 'real')
check(unknownBody.kind === 'unknown' && unknownBody.atMs === CLOCK, 'A6 库里不知道正文 = 不知道，带上次已知时刻', unknownBody)
check(String(unknownBody.caption).indexOf('detail.bodyNotYet') >= 0 && String(unknownBody.caption).indexOf('detail.lastKnownData') >= 0,
  'A7 不知道正文画「还没拿到」并带上次数据时刻', unknownBody.caption)
check(String(unknownBody.caption).indexOf('detail.noBody') < 0, 'A8 不知道正文绝不画「无描述」', unknownBody.caption)

// ── B. 被阻塞关系：确认没有 / 不知道 ──────────────────────────────────────────
const knownRelations: any = proj.relationsUnknownOf(libraryDetail({}), withBody)
check(knownRelations.unknown === false, 'B1 阻塞组是 complete = 知道（确认没有就整段不画）', knownRelations)
check(proj.relationsNoticeOf(libraryDetail({}), withBody) === '', 'B2 知道时不画关系说明')

const unknownRelationsDetail: any = libraryDetail({})
unknownRelationsDetail.snapshotGroups.blockedBy = { completeness: 'unknown', reason: 'not-expressed', lastQueriedMs: CLOCK }
const unknownRelations: any = proj.relationsUnknownOf(unknownRelationsDetail, withBody)
check(unknownRelations.unknown === true && unknownRelations.atMs === CLOCK, 'B3 阻塞组 unknown = 不知道，带上次已知时刻', unknownRelations)
const relationsCaption: string = proj.relationsNoticeOf(unknownRelationsDetail, withBody)
check(relationsCaption.indexOf('detail.relationsNotYet') >= 0 && relationsCaption.indexOf('detail.lastKnownData') >= 0,
  'B4 不知道被阻塞关系时画一行说明并带时刻', relationsCaption)

const neverFetchedRelations: any = libraryDetail({})
neverFetchedRelations.snapshotGroups.blockedBy = null
check(proj.relationsUnknownOf(neverFetchedRelations, withBody).unknown === true, 'B5 从没取过阻塞组也算不知道')

// ── C. 评论：还没进库时按「还没取过」处理，不说成只读 ─────────────────────────
check(withBody.issue.comments === undefined, 'C1 库里还没有评论时不造空连接', withBody.issue.comments)
const commentsUnknownFlag: boolean = !!(withBody.issue && withBody.source === 'snapshot' && !(withBody.issue.comments && Array.isArray(withBody.issue.comments.nodes)))
check(commentsUnknownFlag === true, 'C2 视图按「评论未知」处理（不是「无评论」也不是「只读」）', commentsUnknownFlag)

// ── D. 这一趟真取回来的详情：照旧按有正文 / 无描述两档画 ──────────────────────
const liveDetail: any = { number: 5, key: '5', effortId: '', title: '子票五', state: 'OPEN', body: '' }
const liveView: any = proj.detailViewFor(stateWith(liveDetail), 5, '')
check(liveView.source === 'live' && liveView.notice === '', 'D1 live 详情不标「上次数据」', liveView)
check(proj.bodySlotOf(liveDetail, liveView, null, 'real').kind === 'none', 'D2 live 的空正文 = 确认没有', proj.bodySlotOf(liveDetail, liveView, null, 'real'))
const liveText: any = { number: 5, key: '5', effortId: '', title: '子票五', state: 'OPEN', body: 'live 正文' }
check(proj.bodySlotOf(liveText, liveView, null, 'real').kind === 'text', 'D3 live 的正文照画')

// ── E. 淘汰与失败：各画各的话 ─────────────────────────────────────────────────
const evictedSlot: any = proj.bodySlotOf(null, { lastKnownAtMs: 0, source: 'none' }, { detailEvicted: { lastKnownAtMs: CLOCK } }, 'real')
check(evictedSlot.kind === 'evicted' && evictedSlot.atMs === CLOCK, 'E1 按需细节被淘汰过就画「未取（曾在某时）」', evictedSlot)
check(String(evictedSlot.caption).indexOf('detail.evictedAt') >= 0, 'E2 淘汰那档画的是「未取」', evictedSlot.caption)
const failSlot: any = proj.bodySlotOf(null, { lastKnownAtMs: CLOCK, source: 'none' }, null, 'err')
check(failSlot.kind === 'unknown' && failSlot.atMs === CLOCK, 'E3 取数失败且没有详情 = 不知道，带上次已知时刻', failSlot)
const loadingSlot: any = proj.bodySlotOf(null, { lastKnownAtMs: 0, source: 'none' }, null, 'loading')
check(loadingSlot.kind === 'loading', 'E4 还在取数 = 加载中', loadingSlot)

// ── F. 回归：列表行的快照投影仍能画，且标出上次数据时刻 ────────────────────────
const rowSnapshot: any = {
  issues: [{ number: 7, key: '7', title: '票 7', state: 'OPEN', body: '行里的正文', labels: [], assignees: [], blockedBy: [], createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }],
  maps: [],
  merge: { version: 3, lastStartMs: 0, groups: { body: { version: 3, atMs: CLOCK, source: 'github', operation: 'get', completeness: 'complete' } } },
}
const rowView: any = proj.detailViewFor({ issueDetail: null, issueMode: 'loading', snapshot: rowSnapshot, detailSeenAt: {}, issueCache: {} }, 7, '')
check(rowView.source === 'snapshot' && rowView.issue && rowView.issue.body === '行里的正文', 'F1 列表行的快照投影照旧可用', rowView && rowView.issue && rowView.issue.body)
check(typeof rowView.notice === 'string' && rowView.notice.indexOf('detail.lastKnownData') >= 0, 'F2 列表行投影也标上次数据时刻', rowView.notice)

printGateResult(GATE, total, failed)
