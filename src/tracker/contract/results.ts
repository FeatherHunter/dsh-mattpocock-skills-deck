/**
 * src/tracker/contract/results.ts —— 契约的返回值形状：这次调用成没成、成的拿到什么
 *
 * ── 这一件在五件里的位置 ────────────────────────────────────────────────────────
 * 按「谁读它」拆五件（见同目录 README.md）：本件放**房间回给调用方的所有形状**，
 * 读者是 deck 九个工具、面板与注册表。判断某样东西该不该住本件的尺子只有一条：
 * **它是从房间流向调用方的**（回值、失败、选择结论），还是从调用方流向房间的（入参）——
 * 后者住 inputs.ts。按这条尺子，`Dependencies`、`Counts`、`PageResult` 这三个
 * 虽然写在旧文件的「入参与选项」一节里，其实是回值，因此搬进本件；这一点与
 * 旧文件的分节不同，是这次拆分**有意的归位**，不是搬错。
 *
 * 本件引用地基层（枚举）与实体层（票、仓库引用），不引用入参那一件：
 * 回值是链路末端，它不该反过来依赖前面交进来的东西。
 */

import type { BackendId, ErrorKind } from './identity.js'
import type { Issue, IssueRef, LabelColor, RepositoryRef } from './entities.js'
import type { ReadProvenance } from './read-provenance.js'

// ─────────────────────────────────────────────────────────────────────────────
// 四、返回值：失败是值不是异常
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 统一的失败形状，三段式（地图 #1042 落地票 #1111 定版）：
 * - `kind`：机器分支用，八档之一（类目真源在 `contract/vocabulary.ts`）。
 * - `message`：给人看的一句话，允许直接展示。**不要把原文塞进来** ——
 *   一处契约测试为此下过禁令（`contract-label-colors.ts`：原子写失败的提示里带临时文件名，
 *   用户会照着去找一个不存在的文件）。
 * - `raw`：后端或命令吐出的原文，人自己判断的兜底。**必填**（确实没有原文时给空串）：
 *   可选字段等于早晚被省略，门禁也就断言不了「每个失败都带原文」。
 *   取法只有一处 —— `fail(kind, message, raw)`（`src/tracker/kernel/preflight.ts`），
 *   由它统一做多路合并、凭据遮蔽与头尾截断；决策见
 *   `docs/adr/20261014-error-classification-single-source.md`。
 */
export interface TrackerError {
  kind: ErrorKind
  message: string
  raw: string
  /**
   * 这次失败发生在链路哪一段（可选）。只在「这一段有确定的下一步」时才填；
   * 填它不改变 `kind` 与 `raw` 的含义，三段式仍是必填的三段。
   */
  stage?: TrackerErrorStage
}

/**
 * 失败发生在链路哪一段（可选，给机器读，**不是错误档位**；#1171 加）。
 *
 * 取值表 `TRACKER_ERROR_STAGE` 是唯一真源：房间写它、调用方比对它也走这一份，
 * 别再把 `'anchor-lookup'` 写成裸字面量 —— 改名时编译器能顺着常量找到每一处。
 * 今天只有一个取值：建票前按幂等锚回查时没能做成，后端一个写动作都没发出、票没建。
 * 带上它的失败，`message` 只陈述事实；「调用方还能做什么」只有调用方那一层知道
 * （例：deck 的建票工具看到它会补「原样重试即可」并说清为什么安全）。
 * 不传 = 普通失败，调用方不额外推荐做法 —— 别的原因（权限、参数……）原样重试未必有用。
 *
 * 覆盖范围只有远端两间房（GitHub、GitLab）。本地 markdown 后端按锚回查失败时**不填**它：
 * 那里失败的是「读本机票文件读不出来」（`src/tracker/rooms/markdown/create-layout.ts:246`），
 * 原样重试不会让一个读不出来的文件变好，工具层不该对人许这个愿。本地这张通道以后要补，
 * 应当带上同一个常量，并想清楚本地回查失败时重试到底能改变什么。
 */
export const TRACKER_ERROR_STAGE = Object.freeze({
  /** 建票前按幂等锚回查时没能做成：票没建，原样重试是安全的。 */
  ANCHOR_LOOKUP: 'anchor-lookup',
})

/** 链路阶段的取值类型；从 `TRACKER_ERROR_STAGE` 推出来，保证类型与运行时常量不会写成两个值。 */
export type TrackerErrorStage = (typeof TRACKER_ERROR_STAGE)[keyof typeof TRACKER_ERROR_STAGE]

/**
 * 统一返回形状：一次调用要么成功带数据，要么失败带原因，没有第三种。
 * 用可辨识联合而不是 `{ok: boolean, data?, error?}`，是为了让调用方在 `if (!r.ok)` 之后
 * 拿 `r.error` 时编译器知道它一定在（那种「两个字段都可能没有」的写法，
 * 正是仓库里若干 `res.error && res.error.message` 兜底的来路）。
 */
export type OpResult<T> = { ok: true; data: T; usage?: OpUsage } | { ok: false; error: TrackerError }

/**
 * 一次操作实际花掉的量（请求数、点数），由房间在成功信封上自报（#1446 A3 加）。
 *
 * 为什么放在回值上而不是让调用方自己估：估算只在调用**之前**做（tool-call-budget），
 * 真实用量只有真正发出命令的那一层知道；房间的客户端本来就数着每一笔出站，
 * 让它把数留在信封上，是唯一「既不重复数、也不靠猜」的来源。
 * 口径由后端自己声明（BackendBudgetModel 的 countsRequests/countsPoints），
 * 记账实现照声明取舍，不按 backendId 写等值分支。
 * 可选：离网后端（Markdown）没有额度这回事，不给这一格；调用方读到缺席时按「零花」记账并留一行诊断。
 */
export interface OpUsage {
  /** 这一次实际发出的请求条数。 */
  readonly requests: number
  /** 这一次实际花掉的点数（只有双桶口径的后端认这一格，其余恒 0）。 */
  readonly points: number
}

/**
 * 环境预检的结果（`preflight` 专用）。
 * 为什么不复用 `OpResult`：预检回答的是「环境通不通」这一件事，
 * 包一层 `ok/data` 会让「ok:true 但环境不 ok」这种自相矛盾的形状成为可能。
 * 预检**只判环境**（工具在不在、登录没有、连不连得上、文件系统能不能碰），
 * 绝不预判能力 —— 能力永远由真正调用的结果说话。
 */
export interface PreflightResult {
  ok: boolean
  /** `ok:false` 时给出原因；`ok:true` 时不写。 */
  error?: TrackerError
  /**
   * 这一趟预检的来源与按字段组完整度（#1686）：三条门禁全过才是「权限这组完整」，
   * 中途失败不挂 provenance（失败结果只回答通不通，不冒充已读到的形状）。
   */
  readonly provenance?: ReadProvenance
}

/**
 * 三级联选择的结果（显式选择 > 命中识别 > 兜底）。
 * - `backendId: null` 表示「确认没有后端」（逃生舱）；此时**不给** `ref`，不造假的仓库身份。
 * - `pending: true` 表示识别有超时未决：仲裁还没做完，界面必须显示「等待/建议显式选择」，
 *   不许静默当成「没有后端」—— 这两种情况长得像，但对用户的意思完全相反。
 * - `multiHit` 给出多个后端同时命中时的候选，供用户显式纠正。
 */
export interface Selection {
  backendId: BackendId | null
  /**
   * 这个结论是怎么来的：显式选择 / 命中 / 兜底，以及 `unknown`。
   * `unknown` 表示「还不知道这个工作区是哪条目录」——它与「已决的无后端」（backendId 为 null 且 source 为 fallback）
   * 是两件相反的事：前者等就绪后自行恢复，后者要人去面板选一次。三种取值的穷尽分支里不许把 unknown 当 fallback。
   */
  source: 'explicit' | 'matches' | 'fallback' | 'unknown'
  /**
   * 结论的具体出处（比 source 更细一档）：`user-file` / `file-migrated` / `file-detected` / `file-auto`
   * （工作区配置文件里的四种来源，前两种是人选、后两种是读侧兼容分支）、`declaration`（仓库里的说明文件）、
   * `autodetect`（自动识别）、`unknown-workspace`（还没认出目录）、`pending` / `none`（没有结论）。
   * 界面与排查读它说清「这个答案凭什么」，不要拿 source 反推。
   *
   * #1138（2026-10-14）起不再有 `user-memory-bind` 这个取值：人选的唯一记录是工作区文件，
   * 判定出口原来那层「本次进程内的绑定副本」已整段删除（见 docs/adr/20261012-backend-decision-two-classes.md 第 8 节）。
   * 本字段今天仍是平铺的字符串（不是机器可判的两类表），把「出处 → 两类」做成表并加门禁另起一笔。
   */
  origin?: string
  /** `backendId` 不为 null 时给出的仓库身份。 */
  ref?: RepositoryRef
  /** 同时命中的多个后端（平局按注册顺序取第一个，这里如实全部给出）。 */
  multiHit?: BackendId[]
  /** 识别有超时未决。 */
  pending?: true
}

/**
 * 仓库写权限（`getRepoPermissions`，本轮**升为契约操作**）。
 * 只回答「当前账号在这个仓库上能不能推、能不能管标签」，供 deck_context 的能力位
 * 与失败归因共用。问不出来时如实回失败，调用方按「未知」处理，**不许捏造**。
 */
export interface RepoPermissions {
  /** 能不能推（写票、发评论、改标签都要它）。 */
  push: boolean
  /** 能不能整理别人的票（改指派、关别人的票）。 */
  triage: boolean
  /**
   * 这两个布尔是怎么读来的（#1686）：走到 `api repos/<owner>/<name>` 的 .permissions 这一条，
   * 来源记 rest、权限组完整。挂在数据对象上是因为调用方（房间入口）原样透传这个对象，不另包信封。
   */
  readonly provenance?: ReadProvenance
}

/**
 * 依赖投影（便利视图，**不是第二真源**）。
 * `blockedBy` 是唯一真源；`blocking`（我阻塞了谁）是它的反向聚合，由后端或宿主演算得出。
 * 归在本件（回值）而不是入参那一件：它是 `getDependencies` 的**返回**，
 * 调用方读它、房间产出它 —— 旧文件把它写在「入参与选项」一节里，是分节的历史遗留。
 */
export interface Dependencies {
  blockedBy: IssueRef[]
  /** 反向投影：便利字段，任何判定都不许只信它。 */
  blocking: IssueRef[]
  /**
   * 这一次的 `blocking` 是不是完整的（#1304）。
   * `false` 表示只看到了后端能一次给的一部分：到了后端一次能给的条数上限，或者退回整仓列表反推时那份列表被截断。
   * 这时调用方必须把「可能不全」写进回执，**不许把「没看到」当成「没有」**。
   * 可选：老后端与旧调用点不给这一格，按「没交代」处理，不许读成 `true`。
   */
  blockingComplete?: boolean
  /**
   * 这一次的 `blockedBy`（被谁阻塞）是不是完整的（#1304 顺手补）。
   * 正向边与反向边一样有「后端一次最多给多少条」的上限；到了上限时这里给 `false`，
   * 调用方同样必须把「可能不全」写进回执，不许把「没看到」当成「没有」。
   * 可选：读不到这个信号的旧路上不给这一格，按「没交代」处理。
   */
  blockedByComplete?: boolean
  /**
   * 反向边是怎么来的：`native` = 后端自带的「我挡住了谁」字段一次取回（开销与仓库总票数无关）；
   * `scan` = 后端没有这个字段（老版本、非 GitHub、这次查询失败），退回整仓列表逐行反推（代价随仓库票数增长）。
   * 可选：没有这一格的后端不交代来源。
   */
  blockingSource?: 'native' | 'scan'
  /** 给人看的一句话，说清这次依赖边的来源与完整性；任何一侧 `Complete === false` 时必须有。 */
  blockingNote?: string
}

/** getDependencies 的完整返回：依赖投影 + 这一趟的来源与依赖字段组完整度（#1686）。 */
export type DependenciesResult = OpResult<Dependencies> & {
  /** 来源是实际走通的那条渠道；反向边到每侧上限时依赖组记截断，不是「没有阻塞关系」。 */
  readonly provenance?: ReadProvenance
}

/**
 * `list` 操作的返回（#1304 搬进契约）。
 *
 * 为什么不是裸的 `OpResult<Issue[]>`：后端房间会在这份结果上多带一格「这次名单全不全」的交代 ——
 * `truncated: true` 表示这份名单**可能不全**：撞上后端自己的安全上限（GitHub 是工单 500 条、
 * 拉取请求 1000 条），或者走了降级通道只拿到一部分（REST 自己有翻页上限，尾页失败时只回已拿到的），
 * 却仍回成功。这格从前只写在房间的本地类型里，调用方靠强制转换去读；
 * 它是**从房间流向调用方**的形状，按本文件开头的尺子该住在这里。
 *
 * `fallback` / `fallbackReason` 是更早的同类先例（走了 REST 降级通道），一并收在这一份里。
 */
export type IssueListResult = OpResult<Issue[]> & {
  /** 主路不可用、走了 REST 降级通道时给 `'rest'`；正常走 GraphQL 主路时不给。 */
  fallback?: string
  /** REST 降级的原因：`quota` = 真配额耗尽，`other` = 其它原因；未知时不给。 */
  fallbackReason?: string
  /** 这份名单可能不全（到了后端安全上限，或降级通道只拿到一部分）：调用方不许当成整仓。 */
  truncated?: boolean
  /**
   * 这一趟读结果的来源与按字段组完整度（#1685）：用了哪条渠道、每个字段组是完整/截断/未表达、
   * 耗时与取数开始版本。老调用方不读它，行为与从前一字不差；新调用方靠它说清
   * 「这份名单是从哪条渠道读来的、具体缺哪一组」，而不是只拿一个 truncated 猜。
   */
  readonly provenance?: ReadProvenance
}

/**
 * get 操作的返回：一张票 + 来源与按字段组完整度（#1685）。
 *
 * 为什么不再写成裸的 OpResult<Issue>：单票在两条渠道上的能力不一样——GraphQL 主路能带评论正文、
 * 能看依赖的一侧，REST 降级只回行与正文，评论与依赖这几组一律表达不了。调用方必须能分清
 * 「截断（本来有、没取全）」与「未表达（这条渠道本来就不提供）」；一个总体布尔会把两者糊成一句
 * 「可能不全」，既冤枉了完整的部分，也会让人去补根本补不到的数据。
 */
export type IssueDetailResult = OpResult<Issue> & {
  /** 这一趟读了什么：来源渠道、按字段组完整度、缺失字段组、耗时与取数开始版本。 */
  readonly provenance?: ReadProvenance
}

/**
 * 计数结果（`counts` 操作的返回）。
 * 只回答「多少张」，不返回任何行 —— 行怎么取是另一件事。
 * 口径：只数工单、不含拉取请求；三个数都必须是**非负整数**，
 * 任何一个拿不到就整体失败，不许猜一个数出来（界面上猜出来的数与真数长得一模一样）。
 */
export interface Counts {
  open: number
  closed: number
  total: number
}

/** counts 的完整返回：数字本身 + 这一趟的来源与计数字段组完整度（#1686）。 */
export type CountsResult = OpResult<Counts> & {
  /** 计数只走 GraphQL 一条路，成功时 counts 组完整；失败结果不挂 provenance。 */
  readonly provenance?: ReadProvenance
}

/**
 * 一页票与总数（`listPage` 的返回）。
 * 排序键固定「创建时间倒序」，调用方没得选 —— 翻页期间若有票被更新，按更新时间排会让票
 * 在页与页之间挪位置、漏掉一张；创建时间是写下来就不动的。
 */
export interface PageResult {
  /** 本页的行数据（薄片段：不带正文、不带评论）。 */
  items: Issue[]
  /** 下一页的游标；没有下一页时给 `null`（不是空串、也不是省略）。 */
  nextCursor: string | null
  /** 同一口径下的总数（非负整数），供界面写「已加载 x / 共 N」。 */
  total: number
}

/**
 * listPage 操作的返回：一页票与总数 + 来源与按字段组完整度（#1685）。
 *
 * 为什么单列一份而不是把来源塞进 PageResult：PageResult 说的是「这一页装了什么」，
 * 而来源信息说的是「这一页是怎么读来、有没有被渠道上限截住、这一趟从哪个版本开始取」——
 * 前者是分页数据的定义，后者是读的轨迹；两者寿命不同，混在一起以后想单独给分页换后端就拖泥带水。
 * 游标与总数的口径仍由 PageResult 定义，这一份只往上加一层来源交代。
 */
export type ReadPageResult = OpResult<PageResult> & {
  /** 这一趟读了什么：来源渠道、按字段组完整度、缺失字段组、耗时与取数开始版本。 */
  readonly provenance?: ReadProvenance
}

/**
 * 批量改色的逐条记账结果（`setLabelColors` 的返回）。
 * 入参里每一条改动必须**恰好**出现在 `applied` 或 `failed` 之一：不许漏记账，也不许两边都算。
 * 批量中途失败没有回滚，只给整体成败会让界面在部分成功时只能说谎。
 * `applied` 里的颜色是**这次写下去的目标颜色**，不是写完之后回读的值 —— 所以保存成功后，
 * 界面必须重新调一次列出标签拿真值刷新，不许乐观地把界面刷成用户填的那份。
 *
 * 为什么住在回值这一件而不是实体那一件：它要用到失败形状 `TrackerError`，
 * 而失败形状属于本件；放进实体会造成「实体引回值、回值引实体」的环。
 */
export interface LabelColorBatchResult {
  applied: { name: string; color: string }[]
  failed: { name: string; reason: TrackerError }[]
}

/** listLabels 的完整返回：标签清单 + 这一趟的来源与标签字段组完整度（#1686，成功即完整）。 */
export type LabelListResult = OpResult<LabelColor[]> & {
  /** 标签清单取不全时整条操作失败，所以成功分支的标签组必为 complete。 */
  readonly provenance?: ReadProvenance
}

/**
 * 一张地图的全部子票（`listSubIssues` 的返回）。
 *
 * 六个字段各自有读者，其中后四个是「有没有拿全」的诚实交代，缺一不可：
 * 一个地图子票成千上百时，界面必须能说清「还有更多、这次没全取回」，而不是悄悄少画几行。
 *
 * 为什么 `dropped` 与 `missing` 分开记：`missing` 是「总数与拿回来的一批对不上」，
 * `dropped` 是「拿回来的行里有几条当场被丢掉（形状不认识、编号解析不出来）」。
 * 后者是**已经拿到手却没算进去**的量，把它混进 `missing` 会让人以为是网络没给全，
 * 排查方向会整个跑偏到连接与分页上去。
 */
export interface SubIssueList {
  /** 子票行（契约 `Issue` 形状）。 */
  items: Issue[]
  /** 后端连接上说的总数。 */
  total: number
  /** 这一次真的拉回来的张数。 */
  fetched: number
  /** 是否撞到硬上限（撞到时界面要说清「还有更多，没全取回」）。 */
  capped: boolean
  /** 与总数对不上的差额（0 表示对上了）。 */
  missing: number
  /** 拿回来却被丢掉的行数（形状不认识、编号解析不出来）。 */
  dropped: number
}

/** listSubIssues 的完整返回：子票清单 + 这一趟的来源与子票/行两个字段组的完整度（#1686）。 */
export type SubIssueListResult = OpResult<SubIssueList> & {
  /** 撞 1000 张上限或还有下一页时子票组记截断；归一化丢行时行组记截断。 */
  readonly provenance?: ReadProvenance
}

/**
 * 放置标签配色文件的结果（`ensureLabelColorsFile` 的返回）。
 *
 * `placed: true` 表示这次真的新建或迁移了一份；`false` 表示文件已经在那儿、一个字没改
 * （这是最常见的一种成功，不是「没做成」）。
 * `reason` 是这次为什么是 `placed` 或为什么没动它（`created` / `migrated` /
 * `exists` / `migrate-legacy-kept` 等，词表在各后端的实现里）；`from` 记它原先是什么格式，
 * 只在「文件本来就在」时有值。这两项都是给人看与排查用的，调用方拿 `placed` 做判断即可。
 */
export interface LabelColorsFilePlacement {
  placed: boolean
  reason: string
  from?: string
}

/**
 * 地图薄行（`listMaps` 的行形状）。
 *
 * deck_context 首屏只画「地图有几张、每张叫什么、开着还是关了、点开去哪」，
 * 这一行就是这四个问题的答案，别的一律不带：不带正文、不带评论、不问它是不是
 * 拉取请求（那些是详情页与列表页的读者，不是首屏的）。
 */
export interface MapRow {
  /** 票号（`owner/repo#number` 或本地键），列表行的唯一键。 */
  key: string
  /** 标题原文。 */
  title: string
  /** 开关状态（`open` / `closed`），与契约 `Issue.state` 同词。 */
  state: string
  /** 票的地址（远端是网址，本地是盘上文件的路径；两处都非空）。 */
  url: string
}

/**
 * 全量地图薄行（`listMaps` 的返回）。
 *
 * 与 `listPage` 的区别只有一条：调用方不给筛选、不给游标、不给页大小，
 * 后端把「全部地图」一次交回来；分页、封顶、排序都在后端内部做完。
 * `truncated: true` 表示撞到封顶页数（这次没拿全），调用方必须把
 * 「只取回了前 N 张、共 M 张」说清，不许把半份当整仓。
 */
export interface MapListResult {
  /** 地图薄行（已按更新时间倒序排好，调用方不再重排）。 */
  rows: MapRow[]
  /** 同一口径下的总数（服务端标签筛中的张数，非负整数）。 */
  total: number
  /** 是否撞到封顶页数（撞到时界面要说清「还有更多，这次没取全」）。 */
  truncated: boolean
}

/** listMaps 的完整返回：地图薄行 + 这一趟的来源与行/标签两个字段组的完整度（#1686）。 */
export type MapListOpResult = OpResult<MapListResult> & {
  /** 撞封顶页数时行组记截断；单行标签到 50 条上限时标签组记截断。 */
  readonly provenance?: ReadProvenance
}
