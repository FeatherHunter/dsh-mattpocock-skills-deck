/**
 * src/tracker/contract/operations.ts —— 契约的操作层：19 条契约操作 + 1 条本轮新升的操作
 *
 * ── 这份文件回答一个问题 ────────────────────────────────────────────────────────
 * 「一个后端要能做哪些事，每件事收什么、回什么。」答完这一份，上层就能不认识后端是谁。
 *
 * ── 与形状件的分工 ──────────────────────────────────────────────────────────────
 * 形状（票长什么样、失败长什么样、上下文是什么）分成五件：`identity.ts`（身份与枚举）、
 * `entities.ts`（实体）、`contexts.ts`（调用上下文）、`results.ts`（回给调用方的）、
 * `inputs.ts`（调用方交进来的），五件各自的读者见同目录 README.md。
 * 本文件只放**动词**：方法名、参数、返回；操作名本身由 `operations-catalog.ts` 单源提供。
 * 本文件不含任何运行时实现 —— 真正的实现在两个房间里（`src/tracker/rooms/`），等迁移批次
 * 给它们补上返回标注（探针已验出 `ok` 被加宽这类差距，见 #1026 正文「下一步」）。
 *
 * ── 三条读这份文件必须知道的事 ──────────────────────────────────────────────────
 * 1. **房间可以实现一部分**：注册表会给没实现的操作自动补一个「做不到」的桩
 *    （`registryShape.js` 的 `unsupportedStub`，返回 `unsupported`）。所以房间拿到的类型是
 *    `RoomOperations`（本文件末尾）而不是完整的 `Tracker` —— 少实现一条不算违约，
 *    但**谎报**算（返回 ok 而其实没做成）。
 * 2. **能力是事后的事实**：这里没有一个 `supportedOps` 之类的清单，将来也不许加。
 *    想知道能不能做，调一次，看它回 ok 还是 unsupported。
 * 3. **`getRepoPermissions` 是这一轮新升进契约的**：它原本是 GitHub 房的只读旁路
 *    （不进 OPERATIONS），但 deck 的「这个仓库能不能写」这个判断两边都要用，
 *    按归属原则升进来；`listSubIssues` 与 `ensureLabelColorsFile` 仍是房内扩展，
 *    在本文件末尾单独定形状，**不进 `Tracker`**。
 */

import type { Actor, BackendId } from './identity.js'
import type { Comment, Issue, LabelColor, LabelColorChange, RepositoryRef } from './entities.js'
import type { OpContext, RepoHandle } from './contexts.js'
import type {
  Counts,
  Dependencies,
  LabelColorBatchResult,
  OpResult,
  PageResult,
  PreflightResult,
  RepoPermissions,
} from './results.js'
import type {
  AssigneeInput,
  CloseOpts,
  CreateInput,
  DepsOpts,
  GetOpts,
  InitProjectInput,
  LabelInput,
  ListFilter,
  PageOpts,
  SetOpts,
  UpdatePatch,
} from './inputs.js'
import type { OPERATIONS } from './operations-catalog.js'

/**
 * 19 条契约操作的名字，**由名录单源生成**（`operations-catalog.ts` 的 `OPERATIONS` 数组）：
 * `preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、
 * `update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、
 * `initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`。
 *
 * 为什么这么写（原来是一份手抄的联合类型）：手抄的联合类型与运行时那份 `OPERATIONS` 数组
 * 是两份数据，靠人眼对齐，漏改一处的后果是「类型说有、注册表不补桩」—— 那种错只在运行时
 * 才炸，且只炸没实现它的那个后端。改成从数组生类型之后，加一条操作只改名录一处。
 * （第二份手写副本已在 #1026 随旧运行时真源一起退休：`index.ts` 的 `OPERATIONS` 改成从名录转出，
 * 同一份数组、同一个引用；旧的同集断言见门禁文件头的「撤掉的两项」。）
 *
 * 为什么没有 `detect`：身份识别不是操作，它是 `matches`（布尔）+ 注册表仲裁 + `describe`。
 * 为什么没有 `snapshot` / `children` / `listSubIssues`：那些是读路径的实现细节或宿主编排的
 * 便利函数，进了这份清单就等于把「谁来拼装」这件事写死进契约。
 */
export type OpName = (typeof OPERATIONS)[number]

/**
 * 一个后端适配器对上层承诺的全部操作。
 *
 * 谁实现：GitHub 房与本地 Markdown 房（GitLab 房本轮不动）。
 * 谁消费：deck 九个工具（经共享壳）、注册表、宿主电话、面板。
 *
 * 实现方义务（写在类型旁边，因为类型管不了这几条）：
 * - **返回合规的 `OpResult`**：失败回值不抛异常。注册表不做运行时结果校验（能力零推断），
 *   所以「回了一个不合规的东西」在契约层是拦不住的 —— 这条靠实现自律加门禁。
 * - **不许读上层的东西**：房间只认 `RepositoryRef` 与 `OpContext`，
 *   不许去读面板状态、会话、当前用户界面在做什么。
 */
export interface Tracker {
  /** 后端 id（与注册时那个 id 一致；注册表会核对，自报不一致直接拒绝）。 */
  readonly id: BackendId

  /**
   * 环境预检：这台机器上这条路现在通不通。
   * 只判环境（工具在不在、登录没有、连不连得上、文件系统能不能碰），
   * **不预判能力**（「能不能建票」不在这里回答，那是 create 自己的事）。
   * 返回 `PreflightResult` 而不是 `OpResult`：预检回答的是通不通这一件事，
   * 包一层 ok/data 会长出「ok 但环境不 ok」这种自相矛盾的形状。
   */
  preflight(handle: RepoHandle, ctx: OpContext): Promise<PreflightResult>

  /** 列票（薄行，不带正文评论之外的展开；详细口径见 `ListFilter` 各字段注释）。 */
  list(repo: RepositoryRef, filter: ListFilter | undefined, ctx: OpContext): Promise<OpResult<Issue[]>>

  /**
   * 数票：这个后端里符合条件的有多少张。
   * 只回数字不回行；只数工单不含拉取请求；拿不全就整体失败，**不许猜一个数**。
   */
  counts(repo: RepositoryRef, filter: ListFilter | undefined, ctx: OpContext): Promise<OpResult<Counts>>

  /**
   * 按页取票：一次要一页行数据，外加「一共多少张」。
   * 排序键固定「创建时间倒序」；游标不透明，调用方只负责原样回传。
   */
  listPage(
    repo: RepositoryRef,
    filter: ListFilter | undefined,
    opts: PageOpts | undefined,
    ctx: OpContext,
  ): Promise<OpResult<PageResult>>

  /** 读一张票；`opts.comments` 控制评论带几条。 */
  get(repo: RepositoryRef, key: string, opts: GetOpts | undefined, ctx: OpContext): Promise<OpResult<Issue>>

  /**
   * 取依赖关系：谁阻塞我（唯一真源）与反向聚合出的「我阻塞了谁」（便利视图）。
   * 便利视图不是第二真源：任何判定都只许信 `blockedBy`。
   */
  getDependencies(
    repo: RepositoryRef,
    key: string,
    opts: DepsOpts | undefined,
    ctx: OpContext,
  ): Promise<OpResult<Dependencies>>

  /** 建一张票（可带幂等锚，见 `CreateInput.idempotencyKey`）。 */
  create(repo: RepositoryRef, input: CreateInput, ctx: OpContext): Promise<OpResult<Issue>>

  /** 关票；带 `expectedUpdatedAt` 时对不上就回 `conflict`。 */
  close(repo: RepositoryRef, key: string, opts: CloseOpts | undefined, ctx: OpContext): Promise<OpResult<Issue>>

  /** 重开票。 */
  reopen(repo: RepositoryRef, key: string, ctx: OpContext): Promise<OpResult<Issue>>

  /** 发一条评论；返回新建的那条评论本身（不是整张票）。 */
  comment(repo: RepositoryRef, key: string, body: string, ctx: OpContext): Promise<OpResult<Comment>>

  /** 改票（多字段原子写）；空补丁不该发请求。 */
  update(repo: RepositoryRef, key: string, patch: UpdatePatch, ctx: OpContext): Promise<OpResult<Issue>>

  /** 覆盖式改标签（传什么就是什么，不是增量）。 */
  setLabels(
    repo: RepositoryRef,
    key: string,
    labels: LabelInput[],
    opts: SetOpts | undefined,
    ctx: OpContext,
  ): Promise<OpResult<Issue>>

  /** 覆盖式改指派人（认领）。 */
  setAssignees(
    repo: RepositoryRef,
    key: string,
    assignees: AssigneeInput[],
    opts: SetOpts | undefined,
    ctx: OpContext,
  ): Promise<OpResult<Issue>>

  /** 改父地图；`null` 表示移到根。 */
  setParent(
    repo: RepositoryRef,
    key: string,
    parentKey: string | null,
    opts: SetOpts | undefined,
    ctx: OpContext,
  ): Promise<OpResult<Issue>>

  /**
   * 改阻塞关系。
   * 两条硬规矩：自己阻塞自己 → `conflict`；写完之后成环 → `conflict` 且**不落盘**。
   * 环检是写路径的一部分，不许省（省掉之后图会变成一团，而且再也解不开）。
   */
  setBlockedBy(
    repo: RepositoryRef,
    key: string,
    blockers: string[],
    opts: SetOpts | undefined,
    ctx: OpContext,
  ): Promise<OpResult<Issue>>

  /**
   * 当前登录人。
   * GitHub 返回真实账号；本地 Markdown 与 GitLab 返回 `unsupported` —— 这是**正常答案**，
   * 不是故障，调用方据此把「本人」相关的高亮关掉即可。
   */
  getCurrentUser(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<Actor>>

  /**
   * 初始化并发布工作区：建仓、提交、推上去。
   * 今天只有 GitHub 房完整实现；本地 Markdown 房返回 `unsupported`；
   * GitLab 房不在本轮范围内。
   * ⚠️ 注意实现与文档的一处出入：`contract.js` 的注释写「markdown 幂等骨架」，
   * 而 `backends/markdown/index.js:150` 实际返回的是 `unsupported`。以代码为准，
   * 这条出入记在本轮审查里，等迁移时让文档跟上代码。
   */
  initProject(
    handle: RepoHandle,
    input: InitProjectInput,
    ctx: OpContext,
  ): Promise<OpResult<RepositoryRef>>

  /**
   * 列出「这个后端能改色的全部标签」与各自颜色。
   * **取不全就必须整体失败**，不许静默返回残缺列表：列表项只有 name/color/description
   * 三个键，没有任何位置能表示「这份清单被截断了」，用户只会看到「标签凭空少了几个」。
   */
  listLabels(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColor[]>>

  /**
   * 批量改标签颜色，逐条记账。
   * 部分成功是合法结果（入参每一条必须恰好落在 applied 或 failed 之一）；
   * 保存成功后界面必须重新列出标签拿真值刷新，不许乐观刷新。
   */
  setLabelColors(
    repo: RepositoryRef,
    changes: LabelColorChange[],
    ctx: OpContext,
  ): Promise<OpResult<LabelColorBatchResult>>

  /**
   * 问这个仓库的写权限（本轮从旁路升为契约操作）。
   * 只回答 push / triage 两个布尔；问不出来如实失败，调用方按「未知」处理。
   *
   * **可选成员**：只有 GitHub 房真有这个方法，本地 Markdown 房没有（它不需要问，本地文件可写性
   * 由沙箱与文件权限决定）。写成必填是错的，有两个硬证据：一是它不在 `contract.js` 的十九条操作
   * 清单里，注册表只给那份清单里的名字补桩，所以运行期也没有「补一个能写的桩」这条退路；
   * 二是真实调用方本来就是自己判空的（`call-scope.js` 与 `deckContext.js` 都是「先看有没有这个方法再调」）。
   * 所以：调用方必须自己判空，拿不到就按「未知」处理，不许当成「能写」。
   */
  getRepoPermissions?(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>>
}

/**
 * 房间真正能拿出来的那一份：`Tracker` 的子集（可以少实现几条），
 * 外加本房自己的扩展方法。
 *
 * 为什么是 `Partial`：注册表按 `OPERATIONS` 给缺的方法补「做不到」的桩，
 * 所以「少实现」是契约允许的常态，不是违约；`id` 也允许省略（注册表会按模块 id 补上）。
 */
export type RoomOperations = Partial<Tracker> & {
  id?: BackendId
}

/**
 * 一张地图的全部子票（`listSubIssues`，**GitHub 房扩展，不进契约**）。
 *
 * 它是读路径的实现细节：唯一调用者是宿主电话（`src/host/mapTickets.js:76`），
 * 没实现它的后端由那条电话按「做不到」退化，界面提示「在它自己的网页上看全部」。
 * 返回的五个字段各自有明确读者，其中 `capped` 与 `missing` 是「有没有拿全」的诚实交代 ——
 * 一个地图子票成千上百时，界面必须能说清「还有更多、这次没全取回」。
 */
export interface GitHubRoomExtension {
  /** 取一张地图的子票（翻页拉到底，带 1000 张硬上限）。 */
  listSubIssues(
    repo: RepositoryRef,
    mapKey: string,
    opts: Record<string, never>,
    ctx: OpContext,
  ): Promise<
    OpResult<{
      /** 子票行（契约 Issue 形状）。 */
      items: Issue[]
      /** 后端连接上说的总数。 */
      total: number
      /** 这一次真的拉回来的张数。 */
      fetched: number
      /** 是否撞到硬上限（撞到时界面要说清「还有更多，没全取回」）。 */
      capped: boolean
      /** 与总数对不上的差额（0 表示对上了）。 */
      missing: number
    }>
  >
}

/**
 * 放置配色文件的入口（`ensureLabelColorsFile`，**本地 Markdown 房扩展，不进契约**）。
 *
 * 为什么做成可选方法而不是加一条契约操作：宿主在「用户为工作区选定后端」那一步要往工作区
 * 放一份默认配色文件，但它**不许问后端是谁**（问了就是能力分支，撞 G5 红线）。
 * 于是做成一个「实现了就放、没实现就跳过」的口子；今天只有本地 Markdown 房实现它
 * （`backends/markdown/index.js:148`），GitHub 房没有这个方法才是对的 ——
 * GitHub 的标签颜色存在仓库标签上，没有本地文件可放。
 *
 * 幂等要求：文件已存在时**一个字都不改**（用户可能已经手改过它）。
 */
export interface MarkdownRoomExtension {
  /** 确保工作区里有那份用户可手改的配色文件。 */
  ensureLabelColorsFile(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<unknown>>

  /**
   * 把一份 Markdown 票文本规整成票对象（房间私有解析口的第二个，见 `parse`）。
   * 今天只有本地 Markdown 房有（`backends/markdown/index.js:151`，实现是 `normalize.js` 的
   * `normalizeIssue`）：它比 `parse` 多做一步清理 —— 删掉里程碑、作者、编号、子票、反向阻塞
   * 这些本地文件里根本不存在的字段，并给缺失的 `key`/`effortId`/`type`/`title` 补默认值。
   *
   * 为什么标可选：GitHub 房的 create() 产物里没有这个名字（它走自己的 `normalize.js`，
   * 但那是房内模块级函数，不挂在实例上），写必填会让 GitHub 房当场编译不过。
   * 为什么返回类型写 `unknown` 而不是契约的 `Issue`：它回的是**房间自己的完整解析结果**
   * （比契约 `Issue` 多出正文、评论等房间私有字段，字段类型也没有按契约归一）。
   * 契约层不复制房间私有形状，也不许为了迁就它去改契约；房外调用方若真要用，自己按需断言。
   *
   * 谁在用：本轮在 `src/host` 与 `tests` 里没有查到房外调用方（房内模块各自直接 import
   * `parse.js` / `normalize.js`，不经实例）；是否有别处经实例动态取用，未核实。
   */
  normalize?(text: string, meta: MarkdownParseMeta): unknown

  /**
   * 把一份 Markdown 票文本解析成票对象（房间私有解析口的第一个）。
   * 今天只有本地 Markdown 房有（`backends/markdown/index.js:152`，实现是 `parse.js` 的 `parseMd`）。
   * 它是整个本地文件后端的读入口：票、评论、依赖、地图正文都先经它。
   *
   * 与 `normalize` 的关系（别搞反）：`normalize` 内部调 `parse` 再清理，
   * 所以要拿「和契约最接近」的那一份时用 `normalize`；要拿「原文里有什么就是什么」时用 `parse`。
   * 可选与返回类型写法的理由同 `normalize`，不再重复。
   */
  parse?(text: string, meta: MarkdownParseMeta): unknown
}

/**
 * 本地 Markdown 房两个解析口收的第二个参数（房间私有约定，契约层只做记录、不解释）。
 *
 * 这一份形状是从房内真实调用点抄来的，例如 `markdown/graph.js:17` 的
 * `parseMd(txt, {key, parentKey:'00', isMap:false, effortId})`。四个字段的含义：
 * `key` 是这份文本对应的票号、`parentKey` 是它挂在哪张票下（地图固定 `'00'`，`null` 表示没有父）、
 * `isMap` 表示这份文本是不是地图本体、`effortId` 是工作单元标识（扁平布局与单工作单元后端为空串）。
 * 末尾留索引签名，是为了以后房间往这个参数里加字段时不必改契约 —— 房间私有的东西，契约不挡。
 */
export interface MarkdownParseMeta {
  /** 这份文本对应的票号。 */
  key?: string
  /** 父票号；地图固定 `'00'`，`null` 表示没有父。 */
  parentKey?: string | null
  /** 这份文本是不是地图本体。 */
  isMap?: boolean
  /** 工作单元标识（扁平布局与单工作单元后端为空串）。 */
  effortId?: string
  /** 房间以后往这个参数里加字段，不必回来改契约。 */
  [extra: string]: unknown
}

/**
 * 房间实例上的只读辅助口（**两房都可能有的旁路，不进契约操作清单**）。
 *
 * 为什么要单独一个接口：这三个键今天挂在 `create()` 造出来的**实例**上，既不在 `Tracker`，
 * 也不属于哪个房间独有的扩展。若不给它们类型位置，两房照原样 `implements` 时会当场报
 * 「对象字面量只能指定已知属性」（多余属性检查），迁移第一步就卡住。
 *
 * 三个成员全部可选，因为两房并不都有（下面是本轮核过的实情）：
 * - `getRepoKey`：只有 GitHub 实例有（`backends/github/backend.js:124`）。本地 Markdown 房
 *   的身份就是工作区目录本身，没有什么可解析的，所以没有这个方法才是对的。
 * - `describe` / `issueUrl`：GitHub 实例有（`backend.js:119` / `:120`）；本地 Markdown 实例
 *   **没有**（`backends/markdown/index.js:87-153` 的返回对象里逐键核过，这两个名字不在其中）。
 *
 * 调用方怎么对待缺席（**别把缺席当故障**）：
 * - 注册表视图有回退链：先问模块对象，再问实例，最后按后端 id 拼骨架
 *   （`views.ts:32-46` 与 `:59-64`）—— 实例上没有这两个方法时，正是回退链在起作用。
 * - 共享壳取仓库标识时先看有没有这个方法再调，并对调用加了竞速上限
 *   （`src/shared/deck-tools/shell.js:216-227`，上限缺省 8000 毫秒、可经 `resolveTimeoutMs` 配）；
 *   没有方法或超时，壳按「补不出来」如实往下走，绝不编一个仓库名。
 */
export interface RoomAuxiliaries {
  /**
   * 从工作区目录解析出 `owner/name`（GitHub 专用）。
   * 返回 `null` 表示这一趟没解析出来（不是异常，调用方按「补不出来」处理）。
   */
  getRepoKey?(cwd: string, ctx: OpContext): Promise<{ owner: string; name: string } | null>

  /**
   * 产出仓库身份（与模块对象上同名的那个方法同义，实例版供回退链用）。
   * 第二个参数是后端 id；实例自己知道身份，可以忽略它，故标可选参数。
   */
  describe?(handle: RepoHandle, backendId?: BackendId): RepositoryRef

  /** 一张票在这个后端里的链接（与模块对象上同名方法同义，实例版供回退链用）。 */
  issueUrl?(ref: RepositoryRef, key: string): string
}
