/**
 * tests/verify-1692-disk-replay-eviction.ts —— 磁盘回放来源与按需细节淘汰门禁（#1692）
 *
 * 守什么：磁盘上的快照文件从此带格式版本与整仓级来源/完整度，旧文件照读并如实标「来源未知」；
 * 回放出来的内容降为「上次已知（某一刻）」；行上的按需细节（正文、评论、评审、子票清单）按条数与
 * 字节上限做 LRU 淘汰，只淘汰内容、留「曾取过」记号，行本身、父子边、依赖边、子票计数永不淘汰。
 *
 * 逐条对应票 #1692 的验收：
 *   A 磁盘格式：schema 4 写盘、来源/完整度由 merge 组戳聚合、来源种类超限塌成整仓级；
 *     旧格式（cacheFormat 3）照读并按「来源未知」回放，文件里已有的字段一个都不删；
 *     新增字段只走信封，不碰 snapshot.version/etag，也不碰合并协议 snapshot.merge 本身。
 *   B 淘汰：条数上限 200、字节上限 512KB 两个数只住 kernel/detail-eviction.ts；
 *     超条数淘汰最旧的、超字节同样停；淘汰后写 detailEvicted 记号（何时、哪几栏、上次已知时刻），
 *     骨架字段与地图行、子票计数、边一概不动（负例逐个断言）；本轮真拿到的行打新时间戳；
 *     已经没有内容可淘汰时原引用返回（二次跑零淘汰）。
 *   C 显示：面板提示行按 diskReplay.lastKnownAtMs 说「上次已知（HH:mm）」；详情页对已淘汰的行
 *     说「未取（曾在 HH:mm）」，不画成空白。
 *   D 接线：格式与淘汰收在 kernel 两个纯模块里，读盘/写盘/行级写回三处真的调它们；
 *     这一票没有新增任何 setInterval/setTimeout（清理挂在既有读写与刷新节拍上）。
 *
 * 为什么用真模块跑：这一条守的是「文件里到底写了什么、回放时人看到什么」，换一种等价的格式
 * 实现而结论不变时不该误报。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1692-disk-replay-eviction.ts
 */
// 门禁归属: src/refresh/kernel/disk-snapshot-format.ts
// 门禁归属: src/refresh/kernel/detail-eviction.ts
// 门禁归属: src/refresh/rooms/host/git-execution.ts

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import * as disk from '../src/refresh/kernel/disk-snapshot-format.ts'
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
  console.log('磁盘回放来源与按需细节淘汰门禁（#1692）')

  // ── A 磁盘格式：版本、来源、完整度、旧格式按未知、字段一个不删 ──
  {
    check(disk.DISK_SNAPSHOT_SCHEMA === 4, 'A1 写盘格式版本是 4')
    check(disk.DISK_SNAPSHOT_SCHEMA_LEGACY === 3, 'A2 升级前的旧格式版本是 3，读盘仍认')
    check(disk.DISK_SOURCE_MAX_KINDS === 3, 'A3 一条快照里最多逐条记 3 种来源，超过就塌成整仓级')
    check(disk.DISK_SOURCE_LEGACY === 'legacy-unknown' && disk.DISK_SOURCE_UNKNOWN === 'unknown', 'A4 「旧格式来源未知」与「没有来源」是两个词，不混用')

    const snap = makeSnapshot()
    const built = disk.buildDiskSnapshot(snap, CLOCK0)
    check(built.cacheFormat === 4 && built.diskMeta && built.diskMeta.schema === 4, 'A5 落盘对象带 cacheFormat 4 与 diskMeta.schema 4')
    check(built.diskMeta.source === 'graphql' && built.diskMeta.completeness === 'complete', 'A6 来源与完整度从 merge 组戳聚合出来（graphql / complete）')
    check(built.diskMeta.writtenAtMs === CLOCK0, 'A7 回放用的「上次已知」时刻就是写盘那一刻')
    check(built.diskMeta.groups === 3 && built.diskMeta.sources.join('|') === 'graphql', 'A8 组数与去重后的来源名单一起写进信封')
    check(built.version === 7 && built.etag === 'etag-7', 'A9 新信封不碰 snapshot.version 与 etag（304 语义原样）')
    check(built.merge === snap.merge && snap.merge.version === 7, 'A10 合并协议 snapshot.merge 的对象引用都不换')

    const twoSource = disk.diskSourceOf({ merge: { groups: groupsOf([['row', 'graphql', 'complete'], ['body', 'rest', 'truncated']]) } })
    check(twoSource.source === 'mixed', 'A11 两种来源混在一份里，整仓级来源记 mixed')
    check(twoSource.sources.join('|') === 'graphql|rest' && twoSource.collapsed === false, 'A12 两种来源逐条记下来（排序稳定），没超限不塌缩')
    check(twoSource.completeness === 'truncated', 'A13 完整度按最保守的来：有一组截断就记 truncated')

    const fourSource = disk.diskSourceOf({ merge: { groups: groupsOf([['row', 'a', 'complete'], ['body', 'b', 'complete'], ['labels', 'c', 'complete'], ['comments', 'd', 'complete']]) } })
    check(fourSource.collapsed === true && fourSource.source === 'mixed' && fourSource.sources.join('|') === 'mixed', 'A14 来源种类超过上限时塌成单一整仓级来源，不逐条膨胀')
    check(fourSource.completeness === 'complete', 'A15 塌缩来源不丢完整度')

    const bare = disk.diskSourceOf({})
    check(bare.source === 'unknown' && bare.completeness === 'unknown' && bare.groups === 0, 'A16 没有合并组戳时来源与完整度都记未知，不冒充完整')

    const back = disk.readDiskSnapshot(built)
    check(back.ok === true && back.legacy === false, 'A17 新格式读回成功，且不标 legacy')
    check(back.snapshot.cacheFormat === undefined && back.snapshot.diskMeta === undefined, 'A18 读回的快照只摘掉 cacheFormat 与 diskMeta 两个信封键')
    check(back.snapshot.issues.length === 1 && back.snapshot.issues[0].body === '完整正文', 'A19 读回后行上的正文原样还在')
    check(back.snapshot.issues[0].comments.length === 1 && back.snapshot.issues[0].reviews.length === 1, 'A20 读回后评论与评审原样还在')
    check(JSON.stringify(back.snapshot.merge) === JSON.stringify(snap.merge), 'A21 读回后合并状态一字不动')
    check(back.snapshot.version === 7 && back.snapshot.etag === 'etag-7', 'A22 版本与 etag 从文件读回也不变')

    const legacyRaw = Object.assign({}, snap, { cacheFormat: 3 })
    const legacy = disk.readDiskSnapshot(legacyRaw)
    check(legacy.ok === true && legacy.legacy === true, 'A23 旧格式（cacheFormat 3）照读，并标 legacy')
    check(legacy.meta.source === 'legacy-unknown' && legacy.meta.completeness === 'unknown', 'A24 旧格式没有来源信息，按「来源未知 / 完整度未知」回放')
    check(legacy.meta.writtenAtMs === snap.generatedMs, 'A25 旧格式的「上次已知」时刻取文件自己的 generatedMs')
    check(legacy.snapshot.issues[0].body === '完整正文' && legacy.snapshot.issues[0].comments.length === 1, 'A26 旧格式文件里的字段一个都不删（正文与评论照旧）')
    check(legacy.snapshot.merge && legacy.snapshot.merge.version === 7, 'A27 旧格式的合并状态也原样保留')
    check(legacy.snapshot.cacheFormat === undefined && legacy.snapshot.diskMeta === undefined, 'A28 旧格式读回也只摘信封键')

    check(disk.readDiskSnapshot(null).reason === 'not-object', 'A29 负例：不是对象的文件按 not-object 拒绝')
    check(disk.readDiskSnapshot({ ok: false }).reason === 'not-ok', 'A30 负例：ok 不为真按 not-ok 拒绝')
    check(disk.readDiskSnapshot({ ok: true, maps: {}, generatedMs: 1, cacheFormat: 4 }).reason === 'maps-not-array', 'A31 负例：maps 不是数组按 maps-not-array 拒绝')
    check(disk.readDiskSnapshot({ ok: true, maps: [], generatedMs: 'x', cacheFormat: 4 }).reason === 'generatedMs-not-number', 'A32 负例：generatedMs 不是数按 generatedMs-not-number 拒绝')
    check(disk.readDiskSnapshot({ ok: true, maps: [], generatedMs: 1, cacheFormat: 2 }).reason === 'schema-unreadable', 'A33 负例：不认识的格式版本按 schema-unreadable 拒绝')

    const replayFields = disk.diskReplayFields(legacy.meta)
    check(replayFields.diskReplay.legacy === true && replayFields.diskReplay.lastKnownAtMs === snap.generatedMs, 'A34 回放视图带 legacy 与「上次已知」时刻，交给界面用')
    check(replayFields.diskReplay.source === 'legacy-unknown' && replayFields.diskReplay.schema === 3, 'A35 回放视图如实带来源与格式版本')

    const diskSrc = srcText('src/refresh/kernel/disk-snapshot-format.ts')
    check(diskSrc.indexOf('etag') < 0 && diskSrc.indexOf('snapshotVersion') < 0, 'A36 格式模块不参与内容散列/304 判定：源码里不出现 etag 与版本散列名字')
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

    const detailSrc = srcText('src/client/views/IssueDetail.ts')
    check(detailSrc.indexOf("tr('detail.evictedAt'") >= 0, 'C6 详情页对已淘汰的内容说「未取（曾在某时）」，不画成空白')
    check(detailSrc.indexOf('snapIssue.detailEvicted') >= 0 && detailSrc.indexOf('lastKnownAtMs') >= 0, 'C7 详情页判断依据是行上的淘汰记号与上次已知时刻')

    const flow = srcText('config/copy/flow.yaml')
    check(flow.indexOf('detail.evictedAt') >= 0 && flow.indexOf('未取（曾在') >= 0, 'C8 词表两个语言都有「未取（曾在 {time}）」这一条')
    const pages = srcText('config/copy/pages.yaml')
    check(pages.indexOf('truth.replayLastKnown') >= 0 && pages.indexOf('上次已知（') >= 0, 'C9 词表两个语言都有「上次已知（{time}）」这一条')
  }

  // ── D 接线与「没新增定时器」 ──
  {
    const gitSrc = srcText('src/refresh/rooms/host/git-execution.ts')
    check(gitSrc.indexOf('readDiskSnapshot(') >= 0, 'D1 读盘走 kernel 的 readDiskSnapshot，格式判据不散在宿主文件里')
    check(gitSrc.indexOf('buildDiskSnapshot(') >= 0, 'D2 写盘走 kernel 的 buildDiskSnapshot')
    check(gitSrc.split('evictDetailsInSnapshot(').length - 1 >= 2, 'D3 读与写两个拍子都调淘汰（同一份上限规则两处复用）')
    check(gitSrc.indexOf('diskReplayFields(') >= 0, 'D4 回放视图由 kernel 生成后随快照交给界面')
    check(gitSrc.indexOf('evicted: ev.stats.evicted, evictedBytes: ev.stats.evictedBytes') >= 0, 'D5 写盘把这次淘汰的条数与字节数回给调用方（供日志记）')

    const rpSrc = srcText('src/refresh/rooms/host/row-patch.ts')
    check(rpSrc.split('evictForWrite(merged.snapshot, got.rows)').length - 1 >= 2, 'D6 读事件与写事件两条写回路径都在写盘前跑淘汰')
    check(rpSrc.indexOf('fields.evicted = e.evicted') >= 0 && rpSrc.indexOf('fields.evictedBytes') >= 0, 'D7 refresh.patch 日志带淘汰条数与字节数（只在真淘汰时出现）')

    const cacheSrc = srcText('src/refresh/rooms/host/session-snapshot-cache.ts')
    check(cacheSrc.indexOf("'snapshot.cache.hit'") >= 0 && cacheSrc.indexOf('rv.schema') >= 0 && cacheSrc.indexOf('rv.legacy') >= 0, 'D8 磁盘回放命中日志带格式版本、来源、完整度、是否旧格式')

    const timerFiles = [
      'src/refresh/rooms/host/git-execution.ts',
      'src/refresh/rooms/host/row-patch.ts',
      'src/refresh/rooms/host/session-snapshot-cache.ts',
      'src/refresh/kernel/disk-snapshot-format.ts',
      'src/refresh/kernel/detail-eviction.ts',
    ]
    let timerHits = 0
    for (let i = 0; i < timerFiles.length; i++) {
      const t = srcText(timerFiles[i])
      timerHits += (t.match(/setInterval|setTimeout/g) || []).length
    }
    check(timerHits === 0, 'D9 这一票没有新增定时器：格式/淘汰/读盘/写回/回放五处都不出现 setInterval/setTimeout')
  }

  console.log('')
  console.log(failed ? '存在失败 — ' + GATE + ' 未通过' : '全部通过 — 磁盘回放来源与按需细节淘汰门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main()
