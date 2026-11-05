// tests/verify-snapshot-cache-first.ts
//
// 门禁：手上有快照库里的数据时，「面板数据」这条通话必须立刻交付，不许在交付前先联网核对。
//
// 为什么必须有这条：
//   核对一次要把全仓库 issue 扫一遍（实测 505 条、6 页、约 4~5 秒），而结论多数是「没变」，
//   于是那几秒纯属白等——用户看到的现象就是「点开右侧面板一直不出来」。
//   改成「先交付、后核对」之后，这条契约必须被钉住，否则以后有人顺手把核对挪回交付之前，
//   卡顿会无声地回来（不会有任何报错，只有用户觉得慢）。
//
// #1893（规格 #1885 S5）改的是「缓存住哪儿」，不是这条契约：宿主内存副本已删，首屏的本地数据
// 来自本地 SQLite 快照库的回放。判据从「内存缓存命中」换成「库里有回放就交付、取数次数为零」；
// 原来那几条「缓存多旧都立刻交付」的年龄用例随之退役——库回放没有 TTL，改由库版本与刷新路径管新鲜度。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-snapshot-cache-first.ts

import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'

const GATE = 'verify-snapshot-cache-first'
const CWD = 'D:\\dsh-plugin\\dsh-mattpocock-skills-deck'
const REPO: RepositoryRef = { backend: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck', name: 'dsh-mattpocock-skills-deck', url: '' }
let failed = 0
let total = 0
function check(ok: unknown, msg: string, detail?: unknown): void {
  total++
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）')))
  if (!ok) failed++
}

function replaySnapshot(): any {
  return {
    ok: true,
    generatedMs: 1789000000000,
    maps: [{ number: 1, title: '地图', state: 'OPEN', tickets: [] }],
    issues: [{ number: 2, key: '2', state: 'OPEN', updatedAt: '2026-09-11T00:00:00Z', title: '票' }],
    thinTickets: [],
    labels: [],
    repository: REPO,
  }
}

/**
 * 造一台首屏电话：库门面交回一个固定回放；取数与开会话都装计数器（并抛错，任何一次触碰都留痕迹）。
 * 线上那套依赖里已经没有 getCache / setCache / CACHE_MS —— 这条门禁就是来证明不需要它们的。
 */
function makeHost(opts?: { emptyLibrary?: boolean }) {
  const net = { list: 0, currentUser: 0, openSession: 0, exec: 0, libraryRead: 0 }
  const backend = {
    list: async () => { net.list += 1; return { ok: true, data: [issueRow()] } },
    counts: async () => ({ ok: false, error: { kind: 'unsupported' } }),
    listPage: async () => ({ ok: false, error: { kind: 'unsupported' } }),
    listSubIssues: async () => ({ ok: false, error: { kind: 'unsupported' } }),
    getCurrentUser: async () => { net.currentUser += 1; return { ok: true, data: { login: 'octo' } } },
  }
  const library = {
    readSnapshotReplay: async () => {
      net.libraryRead += 1
      return (opts && opts.emptyLibrary) ? null : { snapshot: replaySnapshot(), lastKnownAtMs: 1789000000000 }
    },
    readSnapshotDiagnostics: async () => [],
    recordIssueRows: async () => ({ ok: true, rows: 1, mergeVersion: 1 }),
  }
  const adopted: { snapshot: any } = { snapshot: null }
  const h = createSessionSnapshot({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', source: 'auto', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({ get: () => backend, modules: () => [], describe: () => REPO }),
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    upcaseSnapStates: (s: any) => s,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async () => CWD,
    getRepoKey: async () => ({ owner: 'FeatherHunter', name: 'dsh-mattpocock-skills-deck' }),
    adoptSnapshot: (snap: any) => { adopted.snapshot = snap; return snap },
    detectionExec: () => { net.exec += 1; throw new Error('不该执行命令') },
    getGhPath: () => '',
    getGhLastError: () => '',
    errText: (e: any) => String((e && e.message) || e),
    DEFAULT_CWD: CWD,
    logCtx: null,
    // 库门面一直在；「库空」是 readSnapshotReplay 回 null，不是门面没接——后者会让取回的行无处可写。
    getSnapshotLibrary: async () => library,
    openSession: async () => { net.openSession += 1; return { ok: true, backendId: 'github', call: async (fn: any) => fn(backend, {}) } },
  } as any)
  return { h, net, adopted }
}

function issueRow(): Issue {
  return {
    key: '2', effortId: '', type: 'issue', title: '票', state: 'open', body: '',
    url: '', createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', closedAt: null, parentKey: null,
  }
}

console.log('快照缓存优先门禁（库里有数据必须立刻交付，不许先联网核对）')

// ---------- 一、库里有回放：必须立刻交付，且不许联网 ----------
{
  const { h, net, adopted } = makeHost()
  const t0 = Date.now()
  const got = await h.handleSnapshot({ cwd: CWD })
  const ms = Date.now() - t0
  const snap = adopted.snapshot || got.snapshot
  check(got && got.ok === true, '库里有回放：首屏成功', got)
  check(!!snap && snap.fromCache === true && !!snap.diskReplay, '库里有回放：回包标了 fromCache 与 diskReplay（这一份来自库）')
  check(!!snap && (snap.maps || []).length === 1 && (snap.issues || []).some((row: any) => String(row.key) === '2'),
    '库里有回放：地图容器与那张票都在（数据就是库里那一条）', snap && { maps: (snap.maps || []).length, issues: snap.issues })
  check(!snap || !snap.snapshotFetch, '库里有回放：不冒充在线重建（snapshotFetch 为空）', snap && snap.snapshotFetch)
  check(net.list === 0 && net.currentUser === 0 && net.openSession === 0 && net.exec === 0,
    '库里有回放：全程没有取数请求、没有问当前用户、没有开会话', net)
  check(ms < 1000, '库里有回放：交付 ' + ms + ' 毫秒（本来就不该等网络）', ms)
}

// ---------- 二、再问一次：同一份库回放仍然零取数（没有按年龄失效这一档） ----------
{
  const { h, net } = makeHost()
  const a = await h.handleSnapshot({ cwd: CWD })
  const b = await h.handleSnapshot({ cwd: CWD })
  check(a && b && a.ok === true && b.ok === true, '同一份库连续两次首屏都成功')
  check(net.list === 0 && net.libraryRead === 2, '两次都读了库、一次都没取数（库回放没有年龄门槛）', net)
}

// ---------- 三、库空：必须在线重建，不许拿任何本地副本交付 ----------
{
  const { h, net } = makeHost({ emptyLibrary: true })
  const got: any = await h.handleSnapshot({ cwd: CWD })
  check(got && got.ok === true, '库空时首屏走在线重建并成功', got)
  check(net.list > 0, '库空时真的去后端取数了（没有本地副本可以冒充数据）', net)
  check(!!got && got.snapshotFetch && got.snapshotFetch.source === 'online-rebuild' && got.snapshotFetch.rows > 0,
    '库空时回包带在线重建的进度（取到了几行）', got && got.snapshotFetch)
}

// ---------- 四、强制重建：不许走库回放短路 ----------
{
  const { h, net } = makeHost()
  const got: any = await h.handleSnapshot({ cwd: CWD, force: true })
  check(got && got.ok === true, '强制重建成功', got)
  check(net.list > 0, '强制重建没有把手上的库回放原样当结果返回（真的去取了数）', net)
}

printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
