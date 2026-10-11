/**
 * src/tracker/contract/operations.ts —— 契约的操作层：19 条契约操作 + 1 条本轮新升的操作
 *
 * ── 这份文件回答一个问题 ────────────────────────────────────────────────────────
 * 「一个后端要能做哪些事，每件事收什么、回什么。」答完这一份，上层就能不认识后端是谁。
 *
 * ── 与形状层的分工 ──────────────────────────────────────────────────────────────
 * 形状（票长什么样、失败长什么样）在 `./ports.ts`；本文件只放**动词**：方法名、参数、返回。
 * 两处都不含任何运行时实现 —— 真正的实现今天还在
 * `src/host/tracker/contract.js`（JSDoc 版）与两个房间的 `.js` 文件里，等迁移批次搬过来。
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

import type {
  Actor,
  BackendId,
  CloseOpts,
  Counts,
  CreateInput,
  Dependencies,
  DepsOpts,
  GetOpts,
  Issue,
  LabelColor,
  LabelColorBatchResult,
  LabelColorChange,
  LabelInput,
  AssigneeInput,
  InitProjectInput,
  ListFilter,
  OpContext,
  OpResult,
  PageOpts,
  PageResult,
  PreflightResult,
  RepoHandle,
  RepoPermissions,
  RepositoryRef,
  SetOpts,
  UpdatePatch,
  Comment,
} from './ports.js'

/**
 * 19 条契约操作的名字，与今天的 `contract.js` 里 `OPERATIONS` 数组**逐字同集**：
 * `preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、
 * `update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、
 * `initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`。
 *
 * 为什么没有 `detect`：身份识别不是操作，它是 `matches`（布尔）+ 注册表仲裁 + `describe`。
 * 为什么没有 `snapshot` / `children` / `listSubIssues`：那些是读路径的实现细节或宿主编排的
 * 便利函数，进了这份清单就等于把「谁来拼装」这件事写死进契约。
 *
 * ⚠️ 运行时的真源仍是 `contract.js` 的 `OPERATIONS` 数组（注册表按它补桩）。
 * 本联合类型与它必须同集：**加一条操作 = 改两处**，漏改一处的后果是「类型说有、注册表不补桩」，
 * 那种错在运行时才炸，且只炸没实现它的那个后端。
 */
export type OpName =
  | 'preflight'
  | 'list'
  | 'counts'
  | 'listPage'
  | 'get'
  | 'getDependencies'
  | 'create'
  | 'close'
  | 'reopen'
  | 'comment'
  | 'update'
  | 'setLabels'
  | 'setAssignees'
  | 'setParent'
  | 'setBlockedBy'
  | 'getCurrentUser'
  | 'initProject'
  | 'listLabels'
  | 'setLabelColors'

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
   * 本地 Markdown 房不需要问（本地文件可写性由沙箱与文件权限决定），
   * 由共享判断直接给「可写」，实现可以返回固定值 —— 但**必须实现**，
   * 不许靠注册表补桩（补桩返回的是 unsupported，而上层要的是「能写」这个事实）。
   */
  getRepoPermissions(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>>
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
}
