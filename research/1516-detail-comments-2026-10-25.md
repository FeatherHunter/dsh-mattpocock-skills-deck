# #1516 面板详情页看不到票评论：根因与修复方向

> 日期：2026-10-25。起因：#1516 维护者在面板里点开该票详情，看不到 GitHub 上自己刚发的评论，只在对话里问了一句为什么。

## 一句话结论

刷新后台把票详情交给界面时，`comments` 是数组；界面只认 `comments.nodes` 这种形状。两边对不上，评论永远是 0 条。这是 2026-10-24 提交 e31124e1（#1444）换掉旧读路径时引入的回归，不是 #1516 这一张票的特例，也不是网络或截图渲染问题。

## 现象与复现

- 面板右侧列表点开任意票 → 详情页标题写「评论 (0)」、正文下方写「无评论」，但输入框在（能发评论）。
- GitHub 上这张票确实有 3 条评论（作者 FeatherHunter，均含 user-attachments 截图）。
- 插件日志（C:\\Users\\辰辰洋洋\\.dsh\\profiles\\desktop\\.dsh-mattskillsdeck-cache\\logs\\2026-10-25.log）显示 20:53:59、20:54:59、21:01:45 三次 `wf.issueDetail` 全部 ok（1.2–1.4 秒），没有报错、没有降级到 `get.rest`。所以问题不在取数，而在形状。
- 用真实 3 条评论正文跑仓库 `src/client/views/shared/md.ts` 的 `mdToHtml`：全部解析成功（每条 2 个节点，图片都认出来了）——渲染器本身没问题。

## 数据链路四段（安装版 1.9.0-beta.18 与仓库 main 同病）

1. 电话注册：`src/host/index.ts:291` 把 `wf.issueDetail` 接到 `_comments()`，实现文件是 `src/refresh/rooms/host/comment-thread-fetch.ts:122-173`（安装版 `lib/index.js:1122-1125` → `refresh/rooms/host/comment-thread-fetch.js:40-96`）。
2. 宿主取数与回包：`:141`（安装版 `:55`）调 `session.get(repoRef, key, {}, opCtx)`，没带 comments 选项；`:167`（安装版 `:81`）把回包写成 `comments: iss.comments || { nodes: [] }`。
3. tracker 归一：`tracker/rooms/github/normalize.js:118-146` 的 `normalizeComments` 返回的是**数组**，`:268` / `:286` 放进 issue（仓库 `src/tracker/rooms/github/normalize.ts` 同样）。所以 `iss.comments` 是数组，原样透传给界面。
4. 界面判定：安装版 `lib/client.js:31055-31059`、仓库 `src/client/views/IssueDetail.ts:307-316` 写 `commentsNodes = commentsSource && commentsSource.nodes ? commentsSource.nodes : []`。数组没有 `.nodes` → 0 条 → 标题「评论 (0)」+ 空态「无评论」；`canComment` 另外兼容了数组，所以输入框还开着。

取数本身是带得到评论的：安装版 `tracker/rooms/github/queries.js:4-8` 的 `commentsField`、`:29` 的 `ISSUE_FRAGMENT` 里有 `comments(first:limitDefault)`。

## 引入提交与为什么门禁没红

- 引入：`e31124e1`「实现 #1444：刷新后台六条读路径改走 Tracker 只读会话……」（2026-10-24）把旧的 `fetchIssueDetail` 分支删掉，换成 `session.get` + 数组形状。旧路 `src/refresh/rooms/host/issue-detail-fetch.ts:47` 回的是 `comments: { nodes: comments, pageInfo: {...} }`，客户端正是照这个形状写的。旧电话装配还在（安装版 `lib/index.js:329-349` 的 `_issueDetail()`），但只被别的处理用，不再服务 `wf.issueDetail`。
- 没拦住的理由：`tests/verify-1444-comments.ts:159` 断言的就是 `Array.isArray(detail.issue.comments) && detail.issue.comments.length === 50`——门禁把错误形状锁成了「预期」；也没有一扇门禁把详情回包送进界面渲染器。

## 修复方向（二选一，推荐前者）

1. 宿主把 comments 包回旧形状：`{ nodes, pageInfo: { hasNextPage: false, endCursor: String(n) } }`，与 `issue-detail-fetch.ts:47` 一致；界面不用动。
2. 界面同时接受数组：`commentsNodes = Array.isArray(commentsSource) ? commentsSource : commentsSource.nodes`（把 `canComment` 里那点兼容口径收拢成一处）。

无论选哪条，都要补一扇「用真实回包形状渲染出「评论 (n)」和评论正文」的门禁，否则同一处形状还能再错一次。

## 影响面

面板详情页对所有仓库的票都不显示评论（不只 #1516）；刚发的评论也看不到；「加载更多」永远不会出现。发评论的输入框不受影响。

## 来源

- 仓库代码：`src/host/index.ts:291`、`src/refresh/rooms/host/comment-thread-fetch.ts:122-173`、`src/refresh/rooms/host/issue-detail-fetch.ts:47`、`src/tracker/rooms/github/normalize.ts`、`src/client/views/IssueDetail.ts:307-316`、`tests/verify-1444-comments.ts:159`。
- 安装版：`C:\\Users\\辰辰洋洋\\.dsh\\profiles\\desktop\\node_modules\\dsh-mattpocock-skills-deck`（1.9.0-beta.18）的 `lib/index.js`、`lib/client.js`、`tracker/rooms/github/*`。
- 提交：`e31124e1`；旧形状来自更早的详情读路径。