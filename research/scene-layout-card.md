# 布局小卡与 context 结论的全链条

> 只认一手来源，不给改法建议。下面每一步后面都注明了出处文件与行号，行号是 2026-10-09 当天读到的样子。
> 任务里写的“store-prefs.js、host/workspaceCwd.js、locale-panel.js”三处，在仓库里的实际位置分别是 `src/client/kernel/store-prefs.js`、`src/host/workspaceCwd.js`、`src/client/kernel/locale-panel.js`。另外卡面上的布局四句话现在住在 `src/client/kernel/locale-pages.js`，`locale-panel.js` 里只剩一句搬家注记（下面第 8 节照录）。

## 0. 先认卡：这是哪一张卡

- 这张卡问的是“域文档布局”这一问，不是问后端。卡上只有一个单选组（两个选项）加确认、取消两个按钮。（来源：`src/client/statusbar/StatusBackend.js:159-162` 说“这张卡只有域文档布局这一问”；界面结构见 `src/client/views/SetupCard.js:32-48`。）
- 卡的界面住在 `src/client/views/SetupCard.js`，座位在弹窗座位那一层。座位先画卡，卡开着就画卡。（来源：`src/client/kernel/slotRenderer-modal-view.js:14-18`；卡的来历与“黄条下面画不出来所以搬家”见 `src/client/views/SetupCard.js:1-20`。）
- 卡只在会话状态里 `setupLayoutCardOpen === true` 时才画出来，否则返回空。（来源：`src/client/views/SetupCard.js:27`；座位层的同一判断见 `slotRenderer-modal-view.js:18`。）
- 卡开着时不许再开“切换后端”那张窗，反过来切换那条路永远是先开窗、关了窗才轮到卡。位置上只有一个，两张同时置真时按建仓弹窗优先。（来源：`src/client/views/SetupCard.js:14-16`；守门见 `src/client/kernel/store-switch.js:82`。）

## 1. 开卡：黄条路与切换路共用同一张卡，收尾用 source 区分

开卡的决定只有一份，住在 `src/client/kernel/prompts-setup.js:22-47` 的 `injectSetupDecision`。注释里写明它是整个注入路径的唯一入口（来源：`prompts-setup.js:8-10`）。

开卡要同时满足三件事（来源：`prompts-setup.js:32-36`）：

1. 仓库那一步过了（`setupBlockedByGuide` 返回 false）。没过时返回 `blocked`，连卡都不开。注释说这是为了不让用户选完布局才发现什么都没注入（来源：`prompts-setup.js:32-35`，判据实现见 `src/client/kernel/prompts.js:145-159`）。
2. 调用处传了 `allowCard:true`。
3. `layoutCardShouldOpen` 返回真（来源：`prompts-setup.js:17-21`）：
   - 传了 `askLayout:true` 就问，布局答过也照旧问；
   - 没传时，只在还没答过（`readSetupLayout` 为空）时问。

开卡时只做四件事（来源：`prompts-setup.js:35-46`）：

- 把 `st.setupLayoutCardOpen` 置 true；
- 调用 `snapshotSetupLayoutForCard` 留一份草稿（见第 3 节）；
- 按 `opts.source` 写收尾归属：`source === 'switch'` 就记 `st.setupCardOwner = 'switch'`，否则删掉这个字段（来源：`prompts-setup.js:40`）；
- 返回唯一的开卡名字 `'askLayout'`。注释强调黄条路与切换路开的是同一张卡，所以不按谁开的分两个名字，“答完由谁收尾”记在 `opts.source` 与 `setupCardOwner` 上（来源：`prompts-setup.js:25-31`）。

三条调用路的传参对照：

| 哪条路 | 调用怎么写 | 出处 |
|---|---|---|
| 黄条“初始化”按钮 | `injectSetupDecision(s, id, { allowCard: true, askLayout: true })`，包在 `onStatusSetupInit` 里；横幅那条链只转调它 | `StatusBackend.js:184-187`；转调见 `src/client/statusbar/bannerChain.js:128-133` |
| 切换后端那条路（已初始化与未初始化两档都一样） | `injectSetupDecision(st, targetId, { allowCard: true, askLayout: true, source: 'switch' })`，注释写“每次都问” | `src/client/kernel/store-switch.js:224-228` 与 `store-switch.js:254-257` |
| 检查页红牌“执行初始化”按钮 | `injectSetupDecision(st, undefined, { injectNow: false, allowCard: true })`，包在 `setupRunTextForClick` 里；没有 `askLayout`，所以只在没答过时开卡，答过就直接给全文；返回的不是 `'setup'` 就回 null，一个字都不注入 | `src/client/kernel/prompts.js:185-194`；检查页只转调它见 `src/client/views/ChecksTab.js:36-44` |

切换路开卡前的准备（来源：`store-switch.js:216-222`）：记下从哪个后端切到哪个后端（`switchCardFrom`、`switchCardTo`）、记下开卡那一刻的布局答案（`switchCardLayoutFrom`，读不到就按缺省 `single`）、把 `switchAlignDone` 置 false。开卡成功后弹一句“问布局”的提示就等用户答卡（来源：`store-switch.js:229-231`）；卡没开成时退回直接注入“把后端对齐”那一条（来源：`store-switch.js:233-243`）。

## 2. 点选：卡上预选看谁，点一下写哪里

两个取值的名字叫 `single` 与 `multi`，缺省是 `single`（来源：`StatusBackend.js:26-27`；内核侧同一套见 `prompts.js:91-92` 的 `SETUP_LAYOUT_TEXT_KEYS` 与 `SETUP_LAYOUT_DEFAULT`）。

卡上默认选中哪一项，由 `layoutSelectionOf` 定（来源：`StatusBackend.js:33-42`）：

- 卡开着时，以用户在卡上刚点的那一下（`setupPickLayout`）为准；注释说顺序反了会导致“另一个选项点不动”（真机 2026-09-25 上报）。
- 卡没开时，按“会话里答过的（`setupLayout`）大于这个工作区记住的（本地缓存）大于卡上上次碰过的（`setupPickLayout`残留）”，都没有才回第一项。

点一下单选只写 `s.setupPickLayout = v` 再刷界面，不在这一步写会话答案与本地记住的表（来源：`StatusBackend.js:51-57`，其中点选写值在第 56 行）。读“这个仓库布局选没选过”用的是 `readStatusSetupLayout`（先看会话 `setupLayout`，再看本地按工作区记住的那份，来源：`StatusBackend.js:28-32`）。

真正把布局记进会话状态并按工作区记住的函数是 `applyStatusSetupLayout`（来源：`StatusBackend.js:43-49`）：只在确认那一刻（第 4 节）与取消回退那一刻（第 5 节）被调用；注释写“注入决策函数就是从这里读选没选过，所以只在这里写”。取值不在两个名字里就直接返回，什么都不写。

## 3. 开卡快照：setupLayoutDraftBefore 是取消键留的

开卡那一刻，`snapshotSetupLayoutForCard` 把“现在这个答案是哪个”（`readStatusSetupLayout` 的返回值）记进 `s.setupLayoutDraftBefore`（来源：`StatusBackend.js:66-72`，写入在第 71 行；调用点在 `prompts-setup.js:37-39`，注释写两处开卡都走这一个分支所以不会漏记）。

注释里对这份草稿的说法是：卡上两单选一点下去就把答案写进会话与按工作区记住的表，所以取消不能只是关界面，要退回开卡前那一份（来源：`StatusBackend.js:66-69`）。以当天读到的 `layoutRadios` 实现为准，点选实际只写 `setupPickLayout`（见第 2 节引的第 56 行），这份草稿是取消那条路的回退依据，确认那条路会把它删掉（见第 4 节）。

## 4. 确认：写会话，加按工作区记住，加宿主那一份，然后按归属收尾

确认函数是 `confirmStatusSetupPick`（来源：`StatusBackend.js:159-176`），按顺序做这几件事：

1. 先认归属：`cardOwnedBySwitch` 就是看 `s.setupCardOwner === 'switch'`（来源：`StatusBackend.js:91`）。
2. 把卡上当时显示的那一项落定：`applyStatusSetupLayout(s, layoutSelectionOf(s))`，即写会话 `s.setupLayout` 并经 `setCachedSetupLayout` 写本地按工作区记住的表（来源：`StatusBackend.js:164`，函数本体见第 2 节引的 44-49 行）。
3. 同时写宿主侧那一份记忆：`host.call('wf.setupLayout', { cwd, layout })`，写不进去也不挡注入（来源：`StatusBackend.js:165-166`；宿主侧的读写实现见第 6 节）。
4. 清掉两份草稿：`setupPickLayout`（卡上那一下已落定）与 `setupLayoutDraftBefore`（确认了就没有退回这回事），注释都在行尾（来源：`StatusBackend.js:167-168`）。
5. 关卡（来源：`StatusBackend.js:170` 经 `closeStatusSetupPick`，本体见第 65 行）。
6. 按归属收尾（来源：`StatusBackend.js:171-175`）：
   - 切换路（`ownerSwitch` 为真）：交回 `settleSwitchCard(s, 'confirm')`，它会先重判场景再决定注什么（见第 7 节），确认函数到此返回；
   - 黄条路与检查页路：走 `injectSetupDecision(s, id, { allowCard: true })` 把初始化全文注进去。

## 5. 取消：退回开卡前那一份；切换路上仍给后端对齐

取消函数是 `cancelStatusSetupPick`（来源：`StatusBackend.js:74-89`），按顺序做这几件事：

1. 先记下这次是不是切换路开的卡（来源：第 75 行）。
2. 有草稿就回退：读 `setupLayoutDraftBefore`，取值认识才经 `applyStatusSetupLayout` 写回去，然后删掉草稿字段（来源：第 76-82 行）。注释写“卡上刚点的那一下作废，把答案退回开卡前那一份”（来源：第 73 行）。
3. 删掉 `setupPickLayout`，关卡（来源：第 84-85 行）。
4. 如果是切换路，再走一次 `settleSwitchCard(s, 'cancel')`：注释写用户取消的是“改布局”这一问，不是“换了后端、把记录对齐过去”这件事，所以后端对齐照旧给（来源：第 86-88 行；`settleSwitchCard` 取消分支见第 7 节）。

卡上三处“取消”是同一件事：右上角叉、底部取消按钮、点卡外面那一层，都走 `cancelStatusSetupPick`（来源：`SetupCard.js:30-31`、第 45 行、第 50 行）。

## 6. 落盘：会话一份，本地按工作区一份，宿主一份

三份记忆的分工（都按工作区键存，键的算法是归一后的工作区根；“根后来才认出来”时有搬键逻辑）：

- 会话：`s.setupLayout`（来源：`StatusBackend.js:47`）。
- 本地（浏览器本地存储加内存）：键名 `dsws.setupLayoutByCwd`，表 `setupLayoutByCwd`（来源：`src/client/kernel/store-prefs.js:280-281`）。启动时从磁盘读回内存（来源：282-287 行）；读只给取值，老版本存的裸字符串照旧认（来源：`getCachedSetupLayout` 在 288-297 行，形状说明在 292-294 行）；写同时记时刻 `pickedAt`，卡上点的那一下传裸字符串（时刻记现在），宿主回填传带时刻的形状，按时刻仲裁新的覆盖旧的（来源：`setCachedSetupLayout` 在 298-315 行，仲裁在 310-312 行）。别的工作区、别的窗口改了表时经 storage 事件合并回内存，磁盘那份为准（来源：186-203 行）。工作区根后来才认出来时把老键记录搬到新键，目标键已有记录就不覆盖（来源：`migrateCachedChoiceToKey` 在 320-328 行）。
- 宿主（跨重启跨地址的那份）：电话名 `wf.setupLayout`（来源：`src/host/workspaceCwd.js:249` 的装配行；确认侧的调用见第 4 节引的 `StatusBackend.js:166`）。不带 `layout` 就是读，带了就是写（来源：`workspaceCwd.js:76-84`，读走 `getLayout` 在第 81 行，写走 `rememberLayout` 在第 82 行）。宿主存在 `choiceStore` 的 `layouts` 表里，形状是 `{ layout, pickedAt }`，只认两个取值（来源：`src/host/choiceStore.js:264-273` 的读与 311-330 行的写，其中取值检查在 315 行）。每条快照回包都顺带把记住的布局答案带回去，落后的窗口靠它跟上（来源：`src/host/sessionSnapshot.js:34-35` 的读取与第 54 行的携带，短路分支的新旧比较在 66-68 行）。

内核侧读“这次选的布局”用的是 `readSetupLayout`：先看会话 `setupLayout`，再看本地按工作区记住的那份，两份都过取值校验（来源：`src/client/kernel/prompts.js:93-98`，其中 `normalizeSetupLayout` 在 94-97 行）。

## 7. 重判场景：点确认那一刻重新判，不用开卡时的旧结论

为什么重判（来源：`StatusBackend.js:100-106` 的注释）：切换这条路上，从点确认切换到用户答完布局之间，刚注入的对齐指令可能已经把仓库初始化完了。开卡时判的是还没初始化，点确认时现实可能已是已初始化，照旧结论会把初始化全文注进已初始化过的仓库。

重判函数是 `worktreeInitializedState`（来源：`StatusBackend.js:107-119`），返回值只有三种：

- `'initialized'`：链快照里有“工作区已初始化”这一步，且按当前后端的清单看它已做完；
- `'fresh'`：有这一步，但还没做完；
- `'unknown'`：链快照里根本没有这一步（还没取到链或取链失败）。

判据细节：有无这一步看 `chainSteps` 或 `chainSnapshot.steps` 里有没有 `tracker:initialized`；做没做完问清单函数 `guideStepsFor` 与 `guideStepDone`（来源：108-118 行）。

收尾函数是 `settleSwitchCard(s, phase)`（来源：`StatusBackend.js:120-158`），`phase` 是 `'confirm'` 或 `'cancel'`：

- 重判为还没初始化（`fresh`）：取消就不注入（返回 `'none'`）；确认走与黄条同一份决策器 `injectSetupDecision(s, target, { allowCard: false })`，返回 `'setup'` 或 `'blocked'`（来源：129-136 行）。
- 重判为链里没这一步（`unknown`）：一个字都不注入，只弹一句去看状态栏，返回 `'blocked'`（来源：137-140 行）。
- 重判为已初始化：确认与取消都先给“把后端对齐”那条（只给一次，用 `switchAlignDone` 守），再看布局是否真被改了（`switchCardLayoutFrom !== setupLayout`），改了才多给一条“把布局那一句也对齐过去”（来源：141-157 行；两条模板的占位见第 8 节）。

切换那条路上“刚刚给出去的是哪一类”记一行按需日志（`setup`、`align`、`align-layout`、`askLayout`、`blocked`），记在内核的 `logSwitchSettle` 而不记在状态栏目录（来源：`src/client/kernel/prompts-setup.js:64-80`；调用点在 `StatusBackend.js:147` 与 154 行）。

## 8. 流入模板：contextLayout 经键表进 prompt，单多两句人话的原文

占位符 `{contextLayout}` 是初始化全文模板 `setupRun` 的五个占位符之一（来源：`prompts.js:34` 的占位符表；注释在 32-33 行说它“取值来自用户选择，与后端无关，所以不放进后端键表”）。切换用的两条模板 `switchAlign` 与 `switchLayout` 也带它（来源：`prompts.js:35` 与 41 行的占位符表；两条的用途见各自的 `use` 说明）。

取值到人话的键表是 `SETUP_LAYOUT_TEXT_KEYS = { single: 'setup.layout.single', multi: 'setup.layout.multi' }`，缺省取 `single`（来源：`prompts.js:89-92`）。填空函数是 `setupRunParamsFrom`：按归一化后的布局取值选键，再到词表里取对应句子填进 `out.contextLayout`（来源：`prompts.js:102-116`，其中选键在 113 行、填空在 114 行）。拼全文的入口是 `setupRunPrompt(st, backendId, layout)`（来源：121-130 行）；注入决策在没拿到现成结论时也按“已读布局或缺省”拼一份兜底（来源：`prompts-setup.js:48-52` 与 `prompts.js:160-164`）。

切换时“从哪项改到哪项”的人话由 `layoutWordOf` 取卡面上的两句词条，不认识就落回第一项那句（来源：`StatusBackend.js:92-99`）。

下面是词条原文（中英各一份，照录当时文件的样子；卡面三句与注入两句现在都住在 `locale-pages.js`，`locale-panel.js` 只剩卡框自己的三句与一句搬家注记）：

卡框自己的话（来源：`src/client/kernel/locale-panel.js:45-47` 中文，200-202 行英文与搬家注记）：

- 中文：`'banner.setupPickConfirm': '确认并继续'`，`'banner.setupPickCancel': '取消'`，`'setup.cardTitle': '初始化前最后一问：'`，`'setup.cardBackend': '将用 {name} 执行初始化。要换后端：右侧面板「切换后端」。'`；
- 英文：`'banner.setupPickConfirm': 'Confirm and continue'`，`'banner.setupPickCancel': 'Cancel'`，`'setup.cardTitle': 'One last question before setup:'`，`'setup.cardBackend': 'This setup will run with {name}. To change the backend: use “Switch backend” in the right panel.'`；
- 搬家注记中文在第 47 行：“布局那一问的四条键搬去 locale-pages.js（本文件贴着 350 行上限……）”；英文侧同一注记在第 202 行：“the layout radio group moved to locale-pages.js — this file is at its 350-line cap.”。

卡面上那一问与两个选项（来源：`src/client/kernel/locale-pages.js:27-29` 中文，102-104 行英文；卡面引用见 `StatusBackend.js:61-62`）：

- 中文：`'setup.layoutQuestion': '这个仓库的各部分共用一套用语，还是各有各的用语？'`；`'setup.layoutSingle': '根目录一份 CONTEXT.md'`；`'setup.layoutMulti': '子项目各一份 CONTEXT.md，根目录 CONTEXT-MAP.md'`；
- 英文：`'setup.layoutQuestion': 'Do the parts of this repo share one glossary, or does each keep its own?'`；`'setup.layoutSingle': 'One CONTEXT.md at the repo root'`；`'setup.layoutMulti': 'One CONTEXT.md per subproject, plus a root CONTEXT-MAP.md'`。

注入进全文的那两句人话（来源：`locale-pages.js:30-31` 中文，105-106 行英文；键表见本节引的 `prompts.js:91`）：

- 中文 single（键 `setup.layout.single`）：`'本仓库的域文档布局已在初始化时与用户确认为 single-context（一个仓库共用一份根目录的 CONTEXT.md，架构决定放 docs/adr/）：请把 single-context 这一句结论写进 docs/agents/domain.md，并让 AGENTS.md 的 ## Agent skills 块里 Domain docs 那一行也用这同一个词（技能要求的写法是「一行布局摘要 ＋ See docs/agents/domain.md」）；本次初始化不创建 CONTEXT-MAP.md 与各子项目的 CONTEXT.md，留到第一次真正写下词条时再建'`；
- 中文 multi（键 `setup.layout.multi`）：`'本仓库的域文档布局已在初始化时与用户确认为 multi-context（子项目各一份 CONTEXT.md，根目录一份 CONTEXT-MAP.md）：请把 multi-context 这一句结论写进 docs/agents/domain.md，并让 AGENTS.md 的 ## Agent skills 块里 Domain docs 那一行也用这同一个词（技能要求的写法是「一行布局摘要 ＋ See docs/agents/domain.md」）；本次初始化不创建 CONTEXT-MAP.md 与各子项目的 CONTEXT.md，留到第一次真正写下词条时再建，届时由仓库根目录的 CONTEXT-MAP.md 指向它们'`；
- 英文 single：`'The domain-doc layout for this repo was confirmed with the user at setup time as single-context (one CONTEXT.md at the repo root, with architecture decisions in docs/adr/): write that single-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither CONTEXT-MAP.md nor per-subproject CONTEXT.md files — they wait until the first real glossary entry is written'`；
- 英文 multi：`'The domain-doc layout for this repo was confirmed with the user at setup time as multi-context (one CONTEXT.md per subproject, plus a CONTEXT-MAP.md at the repo root): write that multi-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither CONTEXT-MAP.md nor the per-subproject CONTEXT.md files — they wait until the first real glossary entry is written, and the CONTEXT-MAP.md at the repo root will then point at them'`。

切换路上卡多出来的那一句说明（只在切换路显示，黄条与检查页路不显示；来源：`SetupCard.js:39-43`，词条在 `locale-pages.js:32` 中文与 107 行英文）：

- 中文：`'这个工作区已经初始化过。这里改的是记在仓库里的域文档布局结论；点确认之后，除「把记录后端的那几处对齐到新后端」之外，还会请 AI 把 docs/agents/domain.md 与 AGENTS.md 里记布局的那两行也改成新结论（不会重跑初始化、也不会重建已有产物）。'`；
- 英文：`'This workspace is already set up. What you change here is the domain-doc layout conclusion recorded in the repo; after you confirm, the plugin will additionally ask the AI to rewrite the two lines that record the layout in docs/agents/domain.md and AGENTS.md (it will not re-run setup and will not rebuild existing artifacts).'`。
