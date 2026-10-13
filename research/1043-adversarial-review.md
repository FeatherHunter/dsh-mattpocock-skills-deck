# 地图06 讨论结论的对抗式审查记录（#1043）

2026-10-14 写。审查对象是这次讨论落进票里的每一句断言：讨论票 #1043 正文的六条结论、地图 #1042 的 Decisions so far、规格单 #1110、小票 #1109、开发票 #1044 的边界文本。

做法分两步：先由一个独立子代理拿票面原文与源码逐条对，再用 `read` / `grep` 自己复核其中最要紧的两条（生产超时的实际取值、搬迁后的文件位置）。子代理报回 16 条断言的核对结果与 6 个真问题，我复核后确认全部成立。

## 一、16 条断言：15 条成立、1 条不成立

| # | 断言 | 结论 | 证据 |
|---|---|---|---|
| 1 | 三级先后的每一级出口 | 成立 | `src/tracker/registry/registryCore.ts:141-146` 显式命中直接回；`:159-167` 并行识别命中取 `hits[0]` 并带 `multiHit`/`pending`；`:175` 只有无命中且 `pendingIds` 为空才回 `backendId:null`；`:154`、`:158` 把未决往上传 |
| 2 | 缺省等待 3000 且可被调用方覆盖 | 成立 | `registryCore.ts:52` 缺省值；`:36` 的 `opts.matchesTimeout` 可覆盖；子代理用假时钟复现，实际申请 3000 |
| 3 | 空目录直接回「还不知道」且不起外部命令 | 成立 | `registryCore.ts:132-135` 在整段逻辑最前面返回 `origin:'unknown-workspace'`，其后无文件与进程调用 |
| 4 | 多家命中取注册序第一家、名单如实带出 | 成立 | `registryCore.ts:160` 取 `hits[0]`；`:165` `multiHit`；`:53` 注释说明 Map 迭代序即注册序，替换注册保持键位 |
| 5 | 绑定三态互不混用、未注册编号当场拒、卸载即过期 | 成立 | `registryCore.ts:188-192`（未定义／空／编号）；`:181-183` 抛 `unknown-backend`；`:67-81` 删句柄并逐个句柄广播过期，`:76` 注释要求带真实句柄 |
| 6 | 注册只验四件事，缺操作不拦 | 成立 | `registryShape.ts:97-101` 四验；`registryCore.ts:84` 注释「不因缺 op 拒绝」；`registryShape.ts:102-104` 保留串拒绝 |
| 7 | 缺操作补桩返回不抛、只对名录名字生效 | 成立 | `registryShape.ts:62-69` 返回 `UNSUPPORTED`；`:89` 用 `OPERATIONS.includes` 限定；`:90` 旁路成员透传 |
| 8 | 三个链接相关能力按各家语义走 | **不成立（GitLab 那半反了）** | GitHub `src/tracker/rooms/github/repo.ts:45-63`、本地文件 `src/tracker/rooms/markdown/index.ts:69-86`（裸盘符绝对路径、`"#(\\d+)"`、搜索回空）都对；但 GitLab 自己也实现了这三个：`src/tracker/rooms/gitlab/index.js:77-81`、`:83-85`、`:87`，并挂在 `:215-218`、`:111`。票面原写「GitLab 本次先当没实现，诚实空着以后补」，与代码不符 |
| 9 | 工作单元标识原样转发 | 成立 | `registryViews.ts:11-15` 的 `withEffort`，包在 `:20-26`、`:37-43`、`:50` 三处；产出方 `markdown/index.ts:64-66` 也透传 |
| 10 | 八档在场、缺工具在找不到之前判 | 成立，但顺序不是单一口径 | `src/tracker/contract/vocabulary.ts:75-84` 八档；`src/tracker/preflight.ts:44`→`:46`→`:48`（注释写明必须在 NOTFOUND 之前）→`:50`→`:52`→`:54`→`:56`；`:58` 认不出归网络。另有一套：`src/tracker/rooms/github/errors.ts:84-103` 先判环境缺工具 |
| 11 | 失败用返回不用抛 | 成立 | `preflight.ts:62-69`；`registryShape.ts:63-65`；`registryCore.ts:23`、`:28` 把超时与异常收成返回值 |
| 12 | 注册只发生在宿主平台通道一处 | 成立 | `src/host/platformChannel.js:48-77`：`:50` 建注册表，`:55`/`:71`/`:76` 分别注册三个模块；全仓折向注册表的 `.register(` 只此三处（另有 `:44-45` 的注入旁路） |
| 13 | 契约写明「测试要能替换假时钟」 | 成立 | `src/tracker/contract/contexts.ts:123`、`:139`、`:140`；`registryCore.ts:16-17` 从 `timers` 取计时器，`:153` 把上下文递进去 |
| 14 | 注册表里有三条按后端名硬编码的兜底拼装 | 成立 | `registryViews.ts:65`（GitHub 票网址）、`:66`（GitLab 票网址）、`:90`（GitHub 搜索页），都在转发失败才走的回退位 |
| 15 | 契约门禁锁住后端模块的键 | 成立，但覆盖不全 | `tests/verify-contract-types.js:100-111` 的键快照只有 github（`:102`）与 markdown（`:107`），**没有 gitlab**；只锁键名，不锁客户端真正读的 `links.*Template` 取值 |
| 16 | 改名后老名字仍被读、别名必须保留键名 | 成立 | 客户端 `src/client/kernel/link.js:58`、`:77`、`:87`、`:37`（数据来自 `:26` 的 `m.links`）；宿主 `src/host/snapshotBuild.ts:180`、`src/host/sessionSnapshot.ts:188`、`src/host/sessionRefresh.ts:155` |

## 二、六个真问题（都已处理）

### 1. 「只改缺省值」在生产不生效（实质错误）

规格单 #1110 原先写的是「只改缺省值」，但生产装配处两次显式传了值，把缺省值盖住：

- `src/tracker/registry/registryCore.ts:52` 的缺省值 3000；
- `src/host/platformChannel.js:50` 正常装配路径 `{ matchesTimeout: 3000 }`；
- `src/host/platformChannel.js:86` 回落装配路径同一个值。

只改缺省值的话，小票 #1109 的判据会绿，而实际等待仍是 3 秒——治不到它自己 Problem Statement 里说的「界面老是显示等待」。**处理**：#1109 与 #1110 的口径改成「改生产实际用的那个等待」，推荐删掉生产两处显式传值、让缺省值成为唯一出处；门禁断言的必须是生产路径申请的毫秒数，不能只断言缺省字面量。

### 2. GitLab 口径三方冲突，两处与代码不符

代码早已实现 GitLab 的三个链接相关能力，而讨论票与地图当时写着「本次先当没实现，诚实空着」。**处理**：#1043 正文的贯穿原则段与第四节、地图 #1042 的决策条、规格单 #1110 的实现决定第 10 条与 Out of Scope 已统一成「GitLab 有它自己的一套、现有实现保持原样、本次只跟着改名」。

### 3. 契约门禁漏 GitLab，也漏客户端真正读的模板键

改 GitLab 的键不会有任何门禁变红；客户端读的是 `links.*Template`，键快照不覆盖取值。**处理**：写进规格单 #1110 实现决定第 15 条，改名的开发票 #1044 要补 gitlab 一份快照。

### 4. 八档顺序不是单一口径

跟踪器层通用分类器是「没登录 → 限流 → 缺工具 → 找不到 → 不支持 → 解析 → 网络」，GitHub 房间自带那套先判缺工具。这是既有分歧，不是这次改动引入的。**处理**：规格单与讨论票都把顺序收窄为「跟踪器层通用分类器」，GitHub 那套写进 Out of Scope，标明未定要不要收口；不替维护者决定。

### 5. 假时钟缝够不到 deck 工具入口

`src/host/refresh/wiring.js:319-328` 造的调用上下文没带 `timers`，经 deck 工具进来的选择走全局 `setTimeout`，替身时钟只能覆盖自己传 `timers` 的入口（如 `src/tracker/detection/detectionService.ts:26-36`、`src/host/platformChannel.js:322`）。**处理**：写进 #1110 的 Testing Decisions 与 #1109 的「怎么证」，要求门禁咬生产路径，而不是只咬着一条够不到的缝。

### 6. 开发票 #1044 的边界文本与仓库现状脱节

票面点名 `src/host/tracker/index.js` 与 `registryCore.js`/`registryShape.js`/`registryViews.js`/`preflight.js`，但这几份早在 #1019（提交 `d0fdb277`）就搬走并改成 `.ts` 了。今天实际是 `src/tracker/index.ts`（`:11-16`）、`src/tracker/registry/registryCore.ts`、`registryShape.ts`、`registryViews.ts`、`src/tracker/preflight.ts`；`src/host/tracker/` 下只剩 `capability.js`、`generic.js`、`predicateCore.js`、`predicatePrimitives.js`、`snapshot.js`。**处理**：#1044 正文按现状重写；顺带补两件它没写的：文件短名按 `docs/adr/20261011-deck-ts-rewrite.md:76` 应为 `core.ts`/`shape.ts`/`views.ts`；这几件今天只被转译、没有类型检查（`scripts/build.mjs:830` 注明新树尚无 tsconfig，原记在 #1095 而该票已关）。

## 三、复核时自己另外查到的一处

活文档路径陈旧：`docs/tour/deck-call-end-to-end.md:41`、`:296` 仍在指 `src/host/tracker/registryCore.js` 这类搬迁前的路径。#1095 的判据只覆盖 `tests/**`，这一处没人管。**处理**：写进 #1110 实现决定第 19 条，改名的同批更新；`docs/research/`、`docs/design/`、`docs/triage/` 属历史文档，不动。

另记一笔以免后人误判：客户端 `src/client/kernel/link.js` 里也有 `issueUrlFor`/`searchUrlFor`/`repoUrlFor` 这类同名字段（`docs/architecture/kernel-contract.md:67` 有登记）。那是客户端自己的纯函数，不在本图范围，改名只需保证注册表那三个键名作为别名继续存在。

## 四、这次改动落到哪些文件

- `research/1043-adversarial-review.md`（本文件，新增）
- 规格单 #1110：实现决定第 1、3、8、10、12、14、15、17、19 条，Testing Decisions，Out of Scope，Further Notes，进度
- 小票 #1109：目的、边界、判据、「改哪几处」、「怎么证」、进度
- 讨论票 #1043：进度、贯穿原则段、第一节、第三节、第五节、第六节、下一步
- 地图 #1042：判据注、Decisions so far 六条、Not yet specified
- 开发票 #1044：正文按现状重写（文件清单、跨代接缝、类型检查归属、活文档），并留一条评论指向规格单

没有改任何产品代码：这一轮的边界就是把话写对。
