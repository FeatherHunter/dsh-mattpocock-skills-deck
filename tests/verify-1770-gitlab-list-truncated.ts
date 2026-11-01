/**
 * tests/verify-1770-gitlab-list-truncated.ts —— GitLab 票列表「只取第一页」必须如实交代（#1770）。
 *
 * 病根：GitLab 房 `listIssues` 固定 `per_page=100` 只取第一页，取满了也不说「还有更多」；
 * 刷新探针、`deck_issue_list`、快照装配三条出口都把它当「就这么多」用。超过 100 张票的仓库上，
 * 掉出第一页的票（含被改动的老票）从来不会被探针看见，人拿到的清单也没有任何「可能不全」的提示。
 *
 * 本门禁钉住四件事：
 *   ① 房层：取满一个 per_page 上限（100 条）时 `truncated === true` 并落一行 `read.degraded`
 *      （reason=`list:truncated`）；取不满（99 条）时既不置旗标、也不落日志；
 *   ② 探针层：探针把这条降级线转成一行日志，且按仓库去重 —— 5 秒一拍的截断不许刷成心跳；
 *      恢复后再次截断还能看见（边沿式，不是一次性）；
 *   ③ 工具层：后端回了 `truncated:true` 时，`deck_issue_list` 回执里要有「可能不全」的说明，
 *      且文案不再只点名 GitHub 的 500/1000 条上限（GitLab 走的是每页 100 条这道上限）；
 *   ④ 不回归：99 条的正常仓库回执不出现这句说明。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1770-gitlab-list-truncated.ts
 *
 * 门禁归属: src/tracker/rooms/gitlab
 * 门禁归属: src/refresh/rooms/host/probe-handler.ts
 * 门禁归属: src/deck/tools/issue-list.ts
 */
import fs from 'node:fs'
import os from 'node:os'
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

/** 造一批 GitLab 原始回包形状的票（normalize 只认少数几格，其余按空处理）。 */
function rawRows(n: number): any[] {
  const out: any[] = []
  for (let i = 0; i < n; i += 1) {
    out.push({ iid: 1000 + i, title: '第 ' + (i + 1) + ' 张', state: 'opened', description: '' })
  }
  return out
}

/** 一个只回固定票单的 glab 桩；顺带记下每一次出站的 argv 与日志行。 */
function makeRoomCtx(rows: any[]): any {
  const calls: any[] = []
  const logged: any[] = []
  const ctx: any = {
    cwd: '/ws-test-1770',
    platform: { resolveExecutable: async function (): Promise<string> { return '/usr/bin/glab' } },
    fs: null,
    exec: async function (cmd: any, args: any): Promise<any> {
      calls.push({ cmd: cmd, args: Array.prototype.slice.call(args) })
      return { stdout: JSON.stringify(rows), stderr: '', code: 0 }
    },
    logEvent: function (level: string, event: string, fields: any): void { logged.push({ level: level, event: event, fields: fields }) },
    isEnabled: function (): boolean { return false },
    gate: null,
    timers: {},
  }
  return { ctx: ctx, calls: calls, logged: logged }
}

async function partRoom(): Promise<void> {
  console.log('— 一、房层：取满 100 条要置 truncated 并记一行，99 条不置不记')
  const mod: any = await imp('src/tracker/rooms/gitlab/issues.ts')
  const pag: any = await imp('src/tracker/contract/pagination.ts')
  const REPO: any = { backend: 'gitlab', refId: 'group/project', name: 'project', url: '' }

  const full = makeRoomCtx(rawRows(100))
  const rFull: any = await mod.listIssues(null, REPO, {}, full.ctx)
  check(!!rFull && rFull.ok === true, '一、100 条：列表正常返回', rFull && rFull.error && rFull.error.message)
  check(!!rFull && rFull.ok === true && Array.isArray(rFull.data) && rFull.data.length === 100, '一、100 条：100 行都在', rFull && rFull.data && rFull.data.length)
  check(!!rFull && rFull.truncated === true, '一、100 条：truncated === true（取满一页就可能有第 101 张）', rFull && String(rFull.truncated))
  const fullArgs: any[] = (full.calls[0] && full.calls[0].args) || []
  check(String(fullArgs[1] || '').indexOf('per_page=' + pag.PAGINATION.gitlab.maxPerPage) >= 0,
    '一、100 条：请求里的 per_page 仍是共享表的上限 ' + pag.PAGINATION.gitlab.maxPerPage, String(fullArgs[1] || ''))
  const fullLogs: any[] = full.logged.filter(function (l: any): boolean { return l.event === 'read.degraded' && l.fields && l.fields.reason === 'list:truncated' })
  check(fullLogs.length === 1, '一、100 条：恰好落一行 read.degraded / list:truncated，能定位到「只取了第一页」', JSON.stringify(fullLogs.map(function (l: any): any { return l.fields })))
  check(fullLogs.length === 1 && fullLogs[0].fields && fullLogs[0].fields.op === 'list', '一、100 条：日志的 op 是 list', fullLogs[0] && JSON.stringify(fullLogs[0].fields))

  const short = makeRoomCtx(rawRows(99))
  const rShort: any = await mod.listIssues(null, REPO, {}, short.ctx)
  check(!!rShort && rShort.ok === true && rShort.data && rShort.data.length === 99, '一、99 条：列表正常返回 99 行', rShort && rShort.data && rShort.data.length)
  check(!!rShort && rShort.truncated !== true, '一、99 条：不置 truncated', rShort && String(rShort.truncated))
  const shortLogs: any[] = short.logged.filter(function (l: any): boolean { return l.event === 'read.degraded' && l.fields && l.fields.reason === 'list:truncated' })
  check(shortLogs.length === 0, '一、99 条：不落截断日志', shortLogs.length)
}

async function partProbe(): Promise<void> {
  console.log('— 二、探针层：截断日志按仓库边沿式去重，恢复后再次截断还能看见')
  const mod: any = await imp('src/refresh/rooms/host/probe-handler.ts')
  const probeLogs: any[] = []
  let truncated = true
  const tracker: any = {
    list: async function (ref: any, opts: any, opCtx: any): Promise<any> {
      if (truncated) {
        // 这里模拟 GitLab 房：取满一页就报一行 read.degraded（#1770 新增的那条线）。
        opCtx.logEvent('warn', 'read.degraded', { op: 'list', reason: 'list:truncated', latencyMs: 3, opId: 'op-fake' })
      }
      // 干扰项：其它降级原因不归探针这一路记，桥只接截断那一条。
      opCtx.logEvent('warn', 'read.degraded', { op: 'list', reason: 'list:transport', latencyMs: 3, opId: 'op-fake' })
      return { ok: true, data: rawRows(truncated ? 100 : 99), truncated: truncated === true }
    },
  }
  const deps: any = {
    canonicalKey: async function (c: any): Promise<any> { return c },
    selectEarly: async function (): Promise<any> { return { backendId: 'gitlab' } },
    isComposerSelection: function (sel: any): boolean { return !!sel && sel.backendId === 'gitlab' },
    getTrackerRegistry: async function (): Promise<any> {
      return {
        get: function (): any { return tracker },
        describe: function (): any { return { backend: 'gitlab', refId: 'group/project', name: 'group/project', url: '' } },
      }
    },
    getPlatform: async function (): Promise<any> { return { resolveExecutable: async function (): Promise<string> { return 'glab' } } },
    ctx: { get: function (): any { return null } },
    detectionExec: async function (): Promise<any> { return { stdout: '[]', stderr: '', code: 0 } },
    fetchIssueIndexWindowed: async function (): Promise<any> { return { ok: false, error: { kind: 'unsupported', message: '不该走到 GitHub 那条路' } } },
    issueIndexChanged: function (): boolean { return false },
    rememberIssueIndex: function (): void {},
    commitIssueIndex: function (): void {},
    getCache: function (): any { return null },
    setCache: function (): void {},
    lastIssueIndexByRepo: {},
    lastProbeAtByRepo: {},
    deltaRefresh: async function (): Promise<any> { return null },
    takeWritePatch: async function (): Promise<any> { return null },
    errText: function (e: any): string { return e && typeof e === 'object' ? String(e.message || e.error || '') : String(e) },
    logCtx: { fire: function (level: string, event: string, fields: any): void { probeLogs.push({ level: level, event: event, fields: fields }) } },
  }
  const handler: any = mod.createProbeHandler(deps)
  const truncatedLogs = function (): any[] {
    return probeLogs.filter(function (l: any): boolean { return l.event === 'read.degraded' && l.fields && l.fields.reason === 'list:truncated' })
  }

  const r1: any = await handler.handleProbe({ cwd: 'D:/ws1770' })
  check(!!r1 && r1.ok === true, '二、探针第一拍正常返回' + (r1 && r1.ok === true ? '' : '（实得 ' + JSON.stringify(r1).slice(0, 300) + '）'))
  check(truncatedLogs().length === 1, '二、第一拍截断：探针路径落了一行 read.degraded / list:truncated', truncatedLogs().length)
  const r2: any = await handler.handleProbe({ cwd: 'D:/ws1770' })
  check(!!r2 && r2.ok === true, '二、探针第二拍正常返回', r2 && r2.error)
  check(truncatedLogs().length === 1, '二、第二拍仍是截断：不重复记（5 秒一拍不许刷成心跳）', truncatedLogs().length)
  const otherReasons: any[] = probeLogs.filter(function (l: any): boolean { return l.event === 'read.degraded' && l.fields && l.fields.reason !== 'list:truncated' })
  check(otherReasons.length === 0, '二、其它降级原因不经探针这一路记（桥只接截断这一条）', otherReasons.length)

  truncated = false
  const r3: any = await handler.handleProbe({ cwd: 'D:/ws1770' })
  check(!!r3 && r3.ok === true && r3.count === 99, '二、恢复：探针拍到 99 条', r3 && r3.count)
  truncated = true
  const r4: any = await handler.handleProbe({ cwd: 'D:/ws1770' })
  check(!!r4 && r4.ok === true && r4.count === 100, '二、再次截断：探针拍到 100 条', r4 && r4.count)
  check(truncatedLogs().length === 2, '二、恢复后再次截断：还能看见第二行（边沿式，不是一次性）', truncatedLogs().length)
}

/** 一个真实本地 Markdown 工作区：只为把 deck_issue_list 的真实壳跑起来（与 #1559 门禁同一套做法）。 */
function makeWorkspace(): any {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1770-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n把演示做完\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return String(p).replace(/\\/g, '/') },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    root: root,
    rootPosix: rootPosix,
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function partToolNote(): Promise<void> {
  console.log('— 三、工具层：后端标记截断时回执要有「可能不全」的说明，正常仓库没有')
  const budget: any = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod: any = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod: any = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const registryMod: any = await imp('src/tracker/registry/core.ts')
  const markdownModule: any = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const toolCost: any = await imp('src/refresh/kernel/tool-call-budget.js')
  const issueListMod: any = await imp('src/deck/tools/issue-list.ts')

  let clock = 1700000000000
  const makeHarness = function (truncated: boolean): any {
    const ws = makeWorkspace()
    const ledger = ledgerMod.createLedger({ now: function (): number { return clock } })
    const gate = gateMod.createGate({ ledger: ledger, now: function (): number { return clock } })
    const registry = registryMod.createRegistry(Object.assign({ logEvent: function (): void {}, isEnabled: function (): boolean { return false } }, ws.ctx), { matchesTimeout: 200 })
    const stubModule = Object.assign({}, markdownModule, {
      create: function (backendCtx: any): any {
        const tracker: any = markdownModule.create(backendCtx)
        tracker.list = async function (): Promise<any> { return { ok: true, data: [], truncated: truncated } }
        return tracker
      },
    })
    registry.register(stubModule as any)
    chooseWorkspace(ws.rootPosix, 'markdown')
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
    const deps: any = {
      gate: gate, registry: registry, budget: budget,
      estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      backendCtx: ws.ctx,
      handleFor: function (): any { return { cwd: ws.rootPosix, refId: '.scratch/demo' } },
      decideBackend: makeDecideStub(registry),
      log: { fire: function (): void {} },
      now: function (): number { return clock },
    }
    const tool: any = issueListMod.createDeckIssueList(deps)
    const exec: any = { agent: { session: { id: 's-1770', cwd: ws.rootPosix } } }
    return { ws: ws, tool: tool, exec: exec }
  }

  const runOne = async function (label: string, truncated: boolean): Promise<any> {
    const h = makeHarness(truncated)
    let r: any = null
    let threw = ''
    try { r = await h.tool.run(h.exec, { state: 'open' }) } catch (e) { threw = String((e as any)?.message || e) }
    check(threw === '', label + '：工具不把异常抛给调用方' + (threw ? '（抛了：' + threw + '）' : ''))
    check(!!r && r.status === 'ok', label + '：回执状态是 ok（实得 ' + JSON.stringify(r && r.status) + '）')
    h.ws.cleanup()
    return r
  }

  const truncatedReceipt: any = await runOne('三、>100 张（后端标截断）', true)
  const notes: string[] = ((truncatedReceipt && truncatedReceipt.notes) || []).map(function (n: any): string { return String(n) })
  const joined = notes.join('\n')
  check(joined.indexOf('可能不全') >= 0, '三、>100 张：回执里有「可能不全」的说明', joined || '（没有 notes）')
  check(joined.indexOf('每页最多 100 条') >= 0, '三、>100 张：文案点到每页 100 条这类后端上限（不只说 GitHub 的 500/1000 条）', joined || '（没有 notes）')

  const normalReceipt: any = await runOne('三、≤100 张（后端没标截断）', false)
  const normalNotes: string[] = ((normalReceipt && normalReceipt.notes) || []).map(function (n: any): string { return String(n) })
  check(normalNotes.join('\n').indexOf('可能不全') < 0, '三、≤100 张：回执里没有「可能不全」的说明', normalNotes.join('\n') || '（没有 notes，符合预期）')
}

async function main(): Promise<void> {
  await partRoom()
  await partProbe()
  await partToolNote()
  console.log('')
  console.log(failed ? 'FAILED（' + total + ' 项里至少一项不过）' : 'OK（' + total + ' 项全过）')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any): void {
  console.error('门禁自身炸了：' + String((e && e.stack) || e))
  process.exit(1)
})
