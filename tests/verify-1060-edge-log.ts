/**
 * tests/verify-1060-edge-log.ts —— 本地 Markdown 房「关系与边」这一族的结论线门禁（#1060）。
 *
 * 这一道断的是父子边与阻塞边在本后端真的留下了「这一趟做了什么」的记录。此前这一族一条结论线都没有：
 * 挂父、改挂、解除、写阻塞边、成环挡下，事后拿导出包的人只看到工具调用回了个 ok，
 * 分不清「这条边真挂上了」「本来就挂着、这次一处没改」「走在半路折了」，也看不出**成环检查到底查没查**——
 * 而本房的规矩是「拿不准就不放行」（图读不全时这一趟一个字都不写），这件事此前只落在返回里。
 *
 * 分四件事断：
 *   一、**每一档结论都留得下、而且与盘上事实对得上**：新挂记 added、改挂记 diff（撤一条挂一条）、
 *       解除记 removed、本来就到位记 noop、失败记 fail:档位；added / removed / kept 三格与
 *       「这次真改了几条边」逐趟对齐，noop 那几趟必须是 0 次写盘（靠文件服务的写调用计数器核，不靠读回来猜）。
 *   二、**环检这一趟也有结论**：没成环记 clear、成环记 cycle、图读不全记 unchecked；
 *       后两种都不能落盘，也不能只在返回里说。
 *   三、**形状与噪音**：每趟恰好一行、字段恰好登记的那八个（环检四个）、级别是常驻信息级、
 *       环检是调试级且关掉开关时一行不发、父子边不牵连环检那条线；没有 logEvent 的上下文照样写得出原来的结果、也不抛。
 *   四、**两向对账**：三张登记表（边类别、结论、环检结论）表里每一条都在本文件里走到过，表外一个都没出现。
 *
 * 全程在系统临时目录里造工作区，用与 tests/verify-1059-issue-write.ts 同一套 fs/platform 适配器形状；
 * 不打真网、不碰真实工作区（临时目录用完即删）。
 *
 * 运行：node --import ./scripts/ts-hook.mjs tests/verify-1060-edge-log.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'
import { EDGE_KINDS, EDGE_REASONS, EDGE_CYCLE_VERDICTS } from '../src/tracker/rooms/markdown/edge-log.ts'
import { ERROR_KIND } from '../src/tracker/contract/vocabulary.ts'

type LogLine = { level: string; event: string; fields: Record<string, unknown> }
type Ctx = {
  platform: { path: typeof path.posix; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  opId: string
  events: LogLine[]
  writes: string[]
  logEvent?: (level: string, event: string, fields: Record<string, unknown>) => void
  isEnabled: (level: string) => boolean
  get: (name: string) => unknown
}

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
/** 本文件里走到过的全部取值：收尾那一条断言拿它跟三张登记表对账。 */
const seenKinds = new Set<string>()
const seenReasons = new Set<string>()
const seenFailKinds = new Set<string>()
const seenVerdicts = new Set<string>()

const THE_EIGHT = 'added,kept,kind,latencyMs,ok,reason,removed,route'
const THE_FOUR = 'blockers,latencyMs,nodes,verdict'

/** 与 tests/verify-1059-issue-write.ts 同一套适配器形状：`unreadableFiles` 里的文件名在读的时候抛错；
 *  `writes` 记下每一次真的写文件（本门禁靠它核「这一趟到底写了几份」，而不是靠读回来猜）。 */
function makeCtx(cwd: string, unreadableFiles: string[] = [], withLog = true, debugOn = true): Ctx {
  const denied = (what: string, t: string) => {
    const e = new Error('EACCES: permission denied, ' + what + ' ' + t) as Error & { code?: string }
    e.code = 'EACCES'
    return e
  }
  const writes: string[] = []
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) {
        if (unreadableFiles.includes(String(t).split('/').pop() as string)) throw denied('open', t)
        return fs.readFileSync(t, 'utf8')
      },
      async writeText(t: string, c: string) { writes.push(t); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async rename(a: string, b: string) { fs.renameSync(a, b) },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async rm(t: string) { try { fs.rmSync(t, { force: true }); return true } catch { return false } },
    },
  }
  const events: LogLine[] = []
  const ctx: Ctx = {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1060',
    events,
    writes,
    isEnabled(level: string) { return level === 'debug' ? debugOn : true },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
  if (withLog) ctx.logEvent = (level, event, fields) => { events.push({ level, event, fields }) }
  return ctx
}

/** 在临时工作区里写一个工作单元（地图 + 若干票文件）；tickets 里每项是 [文件名, 状态]。 */
function writeEffort(root: string, effortId: string, tickets: Array<[string, string]>) {
  const dir = path.join(root, '.scratch', effortId)
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 工作单元 ' + effortId + '\n\nStatus: ready-for-agent\n\n## Destination\n\n夹具\n', 'utf8')
  for (const [file, status] of tickets) {
    fs.writeFileSync(path.join(dir, 'issues', file), '# ' + file + '\n\nStatus: ' + status + '\n\n## Body\n\n夹具里的票\n', 'utf8')
  }
  return dir
}
function ws(suffix: string, tickets: Array<[string, string]>): string {
  const root = fs.mkdtempSync(path.join(tmpRoot, suffix + '-'))
  writeEffort(root, 'demo', tickets)
  return root
}

const REPO = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1060-edgelog-'))

/** 边写入那条线（本门禁的主线）；环检那条线单独看。 */
const edgeLines = (ctx: Ctx) => ctx.events.filter((e) => e.event === 'edge.write')
const cycleLines = (ctx: Ctx) => ctx.events.filter((e) => e.event === 'edge.cycle')
const lastEdge = (ctx: Ctx) => { const l = edgeLines(ctx); return l.length ? l[l.length - 1] : null }
const lastCycle = (ctx: Ctx) => { const l = cycleLines(ctx); return l.length ? l[l.length - 1] : null }

/** 一行边写入结论该长什么样：常驻信息级、字段恰好登记的那八个、取值都在登记表里或形如 fail:档位。 */
function checkEdgeShape(e: LogLine | null, label: string): Record<string, unknown> {
  if (!e) { check(false, label + '：本该落一行 edge.write，实际一行都没有'); return {} }
  const keys = Object.keys(e.fields).sort().join(',')
  const kind = String(e.fields.kind)
  const reason = String(e.fields.reason)
  check(e.level === 'info', label + '：级别是常驻信息级（查这类问题的人不会先打开调试开关）→ 实得 ' + e.level)
  check(keys === THE_EIGHT, label + '：字段恰好八键 kind/route/ok/added/removed/kept/reason/latencyMs → 实得 ' + keys)
  check((EDGE_KINDS as readonly string[]).includes(kind), label + '：kind 在登记的边类别表里 → ' + kind)
  const reasonOk = (EDGE_REASONS as readonly string[]).includes(reason) || reason.startsWith('fail:')
  check(reasonOk, label + '：reason 在登记的结论表里（或以 fail: 开头）→ ' + reason)
  check(e.fields.route === 'none' || e.fields.route === 'file', label + '：route 是 none 或 file → ' + String(e.fields.route))
  check(typeof e.fields.ok === 'boolean', label + '：ok 是布尔 → ' + String(e.fields.ok))
  for (const k of ['added', 'removed', 'kept']) {
    const v = e.fields[k]
    check(typeof v === 'number' && (v as number) >= 0, label + '：' + k + ' 是非负计数 → ' + String(v))
  }
  check(typeof e.fields.latencyMs === 'number' && (e.fields.latencyMs as number) >= 0, label + '：latencyMs 是非负毫秒数 → ' + String(e.fields.latencyMs))
  seenKinds.add(kind)
  if (reason.startsWith('fail:')) seenFailKinds.add(reason.slice(5))
  else seenReasons.add(reason)
  return e.fields
}
/** 一行环检结论该长什么样：调试级、字段恰好登记的那四个、结论在登记表里。 */
function checkCycleShape(e: LogLine | null, label: string): Record<string, unknown> {
  if (!e) { check(false, label + '：本该落一行 edge.cycle，实际一行都没有'); return {} }
  const keys = Object.keys(e.fields).sort().join(',')
  const verdict = String(e.fields.verdict)
  check(e.level === 'debug', label + '：级别是按需调试级（高频路径，关掉开关就不落盘）→ 实得 ' + e.level)
  check(keys === THE_FOUR, label + '：字段恰好四键 verdict/nodes/blockers/latencyMs → 实得 ' + keys)
  check((EDGE_CYCLE_VERDICTS as readonly string[]).includes(verdict), label + '：verdict 在登记的结论表里 → ' + verdict)
  check(typeof e.fields.nodes === 'number' && (e.fields.nodes as number) >= 0, label + '：nodes 是非负计数 → ' + String(e.fields.nodes))
  check(typeof e.fields.blockers === 'number' && (e.fields.blockers as number) >= 0, label + '：blockers 是非负计数 → ' + String(e.fields.blockers))
  check(typeof e.fields.latencyMs === 'number' && (e.fields.latencyMs as number) >= 0, label + '：latencyMs 是非负毫秒数 → ' + String(e.fields.latencyMs))
  seenVerdicts.add(verdict)
  return e.fields
}
/** 一趟只留一行：这一趟操作之前记下行数，操作之后必须只多一行。 */
function countBefore(ctx: Ctx) { return edgeLines(ctx).length }
function checkOneMore(ctx: Ctx, before: number, label: string) {
  check(edgeLines(ctx).length === before + 1, label + '：这一趟恰好落一行结论 → 实得 ' + (edgeLines(ctx).length - before) + ' 行')
}
function readTicket(root: string, file: string): string {
  return fs.readFileSync(path.join(root, '.scratch', 'demo', 'issues', file), 'utf8')
}
/** 读回来的边是 `{key,title,state}` 三格（读路径补的），断言里只比编号那一格。 */
function keysOf(list: unknown): string {
  return (Array.isArray(list) ? list : []).map((k) => (k && typeof k === 'object' ? String((k as { key?: unknown }).key ?? '') : String(k))).join(',')
}

console.log('== 一、父子边：新挂记 added、复读记 noop、改挂记 diff、解除记 removed，盘上事实逐趟对得上 ==')
{
  const root = ws('a', [['01-a.md', 'ready-for-agent'], ['02-b.md', 'ready-for-agent'], ['03-c.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)
  const cycleBefore = cycleLines(ctx).length

  // 新挂：本来没有父，这一趟真往票文件里插了一行父注释。
  let before = countBefore(ctx)
  let writesBefore = ctx.writes.length
  const p1 = await b.setParent(REPO, '01', '02', {}, ctx)
  check(p1.ok === true && p1.data.parentKey === '02', '挂父成功、读回来父是 02 → ' + (p1.ok ? p1.data.parentKey : JSON.stringify(p1.error)))
  checkOneMore(ctx, before, '挂父')
  let f = checkEdgeShape(lastEdge(ctx), '挂父')
  check(f.kind === 'parent' && f.reason === 'added' && f.added === 1 && f.removed === 0 && f.kept === 0 && f.route === 'file',
    '挂父：kind=parent、reason=added、added=1/removed=0/kept=0、route=file → ' + [f.kind, f.reason, f.added, f.removed, f.kept, f.route].join('/'))
  check(ctx.writes.length === writesBefore + 1, '挂父：文件服务上真的多了一次写 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次')
  check(f.removed === 0, '挂父：这张票本来没写父注释（读回来落在地图这个默认父上），不许把这条默认值算成撤下来一条边 → removed=' + f.removed)
  check(/parentKey:\s*02/.test(readTicket(root, '01-a.md')), '挂父：盘上那张票的父注释真的变成了 02')

  // 同一趟再挂一次：目标状态已经在位，一处都不许改，而且要记成「本来就挂着」。
  before = countBefore(ctx)
  writesBefore = ctx.writes.length
  const p2 = await b.setParent(REPO, '01', '02', {}, ctx)
  check(p2.ok === true, '再挂同一次：照样回成功 → ' + (p2.ok ? 'parentKey=' + p2.data.parentKey : JSON.stringify(p2.error)))
  checkOneMore(ctx, before, '再挂同一次')
  f = checkEdgeShape(lastEdge(ctx), '再挂同一次')
  check(f.reason === 'noop' && f.added === 0 && f.removed === 0 && f.kept === 1 && f.route === 'none',
    '再挂同一次：reason=noop、added=0/removed=0/kept=1（那条边本来就在位）、route=none → ' + [f.reason, f.added, f.removed, f.kept, f.route].join('/'))
  check(ctx.writes.length === writesBefore, '再挂同一次：一次写盘都没发生 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次')

  // 改挂到另一张票：撤一条、挂一条，两笔都要记上。
  before = countBefore(ctx)
  const p3 = await b.setParent(REPO, '01', '03', {}, ctx)
  check(p3.ok === true && p3.data.parentKey === '03', '改挂到 03 成功 → ' + (p3.ok ? p3.data.parentKey : JSON.stringify(p3.error)))
  checkOneMore(ctx, before, '改挂')
  f = checkEdgeShape(lastEdge(ctx), '改挂')
  check(f.reason === 'diff' && f.added === 1 && f.removed === 1 && f.route === 'file',
    '改挂：reason=diff、added=1/removed=1（撤一条挂一条）→ ' + [f.reason, f.added, f.removed, f.route].join('/'))

  // 解除父子：撤一条。
  before = countBefore(ctx)
  const p4 = await b.setParent(REPO, '01', null, {}, ctx)
  check(p4.ok === true, '解除父子成功 → ' + (p4.ok ? String(p4.data.parentKey) : JSON.stringify(p4.error)))
  checkOneMore(ctx, before, '解除父子')
  f = checkEdgeShape(lastEdge(ctx), '解除父子')
  check(f.reason === 'removed' && f.added === 0 && f.removed === 1 && f.kept === 0 && f.route === 'file',
    '解除父子：reason=removed、added=0/removed=1/kept=0 → ' + [f.reason, f.added, f.removed, f.kept, f.route].join('/'))
  check(/parentKey:\s*null/.test(readTicket(root, '01-a.md')), '解除父子：盘上那张票的父注释真的变成了 null')

  // 再解除一次：本来就没有父可撤，一处不改（kept 不许记成 1——那是「边在位」的说法）。
  before = countBefore(ctx)
  writesBefore = ctx.writes.length
  const p5 = await b.setParent(REPO, '01', null, {}, ctx)
  check(p5.ok === true, '再解除一次：照样回成功 → ' + (p5.ok ? 'ok' : JSON.stringify(p5.error)))
  checkOneMore(ctx, before, '再解除一次')
  f = checkEdgeShape(lastEdge(ctx), '再解除一次')
  check(f.reason === 'noop' && f.added === 0 && f.removed === 0 && f.kept === 0 && f.route === 'none',
    '再解除一次：reason=noop、三格全 0（本来就没有边）、route=none → ' + [f.reason, f.added, f.removed, f.kept, f.route].join('/'))
  check(ctx.writes.length === writesBefore, '再解除一次：一次写盘都没发生 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次')

  // 地图票：解除是结构上就没有的东西，直接成功且一处不改。
  before = countBefore(ctx)
  const m = await b.setParent(REPO, '00', null, {}, ctx)
  check(m.ok === true, '地图票解除父子：直接成功（地图没有父）→ ' + (m.ok ? 'ok' : JSON.stringify(m.error)))
  checkOneMore(ctx, before, '地图票解除父子')
  f = checkEdgeShape(lastEdge(ctx), '地图票解除父子')
  check(f.kind === 'parent' && f.reason === 'noop' && f.route === 'none', '地图票解除父子：reason=noop、route=none → ' + f.reason + '/' + f.route)

  check(cycleLines(ctx).length === cycleBefore, '父子边这一整段：一条环检结论都没落（环检只挂在阻塞边上）→ 实得 ' + (cycleLines(ctx).length - cycleBefore) + ' 行')
}

console.log('== 二、阻塞边：新挂与撤下逐条对账，入参写重复算一条，一字不改时一次盘都不写 ==')
{
  const root = ws('b', [['01-a.md', 'ready-for-agent'], ['02-b.md', 'ready-for-agent'], ['03-c.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)

  // 新挂两条：added=2、kept=0。
  let before = countBefore(ctx)
  let writesBefore = ctx.writes.length
  const s1 = await b.setBlockedBy(REPO, '01', ['02', '03'], {}, ctx)
  check(s1.ok === true && keysOf(s1.data.blockedBy) === '02,03', '写两条阻塞边成功 → ' + (s1.ok ? keysOf(s1.data.blockedBy) : JSON.stringify(s1.error)))
  checkOneMore(ctx, before, '写两条阻塞边')
  let f = checkEdgeShape(lastEdge(ctx), '写两条阻塞边')
  check(f.kind === 'block' && f.reason === 'added' && f.added === 2 && f.removed === 0 && f.kept === 0 && f.route === 'file',
    '新挂两条：kind=block、reason=added、added=2/removed=0/kept=0、route=file → ' + [f.kind, f.reason, f.added, f.removed, f.kept, f.route].join('/'))
  check(ctx.writes.length === writesBefore + 1, '新挂两条：文件服务上真的写了一次（两条边落在同一行里）→ 实得 ' + (ctx.writes.length - writesBefore) + ' 次')
  check(/Blocked by:\s*#02,\s*#03/.test(readTicket(root, '01-a.md')), '新挂两条：盘上那一行真的写成了 #02, #03')

  // 撤掉其中一条：removed=1、kept=1（另一条还在位）。
  before = countBefore(ctx)
  const s2 = await b.setBlockedBy(REPO, '01', ['02'], {}, ctx)
  check(s2.ok === true && keysOf(s2.data.blockedBy) === '02', '撤掉一条成功 → ' + (s2.ok ? keysOf(s2.data.blockedBy) : JSON.stringify(s2.error)))
  checkOneMore(ctx, before, '撤掉一条')
  f = checkEdgeShape(lastEdge(ctx), '撤掉一条')
  check(f.reason === 'removed' && f.added === 0 && f.removed === 1 && f.kept === 1,
    '撤掉一条：reason=removed（这一趟只撤不挂）、added=0/removed=1/kept=1（另一条还在位）→ ' + [f.reason, f.added, f.removed, f.kept].join('/'))

  // 入参里同一张票写两遍：落到盘上是一条边，计数也得按一条算（noop：盘上本来就是这一条）。
  before = countBefore(ctx)
  writesBefore = ctx.writes.length
  const s3 = await b.setBlockedBy(REPO, '01', ['02', '02'], {}, ctx)
  check(s3.ok === true && keysOf(s3.data.blockedBy) === '02', '入参写重复：落盘仍是一条边 → ' + (s3.ok ? keysOf(s3.data.blockedBy) : JSON.stringify(s3.error)))
  checkOneMore(ctx, before, '入参写重复')
  f = checkEdgeShape(lastEdge(ctx), '入参写重复')
  check(f.reason === 'noop' && f.added === 0 && f.removed === 0 && f.kept === 1,
    '入参写重复：reason=noop、added=0/removed=0/kept=1（一条边，不是两条）→ ' + [f.reason, f.added, f.removed, f.kept].join('/'))
  check(ctx.writes.length === writesBefore, '入参写重复：一次写盘都没发生 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次')

  // 清空：撤下最后一条。
  before = countBefore(ctx)
  const s4 = await b.setBlockedBy(REPO, '01', [], {}, ctx)
  check(s4.ok === true && keysOf(s4.data.blockedBy) === '', '清空阻塞边成功 → ' + (s4.ok ? '空' : JSON.stringify(s4.error)))
  checkOneMore(ctx, before, '清空阻塞边')
  f = checkEdgeShape(lastEdge(ctx), '清空阻塞边')
  check(f.reason === 'removed' && f.added === 0 && f.removed === 1 && f.kept === 0, '清空：reason=removed、removed=1/kept=0 → ' + [f.reason, f.added, f.removed, f.kept].join('/'))
}

console.log('== 三、环检：没成环记 clear、成环记 cycle、图读不全记 unchecked，后两种都一个字不写 ==')
{
  const root = ws('c', [['04-d.md', 'ready-for-agent'], ['05-e.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)

  // 先写一条不成环的：环检结论 clear。
  let cycleBefore = cycleLines(ctx).length
  let before = countBefore(ctx)
  const ok1 = await b.setBlockedBy(REPO, '04', ['05'], {}, ctx)
  check(ok1.ok === true, '04 由 05 阻塞：不成环，写成功 → ' + (ok1.ok ? 'ok' : JSON.stringify(ok1.error)))
  check(cycleLines(ctx).length === cycleBefore + 1, '不成环那一趟：恰好落一行环检结论 → 实得 ' + (cycleLines(ctx).length - cycleBefore) + ' 行')
  let c = checkCycleShape(lastCycle(ctx), '不成环那一趟')
  check(c.verdict === 'clear' && c.blockers === 1, '不成环：verdict=clear、blockers=1 → ' + c.verdict + '/' + c.blockers)
  check((c.nodes as number) >= 2, '不成环：nodes 记下这次判环看到几张票（至少这两张）→ ' + c.nodes)
  let f = checkEdgeShape(lastEdge(ctx), '不成环那一趟')
  check(f.ok === true && f.reason === 'added', '不成环那一趟：边写入那一行 ok=true、reason=added → ' + f.ok + '/' + f.reason)

  // 反着写回去就成环：既要挡住，也要在两条线上都说清楚。
  const fileBefore = readTicket(root, '05-e.md')
  const writesBefore = ctx.writes.length
  cycleBefore = cycleLines(ctx).length
  before = countBefore(ctx)
  const cyc = await b.setBlockedBy(REPO, '05', ['04'], {}, ctx)
  check(cyc.ok === false && cyc.error.kind === ERROR_KIND.CONFLICT, '05 由 04 阻塞：会成环，如实回 conflict → ' + (cyc.ok ? '竟然成功' : cyc.error.kind))
  checkOneMore(ctx, before, '成环那一趟')
  f = checkEdgeShape(lastEdge(ctx), '成环那一趟')
  check(f.ok === false && f.reason === 'fail:' + ERROR_KIND.CONFLICT && f.route === 'none' && f.added === 0 && f.removed === 0,
    '成环那一趟：reason=fail:conflict、route=none、三格全 0（一个字都没写）→ ' + [f.reason, f.route, f.added, f.removed, f.kept].join('/'))
  check(cycleLines(ctx).length === cycleBefore + 1, '成环那一趟：恰好落一行环检结论 → 实得 ' + (cycleLines(ctx).length - cycleBefore) + ' 行')
  c = checkCycleShape(lastCycle(ctx), '成环那一趟')
  check(c.verdict === 'cycle' && c.blockers === 1, '成环：verdict=cycle、blockers=1 → ' + c.verdict + '/' + c.blockers)
  check(ctx.writes.length === writesBefore, '成环那一趟：一次写盘都没发生（挡在写之前）→ 实得 ' + (ctx.writes.length - writesBefore) + ' 次')
  check(readTicket(root, '05-e.md') === fileBefore, '成环那一趟：那张票的文件内容一个字节都没变')
}

console.log('== 四、图读不全：这一趟没查成（unchecked），照样不放行，也要在日志里说得出 ==')
{
  const root = ws('d', [['01-a.md', 'ready-for-agent'], ['02-locked.md', 'ready-for-agent']])
  const ctx = makeCtx(root, ['02-locked.md'])
  const b = createMarkdownBackend(ctx)

  const writesBefore = ctx.writes.length
  const cycleBefore = cycleLines(ctx).length
  const before = countBefore(ctx)
  const r = await b.setBlockedBy(REPO, '01', ['03'], {}, ctx)
  check(r.ok === false, '邻接关系读不全：写阻塞边如实失败（拿不准就不放行）→ ' + (r.ok ? '竟然成功' : r.error.kind))
  checkOneMore(ctx, before, '图读不全那一趟')
  const f = checkEdgeShape(lastEdge(ctx), '图读不全那一趟')
  check(f.ok === false && f.reason === 'fail:' + (r.ok ? '' : r.error.kind) && f.route === 'none', '图读不全那一趟：reason=fail:档位、route=none → ' + f.reason + '/' + f.route)
  check(cycleLines(ctx).length === cycleBefore + 1, '图读不全那一趟：恰好落一行环检结论 → 实得 ' + (cycleLines(ctx).length - cycleBefore) + ' 行')
  const c = checkCycleShape(lastCycle(ctx), '图读不全那一趟')
  check(c.verdict === 'unchecked' && c.nodes === 0 && c.blockers === 1, '图读不全：verdict=unchecked、nodes=0、blockers=1 → ' + [c.verdict, c.nodes, c.blockers].join('/'))
  check(ctx.writes.length === writesBefore, '图读不全那一趟：一次写盘都没发生 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次')
}

console.log('== 五、失败那一档：自环、找不到的父、跨工作单元的父、地图没有父，档位都落在结论线上 ==')
{
  const root = ws('e', [['01-a.md', 'ready-for-agent']])
  writeEffort(root, 'other', [['07-x.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)

  // 自环：入参自己和自己打架，写路径压根没走到。
  let before = countBefore(ctx)
  const self = await b.setBlockedBy(REPO, '01', ['01'], {}, ctx)
  check(self.ok === false && self.error.kind === ERROR_KIND.CONFLICT, '自己阻塞自己：如实回 conflict → ' + (self.ok ? '竟然成功' : self.error.kind))
  checkOneMore(ctx, before, '自己阻塞自己')
  let f = checkEdgeShape(lastEdge(ctx), '自己阻塞自己')
  check(f.kind === 'block' && f.ok === false && f.reason === 'fail:' + ERROR_KIND.CONFLICT && f.route === 'none', '自己阻塞自己：kind=block、reason=fail:conflict、route=none → ' + [f.kind, f.reason, f.route].join('/'))

  // 找不到的父：这个工作单元里、别处都没有这张票。
  before = countBefore(ctx)
  const nf = await b.setParent(REPO, '01', '99', {}, ctx)
  check(nf.ok === false && nf.error.kind === ERROR_KIND.NOTFOUND, '挂一个不存在的父：如实回 not-found → ' + (nf.ok ? '竟然成功' : nf.error.kind))
  checkOneMore(ctx, before, '挂不存在的父')
  f = checkEdgeShape(lastEdge(ctx), '挂不存在的父')
  check(f.kind === 'parent' && f.ok === false && f.reason === 'fail:' + ERROR_KIND.NOTFOUND && f.route === 'none', '挂不存在的父：reason=fail:not-found、route=none → ' + [f.reason, f.route].join('/'))

  // 跨工作单元的父：那张票在别的工作单元里，本房不支持（目录即父子）。
  before = countBefore(ctx)
  const cross = await b.setParent(REPO, '01', '07', {}, ctx)
  check(cross.ok === false && cross.error.kind === ERROR_KIND.UNSUPPORTED, '挂别的工作单元的票当父：如实回 unsupported → ' + (cross.ok ? '竟然成功' : cross.error.kind))
  checkOneMore(ctx, before, '跨工作单元的父')
  f = checkEdgeShape(lastEdge(ctx), '跨工作单元的父')
  check(f.ok === false && f.reason === 'fail:' + ERROR_KIND.UNSUPPORTED, '跨工作单元的父：reason=fail:unsupported → ' + f.reason)

  // 地图票想认一个父：结构上就没有这回事。
  before = countBefore(ctx)
  const mapParent = await b.setParent(REPO, '00', '01', {}, ctx)
  check(mapParent.ok === false && mapParent.error.kind === ERROR_KIND.UNSUPPORTED, '给地图票挂父：如实回 unsupported → ' + (mapParent.ok ? '竟然成功' : mapParent.error.kind))
  checkOneMore(ctx, before, '给地图票挂父')
  f = checkEdgeShape(lastEdge(ctx), '给地图票挂父')
  check(f.kind === 'parent' && f.ok === false && f.reason === 'fail:' + ERROR_KIND.UNSUPPORTED, '给地图票挂父：reason=fail:unsupported → ' + f.reason)
}

console.log('== 六、形状、噪音与「没有日志上下文也不许变」 ==')
{
  const root = ws('f', [['01-a.md', 'ready-for-agent'], ['02-b.md', 'ready-for-agent']])

  // 调试开关关掉：环检那条线一行不发，边写入那条线照落（它是常驻信息级）。
  const quiet = makeCtx(root, [], true, false)
  const bQuiet = createMarkdownBackend(quiet)
  const r1 = await bQuiet.setBlockedBy(REPO, '01', ['02'], {}, quiet)
  check(r1.ok === true, '调试开关关掉时写阻塞边：照样成功 → ' + (r1.ok ? 'ok' : JSON.stringify(r1.error)))
  check(cycleLines(quiet).length === 0, '调试开关关掉时：环检一条都不落（按需）→ 实得 ' + cycleLines(quiet).length + ' 行')
  check(edgeLines(quiet).length === 1, '调试开关关掉时：边写入那一行照样落（常驻信息级）→ 实得 ' + edgeLines(quiet).length + ' 行')

  // 没有 logEvent 的上下文：照样写得出结果、也不抛。
  const silent = makeCtx(root, [], false)
  const bSilent = createMarkdownBackend(silent)
  const r2 = await bSilent.setParent(REPO, '02', '01', {}, silent)
  check(r2.ok === true && r2.data.parentKey === '01', '没有 logEvent 的上下文：挂父照旧成功 → ' + (r2.ok ? r2.data.parentKey : JSON.stringify(r2.error)))
  const r3 = await bSilent.setBlockedBy(REPO, '01', ['02'], {}, silent)
  check(r3.ok === false || r3.ok === true, '没有 logEvent 的上下文：写阻塞边不抛（成不成按图上的事实）→ ' + (r3.ok ? 'ok' : r3.error.kind))
  check(silent.events.length === 0, '没有 logEvent 的上下文：一条日志都没落、也没抛 → 实得 ' + silent.events.length + ' 行')

  // 字段里不许有票号、文件名、路径这类原文。
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)
  await b.setBlockedBy(REPO, '01', ['02'], {}, ctx)
  const text = JSON.stringify(edgeLines(ctx).map((e) => e.fields).concat(cycleLines(ctx).map((e) => e.fields)))
  check(!/#\d|\d\d-[a-z]\.md|\.scratch|Blocked by/.test(text), '字段里没有票号、文件名、路径、字段原文 → ' + text)
}

console.log('== 七、三张表两向对账：表里每一条都走到过，表外一个都没出现 ==')
{
  const kindTable = EDGE_KINDS as readonly string[]
  const missingKinds = kindTable.filter((k) => !seenKinds.has(k))
  check(missingKinds.length === 0, '边类别表 ' + kindTable.length + ' 条逐条都在本文件里走到过 → 没走到的：' + (missingKinds.join(' / ') || '无'))
  const extraKinds = Array.from(seenKinds).filter((k) => kindTable.indexOf(k) < 0)
  check(extraKinds.length === 0, '出现过的 kind 全在表里（代码里没有拼错的字符串）→ 表外的：' + (extraKinds.join(' / ') || '无'))

  const reasonTable = EDGE_REASONS as readonly string[]
  const missingReasons = reasonTable.filter((r) => !seenReasons.has(r))
  check(missingReasons.length === 0, '结论表 ' + reasonTable.length + ' 条逐条都在本文件里走到过 → 没走到的：' + (missingReasons.join(' / ') || '无'))
  const extraReasons = Array.from(seenReasons).filter((r) => reasonTable.indexOf(r) < 0)
  check(extraReasons.length === 0, '出现过的结论全在表里 → 表外的：' + (extraReasons.join(' / ') || '无'))

  const verdictTable = EDGE_CYCLE_VERDICTS as readonly string[]
  const missingVerdicts = verdictTable.filter((v) => !seenVerdicts.has(v))
  check(missingVerdicts.length === 0, '环检结论表 ' + verdictTable.length + ' 条逐条都在本文件里走到过 → 没走到的：' + (missingVerdicts.join(' / ') || '无'))
  const extraVerdicts = Array.from(seenVerdicts).filter((v) => verdictTable.indexOf(v) < 0)
  check(extraVerdicts.length === 0, '出现过的环检结论全在表里 → 表外的：' + (extraVerdicts.join(' / ') || '无'))

  const errorKinds = Object.values(ERROR_KIND) as string[]
  for (const k of seenFailKinds) check(errorKinds.includes(k), 'fail: 后面的档位是契约里的真档位 → ' + k)
  check(seenFailKinds.size > 0, '失败那一档在本文件里走到过（fail:档位 至少出现一次）→ 实得 ' + Array.from(seenFailKinds).join('、') + ' 种')
}

fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log(failed ? '\n存在失败 — verify-1060-edge-log 未通过' : '\n全部通过 — 本地 Markdown 房关系与边的结论线落到了每一档')
process.exit(failed ? 1 : 0)
