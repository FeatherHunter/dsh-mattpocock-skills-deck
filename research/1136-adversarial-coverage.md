# #1136 对抗式审查·覆盖面（2026-10-14）

审查路线：**覆盖面**（旧路径的全仓清点、边界归属、撞车）。本文件是唯一写入物，仓库源码/测试/配置一个字未改。

基线说明：临时工作树 `D:\Temp\1136-cov` 钉在 `474602bd`（会话开始时 `origin/main`，也是票面 triage 的基线）。会话中途主工作树 HEAD 前移到 `b017068f`（#1150 提交），所以文中凡说「今天主仓」都指那棵**带 72 行未提交改动的工作树**，凡说「干净检出」都指 `474602bd` 的临时工作树。

---

## 0. 一句话结论

票面的病灶成立、诊断基本准确，但它把这件事的**形状**说小了：要改的不是两条正则，而是**同一处旧路径引出的三类假绿**（规则指空目录、门禁扫不到房间、机器读名单里 125 条幽灵），而且**能抄的那份「正确口径」自己也已经过期** —— `src/tracker/rooms/README.md:40-49` 的白名单按今天的真实引用面算，仍会让 12 个目标判红（其中 3 个是 `src/host/**`，任何一份房间纪律文档从来没放行过）。票面验收第 2 条（`verify-gate-map.js` 判绿）今天在干净检出上做不到，而且那一支已被 **#1124** 整条拆走。

---

## 1. 旧路径清点表

口径：`git ls-files`（1651 个 tracked 文件）逐条 `Select-String`，排除 `node_modules`、`.git`、构建产物目录、`.worktrees/`、`.compile/`、`tests/.tmp-repo-out*/`。`tracker/backends` 全仓 tracked 命中 547 行。

范畴代号：**A**＝守这条规则的资产（不改就自相矛盾，必须是本票的活）｜**B**＝与这条规则直接相关的说法（本票票面自己点名要顺手改的）｜**C**＝活文档路径刷新（本票之外，见第 2 节）｜**D**＝与 #1136 无关（历史笔记/产物）｜**E**＝活源码注释（同一病，是否本票改待定）｜**F**＝机器读资产里的幽灵条目（不归本票）

### 1.1 A 类：本票必须改（守这条规则的资产）

| 文件:行 | 原文 | 今天应该是什么 |
|---|---|---|
| `.dependency-cruiser.cjs:96` | `from: { path: '^src/host/tracker/backends/(github\|gitlab\|markdown)/' }` | `^src/tracker/rooms/(github\|gitlab\|markdown)/` |
| `.dependency-cruiser.cjs:100` | `pathNot: ['^src/host/tracker/backends/$1/'].concat(ROOM_WHITELIST)` | `'^src/tracker/rooms/$1/'` |
| `.dependency-cruiser.cjs:109` | `room-imports-third-party-package` 的 `from: '^src/host/tracker/backends/'` | `^src/tracker/rooms/` |
| `.dependency-cruiser.cjs:36` | `'^src/shared/labels\\.js$'`（**死条目**，该文件不存在） | 删（真身已被 `:39` 的 `^src/shared/config-store/` 覆盖） |
| `.dependency-cruiser.cjs:40` | `'^src/host/tracker/preflight\\.js$'`（**死条目**） | `'^src/tracker/preflight\\.ts$'` |
| `.dependency-cruiser.cjs:34-42` | 白名单 7 条，缺 `src/tracker/contract/**`、`src/tracker/identity-keys.ts`、`src/tracker/error-rules.ts`、`src/tracker/detection/workspace-ownership.ts`、`src/host/outbound/**`、`src/host/refresh/chain-ride.ts` | 按第 1.3 节实测的 12 个目标重列，并对 3 个 `src/host/**` 做明确决策 |
| `.dependency-cruiser.cjs:68-69` | `pathNot: ['^src/host/platform/', '^src/host/tracker/backends/']`（`same-layer-import-host` 的 from 与 to 各一处） | `'^src/tracker/rooms/'`（今天这条 pathNot 也是死的；房间已不在 `src/host/` 下，所以它今天既不判红也不放行——同批改掉） |
| `.dependency-cruiser.cjs:144` | `to: { path: '^(src/host/tracker/(backends\|detection)/\|src/tracker/rooms/)' }` | `^(src/tracker/(rooms\|detection)/)`（`backends` 与 `detection` 两条分支都已搬到 `src/tracker/`；`rooms` 那条已经写着） |
| `tests/verify-dependency-rules.ts:44` | `SCAN_TREES = ['src/host', 'src/shared', 'src/seam']` | 是否补 `src/tracker`：这是「房间到底被不被门禁看到」的开关，见第 3.3 节实测 |
| `tests/verify-dependency-rules.ts:427` | `'src/host/tracker/detection/backendDecision.ts'`（`hostTargets` 自检夹具） | `'src/tracker/detection/backendDecision.ts'`（原字面量在磁盘上不存在） |
| `tests/verify-dependency-rules.ts:439` | `'src/shared/labels.js'`（「不误伤」夹具） | 该文件不存在；今天同族的真身是 `src/tracker/contract/canonical-labels.ts`（或 `src/shared/config-store/labels.js`），需票内定性 |
| `tests/verify-dependency-rules.ts:432` | `'src/client/views/deck.ts'`（「会判红」夹具） | 全仓未见这个文件（`src/client/views` 下没有 `deck*`），需票内定性 |
| `tests/verify-dependency-rules.ts:447` | `'src/tracker/contract/deck.ts'`（「放行契约」夹具） | `src/tracker/contract/` 下今天没有 `deck.ts`（16 个文件里没有它），需票内定性 |
| `tests/verify-deck-tools-host-wiring.js:46` | **活代码** `if (posixPath === 'src/host/tracker/backends' \|\| posixPath.startsWith('src/host/tracker/backends/')) return 'backends'` | `src/tracker/rooms`（这条分支今天永不命中 → 该门禁把房间当普通源码算，是同一类假绿） |

**为什么 `:427/:432/:439/:447` 那四条夹具也算 A 类**：`scripts/gate-map.mjs:428` 的 `deriveGuards` 会把门禁文件里的路径字面量当归属依据，但**只收磁盘上存在的**（第三参数 `exists`）。所以这四条不存在的字面量被静默丢弃 —— 实测 `tests/gate-map.json` 里 `verify-dependency-rules` 那条的 `guards` 只有 12 条，`reason` 写着「源码里的路径字面量 11 条」，而上表这 4 条一条都不在里面。**同一处旧路径在这里造成第三种假绿：门禁自称守住的东西，随路径过期悄悄缩水，没有任何断言会发现。**

### 1.2 B 类：与这条规则直接相关的说法（本票票面已点名）

| 文件:行 | 原文 | 今天应该是什么 |
|---|---|---|
| `CONTEXT.md:35` | 「房间（room）: 三座内置后端各自的目录（`src/host/tracker/backends/<name>/`）」 | `src/tracker/rooms/<name>/` |
| `CONTEXT.md:36` | 「白名单与纪律常驻 `host/tracker/backends/README.md` 与那份规则文件」 | `src/tracker/rooms/README.md` |
| `.dependency-cruiser.cjs:31` | 注释「房间（`src/host/tracker/backends/<名字>/`）可以引用的房外目录」 | 新路径 |
| `.dependency-cruiser.cjs:95` | 注释点名 `src/host/tracker/backends/README.md` | `src/tracker/rooms/README.md` |
| `.dependency-cruiser.cjs:127` | 注释「今天 `src/host/tracker/backends/<名字>/`，搬家后 `src/tracker/rooms/<名字>/`」 | 已写双份，可收敛成一句 |
| `.dependency-cruiser.cjs:133,148` | 同族注释（`:148`「`src/host/tracker/backends/**` 只许 `src/host/tracker/` 区域内部引用」） | 新路径 |
| `.dependency-cruiser.cjs:18` | 「只看 `src/host`、`src/shared`、`src/seam` 三棵树 —— 与两条老门禁的扫描域逐字相同」 | 与 `tests/verify-dependency-rules.ts:44` 是同一件事的两处说法，一起决定是否加 `src/tracker` |
| `tests/same-layer-baseline.json:4` | note 里「backends 三房间不在此清单（房间纪律由 .dependency-cruiser.cjs 的 cross-room-import 一条守着，没有豁免）」 | 措辞改「三座房间住在 `src/tracker/rooms/`，不在此清单」 |
| `src/tracker/rooms/README.md:15-24` | 「一个后端目录的构成」逐条写 `index.js`/`client.js`/`queries.js`/`normalize.js`/`errors.js`/`preflight.js`/`issues.js`/`comments.js`/`labels.js`/`graph.js` | 今天多数已是 `.ts`。**#1118 没碰它，因为它的扫描器只认带 `src/` 前缀的路径**，这一节全是裸文件名 |
| `src/tracker/rooms/README.md:40-49` | 白名单 9 条（比 `.cjs` 新，但缺 `src/tracker/contract/**` 等） | 与 `.cjs:34-42` 同批重列，见第 1.3 节 |
| `src/tracker/rooms/README.md:65` | 「白名单与两条纪律同时写入本文件与根目录 `.dependency-cruiser.cjs`」 | 这句话今天**是假的**（两处白名单不一致），本票修完才成立 |

### 1.3 白名单要重列的实证（本票最重的一块）

探针 `D:\Temp\probe-rooms.mjs`（解析三房源码的 import 说明符、按配置文件里的正则逐条判定）：

```
房间源码文件数：65（github 27、gitlab 14、markdown 24）
房外引用目标（17 个）与两条规则的判定：
  [会判红  ] src/host/outbound/admission.ts   ← 房间 github
  [会判红  ] src/host/outbound/tiers.ts       ← 房间 github
  [会判红  ] src/host/refresh/chain-ride.ts   ← 房间 github
  [会判红  ] src/tracker/contract/canonical-labels.ts   ← 房间 github
  [会判红  ] src/tracker/contract/contract-page.ts      ← 房间 github
  [会判红  ] src/tracker/contract/index.ts              ← 房间 github
  [会判红  ] src/tracker/contract/operations.ts         ← github,gitlab,markdown
  [会判红  ] src/tracker/contract/vocabulary.js         ← github,gitlab,markdown
  [会判红  ] src/tracker/detection/workspace-ownership.ts ← 房间 github
  [会判红  ] src/tracker/error-rules.ts                 ← 房间 gitlab
  [会判红  ] src/tracker/identity-keys.ts               ← 房间 markdown
  [会判红  ] src/tracker/preflight.ts                   ← github,gitlab,markdown
  [白名单内] src/shared/config-store/labels.js、src/shared/label-color/colors.js、
            src/shared/refresh/create-write.js、src/shared/refresh/idempotency.js、
            src/shared/tracker/shape.js
白名单命中 5 / 17；会判红 12 个
node 内置：node:path      第三方包：（无）
```

三条要点：

1. **`^src/shared/tracker/` 不是死条目**（`src/shared/tracker/shape.js` 真实存在，仍被两房引用）。真正死掉的只有 `:36` 与 `:40` 两条。
2. **`src/tracker/rooms/README.md:40-49` 也没有 `src/tracker/contract/**`**（它只列了 `canonical-labels.ts` 一份），而实测房间引用的 `contract/` 文件有 5 份。**即「照 README 抄」照样会判红** —— 这份 README 是搬家时写的，从没跟搬家后的真实引用面对过账。
3. **3 个目标是 `src/host/**`（`outbound/admission.ts`、`outbound/tiers.ts`、`refresh/chain-ride.ts`），任何一份房间纪律文档（`.cjs` 七条、README 九条、`docs/adr/20260913-builtin-ts-shape.md:100` 记的四条起家版）从来没放行过 `src/host/outbound/**` 与 `src/host/refresh/**`。** 这不是「重列」能糊过去的：要么白名单加条目（＝放宽纪律，得写清理由），要么拆票把这三条边消掉。票面写「白名单要按今天房间真实引用面重列（否则一次涌出一批违规）」是对的，但**没意识到重列到哪一层为止需要一次架构决策**。

### 1.4 C 类：活文档（本票之外，见第 2 节）

| 文件:行 | 原文 | 今天应该是什么 |
|---|---|---|
| `src/host/platform/README.md:40` | 「契约层 `host/tracker/backends/*` 只依赖本层接口」 | `src/tracker/rooms/*`（**`src/**/README.md` 在 #1118 的范围内，但它今天仍写着旧路径 → 该票的漏网**） |
| `tests/tracker-contract/README.md:42,102` | `import { githubModule } from './src/host/tracker/backends/github/index.js'`、「`src/host/tracker/backends/<id>/` 适配器」 | `src/tracker/rooms/github/index.ts`（`tests/**` 不在 #1118 范围，见第 2 节） |
| `tests/tracker-contract/ONBOARDING.md:14,41,79` | 「适配器代码 — `src/host/tracker/backends/<backendId>/`」「`host/tracker/preflight.js`」等三处 | 新路径（同上，不在 #1118 范围） |
| `CONTEXT.md:115` | 「与 `src/shared/labels.js` 里同名标签的颜色一致」 | 该文件不存在，真身需票内定性（`src/shared/config-store/labels.js` 是构建产物；单源标签清单今天在 `src/tracker/contract/canonical-labels.ts`） |

### 1.5 D 类：与 #1136 无关（历史笔记与产物，按 #1118 立的边界一律不改）

`research/**`（`1010-adversarial-coverage-files.txt` 123 行、`1010-migration-map.json` 72、`998-q3-read-timeout.md` 14、`569-subissue-wiring.md` 10、`992-scene-verification.md` 9、`699-gh-auth-automation.md` 9、`568-body-write.md` 8、`291-contract-snapshot-impact.md` 8、`1010-deck-contract-surface.md` 8、`1010-deck-blast-radius.md` 8，以及 680/699/648/489/614/1012/930/1010-*/662 各 5–7 行等）、`docs/research/**`、`docs/reviews/**`、`docs/design/**`、`docs/adr/**`、`docs/architecture/*.html`、`docs/architecture/mattskills.architecture.json:123,126,159`、`docs/triage/**`、`CHANGELOG.md:96`、`show-me-metadata-progress-paths.html:267`。

其中两条值得单独记一笔（不是要改，是给后来人省一次考古）：

- `docs/adr/20260913-builtin-ts-shape.md:100` 逐字记着老白名单的起家四条（`src/shared/tracker/`、`src/shared/labels.js`、`src/host/tracker/preflight.js`、`src/host/platform/`）与它当时引用的一份**已删除的门禁** `tests/verify-no-cross-import.js` 的 `WHITELIST_RE`。`.dependency-cruiser.cjs:32-33` 的注释说自己是照抄那份 —— 这是「口径为什么长这样」的一手来源。
- `research/1010-migration-map.json:719-720, 779, 814, 821, 828-829` 是那次搬家的权威对照表（含 `src/host/tracker/preflight.js → src/tracker/preflight.ts`、`src/shared/labels.js → ?`、`src/shared/tracker/outbound-*.js → src/host/outbound/*.ts`、`src/shared/refresh/chain-ride.js → src/host/refresh/chain-ride.ts`）。谁要核对「今天应该是什么」，看它比看票面快。

### 1.6 E 类：活源码/测试里的旧路径注释（同一病，建议单独立票收拾）

`src/client/views/NoRepoCard.js:8`（`src/shared/labels.js`）、`src/client/kernel/locale-labels.js:28`（`src/host/tracker/backends/markdown/label-colors-ops.js`）、`src/client/kernel/link.js:111`（`src/host/tracker/backends/<id>/index.js`）、`src/host/publishFlow.js:6`、`src/deck/registration/host-assemble.ts:15`、`src/tracker/detection/backendDecision.ts:562`、`src/shared/refresh/src/create-write.ts:13,38`、`src/host/refresh/chain-ride.ts:1`（文件头写 `src/shared/refresh/chain-ride.js`）、`src/tracker/contract/canonical-labels.ts:2`（文件头写 `src/shared/labels.js`）、`src/tracker/rooms/github/index.ts:125,135,136`（三处 `src/shared/labels.js`，其中两处在**给用户看的提示词正文**里）、`src/tracker/rooms/github/{roster,parent-repair,cycle-check}.ts:1`、`src/tracker/rooms/github/init-project-error-kinds.ts:5`、`src/tracker/rooms/markdown/label-colors-palette.ts:3`、`tests/verify-665-fresh-workspace-chain.js:6`、`tests/verify-656-subworkspace-acceptance.js:22`、`tests/verify-deck-tools-host-wiring.js:41`。

判断：这些**全是注释**（`research/1010-ticket-structure.md:152` 早就证过「`src/client/**` 的命中全在注释里」），不影响行为，但 `src/tracker/rooms/github/index.ts:135,136` 那两处是**会显示给用户看的文案**（「色值/描述以 `src/shared/labels.js` 单源为准」），一处已经指空的路径出现在人读的界面文字里。

### 1.7 F 类：机器读资产里的幽灵条目（不归本票，但必须报）

`tests/handwritten-js-baseline.json`（`version 1`、`recordedAt 2026-10-13`、`files` 共 **714 条**，唯一消费者 `scripts/typecheck.mts:51`）：

- **714 条里有 125 条指向磁盘上不存在的文件**，按前缀：`src/host/tracker` 79、`src/shared/deck-tools` 10、`src/host/tools` 9、`src/host/platform` 8、`src/shared/tracker` 6、`src/host/refresh` 2、`src/shared/refresh` 2，其余单个（`src/host/detectChain.js`、`src/host/repoKeys.js`、`src/host/sessionRefresh.js` 等）。含本票点名的全部四个：`:324 src/host/tracker/preflight.js`、`:356 src/shared/labels.js`、`:363 src/shared/refresh/chain-ride.js`、`:380 src/shared/tracker/outbound-admission.js`、`:381 src/shared/tracker/outbound-tiers.js`。**`tracker/rooms` 命中 0 条。**
- 判定逻辑（`scripts/typecheck.mts:361-368`）：`added = current.filter(f => !inBaseline.has(f))`，断言 F（`:478-489`）**只在 `added` 非空时 fail**；`gone`（`:493`）只打 info「棘轮已缩 … 已不在名单里（转换完成、或文件被删）。不用做什么，看到它说明进展被记上了」。后果两条：(a) 每次跑 `npm run typecheck` 会刷 **125 行假进展**（实际是文件搬走了，不是转换完成）；(b) **旧路径上若重新出现一份手写 `.js`，它已经在名单里，不会判红** —— 棘轮对它守护的那批路径已经失效。
- 归属：这是 `.js`→`.ts` 迁移的账，不是房间纪律的账 → 归 #1148 那一批或新票，#1136 不该顺手改（改了会动 `scripts/typecheck.mts` 正在被人改的那个文件）。

---

## 2. 与 #1118 的边界

`gh issue view 1118 --json title,body,labels,state` 实测：**state `CLOSED`**，labels `ready-for-agent, wayfinder:task`，key `map06-live-doc-paths`。

它的范围与它自己写下的三条排除，**直接决定了本节的答案**：

1. **范围**：`docs/tour/`、`docs/architecture/`、`docs/agents/`、根 `README.md`、`CONTRIBUTING.md`、`examples/**/README.md`、`src/**/README.md` 共 33 份活文档里的 `src/...` 路径。它自报初测 91 处指不着 → 修 86 处（`af67c5d2`、`7bccb999`），第二轮对抗复核又修 259 处错行号（`55073d5a`），最终复扫 34 份只剩 2 处（都在 `src/shared/host-timer/README.md:24,38`，它明确说归那份文档自己的票）。
2. **它明确排除、并指名留给别人的三条**（这是判断归属最硬的证据）：(1) 根目录 `.dependency-cruiser.cjs` 的房间白名单与扫描域 —— 原话是仍写着搬迁前的 `^src/host/tracker/backends/`、`^src/shared/labels\.js$`、`^src/host/tracker/preflight\.js$`，**与 `src/tracker/rooms/README.md` 的说法对不上**；(2) 不带 `src/` 前缀的简写引用（`docs/tour/deck-call-end-to-end.md` 的 `kernel/store.js` 一类、`docs/architecture/ARCHITECTURE-SPLIT.md` 整篇）；(3) `docs/architecture/third-party-prompt-contract.md` 讲的三个能力今天全仓只在文档里出现。
3. **边界**：只改路径与因路径而不再对的行号/说法；**不改历史文档（`docs/research/`、`docs/design/`、`docs/triage/`）；不动代码。**

**结论（逐条归属）**：

- **必须由 #1136 一起改**（判据：不改就会让守这条规则的资产自相矛盾）：
  - `.dependency-cruiser.cjs` 的规则起点/`pathNot`/白名单/注释（第 1.1、1.2 节的 A、B 类）—— **#1118 逐字把它划出去了**；
  - `CONTEXT.md:35,36` —— 不在 #1118 的七类文档清单里（它只管 `docs/**` + 根 `README.md`/`CONTRIBUTING.md` + `examples/**/README.md` + `src/**/README.md`），**根目录 `CONTEXT.md` 谁都没认领**；
  - `tests/same-layer-baseline.json:4`、`tests/verify-dependency-rules.ts`、`tests/verify-deck-tools-host-wiring.js:46` —— #1118 明确「不动代码」，`tests/**` 也不在它范围；
  - `src/tracker/rooms/README.md:15-24` 的裸文件名与 `:40-49` 的白名单 —— 该文件虽在「`src/**/README.md`」这一类里，但 #1118 的扫描器只认 `src/` 前缀，**这 10 行从来不在它的射程内**（这也解释了为什么它报「只剩 2 处」而这一节原封不动）。
- **归 #1118 的尾巴（但该票已关，需新票或在 #1118 重开）**：`src/host/platform/README.md:40` 是**唯一一处落在 #1118 自报范围内、却仍写着旧路径的活文档** —— 它报「复扫 34 份只剩 2 处」时漏了这一份。这一条不改不会让本票的资产自相矛盾（README 不参与判定），所以**不必须由 #1136 背**。
- **两边都不在，今天无主**：`tests/tracker-contract/README.md:42,102`、`tests/tracker-contract/ONBOARDING.md:14,41,79`（`tests/**` 不在 #1118 范围，也不是本票的判定资产）。建议在 #1136 里只顺手改 `ONBOARDING.md:14` 那一句「适配器代码 — `src/host/tracker/backends/<backendId>/`」（它是 onboarding 的第一句路标），其余单独立一张「`tests/**` 里的旧路径」票。
- **`docs/architecture/mattskills.architecture.json`**：`docs/architecture/` 在 #1118 范围内，但它只认 `src/...` 文本命中、而这份是 JSON 数据（3 处），且 #1118 已关。归它自己的票，本票不动。

---

## 3. gate-map 这一支的真相

### 3.1 票面第 4 条今天不成立（逐字复核）

`Select-String tests\gate-map.json -Pattern 'backends'` 在 `474602bd` 上只有 2 处：`:6033 "src/client/kernel/builtin-backends.js"`、`:6182 "src/client/views/shared/BackendSelector.js"`。**没有 `src/host/tracker/backends`**。票面说的「6 条 FAIL 逐字一致、全部指向 `src/host/tracker/backends`」在 `474602bd`、`b017068f` 两处都不成立（票面自己的进度注记也已自认这一点）。

### 3.2 今天判红的真正来源（两种检出实测）

**没跑过构建的干净检出**（`D:\Temp\1136-cov`，`node --import ./scripts/ts-hook.mjs tests/verify-gate-map.js`）→ **exit 1，7 条 FAIL**：

```
FAIL 归属表是最新的：重新推导的结果与 tests/gate-map.json 一致（不一致就重跑 node scripts/gate-map.mjs）
FAIL 归属表里记的每个 guards 路径都在磁盘上真实存在（不存在的 200 条）
FAIL 覆盖面记的文件数与磁盘上 src/ 的文件数一致（表里 534，磁盘上 462）
FAIL guardedFiles 里没有磁盘上已经不存在的文件（多出来 72 个）
FAIL 底层共享模块 src/shared/refresh/budget.js 还在（场景三要用它）
FAIL 场景三：反向依赖 src/shared/refresh/budget.js 的那些门禁全被选中（该选 13 扇，漏 7 扇：tests/verify-naming-title-fact.js、tests/verify-1109-matches-timeout.ts、tests/verify-1115-timer-handle.ts）
INFO src/ 覆盖面：534/534 个文件有门禁，0 个没门禁；0 个目录整目录没覆盖；49/50 个目录有专属门禁（没专属门禁的 1 个：src/shared/config-store/src(4)）
```

**红因（探针 `D:\Temp\probe-gatemap.mjs` 逐条比对后确认）**：表里多出 **72 个磁盘上没有的 `.js`**，不是缺文件 —— 反向「磁盘上有、表里没提的」是 **0 个**，`ungatedDirs` 磁盘上不存在的也是 **0 个**。这 72 个全落在 `.gitignore` 里明写「不入库」的构建产物：`/src/shared/*/*.js`、`/src/tracker/contract/vocabulary.js`、`/src/client/kernel/{api-io,locale-cards,locale-skilldetail}.js`、`/src/client/views/SkillsTab.js`、`/src/client/views/{pixel,skillDetail,cards}/`、`/package/{lib,shared,deck,tracker}/`。同族证据：guards 里磁盘上不存在的 200 条（去重 53 条），按扩展名 `.js` 47 条 + 无扩展名 6 条（`package/scripts`、`package/deck` 一类）。**即 `tests/gate-map.json` 是在「跑过构建的树」上生成的**（那个树上 `src/` 有 534 个文件，含 72 个产物；`src/client/views/**` 更是 43 个 tracked `.js` 与 33 个 tracked `.ts` 并存）。

**跑过构建后**（`node scripts/build.mjs` → exit 0，末尾 `[moved-trees] 转译 138 份 TypeScript 进包（改写宿主引用 6 处），复制手写 JavaScript 13 份` / `[build] OK`）→ **FAIL 从 7 条降到 1 条**，只剩：

```
FAIL 归属表是最新的：重新推导的结果与 tests/gate-map.json 一致
INFO 落盘的表：链上 238 步，能推出归属 210 步，byDir 84 个目录，src 覆盖 534/534
INFO 第 103343 个字符起就不同了（表里是「-957-workspace-writer.js","guards":["docs/agents","src/deck/registration/host-assemble.ts","src/deck/shell/call-shell.ts」，实际是「-957-workspace-writer.js","guards":["docs/agents","src/deck/shell/call-shell.ts","src/deck/shell/workspace-anchor.ts","s」）
```

→ **这是第三重、也是唯一「真」的陈旧**：`tests/verify-957-workspace-writer.js` 的 guards 少了一个新文件 `src/deck/shell/workspace-anchor.ts`（以及相随的若干条），**与房间规则路径无关、与构建产物也无关**。跑 `node scripts/gate-map.mjs` 重生成（`git diff --stat tests/gate-map.json` = 3 insertions / 6 deletions）后 `verify-gate-map.js` 报 `全部通过（85 条断言）`、exit 0。

**CI 只在「先构建」这一种状态下判**（`.github/workflows/verify.yml:59-61` step「Build artifacts (Gate I3)」跑 `node scripts/build.mjs`，`:63-65` 才跑 `node scripts/verify-all.mjs`；矩阵 ubuntu/windows/macos）→ 干净检出必红、CI 除非陈旧否则绿，两边看到的状态从来不一样。

### 3.3 #1136 改完能不能转绿

**不能靠本票转绿，而且本票也不该背这个验收。** 三条理由，逐条有实测：

1. **`.dependency-cruiser.cjs` 根本不是 gate-map 的输入** —— `scripts/gate-map.mjs` 全文 grep 无 `dependency-cruiser` 字样；归因来自门禁文件自身的文本（`deriveGuards`，`:428`）。所以改规则起点对 gate-map 判红判绿**零影响**。
2. **真正会牵动 gate-map 的是 `tests/verify-dependency-rules.ts`**：若按票面「补 `src/tracker` 进根清单」（`:44`），那条的 `guards` 与字面量集合会变 → 新鲜度立刻判红 → 必须重跑 `node scripts/gate-map.mjs`。我实测那一条今天的 guards 是 12 条（`reason`：「静态 import 说明符 1 条；源码里的路径字面量 11 条」），而上面 1.1 节列的 4 条陈旧夹具字面量**已被静默丢弃**，所以修完这几条还会**多出新的归属**。
3. **验收第 2 条在干净检出上物理上做不到**：不先跑构建就永远有 4 条结构 FAIL 挡在前面，改什么规则都看不到绿。而这一整支（「`tests/gate-map.json` 不再要求入库与新鲜度门禁」「生成物若保留，只作人读报告，不进任何判据」）**已经被 `#1124` 整条认领**。

### 3.4 门禁到底扫不扫房间（本票另一处被说小的地方）

`tests/verify-dependency-rules.ts:44` 的 `SCAN_TREES = ['src/host', 'src/shared', 'src/seam']` 加 `:51` 的 `OPTIONAL_TREES = ['src/deck']`，房间只能**靠 import 边被顺带拉进图**。实测四根跑法：

| 检出 | 4 根（门禁今天的口径） | 5 根（补 `src/tracker`） |
|---|---|---|
| `474602bd` 干净树 | rooms 条目 56，**缺席 9 个**（`gitlab/{client,create-write,errors,graph-blocking,graph-membership,idempotency,normalize,queries}.js` + `markdown/normalize.ts`） | 73 条目 / 65 唯一，缺席 0 |
| 主工作树（gitlab 已转 `.ts`） | rooms 条目 64，缺席 1（`markdown/normalize.ts`） | 65，缺席 0 |

→ **即使把 `from` 指对，4 根口径下也有 9 个房间文件根本不在图里**（它们是 `.js`、由 `.ts` 的 `index` 引，解析路径上被落下）。这是一个和「规则指空目录」形状相同、但更隐蔽的假绿：**规则有牙了，可那 9 颗牙咬不到东西**。补第 5 根不是可选项。

---

## 4. 白名单四处口径与有没有比对门禁

### 4.1 「四处」其实只有两处列条目

| 位置 | 形态 | 内容 |
|---|---|---|
| `.dependency-cruiser.cjs:34-42` | **逐条列，7 条** | `^src/shared/tracker/`、`^src/shared/labels\.js$`、`^src/shared/label-color/`、`^src/shared/refresh/`、`^src/shared/config-store/`、`^src/host/tracker/preflight\.js$`、`^src/host/platform/` |
| `src/tracker/rooms/README.md:40-49` | **逐条列，9 项** | node 内置、同房间相对路径、`src/shared/tracker/**`、`src/tracker/contract/canonical-labels.ts`、`src/shared/label-color/**`、`src/shared/refresh/**`、`src/shared/config-store/**`、`src/tracker/preflight.ts`、`src/host/platform/**` |
| `CONTEXT.md:36` | **只按名字引用** | 「白名单与纪律常驻 `host/tracker/backends/README.md` 与那份规则文件」——不列条目（且路径是旧的） |
| `tests/same-layer-baseline.json:4` | **只按名字引用** | 「房间纪律由 .dependency-cruiser.cjs 的 cross-room-import 一条守着，没有豁免」——不列条目 |

**是不是同一份口径：不是。** 两处逐条列的差异恰好三条（其余是措辞：README 的「node 内置」「同房间相对路径」不是白名单条目 —— 规则的 `to` 只匹配 `^src/` 的房外目标，内置与同房间相对路径根本走不到白名单判定，所以那两条是解释不是分歧）：

- `.cjs:36` `^src/shared/labels\.js$` —— **死条目，README 侧没有**；
- `.cjs:40` `^src/host/tracker/preflight\.js$` —— **死条目**，README 侧已经是 `src/tracker/preflight.ts`；
- `src/tracker/contract/canonical-labels.ts` —— **README 侧有、`.cjs` 侧没有**。

**方向很清楚：README 是新口径（搬家时写的），`.cjs` 是旧口径（搬家前抄老门禁的）。** 但**新口径自己也漏**（第 1.3 节：`contract/**` 实际引用 5 份，README 只列 1 份；两个 `src/host/**` 目录从未被任何一版放行）。

### 4.2 有没有门禁比对它们一致：**全仓未见**

搜索口径：对 `tests/` 下全部 `*.{js,ts,mjs,mts,cjs}` grep `README\.md|CONTEXT\.md|rooms/README`（命中 37 处），**没有一处读 `src/tracker/rooms/README.md` 或 `CONTEXT.md` 做一致性比对**。相关的只有四个方向，全不相干：

- `tests/verify-readme-sync.js:5-7,63` —— 比根 `README.md` 与构建生成的 `package/README.md`（发布物同步）；
- `tests/verify-992-readonly-labels.js:241`、`tests/verify-release-contract.js:120,141` —— 读根 `README.md` 的版本号/文案；
- `tests/verify-gate-map.js:476` —— 把 `['README.md', true]` 当横切文件参与挑选场景；
- 若干往临时目录**写** `README.md` 的夹具（`verify-1003-single-outlet.js:198`、`verify-683-host-wiring.js:94,164`、`verify-no-mixed-session.js:103`、`verify-issue297.js:32`、`verify-t1-initpublish.js` 多处）。

也反向查过 `.dependency-cruiser.cjs` 的读者（tracked 逐条计数）：`.dependency-cruiser.cjs` 2、`CONTEXT.md` 1、`docs/architecture/split-blueprint.md` 1、`docs/design/335-logging-contract.md` 1、`research/1020-…` 3、`research/1034-…` 1、`research/1063-…` 3、`src/shared/refresh/README.md` 1、`src/shared/tracker/backendWritePermissions.js` 1、`src/tracker/detection/workspace-ownership.ts` 1、`src/tracker/rooms/github/init-project-error-kinds.ts` 1、`src/tracker/rooms/README.md` 2、`tests/same-layer-baseline.json` 1、`tests/verify-deck-tools-host-wiring.js` 2、`tests/verify-dependency-rules.ts` 5。**唯一读配置做判据的是 `tests/verify-dependency-rules.ts`（读规则名/severity/from/to 做自检），它读的是规则形状，不是白名单条目与文档口径的对表。**

→ **`src/tracker/rooms/README.md:65`「白名单与两条纪律同时写入本文件与根目录 .dependency-cruiser.cjs」这句承诺，今天没有任何门禁在守。**

### 4.3 要不要顺手加一条比对，代价多少

**代价很小**：在 `tests/verify-dependency-rules.ts` 里加一条断言，读 `src/tracker/rooms/README.md` 的清单段、与内存里的 `ROOM_WHITELIST`（配置已经被它 `require` 进来）互相比对即可 —— 无新文件、无新依赖、沿用现成的 `pass/fail` 骨架，跑一次是毫秒级。

**但建议本票不要顺手加**，理由两条：

1. **先定口径，再钉门禁。** 两处今天都对不上真实引用面（README 漏 `contract/**`、`.cjs` 还留着两条死条目、两个 `src/host/**` 目录谁都没放行）。这时候加比对，等于把「两处都错」固化成一条会判红的新门禁，本票的活立刻变成「先让它绿」。
2. **要解析 markdown，口径得先商量。** README 那份是人读的条目表（带说明文字、顺序、`/**` 与 `**` 混用、还有「node 内置」「同房间相对路径」两条不是白名单的条目）。要么给这一段定一个机器可读的固定形状（例如约定一个 `<!-- 白名单: 开始 -->` 的代码块），要么在比对里塞一堆例外 —— 前者更好，但那是一次文档格式约定，值得单独立票、单独评审。

**建议**：本票先把 `.cjs:34-42` 与 `README.md:40-49` 一起改成对的口径，并把这 12 个目标逐条落成一张「谁放行、为什么」的表写进票面；**比对门禁随后单开一票**，判据是「README 的清单段与 `ROOM_WHITELIST` 集合相等」。

---

## 5. 撞车检查

### 5.1 在办票

`gh issue list --state open --limit 80 --json number,title,labels` 之后逐条读正文：

| 票 | 状态 | 与本票的关系 |
|---|---|---|
| **#1124** `[wayfinder:task]` 归属从依赖图推导：手写声明降级为覆盖，生成物退出「必须入库」 | OPEN | **抢走 gate-map 那一支**：目标写明「`tests/gate-map.json` 不再要求入库与新鲜度门禁，`--changed` 改成按需推导加 gitignored 缓存」，验收含「生成物若保留，只作人读报告，不进任何判据」。→ 本票第 3 节查出的构建产物假红与新鲜度陈旧**全在它射程内**，本票的验收第 2 条应与它对齐或直接删掉。 |
| **#1064** `[wayfinder:task]` 地图10开发：房间目录归位与迁移说明 | OPEN | **本票是它的尾巴**。它自写边界「只搬目录与写说明，**代码不转 TypeScript**」，文件清单正是 gitlab 那 14 份（client、comments、create-write、errors、graph-blocking、graph-membership、graph、idempotency、index、issues、labels、normalize、preflight、queries）。而在办的正是给这 14 份做 `.js`→`.ts` → **归位这件事的收尾还没收完**。 |
| **#1148** `[bug,ready-for-agent,wayfinder:task]` `src/tracker` 四份 JSDoc 时代的文件严格模式下有 117 条错误 | OPEN | **主工作树那批未提交改动的主人**（`scripts/typecheck.mts`、`src/deck/tsconfig.json`、未跟踪的 `src/tracker/tsconfig.json`、`tests/verify-typecheck.mts`）。它自己的根因描述里也写着「文件头第一行还写着 `src/shared/parser.js` 这类旧路径」—— 同一族病的另一面。 |
| **#1118** 活文档里的路径刷新 | **CLOSED** | 第 2 节：它逐字把 `.cjs` 白名单/扫描域划出自己范围，`CONTEXT.md` 也不在它清单里 → 归本票。 |
| #1130、#1116、#1100、#1074、#1070/1069/1068/1063/1062/1060/1059/1058/1054/1053/1052/1050/1027 | OPEN | 均不碰 `.dependency-cruiser.cjs` / `CONTEXT.md` / `tests/same-layer-baseline.json` / `tests/verify-dependency-rules.ts`，文件级不冲突。 |

### 5.2 主工作树那批未提交改动（只读 `git status --porcelain` / `git diff --stat`）

- `git status --porcelain` 72 行；`git diff --stat` = **60 files, 3777 insertions(+), 1383 deletions(-)**。
- **直接落在本票同一片目录上**：`src/tracker/rooms/github/**` **8 份已修改**（cycle-check、errors、fallback-reason、index、init-project-error-kinds、normalize、repo、roster）、`src/tracker/rooms/markdown/**` **17 份已修改**、`src/tracker/rooms/gitlab/*.js → *.ts` **13 条已 staged 的重命名**（client、comments、create-write、errors、graph-blocking、graph-membership、graph、idempotency、issues、labels、normalize、preflight、queries；其中 `graph.js→graph.ts` 是纯 `R `，内容未改）+ `gitlab/index.ts` 已改。
- **本票要动的四个文件今天都是干净的**：`.dependency-cruiser.cjs`、`CONTEXT.md`、`tests/same-layer-baseline.json`、`tests/verify-dependency-rules.ts` 都不在改动清单里 → **文件级不冲突，判定级冲突**。
- 未跟踪件里有 `.typecheck-before.txt`、`.typecheck-after-1148-raw.txt`、`.typecheck-owned-semantics.txt`、`.verify-typecheck-out.txt`、`.build-1148.txt`、`.showconfig-deck.json`、`src/tracker/tsconfig.json`、`src/tracker/capability-assertions.ts`、`docs/tracker/`、`tests/verify-1144-markdown-issue-address.ts`。

### 5.3 `.js`→`.ts` 迁移会不会与本票互相影响：**会，而且是判定级的**

同一份「只改规则路径、白名单一个字不改」的补丁配置，在两棵树上跑真引擎（`D:\Temp\probe-engine.mjs`）：

| 检出 | 4 根 → cross-room-import | 5 根 → cross-room-import |
|---|---|---|
| `474602bd` 干净树 | **62 条** | **80 条** |
| 主工作树（gitlab 已转 `.ts`） | **175 条** | **176 条** |

（4 根口径下房间缺图：9 个 → 1 个；5 根口径下 65 个全进图，但 8 个 gitlab 文件会各出现两次 —— 73 条目 / 65 唯一。我实测 62/80，票面 triage 记的是 63/81，差 1，同量级，口径微差。）

目标分布（4 根 / 干净树）：`src/tracker/contract/vocabulary.js` 34、`src/tracker/preflight.ts` 19、`src/tracker/contract/operations.ts` 3，其余各 1。主工作树上因为 `contract/` 已经拆成 `contexts.ts`/`entities.ts`/`identity.ts`/`inputs.ts`/`results.ts`，目标分布变成 `contexts.ts` 29、`entities.ts` 28、`identity.ts` 16、`results.ts` 11、`inputs.ts` 10 —— **连「要往白名单里加哪几条」的答案都跟着变。**

**结论：本票动手前应当等 `src/tracker/rooms/**` 那批改动落地。** 理由不是「文件会冲突」（不冲突），而是**白名单要重列的清单本身依赖那批改动**：今天重列完，等 gitlab 迁移合进来，`contract/` 的拆分与 `.ts` 化会让清单立刻过期，而这份清单是「新增共享依赖须改白名单并在票据留痕」的判据（`src/tracker/rooms/README.md:65`）。等落地再动，一次改对；抢在前面动，必然改两遍。

---

## 6. 对抗面：我可能漏了什么

**先写清搜索口径**（可复核）：

- 命令：`git ls-files`（1651 个 tracked 文件）→ PowerShell `Select-String`。**`rg` 不在本机 PATH**（`rg: 术语 'rg' 不会被识别为 cmdlet…`），所以没有用 ripgrep。
- 主模式：`tracker/backends`（547 行命中）；补充模式：`labels\.js`、`chain-ride`、`outbound-tiers`、`outbound-admission`、`tracker/preflight`、`shared/labels`；另查 `.dependency-cruiser` 的读者、`README\.md|CONTEXT\.md|rooms/README` 在 `tests/` 下的读者。
- 排除：`node_modules`、`.git`、`.worktrees/**`、`.compile/**`、`.typecheck-*.txt`、`.tmp/**`、`tests/.tmp-repo-out*/**`、`.dsh-mattskillsdeck-cache/**`、`.scratch/**`。**教训**：一开始用 `Get-ChildItem -Recurse` 全扫，命中 8733 个文件 / 3627 行，其中 `.worktrees/963-*` 一个目录就贡献了数千行，完全淹掉真信号 —— 只有 `git ls-files` 口径可用。

**可能漏的六类，以及漏了会怎样**：

1. **只在构建产物里出现的旧路径**。`package/{lib,shared,deck,tracker}/**`、`src/shared/*/*.js`、`src/client/views/**` 的生成物都是 gitignored，不在我的口径里；而它们**正是 gate-map 假红的来源**。若某份产物里硬编码了 `src/host/tracker/backends`，我扫不到。**后果**：本票改完规则后，若产物里还留着旧路径，可能出现「源码判绿、发布包行为仍指旧路径」的偏差。**建议**本票施工后跑一次 `node scripts/build.mjs` 并 grep 产物。
2. **只在 `research/` 旧笔记里出现的路径**。我把 `research/**` 全归 D 类（历史）。但 `research/1010-migration-map.json` 其实是那次搬家的**权威对照表**；如果我误判了某条「今天应该是什么」，正确值就在它里面，而我没有逐条比对全部 547 行。**后果**：表里「今天应该是什么」一列可能有个别条目写错（尤其 `src/shared/labels.js` 的真身我至今没定性）。
3. **二进制 / 图片 / HTML 内嵌字符串**。我只扫了 `.js/.ts/.mjs/.mts/.cjs/.json/.md/.yml/.yaml/.html`，没读 `.png/.jpg`、没解析 PDF；`docs/**/*.html` 我只按文本命中了（`show-me-metadata-progress-paths.html:267` 就是文本命中的）。**后果**：某张架构图里画着旧目录，我会漏；本次不改图，风险低。
4. **不带 `src/` 前缀的简写路径**。#1118 明确说有这一类（`docs/tour/deck-call-end-to-end.md` 的 `kernel/store.js`、`panel/Overlay.js`；`docs/architecture/ARCHITECTURE-SPLIT.md` 整篇），**我沿用了它的结论、没有自己复扫**。`tests/tracker-contract/README.md:42` 的 `'./src/host/tracker/backends/github/index.js'` 是我自己撞见的，说明这一类确实还没扫干净。**后果**：`tests/**` 与 `docs/**` 里可能还有同类简写我没列出来。
5. **`.gitignore` 之外的其他忽略机制**（`.git/info/exclude`、全局 ignore、稀疏检出）。我用 `git ls-files`，被忽略的文件一律看不见。**后果**：同第 1 类。
6. **运行时拼接出来的路径**。若某处用 `path.join(ROOT, 'src', 'host', 'tracker', 'backends', ...)` 或模板字符串拼路径，纯文本 grep 会漏掉或只命中一半。我在 `scripts/gate-map.mjs:428` 的 `deriveGuards` 里见过 `path.join(ROOT,'a','b')` 这种形态被专门处理，说明**这种写法在仓里真实存在**。**后果**：可能有一处活代码在运行时指向旧目录而我没找到。**建议**本票施工后按 `src/host`, `'tracker'`, `'backends'` 三段字面量再扫一遍。

**另外两处我明确没做完的**：`src/shared/labels.js` 的今天真身（`src/shared/config-store/labels.js` 是构建产物、`src/tracker/contract/canonical-labels.ts` 是标签清单，两者都不是它的一对一后身）我没定性；`tests/verify-dependency-rules.ts:432` 的 `src/client/views/deck.ts` 与 `:447` 的 `src/tracker/contract/deck.ts` 我也没找到今天的对应物（`src/client/views` 下没有 `deck*`，`src/tracker/contract/` 16 个文件里没有 `deck.ts`）—— 这两条是**故意造的夹具**还是**陈旧引用**，需要票内定。

---

## 7. 对决议的建议

1. **票的定位要往上提一格**：不是「两条正则指空目录」，而是「**目录归位的收尾欠账**」——规则起点、扫描域、白名单、门禁夹具字面量、机器读名单，五处同一处旧路径，三种假绿（规则无牙 / 门禁扫不到房间 / 归属静默缩水）。#1064 那串收尾没收完，本票是它的尾巴，建议在票面与 `#1064` 之间补一条明写的父子关系或前后关系。
2. **验收标准换掉第 2 条**。`verify-gate-map.js` 判绿这一条：既与规则改动无关（`.cjs` 不是 gate-map 输入），又在干净检出上物理做不到（不先构建就 4 条结构 FAIL），而且已被 `#1124` 整条认领。改成两条可验的：① 探针能证明规则有牙（在 `src/tracker/rooms/github/index.ts` 末尾加跨房 import → 判红，删掉 → 判绿）；② `node scripts/gate-map.mjs` 重跑后 `verify-gate-map.js` 判绿（**前提是先跑过 `node scripts/build.mjs`**，把这一步写进验收步骤）。
3. **白名单重列前先落一次决策**。第 1.3 节的 12 个目标要逐条给结论，特别是 3 个 `src/host/**`（`outbound/admission.ts`、`outbound/tiers.ts`、`refresh/chain-ride.ts`）：加白名单（＝放宽纪律，写清为什么房间允许直连出站准入与搭车账本）还是拆票消边。**不要默认「照 README 抄」** —— README 自己也漏 `contract/**`。
4. **补 `src/tracker` 进 `SCAN_TREES` 应当是硬要求**，不是可选项：不补，4 根口径下 9 个房间文件（干净树）根本不在图里，规则修好了也咬不到它们。补完记得同步 `.dependency-cruiser.cjs:18` 那句「只看三棵树」的注释与 `tests/verify-dependency-rules.ts:32-33` 的自我描述。
5. **等 `src/tracker/rooms/**` 那批改动落地再动白名单**（第 5.3 节：同一份补丁在两种检出上涌出 62 → 175 条）。等待期内可以先做的、不受影响的部分：改 `.dependency-cruiser.cjs` 的规则起点/`pathNot`/注释、`CONTEXT.md:35,36`、`same-layer-baseline.json:4` 的措辞、`tests/verify-deck-tools-host-wiring.js:46` 的活代码分支。
6. **两份名单单独立票**：`tests/handwritten-js-baseline.json` 的 **125 条幽灵**（含「旧路径上重新出现手写 `.js` 不会被判红」这个真洞）与 `tests/**`+`docs/**` 里残留的简写路径（`ONBOARDING.md:14` 那类）。都不改会让守这条规则的资产自相矛盾，但都不是房间纪律的账。
7. **一致性比对门禁随后单开一票**（第 4.3 节），并把「README 的清单段定成机器可读的固定形状」作为那张票的第一步。

---

## 8. 未解问题

1. `src/shared/labels.js` 的今天真身是什么？`src/shared/config-store/labels.js`（构建产物）与 `src/tracker/contract/canonical-labels.ts`（单源标签清单）都不是它的一对一后身。这会影响 `.cjs:36` 该删还是该改写成新路径。
2. `tests/verify-dependency-rules.ts:432` 的 `src/client/views/deck.ts` 与 `:447` 的 `src/tracker/contract/deck.ts`：故意造的合成夹具，还是陈旧引用？前者决定要不要动，后者决定它算不算「归属缩水」的又一个例子。
3. 那 3 个 `src/host/**` 目标（`outbound/admission.ts`、`outbound/tiers.ts`、`refresh/chain-ride.ts`）该放行还是该消边？这是架构决策，不是清点能回答的。
4. `tests/verify-dependency-rules.ts:44` 补 `src/tracker` 之后，`same-layer-import-*` 那 106 条存量（70+27+6+3）会不会变化？我只测了 `cross-room-import` 的增量，没测同层规则在新根下的增量 —— **补根前应当先测一遍，否则可能一次涌出第二批存量要记名**。
5. `research/1010-migration-map.json` 里 `src/shared/labels.js` 的 `new` 字段到底是什么值？我没有逐条读完那份 72 处命中的对照表。

---

## 附：搜索口径与读过的一手材料

**命令与口径**：`git ls-files`（1651 tracked）→ `Select-String`；主模式 `tracker/backends`，补充模式 `labels\.js` / `chain-ride` / `outbound-tiers` / `outbound-admission` / `tracker/preflight` / `shared/labels` / `README\.md|CONTEXT\.md|rooms/README` / `.dependency-cruiser`。`rg` 不在 PATH。排除 `node_modules`、`.git`、`.worktrees/**`、`.compile/**`、`.typecheck-*.txt`、`.tmp/**`、`tests/.tmp-repo-out*/**`、`.dsh-mattskillsdeck-cache/**`、`.scratch/**`。

**完整读过的一手材料**：`.dependency-cruiser.cjs`（223 行全文）、`tests/verify-dependency-rules.ts`（640 行全文，重点 `:32-69`、`:242-244`、`:415-462`、`:637-640`）、`tests/verify-gate-map.js`（579 行全文）、`scripts/gate-map.mjs`（905 行，读关键段 `:84-90`、`:428`、`:507`）、`src/tracker/rooms/README.md`（81 行全文）、`CONTEXT.md`（相关词条）、`tests/same-layer-baseline.json`（头部与相关条目）、`tests/handwritten-js-baseline.json`（头部 + 全量存在性检查）、`scripts/typecheck.mts`（`:24,50-51,157,195,308,335-350,361-369,384-391,474-496,524`）、`.gitignore`（全文）、`.github/workflows/verify.yml`（91 行全文）。

**跑过的命令**（全部只读或只写仓外）：`gh auth status`、`gh issue view 1136/1118/1124/1064/1148`、`gh issue list --state open --limit 80`、`git rev-parse`、`git status --porcelain`、`git diff --stat`、`git ls-files`、`git ls-tree`、`git worktree list`、`node --import ./scripts/ts-hook.mjs tests/verify-gate-map.js`（干净树 → exit 1 / 7 FAIL；构建后 → exit 1 / 1 FAIL；重生成后 → exit 0 / 85 条断言）、`node scripts/build.mjs`（`D:\Temp\1136-cov`，exit 0）、`node scripts/gate-map.mjs`（同上，+3/−6 行）、`node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs <根们> --config <原/补丁> --output-type json`（两棵树 × 四组对照）。

**仓外自建物**（不在仓库内，可随时删）：`D:\Temp\1136-cov`（detached `474602bd`，`node_modules` 走 junction）、`D:\Temp\1136-patched.cjs`、探针 `probe-gatemap.mjs`（归属表与磁盘差异分类）、`probe-rooms.mjs`（房间真实引用面 vs 白名单）、`probe-engine.mjs`（改路径后跑真引擎数违规）、`probe-roommods.mjs`（房间模块进出图明细）、`probe-graph-any.mjs`（任给仓库跑 4 根/5 根数缺图）。

**清理**：`git -C D:\dsh-plugin\dsh-mattpocock-skills-deck worktree remove --force D:\Temp\1136-cov`
