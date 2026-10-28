/**
 * tests/verify-1604-pure-map-routing.ts —— #1604（列表条件分流：纯地图筛走薄查，要正文走老路）门禁。
 *
 * 为什么要有这一条：deck_issue_list 今天不分条件，一律走全量 list 再内存过滤。
 * 大仓下纯地图筛也被迫拉全仓正文。#1602 要求按要不要正文分流：只筛地图标签的
 * 列表走 listMaps 薄查快速回；带文本搜、认规格、要看正文的一律走老全量路径。
 *
 * 做法：行为断言 —— 只断言分流条件判定与薄行映射的外部行为，不碰后端实现。
 * 一、纯地图筛（标签只有地图标签、type 是 map 或 all、无文本搜、无指派、无目录限定、
 *     type 不是 spec/issue）走薄查；
 * 二、带正文搜（query）、认规格（type=spec）、要看正文（assignee/目录限定/掺杂其它标签、
 *     type=issue）一律走老路；
 * 三、大小写标签行为一致（内存归一到小写再判），不静默漏（薄查 unsupported 才回落，
 *     超时与传输失败不拿半份当整仓）。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-1604-pure-map-routing.ts（在插件根目录）
 */
import { shouldUseThinMapList, thinMapRowsToIssues } from '../src/deck/tools/issue-list.ts'

let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('#1604 门禁（列表条件分流：纯地图筛走薄查，要正文走老路）')

// 薄查只看的输入形状：type 已收口为小写四档之一；labels 保持原样（本函数内归一）；
// assignee/query 已 trim+小写（空串=没筛）；effortId 是 scope 收口后的目录名（空串=不限）。
function thin(input: Partial<Parameters<typeof shouldUseThinMapList>[0]>): boolean {
  return shouldUseThinMapList({
    type: 'all',
    labels: [],
    assignee: '',
    query: '',
    effortId: '',
    ...input,
  })
}

// ── 一、纯地图筛走薄查：只有地图行 ──
{
  check(thin({ labels: ['wayfinder:map'] }) === true, '纯地图标签筛（type 缺省 all）走薄查')
  check(thin({ type: 'map', labels: ['wayfinder:map'] }) === true, 'type=map 加地图标签走薄查')
  check(thin({ type: 'all', labels: ['wayfinder:map'], }) === true, 'type=all 加地图标签走薄查')
  check(thin({ type: 'map', labels: ['wayfinder:map', 'wayfinder:map'] }) === true, '重复地图标签仍走薄查（AND 同一标签）')
  // 薄行映射：只有地图行，标签写死小写
  const rows = thinMapRowsToIssues([
    { key: '1', title: 'A', state: 'open', url: 'u1' },
    { key: '2', title: 'B', state: 'closed', url: 'u2' },
  ], { state: 'all' })
  check(rows.length === 2, '薄行映射保留两行（不丢行）')
  check(rows.every((r: any) => r.type === 'map'), '薄行映射 type 全是 map')
  check(rows.every((r: any) => Array.isArray(r.labels) && r.labels.length === 1 && r.labels[0] === 'wayfinder:map'), '薄行映射 labels 写死小写单个地图标签')
}

// ── 二、带正文搜和规格识别仍走老路，结果不缺 ──
{
  check(thin({ labels: ['wayfinder:map'], query: 'keyword' }) === false, '带文本搜（query）走老路（要读正文）')
  check(thin({ type: 'spec', labels: ['wayfinder:map'] }) === false, '认规格（type=spec）走老路（要读票面标记）')
  check(thin({ type: 'spec', labels: [] }) === false, 'type=spec 无标签也走老路')
  check(thin({ type: 'issue', labels: ['wayfinder:map'] }) === false, 'type=issue 走老路（薄行全是地图）')
  check(thin({ labels: ['wayfinder:map'], assignee: 'octocat' }) === false, '带指派筛走老路（薄行没认领格）')
  check(thin({ labels: ['wayfinder:map'], effortId: 'buy-coffee' }) === false, '带目录限定走老路（薄行没这格）')
  check(thin({ labels: ['wayfinder:map', 'bug'] }) === false, '掺了别的标签走老路（薄行没那格对不上）')
  check(thin({ labels: [] }) === false, '无标签筛走老路（不是纯地图筛）')
  check(thin({ type: 'map', labels: [] }) === false, 'type=map 但无标签仍走老路（只认标签筛，不按 type 名分流）')
  check(thin({ labels: ['bug'] }) === false, '只要普通标签走老路')
}

// ── 三、大小写标签行为一致，不静默漏 ──
{
  check(thin({ labels: ['WAYFINDER:MAP'] }) === true, '大写地图标签同样走薄查（归一到小写）')
  check(thin({ labels: ['Wayfinder:Map'] }) === true, '驼峰大小写同样走薄查')
  check(thin({ labels: ['  wayfinder:MAP  '] }) === true, '首尾空格加大小写同样走薄查')
  check(thin({ labels: ['WAYFINDER:MAP', 'wayfinder:map'] }) === true, '大小写混写重复标签仍走薄查')
  check(thin({ labels: ['WAYFINDER:MAP', 'BUG'] }) === false, '大写掺杂其它标签仍走老路（不静默丢过滤条件）')
  // 薄行映射的状态过滤与老路同口径：state=open 只留开着的，all 全留
  const mixed = thinMapRowsToIssues([
    { key: '1', title: 'A', state: 'open', url: 'u1' },
    { key: '2', title: 'B', state: 'closed', url: 'u2' },
  ], { state: 'open' })
  check(mixed.length === 1 && (mixed[0] as any).key === '1', '薄行映射按 state=open 过滤（只留开着的）')
  const all = thinMapRowsToIssues([
    { key: '1', title: 'A', state: 'open', url: 'u1' },
    { key: '2', title: 'B', state: 'closed', url: 'u2' },
  ], { state: 'all' })
  check(all.length === 2, '薄行映射 state=all 全留（开着关了都在）')
}

console.log('共 ' + total + ' 条，' + (failed ? '有失败' : '全过'))
if (failed) process.exit(1)
