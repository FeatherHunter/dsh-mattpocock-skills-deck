/**
 * tests/verify-1692-disk-replay-eviction.ts —— 磁盘快照退役与按需细节淘汰门禁（#1692 立，#1870 改题）
 *
 * 文件名与在链上的位置保留（收口矩阵按名字引用它），但它现在守两件事：
 *   A 整份磁盘快照退役（#1870）：旧的 .dsh-mattskillsdeck-cache/<owner>__<repo>.json 不再被读、
 *     不再被写、不再被迁移；格式模块已删除；两条快照宿主方法与它们的装配处都不再引用那三个口。
 *     旧 JSON 文件仍原地留在磁盘上——谁也不碰它，所以它的字节一个都不会变。
 *   B 按需细节淘汰（#1692 的原有判据，随内存工作副本一起保留）：条数上限 200、字节上限 512KB
 *     两个数只住 kernel/detail-eviction.ts；淘汰只删内容、留「曾取过」记号，行本身、父子边、
 *     依赖边、子票计数永不淘汰。
 *   C 显示（#1692 的原有判据）：面板按回放注记说「上次已知（HH:mm）」；详情页对已淘汰的行
 *     说「未取（曾在 HH:mm）」，不画成空白。
 *   D 接线：首屏与刷新的读写都经本地快照库门面；行级写回仍跑淘汰；没有新增定时器。
 *
 * 原来的 A 段（磁盘格式 schema 4、来源聚合、旧格式照读）随 #1870 一起退役——那段判据守的
 * 文件格式已经不存在了，留着重演它只会让人以为那份 JSON 还在被读。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1692-disk-replay-eviction.ts
 */
// 门禁归属: src/refresh/kernel/detail-eviction.ts
// 门禁归属: src/refresh/rooms/host/git-execution.ts

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import * as ev from '../src/refresh/kernel/detail-eviction.ts'
import { truthNoticeLines } from '../src/client/views/shared/truthLines.ts'

const GATE = 'verify-1692-disk-replay-eviction'
const ROOT = process.cwd()
let total = 0
let failed = 0

function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) {
    console.log('PASS ' + message)
    return
  }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function srcText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

const CLOCK0 = 1761870000000 // 2026-10-31 09:00 左右，门禁里的固定时刻
const CLOCK1 = CLOCK0 + 60000

function stamp(source: string, completeness: string): any {
  return { version: 7, atMs: CLOCK0, source: source, operation: 'get', completeness: completeness }
}

function groupsOf(entries: any[]): any {
  const g: any = {}
  for (let i = 0; i < entries.length; i++) g[entries[i][0]] = stamp(entries[i][1], entries[i][2])
  return g
}

/** 一行薄行：骨架字段给全，按需内容按需挂。 */
function row(n: number, extra?: any): any {
  const base: any = {
    number: n,
    key: String(n),
    title: '票 ' + n,
    state: 'OPEN',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: ['me'],
    author: { login: 'me' },
    updatedAt: '2026-10-30T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    parentKey: '100',
    blockedBy: [{ number: 301, key: '301' }],
    subIssueCounts: { total: 3, open: 2, closed: 1 },
    commentCount: 2,
    provenance: { operation: 'get', source: 'graphql', completeness: 'complete', fieldGroups: {}, missingFieldGroups: [], durationMs: 12, startVersion: 6 },
  }
  return extra ? Object.assign(base, extra) : base
}

function contentRow(n: number, touchedAt: number, body: string): any {
  return row(n, {
    body: body,
    comments: [{ id: 'c1', body: '评论' }],
    reviews: [{ id: 'r1', state: 'APPROVED' }],
    subIssues: [{ number: n + 1, title: '子票' }],
    detailTouchedAt: touchedAt,
  })
}

/** 一份正常的、带合并组戳的快照：来源与完整度都从组戳读。 */
function makeSnapshot(): any {
  return {
    ok: true,
    version: 7,
    etag: 'etag-7',
    generatedMs: CLOCK0 - 3600000,
    updatedAt: '2026-10-31T08:00:00Z',
    issues: [row(1, { body: '完整正文', comments: [{ id: 'c1', body: '评论' }], reviews: [{ id: 'r1' }] })],
    maps: [{ id: 'm1', title: '地图', tickets: [row(2)], stats: { total: 2, open: 1 } }],
    merge: { version: 7, lastStartMs: CLOCK0 - 7200000, groups: groupsOf([['row', 'graphql', 'complete'], ['body', 'graphql', 'complete'], ['labels', 'graphql', 'complete']]) },
  }
}

function main(): void {
  console.log('磁盘快照退役与按需细节淘汰门禁（#1692 / #1870）')

  // ── A 整份磁盘快照退役（#1870）：旧 JSON 不读、不写、不迁、不删 ──
  {
    check(!existsSync(path.join(ROOT, 'src/refresh/kernel/disk-snapshot-format.ts')), 'A1 旧磁盘快照的格式模块已删除')

    const gitSrc = srcText('src/refresh/rooms/host/git-execution.ts')
    check(!/readDiskCache|writeDiskCache|cacheFileName|readDiskSnapshot|buildDiskSnapshot/.test(gitSrc), 'A2 宿主执行层不再有读写旧 JSON 的函数')

    const snapshotHostModules = [
      'src/refresh/rooms/host/session-snapshot-cache.ts',
      'src/refresh/rooms/host/session-refresh-schedule.ts',
      'src/refresh/rooms/host/issue-list-fetch.ts',
      'src/refresh/rooms/host/issue-index-scan.ts',
      'src/refresh/rooms/host/comment-thread-fetch.ts',
      'src/refresh/rooms/host/patch-wiring.ts',
      'src/host/index.ts',
    ]
    const dirty = snapshotHostModules.filter(function (rel) { return /readDiskCache|writeDiskCache|cacheFileName/.test(srcText(rel)) })
    check(dirty.length === 0, 'A3 快照宿主方法与它们的装配处都不再引用旧的磁盘快照口', dirty)

    // 全仓源码扫一遍：三个旧口与两个格式函数一个都不许留（命中就是还有人在读写那份 JSON）。
    const offenders: string[] = []
    const stack: string[] = [path.join(ROOT, 'src')]
    let sourceChars = 0
    while (stack.length) {
      const dir = stack.pop() as string
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) { stack.push(full); continue }
        if (!/\.(ts|mts)$/.test(name)) continue
        const txt = readFileSync(full, 'utf8')
        sourceChars += txt.length
        if (/readDiskCache|writeDiskCache|cacheFileName|buildDiskSnapshot|readDiskSnapshot/.test(txt)) {
          offenders.push(path.relative(ROOT, full).replace(/\\/g, '/'))
        }
      }
    }
    check(offenders.length === 0, 'A4 全仓 src 里再没有旧的整份磁盘快照读写口', offenders)
    check(sourceChars > 0 && !gitSrc.includes('__' + 'name.json'), 'A5 宿主执行层里再没有旧快照的文件名拼法')

    // 旧文件原地不动：本地快照库只认一个 .sqlite 文件，库路径从不指向那份 JSON。
    const libPaths = srcText('src/workspace-snapshot/runtime/paths.ts')
    check(libPaths.indexOf('.sqlite') >= 0 && libPaths.indexOf('.json') < 0, 'A6 本地快照库只认 .sqlite 一个文件，库路径不指向旧的 JSON（旧文件原地留着，谁也不碰）')
  }

  // ── B 按需细节淘汰：条数/字节上限、LRU、留记号、骨架不淘汰 ──
  {
    check(ev.DETAIL_EVICTION_MAX_ENTRIES === 200, 'B1 条数上限 200 住 kernel/detail-eviction.ts')
    check(ev.DETAIL_EVICTION_MAX_BYTES === 512 * 1024, 'B2 字节上限 512KB 住 kernel/detail-eviction.ts')
    check(ev.DETAIL_EVICTION_LIMITS.maxEntries === 200 && ev.DETAIL_EVICTION_LIMITS.maxBytes === 512 * 1024, 'B3 默认上限对象就是这两个常量，没有第二份拷贝')
    check(ev.EVICTABLE_CONTENT_FIELDS.join('|') === 'body|comments|reviews|subIssues', 'B4 可淘汰的只有四类按需内容，名单只此一处')
    check(ev.utf8Bytes('中') === 3 && ev.utf8Bytes('ab') === 2, 'B5 字节数按 UTF-8 手算（中文 3 字节、ASCII 1 字节）')

    const under = { version: 1, issues: [contentRow(1, CLOCK0 - 5000, '正文一'), contentRow(2, CLOCK0 - 4000, '正文二')] }
    const keepAll = ev.evictDetailsInSnapshot(under, { nowMs: CLOCK1, limits: { maxEntries: 200, maxBytes: 512 * 1024 } })
    check(keepAll.stats.evicted === 0 && keepAll.stats.kept === 2, 'B6 没到上限时一行都不淘汰（2 行全留）')
    check(keepAll.snapshot === under, 'B7 没变化时原快照引用返回，不白造新对象')

    const four: any = {
      version: 1,
      issues: [contentRow(1, CLOCK0 - 3000, '最旧正文'), contentRow(2, CLOCK0 - 2000, '中间正文'), contentRow(3, CLOCK0 - 1000, '最新正文')],
      maps: [{ id: 'm1', title: '地图', tickets: [contentRow(9, CLOCK0 - 9000, '地图最旧正文')], stats: { total: 2, open: 1 } }],
    }
    const byEntries = ev.evictDetailsInSnapshot(four, { nowMs: CLOCK1, limits: { maxEntries: 2, maxBytes: 1024 * 1024 } })
    check(byEntries.stats.evicted === 2 && byEntries.stats.kept === 2, 'B8 超过条数上限：留下最新 2 行，淘汰最旧 2 行')
    check(byEntries.snapshot.issues.length === 3 && byEntries.snapshot.maps[0].tickets.length === 1, 'B9 淘汰只删内容，行数与地图子票行数一条不少')
    check(byEntries.snapshot.issues[0].body === undefined && byEntries.snapshot.issues[0].comments === undefined, 'B10 最旧那行（key 1）的正文与评论被清掉')
    check(byEntries.snapshot.maps[0].tickets[0].body === undefined, 'B11 地图里最旧的那行内容也被清掉')
    check(byEntries.snapshot.issues[2].body === '最新正文' && byEntries.snapshot.issues[2].comments.length === 1, 'B12 最新那行内容完好')
    const mark = byEntries.snapshot.issues[0].detailEvicted
    check(mark && mark.atMs === CLOCK1 && mark.lastKnownAtMs === CLOCK0 - 3000, 'B13 淘汰后留记号：何时淘汰、上次已知是什么时候')
    check(mark && mark.fields.join('|') === 'body|comments|reviews|subIssues', 'B14 记号写明淘汰了哪几栏，界面据此说「未取」而不是「空白」')
    const goneA = byEntries.snapshot.issues[0]
    check(goneA.number === 1 && goneA.title === '票 1' && goneA.state === 'OPEN', 'B15 骨架（编号/标题/状态）永不淘汰')
    check(goneA.parentKey === '100' && goneA.blockedBy.length === 1, 'B16 父子边、依赖边永不淘汰')
    check(goneA.subIssueCounts.total === 3 && goneA.commentCount === 2, 'B17 子票计数与评论数永不淘汰')
    check(goneA.labels.length === 1 && goneA.assignees.join('|') === 'me' && goneA.author.login === 'me', 'B18 标签、经办人、作者永不淘汰')
    check(goneA.provenance && goneA.provenance.source === 'graphql', 'B19 行上未知字段（如 provenance）原样保留，只删内容栏')
    check(JSON.stringify(byEntries.snapshot.maps[0].stats) === JSON.stringify({ total: 2, open: 1 }), 'B20 地图上的子票计数原样保留')
    check(byEntries.snapshot.maps[0].stats === four.maps[0].stats || JSON.stringify(byEntries.snapshot.maps[0].stats) === JSON.stringify(four.maps[0].stats), 'B21 被改写的只有 tickets 数组，地图对象其余字段照旧')

    const byteRowA: any = contentRow(1, CLOCK0 - 3000, '甲'.repeat(10))
    const byteRowB: any = contentRow(2, CLOCK0 - 2000, '乙'.repeat(10))
    const byteRowC: any = contentRow(3, CLOCK0 - 1000, '丙'.repeat(10))
    const bC = ev.contentBytesOf(JSON.parse(JSON.stringify(byteRowC)))
    const bB = ev.contentBytesOf(JSON.parse(JSON.stringify(byteRowB)))
    const bA = ev.contentBytesOf(JSON.parse(JSON.stringify(byteRowA)))
    const byBytes = ev.evictDetailsInSnapshot({ version: 1, issues: [byteRowA, byteRowB, byteRowC] }, { nowMs: CLOCK1, limits: { maxEntries: 200, maxBytes: bC } })
    check(byBytes.stats.kept === 1 && byBytes.stats.evicted === 2, 'B22 超过字节上限：只留最新一行，其余淘汰')
    check(byBytes.stats.keptBytes === bC && byBytes.stats.evictedBytes === bA + bB, 'B23 字节账对得上：留下的字节等于最新一行，淘汰的等于另外两行之'
    )
    check(byBytes.snapshot.issues[2].body !== undefined && byBytes.snapshot.issues[1].body === undefined, 'B24 字节上限下留的仍是最新那行（LRU 不是按位置）')

    const again = ev.evictDetailsInSnapshot(byEntries.snapshot, { nowMs: CLOCK1 + 1000, limits: { maxEntries: 2, maxBytes: 1024 * 1024 } })
    check(again.stats.evicted === 0 && again.snapshot === byEntries.snapshot, 'B25 二次跑零淘汰且原引用返回（幂等，不会把已淘汰的行再改写）')

    const touchRows = [contentRow(1, CLOCK0 - 3000, '旧'), contentRow(2, CLOCK0 - 2000, '中'), contentRow(3, CLOCK0 - 5000, '刚取到')]
    const touched = ev.evictDetailsInSnapshot({ version: 1, issues: touchRows }, { nowMs: CLOCK1, limits: { maxEntries: 2, maxBytes: 1024 * 1024 }, freshKeys: { 3: true } })
    check(touched.stats.touched === 1 && touchRows[2].detailTouchedAt === CLOCK1, 'B26 本轮真拿到的行打上当前时间戳（没被淘汰的也打）')
    check(touched.snapshot.issues[2].body === '刚取到' && touched.snapshot.issues[1].body === '中', 'B27 刚取到的行排到最新，留下不淘汰')
    check(touched.snapshot.issues[0].body === undefined, 'B28 最旧的那行被淘汰')

    const noStamp: any = contentRow(1, 0, '没有时间戳的旧数据')
    delete noStamp.detailTouchedAt
    const stamped = ev.evictDetailsInSnapshot({ version: 1, issues: [noStamp, contentRow(2, CLOCK0 - 9000, '很久以前')] }, { nowMs: CLOCK1, limits: { maxEntries: 1, maxBytes: 1024 * 1024 } })
    check(noStamp.detailTouchedAt === CLOCK1 && stamped.stats.touched === 1, 'B29 旧数据没有时间戳时视为现在拿到，补上时间戳')
    check(stamped.snapshot.issues[0].body !== undefined && stamped.snapshot.issues[1].body === undefined, 'B30 补戳后它是最新的一行，淘汰的反而是有旧戳的那行')

    const nullSnap = ev.evictDetailsInSnapshot(null, { nowMs: CLOCK1 })
    check(nullSnap.snapshot === null && nullSnap.stats.evicted === 0, 'B31 负例：快照不是对象时原样返回，不抛错')
  }

  // ── C 显示：回放句与「未取（曾在某时）」 ──
  {
    const at = new Date(2026, 9, 31, 9, 23, 0).getTime()
    const st = { snapshot: { diskReplay: { schema: 3, source: 'legacy-unknown', completeness: 'unknown', legacy: true, lastKnownAtMs: at } } }
    const lines = truthNoticeLines(st, at + 3600000)
    const line = lines.filter(function (l: any) { return l.key === 'truth.replayLastKnown' })[0]
    check(!!line, 'C1 磁盘回放时面板有一条「上次已知」提示')
    check(line && line.kind === 'replay' && line.tone === 'yellow', 'C2 回放提示是单独一类（replay）、黄档，不混进失败或额度句')
    check(line && line.params && line.params.time === '09:23', 'C3 提示里写清上次已知到哪一刻（HH:mm）')

    const fresh = truthNoticeLines({ snapshot: { diskReplay: null } }, at)
    check(!fresh.some(function (l: any) { return l.key === 'truth.replayLastKnown' }), 'C4 负例：不是回放（没有 diskReplay）时不说这句话')
    const zero = truthNoticeLines({ snapshot: { diskReplay: { lastKnownAtMs: 0 } } }, at)
    check(!zero.some(function (l: any) { return l.key === 'truth.replayLastKnown' }), 'C5 负例：回放时刻为 0（未知）时不说「上次已知」')

    // #1864 起「已淘汰的内容怎么画」从详情页搬到了读投影（views/shared/detailProjection.ts）：
    // 判据还在，只是换了个文件住；详情页仍负责把投影算出的正文格画出来。
    const detailSrc = srcText('src/client/views/IssueDetail.ts')
    const detailProjSrc = srcText('src/client/views/shared/detailProjection.ts')
    check(detailProjSrc.indexOf("tr('detail.evictedAt'") >= 0, 'C6 详情页对已淘汰的内容说「未取（曾在某时）」，不画成空白')
    check(detailSrc.indexOf('proj.bodySlot') >= 0 && detailProjSrc.indexOf('snapIssue.detailEvicted') >= 0 && detailProjSrc.indexOf('lastKnownAtMs') >= 0,
      'C7 详情页判断依据是行上的淘汰记号与上次已知时刻')

    const flow = srcText('config/copy/flow.yaml')
    check(flow.indexOf('detail.evictedAt') >= 0 && flow.indexOf('未取（曾在') >= 0, 'C8 词表两个语言都有「未取（曾在 {time}）」这一条')
    const pages = srcText('config/copy/pages.yaml')
    check(pages.indexOf('truth.replayLastKnown') >= 0 && pages.indexOf('上次已知（') >= 0, 'C9 词表两个语言都有「上次已知（{time}）」这一条')

    // #1869 真机演练补：本地快照库自己报的开库诊断（损坏重建、只读）也要走这条状态行，
    // 否则库坏了重建完，列表区只剩「加载中… 暂无」，谁也看不出本机数据被清掉。
    const corruptDiag = truthNoticeLines({ snapshot: { snapshotDiagnostics: [{ code: 'corrupt-rebuilt', message: '本地快照已重建' }] } }, at)
    check(corruptDiag.some(function (l: any) { return l.key === 'truth.snapshotCorrupt' }), 'C10 库损坏重建时状态行说「已整库重建」')
    const readOnlyDiag = truthNoticeLines({ snapshot: { snapshotDiagnostics: [{ code: 'lease-held-readonly', message: '另一个窗口在写' }] } }, at)
    check(readOnlyDiag.some(function (l: any) { return l.key === 'truth.snapshotReadonly' }), 'C11 只读租约时状态行说「以只读显示」')
    check(!truthNoticeLines({ snapshot: { snapshotDiagnostics: [] } }, at).some(function (l: any) { return l.kind === 'snapshot' }), 'C12 负例：没有开库诊断时不说快照提示')
    check(pages.indexOf('truth.snapshotCorrupt') >= 0 && pages.indexOf('本地快照已损坏') >= 0 && pages.indexOf('Local snapshot was corrupt') >= 0, 'C13 词表两个语言都有快照诊断这一组')
  }

  // ── D 接线：新库是唯一持久副本，行级写回仍跑淘汰，且没新增定时器 ──
  {
    const cacheSrc = srcText('src/refresh/rooms/host/session-snapshot-cache.ts')
    check(cacheSrc.indexOf('firstScreenFromLibrary') >= 0 && cacheSrc.indexOf('commitRows') >= 0, 'D1 首屏的读与写都经快照库门面：先读库回放，取回的行整批写库')
    const refreshSrc = srcText('src/refresh/rooms/host/session-refresh-schedule.ts')
    check(refreshSrc.indexOf('recordIssueRows') >= 0, 'D2 一轮刷新整批写进同一个库（先提交，再交给界面）')

    const rpSrc = srcText('src/refresh/rooms/host/row-patch.ts')
    check(rpSrc.split('evictForWrite(merged.snapshot, got.rows)').length - 1 >= 2, 'D3 读事件与写事件两条写回路径都在写回前跑淘汰')
    check(rpSrc.indexOf('fields.evicted = e.evicted') >= 0 && rpSrc.indexOf('fields.evictedBytes') >= 0, 'D4 refresh.patch 日志带淘汰条数与字节数（只在真淘汰时出现）')

    const timerFiles = [
      'src/refresh/rooms/host/git-execution.ts',
      'src/refresh/rooms/host/row-patch.ts',
      'src/refresh/rooms/host/session-snapshot-cache.ts',
      'src/refresh/kernel/detail-eviction.ts',
    ]
    let timerHits = 0
    for (let i = 0; i < timerFiles.length; i++) {
      const t = srcText(timerFiles[i])
      timerHits += (t.match(/setInterval|setTimeout/g) || []).length
    }
    check(timerHits === 0, 'D5 这一票没有新增定时器：写回/回放/淘汰几处都不出现 setInterval/setTimeout')
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 磁盘快照退役与按需细节淘汰门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main()
