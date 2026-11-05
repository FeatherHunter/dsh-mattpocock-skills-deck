/**
 * tests/verify-1923-closed-container.ts —— 已关闭容器的详情页能看到子票、层级与统计（#1923，规格 #1885 §6 / S6）
 *
 * 守什么（票面五条验收逐条落在这里）：
 *   A 宿主读侧给出容器级投影：真 SQLite 临时库 + 真库句柄，按容器一次读出「容器行 + 全部子票 +
 *     层级 + 统计」。子票含已关闭的那几张、不含别的容器的子票、不含墓碑行；统计与子票逐项对得上。
 *   B 容器级读口是一条宿主电话：回包键集固定、版本与库一致、库里没有这张容器时如实回失败
 *     （不拿空数组冒充「确认一张都没有」）。
 *   C 客户端由视图模型的命令触发一次读取：生产接线 deckViewOf / deckViewCommand + 假宿主电话，
 *     打开已关闭容器只发一条 wf.containerProjection；重复打开同一张不再发；打开开放容器不发
 *     （开放容器的子票仍在首屏投影里）；换另一张已关闭容器只多发一条。
 *   D 首屏体积不变：已关闭容器的子票仍不进首屏（maps[].tickets 为空），容器级回包只在打开时取；
 *     用真字节数把「首屏那一份」与「打开时那一份」分开量出来，并证明后者没有并进前者。
 *   E 视图只渲染切片：页面从 mapDetail 切片取 bucket（子票与统计），文件里没有 host.call /
 *     fetchMapTickets / st.mapTickets；接线层有 loadContainerProjection 端口，宿主入口注册了电话。
 *
 * 为什么能单独跑：宿主读侧用真库（临时目录），客户端用生产接线 + 假宿主电话，不挂 React、不联网。
 * 为什么不用内存替身：统计、层级、墓碑、版本都来自库里的行与边，内存替身盖住库就验不出这几件。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1923-closed-container.ts
 */
// 门禁归属: src/workspace-snapshot/projection/list.ts
// 门禁归属: src/workspace-snapshot/contract/types.ts
// 门禁归属: src/workspace-snapshot/model/types.ts
// 门禁归属: src/workspace-snapshot/runtime/open.ts
// 门禁归属: src/refresh/rooms/host/snapshot-library.ts
// 门禁归属: src/refresh/rooms/host/snapshot-read-channels.ts
// 门禁归属: src/client/kernel/deck-container-detail.ts
// 门禁归属: src/client/kernel/deck-map-detail.ts
// 门禁归属: src/client/kernel/deck-view-model.ts
// 门禁归属: src/client/kernel/deck-view-binding.ts
// 门禁归属: src/client/views/mapDetailV2/view/MapDetailV2Page.ts
// 门禁归属: src/host/index.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type { WorkspaceSnapshotHandle } from '../src/workspace-snapshot/contract/types.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'
import {
  closeSnapshotLibraries,
  readContainerProjection,
  readSnapshotReplay,
} from '../src/refresh/rooms/host/snapshot-library.ts'
import { createSnapshotReadChannels } from '../src/refresh/rooms/host/snapshot-read-channels.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1923-closed-container'

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}
function checkEqual(actual: unknown, expected: unknown, message: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), message, { actual: actual, expected: expected })
}

const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/widgets',
  name: 'acme/widgets',
  url: 'https://github.com/acme/widgets',
}
const NOW = (): number => Date.now()

function issueOf(key: string, extra?: any): Issue {
  return Object.assign({
    key: key,
    effortId: '',
    type: 'issue',
    title: '票 ' + key,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/widgets/issues/' + key,
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

function containerOf(key: string, state: string, extra?: any): Issue {
  return issueOf(key, Object.assign({ type: 'map', state: state, title: '容器 ' + key, labels: [{ name: 'wayfinder:map', color: '8b5cf6' }] }, extra || {}))
}

function makeWorkspace(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix))
  mkdirSync(path.join(root, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'agents', 'workspace.yaml'), 'name: gate-1923\n', 'utf8')
  return root
}

function withHandle<T>(root: string, fn: (handle: WorkspaceSnapshotHandle) => T): T {
  closeSnapshotLibraries()
  const opened = openWorkspaceSnapshot({
    workspaceRoot: root,
    backend: 'github',
    repoIdentity: REPO.refId,
    now: NOW,
    leaseOwner: 'gate-1923-' + Math.random().toString(36).slice(2, 10),
  })
  try {
    return fn(opened.handle)
  } finally {
    try { opened.handle.close() } catch { /* 已关 */ }
  }
}

function writeRows(handle: WorkspaceSnapshotHandle, rows: Issue[]): number {
  const result = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: issueWritesOf(rows, 'github') })
  if (!result.committed) throw new Error('写库失败：' + String(result.reason))
  return result.mergeVersion
}

function keyOf(input: { workspaceRoot: string, backend: string, repoIdentity: string }, key: string) {
  return Object.assign({}, input, { key: key })
}

function phoneFor(root: string): any {
  return createSnapshotReadChannels({
    canonicalKey: async (c: unknown) => String(c),
    selectEarly: async () => ({ backendId: 'github', rev: 1 }),
    isComposerSelection: () => false,
    getTrackerRegistry: async () => ({ describe: () => REPO, modules: () => [], get: () => ({}) }),
    getSnapshotLibrary: async () => ({
      readLibraryVersion: async () => 0,
      readLibraryChangeSet: async () => null,
      readSnapshotCounts: async () => null,
      readContainerProjection: (args: any) => readContainerProjection(args),
    }),
    getRepoKey: async () => ({ owner: 'acme', name: 'widgets' }),
    openSession: async () => null,
    logEvent: () => {},
  })
}

function sourceOf(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

/** 这一份库的固定行：一张已关闭容器（3 张子票）+ 一张开放容器（1 张子票）+ 一张不挂图的票。 */
const LIB = {
  workspaceRoot: '',
  backend: 'github',
  repoIdentity: REPO.refId,
}

function seedRows(): Issue[] {
  return [
    containerOf('700', 'closed'),
    issueOf('701', { parentKey: '700' }),
    issueOf('702', { parentKey: '700', state: 'closed', closedAt: '2026-10-20T00:00:00Z', blockedBy: [{ key: '701', title: '票 701', state: 'open' }],
      url: 'https://github.com/acme/widgets/issues/702?container-projection-only-marker' }),
    issueOf('703', { parentKey: '700', assignees: [{ login: 'alice' }] }),
    containerOf('710', 'open'),
    issueOf('711', { parentKey: '710' }),
    issueOf('800'),
  ]
}

async function main(): Promise<void> {
  const roots: string[] = []
  try {
    // ==================================================================
    // A 宿主读侧：一个容器的行、子票、层级、统计（真库）
    // ==================================================================
    const rootA = makeWorkspace('verify-1923-a-')
    roots.push(rootA)
    const keyA = { workspaceRoot: rootA, backend: 'github', repoIdentity: REPO.refId }
    let versionA = 0
    let listRows: any[] = []
    withHandle(rootA, (handle) => { versionA = writeRows(handle, seedRows()); listRows = handle.readList({ state: 'all' }).issues })

    const a: any = await readContainerProjection(keyOf(keyA, '700'))
    check(!!a && !!a.container, 'A1 按容器读得出容器行（忘了先造一张已关闭容器就会在这里红）', a)
    check(!!a && a.container.key === '700' && a.container.type === 'map' && String(a.container.state).toLowerCase() === 'closed',
      'A2 容器行就是库里那一行（编号 / 种类 / 已关闭状态）', a && a.container)
    const aKeys = (a && a.tickets || []).map((t: any) => String(t.key)).sort()
    checkEqual(aKeys, ['701', '702', '703'], 'A3 子票是这张容器的全部三张（含已关闭的 702）')
    check(!!a && a.tickets.length === 3 && String(a.tickets.filter((t: any) => String(t.key) === '702')[0].state).toLowerCase() === 'closed',
      'A4 已关闭的子票照样交出来（不能只交开放的那几张）', a && a.tickets.map((t: any) => [t.key, t.state]))
    check(!!a && a.stats && a.stats.total === 3 && a.stats.open === 2 && a.stats.closed === 1 && a.stats.claimed === 1,
      'A5 统计由这批子票算出（共 3 / 开 2 / 关 1 / 已认领 1）', a && a.stats)
    const levels = a && a.stats && a.stats.levels
    const levelCount = Array.isArray(levels) ? levels.reduce((sum: number, lv: any) => sum + (Array.isArray(lv.numbers) ? lv.numbers.length : 0), 0) : -1
    const everyLeveled = !!a && a.tickets.every((t: any) => typeof t.level === 'number')
    check(Array.isArray(levels) && levels.length >= 1 && levelCount === 3 && everyLeveled,
      'A6 层级随统计一起给出（三层号覆盖三张子票，每张子票带 level）', { levels: levels, levelCount: levelCount, everyLeveled: everyLeveled })
    check(!!a && a.tickets.every((t: any) => String(t.key) !== '800'), 'A7 不属于这张容器的票（800）不混进来')
    const child702 = a && a.tickets.filter((t: any) => String(t.key) === '702')[0]
    check(!!child702 && Array.isArray(child702.blockedBy) && child702.blockedBy.map(String).join(',') === '701',
      'A8 子票的阻塞边原样带出来（702 被 701 挡着）', child702 && child702.blockedBy)

    const spec: any = await readContainerProjection(keyOf(keyA, '710'))
    check(!!spec && spec.tickets.length === 1 && String(spec.tickets[0].key) === '711',
      'A9 另一张容器只读出它自己的那一张子票（按父子边取，不跨容器）', spec && spec.tickets.map((t: any) => t.key))

    // 墓碑行不进容器详情：703 被判不存在之后，它也不该再出现在子票里。
    withHandle(rootA, (handle) => {
      const marked = handle.markMissing([{ effortId: '', key: '703' }], handle.getMergeVersion())
      if (!marked.committed) throw new Error('墓碑没写进去：' + String(marked.reason))
    })
    const afterTomb: any = await readContainerProjection(keyOf(keyA, '703'))
    check(afterTomb !== null, 'A10 墓碑不影响这一读口本身')
    const tombDetail: any = await readContainerProjection(keyOf(keyA, '700'))
    check(!!tombDetail && tombDetail.tickets.map((t: any) => String(t.key)).sort().join(',') === '701,702',
      'A11 被墓碑标记的子票不再出现在容器详情里', tombDetail && tombDetail.tickets.map((t: any) => t.key))

    // ==================================================================
    // B 容器级读口：一条宿主电话，回包键集与版本
    // ==================================================================
    const rootB = makeWorkspace('verify-1923-b-')
    roots.push(rootB)
    const keyB = { workspaceRoot: rootB, backend: 'github', repoIdentity: REPO.refId }
    let versionB = 0
    withHandle(rootB, (handle) => { versionB = writeRows(handle, seedRows()) })
    const phone = phoneFor(rootB)
    const reply: any = await phone.handleContainerProjection({ cwd: rootB, key: '700' })
    check(reply && reply.ok === true, 'B1 已关闭容器的容器级读取成功', reply && reply.ok)
    check(reply && Object.keys(reply).sort().join(',') === 'backend,container,ok,stats,tickets,version,workspaceKey',
      'B2 回包键集固定（容器行、子票、统计、版本、工作区键、后端）', reply && Object.keys(reply).sort())
    check(reply && reply.version === versionB && reply.version > 0, 'B3 回包版本就是库里的合并版本', reply && { got: reply.version, want: versionB })
    check(reply && reply.workspaceKey === rootB && reply.backend === 'github', 'B4 工作区键与后端与别的读口同一口径', reply && { ws: reply.workspaceKey, backend: reply.backend })
    check(reply && reply.tickets.length === 3 && reply.stats.total === 3 && Array.isArray(reply.stats.levels) && reply.stats.levels.length >= 1,
      'B5 一次电话就交齐子票、层级与统计（不是零散多次）', reply && { tickets: reply.tickets.length, stats: reply.stats })
    check(reply && reply.container && reply.container.key === '700', 'B6 回包里的容器行与子票同一次读出', reply && reply.container)
    const missing: any = await phone.handleContainerProjection({ cwd: rootB, key: '999' })
    check(missing && missing.ok === false && missing.errorKind === 'library' && missing.reason === 'container-not-in-library',
      'B7 库里没有这张容器时如实回失败（不拿空数组冒充「确认一张都没有」）', missing)
    const noKey: any = await phone.handleContainerProjection({ cwd: rootB })
    check(noKey && noKey.ok === false && noKey.errorKind === 'env', 'B8 没给容器编号时回环境错误，不去库里瞎猜', noKey)

    // 首屏字节数：同一张已关闭容器，子票在不在库里，首屏那一份都不带它们的完整行。
    const fullSnap: any = await readSnapshotReplay(Object.assign({ repo: REPO }, keyB))
    const closedMapRow = fullSnap && fullSnap.snapshot.maps.filter((m: any) => String(m.key) === '700')[0]
    check(!!fullSnap && !!closedMapRow && Array.isArray(closedMapRow.tickets) && closedMapRow.tickets.length === 0,
      'D1 首屏投影里已关闭容器的子票仍为空（§6 的收窄没有被本票放宽）', closedMapRow && closedMapRow.tickets)
    const firstScreenBytes = bytesOf(fullSnap.snapshot)
    const containerBytes = bytesOf(reply)
    check(LIB && firstScreenBytes > 0 && containerBytes > 0 && containerBytes < firstScreenBytes,
      'D2 首屏一份与打开时那一份分开量：首屏 ' + firstScreenBytes + ' 字节，容器级回包 ' + containerBytes + ' 字节（后者只在打开时取）')
    const screenText = JSON.stringify(fullSnap.snapshot)
    check(screenText.indexOf('container-projection-only-marker') < 0, 'D3 已关闭子票的完整字段（地址）不进首屏那一份（首屏只为它留瘦身行）')
    check(JSON.stringify(reply).indexOf('container-projection-only-marker') >= 0,
      'D4 同一张子票的完整字段只在容器级回包里出现（打开它才取）')
    // 假设把子票并进首屏会有多大：用同一份首屏把容器行填满再序列化一次，只作对比，不改任何代码路径。
    const hypothetical = JSON.parse(JSON.stringify(fullSnap.snapshot))
    const hypoMap = hypothetical.maps.filter((m: any) => String(m.key) === '700')[0]
    hypoMap.tickets = reply.tickets
    hypoMap.stats = reply.stats
    const mergedBytes = bytesOf(hypothetical)
    check(mergedBytes > firstScreenBytes,
      'D5 如果把子票并进首屏，体积会从 ' + firstScreenBytes + ' 涨到 ' + mergedBytes + ' 字节（+' + (mergedBytes - firstScreenBytes) + '）；本票选择不并')

    // ==================================================================
    // C 客户端：视图模型的命令触发一次容器级读取，视图只读切片
    // ==================================================================
    const dash = await import('../src/client/kernel/deck-view-model.ts')
    const mapDetail: any = await import('../src/client/kernel/deck-map-detail.ts')
    const containerKernel: any = await import('../src/client/kernel/deck-container-detail.ts')
    const identity: any = await import('../src/tracker/kernel/identity-keys.ts')
    const storeDerived: any = await import('../src/client/kernel/store-derived.ts')
    ;(globalThis as any).idOf = identity.idOf
    ;(globalThis as any).idOfParts = identity.idOfParts
    ;(globalThis as any).effortOf = identity.effortOf
    ;(globalThis as any).refKeyOf = identity.refKeyOf
    ;(globalThis as any).findMapByIdentity = storeDerived.findMapByIdentity
    ;(globalThis as any).createDeckView = dash.createDeckView
    ;(globalThis as any).deckFiltersOf = dash.deckFiltersOf
    ;(globalThis as any).deckReadingOf = dash.deckReadingOf
    ;(globalThis as any).deckMapDetailOf = mapDetail.deckMapDetailOf
    ;(globalThis as any).deckContainerDetailOfStore = containerKernel.deckContainerDetailOfStore
    ;(globalThis as any).containerProjectionLoadOf = containerKernel.containerProjectionLoadOf
    ;(globalThis as any).log = function (): void {}
    ;(globalThis as any).emit = function (): void {}
    ;(globalThis as any).dswsLogHash = function (s: any): string { return String(s) }
    ;(globalThis as any).dswsLogTrunc = function (s: any): string { return String(s) }
    // 独立 import 本文件时闭包里没有 api-io 的那个出口；这一档只验取数流与切片，失败形态给一个同形的假。
    ;(globalThis as any).dswsNormalizeError = function (input: any, fallback: any): any {
      const o = (input && typeof input === 'object') ? input : null
      const text = o ? String(o.error || o.message || '') : String(input || '')
      return { kind: (o && o.kind) || 'network', message: text || String(fallback || ''), raw: text }
    }
    ;(globalThis as any).wsKeyOf = function (k: any): string { return String(k || '') }

    const binding: any = await import('../src/client/kernel/deck-view-binding.ts')

    const phoneCalls: any[] = []
    const makeHost = function (): any {
      return { call: function (method: string, args: any): any {
        phoneCalls.push({ method: method, args: args })
        if (method !== 'wf.containerProjection') return Promise.resolve({ ok: false, error: '不该发这条电话' })
        return Promise.resolve(reply)
      } }
    }
    let host = makeHost()
    ;(globalThis as any).host = host
    let currentVersion = reply.version
    const scope: any = {
      host: host,
      fetchContainerProjection: containerKernel.fetchContainerProjection,
      findMapByIdentity: storeDerived.findMapByIdentity,
      idOfParts: identity.idOfParts,
      wsKeyOf: function (k: any): string { return String(k || '') },
      snapshotVersionBookOf: function (): any { return { version: currentVersion, seenAtMs: 0 } },
      ticketRowsOf: function (a: any): any[] { return a || [] },
      issuePageRowsOf: function (): any[] { return [] },
      isOccupied: function (): boolean { return false },
      occCount: function (): number { return 0 },
      deckCountsOf: function (): any { return null },
      bugCount: function (): number { return 0 },
      triageCount: function (): number { return 0 },
      kpiCountsOf: function (): any { return { takeable: 0, closed: 0, unknown: false, pending: false, atMs: 0, source: 'local-enumeration' } },
      listPrefs: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' },
      saveListPrefs: function (): void {},
      peekNav: function (): any { return null },
      detailViewFor: function (): any { return null },
      snapshotRowFor: function (): any { return null },
      projectionUsesSnapshot: function (): boolean { return true },
    }

    /** 首屏快照的形状：容器与子票行都按宿主投影那份（已关闭容器的 tickets 为空）。 */
    function projectionOf(): any {
      return fullSnap.snapshot
    }

    const baseState = function (): any {
      return {
        cwd: rootB, snapshot: projectionOf(), sessionId: 's1', navStack: [],
        stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false,
        activeMap: 700, activeEffortId: '', cmtDraft: '', mapTickets: { stale: { mode: 'real', items: [{ key: '999' }] } },
      }
    }

    containerKernel.deckForgetContainerProjections()
    binding.deckViewForgetFrames()
    const st: any = baseState()
    binding.deckViewOf(st, scope)
    await new Promise(function (r: any): any { setTimeout(r, 0) })
    // 取回之后页面会重渲染一次（useDeckViewSlice 再调 deckViewOf）；这里照真机那一步再采一次。
    let view: any = binding.deckViewOf(st, scope)
    const containerCalls = function (): any[] { return phoneCalls.filter(function (p: any): boolean { return p.method === 'wf.containerProjection' }) }
    check(containerCalls().length === 1, 'C1 打开已关闭容器只发一条 wf.containerProjection（视图模型的命令触发，不是视图的 effect）', phoneCalls.map((p: any) => p.method))
    check(phoneCalls.every(function (p: any): boolean { return p.method !== 'wf.mapTickets' }), 'C2 老路 wf.mapTickets 一条都没发')
    let detail: any = view.slice('mapDetail')
    check(detail && detail.source === 'container' && detail.bucket && detail.bucket.mode === 'real',
      'C3 切片的来源是容器级读取（bucket 已就绪）', detail && { source: detail.source, mode: detail.bucket && detail.bucket.mode })
    check(detail && detail.tickets.map((t: any) => String(t.key)).sort().join(',') === '701,702,703' && detail.stats.total === 3,
      'C4 切片里能看到全部子票与统计', detail && { tickets: detail.tickets.map((t: any) => t.key), stats: detail.stats })
    const sliceStates = detail.tickets.map(function (t: any): any { return [String(t.key), String(t.state).toUpperCase()] })
    const listStates = listRows.filter(function (row: any): boolean { return ['701', '702', '703'].indexOf(String(row.key)) >= 0 })
      .map(function (row: any): any { return [String(row.key), String(row.row.state).toUpperCase()] }).sort()
    checkEqual(sliceStates.slice().sort(), listStates, 'C5 同一版本下，已关闭容器里的子票状态与列表对同一张票的状态逐张相等')

    binding.deckViewCommand(st, 'openMap', { number: 700, effortId: '' }, scope)
    binding.deckViewCommand(st, 'openMap', { number: 700, effortId: '' }, scope)
    view = binding.deckViewOf(st, scope)
    check(containerCalls().length === 1, 'C6 重复打开同一张已关闭容器不再发读取（一条容器级读取只发一次）', containerCalls().length)

    binding.deckViewCommand(st, 'openMap', { number: 710, effortId: '' }, scope)
    view = binding.deckViewOf(st, scope)
    detail = view.slice('mapDetail')
    check(containerCalls().length === 1, 'C7 打开开放容器不发容器级读取（它的子票仍在首屏投影里）', containerCalls().length)
    check(detail && detail.source === 'projection' && detail.tickets.map((t: any) => String(t.key)).join(',') === '711',
      'C8 开放容器的详情照旧从投影取（711 一张）', detail && { source: detail.source, tickets: detail.tickets.map((t: any) => t.key) })

    // 再造一张已关闭容器，打开它只多发一条，而不是零散多次。
    withHandle(rootB, (handle) => { versionB = writeRows(handle, [containerOf('720', 'closed'), issueOf('721', { parentKey: '720' })]) })
    currentVersion = versionB
    const reply720: any = await phone.handleContainerProjection({ cwd: rootB, key: '720' })
    host = { call: function (method: string, args: any): any {
      phoneCalls.push({ method: method, args: args })
      if (method !== 'wf.containerProjection') return Promise.resolve({ ok: false, error: '不该发这条电话' })
      return Promise.resolve(String(args && args.key) === '720' ? reply720 : reply)
    } }
    ;(globalThis as any).host = host
    scope.host = host
    binding.deckViewForgetFrames()
    const st2: any = baseState()
    st2.snapshot = Object.assign({}, projectionOf(), { maps: projectionOf().maps.concat([containerOf('720', 'closed')]) })
    binding.deckViewOf(st2, scope)
    // 版本变了：恢复/重渲染那一趟会为当前打开的那张（700）补一次读取；先让它跑完，再量「换一张」的增量。
    await new Promise(function (r: any): void { setTimeout(r, 0) })
    const beforeNew = containerCalls().length
    binding.deckViewCommand(st2, 'openMap', { number: 720, effortId: '' }, scope)
    await new Promise(function (r: any): void { setTimeout(r, 0) })
    const calls720 = containerCalls().filter(function (p: any): boolean { return String(p.args && p.args.key) === '720' })
    check(containerCalls().length === beforeNew + 1 && calls720.length === 1,
      'C9 打开另一张已关闭容器只多发一条容器级读取', { before: beforeNew, after: containerCalls().length, calls720: calls720.length })
    // 新的版本与新的容器：命令可以把版本一起带下去（供排查对账）。
    check(containerCalls().every(function (p: any): boolean { return p.args && String(p.args.key) !== '' }), 'C10 每条容器级电话都点名要哪一张容器')

    // 纯视图模型：命令确实喊了端口（取数在接线层，模型自己不发电话）。
    const portCalls: any[] = []
    const pure = dash.createDeckView({
      frame: { key: 'ws|1', version: 1, projection: { maps: [], issues: [] }, counts: null, readout: null },
      reading: { activeMap: null },
      ports: { loadContainerProjection: function (payload: any): any { portCalls.push(payload); return null } },
    })
    pure.command('openMap', { number: 700, effortId: 'e1' })
    pure.command('openMap', { number: 700, effortId: 'e1' })
    check(portCalls.length === 2 && portCalls[0].number === 700 && portCalls[0].effortId === 'e1',
      'C11 openMap 命令把「要看哪张容器」交给接线端口（模型不自己发电话，端口负责判要不要取）', portCalls)

    // C12：本地 Markdown 的容器编号补零（'00'），阅读态里是数字 0；桶键必须按投影里那一行的规范键取。
    const zeroSt: any = { cwd: 'D:/ws/md', snapshot: { maps: [{ key: '00', number: 0, effortId: '', state: 'CLOSED' }] }, containerProjection: {} }
    const zeroBucket: any = { mode: 'real', key: '00', effortId: '', items: [{ key: '01', state: 'OPEN' }], stats: { total: 1 } }
    zeroSt.containerProjection[containerKernel.deckContainerProjectionKeyOf(scope, zeroSt, '', '00')] = zeroBucket
    check(containerKernel.deckContainerDetailOfStore(scope, zeroSt, { activeMap: 0, activeMapEffort: '' }) === zeroBucket,
      'C12 补零编号的容器按投影里的规范键取桶（数字 0 与 \'00\' 指向同一张，不能各存一个桶）')

    // ==================================================================
    // E 视图只读切片、宿主入口注册了电话
    // ==================================================================
    const page = sourceOf('src/client/views/mapDetailV2/view/MapDetailV2Page.ts')
    check(page.indexOf("useDeckViewSlice(st, 'mapDetail')") >= 0 && page.indexOf('detail.bucket') >= 0 && page.indexOf('detail.stats') >= 0,
      'E1 页面从 mapDetail 切片取 bucket 与 stats（子票卡片与统计都走切片）')
    // 只看代码形状：注释里写「不再读 st.mapTickets」不算直连。
    const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check(pageCode.indexOf('st.mapTickets') < 0 && pageCode.indexOf('host.call') < 0 && pageCode.indexOf('fetchMapTickets') < 0,
      'E2 视图文件里没有直连宿主取数的老路（代码里不读 st.mapTickets、不发电话）', { mapTickets: pageCode.indexOf('st.mapTickets'), hostCall: pageCode.indexOf('host.call') })
    const bindingSrc = sourceOf('src/client/kernel/deck-view-binding.ts')
    check(bindingSrc.indexOf('loadContainerProjection') >= 0 && bindingSrc.indexOf('deckContainerDetailOfStore') >= 0,
      'E3 接线层提供容器级投影的端口，并把取回的桶交给切片')
    const modelSrc = sourceOf('src/client/kernel/deck-view-model.ts')
    check(modelSrc.indexOf('loadContainerProjection') >= 0 && modelSrc.indexOf("name === 'openMap'") >= 0,
      'E4 视图模型的 openMap 命令喊容器级读取端口')
    const hostSrc = sourceOf('src/host/index.ts')
    check(hostSrc.indexOf("'wf.containerProjection'") >= 0 && hostSrc.indexOf('handleContainerProjection') >= 0,
      'E5 宿主入口注册了容器级投影电话')
    const selectorSrc = sourceOf('src/client/kernel/deck-map-detail.ts')
    check(selectorSrc.indexOf('containerDetail') >= 0 && selectorSrc.indexOf('bucket') >= 0,
      'E6 地图详情选择器把容器级读取的桶与统计接进切片')
    const libSrc = sourceOf('src/refresh/rooms/host/snapshot-library.ts')
    check(libSrc.indexOf('readContainerProjection') >= 0, 'E7 快照库门面有按容器读的口')
    const projSrc = sourceOf('src/workspace-snapshot/projection/list.ts')
    check(projSrc.indexOf('readContainerProjection') >= 0, 'E8 库的列表投影有按父子边取子票的实现')
  } finally {
    closeSnapshotLibraries()
    for (const root of roots) { try { rmSync(root, { recursive: true, force: true }) } catch (e) { /* 清理失败不影响结论 */ } }
  }

  console.log('')
  console.log(failed === 0 ? '全部通过（' + total + ' 项）' : ('失败 ' + failed + ' / ' + total + ' 项'))
  printGateResult(GATE, total, failed)
}

try {
  await main()
} catch (e: any) {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  failed += 1
} finally {
  try { closeSnapshotLibraries() } catch { /* 已关 */ }
}
process.exit(failed === 0 ? 0 : 1)
