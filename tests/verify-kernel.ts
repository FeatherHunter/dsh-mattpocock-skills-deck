// verify-kernel.ts — dsh-mattpocock-skills-deck 阶段 2 内核迁移（#96 T3）：kernel 契约验证（#444 对齐后基准 + #454 K1 拆分 + #455 K2 拆分 + #456 K3 拆分 + #457 K4 拆分 + #458 K5 拆分 + #621 localeLabels 增补 + #636 api-workspace 拆分）
// 验证：
//   1) 构建产物（_dev client.js / _pkg package/lib/client.js）已拼接全部模块（一源两物 · 无标记残留）
//      —— 2026-10-17 记实：这半边已由 tests/verify-log-artifacts.ts:62-64 用整行正则接手，覆盖面更宽、
//         也比这里的裸子串更准（产物里 ``kernel:… (spliced`` 子串有两处是 update 模块正则里的巧合文本）。
//   2) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；与 verify-ctx 同口径）
//      —— 这半边今天仍是本门禁独有：38 个 kernel 源「改了没重建」只有这里拦得住。
//   MODULES 里的 exports 列是档案数据（全仓没有任何判据读它，也不许在这里补出导出断言：那是加严，
//   会让今天绿的树变红，且违背维护者已删掉「读源码文本钉形状」这类断言的决定）。
// 用法: node tests/verify-kernel.ts（在插件根目录；先运行 node scripts/build.mts 生成产物）
const fs = require('fs')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 产物新鲜度判据全仓只有一份：scripts/lib/build-cache.mts 的 judgeProducts（#1326）。
// 缓存可用时比「产物内容摘要 vs 上次成功构建记录」；缓存不可用时回落按修改时间判断，
// 回落原因用 INFO 行打出来（判绿也打，不静默），失败文案直接用判据给的原因。
const { judgeProducts, reportJudgements } = require('../scripts/lib/build-cache.mts')
const PRODUCTS = ['client.js', 'package/lib/client.js']
const MODULES = [
  { name: 'styles', exports: ['STYLE_TEXT'] },
  { name: 'motion', exports: ['MOTION'] }, // #1236：界面动效时长统一在 kernel/motion.ts
  { name: 'portal', exports: ['RDOM', 'portalTop', 'PortalOverlay'] },
  { name: 'localePanel', file: 'locale-panel', exports: ['L_PANEL'] },
  { name: 'localeFlow', file: 'locale-flow', exports: ['L_FLOW'] },
  { name: 'localeWord', file: 'locale-word', exports: ['L_WORD'] },
  { name: 'localeLabels', file: 'locale-labels', exports: ['L_LABELS'] },
  { name: 'localePages', file: 'locale-pages', exports: ['L_PAGES'] },
  { name: 'localeVcWrite', file: 'locale-vcwrite', exports: ['L_VCWRITE'] }, // #842 写操作那一族的词条（单独一份片段）
  { name: 'localeSkilldesc', file: 'locale-skilldesc', exports: ['L_SKILLDESC'] }, // #879 技能描述 27 条中英词条（locale-word.js 贴上限，单独一份片段）
  { name: 'locale', exports: ['L'] },
  { name: 'icons', exports: ['ICON_SCHEMES', 'WORD_SCHEMES', 'Icon', 'Ic'] },
  // #685：「体检」按钮的三样东西（游离票件数派生、显隐门、开新会话注入）；单独一片是因为它要写的那条
  //   常驻日志必须落在内核文件里（渲染目录写日志是一张点名白名单），而 store-derived.js 已经贴着 350 行上限。
  { name: 'healthCheck', file: 'health-check', exports: ['healthCheckCountOf', 'healthCheckVisible', 'healthCheckSubjectOf', 'healthCheckLogEvent', 'openHealthCheck'] },
  // #1292：提示词真源搬到 config/prompts/ 下的 YAML，客户端那一份数据由生成物 prompt-data.ts 提供；
  //   组装提示词的后端一族（completePrompt / newSpecPrompt 等）拆到了 prompts-backend.ts。
  //   三片都要在这里登记，否则它们「改了没重建」没人拦得住（这条门禁独有的那半边）。
  { name: 'promptData', file: 'prompt-data', exports: ['PROMPT_TEMPLATE_DATA', 'PROMPT_FRAGMENT_DATA'] },
  { name: 'prompts', exports: ['PROMPTS', 'promptFragment', 'promptLanguages', 'promptLang', 'promptText', 'vocabularyParamsFrom'] },
  { name: 'promptsBackend', file: 'prompts-backend', exports: ['completePrompt', 'newSpecPrompt', 'inspectPrompt', 'FIXATE_PROMPT', 'promptTextFor', 'currentBackendId', 'backendPromptFrom'] },
  // #1012：旧配置存档 dsws.cfg（连同 CFG_KEY/cfg/saveCfg）与更旧的 dsws.startCfg（连同 migrateStartCfg）
  //   已按维护者定案删除，这里那三个名字随之从清单里去掉；模板那几项照旧。
  { name: 'config', exports: ['templates', 'saveTemplates', 'tplText', 'TPL_DEFAULT', 'renderTemplate', 'validateTemplate'] },
  // #1012：工作区配置文件那一行（`workspaceFileNoteOf` 把宿主回执翻成状态栏那句人话、
  //   `workspaceFileNoteEl` 生成那一行节点；两个名字一起记进白名单，逐条量它们的门禁在 tests/verify-workspace-file-note.js）。
  { name: 'storePrefs', file: 'store-prefs', exports: ['DEFAULT_PANEL_H', 'listPrefs', 'saveListPrefs', 'labelClicks', 'saveLabelClicks', 'NOREPO_DISMISS_PREFIX', 'cwdHash', 'noRepoDismissKey', 'isNoRepoDismissed', 'setNoRepoDismissed', 'cwdBasename', 'isNoRepoNameValid', 'ensureNoRepoCard', 'setActiveMap', 'clearActiveMap', 'setActiveIssue', 'clearActiveDetail', 'ISSUE_CACHE_TTL', 'selectionByCwd', 'repositoryByCwd', 'SELECTION_BY_CWD_KEY', 'BANNER_FOLD_KEY', 'bannerFoldByCwd', 'isBannerFolded', 'setBannerFolded', 'getCachedSelection', 'setCachedSelection', 'userHintOf', 'keepUserPick', 'userPickSelection', 'adoptBoundRev', 'workspaceFileNoteOf', 'workspaceFileNoteEl', 'getCachedRepository', 'setCachedRepository'] },
  // #669 第 6 件（ADR 20260921）：clearBackendBinding 随「清除后端选择」那颗按钮一起退役（全仓已无调用点）。
  { name: 'storeSwitch', file: 'store-switch', exports: ['labelOf', 'presentationById', 'setPresentationMap', 'backendColorOf', 'backendBgOf', 'backendBorderOf', 'repoShortName', 'DEFAULT_SWITCH_PROMPT_ZH', 'openSwitchConfirm', 'closeSwitchConfirm', 'loadSwitchCri', 'confirmSwitchConfirm'] },
  { name: 'storeSnapshot', file: 'snapshot-cache-store', exports: ['makeStore', 'shared', 'stores', 'storeOf', 'emit', 'sub', 'useStore', 'SNAP_CWD_LRU_MAX', 'snapshotByCwd', 'touchLRUClient', 'getCachedSnapshot', 'getCachedEntry', 'setCachedSnapshot', 'getSnapshotVersion', 'lastProbeAtByCwd', 'getProbeAt', 'touchProbeAt', 'SNAP_DISK_CAP', 'diskPutSnapshot', 'diskGetSnapshot', 'CHAIN_CWD_LRU_MAX', 'chainByCwd', 'getChainCacheKey', 'getCachedChain', 'setCachedChain', 'hydrateFromCache', 'mergeSelection', 'applySnapshotSelection', 'getCwdSync', 'NOTICE_COLOR', 'noticeIcon', 'flash'] },
  { name: 'storeDerived', file: 'store-derived', exports: ['compute', 'frontierAll', 'openIssuesOf', 'isOccupied', 'occCount', 'frontierCount', 'applyStandaloneBlocks', 'hasLabelOf', 'isTriageLike', 'bugCount', 'triageCount', 'buildColorOf', 'isLightHex', 'timeStampStr'] },
  { name: 'rowActions', file: 'row-actions', exports: ['rowActionKind', 'actionColorOf', 'rowActionText', 'mkRowAction'] },
  // #709（T5）：8 秒自轮询那对排期/取消函数已退役，换成事件驱动入口（四类事件共用一个出口）。
  { name: 'probeChain', file: 'probe-chain-subscription', exports: ['chainEventRefresh', 'CHAIN_EVENT_REASONS', 'loadChain', 'chainSteps', 'chainStep', 'chainStepStatus', 'chainStepOk', 'chainStepBad', 'readyCount', 'envTotal', 'envLabel', 'setupCheck', 'openBlockers', 'blockerNames', 'detectCwd'] },
  { name: 'probeStale', file: 'staleness-indicator', exports: ['_snapSeqN', '_snapLatestByWs', '_snapPendKey', '_snapMarkRequest', '_snapRespStale', '_snapReuseInFlight'] },
  { name: 'probeSnapshot', file: 'snapshot-sync', exports: ['pendingSnapshotByCwd', 'nowStr', 'timeOf', 'timeOfMs', 'broadcastCfg', 'cacheFirstThenAttend', 'loadSnapshot'] },
  // #707：probe-snapshot.js 拆到这里之前 349 行（门禁上限 350），把颜色小函数、数据层增量差异、
  //   高亮清除搬成单独一片；那三样东西的导出名与行为一字未改。
  { name: 'probeSnapshotHelpers', file: 'snapshot-sync-helpers', exports: ['hexA', 'darken', 'diffSnapshots', '_flashClearPending', 'scheduleFlashClear'] },
  { name: 'probeAuto', file: 'refresh-timer', exports: ['PROBE_MS', 'FOCUS_PROBE_MIN_MS', 'lastFocusProbe', '_actionProbePending', 'probeNow', 'scheduleActionProbe', 'startAutoProbe', 'startActiveProbeLoop', 'spinAll', 'refreshAll', 'SNAP_FRESH_MS', 'snapFresh'] },
  // #707：视野模型的客户端半边（窗口标识、焦点与可见性监听、20 秒本地心跳、处境判定）。
  { name: 'attentionHeartbeat', file: 'client-attention-heartbeat', exports: ['attentionWindowId', 'attentionVisible', 'attentionNoteHuman', 'attentionStoreOf', 'attentionRootOf', 'attentionKeyOf', 'noteShownAttentionStore', 'forgetShownAttentionStore', '_shownAttentionStore', '_attentionPlan', 'adoptAttentionPlan', 'attentionStandingOf', 'ATTENTION_SILENT_MS', 'attentionSuspended', 'attentionBeat', 'startAttentionHeartbeat', 'startAttentionSignals', 'stopAttentionSignals'] },
  { name: 'router', exports: ['openInNativeRight', 'openPanel', 'togglePanel', 'afterPanelOpened', 'repoStr', 'startText', 'newWayfinderText', 'newSpecText', 'newBugWayfinderText'] },
  // #709（T5）：5 秒自轮询常量与启动函数已退役，换成事件驱动入口；namingGuardianKick 仍是那一次拉取的本体。
  { name: 'apiNaming', file: 'api-naming', exports: ['injectFixate', 'handoffPrompt', 'extractHandoffFile', 'absHandoffPath', 'handoffReadText', 'getRowPreset', 'isHealthyPreset', 'isReusableBlank', 'buildCreateOpts', 'createPTCSession', 'namingCurrentTitleOf', 'namingHintOf', 'executeNamingOrder', 'reconcileNamingFailure', 'applyNamingFailurePanel', 'namingGuardianKick', 'namingGuardianEvent', 'startNamingGuardianEvents'] },
  { name: 'apiPresetGuard', file: 'api-preset-guard', exports: ['describeReuseDecision', 'verifyFreshPreset', 'tryQuarantineSession', 'createVerifiedPTCSession'] },
  { name: 'apiWorkspace', file: 'api-workspace', exports: ['workspacePathOf', 'workspaceIdOf', 'workspaceNormOf', 'workspaceCollectFromSnap', 'workspaceMatchEntry', 'workspaceTryCreateWid', 'resolveWorkspaceEntry', 'archivedSessionIdsOf'] },
  // #1251：交接执行那一族从 apiNewSession 里拆出（原文件有效行超 350 上限）：
  //   探测交接文档、生成交接文档、带着交接文档开新会话在 api-handoff；新会话创建仍在 api-new-session。
  { name: 'apiHandoff', file: 'api-handoff', exports: ['probeHandoffReady', 'doHandoff', 'doHandoffOpen'] },
  { name: 'apiNewSession', file: 'api-new-session', exports: ['openTextInNewSession'] },
  { name: 'apiIo', file: 'api-io', exports: ['openInNewSession', 'inject', 'openUrl', 'copyText', 'fetchIssueDetail', 'clearIssueDetailCache', 'fetchIssueComments', 'submitIssueComment', 'fetchIssuesPage'] },
  // #690：历史票的页数据（已关闭票按需翻页）—— 分桶存放、按身份去重、静默刷新不清空、最多留 10 页。
  { name: 'issuePages', file: 'issue-pages', exports: ['ISSUE_PAGE_MAX', 'ISSUE_PAGE_LIMIT', 'issuePageFilterOf', 'issuePageKeyOf', 'issuePageBucketRead', 'issuePageBucketOf', 'issuePageRowsOf', 'issuePageStatOf', 'loadIssuePage'] },
  { name: 'actions', exports: ['createActionDispatcher', 'ACTIONS_VERSION'] },
  { name: 'backendList', file: 'builtin-backends', exports: ['BUILTIN_BACKENDS', 'SWITCH_UNAVAILABLE_BACKENDS', 'builtinLabelOf', 'otherFiltered', 'firstBackendIdOf', 'repositoryActionOf', 'moduleMetaOf'] },
  { name: 'link', exports: ['issueUrlFor', 'openIssueUrl', 'searchUrlFor', 'repoUrlFor', 'issueRefNumbersFrom'] },
  // 本次界面反馈需求：全客户端唯一的按压委托与点击日志口（ui.action）——新片，改了没重建要能拦得住。
  { name: 'uiFeedback', file: 'ui-feedback', exports: ['UI_PRESS_CLASS', 'UI_PRESS_ATTR', 'UI_LOG_ATTR', 'installUiFeedback'] },
  { name: 'slots', exports: ['SLOTS_KERNEL_VERSION', 'SLOT_DEFS_KERNEL', 'MODAL_SEAT_ID', 'orderOf', 'isScopeValid', 'canDeclareIn', 'shouldShowInModal', 'isModalAction', 'getWizardAction', 'getFormAction', 'getModalAction', 'getWizardSteps'] },
  { name: 'slotRendererQueue', file: 'slotRenderer-queue', exports: ['SLOT_RENDERER_VERSION', 'ensureFormModal', 'openFormModal', 'closeFormModal', 'createModalRenderForm', 'canOpenModalForStep', 'canOpenWizardForStep'] },
  { name: 'slotRendererRepoSync', file: 'repo-sync-renderer', exports: ['startRepoSync', 'finishRepoSync', 'retryRepoSync'] },
  { name: 'slotRendererModalView', file: 'slotRenderer-modal-view', exports: ['FormModalSeat'] },
]
const kernelFileOf = (m) => {
  // #1251：转写后真源是同名 .ts（.js 孪生已删，pixel-ts 按需重建）：优先查 .ts；
  //   尚未转写的条目仍查 .js。产物由哪份真源拼出来，新鲜度就跟哪一份。
  // #1428：九个客户端房文件搬进 src/refresh/rooms/client/：新家优先，旧家回落（搬空后回落永不命中）。
  const fresh = 'src/refresh/rooms/client/' + (m.file || m.name)
  if (fs.existsSync(fresh + '.ts')) return fresh + '.ts'
  if (fs.existsSync(fresh + '.js')) return fresh + '.js'
  const base = 'src/client/kernel/' + (m.file || m.name)
  return fs.existsSync(base + '.ts') ? base + '.ts' : base + '.js'
}
const SOURCES = [
  'src/client/index.ts', 'scripts/build.mts', 'package/package.json', // #1254：入口真源转写为 .ts
  // #629：配色核心的两个产物是客户端闭包的输入（scripts/build.mts 的 SHARED_SPLICE 直接读它们），
  // 加进这份回落判据用的源码清单以后，「只重跑核心转译、没重跑主构建」会更早变红。
  // 这是 SOURCES 里第一次出现共享层的文件；另外八个既有共享拼接文件仍然不在清单里（存量空白，另票处理）。
  // 2026-10-19 第三阶段起产物住在仓库根的 .build/shared/，新鲜度要跟新落点比，所以路径改成产物位。
  '.build/shared/label-color/colors.js', '.build/shared/label-color/prompt.js',
  ...MODULES.map(kernelFileOf),
]

async function main() {
  // ---- 产物新鲜度门禁 ----
  const judged = judgeProducts({ products: PRODUCTS, sources: SOURCES })
  reportJudgements(judged, check, { label: '产物门禁 ', products: PRODUCTS })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 产物已拼接（无标记残留）----
  const cli = fs.readFileSync('client.js', 'utf8')
  const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
  for (const m of MODULES) {
    check(!cli.includes('kernel:' + m.name + ' (spliced') && !pcli.includes('kernel:' + m.name + ' (spliced'),
      '双产物无 ' + m.name + ' 拼接标记残留')
  }

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
