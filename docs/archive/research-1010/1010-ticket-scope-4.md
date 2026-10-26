# 票面核实（第四组：快照、刷新、登录态显示六张）

核实人：票面核实员（第二批子任务）。方法：用 `gh issue view <号> --json title,body,state,labels` 逐张读回正文，票面引用的关键代码锚点逐条开源码复核（下面每节都写核到了哪一行）。判定基准＝本次 deck 重构范围：`src/deck/**` ＋ `src/tracker/contract/**` ＋ `src/tracker/registry/**` ＋ `src/tracker/rooms/{github,markdown}/**` ＋ `src/tracker/detection/**` ＋ `src/host/refresh/**` 里被 deck 调到的行；不在内：`src/client/**`、提示词文案、`scripts/**`、GitLab 房、四个计算核。

判定四档：**吞掉**（重构内解决）／**部分**（写明哪半归谁）／**不归我们**（写明归哪块）／**已可关**（给证据）。

---

## 一、#1009 冷启动的快照被 30 秒死线整份丢掉——等待分档，迟到的完整快照不再作废

- 状态：OPEN，标签 `bug`／`needs-triage`。
- 票面落点：`src/client/kernel/probe-snapshot.js`（死线）、`src/client/kernel/probe-select.js`（迟到落地）、验收门禁 `tests/verify-subdir-first-frame.js` 与 `tests/verify-729-force-dedup.js`。
- 我复核到的锚点：`src/client/kernel/probe-snapshot.js:19` 确实写着 `export const SNAP_WAIT_MS = 30000`；同文件 `:174` 的超时原文是 `client loadSnapshot timeout 30s`；`:250` 起是「超时后置 snapPending」那一段。票面说法属实。
- 判定：**不归我们**。理由：本票要改的三件（冷启动走长预算、迟到的完整快照不作废、工作区换走时按请求键存内存表）全部落在 `src/client/kernel/` 这两个客户端文件里，属面板那一摊；宿主侧的整池快照重建（`wf.snapshot`）也归刷新机制，不归 deck 工具链。
- 补充（同一现象的另一半才归我们）：票面「上下文」提到出站名额被占满（读 8／写 2），那属于 #960／#962 那一族；名额机制的**调用方**在 GitHub 房 `client.js`（我们全量转），机制本体在共享层（不在我们范围）。所以这张票本身与我们无关，但它的根因链上有一段在我们手里。

## 二、#891 初始化完成后黄条仍提示未初始化，疑似刷新机制不再定期刷新

- 状态：OPEN，标签 `bug`／`ready-for-agent`／`wayfinder:task`。票面「进度」写明：修复已实施并提交（`c16f139`），`tests/verify-891-setup-refresh.js` 18 项全绿，`package/lib/client.js` 含 setup-pending 钩子，**只差真机确认**。
- 票面落点：客户端链模块（`src/client/kernel/probe-chain.js`、`probe-auto.js`）与宿主检查链事件；根因是「初始化经文件落盘发生在链事件之外」。
- 我复核到的锚点：这一族的零定时器纪律写在 `src/host/refresh/chainBackoff.js:11`（原文「本文件**不排任何定时器**，一条都没有」），票面引用的文件与行号属实。
- 判定：**不归我们**（归面板与检查链那一摊：客户端链模块加宿主链的求值触发）。它与 deck 工具链没有代码交集——链求值走的是检查目录与谓词那一摊，不是九个工具。
- 一句可执行的话：这张票按票面自述已经是「修好待验」，真机确认归维护者，不需要等我们重构。

## 三、#995 状态栏黄条「登录状态暂时确认不了」不会自己消失

- 状态：OPEN，标签 `bug`／`needs-triage`。票面末段写明：2026-10-10 维护者拍板「先建单、标待复现、**暂不解决**」。
- 票面落点（我逐条复核，全部属实）：`src/shared/tracker/guide-steps.js:45`（`ghAuthUnknown` 横幅配置）、`:80-81`（`gh:authed` 步骤）、`:192`（第 3 步 `pending` 时出这条横幅）、`:203`（按钮动作 `MISSING.ghAuthRecheck`）；`src/host/refresh/chainBackoff.js:11`（宿主零定时器）；`src/host/detectChain.js:155` 起注册 `preflight:ghAuth` 谓词（票面说 155–169 行，`:155` 确为注册行）。
- 判定：**不归我们**（归引导链与状态栏那一摊：`src/shared/tracker/guide-steps.js` 的横幅判定 ＋ 客户端横幅模块 ＋ 宿主检查链的求值触发）。它与 deck 工具链无交集。
- 补充：票面已明确「暂不解决」，这是维护者的产品口径决定，不是待办遗漏；重构不改变它的状态。

## 四、#918 通用刷新老路缺 user-recheck 令牌或被退避吞掉（#916 F7 拆出）

- 状态：OPEN，标签 `bug`／`needs-triage`，正文很短（由 #916 对抗审查 F7 拆出，为控范围未动）。
- 票面落点：横幅动作分发里的 `refresh` 一路（客户端）与宿主退避档位。
- 判定：**不归我们**。理由：落点是客户端横幅动作分发与宿主退避，属面板与刷新那一摊；deck 工具链不参与「人点重查」这条通路（工具是自己带调用范围与超时余量走的，见 `src/shared/deck-tools/call-scope.js`，与 `user-recheck` 令牌无关）。
- 关联提示：票面自己写明与 #916 同族，修 #916 时一并看即可。

## 五、#916 gh already logged in but panel still shows Sign-in prerequisite missing

- 状态：OPEN，标签 `bug`／`ready-for-agent`（triage 已完成，转 ready-for-agent，尚未实施）。
- 票面落点：横幅判定（「没通过就出黄条，查不到也算没通过」，文案没区分失败与查不到）＋ 面板侧跑 `gh` 的环境可能与终端不一致（工作区目录、超时、PATH）。
- 我复核到的锚点（关键事实，决定归属）：
  - 检查项的**声明**在 GitHub 房：`src/host/tracker/backends/github/checks.js:33`（`id: 'gh:authed'`）与 `src/host/tracker/backends/github/index.js:51`（同 id 的修复知识与文案键）——**这两处在我们的全量转范围里**。
  - 检查项的**判定逻辑**不归我们：真正跑 `gh auth status` 的谓词注册在 `src/host/detectChain.js:155` 起的 `preflight:ghAuth`。
  - 横幅与文案不归我们：`src/shared/tracker/guide-steps.js`（横幅配置）与 `src/client/**`（显示、词条 `src/client/kernel/locale-word.js:110`）。
- 判定：**部分**。归我们的那一半是「检查项的声明与修复文案数据」（GitHub 房 `checks.js` 与 `index.js`，随房间全量转 TypeScript，转的时候这两处要跟着接口一起对形状）；另一半——判定逻辑区分 `pending`／`fail`、以及横幅文案与交互——归面板与检查链那一摊，不是我们这趟能顺手吞掉的。

## 六、#917 登录失败分支未排除环境差异就给重登录指引（#916 F4 拆出）

- 状态：OPEN，标签 `bug`／`needs-triage`，正文很短。
- 票面落点与期望：失败分支先给一次低成本自证（例如先提示点重新检查，或注明判的是哪一侧的环境），不让用户为环境差异买单。
- 判定：**部分**（比 #916 更偏面板）。归我们的只有「修复知识里的文案键与检查项声明」这一小块（`src/host/tracker/backends/github/index.js` 的 `fixes['gh:authed']` 与 `checks.js` 的条目，随房间全量转）；本票的主体（失败分支的行为、自证入口、环境差异怎么暴露给用户）落在 `src/shared/tracker/guide-steps.js` 与 `src/client/**`，以及宿主侧 `gh` 解析那一摊（`src/host/repoKeys.js`，不在我们范围）。
- 一句话：#917 实质上是一张交互与文案票，重构只负责把它引用到的那份文案数据搬进 TypeScript，行为不动。

---

## 小结（六张的对我们的关系）

| 票 | 判定 | 归谁 |
|----|------|------|
| #1009 | 不归我们 | 客户端快照等待与落地（面板那一摊）；其根因链上的出站名额一段属 #960／#962 |
| #891 | 不归我们 | 客户端链模块与宿主检查链；票面自述已修好待真机确认 |
| #995 | 不归我们 | 引导链与状态栏；维护者已拍板「暂不解决」 |
| #918 | 不归我们 | 客户端横幅动作与宿主退避 |
| #916 | **部分** | 检查项声明与修复文案数据（`rooms/github/checks.js`、`rooms/github/index.js`）归我们；判定逻辑与横幅显示归面板与检查链 |
| #917 | **部分** | 同上，且主体更偏面板 |

一句话总结：这一组六张里，四张完全在面板与检查链那一摊，与 deck 工具链没有代码交集；两张（#916、#917）只有「检查项声明＋修复文案数据」这一小块随 GitHub 房全量转 TypeScript，行为不改。**它们都不属于「重构顺手吞掉」的那一类**——票里的行为问题依旧要靠各自的归属方去修。
