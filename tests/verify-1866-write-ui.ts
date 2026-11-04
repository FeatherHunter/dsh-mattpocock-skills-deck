/**
 * tests/verify-1866-write-ui.ts —— 写操作与界面之间的那三条约定（#1866 界面层）
 *
 * 守什么：
 *   A 评论输入框给不给：判据住在 views/shared/detailProjection.ts（commentAvailableOf），
 *     这里直接调它，把「这一趟取回来的详情」与「从本地快照库读回来的详情」两种来源都走一遍。
 *     要点是从库里读回来的详情也能写（库里评论组知道就给），而库里说「不知道」时不给 ——
 *     那是旧口径（只有 live 详情可写）唯一保留下来的部分。
 *   B 写失败不做乐观更新：评论提交的编排里，只有后端回了成功才清空草稿并点亮成功标记；
 *     失败时草稿留着、错误显示出来（这段编排是视图里的闭包，门禁按源码判据核对）。
 *   C 发出去了但没存进本地库时要明说：界面用 detail.cmtNotStored 这句话，文案在中英各有一份。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1866-write-ui.ts
 */
// 门禁归属: src/client/views/shared/detailProjection.ts
// 门禁归属: src/client/views/IssueDetail.ts
// 门禁归属: src/client/views/IssueDetailComments.ts
// 门禁归属: src/client/kernel/api-io.ts

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'

// detailProjection 是界面闭包里的模块（构建时被拼进同一个作用域），直接加载它要先备好那几个全局替身。
// 这份清单与 tests/verify-1783-comments-projection.ts 的那一份同源；这里只补它真正会读到的那几个。
;(globalThis as any).log = function (): void {}
;(globalThis as any).tr = function (key: string, vars?: any): string {
  if (key === 'detail.lastKnownData') return '上次数据 ' + String((vars && vars.time) || '')
  if (key === 'detail.noBody') return '无描述'
  if (key === 'detail.bodyNotYet') return '正文还没拿到'
  if (key === 'list.loading') return '加载中'
  return String(key)
}
;(globalThis as any).idOfParts = function (a: any, b: any): string { return String(a) + '\u0000' + String(b) }
;(globalThis as any).mdToHtml = function (text: string): string { return String(text) }
;(globalThis as any).CONTAINER_ACCENT = { map: '#bc8cff' }
;(globalThis as any).MOTION = { inlineSpinnerMs: 800 }
;(globalThis as any).localStorage = { getItem: function (): null { return null }, setItem: function (): void {} }

const projMod: any = await import('../src/client/views/shared/detailProjection.ts')
const commentsAvailableOf = projMod.commentsAvailableOf as (detail: any, source: string) => boolean
const detailViewFor = projMod.detailViewFor as (st: any, n: any, effortId?: any) => any

const GATE = 'verify-1866-write-ui'
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

function sourceOf(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function main(): void {
  // ── A. 评论输入框的判据 ─────────────────────────────────────────────────────
  const liveDetail: any = { comments: { nodes: [] } }
  check(commentsAvailableOf(liveDetail, 'live') === true,
    'A1 这一趟取回来的详情：有评论连接就给输入框')

  const storedDetail: any = {
    comments: { nodes: [{ body: '评论 1' }] },
    snapshotGroups: { comments: { completeness: 'complete', reason: null, lastQueriedMs: 1 } },
  }
  check(commentsAvailableOf(storedDetail, 'snapshot') === true,
    'A2 从本地快照库读回来的详情：库里评论组完整 → 给输入框')

  const partialDetail: any = {
    comments: { nodes: [{ body: '评论 1' }] },
    snapshotGroups: { comments: { completeness: 'truncated', reason: null, lastQueriedMs: 1 } },
  }
  check(commentsAvailableOf(partialDetail, 'snapshot') === true,
    'A3 只有一部分评论在库里也给（发新评论不要求先把旧评论取全）')

  const unknownDetail: any = {
    comments: { nodes: [] },
    snapshotGroups: { comments: { completeness: 'unknown', reason: 'not-expressed', lastQueriedMs: 1 } },
  }
  check(commentsAvailableOf(unknownDetail, 'snapshot') === false,
    'A4 库里评论组是「不知道」→ 不给输入框（那是还没取过，不是没有）')

  const listRowDetail: any = { comments: { nodes: [] } }
  check(commentsAvailableOf(listRowDetail, 'snapshot') === false,
    'A5 列表快照行投影出来的详情（没有评论组记录）→ 不给输入框')

  check(commentsAvailableOf({}, 'live') === false,
    'A6 回包没带评论连接（这个后端不表达评论）→ 不给输入框')

  // 判据挂在 proj 上：真实调用一次 detailViewFor，确认「从本地快照库读回来的详情」得到 true。
  const fromLibraryIssue: any = {
    number: 5, effortId: '', title: '票 5', state: 'OPEN', body: '正文', fromSnapshot: true,
    lastKnownAtMs: Date.now(),
    comments: { nodes: [{ body: '评论 1' }], pageInfo: { hasNextPage: false, endCursor: '1' }, totalCount: 1 },
    snapshotGroups: { comments: { completeness: 'complete', reason: null, lastQueriedMs: 1 } },
  }
  const viewFromLibrary: any = detailViewFor({ issueDetail: fromLibraryIssue, issueMode: 'real', issueCache: {} }, 5, '')
  check(viewFromLibrary && viewFromLibrary.source === 'snapshot', 'A7 库里读回来的详情按快照来源交回',
    viewFromLibrary && viewFromLibrary.source)
  check(viewFromLibrary && viewFromLibrary.commentsAvailable === true,
    'A8 视图结果上带着「可以评论」这条判据（视图不新增全局名字）', viewFromLibrary && viewFromLibrary.commentsAvailable)
  const viewFromListRow: any = detailViewFor({
    snapshot: { issues: [{ number: 6, effortId: '', title: '票 6', state: 'OPEN', body: '正文', comments: [], labels: [] }] },
    issueDetail: null, issueCache: {},
  }, 6, '')
  check(viewFromListRow && viewFromListRow.commentsAvailable === false,
    'A9 从列表快照行投影出来的详情：评论组不知道 → 不可以评论', viewFromListRow && viewFromListRow.commentsAvailable)


  check(commentsAvailableOf({ isPullRequest: true, comments: { nodes: [] } }, 'live') === true,
    'A10 拉取请求那条判据不在这里（它还看列表行上的标记），由视图单独挡')

  // ── B. 视图真的用它，写失败不乐观更新 ───────────────────────────────────────
  const detailView: string = sourceOf('src/client/views/IssueDetail.ts')
  check(detailView.indexOf('proj.commentsAvailable !== true') >= 0,
    'B1 详情页按视图结果决定显不显示输入框（IssueDetail.ts）')
  check(detailView.indexOf("if (proj.source !== 'live') canComment = false") < 0,
    'B2 旧口径「不是 live 就一律只读」已经撤掉')

  const commentsView: string = sourceOf('src/client/views/IssueDetailComments.ts')
  const liveIdx: number = commentsView.indexOf('submitIssueComment(st, issueNumber, text')
  const failIdx: number = commentsView.indexOf('st.cmtError = (res && res.error) || { kind: \'network\' }')
  const clearIdx: number = commentsView.indexOf("st.cmtDraft = ''")
  check(liveIdx >= 0 && failIdx > liveIdx, 'B3 失败分支排在提交之后（写失败时先显示错误）')
  check(clearIdx > failIdx, 'B4 只有成功那一条分支才清空草稿（失败时草稿留着，人不至于重打一遍）')
  check(commentsView.indexOf('st.cmtNotStored') >= 0 && commentsView.indexOf('detail.cmtNotStored') >= 0,
    'B5 发出去了但没存进本地库时，界面有一句自己的说明（不与失败混用同一句）')

  // ── C. 文案中英各一份 ──────────────────────────────────────────────────────
  const copy: string = sourceOf('config/copy/flow.yaml')
  const hits: number = copy.split('detail.cmtNotStored:').length - 1
  check(hits === 2, 'C1 文案在中英两份里各有一条（detail.cmtNotStored × 2）', hits)
  check(copy.indexOf('detail.cmtNotStored: 评论已经发出去了') >= 0, 'C2 中文这一条说的是「发出去了但没存进本地库」')
  check(copy.indexOf('detail.cmtNotStored: "The comment was posted') >= 0, 'C3 英文这一条说同一件事')

  // ── D. 客户端把「存没存上」这个结果带回来 ───────────────────────────────────
  const api: string = sourceOf('src/client/kernel/api-io.ts')
  check(api.indexOf('stored: res.stored !== false') >= 0, 'D1 客户端把宿主回的「已存」透传出来（api-io.ts）')

  printGateResult(GATE, total, failed)
}

main()
