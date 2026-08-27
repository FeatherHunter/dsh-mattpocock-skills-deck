# 研究：GitHub PR 数据通路与 gh CLI / GraphQL 成熟度（含限流 / 分页 / 与 Issue 号段同域问题）

> 票号：#289（归属 #288 讨论域）  
> 分支：research/289-pr-data  
> 日期：2026-08-28  
> 状态：只读探查，不改 src；结论供契约扩展与讨论票直接引用

## 一句话结论（gist）

本仓库内可复用现有 Issue 的 GraphQL 分页、错误归一与 `key=String(number)` 约束，以新增 `LIST_PR_QUERY` + `PR_FRAGMENT` 独立查询承载 PR 只读通路；PR 与 Issue 同号段、URL 形态不同、MERGED / isDraft 等专有字段不可与 ISSUE_FRAGMENT 合并。最小只读需 2 个 GraphQL 查询（列表 + 详情），读写需额外 REST/gh 调用（评论、关闭、合并）；风险集中在限流、GHE 不支持与同号跳转冲突上，均可通过已有 `classifyGhError` 与前端路由分流诚实回退。

---

## 1. 背景与问题

#289 要求回答五问：

1. GraphQL 中 `pullRequests` 与 `issues` 字段异同、与现有 `ISSUE_FRAGMENT` 的复用度。
2. gh CLI 对 PR 的暴露成熟度（`gh pr list/view/diff` 与 `gh api repos/{owner}/{name}/pulls`）。
3. 现有 `LIST_QUERY（repository.issues）` 若要支持 PR，是新增 `LIST_PR_QUERY` 还是合并查询。
4. PR 与 Issue 同一编号空间对 `key=String(number)` 与 URL 跳转的影响。
5. 两档（只读列表+详情 / 读写评论-关闭-合并）所需的最小调用清单与风险。

---

## 2. 现有 Issue 通路复用度基线

### 2.1 现有查询形状

`src/host/tracker/backends/github/queries.js`（51 行）：

- `ISSUE_FRAGMENT` = `number,title,state,body,url,createdAt,updatedAt,closedAt,author{login name avatarUrl __typename},assignees(first:50){nodes{…}},labels(first:50){nodes{name color description}},milestone{…},comments(first:50){nodes{…}},parent{number},blockedBy(first:50){nodes{number title state}}`
- `LIST_QUERY` = `repository(owner:$owner,name:$name){ issues(first:$first, after:$after, states:[OPEN,CLOSED], orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ ISSUE_FRAGMENT } pageInfo{ hasNextPage endCursor } } }`
- `GET_QUERY` = 单票 `issue(number:$number)`

分页、错误归一（`errors.js → classifyGhError`）、超时（`client.js` 30s）、`normalize.js`（`key=String(number)`、parentKey、blockedBy、labels/assignees/comments）均可复用。

### 2.2 复用清单

| 能力 | 现有 Issue 通路 | PR 是否可直接复用 | 备注 |
|---|---|---|---|
| GraphQL 分页（first/after + pageInfo） | ✅ `issues(first:100, after:$after)` | ✅ `pullRequests(first:100, after:$after)` 同构 | 见 §3 实测，游标格式一致 |
| `ghClient(ctx)` → `execGh/execJson` | ✅ | ✅ | `gh api graphql` 同一入口，无需新 client |
| `classifyGhError` 错误归一 | ✅ | ✅ | auth 401/403、429 rate-limit、404 not-found、parse、network 同一套正则 |
| `normalize.js` 基础字段 | ✅ title/body/url/createdAt/updatedAt/closedAt/author/assignees/labels/milestone/comments | ✅ 大部分直通 | PR 专有字段需扩展，见 §5 |
| `snapshot.js composeSnapshot` | list → assemble → deck | ⚠️ 需决策：PR 是否进 snapshot（建议不进，独立 Tab） | 见 §6.3 推荐 |

核心不变量保持：`number` 仅作 `keySource` → `Issue.key = String(number)`，不产出 `number` 字段（harness 断言 `no number`）。

---

## 3. GraphQL 与 CLI 调用清单对比表

> 实测仓库：`FeatherHunter/dsh-mattpocock-skills-deck`；时间 2026-08-27T12:xxZ；限流剩余 core 4999 / graphql 5000（见 §7）

| 维度 | GraphQL | REST（gh api） | gh CLI 高层命令 |
|---|---|---|---|
| **列表** | `repository.pullRequests(first:100, after:$after, states:[OPEN,CLOSED,MERGED], orderBy:{field:UPDATED_AT,direction:DESC})`  | `GET /repos/{owner}/{repo}/pulls?state=all&per_page=100&page=N`（`gh api repos/.../pulls --paginate`） | `gh pr list --json number,title,state,url --limit 30` |
| **详情** | `repository.pullRequest(number:$number){ number title state body url createdAt updatedAt closedAt mergedAt isDraft reviewDecision mergeable mergeStateStatus author assignees labels milestone comments reviews reviewRequests baseRefName headRefName additions deletions changedFiles }` | `GET /repos/{owner}/{repo}/pulls/{number}`（含 `merged, mergeable, draft, merged_at`） | `gh pr view 287 --json number,title,state,url,author,assignees,labels,comments,isDraft,mergeable,mergedAt,reviewDecision` |
| **状态枚举** | `OPEN / CLOSED / MERGED`（三态，Issue 仅两态） | `state: open/closed` + `merged: bool` | 同 GraphQL，state 三态 |
| **PR 专有字段** | `mergedAt, isDraft, reviewDecision, mergeable(MERGEABLE/CONFLICTING/UNKNOWN), mergeStateStatus, baseRefName, headRefName, additions/deletions/changedFiles, reviews, reviewRequests` | 同左，但命名 snake_case（`merged_at, draft, mergeable`） | 同 GraphQL，字段名 camelCase 透出 |
| **评论** | `comments` + `reviews` 需分开取（Issue 只有 `comments`） | `POST /repos/{owner}/{repo}/issues/{number}/comments` 与 Issues 共用；review 另走 `/pulls/{number}/reviews` | `gh pr comment / gh issue comment` 复用同一评论接口 |
| **diff** | 无（GraphQL 不含 patch） | `GET /repos/{owner}/{repo}/pulls/{number}.diff`（Accept: diff） | `gh pr diff 287` 成熟，已验证 |
| **分页** | cursor 分页（`pageInfo.hasNextPage/endCursor`）| page + Link header（`--paginate` 自动跟随） | 默认 limit 30，`--limit 100` 可调；底层走 REST |
| **认证** | Bearer token（gh 已登录即带） | 同左 | 同左（依赖 `gh auth login`） |
| **限流** | 5000 points/hour，单查询 cost 1（实测 remaining 4761） | 5000 req/hour，`X-RateLimit-Remaining` 4999 | 复用 REST/GraphQL 配额，不额外 |
| **错误形态** | `{errors:[{message,type}]}` | HTTP 状态码 401/403/404/429 + JSON message | 透传 stderr，`classifyGhError` 已覆盖 |

### 3.1 实测证据（节选）

**GraphQL pullRequests 列表（2 条）：**

```json
{
  "data": {
    "repository": {
      "pullRequests": {
        "nodes": [
          {"number":287,"title":"fix: toast 弹窗亮色主题下不可见","state":"OPEN","mergedAt":null,"isDraft":false,"reviewDecision":null,"mergeable":"MERGEABLE","url":"https://github.com/.../pull/287"},
          {"number":275,"title":"fix: correct setup-mattpocock-skills → setup-matt-pocock-skills typo","state":"OPEN","mergedAt":null,"isDraft":false,"reviewDecision":null,"mergeable":"MERGEABLE"}
        ],
        "pageInfo": {"hasNextPage":true,"endCursor":"Y3Vyc29yOnYyOpK0MjAyNi0wOC0yN1QwOTo0NDowN1rPAAAAAQS_V0I="}
      }
    }
  }
}
```

**GraphQL 单 PR 详情（287）：**

- `state: OPEN`、`mergedAt: null`、`isDraft: false`、`mergeable: MERGEABLE`、`mergeStateStatus: UNSTABLE`、`baseRefName: main`、`headRefName: fix/toast-bg-light-theme`、`additions:15 deletions:15 changedFiles:5`。

**REST 同票对照：**

- `GET /repos/.../issues/287` → `html_url: https://github.com/.../pull/287`，含 `pull_request: {url, html_url, diff_url, patch_url, merged_at: null}`，`state: open`。
- `GET /repos/.../pulls/287` → `number:287 state:open merged:false draft:false mergeable:true`。
- `gh pr list --json number,title,state,url --limit 3` → 返回 287/275/273；`gh issue list --json … --limit 3` → 返回 294/293/292（不同集合，同号段见 §8）。

**gh CLI 成熟度小结：** `gh pr list/view/diff` 与 `gh api` 均稳定；`gh pr view --json` 字段与 GraphQL 对齐；`gh api --paginate` 对 pulls 可用（实测 `.[].number` 取到 287/275/273/106）。

---

## 4. 两档最小调用清单

### 4.1 只读档：列表 + 详情（推荐落地的最小闭环）

> 目标：顶部 Tab 展示 PR 列表，点入看详情与评论，只读，不改状态。

| 步骤 | 调用 | 方法 | 必需字段 | 备注 |
|---|---|---|---|---|
| 1 | 列表 | `gh api graphql` → `LIST_PR_QUERY`（复用分页循环，first=100） | number,title,state,url,createdAt,updatedAt,author{login},isDraft,reviewDecision,mergeable | 与 `LIST_QUERY` 同构，仅把 `issues` 换 `pullRequests`，states 增 `MERGED` |
| 2 | 详情 | `gh api graphql` → `GET_PR_QUERY`（单票） | 同上 + body,closedAt,mergedAt,baseRefName,headRefName,labels,assignees,milestone,comments(first:50),reviews(first:20),additions/deletions/changedFiles | body 与 Issue 同字段；reviews 需额外取 |
| 3（可选）| diff 预览 | `gh pr diff <number>` 或 `gh api repos/.../pulls/<n> --header Accept:application/vnd.github.diff` | patch 文本 | Tab 内折叠展示，按需懒加载 |

**调用数估算：** 列表 1 次/页（500 条内 1-5 次），详情 1 次/票；与现有 Issue 通路调用量同阶，GraphQL cost 每查询 1 point，5000/hour 足够。

### 4.2 读写档：评论 / 关闭 / 合并（需写权限，风险更高）

> 目标：在只读基础上，允许评论、关闭 PR、合并 PR（merge）。

| 能力 | 最小调用 | 备注 |
|---|---|---|
| 评论 | `gh api repos/{o}/{r}/issues/{n}/comments --method POST -f body="..."`（与 Issue 评论同一接口） | 或 `gh pr comment <n> --body "..."`；review comment 另需 `/pulls/{n}/comments` |
| 关闭 | `gh pr close <n>` 或 `gh api repos/{o}/{r}/pulls/{n} --method PATCH -f state=closed` | 关闭后 state=CLOSED，mergedAt 仍 null |
| 重新打开 | `gh pr reopen <n>` |  |
| 合并 | `gh pr merge <n> --merge / --squash / --rebase` 或 `gh api repos/{o}/{r}/pulls/{n}/merge --method PUT` | 需写权限 + 分支保护检查；失败返回 405/409 |
| 设为草稿 / 就绪 | `gh api graphql` → `convertPullRequestToDraft / markPullRequestReadyForReview` | GraphQL mutation，非 REST |
| 请求评审 | `gh api repos/{o}/{r}/pulls/{n}/requested_reviewers --method POST` |  |

**与 Issue 读写差异：** Issue 的 `create/close/reopen/update/setLabels/setAssignees/setParent/setBlockedBy` 中，PR 仅复用 comment/close/reopen/labels/assignees；parent/blockedBy 对 PR 无意义；merge 为 PR 独有。

---

## 5. 对现有 normalize 的影响与推荐

### 5.1 字段异同与复用度

| 字段 | Issue 有 | PR 有 | 是否可复用 `ISSUE_FRAGMENT` |
|---|---|---|---|
| number → key=String(number) | ✅ | ✅ | ✅ 完全复用；但同号段冲突需外层分流（见 §8） |
| title/body/url/createdAt/updatedAt/closedAt | ✅ | ✅ | ✅ 直通 |
| state | OPEN/CLOSED | OPEN/CLOSED/MERGED | ⚠️ 需扩展：normalize 增加 MERGED→ 归一为 `closed` 或新增 closedReason=merged；推荐映射为 `state=closed + reason=merged`（保持两态 UI 兼容） |
| author/assignees/labels/milestone/comments | ✅ | ✅ | ✅ 复用；PR 的 assignees/labels 语义一致 |
| parent / blockedBy | ✅ | ❌（PR 无 sub_issues / blockedBy 语义） | 不取；PR 查询不含这两字段 |
| mergedAt/isDraft/reviewDecision/mergeable/mergeStateStatus | ❌ | ✅ | ❌ 需新增 PR 专有字段，归一到新 shape |
| baseRefName/headRefName/additions/deletions/changedFiles | ❌ | ✅ | ❌ 新增 |
| reviews/reviewRequests | ❌ | ✅ | ❌ 新增（评论的第二形态） |

**复用结论：** 基础 10 字段复用度 ~70%，PR 专有字段 ~30% 不可复用；强行合并 Fragment 会导致查询过大、空字段污染与状态歧义。

### 5.2 推荐：新增而非合并

**推荐：新增 `LIST_PR_QUERY` + `PR_FRAGMENT` + `GET_PR_QUERY`，与 `LIST_QUERY` 并行。**

理由：

1. **状态语义不同**：Issue 两态 vs PR 三态（MERGED），合并会污染现有 `STATE` 枚举与 deck 统计。
2. **字段集合不同**：PR 不需要 `parent/blockedBy`，Issue 不需要 `isDraft/mergeable`；合并查询每次多取 8+ 字段且半数为空。
3. **分页隔离**：两集合独立分页游标；合并查询需在同一仓库下请求两个连接，错误归因困难。
4. **契约清晰**：`contract.js` 中 `list` 已约定按 `filter` 过滤，增加 `filter.kind = 'pr' | 'issue'`（或新增 `listPR`）比在同一查询中多态更易测试。
5. **增量成本低**：新增文件 `queries-pr.js` 或在 `queries.js` 追加 30 行即可，normalize 新增 `normalizePR()` 与 `normalizeIssue()` 并列，不触现有 harness 断言。

**不推荐合并查询示例（反模式）：**

```graphql
# 反模式：同一查询混取，失败耦合、字段冗余
query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    issues(...){ nodes{ ...ISSUE_FRAGMENT } }
    pullRequests(...){ nodes{ ...ISSUE_FRAGMENT ...PR_FIELDS } }
  }
}
```

问题：任一子查询错误导致整体 `errors` 非空；空字段（PR 的 parent=null）误导 UI。

**推荐形状（契约扩展草案）：**

```js
export const PR_FRAGMENT = [
  'number','title','state','body','url','createdAt','updatedAt','closedAt',
  'mergedAt','isDraft','reviewDecision','mergeable','mergeStateStatus',
  'baseRefName','headRefName','additions','deletions','changedFiles',
  'author{login name avatarUrl __typename}',
  'assignees(first:50){nodes{login name avatarUrl __typename}}',
  'labels(first:50){nodes{name color description}}',
  'milestone{title description state dueOn}',
  'comments(first:50){nodes{id author{login name avatarUrl __typename} body createdAt updatedAt}}',
].join(' ')

export const LIST_PR_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(first:$first, after:$after, states:[OPEN,CLOSED,MERGED], orderBy:{field:UPDATED_AT, direction:DESC}){
      nodes{ ${PR_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`
```

`shape.js` 扩展建议：`PR extends Issue`，新增可选字段 `mergedAt: string|null, isDraft: boolean, reviewDecision: string|null, mergeable: 'MERGEABLE'|'CONFLICTING'|'UNKNOWN', baseRefName, headRefName`。

---

## 6. 风险清单

| 风险 | 现象 | 影响 | 已有缓解 | 建议 |
|---|---|---|---|---|
| **限流** | REST 429 / GraphQL `API rate limit exceeded`（403 伪装） | 列表/详情失败，snapshot 空 | `classifyGhError` 已将 `rate limit|429|api rate limit exceeded` 归为 `RATELIMIT`，顺序在 auth 之后、not-found 之前 | 复用该分类；UI 显示“稍后重试”，不缓存失败（snapshot 已不缓存 ok:false） |
| **GHE 不支持** | GHES 老版本无 `pullRequests` 或 `mergeable` 字段；GraphQL 返回 `Field 'pullRequests' doesn't exist` | list 整体失败 | 复用 `UNSUPPORTED` 分支（graph.js 对 sub_issues 的 unsupported 判定同理） | 捕获 `errors[0].type==FIELD_NOT_FOUND` 时返回 `{ok:false, error:{kind:'unsupported'}}`，Tab 隐藏 |
| **同号段冲突** | PR #287 与 Issue #287 同号（实测：`GET /issues/287` 返回的 html_url 指向 `/pull/287`，且 body 含 PR 描述） | `key=String(number)` 唯一性在“同仓库”维度被打破；`issueUrl(287)` 构造歧义（`/issues/287` vs `/pull/287`） | 现有 `describe().url` 仅拼 issues 链接 | 契约扩展时 `key` 需带命名空间或类型前缀（推荐 UI 层用 `pr:287` vs `issue:287`，存储仍 `String(number)` 但跳转按类型分流） |
| **分页上限** | Issue 通路安全上限 500 条；PR 同理 | 大仓库截断 | `issues.js` 中 `if(all.length>=500) break` | PR 通路复用同一上限；超量提示“仅显示前 500” |
| **网络失败** | 超时 30s、DNS、TLS | `NETWORK` | `client.js` 已透传 signal/timeout，`classifyGhError → classifyError → network` | 保持不抛、返回 OpResult；UI 走现有 snapshot 错误态 |
| **权限不足** | 私有仓库未授权、token 无 repo 权限 | 401/403 → AUTH | 已分类 | 引导 `gh auth login`，文案复用现有 preflight prompt |
| **MERGED 状态误判** | 将 MERGED 当 OPEN 统计进 frontier/blocked | deck 统计失真 |  | normalize 将 MERGED 归一为 closed，或在 deck 中单独统计 merged |

---

## 7. 分页 / 限流 / 认证错误分类实测

- **分页**：GraphQL `first:2` 返回 `pageInfo{hasNextPage:true, endCursor:"Y3Vyc29y…"}`，与 Issue 通路一致；REST `--paginate` 对 pulls 可用（取到 287/275/273/106 四条）；gh CLI `--limit` 默认 30，上限 100。
- **限流**：`gh api rate_limit` → core 5000 / graphql 5000；实测 `cost:1, remaining:4761, limit:5000`；超过后 GitHub 返回 403 `API rate limit exceeded`，现有正则已覆盖（注意 403 需先判 rate-limit 再判 auth，顺序已固定）。
- **认证**：未登录时 `gh api graphql` stderr 含 `not logged in` / `Bad credentials` / `401`，归 `AUTH`；权限不足 `403` 同理。
- **不存在**：`GET /repos/.../pulls/99999` 返回 404，归 `NOTFOUND`；GraphQL `pullRequest(number:99999)` 返回 `null`，需调用方判空后返回 not-found。
- **解析**：gh 输出非 JSON 时归 `PARSE`。

错误分类顺序（`errors.js` 已定版，不变量 II）：`已规范 TrackerError 透传 → env(gh not found) → auth(401/403) → rate-limit(429/rate limit) → not-found(404) → parse → network 兜底`。PR 通路直接复用，无需新增正则。

---

## 8. 同号段问题详解

**事实：** GitHub 的 Issue 与 PR 共享同一编号空间（number sequence）。

- 实测：`gh pr list` 返回 287/275/273；`gh issue list` 返回 294/293/292；但 `gh api repos/.../issues/287` 返回的 `html_url` 是 `.../pull/287` 且含 `pull_request: {diff_url, patch_url}`，证明 287 号既是 Issue 接口可达，也是 PR。
- `gh api repos/.../pulls` 与 `.../issues?state=all` 在 287 号上返回同一标题 `fix: toast 弹窗亮色主题下不可见`。
- URL 构造差异：Issue 跳转应为 `https://github.com/{owner}/{repo}/issues/{number}`，PR 为 `.../pull/{number}`；现有 `BackendModule.issueUrl` 仅拼 issues，若对 PR 号复用会 404 或跳错页。

**对 `key=String(number)` 的影响：**

- 若快照同时包含 issues 与 pullRequests，`key="287"` 将出现两条不同类型的实体，主键冲突。
- **推荐：** 存储层保持 `key=String(number)`（满足 harness），但在上层引入类型命名空间：
  - 选项 A（推荐）：UI 路由带类型前缀 `#/pr/287` vs `#/issue/287`，后端返回的 `url` 字段已区分（`/pull/287` vs `/issues/287`），跳转直接用 `url` 不自拼。
  - 选项 B：契约扩展 `Issue.key` 为 `pr:287`，但会破坏现有两态 UI 与 `parentKey` 关联，需全量迁移，不推荐。

**对 `getIssue / getPR` 的影响：** 需独立方法 `getPR(repo, key, ctx)`，不可复用 `GET_QUERY` 的 `issue(number:$number)` 节点（该节点对 PR 号返回 null）。

---

## 9. 复用度总结与推荐调用形状

### 9.1 复用度打分

- GraphQL 查询结构：★★★★★（分页、pageInfo、orderBy 完全同构）
- ghClient / 超时 / 错误归一：★★★★★（直接复用）
- normalize 基础字段：★★★★☆（70% 复用，30% PR 专有）
- contract / snapshot 编排：★★★☆☆（需新增分支或独立 Tab，不宜混入现有 snapshot）

### 9.2 推荐落地路径（两阶段）

**阶段一（只读，低风险）：** 新增 `queries-pr.js`（或在 `queries.js` 追加）+ `normalize-pr.js` + `prs.js`（listPR/getPR），复用 `client.js/errors.js`；UI 新增独立 `PR Tab`（能力门控下可见），不改现有 Issue 快照与 deck。

**阶段二（读写，按需）：** 在 `prs.js` 增加 `commentPR/closePR/mergePR`，复用现有 comment/close 的 gh 调用，仅 merge 需 PAT 写权限与分支保护处理；失败一律 `OpResult{ok:false}` 诚实回退。

### 9.3 不做事项

- 不在同一 GraphQL 查询中合并 issues + pullRequests。
- 不把 MERGED 塞入现有 STATE.OPEN/CLOSED 两态统计（单独处理）。
- 不改 `ISSUE_FRAGMENT`（保持 harness 稳定）。

---

## 10. 附：探查命令清单（可复现）

```powershell
# 列表
gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/pulls --jq "length"
gh pr list --json number,title,state,url --limit 3
gh issue list --json number,title,state,url --limit 3

# GraphQL 列表
gh api graphql -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(first:2,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title state mergedAt isDraft reviewDecision mergeable url} pageInfo{hasNextPage endCursor}}}}' -F owner=FeatherHunter -F name=dsh-mattpocock-skills-deck

# 详情
gh api graphql -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number title state body url createdAt updatedAt closedAt mergedAt isDraft reviewDecision mergeable mergeStateStatus author{login __typename} labels(first:10){nodes{name}} comments(first:5){nodes{body}}}}}' -F owner=FeatherHunter -F name=dsh-mattpocock-skills-deck -F number=287

# 同号段验证
gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/287 --jq "{html_url, pull_request}"
gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/pulls/287 --jq "{number, state, merged, draft}"

# 限流
gh api rate_limit --jq ".resources.core"
gh api graphql -f query='query{rateLimit{limit cost remaining resetAt}}'
```

---

> 结论供 #288 讨论域与后续契约扩展（PR shape / listPR 契约）直接引用；实现前需经讨论票拍板是否新增独立 PR Tab 与命名空间策略。
