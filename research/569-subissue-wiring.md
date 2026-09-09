# 研究：子议题与阻塞关联现状与打架点（#569）

本票只做事实调查，不做拍板，不改业务代码。问题来自 #569 正文 Question，结论以文件路径与原文引用为准。

查过的一手来源都是当前工作区真实存在的文件，以及线上真实跑过的命令回显。行号是本次调查时读到的实际行号。

## 新建需求模板占位注入链路

模板本体在 `src/client/kernel/prompts.js` 第 29 行，`newWayfinder` 版本 13，声明 `placeholders: ['repo','subIssue']`。

中文模板里与子议题有关的两行原文是：

`把每一个 ticket 以当前后端的原生子议题方式关联到该 map（{subIssue}；失败重试并在评论留痕；仅当后端未启用原生能力时才回退到任务清单 + Part of）`

`用 Blocked by: #<n> 行表示阻塞关系`

英文模板对应行原文是：

`Wire each ticket as a native sub-issue of the map via the current backend ({subIssue}; retry on failure and leave a comment; only fallback to task list + Part of when native capability is unavailable)`

`Express blocking with Blocked by: #<n> lines`

`{repo}` 在调用处由工作区仓库地址填入，`{subIssue}` 按后端填话。填话函数在同一文件第 149 到 175 行：`NEW_WAYFINDER_DEFAULT_WIRING` 是兜底，`newWayfinderParamsFrom` 按 `backendId` 从 `backendModules` 里找该后端声明的 `prompts.subIssue`，找不到才用兜底，`newWayfinderPrompt` 把 `repo` 与 `subIssue` 一起填进模板。

调用入口在 `src/client/kernel/router.js`，新建需求按钮走 `newWayfinderPrompt`，不是直接拼字符串。门禁在 `tests/verify-map-subissues-352.js` 第 15 到 35 行，断言版本 13、占位含 `subIssue`、含 `{subIssue}`、含 `NEW_WAYFINDER_DEFAULT_WIRING`，且旧的三分支硬编码已删。

GitHub 后端填入 `{subIssue}` 的那句话原文在 `src/host/tracker/backends/github/index.js` 第 140 到 143 行：

中文：`先 gh api repos/{owner}/{repo}/issues/{child} --jq .id 取子议题数据库 id，再 gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id} 建边；以 gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length 校验计数与预期一致`

英文：`first gh api repos/{owner}/{repo}/issues/{child} --jq .id for child id, then gh api repos/{owner}/{repo}/issues/{map}/sub_issues -X POST -F sub_issue_id={id}; verify with gh api repos/{owner}/{repo}/issues/{map}/sub_issues --jq length equals expected`

关键点是先取子议题的数据库编号，再用该编号建边，最后用计数查询校验。数据库编号不是 `#` 后面的显示编号。

## 三个后端各自的数据声明原文

三个后端都在各自房间入口声明 `prompts.subIssue`，客户端只读声明，不写后端分支。

GitHub 在 `src/host/tracker/backends/github/index.js` 第 140 到 143 行，见上一章引文，不再重复。

GitLab 在 `src/host/tracker/backends/gitlab/index.js` 第 142 到 145 行：

中文：`通过 GitLab API 的子议题关联建边；以 list({parentKey}) 校验计数与预期一致`

英文：`via GitLab API sub-issue association; verify with list({parentKey}) equals expected`

本地 Markdown 在 `src/host/tracker/backends/markdown/index.js` 第 152 到 155 行：

中文：`创后 setParent(map.key) 建边；以 list({parentKey}) 校验计数与预期一致`

英文：`setParent(map.key) after creation; verify with list({parentKey}) equals expected`

找不到后端声明时的兜底在 `src/client/kernel/prompts.js` 第 150 到 153 行：

中文：`通过 Tracker 原生的父子关系关联（create 时带 parentKey 或创后 setParent）`

英文：`via Tracker native parent relation (create with parentKey or setParent after creation)`

门禁在 `tests/verify-map-subissues-352.js` 第 37 到 48 行，断言三个后端文件都含 `subIssue: {`。

## 宿主内部正确实现的入口与语义

契约入口在 `src/host/tracker/contract.js` 第 43 行与第 54 到 60 行：`setParent(repo, key, parentKey)` 是 15 个操作之一，`parentKey` 为字符串或空，空表示解除关联。快照组装在 `src/host/tracker/snapshot.js` 第 42 到 78 行，只按 `parentKey` 分组挂 `tickets`，不解析任务清单文字。

新建时带父键自动建边的实现有三处。

GitHub 在 `src/host/tracker/backends/github/issues-write.js` 第 93 到 100 行：创建成功后若 `input.parentKey` 非空，就调用 `graph.js` 的 `setParent`，成功才替换返回的票据。

GitLab 在 `src/host/tracker/backends/gitlab/issues.js` 第 153 到 159 行：创建成功后若 `input.parentKey` 非空，就调用 `POST` 建立 `relates_to` 链接，失败静默忽略。

本地 Markdown 在 `src/host/tracker/backends/markdown/issues-create.js` 第 77 行与第 82 行：若 `input.parentKey` 有值，就在文件头写 `<!-- parentKey: ... -->`，解析时以 `input.parentKey || '00'` 为父键。

GitHub 的 `setParent` 在 `src/host/tracker/backends/github/graph.js` 第 38 到 117 行，语义齐全：

幂等在第 59 到 63 行，想要的父键等于当前父键时直接返回当前票据，不发请求。

换父先解旧绑在第 90 到 93 行，当前父键非空且与目标不同时，先对旧父发删除再对新父发新增，保证单父。

不支持时诚实返回在第 82 到 83 行与第 98 到 99 行，错误信息含不支持字样时返回 `UNSUPPORTED`，信息原文为 `setParent unsupported (GHES or sub_issues not enabled)`。

解除关联走删除接口在第 67 到 86 行，目标为空且当前有父时，对当前父发删除。接口形状为 `POST /repos/{owner}/{repo}/issues/{parent}/sub_issues` 带 `sub_issue_id`，删除为同路径的 `DELETE` 带 `sub_issue_id`。

GitLab 的 `setParent` 在 `src/host/tracker/backends/gitlab/graph-membership.js` 第 11 到 61 行：空表示删掉全部 `relates_to` 链接，非空表示新增一条 `relates_to`，自己挂自己返回冲突。读回时重拉链接再归一。

本地 Markdown 的 `setParent` 在 `src/host/tracker/backends/markdown/issues-patch.js` 第 129 到 131 行，直接返回不支持，信息原文为 `markdown setParent unsupported (single-root)`。原因是单根目录层级实现换父成本高，已诚实上报。

## 跟踪文档原生写法与模板文本行写法的差异

跟踪文档的原生写法以原生关系为正，文字行只做回退。

`package/bundled-skills/wayfinder/SKILL.md` 第 69 行：阻塞用跟踪器的原生依赖关系，因为原生关系会在跟踪器自己的界面里画出可做的边界，只有点原生能力缺失的跟踪器才回退到正文约定。

`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-github.md` 第 42 行：阻塞的正统表示是 GitHub 原生依赖，用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 加边，数据库编号用 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 取。只有依赖能力不可用时才回退到子议题正文顶部的 `Blocked by: #<n>, #<n>` 行。

`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-gitlab.md` 第 43 行：阻塞的正统表示是 GitLab 原生阻塞链接，用 `glab issue note <child> --message "/blocked_by #<blocker>"` 加边。免费版或不可用时才回退到描述顶部的 `Blocked by: #<n>, #<n>` 行。

`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md` 第 27 行：本地 Markdown 的阻塞就是正文顶部的 `Blocked by: NN, NN` 行，被列出的文件全部标为已解决时才算不阻塞。

工作区当前生效的 `docs/agents/issue-tracker.md` 第 50 到 51 行与 GitHub 文档同文。

模板文本行写法在 `src/client/kernel/prompts.js` 第 29 行 `newWayfinder` 中文模板里只有一句话：`用 Blocked by: #<n> 行表示阻塞关系`，英文为 `Express blocking with Blocked by: #<n> lines`。这句话没有按后端分支，不论当前是哪个后端都要求写文字行。

`docs/prompts-review.md` 第 656 行的中文评审备注同样写 `blocking 用 Blocked by: #<n> 行表示`。

对比之下，`package/bundled-skills/to-tickets/SKILL.md` 第 63 行的写法是条件的：有原生阻塞或子议题关系就用平台原生关系，否则才把阻塞写成文字行。这是与模板无条件写法不同的正确参照。

## 线上因子议题没挂对而显示 0/0 并补链的实例

实例是 #352 记录的 #345 地图。#345 下原子议题为 #346 到 #351。

现象记录在 #352 正文现象节：通过面板新增需求按钮建好地图与子议题后，列表页该地图行的进度圆环与文字显示 0/0，点开 GitHub 原地址或面板内地图详情能看到实际已有关联的子议题，点刷新并等待超过一次快照周期后仍是 0/0。

诊断时服务端证据为：`gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/345/sub_issues --jq length` 返回 0，同仓库对照地图 #288 与 #329 同接口返回 6，#346 的父为空。原因是创建时只写了地图正文的任务清单与子议题正文的 `Part of #345` 回退形态，没有调用原生子议题接口建边。面板快照只从原生边派生统计，所以恒为 0/0。

补链做法记录在 #352 实施记录节：对 #345 逐子票执行 `gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/345/sub_issues -X POST -F sub_issue_id={id}`，其中 `{id}` 先用 `gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/{child} --jq .id` 取到。补完后同接口返回 6，GraphQL 查 #346 的父回到 345，列表页显示恢复正常。本次调查时复查该接口仍返回 6。

对照实例是 #369，故意建的空地图验证检查按钮，标题为 `TEST 0/0 空地图 - 验证检查按钮`，正文写明故意不关联任何子议题，预期列表显示 0/0 且按钮切为琥珀色检查态。这是故意为空，与 #345 的意外为空不同。

空态修复入口为 `src/client/kernel/prompts.js` 第 32 行 `mapInspect` 模板，列表与详情分别在 `src/client/views/ListTabRow.js` 与 `src/client/views/MapDetail.js` 按统计是否为空切按钮。回归门禁为 `tests/verify-map-subissues-352.js` 第 72 到 82 行，断言 #345 的子议题计数为 6。

## 事实清单

新建需求模板是 `src/client/kernel/prompts.js` 的 `newWayfinder` 版本 13，占位为 `repo` 与 `subIssue`，`{subIssue}` 按后端声明填话，找不到声明用兜底文案。

三个后端各自在房间入口声明 `prompts.subIssue`，GitHub 那句含先取数据库编号再建边再校验计数的完整命令，GitLab 与本地 Markdown 各用一句话声明建边加 `list({parentKey})` 校验。

宿主契约以 `setParent` 为唯一后端无关原语，GitHub 实现含幂等、换父先解旧绑、不支持诚实返回，新建带父键自动建边三后端都有，本地 Markdown 的换父直接报不支持。

跟踪文档要求原生优先、文字行只做回退，新建需求模板里阻塞那句是无条件文字行。

线上实例为 #345 在 #352 中从 0 补到 6，对照为 #369 故意为空。

## 打架点列表

第一，模板的阻塞写法与跟踪文档打架。跟踪文档要求 GitHub 与 GitLab 优先用原生依赖或阻塞链接，模板无条件要求写 `Blocked by` 文字行。按模板做出来的 GitHub 票据在原生视图里没有阻塞边，面板按原生边算时会被误判为可做。

第二，模板的子议题占位本身是按后端填话的，但阻塞那句没有享受同等待遇。子议题那句有 `{subIssue}` 占位加三后端声明加兜底，阻塞那句是写死的文字行。两句紧挨着，一句按后端变，一句永远不变。

第三，创建路径曾经只写任务清单加 `Part of` 回退，没有建原生边，导致 #345 的 0/0。快照只认原生边，清单写得再全也不进统计。#352 修的是模板措辞与补链，宿主快照至今仍不解析任务清单，两边的数据源没有第二条路。

第四，GitLab 的换父语义与 GitHub 不一致。GitHub 换父先删旧边再建新边，GitLab 的实现只新增 `relates_to`，没有先删旧边的步骤，也没有幂等前置判断。同一份调用语义在两个后端下行为不同。

第五，本地 Markdown 的 `setParent` 直接报不支持，但该后端的新建模板文案写的是创后 `setParent` 建边。按文案走本地后端必然走到不支持分支，实际能用的建边方式是新建时带父键。文案与实现对不上。

第六，`to-tickets` 技能的条件写法与新建需求模板的无条件写法打架。同一个仓库里两种技能对阻塞的写法要求不同，按不同技能进来的票据在阻塞表达上天然不一致。

第七，0/0 有两种含义但显示相同。#369 是故意为空的验证地图，#345 是意外没挂对的事故地图，列表都显示 0/0。检查按钮靠空态触发，对故意为空是正确诊断，对意外为空也是正确诊断，但人只看数字分不清是哪一种，必须点进详情或看任务清单才能区分。
