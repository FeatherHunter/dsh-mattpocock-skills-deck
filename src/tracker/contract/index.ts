/**
 * tracker/contract.js — Tracker 接口 + 归一化约定（主缝）。
 *
 * 第一性原理（#124/#125 定版）：
 *  - **能力 = 事后的事实**，不是事先的断言：op 能做→返回数据；不能→`{ok:false,error:{kind:'unsupported'}}`。
 *    无能力表、无 capability 缓存、无运行期内省（G5）。
 *  - **失败返回而非抛**；错误分类统一 `TrackerError{kind,message}`。`kind:'conflict'` 由后端显式产生
 *    （If-Match 不匹配 / setBlockedBy 自环成环），非 regex 派生。
 *  - `OpName` **无 `detect`**（身份识别 = `matches`(boolean) + `select`(仲裁) + `describe`(出 ref)）；
 *    含 `getDependencies`；`snapshot`/`children` **不是 op**（宿主编排便利函数，见 snapshot.js）。
 *  - 上下文分离：`BackendContext`（进程级能力，create 用）/ `OpContext`（每 op / matches / select 用）。
 *
 * 一个「后端 = 一个实现本接口的适配器」。UI/宿主只通过本接口访问 tracker，不知道后端是谁。
 * 各后端（github/markdown/gitlab/第三方）严格对照本契约实现；只能做一部分就用 Proxy 桩顶（registry.js）。
 */

import { STATE, ISSUE_TYPE, ERROR_KIND, CONTRACT_VERSION } from './vocabulary.js'
import { OPERATIONS as CATALOG_OPERATIONS } from './operations-catalog.js'

/**
 * Tracker 接口。实现方（后端适配器）应提供需要的操作；不能实现的按规则返回 unsupported
 * 或省略字段，不硬装（诚实 = 不捏造类别、不假装身份）。
 *
 * ⚠️ 后端不许有独有对外方法（2026-10-14 定，原「非 op 旁路豁免」那条规矩已作废）：
 * 上一版允许实现方附加**不进 OPERATIONS** 的旁路方法（如 `snapshotFast`），只当「读路径实现细节」豁免。
 * 那条口子已经关掉：一个后端能有契约里没有的对外方法，上层要用它就必须先问「你是哪个后端」，
 * 而「上层敢对后端一无所知」正是这一层要买的东西。要加能力，先改 `operations-catalog.ts` 与
 * `operations.ts`（进 `Tracker`），再实现；不能实现就如实回 `unsupported`，不许换个名字偷偷提供。
 *
 * ⚡ op 实现者义务：返回合规 OpResult；registry 不做运行时结果校验（能力零推断，G5）。
 *
 * @typedef {Object} Tracker
 * @property {import('../../shared/tracker/shape.js').BackendId} id 后端 id（= 注册时的 BackendId）
 *
 * @property {(handle: RepoHandle, ctx: OpContext) => Promise<PreflightResult>} preflight 环境门禁（只判环境：工具在不在/登录/可达/fs;不预判能力）
 * @property {(repo: RepositoryRef, filter?: ListFilter, ctx: OpContext) => Promise<import('./results.js').IssueListResult>} list 列票；返回里带「名单全不全」（truncated）与「走没走 REST 降级」（fallback/fallbackReason）
 * @property {(repo: RepositoryRef, filter?: ListFilter, ctx: OpContext) => Promise<OpResult<Counts>>} counts 这个后端里符合条件的票有多少张（工单口径，不含拉取请求；只回数字不回行，语义见下方「计数契约」）
 * @property {(repo: RepositoryRef, filter?: ListFilter, opts?: PageOpts, ctx: OpContext) => Promise<OpResult<PageResult>>} listPage 按页取票（「已关闭票按需浏览」用；排序键固定创建时间倒序；取回来的行是薄片段，不带正文与评论。语义见 contract-page.js 的「分页契约」）
 * @property {(repo: RepositoryRef, key: string, opts?: GetOpts, ctx: OpContext) => Promise<OpResult<Issue>>} get
 * @property {(repo: RepositoryRef, key: string, opts?: DepsOpts, ctx: OpContext) => Promise<OpResult<Dependencies>>} getDependencies 便利投影（blockedBy 唯一真源；blocking 反向聚合）
 * @property {(repo: RepositoryRef, input: CreateInput, ctx: OpContext) => Promise<OpResult<Issue>>} create
 * @property {(repo: RepositoryRef, key: string, opts?: CloseOpts, ctx: OpContext) => Promise<OpResult<Issue>>} close
 * @property {(repo: RepositoryRef, key: string, ctx: OpContext) => Promise<OpResult<Issue>>} reopen
 * @property {(repo: RepositoryRef, key: string, body: string, ctx: OpContext) => Promise<OpResult<Comment>>} comment
 * @property {(repo: RepositoryRef, key: string, patch: UpdatePatch, ctx: OpContext) => Promise<OpResult<Issue>>} update
 * @property {(repo: RepositoryRef, key: string, labels: LabelInput[], opts?: SetOpts, ctx: OpContext) => Promise<OpResult<Issue>>} setLabels
 * @property {(repo: RepositoryRef, key: string, assignees: AssigneeInput[], opts?: SetOpts, ctx: OpContext) => Promise<OpResult<Issue>>} setAssignees
 * @property {(repo: RepositoryRef, key: string, parentKey: string|null, opts?: SetOpts, ctx: OpContext) => Promise<OpResult<Issue>>} setParent
 * @property {(repo: RepositoryRef, key: string, blockers: string[], opts?: SetOpts, ctx: OpContext) => Promise<OpResult<Issue>>} setBlockedBy self∈blockers→conflict；写后环检，成环→conflict 不落盘
 * @property {(repo: RepositoryRef, ctx: OpContext) => Promise<OpResult<LabelColor[]>>} listLabels 标签配色：列出「这个后端能改色的全部标签」及其颜色（#627，见下方「标签配色契约」）
 * @property {(repo: RepositoryRef, changes: LabelColorChange[], ctx: OpContext) => Promise<OpResult<LabelColorBatchResult>>} setLabelColors 标签配色：批量改色，逐条记账（#627，见下方「标签配色契约」）
 * @property {(repo: RepositoryRef, ctx: OpContext) => Promise<OpResult<import('../../shared/tracker/shape.js').Actor>>} getCurrentUser 当前登录人（viewer），GitHub 返回 Actor，Markdown/GitLab 返回 unsupported（MISSING）
 * @property {(handle: RepoHandle, input: InitProjectInput, ctx: OpContext) => Promise<OpResult<RepositoryRef>>} initProject 工作区初始化并发布（git init→commit→gh repo create→push；错误分类 no-git/no-gh/not-logged-in/already-exists/network/permission；GitHub 完整实现，本地 Markdown 与 GitLab 回 unsupported）
 *
 * @property {(repo: RepositoryRef, ctx: OpContext) => Promise<OpResult<import('./results.js').RepoPermissions>>} getRepoPermissions 问仓库写权限（push/triage 两个布尔）；GitHub 真去问，本地 Markdown 与 GitLab 回 unsupported。调用方拿不到就按「未知」处理，不许当成「能写」
 * @property {(repo: RepositoryRef, mapKey: string, opts: Record<string, never>|undefined, ctx: OpContext) => Promise<OpResult<import('./results.js').SubIssueList>>} listSubIssues 取一张地图的全部子票（翻页拉到底，1000 张硬上限）；返回里 capped/missing/dropped 三项是「有没有拿全」的诚实交代。GitHub 实现，本地 Markdown 与 GitLab 回 unsupported
 * @property {(repo: RepositoryRef, ctx: OpContext) => Promise<OpResult<import('./results.js').LabelColorsFilePlacement>>} ensureLabelColorsFile 往工作区放一份用户可手改的默认标签配色文件（文件已存在时一个字都不改）；本地 Markdown 实现，GitHub 与 GitLab 回 unsupported
 * @property {(ctx: OpContext) => Promise<OpResult<import('../session/budget-reading.js').BudgetReading>>} readBudget 读缓存里的剩余额度，只读不花（规格 1439 第 23 条操作）；永远放行、不记账，直达房间
 *
 * 定位口三条（没有「我不支持」这种答案，缺席就是缺席，调用方拿空值往下走）：
 * @property {(cwd: string, ctx: OpContext) => Promise<{owner: string, name: string}|null>} getRepoKey 从工作区目录解析出 owner/name；解析不出来回 null（不是异常）。只有需要连远端的后端才有
 * @property {(handle: RepoHandle, backendId?: string) => import('../../shared/tracker/shape.js').RepositoryRef} describe 产出仓库身份（实例版；与模块对象上同名方法同义，供注册表视图的回退链取用）
 * @property {(ref: import('../../shared/tracker/shape.js').RepositoryRef, key: string) => string} issueAddress 一张票在这个后端里的地址（实例版；本地后端算不出票文件名，诚实回空串，见 #1144）
 */

/**
 * 操作名清单（= OpName；能力零声明，只有动词）。
 * 无 detect（身份=matches+select+describe）；无 snapshot/children（宿主编排便利，非契约）。
 *
 * 单源说明：数组字面量只在 `operations-catalog.ts` 写一次（它是名录的唯一真源，
 * `operations.ts` 的 `OpName` 也从它生成）。这里只转出口径——注册表与 `TRACKER_CONTRACT`
 * 过去读的一直是 `readonly string[]` 这一口径（原来那份 `Object.freeze` 的结果），直接把窄元组
 * 转出去会让 `OPERATIONS.includes(某个字符串)` 这类调用在类型上变窄而编译不过，
 * 所以这里标宽到 `readonly string[]` 再转出。
 * `Object.freeze` 留着：原来那份就是冻住的，金标准夹具断言它冻住（改了口径不改行为）。
 * 冻的是同一份数组（名录那份），不产生第二份拷贝。
 *
 * 这里只是**操作**那一半（23 条，规格 1439 起含读预算）。另有三条定位口（`getRepoKey` / `describe` / `issueAddress`）
 * 不进这份数组：它们没有「我不支持」这种答案，注册表不替它们补桩，`includes` 判据也不适用。
 * 两半合起来是 `CAPABILITIES`（26 条，见 `operations-catalog.ts`）。
 */
export const OPERATIONS: readonly string[] = Object.freeze(CATALOG_OPERATIONS)

/**
 * 统一错误形状（所有操作失败都归一化成这个，**返回**不 throw）。
 * 真源是 `contract/results.ts` 里的 `TrackerError`（TypeScript 侧那份带必填校验）；
 * 这里这份是给还用注释当类型的手写旧语言文件看的同一份形状说明，两处必须同形。
 * @typedef {Object} TrackerError
 * @property {import('./vocabulary.js').ERROR_KIND} kind 分类：env/auth/rate-limit/conflict/unsupported/not-found/network/parse
 * @property {string} message 给人看的一句话（允许直接展示；不要把原文塞进来）
 * @property {string} raw 后端或命令吐出的原文（**必填**，确实没有原文时给空串）。分类是启发式的、
 *   可能猜错，原文是让人自己判断的兜底；取原文只有一处实现：`preflight.ts` 的 `fail(kind, message, raw)`，
 *   由它统一做多路合并（stderr → message → stdout → text）、凭据遮蔽与头尾截断。
 */

/**
 * 统一返回形状（一次性成功或失败；失败返回而非抛）。
 * @template T
 * @typedef {{ok: true, data: T} | {ok: false, error: TrackerError}} OpResult
 */

/**
 * 进程级能力（BackendModule.create 时注入；host 单例构建）。
 * @typedef {Object} BackendContext
 * @property {Object} platform 平台抽象实例（#113：已依 process.platform 解析的实例，非工厂）
 * @property {Object} fs DSH 沙箱 fs（受栅栏约束，不可直通 node:fs）
 * @property {(cmd: string, args: string[], opts?: {cwd?: string, timeout?: number, signal?: AbortSignal}) => Promise<{stdout: string, stderr: string, code: number}>} exec
 * @property {{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}} timers
 * @property {Object} [log] 已退役（#494 O1：backend.diagnostic 不再产生；房内旧文本调用已清零，残留调用自动静默；新埋点只走 logEvent）
 * @property {(level: string, event: string, fields: Object) => void} logEvent 房内结构化日志（防火即发；事件名与字段按 #489 附录第 1 节白名单，#491 房内票用）
 * @property {(level: string) => boolean} isEnabled 开关同步判断（P1 外层判断用；权威仍是库体内兜底）
 */

/**
 * 每 op / matches / select 用（继承进程级能力 + 本次调用上下文）。
 * 交叉类型（不是别名）：实际运行时是 BackendContext 字段的超集（见 registry.js matchCtx 构造）。
 * @typedef {BackendContext & {cwd: string, signal: AbortSignal, refId?: string}} OpContext
 */

/**
 * 探测输入（client 发送；UI 从不手拼 refId——refId 生成归 host/registry.describe）。
 * @typedef {Object} RepoHandle
 * @property {string} [cwd] 工作区目录（matches 只读 cwd/fs）
 * @property {string} [refId] 可空；已解析则直接当 refId 用
 */

/**
 * 一级后端模块（第三方注册写什么；registry.js 负责 Proxy 补桩与校验）。
 * @typedef {Object} BackendModule
 * @property {import('../../shared/tracker/shape.js').BackendId} id 唯一开放 string（推荐 publisher.name）；内置 github/markdown/gitlab；'other' 弃用不注册
 * @property {string} label 显示名（UI：已知→徽标；未知→原串不分支）
 * @property {(ctx: BackendContext) => Partial<Tracker>} create 只实现真会的；缺的方法由 registry Proxy 补 unsupported 桩
 * @property {(handle: RepoHandle, ctx: OpContext) => boolean} matches 启发式 boolean（读 .scratch/map.md / git remote / issue-tracker.md）；不确定一律 false + 记 diagnostics
 * @property {(handle: RepoHandle, backendId: string) => import('../../shared/tracker/shape.js').RepositoryRef} [describe] 可选：出 RepositoryRef（refId/name/url）；未提供时注册表给一个不带地址的骨架（refId 取 handle 自带的，没有就拿本地文件后端的 cwd；url 一律空），不另猜地址
 * @property {(ref: import('../../shared/tracker/shape.js').RepositoryRef, key: string) => string} [issueAddress] 可选：票的地址（如 GitHub 的 https://github.com/{refId}/issues/{key}、GitLab 的 https://gitlab.com/{refId}/-/issues/{key}）。地址形状由本后端自己说了算；注册表只转发，没提供时回空串，不替任何后端拼地址（#1112）。本地 Markdown 算不出票文件名，这条回空串，票的地址改由票自己的 url 字段带出来（#1142 / #1144）。名字与后端无关（#1110 实现决定第 14 条）：路径也是地址，本地这条曾经给的是票文件路径，所以不叫「网址」
 * @property {(name: string) => string} [repoSearchAddress] 可选：按仓库名找仓库的地址（如 GitHub 的 https://github.com/search?q=...）；本地后端没有全站搜索页，回空串（#1112）
 * @property {RegExp|string} [issueRefPattern] 可选：在这个后端的文本里认出票引用的写法；注册表只转发，没提供时回 null，不替任何后端造正则（#1112）
 * @property {{trackerLine: string, trackerChoice: string, backendNote: string, labelReqs: string}} [setupPrompt]
 * @property {{name: string, color: string}[]} [labelPalette] 可选：后端自己的默认标签调色盘（#323 定版复核——本地 Markdown 提供，结构/label/颜色真源；GitHub/GitLab 不声明；面板按 模块默认 + 工作区表覆盖 查色）
 * @property {{issueUrlTemplate?: string, repoUrlTemplate?: string, searchUrlTemplate?: string, linkPatternSource?: string}} [links] 可选只读描述数据（#231）：client URL 构造/链接识别的单源模板；空对象=诚实「无链接」形状
 * @property {{labelsGuide?: boolean, repoCreateChain?: boolean}} [capabilities]
 * @property {'url'|'folder'} [openRepository] 开仓契约动作（#231）：url=浏览器新窗打开 describe().url；folder=host wf.openFolder；未声明且无 url 即诚实无动作 可选界面能力位（#231 · D8 末段落地）：仅驱动 UI 引导入口显示，G5 红线不变——永不被数据路径读取
 * @property {Object.<string, {zh: string, en: string}>} [prompts] 可选注入文案数据（#231 类别7核销）：键→双语全文（ensureLabels/ghAuthLogin 等），client 仅透传 inject 不持有品牌语义 可选只读 UI 描述数据（#230 D10 键入 locale）：声明 setupRun 占位符对应的 client locale 双语键名；界面检查项通道，永不被数据路径读取。未声明时 UI 用缺省键组兜底
 */

/**
 * 三级联选择结果（explicit > matches > fallback）。
 * - backendId:null = 无后端（逃生舱）；此时 **ref 省略**（不造假 RepositoryRef）。
 * - pending:true = matches 超时/unknown（被排除出决策集；「无 explicit、无 match===true、无 pending」才 fallback 静默 null；
 *   有 pending 必须 surface 给 UI——此时 source 仍为 'fallback'（三态枚举），但 pending:true 表示仲裁未完成，
 *   UI 应提示「等待/建议显式 bind」，不静默 OtherCard）。pending 只出现在有超时未决时；
 *   无 pending 且 backendId===null 才算「已决无后端」（OtherCard 唯一身份分支）。
 * - multiHit = 多命中（平局=注册序取首个；暴露供 bind 显式纠正）。
 * @typedef {Object} Selection
 * @property {import('../../shared/tracker/shape.js').BackendId|null} backendId
 * @property {'explicit'|'matches'|'fallback'} source 无 'detect'（残留已改 'matches'）
 * @property {RepositoryRef} [ref] backendId=null 时省略
 * @property {import('../../shared/tracker/shape.js').BackendId[]} [multiHit]
 * @property {true} [pending] 仲裁有超时未决（只出现在超时未决时）；UI/调用方必须显示等待/建议 bind，不得静默 OtherCard
 */

/**
 * 归一化后的目标仓库（已选择后端后的身份；backend 开放 string **非空**）。
 * @typedef {import('../../shared/tracker/shape.js').RepositoryRef} RepositoryRef
 */

/**
 * 票 / 图统一实体。
 * @typedef {import('../../shared/tracker/shape.js').Issue} Issue
 */

/** 环境门禁结果（不包 OpResult，避免 ok 污染；只判环境，不预判能力）。
 *  #664：原先还有一个 prompt 字段（后端把完整安装引导交给界面注入）—— 缺 gh 的文案已收成共享清单里那句
 *  原话，界面从那一步取，这一层不再透传提示词，字段随之删掉。
 */
/**
 * @typedef {Object} PreflightResult
 * @property {boolean} ok
 * @property {TrackerError} [error]
 */

/** list 过滤器。 */
/**
 * @typedef {Object} ListFilter
 * @property {import('../../shared/tracker/shape.js').IssueType} [type]
 * @property {'open'|'closed'} [state]
 * @property {string|null} [parentKey] null=根票；省略=全部
 * @property {string[]} [keys] 批量
 * @property {boolean} [isPullRequest] true=只取拉取请求（#506 界面过滤分界：前端 prFilterForList 登记，后端 github 房已实现）。
 */

/** get 选项（评论分页）。 */
/**
 * @typedef {Object} GetOpts
 * @property {{first: number, after?: string}} [comments] 分页（含 pageInfo；骨架不展开）
 */

/** getDependencies 选项（批量）。 */
/**
 * @typedef {Object} DepsOpts
 * @property {string[]} [keys] 批量；宿主侧对结果做 LRU（见 snapshot.js）
 */

/** 依赖投影（便利，非第二真源）。 */
/**
 * @typedef {Object} Dependencies
 * @property {import('../../shared/tracker/shape.js').IssueRef[]} blockedBy
 * @property {import('../../shared/tracker/shape.js').IssueRef[]} blocking 便利投影，由 blockedBy 反向聚合，非第二真源
 */

/** create 输入（富输入类型）。 */
/**
 * @typedef {Object} CreateInput
 * @property {string} title
 * @property {string} [body]
 * @property {import('../../shared/tracker/shape.js').IssueType} [type]
 * @property {string|null} [parentKey]
 * @property {LabelInput[]} [labels]
 * @property {AssigneeInput[]} [assignees]
 * @property {string} [idempotencyKey] 创建幂等锚（#711）：同一个锚提交两次只多出一张票、返回同一个 key；不传时行为与没有这个字段之前完全一样。语义与「回查拿不准必须如实失败」见同目录的 contract-idempotency.js，锚怎么构造与命中判据见 src/refresh/contract/idempotency-keys.ts
 */

/** close 选项。 */
/**
 * @typedef {Object} CloseOpts
 * @property {import('../../shared/tracker/shape.js').ClosedReason} [reason]
 */

/** update 补丁（多字段原子写；customFields 经 update 可写——不支持项返回 kind:'unsupported'）。 */
/**
 * @typedef {Object} UpdatePatch
 * @property {string} [title]
 * @property {string} [body]
 * @property {import('../../shared/tracker/shape.js').Milestone|null} [milestone]
 * @property {import('../../shared/tracker/shape.js').CustomField[]} [customFields]
 */

/** set* 选项（If-Match 强一致；不匹配 → kind:'conflict'）。 */
/**
 * @typedef {Object} SetOpts
 * @property {string} [expectedUpdatedAt]
 */

/** 标签输入：string → {name, color:''}。 */
/**
 * @typedef {string | {name: string, color?: string, description?: string}} LabelInput
 */

/** 指派输入：string → {login}。 */
/**
 * @typedef {string | {login: string, kind?: import('../../shared/tracker/shape.js').ActorKind, name?: string, avatarUrl?: string}} AssigneeInput
 */

// 标签配色两条操作（listLabels / setLabelColors）的语义住在同目录的 contract-label-colors.js ——
// #689 往本文件加「计数」这条操作时撞上 350 行上限，按仓库既有做法把那两条的正文原样挪了出去（一个字没改）。

// ─────────────────────────────────────────────────────────────────────────────
// 计数契约（#689 新加，2026-09-22；规格见 docs/design/677-issue-pool-completeness-spec.md 第 4.1 与第 6 节）
//
// 为什么要有它：面板顶部那几个数字原来是客户端数「手上那份票池」数出来的，而票池被后端悄悄截断过
// （GitHub 最多 500 条、GitLab 只取一页、本地 Markdown 读全部），于是数字跟着池子一起偏。数字该问后端要：
// 后端自己知道库里符合条件的有多少张。这条操作只回答「多少张」，不返回任何行 —— 行怎么取是另一件事。
//
// 语义：
//  - 只数工单，不含拉取请求（GitHub 的 issues 连接天然不含拉取请求，GitLab 的 issues 接口也不含合并请求，
//    本地 Markdown 没有这个概念）。「可接 / 阻塞」两个数字不在这里：它们要逐票看有没有指派人、有没有
//    开放着的阻塞者，只能按票算（见规格第 6 节）。
//  - effort（工作单元）由 repo.effortId 带（编排层的快照键已经含它），多工作单元的后端据此分别数。
//  - filter 复用 ListFilter，但只认两项，其余字段（type / parentKey / keys / isPullRequest）忽略：
//      state  —— 收窄到这一种状态（等价于「先按状态筛，再数」，于是另一种状态计 0）；
//      labels —— 必须同时带上这些标签的票（GitHub 走 GraphQL 的 filterBy:{labels}，是「这些都要有」）。
//  - 拿不全就整体失败，不许猜一个数出来：返回里带 errors、或三个数里任何一个不是非负整数，都算失败
//    （与 listLabels 那条「取不全必须整体失败」同一原则）。
//  - 失败语义：unsupported（这个后端没实现）/ rate-limit / network / auth / parse。
//  - unsupported 的结果不进任何缓存（G5 红线，与 getDependencies 同例）：缓存里绝不留「做不到」的判定。
//  - **不升 CONTRACT_VERSION**：这一次是纯新增操作，没实现它的后端由注册表自动补桩兜住，既有形状与既有
//    后端一个都没改。（这句话写在这里，是免得以后有人看见「契约加了东西却没升版号」再查一遍。）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 后端计数（`counts(repo, filter, ctx)` → `OpResult<Counts>`）。
 * 宿主拿它覆盖快照 deck 里的数字（见 tracker/snapshot.js 的 composeSnapshot）；拿不到时界面退回按池子
 * 派生，并把「这份清单不全」说出来（deck.partial）。
 */
/**
 * @typedef {Object} Counts
 * @property {number} open 未关闭的工单张数
 * @property {number} closed 已关闭的工单张数
 * @property {number} total 一共多少张（= open + closed）
 */

// 按页取票这条操作（listPage）的语义，与它的 PageOpts / PageResult 两个形状，住在同目录的
// contract-page.js —— 与标签配色那两条同样的做法：本文件受「每个文件不超 350 行」的门禁管，
// 长文正文放在续篇里，本文件只留一句指向它的话。以后改这条操作的语义，改那个文件。

// 创建幂等锚（#711）的语义住在同目录的 contract-idempotency.js：它不新增操作、不升版号，
// 只是 create 的一个可选输入字段（见上面 CreateInput.idempotencyKey），所以正文挪出去不影响本文件的自洽。

/** 归一化规则（供诊断/审计引用；各后端 normalize.js 依此实现）。 */
export const NORMALIZE_RULES = Object.freeze({
  completeShape: true, // interface 声明全部字段，UI 假设必填
  emptyVsMissing: true, // 能实现→空值=EMPTY；不能实现→省略=MISSING
  logBisect: true, // host 记每字段填/空，client 记渲染/隐藏，不引入运行期内省
  noCapabilityBranching: true, // 能力视图只作诊断，不驱动 UI 隐藏（G5）
})

export const TRACKER_CONTRACT = Object.freeze({
  version: CONTRACT_VERSION,
  operations: OPERATIONS,
  normalizeRules: NORMALIZE_RULES,
  state: STATE,
  issueType: ISSUE_TYPE,
  errorKind: ERROR_KIND,
})

// ── 会话与预算管线的类型出口（规格 1439）────────────────────────────────────────
// 为什么经这里转出：上层（deck 工具、宿主电话）只认契约层这一扇门，不直引会话目录。
// 全是 `export type`（转译后不留运行时引用），契约门禁第二项认这一写法，不算运行时实现。
// 预算形状的真源就是本目录的 `budget-model.ts`，这里只是转手，不复制定义。
export type { BackendBudgetModel, BudgetKind } from './budget-model.js'
export type { BudgetReading, BucketLevel } from './budget-model.js'
export type { AdmitInput, AdmitDecision, AdmitPort, AccountInput, AccountPort } from './budget-model.js'
export type { PipelineDeps } from '../session/pipeline.js'
export type { TrackerSession, OpenTrackerResult, OpenTrackerReason, OpenTrackerOptions, SelectionResolver } from '../session/open-tracker.js'