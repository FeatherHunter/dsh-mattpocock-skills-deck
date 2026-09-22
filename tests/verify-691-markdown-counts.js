/**
 * tests/verify-691-markdown-counts.js — 本地 Markdown 后端的计数（counts）门禁（#691 的第 4 件交付物）。
 *
 * 断的是 #688 第一手实测定下的口径（数「列举会返回的那些票行」）与契约的「拿不全就整体失败」：
 *   一、计数等于目录里真实的票数（notes.md 不算票、地图容器行不算票）；
 *   二、open / closed 按票面 Status 行分得对（同一份夹具上再验一次 filter.state 收窄）；
 *   三、作用域：给了 effortId 只数那一个工作单元，没给就两个工作单元一起数；
 *   四、某个票文件读不动 → counts 回失败（而不是少一行），消息里带那个编号；
 *       同一次 list 仍按既有口径静默少一行 —— 证明这次只让 counts 这条路如实报错，没动 list。
 *   五、一个票都没有的空工作区 → {open:0, closed:0, total:0}。
 *
 * 全程在系统临时目录里造工作区，用与 tests/verify-markdown-backend.js 第 89-106 行同一套
 * fs/platform 适配器形状；不打真网、不碰真实工作区（临时目录用完即删）。
 * 「读不动」是让适配器在读指定文件名时抛错，效果与真机上「权限不足 / 读到时已被删 / 被锁住」相同。
 *
 * 运行：node tests/verify-691-markdown-counts.js
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { countIssues } from '../src/host/tracker/backends/markdown/counts.js'
import { listIssues } from '../src/host/tracker/backends/markdown/issues-read.js'

let failed = false
const check = (ok, msg) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const countsText = (r) => (r && r.ok ? '三个键都对=' + same(Object.keys(r.data).sort(), ['closed', 'open', 'total']) + ' open=' + r.data.open + ' closed=' + r.data.closed + ' total=' + r.data.total : JSON.stringify(r))

/** 与 tests/verify-markdown-backend.js 同一套适配器形状；unreadable 里的文件名在读的时候抛错。 */
function makeCtx(cwd, unreadable = []) {
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p) { return p },
      async readText(t) {
        if (unreadable.includes(String(t).split('/').pop())) {
          const e = new Error('EACCES: permission denied, open ' + t)
          e.code = 'EACCES'
          throw e
        }
        return fs.readFileSync(t, 'utf8')
      },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  return { platform: plat, fs: plat.fs, cwd, get(name) { if (name === 'fs') return plat.fs; return undefined } }
}

/** 在临时工作区里写一个工作单元（地图 + 若干票文件）；tickets 里每项是 [文件名, 状态, 额外行]。 */
function writeEffort(root, effortId, tickets) {
  const dir = path.join(root, '.scratch', effortId)
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 工作单元 ' + effortId + '\n\nStatus: ready-for-agent\n\n## Destination\n\n夹具\n', 'utf8')
  for (const [file, status, extra] of tickets) {
    const body = '# ' + file + '\n\nStatus: ' + status + '\n' + (extra || '') + '\n## Body\n\n夹具里的票\n'
    fs.writeFileSync(path.join(dir, 'issues', file), body, 'utf8')
  }
  return dir
}

const REPO = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-691-counts-'))

console.log('== 一、计数等于目录里真实的票数（notes.md 不算票、地图容器行不算票） ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-a-'))
  // demo：2 开 2 关（其中 02 带两个标签、03 带一个标签，留给下面按标签筛那一节用）
  writeEffort(ws, 'demo', [
    ['01-open-a.md', 'ready-for-agent', ''],
    ['02-closed-b.md', 'resolved', 'Labels: bug, needs-triage\n'],
    ['03-open-c.md', 'claimed', 'Labels: bug\n'],
    ['04-closed-d.md', 'done', ''],
    ['notes.md', 'ready-for-agent', ''],
  ])
  // alpha：0 开 1 关
  writeEffort(ws, 'alpha', [['01-closed-e.md', 'closed', '']])
  const ctx = makeCtx(ws)

  const r = await countIssues(ctx, REPO, {})
  check(r.ok && r.data.open === 2 && r.data.closed === 3 && r.data.total === 5,
    '两个工作单元一起数：2 开 + 3 关 = 5 张票（目录里真实票数）→ ' + countsText(r))
  const rows = await listIssues(ctx, REPO, {})
  check(rows.ok && rows.data.length === 7,
    '同一份夹具上列举回 7 行 = 5 张票 + 2 张地图容器行（数字与行同源，地图行没算进票数）→ 实得 ' + (rows.ok ? rows.data.length : '失败') + ' 行')

  const narrowOpen = await countIssues(ctx, REPO, { state: 'open' })
  check(narrowOpen.ok && narrowOpen.data.open === 2 && narrowOpen.data.closed === 0 && narrowOpen.data.total === 2,
    'filter.state=open 收窄：另一种状态计 0 → ' + countsText(narrowOpen))
  const byLabel = await countIssues(ctx, REPO, { labels: ['bug'] })
  check(byLabel.ok && byLabel.data.open === 1 && byLabel.data.closed === 1 && byLabel.data.total === 2,
    'filter.labels=[bug]：同时带这个标签的票才数（01 与 alpha 那张都没带）→ ' + countsText(byLabel))
}

console.log('\n== 二、作用域：给了 effortId 只数那一个工作单元 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-b-'))
  writeEffort(ws, 'demo', [['01-open-a.md', 'ready-for-agent', ''], ['02-closed-b.md', 'resolved', '']])
  writeEffort(ws, 'alpha', [['01-closed-c.md', 'closed', '']])
  const ctx = makeCtx(ws)

  const demo = await countIssues(ctx, { ...REPO, effortId: 'demo' }, {})
  check(demo.ok && demo.data.open === 1 && demo.data.closed === 1 && demo.data.total === 2,
    'effortId=demo：只数 demo 这一个工作单元 → ' + countsText(demo))
  const alpha = await countIssues(ctx, { ...REPO, effortId: 'alpha' }, {})
  check(alpha.ok && alpha.data.open === 0 && alpha.data.closed === 1 && alpha.data.total === 1,
    'effortId=alpha：只数 alpha 这一个工作单元 → ' + countsText(alpha))
  const all = await countIssues(ctx, REPO, {})
  check(all.ok && all.data.total === 3,
    '不给 effortId：两个工作单元一起数 → ' + countsText(all))
}

console.log('\n== 三、票文件读不动 → 失败（不是少一行），消息里带那个编号 ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-c-'))
  writeEffort(ws, 'hurt', [
    ['01-open-a.md', 'ready-for-agent', ''],
    ['02-open-b.md', 'ready-for-agent', ''],
    ['03-closed-c.md', 'resolved', ''],
  ])
  // 只有 03 这张票读不动（真机上对应权限不足 / 读到时已被删 / 被锁住）
  const ctx = makeCtx(ws, ['03-closed-c.md'])
  const hurtRepo = { ...REPO, refId: '.scratch/hurt' }

  const r = await countIssues(ctx, hurtRepo, {})
  check(r.ok === false, 'counts 回失败（绝不静默少一行、绝不回一个偏小的数）→ ' + JSON.stringify(r))
  check(r.ok === false && r.error && typeof r.error.message === 'string' && r.error.message.includes('03'),
    '失败消息里说清是哪个编号的文件 → ' + (r.ok === false ? r.error.message : '(回成功了)'))
  check(r.ok === false && ['env', 'auth', 'parse', 'not-found', 'network'].includes(r.error.kind),
    '失败档位是既有错误分类之一 → ' + (r.ok === false ? r.error.kind : '(回成功了)'))

  const rows = await listIssues(ctx, hurtRepo, {})
  const ticketRows = rows.ok ? rows.data.filter((x) => x.type === 'issue') : []
  check(rows.ok && ticketRows.length === 2,
    '同一次 list 仍按既有口径静默少一行（既有行为一个字没改，只有 counts 这条路如实报错）→ 实得票行 ' + ticketRows.length + ' 张')
}

console.log('\n== 四、一个票都没有的空工作区 → {open:0, closed:0, total:0} ==')
{
  const ws = fs.mkdtempSync(path.join(tmpRoot, 'ws-d-'))
  // 有工作单元目录与地图，但 issues/ 里一张票都没有
  writeEffort(ws, 'emptyone', [])
  const ctx = makeCtx(ws)
  const r = await countIssues(ctx, { ...REPO, refId: '.scratch/emptyone' }, {})
  check(r.ok && r.data.open === 0 && r.data.closed === 0 && r.data.total === 0,
    '有地图、没有票的工作区 → ' + countsText(r))

  // 连 .scratch 都还没有的工作区（刚选好后端、还没建地图）：也回 0，不回失败 —— 与列举同口径（列举回空清单）
  const bare = fs.mkdtempSync(path.join(tmpRoot, 'ws-e-'))
  const bareCtx = makeCtx(bare)
  const r2 = await countIssues(bareCtx, REPO, {})
  check(r2.ok && r2.data.open === 0 && r2.data.closed === 0 && r2.data.total === 0,
    '还没有 .scratch 的工作区 → ' + countsText(r2))
}

fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log('  临时工作区已清理')
if (failed) {
  console.log('\n存在失败 — verify-691-markdown-counts 未通过')
  process.exit(1)
}
console.log('\n全部通过 — 本地 Markdown 计数符合 #688 / #691 定的口径')
