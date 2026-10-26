# ADR 20261012 · 后端判定只有两类来源：人选与程序自己认（人选的唯一真源是工作区文件）

> 日期：2026-10-12 定版（维护者当日拍板）。
> 地位：本文只回答「判定结论是谁给的、谁有权写」这一件事的分类。判定顺序仍以 ADR `20260921-tracker-choice-precedence.md`（用户的手动选择 > 锚文件 > 自动识别）为准，本文不改它。凡与本文冲突的旧说法，以本文为准；未来任何讨论若改动本决策，以未来版本为准（与 `CONTEXT.md` 开头两条版本与效力规则同款）。
> 关联：#1003（本票收口时维护者追问「绑定与工作区文件是什么关系」「声明文件算不算自动识别的一部分」）· #669（判定顺序）· #683（用户选的后端按工作区存在宿主侧）· #1138（2026-10-14 落地：人选只留工作区文件一份记录，进程内那层副本已删；见第 8 节）· `CONTEXT.md` 的「后端判定来源词条」· 代码唯一落点 `src/tracker/detection/backendDecision.ts` 里的 `decideBackend`

---

## 1. 问题：代码里原本看不出这两件事的答案

维护者在 #1003 收口时问了两件事：

1. 「人绑定」和「工作区文件」是不是两个来源？
2. 工作区里那份声明文件 `docs/agents/issue-tracker.md`，算不算自动识别的一部分？

这两问在代码里原本找不到明确答案：

- 判定出口排了四层，四层的名字（`user-memory-bind`、工作区文件、`declaration`、`autodetect`）看起来像四个互不相干的来源；
- 契约层对 `origin` 的注释（`src/tracker/contract/results.ts`）把这几个取值平铺成一串，还把工作区文件那几种出处写成 `user-file` / `migrated` / `detected`——代码实际产出的是 `user-file` / `file-migrated` / `file-detected` / `file-auto`，名字都对不上。

于是只能靠读实现反推。本文把答案定下来，以后不再问。

## 2. 裁决：判定出口里的三层只有两类

（下表是 2026-10-14 #1138 落地之后的现状。落地之前判定出口排的是四层，多出来的第 1 层是「本次进程内的绑定副本」——那一层已随 #1138 整段删除，理由见第 8 节。）

| 判定出口里的层 | 属于哪一类 | 谁写下的 | 今天能不能写 |
| --- | --- | --- | --- |
| 第 1 层 工作区配置文件 `docs/agents/workspace.yaml` | **人选** | 人在界面上点确认那一下 | 能写 |
| 第 2 层 `declaration`（声明文件 `docs/agents/issue-tracker.md`） | **程序自己认** | 初始化那一步的 AI（插件自己不写） | 不能写 |
| 第 3 层 `autodetect`（后端 matches 命中） | **程序自己认** | 没有谁写，是读现场读出来的 | 不能写 |

**人选今天只有一份记录，就是工作区配置文件那一份。** 2026-10-14 之前 `src/host/workspaceCwd.js` 的 `handleBind` 一次动作会同时写三处——注册表里的进程内绑定（`reg.bind`）、宿主侧记忆（`rememberWorkspace`）、工作区配置文件（`writeWorkspaceFileOnFirstBind`）——判定出口再把前两处各排一层，于是同一件事在判定里有三份记录、结论谁先谁后要靠读实现反推。#1138 把这件事收成一条：注册表里那层进程内副本（`byHandle` / `bind` / `bound` / `allBindings`）整段删除，判定出口第一层直接读工作区文件，`handleBind` 写文件成功才算这次选择生效。宿主侧记忆（#683 的 H）保留为备份，但按第 4 节说的，它不参与判定。

**第 2、3 层是同一类，都是程序按规则自己认出来的。** 证据有两条：声明文件同时也是后端 matches 的输入（`src/tracker/rooms/gitlab/index.ts` 的 matches 注释点明它读 `.git/config`、`glab` remote 与 `issue-tracker.md`）；装配层注释也写明「读与解析与探测器同路径同口径（`docs/agents/issue-tracker.md` + `parseIssueTracker`），不另起第二套」（`src/deck/registration/host-assemble.ts:102`）。同一个文件被读两遍、贴了两个标签，但它属于哪一类是确定的：**程序自己认**。

## 3. 与 20260921 那条 ADR 的关系：不改判定顺序

`20260921-tracker-choice-precedence.md` 按「离人的意图有多近」排了三个来源：用户的手动选择 > 声明文件 > 自动识别。本文不动这个顺序，说的是另一件事——**结论是谁给的**。两件事不冲突：声明文件在顺序上排第二，在分类上属于「程序自己认」。

## 4. 人选只有一份记录，另外两份是备份或旁支

- **工作区配置文件 `docs/agents/workspace.yaml`**（兼容读老 `docs/agents/workspace.json`）：人选的**唯一真源**，判定第 1 层读它，跨重启、跨机器都在。写它的是 `src/host/workspaceCwd.js` 的 `writeWorkspaceRecord`（选后端时来源记 `user`，从本机记忆迁移过来时记 `migrated`）。**写成功才算这次选择生效**：写不进去就如实回失败，不再出现「选择已记下、只是文件没写进去」那种说法（#1138）。
- **宿主侧选择记忆**（#683 的 H，`src/host/choiceStore.js`）：2026-10-12 起**不再参与后端判定**——`src/tracker/detection/detectionService.ts:204` 里写明「不另起第二套判定」。今天它只服务一件事：把工作区配置文件生成一次（迁移那条路）。版式（布局）答案从 #1449（2026-10-24）起也只认工作区文件里的 `layout`，这份记忆不再读写布局（旧 `layouts` 记录只为原样带过保留，不物理删除）。**记录本身不删**（维护者拍板「只停用不删记录」）。
- **注册表里的进程内绑定副本**（`byHandle` / `bind` / `bound` / `allBindings`）：#1138 起**已整段删除**。它是同一件事的第三份记录，且只在本次进程里活着——留着的直接后果是「首帧那通电话」在文件还没读之前就先答了，以及写入失败时仍然答「已选定」。#1138 之后，任何地方都不许再靠「本进程里有绑定」答话（全仓审计见第 8 节）。

## 5. 今天谁有写权限

九个 deck 工具与改色这两类写操作：结论必须来自**人选**（第 1、2 层）才放行；**程序自己认**的两层一律拒绝，并引导去面板选定（`src/deck/shell/call-shell.ts` 的写用途拦截，拒绝文案「不算你亲手选过」那一支；`src/host/workspaceLabelColors.js` 里那条拒绝文案）。读用途不受这条限制——读不需要人来确认过。

## 6. 已知边界（写清楚，免得以后又当成新问题问）

- 工作区配置文件今天只有两个写者，都是人的动作：选后端（`writeWorkspaceRecord`，来源记 `user` 或 `migrated`）与改版式（覆盖写时保留原来源）。判定里还认 `file-detected` / `file-auto` 两种出处，但今天没有写者，是读侧的兼容分支。
- **「明确不要任何后端」这条状态判定层保留，但它写不进工作区文件**：文件的 `backendId` 强制非空（`src/shared/config-store/src/workspace.ts`），所以文件里表达不了「人明确说不要后端」。今天这条状态也没有活着的界面入口——`wf.bind` 的四个生产调用点全都带后端名（`src/client/statusbar/StatusBackend.js`、`src/client/panel/Dock.js`、`src/client/panel/OverlayGate.js`、`src/client/kernel/store-switch.js`），把后端选择清掉的入口已经退役（`src/client/kernel/store-switch.js` 的 `clearBackendBinding`、ADR `20260921-tracker-choice-precedence.md` 第 30 行）。#1138 的判据只有一条：**不能骗人**——文件里写不出这条状态，就不要让界面上有一条能走到它、又答不出所以然的路。这条状态将来若要有界面入口，先解决「它落在哪儿」这个问题。
- 宿主侧记忆里每条记录固定记 `source: 'user'`，那是 #683 的字段口径，与本文的分类无关。
- 契约层 `origin` 字段今天仍是平铺的字符串（`src/tracker/contract/results.ts`），本轮只改注释、不动字段形状；把「出处 → 两类」做成机器可判的表并加门禁防漂移，另起一笔。

## 7. 本轮落地范围

只落文档与注释，行为零变化，一笔提交：

1. 本文；
2. `CONTEXT.md` 新增「后端判定来源词条」三条（人选 / 程序自己认 / 声明文件）；
3. `src/tracker/detection/backendDecision.ts` 判定出口上方那段注释（写清三层归两类、各层的证据、今天谁能写）。

## 8. 2026-10-14 修订（#1138）：人选只留工作区文件一份

上面第 2 节的表已按这一节改成三层。这一节记的是**为什么**，以及跟着改动的边界。

**删掉进程内那层副本的理由（三条，缺一条都不足以动手）：**

1. **它让「首帧那通电话」答在了文件之前。** 判定出口原来第一层就读进程内副本，而那份副本只在 `wf.bind` 那一下存在；进程重启后同一通电话要走文件层。同一件事两个答案，靠「哪一层先」决定，读实现才看得出来。
2. **它让写入失败还能答「已选定」。** `wf.bind` 顶层 `ok` 恒为真，文件写失败只把失败塞在 `workspaceFile` 里，界面照旧提示「已切换到某某」——选择其实没落盘，下次重启就变了。
3. **它和「人选只有一份记录」这句裁决直接冲突**（第 2 节）。留着它，这句话就只是注释里的一句愿望。

**跟着改的地方（全仓审计结论：删掉之后不许再有地方靠「本进程里有绑定」答话）：**

- `src/tracker/detection/backendDecision.ts`：`decidePure` 去掉 `boundId` 那一层；`decideBackend` 自己按 `{cwd}` 组 handle。
- `src/tracker/detection/explicitDetector.ts`：删掉读内存绑定那一段。
- `src/host/workspaceCwd.js`：`handleBind` 改为「先写文件，写成功才算生效」；`handleBindings` 不再回注册表里的绑定表，改成按调用方递进来的工作区目录逐个读文件（插件没有「这台机器上有哪些工作区」的名单，那是 DSH 工作区服务的知识）；`handleRegistry` 不再回 `bound` 那一格；`handleSelection` 走统一判定出口。
- `src/host/refresh/wiring.js`：`handleFor` 不再扫绑定表，直接按会话里的工作目录组 handle。
- `src/host/platformChannel.js`：注册表卸载后端时发的是 `unregister`（带 `id`），宿主侧缓存按后端名清格子（`workspaceStore.invalidateByBackend`）。
- 界面上那句小灰字（`src/client/kernel/store-prefs.js` 的 `workspaceFileNoteOf`）与状态栏（`src/client/statusbar/StatusBackend.js`）：写失败一律如实说这次选择没生效、并说清下一步，不再出现「绑定与本机记忆不受影响」。

**clone 口径（维护者 2026-10-14 拍板，判据是「尊重 clone 时的选择」）：** 工作区文件里写着谁，就算人选是谁——哪怕这份文件是别人 clone 下来的。**不降级、不要求重新确认、不新增「这条是不是本机写的」判断。** 用户可以沿用，也可以换掉重选；不想让自己的选择影响别人，**不提交自己那份改动即可**。

**「不提交」靠人自觉，所以要写在人看得见的地方：** `docs/agents/workspace.yaml` **没有**被 `.gitignore` 忽略（已实测确认），它和别的文件一样会被 `git add .` 带上。所以两句话各有出处——**别提交自己的选择**（那是你本机的偏好）；**提交了就是团队选择**（clone 下来的人会照它走）。这两句写在这里，就是它们的出处。

## 9. 2026-10-16 修订：工具壳删掉「非亲手选过不放行」那道门

上面第 5 节里「九个 deck 工具……程序自己认的两层一律拒绝」这一句，从今天起只剩后半句对改色电话成立，工具壳那半句作废（维护者当日拍板，起因是只有声明文件的工作区连纯读工具都被拦）。

- 删的是 `src/deck/shell/call-shell.ts` 里 `pickBackend` 按 `canWrite !== true` 拒绝的那一支：判定出口给出哪个后端，壳就用哪个，声明文件与自动识别来的结论同样放行。
- 没删的有三处：判定出口照旧如实标出来源与写权限（`canWrite` / `reason: 'needs-generate'` 还在，排查看日志结论线）；多命中或未决、连后端都没有这两支拒绝还在；改色电话（`src/host/workspaceLabelColors.js`）的写用途还留着同一道门。
- 「人选 / 程序自己认」这个分类本身不动：工作区配置文件仍然是人选的唯一真源，面板照旧从它读选择。

## 10. 2026-10-26 补记（#1555）：声明仍是 matches 的输入，但只认“声明形状”

第 2 节说第 2、3 层同类、声明文件同时也是 matches 的输入；这一条不变。改的是 matches 读它的口径：GitLab 的 matches 以前拿整篇 `docs/agents/issue-tracker.md` 做 `/gitlab/i` 扫描，正文里提一句 GitLab 就被当成“声明用 GitLab”；真机上它与 markdown 同时举手，详情与评论读不到（#1555）。

现在 GitLab 的 matches 用判定层同一个 `parseIssueTracker` 解析声明文件，只认高置信的 `# Issue tracker: GitLab` 标题行；低置信的正文兜底留给判定层（判定层本来就排在自动识别之前）。解析器从 `src/tracker/detection/` 搬进 `src/tracker/kernel/`（房间只许引内核与契约），detection 旧路径留成转出口。回归门禁：`tests/verify-1555-gitlab-claim-declaration.ts`。
