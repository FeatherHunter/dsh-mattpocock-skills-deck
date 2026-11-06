/**
 * tests/verify-1891-version-sync.ts —— 客户端只按库版本取变化（#1891，规格 #1885 S4）
 *
 * 守什么（票面五条验收逐条落在这里）：
 *   A 同一版本不取：手上那份的库版本与最新的库版本相同，连续两拍一条数据都不取（只有版本读数本身）。
 *   B 改了才取变化集：版本变了取一次变化集；回包只给变化行与墓碑；并进手上那份时只有变化的那一行
 *     换了对象，其余行连对象都没换 —— 这就是「界面只重画那一行、回包里不出现整份快照」。
 *   C 版本回退（文件被旧拷贝覆盖、库重建）：整份重取并把本地版本重置成「不知道」，旧行一行都不残留。
 *   D 落后超过上限（宿主回 full）：退回整份重取，装上去照常渲染。
 *   E 连续多笔变化合并成一次读取：同一拍里连发的几笔只读一次；读取在途时再来的几笔也只多读一次。
 *   F 信号源可替换：轮询实现（按间隔问版本）与事件实现（推送到达时交版本）实现同一份接口，
 *     同一个同步引擎都能接，结论一致；取消订阅会把定时器停掉。
 *   G 生产接线：每一拍先问 wf.snapshotVersion；版本变了才问 wf.snapshotChanges；这一路不取 wf.snapshot；
 *     只给变化的那几行打闪烁标记；版本相同的一拍一次数据读取都没有；变化集回包若带了整份快照也不采信。
 *   H 304 与水合胜负按版本判：胜者是「库版本更新」，不知道版本不算更新；缓存层不再按生成时刻比胜负，
 *     304 把新鲜度交给版本同步，探测回包里的整份快照退场。
 *
 * 为什么这么测：版本、变化集、合并都是纯数据，直接喂假信号源与假宿主电话就能把外部行为钉死；
 * 不起浏览器、不断言内部调用顺序，只数「取了几次数据」「哪几行换了对象」。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1891-version-sync.ts
 */
// 门禁归属: src/refresh/rooms/client/snapshot-version-sync.ts
// 门禁归属: src/refresh/rooms/client/snapshot-cache-store.ts
// 门禁归属: src/refresh/rooms/client/snapshot-sync.ts
// 门禁归属: src/refresh/rooms/client/refresh-timer.ts

import { printGateResult } from './lib/gate-result.ts'
import { sourceText, spliceableJs } from './lib/source-text.ts'
import { idOf } from '../src/tracker/kernel/identity-keys.ts'
import { applySnapshotChangeSet, isNewerSnapshotVersion } from '../src/refresh/rooms/client/snapshot-change-merge.ts'
// #1885 评审修复：行换算与宿主共用一份（src/shared/snapshot-row-fields.ts）；直接 import 客户端片时显式递进去。
import { snapshotRowFieldsOf } from '../src/shared/snapshot-row-fields.ts'
import { compileFn } from './lib/eval-probe.ts'
import { SEL_WAIT_MS } from '../src/shared/time-config/src/values.js'
import {
  createPollingVersionSource,
  createSnapshotVersionSync,
  rememberSnapshotVersion,
  runSnapshotVersionTick,
  snapshotVersionBookOf,
} from '../src/refresh/rooms/client/snapshot-version-sync.ts'

// 生产闭包里这份换算由构建拼进来；门禁单独求值各片时按仓里惯例挂到 globalThis 上。
;(globalThis as any).snapshotRowFieldsOf = snapshotRowFieldsOf

const GATE = 'verify-1891-version-sync'

let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

/** 去掉注释与字符串里的内容：只按代码形状判「这句还在不在」，注释里提到旧写法不算数。 */
function codeOnly(source: string): string {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/** 等几轮微任务 + 一个宏任务：同步引擎的合并窗口用的是微任务，催一拍之后靠它落地。 */
function settle(): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, 0) })
}

/** 客户端手上的一行（界面形状：状态大写、时间是 ISO 串）。 */
function row(key: string, title: string, state?: string): any {
  return {
    key: key, number: Number(key), effortId: '', type: 'issue', title: title, state: state || 'OPEN',
    url: 'https://example.test/' + key, createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z', closedAt: null, parentKey: null,
    labels: [], assignees: [], blockedBy: [],
  }
}

/** 客户端手上那份快照的形状（组装器的输出：maps 带 tickets、issues 是未挂图的票）。 */
function snapshotOf(issues: any[], maps?: any[]): any {
  return { ok: true, version: 'content-hash', maps: maps || [], issues: issues, thinTickets: [] }
}

/** 库这一侧一行的组三态：complete 才不会把「不知道」当成「确认没有」。 */
function groupOk(): any {
  return { completeness: 'complete', reason: null, source: 'gate', operation: 'read', lastQueriedMs: 1 }
}

/** 变化集里的一行（库列表投影的形状）。只给这一份，不给整份快照。 */
function listRow(key: string, patch?: any): any {
  const p = patch || {}
  return {
    effortId: '', key: key,
    row: {
      type: p.type || 'issue', title: p.title || ('票 ' + key), state: p.state || 'open',
      url: 'https://example.test/' + key, createdAtMs: 1,
      updatedAtMs: p.updatedAtMs === undefined ? 2 : p.updatedAtMs,
      closedAtMs: null, stateReason: null, isPullRequest: false, commentCount: 0,
      milestoneJson: null, customFieldsJson: null, status: null, statusVisible: null,
      statusSource: null, statusConflictJson: null,
    },
    labels: p.labels || [], assignees: [], parents: [], blockedBy: [], subIssues: null, mergedAtMs: null,
    groups: {
      row: groupOk(), body: null,
      labels: p.labels ? groupOk() : null, assignees: null, parents: null,
      blockedBy: null, subIssues: null, mergeInfo: null,
    },
  }
}

/**
 * 一副假的门面：手上那份（快照 + 库版本）、三条门口（取变化集、整份重取、并进手上那份）。
 * 与生产接线一样，merge 走真的 applySnapshotChangeSet —— 合并本身是这一票的重点，不拿替身糊过去。
 */
function makeRun(initial: { snapshot: any, version: number | null }): any {
  const store: any = {
    snapshot: initial.snapshot,
    book: { version: initial.version, seenAtMs: 0 },
    heldLog: [] as Array<number | null>,
    redrawn: [] as string[],
    removed: [] as string[],
  }
  const calls: any = { changes: 0, full: 0, lastChanges: null, reasons: [] as string[] }
  let changesReply: any = null
  let fullReply: any = null
  let gate: Promise<void> | null = null

  const ports: any = {
    held: function (): any { return store.book },
    setHeld: function (next: any): void {
      store.book = { version: next.version, seenAtMs: next.seenAtMs }
      store.heldLog.push(store.book.version)
    },
    changes: async function (input: any): Promise<any> {
      calls.changes += 1
      calls.lastChanges = input
      if (gate) { const g = gate; gate = null; await g }
      return typeof changesReply === 'function' ? changesReply(input) : changesReply
    },
    full: async function (input: any): Promise<any> {
      calls.full += 1
      calls.reasons.push(input.reason)
      const reply = typeof fullReply === 'function' ? fullReply(input) : fullReply
      if (!reply) return null
      store.snapshot = reply.snapshot
      return { version: reply.version }
    },
    merge: function (input: any): any {
      const out = applySnapshotChangeSet(store.snapshot, input.reply.changed, input.reply.missing, { idOf: idOf, rowFieldsOf: snapshotRowFieldsOf })
      if (!out) return null
      store.snapshot = out.snapshot
      store.redrawn = out.redrawn
      store.removed = out.removed
      return { version: input.reply.version }
    },
    now: function (): number { return 5000 },
    log: function (): void {},
  }

  return {
    store: store, calls: calls, ports: ports,
    sync: createSnapshotVersionSync(ports),
    setChanges: function (fn: any): void { changesReply = fn },
    setFull: function (fn: any): void { fullReply = fn },
    hold: function (promise: Promise<void>): void { gate = promise },
  }
}


/**
 * 真的 _snapInstallBody：把客户端那一片按构建同一口径转译后、在 with(scope) 里求值取出来。
 *
 * 为什么不用替身：这一组要证的正是「装之前比库版本」这条守卫本身（#1931）；换成替身等于把要证的
 * 结论写进替身。闭包邻居（缓存落表、补标签颜色、开始探测…）在这里全是空的替身，只保留一个真的：
 * snapshotVersionBookOf —— 守卫问它「手上那份是第几版」。
 */
function loadInstallBody(): any {
  const src = spliceableJs('src/refresh/rooms/client/probe-scope-selection.js')
    .split('\n')
    .filter(function (line: string): boolean { return !/^\s*import\s.*time-config\/values\.js/.test(line) })
    .join('\n')
  const scope: Record<string, any> = {
    SEL_WAIT_MS: SEL_WAIT_MS,
    snapshotVersionBookOf: function (cwd: any): any { return snapshotVersionBookOf(cwd) },
    host: { call: function (method: string): any { return Promise.resolve({ ok: false, error: 'stub ' + method }) } },
    wsKeyOf: function (x: any): string { return String(x || '') },
    isEnabled: function (): boolean { return false },
    log: function (): void {},
    dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
    dswsLogTrunc: function (s: any): string { return String(s || '').slice(0, 120) },
    mergeSelection: function (): boolean { return false },
    workspaceRootByCwd: function (): any { return null },
    keyOf: function (x: any): string { return String(x || '') },
    _snapRespStale: function (): boolean { return false },
    _snapRequestKeyWas: function (): boolean { return true },
    emit: function (): void {},
    _flushDeferredChain: function (): void {},
    setCachedRepository: function (): void {},
    setCachedSnapshot: function (): void {},
    getCachedSnapshot: function (): any { return null },
    applySnapshotSelection: function (): void {},
    startAutoProbe: function (): void {},
    setPresentationMap: function (): void {},
    scheduleFlashClear: function (): void {},
    flash: function (): void {},
    tr: function (k: any): string { return String(k) },
    diffSnapshots: function (): any { return { added: [], changed: [], removed: [], issueFlash: {} } },
    lcApplySavedColorsOnInstall: function (): void {},
  }
  const body = 'with (scope) {\n' + src + '\n; return { install: _snapInstallBody }\n}'
  return compileFn(['scope'], body)(scope).install
}

/** 带数字库版本的一份快照（守卫只认非负整数版本；内容散列那种字符串版本一律跳过守卫）。 */
function snapshotAt(version: number, issues: any[]): any {
  return { ok: true, version: version, maps: [], issues: issues, thinTickets: [] }
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------- A 同一版本不取
  {
    const run = makeRun({ snapshot: snapshotOf([row('1', '甲'), row('2', '乙')]), version: null })
    run.setFull(function (): any { return { snapshot: snapshotOf([row('1', '甲'), row('2', '乙')]), version: 5 } })
    const out1 = await run.sync.notify({ ok: true, version: 5 })
    check(out1 === 'full', 'A1 手上没有基线时先整份重取一次', out1)
    check(run.calls.full === 1 && run.calls.changes === 0, 'A2 没有基线那一次只整份取，不问变化集', run.calls)
    const out2 = await run.sync.notify({ ok: true, version: 5 })
    const out3 = await run.sync.notify({ ok: true, version: 5 })
    check(out2 === 'skipped' && out3 === 'skipped', 'A3 同一版本连续两拍都不动作（结论是跳过）', [out2, out3])
    check(run.calls.changes === 0 && run.calls.full === 1, 'A4 内容没变时连续两拍不产生任何数据读取', run.calls)
  }

  // ---------------------------------------------------------------- B 改了才取变化集、只重画那一行
  {
    const a = row('1', '甲')
    const b = row('2', '乙')
    const c = row('3', '丙')
    const before = snapshotOf([a, b, c])
    const run = makeRun({ snapshot: before, version: 5 })
    run.setChanges(function (): any {
      return { ok: true, version: 6, full: false, changed: [listRow('2', { title: '乙（改过）', state: 'closed' })], missing: [] }
    })
    const out = await run.sync.notify({ ok: true, version: 6 })
    check(out === 'merged', 'B1 版本变了 → 取变化集并进手上那份', out)
    check(run.calls.changes === 1 && run.calls.lastChanges.sinceVersion === 5, 'B2 变化集按「手上那份的版本」要，只取一次', run.calls.lastChanges)
    check(run.calls.lastChanges.seenAtMs === 0, 'B3 顺手交上「看到那个版本的时刻」，只给落后降级那一档用', run.calls.lastChanges)
    const after = run.store.snapshot
    check(after.issues[0] === a && after.issues[2] === c, 'B4 没有变化的两行原样留着（连对象都没换）')
    check(after.issues[1] !== b && after.issues[1].title === '乙（改过）', 'B5 变化的那一行就地换内容', after.issues[1])
    check(after.issues[1].state === 'CLOSED', 'B6 状态按界面口径写成大写 CLOSED', after.issues[1].state)
    check(after.issues.length === 3, 'B7 变化集回包里没有整份快照，票数不变（不是整份替换）', after.issues.length)
    check(run.store.redrawn.length === 1 && run.store.redrawn[0] === idOf(b), 'B8 重画名单只有变化的那一行', run.store.redrawn)
    check(run.store.book.version === 6, 'B9 本地版本推进到回包里的版本', run.store.book)

    const run2 = makeRun({ snapshot: snapshotOf([a, b, c]), version: 6 })
    run2.setChanges(function (): any {
      return { ok: true, version: 7, full: false, changed: [], missing: [{ effortId: '', key: '3', deletedAtMs: 9 }] }
    })
    const out2 = await run2.sync.notify({ ok: true, version: 7 })
    check(out2 === 'merged' && run2.store.snapshot.issues.length === 2, 'B10 墓碑行让那一行从手上那份消失', run2.store.snapshot.issues.map(function (x: any): string { return x.key }))
    check(run2.store.removed.length === 1 && run2.store.removed[0] === idOf(c), 'B11 删掉的那一行进重画名单（界面据此拿掉它）', run2.store.removed)
  }

  // ---------------------------------------------------------------- C 版本回退
  {
    const run = makeRun({ snapshot: snapshotOf([row('1', '旧甲'), row('2', '旧乙')]), version: 6 })
    run.setFull(function (): any { return { snapshot: snapshotOf([row('9', '新的')]), version: 2 } })
    const out = await run.sync.notify({ ok: true, version: 2 })
    check(out === 'full', 'C1 版本比手上那份小 → 整份重取', out)
    check(run.calls.full === 1 && run.calls.reasons[0] === 'version-regressed', 'C2 整份的原因说清是版本回退', run.calls.reasons)
    check(run.store.heldLog[0] === null, 'C3 重取之前先把本地版本重置成「不知道」（重建之后清单不再可信）', run.store.heldLog)
    check(run.store.snapshot.issues.length === 1 && run.store.snapshot.issues[0].title === '新的', 'C4 旧行一行都不残留', run.store.snapshot.issues.map(function (x: any): string { return x.title }))
    check(run.store.book.version === 2, 'C5 本地版本改成重取那一刻的库版本', run.store.book)
  }

  // ---------------------------------------------------------------- D 落后超限
  {
    const run = makeRun({ snapshot: snapshotOf([row('1', '甲')]), version: 6 })
    run.setChanges(function (): any { return { ok: true, version: 9, full: true, reason: 'age-over-limit', changes: [], missing: [] } })
    run.setFull(function (): any { return { snapshot: snapshotOf([row('1', '甲'), row('4', '丁')]), version: 9 } })
    const out = await run.sync.notify({ ok: true, version: 9 })
    check(out === 'full', 'D1 宿主回「整份」时退回整份重取', out)
    check(run.calls.full === 1 && run.calls.reasons[0] === 'age-over-limit', 'D2 退回整份的原因沿用宿主给的那一格', run.calls.reasons)
    check(run.store.snapshot.issues.length === 2 && run.store.snapshot.issues[1].title === '丁', 'D3 整份装上去照常渲染（不是空界面）', run.store.snapshot.issues.length)
    check(run.store.book.version === 9, 'D4 本地版本推进到整份那一版', run.store.book)
  }

  // ---------------------------------------------------------------- E 多笔合并成一次读取
  {
    const run = makeRun({ snapshot: snapshotOf([row('1', '甲')]), version: 5 })
    run.setChanges(function (): any { return { ok: true, version: 8, full: false, changed: [], missing: [] } })
    const p1 = run.sync.notify({ ok: true, version: 6 })
    const p2 = run.sync.notify({ ok: true, version: 7 })
    const p3 = run.sync.notify({ ok: true, version: 8 })
    await Promise.all([p1, p2, p3])
    check(run.calls.changes === 1, 'E1 同一拍里连发三笔，只读一次变化集', run.calls.changes)
    check(run.store.book.version === 8, 'E2 读到的是最后一笔的版本', run.store.book)
  }
  {
    const run = makeRun({ snapshot: snapshotOf([row('1', '甲')]), version: 5 })
    let reads = 0
    let release: any = null
    const gate = new Promise<void>(function (resolve) { release = resolve })
    // 第一趟读到 6，第二趟（读完在途期间攒下的那一笔）读到 8。
    run.setChanges(function (): any { reads += 1; return { ok: true, version: reads === 1 ? 6 : 8, full: false, changed: [], missing: [] } })
    run.hold(gate)
    const p1 = run.sync.notify({ ok: true, version: 6 })
    // 等第一拍真的发出变化集读取（合并窗口是微任务），再在读取在途时补两笔。
    await settle()
    const p2 = run.sync.notify({ ok: true, version: 7 })
    const p3 = run.sync.notify({ ok: true, version: 8 })
    release()
    await Promise.all([p1, p2, p3])
    check(run.calls.changes === 2, 'E3 读取在途时再来的两笔只多读一次（不是三次）', run.calls.changes)
    check(run.store.book.version === 8, 'E4 最终停在最后一笔的版本', run.store.book)
  }

  // ---------------------------------------------------------------- F 信号源可替换
  {
    const run = makeRun({ snapshot: snapshotOf([row('1', '甲')]), version: 5 })
    run.setChanges(function (): any { return { ok: true, version: 6, full: false, changed: [], missing: [] } })
    let scheduled: any = null
    let interval = 0
    let cancelled = 0
    let readCount = 0
    const source = createPollingVersionSource({
      read: function (): any { readCount += 1; return { ok: true, version: 6 } },
      intervalMs: 5000,
      schedule: function (fn: any, ms: number): any { scheduled = fn; interval = ms; return { timer: true } },
      cancel: function (): void { cancelled += 1 },
    })
    const off = run.sync.start(source)
    check(typeof scheduled === 'function' && interval === 5000, 'F1 轮询源按间隔排一拍（间隔由调用方给，不在这里写死）', interval)
    scheduled()
    await settle()
    check(readCount === 1, 'F2 一拍问一次版本', readCount)
    check(run.calls.changes === 1, 'F3 版本变了取一次变化集', run.calls.changes)
    scheduled()
    await settle()
    check(run.calls.changes === 1, 'F4 同一版本的第二拍不再取', run.calls.changes)
    off()
    check(cancelled === 1, 'F5 取消订阅把定时器停掉', cancelled)
  }
  {
    let deliver: any = null
    const eventSource: any = {
      subscribe: function (fn: any): any { deliver = fn; return function (): void { deliver = null } },
    }
    const run = makeRun({ snapshot: snapshotOf([row('1', '甲')]), version: 5 })
    run.setChanges(function (): any { return { ok: true, version: 6, full: false, changed: [], missing: [] } })
    const off = run.sync.start(eventSource)
    check(typeof deliver === 'function', 'F6 事件源按同一份接口登记监听')
    deliver({ ok: true, version: 6 })
    await settle()
    check(run.calls.changes === 1, 'F7 推送来的版本与轮询那一拍走同一个引擎，结论一致', run.calls.changes)
    off()
    check(deliver === null, 'F8 取消订阅之后事件不再送到引擎')
  }

  // ---------------------------------------------------------------- G 生产接线
  {
    const cwd = 'D:\\ws1891-g1'
    const a = row('1', '甲')
    const b = row('2', '乙')
    const st: any = { cwd: cwd, snapshot: snapshotOf([a, b]), snapMode: 'real', snapLoading: false }
    rememberSnapshotVersion(cwd, 5)
    const calls: any[] = []
    const scope: any = {
      host: {
        call: function (method: string, args: any): any {
          calls.push({ method: method, args: args })
          if (method === 'wf.snapshotVersion') return Promise.resolve({ version: 6, workspaceKey: cwd, backend: 'github' })
          if (method === 'wf.snapshotChanges') {
            return Promise.resolve({
              ok: true, version: 6, workspaceKey: cwd, backend: 'github', full: false,
              changed: [listRow('2', { title: '乙（改过）' })], missing: [],
              // 就算宿主这一版还带着整份快照，客户端也不采信它（数据只从变化集来）。
              snapshot: { ok: true, maps: [], issues: [], thinTickets: [] },
            })
          }
          return Promise.resolve({ ok: false, error: 'unexpected ' + method })
        },
      },
      wsKeyOf: function (x: any): string { return String(x || '') },
      idOf: idOf,
      emit: function (): void {},
      setCachedSnapshot: function (): void {},
      applyChanges: applySnapshotChangeSet,
      log: function (): void {},
      isEnabled: function (): boolean { return false },
    }
    const out = await runSnapshotVersionTick(st, 'gate', scope)
    check(out === 'merged', 'G1 一拍走完：先问版本、版本变了取变化集、并进手上那份', out)
    const versions = calls.filter(function (c: any): boolean { return c.method === 'wf.snapshotVersion' })
    check(versions.length === 1 && versions[0].args.cwd === cwd, 'G2 每拍先问 wf.snapshotVersion', versions.map(function (c: any): string { return c.method }))
    check(calls.filter(function (c: any): boolean { return c.method === 'wf.snapshot' }).length === 0, 'G3 这一路不取整份快照', calls.map(function (c: any): string { return c.method }))
    const changesCalls = calls.filter(function (c: any): boolean { return c.method === 'wf.snapshotChanges' })
    check(changesCalls.length === 1 && changesCalls[0].args.sinceVersion === 5, 'G4 变化集带上手上那份的版本', changesCalls.length)
    check(st.snapshot.issues[0] === a, 'G5 没变的那一行原样留着（对象都没换）')
    check(st.snapshot.issues[1].title === '乙（改过）', 'G6 变化的那一行换上新内容', st.snapshot.issues[1].title)
    check(st.snapshot.issues.length === 2, 'G7 回包里那份整份快照不被采用（还是不采信整份）', st.snapshot.issues.length)
    check(st.rowFlash && Object.keys(st.rowFlash).length === 1, 'G8 只给变化的那一行打闪烁标记', st.rowFlash)
    const before = calls.length
    await runSnapshotVersionTick(st, 'gate', scope)
    check(calls.length === before + 1, 'G9 版本相同那一拍只问一次版本，一条数据都不取', calls.length - before)
  }

  // ---------------------------------------------------------------- H 304 与水合胜负按版本
  {
    check(isNewerSnapshotVersion(7, 5) === true, 'H1 来者的库版本更新才算更新')
    check(isNewerSnapshotVersion(5, 7) === false, 'H2 更旧的缓存不许盖住手上那份')
    check(isNewerSnapshotVersion(null, 7) === false, 'H3 不知道版本不算更新（不知道 ≠ 更新）')
    check(isNewerSnapshotVersion(7, 7) === false, 'H4 同一版本不算更新')
    const cacheSrc = sourceText('src/refresh/rooms/client/snapshot-cache-store.js')
    check(!/incomingMs\s*>\s*curMs/.test(cacheSrc), 'H5 水合胜负不再按生成时刻比')
    check(cacheSrc.indexOf('isNewerSnapshotVersion') >= 0, 'H6 水合胜负走版本判据')
    const snapSrc = sourceText('src/refresh/rooms/client/snapshot-sync.js')
    check(snapSrc.indexOf('if-none-match-304') >= 0 && snapSrc.indexOf('runSnapshotVersionTick') >= 0,
      'H7 304 把新鲜度交给版本同步（不再以 304 本身当「没变化」的结论）')
    const timerSrc = codeOnly(sourceText('src/refresh/rooms/client/refresh-timer.js'))
    check(timerSrc.indexOf('res.snapshot') < 0, 'H8 探测回包里的整份快照退场（客户端不再读它）')
    check(timerSrc.indexOf('runSnapshotVersionTickGroup') >= 0, 'H9 探测之后改走版本同步')
    // 闭包里的邻居靠拼接后同名才叫得到：内核文件 declare 的名字必须真是新那两片的导出名，
    // 名字对不上时 typeof 守卫会让整条路静默不走（不是报错，是「永远不发生」）。
    const newModuleSrc = sourceText('src/refresh/rooms/client/snapshot-version-sync.js') + '\n' + sourceText('src/refresh/rooms/client/snapshot-change-merge.js')
    const seamNames = ['captureSnapshotVersion', 'rememberSnapshotVersion', 'runSnapshotVersionTick', 'runSnapshotVersionTickGroup', 'snapshotVersionBookOf', 'isNewerSnapshotVersion']
    const missingSeams = seamNames.filter(function (name: string): boolean {
      return !(new RegExp('export (?:function|const) ' + name + '\\b')).test(newModuleSrc)
    })
    check(missingSeams.length === 0, 'H10 内核接的六个名字都真是新那两片的导出（名字对不上 = 这条路永远不走）', missingSeams)
  }

  // ---------------------------------------------------------------- I 全量安装不回退
  // 整份取数（full）是「没有基线 / 落后超限 / 库退化 / 版本回退」时的唯一出路。它取回来的那一份
  // 如果比手上那份还旧（宿主那边刚被重建、或者请求与库之间插了一次重建），装上就是把旧数据当新基线：
  // 界面倒回旧值，版本簿记还会记成「我很新」，之后的变化集从此接不住。所以装之前要过一道版本守卫。
  {
    const installOf = loadInstallBody()
    const cwd = 'D:\\ws1891-install'
    rememberSnapshotVersion(cwd, 7)
    const st: any = {
      cwd: cwd, snapshot: snapshotOf([row('1', '甲')]), snapMode: 'real', snapError: null,
      backendModules: { list: [] },
    }
    const heldSnapshot = st.snapshot
    const older = snapshotAt(5, [row('1', '五版的甲')])
    check(
      installOf(st, older) === false && st.snapshot === heldSnapshot,
      'I1 手上版本 7、取回来的整份是版本 5：不装，手上那份一个字节不改',
      { installed: false, issues: st.snapshot && st.snapshot.issues.map(function (x: any): string { return x.title }) },
    )
    const same = snapshotAt(7, [row('1', '七版的甲')])
    check(
      installOf(st, same) === true && st.snapshot === same,
      'I2 同版本照装（幂等：重开一次不该被自己的版本挡住）',
    )
    rememberSnapshotVersion(cwd, 7)
    const newer = snapshotAt(8, [row('1', '八版的甲')])
    check(
      installOf(st, newer) === true && st.snapshot === newer && snapshotVersionBookOf(cwd).version === 7,
      'I3 来者版本更新：照装（装这一动作本身不改版本簿记，簿记由整份取数那一路记）',
    )

    // 从整份取数那一路走一遍：版本簿记只能以「真的装上去的那一份」为准。
    const fullCwd = 'D:\\ws1891-install-full'
    rememberSnapshotVersion(fullCwd, 7)
    const st2: any = {
      cwd: fullCwd, snapshot: snapshotOf([row('1', '旧甲')]), snapMode: 'real', snapError: null,
      snapLoading: false, backendModules: { list: [] },
    }
    let versionValue = 8
    let snapshotValue: any = snapshotAt(5, [row('1', '五版的甲')])
    const calls2: string[] = []
    const scope2: any = {
      host: {
        call: function (method: string, args: any): any {
          calls2.push(method)
          if (method === 'wf.snapshotVersion') return Promise.resolve({ version: versionValue, workspaceKey: fullCwd, backend: 'github' })
          if (method === 'wf.snapshotChanges') {
            return Promise.resolve({ ok: true, version: versionValue, full: true, reason: 'age-over-limit', changes: [], missing: [] })
          }
          if (method === 'wf.snapshot') return Promise.resolve(snapshotValue)
          return Promise.resolve({ ok: false, error: 'unexpected ' + method })
        },
      },
      wsKeyOf: function (x: any): string { return String(x || '') },
      idOf: idOf,
      emit: function (): void {},
      setCachedSnapshot: function (): void {},
      applyChanges: applySnapshotChangeSet,
      installSnapshot: installOf,
      log: function (): void {},
      isEnabled: function (): boolean { return false },
    }
    const beforeFull = st2.snapshot
    const out1 = await runSnapshotVersionTick(st2, 'gate', scope2)
    check(
      out1 === 'failed' && st2.snapshot === beforeFull && snapshotVersionBookOf(fullCwd).version === 7,
      'I4 整份取数回来的是更旧的一份（库 5、手上 7）：这一拍算失败、不装、版本簿记一动也不动',
      { outcome: out1, version: snapshotVersionBookOf(fullCwd).version, calls: calls2 },
    )
    versionValue = 9
    snapshotValue = snapshotAt(9, [row('1', '九版的甲')])
    const out2 = await runSnapshotVersionTick(st2, 'gate', scope2)
    check(
      out2 === 'full' && st2.snapshot === snapshotValue && snapshotVersionBookOf(fullCwd).version === 9,
      'I5 整份取数回来的是更新的那一份：装上，版本簿记以装上去的那一份为准（9，而不是请求之前的 8）',
      { outcome: out2, version: snapshotVersionBookOf(fullCwd).version },
    )
  }
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
})
