# 研究：体检按钮的接线盘点（#680 只读事实核对）

这份底稿只为把四件事查清：面板 KPI 那一行手上有什么、按后端注入提示词今天走哪条路、游离票算不算得出来、三个后端各声明了什么。

全部结论来自对着工作区里的源码逐处读过，没有改任何代码、没有改任何票的正文、没有建提交。坐标写成「文件路径:行号」，行号对应写下这份底稿时工作区里的版本（HEAD 是 3c5096d）。工作区里另有别的会话留下的未提交改动（`docs/prototype/`、`docs/research/` 下的几个文件），与本底稿无关，一个字没动。

## 一、面板 KPI 那一行手上有什么

### 1.1 那一行的代码位置与它画的数字

- 行本体在 `src/client/views/ListTab.js:230-236`：一个 flex 容器（`display:flex; gap:10; marginBottom:4; flexWrap:wrap`），里面依次是三枚指标，最后是一个 `flex:1` 的空占位（`src/client/views/ListTab.js:234`；紧接着 235 行的注释说明「刷新按钮已上移到页签行」）。要加的那颗「体检」按钮，按今天的样子就是塞在 234 行这个空占位之后。
- 三枚指标由同一个工厂函数画：`src/client/views/ListTab.js:212` 的 `kpi(num, lab, icon, color)`；三次调用在 231-233 行，文案键分别是 `list.kpi.takeable`（可接）、`list.kpi.occupied`（阻塞）、`list.kpi.closed`（已关闭）。中文词条在 `src/client/kernel/locale-flow.js:31-33`，英文词条在同文件 `:195-197`。
- 三枚数字在 `src/client/views/ListTab.js:207-211` 算好：
  - `kpiOpenScoped = openIssuesOf(st).filter(effPass)`（`:208`）；
  - `kpiOcc`（阻塞/占用）= 这批里 `isOccupied(st, x)` 为真的条数（`:209`）；
  - `kpiFrontier`（可接）= 这批总数减掉 `kpiOcc`（`:210`）；
  - `kpiClosed`（已关闭）= `closedIssues.filter(effPass).length`（`:211`）。

### 1.2 这一行能拿到的状态（同一次渲染里已经算好的变量）

全部经由组件入参 `st`（每个会话一份的 store，字段定义见 `src/client/kernel/store-snapshot.js:9-39`）与它里面的快照：

- `st.snapshot`（`store-snapshot.js:21`）：宿主电话 `wf.snapshot` 回来的那一份，含 `maps` / `issues` / `labels` / `repository` / `selection` / `backendModules` / `deck`（组装见 `src/host/sessionSnapshot.js:31-50` 的 `buildSnap`）。
- 界面状态：`st.tab`（`:10`）、`st.selection`（`:22`）、`st.backendModules`（`:24`）、`st.cwd`（`:27`）、`st.lblFilters` / `st.effFilters` / `st.expLabels`（`:27`）、`st.stateFilter` / `st.sortKey` / `st.sortDir`（`:31`，缺省值来自 `listPrefs` 持久层）、`st.snapMode` / `st.snapError`（`:33`）、`st.refreshing`（`:35`）。
- 这一段渲染里已经派生好、按钮里直接可用的量：
  - `issues`（`ListTab.js:102`）、`openIssues`（`:103`，非 CLOSED）、`closedIssues`（`:104`）；
  - `effortNames` / `multiEffort`（`:95-96`，取数函数 `effortNamesOf(st)` 在 `src/client/kernel/store-derived.js:34-43`）；
  - `effPass`（`ListTab.js:98-101`，按 effort 筛选）；
  - `groups = compute(st)`（`:125`；`compute` 在 `src/client/kernel/store-derived.js:64-77`）；
  - `nBad`（`:128`，环境链上 fail/current 的步数）；
  - `stat` / `colorOf` / `tagNames` / `labelNames` / `sortedLabels`（`:130-149`，标签统计与配色）；
  - `blockOf`（`:152` 取 `mapBlockOf(st.snapshot)`，`:156` 再合并独立票的阻塞边；两个函数在 `src/client/kernel/store-derived.js:45-61` 与 `:150-186`）；
  - 四枚 KPI 值（`:207-211`）。
- 同一闭包里可以直接调用的共享函数（文件里已经在用这些）：`isOccupied`（`:174`、`:209`）、`openIssuesOf`（`:208`）、`idOf` / `effortOf`、`tr('键')`（词条）、`Ic({n,size,color})`（图标）、`Tip`（悬浮提示）、`emit(st)`、`listPrefs` / `saveListPrefs`、`inject(st, text)`、`openTextInNewSession(st, text, title)`、`promptText(id, params)`、`promptTextFor(st, id, params)`、`copyText`、`flash`、`refreshAll(st)`、`loadSnapshot(st, ...)`。
  - 依据：本文件与从它拆出去的 `src/client/views/ListTabRow.js` 在构建时被拼回同一个闭包（`ListTabRow.js:1-7` 的接线注释、`src/client/views/ListTab.js:1-5` 与 `src/client/index.js:233` 的拼接标记），所以行里能用的这些函数，KPI 那一行同样能用。
- 「当前是哪个后端」「这个后端声明了什么」在这一行也拿得到：后端名从 `st.selection.backendId`（回退顺序见 `src/client/kernel/prompts.js:105-113`）或 `st.snapshot.selection.backendId` 取；该后端的声明对象用 `moduleMetaOf(st, backendId)` 取（`src/client/kernel/builtin-backends.js:42-47`），里面就有 `prompts` / `setupPrompt` / `labelPalette` / `links` / `openRepository` 这些字段（快照侧怎么把它们带过来见 `src/host/sessionSnapshot.js:144-147`）。

### 1.3 同一块面板里已有按钮各自在哪、怎么接的

| 按钮 | 位置 | 怎么接上去的 |
| --- | --- | --- |
| 页签行的「刷新」 | `src/client/views/shared/Tabs.js:47`（`data-priority=3`，图标 + `tr('list.refresh')`） | `onClick` 直接调 `refreshAll(s)`；整个页签行由 `src/client/panel/Dock.js:74` 的 `useTabsRow(s, tabsRef)` 组装，渲染在 `Dock.js:302-303` 附近 |
| 检查页自己那颗「重新检查」 | `src/client/views/ChecksTab.js:194-197` | `onClick` 也调 `refreshAll(st)`，`disabled` 绑 `st.refreshing` |
| 列表行的行级动作（诊断 / 修复 / 讨论 / 执行） | `src/client/views/ListTabRow.js:85`（三选一：地图空态用 `mapInspect`，地图完成态用 `complete`，其余用 `mkRowAction`） | `mkRowAction` 在 `src/client/kernel/store-derived.js:246-286`：按标签四选一（文本来自 `rowActionText`，`:228-243`），按钮 `onClick` 调 `inject(st, text)`（`:274`）→ `src/client/kernel/api-io.js:31-37` |
| 行级「新会话」按钮 | 同在 `src/client/views/ListTabRow.js:85`（`openInNewSession(st, x)`） | `src/client/kernel/api-io.js:11-29` → `openTextInNewSession(st, text, title)` |
| 地图详情页子票行的动作按钮 | `src/client/views/MapDetail.js:112`、`src/client/views/TicketRow.js:39` | 与列表行共用同一个 `mkRowAction` |
| 检查页每行的修复动作按钮 | `src/client/views/ChecksTab.js:163-170`（在该步的 `s.actions` 里挑一个主按钮：优先 form/wizard，其次 inject-prompt/rpc） | `onClick` → `runAction`（`:128-134`）→ `chainDispatcher.dispatch(a)`（分发器在 `ChecksTab.js:48-105` 构造，实现是 `src/client/kernel/actions.js:36` 的 `createActionDispatcher`）；`inject-prompt` 分支在 `actions.js:45-73`，最后落到 `ChecksTab.js:52` 的 `inject(st, text)` |
| 页签行的「+ 新建需求」「+ 新增BUG单」 | `src/client/views/shared/Tabs.js:38`、`:42` | `onClick` 调 `openTextInNewSession(s, newWayfinderText(s), …)` |

一句话概括：面板里「按一下把一段文字送进会话」今天有两条现成写法——`inject(st, text)`（写进当前会话的输入框）与 `openTextInNewSession(st, text, title)`（开一个新会话并把这段文字带过去）。

## 二、按后端注入提示词的现有通路

### 2.1 提示词单源 `src/client/kernel/prompts.js`

- 条目形状：`"键名": { version: 数字, placeholders: ['占位符名', …], use: '一句话说明', zh: '中文全文', en: '英文全文' }`（`prompts.js:12-37`）。`placeholders` 与正文里的 `{名字}` 必须一一对应：正文里出现了没声明的占位符、或声明了正文没用的占位符，都会被判红（`tests/verify-prompts.js:865-870`）。
- 现有 21 条键（括号里是条目起始行）：`mapExecute`（13）、`complete`（14）、`fixate`（15）、`progress`（16）、`bodyFormat`（17）、`tpl.diagnose`（18）、`tpl.fix`（19）、`tpl.discuss`（20）、`tpl.research`（21）、`tpl.prototype`（22）、`tpl.execute`（23）、`tpl.handoff1`（24）、`tpl.handoff2`（25）、`installSkillsFix`（26）、`installSkills`（27）、`setupRun`（31）、`switchAlign`（32）、`newWayfinder`（33）、`newBugWayfinder`（34）、`ghAuthLogin`（35）、`mapInspect`（36）。条数被 `tests/verify-prompts.js:62` 钉死为 21，并逐条登记在 `tests/verify-prompts.js:75-84` 的受保护清单里。
- 取文本用的函数：
  - `promptText(id, params)`（`prompts.js:49-59`）：按当前界面语言从 `zh` / `en` 里挑一份，把 `{名字}` 换成 `params` 里的值；没给值的占位符原样保留；`{bodyFormat}` 缺值时自动补通用兜底版。
  - `promptTextFor(st, id, params)`（`prompts.js:321`）：先让 `backendParamsFor(st, params)`（`prompts.js:314-319`）按当前后端补上 `bodyFormat` 与 `subIssue`，再调 `promptText`。要「按当前后端注入不同的体检文案」，今天对应的就是这条路的形状。
  - 直接取某个后端声明的文本：`backendPromptFrom(modules, backendId, key)`（`prompts.js:266-276`）配 `declaredLangPick(dict, lang)`（`prompts.js:278-288`）。现成例子是 `bodyFormatText(st)`（`prompts.js:301-312`）：先从当前后端取，取不到才落注册表里的通用兜底版，并弹一条警告（`:292-299`）。
  - 用户可自定义的模板走 `renderTemplate(id, values, st)`（`src/client/kernel/config.js:87-97`），默认文本在 `TPL_DEFAULT`（`config.js:71-82`，逐条指向 `promptTextFor(st, 'tpl.xxx')`）。
  - 成品函数：`completePrompt(st, num, title, total, closed)`（`prompts.js:339-343`）、`inspectPrompt(st, num, title)`（`prompts.js:344-347`）、`newWayfinderPrompt`（`:322-326`）、`setupRunPrompt`（`:105-113`）、`bodyFormatText` / `BODY_FORMAT`（`:301-312` / `:332`）。

### 2.2 后端模块自己声明的键表

三个后端都在自己的 `index.js` 里导出两块声明：`prompts`（注入文案，键 → `{zh, en}`）与 `fixes`（检查失败后的修复动作，键 → `{hint: {zh, en}, actions: [...]}`）。逐条见第四节。

### 2.3 界面把提示词送出去的两种做法

1. 注入当前会话（写进输入框的草稿，不自动发送）：`inject(st, text)` 在 `src/client/kernel/api-io.js:31-37`——它调 `st.injector(text)`，再弹一条「已注入」提示；没有 injector 时退化成复制到剪贴板。`st.injector` 由状态栏挂载时绑成宿主给的 `inputActions.setDraft`（`src/client/statusbar/StatusBar.js:53-57` 与 `:58-71`）。所有行级动作按钮（`store-derived.js:274`）、检查页全部动作按钮（`ChecksTab.js:52`）、以及一批引导按钮（如 `src/client/views/NoRepoCard.js:235`、`src/client/kernel/slotRenderer-modal-view.js:170`、`src/client/kernel/store-switch.js:193`）最后都落到这一个函数。
2. 开一个新会话把文本带过去（成为新会话的首条 / 待注入草稿）：`openTextInNewSession(st, text, title)` 在 `src/client/kernel/api-new-session.js:92` 起，失败时回落成 `inject` 加一句提醒（`:95-98`）。新会话还没就绪时，文本先挂在 `pendingDraft` / `pendingDraftTargetSid`（`src/client/kernel/api-naming.js:39-40`），由状态栏在目标会话出现时消费掉（`src/client/statusbar/StatusBar.js:63-69`）。页签行的「+ 新建需求」「+ 新增BUG单」（`Tabs.js:38`、`:42`）与列表行的「新会话」按钮（`ListTabRow.js:85`）走的是这条。

补一句容易混的：`src/client/kernel/actions.js` 不是「怎么送文本」的第二种做法，它是动作分发器——把后端声明的动作（`inject-prompt` / `open-url` / `rpc` / `form` / `wizard` / `refresh`）翻译成界面上的具体执行（`actions.js:39-204`，`inject-prompt` 在 `:45-73`），最终仍然调调用方传进来的 `ctx.inject`。

## 三、游离票（没有父票的开放票）算不算得出来

结论先写：**算得出来，而且「有没有父票」这个字段就躺在快照的每一行上（字段名 `parentKey`），只是客户端今天没有任何一处读它。**

- `parentKey` 是契约里的核心字段，永远存在，值为字符串或 null：字段清单见 `src/host/tracker/capability.js:32-35`（「核心字段（永远存在）」那一组里有 `parentKey`）。三个后端的归一函数都会填它——GitHub `src/host/tracker/backends/github/normalize.js:260` 与 `:275`（值由 `deriveParentKey` 从 `parent{number}` 推出，见 `:99-102`）、GitLab `src/host/tracker/backends/gitlab/normalize.js:238` 与 `:260`、本地 Markdown `src/host/tracker/backends/markdown/normalize.js:20`（缺省补 null）。
- 数据来源：GitHub 的列表查询片段里带了 `parent{number}`（`src/host/tracker/backends/github/queries.js:28`，列表查询 `LIST_QUERY` 在 `:33-40`）；走 REST 降级时另有一处专门把父子边补回来（`src/host/tracker/backends/github/issues.js:228` 的 `repairParentLinksREST`，真仓用例见 `tests/verify-github-rest-fallback.js:87-94`，那里断言 414 与 8 两条票的 `parentKey` 是 `'7'`）。
- 只读实测（本次跑过，不写文件）：直接调用仓库里的归一函数，喂一条带 `parent:{number:682}` 的记录，输出 `parentKey="682"`；喂一条带 `wayfinder:map` 标签的记录，输出 `type="map"`、`parentKey=null`。
- 面板那一份快照的行集，**今天不来自** `src/host/issueList.js`，也不来自 `src/host/snapshotBuild.js`，而是来自注册表编排器：`src/host/sessionSnapshot.js:215` 起那一段（注释写明「GitHub 同样走编排器，不再直调 buildSnapshot 硬走 gh」）与 `:252-254`，落到 `src/host/tracker/snapshot.js:125-169` 的 `composeSnapshot`。行集由 `assembleSnapshot`（`src/host/tracker/snapshot.js:42-80`）拼出，拼法正是**用 `parentKey` 把票挂到地图下**：`:48-53` 按 `parentKey` 分组，`:75-78` 把没挂上任何地图的票收进 `issues`（注释里说明「破链票」指 `parentKey` 指向已删/不存在地图的票，根票 `parentKey=null` 也在这里）。
  - 旁证：`src/host/snapshotBuild.js:49` 那条直连 gh 的 `buildSnapshot` 在 `src/host` 内今天已没有调用点，只剩 `src/host/index.js:140` 的一个透传导出（`src/host/updatePkg/service.js:211` 里同名函数是插件更新功能，与面板无关）。
- 送到客户端之前还要再拼一次：`src/host/sessionSnapshot.js:289-291` 把「地图容器 + 地图下所有子票 + 未挂图的票」三段拼成一个扁平数组，并按票身份去重（去重实现 `src/shared/tracker/list-dedupe.js:40-54`）。这一段就是最终画在列表上的 `snapshot.issues`。因此列表里每一行都带着自己的 `parentKey`：`null` = 根票（没有父票）；是一个编号 = 认了父票（如果那张父票不在快照里，就是上面说的破链票，用例见 `tests/tracker-contract/sections/snapshot.js:21` 的 `parentKey: 'ghost-map'`）。
- **今天谁已经在用它**：宿主侧只有上面那个 `assembleSnapshot`（分组 + 决定谁进 `issues`）。客户端侧一处也没有：在整个 `src/client` 目录里搜 `parentKey`，只有两处提到——`src/client/kernel/probe-snapshot.js:126` 是一句注释，`src/client/kernel/prompts.js:232-233` 是一段提示词文本。客户端判断「这张票是不是某张地图的子票」用的是**另一条等价路径**——看它在不在某个 `maps[].tickets` 里：`src/client/kernel/store-derived.js:150-186` 的 `applyStandaloneBlocks`（`:155-162` 先建 `inMap` 表，`:165-172` 跳过已经是地图子票的行、地图行、已关闭行），以及 `src/client/kernel/store-derived.js:119-144` 的 `isOccupied`（`:122-138` 遍历各地图的子票）。
- 所以答案分两句：
  1. 「一张开放票有没有父票」这个事实算得出来——读快照行上的 `parentKey` 即可；不读它的话，用「在不在某张地图的 `tickets` 里」也能得到同一结论（今天客户端走的就是这条，代价是每行要在一张表里查一次）。
  2. 但「没有父票」还不等于「该体检的游离票」：今天列表用的口径是 `openIssuesOf(st)`（所有非 CLOSED 的行，其中**包含地图容器本身**，见 `src/client/kernel/store-derived.js:82`），而「游离票」按字面还要求「它不是一张地图」。今天客户端区分「是不是地图」用的是 `src/client/views/ListTab.js:121` 的 `isMapIssue(x)`（`type === 'map'`，或带 `wayfinder:map` 标签）。把「非 CLOSED + 不是地图 + 没有父票」三条件合成一个数，今天是**没有现成函数**的，要新写一小段派生（数据不用再取，快照里都有）。

## 四、三个后端今天各自声明了什么（供「体检科目按后端声明」参考）

### 4.1 GitHub（`src/host/tracker/backends/github/`）

- `prompts` 块共 6 个键（`index.js:123-165`，标签名单由 `CANONICAL_LABELS` 动态拼装）：`ensureLabels`（`:128`，补全核心标签的命令）、`ghAuthLogin`（`:132`，gh 登录指引）、`repoAccessFix`（`:140`，仓库不可达的三步排查）、`subIssue`（`:144`，建原生父子边与原生阻塞边）、`bodyFormat`（`:150`，写正文的格式要求）、`errorKinds`（`:154`，八类初始化错误的双语说明）。
- `fixes` 块共 4 个键（`index.js:37-121`）：`gh:installed`（`:40`）、`gh:authed`（`:53`）、`gh:remote`（`:63`）、`gh:repoAccess`（`:93`）。每项形状是 `{hint: {zh, en}, actions: [...]}`；动作类型实际用过三种：`inject-prompt`（文案直接写进动作，或写成 `prompts` 里的键名）、`wizard`（两步弹窗，提交动作是 `rpc` 调 `wf.initPublish`，见 `:70-91`）、`refresh`（`target: 'chain'`）。
- 检查项：`index.js:24` 转发 `GITHUB_CHECKS`，`index.js:204` 把它挂进模块对象；目录本体在 `src/host/tracker/backends/github/checks.js:15-48`，4 项——`gh:remote` / `gh:installed` / `gh:authed` / `gh:repoAccess`，每项形状 `{id, label, scope, backends, check, origin}`。
- `setupPrompt`（`index.js:183-188`）：`trackerLine` / `trackerChoice` / `backendNote` / `labelReqs` 四个键，值是**客户端词条键名**（形如 `setup.github.trackerLine`），文案本体在客户端词条文件里，不落后端。
- 另有：`presentation`（`:176-181`，品牌四色）、`openRepository: 'url'`（`:202`）、`links` / `describe` / `issueUrl` / `searchUrl` / `linkPattern` / `capabilities` / `create` / `matches`。**没有** `labelPalette`。

### 4.2 GitLab（`src/host/tracker/backends/gitlab/index.js`）

- `prompts` 块 5 个键（`:129-155`）：`glabInstallFix`（`:130`，按系统装 glab）、`glabLoginFix`（`:134`，glab 登录）、`glabRepoFix`（`:138`，仓库定位二选一）、`subIssue`（`:142`，泛指「用后端自己的命令行建原生子议题」）、`bodyFormat`（`:151`）。
- `fixes` 块 3 个键（`:158-189`）：`glab:installed`、`glab:authed`、`glab:repoAccess`，形状与 GitHub 相同（每项都只有 `inject-prompt` 与 `refresh` 两种动作）。
- 检查项**不在本文件声明**：目录住在共享文件 `src/shared/tracker/check-catalog-dirs.js:146`（`glab:installed`）、`:154`（`glab:authed`）、`:162`（`glab:repoAccess`）。
- `setupPrompt`（`:196-201`）、`presentation`（`:208-213`）、`links`（`:93-98`）、`openRepository: 'url'`（`:90`）、`linkPattern`（`:87`）。**没有** `labelPalette`、**没有** `checks` 字段。

### 4.3 本地 Markdown（`src/host/tracker/backends/markdown/index.js`）

- `prompts` 块 3 个键（`:171-188`）：`wayfinderMapBuild`（`:173`，正文就是一句 `/wayfinder (请输入任务需求)`）、`subIssue`（`:177`，改成在 map 文件的任务清单里逐条引用子票）、`bodyFormat`（`:184`，说清「这张单据就是本机的一个 Markdown 文件」）。
- `fixes` 块 1 个键（`:194-205`）：`md:parseOk`（地图还没生成时的修复动作：`inject-prompt` 打 `wayfinderMapBuild`，再 `refresh`）。按 `:190-193` 的定版，`md:scratchWritable` 不提供修复指引，所以这里没有它的键。
- 检查项同样在共享目录：`src/shared/tracker/check-catalog-dirs.js:176`（`md:scratchWritable`）与 `:184`（`md:parseOk`）。
- `labelPalette`：`index.js:152-164` 的内置默认色表（11 项：`bug`、`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`、`wayfinder:map`、`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task`），`:229` 挂进模块。这是三个后端里唯一声明调色盘的一个。
- `setupPrompt`（`:222-227`）、`presentation`（`:215-220`）、`links`（`:233`，只留 `linkPatternSource`）、`openRepository: 'folder'`（`:234`）。

### 4.4 键数被门禁钉死了

`tests/verify-prompts.js:65` 硬编码 `EXPECT_BACKEND_KEYS = { github: 6, gitlab: 5, markdown: 3 }`，`:68` 硬编码三块 `prompts` 里的字符串字面量条数 `{ github: 40, gitlab: 10, markdown: 6 }`。给任何一个后端的 `prompts` 块加键，这两处都要跟着改。

## 五、新增一颗「体检」按钮要动哪几处、会撞哪几道门禁

（下面是接线清单，不是设计决定。）

### 5.1 大概要动的地方

1. 按钮本体：`src/client/views/ListTab.js:230-236` 那一行，`:234` 的空占位右边加按钮；`onClick` 走 `inject(st, text)`（写进当前会话输入框）或 `openTextInNewSession(...)`（开新会话）。按钮文案必须走 `tr('…')`，不能在视图文件里写中文字面量（理由见 5.2 第二条）。
2. 文案词条：新键的中文与英文两份要加进 `src/client/kernel/locale-panel.js` / `locale-flow.js` / `locale-word.js` 之一（三枚 KPI 的键就住在 `locale-flow.js:31-33` 与 `:195-197`，挨着放最省事）。
3. 提示词单源：`src/client/kernel/prompts.js` 的 `PROMPTS` 里加一条（形状同 2.1：`version` / `placeholders` / `use` / `zh` / `en`）。要按后端不同，就用占位符加后端声明填空（现成例子：`mapInspect` 的 `{subIssue}`、10 条模板的 `{bodyFormat}`）。
4. 后端各自的声明（若体检文案按后端不同）：三个后端的 `prompts` 块各加一个键，客户端经 `backendPromptFrom` / `promptTextFor` 取；也可以像 `src/client/views/NoRepoCard.js:235-236` 那样，直接从 `moduleMetaOf(st, backendId).prompts` 里按当前语言挑一份。
5. 若按钮要新的宿主能力（例如让宿主先算出「游离票有几张」再决定按钮显不显示，或点一下要宿主先做点什么）：要在 `src/host/` 加一条电话，并同步改 `src/host/index.js` 的分发表与落点文件。这一档会连带碰 5.2 里整组日志门禁，以及 `tests/verify-596-rpc-carrier.js`（客户端请求路径必须等于宿主注册路径，否则通道等于没接上）。
6. 重跑构建：改完 `src/client/kernel/*.js` 或后端 `index.js` 后要跑 `node scripts/build.mjs`（`package.json` 的 `prepare` 也是它），产物 `client.js` 与 `package/lib/client.js` 都要更新；`tests/verify-prompts.js` 的第 S2 面就是拿这两份产物与真源逐字段比对。

### 5.2 会撞到的自动门禁

**一、提示词注册表门禁 `tests/verify-prompts.js`**（在 `npm run verify` 链上，见 `package.json` 的 `verify`）：

- 版本底线：`tests/verify-prompts.js:878-885` 的 `V_MIN` 逐条列了 14 条键的最低版本号——`mapExecute ≥ 9`、`complete ≥ 9`、`fixate ≥ 6`、`tpl.diagnose ≥ 10`、`tpl.fix ≥ 7`、`tpl.discuss ≥ 8`、`tpl.research ≥ 5`、`tpl.prototype ≥ 5`、`tpl.execute ≥ 9`、`mapInspect ≥ 6`、`newWayfinder ≥ 14`、`bodyFormat ≥ 7`、`setupRun ≥ 13`、`progress ≥ 3`。只许升不许降；此外还有散在下面的单条下限（如 `complete ≥ 5` 在 `:969`、`tpl.handoff1 / handoff2 ≥ 3` 在 `:985` 与 `:991`、`installSkills ≥ 2` 在 `:1022`、`fixate ≥ 2` 在 `:1004`）。新加的条目本身只要求 `version ≥ 1`（`:862`）。
- id 清单与条数：`:62` 的 `EXPECT_REGISTRY_ENTRIES = 21`、`:75-84` 的受保护清单 `PROTECTED`（21 条注册表键加 12 条后端键，逐条点名）、`:71` 的 `EXPECT_EXEMPT = 10`、`:98-104` 的逐面豁免集合，都是硬编码。加一条注册表条目，这几处都要改；漏一处就会在「受保护清单是否等于运行时算出来的集合」这条断言上判红（`auditExemptTable`，`:279-363`）。
- 后端声明面：`:65` 的键数、`:68` 的字面量条数（见 4.4）。
- 判定口径 R1–R8（`:169-232`）：新写的提示词文本里不许出现具体跟踪器命令（`gh` / `glab` 开头的命令），不许经包管理器转发，不许写裸 API 地址，不许把正文内联进命令行，不许用 heredoc，不许调包内脚本，不许写混淆执行，不许写「先解析插件安装目录、再调包内脚本」那一套。**唯一的开口是 GitHub 后端自己的声明面**：`:678` 的 `allowTrackerForKey` 只对 `github.*` 的值为真，`:741` 的 `allowTrackerOnBackend` 只对 `github` 为真。文案里带 `{占位符}` 的条目还会用「真实值 / 空串 / 哨兵」三种展开各判一遍，并用命令词探针试一次「占位符里塞命令词会不会拼出一条命令」（`:240-255`、`:708-732`）。
- 另有几条顺带会碰到的断言：占位符声明与正文一一对应（`:865-870`）、源码里 `promptText('id')` 引用的 id 必须存在（`:872-874`）、10 条模板必须保留 `{bodyFormat}` 标记（`:1072-1083`）、注册表里不许残留写回脚本名（`:1089-1094`）。
- 同链上还有 `tests/verify-prompt-newlines.js`（正文字面换行写法）与 `tests/verify-build-artifacts.js`（产物结构）。

**二、界面文案的中英词条门禁**（两道，都在 `npm run verify` 链上）：

- `tests/verify-t3-locale.js`：从产物里读词典，要求 zh 与 en 的键集合完全一致，并且**产物里出现的每一个 `tr('键')` 都必须在两份词典里存在**（`:26-40`）。
- `tests/verify-locale-completeness.js`：A 段要求每个词条键在五个 locale 源文件拼起来的内容里正好出现两次（zh 一次、en 一次，`:38-44`）；B 段要求一批关键键存在，并有一条反向断言「已删除的键不许复活」（`:47-72`）；C 段最容易踩——**逐文件把「字符串字面量里含汉字的个数」封顶**（`BASELINE` 表在 `:98-122`，判定在 `:146`），清单里没有的文件一律不许出现任何中文字符串。`src/client/views/ListTab.js` 与 `src/client/views/ListTabRow.js` 都不在这张清单里，所以新按钮的中文只能走词条，写死一个中文字面量就红。
- 另外还有 `tests/verify-issue529-checks-i18n.js`（检查页那批文案键中英成对）与 `tests/verify-client-hardcode-gate.js`，改到检查页才需要管。

**三、日志埋点门禁**（`tests/verify-log-*.js` 共 16 个，都在 `npm run verify` 链上；口径来源是 `docs/design/335-logging-contract.md` 与 `research/489-appendix.md`）：

| 门禁 | 它查什么 |
| --- | --- |
| `verify-log-fields.js` | 每个日志事件只许带白名单里的字段键（允许表从 `:20` 起）；出现工作区原始路径、仓库地址原文、令牌原文、模板正文、快照全文即红 |
| `verify-log-guards.js` | 高频路径上的调试级调用必须**同一行**先判「调试开关开没开」，关着时连字段对象都不组装 |
| `verify-log-truncate.js` | 标题留前 80 字、错误留前 120 字（详情 160 字）并标注已截断；**渲染目录（`views` / `panel` / `statusbar` / `floating`）里允许写日志的文件是一张点名白名单**（`:98-99`），名单外的文件里出现日志调用即红 |
| `verify-log-flush.js` | 错误与告警必须走直通刷盘，不许进批量合并等待；调用处不许等写盘完成 |
| `verify-log-scrub.js` | 自由文本掩码命中时只记「具名规则名」，不许记命中的原文 |
| `verify-log-count.js` | 事件条数与 `research/489-appendix.md` 的字面一致：常驻 31 条、按需 28 条、自监控 5 条、总数 64（`:3`、`:15`、`:19-24`）；增删事件必须同步改附录第 1 章的对照表。（本次跑过这一条，76 项断言全通过。） |
| `verify-log-channel.js` | 客户端批量转发每批最多 50 条、每 1000 毫秒、单包 128KB 或 100 条先到先截；失败丢弃并计数 |
| `verify-log-coverage.js` | 每一条非退役电话至少有一行日志；每个客户端调用点可追踪；**五类动因（跨进程或模块边界的调用、新增宿主电话、面板打开与刷新读数据展示的链路、新增内存或磁盘缓存、新增定时触发的活）没有日志点即红**（`:3-4`，电话清单在 `:31-42`） |
| `verify-log-store.js` / `verify-log-client.js` | host 与 client 两个日志底座的形状（关闭时零调用、串行写盘不丢行、开关持久化、文件不超 350 行等） |
| `verify-log-artifacts.js` | 埋点必须同时出现在开发产物与打包产物两份里，宿主事件在打包镜像里逐个点名（`:4-6`） |
| `verify-log-selfmon.js` | 编号 46～50 的五条自监控事件逐个点名、级别必须是错误与告警、字段在白名单内（`:3-4`） |
| `verify-log-statusbar.js` / `verify-log-switch-526.js` / `verify-log-switch-597.js` / `verify-log-exec-606.js` | 状态栏日志菜单四键的接线与文案、开关保存失败的三类提示、真实产物上点开关的五段断言、经 `ctx.exec` 起外部命令的计数与耗时（关着开关时零代价） |

三条与这颗按钮直接相关的硬事实：

- **`src/client/views/ListTab.js` 里今天不能写日志行**：它属于渲染目录，却不在 `tests/verify-log-truncate.js:99` 的点名白名单里；文件自己 `:53-66` 的注释也写明了这件事（原话是「本文件在渲染目录里但不在可写日志的点名名单里……所以这里只累加数字，不写日志」）。要在这一行记点什么，得先把文件名加进那份白名单，那是改门禁。
- 若这一次要新增一个日志事件：先按仓库纪律定它是常驻（P0）还是按需（P1），同步改 `research/489-appendix.md` 第 1 章的对照表与 `tests/verify-log-fields.js` 的允许表，并在 `tests/verify-log-count.js` 的两张清单里加上；`verify-log-artifacts.js` 还会要求两份产物都带上。现成参照是 `guide.inject`（常驻第 65 条，2026-09-20 新增，落点在 `src/client/statusbar/bannerChain.js:220`，只记两个短枚举 `step` 与 `outcome`）。
- 若这一次要新增一条宿主电话：`tests/verify-log-coverage.js`（电话必有行、调用点可追踪）与 `tests/verify-596-rpc-carrier.js`（客户端请求路径必须等于宿主注册路径）都要跟着改。

**四、其它顺带会碰到的**：`tests/verify-file-granularity.js`（单个文件不超过 350 行）、`tests/verify-generated-no-shadow.js`、`tests/verify-strict-module-syntax.js`、`tests/verify-kernel.js` / `tests/verify-leaves.js`（一源两物的拼接标记）、`tests/verify-no-same-layer-import.js`（同层文件不许互相引用）。这些是改文件时顺带会碰到的，不是专为这颗按钮设的。

## 六、没查到、或没有核对的地方

1. 没有连网取真机数据核对「面板快照的每一行到底带没带 `parentKey`」。第三节的结论来自源码逐处读过，加上本地调用归一函数验证（喂一条带 `parent:{number}` 的记录，输出 `parentKey` 是字符串），没有跑 `gh` 取一份真快照再对一遍。
2. 没有核对 GitLab 真机上到底有多少父子边能被解析出来（`src/host/tracker/backends/gitlab/normalize.js:196-223` 的 `deriveParentKey` 要先走 links 聚合，再回退正文里的 `Parent:` 行），所以「GitLab 后端能不能算出游离票」这一条我只写到「字段在、值可能为空」，没有实测。
3. 没有查「体检查完之后要不要写票、写在哪、由谁写」这类问题——这张票只查事实，不替人拍板。
4. `research/489-appendix.md` 里 1.4 与 1.5 两节的小标题仍写着「常驻 31 条」「按需 27 条」，与它第 1 章开头修订记录里的现行数字（常驻 31 条、按需 28 条、总数 64）不一致；`tests/verify-log-count.js` 今天仍然通过（我跑过，76 项断言全过），所以看起来门禁不比对小节标题。我只读到这处文字不同步，没有改任何文件。
