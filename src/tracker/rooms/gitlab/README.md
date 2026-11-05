# GitLab 房（后端房间）交接说明

这份文件写给「以后要改这一房的人」。房间的通用规矩（跨房引用怎么判、一次会话只改一个房间）在上一级的 `src/tracker/rooms/README.md`，契约层的书面承诺在 `src/tracker/contract/README.md`，这里不重复。**这一份只讲这一家与另外两家不一样的地方**——照着它走，就不会把 GitHub 或本地 Markdown 的习惯硬套到 GitLab 上。

能力账（26 条逐条登记：哪条做了、哪条为什么不做）在 `docs/tracker/capability-gitlab.md`。程序侧的同一份答案是 `support/capability-register.ts`，两边由门禁 `tests/verify-capability-register.ts` 逐条比对，改一边不改另一边会红。

**用户第一次在这台机器上配 GitLab**（装命令行工具、登录、建一个能用的项目）时，把同目录的 `SETUP-PROMPT.md` 整段贴进对话框即可。那一份是写给用户的现场指引，与「改这一房的代码」无关。

## 一、这一家最要紧的几条不同

### 1. 命令行工具是 `glab`，而且本房客户端丢掉了 HTTP 响应头

`client.ts` 是本房唯一跑外部命令的地方，它只回 `{stdout, stderr, code}` 三段——**响应头在它这一层就没有了**。所以 GitLab REST 那些靠 `X-Total` 头拿总数的做法在本房走不通：计数改问 `GET /projects/:id/issues_statistics`（见 `issues/counts.ts` 的文件头，那里写了为什么选这条）。

**响应头是本房客户端丢掉的，不是 glab 没有。** `glab api` 自己就有两个现成的开关：`-i`（`--include`，把 HTTP 响应头一起打进输出）与 `--paginate`（自动把剩下的页全部翻完）。本房的 `client.ts` 拼参数时没有加这两个，所以它们能给的东西在本房拿不到。代价也说清楚：`-i` 会把响应头混进标准输出，而本房现在一律按纯 JSON 解析回包（`JSON.parse(r.stdout)`），加上它这一步当场就会解析失败。所以真有人需要用响应头时，第一步是改客户端——把响应头与正文分开取回来，并按纯 JSON 解析回包的那些调用方跟着一起改——而不是换个接口绕开。以后想加一条「靠响应头才能做」的能力，先看这两个开关在客户端里打开没有。

跟这条限制同源的一处代价落在 `listPage` 上：`issues/pages.ts` 里 `nextCursor` 的算法是「这一页取满了（行数等于每页条数）就再给一个页码，取不满才是最后一页」。因为拿不到响应头里的总数，**当总数正好是每页条数的整数倍时，最后一页仍然会给出一个游标**，调用方会多取一次、拿回一个空数组。这是这套接口设计的代价，不是错误：契约的返回里能表达「有没有下一页」的只有 `nextCursor` 这一格，没有别的位置能补一句「这已经是最后一页」。读的人不要以为这里已经省下了那一趟。

同一条「一页 100 行」的限制还落在 `list` 上（票列表主路径，不翻页）：请求固定 `per_page=100`，**取满一页就认为后面还可能有一页没取到**，回包里置 `truncated: true`，并在返回前落一行 `read.degraded`（`reason` 为 `list:truncated`，取不满时不记）。正好 100 张票也会被标成截断，代价只是面板与工具回执多一句「这份清单不全」的说明，不会把数字算错。`truncated` 往上走就是面板数字角的小圆点与工具回执里的那句话；真正读全（翻页或按 `updated_after` 取增量）是另一件事，见 #1772。

`platform` 或 `exec` 不在上下文里时，客户端回的是 `code: 127` 加一句 `stderr: 'platform unavailable'`，不抛异常。调用方按 `OpResult` 归一。

### 2. 仓库身份是「群组/子群组/项目」的完整路径

`repo.refId` 形如 `group/sub/project`，可以有好几层。往 API 路径里拼之前一律 `encodeURIComponent`。`repo/identity.ts` 的 `getRepoKey` 就是干这个的：从 git remote 解析，认不出就退到 `.git/config`，再退到 `glab repo view`。

### 3. 父子关系落在票文件头的隐藏标记，不是远端原生层级

GitLab 平台本身有原生的父子层级：官方文档的「Child items」一页整页在讲这件事（`Tier: Free, Premium, Ultimate`，任务可以作为子条目挂在议题下面，epic 下面也能挂议题）。**层级不在本房走的这条路上**：那条路叫 work items，入口是界面与 GraphQL。本房取数一律走 `glab api` 的 REST 接口。所以：

- `setParent` 落下去的是票文件头的隐藏标记 `<!-- DSH-PARENT: <地图> -->`（建票时带 `parentKey` 直接写进去），不是任何 links，更不是层级。旧 `Part of #<地图>` 可见行退役：不再写，只在过渡期回退认，写时顺手置换掉。
- `listSubIssues` 读的也是这个标记（见 `issues/sub-issues.ts` 的文件头，那里写了结论与依据）：有这个标记就是子票，没有就不是 —— 不猜、不按 links 方向推断。人手工加的 `relates_to` 关联不参与归属判定。
- 归属的真相只有这个标记：免费档/付费档都一样，不存在「付费档才能用」的限制。标记只认文件头（第一个标题之前），正文中间手写的同一写法不算——这正是可见行退役的原因。
- 阻塞沿用上一节第 4 条的上限/回退两条路，回退写法是成对的两行：人读的 `Blocked by: #12, #13` 与程序读的机器表 `<!-- DSH-BLOCKED-BY: 12, 13 -->`（见 `model/description-markers.ts` 的成对写，读侧机器表优先）。

**该往哪使劲**：这是「本房这条 REST 路拿不到层级边」，不是「GitLab 做不到」。以后真需要远端认的层级，那是一条新能力——换成 work items 的 GraphQL 查询，把读与写一起重做，得另开一票；反过来，也别对用户说「GitLab 没有子票」，平台有。

### 4. 阻塞边：有原生能力就真写，拿不到才回落到正文里的 `Blocked by:` 行

免费档探测原生 `is_blocked_by` 常常拿到 403/404。本房的做法按上限走：**有能力就逐条写原生边（POST 加、DELETE 删，删边拿链接自己的 `issue_link_id`），写后读回核对**；拿不到能力（滚回干净）才**回落到重写正文里的成对两行**——人读的 `Blocked by: #12, #13` 与程序读的机器表 `<!-- DSH-BLOCKED-BY: 12, 13 -->`（见 `model/description-markers.ts` 的成对写）。读的时候是三层顺序：原生有值就用原生（状态逐张落实），没有读机器表，再没有读可见行。写之前会先做环检（含自环），拦住会让依赖成环的改动。读在 `graph/read.ts`，写在 `graph/write.ts`。

### 5. 标签颜色只有一个 `color` 字段，写入必须带前导井号

GitHub 那种「背景色 + 前景色」的双色在 GitLab 不存在：一条标签只有一个 `color`，另有服务器自己算出来的 `text_color`。两条硬约定：

- **写入时必须发 `#` 加六位十六进制**（`color=#9d7cd8`）。发不带井号的裸色远端会拒——这条是 2026-10-14 查官方文档核实的，注释写在 `labels/colors.ts`。
- `text_color` **写不了**：三张参数表里都没有它。所以别承诺「能让用户自己指定前景色」。
- 标签名的大小写语义没有核实过，所以本房**不照 GitHub 那样折叠大小写**：重名只按去掉首尾空白后的原文逐字比较。

### 6. `ensureLabelColorsFile` 在本房形态不合

这条能力承诺的不只是「放一份文件」，还有「改了算数」。GitLab 的颜色真源是远端仓库的标签，工作区里那份文件没有读者，改了不算数。所以登记为**明确不支持**，由注册表补桩回诚实的 `unsupported`。要读颜色用 `listLabels`，要改颜色用 `setLabelColors`。**不要借这一条的名字把一份没读者的文件放回来**——那要么是一件新能力（得先回答「这份文件的读者是谁」），要么就是误导人。

## 二、目录树

路径都相对 `src/tracker/rooms/gitlab/`。根目录分三层：7 个真实文件、9 个只做转发的旧路径文件、两份说明；其余实现按概念住在子目录里。

```
src/tracker/rooms/gitlab/
├── index.ts                 入口：模块对象、工厂、识别（matches）与提示文案
├── requests.ts              请求边界：每个远端端点一个具名函数
├── client.ts                进程边界：唯一跑 glab 的地方
├── queries.ts               API 地址与查询串的拼法
├── errors.ts                错误判档的唯一出口（classifyGlabError / failGlab）
├── preflight.ts             环境探针：glab 装没装、登没登、接口通不通
├── budget.ts                额度探针：读 RateLimit 响应头
├── normalize.ts             旧路径转发 → model/normalize.ts 与 model/description-markers.ts
├── issues.ts                旧路径转发 → issues/read.ts 与 issues/write.ts
├── maps.ts                  旧路径转发 → issues/maps.ts
├── repo.ts                  旧路径转发 → repo/identity.ts
├── graph-membership.ts      旧路径转发 → graph/membership.ts
├── idempotency.ts           旧路径转发 → issues/idempotency.ts
├── capability-register.ts   旧路径转发 → support/capability-register.ts
├── read-log.ts              旧路径转发 → support/read-log.ts
├── read-sources.ts          旧路径转发 → support/read-sources.ts
├── README.md                这份交接说明
├── SETUP-PROMPT.md          用户第一次配置 GitLab 的现场指引
│
├── model/                   跨领域共享的回包归一与正文标记
│   ├── normalize.ts         GitLab 原始形状 → 契约 Issue
│   ├── description-markers.ts  票面文件头标记的解析、成对重写与回退
│   └── repo-identity.ts    从仓库引用或识别句柄取仓库标识的唯一一处
│
├── issues/                  票的读、写与地图清单
│   ├── read.ts             列票、读单票、评论与链接富化
│   ├── write.ts            建票、关票、重开、改票
│   ├── create-write.ts     建票的单条写路径（一次调用最多一条写请求）
│   ├── idempotency.ts      建票幂等锚：写锚与建后按锚回查
│   ├── counts.ts           计数（issues_statistics）
│   ├── pages.ts            分页读票（游标就是页码）
│   ├── maps.ts             地图薄查（listMaps）
│   └── sub-issues.ts       取一张地图上挂着的票
│
├── comments/
│   └── write.ts            写一条评论
│
├── labels/
│   ├── assign.ts           给一张票整集替换标签（setLabels）
│   ├── list.ts             仓库标签清单（listLabels）
│   ├── colors.ts           批量改标签颜色（setLabelColors）
│   └── shared.ts           两份标签路径共用的失败原文处理
│
├── graph/
│   ├── read.ts             阻塞边的读、原生能力探测、对端状态落实
│   ├── write.ts            阻塞边的写、环检与正文成对回退
│   └── membership.ts       亲缘挂载（隐藏标记）与指派
│
├── repo/
│   ├── identity.ts         从工作区认出仓库：三层兜底、网页端 origin 与 getRepoKey
│   ├── current-user.ts     当前登录人
│   └── permissions.ts      当前账号在这张仓库上的权限
│
├── project/
│   └── init-project.ts     开仓发布：建仓、推代码、回查项目本体
│
├── support/
│   ├── read-log.ts         读路径日志出口（read.degraded / preflight.gate / repo.resolve.tier）
│   ├── capability-register.ts  26 条能力的数据化回答
│   └── read-sources.ts     12 条读操作的读来源默认值
│
└── room/
    ├── links.ts            票与仓库的链接、地址、识别用默认站点
    └── fixes.ts            检查失败时界面上的修复指引
```

目录轴只有一条：按后端概念竖切；读与写是文件名的属性，不是顶层目录。要改一张票的读法打开 `issues/read.ts`，要改标签颜色打开 `labels/colors.ts`；跨概念的共享件只在 `model/`、`support/`、`room/` 里出现。

## 三、旧路径 → 新位置对照表

根目录这 9 个文件只为房外读者保留，**只做 `export ... from '新位置'`，没有逻辑、没有包装、没有默认值、没有副作用**（#1921 已逐项核对）。房里的实现文件一律直接从新位置 import，不经过这些转发文件。

| 旧路径（根目录） | 新位置 | 为什么还留着 |
|---|---|---|
| `normalize.ts` | `model/normalize.ts`；正文标记的六个函数在 `model/description-markers.ts` | 房外的契约夹具、快照门禁与 `tests/verify-1599-gitlab-hidden-markers.ts` 仍按这条路径取 `normalizeIssue` 与标记函数 |
| `issues.ts` | `issues/read.ts`（listIssues / getIssue）与 `issues/write.ts`（create / close / reopen / update） | `tests/verify-1770-gitlab-list-truncated.ts`、`tests/verify-1784-comment-pagination.ts` 按路径动态加载 |
| `maps.ts` | `issues/maps.ts` | `tests/verify-1605-gitlab-map-list.ts`、`tests/verify-1605-map-routing-guard.ts` |
| `repo.ts` | `repo/identity.ts` | `tests/tracker-contract/sections/room-gitlab-extras.ts` |
| `graph-membership.ts` | `graph/membership.ts` | `tests/verify-1785-assign-unknown.ts` |
| `idempotency.ts` | `issues/idempotency.ts` | `tests/verify-1827-double-anchor.ts` |
| `capability-register.ts` | `support/capability-register.ts` | `tests/verify-capability-register.ts`、`tests/verify-1605-map-routing-guard.ts`、`tests/verify-1446-gitlab-budget.ts` |
| `read-log.ts` | `support/read-log.ts` | `tests/verify-1130-gitlab-marker-read.ts` |
| `read-sources.ts` | `support/read-sources.ts` | `tests/verify-operation-catalog.ts` |

删除这些文件的唯一前提是**房外读者先改完 import**（这次结构改造的约束是不改房外代码）。删的时候按上表逐项核对，删掉的只是一行 import 与 export，不需要把逻辑搬回根目录；谁想提前删，先把房外引用改掉，而不是直接删文件。

## 四、根目录语法

根目录只有下面四个文件可以直接发 `glab api`：

- `requests.ts`：请求边界。每个远端端点一个具名函数（`requestIssueList`、`requestIssueGet`、`requestCommentCreate` 等），本房所有 REST 请求形状的唯一出处。
- `client.ts`：传输层。唯一跑外部命令的地方，回 `{stdout, stderr, code}` 三件套；它带的 `api` 快捷方法不再被任何操作 module 使用。
- `preflight.ts`：环境探针。自己发 `api user` 与 `api projects/...` 两条探测请求，失败判档走 `errors.ts`。
- `budget.ts`：额度探针。自己发一条带 `--include` 的 `api version`，读响应头里的 `RateLimit-Limit` / `RateLimit-Remaining`。

其余任何操作 module 一律不拼 method、路径与表单字段，只调 `requests.ts` 的具名函数：

- 函数参数只收领域值（仓库引用、票号、正文、查询条件、超时），不接收已经拼好的路径字符串；路径由 `requests.ts` 自己用 `queries.ts` 拼。
- 函数只返回原始进程结果三件套，不解析 JSON、不判错误档位、不写失败话术、不记日志；这些留在调用方，因为每个调用点的容错与说法都不一样。
- 新增请求函数写在 `requests.ts` 末尾，命名与返回约定照现有函数；不要为了某一族换超时另造重复函数，超时由调用方传。

非 api 的 `glab` 子命令（`repo create`、`repo view`、`auth status` 等）不算 REST，留在各自 module，经 `client.ts` 的进程边界执行（例如 `project/init-project.ts` 的建仓、`repo/identity.ts` 第三层兜底的 `repo view`）；那几条 `glabClient` 的出现是合法的，不要把它们当成绕过请求边界。

端点采样门禁 `tests/verify-1179-gitlab-endpoint-coverage.ts` 只扫房间根目录的直接子文件、不递归子目录，所以请求函数必须留在根目录的 `requests.ts`；请求形状写进子目录，门禁就看不见它。这条限制与「新增请求绕过请求 module」这个已知盲点写在 `docs/adr/20261105-gitlab-room-request-boundary.md`。

## 五、房间里的两个唯一出口

改这一房之前先认准这两处，别在别的地方另开一个：

- **日志**：`support/read-log.ts`。读路径每一条「没读成」的分支都要在失败之前调 `emitReadDegraded`，探环境与识别档位另有 `emitPreflightGatePass` / `emitRepoTier`。**事件名沿用全仓已登记的那三个**（`read.degraded`、`preflight.gate`、`repo.resolve.tier`），本房没有自己的 `glab.*` 事件名；`reason` 只能取 `READ_DEGRADED_REASONS` 里登记过的值，要加先改那个文件与附录对照表。房间里其余地方不许直接用 `ctx.logEvent`。
- **错误判档**：`errors.ts` 的 `classifyGlabError` / `failGlab`。失败类别只在这里判一次，别的地方按结果写话，不自己写正则判第二遍。

## 六、改这一房之前先跑什么

- 类型检查：`node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json`（零输出才算过；本仓的 `npx tsc` 是占位壳，别用）。全仓类型检查用 `npm run typecheck`。
- 契约测试：`node --import ./scripts/ts-hook.mts tests/verify-tracker-contract.ts`。**它末尾有 4 条 `violating-stub` 的 FAIL 是故意的**——那是「违规桩必须被逮住」的反证，判据是最后一行打出 `CONTRACT SKELETON OK`。看到那 4 条 FAIL 就去数总数，不要以为自己改坏了。
- 能力登记三处对齐：`node --import ./scripts/ts-hook.mts tests/verify-capability-register.ts`。
- 端点采样：`node --import ./scripts/ts-hook.mts tests/verify-1179-gitlab-endpoint-coverage.ts`。改 `requests.ts` 的路径或 method 之后必须跑它。

改了一条能力之后，要同步的三处：本房实现 → `support/capability-register.ts` → `docs/tracker/capability-gitlab.md`。顺序就是这个顺序，最后一步忘了会红在那个门禁上。
