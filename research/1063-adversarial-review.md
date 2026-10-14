# #1063 对抗式审查：提交 f3c16cb7（GitLab 房补齐 25 条能力）

审查对象：`f3c16cb7`「GitLab 房补齐到契约 25 条能力，并把登记表与交接说明改成同一件事（#1064）」，15 个文件、约 2500 行。
工作区停在该提交上（`git log --oneline -1` = f3c16cb7）。本审查没有改仓库里任何文件，临时脚本都放在 `D:\Temp\adv1063\`。

## 一句话总判

**主体做对了，票面有两条说法不成立，所以这次交付不能算「做对了」，应当返工后再结。**

站得住的部分：九条能力是真写出来的（不是空壳，我用脚本化的 `glab` 逐条跑过，见第三节），
`ensureLabelColorsFile` 如实回 `unsupported`，25 条能力**确实没有任何一条靠注册表补桩**（我用注册表实调用逐条验过），
tsc 与题面点名的七道门禁我都亲自跑过、全绿。

站不住的部分：

1. 票面第 5 条「判据没有放宽」是**假的**。三处契约测试断言不是「换了个口径」，而是换成了
   「只要失败得好看就算过」——我拿仓库自己的判据函数喂进空壳回答，三处全部放行（发现 1，有可复现构造）。
2. 九条里 `listLabels` 与 `setLabelColors` 这一对**口径打架**：列表会把上层分组的标签一起列出来，
   而改色那条按 GitLab 源码只认项目自己的标签，于是列表里那些标签一改色就报「找不到这个标签」
   （发现 2，按 GitLab 源码核过）。
3. `getRepoPermissions` 的 `triage` 门槛（20）与官方权限表不符，而且它写下的「依据」有两处与事实对不上：
   官方表里那一行是从 Planner(15) 起有，契约里也从来没有它引用的那句话（发现 3，`git log -S` 可证）。

## 十条攻击面逐条结论

| # | 攻击面 | 结论 |
|---|---|---|
| 1 | 第 1 条声称是不是假的（有没有靠补桩） | **成立**。25 条逐条实调用，24 条由房间自己实现，`ensureLabelColorsFile` 由注册表补桩回 `unsupported`；`getRepoKey` 是房间自己交的（不存在「缺席时注册表给什么」这个问题） |
| 2 | 九条是否与 GitLab 官方文档相符 | **七条相符、一条不相符、一条只对一半**：`counts`/`listPage`/`setLabelColors` 的端点、参数、颜色格式、`listSubIssues` 的链接类型全部与官方文档一致；`getRepoPermissions` 的 push=30 对、triage=20 错；`listLabels` 的端点对，但没关掉默认打开的祖先分组标签，与自家改色口径冲突 |
| 3 | 边界与错误路径 | **没有真正严重的静默吞失败**。空批次、重名、单条失败、全部失败四条路我都实跑过；全部失败时返回 `ok:true` + `failed` 全满，这是契约要求的「逐条记账」，不算吞失败。只有两处 catch 支路不落日志（发现 12）；`listPage` 在整除时会多给一个游标（发现 9） |
| 4 | 三处测试断言是不是被悄悄放宽 | **是，被放宽了，而且我构造出了反例**（发现 1，严重） |
| 5 | 能力登记三处一致性门禁能不能被骗 | **能**。门禁只比对「数据 ↔ 文档表 ↔ 成员集合的类型形状」，一个字都不看运行时行为；把一条写成 `provided` 的空壳能全绿地过掉所有门禁（发现 6） |
| 6 | 房间纪律（跨房引用） | **没问题**。`src/tracker/rooms/gitlab/` 下没有一条 import 指向别的房间，只有注释里提到 GitHub 房的路径当例子 |
| 7 | 日志纪律 | **没问题，但门禁拦不住拼错**。房内只有 `read-log.ts` 调 `ctx.logEvent`；事件名与三个 reason 取值都在登记表内（我逐条比对过）；两个门禁能拦「未知事件名/未知字段键」，拦不住「reason 写错一个字」（发现 7） |
| 8 | 交接说明是否说谎或过时 | **有一句是错的、有三处未说明**（发现 5、发现 8、发现 10） |
| 9 | TypeScript 与门禁 | **全绿**：`tsc -p src/tracker/tsconfig.json` 零输出；`verify-tracker-contract.js` 末行 `CONTRACT SKELETON OK`（另有 4 条 `violating-stub` 的故意 FAIL，与票面一致）；`verify-capability-register.ts`、`verify-1161-rooms-assembly-samples.ts`、`verify-1136-room-cross-sample.ts`、`verify-golden-receipts.ts`、`verify-contract-types.js`、`verify-log-fields.js`、`verify-log-count.js` 全过 |
| 10 | 有没有该做而没做（空壳） | **九条都不是空壳**，参数也都往下传了（`initProject` 的 `visibility` 契约只有 `'public' \| 'private'` 两值，映射没有丢）。真正「该做而没做」的是**正向行为测试**：九条里只有 `counts` 有一条针对 GitLab 的探针，而它刚被放宽；其余八条在整个仓库里没有任何一条断言验过它们真能拿到数据 |

## 发现清单

### 发现 1（严重）三处契约测试判据被放宽，空壳实现照样过

**文件与行号**

- `tests/tracker-contract/sections/counts.js:230-239`（新判据在 239 行）
- `tests/tracker-contract/sections/labels.js:382-393`（三个新判据 + 两条断言）
- `tests/tracker-contract/sections/listPage.js:75-91`（`pageProbeCheck`）

**事实**

改动前，这三处断言的判据是「GitLab 房还没实现这两条操作，注册表自动补桩，所以必须回 `unsupported` 这个诚实答案」
（`unsupportedAnswerCheck(...).length === 0`）。改动后：

- `counts.js:239` 的新判据是 `r.ok === false && typeof r.error.kind === 'string' && r.error.kind !== 'unsupported' && r.error.message.trim().length > 0`
  ——**只要失败，且失败类别不是 `unsupported`，就算过**。
- `labels.js:383` 的 `honestFailure` 与上面同形；`labels.js:384` 的 `batchBookkeeping` 只要求
  `applied.length + failed.length === 1`（这一批只有一条改动）。两条断言写成
  `!isStubAnswer(...) && (honestFailure(...) || batchBookkeeping(...))`。
- `listPage.js:84-91` 的 `pageProbeCheck`：`ok === false` 时，只要
  `unsupportedAnswerCheck` 或 `pageFailureCheck(res, false)` **其中一个**为空就返回「没问题」。

**我是怎么验出来的**

用一个空壳回答（`{ok:false, error:{kind:'env', message:'…还没做'}}`，以及改色那条的
`{ok:true, data:{applied:[], failed:[{name:'bug', reason:{kind:'env',message:'还没做'}}]}}`），
直接喂进**仓库自己的判据函数**（`pageProbeCheck` 从 `tests/tracker-contract/sections/listPage.js` 导出，
`unsupportedAnswerCheck` 从 `tests/tracker-contract/sections/labels.js:132` 导出；另外两条按文件里的原文照抄）：

```
pageProbeCheck(空壳的 listPage 失败回答) = []          ← 判据说「没问题」
counts.js:239 判据(空壳失败) = true
labels.js listLabels 判据(空壳失败) = true
labels.js setLabelColors 判据(空壳逐条记账) = true
```

（脚本 `D:\Temp\adv1063\probe4.mjs`，用 `node --import ./scripts/ts-hook.mjs` 跑。）

也就是说：**把九条实现换成「一律 `fail(ERROR_KIND.ENV, '还没做')`」的空壳，再让 `setLabelColors` 回一句
「applied 空、failed 里恰好一条」，这三处断言全部照过。** 这正是题面问的那个构造，答案是「能」。

**影响**

- 票面第 5 条「判据没有放宽（没有变成『随便失败都算过』）」不成立：不是「随便失败」，但确实是
  「随便哪个非 `unsupported` 的失败都算过」，而空壳恰好只会失败。判据从「必须诚实说做不到」
  换成了「必须失败」——对一个**已经实现**的能力来说，这是把唯一的护栏撤掉了。
- 这三处是新做的九条在整个仓库里**仅有**的针对性断言。它们一放宽，九条能力就只剩下
  「类型上存在」这一层保护（见发现 6）。

### 发现 2（严重）`listLabels` 列出的标签，`setLabelColors` 改不了

**文件与行号**

- `src/tracker/rooms/gitlab/labels-ops.ts:246-249`（列表请求只带 `per_page` 与 `page`）
- `src/tracker/rooms/gitlab/labels-ops.ts:355-356`（改色请求 `--method PUT -f color=#…`）
- 依据：`doc/api/labels.md:41`（`include_ancestor_groups` 默认 `true`）；
  GitLab 源码 `lib/api/helpers/label_helpers.rb:33-41`（`find_label`）、`:82`
  （`update_label` 用 `find_label(parent, …, include_ancestor_groups: false)`）、`:165`（`label_update_boundary` 同样 `false`）

**事实**

`listLabels` 没有传 `include_ancestor_groups=false`，而 GitLab 这个参数**默认就是 `true`**：
列表会把上层分组的标签一并返回（每行还带 `is_project_label: false`，但本房按契约只保留
name/color/description 三个键，这个标记被丢掉了）。而 `PUT /projects/:id/labels/:label_id`
在 GitLab 源码里解析标签时用的是 `include_ancestor_groups: false`，**只认项目自己的标签**。

我用脚本化的 glab 跑过一遍：列表请求发出去的是
`api projects/acme%2Fdemo/labels?per_page=100&page=1`（没有 `include_ancestor_groups`），
返回里一条 `is_project_label:false` 的分组标签照样进了结果。
（脚本 `D:\Temp\adv1063\probe3.mjs`。）

**影响**

- 契约对 `listLabels` 的定义是「这个后端**能改色**的全部标签」（`src/tracker/contract/contract-label-colors.ts:60`）。
  分组标签通过这条路径改不了，属于**超集**：界面/面板会把这些标签当成可编辑的。
- 用户为一个分组标签保存颜色时，远端回 404，本房把它判成 `not-found`，给出的话是
  「GitLab 报告找不到「xxx」这个标签（或这个项目）。三种可能：标签不在这个项目里、项目全路径不正确、
  当前账号在这个项目上没有改标签的权限。请核对标签名与项目全路径……」
  （原文在 `src/tracker/rooms/gitlab/labels-ops.ts:390`，我用脚本化 glab 让 404 走了一遍，
  拿到的正是这句）。**标签名和路径都是对的**，人按这句话去核对只会白费劲。
- 在有分组级公共标签的仓库（GitLab 上很常见）上，这条路径一碰就坏。修法很短：列表请求加
  `&include_ancestor_groups=false`。

### 发现 3（一般）`getRepoPermissions` 的 triage 门槛与官方权限表不符，且「依据」引了一句不存在的话

**文件与行号**

- `src/tracker/rooms/gitlab/identity-ops.ts:64`（`const TRIAGE_MIN_LEVEL = 20`）
- `src/tracker/rooms/gitlab/identity-ops.ts:60-62`（依据与引文）
- `src/tracker/rooms/gitlab/identity-ops.ts:221-224`（自承 Planner 会被判 false）
- `src/tracker/contract/results.ts:101-106`（契约对 `triage` 的定义）

**事实**

1. 官方文档 `doc/user/permissions.md:722` 那一行「Edit issues, including metadata and item locking」
   的勾选是**从 Planner 起**（Guest 空、Planner ✓），不是从 Reporter 起；`:725`「Close and reopen issues」
   同样是 Planner 起。也就是说 Planner(15) 就能做契约注释里说的「改指派、关别人的票」。
2. 代码里写的「契约自己给 `triage` 的注释也是『Reporter 及以上』（`contract/results.ts` 的 `RepoPermissions`）」
   ——`src/tracker/contract/results.ts:104` 的原话是「能不能整理别人的票（改指派、关别人的票）」，
   **全仓任何版本都没有「Reporter 及以上」这句**。

**我是怎么验出来的**

- 权限表：拉 `doc/user/permissions.md` 原文，看第 715-725 行那张表（Planner 那一列有勾）。
- 引文：`git log --oneline -S "Reporter 及以上"`（全仓全历史）只列出 `f3c16cb7` 一个提交
  ——这句话是本提交自己造出来、再安到契约头上的。
- 行为：脚本化 glab 喂 `access_level = 15`，返回 `{push:false, triage:false}`
  （`D:\Temp\adv1063\probe3.mjs`）；20 才是 `{push:false, triage:true}`。

**影响**

- GitLab 17.7 之后 Planner 是常见档位。这个房间会对 Planner 用户报 `triage:false`，
  与 `push` 一样被当成「只读」——`src/deck/tools/context.ts:141-143` 会据此在给 AI 的正文里写
  「这个仓库只读：标签与写操作不可用」，而事实是这个人能改标签、能关票。
- 方向上是「少报能力」（不会误报能写），所以不是事故；但**依据是错的**，
  而这段注释的作用正是给后来人一个「不用再查」的结论。真值应是 `15`。

### 发现 4（一般）本提交让契约与宿主侧的四处注释变成了假话

**文件与行号**

- `src/tracker/contract/index.ts:53`：`initProject`「GitHub 完整实现，本地 Markdown 与 GitLab 回 unsupported」
- `src/tracker/contract/index.ts:55`：`getRepoPermissions`「GitHub 真去问，本地 Markdown 与 GitLab 回 unsupported」
- `src/tracker/contract/index.ts:56`：`listSubIssues`「GitHub 实现，本地 Markdown 与 GitLab 回 unsupported」
- `src/tracker/contract/operations.ts:201`：`getCurrentUser`「GitHub 回真实账号；本地 Markdown 与 GitLab 回 `unsupported`」
- `src/deck/tools/context.ts:117`：「（GitLab 不实现这条旁路，诚实未知）」

**事实与验法**

`grep 'GitLab 回 unsupported|GitLab 不实现'` 一次就能列出这五处；它们说的是**本轮之前**的状态。
本轮把这几条实现出来了（`src/tracker/rooms/gitlab/capability-register.ts` 里对应行都是 `provided`），
但这五处一个字没改。票面第 4 条说的是「能力登记三处一致」，这五处不属于那三处，所以门禁不会红
——门禁 `tests/verify-capability-register.ts:142-146` 只检查房间文件里有没有
`ProvidedCapability<typeof …>` 这一句文本，不检查别的文件怎么写 GitLab。

**影响**

接手的人若先读契约的接口注释（这是仓库里通常的入口），会得到与事实相反的答案：
「GitLab 这几条回 unsupported」。`src/deck/tools/context.ts:117` 那一条更直接——
它就在调用点上方，而调用点现在真的会去问 GitLab 要权限。

### 发现 5（一般）交接说明「GitLab 没有原生父子关系」与官方文档不符

**文件与行号**

- `src/tracker/rooms/gitlab/README.md:19-25`
- `docs/tracker/capability-gitlab.md:54-55`（同样的话）

**事实**

GitLab 有原生的父子层级（work items / child items），官方文档整页在讲这件事：
`doc/user/work_items/child_items.md`（Tier: Free, Premium, Ultimate；「A task that can be a child of an issue」；
「Moving child items when the parent issue is moved」在 17.3 转正）。准确的说法是：
**REST 的 issue links 接口里没有层级类型**（`doc/api/issue_links.md` 只有
`relates_to` / `blocks` / `is_blocked_by` 三种），层级只在 work items（界面与 GraphQL）里。

**验法**：拉 `doc/user/work_items/child_items.md` 原文逐页看；`doc/api/issue_links.md`
的 `link_type` 三值也核过（这一条本房的实现是对的）。

**影响**

`setParent` 落成 `relates_to`、`listSubIssues` 读同一批链接——这个**做法**在 REST 这条路上站得住，
问题只在**理由**写错了：文档写「平台没有这种边」，后来人就不会去想「其实有，只是这套接口拿不到，
要不要另开一票走 GraphQL」。句子里还带着「今天」这种会过期的限定。

### 发现 6（一般）能力登记门禁只看形状，不看行为；`provided` 可以是一句空话

**文件与行号**

- `tests/verify-capability-register.ts:95-151`（四道 check）、`:142-146`（成员集合只正则匹配一句文本）
- `src/tracker/contract/capability-answer.ts:88-90`（`ProvidedCapability` 只挑出 `kind === 'provided'` 的名字）
- `src/tracker/rooms/gitlab/index.ts:47-50`（`GitlabBackendShape = { [K in GitlabBackendMembers]: Tracker[K] }`）
- `src/tracker/capability-assertions.ts:2`（三条断言全是编译期）

**事实**

这条门禁链（运行时四道 + 类型层）能保证的是：25 条齐全、md 表与数据同分类、
`planned` 有承接票号、房间文件里有那句 `ProvidedCapability<…>`、`src/` 里没人值引用登记数据、
以及 `provided` 的那些成员**在类型上存在且签名对**。
它**完全不看**这些成员被调用时返回什么。

**验法**：读门禁源码逐条列它比了什么；再读 `ProvidedCapability` 的定义确认它只做键的筛选。

**影响**

「把一条实际没实现的写成 `provided`」这件事，门禁照样绿（只要那个成员写成
`async () => fail(ERROR_KIND.ENV, '还没做', '')` 这种形状——见发现 1 的构造，
三处契约测试也会一起放行）。所以「登记三处一致」这句话的真实含义是
「三处记的是同一件事」，不是「三处说的都是真的」；这一点在任何文档里都没有写明。

### 发现 7（轻微）日志的 `reason` 拼错没人拦

**文件与行号**

- `src/tracker/rooms/gitlab/read-log.ts:152-157`（`op: string, reason: string`）
- `src/tracker/rooms/gitlab/read-log.ts:67-118`（`READ_DEGRADED_REASONS` 登记表）
- `tests/verify-log-fields.js:20-45`（白名单只到「事件 → 允许哪些字段键」）
- `tests/verify-log-count.js:21-27`（只认事件名清单）

**事实与验法**

- 我把房里所有 `emitReadDegraded(ctx, 'op', 'reason', …)` 的 31 个 reason 取值抓出来与
  `READ_DEGRADED_REASONS` 比对：**没有一个「用了没登记」的**，结论与票面一致。
  另有 `subIssues:notfound` 登记了但没人用（无害）。
- 但 `op`/`reason` 的类型都是 `string`（不是登记表推出来的联合类型），运行时也只是
  `String(reason || '')`（`read-log.ts:162`），**没有一处会拒绝未登记的取值**。
  `verify-log-fields.js` 认的是字段键（`read.degraded` 允许 `op/reason/latencyMs/opId` 四键），
  `verify-log-count.js` 认的是事件名；两个门禁都看不到值的词表。
- 所以「reason 只能取登记过的值」今天是一条**写在注释里的纪律**，不是门禁。

**影响**：拼错一个字母不会被任何一道门禁拦下，日志里会出现一个只在当次出现的 reason，
事后按登记表去查会查不到——正是这两个门禁想避免的那种情况。

### 发现 8（轻微）交接说明第 1 条把「本房客户端的限制」说成了 glab 的限制

**文件与行号**：`src/tracker/rooms/gitlab/README.md:9-13`

**事实**：`client.ts:44-54` 确实只回 `{stdout, stderr, code}`，这一句对。但接着的
「GitLab REST 那些靠 `X-Total` 头拿总数的做法在本房走不通：计数**只能**改问 issues_statistics」
漏掉了两条现成的路：`glab api -i/--include`（把响应头打进输出）与
`glab api --paginate`（自动翻完所有页）。

**验法**：拉官方 CLI 文档源码 `docs/source/api/_index.md`（gitlab-org/cli），
`:223` 是 `-i, --include  Include HTTP response headers in the output.`，`:227` 是 `--paginate`。

**影响**：这不是错，是「只能」用词过满：后来人想加「靠响应头才能做」的能力时，
会以为 glab 这条路是死的，实际上要在 `client.ts` 里多开一个开关（`-i` 会把头混进 stdout，
所以本房现在的解析方式要跟着改——这才是真正的代价，README 没写）。

### 发现 9（轻微）`listPage` 在总数正好整除时多给一个游标（多一次空请求）

**文件与行号**：`src/tracker/rooms/gitlab/pages.ts:227-229`

**事实与验法**：`nextCursor = rows.length >= perPage ? String(page + 1) : null`。
我脚本化跑 `limit=2`、每页恰好 2 行：`[e1, e2, e3].nextCursor = ["2","3",null]`——
第二页（真实的最后一页）仍然给了 `nextCursor: "3"`，调用方会去取第三页拿回空数组。

**影响**：多一次出站请求；界面上「下一页」在最后一页仍会亮着。
契约的 `PageResult` 只有 `nextCursor` 这一格可用，属于设计代价，不是错误——但
`src/tracker/rooms/gitlab/labels-ops.ts:279-282` 里写着「用短页当哨兵可以少花一次请求」，
同一房的两处对同一件事给了不一样的说法，读的人会以为 `listPage` 也省下了那一趟。

### 发现 10（轻微）`initProject` 没传 `-s/--skipGitInit`

**文件与行号**：`src/tracker/rooms/gitlab/init-project.ts:282`（真实调用 `c.run(['repo', 'create', name, visFlag], …)`；步骤写在文件头 `:174`）

**事实与验法**：glab 官方文档 `docs/source/repo/create.md:62` 写明
`-s, --skipGitInit  Skip local repository setup (skips both 'git init' and cloning)`；
源码 `internal/commands/project/create/project_create.go:168-170`（带名字参数时不 git init）、
`:306-314`（已在 git 仓库里则 `addRemote("origin", <新项目地址>)`）。
本房先自己 `git init/add/commit`，再不带 `-s` 调 glab，于是 glab 会额外去 add 一次 origin
（失败也只是打印一句警告、退出码 0）。因为本房随后自己 set-url/add origin，**最终状态一致**。

**影响**：多一次无效果的写操作与一行警告；不过如果哪天 glab 改成就地 push 或 clone，
这条路径的先后顺序就要重新想。加一个 `-s` 就能把意图说死。

### 发现 11（轻微）`counts.js` 那条新注释对上下文的描述与代码不符

**文件与行号**：`tests/tracker-contract/sections/counts.js:230-234`（注释）对 `:166`（`const ctx = { cwd: '/ws/fake' }`）

**事实**：注释写「这一段的 ctx **只有 logEvent 与 isEnabled**，没有 platform、没有 exec」，
实际喂给 GitLab 后端的是 `{ cwd: '/ws/fake' }`：**logEvent 也没有**。
好在 `emitReadDegraded` 第一句就是 `if (!ctx || typeof ctx.logEvent !== 'function') return`
（`src/tracker/rooms/gitlab/read-log.ts:159`），所以不影响结论。

**影响**：这条探针顺带**没有覆盖**「失败时落不落日志」这件事（日志被静默跳过），
而它恰恰是九条里唯一一条针对 GitLab 的探针。注释与代码不符会让人以为这一路已经被测过。

### 发现 12（轻微）两处 catch 支路不落降级日志（文件自己承认）

**文件与行号**：`src/tracker/rooms/gitlab/counts.ts:208-210`、`src/tracker/rooms/gitlab/pages.ts:231-234`

**事实**：两处都写着「这一支没有已登记的降级 reason，所以不落 read.degraded」，
然后直接 `failGlab(e, …)`。其余各条的 catch 分支都先 `emitReadDegraded(…, '…:transport', …)`。

**影响**：抛上来的那一类失败（起不了进程、超时）在日志里只剩 `glab.exec` 那一行，
与「命令回了非 0」在诊断上分不开。既然登记表里已经有 `counts:transport` / `listPage:transport`，
把 catch 支路也挂上同一个 reason 是不需要新词表的。

### 发现 13（轻微）房间文件里留着一个没人用的桩函数

**文件与行号**：`src/tracker/rooms/gitlab/index.ts:189-191`

**事实**：`const unsupported = (op) => fail(ERROR_KIND.UNSUPPORTED, \`gitlab ${op} pending #145 stub\`, …)`，
紧跟一句 `void unsupported`，没有任何调用点。它是补桩时代的遗留。
里、外都不影响行为（`getRepoKey` 那条注释 `README.md:39-41` 讲的「谁补桩」也仍然对）。

## 我试过但没打穿的攻法

1. **「25 条全部有明确答复、没有一条靠补桩」是不是假的**——用注册表把真实后端挂上去，
   遍历 `CAPABILITIES` 逐条调用、把函数名以 `:unsupported` 结尾的当补桩：
   24 条是房间自己的实现，只有 `ensureLabelColorsFile` 落到注册表桩上（回
   `{ok:false, error:{kind:'unsupported', …}}`）。**特别问的 `getRepoKey`**：它**不是缺席**的，
   房间自己在 `src/tracker/rooms/gitlab/index.ts:197` 交了实现（`src/tracker/rooms/gitlab/repo.ts`），
   所以「定位口不补桩时注册表会给什么」这个问题在本提交上根本不会发生。
   另外 `index.ts:178` 写的「21 条操作 + 3 条定位口」与名录 22 条操作自洽
   （22 − 1 条 `ensureLabelColorsFile` = 21），与票面的 24/25 对得上。

2. **`counts` 的端点**——`GET /projects/:id/issues_statistics` 的回包是
   `{"statistics":{"counts":{"all":…,"closed":…,"opened":…}}}`（官方文档示例），
   与 `counts.ts:179-206` 逐格对应；脚本化实跑：URL `api projects/acme%2Fdemo/issues_statistics?scope=all`，
   回包 20/5/15 时得到 `{open:15,closed:5,total:20}`；带 `state:'closed'` 时 URL 一个字不变、
   返回 `{open:0,closed:5,total:5}`（本地收窄，与 GitHub 房、Markdown 房同一口径）。
   401 时判成 `auth`，并落一行 `read.degraded{op:'counts',reason:'counts:transport'}`。
   **没打穿。**

3. **`setLabelColors` 的颜色格式远端会不会拒**——官方 `doc/api/labels.md:252` 明写
   「6-digit hex notation with leading '#'」，本房发出去的是
   `api projects/acme%2Fdemo/labels/bug --method PUT -f color=#ff0000`，与文档一致，
   返回的 `applied[].color` 是不带井号的六位小写（契约要求的形状）。**没打穿。**

4. **`text_color` 能不能写**——`doc/api/labels.md:247-255` 的 PUT 属性表只有
   `new_name` / `color` / `description` / `priority` / `archived`，没有 `text_color`，
   README 说「写不了」是对的。**没打穿。**

5. **`listLabels` 的翻页终止条件**——官方 `doc/api/labels.md:31` 说这个接口默认 20 条、
   是分页的；`doc/api/rest/_index.md:318` 说 `per_page` 默认 20、上限 100。
   实跑：100 条的第一页 + 1 条的第二页 → 返回 101 条；短页即停。
   **除了发现 2 那一条，翻页本身没打穿。**

6. **每页条数正好整除总数会不会多翻一页**——`labels-ops.ts:287` 用「本页条数 < per_page 就停」，
   整除时会多问一次（拿回空表然后停），能拿到完整清单；`listPage` 那一侧见发现 9。
   **没有数据丢失，不算打穿。**

7. **空批次 / 重名批次 / 单条失败 / 全部失败**——实跑结果：
   空批次 → `{ok:true, data:{applied:[], failed:[]}}`；重名（去空白后同名）→ 整体
   `fail(parse, '同一批改动里「bug」出现了两次…')`；单条 404 → `applied:[]`、
   `failed:[{name:'bug', reason:{kind:'not-found', …}}]`；全部失败 → 同样 `ok:true` + failed 全满。
   契约对这条操作的定义就是「逐条记账，不是整体成败」
   （`src/tracker/contract/contract-label-colors.ts:83`），所以 `ok:true` 不是吞失败。**没打穿。**

8. **大小写不同的「重名」**——`{name:'Bug'}` 与 `{name:'bug'}` 会被一起接受、发两条 PUT、
   两条都算 applied。我怀疑过这是漏判，于是去查 GitLab 的标签名语义：
   `app/models/label.rb:34` 是 `validates :title, uniqueness: { scope: [:group_id, :project_id] }`
   ——Rails 默认**区分大小写**，两个只差大小写的标签可以并存。所以本房「不折叠大小写」
   与 GitLab 语义一致，而且 `labels-ops.ts:124-131` 把「没核实过、两边代价不对称」写清楚了。
   **没打穿。**

9. **`listSubIssues` 读的链接类型**——`doc/api/issue_links.md` 只有
   `relates_to` / `blocks` / `is_blocked_by` 三种，本房在 `sub-issues.ts:291-292` 跳过非 `relates_to`；
   实跑：明细说另一头不是这张地图时 → 如实 `fail(parse, '…一行都没能算进去…')`；
   一行算进去、方向分不出来时 → 记 `dropped` 而不是猜。**没打穿。**

10. **「收了参数不往下传」「回包字段永远写死」**——`listPage` 的 `cursor`/`limit`/`filter.state`/`filter.labels`
    都落进了 URL（实跑 URL 里能看到 `scope/order_by/sort/page/per_page/with_labels_details`）；
    `initProject` 的 `visibility` 契约只有 `'public' | 'private'`
    （`src/tracker/contract/inputs.ts:96`），`init-project.ts:201-202` 两值都映射到了；
    `getRepoPermissions` 的两个布尔确实由 `access_level` 算出来（10/15/20/30/40/50 六档实跑各不同）。
    **没打穿。**

11. **跨房引用**——`grep` 房间目录里的 import 说明符：只有 `./…` 与 `../../contract/…`，
    没有一条指向 `../github/` 或 `../markdown/`（注释里提到 GitHub 房的路径是举例子，不是引用）。
    **没打穿。**

12. **日志绕过出口**——`grep 'ctx.logEvent'` 在整个房间里只命中 `read-log.ts` 三处
    （`read.degraded` / `preflight.gate` / `repo.resolve.tier`），与 README:47 的纪律一致；
    事件名与 reason 取值都在登记表内。**没打穿**（能拦不住的部分见发现 7）。

13. **交接说明逐句核对**——`README.md` 里关于本房行为的句子我逐句对过代码：
    响应头（发现 8，说法过满）、仓库身份多层全路径 + `encodeURIComponent`
    （`labels-ops.ts:248`、`identity-ops.ts:240` 都对）、`relates_to` 对称且与人工链接分不开
    （`sub-issues.ts` 的设计确实如此，而且它把分不出的记进 `dropped`）、
    阻塞回落正文 `Blocked by:` 行、颜色单字段且写入带前导井号、`text_color` 写不了、
    大小写不折叠、两个唯一出口（日志/判档）——**都对**。错的只有发现 5 那一句。

14. **`code`/`reason` 词表比对**——31 个 reason 取值 vs 登记表：无「用了没登记」的。

## 没能验证的部分

1. **没有任何一次真实远端调用**。本机没有 GitLab 实例、没有 `glab` 登录，所以「远端到底怎么回」
   全部是按官方文档 + GitLab 源码判的，包括发现 2 里「PUT 命中分组标签会 404」这一步
   ——我读的是 `lib/api/helpers/label_helpers.rb:82` 的 `include_ancestor_groups: false`，
   没有真的看到那个 404。行为层面的验证用的是脚本化的假 glab。
2. **`?simple=true` 挂在单项目接口上会怎样**。官方 `doc/api/projects.md` 的属性表里
   `simple` 只出现在三个「列项目」的接口（`:618`、`:1007`、`:1489`），单项目那一张没有它；
   本房自己在 `identity-ops.ts:30-38` 交代了「源码级已核实、本机没真发过、GitLab 对未声明参数不拒绝」。
   我核对了文档这一半（确认属性表里没有），另一半（服务端是否忽略）没法验。
3. **祖先分组标签与项目标签一起翻页时，GitLab 的分页是否正确**（会不会漏项）。没实例，验不了。
4. **`initProject` 真跑一次的副作用**：glab 会不会就地 clone/push（我按 glab 源码
   `internal/commands/project/create/project_create.go:306-314` 判为只 add remote，且非交互时不 clone），
   以及 `glab repo create` 的 stdout 里那串带勾的提示能不能被
   `init-project.ts` 的正则稳定取到地址——只按源码与文档判，没有实跑。
5. **`npm test` 全量**：我只跑了题面点名的七道门禁与两条日志门禁（都绿），
   没跑整条 `scripts/verify-chain.js`，所以「别的门禁有没有被这次改动碰红」我没验。
6. **`preflight.ts` / `graph-blocking.ts` 等老文件的真实远端错误路径**：本轮没脚本化它们，
   只按代码与官方文档判，没有构造坏回包。
7. **工作区在我审查期间不是干净的**：`git status --short` 显示另有一批未提交改动
   （`src/tracker/rooms/markdown/` 下 8 个文件、`scripts/gate-map.mjs`、`scripts/verify-all.mjs`、
   `scripts/verify-chain.js`、`scripts/verify-parallel.mjs`、`tests/verify-669-collapsed-recoverable.js`、
   `tests/verify-deck-no-hang.js`、`tests/verify-gate-map.js`、`tests/verify-log-selfmon.js`、
   `tests/verify-settings-templates.js`、`tests/verify-settings-view.js`、`docs/agents/commit-convention.md`，
   以及未跟踪的 `tests/lib/gate-result.ts`）。**这些不是我改的**（我全程只写了本文件与
   `D:\Temp\adv1063\` 下的临时脚本），也不在我审查与引用的任何文件里——上面每一条发现的文件
   都不在这张清单上，行号取自磁盘上与该提交一致的内容。要说明的是：
   「门禁全绿」这一句是我在这个脏工作区上跑出来的，我跑的八道门禁本身都不在那张清单里
   （被改的是 `verify-chain.js` 等链式入口，我没有走链），所以结论对本次审查成立；
   但如果别人用改过的链式入口重跑，看到的会是另一件事。

## 返工建议（按先后）

1. 三处契约断言要么恢复「必须诚实做不到」的等价强度，要么补上**正向**断言
   （脚本化 glab，要求 `listLabels` 列出真标签、`listPage` 给出真的一页、`getRepoPermissions`
   按档位给出真值）——现在这九条在整个仓库里没有任何一条这样的断言。
2. `listLabels` 加 `&include_ancestor_groups=false`（`labels-ops.ts:248`），或明确把分组标签
   纳入语义并让失败话术说清「这是分组标签，要去分组页改」。
3. `TRIAGE_MIN_LEVEL` 改成 15，并把 `identity-ops.ts:60-62`、`:221-224` 的依据改写成
   官方权限表原文（Planner 起），删掉那句不存在的契约引文。
4. 把 `contract/index.ts:53/55/56`、`contract/operations.ts:201`、`deck/tools/context.ts:117`
   五处「GitLab 回 unsupported」改成本轮之后的事实。
5. `README.md:19-25` 与 `docs/tracker/capability-gitlab.md:54-55` 改成
   「REST issue links 没有层级类型，原生层级在 work items 里，本房不走那条路」。
6. 顺手：`counts.ts:208`、`pages.ts:231` 两个 catch 补 `read.degraded`；
   `index.ts:189-191` 的死代码删掉；`counts.js:230-234` 的注释按实际 ctx 改写；
   `init-project.ts:174` 加 `-s`。
