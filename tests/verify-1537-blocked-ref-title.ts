/**
 * tests/verify-1537-blocked-ref-title.ts —— 详情 get 的 blockedBy 引用必须带目标标题（#1537）。
 *
 * 现象：详情页「被阻塞」区只显示编号（#3 #4 #5 #8），没有目标标题。根因不在界面：
 * 界面按契约 `title || '#' + 编号` 回落，是允许的兜底。真正缺的是数据 —— 本地 Markdown
 * 后端的 get 解析正文拿到引用后只写 `{ key, title: '', state: 'open' }`，没有按被引票回填；
 * 而同一个后端的 list（issues-read.ts 那段「A: 回填」）与 getDependencies（graph.ts）都有这一步。
 * #1444 把详情读路径从「get + getDependencies」改成「只调 get」之后，依赖查询原来兜住标题
 * 的那一步没了，详情就只剩编号。
 *
 * 本门禁钉住验收里的三条（只走外部入口 get / list / getDependencies，不抄实现）：
 *  ① get 回来的每条 blockedBy 引用都有非空标题，state 与被引票当前状态一致；
 *  ② 同一张票在 get 与 list 下引用口径一致（标题、状态不再一处有一处无）；
 *  ③ 引用目标不存在时保留编号、标题留空，不抛错、不影响其它引用；
 *  ④ 被地图阻塞（key 00）时标题取自本 effort 的地图。
 * 修前 ①②④ 必红（标题全空、state 全 open），修后变绿；它守的是 get 与 list 之间那道缝。
 *
 * 全程在系统临时目录里造工作区，不打真网、不碰真实工作区（用完即删）。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1537-blocked-ref-title.ts
 * 门禁归属: src/tracker/rooms/markdown/issues-read.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'

type Ctx = {
  platform: { path: typeof path.posix; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  opId: string
  events: unknown[]
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  isEnabled: (level: string) => boolean
  get: (name: string) => unknown
}

let failed = false
const check = (ok: boolean, msg: string, detail?: unknown) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (detail === undefined || ok ? '' : ' — ' + String(detail).slice(0, 300)))
  if (!ok) failed = true
}

/** 与 tests/verify-1488-read-mixed-layout.ts 同一套适配器形状：path.posix + 真实文件系统读写。 */
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
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1537',
    events: [],
    logEvent() {},
    isEnabled() { return true },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
}

const REPO = { backend: 'markdown', refId: '', name: '', url: '' }
const EFFORT = 'ticket-convention'
const OPTS = { effortId: EFFORT } as never

function writeTicket(dir: string, file: string, title: string, status: string, blockedBy?: string) {
  fs.mkdirSync(dir, { recursive: true })
  let text = '# ' + title + '\n\nStatus: ' + status + '\n'
  if (blockedBy) text += '\nBlocked by: ' + blockedBy + '\n'
  text += '\n## Body\n\n夹具里的票\n'
  fs.writeFileSync(path.join(dir, file), text, 'utf8')
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1537-ref-'))
const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-'))
const unit = path.join(ws, '.scratch', EFFORT)
const issuesDir = path.join(unit, 'issues')
writeTicket(unit, 'map.md', '本组地图', 'ready-for-agent')
writeTicket(issuesDir, '03-zh.md', '中文5处', 'ready-for-agent')
writeTicket(issuesDir, '04-en.md', '英文4处', 'ready-for-agent')
writeTicket(issuesDir, '05-check.md', '对账加微信', 'done')
writeTicket(issuesDir, '08-final.md', '源头定稿', 'ready-for-agent')
writeTicket(issuesDir, '12-blocked.md', '被挡住的12', 'ready-for-agent', '03, 04, 05, 08')
writeTicket(issuesDir, '13-missing.md', '指到空号的13', 'ready-for-agent', '99')
writeTicket(issuesDir, '14-bymap.md', '被地图挡住的14', 'ready-for-agent', '00')

const ctx = makeCtx(ws)
const be = createMarkdownBackend(ctx as never)

async function main() {
  console.log('== ① get 的 blockedBy 引用带标题、state 与被引票一致 ==')
  const got = await be.get(REPO as never, '12', OPTS, ctx as never) as any
  check(got && got.ok === true, 'get 12 成功', JSON.stringify(got && got.error))
  const refs = (got && got.ok && Array.isArray(got.data.blockedBy) ? got.data.blockedBy : []) as any[]
  const keys = refs.map((r) => String(r && r.key)).join(',')
  check(keys === '03,04,05,08', 'get 12 的引用是 03/04/05/08 四条（got ' + keys + '）')
  const titleOf: Record<string, string> = {}
  refs.forEach((r) => { titleOf[String(r.key)] = String(r.title || '') })
  check(titleOf['03'] === '中文5处', '03 的标题是「中文5处」', JSON.stringify(titleOf['03']))
  check(titleOf['04'] === '英文4处', '04 的标题是「英文4处」', JSON.stringify(titleOf['04']))
  check(titleOf['05'] === '对账加微信', '05 的标题是「对账加微信」', JSON.stringify(titleOf['05']))
  check(titleOf['08'] === '源头定稿', '08 的标题是「源头定稿」', JSON.stringify(titleOf['08']))
  const stateOf: Record<string, string> = {}
  refs.forEach((r) => { stateOf[String(r.key)] = String(r.state || '') })
  check(stateOf['05'] === 'closed', '05 已关闭，引用 state 不再是 open', JSON.stringify(stateOf['05']))
  check(stateOf['03'] === 'open' && stateOf['04'] === 'open' && stateOf['08'] === 'open',
    '03/04/08 的引用 state 是 open', JSON.stringify(stateOf))

  console.log('== ② 同一张票在 get 与 list 下口径一致 ==')
  const listed = await be.list(REPO as never, OPTS, ctx as never) as any
  check(listed && listed.ok === true, 'list 成功', JSON.stringify(listed && listed.error))
  const row = (listed && listed.ok ? listed.data : []).find((it: any) => String(it.key) === '12') as any
  check(!!row, 'list 里找得到 12')
  const sameShape = !!row && Array.isArray(row.blockedBy) && row.blockedBy.length === refs.length &&
    row.blockedBy.every((r: any) => {
      const g = refs.find((x) => String(x.key) === String(r.key))
      return !!g && String(g.title) === String(r.title) && String(g.state) === String(r.state)
    })
  check(sameShape, 'list 里 12 的引用与 get 逐条一致（key/title/state）')

  console.log('== ③ 引用目标不存在时保留编号、不抛错 ==')
  const miss = await be.get(REPO as never, '13', OPTS, ctx as never) as any
  check(miss && miss.ok === true, 'get 13 成功（没因为 99 不存在而失败）', JSON.stringify(miss && miss.error))
  const mrefs = (miss && miss.ok && Array.isArray(miss.data.blockedBy) ? miss.data.blockedBy : []) as any[]
  check(mrefs.length === 1 && String(mrefs[0].key) === '99', '99 这条引用还在（got ' + JSON.stringify(mrefs) + '）')
  check(String((mrefs[0] || {}).title || '') === '', '99 的标题留空（界面按契约回落成编号）', JSON.stringify(mrefs[0]))
  // #1676：目标读不到时 state 也不能伪造 open —— 留缺省表示「未知」，否则详情页按钮会被永久置灰。
  check(!('state' in (mrefs[0] || {})), '99 的引用不带 state（未知不扮成 open）', JSON.stringify(mrefs[0]))

  console.log('== ④ 被地图阻塞时标题取自本 effort 地图 ==')
  const byd = await be.get(REPO as never, '14', OPTS, ctx as never) as any
  check(byd && byd.ok === true, 'get 14 成功', JSON.stringify(byd && byd.error))
  const drefs = (byd && byd.ok && Array.isArray(byd.data.blockedBy) ? byd.data.blockedBy : []) as any[]
  check(drefs.length === 1 && String(drefs[0].key) === '00', '14 的引用是 00（地图）')
  check(String((drefs[0] || {}).title || '') === '本组地图', '00 的标题是本 effort 地图标题', JSON.stringify(drefs[0]))

  fs.rmSync(tmpRoot, { recursive: true, force: true })
  if (failed) { console.log('\n门禁结果：FAIL（#1537 回归仍在）'); process.exit(1) }
  console.log('\n门禁结果：PASS（#1537 已修复）')
}

await main()
