/**
 * #1605 本地 Markdown 房 listMaps（地图薄查）门禁：真实现的三条验收。
 * 做法是 TDD：本文件先行（RED），实现住 src/tracker/rooms/markdown/maps.ts。
 * #1611 起本地 url 不再是空串：薄查的 url 回盘上真实文件路径（与 list 同址），第一节据此断言。
 * 夹具 harness 照抄 tests/verify-1058-markdown-read-log.ts 的 makeCtx 与写盘格式
 * （同一套平台适配与票面写法，不另立口径）。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { listMaps } from '../src/tracker/rooms/markdown/maps.ts'

let failures = 0
function check(cond: unknown, msg: string) {
  if (cond) console.log('ok: ' + msg)
  else { failures++; console.error('FAIL: ' + msg) }
}

type Ctx = {
  platform: unknown; fs: unknown; cwd: string; opId: string; events: { level: string; event: string; fields: Record<string, unknown> }[];
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void;
  isEnabled: () => boolean; get: (name: string) => unknown;
}

function makeCtx(cwd: string, unreadableFiles: string[] = [], denyRead?: (p: string) => boolean): Ctx {
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
        try { return fs.readdirSync(t) } catch { return [] }
      },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const events: Ctx["events"] = []
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1605',
    events,
    logEvent(level: string, event: string, fields: Record<string, unknown>) { events.push({ level, event, fields }) },
    isEnabled() { return true },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
}

/** 写一个工作单元：地图 + 若干票；票每项是 [文件名, 状态, 标签(可空)]。mtime 由调用方随后定。 */
function writeEffort(root: string, effortId: string, tickets: Array<[string, string, string?]>) {
  const dir = path.join(root, '.scratch', effortId)
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 工作单元 ' + effortId + '\n\nStatus: ready-for-agent\n\n## Destination\n\n夹具\n', 'utf8')
  for (const [file, status, labels] of tickets) {
    const labelLine = labels ? '\nLabels: ' + labels + '\n' : ''
    fs.writeFileSync(path.join(dir, 'issues', file), '# ' + file + '\n\nStatus: ' + status + labelLine + '\n## Body\n\n夹具里的票\n', 'utf8')
  }
  return dir
}

const REPO = { backend: 'markdown', refId: 'ws', name: 'ws', url: '' }
const posixWs = (p: string) => p.split('\\').join('/')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1605-maplist-'))

/** 标准夹具：两个工作单元、三张地图（两张容器 + 一张带地图标签的票）。mtime 老→新：a-地图 < 标签票 < b-地图。 */
function standardWs() {
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-'))
  const dirA = writeEffort(ws, 'effort-a', [['01-a.md', 'ready-for-agent'], ['02-b.md', 'ready-for-agent', 'wayfinder:map']])
  const dirB = writeEffort(ws, 'effort-b', [])
  const t0 = new Date('2026-10-20T00:00:00Z'); const t1 = new Date('2026-10-22T00:00:00Z'); const t2 = new Date('2026-10-25T00:00:00Z')
  fs.utimesSync(path.join(dirA, 'map.md'), t0, t0)
  fs.utimesSync(path.join(dirA, 'issues', '02-b.md'), t1, t1)
  fs.utimesSync(path.join(dirB, 'map.md'), t2, t2)
  return ws
}

console.log('== 一、只收地图：容器与带标票都收，普通票不收 ==')
{
  const ws = standardWs()
  const ctx = makeCtx(posixWs(ws))
  const r = await listMaps(ctx as never, REPO as never) as {
    ok: boolean; data?: { rows: { key: string; title: string; state: string; url: string }[]; total: number; truncated: boolean }; error?: { kind: string; message: string }
  }
  check(r.ok === true, '薄查成功')
  const rows = (r.data && r.data.rows) || []
  check(rows.length === 3, '两张容器 + 一张带标票，共三行 → 实得 ' + rows.length)
  check(rows.every((x) => x.title && typeof x.url === 'string' && x.url !== ''), '每行都有标题，url 非空（#1611：本地回真实文件路径，不再诚实回空串）')
  check(rows.every((x) => { try { return fs.statSync(x.url).isFile() } catch { return false } }), '每行 url 都指向磁盘上真实存在的文件 → 实得 ' + rows.map((x) => x.url).join('、'))
  const containerRows = rows.filter((x) => x.key === '00')
  check(containerRows.length === 2 && containerRows.every((x) => x.url.split(/[\\/]/).pop() === 'map.md'), '两个容器行的 url 分别指向它那份 map.md')
  check(rows.some((x) => x.key === '02' && x.url.split(/[\\/]/).pop() === '02-b.md'), '带标票的 url 指向自己的票文件 02-b.md')
  check(rows.filter((x) => x.key === '00').length === 2, '纯容器行 key 沿用旧路的 00')
  check(rows.some((x) => x.key === '02'), '带标票保留自己的编号 02，与旧路同身份')
  check(rows.map((x) => x.key).join('|') === '00|02|00', '按更新时间倒序：b-地图、标签票、a-地图 → 实得 ' + rows.map((x) => x.key).join('|'))
  check(rows[0] && rows[0].title.indexOf('effort-b') >= 0, '最新的 b-地图排第一')
  check(((r.data && r.data.total) || -1) === 3, 'total 与行数一致')
  check((r.data && r.data.truncated) === false, '本地无服务端上限，truncated 为假')
}

console.log('== 二、票文件读不动：整趟失败，不回缺行的清单 ==')
{
  const ws = standardWs()
  const ctx = makeCtx(posixWs(ws), ['02-b.md'])
  const r = await listMaps(ctx as never, REPO as never) as { ok: boolean; error?: { kind: string; message: string } }
  check(r.ok === false, '带标票读不动，整趟失败（读不出它就不知道它是不是地图）')
  check(!!(r.error && r.error.message && r.error.message.indexOf('02-b') >= 0), '报错点名是哪个文件')
  check(!r.error || String(r.error.kind) !== 'unsupported', '读失败不是不支持，不许走老路回落')
}

console.log('== 三、地图容器读不动：与旧路同口径（记一条线、不断趟） ==')
{
  const ws = standardWs()
  const posix = posixWs(ws)
  const ctx = makeCtx(posix, [], (p) => p === posix + '/.scratch/effort-a/map.md')
  const r = await listMaps(ctx as never, REPO as never) as {
    ok: boolean; data?: { rows: { key: string; title: string }[] }; error?: { kind: string }
  }
  check(r.ok === true, '容器读不动不断趟（旧路 list 同口径，不在本票改）')
  const rows = (r.data && r.data.rows) || []
  check(rows.length === 2, '只少 a-地图，其余两行照回 → 实得 ' + rows.length)
  const reasons = ctx.events.filter((e) => e.event === 'read.degraded').map((e) => String(e.fields.reason))
  check(reasons.includes('list:map-read-fail'), '少的那一行记了 read.degraded 线，不算静默丢 → 实得 ' + reasons.join(','))
}

if (failures > 0) { console.error('verify-1605-markdown-map-list: ' + failures + ' 处未过'); process.exit(1) }
else console.log('verify-1605-markdown-map-list: 全过')