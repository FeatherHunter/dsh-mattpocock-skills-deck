# 研究：GitHub 作者链路端到端盘点（#238）

> 任务：验证 GraphQL → normalize → Host 快照 → 前端快照 每段是否携带 author，指出断点。

## 1. GraphQL 字段清单

**文件：** `src/host/tracker/backends/github/queries.js`

- L14-L30 ISSUE_FRAGMENT 定义
- L23 `'author{login name avatarUrl __typename}'` 顶层作者
- L27 评论作者同结构
- L33-L40 LIST_QUERY, L43-L47 GET_QUERY 复用片段
- L50 别名 GITHUB_ISSUE_FIELDS

结论：GraphQL 已完整声明 author，未遗漏。

## 2. normalize 映射

**文件：** `src/host/tracker/backends/github/normalize.js`

- L55-L66 normalizeActor 兼容 avatarUrl/avatar_url，login 空 → null
- L48-L53 kindFromTypename
- L206-L209 `raw.author || raw.user → normalizeActor → if(author) issue.author = author` 有则对象无则省略（MISSING）
- L132 评论作者回退 `normalizeActor(n.author || n.user) || {login:''}`

**契约：** `src/shared/tracker/shape.js:132` `author?: Actor` 能力字段

## 3. Host 快照透传

### 3.1 新链路 snapshot.js — ✅ 透传

**文件：** `src/host/tracker/snapshot.js:22-42,76-112`

- L34、L40 Object.assign 浅拷整个 Issue，含 author
- L98 tracker.list → normalize → all → assembleSnapshot

结论：新链路未断。

### 3.2 旧链路 src/host/index.js — ❌ 断点

**文件：** `src/host/index.js`

| 段 | 位置 | 现状 |
|----|------|------|
| wf.snapshot | L1410-L1432 | 调 buildSnapshot |
| buildSnapshot | L915-L1031 | 组装 maps/issues |
| fetchIssues | L665-L689 | --json number,title,labels,state,assignees,updatedAt 无 author |
| fetchMapsDetail | L796-L825 | frag L801 无 author |
| mapTicket | L574-L590 | 返回对象无 author |
| fetchIssueDetail | L884-L913 | frag L888 无 author |

旧链路为线上 wf.snapshot 真正数据源，与新链路未接线。

**断点**：`fetchIssues:665-689`、`fetchMapsDetail:796-810` 未请求 author；`mapTicket:574-590` 未透传。

### 3.3 最小修复

1. 请求侧：fetchIssues --json 追加 author；fetchMapsDetail frag 追加 author{login name avatarUrl}；fetchIssueDetail 同步
2. 映射侧：mapTicket 增加 author 透传；fetchIssues 映射追加 author
3. 或切换：wf.snapshot 改 composeSnapshot 新链路

## 4. 前端现状

| 视图 | 是否消费 | 证据 |
|------|----------|------|
| ListTab | 未 | grep 0 |
| TicketRow | 未 | 仅 claimedBy |
| MapDetail | 未 | 同上 |
| IssueDetail | 已 | L150-154 |

## 5. 兼容/错误

- 未登录 errors.js:40-43 → AUTH
- 限流 errors.js:45 → RATELIMIT，旧链路 REST 降级仍漏 user.login 需补

来源：queries.js:23, normalize.js:55-66/206-209, snapshot.js:22-42, host/index.js:665-689/796-810/574-590, ListTab.js, IssueDetail.js:150-154
