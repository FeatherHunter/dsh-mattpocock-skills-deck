/**
 * src/tracker/contract/operations.ts —— 契约的能力层：25 条能力，一个后端能被要求做的全部事情
 *
 * ── 这份文件回答一个问题 ────────────────────────────────────────────────────────
 * 「一个后端要能做哪些事，每件事收什么、回什么。」答完这一份，上层就能不认识后端是谁。
 *
 * ── 这里就是能力的上限 ──────────────────────────────────────────────────────────
 * 上层（deck 九个工具、宿主电话、面板）只认这份文件里写下的名字。后端面对每一条只有两种回法：
 * **我实现**，或者**我不支持**（异步操作回 `unsupported`，定位口回空值）。
 * 后端不许有自己独有的对外方法 —— 凡是实例上叫得到名字的东西，都必须先在这里出现。
 * 这条规矩买到的是一件很贵的东西：上层永远不必写「如果这个后端就……」的分支，
 * 也就永远不会因为漏掉某个后端而在某一天炸掉。
 *
 * 上一版的写法是「契约管 19 条操作，各家另有自己的扩展」：GitHub 有 `GitHubRoomExtension`，
 * 本地 Markdown 有 `MarkdownRoomExtension`，两房共用一段 `RoomAuxiliaries`。
 * 那三个类型已经删掉，成员全部并进 `Tracker`，理由见 `operations-catalog.ts` 与同目录 README.md。
 *
 * ── 与形状件的分工 ──────────────────────────────────────────────────────────────
 * 形状（票长什么样、失败长什么样、上下文是什么）分成五件：`identity.ts`（身份与枚举）、
 * `entities.ts`（实体）、`contexts.ts`（调用上下文）、`results.ts`（回给调用方的）、
 * `inputs.ts`（调用方交进来的），五件各自的读者见同目录 README.md。
 * 本文件只放**动词**：方法名、参数、返回；能力名本身由 `operations-catalog.ts` 单源提供。
 * 本文件不含任何运行时实现 —— 真正的实现在三个后端目录（`src/tracker/rooms/`）。
 *
 * ── 两条读这份文件必须知道的事 ──────────────────────────────────────────────────
 * 1. **后端可以实现一部分**：注册表会给没实现的操作自动补一个「做不到」的桩
 *    （`src/tracker/registry/shape.ts` 的 `unsupportedStub`，返回 `unsupported`）。所以后端拿到的类型是
 *    `RoomOperations`（本文件末尾）而不是完整的 `Tracker` —— 少实现一条不算违约，
 *    但**谎报**算（返回 ok 而其实没做成）。
 * 2. **能力是事后的事实**：这里没有一个 `supportedOps` 之类的清单，将来也不许加。
 *    想知道能不能做，调一次，看它回 ok 还是 unsupported。
 */

import type { Actor, BackendId } from './identity.js'
import type { Comment, Issue, LabelColor, LabelColorChange, RepositoryRef } from './entities.js'
import type { OpContext, RepoHandle } from './contexts.js'
import type {
  Counts,
  Dependencies,
  LabelColorBatchResult,
  LabelColorsFilePlacement,
  OpResult,
  PageResult,
  PreflightResult,
  RepoPermissions,
  SubIssueList,
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
 * 22 条契约操作的名字，**由名录单源生成**（`operations-catalog.ts` 的 `OPERATIONS` 数组）：
 * `preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、
 * `update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、
 * `initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`、`getRepoPermissions`、
 * `listSubIssues`、`ensureLabelColorsFile`。
 *
 * 为什么这么写（原来是一份手抄的联合类型）：手抄的联合类型与运行时那份 `OPERATIONS` 数组
 * 是两份数据，靠人眼对齐，漏改一处的后果是「类型说有、注册表不补桩」—— 那种错只在运行时
 * 才炸，且只炸没实现它的那个后端。改成从数组生类型之后，加一条操作只改名录一处。
 * （第二份手写副本已在 #1026 随旧运行时真源一起退休：`index.ts` 的 `OPERATIONS` 改成从名录转出，
 * 同一份数组、同一个引用；旧的同集断言见门禁文件头的「撤掉的两项」。）
 *
 * 这三条读路径的边界要写清，免得后人再往里塞：
 * 为什么没有 `detect`：身份识别不是操作，它是 `matches`（布尔）+ 注册表仲裁 + `describe`。
 * 为什么没有 `snapshot`：它是宿主编排出来的便利视图，进了名录就等于把「谁来拼装」写死进契约。
 * 为什么 `listSubIssues` 在名录里：它原先被当作「读路径的实现细节」，但它的读者在房外
 * （宿主电话 `src/host/mapTickets.js`），房外有读者就说明它不是细节，只能进名录。
 */
export type OpName = (typeof OPERATIONS)[number]

/**
 * 一个后端适配器对上层承诺的全部能力：**22 条操作 + 3 条定位口，共 25 条**。
 *
 * 谁实现：GitHub 后端与本地 Markdown 后端（GitLab 后端本轮不动，它拿到的是注册表补的桩）。
 * 谁消费：deck 九个工具（经共享壳）、注册表、宿主电话、面板。
 *
 * 实现方义务（写在类型旁边，因为类型管不了这几条）：
 * - **返回合规的 `OpResult`**：失败回值不抛异常。注册表不做运行时结果校验（能力零推断），
 *   所以「回了一个不合规的东西」在契约层是拦不住的 —— 这条靠实现自律加门禁。
 * - **不许读上层的东西**：后端只认 `RepositoryRef` 与 `OpContext`，
 *   不许去读面板状态、会话、当前用户界面在做什么。
 * - **不许有独有对外方法**：要加能力，先改这份契约与名录，再实现。
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
   * GitHub 回真实账号；本地 Markdown 与 GitLab 回 `unsupported` —— 这是**正常答案**，
   * 不是故障，调用方据此把「本人」相关的高亮关掉即可。
   */
  getCurrentUser(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<Actor>>

  /**
   * 初始化并发布工作区：建仓、提交、推上去。
   * GitHub 后端完整实现；本地 Markdown 后端回 `unsupported`；GitLab 后端由注册表补桩。
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
   * 问这个仓库的写权限。
   * 只回答 push / triage 两个布尔；问不出来如实失败，调用方按「未知」处理，**不许捏造**。
   *
   * GitHub 后端真去问；本地 Markdown 后端回 `unsupported`（本地文件可写性由沙箱与文件权限决定，
   * 没有「仓库权限」这回事）；GitLab 后端由注册表补桩。这三种回法都是合规的答案。
   */
  getRepoPermissions(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>>

  /**
   * 取一张地图的全部子票（翻页拉到底，带 1000 张硬上限）。
   *
   * 为什么它在契约里而不是某家的扩展：它的读者是宿主电话（`src/host/mapTickets.js`），
   * 那是房外代码；房外有读者，它就不是「某家的实现细节」。
   * 返回的字段里 `capped` 与 `missing` 是「有没有拿全」的诚实交代 ——
   * 一个地图子票成千上百时，界面必须能说清「还有更多、这次没全取回」。
   *
   * 本地 Markdown 后端与 GitLab 后端今天回 `unsupported`，宿主电话据此退化：
   * 界面提示用户「在它自己那边看全部」。
   */
  listSubIssues(
    repo: RepositoryRef,
    mapKey: string,
    opts: Record<string, never> | undefined,
    ctx: OpContext,
  ): Promise<OpResult<SubIssueList>>

  /**
   * 确保工作区里有那份用户可手改的标签配色文件。
   *
   * 调用它的地方是「用户为工作区选定后端」那一步：插件往工作区放一份默认配色文件，
   * 让人有一处可以直接手改的地方。**这里承诺的不只是文件存在，还有「改了算数」**——
   * 一份手改了却不影响颜色的文件不如不放。
   *
   * 本地 Markdown 后端实现它（颜色就存在这份工作区文件里，改文件就是改颜色）；
   * GitHub 后端如实回 `unsupported`，因为它的颜色真源是仓库标签，工作区里那份文件
   * 没有任何读者（读颜色走 `listLabels`、改颜色走 `setLabelColors`，界面入口是仓库标签页），
   * 放一份改了不算数的文件只会误导人。这是形态不合、不是欠账，登记为「明确不支持」，
   * 逐条理由见 `docs/tracker/capability-github.md`。
   *
   * 幂等要求：文件已存在时**一个字都不改**（用户可能已经手改过它）。
   */
  ensureLabelColorsFile(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColorsFilePlacement>>

  // ── 定位口三条 ────────────────────────────────────────────────────────────────
  // 与上面 22 条操作的区别只有一条，但很要紧：它们**没有「我不支持」这种答案**。
  // 问「这个仓库在这个后端上叫什么」，答案是名字或者空；空也是答案，不是失败。
  // 所以注册表不替它们补桩，缺席就是缺席，调用方拿空值继续往下走（不抛、不拦）。
  // 名字用「地址」不用「网址」：本地文件后端给过票文件路径，路径也是地址。

  /**
   * 从工作区目录解析出 `owner/name`（只有需要连远端的后端才有意义）。
   * 返回 `null` 表示这一趟没解析出来（不是异常，调用方按「补不出来」处理，**不许编一个名字**）。
   * 本地 Markdown 后端没有这条 —— 它的身份就是工作区目录本身，没有什么可解析的。
   */
  getRepoKey(cwd: string, ctx: OpContext): Promise<{ owner: string; name: string } | null>

  /**
   * 产出仓库身份。
   * 第二个参数是后端 id；实例自己知道身份，可以忽略它，故标可选参数。
   */
  describe(handle: RepoHandle, backendId?: BackendId): RepositoryRef

  /** 一张票在这个后端里的地址（远端后端回网页地址；本地 Markdown 算不出票文件名，回空串，见 #1144）。 */
  issueAddress(ref: RepositoryRef, key: string): string
}

/**
 * 后端真正能拿出来的那一份：`Tracker` 的子集（可以少实现几条）。
 *
 * 为什么是 `Partial`：注册表按 `OPERATIONS` 给缺的方法补「做不到」的桩，
 * 所以「少实现」是契约允许的常态，不是违约；`id` 也允许省略（注册表会按模块 id 补上）。
 *
 * 三个后端的 `create()` 都标了 `: RoomOperations`，靠这一处标注把「少实现」这件事说清楚，
 * 同时把签名核对交给编译器：写错参数、写错返回类型当场编译不过，不需要另加门禁去数名字。
 */
export type RoomOperations = Partial<Tracker> & {
  id?: BackendId
}
