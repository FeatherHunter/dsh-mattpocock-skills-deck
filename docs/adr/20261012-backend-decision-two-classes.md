# ADR 20261012 · 后端判定只有两类来源：人选与程序自己认（人选的唯一真源是工作区文件）

> 日期：2026-10-12 定版（维护者当日拍板）。
> 地位：本文只回答「判定结论是谁给的、谁有权写」这一件事的分类。判定顺序仍以 ADR `20260921-tracker-choice-precedence.md`（用户的手动选择 > 锚文件 > 自动识别）为准，本文不改它。凡与本文冲突的旧说法，以本文为准；未来任何讨论若改动本决策，以未来版本为准（与 `CONTEXT.md` 开头两条版本与效力规则同款）。
> 关联：#1003（本票收口时维护者追问「绑定与工作区文件是什么关系」「声明文件算不算自动识别的一部分」）· #669（判定顺序）· #683（用户选的后端按工作区存在宿主侧）· `CONTEXT.md` 的「后端判定来源词条」· 代码唯一落点 `src/host/tracker/detection/backendDecision.js` 里的 `decideBackend`

---

## 1. 问题：代码里原本看不出这两件事的答案

维护者在 #1003 收口时问了两件事：

1. 「人绑定」和「工作区文件」是不是两个来源？
2. 工作区里那份声明文件 `docs/agents/issue-tracker.md`，算不算自动识别的一部分？

这两问在代码里原本找不到明确答案：

- 判定出口排了四层，四层的名字（`user-memory-bind`、工作区文件、`declaration`、`autodetect`）看起来像四个互不相干的来源；
- 契约层对 `origin` 的注释（`src/tracker/contract/results.ts`）把这几个取值平铺成一串，还把工作区文件那几种出处写成 `user-file` / `migrated` / `detected`——代码实际产出的是 `user-file` / `file-migrated` / `file-detected` / `file-auto`，名字都对不上。

于是只能靠读实现反推。本文把答案定下来，以后不再问。

## 2. 裁决：四层只有两类

| 判定出口里的层 | 属于哪一类 | 谁写下的 | 今天能不能写 |
| --- | --- | --- | --- |
| 第 1 层 `user-memory-bind`（本次进程内的绑定副本） | **人选** | 人在界面上点确认那一下 | 能写 |
| 第 2 层 工作区配置文件 `docs/agents/workspace.yaml` | **人选** | 同上，同一个动作写下 | 能写 |
| 第 3 层 `declaration`（声明文件 `docs/agents/issue-tracker.md`） | **程序自己认** | 初始化那一步的 AI（插件自己不写） | 不能写 |
| 第 4 层 `autodetect`（后端 matches 命中） | **程序自己认** | 没有谁写，是读现场读出来的 | 不能写 |

**第 1、2 层是同一件事的两份记录，不是两个来源。** 证据：`src/host/workspaceCwd.js` 的 `handleBind` 一次动作同时写三处——内存绑定（`reg.bind`）、宿主侧记忆（`rememberWorkspace`）、工作区配置文件（`writeWorkspaceFileOnFirstBind`）；写文件那处的注释写明「唯一真源意味着用户明确选择时必须能覆盖它」。所以「人绑定」与「工作区文件」是同一个动作留下的当次副本与落盘真源。

**第 3、4 层是同一类，都是程序按规则自己认出来的。** 证据有两条：声明文件同时也是后端 matches 的输入（`src/host/tracker/backends/gitlab/index.js` 的 matches 注释点明它读 `.git/config`、`glab` remote 与 `issue-tracker.md`）；装配层注释也写明「读与解析与探测器同路径同口径（`docs/agents/issue-tracker.md` + `parseIssueTracker`），不另起第二套」（`src/host/platform/deckToolsAssembly.js`）。同一个文件被读两遍、贴了两个标签，但它属于哪一类是确定的：**程序自己认**。

## 3. 与 20260921 那条 ADR 的关系：不改判定顺序

`20260921-tracker-choice-precedence.md` 按「离人的意图有多近」排了三个来源：用户的手动选择 > 声明文件 > 自动识别。本文不动这个顺序，说的是另一件事——**结论是谁给的**。两件事不冲突：声明文件在顺序上排第二，在分类上属于「程序自己认」。

## 4. 唯一真源与另外两份记录

- **工作区配置文件 `docs/agents/workspace.yaml`**（兼容读老 `docs/agents/workspace.json`）：人选的**唯一真源**，判定第 2 层读它，跨重启、跨机器都在。
- **本次进程内的绑定副本**：判定第 1 层，与上面那份由同一个动作写下，进程结束即失。
- **宿主侧选择记忆**（#683 的 H，`src/host/choiceStore.js`）：2026-10-12 起**不再参与后端判定**——`src/host/tracker/detection/detectionService.js` 里写明「更不往出口递记忆口子（`getChoiceStore`）——出口已经不读它了」。今天它只服务两件事：把工作区配置文件生成一次（迁移那条路），以及版式（布局）答案。**记录本身不删**（维护者拍板「只停用不删记录」）。

## 5. 今天谁有写权限

九个 deck 工具与改色这两类写操作：结论必须来自**人选**（第 1、2 层）才放行；**程序自己认**的两层一律拒绝，并引导去面板选定（`src/deck/shell/call-shell.ts` 的写用途拦截，拒绝文案「不算你亲手选过」那一支；`src/host/workspaceLabelColors.js` 里那条拒绝文案）。读用途不受这条限制——读不需要人来确认过。

## 6. 已知边界（写清楚，免得以后又当成新问题问）

- 工作区配置文件今天只有两个写者，都是人的动作：选后端（`writeWorkspaceFileOnFirstBind`，来源记 `user` 或 `migrated`）与改版式（覆盖写时保留原来源）。判定里还认 `file-detected` / `file-auto` 两种出处，但今天没有写者，是读侧的兼容分支。
- 宿主侧记忆里每条记录固定记 `source: 'user'`，那是 #683 的字段口径，与本文的分类无关。
- 契约层 `origin` 字段今天仍是平铺的字符串（`src/tracker/contract/results.ts`），本轮只改注释、不动字段形状；把「出处 → 两类」做成机器可判的表并加门禁防漂移，另起一笔。

## 7. 本轮落地范围

只落文档与注释，行为零变化，一笔提交：

1. 本文；
2. `CONTEXT.md` 新增「后端判定来源词条」三条（人选 / 程序自己认 / 声明文件）；
3. `src/host/tracker/detection/backendDecision.js` 判定出口上方那段注释（写清四层归两类、各层的证据、今天谁能写）。
