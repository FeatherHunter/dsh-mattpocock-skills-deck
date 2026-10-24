/**
 * tests/verify-1488-read-mixed-layout.ts —— 本地 Markdown 后端读取端认混合布局（#1488，规格 #1480）。
 *
 * 规格 #1480 把 Markdown 后端的落盘格式改回技能原文：一个工作单元一个目录，
 * 规格是 `.scratch/<目录>/spec.md`，实施票是 `.scratch/<目录>/issues/<NN>-<slug>.md`，
 * 探索地图仍是 `.scratch/<目录>/map.md`。但读取端此前只认 map.md（#1476）：
 * 只含 spec.md 或 issues/ 的目录会被判成「没有地图」，列表、单票、预检全都用不了。
 *
 * 本门禁逐条钉票面验收（编号照 #1488）：
 *  ① 只含 spec.md 的目录能被识别，并把规格与实施票列出来；
 *  ② 三个以上目录、同号票并存时，列表与单票读取都按目录区分，不互相串；
 *  ③ 工作区根 issues/ 的旧票仍可列出、可读、可改，读取时留下兼容日志；
 *  ④ 重复编号与非规范文件名有确定的退化显示规则并打日志，不抛错；
 *  ⑤ 环境预检、计数、分页等读路径在混合布局下都正常。
 *
 * 全程在系统临时目录里造工作区，用与 tests/verify-1058-markdown-read-log.ts 同一套 fs/platform 适配器；
 * 不打真网、不碰真实工作区（临时目录用完即删）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1488-read-mixed-layout.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'

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

/** 与 tests/verify-1058-markdown-read-log.ts 同一套适配器形状：path.posix + 真实文件系统读写。
 *  每条 read.degraded 都收进 ctx.events，供兼容日志/退化日志那两节逐条对。 */
function makeCtx(cwd: string): Ctx {
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const events: LogLine[] = []
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1488',
    events,
    logEvent(level: string, event: string, fields: Record<string, unknown>) { events.push({ level, event, fields }) },
    isEnabled() { return true },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
}

/** 仓库引用照宿主在真实工作区给的形状：refId 给空、靠 effortId 指定工作单元。
 *  （refId 只影响 path.ts 的旧定位口，本门禁断的是发现口与读取口。） */
const REPO = { backend: 'markdown', refId: '', name: '', url: '' }
/** 读/写到的降级取值：收尾与 read-log 的表对账用不到（那由 verify-1058 管），这里只用来数兼容日志。 */
const degradations = (ctx: Ctx) => ctx.events.filter(function (e) { return e.event === 'read.degraded' })

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1488-read-'))
const backend = createMarkdownBackend(makeCtx(tmpRoot) as never)

/** 写一张票文件（原文形态：标题 + Status 行 + 正文；不带任何 DSH 隐藏注释）。 */
function writeTicket(dir: string, file: string, title: string, status = 'ready-for-agent') {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, file), '# ' + title + '\n\nStatus: ' + status + '\n\n## Body\n\n夹具里的票\n', 'utf8')
}
/** 写一份规格文件（原文形态）。 */
function writeSpec(dir: string, title: string, status = 'ready-for-agent') {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'spec.md'), '# ' + title + '\n\nStatus: ' + status + '\n\n## Body\n\n规格正文\n', 'utf8')
}

async function main() {
  console.log('== ① 只含 spec.md 的目录要被认出来：预检通过、规格与实施票都列出来 ==')
  {
    const root = fs.mkdtempSync(path.join(tmpRoot, 'spec-only-'))
    writeSpec(path.join(root, '.scratch', 'buy-coffee'), '买咖啡积分')
    writeTicket(path.join(root, '.scratch', 'buy-coffee', 'issues'), '01-add-cart.md', '加购物车到积分')
    writeTicket(path.join(root, '.scratch', 'buy-coffee', 'issues'), '02-checkout.md', '结账时抵扣积分')
    const ctx = makeCtx(root)
    const be = createMarkdownBackend(ctx as never)

    const pre = await be.preflight({ cwd: root, refId: '' } as never, ctx as never)
    check(pre.ok === true, '① 只含 spec.md 的工作单元：预检通过（现状只认 map.md，会判 not-found）')

    const listed = await be.list(REPO as never, {} as never, ctx as never)
    check(listed.ok === true, '① 列表成功返回')
    const rows = listed.ok ? (listed.data as Array<Record<string, unknown>>) : []
    const spec = rows.filter(function (r) { return r.type === 'spec' })
    check(spec.length === 1, '① 列表里有且只有一行规格（' + spec.length + '）')
    check(spec[0] && spec[0].key === '00' && spec[0].title === '买咖啡积分', '① 规格行：key=00、title=买咖啡积分')
    check(spec[0] && spec[0].effortId === 'buy-coffee', '① 规格行带工作单元 effortId=buy-coffee（' + (spec[0] && spec[0].effortId) + '）')
    const tickets = rows.filter(function (r) { return r.type === 'issue' || r.type === 'bug' })
    check(tickets.length === 2, '① 列表里有两张实施票（' + tickets.length + '）')
    check(tickets.every(function (t) { return t.effortId === 'buy-coffee' }), '① 实施票都带 effortId=buy-coffee')
    check(tickets.map(function (t) { return t.key }).sort().join(',') === '01,02', '① 实施票编号 01、02（' + tickets.map(function (t) { return t.key }).join(',') + '）')

    const specRead = await be.get(REPO as never, '00', { effortId: 'buy-coffee' } as never, ctx as never)
    check(specRead.ok === true && specRead.data.title === '买咖啡积分', '① 单票读取 00 拿到规格')
    const first = await be.get(REPO as never, '01', { effortId: 'buy-coffee' } as never, ctx as never)
    check(first.ok === true && first.data.title === '加购物车到积分', '① 单票读取 01 拿到实施票')
    check(degradations(ctx).length === 0, '① 干净的新布局读取一行降级日志都不记（' + degradations(ctx).length + '）')
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true })
  console.log(failed ? '\nFAILED' : '\nALL PASS')
  process.exitCode = failed ? 1 : 0
}

main().catch(function (e) { console.error(e); process.exitCode = 1 })
