# 九个 deck 工具对外的样子（地图04 规格 · 票 #1106）

这份文档只回答一句话：**九个对外工具「长什么样」——哪些不许动，哪些可以动。**

读它的人有两类：准备改这九个工具的人（先看这里，再动代码）；以及以后接手的人（想知道某个键为什么死活不能改名）。

可执行的那一份是 `tests/verify-1106-deck-surface.ts`：同一套对照面写成断言，参数改一个键、说明改一个字、缺省改一个数、回执少一格、点数动一条，它就红。文档给人读，测试给机器盯，两边说的是同一件事。

---

## 〇、先记住三件事

1. **工具定义是唯一事实。** 参数名、必填、枚举、给模型看的那句话，都写在 `src/deck/tools/<工具名>.ts` 的 `definition` 里。别在别处再抄一份参数表——抄一份就一定会跟它走散。
2. **回执是行为，不是实现细节。** 回执多一格、少一格、原因码换个写法，都等于改了对外契约，调用方（模型）看到的就变了。
3. **点数也是行为。** 改一个缺省，可能顺手改了这次调用报出去的花费；账要有人对，所以点数冻在这里。

这张规格来自讨论票 #1034（维护者 2026-10-13 全部认可），背景见 `research/1034-ts-migration-background.md`，决议依据见整体改写决议与地图 #1010 的范围五条。

---

## 一、表一 · 参数表（九个工具的入参）

| 工具 | 必填 | 可选参数（类型 · 取值 · 缺省） |
| --- | --- | --- |
| `deck_context` | 无 | 没有参数。看工作区、后端、仓库与地图清单。 |
| `deck_issue_get` | `key` | `comments`（数字，最多带回几条评论，缺省 50，钳在 0–200）· `section`（字符串，只回正文里这一节，`##` 标题的子串；缺省回全文前 2000 字）· `blocking`（布尔，要不要反向阻塞边；**缺省要**，只有显式传 `false` 才跳过全仓扫描）· `effortId` |
| `deck_map_snapshot` | `key` | `frontierOnly`（布尔，只回可接的子票；缺省回全部）· `detail`（枚举 `full` / `thin`，缺省 `full`；`thin` 只回薄行，统计与进度表照算）· `effortId` |
| `deck_issue_list` | 无 | `state`（枚举 `open` / `closed` / `all`，缺省 `open`）· `type`（枚举 `issue` / `map` / `all`，缺省 `all`）· `labels`（字符串数组，必须同时带上，AND）· `assignee` · `query`（标题与正文的子串）· `limit`（数字，缺省 50，钳在 1–200）· `effortId` |
| `deck_issue_create` | `title` | `body`（缺省按种类补最小骨架）· `kind`（枚举 `task` / `bug` / `map`，缺省 `task`）· `parentKey` · `labels` · `assignees` · `idempotencyKey` · `effortId` |
| `deck_map_plan_create` | `title`、`children` | `body`（缺省自动补五个区块）· `planId`（同一个值重跑就接着上次没做完的继续；想建第二张内容相同的计划时传一个不同的值，否则按重试复用旧票；它会原样当幂等键写进票面，字符集由后端定——只能用字母、数字、点、下划线、连字符、冒号与斜杠，写中文会被后端挡下并回 `backend-unsupported`）· `labels` · `edges`（每项必填 `from`、`to`；`type` 枚举 `blocked-by` / `parent`；`from` 写 `@map` 指地图自己）· `effortId`；`children` 每项必填 `key`、`title`，可选 `body`、`kind`（同上三档）、`labels`、`assignees` |
| `deck_map_link` | 无 | `key` 与 `edges` 二选一，两个都不给回 `bad-args`。`key`：要改的那张子票 · `parentKey`：要挂到的父票 · `blockedBy`：这张票被哪些票阻塞（**整批替换**，给空数组就是清空）· `edges`（一次改多张票，每项必填 `key`，其余同左）· `effortId` |
| `deck_issue_patch` | `key` | `comment` · `addLabels` · `removeLabels` · `assignees`（整批替换，给空数组就是取掉认领）· `title` · `body` · `progress`（只改「## 进度」那一段）· `close`（布尔，`true` 关闭；`false` 不再表示重开：`#1298` 起重开不在 AI 工具面上提供，传 `false` 会回一条「做不到」）· `effortId` |
| `deck_issue_report` | `key` | `note`（一句备注，只回显、不进调用链）· `progress`（数字，0 到 100 的整数，这次上报的进度自评；只写进本会话这张票的工作条目、只作展示，不参与任何判定；不传时这次不带进度，条目上不记这一格，也不沿用上一次的数字）· `effortId` · `release`（布尔，传 `true` 把这件票从本会话的工作路线里释放掉：只删本会话那一行，票本身的状态与认领人不动） |

三条口径写在表外，但同样冻着：

- **多传即拒**：每个对象节点（根节点、`children` 的每一项、`edges` 的每一项）都显式写了 `additionalProperties: false`。挡下多传的键是宿主在调用入口按定义做的事；工具自己收到不认识的键时不报错，当没有。
- **枚举不认识时按缺省走**：枚举取值由定义声明、由宿主在入口挡；工具内部收到不认识的值不报 `bad-args`，按缺省那一档处理（例如 `state` 给个不认识的字符串，当 `open` 用）。
- **`effortId` 一律可选**：只有本地（Markdown）后端需要它，填票所在的目录名；根目录不填，远端后端忽略。

表里的**缺省值与钳制范围**不是摆设，它们和参数名一样冻着。做法不是去抄源码里的数字（那只是把同一份东西抄第二遍），而是从外面撞：给工具换一个「只记录、不真读」的后端，看它不传这个参数时交下去的是什么、按哪个数截断——例如列票不传条数时回 50 行、传 500 时回 200 行（多出来的行被上限截掉）。改一个数就红。

**给模型看的那几句话也逐字冻着**：工具本级一句，每个参数各一句。改一个字、补一句、删一句都会红。改是允许的（比如为了让模型更好懂而润色），但改了要连对照面一起改——冻结是为了让改动留痕，不是不让改。长度上限与两处关键文案另有门禁盯着（见第七节）。

---

## 二、表二 · 信封表（回执长什么样）

回执有**两种形状**，按「有没有走到选后端那一步」分。两种都是冻的，调用方按形状读。

### 形状甲：走到选后端之后（14 格，一个不多一个不少）

`tool` · `status` · `ok` · `reason` · `text` · `workspace` · `backend` · `repo` · `cost` · `data` · `items` · `notes` · `readBack` · `touched`

- `status`：三态之一，`ok`（做成了）/ `partial`（一批里有的成、有的没成，逐项列在 `items` 里）/ `unsupported`（没做成，原因写在 `reason` 里）。**没有第四种状态**：被闸挡下、没后端、后端抛错，都是 `unsupported` 加一个原因码。
- `ok`：就是「`status` 是不是 `ok`」，跟着三态走。
- `reason`：成功时是空串；失败时取下面七个码之一。
  `no-session-context`（会话取不到工作区）· `ai-tool-refused`（超了单次或每小时硬顶）· `no-backend`（这个工作区没有定下后端）· `gate-defer`（被闸推迟）· `backend-threw`（后端实现抛错，已被拦下）· `backend-unsupported`（后端说做不到 / 这张票读不回来）· `bad-args`（参数不对，请按参数说明重调）
- `text`：给人看的一句话。`data` / `items` / `notes` / `readBack` / `touched`：工具自己的数据、逐项明细、我替你做了什么、写后读回、这次动到的票。缺就是 `null` 或空数组，不省略这一格。
- `cost.estimated`：调用前的估算（点数、条数、硬顶判断、分片建议）。`cost.actual`：闸真正记下来的花费（谁绕开闸发请求，这个数就不动）。

### 形状乙：还没走到选后端就失败（6 格）

`tool` · `status` · `ok` · `reason` · `text` · `cost`（只有 `estimated`）

会话取不到、必填缺、一次调用两样都没给（例如 `deck_map_link` 既没 `key` 也没 `edges`）——这些在碰后端之前就结束了，所以回执里没有工作区、后端、仓库那几格。这一种也不记任何点数。

### 两条同时管着两种形状的硬话

- **失败永远是值，不是异常。** 后端实现抛错、闸拒绝、没后端、会话取不到、参数稀奇古怪（`null`、数字、字符串、数组、对象当票号），一律变成一张回执。抛出去的话，AI 会退回去用它熟悉的 `gh`，两条写路径同时开火。
- **记账数不上信封。** 工具交给闸的那个「我这次打算花几条、几点」不放在回执里（`consumers` 只看 `cost.actual`），所以回执里没有 `claimed` 这一格。讨论票 #1034 的结论里把 `claimed` 和信封字段列在一起讲，这里按代码与金标准回执对齐：它是工具与闸之间的交回数，不是回执的一格。

---

## 三、表三 · 点数表（每一笔记多少账）

先记住那一笔固定开销：**只要走到选后端这一步，就先记 1 条、0 点**（选后端那次探测的价钱）。后端不认识仓库标识、要再补全一次时，再记 1 条、0 点。下面表里的「工具自己报的」是第二笔，两笔相加才是这一次调用总共记的账。

| 工具 | 走到哪一支 | 工具自己报的（条 / 点） | 这一次总共记的 |
| --- | --- | --- | --- |
| `deck_context` | 成功 | 3 / 2 | 4 / 2 |
| `deck_issue_get` | 还没选后端就失败（会话、参数） | 不记 | 0 / 0 |
| `deck_issue_get` | 票读不回来 | 1 / 3 | 2 / 3 |
| `deck_issue_get` | 成功，跳反向边（`blocking: false`） | 1 / 3 | 2 / 3 |
| `deck_issue_get` | 成功，读全量关系（缺省） | 2 / 6 | 3 / 6 |
| `deck_issue_list` | 还没选后端就失败 | 不记 | 0 / 0 |
| `deck_issue_list` | 列表读不回来 | 1 / 3 | 2 / 3 |
| `deck_issue_list` | 成功（回多少行都一样） | 2 / 5 | 3 / 5 |
| `deck_map_snapshot` | 还没选后端就失败 | 不记 | 0 / 0 |
| `deck_map_snapshot` | 地图读不回来 | 1 / 3 | 2 / 3 |
| `deck_map_snapshot` | 成功（`full` 与 `thin` 同价） | 2 / 5 | 3 / 5 |
| `deck_issue_create` | 还没选后端就失败（缺标题等） | 不记 | 0 / 0 |
| `deck_issue_create` | 参数错，且需要读回 | 1 / 4 | 2 / 4 |
| `deck_issue_create` | 成功，没有父子边 | 2 / 4 | 3 / 4 |
| `deck_issue_create` | 成功，带父子边 | 3 / 6 | 4 / 6 |
| `deck_map_plan_create` | 还没选后端就失败（缺 `title` / 子票；或同一个计划标识正被另一次执行占用） | 不记 | 0 / 0 |
| `deck_map_plan_create` | 地图票没建成（后端挡下，例如计划标识里写了中文） | 1 / 4 | 2 / 4 |
| `deck_map_plan_create` | 成功 | 与估算相同（见下） | 估算 + 1 条 |
| `deck_map_link` | 还没选后端就失败 | 不记 | 0 / 0 |
| `deck_map_link` | 成功 | 与估算相同 | 估算 + 1 条 |
| `deck_issue_patch` | 还没选后端就失败 | 不记 | 0 / 0 |
| `deck_issue_patch` | 成功 | 与估算相同 | 估算 + 1 条 |
| `deck_issue_report` | 还没选后端就失败 | 不记 | 0 / 0 |
| `deck_issue_report` | 成功 / 票读不回来（同价） | 1 / 3 | 2 / 3 |

「与估算相同」的那三支，用的是同一份价目（`src/shared/refresh/src/tool-cost.ts`）：

- 固定开销 3 点 / 2 条；建一张票 4 点 / 2 条；一条边 2 点 / 1 条；改一张票 2 点 / 1 条；读回一张票 3 点 / 1 条。
- 估算的输入按工具算：建票 `tickets` 1 张、`edges` 数 = 有没有 `parentKey` 加 `blockedBy` 的条数；建地图 `tickets` = 子票数 + 1（地图自己）、`edges` = 给的边 + 子票数；连边 `reads` 1 次、`edges` = 给的边 + 有没有 `parentKey`；改票 `patches` 1 次、`reads` 1 次、`edges` = 有没有 `parentKey`。
- 顺带一句：估算与真实出站数是两个数。本地 Markdown 后端一次请求都不发，所以回执里 `cost.actual` 常常是 0 / 0，而工具仍然按上面的数报账——报的是「这件事按价目该花多少」，不是「这次真发了几条」。

---

## 四、壳的四条硬要求、装配顺序，与另外三件对照面

**壳的四条**（写在 `src/deck/shell/call-shell.ts:18-23`，改这四条等于拆地基）：

1. 每一次后端调用都过闸（`gate.admitAiTool` 先判硬顶，超顶直接拒绝并说清顶在哪；`gate.send` 再记真实花费）。工具文件里没有一处直接调后端实现，也没有一处自己判后端是谁。
2. 后端一律走既有优先级出口 `registry.select`（用户手动选择 > 锚文件 > 自动识别），工具不自己挑。
3. 工作区与仓库从会话上下文取（`exec.agent.session`），不接受调用方传参；解析不出来就如实说做不到。
4. 工具永不抛异常（同上，失败一律变成三态回执）。

**装配顺序**：九个工具按固定顺序装表——`deck_context`、`deck_issue_get`、`deck_map_snapshot`、`deck_issue_list`、`deck_issue_create`、`deck_map_plan_create`、`deck_map_link`、`deck_issue_patch`、`deck_issue_report`。宿主装配与展示都按这个顺序。

**另外三件**（它们也是对照面的一部分，因为回执里会出现它们）：

- 必备标签：地图票补 `wayfinder:map`；任务票补 `wayfinder:task`；缺陷票补 `bug`、`needs-triage`。已经有的不重复加，大小写不同算已经有。
- 地图五个区块：`## Destination`、`## Notes`、`## Decisions so far`、`## Not yet specified`、`## Out of scope`，缺哪个补哪个。
- 幂等锚：`deck-<八位十六进制>-<档位>`，档位是「时刻 ÷ 五分钟窗口」的整数部分；同一份输入永远算出同一个锚，跨窗口才换锚。窗口判定是纯函数，读钟由调用方传进来。

---

## 五、可以动的东西（换写法时有空间的）

- 超时怎么钳、钳多少（只要「超时只坏自己那一项、不拖垮整笔」这条不变）。
- 沙箱策略怎么等、等不到怎么办（现在的口径：等不到按「没有」往下走）。
- 内部写法：函数怎么拆、文件怎么分、近似重复的判断怎么抽。
- 日志与注释：加什么埋点、怎么写注释。
- 类型怎么标（只要不改对外形状）：`#1040` 之后这九件在严格类型检查下，类型只放契约层、定义是唯一事实。
- 缺省值、钳制范围、给模型看的说明文案：**可以改**，但改了门禁会红——那是提醒你把这份规格与 `tests/verify-1106-deck-surface.ts` 里冻着的值一起改，不是不让你改。

## 六、越界判据（出现即算破了「薄工具厚壳」）

九个工具文件（`src/deck/tools/**`）里不该出现直连外面的写法：起进程、发网络请求、走命令行 `gh`、读环境、读写文件、动态求值，以及任何后端 id 的等值比较（`=== 'github'` 这种——那样工具就在自己判后端了）。要做这些事，一律经注入进来的依赖或壳。

时间这一类单独说，不能一禁了之：**`Date.now` / `new Date` 只能当那个可换时钟的缺省值**（同一行必须写着 `typeof d.now === 'function'`），**`setTimeout` 只能当超时钳制的那一支**（同一行必须写着 `Promise`）。这两件事本来就在可动清单里，九份工具各写了一份；超出这两种形状——比如直接拿它们读真实时间做业务判断——同样算出界。

---

## 七、每一条对照面由谁钉着（改坏了哪扇门禁会红）

| 对照面 | 钉它的门禁 |
| --- | --- |
| 参数表（结构：名、必填、枚举、多传即拒） | `tests/verify-1106-deck-surface.ts`；参数写法的合法性另有 `tests/verify-deck-tools-agent-register.js` |
| 参数表（取值：缺省是多少、传过头按哪个数截断） | `tests/verify-1106-deck-surface.ts`（换一个「只记录、不真读」的后端从外面撞） |
| 参数说明的文本（工具本级一句 + 每个参数各一句，逐字） | `tests/verify-1106-deck-surface.ts` |
| 参数说明的长度与两处关键文案 | `tests/verify-deck-tools.js`（描述 ≤350 字）、`tests/verify-deck-thin-reads.js` |
| 信封表（14 格 / 6 格、三态、七个原因码、失败不抛） | `tests/verify-1106-deck-surface.ts`；记账数不外露另有 `tests/verify-deck-exec-phone.js` |
| 点数表 | `tests/verify-1106-deck-surface.ts` |
| 九个工具的整条来回（正例、负例、过闸、永不抛） | `tests/verify-deck-tools.js` |
| 逐字节零变化（金标准回执） | `tests/verify-golden-receipts.ts`（基准在 `tests/tracker-contract/fixtures/golden-receipts/`） |
| 装配顺序 | `tests/verify-1106-deck-surface.ts` 与 `tests/verify-1039-rules-pure.ts`（顺序表在 `src/deck/rules/tool-order.ts`） |
| 必备标签、五个区块、幂等锚 | `tests/verify-1039-rules-pure.ts` |
| 越界判据（工具里不许直连外部；时间只许那两种形状） | `tests/verify-1106-deck-surface.ts`；不判后端另有 `tests/verify-deck-tools.js` 的静态扫描 |
| 契约层只放类型、不出现运行时实现 | `tests/verify-dependency-rules.ts`（依赖规则）、`tests/verify-deck-tools-row-zero-dep.js` |

这一扇已经挂在 `package.json` 的 `scripts.verify` 链上（第 54 步，紧跟九个工具那几扇），`tests/gate-map.json` 也重算过：以后谁动了九个工具的参数形状、回执形状、点数或越界写法，`npm run verify:changed` 就会把它挑出来跑，不用等人记得。

---

## 八、这份规格没做的事

- 不动业务规则：参数改名、加参数、加功能都不在这次范围里。上一张开发票（#1035）只做了语言翻译与输出渲染，行为零变化由金标准回执逐字节比对证明。
- 游标改存 YAML、换目录另立票；快照效果改动（写进度、原话区、回读）归正文进度与用户原话那张地图。
- 后端房间内部、面板渲染、四个已有计算核、提示词文案，都不在这里。
- 不引入新依赖（含运行时校验库）。
- 十二个参数没有各自的说明（`deck_map_plan_create` 的 `labels`，以及它 `children` 与 `edges` 条目里的字段；`deck_map_link` 的 `edges` 条目里的字段）。这是本来就有的粗糙处：本次只把它冻住，不动文案——补说明等于改模型看到的东西，该另立一张票。数组本身是有说明的（例如 `children` 写着「要建的子票清单」）。
