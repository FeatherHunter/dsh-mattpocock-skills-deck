/**
 * src/tracker/contract/ports.ts —— 契约的形状层：面板与 deck 工具共用的那一份书面承诺
 *
 * ── 这一层是干什么的 ────────────────────────────────────────────────────────────
 * 九个 deck 工具调 `tracker.preflight`、`tracker.list` 的时候，从不问「你是 GitHub 还是
 * 本地 Markdown」。它们敢这么写，唯一的原因是有一份承诺摆在这里：不管哪个房间接手，
 * 都回答同样的方法、收同样的参数、回同样的形状。这份承诺就是本文件与 operations.ts。
 *
 * 承诺不在时会发生什么，仓库里有现成的反例：面板里那些「这个后端做不到某个操作」的提示，
 * 每一处都得靠调用方自己判后端是谁、有没有这个能力 —— 那正是「能力表」的来路，
 * 而 G5 红线定死不做能力表（能力 = 运行时调用结果：能做的返回数据，不能做的当场返回
 * unsupported，绝不事先声明一份清单）。承诺写进类型后，「能做什么」由编译器盯，
 * 运行时只留「这一次做没做成」这一件事。
 *
 * ── 谁实现、谁消费 ──────────────────────────────────────────────────────────────
 * 实现方（房间）：GitHub 房 `src/host/tracker/backends/github/`、本地 Markdown 房
 *   `src/host/tracker/backends/markdown/`。两房都要 `implements Tracker`；写错编译期就报，
 *   不必等运行时才发现某个方法少了一个参数。GitLab 房本轮不在改造范围内（只留位置）。
 * 消费方：deck 九个工具（经共享壳选后端后直接调）、注册表 `registryCore.js`、宿主电话与面板。
 *
 * ── 今天这份承诺住在哪里（迁移关系，必须知道） ──────────────────────────────────
 * 运行时的真源今天仍是 `src/host/tracker/contract.js` 与它的三份续篇
 * （`contract-label-colors.js`、`contract-page.js`、`contract-idempotency.js`），
 * 用的是 JSDoc 注释。本目录是它的 TypeScript 版本，两者暂时并存：**改一处必须改另一处**，
 * 直到 contract.js 退休（退休时点由迁移批次定）。形状的语义一个字都没改，只换了写法。
 *
 * ── 三条不变量（改了就是破坏承诺，不是「优化」） ────────────────────────────────
 * 1. **失败是返回值，不是异常**：任何操作失败都回 `OpResult` 的失败那一支，
 *    `error.kind` 取本文件 `ErrorKind` 里的值。房间抛异常会让上层两条写路径同时开火
 *    （工具退回去调 gh 命令行），这是真机上出过的事故形态，不是理论风险。
 * 2. **字段要么永远在、要么按能力省略**：核心字段（key/title/state/body…）永远存在，
 *    来源给不了就用确定空值（`''`/`null`）补齐；能力字段（labels/assignees/comments…）
 *    能实现就给值或给 EMPTY（`[]`），不能实现就**整个字段省略**（MISSING）。
 *    空数组与「没有这个能力」是两件事，界面靠这个区别说话。
 * 3. **没有 detect，也没有能力清单**：身份识别是 `matches`（布尔）+ 注册表的三级仲裁
 *    + `describe`（出仓库引用）。谁要在这里加一个 `detect()` 或 `supportedOps`，
 *    等于把已经拆掉的第二真源重新建起来。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 一、身份与枚举：一律写成开放 string 或字面量联合，不写 enum
//
// 为什么不用 TypeScript 的 enum：enum 会产出运行时代码（多一个对象、多一层查找），
// 而本目录要守住「零运行时实现」——真源仍是 constants.js 里的 Object.freeze 常量。
// 用字面量联合的好处是编译期能查错，运行时一个字节都不多。
// 为什么 BackendId 是开放 string 而不是 'github'|'markdown'|'gitlab'：第三方后端要能注册，
// 写死三个就把门焊死了（'other' 这个保留串已弃用，不注册）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 后端 id：开放字符串，仓库内唯一。
 * 一等内置是 `'github'`、`'markdown'`、`'gitlab'`；`'other'` 已弃用、不再注册。
 * 表达「没有后端」只能用 `Selection.backendId: null`，**不许**造一个假 id。
 */
export type BackendId = string

/** 归一化后的票状态：只有两态。GitHub 原值是大写 OPEN/CLOSED，由各房在 normalize 阶段转小写。 */
export type State = 'open' | 'closed'

/** 票的种类：普通票或地图（wayfinder 语义）。 */
export type IssueType = 'issue' | 'map'

/**
 * 关闭原因：开放字符串，原样透传不分支。
 * 插件自己认得并收进保留表的只有 `completed` 与 `duplicate` 两个；GitHub 那边还会出现
 * `not_planned` 等取值，照原样展示即可，不要在这里加分支。
 * 只在 `state === 'closed'` 时有意义；开放着的票依后端支持给 `''`（EMPTY）或省略（MISSING）。
 */
export type ClosedReason = string

/** 参与人种类：开放字符串，保留值 `user` / `bot` / `organization`（识别机器人代理对 deck 认领有意义）。 */
export type ActorKind = string

/**
 * 操作失败的分类，取值与 `src/shared/tracker/constants.js` 的 `ERROR_KIND` 逐字一致：
 * - `env` 本机环境缺东西（工具没装、路径不存在）
 * - `auth` 没登录、凭据失效、没有权限
 * - `rate-limit` 被限流（注意是小写短横线，旧写法 `rateLimit` 已废弃）
 * - `conflict` 写前置失败或图不变量被违反（If-Match 不匹配、阻塞边成环、自环）
 * - `unsupported` 这个后端不实现这个操作（注册表自动补的桩返回的就是它）
 * - `not-found` 资源不存在（对应 GitHub 404）
 * - `network` 连不通、超时、请求半路断掉
 * - `parse` 拿回来的东西解析不了
 *
 * 分类决定界面怎么说话（引导登录 / 提示稍后 / 说明做不到），所以**不许新增取值**；
 * 真要加，先改 constants.js 与这份联合类型，两处一起。
 */
export type ErrorKind =
  | 'env'
  | 'auth'
  | 'rate-limit'
  | 'conflict'
  | 'unsupported'
  | 'not-found'
  | 'network'
  | 'parse'

// ─────────────────────────────────────────────────────────────────────────────
// 二、实体形状：票、标签、评论、参与人
//
// 这些形状今天住在 `src/shared/tracker/shape.js`（JSDoc），宿主与客户端共用。
// 写在这里是为了让契约自洽：operations.ts 的每个操作都要引用它们。
// 迁移时 shape.js 的去留另定（它服务的读者比契约层更宽），本轮不动它。
// ─────────────────────────────────────────────────────────────────────────────

/** 参与人（票的作者、指派人、评论作者都用它）。 */
export interface Actor {
  /** 登录名；本地 Markdown 是本地用户名或 `''`。 */
  login: string
  /** 机器人/组织标记，见 `ActorKind`；认不出来就省略。 */
  kind?: ActorKind
  /** 显示名，没有就省略。 */
  name?: string
  /** 头像地址；本地后端没有就省略。 */
  avatarUrl?: string
}

/** 一个标签。 */
export interface Label {
  /** 标签名，**原样**返回（不做大小写折叠；名字里可以有冒号与空格，例如 `wayfinder:map`）。 */
  name: string
  /** 颜色，不带井号的六位小写十六进制（例：`8b5cf6`）；后端给不了颜色就写 `''`。 */
  color: string
  /** 可选的说明文字；后端给不了就整个字段省略。 */
  description?: string
}

/** 一条评论。 */
export interface Comment {
  /** 评论 id（用于串接与追踪编辑）；后端给不了就省略。 */
  id?: string
  /** 谁写的。 */
  author: Actor
  /** 作者与仓库的关系，GitHub 是 OWNER/MEMBER/CONTRIBUTOR/NONE，本地是 `''`。 */
  authorAssociation: string
  /** 评论正文（Markdown 原文，渲染由宿主负责）。 */
  body: string
  /** 创建时间（ISO 字符串）；给不了写 `''`。 */
  createdAt: string
  /** 最后更新时间；给不了写 `''`。 */
  updatedAt: string
  /** 编辑时间；从来没有编辑过就省略或给 `null`。 */
  editedAt?: string | null
}

/** 里程碑。 */
export interface Milestone {
  name: string
  description?: string
  state?: 'open' | 'closed'
  /** 到期日；没有就 `null`。 */
  dueOn?: string | null
}

/**
 * 结构化自定义字段。
 * ⚠️ 这是**说明性元数据，绝不驱动 deck 逻辑**：界面上可以显示，任何判定都不许读它。
 */
export interface CustomField {
  name: string
  value: string | number | boolean | null
  /** 字段类型（开放字符串），保留值 `text` / `number` / `date` / `single` / `multi`。 */
  type: string
  /** 单选/多选的候选值。 */
  options?: string[]
}

/** 拉取请求的一条评审记录（只读快照）。 */
export interface Review {
  /** 评审结论（开放文字），保留写法 `approved` / `changes_requested` / `commented` / `dismissed`。 */
  state: string
  /** 给出这条评审的人；没有就不写这个字段。 */
  reviewer?: Actor
  /** 给出评审的时间；没有就不写这个字段。 */
  submittedAt?: string
}

/**
 * 票/图的轻量引用（不递归展开），用于阻塞关系与子票清单。
 * `key` 的解析范围是**引用方所在的工作单元（effort）**：本地 Markdown 的 `Blocked by:`
 * 只在同一个 effort 里找同号票，跨 effort 的同号票是两张不同的票。
 */
export interface IssueRef {
  /** 规范 id：GitHub 是编号字符串，本地 Markdown 是两位数编号，GitLab 是 iid。 */
  key: string
  title: string
  /** 归一化后的两态。 */
  state: State
  /** 边上带种类时给出（指向地图还是票）。 */
  type?: IssueType
}

/**
 * 票/图的完整实体。
 *
 * 核心字段**永远存在**（缺了用 `''`/`null` 补齐），能力字段**可以整个省略**（= 没有这个能力）：
 * - 核心：key、effortId、type、title、state、body、url、createdAt、updatedAt、closedAt、parentKey
 * - 能力：author、assignees、labels、milestone、customFields、reason、blockedBy、comments、
 *   isPullRequest、mergedAt、reviews
 *
 * ⚠️ `blocking`（我阻塞了谁）**不许**作为 Issue 的字段：它是 `blockedBy` 的反向派生，
 * 只允许出现在 `getDependencies` 的返回值里。放进来就是第二真源，两处迟早对不上。
 */
export interface Issue {
  /** 规范 id，**在本工作单元内**唯一；全局身份是 (仓库引用, effortId, key) 三元组。 */
  key: string
  /**
   * 这张票属于哪个工作单元（核心字段，永远存在）。
   * 本地 Markdown 是 `.scratch/<工作单元>/` 的目录名；单工作单元的后端（GitHub/GitLab）写 `''`。
   * 父子关系与阻塞引用都按它圈定范围，不跨工作单元解析。
   */
  effortId: string
  /** 票的种类。 */
  type: IssueType
  title: string
  state: State
  /** 正文（Markdown 原文）；宿主负责渲染，后端不产出渲染结果。 */
  body: string
  /** 可点开的链接；本地后端没有链接就写 `''`。 */
  url: string
  /** 创建时间；没有写 `''`。 */
  createdAt: string
  /** 更新时间；没有写 `''`。 */
  updatedAt: string
  /** 关闭时间；没有关闭就是 `null`。 */
  closedAt: string | null
  /** 父地图的 key；根票是 `null`（核心字段，永远存在）。 */
  parentKey: string | null
  author?: Actor
  /** 指派人（认领）；`[]` 表示明确「没人认领」，整个字段省略表示「认领状态未知」。 */
  assignees?: Actor[]
  /** 标签；`[]` 表示有能力但没标签，省略表示这个后端给不了标签。 */
  labels?: Label[]
  milestone?: Milestone
  customFields?: CustomField[]
  /** 关闭原因，只在 `state === 'closed'` 时有意义。 */
  reason?: ClosedReason
  /** 谁阻塞我（入边，唯一真源）。 */
  blockedBy?: IssueRef[]
  /** 评论（决策记录）。 */
  comments?: Comment[]
  /** 是不是拉取请求：能判断就写 true/false，判断不了就省略这个字段。 */
  isPullRequest?: boolean
  /** 合并时间，还没合并是 `null`；没有拉取请求能力的后端省略。 */
  mergedAt?: string | null
  /** 评审细分，没有评审给 `[]`；没有拉取请求能力的后端省略。 */
  reviews?: Review[]
}

/**
 * 归一化后的目标仓库（选定后端之后的身份）。
 * `backend` 是**非空**开放字符串；「没有后端」只走 `Selection.backendId: null`，
 * 那种情况下不产出本对象（不许造假身份）。
 */
export interface RepositoryRef {
  backend: BackendId
  /** 稳定标识：GitHub/GitLab 是 `owner/name`，本地 Markdown 是路径。 */
  refId: string
  /** 显示名（界面上那一行字）。 */
  name: string
  /** 远端地址；本地是 `''`。 */
  url: string
  /**
   * 可选的寻址范围：省略 = 这个仓库的全部工作单元（列表用）；给出 = 只针对这一个工作单元读写。
   * 为什么放在仓库引用上、而不是给每个操作加一个参数：操作签名已经定版，
   * 给 comment/reopen/update 加形参会把调用上下文挤位、破坏既有后端实现。
   */
  effortId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、调用上下文：进程级能力与单次调用上下文
//
// 这两层的分工是本契约最容易搞混的地方：`BackendContext` 是「这台机器能干什么」，
// 房间 create 的时候注入一次；`OpContext` 是「这一次调用是谁、在哪个目录、
// 能不能中途取消」，每次操作都新给一份。房间实现里凡是碰目录、碰信号的，
// 都必须读 `OpContext`，不许把 create 时的上下文当成这一次的。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 进程级能力（房间 create 时注入一次；宿主构建单例）。
 * 房间**不许**直接 `import node:fs` 或直接用全局 `fetch`：文件读写走 `fs`（受沙箱约束）、
 * 起进程走 `exec`（受闸记账）、定时器走 `timers`（测试要能替换假时钟）。
 */
export interface BackendContext {
  /** 平台抽象实例（已按当前操作系统解析好的那一个，不是工厂）。 */
  platform: unknown
  /** 沙箱文件服务（受栅栏约束，不能绕过它直连 node:fs）。 */
  fs: unknown
  /**
   * 起一个进程并等它结束。
   * 真实实现在宿主侧，会把每一笔出站报给闸记账；返回三件套而不是抛异常。
   */
  exec: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeout?: number; signal?: AbortSignal },
  ) => Promise<{ stdout: string; stderr: string; code: number }>
  /** 定时器（测试注入假时钟用；房间不许直接摸全局 setTimeout）。 */
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
  /**
   * 房内结构化日志（防火即发：只把这一行放进内存队列就返回，不等写盘）。
   * 事件名与字段按日志白名单，高频行必须先问 `isEnabled` 再组装字段。
   * @deprecated 旧字段 `log` 已退役（#494 O1），新埋点只走这里。
   */
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  /** 日志开关的同步判断（信息与调试级要不要记）；权威判断仍在日志库体内兜底。 */
  isEnabled: (level: string) => boolean
}

/**
 * 单次操作/匹配/选择用的上下文：进程级能力 + 这一次调用的现场。
 * 注意这是**交叉类型**而不是另起一个对象：运行时它就是 `BackendContext` 的超集
 * （注册表构造匹配上下文时把两者合并成一份）。
 */
export type OpContext = BackendContext & {
  /** 这一次调用针对的工作区目录。 */
  cwd: string
  /** 中止信号：调用方放弃（超时、用户取消）时房间应当尽快停下。 */
  signal: AbortSignal
  /** 已经解析出来的仓库标识；给不出就省略。 */
  refId?: string
}

/**
 * 探测输入（识别后端时给的那一点点线索）。
 * 界面**从不**手拼 `refId`：`refId` 由注册表的 describe 产出。
 */
export interface RepoHandle {
  /** 工作区目录；`matches` 只许读它（以及文件服务）。 */
  cwd?: string
  /** 已经解析好的仓库标识；给了就直接用。 */
  refId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、返回值：失败是值不是异常
// ─────────────────────────────────────────────────────────────────────────────

/** 统一的失败形状。`message` 是给人看的一句话，允许直接展示。 */
export interface TrackerError {
  kind: ErrorKind
  message: string
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
  /** 这个结论是怎么来的：显式选择 / 命中 / 兜底（没有 `detect` 这个取值，历史写法已改）。 */
  source: 'explicit' | 'matches' | 'fallback'
  /** `backendId` 不为 null 时给出的仓库身份。 */
  ref?: RepositoryRef
  /** 同时命中的多个后端（平局按注册顺序取第一个，这里如实全部给出）。 */
  multiHit?: BackendId[]
  /** 识别有超时未决。 */
  pending?: true
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、各操作的入参与选项
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 列出票时的过滤器。
 * 各字段都是可选：省略表示不按这一项收窄。`parentKey: null` 与省略不同 ——
 * 前者明确要「根票」，后者是「全部」（含子票）。
 */
export interface ListFilter {
  /** 只要某一类（票或地图）。 */
  type?: IssueType
  /** 只要某一种状态。 */
  state?: State
  /** `null` = 只要根票；省略 = 全部。 */
  parentKey?: string | null
  /** 批量按编号取。 */
  keys?: string[]
  /** 只要拉取请求（界面上的拉取请求过滤器用）。 */
  isPullRequest?: boolean
}

/** 读单票的选项（今天只有评论分页一项）。 */
export interface GetOpts {
  /** 评论分页：要前几条、从哪个游标之后开始。 */
  comments?: { first: number; after?: string }
}

/** 批量取阻塞关系的选项。 */
export interface DepsOpts {
  /** 一次问多个编号（宿主对结果做缓存）。 */
  keys?: string[]
}

/**
 * 依赖投影（便利视图，**不是第二真源**）。
 * `blockedBy` 是唯一真源；`blocking`（我阻塞了谁）是它的反向聚合，由后端或宿主演算得出。
 */
export interface Dependencies {
  blockedBy: IssueRef[]
  /** 反向投影：便利字段，任何判定都不许只信它。 */
  blocking: IssueRef[]
}

/** 建票的输入。 */
export interface CreateInput {
  title: string
  body?: string
  type?: IssueType
  /** 挂在哪个地图下面；根票给 `null` 或省略。 */
  parentKey?: string | null
  labels?: LabelInput[]
  assignees?: AssigneeInput[]
  /**
   * 创建幂等锚（可选）。
   * 要解决的问题只有一句：票已经建成了，只是调用方没收到回答 —— 超时、EOF、退出码非 0
   * 却已经写进去了，外层一重试就多一张票。给了锚之后，同一个锚提交两次只会多出一张票、
   * 两次拿到同一个 key。
   * 键只允许字母、数字、点、下划线、连字符、冒号、斜杠，最长 200 字符；不合规当场按
   * `parse` 失败，**不做清洗**（清洗过的键与调用方手里那个就不是同一个串了）。
   * 回查拿不准时必须如实失败、绝不建票：「拿不准」当成「没找到」正是重复建票的来路。
   * 不传这个字段时，行为与没有它之前完全一样。
   */
  idempotencyKey?: string
}

/** 关票的选项。 */
export interface CloseOpts {
  /** 关闭原因；不传就看后端默认。 */
  reason?: ClosedReason
}

/**
 * 改票的补丁（多字段一次原子写）。
 * 一个字段都不给时不该发写请求（那是空操作，白花一次配额）。
 */
export interface UpdatePatch {
  title?: string
  body?: string
  milestone?: Milestone | null
  customFields?: CustomField[]
}

/**
 * `setLabels` / `setAssignees` / `setParent` / `setBlockedBy` 的公共选项。
 * `expectedUpdatedAt` 是乐观并发控制：与后端当前的更新时间对不上就返回 `conflict`，
 * 不做「后写覆盖先写」。
 */
export interface SetOpts {
  expectedUpdatedAt?: string
}

/**
 * 标签输入：可以只给名字（`'bug'`），也可以给完整形状。
 * 房间实现要把裸字符串归一成 `{name, color: ''}` 那种形状再用。
 */
export type LabelInput = string | { name: string; color?: string; description?: string }

/** 指派输入：可以只给登录名（`'octocat'`），也可以给完整形状。 */
export type AssigneeInput =
  | string
  | { login: string; kind?: ActorKind; name?: string; avatarUrl?: string }

/**
 * 计数结果（`counts` 操作）。
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
 * 初始化并发布工作区的输入。
 * ⚠️ 这个类型在今天的 `contract.js` 里**被引用但没有定义**（第 50 行的 initProject 签名引了
 * 一个不存在的 `InitProjectInput`），全仓也搜不到定义。这里按实现里的真实用法补出来：
 * `backends/github/init-project.js:27-28` 读的就是 `name` 与 `visibility` 两个字段。
 * 形状以那一处为准；将来若改发布流程的入参，两处一起改。
 */
export interface InitProjectInput {
  /** 仓库名（不含拥有者）；只允许字母、数字、点、下划线、连字符，最长 100。 */
  name: string
  /** 可见性；省略按私有处理（实现里的默认值就是私有）。 */
  visibility?: 'public' | 'private'
}

/** 按页取票的选项。 */
export interface PageOpts {
  /** 上一页给回来的不透明游标；第一页省略或给空串。调用方**不许**自己解析或拼装它。 */
  cursor?: string
  /** 一次要几行；缺省 50，超过 200 按 200 处理（要多了不报错，按上限给）。 */
  limit?: number
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

// ─────────────────────────────────────────────────────────────────────────────
// 六、标签配色（两条操作专用形状）
//
// 这两条是「标签颜色可编辑」的全部接缝：界面只跟它们打交道，不知道底下是 GitHub 的仓库标签，
// 还是本地工作区里那个用户可以自己手改的配色文件。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一条标签与它的颜色。
 * 颜色统一写成**不带井号的六位小写十六进制**；空串表示「这个标签还没配颜色」，
 * 界面按灰色显示 —— 「能返回颜色但不知道颜色」是空值，不是省略。
 * 列表项只许这三个键：不带「有多少张票在用这个标签」这类计数，也不带分组标记。
 */
export interface LabelColor {
  /** 标签名，原样返回（不折叠大小写；名字里可以有冒号与空格）。 */
  name: string
  /** 六位小写十六进制、不带井号；`''` 表示还没配颜色。 */
  color: string
  /** 说明文字；省略表示这个后端给不了。 */
  description?: string
}

/** 批量改色里的一条改动：标签名与新颜色。调用方只放**真正变了**的那些。 */
export interface LabelColorChange {
  name: string
  /** 新颜色（六位十六进制，大小写都收）；写进真源后由后端给回小写。 */
  color: string
}

/**
 * 批量改色的逐条记账结果。
 * 入参里每一条改动必须**恰好**出现在 `applied` 或 `failed` 之一：不许漏记账，也不许两边都算。
 * 批量中途失败没有回滚，只给整体成败会让界面在部分成功时只能说谎。
 * `applied` 里的颜色是**这次写下去的目标颜色**，不是写完之后回读的值 —— 所以保存成功后，
 * 界面必须重新调一次列出标签拿真值刷新，不许乐观地把界面刷成用户填的那份。
 */
export interface LabelColorBatchResult {
  applied: { name: string; color: string }[]
  failed: { name: string; reason: TrackerError }[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 七、房内扩展要用到的形状
//
// 三个房内扩展（getRepoPermissions / listSubIssues / ensureLabelColorsFile）的**接口形状**
// 写在同目录的 operations.ts 里；它们要用到的数据形状留在本文件，免得两个文件互相引用成环。
// ─────────────────────────────────────────────────────────────────────────────

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

