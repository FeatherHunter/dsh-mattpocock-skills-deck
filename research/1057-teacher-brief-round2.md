# tracker 契约层现状调查（2026-10-14，第二轮）

这份文件回答一个问题：维护者说「经过地图 08（#1050，GitHub 房）的讨论和落地，现在 tracker 层是 25 个接口了，并且不再有独属于某个后端的接口了，所有的请求都要走 tracker 层」——这句话今天在源码里对不对，准确的数字是多少。

全部结论来自亲手读源码、亲手数、亲手跑门禁，每条带文件与行号、提交哈希或 issue 号；拿不准的写「未核实」，不猜。只有本文件是本次新写的文件，没有改动任何源码。

先解释三个词，后文反复出现：

- **契约层**：`src/tracker/contract/` 这个目录。它对上层承诺「一个后端最多能被要求做哪些事、每件事的签名是什么」，本身不放实现。
- **操作（operation）**：契约里那类「去后端做一件事」的能力，调用后拿到一个结果或者一句诚实的「我不支持」。
- **定位口（locator）**：契约里那类「问后端一个名字」的能力（仓库叫什么、一张票的地址是什么）。它没有「我不支持」这种答案——答案是名字，或者空值；空值也是答案，不是失败（`src/tracker/contract/operations.ts:272-276`）。
- **注册表（registry）**：`src/tracker/registry/`，它按契约名录给「后端没实现的操作」自动补一个回「我不支持」的桩，所以上层永远拿不到「这个方法不存在」（`src/tracker/registry/shape.ts:73-82`、`:105`）。

---

## ① 结论先行

维护者那句话分三截核对，两截成立、一截成立但要加两条限定；准确数字是 **25 = 22 条操作 + 3 条定位口**，不是「25 个操作」。

| 维护者的说法 | 今天成立吗 | 准确的说法与出处 |
| --- | --- | --- |
| 「现在 tracker 层是 25 个接口了」 | **成立，但要拆口径** | 25 条 = 22 条操作 + 3 条定位口，名单真源在 `src/tracker/contract/operations-catalog.ts:62`（22 条）、`:102`（3 条）、`:114`（两段拼成 25）。老口径是 19 条操作（`research/1010-room-conformity-checklist.md:4` 亲手数的 19 项，源 `src/host/tracker/contract.js:58-74`）；19 → 22 是纯净增 3 条，19 条老操作一条没被摘掉，另外新建了 3 条定位口这一段，所以是 19 + 3 + 3 = 25。 |
| 「不再有独属于某个后端的接口了」 | **成立（就「对外方法」这一层而言）** | 三个装房内独有方法的类型已删除：`GitHubRoomExtension`、`MarkdownRoomExtension`、`RoomAuxiliaries` 全仓只剩注释与文档里的历史提及（`src/tracker/contract/operations.ts:14-15`、`src/tracker/contract/backend-module.ts:160` 与 `:248`、`src/tracker/contract/README.md:66-67`、`docs/adr/20261014-tracker-capability-ceiling.md:36`）。老口径点名的三张「非契约面」（`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile`）今天都是契约名录里的正式操作。 |
| 「所有的请求都要走 tracker 层」 | **源码层面成立，但有两条限定要如实写上** | 成立的一半：`src/**/*.ts` 里没有任何产品代码 import 具体房间（只有 `src/tracker/capability-assertions.ts:32-34` 做类型级 import，用来在编译期核对形状），所以产品代码只通过 `Tracker` 实例发请求。限定一：后端**模块对象**（`BackendModule`）上还挂着四个可选成员 `describe?` / `issueAddress?` / `repoSearchAddress?` / `issueRefPattern?`（`src/tracker/contract/backend-module.ts:184`、`:194`、`:197`、`:200`），而 `src/tracker/registry/views.ts:31` 与 `:100` 转发「后端描述 / 一张票的地址」时优先用模块对象、拿不到才用实例上的同名定位口——也就是说这两条能力今天有两个实现落点。限定二：`tests/` 与 `scripts/` 里有直接调后端 `create()` 绕开 tracker 层的地方，条数**未核实**（`research/1027-probe-handoff.md:51-53` 记的是「十几处」，本次没有亲手数）。 |

另外三条与「维护者这句话」直接相关、但不在他话里的现状，一并列出，免得读者以为 25 是「一切都齐了」：

1. **「25」这个数字没有任何门禁在断言。** 契约常量 `CAPABILITIES`（`operations-catalog.ts:114`）今天没有读者——全仓除了它自己那一行，没有任何文件引用它。门禁 `tests/verify-contract-types.js` 把原先「读文本数 25 个名字」那一项**明确退休**了（`tests/verify-contract-types.js:40-41`），今天它只查「契约目录里有没有运行时实现」这类结构问题（`:318-335`）。
2. **契约门禁今天在本机是红的，但红的那一项与条数无关。** 本机跑 `node tests/verify-contract-types.js` 的结果逐项是：第 1 项（`tsc -p tsconfig.contract.json` 零错误）PASS；第 2 项（契约目录没有运行时实现）PASS，输出原话「契约目录下 14 个 .ts 文件都没有运行时实现」；第 3 项拆成两半，前半（两份探针文件自己零报错）PASS、**后半 FAIL**；第 4 项（缺 `matches` 的假后端编不过、且报错点名 `matches`）PASS；第 5 项（三个后端的模块对象真值如初）PASS。唯一那条 FAIL 的原文是「后端文件内部报错 160 条，与基线 161 条相等」（判断代码 `tests/verify-contract-types.js:368-375`；基线常量 `PROBE_NONPROBE_ERROR_BASELINE` 在 `:115` 是 161，实测 160）。这条盯的是「后端实现面的类型债务条数有没有漂」，与契约条数无关；漂动的原因大概率是本工作区有 **30 处未提交改动**（`git status --porcelain` 实测 30 行，含 `src/tracker/rooms/github/{repo,sub-issues,issues,page,counts,client,preflight,repo-permissions}.ts` 等）。我有记录的全绿时点是提交 `79b069ba` 之后的 #1147 收敛记录（#1147 评论 2026-10-14 09:22Z：「探针基线 162→161……契约门禁全绿」）。
3. **每个后端手里有一张「能力登记表」**，25 条逐条登记成三类（明确提供功能 / 明确不支持 / 当前不支持、未来会开发）：GitHub 见 `docs/tracker/capability-github.md`，Markdown 见 `docs/tracker/capability-markdown.md`，GitLab 见 `docs/tracker/capability-gitlab.md`。

---

## ② 契约现状

### 2.1 `src/tracker/contract/` 目录里现在有什么（16 个文件）

目录里共 16 个文件：14 个手写 `.ts`、1 份人读说明 `README.md`、1 个构建产物 `vocabulary.js`（该产物被 `.gitignore:58` 忽略，不入库；由 `scripts/build.mjs:557-561`、`:806-924`、`:1396` 把 `vocabulary.ts` + `label-names.ts` + `identity-keys.ts` + `fix-contract.ts` + `canonical-labels.ts` 五份拼成一段再转译）。门禁自己数出来的也是 14 个 `.ts`（跑门禁时的输出：「契约目录下 14 个 .ts 文件都没有运行时实现」）。

| 文件 | 导出的类型 / 常量 | 一句话说它是干什么的 |
| --- | --- | --- |
| `src/tracker/contract/operations-catalog.ts`（114 行） | `OPERATIONS`（`:62`，22 条）、`LOCATORS`（`:102`，3 条）、`CAPABILITIES`（`:114`，两段拼起来 = 25 条） | **能力名字的唯一真源**：契约里一共有哪些操作、哪些定位口，只有这一份清单说了算。 |
| `src/tracker/contract/operations.ts`（306 行） | `OpName`（`:82`，从 `OPERATIONS` 派生）、`Tracker`（`:97`，26 个成员）、`RoomOperations`（`:304`） | 契约的正式接口：每个操作的参数与返回类型、每条能力的规矩都写在这里。 |
| `src/tracker/contract/index.ts`（313 行） | `OPERATIONS`（`:81`，名录的冻结副本）、`NORMALIZE_RULES`（`:299`）、`TRACKER_CONTRACT`（`:306`） | 契约总纲的散件：归一化规则表与契约版本这类数据，加上按文件名索引的名录副本。 |
| `src/tracker/contract/README.md`（130 行） | —（人读文档，无导出） | 给人读的契约说明书：25 条怎么分段、每个文件管什么、加一条能力的规矩。 |
| `src/tracker/contract/backend-module.ts`（249 行） | `RoomPresentation`（`:41`）、`RoomSetupPrompt`（`:57`）、`RoomLinks`（`:66`）、`RoomCapabilities`（`:75`）、`RoomCheckEntry`（`:92`）、`RoomFixAction`（`:113`）、`RoomFixEntry`（`:133`）、`BackendModule`（`:143`） | 描述「一个后端作为一个模块对象长什么样」：注册时用的 id/label/create/matches，以及界面文案、链接、能力自述、修复动作这些非操作成员。 |
| `src/tracker/contract/identity.ts` | `BackendId`（`:36`）、`State`（`:39`）、`IssueType`（`:42`）、`ClosedReason`（`:50`）、`ActorKind`（`:53`）、`ErrorKind`（`:70`）、`Actor`（`:87`） | 身份类词汇：后端 id、票的状态与类型、关闭原因、人是谁、错的种类。 |
| `src/tracker/contract/entities.ts` | `Label`（`:27`）、`Comment`（`:37`）、`Milestone`（`:55`）、`CustomField`（`:67`）、`Review`（`:77`）、`IssueRef`（`:91`）、`Issue`（`:112`）、`RepositoryRef`（`:163`）、`LabelColor`（`:193`）、`LabelColorChange`（`:203`） | 名词表：一张票、一条评论、一个仓库、一个标签长什么样。 |
| `src/tracker/contract/contexts.ts` | `SandboxFs`（`:25`）、`ExecResult`（`:58`）、`BackendPlatform`（`:78`）、`BackendContext`（`:125`）、`OpContext`（`:156`）、`EnrichedOpContext`（`:184`）、`RepoHandle`（`:196`） | 环境表：每个后端手里拿到什么（沙箱、命令行、平台），每次调用又额外带什么。 |
| `src/tracker/contract/results.ts` | `TrackerError`（`:35`）、`OpResult`（`:47`）、`PreflightResult`（`:56`）、`Selection`（`:69`）、`RepoPermissions`（`:101`）、`Dependencies`（`:114`）、`Counts`（`:126`）、`PageResult`（`:137`）、`LabelColorBatchResult`（`:156`）、`SubIssueList`（`:172`）、`LabelColorsFilePlacement`（`:196`） | 答案表：每条操作回什么形状，成功与失败怎么包。 |
| `src/tracker/contract/inputs.ts` | `ListFilter`（`:29`）、`GetOpts`（`:52`）、`DepsOpts`（`:58`）、`CreateInput`（`:64`）、`InitProjectInput`（`:92`）、`CloseOpts`（`:100`）、`UpdatePatch`（`:109`）、`SetOpts`（`:121`）、`LabelInput`（`:129`）、`AssigneeInput`（`:132`）、`PageOpts`（`:137`） | 提问表：每条操作收什么参数。 |
| `src/tracker/contract/vocabulary.ts` | `BACKEND_KIND`（`:20`）、`STATE`（`:27`）、`ISSUE_TYPE`（`:33`）、`SNAP_MODE`（`:39`）、`CLOSED_REASON`（`:53`）、`ACTOR_KIND`（`:59`）、`FIELD_TYPE`（`:66`）、`ERROR_KIND`（`:75`）、`CONTRACT_VERSION = 1`（`:87`） | 运行时字典：状态名、错误种类这些前后端必须一致的字面量（是数据，不是行为）。 |
| `src/tracker/contract/canonical-labels.ts` | `CANONICAL_LABELS`（`:7`，10 条标签的 name/color/description） | 单源标签清单（#188），只留数组本身；由它现算的名字与集合已搬到 `src/tracker/label-names.ts`（本文件末尾 `:22-25` 有说明）。 |
| `src/tracker/contract/contract-idempotency.ts` | 唯一一行代码是 `export default {}`（`:54`），其余全是注释 | 幂等锚（建票时带的防重复标记）的语义说明；文件里写明三个后端各自把锚落在哪里，以及 GitHub 搜索索引有延迟这条已知边界。 |
| `src/tracker/contract/contract-page.ts`（70 行） | 无导出，纯注释 | 「按页取票」这条操作的语义续篇；因为仓库有「每个文件不超 350 行」的门禁（`tests/verify-file-granularity.js`）而单独拆出来的。 |
| `src/tracker/contract/contract-label-colors.ts`（106 行） | 无导出，纯注释 | 标签配色那两条操作的语义续篇，拆分理由同上。 |
| `src/tracker/contract/vocabulary.js` | 构建产物（拼好的常量段） | 不是手写文件，由构建生成，`.gitignore:58` 忽略。 |

### 2.2 25 条能力名单，与真源在哪

**真源是 `src/tracker/contract/operations-catalog.ts`，不是 `operations.ts` 的某个数组，也不是 `index.ts` 的副本。** 关系是这样：`operations-catalog.ts:62` 写死 22 条操作名；`operations.ts:82` 的 `OpName = (typeof OPERATIONS)[number]` 从它派生；`index.ts:81` 的 `OPERATIONS` 是 `Object.freeze(CATALOG_OPERATIONS)`，即名录的只读副本；`src/tracker/registry/shape.ts` 拿的是同一份名录，用来给没实现的操作补桩。也就是说改一条能力名字，只需要改 `operations-catalog.ts` 一处，其余三处跟着变。

**22 条操作**（`operations-catalog.ts:62-87`，文件自己在 `:53` 的注释里写明「22 条操作的名字」）——**下面按名录里的原顺序抄**：
`preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`、`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile`。

名录自己的注释把这个顺序也定成了规矩（`:59-60`）：「顺序就是上层读到的顺序，也是门禁与金标准逐个核对的顺序；加名字往末尾追加，不要把已有名字挪位置」。最后三条（`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile`）就是本次收编进来的三条，注释 `:82-83` 原话：「下面三条原先分别挂在某一个房间的『房内扩展』名下（没进名录，因此也没有桩）。收进来的理由是同一条：它们的读者都在房外，只有进名录，上层才不用问后端是谁。」

**3 条定位口**（`operations-catalog.ts:102-106`）：
`getRepoKey`、`describe`、`issueAddress`。

**合计 25 条**（`operations-catalog.ts:114`；同一口径也写在 `src/tracker/contract/README.md:44-45`、`docs/adr/20261014-tracker-capability-ceiling.md` 第 2 节、`CONTEXT.md:27` 的词条「能力上限（capability ceiling）」：本轮 25 条，22 条操作加 3 条定位口）。

### 2.3 `Tracker` 接口的 26 个成员，逐个签名

`Tracker` 一共 **26 个成员**：25 条是上面那份名录里的能力，第 26 个是 `id`（后端自己的身份，注册表核对着用）。**带 `?` 的可选成员：0 个**——26 个成员全是必填。（全文里唯一一个 `?` 出现在 `describe` 的**参数**上，`:289` 的 `backendId?: BackendId`，那不是成员可选，注释 `:287` 写明「实例自己知道身份，可以忽略它」。）

下面这张表按**接口里的声明顺序**排，与名录里的顺序不同（名录把 `counts`、`listPage` 排在后面，见 2.2）。

| # | 成员 | 签名（原样抄自 `src/tracker/contract/operations.ts`，行号即出处） |
| --- | --- | --- |
| 1 | `id` | `readonly id: BackendId`（`:99`） |
| 2 | `preflight` | `preflight(handle: RepoHandle, ctx: OpContext): Promise<PreflightResult>`（`:108`） |
| 3 | `list` | `list(repo: RepositoryRef, filter: ListFilter \| undefined, ctx: OpContext): Promise<OpResult<Issue[]>>`（`:111`） |
| 4 | `counts` | `counts(repo: RepositoryRef, filter: ListFilter \| undefined, ctx: OpContext): Promise<OpResult<Counts>>`（`:117`） |
| 5 | `listPage` | `listPage(repo: RepositoryRef, filter: ListFilter \| undefined, opts: PageOpts \| undefined, ctx: OpContext): Promise<OpResult<PageResult>>`（`:123-128`） |
| 6 | `get` | `get(repo: RepositoryRef, key: string, opts: GetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:131`） |
| 7 | `getDependencies` | `getDependencies(repo: RepositoryRef, key: string, opts: DepsOpts \| undefined, ctx: OpContext): Promise<OpResult<Dependencies>>`（`:137-142`） |
| 8 | `create` | `create(repo: RepositoryRef, input: CreateInput, ctx: OpContext): Promise<OpResult<Issue>>`（`:145`） |
| 9 | `close` | `close(repo: RepositoryRef, key: string, opts: CloseOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:148`） |
| 10 | `reopen` | `reopen(repo: RepositoryRef, key: string, ctx: OpContext): Promise<OpResult<Issue>>`（`:151`） |
| 11 | `comment` | `comment(repo: RepositoryRef, key: string, body: string, ctx: OpContext): Promise<OpResult<Comment>>`（`:154`） |
| 12 | `update` | `update(repo: RepositoryRef, key: string, patch: UpdatePatch, ctx: OpContext): Promise<OpResult<Issue>>`（`:157`） |
| 13 | `setLabels` | `setLabels(repo: RepositoryRef, key: string, labels: LabelInput[], opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:160-166`） |
| 14 | `setAssignees` | `setAssignees(repo: RepositoryRef, key: string, assignees: AssigneeInput[], opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:169-175`） |
| 15 | `setParent` | `setParent(repo: RepositoryRef, key: string, parentKey: string \| null, opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:178-184`） |
| 16 | `setBlockedBy` | `setBlockedBy(repo: RepositoryRef, key: string, blockers: string[], opts: SetOpts \| undefined, ctx: OpContext): Promise<OpResult<Issue>>`（`:191-197`） |
| 17 | `getCurrentUser` | `getCurrentUser(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<Actor>>`（`:204`） |
| 18 | `initProject` | `initProject(handle: RepoHandle, input: InitProjectInput, ctx: OpContext): Promise<OpResult<RepositoryRef>>`（`:210-214`） |
| 19 | `listLabels` | `listLabels(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColor[]>>`（`:221`） |
| 20 | `setLabelColors` | `setLabelColors(repo: RepositoryRef, changes: LabelColorChange[], ctx: OpContext): Promise<OpResult<LabelColorBatchResult>>`（`:228-232`） |
| 21 | `getRepoPermissions` | `getRepoPermissions(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>>`（`:241`，注释 `:234-240` 写明三种回法都合规：GitHub 真去问、Markdown 回 `unsupported`、GitLab 由注册表补桩） |
| 22 | `listSubIssues` | `listSubIssues(repo: RepositoryRef, mapKey: string, opts: Record<string, never> \| undefined, ctx: OpContext): Promise<OpResult<SubIssueList>>`（`:254-259`，注释 `:246-247` 写明它进契约的理由：「它的读者是宿主电话，那是房外代码；房外有读者，它就不是某家的实现细节」） |
| 23 | `ensureLabelColorsFile` | `ensureLabelColorsFile(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<LabelColorsFilePlacement>>`（`:270`） |
| 24 | `getRepoKey` | `getRepoKey(cwd: string, ctx: OpContext): Promise<{ owner: string; name: string } \| null>`（`:283`） |
| 25 | `describe` | `describe(handle: RepoHandle, backendId?: BackendId): RepositoryRef`（`:289`） |
| 26 | `issueAddress` | `issueAddress(ref: RepositoryRef, key: string): string`（`:292`） |

配套的一个类型也值得写上，它说明了「后端可以少实现几条」这件事是合法的：`RoomOperations = Partial<Tracker> & { id?: BackendId }`（`:304-306`）——后端真正拿出来的那一份是 `Tracker` 的子集，缺的那些由注册表补桩；三个后端的 `create()` 都标了这个类型，靠这一处标注把「少实现」说清楚，同时把签名核对交给编译器（`:295-303` 的注释原话）。

### 2.4 契约层今天还有没有运行时实现

**规矩仍然成立：契约层只许有类型与数据，不能有行为。** 三条证据：

1. 门禁 `tests/verify-contract-types.js` 的第 2 项专门查这件事，今天跑出来的结果是 PASS：「契约目录下 14 个 .ts 文件都没有运行时实现（只许类型与数据，目录内数据互引除外）」（判断代码在 `:318-335`）。它扫七种「像实现」的写法——`function` 关键字、`class` 关键字、箭头函数赋值、顶层 `new`、运行时 `import`、`require(`、动态 `import(`（`:244-281`，`declare function` / `declare class` 放过，`Object.freeze` 当作合法的数据定型写法），另外查「值引用指到契约目录之外」。
2. 但「有数据」不等于「有类型」：契约目录里确实有可以运行的**值**，只是都是字面量数据——`operations-catalog.ts` 的三个数组、`index.ts:81` 的冻结副本、`index.ts:299`/`:306` 两张常量表、`vocabulary.ts` 的九个字典、`canonical-labels.ts` 的 10 条标签数组、`contract-idempotency.ts:54` 的空默认导出。它们是给实现与界面读的数据，不含行为。
3. 行为被搬走这件事有来源可查：`contract-idempotency.ts` 与 `canonical-labels.ts` 的文件尾注释都写着「由清单现算的东西不住在这里」，指向 `src/tracker/label-names.ts` 一类的隔壁文件（`canonical-labels.ts:22-25`）。

---

## ③ 房内独有接口的现状（题目点名的 12 个名字，逐个）

| 名字 | 今天在哪 | 还在契约里吗 | 必填还是可选 | 是否已升为通用能力 |
| --- | --- | --- | --- | --- |
| `GitHubRoomExtension` | 类型本身已不存在。全仓只剩注释与文档里的历史提及：`src/tracker/contract/operations.ts:14-15`、`src/tracker/contract/backend-module.ts:160` 与 `:248`、`src/tracker/contract/README.md:66-67`、`docs/adr/20261014-tracker-capability-ceiling.md:36`；`research/1027-probe-handoff.md:34` 是旧稿里的记录 | 否 | — | 已退休。它的成员被拆进契约：多数成了 `Tracker` 上的操作，界面文案一类成了 `BackendModule` 的成员。 |
| `MarkdownRoomExtension` | 同上，只剩注释与文档提及（出处同上） | 否 | — | 已退休。 |
| `RoomAuxiliaries` | 同上，只剩注释与文档提及（`backend-module.ts:248` 那句「三个类型退休」是它的墓志铭） | 否 | — | 已退休。 |
| `RoomOperations` | **还在契约里，但含义已换**：`src/tracker/contract/operations.ts:304-306` | 是 | 它是「后端能拿出来的那一份」，不是成员 | 它今天表达的是「`Tracker` 的子集，可以少实现几条」，不是房内独有扩展。 |
| `getRepoPermissions` | 升为正式操作：契约 `src/tracker/contract/operations.ts:241`；GitHub 实现 `src/tracker/rooms/github/backend.ts:165-175`；Markdown 明确不支持 `src/tracker/rooms/markdown/index.ts:222`；GitLab 由注册表补桩 | 是（22 条操作之一） | 必填（`Tracker` 成员，无 `?`） | 是。老口径（`research/1010-room-conformity-checklist.md`）记的是「GitHub 独有、不进契约」。 |
| `listSubIssues` | 升为正式操作：契约 `operations.ts:254-259`；GitHub 实现 `backend.ts:109`；Markdown 明确不支持 `index.ts:224`；GitLab 由注册表补桩 | 是（22 条操作之一） | 必填 | 是。老口径记的是「GitHub 独有，读路径实现细节、不进契约的 OPERATIONS」——它进契约的理由写在 `operations.ts:246-247`：「它的读者是房外代码」。 |
| `ensureLabelColorsFile` | 升为正式操作：契约 `operations.ts:270`；Markdown 实现 `index.ts:218`；GitHub 由注册表补「不支持」桩，登记为「当前不支持、未来会开发」（`docs/tracker/capability-github.md`） | 是（22 条操作之一） | 必填 | 是。老口径记的是「Markdown 独有」。 |
| `normalize` | **已从实例上摘掉**。今天只有房内私有函数 `src/tracker/rooms/markdown/normalize.ts:4`：`normalizeIssue(text: unknown, meta: ParseMeta): Issue` | 否 | — | 没有升进契约。理由是 #1051 决策 11：它没有房外读者，真要做成契约成员，返回类型只能写 `unknown`，等于没承诺。 |
| `parse` | 同上：今天只有房内私有函数 `src/tracker/rooms/markdown/parse.ts:94`：`parseMd(text: unknown, meta: ParseMeta): Issue`（把 Markdown 票文本解析成一张票） | 否 | — | 没有升进契约，理由同上。 |
| `getRepoKey` | 升为定位口：契约 `operations.ts:283`；GitHub 实现 `src/tracker/rooms/github/backend.ts:160`；Markdown 没有这条（本地没有远端仓库要解析），GitLab 也没有 | 是（3 条定位口之一） | 必填（成员无 `?`） | 是。 |
| `describe` | 升为定位口：契约 `operations.ts:289`（成员必填，参数 `backendId?` 可选）。今天有两处落点：GitHub 实例 `backend.ts:155` 与模块对象 `src/tracker/rooms/github/index.ts:32`；Markdown 只在模块对象上 `src/tracker/rooms/markdown/index.ts:87`，实例上没有；GitLab 实例 `src/tracker/rooms/gitlab/index.ts:182`（模块对象上也有） | 是（3 条定位口之一） | 成员必填 | 是，但注意「模块对象 + 实例」两处并存这件事（见 ①的限定一）。 |
| `issueUrl` | **这个名字今天已经不存在**：全仓 `src/` 零命中。它在 #1133 / #1134 / #1135 被改名成 `issueAddress`（本地 Markdown 后端给的可能是文件路径，路径也是地址，所以不再叫「网址」），旧名由 #1141 的提交 `856636a1`（「注册表与契约层删掉链接三件的旧名字，别名窗口到此关闭」）连同 `searchUrl`、`linkPattern` 一起删除。今天只剩历史记录：`CHANGELOG.md:662` 与 research 目录里的旧稿 | 否（以旧名存在）；新名 `issueAddress` 是定位口，契约 `operations.ts:292` | 新名必填 | 已升为定位口并改名。 |

一句话归纳第 ③ 节：题目点名的 12 个名字里，**3 个类型已退休、2 个房内私有函数被摘掉且没有升进契约、1 个旧名字被改名删除，其余 6 个今天都住在契约名录里**（3 条操作 + 3 条定位口）。今天在两个房间里，不存在「只有某个后端才叫得到、契约里没有对应名字」的对外方法。

---

## ④ 两房实现现状（逐个能力，三档：有功能 / 返回不支持 / 未实现交由注册表补桩）

### 4.1 GitHub 房（`src/tracker/rooms/github/`）

形状由两处钉死：`GithubBackendMembers`（`backend.ts:36-43`）列的是 `id` + 24 条能力；`GithubBackendShape`（`backend.ts:46`）要求逐条精确同形；`createGithubBackend`（`backend.ts:95`）返回的对象用 `satisfies GithubBackendShape`（`backend.ts:176`）收口。

| 档 | 条目 |
| --- | --- |
| 有功能（21 条操作） | `preflight`、`list`、`counts`、`listPage`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`listLabels`、`setLabelColors`、`getRepoPermissions`（`backend.ts:165-175` 内联实现）、`listSubIssues`（`backend.ts:109`） |
| 自己写桩回「不支持」 | 无 |
| 未实现、由注册表补桩 | `ensureLabelColorsFile`（唯一一条；`docs/tracker/capability-github.md` 登记为「当前不支持、未来会开发」，理由写在 `operations.ts:266`：GitHub 的标签颜色存在仓库标签上，没有本地文件可放。#1054 的评论原话是「24 条实现 + 1 条未来会开发，没有『不支持』的条目」） |
| 定位口（3 条全提供） | `getRepoKey`（`backend.ts:160`）、`describe`（实例 `backend.ts:155`、模块对象 `index.ts:32`）、`issueAddress`（实例 `backend.ts:156`、模块对象 `index.ts:33`） |

模块对象 `githubModule`（`src/tracker/rooms/github/index.ts:197-233`）的键集：`id`、`label`、`presentation`、`setupPrompt`、`create`、`matches`、`describe`、`issueAddress`、`repoSearchAddress`、`issueRefPattern`、`links`、`capabilities`、`openRepository`、`prompts`、`checks`、`fixes`。

### 4.2 本地 Markdown 房（`src/tracker/rooms/markdown/`）

形状同样由三处钉死：`MarkdownBackendMembers`（`index.ts:30-37`）列的是 `id` + 22 条能力；`MarkdownBackendShape`（`index.ts:40`）；`createMarkdownBackend`（`index.ts:143`）返回的对象用 `satisfies MarkdownBackendShape`（`index.ts:225`）收口。

| 档 | 条目 |
| --- | --- |
| 有功能（18 条操作） | `preflight`（`index.ts:146-191`）、`list`（`:192`）、`counts`（`:195`）、`listPage`（`:198`）、`get`（`:199`）、`getDependencies`（`:200`）、`create`（`:201`）、`close`（`:202`）、`reopen`（`:203`）、`comment`（`:204`）、`update`（`:205`）、`setLabels`（`:206`）、`setAssignees`（`:207`）、`setParent`（`:208`）、`setBlockedBy`（`:209`）、`listLabels`（`:212`）、`setLabelColors`（`:213`）、`ensureLabelColorsFile`（`:216`） |
| 明确返回「不支持」（四条自己写的桩） | `getCurrentUser`（`:219`）、`initProject`（`:220`）、`getRepoPermissions`（`:222`）、`listSubIssues`（`:224`） |
| 未实现、连桩都没写 | 无（22 条操作要么有功能、要么自己写了「不支持」，没有留给注册表补的） |
| 定位口 | `describe`（`index.ts:87`）与 `issueAddress`（`index.ts:118`，算不出票文件名时回空串，见 #1144）只挂在模块对象上，实例上没有这两条；`getRepoKey` 实例与模块都没有（本地后端的身份就是工作区目录本身，`operations.ts:281` 有解释）。模块对象上另有 `repoSearchAddress`（`index.ts:123`，函数体就是 `return ''`）与 `issueRefPattern`（`index.ts:125`，值是字符串 `"#(\d+)"`） |

能力登记表 `docs/tracker/capability-markdown.md` 的结论与上面一致：22 条操作里提供 18 条、明确不支持 4 条；3 条定位口里提供 2 条（`describe` 与 `issueAddress` 交给模块对象），`getRepoKey` 明确不支持。

### 4.3 旁注：GitLab 房（题目没点名，但它是第三个后端，列一行免得读者以为只有两房）

`src/tracker/rooms/gitlab/index.ts` 文件头注释（`:168-173`）自述「今天实现了 13 条操作 + 2 条定位口」，没实现的由注册表补桩；实例上有 `describe`（`:182`）与 `issueAddress`（`:183`），**没有** `getRepoKey`。

---

## ⑤ 最近的提交与地图 08 的结论原文

### 5.1 最近改了些什么

`git log --oneline -25` 的头几条（新到旧）：`ef7d42f5` 把时间压缩助手补成有类型的 TypeScript（#1146）、`5efa86f2` 给写路径的结论线补一台专属门禁（42 项断言盯着七个字段与走了哪条路）、`db3103cf` 给依赖规则门禁补…（#1136）、`3475b911` 给 GitHub 房的写票路径补一条常驻结论线、`d1753096`…、`0b55ae6e` 判定收全证据再合成…（#1048 复核补做）、`d4e1cfa1` 补齐房间纪律的四处表述并加一份可手跑的样本门禁（#1136）、`0598d04a` 把 GitHub 后端开仓库方式的类型收回二选一、`0bd83612` 修好房间纪律的规则起点并把白名单换成带理由与票号的结构化登记表（#1136）、`054eabb0` 把 GitHub 房读路径文件头改回今天的真名（#1052）、`53603c70`、`f73e9346`、`4e69fd4d` 补上 #1136 的 ADR、`1edc1f84`、`21f4e518`、`ba469f86`（#1155）、`79b069ba` 收敛 #1147 尾巴、`3dc4f6b1` 跟踪器配置让出契约域（#1148 定、落在 #1147 的文件上）、`f1438ef1`、`63e3773e`、`8f94ca87`（#1146）、`8b5bcd01`（#1013）、`40ce748a`、`5e7c74aa`、`40c222dd`（#1144 / #1148）。

`git log --oneline -12 -- src/tracker/contract src/tracker/rooms`（只这两个目录，新到旧，全部列出）：

| 提交 | 与「条数变化 / 升进契约 / 消除房内独有接口」的关系 |
| --- | --- |
| `6782b71a` 关系与边的写前对账改成先问真值，并补上四条边诊断线（#1054） | 最新一笔，改的是实现面，不动契约条数。 |
| `5efa86f2` 给写路径的结论线补一台专属门禁，42 项断言盯着七个字段与走了哪条路 | 门禁，不动条数。 |
| `3475b911` 给 GitHub 房的写票路径补一条常驻结论线，一趟写没写下去都能查 | 日志埋点，不动条数。 |
| `d4e1cfa1` 补齐房间纪律的四处表述，并加一份可手跑的样本门禁（#1136） | 文档与门禁。 |
| `0598d04a` 把 GitHub 后端开仓库方式的类型收回二选一，不再被放宽成字符串 | 类型收紧，不动条数。 |
| `0bd83612` 修好房间纪律的规则起点，并把白名单换成带理由与票号的结构化登记表（#1136） | 纪律与登记表。 |
| `054eabb0` 把 GitHub 房读路径文件头改回今天的真名，并改掉一处已经不成立的旧结论（#1052） | 注释纠错（文件头曾是过时数字的来源）。 |
| `79b069ba` 收敛 #1147 尾巴：补上整仓回退缺的导入，判定文件让出跟踪器配置，探针基线跟进 | 修 `graph.ts:242` 的死代码复活、探针基线 162→161；#1147 收尾。 |
| `2482604f` 跟踪器域转成 TypeScript 并立起能力断言，门禁里被接管的四项随之拆除（#1147） | **关键**：`.ts` 化 + 建立 `src/tracker/capability-assertions.ts` 的编译期断言，并拆掉契约门禁里被断言接管的四项。 |
| `ffd5848a` 修好本地 Markdown 后端给票地址时按编号猜文件名（#1144） | 定位口实现修正。 |
| `474602bd` 决策 11 按 A 落地：新增已补全上下文类型，两处补全点注释指过去（#1147） | #1147 决策 11 的落地。 |
| `c8d7ef0a` 把 Tracker 能力上限落到 25 条：契约收编后端独有方法并补齐注册表桩 | **最关键**：契约定义 25 条能力上限（22 条操作 + 3 条定位口），删除房内扩展与旁路类型，后端只回答「实现」或「不支持」，注册表按名录补桩。提交正文自报「18 files changed, 455 insertions(+), 257 deletions(-)」，关联 #1051。 |

再往前两条与条数直接相关的（不在上面这 12 条的时间窗内，但在同一天更早）：`aafa3716` 契约操作名录收成单源并把过时注释改成真话（#1026）、`95226de2` 契约门禁改写…撤掉两条旧同集断言（#1026）、`5090d305` 把契约目录里的三份行为搬到隔壁并同步实现侧引用，契约目录只留类型与数据（#1026）。

### 5.2 地图 08（#1050）讨论票的结论原文

**#1050「地图08GitHub房：真实读写主路径」**（`wayfinder:map`，今天仍 OPEN）——它今天**一条评论都没有**（`gh issue view 1050 --comments` 实测返回空），结论都写在正文里：

- 「做完的标志」一节原话：「……GitHub 后端对契约要求的每一条能力逐条给出『实现』或诚实的『不支持』，不允许出现『方法不存在』」。
- 「Decisions so far（2026-10-14）」一节原话：「契约层定能力的上限，后端只回答『实现』或『不支持』，任何后端独有的对外方法都要在契约层定义；新版契约层共 25 条能力（补 6 条、摘 2 条、三个类型退休）；门禁按『先建后删』四步处置」。
- 「Notes」一节的原文（两行）：「结论的固化物是规格单 #1147（挂在地图02 下，已打 `ready-for-agent`）：契约层补能力上限、三条编译期断言、门禁先建后删。」「结论定下的顺序：**契约层的能力清单与代码形状先补齐（#1147），再做本图的 GitHub 全面实现。** 因此本图被 #1147 阻塞。」
- 另外，本图「Decisions so far」里还记着后面几天的收尾（原文摘两句）：「开发票『关系与边转 TypeScript』#1054 已关闭：……完整 25 条 GitHub 能力登记表写进该票评论（24 条实现 + 1 条未来会开发）」；以及一条关于门禁现状的自述：「另：干净检出上 `verify-log-count.js` 与 `verify-log-fields.js` 现在会红……所以本图『门禁全绿』这句现在还不能算数」——后一条在 #1054 的提交 `6782b71a` 与登记提交 `5ae07557` 之后由它自己记为「到此消掉」。

**#1051「地图08讨论：契约第一次被真后端压」**（`wayfinder:grilling` + `wayfinder:task`，已 CLOSED）——结论在它的定稿评论里，本次相关的原文：

- 总纲标题「契约层定能力的上限」，规矩的名字定为「**契约定能力上限**」（不用「归属原则」，那个词已被目录归属占用）；原话：「契约层（Tracker 层）定义全部能力的上限。后端只回答两件事——『这项能力我实现』或者『我不支持』；后端不回答『别人有没有』。**任何后端独有的对外方法都不允许存在，必须在契约层定义。** 返回『不支持』也算一种实现，前提是我们心里有数。」
- 「### 新版契约层的能力条数」一节的原文：「今天 `src/tracker/contract/operations-catalog.ts:37-57` 写死 19 条操作名；`getRepoPermissions` 是第 20 个成员，可选、不在名录里。」「本次补进 6 条：`listSubIssues`、`getRepoPermissions`、`getRepoKey`、`describe`、`issueUrl`、`ensureLabelColorsFile`。」「本次摘掉 2 条：`normalize`、`parse`（从后端的 `create` 返回里拿掉，不写进契约）。」「**新版合计 25 条。** 三个类型退休：`GitHubRoomExtension`、`MarkdownRoomExtension`、`RoomAuxiliaries`。」
- 登记口径原文：「对 25 条逐条审查，登记成三类：**N 条明确提供功能、M 条明确不支持、L 条当前不支持、未来会开发。** 这张表今天全仓不存在，必须一条一条审出来，不许估。」
- 十三块决策里本次相关的原文：Q4「**契约外成员（Q4）**：全部升进契约层（维护者推翻原推荐）。」；Q9「**升法（Q9）**：一律用「正式操作」这种写法——进 `OPERATIONS` 名录、进 `Tracker`，注册表给没实现它的后端自动补一句「做不到」，房外调用方不必先问「这个方法有没有」。」；Q10「**Q10**：后端不许有任何独有的对外方法。」；Q11「**归一化与解析（Q11）**：摘掉。理由是没有房外读者，而且它们在契约里的返回类型只能写 `unknown`——一个返回 `unknown` 的契约成员是一句空话的承诺。摘之前做一次全仓动态取用核查。」
- 门禁处置表（`tests/verify-contract-types.js` 守八件事逐条归属）：五条判「删」（缺件即红、契约目录没漏编、19 个操作名齐、反面证明、运行时腿键快照），一条「不是门禁，不能删」（跑 `tsc` 零错误），一条「先找替代再收」（契约目录没有运行时实现），一条「随三张开发票转写退休」（两份探针编译，当时基线 155 条）；顺序是四步不可挪（先立 tsconfig、再写三条类型断言、再确认 tsc 真会红、最后删被接管的五件）。
- 落地记录指向提交 `c8d7ef0a`；关闭记录写明经过对抗式审查通过（5 点，含收拢提交 `56f61fac`），其中第 3 点原文：「受改动直接影响的五份测试全绿……契约门禁全绿；跟踪器契约测试 792 通过（含 4 条预期的违规桩失败）」，第 5 点原文：「全仓搜旧数量『19 条操作』：剩下的都是历史文档、无关计数（标签数等）或有意记录变更的注释，**无活代码断言旧数量**。」

**#1147「契约层补齐能力上限：25 条能力定稿、三条编译期断言、门禁先建后删」**（`ready-for-agent` + `wayfinder:task`，今天 OPEN，9 条评论）——它是 #1051 结论的固化票，正文原话：

- 「契约名录里写死 19 条操作，另有 6 项能力只挂在某一个后端自己身上（子票列表、仓库权限查询、仓库标识补全、后端描述、票面链接、配色文件放置入口）。契约层没有它们的正式位置，上层要调用就得先问『这个方法在不在』。」
- 「补齐能力的正式定义（25 条）。两个后端不许再有自己的对外方法；上层调用只有一条路径——直接调，拿到结果或者拿到一句诚实的『不支持』。」
- 「每个后端产出一张能力登记表。对 25 条逐条审查，每条明确登记成三类之一：明确提供功能、明确不支持、当前不支持、未来会开发。」
- 用户故事原话：「作为写后端的人，我希望『我不支持这项能力』是一句诚实的回答，而不是『方法不存在』，这样上层能区分『这个后端做不到』和『有人写错了』。」「作为写后端的人，我希望注册表自动给没实现的能力补一句『做不到』，这样我不必为每一项不支持的能力手写桩。」
- 最新一条评论（2026-10-14 09:22Z，`79b069ba`）：「探针基线 162→161……跟踪器配置 0 报错；**契约门禁全绿**；跟踪器大套件 792 通过 + 4 已知失败。」

**开发票的能力登记结论**：

- #1054「地图08开发：关系与边转TypeScript」（已 CLOSED）的评论原话：「完整 25 条 GitHub 能力登记表已汇总进本票评论（24 条实现 + 1 条未来会开发，没有『不支持』的条目）。」
- #1052「地图08开发：读路径转TypeScript」（OPEN）的正文写：「本片涉及的能力逐条有『实现 / 不支持』的明确答案」，并写明完整 25 条总表由 #1054 汇总。
- 地图 08 的五张子票：`#1051` 讨论（CLOSED）、`#1052` 读路径（OPEN）、`#1053` 写路径（OPEN）、`#1054` 关系与边（CLOSED）、`#1055` 讲解（OPEN）。

**一件事顺带核实了：**「所有请求都要走 tracker 层」这句在源码与文档里**没有逐字对应的硬条文**。今天能拿到的最近表述是 ADR `docs/adr/20261014-tracker-capability-ceiling.md` 第 1 条「后端不许有独有的对外方法：实例上能叫到名字的东西，必须先在契约名录里出现」与 `src/tracker/contract/README.md:44-45`、`CONTEXT.md:27` 的同义句。判断「走 tracker 层」只能靠这两条加上「产品代码不 import 具体房间」这个事实（实测：`src/**/*.ts` 里只有 `capability-assertions.ts` 做类型级 import）。

---

## ⑥ 与 19 条老口径的差异对齐表

老口径出处：`research/1010-room-conformity-checklist.md:4`（2026-10-11，第二批子任务 C）——「契约的 19 个操作名清单见 `src/host/tracker/contract.js:58-74`（亲手数过 19 项）」。今天这 19 条**全部还在**，一条没被摘掉。

### 6.1 25 条完整名单（★= 19 条老名单里的，☆= 新增）

| # | 名字 | 段 | 老口径里有吗 | 从哪来（新增的 6 条的来源） |
| --- | --- | --- | --- | --- |
| 1 | `preflight` | 操作 | ★ | — |
| 2 | `list` | 操作 | ★ | — |
| 3 | `counts` | 操作 | ★ | — |
| 4 | `listPage` | 操作 | ★ | — |
| 5 | `get` | 操作 | ★ | — |
| 6 | `getDependencies` | 操作 | ★ | — |
| 7 | `create` | 操作 | ★ | — |
| 8 | `close` | 操作 | ★ | — |
| 9 | `reopen` | 操作 | ★ | — |
| 10 | `comment` | 操作 | ★ | — |
| 11 | `update` | 操作 | ★ | — |
| 12 | `setLabels` | 操作 | ★ | — |
| 13 | `setAssignees` | 操作 | ★ | — |
| 14 | `setParent` | 操作 | ★ | — |
| 15 | `setBlockedBy` | 操作 | ★ | — |
| 16 | `getCurrentUser` | 操作 | ★ | — |
| 17 | `initProject` | 操作 | ★ | — |
| 18 | `listLabels` | 操作 | ★ | — |
| 19 | `setLabelColors` | 操作 | ★ | — |
| 20 | `getRepoPermissions` | 操作 | ☆ | 原来只挂在 GitHub 房（老口径第二节记的「GitHub 独有」），#1051 补进契约 |
| 21 | `listSubIssues` | 操作 | ☆ | 原来只挂在 GitHub 房，老口径明说它是「读路径实现细节、不进契约的 OPERATIONS」；#1051 以「读者是房外代码」为由补进契约（`operations.ts:246-247`） |
| 22 | `ensureLabelColorsFile` | 操作 | ☆ | 原来只挂在 Markdown 房（老口径第二节记的「Markdown 独有」），#1051 补进契约 |
| 23 | `getRepoKey` | 定位口 | ☆ | 原来是 GitHub 房内旁路键（老口径第四节列出），#1051 补进契约，位置是新建的定位口段 |
| 24 | `describe` | 定位口 | ☆ | 原本是房内旁路键，且历史上还同时存在「独立子票」的设想（老口径第四节注）；#1051 补进契约的定位口段 |
| 25 | `issueAddress` | 定位口 | ☆ | 就是 #1051 结论里的 `issueUrl`。#1133 / #1134 / #1135 把它改名为 `issueAddress`，旧名连同 `searchUrl`、`linkPattern` 由 #1141（提交 `856636a1`）删除 |

被摘掉的 2 条（#1051 结论里的「摘 2 条」）：`normalize`、`parse`。它们**本来就不在那 19 条里**——老口径是作为「房内旁路键」记在第四节的，今天退回成 Markdown 房的私有函数（`src/tracker/rooms/markdown/normalize.ts:4`、`src/tracker/rooms/markdown/parse.ts:94`）。

### 6.2 三个数字怎么对上

- 老口径：**19 条操作**，没有「定位口」这一段，另外有三项能力只挂在某一个后端的实例上（`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile`）。
- 今天：**19 + 3 = 22 条操作**（补进 3 条操作），**+ 3 条定位口**（`getRepoKey`、`describe`、`issueAddress`，其中 `issueAddress` 是 `issueUrl` 改名而来），**= 25 条**。
- 所以「25」对应的准确说法是「22 条操作 + 3 条定位口」，不是「25 条操作」；相对老口径是净增 3 条操作 + 新增一段 3 条定位口，同时摘掉 2 个房内私有函数、退休 3 个类型。
- 还有一处「可选变必填」的变化值得记上：改造之前 `getRepoPermissions` 是 `Tracker` 上的**第 20 个成员，而且是可选的、不在名录里**（#1051 结论原文：「今天 `src/tracker/contract/operations-catalog.ts:37-57` 写死 19 条操作名；`getRepoPermissions` 是第 20 个成员，可选、不在名录里」）。今天它是名录里的正式操作、`Tracker` 上的必填成员（`operations.ts:241`），并且由 `src/tracker/capability-assertions.ts:57-58`、`:70` 两条编译期断言盯着「三个后端一个都不许漏」。也就是说今天 `Tracker` 上**一个可选成员都没有**（见 2.3）。

### 6.3 有没有门禁或测试断言「契约条数」这个数字

| 位置 | 断言什么 | 与「25」的关系 |
| --- | --- | --- |
| `tests/verify-contract-types.js:40-41` | 门禁自己的说明：原「接口清单齐（读文本数 25 个名字）」这一项**已退休** | 它**曾经**就是数那个数字的那道门禁，今天不再数了。 |
| `src/tracker/capability-assertions.ts:37-47` | 编译期集合相等：名录里的名字（`OPERATIONS ∪ LOCATORS`）与 `Tracker` 的键（去掉 `id`）互为子集；走错一边都**编不过** | 这是今天盯「条数」的正式手段，但它盯的是**两个集合一致**，不钉具体数字——加第 26 条能力时它不会报警，只有「名录里有、接口上没有」或反过来才会。 |
| `src/tracker/capability-assertions.ts:69-72` | 三个后端的工厂**不许有契约之外的对外成员**（`_NoExcessMembers`） | 盯的是「房内独有接口」这一条，不是条数。 |
| `tests/tracker-contract/sections/contract.js:13-27`、`:54-56` | 把 22 条操作名单**逐个写死**与 `OPERATIONS` 做全等比对（`JSON.stringify` 相等），另有「无 `detect`/legacy/snapshot 混入」（`:57`）、「`TRACKER_CONTRACT.operations` 与 `OPERATIONS` 同一引用」（`:58`）、「`OPERATIONS` 冻结」（`:59`） | 这是全仓唯一把数字写死成清单的地方，但它只管 **22 条操作**；3 条定位口在测试里没有任何对应的全等断言。这条测试经由 `tests/verify-tracker-contract.js` 跑，而它挂在 `package.json:23` 的 `verify` 长链里。 |
| `operations-catalog.ts:114` 的 `CAPABILITIES` | 定义为两段拼接的 25 条 | **今天没有任何读者**：全仓除定义那一行外，没有文件引用 `CAPABILITIES`。也就是说「25」这个合计数既没有运行时消费者，也没有门禁断言。 |

结论：**「25」这个数字今天没有一个门禁在断言。** 有的是「22 条操作与写死清单全等」这条测试（`tests/tracker-contract/sections/contract.js`）、以及「名录与 `Tracker` 互为子集」和「后端不许有多余成员」这两条编译期断言（`src/tracker/capability-assertions.ts`）。

---

## ⑦ 未核实事项

1. **「所有的请求都要走 tracker 层」没有逐字条文**（`docs/adr/20261014-tracker-capability-ceiling.md` 第 1 条与 `src/tracker/contract/README.md:44-45` 是最近表述），我按这两条判定。如果维护者指的是别的成文规矩，那一处我没找到。
2. **`tests/` 与 `scripts/` 里绕开 tracker 层直接调后端 `create()` 的条数未核实。** 我只亲手确认了 `src/**/*.ts` 里没有产品代码 import 具体房间（唯一的 import 是 `src/tracker/capability-assertions.ts:32-34` 的类型级 import）。旧稿 `research/1027-probe-handoff.md:51-53` 记的是「十几处」，本次没有数。
3. **契约门禁今天在本机是红的，红的不是「条数」那一项。** 第 3 项 FAIL：「后端文件内部报错 160 条，与基线 161 条相等」（基线常量 `tests/verify-contract-types.js:115` = 161，实测 160）。本工作区有 30 处未提交改动（含 GitHub 房的 8 个文件），我无法在不改动工作区的前提下确认干净树干上的同一条门禁结果；有记录的全绿时点是 #1147 评论里的 `79b069ba` 之后。这一条与契约条数无关，但它说明「契约门禁现在是红的」这句话今天在本机是真的。
4. **`BackendModule` 上四个可选成员与实例定位口并存这件事的性质未核实。** 事实是清楚的：`describe?` / `issueAddress?` / `repoSearchAddress?` / `issueRefPattern?` 四个可选成员挂在模块对象上（`src/tracker/contract/backend-module.ts:184`、`:194`、`:197`、`:200`），`src/tracker/registry/views.ts:31` 与 `:100` 转发时优先用模块对象、退回实例。这算不算「某个后端独有的接口」，或者算不算「同一个能力有两处实现落点」，我没有找到成文裁决，照实写在这里，不下判断。
5. **`src/tracker/registry/views.ts:118` 与 `:131` 从实例上读 `issueRefPattern` / `repoSearchAddress`，而 `Tracker` 接口没有声明这两个成员**，今天也没有任何房间在实例上实现它们。这两处读法是否会随 #1147 的收尾而改，未核实。
6. **历史文件头里的旧数字没有逐条追。** `src/tracker/contract/contract-page.ts`、`contract-label-colors.ts` 等文件的头部注释沿用了 `.js` 时代的文件名（如「tracker/contract-page.js」），提交 `054eabb0` 正在做「把文件头改回今天的真名」这件事（#1052）；哪些文件头还剩旧数字，本次没有逐个清点。
7. **地图 08 的 #1055「讲解：带你读 GitHub 房」（OPEN）没有读**，它可能含对条数的另一种表述；本次只读了 #1050、#1051、#1052、#1053、#1054、#1147。
8. **一份旧稿对 `Tracker` 成员数的说法与本次亲手数的不一致。** `research/1052-capability-read-path.md:238` 写「`Tracker` 的 25 个成员里也含 `id`」；本次亲手数 `src/tracker/contract/operations.ts:97-293` 的接口声明是 **26 个成员**（25 条能力 + `id`），逐个列在 2.3 的表里。冲突记在这里，我没有去改那份旧稿，也没有找到裁决这条口径的成文结论。
9. **`CAPABILITIES` 的注释说「门禁拿它逐条核对」，但今天没有这样的门禁。** `operations-catalog.ts:112` 的原话是「门禁拿它逐条核对契约文件里有没有对应的成员声明，少一条判红」；全仓引用 `CAPABILITIES` 的地方只有 `operations-catalog.ts:24`、`:114` 与 `src/tracker/contract/index.ts:79`、`README.md:126` 这些注释/文档，没有任何 `.js`/`.ts` 代码读它。真正在做那件事的是编译期断言 `src/tracker/capability-assertions.ts:45`、`:47`（见 6.3），两者不是同一处，注释里的说法今天不准确。
