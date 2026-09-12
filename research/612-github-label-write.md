# 研究 #612：GitHub 改标签颜色的调用面与失败面

调查对象：`gh label edit` 在批量改标签颜色这条路上会怎么成功、怎么失败。
环境：`gh version 2.97.0 (2026-07-31)`；登录账号 `FeatherHunter`（token 前缀 `gho_`）；仓库 `FeatherHunter/dsh-mattpocock-skills-deck`。
所有实测在 2026-09-13 00:18–00:24（+08:00）之间完成。文中每条结论都指到「命令 + 输出」或「文件路径 + 行号」。

## 安全声明：写操作只落在一个一次性标签上

**本仓库 19 个正式标签（`bug`、`wayfinder:map` 等）的颜色自始至终一个都没动。** 写路径实测全部落在临时新建的 `r612-*` 标签上：`r612-color-probe`、`r612:probe`、`r612 case probe`、`R612-CaseProbe`、`r612-batch-01` ~ `r612-batch-12`，共 16 个。

**这 16 个标签已全部删除**，删除开始 `2026-09-13 00:23:53 +08:00`，结束 `2026-09-13 00:24:10 +08:00`，16 个全部 `exit=0`，复查无残留，仓库标签总数从试验中的 35 回到试验前的 19：

```
=== 复查：仓库内是否还有 r612 前缀标签 ===
无残留
标签总数 = 19（改色试验前为 19）
```

除「无写权限」一项用到第三方公开仓库 `cli/cli`（见第 3 节，前置权限检查证明写不进去，事后复查该仓库 `bug` 标签颜色 `d73a4a` 未变），没有碰过任何其它仓库。
本次调查没有运行任何 git 命令，没有改任何生产代码，除本文件外没有新建仓库内文件。

## 0. 一句话结论

`gh label edit --color` 本身极其薄：**它只把颜色原样塞进 `PATCH /repos/{owner}/{repo}/labels/{name}` 的请求体，不做任何格式校验**——带 `#` 由 gh 自己剥掉，但大小写、3 位简写、非法值全都交给 GitHub 的 API 去判。所以面板的「用户填错了」提示不能靠 gh 本地拦，只能认 API 的两个 HTTP 422 错误行。
批量推荐**串行为默认、最多 4 路并发**，并且**必须逐条记录结果**：批量中途失败没有回滚，实测会稳定留下「前几个改了、后几个没改」的半成品状态。
最后一条最要紧的坑：**「标签不存在」和「你没有写权限」返回的是同一句 `HTTP 404: Not Found`**，靠 `gh label edit` 的错误文本分不开，只能另发一次 `gh repo view --json viewerPermission` 才能分辨。

## 1. 基本行为

### 1.1 gh 到底做了什么、API 又做了什么

用 `GH_DEBUG=api` 抓下的真实请求（输入 `--color "#ABC"`）：

```
> PATCH /repos/FeatherHunter/dsh-mattpocock-skills-deck/labels/r612-color-probe HTTP/1.1
> User-Agent: GitHub CLI 2.97.0
> X-Github-Api-Version: 2022-11-28

{
  "color": "ABC"
}

< HTTP/2.0 200 OK
...
{
  "name": "r612-color-probe",
  "color": "AABBCC",
  ...
}
```

结论有三条，都能从这段看出来：

1. **gh 只剥 `#`，不做别的处理。** 输入是 `#ABC`，请求体里是 `ABC`——`#` 是 gh 剥的。
2. **gh 不做长度/格式校验。** 它把 `ABC` 这种 3 位简写直接发给 API，是 GitHub 把 `ABC` 展开成了 `AABBCC`。所以校验发生在服务端。
3. **大小写原样保留。** 输入 `0A0B0C`，读回来还是 `0A0B0C`；输入 `abc`，读回来 `aabbcc`；输入 `ABC`，读回来 `AABBCC`。**gh 和 GitHub 都不会把颜色归一成小写。**

### 1.2 实测的取值接受表

每条都「先 `gh label edit`，再 `gh label list` 读回真实值」：

| 传给 `--color` 的值 | 退出码 | 存进去的值 |
| --- | --- | --- |
| `0A0B0C`（6 位大写） | 0 | `0A0B0C` |
| `#0a0b0c`（带 `#`） | 0 | `0a0b0c` |
| `abc`（3 位小写） | 0 | `aabbcc` |
| `ABC`（3 位大写） | 0 | `AABBCC` |
| `12345`（5 位） | 1 | 未变（保持上一次的值） |
| `1234567`（7 位） | 1 | 未变 |
| `gg0000`（非十六进制） | 1 | 未变 |
| `12345g`（尾部非十六进制） | 1 | 未变 |
| `blue`（颜色名） | 1 | 未变 |

`1234567` 的报错原文（stderr，两行，退出码 1）：

```
HTTP 422: Validation Failed (https://api.github.com/repos/FeatherHunter/dsh-mattpocock-skills-deck/labels/r612-color-probe)
Label.color is invalid
```

`gg0000`、`12345`、`blue`、`12345g` 的报错文本与上二字不差，都是这两行。API 层的结构化错误体是：

```
{
  "message": "Validation Failed",
  "errors": [
    {
      "resource": "Label",
      "code": "invalid",
      "field": "color"
    }
  ],
  "documentation_url": "https://docs.github.com/rest/issues/labels#update-a-label",
  "status": "422"
}
```

**成功时 stdout 和 stderr 都是空的，退出码 0。** 宿主不能靠 stdout 有没有内容判断成功，只能看退出码。

### 1.3 标签名字里的冒号、空格、大小写

三种都用最朴素的写法传进去，**一个都不用转义**（宿主是直接 spawn 进程传 argv、不过 shell，所以也不存在 shell 转义问题）：

| 标签名 | 命令 | 退出码 |
| --- | --- | --- |
| `r612:probe`（含冒号） | `gh label edit r612:probe --repo ... --color 00ff00` | 0 |
| `r612 case probe`（含空格） | `gh label edit "r612 case probe" --repo ... --color 00ff00` | 0 |
| `R612-CaseProbe`（实际存的写法） | `gh label edit r612-caseprobe --repo ... --color 0000ff` | 0 |

第三条是重点：**用全小写的 `r612-caseprobe` 去 edit，真的改到了存成 `R612-CaseProbe` 的那个标签**，读回：

```
R612-CaseProbe = 0000ff
```

也就是说名字匹配是**大小写不敏感**的，而且 edit 只改颜色、不会顺手把显示名改成你传进去的那种大小写。
反过来的情况——新建一个只差大小写的同名标签——会被 gh 自己挡下（退出码 1，本地报错，没发请求）：

```
label with name "R612-COLOR-PROBE" already exists; use `--force` to update its color and description
```

（`--force` 是 `gh label create` 的参数，不是 `gh label edit` 的。）

### 1.4 标签不存在、什么都不传

标签不存在（退出码 1，stderr 一行）：

```
HTTP 404: Not Found (https://api.github.com/repos/FeatherHunter/dsh-mattpocock-skills-deck/labels/r612-does-not-exist)
```

仓库不存在时是**同一个形状**（把 `r612-no-such-repo-xyz` 当仓库名）：

```
HTTP 404: Not Found (https://api.github.com/repos/FeatherHunter/r612-no-such-repo-xyz/labels/probe)
```

一个 flag 都不带（`gh label edit r612-color-probe --repo ...`），或者 `--color=` 传空串，都是 gh 的本地校验，退出码 1：

```
specify at least one of `--color`, `--description`, or `--name`

Usage:  gh label edit <name> [flags]

Flags:
  -c, --color string         Color of the label
  -d, --description string   Description of the label
  -n, --name string          New name of the label
```

## 2. 批量：逐条、并发、部分成功

实测对象是 12 个临时标签 `r612-batch-01` ~ `r612-batch-12`。

### 2.1 逐条串行

12 条命令，总耗时 **14.1 秒**；单次最小 / 中位 / 最大 = **854 / 907 / 3558 ms**。

```
--- 顺序改色（逐条，12 次）---
总耗时 14.1 秒；单次最小/中位/最大 = 854 / 907 / 3558 ms
```

单次约 0.9 秒，**其中绝大部分是 gh 进程自己启动 + TLS 握手**，不是 GitHub 处理慢。所以「N 个标签 ≈ N × 1 秒」这个量级对十几个标签是成立的。

### 2.2 同时并发

12 条进程同时启动，墙钟 **2.16 秒**，12 条全部退出码 0、stderr 全空，事后读回 12 个标签全是目标色 `abcdef`：

```
并发墙钟总耗时 2.16 秒（12 条同时发出）
非零退出数 = 0
...
共 12 个；值为 abcdef 的 12 个
```

比串行快约 **6.5 倍**。

（说明一处口径：PowerShell 5.1 里 `Start-Process -PassThru` 拿回的对象读 `.ExitCode` 是空的，所以那轮「退出码」栏没打印出来；成功与否是用事后读回的 12 个标签颜色 + 12 个 stderr 文件全空证实的，不是靠退出码。）

### 2.3 部分成功：真的会留半成品

这一条是批量路上最需要防的。模拟一次「遇到第一个错就中断」的循环，目标是 5 个名字，第 3 个是不存在的标签：

```
第 1 步：edit r612-batch-01 -> EXIT=0
第 2 步：edit r612-batch-02 -> EXIT=0
第 3 步：edit r612-does-not-exist -> EXIT=1 ERR=HTTP 404: Not Found (https://api.github.com/repos/FeatherHunter/dsh-mattpocock-skills-deck/labels/r612-does-not-exist)
  → 循环在此中断（后面 2 个标签未处理）
=== 回读实际状态 ===
r612-batch-01 = 222222
r612-batch-02 = 222222
r612-does-not-exist = <不存在>
r612-batch-03 = 111111
r612-batch-04 = 111111
```

**改进去的两个真的改了，没轮到的两个还是老颜色，没有任何回滚。** GitHub 没有「一次改 N 个标签颜色」的批量端点，逐条 PATCH 之间不构成事务，所以「改到一半失败」必然留下半成品。
宿主侧现有代码就是这种「遇到 `!r.ok` 立刻 return」的写法（`src/host/tracker/backends/github/labels.js:92-99`），照搬到改色上会得到同样的半成品。

### 2.4 一个 REST 之外的选项（查证存在，未实测）

GraphQL 有 `updateLabel` mutation，`UpdateLabelInput` 的输入字段是：

```
UpdateLabelInput 输入字段：clientMutationId, id, color, description, name
```

（同一张 Mutation 表里还有 `createLabel`、`deleteLabel`、`addLabelsToLabelable`、`removeLabelsFromLabelable`；与 Label 相关的 Mutation 都能通过 `gh api graphql` 调。）
理论上可以用 GraphQL 别名把 N 个 `updateLabel` 塞进一次 HTTP 请求。**这条路我只有 schema 查证、没有实测**（要实测就得真的批量改色，且它要求拿 label 的 node id，而面板现在只有 name）。如果要用，得先另行验证别名的批量语义与失败粒度。

## 3. 权限与登录：三种情况的实际报错

### 3.1 完全没登录

把 `GH_CONFIG_DIR` 指到一个空目录、清空 `GH_TOKEN`/`GITHUB_TOKEN` 后：

```
gh auth status            → EXIT=1
You are not logged into any GitHub hosts. To log in, run: gh auth login

gh label edit ...         → EXIT=4
To get started with GitHub CLI, please run:  gh auth login
Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.
```

**注意 `gh label edit` 的退出码是 4，不是 1。** 这是 gh 自己的约定（`gh help exit-codes`，原文）：

```
- If a command completes successfully, the exit code will be 0

- If a command fails for any reason, the exit code will be 1

- If a command is running but gets cancelled, the exit code will be 2

- If a command requires authentication, the exit code will be 4
```

### 3.2 token 无效 / 过期

```
gh label edit ...  → EXIT=1
HTTP 401: Bad credentials (https://api.github.com/repos/FeatherHunter/dsh-mattpocock-skills-deck/labels/r612-color-probe)
Try authenticating with:  gh auth login -h github.com
```

### 3.3 有登录、但没有仓库写权限

这一条我做了一个**带前置权限检查的写尝试**，目标是第三方公开仓库 `cli/cli`（不是本仓库、更不是随便挑的）。前置检查证明写路径不可能生效，才发请求：

```
仓库 cli/cli  permissions: admin=False maintain=False push=False triage=False pull=True
尝试前 bug 标签颜色 = d73a4a
权限前置检查通过（无 push/admin），执行写尝试：
EXIT=1
STDERR: HTTP 404: Not Found (https://api.github.com/repos/cli/cli/labels/bug)
尝试后 bug 标签颜色 = d73a4a  （未改变 = True）
```

**没有写权限时返回的是 `HTTP 404: Not Found`，和「标签不存在」（第 1.4 节）一字不差。** GitHub 对无写权限的写操作不返回 403，而是用 404 把资源「藏」起来。这是整个调研里对界面影响最大的一条：**光看 `gh label edit` 的错误，分不出「你填错了标签名」和「你没有权限」。**

要分开这两件事，得另外问一句 gh：

```
gh repo view FeatherHunter/dsh-mattpocock-skills-deck --json viewerPermission,nameWithOwner
{"nameWithOwner":"FeatherHunter/dsh-mattpocock-skills-deck","viewerPermission":"ADMIN"}

gh repo view cli/cli --json viewerPermission,nameWithOwner
{"nameWithOwner":"cli/cli","viewerPermission":"READ"}
```

`viewerPermission` 是 `READ` 就只能读，`WRITE` / `MAINTAIN` / `ADMIN` 才能改标签。

### 3.4 没能实测的一种

**「有仓库写权限、但 token 本身只有读权限」（例如 fine-grained token 只勾了 Issues: read）没有实测**——我手上没有第二个令牌，也不会去动当前账号的登录状态。按 API 文档这类请求返回 403（`Resource not accessible by integration` 一类文案），但**报错原文我没拿到，报告里不编**。

## 4. 限速

### 4.1 主限速离得很远

响应头实测 `X-Ratelimit-Limit: 5000`、`X-Ratelimit-Resource: core`，`gh api rate_limit` 读到的也是 `limit: 5000 / remaining: 4787~4849`。**改十几个标签消耗十几点，相对 5000/小时是零头。** 主限速不是这条路的现实风险。

### 4.2 次限速（secondary rate limit）才是要注意的

官方文档（`https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api`）原文：

> If you exceed your primary rate limit, you will receive a `403` or `429` response, and the `x-ratelimit-remaining` header will be `0`.
>
> If you exceed a secondary rate limit, you will receive a `403` or `429` response and an error message that indicates that you exceeded a secondary rate limit. If the `retry-after` response header is present, you should not retry your request until after that many seconds has elapsed. ... Otherwise, wait for at least one minute before retrying.
>
> Continuing to make requests while you are rate limited may result in the banning of your integration.
>
> There is not a way to check the status of your secondary rate limit.

实测部分：**12 条并发 + 12 条串行的连续 PATCH 没有触发任何限速**（12/12 成功、stderr 全空、主限速计数几乎没动）。再往上我没有继续加压——文档写明持续越线可能封禁集成方，用真实账号去故意撞限速不划算，所以我**停在「十几个标签不触发」这个结论上，没有拿到 403/429 的实测原文**。
按 gh 统一的错误渲染格式（本次实测到的所有 HTTP 错误都是 `HTTP <码>: <消息> (<url>)` 这个形状），真触发时 stderr 大概率长这样（**这是推断，不是实测**）：

```
HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (https://api.github.com/repos/.../labels/...)
```

另有一条实测：**每次调用 gh 只发一个请求，没有观察到自动重试。**`GH_DEBUG=api` 抓到的 PATCH 就是一次，429/403 不会被 gh 自己兜住，重试要宿主自己做。

### 4.3 官方对并发的建议和实测结论是相反的

同站 best practices 文档要求：对单个用户/客户端的请求要**串行**，不要并发；如果要发大量 `POST/PATCH/PUT/DELETE`，**每条之间至少间隔 1 秒**。
但实测 12 条并发是好的、还快 6.5 倍。**「能并发」和「官方建议不并发」是两回事**：这次没触发，不代表一直不触发。折中办法见第 7 节。

## 5. 读路径口径：`gh label list --json name,color`

### 5.1 色值形状

本仓库全部 19 个标签逐个核对：

```
count=19
accessibility          f143ab   len=6 hasHash=False allHex=True
bug                    d73a4a   len=6 hasHash=False allHex=True
...
wayfinder:grilling     9D7CD8   len=6 hasHash=False allHex=True
```

**统一是 6 位、不带 `#`，全部落在 `^[0-9a-fA-F]{6}$` 里。**

### 5.2 但大小写不统一——面板必须按大小写不敏感比较

19 个里有一个不是小写：

```
非小写项：wayfinder:grilling=9D7CD8
```

而且这不是 gh 的输出习惯，是 GitHub 就这么存的。同一个标签走原始 REST API 读出来一样是大写：

```
wayfinder:grilling   color=9D7CD8 default=False
```

**后果**：面板如果拿 `当前色 !== 新色` 判断「这条要不要发请求」，`9D7CD8` 和用户选的 `9d7cd8` 会被判成不同、白白发一次 PATCH（虽然结果无变化）；反过来也可能误判「已保存」。比较前两边都要 `.toLowerCase()`。

### 5.3 默认标签的色值

`isDefault=true` 的标签与颜色：

| 名字 | 颜色 |
| --- | --- |
| `bug` | `d73a4a` |
| `documentation` | `0075ca` |
| `duplicate` | `cfd3d7` |
| `enhancement` | `a2eeef` |
| `good first issue` | `7057ff` |
| `help wanted` | `008672` |
| `invalid` | `e4e669` |
| `question` | `d876e3` |
| `wontfix` | `ffffff` |
| `accessibility` | `f143ab` |

### 5.4 顺带发现一个读路径的真问题：默认只取 30 条

`gh label list --help` 写明 `-L, --limit int  Maximum number of labels to fetch (default 30)`。而插件现在的读代码**没有传 `--limit`**（`src/host/tracker/backends/github/labels.js:129`）：

```js
const r = await c.execGh(['label', 'list', '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'name,color,description'], { cwd: ctx && ctx.cwd })
```

实测截断（试验期间仓库里有 35 个标签）：

```
=== 读路径默认 --limit 30 的截断验证 ===
不带 --limit（=插件源码用的写法）：30 条
带 --limit 100：35 条
差值 = 5 条被静默丢弃
```

**标签超过 30 个的仓库，面板会看不到后面的标签，而且没有任何提示。** 这条与本票的改色功能直接相关（面板要列出标签才能改），也不限于本票。

## 6. 现有代码的错误分档现状（实测跑过）

把上面抓到的真实错误原文，喂给仓库自己的分类函数 `classifyGhError`（`src/host/tracker/backends/github/errors.js:54`）：

```
422 颜色格式错       => network
404 标签不存在/无权限 => not-found
未登录               => auth
401 Bad credentials  => auth
无 flag 本地校验     => network
标签已存在           => network
```

对着 `ERROR_KIND`（`src/shared/tracker/constants.js:73-81`）看，问题很清楚：

- 「颜色填错了」（422）落进 **`network`**——界面会跟用户说「网络错误」，这是错的。原因是 `classifyGhError` 没有任何规则匹配 422 / `Validation Failed`，最后兜底到 `classifyError`，而它无条件返回 `NETWORK`（`src/host/tracker/preflight.js:55-57`）。
- 「没登录」「token 失效」都正确落进 `auth`，这两条不用改。
- 「没有写权限」落进 `not-found`，和「标签不存在」混在一起——**这一条不是分类函数写错了，是 GitHub 只给 404、信息本身就不够**，只能靠第 3.3 节的 `viewerPermission` 额外判一次。

另有一处会挡路：非零退出时 `execGh` 返回的错误只有 `{ kind, message }`，**gh 的退出码被丢掉了**（`src/host/tracker/backends/github/client.js:144-149`，`code` 只进了内部 `err`、没有进返回的 `error`）。而「没登录」恰恰是**只靠退出码 4** 才好认的一种情况（虽然它的文案里含 "authentication token"、当前能被 `auth` 正则捞到，但那是巧合）。要在界面上稳定分开这几档，要么把 `code` 一起返回，要么在分类函数里显式匹配这几段文案。

## 7. 推荐方案

### 7.1 调用方式

**串行为默认，需要提速时并发上限 4。** 理由：

- 十几个标签串行约 15 秒（实测 12 条 = 14.1 秒），配一条进度条可以接受；官方文档要求串行、且改操作间隔 1 秒，串行是唯一不用赌的选项。
- 12 路并发实测 2.16 秒、没出事，但这是拿真实账号撞次限速边界的做法，官方明确不建议；**4 路并发能把十几个标签压到 4~5 秒量级，同时离「同时打十几个改请求」有安全距离**。
- 先做一次 diff（面板本来就拿到过当前色），**只对颜色真的变了的标签发请求**；注意按第 5.2 节先 `toLowerCase()` 再比。改 19 个标签通常真正要发的远少于 19 条。

### 7.2 批量语义

**逐条记账，不要写成「整体成功/整体失败」。** 第 2.3 节实测证明中途失败一定留半成品，所以每次 save 的结果要按标签粒度收集：成功哪些、失败哪些、失败原因各是什么。保存完后**重新拉一次 `gh label list` 以真实状态刷新面板**，不要乐观地把界面刷成用户填的那份——否则部分成功时界面会撒谎。

### 7.3 错误分档（界面要能分开说）

按可区分程度排，建议这样分四档：

| 界面上要说的话 | 判定依据（实测） |
| --- | --- |
| **没登录** | 退出码 = 4；stderr 含 `gh auth login` |
| **登录失效 / token 无效** | stderr 含 `HTTP 401: Bad credentials` |
| **颜色填错了** | stderr 含 `HTTP 422: Validation Failed` 且第二行是 `Label.color is invalid` |
| **标签不见了 / 仓库不存在 / 你没有写权限** | stderr 含 `HTTP 404: Not Found`——**这三件事长得一样**，需要再发一次 `gh repo view <repo> --json viewerPermission`：`READ` → 说「你没有写权限」；有写权限还 404 → 说「标签或仓库不存在」 |

另外两类属于调用方自己的 bug，不该展示给用户：「什么都没传」的 `specify at least one of`，以及标签重名创建时的 `already exists`。
真撞上次限速时按 `retry-after` 退避重试（gh 不会自己重试，第 4.2 节）。

### 7.4 两处需要连带改的地方

1. `listLabels` 补 `--limit`（第 5.4 节），否则标签多的仓库面板直接少一截。
2. `execGh` 的错误对象补上 `code`（第 6 节），否则「没登录」这一档只能靠文案巧合。

## 8. 还没确定的事

1. **没有拿到次限速触发后的真实报错原文。** 实测 12 条并发不触发；再往上要拿真实账号去撞，风险不划算，所以停住了。触发后的行为只有官方文档（403/429 + `retry-after`）和按 gh 统一错误格式推出的样子，没有实测。
2. **「有仓库写权限、但 token 本身只读」这一档没实测**（手上没有第二个令牌，也不动当前账号的登录状态）。第 3.3 节测的是「账号对该仓库没有写权限」，它返回 404。
3. GraphQL 一次请求批量 `updateLabel` 的路子只做了 schema 查证，没有实测。

## 附：可复制的验证命令

```bash
# 读路径：色值形状与大小写
gh label list --repo <owner>/<repo> --json name,color --limit 100

# 写路径：先建一个一次性标签，别拿正式标签试
gh label create r612-color-probe --repo <owner>/<repo> --color 123456
gh label edit   r612-color-probe --repo <owner>/<repo> --color 0A0B0C   # 期望 exit 0，读回 0A0B0C
gh label edit   r612-color-probe --repo <owner>/<repo> --color '#abc'   # 期望 exit 0，读回 aabbcc
gh label edit   r612-color-probe --repo <owner>/<repo> --color blue     # 期望 exit 1 + HTTP 422
gh label edit   r612-no-such-label --repo <owner>/<repo> --color 000000 # 期望 exit 1 + HTTP 404

# 想看 gh 到底发了什么
GH_DEBUG=api gh label edit r612-color-probe --repo <owner>/<repo> --color '#ABC'

# 权限判定（区分「没权限」与「标签不存在」）
gh repo view <owner>/<repo> --json viewerPermission

# 退出码约定
gh help exit-codes

# 用完删掉，并复查无残留
gh label delete r612-color-probe --repo <owner>/<repo> --yes
gh label list --repo <owner>/<repo> --json name --limit 100
```
