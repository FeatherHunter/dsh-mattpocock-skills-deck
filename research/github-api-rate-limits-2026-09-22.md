# 研究：GitHub API 的配额规则，以及 gh CLI 撞到限流时的表现

这份底稿只为查清一件事：GitHub 的 GraphQL 与 REST 各自的配额怎么算、超限后返回什么，以及 `gh` 命令行工具撞限流时打印什么、会不会重试、会不会缓存。

结论来源分两类，文中逐条标注：一类是官方文档（直接读 docs.github.com 页面在 github/docs 仓库里的正文源文件），一类是社区记录（cli/cli、github/docs 两个仓库里的 issue 追踪，以及 gh 的源码）。没有看本地代码，没有改任何代码。

## 一、GraphQL 的点数上限与点数计算

来源：官方文档「Rate limits and query limits for the GraphQL API」
<https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api>
（正文源文件 <https://raw.githubusercontent.com/github/docs/main/content/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api.md>）

每小时点数上限（原文摘录）：

- 用户：`For users: 5,000 points per hour per user. This includes requests made with a personal access token as well as requests made by a GitHub App or OAuth app on behalf of a user that authorized the app.`
- 代表用户发请求、但 App 属于 GitHub Enterprise Cloud 组织：`Requests made on a user's behalf by a GitHub App that is owned by a GitHub Enterprise Cloud organization have a higher rate limit of 10,000 points per hour.`
- GitHub App 安装（不在 GHEC 组织上）：`5,000 points per hour per installation. Installations that have more than 20 repositories receive another 50 points per hour for each repository. Installations that are on an organization that have more than 20 users receive another 50 points per hour for each user. The rate limit cannot increase beyond 12,500 points per hour.`
- GitHub App 安装在 GHEC 组织或企业上：`10,000 points per hour per installation.`
- OAuth App 用 client ID/secret 取公开数据：`5,000 points per hour, or 10,000 points per hour if the app is owned by a GitHub Enterprise Cloud organization.`
- Actions 里的 `GITHUB_TOKEN`：`1,000 points per hour per repository. For requests to resources that belong to an enterprise account on GitHub.com, the limit is 15,000 points per hour per repository.`
- 自托管的企业版（GHES）：`Rate limits are disabled by default for GitHub Enterprise Server. Contact your site administrator to confirm the rate limits for your instance.`
  也就是说「企业版」要分两种：云上的 GHEC 是更高的固定值，自托管的 GHES 默认根本不限流、由管理员自己设。

一次查询花多少分（原文摘录）：

- `1. Add up the number of requests needed to fulfill each unique connection in the call. Assume every request will reach the first or last argument limits.`
- `2. Divide the number by 100 and round the result to the nearest whole number to get the final aggregate point value.`
- `The minimum point value of a call to the GraphQL API is 1.`
- 文档给的例子：100 个仓库 × 50 个 issue × 60 个 label，需要 1 + 100 + 5000 = `5,101` 次请求，`Dividing by 100 and rounding gives us the final score of the query: 51`。

所以计算方式是「先把每个连接的开销加起来（嵌套连接相乘：100×50×60 的第三层算 5000），再拿总数除以 100、四舍五入取整」。不是「每个连接各自除以 100 再向上取整」；文档自己的例子 5,101 ÷ 100 = 51.01 得 51，说明用的是四舍五入，向上取整会得到 52。

节点上限（Node limit，官方原文）：

- `Clients must supply a first or last argument on any connection.`
- `Values of first and last must be within 1-100.`
- `Individual calls cannot request more than 500,000 total nodes.`
- 文档给的第二个例子把嵌套乘起来数节点：50 仓库 + 50×20 拉取请求 + 50×20×10 评论 + 50×20 issue + 50×20×10 评论 + 10 关注者 = `22,060 total nodes`。

另外，单次请求超过 10 秒会被服务端掐断并返回 502/504；官方写明 `If a timeout occurs for any of your API requests, additional points will be deducted from your primary rate limit for the next hour`。

## 二、REST API 与搜索 API 的限额

来源：官方文档「Rate limits for the REST API」
<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
（数字正文来自同仓库 `data/reusables/rest-api/` 下的片段文件，例如 `primary-rate-limit-authenticated-users.md`）

- 未认证：`The primary rate limit for unauthenticated requests is 60 requests per hour.`，按来源 IP 计。
- 认证用户：`All of these requests count towards your personal rate limit of 5,000 requests per hour.` 个人令牌、代表你发请求的 GitHub App、OAuth App 共用这一份预算；GHEC 组织拥有的 App 代表你发是 `a higher rate limit of 15,000 requests per hour`，并且 `requests made by a higher-limit app reduce the remaining budget available for lower-limit authentication methods`。
- GitHub App 安装：最低 `5,000 requests per hour`，装在 GHEC 组织上为 `15,000 requests per hour`；不在 GHEC 时按仓库数和用户数每个再加 50 次，`The rate limit cannot increase beyond 12,500 requests per hour.`
- Actions 里的 `GITHUB_TOKEN`：`1,000 requests per hour per repository`，访问 GHEC 账号资源时 `15,000 requests per hour per repository`。
- 自托管 GHES：`Rate limits are disabled by default for GitHub Enterprise Server.`
- 搜索：`For authenticated requests, you can make up to 30 requests per minute for all search endpoints except for the Search code endpoint. The Search code endpoint requires you to authenticate and limits you to 10 requests per minute. For unauthenticated requests, the rate limit allows you to make up to 10 requests per minute.`
  来源：<https://docs.github.com/en/rest/search/search>。搜索还单独占一只桶：`The REST API for searching items has a custom rate limit that is separate from the rate limit governing the other REST API endpoints.`
- 查配额：官方说响应头才是权威——`The x-ratelimit-* response headers are the authoritative source for your current rate limit status`；调 `GET /rate_limit` 不消耗主配额，但可能计入 secondary limit。见 <https://docs.github.com/en/rest/rate-limit/rate-limit>

## 三、超过限额时返回什么

GraphQL（官方原文，与 REST 很不一样，这是关键一条）：

- `If you exceed your primary rate limit, the response status will still be 200, but you will receive an error message, and the value of the x-ratelimit-remaining header will be 0.`
- 撞到 secondary limit 时：`the response status will be 200 or 403, and you will receive an error message that indicates that you hit a secondary rate limit. If the retry-after response header is present, you should not retry your request until after that many seconds has elapsed.`
- 看配额：响应头 `x-ratelimit-*`（GraphQL 请求的 `x-ratelimit-resource` 恒为 `graphql`），或查询 `rateLimit` 对象的 `limit` / `remaining` / `used` / `resetAt`，或用 `rateLimit { cost }` 看这一次花了几分。

错误体里的类型字段，官方文档没有写（这是文档缺口，不是我的推测）：

- 2021 年 github/docs 的 issue #11071 由贡献者抓包给出：`{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded for installation ID 12345678."}]}`
  <https://github.com/github/docs/issues/11071>（该 issue 被机器人关闭，文档至今没补这一节）
- 2026 年 cli/cli #12812 里另一位报告者贴出的缓存正文是：`{"errors":[{"type":"RATE_LIMIT","code":"graphql_rate_limit","message":"API rate limit already exceeded for user ID …"}]}`
  <https://github.com/cli/cli/issues/12812>
- 两次的字段名并不一致（`RATE_LIMITED` 对 `RATE_LIMIT` + `graphql_rate_limit`），所以不要把它当成稳定的契约来写代码。

REST（官方原文）：

- 主配额：`If you exceed your primary rate limit, you will receive a 403 or 429 response, and the x-ratelimit-remaining header will be 0.` 接着要求 `You should not retry your request until after the time specified by the x-ratelimit-reset header.`
  另一处官方措辞是 `403 Forbidden or 429 Too Many Requests`。关于 `Retry-After`：官方只在 secondary 场景点名这个头（`If the retry-after response header is present...`），主配额场景给的是 `x-ratelimit-reset`。
- secondary：`you will receive a 403 or 429 response and an error message that indicates that you exceeded a secondary rate limit`；没有 retry-after 且 x-ratelimit-remaining 不是 0 时，`wait for at least one minute before retrying`。
- secondary 的具体规则（官方可复用片段原文）：并发 `No more than 100 concurrent requests are allowed. This limit is shared across the REST API and GraphQL API.`；速率 `No more than 900 points per minute are allowed for REST API endpoints, and no more than 2,000 points per minute are allowed for the GraphQL API endpoint.`；CPU `No more than 90 seconds of CPU time per 60 seconds of real time`；写内容 `no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour`；换令牌 `No more than 2,000 OAuth access token requests per hour`。并且官方承认它不透明：`These secondary rate limits are subject to change without notice. You may also encounter a secondary rate limit for undisclosed reasons.`
- 官方警告：`Continuing to make requests while you are rate limited may result in the banning of your integration.`
  以上除特别注明外在 <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api> 与 <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api>。

## 四、gh CLI 撞到限流时的具体表现

退出码（官方手册 <https://cli.github.com/manual/gh_help_exit-codes>）：`0` 成功、`1` `If a command fails for any reason`、`2` 运行中被取消、`4` `If a command requires authentication`。限流属于「失败」，所以退出码是 1；`4` 只对应需要认证的情形。

错误文本（源码 + 追踪）：

- `gh api` 打 REST：源码 `pkg/cmd/api/api.go` 里 `parseErrorResponse` 把响应体的 `message` 拼成 `<message> (HTTP <status>)`，`processResponse` 再打印 `gh: <serverError>` 并以 `cmdutil.SilentError` 返回（退出码 1）。真实输出见 cli/cli #6429：`couldn't fetch workflows for OWNER/REPO: HTTP 403: API rate limit exceeded for user ID 4328569. (https://api.github.com/...)`
  <https://github.com/cli/cli/issues/6429>
- `gh api graphql`：同样的源码里，GraphQL 路径在状态码 200 时也会解析错误体（`if isJSON && (opts.RequestPath == "graphql" || resp.StatusCode >= 400)`），于是 GraphQL 的 200 + errors 也会变成失败退出，文本形如 `gh: API rate limit already exceeded for user ID 477956.`
- 用 GraphQL 的普通子命令（`gh pr create`、`gh issue list` 等）：文本形如 `GraphQL: API rate limit already exceeded for user ID 477956.`
  <https://github.com/cli/cli/issues/12812> 与 <https://github.com/cli/cli/issues/8321>
- 撞 secondary limit：`gh api --paginate` 中途的真实输出是 `gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)`；上传附件时形如 `HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID ...`
  <https://github.com/cli/cli/issues/4443> 与 <https://github.com/cli/cli/issues/9586>。注意官方文档只承诺「会有一条表明撞了 secondary limit 的错误消息」，没有承诺这句话的原文，上面两句是社区实测。

有没有重试：没有。`gh api` 的分页循环（`pkg/cmd/api/api.go` 的 `apiRun`）每页只发一次请求，出错立刻返回；HTTP 客户端的装配链（`api/http_client.go` 的 `NewHTTPClient`）只叠了「加令牌头」「遥测开关」「可选的缓存」几层，没有重试或退避中间件。<https://github.com/cli/cli/issues/4443> 报告的行为（`--paginate` 撞限流后突然终止）与源码一致，该 issue 以「与 #3292 重复」关闭，作者提的自动重试、限速、断点续跑都没有实现。

有没有缓存：有，而且这是最需要注意的一点。

- 官方手册里有 `gh api --cache <duration>` 开关（例 `"3600s"`, `"60m"`, `"1h"`）：<https://cli.github.com/manual/gh_api>。
- go-gh 的响应缓存更关键：`pkg/api/http_client.go` 里 `if opts.EnableCache && opts.CacheTTL == 0 { opts.CacheTTL = time.Hour * 24 }`；`pkg/api/cache.go` 里 `isCacheableRequest` 允许缓存 GET/HEAD 与发往 `/graphql` 或 `/api/graphql` 的 POST，`isCacheableResponse` 是 `res.StatusCode < 500 && res.StatusCode != 403`，缓存键里含 `Authorization` 头（换令牌等于换缓存键）。也就是说，「状态码 200 但带限流错误」的 GraphQL 响应、甚至 401 响应，都满足写入缓存的条件。
  <https://github.com/cli/go-gh/blob/trunk/pkg/api/cache.go>、<https://github.com/cli/go-gh/blob/trunk/pkg/api/http_client.go>

GraphQL 和 REST 是不是各算各的：是，两只独立的桶。官方 `GET /rate_limit` 说明里写明 `resources` 下 `core`（非搜索类 REST）、`search`、`code_search`、`graphql` 各自独立，其中 `The GraphQL API also has a custom rate limit that is separate from and calculated differently than rate limits in the REST API.`（<https://docs.github.com/en/rest/rate-limit/rate-limit>）。`gh` 侧也能直接看到：维护者在 cli/cli #8321 里就是让对方跑 `gh api /rate_limit` 来对比。

有没有暴露配额信息：有。`gh api rate_limit` 就是调官方的 `GET /rate_limit`；`gh api -i`（`--include`）会打印响应头（手册原文 `-i, --include` / `Include HTTP response status line and headers in the output`）；`GH_DEBUG=api` 会打印完整请求与响应头（go-gh `pkg/api/http_client.go`：`LogVerboseHTTP = strings.Contains(ghDebug, "api")`）。官方没有为「gh 怎么查限流」单列一页文档，这一条是手册开关说明加 issue 里的建议拼出来的。

## 五、被限流会不会让 gh CLI「整体失效」

分三层说，第一层是官方契约，第二层是已知缺陷，第三层是三种易混情况的区别。

1. 正常情况：不会整体失效，只影响被打满的那只桶。官方文档把 REST 的 `core` 与 `graphql` 列为相互独立的资源。社区实测也吻合：cli/cli #8321 里报告者的 `gh api /rate_limit` 显示 `"graphql": {"used": 5000, "remaining": 0}` 的同时 `"core": {"used": 242, "remaining": 4758}`，那一刻走 GraphQL 的 `gh repo clone`、`gh pr create` 报错，而 REST 请求照常成功。所以「GraphQL 点数耗尽不影响 REST 配额」成立，走 REST 的命令（含 `gh api`）不受影响；反过来，走 GraphQL 的子命令会成片失败。

2. 有一个尚未修好的反例：缓存会把「一次限流」放大成「大约 24 小时的持续失败」，看起来像整体失效。cli/cli #12812（2026-03 开，至今 open，标签 `bug` / `needs-investigation`）报告的链路是：某次 GraphQL 请求撞上限流 → 这条响应被 go-gh 写进缓存 → 之后每次都回放这条响应、连同它过期的 `X-Ratelimit-Remaining: 0`。原文：`gh caches a SearchType introspection query with X-Gh-Cache-Ttl: 24h. When this query is made during rate limit exhaustion, the cached response carries X-Ratelimit-Remaining: 0 in its headers. After the actual rate limit resets (~1 hour), gh serves this response from cache and reads the stale rate-limit headers, refusing to make new requests.` 2026-07 的后续评论把被缓存的正文贴了出来（含 `graphql_rate_limit`），并说影响可达 27 小时以上，而同一时间 `gh api rate_limit` 与 `gh api graphql` 一直显示额度健康——因为 `gh api` 不走这条缓存。GitHub 方的维护者 niik 回复：`Neither cli/cli or go-gh looks at the rate limiting headers so the error you're seeing is coming from the server side and getting cached.` 以及 `we should probably make sure to never cache the rate limiting error in the first place`——即官方承认是缺陷、方向是「不要把限流错误写进缓存」，但截至那条评论未合并修复。
   社区给的规避手段（非官方文档）：删掉 `~/.cache/gh` 里带 `X-Ratelimit-Remaining: 0` 的条目，或换一个新令牌（缓存键含令牌）；有报告称 `GH_NO_CACHE=1` 在 2.88.1 上不生效。

3. 三种情况的区别（状态码部分有官方文档，具体输出文本来自社区实测）：
   - 配额耗尽（primary）：GraphQL 是状态码 200 加错误体，REST 是 403 或 429 加 `x-ratelimit-remaining: 0`（官方明确）。gh 上的文本分别是 `GraphQL: API rate limit already exceeded for user ID ...` 与 `HTTP 403: API rate limit exceeded for user ID ...`。等到 `x-ratelimit-reset` / `resetAt` 那一刻就恢复，另一只桶全程不受影响。
   - secondary rate limit：状态码 200 或 403，可能带 `retry-after`，官方要求至少等一分钟或按 `retry-after` 等；它是短时的、面向「某段时间的行为」而非「这一小时的额度」，等一会儿就恢复。gh 上的文本是 `... You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)`。
   - 令牌过期或无效：属于认证问题，不是配额问题。官方手册把「需要认证」单列为退出码 4；REST 上一般是 401（`Bad credentials`），未认证访问私有资源时官方故意返回 404（见 troubleshooting 页）。gh 上会表现为 `gh: Bad credentials (HTTP 401)` 一类文本。要警惕的是：401 同样满足 go-gh 的缓存条件，所以也可能被缓存回放成「同一条命令反复失败」（#12812 里 2026-06-10 的复现记录）。
   - 还有一类容易误判的情形：令牌没变，但你这只「用户级」额度被别的应用用光了。官方 REST 文档写明代表你发请求的 GitHub App、OAuth App 与你的个人令牌共用同一份额度；#8321 里就有人最后发现是自己授权过的第三方 App 在大量调用。

一句话归纳：限流本身是按桶、按端点生效的，正常情况下不会让 `gh` 整体失效；但在目前带缓存缺陷的版本上，一次 GraphQL 限流（或一次 401）可能被缓存成约 24 小时的持续失败，而 REST 路径——包括 `gh api rate_limit` 这条查配额的命令——始终正常。
