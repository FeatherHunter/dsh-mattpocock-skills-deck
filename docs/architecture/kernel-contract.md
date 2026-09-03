# 内核接口冻结清单（kernel contract）

> 状态：✅ 已冻结（G3 · issue #91 拍板 · 2026-08-21；T3 · issue #96 落盘；#444 于 2026-09-05 按实测对齐为 15 模块基准）
> 用途：阶段 2 内核迁移（T3）的接口基准 —— kernel/* 各模块对外导出表；「同层禁互 import」边界裁定。
> 对齐说明（#444）：冻结表 10 行、门禁表 11 行、构建清单 15 项曾脱节，现以实测为准统一为 15 拼接模块；另有 2 个非拼接文件见下节，不计入 15。
> 机制：与 ctx.js 同模式 —— src/client/index.js 中模块原位置留标记 `// ==== kernel:<name> (spliced by build) ====`，
> 构建时由 scripts/build.mjs 把模块文件（剥每行行首 `export `）文本拼回标记处，一源两物（_dev / _pkg 双产物同构）。

## cx 对象（G3 冻结 8 字段，不增不减 · #91 Q1）

| 字段 | 含义 | 来源（apply 闭包） |
|---|---|---|
| ctx | apply 的 cordis ctx | `apply(ctx)` 参数 |
| h | React.createElement | 闭包 `h` |
| rdom | react-dom 访问器（createPortal 用，取不到为 null） | 闭包 `RDOM` |
| storeSvc | 面板状态服务（shared / stores / makeStore / storeOf / emit / sub / useStore） | kernel/store.js |
| localeSvc | DSH locale 服务（register / bind） | `ctx.get('locale')` |
| timer | DSH timer 服务 | `ctx.get('timer')` |
| api | host 桥（call(endpoint, args) → host.call，带可用性守卫） | kernel/api.js 的 apiCall 包装 |
| router | 面板开关 / tab 导航（open / toggle） | kernel/router.js 的 openPanel / togglePanel |

## 非拼接文件（不在 15 之内，避免再数错）

- `kernel/ctx.js`：经 `wireCtx` 在 `apply(ctx)` 顶部注入（`DswsCtx`、`createCx`），不走 `KERNEL_MODULES` 拼接标记，门禁见 `tests/verify-ctx.js`。
- `kernel/tabsfold.js`：折叠纯函数（`TABS_FOLD_HYST`、`TABS_LEVELS`、`tabsLevelDecide`），内联在 `src/client/index.js`，不走拼接标记，门禁见 `tests/verify-tabsfold-leaf.js`。

## kernel/* 模块对外接口表（T3 迁移后 · 每模块一文件 · #444 对齐为 15 模块）

> 迁移顺序（按依赖 · issue #96 Notes）：locale → prompts → icons → styles → store → api → probe → router → config；
> 实际按物理位置与依赖综合串行迁移，每迁一个模块 build + verify-* 全绿再迁下一个。
> 消费方式：模块代码经构建拼回 apply 闭包内原位，闭包变量互相可见（函数调用时才解析引用）；
> 模块文件顶层仅导出声明的常量/函数/纯数据（可被 verify 测试直接 import）。

| 模块文件 | 导出（接口） | 依赖（闭包内引用） | 说明 |
|---|---|---|---|
| `kernel/locale-panel.js`（标记名 `localePanel`） | `L_PANEL`（导航、面板、横幅、环境、初始化引导五组，zh/en 双语） | 无 | 字典片段之一（#458 由 `locale.js` 拆出，304 行） |
| `kernel/locale-flow.js`（标记名 `localeFlow`） | `L_FLOW`（动作、类型、列表、配置、详情、地图、提示七组，zh/en 双语） | 无 | 字典片段之一（#458 由 `locale.js` 拆出，302 行） |
| `kernel/locale-word.js`（标记名 `localeWord`） | `L_WORD`（技能、检查、浮层、命名、切换、进度、错误、模板、运行、技能描述十二组，zh/en 双语） | 无 | 字典片段之一（#458 由 `locale.js` 拆出，245 行） |
| `kernel/locale.js`（标记名 `locale`，合并器） | `L`（`Object.assign` 合并三片段 zh/en，key 一个不改只搬家） | `L_PANEL`/`L_FLOW`/`L_WORD`（定义时引用，标记位顺序保证先片段后合并） | tr 绑定（`localeSvc.bind('dsws')`）由 index.js 装配；字典为唯一真源，verify-t3-locale 契约；合并器 13 行 |
| `kernel/prompts.js` | `PROMPTS`、`promptLang`、`promptText`、`SETUP_DEFAULT_PROMPT_KEYS`、`setupRunParamsFrom`、`setupRunPrompt`、`NEW_WAYFINDER_DEFAULT_WIRING`、`newWayfinderParamsFrom`、`newWayfinderPrompt`、`MATT_REPO`、`MAP_EXECUTE_PROMPT`、`COMPLETE_PROMPT`、`BODY_FORMAT`、`NEW_BUG_FIELDS_BODY`、`NEW_BUG_FIELDS_BODY_EN`、`completePrompt`、`inspectPrompt`、`FIXATE_PROMPT` | localeSvc（promptLang）、L/locale 字典与 L 兜底（setupRunParamsFrom）、repoStr（router，调用时） | PROMPTS 注册表契约见 tests/verify-prompts.js；setupRun 占位符由后端声明键（BackendModule.setupPrompt → wf.registry）经 setupRunParamsFrom 填充（#230 · D10 键入 locale，2026-08-28 生效；#230 已删 setupTrackerLine/Choice/BackendNote 三函数） |
| `kernel/icons.js` | `ICON_SCHEMES`、`WORD_SCHEMES`、`Icon`、`Ic` | h（React.createElement 自由变量） | 通用图标集（统一 SVG stroke 风格） |
| `kernel/styles.js` | `STYLE_TEXT` | 无 | 样式唯一真源；index 标记处保留 `styles.insert(STYLE_TEXT)` 调用 |
| `kernel/portal.js` | `RDOM`、`portalTop`、`PortalOverlay` | h（自由变量）、`ReactDOM`/`window.ReactDOM`/`require('react-dom')`/`document.body` | 挂顶底座（#380 抽离，平台抽象层，与 styles 同级）；RDOM 三路探测取不到为 null，portalTop 挂 document.body 取不到退化原地不抛，PortalOverlay 统一经 portalTop 挂顶（issue #3 / #22 同理） |
| `kernel/config.js` | `CFG_KEY`、`cfg`、`saveCfg`、`TPL_KEY`、`templates`、`saveTemplates`、`migrateStartCfg`、`PH`、`TPL_PH`、`TPL_REQUIRED`、`TPL_DEFAULT`、`tplText`、`renderTemplate`、`validateTemplate`、`fixateText` | promptText（prompts） | 配置/模板持久化 + 动作模板引擎（T1 规格 §2-§4）；migrateStartCfg() 调用随模块 |
| `kernel/store-prefs.js`（标记名 `storePrefs`） | 偏好（`DEFAULT_PANEL_H`、`LIST_PREFS_KEY`、`listPrefs`、`saveListPrefs`、`LABEL_CLICKS_KEY`、`labelClicks`、`saveLabelClicks`）、noRepo 状态机（`NOREPO_DISMISS_PREFIX`、`cwdHash`、`noRepoDismissKey`、`isNoRepoDismissed`、`setNoRepoDismissed`、`cwdBasename`、`isNoRepoNameValid`、`ensureNoRepoCard`）、选中与仓库（`setActiveMap`、`clearActiveMap`、`setActiveIssue`、`clearActiveIssue`、`clearActiveDetail`、`ISSUE_CACHE_TTL`、`selectionByCwd`、`repositoryByCwd`、`SELECTION_BY_CWD_KEY`、`BANNER_FOLD_KEY`、`bannerFoldByCwd`、`isBannerFolded`、`setBannerFolded`、`getCachedSelection`、`setCachedSelection`、`getCachedRepository`、`setCachedRepository`） | keyOf（shared:workspaceKey，调用时）、shared/stores/emit（store-snapshot，调用时） | 会话级状态之偏好与选中（#455 由 `store.js` 第 9–119 行拆出，119 行） |
| `kernel/store-switch.js`（标记名 `storeSwitch`） | 标签与颜色（`labelOf`、`presentationById`、`setPresentationMap`、`backendColorOf`、`backendBgOf`、`backendBorderOf`、`repoShortName`）、切换确认（`DEFAULT_SWITCH_PROMPT_ZH`、`openSwitchConfirm`、`closeSwitchConfirm`、`loadSwitchCri`、`confirmSwitchConfirm`、`clearBackendBinding`） | tr（index）、flash（store-snapshot，调用时）、setupRunPrompt/inject/loadSnapshot/loadChain（调用时） | 会话级状态之切换确认（#455 由 `store.js` 第 120–312 行拆出，201 行） |
| `kernel/store-snapshot.js`（标记名 `storeSnapshot`） | 存储核（`makeStore`、`shared`、`stores`、`storeOf`、`emit`、`sub`、`useStore`）、快照与链缓存（`SNAP_CWD_LRU_MAX`、`snapshotByCwd`、`touchLRUClient`、`getCachedSnapshot`、`getCachedEntry`、`setCachedSnapshot`、`getSnapshotVersion`、`lastProbeAtByCwd`、`getProbeAt`、`touchProbeAt`、`SNAP_DISK_CAP`、`diskPutSnapshot`、`diskGetSnapshot`、`CHAIN_CWD_LRU_MAX`、`chainByCwd`、`getChainCacheKey`、`getCachedChain`、`setCachedChain`、`hydrateFromCache`、`mergeSelection`、`applySnapshotSelection`、`getCwdSync`）、提醒（`NOTICE_COLOR`、`noticeIcon`、`flash`） | keyOf（shared:workspaceKey，调用时）、SYNC（shared:trackerSync，调用时） | 会话级状态之存储核与快照（#455 由 `store.js` 第 313–599 行拆出，295 行） |
| `kernel/store-derived.js`（标记名 `storeDerived`） | 派生统计（`compute`、`frontierAll`、`openIssuesOf`、`isOccupied`、`occCount`、`frontierCount`、`hasLabelOf`、`isTriageLike`、`bugCount`、`triageCount`、`buildColorOf`、`isLightHex`、`actionColorOf`、`rowActionText`、`mkRowAction`、`timeStampStr`） | issueUrlFor（link，调用时）、renderTemplate/startText（config/router，调用时） | 会话级状态之派生统计与行级动作（#455 由 `store.js` 第 600–741 行拆出，150 行） |
| `kernel/api-naming.js`（标记名 `apiNaming`） | 交接头（`injectFixate`、`handoffTs`、`handoffFile`、`handoffPrompt`、`extractHandoffFile`、`absHandoffPath`、`handoffReadText`）、草稿（`pendingDraft`、`pendingDraftTargetSid`）、预设与建会话（`getRowPreset`、`isHealthyPreset`、`isReusableBlank`、`buildCreateOpts`、`createPTCSession`）、命名守护（`NAMING_POLL_MS`、`namingCurrentTitleOf`、`namingHintOf`、`executeNamingOrder`、`reconcileNamingFailure`、`applyNamingFailurePanel`、`namingGuardianKick`、`startNamingGuardianPoll`） | inject（api-io，调用时）、fixateText/renderTemplate（config，调用时）、keyOf（shared:workspaceKey，调用时）、storeOf/emit（store-snapshot，调用时）、evaluateRenameLock/composeDraftTitle/newSessionTitle（shared:namingGuardian，调用时）、promptLang（prompts，调用时）、timeStampStr（store-derived，调用时）、tr（index）、host/timer/ctx（自由变量） | 交接头与命名守护（#457 由 `api.js` 第 9–327 行拆出，327 行；原序第 320–327 行八行交接按钮注释为保三文件各≤350 留在本文件尾，纯注释行为不变） |
| `kernel/api-new-session.js`（标记名 `apiNewSession`） | 交接执行（`probeHandoffReady`、`doHandoff`、`doHandoffOpen`）、新会话创建（`openTextInNewSession`） | handoffPrompt/handoffFile（api-naming，调用时）、inject/copyText（api-io，调用时）、buildCreateOpts/createPTCSession/isReusableBlank（api-naming，调用时）、namingHintOf/namingCurrentTitleOf/namingGuardianKick（api-naming，调用时）、storeOf/hydrateFromCache/getCachedSnapshot（store-snapshot，调用时）、keyOf（shared:workspaceKey，调用时）、tr（index）、host/timer/ctx（自由变量） | 交接执行与新会话创建（#457 由 `api.js` 第 328–666 行拆出，347 行） |
| `kernel/api-io.js`（标记名 `apiIo`） | 行级打开（`openInNewSession`）、注入复制（`inject`、`openUrl`、`copyText`）、问题详情（`fetchIssueDetail`、`clearIssueDetailCache`、`fetchIssueComments`、`submitIssueComment`） | openTextInNewSession（api-new-session，调用时）、scheduleActionProbe（probe-auto，调用时）、rowActionText（store-derived，调用时）、newSessionTitle（shared:namingGuardian，调用时）、issueUrlFor（link，调用时）、emit/flash（store-snapshot，调用时）、tr（index）、host（自由变量） | 行级打开与问题详情（#457 由 `api.js` 第 667–852 行拆出，194 行） |
| `kernel/probe-chain.js`（标记名 `probeChain`） | 链自动刷新（`scheduleChainAutoRefresh`、`cancelChainAutoRefresh`）、`loadChain`、链派生（`chainSteps`、`chainStep`、`chainStepStatus`、`chainStepOk`、`chainStepBad`、`readyCount`、`envTotal`、`envLabel`、`setupCheck`）、阻塞者（`openBlockers`、`blockerNames`）、`detectCwd` | getChainCacheKey/getCachedChain/setCachedChain（store-snapshot，调用时）、keyOf（shared:workspaceKey，调用时）、emit（store-snapshot，调用时）、nowStr（probe-snapshot，调用时）、timer/host（自由变量） | 链加载与链派生（#456 由 `probe.js` 第 9–94、96–130 行拆出，130 行） |
| `kernel/probe-snapshot.js`（标记名 `probeSnapshot`） | 快照去重（`pendingSnapshotByCwd`）、颜色时间小函数（`hexA`、`darken`、`nowStr`、`timeOf`、`timeOfMs`）、`broadcastCfg`、`diffSnapshots`、闪清除（`_flashClearPending`、`scheduleFlashClear`）、`loadSnapshot` | flash/hydrateFromCache/applySnapshotSelection/getCwdSync/setCachedSnapshot/storeOf/shared/stores/emit（store，调用时）、keyOf（shared:workspaceKey，调用时）、setPresentationMap（store-switch，调用时）、tr（index）、timer/host（自由变量） | 快照差异与快照加载（#456 由 `probe.js` 第 95、131–403 行拆出，283 行；`pendingSnapshotByCwd` 一行随 `loadSnapshot` 归入本文件，原序第 95 行后移，初始化无依赖行为不变） |
| `kernel/probe-auto.js`（标记名 `probeAuto`） | 节拍（`PROBE_MS`、`FOCUS_PROBE_MIN_MS`、`lastFocusProbe`、`_actionProbePending`）、`probeNow`、`scheduleActionProbe`、`startAutoProbe`、手动刷新（`spinAll`、`refreshAll`）、新鲜度（`SNAP_FRESH_MS`、`snapFresh`） | loadSnapshot/diffSnapshots/scheduleFlashClear（probe-snapshot，调用时）、loadChain（probe-chain，调用时）、flash/touchProbeAt/hydrateFromCache/shared/stores/emit（store，调用时）、keyOf（shared:workspaceKey，调用时）、tr（index）、timer/host/document（自由变量） | 自动探测与手动刷新（#456 由 `probe.js` 第 405–634 行拆出，239 行） |
| `kernel/router.js` | `openPagePanel`、`openDockPanel`、`sidebarTabDisposer`、`sidebarTabRetry`、`ensureSidebarTab`、`openInSidebar`、`openPanel`、`togglePanel`、`repoStr`、`withWayfinderPrefix`、`startText`、`newWayfinderText`、`newBugWayfinderText` | cfg（config）、loadSnapshot/hydrateFromCache/snapFresh（probe）、renderTemplate/completePrompt/BODY_FORMAT/MAP_EXECUTE_PROMPT/promptText（config/prompts） | 面板开关 / tab 导航 / 文本生成（#444 按实测移除已不存在的 `SESSION_TITLE_PREFIX`、`newSessionTitle`） |
| `kernel/builtin-backends.js`（标记名 `backendList`） | `BUILTIN_BACKENDS`、`builtinLabelOf`、`otherFiltered`、`firstBackendIdOf`、`repositoryActionOf`、`moduleMetaOf` | 无 | 内置后端显示名单单源（#231 类别 5 收编）；注意文件名与标记名不同，标记为 `// ==== kernel:backendList (spliced by build) ====` |
| `kernel/link.js` | `issueUrlFor`、`openIssueUrl`、`searchUrlFor`、`repoUrlFor`、`issueRefNumbersFrom` | 无（调用时收 `st`/`host`） | 问题链接与搜索链接纯函数 |
| `kernel/actions.js` | `createActionDispatcher`、`ACTIONS_VERSION` | 闭包内 `host`/`store`/`probe`（调用时） | 动作分发器（表单提交、注入、开链接、刷新） |
| `kernel/slots.js` | `SLOTS_KERNEL_VERSION`、`SLOT_DEFS_KERNEL`、`MODAL_SEAT_ID`、`orderOf`、`isScopeValid`、`canDeclareIn`、`shouldShowInModal`、`isModalAction`、`getWizardAction`、`getFormAction`、`getModalAction`、`getWizardSteps` | 无 | 五个内部端口声明与向导动作判断（寄生官方父槽，随父坍缩回收） |
| `kernel/slotRenderer-queue.js`（标记名 `slotRendererQueue`） | `SLOT_RENDERER_VERSION`、`ensureFormModal`、`openFormModal`、`closeFormModal`、`createModalRenderForm`、`canOpenModalForStep`、`canOpenWizardForStep` | flash（store，调用时） | 槽位渲染器之队列与开关 + 打开入口与守门（#454 由 `slotRenderer.js` 拆出；`createModalRenderForm` 为 `openFormModal` 别名，守门寄放本文件以保 modal-view 单文件达标） |
| `kernel/slotRenderer-repo-sync.js`（标记名 `slotRendererRepoSync`） | `startRepoSync`、`finishRepoSync`、`retryRepoSync` | flash（store，调用时）、`repoUrlFor`（link，调用时） | 槽位渲染器之仓库同步流程与失败文案（#454 由 `slotRenderer.js` 拆出；`retryPushFlow` 等内部 helpers 同文件） |
| `kernel/slotRenderer-modal-view.js`（标记名 `slotRendererModalView`） | `FormModalSeat` | flash（store，调用时）、`repoUrlFor`（link，调用时） | 槽位渲染器之弹窗本体（#454 由 `slotRenderer.js` 拆出；348 行组件独占一文件，头注释仅一行以保 350 行门槛，后续增行须再拆） |

## 边界裁定（G3 Q3 · #91 拍板）

- **同层共享组件放 `views/shared/`**，不塞 kernel —— kernel 只放宿主桥与状态原语（T4 叶子迁移时落地）。
- kernel/ctx/index 是「并发时默认冻结」层：只允许一个 session（conductor）碰（对抗审查修正：这是契约不是物理隔离，接口必须先冻结再放叶子并行）。
- 模块间在源码层**不互 import**（同层禁互 import 边界）：闭包拼接机制下依赖经闭包变量解析，模块文件之间零 import 边 —— 这是本仓库「文本组合」构建模式的显式边界，接口以本表为准。

## 验收挂钩

- 每迁一个模块：`node scripts/build.mjs` + verify-* 全绿（基线 34/35，唯一失败 verify-detail-levels 为预存环境数据漂移）+ smoke 3/3。
- `tests/verify-kernel.js`：kernel 文件存在性 + 导出齐全 + 双产物已拼接（一源两物）断言。
