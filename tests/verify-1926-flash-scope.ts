/**
 * tests/verify-1926-flash-scope.ts —— 切换会话时右侧面板整列闪黄（#1926）
 *
 * 守什么（票面「做完」前三条逐条落在这里）：
 *   A 同一时刻不判成变了。同一张票、同一时刻的数据，在线取数给的是后端原样的秒级 ISO
 *     （2026-08-24T01:33:13Z），本机快照库回放给的是 new Date(毫秒).toISOString()（…:13.000Z）。
 *     差异判据比的是「时刻」不是字面：两种写法互比必须一行都不产。
 *   B 真的变了才闪。时间真的往后走时只有那一行产 changed / issueFlash；假时间串（夹具里的
 *     't1' / 't2'）解析不出时刻时退回原文比较，不许为了「同一时刻」把非时间串也当没变。
 *   C 闪烁标记跟着它所属的会话清。清除计时器按会话各排一个：两个会话的标记都清得掉；
 *     同一会话连排两次仍只排一个；没有计时器出口时不粘住旗子。
 *   D 变化集合并那条路同样按时刻判。同一时刻的两种写法并进手上那份不算重画；合并落了闪烁标记
 *     也必须排上清除，否则切回那个会话时那些行又亮一遍。
 *
 * 为什么这么测：这几处都是纯判据（喂数据、看结论），不起浏览器、不依赖真机；真机复验按票面
 * 「做完」第 1、2 条在装好的插件里来回切会话做一次即可。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1926-flash-scope.ts
 */
// 门禁归属: src/refresh/rooms/client/snapshot-sync-helpers.ts
// 门禁归属: src/refresh/rooms/client/snapshot-version-sync.ts
// 门禁归属: src/refresh/rooms/client/snapshot-change-merge.ts
// 门禁归属: src/refresh/rooms/client/refresh-timer.ts
// 门禁归属: src/refresh/rooms/client/probe-scope-selection.ts

import fs from 'node:fs'
import { printGateResult } from './lib/gate-result.ts'
import { idOf } from '../src/tracker/kernel/identity-keys.ts'
import { diffSnapshots, scheduleFlashClear } from '../src/refresh/rooms/client/snapshot-sync-helpers.ts'
import { applySnapshotChangeSet } from '../src/refresh/rooms/client/snapshot-change-merge.ts'
import { runSnapshotVersionTick, rememberSnapshotVersion } from '../src/refresh/rooms/client/snapshot-version-sync.ts'
import { snapshotRowFieldsOf } from '../src/shared/snapshot-row-fields.ts'

const GATE = 'verify-1926-flash-scope'
let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

// 内核片在真闭包里靠拼接拿到邻居（identity-keys、行换算）；门禁单独加载时按仓里惯例挂到 globalThis 上。
;(globalThis as any).idOf = idOf
;(globalThis as any).snapshotRowFieldsOf = snapshotRowFieldsOf

// ── 夹具：两种写法 ────────────────────────────────────────────────────────────
/** 在线取数那一侧：后端原样的秒级 ISO（GitHub 的 updated_at 就长这样）。 */
function onlineIso(ms: number): string { return new Date(ms).toISOString().replace('.000Z', 'Z') }
/** 快照库回放那一侧：new Date(毫秒).toISOString()，毫秒位补足三位。 */
function replayIso(ms: number): string { return new Date(ms).toISOString() }

const T0 = Date.parse('2026-08-24T01:33:13Z')
function ticket(key: string, atMs: number, iso: (ms: number) => string, extra?: any): any {
  return Object.assign({
    key: key, effortId: '', type: 'issue', title: '票 ' + key, state: 'OPEN',
    labels: [], progress: '', claimedBy: '', updatedAt: iso(atMs),
  }, extra || {})
}
/** 一份快照：一张地图 + 两条子票，另有两条根票（未挂图的票）。 */
function snapshotOf(iso: (ms: number) => string, version: string, bump?: { key: string, atMs: number }): any {
  const at = function (key: string): number { return bump && bump.key === key ? bump.atMs : T0 }
  return {
    ok: true, version: version, generatedMs: 1,
    maps: [{
      key: '100', effortId: '', type: 'map', title: '地图', state: 'OPEN', labels: ['wayfinder:map'],
      updatedAt: iso(T0), tickets: [ticket('101', at('101'), iso), ticket('102', at('102'), iso)],
    }],
    issues: [ticket('201', at('201'), iso), ticket('202', at('202'), iso)],
  }
}
const keysOf = (list: any[]): string[] => list.map((one: any): string => String(one).split('\u0000').pop() || '').sort()

// ── A 同一时刻的两种写法不许判成变了 ──────────────────────────────────────────
{
  const online = snapshotOf(onlineIso, 'v-online')
  const replay = snapshotOf(replayIso, 'v-replay')
  const r = diffSnapshots(online, replay)
  check(r.changed.length === 0 && r.added.length === 0 && r.removed.length === 0,
    'A1 同一时刻的两种写法互比：一行都不算变', { changed: keysOf(r.changed), added: r.added })
  check(Object.keys(r.issueFlash).length === 0, 'A2 子票那条路同样按时刻判：不产闪烁标记', r.issueFlash)
  // 反方向也要成立：回放 → 在线
  const back = diffSnapshots(replay, online)
  check(back.changed.length === 0 && Object.keys(back.issueFlash).length === 0,
    'A3 反过来（回放 → 在线）同样一行都不算变', keysOf(back.changed))
}

// ── A 用仓里真实的 GitHub 行再走一遍 ──────────────────────────────────────────
{
  const file = new URL('./tracker-contract/fixtures/github-real/normalized-list.json', import.meta.url)
  const realRows: any[] = JSON.parse(fs.readFileSync(file, 'utf8'))
  // 真实行原样是秒级写法；回放那一侧按同一毫秒换成毫秒级写法，其余字段一个字不动。
  const rowOf = (row: any, iso: ((ms: number) => string) | null): any => ({
    key: String(row.key), effortId: '', type: row.type || 'issue', title: row.title || '',
    state: String(row.state || '').toUpperCase(), labels: row.labels || [],
    progress: '', claimedBy: '',
    updatedAt: iso ? iso(Date.parse(row.updatedAt)) : row.updatedAt,
  })
  const online = { ok: true, version: 'v-real-online', generatedMs: 1, maps: [], issues: realRows.map((row: any): any => rowOf(row, null)) }
  const replay = { ok: true, version: 'v-real-replay', generatedMs: 1, maps: [], issues: realRows.map((row: any): any => rowOf(row, replayIso)) }
  const r = diffSnapshots(online, replay)
  check(realRows.length >= 3, 'A4 真实夹具读得到（' + realRows.length + ' 行）', realRows.length)
  check(r.changed.length === 0 && Object.keys(r.issueFlash).length === 0,
    'A5 真实 GitHub 行（' + realRows.length + ' 行）只换时间写法：一行都不算变', keysOf(r.changed))
}

// ── B 真的变了才闪；解析不出的时间串仍按原文比 ───────────────────────────────
{
  const rootBump = diffSnapshots(snapshotOf(onlineIso, 'v1'), snapshotOf(onlineIso, 'v2', { key: '201', atMs: T0 + 60000 }))
  check(keysOf(rootBump.changed).join(',') === '201', 'B1 根票的时间真的往后走：只有那一行 changed', keysOf(rootBump.changed))
  const childBump = diffSnapshots(snapshotOf(onlineIso, 'v1'), snapshotOf(onlineIso, 'v2', { key: '101', atMs: T0 + 60000 }))
  check(Object.keys(childBump.issueFlash).length === 1 && childBump.issueFlash['101'] === 'changed',
    'B2 子票的时间真的往后走：只有那张子票产闪烁标记', childBump.issueFlash)
  // 夹具风格：'t1' / 't2' 解析不出时刻，必须退回原文比较，否则这一条会被「同一时刻」吞掉。
  const fakeA = snapshotOf(onlineIso, 'v1'); fakeA.issues[0].updatedAt = 't1'
  const fakeB = snapshotOf(onlineIso, 'v1'); fakeB.version = 'v2'; fakeB.issues[0].updatedAt = 't2'
  const fake = diffSnapshots(fakeA, fakeB)
  check(keysOf(fake.changed).join(',') === '201', 'B3 解析不出的时间串（t1 → t2）仍按原文判变', keysOf(fake.changed))
  // 旧契约：内容全同、只推进版本 → 空差异；真同版本 → 短路。
  const same = snapshotOf(onlineIso, 'v1'); const next = snapshotOf(onlineIso, 'v2')
  const empty = diffSnapshots(same, next)
  check(empty.changed.length === 0 && empty.added.length === 0 && empty.removed.length === 0,
    'B4 内容全同、只推进版本：空差异（不误闪）', keysOf(empty.changed))
  check(diffSnapshots(same, JSON.parse(JSON.stringify(same))).skipped === true, 'B5 同版本短路保留')
}

// ── C 清除计时器按会话各排一个 ────────────────────────────────────────────────
{
  const timers: Array<{ fn: () => void, ms: number }> = []
  const emitted: any[] = []
  ;(globalThis as any).timer = { timeout: function (fn: any, ms: number): any { timers.push({ fn: fn, ms: ms }); return function (): void {} } }
  ;(globalThis as any).emit = function (st: any): void { emitted.push(st) }
  ;(globalThis as any).SNAPSHOT_PROBE_MS = 2600
  const sessionA: any = { cwd: 'A', rowFlash: { '101': 'changed' }, issueFlash: { 101: 'changed' } }
  const sessionB: any = { cwd: 'B', rowFlash: { '201': 'changed', '202': 'changed' }, issueFlash: { 201: 'changed' } }
  scheduleFlashClear(sessionA)
  scheduleFlashClear(sessionB)
  check(timers.length === 2, 'C1 两个会话各排一个清除计时器（不是全局共用一个）', timers.length)
  check(timers.length === 2 && timers.every(function (one): boolean { return one.ms === 2600 }), 'C2 停留时长仍取中央那一档', timers.map(function (one): number { return one.ms }))
  timers.forEach(function (one): void { one.fn() })
  check(Object.keys(sessionA.rowFlash).length === 0 && Object.keys(sessionA.issueFlash).length === 0,
    'C3 A 会话的标记到点清空', sessionA.rowFlash)
  check(Object.keys(sessionB.rowFlash).length === 0 && Object.keys(sessionB.issueFlash).length === 0,
    'C4 B 会话的标记同样到点清空（切回去不再亮一遍）', sessionB.rowFlash)
  check(emitted.length === 2 && emitted.indexOf(sessionA) >= 0 && emitted.indexOf(sessionB) >= 0,
    'C5 每个会话清完之后各自重画一次', emitted.length)
  const sessionA2: any = { cwd: 'A2', rowFlash: {}, issueFlash: {} }
  const before = timers.length
  scheduleFlashClear(sessionA2)
  scheduleFlashClear(sessionA2)
  check(timers.length === before + 1, 'C6 同一会话连排两次仍只排一个（不堆积）', timers.length - before)
  // 没有计时器出口：不抛，也不把「已排上」的旗子粘在会话身上。
  ;(globalThis as any).timer = undefined
  let threw = false
  const sessionC: any = { cwd: 'C', rowFlash: { '201': 'changed' }, issueFlash: {} }
  try { scheduleFlashClear(sessionC) } catch (e) { threw = true }
  check(threw === false, 'C7 没有计时器出口时不抛')
  ;(globalThis as any).timer = { timeout: function (fn: any, ms: number): any { timers.push({ fn: fn, ms: ms }); return function (): void {} } }
  const beforeRetry = timers.length
  scheduleFlashClear(sessionC)
  check(timers.length === beforeRetry + 1, 'C8 没有计时器那一趟之后，下一次仍排得上（旗子不粘住）', timers.length - beforeRetry)
}

// ── D 变化集合并那条路：按时刻判，落了标记就排清除 ──────────────────────────
{
  /** 库列表投影的一行（宿主读出来的形状：行字段在 row 里，时间是毫秒数）。 */
  function libraryRow(key: string, atMs: number, extra?: any): any {
    const row = Object.assign({
      type: 'issue', title: '票 ' + key, state: 'open', url: 'https://example.test/' + key,
      createdAtMs: atMs, updatedAtMs: atMs, closedAtMs: null,
    }, (extra && extra.row) || {})
    const complete = { completeness: 'complete' }
    return {
      effortId: '', key: key, row: row, labels: [], assignees: [], parents: [], blockedBy: [],
      subIssues: null, mergedAtMs: null,
      groups: { row: complete, body: null, labels: complete, assignees: complete, parents: complete, blockedBy: complete, subIssues: null, mergeInfo: null },
      placement: { place: 'issue' },
    }
  }
  /** 手上那份快照里的一行（界面形状：时间是在线取数给的秒级 ISO）。 */
  function heldRow(key: string, atMs: number, extra?: any): any {
    return Object.assign({
      key: key, number: Number(key), effortId: '', type: 'issue', title: '票 ' + key, state: 'OPEN',
      url: 'https://example.test/' + key, createdAt: onlineIso(atMs), updatedAt: onlineIso(atMs), closedAt: null,
      parentKey: null, labels: [], assignees: [], blockedBy: [],
    }, extra || {})
  }
  const merge = function (held: any[], changes: any[]): any {
    return applySnapshotChangeSet({ ok: true, maps: [], issues: held, thinTickets: [] }, changes, [], { idOf: idOf, rowFieldsOf: snapshotRowFieldsOf })
  }
  const held = heldRow('201', T0)
  const sameMoment = merge([held], [libraryRow('201', T0)])
  check(sameMoment && sameMoment.redrawn.length === 0, 'D1 同一时刻的两种写法并进手上那份：不算重画', sameMoment && sameMoment.redrawn)
  check(sameMoment && sameMoment.snapshot.issues[0] === held, 'D2 那一行连对象都不换（界面只重画真变了的那几行）', sameMoment && sameMoment.snapshot.issues[0] === held)
  const reallyMoved = merge([held], [libraryRow('201', T0 + 60000)])
  check(reallyMoved && reallyMoved.redrawn.length === 1, 'D3 时间真的往后走：那一行算重画', reallyMoved && reallyMoved.redrawn)
  // 普通文本字段里像日期的串不能被「同一时刻」误伤：'1' 与 '01' 是两个标题，不是同一时刻。
  const titled = merge([heldRow('201', T0, { title: '1' })], [libraryRow('201', T0, { title: '01' })])
  check(titled && titled.redrawn.length === 1, 'D4 标题从 1 改成 01 仍算变（时刻比较不碰普通文本）', titled && titled.redrawn)

  // 合并落了闪烁标记之后必须排上清除：否则标记留在会话身上，切回去那些行又亮一遍。
  const timers: Array<{ fn: () => void, ms: number }> = []
  ;(globalThis as any).timer = { timeout: function (fn: any, ms: number): any { timers.push({ fn: fn, ms: ms }); return function (): void {} } }
  ;(globalThis as any).emit = function (): void {}
  ;(globalThis as any).SNAPSHOT_PROBE_MS = 2600
  ;(globalThis as any).scheduleFlashClear = scheduleFlashClear
  const cwd = 'D:\\ws1926-d'
  const st: any = { cwd: cwd, snapshot: { ok: true, maps: [], issues: [held], thinTickets: [] }, snapMode: 'real', snapLoading: false }
  // 手上那份对应第 5 版；库已经到第 7 版 —— 这一拍走「版本变了取变化集」那条路。
  rememberSnapshotVersion(cwd, 5)
  const scope: any = {
    host: {
      call: function (method: string): any {
        if (method === 'wf.snapshotVersion') return Promise.resolve({ ok: true, version: 7, workspaceKey: cwd, backend: 'github' })
        if (method === 'wf.snapshotChanges') return Promise.resolve({ ok: true, version: 7, workspaceKey: cwd, backend: 'github', full: false, changed: [libraryRow('201', T0 + 60000)], missing: [] })
        return Promise.resolve({ ok: false, error: 'unexpected ' + method })
      },
    },
    wsKeyOf: function (x: any): string { return String(x || '') },
    idOf: idOf,
    emit: function (): void {},
    setCachedSnapshot: function (): void {},
    applyChanges: applySnapshotChangeSet,
    snapshotWithoutWorkRoute: function (snap: any): any { return snap },
    loadOwnWorkRoute: function (): void {},
    installSnapshot: function (): void {},
    log: function (): void {},
    isEnabled: function (): boolean { return false },
  }
  const started = runSnapshotVersionTick(st, 'gate', scope)
  started.then(function (outcome: string): void {
    check(outcome === 'merged', 'D5 一拍走完并合并成功（生产接线过一遍）', outcome)
    check(st.rowFlash && Object.keys(st.rowFlash).length === 1, 'D6 合并后只给真变了的那一行打闪烁标记', st.rowFlash)
    check(timers.length === 1, 'D7 合并落了标记就排上清除计时器（不是留在会话身上不管）', timers.length)
    if (timers.length === 1) timers[0].fn()
    check(!st.rowFlash || Object.keys(st.rowFlash).length === 0, 'D8 到点之后标记自己清掉（切回这个会话不再亮）', st.rowFlash)
    console.log('')
    console.log(failed ? 'FAIL：' + total + ' 条断言里有失败' : 'OK：' + total + ' 条断言全部通过')
    printGateResult(GATE, total, failed)
    process.exit(failed ? 1 : 0)
  }, function (error: any): void {
    check(false, 'D5 一拍走完并合并成功（生产接线过一遍）', String(error && error.message || error))
    console.log('')
    console.log('FAIL：' + total + ' 条断言里有失败')
    printGateResult(GATE, total, failed)
    process.exit(1)
  })
}
