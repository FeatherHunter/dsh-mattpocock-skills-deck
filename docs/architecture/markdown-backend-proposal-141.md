# Markdown 后端实现方案（#141 一页纸）

> 来源：#140 8 文件差距 + 295 文件零合规实证 + #134 labels 兼容（MISSING）+ #129 平台抽象三底座（getHome/path/resolveExecutable/fs/env）+ 契约 §5/§2（镜像同一文件集、capability-by-fill、G4=验收）。本方案为 #142 落地唯一输入。
> 关联：[讨论：Markdown 后端实现方案](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/141) | Map：[#115 Markdown 后端：契约定版与落地](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/115)

## 0. 第一性原理（约束即设计）

- **镜像同一文件集（契约 §5）**：`.scratch/<feature-slug>/spec.md | <effort>/map.md | issues/<NN>-<slug>.md`（NN 两位零填充），行内字段 `Status:/Type:/Blocked by:` + `## Comments/## Answer`，无 frontmatter、无 labels、无 `docs/maps/`、无纯 `<number>.md`。deck 写出的文件必须仍是 matt 技能集可读的同一格式。
- **完整形状 + capability-by-fill（§2 + #127 shape.js）**：核心字段恒存在（`key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey` 缺→`''/null`），能力字段可 MISSING（`author/assignees/labels/milestone/customFields/reason/blockedBy/comments` 省略=无能力，`[]/''`=有能力无内容）。禁止布尔 `EMPTY_CAPS` 声明表；能力=运行时“后端填了什么”+“op 是否 unsupported”。
- **平台抽象为唯一 OS 真相（#129 + 契约 §3）**：所有 OS 交互只经 `ctx.platform`（`path/fs/getHome/env/resolveExecutable`），禁硬编码 `/` 或 `\`、禁直连 Node `fs`/`child_process`（需走 `ctx.get('fs')/subprocess` 沙箱封装）。
- **替代品非分层**：本地后端不强行拉平 GitHub，诚实上报 unsupported（图快照 §3.5 D2）。

## 1. 三底座综合→设计推导

| 底座 | 事实 | 推导结论 |
|---|---|---|
| #140 8 文件差距 | `index.js:20 EMPTY_CAPS` 与 capability-by-fill 冲突；`parse.js:20-39` 仅 `resolved→closed` 单分支、`Type/Blocked by/Comments` 全未解析、`number/subIssues/blocking` 旧字段；`path.js:17-19` 用已删 `repo.path` 硬拼 `/.scratch`；`read/write/issues/graph/comments` 8/8 stub；`normalize.js` 未补全核心字段与 MISSING 裁决 | 重写 `parse→normalize→path→read/write→issues/graph/comments` 全链路；删 `number/subIssues/blocking`、删 `detect/EMPTY_CAPS`、补 `matches/select/describe` |
| #140 295 零合规 | `.scratch/` 295 份全平铺根/`handoff/tree-plan`，零个合规 `spec.md/map.md/issues/<NN>-<slug>.md`，0/295 含 `Status/Type/Blocked by/## Comments`，仅 `## 进度` 符合 | 契约测试不得以本仓库 `.scratch/` 为夹具，需在 `.scratch/__fixtures__/markdown-sample/<slug>/` 新建 2 个合规 effort（完整字段版 + 空值版）；`body` 原文透传以保留 `## 进度` 供 `deck-derive.parseProgress` |
| #134 labels 兼容 | 契约 §5 本地无 labels，用 Status/Type 表达；#126 定 `labels` 省略=MISSING、`[]`=EMPTY；倾向 MISSING 不强行映射 | `labels/milestone` 在 markdown 后端恒 MISSING（省略字段），不把 `Status/Type` 合成为伪 labels；`customFields` 仅作说明性透传 `Type:`，不驱动 deck |
| #129 平台三底座 | `getHome: Promise<string\|null>` 以 `os.homedir()` 为主源 win32 盘符护栏；`path` 同步对象 + `joinHome` 异步；`fs` 透传 `ctx.get('fs')` 沙箱；`env` 只读 | `mdPath` 与 `read/write` 全部经 `platform.path.join(cwd,'.scratch',slug,...)` 与 `platform.fs.*`；detect/preflight 只经 `platform.fs` 判环境，不直连 Node |

## 2. 读取映射（parse → normalize → 完整形状）

| 源 | 抽取规则 | 归一化目标 | EMPTY/MISSING 裁决 |
|---|---|---|---|
| `Status:` | `/^\s*Status\s*[：:]\s*([^\n]+)/im` → `trim().toLowerCase()`；兼容 `STATUS:` | `state: open\|closed`；映射表：`resolved/completed/closed→closed`，`claimed/ready-for-agent/ready/open→open`，缺省/未知→`open` + diagnostics | 核心字段恒有值，无 MISSING |
| `Type:` | `/^\s*Type\s*[：:]\s*([^\n]+)/im` → lower | 不驱动 `Issue.type`（`type: issue\|map` 由路径 `map.md` vs `issues/<NN>-*.md` 判定）；`Type` 存 `customFields:[{name:'Type',value,type:'single',options:[research,prototype,grilling,task]}]` 说明性 | 本地支持 → 有值或 `[]`；无 `Type` 行则 `customFields` 省略或空，保留 `body` |
| `Blocked by:` | `/^\s*Blocked\s+by\s*[：:]\s*(.+)$/im` → `split(/[,，\s]+/)` 抽 `#NN`/`NN` → `{key: NN.padStart(2,'0'), title:'', state:'open'}` | `blockedBy: IssueRef[]` | 本地支持 depGraph → 无行/空值时 `[]` EMPTY；`blocking` 禁止作 Issue 字段，仅 `getDependencies` 反扫同 root 推导 |
| `## Comments` | 以 `## Comments` 为锚，`split(/^###\s+/m)` 按 `---` 切条 → `Comment{author:{login}, authorAssociation:'', body, createdAt, updatedAt}` | `comments: Comment[]` | 支持 → `[]` EMPTY（无段时）；不支持不省略 |
| 父级 | 目录层级 `.scratch/<feature-slug>/…` | `parentKey: string\|null`（核心字段恒存在，根 map `null`）；`MapNode.tickets` 由 `issues.list(parentKey)` 聚合 | — |
| `## 进度:N%` | 不进形状 | `body` 原文透传，`deck-derive.parseProgress(body)` 派生 `progressOf` | — |
| 标题 | 首个 `^#+\s+(.+)$`，无则首非空行，回退 `''` | `title: string` | 缺→`''` |
| `key` | 文件名 `<NN>` 两位零填充 | `key: string` | 缺失抛 `parse` 错误，不回退 `'00'` |
| `assignees` | `Status:claimed→[{login:'@me'}] 或 []`，`ready-for-agent→[]`，无 Status → MISSING | `assignees?: Actor[]` | `claimed→EMPTY/有值`，`ready→EMPTY []`，无 Status → 省略（`indeterminate`，不误判 `frontier`） |
| `labels/milestone` | 本地无此概念 | 省略（MISSING） | 恒 MISSING；`diagnoseCapabilities` 记 `labels:<absent> (MISSING)` |
| `closedAt/reason` | `state==='closed' ? (fileMtimeISO??nowISO) : null`；`reason:'completed'` | `closedAt: string\|null`，`reason?: string` | open 时 `closedAt:null`，`reason` 省略或 `''` |

删除旧字段：`number/subIssues/blocking`；`url:''` 本地空；`createdAt/updatedAt` 取文件 `stat.mtime` 或 `''`。

## 3. 写入操作（非破坏性追加，经 platform.fs，受 DSH 写栅栏）

| 操作 V4 | Markdown 行为 | 保留性 |
|---|---|---|
| `create(repo,input)` | 扫 `issues/` 取 `maxNN+1` 两位零填充，`slugify(title)` 生成 `issues/<NN>-<slug>.md`；模板含 `Status:/Type:/Blocked by:` 行 + `## Comments` 空段 + `## Answer` 占位；`platform.fs.mkdir(dir,{recursive:true})` 后 `writeFile` | 新增文件 |
| `close(repo,key)` | 读原文 → `replace(/^Status\s*[：:].*$/m,'Status: resolved')` 无则首段后插入；`closedAt` 由文件 mtime 体现 | 保留 `## Comments` 段 |
| `comment(repo,key,body)` | 追加到 `## Comments` 段尾 `### <actor> — <ISO>\n${body}\n`，无段则先追加 `## Comments` | 追加不重写前文 |
| `update` | 行内字段替换（`Type:/Blocked by:`） | 字段行替换，段不动 |
| `setParent/setBlockedBy/setAssignees` | `setParent` 跨目录 `rename`（慎用，#115 树由目录层级表达）；`setBlockedBy` 重写 `Blocked by: #NN, #MM` 行；`setAssignees: claimed→Status: claimed / unclaim→Status: ready-for-agent` | 同上 |
| `reopen` | `Status: ready-for-agent` | — |
| `setLabels` | 本地无 labels → `{ok:false, error:{kind:'unsupported', message:'labels unsupported on markdown'}}` | 诚实上报 |

`writeFile` 统一：`platform.fs.writeFile(path,content)` 前检查 `platform.fs.access`；`ENOENT→not-found`、`EACCES→env`、`parse fail→parse`，均转 `TrackerError`。

## 4. detect / preflight（检测分两层，与 #118 级联轻量化对齐）

- **`matches(workspace,ctx): boolean`（原 detect）**：轻探针，只判 `.scratch/<slug>/map.md` 存在性（经 `platform.fs.access` + `platform.path.join(cwd,'.scratch',slug,'map.md')`）；`workspace` 为 `cwd`，不扫 `spec/issues`。失败→`false` + diagnostics，不伪造身份；成功由 `registry.select` 选中，`describe(handle,backendId): RepositoryRef{backend:'markdown', refId:'<path>', name, url:''}`。
- **`preflight(repo): OpResult<void,TrackerError>`**：只判环境——目录存在/可读（`platform.fs.access`）、`cwd` 权限；不判业务状态。`ENOENT→not-found`、`EACCES/EPERM→env`，返回 `{ok:true}` 或 `{ok:false, error:{kind}}`，按 #124 `classifyError` 纪律。
- **轻量化原则**：探测不读 `spec/issues` 目录，与 #118 三级联（显式声明>自动探测>引导）保持“探测轻、引导重”。

## 5. 诚实操作子集（#124 13 操作矩阵）

- **实现（本地可写）：** `preflight / list / get / getDependencies / create / close / reopen / comment / update / setParent / setBlockedBy / setAssignees`（后 4 个为行内字段改写，允许；`setParent` 高成本但保留）。
- **诚实 unsupported（由 registry Proxy 自动补桩）：** `setLabels`（本地无 labels，等 #134 定 MISSING）、`setMilestone` 等未覆盖项统一 `{kind:'unsupported'}`。
- **已删：** `detect→matches/select/describe`、`syncSnapshot`（宿主复合函数，非 op）、`normalize/parse` 不对外暴露（内聚）。

## 6. 路径计算（平台化，杜绝 #110 类 bug）

```
repo: RepositoryRef{backend:'markdown', refId:'<abs-path-or-cwd/.scratch/<slug>>', name, url:''}
mdPath(repo,kind,keyOrSlug):
  root = repo.refId || platform.path.join(cwd,'.scratch',slug)
  spec  → platform.path.join(root,'spec.md')
  map   → platform.path.join(root,'map.md')
  issue → platform.path.join(root,'issues', `${NN.padStart(2,'0')}-${slugify(title)}.md`)
```

全程 `platform.path.join`，禁 `+ '/.scratch'` 字符串拼接；`repo.path` 已废（shape.js 无 path 字段）。

## 7. 边界场景与处置

- `Status: ready-for-agent` 含 `-`：`(\w)` 截断为 `ready` → 改 `[^\n]+` 再 trim/lower，已列映射表兼容 `ready` 别名。
- 全角冒号 `：` 与大小写：正则 `[:：]` + `i` 标志。
- 缺 `Status` 行：判 `open` + diagnostics，`assignees` MISSING（`indeterminate`）不误入 `frontier`。
- `Blocked by` 破链 `not-found`：`deriveDeck.hasOpenBlocker` 判 `blocked=true` 安全，不误判 `frontier`；`levelOf` 对 NFD 按 0 占层级。
- 自环/成环：`levelOf` 用 `visited` 守卫 + `getDependencies` 返回前判 `ref.key===selfKey→conflict`。
- 并发 `create` 分配 NN：扫最大+1 后 `writeFile` 若 `EEXIST` 重试。
- 295 零合规迁移：不批量迁移旧 `.scratch/`，仅新建合规 fixtures；真实 deck 与技能集回环测试另在 #142 `verify-tracker-contract.js` 覆盖。

## 8. 验收（本票产出→#142 门禁）

- 本票 Answer 已给出结论（本文件即结论）；`tests/verify-tracker-contract.js` G4 双夹具（来源有→映射；来源无→空值）全绿为 #142 门禁；行内字段遍历样例覆盖 `Status/Type/Blocked by/Comments/parentKey`。
- 与 #134 衔接：labels 保持 MISSING，直通 `diagnoseCapabilities` 日志 `labels:<absent> (MISSING)`，UI 按 `||[]` 容错不渲染。
- 既有 `npm run verify` 全绿、无回归（平台层独立契约测试已在 #129 §5.1 约定）。

---
*一页纸即 #142 的“最简可行实现规格”，删布尔能力表、端正一行一事，保留 8 文件差距的全量纠正路径。*
