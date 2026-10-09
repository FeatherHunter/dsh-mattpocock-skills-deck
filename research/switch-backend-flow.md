# 切换后端（switch backend）全流程：只认一手来源的调查

> 范围：点“切换后端”确认之后，布局小卡何时开、决策器何时接管、确认或取消各注入哪几条、卡没开成走哪条兜底、三条模板占位符实传、同后端切同后端、布局答案存哪与怎么流进 `contextLayout`。
> 方法：只读源码、规格 ADR、测试断言、日志附录。不抄二手结论，不给改法建议。
> 行号以本分支当前工作区所见为准；节名同时给出，行号漂移时按节名找。

## 0. 会话状态里与切换相关的字段（先认字段，再谈流程）

- `s.selection.backendId`：会话当下选定的后端。切换确认时先乐观写入新后端（`src/client/kernel/store-switch.js:157`），失败时由 `doFail` 回退到 `prevSel`（`store-switch.js:160-164`）。
- `s.switchConfirm = { open, curBackendId, targetBackendId, option, confirming, ... }`：切换确认窗的状态。打开时记下切换前（`curBackendId`）与目标（`targetBackendId`）（`store-switch.js:86-98`）。
- `s.setupLayoutCardOpen`：布局小卡开没开。开卡由注入决策器置真（`src/client/kernel/prompts-setup.js:36`），关卡由 `closeStatusSetupPick` 置假（`src/client/statusbar/StatusBackend.js:65`）。
- `s.setupCardOwner`：这张卡是谁开的。切换那条路开卡时记 `'switch'`，黄条那条路删掉该标记（`prompts-setup.js:40`）。读法是 `cardOwnedBySwitch`（`StatusBackend.js:91`）。
- `s.setupLayout`：会话里的布局答案（`'single' | 'multi'`）。只由 `applyStatusSetupLayout` 写（`StatusBackend.js:44-49`）。
- `s.setupPickLayout`：卡开着时用户在卡上刚点的那一下（草稿）。渲染单选的 `onChange` 写它（`StatusBackend.js:56`）；确认或取消时清掉（`StatusBackend.js:167,84`）。
- `s.setupLayoutDraftBefore`：开卡那一刻的答案快照，给取消回退用。由 `snapshotSetupLayoutForCard` 写（`StatusBackend.js:70-72`），调用点只有决策器开卡分支一处（`prompts-setup.js:39`）。
- `s.switchCardFrom / s.switchCardTo / s.switchCardLayoutFrom`：切换那条路开卡前留下的“从哪切到哪、布局改之前是哪个”。三处一起写（`store-switch.js:218-220`）。
- `s.switchAlignDone`：后端对齐那条是否已给过。切换开卡前置假（`store-switch.js:221`），给过之后置真（`StatusBackend.js:144`）。
- `s.chainSnapshot.steps`：链快照步骤数组。是否初始化、仓库是否就绪都从它读（`StatusBackend.js:109,114-117`、`prompts.js:140-158`）。

## 1. 未初始化与已初始化两条路：各走哪段代码、谁先谁后

### 1.1 入口：切换确认成功之后先强制重取一次链，拿到证据再分流

- 位置：`src/client/kernel/store-switch.js:190-272`（`confirmSwitchConfirm` 的 `wf.bind` 成功回调内）。
- 绑定成功后先算三样东西（`store-switch.js:190-194`）：目标人话标签 `_label`、来源人话标签 `_fromLabel`、目标后端的引导清单 `_mine = guideStepsFor(targetId)`、读链快照函数 `_stepsNow = chainSteps(st)`、判链里有没有 `tracker:initialized` 这一步的 `_hasInitStep`。
- “只落一次”闸（`store-switch.js:199-209`）：`_hadToWait = !_hasInitStep(_stepsNow())`；`_route` 用 `_routed` 保证只执行一次。注释写明以前是当场一次、取链回来又一次，从 #698 起会重弹一张卡，所以补了只落一次。
- 分流动作挂在强制重取之后（`store-switch.js:260-272`）：先关窗（`closeSwitchConfirm`），再 `loadSnapshot + chainEventRefresh / loadChain`；链里已有 `tracker:initialized` 这一步（`!_hadToWait`）就当场 `_route()`，否则等这次重取回来的链再 `_route()`。
- 判据原文与 ADR 一致：判据是链上 `tracker:initialized`（检查项是工作区根有没有 `docs/agents/issue-tracker.md`），与状态栏横幅读同一份清单、同一条链快照；链里根本没有这一步时不许猜（`store-switch.js:185-189` 注释；ADR `docs/adr/20260921-tracker-choice-precedence.md:107-110` 第 5 节第 5 条、`docs/adr/20260921-tracker-choice-precedence.md:95-99` 攻击 10）。

### 1.2 已初始化那条路：先开布局小卡，答完才由 `settleSwitchCard` 收尾

- 位置：`store-switch.js:210-243`（`_route` 内 `_done('tracker:initialized')` 为真分支）。
- 顺序是“先记三字段，再调决策器，再看返回值”：
  1. 记 `st.switchCardFrom = sc.curBackendId`、`st.switchCardTo = targetId`、`st.switchCardLayoutFrom = readSetupLayout(st) || SETUP_LAYOUT_DEFAULT`、`st.switchAlignDone = false`（`store-switch.js:216-222`）。
  2. 调同一个决策器 `injectSetupDecision(st, targetId, { allowCard: true, askLayout: true, source: 'switch' })`（`store-switch.js:228`）。注释写明 `askLayout:true` 是维护者拍板每次都问（#674 的答过就不问到此为止），`source:'switch'` 让决策器把收尾记在 `setupCardOwner` 上；返回值只有一个名字 `'askLayout'`，黄条与切换开的是同一张卡（`store-switch.js:224-227`）。
  3. 返回值是 `'askLayout'` 就只提示 `switch.bindOkAskLayout` 并返回，等用户答卡（`store-switch.js:229-232`）。答完的收尾不在这里，在 `StatusBackend.js` 的 `settleSwitchCard`（见 1.4 与第 2 章）。
- ADR 口径：两档都先问（维护者 2026-09-22 拍板，与黄条同一套风格每次都问）；已初始化答完后除对齐后端外，若布局真改了再多一条 `switchLayout`（`docs/adr/20260921-tracker-choice-precedence.md:35` 第 3.4 条改口径段）。

### 1.3 未初始化那条路：同样先走同一个决策器，不自己判仓库那一步

- 位置：`store-switch.js:250-258`（`_route` 内未初始化分支）。
- 行为：调 `injectSetupDecision(st, targetId, { allowCard: true, askLayout: true, source: 'switch' })`（`store-switch.js:257`），仓库那一步过没过的判据在决策器里面（没过返回 `blocked`，一个字不注入也不开卡），本文件不再自己判一遍（`store-switch.js:250-253` 注释；ADR `docs/adr/20260921-tracker-choice-precedence.md:109`）。
- 提示条按返回值选（`store-switch.js:258`）：`blocked` 说 `switch.bindOkNotReady`（先按状态栏那条提示处理），`setup` 说 `switch.bindOkFresh`（按提示完成初始化），开卡（`askLayout`）说 `switch.bindOkAskLayout`（请先回答下面那一问）。答完同样交回 `settleSwitchCard` 收尾（`store-switch.js:254-255` 注释）。

### 1.4 布局小卡何时开、决策器何时接管（顺序表）

决策器是唯一入口（`src/client/kernel/prompts-setup.js:8-10` 头注释：四个出口都汇聚在它上面，谁都不要自己再判一遍）。

- 决策器内顺序（`prompts-setup.js:22-63`）：
  1. 先算 `guideBlocked = setupBlockedByGuide(st, backendId)`（`prompts-setup.js:23-24`）。
  2. “仓库那一步没过”先判：`!guideBlocked && opts.allowCard && layoutCardShouldOpen` 才开卡（`prompts-setup.js:35`）。注释写明这一步没过时连卡都不开，否则用户选完布局才发现什么都没注入（`prompts-setup.js:32-34`）。
  3. 开卡分支（`prompts-setup.js:35-47`）：置 `setupLayoutCardOpen = true`、记草稿 `snapshotSetupLayoutForCard`、按 `opts.source === 'switch'` 写或删 `setupCardOwner`、`emit`、记按需日志 `inject.decision { prompt:'setupRun', kind:'askLayout', layout:'unset' }`、返回 `'askLayout'`。开卡时一个字都不注入。
  4. 不开卡才走 `setupOrRepoPrompt(st, backendId)`（`prompts-setup.js:48-50`），再按 `kind` 注入或不注入（`prompts-setup.js:60-62`）。
- 开卡判据（`prompts-setup.js:17-21` `layoutCardShouldOpen`）：传了 `askLayout:true`（黄条那颗按钮与切换那条路）就问，布局答过也照旧问；没传（检查页那颗执行初始化按钮）只在还没答过时问。实现是 `!!(opts.askLayout===true) || !readSetupLayout(st)`。
- 黄条入口传参（`StatusBackend.js:184-187` `onStatusSetupInit`）：`injectSetupDecision(s,id,{allowCard:true, askLayout:true})`。头注释写明每次都先弹卡、卡上预选上次那一项（`StatusBackend.js:179-181`）。
- 切换入口传参：已初始化（`store-switch.js:228`）与未初始化（`store-switch.js:257`）都传 `{ allowCard:true, askLayout:true, source:'switch' }`。ADR 写明检查页红牌仍然不传它（`docs/adr/20260921-setup-layout-ask-and-remember.md:33` 第 3.3 条改口径段）。
- 卡答完谁收尾：`confirmStatusSetupPick` 先判 `ownerSwitch = cardOwnedBySwitch(s)`（`StatusBackend.js:163`）；是切换开的就 `settleSwitchCard(s,'confirm')` 并返回，不走黄条那条注入（`StatusBackend.js:171-175`）；不是切换开的才 `injectSetupDecision(s,id,{allowCard:true})`（`StatusBackend.js:175`）。取消那条同样分流：切换开的才 `settleSwitchCard(s,'cancel')`（`StatusBackend.js:88`）。

### 1.5 点确认那一刻重判一次（为什么不能用开卡时的旧结论）

- 位置：`StatusBackend.js:100-119`（`worktreeInitializedState`）与 `StatusBackend.js:124-136`（`settleSwitchCard` 的 fresh/unknown 分支）。
- `worktreeInitializedState` 返回三值（`StatusBackend.js:105-119`）：链快照里没有 `tracker:initialized` 这一步返回 `'unknown'`；有则按目标后端（`s.switchCardTo ?? s.selection.backendId ?? firstBackendIdOf(null)`，见 `StatusBackend.js:113`）的 `guideStepsFor` 取出那一步，再 `guideStepDone(step, steps)` 判 `'initialized' | 'fresh'`；取不到函数或步骤返回 `'unknown'`。注释写明 unknown 时一个字都不注入、只提示看状态栏，与 store-switch 同口径（`StatusBackend.js:105-107`）。
- 重判理由写在注释里（`StatusBackend.js:100-104`）：从点确认切换到答完布局之间，刚注入的对齐指令可能已把仓库初始化完；照开卡时的旧结论会把初始化全文注进已初始化过的仓库（#664 与 ADR 第 4 节攻击 10 要结束的事）。
- `settleSwitchCard` 先 `worktreeInitializedState(s)`（`StatusBackend.js:128`），再按 fresh / unknown / 已初始化三分（见第 2 章）。

## 2. 已初始化点确认或取消：各注入哪几条

总入口：`StatusBackend.js:124-158` `settleSwitchCard(s, phase)`。`phase='confirm' | 'cancel'`（`StatusBackend.js:120-123` 头注释）。

### 2.1 先算目标与人话标签（两条路共用）

- `fromLabel = label(s.switchCardFrom)`、`toLabel = label(s.switchCardTo)`，其中 `label = labelOf(id)`（`StatusBackend.js:125-126`）。`labelOf` 先查 `shared.backendModules` 的 `label`，没有才 `builtinLabelOf` 或原样返回（`store-switch.js:9-17`）。
- `target = s.switchCardTo ?? s.selection.backendId ?? firstBackendIdOf(null)`（`StatusBackend.js:127`）。目标后端优先取开卡前记下的 `switchCardTo`，没有才取会话当下那一个。

### 2.2 已初始化（`state==='initialized'`，注释写“确认与取消都一样”）

- 第一条“把后端对齐”必给，但只给一次（`StatusBackend.js:141-148`）：
  - 条件是 `s.switchAlignDone !== true`。满足才 `promptText('switchAlign',{from:fromLabel,to:toLabel})` 并 `inject`，随后置 `s.switchAlignDone = true`，并 `logSwitchSettle('align',s)`。
  - 头注释写明确认与取消都一样，这件事与布局那一问无关（`StatusBackend.js:141`）；取消注释写明用户取消的是改布局这一问，不是换后端对齐这件事，多问一句就扣下本来该给的东西是老毛病（`StatusBackend.js:86-88`）。
- 第二条“把布局也对齐”只在真改了才多给（`StatusBackend.js:149-156`）：
  - 条件是 `s.switchCardLayoutFrom && s.setupLayout && 两者不等`（`StatusBackend.js:151`）。
  - 满足才 `promptText('switchLayout',{from:layoutWordOf(switchCardLayoutFrom), to:layoutWordOf(setupLayout)})` 并 `inject`，记 `logSwitchSettle('align-layout',s)`，返回 `'align-layout'`（`StatusBackend.js:152-155`）。
  - 没改就只留上面那一条（`StatusBackend.js:149` 注释：没改别多发一段），返回 `'align'`（`StatusBackend.js:157`）。
- 人话布局词派生（`StatusBackend.js:92-99` `layoutWordOf`）：`'multi'` 取词条 `setup.layoutMulti`，其余取 `setup.layoutSingle`（经 `tr`）；取值不认识或词条查不到时落回单份那一句，宁可保守不留空占位符（`StatusBackend.js:93` 注释）。
- 确认与取消的区别只有这一条：确认走完上面两步；取消同样走上面两步中的第一条，但第二条在取消时通常走不到，因为取消已把答案退回开卡前那一份（见 2.4），`switchCardLayoutFrom !== setupLayout` 多半不成立。源码层面 `settleSwitchCard` 内不分 `phase` 处理已初始化分支（`StatusBackend.js:141-157` 无 `phase` 判断），区分只在 fresh/unknown 分支。

### 2.3 还没初始化（`state==='fresh'`）

- 取消（`phase!=='confirm'`）直接返回 `'none'`，一个字都不注入（`StatusBackend.js:129-130`）。头注释写明还没初始化时取消与今天一致，一个字都不注入（`StatusBackend.js:123`）。
- 确认走与黄条同一个决策器（`StatusBackend.js:131-135`）：`injectSetupDecision(s,target,{allowCard:false})`；返回 `'setup'` 记 `'setup'`，否则记 `'blocked'`。注释写明仓库那一步过没过这条判据住在决策器里面，没过它返回 blocked，那时一个字都不注入（`StatusBackend.js:131-132`）。注意这里传的是 `allowCard:false`，与切换开卡时传 `allowCard:true` 不同：收尾这一步不再开第二张卡。

### 2.4 链里没有那一步（`state==='unknown'`）

- 确认与取消都不注入，只提示 `switch.bindOkNotReady`（warn）并返回 `'blocked'`（`StatusBackend.js:137-140`）。与 store-switch 未初始化分支里链仍无此步的行为同口径（`store-switch.js:245-249`：一个字都不注入，只提示指向状态栏）。

### 2.5 去重：`switchAlignDone`

- 写三处：切换开卡前置假（`store-switch.js:221` `st.switchAlignDone = false`）；注入后置真（`StatusBackend.js:144`）；下次进入 `settleSwitchCard` 先判 `!==true` 才给（`StatusBackend.js:142`）。
- 含义：后端对齐这条在一次切换里只给一次；布局对齐那条不走这个开关，走“真改了才给”的独立条件（`StatusBackend.js:151`）。

### 2.6 取消时的回退（布局答案作废）

- `cancelStatusSetupPick` 先记 `wasSwitch = cardOwnedBySwitch(s)`（`StatusBackend.js:75`），再按 `setupLayoutDraftBefore` 回退：有草稿且取值合法就 `applyStatusSetupLayout(s,before)`（会话与按工作区记住的表一起退回），再删草稿（`StatusBackend.js:76-83`）；清 `setupPickLayout` 并关卡（`StatusBackend.js:84-85`）；是切换开的才 `settleSwitchCard(s,'cancel')`（`StatusBackend.js:88`）。
- 回退理由（`StatusBackend.js:66-69` 注释）：卡上单选一点下去就经 `applyStatusSetupLayout` 写进会话与按工作区记住的表（点一下就生效的老设计），取消不能只关界面，否则点过的那一下已经生效，与“取消”两个字不是一回事。
- 确认时删两份草稿：`setupPickLayout`（已落定，免得下次压着预选）与 `setupLayoutDraftBefore`（确认了就没有退回一说）（`StatusBackend.js:167-168`）。

## 3. 卡没开成兜底走哪

- 位置：`store-switch.js:233-243`（已初始化分支内 `_kind !== 'askLayout'` 的 fallback）。
- 条件：已初始化，但 `injectSetupDecision(..., { allowCard:true, askLayout:true, source:'switch' })` 没返回 `'askLayout'`（卡没开成）。注释举例“链里连工作区已初始化这一步都没有，这一档走不到这里”（`store-switch.js:233-234`），实际凡没开成都走这里。
- 行为：退回到原来那一条，直接 `promptText('switchAlign', { from:_fromLabel, to:_label })` 并 `inject`（`store-switch.js:235-237`），与 #669 第 6 件定的行为一致；记按需日志 `inject.decision { prompt:'switchAlign', kind:'align', layout:'unset' }`（`store-switch.js:240`，外层先判 `isEnabled('debug')`）；提示 `switch.bindOk`（旧数据已保留那句）（`store-switch.js:242`）。
- 日志附录口径：这一处是已有事件 #64 `inject.decision` 扩取值后的落点之一，仍在 `store-switch.js`（`research/489-appendix.md:122` 2026-09-21 增补说明；`research/489-appendix.md:259` 对照表 #64 行“另有一处落点仍在 store-switch.js（卡没开成时直接注入 switchAlign）”；`research/489-appendix.md:385` 2026-09-22 增补第⑤点）。
- 与 `settleSwitchCard` 的关系：兜底发生在开卡之前（决策器没开成卡），`settleSwitchCard` 发生在开卡之后（答完卡）。两者是前后两段，不是二选一的重判。ADR 落地清单把“卡没开成”单列为提示条第三句“已初始化且卡没开成：已切换到后端（旧数据已保留）”（`docs/adr/20260921-tracker-choice-precedence.md:111`）。

## 4. 三条模板各需哪些占位符、调用处实际传了哪些

### 4.1 注册表声明（`src/client/kernel/prompts.js:34,35,41`）

- `setupRun` v15：`placeholders: ['trackerLine','trackerChoice','backendNote','labelReqs','contextLayout']`（`prompts.js:34`）。正文含 `{trackerLine} {trackerChoice} {labelReqs} {contextLayout} {backendNote}`。
- `switchAlign` v4：`placeholders: ['trackerLine','trackerChoice','backendNote','labelReqs','contextLayout','from','to']`（`prompts.js:35`）。正文首句“本工作区已从 {from} 切换为 {to}。”，主体与 setupRun 一字一致（`prompts.js:35` use 字段：v4 经用户拍板回归为 V15 原文加首句，属有意回归）。
- `switchLayout` v4：`placeholders` 同上七个（`prompts.js:41`）。正文首句“本工作区布局已从「{from}」改为「{to}」。”，主体同样与 setupRun 一字一致（`prompts.js:41` use 字段）。
- 版本史记在 use 字段：setupRun v12 新增 `{contextLayout}`（#655）、v13 删末尾告诫（#664）、v15 删末尾工具节（#791）；switchAlign/switchLayout v3 撤末尾工具节（#792，只改文档不读写票）、v4 回归 V15 原文加首句（`prompts.js:34,35,41` use 字段；门禁 `tests/verify-prompts.js:946-951` 钉版本、`tests/verify-prompts.js:1163-1166` 钉三条都不带工具节）。

### 4.2 渲染函数契约（`prompts.js:68-78`）

- `promptText(id, params)`（`prompts.js:68-78`）：按当前语言取 `zh/en`；先补词表缺省 `cli/cliBrand`（`prompts.js:73-75`）；再 `s.replace(/\{(\w+)\}/g, ...)`，传了值的才替换，没传的原样留下 `{名字}`（`prompts.js:76`）。
- `setupRunParamsFrom(modules, backendId, dictOverride, layout)`（`prompts.js:102-116`）：前四个占位符按后端声明的 `setupPrompt` 键表查 locale 字典（找不到后端声明就用 `SETUP_DEFAULT_PROMPT_KEYS`，见 `prompts.js:106`）；`contextLayout` 单独一条来源，按 `SETUP_LAYOUT_TEXT_KEYS[normalizeSetupLayout(layout) || SETUP_LAYOUT_DEFAULT]` 取键再查字典（`prompts.js:113-114`）。
- `setupRunPrompt(st, backendId, layout)`（`prompts.js:121-130`）：后端 id 按显式传入优先，否则 `st.selection → st.snapshot.selection → getCachedSelection(cwd)`（`prompts.js:123-128`）；布局由调用处显式传入，不在这里自己读（`prompts.js:120` 注释）。
- `backendParamsFor / promptTextFor`（`prompts.js:265-278`）只填 `subIssue/subject/cli/cliBrand`，与 setup 三条模板的前四个占位符无关；切换两条路没走它们（见 4.3）。

### 4.3 调用处实际传了哪些（是否裸奔大括号）

- `setupRun` 正常路径：经 `setupOrRepoPrompt → setupRunPrompt(st, backendId, decLayout)`，其中 `decLayout = readSetupLayout(st) || SETUP_LAYOUT_DEFAULT`（`prompts.js:161-164`），再 `promptText('setupRun', setupRunParamsFrom(...))`（`prompts.js:129`）。五个占位符都给了值（四个查字典、一个按布局查字典），不裸奔。
- `switchAlign` 两处调用都只传 `{from,to}`：
  - 兜底：`promptText('switchAlign', { from:_fromLabel, to:_label })`（`store-switch.js:236`）。
  - 收尾：`promptText('switchAlign',{from:fromLabel,to:toLabel})`（`StatusBackend.js:143`）。
- `switchLayout` 一处调用只传 `{from,to}`：`promptText('switchLayout',{from:layoutWordOf(...),to:layoutWordOf(...)})`（`StatusBackend.js:153`）。
- 结论：切换两条的三个调用点都没走 `setupRunParamsFrom` 与 `backendParamsFor`，`trackerLine / trackerChoice / backendNote / labelReqs / contextLayout` 五个都没传值。按 `promptText` 第 76 行行为，它们以 `{名字}` 原样留在注入文本里（“裸奔大括号”）。只有 `from/to`（与词表缺省的 `cli/cliBrand`）被填上。这是源码字面行为；是否合预期不在本次调查范围内。
- 门禁只钉注册表声明与文本使用一致（`tests/verify-prompts.js:926-935`：文本含未声明占位符则红、声明了未使用则红），以及 `switchAlign` 在注册表里且点名 `/setup-matt-pocock-skills`（`tests/verify-669-choice-precedence.js:395-396`）。

### 4.4 目标后端与布局各从哪个状态字段来

- 目标后端人话标签：
  - 兜底：`_label = labelOf(targetId)`，`_fromLabel = labelOf(sc.curBackendId)`（`store-switch.js:190-191`）。`targetId = sc.targetBackendId`（`store-switch.js:151`），`sc.curBackendId` 是开窗时记的切换前（`store-switch.js:88`）。
  - 收尾：`target = s.switchCardTo ?? s.selection.backendId ?? firstBackendIdOf(null)`（`StatusBackend.js:127`）；人话标签同上经 `labelOf`（`StatusBackend.js:125-126`）。
- 布局“改之前”：`st.switchCardLayoutFrom = readSetupLayout(st) || SETUP_LAYOUT_DEFAULT`（`store-switch.js:220`；`readSetupLayout` 见 `prompts.js:98`）。测试钉“开卡前把这次改之前是哪个布局记下来”（`tests/verify-669-choice-precedence.js:279`）。
- 布局“改之后”：`s.setupLayout`（`StatusBackend.js:151,153`）。它由确认时的 `applyStatusSetupLayout(s, layoutSelectionOf(s))` 写入（`StatusBackend.js:164`）。
- 人话布局词：`layoutWordOf` 经 `tr('setup.layoutMulti' | 'setup.layoutSingle')`（`StatusBackend.js:94-99`）。词条文本在 `src/client/kernel/locale-pages.js:28-29`（中）与 `:103-104`（英）。

## 5. 同后端切同后端（GitHub→GitHub补漏）会发生什么

- `openSwitchConfirm(st, targetId)` 第一道闸（`store-switch.js:75-78`）：`cur = st.selection.backendId`；`cur == null` 返回 false；`targetId != null && cur === targetId` 返回 false。GitHub 切 GitHub 落第二条，直接返回 false，不开窗、不写 `switchConfirm`、不调 `loadSwitchCri`。
- 调用方还有第二道同值闸（`src/client/views/shared/BackendSelector.js:27-36` `handlePick`）：`selection.backendId !== targetId` 才调 `openSwitchConfirm`，否则调 `openSwitchConfirm` 的分支根本不进；`curBackendId !== targetId` 才进第二分支。两处都是“不同才弹窗”。
- 已选态点中当前项的结果：`openSwitchConfirm` 没开成（返回 false），`handlePick` 落到 `onPick(targetId)`（`BackendSelector.js:36`）。切换那套“记三字段、开卡、注入对齐”全不发生（它们都在 `confirmSwitchConfirm` 的 bind 成功回调里，而窗都没开）。
- 门控窗那边：同后端不是切换，是门控确认（`StatusBackend.js:193-208`），只定后端不注入任何文字（`StatusBackend.js:197-201` 注释），与切换互不相通。ADR 写明门控窗只在还没有后端时开，本次切换规则只挂面板弹窗那一条路（`docs/adr/20260921-tracker-choice-precedence.md:78-81` 附节）。
- 测试覆盖：同后端场景没有单列一组；C 组只量“已初始化 / 未初始化就绪 / 未初始化没就绪 / 切 Markdown / 链没到”五档的提示条与开卡（`tests/verify-669-choice-precedence.js:277-292`），C2 组量收尾四档（`tests/verify-669-choice-precedence.js:337-357`；`tests/verify-698-switch-asks-layout.js:176,223-254`）。

## 6. 选后端后布局答案存哪、怎么流进 prompt 的 `contextLayout`

### 6.1 存哪（会话 C 与宿主 H 各一份，另加按工作区本地缓存）

- 会话内：`applyStatusSetupLayout(s,v)` 写 `s.setupLayout = t`（`StatusBackend.js:47`），取值只认 `single|multi`（`StatusBackend.js:46`；`prompts.js:94-97` `normalizeSetupLayout` 同一套）。
- 本地按工作区：同函数内 `setCachedSetupLayout(s.cwd, t)`（`StatusBackend.js:48`）。键是 `dsws.setupLayoutByCwd`（`src/client/kernel/store-prefs.js:280`），值为 `{ layout, pickedAt }`（`store-prefs.js:312`），读只给取值、老版本裸字符串照旧认（`store-prefs.js:288-296`），写按时刻仲裁、老裸串当 0（`store-prefs.js:298-313`）。
- 宿主侧：确认时同时 `host.call('wf.setupLayout',{cwd, layout:layoutSelectionOf(s)})`（`StatusBackend.js:166`），失败不挡注入（`StatusBackend.js:165` 注释：宿主写不进去下次重选即可）。宿主 `wf.setupLayout` 注册在 `src/host/index.js:271`，实现在 `src/host/workspaceCwd.js:77-84`：没给 layout 就是读（新壳靠这一问知道上次选了哪个），给了就 `rememberLayout` 存并回 `{ layout, pickedAt }`。
- 三处同时写的定稿在 ADR（`docs/adr/20260921-setup-layout-ask-and-remember.md:23-31` 第 3.1-3.2 条）与 #683 注释（`StatusBackend.js:165`、`store-prefs.js:300-301`、`workspaceCwd.js:76`）。

### 6.2 读哪（两套读函数，来源同一批）

- 卡预选与取消回退用 `readStatusSetupLayout(s)`（`StatusBackend.js:28-32`）：会话 `s.setupLayout` 合法就用它，否则读 `getCachedSetupLayout(s.cwd)`，都没有返回 null。
- 注入用 `readSetupLayout(st)`（`prompts.js:98`）：`normalizeSetupLayout(st.setupLayout) || normalizeSetupLayout(getCachedSetupLayout(st.cwd))`，两份都过取值校验，不认识当没答过（同行尾注释；ADR `docs/adr/20260921-setup-layout-ask-and-remember.md:40` 落地第 1 条）。
- 卡上预选顺序（`StatusBackend.js:36-42` `layoutSelectionOf`）：卡开着时卡上刚点的 `setupPickLayout` 优先（否则另一個选项点不动，见 ADR `docs/adr/20260921-setup-layout-ask-and-remember.md:48-56` 4.1 节），否则会话答过的，其次工作区记住的，再次卡上上次碰过的，最后回 `single`（`StatusBackend.js:27`）。

### 6.3 怎么流进 `contextLayout`（只有 setupRun 那条流得通）

- 映射表：`SETUP_LAYOUT_TEXT_KEYS = { single:'setup.layout.single', multi:'setup.layout.multi' }`（`prompts.js:91`；注释写明与后端无关、单独一条来源，见 `prompts.js:89-90`）。
- 词条文本：中 `src/client/kernel/locale-pages.js:30-31`（single-context / multi-context 各一句，写进 `docs/agents/domain.md` 与 `AGENTS.md` 的写法），英 `:105-106`。卡上问题与选项是 `setup.layoutQuestion / setup.layoutSingle / setup.layoutMulti`（`:27-29` 中、`:102-104` 英）。
- 组装：`setupRunParamsFrom` 按 `SETUP_LAYOUT_TEXT_KEYS[normalizeSetupLayout(layout) || SETUP_LAYOUT_DEFAULT]` 取键，再查 locale 字典填 `out.contextLayout`（`prompts.js:113-114`）。`layout` 由调用处显式传入（`prompts.js:120` 注释：不在这里自己读）。
- 调用链（setupRun）：`setupOrRepoPrompt` 先 `decLayout = readSetupLayout(st) || SETUP_LAYOUT_DEFAULT`（`prompts.js:161`），再 `setupRunPrompt(st, backendId, decLayout)`（`prompts.js:163`），再 `promptText('setupRun', setupRunParamsFrom(..., layout))`（`prompts.js:129`）。没选过一律按缺省 single 填是兜底，正常路径先被决策器拦在卡上（`prompts.js:100-101` 注释）。
- 切换两条不流：`switchAlign` 与 `switchLayout` 的三处 `promptText` 调用只传 `{from,to}`（`store-switch.js:236`、`StatusBackend.js:143,153`），没传 `contextLayout`（也没传前四个后端占位符），按 `promptText` 行为原样留 `{contextLayout}`（见 4.3）。日志里这两条记 `layout:'unset'`（兜底，`store-switch.js:240`）或本次会话结论（收尾，`prompts-setup.js:76-80` `logSwitchSettle`），记的是判定用的布局，不是填进文本的 `contextLayout` 值。

## 7. 测试只断了什么（不抄结论，只列断言面）

- `tests/verify-669-choice-precedence.js`（头注释 9-18 行：断五组；E 是反证）：
  - A 组宿主判定链：带 `userPicked` 的选择压过锚文件，不带时锚照旧说话（相关行 `verify-669:46-110` 量真 `detectionService`）。
  - B 组客户端闸门：什么算用户选择（`userHintOf` 行）、标记留存（宿主回同一条则留、回不同则消失）、水合不合并带标记选择（`verify-669:111-193`）。
  - C 组切换分流：已初始化提示 `bindOkAskLayout` 且记 `layoutFrom`；未初始化就绪提示同一句；未初始化没就绪提示 `bindOkNotReady`（warn）；切 Markdown 因仓库步骤不在其清单而判没被挡；链没到时不注入不开卡不猜（`verify-669:194-294`，关键断言在 `:277,279,284,286,287,292`）。
  - C2 组收尾（真 `settleSwitchCard`）：没改布局确认只注一条 `switchAlign`；改了多一条；取消退回后只一条；链没到不注入（`verify-669:295-357`，如 `:340,357`）。
  - D 组弹窗与词条：清按钮没了、迁移清空置灰、GitLab 不可选名单、`switchAlign` 注册表 V4 七占位符且点名命令、全仓 `wf.detect/wf.chain` 带 `backendId` 必过 `userHintOf` 闸（`verify-669:377-409`，如 `:395-396,405-409`）。
  - E 反证：把实现做坏对应断言必须红（`verify-669:439-479`）。
- `tests/verify-698-switch-asks-layout.js`（头注释断七组）：
  - 卡位置与接线：界面在 `views/SetupCard.js`、按钮直调 `confirm/cancelStatusSetupPick`、黄条不再拼单选、座位按卡开着分派（`verify-698:60-65`）。
  - 判据单源：`layoutCardShouldOpen` 一份，全仓只有决策器与黄条两处引用它（`verify-698:74-90`，如 `:90` 黄条带 `askLayout:true`）。
  - 草稿：开卡留草稿、取消作废卡上那一下、草稿只有一处落点、两入口共用（`verify-698:96-99`）。
  - 分流与收尾：已初始化提示那句、模板在表里而取值在 statusbar、链无此步不注入、卡开着时 `openSwitchConfirm` 挡下并返回 false（`verify-698:176,221,254,306-309`）。
  - 反证三条：改回答过就不问则 C 组红、改掉重判则 E 组红、摘掉卡开着闸则 F 组红（`verify-698:320-357`）。
- `tests/verify-655-setup-layout.js`：
  - 真词表拼出中英 `contextLayout` 两句并断布局切换金样不同（`verify-655:70,189,215`：同后端两种布局产出两句不同的话）。
  - 占位符剥离后判残留（`verify-655:221,229`）。
  - 缺省键组回退（`verify-655:335`）。
  - 日志只记枚举且关开关不组装、初始化文案只经决策器、单选只一处渲染（`verify-655:337-365`）。
- `tests/verify-prompts.js`：
  - 注册表条目数、字段类型、占位符声明与文本使用双向一致（`verify-prompts:916,926-935`）。
  - 版本钉（`verify-prompts:946-951` setupRun 版本史；`verify-prompts:1506` switchAlign 新增条目数 20→21）。
  - 工具节两张表：三条（setupRun/switchAlign/switchLayout）都在不该带表（`verify-prompts:1163-1166`），表长度 15/8（`:1173-1174`）。
  - 渲染面：按真实调用形态渲染后不许残留 `{xxx}`、不许 undefined（`verify-prompts:668,1682-1685,1727`）；占位符给全才判（`verify-prompts:1663-1664`）。
- 日志附录第 1 章（`research/489-appendix.md`）：
  - #64 `inject.decision` 增补（`:117` #655 新增时字段 prompt/kind/layout 三枚举）、扩取值（`:122` #669 第 6 件加 `switchAlign/align/unset` 落点 store-switch）、再扩（`:259` 对照表：prompt 加 `switchSettle`、kind 加 `align/align-layout`、layout 记会话结论；落点 prompts-setup 的决策器与收尾，另有一处仍在 store-switch）、搬家说明（`:385` #698 落点搬去 prompts-setup、取值改名 `setup-card`→`askLayout`）。

## 8. 调用链一览（按时间先后）

1. 用户在后端选择器点目标（`BackendSelector.js:27-36`）：同值不进 `openSwitchConfirm`；不同才 `openSwitchConfirm(st, targetId)`。
2. `openSwitchConfirm`（`store-switch.js:75-102`）：`cur==null` 或同值返回 false；卡开着返回 false；否则写 `switchConfirm{cur,target}` 并 `loadSwitchCri`。
3. 用户在确认窗点确认 → `confirmSwitchConfirm`（`store-switch.js:143-277`）：写乐观 `selection{userPicked:true}`（`:156`）→ `wf.bind`（`:171`）→ 成功后关窗、重取快照与链（`:260-267`）→ 有证据当场 `_route()`，无证据等链回来（`:270-272`）。
4. `_route`（`store-switch.js:207-259`）：有 `tracker:initialized` 且 done → 记三字段（`:218-221`）→ `injectSetupDecision(..., {allowCard, askLayout, source:'switch'})`（`:228`）；无此步 → 提示后返回；未初始化 → 同一决策器（`:257`）。
5. 决策器（`prompts-setup.js:22-63`）：仓库步骤没过 → `blocked`；否则 `askLayout:true` 或没答过 → 开卡（置 `setupLayoutCardOpen`、记草稿、记 `setupCardOwner='switch'`）并返回 `'askLayout'`；否则经 `setupOrRepoPrompt` 注入或 `blocked`。
6. 用户答卡 → `confirmStatusSetupPick`（`StatusBackend.js:159-176`）或 `cancelStatusSetupPick`（`:74-89`）：确认写 `setupLayout`＋本地缓存＋宿主（`:164,166`），清草稿关卡；取消按草稿回退、清草稿关卡；是切换开的都交 `settleSwitchCard`。
7. `settleSwitchCard`（`StatusBackend.js:124-158`）：重判 `worktreeInitializedState`（`:107-119`）→ fresh 时确认走决策器（`allowCard:false`）/取消不注入；unknown 不注入；initialized 先 `switchAlign`（去重）再按真改加 `switchLayout`。
8. 卡没开成（决策器没返回 `askLayout`）→ 兜底直接 `switchAlign`（`store-switch.js:235-242`），不经过 `settleSwitchCard`。

---

### 一手来源索引（每条结论的落点）

- 开卡与决策：`src/client/kernel/prompts-setup.js:17-21`（判据）、`:22-63`（决策）、`:76-80`（收尾日志）。
- 收尾与卡：`src/client/statusbar/StatusBackend.js:26-49`（取值与记忆）、`:70-89`（草稿与取消）、`:91-99`（归属与人话词）、`:107-158`（重判与收尾）、`:159-187`（确认与黄条入口）。
- 切换：`src/client/kernel/store-switch.js:75-102`（开窗三闸）、`:143-277`（确认、分流、兜底）。
- 模板与渲染：`src/client/kernel/prompts.js:34,35,41`（三条声明）、`:68-78`（占位符契约）、`:91-98`（布局取值与读取）、`:102-130`（组装与入口）、`:145-180`（仓库判据与组装）。
- 布局存取：`src/client/kernel/store-prefs.js:280-313`（键、读写、仲裁）、`src/host/workspaceCwd.js:77-84`（宿主读写）、`src/host/index.js:271`（电话注册）、`src/client/kernel/locale-pages.js:27-32,102-107`（中英案）。
- 规格：`docs/adr/20260921-tracker-choice-precedence.md:29-36`（裁决）、`:95-116`（攻击 10、落地 5-7）、`docs/adr/20260921-setup-layout-ask-and-remember.md:23-40`（每次问、按工作区记、切换也问、取消回退）、`:48-56`（预选坑）。
- 测试与日志：`tests/verify-669-choice-precedence.js`、`tests/verify-698-switch-asks-layout.js`、`tests/verify-655-setup-layout.js`、`tests/verify-prompts.js`（断言面见第 7 章）；`research/489-appendix.md:117,122,259,385`（#64 三次增补）与第 1 章对照表。
