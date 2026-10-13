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
import type { Issue, IssueRef, RepositoryRef } from './entities.js'

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
 *   取法只有一处 —— `fail(kind, message, raw)`（`src/tracker/preflight.ts`），
 *   由它统一做多路合并、凭据遮蔽与头尾截断；决策见
 *   `docs/adr/20261014-error-classification-single-source.md`。
 */
export interface TrackerError {
  kind: ErrorKind
  message: string
  raw: string
}

/**
 * 统一返回形状：一次调用要么成功带数据，要么失败带原因，没有第三种。
 * 用可辨识联合而不是 `{ok: boolean, data?, error?}`，是为了让调用方在 `if (!r.ok)` 之后
 * 拿 `r.error` 时编译器知道它一定在（那种「两个字段都可能没有」的写法，
 * 正是仓库里若干 `res.error && res.error.message` 兜底的来路）。
 */
export type OpResult<T> = { ok: true; data: T } | { ok: false; error: TrackerError }

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
   * 结论的具体出处（比 source 更细一档）：`user-memory-bind`（本次进程内人亲手绑定）、
   * `user-file` / `migrated` / `detected`（工作区配置文件里的三种来源）、`declaration`（仓库里的说明文件）、
   * `autodetect`（自动识别）、`unknown-workspace`（还没认出目录）、`pending` / `none`（没有结论）。
   * 界面与排查读它说清「这个答案凭什么」，不要拿 source 反推。
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
