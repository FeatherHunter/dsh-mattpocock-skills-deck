# GitLab 房（后端房间）交接说明

这份文件写给「以后要改这一房的人」。房间的通用规矩（跨房引用怎么判、一次会话只改一个房间）在上一级的 `src/tracker/rooms/README.md`，契约层的书面承诺在 `src/tracker/contract/README.md`，这里不重复。**这一份只讲这一家与另外两家不一样的地方**——照着它走，就不会把 GitHub 或本地 Markdown 的习惯硬套到 GitLab 上。

能力账（25 条逐条登记：哪条做了、哪条为什么不做）在 `docs/tracker/capability-gitlab.md`。程序侧的同一份答案是 `capability-register.ts`，两边由门禁 `tests/verify-capability-register.ts` 逐条比对，改一边不改另一边会红。

## 一、这一家最要紧的几条不同

### 1. 命令行工具是 `glab`，而且客户端丢掉了 HTTP 响应头

`client.ts` 是本房唯一跑外部命令的地方，它只回 `{stdout, stderr, code}` 三段——**响应头在它这一层就没有了**。所以 GitLab REST 那些靠 `X-Total` 头拿总数的做法在本房走不通：计数只能改问 `GET /projects/:id/issues_statistics`（见 `counts.ts` 的文件头，那里写了为什么选这条）。以后想加一条「靠响应头才能做」的能力，先想清楚这个限制还在不在。

`platform` 或 `exec` 不在上下文里时，客户端回的是 `code: 127` 加一句 `stderr: 'platform unavailable'`，不抛异常。调用方按 `OpResult` 归一。

### 2. 仓库身份是「群组/子群组/项目」的完整路径

`repo.refId` 形如 `group/sub/project`，可以有好几层。往 API 路径里拼之前一律 `encodeURIComponent`。`repo.ts` 的 `getRepoKey` 就是干这个的：从 git remote 解析，认不出就退到 `.git/config`，再退到 `glab repo view`。

### 3. 没有原生父子关系

GitLab 今天没有「这一张是那一张的子票」这种原生边。所以：

- `setParent` 落下去的是一条 `relates_to` **平级链接**，不是层级。
- `listSubIssues` 读的也是这条链接（见 `sub-issues.ts` 的文件头，那里写了结论与依据）。
- `relates_to` 是对称的：**人手工加的链接与程序写下的父子分不出来**。拿回来的东西能画关系，但别当成原生层级用，也别对用户说「这是它的子票」而不加限定。

### 4. 阻塞边：原生能力常拿不到，回落到正文里的 `Blocked by:` 行

免费档探测原生 `is_blocked_by` 常常拿到 403/404。本房的做法不是报「做不到」，而是**回落到重写正文里那一行** `Blocked by: #12, #13`（见 `graph-blocking.ts`）。读的时候也是这个顺序：原生有值就用原生，没有就读那一行。写之前会先做环检（含自环），拦住会让依赖成环的改动。

### 5. 标签颜色只有一个 `color` 字段，写入必须带前导井号

GitHub 那种「背景色 + 前景色」的双色在 GitLab 不存在：一条标签只有一个 `color`，另有服务器自己算出来的 `text_color`。两条硬约定：

- **写入时必须发 `#` 加六位十六进制**（`color=#9d7cd8`）。发不带井号的裸色远端会拒——这条是 2026-10-14 查官方文档核实的，注释写在 `labels-ops.ts`。
- `text_color` **写不了**：三张参数表里都没有它。所以别承诺「能让用户自己指定前景色」。
- 标签名的大小写语义没有核实过，所以本房**不照 GitHub 那样折叠大小写**：重名只按去掉首尾空白后的原文逐字比较。

### 6. `ensureLabelColorsFile` 在本房形态不合

这条能力承诺的不只是「放一份文件」，还有「改了算数」。GitLab 的颜色真源是远端仓库的标签，工作区里那份文件没有读者，改了不算数。所以登记为**明确不支持**，由注册表补桩回诚实的 `unsupported`。要读颜色用 `listLabels`，要改颜色用 `setLabelColors`。**不要借这一条的名字把一份没读者的文件放回来**——那要么是一件新能力（得先回答「这份文件的读者是谁」），要么就是误导人。

## 二、房间里的两个唯一出口

改这一房之前先认准这两处，别在别的地方另开一个：

- **日志**：`read-log.ts`。读路径每一条「没读成」的分支都要在失败之前调 `emitReadDegraded`，探环境与识别档位另有 `emitPreflightGatePass` / `emitRepoTier`。**事件名沿用全仓已登记的那三个**（`read.degraded`、`preflight.gate`、`repo.resolve.tier`），本房没有自己的 `glab.*` 事件名；`reason` 只能取 `READ_DEGRADED_REASONS` 里登记过的值，要加先改那个文件与附录对照表。房间里其余地方不许直接用 `ctx.logEvent`。
- **错误判档**：`errors.ts` 的 `classifyGlabError` / `failGlab`。失败类别只在这里判一次，别的地方按结果写话，不自己写正则判第二遍。

## 三、文件一览

| 文件 | 管什么 |
|---|---|
| `index.ts` | 工厂：把各文件的操作拼成 `Tracker` 成员，并把能力登记表挂上去 |
| `capability-register.ts` | 25 条能力的数据化回答（纯数据，不许有分支） |
| `client.ts` | 唯一跑 `glab` 的地方 |
| `queries.ts` | 拼 API 地址与查询参数 |
| `normalize.ts` | 把 GitLab 的形状转成契约的 `Issue` |
| `errors.ts` | 错误判档的唯一出口 |
| `preflight.ts` | 探本机环境（glab 装没装、登没登） |
| `repo.ts` | `getRepoKey`：解析仓库身份 |
| `issues.ts` | 列票、取单张、建票、关票、重开、改票 |
| `create-write.ts` | 建票收敛成单条写路径 |
| `idempotency.ts` | 建票的幂等锚 |
| `comments.ts` | 写评论 |
| `labels.ts` | 给票改标签 |
| `labels-ops.ts` | 仓库标签的列全与批量改色（`listLabels` / `setLabelColors`） |
| `graph.ts` | 关系操作的入口转发 |
| `graph-blocking.ts` | 阻塞语义、原生探测与正文行回落、环检 |
| `graph-membership.ts` | 亲缘挂载与指派 |
| `counts.ts` | 计数 |
| `pages.ts` | 分页读票 |
| `identity-ops.ts` | 当前登录人、仓库写权限 |
| `init-project.ts` | 开仓发布 |
| `sub-issues.ts` | 取一张地图的子票 |
| `read-log.ts` | 读路径的日志出口 |

## 四、改这一房之前先跑什么

- 类型检查：`node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json`（零输出才算过；本仓的 `npx tsc` 是占位壳，别用）。
- 契约测试：`node --import ./scripts/ts-hook.mjs tests/verify-tracker-contract.js`。**它末尾有 4 条 `violating-stub` 的 FAIL 是故意的**——那是「违规桩必须被逮住」的反证，判据是最后一行打出 `CONTRACT SKELETON OK`。看到那 4 条 FAIL 就去数总数，不要以为自己改坏了。
- 能力登记三处对齐：`node --import ./scripts/ts-hook.mjs tests/verify-capability-register.ts`。

改了一条能力之后，要同步的三处：本房实现 → `capability-register.ts` → `docs/tracker/capability-gitlab.md`。顺序就是这个顺序，最后一步忘了会红在那个门禁上。
