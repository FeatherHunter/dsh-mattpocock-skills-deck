# deck 工具要不要支持「传入图片」：GitHub、GitLab、本地 Markdown 三条后端调查

调研日期：2026-11-03（这次会话从 2026-11-02 深夜开始）。范围：deck 工具的参数面与 tracker 契约、GitHub/GitLab/本地 Markdown 三个房间的写路径、面板 Markdown 渲染，以及 gh 2.97.0 与 glab 1.123.0 的本机实测和官方文档。

调研边界：没有改动任何源码；没有对 GitHub 或 GitLab 真正上传过文件（本机 gh 2.97.0 没有 `--attach`，glab 未登录 gitlab.com，这两条都在下面写明）。CLI 事实来自本机 `--help` 实测；远端平台事实来自官方文档与 cli/cli 的 PR 源码。面板渲染结论来自源码与既有测试，没有做真机截图。

## 结论先行

先回答三个问题：

| 对象 | 今天能不能把图片传进去 | 关键依据 |
| --- | --- | --- |
| deck 工具 | **不能**。10 个工具的参数全是文本，契约的 27 项能力里没有附件或上传 | `src/deck/tools/issue-create-parts.ts:22-48`、`src/tracker/contract/operations.ts:164,178,181` |
| GitHub | **能，但有版本门槛**。gh v2.99.0（2026-09-01）起，issue 与 PR 的 create/edit/comment 有 `--attach`；本机 2.97.0 没有；只收图片与视频；GitHub Enterprise Server 不支持 | [GitHub CLI changelog](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/)、本机 `gh issue comment --help` |
| GitLab CLI | **能，而且比 GitHub 好接**。glab 1.123.0 的 issue create/note/update 有实验性 `--attach`；另有稳定的上传接口，`glab api --form` 能直接调 | 本机 `glab issue note --help`、`glab issue update --help`、[GitLab 上传 API](https://docs.gitlab.com/ja-jp/api/project_markdown_uploads/) |
| 本地 Markdown | **不能，也不建议现在硬做**。评论只是往票文件追加一段文本；面板图片只渲染 https 地址，本地路径会退化成说明文字 | `src/tracker/rooms/markdown/comments.ts:53-88`、`src/client/views/shared/md.ts:46-51,158-163` |

**建议：支持，但做成「可选的附件参数 + 按后端能力降级」，不要追求三个后端同一种行为。** 分三步走：

1. **今天就能用、零改动**：文档教用户先截图上传到 GitHub 或 GitLab，拿到 https 地址再写进正文或评论。远端面板已经能显示 https 图片（`tests/verify-markdown.ts:159-164` 钉着 GitHub 的 user-attachments 地址会渲染成 `<img>`）。
2. **近期推荐做**：给契约加一条 `attachments` 能力，给 create/comment/update 的输入加可选的文件路径数组，deck 工具同步加 `attachments?: string[]`。GitHub 与 GitLab 标 provided，本地 Markdown 标 unsupported-by-design。后端做得到就传，做不到就在回执里明说，绝不静默丢文件。
3. **不建议做**：为了「三后端一致」去做本地图片托管。那等于让插件长出文件服务器：要新增资产目录、受控文件读取路由、路径越权防护、清理与配额，成本远高于收益，而本地后端的用户本来就可以把图片放到别处再贴 URL。

## 一、deck 工具今天的能力面

10 个 deck 工具里没有一个收文件路径或二进制内容（清单见 `src/deck/rules/tool-order.ts`）。建票工具的参数只有标题、正文、原话、种类、标签、父票、认领等，`additionalProperties: false`，多传一个 `attachments` 会被拒绝（`src/deck/tools/issue-create-parts.ts:22-48`）；改票工具只有 comment、body、bodyDigest、close 等字段（`src/deck/tools/issue-patch-definition.ts:17,22,23,44`）。

契约层同样没有附件概念。`src/tracker/contract/operations-catalog.ts` 定义 27 项能力，等于 24 条操作加 3 个定位口；写入口的签名全部是文本：

- `create(repo, input: CreateInput, ctx)`：`src/tracker/contract/operations.ts:164`
- `comment(repo, key, body: string, ctx)`：`src/tracker/contract/operations.ts:178`
- `update(repo, key, patch: UpdatePatch, ctx)`：`src/tracker/contract/operations.ts:181`

接口注释把规矩写死了：不许哪家后端自己加对外方法，要加能力先改契约与名录再实现（`src/tracker/contract/operations.ts:104`）。三家的能力登记里也都没有附件项：GitHub 是 24 条操作里 23 条 provided、`ensureLabelColorsFile` unsupported-by-design，加 3 个定位口全 provided（`src/tracker/rooms/github/support/capability-register.ts`）；本地 Markdown 是 21 条 provided、3 条 partial、3 条 unsupported-by-design（`src/tracker/rooms/markdown/capability-register.ts`）。加一条能力要同时改契约名录、三家的 capability-register、对应实现和 `docs/tracker/capability-*.md`，门禁 `tests/verify-capability-register.ts` 会抓不一致。

所以现状很清楚：**今天任何「贴截图」都得先有一个 URL，deck 工具本身传不了图。**

## 二、GitHub 侧

### 2.1 gh 官方支持，从 v2.99.0 开始

GitHub 的官方 changelog 写明：gh v2.99.0（2026-09-01）正式提供可重复的 `--attach`，用在 `gh issue create/edit/comment` 与 `gh pr create/edit/comment` 六个命令上。行为是：

- 把本地图片或视频上传到 GitHub，并把 URL 写进正文；正文里如果引用了同一个本地文件，会原地改写成上传后的 URL，没引用的追加到正文末尾。
- 路径后面可以跟 `#替代文字`，例如 `./shot.png#登录失败截图`；视频不支持替代文字。
- 需要仓库的写权限；GitHub.com 与 GitHub Enterprise Cloud 可用，**GitHub Enterprise Server 不支持**。
- 只收图片与媒体文件。官方两处列的类型略有出入：changelog 写 PNG/JPEG/GIF/WebP/SVG/MP4/MOV/WebM，附件帮助页写 PNG/GIF/JPEG/SVG/MP4/MOV/WebM。体积上限（浏览器上传口径）是图片与 GIF 10MB、Free 计划视频 10MB、付费计划视频 100MB、其它文件 25MB；gh CLI 只收图片与媒体，所以实际主要撞 10MB 这条线。
- 公开仓库上传的文件不需要登录就能访问；私有或内部仓库只有本来就有权访问的人能看到（[Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)）。

本机实测：`gh version 2.97.0 (2026-07-31)`，`gh issue comment --help` 与 `gh issue create --help` 都没有 `--attach`。官方最新版本是 v2.103.3（2026-10-23 左右发布记录）。所以要用这条能力，**插件必须先探测 gh 版本，不能假设用户装了新版**。

### 2.2 gh 的上传走内部端点，不是公开 REST API

这一条决定插件不能自己重写上传逻辑。cli/cli 的 PR #14180 源码（[diff](https://patch-diff.githubusercontent.com/raw/cli/cli/pull/14180.diff)）显示，`--attach` 调用的是：

```
POST https://uploads.github.com/user-attachments/assets?name=<文件名>&content_type=<MIME>&repository_id=<仓库数字 id>
Content-Type: application/octet-stream
Accept: application/vnd.github+json
```

回包是 `{url}`。凭证只认 OAuth、经典 PAT、细粒度 PAT，拒绝 user-to-server、server-to-server、refresh 与未知类型；仓库权限只认 ADMIN/MAINTAIN/WRITE，READ 或 TRIAGE 返回 404；`checkHost` 明确拒绝 GitHub Enterprise Server（ghe.com 的数据驻留租户可用）。源码注释还写明上传**不重试**，因为「上传后无法删除，重试若服务端已接受就会留下孤儿资产」。

结论有两个：第一，这个端点没有出现在公开的 REST 文档里，插件不应该自己实现一份，应该调用 gh CLI，让 gh 管凭证和权限；第二，**GitHub 没有「单独上传一个文件再拿 URL」的稳定公开操作**，附件只能跟着一次正文写入走。

### 2.3 落到本仓要改什么

三个写入口今天的样子：

- 建票：主路走 REST，`gh api repos/<owner>/<name>/issues --method POST -f title=... -f body=...`（`src/tracker/rooms/github/write/issues.ts:95`）。注释说明为什么不用 `gh issue create`：它不认 `--json`，拿不到结构化回包（`issues.ts:93-94`）。这条路**传不了文件**。
- 评论：先试 REST `gh api .../comments -f body=`，失败回落 `gh issue comment --body`（`src/tracker/rooms/github/write/comments.ts:43-55`）。回落路径本来就在 CLI 上，改成 `--attach` 最顺。
- 改票：走 `gh issue edit` 子命令（`src/tracker/rooms/github/write/issues.ts:348`），加 `--attach` 顺路。

因此 GitHub 侧的真实成本不在「调哪个 flag」，而在：

1. **加版本与能力探测**。`src/tracker/rooms/github/read/preflight.ts` 全文没有 `version`：只查 gh 可执行、登录态、仓库可达。要按 gh >= 2.99 启用，就得新增一次 `gh --version` 探测（最好带缓存），并改预检的时间预算；那套预算由 `tests/verify-1475-predicate-budget.ts` 盯着。
2. **建票路径要重排**。带附件时建票只能走 `gh issue create --attach`，没有 JSON 回包，得从输出里解析编号或 URL，或者建完按幂等键回查。这是三个写口里最贵的一处。
3. **私有仓库的显示风险**。面板的 `<img>` 是浏览器直接去请求 GitHub 的附件地址，不带 GitHub 的登录凭证。公开仓库没问题；私有或内部仓库的附件很可能显示不出来（未实测，见第八节）。这一点会直接影响「私有仓库用户能不能看到自己刚贴的截图」。

## 三、GitLab 侧

### 3.1 glab CLI 已经有 --attach，但标着实验性

本机 `glab 1.123.0`，实测：

- `glab issue create --attach`：有，标注 Experimental，可重复，支持 `-` 从标准输入读；只给附件、不给描述也能满足描述必填。
- `glab issue note --attach`：有，实验性，上传文件并在评论末尾引用。
- `glab issue update --attach`：有，实验性，上传文件并在描述末尾引用。
- `glab mr create --attach`：有；`glab mr note` 没有。

官方文档同样标着实验性（[glab issue note](https://docs.gitlab.com/cli/issue/note/)）。「实验性」意味着可能被改掉或删掉，不能当成长期稳定的契约。

### 3.2 更稳的路是 GitLab 的上传 API

GitLab 有公开的上传接口（[Project markdown uploads API](https://docs.gitlab.com/ja-jp/api/project_markdown_uploads/)）：

```
POST /projects/:id/uploads
  属性 file：必填，multipart/form-data
  回包：{id, alt, url, full_path, markdown}
```

`url` 可以直接放进 Markdown，`full_path` 是绝对路径，另有列表、按 id/secret 下载、删除的端点。支持 Free/Premium/Ultimate 与 GitLab.com、Self-Managed、Dedicated。评论与回复的附件上限，GitLab.com 的设置页写的是 100 MiB（[GitLab.com 设置](https://docs.gitlab.com/user/gitlab_com/index.md)），Self-Managed 的管理文档说默认 100 MB、可在管理后台调整（`doc/administration/settings/account_and_limit_settings.md`）。

`glab api` 支持 multipart 的 `--form "file=@./image.png"`，帮助里的示例正是上传 wiki 附件。也就是说，**不依赖实验性的 `--attach` 也能做**：先 `glab api --method POST projects/<id>/uploads --form "file=@<路径>"` 拿回包，再把返回的 URL 写进正文/评论。

### 3.3 落到本仓的注意点

- 上传接口返回的是**相对 URL**（形如 `/uploads/<secret>/<file>`）。面板 `mdSafeImgUrl` 只放行 `https:` 开头的地址（`src/client/views/shared/md.ts:46-51`），相对地址会被当成文字。所以后端必须自己拼成绝对地址，主机名从仓库的 remote 或当前登录的 GitLab 实例推。
- Self-Managed 若跑在 http 上，拼出来仍是 http，面板照样不显示。这条要写进能力说明，或者要求用户实例是 https。
- 现有评论写路径是 `glab api <notesPath> --method POST -f body=<body>`（`src/tracker/rooms/gitlab/comments.ts:63-65`），没有任何 multipart 先例，需要在 transport 层确认 `--form` 参数怎么拼、超时怎么算。
- glab 的实验性 flag 与稳定 API 二选一：**推荐走上传 API**，它三家 GitLab 部署形态都支持，也不会因为 glab 升级改掉实验 flag 而坏掉。

## 四、本地 Markdown 侧

本地后端的「票」就是 `.scratch` 下的 Markdown 文件；评论是往票文件的 `## Comments` 段末尾追加一段：

```
### <作者> — <ISO 时间>
<评论正文>
```

代码在 `src/tracker/rooms/markdown/comments.ts`：评论块模板在第 53-55 行，`appendSectionBlock(txt, 'Comments', block)` 在第 87 行，整份文件经 `publishTextFile` 原子发布（第 88 行）。全程没有任何附件目录、图片拷贝或二进制处理。

面板渲染这一侧的限制更硬。`src/client/views/shared/md.ts` 的 `mdSafeImgUrl` 只认 `https:`（第 46-51 行），其余返回 `null`；`mdInline` 在拿不到安全地址时把图片降级成替代文字（第 158-163 行）。文件头注释把意图写明了：正文不可信，默认拒绝，只放行安全协议的图片地址（第 11-13 行）。既有测试钉着危险协议不产 `<img>`（`tests/verify-markdown.ts:142-162`），同时确认 `https://github.com/user-attachments/assets/...` 会正常渲染（第 159-164 行）。

链接倒是允许相对路径（`mdSafeUrl`，第 167-174 行），但面板跑在 DSH Web GUI 的地址上，相对链接会按 GUI 地址解析，不是按工作区文件解析；仓库里也没有找到「插件把工作区文件当静态资源提供」的路径。所以 `[截图](./shot.png)` 在面板里多半是个打不开的链接（未实测，见第八节）。

要在本地后端支持图片，至少得新增三件事：把文件拷进 `.scratch/<feature>/assets/` 之类的资产目录；宿主新增一个只读、限定工作区、带类型与体积检查的文件读取路由；工具参数与能力登记。这三件里第二件是安全面最大的——做不好就是任意文件读取。**本次调研的建议是本地后端先标 unsupported-by-design，把图片能力留给两个远端后端。**

## 五、产品与安全上的硬约束

不论选哪种实现，下面几条应该先定死：

1. **参数传工作区相对路径，不传 base64**。图片动辄几 MB，塞进工具调用的 JSON 会顶爆模型上下文、审计日志和会话记录；base64 还会让日志无法回放。
2. **路径必须限定在工作区内**。解析成绝对路径后再检查是否落在工作区根下，拒绝 `..`、盘符跳转与符号链接逃逸；否则用户一句「附件传 C:\Users\...\.ssh\id_rsa」就能把任意文件传到公网仓库。
3. **类型与体积白名单**。只收图片（PNG/JPEG/GIF/WebP），单文件不超过 10MB（对齐 GitHub 图片上限，也是 GitLab 100MB 的保守子集）；视频先不做：GitHub 能传，但面板只渲染 `<img>`，传上去也看不见。
4. **上传失败不静默降级**。回执要说清「附件没传成，正文/评论照常写了」还是「整笔没写」，不能假装成功。
5. **不自动重试上传**。GitHub 的上传无法删除，源码注释明确说重试会留下孤儿资产；宁可在回执里让用户重试。
6. **私有仓库要单独验证显示链路**。附件 URL 在私有仓库下需要权限，而面板的 `<img>` 不带 GitHub 凭证。如果实测显示不出来，私有仓库场景就得准备「点击在新窗口打开」的退路，或者在能力说明里写清。
7. **跨后端语义差异要承认**。GitHub 的 `--attach` 是「上传 + 把引用写进正文」一次完成；GitLab 的上传 API 是「先拿 URL，再自己决定写去哪」。同一套工具参数要在两边都成立，必须按能力降级，而不是假装两边一样。

## 六、建议方案与验收口径

如果决定做，建议按下面的边界落地：

**契约与工具面**

- 契约新增一条能力 `attachments`（描述「写正文或评论时附带本机图片」），并在 `CreateInput`、`UpdatePatch`、comment 入参上各加一个可选的 `attachments?: string[]`。不在写入口之外另造「上传」操作：GitHub 根本没有稳定的独立上传操作，独立操作只能退化成「先传图再发评论」，语义更怪。
- deck 工具给 `deck_issue_create` 与 `deck_issue_patch` 加 `attachments?: string[]`，描述里写清「工作区相对路径、最多 N 个、单文件 ≤10MB、只收图片」。
- 三家 capability-register 分别登记：GitHub 与 GitLab provided（并注明版本与平台条件），本地 Markdown unsupported-by-design。回执里对 unsupported 明确写一句「这个后端不支持附件，已按纯文本写入」。

**GitHub**

- 预检新增 `gh --version` 探测与缓存；低于 2.99 或 host 是 GHES 时不提供该能力，回执降级。
- comment 与 update 直接走已有 CLI 路径加 `--attach`；create 需要改成 `gh issue create --attach` 并从输出解析编号（或建后按幂等键回查），回执形状要保持兼容。
- 版本探测与预检预算要同步改 `tests/verify-1475-predicate-budget.ts`。

**GitLab**

- 走稳定上传 API：`glab api --method POST projects/<id>/uploads --form "file=@<路径>"`，把回包的 `url` 拼成 https 绝对地址写进正文/评论。不依赖实验性的 `--attach`。
- 上传失败整笔不写，回执照实说；不要先写正文再补图，避免留下没有图的评论。

**本地 Markdown**

- 先 unsupported-by-design，回执里说清，并把「先把图片放到能提供 https 地址的地方」写进工具描述。

**测试**

- `tests/verify-capability-register.ts` 会兜住能力登记与实现不一致。
- 三个房间各加一组用假 `execGh`/`glabClient` 的 argv 断言，钉住「带附件时参数长什么样、附件路径怎么校验」。
- 版本探测单测：2.97 拒绝、2.99 放行、解析失败时按不支持处理。
- 面板渲染不用新加：https 图片与危险协议已有 `tests/verify-markdown.ts` 覆盖。

**分阶段**

1. 文档先行：教用户手动上传拿 URL，今天就能解决「想贴截图」的需求。
2. 只做评论附件：GitHub 与 GitLab 的评论路径成本最低、收益最高。
3. 扩到建票与改正文：GitHub 建票要改回执解析，单独一轮。
4. 本地后端是否做，等前三步跑过一轮、确认真实需求再定。

## 七、证据与来源

平台官方资料：

- GitHub CLI changelog，2026-09-01 的 `--attach` 公告：https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/
- GitHub Docs，用 GitHub CLI 附加文件：https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli
- GitHub Docs，在 issue/PR/评论里附加文件（类型与体积）：https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
- cli/cli PR #14180 的源码 diff（内部上传端点、凭证与权限白名单、GHES 拒绝、不重试）：https://patch-diff.githubusercontent.com/raw/cli/cli/pull/14180.diff
- GitLab CLI issue note 文档（`--attach` 标实验性）：https://docs.gitlab.com/cli/issue/note/
- GitLab Project markdown uploads API：https://docs.gitlab.com/ja-jp/api/project_markdown_uploads/
- GitLab.com 设置（附件最大 100 MiB）：https://docs.gitlab.com/user/gitlab_com/index.html
- GitLab Self-Managed 账号与限制设置（附件默认 100 MB）：https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/administration/settings/account_and_limit_settings.md

本机实测命令与结果（2026-11-03）：

- `gh --version` → `gh version 2.97.0 (2026-07-31)`；`gh issue comment --help`、`gh issue create --help` 都没有 `--attach`；`gh api --help` 只有 `-F/--field`（值可用 `@文件` 读）、`-f/--raw-field`、`--input`，没有 multipart。
- `glab --version` → `glab 1.123.0`；`glab issue note --help`、`glab issue create --help`、`glab issue update --help` 都有 `--attach`（Experimental）；`glab mr note --help` 没有；`glab api --help` 有 `--form "file=@./image.png"` 的 multipart 示例。
- `glab auth status` → gitlab.com 返回 401 Unauthorized（本机未登录 GitLab，所以没有做真实上传）。

仓库代码：

- `src/deck/tools/issue-create-parts.ts:22-48`：建票工具参数表，无附件字段，`additionalProperties: false`。
- `src/deck/tools/issue-patch-definition.ts:17,22,23,44`：改票工具参数表。
- `src/tracker/contract/operations.ts:104,164,178,181`：契约不许后端私加方法，三个写入口的签名。
- `src/tracker/contract/operations-catalog.ts`：27 项能力名录，无附件项。
- `src/tracker/rooms/github/write/comments.ts:26,43-55`：评论 REST 优先、CLI 回落。
- `src/tracker/rooms/github/write/issues.ts:93-95,348`：建票只走 REST 的原因，改票走 `gh issue edit`。
- `src/tracker/rooms/github/read/preflight.ts`：预检不查 gh 版本。
- `src/tracker/rooms/gitlab/comments.ts:63-65`：评论只走 `glab api -f body`。
- `src/tracker/rooms/markdown/comments.ts:53-55,87-88`：本地评论的文本追加方式。
- `src/client/views/shared/md.ts:11-13,46-51,158-163,167-174`：面板只渲染 https 图片，其它协议降级。
- `tests/verify-markdown.ts:142-164`：危险协议与 GitHub 附件 URL 两组渲染断言。
- `src/tracker/rooms/github/support/capability-register.ts`、`src/tracker/rooms/markdown/capability-register.ts`：两家能力登记的实际条数。

## 八、没有验证、需要真机补的部分

1. **没有真正上传过文件**。本机 gh 2.97.0 没有 `--attach`，glab 未登录 gitlab.com；平台的实际上传行为是按官方文档与 PR 源码推的。
2. **私有仓库附件在面板里能不能显示**。GitHub 文档说私有/内部仓库的上传文件只对有权限者可见，而面板的 `<img>` 不带 GitHub 凭证。需要一次真机验证；如果显示不出来，私有仓库场景要另设计。
3. **gh 2.99.0 的 `--attach` 实机帮助**没有跑过，只读了 changelog 与文档。版本号以 changelog 为准。
4. **本地相对链接在面板里的实际落点**。源码显示相对链接会被放行，但没有找到宿主提供工作区文件路由的证据；需要一次真机点击确认。
5. **Self-Managed GitLab 的默认附件上限**来自管理文档，具体实例可改；GitLab.com 的 100 MiB 来自设置页。
6. **glab 实验 flag 的行为细节**（例如 `--attach` 与 `--description` 同时给时引用插在哪、`update` 重新上传后旧附件怎么处理）没有逐条实测。
