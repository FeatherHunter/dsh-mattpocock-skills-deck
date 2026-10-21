/**
 * tests/verify-1182-ticket-file-publish.ts —— 本地 Markdown 房「票文件整份覆盖写走原子发布」的门禁（#1182）。
 *
 * 为什么要这一条：这一房从前写票文件是直接往目标上整份覆盖写（write.js 的 writeTextFile），
 * 写一半崩掉（进程被杀、盘满、改名那一步失败）就会把一张票留成半截内容 —— 而半截的票读回来
 * 是一张缺字段的票，比这次写失败更贵：失败还能重试，半截内容会被当成「盘上本来就是这样」。
 * 配色那一族早有原子发布（tests/verify-markdown-label-colors.js 逐条走到），票文件这一族没有。
 * #1182 把两边合成一份实现（write.ts 的 publishTextFile），这道门禁守四件事：
 *   一、**改票、建票、关票、评论四条写票路**都先写同目录临时文件、再改名发布成目标票文件，不是直接覆盖目标。
 *   二、**临时文件与目标同目录**：跨目录改名不是原子的，写进系统临时目录再搬过来会多一条半截窗口。
 *   三、**没有改名原语时退回整份直写**：真实宿主（DSH 文件服务只给 writeText / editText）走的就是这条退路，
 *       它同样一次写完整份内容，不是「边算边往目标上写」。
 *   四、**改名失败那一趟不留垃圾、也不动目标**：临时文件清掉，目标文件仍是旧内容，这次写如实失败。
 *
 * 判据靠假 fs 适配器上的调用记录（writeText 与 rename 各记一份），不靠读回来猜。
 * 全程在系统临时目录里造工作区，不打真网、不碰真实工作区（临时目录用完即删）。
 *
 * 运行：node --import ./scripts/ts-hook.mjs tests/verify-1182-ticket-file-publish.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'

type WriteCall = { path: string; content: string }
type RenameCall = { from: string; to: string }
type Ctx = {
  platform: { path: typeof path.posix; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  opId: string
  writes: WriteCall[]
  renames: RenameCall[]
  isEnabled: (level: string) => boolean
  get: (name: string) => unknown
}

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 与 tests/verify-1060-edge-log.ts 同一套适配器形状，外加两条开关：
 *  `withRename=false` 拿走改名原语（真实宿主就是这一种：DSH 文件服务没有 rename）；`renameFails=true` 让改名这一步抛错。 */
function makeCtx(cwd: string, opts: { withRename?: boolean; renameFails?: boolean } = {}): Ctx {
  const withRename = opts.withRename !== false
  const writes: WriteCall[] = []
  const renames: RenameCall[] = []
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { writes.push({ path: t, content: c }); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      ...(withRename
        ? {
            async rename(a: string, b: string) {
              if (opts.renameFails) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
              renames.push({ from: a, to: b })
              fs.renameSync(a, b)
            },
          }
        : {}),
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async rm(t: string) { try { fs.rmSync(t, { force: true }); return true } catch { return false } },
    },
  }
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1182',
    writes,
    renames,
    isEnabled() { return true },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined },
  }
}

/** 在临时工作区里写一个工作单元（地图 + 若干票文件）；tickets 里每项是 [文件名, 状态]。 */
function ws(suffix: string, tickets: Array<[string, string]>): string {
  const root = fs.mkdtempSync(path.join(tmpRoot, suffix + '-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 工作单元 demo\n\nStatus: ready-for-agent\n\n## Destination\n\n夹具\n', 'utf8')
  for (const [file, status] of tickets) {
    fs.writeFileSync(path.join(dir, 'issues', file), '# ' + file + '\n\nStatus: ' + status + '\n\n## Body\n\n夹具里的票\n', 'utf8')
  }
  return root
}

const REPO = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1182-publish-'))

const norm = (p: unknown) => String(p).replace(/\\/g, '/')
const issuesDirOf = (root: string) => path.join(root, '.scratch', 'demo', 'issues')
const targetOf = (root: string, file: string) => path.join(issuesDirOf(root), file)
const isTmp = (p: string) => /\.tmp$/.test(String(p))
/** 票目录里有没有留下临时文件（发布成功后一份都不该留）。 */
const tmpLeft = (root: string) => fs.readdirSync(issuesDirOf(root)).filter(isTmp)
/** 这一趟里「先写临时文件、再改名成目标」两件事都发生了没有。 */
function checkAtomic(root: string, ctx: Ctx, w0: number, r0: number, target: string, label: string) {
  const w = ctx.writes.slice(w0)
  const ren = ctx.renames.slice(r0)
  check(w.length === 1 && isTmp(w[0].path), label + '：先写的是临时文件（名字以 .tmp 结尾）→ ' + (w.length ? w[w.length - 1].path : '一次都没写'))
  check(w.length === 1 && norm(path.dirname(w[0].path)) === norm(path.dirname(target)), label + '：临时文件与目标票文件同目录（跨目录改名不是原子的）')
  check(ren.length === 1 && norm(ren[0].to) === norm(target), label + '：再改名发布成目标票文件 → ' + (ren.length ? norm(ren[ren.length - 1].to) : '一次都没改名'))
  check(ren.length === 1 && w.length === 1 && norm(ren[0].from) === norm(w[0].path), label + '：发布用的正是刚写的那个临时文件')
  check(tmpLeft(root).length === 0, label + '：票目录里没有留下临时文件 → 实得 ' + JSON.stringify(tmpLeft(root)))
}

console.log('== 一、改票 / 建票 / 关票 / 评论四条写票路：先写同目录临时文件，再改名发布成目标 ==')
{
  const root = ws('a', [['01-a.md', 'ready-for-agent'], ['02-b.md', 'ready-for-agent']])
  const ctx = makeCtx(root)
  const b = createMarkdownBackend(ctx)

  // 改票：issues-patch.ts 的读—改—写。
  let w0 = ctx.writes.length
  let r0 = ctx.renames.length
  const upd = await b.update(REPO, '01', { title: '换一个标题' }, ctx)
  check(upd.ok === true, '改票：这一趟成功 → ' + (upd.ok ? 'ok' : JSON.stringify(upd.error)))
  checkAtomic(root, ctx, w0, r0, targetOf(root, '01-a.md'), '改票')
  check(fs.readFileSync(targetOf(root, '01-a.md'), 'utf8').indexOf('换一个标题') >= 0, '改票：目标文件里真的换上了新标题')

  // 建票：issues-create.ts 的落盘那一步。
  w0 = ctx.writes.length
  r0 = ctx.renames.length
  const made = await b.create(REPO, { title: '新的一张' }, ctx)
  check(made.ok === true, '建票：这一趟成功 → ' + (made.ok ? 'ok' : JSON.stringify(made.error)))
  const madeRen = ctx.renames.slice(r0)
  check(madeRen.length === 1 && norm(madeRen[0].to).indexOf(norm(issuesDirOf(root))) === 0, '建票：改写名的目标是票目录里的一份票文件 → ' + (madeRen.length ? norm(madeRen[madeRen.length - 1].to) : '一次都没改名'))
  check(madeRen.length === 1 && isTmp(ctx.writes[ctx.writes.length - 1].path), '建票：先写的是临时文件 → ' + ctx.writes[ctx.writes.length - 1].path)
  check(madeRen.length === 1 && fs.readFileSync(madeRen[0].to, 'utf8').indexOf('新的一张') >= 0, '建票：发布后的票文件里是这张新票')
  check(tmpLeft(root).length === 0, '建票：票目录里没有留下临时文件')

  // 关票：issues-status.ts 的状态改写那一步。
  w0 = ctx.writes.length
  r0 = ctx.renames.length
  const closed = await b.close(REPO, '02', { reason: 'completed' }, ctx)
  check(closed.ok === true, '关票：这一趟成功 → ' + (closed.ok ? 'ok' : JSON.stringify(closed.error)))
  checkAtomic(root, ctx, w0, r0, targetOf(root, '02-b.md'), '关票')

  // 评论：comments.ts 的追加那一步。
  w0 = ctx.writes.length
  r0 = ctx.renames.length
  const commented = await b.comment(REPO, '02', '这是一条评论', ctx)
  check(commented.ok === true, '评论：这一趟成功 → ' + (commented.ok ? 'ok' : JSON.stringify(commented.error)))
  checkAtomic(root, ctx, w0, r0, targetOf(root, '02-b.md'), '评论')
  check(fs.readFileSync(targetOf(root, '02-b.md'), 'utf8').indexOf('这是一条评论') >= 0, '评论：目标文件里真的写进了那条评论')
}

console.log('== 二、没有改名原语时退回整份直写（真实宿主走的就是这条退路） ==')
{
  const root = ws('b', [['01-a.md', 'ready-for-agent']])
  const ctx = makeCtx(root, { withRename: false })
  const b = createMarkdownBackend(ctx)
  const target = targetOf(root, '01-a.md')

  const r = await b.update(REPO, '01', { title: '直写这条路' }, ctx)
  check(r.ok === true, '没有改名原语：改票照样成功 → ' + (r.ok ? 'ok' : JSON.stringify(r.error)))
  check(ctx.writes.length === 1 && norm(ctx.writes[0].path) === norm(target), '没有改名原语：一次直写就落在目标票文件上 → ' + (ctx.writes.length ? norm(ctx.writes[ctx.writes.length - 1].path) : '一次都没写'))
  check(ctx.renames.length === 0, '没有改名原语：一次改名都没发生 → 实得 ' + ctx.renames.length + ' 次')
  check(fs.readFileSync(target, 'utf8').indexOf('直写这条路') >= 0, '没有改名原语：目标文件里是整份新内容（不是边算边写）')
  check(tmpLeft(root).length === 0, '没有改名原语：票目录里也不留临时文件')
}

console.log('== 三、改名失败那一趟：临时文件清掉、目标文件不动、这次写如实失败 ==')
{
  const root = ws('c', [['01-a.md', 'ready-for-agent']])
  const ctx = makeCtx(root, { renameFails: true })
  const b = createMarkdownBackend(ctx)
  const target = targetOf(root, '01-a.md')
  const before = fs.readFileSync(target, 'utf8')

  const r = await b.update(REPO, '01', { title: '这一次发布不成功' }, ctx)
  check(r.ok === false, '改名失败：这次写如实失败（不许当成功回）→ ' + (r.ok ? '竟然成功' : r.error.kind))
  check(fs.readFileSync(target, 'utf8') === before, '改名失败：目标票文件一个字节都没变')
  check(ctx.writes.length === 1 && isTmp(ctx.writes[0].path), '改名失败：只写了一份临时文件，没有直写目标 → 实得 ' + ctx.writes.length + ' 次')
  check(tmpLeft(root).length === 0, '改名失败：临时文件被清掉、不留垃圾 → 实得 ' + JSON.stringify(tmpLeft(root)))
}

fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log(failed ? '\n存在失败 — verify-1182-ticket-file-publish 未通过' : '\n全部通过 — 票文件的四条写路都走原子发布，两条退路也守住了')
process.exit(failed ? 1 : 0)
