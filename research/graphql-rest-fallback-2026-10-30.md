# GraphQL 到 REST 的降级机制调查：GraphQL 为什么看起来不正常，REST 又为什么不能当成可信副本

- 调查日期：2026-10-30
- 现场：FeatherHunter/dsh-mattpocock-skills-deck，DSH 桌面版，插件 1.9.0-beta.32，gh 2.97.0（`D:\0Tools\GitHubCLI\gh.exe`），Node v24.19.0
- 触发提问：「调查下降级机制。我们 graphql 都不正常了，为什么要相信 rest？」

## 零、先说结论

1. **今天的「GraphQL 不正常」不是 GraphQL 查询层的故障，也不是配额耗尽。** 日志里 33 次降级中 31 次的原因是 `graphql-error`，但真实形态全部是 `kind=network`、`exitCode=1`、耗时集中在 3.1–3.3 秒的传输层断流；同一时间 GitHub 服务端 GraphQL 配额还有 3850–4268 点没用（`gh api rate_limit` 现场读数），本机直接重放同一条查询也正常返回（6 次全部成功，1.2–1.9 秒）。
2. **一次从传输层冒出来的抖动，会被放大成一整趟降级。** 列表读取用 GraphQL 逐页翻，任何一页失败（包括拉取请求那一路的页）都会让已经成功翻到的所有页作废，整份数据改走 REST 重新取。今天 22 次列表降级一共丢掉了 73 个已经成功取回的页，最多的一次丢了 10 页。
3. **REST 不是「另一份可信的数据」，而是「另一条通道 + 另一个数据窗口」。** REST 和 GraphQL 走的是同一台机器的同一个网络出口，同样的断流窗口里 REST 也会失败（今天 22 次列表降级中有 11 次 REST 请求也失败，1 次整趟最终报错）；同时 REST 备路按创建时间倒序、最多 10 页 ×100 条，主路按更新时间倒序、工单最多 500 条，两者返回的是不同的票子集（下面第五节有实测对比）。
4. **「相信 REST」的历史理由只覆盖「GraphQL 这一层出问题」这一种失败。** 2026-09-02 的规格（#424）假设的是「GraphQL 网络中断/配额/形状异常都自动走 REST，产出与 GraphQL 同构、不截断」；但代码只做到了「换通道」，没有做到「同构、不截断」，而且今天的故障恰好是「两边共享的传输层」，正好是这条假设管不到的那一类。

## 一、现场第一组证据：直连 GraphQL 正常，插件内却降级了

2026-10-30 14:47 前后，在同一台机器、同一个 gh 上：

| 检查项 | 结果 |
| --- | --- |
| `gh auth status` | 已登录 github.com，账号 FeatherHunter，token 正常 |
| `gh api rate_limit` | core 剩余 4833 / 已用 167；GraphQL 剩余 4268 / 已用 732；search 剩余 30 |
| 直连 GraphQL：`issues(first:1){totalCount}` | 成功，1596 条 |
| 直连 GraphQL：`issues(states:OPEN){totalCount}` | 成功，20 条 |
| 直连 REST：`repos/...` | 成功，`open_issues_count: 21` |
| 原样重放插件用的列表查询第 1 页（6 次） | 1894 / 1229 / 1482 / 1493 / 1902 / 1332 毫秒，全部成功，回包 220,716 字符，GraphQL 记 2 点 |

但同一分钟内通过插件工具发起的两次列表查询，都走了 REST 降级：

- 第一次（`opId 1793342857983-3d`）：0 行，回执照旧给「工单 500 条 / 拉取请求 1000 条上限」的提醒，没有 fallback 字段。
- 第二次（`opId 1793342939908-3f`）：0 行，回执里出现 `fallback: "rest"`、`fallbackReason: "other"`，正文说「后端主路这次用不了，走的是 REST 降级通道（原因 other）」。

（这两次查询的内容碰巧都真的是 0 行，所以降级没有改变结果；但这说明：当主路不可用时，工具会把 REST 取回的数据当正常结果交出去，只在正文里留一句「可能不全」。）

## 二、现场第二组证据：一次完整的降级链路

`opId 1793342939908-3f` 这一趟在日志里的完整形状（时间 2026-10-30 14:49 前后）：

1. 前 10 条 `gh.exec` 全是 `via: list.gql`、`kind: ok`，每页 2021–2782 毫秒 —— 工单已经成功翻到 500 条上限。
2. 接着翻拉取请求那一路（`via: list.pr`），第 1 页 `kind: network`、`exitCode: 1`、耗时 3189 毫秒，输出只有 `unexpected EOF`。
3. 插件立刻记 `read.degraded{op: "list", reason: "list:gql-err", latencyMs: 26403}`、`graphql.fallback`、`issues.fallback{from: graphql, to: rest}`。
4. 于是整趟改走 REST：10 页 `/issues?state=all&per_page=100`（每页 1551–3135 毫秒，全部成功）+ 1 次 `/pulls` + 约 56 条 `api:repos/.../issues/N`（补子票边）。
5. 收尾：`quota.op{requests: 67, points: 11, latencyMs: 54549, remaining: 111, tier: red}`、`tool.receipt{status: "ok", requests: 2, points: 5, note: "slow,expensive"}`。

对比同一批数据的正常代价：主路一次列表读取中位约 12 条请求、22.4 秒；这趟降级用了 67 条请求、54.5 秒。**代价不是钱（点数差不多），而是 5 倍多的请求量和 2 倍多的时间，外加已成功取回的 10 页数据被整份丢掉。**

## 三、当天日志统计：降级主要是传输层断流造成的

日志文件：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-30.log`（当天 24 MB，约 12.4 万条事件；同一个文件在 pnpm 缓存目录下还有一条硬链接路径，不是第二份日志）。

### 3.1 降级次数与原因

| 项目 | 数量 |
| --- | --- |
| `issues.fallback` 总数 | 33 |
| 其中列表降级 | 22 |
| 其中单票降级 | 11 |
| 原因 `graphql-error` | 31 |
| 原因 `timeout` | 2 |
| 原因 `rate-limit` / `ghe-host` | 0 |

触发主路失败的调用点：`list.gql` 16 次、`get.gql` 11 次、`list.pr` 5 次、`list.gql` 的环境失败 1 次。

### 3.2 失败的耗时分布（当天 138 条 `kind=network`）

| 耗时区间 | 条数 |
| --- | --- |
| 约 3.1–3.3 秒 | 90 |
| 约 5.1–5.3 秒 | 25 |
| 约 10.1–10.2 秒 | 2 |
| 1 秒以内 | 21 |

失败在时间上成簇：当天 28 簇，最大的一簇 44 条。这更像是「网络出口在抖动窗口里批量掐连接」，而不是某一条查询本身有问题。

### 3.3 REST 自己也不可靠

| 通道 | 成功 | 网络失败 |
| --- | --- | --- |
| `list.rest` | 127 | 11 |
| `pulls.rest` | 19 | 2 |
| `get.rest` | 7 | 4 |

22 次列表降级里有 11 次，同一趟里的 REST 请求也失败了；其中 `op=1793290434181-1ps` 因为 REST 第一页就失败，整趟最终报错（`quota.op ok=false`）。

### 3.4 降级丢掉了多少已经成功取回的数据

| 丢页数 | 次数 |
| --- | --- |
| 0 页 | 10 |
| 1 页 | 3 |
| 2 页 | 1 |
| 5 页 | 1 |
| 6 页 | 1 |
| 7 页 | 1 |
| 10 页 | 5 |

当天合计丢掉 73 个成功页，8 次丢掉 5 页以上。

### 3.5 逐日对比

| 日期 | 降级总数 | 列表降级 | 降级前丢页 | 降级后 REST 也失败的 op 数 |
| --- | --- | --- | --- | --- |
| 10-26 | 436 | 182 | 159 | 90 |
| 10-27 | 243 | 157 | 239 | 65 |
| 10-28 | 27 | 21 | 62 | 5 |
| 10-29 | 42 | 32 | 9 | 32 |
| 10-30（截至 15:05） | 33 | 22 | 73 | 11 |

10-25 的日志里也有 31 次降级；那天的逐 op 归因脚本没匹配上，只作参考。可以看到：网络状态好的日子降级只有二十几次，状态差的日子能到四百多次 —— 这正是「降级触发频率取决于本机网络，而不是取决于 GraphQL 服务健康度」的直接证据。

## 四、机制：代码到底怎么判、怎么降、怎么把原因吃掉

### 4.1 列表读取（`src/tracker/rooms/github/issues.ts` 的 `listIssues`，182–321 行）

- 工单主路：`LIST_QUERY` 按每页 50 条、`UPDATED_AT` 倒序翻页，最多翻到 500 条（`:233` 的 `if (all.length >= 500) { issuesTruncated = true; break }`）。
- 拉取请求主路：`LIST_PR_QUERY` 同样每页 50 条，最多 1000 条（`:259`）。
- 任何一页失败（网络失败、JSON 解析失败、返回里带 `errors`、缺 `data.repository` 或 `issues.nodes`）都会置 `needRest = true`；**拉取请求那一路失败时，`needRestWhy` 停在默认值 `list:gql-err`，所以日志里看到的原因会误导成 GraphQL 工单查询出错。**
- 一旦 `needRest`：已经取到的工单页全部作废，改走 `fetchAllIssuesREST`（10 页 ×100 条，按创建时间倒序）+ `fetchAllPullsREST`（10 页 ×100 条）+ `enrichRestPRs` + `repairParentLinksREST`（对每张地图票调一次 `sub_issues` 补子票边），最后返回 `{ ok: true, fallback: "rest", fallbackReason, truncated: true }`。
- REST 首页失败 = 整趟失败（如实报错）；REST 尾页失败 = 按已取到的数据返回成功（`list:page-fail`）。
- 外层 catch 只记 `list:transport` 并失败，不再降级。

### 4.2 单票读取（`issues.ts` 的 `getIssue`，326–457 行）

- 先走 `GET_QUERY`（含评论第一页 50 条、父票、阻塞边）；`errors` 里如果命中 `rate limit|forbidden|unexpected|network|eof` 就走 REST，否则直接失败。
- REST 先读 `/issues/{n}`，再读 `/pulls/{n}`；两条都不中时如实返回错误。

### 4.3 降级原因为什么会被折叠成「other」

`src/tracker/rooms/github/fallback-reason.ts` 的 `pickFallbackReason` 只区分四种标签：`timeout` / `rate-limit` / `ghe-host` / `graphql-error`，四档只用于记日志，不参与「要不要降级」。

到了工具这一层（`src/deck/tools/issue-list.ts` 的 notes 生成，323–386 行），原因又被折叠成两种：只有 `rate-limit` 会变成 `quota`，其余全部变成 `other`。今天的 31 次 `graphql-error` 因此全部显示为 `other` —— 用户和 AI 都看不出「这次是网络断流、那次是查询形状不对」。

### 4.4 面板横幅的措辞已经有约束（#734）

`src/client/views/shared/truthLines.ts` 的 `restFallbackView`（`:262` 起）明确规定：只有原因为 `quota` 才许说「配额已耗尽」，其余原因说中性话（「这次取数走了 REST 通道」），一个字不许提配额。这条规矩是 2026-10-24 #734 定下的，起因是横幅曾把所有 GraphQL 失败都说成「配额已耗尽」，而当时服务端配额还剩 4983/5000。

## 五、REST 能信到什么程度：实测对比

### 5.1 同一个仓库，两条通道返回的是不同的票子集

- 当前仓库共 1596 条 issue（GraphQL `issues` 连接总数）。
- 主路一次最多返回 500 条，按「更新时间倒序」：取前 10 页 ×50 条，得到 500 张票号。
- REST 备路一次最多返回 1000 行，按「创建时间倒序」：取前 10 页 ×100 条，其中 946 行是票、54 行是拉取请求。
- 对比结果：
  - 主路那 500 张里，有 2 张（#427、#578）不在 REST 前 1000 行里 —— 降级后这两张会从列表里消失。
  - REST 那 946 张里，有 448 张不在主路前 500 里 —— 降级后会突然出现一批旧票。
  - 两条通道的排序键也不同（更新时间 / 创建时间），面板上的顺序会整体变化。

**结论：REST 降级拿到的不是「GraphQL 那份数据」，而是「另一份被不同上限截过的数据」。** 它可能更多（946 > 500），也可能漏掉最近的票，且顺序不同。

### 5.2 原始承诺与实现已经漂移

- #424（2026-09-02 的降级规格）写的验收承诺是：「REST 产出与 GraphQL 同构：数量完整、不截断、树边完整、过滤语义一致」。
- 实现是：工单 500 条封顶、REST 1000 条封顶、排序不同、REST 还要额外补子票边。`truncated` 永远返回 `true`，工具回执会提醒「可能不全」，但数据本身已经按成功交出去了。
- 回归门禁 `tests/verify-github-rest-fallback.js` 的夹具只有 150 条（GraphQL 恒 `unexpected EOF`、REST 恒成功），**从来没有覆盖过 500/1000 上限、排序差异、以及「REST 也失败」这三种情况**，所以规格与实现的漂移一直没被门禁发现。

### 5.3 对传输层故障没有免疫力

REST 与 GraphQL 共享同一条本机网络出口（见第六节），所以：

- 断流窗口里两者一起失败（今天 11/22 次降级里 REST 也失败）。
- REST 首页失败时没有重试，直接整趟失败。
- REST 的页其实不小：`/issues?per_page=100` 一页 798,090 字符，比 GraphQL 的 50 条工单一页（220,716 字符）大 3.6 倍，同样可能踩到掐断线。

## 六、「约 3.2 秒被掐断」是从哪来的

已排除的两条：

- **不是插件自己的超时。** 中央配置里读档 30 秒、REST 读 45 秒（`config/timeouts.yaml`），而失败发生在 3.2 秒。
- **不是 GitHub 官方超时。** 官方文档说单次请求超过 10 秒服务端才返回 502/504，而日志里的失败集中在 3.1–3.3 秒，且 gh 进程是以 `exitCode=1` 退出的（gh 自己报 `unexpected EOF`），不是 HTTP 状态码。

现场环境里有三条线索都指向本机代理：

1. `HTTP_PROXY` / `HTTPS_PROXY` 都是 `http://127.0.0.1:7890`（本机代理软件），所有 gh 出站都经过它。
2. `Resolve-DnsName api.github.com` 返回 `198.18.0.141`，这是代理软件常用的假 IP 段。
3. 同一条 PR 列表查询（`first=100`，307,486 字符）从 shell 直接重放：第 1 次 3050 毫秒失败、输出 `unexpected EOF`，紧接着 6 次全部成功（2194–2799 毫秒）。另外工单 `first=100`（465,301 字符）3 次全成功，REST 798,090 字符 6 次全成功 —— 大响应本身不会必然失败，失败是间歇性的。

**假设：本机代理（或它上游的代理节点）在抖动时会主动掐掉正在传输的连接，表现为约 3 秒后 EOF。** 这一条还没做对照实验（见第八节遗留问题），但已足够说明：这不是插件改查询能根治的问题。

## 七、建议（按性价比排序）

1. **页级重试一次再降级。** 列表主路某页失败时，先对同一页重试一次（间隔几百毫秒），还失败才降级。证据：本机复现里 3 秒断流后隔几秒重放 5/6 次成功；`listSubIssues` 已经因为同样的 `unexpected EOF` 采用「每页失败先重试一次」的先例（`research/1052-capability-read-path.md:142`）。
2. **拉取请求那一路别连坐工单数据。** 拉取请求页失败时，工单那 500 条已经取到的不该被整份丢掉；可以让 PR 部分单独标记缺失，或把 PR 列表拆成独立的一次读取。
3. **给 PR 列表的 GraphQL 片段减重。** 当前 PR 页含 `comments(20)` + `reviews(20)`（`src/tracker/rooms/github/queries.ts` 的 PR 片段），一页 273,822 字符，比工单页大；列表页并不展示这些，去掉后能明显压低单页耗时和踩线概率。
4. **回执说人话。** 把 `fallbackReason` 从 `quota/other` 细分成 `quota` / `transport`（网络断流）/ `timeout` / `graphql-error`，并在回执里写明降级数据窗口的差异（按创建时间、最多 1000 行、可能缺少最近更新的票），而不是只留一句「可能不全」。
5. **验证代理假设。** 找一段稳定网络（或换一个代理出口）跑同一批重放实验，比较 3 秒断流是否消失；如果确认是代理，写进排障文档，别当插件 bug 修。
6. **补门禁。** `tests/verify-github-rest-fallback.js` 的夹具补三类用例：超过 500/1000 条时的截断行为、主路与 REST 的排序差异、REST 页失败时的降级行为。

## 八、遗留问题

1. **`quota.op` 里的 `remaining` 从 1739 一路降到 0、tier 变红，但服务端 GraphQL 配额还有 3850。** 这个 `remaining` 看起来是插件自己的刷新预算账本，不是服务端读数；它见底后会自动刷新全停（`src/refresh/kernel/admission-policy.ts:289`），需要单独查清它到底是哪个桶、按什么周期重置。这可能也是用户感觉「GraphQL 不正常」的另一条线索。
2. **约 3.2 秒断流的归属还未做对照实验。** 需要绕过或更换代理后重复重放，才能把「代理问题」与「插件问题」彻底分开。
3. **日志轮转失败。** 当天 15:05 出现 `log.rotate.degraded{reason: "no-rename"}`，日志长到 24 MB 没被切开；原因疑似与 pnpm 缓存目录下那条硬链接路径有关，未查。
4. **插件内单页比 shell 慢 0.5–1 秒的原因未定位**（进程启动、并发排队、管道开销都有可能）。
5. **没有统计「第一页就失败、丢掉 0 页」在全部降级里的占比**，今天的直方图显示 10 次是 0 页，说明有一部分降级只损失了时间。

## 九、复现与取证方法

- 日志路径：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\<日期>.log`（每行一个 JSON 对象）。
- 筛降级事件：`Select-String -LiteralPath <日志> -Pattern '"event":"issues.fallback"'`；`graphql.fallback`、`fallback.chain`、`read.degraded` 是同一趟的伴生事件，用 `opId` 串起来。
- 看一次完整链路：按 `opId` 把 `gh.exec`、`read.degraded`、`issues.fallback`、`quota.op`、`tool.receipt` 排成时间序（本次调查用的临时脚本在 `C:\Users\辰辰洋洋\AppData\Local\Temp\analyze3.mjs` / `analyze4.mjs`，不进仓）。
- 直连对照：`gh api graphql -f query=<LIST_QUERY> -F first=50 -F owner=FeatherHunter -F name=dsh-mattpocock-skills-deck`，计时并检查输出是否以 `unexpected EOF` 结尾。
- 窗口对比：分别抓「主路前 10 页 ×50（更新时间序）」与「REST 前 10 页 ×100（创建时间序）」的票号集合，求差集。
