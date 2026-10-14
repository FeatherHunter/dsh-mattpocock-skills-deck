/**
 * tests/verify-1059-issue-write.ts —— 本地 Markdown 后端写路径结论线的门禁（#1059）。
 *
 * 这一道断的是「写这一趟到底写下去没有」那条线在本地房的写路径上真的落了地。本地房此前只有
 * 配色文件那一族有日志（labelColors.write），票的增删改评论贴标签一条结论线都没有：建票失败、
 * 幂等锚命中复用、关一张已经关着的票、贴一批本来就有的标签——事后拿导出包的人在写路径上看到的是
 * 「什么都没有」，分不清「没走这条路」还是「走了、没改到盘上」。
 *
 * 分两件事断：
 *   一、**每一档结论都留得下、而且与盘上事实对得上**：真新建记 fresh、幂等锚命中记 reuse、
 *       改到盘上记 edited、一处没改记 noop、失败记 fail:档位；written 那一格与「这次真写了几份文件」
 *       逐趟对齐（复用与 noop 那两趟必须是 0 次写，靠文件服务的写调用计数器核，不靠读回来猜 ——
 *       一次写调用都没有，就意味着这份文件在盘上的字节与修改时间都不会动，老票的创建时间回落
 *       与翻页顺序也就不会跟着变；夹具里没有真盘，所以钉的是「有没有写」这一步，不读时钟）。
 *   二、**形状与噪音**：每趟恰好一行、字段恰好登记的那七个、级别是常驻信息级；没有 logEvent 的上下文
 *       照样写得出原来的结果、也不抛；最后把取值表反过来对一次账——表里每一条都在本文件里走到过，
 *       表外一个都没出现。
 *
 * 全程在系统临时目录里造工作区，用与 tests/verify-1058-markdown-read-log.ts 同一套 fs/platform 适配器
 * 形状；不打真网、不碰真实工作区（临时目录用完即删）。
 *
 * 运行：node --import ./scripts/ts-hook.mjs tests/verify-1059-issue-write.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'
import { ISSUE_WRITE_KINDS, ISSUE_WRITE_REASONS } from '../src/tracker/rooms/markdown/write-log.ts'
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
/** 本文件里走到过的全部结论取值与写操作类别：收尾那一条断言拿它跟两张表对账。 */
const seenKinds = new Set<string>()
const seenReasons = new Set<string>()
const seenFailKinds = new Set<string>()

/** 与 tests/verify-1058-markdown-read-log.ts 同一套适配器形状，另加两样：
 *  `unreadableFiles` 里的文件名在读的时候抛错；`writes` 记下每一次真的写文件（本门禁靠它核
 *  「这一趟到底写了几份」，而不是靠读回来猜）。 */
function makeCtx(cwd: string, unreadableFiles: string[] = [], withLog = true): Ctx {
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
    opId: 'test-op-1059',
    events,
    writes,
    isEnabled() { return true },
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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1059-writelog-'))
const THE_SEVEN = 'failed,kind,latencyMs,ok,reason,route,written'

/** 只看 issue.write 那一条线：别的日志（判档那条 error.normalize 是调试级）不算本门禁的账。 */
const writeLines = (ctx: Ctx) => ctx.events.filter((e) => e.event === 'issue.write')
const lastLine = (ctx: Ctx) => { const l = writeLines(ctx); return l.length ? l[l.length - 1] : null }

/** 一行写路径结论线该长什么样：常驻信息级、字段恰好登记的那七个、取值都在登记表里或形如 fail:档位。 */
function checkShape(e: LogLine | null, label: string): Record<string, unknown> {
  if (!e) { check(false, label + '：本该落一行 issue.write，实际一行都没有'); return {} }
  const keys = Object.keys(e.fields).sort().join(',')
  const kind = String(e.fields.kind)
  const reason = String(e.fields.reason)
  check(e.level === 'info', label + '：级别是常驻信息级（查这类问题的人不会先打开调试开关）→ 实得 ' + e.level)
  check(keys === THE_SEVEN, label + '：字段恰好七键 kind/route/ok/written/failed/reason/latencyMs → 实得 ' + keys)
  check((ISSUE_WRITE_KINDS as readonly string[]).includes(kind), label + '：kind 在登记的写操作表里 → ' + kind)
  const reasonOk = (ISSUE_WRITE_REASONS as readonly string[]).includes(reason) || reason.startsWith('fail:')
  check(reasonOk, label + '：reason 在登记的结论表里（或以 fail: 开头）→ ' + reason)
  check(e.fields.route === 'none' || e.fields.route === 'file', label + '：route 是 none 或 file → ' + String(e.fields.route))
  check(typeof e.fields.ok === 'boolean', label + '：ok 是布尔 → ' + String(e.fields.ok))
  check(typeof e.fields.written === 'number' && (e.fields.written as number) >= 0, label + '：written 是非负计数 → ' + String(e.fields.written))
  check(typeof e.fields.failed === 'number' && (e.fields.failed as number) >= 0, label + '：failed 是非负计数 → ' + String(e.fields.failed))
  check(typeof e.fields.latencyMs === 'number' && (e.fields.latencyMs as number) >= 0, label + '：latencyMs 是非负毫秒数 → ' + String(e.fields.latencyMs))
  seenKinds.add(kind)
  if (reason.startsWith('fail:')) seenFailKinds.add(reason.slice(5))
  else seenReasons.add(reason)
  return e.fields
}
/** 一趟只留一行：这一趟操作之前记下行数，操作之后必须只多一行。 */
function countBefore(ctx: Ctx) { return writeLines(ctx).length }
function checkOneMore(ctx: Ctx, before: number, label: string) {
  check(writeLines(ctx).length === before + 1, label + '：这一趟恰好落一行结论 → 实得 ' + (writeLines(ctx).length - before) + ' 行')
}

console.log('== 一、建票：真新建记 fresh，幂等锚命中记 reuse，两次都写下去了没有要对得上 ==')
{
  const root = ws('a', [['01-old.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)

  let before = countBefore(ctx)
  const writesBefore = ctx.writes.length
  const made = await b.create(REPO, { title: '新的一张' }, ctx)
  check(made.ok === true, '不带锚建票成功 → ' + (made.ok ? 'key=' + made.data.key : JSON.stringify(made.error)))
  checkOneMore(ctx, before, '建票')
  let f = checkShape(lastLine(ctx), '建票')
  check(f.kind === 'create' && f.reason === 'fresh', '建票：kind=create、reason=fresh → ' + f.kind + '/' + f.reason)
  check(f.ok === true && f.written === 1 && f.route === 'file', '建票：ok=true、written=1、route=file（真写了一份文件）→ ' + f.ok + '/' + f.written + '/' + f.route)
  check(ctx.writes.length === writesBefore + 1, '建票：文件服务上真的多了一次写 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次')

  // 幂等锚：第一次真建，第二次同一把锚必须复用，而且一份文件都不许写。
  const key = 'md-1059-anchor-1'
  before = countBefore(ctx)
  const first = await b.create(REPO, { title: '带锚的一张', idempotencyKey: key }, ctx)
  check(first.ok === true, '带锚第一次建票成功 → ' + (first.ok ? 'key=' + first.data.key : JSON.stringify(first.error)))
  f = checkShape(lastLine(ctx), '带锚第一次建票')
  check(f.reason === 'fresh', '带锚第一次：reason=fresh → ' + f.reason)

  before = countBefore(ctx)
  const writesBefore2 = ctx.writes.length
  const second = await b.create(REPO, { title: '带锚的一张', idempotencyKey: key }, ctx)
  check(second.ok === true && first.ok === true && second.data.key === first.data.key, '带锚第二次：复用同一张（key 不变）→ ' + (second.ok ? second.data.key : JSON.stringify(second.error)))
  checkOneMore(ctx, before, '带锚第二次建票')
  f = checkShape(lastLine(ctx), '带锚第二次建票')
  check(f.reason === 'reuse' && f.written === 0 && f.route === 'none', '带锚第二次：reason=reuse、written=0、route=none → ' + f.reason + '/' + f.written + '/' + f.route)
  check(ctx.writes.length === writesBefore2, '带锚第二次：一份文件都没写（复用不落盘）→ 实得 ' + (ctx.writes.length - writesBefore2) + ' 次')

  // 建票失败：入参不合法，写路径压根没走到。
  before = countBefore(ctx)
  const bad = await b.create(REPO, { title: '   ' }, ctx)
  check(bad.ok === false, '标题是空白：建票如实失败 → ' + (bad.ok ? '竟然成功' : bad.error.kind))
  checkOneMore(ctx, before, '建票失败')
  f = checkShape(lastLine(ctx), '建票失败')
  check(f.ok === false && f.reason === 'fail:' + (bad.ok ? '' : bad.error.kind), '建票失败：reason=fail:档位，档位与返回的 error.kind 一致 → ' + f.reason)
  check(f.written === 0 && f.route === 'none', '建票失败：written=0、route=none（没走到写文件）→ ' + f.written + '/' + f.route)
}

console.log('== 二、关票与重开：改到盘上记 edited，一张已经关着的票再关一次记 noop（且不再写盘） ==')
{
  const root = ws('b', [['01-open.md', 'ready-for-agent'], ['02-gone.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)

  let before = countBefore(ctx)
  const closed = await b.close(REPO, '01', { reason: 'completed' }, ctx)
  check(closed.ok === true, '关票成功 → ' + (closed.ok ? '状态=' + closed.data.state : JSON.stringify(closed.error)))
  checkOneMore(ctx, before, '关票')
  let f = checkShape(lastLine(ctx), '关票')
  check(f.kind === 'close' && f.reason === 'edited' && f.written === 1, '关票：kind=close、reason=edited、written=1 → ' + f.kind + '/' + f.reason + '/' + f.written)

  before = countBefore(ctx)
  const writesBefore = ctx.writes.length
  const again = await b.close(REPO, '01', { reason: 'completed' }, ctx)
  check(again.ok === true, '再关一次同一张：照样回成功 → ' + (again.ok ? '状态=' + again.data.state : JSON.stringify(again.error)))
  checkOneMore(ctx, before, '再关一次')
  f = checkShape(lastLine(ctx), '再关一次')
  check(f.kind === 'close' && f.reason === 'noop' && f.written === 0, '再关一次：reason=noop、written=0（盘上一字未变）→ ' + f.reason + '/' + f.written)
  check(ctx.writes.length === writesBefore, '再关一次：一次写盘都没发生（盘上这份文件的字节与修改时间都不会动）→ 实得 ' + (ctx.writes.length - writesBefore) + ' 次')

  before = countBefore(ctx)
  const reopened = await b.reopen(REPO, '01', ctx)
  check(reopened.ok === true, '重开成功 → ' + (reopened.ok ? '状态=' + reopened.data.state : JSON.stringify(reopened.error)))
  checkOneMore(ctx, before, '重开')
  f = checkShape(lastLine(ctx), '重开')
  check(f.kind === 'reopen' && f.reason === 'edited', '重开：kind=reopen、reason=edited → ' + f.kind + '/' + f.reason)

  // 失败一档：找不到这张票，写路径压根没走到。
  before = countBefore(ctx)
  const missing = await b.close(REPO, '99', {}, ctx)
  check(missing.ok === false, '关一张不存在的票：如实失败 → ' + (missing.ok ? '竟然成功' : missing.error.kind))
  checkOneMore(ctx, before, '关票失败')
  f = checkShape(lastLine(ctx), '关票失败')
  check(f.ok === false && f.reason === 'fail:' + (missing.ok ? '' : missing.error.kind), '关票失败：reason=fail:档位 → ' + f.reason)
  check(f.written === 0 && f.route === 'none', '关票失败：written=0、route=none → ' + f.written + '/' + f.route)
}

console.log('== 三、改票、贴标签、改认领、评论：各自认得出是哪一类写，没改到盘上就记 noop ==')
{
  const root = ws('c', [['01-a.md', 'ready-for-agent'], ['02-b.md', 'ready-for-agent'], ['03-c.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)

  let before = countBefore(ctx)
  const upd = await b.update(REPO, '01', { title: '换一个标题' }, ctx)
  check(upd.ok === true, '改标题成功 → ' + (upd.ok ? upd.data.title : JSON.stringify(upd.error)))
  checkOneMore(ctx, before, '改票')
  let f = checkShape(lastLine(ctx), '改票')
  check(f.kind === 'update' && f.reason === 'edited', '改票：kind=update、reason=edited → ' + f.kind + '/' + f.reason)

  before = countBefore(ctx)
  const writesBefore = ctx.writes.length
  const noopUpd = await b.update(REPO, '01', {}, ctx)
  check(noopUpd.ok === true, '空补丁改票：照样回成功 → ' + (noopUpd.ok ? 'ok' : JSON.stringify(noopUpd.error)))
  checkOneMore(ctx, before, '空补丁改票')
  f = checkShape(lastLine(ctx), '空补丁改票')
  check(f.kind === 'update' && f.reason === 'noop' && f.written === 0, '空补丁改票：reason=noop、written=0 → ' + f.reason + '/' + f.written)
  check(ctx.writes.length === writesBefore, '空补丁改票：一次写盘都没发生 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次')

  before = countBefore(ctx)
  const labeled = await b.setLabels(REPO, '02', ['bug'], {}, ctx)
  check(labeled.ok === true, '贴标签成功 → ' + (labeled.ok ? JSON.stringify(labeled.data.labels) : JSON.stringify(labeled.error)))
  checkOneMore(ctx, before, '贴标签')
  f = checkShape(lastLine(ctx), '贴标签')
  check(f.kind === 'setLabels' && f.reason === 'edited', '贴标签：kind=setLabels、reason=edited → ' + f.kind + '/' + f.reason)

  before = countBefore(ctx)
  const writesBefore2 = ctx.writes.length
  const labeledAgain = await b.setLabels(REPO, '02', ['bug'], {}, ctx)
  check(labeledAgain.ok === true, '同一批标签再贴一次：照样回成功 → ' + (labeledAgain.ok ? 'ok' : JSON.stringify(labeledAgain.error)))
  f = checkShape(lastLine(ctx), '同一批标签再贴一次')
  check(f.reason === 'noop' && f.written === 0, '同一批标签再贴一次：reason=noop、written=0 → ' + f.reason + '/' + f.written)
  check(ctx.writes.length === writesBefore2, '同一批标签再贴一次：一次写盘都没发生 → 实得 ' + (ctx.writes.length - writesBefore2) + ' 次')

  before = countBefore(ctx)
  const assigned = await b.setAssignees(REPO, '03', [{ login: 'alice', kind: 'user' }], {}, ctx)
  check(assigned.ok === true, '改认领成功 → ' + (assigned.ok ? 'ok' : JSON.stringify(assigned.error)))
  checkOneMore(ctx, before, '改认领')
  f = checkShape(lastLine(ctx), '改认领')
  check(f.kind === 'setAssignees' && f.reason === 'edited', '改认领：kind=setAssignees、reason=edited → ' + f.kind + '/' + f.reason)

  before = countBefore(ctx)
  const commented = await b.comment(REPO, '03', '这是一条评论', ctx)
  check(commented.ok === true, '评论成功 → ' + (commented.ok ? 'ok' : JSON.stringify(commented.error)))
  checkOneMore(ctx, before, '评论')
  f = checkShape(lastLine(ctx), '评论')
  check(f.kind === 'comment' && f.reason === 'edited' && f.written === 1, '评论：kind=comment、reason=edited、written=1 → ' + f.kind + '/' + f.reason + '/' + f.written)
}

console.log('== 四、读不动的票文件：如实失败，档位落在结论线上 ==')
{
  const root = ws('d', [['01-ok.md', 'ready-for-agent'], ['02-locked.md', 'ready-for-agent']])
  const ctx = makeCtx(root, ['02-locked.md'])
  const b = createMarkdownBackend(ctx)

  const before = countBefore(ctx)
  const locked = await b.close(REPO, '02', {}, ctx)
  check(locked.ok === false, '票文件读不动：关票如实失败 → ' + (locked.ok ? '竟然成功' : locked.error.kind))
  checkOneMore(ctx, before, '读不动时关票')
  const f = checkShape(lastLine(ctx), '读不动时关票')
  check(f.ok === false && f.reason === 'fail:' + (locked.ok ? '' : locked.error.kind), '读不动时关票：reason=fail:档位，档位与返回的 error.kind 一致 → ' + f.reason)
  check(f.written === 0 && f.route === 'none', '读不动时关票：written=0、route=none（没写下去）→ ' + f.written + '/' + f.route)
}

console.log('== 五、形状、噪音与「没有日志上下文也不许变」 ==')
{
  const root = ws('e', [['01-a.md', 'ready-for-agent']])

  // 没有 logEvent 的上下文：照样写得出结果、也不抛。
  const silent = makeCtx(root, [], false)
  const bSilent = createMarkdownBackend(silent)
  const r = await bSilent.update(REPO, '01', { title: '没有日志上下文也照样改' }, silent)
  check(r.ok === true && r.data.title === '没有日志上下文也照样改', '没有 logEvent 的上下文：改票照旧成功 → ' + (r.ok ? r.data.title : JSON.stringify(r.error)))
  check(silent.events.length === 0, '没有 logEvent 的上下文：一条日志都没落、也没抛 → 实得 ' + silent.events.length + ' 行')

  // 一趟里同一个故障只留一行：读不动那一趟已经断言过「恰好一行」，这里再核一次字段里没有票号这类原文。
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)
  await b.update(REPO, '01', { title: '再看一次字段' }, ctx)
  const line = lastLine(ctx)
  const text = JSON.stringify(line && line.fields)
  check(!/#\d|01-a\.md|\.scratch|再看一次字段/.test(text), '字段里没有票号、文件名、路径、标题原文 → ' + text)
}

console.log('== 六、两张表两向对账：表里每一条都走到过，表外一个都没出现 ==')
{
  const kindTable = ISSUE_WRITE_KINDS as readonly string[]
  const missingKinds = kindTable.filter((k) => !seenKinds.has(k))
  check(missingKinds.length === 0, '写操作表 ' + kindTable.length + ' 条逐条都在本文件里走到过 → 没走到的：' + (missingKinds.join(' / ') || '无'))
  const extraKinds = Array.from(seenKinds).filter((k) => kindTable.indexOf(k) < 0)
  check(extraKinds.length === 0, '出现过的 kind 全在表里（代码里没有拼错的字符串）→ 表外的：' + (extraKinds.join(' / ') || '无'))

  const reasonTable = ISSUE_WRITE_REASONS as readonly string[]
  const missingReasons = reasonTable.filter((r) => !seenReasons.has(r))
  check(missingReasons.length === 0, '结论表 ' + reasonTable.length + ' 条逐条都在本文件里走到过 → 没走到的：' + (missingReasons.join(' / ') || '无'))
  const extraReasons = Array.from(seenReasons).filter((r) => reasonTable.indexOf(r) < 0)
  check(extraReasons.length === 0, '出现过的结论全在表里 → 表外的：' + (extraReasons.join(' / ') || '无'))

  const errorKinds = Object.values(ERROR_KIND) as string[]
  for (const k of seenFailKinds) check(errorKinds.includes(k), 'fail: 后面的档位是契约里的真档位 → ' + k)
  check(seenFailKinds.size > 0, '失败那一档在本文件里走到过（fail:档位 至少出现一次）→ 实得 ' + Array.from(seenFailKinds).join('、') + ' 种')
}

fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log(failed ? '\n存在失败 — verify-1059-issue-write 未通过' : '\n全部通过 — 本地 Markdown 房写路径的结论线落到了每一档')
process.exit(failed ? 1 : 0)
