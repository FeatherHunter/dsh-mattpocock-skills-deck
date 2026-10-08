// tests/verify-922-ticket-file-queue.js —— 门禁：本地票文件的「读—改—写」按文件排队，两路并发改同一张票不丢改动（#922）
// 用法：在插件根目录执行 node tests/verify-922-ticket-file-queue.js，可独立运行。
//
// 守的是什么：本地 Markdown 后端改一份票文件的做法是「读整份内容 → 在内存里改 → 整份覆盖写回」，
// 中间那一次读会让出事件循环。两路并发改同一张票时，如果不排队，两边会一起读到同一份旧内容、
// 各自改成各自的样子、再各自整份写回，后写的那一路把先写的那一路的改动整份抹掉 ——
// 两路都回「成功」，盘上却少了一半改动（最难查的那类毛病）。
//
// 怎么装的：用一份假文件系统装配**真实**的本地 Markdown 后端模块（不是另写一个假后端），
// 走它真实的那几条写入操作；假文件系统照 DSH 文件服务的形状（resolve 出句柄、readText/writeText 吃句柄），
// 每一次读与写都按真实节奏延迟一点，好让「不排队就会交错」这件事真的发生。
//
// 五条断言：
//   ① 同一张票两路并发改不同的字段（类型 / 阻塞关系）：两边的改动都在；
//   ② 关门与改标签并发（走的是另一条写函数）：两边的改动都在；
//   ③ 同一个工作区、路径写法不同（/ws 与 /WS）：仍然排同一条队，两边的改动都在；
//   ⑤ 发评论与关门并发（写评论走的是另一个函数）：两边的改动都在；
//   ④ 不同票文件之间互不排队（批量补边要靠这一点才能同时做）：读第一份时按住不放，
//      第二份的读必须能开始；串成一条队会在这里超时并亮红。
// 自证记录：把 write-queue.js 的 withFileWriter 临时改成「不排队、直接跑」（return work()），
// ①②③ 立刻变红（例如只留下后写那一份字段），④ 仍然是绿的；改回去即全绿。
import nodePath from 'node:path'
import { markdownModule } from '../src/host/tracker/backends/markdown/index.js'

let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const WS = '/ws'
const REF = { backend: 'markdown', refId: '/ws', name: 'ws', url: '' }
const FILE_01 = '/ws/.scratch/demo/issues/01-first.md'
const FILE_02 = '/ws/.scratch/demo/issues/02-second.md'
const MAP = '/ws/.scratch/demo/map.md'

const TICKET_01 = ['# 第一张票', '', 'Status: ready-for-agent', 'Type:', 'Blocked by:', 'Labels: needs-triage', '', '## Comments', '', ''].join('\n')
const TICKET_02 = ['# 第二张票', '', 'Status: ready-for-agent', 'Type:', 'Blocked by:', 'Labels: needs-triage', '', '## Comments', '', ''].join('\n')

/** 假文件系统：只替换磁盘，接口形状照 DSH 文件服务。路径一律按大小写不敏感存（Windows / macOS 的真实行为）。
 *  readHook 是给「并行证明」用的：读某一份时可以在这里被按住，等另一份的读开始才放行。 */
function makeFakeFs(seed) {
  const K = (p) => String(p).toLowerCase()
  const files = new Map()
  for (const k of Object.keys(seed || {})) files.set(K(k), String(seed[k]))
  const dirs = new Set(['/ws', '/ws/.scratch', '/ws/.scratch/demo', '/ws/.scratch/demo/issues'])
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  const fs = {
    events: [],
    readHook: null,
    show(p) { return files.has(K(p)) ? files.get(K(p)) : null },
    async resolve(p) { return String(p) },
    async readText(t) {
      const p = String(t)
      fs.events.push('read-start ' + p)
      if (typeof fs.readHook === 'function') await fs.readHook(p)
      if (!files.has(K(p))) throw Object.assign(new Error('ENOENT: no such file or directory, open \'' + p + '\''), { code: 'ENOENT' })
      await delay(1)
      fs.events.push('read-end ' + p)
      return files.get(K(p))
    },
    async writeText(t, content) {
      const p = String(t)
      fs.events.push('write-start ' + p)
      await delay(1)
      files.set(K(p), String(content))
      fs.events.push('write-end ' + p)
    },
    async rename(from, to) { const a = String(from); const b = String(to); files.set(K(b), files.get(K(a))); files.delete(K(a)) },
    async rm(p) { files.delete(K(p)) },
    async mkdir(p) { dirs.add(K(p)) },
    async lstat(p) { return files.has(K(p)) ? { mtime: 0 } : null },
    async stat(p) { return files.has(K(p)) ? { mtime: 0 } : null },
    async listDir(p) {
      const p2 = K(p).replace(/[/]+$/, '')
      if (!dirs.has(p2)) throw Object.assign(new Error('ENOENT: no such file or directory, scandir \'' + p + '\''), { code: 'ENOENT' })
      const out = new Set()
      const add = (k) => {
        if (!k.startsWith(p2 + '/')) return
        const rest = k.slice(p2.length + 1)
        const seg = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
        if (seg) out.add(seg)
      }
      for (const k of files.keys()) add(k)
      for (const d of dirs.keys()) add(d)
      return Array.from(out)
    },
  }
  return fs
}

const events = []
function mkCtx(fakeFs, cwd) {
  return {
    cwd: cwd || WS,
    platform: { path: nodePath.posix, fs: fakeFs },
    fs: fakeFs,
    logEvent: (level, event, fields) => events.push({ level: level, event: event, fields: fields }),
    isEnabled: () => false,
  }
}
function seed() { return { [MAP]: '# 演示地图\n\nStatus: ready-for-agent\n', [FILE_01]: TICKET_01, [FILE_02]: TICKET_02 } }
const tracker = markdownModule.create({})

// ── ① 同一张票，两路并发改不同的字段：两边的改动都在 ──
{
  const fake = makeFakeFs(seed())
  const ctx = mkCtx(fake)
  const p1 = tracker.update(REF, '01', { customFields: [{ name: 'Type', value: 'task' }] }, ctx)
  const p2 = tracker.setBlockedBy(REF, '01', ['02'], {}, ctx)
  const both = await Promise.all([p1, p2])
  check(both.every((r) => r.ok === true), '两路并发改同一张票都回成功（实得 ' + JSON.stringify(both.map((r) => r.ok)) + '）')
  const after = String(fake.show(FILE_01))
  check(after.includes('Type: task'), '① 先改的那一项（Type: task）没有被后写的那一路抹掉（文件里现在是：' + JSON.stringify(after.replace(/\n/g, ' | ')) + '）')
  check(after.includes('Blocked by: #02'), '① 另一项（Blocked by: #02）也写进去了')
}

// ── ② 关门与改标签并发（换一条写函数，守的是同一个毛病） ──
{
  const fake = makeFakeFs(seed())
  const ctx = mkCtx(fake)
  const p1 = tracker.close(REF, '01', {}, ctx)
  const p2 = tracker.setLabels(REF, '01', ['bug'], {}, ctx)
  const both = await Promise.all([p1, p2])
  check(both.every((r) => r.ok === true), '关门与改标签并发都回成功（实得 ' + JSON.stringify(both.map((r) => r.ok)) + '）')
  const after = String(fake.show(FILE_01))
  check(after.includes('Status: resolved'), '② 关门写下的状态还在')
  check(after.includes('Labels: bug'), '② 改标签写下的标签也还在（两路改动都在，实得：' + JSON.stringify(after.replace(/\n/g, ' | ')) + '）')
}

// ── ②之二、发评论与关门并发（写评论走的是另一个函数，守的是同一个毛病）──
{
  const fake = makeFakeFs(seed())
  const ctx = mkCtx(fake)
  const p1 = tracker.comment(REF, '01', '这条评论必须留在盘上', ctx)
  const p2 = tracker.close(REF, '01', {}, ctx)
  const both = await Promise.all([p1, p2])
  check(both.every((r) => r.ok === true), '发评论与关门并发都回成功（实得 ' + JSON.stringify(both.map((r) => r.ok)) + '）')
  const after = String(fake.show(FILE_01))
  check(after.includes('这条评论必须留在盘上'), '②之二 评论写进去了、没有被关门那一路抹掉')
  check(after.includes('Status: resolved'), '②之二 关门写下的状态也没有被评论那一路抹回（实得：' + JSON.stringify(after.replace(/\n/g, ' | ')) + '）')
}

// ── ③ 同一个工作区、路径写法不同：仍然排同一条队 ──
{
  const fake = makeFakeFs(seed())
  const lower = mkCtx(fake, '/ws')
  const upper = mkCtx(fake, '/WS')
  const p1 = tracker.update(REF, '01', { customFields: [{ name: 'Type', value: 'task' }] }, lower)
  const p2 = tracker.setBlockedBy(REF, '01', ['02'], {}, upper)
  const both = await Promise.all([p1, p2])
  check(both.every((r) => r.ok === true), '两种写法（/ws 与 /WS）并发改同一张票都回成功')
  const after = String(fake.show(FILE_01))
  check(after.includes('Type: task') && after.includes('Blocked by: #02'), '③ 两种写法落到同一条队上，两边的改动都在')
}

// ── ④ 不同票文件互不排队：读第一份时按住不放，第二份的读必须能开始 ──
{
  const fake = makeFakeFs(seed())
  const ctx = mkCtx(fake)
  let releaseFirst = null
  const firstGate = new Promise((res) => { releaseFirst = res })
  let firstReleased = false
  fake.readHook = async (p) => {
    if (/01-first\.md$/.test(p)) {
      const timeout = new Promise((res) => setTimeout(() => res('timeout'), 300))
      const won = await Promise.race([firstGate, timeout])
      if (won === 'timeout') firstReleased = true   // 没人来放行：说明第二份的读被同一把钥匙挡住了
    } else if (/02-second\.md$/.test(p)) {
      releaseFirst()
    }
  }
  const p1 = tracker.update(REF, '01', { customFields: [{ name: 'Type', value: 'task' }] }, ctx)
  const p2 = tracker.update(REF, '02', { customFields: [{ name: 'Type', value: 'task' }] }, ctx)
  const both = await Promise.all([p1, p2])
  check(both.every((r) => r.ok === true), '两张不同的票并发改都回成功')
  check(firstReleased === false, '④ 不同票文件互不排队：第二份的读在第一份还没写完时就开始了（串成一条队会在这里超时）')
  check(String(fake.show(FILE_01)).includes('Type: task') && String(fake.show(FILE_02)).includes('Type: task'), '④ 两张票各自的改动都落了盘')
}

console.log(failed ? '\n存在失败 — verify-922-ticket-file-queue 未通过' : '\n全部通过 — 票文件的单写者队列生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
