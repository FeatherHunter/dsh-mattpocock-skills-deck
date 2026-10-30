// tests/verify-read-result-provenance.ts —— 门禁：每条读操作都要交出来源与按字段组完整度（票 #1685）
//
// 为什么要有这一扇（规格 1681 第 9 节、票 #1685 的「做完」第 4 条）：
//   读结果以前只有数据本身。调用方看不出这一次走的是 GraphQL 主路还是 REST 降级，
//   也看不出「行拿到了、评论没拉」这种按字段组割裂的状态。这次给读结果加了六样东西：
//   实际来源渠道、按字段组完整度、缺失字段组、耗时、取数开始版本、降级来源。
//   光有类型不够 —— 类型只能逼「字段存在」，逼不了「值是真的」：来源可以是编的，
//   完整度可以是拍的，恰好翻到整数页也可以谎报 complete。所以这一扇门禁做四件事：
//   A. 名录对账：从操作百科枚举读操作，逐条核对渠道计划、声明字段组与来源接线登记；
//      接线登记里写 wired 的必须有真实生产文件，生产文件必须真在组装来源。
//   B. 组装函数正常样例：buildReadProvenance 对合法输入给出正确的汇总与缺失清单。
//   C. 负例：来源不在计划、缺声明字段组、截断了却标 complete、开始版本坏、耗时为负、
//      降级来源与来源相同、缺失清单顺序错、operation 不一致、未知来源、未知字段组、
//      完整度取值是魔法值、mixed 用在单渠道操作上 —— 十二种都必须判红。
//   D. 接缝：stub 掉 gh 执行器喂假回包，真调 listIssues / getIssue / listIssuesPage，
//      断言结果里的来源六要素与实际调用序列；同时断言旧的 fallback / truncated 字段没被改掉。
//      这里也把「触上限」的两条情况钉住：REST 整仓列表恰好翻满 10 页且每页满 100 行时
//      必须记 truncated（没有空页探测就不算完整），GraphQL 单票依赖到 50 条时记 truncated。
//
// 门禁归属: src/tracker/contract/read-provenance.ts
// 门禁归属: src/tracker/contract/results.ts
// 门禁归属: src/tracker/contract/operations-encyclopedia.ts
// 门禁归属: src/tracker/contract/pagination.ts
// 门禁归属: src/tracker/rooms/github/routing/read-result.ts
// 门禁归属: src/tracker/rooms/github/routing/read-assembly.ts
// 门禁归属: src/tracker/rooms/github/channels/graphql/read-shapes.ts
// 门禁归属: src/tracker/rooms/github/channels/graphql/queries.ts
// 门禁归属: src/tracker/rooms/github/channels/rest/read-shapes.ts
// 门禁归属: src/tracker/rooms/github/read/issues.ts
// 门禁归属: src/tracker/rooms/github/room/backend.ts
// 门禁归属: src/tracker/rooms/github/read/issues-rest-list.ts
// 门禁归属: src/tracker/rooms/github/read/page.ts
// 门禁归属: src/tracker/rooms/github/read/preflight.ts
// 门禁归属: src/tracker/rooms/github/read/counts.ts
// 门禁归属: src/tracker/rooms/github/read/deps-read.ts
// 门禁归属: src/tracker/rooms/github/read/labels.ts
// 门禁归属: src/tracker/rooms/github/read/repo-permissions.ts
// 门禁归属: src/tracker/rooms/github/read/sub-issues.ts
// 门禁归属: src/tracker/rooms/github/read/maps.ts
//
// 跑法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-read-result-provenance.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printGateResult } from './lib/gate-result.ts'
import {
  FIELD_GROUPS,
  OPERATION_ENCYCLOPEDIA,
  READ_CHANNELS,
} from '../src/tracker/contract/operations-encyclopedia.js'
import { FIELD_GROUP_COMPLETENESS, READ_RESULT_COMPLETENESS } from '../src/tracker/contract/read-provenance.js'
import { PAGINATION } from '../src/tracker/contract/pagination.js'
import {
  ROW_LABELS_MAX,
  graphqlCommentsCompleteness,
  graphqlDependenciesCompleteness,
  graphqlLabelListCompleteness,
  graphqlLabelsCompleteness,
  graphqlRowsCompleteness,
  graphqlSubIssuesCompleteness,
} from '../src/tracker/rooms/github/channels/graphql/read-shapes.js'
import {
  restLabelListCompleteness,
  restListCompleteness,
  restRowLabelsCompleteness,
  restSingleRowFieldGroups,
  restSubIssuesCompleteness,
} from '../src/tracker/rooms/github/channels/rest/read-shapes.js'
import {
  GITHUB_READ_SOURCES,
  READ_CHANNEL_PLAN,
  READ_PROVENANCE_STATUS,
  beginRead,
  buildReadProvenance,
  readFieldGroupsOf,
  readOperationNames,
  readProvenanceProblems,
  readSourceOfVia,
} from '../src/tracker/rooms/github/routing/read-result.js'
import { createOutboundControl } from '../src/refresh/rooms/host/outbound-control.js'
import { getIssue, listIssues } from '../src/tracker/rooms/github/read/issues.js'
import { listIssuesPage } from '../src/tracker/rooms/github/read/page.js'
import { createGithubBackend } from '../src/tracker/rooms/github/room/backend.js'
import {
  GET_QUERY,
  LIST_PAGE_QUERY,
  LIST_QUERY,
  LIST_PR_QUERY,
} from '../src/tracker/rooms/github/channels/graphql/queries.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const GATE = 'verify-read-result-provenance'

let total = 0
let failed = 0

function check(ok: any, message: string, got?: any): void {
  total += 1
  if (ok) {
    console.log('  PASS ' + message)
    return
  }
  failed += 1
  console.log('  FAIL ' + message + (got === undefined ? '' : '（实得 ' + JSON.stringify(got) + '）'))
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

// 递归列出某个目录下的 .ts 文件（相对仓库根、正斜杠）；静态检查用。
function listTsFiles(relDir: string): string[] {
  const out: string[] = []
  const walk = function (rel: string): void {
    const entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })
    for (const entry of entries) {
      const child = rel + '/' + entry.name
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.ts')) out.push(child)
    }
  }
  walk(relDir)
  return out.sort()
}

// 从源码里抽 import 的说明符，静态检查「渠道互不引用」时只看导入、不看散文注释。
function importSpecifiersOf(text: string): string[] {
  const matches = text.match(/from\s+'[^']+'/g) || []
  return matches.map(function (s: string): string {
    return s.replace(/^from\s+'/, '').replace(/'$/, '')
  })
}

// 旧路径在 #1687 末批已经删掉：这里直接断言这些文件不再存在，防止有人把转发器加回来。
function oldPathRemoved(rel: string): boolean {
  return !fs.existsSync(path.join(ROOT, rel))
}

// =============================================================================================
// A. 名录对账：从操作百科枚举读操作，逐条核对渠道计划、声明字段组与来源接线登记
// =============================================================================================
console.log('#1685 A. 读操作名录、渠道计划与来源接线登记')

const READ_OPS = readOperationNames()
const encyclopediaReadOps = (Object.keys(OPERATION_ENCYCLOPEDIA) as any[]).filter(function (name: any): boolean {
  return OPERATION_ENCYCLOPEDIA[name as any].kind === 'read'
})
check(READ_OPS.length === 12, '操作百科能枚举出 12 条读操作', READ_OPS.length)
check(
  READ_OPS.join(',') === encyclopediaReadOps.join(','),
  '读操作名单与操作百科里 kind=read 的键完全一致（顺序也一致）',
  READ_OPS.join(','),
)
check(READ_CHANNELS.join(',') === 'graphql,rest,either,local', '读渠道词表仍是 graphql/rest/either/local', READ_CHANNELS.join(','))

// 门禁自己按规格换算一遍渠道计划，不抄生产代码的实现：要么与生产逐条对上，要么判红。
function expectedPlanOf(channels: string): string[] {
  if (channels === 'either') return ['graphql', 'rest']
  if (channels === 'graphql') return ['graphql']
  if (channels === 'rest') return ['rest']
  return ['local']
}

for (const op of READ_OPS) {
  const profile: any = (OPERATION_ENCYCLOPEDIA as any)[op]
  check(profile.kind === 'read', '读操作 ' + op + '：操作百科里标成读')
  const expectedPlan = expectedPlanOf(profile.channels)
  const actualPlan = READ_CHANNEL_PLAN[op as any]
  check(
    actualPlan.join(',') === expectedPlan.join(','),
    '读操作 ' + op + '：渠道计划由操作百科的 channels 派生',
    actualPlan,
  )
  const expectedGroups = profile.fieldGroups
  check(
    readFieldGroupsOf(op as any).join(',') === expectedGroups.join(','),
    '读操作 ' + op + '：声明字段组与操作百科一致',
    readFieldGroupsOf(op as any),
  )
  const wiring: any = (READ_PROVENANCE_STATUS as any)[op]
  check(Boolean(wiring), '读操作 ' + op + '：来源接线登记存在')
  if (wiring) {
    check(
      wiring.status === 'wired' || wiring.status === 'whitelisted',
      '读操作 ' + op + '：接线状态只有 wired / whitelisted 两种',
      wiring.status,
    )
    if (wiring.status === 'wired') {
      check(typeof wiring.producer === 'string' && wiring.producer.length > 0, '读操作 ' + op + '：wired 登记了生产文件')
    } else {
      check(
        typeof wiring.ticket === 'string' && wiring.ticket.length > 0 && typeof wiring.reason === 'string' && wiring.reason.length > 0,
        '读操作 ' + op + '：whitelisted 带票号与理由',
        { ticket: wiring.ticket, reason: wiring.reason },
      )
    }
  }
}

const WIRED_OPS = READ_OPS.filter(function (op: any): boolean {
  return (READ_PROVENANCE_STATUS as any)[op].status === 'wired'
}).sort()
const WHITELISTED_OPS = READ_OPS.filter(function (op: any): boolean {
  return (READ_PROVENANCE_STATUS as any)[op].status === 'whitelisted'
}).sort()
check(
  WIRED_OPS.join(',') === 'counts,get,getCurrentUser,getDependencies,getRepoPermissions,list,listLabels,listMaps,listPage,listSubIssues,preflight,readBudget',
  '#1685 接三条、#1686 再清七条、#1687 收口清最后两条，十二条读操作全部接成 wired',
  WIRED_OPS,
)
check(WHITELISTED_OPS.length === 0, '#1687 房间入口收口后白名单清零（不再有等后续票接的读操作）', WHITELISTED_OPS.length)

const ticketCounts: any = {}
for (const op of WHITELISTED_OPS) {
  const ticket = String((READ_PROVENANCE_STATUS as any)[op].ticket || '')
  ticketCounts[ticket] = (ticketCounts[ticket] || 0) + 1
}
check(ticketCounts['#1686'] === undefined && ticketCounts['#1687'] === undefined, '白名单里不再挂 #1686 / #1687 的名字', ticketCounts)

// wired 的生产文件不是嘴上说说：文件存在、真的开了取数时钟、真的在结果上挂 provenance。
const WIRED_PRODUCER_FACTS: any = {
  counts: { file: 'src/tracker/rooms/github/read/counts.ts', markers: ['beginRead(', 'provenance:', 'countsProvenance'] },
  get: { file: 'src/tracker/rooms/github/read/issues.ts', markers: ['beginRead(', 'provenance:', 'detailProvenanceFrom'] },
  getCurrentUser: { file: 'src/tracker/rooms/github/room/backend.ts', markers: ['beginRead(', 'provenance:', 'currentUserProvenance'] },
  getDependencies: { file: 'src/tracker/rooms/github/read/deps-read.ts', markers: ['beginRead(', 'provenance:', 'dependenciesProvenanceFrom'] },
  getRepoPermissions: { file: 'src/tracker/rooms/github/read/repo-permissions.ts', markers: ['beginRead(', 'provenance:', 'permissionsProvenance'] },
  list: { file: 'src/tracker/rooms/github/read/issues.ts', markers: ['beginRead(', 'provenance:', 'listProvenanceFrom'] },
  listLabels: { file: 'src/tracker/rooms/github/read/labels.ts', markers: ['beginRead(', 'provenance:', 'labelsProvenanceFromRest'] },
  listMaps: { file: 'src/tracker/rooms/github/read/maps.ts', markers: ['beginRead(', 'provenance:', 'mapsProvenanceFromGraphql'] },
  listPage: { file: 'src/tracker/rooms/github/read/page.ts', markers: ['beginRead(', 'provenance:', 'pageProvenanceFromGraphql'] },
  listSubIssues: { file: 'src/tracker/rooms/github/read/sub-issues.ts', markers: ['beginRead(', 'provenance:', 'subIssuesProvenanceFromGraphql'] },
  preflight: { file: 'src/tracker/rooms/github/read/preflight.ts', markers: ['beginRead(', 'provenance:', 'preflightProvenance'] },
  readBudget: { file: 'src/tracker/rooms/github/room/backend.ts', markers: ['beginRead(', 'provenance:', 'readBudgetProvenance'] },
}
for (const op of WIRED_OPS) {
  const facts = WIRED_PRODUCER_FACTS[op]
  const wiring: any = (READ_PROVENANCE_STATUS as any)[op]
  check(wiring.producer === facts.file, '读操作 ' + op + '：wired 的生产文件登记为 ' + facts.file, wiring.producer)
  const text = readSource(facts.file)
  const missingMarkers = facts.markers.filter(function (marker: string): boolean { return !text.includes(marker) })
  check(missingMarkers.length === 0, '读操作 ' + op + '：生产文件真在开时钟、挂来源、调用组装函数', missingMarkers)
}
check(
  readSource('src/tracker/rooms/github/routing/read-assembly.ts').includes('buildReadProvenance('),
  '组装文件确实调用 buildReadProvenance（wired 的来源不是手写对象）',
)

// 契约形状：六样信息一样都不能少，且缺字段组是按组列的数组而不是一个总体布尔。
const contractSrc = readSource('src/tracker/contract/read-provenance.ts')
const CONTRACT_MARKERS: any[] = [
  ['实际来源渠道', 'readonly source: ReadResultSource'],
  ['汇总完整度三态', 'readonly completeness: ReadCompleteness'],
  ['按字段组完整度', 'readonly fieldGroups: Readonly<Partial<Record<FieldGroup, FieldGroupCompleteness>>>'],
  ['缺失字段组', 'readonly missingFieldGroups: readonly FieldGroup[]'],
  ['耗时', 'readonly durationMs: number'],
  ['取数开始版本', 'readonly startVersion: string'],
  ['降级来源', 'readonly degradedFrom?: ReadResultSource'],
]
for (const pair of CONTRACT_MARKERS) {
  check(contractSrc.includes(pair[1]), '读结果契约带' + pair[0], pair[1])
}
check(FIELD_GROUP_COMPLETENESS.join(',') === 'complete,truncated,unexpressed', '字段组完整度词表只有三态', FIELD_GROUP_COMPLETENESS.join(','))
check(READ_RESULT_COMPLETENESS.join(',') === 'complete,truncated,partial', '汇总完整度词表只有三态', READ_RESULT_COMPLETENESS.join(','))

const resultsSrc = readSource('src/tracker/contract/results.ts')
const provenanceTyped = resultsSrc.split('provenance?: ReadProvenance').length - 1
check(
  provenanceTyped === 12,
  '十二种读结果（列表、单票、分页、预检、依赖、标签清单、计数、仓库权限、子票、地图、当前用户、读预算）都带 provenance（类型强制）',
  provenanceTyped,
)

// 渠道互不引用：GraphQL 通道不认 REST 形状，REST 通道不认 GraphQL 形状；
// 两条通道都只能往下引契约，不许引路由 / 读 / 写 / 房间入口。
const GRAPHQL_FILES = listTsFiles('src/tracker/rooms/github/channels/graphql')
const REST_FILES = listTsFiles('src/tracker/rooms/github/channels/rest')
check(GRAPHQL_FILES.length >= 2 && REST_FILES.length >= 2, '两条通道目录都已落文件', { graphql: GRAPHQL_FILES.length, rest: REST_FILES.length })

const graphqlSpecs = GRAPHQL_FILES.flatMap(function (f: string): string[] { return importSpecifiersOf(readSource(f)) })
const restSpecs = REST_FILES.flatMap(function (f: string): string[] { return importSpecifiersOf(readSource(f)) })
const graphqlLeaks = graphqlSpecs.filter(function (spec: string): boolean {
  return spec.includes('channels/rest') || spec.includes('/routing/') || spec.includes('/read/') || spec.includes('/write/') || spec.includes('/room/')
})
const restLeaks = restSpecs.filter(function (spec: string): boolean {
  return spec.includes('channels/graphql') || spec.includes('/routing/') || spec.includes('/read/') || spec.includes('/write/') || spec.includes('/room/')
})
check(graphqlLeaks.length === 0, 'GraphQL 通道不引用 REST 形状，也不引用路由/读/写/房间入口', graphqlLeaks)
check(restLeaks.length === 0, 'REST 通道不引用 GraphQL 形状，也不引用路由/读/写/房间入口', restLeaks)

// 旧平铺路径在 #1687 末批已删除，新代码一律从九目录里的新路径导入。
check(oldPathRemoved('src/tracker/rooms/github/queries.ts'), '旧路径 queries.ts 已删除（真身在内 channels/graphql/queries.ts）')
check(oldPathRemoved('src/tracker/rooms/github/rest-list-metadata.ts'), '旧路径 rest-list-metadata.ts 已删除（真身在 channels/rest/list-row-metadata.ts）')

// 端点上限只从契约数字表取，不许在通道里另写一份。
const graphqlShapesSrc = readSource('src/tracker/rooms/github/channels/graphql/read-shapes.ts')
const restShapesSrc = readSource('src/tracker/rooms/github/channels/rest/read-shapes.ts')
check(graphqlShapesSrc.includes('depsMax') && graphqlShapesSrc.includes('labelListLimit'), 'GraphQL 通道的依赖与标签上限取自契约数字表')
check(restShapesSrc.includes('subIssuesMax') && restShapesSrc.includes('labelListLimit'), 'REST 通道的子票与标签上限取自契约数字表')
const restFetchSrc = readSource('src/tracker/rooms/github/read/issues-rest-list.ts')
check(restFetchSrc.includes('restPageSize') && restFetchSrc.includes('restMaxPages'), 'REST 整仓列表的每页条数与页数上限取自契约数字表')
check(ROW_LABELS_MAX === PAGINATION.github.depsMax, '单行标签上限 50 与依赖上限同源（都是连接一次最多给的条数）', ROW_LABELS_MAX)
check(PAGINATION.github.restPageSize === 100 && PAGINATION.github.restMaxPages === 10, 'REST 每页 100、最多 10 页', PAGINATION.github)
check(PAGINATION.github.subIssuesPageSize === 100 && PAGINATION.github.subIssuesMax === 1000, '子票每页 100、最多 1000', PAGINATION.github)
check(PAGINATION.github.labelListLimit === 1000, '标签清单上限 1000', PAGINATION.github.labelListLimit)

// =============================================================================================
// B. 组装函数正常样例：合法输入给出正确的汇总与缺失清单
// =============================================================================================
console.log('#1685 B. buildReadProvenance 正常样例')

const SAMPLE_VERSION = beginRead(1700000000000).startVersion
check(/^read-v1-1700000000000-\d{6}$/.test(SAMPLE_VERSION), 'beginRead 的开始版本形如 read-v1-<毫秒>-<六位序号>', SAMPLE_VERSION)

const listCompleteProv = buildReadProvenance('list', {
  source: 'graphql',
  fieldGroups: { row: 'complete', labels: 'complete' },
  durationMs: 12,
  startVersion: SAMPLE_VERSION,
})
check(listCompleteProv.completeness === 'complete', '声明的字段组全取全时汇总是 complete', listCompleteProv.completeness)
check(listCompleteProv.missingFieldGroups.length === 0, '全取全时缺失字段组为空', listCompleteProv.missingFieldGroups)
check(listCompleteProv.fieldGroups.row === 'complete' && listCompleteProv.fieldGroups.labels === 'complete', '按组完整度原样保留')

const getPartialProv = buildReadProvenance('get', {
  source: 'graphql',
  fieldGroups: { row: 'complete', body: 'complete', comments: 'complete', dependencies: 'unexpressed' },
  durationMs: 30,
  startVersion: SAMPLE_VERSION,
})
check(getPartialProv.completeness === 'partial', '没有截断但有一组未表达时汇总是 partial', getPartialProv.completeness)
check(getPartialProv.missingFieldGroups.join(',') === 'dependencies', '缺失字段组按契约顺序列出', getPartialProv.missingFieldGroups)

const getTruncatedProv = buildReadProvenance('get', {
  source: 'graphql',
  fieldGroups: { row: 'complete', body: 'complete', comments: 'truncated', dependencies: 'unexpressed' },
  durationMs: 30,
  startVersion: SAMPLE_VERSION,
})
check(getTruncatedProv.completeness === 'truncated', '有一组截断时汇总是 truncated（截断压过未表达）', getTruncatedProv.completeness)
check(getTruncatedProv.missingFieldGroups.join(',') === 'comments,dependencies', '缺失清单按 FIELD_GROUPS 顺序排（comments 在 dependencies 前）', getTruncatedProv.missingFieldGroups)

const restDegradedProv = buildReadProvenance('list', {
  source: 'rest',
  degradedFrom: 'graphql',
  fieldGroups: { row: 'complete', labels: 'complete' },
  durationMs: 44,
  startVersion: SAMPLE_VERSION,
})
check(restDegradedProv.completeness === 'complete', '走备路但把声明的组取全了仍是 complete（降级不改变完整度）', restDegradedProv.completeness)
check(restDegradedProv.degradedFrom === 'graphql', '降级来源单独记在 degradedFrom', restDegradedProv.degradedFrom)

let buildThrew = ''
try {
  // listMaps 的渠道计划只有 graphql 一条（channels=graphql）；给它塞 REST 来源必须当场抛错。
  buildReadProvenance('listMaps', {
    source: 'rest',
    fieldGroups: { row: 'complete', labels: 'complete' },
    durationMs: 1,
    startVersion: SAMPLE_VERSION,
  })
} catch (e: any) {
  buildThrew = String((e && e.message) || e)
}
check(buildThrew.includes('read provenance 不合法（listMaps）'), '非法来源会让 buildReadProvenance 直接抛错（不静默降级）', buildThrew)

// =============================================================================================
// C. 负例：十二种坏来源都必须判红
// =============================================================================================
console.log('#1685 C. 负例：坏来源信息必须判红')

function baseProvenance(operation: any, extra: any): any {
  const base: any = {
    operation: operation,
    source: 'graphql',
    completeness: 'complete',
    fieldGroups: { row: 'complete' },
    missingFieldGroups: [],
    durationMs: 5,
    startVersion: SAMPLE_VERSION,
  }
  return Object.assign(base, extra || {})
}
function expectProblem(tag: string, operation: any, provenance: any, fragment: string): void {
  const problems = readProvenanceProblems(operation, provenance)
  check(
    problems.length > 0 && problems.join('；').includes(fragment),
    tag,
    problems,
  )
}

expectProblem(
  'C1 来源不在渠道计划里判红',
  'listMaps',
  baseProvenance('listMaps', { source: 'rest', fieldGroups: { row: 'complete', labels: 'complete' } }),
  '渠道计划',
)
expectProblem(
  'C2 缺声明字段组判红',
  'get',
  baseProvenance('get', { fieldGroups: { row: 'complete' }, completeness: 'complete' }),
  '缺声明字段组',
)
expectProblem(
  'C3 截断了却标 complete 判红',
  'list',
  baseProvenance('list', { fieldGroups: { row: 'truncated', labels: 'truncated' }, completeness: 'complete' }),
  '总体完整度',
)
expectProblem('C4 开始版本不合形判红', 'list', baseProvenance('list', { startVersion: 'v1' }), 'startVersion')
expectProblem('C5 耗时为负判红', 'list', baseProvenance('list', { durationMs: -3 }), 'durationMs')
expectProblem('C6 降级来源与来源相同判红', 'list', baseProvenance('list', { source: 'graphql', degradedFrom: 'graphql' }), '降级来源不能')
expectProblem(
  'C7 缺失清单顺序不对判红',
  'get',
  baseProvenance('get', {
    fieldGroups: { row: 'complete', body: 'complete', comments: 'unexpressed', dependencies: 'unexpressed' },
    completeness: 'partial',
    missingFieldGroups: ['dependencies', 'comments'],
  }),
  'missingFieldGroups',
)
expectProblem('C8 operation 与校验入参不一致判红', 'get', baseProvenance('list'), 'operation')
expectProblem('C9 未知来源渠道判红', 'list', baseProvenance('list', { source: 'ftp' }), '读来源词表')
expectProblem(
  'C10 未知字段组判红',
  'list',
  baseProvenance('list', { fieldGroups: { row: 'complete', cdn: 'complete' } }),
  '字段组',
)
expectProblem(
  'C11 完整度取值是魔法值判红',
  'list',
  baseProvenance('list', { fieldGroups: { row: 'full', labels: 'complete' } }),
  '不合法',
)
expectProblem(
  'C12 mixed 用在单渠道操作上判红',
  'listMaps',
  baseProvenance('listMaps', { source: 'mixed', fieldGroups: { row: 'complete', labels: 'complete' } }),
  '两个渠道',
)

// 渠道公式的几个边角也钉住：via 名称到来源的换算、词表本身。
check(readSourceOfVia('list.rest') === 'rest' && readSourceOfVia('get.rest-pr') === 'rest', 'REST 两种 via 都换算成 rest')
check(readSourceOfVia('list.gql') === 'graphql' && readSourceOfVia('get.pr') === 'graphql', 'GraphQL 两种 via 都换算成 graphql')
check(readSourceOfVia('budget.local') === null, '非渠道 via 不硬编成某个来源', readSourceOfVia('budget.local'))
check(GITHUB_READ_SOURCES.join(',') === 'graphql,rest,local,mixed', 'GitHub 读来源词表仍是四词', GITHUB_READ_SOURCES.join(','))

// =============================================================================================
// D. 接缝：stub 执行器，真调三条读路径，断言来源六要素与老字段行为
// =============================================================================================
console.log('#1685 D. 接缝：stub 执行器真调 listIssues / getIssue / listIssuesPage')

const REPO: any = {
  backend: 'github',
  refId: 'FeatherHunter/dsh-mattpocock-skills-deck',
  name: 'dsh-mattpocock-skills-deck',
  url: '',
}

function okExec(payload: any): any {
  return { stdout: JSON.stringify(payload), stderr: '', code: 0 }
}
function failExec(): any {
  return { stdout: '', stderr: 'unexpected EOF', code: 1 }
}
function graphqlEnvelope(data: any): any {
  return { data: data, rateLimit: { cost: 1 } }
}

// 一次 gh 调用按参数归类：渠道由参数里的 query= 文本与 REST 路径决定（execGh 不把 via 传给执行器）。
function classify(args: any): any {
  const list = Array.isArray(args) ? args : []
  const info: any = { kind: 'other', page: 0 }
  if (list[0] !== 'api') return info
  if (list[1] === 'graphql') {
    const queryArg = list.find(function (a: any): boolean {
      return typeof a === 'string' && a.startsWith('query=')
    })
    const query = queryArg ? queryArg.slice('query='.length) : ''
    if (query === LIST_QUERY) info.kind = 'list.gql'
    else if (query === LIST_PR_QUERY) info.kind = 'list.pr'
    else if (query === GET_QUERY) info.kind = 'get.gql'
    else if (query === LIST_PAGE_QUERY) info.kind = 'listPage.gql'
    else info.kind = 'graphql.other'
    return info
  }
  const pathArg = String(list[1] || '')
  const qIndex = pathArg.indexOf('?')
  const base = qIndex >= 0 ? pathArg.slice(0, qIndex) : pathArg
  const pageMatch = /[?&]page=(\d+)/.exec(pathArg)
  info.page = pageMatch ? Number(pageMatch[1]) : 0
  if (base === 'user') info.kind = 'rest.user'
  else if (base === 'rate_limit') info.kind = 'rest.budget'
  else if (/\/issues$/.test(base)) info.kind = 'rest.issues'
  else if (/\/pulls$/.test(base)) info.kind = 'rest.pulls'
  else if (/\/issues\/\d+$/.test(base)) info.kind = 'rest.issue'
  else if (/\/pulls\/\d+$/.test(base)) info.kind = 'rest.pull'
  else if (/\/sub_issues$/.test(base)) info.kind = 'rest.subIssues'
  else info.kind = 'rest.other'
  return info
}

async function makeRoom(handler: any): Promise<any> {
  const calls: any[] = []
  const ctx: any = {
    outbound: createOutboundControl(),
    platform: { resolveExecutable: async function (): Promise<string> { return 'gh' } },
    exec: async function (cmd: string, args: any): Promise<any> {
      const info = classify(args)
      calls.push(info)
      return handler(info)
    },
    cwd: '.',
    logEvent: function (): void {},
    isEnabled: function (): boolean { return false },
  }
  return { ctx: ctx, calls: calls }
}

function versionTimestampOf(prov: any): number {
  const match = /^read-v1-(\d+)-\d{6}$/.exec(String((prov && prov.startVersion) || ''))
  return match ? Number(match[1]) : NaN
}

function expectProvenance(tag: string, result: any, expected: any): any {
  const prov = result && result.provenance
  check(Boolean(prov), tag + '：结果带 provenance')
  if (!prov) return null
  check(prov.operation === expected.operation, tag + '：操作身份是 ' + expected.operation, prov.operation)
  check(prov.source === expected.source, tag + '：实际来源是 ' + expected.source, prov.source)
  const expectedGroups = Object.keys(expected.groups).map(function (key: string): string {
    return key + '=' + expected.groups[key]
  }).join(',')
  const actualGroups = Object.keys(expected.groups).map(function (key: string): string {
    return key + '=' + prov.fieldGroups[key]
  }).join(',')
  check(actualGroups === expectedGroups, tag + '：按字段组完整度为 ' + expectedGroups, actualGroups)
  check(prov.completeness === expected.completeness, tag + '：汇总完整度是 ' + expected.completeness, prov.completeness)
  const expectedMissing = (expected.missing || []).join(',')
  check(prov.missingFieldGroups.join(',') === expectedMissing, tag + '：缺失字段组为 [' + expectedMissing + ']', prov.missingFieldGroups)
  const expectedDegraded = expected.degradedFrom || ''
  check(String(prov.degradedFrom || '') === expectedDegraded, tag + '：降级来源为 ' + (expectedDegraded || '无'), prov.degradedFrom)
  check(Number.isInteger(prov.durationMs) && prov.durationMs >= 0, tag + '：耗时是非负整数', prov.durationMs)
  check(/^read-v1-\d+-\d{6}$/.test(String(prov.startVersion || '')), tag + '：取数开始版本形如 read-v1-<毫秒>-<六位序号>', prov.startVersion)
  return prov
}

function gqlIssue(number: number, opts?: any): any {
  const bag = opts || {}
  const labels = Array.isArray(bag.labels) ? bag.labels : [{ name: 'bug', color: 'ff0000', description: null }]
  return {
    number: number,
    title: '票' + number,
    state: 'OPEN',
    url: 'https://example.test/' + number,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    labels: { nodes: labels },
    assignees: { nodes: [] },
    comments: { totalCount: 0, nodes: [] },
    blockedBy: { nodes: [] },
    parent: null,
    milestone: null,
  }
}
function gqlListData(nodes: any[], hasNextPage: boolean): any {
  return graphqlEnvelope({ repository: { issues: { nodes: nodes, pageInfo: { hasNextPage: hasNextPage, endCursor: null } } } })
}
function gqlPullsData(nodes: any[]): any {
  return graphqlEnvelope({ repository: { pullRequests: { nodes: nodes, pageInfo: { hasNextPage: false, endCursor: null } } } })
}
function gqlComment(n: number): any {
  return { author: { login: 'u' }, body: '评论' + n, createdAt: '2026-10-01T00:00:00Z', url: 'https://example.test/c/' + n }
}
function gqlDetail(number: number, opts: any): any {
  const bag = opts || {}
  const commentNodes = Array.isArray(bag.commentNodes) ? bag.commentNodes : []
  return {
    number: number,
    title: '票' + number,
    state: 'OPEN',
    body: bag.body || '正文',
    url: 'https://example.test/' + number,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    labels: { nodes: [{ name: 'bug', color: 'ff0000', description: null }] },
    assignees: { nodes: [] },
    comments: {
      totalCount: typeof bag.commentTotal === 'number' ? bag.commentTotal : commentNodes.length,
      nodes: commentNodes,
    },
    blockedBy: { nodes: Array.isArray(bag.blockedBy) ? bag.blockedBy : [] },
    parent: null,
    milestone: null,
  }
}
function gqlDetailData(node: any): any {
  return graphqlEnvelope({ repository: { issue: node } })
}
function restListRow(n: number): any {
  return {
    number: n,
    title: '票' + n,
    state: 'open',
    body: '',
    labels: [],
    user: { login: 'u' },
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    html_url: 'https://example.test/' + n,
  }
}
function restDetailRow(n: number): any {
  return {
    number: n,
    title: 'REST 票 ' + n,
    state: 'open',
    body: '正文',
    labels: [{ name: 'bug', color: 'ff0000' }],
    user: { login: 'u' },
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    html_url: 'https://example.test/' + n,
  }
}
function labelsOfCount(count: number): any[] {
  const out: any[] = []
  for (let i = 0; i < count; i++) out.push({ name: 'l' + i, color: '000000', description: null })
  return out
}
function gqlPageIssue(n: number, labels: any[]): any {
  return {
    number: n,
    title: '票' + n,
    state: 'OPEN',
    url: 'https://example.test/' + n,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    labels: { nodes: labels },
    assignees: { nodes: [] },
  }
}
function gqlPageData(nodes: any[], totalCount: number): any {
  return graphqlEnvelope({
    repository: { issues: { nodes: nodes, totalCount: totalCount, pageInfo: { hasNextPage: false, endCursor: null } } },
  })
}

// D1. 整仓列表主路走 GraphQL
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'list.gql') return okExec(gqlListData([gqlIssue(1), gqlIssue(2)], false))
    if (info.kind === 'list.pr') return okExec(gqlPullsData([]))
    return failExec()
  })
  const t0 = Date.now()
  const result: any = await listIssues(REPO, undefined, room.ctx)
  const t1 = Date.now()
  const prov = expectProvenance('整仓列表主路', result, {
    operation: 'list',
    source: 'graphql',
    groups: { row: 'complete', labels: 'complete' },
    completeness: 'complete',
    missing: [],
    degradedFrom: '',
  })
  check(result.ok === true && Array.isArray(result.data) && result.data.length === 2, '整仓列表主路仍返回两张票（行为不变）')
  check(!result.fallback, '整仓列表主路不写 fallback（行为不变）', result.fallback)
  check(prov && versionTimestampOf(prov) >= t0 - 50 && versionTimestampOf(prov) <= t1 + 50, '取数开始版本的时间戳落在这次调用的时间窗里', prov && prov.startVersion)
  check(room.calls.map(function (c: any): string { return c.kind }).join(',') === 'list.gql,list.pr', '主路只发 GraphQL 两条查询', room.calls.map(function (c: any): string { return c.kind }))
}

// D1b. 单行标签到 50 条上限即截断
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'list.gql') return okExec(gqlListData([gqlIssue(1, { labels: labelsOfCount(50) })], false))
    if (info.kind === 'list.pr') return okExec(gqlPullsData([]))
    return failExec()
  })
  const result: any = await listIssues(REPO, undefined, room.ctx)
  expectProvenance('整仓列表单行标签到上限', result, {
    operation: 'list',
    source: 'graphql',
    groups: { row: 'complete', labels: 'truncated' },
    completeness: 'truncated',
    missing: ['labels'],
    degradedFrom: '',
  })
}

// D2. 整仓列表 GraphQL 失败 → REST 降级
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'list.gql') return failExec()
    if (info.kind === 'rest.issues') return okExec([restListRow(1), restListRow(2)])
    if (info.kind === 'rest.pulls') return okExec([])
    return failExec()
  })
  const result: any = await listIssues(REPO, undefined, room.ctx)
  expectProvenance('整仓列表 REST 降级', result, {
    operation: 'list',
    source: 'rest',
    groups: { row: 'complete', labels: 'complete' },
    completeness: 'complete',
    missing: [],
    degradedFrom: 'graphql',
  })
  check(result.ok === true && result.fallback === 'rest', '降级时旧字段 fallback 仍是 rest（行为不变）', result.fallback)
  check(result.truncated === true, '降级路径旧字段 truncated 仍是 true（行为不变）', result.truncated)
  check(typeof result.fallbackReason === 'string' && result.fallbackReason.length > 0, '降级仍带失败原因（行为不变）', result.fallbackReason)
  check(room.calls.map(function (c: any): string { return c.kind }).join(',') === 'list.gql,rest.issues,rest.pulls', '降级后按 REST 两条端点取数', room.calls.map(function (c: any): string { return c.kind }))
}

// D2b. REST 恰好翻满 10 页且每页满 100 行：没有空页探测，必须记 truncated
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'list.gql') return failExec()
    if (info.kind === 'rest.issues') {
      const rows: any[] = []
      for (let i = 0; i < 100; i++) rows.push(restListRow((info.page - 1) * 100 + i + 1))
      return okExec(rows)
    }
    if (info.kind === 'rest.pulls') return okExec([])
    return failExec()
  })
  const result: any = await listIssues(REPO, undefined, room.ctx)
  const restCalls = room.calls.filter(function (c: any): boolean { return c.kind === 'rest.issues' }).length
  check(restCalls === 10, 'REST 列表翻到第 10 页就停（不再多打一页）', restCalls)
  expectProvenance('REST 恰好翻满 10 页', result, {
    operation: 'list',
    source: 'rest',
    groups: { row: 'truncated', labels: 'complete' },
    completeness: 'truncated',
    missing: ['row'],
    degradedFrom: 'graphql',
  })
  check(result.data.length === 1000, '恰好整数页时的数据量与旧行为一致（行为不变）', result.data.length)
}

// D3. 单票主路走 GraphQL
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'get.gql') {
      return okExec(gqlDetailData(gqlDetail(123, { commentNodes: [gqlComment(1), gqlComment(2)], commentTotal: 2 })))
    }
    return failExec()
  })
  const result: any = await getIssue(REPO, '123', {}, room.ctx)
  const prov = expectProvenance('单票主路', result, {
    operation: 'get',
    source: 'graphql',
    groups: { row: 'complete', body: 'complete', comments: 'complete', dependencies: 'unexpressed' },
    completeness: 'partial',
    missing: ['dependencies'],
    degradedFrom: '',
  })
  check(result.ok === true && result.data && result.data.key === '123', '单票主路仍返回这张票（行为不变）', result.data && result.data.key)
  check(prov && versionTimestampOf(prov) > 0, '单票主路记下取数开始版本', prov && prov.startVersion)
  check(room.calls.map(function (c: any): string { return c.kind }).join(',') === 'get.gql', '单票主路只发一条 GraphQL 查询', room.calls.map(function (c: any): string { return c.kind }))
}

// D3b. 单票依赖到 50 条上限即截断
{
  const blockedBy: any[] = []
  for (let i = 0; i < 50; i++) blockedBy.push({ number: i + 1, title: '阻塞票' + (i + 1), state: 'OPEN' })
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'get.gql') return okExec(gqlDetailData(gqlDetail(123, { blockedBy: blockedBy })))
    return failExec()
  })
  const result: any = await getIssue(REPO, '123', {}, room.ctx)
  expectProvenance('单票依赖到上限', result, {
    operation: 'get',
    source: 'graphql',
    groups: { row: 'complete', body: 'complete', comments: 'complete', dependencies: 'truncated' },
    completeness: 'truncated',
    missing: ['dependencies'],
    degradedFrom: '',
  })
}

// D4. 单票 GraphQL 失败 → REST 降级
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'get.gql') return failExec()
    if (info.kind === 'rest.issue') return okExec(restDetailRow(123))
    return failExec()
  })
  const result: any = await getIssue(REPO, '123', {}, room.ctx)
  expectProvenance('单票 REST 降级', result, {
    operation: 'get',
    source: 'rest',
    groups: { row: 'complete', body: 'complete', comments: 'unexpressed', dependencies: 'unexpressed' },
    completeness: 'partial',
    missing: ['comments', 'dependencies'],
    degradedFrom: 'graphql',
  })
  check(result.ok === true && result.data && result.data.key === '123', '单票 REST 降级仍返回这张票（行为不变）', result.data && result.data.key)
  check(room.calls.map(function (c: any): string { return c.kind }).join(',') === 'get.gql,rest.issue', '单票降级后走 REST 单票端点', room.calls.map(function (c: any): string { return c.kind }))
}

// D5. 按页取票走 GraphQL
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'listPage.gql') return okExec(gqlPageData([gqlPageIssue(1, labelsOfCount(1)), gqlPageIssue(2, labelsOfCount(1))], 2))
    return failExec()
  })
  const result: any = await listIssuesPage(REPO, undefined, {}, room.ctx)
  expectProvenance('按页取票', result, {
    operation: 'listPage',
    source: 'graphql',
    groups: { row: 'complete', labels: 'complete' },
    completeness: 'complete',
    missing: [],
    degradedFrom: '',
  })
  check(result.ok === true && result.data && result.data.items.length === 2 && result.data.total === 2, '按页取票仍返回两行与总数（行为不变）')
  check(room.calls.map(function (c: any): string { return c.kind }).join(',') === 'listPage.gql', '按页取票只发一条 GraphQL 查询', room.calls.map(function (c: any): string { return c.kind }))
}

// D5b. 按页取票的单行标签到 50 条上限即截断
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'listPage.gql') return okExec(gqlPageData([gqlPageIssue(1, labelsOfCount(50))], 1))
    return failExec()
  })
  const result: any = await listIssuesPage(REPO, undefined, {}, room.ctx)
  expectProvenance('按页取票单行标签到上限', result, {
    operation: 'listPage',
    source: 'graphql',
    groups: { row: 'complete', labels: 'truncated' },
    completeness: 'truncated',
    missing: ['labels'],
    degradedFrom: '',
  })
}

// D6. 当前用户（房间入口 getCurrentUser）：成功挂身份组完整
//     #1687 把这条从白名单接成 wired：生产文件是 room/backend.ts —— 直接装一个真后端调它。
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'rest.user') return okExec({ login: 'alice', name: 'Alice', avatar_url: 'https://example.test/a.png' })
    return failExec()
  })
  const backend: any = createGithubBackend(room.ctx)
  const result: any = await backend.getCurrentUser(REPO, room.ctx)
  expectProvenance('当前用户', result, {
    operation: 'getCurrentUser',
    source: 'rest',
    groups: { identity: 'complete' },
    completeness: 'complete',
    missing: [],
    degradedFrom: '',
  })
  check(result.ok === true && result.data && result.data.login === 'alice' && result.data.kind === 'user', '当前用户仍返回登录名与身份形状（行为不变）')
  check(room.calls.map(function (c: any): string { return c.kind }).join(',') === 'rest.user', '当前用户只发一条 gh api user', room.calls.map(function (c: any): string { return c.kind }))
}

// D6b. 当前用户未登录：仍回 unsupported（行为不变），失败结果不带 provenance
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'rest.user') return { stdout: '', stderr: 'gh: Not logged in', code: 1 }
    return failExec()
  })
  const backend: any = createGithubBackend(room.ctx)
  const result: any = await backend.getCurrentUser(REPO, room.ctx)
  check(result.ok === false, '当前用户未登录仍回失败（行为不变）')
  check(!result.provenance, '当前用户失败结果不挂 provenance')
}

// D7. 读预算（房间入口 readBudget）：量到两桶水位时挂 local 来源与计数组完整
{
  const room = await makeRoom(function (info: any): any {
    if (info.kind === 'rest.budget') {
      return okExec({ resources: { core: { limit: 5000, remaining: 4990 }, graphql: { limit: 5000, remaining: 4900 } } })
    }
    return failExec()
  })
  const backend: any = createGithubBackend(room.ctx)
  const result: any = await backend.readBudget(room.ctx)
  expectProvenance('读预算', result, {
    operation: 'readBudget',
    source: 'local',
    groups: { counts: 'complete' },
    completeness: 'complete',
    missing: [],
    degradedFrom: '',
  })
  check(result.ok === true && result.data && result.data.known === true && result.data.buckets.rest.remaining === 4990, '读预算仍返回两桶水位（行为不变）')
  check(room.calls.map(function (c: any): string { return c.kind }).join(',') === 'rest.budget', '读预算只发一条 gh api rate_limit', room.calls.map(function (c: any): string { return c.kind }))
}

// D7b. 读不到额度：仍回成功信封（行为不变），读数未知时不挂 provenance
{
  const room = await makeRoom(function (): any { return failExec() })
  const backend: any = createGithubBackend(room.ctx)
  const result: any = await backend.readBudget(room.ctx)
  check(result.ok === true && result.data && result.data.known === false, '读不到额度仍走成功信封（行为不变）')
  check(!result.provenance, '读数未知不挂 provenance（没有可交代的字段组）')
}

// =============================================================================================
// 渠道层纯函数抽查：完整度判据的关键边角（与上面的接缝互补，这里不碰执行器）
// =============================================================================================
console.log('#1685 E. 渠道层完整度判据的关键边角')

check(graphqlRowsCompleteness({ truncated: false, dropped: 0 }) === 'complete', 'GraphQL 行：没丢行就是 complete')
check(graphqlRowsCompleteness({ truncated: false, dropped: 2 }) === 'truncated', 'GraphQL 行：丢过行就是 truncated')
check(graphqlLabelsCompleteness([labelsOfCount(49)]) === 'complete', 'GraphQL 标签：一行 49 条仍是 complete')
check(graphqlLabelsCompleteness([labelsOfCount(50)]) === 'truncated', 'GraphQL 标签：一行到 50 条上限即 truncated')
check(graphqlDependenciesCompleteness([null]) === 'unexpressed', 'GraphQL 依赖：没拉这一侧是 unexpressed')
check(graphqlDependenciesCompleteness([50, 2]) === 'truncated', 'GraphQL 依赖：一侧到 50 条上限即 truncated')
check(graphqlCommentsCompleteness({ nodesCount: 2, totalCount: 2, want: null }) === 'complete', 'GraphQL 评论：拉齐全部是 complete')
check(graphqlCommentsCompleteness({ nodesCount: 2, totalCount: 5, want: 2 }) === 'complete', 'GraphQL 评论：按需只拉前 2 条也算 complete')
check(graphqlLabelListCompleteness({ fetched: 1000, totalCount: 1000 }) === 'truncated', 'GraphQL 标签清单：到 1000 上限即 truncated')
check(graphqlSubIssuesCompleteness({ fetched: 1000, capped: false, hasNextPage: false }) === 'truncated', 'GraphQL 子票：到 1000 上限即 truncated')

check(
  restListCompleteness({ pagesFetched: 3, pageSize: 100, lastPageRows: 100, sawEmptyPage: false, hitPageCap: false, pageFailure: false }) === 'truncated',
  'REST 列表：恰好整页满又没有空页探测，只能记 truncated',
)
check(
  restListCompleteness({ pagesFetched: 3, pageSize: 100, lastPageRows: 40, sawEmptyPage: false, hitPageCap: false, pageFailure: false }) === 'complete',
  'REST 列表：最后一页不满一页是 complete',
)
check(
  restListCompleteness({ pagesFetched: 10, pageSize: 100, lastPageRows: 100, sawEmptyPage: false, hitPageCap: true, pageFailure: false }) === 'truncated',
  'REST 列表：触 10 页上限是 truncated',
)
check(restRowLabelsCompleteness([{ labels: [] }]) === 'complete', 'REST 行标签：结构完整是 complete')
check(restRowLabelsCompleteness([{ name: 'x' }]) === 'unexpressed', 'REST 行标签：结构不对是 unexpressed')
check(restSingleRowFieldGroups().comments === 'unexpressed', 'REST 单票不表达评论正文')
check(restLabelListCompleteness(1000) === 'truncated', 'REST 标签清单：到 1000 上限即 truncated')
check(
  restSubIssuesCompleteness({ fetched: 120, pageSize: 100, lastPageRows: 20, sawEmptyPage: false, hitCap: false, pageFailure: false }) === 'complete',
  'REST 子票：最后一页不满一页是 complete',
)

// =============================================================================================
// 汇总
// =============================================================================================
console.log('')
console.log('verify-read-result-provenance：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
printGateResult(GATE, total, failed ? 1 : 0)
process.exit(failed ? 1 : 0)
