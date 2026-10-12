# 票结构覆盖漏洞审查（对抗式）：#1010 这套票到底覆盖了哪些代码

审查口径：只读。日期 2026-10-12。审查对象是 #1010 子树下 15 张地图 + 66 张子票（票号 #1010–#1093，加 #1011、#1012 两张不在地图下的直接子票）的**票面**，对照物是仓里真实存在的代码。
本文件只做一件事：把「必须覆盖的代码」逐份列出来，再逐份对票面，指出没人认领的。

---

## 一句话结论

**不够，而且缺口是「文件级」的，不是「地图级」的。**
112 件要搬家的源码在 `research/1010-migration-map.json` 里有逐条登记，但 84 张票的正文里**没有一张点名过其中任何一份文件**（全仓只有 #1010 出现 3 次 `src/` 路径、#1011 1 次、#1012 14 次，66 张改写子票 0 次）；会因搬家而失配的引用面比唯一那份有文件名的材料（`research/1010-deck-blast-radius.md` 点名的 34 个测试文件）大得多——实测**79 个 tests/ 文件**真实引用老路径且没有任何材料点名；调用链上还有 `src/host/detectChain.js` 这种「不搬家、不在任何清单里、却 import 两个会被改名的文件」的件；门禁归属表（`npm run verify:changed` 挑门禁的唯一依据）会在搬家后**静默失效**，没有一张票负责；范围里「大量注释」那一条连兜底的票都没有。
按现在这套票开工，会有成片文件在没人认领的情况下被搬家波及，而门禁不会响。

---

## 一、我的筛选口径与所用命令（可复核）

### 1.1 口径五条

1. **唯一真源是 `git ls-files`**：只算仓里被跟踪的手写文件，不算磁盘上随手生成的东西。
2. **排除派生件**：`src/host/logPkg/*`（打包派生）、`scripts/generated/*`、`package/` 与 `lib/` 下的构建产物、`node_modules`、带 `AUTO-GENERATED` 头的文件；`docs/`、`research/`、`CHANGELOG.md` 里的历史记载也不计入（票面 #1072 自己写了「历史文档除外」）。
3. **「必须覆盖」= 落在 deck 工具链八层里、或引用这些层的件**：依据是 `research/1010-deck-chain-dirs.md` 的八层调用链与 `research/1010-migration-map.json` 的 112 条模块登记（110 条旧路径，**旧路径全部发生变化**：89 条 move-rename、1 条 split 成三件、14 条 gitlab path-only、6 条 stay-ext-change）。
4. **引用面**分两种口径算，别混：
   - **整串口径**：文件里出现 110 条旧路径之一的完整字符串（用于抓 `readFileSync(path.join(ROOT,'src/host/...'))` 这类写法）；
   - **严格口径**：把 `import`／`require` 的相对说明符按磁盘真实解析（依次补 `.js`／`.ts`／`index.js`），并把 `path.join(ROOT,'src','host',…)` 这种多段字符串拼回路径再比对。
5. **认领判定**：只有票号能认领。研究文档（`research/*.md`）里点过名不算认领——它们不进任何一张票的边界。

### 1.2 用过的命令

```powershell
git ls-files                                   # 1693 个 tracked 文件
git ls-files src/host/tracker/backends/github  # 房间文件逐个点名
git grep -n "<旧路径>" -- <目录>                # 引用点位（带行号）
gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/<号>            # 1010..1093 共 84 张正文
gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/1010/sub_issues # 43 张直接子票
node <临时脚本>                                # 严格口径扫描（说明符解析 + path.join 拼接）
```

严格口径扫描脚本的两段核心逻辑（可复现）：
`cands = [base, base+'.js', base+'.ts', base+'.mjs', base+'.cjs', base/'index.js', base/'index.ts']`，命中即算引用；
`path.join(...)` 形式则把括号里的字符串字面量按 `/` 拼回再比对。

### 1.3 顺手更正的计数（任务书数字 vs 实测）

| 任务书说法 | 实测 | 证据 |
| --- | --- | --- |
| 68 张子票 | **66 张**（15 张地图下共 66 张 child） | `issues/1010/sub_issues` 返回 43 张 ＝ 15 张地图 + 27 张旧故障票 + #1012；#1010–#1093 区间内 map 类 16 张（含 #1010 自己）、非 map 类 66 张 |
| 28 张旧故障票 | **27 张旧故障票 + #1012**（#1012 是独立的 TS 功能票，不是故障票） | 同上 |
| 地图 08「GitHub 房 28 件」 | **26 件** | `git ls-files src/host/tracker/backends/github/`；26+23(markdown)+14(gitlab)+1(backends/README.md)＝64，正好等于映射表 rooms 组的条数 |
| 地图 09「Markdown 房 23 件」 | 23 件 ✓ | 同上 |
| verify 链 243 条 | `scripts.verify` 拆开 **240 条** + `test:smoke` 6 条 + 2 条孤立脚本（`verify-829-parent-reread.js`、`verify-971-markdown-parent.js`）＝ 247 条命令，其中 14 条红 | `research/1010-verify-baseline.md` |
| 迁移映射「91 个引用点」 | 映射表 `specifiers` 91 条，但它们的 `from` **全部落在 `src/host/**`**（`src/host` 13 + `platform` 25 + `refresh` 6 + `tools` 39 + `tracker` 6 + `tracker/detection` 2），三个房间里 0 条；严格口径实测「目标名字/目录也变、必须改写」的 src/ 内说明符有 **82 条，分布在 26 个文件**（含 github 房 6 个文件、gitlab 房 1 个） | 本轮实测，见 1.2 的脚本 |
| 「34 个测试文件要改」 | 那是**整串口径下的一个子集**；实测真实引用老路径的 tests/ 文件共 **79 个**没被它点名 | 1.1 的两种口径，取并集减 34 |

---

## 二、必须覆盖的代码清单（按调用链分组）

件数、逐份路径见配套清单文件 `research/1010-adversarial-coverage-files.txt`（556 行，A 节按新家目录分组列出 112 条 old → new）。这里给分组与代表件。

| 层 | 归属票 | 件数 | 代表件（旧 → 新） |
| --- | --- | --- | --- |
| L1 注册与装配 | 地图 03（#1029/#1031） | 6 | `src/host/platform/deckExec.js` → `src/deck/registration/host-delegate.ts`、`deckToolsAssembly.js` → `host-assemble.ts`、`deckToolsRow.js` → `agent-row.ts`、`src/shared/deck-tools/agent-register.js` → `register-options.ts`、`deckQuotaSync.js` → `quota-sync.ts`、`deckSandbox.js` → `sandbox-guard.ts` |
| L2 九个工具入口 | 地图 04（#1033/#1035） | 10 | 九个 `src/host/tools/deck*.js`（context / issue-create / issue-get / issue-list / issue-patch / issue-report / map-link / map-plan-create / map-snapshot）→ `src/deck/tools/*.ts`；`src/shared/deck-tools/plan.js` 拆成三件（`tool-order.ts` 等） |
| L3 共用壳 | 地图 05（#1037/#1039/#1040） | 10 | `src/shared/deck-tools/`：`shell.js` → `call-shell.ts`、`session-resolve.js` → `session-workdir.ts`、`call-scope.js` → `call-budget.ts`、`edges.js` → `edge-landing.ts`、`exec-cell.js` → `table-cell.ts`、`key-lock.js` → `write-mutex.ts`、`plan-store.js`、`workspace-file.js` 等 |
| L4 契约与注册表 | 地图 02（#1024）+ 地图 06（#1042） | 5 + 3 + 2 | `src/host/tracker/contract.js`（含 `contract-page.js`、`contract-label-colors.js`、`contract-idempotency.js`）→ `src/tracker/contract/*`；`registryCore.js`／`registryShape.js`／`registryViews.js` → `src/tracker/registry/*`；`src/host/tracker/index.js` → `src/tracker/index.ts`、`preflight.js` → `preflight.ts` |
| L5 识别判定 | 地图 07（#1046/#1048） | 6（+1 见缺口） | `src/host/tracker/detection/` 六件 → `src/tracker/detection/*.ts`；**调用方 `src/host/detectChain.js` 不在任何票里** |
| L6 三个房间 | 地图 08（#1050）／09（#1056）／10（#1062） | 26 + 23 + 14 + 1 | `src/host/tracker/backends/{github,markdown,gitlab}/**` → `src/tracker/rooms/*`（文件名基本不动，gitlab 只改目录） |
| L7 最底层 | 地图 11（#1066） | **映射表里 0 件** | 见「范围虚胖清单」第 1 条：`repoKeys.js`、`refresh/gate.js`、`ledger.js`、`shared/refresh/budget.js`、`tool-cost.js`、`platform/{win32,linux,darwin}/index.js` 在 `modules` 里查不到 |
| L8 宿主接线与读数 | 地图 12（#1072/#1074） | 6 | `src/host/index.js`、`platformChannel.js`、`refresh/wiring.js`、`workspaceCwd.js`、`issueDetail.js`、`remotePredicates.js`：**路径不变、扩展名 `.js` → `.ts`** |
| L9 收口 | 地图 13（#1076/#1078） | — | 全域索引与「手写 js 归零」核对 |
| 外围：测试与脚本 | 地图 01（#1013 系列） | tests/ 343 个脚本（79 个真实引用老路径、34 个被点名）+ `tests/lib/*`（5）+ `tests/fixtures/*`（13）+ `tests/tracker-contract/**`（33）；scripts/ 41 个手写脚本（7 个引用老路径） | 见第三节 |
| 外围：登记与配置 | 无票 | 6 个 tsconfig、`package.json`、`tests/gate-map.json`、两份基线 | 见第三节 |

合计需要有人认领的件：**112（搬家）+ 79（tests 引用面）+ 7（scripts）+ 1（detectChain.js）+ 6（登记配置文件）+ 3（登记表：gate-map.json 与两份基线）**。其中 112 件有映射表登记但没有票面认领，其余基本都是「有票但票面不点名」或「完全没有票」。

---

## 三、无人认领的清单

### A. 调用链上（src/）

1. **`src/host/detectChain.js`**（不搬家）
   - 为什么属于：它是识别判定链的组装调用者，两处 import 指向会被改名/换目录的文件——`:22 const mod = await import('./tracker/detection/preflightScope.js')`、`:224 const fixMod = await import('./tracker/fixContract.js')`。它既不在 112 件里，也不在地图 12 正文点名的 6 个引用点里。
   - 补到哪：**#1074（地图 12 开发：引用点与读数）正文补第 7 件**；或在地图 07 的 #1046/#1048 里写明「调用方适配由 #1074 之外谁接」。
2. **`src/host/tracker/index.js` 的 re-export 缝**（它自己要搬到 `src/tracker/index.ts`）
   - 为什么属于：`:10` re-export `./contract.js`、`:11` `./registryCore.js`、`:13` `./registryShape.js`、`:15` `./preflight.js` 都是要搬的件，但 `:16` 还 re-export `./snapshot.js`，而映射表把 `src/host/tracker/snapshot.js` 判为**范围外**（outOfScope 原文：「属检查链与谓词那一摊，deck 调用链不经过，本次不动」）。新树 TS 聚合出口要 import 一个留在旧家、保持 `.js` 的文件——这种「混搭」在 66 张票里没有一句话交代。
   - 补到哪：**#1044（地图 06 开发）**正文补一条边界说明，或新开一张「跨代接缝」票。
3. **已经在树上的 `src/tracker/contract/` 九个文件 + 守着它们的门禁**
   - 为什么属于：`git ls-files src/tracker/contract/` = `README.md`、`backend-module.ts`、`contexts.ts`、`entities.ts`、`identity.ts`、`inputs.ts`、`operations-catalog.ts`、`operations.ts`、`results.ts`。它们不是「将来才有的目标」，而是**已经落地的第二真源**：`src/tracker/contract/README.md:112` 自述「迁移期它与运行时 `src/host/tracker/contract.js` 的 `OPERATIONS` 暂时并存，两边同集由门禁第四项守着」，`README.md:69` 也写着「今天运行时的真源仍然是 `src/host/tracker/contract.js` 与它的三份续篇」。对应的门禁是 `tests/verify-contract-types.js`（`:60 const CONTRACT_DIR = resolveInRoot(process.env.DSH_CONTRACT_DIR || 'src/tracker/contract')`、`:66 const RUNTIME_CONTRACT_REL = 'src/host/tracker/contract.js'`），它的文件头 `:3`／`:4` 还写着两条 `// 门禁归属:`。
   - 补到哪：**#1024（地图 02）或 #1026** 正文正面写「这九个文件与 `tests/verify-contract-types.js` 由谁收编」。84 张票里 0 次点名它们。

### B. 引用面（tests/）：79 个文件

这 79 个 = 「整串口径下的活引用」（71 个）∪「严格口径解析到的」（33 个里的 32 个）− blast-radius 点名的 34 个。完整名单见配套清单文件 C3 节，按「该补到哪张票」分四组：

| 组 | 代表文件 | 为什么属于本次范围 | 补到哪张票 |
| --- | --- | --- | --- |
| 契约的可执行形式（14 个） | `tests/tracker-contract/runner/index.js`、`sections/{contract,counts,idempotency,idempotency-counterproof,idempotency-counterproof-markdown,labels,listPage,preflight,registry,snapshot}.js`、`fixtures/{gitlab,markdown}.js` | 它们 import 契约与两房（严格口径全部命中）；地图 02 只写「把手写契约转成 TypeScript」，没有一句提到这套跑法要不要跟着换、由谁换 | **新开一张「契约测试套件跟随」票**，或写进 #1024 的边界与做完的标志 |
| 日志门禁（12 个） | `tests/verify-log-store.js`、`tests/verify-log-exec-606.js`、`tests/verify-log-truncate.js` 等 | 日志是五条范围里的独立目标；#1016 只说「日志门禁」不点名文件，`research/489-appendix.md` 与 `docs/design/335-logging-contract.md` 也没被任何票点名 | **#1016 正文点名这个清单与两份基准文档** |
| 行为门禁（约 40 个） | `tests/verify-markdown-backend.js:14-16,69,70,147,185`、`tests/verify-markdown-label-colors.js`、`tests/verify-github-label-colors.js`、`tests/verify-gitlab-single-write.js`、`tests/verify-detection-cascade.js`、`tests/verify-bundled-discovery.js`、`tests/verify-691-map-subissues.js`、`tests/verify-922-ticket-file-queue.js`、`tests/verify-928-field-line-rewrite.js`、`tests/verify-970-whole-document.js`、`tests/verify-972-title-body.js`、`tests/verify-tracker-contract.js` 等 | 它们直接按旧路径 import 三房与判定链的模块（例如 `tests/verify-labels-sync.js:46 const ghModPath = path.join(ROOT, 'src/host/tracker/backends/github/index.js')`），搬家后要么报错要么静默指空 | **#1019（目录归位）正文点名这批文件**，或按单元分派给对应地图（08/09/11） |
| 登记表与基线（3 个） | `tests/gate-map.json`（112 条旧路径全在里面）、`tests/file-granularity-baseline.json`、`tests/same-layer-baseline.json` | 它们不是测试脚本，是**机器登记的旧路径**：`gate-map.json` 是 `verify:changed` 挑门禁的唯一依据；两份基线按文件名与行数记录现状 | **#1019** 与 **#1017** 都要写；见第四节第 1 条 |

补充：`tests/verify-3-workspace-switch.js`、`verify-686-accept.js`、`verify-730-cwd-consistent.js`、`verify-issue297.js` 这 4 个走的是 `path.join(ROOT,'src','host',…)` 分段写法（整串口径看不见，只有严格口径能抓到），跟 #1003/#1012 的「13 个重叠文件」尾巴票有关系——见 C 组。

### C. 外围脚本、配置与登记（票面 0 次点名）

1. **6 个 scripts/ 脚本引用老路径**（映射表与 blast-radius 只认了 `scripts/build.mjs` 一个）：
   `scripts/generate-github-fixtures.js`（github/normalize.js）、`scripts/generate-markdown-fixtures.js`（markdown/normalize.js、parse.js）、`scripts/matrix-full.js`（github/index.js、normalize.js、markdown/index.js、normalize.js、path.js）、`scripts/matrix-smoke.js`（github/index.js）、`scripts/measure-967-outbound.js`（github/client.js、preflightScope.js）、`scripts/wire-subissues.mjs`（github/graph.js、parseIssueTracker.js）。
   为什么属于：都在仓里真跑，改完路径会静默指空。补到哪：**新开一张「scripts/ 跟随改名」票**，或写进 #1019。
2. **`package.json`**：84 张票里 `package.json` 命中 0 次；而映射表 `manualOnly` 里就有一条 `package/package.json:21`（`"./tools": "./lib/platform/deckToolsRow.js"`，标着「要人拿主意」），另加 `scripts/build.mjs` 的登记清单。#1018（发布链路）与 #1023（让 .ts 进构建）只在射程边缘。补到哪：**#1023 或 #1018 正文点名 `package.json` 的 `exports` 与 `scripts`**。
3. **tsconfig**：仓里只有 6 个（四个计算核各一 + `tsconfig.client.json` + `tsconfig.contract.json`），84 张票里只有 #1012 提到 `tsconfig`（2 次）。新树（`src/deck/**`、`src/tracker/**`）要不要新开配置、谁登记、#1020 的「边界守卫」挂在哪个配置上——没有票写。补到哪：**#1020（类型检查与边界）正文点名配置清单**。
4. **注释与日志的两份基准文档**：`research/489-appendix.md`（84 张票里只有 #1012 提 2 次）、`docs/design/335-logging-contract.md`（0 次）。#1016 说「事件常量、字段表、对照表与日志门禁先立起来」，但没点名这两份路径，而 AGENTS.md 的日志纪律第 4 条要求增删事件同步改 `research/489-appendix.md` 第 1 章对照表。补到哪：**#1016 正文点名**。
5. **`dsh-log` 与宿主日志接口**：实测 84 张票里 `dsh-log` 命中 0 次；`src/host/logPkg/*` 是打包派生件、`src/host/logStore.js` 与 `logFromPackage.js` 只在注释里提到 `src/host/index.js`（无活引用）。结论：**在本范围外**，但票面没写这句话。补到哪：**#1016 或 #1019 正文补一行口径**（「dsh-log 本体是外部 npm 包，不在本次范围；宿主日志接口不动」）。

### D. 声明过但没建的东西

- `research/1010-ticket-structure.md:177` 承诺：「#1003/#1012 那 13 个重叠文件（`workspace-file.js` 与 Markdown 房六个 `label-colors*`）单独留一张尾巴票，等它们收口再补搬」。实测：**43 张直接子票里没有这样一张票**，66 张改写子票里也没有一句认领；#1019 只写「与其它会话重叠的 13 个文件等它们收口后补搬」，补搬的执行者、判据、票号都没有。
  另外这份文档自己就数不平：`workspace-file.js` 一件加六个 `label-colors*` 是 7 件，却写成「13 个重叠文件」——13 这个数从哪里来，文档里没有第二个出处。
  补到哪：**要么按文档承诺补一张尾巴票，要么把 #1019 的边界改成「这 13 件由 #1019 自己在 X 条件下补搬」**。

---

## 四、范围虚胖清单（票面/文档写了，但不属于本次范围）

1. **地图 11「最底层」的名单，在映射表里几乎不存在。**
   `research/1010-ticket-structure.md` 的地图 11 一行把 `repoKeys.js`、`platform/{win32,linux,darwin}/index.js`、`refresh/gate.js`、`ledger.js`、`shared/refresh/budget.js`、`tool-cost.js`、Markdown `.scratch` 写入队列、快照四件都写了进去。我逐名到 `research/1010-migration-map.json` 的 `modules`（112 条）里查：`repoKeys`、`refresh/gate`、`ledger`、`refresh/budget`、`tool-cost`、`platform/win32`、`platform/linux`、`platform/darwin` **一个都查不到**；反过来 `outOfScope` 里明写 `../../shared/refresh/budget.js` 与 `../../shared/refresh/tool-cost.js`「目标不进本次搬家（`src/shared/**` 或 `src/host` 其他…）」，全局那条是「`src/client/**`、`src/shared/**` 其余件、refresh-core 等四个计算核：不在本次任务内」。
   → 地图 11 的三张开发票（#1068 进程、#1069 闸与账本、#1070 文件与快照）宣称的范围与映射表口径**方向相反**，必须在开工前对齐：要么把闸／账本／平台落点补进映射表，要么把地图 11 的边界收窄成「只动 `deckExec` 与额度同步那两件」。
   （注意：这段名单来自研究文档，不是票面——66 张子票正文不点名文件，所以票面本身「看着不胖」，是文档与映射表互相矛盾。）
2. **GitLab 房有两处互相矛盾的口径。**
   #1010 自己的 Notes 与 outOfScope 写「GitLab 房不在本次任务内，但目录要留好以后迁移与开发的位置（房间目录不动…）」；而地图 10（#1062）标题是「占位与迁移说明」、子票 #1064 是「目录归位与迁移说明」，映射表也把 14 个 gitlab 文件写成 path-only（新家 `src/tracker/rooms/gitlab/`）。**要么搬、要么不搬，两处不能同时为真**；外溢也不同：搬的话 6 个测试文件 + 1 个脚本（`tests/verify-gitlab-single-write.js` 等）要跟着改。开工前必须拍一次。
3. **功能线被收进改写地图，票面自身没有 TS/日志/注释约束。**
   #1012（配置存储统一改造）是 #1010 的直接子票，是独立功能线；地图 14／15（#1080 会话与在办票可见性、#1088 正文进度与用户原话）的七张／五张子票也是功能线（#1082 新增一个只读工具、#1090 三处进度口径统一…），正文里没有一句写「按本次口径用 TypeScript 写、带日志与注释」，只靠仓规 AGENTS.md「新增文件一律写 `.ts`」兜底。这不是错误，但**新人照票面开工会写出 `.js`**。
4. **反向核对：没有发现「票面点名了范围外的代码」这种情况，因为票面根本不点名文件。** 唯一两处口径冲突是上面第 1、2 条（夹在研究文档与映射表之间）。
   另外澄清一条容易误判的：`specs/1010-ts-rewrite-spec.md:144` 把「客户端（面板）的行为改动」列为 Out of Scope。我实测**今天没有任何客户端代码活引用 deck 链路的文件路径**——`src/client/**` 的命中全部落在注释里（例：`src/client/kernel/link.js:111`、`src/client/kernel/locale-labels.js:28`、`src/client/views/labels/labelColorErrors.js`、`useLabelColors.js`、`LabelColorDialog.js`）。所以这条 Out of Scope 今天不构成约束，本次**不需要动客户端文件**（面板与宿主的耦合是 RPC 方法名与快照字段，不是文件路径）。

---

## 五、最严重的发现（按严重程度排序）

### 1. 门禁归属表会在搬家后静默失效，没有任何票负责（最严重）

- `npm run verify:changed` 挑门禁的唯一依据是 `tests/gate-map.json`，它由 `scripts/gate-map.mjs` 生成；归属来源按可信度五条（`scripts/gate-map.mjs:15-22`）：①文件头 `// 门禁归属:` 注释（`scripts/gate-map.mjs:359` 的 `DIRECTIVE_RE`，全仓只有 4 个测试文件写了这条注释）②`readFileSync` 里的路径字符串 ③`require`／`import` ④静态 import 说明符 ⑤**兜底：文件里出现的、指向本仓源码目录、而且磁盘上真实存在的字符串字面量**（`scripts/gate-map.mjs:436`）。推不出归属的门禁记成 `unattributed`（`scripts/gate-map.mjs:22`）。
- 搬家之后，②③④⑤ 里的旧路径在磁盘上不存在了 → 这些门禁全部变成 `unattributed`，它们守着的目录与文件在新树上**没有任何门禁**；`scripts/lib/select-gates.mjs` 消费这张表挑门禁（`:45` 从 `gate-map.mjs` 导入、`:133-143` 收表、`:240-242` 读 `tests/gate-map.json`）。
- 而 `tests/verify-gate-map.js` 只查「字段写齐（`:104`）、归属统计自洽（`:118-123`）、`src/` 下每个文件要么有门禁要么在 `ungated` 里写了原因（`:174-206`）」——**没有一条下限断言**，所以整件事是静默的：`npm run verify` 全绿，改 `src/deck/**` 时 `verify:changed` 挑不出门禁来跑。
- 谁负责？没有票。#1017（门禁换轨）只写「今天三条结构门禁只扫 `.js` 文本（文件粒度那条覆盖 411 个 `.js`，`.ts` 是空窗），换成按 `.ts` 与依赖图判断」；#1019（目录归位）的做完的标志只写「三条结构门禁全绿」。
- 建议：#1019 的「做完的标志」加一条「`tests/gate-map.json` 重新生成后 `attributedGates` 不低于搬家前、新树每个目录都有门禁守着」，并在 #1017 正文点名 `scripts/gate-map.mjs` 与 `scripts/lib/select-gates.mjs`。

### 2. 「34 个测试文件」是唯一有文件名的材料，真身是 79 个

- 整串口径：`tests/` 下 129 个文件含旧路径字符串，其中活引用（出现旧路径且该行不是注释）71 个没有被 blast-radius 点名。
- 严格口径：`import` 说明符按磁盘解析 + `path.join` 拼接，`tests/` 下 33 个文件真实引用旧路径，其中 32 个没有被 blast-radius 点名（例如 `tests/verify-markdown-backend.js:14-16` 直接 `import … from '../src/host/tracker/backends/markdown/parse.js'`）。
- 两者并集去掉点名的 34 个 → **79 个文件既真实引用老路径、又没有任何材料认领**，含整套 `tests/tracker-contract/**`（14 个）、12 个 `verify-log-*`、以及 `verify-labels-sync.js:46`、`verify-contract-types.js:66` 这类硬编码路径的门禁。
- 后果：搬家之后这批文件里相当一部分会直接 import 失败；而 240 步的 verify 链平时只在被 `verify:changed` 挑中时才跑——正好和第 1 条叠在一起，**改坏了不一定有人发现**。

### 3. `src/host/detectChain.js` 是链上唯一「不搬家、不在任何票里、却 import 两个改名文件」的件

`:22 await import('./tracker/detection/preflightScope.js')`、`:224 await import('./tracker/fixContract.js')`。地图 12 只认 6 个引用点（`src/host/index.js`、`platformChannel.js`、`refresh/wiring.js`、`workspaceCwd.js`、`issueDetail.js`、`remotePredicates.js`），不含它；`research/1010-deck-blast-radius.md` 的「三甲」把它列为第 7 条，但研究文档不进任何票的边界。它是「这是哪个后端」判定的实际组装者（`src/host/index.js:137` 用动态 import 调它），改坏了整条判定会走不到。

### 4. 「大量注释」在票面上没有任何可检查标准，也没有兜底的票

五条范围的第 5 条（源码中有大量注释／帮助维护者了解每一个细节）在 66 张改写子票里的落点是「补注释」三个字（84 张票里「注释」28 次，全是这个用法）；唯一成文的判据在 `specs/1010-ts-rewrite-spec.md:106`：「文件头写「这一文件在链路哪一段、什么约定不能改、一个真实反例」；导出写清语义与失败形状；非显然分支写为什么」。
对照日志那一条：#1016 至少把「每张改写地图的开发票都带一句『本段日志点已加、对照表已更新』的验收项」写成了机制——但**这条验收项今天在 66 张开发票里一条都没有落地**（每张开发票的「做完的标志」只有一句话，`## 进度` 都是空的）。建议：仿 #1016 的口径给「注释」也立一张验收票，或在每张开发票的「做完的标志」里加一句引用 `specs/1010-ts-rewrite-spec.md:106`。

### 5. 日志的验收机制有票，但两份基准文档没人认领；`dsh-log` 的边界没写

84 张票里 `research/489-appendix.md` 只在 #1012 出现 2 次（另一条工作线），`docs/design/335-logging-contract.md` 出现 0 次；而 AGENTS.md 的日志纪律把「对照表」指向 `research/489-appendix.md` 第 1 章、把「门和表的松紧」指向 `docs/design/335-logging-contract.md` 第 3 章。#1016 说要立「事件常量、字段表、对照表与日志门禁」，没点名这两个路径；`dsh-log`（外部 npm 包）与宿主日志接口的边界也没有一张票写。建议：#1016 正文补「对照表 ＝ `research/489-appendix.md` 第 1 章」，并明确 `docs/design/335-logging-contract.md` 与 `dsh-log` 本次不动。

---

## 六、我没能核实的

1. **映射表 91 条说明符为什么只覆盖 `src/host/**` 的引用方，三个房间里 0 条。** 严格口径显示房间里至少 7 个文件（`github/backend.js`、`counts.js`、`page.js`、`preflight.js`、`repo.js`、`gitlab/index.js` 等）有「目标改名」的说明符必须改写。**猜测**：映射表只登记跨单元的引用点，房内相对引用被当成搬家的附随工作。
   **怎么证实**：读 `research/1010-migration-map.md` 的「引用点」一节口径，或直接问维护者。相关疑点：#1019 的判据「`git diff -M` 显示改动全是重命名」与「必须改写说明符」在逻辑上互斥——除非全仓靠 #1021 的装载钩子把 `./x.js` 解析到同名 `.ts`（那样同名件不用改）。我没核实装载钩子是否也用在 src/ 主代码，#1021 的标题与正文只说测试。
2. **79 个文件里哪些是硬报错、哪些只是文本断言过时。** 严格口径命中的 33 个是硬引用，另外 46 个只有字符串形式，得逐个看。**怎么证实**：对 79 个逐个跑一遍，或搬完在临时分支上跑 `node <file>`。
3. **地图 11 的落点到底是「映射表漏登记」还是「地图 11 的边界写错了」。** 两处原文我都引了，哪一处是笔误只有维护者知道。
4. **#1015「只建夹具与基准，不改产品行为」是否覆盖 `research/1010-verify-baseline.md` 里 12 条同根因红灯的修复。** 那 12 条的根因是夹具没给装配方传 `decideBackend`（该文档记载：壳 `src/shared/deck-tools/shell.js:176-180` 缺席即回 `unsupported`，而生产装配 `deckToolsAssembly.js:116` 总有）。**猜测**：不覆盖，因为 #1015 的产物是新的金标准夹具，不是修旧夹具。**怎么证实**：问维护者，或看 #1015 开工后「## 进度」节第一行。
5. **客户端 RPC 方法名与快照字段名会不会跟着改**（这决定面板要不要动）。我实测客户端对文件路径零依赖，但对方法名与字段名有依赖；票面 0 处提到，#1074 只写「只改引用点与读数」。
6. **我没有跑任何测试**（只读审查），所以「哪些红灯会因搬家变多」是推断，不是实测。

---

## 附：本次审查产出的文件

- 本文件：`research/1010-adversarial-coverage.md`
- 完整清单：`research/1010-adversarial-coverage-files.txt`（A 节 112 条 old → new 逐份；B 节映射表口径；C 节 tests 引用面三层；D 节 tests 以外命中文件；E 节筛选口径）
- 审查过程用的临时文件（`research/_scratch_*.txt`、`D:\Temp\*.mjs`）在交付前已删除，票面未作任何修改。
