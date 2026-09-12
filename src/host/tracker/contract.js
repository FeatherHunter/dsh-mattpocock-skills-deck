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

import { STATE, ISSUE_TYPE, ERROR_KIND, CONTRACT_VERSION } from '../../shared/tracker/constants.js'

/**
 * Tracker 接口。实现方（后端适配器）应提供需要的操作；不能实现的按规则返回 unsupported
 * 或省略字段，不硬装（诚实 = 不捏造类别、不假装身份）。
 *
 * ⚠️ 非 op 旁路豁免（极窄，勿扩散）：实现方可附加**不进 OPERATIONS** 的旁路方法（如
 * `snapshotFast`——见 snapshot.js），仅作「读路径实现细节」豁免，不参与能力验证、不构成能力表；
 * G5 红线仍然成立：不得以任何旁路形态驱动写路径/渲染分支、不得扩散为 supportedOps 式能力分支。
 *
 * ⚡ op 实现者义务：返回合规 OpResult；registry 不做运行时结果校验（能力零推断，G5）。
 *
 * @typedef {Object} Tracker
 * @property {import('../../shared/tracker/shape.js').BackendId} id 后端 id（= 注册时的 BackendId）
 *
 * @property {(handle: RepoHandle, ctx: OpContext) => Promise<PreflightResult>} preflight 环境门禁（只判环境：工具在不在/登录/可达/fs;不预判能力）
 * @property {(repo: RepositoryRef, filter?: ListFilter, ctx: OpContext) => Promise<OpResult<Issue[]>>} list
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
 * @property {(handle: RepoHandle, input: InitProjectInput, ctx: OpContext) => Promise<OpResult<RepositoryRef>>} initProject 工作区初始化并发布（git init→commit→gh repo create→push；错误分类 no-git/no-gh/not-logged-in/already-exists/network/permission；仅 github 完整实现，markdown 幂等骨架，gitlab unsupported）
 */

/**
 * 操作名清单（= OpName；能力零声明，只有动词）。
 * 无 detect（身份=matches+select+describe）；无 snapshot/children（宿主编排便利，非契约）。
 * @typedef {'preflight'|'list'|'get'|'getDependencies'|'create'|'close'|'reopen'|'comment'|'update'|'setLabels'|'setAssignees'|'setParent'|'setBlockedBy'|'getCurrentUser'|'initProject'|'listLabels'|'setLabelColors'} OpName
 */
export const OPERATIONS = Object.freeze([
  'preflight', 'list', 'get', 'getDependencies',
  'create', 'close', 'reopen', 'comment',
  'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy',
  'getCurrentUser',
  'initProject',
  // #627 新增两条（标签配色）。加进本清单的作用：注册表会自动给没实现它们的后端补一个
  // 「做不到」的桩（registryShape.js 的 unsupportedStub），所以不需要兼容层，也不会碰坏现有后端。
  'listLabels', 'setLabelColors',
])

/**
 * 统一错误形状（所有操作失败都归一化成这个，**返回**不 throw）。
 * @typedef {Object} TrackerError
 * @property {import('../../shared/tracker/constants.js').ERROR_KIND} kind 分类：env/auth/rate-limit/conflict/unsupported/not-found/network/parse
 * @property {string} message
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
 * @property {(handle: RepoHandle, backendId: string) => import('../../shared/tracker/shape.js').RepositoryRef} [describe] 可选：出 RepositoryRef（refId/name/url）；未提供时 registry 回退骨架（markdown cwd，其余 ''）
 * @property {(ref: import('../../shared/tracker/shape.js').RepositoryRef, key: string) => string} [issueUrl] 可选：票链接（github https://github.com/{refId}/issues/{key}，gitlab https://gitlab.com/{refId}/-/issues/{key}，markdown ''）
 * @property {(name: string) => string} [searchUrl] 可选：仓库名搜索链接（github https://github.com/search?q=...）
 * @property {{trackerLine: string, trackerChoice: string, backendNote: string, labelReqs: string, paletteNote?: string}} [setupPrompt]
 * @property {{name: string, color: string}[]} [labelPalette] 可选：后端自己的默认标签调色盘（#323 定版复核——本地 Markdown 提供，结构/label/颜色真源；GitHub/GitLab 不声明；面板按 模块默认 + 工作区表覆盖 查色）
 * @property {{issueUrlTemplate?: string, repoUrlTemplate?: string, searchUrlTemplate?: string, linkPatternSource?: string}} [links] 可选只读描述数据（#231）：client URL 构造/链接识别的单源模板；空对象=诚实「无链接」形状
 * @property {{labelsGuide?: boolean, repoCreateChain?: boolean}} [capabilities]
 * @property {'url'|'folder'} [openRepository] 开仓契约动作（#231）：url=浏览器新窗打开 describe().url；folder=host wf.openFolder；未声明且无 url 即诚实无动作 可选界面能力位（#231 · D8 末段落地）：仅驱动 UI 引导入口显示，G5 红线不变——永不被数据路径读取
 * @property {Object.<string, {zh: string, en: string}>} [prompts] 可选注入文案数据（#231 类别7核销）：键→双语全文（ensureLabels/ghAuthLogin 等），client 仅透传 inject 不持有品牌语义 可选只读 UI 描述数据（#230 D10 键入 locale）：声明 setupRun 占位符对应的 client locale 双语键名；界面检查项通道，永不被数据路径读取。未声明时 UI 用缺省键组兜底
 * @property {RegExp|string} [linkPattern] 可选：链接识别正则（如 /github\\.com\/[^\/\\s]+\/[^\/\\s]+\/issues\/(\\d+)/）
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
 *  #195 修复：后端通过 prompt 字段提供完整引导文本（多态），UI 直接 inject，不持有后端文案。
 */
/**
 * @typedef {Object} PreflightResult
 * @property {boolean} ok
 * @property {TrackerError} [error]
 * @property {string} [prompt] 失败时后端提供的完整引导 prompt（多态，UI 直接 inject；成功时省略）
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

// ─────────────────────────────────────────────────────────────────────────────
// 标签配色契约（#627 定版，2026-09-13；出处：地图 #610 与 #615 的两轮讨论）
//
// 这两条操作是「标签颜色可编辑」在契约层的全部接缝：界面只跟它们打交道，不知道底下是
// GitHub 的仓库标签，还是本地 Markdown 工作区里那个用户可以自己手改的配色文件。
// 首期只做 GitHub 与本地 Markdown；GitLab 这一轮一行不改，自动落到「做不到」的回答。
// ─────────────────────────────────────────────────────────────────────────────

/** 一条标签与它的颜色。
 *  颜色统一写成**不带井号的 6 位十六进制小写**（例：9d7cd8）。空串 '' 表示这个标签还没配颜色，
 *  界面按灰显示（能返回颜色却不知道颜色 = 空值，不是省略）。description 省略 = 这个后端给不了。
 *  列表项**只许这三个键**：不带「有多少张票在用这个标签」这类计数，也不带分组标记。 */
/**
 * @typedef {Object} LabelColor
 * @property {string} name 标签名，原样返回（不做大小写折叠；名字里可以有冒号、空格）
 * @property {string} color 6 位小写十六进制、不带井号；'' = 还没配颜色
 * @property {string} [description] 省略 = 给不了
 */

/** 一次批量改色里的一条改动：标签名与它的新颜色（只许这两个键）。
 *  调用方只放**真正变了**的标签（增量），比色前两边都转小写再比：实测本仓库的 wayfinder:grilling
 *  在 GitHub 上存的是大写 9D7CD8，不转小写会被判成「颜色变了」而白发一次请求。 */
/**
 * @typedef {Object} LabelColorChange
 * @property {string} name
 * @property {string} color 新颜色（6 位十六进制，大小写都收；写进真源后由后端给回小写）
 */

/** 批量改色的逐条记账结果。
 *  - applied：改成功的标签与**最终颜色**（后端从真源里读出来的那个值，界面据此显示）。
 *  - failed：没改成功的标签与原因。reason 就是本文件既有的 TrackerError 形状（kind + message），
 *    **不新增字段、不新增枚举值**；message 由后端组装成可以直接展示给用户的一句话（不许把原始
 *    错误对象的字段直接塞进去——原子写失败时错误里的路径是临时文件名，用户会去找一个不存在的文件）。
 *  - 入参里**每一条改动必须恰好出现在 applied 或 failed 之一**：不许漏记账，也不许两边都算。 */
/**
 * @typedef {Object} LabelColorBatchResult
 * @property {{name: string, color: string}[]} applied
 * @property {{name: string, reason: TrackerError}[]} failed
 */

/** 列出标签与颜色（`listLabels(repo, ctx)`）。
 *
 *  「全部标签」的统一语义：**这个后端能改色的全部标签**，各后端自己聚合 —— GitHub 给仓库标签全量
 *  （含还没被任何票用到的）；本地 Markdown 给「票面出现过的 ∪ 配色文件里的 ∪ 内置默认那些」的并集。
 *
 *  **取不全就必须整体失败，不许静默返回残缺列表**（2026-09-13 二次整改新增，见 #627）：
 *  返回的清单要么是这后端的完整一份，要么别返回。后端自己知道有没有拿全 —— 接口默认只回前若干条
 *  （GitHub 列标签默认只回 30 条，本仓库真出过这个 bug）、翻页没翻完、合并的来源读了一半，都算没拿全。
 *  没拿全时按下列两档整体失败，并在 message 里说清是「没能拿全标签」：
 *    env     —— 本机这边的原因取不全（工具版本不支持翻页、配色文件读了一半之类）；
 *    network —— 连不通、超时、请求半路断掉。
 *  为什么定死：列表项只有 name/color/description 三个键，没有任何位置能表示「这份清单被截断了」，
 *  于是残缺列表在界面看来和全量一模一样，用户只会看到「标签凭空少了几个」而不知道为什么。
 *  契约测试按「已知的全量清单里每个标签都出现在返回里」判定，见 tests/tracker-contract/sections/labels.js 的 labelCompletenessCheck。
 *
 *  颜色的最终值由后端算好交给界面，界面永远不自己查表算色。契约里既有的 labelPalette（后端自报的
 *  默认调色盘）保留不动：一个是自报的描述数据，一个是算出来的结果，职责不同。面板快照里那份标签表
 *  同样不是权威（它是从各票标签收集来的派生数据，本来就不保证拿全）；权威列表只来自本操作。
 *
 *  失败按既有分类：这个后端不做这个操作 = unsupported（注册表自动补的桩给的就是它）；工作区里那个
 *  配色文件存在但读不出来、解析不了 = parse（不许装作「没有这个文件」，否则用户会以为刚手改的内容丢了）。
 */

/** 批量改标签颜色（`setLabelColors(repo, changes, ctx)`）。
 *
 *  返回是**逐条记账**，不是整体成败：批量中途失败没有回滚，会留下「前几个改了、后几个没改」的半成品，
 *  只给整体成败的契约会让界面在部分成功时只能说谎。保存成功后界面必须重新调一次「列出标签」拿真值
 *  刷新，不得乐观地把界面刷成用户填的那份。
 *
 *  错误分档（沿用既有分类，不新增枚举值）：
 *    颜色写法不合法（不是 6 位十六进制）→ parse（落在该条的 failed 上）
 *    入参不是一批改动 → parse（整体失败）
 *    没登录、凭据失效、没有这个仓库的写权限 → auth
 *    标签不存在、仓库不存在 → not-found（**两边一律报不存在，都不许新增**：GitHub 上改不存在的标签
 *      本来就是 404，如实报；本地 Markdown 上要改的标签不在配色文件里时同样报不存在，不新增一行。
 *      代价是本地给一个还没进配色文件的标签上色会失败，所以 message 必须说清怎么做才能成功）
 *    这个后端不做这个操作 → unsupported（整体失败）
 *    触发限速 → rate-limit；网络不通 → network
 *    工作区缺工具、本地配色文件写不进去 → env
 *    环境类里**沙箱拒绝必须能单独辨认**：那是插件自己的限制，不是用户的文件权限问题。message 里必须
 *      同时说清两件事——「这是插件自己的限制」与「不是你的文件权限问题」——且绝不许说成「目录不可写」
 *      （契约测试按这两句与这一条禁用词判定，见 tests/tracker-contract/sections/labels.js）。
 *      判据照 #476 已实锤的那条：拒信含 file access denied 或 workspace-write，或错误码 FS_SANDBOX_DENIED。
 *  404（没权限）的判定归 GitHub 后端自己：撞到 404 时自己多问一次仓库权限，把结论写进 message；
 *  这是 GitHub 专有的情况，不进通用代码。
 *
 *  本地 Markdown 写那个配色文件的三条硬要求（写在这里，免得散在实现里）：
 *    ① 读—改—写要串行化：同一工作区两个会话同时保存，现在会静默丢一轮改色（后写覆盖先写）；
 *       照抄仓库里日志落盘那套单写者队列（src/host/logStore.js）。
 *    ② 文件读不出来或解析不了时，一律不许写：宁可报「读不出来」，也绝不把文件推平重写。
 *    ③ 改色写入必须原子写（临时文件＋改名）：那个文件是用户会手改、会提交进版本库的，只有它走
 *       发布式写入；票文件那几处不在本范围。
 *  「文件有就用文件、没有用内置、都没有回灰」这套合并规则由后端负责。
 */

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