# 研究：协议层作者字段与能力语义调查（#237）

> 任务：验证契约层是否已有可供前端无分支消费的作者字段，明确 MISSING vs EMPTY 语义与多后端归一化差异。仅引 primary sources 行号，禁止推测。

## 1. 字段定义（shape.js）

**文件：** `src/shared/tracker/shape.js`

- L7 注释能力字段清单含 `author`
- L47-L58 定义 `Actor = {login, kind?, name?, avatarUrl?}`（L47 ` * 参与人。`, L52 ` * @typedef {Object} Actor`, L53 ` * @property {string} login`, L54 ` * @property {ActorKind} [kind]`, L56 ` * @property {string} [name]`, L57 ` * @property {string} [avatarUrl]`）
- L72-L77 `Comment.author: Actor` 必填，L132 `Issue.author?: Actor` 能力字段可选（L132 ` * @property {Actor} [author] 创建者（provenance）`）
- L112-L114 注释 能力字段可 MISSING，L121-L135 Issue 形状核心字段永远存在、能力字段可省略
- L186-L188 `BackendId` 开放 string，非枚举

**文件：** `src/shared/tracker/constants.js:57-61` `ACTOR_KIND` 保留值 `user|bot|organization`

**文件：** `docs/architecture/tracker-backend-normalized-model.md:18-22,67`
- L67 `author?: Actor // 创建者（provenance）`
- L18-L22 能力字段真不能实现 → 省略（MISSING）；能实现 → 填值或 EMPTY（`[]/''/null`）

## 2. 能力语义（MISSING vs EMPTY）

**文件：** `src/host/tracker/capability.js`

- L42-L48 `diagnoseCapabilities(issue)` 对每能力字段写日志，MISSING 时写 `<absent>` 别名（文档别名）或代码 `MISSING`，EMPTY 时写 `EMPTY`
- L19-L28 `hasField` 以 `field in issue` 判 MISSING，`isEmpty` 判 EMPTY

**文件：** `docs/architecture/tracker-backend-normalized-model.md:22`
- 文档别名 `<absent>` 对应代码 `MISSING`，判定依据=后端能力非单次结果

**文件：** `src/host/tracker/contract.js:9-14`
- 能力 = 事后事实，无能力表

**Harness：** `tests/harness.js:79-110` 强验 `implementedFields → EMPTY` 与 `missingFields → MISSING`

| 语义 | 检测式 | 日志 | 示例 |
|------|--------|------|------|
| MISSING | `!('author' in issue)` | `<absent>` | Markdown 恒省略 |
| EMPTY | `'author' in issue && !issue.author.login` | `EMPTY` | 异常空 login |
| 有值 | `issue.author.login !== ''` | 值 | GitHub 正常 |

正确检测式必须为 `'author' in issue && issue.author && issue.author.login`，不可写 `!issue.author`（会误判 EMPTY 为 MISSING）。

## 3. 三后端归一化对比

### 3.1 GitHub

- `src/host/tracker/backends/github/queries.js:23` `'author{login name avatarUrl __typename}'`（来源全覆盖）
- `src/host/tracker/backends/github/normalize.js:48-53` `kindFromTypename`：`Bot→bot, Organization→organization, 其他→user`
- `src/host/tracker/backends/github/normalize.js:55-66` `normalizeActor` 兼容 `avatarUrl/avatar_url`，`login` 空 → `null`
- `src/host/tracker/backends/github/normalize.js:206-209` `const authorRaw = raw && (raw.author || raw.user); const author = normalizeActor(authorRaw); if (author) issue.author = author` — 有则对象，无则省略（MISSING）

### 3.2 GitLab

- `src/host/tracker/backends/gitlab/normalize.js:86` `username→login`（`const login = typeof rawAuthor.username === 'string' ? rawAuthor.username : ...login`）
- `src/host/tracker/backends/gitlab/normalize.js:274-277` `if (author) issue.author = author` 同 MISSING 语义
- 本次 `#241` 决策：GitLab 暂 MISSING（不在此实现）

### 3.3 Markdown

- `src/host/tracker/backends/markdown/normalize.js:6` `if('author' in issue) delete issue.author` 恒 MISSING，理由本地文件无溯源（见 `docs/architecture/markdown-backend-*.md`）
- 第三方 demo：`examples/demo-mini/normalize.js:150` 默认 `missingFields: ["author", ...]` → MISSING

## 4. 前端零分支渲染

- `src/shared/tracker/shape.js:9` “空值由 UI 按现有渲染逻辑处理，不新增隐藏逻辑”
- `src/host/tracker/contract.js:9-14` 无能力表、`src/host/tracker/capability.js:9-10` G5
- 判定：`'author' in issue && issue.author && issue.author.login` 显隐，禁 `backendId === 'github'`
- 示范：`src/client/views/IssueDetail.js:150-154` 头部 `src.author && src.author.login && h('span', {}, [avatarUrl ? img : Ic(person), '@'+login])`

## 5. 缺口清单

| 位置 | 现状 | 证据 |
|------|------|------|
| IssueDetail 头部 | 已覆盖 | `IssueDetail.js:150-154` |
| IssueDetail 评论 | 已覆盖 | `IssueDetail.js:200,206` |
| ListTab 列表行 | 未消费 | `grep author src/client/views/ListTab.js → 0` |
| MapDetail 地图节点 | 未消费 | `grep author MapDetail.js → 0` |
| TicketRow 子票行 | 未消费 | 同上 |

**建议**：在 ListTab 与 MapDetail 各增一处 `'author' in t && t.author.login && h('span', {class:'dsws-author'}, '@'+t.author.login)` 胶囊，头像仅详情保留，列表文本优先。

## 附：来源清单

- `src/shared/tracker/shape.js:7,47-58,72-77,112-114,121-135,132`
- `src/shared/tracker/constants.js:57-61`
- `src/host/tracker/backends/github/normalize.js:48-53,55-66,206-209`
- `src/host/tracker/backends/gitlab/normalize.js:86,274-277`
- `src/host/tracker/backends/markdown/normalize.js:6`
- `src/host/tracker/capability.js:42-48`
- `docs/architecture/tracker-backend-normalized-model.md:18-22,67`
- `src/client/views/IssueDetail.js:150-154,200,206`
