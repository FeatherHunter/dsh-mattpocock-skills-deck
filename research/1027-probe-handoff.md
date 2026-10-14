# #1027 动手前交接：贴合探针的真实机制与等待条件（只读调查）

- 调查日期：2026-10-13。
- 调查方式：只读。没有改任何产品代码，没有动任何 issue。本文件是本次调查唯一写入的文件。
- 一手来源：仓库本地源码、测试脚本、issue 票面正文与评论、research 下的实测文件。每条结论后面都注明来源文件与行号，或票号与节名。拿不准的标“未核实”，不猜。
- 本文件回答 #1027（地图02开发：两房用 implements 对上契约）动手前必须知道的事实。#1027 仍是 open（来源：#1027 票面，deck_issue_get 读回 state=open）。

## 一、探针真实机制：断什么、不红什么

### 1. 探针断的不是完整的后端模块类型，是弱化过的形状

- 两份探针的赋值目标都是文件内自定的 `ProbeShape`，不是 `BackendModule` 本体。
  - 来源：`tests/contract-probe-github.ts:44-50`：
    `type ProbeShape = Omit<BackendModule, 'create' | 'openRepository' | 'checks'> & { create: (...args: any[]) => unknown; openRepository?: unknown; checks?: unknown }`，`export const githubProbe: ProbeShape = githubModule`。
  - 来源：`tests/contract-probe-markdown.ts:45-51`：同形状，`export const markdownProbe: ProbeShape = markdownModule`。
- #1026 正文原来两处写的是直接赋给 `BackendModule`，对不上，已被 12:00 纠正评论作废（见本文件第三章第 1 点）。不要再引用旧说法。
- 三处弱化在探针文件头里如实写了，没有藏：
  - 来源：`tests/contract-probe-github.ts:9-24` 与 `tests/contract-probe-markdown.ts:10-25`。两处文件头都写了三点：`create` 只断存在与可调用、`openRepository` 只断存在、`checks` 只断存在。

### 2. 三处弱化各是什么意思

- `create` 只断存在与可调用，不探查返回内容的深层。原因是后端实现还是旧语言时代写成的，返回对象经变量组装，成功标记 `ok` 被加宽成 `boolean`，按契约的字面量联合算是不合。修对要给几十个后端函数补返回标注，那是后端实现面的改动，按 #1025 第 7 条本票不碰实现面。
  - 来源：`tests/contract-probe-github.ts:10-16`、`tests/contract-probe-markdown.ts:11-17`。
- `openRepository` 只断存在，不探查字面量。两房声明的值是对的（GitHub 是 `'url'`、Markdown 是 `'folder'`），但旧语言文件里的字面量被加宽成 `string`，静态只能断存在、断不断错。真值由门禁的运行时腿探查。
  - 来源：`tests/contract-probe-github.ts:17-19`、`tests/contract-probe-markdown.ts:18-20`。
- `checks` 只断存在，不探查种类是数组还是函数。契约写的是数组（`RoomCheckEntry[]`），GitHub 房实际带的是一个零参数函数（调一次回一份新数组），Markdown 房干脆没带（可选，本来就合法）。数组还是工厂、留还是删，要另起专票定，本票不猜、不改，真种类由门禁的运行时腿如实记录。
  - 来源：`tests/contract-probe-github.ts:20-24`、`tests/contract-probe-markdown.ts:21-25`。
- 探针也不证明后端函数内部写得对不对。探针编译用宽松开关（`noImplicitAny` 关），没标注的参数按 `any` 过；后端文件内部自己的报错由门禁另行计数、不拦住本项。
  - 来源：`tests/contract-probe-github.ts:26-28`、`tests/contract-probe-markdown.ts:27-29`。

### 3. 契约里哪些是必填、哪些是可选（探针弱化的对照基准）

- 来源全文：`src/tracker/contract/backend-module.ts:146-246`。
- 必填四件套：`id`（`backend-module.ts:151`）、`label`（`:154`）、`create`（`:165-167`，签名 `create(ctx: BackendContext): RoomOperations & Partial<GitHubRoomExtension> & Partial<MarkdownRoomExtension> & RoomAuxiliaries`）、`matches`（`:180`，签名 `matches(handle: RepoHandle, ctx: OpContext): boolean | Promise<boolean>`）。文件头 `:15-19` 与接口注释 `:144` 都写明“必填四件套：`id`、`label`、`create`、`matches`，其余可选”。
- 本次弱化的三处在契约里本来是什么：
  - `create` 必填（见上）。
  - `openRepository` 可选（`backend-module.ts:219`：`openRepository?: 'url' | 'folder'`）。
  - `checks` 可选（`backend-module.ts:234`：`checks?: RoomCheckEntry[]`）。
  - `prompts` 可选（`backend-module.ts:231`：三叉联合的值形状，见本文件第三章）。
- 注册表今天只校验五件事，缺可选字段不是错误。来源：`src/tracker/contract/backend-module.ts:15-19`（模块是对象、`id` 非空、`label` 是字符串、`create` 是函数、`matches` 是函数，外加 `id !== 'other'`）。

### 4. 探针不红什么（两条已证实的“不红”）

- 后端增了契约没有的成员，探针不红。多余属性检查只对当场手写的新对象字面量生效，探针赋的是别处导过来的已有对象（`githubModule` / `markdownModule`），这条检查根本不会触发。增减成员唯一登记处是门禁第 7 项运行时腿的键快照。
  - 来源：`research/1026-adversarial-claims-verification.md` P1b 节（P1b-1 复现命令与输出、P1b-2 结论）；纠正评论第 2 条（见本文件第三章）。
- 被弱化成可选 `unknown` 的 `openRepository` / `checks` 缺了，探针看不见。弱化后仍必填的成员（`id` / `label` / `matches` / `create` 存在性）缺了理论上会红，但这只是类型规则的推论，没有一段自动化代码把它钉住。全仓 `ProbeShape` 只有 4 处命中，全在两份探针文件里，没有任何反面测试拿 `ProbeShape` 编过坏后端。
  - 来源：`research/1026-adversarial-claims-verification.md` P1b-2 末段与 P2 节“弱化后的那条路能否抓住缺成员：没有”。

### 5. 两房模块对象的真实形状（探针的输入侧）

- GitHub 模块对象是 16 个键的对象，起止行 `src/tracker/rooms/github/index.ts:192-226`。键集合与门禁快照逐字一致：`capabilities`、`checks`、`create`、`describe`、`fixes`、`id`、`issueUrl`、`label`、`linkPattern`、`links`、`matches`、`openRepository`、`presentation`、`prompts`、`searchUrl`、`setupPrompt`。
  - 来源：`src/tracker/rooms/github/index.ts:192-226` 全段；`tests/verify-contract-types.js:101-105` 快照 github 16 键。
- Markdown 模块对象是 15 个键的对象，起止行 `src/tracker/rooms/markdown/index.ts:222-252`。键集合：`create`、`describe`、`fixes`、`id`、`issueUrl`、`label`、`labelPalette`、`linkPattern`、`links`、`matches`、`openRepository`、`presentation`、`prompts`、`searchUrl`、`setupPrompt`。
  - 来源：`src/tracker/rooms/markdown/index.ts:222-252` 全段；`tests/verify-contract-types.js:106-110` 快照 markdown 15 键。
- `openRepository` 真值：GitHub 是 `'url'`（来源：`src/tracker/rooms/github/repo.ts:73` 的 `export const openRepository = 'url'`，经 `src/tracker/rooms/github/index.ts:222` 进入模块对象）；Markdown 是 `'folder'`（来源：`src/tracker/rooms/markdown/index.ts:249` 的字面量）。
- `checks` 真种类：GitHub 是函数（来源：`src/tracker/rooms/github/checks.ts:53` 的 `export function checks()`，经 `src/tracker/rooms/github/index.ts:20,224` 进入模块对象）；Markdown 缺席（`src/tracker/rooms/markdown/index.ts:222-252` 里没有 `checks` 键）。
- 门禁运行时腿如实记录的就是上面两行：github `openRepository='url'`、`checksKind='function'`；markdown `openRepository='folder'`、`checksKind='absent'`。来源：`tests/verify-contract-types.js:100-111`。
- #1027 动手前现状：全仓实现代码里没有一处 `implements`（来源：2026-10-13 对 `src/tracker/rooms` 做 `implements` 全文搜索，零命中）。两个模块对象都没有写对上契约的声明。上面这句只说“没有写声明”，不推断后端内部对错。

## 二、门禁怎么验（第 5、6、7 项）

门禁文件是 `tests/verify-contract-types.js`。文件头 `:26-36` 写了第 5、6、7 项的口径，下面按文件头加实现代码逐项写。

### 第 5 项：贴合探针能编译

- 文件头原文口径（来源：`tests/verify-contract-types.js:26-29`）：两份探针（GitHub / Markdown 后端）用宽松开关直编，探针文件自己一条报错都不能有（成员缺了、形状写歪了，第一落点就是这里）；后端文件内部自己的报错另行计数，必须与本文件记的基线逐字相等。
- 宽松开关原文（来源：`tests/verify-contract-types.js:89-94` `PROBE_TSC_ARGS`）：`--noEmit --target es2020 --lib es2020,dom --module esnext --moduleResolution bundler --allowJs --checkJs false --skipLibCheck --strict false`。与探针文件头写的口径一致。
- 基线原文（来源：`tests/verify-contract-types.js:83-88`）：`PROBE_NONPROBE_ERROR_BASELINE = 200`。注释写明这 200 条是旧语言时代的联合收窄、参数个数这类实现面的债，不归本门禁审。
- 实现做法（来源：`tests/verify-contract-types.js:395-425`）：拿同一套宽松开关直编两份探针，把输出按 `/\(\d+,\d+\)\s*:\s*error\s+TS\d+/` 逐行计数，按文件后缀滤出探针自己的报错（有就单独记 FAIL），`nonProbeCount = 总数 - 探针数`，再判 `nonProbeCount === 200`。多了是新增债务，少了是有人动了实现面。
- 直编不经任何 tsconfig（来源：`tests/verify-contract-types.js:387-389` 注释与 `tests/contract-probe-github.ts:30-31` 跑法说明）：后端入口会把半个房间拖进编译程序，经配置编会触发覆盖对账的重复归属。

### 第 6 项：反面证明（验“探针不是摆设”）

- 文件头原文口径（来源：`tests/verify-contract-types.js:30-32`）：现拼一个缺 `matches` 的假后端，拿同一套严格开关编它，必须编不过、且报错里点名 `matches`。
- 实现做法（来源：`tests/verify-contract-types.js:428-461`）：假文件写进系统临时目录（不进仓库），内容是 `export const bad: BackendModule = { id: 'neg', label: 'neg', create: (...) as unknown as BackendModule['create'] }`（`:440-443`），注意断的是 `BackendModule` 本体，不是 `ProbeShape`。开关是 `--noEmit --strict --target es2020 --lib es2020,dom --module esnext --moduleResolution bundler --skipLibCheck`（`:445-449`），判 `nr.status !== 0 && /matches/.test(nout)`（`:452-456`）。
- 已知的口径出入（来源：`research/1026-adversarial-claims-verification.md` P2 节；#1026 纠正评论第 4 条）：文件头注释 `:30` 写“同一套严格开关”，“同一套”三个字与实际不符——探针是 `--strict false` 的宽松开关，反面证明是 `--strict`，两者既不是同一套，严格程度还反了；断言目标也不一致（探针断 `ProbeShape`，反面断 `BackendModule` 本体）。纠正评论说注释待改门禁的人顺手修。本交接不改注释，只记录。

### 第 7 项：运行时腿（静态探针断不了的两处由这里断真值）

- 文件头原文口径（来源：`tests/verify-contract-types.js:33-36`）：把两个后端模块对象真加载起来，断三件事——`openRepository` 只能是 `'url'` / `'folder'` / 不声明；`checks` 的种类如实记录（数组 / 函数 / 不声明）；模块对象的键集合必须与本文件记的快照逐字相等。
- 实现做法（来源：`tests/verify-contract-types.js:463-505`）：经 `scripts/ts-hook.mjs` 真加载两个模块对象，按 `kind = undefined→'absent'、数组→'array'、函数→'function'` 记录种类（`:471`），再与 `RUNTIME_SNAPSHOTS`（`:100-111`）逐字比。键比较不看顺序（先排过再比，见 `:489` 与文件头 `:97-98`）。
- 键加了、减了、真值变了，都先回答“契约里有没有它”（`BackendModule`），确认后把新快照记进来；若契约要跟着改，改完再记。来源：`tests/verify-contract-types.js:96-98` 快照注释与 `:492-500` 的四条分支提示语。
- 绿路径下这扇门禁恰好执行 10 次 `check()`（来源：`research/1026-adversarial-claims-verification.md` 附加①节逐行表：`:294`、`:323`、`:349`、`:368`、`:384`、`:414`、`:418`、`:454`、`:494` 两次）。#1027 本地复跑时认这 10 项即可，失败分支上的 `check(false,…)` 绿路径不执行。

## 三、#1026 留给 #1027 的三处真差距原文

### 1. 先看纠正评论：#1026 正文有四处机制描述写错了，以纠正评论为准

- 来源：#1026 票 2026-10-13 12:00 那条“纠正票面机制描述”评论（deck_issue_get #1026 第 5 条评论，id `IC_kwDOT6kz3c8AAAABbkYH5w`）。该评论开头写明“本票已关，验收结论不变（#1025 第 8 条四件事的证据链完整）。但正文§范围与§收尾有四处机制描述写错了，独立核验后逐条更正，后人以本条为准”。
- 四条更正的原文要点（转录该评论第 1–4 点，原句长，转述保留原意，原文以票面为准）：
  1. 探针断的不是 `BackendModule`，是弱化版 `ProbeShape`。正文两处“把导出赋给 `BackendModule` 类型”作废。实际代码见 `tests/contract-probe-github.ts:44-50`（Markdown 同形）。弱化本身是对的（#1025 第 7 条禁改实现），错的是正文没提弱化。
  2. “靠多余属性检查报错”这句机制是错的。多余属性检查只对当场手写的新对象字面量生效，探针赋的是别处导过来的已有对象，根本不会触发（仓库自带 tsc 当场复现：非字面量多余属性赋值 exit 0，新鲜字面量才报 TS2353）。探针的牙咬的是“缺成员 / 形状写歪”；“后端增了契约没有的成员”探针不红，咬它的是门禁第 7 项运行时腿的键快照。
  3. 提交数是 6 次，不是 5 次。§收尾列的 6 个哈希（`5090d305`、`63f2a638`、`aafa3716`、`95226de2`、`b07e64b5`、`d50825c7`）经 `git log` 核对全在 main 上，“5 次提交”作废。
  4. 门禁 `:30` 注释“同一套严格开关”也不真。探针实际跑 `PROBE_TSC_ARGS`（`--strict false`），注释待改门禁的人顺手修。
- 独立核验报告是 `research/1026-adversarial-claims-verification.md`，P1a–P1c 全部证实（来源：该评论末段与该报告总表）。

### 2. 三处真差距的原文（#1026 正文“收尾”一节）

- 来源：#1026 票正文“收尾”一节第 8 个短横条（deck_issue_get #1026 正文）。原文是：
  > “探针的牙已经验过是真的：写探针时当场咬住三处真差距——GitHub 房 `create` 返回的 `ok` 被加宽、`checks` 在契约里是数组而真实现是零参函数、`prompts` 的错误类目词表在契约里没有名分。前两处按边界不改后端（探针如实记录种类，运行时腿做快照登记）；第三处把契约的 `prompts` 类型补成三叉联合（双语全文、命令词表、错误类目词表），这是探针指出的、契约欠的形状，不是后端欠的。”
- 逐处溯源：
  - 第 1 处（`create` 返回的 `ok` 被加宽）：探针文件头 `tests/contract-probe-github.ts:10-16` 与 markdown 版 `:11-17`；契约 `create` 返回类型 `src/tracker/contract/backend-module.ts:165-167`。
  - 第 2 处（`checks` 数组还是工厂）：契约 `checks?: RoomCheckEntry[]`（`src/tracker/contract/backend-module.ts:234`）对 GitHub 真实现零参函数（`src/tracker/rooms/github/checks.ts:53`）与 Markdown 缺席（`src/tracker/rooms/markdown/index.ts:222-252` 无此键）。
  - 第 3 处（`prompts` 错误类目词表）：契约已补成三叉联合（`src/tracker/contract/backend-module.ts:231`），注释里写明“2026-10-13 探针真打红过一次，补上这一种”。三种形状原文见该行：双语全文 `{ zh, en }`、命令词表 `{ cli, cliBrand }`、错误类目词表（键是 `no-git` / `network` 等，值是双语文案）。
- “下一步（都不归本票）”的原文（来源：同一“收尾”一节倒数第 2 条）：探针咬住的三处真差距是地图08、地图09 的输入。这句话把三处差距的归属指到两个后端的图，与 #1025 第 11 条第 3 点同向（见本文件第四章）。

### 3. #1026 收尾的其余验收结论（#1027 不用重验，但要知道口径）

- 来源：#1026 票正文“收尾”一节（deck_issue_get #1026 正文）。
- 契约目录编译零错（门禁第 2 项 PASS）；目录里没有要执行的行为（三份行为搬出契约目录，门禁第 4 项 PASS）；两份探针能编译（门禁第 5 项 PASS）；故意写错能变红（第 6 项缺 `matches` 假后端 PASS；第 7 项运行时腿 PASS，github 16 键 `url` `function`、markdown 15 键 `folder` `absent`）；金标准夹具重跑一致（767 过、4 个预期失败）；操作名录收成单源后旧同集断言撤掉。
- 范围第 5 条的结论原文：`getRepoPermissions` 在契约里是可选成员，GitHub 房有、Markdown 房没有——这是现状，不改（边界不改后端）。两个后端对齐（地图08、地图09）时以探针为尺子。

## 四、13 处多余属性、8 处语义差异、1 处文档矛盾的清单去向

### 1. 清单原文在哪里

- 来源全文：`research/1010-room-conformity-checklist.md` 第 4–5 节（`:72-113`）。
- 第 4 节标题原文（`:72`）：今天不被校验、改接口后新被编译器要求的键。校验现状是 `validateMod` 只验五项（`:74`），写成 `BackendModule` 接口之后新被编译器要求的在 `:78-82` 列了 5 条（含 `presentation` / `checks` / `fixes` 三个契约漏声明的键，与 8 个房内旁路键）。
- 第 5 节标题原文（`:84`）：改 interface 后会新暴露的不一致（结论计数）。
- 计数原文（`:86-95`）：编译器会挡下的共 13 处——GitHub 模块多余属性 3 处（`presentation`、`checks`、`fixes`）、Markdown 模块多余属性 2 处（`presentation`、`fixes`）、GitHub `create()` 产物多余属性 5 处、Markdown `create()` 产物多余属性 3 处；文档与实现矛盾 1 处（`initProject` 在 Markdown 上契约写幂等骨架、实现是固定 `unsupported` 桩）。
- 8 处语义差异原文（`:97-106`）：Markdown `getDependencies` / `close` / `setLabels` / `setAssignees` / `setParent` / `setBlockedBy` 六处收 `opts` 不往下传、全屋 If-Match 强一致在 Markdown 上整类未实现、环检只有 GitHub 有。注意该清单写于 2026-10-11，路径还是搬家前（`src/host/tracker/...`），行号以搬家更正为准。
- 未核实 3 条原文（`:108-112`）：`setLabelColors` 逐字段形状、`getRepoPermissions` 完整字段、Markdown `update` 对 `milestone` / `customFields` 的处理。#1027 动手前若要用到这三处，先重测，不要直接引用。

### 2. 去向：按 #1025 第 11 条第 3 点归地图08，不在 #1025 逐条定

- 来源：#1025 票正文“讨论结论”第 11 条第 3 点（deck_issue_get #1025 正文）。原文是：
  > “范围不被撑爆：`research/1010-room-conformity-checklist.md` 里那 13 处多余属性、8 处语义差异、1 处文档与实现矛盾，本票**不逐条定**，只作为地图08「第一次真实压力测试」的输入。”
- 同票第 3 条还写明逐条语义留给地图08 的讨论票 #1051 与地图09 的讨论票 #1057（来源：#1025 正文第 3 条）。#1027 票面“下一步”也是同一口径：把 13 / 8 / 1 逐条落定，但按第 11 条第 3 点它们是地图08 的输入，不提前定（来源：#1027 票正文“进度”第 5 条）。
- 所以 #1027 动手时不要自己先定这 22 条的语义对错，先读 #1051、#1057 的结论。

## 五、#1027 若现在动手会被哪六张票挡住

### 1. #1027 票面的等待口径

- 来源：#1027 票正文开头（deck_issue_get #1027 正文）：“注意：本票要等地图08与地图09的开发票收尾。”
- 来源：#1027 票正文“进度”第 4 条：“阻塞现状没有变：仍被六张开发票挡着（地图08 #1052、#1053、#1054，地图09 #1058、#1059、#1060），两张地图快照都是五张全开。”
- #1027 的阻塞边共 7 条，其中 1 条是已关闭的讨论票 #1025，其余 6 条是还没有关闭的开发票（来源：deck_issue_get #1027 relations.blockedBy：`["1060","1059","1058","1054","1053","1052","1025"]`；#1025 state=closed，deck_issue_get #1025）。早上执行检查也记了同一结构（来源：#1027 正文“早上执行检查”第 2 条）。

### 2. 六张票逐张（都是 open，2026-10-13 读回）

- #1052 地图08开发：读路径转 TypeScript。state=open，父票 1050，被阻塞 3 条（含 #1051）。来源：deck_issue_get #1052。
- #1053 地图08开发：写路径转 TypeScript。state=open，父票 1050，被阻塞 2 条。来源：deck_issue_get #1053。
- #1054 地图08开发：关系与边转 TypeScript。state=open，父票 1050，被阻塞 2 条。来源：deck_issue_get #1054。
- #1058 地图09开发：解析路径转 TypeScript。state=open，父票 1056，被阻塞 3 条。来源：deck_issue_get #1058。
- #1059 地图09开发：写入路径转 TypeScript。state=open，父票 1056，被阻塞 4 条。来源：deck_issue_get #1059。
- #1060 地图09开发：关系与边转 TypeScript。state=open，父票 1056，被阻塞 5 条。来源：deck_issue_get #1060。
- 六张票自己还被讨论票 #1051、#1057 与搬家尾巴 #1019 等挡着（来源：上面六次读回的 blockedBy 与两张地图快照的 blockedByKeys）。#1027 正文“进度”第 4 条写“这六张票自己还被讨论票 #1051、#1057 挡着”，与读回一致。

### 3. 两张地图快照（都是五张全开）

- 地图08 #1050：子票 5 张，未关闭 5 张、已关闭 0 张（来源：deck_map_snapshot #1050 thin，stats total=5 open=5 closed=0）。5 张是 #1051（讨论）、#1052、#1053、#1054（开发三张）、#1055（讲解）。
- 地图09 #1056：子票 5 张，未关闭 5 张、已关闭 0 张（来源：deck_map_snapshot #1056 thin，stats total=5 open=5 closed=0）。5 张是 #1057（讨论）、#1058、#1059、#1060（开发三张）、#1061（讲解）。
- 现在动手等于抢别人的文件，会撞车（来源：#1027 正文“进度”第 4 条末句）。若维护者要提前动手，需要先改本票的等待口径并松开阻塞边（来源：#1027 正文“进度”第 6 条末句）。

## 六、未核实与动手前先读

- #1026 正文“收尾”写“5 次提交”，纠正评论改成 6 次。本交接转录纠正评论的 6 哈希，未逐个跑 `git log` 复核。标未核实。
- 清单第 5 节末尾 3 条未核实（`setLabelColors` 逐字段、`getRepoPermissions` 完整字段、Markdown `update` 对 `milestone` / `customFields`）照原文标未核实，未展开实现全文。来源：`research/1010-room-conformity-checklist.md:108-112`。
- #1027 正文“进度”第 2–3 条还记了两条本地实测（契约门禁本地复跑全绿 10 项 PASS；两个房间目录下全是 `.ts` 后缀但内容还是旧写法、举例 `src/tracker/rooms/github/backend.ts:29` 与 `:66`）。本次调查没有重跑门禁、没有重读那两个后端实现行，照记为 #1027 票面的说法，不单独背书。标未核实。
- GitHub 上 #1026 正文“收尾”一节与 12:00 纠正评论，本次是用 deck 工具读回的（deck_issue_get #1026），不是用浏览器看 GitHub 页面。若 deck 工具的正文与页面有出入，以页面为准。本条标未核实。
- 动手前先读（指针，不复写结论）：#1025 正文第 7–11 条（结论唯一真源）与规格单 #1102（固化物，挂地图 #1024 下）；#1051、#1057 的讨论结论（语义逐条定）；#1024 的 Decisions so far（指针）。来源：#1025 正文第 2 条、#1027 正文“建票时的原指针”与“搬家后的路径更正”评论。
