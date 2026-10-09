# 触发初始化/切换/布局的入口×状态输出（只认一手来源）

> 范围：只读源码、测试、ADR 指定的七个一手来源与其直接引用的同闭包文件。不给改法建议。
> 一手来源：`src/client/views/shared/BackendSelector.js`、`src/client/views/shared/SwitchConfirmModal.js`、`src/client/statusbar/StatusBackend.js`、`src/client/kernel/store-switch.js`、`src/client/kernel/prompts-setup.js`，另加其同闭包直接调用点 `src/client/statusbar/bannerChain.js`、`src/client/statusbar/StatusBar.js`、`src/client/views/SetupCard.js`、`src/client/views/ChecksTab.js`、`src/client/kernel/prompts.js`、`src/client/panel/Dock.js`、`src/client/panel/OverlayGate.js`、`src/shared/tracker/guide-steps.js`、词条 `src/client/kernel/locale-word.js`、`src/client/kernel/locale-pages.js`、`src/client/kernel/locale-panel.js`。
> 说明：`src/client/statusb/*` 这个路径不存在（`glob src/client/panel/*` 有 `Dock.js,DockSync.js,headFold.js,NamingFailBanner.js,OverlayGate.js,RepoChipSkeleton.js`，`statusb` 报 ENOENT）。下面凡写“状态栏”都指 `src/client/statusbar/*`。
> 说明：`BackendSelector` 全仓只有定义没有挂载点（`grep BackendSelector @ src/client` 只有 `views/shared/BackendSelector.js:6` 定义行），下面写的是它 `handlePick` 里定的分支，不是某页实际画出来的按钮。

状态维度缩写：后端=`GitHub(markdown/gitlab)/无(null/Other)`；布局=`单(single)/多(multi)/未答(null)`；仓库=`就绪(blocksSetup 那一步 done)/未就绪(blocksSetup 没过)/未知(链里没这行)`；链=`有(快照里有步骤行)/无(空/还没到)`。

| 入口 | 当前后端 | 当前布局 | 仓库就绪 | 链快照 | 输出（模板/卡/无） | 来源 |
|---|---|---|---|---|---|---|
| 面板后端选择器 `BackendSelector.handlePick` 选与当前相同值 | 任一 | 任一 | 任一 | 任一 | 什么都不出：`openSwitchConfirm` 直接 `return false`，落到 `onPick(targetId)` 原值直通，不开确认窗 | `BackendSelector.js:25-39`；`store-switch.js:77-78`（`cur==null return false`；`target!=null&&cur===target return false`） |
| 面板后端选择器 选不同值且已有后端 | GitHub/markdown/gitlab | 任一 | 任一 | 任一 | 开卡：`openSwitchConfirm(st,targetId)` 置 `switchConfirm.open=true,target=所选,option=null`，面板内覆盖层画 `SwitchConfirmModal`，此时不注入 | `BackendSelector.js:28-30`；`store-switch.js:86-102` |
| 面板后端选择器 选不同值但当前无后端 | 无 | 任一 | 任一 | 任一 | 不开确认窗：`openSwitchConfirm` 首判 `cur==null return false`，直接 `onPick` | `BackendSelector.js:28-36`；`store-switch.js:77` |
| 面板后端选择器 选不同值但布局小卡开着 | 任一 | 任一 | 任一 | 任一 | 什么都不出：`openSwitchConfirm` 见 `setupLayoutCardOpen===true` 就 `flash switch.setupCardOpen + return false` | `store-switch.js:82-85`；`SetupCard.js:14-16` 节名“同一时刻只会出现一张” |
| 面板头“切换后端”图标（`Dock.js:229`）点击 | 任一已选非 pending | 任一 | 任一 | 任一 | 开卡：`openSwitchConfirm(s,null)` 进“目标待选”态（`target=null,option=null`），窗内 picker 待选，确认禁用 | `panel/Dock.js:229`；`store-switch.js:89,93,99`；`SwitchConfirmModal.js:36-37,122-131` |
| 面板头“切换后端”图标 探测中 | 任一 pending | 任一 | 任一 | 任一 | 什么都不出：按钮 `disabled`，`onClick` 首句 `if(_pend)return` | `panel/Dock.js:229` 行内 `disabled:_pend` |
| 面板头“切换后端”图标 未选后端 | 无 | 任一 | 任一 | 任一 | 不画该图标：`if(_isOther)return null` / `if(_bid==null)return null`，无入口 | `panel/Dock.js:229` |
| 切换确认窗 `SwitchConfirmModal` 刚开（未选目标/未选三选一） | 任一 | 任一 | 任一 | 任一 | 卡照开但确认禁用：`isTargetPending||option==null` 即 `confirmDisabled`，点确认直接 `return` | `SwitchConfirmModal.js:34-44` |
| 切换确认窗 目标 picker 点 GitLab | 任一 | 任一 | 任一 | 任一 | 什么都不出（不可点）：`isBackendUnavailable(m.id)` 即 `disabled+opacity.45`，`onClick if(locked)return`，悬停 `switch.targetLockedTip` | `SwitchConfirmModal.js:145-154`；`locale-word.js:99` |
| 切换确认窗 三选一点“迁移/清空” | 任一 | 任一 | 任一 | 任一 | 什么都不出（不可点）：`OPTION_LOCKED={migrate,clear}`，`onOption if(OPTION_LOCKED[opt])return`，行 `disabled+opacity.45`，悬停 `switch.optLockedTip` | `SwitchConfirmModal.js:48-49,80-86,97`；`locale-word.js:98` |
| 切换确认窗 未选目标时点三选一 | 任一 | 任一 | 任一 | 任一 | 什么都不出：`onOption if(target==null)return`，行 `disabled=isTargetPending\|\|locked` | `SwitchConfirmModal.js:45-47,85` |
| 切换确认窗 选目标后 | 任一 | 任一 | 任一 | 任一 | 只改窗内态：`target=所选；option==null则自动=keep；cri 重拉`，仍不注入 | `SwitchConfirmModal.js:122-131` |
| 切换确认窗 选迁移且 CRI 未全过 | 任一 | 任一 | 任一 | 有（gh:remote/gh:installed/gh:authed 非全 done） | 确认禁用 + 红框：`migrateBlocked=isMigrate&&!criLoading&&!criOk`，明细 `✓/✕+checkShowTitle`，确认点 `return` | `SwitchConfirmModal.js:27-37,148,162-181`；`store-switch.js:110-142,148` |
| 切换确认窗 选清空未输“确认清空” | 任一 | 任一 | 任一 | 任一 | 确认禁用：`clearNeedInput=isClear&&clearInput!=='确认清空'`，点确认 `return` | `SwitchConfirmModal.js:33,37,182-190`；`store-switch.js:149` |
| 切换确认窗 点取消/✕/遮罩 | 任一 | 任一 | 任一 | 任一 | 关窗：`closeSwitchConfirm`（220ms 后置 null），不注入、不写选择 | `SwitchConfirmModal.js:38-40,99,113-116`；`store-switch.js:103-109` |
| 切换确认窗 点确认（keep，有效） | GitHub/markdown | 任一 | 就绪 | 有 | 先 `wf.bind`，再强制重取链快照，判 `tracker:initialized done` 走已初始化支：开布局卡并 `flash switch.bindOkAskLayout`（见布局卡行）；卡没开成则注 `switchAlign` + `flash switch.bindOk` | `store-switch.js:143-177,190-244,260-272` |
| 切换确认窗 点确认（keep，有效） | GitHub/markdown | 任一 | 未就绪 | 有 | 先 `wf.bind`，判未初始化走同决策器：`blocked` 则 `flash switch.bindOkNotReady` 一个字不注；`setup` 则注 `setupRun` 全文 + `flash switch.bindOkFresh`；`askLayout` 则开卡 + `flash switch.bindOkAskLayout` | `store-switch.js:245-259` |
| 切换确认窗 点确认（keep，有效） | 任一 | 任一 | 未知 | 无 | 只 `flash switch.bindOkNotReady`，一个字不注入（链里无 `tracker:initialized` 行时不许猜） | `store-switch.js:185-189,245-249` |
| 状态栏门控窗（蓝条“去选择”→`openStatusGate`）打开 | 无 | 未答 | 任一 | 无/有 | 开窗：`gateModalOpen=true,source=status` + 拉 `wf.registry` 刷新清单，不注入 | `StatusBackend.js:188-191`；`bannerChain.js:228-231`（`open-backend-picker`）；`StatusBar.js:339-350` |
| 状态栏门控窗 点确认选 GitHub/markdown | 无→GitHub/markdown | 未答 | 任一 | 任一 | 只定后端：`userPickSelection+wf.bind`，`flash switch.bindOkFresh`，重取快照+链，不注入任何文字、不记布局 | `StatusBackend.js:193-208`（L197-200 节“只问后端…不注入”） |
| 状态栏门控窗 点确认选 Other | 无 | 任一 | 任一 | 任一 | 什么都不出（只报错）：`gateError=switch.gateOtherErr` | `StatusBackend.js:193`；`locale-word.js:51` |
| 状态栏门控窗 点确认选 GitLab | 无 | 任一 | 任一 | 任一 | 什么都不出（只报错）：`gateError=switch.targetLockedTip`（单选已置灰双保险） | `StatusBackend.js:194-196`；`StatusBar.js:344-350` |
| 面板门控窗（`Dock _openGateModal/_confirmGate`） | 无 | 未答 | 任一 | 任一 | 同状态栏门控：只 `wf.bind` + `flash switch.bindOkFresh`，不注入 | `panel/Dock.js:70-71`（长行内 `_confirmGate`） |
| 悬浮门控（`OverlayGate confirmOverlayGate`） | 无 | 未答 | 任一 | 任一 | 只 `wf.bind` + `flash switch.bindOk`，注释明示“绑定成功不再注入任何文字” | `panel/OverlayGate.js:39-64`（L58-60 节） |
| 设置页（`SettingsPage`）任何后端/布局/仓库/链 | 任一 | 任一 | 任一 | 任一 | 什么都不出：页内无后端/布局/初始化入口（全文 `grep backend\|BackendSelector\|gateSelected\|openStatusGate\|switch @ SettingsPage.js` 仅命中 `switch.cancel` 日志清除确认一行），只读总览不可改 | `views/SettingsPage.js:11-150`（L124-126 节“只读全局总览…不调 wf.bind”） |
| 黄色初始化横幅按钮（`banner.setupBtn`→`runGuideMissing`→`setupInit`） | GitHub/markdown/gitlab | 未答 | 未就绪且仓库步已过 | 有 | 开卡：`injectSetupDecision allowCard:true,askLayout:true` 因 `layoutCardShouldOpen=true` 返回 `askLayout`，置 `setupLayoutCardOpen=true`，一个字不注；横幅日志记 `action` | `bannerChain.js:128-133,238-243`；`prompts-setup.js:17-21,35-47`；`StatusBackend.js:184-187` |
| 黄色初始化横幅按钮 | GitHub/markdown/gitlab | 单/多（答过） | 未就绪且仓库步已过 | 有 | 仍开卡（黄条每次都问）：`askLayout:true` 使 `layoutCardShouldOpen` 恒真，卡上预选上次项，点确认才注 `setupRun` 全文 | `StatusBackend.js:177-187`（L179-181 节“A…每次都先弹卡”）；`prompts-setup.js:17-20` |
| 黄色初始化横幅按钮 | 任一 | 任一 | 仓库步未过（GitHub 未关联仓库） | 有 | 什么都不出：顺序上仓库步先判，`blocksSetup` 未过返回 `blocked`，连卡都不开；黄条本身也不会是初始化那条（顺序结果） | `prompts-setup.js:32-36,48-53`；`bannerChain.js:60-80,72`；`prompts.js:145-159,160-175` |
| 黄色初始化横幅按钮 | 任一 | 任一 | 未知 | 无（仓库行不在快照） | 什么都不出：`guideBannerStep` 见 `blocksSetup&&!stepPresent return null`，无横幅可点 | `bannerChain.js:66-72` |
| 黄色初始化横幅按钮（连带非初始化横幅） | 任一 | 任一 | 任一 | 有 | 非初始化步骤各走各：蓝条开门控窗（`action`）；仓库条开建仓弹窗（`action`）；登录条注登录指引（`text`）；技能条注安装指引（`text`） | `bannerChain.js:201-248`；`guide-steps.js:56-119` 清单顺序 |
| 检查页“执行初始化”按钮（红牌→`setupRunTextForClick`） | 任一 | 未答 | 未就绪且仓库步已过 | 有 | 开卡不注：`injectSetupDecision injectNow:false,allowCard:true` 返回 `askLayout` 即 `kind!=='setup' return null`，分发器见 null 不注入 | `views/ChecksTab.js:36-44,97`；`kernel/prompts.js:185-195` |
| 检查页“执行初始化”按钮 | 任一 | 单/多（答过） | 未就绪且仓库步已过 | 有 | 注 `setupRun` 全文：无 `askLayout` 使 `layoutCardShouldOpen=!readSetupLayout=false`，走 `setupOrRepoPrompt` 得 `setup`，返回全文交分发器注入 | `prompts-setup.js:17-21`；`prompts.js:160-180,188-195` |
| 检查页“执行初始化”按钮 | 任一 | 任一 | 仓库步未过 | 有 | 什么都不出：`setupBlockedByGuide=true` 得 `blocked`，`setupRunTextForClick return null` | `prompts.js:145-159,173-175,188-195` |
| 布局小卡（`SetupLayoutCard`，座位 `FormModalSeat`）打开条件 | 任一 | 未答或（黄条/切换路传 askLayout 则答过也开） | 任一 | 任一 | 开卡：`setupLayoutCardOpen=true` 即画卡（标题 `setup.cardTitle` + 两单选 + `setup.cardBackend{name}` + 确认/取消/✕），与有无横幅/收起无关 | `kernel/slotRenderer-modal-view.js:18`；`views/SetupCard.js:27-50`；`prompts-setup.js:35-42` |
| 布局小卡 点取消/✕/点外面 | 任一 | 任一 | 任一 | 有 | 关卡 + 草稿回退；黄条路就此结束（不注）；切换路则照旧注 `switchAlign`（不注布局条） | `StatusBackend.js:66-89,124-158`（L74-88 节取消回退；L141-148 节已初始化先给对齐） |
| 布局小卡 点确认（黄条/检查页路，owner 非 switch） | 任一 | 单/多（本次所选） | 未就绪且仓库步已过 | 有 | 注 `setupRun` 全文（含本次布局对应的 `{contextLayout}` 段），布局同时写会话+按工作区记住+ `wf.setupLayout` | `StatusBackend.js:159-176`（L163-175 节）；`prompts.js:102-130` |
| 布局小卡 点确认（切换路，已初始化） | 已切到新后端 | 单/多（本次所选） | 就绪（重判） | 有 | 注 `switchAlign{from:旧标签,to:新标签}`（若还没给过）；布局真改了才多注一条 `switchLayout{from:旧人话,to:新人话}` | `StatusBackend.js:100-119,120-158`（L100-106 节“点确认重判”；L141-157 节） |
| 布局小卡 点确认（切换路，未初始化） | 已切到新后端 | 单/多 | 未就绪 | 有 | 注 `setupRun` 全文（与黄条同一文本，仓库步不过则 `blocked` 一个字不注） | `StatusBackend.js:129-135` |
| 布局小卡 点确认（切换路，链未知） | 已切到新后端 | 任一 | 未知 | 无 | 什么都不出 + `flash switch.bindOkNotReady` | `StatusBackend.js:137-139`；`store-switch.js:245-249` 同口径 |
| 新会话入口（状态栏可接/故障悬停、面板 Tabs 新建需求/Bug、交接开新会话都经 `openTextInNewSession`） | 任一 | 任一 | 任一 | 任一 | 对初始化/切换/布局什么都不出：只建同 cwd 会话 + 预填模板（`newWayfinder/newBugWayfinder/handoff`），不调 `injectSetupDecision/openSwitchConfirm`；新会话自己的横幅/卡按它自己的链重判 | `kernel/api-new-session.js:118-160`（L121 节“在新会话中打开”）；`statusbar/StatusBar.js:248,257`；`views/shared/Tabs.js:46,50` |

## 现在实际生效的 V3 文本所见（用户操作→看到哪段）

> “V3”指提示词表里 `#792` 之后实际生效的那版：初始化全文无末尾工具节；切换两条回归为“V15 原文+首句”（见 `prompts.js:34-35,41` 的 `use` 备注：`v3 #792 撤掉末尾工具节；v4 回归为V15原文+首句`）。布局两句填 `{contextLayout}` 空位（`prompts.js:91-92,102-116`，文本在 `locale-pages.js:30-31`）。

- 用户操作“切后端→窗内重选目标→选保留→点确认切换”：先看到窗内三选一（`switch.optKeep=保留（推荐）/optKeepDesc=仅切换指向…`，另两张置灰，见 `SwitchConfirmModal.js:157-161` + `locale-word.js:62-67`）与顶部 `switch.title=切换后端`；点确认后绑定成功先 `flash switch.bindOkAskLayout=已切换到 {label}，请先回答下面那一问（域文档布局）`（`store-switch.js:230`），随后布局卡（`setup.cardTitle=初始化前最后一问：` + `setup.layoutQuestion=这个仓库的各部分共用一套用语…`）。最终注入按重判分：已初始化注 `switchAlign`（首句 `本工作区已从 {from} 切换为 {to}。` + 与 `setupRun` 一字一致的主体，`prompts.js:35`）；未初始化注 `setupRun`（首句无切换句，直接 `初始化本仓库配置…`，`prompts.js:34`）；链未知一个字不注只 `flash switch.bindOkNotReady=已切换到 {label}；这个工作区的仓库还没就绪…`（`store-switch.js:245-249`）。
- 用户操作“布局卡选单→点确认并继续”：卡上看到 `setup.layoutSingle=根目录一份 CONTEXT.md`（`locale-pages.js:28`）被选中；黄条/检查页路注入 `setupRun` 全文，其中 `{contextLayout}` 填 `setup.layout.single=本仓库的域文档布局已在初始化时与用户确认为 single-context…本次初始化不创建 CONTEXT-MAP.md…`（`locale-pages.js:30`）；切换已初始化路若布局没变只注 `switchAlign`（同上），布局从单改多才多注一条时第二条首句为 `本工作区布局已从「{from}」改为「{to}」。`（`prompts.js:41 switchLayout`），其中 `{from}/{to}` 取卡面人话（`StatusBackend.js:94-99 layoutWordOf`）。
- 用户操作“布局卡选多→点确认并继续”：卡上看到 `setup.layoutMulti=子项目各一份 CONTEXT.md，根目录 CONTEXT-MAP.md`（`locale-pages.js:29`）被选中；黄条/检查页路注入 `setupRun` 全文，其中 `{contextLayout}` 填 `setup.layout.multi=本仓库的域文档布局已在初始化时与用户确认为 multi-context…届时由仓库根目录的 CONTEXT-MAP.md 指向它们`（`locale-pages.js:31`）；切换已初始化路同上按“真改了才多注一条”处理（`StatusBackend.js:150-157`），另卡上多见一句 `setup.layoutSwitchNote=这个工作区已经初始化过…不会重跑初始化…`（仅切换路显示，`SetupCard.js:41-43` + `locale-pages.js:32`）。
