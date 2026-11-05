/**
 * tests/verify-1885-review-read-versions.ts —— 每一份读回包都带库版本，304 按库版本判
 * （规格 #1885 §4 / 不变量 I2，§9；评审修复 B、C）
 *
 * 守什么：
 *  A 四个既有读回包（wf.snapshot / wf.probe / wf.issueDetail / wf.issueComments）都带 version，
 *    且四个数字与同一时刻库里的合并版本相等——不是内容散列、也不是 0。
 *  B 304 的判据是库版本：第一次快照回包里带的版本原样交回去，电话层直接回 304；
 *    编排器自己不再拿内容散列判 304（内容版号只作内部排障读数）。
 *
 * 为什么用真 SQLite + 假后端：版本是库的单调整数，四个电话各自去读同一个库；只断言「字段存在」
 * 抓不住「读的是另一份数」。假后端只负责认出工作区与仓库身份，四个电话都不联网（详情/评论走库）。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1885-review-read-versions.ts
 */
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/probe-handler.ts
// 门禁归属: src/refresh/rooms/host/comment-thread-fetch.ts
// 门禁归属: src/host/tracker/snapshot.ts
// 门禁归属: src/host/snapshotEnvelope.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import * as library from '../src/refresh/rooms/host/snapshot-library.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import { createProbeHandler } from '../src/refresh/rooms/host/probe-handler.ts'
import { createCommentThreads } from '../src/refresh/rooms/host/comment-thread-fetch.ts'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.ts'

const GATE = 'verify-1885-review-read-versions'
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/versions',
  name: 'acme/versions',
  url: 'https://github.com/acme/versions',
}
let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1885-versions-'))
const dbPath = path.join(root, 'snapshot.sqlite')
let clock = Date.now()
const now = (): number => clock

function issue(key: string, title: string, extra?: Partial<Issue>): Issue {
  return Object.assign({
    key: key,
    effortId: '',
    type: 'issue',
    title: title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/versions/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
    blockedBy: [],
    isPullRequest: false,
  }, extra || {})
}

function libKey(): any {
  return { workspaceRoot: root, backend: 'github', repoIdentity: REPO.refId }
}

async function libraryVersion(): Promise<number> {
  const version = await library.readLibraryVersion(libKey())
  if (typeof version !== 'number') throw new Error('库里读不到版本')
  return version
}

function upcaseSnapStates(snap: any): any {
  const up = (row: any): any => { if (row && row.state) row.state = String(row.state).toUpperCase(); return row }
  ;(snap.maps || []).forEach((m: any) => { up(m); (m.tickets || []).forEach(up) })
  ;(snap.issues || []).forEach(up)
  return snap
}

function sessionSnapshotPhone(): any {
  return createSessionSnapshot({
    envelope: undefined,
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({ describe: () => REPO, modules: () => [], get: () => ({}) }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    upcaseSnapStates,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: (tickets: any[]) => ({ total: tickets.length, open: tickets.length, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async () => root,
    getRepoKey: async () => ({ owner: 'acme', name: 'versions' }),
    adoptSnapshot: (snap: any) => snap,
    detectionExec: () => { throw new Error('门禁不该发命令') },
    getGhPath: () => null,
    getGhLastError: () => null,
    errText: (e: any) => String((e && e.message) || e),
    getSnapshotLibrary: async () => library,
  } as any)
}

function probePhone(): any {
  return createProbeHandler({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({ describe: () => REPO, modules: () => [], get: () => ({}) }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    detectionExec: () => ({}),
    fetchIssueIndexWindowed: async () => ({ ok: false }),
    issueIndexChanged: () => false,
    rememberIssueIndex: () => {},
    commitIssueIndex: async () => ({ ok: true }),
    lastIssueIndexByRepo: {},
    lastProbeAtByRepo: {},
    deltaRefresh: async () => null,
    takeWritePatch: async () => ({ rows: ['1'], version: 'content-version', at: now(), queries: 1, partial: false }),
    errText: (e: any) => String((e && e.message) || e),
    openSession: null,
    getSnapshotLibrary: async () => library,
  } as any)
}

let sessionGets = 0
function commentThreadsPhone(): any {
  return createCommentThreads({
    normCwd: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({ describe: () => REPO, modules: () => [] }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    timer: null,
    DEFAULT_CWD: '',
    errText: (e: any) => String((e && e.message) || e),
    isRateLimitError: () => false,
    getRepoKey: async () => ({ owner: 'acme', name: 'versions' }),
    execProc: async () => ({ ok: true, text: '', code: 0 }),
    fetchIssueIndex: async () => ({ ok: false }),
    issueIndexFromSnapshot: () => ({}),
    setCache: () => {},
    // 详情 / 评论电话的前奏会先开只读会话（取数口才在会话里）；库里的数据新鲜时不用它的 get。
    // 这一支会话被调到就说明本地优先没命中，让门禁红在 count 上，而不是编一份远端数据糊过去。
    openSession: async () => ({
      ok: true,
      backendId: 'github',
      repoRef: REPO,
      call: async (fn: any) => { sessionGets += 1; return fn({ get: async () => ({ ok: false, error: { kind: 'gate', message: '不该走到远端' } }) }, {}) },
    }),
    getSnapshotLibrary: async () => library,
    logCtx: null,
  } as any)
}

try {
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1885-versions\n', 'utf8')

  // ---- 先写两张列表行，再写详情与评论（同一个库、同一个版本号）----
  const opened = openWorkspaceSnapshot({ workspaceRoot: root, backend: 'github', repoIdentity: REPO.refId, dbPath: dbPath, now: now, leaseOwner: 'gate-1885-versions-seed' })
  const seeded = opened.handle.ingest({ startMergeVersion: opened.handle.getMergeVersion(), writes: issueWritesOf([issue('1', '一号'), issue('2', '二号')], 'github') })
  check(seeded.committed === true, 'A0 两张列表行写进库', seeded)
  opened.handle.close()

  const detail = issue('1', '一号', {
    body: '一号的正文',
    comments: [
      { author: { login: 'bob' }, body: '评论一', createdAt: '2026-11-02T00:00:00Z' },
      { author: { login: 'carol' }, body: '评论二', createdAt: '2026-11-03T00:00:00Z' },
    ],
    commentCount: 2,
    labels: [{ name: 'ready-for-agent', color: '00ff00' }],
    assignees: [{ login: 'alice' }],
  })
  const detailWrite = await library.recordIssueDetail(Object.assign({ issue: detail }, libKey()))
  check(detailWrite && detailWrite.ok !== false, 'A1 详情写进库', detailWrite)
  const expected = await libraryVersion()
  check(expected > 0, 'A2 库版本是个正整数', expected)

  // ---- A1 wf.snapshot ----
  const snapshotPhone = sessionSnapshotPhone()
  const snapshotReply: any = await snapshotPhone.handleSnapshot({ cwd: root, backendId: 'github' })
  check(snapshotReply && snapshotReply.ok === true, 'A3 wf.snapshot 成功', snapshotReply && snapshotReply.ok)
  check(typeof snapshotReply.version === 'number' && snapshotReply.version === expected,
    'A4 wf.snapshot 回包带库版本，且与库当前版本一致（不是内容散列）', { got: snapshotReply.version, want: expected, type: typeof snapshotReply.version })

  // ---- A2 wf.probe（写事件补丁这一支）----
  const probeReply: any = await probePhone().handleProbe({ cwd: root })
  check(probeReply && probeReply.ok === true, 'A5 wf.probe 成功', probeReply && probeReply.ok)
  check(typeof probeReply.version === 'number' && probeReply.version === expected,
    'A6 wf.probe 回包带库版本，且与库当前版本一致', { got: probeReply.version, want: expected })

  // ---- A3 wf.issueDetail ----
  const detailPhone: any = commentThreadsPhone()
  const detailReply: any = await detailPhone.handleIssueDetail({ cwd: root, number: 1, effortId: '' })
  check(detailReply && detailReply.ok === true && detailReply.fromSnapshot === true, 'A7 wf.issueDetail 从库出（新鲜就不取数）', { ok: detailReply && detailReply.ok, fromSnapshot: detailReply && detailReply.fromSnapshot })
  check(typeof detailReply.version === 'number' && detailReply.version === expected,
    'A8 wf.issueDetail 回包带库版本，且与库当前版本一致', { got: detailReply.version, want: expected })
  check(sessionGets === 0, 'A8b 详情这一趟一次远端 get 都没发（本地优先命中）', sessionGets)

  // ---- A4 wf.issueComments ----
  const commentsReply: any = await detailPhone.handleIssueComments({ cwd: root, number: 1, after: 0, effortId: '' })
  check(commentsReply && commentsReply.ok === true && Array.isArray(commentsReply.nodes) && commentsReply.nodes.length === 2,
    'A9 wf.issueComments 从库出两页评论', commentsReply && commentsReply.nodes)
  check(typeof commentsReply.version === 'number' && commentsReply.version === expected,
    'A10 wf.issueComments 回包带库版本，且与库当前版本一致', { got: commentsReply.version, want: expected })

  // ---- B 304 按库版本判 ----
  const again: any = await snapshotPhone.handleSnapshot({ cwd: root, backendId: 'github', ifNoneMatch: String(expected) })
  check(again && again.notModified === true && again.status === 304, 'B1 带同一个库版本再取快照：回 304', { notModified: again && again.notModified, status: again && again.status })
  check(again && again.version === expected && again.workspaceRoot === root, 'B2 304 回包仍然带库版本与工作区根', { version: again && again.version, workspaceRoot: again && again.workspaceRoot })
  const stale: any = await snapshotPhone.handleSnapshot({ cwd: root, backendId: 'github', ifNoneMatch: String(expected - 1) })
  check(stale && stale.notModified !== true && stale.ok === true && stale.version === expected,
    'B3 版本对不上时照常回整份（不是 304）', { notModified: stale && stale.notModified, version: stale && stale.version })

  // ---- B4 编排器自己不再按内容散列判 304 ----
  const registry: any = { describe: () => REPO, get: () => ({ list: async () => ({ ok: true, data: [] }) }) }
  const composer: any = createSnapshotComposer(registry, { snapshotTtl: 60000 })
  const composed: any = await composer.composeSnapshot('github', REPO, { cwd: root }, { ifNoneMatch: '' })
  check(composed && composed.ok === true && composed.notModified !== true, 'B4 第一次组装回整份', composed && composed.notModified)
  const composedAgain: any = await composer.composeSnapshot('github', REPO, { cwd: root }, { ifNoneMatch: String(composed.version || '') })
  check(composedAgain && composedAgain.notModified !== true && composedAgain.ok === true,
    'B5 拿内容版号再来一次也不回 304（304 已改由电话层按库版本判）', { notModified: composedAgain && composedAgain.notModified })

  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
} catch (e: any) {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
} finally {
  try { library.closeSnapshotLibraries() } catch { /* 已关 */ }
  try { rmSync(root, { recursive: true, force: true }) } catch { /* 已删 */ }
}
