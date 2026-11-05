/**
 * tests/verify-1885-review-row-merge.ts —— 库行 → 界面行的换算只有一份，且客户端照宿主说的落位
 * （规格 #1885 评审修复：标准轴第 1 条 + 规格 D/F）
 *
 * 守什么：
 *  A 同一份库行夹具喂宿主投影（issueOfRow）与客户端变化集换算（changeRowPatch），逐字段对得上：
 *    标签 / 指派 / 父票 / 阻塞边 / 合并信息这一组字段「写不写、写什么」两边一致；unknown / 组缺席 /
 *    truncated + 空在两边都不写（规格 I6「不知道就是不知道」）。
 *  B 行的状态与类型不兜底（规格 D）：库行没状态 / 没类型时，宿主投影与客户端补丁都不写这两格，
 *    不替后端说「open」或「issue」。
 *  C 变化集的落点由宿主回包给（规格 D1 / §12）：客户端不查 parentKey 判容器归属；
 *    map / child / thin / issue 四种落点各走一遍，并验证「不知道的组」并进已有行时不会把已知值抹掉。
 *
 * 为什么这么测：这两份换算以前各写各的，漏掉了 blockedBy、把空组写成 [] / null。只断言「函数存在」
 * 抓不住下一次漂移；同一份夹具喂两边、逐字段比，才能在下一次有人只改一边时立刻红。
 * 客户端落位靠注入的 placement 而不是自己算容器——这一条用真实的合并结果断言，不读私有结构。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1885-review-row-merge.ts
 */
// 门禁归属: src/shared/snapshot-row-fields.ts
// 门禁归属: src/refresh/rooms/host/snapshot-view-projection.ts
// 门禁归属: src/refresh/rooms/client/snapshot-change-merge.ts

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { issueOfRow } from '../src/refresh/rooms/host/snapshot-view-projection.ts'
import { applySnapshotChangeSet, changeRowPatch } from '../src/refresh/rooms/client/snapshot-change-merge.ts'
import { snapshotRowFieldsOf } from '../src/shared/snapshot-row-fields.ts'

const GATE = 'verify-1885-review-row-merge'
let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function group(completeness: string | null): any {
  return completeness === null ? null : { completeness, reason: completeness === 'unknown' ? 'not-expressed' : null, source: 'gate', operation: 'read' }
}

function listRow(key: string, opts?: any): any {
  const o = opts || {}
  return {
    effortId: o.effortId === undefined ? '' : o.effortId,
    key: key,
    row: Object.assign({
      type: 'issue', title: '票 ' + key, state: 'open', url: 'https://example.test/' + key,
      createdAtMs: 1, updatedAtMs: 2, closedAtMs: null, stateReason: null,
      isPullRequest: false, commentCount: 0,
    }, o.row || {}),
    labels: o.labels || [],
    assignees: o.assignees || [],
    parents: o.parents || [],
    blockedBy: o.blockedBy || [],
    subIssues: null,
    mergedAtMs: o.mergedAtMs === undefined ? null : o.mergedAtMs,
    groups: {
      row: group('complete'),
      body: null,
      labels: o.labelsGroup === undefined ? group(null) : group(o.labelsGroup),
      assignees: o.assigneesGroup === undefined ? group(null) : group(o.assigneesGroup),
      parents: o.parentsGroup === undefined ? group(null) : group(o.parentsGroup),
      blockedBy: o.blockedByGroup === undefined ? group(null) : group(o.blockedByGroup),
      mergeInfo: o.mergeInfoGroup === undefined ? group(null) : group(o.mergeInfoGroup),
    },
    ...(o.placement ? { placement: o.placement } : null),
  }
}

function idOf(row: any): string {
  return String((row && row.effortId) || '') + '\u0000' + String((row && row.key) || '')
}

function bytes(value: unknown): string {
  return JSON.stringify(value)
}

function has(obj: any, field: string): boolean {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, field)
}

// ---------------------------------------------------------------------------
// A 同一份夹具喂两边：组字段的「写不写、写什么」逐项相等
// ---------------------------------------------------------------------------
{
  const rich = listRow('7', {
    labels: [{ name: 'ready-for-agent', color: '00ff00', description: '可以开工' }],
    assignees: [{ login: 'alice', name: 'Alice' }],
    parents: ['100'],
    blockedBy: [{ key: '90', title: '阻塞者', state: 'closed', type: 'issue' }],
    mergedAtMs: 1762000000000,
    labelsGroup: 'complete', assigneesGroup: 'complete', parentsGroup: 'complete',
    blockedByGroup: 'complete', mergeInfoGroup: 'complete',
  })
  const issue = issueOfRow(rich)
  const patch = changeRowPatch(rich, snapshotRowFieldsOf)
  check(bytes(issue.labels) === bytes(patch.labels) && patch.labels.length === 1 && patch.labels[0].color === '00ff00',
    'A1 标签：两边写出同一份（含颜色与描述）', { issue: issue.labels, patch: patch.labels })
  check(bytes(issue.assignees) === bytes(patch.assignees) && patch.assignees[0].login === 'alice',
    'A2 指派：两边写出同一份', { issue: issue.assignees, patch: patch.assignees })
  check(issue.parentKey === '100' && patch.parentKey === '100', 'A3 父票：两边都是 100')
  check(bytes(issue.blockedBy) === bytes(patch.blockedBy) && patch.blockedBy.length === 1 && patch.blockedBy[0].key === '90',
    'A4 阻塞边：客户端补丁也写 blockedBy，且与宿主投影逐字相等（标准轴第 1 条的核心缺口）', { issue: issue.blockedBy, patch: patch.blockedBy })
  check(issue.mergedAt !== null && patch.mergedAt === issue.mergedAt, 'A5 合并信息：两边写出同一个 ISO 时间')
  check(patch.state === 'OPEN' && issue.state === 'open', 'A6 状态：客户端大写、宿主小写，但都是同一个值')

  for (const [name, fixture] of [
    ['unknown', listRow('8', { labelsGroup: 'unknown', assigneesGroup: 'unknown', parentsGroup: 'unknown', blockedByGroup: 'unknown', mergeInfoGroup: 'unknown' })],
    ['组缺席', listRow('9')],
    ['truncated + 空', listRow('10', { labelsGroup: 'truncated', assigneesGroup: 'truncated', parentsGroup: 'truncated', blockedByGroup: 'truncated', mergeInfoGroup: 'unknown' })],
  ] as Array<[string, any]>) {
    const host = issueOfRow(fixture)
    const client = changeRowPatch(fixture, snapshotRowFieldsOf)
    const fields = ['labels', 'assignees', 'parentKey', 'blockedBy', 'mergedAt']
    const leaks = fields.filter((field) => has(host, field) || has(client, field))
    check(leaks.length === 0, 'A7 ' + name + '：五个关系字段两边都不写（不拿 [] / null 冒充确认没有）', { host, client, leaks })
  }

  const emptyComplete = listRow('11', {
    labelsGroup: 'complete', assigneesGroup: 'complete', parentsGroup: 'complete',
    blockedByGroup: 'complete', mergeInfoGroup: 'complete',
  })
  const hostEmpty = issueOfRow(emptyComplete)
  const clientEmpty = changeRowPatch(emptyComplete, snapshotRowFieldsOf)
  check(has(hostEmpty, 'labels') && has(clientEmpty, 'labels') && hostEmpty.labels.length === 0 && clientEmpty.labels.length === 0,
    'A8 complete + 空：两边都写空数组（确认没有）')
  check(has(hostEmpty, 'parentKey') && hostEmpty.parentKey === null && has(clientEmpty, 'parentKey') && clientEmpty.parentKey === null,
    'A9 complete + 空父票：两边都写 null（确认没有父票）')
  check(has(hostEmpty, 'blockedBy') && clientEmpty.blockedBy.length === 0, 'A10 complete + 空阻塞：两边都写空数组')
  check(has(hostEmpty, 'mergedAt') && hostEmpty.mergedAt === null && has(clientEmpty, 'mergedAt') && clientEmpty.mergedAt === null,
    'A11 complete + 未合并：两边都写 null')

  const truncatedWithValue = listRow('12', { blockedBy: [{ key: '90', title: '阻塞者' }], blockedByGroup: 'truncated' })
  const hostTrunc = issueOfRow(truncatedWithValue)
  const clientTrunc = changeRowPatch(truncatedWithValue, snapshotRowFieldsOf)
  check(bytes(hostTrunc.blockedBy) === bytes(clientTrunc.blockedBy) && clientTrunc.blockedBy.length === 1,
    'A12 truncated 但有值：两边都把已知那一条写出来')
}

// ---------------------------------------------------------------------------
// B 状态与类型不兜底（规格 D：不知道就是不知道）
// ---------------------------------------------------------------------------
{
  const noStateNoType = listRow('20', { row: { state: null, type: null } })
  const host = issueOfRow(noStateNoType)
  const client = changeRowPatch(noStateNoType, snapshotRowFieldsOf)
  check(!has(host, 'state'), 'B1 库行没有状态：宿主投影不写 state（不兜成 open）', host)
  check(!has(client, 'state'), 'B2 库行没有状态：客户端补丁也不写 state', client)
  check(!has(host, 'type'), 'B3 库行没有类型：宿主投影不写 type（不兜成 issue）', host)
  check(!has(client, 'type'), 'B4 库行没有类型：客户端补丁也不写 type', client)

  const capitalized = listRow('21', { row: { state: 'CLOSED' } })
  check(issueOfRow(capitalized).state === 'closed' && changeRowPatch(capitalized, snapshotRowFieldsOf).state === 'CLOSED',
    'B5 大小写两种写法都认；两边一个写小写、一个写大写（界面口径）')
  const spec = listRow('22', { row: { type: 'spec' } })
  check(issueOfRow(spec).type === 'spec' && changeRowPatch(spec, snapshotRowFieldsOf).type === 'spec',
    'B6 类型是 spec 时两边照写，不被默认值吞掉')
  check(!has(changeRowPatch(listRow('23'), snapshotRowFieldsOf), 'body'), 'B7 客户端补丁不写正文（正文属于详情，列表行没有）')
}

// ---------------------------------------------------------------------------
// C 落点由宿主回包给；客户端只照单落位（规格 D1 / §12）
// ---------------------------------------------------------------------------
{
  const map = { key: '100', effortId: '', type: 'map', title: '地图 100', state: 'OPEN', tickets: [{ key: '1', effortId: '', title: '旧子票' }], stats: { total: 1 } }
  const before = { ok: true, maps: [map], issues: [{ key: '2', effortId: '', title: '旧未挂图票' }], thinTickets: [] }

  const mapRow = listRow('100', { row: { type: 'map', title: '地图 100（改过）' }, placement: { place: 'map' } })
  const childRow = listRow('3', { row: { title: '三' }, placement: { place: 'child', containerEffortId: '', containerKey: '100' } })
  const thinRow = listRow('4', { row: { state: 'closed' }, placement: { place: 'thin', containerEffortId: '', containerKey: '100' } })
  const issueRow = listRow('5', { placement: { place: 'issue' } })
  const merged: any = applySnapshotChangeSet(before, [mapRow, childRow, thinRow, issueRow], [], { idOf: idOf, rowFieldsOf: snapshotRowFieldsOf })
  check(!!merged, 'C1 合并成功（有基线、有行换算）')
  const after = merged.snapshot
  check(after.maps[0].title === '地图 100（改过）' && after.maps[0].tickets.length === 2 && after.maps[0].stats && after.maps[0].stats.total === 1,
    'C2 map 落点：只换容器头，tickets 与 stats 这些客户端派生格保留', after.maps[0])
  check(after.maps[0].tickets[1].key === '3' && after.maps[0].tickets[1].title === '三',
    'C3 child 落点：新子票挂到宿主点名的容器里', after.maps[0].tickets)
  check(after.thinTickets.length === 1 && after.thinTickets[0].key === '4' && after.thinTickets[0].state === 'CLOSED',
    'C4 thin 落点：已关闭容器里的已关闭子票只进瘦身行', after.thinTickets)
  check(after.issues.some((row: any) => row.key === '5'), 'C5 issue 落点：未挂图票进 issues')
  check(after.maps[0].tickets.some((row: any) => row.key === '4') === false, 'C6 thin 行没有同时留在容器子票里')
  check(merged.redrawn.indexOf(idOf({ effortId: '', key: '3' })) >= 0 && merged.redrawn.indexOf(idOf({ effortId: '', key: '4' })) >= 0,
    'C7 新加进来的行都进重画名单', merged.redrawn)
}

// ---------------------------------------------------------------------------
// C8 不知道的组并进已有行时，不抹掉已知值
// ---------------------------------------------------------------------------
{
  const before = {
    ok: true, maps: [], thinTickets: [],
    issues: [{
      key: '30', effortId: '', title: '旧标题', state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }], assignees: [{ login: 'alice' }],
      parentKey: '100', blockedBy: [{ key: '90', title: '阻塞者' }], mergedAt: null,
    }],
  }
  const changed = listRow('30', { labelsGroup: 'unknown', assigneesGroup: 'unknown', parentsGroup: 'unknown', blockedByGroup: 'unknown', mergeInfoGroup: 'unknown' })
  const merged: any = applySnapshotChangeSet(before, [changed], [], { idOf: idOf, rowFieldsOf: snapshotRowFieldsOf })
  const row = merged.snapshot.issues[0]
  check(row.labels.length === 1 && row.labels[0].name === 'ready-for-agent', 'C8 unknown 标签不覆盖已知标签', row.labels)
  check(row.assignees.length === 1 && row.assignees[0].login === 'alice', 'C9 unknown 指派不覆盖已知指派', row.assignees)
  check(row.parentKey === '100', 'C10 unknown 父票不覆盖已知父票', row.parentKey)
  check(row.blockedBy.length === 1 && row.blockedBy[0].key === '90', 'C11 unknown 阻塞不覆盖已知阻塞', row.blockedBy)
  check(row.mergedAt === null && has(row, 'mergedAt'), 'C12 unknown 合并信息不覆盖已知的 null', row.mergedAt)
}

// ---------------------------------------------------------------------------
// C13 墓碑与容器删除照单执行
// ---------------------------------------------------------------------------
{
  const before = {
    ok: true,
    maps: [{ key: '100', effortId: '', type: 'map', title: '地图', state: 'OPEN', tickets: [{ key: '1', effortId: '', title: '子票' }] }],
    issues: [{ key: '2', effortId: '', title: '未挂图票' }],
    thinTickets: [{ key: '3', effortId: '', title: '瘦身' }],
  }
  const merged: any = applySnapshotChangeSet(before, [], [
    { effortId: '', key: '1', deletedAtMs: 10 },
    { effortId: '', key: '2', deletedAtMs: 10 },
    { effortId: '', key: '3', deletedAtMs: 10 },
    { effortId: '', key: '100', deletedAtMs: 10 },
  ], { idOf: idOf, rowFieldsOf: snapshotRowFieldsOf })
  check(merged.snapshot.maps.length === 0, 'C13 容器被判不存在：整项拿掉', merged.snapshot.maps)
  check(merged.snapshot.issues.length === 0 && merged.snapshot.thinTickets.length === 0,
    'C14 容器子票、未挂图票、瘦身行都被拿掉', merged.snapshot)
  check(merged.removed.length === 4, 'C15 四张票都进删除名单（界面据此拿掉）', merged.removed)
}

// ---------------------------------------------------------------------------
// C16 静态判据：客户端不再按 parentKey 自己判容器归属
// ---------------------------------------------------------------------------
{
  const source = readFileSync(path.join(process.cwd(), 'src/refresh/rooms/client/snapshot-change-merge.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  check(source.indexOf('changePlacementOf(item)') >= 0, 'C16 客户端从 item.placement 取落点（宿主回包带来）')
  check(!/patch\.parentKey\s*\)/.test(source) && !/mapIndexOf\([^\n]*patch\.parentKey/.test(source),
    'C17 客户端不再拿 patch.parentKey 去查容器（领域规则不在客户端重算）')
}

console.log('')
if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
else console.log('OK：' + total + ' 条断言全部通过')
printGateResult(GATE, total, failed)
process.exit(failed ? 1 : 0)
