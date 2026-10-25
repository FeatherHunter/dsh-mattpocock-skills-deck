/**
 * tests/verify-1058-markdown-read-log.ts —— 本地 Markdown 后端读路径结论线的门禁（#1058）。
 *
 * 这一道断的是「读这一趟没读成」的那条线在解析路径上真的落了地。本地房的读路径此前一条日志都没有：
 * 票文件读不动时 list 静默少一行、计数整体失败、翻页失败、取单票找不到——事后拿导出包的人在这些路上
 * 看到的是「什么都没有」，分不清「没走这条路」还是「走了、折在中间」。
 *
 * 分两件事断：
 *   一、**每一条降级都留得下**：票文件读不动、地图文件读不动、目录根本列不出来、翻页游标对不上、
 *       取单票找不到、探测找不到地图、预检中途出错——各按操作落一行，`op` 与 `reason` 都对得上。
 *   二、**读数不变、噪音不涨**：一趟干净的读一行都不记；夹具形态的工作区（没有 .scratch）一行都不记；
 *       同一个故障在一趟里只留一条线（主形态读不动之后还会再试夹具形态，不算两件事）；
 *       没有 `logEvent` 的上下文照样读得出原来的结果，也不抛。
 *
 * 最后一条断言把方向反过来：**取值表里的每一条都在本文件里走到过**，表外的取值一个都没出现过——
 * 表有落点、落点在表里，两个方向都钉住（这正是「表里某条没人走到」与「代码里拼错一个值」这两类
 * 事故各自的拦法）。
 *
 * 全程在系统临时目录里造工作区，用与 tests/verify-691-markdown-counts-page.js 同一套 fs/platform
 * 适配器形状；不打真网、不碰真实工作区（临时目录用完即删）。两种「读不动」都由适配器造出来：
 * 指定文件名读取时抛错（相当于权限不足 / 读到时已被删 / 被锁住），指定目录名列目录时抛错
 * （相当于那个目录列不出来）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1058-markdown-read-log.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { listIssues, getIssue } from '../src/tracker/rooms/markdown/issues-read.ts'
import { countIssues } from '../src/tracker/rooms/markdown/counts.ts'
import { listIssuesPage } from '../src/tracker/rooms/markdown/page.ts'
import { createMarkdownBackend, matches } from '../src/tracker/rooms/markdown/index.ts'
import { READ_DEGRADED_OPS, READ_DEGRADED_REASONS } from '../src/tracker/rooms/markdown/read-log.ts'

type LogLine = { level: string; event: string; fields: Record<string, unknown> }
type Ctx = {
  platform: { path: typeof path.posix; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  opId: string
  events: LogLine[]
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  isEnabled: (level: string) => boolean
  get: (name: string) => unknown
}

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
/** 本文件里出现过的全部降级取值：收尾那一条断言拿它跟取值表对账。 */
const seen = new Set<string>()

/** 与 tests/verify-691-markdown-counts-page.js 同一套适配器形状。
 *  `unreadableFiles` 里的文件名在读的时候抛错；`unreadableDirs` 里的目录名在列的时候抛错。
 *  另外把每一条 read.degraded 收进 ctx.events，供本门禁逐条对（op、reason、字段形状）。
 *  `denyRead` 是可选的第二个判据：命中就拒（#1182 第九节要用「路径以某个名字结尾」这种判法，
 *  光靠 `unreadableFiles` 比文件名不够用 —— 那边要拒的是深层路径 `docs/agents/issue-tracker.md`）。 */
function makeCtx(cwd: string, unreadableFiles: string[] = [], unreadableDirs: string[] = [], denyRead?: (p: string) => boolean): Ctx {
  const denied = (what: string, t: string) => {
    const e = new Error('EACCES: permission denied, ' + what + ' ' + t) as Error & { code?: string }
    e.code = 'EACCES'
    return e
  }
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) {
        const name = String(t).split('/').pop() as string
        if (unreadableFiles.includes(name) || (denyRead ? denyRead(String(t)) : false)) throw denied('open', t)
        return fs.readFileSync(t, 'utf8')
      },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) {
        if (unreadableDirs.includes(String(t).split('/').pop() as string)) throw denied('scandir', t)
        try { return fs.readdirSync(t) } catch { return [] }
      },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const events: LogLine[] = []
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1058',
    events,
    logEvent(level: string, event: string, fields: Record<string, unknown>) { events.push({ level, event, fields }) },
    isEnabled() { return true },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
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

const REPO = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1058-readlog-'))

/** 调用识别那一趟：`matches` 是模块级导出（不在房间工厂实例上），照注册表那条路调。
 *  `refId` 照真实注册表给的形状传（`.scratch/<工作单元>`），于是候选位置里就有那一处的地图。 */
const matchCall = (ctx: Ctx, cwd: string, refId = '') => matches({ cwd, refId } as never, ctx as never)
/** 识别这一趟用平台对象拼路径（适配器的 path 就是 path.posix），所以工作区路径要先换成正斜杠写法：
 *  否则 Windows 上 `C:\…\ws` 与 `.scratch/map.md` 拼出来是 `C:\…\ws/.scratch/map.md`，真盘上读不到。 */
const posixWs = (p: string) => p.split('\\').join('/')

/** 只看 read.degraded 那一条线：别的日志（判档那条 error.normalize 是调试级）不算本门禁的账。
 *  顺手把出现过的取值收进 seen，供最后一条断言跟取值表对账。 */
const degraded = (ctx: Ctx) => {
  const lines = ctx.events.filter((e) => e.event === 'read.degraded')
  for (const l of lines) seen.add(String(l.fields.reason))
  return lines
}
/** 一行读路径结论线该长什么样：级别告警、op 与 reason 都在登记表里、字段恰好四键。 */
function lineText(e: LogLine) { return 'op=' + String(e.fields.op) + ' reason=' + String(e.fields.reason) }
function checkShape(e: LogLine, label: string) {
  const keys = Object.keys(e.fields).sort().join(',')
  check(e.level === 'warn', label + '：级别是告警级（始终落盘，不必先开调试开关）')
  check(keys === 'latencyMs,op,opId,reason', label + '：字段恰好四键 op/reason/latencyMs/opId → 实得 ' + keys)
  check((READ_DEGRADED_OPS as readonly string[]).includes(String(e.fields.op)), label + '：op 在登记的操作表里 → ' + String(e.fields.op))
  check((READ_DEGRADED_REASONS as readonly string[]).includes(String(e.fields.reason)), label + '：reason 在登记的取值表里 → ' + String(e.fields.reason))
  check(typeof e.fields.latencyMs === 'number' && (e.fields.latencyMs as number) >= 0, label + '：latencyMs 是非负毫秒数 → ' + String(e.fields.latencyMs))
  check(e.fields.opId === 'test-op-1058', label + '：opId 原样取上下文的编号 → ' + String(e.fields.opId))
}

console.log('== 一、票文件读不动：读法不变，但这一趟不再无声 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-a-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent'], ['02-broken.md', 'ready-for-agent'], ['03-open-c.md', 'claimed']])

  const listCtx = makeCtx(ws, ['02-broken.md'])
  const rows = await listIssues(listCtx, REPO, {})
  check(rows.ok && rows.data.length === 3, 'list 照旧静默跳过读不动的票（3 行 = 1 张地图行 + 2 张票）→ 实得 ' + (rows.ok ? rows.data.length : '失败') + ' 行')
  const listLines = degraded(listCtx)
  check(listLines.length === 1 && String(listLines[0].fields.reason) === 'list:ticket-read-fail',
    'list 落一行 read.degraded（list:ticket-read-fail）→ ' + listLines.map(lineText).join(' / '))
  if (listLines.length) checkShape(listLines[0], 'list 那一行')

  const countsCtx = makeCtx(ws, ['02-broken.md'])
  const counted = await countIssues(countsCtx, REPO, {})
  check(!counted.ok, 'counts 照旧整体失败（拒绝回一个偏小的数）→ ' + (counted.ok ? '竟然成功了' : String(counted.error.message).slice(0, 40) + '…'))
  const countsLines = degraded(countsCtx)
  check(countsLines.length === 1 && String(countsLines[0].fields.reason) === 'counts:read-fail' && String(countsLines[0].fields.op) === 'counts',
    'counts 落一行 read.degraded（counts:read-fail）→ ' + countsLines.map(lineText).join(' / '))
  if (countsLines.length) checkShape(countsLines[0], 'counts 那一行')

  const pageCtx = makeCtx(ws, ['02-broken.md'])
  const paged = await listIssuesPage(pageCtx, REPO, {}, {})
  check(!paged.ok, 'listPage 照旧整体失败 → ' + (paged.ok ? '竟然成功了' : String(paged.error.message).slice(0, 40) + '…'))
  const pageLines = degraded(pageCtx)
  check(pageLines.length === 1 && String(pageLines[0].fields.reason) === 'listPage:read-fail' && String(pageLines[0].fields.op) === 'listPage',
    'listPage 落一行 read.degraded（listPage:read-fail）→ ' + pageLines.map(lineText).join(' / '))
  if (pageLines.length) checkShape(pageLines[0], 'listPage 那一行')
}

console.log('\n== 二、地图文件读不动：票行照旧出，地图容器行没了 —— 三条读路各留一行 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-b-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent']])

  const listCtx = makeCtx(ws, ['map.md'])
  const rows = await listIssues(listCtx, REPO, {})
  check(rows.ok && rows.data.length === 1, 'list 照旧回 1 行（地图那行读不动，票照出）→ 实得 ' + (rows.ok ? rows.data.length : '失败') + ' 行')
  const listLines = degraded(listCtx)
  check(listLines.length === 1 && String(listLines[0].fields.reason) === 'list:map-read-fail',
    'list 落一行 read.degraded（list:map-read-fail）→ ' + listLines.map(lineText).join(' / '))
  if (listLines.length) checkShape(listLines[0], '地图读不动那一行（list）')

  const countsCtx = makeCtx(ws, ['map.md'])
  const counted = await countIssues(countsCtx, REPO, {})
  const countsLines = degraded(countsCtx)
  check(!!counted.ok && String(countsLines[0] && countsLines[0].fields.reason) === 'counts:map-read-fail',
    'counts 落一行 read.degraded（counts:map-read-fail，计数照旧不受地图影响）→ ' + (countsLines.map(lineText).join(' / ') || '一行都没有'))

  const pageCtx = makeCtx(ws, ['map.md'])
  const paged = await listIssuesPage(pageCtx, REPO, {}, {})
  const pageLines = degraded(pageCtx)
  check(!!paged.ok && String(pageLines[0] && pageLines[0].fields.reason) === 'listPage:map-read-fail',
    'listPage 落一行 read.degraded（listPage:map-read-fail）→ ' + (pageLines.map(lineText).join(' / ') || '一行都没有'))
}

console.log('\n== 三、翻页游标两档：这个游标跟现在这份数据对不上 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-c-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent'], ['02-open-b.md', 'ready-for-agent']])

  const badCtx = makeCtx(ws)
  const bad = await listIssuesPage(badCtx, REPO, {}, { cursor: 'not-a-number' })
  check(!bad.ok, '游标不是数字 → 照旧失败并说「请重新加载」→ ' + (bad.ok ? '竟然成功了' : '失败'))
  const badLines = degraded(badCtx)
  check(badLines.length === 1 && String(badLines[0].fields.reason) === 'listPage:cursor',
    '落一行 read.degraded（listPage:cursor）→ ' + badLines.map(lineText).join(' / '))
  if (badLines.length) checkShape(badLines[0], '游标不是数字那一行')

  const staleCtx = makeCtx(ws)
  const stale = await listIssuesPage(staleCtx, REPO, {}, { cursor: '99' })
  check(!stale.ok, '游标越过现有行数 → 照旧失败 → ' + (stale.ok ? '竟然成功了' : '失败'))
  const staleLines = degraded(staleCtx)
  check(staleLines.length === 1 && String(staleLines[0].fields.reason) === 'listPage:cursor-stale',
    '落一行 read.degraded（listPage:cursor-stale，与上一档可区分）→ ' + staleLines.map(lineText).join(' / '))
  if (staleLines.length) checkShape(staleLines[0], '游标越界那一行')
}

console.log('\n== 四、取单票三档与探测找不到地图 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-d-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent'], ['02-broken.md', 'ready-for-agent']])

  const noKeyCtx = makeCtx(ws)
  const noKey = await getIssue(noKeyCtx, REPO, '')
  check(!noKey.ok, '没给编号 → 照旧失败 → ' + (noKey.ok ? '竟然成功了' : '失败'))
  const noKeyLines = degraded(noKeyCtx)
  check(noKeyLines.length === 1 && String(noKeyLines[0].fields.reason) === 'get:no-key' && String(noKeyLines[0].fields.op) === 'get',
    '落一行 read.degraded（get:no-key）→ ' + noKeyLines.map(lineText).join(' / '))
  if (noKeyLines.length) checkShape(noKeyLines[0], '没给编号那一行')

  const missingCtx = makeCtx(ws)
  const missing = await getIssue(missingCtx, REPO, '77')
  check(!missing.ok, '这个编号没有票文件 → 照旧失败 → ' + (missing.ok ? '竟然成功了' : '失败'))
  const missingLines = degraded(missingCtx)
  check(missingLines.length === 1 && String(missingLines[0].fields.reason) === 'get:notfound',
    '落一行 read.degraded（get:notfound）→ ' + missingLines.map(lineText).join(' / '))
  if (missingLines.length) checkShape(missingLines[0], '找不到那一行')

  const brokenCtx = makeCtx(ws, ['02-broken.md'])
  const broken = await getIssue(brokenCtx, REPO, '2')
  check(!broken.ok, '票文件读不动 → 照旧失败 → ' + (broken.ok ? '竟然成功了' : '失败'))
  const brokenLines = degraded(brokenCtx)
  check(brokenLines.length === 1 && String(brokenLines[0].fields.reason) === 'get:read-fail',
    '落一行 read.degraded（get:read-fail）→ ' + brokenLines.map(lineText).join(' / '))
  if (brokenLines.length) checkShape(brokenLines[0], '读的时候出错那一行')

  const emptyWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-empty-'))
  const probeCtx = makeCtx(emptyWs)
  const backend = createMarkdownBackend(probeCtx)
  const probe = await backend.preflight({ cwd: emptyWs } as never, probeCtx as never)
  check(!probe.ok, '空工作区探测 → 照旧回「找不到地图文件」→ ' + (probe.ok ? '竟然成功了' : '失败'))
  const probeLines = degraded(probeCtx)
  check(probeLines.length === 1 && String(probeLines[0].fields.reason) === 'preflight:no-map',
    '落一行 read.degraded（preflight:no-map）→ ' + probeLines.map(lineText).join(' / '))
  if (probeLines.length) checkShape(probeLines[0], '探测那一行')
}

console.log('\n== 四之二、读取端认得旧布局与退化身份（#1488）：兼容与退化各留一行 ==')
{
  // 旧版工作区根 issues/：票照常读出，留一条 legacy-root 说明「走的是兼容路径」，
  // 排查「为什么这张票不在 .scratch 下」时一眼能看到。
  const legacyWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-legacy-'))
  fs.mkdirSync(path.join(legacyWs, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(legacyWs, 'issues', '01-old.md'), '# 旧票\n\nStatus: ready-for-agent\n', 'utf8')
  const LEGACY_REPO = { backend: 'markdown', refId: '', name: '', url: '' }

  const legacyListCtx = makeCtx(legacyWs)
  const legacyRows = await listIssues(legacyListCtx, LEGACY_REPO, {})
  check(legacyRows.ok && legacyRows.data.length === 1, '旧版根目录票 list 照常读出（1 行）→ 实得 ' + (legacyRows.ok ? legacyRows.data.length : '失败') + ' 行')
  const legacyListLines = degraded(legacyListCtx)
  check(legacyListLines.length === 1 && String(legacyListLines[0].fields.reason) === 'list:legacy-root',
    'list 落一行 read.degraded（list:legacy-root）→ ' + legacyListLines.map(lineText).join(' / '))
  if (legacyListLines.length) checkShape(legacyListLines[0], '旧根目录票那一行（list）')

  const legacyGetCtx = makeCtx(legacyWs)
  const legacyGot = await getIssue(legacyGetCtx, LEGACY_REPO, '01')
  check(!!legacyGot.ok, '旧版根目录票 get 照常读出 → ' + (legacyGot.ok ? '成功' : '失败'))
  const legacyGetLines = degraded(legacyGetCtx)
  check(legacyGetLines.length === 1 && String(legacyGetLines[0].fields.reason) === 'get:legacy-root',
    'get 落一行 read.degraded（get:legacy-root）→ ' + legacyGetLines.map(lineText).join(' / '))
  if (legacyGetLines.length) checkShape(legacyGetLines[0], '旧根目录票那一行（get）')

  // 同一目录里重复编号：显示退化成「目录/编号-文件名」，读得出来，留 dup-number 日志。
  const dupWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-dup-'))
  writeEffort(dupWs, 'demo', [['01-one.md', 'ready-for-agent'], ['01-two.md', 'ready-for-agent']])

  const dupListCtx = makeCtx(dupWs)
  const dupRows = await listIssues(dupListCtx, REPO, {})
  check(dupRows.ok, '重复编号时 list 不抛错、照常成功')
  const dupListLines = degraded(dupListCtx)
  check(dupListLines.length === 1 && String(dupListLines[0].fields.reason) === 'list:dup-number',
    'list 只落一行 read.degraded（list:dup-number，同趟不按文件数刷屏）→ ' + dupListLines.map(lineText).join(' / '))
  if (dupListLines.length) checkShape(dupListLines[0], '重复编号那一行（list）')

  const dupGetCtx = makeCtx(dupWs)
  const dupGot = await getIssue(dupGetCtx, REPO, 'demo/01-one')
  check(!!dupGot.ok && String((dupGot.data as { title?: string }).title) === '01-one.md', '退化身份照常读得回（key 是「目录/编号-文件名」）→ ' + (dupGot.ok ? String((dupGot.data as { title?: string }).title) : '失败'))
  const dupGetLines = degraded(dupGetCtx)
  check(dupGetLines.length === 1 && String(dupGetLines[0].fields.reason) === 'get:dup-number',
    'get 落一行 read.degraded（get:dup-number）→ ' + dupGetLines.map(lineText).join(' / '))
  if (dupGetLines.length) checkShape(dupGetLines[0], '重复编号那一行（get）')

  // 版本号不认得（#1499）：文件头写了 DSH-FORMAT: md-v2，但本插件只认 md-v1。
  // 读路径按旧口径照常读出结果，只多留一行 bad-format —— 事后分得清「按新格式读对了」还是「按旧格式误读了」。
  const badWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-badfmt-'))
  writeEffort(badWs, 'demo', [['01-ok.md', 'ready-for-agent']])
  fs.writeFileSync(path.join(badWs, '.scratch', 'demo', 'issues', '02-bad.md'),
    '<!-- DSH-FORMAT: md-v2 -->\n# 02-bad.md\n\nStatus: ready-for-agent\n\n## Body\n\n坏版本号\n', 'utf8')

  const badListCtx = makeCtx(badWs)
  const badRows = await listIssues(badListCtx, REPO, {})
  check(badRows.ok && badRows.data.length === 3, '坏版本号 list 照常读出（地图 + 2 票 = 3 行，结果不变）→ 实得 ' + (badRows.ok ? badRows.data.length : '失败') + ' 行')
  const badListLines = degraded(badListCtx)
  check(badListLines.length === 1 && String(badListLines[0].fields.reason) === 'list:bad-format',
    'list 落一行 read.degraded（list:bad-format，同趟不按文件数刷屏）→ ' + badListLines.map(lineText).join(' / '))
  if (badListLines.length) checkShape(badListLines[0], '坏版本号那一行（list）')

  const badGetCtx = makeCtx(badWs)
  const badGot = await getIssue(badGetCtx, REPO, '02')
  check(!!badGot.ok, '坏版本号 get 照常读出 → ' + (badGot.ok ? '成功' : '失败'))
  const badGetLines = degraded(badGetCtx)
  check(badGetLines.length === 1 && String(badGetLines[0].fields.reason) === 'get:bad-format',
    'get 落一行 read.degraded（get:bad-format）→ ' + badGetLines.map(lineText).join(' / '))
  if (badGetLines.length) checkShape(badGetLines[0], '坏版本号那一行（get）')
}

console.log('\n== 五、连目录都列不出来（不是「这里没有」）：四条读路各留一行 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-e-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent']])

  const listCtx = makeCtx(ws, [], ['.scratch'])
  const rows = await listIssues(listCtx, REPO, {})
  const listLines = degraded(listCtx)
  check(!rows.ok && String(listLines[0] && listLines[0].fields.reason) === 'list:fs-fail',
    'list：照旧如实失败，落一行 list:fs-fail → ' + (listLines.map(lineText).join(' / ') || '一行都没有'))
  if (listLines.length) checkShape(listLines[0], '列不出目录那一行（list）')

  const countsCtx = makeCtx(ws, [], ['.scratch'])
  const counted = await countIssues(countsCtx, REPO, {})
  const countsLines = degraded(countsCtx)
  check(!counted.ok && String(countsLines[0] && countsLines[0].fields.reason) === 'counts:fs-fail',
    'counts：照旧如实失败，落一行 counts:fs-fail → ' + (countsLines.map(lineText).join(' / ') || '一行都没有'))

  const pageCtx = makeCtx(ws, [], ['.scratch'])
  const paged = await listIssuesPage(pageCtx, REPO, {}, {})
  const pageLines = degraded(pageCtx)
  check(!paged.ok && String(pageLines[0] && pageLines[0].fields.reason) === 'listPage:fs-fail',
    'listPage：照旧如实失败，落一行 listPage:fs-fail → ' + (pageLines.map(lineText).join(' / ') || '一行都没有'))

  const getCtx = makeCtx(ws, [], ['.scratch'])
  let getThrew = false
  try { await getIssue(getCtx, REPO, '1') } catch { getThrew = true }
  const getLines = degraded(getCtx)
  check(getThrew && String(getLines[0] && getLines[0].fields.reason) === 'get:fs-fail',
    'get：定位这一路把「列不出来」抛上来，抛之前先落一行 get:fs-fail → ' + (getLines.map(lineText).join(' / ') || '一行都没有'))
  if (getLines.length) checkShape(getLines[0], '列不出目录那一行（get）')
}

console.log('\n== 六、预检中途出错：探测这一关自己炸了，也要留一行 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-f-'))
  const ctx = makeCtx(ws)
  const backend = createMarkdownBackend(ctx)
  // 用一个形状不对的 cwd（不是字符串）让预检内部的路径拼接当场抛错 —— 这一支现实中对应
  // 「探测中途读到一半出错」，与上面那条「找不到地图文件」是两回事。
  const probe = await backend.preflight({ cwd: 123 } as never, ctx as never)
  const lines = degraded(ctx)
  check(!probe.ok && String(lines[0] && lines[0].fields.reason) === 'preflight:fs-fail',
    '预检中途出错 → 照旧如实失败，落一行 preflight:fs-fail → ' + (lines.map(lineText).join(' / ') || '一行都没有'))
  if (lines.length) checkShape(lines[0], '预检出错那一行')
}

console.log('\n== 七、反向断言：一次故障只留一条线 ==')
{
  // 地图与票文件都读不动：主形态一条线都读不出来，于是房间里还会再试一次夹具形态，
  // 而夹具形态常常指回同一批文件 —— 同一个故障不许记两遍，也不许贴一条「走了夹具兜底形态」。
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-g-'))
  writeEffort(ws, 'demo', [['01-broken.md', 'ready-for-agent']])
  const ctx = makeCtx(ws, ['map.md', '01-broken.md'])
  const rows = await listIssues(ctx, REPO, {})
  const lines = degraded(ctx)
  check(!!rows.ok, '整房读不动时 list 照旧回成功（读法一个字没变）→ ' + (rows.ok ? '成功' : '失败'))
  check(lines.length === 2, '一次故障只留两条线（地图读不动、票文件读不动各一条）→ 实得 ' + lines.length + ' 条：' + lines.map(lineText).join(' / '))
  check(!lines.some((l) => String(l.fields.reason).indexOf('fallback') >= 0), '不留「走了夹具兜底形态」那条假线 → ' + lines.map(lineText).join(' / '))
}

console.log('\n== 八、反向断言：干净的读、夹具形态的工作区，一行都不记；没有日志上下文也不许出事 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-h-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent'], ['02-closed-b.md', 'resolved']])
  const ctx = makeCtx(ws)
  const rows = await listIssues(ctx, REPO, {})
  const counted = await countIssues(ctx, REPO, {})
  const paged = await listIssuesPage(ctx, REPO, {}, {})
  const one = await getIssue(ctx, REPO, '1')
  check(!!rows.ok && !!counted.ok && !!paged.ok && !!one.ok, '一趟干净的读：四样都成 → ' + [rows.ok, counted.ok, paged.ok, one.ok].join('/'))
  check(degraded(ctx).length === 0, '干净的一趟一行 read.degraded 都不记（日志不许当心跳刷屏）→ 实得 ' + degraded(ctx).length + ' 行')

  // 夹具形态：没有 .scratch，工作区里就是 map.md 与 issues/ 两个东西 —— 这是本房支持的第三种布局，
  // 那里的读是完整的，不是降级，记了就成了每趟都响的心跳。
  const fixWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-i-'))
  fs.mkdirSync(path.join(fixWs, 'demo', 'issues'), { recursive: true })
  fs.writeFileSync(path.join(fixWs, 'demo', 'map.md'), '# 夹具地图\n\nStatus: ready-for-agent\n\n## Destination\n\n夹具\n', 'utf8')
  fs.writeFileSync(path.join(fixWs, 'demo', 'issues', '01-a.md'), '# 01-a\n\nStatus: ready-for-agent\n\n## Body\n\n夹具票\n', 'utf8')
  const fixCtx = makeCtx(fixWs)
  const fixRows = await listIssues(fixCtx, { backend: 'markdown', refId: 'demo', name: 'demo', url: '' }, {})
  check(!!fixRows.ok && fixRows.data.length === 2, '夹具形态的工作区照旧读出 2 行（地图 + 票）→ 实得 ' + (fixRows.ok ? fixRows.data.length : '失败') + ' 行')
  check(degraded(fixCtx).length === 0, '夹具形态的工作区一行 read.degraded 都不记（那不是降级）→ 实得 ' + degraded(fixCtx).length + ' 行')

  const silent = makeCtx(ws)
  delete (silent as { logEvent?: unknown }).logEvent
  const silentRows = await listIssues(silent, REPO, {})
  const silentCounts = await countIssues(silent, REPO, {})
  check(!!silentRows.ok && silentRows.data.length === 3 && !!silentCounts.ok && silentCounts.data.total === 2,
    '上下文没有 logEvent 时：读的结果一个字节不变（3 行 / 2 张票）→ 实得 ' + (silentRows.ok ? silentRows.data.length : '失败') + ' 行 / ' + (silentCounts.ok ? silentCounts.data.total : '失败') + ' 张')

  const quietWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-j-'))
  writeEffort(quietWs, 'demo', [['01-broken.md', 'ready-for-agent']])
  const quiet = makeCtx(quietWs, ['01-broken.md'])
  delete (quiet as { logEvent?: unknown }).logEvent
  const quietRows = await listIssues(quiet, REPO, {})
  check(!!quietRows.ok && quietRows.data.length === 1,
    '读不动、又没有日志上下文时：静默跳过照旧（只回 1 行地图行），不抛 → 实得 ' + (quietRows.ok ? quietRows.data.length : '抛了') + ' 行')
}

console.log('\n== 九、识别这一趟（matches）三档落点：#1182 第 4 件，照 GitLab 房 #1130 的口径 ==')
{
  // 判据与别的操作不一样：**哪一层没能给出答案才记** —— 一层读成功了不记（读到了内容、
  // 只是里面没写 Local Markdown，那是正常的否定结论；GitHub / GitLab 工作区走这一趟
  // 一个字都不该多）。所以下面既有「该记的三档」，也有「一行都不许记」的两档。
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-k-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent']])
  const wsP = posixWs(ws)

  // 一档：分不出平台对象 —— `platform.path` 不是个能用的东西（这里给个字符串），`ctx.path` 也没有，
  // 候选路径根本拼不出来。这是故障，不是「这个工作区不是本地 Markdown」。
  const brokenPlatCtx = makeCtx(ws)
  ;(brokenPlatCtx.platform as { path: unknown }).path = 'not-a-path-impl'
  const brokenPlat = await matchCall(brokenPlatCtx, wsP)
  const brokenPlatLines = degraded(brokenPlatCtx)
  check(brokenPlat === false && brokenPlatLines.length === 1 && String(brokenPlatLines[0].fields.reason) === 'matches:fs-unavailable',
    'matches：平台对象分不出来 → 照旧回「不是」，落一行 matches:fs-unavailable → ' + (brokenPlatLines.map(lineText).join(' / ') || '一行都没有'))
  if (brokenPlatLines.length) checkShape(brokenPlatLines[0], 'matches 分不出平台那一行')

  // 二档：声明文件在，可两路读法都读不动（`exists` 走 stat 还看得见，read 两条路都被拒）。
  // 声明文件放在一个没有地图的工作区里，识别于是走到「读声明文件」这一步 —— 这一步读不动，
  // 整条识别就只剩「没认出来」，日志是唯一能说清「看过了、没看成」的地方。
  const docWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-m-'))
  fs.mkdirSync(path.join(docWs, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(docWs, 'docs', 'agents', 'issue-tracker.md'), '# 票仓\n\n后端：Local Markdown\n', 'utf8')
  const docCtxDenied = makeCtx(docWs, [], [], (p) => p.endsWith('docs/agents/issue-tracker.md'))
  const docMiss = await matchCall(docCtxDenied, posixWs(docWs))
  const docLines = degraded(docCtxDenied)
  check(docMiss === false && docLines.length === 1 && String(docLines[0].fields.reason) === 'matches:tracker-doc',
    'matches：声明文件读不动 → 照旧回「不是」，落一行 matches:tracker-doc → ' + (docLines.map(lineText).join(' / ') || '一行都没有'))
  if (docLines.length) checkShape(docLines[0], 'matches 读不动声明文件那一行')

  // 三档：整段抛了（平台对象形状怪、路径拼接抛错这类）—— 用一份第一次拼接就抛的 platform 造出来，
  // 抛点在候选路径那一段（不在声明文件那一段），于是掉到最外层那个 catch 记 matches:unknown。
  const throwCtx = makeCtx(ws)
  const realPlat = throwCtx.platform.path
  let joins = 0
  throwCtx.platform.path = {
    ...realPlat,
    join(...parts: string[]) { if (joins++ === 0) throw new Error('boom: join 抛了（模拟识别这一趟自己折了）'); return (realPlat.join as (...p: string[]) => string)(...parts) },
  } as typeof realPlat
  const threw = await matchCall(throwCtx, wsP)
  const threwLines = degraded(throwCtx)
  check(threw === false && threwLines.length === 1 && String(threwLines[0].fields.reason) === 'matches:unknown',
    'matches：识别这一趟自己折了 → 照旧回「不是」，落一行 matches:unknown → ' + (threwLines.map(lineText).join(' / ') || '一行都没有'))
  if (threwLines.length) checkShape(threwLines[0], 'matches 自己折了那一行')

  // 反向一档：地图在 → 认出 true，一行都不记。
  const hitCtx = makeCtx(ws)
  const hit = await matchCall(hitCtx, wsP, '.scratch/demo')
  check(hit === true && degraded(hitCtx).length === 0,
    'matches：`.scratch/map.md` 在 → 认出 true，一行都不记（成功那一趟不落线）→ ' + (degraded(hitCtx).map(lineText).join(' / ') || '零行'))

  // 反向一档：声明文件读了、里面没写 Local Markdown → 正常的否定结论，也不许记。
  const plainWs = fs.mkdtempSync(path.join(tmpRoot, 'ws-l-'))
  fs.mkdirSync(path.join(plainWs, 'docs', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(plainWs, 'docs', 'agents', 'issue-tracker.md'), '# 票仓\n\n后端：GitHub Issues\n', 'utf8')
  const plainCtx = makeCtx(plainWs)
  const plain = await matchCall(plainCtx, posixWs(plainWs))
  check(plain === false && degraded(plainCtx).length === 0,
    'matches：不是本地 Markdown 的工作区（读了内容、里面没写）→ 一行都不记（那是正常否定，不是降级）→ ' + (degraded(plainCtx).map(lineText).join(' / ') || '零行'))

  // 「没有 logEvent 也照样读得出原来的结论」这一条对 matches 同样成立。
  const silentMatchCtx = makeCtx(ws)
  delete (silentMatchCtx as { logEvent?: unknown }).logEvent
  const silentHit = await matchCall(silentMatchCtx, wsP, '.scratch/demo')
  check(silentHit === true, 'matches：上下文没有 logEvent 时照样认出 true（日志不许反过来左右识别）→ ' + String(silentHit))
}

console.log('\n== 九、取值表与落点两向对账 ==')
{
  const table = READ_DEGRADED_REASONS as readonly string[]
  const missing = table.filter((r) => !seen.has(r))
  check(missing.length === 0, '取值表 ' + table.length + ' 条逐条都在本文件里走到过 → 没走到的：' + (missing.join(' / ') || '无'))
  const extra = Array.from(seen).filter((r) => table.indexOf(r) < 0)
  check(extra.length === 0, '出现过的取值全在表里（代码里没有拼错的字符串）→ 表外的：' + (extra.join(' / ') || '无'))
}

fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log(failed ? '\n存在失败 — verify-1058-markdown-read-log 未通过' : '\n全部通过 — Markdown 房读路径结论线生效')
process.exit(failed ? 1 : 0)
