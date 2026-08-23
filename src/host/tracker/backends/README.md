# host/tracker/backends — 后端适配器（主缝实现）

每个后端 = 一个目录，**严格对照 `host/tracker/contract.js` 的 `Tracker` 接口**实现。
本层是本 MAP（定稿 Tracker 契约）产出；**各后端实现归对应子图**：

| 后端 | 目录 | 归子图 | CLI |
|---|---|---|---|
| GitHub | `github/` | 定稿 GitHub 后端（#114） | `gh` |
| 本地 Markdown | `markdown/` | 定稿本地 Markdown 后端（#115） | 直接读写 `.scratch/` | 
| GitLab | `gitlab/` | 定稿 GitLab 后端（#116） | `glab` |

## 一个后端目录的构成（按操作域拆文件，避免单文件过大、AI 不漏分支）

- `index.js` — 薄适配器：把下列各文件装成一个 `Tracker` 实现，对外只暴露这个。
- `client.js` — CLI 封装（resolve / 超时 / terminate）。本地 markdown 无，用 `path/read/write`。
- `queries.js` — 查询/片段（GitHub GraphQL / GitLab 查询）。本地 markdown 无。
- `normalize.js` — 后端原始形状 → 契约标准形状（`shared/tracker/shape.js`）。**每个后端必有**。
- `errors.js` — 后端错误 → 契约 `ERROR_KIND`（本地 markdown 无，复用 `preflight.classifyError`）。
- `preflight.js` — 探测/登录/API 可达（`BackendStatus`）。
- `issues.js` — list / get / create / close。
- `comments.js` — list / create。
- `labels.js` — list / create（本地 markdown 无 labels → 省略字段 = MISSING）。
- `graph.js` — subIssue / blockedBy / blocking（图关系）。

## 契约三规则（实现时务必遵守，见 contract.js）

1. 完整形状：`interface` 声明全部字段；后端归一化补齐，缺的用 `[]`/`''`/`null`。
2. EMPTY vs MISSING：能实现但来源无 → EMPTY；**不能实现 → 省略字段（MISSING）**＝能力缺失。
3. 日志二分：host 记录归一化后每字段填/空；不引入运行期内省或能力分支。

## 访问 OS 只经 platform（#113）

后端不得直接 `ctx.get('fs')`/`path.join`/硬编码分隔符；一律经 `host/platform`（`createPlatform(ctx)`，
`#113` 实现）。这消除 `#110` 那类「getHome 只认 Windows / 反斜杠硬编码」bug。
