// verify-leaves.ts — dsh-mattpocock-skills-deck 阶段 2 叶子迁移（#97 T4）：叶子文件清单门禁
// 验证：
//   1) 全部叶子文件存在（G3 共享 → views/shared/ · G4 严格一文件）
//   2) 每个叶子文件 ≤350 行（G4 Q1：≤350 默认、>500 强制拆；在册文件按零增长基线判）
//   3) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；与 verify-kernel 同口径）
// 「叶子导出齐全」「组件消费 useContext」「产物里拼进没拼进」这三类读源码文本钉形状的断言，
// 已按维护者要求删除；LEAVES 表里的 exports / components 两列从此只是档案记录，不再参与断言。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-leaves.ts（在插件根目录；先运行 node scripts/build.mts 生成产物）
// 写法保持 require 风格：验证链经装载钩子载入本文件，require 与 __dirname 照 CommonJS 形态工作
// （与 tests/verify-1207-splice-ts.ts 同形）；改成 import 形态没有收益，只添风险，所以不改。
const fs = require('fs')
const path = require('path')
const { countEffectiveLines, EFFECTIVE_LINES_METRIC } = require('../scripts/lib/effective-lines.mts')
// 取源入口（#1207 立的 tests/lib/source-text.ts）：本表里写的路径是「这份叶子原来叫什么」，
// 个别文件已经转成 TypeScript（#1209 起：statusbar/StatusBackend）。下面每一处读源码文本的地方
// 都先问一次 sourcePath，问到的才是真源今天住的那一份 —— 直接按 .js 读会读到构建产物（行数、
// 新鲜度判据跟着一起量错），按 .ts 却又在没转的文件上读不到。
const { sourcePath } = require('./lib/source-text.ts')
const realPath = (rel: string): string => sourcePath(rel)
let failed = false
const check = (ok: unknown, msg: string): void => { console.log(((ok ? '  PASS ' : '  FAIL ') + msg) as string); if (!ok) failed = true }

/** 零增长基线（#845）：在册文件按基线值判，不在册的按 350 判；与 verify-file-granularity.ts 同一份文件。 */
const GRANULARITY_BASELINE: Record<string, number> = (function (): Record<string, number> {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'file-granularity-baseline.json'), 'utf8'))
    // 口径不符就当成没有基线：#1017 起那份文件按「有效行」记，数字换成旧口径（总行数）后会偏大，
    // 拿它当上限等于偷偷放宽；这里退回纯 350，宁可直接红，也不静默变松。
    return data.metric === EFFECTIVE_LINES_METRIC ? (data.files || {}) : {}
  } catch (e) { return {} }
})()
// 产物新鲜度判据全仓只有一份：scripts/lib/build-cache.mts 的 judgeProducts（#1326）。
// 缓存可用时比「产物内容摘要 vs 上次成功构建记录」；缓存不可用时回落按修改时间判断，
// 回落原因用 INFO 行打出来（判绿也打，不静默），失败文案直接用判据给的原因。
const { judgeProducts, reportJudgements } = require('../scripts/lib/build-cache.mts')
const PRODUCTS = ['client.js', 'package/lib/client.js']
const LEAVES = [
  { file: 'src/client/views/shared/chips.js', exports: ['Dot', 'TypeChip', 'chipKeyDown', 'chipProps'], components: ['Dot', 'TypeChip'] },
  // 本次界面反馈需求：液态墨块（页签与列表筛选药丸共用）。
  { file: 'src/client/views/shared/liquidInk.ts', exports: ['LIQUID_INK_CLASS', 'LIQUID_INK_HOST_CLASS', 'LIQUID_INK_ON_CLASS', 'liquidInkPlace', 'liquidInkRemember', 'useLiquidInk'], components: [] },
  { file: 'src/client/views/shared/md.js', exports: ['MD_LINK_RE', 'MD_TASK_RE', 'mdEsc', 'mdInline', 'mdToHtml'], components: [] },
  { file: 'src/client/views/shared/ticket.js', exports: ['tStatus', 'tStatusLabel', 'tProgressBar', 'tStatusBadge'], components: [] },
  { file: 'src/client/views/shared/stateKind.js', exports: ['prStateKind'], components: [] }, // #599 新增：票的状态判据（打开/已关闭/已合并）单源，拉取请求页与单票详情页共用
  { file: 'src/client/views/shared/tagsFit.js', exports: ['_tagsFpOf', 'fitAllTags'], components: [] },
  { file: 'src/client/views/shared/Tabs.js', exports: ['useTabsRow'], components: [] },
  { file: 'src/client/views/TicketRow.js', exports: ['TicketRow'], components: ['TicketRow'] },
  { file: 'src/client/views/MapDetailTop.js', exports: ['MapDetailTop'], components: ['MapDetailTop'] }, // #807 由 MapDetail.js 拆出：顶部操作行（不换行/逐字折叠/新会话实心/补图标）
  { file: 'src/client/views/MapDetail.js', exports: ['MapDetail'], components: ['MapDetail'] },
  { file: 'src/client/views/DetailActionBar.js', exports: ['DetailActionBar'], components: ['DetailActionBar'] }, // #1286 由 MapDetail.js 拆出：容器详情页底部的三态动作组
  { file: 'src/client/views/MapDetailSpecBody.js', exports: ['MapDetailSpecBody'], components: ['MapDetailSpecBody'] }, // #1286 由 MapDetail.js 拆出：规格详情页的正文七段
  { file: 'src/client/views/IssueDetailComments.js', exports: ['renderIssueDetailComments'], components: [] }, // V3 #463 由 IssueDetail.js 拆出：评论区（无组件，纯函数）
  { file: 'src/client/views/subIssueRouting.ts', exports: ['subIssueEnter', 'subIssueHasMapTag', 'subIssueHasRoutingInfo', 'subIssueLabelsOf'], components: [] }, // 子票/阻塞票分流判定，从 IssueDetail 原样抽出
  { file: 'src/client/views/IssueDetail.js', exports: ['IssueDetail'], components: ['IssueDetail'] },
  { file: 'src/client/views/NoRepoCard.js', exports: ['NoRepoCard'], components: ['NoRepoCard'] },
  { file: 'src/client/views/ListTabClosed.js', exports: ['useClosedPageScroll', 'closedPagesNode', 'repoWebIssuesUrlOf'], components: [] }, // #690 新增：主列表「已关闭票按需翻页」的三个触发点（展开折叠行、切到已关闭、滚到底）与「已加载 x / 共 N」那一行（无组件，纯函数与钩子）
  { file: 'src/client/views/ListTabRow.js', exports: ['listIssueRow'], components: [] }, // V3 #463 由 ListTab.js 拆出：单行渲染（无组件，纯函数）
  // 本次界面反馈需求：列表页状态/排序/标签三组筛选药丸那一行（含三块液态墨块）从 ListTab.ts 抽出。
  { file: 'src/client/views/listFilterRow.ts', exports: ['listFilterRowNode'], components: [] },
  { file: 'src/client/views/ListTab.js', exports: ['ListTab'], components: ['ListTab'] },
  { file: 'src/client/views/SkillsTab.js', exports: ['SkillsTab'], components: ['SkillsTab'] },
  { file: 'src/client/views/ChecksTab.js', exports: ['ChecksTab'], components: ['ChecksTab'] },
  { file: 'src/client/views/SettingsWorkspaces.js', exports: ['useWsOverview', 'renderWsOverview', 'wsSuffixKeepOf', 'wsDisplayOf', 'computeWsOverviewRows', 'wsUnboundHintOf'], components: [] }, // V3 #463 由 SettingsPage.js 拆出：后端总览（数据钩子 + 分组渲染）；#1231 口径收进四个纯函数，只认统一判定结论；#1238 加未绑定行失败线索分类（等就绪还是查文件）
  { file: 'src/client/views/diagnosticLog/diagnosticLogModel.ts', exports: ['LOG_OPS', 'DBG_SWITCH_FAIL_KEY', 'DBG_SWITCH_FAIL_FALLBACK', 'dbgSwitchFailKey', 'todayName', 'isTodayName', 'switchToastKey', 'switchToastKind', 'canStartOp', 'exportDirOf'], components: [] }, // 诊断日志的纯推演层（#597 那张表由此搬入，DebugSwitchFailHint.js 删档；设置页与状态栏共用同一份判定）
  { file: 'src/client/views/diagnosticLog/diagnosticLogActions.ts', exports: ['createDiagnosticLogOps'], components: [] }, // 诊断日志的不纯跑腿层（原来设置页 toggleDbg 与 do 开头那一串，世界全从参数进）
  { file: 'src/client/views/diagnosticLog/DiagnosticLogSection.ts', exports: ['DiagnosticLogSection'], components: ['DiagnosticLogSection'] }, // 诊断日志分组画法（原来设置页沉底那一组，状态自持，单参 sessionId）
  { file: 'src/client/views/SettingsPage.js', exports: ['SettingsPage'], components: ['SettingsPage'] }, // #519 落地 A：模板编辑入口整组删除，TPL_NAMES/TPL_DESC/TPL_EDIT_IDS/PREVIEW_VALUES 四个导出随之移除（真源是同名 .ts，登记产物这一支）
  { file: 'src/client/views/RunPanel.js', exports: ['RunPanel'], components: ['RunPanel'] },
  { file: 'src/client/panel/DockSync.js', exports: ['useDockSync'], components: [] }, // V4 #464 由 Dock.js 拆出：工作区跟随（会话信号加同步加自愈钩子，无组件，纯函数）
  { file: 'src/client/panel/Dock.js', exports: ['DetailsDock'], components: ['DetailsDock'] },
  { file: 'src/client/panel/NamingFailBanner.js', exports: ['NamingFailBanner'], components: ['NamingFailBanner'] },
  // #667 第三轮：面板头部第一行的逐字折叠阶梯（纯函数，无组件）。登在这里是为了让「单文件 ≤350 行」与「产物已拼接」两条检查也覆盖到它。
  { file: 'src/client/panel/headFold.js', exports: ['headFoldLadderOf', 'headFoldStateAt'], components: [] },
  { file: 'src/client/panel/OverlayGate.js', exports: ['openOverlayGate', 'closeOverlayGate', 'confirmOverlayGate', 'pickOverlayBackend'], components: [] }, // V4 #464 由 Overlay.js 拆出：门控旅程（打开关闭确认直选，无组件，纯函数）；#646 浮窗本体已退役，这个门控逻辑仍在（Dock 也用）
  { file: 'src/client/statusbar/Seg.js', exports: ['num', 'seg'], components: [] },
  { file: 'src/client/statusbar/checksums.js', exports: ['checksumsOf'], components: [] },
  { file: 'src/client/statusbar/StatusMenus.js', exports: ['placeStatusOverlay', 'clearStatusClose', 'scheduleStatusClose', 'placeStatusBugMenu', 'closeStatusBugMenu', 'showStatusBugMenu', 'placeStatusTakeMenu', 'closeStatusTakeMenu', 'showStatusTakeMenu', 'placeStatusBackendMenu', 'closeStatusBackendMenu', 'showStatusBackendMenu', 'useStatusMenus'], components: [] }, // B1 #460 由 StatusBar.js 拆出：悬浮菜单定位与开关（锚点测算加开关加重的定位钩子，无组件，纯函数）；#638 追加可接菜单三件（与 BUG 菜单同形，紫色需求入口）
  { file: 'src/client/statusbar/StatusBackend.js', exports: ['closeStatusSetupPick', 'cancelStatusSetupPick', 'confirmStatusSetupPick', 'onStatusSetupInit', 'openStatusGate', 'closeStatusGate', 'confirmStatusGate'], components: [] }, // B1 #460 由 StatusBar.js 拆出：后端选择与门控动作（门控窗确认绑定、初始化小卡只答布局）；#669 第 4 件退役了那张卡上拉后端清单的三件（normStatusMods / ensureStatusSetupPick / openStatusSetupPick）
  { file: 'src/client/statusbar/bannerChain.js', exports: ['guideBannerStep', 'guideBannerParams', 'runGuideMissing'], components: [] }, // #663 新增：状态栏那条横幅按引导链清单决定出哪一条（顺序真源在 src/shared/tracker/guide-steps.js），那颗按钮照清单声明的 missing 执行
  { file: 'src/client/statusbar/StatusBar.js', exports: ['StatusBar'], components: ['StatusBar'] },
  // 胶囊里「这个会话在办哪张票」那一段（#1271 起只读面板在办表的同一格，不再读旧链读数、不再自带散列；挂载在 StatusBar 胶囊品牌字之后）
  { file: 'src/client/statusbar/SessionChainCapsule.js', exports: ['sessionChainCapsuleOf', 'SessionChainCapsule'], components: ['SessionChainCapsule'] },
  // #1409 新增：界面借会话事件流取数通路的两个叶子。前一个是纯函数（认调用、解析参数、钳制），
  // 后一个是订阅层（借事件流、等整轮结束交付）加一个不渲染东西的挂载组件。
  { file: 'src/client/statusbar/suggestFacts.ts', exports: ['SUGGEST_TOOL_NAME', 'SUGGEST_MIN_ITEMS', 'SUGGEST_MAX_ITEMS', 'SUGGEST_PROMPT_MAX_CHARS', 'SUGGEST_REASON_MAX_CHARS', 'suggestHash', 'suggestClipText', 'suggestItemsOf', 'suggestEventOf'], components: [] },
  { file: 'src/client/statusbar/suggestStream.ts', exports: ['createSuggestStream', 'SuggestStreamMount'], components: ['SuggestStreamMount'] },
  // #1411 新增：状态胶囊上方的下一步建议气泡。外观旋钮（含层级常量）、样式文本、渲染与交互薄壳三片；
  // 外观与样式在入口的「0. 样式」区按「外观在前、样式在后」拼接，薄壳在订阅层之前。
  { file: 'src/client/statusbar/suggestAppearance.ts', exports: ['SUGGEST_Z', 'SUGGEST_APPEARANCE'], components: [] },
  { file: 'src/client/statusbar/suggestStyles.ts', exports: ['SUGGEST_STYLE_TEXT'], components: [] },
  { file: 'src/client/statusbar/suggestBubble.ts', exports: ['SuggestBubble', 'suggestViewItemsOf', 'suggestAnchorOf'], components: ['SuggestBubble'] },
  { file: 'src/client/floating/SkillFloatList.js', exports: ['SkillFloatList'], components: ['SkillFloatList'] },
  { file: 'src/client/floating/Pop.js', exports: ['showPop'], components: [] },
  { file: 'src/client/hostShim.ts', exports: ['timer', 'h'], components: [] }, // #459 由 index.js 拆出：宿主适配垫片（timer 兜底，无组件，纯函数；曾含旧标签迁移，该段已由 #598 删除）；#1254 转写为 .ts
  { file: 'src/client/panelAssembly.ts', exports: ['apiCall', 'cx', 'withCx'], components: [] }, // #459 由 index.js 拆出：面板装配（Ctx 装配加插槽注册加启动收尾，无组件，纯函数）；#1254 转写为 .ts
  // #621 标签配色的七个叶子：错误档位到词条键与电话回包取形状（纯函数）、加载与保存状态机（钩子）、
  // 单行取色控件、弹窗本体、面板头部入口按钮、保存成功后写进面板快照的颜色记录（纯函数，#635 追加）、
  // 入口图标的颜色（纯函数，#637 追加）。
  // 登在这里是为了让「单文件 ≤350 行」与「产物已拼接」两条检查也覆盖到它们。
  { file: 'src/client/views/labels/labelColorErrors.js', exports: ['LC_KIND_KEYS', 'LC_PLACEHOLDER_COLOR', 'lcKindKey', 'lcErrorOf', 'lcLabelsOf', 'lcSaveOutcome', 'lcOutcomeRowOf', 'lcToDisplay', 'lcRowIncomplete', 'lcPanelBackendOf'], components: [] }, // #631 追加：lcPanelBackendOf 读出「面板现在用的是哪个后端」，供两条电话带上去
  { file: 'src/client/views/labels/labelColorPatch.js', exports: ['lcSavedColorMapOf', 'lcPatchSnapshotColors', 'lcRememberSavedColors', 'lcPanelSavedColors', 'lcApplySavedColorsOnInstall'], components: [] }, // #635 追加：保存成功后把后端确认的颜色写进面板那份快照（面板当场按新色显示）
  { file: 'src/client/views/labels/labelColorPalette.js', exports: ['LC_ENTRY_PALETTE_SLOTS', 'LC_ENTRY_PALETTE_DEFAULTS', 'LC_ENTRY_PALETTE_BODY', 'lcEntryPaletteOf'], components: [] }, // #637 追加：入口图标的颜色（四个 wayfinder 标签的真实颜色加默认兜底，纯函数）
  { file: 'src/client/views/labels/useLabelColors.js', exports: ['useLabelColors'], components: [] },
  { file: 'src/client/views/labels/LabelColorRow.js', exports: ['LabelColorRow'], components: ['LabelColorRow'] },
  { file: 'src/client/views/labels/LabelColorDialog.js', exports: ['LabelColorDialog', 'lcPanelPendingOf'], components: ['LabelColorDialog'] }, // #631 的 D1 补修追加：lcPanelPendingOf 读出「这个工作区用哪个后端还在识别」
  { file: 'src/client/views/labels/LabelColorEntry.js', exports: ['LabelColorEntry'], components: ['LabelColorEntry'] },
  // （#721 的旧工作路线展示面 sessionChainView.js 随 #1271 整份退役，行删除；在办表展示面见下面 #1082 那一行。）
  // #1082 新增：面板「跨会话在办表」（判据与画法；只读快照里的 workRouteTable 字段，与工具回执 data.workRoute 同源）
  // #1285 追加：列宽模板（表头与数据行共用同一份）与头部那一行的入口图标 WorkRouteTrigger。
  // #1289 追加：动作时刻的缩写（workRouteTableStamp）与逐行组件 WorkRouteRow（整行挂悬停提示）。
  { file: 'src/client/views/shared/workRouteTable.js', exports: ['WORK_ROUTE_TABLE_FIELD', 'WORK_ROUTE_ACTION_KEYS', 'WORK_ROUTE_TABLE_CELLS', 'workRouteActionKeyOf', 'workRouteTableClock', 'workRouteTableStamp', 'workRouteTableOf', 'WorkRouteRow', 'WorkRouteTable', 'WorkRouteTrigger'], components: ['WorkRouteRow', 'WorkRouteTable', 'WorkRouteTrigger'] },
  // 2026-09-24 从贴着 350 行上限的两个文件里搬出来的两块：
  //   · 降级横幅（views/ListTab.js → views/shared/RestFallbackBanner.js，判据仍是 truthLines 的 restFallbackView）
  //   · 头部那条灰色占位骨架（panel/Dock.js → panel/RepoChipSkeleton.js）
  // 登在这里是为了让「单文件 ≤350 行」与「产物已拼接」两条检查也覆盖到它们。
  { file: 'src/client/views/shared/RestFallbackBanner.js', exports: ['RestFallbackBanner'], components: ['RestFallbackBanner'] },
  { file: 'src/client/panel/RepoChipSkeleton.js', exports: ['RepoChipSkeleton'], components: ['RepoChipSkeleton'] },
  // #725 状态栏胶囊那条横条：「谁先让位、一次让多少」的判据（纯函数）与读写的机器（碰 DOM）各一份。
  { file: 'src/client/statusbar/capFold.js', exports: ['CAP_FOLD_POLICY', 'capFoldLadderOf', 'capFoldStateAt', 'capFoldStepCount'], components: [] },
  { file: 'src/client/statusbar/capFoldMachine.js', exports: ['runCapFold'], components: [] },
  // #842 版本管理写操作那一族的五个新叶子：vcRows 是从 vcBlocks 原样搬出的一层（腾行给写操作），
  //   另三个是写操作的纯规则 / 执行 / 画法。登在这里让「单文件 ≤350 行」与「产物已拼接」两条检查也覆盖到它们。
  { file: 'src/client/views/versionControl/vcStyles.js', exports: ['VC_STYLE_TEXT', 'vcSetTheme', 'vcClearTheme'], components: [] }, // #851：版本管理页签的视觉语言（CSS 文本，经 styles.insert 注入）
  { file: 'src/client/views/feedback/feedback-styles.js', exports: ['FEEDBACK_STYLE_TEXT'], components: [] }, // 948：交互反馈三批的视觉语言（CSS 文本，经 styles.insert 注入；styles.js 已贴 350 行上限，照 #851 做法另起叶子）
  { file: 'src/client/views/versionControl/vcRows.js', exports: ['vcGroupOfRow', 'vcFileRowsOf', 'vcRowViewOf', 'vcOtherRowOf', 'vcReadsOf', 'vcDiffOpenKeyOf'], components: [] }, // #850：展开键两边共用这一个函数
    { file: 'src/client/views/versionControl/vcDiffOps.js', exports: ['vcDiffOpsOf'], components: [] }, // #857
  { file: 'src/client/views/versionControl/vcViews.js', exports: ['VC_VIEWS', 'vcRememberedView', 'vcRememberView', 'vcResetViewMemory', 'vcViewOf', 'vcViewCountsOf', 'vcViewBlocksOf', 'vcViewTabsNode', 'vcStatsOf', 'vcStatsNode', 'vcViewSkelNode'], components: [] }, // #853 第三步：布局 C 的三个视图
  { file: 'src/client/views/versionControl/vcAiHandoff.js', exports: ['VC_AI_READ_FAIL_KINDS', 'vcAiHandoffOf', 'vcAiButtonNode', 'vcOpenAiHandoff'], components: [] }, // #854：AI 交接（prompt 三段式 + 按钮节点 + 开会话路由）
{ file: 'src/client/views/versionControl/vcWrite.js', exports: ['VC_WRITE_OPS', 'VC_BLOCK_KEY', 'vcBlockKeyOf', 'vcReasonKeysOf', 'vcOpStateOf', 'vcPushDecisionOf', 'vcBlockedTipOf', 'vcPlanMismatchOf', 'VC_WRITE_ERR_FAMILY', 'vcWriteErrFamilyOf', 'vcWriteErrKeyOf', 'vcConfirmOf'], components: [] },
  { file: 'src/client/views/versionControl/vcWriteRun.js', exports: ['VC_WRITE_PHONES', 'vcRunCheck', 'vcRunWrite', 'vcOpResultOf', 'vcAfterWrite'], components: [] },
  { file: 'src/client/views/versionControl/vcWriteUi.js', exports: ['vcWriteUiOf', 'vcRowStageOf'], components: [] },
  { file: 'src/client/views/versionControl/vcWriteOps.js', exports: ['vcWriteOpsOf'], components: [] },
  { file: 'src/client/views/versionControl/vcWriteView.js', exports: ['vcRowStageNodes', 'vcActionsNode', 'vcStageAllNode', 'vcCommitAreaNode', 'vcViewBarNode', 'vcWriteTailNodes'], components: [] },
  { file: 'src/client/views/versionControl/vcCache.js', exports: ['VC_SCREEN_CACHE_MAX', 'vcCacheSeedOf', 'vcCacheSave'], components: [] }, // #864：进出缓存
  { file: 'src/client/views/versionControl/vcInView.js', exports: ['vcMoreStepOf', 'vcMoreStateOf', 'vcMoreShownOf', 'vcUseMoreSightOf'], components: [] }, // #997：「还能显示更多」那几处什么时候接着显示（纯判定 + 从块清单取状态 + 再画一批 + 接线）
]
const SOURCES = [
  'src/client/index.ts', 'scripts/build.mts', 'package/package.json', // #1254：入口真源转写为 .ts
  // 两种路径都收进来：转成 TypeScript 的那些，产物同时取决于 .ts 真源与 pixel-ts 写下的同名 .js；
  // 还没转的还是只有 .js。少了哪一条，都会让「改了源码、产物没重建」从这道门禁底下溜过去。
  ...LEAVES.map((l) => l.file),
  ...LEAVES.map((l) => realPath(l.file)),
]

function main(): void {
  // ---- 产物新鲜度门禁 ----
  const judged = judgeProducts({ products: PRODUCTS, sources: SOURCES })
  reportJudgements(judged, check, { label: '产物门禁 ', products: PRODUCTS })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 叶子文件 + 导出齐全 + ≤350 行 + 组件 useContext ----
  for (const l of LEAVES) {
    const file = l.file
    // 真源今天住哪：没转过就是它自己，转过就是同名 .ts。下面存在性、行数、基线查表三处都用这一份，
    // 免得「按 .js 判行数、按 .ts 读文本」这种两头不一致。
    const real = realPath(file)
    if (!fs.existsSync(real)) { check(false, real + ' 缺失'); continue }
    const src = fs.readFileSync(real, 'utf8')
    const lines = countEffectiveLines(src)
    // #845：这条断言原来写死「全员 350」，但 3ccef80 起仓库有一份零增长基线
    //   （tests/file-granularity-baseline.json：门禁落地时已超标的文件把当时行数记进去，只许减不许增）。
    //   判据改成与 verify-file-granularity.ts 同一口径：在基线里的文件 ≤ 基线值，不在基线的 ≤350。
    // #1017：口径换成**有效行**（注释与空行不计），实现与那条门禁共用 scripts/lib/effective-lines.mts。
    //   同一份文件按总行数算是 359 行、按有效行算是 233 行，两处口径不一致会让这条断言凭空变红。
    //   基线表按仓库相对路径查：一直查的是 LEAVES 里登记的那条路径（对转过的文件就是那个 .js 名字），
    //   所以这里仍用 file 而不是 real —— 换名字会让转过的文件悄悄跳出它被冻结的那一行。
    const frozen = GRANULARITY_BASELINE[file]
    const limit = frozen === undefined ? 350 : Number(frozen)
    check(lines <= limit, real + ' ≤' + limit + ' 有效行' + (frozen === undefined ? '（G4）' : '（零增长基线冻结值）') + ' · 实际 ' + lines + '）')
  }

  // ---- 页内浮窗退役（只查文件在不在，不读源码文本） ----
  // #646：浮窗组件本体与它的拼接标记一起删除，源码里不该再有它的名字。
  check(!fs.existsSync('src/client/panel/Overlay.js'), 'src/client/panel/Overlay.js 已删除（页内浮窗退役）')

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main()
