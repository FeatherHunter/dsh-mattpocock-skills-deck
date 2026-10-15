// verify-leaves.js — dsh-mattpocock-skills-deck 阶段 2 叶子迁移（#97 T4）：叶子文件清单门禁
// 验证：
//   1) 全部叶子文件存在（G3 共享 → views/shared/ · G4 严格一文件）
//   2) 每个叶子文件 ≤350 行（G4 Q1：≤350 默认、>500 强制拆；在册文件按零增长基线判）
//   3) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；与 verify-kernel 同口径）
// 「叶子导出齐全」「组件消费 useContext」「产物里拼进没拼进」这三类读源码文本钉形状的断言，
// 已按维护者要求删除；LEAVES 表里的 exports / components 两列从此只是档案记录，不再参与断言。
// 用法: node tests/verify-leaves.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）
const fs = require('fs')
const path = require('path')
const { countEffectiveLines, EFFECTIVE_LINES_METRIC } = require('../scripts/lib/effective-lines.mts')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 零增长基线（#845）：在册文件按基线值判，不在册的按 350 判；与 verify-file-granularity.js 同一份文件。 */
const GRANULARITY_BASELINE = (function () {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'file-granularity-baseline.json'), 'utf8'))
    // 口径不符就当成没有基线：#1017 起那份文件按「有效行」记，数字换成旧口径（总行数）后会偏大，
    // 拿它当上限等于偷偷放宽；这里退回纯 350，宁可直接红，也不静默变松。
    return data.metric === EFFECTIVE_LINES_METRIC ? (data.files || {}) : {}
  } catch (e) { return {} }
})()
const PRODUCTS = ['client.js', 'package/lib/client.js']
const LEAVES = [
  { file: 'src/client/views/shared/chips.js', exports: ['Dot', 'TypeChip', 'chipKeyDown', 'chipProps'], components: ['Dot', 'TypeChip'] },
  { file: 'src/client/views/shared/md.js', exports: ['MD_LINK_RE', 'MD_TASK_RE', 'mdEsc', 'mdInline', 'mdToHtml'], components: [] },
  { file: 'src/client/views/shared/ticket.js', exports: ['tStatus', 'tStatusLabel', 'tProgressBar', 'tStatusBadge'], components: [] },
  { file: 'src/client/views/shared/stateKind.js', exports: ['prStateKind'], components: [] }, // #599 新增：票的状态判据（打开/已关闭/已合并）单源，拉取请求页与单票详情页共用
  { file: 'src/client/views/shared/tagsFit.js', exports: ['_tagsFpOf', 'fitAllTags'], components: [] },
  { file: 'src/client/views/shared/Tabs.js', exports: ['useTabsRow'], components: [] },
  { file: 'src/client/views/TicketRow.js', exports: ['TicketRow'], components: ['TicketRow'] },
  { file: 'src/client/views/MapDetailTop.js', exports: ['MapDetailTop'], components: ['MapDetailTop'] }, // #807 由 MapDetail.js 拆出：顶部操作行（不换行/逐字折叠/新会话实心/补图标）
  { file: 'src/client/views/MapDetail.js', exports: ['MapDetail'], components: ['MapDetail'] },
  { file: 'src/client/views/IssueDetailComments.js', exports: ['renderIssueDetailComments'], components: [] }, // V3 #463 由 IssueDetail.js 拆出：评论区（无组件，纯函数）
  { file: 'src/client/views/IssueDetail.js', exports: ['IssueDetail'], components: ['IssueDetail'] },
  { file: 'src/client/views/NoRepoCard.js', exports: ['NoRepoCard'], components: ['NoRepoCard'] },
  { file: 'src/client/views/ListTabClosed.js', exports: ['useClosedPageScroll', 'closedPagesNode', 'repoWebIssuesUrlOf'], components: [] }, // #690 新增：主列表「已关闭票按需翻页」的三个触发点（展开折叠行、切到已关闭、滚到底）与「已加载 x / 共 N」那一行（无组件，纯函数与钩子）
  { file: 'src/client/views/ListTabRow.js', exports: ['listIssueRow'], components: [] }, // V3 #463 由 ListTab.js 拆出：单行渲染（无组件，纯函数）
  { file: 'src/client/views/ListTab.js', exports: ['ListTab'], components: ['ListTab'] },
  { file: 'src/client/views/SkillsTab.js', exports: ['SkillsTab'], components: ['SkillsTab'] },
  { file: 'src/client/views/ChecksTab.js', exports: ['ChecksTab'], components: ['ChecksTab'] },
  { file: 'src/client/views/SettingsWorkspaces.js', exports: ['useWsOverview', 'renderWsOverview'], components: [] }, // V3 #463 由 SettingsPage.js 拆出：后端总览（数据钩子 + 分组渲染）
  { file: 'src/client/views/diagnosticLog/diagnosticLogModel.ts', exports: ['LOG_OPS', 'DBG_SWITCH_FAIL_KEY', 'DBG_SWITCH_FAIL_FALLBACK', 'dbgSwitchFailKey', 'todayName', 'isTodayName', 'switchToastKey', 'switchFlashKind', 'canStartOp'], components: [] }, // 诊断日志的纯推演层（#597 那张表由此搬入，DebugSwitchFailHint.js 删档；设置页与状态栏共用同一份判定）
  { file: 'src/client/views/SettingsPage.js', exports: ['SettingsPage'], components: ['SettingsPage'] }, // #519 落地 A：模板编辑入口整组删除，TPL_NAMES/TPL_DESC/TPL_EDIT_IDS/PREVIEW_VALUES 四个导出随之移除
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
  // 胶囊里「这个会话在办哪张票」那一段（只读链读数里当前会话那一格；散列自带一份不 import，挂载在 StatusBar 胶囊品牌字之后）
  { file: 'src/client/statusbar/SessionChainCapsule.js', exports: ['capsuleShardOf', 'sessionChainCapsuleOf', 'SessionChainCapsule'], components: ['SessionChainCapsule'] },
  { file: 'src/client/floating/SkillFloatList.js', exports: ['SkillFloatList'], components: ['SkillFloatList'] },
  { file: 'src/client/floating/Pop.js', exports: ['showPop'], components: [] },
  { file: 'src/client/hostShim.js', exports: ['timer', 'h'], components: [] }, // #459 由 index.js 拆出：宿主适配垫片（timer 兜底，无组件，纯函数；曾含旧标签迁移，该段已由 #598 删除）
  { file: 'src/client/panelAssembly.js', exports: ['apiCall', 'cx', 'withCx'], components: [] }, // #459 由 index.js 拆出：面板装配（Ctx 装配加插槽注册加启动收尾，无组件，纯函数）
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
  // #721 处理链展示面：面板顶部那一条「每个会话在处理哪些票」（判据加画法；只读宿主写下的那一个快照字段）
  { file: 'src/client/views/shared/sessionChainView.js', exports: ['SESSION_CHAIN_FIELD', 'SESSION_CHAIN_ACTION_KEYS', 'sessionChainActionKeyOf', 'sessionChainClock', 'sessionChainViewOf', 'sessionChainRowsOf', 'sessionChainOpenTicket', 'SessionChainStrip'], components: ['SessionChainStrip'] },
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
  'src/client/index.js', 'scripts/build.mjs', 'package/package.json',
  ...LEAVES.map((l) => l.file),
]

function productStale(prod) {
  if (!fs.existsSync(prod)) return '缺失（请先运行 node scripts/build.mjs）'
  const pm = fs.statSync(prod).mtimeMs
  for (const s of SOURCES) {
    if (fs.existsSync(s) && fs.statSync(s).mtimeMs > pm + 1000) {
      return '过期（' + s + ' 比产物新，请重新运行 node scripts/build.mjs）'
    }
  }
  return null
}

function main() {
  // ---- 产物新鲜度门禁 ----
  PRODUCTS.forEach((p) => {
    const why = productStale(p)
    check(!why, '产物门禁 ' + p + (why ? '：' + why : '（存在且新鲜）'))
  })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 叶子文件 + 导出齐全 + ≤350 行 + 组件 useContext ----
  for (const l of LEAVES) {
    const file = l.file
    if (!fs.existsSync(file)) { check(false, file + ' 缺失'); continue }
    const src = fs.readFileSync(file, 'utf8')
    const lines = countEffectiveLines(src)
    // #845：这条断言原来写死「全员 350」，但 3ccef80 起仓库有一份零增长基线
    //   （tests/file-granularity-baseline.json：门禁落地时已超标的文件把当时行数记进去，只许减不许增）。
    //   判据改成与 verify-file-granularity.js 同一口径：在基线里的文件 ≤ 基线值，不在基线的 ≤350。
    // #1017：口径换成**有效行**（注释与空行不计），实现与那条门禁共用 scripts/lib/effective-lines.mts。
    //   同一份文件按总行数算是 359 行、按有效行算是 233 行，两处口径不一致会让这条断言凭空变红。
    const frozen = GRANULARITY_BASELINE[file]
    const limit = frozen === undefined ? 350 : Number(frozen)
    check(lines <= limit, file + ' ≤' + limit + ' 有效行' + (frozen === undefined ? '（G4）' : '（零增长基线冻结值）') + ' · 实际 ' + lines + '）')
  }

  // ---- 页内浮窗退役（只查文件在不在，不读源码文本） ----
  // #646：浮窗组件本体与它的拼接标记一起删除，源码里不该再有它的名字。
  check(!fs.existsSync('src/client/panel/Overlay.js'), 'src/client/panel/Overlay.js 已删除（页内浮窗退役）')

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main()
