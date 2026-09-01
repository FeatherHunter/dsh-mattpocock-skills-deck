# 内核接口冻结清单（kernel contract）

> 状态：✅ 已冻结（G3 · issue #91 拍板 · 2026-08-21；T3 · issue #96 落盘）
> 用途：阶段 2 内核迁移（T3）的接口基准 —— kernel/* 各模块对外导出表；「同层禁互 import」边界裁定。
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

## kernel/* 模块对外接口表（T3 迁移后 · 每模块一文件）

> 迁移顺序（按依赖 · issue #96 Notes）：locale → prompts → icons → styles → store → api → probe → router → config；
> 实际按物理位置与依赖综合串行迁移，每迁一个模块 build + verify-* 全绿再迁下一个。
> 消费方式：模块代码经构建拼回 apply 闭包内原位，闭包变量互相可见（函数调用时才解析引用）；
> 模块文件顶层仅导出声明的常量/函数/纯数据（可被 verify 测试直接 import）。

| 模块文件 | 导出（接口） | 依赖（闭包内引用） | 说明 |
|---|---|---|---|
| `kernel/locale.js` | `L`（zh/en 字典） | 无 | tr 绑定（`localeSvc.bind('dsws')`）由 index.js 装配；字典为唯一真源，verify-t3-locale 契约 |
| `kernel/prompts.js` | `PROMPTS`、`promptLang`、`promptText`、`SETUP_DEFAULT_PROMPT_KEYS`、`setupRunParamsFrom`、`setupRunPrompt`、`MATT_REPO`、`MAP_EXECUTE_PROMPT`、`COMPLETE_PROMPT`、`BODY_FORMAT`、`NEW_BUG_FIELDS_BODY`、`NEW_BUG_FIELDS_BODY_EN`、`completePrompt`、`FIXATE_PROMPT` | localeSvc（promptLang）、L/locale 字典与 L 兜底（setupRunParamsFrom）、repoStr（router，调用时） | PROMPTS 注册表契约见 tests/verify-prompts.js；setupRun 占位符由后端声明键（BackendModule.setupPrompt → wf.registry）经 setupRunParamsFrom 填充（#230 · D10 键入 locale，2026-08-28 生效；#230 已删 setupTrackerLine/Choice/BackendNote 三函数） |
| `kernel/icons.js` | `ICON_SCHEMES`、`WORD_SCHEMES`、`Icon`、`Ic` | h（React.createElement 自由变量） | 通用图标集（统一 SVG stroke 风格） |
| `kernel/styles.js` | `STYLE_TEXT` | 无 | 样式唯一真源；index 标记处保留 `styles.insert(STYLE_TEXT)` 调用 |
| `kernel/portal.js` | `RDOM`、`portalTop`、`PortalOverlay` | h（自由变量）、`ReactDOM`/`window.ReactDOM`/`require('react-dom')`/`document.body` | 挂顶底座（#380 抽离，平台抽象层，与 styles 同级）；RDOM 三路探测取不到为 null，portalTop 挂 document.body 取不到退化原地不抛，PortalOverlay 统一经 portalTop 挂顶（issue #3 / #22 同理） |
| `kernel/config.js` | `CFG_KEY`、`cfg`、`saveCfg`、`TPL_KEY`、`templates`、`saveTemplates`、`migrateStartCfg`、`PH`、`TPL_PH`、`TPL_REQUIRED`、`TPL_DEFAULT`、`tplText`、`renderTemplate`、`validateTemplate`、`fixateText` | promptText（prompts） | 配置/模板持久化 + 动作模板引擎（T1 规格 §2-§4）；migrateStartCfg() 调用随模块 |
| `kernel/store.js` | `DEFAULT_PANEL_H`、`listPrefs`、`saveListPrefs`、`labelClicks`、`saveLabelClicks`、issuePath 全家（loadIssuePathMap / saveIssuePathMapNow / persistIssuePath / ensureIssuePath / recordIssuePath / reanchorIssuePath / clearIssuePath / pollIssuePathHost / startIssuePathPoll）、noRepo 状态机（cwdHash / noRepoDismissKey / isNoRepoDismissed / setNoRepoDismissed / cwdBasename / isNoRepoNameValid / ensureNoRepoCard）、`makeStore`、`shared`、`stores`、缓存（snapshotByCwd / getCachedSnapshot / setCachedSnapshot / hydrateFromCache / getCwdSync）、`storeOf`、`emit`、`sub`、`useStore`、`NOTICE_COLOR`、`noticeIcon`、`flash`、`compute`、`frontierAll`、`openIssuesOf`、`isOccupied`、`occCount`、`frontierCount`、`hasLabelOf`、`bugCount`、`triageCount`、`buildColorOf`、`isLightHex`、`actionColorOf`、`rowActionText`、`mkRowAction`、`timeStampStr` | tr（index）、renderTemplate/startText（config/router，调用时） | 会话级状态 + 派生统计 + issuePath 轨迹 + noRepo 红卡状态机 |
| `kernel/api.js` | `injectFixate`、`handoffTs`、`handoffFile`、`handoffPrompt`、`extractHandoffFile`、`handoffReadText`、`pendingDraft`、`pendingDraftTargetSid`、`probeHandoffReady`、`doHandoff`、`doHandoffOpen`、`openTextInNewSession`、`openInNewSession`、`extractIssueRefs`、`inject`、`openUrl`、`copyText` | recordIssuePath（store）、scheduleActionProbe（probe）、tr（index） | host 桥 + 复制/注入 + 交接 + 新会话 |
| `kernel/probe.js` | `loadChain`、`chainSteps`、`chainStep`、`chainStepStatus`、`chainStepOk`、`chainStepBad`、`readyCount`、`envTotal`、`envLabel`、`setupCheck`、`openBlockers`、`blockerNames`、`detectCwd`、`hexA`、`darken`、`nowStr`、`timeOf`、`broadcastCfg`、`diffSnapshots`、`scheduleFlashClear`、`loadSnapshot`、`PROBE_MS`、`FOCUS_PROBE_MIN_MS`、`probeNow`、`scheduleActionProbe`、`startAutoProbe`、`spinAll`、`refreshAll`、`SNAP_FRESH_MS`、`snapFresh` | store（flash/hydrateFromCache/storeOf/shared/stores/emit）、tr（index）、host（自由变量） | 检查链快照派生（#284 起九格目录视图退役，原 CHECKS_TOTAL/loadChecks/activeChecks 已移除）+ 快照 + 自动探测 + 手动刷新 |
| `kernel/router.js` | `openPagePanel`、`openDockPanel`、`openInSidebar`、`openPanel`、`togglePanel`、`ensureSidebarTab`、`sidebarTabDisposer`、`sidebarTabRetry`、`repoStr`、`withWayfinderPrefix`、`startText`、`SESSION_TITLE_PREFIX`、`newSessionTitle`、`newWayfinderText`、`newBugWayfinderText` | cfg（config）、loadSnapshot/hydrateFromCache/snapFresh（probe）、renderTemplate/completePrompt/BODY_FORMAT/MAP_EXECUTE_PROMPT/promptText（config/prompts） | 面板开关 / tab 导航 / 文本生成 |

## 边界裁定（G3 Q3 · #91 拍板）

- **同层共享组件放 `views/shared/`**，不塞 kernel —— kernel 只放宿主桥与状态原语（T4 叶子迁移时落地）。
- kernel/ctx/index 是「并发时默认冻结」层：只允许一个 session（conductor）碰（对抗审查修正：这是契约不是物理隔离，接口必须先冻结再放叶子并行）。
- 模块间在源码层**不互 import**（同层禁互 import 边界）：闭包拼接机制下依赖经闭包变量解析，模块文件之间零 import 边 —— 这是本仓库「文本组合」构建模式的显式边界，接口以本表为准。

## 验收挂钩

- 每迁一个模块：`node scripts/build.mjs` + verify-* 全绿（基线 34/35，唯一失败 verify-detail-levels 为预存环境数据漂移）+ smoke 3/3。
- `tests/verify-kernel.js`：kernel 文件存在性 + 导出齐全 + 双产物已拼接（一源两物）断言。
