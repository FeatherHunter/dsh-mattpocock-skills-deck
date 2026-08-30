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
 * @property {(repo: RepositoryRef, ctx: OpContext) => Promise<OpResult<import('../../shared/tracker/shape.js').Actor>>} getCurrentUser 当前登录人（viewer），GitHub 返回 Actor，Markdown/GitLab 返回 unsupported（MISSING）
 * @property {(handle: RepoHandle, input: InitProjectInput, ctx: OpContext) => Promise<OpResult<RepositoryRef>>} initProject 工作区初始化并发布（git init→commit→gh repo create→push；错误分类 no-git/no-gh/not-logged-in/already-exists/network/permission；仅 github 完整实现，markdown 幂等骨架，gitlab unsupported）
 */

/**
 * 操作名清单（= OpName；能力零声明，只有动词）。
 * 无 detect（身份=matches+select+describe）；无 snapshot/children（宿主编排便利，非契约）。
 * @typedef {'preflight'|'list'|'get'|'getDependencies'|'create'|'close'|'reopen'|'comment'|'update'|'setLabels'|'setAssignees'|'setParent'|'setBlockedBy'|'getCurrentUser'|'initProject'} OpName
 */
export const OPERATIONS = Object.freeze([
  'preflight', 'list', 'get', 'getDependencies',
  'create', 'close', 'reopen', 'comment',
  'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy',
  'getCurrentUser',
  'initProject',
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
 * @property {Object} log Logger（info/warn/error；诊断二分走这里）
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