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

  console.log('== ② 三个以上目录、同号票并存：列表与单票读取按目录区分，不互相串 ==')
  {
    const root = fs.mkdtempSync(path.join(tmpRoot, 'multi-'))
    // alpha 是探索地图目录（map.md），beta 是规格目录（spec.md），gamma 只有票目录（issues/），
    // 三种工作单元混在一个工作区里，且每个目录都有 01 号票 —— 这正是按目录区分身份的验收形态。
    fs.mkdirSync(path.join(root, '.scratch', 'alpha', 'issues'), { recursive: true })
    fs.writeFileSync(path.join(root, '.scratch', 'alpha', 'map.md'), '# 阿尔法地图\n\nStatus: ready-for-agent\n\n## Destination\n\n夹具\n', 'utf8')
    writeTicket(path.join(root, '.scratch', 'alpha', 'issues'), '01-alpha-one.md', '阿尔法的第一张票')
    writeSpec(path.join(root, '.scratch', 'beta'), '贝塔规格')
    writeTicket(path.join(root, '.scratch', 'beta', 'issues'), '01-beta-one.md', '贝塔的第一张票')
    writeTicket(path.join(root, '.scratch', 'gamma', 'issues'), '01-gamma-one.md', '伽马的第一张票')
    const ctx = makeCtx(root)
    const be = createMarkdownBackend(ctx as never)

    const listed = await be.list(REPO as never, {} as never, ctx as never)
    check(listed.ok === true, '② 混合布局列表成功')
    const rows = listed.ok ? (listed.data as Array<Record<string, unknown>>) : []
    const tickets = rows.filter(function (r) { return r.type !== 'map' && r.type !== 'spec' })
    check(tickets.length === 3, '② 三个目录的票都列出来（' + tickets.length + '）')
    const byEffort: Record<string, string> = {}
    for (const t of tickets) {
      const key = String(t.effortId)
      check(t.key === '01', '② 目录 ' + key + ' 的同号票 key 仍是 01（目录身份由 effortId 区分）')
      byEffort[key] = String(t.title)
    }
    check(byEffort['alpha'] === '阿尔法的第一张票' && byEffort['beta'] === '贝塔的第一张票' && byEffort['gamma'] === '伽马的第一张票', '② 三行标题各自对应自己的目录，不互相串（' + JSON.stringify(byEffort) + '）')
    check(rows.filter(function (r) { return r.type === 'spec' }).length === 1, '② 规格目录的 spec 容器行也在（只该有一行）')

    for (const [effort, title] of [['alpha', '阿尔法的第一张票'], ['beta', '贝塔的第一张票'], ['gamma', '伽马的第一张票']] as Array<[string, string]>) {
      const got = await be.get(REPO as never, '01', { effortId: effort } as never, ctx as never)
      check(got.ok === true && got.data.title === title && got.data.effortId === effort, '② get(01, effortId=' + effort + ') 读回本目录的票（' + (got.ok ? got.data.title + '/' + got.data.effortId : '失败') + '）')
    }
    const scoped = await be.list(REPO as never, { effortId: 'beta' } as never, ctx as never)
    const scopedRows = scoped.ok ? (scoped.data as Array<Record<string, unknown>>) : []
    check(scoped.ok === true && scopedRows.every(function (r) { return r.effortId === 'beta' }), '② 列表按 effortId 收窄时只剩 beta 的行（' + scopedRows.length + ' 行）')
    check(scopedRows.some(function (r) { return r.type === 'spec' }) && scopedRows.some(function (r) { return r.key === '01' }), '② 收窄后的 beta 仍同时有规格行与 01 号票行')
  }

  console.log('== ③ 工作区根 issues/ 的旧票：可列出、可读、可改，读取时留兼容日志 ==')
  {
    const root = fs.mkdtempSync(path.join(tmpRoot, 'legacy-'))
    // #1486 之前没给工作单元时，建票落到工作区根 issues/；这些票还在原地，必须原样可用。
    writeTicket(path.join(root, 'issues'), '01-legacy-root.md', '旧版根目录的票')
    const ctx = makeCtx(root)
    const be = createMarkdownBackend(ctx as never)

    const pre = await be.preflight({ cwd: root, refId: '' } as never, ctx as never)
    check(pre.ok === true, '③ 只有工作区根 issues/ 的旧工作区预检通过')

    const listed = await be.list(REPO as never, {} as never, ctx as never)
    const rows = listed.ok ? (listed.data as Array<Record<string, unknown>>) : []
    const legacyRow = rows.filter(function (r) { return r.key === '01' })
    check(listed.ok === true && legacyRow.length === 1 && legacyRow[0].title === '旧版根目录的票', '③ 旧票照常列出来（' + (listed.ok ? rows.length : '失败') + ' 行）')
    const listLogs = degradations(ctx).filter(function (e) { return e.fields.reason === 'list:legacy-root' })
    check(listLogs.length === 1, '③ 列出旧票时留下一条 list:legacy-root 兼容日志（' + listLogs.length + '）')

    const got = await be.get(REPO as never, '01', {} as never, ctx as never)
    check(got.ok === true && got.data.title === '旧版根目录的票', '③ 旧票按编号读得到')
    const getLogs = degradations(ctx).filter(function (e) { return e.fields.reason === 'get:legacy-root' })
    check(getLogs.length === 1, '③ 读取旧票时留下一条 get:legacy-root 兼容日志（' + getLogs.length + '）')

    const updated = await be.update(REPO as never, '01', { title: '旧票改过的标题' } as never, ctx as never)
    check(updated.ok === true, '③ 旧票可改（update 成功）')
    const onDisk = fs.readFileSync(path.join(root, 'issues', '01-legacy-root.md'), 'utf8')
    check(onDisk.includes('旧票改过的标题'), '③ 改动落回工作区根 issues/ 的原文件（不迁移、不新建到 .scratch 下）')
    check(!fs.existsSync(path.join(root, '.scratch', 'issues', '01-legacy-root.md')), '③ 没有把旧票复制或迁移到 .scratch 下')
  }

  console.log('== ④ 重复编号与非规范文件名：退化显示规则固定、打日志、不抛错 ==')
  {
    const root = fs.mkdtempSync(path.join(tmpRoot, 'degenerate-'))
    const issues = path.join(root, '.scratch', 'buy-coffee', 'issues')
    writeSpec(path.join(root, '.scratch', 'buy-coffee'), '买咖啡积分')
    // 两个 01：不自作主张改号，显示退化成「目录/01-文件名」；一个没有编号的手写文件：
    // 显示退化成「目录/文件名」；notes.md 是约定俗成的说明文件，不算票。
    writeTicket(issues, '01-one.md', '第一张重复号票')
    writeTicket(issues, '01-two.md', '第二张重复号票')
    writeTicket(issues, '修复登录.md', '手写的修复登录票')
    fs.writeFileSync(path.join(issues, 'notes.md'), '# 说明\n\n这不是票\n', 'utf8')
    const ctx = makeCtx(root)
    const be = createMarkdownBackend(ctx as never)

    const listed = await be.list(REPO as never, {} as never, ctx as never)
    check(listed.ok === true, '④ 有重复编号与无编号文件时列表不抛错，照常成功')
    const rows = listed.ok ? (listed.data as Array<Record<string, unknown>>) : []
    const ticketRows = rows.filter(function (r) { return r.type !== 'map' && r.type !== 'spec' })
    check(ticketRows.length === 3, '④ 两张重复号票加一张手写票，共 3 行；notes.md 不算票（' + ticketRows.length + '）')
    const keys = ticketRows.map(function (r) { return String(r.key) })
    check(keys.indexOf('buy-coffee/01-one') >= 0 && keys.indexOf('buy-coffee/01-two') >= 0, '④ 重复编号显示成「目录/编号-文件名」（' + JSON.stringify(keys) + '）')
    check(keys.indexOf('buy-coffee/修复登录') >= 0, '④ 没有编号的手写文件显示成「目录/文件名」（' + JSON.stringify(keys) + '）')
    check(ticketRows.every(function (r) { return r.effortId === 'buy-coffee' }), '④ 退化行仍带工作单元 effortId，界面能按目录分组')

    const listLogs = degradations(ctx).filter(function (e) { return e.fields.reason === 'list:dup-number' })
    check(listLogs.length === 1, '④ 列出退化身份时只留一条 list:dup-number 日志（' + listLogs.length + '）')

    const got = await be.get(REPO as never, 'buy-coffee/01-one', { effortId: 'buy-coffee' } as never, ctx as never)
    check(got.ok === true && got.data.title === '第一张重复号票', '④ 退化身份可以直接按 key 读回（内部寻址一起退化）')
    const gotWritten = await be.get(REPO as never, 'buy-coffee/修复登录', {} as never, ctx as never)
    check(gotWritten.ok === true && gotWritten.data.title === '手写的修复登录票', '④ 手写票按「目录/文件名」也读得到（不带 effortId 也行）')
    const getLogs = degradations(ctx).filter(function (e) { return e.fields.reason === 'get:dup-number' })
    check(getLogs.length >= 1, '④ 读退化身份时留下 get:dup-number 日志（' + getLogs.length + '）')

    // 旧聊天链接 #01 仍要能打开其中一张（读语义按目录顺序回落），不能因为编号重复就失效。
    const oldLink = await be.get(REPO as never, '01', { effortId: 'buy-coffee' } as never, ctx as never)
    check(oldLink.ok === true, '④ 旧链接 #01 仍能读回一张票（不因编号重复而失败）')

    const counts = await be.counts(REPO as never, {} as never, ctx as never)
    check(counts.ok === true && counts.data.total === 3, '④ 计数把退化身份的票都算上（' + (counts.ok ? counts.data.total : '失败') + '）')

    // 同一趟 list 里只留一条 dup 日志：数一遍本文件的总行数，避免多张退化票刷出多条。
    check(degradations(ctx).length <= 8, '④ 退化日志没有按文件数刷屏（本段累计 ' + degradations(ctx).length + ' 条）')
  }

  console.log('== ⑤ 环境预检、计数、分页在混合布局下都正常 ==')
  {
    const root = fs.mkdtempSync(path.join(tmpRoot, 'read-paths-'))
    // 混合布局：一个探索地图单元（2 票）、一个规格单元（3 票）、一个旧版工作区根 issues/（1 票）。
    fs.mkdirSync(path.join(root, '.scratch', 'map-unit', 'issues'), { recursive: true })
    fs.writeFileSync(path.join(root, '.scratch', 'map-unit', 'map.md'), '# 地图单元\n\nStatus: ready-for-agent\n', 'utf8')
    writeTicket(path.join(root, '.scratch', 'map-unit', 'issues'), '01-map-a.md', '地图下的第一张票', 'ready-for-agent')
    writeTicket(path.join(root, '.scratch', 'map-unit', 'issues'), '02-map-b.md', '地图下的第二张票', 'resolved')
    writeSpec(path.join(root, '.scratch', 'spec-unit'), '规格单元')
    writeTicket(path.join(root, '.scratch', 'spec-unit', 'issues'), '01-spec-a.md', '规格下的第一张票', 'ready-for-agent')
    writeTicket(path.join(root, '.scratch', 'spec-unit', 'issues'), '02-spec-b.md', '规格下的第二张票', 'resolved')
    writeTicket(path.join(root, '.scratch', 'spec-unit', 'issues'), '03-spec-c.md', '规格下的第三张票', 'ready-for-agent')
    writeTicket(path.join(root, 'issues'), '01-legacy.md', '旧版根目录的票', 'ready-for-agent')
    const ctx = makeCtx(root)
    const be = createMarkdownBackend(ctx as never)

    const pre = await be.preflight({ cwd: root, refId: '' } as never, ctx as never)
    check(pre.ok === true, '⑤ 混合布局下环境预检通过（' + JSON.stringify(pre.ok ? pre.data : pre.error) + '）')

    const listed = await be.list(REPO as never, {} as never, ctx as never)
    check(listed.ok === true, '⑤ 混合布局下列表成功')
    const rows = listed.ok ? (listed.data as Array<Record<string, unknown>>) : []
    const containers = rows.filter(function (r) { return r.type === 'map' || r.type === 'spec' })
    const tickets = rows.filter(function (r) { return r.type !== 'map' && r.type !== 'spec' })
    check(containers.length === 2, '⑤ 两个容器行：地图与规格各一行（' + containers.length + '）')
    check(tickets.length === 6, '⑤ 三处目录共 6 张票（2+3+1，' + tickets.length + '）')
    // 旧版工作区根 issues/ 没有目录名，effortId 是空串：它保留编号身份、仍算一张票。
    const identities = tickets.map(function (r) { return String(r.effortId) + '/' + String(r.key) }).sort()
    check(identities.join(',') === '/01,map-unit/01,map-unit/02,spec-unit/01,spec-unit/02,spec-unit/03', '⑤ 票按各自工作单元标注，旧根目录票的 effortId 为空（' + JSON.stringify(identities) + '）')

    const counts = await be.counts(REPO as never, {} as never, ctx as never)
    check(counts.ok === true && counts.data.total === 6, '⑤ 计数只数票、不把 map/spec 容器算进去（' + (counts.ok ? counts.data.total : '失败') + '）')
    check(counts.ok === true && counts.data.open === 4 && counts.data.closed === 2, '⑤ 计数按状态分开：4 张未关闭 + 2 张已关闭（' + (counts.ok ? JSON.stringify(counts.data) : '失败') + '）')
    const scopedCounts = await be.counts(REPO as never, { effortId: 'spec-unit' } as never, ctx as never)
    check(scopedCounts.ok === true && scopedCounts.data.total === 3, '⑤ 计数能按工作单元收窄（规格单元 3 张，' + (scopedCounts.ok ? scopedCounts.data.total : '失败') + '）')

    const page1 = await be.listPage(REPO as never, {} as never, { limit: 2 } as never, ctx as never)
    check(page1.ok === true, '⑤ 混合布局下分页成功')
    check(page1.ok === true && page1.data.total === 6, '⑤ 分页的 total 是票数、不含容器（' + (page1.ok ? page1.data.total : '失败') + '）')
    const page1Items = page1.ok ? (page1.data.items as Array<Record<string, unknown>>) : []
    check(page1Items.length === 2, '⑤ 第一页按 limit 取 2 张票（' + page1Items.length + '）')
    check(page1Items.every(function (r) { return r.type !== 'map' && r.type !== 'spec' }), '⑤ 分页的 items 里没有 map/spec 容器行')
    check(page1.ok === true && page1.data.nextCursor === '2', '⑤ 第一页给出下一页游标（' + (page1.ok ? String(page1.data.nextCursor) : '失败') + '）')

    const page2 = await be.listPage(REPO as never, {} as never, { limit: 2, cursor: '2' } as never, ctx as never)
    const page2Items = page2.ok ? (page2.data.items as Array<Record<string, unknown>>) : []
    check(page2.ok === true && page2Items.length === 2 && page2.data.nextCursor === '4', '⑤ 第二页接着取 2 张、游标前进到 4（' + (page2.ok ? String(page2.data.nextCursor) : '失败') + '）')
    const page3 = await be.listPage(REPO as never, {} as never, { limit: 2, cursor: '4' } as never, ctx as never)
    const page3Items = page3.ok ? (page3.data.items as Array<Record<string, unknown>>) : []
    check(page3.ok === true && page3Items.length === 2 && page3.data.nextCursor === null, '⑤ 最后一页取完 2 张、游标收尾为 null（' + (page3.ok ? String(page3.data.nextCursor) : '失败') + '）')
    const seen = page1Items.concat(page2Items, page3Items).map(function (r) { return String(r.effortId) + '/' + String(r.key) })
    check(new Set(seen).size === 6, '⑤ 三页合起来把 6 张票各取到一次、没有漏取或重复（' + JSON.stringify(seen) + '）')

    // 窄到一个工作单元时，分页也只在该单元内翻。
    const scopedPage = await be.listPage(REPO as never, { effortId: 'spec-unit' } as never, { limit: 10 } as never, ctx as never)
    check(scopedPage.ok === true && scopedPage.data.total === 3 && (scopedPage.data.items as unknown[]).length === 3, '⑤ 分页能按工作单元收窄（规格单元 3 张全取到）')
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true })
  console.log(failed ? '\nFAILED' : '\nALL PASS')
  process.exitCode = failed ? 1 : 0
}

main().catch(function (e) { console.error(e); process.exitCode = 1 })
