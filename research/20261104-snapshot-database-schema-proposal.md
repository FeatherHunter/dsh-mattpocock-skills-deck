# 工作区快照数据库：表结构方案（提案，2026-11-04）

> 2026-11-04 用户已「认同」（m00390）。讨论共识见 `research/20261104-snapshot-consensus.md`；下一步由用户手动 `/to-spec` 写成规格 issue。

这是一份讨论用的提案，不是规格。用户已把「表怎么设计」交给 AI 设计，本文给出裁决、完整表结构与对抗式审查。定稿后由用户手动 `/to-spec` 写成规格 issue。

## 0. 结论先行

- **Q-I（字段怎么落表）**：核心字段与能力字段逐项成列；标签、指派、评论、评审成子表；只有「开放形状、不参与查询」的少量字段（里程碑、自定义字段、本地 Markdown 的状态冲突记录）用 JSON 列。
- **Q-K（关系边）**：一张边表，两种边（父子、阻塞）同构；方向统一为 subject → object；反向查询靠索引。不在 issue 行内放数组。
- **Q-L（评论粒度）**：评论独立表，按 position 排序；另记该 issue 评论组的完整度与分页游标。
- **三态落法（Q-J 的 B）**：每组一行「组状态」记录：`complete`（空 = 确认没有）／`truncated`（只有一部分）／`unknown`（附原因）。没有这行 = 不知道。

## 1. 第一性原理：库里必须始终成立的事

1. **断网可用**：任何界面首帧，只读这个库就能画；网络只用来补新。
2. **可追溯**：每个值都能说出「来自哪次查询、哪个渠道、什么时候」；旧不是错，错的是冒充新。
3. **诚实**：没取到 = 不知道；取到且为空 = 确认没有。两者在库里必须分得开。
4. **增量**：改 10 张票只写 10 张票的行；一轮刷新是一个事务。
5. **原子**：崩溃后要么是上一轮的状态，要么是这一轮的状态，不出现半轮。
6. **不误删**：只有证明「这次枚举完整」的来源才允许删除；截断或没表达的来源只补空缺。
7. **单写者**：一个工作区同一时刻只有一个写入者，其他会话只读；读永远不挡写。
8. **形状不撒谎**：后端没有的能力写「不知道/不适用」，不写成空值。

## 2. 为什么是 SQLite，为什么归一化

- SQLite 随 Node 内置（`node:sqlite`），没有原生依赖、不用按 Electron ABI 重编译；单文件、事务、WAL、崩溃恢复都是现成的。LMDB / LevelDB / better-sqlite3 全部要原生模块，插件分发不可行。
- 归一化表（而不是每条票一个 JSON 块）的理由是**查询模式**：列表要按状态/更新时间筛，详情要 join 标签、指派、评论、评审，关系要按「父是谁/谁阻塞我/我阻塞谁」双向查。JSON 块能存但不能高效 join，且分组替换要反序列化整行再写回——写放大与 JSON 文件方案一样，还多一层并发控制。
- 正文单独一张表：列表查询永远不该读几十 KB 的正文；SQLite 行超过一页会走溢出页，把热点表做窄是白赚的。

## 3. 完整表结构

```sql
PRAGMA journal_mode = WAL;          -- 网络盘回退 DELETE
PRAGMA synchronous = NORMAL;        -- 数据可重取，接受掉最后一条事务
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA user_version = 1;

-- 库级元信息：一行。schema 版本、身份、合并版本、写者租约。
CREATE TABLE meta (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version    INTEGER NOT NULL,
  backend           TEXT NOT NULL,   -- github / markdown / gitlab
  repo_identity     TEXT NOT NULL,   -- 后端给的身份：GitHub owner/name、GitLab path、markdown 工作区根
  workspace_root    TEXT NOT NULL,
  merge_version     INTEGER NOT NULL DEFAULT 0,
  last_write_ms     INTEGER NOT NULL DEFAULT 0,
  lease_owner       TEXT,            -- 写者标识（会话 id）；空 = 没人持有
  lease_heartbeat_ms INTEGER,
  lease_expires_ms  INTEGER
) STRICT;

-- 参与人：作者、指派人、评论作者、评审人共用一行，按登录名唯一。
CREATE TABLE actor (
  actor_id    INTEGER PRIMARY KEY,
  login       TEXT NOT NULL,
  kind        TEXT,
  name        TEXT,
  avatar_url  TEXT
) STRICT;
CREATE UNIQUE INDEX actor_login ON actor(login);

-- 票的骨架：身份 + 能成列的字段。取不到的列留 NULL，是否「知道」看 issue_group。
CREATE TABLE issue (
  issue_id           INTEGER PRIMARY KEY,
  effort_id          TEXT NOT NULL,      -- 本地 Markdown 的工作单元目录名；GitHub/GitLab 写 ''
  key                TEXT NOT NULL,      -- 票号字符串
  type               TEXT,               -- issue / map / spec；NULL = 不知道
  title              TEXT,
  state              TEXT,               -- open / closed；NULL = 不知道
  url                TEXT,
  created_at_ms      INTEGER,
  updated_at_ms      INTEGER,
  closed_at_ms       INTEGER,
  reason             TEXT,               -- 关闭原因（仅 closed）
  author_id          INTEGER REFERENCES actor(actor_id),
  is_pull_request    INTEGER,            -- 0/1；NULL = 不知道
  merged_at_ms       INTEGER,            -- mergeInfo 组
  comment_count      INTEGER,            -- comments 组的总数
  sub_total          INTEGER,            -- subIssues 组
  sub_completed      INTEGER,
  sub_percent        INTEGER,
  milestone_json     TEXT,               -- 开放形状、不参与查询
  custom_fields_json TEXT,               -- 开放形状、不参与查询
  status             TEXT,               -- 本地 Markdown 的 triage 语义
  status_visible     TEXT,
  status_source      TEXT,
  status_conflict_json TEXT,
  first_seen_ms      INTEGER NOT NULL,
  last_seen_ms       INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX issue_identity ON issue(effort_id, key);
CREATE INDEX issue_state_updated ON issue(state, updated_at_ms DESC);
CREATE INDEX issue_type ON issue(type);

-- 正文单独放：列表查询不碰它。
CREATE TABLE issue_body (
  issue_id INTEGER PRIMARY KEY REFERENCES issue(issue_id) ON DELETE CASCADE,
  body     TEXT NOT NULL
) STRICT;

-- 字段组的「知识状态」：一行代表这个 issue 的这组数据最近一次被表达的完整度。
-- 没有行 = 从没取到过，界面显示「不知道」。
CREATE TABLE issue_group (
  issue_id        INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  group_name      TEXT NOT NULL,   -- row/body/labels/parents/dependencies/subIssues/comments/review/mergeInfo
  completeness    TEXT NOT NULL CHECK (completeness IN ('complete','truncated','unknown')),
  reason          TEXT,            -- unknown 时：not-expressed / not-applicable / unreadable
  source          TEXT,            -- 实际渠道：graphql / rest / markdown-files / gitlab-api …
  operation       TEXT,            -- 哪条读操作：list / get / listComments …
  last_queried_ms INTEGER NOT NULL,
  written_version INTEGER NOT NULL,-- 写入时的合并版本，用于留后门做版本门
  PRIMARY KEY (issue_id, group_name)
) STRICT, WITHOUT ROWID;

-- 标签：名字唯一；颜色/说明是可展示的补充信息。
CREATE TABLE label (
  name        TEXT PRIMARY KEY,
  color       TEXT,
  description TEXT
) STRICT, WITHOUT ROWID;

CREATE TABLE issue_label (
  issue_id   INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  label_name TEXT NOT NULL REFERENCES label(name),
  position   INTEGER NOT NULL,
  PRIMARY KEY (issue_id, label_name)
) STRICT, WITHOUT ROWID;

CREATE TABLE issue_assignee (
  issue_id INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES actor(actor_id),
  position INTEGER NOT NULL,
  PRIMARY KEY (issue_id, actor_id)
) STRICT, WITHOUT ROWID;

-- 边表：父子与阻塞同构，一行一条边，只存一个方向。
-- kind='parent'：subject 的父票是 object（父票永远最多一条）。
-- kind='blocks'：subject 被 object 阻塞（object 是阻塞者）。
-- 「我阻塞了谁」= 查 object=我、kind='blocks'；「谁阻塞我」= 查 subject=我。
CREATE TABLE issue_edge (
  subject_id INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  object_id  INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('parent','blocks')),
  PRIMARY KEY (subject_id, kind, object_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX edge_object ON issue_edge(object_id, kind);

-- 评论：后端 id 可能给不出来，所以本地行号当主键，后端 id 单独一列。
CREATE TABLE comment (
  row_id             INTEGER PRIMARY KEY,
  issue_id           INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  backend_id         TEXT,
  author_id          INTEGER REFERENCES actor(actor_id),
  author_association TEXT,
  body               TEXT NOT NULL,
  created_at_ms      INTEGER,
  updated_at_ms      INTEGER,
  edited_at_ms       INTEGER,
  position           INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX comment_backend_id ON comment(issue_id, backend_id) WHERE backend_id IS NOT NULL;
CREATE INDEX comment_order ON comment(issue_id, position);

-- 评审：契约里没有评审 id，按顺序存，整组替换。
CREATE TABLE review (
  issue_id       INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  state          TEXT NOT NULL,
  reviewer_id    INTEGER REFERENCES actor(actor_id),
  submitted_at_ms INTEGER,
  PRIMARY KEY (issue_id, position)
) STRICT, WITHOUT ROWID;

-- 分页游标：评论等按页取的组，下次从哪继续。
CREATE TABLE fetch_cursor (
  issue_id   INTEGER NOT NULL REFERENCES issue(issue_id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  cursor     TEXT NOT NULL,
  updated_ms INTEGER NOT NULL,
  PRIMARY KEY (issue_id, group_name)
) STRICT, WITHOUT ROWID;
```

### 3.1 命名与类型约定

- 时间一律存 UTC 毫秒整数（契约里的 ISO 字符串在「读入/投影」两侧转换）；只有「日期」语义的字段（里程碑到期日）保留 `YYYY-MM-DD` 文本。
- 所有表 `STRICT`：类型写错直接报错，不静默存进去。
- 主键用整数代理键：票号不是整数（本地 Markdown 两位数、GitLab iid），唯一身份是 `(effort_id, key)`；代理键让 join 与边表更小。
- `issue` 行可能是一个「引用骨架」：别的票的依赖边提到它、但它自己没被完整取过。这种行没有 `row` 组记录，所有列表/详情查询必须 join `issue_group` 的 `row` 组为 `complete` 才显示；它的标题/状态可以来自引用（IssueRef），用于把边显示成人能读的样子。

## 4. 三态怎么落（Q-J 的 B）

`issue_group` 是唯一答案：

| 库里的样子 | 含义 | 界面 |
|---|---|---|
| 有行，`complete`，值空/无子行 | 完整查过，确认没有 | 显示「没有」，不显示未知 |
| 有行，`truncated`，有值 | 只拿到一部分 | 显示已有部分 + 「不全」提示 |
| 有行，`unknown` + reason | 明确记下这次不知道（不适用/读不懂） | 显示「不适用」或「未知」 |
| 没有行 | 从来没取过 | 显示「未知」 |

合并规则由此推出：`complete` 的来源可以替换整组（含清空）；`truncated` 只补空缺、不删旧值；`unknown` 与没表达都不许删。

字段组与值的对应沿用仓内契约的九组（`row`、`body`、`labels`、`parents`、`dependencies`、`subIssues`、`comments`、`review`、`mergeInfo`），组名与 `src/refresh/kernel/snapshot-merge.ts:38` 完全一致，便于把现有合并规则搬过来。

## 5. 写路径

1. 取数前读 `meta.merge_version` 作为本趟的起读版本。
2. 拿到一批评测结果后，开一个事务：`BEGIN IMMEDIATE`。
3. 逐行按组合并：identity（key/effort）upsert；`row` 组完整才写行字段；`body` 完整才换正文；`labels` 完整才删旧标签再插；`parents`/`dependencies` 完整才删旧边再插；`comments` 完整才删旧评论再插；`review`、`mergeInfo` 同理。
4. 每写一组，更新 `issue_group` 的 `completeness/source/operation/last_queried_ms/written_version`。
5. 全批只接受一次版本门：任一「本趟表达的组」的 `written_version` 大于起读版本，整批丢弃（说明有更新的写先落库了）。
6. `meta.merge_version += 1`、`last_write_ms = 现在`，`COMMIT`。
7. 提交成功后才通知界面刷新；失败什么都不改，内存也保持旧值。

单写者：`meta` 里一行租约（`lease_owner/heartbeat/expires`）。开库时 `BEGIN IMMEDIATE` 抢租约：空或过期就接管；被活着的会话占着就只读。租约心跳 5 秒，过期 15 秒。SQLite 自身也保证「一写多读」，租约解决的是「谁来做逻辑合并」的先后，不是文件锁。

## 6. 读路径与索引

- 列表：`SELECT ... FROM issue WHERE state='open' ORDER BY updated_at_ms DESC`（`issue_state_updated`）。
- 容器子票：`SELECT subject_id FROM issue_edge WHERE object_id=? AND kind='parent'`。
- 谁阻塞我 / 我阻塞谁：`issue_edge` 主键与 `edge_object` 两个方向。
- 详情：`issue` + `issue_body` + `issue_group` + 子表按 issue_id 取；只有 `row` 组 complete 的行才当完整票展示。
- 标签/指派筛选：`issue_label`、`issue_assignee` 反查 issue_id。
- 评论分页：`comment(issue_id, position)`，游标在 `fetch_cursor`。

所有查询都用预编译语句；一次刷新一个事务；不 `SELECT *`。

## 7. 崩溃、并发、损坏、演进

- 崩溃：WAL 自动回滚未提交事务；`synchronous=NORMAL` 保证库结构一致，最多丢最后一条事务（数据可重取，可接受；要更硬就 FULL）。
- 损坏：开库跑 `PRAGMA quick_check`；坏了就整库重建（旧 JSON 不迁移，按用户决定），并记一条诊断日志。备份用 SQLite 的 `backup()`，不做文件系统复制。
- 并发：WAL 下多读一写；其他会话只读。网络盘 WAL 不可靠 → 回退 `journal_mode=DELETE`，并且仍然只允许单写者。
- 演进：`PRAGMA user_version` + `meta.schema_version`。第一版只认 1；以后升级走显式迁移或整库重建，不做「边读边猜」。
- 清理：显式「重建快照」动作 = 关闭连接、删三件套（.sqlite、-wal、-shm）、重开。引用骨架的清理另立规则（没有任何边引用、也不属于工作集时可删）。

## 8. 对抗式审查（自问自答）

1. **为什么不把整份 JSON 塞进 SQLite 一行？** 失去行级更新与 join；每次仍要读改写整块；并发控制反而更难。SQLite 的价值在事务与查询，不在「能存 blob」。
2. **为什么不用追加日志 + 定期压实？** 启动要重放历史，压实要自己实现；SQLite 的 WAL 已经替我们做了崩溃恢复。
3. **为什么每条 issue 一个 JSON + 几个索引列？** 关系查询要反序列化、组级替换要整行重写；「哪些组已知」只能塞进 JSON，失去约束。
4. **为什么边表只有一张？** 父子与阻塞都是「两个票之间有向边」，同构；两张表会让删除与反向查询各写一遍，迟早漂移。契约也写死了「blocking 不许作为字段」，边表是它的自然落点。
5. **为什么正文单独一张表？** 列表页永远不读正文；把大字段挪走，热点表就窄。
6. **为什么三态按组而不是按字段？** 取数与合并的单位就是字段组（契约九组）；按字段标记会让列翻倍，而且没有查询会问「这个字段单独知不知道」。单字段组（parents、mergeInfo）的值就是那一列，够用。
7. **为什么不用 (key) 当主键？** 票号不是整数且本地 Markdown 是两位数；`(effort_id, key)` 才是唯一身份。整数代理键让边表与 join 更小。
8. **为什么会有「引用骨架」票？** 依赖边可能提到尚未取过的票；为了把边显示出来，需要一行最小信息（key/标题/状态）。它不是完整票（没有 row 组），查询必须排除。
9. **多窗口同时开会不会写坏？** SQLite 保证单写多读；租约保证只有一个逻辑写者；版本门挡住迟到的旧结果。没有租约时最多退回只读，不会写坏。
10. **断电会怎样？** 事务原子：要么整批生效，要么整批没有。WAL 恢复后最多丢最后一条已提交事务，下一轮会重新取到。
11. **库会不会越写越大？** 删行不缩文件；定期 `PRAGMA incremental_vacuum` 或重建。日常写是页内更新，增长有限。
12. **以后后端加字段怎么办？** 开放形状进 JSON 列；需要查询/join 的才加表或加列，并升 `schema_version`；不为一次性字段改表。

## 9. 残余风险（定稿前要盯的）

- 网络盘 / 杀毒软件锁文件：WAL 回退 DELETE，抢不到租约就只读并明示。
- 超长正文（单条几百 KB）：SQLite 能存，但内存与投影要有上限；按需细节上限沿用现有 200 条 / 512KB 的口径。
- 引用骨架膨胀：需要清理规则，否则边越查越多、骨架越攒越多。
- 历史遗留：旧 JSON 文件不读不迁，原地不动；这一点已由用户决定。
- 组完整度依赖各后端如实上报：契约已有 `ReadProvenance.fieldGroups`，但本地 Markdown / GitLab 目前未必每组都表态，实施时要补齐，否则会退化成「全部 unknown」。

## 10. 待定（下一轮问用户或写进规格）

- 是否保留「按需细节」的条数/字节上限（现有 200 条 / 512KB），以及上限作用在内存还是库。
- 一次刷新事务的粒度：整轮一批，还是按字段组分批提交（当前推荐整轮一批）。
- 是否需要全文搜索（目前不需要；要的话加 FTS5 外部内容表）。
