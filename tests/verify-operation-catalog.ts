/**
 * tests/verify-operation-catalog.ts —— 操作百科名录一致性门禁（#1683）
 *
 * 门禁归属: src/tracker/contract/operations-encyclopedia.ts
 * 门禁归属: src/tracker/rooms/github/read/read-sources.ts
 * 门禁归属: src/tracker/rooms/gitlab/read-sources.ts
 * 门禁归属: src/tracker/rooms/markdown/read-sources.ts
 * 门禁归属: src/refresh/kernel/budget-admission.ts
 *
 * 这个门禁回答四个问题：
 *   一、操作百科是不是名录的完整镜像：24 条操作一条不缺、一条不多；每条读操作都声明了可用渠道、
 *       结果类型、可表达字段组与记账口径；每条写操作都标成写、结果类型是回执。
 *   二、三个后端的读来源登记表是不是同一份元数据：GitHub 每一条直接引用百科里的那一份；
 *       GitLab 与 Markdown 每一条都是本家通道的显式默认值；三份的键集都等于名录里的读操作。
 *   三、额度闸的读名单是不是真的从百科派生：派生出来仍是原来那七条 GraphQL 读，其余读操作的
 *       族选择仍是「两族都看」——这一项钉住行为零变化。
 *   四、手写的读名单有没有删干净：额度闸文件里再出现一份字面量数组就判红。
 *
 * 为什么要负例：百科是这一票新建的，没有旧行为可以跑红。删掉一条渠道声明、删掉一条后端登记、
 * 把本家通道的默认值写错，判据必须当场报出问题——负例是这条判据唯一的证据，只删断言不算。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-operation-catalog.ts
 *       （跑全链时钩子由链条自己挂，见 scripts/verify-chain.ts）
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { OPERATIONS } from '../src/tracker/contract/operations-catalog.js'
import {
  OPERATION_ENCYCLOPEDIA,
  READ_CHANNELS,
  READ_RESULT_KINDS,
  READ_BUDGET_FAMILIES,
  FIELD_GROUPS,
  READ_SOURCE_COMPLETENESS,
} from '../src/tracker/contract/operations-encyclopedia.js'
import { GITHUB_READ_SOURCES } from '../src/tracker/rooms/github/read/read-sources.js'
import { GITLAB_READ_SOURCES } from '../src/tracker/rooms/gitlab/read-sources.js'
import { MARKDOWN_READ_SOURCES } from '../src/tracker/rooms/markdown/read-sources.js'
import { familiesOfOp, isWriteOp } from '../src/refresh/kernel/budget-admission.js'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')

/** 本票开工时额度闸里那份手写读名单的七条。派生结果改了一条，这一项就红：行为必须零变化。 */
const EXPECTED_GRAPHQL_READS = ['list', 'get', 'listPage', 'getDependencies', 'listSubIssues', 'listLabels', 'counts']

/** 额度闸认成「写」的那九条（三份写名单的并集）。百科的读/写标记必须与它们对得上。 */
const ADMISSION_WRITE_OPS = ['create', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy']

/** 门禁眼里的百科条目：字段按未知类型看，负例才好在内存里删掉一格。 */
type Profile = {
  kind?: unknown
  channels?: unknown
  result?: unknown
  fieldGroups?: unknown
  budget?: unknown
}
type Catalog = Record<string, Profile>
type Register = Record<string, { channel?: unknown; completeness?: unknown }>

let failed = false
const check = (ok: boolean, msg: string): void => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 深拷一份，供负例在内存里改坏；不动盘上的真数据。 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 两份名单是不是同一集合（不看顺序）。 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
}

/**
 * 检查一份百科：名录覆盖、读/写标记、读操作的四样声明、写操作的回执结果。
 * 返回人话问题清单；空数组才是通过。负例直接拿它跑内存里改坏的副本。
 */
function catalogProblems(catalog: Catalog): string[] {
  const problems: string[] = []
  const names = Object.keys(catalog)
  for (const op of OPERATIONS) {
    if (!(op in catalog)) problems.push('名录里的操作 ' + op + ' 在百科里没有条目')
  }
  for (const name of names) {
    if (!OPERATIONS.includes(name)) problems.push('百科里的 ' + name + ' 不在契约名录里')
  }
  for (const name of names) {
    if (!OPERATIONS.includes(name)) continue
    const profile = catalog[name]
    if (profile.kind !== 'read' && profile.kind !== 'write') {
      problems.push(name + ' 没有读/写标记（kind 只能是 read 或 write，实际是 ' + String(profile.kind) + '）')
      continue
    }
    if (!Array.isArray(profile.fieldGroups)) {
      problems.push(name + ' 没有声明可表达字段组')
    } else {
      for (const group of profile.fieldGroups) {
        if (!FIELD_GROUPS.includes(group as never)) problems.push(name + ' 的字段组 ' + String(group) + ' 不在词表里')
      }
      if (profile.kind === 'read' && profile.fieldGroups.length === 0) problems.push(name + ' 是读操作，可表达字段组不能是空数组')
    }
    if (profile.kind === 'write') {
      if (profile.result !== 'receipt') problems.push(name + ' 是写操作，结果类型必须是 receipt（实际是 ' + String(profile.result) + '）')
      continue
    }
    if (!READ_CHANNELS.includes(profile.channels as never)) {
      problems.push(name + ' 是读操作，但没有声明合法的可用渠道（实际是 ' + String(profile.channels) + '）')
    }
    if (!READ_RESULT_KINDS.includes(profile.result as never)) {
      problems.push(name + ' 是读操作，但没有声明合法的结果类型（实际是 ' + String(profile.result) + '）')
    }
    if (!READ_BUDGET_FAMILIES.includes(profile.budget as never)) {
      problems.push(name + ' 是读操作，但没有声明合法的记账口径（实际是 ' + String(profile.budget) + '）')
    }
  }
  return problems
}

/** 名录里被百科标成读的那些操作名。 */
function readOperationsOf(catalog: Catalog): string[] {
  return OPERATIONS.filter((op) => catalog[op] && catalog[op].kind === 'read')
}

/**
 * 检查一份后端读来源登记表：键集是不是全部读操作；GitHub 的每条是不是直接引用百科那一条；
 * 另两家的每条是不是本家通道的显式默认值。
 */
function registerProblems(backend: 'github' | 'gitlab' | 'markdown', register: Register, catalog: Catalog, readOps: readonly string[]): string[] {
  const problems: string[] = []
  for (const op of readOps) {
    if (!(op in register)) problems.push(backend + ' 的读来源登记缺 ' + op)
  }
  for (const name of Object.keys(register)) {
    if (!readOps.includes(name)) problems.push(backend + ' 的读来源登记里 ' + name + ' 不是读操作')
  }
  for (const op of readOps) {
    const entry = register[op]
    if (!entry) continue
    if (backend === 'github') {
      if ((entry as unknown) !== (catalog[op] as unknown)) problems.push('github 的 ' + op + ' 没有直接引用操作百科里的那一条（必须是同一份元数据）')
      continue
    }
    const expectedChannel = backend === 'gitlab' ? 'gitlab-api' : 'markdown-files'
    if (entry.channel !== expectedChannel) problems.push(backend + ' 的 ' + op + ' 默认渠道应是 ' + expectedChannel + '（实际是 ' + String(entry.channel) + '）')
    if (!READ_SOURCE_COMPLETENESS.includes(entry.completeness as never)) problems.push(backend + ' 的 ' + op + ' 默认完整度不在词表里（实际是 ' + String(entry.completeness) + '）')
  }
  return problems
}

function report(label: string, problems: readonly string[]): void {
  check(problems.length === 0, label + (problems.length ? '：' + problems.join('；') : ''))
}

// ---- 0) 词表本身：票面点名的三项渠道与结果类型必须在词表里 ----
check(
  READ_CHANNELS.includes('graphql') && READ_CHANNELS.includes('rest') && READ_CHANNELS.includes('either'),
  '渠道词表覆盖票面点名的三种：GraphQL、REST、两端任一（实际是 ' + READ_CHANNELS.join(' / ') + '）',
)
check(READ_RESULT_KINDS.includes('rows') && READ_RESULT_KINDS.includes('detail') && READ_RESULT_KINDS.includes('dependencies') && READ_RESULT_KINDS.includes('counts') && READ_RESULT_KINDS.includes('labels'), '结果类型词表覆盖行、详情、依赖边、计数、标签这几种',
)
check(FIELD_GROUPS.includes('row') && FIELD_GROUPS.includes('comments') && FIELD_GROUPS.includes('dependencies') && FIELD_GROUPS.includes('subIssues') && FIELD_GROUPS.includes('labels'), '可表达字段组词表覆盖行、评论、依赖边、子票、标签这几组',
)

// ---- 1) 百科是名录的完整镜像，读操作四样声明齐全 ----
report('24 条操作在百科里齐全，读操作的渠道/结果类型/字段组/记账口径都声明了', catalogProblems(OPERATION_ENCYCLOPEDIA as unknown as Catalog))

const readOps = readOperationsOf(OPERATION_ENCYCLOPEDIA as unknown as Catalog)
const writeOps = OPERATIONS.filter((op) => (OPERATION_ENCYCLOPEDIA as unknown as Catalog)[op].kind === 'write')
check(readOps.length + writeOps.length === OPERATIONS.length, '读操作与写操作不重叠、合起来正好是全部操作（读 ' + readOps.length + ' 条、写 ' + writeOps.length + ' 条）')

// ---- 2) 三份后端读来源登记表 ----
report('GitHub 的读来源登记逐条引用操作百科、键集齐全', registerProblems('github', GITHUB_READ_SOURCES as unknown as Register, OPERATION_ENCYCLOPEDIA as unknown as Catalog, readOps))
report('GitLab 的读来源登记逐条给本家通道的显式默认值、键集齐全', registerProblems('gitlab', GITLAB_READ_SOURCES as unknown as Register, OPERATION_ENCYCLOPEDIA as unknown as Catalog, readOps))
report('Markdown 的读来源登记逐条给本家通道的显式默认值、键集齐全', registerProblems('markdown', MARKDOWN_READ_SOURCES as unknown as Register, OPERATION_ENCYCLOPEDIA as unknown as Catalog, readOps))

// ---- 3) 额度闸行为零变化：派生结果仍是那七条，其余读操作仍是两族都看 ----
const derivedGraphqlReads = readOps.filter((op) => (OPERATION_ENCYCLOPEDIA as unknown as Catalog)[op].budget === 'graphql')
check(
  sameSet(derivedGraphqlReads, EXPECTED_GRAPHQL_READS),
  '记账口径为 graphql 的读操作仍是开工前那七条（实际是 ' + derivedGraphqlReads.join(', ') + '）',
)
const familyProblems: string[] = []
for (const op of readOps) {
  const wantGraphql = (OPERATION_ENCYCLOPEDIA as unknown as Catalog)[op].budget === 'graphql'
  const expected = wantGraphql ? { all: ['graphql'], anyOf: [] } : { all: ['rest', 'graphql'], anyOf: [] }
  const got = familiesOfOp(op)
  if (JSON.stringify(got) !== JSON.stringify(expected)) familyProblems.push(op + ' 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(got))
}
report('额度闸对全部 ' + readOps.length + ' 条读操作的族选择与百科的记账口径一致（行为零变化）', familyProblems)
const writeMarkProblems = ADMISSION_WRITE_OPS.filter((op) => (OPERATION_ENCYCLOPEDIA as unknown as Catalog)[op].kind !== 'write')
report('额度闸写名单里的九条在百科里都标成写操作', writeMarkProblems.map((op) => op + ' 没有标成写'))
const readAsWrite = readOps.filter((op) => isWriteOp(op))
report('读操作没有一条被额度闸当成写操作', readAsWrite.map((op) => op + ' 被 isWriteOp 认成写'))

// ---- 4) 手写读名单已删，额度闸从百科派生 ----
const budgetSource = fs.readFileSync(path.join(ROOT, 'src/refresh/kernel/budget-admission.ts'), 'utf8')
check(budgetSource.includes('OPERATION_ENCYCLOPEDIA'), '额度闸导入了操作百科（读名单从单一真源派生）')
check(!/GRAPHQL_READ_OPS[^=\n]*=\s*\[/.test(budgetSource), '额度闸里没有手写的读名单数组（GRAPHQL_READ_OPS 后面不再跟字面量数组）')
check(!budgetSource.includes("'list', 'get', 'listPage'"), '额度闸里没有残留那七条名字的手写副本')

// ---- 5) 负例：判据真能咬住 ----
const noChannels = deepClone(OPERATION_ENCYCLOPEDIA) as unknown as Catalog
delete noChannels.get.channels
const noChannelsProblems = catalogProblems(noChannels)
check(noChannelsProblems.some((p) => p.includes('get') && p.includes('渠道')), '负例：删掉 get 的渠道声明，检查函数当场判红（' + (noChannelsProblems[0] || '没报') + '）')

const noResult = deepClone(OPERATION_ENCYCLOPEDIA) as unknown as Catalog
delete noResult.list.result
const noResultProblems = catalogProblems(noResult)
check(noResultProblems.some((p) => p.includes('list') && p.includes('结果类型')), '负例：删掉 list 的结果类型，检查函数当场判红（' + (noResultProblems[0] || '没报') + '）')

const missingOp = deepClone(OPERATION_ENCYCLOPEDIA) as unknown as Catalog
delete missingOp.counts
const missingOpProblems = catalogProblems(missingOp)
check(missingOpProblems.some((p) => p.includes('counts') && p.includes('没有条目')), '负例：百科漏掉 counts 一条，检查函数当场判红（' + (missingOpProblems[0] || '没报') + '）')

const noGithubEntry = { ...(GITHUB_READ_SOURCES as unknown as Register) }
delete noGithubEntry.get
const noGithubProblems = registerProblems('github', noGithubEntry, OPERATION_ENCYCLOPEDIA as unknown as Catalog, readOps)
check(noGithubProblems.some((p) => p.includes('缺 get')), '负例：GitHub 读来源登记漏掉 get，检查函数当场判红（' + (noGithubProblems[0] || '没报') + '）')

const wrongGitlab = { ...(GITLAB_READ_SOURCES as unknown as Register), list: { channel: 'rest', completeness: 'complete' } }
const wrongGitlabProblems = registerProblems('gitlab', wrongGitlab, OPERATION_ENCYCLOPEDIA as unknown as Catalog, readOps)
check(wrongGitlabProblems.some((p) => p.includes('list') && p.includes('gitlab-api')), '负例：GitLab 的默认渠道写成 rest，检查函数当场判红（' + (wrongGitlabProblems[0] || '没报') + '）')

const emptyCoverage = registerProblems('markdown', {}, OPERATION_ENCYCLOPEDIA as unknown as Catalog, readOps)
check(emptyCoverage.length >= readOps.length, '负例：Markdown 读来源登记全空，检查函数逐条报缺（报了 ' + emptyCoverage.length + ' 条）')

console.log(failed ? '\n存在失败 — 操作百科名录一致性门禁没通过' : '\n全部通过 — 操作百科名录一致性门禁生效')
process.exit(failed ? 1 : 0)