/**
 * src/tracker/rooms/github/routing/read-result.ts —— 读结果的来源与按字段组完整度组装（票 #1685）
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * 「这一趟 GitHub 读实际走了哪条渠道？每条声明的字段组取全了没有？从什么时候开始取？」
 * 操作百科（`src/tracker/contract/operations-encyclopedia.ts`）声明了每条读操作允许走哪些渠道、
 * 结果里可能表达哪些字段组；这个文件把「声明」与「这一次的事实」对上：
 * 读路径在开始取数时调 `beginRead()` 拿一个取数起点，成功返回前调 `buildReadProvenance()`
 * 交出 `ReadProvenance`。校验不过就抛错——宁可让这次读失败，也不许把自相矛盾的来源与完整度
 * 交给上层（坏形状比缺字段更难发现）。
 *
 * ── 为什么放在 routing 层 ──────────────────────────────────────────────────────
 * 规格 1681 第 9 节：渠道选择、重试与降级判定集中在路由层，读层不各自实现。
 * 「实际走了哪个渠道」这个事实因此也只该由路由层写进结果；渠道层
 * （`channels/graphql/read-shapes.ts`、`channels/rest/read-shapes.ts`）只回答协议形状与上限问题，
 * 不知道业务规则。本文件只依赖契约层的类型、数据与操作百科，不 import read/write/room，
 * 也不 import 任何渠道文件——渠道事实以字符串传进来，通道互引由分层门禁守住。
 *
 * ── 三条不能改的约定 ───────────────────────────────────────────────────────────
 * 1. `source` 必须与这次读实际记账的 `via` 同一渠道（规格第 9 节：来源与实际记账桶一致）。
 *    读路径用 `readSourceOfVia()` 从 execGh 的 via 后缀换算来源，不要手写渠道字符串。
 * 2. 每个声明过的字段组都要有一个明确值。少给一组就抛错：忘记表态等于悄悄谎称完整，
 *    比读失败更难发现。
 * 3. 降级另记一笔，不拿完整度顶替：`degradedFrom` 必须是这条操作渠道计划里的主路渠道、
 *    且与 `source` 不同；总完整度仍只由字段组派生——备路要是把声明的字段组都取全了，
 *    这一趟就是 `complete`（降级本身由 `degradedFrom` 单独表达，不靠把完整度写成 `truncated` 来暗示）。
 */
import { FIELD_GROUP_COMPLETENESS } from '../../../contract/read-provenance.js'
import type {
  FieldGroupCompleteness,
  ReadCompleteness,
  ReadProvenance,
  ReadResultSource,
} from '../../../contract/read-provenance.js'
import {
  FIELD_GROUPS,
  OPERATION_ENCYCLOPEDIA,
} from '../../../contract/operations-encyclopedia.js'
import type {
  FieldGroup,
  OperationName,
  ReadChannel,
  ReadOperationName,
} from '../../../contract/operations-encyclopedia.js'

/**
 * GitHub 房间今天会写进 `ReadProvenance.source` 的词。
 *
 * `graphql` 与 `rest` 是两条真实代码通道；`local` 是读插件自己的账本（`readBudget`），
 * 不经过 gh 进程；`mixed` 是同一趟读里两条通道都真给了数据（今天还没有读路径这么返回，
 * 词先留在词表里，等阶段 4 的补齐路径真有双渠道合并时用）。
 */
export const GITHUB_READ_SOURCES = ['graphql', 'rest', 'local', 'mixed'] as const
export type GitHubReadSource = (typeof GITHUB_READ_SOURCES)[number]

/**
 * GraphQL 渠道词。
 *
 * 这个词表的第一格就是 GraphQL。单独取出来，是因为 `'graphql'` 这个字面量与旧判档词表里的
 * 一个历史档位词同形：直接写在 `return` 后面会被 verify-error-single-source 的 B1 误判成
 * 手写档位。取词表本身既能保证来源词只有一处定义，也不会再触发那扇门禁的文本判据。
 */
const GRAPHQL_SOURCE: GitHubReadSource = GITHUB_READ_SOURCES[0]

/**
 * 操作百科的「允许渠道」换算成「真实渠道计划」。
 *
 * 百科的 `either` 对 GitHub 房意味着主路 GraphQL、备路 REST；`graphql` / `rest` 是单路；
 * `local` 不经过远端渠道。数组顺序就是路由顺序：第一个是主路，后面是备路。
 */
function channelPlanSources(channels: ReadChannel): readonly GitHubReadSource[] {
  if (channels === 'either') return ['graphql', 'rest']
  if (channels === 'graphql') return ['graphql']
  if (channels === 'rest') return ['rest']
  return ['local']
}

/** 百科里标成读的操作名，顺序照百科（也就是 `operations-catalog.ts` 的名录顺序）。 */
export function readOperationNames(): ReadOperationName[] {
  const names = Object.keys(OPERATION_ENCYCLOPEDIA) as OperationName[]
  return names.filter(
    (name): name is ReadOperationName => OPERATION_ENCYCLOPEDIA[name].kind === 'read',
  )
}

/**
 * 每条读操作的渠道计划，从操作百科派生——不手抄第二份渠道名单。
 *
 * 门禁 `tests/verify-read-result-provenance.ts` 逐条比对百科的 `channels`，这里少一条、多一条
 * 或换算错都判红。读路径用 `READ_CHANNEL_PLAN[operation][0]` 当主路。
 */
export function deriveChannelPlan(): Readonly<Record<ReadOperationName, readonly GitHubReadSource[]>> {
  const plan: Partial<Record<ReadOperationName, readonly GitHubReadSource[]>> = {}
  for (const name of readOperationNames()) {
    plan[name] = channelPlanSources(OPERATION_ENCYCLOPEDIA[name].channels)
  }
  // 为什么敢断言：循环已经覆盖百科里所有读操作（readOperationNames 就是按 kind 筛出来的），
  // 这条断言只是让类型从 Partial 收窄成全量；漏掉哪条时校验函数会拿到 undefined 并当场抛错。
  return plan as Readonly<Record<ReadOperationName, readonly GitHubReadSource[]>>
}

/** 读操作在百科里声明的字段组（顺序照百科，不含写操作）。 */
export function readFieldGroupsOf(operation: ReadOperationName): readonly FieldGroup[] {
  return OPERATION_ENCYCLOPEDIA[operation].fieldGroups
}

/** 启动一趟读时要拿到的两样东西：开始取数的时刻，与这一趟的数据窗口起点标记。 */
export interface ReadClock {
  /** 开始取数的毫秒时间戳，用来算 `durationMs`。 */
  readonly startedAt: number
  /** 数据窗口起点标记，写进 `ReadProvenance.startVersion`。 */
  readonly startVersion: string
}

/** 进程内递增的读序号，用来保证同一毫秒里的两趟读也有不同的起点标记。 */
let readSequence = 0

/**
 * 开始一趟读：记下时刻，并生成这一趟的数据窗口起点标记。
 *
 * 标记格式 `read-v1-<毫秒时间戳>-<六位序号>`。为什么不是仓库快照版本：GitHub 房间今天拿不到
 * 仓库级版本号，阶段 1 只能如实记「开始取数的时刻」；阶段 2 的宿主版本门会用宿主自己的版本
 * 与这个时刻换算先后。格式由本文件定义，`readProvenanceProblems` 校验，改格式要同步改校验与
 * 门禁。
 */
export function beginRead(now?: number): ReadClock {
  const startedAt = typeof now === 'number' && Number.isFinite(now) ? Math.trunc(now) : Date.now()
  readSequence = (readSequence % 999999) + 1
  const startVersion = 'read-v1-' + String(startedAt) + '-' + String(readSequence).padStart(6, '0')
  return { startedAt, startVersion }
}

/**
 * 从 execGh 的 `via` 字符串换算实际来源渠道。
 *
 * 记账用的 via 形如 `list.gql`、`list.rest`、`get.pr`、`get.rest-pr`：后缀就是渠道。
 * 规格第 9 节要求读结果来源与实际记账桶一致，所以来源只能这样换算，不许读路径手写
 * `'rest'` 这类字符串——手写就给了两者悄悄漂移的机会。
 *
 * 认不出的 via（例如 `budget` 这类不走 gh 的）返回 null，调用方自己决定记 `local` 还是报错。
 */
export function readSourceOfVia(via: string): GitHubReadSource | null {
  // 先判 rest：`get.rest-pr` 同时以 `.pr` 结尾，顺序写反会把它错算成 GraphQL。
  if (via.endsWith('.rest') || via.endsWith('.rest-pr')) return 'rest'
  if (via.endsWith('.gql') || via.endsWith('.pr')) return GRAPHQL_SOURCE
  return null
}

/** 组装读结果来源信息时读路径要交进来的事实。 */
export interface ReadProvenanceInput {
  /** 这次实际取到数的渠道；用 `readSourceOfVia()` 换算，别手写。 */
  readonly source: ReadResultSource
  /** 每条声明字段组的完整度；键集必须恰好等于百科为这条操作声明的组。 */
  readonly fieldGroups: Readonly<Partial<Record<FieldGroup, FieldGroupCompleteness>>>
  /** 从开始取数到现在的毫秒数，非负整数。 */
  readonly durationMs: number
  /** 开始取数时拿到的起点标记（来自 `beginRead()`）。 */
  readonly startVersion: string
  /** 走过降级时的主路渠道；没降级就不传。 */
  readonly degradedFrom?: ReadResultSource
}

/** 汇总完整度：有截断就是 truncated，有未表达就是 partial，全都完整才是 complete。 */
function overallCompleteness(
  declared: readonly FieldGroup[],
  fieldGroups: Readonly<Partial<Record<FieldGroup, FieldGroupCompleteness>>>,
): ReadCompleteness {
  let truncated = false
  let unexpressed = false
  for (const group of declared) {
    const value = fieldGroups[group]
    if (value === 'truncated') truncated = true
    else if (value !== 'complete') unexpressed = true
  }
  if (truncated) return 'truncated'
  if (unexpressed) return 'partial'
  return 'complete'
}

/** 缺失字段组：声明的组里不是 complete 的那些，顺序照契约 `FIELD_GROUPS`。 */
function missingFieldGroupsOf(
  declared: readonly FieldGroup[],
  fieldGroups: Readonly<Partial<Record<FieldGroup, FieldGroupCompleteness>>>,
): FieldGroup[] {
  const declaredSet = new Set(declared)
  const missing: FieldGroup[] = []
  for (const group of FIELD_GROUPS) {
    if (!declaredSet.has(group)) continue
    if (fieldGroups[group] !== 'complete') missing.push(group)
  }
  return missing
}

/**
 * 组装一条读结果的来源信息；形状不合法就抛错。
 *
 * 读路径在成功返回前调用它，拿到 `ReadProvenance` 挂到结果上。抛错是故意的：
 * 忘记给某个声明字段组表态、把来源写成渠道计划外的词、降级来源与来源相同，
 * 这些都不是「少一点信息」，而是会让阶段 2 的合并层做出错误判断的坏数据。
 * 抛出的错误文本一次列全所有问题，排查不用猜。
 */
export function buildReadProvenance(
  operation: ReadOperationName,
  input: ReadProvenanceInput,
): ReadProvenance {
  const declared = readFieldGroupsOf(operation)
  const fieldGroups: Partial<Record<FieldGroup, FieldGroupCompleteness>> = {}
  for (const group of FIELD_GROUPS) {
    const value = input.fieldGroups[group]
    if (value !== undefined) fieldGroups[group] = value
  }
  const provenance: ReadProvenance = {
    operation,
    source: input.source,
    completeness: overallCompleteness(declared, fieldGroups),
    fieldGroups,
    missingFieldGroups: missingFieldGroupsOf(declared, fieldGroups),
    durationMs: input.durationMs,
    startVersion: input.startVersion,
    ...(input.degradedFrom === undefined ? {} : { degradedFrom: input.degradedFrom }),
  }
  const problems = readProvenanceProblems(operation, provenance)
  if (problems.length > 0) {
    throw new Error('read provenance 不合法（' + operation + '）：' + problems.join('；'))
  }
  return provenance
}

/** 词表检查用：`source` 是不是 GitHub 房间认的来源词。 */
function isKnownSource(source: unknown): source is GitHubReadSource {
  return typeof source === 'string' && (GITHUB_READ_SOURCES as readonly string[]).includes(source)
}

/** 词表检查用：某个字段组的完整度取值合不合法。 */
function isKnownFieldGroupCompleteness(value: unknown): value is FieldGroupCompleteness {
  return typeof value === 'string' && (FIELD_GROUP_COMPLETENESS as readonly string[]).includes(value)
}

/**
 * 校验一份读结果来源信息，返回发现的问题（空数组表示合法）。
 *
 * 门禁 `tests/verify-read-result-provenance.ts` 用它的负例证明「坏形状拦得住」：
 * 缺来源、来源不在渠道计划里、缺声明字段组、截断了却标 complete、降级来源与来源相同、
 * 起点标记或耗时是坏值，都必须至少报一条问题。
 *
 * 为什么单独导出而不是只让 `buildReadProvenance` 内部用：门禁要能直接喂坏形状进来，
 * 不用为了测一个校验条件去构造一条完整读路径。
 */
export function readProvenanceProblems(operation: ReadOperationName, provenance: ReadProvenance): string[] {
  const problems: string[] = []
  const plan = READ_CHANNEL_PLAN[operation] ?? []
  const declared = readFieldGroupsOf(operation)
  const fieldGroups = (provenance.fieldGroups ?? {}) as Partial<Record<FieldGroup, FieldGroupCompleteness>>

  if (provenance.operation !== operation) {
    problems.push('operation 与校验入参不一致：' + String(provenance.operation) + ' ≠ ' + operation)
  }

  const source = provenance.source
  if (!isKnownSource(source)) {
    problems.push('来源 ' + String(source) + ' 不在 GitHub 读来源词表（' + GITHUB_READ_SOURCES.join('/') + '）里')
  } else if (source === 'mixed') {
    if (plan.length < 2) problems.push('来源 mixed 要求这条操作有两个渠道，' + operation + ' 的渠道计划只有一个')
  } else if (!plan.includes(source)) {
    problems.push('来源 ' + source + ' 不在 ' + operation + ' 的渠道计划（' + plan.join(' → ') + '）里')
  }

  if (provenance.degradedFrom !== undefined) {
    const from = provenance.degradedFrom
    if (!isKnownSource(from)) {
      problems.push('降级来源 ' + String(from) + ' 不在 GitHub 读来源词表里')
    } else if (!plan.includes(from)) {
      problems.push('降级来源 ' + from + ' 不在 ' + operation + ' 的渠道计划里')
    }
    if (from === source) problems.push('降级来源不能与实际来源相同（' + from + '）')
    if (source === 'mixed') problems.push('来源 mixed 不许带降级来源（mixed 没有唯一主路）')
  }

  const declaredKeys = Object.keys(fieldGroups) as FieldGroup[]
  for (const group of declaredKeys) {
    if (!FIELD_GROUPS.includes(group)) problems.push('字段组 ' + group + ' 不在契约词表 FIELD_GROUPS 里')
  }
  for (const group of declared) {
    if (!(group in fieldGroups)) problems.push('缺声明字段组 ' + group)
  }
  for (const group of declaredKeys) {
    const value = fieldGroups[group]
    if (!isKnownFieldGroupCompleteness(value)) {
      problems.push('字段组 ' + group + ' 的完整度取值 ' + String(value) + ' 不合法')
    }
  }

  const expectedMissing = missingFieldGroupsOf(declared, fieldGroups)
  const missing: readonly FieldGroup[] = Array.isArray(provenance.missingFieldGroups) ? provenance.missingFieldGroups : []
  if (missing.length !== expectedMissing.length || missing.some((group, index) => group !== expectedMissing[index])) {
    problems.push('missingFieldGroups 与字段组事实不一致：期望 ['
      + expectedMissing.join(', ') + ']，实际给出 [' + missing.join(', ') + ']')
  }

  const expectedOverall = overallCompleteness(declared, fieldGroups)
  if (provenance.completeness !== expectedOverall) {
    problems.push('总体完整度 ' + String(provenance.completeness) + ' 与字段组事实不一致：按字段组应为 ' + expectedOverall)
  }

  if (!Number.isInteger(provenance.durationMs) || provenance.durationMs < 0) {
    problems.push('durationMs 必须是非负整数，实际 ' + String(provenance.durationMs))
  }
  if (typeof provenance.startVersion !== 'string' || !/^read-v1-\d+-\d{6}$/.test(provenance.startVersion)) {
    problems.push('startVersion 必须是 read-v1-<毫秒时间戳>-<六位序号> 形，实际 ' + String(provenance.startVersion))
  }
  return problems
}

/** 渠道计划：从百科派生，建一次就够了。 */
export const READ_CHANNEL_PLAN = deriveChannelPlan()

/**
 * 一条读操作接来源与完整度的进度登记。
 *
 * 规格 1681 阶段 1 允许降级路径先用白名单登记、逐条清零：#1685 先把 `list` / `get` /
 * `listPage` 三条接上；#1686 第二批把随读实现搬进 read/ 的七条（预检、依赖、标签清单、
 * 计数、仓库权限、子票、地图）同批接上。只剩 `getCurrentUser` 与 `readBudget` 两条等 #1687
 * 房间入口收口时统一接（它们的实现今天在 backend.ts 与额度账本里）。
 * 门禁 `tests/verify-read-result-provenance.ts` 逐条核对：wired 必须有真实 producing 文件
 * 且该文件真调 `buildReadProvenance`，whitelisted 必须带票号与理由——白名单不是豁免，
 * 是带下次入场券的欠账。
 */
export interface ReadProvenanceWiring {
  /** wired：已接来源与完整度；whitelisted：登记在案、等后续票接。 */
  readonly status: 'wired' | 'whitelisted'
  /** wired 时的生产文件（仓库相对路径），门禁核对它存在且真调组装函数。 */
  readonly producer?: string
  /** whitelisted 时的接票号，形如 `#1686`。 */
  readonly ticket?: string
  /** whitelisted 时的理由：为什么先不接、等哪批搬完接。 */
  readonly reason?: string
}

/**
 * 十二条读操作各自的接线状态。
 *
 * 顺序照操作百科（preflight、list、get、getDependencies、getCurrentUser、listLabels、counts、
 * listPage、getRepoPermissions、listSubIssues、listMaps、readBudget），门禁按百科枚举对键集，
 * 少一条、多一条、重复一条都判红。
 */
export const READ_PROVENANCE_STATUS = {
  // 探测：已接（#1686 把预检搬进 read/preflight.ts 时同批接；三条门禁全过才记权限组完整）。
  preflight: { status: 'wired', producer: 'src/tracker/rooms/github/read/preflight.ts' },
  // 整仓列表：本票已接（GraphQL 主路与 REST 兜底两个成功分支都挂来源）。
  list: { status: 'wired', producer: 'src/tracker/rooms/github/issues.ts' },
  // 单票详情：本票已接（GraphQL 工单 / GraphQL 拉取请求 / REST 单票四条成功分支都挂来源）。
  get: { status: 'wired', producer: 'src/tracker/rooms/github/issues.ts' },
  // 依赖边：已接（#1686 把依赖读侧搬进 read/deps-read.ts；原生路记 GraphQL，退回整仓反推时记 REST 并标降级来源）。
  getDependencies: { status: 'wired', producer: 'src/tracker/rooms/github/read/deps-read.ts' },
  // 当前用户：实现内联在房间入口 backend.ts，等 #1687 房间入口收口时接。
  getCurrentUser: {
    status: 'whitelisted',
    ticket: '#1687',
    reason: '实现内联在 backend.ts，等 #1687 房间入口收口时接来源与完整度',
  },
  // 标签清单：已接（#1686 把标签读侧从 label-colors-ops.ts 拆进 read/labels.ts；取不全整条失败，成功即标签组完整）。
  listLabels: { status: 'wired', producer: 'src/tracker/rooms/github/read/labels.ts' },
  // 计数：已接（#1686 把 counts.ts 搬进 read/ 时同批接；只有一次 GraphQL 往返，成功即计数组完整）。
  counts: { status: 'wired', producer: 'src/tracker/rooms/github/read/counts.ts' },
  // 翻页：本票已接（GraphQL 单页路径成功返回时挂来源）。
  listPage: { status: 'wired', producer: 'src/tracker/rooms/github/read/page.ts' },
  // 仓库权限：已接（#1686 把 repo-permissions.ts 搬进 read/；问到 push/triage 才算读成，成功即权限组完整）。
  getRepoPermissions: { status: 'wired', producer: 'src/tracker/rooms/github/read/repo-permissions.ts' },
  // 子票清单：已接（#1686 把 sub-issues.ts 搬进 read/；子票组与行组分开判，1000 上限判定在渠道层）。
  listSubIssues: { status: 'wired', producer: 'src/tracker/rooms/github/read/sub-issues.ts' },
  // 地图薄行：已接（#1686 把 maps.ts 搬进 read/；行组按封顶页数判截断，标签组按单行满 50 判截断）。
  listMaps: { status: 'wired', producer: 'src/tracker/rooms/github/read/maps.ts' },
  // 读预算：读的是插件自己的额度账本（来源固定 local），等 #1687 收口时统一定义。
  readBudget: {
    status: 'whitelisted',
    ticket: '#1687',
    reason: '读插件自己的额度账本、来源固定 local，等 #1687 收口时统一接来源与完整度',
  },
} satisfies Readonly<Record<ReadOperationName, ReadProvenanceWiring>>
