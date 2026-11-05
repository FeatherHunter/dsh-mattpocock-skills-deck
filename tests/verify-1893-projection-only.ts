/**
 * tests/verify-1893-projection-only.ts —— 回包是库的纯投影，宿主里没有第二份面板数据（#1893，规格 #1885 S5）
 *
 * 守什么（票面验收逐条落在这里）：
 *   A 静态判据：宿主里那条「存整份快照」的路径已经不存在——宿主入口不再有按工作区存快照的表，
 *     getCache 这个名字在全仓源码里消失，setCache 只剩一个明确的空操作（只在「通知缓存失效」的旧
 *     调用点上被调用，且载荷里的 snapshot 一律是 null）；首屏不再有「库为空时拿内存副本兜底」的分支；
 *     行级增量的生产装配只从库回放取基线；快照回包带 snapshotFetch（这一份是库回放还是在线重建、
 *     取到了几行）。
 *   B 运行时不变量（真 SQLite + 假后端）：首屏只来自库——库里有数据时零取数请求；把库里的标题改掉，
 *     下一次首屏立刻是新值（证明每次都是按库现投影，不是拿内存里那份）；把库门面摘掉、后端桩改成
 *     一调就抛，首屏拿不到任何数据（证明没有第二份兜底）。
 *   C 库空 → 在线重建并给出进度：空库 + 假后端，首屏失败之前会真的取数、把行写进库，回包带
 *     snapshotFetch（source=online-rebuild、rows=N）；同一路径第二次首屏从库出、零取数请求。
 *     界面那侧由既有的加载态表达「正在取数」（见 C 段末的静态断言与 list.fetching 文案）。
 *   D 首屏预算：合成库 1000 张票（真 SQLite），一次首屏（库回放 + 投影 + 序列化）≤ 300 毫秒，
 *     且不发起任何取数请求。300 是规格 #1885 S5 的验收数字，是事件耗时上限、不是可调时间参数，
 *     所以它是一个带说明的常数，不进 config/。
 *
 * 为什么这么测：这一票要证明的是「宿主进程里不再有第二份面板数据」。静态判据只能证明「那条代码
 * 路径没了」，证明不了「回包真的来自库」；所以后半段用真库去改数据、摘门面、数请求，三件都是
 * 外部可观察的事实，不看内部结构。首屏预算只有拿合成库真跑一次才有意义。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1893-projection-only.ts
 */
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library-first-screen.ts
// 门禁归属: src/host/index.ts
// 门禁归属: src/refresh/rooms/host/patch-wiring.ts
// 门禁归属: src/refresh/rooms/host/snapshot-view-projection.ts
// 门禁归属: src/refresh/rooms/client/snapshot-sync.ts

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.ts'
import {
  closeSnapshotLibraries,
  readSnapshotReplay,
  recordIssueRows,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import { SNAPSHOT_TOP_FIELDS, snapshotFieldViolations } from '../src/host/snapshotEnvelope.ts'

const GATE = 'verify-1893-projection-only'
const ROOT = process.cwd()
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/widgets',
  name: 'widgets',
  url: 'https://github.com/acme/widgets',
}

/**
 * 首屏耗时上限：300 毫秒（规格 #1885 S5 的验收数字）。
 *
 * 为什么写在这里而不是 config/：它不是「等多久算超时」的可调参数，而是「这一次投影加序列化最多
 * 允许多慢」的验收上限；调大调小只改变门禁的严格程度，不改变运行时行为。仓里的时间参数纪律
 * （config/ 三份 YAML）管的是运行时读到的时长，这一类事件耗时上限按「写常数并说明」处理。
 */
const FIRST_SCREEN_BUDGET_MS = 300

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function sourceOf(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 去掉注释与字符串字面量：静态判据只认「代码里真的还有这个名字」，注释里提到不算。 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\x60(?:[^\x60\\]|\\.)*\x60/g, '""')
}

/** 递归列出 src 下的手写源码（.ts/.mts），派生文件不参与静态判据。 */
function sourceFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue }
    if (/\.(ts|mts)$/.test(name)) out.push(full)
  }
}

function issue(key: string, title: string, extra?: Partial<Issue>): Issue {
  const base: Issue = {
    key,
    effortId: '',
    type: 'issue',
    title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
  }
  return Object.assign(base, extra || null)
}

function upcaseSnapStates(snap: any): any {
  const up = (row: any) => { if (row && row.state) row.state = String(row.state).toUpperCase(); return row }
  ;(snap.maps || []).forEach((m: any) => { up(m); (m.tickets || []).forEach(up) })
  ;(snap.issues || []).forEach(up)
  return snap
}

function groupTicketsOf(tickets: any[]): any {
  return {
    total: tickets.length,
    open: tickets.filter((t) => String(t.state).toUpperCase() !== 'CLOSED').length,
    closed: tickets.filter((t) => String(t.state).toUpperCase() === 'CLOSED').length,
    frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {},
  }
}

function makeWorkspace(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: ' + prefix + '\n', 'utf8')
  return root
}

interface NetCalls {
  list: number
  currentUser: number
  openSession: number
  exec: number
  probe: number
}

/** 一套假后端：行原样交回，每个联网动作都先记一笔再决定抛不抛。 */
function makeBackend(rows: Issue[], net: NetCalls, opts?: { throwList?: boolean }): any {
  const track = {
    list: async () => {
      net.list += 1
      if (opts && opts.throwList) throw new Error('断网/后端不可用时不该取数')
      return { ok: true, data: rows.map((row) => Object.assign({}, row)) }
    },
    counts: async () => ({ ok: false, error: { kind: 'unsupported' } }),
    listPage: async () => ({ ok: false, error: { kind: 'unsupported' } }),
    listSubIssues: async () => ({ ok: false, error: { kind: 'unsupported' } }),
    getCurrentUser: async () => { net.currentUser += 1; return { ok: true, data: { login: 'octo' } } },
  }
  return {
    registry: {
      describe: () => REPO,
      modules: () => [],
      get: () => track,
    },
    openSession: async () => {
      net.openSession += 1
      return { ok: true, backendId: 'github', repoRef: REPO, call: async (fn: any) => fn(track, { cwd: '' }) }
    },
  }
}

/** 造一台首屏电话：库门面由 libRef.current 决定（B5 那一步会把它摘掉）。 */
function makePhone(root: string, libRef: { current: any }, backend: any, net: NetCalls, adopted: { snapshot: any }) {
  return createSessionSnapshot({
    canonicalKey: async (value: unknown) => String(value),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => backend.registry,
    getPlatform: async () => ({}),
    ctx: { get: () => null },
    upcaseSnapStates,
    computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: groupTicketsOf,
    getRepoRoot: async () => root,
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    adoptSnapshot: (snap: unknown) => { adopted.snapshot = snap; return snap },
    detectionExec: () => { net.exec += 1; throw new Error('这一路不该执行命令') },
    getGhPath: () => null,
    getGhLastError: () => null,
    errText: (e: any) => String((e && e.message) || e),
    getSnapshotLibrary: async () => libRef.current,
    openSession: backend.openSession,
    logCtx: null,
    DEFAULT_CWD: root,
  } as any)
}

function replayOf(root: string): Promise<any> {
  return readSnapshotReplay({ workspaceRoot: root, backend: 'github', repoIdentity: REPO.refId, repo: REPO })
}

function snapshotOf(reply: any, adopted: { snapshot: any }): any {
  return adopted.snapshot || (reply && reply.snapshot) || null
}

async function main(): Promise<void> {
  console.log('回包纯投影门禁（#1893：宿主里没有第二份面板数据）')

  // ==========================================================================
  // A 静态判据：那条存快照的路径不再存在
  // ==========================================================================
  {
    const hostIndex = sourceOf('src/host/index.ts')
    check(!/snapshotByRoot/.test(codeOnly(hostIndex)), 'A1 宿主入口里没有按工作区存快照的表（snapshotByRoot 已删）')
    check(!/touchSnapshotLRU/.test(hostIndex), 'A2 宿主入口里没有快照 LRU 的触摸函数')
    const setCacheDef = hostIndex.match(/function\s+setCache\s*\([^)]*\)[^{]*\{\s*\}/)
    check(!!setCacheDef, 'A3 宿主入口的 setCache 是明确的空操作（不接受、不保存任何快照）', setCacheDef && setCacheDef[0])

    const files: string[] = []
    sourceFiles(path.join(ROOT, 'src'), files)
    const getCacheHits: string[] = []
    const snapshotStoreHits: string[] = []
    for (const file of files) {
      const code = codeOnly(readFileSync(file, 'utf8'))
      if (/\bgetCache\b/.test(code)) getCacheHits.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      if (/snapshotByRoot|touchSnapshotLRU/.test(code)) snapshotStoreHits.push(path.relative(ROOT, file).replace(/\\/g, '/'))
    }
    check(getCacheHits.length === 0, 'A4 全仓源码里不再有「从内存副本读快照」的 getCache', getCacheHits)
    check(snapshotStoreHits.length === 0, 'A5 全仓源码里不再有快照内存表的写入点', snapshotStoreHits)

    // 剩下的 setCache 调用点只能是「通知缓存失效」：载荷里的 snapshot 必须是 null。
    const badWrites: Array<{ file: string, call: string }> = []
    let invalidationCalls = 0
    for (const file of files) {
      const code = codeOnly(readFileSync(file, 'utf8'))
      let from = 0
      while (true) {
        const at = code.indexOf('setCache(', from)
        if (at < 0) break
        // 跳过函数定义与类型声明：真正的调用点参数都是对象字面量（setCache({...})），
        // 类型声明写成 setCache(entry: {...}) 或 setCache(v: unknown)。
        const after = code.slice(at + 'setCache('.length).replace(/^\s+/, '')
        if (!after.startsWith('{')) { from = at + 9; continue }
        let depth = 1
        let i = at + 'setCache('.length
        while (i < code.length && depth > 0) {
          const ch = code[i]
          if (ch === '(') depth += 1
          else if (ch === ')') depth -= 1
          i += 1
        }
        const call = code.slice(at, i)
        invalidationCalls += 1
        if (!/snapshot\s*:\s*null/.test(call)) badWrites.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), call: call.slice(0, 120) })
        from = i
      }
    }
    check(badWrites.length === 0, 'A6 所有 setCache 调用点都只做失效（载荷 snapshot 一律 null，没有整份快照回写）', badWrites)
    check(invalidationCalls >= 5, 'A7 旧的内存失效调用点仍在（' + invalidationCalls + ' 处，全部是显式空操作；逐条清单见交付报告）', invalidationCalls)

    const sessionSrc = sourceOf('src/refresh/rooms/host/session-snapshot-cache.ts')
    check(codeOnly(sessionSrc).indexOf('createWorkingCopyFallback') < 0, 'A8 首屏电话里没有「库空时拿内存副本兜底」的判据')
    check(codeOnly(sessionSrc).indexOf('getCache') < 0, 'A9 首屏电话不再读内存副本')
    check(codeOnly(sessionSrc).indexOf('CACHE_MS') < 0, 'A10 首屏电话不再按内存缓存有效期做短路')
    check(sessionSrc.indexOf('firstScreenFromLibrary') >= 0 && sessionSrc.indexOf('commitRows') >= 0,
      'A11 首屏的读与写都只经快照库门面：先读回放、取回的行整批写库')

    const firstScreenSrc = sourceOf('src/refresh/rooms/host/snapshot-library-first-screen.ts')
    check(codeOnly(firstScreenSrc).indexOf('createWorkingCopyFallback') < 0, 'A12 首屏助手不再导出内存副本兜底')

    const listSrc = codeOnly(sourceOf('src/refresh/rooms/host/issue-list-fetch.ts'))
    check(listSrc.indexOf('setCache') < 0, 'A13 列表取数不再把整份快照写回任何缓存')

    const patchSrc = codeOnly(sourceOf('src/refresh/rooms/host/patch-wiring.ts'))
    check(patchSrc.indexOf('writeSnapshot:') < 0 || patchSrc.indexOf('writeSnapshotForPatch') >= 0,
      'A14 行级增量的生产装配不再向宿主内存写整份快照（只剩门禁夹具的显式口）')
    check(patchSrc.indexOf('readReplay') >= 0 || patchSrc.indexOf('readSnapshotReplay') >= 0,
      'A15 行级增量的基线从快照库回放读（不再从内存副本读）')

    check(SNAPSHOT_TOP_FIELDS.indexOf('snapshotFetch') >= 0, 'A16 快照信封的字段白名单含 snapshotFetch（这一份是库回放还是在线重建）')
    check(snapshotFieldViolations({ ok: true, snapshotFetch: { source: 'online-rebuild', rows: 1, at: 1 } }).length === 0,
      'A17 snapshotFetch 是白名单内的顶层字段')
    check(sessionSrc.indexOf('snapshotFetch') >= 0, 'A18 首屏回包会带 snapshotFetch 进度')
  }

  // ==========================================================================
  // B 运行时不变量：库是唯一来源
  // ==========================================================================
  const bRoot = makeWorkspace('verify-1893-b-')
  try {
    closeSnapshotLibraries()
    const seedRows: Issue[] = [issue('101', '票 101'), issue('102', '票 102'), issue('103', '票 103')]
    const seed = await recordIssueRows({ workspaceRoot: bRoot, backend: 'github', repoIdentity: REPO.refId, rows: seedRows, atomic: true })
    check(seed.ok === true && seed.rows === 3, 'B1 库里先有三张票（真 SQLite）', seed)

    const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0, probe: 0 }
    const backend = makeBackend(seedRows, net)
    const libRef = { current: await import('../src/refresh/rooms/host/snapshot-library.ts') }
    const adopted: { snapshot: any } = { snapshot: null }
    const phone = makePhone(bRoot, libRef, backend, net, adopted)
    const first: any = await phone.handleSnapshot({ cwd: bRoot, backendId: 'github' })
    check(first && first.ok === true, 'B2 库里有数据时首屏成功', first)
    const snap = snapshotOf(first, adopted)
    check(snap && snap.fromCache === true && !!snap.diskReplay, 'B3 首屏标了 fromCache 与 diskReplay（来自库回放）')
    check(!!snap && (snap.issues || []).length === 3, 'B4 三张票都从库铺出来', snap && (snap.issues || []).length)
    check(net.list === 0 && net.currentUser === 0 && net.openSession === 0 && net.exec === 0,
      'B5 库里有数据时首屏一个取数请求都没发', net)

    // 改库：下一次首屏必须立刻是新值。若宿主还留着第二份副本，这里会回旧标题。
    await recordIssueRows({ workspaceRoot: bRoot, backend: 'github', repoIdentity: REPO.refId, rows: [issue('101', '票 101（改过）')] })
    const again: any = await phone.handleSnapshot({ cwd: bRoot, backendId: 'github' })
    const snapAgain = snapshotOf(again, adopted)
    const row101 = ((snapAgain && snapAgain.issues) || []).filter((row: any) => String(row.key) === '101')[0]
    check(!!row101 && row101.title === '票 101（改过）', 'B6 库里的标题改了，下一次首屏立刻是新值（每次都是按库现投影）', row101 && row101.title)
    check(net.list === 0, 'B7 这一次仍然没有取数（改库不等于要联网）', net.list)

    // 摘掉库门面、后端改成抛错：若宿主还有内存副本，它会照旧交付；正确行为是如实失败。
    libRef.current = null
    const offlineNet: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0, probe: 0 }
    const deadBackend = makeBackend(seedRows, offlineNet, { throwList: true })
    const deadPhone = makePhone(bRoot, { current: null }, deadBackend, offlineNet, { snapshot: null })
    const dead: any = await deadPhone.handleSnapshot({ cwd: bRoot, backendId: 'github' })
    check(!dead || dead.ok === false, 'B8 库门面摘掉之后首屏如实失败（不回上一次那份）', dead)
    check(!dead || !(dead.maps || []).length, 'B9 失败回包里没有旧数据（宿主里没有第二份可交付的副本）', dead && dead.maps)
    closeSnapshotLibraries()
  } finally {
    try { rmSync(bRoot, { recursive: true, force: true }) } catch (eR) { /* 清理失败不影响结论 */ }
  }

  // ==========================================================================
  // C 库空 → 在线重建，带进度，最终出数据
  // ==========================================================================
  const cRoot = makeWorkspace('verify-1893-c-')
  try {
    closeSnapshotLibraries()
    const rows: Issue[] = [issue('201', '在线取回的第一张'), issue('202', '在线取回的第二张'), issue('203', '在线取回的第三张')]
    const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0, probe: 0 }
    const backend = makeBackend(rows, net)
    const libRef = { current: await import('../src/refresh/rooms/host/snapshot-library.ts') }
    const adopted: { snapshot: any } = { snapshot: null }
    const phone = makePhone(cRoot, libRef, backend, net, adopted)

    const emptyReplay = await replayOf(cRoot)
    check(emptyReplay === null, 'C1 出发时库是空的（没有可回放的数据）', emptyReplay)
    const first: any = await phone.handleSnapshot({ cwd: cRoot, backendId: 'github' })
    check(first && first.ok === true, 'C2 空库首屏走在线重建并成功', first)
    const snap = snapshotOf(first, adopted)
    check(!!snap && (snap.issues || []).length === 3, 'C3 在线重建交出了数据（不空白）', snap && (snap.issues || []).length)
    const fetch = snap && snap.snapshotFetch
    check(!!fetch && fetch.source === 'online-rebuild' && fetch.rows === 3 && typeof fetch.at === 'number',
      'C4 回包带 snapshotFetch 进度（在线重建、取到 3 行、带完成时刻）', fetch)
    check(net.list > 0, 'C5 这一趟真的向后端取过数', net.list)

    const replayAfter = await replayOf(cRoot)
    check(replayAfter !== null && replayAfter.rows === 3, 'C6 取回来的三行已经写进库', replayAfter && replayAfter.rows)
    check(replayAfter !== null && replayAfter.mergeVersion > 0, 'C7 写库推进了库版本', replayAfter && replayAfter.mergeVersion)

    const listBefore = net.list
    const second: any = await phone.handleSnapshot({ cwd: cRoot, backendId: 'github' })
    const snap2 = snapshotOf(second, adopted)
    check(second && second.ok === true && !!(snap2 && (snap2.issues || []).length === 3), 'C8 同一路径第二次首屏从库出、仍是三行')
    check(net.list === listBefore, 'C9 第二次首屏没有发起任何取数请求（库已经能交付）', { before: listBefore, now: net.list })
    check(!!snap2 && snap2.fromCache === true && !snap2.snapshotFetch, 'C10 库回放的这一份不冒充在线重建（snapshotFetch 为空）', snap2 && snap2.snapshotFetch)

    // 界面怎么表达「正在取数」：加载态那条路用专门的一句文案，而不是空白。
    const listViewSrc = sourceOf('src/client/views/ListTab.ts')
    check(listViewSrc.indexOf("tr('list.fetching')") >= 0, 'C11 首屏加载遮罩说的是「正在取数」那句（list.fetching）')
    const syncSrc = sourceOf('src/refresh/rooms/client/snapshot-sync.ts')
    check(syncSrc.indexOf("if (!hasCache && !st.snapshot && !silent) st.snapMode = 'loading'") >= 0,
      'C12 手上没有数据、也不是静默刷新时一律进加载态（库空要等一趟在线重建，界面不许空白）')
    const flow = sourceOf('config/copy/flow.yaml')
    check(flow.indexOf('list.fetching: 正在取数…') >= 0 && flow.indexOf('list.fetching: Fetching…') >= 0,
      'C13 「正在取数」文案中英两份都在词表里')
    closeSnapshotLibraries()
  } finally {
    try { rmSync(cRoot, { recursive: true, force: true }) } catch (eR) { /* 清理失败不影响结论 */ }
  }

  // ==========================================================================
  // D 首屏预算：合成库 1000 张票，回放 + 投影 + 序列化 ≤ 300 毫秒，零取数
  // ==========================================================================
  const dRoot = makeWorkspace('verify-1893-d-')
  try {
    closeSnapshotLibraries()
    const many: Issue[] = []
    for (let i = 0; i < 1000; i += 1) {
      many.push(issue(String(1000 + i), '合成票 ' + i, {
        state: i % 5 === 0 ? 'closed' : 'open',
        updatedAt: '2026-11-' + String((i % 28) + 1).padStart(2, '0') + 'T00:00:00Z',
      }))
    }
    const seed = await recordIssueRows({ workspaceRoot: dRoot, backend: 'github', repoIdentity: REPO.refId, rows: many, atomic: true })
    check(seed.ok === true && seed.rows === 1000, 'D1 合成库写入 1000 张票（真 SQLite、一个事务）', seed)

    const net: NetCalls = { list: 0, currentUser: 0, openSession: 0, exec: 0, probe: 0 }
    const backend = makeBackend(many, net)
    const libRef = { current: await import('../src/refresh/rooms/host/snapshot-library.ts') }
    const adopted: { snapshot: any } = { snapshot: null }
    const phone = makePhone(dRoot, libRef, backend, net, adopted)

    const t0 = performance.now()
    const reply: any = await phone.handleSnapshot({ cwd: dRoot, backendId: 'github' })
    const snap = snapshotOf(reply, adopted)
    const serialized = JSON.stringify(reply)
    const elapsed = performance.now() - t0
    const bytes = Buffer.byteLength(serialized)

    check(reply && reply.ok === true, 'D2 合成库首屏成功', reply && reply.ok)
    check(!!snap && (snap.issues || []).length === 1000, 'D3 1000 张票全部从库投影出来', snap && (snap.issues || []).length)
    check(net.list === 0 && net.currentUser === 0 && net.openSession === 0 && net.exec === 0,
      'D4 首屏没有发起任何取数请求', net)
    check(elapsed <= FIRST_SCREEN_BUDGET_MS,
      'D5 首屏（含投影与序列化）' + Math.round(elapsed * 10) / 10 + ' 毫秒 ≤ ' + FIRST_SCREEN_BUDGET_MS + ' 毫秒', { elapsedMs: elapsed })
    check(bytes > 1000, 'D6 序列化确实跑了整份回包（' + bytes + ' 字节）', bytes)
    closeSnapshotLibraries()
  } finally {
    try { rmSync(dRoot, { recursive: true, force: true }) } catch (eR) { /* 清理失败不影响结论 */ }
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 回包纯投影门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exitCode = 1
})
