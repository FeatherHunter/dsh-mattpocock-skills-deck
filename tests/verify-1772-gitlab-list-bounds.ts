/**
 * tests/verify-1772-gitlab-list-bounds.ts —— GitLab 票列表的取数边界（#1772）。
 *
 * 病根：#1770 把「只取第一页」的截断交代清楚了，但没有把名单真正读全 —— 开放票超过 100 张的
 * GitLab 仓库里，掉出第一页的票不会被刷新探针看见，deck_issue_list 的筛选也只在一页里做。
 *
 * 本门禁钉住五件事：
 *   ① 全量读：按 per_page=100、page=1..5 有界翻页（最多 500 张），每页都带 state 映射；
 *      只有「第 5 页仍然满」才 truncated，恰好 100 条、第 5 页不满、499 条都不报截断；
 *   ② 增量读：调用方给 since 时只发一个请求（updated_after=<since>、按 updated_at 升序、
 *      per_page=100），最多 100 行；这页取满就 truncated（还有积压）；since 非法按无窗口处理；
 *   ③ 刷新探针：每个仓库一个进程内游标 —— 首拍有界全量读建游标，之后每拍一个增量请求；
 *      索引值是 state|updatedAt，第一页外的票改了标题/标签/指派（updatedAt 变）下一拍能发现；
 *      叫「满页积压下一拍继续」，重复票按票号去重，每拍最多一个列表请求；
 *   ④ 地图快照：子票清单走契约的 listSubIssues，items 就是全量；capped/missing/dropped
 *      任一为真就回 partial 并在注记里说清「还有更多没取回」；后端不支持时才回退老路；
 *   ⑤ deck_issue_list 回包：新增 data.backendTruncated，data.truncated 是「本地 limit 截断
 *      或后端没读全」的总口径，注记写清 GitLab 最多读 500 张（5 页 × 100）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1772-gitlab-list-bounds.ts
 *
 * 门禁归属: src/tracker/rooms/gitlab
 * 门禁归属: src/tracker/contract/pagination.ts
 * 门禁归属: src/refresh/rooms/host/probe-handler.ts
 * 门禁归属: src/deck/tools/map-snapshot.ts
 * 门禁归属: src/deck/tools/issue-list.ts
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chooseWorkspace, makeDecideStub } from './lib/deck-decide-stub.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)

let failed = false
let total = 0
const check = function (ok: boolean, msg: string, got?: unknown): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (got === undefined ? '' : '（实得 ' + JSON.stringify(got) + '）'))
  if (!ok) failed = true
}

const REPO: any = { backend: 'gitlab', refId: 'group/project', name: 'project', url: '' }
const T0 = 1700000000000
const iso = function (ms: number): string { return new Date(ms).toISOString() }

// ---- 房层桩：分页感知的 glab ----
/** 造 n 张 GitLab 原始回包的票；iid 从 startIid 起，updated_at 从 baseMs 起每条差 1 秒。 */
function rawRows(n: number, startIid?: number, baseMs?: number): any[] {
  const start = startIid === undefined ? 1000 : startIid
  const base = baseMs === undefined ? T0 : baseMs
  const out: any[] = []
  for (let i = 0; i < n; i += 1) {
    out.push({ iid: start + i, title: '第 ' + (start + i) + ' 张', state: 'opened', description: '', updated_at: iso(base + i * 1000) })
  }
  return out
}

/** 按请求里的 page 参数回对应那一页（没给 page 回第一页），并记下每次出站 argv 与日志。 */
function makeRoomCtx(pages: any[][]): any {
  const calls: any[] = []
  const logged: any[] = []
  const ctx: any = {
    cwd: '/ws-test-1772',
    platform: { resolveExecutable: async function (): Promise<string> { return '/usr/bin/glab' } },
    fs: null,
    exec: async function (cmd: any, args: any): Promise<any> {
      calls.push({ cmd: cmd, args: Array.prototype.slice.call(args) })
      const query: string = String((args && args[1]) || '')
      const hit: any = /[?&]page=(\d+)/.exec(query)
      const page: number = hit ? Number(hit[1]) : 1
      return { stdout: JSON.stringify(pages[page - 1] || []), stderr: '', code: 0 }
    },
    logEvent: function (level: string, event: string, fields: any): void { logged.push({ level: level, event: event, fields: fields }) },
    isEnabled: function (): boolean { return false },
    gate: null,
    timers: {},
  }
  return { ctx: ctx, calls: calls, logged: logged }
}

function queryOf(call: any): string {
  return String((call && call.args && call.args[1]) || '')
}

async function partRoom(): Promise<void> {
  console.log('— 一、房层：全量读有界翻页，增量读 updated_after 单页')
  const mod: any = await imp('src/tracker/rooms/gitlab/issues.ts')
  const pag: any = await imp('src/tracker/contract/pagination.ts')
  const maxPerPage: number = pag.PAGINATION.gitlab.maxPerPage
  const maxPages: number = pag.PAGINATION.gitlab.issueListMaxPages

  // ① 增量读：只发一个请求，带 updated_after，按 updated_at 升序，最多一页。
  const since = '2026-10-31T12:00:00.000Z'
  const incr = makeRoomCtx([rawRows(100)])
  const rIncr: any = await mod.listIssues(null, REPO, { since: since }, incr.ctx)
  check(!!rIncr && rIncr.ok === true && rIncr.data.length === 100, '一、增量读：单页 100 行都在', rIncr && rIncr.data && rIncr.data.length)
  check(incr.calls.length === 1, '一、增量读：只发一个请求', incr.calls.length)
  const incrQ: string = queryOf(incr.calls[0])
  check(incrQ.indexOf('updated_after=' + encodeURIComponent(since)) >= 0, '一、增量读：带 updated_after=<since>', incrQ)
  check(incrQ.indexOf('order_by=updated_at') >= 0 && incrQ.indexOf('sort=asc') >= 0, '一、增量读：按 updated_at 升序（先读旧积压）', incrQ)
  check(incrQ.indexOf('per_page=' + maxPerPage) >= 0, '一、增量读：per_page 是共享表上限 ' + maxPerPage, incrQ)
  check(!/[?&]page=/.test(incrQ), '一、增量读：不翻页（没有 page 参数；per_page 不算）', incrQ)
  check(!!rIncr && rIncr.truncated === true, '一、增量读：这页取满 ⇒ truncated（还有积压，下一拍续读）', rIncr && String(rIncr.truncated))

  // ② 增量读：没取满就说明追平了，不报截断。
  const incrShort = makeRoomCtx([rawRows(40)])
  const rIncrShort: any = await mod.listIssues(null, REPO, { since: since }, incrShort.ctx)
  check(!!rIncrShort && rIncrShort.ok === true && rIncrShort.data.length === 40 && rIncrShort.truncated !== true, '一、增量读：40 行 ⇒ 不置 truncated', rIncrShort && String(rIncrShort.truncated))

  // ③ 增量读：state 仍按 filter 映射；没给 state 就不带。
  const incrClosed = makeRoomCtx([rawRows(10)])
  await mod.listIssues(null, REPO, { since: since, state: 'closed' }, incrClosed.ctx)
  check(queryOf(incrClosed.calls[0]).indexOf('state=closed') >= 0, '一、增量读：state=closed 映射到 state=closed', queryOf(incrClosed.calls[0]))
  const incrOpen = makeRoomCtx([rawRows(10)])
  await mod.listIssues(null, REPO, { since: since, state: 'open' }, incrOpen.ctx)
  check(queryOf(incrOpen.calls[0]).indexOf('state=opened') >= 0, '一、增量读：state=open 映射到 state=opened', queryOf(incrOpen.calls[0]))

  // ④ since 非法：按「没设窗口」处理，走有界全量读，不当错误抛。
  const badSince = makeRoomCtx([rawRows(5)])
  const rBad: any = await mod.listIssues(null, REPO, { since: 'not-a-date' }, badSince.ctx)
  check(!!rBad && rBad.ok === true && rBad.data.length === 5, '一、非法 since：不抛错，按无窗口处理', rBad && rBad.ok)
  check(queryOf(badSince.calls[0]).indexOf('updated_after=') < 0 && queryOf(badSince.calls[0]).indexOf('page=1') >= 0, '一、非法 since：回到全量读（有 page、无 updated_after）', queryOf(badSince.calls[0]))

  // ⑤ 全量读的有界口径：5 页上限来自共享表，不出现散落的魔法数。
  check(maxPages === 5 && maxPerPage === 100, '一、共享表：issueListMaxPages=5、maxPerPage=100', String(maxPages) + '/' + String(maxPerPage))
  const fiveFull = makeRoomCtx([rawRows(100), rawRows(100), rawRows(100), rawRows(100), rawRows(100)])
  const rFive: any = await mod.listIssues(null, REPO, {}, fiveFull.ctx)
  check(!!rFive && rFive.ok === true && rFive.data.length === 500 && rFive.truncated === true, '一、500 条：取回 500 行且置 truncated', rFive && String(rFive.truncated))
  check(fiveFull.calls.length === maxPages, '一、500 条：恰好 ' + maxPages + ' 个请求', fiveFull.calls.length)
  const pageNums: string[] = fiveFull.calls.map(function (c: any): string { const m = /[?&]page=(\d+)/.exec(queryOf(c)); return m ? m[1] : '' })
  check(pageNums.join(',') === '1,2,3,4,5', '一、500 条：逐页 page=1..5', pageNums.join(','))

  // ⑥ keys 过滤发生在整份名单上：命中第 2 页的票也要能筛出来。
  const twoPages = makeRoomCtx([rawRows(100), rawRows(2, 2000)])
  const rKeys: any = await mod.listIssues(null, REPO, { keys: ['2001'] }, twoPages.ctx)
  check(!!rKeys && rKeys.ok === true && rKeys.data.length === 1 && String(rKeys.data[0].key) === '2001', '一、keys：能筛出第 2 页的票', rKeys && rKeys.data && rKeys.data.map(function (x: any): string { return String(x.key) }).join(','))
}

// ---- 探针层桩 ----
/** 探针索引的比较口径（与 src/host/index.ts 的 issueIndexChanged 同语义；那里没有导出，夹具照抄一份）。 */
function issueIndexChanged(before: any, after: any): boolean {
  const ks = Object.keys(after || {})
  if (!before || Object.keys(before).length === 0) return true
  if (ks.length !== Object.keys(before).length) return true
  for (const k of ks) if (after[k] !== before[k]) return true
  return false
}

function probeRow(number: number, state: string, updatedAt: string): any {
  return { number: number, state: state, updatedAt: updatedAt }
}

const CWD_1772 = 'D:/ws1772'

/**
 * 一套探针夹具：tracker.list 按 queue 逐次回包（每拍恰好消费一格），
 * 并记下每次调用的 opts、索引变化前后的快照与缓存作废调用。
 */
function makeProbe(): any {
  const listCalls: any[] = []
  const indexSnapshots: any[] = []
  const cacheCalls: any[] = []
  const logs: any[] = []
  const queue: any[] = []
  const deps: any = {
    canonicalKey: async function (c: any): Promise<any> { return c },
    selectEarly: async function (): Promise<any> { return { backendId: 'gitlab' } },
    isComposerSelection: function (sel: any): boolean { return !!sel && sel.backendId === 'gitlab' },
    getTrackerRegistry: async function (): Promise<any> {
      return {
        get: function (): any {
          return {
            list: async function (ref: any, opts: any, opCtx: any): Promise<any> {
              listCalls.push({ opts: opts })
              const next: any = queue.length ? queue.shift() : { rows: [], truncated: false }
              if (next.truncated && opCtx && typeof opCtx.logEvent === 'function') {
                opCtx.logEvent('warn', 'read.degraded', { op: 'list', reason: 'list:truncated', latencyMs: 1, opId: 'op-probe' })
              }
              return { ok: true, data: next.rows, truncated: next.truncated === true }
            },
          }
        },
        describe: function (): any { return { backend: 'gitlab', refId: 'group/project', name: 'group/project', url: '' } },
      }
    },
    getPlatform: async function (): Promise<any> { return { resolveExecutable: async function (): Promise<string> { return 'glab' } } },
    ctx: { get: function (): any { return null } },
    detectionExec: async function (): Promise<any> { return { stdout: '[]', stderr: '', code: 0 } },
    fetchIssueIndexWindowed: async function (): Promise<any> { return { ok: false, error: { kind: 'unsupported', message: '不该走到 GitHub 那条路' } } },
    issueIndexChanged: function (before: any, after: any): boolean {
      indexSnapshots.push({ before: before, after: after })
      return issueIndexChanged(before, after)
    },
    rememberIssueIndex: function (): void {},
    commitIssueIndex: function (): void {},
    getCache: function (): any { return null },
    setCache: function (patch: any): void { cacheCalls.push(patch) },
    lastIssueIndexByRepo: {},
    lastProbeAtByRepo: {},
    deltaRefresh: async function (): Promise<any> { return null },
    takeWritePatch: async function (): Promise<any> { return null },
    errText: function (e: any): string { return e && typeof e === 'object' ? String(e.message || e.error || '') : String(e) },
    logCtx: { fire: function (level: string, event: string, fields: any): void { logs.push({ level: level, event: event, fields: fields }) } },
  }
  return { deps: deps, queue: queue, listCalls: listCalls, indexSnapshots: indexSnapshots, cacheCalls: cacheCalls, logs: logs }
}

async function partProbe(): Promise<void> {
  console.log('— 二、探针：首拍建游标，之后每拍一个增量请求；索引含 updatedAt')
  const mod: any = await imp('src/refresh/rooms/host/probe-handler.ts')

  // 场景 A：仓库有 500 张票（首拍有界全量读），第 450 张的状态变化在下一拍被发现。
  const A: any = makeProbe()
  const fullRows: any[] = []
  for (let i = 0; i < 500; i += 1) fullRows.push(probeRow(i + 1, 'open', iso(T0 + i * 1000)))
  A.queue.push({ rows: fullRows, truncated: true })
  A.queue.push({ rows: [probeRow(450, 'closed', iso(T0 + 500 * 1000))], truncated: false })
  A.queue.push({ rows: [], truncated: false })
  const handlerA: any = mod.createProbeHandler(A.deps)
  const rA1: any = await handlerA.handleProbe({ cwd: CWD_1772 })
  check(!!rA1 && rA1.ok === true && rA1.count === 500, '二、A 首拍：有界全量读拍到 500 张', rA1 && rA1.count)
  check(A.listCalls.length === 1 && !A.listCalls[0].opts.since, '二、A 首拍：没有游标 ⇒ 只发一个全量请求、不带 since', A.listCalls.length)
  check(!!rA1 && rA1.changed === true, '二、A 首拍：首次建索引要作废快照缓存', rA1 && rA1.changed)
  const maxUpdatedA: string = iso(T0 + 499 * 1000)
  const rA2: any = await handlerA.handleProbe({ cwd: CWD_1772 })
  check(A.listCalls.length === 2, '二、A 第二拍：仍然只发一个列表请求（不在一拍里翻多页）', A.listCalls.length)
  check(A.listCalls[1].opts && A.listCalls[1].opts.since === maxUpdatedA, '二、A 第二拍：since 是首拍见到的最大 updated_at', A.listCalls[1] && A.listCalls[1].opts)
  check(!!rA2 && rA2.ok === true && rA2.count === 1 && rA2.changed === true, '二、A 第二拍：第一页外的票改了状态也能发现', rA2 && JSON.stringify({ count: rA2.count, changed: rA2.changed }))
  const snapA2: any = A.indexSnapshots[A.indexSnapshots.length - 1]
  check(String(snapA2.before['450'] || '') === 'OPEN|' + iso(T0 + 449 * 1000), '二、A 第二拍：旧索引值是 state|updatedAt', snapA2.before && snapA2.before['450'])
  check(String(snapA2.after['450'] || '') === 'CLOSED|' + iso(T0 + 500 * 1000), '二、A 第二拍：新索引值含新的 updatedAt（标题/标签/指派变化也能发现）', snapA2.after && snapA2.after['450'])
  check(A.cacheCalls.length === 2 && A.cacheCalls[1].ts === 0 && A.cacheCalls[1].snapshot === null && A.cacheCalls[1].cwd === CWD_1772, '二、A 第二拍：作废快照缓存', A.cacheCalls.length)
  const rA3: any = await handlerA.handleProbe({ cwd: CWD_1772 })
  check(A.listCalls.length === 3 && A.listCalls[2].opts.since === iso(T0 + 500 * 1000), '二、A 第三拍：游标推进到增量里见过的最大 updated_at', A.listCalls[2] && A.listCalls[2].opts)
  check(!!rA3 && rA3.changed === false && A.cacheCalls.length === 2, '二、A 第三拍：没有变化就不重复作废缓存', rA3 && rA3.changed)

  // 场景 B：满页积压下一拍继续，不在同一拍里翻页。
  const B: any = makeProbe()
  const batch1: any[] = []
  for (let i = 0; i < 100; i += 1) batch1.push(probeRow(i + 1, 'open', iso(T0 + i * 1000)))
  const batch2: any[] = []
  for (let i = 0; i < 100; i += 1) batch2.push(probeRow(101 + i, 'open', iso(T0 + (100 + i) * 1000)))
  const batch3: any[] = []
  for (let i = 0; i < 50; i += 1) batch3.push(probeRow(201 + i, 'open', iso(T0 + (200 + i) * 1000)))
  B.queue.push({ rows: batch1, truncated: true })
  B.queue.push({ rows: batch2, truncated: true })
  B.queue.push({ rows: batch3, truncated: false })
  const handlerB: any = mod.createProbeHandler(B.deps)
  const rB1: any = await handlerB.handleProbe({ cwd: CWD_1772 })
  check(!!rB1 && rB1.ok === true && rB1.count === 100 && !B.listCalls[0].opts.since, '二、B 首拍：满页也只在下一拍继续', rB1 && rB1.count)
  const rB2: any = await handlerB.handleProbe({ cwd: CWD_1772 })
  check(!!rB2 && rB2.ok === true && rB2.count === 100 && B.listCalls[1].opts.since === iso(T0 + 99 * 1000), '二、B 第二拍：从上一页最大 updated_at 续读', B.listCalls[1] && B.listCalls[1].opts)
  const rB3: any = await handlerB.handleProbe({ cwd: CWD_1772 })
  check(!!rB3 && rB3.ok === true && rB3.count === 50 && B.listCalls[2].opts.since === iso(T0 + 199 * 1000), '二、B 第三拍：追平后不报截断', B.listCalls[2] && B.listCalls[2].opts)
  check(B.listCalls.length === 3, '二、B：三拍恰好三个列表请求（每拍最多一个）', B.listCalls.length)

  // 场景 C：updated_after 含边界 ⇒ 重复票按票号去重，不重复计数。
  const C: any = makeProbe()
  C.queue.push({ rows: [probeRow(1, 'open', iso(T0)), probeRow(2, 'open', iso(T0 + 1000))], truncated: false })
  C.queue.push({ rows: [probeRow(1, 'closed', iso(T0 + 2000)), probeRow(1, 'closed', iso(T0 + 2000)), probeRow(2, 'open', iso(T0 + 1000))], truncated: false })
  const handlerC: any = mod.createProbeHandler(C.deps)
  await handlerC.handleProbe({ cwd: CWD_1772 })
  const rC2: any = await handlerC.handleProbe({ cwd: CWD_1772 })
  check(!!rC2 && rC2.ok === true && rC2.count === 2, '二、C 重复票：按票号去重后只算 2 张', rC2 && rC2.count)
  check(C.listCalls.length === 2 && C.listCalls[1].opts.since === iso(T0 + 1000), '二、C：增量读沿用首拍游标', C.listCalls[1] && C.listCalls[1].opts)
}

// ---- 地图快照夹具 ----
function stubGateLedger(gateMod: any, ledgerMod: any): any {
  const now = T0
  const ledger = ledgerMod.createLedger({ now: function (): number { return now } })
  const gate = gateMod.createGate({ ledger: ledger, now: function (): number { return now } })
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: now + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: now + 3600000 } }, now)
  return { gate: gate }
}

const execFor = function (): any { return { agent: { session: { id: 's-1772', cwd: 'D:/demo' } } } }
const refOf = { backend: 'stub', refId: 'o/n', name: 'o/n', url: '' }

function stubRegistry(tracker: any): any {
  return {
    select: async function (): Promise<any> { return { backendId: 'stub', source: 'explicit', ref: refOf, pending: false } },
    get: function (): any { return tracker },
    modules: function (): any[] { return [{ id: 'stub', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false } }] },
    has: function (): boolean { return true },
    describe: function (): any { return refOf },
  }
}

function baseDeps(gate: any, registry: any, budget: any): any {
  const base: any = {
    gate: gate,
    registry: registry,
    budget: budget,
    estimate: function (): any { return { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 60, text: '' } },
    costInputFrom: function (): any { return { tool: 't' } },
    backendCtx: {},
    handleFor: function (s: any): any { return { cwd: (s && s.cwd) || '' } },
    log: null,
    now: function (): number { return T0 },
    canonicalKey: async function (raw: any): Promise<any> { return raw },
    workspaceKeyOf: function (): string { return 'ws-1772' },
    toolTimeoutMs: 60000,
    toolMarginMs: 5000,
  }
  if (!base.decideBackend && base.registry) base.decideBackend = makeDecideStub(base.registry)
  chooseWorkspace('D:/demo', 'stub')
  return base
}

const MAP_ISSUE: any = {
  key: '3', title: '地图', state: 'open', type: 'map', labels: [], assignees: [], updatedAt: '', url: '',
  body: '## Destination\n\n去那里\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n',
}
function kidRow(i: number, parentKey: string): any {
  return { key: String(1000 + i), title: '子票' + i, state: 'open', type: 'issue', labels: [], assignees: [], blockedBy: [], updatedAt: '', body: '', parentKey: parentKey }
}
function kidRows(n: number): any[] {
  const out: any[] = []
  for (let i = 0; i < n; i += 1) out.push(kidRow(i, '3'))
  return out
}

async function partMapSnapshot(): Promise<void> {
  console.log('— 三、地图快照：子票清单走 listSubIssues，capped/missing/dropped 要如实说')
  const budget: any = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod: any = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod: any = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const snapMod: any = await imp('src/deck/tools/map-snapshot.ts')

  const makeTool = function (subData: any, opts?: any): any {
    const counters: any = { list: 0, listSubIssues: 0 }
    const tracker: any = {
      get: async function (): Promise<any> { return { ok: true, data: Object.assign({}, MAP_ISSUE) } },
      list: async function (): Promise<any> { counters.list += 1; throw new Error('原生子票清单路径不该调老路 list') },
    }
    if (subData !== null) {
      tracker.listSubIssues = async function (): Promise<any> { counters.listSubIssues += 1; return { ok: true, data: subData } }
    } else {
      tracker.list = async function (): Promise<any> {
        counters.list += 1
        return { ok: true, data: (opts && opts.rows) || [] }
      }
    }
    const g: any = stubGateLedger(gateMod, ledgerMod)
    const tool: any = snapMod.createDeckMapSnapshot(baseDeps(g.gate, stubRegistry(tracker), budget))
    return { tool: tool, counters: counters }
  }
  const notesOf = function (r: any): string { return ((r && r.notes) || []).map(function (n: any): string { return String(n) }).join('\n') }

  // ① 150 张子票：走原生 items，不再二次过滤、也不再调老路。
  const native: any = makeTool({ items: kidRows(150), capped: false, missing: 0, dropped: 0, total: 150, fetched: 150 })
  const r150: any = await native.tool.run(execFor(), { key: '3' })
  check(!!r150 && r150.status === 'ok', '三、150 张：回 ok（实得 ' + JSON.stringify(r150 && r150.status) + '）')
  check(!!r150 && Array.isArray(r150.data.children) && r150.data.children.length === 150, '三、150 张：子票清单 150 行都在（>100）', r150 && r150.data && r150.data.children && r150.data.children.length)
  check(!!r150 && !!r150.data.stats && r150.data.truncated === false, '三、150 张：统计照算、不标截断', r150 && JSON.stringify({ stats: !!r150.data.stats, truncated: r150.data.truncated }))
  check(native.counters.listSubIssues === 1 && native.counters.list === 0, '三、150 张：只走 listSubIssues，不碰老路 list', native.counters)
  check(notesOf(r150).indexOf('偏乐观') < 0, '三、150 张：没读全才有「偏乐观」，这里不该出现', notesOf(r150) || '（没有 notes）')

  // ② 撞到后端硬上限：partial + 注记说「还有更多没取回」。
  const capped: any = makeTool({ items: kidRows(1000), capped: true, missing: 0, dropped: 0, total: 1200, fetched: 1000 })
  const rCapped: any = await capped.tool.run(execFor(), { key: '3' })
  check(!!rCapped && rCapped.status === 'partial', '三、capped：回 partial（实得 ' + JSON.stringify(rCapped && rCapped.status) + '）')
  check(!!rCapped && rCapped.data.truncated === true && rCapped.data.stats === null, '三、capped：标截断、统计不假装算全', rCapped && JSON.stringify({ truncated: rCapped.data.truncated, stats: rCapped.data.stats }))
  check(notesOf(rCapped).indexOf('还有更多没取回') >= 0, '三、capped：注记写清「还有更多没取回」', notesOf(rCapped))
  check(((rCapped && rCapped.data && rCapped.data.children) || []).length === 1000, '三、capped：已经拿回的 1000 张照给', rCapped && rCapped.data && rCapped.data.children && rCapped.data.children.length)

  // ③ 总数对不上：missing/dropped 也算没读全。
  const mismatched: any = makeTool({ items: kidRows(10), capped: false, missing: 3, dropped: 2, total: 13, fetched: 10 })
  const rMismatch: any = await mismatched.tool.run(execFor(), { key: '3' })
  check(!!rMismatch && rMismatch.status === 'partial' && rMismatch.data.truncated === true, '三、missing/dropped：回 partial 且标截断', rMismatch && rMismatch.status)
  check(notesOf(rMismatch).indexOf('对不上数') >= 0, '三、missing/dropped：注记说清对不上数', notesOf(rMismatch))

  // ④ 后端不支持 listSubIssues（本地 Markdown 房）：回退老路，且不把回退结果当完整清单。
  const fallbackRows: any[] = [kidRow(0, '3'), kidRow(1, '3'), kidRow(2, '9')]
  const fallback: any = makeTool(null, { rows: fallbackRows })
  const rFallback: any = await fallback.tool.run(execFor(), { key: '3' })
  check(!!rFallback && rFallback.status === 'ok', '三、回退：后端不支持时走老路仍回 ok', rFallback && rFallback.status)
  check(fallback.counters.list === 1, '三、回退：老路 list 被调用一次', fallback.counters.list)
  check(((rFallback && rFallback.data && rFallback.data.children) || []).length === 2, '三、回退：只留 parentKey 是这张地图的 2 张（不带无关行）', rFallback && rFallback.data && rFallback.data.children && rFallback.data.children.length)
  check(notesOf(rFallback).indexOf('回退读法') >= 0 && notesOf(rFallback).indexOf('不是契约的子票清单') >= 0, '三、回退：注记说清回退清单不是契约子票清单、可能有出入', notesOf(rFallback))

  // ⑤ data 是对象但没有 items：形状不认识，按读取失败算 partial，别静默当 0 张子票。
  const noItems: any = makeTool({ capped: false, missing: 0, dropped: 0, total: 5 })
  const rNoItems: any = await noItems.tool.run(execFor(), { key: '3' })
  check(!!rNoItems && rNoItems.status === 'partial' && rNoItems.data.truncated === true, '三、没有 items：形状不认识按 partial 处理（不静默当 0 张）', rNoItems && JSON.stringify({ status: rNoItems.status, truncated: rNoItems.data && rNoItems.data.truncated }))
  check(notesOf(rNoItems).indexOf('形状不认识') >= 0, '三、没有 items：注记说清形状不认识', notesOf(rNoItems))

  // ⑥ 真正 0 张子票：安静回 0，不吓唬人。
  const empty: any = makeTool({ items: [], capped: false, missing: 0, dropped: 0, total: 0, fetched: 0 })
  const rEmpty: any = await empty.tool.run(execFor(), { key: '3' })
  check(!!rEmpty && rEmpty.status === 'ok' && rEmpty.data.children.length === 0 && !!rEmpty.data.stats, '三、0 张：状态 ok、统计 0 也不缺', rEmpty && JSON.stringify({ status: rEmpty.status, children: rEmpty.data.children.length }))
  check(notesOf(rEmpty).indexOf('偏乐观') < 0, '三、0 张：不出现「偏乐观」', notesOf(rEmpty) || '（没有 notes）')
}

async function partIssueList(): Promise<void> {
  console.log('— 四、deck_issue_list：backendTruncated 单独回一格，总口径 truncated 任一为真')
  const budget: any = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod: any = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod: any = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const listMod: any = await imp('src/deck/tools/issue-list.ts')
  const demoRow: any = { key: '7', title: '演练票', state: 'open', type: 'issue', labels: [], assignees: [], updatedAt: '', url: '', body: '' }

  const runWith = async function (rows: any[], backendTruncated: boolean, args: any): Promise<any> {
    const tracker: any = { list: async function (): Promise<any> { return { ok: true, data: rows, truncated: backendTruncated } } }
    const g: any = stubGateLedger(gateMod, ledgerMod)
    const tool: any = listMod.createDeckIssueList(baseDeps(g.gate, stubRegistry(tracker), budget))
    return await tool.run(execFor(), args)
  }
  const notesOf = function (r: any): string { return ((r && r.notes) || []).map(function (n: any): string { return String(n) }).join('\n') }

  // ① 后端没读全：backendTruncated 与 truncated 都真，注记点名 500 张 / 5 页。
  const rBackend: any = await runWith([demoRow], true, { state: 'open' })
  check(!!rBackend && rBackend.status === 'ok', '四、后端截断：回执 status ok（实得 ' + JSON.stringify(rBackend && rBackend.status) + '）')
  check(!!rBackend && rBackend.data.backendTruncated === true && rBackend.data.truncated === true, '四、后端截断：backendTruncated 与 truncated 都置 true', rBackend && JSON.stringify({ backendTruncated: rBackend.data.backendTruncated, truncated: rBackend.data.truncated }))
  check(notesOf(rBackend).indexOf('500 张') >= 0 && notesOf(rBackend).indexOf('5 页') >= 0, '四、后端截断：注记点名 GitLab 最多 500 张（5 页 × 100）', notesOf(rBackend))
  check(notesOf(rBackend).indexOf('可能不全') >= 0, '四、后端截断：注记说清这份清单可能不全', notesOf(rBackend))

  // ② 只有本地 limit 截断：backendTruncated 假、truncated 真，两者能分清。
  const rows3: any[] = [demoRow, Object.assign({}, demoRow, { key: '8' }), Object.assign({}, demoRow, { key: '9' })]
  const rLocal: any = await runWith(rows3, false, { state: 'open', limit: 1 })
  check(!!rLocal && rLocal.data.backendTruncated === false && rLocal.data.truncated === true, '四、本地截断：backendTruncated=false、truncated=true', rLocal && JSON.stringify({ backendTruncated: rLocal.data.backendTruncated, truncated: rLocal.data.truncated }))
  check(!!rLocal && rLocal.data.returned === 1 && rLocal.data.total === 3, '四、本地截断：只回 1 行、总数仍是 3', rLocal && JSON.stringify({ returned: rLocal.data.returned, total: rLocal.data.total }))

  // ③ 正常仓库：两个旗标都假，注记里没有「可能不全」。
  const rNormal: any = await runWith([demoRow], false, { state: 'open' })
  check(!!rNormal && rNormal.data.backendTruncated === false && rNormal.data.truncated === false, '四、正常：两个旗标都假', rNormal && JSON.stringify({ backendTruncated: rNormal.data.backendTruncated, truncated: rNormal.data.truncated }))
  check(notesOf(rNormal).indexOf('可能不全') < 0, '四、正常：注记不吓唬人', notesOf(rNormal) || '（没有 notes）')
}

async function main(): Promise<void> {
  await partRoom()
  await partProbe()
  await partMapSnapshot()
  await partIssueList()
  console.log('')
  console.log(failed ? 'FAILED（' + total + ' 项里至少一项不过）' : 'OK（' + total + ' 项全过）')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any): void {
  console.error('门禁自身炸了：' + String((e && e.stack) || e))
  process.exit(1)
})
