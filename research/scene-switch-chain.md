# 切换确认后的全链条（按时间顺序）

> 一手来源：`src/client/kernel/store-switch.js`（开窗／确认／绑定／分流／兜底）、`src/client/statusbar/StatusBackend.js`（收尾／重判／确认取消／布局变更）、`src/client/kernel/prompts-setup.js`（开卡判据／注入决策）。同值入口另引 `src/client/views/shared/BackendSelector.js`、`src/client/views/shared/SwitchConfirmModal.js`、`src/client/panel/Dock.js`、`src/client/views/SetupCard.js`、`src/client/kernel/slotRenderer-modal-view.js` 的原文行号。

## 0. 入口：两条路，同值各走各的分支

- 路 A「弹窗直开」：面板仓库名右侧切换按钮调用 `openSwitchConfirm(s, null)`（来源：`src/client/panel/Dock.js:229`）。`targetId` 为 `null` 时跳过同值拦截，直接进入「目标待选」态，弹窗内由单选器再选目标（来源：`src/client/kernel/store-switch.js:75-90`，`src/client/views/shared/SwitchConfirmModal.js:120-156`）。
- 路 B「列表点选」：后端选择器 `handlePick(targetId)` 先比对当前值（来源：`src/client/views/shared/BackendSelector.js:25-39`）：
  - 已有选择且 `selection.backendId !== targetId` → 调 `openSwitchConfirm(st, targetId)`，打开返回 `true` 则直接返回（弹确认窗）；
  - 否则（同值，或无选择）→ 不开窗，落到 `onPick(targetId)` 直连（无确认窗）。
- 同值直调守门（来源：`src/client/kernel/store-switch.js:76-78`）：当前后端为空返回 `false`；`targetId != null` 且与当前后端相等返回 `false`。`targetId == null` 不触发这一条，所以路 A 恒能开窗。
- 窗内选同值：弹窗内目标单选器 `onPick(id)` 首行即 `if (targetBackendId === id) return`（来源：`src/client/views/shared/SwitchConfirmModal.js:122-123`），点中已选目标无任何变化。

## 1. 开窗守门 `openSwitchConfirm`

来源：`src/client/kernel/store-switch.js:75-102`。

1. 当前后端为空 → 返回 `false`，不开窗（第 77 行）。
2. 目标已给且与当前相等 → 返回 `false`，不开窗（第 78 行）。
3. 两窗互斥：布局小卡开着（`st.setupLayoutCardOpen === true`）→ 弹 `switch.setupCardOpen` 警告并返回 `false`，不许再开切换窗（第 79-85 行）。注释写明两张都是「要用户回答一句话」的小窗，同时出现时答哪一张说不清；切换这条路永远是「先开窗、关了窗才轮到卡」。
4. 通过后写入 `st.switchConfirm = { open:true, curBackendId, targetBackendId（null 表待选）, prompt, option:null, clearInput:'', criChecks:null, criLoading:true, confirming:false }`，触发一次界面刷新，并开始拉切换校验链（第 86-101 行）。
5. 打开时三选一默认不选中（`option:null`），用户必须亲手选保留／迁移／清空之一；目标待选态下确认按钮另有阻断（第 91-92 行注释，弹窗侧见 `SwitchConfirmModal.js:36-37`）。

## 2. 窗内确认门槛（点确认前）

来源：`src/client/views/shared/SwitchConfirmModal.js:28-44` 与 `src/client/kernel/store-switch.js:143-150`。两处是同一套语义，各挡一道：

- 目标未选（`targetBackendId == null`，即 `isTargetPending`）→ 确认禁用／直接返回。
- 三选一未选（`option == null`）→ 确认禁用（弹窗侧；内核侧未单列此项，靠禁用态保证到不了内核）。
- 迁移项（`option === 'migrate'`）→ 校验链未加载完或未全过（`criLoading || !criChecks.allOk`）→ 禁用／返回。校验项是链快照里的 `gh:remote`、`gh:installed`、`gh:authed` 三步（来源：`store-switch.js:110-142`）。
- 清空项（`option === 'clear'`）→ 输入框不是「确认清空」四字 → 禁用／返回。
- 迁移／清空两项当前置灰不可点（来源：`SwitchConfirmModal.js:76-80,84-86`），今天真正可走的是保留项。

## 3. 确认：乐观写 `wf.bind` 与失败回退

来源：`src/client/kernel/store-switch.js:143-184,273-276`。

1. 置 `confirming=true` 并刷新界面（第 150 行）。
2. 乐观写：用 `userPickSelection(targetId, repoRef, prevSel)` 生成带 `userPicked:true` 的新选择，盖掉 `st.selection`，同步写按工作区记住的选择缓存（`setCachedSelection`），刷新界面（第 151-159 行）。注释说明只有带该标记的选择才会当提示上报给宿主，宿主侧带提示压过锚文件。
3. 跨边界打 `host.call('wf.bind', { cwd, backendId: targetId })`，前后各记一行调用日志（成功 `host.call`／失败 `host.call.fail`，种类 `switch-bind`，第 167-176 行）。
4. 成功判定兼容三种回包形状（`res.ok === true` 或 `res.value.ok === true` 或 `res.ok` 真值，第 172 行）。
5. 失败回退 `doFail`（第 160-165 行）：选择退回 `prevSel`、缓存同步退回、`confirming=false`、刷新界面、弹 `switch.bindFail` 警告（错误文本截断 120 字）。宿主不可用（第 166 行）与调用抛异常（第 273-276 行）走同一条回退。
6. 成功后收尾（第 178-184 行）：调 `adoptBoundRev` 落下宿主回的新修订号；若回包带 `persisted:false`，按绑定失败通道弹 `switch.bindNotPersisted` 警告（只提示，不回退选择）。

## 4. 关窗与强制重取链（证据先行）

来源：`src/client/kernel/store-switch.js:260-272`。

1. 先关确认窗（`closeSwitchConfirm`，第 260 行）。
2. 同步重取快照（`loadSnapshot(st, true, true)`），再走统一事件入口重取链（`chainEventRefresh(st, 'action-done')`，无此函数时退回 `loadChain(st, true, 'action-done')`，第 262-267 行）。
3. 「只落一次」守卫（第 195-209 行）：`_routed` 初始 `false`，`_route` 入口处若「需要等链且已分流过」直接返回，否则置 `_routed=true` 再分流。
4. 是否等待的判据在分流前一次算好（第 200 行）：`_hadToWait = !链上已有 tracker:initialized 步骤`。有证据当场分流（第 270 行）；无证据则挂在「这次强制重取回来的链」上（`_chainP.then(_route, _route)`，成功失败都分流，第 271-272 行）。

## 5. 分流 `_route`：三条路

来源：`src/client/kernel/store-switch.js:194-259`。判据用的链步骤 `tracker:initialized`（检查项是工作区根有无初始化标记文件），与状态栏横幅读同一份清单、同一条链快照（第 185-189 行注释）。

- 已初始化（`guideStepDone(tracker:initialized)` 为真，第 210 行）：见第 6 节。
- 未知（链里根本没有 `tracker:initialized` 这一步，还没取到链或取链失败，第 245-249 行）：一个字都不注入，只弹 `switch.bindOkNotReady` 警告，把下一步指向状态栏。
- 还没初始化（有这一步但未完成，第 250-258 行）：不自己再判，走与黄条按钮同一个决策器 `injectSetupDecision(st, targetId, { allowCard:true, askLayout:true, source:'switch' })`。按返回值选提示条：`blocked` → `switch.bindOkNotReady` 警告；`setup` → `switch.bindOkFresh`（按提示完成初始化）；`askLayout` → `switch.bindOkAskLayout`（先回答布局那一问）。

## 6. 布局小卡何时开（每次都问）

来源：`src/client/kernel/prompts-setup.js:17-47`，调用侧见 `store-switch.js:216-232,256-257`。

1. 开卡判据 `layoutCardShouldOpen`（第 17-21 行）：传了 `askLayout:true` 就问，布局答过也照旧问（卡上预选上次那一项）；没传时只在还没答过（`readSetupLayout` 为空）才问。
2. 切换两条分支（已初始化／还没初始化）都传 `askLayout:true` 与 `source:'switch'`（第 224、257 行注释：第 674 号的「答过就不问」到此为止，两边走同一份判据）。
3. 决策器顺序（第 22-47 行）：先判「仓库那一步过没过」（`setupBlockedByGuide`）。没过返回 `blocked`，连卡都不开（注释：第 32-34 行，此时弹卡会让用户选完布局才发现什么都没注入）。
4. 开卡动作：置 `setupLayoutCardOpen=true`，为取消路留布局草稿（`snapshotSetupLayoutForCard`），`source:'switch'` 则记 `setupCardOwner='switch'`（否则删掉该标记），刷新界面，记一行按需日志，返回唯一的卡名 `'askLayout'`（第 35-47 行）。黄条路与切换路开的是同一张卡，不按开卡方分两个名字；「答完归谁办」记在 `setupCardOwner` 上。
5. 已初始化分支开卡前的准备（`store-switch.js:216-222`）：记 `switchCardFrom / switchCardTo / switchCardLayoutFrom`（当前布局读 `readSetupLayout`，取不到落默认），并置 `switchAlignDone=false`。
6. 两窗互斥的另一侧：卡渲染座位上卡开着就先画卡（来源：`src/client/kernel/slotRenderer-modal-view.js:14-18`，位置上的最后一道兜底）；卡文件头注明与切换窗「同一时刻只会出现一张」，切换路永远先开窗、关窗才轮到卡（来源：`src/client/views/SetupCard.js:14-16`）。

## 7. 卡答完收尾 `settleSwitchCard`：确认与取消各注哪几条

来源：`src/client/statusbar/StatusBackend.js:107-158`（重判）、`159-176`（确认入口）、`74-89`（取消入口）。

1. 点确认那一刻先重判一次工作区状态 `worktreeInitializedState`（第 100-119 行），不用开卡时的旧结论。原因是开卡到点确认之间，刚注入的对齐指令可能已把仓库初始化完；照旧结论会把初始化全文注进已初始化的仓库。返回 `initialized`／`fresh`／`unknown`；链快照里没有该步骤、或缺少判据函数时一律 `unknown`。
2. 确认入口 `confirmStatusSetupPick`（第 159-176 行）：先把卡上当前选项同时写会话与按工作区记住的表（并顺手上报宿主 `wf.setupLayout`，失败不挡注入），清掉卡上草稿与取消用草稿，关卡；若卡是切换路开的（`setupCardOwner === 'switch'`）交 `settleSwitchCard(s,'confirm')` 收尾，否则走黄条老路 `injectSetupDecision` 注初始化全文。
3. 取消入口 `cancelStatusSetupPick`（第 74-89 行）：先按开卡草稿把点过的布局回退（草稿存在才回退），清卡上草稿，关卡；若是切换路开的，照旧调 `settleSwitchCard(s,'cancel')`。
4. 收尾分三个状态（第 124-158 行）：
   - `fresh`（还没初始化）：取消（`phase !== 'confirm'`）→ 返回 `'none'`，一个字都不注入；确认 → 走与黄条同一个决策器 `injectSetupDecision(s, target, { allowCard:false })`，返回 `'setup'`（注了初始化全文）或 `'blocked'`（仓库步没过，一个字不注入）。
   - `unknown`（确认、取消不分）：弹 `switch.bindOkNotReady` 警告，返回 `'blocked'`，一个字都不注入。
   - `initialized`（确认、取消不分两步走同一段）：先看去重旗 `switchAlignDone !== true`，未给过则注入「把后端对齐」一条（模板 `switchAlign`，从旧后端名到新后端名），置旗为真，记一行收尾日志；再看布局是否真改了（`switchCardLayoutFrom !== setupLayout`），改了才多注「把布局对齐」一条（模板 `switchLayout`，起止用人话词条），返回 `'align-layout'`，否则返回 `'align'`。
5. 去重 `switchAlignDone`：切换分流置 `false`（`store-switch.js:221`），收尾注后端对齐后置 `true`（`StatusBackend.js:142-144`），注前检查 `!== true`。第二次收尾不再重注后端对齐。
6. 取消路布局对齐恒不触发的原因：取消先把布局回退到开卡前那一份，收尾时的「是否真改了」比较恒为假；确认路只有布局真改了才多那一条，没改就只有后端对齐一条。

## 8. 卡没开成兜底（已初始化分支）

来源：`src/client/kernel/store-switch.js:233-243`。

- 已初始化分支调决策器返回不是 `'askLayout'`（例如卡因仓库步拦截没开）→ 退回原来那一条：直接注入「把后端对齐」（`switchAlign`），记一行按需日志（三个枚举，不记文案与路径），弹 `switch.bindOk`（旧数据已保留）。
- 返回是 `'askLayout'` → 弹 `switch.bindOkAskLayout` 并直接返回，等用户答卡；注入留给收尾。

## 9. 同后端点同值两条路径的区别（小结）

- 弹窗直开（仓库名右侧按钮，目标待选）：`targetId` 传 `null`，跳过 `cur === target` 拦截，窗恒开；目标在窗内单选器里选，窗内重判只认「目标未选／选项未选／迁移校验／清空口令」，不拦「目标等于当前」。
- 窗内／列表选同值：选择器侧同值直接走 `onPick`（无确认窗）；即使调到开窗函数，同值也因 `targetId != null && cur === targetId` 返回 `false` 开不成；窗内已选目标再点一次同值直接返回无变化。
