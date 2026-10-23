# src/tracker/rooms — 后端适配器（主缝实现）

每个后端 = 一个目录，**严格对照 `src/tracker/contract/index.ts` 的 `Tracker` 接口**实现。
本层是本 MAP（定稿 Tracker 契约）产出；**各后端实现归对应子图**：

| 后端 | 目录 | 归子图 | CLI |
|---|---|---|---|
| GitHub | `github/` | 定稿 GitHub 后端（#114） | `gh` |
| 本地 Markdown | `markdown/` | 定稿本地 Markdown 后端（#115） | 直接读写 `.scratch/` | 
| GitLab | `gitlab/` | 定稿 GitLab 后端（#116） | `glab` |
| 第三方示例 | `examples/demo-mini/`（**不在**本目录，不默认装配） | 立第三方扩展范式（#117 #148 demo-mini） | 内存/文件（示例） |

## 一个后端目录的构成（按操作域拆文件，避免单文件过大、AI 不漏分支）

- `index.js` — 薄适配器：把下列各文件装成一个 `Tracker` 实现，对外只暴露这个。
- `client.js` — CLI 封装（resolve / 超时 / terminate）。本地 markdown 无，用 `path/read/write`。
- `queries.js` — 查询/片段（GitHub GraphQL / GitLab 查询）。本地 markdown 无。
- `normalize.js` — 后端原始形状 → 契约标准形状（`src/shared/tracker/shape.js`）。**每个后端必有**。
- `errors.js` — 后端错误 → 契约 `ERROR_KIND`（本地 markdown 无，复用 `preflight.classifyError`）。
- `preflight.js` — 探测/登录/API 可达（`BackendStatus`）。
- `issues.js` — list / get / create / close。
- `comments.js` — list / create。
- `labels.js` — list / create（本地 markdown 无 labels → 省略字段 = MISSING）。
- `graph.js` — subIssue / blockedBy / blocking（图关系）。

## 契约三规则（实现时务必遵守，见 `src/tracker/contract/index.ts`）

1. 完整形状：`interface` 声明全部字段；后端归一化补齐，缺的用 `[]`/`''`/`null`。
2. EMPTY vs MISSING：能实现但来源无 → EMPTY；**不能实现 → 省略字段（MISSING）**＝能力缺失。
3. 日志二分：host 记录归一化后每字段填/空；不引入运行期内省或能力分支。

## 房间纪律（#326 承接 #313 D1-D6）

两条纪律，CI 硬卡，本地 npm run verify 可复现。

纪律一：代码门禁 —— 禁止跨房引用（判据门禁 tests/verify-dependency-rules.ts；规则在根目录 .dependency-cruiser.ts，起点按 `src/tracker/rooms/([^/]+)/` 抓房名，不写死哪几间房）

- 扫描域：src/tracker/rooms/<名字>/ 下的内置后端（今天三座：github、gitlab、markdown），两两禁止相互 import；examples/demo-mini 等第三方扩展不在域内。
- 检查对象：静态 import / export ... from 与动态 import('...') 的字面量说明符；每条违规输出文件、行号、目标房间。
- 规则自己实现的两种放行（不是登记表条目，也不该写进登记表）：
  - node 内置模块（含 node: 前缀与裸名如 path / fs）
  - 同房间内的相对路径（规则用 `$1` 按起点抓到的房名放行，解析后仍在同一间房内）
- 其余房外目标一律要在登记表里逐条放行，登记表只有一份：`tests/tracker-room-imports.json`（每条 `pattern` / `why` / `ticket` 三样齐全，条数上限只许减）。少理由、匹配不到任何源码文件、把受保护的房间目录整个吃掉，门禁都会当场判红。为什么放在那份 JSON 里而不是配置里：dependency-cruiser 对配置的顶层键做白名单校验，多一个自定义键就拒绝启动。来龙去脉见 `docs/adr/20261014-tracker-room-boundary.md`。
- 放行的房外目标分四类（具体 pattern 以那份 JSON 为准，本文件不抄）：**契约层** `src/tracker/contract/`（纯类型与数据的公共面）、**共享内核** `src/tracker/kernel/`（房间与宿主都要用的判定件，见 `src/tracker/kernel/README.md`）、**共享模块** `src/shared/`、**已登记的宿主目录** `src/host/**`（今天只剩 github 房引宿主出站控制面与搭车账本两处，收口口径见 #1159）。
- 纪律：后端文件的引用说明符必须是字面量字符串（import(someVar) 视为违规）；host 主程序引用后端（如 #284 复用 markdown 解析）不在检查范围。

纪律二：会话门禁 —— 一次会话只改一房（verify-no-mixed-session）

- 判定对象：PR 的全量改动清单（base...head），非单次提交。
- 房间口径：仅 src/tracker/rooms/<name>/** 属于房间文件；tests/、契约测试夹具、src/shared/** 等不归属任何房间。
- 无对比基准（如 push 到主分支、浅克隆取不到 base）时自动跳过，不报失败。
- 失败时输出混入的房内文件清单（按房间分组）。

跨房 = 拆票，无豁免

不设豁免标记、例外名单；跨房事务按纪律拆成两张票、分次实施。仅改公共文件（如 src/shared/**）不会触发会话门禁，因此「抽公共代码」可合法进行。

常驻位置

两条纪律的判据都常驻在 `tests/verify-dependency-rules.ts`（CI 硬卡）。房间能引哪些房外目录，唯一真源是 `tests/tracker-room-imports.json` —— **本文件只指路，不抄第二份**。抄两份正是 #1136 这次漂移的机制：规则起点指着搬家前的旧目录、白名单留在说明文档里没人对账，两边都过时了而门禁还是绿的。新增共享依赖要改的是那份 JSON，并在票据留痕（#313 D2）。

## 第三方扩展（#117 #148 范式）

第三方（Jira/Linear/Gitea/自建等，非一等后端）**不在** `src/tracker/rooms` 内，按 `examples/demo-mini/` 样板照抄：

- 五件套 `BackendModule{id/label/create/matches/budget}`（预算口径规格 1439 起必填） + Proxy 自动桩（缺 op → `unsupported`）+ `matches:boolean` + `Disposable/on/describe/MIGRATE_KEY`，见 `src/tracker/registry/core.ts`（装配与仲裁；形状包桩在 `shape.ts`、只读视图在 `views.ts`，V1 #461 拆分）与 `docs/architecture/third-party-tracker.md` §3-4。
- 探测 `cwd/.demo/config.json` 或 `.scratch/map.md`（`platform.fs`，超时由 registry 托管、缺省 30 秒见 `src/tracker/registry/core.ts` 的 `MATCHES_TIMEOUT_MS`，`pending:true` 不静默 Other），能力字段 `EMPTY vs MISSING`（`src/shared/tracker/shape.js` + `src/host/tracker/capability.js`）。
- 契约测试即公开验收面：`tests/tracker-contract/harness.js` + `runner/runPlayback` + `examples/demo-mini/fixtures/demo-real/`，织入 `tests/verify-tracker-contract.js`。现值是 `620 passed / 4 failed / CONTRACT SKELETON OK`（退出码 0）——**不要把这个数字当门槛**，断言总数每张票都会增长；是否过关的判据是 `CONTRACT SKELETON OK`，加上违规桩里按名字点名的那 4 条失败必须出现（名字见 `tests/verify-tracker-contract.js` 末尾的 `VIOLATING_EXPECTED_FAILURES`）。
- 打包：`examples/` 不进 `files` 白名单，`dsh.contributes.trackers` 预留，`Disposable` 按代隔离 HMR。

详见 **第三方指南**：`docs/architecture/third-party-tracker.md`（主入口，含注册/探测/能力/测试/打包/更新六章 + 接真实工具 Checklist）。

## 访问 OS 只经 platform（#113）

后端不得直接 `ctx.get('fs')`/`path.join`/硬编码分隔符；一律经 `src/host/platform`（`createPlatform(ctx)`，
`#113` 实现）。这消除 `#110` 那类「getHome 只认 Windows / 反斜杠硬编码」bug。
