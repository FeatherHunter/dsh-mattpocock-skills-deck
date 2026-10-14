# #1129 Markdown 房认领条件与扫目录成本：只读调研

**一句话结论**：`.scratch/<名字>/map.md` 这个布局是 wayfinder 真机上的常态，也是 setup 模板写明的约定（`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md:7,25`），但**没有任何文档把它写成「工作区可以被认成 Markdown 房」的依据**——文档承认的两条依据是「根级 `.scratch/map.md` 在」与「`docs/agents/issue-tracker.md` 里写明 Local Markdown」。所以砍掉遍历不会破坏任何被文档承认的形态；唯一会改变的是「只有 `.scratch/<名字>/map.md`、没有根地图也没有声明文件」这种今天靠猜认下来的工作区，改后它会被如实判为「不是我」。真正需要一起看的遗留是**同一个文件里的 `preflight`（`src/tracker/rooms/markdown/index.ts:154-171`）与宿主的健康判据（`src/host/remotePredicates.ts:66-85`）仍在按条目遍历 `.scratch`**。

**本文件的取样时点**：2026-10-14 22:25（Asia/Shanghai）。此时工作区里 #1129 的改动**已经在盘上、但还没提交**：`git status --porcelain` 给出 ` M src/tracker/rooms/markdown/index.ts`（内容正是删掉遍历；HEAD 里那一版 blob 是 `6344718b`，还在遍历）、` M package.json`（把新的验收测试挂进 `verify` 长串）、`?? tests/verify-1129-markdown-claim.ts`（新验收测试）。同一份 `git status` 里还有两处与本票无关的并发改动：` M docs/agents/commit-convention.md`、`?? research/1057-markdown-25-audit.md`。本文件里 `src/tracker/rooms/markdown/index.ts` 的行号一律指**工作区这一版**；需要对照时另写明 HEAD 的行号。本次调研没有改动 `src/` 与 `tests/` 下任何文件（本文件自身是本票的产出，新落在 `research/` 下）。

实测口径（本仓，2026-10-14 22:16）：`.scratch` 下非点开头的子目录 201 个、非点开头文件 1728 个，合计 1929 个条目；根级 `.scratch/map.md` **不存在**；子目录里有 `map.md` 的只有 `572-debug`（即 `.scratch/572-debug/map.md`）。票面写的 200 + 1727 与今天的数一致（多出来的 3 个条目是今天并发开发新落下的 `.scratch/1153-base/`、`.scratch/1153-base-deps.json`、`.scratch/1157-probe/`）。候选路径数 ≈ 条目数，这一点在改动前成立。

**后续（2026-10-14 22:35）**：这份调研写完之后，改动已提交并推送为 `35598b23`，票 #1129 已关闭，地图 #1056 的 Decisions so far 也记了一行。第 7 节问题三留下的两处遗留（`preflight` 仍按条目遍历、`src/host/remotePredicates.ts:66-85` 的同构遍历）已写进票面正文；评审时若要按它们另开票，行号直接取本文件。

---

## 1. 这段遍历的来历

**结论**：遍历是提交 `d3fcb3b7` 引入的，它是「Markdown 房第一次有 `matches()`」的那一笔；提交信息里**没有**为遍历给出任何理由，也**没有**关联 issue 编号。它不是仓库第一次提交就有的——本仓第一笔提交是 `399cdcdd`（Initial commit），traverse 的代码最早出现在 `d3fcb3b7` 里的 `src/host/tracker/backends/markdown/index.js`。

证据链（均在本仓可复现）：

| 提交 | 时间 | 提交信息（原文，首行） | 与这段逻辑的关系 |
| --- | --- | --- | --- |
| `4538ec73` | 2026-08-23 18:07:30 | `feat(tracker): 跨平台·可插拔 tracker 契约层骨架 + 平台占位 + G4 契约测试` | 这个文件（`src/host/tracker/backends/markdown/index.js`）被创建。**当时没有 `matches`**，只有 `detect: async (repo) => …`；文件头注释写的是「严格按 mattpocock 的 `.scratch/<feature-slug>/` 规则读写同一文件集（spec.md / map.md / issues/<NN>-<slug>.md）」 |
| `73546943` | 2026-08-23 22:36:38 | `feat(tracker): 契约层剩余定版落地 #132 — 操作集定版、registry 三级联…` | registry 三级联定版（`matches` 这个口子从这一批起进契约），但本文件「零改动」 |
| **`d3fcb3b7`** | **2026-08-24 15:59:33** | `feat(platform): 三底座 100% 关图 + 后端三端落地 + 171 迁移 Option A 断环` | **`matches(handle, ctx)` 与遍历同时出现在这一笔**。引入的代码（原文）：`let entries=[]; if(fs&&typeof fs.resolve==='function'&&typeof fs.listDir==='function'){…entries=await fs.listDir(t)…} else if(fs&&typeof fs.readdir==='function'){…} for(const e of entries){const name=…; if(!name||name.startsWith('.'))continue; candidatePaths.push(plat.join(root,name,'map.md'))}`；同一笔里已经带着「`handle.refId` 含 `.scratch` 就当路径」这一支与 `candidatePaths.push(plat.join(root,'map.md'))` |
| `9f182027` | 2026-08-25 16:43:18 | `fix(markdown): matches 认 docs/agents/issue-tracker.md Local Markdown` | 加上「声明文件里写 Local Markdown 也算」这一支（就是今天 `src/tracker/rooms/markdown/index.ts:73-86` 那段） |
| `2e07444b` | 2026-08-29 | `修复本地图谱检测只认根目录：按多谱结构查找并更新修复指引文案` | **没有动 `matches`**，只改了提示文案；它的内联注释写「2026-08-29 对齐多谱模型（用户实证：图谱落在 `.scratch/<图谱名>/map.md`，根 `.scratch/map.md` 只是其中一种形态）」——这是「子目录布局才是常态」这件事被写进代码注释的时点 |
| `d0fdb277` | — | `目录归位：deck 工具与 tracker 三房按目标树一次搬完（#1019）` | 文件从 `src/host/tracker/backends/markdown/index.js` 搬到今天的 `src/tracker/rooms/markdown/index.ts`，遍历原样带走 |

怎么查到的（命令与结果）：

- `git log --all -S "candidatePaths" -- src/tracker/rooms/markdown/index.ts src/host/tracker/backends/markdown/index.js` → 只有一笔：`d3fcb3b7`。
- `git log --oneline -S "listDir" -- src/host/tracker/backends/markdown/index.js` → `d0fdb277`（搬迁）、`18669b62`（Markdown 后端在途改动落盘快照）、`d3fcb3b7`（引入）。
- `git log --follow --oneline -- src/tracker/rooms/markdown/index.ts` 的最早四笔：`4538ec73`、`d3fcb3b7`、`bf9e9e04`、`9f182027`。
- `git log -1 --format='%H%n%ad%n%s%n%b' d3fcb3b7` → 提交信息正文只有五行要点（156/157/158 三底座、130/131、133/134/135 标签、139/142/145 后端落地 + 171 迁移、113 子票），**逐字没有提 `.scratch` 扫描**，也没挂 issue 号。

**为什么当时的理由是空白的这一点要紧**：遍历不是为了满足某张票的验收而写进来的，它是「把三端 platform 打通」那一大笔里顺手加的探测手段。也就是说，今天删掉它，没有一份写成文字的决策被推翻；反过来，#1129 要立的新规矩（认领只读调用方说出来的事实）也没有旧文档要回改。

**这份历史在本仓不完整**：本仓代码是品牌迁移时整份迁入的（`db00e2e3  dsh-mattpocock-skills-deck 品牌迁移：dsh-waystation 全量代码迁入`），迁移前 `dsh-waystation` 的历史不在本仓。所以「`4538ec73` 之前有没有一份更早的实现」在本仓查不到——证据范围就是本仓的 1856 笔提交，其中含 `src/` 的最早一笔是 `db00e2e3`。

---

## 2. `.scratch/<名字>/map.md` 是不是被文档承认的布局

**结论分两句，必须分清**：

1. 「地图放在 `.scratch/<名字>/map.md`」——**是**文档承认的布局，而且是本地 Markdown 后端的标准形态；文档里**没有**任何一处写「根级 `.scratch/map.md` 是标准形态」。
2. 「工作区里有 `.scratch/<名字>/map.md` 就可以被认成 Markdown 房」——**不是**。把这件事写成认领依据的只有一处，是**架构评估文档在描述当时的实现**（`docs/architecture/markdown-backend-142-eval.md:14`），不是约定。

### 2.1 setup 模板（本地 Markdown 后端的唯一权威约定）

`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md`（这份就是 setup 写进工作区的 `docs/agents/issue-tracker.md` 正文）：

- `:3` `Issues and specs for this repo live as markdown files in `.scratch/`.`
- `:7` `One feature per directory: `.scratch/<feature-slug>/``
- `:8` `The spec is `.scratch/<feature-slug>/spec.md``
- `:9` `Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md``
- `:15` `Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).`
- **`:25` `- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).`**
- `:26` 子票 `.scratch/<effort>/issues/NN-<slug>.md`
- `:28` 前沿扫描 `.scratch/<effort>/issues/`

**这份模板里没有一行出现根级 `.scratch/map.md`**。同一技能的选择题说明（`package/bundled-skills/setup-matt-pocock-skills/SKILL.md:46`）写的也是「issues live as files under `.scratch/<feature>/`」；`:28` 把「仓库里有 `.scratch/`」称作「本地 markdown 约定已经在用的迹象」。

### 2.2 架构与 ADR 文档

- `docs/architecture/tracker-backend-design-contract.md:47`：位置 `.scratch/<feature-slug>/` —— `spec.md` / `<effort>/map.md` / `issues/<NN>-<slug>.md`。
- `docs/architecture/markdown-backend-proposal-141.md:8`：`.scratch/<feature-slug>/spec.md | <effort>/map.md | issues/<NN>-<slug>.md`；`:73`：`map → platform.path.join(root,'map.md')`（`root` 就是那个 effort 目录）。
- `docs/adr/20260828-markdown-map-and-label-palette.md:8,18,20`：`.scratch/<努力目录>/map.md` 是一张图的锚点；一次快照对 `cwd/.scratch` 下**所有含 `map.md` 的努力目录**全量枚举（注意：这是**快照读**的口径，不是认领的口径）。
- `docs/adr/20260909-effort-identity-in-repository-ref.md:11`、`docs/architecture/tracker-backend-normalized-model.md:49,217`、`docs/architecture/tracker-backend-charting-snapshot.md:46`：`effortId` = `.scratch/<工作单元>/` 的目录名。
- `docs/architecture/third-party-tracker.md:91`：`matches` 的语义说明（demo 房探 `cwd/.demo/config.json` 或 `.scratch/map.md`）。
- `docs/architecture/tracker-backend-design-contract.md:50`：本地后端无 labels，父子靠目录层级。

### 2.3 唯一把「遍历」写成实现事实的两处（不是约定）

- `docs/architecture/markdown-backend-142-eval.md:14`：「**`matches(handle,ctx)` 只读 `map.md` 存在性（枚举 `.scratch/map.md` + 各 slug/map.md，不读 spec/issues）**」——它在描述当时的实现，并且在括号里明说「不读 spec/issues」。这是对已有行为的记录，不是对「必须遍历」的要求。
- `docs/architecture/markdown-backend-proposal-141.md:56`：「**`matches(workspace,ctx): boolean`（原 detect）**：轻探针，只判 `.scratch/<slug>/map.md` 存在性…」——同样是描述。

### 2.4 认领条件在文档里的写法（这是关键的区分）

- `docs/adr/20260921-tracker-choice-precedence.md:23`：把 matches 的证据写成「目录里有没有 `.scratch/map.md`」——**只举根级那一个**。
- `docs/tracker/capability-markdown.md:11`：preflight 查「`.scratch/map.md` 或文档声明」。
- `docs/tour/deck-call-end-to-end.md:358`：地图 `<工作区根>/.scratch/map.md`；`:360`：带 effort 范围时落到 `<cwd>/.scratch/<effortId>/`；`:452`：「本地房间是读 `.scratch` 下有没有 `map.md`（`markdown/index.ts:90-123`）」。
- `docs/research/markdown-init-wayfinder-panel-investigation-2026-08-28.md`：`:12,152,201` 记「setup 只写 `docs/agents/issue-tracker.md`、不建 `.scratch`；wayfinder 写 `.scratch/<effort>/map.md`」；`:207` 记录 matches 的 Local Markdown 兜底分支；`:248` 建议把 `mdParseOkPredicate` 改成扫描 `.scratch/*/map.md`「与 matches 的枚举逻辑一致」。
- 本仓自己的 `docs/agents/issue-tracker.md:1` 写的是 `# Issue tracker: GitHub`——本仓不是 Local Markdown 工作区，却因为 `.scratch/572-debug/map.md` 被旧 `matches` 认下来（`tests/verify-1129-markdown-claim.ts:90-98` 正是照这个形态造的夹具）。

**判定**：文档承认「地图写在 `.scratch/<名字>/map.md`」这个**布局**，也承认「`.scratch/map.md` 在」与「`docs/agents/issue-tracker.md` 写明 Local Markdown」这两条**认领依据**。**没有任何文档承认「扫 `.scratch` 下的子目录找 map.md」是认领依据**；写到它的两处都是在描述实现。

---

## 3. `handle.refId` 里的 `.scratch` 路径从哪来

**结论**：这一支是给**显式调用方**留的逃生口，不是自动识别路径。生产代码里**找不到任何一处**把 `refId` 构造成 `.scratch/<名字>`；能构造成这个形状的只有测试夹具、金标准回执与示例脚本。因此删掉遍历后，这一支仍完整覆盖「map.md 在子目录」的显式场景——但它覆盖的是「调用方点名说出来的那一个目录」，不是「猜出来的那一个」。

### 3.1 这一支本身

`src/tracker/rooms/markdown/index.ts:55-59`（工作区版）：

```js
if(handle.refId&&String(handle.refId).includes('.scratch')){
  const p=isAbsolute(String(handle.refId),plat)?String(handle.refId):plat.join(cwd,String(handle.refId))
  candidatePaths.push(plat.join(p,'map.md'))
  candidatePaths.push(p)
}
```

`p`（refId 自己）也被当成候选，是因为 `src/tracker/rooms/markdown/path.ts:20-30` 的 `getRoot` 允许 refId 直接指到 effort 目录：refId 是绝对路径就照用、是相对路径就 `join(cwd, refId)`；refId 为空时退回 `join(cwd,'.scratch',name)` 或 `join(cwd,'.scratch')`。同文件 `:69-77` 的注释写明：「ref.effortId 给出时，路径一律落在 `<cwd>/.scratch/<effortId>/` 下；effortId 为空串 = 根级扁平布局 `<cwd>/.scratch/`」。`src/tracker/rooms/markdown/index.ts:172-176`（preflight 里）也照同一口径注释：「带 backend 的 handle 被当成『已选定后端的引用』用（refId 即路径，见 matches）」。

### 3.2 谁构造 RepoHandle（自动识别那条路）

- **注册表拿到的探测句柄只有 `cwd`**：`src/tracker/detection/backendDecision.ts:912-914`，`collectEvidence(cwd, …)` 里 `const handle = { cwd };`，随后 `:977` 调 `deps.autodetect(handle, ctx)`（或 `:981` 调 `registry.select(handle, ctx)`）。所以自动识别这条路上 refId 恒为 undefined，第 3.1 节那一支**在认领阶段根本收不到值**。
- **宿主侧的接线同样只给 cwd**：`src/host/refresh/wiring.js:388` `handleFor: function (s) { return { cwd: (s && s.cwd) || '' } }`（注释在 `:308`：「handleFor（会话→注册表里绑过的真实句柄）」）；壳里用它的地方是 `src/deck/shell/call-shell.ts:242`，注释 `:241` 写「『会话 → 句柄』由接线方给（宿主知道这个工作区绑了哪个 refId / effortId）」。
- **describe 是 ref 的唯一产地，它在没有 refId 时按目录推**：`src/tracker/rooms/markdown/index.ts:90-98`（`refId = handle.refId || cwd`，并透传 `effortId`）；同口径的注册表兜底在 `src/tracker/registry/views.ts:71`（`const refId = handle.refId || (backendId === 'markdown' ? handle.cwd : '')`）。
- **宿主补全 refId 时补的是 cwd 或 `owner/name`**：`src/host/snapshotBuild.ts:113-114`（注释原文：「探测句柄：注册表认 cwd 与 refId 两格；这里只填得上 cwd，refId 由注册表自己按目录推」）、`:325`（`reg.describe({cwd: cwd, refId: cwd}, sel.backendId)`）、`:330`；`src/host/platformChannel.ts:419`（`resolveRepoHandle: async (h) => ({ cwd: h.cwd || '', refId: h.refId || '' })`）；`src/tracker/detection/detectionService.ts:388-393`（repoHandle 优先取 `selection.ref.refId`，否则问 `resolveRepoHandle`）。
- **「用户在 setup 里选的」这份记录不装路径**：`src/deck/rules/workspace-file.ts:59-64` 的 `WorkspaceChoice` 只有 `backendId` / `pickedAt` / `source` / `layout` 四格（解析在 `:117-121`）；`src/deck/shell/workspace-anchor.ts:62-66` 的注释也写明「只装：版本、后端、档案时间、来源、有布局才加布局；**不装路径**、令牌、登录态」。所以「用户选 markdown」不会产生带 `.scratch` 的 refId。

### 3.3 这个形状在测试与金标准回执里是既定写法

- `tests/verify-656-subworkspace-acceptance.js:469`：`const ref = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }`。
- `tests/tracker-contract/sections/idempotency.js:36,163`、`tests/tracker-contract/sections/counts.js:63`、`tests/tracker-contract/sections/idempotency-counterproof-markdown.js:36`：`repo: { backend: 'markdown', refId: '.scratch/demo', … }`。
- `tests/tracker-contract/fixtures/golden-receipts/*.golden.json`：`01-deck_context.golden.json:56,74`、`03-deck_issue_list.golden.json:63`、`05-deck_map_snapshot.golden.json:96` 等八份里都是 `"refId": ".scratch/demo"`；工作区文件里写的仍是 `backendId: markdown`（`tests/verify-golden-receipts.ts:216` 用 `chooseWorkspace(rootPosix, 'markdown')`），refId 是 `describe`/夹具补出来的。
- `tests/verify-784-effortId.js:55`：`const handle = { cwd: ws.rootPosix, refId: '.scratch' }`。
- `tests/verify-1144-markdown-issue-address.ts:76-78,95,115,131`：`refId` 指到 effort 目录（`effortDir`）与工作区根两种形态都在用。
- `docs/reviews/1142-markdown-address-code-changes.html:302,305`：`{ backend: 'markdown', refId: '.scratch/demo', … }` 与 `wantRelative('.scratch/demo/map.md')`。

**结论**：`.scratch/<名字>` 是**调用方/夹具点名给出来的路径**这一用法有据可依（也是唯一有据可依的用法）；没有任何生产构造点会自己造出这个值。删掉遍历不碰这一支，所以显式场景仍然认——测试 `tests/verify-1129-markdown-claim.ts:144-150` 就是钉这件事的。

---

## 4. 判定级联与裁剪顺序

**结论**：`matches` 由注册表的 `select()` 并行问、结果按**注册顺序**取第一个；注册顺序在装配处被固定成 `github → markdown → gitlab`，而统一判定出口另有一份同样顺序的明文常量 `MULTI_CLAIM_ORDER` 做二次裁剪。改 Markdown 房 `matches` 的返回值**只会改变「自动识别这一层报谁」**，不会动摇优先级规则本身：顺序与裁剪都是别的文件里的常量，不由房间自己保证。

### 4.1 `matches` 被谁调用

- `src/tracker/registry/core.ts:159-204` 的 `select(handle, ctx)`：对每个已注册房间并行跑 `entry.mod.matches(handle, matchCtx)`（`:180-184` 的 `Promise.all`），收集命中（`:185` 的 `hits`），`:188` `const choice = hits[0] // 注册序（Map 迭代序）`；多命中时把名单放进 `multiHit`（`:193`）；无命中且无 pending 时回落 `source: 'fallback'`（`:203`）。
- 超时：`src/tracker/registry/core.ts:44` `export const MATCHES_TIMEOUT_MS = 30000`，`withTimeout` 在 `:47-68`，超时不判 false 而是**pending（未决）**并排除出决策集（文件头 `:7` 写明这条口径）；`:90` 允许按 `opts.matchesTimeout` 覆盖（测试用到）。
- 兜底与重试：`src/tracker/detection/backendDecision.ts:905-911` 的注释把认领这一层称作「三层里最弱、也最贵的一层」，decisive 范围下只在前两层都没给出可用结论时才问；证据收集在 `:912-1017`，探针句柄 `:914` `const handle = { cwd }`；判定在 `decideBackend`（`:1089-1151`）。
- 宿主侧入口：`src/tracker/detection/detectionService.ts:253-458` 的 `detect()`，其中 `:388-393` 组 repoHandle、`:395-405` 惰性调 `preflight`（只在命中且非 pending 时）、`:442-454` 缓存结论。

### 4.2 裁剪顺序在代码里的确切位置

- **注册顺序**：`src/tracker/registry/builtins.ts:39` `export const BUILTIN_ROOM_IDS: readonly BuiltinRoomId[] = ['github', 'markdown', 'gitlab']`，装配处 `:85` 按这个数组 `for (const id of BUILTIN_ROOM_IDS)` 逐个 `register`；`:35` 的注释点名「与 `src/tracker/detection/backendDecision.ts` 的 `MULTI_CLAIM_ORDER` 同序」。
- **明文裁剪顺序**：`src/tracker/detection/backendDecision.ts:349` `export const MULTI_CLAIM_ORDER: readonly string[] = ['github', 'markdown', 'gitlab'];`，文件头 `:38` 写「**明文裁剪顺序**：多个后端同时认领时按 `MULTI_CLAIM_ORDER`（GitHub > Markdown > GitLab）」；裁剪实现在 `orderClaims`（`:558-567`，`:563-565` 是「名单里有的按常量排、不在名单里的往后放」）；`:1157` 把它导出给门禁比对。
- **证据层级**：`src/tracker/detection/backendDecision.ts:83` `EVIDENCE_PRIORITY = ['workspace-file','declaration','autodetect']`（人能压过认领），`pickVerdict`（`:587-610`）、`synthesize`（`:695-738`）。
- **门禁钉住这条顺序**：`tests/verify-detection-evidence.ts:300`（常量逐字等于 `['github','markdown','gitlab']`）、`:302`（`orderClaims` 重排）、`:322-323`（读真的注册调用，确认装配处确实是 github → markdown → gitlab 这个次序）。
- 注册表自己的口径也写在 `src/tracker/registry/core.ts:12` 与 `src/tracker/registry/views.ts:33`：`registry.select` 给出的 `backendId` 只是「装配顺序里的第一个」，最终裁决归统一判定出口；`src/tracker/rooms/markdown/index.ts:66-68` 那条新注释说的「只是恰好被注册序兜住」指的就是这里。

### 4.3 改动会不会影响裁剪

- 不影响规则：顺序由 `BUILTIN_ROOM_IDS` / `MULTI_CLAIM_ORDER` 两处常量决定，与房间内部实现无关。
- 会影响**该层报出来的名单**：本仓这种「根级无 `.scratch/map.md`、子目录有 `.scratch/572-debug/map.md`」的工作区，改动前 markdown 会进 `hits`、`multiHit` 里多一个 `markdown`（github 仍排第一，所以结论不变）；改动后 markdown 不再出现在名单里，`multiHit` 少一项、日志里的认领顺序也少一段。也就是说，#1129 让「Markdown 房认领得对不对」从「靠顺序兜住」变成「它自己说对」。
- 另有一处与 `.scratch` 有关但不属于认领：`src/tracker/detection/detectionService.ts:158` 的过期判据把 `.scratch` 列进探针目录（`:186` `const probes = ['.git', '.scratch', 'docs', 'package.json', 'README.md']`），那是**一次 `stat` 目录 mtime**，不枚举条目，成本与条目数无关。

---

## 5. 测试覆盖

**结论**：**只有 `tests/verify-1129-markdown-claim.ts` 一个文件直接调用 Markdown 房的 `matches()`**，它就是 #1129 的验收测试（在工作区这一版的 `package.json:23` 的 `verify` 长串上；这一项与源码改动同批、**还没提交**，HEAD 的 `package.json` 里没有它）。除它之外，全仓没有任何测试断言「`.scratch/<子目录>/map.md` 会被认领」——所有用到子目录地图的夹具都先把后端写成显式（工作区文件或显式 repo ref），让 `matches` 不参与。因此删掉遍历**不会让任何既有测试变红**；会在行为上变化但不报红的只有 `tests/verify-1109-matches-timeout.ts` 的一条夹具（见 5.2）。

### 5.1 直接调用 `matches()` 的那个文件（唯一）

`tests/verify-1129-markdown-claim.ts`（import 在 `:28`，调用包装在 `:77-83`）。九个断言逐条列出，并标明删掉遍历后它是变绿还是变红：

| 行号 | 用例名（断言文字） | 钉的是什么 | 删掉遍历前 / 后 |
| --- | --- | --- | --- |
| `:97` | 声明是 GitHub、根级无 `.scratch/map.md`、只有 `.scratch/572-debug/map.md` → false（本仓形态） | **正是「依赖遍历会变红」的那一条反例** | 前：红（旧实现会 true）／后：绿 |
| `:104` | 空工作区（无 `.scratch`、无声明）→ false | 空目录不误判 | 前后都绿 |
| `:112` | `.scratch` 下只有普通文件、没有 map.md、也没有声明 → false | 普通文件也进候选这个缺陷 | 前后都绿 |
| `:122` | 有 `.scratch/map.md` → true（与改动前一致） | 根级扁平布局不许丢（验收②） | 前后都绿 |
| `:131` | 只有声明（含 "Local Markdown"）、还没有 `.scratch` → true | setup 已选但首图未画 | 前后都绿 |
| `:141` | 声明 + `.scratch/<effort>/map.md`、根级无 map.md → true（真机常态） | **子目录地图靠声明兜底仍认**——这条是「子目录形态没有被破坏」的证据 | 前后都绿 |
| `:149` | refId 明确指向 `.scratch/effort-a` 且那里有 map.md → true | 显式路径仍然认（第 3 节那一支） | 前后都绿 |
| `:164-165` | 3 个条目与 60 个条目都不含 map.md → 都是 false，且 `lstat` 次数相同 | **验收③：成本不随条目数增长** | 前：红（次数随条目数走）／后：绿 |
| `:173` | 认领过程一次 `listDir` 都不调用 | **验收③：不再遍历 `.scratch`** | 前：红（旧实现会 listDir）／后：绿 |

一句要点：这个文件里「断言子目录地图被认领」的两条（`:141`、`:149`）分别走**声明文件**与**显式 refId**，都不是遍历；而断言遍历必须消失的是 `:97`、`:165`、`:173`。所以它同时钉住了「不该认的别认」与「该认的别丢」。

### 5.2 会经注册表间接跑到真 `matches()` 的测试

- `tests/verify-1109-matches-timeout.ts:160`（`:164-165` 断言空目录干净回落）、`:175`（挂住的假后端 → pending）——问的是超时口径，与 markdown 的命中无关。
- `tests/verify-1109-matches-timeout.ts:205-231`：`makeWorkspace('c', true)`（`:69-81` 只铺 `.scratch/demo/map.md`，不写工作区文件、不写声明），然后 `:229` 走 `deck_context.run`，`:230-231` 只断言「起的是宿主注入的等待口、每笔 30000ms」。**这一条在改动后行为会变**（选后端的结论从 markdown 变成「没有后端」），但断言不看结论，所以不变红。
- `tests/tracker-contract/sections/registry.js:155-200` 的 select 两级联三态用例：注册的是 `mkModule()` 假房，与 markdown 实现无关。

### 5.3 用 `.scratch/demo/map.md` 当夹具、但不经过 `matches` 的测试（点名，防止误判）

这些夹具都通过 `tests/lib/deck-decide-stub.js` 的 `chooseWorkspace` / `writeWorkspaceFile` 先把「这个工作区选了 markdown」写进工作区文件（显式层），或直接用显式 `repo` 引用调房间操作，所以删掉遍历对它们没有影响：`tests/verify-deck-tools.js:42,94`、`tests/verify-deck-tools-matrix.js:48,146`、`tests/verify-deck-tools-host-wiring.js:56,108`、`tests/verify-723-gate-wiring.js:241,251`、`tests/verify-refresh-workspace-key.js:45,120`、`tests/verify-golden-receipts.ts:189,216`、`tests/verify-1106-deck-surface.ts:174,216`、`tests/verify-1150-plan-store-durable.ts:53,174`、`tests/verify-691-markdown-counts-page.js:59,168`、`tests/verify-971-markdown-parent.js:52,126`、`tests/verify-markdown-backend.js:74-75`、`tests/verify-markdown-label-colors.js:322` 起、`tests/verify-multi-effort.js:49`、`tests/tracker-contract/sections/counts.js:46`、`tests/tracker-contract/sections/idempotency.js:145`、`tests/tracker-contract/sections/idempotency-counterproof-markdown.js:19`、`tests/tracker-contract/sections/labels.js:442`。

另外两条容易看错的：

- `tests/verify-tracker-contract.js:163-170` 的注释里提到「当前仓库无 `.demo/config.json`，仅 `.scratch/map.md` 存在，按 spec 也算 true」，但断言 `:169` 只检查 `typeof matchRes === 'boolean'`——它测的是 `examples/demo-mini/matches.js` 的返回类型，不依赖本仓 `.scratch` 的真实内容，不会红。
- `tests/verify-656-subworkspace-acceptance.js:175` 造的是**声明形态**（`mdws/docs/agents/issue-tracker.md` 里写 `Local Markdown`），`:469` 的 `refId: '.scratch/demo'` 只喂给 `src/tracker/rooms/markdown/path.ts` 算路径（`:466-489`），`:431` 的 `decideBackend` 结论来自工作区文件里写着的 github（`:396-438`）——两条都不经过匹配。

### 5.4 注册情况

工作区这一版的 `package.json:23`（`verify` 长串）里含 `verify-1129-markdown-claim`、`verify-1109-matches-timeout.ts`、`verify-656-subworkspace-acceptance.js`、`verify-golden-receipts`、`verify-deck-repo-resolve`（逐项 `-match` 检查均为 True）。**`verify-1129-markdown-claim` 这一项是随本票同批加进去的、还没提交**：`git show HEAD:package.json` 里搜不到它，`git diff --stat -- package.json` 是 `1 insertion(+), 1 deletion(-)`。也就是说，只要这批改动落地，`npm test` / `npm run verify:parallel` / `node scripts/verify-all.mjs`（CI `verify.yml`）三条入口都会跑到这份验收测试；而在落地之前，它在 HEAD 上不参与任何入口。

---

## 6. 调用方对返回值的依赖：别的地方还直接读 `.scratch` 下的 map.md 吗

有，共六处（按与 #1129 的相关度排序）：

1. **同一个房间的 `preflight`（仍在按条目遍历，与改动前的 `matches` 同形）**——`src/tracker/rooms/markdown/index.ts:154-171`：`:154` 注释「检查全局 `.scratch` 下是否有任意 map.md 或 docs 声明」，`:160-161` 调 `fs.listDir` / `fs.readdir` 取 `.scratch` 的条目，`:162-168` 逐条拼 `<名字>/map.md` 并 `exists`（命中即 `{ok:true}`），`:169` 再单独看根级 `.scratch/map.md`。它由统一判定出口**惰性**调用，只在「已经判到某个后端且非 pending」时跑：`src/tracker/detection/detectionService.ts:395-405`（`:397` 的 `if (selection && selection.backendId && !selection.pending)`）。**它不会造成误认领**（认领已经定完了），但它保留了同一类成本，也是「只有子目录地图、认不出 markdown」的工作区在认领失败后唯一还会去扫 `.scratch` 的地方。
2. **宿主的健康判据 `md:parseOk`（读 `.scratch` 找地图，与旧 matches 同构）**——`src/host/remotePredicates.ts:66-85`，其中 `:75` 看根级 `.scratch/map.md`、`:76-83` 用 `platform.fs.listDir` 逐条拼 `.scratch/<name>/map.md`；`:31-34` 与 `:66` 的注释明说「与 `backends/markdown` `matches()` 数据模型同构」。它判的是「这个工作区的地图还在不在」（体检/修复指引），不是身份。
3. **本房间的读路径按工作单元找地图（认领之后才跑）**——`src/tracker/rooms/markdown/issues-locate.ts:51-65` 的 `listEfforts()`（`:55` 根级、`:60-62` 逐个子目录）与 `:130-151` 的 `resolveMapFile`；被 `src/tracker/rooms/markdown/issues-read.ts:100-130`（list/counts/page/graph）与 `issues-patch.ts:310`、`issues-create.ts:52-67` 等所有读写操作共用。`:115` 与 `:108` 保留「夹具形态兜底」（refId 直接当仓库根、没有 `.scratch`）。
4. **标签配色文件的位置**——`src/tracker/rooms/markdown/label-colors-ops.ts:71`：`const files = [plat.join(dir, 'map.md')]`，按工作单元目录取地图。
5. **示例后端 demo-mini**——`examples/demo-mini/matches.js:36-38`：候选 2 是 `cwd/.scratch/map.md`（**只看根级，不遍历**），注释写「与 markdown 后端正交」。
6. **开发脚本**——`scripts/generate-markdown-fixtures.js:17,37,61`：脱敏夹具生成器默认从 `.scratch` 采样 `.scratch/<effort>/issues` 下的真实票。

此外两处「读 `.scratch` 但不读 map.md」的：`src/shared/refresh/src/chain.ts:166-184` 的 `chainEffortIdFromPath`（从路径反解工作单元名，`:179` 的正则认 `.scratch/<effort>/`）、`src/host/handoffClaim.js:42,51,62-64`（读 `.scratch/handoff/` 下的移交文件）。与认领无关。

---

## 7. 对 #1129 改动的直接含义

**问题一：砍掉遍历会不会破坏某个被文档或测试承认的合法形态？**

**不会。** 逐条对照：

- 被文档承认的**布局**有两种：根级扁平 `.scratch/map.md`（`src/tracker/rooms/markdown/path.ts:69-77` 仍支持）与分目录 `.scratch/<effort>/map.md`（`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md:25` 的约定）。改动后两种都还在：前者由 `src/tracker/rooms/markdown/index.ts:60-61` 直接认；后者由 setup 写下的声明文件兜底（同文件 `:73-86` 认 `docs/agents/issue-tracker.md` 里的 `Local Markdown`），而「先写声明、地图随后落」正是 setup 的既定流程（`docs/research/markdown-init-wayfinder-panel-investigation-2026-08-28.md:12,152,201` 记的真机事实）。
- 被文档承认的**认领依据**只有两条（`.scratch/map.md` 在；声明文件指向 markdown），遍历不在其中——`docs/adr/20260921-tracker-choice-precedence.md:23`、`docs/tracker/capability-markdown.md:11` 都是这么写的。写到遍历的两处（`docs/architecture/markdown-backend-142-eval.md:14`、`docs/architecture/markdown-backend-proposal-141.md:56`）是在**描述实现**，不是约定。
- 被代码承认的第三种**显式形态**（`refId` 点到一个带 `.scratch` 的路径，`src/tracker/rooms/markdown/index.ts:55-59`）**分支保留**，不受影响；它今天在测试与金标准回执里广泛使用（第 3.3 节），而且生产代码里没有任何构造点会自己产出这个值（第 3.2 节）。
- **唯一会失去的形态**：`有 .scratch/<名字>/map.md` + `根级没有 .scratch/map.md` + `没有指向 markdown 的声明文件`。这一形态今天靠遍历猜下来，改动后会如实返回「不是我」。它不被任何文档写成约定，被测试承认的只有 `tests/verify-1129-markdown-claim.ts:97` 那一条**反例**（要求它必须判 false）。
- 唯一的边界情形值得人拍板：**手工搭起来的 Local Markdown 工作区**（自己建 `.scratch/<effort>/map.md`，但没跑 setup、因此没有 `docs/agents/issue-tracker.md`）改动后认不出来。文档给的补救是明说出来的——补一句声明即可（`src/tracker/rooms/markdown/index.ts:71` 的新注释也是这个口径：「要认下一个工作区，就让它把话说明白」）。这不是被文档承认的形态，但它是真实用户可能踩到的一种。

**问题二：会不会有测试变红？**

**不会。** 唯一直接断言 `matches()` 行为的测试就是 `tests/verify-1129-markdown-claim.ts`，而它要的正是「遍历消失」；除它以外，全仓没有第二个测试断言「子目录里的 map.md 会被认领」（第 5.2、5.3 节逐条点过：走真 `matches` 的只有 `tests/verify-1109-matches-timeout.ts`，它只看计时器；所有子目录地图夹具都先把后端写成显式）。`tests/verify-1109-matches-timeout.ts:205-231` 是**行为变化但不报红**的那一条：`wsC` 在改动后会从「认到 markdown」变成「没有后端」，测试仍绿，代价是这条夹具不再覆盖「认领命中 markdown」的情形——这个覆盖空位由 `tests/verify-1129-markdown-claim.ts:122,131,141,149` 补上了。

**问题三：遗留（本次改动没有覆盖的同类问题，建议另开票）**

- `preflight` 仍在按条目遍历 `.scratch`：`src/tracker/rooms/markdown/index.ts:154-171`（`listDir` 在 `:160-161`，逐条 `exists` 在 `:162-168`）。它不在 #1129 的三条验收范围内（那三条只说「认领」），但它让「找 map.md 的成本随条目数增长」这件事在认领之后仍然成立一次；本仓 1929 个条目时这一趟仍是约 1929 次存在性判断。要不要一起收口，应由人定——收口的代价是 preflight 会像 `matches` 一样只认「根地图 + 声明」，子目录地图的工作区要靠声明文件才过预检。
- `src/host/remotePredicates.ts:66-85` 的健康判据同样是遍历，且注释自称与 `matches()` 同构；`matches` 变窄之后，这段注释与新行为不再逐字相符（它仍会把「只有子目录地图」的工作区判成「地图在」）。这是文档与实现要对齐的一处。
- `docs/architecture/markdown-backend-142-eval.md:14` 那句「枚举 `.scratch/map.md` + 各 slug/map.md」在改动后成了过时描述。
