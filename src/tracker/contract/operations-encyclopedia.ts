/**
 * src/tracker/contract/operations-encyclopedia.ts —— 操作百科：每条操作的读/写标记与读操作的四样声明
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * 「一次读操作可以用哪些渠道、取回什么形状的结果、能表达哪些字段组、
 *  这一次读按什么顺序花哪几族额度。」
 *
 * 在此之前，这份名单散在两处：额度闸里手写一份「哪些读操作只记 GraphQL 点数」的数组
 * （`src/refresh/kernel/budget-admission.ts` 的 `GRAPHQL_READ_OPS`；#1765 起已换成从本文件
 * `spend` 派生的 `READ_SPEND_PLANS`，额度闸不再手抄第二份），另一些关于读操作的说法
 * 只活在注释里。规格 1681 要求操作百科成为读操作名录的单一真源：额度闸、门禁与将来的路由层
 * 都从这一份枚举，谁也不再手抄第二份。
 *
 * ── 为什么放在契约层 ────────────────────────────────────────────────────────────
 * 三个后端房间与 `src/refresh/kernel/` 都要读它，契约目录是它们都能引的公共层；
 * 而且本文件只有类型与数据，符合契约层「只许类型与数据」的纪律（`tests/verify-contract-types.ts`
 * 第二项盯着这件事）：没有函数、没有分支、没有取值逻辑，注册表拿到它只是照着遍历。
 *
 * ── 三条不能改的约定 ────────────────────────────────────────────────────────────
 * 1. 顺序照 `operations-catalog.ts` 的 `OPERATIONS`：新增操作先加进名录，再在这里补一条；
 *    门禁 `tests/verify-operation-catalog.ts` 逐条比对，缺一条或名字不在名录里都判红。
 * 2. `channels` 说的是「这条读操作允许走哪些渠道」，不是「这一次实际走了哪个渠道」。
 *    实际来源由阶段 1 的读结果记录（ADR 20261030 的房间分层），本文件不预判。
 * 3. `spend` 说的是「这一次读真正会花哪几族额度、按什么顺序」，不是「允许走哪些渠道」。
 *    两者故意分开，回答的问题不同：`channels` 给阶段 1 的读来源对账用（允许范围），
 *    `spend` 给额度闸与房间用（这次放行的渠道计划）。`list` 与 `get` 两族都能读，
 *    `spend` 就写成先 GraphQL 再 REST：GraphQL 见底时计划只剩 REST，而不是整条读被拦；
 *    REST-only 的读写成只花 REST，GraphQL 见底时照常放行。
 *
 * ── 写操作为什么没有 `channels` ──────────────────────────────────────────────────
 * 写操作的通道选择是另一张票（额度闸渠道放行）的范围，本票不动。这里只记读/写标记、
 * 结果类型（写操作固定是回执）与回执能表达的字段组，够门禁判「这条是写」即可。
 */
import { OPERATIONS } from './operations-catalog.js'

/** 操作名联合类型：直接取自契约名录，不在本文件手抄第二份 24 个名字。 */
export type OperationName = (typeof OPERATIONS)[number]

/**
 * 读操作可以走的取数渠道。
 *
 * `graphql` / `rest` / `either` 是票面点名的三种：只走 GraphQL、只走 REST、两端任一。
 * `local` 是补的第四条：读插件自己的账本（`readBudget`）不经过任何远端渠道，
 * 硬塞进 `graphql` 或 `rest` 会撒谎。以后真有别的本地读，也用它。
 */
export const READ_CHANNELS = ['graphql', 'rest', 'either', 'local'] as const
export type ReadChannel = (typeof READ_CHANNELS)[number]

/**
 * 一次读操作取回的结果是什么形状。
 * 名字照规格 1681 第 5 节的完整度矩阵取，够门禁判「结果类型声明了没有」，不是完整的数据模型。
 */
export const READ_RESULT_KINDS = [
  'check',       // 探测结果：仓库在不在、能不能读（preflight）
  'rows',        // 一屏多行薄行（list）
  'detail',      // 单张票的详情（get）
  'page',        // 一页行，留给翻页（listPage）
  'dependencies',// 依赖边（getDependencies）
  'subIssues',   // 子票清单（listSubIssues）
  'counts',      // 计数（counts）
  'labels',      // 标签清单（listLabels）
  'maps',        // 地图薄行（listMaps）
  'actor',       // 当前用户（getCurrentUser）
  'permissions', // 仓库权限（getRepoPermissions）
  'budget',      // 读预算（readBudget）
] as const
export type ReadResultKind = (typeof READ_RESULT_KINDS)[number]

/**
 * 读结果里可以按字段组拆开声明的那些组（规格 1681 第 3 节的「按字段组完整度」）。
 * 这里只列组名，不列每个组里有哪些字段——字段清单属于各渠道的响应对账，不属操作百科。
 */
export const FIELD_GROUPS = [
  'row',          // 行级字段：标题、状态、认领人、时间这一层
  'body',         // 票正文
  'comments',     // 评论正文
  'review',       // 拉取请求的评审
  'parents',      // 父子边
  'dependencies', // 依赖边
  'subIssues',    // 子票清单
  'counts',       // 计数
  'labels',       // 标签
  'mergeInfo',    // 合并时间（只有拉取请求端点表达）
  'permissions',  // 仓库权限
  'identity',     // 当前用户身份
] as const
export type FieldGroup = (typeof FIELD_GROUPS)[number]

/**
 * 读操作会花到的额度族，同时也就是它可能走的物理渠道。
 *
 * 两族在 GitHub 上的花费口径不同：GraphQL 按点数（points），REST 按请求数（requests）。
 * 额度闸给这两族各留一份保底，所以「这一次读会花哪一族」必须说清楚，不能到了放行时才发现
 * 花的是另一族（#1681）。`local` 不花任何远端额度，是读插件自己账本的那一条。
 */
export const READ_SPEND_CHANNELS = ['graphql', 'rest', 'local'] as const
export type ReadSpendChannel = (typeof READ_SPEND_CHANNELS)[number]

/**
 * 一条读操作的花费渠道计划：按顺序列出这一次读允许走的渠道，先走前面的，前面的失败才走后一个。
 *
 * 三种形态：
 *   - 单渠道（长度 1）：`['rest']` 或 `['graphql']`，实现上只有这一条路，这一族见底就读不了；
 *   - 双渠道（长度 2，先 graphql 后 rest）：GraphQL 主路失败或见底时降级 REST，两族任一有余量就能读；
 *   - 本地（`['local']`）：不花远端额度，永远放行。
 *
 * 这张计划是额度闸的裁决依据，也是房间选路的依据：计划里没有的渠道，这一次一次都不试；
 * 计划里有的渠道，房间可以按顺序换，不必回来重新问闸（换渠道不增加花费的族）。
 */
export type ReadSpendPlan = readonly ReadSpendChannel[]

/** 非 GitHub 后端的读来源默认值：渠道只写本家通道，完整度只写「完整」或「未表达」。 */
export const READ_SOURCE_COMPLETENESS = ['complete', 'unexpressed'] as const
export type ReadSourceCompleteness = (typeof READ_SOURCE_COMPLETENESS)[number]

/** 一条读操作的声明。 */
export type ReadProfile = {
  /** 读/写标记：读。 */
  readonly kind: 'read'
  /** 允许走的渠道；`either` 表示 GraphQL 与 REST 都行。 */
  readonly channels: ReadChannel
  /** 取回结果的形状。 */
  readonly result: ReadResultKind
  /** 结果可能表达的字段组；空数组不算声明，门禁判红。 */
  readonly fieldGroups: readonly FieldGroup[]
  /** 这条读操作的花费渠道计划，见 `ReadSpendPlan` 的说明。 */
  readonly spend: ReadSpendPlan
}

/** 一条写操作的声明：结果固定是回执，`fieldGroups` 是回执能表达的字段。 */
export type WriteProfile = {
  /** 读/写标记：写。 */
  readonly kind: 'write'
  /** 写操作的结果类型固定是回执。 */
  readonly result: 'receipt'
  /** 回执能表达的字段组；有些写操作的回执只有成功与否，可以是空数组。 */
  readonly fieldGroups: readonly FieldGroup[]
}

/** 百科里的一条：要么是读操作的完整声明，要么是写操作的回执声明。 */
export type OperationProfile = ReadProfile | WriteProfile

/**
 * 非 GitHub 后端的读来源默认值。
 *
 * 规格 1681 第 3 节：契约对所有后端定义来源字段，但只强制 GitHub 返回真实来源；
 * 另两家给显式默认值——来源写本家通道，完整度写「完整」或「未表达」。
 * 渠道名是开放的字符串：内置两家今天写 `gitlab-api` 与 `markdown-files`，
 * 第三方后端可以写自己的名字，门禁不替它们编词表。
 */
export type OwnChannelReadSource = {
  /** 本家通道的名字，例如 `gitlab-api`、`markdown-files`。 */
  readonly channel: string
  /** 默认完整度：`complete` 是完整，`unexpressed` 是未表达。 */
  readonly completeness: ReadSourceCompleteness
}

/**
 * 操作百科：24 条操作的读/写标记与读操作的四样声明。
 *
 * 键的顺序照 `OPERATIONS`。新增一条操作的顺序是：先加进 `operations-catalog.ts`，
 * 再在这里补一条，然后跑门禁——门禁会指出缺了哪一条。
 *
 * 读操作的 `spend` 是 #1765 逐条核对实现后写下的花费渠道计划：REST-only 的四条、
 * GraphQL 主路加 REST 兜底的三条、GraphQL-only 的四条、读本地账本的一条。
 * 额度闸从这里派生「这一次允许走哪些渠道」，门禁 `tests/verify-operation-catalog.ts`
 * 与 `tests/verify-1765-read-channel-plan.ts` 钉住这张表，不让无名渠道混进来。
 */
export const OPERATION_ENCYCLOPEDIA = {
  // 探测：问仓库在不在、能不能读。今天实现只走 REST（gh auth status、gh repo view、gh api）；
  // 回执只有权限一组。GraphQL 见底不妨碍探活。
  preflight: { kind: 'read', channels: 'either', result: 'check', fieldGroups: ['permissions'], spend: ['rest'] },
  // 整仓列表：规格第 5 节写明两个渠道都能取；行级字段与标签由列表端点表达。
  list: { kind: 'read', channels: 'either', result: 'rows', fieldGroups: ['row', 'labels'], spend: ['graphql', 'rest'] },
  // 单票详情：行级字段、正文、评论按需、父子边、依赖每侧前 50、子票计数、评审、合并时间。
  // 这次没取或端点没有的组如实记未表达——GitHub 的工单查询不取子票/评审/合并时间，
  // 拉取请求查询没有父子边与依赖边，REST 单票端点除回包自带的子票计数、评审数组外都不表达。
  get: {
    kind: 'read',
    channels: 'either',
    result: 'detail',
    fieldGroups: ['row', 'body', 'comments', 'parents', 'dependencies', 'subIssues', 'review', 'mergeInfo'],
    spend: ['graphql', 'rest'],
  },
  // 依赖边：每侧前 50，触上限即截断。
  getDependencies: { kind: 'read', channels: 'either', result: 'dependencies', fieldGroups: ['dependencies'], spend: ['graphql', 'rest'] },
  // 建票：写；回执能表达新建出来的那一行。
  create: { kind: 'write', result: 'receipt', fieldGroups: ['row'] },
  close: { kind: 'write', result: 'receipt', fieldGroups: ['row'] },
  reopen: { kind: 'write', result: 'receipt', fieldGroups: ['row'] },
  // 评论：写；回执能表达评论组。
  comment: { kind: 'write', result: 'receipt', fieldGroups: ['comments'] },
  update: { kind: 'write', result: 'receipt', fieldGroups: ['row', 'body'] },
  setLabels: { kind: 'write', result: 'receipt', fieldGroups: ['labels'] },
  setAssignees: { kind: 'write', result: 'receipt', fieldGroups: ['row'] },
  setParent: { kind: 'write', result: 'receipt', fieldGroups: ['parents'] },
  setBlockedBy: { kind: 'write', result: 'receipt', fieldGroups: ['dependencies'] },
  // 当前用户：今天实现只走 REST（gh api user）；结果是一份身份，不是一张票。
  getCurrentUser: { kind: 'read', channels: 'either', result: 'actor', fieldGroups: ['identity'], spend: ['rest'] },
  // 初始化项目字段：写；回执只有成功与否，没有票级字段。
  initProject: { kind: 'write', result: 'receipt', fieldGroups: [] },
  // 标签清单：今天实现只走 REST（gh label list）；触 1000 上限即截断。
  listLabels: { kind: 'read', channels: 'either', result: 'labels', fieldGroups: ['labels'], spend: ['rest'] },
  // 改标签颜色：写；回执表达标签组。
  setLabelColors: { kind: 'write', result: 'receipt', fieldGroups: ['labels'] },
  // 计数：今天只走 GraphQL（REST 没有单请求等价，完整枚举时可本地重算，那不在本操作里）。
  counts: { kind: 'read', channels: 'either', result: 'counts', fieldGroups: ['counts'], spend: ['graphql'] },
  // 翻页：一页行，行级字段与标签由列表端点表达；今天只走 GraphQL（REST 没有同一游标口径）。
  listPage: { kind: 'read', channels: 'either', result: 'page', fieldGroups: ['row', 'labels'], spend: ['graphql'] },
  // 仓库写权限：今天实现只走 REST（gh api repos/{owner}/{name} 的 permissions 字段）。
  getRepoPermissions: { kind: 'read', channels: 'either', result: 'permissions', fieldGroups: ['permissions'], spend: ['rest'] },
  // 子票清单：今天只走 GraphQL；触 1000 上限即截断。
  listSubIssues: { kind: 'read', channels: 'either', result: 'subIssues', fieldGroups: ['subIssues', 'row'], spend: ['graphql'] },
  // 默认配色文件：写；回执只有成功与否（本地文件路径不是票级字段）。
  ensureLabelColorsFile: { kind: 'write', result: 'receipt', fieldGroups: [] },
  // 全量地图薄行：今天只有 GraphQL 一条路（REST 没有「地图」这个概念），所以渠道写 graphql。
  listMaps: { kind: 'read', channels: 'graphql', result: 'maps', fieldGroups: ['row', 'labels'], spend: ['graphql'] },
  // 读预算：读插件自己的账本，不走任何远端渠道；它本来就不花额度，永远放行。
  readBudget: { kind: 'read', channels: 'local', result: 'budget', fieldGroups: ['counts'], spend: ['local'] },
} as const satisfies Record<OperationName, OperationProfile>

/**
 * 名录里被标成读操作的那些名字。
 *
 * 从百科的 `kind` 派生，不手抄第二份读操作名单：三份后端读来源登记表用它做键类型，
 * 少一条编译期就报错（`Record<ReadOperationName, …>` 要求键齐全）。
 */
export type ReadOperationName = {
  [K in OperationName]: (typeof OPERATION_ENCYCLOPEDIA)[K] extends { readonly kind: 'read' } ? K : never
}[OperationName]