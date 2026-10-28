# 内核接口冻结清单（kernel contract）

> 状态：✅ 已冻结（G3 · issue #91 拍板 · 2026-08-21；T3 · issue #96 落盘；#444 于 2026-09-05 按实测对齐为 15 模块基准）
> 用途：阶段 2 内核迁移（T3）的接口基准 —— kernel/* 各模块对外导出表；「同层禁互 import」边界裁定。
> 对齐说明（#444）：冻结表 10 行、门禁表 11 行、构建清单 15 项曾脱节，现以实测为准统一为 15 拼接模块；另有 2 个非拼接文件见下节，不计入 15。
> 接口增量（#595 · 2026-09-10）：`kernel/prompts.js` 增 6 个导出（`bodyFormatDefault`、`currentBackendId`、`backendPromptFrom`、`bodyFormatText`、`backendParamsFor`、`promptTextFor`），`kernel/config.js` 增 `TPL_BACKEND_MARKERS`；目的是让「正文格式」这段文案由跟踪器后端各自声明、模板只留标记。口径与来龙去脉见下面「正文格式契约」一节。
> 今天的形状（#1292 · 2026-10-20）：提示词文本的真源已从源码搬进 `config/prompts/` 下的 YAML 与 `config/languages.yaml`，源码里不再有提示词字面量；`bodyFormatDefault` / `bodyFormatText` / `BODY_FORMAT` 三个导出随 #725 删掉「正文格式」整节一并退役；「按当前后端渲染」那一族改名住在 `kernel/prompts-backend.ts`。详见下面「提示词真源与语言清单」与「正文格式契约」两节。
> 今天的形状（#1294 · 2026-10-20）：界面词表的真源已从十份 `src/client/kernel/locale-*.ts` 片段搬进 `config/copy/` 下的十份词族 YAML，源码里不再有界面文案字面量；客户端只留一份合并器与取词助手 `kernel/locale.ts`，词表本体是构建期生成的 `kernel/locale-data.ts`（不入库，拼在 `kernel:locale` 之前）。详见下面「界面词表真源与语言清单」一节。
> 机制：与 ctx.ts 同模式 —— src/client/index.ts 中模块原位置留标记 `// ==== kernel:<name> (spliced by build) ====`，
> 构建时由 scripts/build.mts 把模块文件（剥每行行首 `export `）文本拼回标记处，一源两物（_dev / _pkg 双产物同构）。

## cx 对象（G3 冻结 8 字段，不增不减 · #91 Q1）

| 字段 | 含义 | 来源（apply 闭包） |
|---|---|---|
| ctx | apply 的 cordis ctx | `apply(ctx)` 参数 |
| h | React.createElement | 闭包 `h` |
| rdom | react-dom 访问器（createPortal 用，取不到为 null） | 闭包 `RDOM` |
| storeSvc | 面板状态服务（shared / stores / makeStore / storeOf / emit / sub / useStore） | kernel/store-prefs.ts、kernel/store-switch.ts、kernel/store-snapshot.ts、kernel/store-derived.ts 四片（冻结当时合成一份 `kernel/store.js`，#455 拆开） |
| localeSvc | DSH locale 服务（getSnapshot / addLanguage / register / bind） | `ctx.get('locale')`；#1294 起由 `kernel/locale.ts` 的 `localeAdopt` 按语言清单逐门注册，`src/client/index.ts` 用 `ctx.effect` 挂载与清理 |
| timer | DSH timer 服务 | `ctx.get('timer')` |
| api | host 桥（call(endpoint, args) → host.call，带可用性守卫） | kernel/api-io.ts 等五片里的 apiCall 包装（冻结当时合成一份 `kernel/api.js`，#457 拆开） |
| router | 面板开关 / tab 导航（open / toggle） | kernel/router.ts 的 openPanel / togglePanel |

## 非拼接文件（不在 15 之内，避免再数错）

- `kernel/ctx.ts`：经 `wireCtx` 在 `apply(ctx)` 顶部注入（`DswsCtx`、`createCx`），不走 `KERNEL_MODULES` 拼接标记，门禁见 `tests/verify-ctx.ts`。
- `kernel/tabsfold.ts`：折叠纯函数（`TABS_FOLD_HYST`、`TABS_LEVELS`、`tabsLevelDecide`），内联在 `src/client/index.ts`，不走拼接标记，门禁见 `tests/verify-tabsfold-leaf.ts`。

## kernel/* 模块对外接口表（T3 迁移后 · 每模块一文件 · #444 对齐为 15 模块）

> 迁移顺序（按依赖 · issue #96 Notes）：locale → prompts → icons → styles → store → api → probe → router → config；
> 实际按物理位置与依赖综合串行迁移，每迁一个模块 build + verify-* 全绿再迁下一个。
> #1294 之后 locale 这一支的拼装顺序固定为 `kernel:localeData` → `kernel:locale`：生成物先拼，合并器与取词助手才能取到 `LOCALE_COPY` / `LANG_CONFIG` / `LOCALE_LANGS` 这几个名字。
> 消费方式：模块代码经构建拼回 apply 闭包内原位，闭包变量互相可见（函数调用时才解析引用）；
> 模块文件顶层仅导出声明的常量/函数/纯数据（可被 verify 测试直接 import）。
> 拼装顺序不是随手可换的：#1294 要求 `kernel:localeData` 先于 `kernel:locale`（取词表生成物）；#1296 起 `kernel:containerView` 必须先于 `kernel:styles` —— `STYLE_TEXT` 在模块求值时就拼好字符串、直接读中央色表 `CONTAINER_ACCENT`，晚于它会落在 `const` 的暂时性死区里。下面 styles 一行的依赖栏记的正是这一条。#1236 又添了 `kernel:motion` 一片，它在样式字符串拼装时被读，所以也必须排在 `kernel:styles` 之前（motion 一行的说明栏记了这条）。
> 表里的行是冻结当时的模块名单，后来又添了新片：#1292 添了 `kernel/prompt-data.ts` 与 `kernel/prompts-backend.ts`，另有 `kernel/prompts-setup.ts`、`kernel/health-check.ts`、`kernel/modal-fields.ts` 等片是更早的票添的，本表没有逐行补齐。#1294 又删掉十份 locale 片段（`locale-panel` 到 `locale-spec` 十份），把它们并成两份：生成物 `kernel/locale-data.ts` 与合并器兼取词助手 `kernel/locale.ts`。#1297 添了入口浮层的两片：`kernel/entry-card.ts`（卡面画法与断行）与 `kernel/entry-choice.ts`（浮层、选卡与两处宿主共用的拼装），两片在 `kernel:router` 之后、`leaf:tabs`/`leaf:statusBar` 之前拼进来，且 entryCard 必须在前（entryChoice 画卡要调它）。#444 的「15 模块」是当时那次的基准，不是今天的总数。
> 「模块文件」一列写的是冻结当时的文件名，多数还是 `.js`。内核脚本后来陆续转成了 TypeScript（#1209 转三份拼接片段，#1251 转其余六十二份），今天 `src/client/kernel/` 下全是 `.ts` 真源，同名 `.js` 是构建产物、不入库；本表只在提示词与界面词表有关的行上按今天的真源写（#1294 起 locale 两行也是）。#1428 起 probe 系六片、store-snapshot、slotRenderer-repo-sync 搬进 `src/refresh/rooms/client/` 并改名（新名见 `src/refresh/README.md`），本表这九行的旧名按此换算，标记名与接口不变。

| 模块文件 | 导出（接口） | 依赖（闭包内引用） | 说明 |
|---|---|---|---|
| `kernel/locale-data.ts`（标记名 `localeData`，生成物） | 运行时名字：`LANG_CONFIG`（语言清单：缺省语言 default 与每门语言的 label、fallback）、`LOCALE_LANGS`（语言 id 列表）、`LOCALE_COPY`（全词表：语言 id → 词条键 → 文案）、十族常量 `L_PANEL` / `L_FLOW` / `L_WORD` / `L_VCWRITE` / `L_PAGES` / `L_LABELS` / `L_CARDS` / `L_SKILLDESC` / `L_SKILLDETAIL` / `L_SPEC`；源码阶段另有类型 `LocaleLanguageEntry`、`LocaleLanguageConfig`、`LocaleLang`、每族键名联合 `LocaleKey<族名>` 与总联合 `LocaleKey`，供 typecheck 与门禁 import，构建时整段剥掉 | 无 | 界面词表的生成物（#1294 取代十份 locale 片段）：由 `config/copy/` 下十份词族 YAML（panel、flow、word、vcwrite、pages、labels、cards、skilldesc、skilldetail、spec）与 `config/languages.yaml` 经 `scripts/generate-locale-config.mts` 现场生成，构建期写出、不入库。拼装顺序必须排在 `kernel:locale` 之前（见下面「界面词表真源与语言清单」一节） |
| `kernel/locale.ts`（标记名 `locale`，合并器与取词助手） | 10 个导出：`L`（`LOCALE_COPY` 的只读别名，与旧 `register('dsws', L)` 的用法同形）、`languageIds`、`localeMainTagOf`、`langChainFrom`、`langChainOf`、`uiLang`、`pickLangText`、`uiText`、`languageLabelOf`、`localeAdopt` | `LANG_CONFIG` / `LOCALE_LANGS` / `LOCALE_COPY`（kernel:localeData，定义时与调用时）、`localeSvc`（index 闭包）、`log` / `dswsLogHash` / `dswsLogTrunc`（kernel:log 与 probe-snapshot，日志用，调用时） | 取代十份 locale 片段（#1294）：把生成物暴露成 `L`，按语言清单算当前语言与回退链，`localeAdopt` 把 dsws 命名空间按清单逐门 register、宿主缺的语言先 addLanguage，返回清理函数交给 index 的 `ctx.effect`。注册这一趟发两条日志（`locale.registration.fail` 告警常驻、`locale.registration` 信息按需），实际发射壳是同文件的 `localeLogEmit`（晚一拍进微任务），事件台账见 `research/489-appendix.md` 的 #112 / #113 |
| `kernel/prompts.ts`（标记名 `prompts`） | 22 个导出：`PROMPTS`、`VOCABULARY_DEFAULT`、`promptLanguages`、`promptLang`、`vocabularyParamsFrom`、`promptText`、`promptFragment`、`SETUP_DEFAULT_PROMPT_KEYS`、`SETUP_LAYOUT_TEXT_KEYS`、`SETUP_LAYOUT_DEFAULT`、`normalizeSetupLayout`、`readSetupLayout`、`setupRunParamsFrom`、`setupRunPrompt`、`switchAlignPrompt`、`setupBlockedByGuide`、`setupOrRepoPrompt`、`setupRunTextForClick`、`consumePendingSetup`、`NEW_WAYFINDER_DEFAULT_WIRING`、`newWayfinderParamsFrom`、`NEW_BUG_FIELDS_BODY`（#1294 删掉了 `NEW_BUG_FIELDS_BODY_EN`：中英两份正文都由 `NEW_BUG_FIELDS_BODY()` 按语言链取自同一片段，不再留一个「只管英文」的取用口；`promptLang()` 的返回类型也从 `'zh' | 'en'` 放宽成 `string`） | `PROMPT_TEMPLATE_DATA` / `PROMPT_FRAGMENT_DATA` / `LANGUAGES_YAML`（kernel:promptData，调用时）、localeSvc（promptLang）、L/locale 字典与 L 兜底（setupRunParamsFrom）、`currentBackendId` / `declaredLangPick` / `backendPromptFrom`（kernel:promptsBackend，调用时）、getCachedSelection / chainSteps / guideStepsFor / guideStepDone / injectSetupDecision（闭包，调用时）、DOC_LAYOUT_VALUES（shared:docLayout，拼进闭包，调用时） | 提示词真源不在本文件：`PROMPTS` 读生成物 `PROMPT_TEMPLATE_DATA`，`VOCABULARY_DEFAULT` / `NEW_WAYFINDER_DEFAULT_WIRING` / `NEW_BUG_FIELDS_BODY` 读生成物 `PROMPT_FRAGMENT_DATA`（#1294：中英正文由语言链挑，不再有只取英文的取用口）；真源是 `config/prompts/` 下的 YAML，见下面「提示词真源与语言清单」一节。注册表契约见 tests/verify-prompts.ts；setupRun 占位符由后端声明键（BackendModule.setupPrompt → wf.registry）经 setupRunParamsFrom 填充（#230 · D10 键入 locale，2026-08-28 生效；#230 已删 setupTrackerLine/Choice/BackendNote 三函数）。#1209 起本文件是 TypeScript，同名 .js 是构建产物、不入库；#1449 起 `readSetupLayout` 的读取顺序是「本次会话的选择 → 快照回包的 `snapshot.setupLayout`」，不再读浏览器本地表 |
| `kernel/prompts-backend.ts`（标记名 `promptsBackend`） | 13 个导出：`currentBackendId`、`backendPromptFrom`、`declaredLangPick`、`backendParamsFor`、`promptTextFor`、`newWayfinderPrompt`、`MATT_REPO`、`MAP_EXECUTE_PROMPT`、`COMPLETE_PROMPT`、`FIXATE_PROMPT`、`newSpecPrompt`、`completePrompt`、`inspectPrompt` | promptText / promptLang / newWayfinderParamsFrom / vocabularyParamsFrom（kernel:prompts，调用时）、getCachedSelection / repoUrlFor / issueUrlFor（闭包，调用时） | 「按当前后端渲染一条提示词」那一族（#1292 由 `kernel/prompts.ts` 拆出，避 350 行上限；同属一个客户端闭包，互调不走 import）。这族里没有 `bodyFormatDefault` / `bodyFormatText` / `BODY_FORMAT` 三个导出：它们随 #725 删掉「正文格式」整节一并退役，见下面「正文格式契约」一节 |
| `kernel/prompt-data.ts`（标记名 `promptData`，生成物） | 运行时三个名字：`PROMPT_TEMPLATE_DATA`（模板全表）、`PROMPT_FRAGMENT_DATA`（片段全表）、`LANGUAGES_YAML`（语言清单）；源码阶段另有四个接口与两个类型别名（`PromptTemplateEntry` / `PromptFragmentShape` / `PromptLanguageEntry` / `PromptLanguageConfig` / `PromptTemplateId` / `PromptTemplatePlaceholders`），供 typecheck 与门禁 import，构建时整段剥掉 | 无 | 提示词配置的生成物：由 `config/prompts/` 下的五份模板族 YAML（片段按注入时机住在对应族里）+ 一份跨族公共小节 YAML（`shared-sections.yaml`）与 `config/languages.yaml` 经 `scripts/generate-prompt-config.mts` 现场生成，构建期写出、不入库。模板正文里的 `{{shared:sharedTools}}` 在读取时就展开成公共小节正文，所以产物里的模板与今天看到的一样是完整正文。拼装顺序必须排在 kernel:prompts 之前（见下面「提示词真源与语言清单」一节） |
| `kernel/icons.js` | `ICON_SCHEMES`、`WORD_SCHEMES`、`Icon`、`Ic` | h（React.createElement 自由变量） | 通用图标集（统一 SVG stroke 风格） |
| `kernel/styles.js` | `STYLE_TEXT` | `CONTAINER_ACCENT`（kernel:containerView，模块求值时取色） | 样式唯一真源；index 标记处保留 `styles.insert(STYLE_TEXT)` 调用。`STYLE_TEXT` 是模块求值时拼好的字符串，#1296 起里面两套容器的身份色直接读中央色表，所以本模块必须在 kernel:containerView 之后拼接（见上面「消费方式」一段） |
| `kernel/motion.ts`（标记名 `motion`） | `MOTION`（46 个界面动效时长的毫秒令牌：过渡、旋转、闪烁、骨架呼吸、像素逐帧、下一步建议气泡等；键名按用途命名、统一以 `Ms` 结尾，值为整数毫秒） | 无 | #1236 起的动效时长唯一真源：样式字符串在模块求值时用 `MOTION.xxx + 'ms'` 拼成 CSS，所以本模块必须拼在 `kernel:styles` 之前（const 有暂时性死区，见上面「消费方式」一段）。新时长一律加在这里，`src/client/**` 里其它文件不许再写字面时长，由 `tests/verify-motion-tokens.ts` 守；「系统要求减少动态效果」时用 `MOTION.motionOffMs`（1 毫秒）。为什么不做成 YAML 见 `docs/adr/20261021-config-ownership.md` |
| `kernel/container-view.ts`（标记名 `containerView`） | 身份色中央色表与容器取色助手（#1296）：`CONTAINER_ACCENT`（`{ map, spec }` 唯一真值）、`CONTAINER_TINT`、`CONTAINER_CHIP_CLASS`、`CONTAINER_CHIP_LABEL_KEY`、`CONTAINER_CHIP_MARKER_CLASS`、`CONTAINER_EMPTY_COLOR`、`CONTAINER_DONE_COLOR`，以及按容器类型判定的 `containerKindOf`、`containerStateOf`、`containerTriState`、`containerNumberColor`、`containerCountKey`、`containerTitleKey`、`containerPromptText` | `promptTextFor` / `completePrompt` / `inspectPrompt`（kernel:promptsBackend）与 `startText`（index 闭包），都在调用时 | #1286 起的容器单一真源（判定、三态、取色、角标、按钮提示词都在这份文件）；#1296 把探索紫与规格蓝从十几个客户端文件收进 `CONTAINER_ACCENT`，除本文件与版本控制页签自己的 `views/versionControl/vcStyles.ts`（那份蓝与规格蓝互不相干，按路径白名单）之外，客户端源码不许再出现这两个色值，门禁 `tests/verify-container-colors.ts` 守着；本模块必须拼在 `kernel:styles` 之前，理由见上面「消费方式」一段 |
| `kernel/portal.js` | `RDOM`、`portalTop`、`PortalOverlay` | h（自由变量）、`ReactDOM`/`window.ReactDOM`/`require('react-dom')`/`document.body` | 挂顶底座（#380 抽离，平台抽象层，与 styles 同级）；RDOM 三路探测取不到为 null，portalTop 挂 document.body 取不到退化原地不抛，PortalOverlay 统一经 portalTop 挂顶（issue #3 / #22 同理） |
| `kernel/config.ts` | `TPL_KEY`、`templates`、`saveTemplates`、`PH`、`TPL_PH`、`TPL_REQUIRED`、`TPL_DEFAULT`、`tplText`、`renderTemplate`、`TPL_BACKEND_MARKERS`、`validateTemplate`、`fixateText` | promptText（prompts） | 模板持久化 + 动作模板引擎（T1 规格 §2-§4）；`TPL_BACKEND_MARKERS` 登记「内容由后端声明提供」的模板标记（#595 · 2026-09-10 立的，当时值 `['bodyFormat']`；随 #725 删掉「正文格式」整节，今天的值是空数组 `[]`，见下面「正文格式契约」一节）。#1012 定案第 10、11 条删掉了 `CFG_KEY`/`cfg`/`saveCfg`（旧配置存档 `dsws.cfg`）与 `migrateStartCfg`（更旧的 `dsws.startCfg` 迁移）；模板的读写已改走本机设置文件的 `templates` 节（`kernel/settings-templates.ts`）。#1251 起本文件是 TypeScript，同名 .js 是构建产物、不入库 |
| `kernel/store-prefs.js`（标记名 `storePrefs`） | 偏好（`DEFAULT_PANEL_H`、`LIST_PREFS_KEY`、`listPrefs`、`saveListPrefs`、`LABEL_CLICKS_KEY`、`labelClicks`、`saveLabelClicks`）、noRepo 状态机（`NOREPO_DISMISS_PREFIX`、`cwdHash`、`noRepoDismissKey`、`isNoRepoDismissed`、`setNoRepoDismissed`、`cwdBasename`、`isNoRepoNameValid`、`ensureNoRepoCard`）、选中与仓库（`setActiveMap`、`clearActiveMap`、`setActiveIssue`、`clearActiveIssue`、`clearActiveDetail`、`ISSUE_CACHE_TTL`、`selectionByCwd`、`repositoryByCwd`、`SELECTION_BY_CWD_KEY`、`BANNER_FOLD_KEY`、`bannerFoldByCwd`、`isBannerFolded`、`setBannerFolded`、`getCachedSelection`、`setCachedSelection`、`userHintOf`、`keepUserPick`、`userPickSelection`、`adoptBoundRev`、工作区配置文件回执（`workspaceFileNoteOf` 把宿主回执翻成状态栏那一句人话，`workspaceFileNoteEl` 生成那一行节点）、`getCachedRepository`、`setCachedRepository`） | keyOf（shared:workspaceKey，调用时）、shared/stores/emit（store-snapshot，调用时） | 会话级状态之偏好与选中（#455 由 `store.js` 第 9–119 行拆出，119 行）。#1449 删掉了整组布局本地表导出（`SETUP_LAYOUT_BY_CWD_KEY` / `setupLayoutByCwd` / `getCachedSetupLayout` / `setCachedSetupLayout` / `migrateCachedChoiceToKey`）：布局答案改由宿主写工作区文件、随快照回包，客户端只读会话与快照 |
| `kernel/store-switch.js`（标记名 `storeSwitch`） | 标签与颜色（`labelOf`、`presentationById`、`setPresentationMap`、`backendColorOf`、`backendBgOf`、`backendBorderOf`、`repoShortName`）、切换确认（`DEFAULT_SWITCH_PROMPT_ZH`、`openSwitchConfirm`、`closeSwitchConfirm`、`loadSwitchCri`、`confirmSwitchConfirm`） | tr（index）、flash（store-snapshot，调用时）、setupRunPrompt/inject/loadSnapshot/loadChain（调用时） | 会话级状态之切换确认（#455 由 `store.js` 第 120–312 行拆出，201 行） |
| `kernel/store-snapshot.js`（标记名 `storeSnapshot`） | 存储核（`makeStore`、`shared`、`stores`、`storeOf`、`emit`、`sub`、`useStore`）、快照与链缓存（`SNAP_CWD_LRU_MAX`、`snapshotByCwd`、`touchLRUClient`、`getCachedSnapshot`、`getCachedEntry`、`setCachedSnapshot`、`getSnapshotVersion`、`lastProbeAtByCwd`、`getProbeAt`、`touchProbeAt`、`SNAP_DISK_CAP`、`diskPutSnapshot`、`diskGetSnapshot`、`CHAIN_CWD_LRU_MAX`、`chainByCwd`、`getChainCacheKey`、`getCachedChain`、`setCachedChain`、`hydrateFromCache`、`mergeSelection`、`applySnapshotSelection`、`getCwdSync`）、提醒（`NOTICE_COLOR`、`noticeIcon`、`flash`） | keyOf（shared:workspaceKey，调用时）、SYNC（shared:trackerSync，调用时） | 会话级状态之存储核与快照（#455 由 `store.js` 第 313–599 行拆出，295 行） |
| `kernel/store-derived.js`（标记名 `storeDerived`） | 派生统计（`compute`、`frontierAll`、`openIssuesOf`、`isOccupied`、`occCount`、`frontierCount`、`applyStandaloneBlocks`、`hasLabelOf`、`isTriageLike`、`bugCount`、`triageCount`、`buildColorOf`、`isLightHex`、`rowActionKind`、`actionColorOf`、`rowActionText`、`mkRowAction`、`timeStampStr`）、工单口径与后端计数（`isTicketRow`、`ticketRowsOf`、`deckCountsOf`） | issueUrlFor（link，调用时）、renderTemplate/startText（config/router，调用时） | 会话级状态之派生统计与行级动作（#455 由 `store.js` 第 600–741 行拆出，150 行；#544 增独立票阻塞边合并 `applyStandaloneBlocks`，只读快照 issues 自带边，零请求；#689 增工单口径 `isTicketRow`／`ticketRowsOf` 与后端计数读取 `deckCountsOf`，主列表、KPI、状态栏三处共用同一处判断；#771 增一处分类 `rowActionKind`，四处展示共用它） |
| `kernel/api-naming.js`（标记名 `apiNaming`） | 交接头（`injectFixate`、`handoffPrompt`、`extractHandoffFile`、`absHandoffPath`、`handoffReadText`）、预设与建会话（`getRowPreset`、`isHealthyPreset`、`isReusableBlank`、`buildCreateOpts`、`createPTCSession`）、命名守护（`NAMING_POLL_MS`、`namingCurrentTitleOf`、`namingHintOf`、`executeNamingOrder`、`reconcileNamingFailure`、`applyNamingFailurePanel`、`namingGuardianKick`、`startNamingGuardianPoll`） | inject（api-io，调用时）、fixateText/renderTemplate（config，调用时）、keyOf（shared:workspaceKey，调用时）、storeOf/emit（store-snapshot，调用时）、evaluateRenameLock/composeDraftTitle/newSessionTitle（shared:namingGuardian，调用时）、namingContentLang（shared:namingTitles，调用时；#1294 起草稿标题的语言由内容表沿语言链选，不再用 promptLang）、timeStampStr（store-derived，调用时）、tr（index）、host/timer/ctx（自由变量） | 交接头与命名守护（#457 由 `api.js` 第 9–327 行拆出，327 行；原序第 320–327 行八行交接按钮注释为保三文件各≤350 留在本文件尾，纯注释行为不变；#787 交接记忆与首条草稿搬进会话 store，模块级 `handoffTs`/`handoffFile`/`pendingDraft`/`pendingDraftTargetSid` 四全局删除） |
| `kernel/api-preset-guard.js`（标记名 `apiPresetGuard`） | 预设守卫（`describeReuseDecision`、`verifyFreshPreset`、`tryQuarantineSession`、`createVerifiedPTCSession`） | getRowPreset/isHealthyPreset（api-naming，调用时） | 预设探针与创建后验编排（#478 由 `api-naming.js` 拆出，防复用闸门关联文件超 350 行粒度） |
| `kernel/api-workspace.js`（标记名 `apiWorkspace`） | 工作区编号查找（`workspacePathOf`、`workspaceIdOf`、`workspaceNormOf`、`workspaceCollectFromSnap`、`workspaceMatchEntry`、`workspaceTryCreateWid`、`resolveWorkspaceEntry`、`archivedSessionIdsOf`） | keyOf（shared:workspaceKey，调用时） | 按目录找工作区编号与按需创建（#636 由 `api-new-session.js` 拆出，防新增超标；命中时编号与登记项同路返回，供复用验归属；#1580 增 `archivedSessionIdsOf` 读归档名单——复用一个空白会话前除“在名单里”还要验“没被归档”，名单读不到时 fail-closed） |
| `kernel/api-handoff.ts`（标记名 `apiHandoff`） | 交接执行（`handoffCwdMatches`、`probeHandoffReady`、`doHandoff`、`doHandoffOpen`） | handoffPrompt（api-naming，调用时）、inject/copyText（api-io，调用时）、buildCreateOpts/createPTCSession（api-naming，调用时）、storeOf（store-snapshot，调用时）、keyOf/wsKeyOf（shared:workspaceKey，调用时）、openTextInNewSession（api-new-session，调用时）、tr（index）、host/timer/ctx（自由变量） | 交接执行（#1251 由 `api-new-session` 拆出：那份文件转成 TypeScript 后有效行超过 350 行的粒度上限，而「交接执行」与「新会话创建」本来就是两件事；拆法与 #636 拆 `api-workspace` 一致，导出名与调用点一个未动。探测交接文档 → 生成交接文档 → 带着交接文档开新会话这条链路都在这里） |
| `kernel/api-new-session.ts`（标记名 `apiNewSession`） | 新会话创建（`openTextInNewSession`，内含薄转发 `ensureWorkspaceId` 调上面的 `resolveWorkspaceEntry`） | resolveWorkspaceEntry（api-workspace，调用时）、inject/copyText（api-io，调用时）、buildCreateOpts/createPTCSession/isReusableBlank（api-naming，调用时）、createVerifiedPTCSession（api-preset-guard，调用时）、namingHintOf/namingCurrentTitleOf/namingGuardianKick（api-naming，调用时）、storeOf/hydrateFromCache/getCachedSnapshot（store-snapshot，调用时）、keyOf/wsKeyOf（shared:workspaceKey，调用时）、tr（index）、host/timer/ctx（自由变量） | 新会话创建（#457 由 `api.js` 第 328–666 行拆出；#636 把工作区查找搬进 `api-workspace`；#1251 把交接执行搬进 `api-handoff`，本文件只剩新会话创建这条主链路；#787 交接记忆、防抖计时住会话 store，目录校验 fail-closed，草稿写目标会话 store；#1580 复用前归档闸门：已归档空白会话不复用、归档名单读不到时 fail-closed、复用日志记在打开之后） |
| `kernel/api-io.js`（标记名 `apiIo`） | 行级打开（`openInNewSession`）、注入复制（`inject`、`openUrl`、`copyText`）、问题详情（`fetchIssueDetail`、`clearIssueDetailCache`、`fetchIssueComments`、`submitIssueComment`）、历史票按页取（`fetchIssuesPage`，走电话 `wf.issuesPage`，日志点 `issues.page`） | openTextInNewSession（api-new-session，调用时）、scheduleActionProbe（probe-auto，调用时）、rowActionText（store-derived，调用时）、newSessionTitle（shared:namingGuardian，调用时）、issueUrlFor（link，调用时）、emit/flash（store-snapshot，调用时）、tr（index）、host（自由变量） | 行级打开与问题详情（#457 由 `api.js` 第 667–852 行拆出，194 行；#690 增 `fetchIssuesPage`——页数据本身住在 `kernel/issue-pages.js`，本文件只负责把那一页要到手并如实回形状） |
| `kernel/issue-pages.js`（标记名 `issuePages`） | 页数据（`ISSUE_PAGE_MAX`、`ISSUE_PAGE_LIMIT`、`issuePageFilterOf`、`issuePageKeyOf`、`issuePageBucketRead`、`issuePageBucketOf`、`issuePageRowsOf`、`issuePageStatOf`、`loadIssuePage`） | idOf/effortOf（shared:constants，调用时）、emit（store-snapshot，调用时）、fetchIssuesPage（api-io，调用时） | 历史票的页数据（#690 新增：按「工作区 + 后端 + 仓库 + 视图 + 筛选」分桶、按票身份去重、静默刷新不清空、内存最多留十页；挂在 `st.issuePages` 上，不落磁盘。单独一片是因为 `store-snapshot.js` 已贴 350 行上限） |
| `kernel/probe-chain.js`（标记名 `probeChain`） | 链自动刷新（`scheduleChainAutoRefresh`、`cancelChainAutoRefresh`）、`loadChain`、链派生（`chainSteps`、`chainStep`、`chainStepStatus`、`chainStepOk`、`chainStepBad`、`readyCount`、`envTotal`、`envLabel`、`setupCheck`）、阻塞者（`openBlockers`、`blockerNames`）、`detectCwd` | getChainCacheKey/getCachedChain/setCachedChain（store-snapshot，调用时）、keyOf（shared:workspaceKey，调用时）、emit（store-snapshot，调用时）、nowStr（probe-snapshot，调用时）、timer/host（自由变量） | 链加载与链派生（#456 由 `probe.js` 第 9–94、96–130 行拆出，130 行） |
| `kernel/probe-snapshot.js`（标记名 `probeSnapshot`） | 快照去重（`pendingSnapshotByCwd`）、时间小函数（`nowStr`、`timeOf`、`timeOfMs`）、`broadcastCfg`、`broadcastLogSwitch`、`rememberSessionWorkspaceRoot`、缓存先出再上报（`cacheFirstThenAttend`）、`loadSnapshot` | flash/hydrateFromCache/applySnapshotSelection/getCwdSync/setCachedSnapshot/storeOf/shared/stores/emit（store，调用时）、keyOf（shared:workspaceKey，调用时）、setPresentationMap（store-switch，调用时）、reportWorkspaceAttention（attention-heartbeat，调用时）、tr（index）、timer/host（自由变量） | 快照差异与快照加载（#456 由 `probe.js` 第 95、131–403 行拆出，283 行；`pendingSnapshotByCwd` 一行随 `loadSnapshot` 归入本文件，原序第 95 行后移，初始化无依赖行为不变。#707：颜色小函数、`diffSnapshots`、`scheduleFlashClear` 搬去 `probe-snapshot-helpers.js`，本文件加一条「先用旧快照铺满、再上报我在看谁」） |
| `kernel/probe-snapshot-helpers.js`（标记名 `probeSnapshotHelpers`） | 颜色小函数（`hexA`、`darken`）、数据层增量差异（`diffSnapshots`）、闪烁高亮清除（`_flashClearPending`、`scheduleFlashClear`） | idOf（shared:constants，调用时）、emit（store-snapshot，调用时）、timer（自由变量） | #707 从 `probe-snapshot.js` 拆出（那个文件当时 349 行，`tests/verify-file-granularity.ts` 上限 350，#707/#708/#709 都还要改它）：搬出来的是与「下载快照」无关的三样小东西，行为一行未改；两个文件同属一个闭包，互相调用不走 import |
| `kernel/probe-auto.js`（标记名 `probeAuto`） | 节拍（`PROBE_MS`、`FOCUS_PROBE_MIN_MS`、`lastFocusProbe`、`_actionProbePending`）、`probeNow`、`scheduleActionProbe`、`startAutoProbe`、只服务活跃工作区的那条探测节拍（`_activeProbeAt`、`startActiveProbeLoop`）、手动刷新（`spinAll`、`refreshAll`）、新鲜度（`SNAP_FRESH_MS`、`snapFresh`） | loadSnapshot/diffSnapshots/scheduleFlashClear（probe-snapshot，调用时）、loadChain（probe-chain，调用时）、flash/touchProbeAt/hydrateFromCache/shared/stores/emit（store，调用时）、keyOf（shared:workspaceKey，调用时）、_attentionPlan/attentionVisible/attentionStoreOf（attention-heartbeat，调用时）、tr（index）、timer/host/document（自由变量） | 自动探测与手动刷新（#456 由 `probe.js` 第 405–634 行拆出，239 行；#707 起这条节拍只探「我正在看的那个工作区根」，间隔由宿主的视野模型给，后台工作区一个定时器都不排） |
| `kernel/attention-heartbeat.js`（标记名 `attentionHeartbeat`） | 窗口标识（`_attentionWindowId`、`attentionWindowId`）、可见性与人类输入（`attentionVisible`、`_attentionHumanAt`、`attentionNoteHuman`）、上报（`reportWorkspaceAttention`、`adoptAttentionPlan`、`attentionRootOf`、`attentionStoreOf`、`attentionKeyOf`）、处境（`_attentionPlan`、`_attentionAckAt`、`ATTENTION_SILENT_MS`、`attentionStandingOf`、`attentionSuspended`）、心跳与监听（`_attentionLastBeatAt`、`attentionBeat`、`startAttentionHeartbeat`、`startAttentionSignals`、`stopAttentionSignals`） | host（自由变量）、log/isEnabled（kernel:log）、wsKeyOf/getCachedSnapshot/hydrateFromCache/shared/stores/emit（store，调用时）、dswsLogHash/dswsLogTrunc（probe-snapshot，调用时）、startActiveProbeLoop（probe-auto，调用时）、tr（index）、timer/document/window（自由变量） | 视野模型的客户端半边（#707 新增：会话切换 / 打开面板 / 窗口获焦时上报一次「我在看谁」；面板可见时每 20 秒一次本地心跳，零配额不出网；窗口标识放 sessionStorage —— 平台不提供窗口身份与焦点信号，放 localStorage 会被同源别的窗口覆盖） |
| `kernel/probe-stale.js`（标记名 `probeStale`） | 在途复用与「这一次回包还算不算数」的判断（#669 第 5 件）：`_snapPendKey`（去重键 = 工作区键 + 后端 id）、`_snapReuseInFlight`（在途复用，含 #366「force 不复用非 force」那条判据）、`_snapMarkRequest`（发文登记：序号 + 这次问的后端 + 在途键）、`_snapRespStale`（回包判两问）、`_snapSeqN`/`_snapLatestByWs`（每把键上最新一次请求的序号） | pendingSnapshotByCwd（probe-snapshot，调用时）、wsKeyOf（shared:workspaceKey，调用时）、hydrateFromCache/emit（store，调用时）、dswsDedupWin（probe-snapshot，调用时）、log/isEnabled（kernel:log）、tr（index） | #669 第 5 件从 `probe-snapshot.js` 拆出（守卫放进去那个文件会到 359 行、超 350 上限）：真机现场是「选 Markdown → 点确认切换 → 没有任何反应」—— 切换前飞着一次强制重取时，绑定成功之后那次重取被按工作区的去重规则复用掉，面板拿回切换前那份快照。两个文件同属一个闭包，互相调用不走 import |
| `kernel/router.ts` | `DECK_NATIVE_TAB_KIND`、`DECK_NATIVE_TYPE_ID`、`DeckSidebarTab`、`DeckNativeTabTitle`、`afterPanelOpened`、`openInNativeRight`、`openPanel`、`togglePanel`、`repoStr`、`withWayfinderPrefix`、`startText`、`newWayfinderText`、`newBugWayfinderText`、`newSpecText`、`panelClock`、`panelNow`、`logPanelStage` | loadSnapshot/hydrateFromCache/snapFresh/getSnapshotVersion/getCachedSnapshot（probe）、renderTemplate（config）、promptText/promptTextFor/NEW_BUG_FIELDS_BODY（prompts）、newWayfinderPrompt/newSpecPrompt/completePrompt/inspectPrompt（promptsBackend）、`uiText`（kernel:locale，取需求描述前缀）、repoUrlFor（link）、keyOf（shared:workspaceKey）、log（kernel:log）、host/timer/ctx（自由变量） | 面板开关 / tab 导航 / 文本生成（#444 按实测移除已不存在的 `SESSION_TITLE_PREFIX`、`newSessionTitle`；2026-09-21 移除 `openPagePanel`、`openDockPanel`、`sidebarTabDisposer`、`sidebarTabRetry`、`ensureSidebarTab`、`openInSidebar` —— 面板只留 DSH 原生右侧边栏一条路；`withWayfinderPrefix` 里那道「前缀开关 = cfg.withWayfinder」已随 #1012 定案第 10 条删除，函数本身保留）。#1294 起三处文本拼接不再按「是不是 en」二选一：需求描述前缀改读词表 `prompt.requirementPrefix`（`uiText`），bug 字段正文由 `NEW_BUG_FIELDS_BODY()` 按语言链自己取，`NEW_BUG_FIELDS_BODY_EN` 随之删除。本文件原先还依赖 `BODY_FORMAT`（#595 为「正文格式」那一节留的常量），随 #725 删掉「正文格式」整节一并退役，依赖里已无它。#1251 起本文件是 TypeScript，同名 .js 是构建产物、不入库 |
| `kernel/entry-card.ts`（标记名 `entryCard`） | 入口浮层两张卡的卡面（#1297）：`ENTRY_CARD_W`（368）、`ENTRY_CARD_H`（232）、`buildEntryCard(kind)`（kind='map' 探索地图 / 'spec' 实施地图，返回一段 svg）；`entryBodyLines(text)`（把主体文本按词断成 ≤3 行、每行 ≤12 个汉字，门禁直接 import 它核对） | tr（index，取词表 `card.entry.*`）、`CONTAINER_ACCENT`（kernel:containerView，取身份色）、h（React，调用时） | #1297 新建。卡面 368×232：左上 184×116 插图底板、右侧三层文字（眉标 11px 卡色半透明 / 状态句 17px 700 / 主体文本 12px 行高 17）、底部 344×80 技能链。卡面所有文字都走 `card.entry.*` 词条（真源 config/copy/cards.yaml），源码里不硬写文案；主体文本靠宽度自动换行、不写死行数。文件头是「模块真源」形态，typecheck 时用 declare 声明闭包环境 |
| `kernel/entry-choice.ts`（标记名 `entryChoice`） | 入口浮层与两处接线的共用拼装（#1297）：`ENTRY_CHOOSER_WIDTH`（392，面板那一处竖排两张卡的浮层宽）、`ENTRY_CHOOSER_WIDE`（769，状态栏那一处横排两张卡的浮层宽）、`entryChooserOpen(st, from, el)`（from='panel' 从面板页签行那颗按钮正下方往下弹、两张卡竖排；'statusbar' 从底部胶囊那颗按钮正上方往上弹、两张卡横排；再点同一入口即关）、`entryChooserClose(st)`、`EntryChooser`（组件，读 store 里的 `entryOpen`/`entryFrom`/`entryPos`，默认展开两张卡、无自动分流、无推荐标记） | buildEntryCard（kernel:entryCard）、newWayfinderText/newSpecText（kernel:router，两张卡的开场白）、newSessionTitleNew/openTextInNewSession（apiNewSession）、PortalOverlay（kernel:portal）、tr/log/isEnabled（kernel:locale / kernel:log）、h/React（调用时） | #1297 新建。两处宿主（面板页签行右端、状态栏胶囊悬停菜单）都只放一颗「新建需求」按钮、都挂这同一个组件，点开的浮层与两张卡逐字相同；选卡后的开场白只在 `pickEntry` 里拼一次：map 卡 → `newWayfinderText(st)`，spec 卡 → `newSpecText(st)`。位置规则两处一致：左右先与触发按钮的左沿对齐，右边空间不够时把浮层右沿顶到屏幕右侧（留 8px），免得跑出屏幕。键盘 Esc 关、↑↓←→/Tab 换卡、Enter/Space 选定；点浮层外关闭。日志两条（常驻 #116 `entry.open`、#117 `entry.pick`）；状态住 store（`entryOpen`/`entryFrom`/`entryPos`），因为状态栏悬停菜单一关就整段卸载，浮层不能跟着没 |
| `kernel/builtin-backends.js`（标记名 `backendList`） | `BUILTIN_BACKENDS`、`builtinLabelOf`、`otherFiltered`、`firstBackendIdOf`、`repositoryActionOf`、`moduleMetaOf` | 无 | 内置后端显示名单单源（#231 类别 5 收编）；注意文件名与标记名不同，标记为 `// ==== kernel:backendList (spliced by build) ====` |
| `kernel/link.js` | `issueUrlFor`、`openIssueUrl`、`searchUrlFor`、`repoUrlFor`、`issueRefNumbersFrom` | 无（调用时收 `st`/`host`） | 问题链接与搜索链接纯函数 |
| `kernel/actions.js` | `createActionDispatcher`、`ACTIONS_VERSION` | 闭包内 `host`/`store`/`probe`（调用时） | 动作分发器（表单提交、注入、开链接、刷新） |
| `kernel/slots.js` | `SLOTS_KERNEL_VERSION`、`SLOT_DEFS_KERNEL`、`MODAL_SEAT_ID`、`orderOf`、`isScopeValid`、`canDeclareIn`、`shouldShowInModal`、`isModalAction`、`getWizardAction`、`getFormAction`、`getModalAction`、`getWizardSteps` | 无 | 五个内部端口声明与向导动作判断（寄生官方父槽，随父坍缩回收） |
| `kernel/slotRenderer-queue.js`（标记名 `slotRendererQueue`） | `SLOT_RENDERER_VERSION`、`ensureFormModal`、`openFormModal`、`closeFormModal`、`createModalRenderForm`、`canOpenModalForStep`、`canOpenWizardForStep` | flash（store，调用时） | 槽位渲染器之队列与开关 + 打开入口与守门（#454 由 `slotRenderer.js` 拆出；`createModalRenderForm` 为 `openFormModal` 别名，守门寄放本文件以保 modal-view 单文件达标） |
| `kernel/slotRenderer-repo-sync.js`（标记名 `slotRendererRepoSync`） | `startRepoSync`、`finishRepoSync`、`retryRepoSync` | flash（store，调用时）、`repoUrlFor`（link，调用时） | 槽位渲染器之仓库同步流程与失败文案（#454 由 `slotRenderer.js` 拆出；`retryPushFlow` 等内部 helpers 同文件） |
| `kernel/slotRenderer-modal-view.js`（标记名 `slotRendererModalView`） | `FormModalSeat` | flash（store，调用时）、`repoUrlFor`（link，调用时） | 槽位渲染器之弹窗本体（#454 由 `slotRenderer.js` 拆出；348 行组件独占一文件，头注释仅一行以保 350 行门槛，后续增行须再拆） |

## 提示词真源与语言清单（#1292 · 2026-10-20）

这一节说清三件事：提示词文本写在哪里、语言清单写在哪里、以及模板上那个 `use` 字段为什么不进客户端产物。

### 提示词文本

用户看到的每一条提示词的正文，其唯一真源是 `config/prompts/` 下的 YAML 文件：

| 文件 | 里面是哪一组模板 |
|---|---|
| `config/prompts/workspace-initialization.yaml` | 工作区初始化（`setupRun`、`switchAlign`、`switchLayout`） |
| `config/prompts/repository-alignment.yaml` | 仓库与凭据对齐（`installSkillsFix`、`installSkills`） |
| `config/prompts/map-advancement.yaml` | 地图推进（`mapExecute`、`complete`、`fixate`、`mapInspect`、`healthCheck`、`specExecute`、`specComplete`、`specSplit`） |
| `config/prompts/ticket-action-templates.yaml` | 票面动作模板（`tpl.*` 共十一条） |
| `config/prompts/ticket-creation.yaml` | 建票入口（`newWayfinder`、`newSpec`、`newBugWayfinder`），另住两处片段 `newBugFields`、`newWayfinderWiring` |

三处片段（`newBugFields`、`newWayfinderWiring`、`vocabularyDefaults`）不是完整模板，是模板正文里替换进去的一段话。它们不单独占一份文件，而是按同一把尺子——「什么时候注入」——住在对应族的那份 YAML 里：`newBugFields` 与 `newWayfinderWiring` 跟着建票入口住在 `ticket-creation.yaml`；`vocabularyDefaults` 是 `{cli}` / `{cliBrand}` 两个占位符的兜底说法，跟着 `installSkills` 住在 `repository-alignment.yaml`。所以一份族文件里的顶层键 = 这一族的模板 id + 片段 id。

跨族公共小节是另一类东西：它不属于任何一族，是「同一段正文被好几个族的模板引用」时只写一遍的存放处。今天有两节，都住在 `config/prompts/shared-sections.yaml`：`sharedTools`（每个带工具节的模板末尾那三条：优先用 `deck_` 工具、及时用 `deck_issue_report` 上报、回复前按 `/ask-matt` 规则调 `suggest_next_steps`，20 个模板引用）与 `investigation`（「## 调查（建议先查后问）」那四条：先查后问、复用既有笔记、既有笔记答不了再按 `/research` 新查一次、提问前说明已查阅范围，10 个模板引用）。模板正文里写的是标记 `{{shared:sharedTools}}` / `{{shared:investigation}}`，`readPromptConfig` 读配置时把它展开成对应语言的正文。为什么单独一份：族的划分是「什么时候注入」，公共小节不属于任何时机；混进族文件会让「按注入时机分族」失真，而 20 个模板各抄一遍又会在改文案时漏掉某几处。新增一节的做法是「在 `shared-sections.yaml` 里加一条，同步补 `scripts/lib/prompt-config.mts` 的 `PROMPT_SHARED_SECTION_IDS`」。

登录引导不在这张表里：`ghAuthLogin` 这条模板 2026-10-21 已删除，用户可见的登录指引只由 GitHub 后端自己声明（`src/tracker/rooms/github/index.ts` 的 `prompts.ghAuthLogin`），客户端按「后端声明优先、注册表模板兜底」的既有链路取文案；今天只有 GitHub 会触发 `gh:authed`，所以兜底那一格不再需要自己的正文。

源码里不再有提示词的字面量。`scripts/generate-prompt-config.mts` 读上面这五份族 YAML、跨族公共小节 YAML 与 `config/languages.yaml`，写出 `src/client/kernel/prompt-data.ts`——这份是构建期现场生成的产物，不入库；客户端闭包从 `kernel/prompt-data.ts` 那一片拿到三个运行时名字：`PROMPT_TEMPLATE_DATA`（模板全表）、`PROMPT_FRAGMENT_DATA`（片段全表）、`LANGUAGES_YAML`（语言清单）。每条模板在产物里的形状是 `{ version, placeholders, zh, en }`；`use`（「这条模板什么时候用」的一句人话）只住在 YAML 里给读代码的人看，不进产物。

改文案的流程只有两步：

1. 改 `config/prompts/` 下的 YAML。不要改 `src/client/kernel/prompt-data.ts`，那份是生成物，改了会被下次生成覆盖。
2. 跑 `node scripts/generate-prompt-config.mts` 重算，然后跟 YAML 一起提交。

漏掉第二步会被门禁当场抓住。`npm run typecheck` 的第一条命令就是 `node scripts/generate-prompt-config.mts --check`，它只比对不写，发现产物与 YAML 对不上就打印

```
FAIL 生成源码与 config/ 下的 YAML 对不上：请先跑生成器 —— node scripts/generate-prompt-config.mts（重算后再提交）
```

并以退出码 1 停下，类型检查根本轮不到跑。所以「改了 YAML 忘了重算」进不了主干。

改提示词的骨架（增删一条模板、增删一个占位符）比改文案多一步：还要同步改 `scripts/lib/prompt-config.mts` 里的 `PROMPT_TEMPLATE_IDS`（二十七条模板的 id、占位符与所属族）与 `PROMPT_FRAGMENT_IDS`（三处片段的 id 与形状）。增删公共小节时改的是同一份文件里的 `PROMPT_SHARED_SECTION_IDS`，并同步改 `config/prompts/shared-sections.yaml`。那几份清单是真值表，生成器与门禁都按它们校验 YAML 的字段——只改 YAML 不改清单会被 `validatePromptData` 判红。

### 语言清单

语言清单的唯一真源是 `config/languages.yaml`：里面写着支持哪些语言、缺省是哪种、以及每种语言的回退链（这门语言没写时接着找哪一门）。提示词侧与界面侧共用这一份，不许在界面侧另抄一份语言名单。客户端闭包里的运行时入口是 `promptLanguages()`（住在 `kernel/prompts.ts`，返回值就是生成物里的 `LANGUAGES_YAML`）。它今天只有一个调用方：`promptLang()` 按语言清单定下这一次渲染用哪门语言 —— #1294 起「当前是哪门语言」由 `kernel/locale.ts` 的 `uiLang()` 统一回答（DSH 语言快照的主标签对齐清单里的键，不在清单里就用缺省语言），`promptLang()` 只转一道、返回语言代码字符串；至于「这门语言到底有没有正文」，由 `promptText` / `promptFragment` 沿语言链（`langChainOf()` 往回退）逐门找第一份非空正文来回答。`fallback: []` 表示这门语言没有上一级可退，是回退链的终点。今天每门最多写一条退路（运行时只认 `fallback` 的第一项），多写的项不生效、校验层会直接判红 —— 要一次退多门，得先把运行时改成沿列表逐项尝试。语言快照本身读不到时（`getSnapshot()` 返回 null、服务没装这个方法、或它抛异常）一律按清单的 `default` 定，不会掉进写死的某一门。

### `use` 字段

YAML 里每条模板除了 `version`、`placeholders`、`zh`、`en`，还带一句 `use`，写的是「这条模板什么时候用」，给读代码的人看。它只住在 YAML 里，不进客户端产物 `src/client/kernel/prompt-data.ts`。理由很简单：`use` 不是发给用户看的文案，用户永远看不到它；把它打进客户端产物既白占体积，又会让人误以为界面上有个地方在显示它。

## 界面词表真源与语言清单（#1294 · 2026-10-20）

这一节说清三件事：界面文案写在哪里、它怎么变成客户端能读的数据、客户端注册语言时按什么清单走。

### 真源：十份词族 YAML

界面词表按用途分成十族，一族一份 YAML，住在 `config/copy/` 下，文件名就是族名：

| 文件 | 装的是哪一族（今天每门语言的键数） |
|---|---|
| `config/copy/panel.yaml` | 导航、面板、横幅、环境检查、初始化引导（275） |
| `config/copy/flow.yaml` | 动作、类型、列表、配置、详情、地图、提示（235） |
| `config/copy/word.yaml` | 技能、检查、浮层、命名、切换、进度、错误、模板、运行（189） |
| `config/copy/vcwrite.yaml` | 版本管理写回（102） |
| `config/copy/pages.yaml` | 历史票按需翻页（70） |
| `config/copy/labels.yaml` | 标签配色弹窗（51） |
| `config/copy/cards.yaml` | 卡片动作与阻塞提示，以及入口浮层的两张卡（52） |
| `config/copy/skilldesc.yaml` | 技能描述（27） |
| `config/copy/skilldetail.yaml` | 技能详情（26） |
| `config/copy/spec.yaml` | 规格正文（17） |

每份 YAML 的顶层是语言 id（今天 `zh` / `en`），语言段下面是平铺的「词条键 → 文案」。同一门语言里每个键都要有；值里的 `{name}` 是占位符，同一个键的中英两份占位符必须一字不差。生成器读的时候会校验：语言段缺失或越界、键缺了或多写了、值不是字符串、占位符对不上、跨族有重复键、`{{时间参数}}` 的名字写错、空词族、族名不合法 —— 任何一条都直接报错、不写产物。

语言清单仍是 `config/languages.yaml`，与提示词侧共用同一份（见上一节末尾「语言清单」）：今天缺省语言是 `zh`，`en` 缺内容时退到 `zh`。

### 生成物：`src/client/kernel/locale-data.ts`

`scripts/generate-locale-config.mts` 读这十份 YAML 与 `config/languages.yaml`，写出 `src/client/kernel/locale-data.ts`。这份是构建期现场生成的产物，不入库（`.gitignore` 里登记了），人手不改：要改文案只能改 YAML 再跑生成器，手改生成物下一次生成会被覆盖、`--check` 也会判红。

生成物里带四类东西：

- 语言清单 `LANG_CONFIG`（缺省语言 + 每门语言的 label 与 fallback）与语言 id 列表 `LOCALE_LANGS`；
- 全词表 `LOCALE_COPY`（语言 id → 词条键 → 文案，只读）；
- 十族常量 `L_PANEL` / `L_FLOW` / `L_WORD` / `L_VCWRITE` / `L_PAGES` / `L_LABELS` / `L_CARDS` / `L_SKILLDESC` / `L_SKILLDETAIL` / `L_SPEC`；
- 键名联合类型：每族一个 `LocaleKey<族名>`，全族一个 `LocaleKey`。

键名联合类型是编译期约束：哪门语言漏了一条文案，生成物就对不上、`npm run typecheck` 当场红，不用等运行时界面露出键名。今天每门语言 1046 个键（各族键数见上表）。

改文案的流程只有两步：改 YAML → 跑 `node scripts/generate-locale-config.mts`，然后跟 YAML 一起提交。漏了第二步会被 `npm run typecheck` 的第一条命令 `node scripts/generate-locale-config.mts --check` 抓住：它只比对不写，对不上就打印

```
FAIL 生成源码与 config/ 下的 YAML 对不上：请先跑生成器 —— node scripts/generate-locale-config.mts（重算后再提交）
```

并以退出码 1 停下。全新检出、盘上还没有生成物时，`--check` 会先按 YAML 现场生成一份再判过，不让新机器第一次 typecheck 永远先红。

### 拼装顺序与客户端怎么用

`scripts/build.mts` 的 `KERNEL_MODULES` 里 `kernel:localeData` 排在 `kernel:locale` 之前，两片都拼进同一个 apply 闭包；所以 `locale.ts` 能直接用生成物里的 `LOCALE_COPY` / `LANG_CONFIG` / `LOCALE_LANGS`，客户端闭包里不写 module 级 import。构建拼装之前会先起生成器（生成器排在 time-config 之后：词表里的 `{{时间参数}}` 要拿时间参数生成物烘成字面量）。

`src/client/kernel/locale.ts` 取代原来的十份片段，导出十个名字：`L`（`LOCALE_COPY` 的只读别名）、`languageIds`、`localeMainTagOf`、`langChainFrom`、`langChainOf`、`uiLang`、`pickLangText`、`uiText`、`languageLabelOf`、`localeAdopt`。它按语言清单算当前界面语言与回退链（从宿主语言快照 `active` 的主标签出发，例如 `zh-CN` 按 `zh` 匹配），并给界面提供 `uiText` 这类取词助手。

`src/client/index.ts` 的注册段是：

```ts
const localeSvc = ctx.get('locale')
if (localeSvc && typeof localeSvc.register === 'function') {
  ctx.effect(function () {
    return localeAdopt(localeSvc)
  }, 'dsws: locale')
}
```

`localeAdopt` 读宿主语言快照、把宿主还没有的语言按回退深度排好逐个 `addLanguage`、再对清单里每门语言 `register('dsws', 语言 id, 该语言词表)`，最后返回清理函数交给 `ctx.effect`（卸载时把注册全撤掉）。加一门语言只改 YAML、不改这段代码。`tr` 仍由 `localeSvc.bind('dsws')` 绑定。

这一趟的日志走同文件的 `localeLogEmit` 发射壳（它把级别与事件名当参数透传给日志模块、按 `queueMicrotask` 晚一拍再写）；事件名是 `locale.registration`（信息、按需）与 `locale.registration.fail`（告警、常驻），台账见 `research/489-appendix.md` 的 #112 / #113。

### 门禁

测试侧读生成物的唯一入口是 `tests/lib/locale-data.ts`（`ensureLocaleData`、`familySectionSource` 等；族清单按 `config/copy/` 目录自动发现，不读手写清单）。`tests/verify-locale-config.ts` 守配置这一侧九件事：生成器 `--check` 必须绿；YAML 自校验不报问题；校验器对八类坏数据真会红（在内存里演练、不写盘）；生成物与 YAML 逐键相等；生成物结构契约（段头、键名联合类型、族常量、合并段）；词族清单按目录自动发现；语言清单驱动注册、代码里不写死 `zh` / `en`；`src/` 下手写 TypeScript 里清零「按语言二选一」的写法；旧片段不并存（`src/client/kernel/` 下不再有 `locale-<族>.ts`）。`tests/verify-locale-completeness.ts` 守完整性与双语覆盖。另有一条棘轮：每门语言的键数下限是 1030，只许增不许减。两条门禁都已进 `scripts/verify-stages.json` 的分段清单。

## 正文格式契约（#595 立的，#725 拆掉的一节）

> 背景：插件会把动作提示词注入到「使用本插件的人」自己的工作区里，所以提示词里出现的每一条命令，
> 使用者都会看到、也可能照着执行。此前 GitHub 专用的正文写回步骤（先确认 `gh` 已登录、再找插件安装目录、
> 最后调安装目录下的写回脚本）被字面抄进了 11 个提示词条目（中英各一份，共 22 份），用本地 Markdown
> 后端的人（单据就是他自己工作区里的一个 Markdown 文件）也会看到这些完全用不上的命令；
> 当时的门禁还反过来要求这些字面副本必须存在，改一处要改 22 处。

**今天这一节已经作废（#725 · 2026-09-24）。** 提交 `7cc216d3`「提示词去掉正文格式与进度两套契约：票的读写交给工具，进度与关票交回给 AI」把「## 正文格式」整节从提示词里删掉，连带删掉 `bodyFormatDefault` / `bodyFormatText` / `BODY_FORMAT` 三个导出，并把 `kernel/config.ts` 的 `TPL_BACKEND_MARKERS` 清成空数组。下面五条保留 #595 当时立下的口径，是历史沿革，不是今天的契约。

1. **正文格式文案由跟踪器后端各自声明。** 每个后端在自己的 `prompts.bodyFormat` 里写清「它这套单据的正文怎么写、怎么写回」：GitHub 声明原来的两步写回（先确认登录，再调安装目录下的写回脚本）；本地 Markdown 声明「这张单据就是本机的一个 Markdown 文件，直接用编辑工具改，不需要登录远端账号、不需要找插件目录、不需要跑写回脚本、也没有 ok 回包可等」；GitLab 写泛指版（用后端自己的命令行把整个文件读进去，不写未经查证的具体命令）。
2. **模板里只留标记 `{bodyFormat}`。** 10 个模板条目（`mapExecute`、`complete`、`fixate`、六个 `tpl.*`、`mapInspect`）都不再出现任何字面文案，只保留 `{bodyFormat}` 占位符，并把这个占位符登记进各自的 `placeholders`。
3. **渲染时按当前工作区选中的后端填空。** `kernel/prompts.ts` 新增的 6 个导出就是这条链路的全部入口（当时这个文件还叫 `kernel/prompts.js`）：`currentBackendId(st)` 取当前工作区选中的后端；`backendPromptFrom(modules, backendId, key)` 从后端声明里取一段文案；`bodyFormatDefault()` 是查不到后端声明时用的通用兜底版；`bodyFormatText(st)` 按当前后端与当前语言选出这段正文格式文案；`backendParamsFor(st, params)` 把 `bodyFormat`（以及走同一套后端声明通道的 `subIssue`）填进参数表；`promptTextFor(st, id, params)` 是「按当前后端渲染某个条目」的统一入口。全部调用点（行级动作按钮、建图与新增 BUG、map 新会话、模板引擎 `renderTemplate`）统一把当前工作区状态 `st` 带下去。两个边角口径：后端只声明了一种语言时，按另一种语言渲染，不落空串（整节不许静默消失）；当前后端拿不到 `bodyFormat` 声明（快照没带后端模块、或模块没声明这一栏）时，除落通用兜底版外还给用户一次可见提示（每个后端只提示一次），不让远端后端静默丢掉写回步骤——宿主侧另有兜底：磁盘缓存命中时用当前注册表重挂 `backendModules`，旧版本写的缓存不会再漏掉 `prompts`。
4. **标记机制由 `TPL_BACKEND_MARKERS` 登记。** `kernel/config.ts` 的 `TPL_BACKEND_MARKERS` 当时的值是 `['bodyFormat']`，说明「哪些标记的内容来自后端声明，而不是模板作者手写在模板里」；模板校验据此放行这类标记。
5. **门禁按渲染结果断言，不按源码字面量断言。** `tests/verify-prompts.ts` 用同一段源码求值出真正的渲染函数，再配上从三个后端源码里机械求值出的声明文本，逐条渲染 10 个模板条目 × 中文/英文：GitHub 版必须仍含完整的两步写回（第 ① 步的 `dsh plugin` 带 `--profile` —— 那是 `dsh` 的必填选项，省了照抄就报错；中文占位符写 `<配置名>`、英文写 `<profile>`）；Markdown 与 GitLab 版不得出现 `gh auth`、`fix-issue-body`、`dsh plugin`，也不得引用写回脚本；另有一条卡「模板里不得残留这些 GitHub 专用字面副本」。

引入票：本仓库把这次改动登记为 **#595**（改动落在提交 `ff88b5b`）。该提交当时把票号写作 `#594`——那是提交时预期、最终并没有用到的编号（#594 后来被另一张与本问题无关的票占用了）；后续提交已把源码注释、门禁断言与测试注释里的引用全部纠正为 **#595**，`#594` 只保留在它自己那张票的验收文件里（那份验收文件 `tests/verify-594-deckmap-tab.js` 后来随面板入口退役一并删掉，今天仓库里已经找不到它了）。

今天留下的东西（#725 之后）：

- `bodyFormatDefault` / `bodyFormatText` / `BODY_FORMAT` 三个导出在 `src/` 全树已不存在；`kernel/router.ts` 原先依赖的 `BODY_FORMAT` 也没了。
- `kernel/config.ts` 的 `TPL_BACKEND_MARKERS` 是空数组 `[]`。
- 「按当前后端渲染一条提示词」那一族没有随 #725 消失，它改名住在 `kernel/prompts-backend.ts`（#1292 由 `kernel/prompts.ts` 拆出，避 350 行上限）：`currentBackendId` / `backendPromptFrom` / `declaredLangPick` / `backendParamsFor` / `promptTextFor` / `newWayfinderPrompt` / `newSpecPrompt` / `completePrompt` / `inspectPrompt` / `MATT_REPO` / `MAP_EXECUTE_PROMPT` / `COMPLETE_PROMPT` / `FIXATE_PROMPT`。今天这一族填的占位符是 `{subIssue}`（后端声明的子议题关联方式）、`{subject}`（后端声明的体检科目）、`{cli}` 与 `{cliBrand}`（后端词表里的命令行名与站点名，#716），不再有 `{bodyFormat}`。
- 门禁里留着反向断言：`tests/verify-prompts.ts` 会判红「注册表不该再有 bodyFormat 条目」「模板仍带 `{bodyFormat}` 标记」「模板仍声明占位符 `{bodyFormat}`」「渲染入口仍暴露 `BODY_FORMAT`」「后端仍声明 `prompts.bodyFormat`」，也会判红「提示词里不该再出现「## 正文格式」段」。

## 边界裁定（G3 Q3 · #91 拍板）

- **同层共享组件放 `views/shared/`**，不塞 kernel —— kernel 只放宿主桥与状态原语（T4 叶子迁移时落地）。
- kernel/ctx/index 是「并发时默认冻结」层：只允许一个 session（conductor）碰（对抗审查修正：这是契约不是物理隔离，接口必须先冻结再放叶子并行）。
- 模块间在源码层**不互 import**（同层禁互 import 边界）：闭包拼接机制下依赖经闭包变量解析，模块文件之间零 import 边 —— 这是本仓库「文本组合」构建模式的显式边界，接口以本表为准。

## 验收挂钩

- 每迁一个模块：`node scripts/build.mts` + verify-* 全绿（基线 34/35，唯一失败 verify-detail-levels 为预存环境数据漂移）+ smoke 3/3。
- `tests/verify-kernel.ts`：kernel 文件存在性 + 导出齐全 + 双产物已拼接（一源两物）断言。
