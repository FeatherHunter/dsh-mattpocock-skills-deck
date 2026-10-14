# 手写 JavaScript 与 TypeScript 存量清点（2026-10-14）

这份报告回答一个具体问题：截止到写这份报告的这一刻，本仓库里还有多少**手写** JavaScript、多少**手写** TypeScript，比例是多少，距离「手写 JavaScript 清零」还有多远。

## 统计基线

| 项 | 值 |
|---|---|
| 仓库 | `D:\dsh-plugin\dsh-mattpocock-skills-deck` |
| commit | `83d649a9` |
| 统计时刻 | 2026-10-14 23:07:15 +08:00（本机时区） |
| 工作区改动 | `git status --porcelain` 共 16 条，逐条见下 |

```text
 M docs/agents/commit-convention.md
 M docs/tracker/capability-gitlab.md
 M src/tracker/rooms/gitlab/capability-register.ts
 M src/tracker/rooms/gitlab/index.ts
 M tests/tracker-contract/sections/counts.js
 M tests/tracker-contract/sections/labels.js
 M tests/tracker-contract/sections/listPage.js
?? research/js-ts-code-inventory-2026-10-14.md
?? src/tracker/rooms/gitlab/counts.ts
?? src/tracker/rooms/gitlab/identity-ops.ts
?? src/tracker/rooms/gitlab/init-project.ts
?? src/tracker/rooms/gitlab/labels-ops.ts
?? src/tracker/rooms/gitlab/pages.ts
?? src/tracker/rooms/gitlab/read-log.ts
?? src/tracker/rooms/gitlab/repo.ts
?? src/tracker/rooms/gitlab/sub-issues.ts
```

工作区里那批未提交的东西统计时一律**算进来**（用户问的是「截止到现在」，不是「截止到上一次提交」）。统计脚本把 commit、统计时刻与上面那份 `git status --porcelain` 的逐条输出一起落盘，报告里的每一个数字都来自这一次快照。列表里那条未跟踪的 `research/js-ts-code-inventory-2026-10-14.md` 就是本报告自己——统计时它刚由脚本落盘，所以也出现在改动列表里。还需要注意：统计期间工作区里有别人（另一个 agent）在改文件——`tests/tracker-contract/sections/` 下的 `counts.js`、`labels.js`、`listPage.js` 与 `src/tracker/rooms/gitlab/` 下的几份 `.ts` 都停在改动中。所以这份报告描述的是上面那一秒的状态，隔几分钟复跑会差几十行。

## 一句话结论

本仓库今天还有 **587 份手写脚本文件（`.js` 560 份、`.mjs` 26 份、`.cjs` 1 份）、119,115 物理行（90,285 非空非注释行）**；手写 TypeScript 是 **285 份、52,931 物理行（34,323 非空非注释行）**。按文件数是 **2.06 : 1**，按物理行数是 **2.25 : 1**，按非空非注释行数是 **2.63 : 1**——手写 JavaScript 的存量是 TypeScript 的两倍出头。只算 `.js` 对 `.ts` 这两个纯后缀，比例是 **1.99 : 1（文件数）与 2.14 : 1（物理行数）**。距离清零还差 587 份文件；若按 AGENTS.md 那句最严的口径「清零口径是手写 `.js` 归零」，要清的是 560 份、111,584 物理行。

## 统计口径

### 算进来的

1. **候选文件集合**取自 git，不自己扫目录：`git ls-files --cached --others --exclude-standard`。`--cached` 是已跟踪的文件，`--others` 是工作区里还没提交的新文件，`--exclude-standard` 让 `.gitignore` 的忽略规则生效。用 git 而不是目录遍历有三个好处：未提交的新文件不会被漏掉；已被 `.gitignore` 判为构建产物的文件不会混进来；将来别人复跑这份统计时看到的是同一个外部事实，而不是「我扫的时候目录里恰好有什么」。
2. **统计范围**是仓库里所有手写脚本与 TypeScript 源码，按顶层目录看包括：`src/`、`tests/`、`scripts/`、`docs/prototype/`、`examples/demo-mini/`，以及仓库根上散落的那一份配置文件。
3. **语言**：`.js`、`.mjs`、`.cjs`、`.ts`、`.mts`、`.tsx`、`.cts` 全部统计，但在每一张表里**分列**，不把 `.mjs` / `.cjs` 悄悄并进 `.js` 里。
4. **判定「手写」的规则**只有一条，就是 AGENTS.md 里写死的那条：**同目录下存在同名 `.ts` / `.mts` / `.tsx` 的 `.js` / `.mjs` / `.cjs`，一律算构建产物（派生文件），不算手写代码**；反过来，没有同名 TypeScript 真源的才算手写。实际执行时这条规则更像兜底：转译产物都有同名真源，而它们基本都已经写在 `.gitignore` 里，所以第一道筛选由 git 完成。今天这条规则在候选清单里额外抓出的派生文件是 0 份（候选里没有「带同名 `.ts`」的脚本），它是用来说明「万一有产物没被忽略也漏不掉」的保险；被 `.gitignore` 挡在候选之外的那 365 份里，有 36 份属于这一类。另外有 2 份派生文件没有同名真源（`scripts/generated/` 下，见下表），是按路径显式排除的。

### 排除的

| 排除对象 | 为什么排除 |
|---|---|
| `node_modules/`、`.git/` | 依赖与版本库内部数据，不是本仓库的代码 |
| `.scratch/`、`.tmp/`、`.dsh-tmp/`、`.worktrees/`、`.compile/`、`logs/`、`.r1047tmp/`、`.r1115tmp/`、`.local/`、`.dsh-mattskillsdeck-cache/`、`.dsh-vision-router/`、`tests/.tmp-repo-out*/` | 临时与本地工作目录。这里有几份文件是被误提交进索引的（`.r1047tmp/*.mjs`、`.scratch/cards-demo/*.cjs` 等），但它们按口径不属于仓库手写源码，一律排除 |
| 根 `client.js`、`host.js` | 构建产物，由 `scripts/build.mjs` 生成，已在 `.gitignore` 第 35-36 行声明不入库 |
| `package/lib/`、`package/scripts/`、`package/shared/`、`package/deck/`、`package/tracker/` | 发布包里的镜像，构建从 `src/` 复制过去，真源在 `src/` 那边（`.gitignore` 第 37-38、70-74 行） |
| `scripts/generated/` | 由 npm 包派生的产物（`derive-log-from-package.mjs`、`derive-update-from-package.mjs`），文件头写明「派生文件，人手不改」。它**没有**同名 `.ts`，所以单靠同名规则抓不住，是按路径显式排除的 |
| `src/shared/<功能名>/*.js`、`src/client/views/**` 与 `src/client/kernel/` 下同名 `.js`、`src/tracker/contract/vocabulary.js` | 逐文件转译出来的产物，真源是同名 `.ts`，`.gitignore` 第 54-69 行逐条声明 |

排除不是靠我一张嘴，也不是靠 `.gitignore` 单方面说了算：我另写了一份交叉核对脚本，把「磁盘上存在、但被 `.gitignore` 挡在候选清单外」的脚本逐份归类，结果是 **365 份：246 份文件头自称生成物、79 份是发布包镜像、36 份同目录就摆着同名 `.ts`、4 份是测试遗留的临时仓库副本，没有一份是「既没有同名 `.ts`、又不自称生成物」的可疑文件**。反过来，候选清单里的手写脚本里也没有混进构建产物（扫头部含「派生 / AUTO-GENERATED / 人手不改」字样的只有 2 份，正是上面显式排除的 `scripts/generated/` 那两份；另外 5 份命中是注释里提到产物名字的普通源码，例如 `tests/verify-update-panel.js`）。两组判据互相印证，没有漏判。

还可以直接从 git 对账，不经过脚本的分类逻辑：`git ls-files --cached --others --exclude-standard` 给出的脚本家族（`.js` / `.mjs` / `.cjs`）一共 598 份，拆开刚好是 **587 份手写 + 2 份 `scripts/generated/` 派生 + 9 份被误提交进索引的临时目录文件**（`.r1047tmp/` 4 份、`.r1115tmp/` 2 份、`.scratch/cards-demo/` 3 份）；TypeScript 侧（`.ts` / `.mts` / `.tsx` / `.cts`）是 285 份，与总表一致。

### 行数是怎么数的

- **物理行**：按 `\n` 或 `\r\n` 切分得到的行数。文件开头的 BOM 先剥掉，文件末尾的换行符不额外算一行空行。所以「物理行数」等于文本编辑器里显示的行数。
- **非空非注释行**：用一个逐字符的小状态机把注释剥掉，剩下的行里还有内容的才计数。它能正确处理三件事：行注释 `//`、块注释 `/* ... */`（含跨行）、以及字符串字面量里的 `//`（单引号、双引号、反引号三种；跨行模板字符串也算字符串）。**近似之处**：正则字面量不当字符串处理（`/a\/\/b/` 里的 `//` 会被误当成行注释），模板字符串里 `${...}` 中的代码不单独识别，转义只按反斜杠跳过下一个字符。本仓库的代码风格里正则很少写到跨行，这个近似的影响在个位数行量级。

### 抽样复核

脚本跑出来的清单，我手工开了几份确认分类没错：

| 文件 | 判断 | 依据（打开文件看到的事实） |
|---|---|---|
| `src/client/kernel/link.js` | 手写 | 文件头是维护者写的说明，没有生成横幅；同目录没有 `link.ts` |
| `src/host/index.js` | 手写 | 同上，是宿主入口代码，不是构建产物 |
| `tests/verify-chain.js` | 手写 | 链式验证脚本，内容是断言与说明，不是转译结果 |
| `src/shared/naming-titles.js` | 手写 | 同目录没有 `naming-titles.ts`，内容是手写的标题表 |
| `src/shared/version-control/exec-envelope.js` | 手写 | 同目录没有 `.ts`；`.gitignore` 第 60 行专门为它开了一条「不要忽略」的例外，正说明它是手写源码 |
| `src/client/views/SkillsTab.js` | 产物（未计入） | 文件头写明 `AUTO-GENERATED by node scripts/build.mjs`，真源是同目录的 `SkillsTab.ts`——按「同名 `.ts` 存在即为派生」判为产物，正确 |

## 总表：语言 × 文件数 × 物理行 × 非空非注释行

| 语言 | 手写文件数 | 手写物理行 | 手写非空非注释行 | 派生文件数 | 派生物理行 |
|---|---|---|---|---|---|
| js | 560 | 111,584 | 84,513 | 2 | 2,004 |
| ts | 282 | 52,104 | 33,856 | 0 | 0 |
| mjs | 26 | 7,266 | 5,608 | 0 | 0 |
| cjs | 1 | 265 | 164 | 0 | 0 |
| mts | 3 | 827 | 467 | 0 | 0 |
| **手写脚本合计（js+mjs+cjs）** | **587** | **119,115** | **90,285** | **2** | **2,004** |
| **手写 TypeScript 合计（ts+mts+tsx）** | **285** | **52,931** | **34,323** | — | — |

表里「派生文件」那一列是同一批语言里被判定为构建产物、没有计入手写存量的文件。它们只有 2 份，都在 `scripts/generated/` 下：`logKernel.derived.js`（从日志 npm 包派生）与 `updateClient.derived.js`（从更新包派生）。其余被排除的构建产物都已在 `.gitignore` 里，压根没进候选清单，所以在这一列里不出现。

**按顶层区域拆开看**：

| 区域 | 手写脚本文件数 | 脚本物理行 | 脚本非空非注释行 | 手写 TS 文件数 | TS 物理行 | TS 非空非注释行 |
|---|---|---|---|---|---|---|
| tests | 329 | 72,898 | 56,864 | 33 | 9,506 | 6,988 |
| src | 217 | 36,703 | 26,033 | 248 | 42,437 | 26,722 |
| scripts | 35 | 8,255 | 6,352 | 4 | 988 | 613 |
| docs | 2 | 592 | 572 | 0 | 0 | 0 |
| examples | 3 | 402 | 300 | 0 | 0 | 0 |
| (仓库根) | 1 | 265 | 164 | 0 | 0 | 0 |
| **合计** | **587** | **119,115** | **90,285** | **285** | **52,931** | **34,323** |

三个本来要交代的顶层目录是空的或没有脚本：`test/` 目录是空的；`acceptance/` 里只有 1 份 HTML；`wizard/` 里只有 1 份 shell 脚本。`package/` 下没有任何手写脚本（它的脚本全是发布包镜像，见上表排除项）。

## 按目录细分

### 手写脚本（.js / .mjs / .cjs）按目录

| 目录 | 文件数 | 物理行 | 非空非注释行 |
|---|---|---|---|
| tests | 300 | 67,654 | 53,010 |
| src/client | 134 | 22,511 | 16,251 |
| src/host | 53 | 10,373 | 7,523 |
| scripts | 32 | 7,601 | 5,971 |
| tests/tracker-contract | 19 | 4,413 | 3,336 |
| src/shared | 23 | 3,561 | 2,107 |
| scripts/lib | 3 | 654 | 381 |
| docs/prototype | 2 | 592 | 572 |
| tests/lib | 3 | 469 | 271 |
| examples/demo-mini | 3 | 402 | 300 |
| tests/fixtures | 7 | 362 | 247 |
| (仓库根) | 1 | 265 | 164 |
| src/seam | 7 | 258 | 152 |

### 手写 TypeScript（.ts / .mts / .tsx）按目录

| 目录 | 文件数 | 物理行 | 非空非注释行 |
|---|---|---|---|
| src/tracker | 115 | 21,825 | 12,892 |
| tests | 30 | 8,731 | 6,476 |
| src/deck | 38 | 6,820 | 4,583 |
| src/shared | 36 | 6,388 | 3,741 |
| src/host | 20 | 4,916 | 3,426 |
| src/client | 39 | 2,488 | 2,080 |
| scripts | 3 | 902 | 562 |
| tests/lib | 2 | 533 | 315 |
| tests/fixtures | 1 | 242 | 197 |
| scripts/lib | 1 | 86 | 51 |

`src/` 内部的分工很值得看清楚，它直接回答了「清零走到哪一步了」。剩下 217 份手写脚本、36,703 物理行（26,033 非空非注释行），而手写 TypeScript 已经有 248 份、42,437 物理行：`src/tracker/`（115 份 `.ts`、0 份手写脚本）与 `src/deck/`（38 份 `.ts`、0 份手写脚本）这两棵新树已经**全部是 TypeScript**；剩下的手写脚本集中在 `src/client/`（134 份）与 `src/host/`（53 份）这两棵老树上。

## 还剩的手写 JavaScript 逐文件明细

下表按目录分组，组内按物理行数从多到少排行。每行的完整路径 = 组标题里的目录 + 表格里的文件名。587 份文件全部在这里，没有省略。

### 手写脚本逐文件明细

**.**（1 份，合计 265 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `.dependency-cruiser.cjs` | 265 | 164 |

**docs/prototype**（2 份，合计 592 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `853-vc-lib.js` | 423 | 417 |
| `854-vc-layouts.js` | 169 | 155 |

**examples/demo-mini**（3 份，合计 402 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `index.js` | 185 | 130 |
| `normalize.js` | 159 | 129 |
| `matches.js` | 58 | 41 |

**scripts**（32 份，合计 7,601 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `build.mjs` | 1,480 | 1,143 |
| `gate-map.mjs` | 921 | 767 |
| `wire-subissues.mjs` | 887 | 726 |
| `fix-issue-body.mjs` | 468 | 381 |
| `verify-parallel.mjs` | 375 | 324 |
| `sync-matt-skills.mjs` | 278 | 228 |
| `matrix-full.js` | 268 | 230 |
| `gen-fixture-640.js` | 233 | 175 |
| `ui-repro-matt-demo.mjs` | 215 | 178 |
| `derive-log-from-package.mjs` | 200 | 141 |
| `matrix-smoke.js` | 182 | 139 |
| `derive-update-from-package.mjs` | 179 | 105 |
| `measure-967-outbound.js` | 175 | 132 |
| `ui-verify-registry.mjs` | 163 | 134 |
| `generate-github-fixtures.js` | 156 | 101 |
| `generate-markdown-fixtures.js` | 143 | 97 |
| `generate-star-history-svg.mjs` | 131 | 106 |
| `bundle-update-entry.mjs` | 128 | 98 |
| `create-release-issue.mjs` | 127 | 96 |
| `ui-align-black-panel.mjs` | 102 | 79 |
| `generate-demo-fixtures.js` | 96 | 81 |
| `ui-click-select-backend.mjs` | 96 | 86 |
| `ts-hook.mjs` | 79 | 43 |
| `verify-chain.js` | 78 | 60 |
| `browser-host.mjs` | 75 | 43 |
| `verify-all.mjs` | 73 | 49 |
| `ui-verify-new-settings.mjs` | 70 | 63 |
| `asar-extract.js` | 67 | 46 |
| `t3-extract.mjs` | 55 | 37 |
| `star-history.mjs` | 53 | 39 |
| `gen-fixture-423.js` | 38 | 37 |
| `update-star-history.mjs` | 10 | 7 |

**scripts/lib**（3 份，合计 654 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `select-gates.mjs` | 254 | 175 |
| `transpile-domains.mjs` | 202 | 114 |
| `transpile-unit.mjs` | 198 | 92 |

**src/client**（3 份，合计 548 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `index.js` | 350 | 65 |
| `panelAssembly.js` | 156 | 113 |
| `hostShim.js` | 42 | 21 |

**src/client/floating**（2 份，合计 177 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `SkillFloatList.js` | 112 | 100 |
| `Pop.js` | 65 | 59 |

**src/client/kernel**（49 份，合计 9,693 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `api-new-session.js` | 410 | 331 |
| `store-derived.js` | 372 | 312 |
| `locale-flow.js` | 356 | 333 |
| `store-snapshot.js` | 356 | 297 |
| `settings-debug.js` | 349 | 262 |
| `settings-view.js` | 349 | 214 |
| `locale-panel.js` | 347 | 329 |
| `api-naming.js` | 345 | 327 |
| `probe-auto.js` | 343 | 257 |
| `store-prefs.js` | 342 | 244 |
| `styles.js` | 340 | 235 |
| `slotRenderer-modal-view.js` | 337 | 300 |
| `locale-word.js` | 314 | 269 |
| `prompts.js` | 312 | 234 |
| `probe-snapshot.js` | 297 | 189 |
| `log.js` | 291 | 231 |
| `settings-view-write.js` | 288 | 180 |
| `store-switch.js` | 284 | 209 |
| `probe-select.js` | 243 | 138 |
| `actions.js` | 216 | 161 |
| `issue-pages.js` | 213 | 146 |
| `probe-chain.js` | 213 | 123 |
| `attention-heartbeat.js` | 211 | 152 |
| `settings-ui.js` | 185 | 111 |
| `router.js` | 177 | 108 |
| `locale-pages.js` | 164 | 102 |
| `api-workspace.js` | 156 | 131 |
| `settings-templates.js` | 155 | 89 |
| `locale-labels.js` | 150 | 108 |
| `slotRenderer-queue.js` | 148 | 122 |
| `slotRenderer-repo-sync.js` | 121 | 109 |
| `link.js` | 119 | 99 |
| `config.js` | 118 | 69 |
| `health-check.js` | 111 | 68 |
| `probe-snapshot-helpers.js` | 103 | 78 |
| `icons.js` | 92 | 65 |
| `locale-vcwrite.js` | 92 | 84 |
| `slots.js` | 89 | 61 |
| `api-preset-guard.js` | 83 | 67 |
| `prompts-setup.js` | 80 | 32 |
| `locale-skilldesc.js` | 74 | 60 |
| `probe-stale.js` | 66 | 33 |
| `settings-view-state.js` | 61 | 25 |
| `modal-fields.js` | 58 | 47 |
| `builtin-backends.js` | 47 | 30 |
| `ctx.js` | 40 | 14 |
| `portal.js` | 33 | 13 |
| `tabsfold.js` | 30 | 9 |
| `locale.js` | 13 | 4 |

**src/client/panel**（6 份，合计 652 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `Dock.js` | 349 | 254 |
| `DockSync.js` | 126 | 79 |
| `OverlayGate.js` | 72 | 62 |
| `headFold.js` | 54 | 31 |
| `NamingFailBanner.js` | 26 | 15 |
| `RepoChipSkeleton.js` | 25 | 5 |

**src/client/statusbar**（11 份，合计 2,067 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `StatusBar.js` | 359 | 233 |
| `StatusLogMenu.js` | 329 | 302 |
| `bannerChain.js` | 258 | 175 |
| `capFoldMachine.js` | 246 | 141 |
| `SessionChainCapsule.js` | 237 | 162 |
| `StatusBackend.js` | 208 | 126 |
| `capFold.js` | 173 | 76 |
| `StatusMenus.js` | 139 | 130 |
| `LogDangerConfirm.js` | 80 | 60 |
| `checksums.js` | 26 | 11 |
| `Seg.js` | 12 | 5 |

**src/client/views**（20 份，合计 3,203 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `IssueDetail.js` | 378 | 300 |
| `ListTab.js` | 349 | 264 |
| `SubworkspaceMark.js` | 328 | 182 |
| `MapDetail.js` | 306 | 244 |
| `NoRepoCard.js` | 300 | 271 |
| `ChecksTab.js` | 253 | 202 |
| `SettingsPage.js` | 234 | 180 |
| `IssueDetailComments.js` | 150 | 129 |
| `SettingsWorkspaces.js` | 147 | 126 |
| `ListTabRow.js` | 139 | 103 |
| `PrTab.js` | 93 | 71 |
| `MapDetailTop.js` | 87 | 71 |
| `useIssueDetailFold.js` | 78 | 71 |
| `ListTabClosed.js` | 70 | 48 |
| `MapDetailHead.js` | 63 | 45 |
| `issueDetailFold.js` | 60 | 37 |
| `SetupCard.js` | 53 | 27 |
| `TicketRow.js` | 46 | 36 |
| `UpdateEntryHost.js` | 45 | 28 |
| `RunPanel.js` | 24 | 17 |

**src/client/views/feedback**（1 份，合计 63 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `feedback-styles.js` | 63 | 35 |

**src/client/views/labels**（7 份，合计 1,309 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `labelColorErrors.js` | 366 | 223 |
| `LabelColorDialog.js` | 360 | 204 |
| `useLabelColors.js` | 217 | 133 |
| `labelColorPatch.js` | 134 | 86 |
| `LabelColorEntry.js` | 95 | 66 |
| `LabelColorRow.js` | 88 | 52 |
| `labelColorPalette.js` | 49 | 28 |

**src/client/views/primitives**（2 份，合计 233 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `HoverTip.js` | 193 | 183 |
| `Tip.js` | 40 | 32 |

**src/client/views/shared**（13 份，合计 1,581 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `sessionChainView.js` | 345 | 202 |
| `md.js` | 274 | 258 |
| `ChainRenderer.js` | 247 | 189 |
| `SwitchConfirmModal.js` | 194 | 154 |
| `truthLines.js` | 161 | 92 |
| `BackendSelector.js` | 74 | 66 |
| `Tabs.js` | 62 | 41 |
| `tagsFit.js` | 56 | 37 |
| `RestFallbackBanner.js` | 43 | 25 |
| `ticket.js` | 41 | 34 |
| `stateKind.js` | 36 | 11 |
| `chips.js` | 32 | 18 |
| `DebugSwitchFailHint.js` | 16 | 9 |

**src/client/views/versionControl**（20 份，合计 2,985 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `VersionControlTab.js` | 349 | 272 |
| `vcData.js` | 341 | 256 |
| `vcBlocks.js` | 265 | 197 |
| `vcWrite.js` | 209 | 152 |
| `vcWriteView.js` | 184 | 154 |
| `vcStyles.js` | 183 | 121 |
| `vcFold.js` | 177 | 110 |
| `vcWriteOps.js` | 174 | 150 |
| `vcRows.js` | 142 | 95 |
| `vcText.js` | 135 | 92 |
| `vcInView.js` | 129 | 80 |
| `vcWriteUi.js` | 124 | 99 |
| `vcWriteRun.js` | 106 | 73 |
| `vcViews.js` | 105 | 84 |
| `vcDiffOps.js` | 87 | 64 |
| `vcAiHandoff.js` | 80 | 61 |
| `vcCommit.js` | 75 | 52 |
| `vcDiff.js` | 53 | 35 |
| `vcCache.js` | 42 | 34 |
| `vcTabVisible.js` | 25 | 4 |

**src/host**（36 份，合计 6,736 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `workspaceCwd.js` | 416 | 326 |
| `namingGuardian.js` | 411 | 371 |
| `choiceStore.js` | 351 | 265 |
| `index.js` | 350 | 278 |
| `versionControl.js` | 341 | 257 |
| `configStore.js` | 332 | 251 |
| `issueList.js` | 321 | 271 |
| `commentThreads.js` | 304 | 250 |
| `logStore.js` | 278 | 246 |
| `skillProbe.js` | 262 | 227 |
| `workspaceKey.js` | 247 | 179 |
| `gitCredentialExec.js` | 246 | 164 |
| `bootstrap.js` | 224 | 211 |
| `workspaceLabelColors.js` | 223 | 115 |
| `versionControlWrite.js` | 222 | 180 |
| `sessionLifecycle.js` | 201 | 159 |
| `settingsPhones.js` | 190 | 131 |
| `rpcChannel.js` | 181 | 103 |
| `handoffClaim.js` | 178 | 136 |
| `updateFromPackage.js` | 167 | 104 |
| `mapTickets.js` | 157 | 91 |
| `issuePage.js` | 155 | 106 |
| `versionControlCheck.js` | 137 | 115 |
| `logPhones.js` | 118 | 111 |
| `pickerShell.js` | 114 | 97 |
| `versionControlFiles.js` | 106 | 66 |
| `mapBody.js` | 81 | 64 |
| `skillDoc.js` | 81 | 72 |
| `skillProbeCache.js` | 65 | 45 |
| `ticketGrouping.js` | 62 | 54 |
| `versionControlBasis.js` | 62 | 38 |
| `runningMarkers.js` | 43 | 29 |
| `stallWatch.js` | 42 | 16 |
| `logFromPackage.js` | 25 | 15 |
| `dispatchMeta.js` | 23 | 19 |
| `fsAbsence.js` | 20 | 7 |

**src/host/platform**（4 份，合计 644 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `namingSummary.js` | 291 | 257 |
| `index.js` | 211 | 131 |
| `issueIndexWindow.js` | 114 | 74 |
| `refreshAssembly.js` | 28 | 9 |

**src/host/refresh**（8 份，合计 2,090 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `wiring.js` | 494 | 328 |
| `writeEvents.js` | 413 | 280 |
| `patch.js` | 338 | 227 |
| `sessionTickets.js` | 273 | 175 |
| `attention.js` | 263 | 171 |
| `chainBackoff.js` | 157 | 91 |
| `sessionChainReadout.js` | 107 | 61 |
| `refreshSource.js` | 45 | 10 |

**src/host/tracker**（5 份，合计 903 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `snapshot.js` | 335 | 188 |
| `predicatePrimitives.js` | 252 | 183 |
| `generic.js` | 136 | 69 |
| `predicateCore.js` | 120 | 76 |
| `capability.js` | 60 | 24 |

**src/seam**（7 份，合计 258 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `gate.js` | 55 | 39 |
| `rpc.js` | 52 | 23 |
| `style.js` | 41 | 26 |
| `runtime.js` | 36 | 21 |
| `timer.js` | 29 | 17 |
| `index.js` | 24 | 14 |
| `editor.js` | 21 | 12 |

**src/shared**（10 份，合计 1,367 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `naming-tracking.js` | 347 | 249 |
| `naming-titles.js` | 217 | 141 |
| `skill-probe-channels.js` | 194 | 169 |
| `naming-attribution.js` | 172 | 118 |
| `feedback-map.js` | 145 | 94 |
| `workspaceKey.js` | 109 | 73 |
| `matt-skills.js` | 81 | 60 |
| `refresh-workspace-key.js` | 41 | 11 |
| `step-cost.js` | 36 | 19 |
| `session-cwd.js` | 25 | 10 |

**src/shared/tracker**（11 份，合计 2,073 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `guide-steps.js` | 284 | 179 |
| `chain-evaluate.js` | 268 | 192 |
| `check-catalog-dirs.js` | 245 | 171 |
| `chain-validate.js` | 244 | 191 |
| `chain-types.js` | 233 | 56 |
| `shape.js` | 227 | 3 |
| `sync.js` | 180 | 100 |
| `indexWindow.js` | 155 | 60 |
| `check-catalog-views.js` | 154 | 110 |
| `list-dedupe.js` | 54 | 25 |
| `backendWritePermissions.js` | 29 | 5 |

**src/shared/ui**（1 份，合计 96 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `slots.js` | 96 | 60 |

**src/shared/version-control**（1 份，合计 25 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `exec-envelope.js` | 25 | 11 |

**tests**（300 份，合计 67,654 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `verify-prompts.js` | 1,956 | 1,705 |
| `verify-settings-view.js` | 1,296 | 1,033 |
| `verify-settings-debug.js` | 1,252 | 990 |
| `verify-842-version-control-write-view.js` | 1,165 | 977 |
| `verify-818-version-control-view.js` | 937 | 824 |
| `verify-label-color-core.js` | 907 | 718 |
| `verify-cards-dir.js` | 898 | 720 |
| `verify-wire-subissues-script.js` | 834 | 699 |
| `verify-667-dock-header-no-brand.js` | 765 | 658 |
| `verify-skill-probe-redcard-and-waiting.js` | 713 | 632 |
| `verify-656-subworkspace-acceptance.js` | 685 | 518 |
| `verify-cap-fold.js` | 666 | 530 |
| `verify-github-label-colors.js` | 610 | 457 |
| `verify-version-control-host.js` | 608 | 523 |
| `verify-contract-types.js` | 590 | 402 |
| `verify-gate-map.js` | 579 | 456 |
| `verify-build-artifacts.js` | 552 | 308 |
| `verify-log-fields.js` | 530 | 288 |
| `verify-markdown-label-colors.js` | 530 | 414 |
| `verify-chain-view.js` | 518 | 362 |
| `verify-platform-contract.js` | 517 | 449 |
| `verify-cap-fold-browser.js` | 512 | 442 |
| `verify-newsession-workspace-fallback.js` | 500 | 415 |
| `verify-666-subws-mark-root.js` | 487 | 348 |
| `verify-deck-event-gate.mjs` | 447 | 354 |
| `verify-665-fresh-workspace-chain.js` | 446 | 343 |
| `verify-599-merged-pr.js` | 433 | 342 |
| `verify-deck-tools.js` | 433 | 347 |
| `verify-version-control-parsers.js` | 433 | 367 |
| `verify-669-choice-precedence.js` | 429 | 320 |
| `verify-naming-guardian.js` | 426 | 350 |
| `verify-subdir-first-frame.js` | 425 | 306 |
| `verify-669-collapsed-recoverable.js` | 424 | 329 |
| `verify-workspace-file-note.js` | 412 | 249 |
| `verify-settings-templates.js` | 399 | 324 |
| `verify-669-switch-visible.js` | 396 | 303 |
| `verify-t1-initpublish.js` | 393 | 327 |
| `verify-capsule-layout.js` | 381 | 309 |
| `verify-655-setup-layout.js` | 380 | 289 |
| `verify-release-contract.js` | 379 | 289 |
| `verify-683-host-wiring.js` | 369 | 298 |
| `verify-bundled-discovery.js` | 368 | 337 |
| `verify-newsession-preset-guard.js` | 368 | 299 |
| `verify-attention-model.js` | 360 | 264 |
| `verify-669-chain-after-pick.js` | 359 | 263 |
| `verify-839-credential-exec.js` | 350 | 286 |
| `verify-deck-tools-agent-register.js` | 349 | 283 |
| `verify-683-choice-store.js` | 346 | 260 |
| `verify-log-exec-606.js` | 342 | 274 |
| `verify-bundled-trio-matrix.js` | 340 | 293 |
| `verify-968-skill-ondemand.js` | 335 | 292 |
| `verify-895-bulk-deadline.js` | 328 | 284 |
| `verify-deck-tools-matrix.js` | 328 | 248 |
| `verify-chain-capsule.js` | 326 | 270 |
| `verify-723-gate-wiring.js` | 322 | 236 |
| `verify-markdown-backend.js` | 314 | 227 |
| `verify-capsule-narrow.js` | 313 | 245 |
| `verify-handoff-split.js` | 311 | 284 |
| `verify-issue-body-script.js` | 308 | 228 |
| `verify-698-switch-asks-layout.js` | 306 | 234 |
| `verify-settings-phones.js` | 305 | 262 |
| `verify-992-readonly-labels.js` | 304 | 252 |
| `verify-693-detail-fallback-honesty.js` | 302 | 231 |
| `verify-729-force-dedup.js` | 296 | 238 |
| `verify-naming-e2e.js` | 295 | 248 |
| `verify-deck-slots.js` | 294 | 240 |
| `verify-handoff-isolation-787.js` | 287 | 243 |
| `verify-chain-view-ui.js` | 286 | 215 |
| `verify-tracker-contract.js` | 286 | 219 |
| `verify-map-drill.js` | 282 | 209 |
| `verify-997-vc-sight-browser.js` | 279 | 238 |
| `verify-gitlab-single-write.js` | 278 | 198 |
| `verify-t1-getrepokey.js` | 277 | 203 |
| `verify-log-store.js` | 273 | 238 |
| `verify-1003-single-outlet.js` | 271 | 227 |
| `verify-646-native-tab.js` | 270 | 223 |
| `verify-t2-repokey-ui.js` | 270 | 231 |
| `verify-setup-describe.js` | 266 | 192 |
| `verify-refresh-workspace-key.js` | 262 | 198 |
| `verify-wizard-exit-609.js` | 261 | 207 |
| `verify-670-panel-first-frame.js` | 258 | 206 |
| `verify-deck-exec-phone.js` | 258 | 204 |
| `verify-deck-no-hang.js` | 252 | 185 |
| `verify-685-healthcheck-button.js` | 251 | 198 |
| `verify-no-mixed-session.js` | 249 | 200 |
| `deck-tools-matrix-transports.js` | 245 | 196 |
| `verify-chain.js` | 245 | 180 |
| `verify-contract-vocabulary.js` | 244 | 132 |
| `verify-gh-gateway.js` | 244 | 176 |
| `verify-visible-truth.js` | 244 | 176 |
| `verify-b2-map-newsession.js` | 238 | 182 |
| `verify-platform-linux.js` | 238 | 172 |
| `verify-deck-quota-sync.js` | 234 | 199 |
| `verify-709-no-self-continuing-timers.js` | 233 | 188 |
| `verify-delta-wiring.js` | 233 | 186 |
| `smoke-host-dispatch.test.js` | 232 | 177 |
| `verify-panel-workspace-shared.js` | 232 | 176 |
| `smoke-naming-persistence.test.js` | 231 | 176 |
| `verify-delta-patch.js` | 231 | 193 |
| `smoke-render.test.js` | 228 | 175 |
| `verify-653-subworkspace.js` | 228 | 149 |
| `verify-898-block-merge.js` | 224 | 190 |
| `verify-log-client.js` | 224 | 185 |
| `verify-691-markdown-counts-page.js` | 223 | 175 |
| `verify-matt-skills-sync.js` | 223 | 193 |
| `verify-790-parent-edge.js` | 222 | 187 |
| `verify-log-switch-597.js` | 222 | 167 |
| `verify-policy.js` | 221 | 188 |
| `verify-730-cwd-consistent.js` | 220 | 176 |
| `verify-696-shared-cache.js` | 219 | 176 |
| `verify-chain-renderer.js` | 218 | 179 |
| `verify-907-chain-titles.js` | 215 | 175 |
| `verify-chain-env-e2e.js` | 215 | 152 |
| `verify-690-closed-pages.js` | 212 | 165 |
| `verify-detection-cascade.js` | 202 | 153 |
| `verify-bug-entry.js` | 201 | 163 |
| `verify-deck-repo-resolve.js` | 198 | 142 |
| `verify-964-same-key-ride.js` | 197 | 164 |
| `verify-multi-effort-panel.js` | 197 | 150 |
| `verify-926-capfold-gate.js` | 196 | 162 |
| `verify-782-cwd-disk.js` | 195 | 162 |
| `verify-934-935-invariants.js` | 195 | 154 |
| `verify-handoff-latest-sort.js` | 195 | 155 |
| `verify-723-single-refresh-instance.js` | 194 | 145 |
| `verify-dirwritable.js` | 194 | 151 |
| `verify-663-banner-chain.js` | 193 | 159 |
| `verify-671-modal-global-overlay.js` | 193 | 143 |
| `verify-847-stall-watch.js` | 193 | 150 |
| `verify-1003-unified-decision.js` | 192 | 165 |
| `verify-log-switch-526.js` | 192 | 155 |
| `diag-tags-layout-cost.js` | 191 | 157 |
| `verify-841-write-phones.js` | 189 | 164 |
| `verify-969-tiered-timeout.js` | 189 | 154 |
| `verify-issue232-sync.js` | 187 | 139 |
| `verify-version-control-rules.js` | 186 | 160 |
| `verify-587-update-live.js` | 185 | 139 |
| `verify-958-label-name-visible.js` | 183 | 156 |
| `verify-deck-render-detail.js` | 183 | 129 |
| `verify-963-log-order.js` | 181 | 171 |
| `verify-bundled-skills.js` | 181 | 143 |
| `verify-922-ticket-file-queue.js` | 180 | 141 |
| `verify-generic-catalog.js` | 180 | 142 |
| `verify-3-workspace-switch.js` | 179 | 131 |
| `verify-683-choice-rev.js` | 177 | 135 |
| `verify-714-session-tickets.js` | 176 | 132 |
| `repro-detailsdock-painting-switch.js` | 175 | 134 |
| `verify-971-markdown-parent.js` | 174 | 132 |
| `verify-multi-effort.js` | 173 | 136 |
| `verify-783-chain-effort.js` | 171 | 137 |
| `verify-668-guide-steps-single-source.js` | 168 | 116 |
| `verify-998-half-open.js` | 168 | 118 |
| `verify-deck-parallel.js` | 168 | 129 |
| `verify-log-selfmon.js` | 167 | 132 |
| `verify-deck-thin-reads.js` | 165 | 129 |
| `verify-1003-migration.js` | 161 | 147 |
| `verify-997-vc-sight.js` | 161 | 129 |
| `verify-file-granularity.js` | 161 | 111 |
| `verify-735-chain-restore.js` | 160 | 118 |
| `verify-config-store-core.js` | 158 | 123 |
| `verify-1003-no-cwd-masquerade.js` | 156 | 110 |
| `verify-parse-leaf.js` | 154 | 107 |
| `verify-release-template.js` | 154 | 122 |
| `verify-t2b-templates.js` | 153 | 134 |
| `verify-784-effortId.js` | 152 | 119 |
| `verify-544-standalone-blocked.js` | 150 | 127 |
| `verify-927-gate-injection.js` | 150 | 126 |
| `verify-leaves.js` | 150 | 110 |
| `verify-gate-accounting.js` | 149 | 109 |
| `verify-budget-worstcase.js` | 148 | 88 |
| `verify-663-gh-install-inject.js` | 147 | 112 |
| `verify-locale-completeness.js` | 147 | 128 |
| `verify-detail-fog.js` | 146 | 118 |
| `verify-929-batch-cycle.js` | 145 | 109 |
| `verify-683-mirror-write.js` | 143 | 116 |
| `verify-947-workspace-file.js` | 143 | 102 |
| `verify-965-admission.js` | 143 | 109 |
| `verify-index-window.js` | 142 | 98 |
| `verify-refresh-adr.js` | 142 | 98 |
| `verify-691-map-subissues.js` | 141 | 115 |
| `verify-naming-isolation-315.js` | 141 | 116 |
| `verify-write-detect.js` | 141 | 105 |
| `verify-504-github-pr.js` | 140 | 111 |
| `verify-newsession-blank-seed-315.js` | 140 | 96 |
| `verify-prompt-newlines.js` | 140 | 104 |
| `diag-live-panel-open.js` | 139 | 108 |
| `verify-config-store-migration.js` | 138 | 111 |
| `verify-event-budget.js` | 138 | 87 |
| `verify-issue22-ui.js` | 137 | 118 |
| `verify-tabs-narrow.js` | 136 | 95 |
| `verify-781-chain-identity.js` | 135 | 103 |
| `verify-detail-levels.js` | 135 | 110 |
| `verify-panel.js` | 135 | 112 |
| `verify-statusbar-filter-reset.js` | 133 | 89 |
| `verify-829-parent-reread.js` | 132 | 109 |
| `verify-497-slash.js` | 131 | 102 |
| `verify-957-workspace-writer.js` | 131 | 101 |
| `verify-reply-envelope-parity.js` | 131 | 90 |
| `verify-626-type-chip.js` | 130 | 101 |
| `verify-log-count.js` | 130 | 107 |
| `verify-nav-stack.js` | 130 | 80 |
| `verify-530-pr-tab.js` | 129 | 97 |
| `verify-no-title.js` | 129 | 113 |
| `verify-generated-no-shadow.js` | 128 | 92 |
| `verify-issue297.js` | 128 | 98 |
| `verify-640-dock-width-browser.js` | 126 | 94 |
| `verify-snapshot-cache-first.js` | 125 | 82 |
| `repro-issue179-workspace-switch.js` | 122 | 99 |
| `verify-tabsfold-leaf.js` | 120 | 84 |
| `verify-t14-detail-badge.js` | 119 | 82 |
| `verify-686-accept.js` | 118 | 101 |
| `verify-budget-page-upper-bound.js` | 118 | 78 |
| `smoke-comment-passthrough.test.js` | 115 | 81 |
| `verify-507-pr-offline.js` | 115 | 93 |
| `verify-skill-detail-stack.js` | 114 | 88 |
| `repro-gate-flake.js` | 111 | 81 |
| `playwright-e2e-probe.js` | 109 | 82 |
| `smoke-host.test.js` | 109 | 82 |
| `verify-rest-fallback-banner.js` | 109 | 70 |
| `verify-908-progress-replace.js` | 107 | 73 |
| `verify-972-title-body.js` | 107 | 85 |
| `verify-market-tarball.js` | 106 | 72 |
| `verify-session-title.js` | 105 | 89 |
| `verify-kernel.js` | 104 | 76 |
| `verify-786-focus-end.js` | 103 | 77 |
| `verify-deck-tools-row-zero-dep.js` | 103 | 77 |
| `verify-log-artifacts.js` | 103 | 88 |
| `repro-666-mark-never-rendered.js` | 102 | 70 |
| `verify-strict-module-syntax.js` | 102 | 79 |
| `verify-596-rpc-carrier.js` | 101 | 66 |
| `verify-client-no-undef.js` | 100 | 72 |
| `verify-update-panel.js` | 100 | 78 |
| `verify-reuse.js` | 99 | 95 |
| `verify-skill-tooltip.js` | 97 | 63 |
| `verify-916-ghauth-unknown-banner.js` | 96 | 81 |
| `diag-panel-open-latency.js` | 95 | 66 |
| `repro-issue58-cache-first.js` | 95 | 68 |
| `verify-map-subissues-352.js` | 95 | 76 |
| `verify-1003-layout-in-file.js` | 94 | 71 |
| `verify-panel-workspace-isolation.js` | 92 | 73 |
| `verify-733-unknown-endpoint.js` | 91 | 63 |
| `verify-928-field-line-rewrite.js` | 91 | 71 |
| `verify-948-feedback-map.js` | 91 | 64 |
| `verify-backend-quota-model.js` | 91 | 57 |
| `repro-issue45-cross-workspace.js` | 90 | 64 |
| `smoke-client.test.js` | 90 | 69 |
| `verify-970-whole-document.js` | 90 | 67 |
| `verify-github-rest-fallback.js` | 90 | 66 |
| `verify-895-github-memo.js` | 89 | 66 |
| `verify-config-store-comments.js` | 89 | 70 |
| `verify-markdown.js` | 89 | 62 |
| `verify-multilevel-cache.js` | 89 | 65 |
| `verify-slot-idempotency.js` | 89 | 71 |
| `diag-live-return-vs-wait.js` | 85 | 61 |
| `verify-hovertip.js` | 84 | 71 |
| `diag-live-workspace-cost.js` | 83 | 62 |
| `verify-589-list-dedupe.js` | 82 | 61 |
| `verify-issue195.js` | 82 | 49 |
| `verify-client-hardcode-gate.js` | 81 | 59 |
| `verify-1003-workspace-write-robust.js` | 79 | 62 |
| `verify-labels-sync.js` | 78 | 60 |
| `verify-blocked-filter.js` | 77 | 63 |
| `diag-live-rpc-latency.js` | 75 | 52 |
| `diag-refresh-414-loop.js` | 75 | 56 |
| `verify-763-detail-fold.js` | 75 | 63 |
| `verify-issue-comment.js` | 74 | 55 |
| `repro-gate-flake-fixed.js` | 71 | 65 |
| `verify-readme-sync.js` | 70 | 54 |
| `verify-config-store-package.js` | 68 | 47 |
| `verify-ctx.js` | 68 | 50 |
| `verify-naming-title-fact.js` | 68 | 51 |
| `verify-update-migration.js` | 67 | 46 |
| `verify-524-pr-detail.js` | 66 | 60 |
| `verify-344-chain-auto-refresh.js` | 64 | 49 |
| `verify-967-measure.js` | 64 | 53 |
| `verify-976-pull-dirty-warn.js` | 63 | 39 |
| `verify-881-commit-open.js` | 61 | 50 |
| `verify-progress.js` | 59 | 43 |
| `verify-t3-locale.js` | 59 | 50 |
| `verify-issue22-popovers.js` | 56 | 37 |
| `verify-423-title-clamp.js` | 55 | 52 |
| `verify-689-counts-ui.js` | 54 | 32 |
| `verify-issue529-checks-i18n.js` | 54 | 40 |
| `verify-587-update-restart.js` | 52 | 25 |
| `verify-955-alignment.js` | 50 | 30 |
| `repro-idle-refresh.js` | 47 | 39 |
| `verify-891-setup-refresh.js` | 47 | 41 |
| `verify-inject-trailing-newline.js` | 45 | 31 |
| `verify-423-title-clamp-browser.js` | 44 | 38 |
| `verify-issue-detail.js` | 38 | 30 |
| `verify-issue212-213-214.js` | 38 | 29 |
| `verify-star-history.js` | 33 | 28 |
| `verify-log-statusbar.js` | 31 | 15 |
| `verify-952-short-text.js` | 28 | 15 |
| `verify-issue60-cwd.js` | 28 | 25 |
| `verify-update-mirror-hint.js` | 28 | 19 |
| `verify-success-failure-contract.js` | 27 | 18 |
| `verify-takeable-menu.js` | 22 | 16 |
| `verify-857-comment-false-failure.js` | 17 | 12 |
| `verify-849-fs-absence.js` | 14 | 12 |
| `scan-mangle.js` | 12 | 12 |

**tests/fixtures**（1 份，合计 312 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `chain-view-ui-probe.js` | 312 | 214 |

**tests/fixtures/deck-event-gate/compliant/src/host**（1 份，合计 10 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `goodGated.js` | 10 | 8 |

**tests/fixtures/deck-event-gate/violating/src/host**（2 份，合计 19 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `badUngated.js` | 11 | 9 |
| `badNoGate.js` | 8 | 6 |

**tests/fixtures/gh-gateway/compliant/src/host**（1 份，合计 7 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `goodGated.js` | 7 | 4 |

**tests/fixtures/gh-gateway/violating/src/host**（2 份，合计 14 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `badBypass.js` | 8 | 3 |
| `badRegistered.js` | 6 | 3 |

**tests/lib**（3 份，合计 469 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `render-subws-mark.js` | 187 | 117 |
| `deck-decide-stub.js` | 176 | 94 |
| `browser-pool.js` | 106 | 60 |

**tests/tracker-contract**（1 份，合计 148 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `harness.js` | 148 | 88 |

**tests/tracker-contract/fixtures**（5 份，合计 466 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `markdown.js` | 151 | 105 |
| `gitlab.js` | 108 | 94 |
| `compliant.js` | 92 | 74 |
| `demo.js` | 66 | 54 |
| `violating.js` | 49 | 36 |

**tests/tracker-contract/runner**（1 份，合计 324 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `index.js` | 324 | 201 |

**tests/tracker-contract/sections**（12 份，合计 3,475 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `labels.js` | 854 | 645 |
| `idempotency.js` | 543 | 401 |
| `snapshot.js` | 456 | 392 |
| `registry.js` | 328 | 280 |
| `listPage.js` | 304 | 219 |
| `counts.js` | 303 | 214 |
| `deck.js` | 158 | 124 |
| `preflight.js` | 142 | 102 |
| `chain.js` | 136 | 124 |
| `idempotency-counterproof-markdown.js` | 98 | 77 |
| `contract.js` | 80 | 54 |
| `idempotency-counterproof.js` | 73 | 52 |

### 非 `.js` 扩展名的手写脚本清单

`.mjs`、`.cjs`、`.mts` 三类合计 30 份，逐份列出（它们已经并进了上面的总表与目录表，这里单独列一份是为了不把后缀混掉）：

| 文件 | 语言 | 物理行 | 非空非注释行 |
|---|---|---|---|
| `.dependency-cruiser.cjs` | cjs | 265 | 164 |
| `scripts/browser-host.mjs` | mjs | 75 | 43 |
| `scripts/build.mjs` | mjs | 1,480 | 1,143 |
| `scripts/bundle-update-entry.mjs` | mjs | 128 | 98 |
| `scripts/create-release-issue.mjs` | mjs | 127 | 96 |
| `scripts/derive-log-from-package.mjs` | mjs | 200 | 141 |
| `scripts/derive-update-from-package.mjs` | mjs | 179 | 105 |
| `scripts/fix-issue-body.mjs` | mjs | 468 | 381 |
| `scripts/gate-map.mjs` | mjs | 921 | 767 |
| `scripts/generate-star-history-svg.mjs` | mjs | 131 | 106 |
| `scripts/lib/effective-lines.mts` | mts | 86 | 51 |
| `scripts/lib/select-gates.mjs` | mjs | 254 | 175 |
| `scripts/lib/transpile-domains.mjs` | mjs | 202 | 114 |
| `scripts/lib/transpile-unit.mjs` | mjs | 198 | 92 |
| `scripts/star-history.mjs` | mjs | 53 | 39 |
| `scripts/sync-matt-skills.mjs` | mjs | 278 | 228 |
| `scripts/t3-extract.mjs` | mjs | 55 | 37 |
| `scripts/ts-hook.mjs` | mjs | 79 | 43 |
| `scripts/typecheck.mts` | mts | 589 | 316 |
| `scripts/ui-align-black-panel.mjs` | mjs | 102 | 79 |
| `scripts/ui-click-select-backend.mjs` | mjs | 96 | 86 |
| `scripts/ui-repro-matt-demo.mjs` | mjs | 215 | 178 |
| `scripts/ui-verify-new-settings.mjs` | mjs | 70 | 63 |
| `scripts/ui-verify-registry.mjs` | mjs | 163 | 134 |
| `scripts/update-star-history.mjs` | mjs | 10 | 7 |
| `scripts/verify-all.mjs` | mjs | 73 | 49 |
| `scripts/verify-parallel.mjs` | mjs | 375 | 324 |
| `scripts/wire-subissues.mjs` | mjs | 887 | 726 |
| `tests/verify-deck-event-gate.mjs` | mjs | 447 | 354 |
| `tests/verify-typecheck.mts` | mts | 152 | 100 |

`.tsx` 与 `.cts` 在本仓库是 0 份。

## 派生文件是怎么被排除的

| 目录与判定理由 | 派生文件数 | 物理行 |
|---|---|---|
| scripts/generated  ←  按路径显式排除 | 2 | 2,004 |

被 git 忽略、因此没进候选清单的两份仓库根构建产物，规模如下（它们不计入手写存量，列在这里是为了说明「排除了多大的东西」）：

| git 忽略的构建产物 | 物理行 |
|---|---|
| client.js | 31,944 |
| host.js | 353 |

## 与仓库自己的棘轮名单对照

仓库里已经有一份官方口径的手写 JavaScript 名单：`tests/handwritten-js-baseline.json`，由 `scripts/typecheck.mts` 的「棘轮对账」那一步读（只许减、不许增）。它的范围比我这份报告窄：只收 `src/`、`tests/`、`scripts/` 三个源码根下的 `.js` / `.mjs` / `.cjs`，排除 `scripts/generated/` 与 `package/`。把两份名单对一遍：

- 名单文件里记着 **711 份**（文件里 `recordedAt` 写的是 2026-10-13），按同一范围在今天的工作区里数出来是 **581 份、117,856 物理行、89,249 非空非注释行**。
- **名单里有、今天工作区里已经没有的：130 份。** 逐份追下去：15 份在原目录原地变成了同名 `.ts`（例如 `src/host/detectChain.js` → `src/host/detectChain.ts`），79 份搬到了别处并变成了 `.ts`（例如 `src/host/tracker/backends/github/backend.js` → `src/tracker/rooms/github/backend.ts`、`src/host/tracker/backends/github/fallback-reason.js` → `src/tracker/rooms/fallback-reason.ts`），另外 36 份是「搬家 + 合并或拆分」，同名 `.ts` 不再一一对应（例如 `src/shared/deck-tools/plan-store.js` 的功能散进了 `src/deck/shell/plan-cursor.ts` 等几份文件，不再有同名的单份对应）。这一整批的主干是提交 `d0fdb277`「目录归位：deck 工具与 tracker 三房按目标树一次搬完（#1019）」，那一次提交动了 142 个文件条目。
- **今天工作区里有、名单里没有的：0 份。** 这条很重要：说明「按同名 `.ts` 判派生」这套口径数出来的手写 `.js`，一份都不比仓库自己的棘轮名单多——没有漏网的手写 JavaScript 被当成产物，也没有新增的手写 JavaScript 绕过了名单。

我这份报告比棘轮口径多 6 份，差额是棘轮不看的落点：`.dependency-cruiser.cjs`、`docs/prototype/853-vc-lib.js`、`docs/prototype/854-vc-layouts.js`、`examples/demo-mini/index.js`、`examples/demo-mini/matches.js`、`examples/demo-mini/normalize.js`。它们都是人写的、需要有人维护的脚本，所以这份报告把它们算进总数，同时在总表与「按顶层区域拆开看」里单独列行，方便只关心棘轮口径的人自己减掉。

## 清零进度

- **还有 587 份手写脚本没转**（`.js` 560 份、`.mjs` 26 份、`.cjs` 1 份），合计 119,115 物理行。若只认「手写 `.js` 归零」这一条最严的口径，要清的是 560 份、111,584 物理行。
- **剩下的不在一条线上，而在几棵树上**：
  - `tests/` 329 份、72,898 物理行，占全部手写脚本物理行的 **61%**。这是最大的一块，也是最活跃的一块：统计这一刻工作区里正在改的几份文件（`tests/tracker-contract/sections/` 下的 `counts.js`、`labels.js`、`listPage.js`）就是测试侧，另有 8 份新增的 `src/tracker/rooms/gitlab/*.ts` 是「搬家顺带转」。测试侧的迁移按单元分批推进，`scripts/ts-hook.mjs` 这个装载钩子就是为它准备的。
  - `src/client/` 134 份、22,511 物理行（其中 `kernel/` 49 份是拼进客户端闭包的模块，`views/` 及其子目录 63 份）。`views/pixel`、`views/skillDetail`、`views/cards` 三组已经转完（有 `.ts` 真源与同名 `.js` 产物，产物不入库），`views/` 顶层的 20 份组件与 `views/versionControl/` 那 20 份仍是手写 `.js`；`src/client/` 下已经转过来的 TypeScript 是 39 份。
  - `src/host/` 53 份、10,373 物理行，已经转过来的 TypeScript 是 20 份、4,916 物理行。宿主侧最重的两批（`src/host/tracker/` 与 `src/host/tools/`）已经搬走，就是上面那 130 份里的绝大部分；剩下的是 `workspaceCwd.js`、`namingGuardian.js`、`versionControl*.js` 这一族。
  - `src/shared/` 23 份、3,561 物理行，对面是 36 份、6,388 物理行 TypeScript。`src/shared/` 里每个功能目录已经是「`.ts` 真源 + 同名 `.js` 产物」的形态，剩下的是散在根上的 Leaf 文件（`naming-*.js`、`matt-skills.js`、`skill-probe-channels.js` 等）。
  - `src/seam/` 7 份、258 物理行——整套接缝都是手写 `.js`，还没有开始转。
  - `scripts/` 35 份、8,255 物理行。这一族里 `scripts/build.mjs` 一份就 1,480 行，是 `scripts/` 目录里最大的一份手写脚本（全仓最大的一份手写脚本在测试侧，是 `tests/verify-prompts.js`）。
- **两棵新树已经清零**：`src/tracker/`（115 份 `.ts`、0 份手写脚本）与 `src/deck/`（38 份 `.ts`、0 份手写脚本）。这两棵是「新树直接写 `.ts`」的样板，也说明清零不是均匀推进，而是按「新写的树直接是 TS / 老树摸到谁转谁」两条腿走。
- **不算迁移在途、但确实是手写 `.js` 的个别文件**：`src/client/kernel/log.js`（291 物理行）在 `scripts/build.mjs` 第 488 行被点名说明「旧真源原地只读留存……留而不搬」，它的运行时位置已经由 `scripts/generated/logKernel.derived.js` 顶替；它不会有人再去改，但仍然是一份手写 `.js`。类似的还有 `src/client/kernel/ctx.js` 与 `tabsfold.js`：它们不在构建清单的 `file:` 列表里，但确实在用（`ctx.js` 由 `build.mjs` 的 `extractCtxBlock()` 单独提取后注入），属于正常源码。

## 复现方法

统计用的脚本放在 `.tmp/` 下，没有提交、也不会污染仓库正式目录（`.tmp/` 已在 `.gitignore` 第 11 行声明）。`.tmp/` 是会被清理的临时目录，所以脚本全文都抄在下文，重建即可复跑：

```
cd D:\dsh-plugin\dsh-mattpocock-skills-deck
node .tmp/js-ts-code-inventory.mjs
node .tmp/js-ts-ignored-audit.mjs
node .tmp/js-ts-inventory/assemble.mjs
```

第一步 `js-ts-code-inventory.mjs` 是唯一的统计入口：它向 git 要候选文件清单、逐份分类与数行，向控制台打印一份 JSON 摘要，同时把这几个数字背后的原始数据写到 `.tmp/js-ts-inventory/` 下——`snapshot.json`（统计时刻、commit、`git status --porcelain` 逐条）、`records.json`（逐文件的语言、物理行、非空非注释行、是否派生），以及报告里那几张由数据生成的表格片段。**报告里的每一个数字都能只靠这一步的产出复算出来**；想只看总数与比例，跑完这一步读控制台摘要就够。

第二步 `js-ts-ignored-audit.mjs` 是交叉核对：它不管 git 清单，直接遍历磁盘上所有脚本文件，把「有、但被 `.gitignore` 挡在候选之外」的那批逐份归类，用来证明排除规则没有误伤手写源码、候选清单里也没混进产物。它只打印结论，不参与报告数字。

第三步 `js-ts-inventory/assemble.mjs` 把数字与正文拼成这份报告：它读 `snapshot.json` 与 `records.json`，现算正文里所有带花括号的占位符（含与 `tests/handwritten-js-baseline.json` 的棘轮对账），再把生成的表格与三个脚本的全文拼进正文档。它读的正文档就是本报告去掉那几张数据表之后的文字。所以「只想核对数字」跑第一步即可，「想一字不差地重出这份报告」才需要三步全跑。

报告里正文的数字与表格的数字都取自同一次运行，不会互相打架；`git status --porcelain` 的输出也随快照一起落盘，方便对照「当时工作区是什么样」。

### 统计脚本 `.tmp/js-ts-code-inventory.mjs` 全文

```js
// 手写 JavaScript 与 TypeScript 存量统计（本次一次性使用，落在 .tmp/ 不入库）
//
// 口径（与仓库 AGENTS.md「TypeScript 优先，旧 JS 随改随迁，最终只留 TS」一致）：
//   1. 候选文件 = git 已跟踪的文件 + 工作区里未跟踪但没被 .gitignore 忽略的新文件。
//      这样「截止到现在」的未提交新文件会被算进来，而 node_modules、client.js、host.js、
//      src/shared/<功能>/ 下由 .ts 转译出来的 .js 等构建产物本来就写在 .gitignore 里，天然排除。
//   2. 临时/工作目录按路径前缀排除（.scratch/、.tmp/、.dsh-tmp/、.worktrees/、.compile/、
//      logs/、.r1047tmp/、.r1115tmp/、.local/、.dsh-mattskillsdeck-cache/、.dsh-vision-router/）。
//      这些目录里的文件有的被误提交进了索引，但按口径它们不属于「仓库手写源码」。
//   3. 派生文件判定：同目录下存在同名 .ts/.mts/.tsx 的 .js 一律算构建产物，不算手写。
//   4. 另有几处派生文件没有同名 .ts（scripts/generated/ 下两份由 npm 包派生的文件），
//      按显式路径排除，理由见 EXPLICIT_DERIVED。
//   5. 行数：physical 是文件的物理行数（BOM 不计、\r\n 与 \n 都算一个换行）；
//      effective 是非空且非注释的行数，注释用「逐字符状态机」剥离，见 countLines()。
//
// 用法：node .tmp/js-ts-code-inventory.mjs [仓库根目录]
//
// 产出：控制台打印一份 DIGHEST 摘要；.tmp/js-ts-inventory/ 下写 snapshot.json（统计时刻、
// commit、工作区改动）与 records.json（逐文件数据），另写几张报告用的表格片段。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] ?? process.cwd())
const OUT_DIR = path.join(ROOT, '.tmp', 'js-ts-inventory')

// ---- 口径里的排除项 ----

/** 临时/工作目录：按路径前缀整目录排除，理由见文件头。 */
const TEMP_DIR_PREFIXES = [
  'node_modules/',
  '.git/',
  '.scratch/',
  '.tmp/',
  '.dsh-tmp/',
  '.worktrees/',
  '.compile/',
  'logs/',
  '.r1047tmp/',
  '.r1115tmp/',
  '.local/',
  '.dsh-mattskillsdeck-cache/',
  '.dsh-vision-router/',
  'tests/.tmp-repo-out/',
  'tests/.tmp-repo-out2/',
]

/** 没有同名 .ts 也是派生的文件（生成器写在文件头里，人手不改），逐份开例外。 */
const EXPLICIT_DERIVED = [
  {
    prefix: 'scripts/generated/',
    reason: '由 derive-log-from-package.mjs / derive-update-from-package.mjs 从 npm 包 dist 派生（文件头写明「派生文件，人手不改」）',
  },
]

/** 统计的语言：扩展名 → 报里用的语言名。 */
const LANG_OF_EXT = {
  '.js': 'js',
  '.mjs': 'mjs',
  '.cjs': 'cjs',
  '.ts': 'ts',
  '.mts': 'mts',
  '.tsx': 'tsx',
  '.cts': 'cts',
}

/** 判定「同名 TypeScript 真源是否存在」时看这些扩展名。 */
const TS_EXTS = ['.ts', '.mts', '.tsx', '.cts']

// ---- 取候选文件清单 ----

function listCandidates() {
  const raw = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 },
  )
  const seen = new Set()
  for (const p of raw.split('\0')) {
    if (!p) continue
    const posix = p.replace(/\\/g, '/')
    if (TEMP_DIR_PREFIXES.some((pre) => posix === pre.slice(0, -1) || posix.startsWith(pre))) continue
    seen.add(posix)
  }
  return [...seen].sort()
}

// ---- 行数统计 ----

/**
 * 逐字符状态机剥离注释，返回物理行数与非空非注释行数。
 *
 * 近似之处（报告「已知局限」里逐条写明）：正则字面量不当字符串处理（`/a\/\/b/` 里的 `//`
 * 会被当成行注释）；模板字符串 `${}` 里的代码不单独识别；转义只按反斜杠跳过下一个字符。
 * 字符串（含跨行模板）内部的内容算作代码行，与「非空非注释」的常识读法一致。
 */
function countLines(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const endsWithNewline = /\n$/.test(src)
  const lines = src.split(/\r\n|\r|\n/)
  if (endsWithNewline) lines.pop()

  const isCode = new Array(lines.length).fill(false)
  let state = 'code' // code | block | squote | dquote | tpl

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      const c = line[j]
      const n = line[j + 1]

      if (state === 'block') {
        if (c === '*' && n === '/') {
          state = 'code'
          j++
        }
        continue
      }
      if (state === 'tpl') {
        if (c === '\\') {
          j++
          continue
        }
        if (c === '`') {
          state = 'code'
          continue
        }
        if (!/\s/.test(c)) isCode[i] = true
        continue
      }
      if (state === 'squote' || state === 'dquote') {
        if (c === '\\') {
          j++
          continue
        }
        if ((state === 'squote' && c === "'") || (state === 'dquote' && c === '"')) state = 'code'
        if (!/\s/.test(c)) isCode[i] = true
        continue
      }

      // state === 'code'
      if (c === '/' && n === '/') break // 行注释：本行剩下的都不算
      if (c === '/' && n === '*') {
        state = 'block'
        j++
        continue
      }
      if (c === "'") {
        state = 'squote'
        isCode[i] = true
        continue
      }
      if (c === '"') {
        state = 'dquote'
        isCode[i] = true
        continue
      }
      if (c === '`') {
        state = 'tpl'
        isCode[i] = true
        continue
      }
      if (!/\s/.test(c)) isCode[i] = true
    }
  }

  return { physical: lines.length, effective: isCode.filter(Boolean).length }
}

// ---- 分类 ----

function classify(posix) {
  const ext = path.posix.extname(posix)
  const lang = LANG_OF_EXT[ext]
  if (!lang) return null

  const dir = path.posix.dirname(posix)
  const base = posix.slice(0, -ext.length)
  const siblingTs = TS_EXTS.map((e) => base + e).filter((p) => existsSync(path.join(ROOT, p)))

  const isScript = ['.js', '.mjs', '.cjs'].includes(ext)
  const explicit = EXPLICIT_DERIVED.find((r) => posix.startsWith(r.prefix))

  let kind = 'hand' // hand | derived
  let why = ''
  if (isScript && siblingTs.length > 0) {
    kind = 'derived'
    why = '同目录存在同名 TypeScript 真源：' + siblingTs.join(', ')
  } else if (explicit) {
    kind = 'derived'
    why = explicit.reason
  }

  const abs = path.join(ROOT, posix)
  const text = readFileSync(abs, 'utf8')
  const { physical, effective } = countLines(text)
  const bytes = statSync(abs).size

  return { path: posix, dir, ext, lang, kind, why, physical, effective, bytes }
}

// ---- 汇总与输出 ----

function sum(rows) {
  return {
    files: rows.length,
    physical: rows.reduce((a, r) => a + r.physical, 0),
    effective: rows.reduce((a, r) => a + r.effective, 0),
  }
}

function groupBy(rows, keyFn) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return map
}

function fmt(n) {
  return n.toLocaleString('en-US')
}

function ratio(a, b) {
  if (b === 0) return '∞'
  return (a / b).toFixed(2) + ':1'
}

function mdTable(headers, rows) {
  const out = ['| ' + headers.join(' | ') + ' |', '|' + headers.map(() => '---').join('|') + '|']
  for (const r of rows) out.push('| ' + r.join(' | ') + ' |')
  return out.join('\n')
}

const candidates = listCandidates()
const records = candidates.map(classify).filter(Boolean)
const hand = records.filter((r) => r.kind === 'hand')
const derived = records.filter((r) => r.kind === 'derived')

const handScripts = hand.filter((r) => ['js', 'mjs', 'cjs'].includes(r.lang))
const handTs = hand.filter((r) => ['ts', 'mts', 'tsx', 'cts'].includes(r.lang))

mkdirSync(OUT_DIR, { recursive: true })

// 统计时刻的基线（commit 与工作区改动）与逐文件数据一起落盘，报告里的数字全部取自这一次快照
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const statusLines = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .map((l) => l.trimEnd())
  .filter(Boolean)
const at = new Date()
const pad = (n) => String(n).padStart(2, '0')
const atText = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())} +08:00（本机时区）`

writeFileSync(
  path.join(OUT_DIR, 'snapshot.json'),
  JSON.stringify({ root: ROOT, head, at: atText, statusLines, candidates: candidates.length }, null, 1),
  'utf8',
)
writeFileSync(
  path.join(OUT_DIR, 'records.json'),
  JSON.stringify({ root: ROOT, candidates: candidates.length, records }, null, 1),
  'utf8',
)

// ---- 控制台摘要（写报告时只读这一段，不必把整份明细拉回上下文）----

const byLang = groupBy(records, (r) => r.lang)
const areaOf = (p) => {
  if (p.startsWith('src/')) return 'src'
  if (p.startsWith('tests/')) return 'tests'
  if (p.startsWith('scripts/')) return 'scripts'
  if (p.startsWith('docs/')) return 'docs'
  if (p.startsWith('examples/')) return 'examples'
  return p.includes('/') ? p.split('/')[0] : '(仓库根)'
}
const areas = [...groupBy(hand, (r) => areaOf(r.path)).entries()]
  .map(([name, rows]) => ({
    name,
    scripts: sum(rows.filter((r) => ['js', 'mjs', 'cjs'].includes(r.lang))),
    ts: sum(rows.filter((r) => ['ts', 'mts', 'tsx', 'cts'].includes(r.lang))),
  }))
  .sort((a, b) => b.scripts.physical - a.scripts.physical)

const digest = {
  root: ROOT,
  head,
  at: atText,
  statusCount: statusLines.length,
  candidates: candidates.length,
  byLang: {},
  handScripts: sum(handScripts),
  handJs: sum(hand.filter((r) => r.lang === 'js')),
  handTs: sum(handTs),
  derivedScripts: sum(derived),
  scriptsStrict: {
    mjs: sum(hand.filter((r) => r.lang === 'mjs')),
    cjs: sum(hand.filter((r) => r.lang === 'cjs')),
  },
  ratios: {
    'files scripts:ts': ratio(handScripts.length, handTs.length),
    'physical scripts:ts': ratio(sum(handScripts).physical, sum(handTs).physical),
    'effective scripts:ts': ratio(sum(handScripts).effective, sum(handTs).effective),
    'files js:ts': ratio(hand.filter((r) => r.lang === 'js').length, hand.filter((r) => r.lang === 'ts').length),
    'physical js:ts': ratio(sum(hand.filter((r) => r.lang === 'js')).physical, sum(hand.filter((r) => r.lang === 'ts')).physical),
    'effective js:ts': ratio(sum(hand.filter((r) => r.lang === 'js')).effective, sum(hand.filter((r) => r.lang === 'ts')).effective),
  },
  areas,
}
for (const [lang, rows] of byLang) digest.byLang[lang] = sum(rows)
console.log('DIGEST ' + JSON.stringify(digest, null, 1))

// ---- 报告片段 ----

const frag = (name, text) => writeFileSync(path.join(OUT_DIR, name), text.replace(/\n+$/, '') + '\n', 'utf8')

// 0) 统计基线（commit、时刻、工作区改动逐条）
frag(
  '00-baseline.md',
  [
    '| 项 | 值 |',
    '|---|---|',
    '| 仓库 | `' + ROOT + '` |',
    '| commit | `' + head + '` |',
    '| 统计时刻 | ' + atText + ' |',
    '| 工作区改动 | `git status --porcelain` 共 ' + statusLines.length + ' 条，逐条见下 |',
    '',
    '```text',
    ...statusLines,
    '```',
  ].join('\n'),
)

// 1) 总表：语言 × 文件数 × 物理行 × 非空非注释行
const langOrder = ['js', 'ts', 'mjs', 'cjs', 'mts', 'tsx', 'cts']
const totalRows = []
for (const lang of langOrder) {
  const rows = records.filter((r) => r.lang === lang)
  if (rows.length === 0) continue
  const handRows = rows.filter((r) => r.kind === 'hand')
  const derRows = rows.filter((r) => r.kind === 'derived')
  totalRows.push([
    lang,
    handRows.length === 0 ? '—' : fmt(handRows.length),
    handRows.length === 0 ? '—' : fmt(sum(handRows).physical),
    handRows.length === 0 ? '—' : fmt(sum(handRows).effective),
    derRows.length === 0 ? '0' : fmt(derRows.length),
    derRows.length === 0 ? '0' : fmt(sum(derRows).physical),
  ])
}
totalRows.push([
  '**手写脚本合计（js+mjs+cjs）**',
  '**' + fmt(handScripts.length) + '**',
  '**' + fmt(sum(handScripts).physical) + '**',
  '**' + fmt(sum(handScripts).effective) + '**',
  '**' + fmt(derived.length) + '**',
  '**' + fmt(sum(derived).physical) + '**',
])
totalRows.push([
  '**手写 TypeScript 合计（ts+mts+tsx）**',
  '**' + fmt(handTs.length) + '**',
  '**' + fmt(sum(handTs).physical) + '**',
  '**' + fmt(sum(handTs).effective) + '**',
  '—',
  '—',
])
frag(
  '01-total-table.md',
  mdTable(['语言', '手写文件数', '手写物理行', '手写非空非注释行', '派生文件数', '派生物理行'], totalRows),
)

// 1b) 按顶层区域拆开
frag(
  '07-area.md',
  mdTable(
    ['区域', '手写脚本文件数', '脚本物理行', '脚本非空非注释行', '手写 TS 文件数', 'TS 物理行', 'TS 非空非注释行'],
    [
      ...areas.map((a) => [a.name, fmt(a.scripts.files), fmt(a.scripts.physical), fmt(a.scripts.effective), fmt(a.ts.files), fmt(a.ts.physical), fmt(a.ts.effective)]),
      ['**合计**', '**' + fmt(sum(handScripts).files) + '**', '**' + fmt(sum(handScripts).physical) + '**', '**' + fmt(sum(handScripts).effective) + '**', '**' + fmt(sum(handTs).files) + '**', '**' + fmt(sum(handTs).physical) + '**', '**' + fmt(sum(handTs).effective) + '**'],
    ],
  ),
)

// 2) 按目录细分（手写脚本 vs 手写 TS）
const dirKey = (r) => {
  const parts = r.dir.split('/')
  return parts[0] === '.' ? '(仓库根)' : parts.slice(0, Math.min(2, parts.length)).join('/')
}
const scriptDirs = [...groupBy(handScripts, dirKey).entries()].sort((a, b) => sum(b[1]).physical - sum(a[1]).physical)
const tsDirs = [...groupBy(handTs, dirKey).entries()].sort((a, b) => sum(b[1]).physical - sum(a[1]).physical)

frag(
  '02-by-dir.md',
  [
    '### 手写脚本（.js / .mjs / .cjs）按目录',
    '',
    mdTable(
      ['目录', '文件数', '物理行', '非空非注释行'],
      scriptDirs.map(([d, rows]) => [d, fmt(rows.length), fmt(sum(rows).physical), fmt(sum(rows).effective)]),
    ),
    '',
    '### 手写 TypeScript（.ts / .mts / .tsx）按目录',
    '',
    mdTable(
      ['目录', '文件数', '物理行', '非空非注释行'],
      tsDirs.map(([d, rows]) => [d, fmt(rows.length), fmt(sum(rows).physical), fmt(sum(rows).effective)]),
    ),
  ].join('\n'),
)

// 3) 手写脚本逐文件明细（按目录、再按物理行降序）
const jsDetail = []
for (const [d, rows] of [...groupBy(handScripts, (r) => r.dir).entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const sorted = [...rows].sort((a, b) => b.physical - a.physical || a.path.localeCompare(b.path))
  jsDetail.push('', `**${d}**（${sorted.length} 份，合计 ${fmt(sum(sorted).physical)} 物理行）`, '')
  jsDetail.push(mdTable(['文件', '物理行', '非空非注释行'], sorted.map((r) => ['`' + path.posix.basename(r.path) + '`', fmt(r.physical), fmt(r.effective)])))
}
frag('03-js-files.md', ['### 手写脚本逐文件明细', ...jsDetail].join('\n'))

// 4) 手写 TS 逐文件明细（附录）
const tsDetail = []
for (const [d, rows] of [...groupBy(handTs, (r) => r.dir).entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const sorted = [...rows].sort((a, b) => a.physical - b.physical || a.path.localeCompare(b.path))
  tsDetail.push('', `**${d}**（${sorted.length} 份，合计 ${fmt(sum(sorted).physical)} 物理行）`, '')
  tsDetail.push(mdTable(['文件', '物理行', '非空非注释行'], sorted.map((r) => ['`' + path.posix.basename(r.path) + '`', fmt(r.physical), fmt(r.effective)])))
}
frag('04-ts-files.md', ['### 手写 TypeScript 逐文件明细', ...tsDetail].join('\n'))

// 5) 派生文件清单（按判定理由分组）
const derivedByDir = [...groupBy(derived, (r) => r.dir + '  ←  ' + (r.why.startsWith('同目录') ? '同名 .ts 存在' : '按路径显式排除')).entries()].sort(
  (a, b) => sum(b[1]).physical - sum(a[1]).physical,
)
frag(
  '05-derived.md',
  mdTable(
    ['目录与判定理由', '派生文件数', '物理行'],
    derivedByDir.map(([k, rows]) => [k, fmt(rows.length), fmt(sum(rows).physical)]),
  ),
)

// 6) 磁盘上存在但被 .gitignore 挡在候选之外的手写脚本（例如根 client.js / host.js），只报数量与目录
const ignoredOnDisk = []
for (const rel of ['client.js', 'host.js']) {
  const abs = path.join(ROOT, rel)
  if (existsSync(abs)) ignoredOnDisk.push([rel, fmt(countLines(readFileSync(abs, 'utf8')).physical)])
}
frag(
  '06-ignored.md',
  ignoredOnDisk.length === 0
    ? '（仓库根没有 client.js / host.js）'
    : mdTable(['git 忽略的构建产物', '物理行'], ignoredOnDisk),
)

console.log('FRAGMENTS_WRITTEN ' + OUT_DIR)
```

### 交叉核对脚本 `.tmp/js-ts-ignored-audit.mjs` 全文

```js
// 交叉核对脚本 v2：把「被 .gitignore 挡在候选清单外」的脚本逐份归类，确认没有手写源码被静默忽略。
//
// 归类次序（先命中先算）：临时目录 → 同名 .ts 存在 → 文件头自称生成物 → 发布包镜像 → 其它（可疑项逐份列出）。
// 用法：node .tmp/js-ts-ignored-audit.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] ?? process.cwd())
const SCRIPT_EXTS = new Set(['.js', '.mjs', '.cjs'])
const ALL_EXTS = new Set([...SCRIPT_EXTS, '.ts', '.mts', '.tsx', '.cts'])
const TS_EXTS = ['.ts', '.mts', '.tsx', '.cts']
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.scratch', '.tmp', '.dsh-tmp', '.worktrees', '.compile', 'logs',
  '.r1047tmp', '.r1115tmp', '.local', '.dsh-mattskillsdeck-cache', '.dsh-vision-router',
])
const PACKAGE_MIRROR = ['package/lib/', 'package/scripts/', 'package/shared/', 'package/deck/', 'package/tracker/']
const AUTO_GEN = /AUTO-GENERATED|DO NOT EDIT|派生文件|automatically generated|人手不改/i

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(abs, out)
    } else if (ALL_EXTS.has(path.extname(e.name))) {
      out.push(path.relative(ROOT, abs).replace(/\\/g, '/'))
    }
  }
  return out
}

const onDisk = walk(ROOT)
const candidates = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean),
)
const ignored = onDisk.filter((p) => !candidates.has(p))
const ruleOf = (p) => {
  try {
    return execFileSync('git', ['check-ignore', '-v', p], { cwd: ROOT, encoding: 'utf8' }).trim().split('\t')[0]
  } catch {
    return '(未被忽略规则命中)'
  }
}

const buckets = new Map()
const suspicious = []
for (const p of ignored) {
  const ext = path.posix.extname(p)
  if (!SCRIPT_EXTS.has(ext)) {
    buckets.set('被忽略的 .ts/.mts/.tsx（真源被忽略）', (buckets.get('被忽略的 .ts/.mts/.tsx（真源被忽略）') ?? 0) + 1)
    suspicious.push({ path: p, why: 'TypeScript 真源被忽略', rule: ruleOf(p), head: '' })
    continue
  }
  const base = p.slice(0, -ext.length)
  const sibs = TS_EXTS.filter((e) => existsSync(path.join(ROOT, base + e)))
  const head = readFileSync(path.join(ROOT, p), 'utf8').split(/\r?\n/).slice(0, 4).join('\n')
  let bucket
  if (sibs.length > 0) bucket = '同名 .ts 就在同目录（与口径一致：派生）'
  else if (AUTO_GEN.test(head)) bucket = '文件头自称生成物（构建产出，源码写在头里）'
  else if (PACKAGE_MIRROR.some((pre) => p.startsWith(pre))) bucket = '发布包镜像（构建从 src/ 复制的副本）'
  else if (p.startsWith('tests/.tmp-repo-out')) bucket = '测试遗留临时仓库副本'
  else bucket = '**其它（可疑：没有同名 .ts、也不自称生成物）**'
  buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  if (bucket.startsWith('**其它')) suspicious.push({ path: p, why: '无同名 .ts、也不自称生成物', rule: ruleOf(p), head: head.replace(/\n/g, ' / ').slice(0, 160) })
}

console.log('=== 磁盘脚本文件 ' + onDisk.length + ' 份：候选清单内 ' + (onDisk.length - ignored.length) + '，被忽略 ' + ignored.length + ' ===')
console.log('\n被忽略的脚本按归类：')
for (const [k, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) console.log('  ' + String(n).padStart(4) + '  ' + k)

console.log('\n可疑项逐份：')
if (suspicious.length === 0) console.log('  无')
for (const s of suspicious) {
  console.log('--- ' + s.path)
  console.log('    理由：' + s.why + '；忽略规则：' + s.rule)
  if (s.head) console.log('    文件头：' + s.head)
}

// 候选清单里手写脚本的生成物头部扫描
const hits = []
for (const p of candidates) {
  if (!SCRIPT_EXTS.has(path.posix.extname(p))) continue
  const head = readFileSync(path.join(ROOT, p), 'utf8').split(/\r?\n/).slice(0, 12)
  const line = head.find((l) => AUTO_GEN.test(l))
  if (line) hits.push(p + '  →  ' + line.trim().slice(0, 110))
}
console.log('\n候选清单里的手写脚本：头部含生成物字样 ' + hits.length + ' 份：')
for (const h of hits) console.log('  ' + h)
```

### 拼装脚本 `.tmp/js-ts-inventory/assemble.mjs` 全文

```js
// 把报告正文与脚本生成的表格片段拼成最终报告（一次性使用）
//
// 所有数字都在这里从同一次快照（.tmp/js-ts-inventory/snapshot.json 与 records.json）算出来，
// 再替换正文里的 {{占位符}}，所以正文里的数字与表格里的数字不可能对不上。
// 用法：node .tmp/js-ts-inventory/assemble.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] ?? process.cwd())
const FRAG = path.join(ROOT, '.tmp', 'js-ts-inventory')
const OUT = path.join(ROOT, 'research', 'js-ts-code-inventory-2026-10-14.md')

const read = (f) => readFileSync(f, 'utf8').trimEnd()
const snapshot = JSON.parse(read(path.join(FRAG, 'snapshot.json')))
const records = JSON.parse(read(path.join(FRAG, 'records.json'))).records
const hand = records.filter((r) => r.kind === 'hand')

const SCRIPT = ['js', 'mjs', 'cjs']
const TS = ['ts', 'mts', 'tsx', 'cts']
const num = (n) => n.toLocaleString('en-US')
const sum = (rows) => ({
  files: rows.length,
  physical: rows.reduce((a, r) => a + r.physical, 0),
  effective: rows.reduce((a, r) => a + r.effective, 0),
})
const pick = (langs, pred = () => true) => hand.filter((r) => langs.includes(r.lang) && pred(r))
const ratio = (a, b) => (a / b).toFixed(2) + ' : 1'

const scripts = sum(pick(SCRIPT))
const js = sum(pick(['js']))
const mjs = sum(pick(['mjs']))
const cjs = sum(pick(['cjs']))
const ts = sum(pick(TS))
const dts = sum(pick(['ts'], (r) => r.path.endsWith('.d.ts')))

const inDir = (prefix, langs) => sum(pick(langs, (r) => r.path.startsWith(prefix)))
const testsScripts = inDir('tests/', SCRIPT)

const V = {
  HEAD: snapshot.head,
  AT: snapshot.at,
  STATUS_N: String(snapshot.statusLines.length),
  BASELINE_TABLE: read(path.join(FRAG, '00-baseline.md')),
  AREA_TABLE: read(path.join(FRAG, '07-area.md')),

  SCRIPT_FILES: num(scripts.files),
  SCRIPT_PHYS: num(scripts.physical),
  SCRIPT_EFF: num(scripts.effective),
  JS_FILES: num(js.files),
  JS_PHYS: num(js.physical),
  JS_EFF: num(js.effective),
  MJS_FILES: num(mjs.files),
  MJS_PHYS: num(mjs.physical),
  CJS_FILES: num(cjs.files),
  CJS_PHYS: num(cjs.physical),
  TS_FILES: num(ts.files),
  TS_PHYS: num(ts.physical),
  TS_EFF: num(ts.effective),
  DTS_FILES: num(dts.files),
  DTS_PHYS: num(dts.physical),
  TS_FILES_NODTS: num(ts.files - dts.files),
  TS_PHYS_NODTS: num(ts.physical - dts.physical),

  // 非 .js 的手写脚本（.mjs / .cjs / .mts）逐份列出，由快照现算，避免正文里写死的数字过期
  EXT_FILES: num(hand.filter((r) => ['.mjs', '.cjs', '.mts'].includes(r.ext)).length),
  EXT_TABLE: (() => {
    const rows = hand
      .filter((r) => ['.mjs', '.cjs', '.mts'].includes(r.ext))
      .sort((a, b) => a.path.localeCompare(b.path))
    const lines = ['| 文件 | 语言 | 物理行 | 非空非注释行 |', '|---|---|---|---|']
    for (const r of rows) lines.push(`| \`${r.path}\` | ${r.lang} | ${num(r.physical)} | ${num(r.effective)} |`)
    return lines.join('\n')
  })(),

  FAMILY_FILES_RATIO: ratio(scripts.files, ts.files),
  FAMILY_PHYS_RATIO: ratio(scripts.physical, ts.physical),
  FAMILY_EFF_RATIO: ratio(scripts.effective, ts.effective),
  JS_TS_FILES_RATIO: ratio(js.files, sum(pick(['ts'])).files),
  JS_TS_PHYS_RATIO: ratio(js.physical, sum(pick(['ts'])).physical),
  JS_TS_EFF_RATIO: ratio(js.effective, sum(pick(['ts'])).effective),

  TESTS_JS_FILES: num(testsScripts.files),
  TESTS_JS_PHYS: num(testsScripts.physical),
  TESTS_JS_EFF: num(testsScripts.effective),
  TESTS_JS_SHARE: Math.round((testsScripts.physical / scripts.physical) * 100) + '%',

  SRC_JS_FILES: num(inDir('src/', SCRIPT).files),
  SRC_JS_PHYS: num(inDir('src/', SCRIPT).physical),
  SRC_JS_EFF: num(inDir('src/', SCRIPT).effective),
  SRC_TS_FILES: num(inDir('src/', TS).files),
  SRC_TS_PHYS: num(inDir('src/', TS).physical),
  SRC_CLIENT_JS: num(inDir('src/client/', SCRIPT).files),
  SRC_CLIENT_JS_PHYS: num(inDir('src/client/', SCRIPT).physical),
  SRC_CLIENT_KERNEL_JS: num(inDir('src/client/kernel/', SCRIPT).files),
  SRC_CLIENT_VIEWS_JS: num(inDir('src/client/views/', SCRIPT).files),
  SRC_CLIENT_TS: num(inDir('src/client/', TS).files),
  SRC_HOST_JS: num(inDir('src/host/', SCRIPT).files),
  SRC_HOST_JS_PHYS: num(inDir('src/host/', SCRIPT).physical),
  SRC_HOST_TS: num(inDir('src/host/', TS).files),
  SRC_HOST_TS_PHYS: num(inDir('src/host/', TS).physical),
  SRC_SHARED_JS: num(inDir('src/shared/', SCRIPT).files),
  SRC_SHARED_JS_PHYS: num(inDir('src/shared/', SCRIPT).physical),
  SRC_SHARED_TS: num(inDir('src/shared/', TS).files),
  SRC_SHARED_TS_PHYS: num(inDir('src/shared/', TS).physical),
  SRC_SEAM_JS: num(inDir('src/seam/', SCRIPT).files),
  SRC_SEAM_JS_PHYS: num(inDir('src/seam/', SCRIPT).physical),
  SRC_TRACKER_TS: num(inDir('src/tracker/', TS).files),
  SRC_TRACKER_JS: num(inDir('src/tracker/', SCRIPT).files),
  SRC_DECK_TS: num(inDir('src/deck/', TS).files),
  SRC_DECK_JS: num(inDir('src/deck/', SCRIPT).files),
  SCRIPTS_JS: num(inDir('scripts/', SCRIPT).files),
  SCRIPTS_JS_PHYS: num(inDir('scripts/', SCRIPT).physical),
  BUILD_MJS_PHYS: num(hand.find((r) => r.path === 'scripts/build.mjs').physical),
}

// ---- 与仓库自己的棘轮名单对照 ----
const baseline = JSON.parse(read(path.join(ROOT, 'tests', 'handwritten-js-baseline.json')))
const baseSet = new Set(baseline.files)
const inScope = (p) =>
  ['src/', 'tests/', 'scripts/'].some((r) => p.startsWith(r)) && !p.startsWith('scripts/generated/') && !p.startsWith('package/')
const mineInScope = pick(SCRIPT, (r) => inScope(r.path))
const mineSet = new Set(mineInScope.map((r) => r.path))
const gone = [...baseSet].filter((p) => !mineSet.has(p))
const added = [...mineSet].filter((p) => !baseSet.has(p))
const tsPaths = new Set(pick(TS).map((r) => r.path))
let renamedInPlace = 0
let moved = 0
let merged = 0
for (const p of gone) {
  const base = p.replace(/\.(js|mjs|cjs)$/, '')
  // 注意扩展名要带点：写成 'ts' 会拼出 detectChaints 这种永远不存在的路径，把「原地转」错判成「搬走」
  if (['.ts', '.mts', '.tsx', '.cts'].map((e) => base + e).some((f) => existsSync(path.join(ROOT, f)))) {
    renamedInPlace++
    continue
  }
  const bn = base.split('/').pop()
  if ([...tsPaths].some((t) => t.endsWith('/' + bn + '.ts') || t === bn + '.ts')) moved++
  else merged++
}
const outside = pick(SCRIPT, (r) => !inScope(r.path))
Object.assign(V, {
  BASE_FILES: num(baseSet.size),
  BASE_DATE: baseline.recordedAt,
  SCOPE_FILES: num(mineInScope.length),
  SCOPE_PHYS: num(sum(mineInScope).physical),
  SCOPE_EFF: num(sum(mineInScope).effective),
  GONE: num(gone.length),
  GONE_RENAMED: num(renamedInPlace),
  GONE_MOVED: num(moved),
  GONE_OTHER: num(merged),
  ADDED: num(added.length),
  OUTSIDE_FILES: num(outside.length),
  OUTSIDE_LIST: outside.map((r) => '`' + r.path + '`').join('、'),
  RELOCATION_COMMIT: 'd0fdb277',
})

let out = read(path.join(FRAG, 'report-prose.md'))
const missing = new Set()
out = out.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, key) => {
  if (!(key in V)) {
    missing.add(key)
    return m
  }
  return String(V[key])
})
if (missing.size > 0) throw new Error('正文里用了没定义的占位符：' + [...missing].join(', '))
if (/\{\{[A-Z0-9_]+\}\}/.test(out)) throw new Error('还有没替换掉的占位符')

// 用函数式替换（而不是字符串替换），避免脚本正文里的 $& / $' 之类被当成替换模式
for (const [marker, content] of [
  ['@@TABLE_TOTAL@@', read(path.join(FRAG, '01-total-table.md'))],
  ['@@TABLE_BYDIR@@', read(path.join(FRAG, '02-by-dir.md'))],
  ['@@DETAIL_JS@@', read(path.join(FRAG, '03-js-files.md'))],
  ['@@EXT_TABLE@@', String(V.EXT_TABLE)],
  ['@@DETAIL_TS@@', read(path.join(FRAG, '04-ts-files.md'))],
  ['@@DERIVED@@', read(path.join(FRAG, '05-derived.md'))],
  ['@@IGNORED@@', read(path.join(FRAG, '06-ignored.md'))],
]) {
  if (!out.includes(marker)) throw new Error('正文里找不到占位符 ' + marker)
  out = out.replace(marker, () => content)
}
// 这一步只检查表格占位符：脚本全文那几个标记本来就留到下一步才注入
const leftover = ['@@TABLE_TOTAL@@', '@@TABLE_BYDIR@@', '@@DETAIL_JS@@', '@@EXT_TABLE@@', '@@DETAIL_TS@@', '@@DERIVED@@', '@@IGNORED@@'].filter(
  (m) => out.includes(m),
)
if (leftover.length > 0) throw new Error('还有没替换掉的表格占位符：' + leftover.join(', '))

// 脚本全文最后注入：它们自己就含有 @@ 标记字样，所以上面那条检查必须放在注入之前
for (const [marker, content] of [
  ['@@SCRIPT_FULL@@', read(path.join(ROOT, '.tmp', 'js-ts-code-inventory.mjs'))],
  ['@@AUDIT_FULL@@', read(path.join(ROOT, '.tmp', 'js-ts-ignored-audit.mjs'))],
  ['@@ASSEMBLE_FULL@@', read(path.join(FRAG, 'assemble.mjs'))],
]) {
  if (!out.includes(marker)) throw new Error('正文里找不到占位符 ' + marker)
  out = out.replace(marker, () => content)
}

writeFileSync(OUT, out + '\n', 'utf8')
console.log('WROTE ' + OUT)
console.log('bytes ' + Buffer.byteLength(out, 'utf8') + '；行数 ' + out.split('\n').length)
console.log('关键数字核对：' + JSON.stringify({ scripts, js, ts, testsScripts, scope: sum(mineInScope), gone: gone.length, added: added.length }))
```

## 已知局限与不确定项

1. **注释剥离是近似的**，规则与近似点写在上文「行数是怎么数的」一节。受影响的只有「非空非注释行」这一列；物理行数是精确值，不受影响。抽样核对过 5 份注释占比异常高的文件（`src/shared/tracker/shape.js` 227 行里只有 3 行代码、`src/client/index.js` 350 行里 65 行、`src/shared/tracker/chain-types.js` 234 行里 56 行、`src/shared/version-control/exec-envelope.js`、`src/client/views/versionControl/vcTabVisible.js`），状态机给出的数字与「行首不是注释标记」的朴素数法完全一致，没有发现误剥。
2. **`.mjs` / `.cjs` 算不算「清零」目标，仓库里的说法不完全一致。** AGENTS.md 的正文说目标是「手写代码只有 TypeScript，没有手写 JavaScript」，紧接着补一句「清零口径是手写 `.js` 归零」；而 `tests/handwritten-js-baseline.json` 与 `scripts/typecheck.mts` 的棘轮把 `.js` / `.mjs` / `.cjs` 一起数。所以这份报告两个数都给：严格 `.js` 口径 560 份 / 111,584 物理行；脚本家族口径 587 份 / 119,115 物理行。
3. **`.dependency-cruiser.cjs` 算不算「插件源码」是个判断题。** 它是一份手写的依赖规则配置，不是插件运行时代码，棘轮名单也不收它。这份报告把它算进总数（它确实是人写的、要维护的 `.js` 家族文件），同时在按区域拆分的表里单独列一行，方便剔除。
4. **`docs/prototype/` 与 `examples/demo-mini/` 这 5 份同样是判断题。** 它们是调研原型与示例，不进发布包，也不参加棘轮。同样计入总数、单独列行。
5. **`tests/fixtures/` 下那 6 份极小的 `.js`（6 到 11 行）是门禁故意要的「违规样例」**，比如 `tests/fixtures/deck-event-gate/violating/src/host/badNoGate.js`。它们的形态本身就是被测对象，转成 `.ts` 会改变被测事实；棘轮名单里也留着它们。这份报告按口径把它们算作手写 JavaScript（共 362 物理行，其中 312 行是 `tests/fixtures/chain-view-ui-probe.js`）。
6. **`.d.ts` 计入 TypeScript 总数**：285 份里有 6 份是纯声明文件（共 274 行），最长的是 `src/client/views/pixelProps.d.ts`（133 行）。剔除声明文件后的手写 TypeScript 是 279 份、52,657 物理行，对比例几乎没有影响。
7. **基线里消失的那 130 份，去向是按「同名 `.ts` 是否出现在别处」判定的**，其中 36 份属于搬家时合并或拆分，不能一一对应。这个判定只看文件名、不看目录，所以 `index.js` 这一类通用名可能同时匹配到好几份 `index.ts`，具体某一份「变成了哪一份」并不可靠；可靠的是三个分类的计数。这不影响今天的存量数字（那 130 份都已经不在工作区里），只影响溯源。
8. **统计时刻的工作区不干净，而且有别人同时在改。** 统计期间 `docs/agents/commit-convention.md`、`docs/tracker/capability-gitlab.md`、`src/tracker/rooms/gitlab/` 下 8 份新增与 2 份改动中的 `.ts`、`tests/tracker-contract/sections/` 下 3 份 `.js` 都停在改动中（最后这几份让手写脚本的物理行数在几次运行之间持续变化，第一次与最终这一次之间差了 35 行，这正是本报告改成「一次快照、正文与表格同源」的原因）。另外 `scripts/typecheck.mts` 的注释里专门提醒过：在一个「改名改到一半」的工作区里数文件集合，会把半成品算进来。复跑前先看一眼 `git status --porcelain` 的输出。
9. **统计只数了行与文件，没有区分「活代码」与「已死但仍在库的代码」**。这次只对构建清单能佐证的两处做了判断：`src/client/kernel/log.js` 明确是「留而不搬」的旧真源，`ctx.js` / `tabsfold.js` 确认仍在使用。其余文件是否还有调用方，需要另做一次「谁 import 了谁」的分析，这份报告没有做。

## 附录 A：手写 TypeScript 逐文件明细

下表按目录分组，组内按物理行数从少到多排列（与 `.js` 明细表的方向相反，是为了让最长的文件落在组尾，便于对照）。完整路径 = 组标题里的目录 + 表格里的文件名。

### 手写 TypeScript 逐文件明细

**scripts**（3 份，合计 902 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `node-ambient.d.ts` | 33 | 18 |
| `log-trace.ts` | 280 | 228 |
| `typecheck.mts` | 589 | 316 |

**scripts/lib**（1 份，合计 86 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `effective-lines.mts` | 86 | 51 |

**src/client**（1 份，合计 15 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `ts-pixel-ambient.d.ts` | 15 | 9 |

**src/client/kernel**（3 份，合计 650 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `locale-skilldetail.ts` | 69 | 58 |
| `locale-cards.ts` | 85 | 74 |
| `api-io.ts` | 496 | 370 |

**src/client/views**（2 份，合计 237 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `SkillsTab.ts` | 104 | 84 |
| `pixelProps.d.ts` | 133 | 116 |

**src/client/views/cards**（18 份，合计 578 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `PixelCardTitle.ts` | 8 | 7 |
| `PixelCardNote.ts` | 9 | 8 |
| `PixelCardFoot.ts` | 11 | 10 |
| `PixelCardPin.ts` | 11 | 10 |
| `PixelCardTags.ts` | 14 | 13 |
| `PixelCardHead.ts` | 15 | 14 |
| `PixelCardNo.ts` | 18 | 17 |
| `cardBits.d.ts` | 22 | 17 |
| `PixelBlockedChrome.ts` | 22 | 21 |
| `PixelCardStamp.ts` | 24 | 23 |
| `PixelMapDots.ts` | 30 | 29 |
| `PixelCardTheme.ts` | 34 | 33 |
| `PixelCardBtns.ts` | 35 | 34 |
| `PixelMapCard.ts` | 49 | 48 |
| `cardProps.d.ts` | 51 | 46 |
| `PixelIssueMapCard.ts` | 73 | 70 |
| `PixelIssueCard.ts` | 74 | 71 |
| `PixelCardsStyles.ts` | 78 | 74 |

**src/client/views/pixel**（8 份，合计 145 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `PixelSeal.ts` | 11 | 5 |
| `PixelDot.ts` | 15 | 8 |
| `PixelNum.ts` | 15 | 8 |
| `PixelStateIcon.ts` | 15 | 8 |
| `PixelSkeleton.ts` | 18 | 11 |
| `PixelBanner.ts` | 21 | 14 |
| `PixelBtn.ts` | 24 | 17 |
| `PixelStatusLine.ts` | 26 | 17 |

**src/client/views/skillDetail**（7 份，合计 863 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `PixelContents.ts` | 26 | 19 |
| `PixelSkillList.ts` | 30 | 23 |
| `PixelSkillRow.ts` | 38 | 28 |
| `PixelStyles.ts` | 132 | 98 |
| `PixelSkillOps.ts` | 167 | 139 |
| `PixelSkillDetailModal.ts` | 193 | 167 |
| `PixelMarkdown.ts` | 277 | 262 |

**src/deck/registration**（6 份，合计 1,313 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `sandbox-guard.ts` | 59 | 30 |
| `host-delegate.ts` | 116 | 78 |
| `host-assemble.ts` | 126 | 79 |
| `quota-sync.ts` | 151 | 96 |
| `agent-row.ts` | 385 | 319 |
| `register-options.ts` | 476 | 343 |

**src/deck/rules**（9 份，合计 770 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `tool-order.ts` | 14 | 3 |
| `time.ts` | 24 | 4 |
| `index.ts` | 38 | 15 |
| `tool-table.ts` | 77 | 36 |
| `dependency-graph.ts` | 92 | 40 |
| `anchor.ts` | 95 | 39 |
| `minimal-spec.ts` | 126 | 66 |
| `workspace-file.ts` | 151 | 80 |
| `edge-landing.ts` | 153 | 86 |

**src/deck/shell**（13 份，合计 2,423 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `tool-table.ts` | 12 | 3 |
| `workspace-anchor.ts` | 70 | 28 |
| `minimal-spec.ts` | 71 | 30 |
| `in-flight-lease.ts` | 86 | 41 |
| `write-mutex.ts` | 124 | 70 |
| `plan-cursor.ts` | 152 | 95 |
| `session-workdir.ts` | 167 | 104 |
| `table-cell.ts` | 170 | 111 |
| `call-memo.ts` | 176 | 129 |
| `edge-landing.ts` | 247 | 161 |
| `call-shell-types.ts` | 270 | 170 |
| `call-budget.ts` | 410 | 306 |
| `call-shell.ts` | 468 | 323 |

**src/deck/tools**（10 份，合计 2,314 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `tool-order.ts` | 6 | 1 |
| `context.ts` | 171 | 118 |
| `map-snapshot.ts` | 200 | 143 |
| `issue-report.ts` | 202 | 148 |
| `issue-get.ts` | 222 | 163 |
| `issue-list.ts` | 224 | 169 |
| `issue-create.ts` | 246 | 179 |
| `map-link.ts` | 274 | 200 |
| `issue-patch.ts` | 322 | 244 |
| `map-plan-create.ts` | 447 | 333 |

**src/host**（11 份，合计 3,337 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `snapshotInflight.ts` | 45 | 21 |
| `remotePredicates.ts` | 101 | 74 |
| `snapshotEnvelope.ts` | 131 | 80 |
| `issueDetail.ts` | 189 | 158 |
| `publishFlow.ts` | 314 | 215 |
| `sessionRefresh.ts` | 361 | 292 |
| `sessionSnapshot.ts` | 382 | 320 |
| `snapshotBuild.ts` | 390 | 257 |
| `platformChannel.ts` | 456 | 344 |
| `git-process.ts` | 464 | 318 |
| `detectChain.ts` | 504 | 340 |

**src/host/outbound**（2 份，合计 312 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `tiers.ts` | 88 | 50 |
| `admission.ts` | 224 | 149 |

**src/host/platform/darwin**（1 份，合计 76 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `index.ts` | 76 | 40 |

**src/host/platform/linux**（1 份，合计 77 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `index.ts` | 77 | 40 |

**src/host/platform/win32**（1 份，合计 113 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `index.ts` | 113 | 67 |

**src/host/refresh**（4 份，合计 1,001 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `refusal-text.ts` | 48 | 27 |
| `chain-ride.ts` | 58 | 37 |
| `ledger.ts` | 417 | 264 |
| `gate.ts` | 478 | 333 |

**src/shared/config-store/src**（4 份，合计 736 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `ports.ts` | 56 | 33 |
| `workspace.ts` | 213 | 180 |
| `labels.ts` | 219 | 187 |
| `settings.ts` | 248 | 213 |

**src/shared/host-timer/src**（1 份，合计 73 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `host-timers.ts` | 73 | 20 |

**src/shared/label-color/src**（3 份，合计 245 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `prompt.ts` | 65 | 26 |
| `ports.ts` | 76 | 22 |
| `colors.ts` | 104 | 29 |

**src/shared/refresh/src**（14 份，合计 3,784 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `failure-window.ts` | 73 | 29 |
| `page-budget.ts` | 122 | 56 |
| `create-write.ts` | 133 | 82 |
| `backoff.ts` | 152 | 62 |
| `backend-quota.ts` | 159 | 87 |
| `tool-cost.ts` | 205 | 125 |
| `idempotency.ts` | 225 | 91 |
| `ports.ts` | 232 | 63 |
| `budget.ts` | 338 | 98 |
| `policy.ts` | 341 | 185 |
| `write-detect.ts` | 345 | 234 |
| `delta.ts` | 408 | 195 |
| `attention.ts` | 450 | 259 |
| `chain.ts` | 601 | 378 |

**src/shared/version-control/src**（14 份，合计 1,550 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `capabilities.ts` | 34 | 20 |
| `parse-log.ts` | 57 | 43 |
| `parse-patch.ts` | 64 | 33 |
| `parse-refs.ts` | 69 | 55 |
| `push-plan.ts` | 77 | 55 |
| `parse-diff-files.ts` | 82 | 55 |
| `parse-worktrees.ts` | 85 | 72 |
| `rules.ts` | 110 | 80 |
| `write-reasons.ts` | 110 | 74 |
| `parse-status.ts` | 132 | 103 |
| `write-ticket.ts` | 134 | 87 |
| `commands.ts` | 174 | 93 |
| `ports.ts` | 180 | 126 |
| `state.ts` | 242 | 191 |

**src/tracker**（10 份，合计 1,757 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `index.ts` | 30 | 7 |
| `label-names.ts` | 43 | 13 |
| `capability-assertions.ts` | 76 | 19 |
| `ui-description.ts` | 87 | 26 |
| `identity-keys.ts` | 96 | 44 |
| `preflight.ts` | 122 | 59 |
| `fix-contract.ts` | 190 | 114 |
| `body-parse.ts` | 251 | 137 |
| `deck-derive.ts` | 370 | 210 |
| `error-rules.ts` | 492 | 314 |

**src/tracker/contract**（15 份，合计 2,308 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `canonical-labels.ts` | 24 | 12 |
| `contract-idempotency.ts` | 54 | 1 |
| `contract-page.ts` | 72 | 0 |
| `vocabulary.ts` | 93 | 45 |
| `capability-answer.ts` | 95 | 15 |
| `identity.ts` | 96 | 20 |
| `contract-label-colors.ts` | 111 | 0 |
| `operations-catalog.ts` | 114 | 30 |
| `inputs.ts` | 142 | 49 |
| `results.ts` | 200 | 55 |
| `entities.ts` | 207 | 78 |
| `contexts.ts` | 226 | 74 |
| `backend-module.ts` | 249 | 68 |
| `operations.ts` | 312 | 107 |
| `index.ts` | 313 | 17 |

**src/tracker/detection**（8 份，合计 2,265 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `selection-precedence.ts` | 67 | 21 |
| `parseIssueTracker.ts` | 84 | 42 |
| `workspace-ownership.ts` | 90 | 39 |
| `explicitDetector.ts` | 97 | 54 |
| `workspaceStore.ts` | 129 | 90 |
| `preflightScope.ts` | 169 | 75 |
| `detectionService.ts` | 463 | 300 |
| `backendDecision.ts` | 1,166 | 740 |

**src/tracker/registry**（4 份，合计 592 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `builtins.ts` | 101 | 42 |
| `shape.ts` | 123 | 78 |
| `views.ts` | 142 | 87 |
| `core.ts` | 226 | 126 |

**src/tracker/rooms/github**（30 份，合计 6,179 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `init-project-error-kinds.ts` | 49 | 19 |
| `capability-register.ts` | 60 | 28 |
| `checks.ts` | 60 | 37 |
| `parent-repair.ts` | 69 | 47 |
| `fallback-reason.ts` | 75 | 51 |
| `roster.ts` | 106 | 77 |
| `cycle-check.ts` | 110 | 79 |
| `comments.ts` | 115 | 82 |
| `pulls.ts` | 115 | 78 |
| `repo-permissions.ts` | 126 | 71 |
| `counts.ts` | 145 | 91 |
| `sub-issues.ts` | 150 | 86 |
| `preflight.ts` | 151 | 93 |
| `write-log.ts` | 152 | 76 |
| `read-log.ts` | 173 | 90 |
| `repo.ts` | 176 | 107 |
| `backend.ts` | 177 | 112 |
| `errors.ts` | 191 | 84 |
| `labels.ts` | 195 | 129 |
| `page.ts` | 215 | 138 |
| `idempotency.ts` | 224 | 136 |
| `queries.ts` | 224 | 130 |
| `index.ts` | 242 | 162 |
| `init-project.ts` | 323 | 222 |
| `normalize.ts` | 344 | 257 |
| `label-colors-ops.ts` | 357 | 223 |
| `client.ts` | 427 | 260 |
| `issues.ts` | 433 | 326 |
| `issues-write.ts` | 464 | 349 |
| `graph.ts` | 531 | 356 |

**src/tracker/rooms/gitlab**（23 份，合计 5,219 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `graph.ts` | 7 | 5 |
| `queries.ts` | 39 | 22 |
| `capability-register.ts` | 72 | 28 |
| `client.ts` | 113 | 82 |
| `create-write.ts` | 133 | 72 |
| `preflight.ts` | 140 | 91 |
| `errors.ts` | 146 | 66 |
| `comments.ts` | 148 | 113 |
| `repo.ts` | 191 | 107 |
| `graph-membership.ts` | 195 | 147 |
| `labels.ts` | 196 | 151 |
| `counts.ts` | 214 | 116 |
| `idempotency.ts` | 215 | 142 |
| `pages.ts` | 237 | 136 |
| `read-log.ts` | 238 | 135 |
| `identity-ops.ts` | 279 | 138 |
| `init-project.ts` | 330 | 204 |
| `index.ts` | 343 | 217 |
| `sub-issues.ts` | 359 | 187 |
| `graph-blocking.ts` | 382 | 288 |
| `normalize.ts` | 387 | 329 |
| `issues.ts` | 401 | 286 |
| `labels-ops.ts` | 454 | 219 |

**src/tracker/rooms/markdown**（25 份，合计 3,505 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `issues.ts` | 11 | 9 |
| `normalize.ts` | 34 | 29 |
| `label-colors-paint.ts` | 49 | 32 |
| `write.ts` | 52 | 39 |
| `capability-register.ts` | 54 | 28 |
| `label-colors-palette.ts` | 55 | 31 |
| `label-colors-errors.ts` | 62 | 37 |
| `read.ts` | 62 | 49 |
| `issues-status.ts` | 66 | 49 |
| `write-queue.ts` | 67 | 29 |
| `comments.ts` | 68 | 54 |
| `path.ts` | 87 | 68 |
| `graph.ts` | 88 | 74 |
| `error-fail.ts` | 109 | 42 |
| `page.ts` | 117 | 70 |
| `counts.ts` | 118 | 67 |
| `label-colors-codec.ts` | 148 | 107 |
| `issues-locate.ts` | 194 | 143 |
| `issues-read.ts` | 204 | 151 |
| `parse.ts` | 255 | 186 |
| `label-colors-ops.ts` | 263 | 183 |
| `issues-create.ts` | 269 | 185 |
| `index.ts` | 336 | 211 |
| `label-colors.ts` | 368 | 219 |
| `issues-patch.ts` | 369 | 315 |

**tests**（30 份，合计 8,731 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `contract-probe-env.d.ts` | 20 | 5 |
| `contract-probe-markdown.ts` | 54 | 8 |
| `contract-probe-github.ts` | 57 | 8 |
| `verify-1161-rooms-assembly-samples.ts` | 99 | 66 |
| `verify-1136-room-cross-sample.ts` | 103 | 71 |
| `verify-rest-fallback-reason.ts` | 131 | 88 |
| `verify-unmigrated-tests.ts` | 137 | 96 |
| `verify-1144-markdown-issue-address.ts` | 148 | 107 |
| `verify-typecheck.mts` | 152 | 100 |
| `verify-1146-virtual-clock-liveness.ts` | 154 | 103 |
| `verify-capability-register.ts` | 171 | 115 |
| `verify-detection-log-reach.ts` | 172 | 134 |
| `verify-1129-markdown-claim.ts` | 178 | 113 |
| `verify-ui-description-single-source.ts` | 189 | 124 |
| `verify-error-raw-samples.ts` | 239 | 184 |
| `verify-1150-plan-store-durable.ts` | 266 | 192 |
| `verify-1109-matches-timeout.ts` | 270 | 187 |
| `verify-1039-rules-pure.ts` | 286 | 214 |
| `verify-1157-in-flight-lease.ts` | 291 | 214 |
| `verify-github-gh-via.ts` | 321 | 259 |
| `verify-1054-edge-graph.ts` | 326 | 259 |
| `verify-golden-receipts.ts` | 357 | 262 |
| `verify-1115-timer-handle.ts` | 399 | 314 |
| `verify-error-normalize-log.ts` | 406 | 309 |
| `verify-error-rule-samples.ts` | 416 | 326 |
| `verify-1053-issue-write.ts` | 427 | 344 |
| `verify-detection-evidence.ts` | 523 | 395 |
| `verify-error-single-source.ts` | 569 | 448 |
| `verify-1106-deck-surface.ts` | 575 | 473 |
| `verify-dependency-rules.ts` | 1,295 | 958 |

**tests/fixtures**（1 份，合计 242 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `error-samples.ts` | 242 | 197 |

**tests/lib**（2 份，合计 533 物理行）

| 文件 | 物理行 | 非空非注释行 |
|---|---|---|
| `eval-probe.ts` | 138 | 54 |
| `time-compress.ts` | 395 | 261 |
