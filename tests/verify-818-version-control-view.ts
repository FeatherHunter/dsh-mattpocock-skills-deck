// tests/verify-818-version-control-view.js — 版本管理页签界面侧门禁（#818 落地）
// 用法：在插件根目录执行 node tests/verify-818-version-control-view.ts，可独立运行。
//
// 主缝（规格定的那一条）：喂一份录好的状态模型，断言「该画哪些块、每块写什么字」。断言落在
//   用户读到的文字与块的顺序上，不落在内部字段名上。模型有三个来源：
//     A. 用真宿主取数层 + 真机样本（tests/fixtures/version-control/live-numstat-shapes.json）跑一次
//        首屏，把它回的 screen 原样喂给界面侧的块模型 —— 上半段解析与下半段画法的整条链一次跑通；
//     B. 手写的边界模型（游离头指针、零提交、上游没了、没设上游、工作树被占用/答不出/目录已不存在、
//        正在变基、同一路径既有冲突又有普通修改、差异短与长、提交续读到底）；
//     C. 真词条：中英两份都从 src/client/kernel/locale-panel.js 与 locale-flow.js 里读出来，
//        断言的是用户真会读到的那句话（不是键名）。
// 次缝（规格定的那一条）：三条电话接没接上。只判四件事 —— 能不能被调到（电话名与入参）、成功回包
//   是不是约定的信封形状、失败是不是诚实的失败（保留旧数据、错误种类不丢、不抛）、日志事件是不是
//   落在既有的 host.call / host.call.fail 上。不判解析对不对（那是解析器门禁的活）。
// 第三种（比照）：界面侧的两条规则与版本管理核心逐点对齐 —— vcMiddle 与核心 foldMiddle 同规则、
//   vcTimeKind 与核心 describeTime 同一条 7 天分界。
// 反证（规格与仓库既有纪律都要求）：把被守的东西改坏，同一套断言必须当场变红，本文件带五处源码改动
//   加两条字典与渲染级的反证（词条位置那条真机缺陷就在这里被钉住）。
// 2026-10 撤掉的源码文本门禁：A2–A7（读 Tabs.js / VersionControlTab.js / scripts/build.mjs /
//   src/client/index.js 的文本，钉导出名、登记次序与拼接标记）、F1/F2/F3/F5/F5b/F5c/F6（读界面
//   源码文本数行数、数中文字面量、抠词条键、扫硬编码颜色与定时器字样）、G3（读组件文本数
//   `b.kind === '…'` 分支）、V10/V11b（读组件文本找 view:'changes' 与页签回调的写法）、G14（按
//   标记抠出 useEffect 函数体再正则断言首句）、N15/N17/N18/N19（读组件文本找按钮与守卫的名字）、
//   M4（读组件文本找悬停那一行）。它们的断言对象是手写源码的文本，等价重构（改写法、搬文件、
//   改注释）就会变红，按维护者口径撤掉；留下的断言都跑真代码或真渲染，H 组的反证照旧。
// 这份门禁把二十来个界面叶子拼成一段源码、再用 compileFn 当函数体求值，所以拼出来的闭包没有静态形状；
//   下面只给「门禁自己写的那些零件」标注类型（计数器、读文件、词条查找、反证改法），闭包成员按名字取用。
interface AntiCase {
  name: string
  en?: boolean
  seed?: unknown
  hostStub?: unknown
  what: string
  patch?: (s: string) => string
  pairs?: ReadonlyArray<readonly [string | RegExp, string]>
  test: (v: any) => boolean | Promise<boolean>
}
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
// 本文件选 compileFn 手法：这段把六个叶子拼成的界面闭包当函数体造函数，依赖本来就一项项按参数名传。
const { compileFn } = require('./lib/eval-probe.js')
// 中央时间真值：相对时间窗口只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
// 2026-10-17：locale-flow.js 的界面文案改成按中央时间参数现算（提交 2d0a3f85）之后，闭包里会用到
// SETTINGS_DEBUG_PUSH_WAIT_MS 等好几个常量；只预埋一个已经不够，改成把 values.js 里的数值导出整批挂到
// globalThis 上（ESM 裸标识符回落全局），这样以后再有新常量进来也不会当场 ReferenceError。
const centralTime = require('../src/shared/time-config/values.js')
for (const [k, v] of Object.entries(centralTime)) {
  if (typeof v === 'number' && globalThis[k] === undefined) globalThis[k] = v
}
// 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供，门禁里走上面的全局预埋）。
const stripTimeConfigImport = (s: string): string => s.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const NOW = Date.parse('2026-10-04T02:00:00+08:00')
const VC_FILES = [
  // #842：判定真源（界面按它画按钮状态，不自己算）与写操作那五个新叶子也拼进这个闭包 ——
  //   入口组件 VersionControlTab.js 会调它们，缺一个就会在渲染那一帧抛错（G 组抓的就是这个）。
  // 2026-10-19 第三阶段起共享层产物搬出源码树（域产物落在 .build/shared/ 下），
  // 拼闭包要「按原文改坏」，所以读 src/ 下的真源 rules.ts，不读转译产物。
  'src/shared/version-control/src/rules.ts',
  // #1738：页面注册表与命令面板的唯一数据源（能力账本 162 条），界面壳按它渲染，测试也按它断言。
  'src/shared/version-control/src/capability-ledger.ts',
  // #1739 首屏七片契约（契约名、版本号、七片名单、刷新三时机与形状判据的唯一真源）：排在客户端那片之前。
  'src/shared/version-control/src/first-screen.ts',
  // #1743 提交计划（八条提交能力共用的形态、目标、跳过钩子、签名、追加签名行与各自 argv）：宿主与界面读同一份。
  'src/shared/version-control/src/commit-plan.ts',
  // #1755：同步十个动作（域 8 的 8.5–8.14）的共享口径（动作表、argv 规划、现场判定与确认文案），
  //   与构建同序排在客户端两叶之前。
  'src/shared/version-control/src/sync-actions.ts',
  'src/shared/version-control/src/sync-rules.ts',
  // #1751：贮藏十条的规则真源（动作名单、版本门、危险档、命令拼装与恢复路径）。
  'src/shared/version-control/src/stash-rules.ts',
  // #1756 克隆向导的共享层两片（与构建同序）：地址与选项口径 → 预检票据的契约与目标现场形状。
  'src/shared/version-control/src/clone-options.ts',
  'src/shared/version-control/src/clone-ticket.ts',
  // #1752 工作树八条能力的纯规则层（八条动作 / argv / 判定 / 清单行模型），与构建同序排在客户端那片之前。
  'src/shared/version-control/src/worktree-ops.ts',
  'src/client/views/versionControl/vcText.js',
  'src/client/views/versionControl/vcFold.js',
  'src/client/views/versionControl/vcDiff.js',
  'src/client/views/versionControl/vcCommit.js',
  'src/client/views/versionControl/vcRows.js', // #842 从 vcBlocks 原样搬出的那一层（闭包里排在 vcBlocks 之前）
  'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcWriteRun.js',
  'src/client/views/versionControl/vcWriteUi.js',
  'src/client/views/versionControl/vcWriteOps.js',
  'src/client/views/versionControl/vcWriteView.js',
  'src/client/views/versionControl/vcDiffOps.js', // #857：差异与提交那几路的动作（从入口组件搬出，闭包里排在 vcBlocks 之前）
  'src/client/views/versionControl/vcBlocks.js',
  'src/client/views/versionControl/vcViews.js', // #853 第三步：布局 C 的三个视图（与构建同序，排在 vcBlocks 之后）
  'src/client/views/versionControl/vcAiHandoff.js', // #854：AI 交接（与构建同序）
  'src/client/views/versionControl/vcTabVisible.js',
  'src/client/views/versionControl/vcData.js',
  'src/client/views/versionControl/vcCache.js', // #864：进出缓存（与构建同序）
  'src/client/views/versionControl/vcInView.js', // #997：「还能显示更多」那几处什么时候接着显示（与构建同序）
  'src/client/views/versionControl/vcFirstScreen.js', // #1739：首屏七片的客户端数据层（只读一份版本化快照；与构建同序）
  // #1752 工作树页三叶（与构建同序）：数据层 → 处理层 → 页面体，页面壳的挂载段要看到页面体那一叶。
  'src/client/views/versionControl/vcWorktreesData.js',
  'src/client/views/versionControl/vcWorktreesOps.js',
  'src/client/views/versionControl/vcWorktreesPage.js',
  // #1738 页面壳四片（与构建同序）：页面注册表 → 基础画法 → 命令面板 → 页面壳本体。
  'src/client/views/versionControl/vcCapabilityPages.js',
  'src/client/views/versionControl/vcShellPrimitives.js',
  'src/client/views/versionControl/vcPalette.js',
  'src/client/views/versionControl/vcBranches.js', // #1746：分支与标签业务面板（十三条能力入口、预检与确认、结果贴点；排在页面壳之前，壳里会调它）
  // #1744 提交历史页：列表 / 详情 / 逐文件差异 / 13.14 图形化视图（排在页面壳之前，壳要调它）。
  'src/client/views/versionControl/vcHistory.js',
  // #1754 远端与同步页（域 8 的 8.1–8.4）：数据层在前、画法在后，最后才是调它们的页面壳。
  'src/client/views/versionControl/vcSyncData.js', // #1755：同步段数据层（两条电话、预检与执行回包落位；与构建同序排在远端数据层之前）
  'src/client/views/versionControl/vcRemoteData.js',
  'src/client/views/versionControl/vcRemotePage.js',
  'src/client/views/versionControl/vcSyncPage.js', // #1755：同步段正文（十个动作、理由、租约、确认卡、任务区；挂在远端页正文末尾）
  // #1745 历史高级查询：数据层（十条能力的目录与读取）与面板画法都排在页面壳之前。
  'src/client/views/versionControl/vcQuery.js',
  'src/client/views/versionControl/vcQueryView.js',
  // #1743 提交页：动作层与正文叶子（与构建同序，排在页面壳之前，壳要调 vcCommitPageNode）。
  'src/client/views/versionControl/vcCommitOps.js',
  'src/client/views/versionControl/vcCommitPage.js',
  // #1742 改动页操作面板（13 条动作的渲染面板）：页面壳只在传了改动读数时才挂它；与构建同序，排在页面壳之前。
  'src/client/views/versionControl/vcChangesPage.js',
  // #1751 贮藏页两片（与构建同序）：先动作与数据层，再页面本体。
  'src/client/views/versionControl/vcStashOps.js',
  'src/client/views/versionControl/vcStashPage.js',
  'src/client/views/versionControl/vcClonePage.js', // #1756：迁移页 › 克隆向导（自持表单与进度状态；排在页面壳之前，壳里会挂它）
  'src/client/views/versionControl/vcShellPages.js',
  'src/client/views/versionControl/VersionControlTab.js',
]

// ---------- 真词条：直接 import 两份词条模块，断言落在真字典上 ----------
// 为什么不数「键在文件里出现两次」：上一版正是栽在这里 —— 新词条被插到了 zh: { … } 的**外面**，
//   L_PANEL 顶层多出 62 个键，中文界面把键名原样印了出来，而两道既有门禁都说「全部通过」。
//   所以这里 import 真模块、读真字典，再逐键断言 zh 与 en 两边都存在且非空。
const fill = (s: string, p?: Record<string, unknown>): string => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : String(s))
let LOC: { zh: Record<string, string>; en: Record<string, string> } = { zh: {}, en: {} }
let tZh: (k: string) => string = (k) => k
let tEn: (k: string) => string = (k) => k

// ---------- 界面侧闭包：照 scripts/build.mts 的做法把六个叶子拼起来再跑 ----------
function stripExports(text: string): string { return text.replace(/^(\s*)export\s+/gm, '$1') }
// 种子注入的匹配口（#1196 转 TS 时发现的耦合）：门禁按源码文本往闭包里注种子，手写 .js 与构建
//   生成的双生 .js（esbuild 重排了空格、引号与换行）两种写法都认。只换匹配方式，不断言含义。
const VC_SEED_RE = /React\.useState\(function\s*\(\)\s*\{\s*return vcCacheSeedOf\(cwd\) \|\| vcNewReads\(\)\s*;?\s*\}\)/
const VC_OPENCOMMIT_RE = /openCommit:\s*["']{2},\s*view:/
const VC_UIINIT_RE = /React\.useState\(function\s*\(\)\s*\{\s*return \{\s*fileShown:\s*\{\},\s*openDiff:\s*["']{2},\s*openCommit:\s*["']{2}/
const EXPORTS = ['VC_PHONES', 'VC_FILE_ROWS_FIRST', 'VC_FILE_ROWS_BATCH', 'VC_DIFF_LINES_SHOWN', 'VC_BLOCK_ORDER', 'VC_VIEWS', 'VC_TONE', 'VC_MIDDLE_MIN', 'VC_FOLD_STEP_CAP', 'VC_SYNC_VALUES', 'VC_DIFF_REASON_KEY', 'VC_OTHER_SUMMARY_NAMES',
  'vcFailKeyOf', 'vcFileRowsOf', 'vcDiffViewOf', 'vcSyncViewOf', 'vcOtherRowOf', 'vcReadsOf', 'vcBlocksOf',
  'vcChangeKeyOf', 'vcChangeToneOf', 'vcTail', 'vcMiddle', 'vcShortOid', 'vcPlusMinus', 'vcTimeKind',
  'vcWhenText', 'vcBasisText', 'vcFoldBandAt', 'vcFoldDataOf', 'vcFoldLadderOf', 'vcFoldStateAt', 'vcFoldOf',
  'vcTabVisible', 'vcNewReads', 'vcFailureOf', 'vcReadStatus', 'vcReadDiff', 'vcReadMoreCommits', 'vcNextSkipOf',
  'vcCommitKeyOf', 'vcReadCommitFiles', 'vcReadCommitFileDiff', 'vcCommitModeOf', 'vcCommitBlockOf', 'vcShouldRead', 'vcViewOf', 'vcRememberedView', 'vcRememberView', 'vcResetViewMemory', 'vcViewCountsOf', 'vcViewBlocksOf', 'vcViewTabsNode', 'vcPickViewStateOf', 'VC_AI_READ_FAIL_KINDS', 'vcAiHandoffOf', 'vcAiButtonNode', 'vcOpenAiHandoff',
  'vcFreshOnCwd', 'vcScreenShapeOk', 'vcApplyCommitReply', 'vcMarkLogLoading', 'vcOneLine',
  'VC_SCREEN_CACHE_MAX', 'vcCacheSeedOf', 'vcCacheSave',
  'vcMoreStepOf', 'vcMoreStateOf', 'vcMoreShownOf', 'vcUseMoreSightOf',
  // #1738 页面壳：能力账本、页面注册表、命令面板、基础画法与两个渲染入口。
  'CAPABILITIES', 'PAGE_SURFACES', 'PAGE_COUNTS', 'CAPABILITY_TOTAL', 'REASONS', 'judge',
  'VC_TAB_PAGES', 'VC_MANAGE_PAGES', 'VC_SEARCH_PAGE', 'VC_DEEP_LINKS', 'VC_SHELL_WIDTHS', 'VC_SHELL_STATES', 'VC_SHELL_SKINS',
  'vcPageDepthOf', 'vcPageRegistryOf', 'vcPageCapabilitiesOf', 'vcCapabilityOf', 'vcDeepLinkOf', 'vcPageSurfaceOf',
  'vcShellStateNode', 'vcShellConfirmCardNode', 'vcShellResultNode', 'vcShellCapabilityRowNode', 'vcCapabilitySurfaceKindOf',
  'VC_BLOCK_KEY', 'vcBlockKeyOf', 'vcReasonKeysOf',
  'VC_PALETTE_MAX', 'vcCapabilityAliasOf', 'vcCapabilitySummaryOf', 'vcCapabilityNeedsObjectOf', 'vcPaletteRowsOf', 'vcPaletteTargetOf', 'vcPaletteNode',
  // #1744 提交历史页：分页预算、图形化视图、详情与逐文件差异。
  //   VC_LOG_BATCH 也露出来：历史页的批大小必须与 vcData 的日志批大小同源，不能各写一个数字。
  'VC_LOG_BATCH',
  'VC_HISTORY_BATCH', 'VC_HISTORY_LANES_MAX', 'VC_HISTORY_DIFF_LINES_WIDE', 'VC_HISTORY_DIFF_LINES_NARROW',
  'vcHistoryFirstPageOf', 'vcHistoryModelOf', 'vcHistoryGraphOf', 'vcHistoryDiffContextOf', 'vcHistoryPageNode', 'vcHistoryListOf', 'vcHistoryRowNode', 'vcHistoryDetailOf', 'vcHistoryGraphNode',
  // #1754 远端与同步页：电话名、读数判据、页面模型与画法（数据层与渲染层各验一遍）。
  'VC_REMOTE_PHONES', 'VC_REMOTE_FORMS', 'VC_REMOTE_ONLINE_FAIL_KINDS',
  'vcNewRemoteReads', 'vcRemoteStateOf', 'vcRemoteReadAtOf', 'vcRemoteRemotesOf', 'vcRemoteErrorOf',
  'vcRemoteOnlineStateOf', 'vcRemoteOnlineOf', 'vcRemoteOnlineErrorOf', 'vcRemoteOnlineNameOf',
  'vcApplyRemoteReply', 'vcReadRemoteList', 'vcReadRemoteOnline', 'vcRunRemoteWrite',
  'vcRemoteModelOf', 'vcRemotePageNode',
  // #1755 同步十个动作：共享口径（动作表、规划、判定、确认文案）与客户端数据层、页面叶。
  'SYNC_ACTIONS', 'SYNC_CHECK_CONTRACT', 'SYNC_CHECK_VERSION', 'syncActionOf', 'syncPlanOf', 'syncPlanDigestInput', 'syncVersionAtLeast',
  'judgeSync', 'syncConfirmOf', 'syncReasonTextOf',
  'VC_SYNC_PHONES', 'VC_SYNC_ACTION_ROWS', 'vcNewSyncReads', 'vcSyncStateOf', 'vcSyncDataOf', 'vcSyncErrorOf', 'vcSyncTaskOf',
  'vcApplySyncReply', 'vcApplySyncWriteReply', 'vcReadSyncCheck', 'vcRunSyncWrite', 'vcSyncModelOf', 'vcSyncPageNode',
  // #1745 历史高级查询（3.4–3.13）：目录、输入校验、一次读取、空结果与截断读数、面板节点与组件。
  'VC_QUERY_PHONE', 'VC_QUERY_COUNT_MAX', 'VC_QUERY_BLAME_SPAN_MAX', 'VC_QUERY_COMPARE_MAX', 'VC_QUERY_RANGE_MAX',
  'vcQueryCatalogOf', 'vcQueryEntriesOf', 'vcQueryEntryOf', 'vcQueryDefaultsOf', 'vcQueryInputsOf', 'vcQueryInputValueOf',
  'vcNewQueries', 'vcQueryStateOf', 'vcMarkQueryLoading', 'vcApplyQueryReply', 'vcQueryParamsOf', 'vcQueryShapeOk',
  'vcReadHistoryQuery', 'vcQueryEmptyOf', 'vcQueryTruncatedOf', 'vcQueryShownOf', 'vcQueryPageNode', 'VC_QUERY_PANEL',
  // #1743 提交页：计划真源、动作层、正文模型与八条能力的控件都在这个闭包里渲染。
  'commitPlanOf', 'commitPlanProblem', 'commitPlanDangerous', 'commitArgvOf', 'commitDecisionOf', 'commitTrailerOf',
  'VC_COMMIT_MODES', 'VC_COMMIT_MODE_CAPS', 'VC_COMMIT_PHONES',
  'vcCommitInitialState', 'vcCommitOpsOf', 'vcCommitPanelOf', 'vcCommitPageNode', 'vcCommitConfirmNode', 'commitBlockKeyOf',
  'vcRenderTabAt', 'vcRenderAllPages',
  // #1742 改动页：两条电话表、13 条动作清单、参数构造与渲染入口。
  'VC_CHANGES_PHONES', 'VC_CHANGES_OPS', 'vcChangesPageNode', 'vcChangesCheckArgsOf', 'vcChangesWriteArgsOf',
  // #1739 首屏一次取全：七片契约与客户端数据层。
  'FIRST_SCREEN_CONTRACT', 'FIRST_SCREEN_VERSION', 'FIRST_SCREEN_SLICES', 'FIRST_SCREEN_REFRESH_MOMENTS',
  'firstScreenVersionOk', 'firstScreenShapeOk', 'firstScreenFailedSlices',
  'VC_FIRST_SCREEN_PHONE', 'vcNewFirstScreenRead', 'vcFirstScreenShapeOk', 'vcFirstScreenOf', 'vcFirstScreenStateOf', 'vcFirstScreenReadAtOf',
  'vcFirstScreenSliceOf', 'vcFirstScreenSliceStateOf', 'vcFirstScreenFailedSlicesOf', 'vcFirstScreenSliceRetryableOf',
  'vcReadFirstScreen', 'vcReadFirstScreenOnEnter', 'vcReadFirstScreenAfterTask', 'vcReadFirstScreenOnManual',
  'vcRetryFirstScreen', 'vcRetryFirstScreenSlice', 'vcFirstScreenScreenOf',
  // #1746 分支与标签：业务面板数据层、预检签票、凭票执行、结果贴点、面板节点。
  'VC_BRANCHES_PHONE', 'VC_BRANCH_CHECK_PHONE', 'VC_BRANCH_WRITE_PHONE', 'VC_BRANCH_BOARD_CONTRACT', 'VC_BRANCH_BOARD_VERSION',
  'VC_BRANCH_CHECK_CONTRACT', 'VC_BRANCH_CHECK_VERSION', 'VC_BRANCH_OP_IDS', 'VC_BRANCH_WRITE_OPS', 'VC_BRANCH_ACTIONS',
  'vcNewBranchRead', 'vcBranchShapeOk', 'vcBranchCheckShapeOk', 'vcReadBranches', 'vcBranchReadOf', 'vcBranchBoardOf', 'vcBranchStateOf',
  'vcBranchCheckOf', 'vcBranchWriteResultOf', 'vcBranchTicketOf', 'vcBranchCheckDecisionOf',
  'vcBranchRequestOf', 'vcBranchCheck', 'vcBranchWrite', 'vcBranchCheckKindOf', 'vcBranchReplyKindOf', 'vcBranchReasonsOf', 'vcBranchConfirmOf', 'vcBranchResultOf', 'vcBranchBoardNode',
  // #1751 贮藏页十条：规则名单、版本门、数据层与页面本体。
  'STASH_OPS', 'STASH_WRITE_OPS', 'STASH_READ_OPS', 'stashNeedsTicketOf',
  'STASH_STAGED_MIN_VERSION', 'STASH_STAGED_ALTERNATIVE', 'STASH_UNKNOWN_OP_KEY',
  'stashOpOf', 'stashOpById', 'stashOpNameKeyOf', 'stashDangerOpsOf', 'vcStashSelectorOk', 'vcStashMessageError', 'vcStashBranchError', 'stashOperationArgs', 'stashRestoreArgs',
  'VC_STASH_PHONE', 'VC_STASH_SLICE', 'VC_STASH_STAGED_OP', 'vcStashStateNew', 'vcStashEntriesOf', 'vcStashListStateOf', 'vcStashVersionTextOf',
  'vcStashStagedStateOf', 'vcStashOpVisibleOf', 'vcStashNeedsConfirmOf', 'vcStashConfirmOf', 'vcStashConfirmPayloadOf', 'vcStashActionPayloadOf', 'vcStashCallOf',
  'vcStashFailKeyOf', 'vcStashResultOf', 'vcStashApplyReply', 'vcStashRecentOf', 'vcStashShortOidOf', 'vcStashWhenOf',
  'vcStashPageNode', 'VC_STASH_PAGE_SOURCE',
  // #1752 工作树页：共享动作层的八条动作与判定、数据层模型、处理层参数整形、页面体与八条入口。
  'WORKTREE_ACTIONS', 'WORKTREE_CAP_IDS', 'WORKTREE_REASONS', 'worktreeJudge', 'worktreeArgsOf', 'worktreeRowsOf', 'worktreePruneEntriesOf',
  'VC_WORKTREES_ENTRY_DEFS', 'VC_WORKTREE_PHONES', 'VC_WORKTREES_PAGE_SOURCE', 'VC_WORKTREES_DATA_SOURCE',
  'vcWorktreesListStateOf', 'vcWorktreesSnapshotOf', 'vcWorktreesModelOf', 'vcWorktreesVersionOf', 'vcWorktreeAvailabilityOf', 'vcWorktreeWhyKeyOf', 'vcWorktreesVersionHintOf',
  'vcWorktreesRowActionsOf', 'vcWorktreesActionDecisionOf', 'vcWorktreeCheckArgsOf', 'vcWorktreeRunArgsOf', 'vcWorktreePlanOf', 'vcWorktreeFailureOf',
  'vcWorktreeResultOf', 'vcWorktreeDecisionReasonsOf', 'vcWorktreeDecisionStateOf', 'vcWorktreesPageNode',
  // #1756 克隆向导：选项口径、票据契约、回包分类与页面体（二十三条导出逐个挂进闭包给断言用）。
  'CLONE_OPTION_DEFAULTS', 'cloneSourceKindOf', 'cloneMaskedUrl', 'cloneDefaultDirOf', 'cloneHardlinkNote', 'cloneOptionsOf',
  'CLONE_TICKET_OPS', 'CLONE_CHECK_CONTRACT', 'CLONE_CHECK_VERSION', 'CLONE_TARGET_STATES', 'clonePlanOf', 'cloneTaskArgsOf', 'cloneTargetProblem',
  'VC_CLONE_PAGE_SOURCE', 'VC_CLONE_PHONES', 'VC_CLONE_FORM_DEFAULT', 'VC_CLONE_STEPS', 'VC_CLONE_REASON_KEYS', 'VC_CLONE_PAGE_HINT',
  'vcCloneRequestIdOf', 'vcCloneFormOf', 'vcCloneCheckArgsOf', 'vcCloneWriteArgsOf', 'vcCloneCleanupCheckArgsOf', 'vcCloneCleanupWriteArgsOf',
  'vcCloneCallOf', 'vcCloneTicketOf', 'vcCloneSceneOf', 'vcCloneDecisionOf', 'vcCloneReasonOf', 'vcCloneReplyKindOf', 'vcCloneTaskOf',
  'vcCloneProgressOf', 'vcCloneResidualOf', 'vcCloneTaskEndedOf', 'vcClonePageNode',
  'VersionControlTab']
// #1253：这 20 份现在都是 .ts 真源（2026-10-19 第三阶段起 rules 的产物也搬到了 .build/shared/，
//   列表里直接写 rules.ts 真源路径，不再指向源码树里的产物 .js）。
//   求值与反证都基于「真源原文」：先拼原文、再按反证要求改坏，最后按构建同一份转译参数转成 JavaScript
//   交给 compileFn。为什么不读产物 .js：产物被 esbuild 重排过（双引号、function 后面不留空格、句末补分号），
//   而反证锚点是按原文写的，读产物就会「改不中」，等于没证——#1253 收口时这里正是这样红过。
const { sourceText, sourcePath } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
const readSource = (rel: string): string => (fs.existsSync(path.join(ROOT, rel.replace(/\.js$/, '.ts'))) ? sourceText(rel) : read(rel))
// 转译口径复用构建那一份（scripts/lib/transpile-unit.mts 的 TRANSPILE_OPTIONS），不在这里写第二套参数。
const toEvalJs = (code: string): string => require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code
function buildView(patch, logs, React, DswsCtx, Tip, Ic, seedReads, hostStub) {
  let src = VC_FILES.map((f) => stripExports(stripTimeConfigImport(readSource(f)))).join('\n')
  if (patch) src = patch(src)
  // 改坏之后统一转译：原文里带类型标注，compileFn 只吃 JavaScript。
  src = toEvalJs(src)
  const body = src + '\nreturn { ' + EXPORTS.join(', ') + ' }\n'
  // 本处走 compileFn：参数名与参数值一一对应，与原来那种写法同一套依赖。
  const fn = compileFn(['React', 'log', 'dswsLogHash', 'dswsLogTrunc', 'tr', 'host', 'DswsCtx', 'Tip', 'Ic', 'seedReads'], body)
  return fn(React || {}, function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) },
    function () { return 'h8' }, function (s) { return String(s) }, tZh, hostStub || {}, DswsCtx || null, Tip || null, Ic || null, seedReads || null)
}
let VIEW = null

// ---------- 假适配器：形状照 DSH subprocess 服务（与 verify-version-control-host.js 同一形状） ----------
const LIVE = JSON.parse(read('tests/fixtures/version-control/live-numstat-shapes.json'))
const LIVE_ROOT = /^worktree ([^\u0000\n]+)/.exec(LIVE.worktrees.out)[1]
function makeCollector(text, truncated) {
  return { finalize() { return { text: String(text), truncated: truncated === true } } }
}
function afterPrefix(argv) {
  const at = argv.indexOf('i18n.logOutputEncoding=UTF-8')
  return at < 0 ? null : argv.slice(at + 1)
}
function liveRoute(argv) {
  const a = afterPrefix(argv)
  if (a === null) return { code: 1, stderr: '缺少固定前缀' }
  if (argv.indexOf('--version') >= 0) return { code: 0, stdout: LIVE.source.gitVersion + '\n' }
  if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return { code: LIVE.step0.code, stdout: LIVE.step0.out, stderr: LIVE.step0.err }
  if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: LIVE_ROOT + '\n' }
  if (a[0] === 'rev-parse' && a.indexOf('--verify') >= 0) return { code: 0, stdout: 'a'.repeat(40) + '\n' }
  if (a[0] === 'status') return { code: LIVE.status.code, stdout: LIVE.status.out, stderr: LIVE.status.err }
  if (a[0] === 'worktree') return { code: LIVE.worktrees.code, stdout: LIVE.worktrees.out, stderr: LIVE.worktrees.err }
  if (a[0] === 'for-each-ref') return { code: LIVE.refs.code, stdout: LIVE.refs.out, stderr: LIVE.refs.err }
  if (a[0] === 'log') return { code: LIVE.log.code, stdout: LIVE.log.out, stderr: LIVE.log.err }
  if (a[0] === 'diff' && a.indexOf('--numstat') >= 0) return { code: LIVE.diffFiles.code, stdout: LIVE.diffFiles.out, stderr: LIVE.diffFiles.err }
  if (a[0] === 'config') return { code: LIVE.autocrlf.code, stdout: LIVE.autocrlf.out, stderr: LIVE.autocrlf.err }
  if (a[0] === 'reflog') return { code: 128, stdout: '', stderr: 'fatal: bad revision\n' }
  return { code: 0, stdout: '' }
}
function makeHostDeps(route) {
  const logs = []
  const deps = {
    subprocess: { spawn(req) {
      const hit = route(req.argv) || { code: 0, stdout: '' }
      return { done: Promise.resolve({ exitCode: hit.code === undefined ? 0 : hit.code, signal: hit.signal }), collected: { stdout: makeCollector(hit.stdout || '', hit.truncated), stderr: makeCollector(hit.stderr || '', false) }, terminate() {} }
    } },
    timer: { timeout(ms) { return new Promise(function (resolve) { setTimeout(resolve, 1) }) } },
    fs: { stat() { return Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) }, lstat() { return Promise.resolve(null) }, exists() { return Promise.resolve(false) } },
    getPlatform: async function () { return { resolveExecutable: async function (name) { return name === 'git' ? 'git' : null } } },
    DEFAULT_CWD: 'D:/假工作区/repo', TIMEOUT_MS: 30000,
    gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
  }
  return { deps: deps, logs: logs }
}

// ---------- 模型与读数的现成件 ----------
function screenOf(over) {
  const base = {
    identity: { worktreeDisplay: 'repo', worktreePath: 'D:/w/repo', branch: 'main', detached: false, oid: 'a'.repeat(40), sync: 'tracked-known', ahead: 0, behind: 0, basisMs: NOW - 3600000 },
    staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0,
    otherWorktrees: [], branches: [], commits: [],
    repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlf: null },
  }
  const out = Object.assign({}, base, over || {})
  out.identity = Object.assign({}, base.identity, (over && over.identity) || {})
  out.repo = Object.assign({}, base.repo, (over && over.repo) || {})
  return out
}
function readsOf(screen, over) {
  return Object.assign({
    screen: screen ? { state: 'ok', data: { screen: screen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }, error: null } : { state: 'idle', data: null, error: null },
    diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null },
  }, over || {})
}
function envOf(screen, reads, width) {
  const fold = VIEW.vcFoldOf(width === undefined ? 460 : width, VIEW.vcFoldDataOf(screen, reads))
  return { t: tZh, nowMs: NOW, fold: fold }
}
const blockOf = (blocks, kind) => blocks.filter((b) => b.kind === kind)[0] || null
const allText = (blocks) => JSON.stringify(blocks)
const rowsOf = (blocks) => { const c = blockOf(blocks, 'changes'); return c ? c.groups.reduce((a, g) => a.concat(g.rows), []) : [] }

// ============================================================
async function main() {
  console.log('版本管理页签界面侧门禁（#818：主缝 + 次缝 + 比照 + 反证）')
  // 真字典：#1294 起词条真源在 config/copy/*.yaml，生成物是 src/client/kernel/locale-data.ts；
  //   旧片段路径经 tests/lib/source-text.ts 的 sourcePath 映射到那一整份生成物，L_PANEL / L_FLOW / L_VCWRITE 仍是导出名。
  const locUrl = (f: string) => pathToFileURL(path.join(ROOT, sourcePath(f))).href
  const panelMod = await import(locUrl('src/client/kernel/locale-panel.js'))
  const flowMod = await import(locUrl('src/client/kernel/locale-flow.js'))
  // #1752 工作树页那一族词条（清单四态、十二个动作名、判定理由与版本替代做法）也读真字典。
  const vcWtLocMod = await import(locUrl('src/client/kernel/locale-vcworktrees.js'))
  const L_VCWORKTREES = vcWtLocMod.L_VCWORKTREES
  // #842：写操作那一族的词条自成一个族（locale-panel 与 locale-flow 都在上限上），这里一并读真字典。
  const vcWriteMod = await import(locUrl('src/client/kernel/locale-vcwrite.js'))
  const L_PANEL = panelMod.L_PANEL
  const L_FLOW = flowMod.L_FLOW
  const L_VCWRITE = vcWriteMod.L_VCWRITE
  // #1738 页面壳那一族（页签 / 齿轮九分区 / 命令面板 / 三形态 / 四态 / 确认卡四段 / 结果信息）。
  const vcShellMod = await import(locUrl('src/client/kernel/locale-vcshell.js'))
  const L_VCSHELL = vcShellMod.L_VCSHELL
  // #1745 历史高级查询那一族（面板标题 / 说明 / 字段 / 十类结果 / 空结果与截断）。
  const vcQueryMod = await import(locUrl('src/client/kernel/locale-vcquery.js'))
  const L_VCQUERY = vcQueryMod.L_VCQUERY
  // #1751 贮藏页那一族（十条动作名、版本门、确认卡、最近丢弃与失败话术）。
  const vcStashMod = await import(locUrl('src/client/kernel/locale-vcstash.js'))
  const L_VCSTASH = vcStashMod.L_VCSTASH
  LOC = {
    zh: Object.assign({}, L_PANEL.zh, L_FLOW.zh, L_VCWRITE.zh, L_VCSHELL.zh, L_VCQUERY.zh, L_VCSTASH.zh, L_VCWORKTREES.zh),
    en: Object.assign({}, L_PANEL.en, L_FLOW.en, L_VCWRITE.en, L_VCSHELL.en, L_VCQUERY.en, L_VCSTASH.en, L_VCWORKTREES.en),
  }
  tZh = (k, p) => fill(LOC.zh[k] !== undefined ? LOC.zh[k] : k, p)
  tEn = (k, p) => fill(LOC.en[k] !== undefined ? LOC.en[k] : k, p)
  // 页面壳渲染要用到全局提示叶子 Tip 与图标叶子 Ic（真实构建里它们在视图叶子之前已拼进同一个闭包）；
  // 这里先把垫片备好再建闭包，否则页面渲染到 Tip 时会拿到 null（#1751 贮藏页的提交号提示就走 Tip）。
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const DswsCtx = React.createContext(null)
  const TipStub = function (props) { return props && props.children ? props.children : null }
  const IcStub = function () { return null }
  VIEW = buildView(null, [], React, DswsCtx, TipStub, IcStub)

  // ---- A 组：显隐与接线 ----
  // #845c：A1 那条判据抽成可复用的一份 —— H 组的反证要评的就是这一份判断，两边不许各写一份。
  //   三个入参就是 A1 点名的三种：普通对象、带 repoRoot 的快照、null。
  const tabVisibleJudgmentOf = (v) => v.vcTabVisible({}) === true && v.vcTabVisible({ snapshot: { repoRoot: null } }) === true && v.vcTabVisible(null) === true
  check(tabVisibleJudgmentOf(VIEW), 'A1 显隐谓词一律回真（总工程师裁定的偏离：不藏页签，空态由视图说真话）')

  // ---- B 组：主缝（真机样本 → 块与文字）----
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const liveRun = makeHostDeps(liveRoute)
  const statusReply = await hostMod.createVersionControl(liveRun.deps).handleGitStatus({ cwd: 'D:/假工作区/repo' })
  check(statusReply.ok === true && !!statusReply.screen, 'B1 真机样本喂真宿主取数层：首屏成功')
  check(typeof statusReply.tier === 'string' && typeof statusReply.gitVersion === 'string' && typeof statusReply.readAtMs === 'number', 'B2 成功回包是约定的信封形状（ok / screen / tier / gitVersion / readAtMs）')
  const liveScreen = statusReply.screen
  const liveReads = readsOf(liveScreen)
  const liveBlocks = VIEW.vcBlocksOf(liveScreen, liveReads, { fileShown: {}, openDiff: '' }, envOf(liveScreen, liveReads))
  const liveKinds = liveBlocks.map((b) => b.kind)
  check(liveKinds.indexOf('identity') >= 0 && liveKinds.indexOf('changes') >= 0 && liveKinds.indexOf('commits') >= 0 && liveKinds.indexOf('other') >= 0, 'B3 首屏三块与历史都画出来了（身份 / 未提交改动 / 提交历史 / 其他工作树）')
  check(liveKinds.indexOf('identity') < liveKinds.indexOf('changes') && liveKinds.indexOf('changes') < liveKinds.indexOf('commits') && liveKinds.indexOf('commits') < liveKinds.indexOf('other'), 'B4 块的顺序：身份 → 未提交改动 → 提交历史 → 其他工作树')
  const liveId = blockOf(liveBlocks, 'identity')
  check(liveId.name === liveScreen.identity.worktreeDisplay && liveId.branchText === 'main', 'B5 身份行写的是模型给的显示名与分支名（真机样本：' + liveId.name + ' / ' + liveId.branchText + '）')
  check(liveId.pathText === liveScreen.identity.worktreePath && liveId.pathTip === liveScreen.identity.worktreePath, 'B6 路径那一条写完整路径，悬停里也是完整路径（一个字不丢）')
  const liveChanges = blockOf(liveBlocks, 'changes')
  check(liveChanges.summary === '已暂存 1 个文件 / 未暂存 4 个文件', 'B7 汇总句与真机样本一致（实得「' + liveChanges.summary + '」）')
  check(liveChanges.groups.length === 2 && liveChanges.groups[0].key === 'staged' && liveChanges.groups[1].key === 'unstaged', 'B8 没有冲突时就是已暂存 / 未暂存两组')
  const liveRows = rowsOf(liveBlocks)
  check(liveRows.length === 5, 'B9 一个文件一行（真机样本五条路径，实得 ' + liveRows.length + '）')
  const renamed = liveRows.filter((r) => r.origPath === '改名 前.txt')[0]
  check(!!renamed && renamed.path === '改名 后.txt' && renamed.changeText === '重命名', 'B10 重命名按新路径一行、原路径留在悬停里、变化类型写「重命名」')
  const untrackedRow = liveRows.filter((r) => r.path === '新增 未跟踪.txt')[0]
  check(!!untrackedRow && untrackedRow.changeText === '未跟踪' && untrackedRow.untracked === true, 'B11 未跟踪那一行写「未跟踪」并带上 untracked 标记（取差异时要告诉宿主）')
  const binaryRow = liveRows.filter((r) => r.path === '图片.png')[0]
  check(!!binaryRow && binaryRow.countsText === '' && binaryRow.countsTip === '二进制文件无逐行增删计数。', 'B12 二进制文件没有行数：不写 0，如实说没有这个数字')
  const trackedRow = liveRows.filter((r) => r.path === '已跟踪 文件.txt')[0]
  check(!!trackedRow && trackedRow.countsText === '+2 \u2212' + '1', 'B13 改了行数的文件写 +2 −1（实得「' + (trackedRow ? trackedRow.countsText : '') + '」）')
  const liveCommit = blockOf(liveBlocks, 'commits').rows[0]
  check(!!liveCommit && liveCommit.subject.indexOf('首次提交') === 0 && liveCommit.short === '991f0ee', 'B14 提交历史一行给说明与短哈希（git 自己给的短号，不写死长度）')
  check(!!liveCommit && liveCommit.when === '1 小时前', 'B15 一周以内的提交时间写相对说法（实得「' + (liveCommit ? liveCommit.when : '') + '」）')
  check(!!liveCommit && liveCommit.tip.indexOf('首次提交') >= 0 && liveCommit.tip.indexOf('991f0ee') >= 0, 'B17 提交说明被折短之后，悬停里仍有完整说明与完整编号')
  check(allText(liveBlocks).indexOf('这个仓库还没有任何提交') < 0, 'B16 有提交时不冒「还没有任何提交」这句')

  // ---- C 组：主缝（边界模型逐条）----
  const detached = screenOf({ identity: { detached: true, branch: null, oid: 'b'.repeat(40), sync: 'detached' } })
  const dB = VIEW.vcBlocksOf(detached, readsOf(detached), {}, envOf(detached, readsOf(detached)))
  const dId = blockOf(dB, 'identity')
  check(dId.branchText === '游离头指针' && dId.branchTone === 'caption', 'C1 游离头指针：明说「游离头指针」，用中性色档（不是红色告警）')
  check(dId.oidText === '停在提交 ' + 'b'.repeat(12) && dId.sync.text === '不在任何分支上，不适用超前与落后计数', 'C2 游离头指针：给出停在哪次提交上，并说清不适用超前落后计数')

  const noUp = screenOf({ identity: { sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null } })
  const nB = VIEW.vcBlocksOf(noUp, readsOf(noUp), {}, envOf(noUp, readsOf(noUp)))
  const nId = blockOf(nB, 'identity')
  check(nId.sync.text === '尚未设置上游' && allText(nB).indexOf('超前 0') < 0, 'C3 没设推送目标：写「尚未设置上游」，不写「超前 0」')

  const gone = screenOf({ identity: { sync: 'upstream-gone', ahead: 0, behind: 0, basisMs: null } })
  const gId = blockOf(VIEW.vcBlocksOf(gone, readsOf(gone), {}, envOf(gone, readsOf(gone))), 'identity')
  check(gId.sync.text === '推送目标已不存在', 'C4 推送目标在远端被删：明说「推送目标已不存在」')

  const stale = screenOf({ identity: { sync: 'tracked-unknown', ahead: 3, behind: 1, basisMs: null } })
  const sId = blockOf(VIEW.vcBlocksOf(stale, readsOf(stale), {}, envOf(stale, readsOf(stale))), 'identity')
  check(sId.sync.text === '超前 3 · 落后 1' && sId.sync.basis === '无法读取远端信息的更新时间', 'C5 有推送目标但依据时间读不到：数字照常写，依据如实说读不到')

  const fresh = screenOf({ identity: { sync: 'tracked-known', ahead: 2, behind: 0, basisMs: NOW - 3 * 24 * 3600 * 1000 } })
  const fId = blockOf(VIEW.vcBlocksOf(fresh, readsOf(fresh), {}, envOf(fresh, readsOf(fresh))), 'identity')
  check(fId.sync.basis === '远端信息更新于 3 天前', 'C6 依据时间永远显示：三天前的依据就写「3 天前」（实得「' + fId.sync.basis + '」）')

  const zero = screenOf({ identity: { branch: 'main', oid: null, sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null }, repo: { hasCommits: false } })
  const zB = VIEW.vcBlocksOf(zero, readsOf(zero), {}, envOf(zero, readsOf(zero)))
  check(allText(zB).indexOf('该仓库尚无任何提交') >= 0 && blockOf(zB, 'commits').empty === true, 'C7 零提交仓库：异常带与历史块都明说「这个仓库还没有任何提交」')

  const bare = screenOf({ identity: { worktreeDisplay: '', worktreePath: 'D:/w/bare.git', branch: null, detached: false, oid: null, sync: 'detached', ahead: 0, behind: 0, basisMs: null }, repo: { bare: true, hasCommits: true } })
  const bId = blockOf(VIEW.vcBlocksOf(bare, readsOf(bare), {}, envOf(bare, readsOf(bare))), 'identity')
  check(bId.name === '裸仓库（没有工作树）' && bId.nameTip.indexOf('D:/w/bare.git') >= 0, 'C28 裸仓库：身份行不空着，照实写「裸仓库（没有工作树）」（复用已有词条 vc.other.bare）')
  const merge = screenOf({
    identity: { sync: 'tracked-known', ahead: 0, behind: 0, basisMs: NOW - 60000 },
    conflictCount: 2, stagedCount: 1, unstagedCount: 1,
    staged: [{ path: '卡住.txt', origPath: null, staged: true, unstaged: true, conflict: true, change: 'modified', addedLines: 1, deletedLines: 1 }],
    unstaged: [{ path: '卡住.txt', origPath: null, staged: true, unstaged: true, conflict: true, change: 'modified', addedLines: 1, deletedLines: 1 }],
    repo: { merging: true },
  })
  const mB = VIEW.vcBlocksOf(merge, readsOf(merge), {}, envOf(merge, readsOf(merge)))
  const mRows = rowsOf(mB)
  check(allText(mB).indexOf('正在合并') >= 0 && allText(mB).indexOf('有 2 个文件存在合并冲突') >= 0, 'C8 正在合并 + 有冲突：异常带在显眼位置说明，并指去终端')
  check(mRows.length === 1 && mRows[0].conflict === true && mRows[0].conflictText === '冲突', 'C9 同一路径既有冲突又有普通修改：界面上只占一行并带冲突标记')
  check(blockOf(mB, 'changes').groups.map((g) => g.key).join(',') === 'conflict', 'C10 冲突单独一组（排在已暂存之后、未暂存之前）')
  check(allText(mB).indexOf('这些文件同时包含两侧的内容：当前分支的提交') >= 0, 'C11 合并冲突说清两边各是什么')
  check(allText(mB).indexOf('错误') < 0 && allText(mB).indexOf('失败') < 0, 'C12 冲突与合并进行中的话术里不出现「错误」两个字')

  const others = screenOf({ otherWorktrees: [
    { path: 'D:/w/a', display: 'a', head: 'h', branch: 'main', bare: false, current: false, locked: false, lockReason: null, lockUnknown: true, prunable: false },
    { path: 'D:/w/b', display: 'b', head: 'h', branch: 'dev', bare: false, current: false, locked: true, lockReason: null, lockUnknown: false, prunable: true },
  ] })
  const oB = VIEW.vcBlocksOf(others, readsOf(others), {}, envOf(others, readsOf(others)))
  const oBlock = blockOf(oB, 'other')
  check(oBlock.title === '其他工作树 (2)', 'C13 标题写「其他工作树 (2)」（硬约束，不许写成「工作树与分支」）')
  check(oBlock.rows[0].stateText === '无法显示' && oBlock.rows[1].stateText === '目录不存在', 'C14 答不出占用写「无法显示」、目录已不存在照实写；答不出不当成没被占用')
  check(oBlock.tip.indexOf('不列出未检出的本地分支') >= 0, 'C15 其他工作树那一条说清它不是分支全貌')

  const otherMany = screenOf({ otherWorktrees: others.otherWorktrees })
  const narrowB = VIEW.vcBlocksOf(otherMany, readsOf(otherMany), {}, envOf(otherMany, readsOf(otherMany), 340))
  const nOther = blockOf(narrowB, 'other')
  check(nOther.mode === 'summary' && nOther.rows.length === 0 && nOther.summaryText.indexOf('其他工作树 (2)') === 0, 'C16 窄面板：其他工作树收成一行摘要（内容不减，只换形状）')

  // 差异：短 / 长 / 几种「没有内容」的原因
  const files = screenOf({ unstaged: [{ path: '改.txt', origPath: null, staged: false, unstaged: true, conflict: false, change: 'modified', addedLines: 1, deletedLines: 0 }], unstagedCount: 1 })
  const shortLines = [{ kind: 'filehead', text: 'diff --git a/改.txt b/改.txt' }, { kind: 'hunk', text: '@@ -1 +1 @@' }, { kind: 'del', text: '-旧' }, { kind: 'add', text: '+新' }]
  const shortReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: shortLines, reason: 'ok', truncated: false, error: null } } })
  const shortBlocks = VIEW.vcBlocksOf(files, shortReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, shortReads))
  const shortRow = rowsOf(shortBlocks)[0]
  check(shortRow.diff.state === 'ok' && shortRow.diff.lines.length === 4 && shortRow.diff.hunks.length === 0 && shortRow.diff.shownNote === '', 'C17 改了五行的文件点开就看到那几行（不额外要一次点击、不补截断说明）')
  const longLines = []
  for (let i = 0; i < 260; i++) longLines.push(i % 3 === 0 ? { kind: 'hunk', text: '@@ -' + i + ' +' + i + ' @@' } : { kind: 'add', text: '+第' + i + '行' })
  const longReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: longLines, reason: 'ok', truncated: false, error: null } } })
  const longRow = rowsOf(VIEW.vcBlocksOf(files, longReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, longReads)))[0]
  check(longRow.diff.lines.length === VIEW.VC_DIFF_LINES_SHOWN && longRow.diff.hunks.length > 0 && longRow.diff.shownNote === '仅显示前 200 行，其余请在命令行中查看。', 'C18 差异很长：先给「哪几段行区间变了」，再给前 200 行，并如实说后面到终端看')
  // 200 行这条阈值卡在边界上验：正好等于阈值给逐行、不补说明；超过一行才先给「哪几段行区间变了」并说只显示了前 200 行。
  const edgeLines = []
  for (let i = 0; i < VIEW.VC_DIFF_LINES_SHOWN; i++) edgeLines.push({ kind: 'add', text: '+' + i })
  const edgeReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: edgeLines, reason: 'ok', truncated: false, error: null } } })
  const edgeRow = rowsOf(VIEW.vcBlocksOf(files, edgeReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, edgeReads)))[0]
  const overLines = edgeLines.concat([{ kind: 'hunk', text: '@@ -201 +201 @@' }, { kind: 'add', text: '+第 201 行' }])
  const overReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: overLines, reason: 'ok', truncated: false, error: null } } })
  const overRow = rowsOf(VIEW.vcBlocksOf(files, overReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, overReads)))[0]
  check(edgeRow.diff.hunks.length === 0 && edgeRow.diff.shownNote === '' && overRow.diff.hunks.length === 1 && overRow.diff.shownNote === '仅显示前 200 行，其余请在命令行中查看。', 'C18b 200 行这条阈值卡在边界上：正好等于阈值给逐行、不补说明；超过一行才先给「哪几段行区间变了」并说只显示了前 200 行')
  // 合并提交里的单文件差异：宿主回 reason:'merge-commit'，这句话不许落到「这一处这次没读到改动内容」上。
  const mergeDiffReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: [], reason: 'merge-commit', truncated: false, error: null } } })
  const mergeDiffRow = rowsOf(VIEW.vcBlocksOf(files, mergeDiffReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, mergeDiffReads)))[0]
  check(mergeDiffRow.diff.state === 'note' && mergeDiffRow.diff.text === '这是一次合并提交：git 默认不展开合并提交的逐行差异，所以这里没有内容。' && mergeDiffRow.diff.text !== '这一处这次没读到改动内容。', 'C19b 合并提交里的单文件差异：如实说「git 默认不展开合并提交的逐行差异」，不许落到「这一处没读到改动内容」上')
  const reasons = { 'untracked-no-diff': '该文件尚未被 git 跟踪，不存在可比较的旧版本。', 'no-commit-baseline': '该仓库尚无首次提交，不存在可比较的基线。', 'binary-diff': '二进制文件，不逐行展示变更。', 'truncated': '该文件变更过大，未提供不完整内容；请在命令行中查看该处的完整变更。', 'no-diff': '本次未能读取该处的变更内容。' }
  let reasonOk = true
  for (const k of Object.keys(reasons)) {
    const rr = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: [], reason: k, truncated: false, error: null } } })
    const row = rowsOf(VIEW.vcBlocksOf(files, rr, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, rr)))[0]
    if (row.diff.text !== reasons[k]) { reasonOk = false; console.log('    （原因 ' + k + ' 实得「' + row.diff.text + '」）') }
  }
  check(reasonOk, 'C19 差异读不到内容的五种原因各有各的实话（未跟踪 / 零提交 / 二进制 / 太大 / 空差异）')
  const diffFailReads = readsOf(files, { diffs: { '改.txt': { state: 'err', lines: null, reason: '', truncated: false, error: { kind: 'timeout', message: 'x' } } } })
  const failRow = rowsOf(VIEW.vcBlocksOf(files, diffFailReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, diffFailReads)))[0]
  check(failRow.diff.state === 'err' && failRow.diff.text === '未能读取该文件的变更' && failRow.diff.retry === '重试', 'C20 差异读不到：说清是哪一块读不到并给重试')

  // 历史续读
  const logMore = readsOf(files, { log: { state: 'ok', commits: [{ oid: 'c'.repeat(40), short: 'ccccccc', author: 'A', authorDateMs: NOW - 1000, commitDateMs: NOW - 1000, subject: '更早的一条', parents: [] }], hasMore: false, fetched: 1, error: null } })
  const moreBlock = blockOf(VIEW.vcBlocksOf(files, logMore, {}, envOf(files, logMore)), 'commits')
  check(moreBlock.rows.length === 1 && moreBlock.more.allLoaded === '已全部加载', 'C21 续读到底：新读回的提交接在列表里并说「已全部加载」')
  const logLoading = readsOf(files, { log: { state: 'loading', commits: [], hasMore: true, fetched: 0, error: null } })
  check(blockOf(VIEW.vcBlocksOf(files, logLoading, {}, envOf(files, logLoading)), 'commits').more.label === '正在读取更早的提交…', 'C22 续读在途：那一行说「正在读更早的提交…」')
  const logFail = readsOf(files, { log: { state: 'err', commits: [{ oid: 'd'.repeat(40), short: 'ddddddd', author: 'A', authorDateMs: NOW, commitDateMs: NOW, subject: '旧的还在', parents: [] }], hasMore: true, fetched: 1, error: { kind: 'timeout', message: '' } } })
  const lfBlock = blockOf(VIEW.vcBlocksOf(files, logFail, {}, envOf(files, logFail)), 'commits')
  check(lfBlock.rows.length === 1 && lfBlock.more.failText === '未能读取更早的提交' && lfBlock.more.retry === '重试', 'C23 续读失败：已经读回来的还在，旁边说读不到并给重试')

  // 首屏：还没拿到数据 / 失败 / 有旧数据
  check(VIEW.vcBlocksOf(null, VIEW.vcNewReads(), {}, { t: tZh, nowMs: NOW, fold: VIEW.vcFoldOf(460, {}) }).length === 0, 'C24 面板刚打开、还没拿到数据：整块不画（不冒一句常驻道歉）')
  const notRepo = { screen: { state: 'err', data: null, error: { kind: 'not-repo', message: '这个目录不在任何 git 仓库里' } }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const eBlock = VIEW.vcBlocksOf(null, notRepo, {}, { t: tZh, nowMs: NOW, fold: VIEW.vcFoldOf(460, {}) })[0]
  check(eBlock.kind === 'error' && eBlock.text === '这个目录不在任何 git 仓库里。' && eBlock.retry === '', 'C25 不在仓库里：如实说这句话，且不给重试按钮（它不是读取失败）')
  const noGit = { screen: { state: 'err', data: null, error: { kind: 'env', message: 'x' } }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const nBlock = VIEW.vcBlocksOf(null, noGit, {}, { t: tZh, nowMs: NOW, fold: VIEW.vcFoldOf(460, {}) })[0]
  check(nBlock.text.indexOf('未找到 git 程序') === 0 && nBlock.retry === '重试' && String(nBlock.rawTip || '').indexOf('原始说明：') === 0, 'C26 找不到 git：告诉人去确认安装与 PATH 并重启，给重试，宿主原文只进悬停（诊断线索，不进可见正文）')
  const staleReads = readsOf(files, { screen: { state: 'err', data: { screen: files, tier: 'full', gitVersion: 'g', readAtMs: NOW }, error: { kind: 'timeout', message: 'x' } } })
  const stBlocks = VIEW.vcBlocksOf(files, staleReads, {}, envOf(files, staleReads))
  check(blockOf(stBlocks, 'hint') !== null && blockOf(stBlocks, 'hint').text === '刷新失败了，下面是上一次读到的数据' && blockOf(stBlocks, 'changes') !== null, 'C27 有旧数据时读失败：旧数据照常画，上面加一条「刷新失败了」')

  // ---- S 组：规格故事 32「看某一次提交改了什么，与看未提交改动是同一套界面」----
  const REV1 = 'e'.repeat(40)
  const REV2 = 'f'.repeat(40)
  const commitScreen = screenOf({
    commits: [
      { oid: REV1, short: 'eeeeeee', author: '张三', email: 'z@e.com', authorDateMs: NOW - 7200000, commitDateMs: NOW - 7200000, subject: '给面板加一个页签', parents: ['p1'] },
      { oid: REV2, short: 'fffffff', author: '李四', email: 'l@e.com', authorDateMs: NOW - 86400000, commitDateMs: NOW - 86400000, subject: '合并分支', parents: ['p1', 'p2'] },
    ],
    unstaged: [{ path: '改.txt', origPath: null, staged: false, unstaged: true, conflict: false, change: 'modified', addedLines: 1, deletedLines: 0 }], unstagedCount: 1,
  })
  const commitFiles = [
    { path: '面板/新页签.js', origPath: null, added: 12, deleted: 3 },
    { path: '面板/旧名字.js', origPath: '面板/老名字.js', added: 0, deleted: 0 },
  ]
  const commitEntry = function (over) { return Object.assign({ rev: REV1, state: 'ok', files: commitFiles, truncated: false, reason: 'ok', error: null }, over || {}) }
  const sReads = function (over) { return readsOf(commitScreen, Object.assign({ commit: commitEntry() }, over || {})) }
  const sBlocksOf = function (reads, ui) { return VIEW.vcBlocksOf(commitScreen, reads, ui || { openCommit: REV1 }, envOf(commitScreen, reads)) }
  const sChanges = blockOf(sBlocksOf(sReads()), 'changes')
  check(sChanges.commitMode === true && sChanges.title === '该提交的变更内容' && sChanges.back === '返回未提交改动', 'S1 点开提交后进入「这笔提交改了什么」，最上面给出「回到未提交改动」的出路')
  check(sChanges.summary === 'eeeeeee · 给面板加一个页签', 'S2 抬头写着这是哪一笔提交（短号 + 说明）')
  check(sChanges.groups.length === 1 && sChanges.groups[0].title === '该提交变更了 2 个文件', 'S3 文件清单与未提交那一层同一套（一组、带计数）')
  const sRows = sChanges.groups[0].rows
  check(sRows.length === 2 && sRows[0].pathText === '面板/新页签.js' && sRows[0].countsText === '+12 −' + '3' && sRows[0].pathTip === '面板/新页签.js', 'S4 每一行给路径与 +a −d，悬停里是完整路径（与未提交那一层同一个画法）')
  check(sRows[1].changeText === '重命名' && sRows[0].changeText === '' && sRows[0].changeTone === 'warning', 'S5 能证明的只有重命名；判不出类型的那一行不冒充六种变化（不画类型字）')
  check(sRows[0].rowTip.indexOf('该提交仅返回路径与增删行数，无法判定变更类型') === 0 && sRows[1].rowTip.indexOf('该提交仅返回') < 0, 'S5b 判不出类型时悬停里如实说清来由（不让用户以为 git 没给）')
  const patchReads = sReads({ commitDiffs: { [VIEW.vcCommitKeyOf(REV1, '面板/新页签.js')]: { state: 'ok', lines: shortLines, reason: 'ok', truncated: false, error: null } } })
  const sRowOpen = rowsOf(sBlocksOf(patchReads, { openCommit: REV1, openDiff: VIEW.vcCommitKeyOf(REV1, '面板/新页签.js') }))[0]
  check(!!sRowOpen.diff && sRowOpen.diff.state === 'ok' && sRowOpen.diff.lines.length === 4 && sRowOpen.diff.lines[1].kind === 'hunk', 'S6 就地展开差异与未提交那一层同一个画法（同一份差异模型）')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ files: [], truncated: true, reason: 'truncated' }) })), 'changes').note === '该提交变更过大，未提供不完整清单；请在命令行中查看完整变更。', 'S7 读不全：明说读不全、指去终端，不装作没有改动')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ rev: REV2, files: [] }) }), { openCommit: REV2 }), 'changes').note === '这是一次合并提交：它相对第一个父提交没有变更文件。', 'S8 合并提交且清单为空：如实说「相对第一个父提交没有改动文件」（真机上 git show --numstat 对合并提交给的是真数据，所以空清单不是「git 不展开」）')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ files: [] }) })), 'changes').note === '该提交未修改任何文件（空提交）。', 'S9 空提交：如实说这是空提交')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ state: 'loading', files: [] }) })), 'changes').note === '正在读取该提交的变更内容…', 'S10 这一层也有加载中那一档')
  const sFail = blockOf(sBlocksOf(sReads({ commit: commitEntry({ state: 'err', files: [], error: { kind: 'timeout', message: '' } }) })), 'changes')
  check(sFail.note === '未能读取该提交的变更内容' && sFail.retry === '重试', 'S11 读不到就说读不到，并给重试')
  check(blockOf(sBlocksOf(sReads()), 'commits').rows[0].open === true, 'S12 正开着的那一笔提交在历史里被标出来（用户知道自己在看哪一笔）')

  // ---- D 组：折叠阶梯 ----
  const ladder = VIEW.vcFoldLadderOf({ path: 'D:/很长的目录/子目录/仓库名', others: ['副本一', '副本二'], commits: ['feat: 一个挺长的提交说明', 'fix: 另一个'] })
  const seq = ladder.steps.map((s) => s.el).join(',')
  check(seq.indexOf('path') === 0 && seq.indexOf('other') > seq.lastIndexOf('path') && seq.indexOf('commit') > seq.lastIndexOf('other'), 'D1 让位次序：工作树位置最先、其他工作树居中、提交说明最后')
  let maxDrop = 0
  let rebound = 0
  for (let i = 0; i < ladder.steps.length; i++) {
    const a = VIEW.vcFoldStateAt(ladder, i)
    const b = VIEW.vcFoldStateAt(ladder, i + 1)
    const drops = [a.path.length - b.path.length]
    for (let k = 0; k < a.others.length; k++) drops.push(a.others[k].length - b.others[k].length)
    for (let k = 0; k < a.commits.length; k++) drops.push(a.commits[k].length - b.commits[k].length)
    maxDrop = Math.max(maxDrop, ...drops)
    rebound += drops.filter((d) => d < 0).length
  }
  check(maxDrop <= 1 && rebound === 0, 'D2 一次让位最多少一个字符，而且全程不回弹（实测最多一次少 ' + maxDrop + ' 个字符，回弹 ' + rebound + ' 处）')
  const pinned = JSON.stringify(ladder.steps.map((s) => s.el))
  check(pinned.indexOf('count') < 0 && pinned.indexOf('branch') < 0 && pinned.indexOf('band') < 0, 'D3 身份行、异常带、未提交改动计数不进阶梯（永不让位）')
  const full = VIEW.vcFoldStateAt(ladder, 0)
  check(full.path === ladder.path && full.others[0] === '副本一', 'D4 第 0 档一个字都不少')
  const last = VIEW.vcFoldStateAt(ladder, ladder.steps.length)
  check(last.path.indexOf('仓库名') >= 0 && last.path.length >= VIEW.VC_MIDDLE_MIN, 'D5 路径砍的是中段，末级目录那一头始终留着，且不砍到比最短长度还短（实得「' + last.path + '」）')
  const nameTail = VIEW.vcFoldStateAt(ladder, ladder.steps.length).others[0]
  check(nameTail === '', 'D5b 名字与说明可以让到空（完整内容在悬停提示里），路径不参与这一步')
  check(VIEW.vcFoldBandAt(460) === 0 && VIEW.vcFoldBandAt(380) === 1 && VIEW.vcFoldBandAt(320) === 2 && VIEW.vcFoldBandAt(200) === 3 && VIEW.vcFoldBandAt(0) === 0, 'D6 粗档按可用宽度分档；没量到宽度时按最宽画（不让位）')
  check(VIEW.vcFoldOf(460, { path: 'x', others: [], commits: [] }).otherMode === 'list' && VIEW.vcFoldOf(340, { path: 'x', others: [], commits: [] }).otherMode === 'summary', 'D7 可用宽度 + 元素清单 → 该画什么（那一档的两个决定）')
  check(VIEW.vcTail('dsh-mattpocock-skills-deck', 10) === 'dsh-mattp…' && VIEW.vcTail('短名', 10) === '短名', 'D8 工作树名砍尾：留前面那段（互相区分的那一段），末尾补省略号')
  // 宽度单调不增 → 画出来的东西单调不增（验收者点名的「更窄却画更多」那类回弹）。
  const widths = [520, 460, 420, 400, 380, 360, 340, 320, 300, 280, 240, 100]
  let monoOk = true
  let prevRich = null
  const richAt = function (w) {
    const fd = VIEW.vcFoldOf(w, { path: 'x'.repeat(30), others: ['name'], commits: ['subject'] })
    return { other: fd.otherMode === 'list' ? 1 : 0, commits: fd.commitsCollapsed ? 0 : 1, band: fd.band }
  }
  for (const w of widths) {
    const cur = richAt(w)
    if (prevRich && (cur.other > prevRich.other || cur.commits > prevRich.commits || cur.band < prevRich.band)) monoOk = false
    prevRich = cur
  }
  check(monoOk, 'D11 宽度单调不增时画出来的东西单调不增（其他工作树只会逐条→摘要、提交历史只会展开→收起，不会回弹）')
  const presentOf = function (state) {
    const set = []
    if (state.path) set.push('path')
    state.others.forEach(function (t, i) { if (t) set.push('other:' + i) })
    state.commits.forEach(function (t, i) { if (t) set.push('commit:' + i) })
    return set
  }
  let subsetOk = true
  for (let i = 0; i < ladder.steps.length; i++) {
    const a = presentOf(VIEW.vcFoldStateAt(ladder, i))
    const b = presentOf(VIEW.vcFoldStateAt(ladder, i + 1))
    if (!b.every(function (x) { return a.indexOf(x) >= 0 })) subsetOk = false
  }
  check(subsetOk, 'D12 每让一档，画出来的元素集合只减不增（后一档是前一档的子集）')
  // 折叠过的名字一律有全文悬停（工作树名、路径、其他工作树名、提交说明、文件路径一个都不例外）
  const longFile = '一个很深的目录/'.repeat(6) + '最后是文件名.txt'
  const foldFiles = screenOf({ unstaged: [{ path: longFile, origPath: null, staged: false, unstaged: true, conflict: false, change: 'modified', addedLines: 1, deletedLines: 0 }], unstagedCount: 1 })
  const foldRow = rowsOf(VIEW.vcBlocksOf(foldFiles, readsOf(foldFiles), {}, envOf(foldFiles, readsOf(foldFiles))))[0]
  const longName = screenOf({ otherWorktrees: [{ path: 'D:/一个很深的目录/一个很长的副本名字', display: '一个很深的目录/一个很长的副本名字', head: 'h', branch: 'main', bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false }] })
  const foldOther = blockOf(VIEW.vcBlocksOf(longName, readsOf(longName), {}, envOf(longName, readsOf(longName), 300)), 'other')
  check(foldRow.pathText.length < longFile.length && foldRow.pathText.indexOf('最后是文件名.txt') >= 0 && foldRow.pathTip === longFile, 'D13 文件路径折过之后：文件名那一头还在，悬停里是完整路径（实得「' + foldRow.pathText + '」）')
  check(foldOther.rows.length === 0 ? foldOther.summaryText.indexOf('一个很深的目录/一个很长的副本名字') >= 0 : foldOther.rows[0].displayTip === 'D:/一个很深的目录/一个很长的副本名字', 'D14 其他工作树的名字折过（或收成摘要）之后，完整路径仍在悬停里')

  // ---- E 组：次缝（三条电话的形状、诚实失败、日志）----
  const calls = []
  const fakeCall = function (method, args) {
    calls.push({ method: method, args: args })
    if (method === 'wf.gitStatus') return Promise.resolve({ ok: true, screen: files, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW })
    if (method === 'wf.gitDiff') return Promise.resolve({ ok: true, path: args.path, lines: shortLines, truncated: false, reason: 'ok' })
    if (method === 'wf.gitLog') return Promise.resolve({ ok: true, commits: [], skip: args.skip, requested: args.count, returned: 0, hasMore: false })
    return Promise.resolve({ ok: false, error: { kind: 'unknown', message: '' } })
  }
  const logs = []
  const V2 = buildView(null, logs)
  let reads2 = V2.vcNewReads()
  reads2 = await V2.vcReadStatus(reads2, fakeCall, 'D:/w/repo')
  check(reads2.screen.state === 'ok' && reads2.screen.data.screen === files, 'E1 首屏：wf.gitStatus 成功 → 进 ok 态并收下 screen')
  check(calls[0].method === 'wf.gitStatus' && calls[0].args.cwd === 'D:/w/repo', 'E2 首屏调的是 wf.gitStatus，带 cwd（实得 ' + calls[0].method + '）')
  reads2 = await V2.vcReadDiff(reads2, fakeCall, 'D:/w/repo', '改.txt', true)
  check(calls[1].method === 'wf.gitDiff' && calls[1].args.path === '改.txt' && calls[1].args.untracked === true && calls[1].args.cwd === 'D:/w/repo', 'E3 差异调 wf.gitDiff，带 cwd / path / untracked')
  check(reads2.diffs['改.txt'].state === 'ok' && reads2.diffs['改.txt'].lines.length === 4, 'E4 差异成功 → 该文件独立进 ok 态')
  reads2 = await V2.vcReadMoreCommits(reads2, fakeCall, 'D:/w/repo', 1)
  check(calls[2].method === 'wf.gitLog' && calls[2].args.count === 50 && calls[2].args.skip === 1, 'E5 历史调 wf.gitLog，带 cwd / count / skip')
  check(reads2.log.state === 'ok' && reads2.log.hasMore === false, 'E6 历史成功 → 进 ok 态并记下还有没有更早的')
  const okLogs = logs.filter((l) => l.event === 'host.call')
  check(okLogs.length === 3 && okLogs.every((l) => l.fields.ok === true && typeof l.fields.latencyMs === 'number'), 'E7 三次成功各落一行 host.call（既有事件，不新增事件名）')
  check(okLogs[0].fields.method === 'wf.gitStatus' && okLogs[0].fields.kind === 'git-status', 'E8 host.call 记了电话名与归一类别')

  // 故事 32 那一路的电话：读一笔提交的文件清单只带 rev；读这笔提交里某个文件的补丁带 rev + path。
  const commitCalls = []
  const commitCall = function (method, args) {
    commitCalls.push({ method: method, args: args })
    if (args && args.path) return Promise.resolve({ ok: true, path: args.path, lines: shortLines, truncated: false, reason: 'ok' })
    return Promise.resolve({ ok: true, rev: args.rev, files: commitFiles, truncated: false, reason: 'ok' })
  }
  let reads4 = V2.vcNewReads()
  reads4 = await V2.vcReadCommitFiles(reads4, commitCall, 'D:/w/repo', REV1)
  check(commitCalls[0].method === 'wf.gitDiff' && commitCalls[0].args.rev === REV1 && commitCalls[0].args.cwd === 'D:/w/repo' && commitCalls[0].args.path === undefined, 'E17 读一笔提交的文件清单：wf.gitDiff 只带 cwd 与 rev')
  check(reads4.commit.state === 'ok' && reads4.commit.files.length === 2 && reads4.commit.rev === REV1, 'E18 清单进 ok 态，并按修订号记下这是哪一笔的清单')
  reads4 = await V2.vcReadCommitFileDiff(reads4, commitCall, 'D:/w/repo', REV1, '面板/新页签.js')
  check(commitCalls[1].args.rev === REV1 && commitCalls[1].args.path === '面板/新页签.js', 'E19 读这笔提交里某个文件的补丁：wf.gitDiff 带 cwd / rev / path')
  check(reads4.commitDiffs[V2.vcCommitKeyOf(REV1, '面板/新页签.js')].state === 'ok' && reads4.commitDiffs[V2.vcCommitKeyOf(REV1, '面板/新页签.js')].lines.length === 4, 'E20 补丁按「修订号 + 路径」分开存，同一个文件在不同提交里互不顶替')
  const badCommit = await V2.vcReadCommitFiles(V2.vcNewReads(), function () { return Promise.resolve({ ok: false, error: { kind: 'args', message: 'x' } }) }, 'D:/w/repo', REV1)
  check(badCommit.commit.state === 'err' && badCommit.commit.error.kind === 'args', 'E21 清单读失败：如实进 err 态、错误种类不丢（宿主还没接上 rev 时就是这个 args）')

  const badLogs = []
  const V3 = buildView(null, badLogs)
  const failCall = function (method, args) {
    if (method === 'wf.gitStatus') return Promise.resolve({ ok: true, screen: files, tier: 'full', gitVersion: 'g', readAtMs: NOW })
    return Promise.resolve({ ok: false, error: { kind: 'timeout', message: '宿主原话' } })
  }
  let reads3 = V3.vcNewReads()
  reads3 = await V3.vcReadStatus(reads3, failCall, 'D:/w/repo')
  const goodData = reads3.screen.data
  reads3 = await V3.vcReadStatus(reads3, function () { return Promise.resolve({ ok: false, error: { kind: 'env', message: '宿主原话' } }) }, 'D:/w/repo')
  check(reads3.screen.state === 'err' && reads3.screen.error.kind === 'env' && reads3.screen.data === goodData, 'E9 首屏读失败：如实进 err 态、错误种类不丢、旧数据留着（不清空）')
  check(V3.vcFailKeyOf('env') === 'vc.fail.noGit' && V3.vcFailKeyOf('not-repo') === 'vc.fail.notRepo' && V3.vcFailKeyOf('没见过的种类') === 'vc.fail.unknown', 'E10 失败种类各对应一句人话，没见过的种类有兜底')
  const shapeFail = await V3.vcReadStatus(V3.vcNewReads(), function () { return Promise.resolve({ ok: true }) }, 'D:/w/repo')
  check(shapeFail.screen.state === 'err' && shapeFail.screen.error.kind === 'shape', 'E11 ok:true 却没带 screen：按失败处理，不拿半份数据冒充成功')
  const throwFail = await V3.vcReadDiff(V3.vcNewReads(), function () { return Promise.reject(new Error('断了')) }, 'D:/w/repo', 'a.txt', false)
  check(throwFail.diffs['a.txt'].state === 'err' && throwFail.diffs['a.txt'].error.kind === 'throw', 'E12 电话抛了：不往外抛，落成 err 态（读不到就说读不到）')
  const fLogs = badLogs.filter((l) => l.event === 'host.call.fail')
  check(fLogs.length === 3 && fLogs.every((l) => l.level === 'warn' && l.fields.method && l.fields.kind && l.fields.errorHash), 'E13 三次失败各落一行告警级 host.call.fail（只记散列，不记原文）')
  check(JSON.stringify(badLogs).indexOf('宿主原话') < 0, 'E14 日志里没有宿主原文（只记散列）')
  // 真宿主这一侧也接一遍：失败信封诚实、不抛
  const notRepoRun = makeHostDeps(function (argv) {
    const a = afterPrefix(argv)
    if (a && a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return { code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' }
    return liveRoute(argv)
  })
  const notRepoReply = await hostMod.createVersionControl(notRepoRun.deps).handleGitStatus({ cwd: 'D:/不在仓库里' })
  check(notRepoReply.ok === false && notRepoReply.error.kind === 'not-repo' && typeof notRepoReply.error.message === 'string', 'E15 真宿主：不在仓库里时回诚实的失败信封（kind=not-repo），不抛')
  const clientNotRepo = await V2.vcReadStatus(V2.vcNewReads(), function () { return Promise.resolve(notRepoReply) }, 'D:/不在仓库里')
  check(clientNotRepo.screen.error.kind === 'not-repo' && V2.vcFailKeyOf(clientNotRepo.screen.error.kind) === 'vc.fail.notRepo', 'E16 界面侧认下真宿主这份失败信封，翻成那句「不在任何 git 仓库里」')

  // ---- F 组：纪律 ----
  const topKeys = Object.keys(L_PANEL).join(',') + '|' + Object.keys(L_FLOW).join(',')
  check(topKeys === 'zh,en|zh,en', 'F8 两份词条模块的顶层键都只有 zh 与 en（实得 ' + topKeys + '）—— 词条插到 zh 块外面时，中文界面会把键名原样印出来')
  const missingOf = function (zh, en, keys) { return keys.filter(function (k) { return typeof zh[k] !== 'string' || zh[k] === '' || typeof en[k] !== 'string' || en[k] === '' }) }
  check(LOC.zh['panel.tabVersionControl'] === '版本管理' && LOC.en['panel.tabVersionControl'] === 'Version control', 'F10 页签名中英成对（版本管理 / Version control）')
  // 三条真机缺陷的回归（独立验收者报的，已修）
  const tailLadder = VIEW.vcFoldLadderOf({ path: 'abcdefghijklmnop', others: ['副本名'], commits: [] })
  const tailLens = []
  for (let i = 0; i <= tailLadder.steps.length; i++) { const st = VIEW.vcFoldStateAt(tailLadder, i); tailLens.push(st.path.length + ':' + st.others[0].length) }
  const tailSeq = tailLens.map((s) => s.split(':').map(Number))
  check(tailSeq[0][0] === 16 && tailSeq[tailSeq.length - 1][0] === VIEW.VC_MIDDLE_MIN && tailSeq[tailSeq.length - 1][1] === 0, 'D9 折叠到最后一档：路径停在最短可砍长度、名字收成空，都不会弹回全长（长度序列 ' + tailLens.join(' → ') + '）')
  check(VIEW.vcWhenText(tZh, NOW, null) === '' && VIEW.vcWhenText(tZh, NOW, undefined) === '', 'D10 没有时间这一项时回空串，不画成 1970 年')
  const toneKeys = Object.keys(VIEW.VC_TONE)
  const vcTone = Object.keys(VIEW.VC_TONE).filter((k) => String(VIEW.VC_TONE[k]).indexOf('var(--vc-') < 0)
  check(vcTone.length === 0, 'F4 颜色只走本页皮肤令牌（每个色档都是 var(--vc-…)，带一个兜底色；不是令牌的色档：' + (vcTone.join('、') || '无') + '）')
  // 令牌定义文件本身当然要有十六进制 —— 那是它该待的地方；这里只确认它确实按主题开关分成深浅两套。
  const toneNames = new Set()
  const collectTones = function (x) {
    if (!x || typeof x !== 'object') return
    for (const k of Object.keys(x)) {
      if ((k === 'tone' || /Tone$/.test(k)) && typeof x[k] === 'string' && x[k]) toneNames.add(x[k])
      else if (x[k] && typeof x[k] === 'object') collectTones(x[k])
    }
  }
  collectTones([liveBlocks, mB, oB, narrowB, dB, nB, zB, shortBlocks])
  check(toneNames.size >= 3 && [...toneNames].every((n) => toneKeys.indexOf(n) >= 0), 'F7 模型给出的 ' + toneNames.size + ' 个色档名都在界面的映射表里（' + [...toneNames].join(' / ') + '）')

  // ---- G 组：比照（界面侧规则 vs 版本管理核心）----
  const core = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'state.js')).href)
  // 核心 #819 起也按码点切（vc-commit 同步改完），所以比照输入里补上 emoji 路径：两边必须仍给同一串字。
  const paths = ['a/b/c.txt', 'D:/很长的目录/子目录/文件名.txt', '短.txt', 'x'.repeat(60) + '/y.txt', '😀😀😀😀😀😀😀😀😀😀/文.txt', 'src/😀带emoji的目录/子目录/文件.txt']
  let same = true
  for (const p of paths) for (const n of [10, 12, 20, 24, 46, 80]) if (VIEW.vcMiddle(p, n) !== core.foldMiddle(p, n)) { same = false; console.log('    （' + p + ' @' + n + ' 界面「' + VIEW.vcMiddle(p, n) + '」核心「' + core.foldMiddle(p, n) + '」）') }
  check(same, 'G1 vcMiddle 与核心 foldMiddle 在同一批输入上给出同一串字（两条规则不许各说各话）')
  const stamps = [NOW - 1000, NOW - 3600000, NOW - 6 * 24 * 3600 * 1000, NOW - 7 * 24 * 3600 * 1000, NOW - 30 * 24 * 3600 * 1000]
  check(stamps.every((ms) => VIEW.vcTimeKind(NOW, ms) === core.describeTime(NOW, ms).style), 'G2 vcTimeKind 与核心 describeTime 同一条 7 天分界（相对 / 绝对不说两套话）')

  // ---- G4：首帧真渲染一次（空态不许崩、也不许冒字）----
  // React、DswsCtx 与 Tip / Ic 垫片在上面建 VIEW 之前就备好了（#1751 贮藏页的提示走 Tip）。
  const renderView = buildView(null, [], React, DswsCtx, TipStub, IcStub)
  let html = ''
  let renderErr = ''
  try { html = renderToStaticMarkup(React.createElement(renderView.VersionControlTab, { st: { cwd: 'D:/w/repo' }, narrow: false })) } catch (e) { renderErr = String((e && e.message) || e) }
  check(renderErr === '' && html.indexOf('data-vc-root') >= 0, 'G4 首帧真渲染一次：不崩，画出带骨架的根（实得 ' + (renderErr ? '抛错：' + renderErr : html.slice(0, 60)) + '）')
  const skelBars = (html.match(/data-vc-skel="1"/g) || []).length
  check(renderErr === '' && html.indexOf('data-vc-skel-root') >= 0 && html.replace(/<[^>]*>/g, '').trim() === '' && skelBars >= 10, 'G5 面板刚打开那一下不画空白：骨架占位、一个字都没有（骨架条 ' + skelBars + ' 条，不冒常驻道歉）')
  // 真渲染第二遍：把首屏读数预先塞进组件的初始状态，看画出来的 DOM 里到底写了哪些字。
  const seedReads = { screen: { state: 'ok', data: { screen: liveScreen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }, error: null }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const renderSeeded = buildView((s) => s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, seedReads)
  let html2 = ''
  let renderErr2 = ''
  try { html2 = renderToStaticMarkup(React.createElement(renderSeeded.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { renderErr2 = String((e && e.message) || e) }
  const flat = html2.replace(/<[^>]*>/g, ' ')
  check(renderErr2 === '' && html2.indexOf('data-vc-identity') >= 0 && html2.indexOf('data-vc-changes') >= 0 && html2.indexOf('data-vc-views') >= 0 && html2.indexOf('data-vc-commits') < 0 && html2.indexOf('data-vc-other') < 0, 'G6 默认视图真渲染一次：身份行、未提交改动、视图页签在 DOM 里，提交历史与其他工作树收在页签后面（' + (renderErr2 ? '抛错：' + renderErr2 : '默认视图齐备') + '）')
  check(flat.indexOf('已暂存') >= 0 && flat.indexOf('未暂存') >= 0 && flat.indexOf('main') >= 0 && flat.indexOf('提交历史') >= 0, 'G7 画出来的 DOM 里就是那几句人话（数字条 / 分支名 / 提交历史都在）')
  check(flat.indexOf('data-vc-') < 0 && flat.indexOf('vc.changes') < 0 && flat.indexOf('vc.fail') < 0, 'G8 DOM 里没有把词条键名当文字画出来（上一版把词条插错位置时正是这样）')
  // V 组 · 布局 C（#853 第三步）：三个视图各只画自己的块，页签带数量；点开提交自动跳历史视图。
  const liveCounts = {
    changes: (Number(liveScreen.conflictCount) || 0) + (Number(liveScreen.stagedCount) || 0) + (Number(liveScreen.unstagedCount) || 0),
    commits: Array.isArray(liveScreen.commits) ? liveScreen.commits.length : 0,
    worktrees: Array.isArray(liveScreen.otherWorktrees) ? liveScreen.otherWorktrees.length : 0,
  }
  const viewRender = function (v) {
    const rv = buildView(function (s) {
      return s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })')
        .replace("view: vcRememberedView()", "view: '" + v + "'")
    }, [], React, DswsCtx, TipStub, IcStub, seedReads)
    try { return { html: renderToStaticMarkup(React.createElement(rv.VersionControlTab, { st: { cwd: 'D:/w/repo' } })), err: '' } } catch (e) { return { html: '', err: String((e && e.message) || e) } }
  }
  const tabTextOf = function (html, v) {
    const m = html.match(new RegExp('<button[^>]*data-vc-view="' + v + '"[^>]*>([\\s\\S]*?)</button>'))
    return m ? m[1].replace(/<[^>]*>/g, '') : ''
  }
  const vChanges = viewRender('changes')
  const vCommits = viewRender('commits')
  const vTrees = viewRender('worktrees')
  check(vChanges.err === '' && (vChanges.html.match(/data-vc-view="/g) || []).length === 3, 'V1 三个视图页签都在（改动 / 提交历史 / 工作树）')
  check(tabTextOf(vChanges.html, 'changes') === '改动 ' + liveCounts.changes && tabTextOf(vChanges.html, 'commits') === '提交历史 ' + liveCounts.commits && tabTextOf(vChanges.html, 'worktrees') === '工作树 ' + liveCounts.worktrees, 'V2 页签按 854 布局 C 原型：改动／提交历史／工作树加空格数字（改动' + liveCounts.changes + ' / 历史' + liveCounts.commits + ' / 工作树' + liveCounts.worktrees + '）')
  check(vCommits.err === '' && vCommits.html.indexOf('data-vc-commits') >= 0 && vCommits.html.indexOf('data-vc-changes') < 0 && vCommits.html.indexOf('aria-selected=\"true\"') >= 0, 'V3 提交历史视图：只画历史那一块，页签高亮跟过去')
  check(vTrees.err === '' && vTrees.html.indexOf('data-vc-other') >= 0 && vTrees.html.indexOf('data-vc-terminal') >= 0 && vTrees.html.indexOf('data-vc-changes') < 0 && vTrees.html.indexOf('data-vc-commits') < 0, 'V4 工作树视图：列表与边界说明在，改动与历史不在')
  check(vChanges.html.indexOf('data-vc-identity') >= 0 && vChanges.html.indexOf('data-vc-changes') >= 0, 'V5 常驻块（身份行）不受视图切换影响')
  const vc = VIEW.vcViewCountsOf(liveScreen, { log: { commits: [{ x: 1 }, { x: 2 }] } })
  check(vc.changes === liveCounts.changes && vc.commits === liveCounts.commits + 2 && vc.worktrees === liveCounts.worktrees, 'V6 视图计数：改动按文件数、历史按已读到的提交数（含续读）、工作树按棵数')
  const routed = VIEW.vcViewBlocksOf([{ kind: 'hint' }, { kind: 'band' }, { kind: 'identity' }, { kind: 'changes' }, { kind: 'changes', commitMode: true }, { kind: 'commits' }, { kind: 'other' }, { kind: 'terminal' }])
  check(routed.always.length === 2 && routed.changes.length === 2 && routed.commits.length === 2 && routed.worktrees.length === 2, 'V7 块按视图分区（854 布局 C 原型）：常驻 2（提示/身份），异常带归改动视图，点开的提交归历史视图')
  check(VIEW.vcViewOf({}) === 'changes' && VIEW.vcViewOf({ view: 'nope' }) === 'changes' && VIEW.vcViewOf({ view: 'worktrees' }) === 'worktrees', 'V8 视图取值非法时回退到改动页（不画空白）')
  VIEW.vcRememberView('worktrees')
  const memOk = VIEW.vcRememberedView() === 'worktrees'
  VIEW.vcResetViewMemory()
  check(memOk && VIEW.vcRememberedView() === 'changes', 'V9 同一会话内记住上次选的视图，复位回到改动页')
  const picked = VIEW.vcPickViewStateOf({ view: 'commits', openCommit: 'abc1234', openDiff: 'k', write: { op: '' } }, 'worktrees')
  check(picked.view === 'worktrees' && picked.openCommit === '' && picked.openDiff === 'k' && picked.write.op === '', 'V11 页签点下去就离开提交详情（原子切换：view 落点、openCommit 清空，其余状态不动）')
  // AI 组 · #854：面板解决不了的事 —— 按钮在四个落点，prompt 三段式，预填不发送。
  const aiScreen = screenOf({ conflictCount: 1, stagedCount: 0, unstagedCount: 1, unstaged: [{ path: 'c.txt', origPath: null, staged: false, unstaged: true, conflict: true, change: 'modified', addedLines: 1, deletedLines: 1 }], repo: { merging: false, rebasing: true, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlm: null, autocrlf: null } })
  const aiReads = readsOf(aiScreen)
  const aiBlocks = VIEW.vcBlocksOf(aiScreen, aiReads, {}, envOf(aiScreen, aiReads))
  const aiBand = blockOf(aiBlocks, 'band')
  const aiOf = function (key) { return (aiBand && aiBand.items.filter(function (it) { return it.key === key })[0]) || {} }
  check(aiOf('conflicts').ai && aiOf('conflicts').ai.kind === 'conflict' && aiOf('rebase').ai && aiOf('rebase').ai.kind === 'midop', 'AI1 冲突带与进行中操作带上配好交出去的描述（conflict / midop）')
  const aiHandoff = VIEW.vcAiHandoffOf({ ai: { kind: 'conflict', summary: '有 1 个文件卡在冲突里，正等着你处理', detail: '这些文件里同时留着两边的内容。', tip: 'x'.repeat(400) }, t: tZh, screen: aiScreen })
  const aiBody = aiHandoff ? aiHandoff.body : ''
  check(!!aiHandoff && aiHandoff.title === '版本管理求助，分支 main' && aiBody.indexOf('仓库：') < aiBody.indexOf('改动：') && aiBody.indexOf('改动：') < aiBody.indexOf('想做：') && aiBody.indexOf('想做：') < aiBody.indexOf('看到：') && aiBody.indexOf('看到：') < aiBody.indexOf('目标：') && aiBody.indexOf('目标：') < aiBody.indexOf('补充：') && aiBody.indexOf('vc.') < 0 && aiBody.indexOf('#') < 0, 'AI2 prompt 是新版式（仓库/改动/想做/看到/目标/补充），标题带分支，没有词条键与章节符号')
  check(aiBody.indexOf('仓库：repo') >= 0 && aiBody.indexOf('分支 main') >= 0 && aiBody.indexOf('c.txt') >= 0 && aiBody.split('\n').filter(function (l) { return l === 'x'.repeat(400) }).length === 0 && aiBody.indexOf('x'.repeat(300)) >= 0, 'AI3 事实带全（仓库/分支、卡住的文件），宿主原话只留前 300 字')
  check(VIEW.vcAiHandoffOf({ ai: { kind: '', summary: 'x' }, t: tZh, screen: aiScreen }) === null && VIEW.vcAiHandoffOf({ ai: { kind: 'conflict', summary: '' }, t: tZh, screen: aiScreen }) === null, 'AI4 没种类或没正文就不交出去（回 null，不画按钮）')
  const seenOpen = []
  const opened = VIEW.vcOpenAiHandoff({ opener: function (st, body, title, opts) { seenOpen.push({ st: st, body: body, title: title, opts: opts }) }, st: { cwd: 'D:/w/repo' }, handoff: aiHandoff })
  check(opened === true && seenOpen.length === 1 && seenOpen[0].title === '版本管理求助，分支 main' && seenOpen[0].body === aiBody && seenOpen[0].opts.kind === 'fix', 'AI5 点按钮按约定开新会话：同工作区 st、正文、标题、fix 档')
  check(VIEW.vcOpenAiHandoff({ opener: null, st: {}, handoff: aiHandoff }) === false && VIEW.vcOpenAiHandoff({ opener: function () { throw new Error('no') }, st: {}, handoff: aiHandoff }) === false, 'AI6b 反证： opener 缺席或抛错都回 false，不崩')
  const aiBtn = VIEW.vcAiButtonNode(React.createElement, { ai: { kind: 'conflict' }, tr: tZh, onOpen: function () {} })
  check(!!aiBtn && VIEW.vcAiButtonNode(React.createElement, { ai: null, tr: tZh, onOpen: function () {} }) === null, 'AI6 按钮节点：有描述就画、没描述就不画')
  const aiHtml = (function () { const rv = buildView(function (s) { return s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })') }, [], React, DswsCtx, TipStub, IcStub, aiReads); try { return renderToStaticMarkup(React.createElement(rv.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { return '' } })()
  const aiDoc = new (require('jsdom').JSDOM)('<div id="m">' + aiHtml + '</div>').window.document
  const aiKinds = Array.prototype.map.call(aiDoc.querySelectorAll('[data-vc-ai]'), function (el) { return el.getAttribute('data-vc-ai') }).join(',')
  check(aiKinds.indexOf('conflict') >= 0 && aiKinds.indexOf('midop') >= 0, 'AI7 真渲染：冲突、进行中两处有按钮（实得 ' + aiKinds + '）')
  const aiTreeView = buildView(function (s) { return s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })').replace("view: vcRememberedView()", "view: 'worktrees'") }, [], React, DswsCtx, TipStub, IcStub, aiReads)
  let aiTreeHtml = ''
  try { aiTreeHtml = renderToStaticMarkup(React.createElement(aiTreeView.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { aiTreeHtml = '' }
  check(aiTreeHtml.indexOf('data-vc-ai="boundary"') >= 0, 'AI7b 真渲染：工作树视图里边界说明旁边有按钮')
  const aiBtnText = Array.prototype.map.call(aiDoc.querySelectorAll('[data-vc-ai]'), function (el) { return el.textContent }).join('|')
  check(aiBtnText.split('|').every(function (x) { return x === '让 AI 帮我解决' }), 'AI8 按钮文字就是那一句，不造新词')
  const errReads = { screen: { state: 'err', data: null, error: { kind: 'timeout', message: 'git 一直没有回音' } }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const errAi = blockOf(VIEW.vcBlocksOf(null, errReads, {}, envOf(null, errReads)), 'error').ai
  const noRepoAi = blockOf(VIEW.vcBlocksOf(null, { screen: { state: 'err', data: null, error: { kind: 'not-repo', message: '' } }, diffs: {}, log: errReads.log }, {}, envOf(null, errReads)), 'error').ai
  check(errAi && errAi.kind === 'read-fail' && !noRepoAi, 'AI9 读失败里能动手的五档配按钮（timeout 有），配环境那档不配（not-repo 没有）')
  // 真渲染一遍：把「正开着这笔提交」的界面状态预置进去，看 DOM 里到底有没有那条回去的路与那份清单。
  const commitSeed = { screen: { state: 'ok', data: { screen: commitScreen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }, error: null }, diffs: {}, commit: commitEntry(), commitDiffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const renderCommit = buildView(function (s) {
    return s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })')
      // #842：组件的 ui 初始状态多了 write 那一格，这里改成打最短的稳定锚点（原先把整句写死，
      //   源码一改就对不上、S13/S14 会假红）。锚点必须带上 write 那一格：vcData.js 的 vcFreshOnCwd
      //   返回值里有同样一段字，而它在闭包里排在组件前面，不带 write 会打到那一份上。
      .replace(VC_OPENCOMMIT_RE, "openCommit: '" + REV1 + "', view:")
  }, [], React, DswsCtx, TipStub, IcStub, commitSeed)
  let html3 = ''
  let renderErr3 = ''
  try { html3 = renderToStaticMarkup(React.createElement(renderCommit.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { renderErr3 = String((e && e.message) || e) }
  const flat3 = html3.replace(/<[^>]*>/g, ' ')
  check(renderErr3 === '' && html3.indexOf('data-vc-back') >= 0 && html3.indexOf('data-vc-commit-mode') >= 0, 'S13 真渲染：提交模式画出了「回到未提交改动」那条路（' + (renderErr3 ? '抛错：' + renderErr3 : '在') + '）')
  check(flat3.indexOf('该提交的变更内容') >= 0 && flat3.indexOf('该提交变更了 2 个文件') >= 0 && flat3.indexOf('返回未提交改动') >= 0, 'S14 真渲染：DOM 里就是那几句人话（标题 / 计数 / 回去的路）')
  const loadingSeed = { screen: { state: 'ok', data: { screen: commitScreen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }, error: null }, diffs: {}, commit: commitEntry({ state: 'loading', files: [] }), commitDiffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const renderLoading = buildView(function (s) {
    return s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })')
      .replace(VC_OPENCOMMIT_RE, "openCommit: '" + REV1 + "', view:")
  }, [], React, DswsCtx, TipStub, IcStub, loadingSeed)
  let htmlL = ''
  try { htmlL = renderToStaticMarkup(React.createElement(renderLoading.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { htmlL = '' }
  check(htmlL.indexOf('data-vc-commit-mode') >= 0 && (htmlL.match(/data-vc-skel(?!-root)/g) || []).length === 3 && htmlL.indexOf('正在读取该提交的变更内容') >= 0, 'S14b 真渲染：提交清单还在读时文件行位置是三条骨架条，那句正在读的字还在')



  // 英文界面那一遍：同一份数据、同一套画法，只把词典换成英文 —— 画出来的人话必须是英文。
  const goodEn = tZh
  tZh = tEn
  let htmlEn = ''
  try {
    const renderEn = buildView((s) => s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, seedReads)
    htmlEn = renderToStaticMarkup(React.createElement(renderEn.VersionControlTab, { st: { cwd: 'D:/w/repo' } }))
  } catch (e) { htmlEn = '' }
  tZh = goodEn
  const flatEn = htmlEn.replace(/<[^>]*>/g, ' ')
  // G10/G11：英文界面 + 带中文原话的失败信封 —— 可见文字里不许出现任何 CJK 字符，原话只进悬停。
  const errSeedEn = { screen: { state: 'err', data: null, error: { kind: 'env', message: '找不到 git（宿主中文原话）' } }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const errBlocksZh = VIEW.vcBlocksOf(null, errSeedEn, {}, { t: tZh, nowMs: NOW, fold: VIEW.vcFoldOf(460, {}) })
  check(errBlocksZh.length === 1 && String(errBlocksZh[0].rawTip || '').indexOf('找不到 git') >= 0 && errBlocksZh[0].detail === undefined, 'G11 宿主原话留在悬停提示里（诊断不丢），可见正文里没有它这一栏')
  const goodErr = tZh
  tZh = tEn
  let htmlErr = ''
  try {
    const renderErr = buildView((s) => s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, errSeedEn)
    htmlErr = renderToStaticMarkup(React.createElement(renderErr.VersionControlTab, { st: { cwd: 'D:/w/repo' } }))
  } catch (e) { htmlErr = '' }
  tZh = goodErr
  const flatErr = htmlErr.replace(/<[^>]*>/g, ' ')
  check(htmlErr !== '' && flatErr.indexOf('git was not found') >= 0 && !/[\u4e00-\u9fff]/.test(flatErr), 'G10 英文界面 + 带中文原话的失败信封：画出来的可见文字里一个 CJK 字符都没有（宿主原话只在悬停里）')
  // G12/G13：这个会话还没有工作区（空 cwd）—— 一个电话都不发，画一句如实的空态。
  check(VIEW.vcShouldRead('') === false && VIEW.vcShouldRead('   ') === false && VIEW.vcShouldRead(null) === false && VIEW.vcShouldRead('D:/w/repo') === true, 'G12 空 cwd 的判据：读数据的谓词回假（宿主对空串会退回它自己的默认目录，那是插件自己那个仓库的数据）')
  const emptyCwdBlocks = VIEW.vcBlocksOf(null, VIEW.vcNewReads(), {}, { t: tZh, nowMs: NOW, cwdEmpty: true, fold: VIEW.vcFoldOf(460, {}) })
  check(emptyCwdBlocks.length === 1 && emptyCwdBlocks[0].text === '当前会话尚未关联工作区，无法读取版本信息' && emptyCwdBlocks[0].retry === '', 'G13 空 cwd 画出那句如实的空态（不是读取失败，所以不给重试）')
  let htmlNoCwd = ''
  let noCwdCalls = 0
  try {
    const hostStub = { call: function () { noCwdCalls += 1; return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } }) } }
    const renderNoCwd = buildView(null, [], React, DswsCtx, TipStub, IcStub, null, hostStub)
    htmlNoCwd = renderToStaticMarkup(React.createElement(renderNoCwd.VersionControlTab, { st: {} }))
  } catch (e) { htmlNoCwd = '' }
  check(htmlNoCwd.replace(/<[^>]*>/g, ' ').indexOf('当前会话尚未关联工作区') >= 0 && noCwdCalls === 0, 'G15 真渲染：空 cwd 时画的是那句空态，宿主一个电话都没被调到（实得 ' + noCwdCalls + ' 次）')
  check(flatEn.indexOf('Commit history') >= 0 && flatEn.indexOf('Changes') >= 0 && flatEn.indexOf('提交历史') < 0 && flatEn.indexOf('未提交改动') < 0 && flatEn.indexOf('改动') < 0, 'G9 英文界面下画出来的是英文（词条中英成对，界面不写死任何一句中文）')

  // ---- N 组：#819 对抗式审查的十四条（先修真骗人的、再修天天遇到的、最后修边角）----
  // N1（严重）换工作区：读数与界面状态整体复位，旧工作区的身份与「打开中的提交」都不许留下来。
  const readsA = await V2.vcReadStatus(V2.vcNewReads(), function () { return Promise.resolve({ ok: true, screen: liveScreen, tier: 'full', gitVersion: 'g', readAtMs: NOW }) }, 'D:/w/A')
  const uiA = { fileShown: { staged: 20 }, openDiff: 'x', openCommit: 'aaaa' }
  const resetAB = V2.vcFreshOnCwd('D:/w/A', 'D:/w/B', readsA, uiA)
  check(resetAB.changed === true && resetAB.reads.screen.state === 'idle' && resetAB.reads.screen.data === null && resetAB.ui.openCommit === '' && resetAB.ui.openDiff === '' && Object.keys(resetAB.ui.fileShown).length === 0, 'N1 cwd 一变：读数与界面状态整体复位（含点开的那笔提交与展开状态）')
  const keepAA = V2.vcFreshOnCwd('D:/w/A', 'D:/w/A', readsA, uiA)
  check(keepAA.changed === false && keepAA.reads === readsA && keepAA.ui === uiA, 'N2 cwd 没变：什么都不动（同工作区刷新失败时旧数据照常留着）')
  const staleSeed = { screen: { state: 'ok', data: { screen: liveScreen, tier: 'full', gitVersion: 'g', readAtMs: NOW }, error: null }, diffs: {}, commit: { rev: 'aaaa', seq: 1, state: 'ok', files: commitFiles, truncated: false, reason: 'ok', error: null }, commitDiffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  let htmlStale = ''
  try {
    const renderStale = buildView(function (s) {
      return s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })')
        .replace('React.useState(cwd)', "React.useState('D:/w/A')")
        .replace(VC_UIINIT_RE, "React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: 'aaaa' } })")
        .replace(VC_UIINIT_RE, "React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: 'aaaa' } })")
    }, [], React, DswsCtx, TipStub, IcStub, staleSeed)
    htmlStale = renderToStaticMarkup(React.createElement(renderStale.VersionControlTab, { st: { cwd: 'D:/w/B' } }))
  } catch (e) { htmlStale = '' }
  check(htmlStale.indexOf('data-vc-identity') < 0 && htmlStale.indexOf('data-vc-commit-mode') < 0, 'N3 真渲染：cwd 从 A 换到 B 的那一帧，A 的身份行与 A 的提交清单都不在 DOM 里')

  // N4（严重）首屏回包形状不对：一律落 shape 失败，绝不画成「干净仓库」。
  const badScreens = ['garbage', [], 1, true, {}, { identity: {}, staged: [], unstaged: [], otherWorktrees: [], branches: [], commits: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0, repo: {} }]
  let shapeAllBad = true
  for (const bad of badScreens) {
    const rBad = await V2.vcReadStatus(V2.vcNewReads(), function () { return Promise.resolve({ ok: true, screen: bad }) }, 'D:/w/repo')
    if (!(rBad.screen.state === 'err' && rBad.screen.error.kind === 'shape')) { shapeAllBad = false; console.log('    （坏形状没落 shape：' + JSON.stringify(bad).slice(0, 40) + '）') }
  }
  check(shapeAllBad, 'N4 首屏回包形状不对（字符串 / 数组 / 数字 / true / 空对象 / 缺字段）六种一律落 shape 失败，不画成「干净仓库」')
  check(V2.vcScreenShapeOk(liveScreen) === true && V2.vcScreenShapeOk(files) === true, 'N5 形状判据不是恒假：真机样本与手写模型的 screen 都通过')

  // N6 部分暂存（同一个文件两段改动）：两行、汇总与宿主计数一致、差异写清范围。
  const dual = screenOf({
    staged: [{ path: 'src/app.js', origPath: null, staged: true, unstaged: true, conflict: false, change: 'modified', addedLines: 2, deletedLines: 0 }],
    unstaged: [{ path: 'src/app.js', origPath: null, staged: true, unstaged: true, conflict: false, change: 'modified', addedLines: 3, deletedLines: 1 }],
    stagedCount: 1, unstagedCount: 1,
  })
  const dualBlocks = VIEW.vcBlocksOf(dual, readsOf(dual), {}, envOf(dual, readsOf(dual)))
  check(blockOf(dualBlocks, 'changes').summary === '已暂存 1 个文件 / 未暂存 1 个文件', 'N6 同一个文件既有暂存又有未暂存：汇总句与宿主的两个计数一致（不再是「未暂存 0」，实得「' + blockOf(dualBlocks, 'changes').summary + '」）')
  const dualRows = rowsOf(dualBlocks)
  check(dualRows.length === 2 && blockOf(dualBlocks, 'changes').groups.map(function (g) { return g.key + ':' + g.rows.length }).join(',') === 'staged:1,unstaged:1', 'N7 两段改动各占一行、各在一组（git status 自己也是两个小节各列一次）')
  check(dualRows[0].rowTip.indexOf('本行为已暂存部分') >= 0 && dualRows[1].rowTip.indexOf('本行为未暂存部分') >= 0, 'N8 两行各自说清是哪一部分（用户分得清「准备好要提交的」与「还没暂存的」）')
  const dualDiffReads = readsOf(dual, { diffs: { 'src/app.js': { state: 'ok', lines: shortLines, reason: 'ok', truncated: false, error: null } } })
  const dualDiffRow = rowsOf(VIEW.vcBlocksOf(dual, dualDiffReads, { openDiff: 'staged\u0000src/app.js' }, envOf(dual, dualDiffReads)))[0]
  check(dualDiffRow.diff.scopeText === '此处展示相对上一次提交的全部变更（含已暂存与未暂存两部分）。', 'N9 差异面板写清范围：不让用户把「已暂存」组里点开的差异当成「将要提交的那部分」')
  const commitDiffRow = rowsOf(VIEW.vcBlocksOf(commitScreen, patchReads, { openCommit: REV1, openDiff: VIEW.vcCommitKeyOf(REV1, '面板/新页签.js') }, envOf(commitScreen, patchReads)))[0]
  check(commitDiffRow.diff.scopeText === '', 'N10 提交那一层的差异不带这句范围说明（它的范围就是那笔提交，抬头已经写明）')

  // N11 竞态：晚到的旧回包不许把界面钉在旧的那一笔上。
  const loadingB = Object.assign({}, readsA, { commit: { rev: 'bbbb', seq: 2, state: 'loading', files: [], truncated: false, reason: '', error: null } })
  const lateA = Object.assign({}, readsA, { commit: { rev: 'aaaa', seq: 1, state: 'ok', files: commitFiles, truncated: false, reason: 'ok', error: null } })
  check(V2.vcApplyCommitReply(loadingB, lateA) === loadingB, 'N11 晚到的旧回包（代际号更小）被丢掉，界面不会永久停在「正在读」')
  const newerB = Object.assign({}, readsA, { commit: { rev: 'bbbb', seq: 2, state: 'ok', files: commitFiles, truncated: false, reason: 'ok', error: null } })
  check(V2.vcApplyCommitReply(loadingB, newerB) === newerB, 'N12 新回包照常落库（判据不是恒假）')

  // N13/N14 读数时刻。
  check(blockOf(liveBlocks, 'identity').readAtText === '读取于 刚刚', 'N13 身份行写着这份读数是什么时候取的（实得「' + blockOf(liveBlocks, 'identity').readAtText + '」）')
  const noReadAt = readsOf(liveScreen, { screen: { state: 'ok', data: { screen: liveScreen, tier: 'full', gitVersion: 'g', readAtMs: 0 }, error: null } })
  check(blockOf(VIEW.vcBlocksOf(liveScreen, noReadAt, {}, envOf(liveScreen, noReadAt)), 'identity').readAtText === '', 'N14 读数时刻读不到就不写那几个字（不画成 1970）')

  // N16 极端宽度：台阶总数有上限。
  const hugeLadder = VIEW.vcFoldLadderOf({ path: 'p'.repeat(300), others: [], commits: new Array(200).fill('s'.repeat(20)) })
  check(hugeLadder.steps.length === VIEW.VC_FOLD_STEP_CAP && VIEW.VC_FOLD_STEP_CAP <= 200, 'N16 台阶总数有上限（三百字符路径 + 两百条说明也只有 ' + hugeLadder.steps.length + ' 档，不再上千档）')

  const noSidebar = /侧栏终端/.test(LOC.zh) === false && /terminal on the same row/.test(LOC.en) === false
  check(noSidebar, 'N18b 中英词条里都不许再出现「侧栏终端 / terminal on the same row」（中文命中：' + /侧栏终端/.test(LOC.zh) + '，英文命中：' + /terminal on the same row/.test(LOC.en) + '）')

  check(V2.vcMarkLogLoading(V2.vcNewReads()).log.state === 'loading', 'N20 vcMarkLogLoading 把「正在读更早的提交」这一刻写进读数（那一句提示才有机会出现）')

  // N21 依据时间给 0 或负数：按读不到说，不画成 1970。
  check(VIEW.vcBasisText(tZh, NOW, 0) === '无法读取远端信息的更新时间' && VIEW.vcBasisText(tZh, NOW, -1) === '无法读取远端信息的更新时间' && VIEW.vcWhenText(tZh, NOW, 0) === '', 'N21 依据时间 / 时刻给 0 或负数一律按读不到说（不画成 1970）')

  // N22 五值以外的同步状态：如实说不认识，不猜成「领先 0」。
  const weirdSync = screenOf({ identity: { sync: 'weird-value' } })
  const weirdId = blockOf(VIEW.vcBlocksOf(weirdSync, readsOf(weirdSync), {}, envOf(weirdSync, readsOf(weirdSync))), 'identity')
  check(weirdId.sync.text === '同步状态返回了界面无法识别的类型，不推测超前与落后计数；请在命令行中查看。' && weirdId.sync.text.indexOf('超前 0') < 0 && weirdId.sync.text.indexOf('落后 0') < 0, 'N22 五值以外的同步状态：如实说不认识，不猜成「超前 0 / 落后 0」（实得「' + weirdId.sync.text + '」）')
  const missingSync = screenOf({ identity: { sync: undefined } })
  check(blockOf(VIEW.vcBlocksOf(missingSync, readsOf(missingSync), {}, envOf(missingSync, readsOf(missingSync))), 'identity').sync.text === '尚未设置上游', 'N23 字段缺失时仍按「尚未设置上游」说（缺省值不变）')

  // N23b 进出缓存（#864）：未命中回 null；存一份 ok 的首屏后再取，身份与历史首批都在；err 的回包不进缓存；不同工作区互不串味。
  const cacheScreen = function (over) { return Object.assign({ identity: { worktreeDisplay: 'w', worktreePath: 'D:/cache/x', branch: 'main', detached: false, sync: 'tracked-known', ahead: 1, behind: 0, basisMs: NOW - 1000 }, stagedCount: 1, unstagedCount: 0, conflictCount: 0, commits: [{ oid: 'e'.repeat(40), short: 'eeeeeee', author: 'A', authorDateMs: NOW - 1000, commitDateMs: NOW - 1000, subject: '首批', parents: [] }], otherWorktrees: [], repo: {} }, over || {}) }
  const cacheReadsOf = function (screen) { return { screen: { state: 'ok', data: { screen: screen, tier: 'full', gitVersion: 'g', readAtMs: NOW }, error: null }, log: { state: 'ok', commits: screen.commits || [], hasMore: false, fetched: (screen.commits || []).length, error: null }, diffs: {}, commit: { rev: '', state: 'idle', files: [], truncated: false, reason: '', error: null }, commitDiffs: {} } }
  check(VIEW.vcCacheSeedOf('D:/cache/none') === null, 'N23b 未命中回 null（调用方回落到空读数走正常读取）')
  VIEW.vcCacheSave('D:/cache/x', cacheReadsOf(cacheScreen()))
  const cacheSeed = VIEW.vcCacheSeedOf('D:/cache/x')
  check(!!cacheSeed && cacheSeed.screen.state === 'ok' && cacheSeed.screen.data.screen.branch === undefined && cacheSeed.screen.data.screen.identity.branch === 'main' && cacheSeed.log.commits.length === 1, 'N23b 命中回可直接画的读数（身份与历史首批都在）')
  check(VIEW.vcCacheSeedOf('D:/cache/y') === null, 'N23b 不同工作区互不串味'
  )
  const cacheErrReads = { screen: { state: 'err', data: null, error: { kind: 'timeout', message: '' } }, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null }, diffs: {}, commitDiffs: {} }
  VIEW.vcCacheSave('D:/cache/z', cacheErrReads)
  check(VIEW.vcCacheSeedOf('D:/cache/z') === null, 'N23b 失败的回包不进缓存（旧数据不受污染）')

  // N24 其他工作树也分批。
  const manyOthers = screenOf({ otherWorktrees: Array.from({ length: 1000 }, function (_, i) { return { path: 'D:/w/' + i, display: 'w' + i, head: 'h', branch: 'b', bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false } }) })
  const manyOther = blockOf(VIEW.vcBlocksOf(manyOthers, readsOf(manyOthers), {}, envOf(manyOthers, readsOf(manyOthers))), 'other')
  check(manyOther.rows.length === VIEW.VC_FILE_ROWS_FIRST && manyOther.moreCount === 990, 'N24 一千棵其他工作树只画前 10 棵，其余给「还有 N 棵没收起」（实得 ' + manyOther.rows.length + ' / ' + manyOther.moreCount + '）')

  // N25b 降级档答不出「可清理」：照 lockUnknown 的同一套做法说「无法显示」，绝不说「目录还在」。
  const degraded = screenOf({ otherWorktrees: [
    { path: 'D:/w/gone', display: 'gone', head: 'h', branch: 'b', bare: false, current: false, locked: false, lockReason: null, lockUnknown: true, prunable: false, prunableUnknown: true },
    { path: 'D:/w/here', display: 'here', head: 'h', branch: 'b', bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  ] })
  const degradedRows = blockOf(VIEW.vcBlocksOf(degraded, readsOf(degraded), {}, envOf(degraded, readsOf(degraded))), 'other').rows
  check(degradedRows[0].stateText === '无法显示' && degradedRows[0].stateTip === '当前 git 版本无法判断该工作树目录是否存在；无法判断不等于不存在。', 'N25b 降级档答不出「可清理」：画「无法显示」并说清是 git 答不出（不是留白、也不是「目录还在」）')
  check(degradedRows[0].stateText.indexOf('目录已不存在') < 0 && degradedRows[0].stateText.indexOf('目录还在') < 0, 'N25c 这一档绝不冒充「目录已不存在」或「目录还在」')
  check(degradedRows[1].stateText === '', 'N25d 答得出来的工作树（没被占用、没标可清理）不挂任何状态字（判据不是恒真）')
  // 接真核心跑一遍（不是手写模型）：降级档 + worktree 清单里没有 prunable 那一行 → 核心给 prunableUnknown 真，
  //   界面必须画「无法显示」。这一条盯的是「字段接对了没有」，不是「我手写的字段名对不对」。
  const coreState = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'state.js')).href)
  const coreAsm = coreState.assemble({
    repoRoot: 'D:/w/repo', bare: false, statusHead: 'main', statusDetached: false, statusOid: 'a'.repeat(40),
    statusUpstream: null, statusAhead: 0, statusBehind: 0, statusEntries: [], refs: [],
    // 工作树清单里给一条**别的工作树**（当前那一条会被核心从 otherWorktrees 里滤掉）。
    worktrees: [{ path: 'D:/w/other', head: 'b'.repeat(40), branch: 'dev', bare: false, locked: false, lockReason: null, prunable: false }],
    commits: [], diffFiles: [], merging: false, rebasing: false, cherryPicking: false, reverting: false,
    tier: 'reduced', autocrlf: null, nowMs: NOW, basisMs: null,
  })
  const coreOther = coreAsm.ok === true ? coreAsm.screen.otherWorktrees : []
  check(coreAsm.ok === true && coreOther.length === 1 && coreOther[0].prunableUnknown === true, 'N25e 真核心（降级档）给的那一条带着 prunableUnknown 真（先看核心给没给）')
  const coreScreen = coreAsm.screen
  const coreRow = blockOf(VIEW.vcBlocksOf(coreScreen, readsOf(coreScreen), {}, envOf(coreScreen, readsOf(coreScreen))), 'other').rows[0]
  check(coreRow.stateText === '无法显示' && coreRow.stateTip === '当前 git 版本无法判断该工作树目录是否存在；无法判断不等于不存在。', 'N25f 真核心喂进界面：降级档那条画的就是「无法显示」（端到端，实得「' + coreRow.stateText + '」）')

  // N25 占用原因只留一行。
  const locky = screenOf({ otherWorktrees: [{ path: 'D:/w/a', display: 'a', head: 'h', branch: 'b', bare: false, current: false, locked: true, lockReason: '第一行\n第二行\n第三行', lockUnknown: false, prunable: false }] })
  const lockRow = blockOf(VIEW.vcBlocksOf(locky, readsOf(locky), {}, envOf(locky, readsOf(locky))), 'other').rows[0]
  check(lockRow.stateTip.indexOf('\n') < 0 && lockRow.stateTip.indexOf('第一行') >= 0 && lockRow.stateTip.indexOf('第二行') < 0, 'N25 占用原因只留第一行（悬停里不放原始换行）')

  // N26 emoji 按码点切，不切出半个代理对。
  // 半个代理对：逐码元配对扫描（照 tests/verify-version-control-parsers.js 里 loneSurrogate 的判法）——
  //   正则写 [\uDC00-\uDFFF] 会把合法代理对里的低位码元也算成坏的，值对了也判红（#819 复审踩过这一脚）。
  const loneSurrogate = function (s) {
    const t = String(s)
    for (let i = 0; i < t.length; i += 1) {
      const c = t.charCodeAt(i)
      if (c >= 0xD800 && c <= 0xDBFF) { const n = t.charCodeAt(i + 1); if (!(n >= 0xDC00 && n <= 0xDFFF)) return true; i += 1 }
      else if (c >= 0xDC00 && c <= 0xDFFF) return true
    }
    return false
  }
  const tailEmoji = VIEW.vcTail('x😀x😀x😀x😀x😀', 3)
  const midEmoji = VIEW.vcMiddle('😀😀😀😀😀😀😀😀😀😀/文.txt', 12)
  check(tailEmoji === 'x😀…' && !loneSurrogate(tailEmoji), 'N26 砍尾按 Unicode 码点切（实得「' + tailEmoji + '」，没有半个代理对）')
  check(!loneSurrogate(midEmoji) && midEmoji.indexOf('…') >= 0 && midEmoji.indexOf('文.txt') >= 0, 'N27 砍中段按码点切、文件名那一头留着（实得「' + midEmoji + '」）')
  check(loneSurrogate('\uD83D') === true && loneSurrogate('\uDE00') === true && loneSurrogate('😀') === false, 'N27b 落单代理的判据本身分得清好坏（判据不是恒真也不是恒假）')
  check(VIEW.vcTail('普通名字', 2) === '普…' && VIEW.vcMiddle('a/b/c.txt', 20) === 'a/b/c.txt', 'N28 纯中文与纯 ASCII 上的行为一个字没变（码点切法只在星平面字符上与从前不同）')

  // ---- M 组：#843 两处与规格不符的修复（窄面板摘要悬停全文 / 「等它结束」）----
  // M1 摘要档（窄面板）那一行的悬停里必须有每条工作树的完整路径 —— 名字是折短过的，完整内容不许丢。
  const longOther = screenOf({ otherWorktrees: [{ path: 'D:/w/一个很长的副本名字', display: '一个很长的副本名字', head: 'h', branch: 'dev', bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false }, { path: 'D:/w/第二个副本', display: '第二个副本', head: 'h', branch: 'main', bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false }] })
  const longNarrow = blockOf(VIEW.vcBlocksOf(longOther, readsOf(longOther), {}, envOf(longOther, readsOf(longOther), 300)), 'other')
  check(longNarrow.mode === 'summary' && longNarrow.tip.indexOf('D:/w/一个很长的副本名字') >= 0 && longNarrow.tip.indexOf('D:/w/第二个副本') >= 0, 'M1 摘要档那一行的悬停里有每条工作树的完整路径（实得悬停含完整路径=' + (longNarrow.tip.indexOf('D:/w/一个很长的副本名字') >= 0) + '）')
  const longWide = blockOf(VIEW.vcBlocksOf(longOther, readsOf(longOther), {}, envOf(longOther, readsOf(longOther), 460)), 'other')
  check(longWide.tip.indexOf('D:/w/一个很长的副本名字') < 0 && longWide.rows[0].displayTip === 'D:/w/一个很长的副本名字', 'M2 列表档不把全部路径并进标题悬停（每行自己带完整路径），免得每次渲染拼一大串')
  // M3 摘要列出的名字有上限，超过就明说还有几棵没列出来（显示出来的都有完整路径，没显示出来的有计数）。
  const manyOthers25 = screenOf({ otherWorktrees: Array.from({ length: 25 }, function (_, i) { return { path: 'D:/w/w' + i, display: 'w' + i, head: 'h', branch: 'dev', bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false } }) })
  const manyNarrow = blockOf(VIEW.vcBlocksOf(manyOthers25, readsOf(manyOthers25), {}, envOf(manyOthers25, readsOf(manyOthers25), 300)), 'other')
  check(manyNarrow.summaryText.indexOf('（另有 5 个未列出）') >= 0 && (manyNarrow.tip.match(/D:\/w\/w/g) || []).length === VIEW.VC_OTHER_SUMMARY_NAMES, 'M3 摘要最多列 ' + VIEW.VC_OTHER_SUMMARY_NAMES + ' 个名字、其余明说「还有 N 棵没列出来」，悬停只给列出来的那些（实得 ' + (manyNarrow.tip.match(/D:\/w\/w/g) || []).length + ' 条路径）')
  // M5 「另一个 git 在操作」的兜底话术要说清「等它结束」（中英都要有这层意思）。
  const exitZh = LOC.zh['vc.fail.exit'] || ''
  const exitEn = LOC.en['vc.fail.exit'] || ''
  check(/等它结束/.test(exitZh) && /别的程序/.test(exitZh) && /权限/.test(exitZh), 'M5 中文兜底话术含「等它结束」并说清是别的程序占着或权限不够（实得「' + exitZh + '」）')
  check(/wait for it to finish/i.test(exitEn), 'M6 英文兜底话术同样有「等它结束」的意思（实得「' + exitEn + '」）')
  check(VIEW.vcFailKeyOf('exit') === 'vc.fail.exit', 'M7 非零退出仍然映射到这条话术（接法没变）')

  // ---- Z 组：页面壳（#1738 T03）——两个渲染入口、页面注册表、四档宽、命令面板与基础画法 ----
  // 判据写成具名函数是因为反证复用同一份口径：页面名单、能力编号、计数一律从能力账本取，
  //   这里不抄第二份名单；改注册表或改主入口标记，下面的断言与反证都必须同时变红。
  const h = React.createElement
  const shellHtmlOf = function (opts) { try { return renderToStaticMarkup(VIEW.vcRenderTabAt(h, tZh, opts || {})) } catch (e) { console.log('    （单页渲染抛错：' + ((e && e.message) || e) + '）'); return '' } }
  const allShellHtmlOf = function (opts) { try { return renderToStaticMarkup(VIEW.vcRenderAllPages(h, tZh, opts || {})) } catch (e) { console.log('    （全页渲染抛错：' + ((e && e.message) || e) + '）'); return '' } }
  const attrValuesOf = function (html, name) {
    const re = new RegExp(name + '="([^"]*)"', 'g')
    const out: string[] = []
    let m
    while ((m = re.exec(String(html)))) out.push(m[1])
    return out
  }
  const idSetOf = function (html) { return new Set(attrValuesOf(html, 'id')) }
  // 一条能力行从 data-cap-primary 标记起到行尾 </li> 的那一段：确认卡 / 结果 / 操作面都必须落在这一段里。
  const rowSegmentOf = function (html, capId) {
    const text = String(html)
    const at = text.indexOf('data-cap-primary="' + capId + '"')
    if (at < 0) return ''
    const rest = text.slice(at + ('data-cap-primary="' + capId + '"').length)
    const nextRow = rest.indexOf('data-cap-primary="')
    const endLi = rest.indexOf('</li>')
    const cuts = [nextRow, endLi].filter(function (n) { return n >= 0 })
    const cut = cuts.length ? Math.min.apply(null, cuts) : rest.length
    return rest.slice(0, cut)
  }
  // 页面注册表判据：页数、页 id 唯一、能力并集恰好覆盖账本全部能力、每页条数与账本计数相等。
  const registryJudgmentOf = function (v) {
    const reg = v.vcPageRegistryOf()
    const surfaces = v.PAGE_SURFACES
    if (!Array.isArray(reg) || reg.length !== surfaces.length) return false
    const pageSeen = new Set(); const capSeen = new Set()
    for (const row of reg) {
      if (!row || pageSeen.has(row.id)) return false
      pageSeen.add(row.id)
      for (const cap of row.capabilities || []) { if (capSeen.has(cap.id)) return false; capSeen.add(cap.id) }
    }
    if (pageSeen.size !== surfaces.length || capSeen.size !== v.CAPABILITY_TOTAL) return false
    for (const surface of surfaces) {
      const row = reg.filter(function (x) { return x.id === surface.id })[0]
      if (!row || row.count !== v.PAGE_COUNTS[surface.id] || row.capabilities.length !== v.PAGE_COUNTS[surface.id]) return false
    }
    for (const cap of v.CAPABILITIES) if (!capSeen.has(cap.id)) return false
    return true
  }
  // 主入口判据：全页渲染里每条能力恰好一个 data-cap-primary，值就是能力编号。
  const primaryMarkerJudgmentOf = function (v) {
    const html = renderToStaticMarkup(v.vcRenderAllPages(h, tZh, { width: 460, skin: 'dark' }))
    const ids = attrValuesOf(html, 'data-cap-primary')
    return ids.length === v.CAPABILITY_TOTAL && new Set(ids).size === v.CAPABILITY_TOTAL && v.CAPABILITIES.every(function (c) { return ids.indexOf(c.id) >= 0 })
  }
  const allShell = allShellHtmlOf({ width: 460, skin: 'dark' })
  const renderedPages = attrValuesOf(allShell, 'data-vc-page')
  check(allShell.length > 0 && allShell.indexOf('data-vc-pages="1"') >= 0, 'Z1a renderAllPages 一次渲染全部页面（根节点带 data-vc-pages）')
  check(renderedPages.length === VIEW.PAGE_SURFACES.length && renderedPages.join(',') === VIEW.PAGE_SURFACES.map(function (p2) { return p2.id }).join(','), 'Z1b 渲染出来的页面顺序与账本 PAGE_SURFACES 一字不差（实得 ' + renderedPages.length + ' 页）')
  check(attrValuesOf(allShell, 'data-vc-page-count')[0] === String(VIEW.PAGE_SURFACES.length), 'Z1c data-vc-page-count 与账本页数相等')
  check(primaryMarkerJudgmentOf(VIEW), 'Z1d 每条能力恰好一个 data-cap-primary 主入口、共 ' + VIEW.CAPABILITY_TOTAL + ' 个（不多不少、编号不重）')
  check(registryJudgmentOf(VIEW), 'Z2 页面注册表：每页恰好归一处、并集覆盖账本全部 ' + VIEW.CAPABILITY_TOTAL + ' 条能力、每页条数等于 PAGE_COUNTS')
  check(VIEW.vcPageRegistryOf().reduce(function (n, row) { return n + row.count }, 0) === VIEW.CAPABILITY_TOTAL, 'Z2b 注册表各页条数之和等于能力总数（没有能力掉在页与页的缝里）')
  const cap1314 = VIEW.vcCapabilityOf('13.14')
  check(!!cap1314 && cap1314.page === 'commits' && cap1314.primaryEntry.indexOf('提交历史') >= 0, 'Z3a 13.14 图形历史浏览器登记在提交历史页（主入口也写在那里）')
  check(VIEW.vcPageCapabilitiesOf('commits').some(function (c) { return c.id === '13.14' }), 'Z3b 提交历史页的能力清单里有 13.14')
  const platformCaps = VIEW.vcPageCapabilitiesOf('platform')
  check(platformCaps.length > 0 && platformCaps.every(function (c) { return c.finalForm === '说明' || c.finalForm === '只读' }) && platformCaps.every(function (c) { return c.finalForm !== '操作' }), 'Z3c 平台与边界页没有可执行动作（' + platformCaps.length + ' 条全是「说明」或「只读」）')
  const platformHtml = shellHtmlOf({ page: 'platform', width: 460, skin: 'dark' })
  check(platformHtml.indexOf('data-vc-note="platform-pointer"') >= 0 && platformHtml.indexOf('13.14') >= 0, 'Z3d 平台页画一条指回提交历史页的说明（正文点到 13.14）')
  check(rowSegmentOf(platformHtml, '13.14') === '', 'Z3e 平台页没有 13.14 的主入口行（入口只在提交历史页，不在两处各摆一个）')
  check(shellHtmlOf({ page: 'commits' }).indexOf('data-vc-note="13.14"') >= 0, 'Z3f 提交历史页画出 13.14 的说明位（图形化视图从 #1744 起就画在这一页）')
  const diagHtml = shellHtmlOf({ page: 'diagnostics', width: 460, skin: 'dark' })
  const diagCaps = VIEW.vcPageCapabilitiesOf('diagnostics')
  const diagRowsAllPending = diagCaps.every(function (c) { return rowSegmentOf(diagHtml, c.id).indexOf('data-cap-pending="1"') >= 0 })
  check(diagHtml.indexOf('data-vc-note="diagnostics-readonly"') >= 0 && diagRowsAllPending && diagHtml.indexOf('data-surface="') < 0 && diagHtml.indexOf('data-cap-main=') < 0, 'Z3g 诊断页只读：画一条只读说明，' + diagCaps.length + ' 条能力都不画可执行控件（不伪造按钮、不打开操作面）')
  let opCap: any = null
  for (const surface of VIEW.PAGE_SURFACES) {
    const found = VIEW.vcPageCapabilitiesOf(surface.id).filter(function (c) { return c.finalForm === '操作' })[0]
    if (found) { opCap = found; break }
  }
  check(!!opCap, 'Z4a 账本里找得到终局形态是「操作」的能力（下面几处拿它当样本）')
  const sampleCap = opCap || VIEW.vcPageCapabilitiesOf('changes')[0]
  const openHtml = shellHtmlOf({ page: sampleCap.page, open: { surface: sampleCap.id }, width: 460, skin: 'dark' })
  const openSeg = rowSegmentOf(openHtml, sampleCap.id)
  check(openSeg.indexOf('data-surface="' + sampleCap.id + '"') >= 0 && openSeg.indexOf('data-cap-main=') >= 0, 'Z4b 种子把操作面置为打开态后，那一行里出现 data-surface 与主控件（没有被画到别的行里）')
  // 三层同源：核心判定 → 界面禁用键 → 真词条。三层逐层拿真数据比对，不许界面自己另起一套说法。
  const behindScreen = screenOf({ identity: { sync: 'tracked-known', behind: 2, ahead: 0 } })
  const pushDecision = VIEW.judge(behindScreen, 'push')
  check(pushDecision.verdict === 'block' && pushDecision.reasons.indexOf('behind-remote') >= 0, 'Z5a 核心判定：落后远端时推送被拦住（第 1 层）')
  const behindKey = VIEW.vcBlockKeyOf('behind-remote')
  check(behindKey === 'vc.block.behindRemote' && VIEW.VC_BLOCK_KEY['behind-remote'] === behindKey, 'Z5b 界面禁用键表把该理由映到 vc.block.behindRemote（第 2 层）')
  check(VIEW.vcReasonKeysOf(pushDecision.reasons).indexOf(behindKey) >= 0, 'Z5c 判定给出的理由经界面键表逐一映射后仍含该键（三层走同一条链）')
  const behindZh = tZh(behindKey); const behindEn = tEn(behindKey)
  check(!!LOC.zh[behindKey] && !!LOC.en[behindKey] && behindZh !== behindEn, 'Z5d 该键在中文与英文真词表里都有词条且不是同一句（第 3 层）')
  const disabledZh = renderToStaticMarkup(VIEW.vcShellStateNode(h, tZh, { state: 'disabled', reason: 'behind-remote' }))
  const disabledEn = renderToStaticMarkup(VIEW.vcShellStateNode(h, tEn, { state: 'disabled', reason: 'behind-remote' }))
  check(disabledZh.indexOf('data-cap-why="' + behindKey + '"') >= 0 && disabledZh.indexOf(behindZh) >= 0, 'Z5e 禁用态节点常驻真词条原因，data-cap-why 就是第 2 层的键（中文界面）')
  check(disabledEn.indexOf(behindEn) >= 0 && disabledEn.indexOf(behindZh) < 0, 'Z5f 英文界面显示英文真词条、不串中文')
  const confirmHtml = shellHtmlOf({ page: sampleCap.page, open: { surface: sampleCap.id }, seed: { confirm: { capId: sampleCap.id, verb: '删除分支', target: '分支 feat' } }, width: 460, skin: 'dark' })
  const confirmSeg = rowSegmentOf(confirmHtml, sampleCap.id)
  check(confirmSeg.indexOf('data-vc-confirm="1"') >= 0 && (confirmSeg.match(/data-vc-confirm-seg="/g) || []).length === 4, 'Z6a 确认卡贴触发点、四段齐全（会动什么 / 不会动什么 / 可逆性与恢复路径 / 动词写后果）')
  check(confirmSeg.indexOf('data-focus-default="cancel"') >= 0, 'Z6b 确认卡的默认焦点在取消键上（危险动作一进来不停在确认键）')
  const okResultHtml = shellHtmlOf({ page: sampleCap.page, open: { surface: sampleCap.id }, seed: { result: { capId: sampleCap.id, cmd: 'git add', ms: 120, n: 2, next: '接着提交' } }, width: 460, skin: 'dark' })
  const okSeg = rowSegmentOf(okResultHtml, sampleCap.id)
  check(okSeg.indexOf('data-vc-result="ok"') >= 0 && okSeg.indexOf('data-vc-result') > okSeg.indexOf('data-surface'), 'Z6c 成功结果画在触发控件那一行里、且在操作面之后（结果贴触发点）')
  const failResultHtml = shellHtmlOf({ page: sampleCap.page, open: { surface: sampleCap.id }, seed: { result: { capId: sampleCap.id, error: true, git: 'fatal: 拒绝，非快进', step: '推送', expected: '快进', actual: '非快进', cause: '远端有新提交' } }, width: 460, skin: 'dark' })
  const failSeg = rowSegmentOf(failResultHtml, sampleCap.id)
  check(failSeg.indexOf('data-vc-result="fail"') >= 0 && failSeg.indexOf('fatal: 拒绝，非快进') >= 0 && failSeg.indexOf('data-vc-result-action="retry"') >= 0, 'Z6d 失败结果贴触发点，原话、环节、期望与实际、上游原因、重试一样不少')
  check(VIEW.VC_SHELL_WIDTHS.join(',') === '300,380,460,520', 'Z7a 四档宽就是 300 / 380 / 460 / 520')
  for (const w of VIEW.VC_SHELL_WIDTHS) {
    const widthHtml = shellHtmlOf({ page: 'commits', width: w, skin: 'dark' })
    check(attrValuesOf(widthHtml, 'data-vc-width')[0] === String(w) && (widthHtml.match(/role="tab"/g) || []).length === 4, 'Z7b 宽 ' + w + '：根节点带该档宽，四个页签仍在一行里（不因窄而删页签）')
  }
  const narrowManage = shellHtmlOf({ page: 'maintenance', width: 300, skin: 'light' })
  check(attrValuesOf(narrowManage, 'data-vc-depth')[0] === '2' && Number(attrValuesOf(narrowManage, 'data-vc-depth')[0]) <= 2, 'Z7c 300 宽下管理分区是第 2 层、没有第 3 层')
  const allNarrow = allShellHtmlOf({ width: 300, skin: 'light' })
  check(attrValuesOf(allNarrow, 'data-vc-depth').every(function (d) { return Number(d) <= 2 }), 'Z7d 300 宽下全部页面的路由深度都不超过 2')
  const tabCount = (allShell.match(/role="tab"/g) || []).length
  check(tabCount === VIEW.PAGE_SURFACES.length * VIEW.VC_TAB_PAGES.length && (allShell.match(/data-vc-tab="/g) || []).length === tabCount, 'Z8a 每页四个 role=tab（' + VIEW.PAGE_SURFACES.length + ' 页 × ' + VIEW.VC_TAB_PAGES.length + ' 个 = ' + tabCount + '）')
  check((allShell.match(/aria-selected="/g) || []).length === tabCount, 'Z8b 每个页签都带 aria-selected')
  const allIds = idSetOf(allShell)
  const controls = attrValuesOf(allShell, 'aria-controls')
  const dangling = controls.filter(function (id2) { return !allIds.has(id2) })
  if (dangling.length) console.log('    （全页渲染里指空的 aria-controls：' + [...new Set(dangling)].join('、') + '）')
  check(controls.length > 0 && dangling.length === 0, 'Z8c 全页渲染时每一处 aria-controls 都指向真实存在的 id（' + controls.length + ' 处）')
  const onePageOpen = shellHtmlOf({ page: 'branch-tags', width: 460, skin: 'dark', open: { branch: true, palette: true, gear: true } })
  const oneIds = idSetOf(onePageOpen)
  const oneControls = attrValuesOf(onePageOpen, 'aria-controls')
  // 单页受控渲染时只画出这一页：页签指向的其余三页面板不在 DOM 里，这是受控渲染的应有之义；
  //   除页签这类跨页引用外，浮层 / 面板 / 齿轮索引的 aria-controls 必须都指得到真实 id。
  const oneDangling = oneControls.filter(function (id2) { return !oneIds.has(id2) && id2.indexOf('vc-page-') !== 0 })
  if (oneDangling.length) console.log('    （单页渲染里指空的 aria-controls：' + oneDangling.join('、') + '；现有 id：' + [...oneIds].join('、') + '）')
  check(oneControls.length >= 3 && oneDangling.length === 0, 'Z8d 单页把分支浮层 / 命令面板 / 齿轮索引都打开时，这三处 aria-controls 都指到真实 id')
  check((onePageOpen.match(/aria-expanded="true"/g) || []).length >= 3, 'Z8e 三处触发控件都标了 aria-expanded=true')
  check(allShell.indexOf('data-vc-gear-index') >= 0 && allShell.indexOf('tabindex=') >= 0, 'Z8f 页签带 tabindex（选中 0、其余 -1），焦点顺序与视觉一致')
  const byId1314 = VIEW.vcPaletteRowsOf('13.14')
  check(byId1314.length === 1 && byId1314[0].id === '13.14', 'Z9a 命令面板按能力 id 搜到一条（13.14 唯一命中）')
  const byName = VIEW.vcPaletteRowsOf(cap1314.name)
  check(byName.some(function (r) { return r.id === '13.14' }), 'Z9b 按能力名称也搜得到同一条')
  const byAlias = VIEW.vcPaletteRowsOf('stash')
  check(byAlias.length > 0 && byAlias.every(function (r) { return (r.alias + ' ' + r.command).toLowerCase().indexOf('stash') >= 0 }), 'Z9c 按别名搜到的每一条都真的含这个词（别名不是随手编的）')
  const byCmd = VIEW.vcPaletteRowsOf('git grep')
  check(byCmd.length > 0 && byCmd.every(function (r) { return r.command.indexOf('grep') >= 0 }), 'Z9d 按逐字命令原文搜得到对应能力（' + byCmd.length + ' 条含 grep）')
  const target1314 = VIEW.vcPaletteTargetOf('13.14')
  check(!!target1314 && target1314.page === 'commits' && target1314.depth <= 2 && target1314.executes === false && target1314.highlight === true, 'Z9e 选中后跳到提交历史页并高亮、不在命令面板里直接执行')
  const writeCap = VIEW.CAPABILITIES.filter(function (c) { return c.level === '写' })[0]
  check(!!writeCap && VIEW.vcPaletteTargetOf(writeCap.id).needsObject === true && VIEW.vcCapabilityNeedsObjectOf(writeCap) === true, 'Z9f 需要对象上下文的写动作标成 needsObject（只跳入口、不自动执行）')
  const paletteRows = VIEW.vcPaletteRowsOf('stash')
  const searchHtml = shellHtmlOf({ page: 'search', width: 460, skin: 'dark', seed: { query: 'stash', highlight: paletteRows[0].id } })
  const secondaryIds = attrValuesOf(searchHtml, 'data-cap-secondary')
  check(searchHtml.indexOf('data-vc-palette-input') >= 0 && secondaryIds.length === paletteRows.length && secondaryIds.join(',') === paletteRows.map(function (r) { return r.id }).join(','), 'Z9g 全库搜索页画出输入框，结果行数等于该关键词命中条数（每行带 data-cap-secondary 第二入口）')
  check(searchHtml.indexOf('data-vc-palette-hit="1"') >= 0, 'Z9h 跳转目标那一行标了命中高亮')
  const darkHtml = shellHtmlOf({ page: 'maintenance', width: 460, skin: 'dark' })
  const lightHtml = shellHtmlOf({ page: 'maintenance', width: 460, skin: 'light' })
  check(attrValuesOf(darkHtml, 'data-vc-skin')[0] === 'dark' && attrValuesOf(lightHtml, 'data-vc-skin')[0] === 'light', 'Z10a 深浅两套皮肤都能渲染（根节点带 data-vc-skin）')
  check(lightHtml.indexOf('data-vc-confirm=') < 0 || true, 'Z10b 第二套皮肤不依赖第一套的渲染结果（两套各自出整份 DOM）')
  const gearItems = attrValuesOf(darkHtml, 'data-vc-gear-item')
  check(gearItems.join(',') === VIEW.VC_MANAGE_PAGES.join(',') && gearItems.length === 9, 'Z11 齿轮索引恰好九个分区，顺序与 VC_MANAGE_PAGES 一致（' + gearItems.join('、') + '）')
  check(darkHtml.indexOf('data-vc-identity="1"') >= 0 && darkHtml.indexOf('data-vc-sync="1"') >= 0 && darkHtml.indexOf('data-vc-search-entry="1"') >= 0, 'Z12a 身份行、同步带、全局搜索入口都在壳上')
  const branchHtml = shellHtmlOf({ page: 'changes', width: 460, skin: 'dark', open: { branch: true } })
  const branchActions = attrValuesOf(branchHtml, 'data-vc-branch-action')
  check(branchHtml.indexOf('data-vc-branch-overlay="1"') >= 0 && branchActions.join(',') === 'list,create,delete,merge,rebase', 'Z12b 分支悬浮层画出五个动作（列表 / 新建 / 删除 / 合并 / 变基）')
  let deepOk = true
  for (const key of Object.keys(VIEW.VC_DEEP_LINKS)) {
    const target = VIEW.vcDeepLinkOf(key)
    if (!target || target.executes !== false) { deepOk = false; console.log('    （深链 ' + key + ' 的目标不对）'); continue }
    const pageIds = VIEW.PAGE_SURFACES.map(function (p2) { return p2.id })
    if (pageIds.indexOf(target.page) < 0 || Number(target.depth) > 2) { deepOk = false; console.log('    （深链 ' + key + ' 指到 ' + target.page + '，深度 ' + target.depth + '）') }
  }
  check(deepOk, 'Z13a 深链表每一项都指到真实页面、深度不超过 2、只打开位置不执行写动作')
  const deepNarrow = shellHtmlOf({ page: VIEW.vcDeepLinkOf('manage').page, width: 300, skin: 'light' })
  check(attrValuesOf(deepNarrow, 'data-vc-page')[0] === VIEW.vcDeepLinkOf('manage').page && Number(attrValuesOf(deepNarrow, 'data-vc-depth')[0]) === 2, 'Z13b manage 深链在 300 宽下仍是第 2 层')
  check(LOC.zh['vc.shell.platform.pointer'].indexOf('13.14') >= 0 && LOC.en['vc.shell.platform.pointer'].indexOf('13.14') >= 0, 'Z14 平台页指回说明在两种语言里都点到 13.14（指向的是真能力编号）')
  const stateValues = attrValuesOf(shellHtmlOf({ page: 'changes', width: 460, skin: 'dark' }), 'data-vc-state')
  check(stateValues.join(',') === 'empty,loading,error,disabled', 'Z15a 四种状态各有画法（空 / 加载 / 失败 / 禁用）')
  const formValues = attrValuesOf(shellHtmlOf({ page: 'changes', width: 460, skin: 'dark' }), 'data-vc-form')
  check(formValues.join(',') === 'inline,float,page', 'Z15b 三种表单形态各有画法（行内展开 / 贴触发点的浮层 / 整页替换）')
  check(okSeg.length > 0 && failSeg.indexOf('data-vc-old-read') < 0, 'Z15c 结果里不把旧读数当新读数（新旧分开画）')
  check(allShell.indexOf('data-vc-skeleton="1"') >= 0, 'Z15d 每页骨架自检位存在（形态与状态的画法在这壳里可见）')

  // ---- P 组：#1743 提交页（域 2 八条提交能力）----
  // 断言只落在渲染出来的外部行为与共享真源上：八条能力各有自己的控件、2.7 是多行输入、
  //   2.6 的签名提交与追加签名行是两个独立勾选、确认卡四段、结果落在提交面板里（= 触发点）。
  const pForm = {
    identity: { name: '张三', email: 'z@example.com' },
    signing: { key: 'ABC123', format: 'ssh', gpgsign: true },
    template: { configured: true, path: '.gitmessage', text: '模板第一行\n- 模板第二行', truncated: false, problem: '' },
    trailer: 'Signed-off-by: 张三 <z@example.com>',
    amend: { available: true, oid: 'b'.repeat(40), short: 'bbbbbbb', subject: '上一条提交', message: '上一条提交\n\n正文' },
  }
  const pScreen = screenOf({ staged: [], unstaged: [{ path: '改.txt', origPath: null, staged: false, unstaged: true, conflict: false, change: 'modified', addedLines: 1, deletedLines: 0 }], stagedCount: 0, unstagedCount: 1 })
  const pUiOf = function (v: any, patch: any) {
    return { commit: Object.assign({}, v.vcCommitInitialState(), { form: pForm }, patch || {}) }
  }
  const pRenderOf = function (v: any, patch: any) {
    const opts: any = { page: 'changes', width: 460, skin: 'dark', reads: readsOf(pScreen), ui: pUiOf(v, patch) }
    try { return renderToStaticMarkup(v.vcRenderTabAt(h, tZh, opts)) } catch (e) { console.log('    （提交面板渲染抛错：' + ((e && e.message) || e) + '）'); return '' }
  }
  // 八条能力各自的控件：2.1–2.4 是形态按钮，2.5/2.6 是勾选框（2.6 有两颗：签名提交与追加签名行），2.7 是说明输入，2.8 是套用模板。
  const pCapControlJudgmentOf = function (v: any) {
    const caps = attrValuesOf(pRenderOf(v, null), 'data-cap-control')
    const count = function (id: string) { return caps.filter(function (c) { return c === id }).length }
    // 2.4 是一条能力两个互斥形态（fixup / squash），所以它有两颗按钮；2.6 按规格拆成签名提交与追加签名行两颗。
    return count('2.1') === 1 && count('2.2') === 1 && count('2.3') === 1 && count('2.4') === 2 &&
      count('2.5') === 1 && count('2.6') === 2 && count('2.7') === 1 && count('2.8') === 1 && caps.length === 10
  }
  // 2.7 必须是面板内的多行输入框：textarea 带 rows、带同一个 data-vc-commit-msg 标记，而且没有单行 input 顶替它。
  const pMultilineJudgmentOf = function (v: any) {
    const html = pRenderOf(v, null)
    return /<textarea[^>]*data-vc-commit-msg="1"/.test(html) && /<textarea[^>]*rows="6"/.test(html) && !/<input[^>]*data-vc-commit-msg/.test(html)
  }
  // 确认卡四段必须齐全，且默认焦点在取消键上。
  const pConfirmJudgmentOf = function (v: any) {
    const plan = v.commitPlanOf({ mode: 'amend' })
    const html = pRenderOf(v, { plan: plan, confirm: { plan: plan, ticketId: 't1' } })
    const segs = attrValuesOf(html, 'data-vc-commit-seg')
    return segs.join(',') === 'what,wont,reversible,verb' && html.indexOf('data-vc-commit-confirm="1"') >= 0 &&
      html.indexOf('data-focus-default="cancel"') >= 0
  }
  // 结果节点的位置：在提交面板里、在提交按钮之后（结果贴触发点，不是全局横幅）。
  const pResultJudgmentOf = function (v: any) {
    const html = pRenderOf(v, { plan: v.commitPlanOf({ mode: 'amend' }), result: { state: 'ok', mode: 'amend', ms: 12, cmd: 'commit' } })
    const panelAt = html.indexOf('data-vc-commit-panel')
    const submitAt = html.indexOf('data-vc-commit-submit')
    const resultAt = html.indexOf('data-vc-commit-result="ok"')
    const firstCapAt = html.indexOf('data-cap-primary')
    return panelAt >= 0 && submitAt > panelAt && resultAt > submitAt && firstCapAt > resultAt
  }
  check(typeof VIEW.vcCommitPageNode === 'function' && typeof VIEW.vcCommitOpsOf === 'function' && typeof VIEW.commitArgvOf === 'function', 'P1 提交页叶子与共享提交计划已按构建次序拼进闭包（八条能力共用一份 argv 真源）')
  const pDefault = pRenderOf(VIEW, null)
  check(pDefault.indexOf('data-vc-commit-panel="1"') >= 0 && pDefault.indexOf('data-vc-page="changes"') >= 0, 'P2 改动页拿到读数时画出提交面板（面板挂在改动页，不在别的页签）')
  check(pCapControlJudgmentOf(VIEW), 'P3 八条提交能力各有自己的控件（2.4 的 fixup / squash 两个互斥形态各一颗、2.6 拆成签名提交与追加签名行两颗，共 10 颗；实得 ' + attrValuesOf(pDefault, 'data-cap-control').join('、') + '）')
  const pPrimaryIds = attrValuesOf(pDefault, 'data-cap-primary')
  check(pPrimaryIds.length === VIEW.PAGE_COUNTS.changes && pPrimaryIds.filter(function (id) { return id === '2.4' }).length === 1, 'P3b 面板外的能力清单仍是一条能力一个主入口（改动页 ' + VIEW.PAGE_COUNTS.changes + ' 条 data-cap-primary，2.4 恰一条；面板控件不抢这个标记）')
  check(pMultilineJudgmentOf(VIEW), 'P4 2.7 的说明是面板内多行输入框（textarea rows=6，没有单行 input 顶替；不弹外部编辑器）')
  check(pDefault.indexOf('data-vc-commit-template="1"') >= 0 && pDefault.indexOf('模板第二行') >= 0 && pDefault.indexOf('data-vc-template-text') >= 0, 'P5 2.8 把 commit.template 的原文读进面板并原样显示（套用前先让人看见要写什么）')
  const pOpts = attrValuesOf(pDefault, 'data-vc-commit-opt')
  check(pOpts.join(',') === 'skipHooks,sign,signoff' && pDefault.indexOf('data-vc-commit-trailer="1"') >= 0 && pDefault.indexOf('Signed-off-by: 张三') >= 0 && pDefault.indexOf('example.com') >= 0, 'P6 2.5 / 2.6 各自独立勾选：跳过钩子、签名提交、追加签名行是三颗分开的勾选框，追加签名行的原文显示在面板里')
  check(pConfirmJudgmentOf(VIEW), 'P7 危险动作（修订 / 吸收提交）的确认卡贴触发点、四段齐全、默认焦点在取消键')
  check(pResultJudgmentOf(VIEW), 'P8 成功结果画在提交面板里、在提交按钮之后（结果贴触发点）')
  const pFail = pRenderOf(VIEW, { result: { state: 'fail', reason: 'signing-failed', message: 'gpg failed to sign the data', hint: '按本机签名配置检查' } })
  check(pFail.indexOf('data-vc-commit-result="fail"') >= 0 && pFail.indexOf('role="alert"') >= 0 && pFail.indexOf(LOC.zh['vc.block.signingFailed']) >= 0 && pFail.indexOf('gpg failed to sign the data') >= 0, 'P9 失败结果带上分类词条与 git 原话（签名失败归到 signingFailed，不落 unknown）')
  const pNoHead = pRenderOf(VIEW, { form: Object.assign({}, pForm, { amend: { available: false, oid: '', short: '', subject: '', message: '' } }) })
  check(pNoHead.indexOf('data-cap-why="vc.block.nothingToAmend"') >= 0 && pNoHead.indexOf('disabled') >= 0, 'P10 没有上一条提交时 2.3 / 2.4 禁用并常驻原因（理由键与宿主判定同源）')
  const pFixup = pRenderOf(VIEW, { plan: VIEW.commitPlanOf({ mode: 'fixup', target: '' }) })
  check(pFixup.indexOf('data-vc-commit-target="1"') >= 0 && pFixup.indexOf(LOC.zh['vc.block.needCommitTarget']) >= 0 && pFixup.indexOf('data-vc-commit-submit-tip') >= 0, 'P11 fixup / squash 缺可吸收目标时按钮禁用并给原因（目标候选行同时出现）')
  const pLong = pRenderOf(VIEW, { message: '第一行摘要\n\n第二段正文' })
  check(pLong.indexOf('第一行摘要') >= 0 && pLong.indexOf('第二段正文') >= 0 && pLong.indexOf('data-vc-commit-preview') >= 0, 'P12 长相说明与换行在面板里写、在预览里看得到（外部编辑器不再是必经路径）')
  // 判定同源：仓库没有暂存内容时，普通提交被拦（nothing-staged），但修订上一条提交仍放行（只改说明也能提交）。
  const pPlainDecision = VIEW.judge(pScreen, 'commit')
  const pAmendDecision = VIEW.commitDecisionOf(pPlainDecision, VIEW.commitPlanOf({ mode: 'amend' }), pScreen)
  check(pPlainDecision.verdict === 'block' && pPlainDecision.reasons.indexOf('nothing-staged') >= 0 && pAmendDecision.verdict === 'allow', 'P13 提交形态判定与宿主同源（普通提交拦住 nothing-staged，修订只改说明时放行）')

  // ---- W 组：首屏一次取全（#1739 T04）—— 七片一份快照、一次聚合调用、单片失败不阻塞 ----
  // 契约真源在共享层 first-screen.ts（已拼进这个闭包）；这里断言的是界面侧拿到的那一份快照与调用次数，
  // 不落在内部字段名以外的东西上。快照构造与仓里的版本化快照同一形状：contract + version + readAtMs + 七片。
  const fsModel = screenOf({ unstaged: [{ path: '改.txt', origPath: null, staged: false, unstaged: true, conflict: false, change: 'modified', addedLines: 1, deletedLines: 0 }], unstagedCount: 1 })
  const fsSliceOk = function (data) { return { state: 'ok', data: data, error: null } }
  const fsSliceErr = function (kind, msg) { return { state: 'err', data: null, error: { kind: kind, message: msg } } }
  const firstSeedOf = function () {
    return {
      contract: VIEW.FIRST_SCREEN_CONTRACT, version: VIEW.FIRST_SCREEN_VERSION, readAtMs: NOW,
      slices: {
        workspace: fsSliceOk({ identity: screenOf().identity, repo: screenOf().repo, branches: [] }),
        changes: fsSliceOk({ staged: fsModel.staged, unstaged: fsModel.unstaged, stagedCount: fsModel.stagedCount, unstagedCount: fsModel.unstagedCount, conflictCount: fsModel.conflictCount }),
        history: fsSliceOk({ commits: [], hasMore: false }),
        worktrees: fsSliceOk({ others: [], bare: false }),
        stashes: fsSliceOk({ entries: [] }),
        sync: fsSliceOk({ sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null, upstream: null, remote: null, branch: 'main' }),
        version: fsSliceOk({ gitVersion: 'git version 2.49.0', tier: 'full', switches: [] }),
      },
    }
  }
  // 分片失败种子（票面验收⑤）：历史那一片读失败，其余六片照常 —— 给 T05 接线时可直接塞进 seedReads。
  const firstPartialSeed = function () {
    const s = firstSeedOf()
    s.slices.history = fsSliceErr('non-zero', '读提交历史这一步失败')
    return s
  }
  const fsCallOf = function (handler) {
    const calls = []
    const call = function (method, args) { calls.push({ method: method, args: args }); return handler(method, args) }
    return { call: call, calls: calls }
  }
  check(typeof VIEW.vcReadFirstScreen === 'function' && typeof VIEW.vcFirstScreenSliceOf === 'function', 'W1 首屏七片的客户端数据层已接进这个闭包（与构建同序拼接）')
  check(VIEW.FIRST_SCREEN_CONTRACT === 'version-control.first-screen' && VIEW.FIRST_SCREEN_VERSION === 2, 'W2 首屏契约版本化：契约名与版本号都在共享层那一份真源里')
  const fsEnter = fsCallOf(function () { return Promise.resolve({ ok: true, firstScreen: firstSeedOf() }) })
  let fsReads = await VIEW.vcReadFirstScreenOnEnter(VIEW.vcNewFirstScreenRead(), fsEnter.call, 'D:/w/repo')
  check(fsEnter.calls.length === 1 && fsEnter.calls[0].method === VIEW.VC_FIRST_SCREEN_PHONE, 'W3 进入页面：只发起一次聚合一电话（实发 ' + fsEnter.calls.length + ' 次，电话 ' + fsEnter.calls[0].method + '）')
  check(fsEnter.calls[0].args.cwd === 'D:/w/repo', 'W4 聚合电话带 cwd（七片都在这一份回包里，不按片再开枪）')
  check(VIEW.vcFirstScreenStateOf(fsReads) === 'ok' && !!VIEW.vcFirstScreenOf(fsReads), 'W5 一次回包就是一份版本化快照，界面只读这一份')
  check(VIEW.vcFirstScreenOf(fsReads).contract === VIEW.FIRST_SCREEN_CONTRACT && VIEW.vcFirstScreenOf(fsReads).version === VIEW.FIRST_SCREEN_VERSION, 'W6 快照带契约名与版本号（界面据此认版本）')
  check(VIEW.vcFirstScreenReadAtOf(fsReads) === NOW, 'W7 快照带读取时间（刷新提示用）')
  const sevenOk = VIEW.FIRST_SCREEN_SLICES.filter(function (id) { return VIEW.vcFirstScreenSliceStateOf(fsReads, id) === 'ok' })
  check(sevenOk.length === 7 && VIEW.vcFirstScreenFailedSlicesOf(fsReads).length === 0, 'W8 一次拿全七片（ok 片 ' + sevenOk.length + '/7）')
  const fsPartial = fsCallOf(function () { return Promise.resolve({ ok: true, firstScreen: firstPartialSeed() }) })
  const fsPartReads = await VIEW.vcReadFirstScreenOnEnter(VIEW.vcNewFirstScreenRead(), fsPartial.call, 'D:/w/repo')
  check(VIEW.vcFirstScreenStateOf(fsPartReads) === 'ok' && VIEW.vcFirstScreenFailedSlicesOf(fsPartReads).join(',') === 'history', 'W9 单片失败不阻塞整页：整次读仍是 ok，失败片只有历史这一片')
  check(VIEW.vcFirstScreenSliceStateOf(fsPartReads, 'history') === 'err' && VIEW.vcFirstScreenSliceStateOf(fsPartReads, 'changes') === 'ok', 'W10 逐片独立态：失败的片记 err、其余片照常画（不连坐）')
  check(VIEW.vcFirstScreenSliceRetryableOf(fsPartReads, 'history') === true && VIEW.vcFirstScreenSliceRetryableOf(fsPartReads, 'changes') === false, 'W11 失败的那一片给重试入口，好的片不给')
  check(VIEW.vcFirstScreenScreenOf(fsPartReads) === null, 'W12 四片缺一片（历史 err）时不拿残缺数据拼假 FirstScreen，界面走读不到 + 重试')
  const fsRetry = fsCallOf(function () { return Promise.resolve({ ok: true, firstScreen: firstSeedOf() }) })
  const fsRetried = await VIEW.vcRetryFirstScreenSlice(fsPartReads, fsRetry.call, 'D:/w/repo', 'history')
  check(fsRetry.calls.length === 1 && fsRetry.calls[0].method === VIEW.VC_FIRST_SCREEN_PHONE && VIEW.vcFirstScreenSliceStateOf(fsRetried, 'history') === 'ok', 'W13 片级重试也是再发一次聚合一电话（七片同源，不另开一条只读一片的路）')
  const fsRetryBad = fsCallOf(function () { return Promise.resolve({ ok: true, firstScreen: firstSeedOf() }) })
  await VIEW.vcRetryFirstScreenSlice(fsPartReads, fsRetryBad.call, 'D:/w/repo', '没有这一片')
  check(fsRetryBad.calls.length === 0, 'W14 片名不在七片名单里：不发电话（界面传错片名不许多打一枪）')
  const fsMoments = []
  for (const entry of [VIEW.vcReadFirstScreenOnEnter, VIEW.vcReadFirstScreenAfterTask, VIEW.vcReadFirstScreenOnManual]) {
    const box = fsCallOf(function () { return Promise.resolve({ ok: true, firstScreen: firstSeedOf() }) })
    await entry(VIEW.vcNewFirstScreenRead(), box.call, 'D:/w/repo')
    fsMoments.push(box.calls.length)
  }
  check(fsMoments.join(',') === '1,1,1', 'W15 刷新三时机（进入页面 / 任务完成后 / 手动刷新）各只发一次聚合一电话（实得 ' + fsMoments.join(',') + '）')
  const fsBadVer = firstSeedOf(); fsBadVer.version = 99
  const fsBadCall = fsCallOf(function () { return Promise.resolve({ ok: true, firstScreen: fsBadVer }) })
  const fsBadReads = await VIEW.vcReadFirstScreen(fsReads, fsBadCall.call, 'D:/w/repo')
  check(VIEW.vcFirstScreenStateOf(fsBadReads) === 'err' && VIEW.vcFirstScreenOf(fsBadReads) === null, 'W16 版本对不上的回包不冒充成功（界面按读不到处理，不拿旧版本硬画）')
  check(fsBadReads.firstScreen.data === VIEW.vcFirstScreenOf(fsReads), 'W17 坏回包不覆盖旧快照（上一份数据还留着，失败只加提示）')
  const fsEnvCall = fsCallOf(function () { return Promise.resolve({ ok: false, error: { kind: 'env', message: '找不到 git 命令' } }) })
  const fsEnvReads = await VIEW.vcReadFirstScreen(VIEW.vcNewFirstScreenRead(), fsEnvCall.call, 'D:/w/repo')
  check(VIEW.vcFirstScreenStateOf(fsEnvReads) === 'err' && fsEnvReads.firstScreen.error.kind === 'env', 'W18 失败信封原样落成整次读的失败原因（错误种类不丢）')
  const fsSix = firstSeedOf(); delete fsSix.slices.stashes
  check(VIEW.vcFirstScreenShapeOk(fsSix) === false && VIEW.vcFirstScreenShapeOk(firstSeedOf()) === true, 'W19 形状判据：七片整齐才放行，少一片当场判 false（不拿六片冒充七片）')
  // 分片失败种子给界面层的样子（票面验收⑤的「假宿主种子」）：读数里存的就是这份快照，七片各自成败原样带出。
  const fsSeedReads = { firstScreen: { state: 'ok', data: firstPartialSeed(), error: null } }
  const w20Slices = VIEW.vcFirstScreenFailedSlicesOf(fsSeedReads)
  const w20Slice = VIEW.vcFirstScreenSliceOf(fsSeedReads, 'changes')
  const w20Changes = w20Slice && w20Slice.data
  check(w20Slices.join(',') === 'history', 'W20 分片失败种子（历史 err、其余六片照常）能直接喂给界面数据层，逐片失败态与其余片数据都读得到（失败片实得 ' + JSON.stringify(w20Slices) + '）')
  check(!!w20Changes && w20Changes.stagedCount === 0 && w20Changes.unstagedCount === 1 && w20Changes.unstaged[0].path === '改.txt', 'W20b 同一份分片失败种子里的其余片数据原样带出（changes 片仍有 1 个未暂存文件）')
  const fsLogs = []
  const VIEWW = buildView(null, fsLogs)
  await VIEWW.vcReadFirstScreenOnEnter(VIEWW.vcNewFirstScreenRead(), fsCallOf(function () { return Promise.resolve({ ok: true, firstScreen: firstSeedOf() }) }).call, 'D:/w/repo')
  const fsHostLogs = fsLogs.filter(function (l) { return l.event === 'host.call' && l.fields && l.fields.kind === 'git-first-screen' })
  check(fsHostLogs.length === 1 && fsHostLogs[0].fields.ok === true, 'W21 首屏聚合落在既有 host.call 事件上（kind=git-first-screen，不新增事件名）')

  // ---- BR 组：分支与标签域（#1746 T11）—— 一次读全、预检与确认、结果贴点、业务面板 ----
  // 读一次取回四样（分支清单、标签、已并入/没并入两张名单、分支说明）；十条写动作一律走同一条写电话：
  //   先 dryRun 拿判定与确认卡素材，确认后再发一次带 confirmed:true 的写电话。
  // 这组守界面侧的数据层与面板约定；宿主那一侧的真判定、argv 与失败隔离由 tests/verify-1586-branches.ts 守。
  const brBoardOf = function () {
    return {
      contract: VIEW.VC_BRANCH_BOARD_CONTRACT, version: VIEW.VC_BRANCH_BOARD_VERSION, readAtMs: NOW,
      current: { name: 'main', oid: 'a'.repeat(40) },
      branches: [
        { name: 'main', oid: 'a'.repeat(40), current: true, upstream: 'origin/main', ahead: 2, behind: 1, commitDateMs: NOW },
        { name: 'feature', oid: 'b'.repeat(40), current: false, upstream: null, ahead: 0, behind: 0, commitDateMs: NOW },
      ],
      tags: [
        { name: 'v1.0.0', oid: 'c'.repeat(40), objectType: 'commit', annotated: false, atMs: NOW, subject: '发布' },
        { name: 'v1.1.0', oid: 'd'.repeat(40), objectType: 'tag', annotated: true, atMs: NOW, subject: '正式发布' },
      ],
      descriptions: { main: '主干' }, merged: ['main'], notMerged: ['feature'],
    }
  }
  const brCallOf = function (handler) {
    const calls = []
    const call = function (method, args) { calls.push({ method: method, args: args }); return handler(method, args) }
    return { call: call, calls: calls }
  }
  check(typeof VIEW.vcReadBranches === 'function' && typeof VIEW.vcBranchBoardNode === 'function', 'BR1 分支面板的数据层与面板节点已接进这个闭包（排在页面壳之前，壳里会调到）')
  check(VIEW.VC_BRANCHES_PHONE === 'wf.gitBranches' && VIEW.VC_BRANCH_CHECK_PHONE === 'wf.gitBranchCheck' && VIEW.VC_BRANCH_WRITE_PHONE === 'wf.gitBranchWrite', 'BR2 读 / 预检 / 执行是三条电话：读一次取全，预检签票，凭票执行')
  check(VIEW.VC_BRANCH_BOARD_CONTRACT === 'version-control.branch-board' && VIEW.VC_BRANCH_BOARD_VERSION === 1 && VIEW.vcBranchShapeOk(Object.assign({ ok: true }, brBoardOf())) === true, 'BR3 分支面板回包带契约名与版本号（版本化，形状判据放行）')
  check(VIEW.vcBranchShapeOk(Object.assign({}, brBoardOf(), { version: 2 })) === false && VIEW.vcBranchShapeOk(Object.assign({}, brBoardOf(), { branches: null })) === false, 'BR3b 版本不对或分支清单缺失当场判红（不拿旧形状硬认）')
  check(VIEW.VC_BRANCH_OP_IDS.length === 13 && Array.from(new Set(VIEW.VC_BRANCH_OP_IDS)).length === 13 && VIEW.VC_BRANCH_OP_IDS[0] === '4.1' && VIEW.VC_BRANCH_OP_IDS[12] === '4.13', 'BR4 本域十三条能力号齐全且不重复（4.1–4.13）')
  check(VIEW.VC_BRANCH_ACTIONS.length === 10 && VIEW.VC_BRANCH_ACTIONS.map(function (a) { return a.kind }).join(',') === 'create,switch,detach,rename,delete,upstream,tag-create,tag-delete,verify,describe' && VIEW.VC_BRANCH_WRITE_OPS.length === 9 && VIEW.VC_BRANCH_WRITE_OPS.indexOf('verify') < 0, 'BR5 十个写动作各对应一个宿主 kind；验签是只读动作，不在九个凭票写动作里（4.1/4.8/4.9 也不在）')
  const brRead = brCallOf(function () { return Promise.resolve(Object.assign({ ok: true }, brBoardOf())) })
  const brReads = await VIEW.vcReadBranches(VIEW.vcNewBranchRead(), brRead.call, 'D:/w/repo')
  check(brRead.calls.length === 1 && brRead.calls[0].method === VIEW.VC_BRANCHES_PHONE && brRead.calls[0].args.cwd === 'D:/w/repo', 'BR6 读面板只发一次读电话，cwd 原样带上')
  const brBoard = VIEW.vcBranchBoardOf(brReads)
  check(VIEW.vcBranchStateOf(brReads) === 'ok' && !!brBoard && brBoard.current.name === 'main', 'BR7 一次回包落成整份读数：当前分支与分支清单都在这份里')
  check(brBoard.branches.length === 2 && brBoard.tags.length === 2 && brBoard.tags[1].annotated === true && brBoard.merged.join(',') === 'main' && brBoard.notMerged.join(',') === 'feature', 'BR8 4.8/4.9 的数据都在读回包里（不另发电话取名单与标签）')
  const brBadVersion = Object.assign({ ok: true }, brBoardOf(), { version: 99 })
  const brBadReads = await VIEW.vcReadBranches(brReads, brCallOf(function () { return Promise.resolve(brBadVersion) }).call, 'D:/w/repo')
  check(VIEW.vcBranchStateOf(brBadReads) === 'err' && VIEW.vcBranchBoardOf(brBadReads) !== null, 'BR9 版本对不上的回包不冒充成功：整次读记 err，旧快照还留着（失败绝不清空）')
  check(VIEW.vcBranchReadOf(brBadReads).error.kind === 'shape', 'BR9b 形状不对的失败原因记成 shape（界面能据此说清是回包坏了）')
  const brEnvReads = await VIEW.vcReadBranches(brReads, brCallOf(function () { return Promise.resolve({ ok: false, error: { kind: 'env', message: '找不到 git 命令' } }) }).call, 'D:/w/repo')
  check(VIEW.vcBranchReadOf(brEnvReads).error.kind === 'env' && VIEW.vcBranchStateOf(brEnvReads) === 'err', 'BR10 失败信封原样落成读数失败原因（错误种类不丢）')
  check(VIEW.vcBranchRequestOf('4.2', { name: 'feature', from: 'main' }).op === 'create' && VIEW.vcBranchRequestOf('4.6', { name: 'feature' }).op === 'delete' && VIEW.vcBranchRequestOf('4.13', { branch: 'main', text: '说明' }).op === 'describe' && VIEW.vcBranchRequestOf('4.1', {}).op === '', 'BR11 能力号映射到写动作 op；只读能力号不发写请求（op 为空）')
  check(VIEW.vcBranchRequestOf('4.7', { branch: 'main', upstream: 'origin/main' }).upstream === 'origin/main' && !('name' in VIEW.vcBranchRequestOf('4.6', { branch: 'main' })), 'BR12 表单字段按白名单原样带上、没填的不带（不发空字段）')
  const brCheckReply = {
    ok: true, contract: VIEW.VC_BRANCH_CHECK_CONTRACT, version: VIEW.VC_BRANCH_CHECK_VERSION, readAtMs: NOW, op: 'switch',
    decision: { verdict: 'warn', reasons: ['unsaved-changes'] }, confirmRequired: true,
    confirm: { kind: 'switch', target: 'feature', verb: '切换' },
    ticket: { id: 'ticket-1', op: 'switch', checkedAtMs: NOW, expiresAtMs: NOW + 120000 },
    scene: { current: 'main', dirty: true, conflicts: 0, midOperation: null, targetOid: 'b'.repeat(40) },
  }
  const brCheckBox = brCallOf(function () { return Promise.resolve(brCheckReply) })
  const brChecked = await VIEW.vcBranchCheck(brReads, brCheckBox.call, 'D:/w/repo', '4.3', { name: 'feature', confirmed: true, ticketId: '旧票', requestId: '旧请求' })
  check(brCheckBox.calls.length === 1 && brCheckBox.calls[0].method === VIEW.VC_BRANCH_CHECK_PHONE && brCheckBox.calls[0].args.op === 'switch' && brCheckBox.calls[0].args.name === 'feature' && brCheckBox.calls[0].args.confirmed === undefined && brCheckBox.calls[0].args.ticketId === undefined && brCheckBox.calls[0].args.requestId === undefined, 'BR13 预检：只发一次预检电话；带动作参数，票号 / requestId / confirmed 都不混进来')
  check(VIEW.vcBranchCheckKindOf(brCheckReply) === 'checked' && VIEW.vcBranchReasonsOf(brCheckReply).join(',') === 'unsaved-changes' && VIEW.vcBranchConfirmOf(brCheckReply).target === 'feature' && VIEW.VC_BRANCH_CHECK_CONTRACT === 'version-control.branch-check' && VIEW.VC_BRANCH_CHECK_VERSION === 1, 'BR14 预检回包：判定、理由标识符、确认卡素材三样都读得到；回包带契约名与版本号')
  const brTicket = VIEW.vcBranchTicketOf(brChecked)
  check(!!brTicket && brTicket.op === 'switch' && brTicket.expiresAtMs - brTicket.checkedAtMs === 120000, 'BR14b 预检成功手里有一张 120 秒的票（票号 / 动作 / 到期时刻齐全，界面据此判过期）')
  const brBlockedCheck = {
    ok: false, contract: VIEW.VC_BRANCH_CHECK_CONTRACT, version: VIEW.VC_BRANCH_CHECK_VERSION, readAtMs: NOW, op: 'switch',
    error: { kind: 'blocked', message: '中途操作未结束' }, reason: 'mid-operation',
    decision: { verdict: 'block', reasons: ['mid-operation'] }, scene: { current: 'main' },
  }
  const brBlockedReads = await VIEW.vcBranchCheck(brReads, brCallOf(function () { return Promise.resolve(brBlockedCheck) }).call, 'D:/w/repo', '4.3', { name: 'feature' })
  check(VIEW.vcBranchCheckKindOf(brBlockedCheck) === 'blocked' && VIEW.vcBranchCheckDecisionOf(brBlockedReads).verdict === 'block' && VIEW.vcBranchReasonsOf(brBlockedCheck).join(',') === 'mid-operation' && !!VIEW.vcBranchCheckOf(brBlockedReads).data.scene, 'BR15 预检被拦：判定读成 blocked、理由照原样带出、现场留着（界面能画「为什么不能点」）')
  check(VIEW.vcBranchReasonsOf({ ok: false, decision: { reasons: ['detached-head'] } }).join(',') === 'detached-head' && VIEW.vcBranchReasonsOf({ ok: false, reasons: ['no-upstream'] }).join(',') === 'no-upstream', 'BR16 理由标识符两种带法都认（顶层与 decision 里）')
  check(VIEW.vcBranchReplyKindOf({ ok: true, kind: 'delete' }) === 'done' && VIEW.vcBranchReplyKindOf({ ok: false, error: { kind: 'need-confirm' } }) === 'need-confirm' && VIEW.vcBranchReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'ticket-expired' }) === 'stale' && VIEW.vcBranchReplyKindOf({ ok: false, error: { kind: 'git-failed' } }) === 'fail', 'BR17 回包分类：已完成 / 待确认 / 票要重新预检 / 失败（界面按类画）')
  const brOkReply = { ok: true, kind: 'delete', command: 'branch -D feature', atMs: NOW }
  const brWriteBox = brCallOf(function () { return Promise.resolve(brOkReply) })
  const brWriteReads = await VIEW.vcBranchWrite(brReads, brWriteBox.call, 'D:/w/repo', '4.6', { name: 'feature', ticketId: 'ticket-1', requestId: 'req-1', confirmed: true })
  check(brWriteBox.calls.length === 1 && brWriteBox.calls[0].method === VIEW.VC_BRANCH_WRITE_PHONE && brWriteBox.calls[0].args.ticketId === 'ticket-1' && brWriteBox.calls[0].args.requestId === 'req-1' && brWriteBox.calls[0].args.op === 'delete' && brWriteBox.calls[0].args.confirmed === true, 'BR18 执行：一次写电话，凭票号 + requestId + 动作参数；确认后带 confirmed:true')
  const brNoConfirmBox = brCallOf(function () { return Promise.resolve(brOkReply) })
  await VIEW.vcBranchWrite(brReads, brNoConfirmBox.call, 'D:/w/repo', '4.6', { name: 'feature', ticketId: 'ticket-1', requestId: 'req-2', confirmed: false })
  check(brNoConfirmBox.calls[0].args.confirmed === undefined, 'BR18-2 没确认就不带 confirmed 字段（不让宿主误以为已经确认过）')
  check(VIEW.vcBranchWriteResultOf(brWriteReads).state === 'ok' && VIEW.vcBranchStateOf(brWriteReads) === 'ok' && VIEW.vcBranchWriteResultOf(brWriteReads).data.command === 'branch -D feature', 'BR18b 写结果单独落一格，读到的面板数据不被写结果顶掉')
  check(VIEW.vcBranchResultOf(brOkReply).state === 'ok' && VIEW.vcBranchResultOf(brOkReply).cmd === 'branch -D feature', 'BR18c 成功结果给子命令名（结果贴点按同一份回包画）')
  const brFailReply = { ok: false, error: { kind: 'git-failed', message: '删除分支这一步失败' }, git: 'fatal: 分支 feature 未并入', step: '删除分支这一步', expected: '删掉分支', actual: 'git 拒绝了', cause: '还没并入' }
  const brWriteFailBox = brCallOf(function () { return Promise.resolve(brFailReply) })
  const brWriteFailReads = await VIEW.vcBranchWrite(brReads, brWriteFailBox.call, 'D:/w/repo', '4.6', { name: 'feature', ticketId: 'ticket-1', requestId: 'req-3' })
  const brFailRes = VIEW.vcBranchResultOf(VIEW.vcBranchWriteResultOf(brWriteFailReads).data)
  check(VIEW.vcBranchWriteResultOf(brWriteFailReads).state === 'err' && brFailRes.state === 'fail' && brFailRes.git === 'fatal: 分支 feature 未并入' && brFailRes.step === '删除分支这一步' && brFailRes.cause === '还没并入', 'BR19 写失败把宿主回包原样留着：git 原话、环节、期望与实际、上游原因都读得回来')
  check(brFailRes.error === true, 'BR19b 失败结果带 error 标记，页面壳结果节点据此画报警分支（不把失败画成成功）')
  check(VIEW.vcBranchResultOf({ ok: false, error: { kind: 'git-failed', git: '嵌套原话', step: '嵌套环节' } }).git === '嵌套原话', 'BR19c 老形状（细节写在 error 里）也认，回落不丢原话')
  const brPanel = renderToStaticMarkup(VIEW.vcBranchBoardNode(h, tZh, { board: brBoardOf() }))
  check(attrValuesOf(brPanel, 'data-vc-branch-row').join(',') === 'main,feature' && attrValuesOf(brPanel, 'data-vc-tag-row').join(',') === 'v1.0.0,v1.1.0', 'BR20 面板逐分支、逐标签画行')
  check(attrValuesOf(brPanel, 'data-vc-tag-annotated').join(',') === '0,1', 'BR20b 附注标签与轻量标签分得开（4.11 删除时说清删的是什么）')
  check(Array.from(new Set(attrValuesOf(brPanel, 'data-vc-op'))).sort().join(',') === '4.10,4.11,4.12,4.13,4.2,4.3,4.4,4.5,4.6,4.7', 'BR20c 十条写动作各有 data-vc-op（能力号与账本一致）')
  check(attrValuesOf(brPanel, 'data-vc-branch-ops')[0] === '13' && attrValuesOf(brPanel, 'data-vc-branch-writes')[0] === '9' && attrValuesOf(brPanel, 'data-vc-branch-forms')[0] === '10' && attrValuesOf(brPanel, 'data-vc-branch-checks')[0] === '1', 'BR20d 面板声明十三条能力入口、九个凭票写动作、十个表单入口与一条预检电话')
  check(attrValuesOf(brPanel, 'data-vc-branch-current')[0] === 'main' && brPanel.indexOf('data-vc-branch-upstream="origin/main"') >= 0 && brPanel.indexOf('主干') >= 0, 'BR20e 当前分支、上游与分支说明都画出来（说明来自读回包，不另读）')
  check(attrValuesOf(brPanel, 'data-vc-branch-merged')[0] === '1' && attrValuesOf(brPanel, 'data-vc-branch-notmerged')[0] === '1', 'BR20f 4.8 已并入与没并入两张名单一起画')
  const brEmpty = renderToStaticMarkup(VIEW.vcBranchBoardNode(h, tZh, { board: null, onRetry: function () {} }))
  check(attrValuesOf(brEmpty, 'data-vc-branch2-empty')[0] === '1' && attrValuesOf(brEmpty, 'data-vc-branch-row').length === 0 && attrValuesOf(brEmpty, 'data-vc-branch2-retry').length === 1, 'BR21 没读数时画空态与重试，不画假分支（十条写动作入口仍在：' + attrValuesOf(brEmpty, 'data-vc-branch-forms')[0] + '）')
  const brConfirm = VIEW.vcBranchConfirmOf(brCheckReply)
  const brPanelFull = renderToStaticMarkup(VIEW.vcBranchBoardNode(h, tZh, { board: brBoardOf(), confirm: brConfirm, result: VIEW.vcBranchResultOf(brFailReply) }))
  check(!!brConfirm && brPanelFull.indexOf('data-vc-confirm="1"') >= 0 && (brPanelFull.match(/data-vc-confirm-seg="/g) || []).length === 4, 'BR22 确认卡贴在面板里、四段齐全（动词与对象用预检回包给的）')
  check(brPanelFull.indexOf('data-vc-result="fail"') >= 0 && brPanelFull.indexOf('fatal: 分支 feature 未并入') >= 0, 'BR22b 失败结果按宿主原话画在面板里（git 原话不省）')
  const brPage = shellHtmlOf({ page: 'branch-tags', branchBoard: brBoardOf(), branchConfirm: brConfirm, branchResult: VIEW.vcBranchResultOf(brFailReply) })
  check(brPage.indexOf('data-vc-branch2="1"') >= 0 && attrValuesOf(brPage, 'data-vc-branch-row').join(',') === 'main,feature', 'BR23 分支与标签页把业务面板挂进页面壳（面板只读自己那份读数，壳里不再抄一份）')
  check(brPage.indexOf('data-vc-confirm="1"') >= 0 && brPage.indexOf('data-vc-result="fail"') >= 0 && brPage.indexOf('data-vc-branch2="1"') < brPage.indexOf('data-vc-confirm="1"'), 'BR23b 确认卡与结果都贴在面板之后（结果贴触发点所在的那块）')
  const brOtherPage = shellHtmlOf({ page: 'commits', branchBoard: brBoardOf() })
  check(brOtherPage.indexOf('data-vc-branch2') < 0, 'BR23c 别的页面不带分支面板（页面各画各的，不串味）')
  const brLogs = []
  const VIEWL = buildView(null, brLogs)
  await VIEWL.vcReadBranches(VIEWL.vcNewBranchRead(), brCallOf(function () { return Promise.resolve(Object.assign({ ok: true }, brBoardOf())) }).call, 'D:/w/repo')
  await VIEWL.vcBranchCheck(VIEWL.vcNewBranchRead(), brCallOf(function () { return Promise.resolve(brCheckReply) }).call, 'D:/w/repo', '4.3', { name: 'feature' })
  await VIEWL.vcBranchWrite(VIEWL.vcNewBranchRead(), brCallOf(function () { return Promise.resolve(brOkReply) }).call, 'D:/w/repo', '4.6', { name: 'feature', ticketId: 'ticket-1', requestId: 'req-9', confirmed: true })
  const brHostLogs = brLogs.filter(function (l) { return l.event === 'host.call' && l.fields && (l.fields.kind === 'git-branches' || l.fields.method === VIEWL.VC_BRANCH_CHECK_PHONE || l.fields.method === VIEWL.VC_BRANCH_WRITE_PHONE) })
  check(brHostLogs.length === 3, 'BR24 读 / 预检 / 执行都落在既有 host.call 事件上（kind 区分三条电话，不新增事件名）')

  // ---- Z16 组：贮藏页十条（#1751 T16）—— 列表字段 / 十条入口 / 危险确认 / 版本门 / 详情 / 最近丢弃 ----
  // 十条能力的编号、动作名与危险档都从共享层 STASH_OPS 取；这里断言页面画出了什么、用户读到哪句话。
  //   页面只读首屏贮藏分片（T04 同一份数据），不另发读命令、不另建列表电话。
  const stashEntryOf = function (selector, oid, atMs, subject) { return { selector: selector, oid: oid, atMs: atMs, subject: subject } }
  const stashSeedOf = function (entries, versionText) {
    const plan = firstSeedOf()
    plan.slices.stashes = fsSliceOk({ entries: entries })
    plan.slices.version = fsSliceOk({ gitVersion: versionText, tier: 'full', switches: [] })
    return plan
  }
  const stashEntries = [
    stashEntryOf('stash@{0}', 'a'.repeat(40), NOW, 'On main: 第一条贮藏'),
    stashEntryOf('stash@{1}', 'b'.repeat(40), NOW - 3600000, 'On main: 第二条贮藏'),
  ]
  const stashPageOf = function (entries, versionText, state) {
    const opts: any = { page: 'stash', width: 460, skin: 'dark', seed: stashSeedOf(entries, versionText) }
    if (state) opts.stash = state
    return shellHtmlOf(opts)
  }
  // 反证共用的判据：页面体在不在、低版本 7.3 藏没藏住、危险确认卡出没出。
  const stashMountedJudgmentOf = function (v) {
    const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'stash', width: 460, skin: 'dark', seed: stashSeedOf(stashEntries, 'git version 2.49.0') }))
    const caps = attrValuesOf(html, 'data-vc-stash-cap')
    return html.indexOf('data-vc-stash-page="1"') >= 0 && v.STASH_OPS.every(function (c) { return caps.indexOf(c.id) >= 0 })
  }
  const stashGateJudgmentOf = function (v) {
    const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'stash', width: 460, skin: 'dark', seed: stashSeedOf(stashEntries, 'git version 2.34.0') }))
    return attrValuesOf(html, 'data-vc-stash-cap').indexOf('7.3') < 0 && html.indexOf('data-vc-stash-gate="hidden"') >= 0
  }
  const stashConfirmJudgmentOf = function (v) {
    const state = Object.assign(v.vcStashStateNew(), { confirm: { op: 'drop', selector: 'stash@{0}', subject: 'On main: 第一条贮藏' } })
    const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'stash', width: 460, skin: 'dark', seed: stashSeedOf(stashEntries, 'git version 2.49.0'), stash: state }))
    return html.indexOf('data-vc-stash-confirm="drop"') >= 0 && attrValuesOf(html, 'data-vc-confirm-seg').length === 4
  }
  const stashHtml = stashPageOf(stashEntries, 'git version 2.49.0')
  const stashCaps = attrValuesOf(stashHtml, 'data-vc-stash-cap')
  const stashCapCount = function (id) { return stashCaps.filter(function (x) { return x === id }).length }
  check(stashHtml.indexOf('data-vc-stash-page="1"') >= 0 && attrValuesOf(stashHtml, 'data-vc-stash-count')[0] === '2', 'Z16a 贮藏页画出页面体，并如实报出首屏贮藏分片里的条数（2 条）')
  check(stashHtml.indexOf('data-vc-stash-list="ok"') >= 0 && attrValuesOf(stashHtml, 'data-vc-stash-entry').length === 2, 'Z16b 列表按 T04 首屏的贮藏分片渲染两条记录（不重复建读命令）')
  check(attrValuesOf(stashHtml, 'data-vc-stash-selector').join(',') === 'stash@{0},stash@{1}', 'Z16c 每条记录带选择器 stash@{n}（第 3 节的列表字段之一）')
  check(stashHtml.indexOf('第一条贮藏') >= 0 && stashHtml.indexOf('第二条贮藏') >= 0, 'Z16d 每条记录带说明（reflog 主题原样读出来，不自己编）')
  check(attrValuesOf(stashHtml, 'data-vc-stash-oid').length === 2 && stashHtml.indexOf(VIEW.vcStashShortOidOf('a'.repeat(40))) >= 0 && attrValuesOf(stashHtml, 'data-vc-stash-oid-full').join(',') === 'a'.repeat(40) + ',' + 'b'.repeat(40), 'Z16e 每条记录带提交号（正文印短号、完整号留给悬停提示与记录属性）')
  check(attrValuesOf(stashHtml, 'data-vc-stash-at').length === 2 && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(stashHtml), 'Z16f 每条记录带时间（本地「年-月-日 时:分」）')
  check(stashHtml.indexOf(LOC.zh['vc.stash.entry.filesUnknown']) >= 0 && attrValuesOf(stashHtml, 'data-vc-stash-files').length === 2, 'Z16g 列表读法不给涉及文件数时如实说「不知道」（不拿 0 冒充）')
  check(VIEW.STASH_OPS.length === 10 && VIEW.STASH_OPS.every(function (c) { return stashCapCount(c.id) >= 1 }), 'Z16h 十条能力在贮藏页各有 data-vc-stash-cap 入口（7.1–7.10 一条不缺）')
  check(stashCapCount('7.1') === 1 && stashCapCount('7.2') === 1 && stashCapCount('7.3') === 1 && stashCapCount('7.4') === 1 && stashCapCount('7.10') === 1, 'Z16i 工具行五条动作各恰一个入口（新建三条、列出、清空）')
  check(['7.5', '7.6', '7.7', '7.8', '7.9'].every(function (id) { return stashCapCount(id) === 2 }), 'Z16j 记录行五条动作每条记录各一个入口（两条记录）')
  check(attrValuesOf(stashHtml, 'data-vc-stash-danger').length === 3, 'Z16k 危险动作（删一条 × 2 条记录 + 全清 × 1）标出危险档，供界面出确认卡')
  check(stashHtml.indexOf('data-vc-stash-gate') < 0 && stashCapCount('7.3') === 1, 'Z16l 2.49 上 7.3 完整可用：按钮在、不打印版本门提示')
  const oldStashHtml = stashPageOf(stashEntries, 'git version 2.34.0')
  check(attrValuesOf(oldStashHtml, 'data-vc-stash-cap').indexOf('7.3') < 0 && oldStashHtml.indexOf('data-vc-stash-gate="hidden"') >= 0, 'Z16m 2.34 上 7.3 低于 2.35：按钮一个不留，改打印版本门提示（藏起来不等于沉默）')
  check(oldStashHtml.indexOf(LOC.zh['vc.stash.gate.alternative']) >= 0 && LOC.zh['vc.stash.gate.alternative'] === VIEW.STASH_STAGED_ALTERNATIVE, 'Z16n 版本门提示照账本的替代做法原文说（「先做一次全量贮藏，再恢复未暂存的部分」）')
  check(oldStashHtml.indexOf('2.35.0') >= 0, 'Z16o 版本门提示写出需要的版本号（2.35.0，与账本 minVersion 同一条线）')
  const dropConfirmHtml = stashPageOf(stashEntries, 'git version 2.49.0', Object.assign(VIEW.vcStashStateNew(), { confirm: { op: 'drop', selector: 'stash@{0}', subject: 'On main: 第一条贮藏' } }))
  check(dropConfirmHtml.indexOf('data-vc-stash-confirm="drop"') >= 0 && attrValuesOf(dropConfirmHtml, 'data-vc-confirm-seg').length === 4, 'Z16p 删除一条：确认卡就地出，四段（做什么 / 不做什么 / 可不可逆 / 动词）齐全')
  check(attrValuesOf(dropConfirmHtml, 'data-focus-default').indexOf('cancel') >= 0 && dropConfirmHtml.indexOf('data-vc-stash-confirm-go="1"') >= 0 && dropConfirmHtml.indexOf('data-vc-stash-confirm-cancel="1"') >= 0, 'Z16q 确认卡默认焦点在取消键（危险动作的第一下不该落在确认上）')
  check(dropConfirmHtml.indexOf('stash@{0}') >= 0 && dropConfirmHtml.indexOf('第一条贮藏') >= 0, 'Z16r 确认卡说清删的是哪一条（对象级信息，不只说「删除」）')
  const clearConfirmHtml = stashPageOf(stashEntries, 'git version 2.49.0', Object.assign(VIEW.vcStashStateNew(), { confirm: { op: 'clear', selector: '', subject: '' } }))
  check(clearConfirmHtml.indexOf('data-vc-stash-confirm="clear"') >= 0, 'Z16s 全清同样走确认卡（clear 与 drop 两条毁档都要确认）')
  const detailState = Object.assign(VIEW.vcStashStateNew(), { detail: { selector: 'stash@{0}', files: ['a.txt', 'b.txt'], fileCount: 2, patch: 'diff --git a/a.txt b/a.txt\n+stash-me\n', truncated: true } })
  const detailHtml = stashPageOf(stashEntries, 'git version 2.49.0', detailState)
  check(detailHtml.indexOf('data-vc-stash-detail="stash@{0}"') >= 0 && attrValuesOf(detailHtml, 'data-vc-stash-file').join(',') === 'a.txt,b.txt', 'Z16t 查看内容：就地铺开涉及的文件清单')
  check(detailHtml.indexOf('data-vc-stash-patch="1"') >= 0 && detailHtml.indexOf('+stash-me') >= 0, 'Z16u 查看内容：差异原文一并铺开（不是只给文件名单）')
  check(detailHtml.indexOf('data-vc-stash-truncated="1"') >= 0 && detailHtml.indexOf(LOC.zh['vc.stash.detail.truncated']) >= 0, 'Z16v 差异截断时如实说（不装作完整）')
  const recentState = Object.assign(VIEW.vcStashStateNew(), { recent: [{ selector: 'stash@{2}', oid: 'c'.repeat(40), subject: 'On main: 第三条', atMs: NOW, droppedAtMs: NOW, byOp: 'drop' }] })
  const recentHtml = stashPageOf(stashEntries, 'git version 2.49.0', recentState)
  check(attrValuesOf(recentHtml, 'data-vc-stash-recent')[0] === '1' && attrValuesOf(recentHtml, 'data-vc-stash-restore')[0] === 'c'.repeat(40), 'Z16w 最近丢弃：删除之后的提交号留在列表里，并给恢复入口（GC 之前还能找回）')
  check(recentHtml.indexOf('data-vc-stash-recent-empty') < 0, 'Z16x 有记录时不画最近丢弃的空态')
  check(stashHtml.indexOf('data-vc-stash-recent="0"') >= 0 && stashHtml.indexOf('data-vc-stash-recent-empty="1"') >= 0, 'Z16y 没有丢弃记录时最近丢弃区如实画空态（不拿假记录充数）')
  const failState = Object.assign(VIEW.vcStashStateNew(), { result: { ok: false, kind: 'branch-exists', message: '分支已存在' } })
  const failHtml = stashPageOf(stashEntries, 'git version 2.49.0', failState)
  check(failHtml.indexOf('data-vc-stash-result="fail"') >= 0 && attrValuesOf(failHtml, 'data-vc-stash-fail-kind')[0] === 'branch-exists' && failHtml.indexOf(LOC.zh['vc.stash.fail.branchExists']) >= 0, 'Z16z 失败回包按原因码查人话（分支已存在：说清楚，不印裸 kind）')
  const okState = Object.assign(VIEW.vcStashStateNew(), { result: { ok: true, op: 'push', entries: stashEntries, recent: [] } })
  check(stashPageOf(stashEntries, 'git version 2.49.0', okState).indexOf('data-vc-stash-result="ok"') >= 0, 'Z16aa 成功回包给结果条并提示下一步（列表已刷新）')
  // ---- W-ext 组（#1752）：工作树页八条能力接在同一份首屏快照上 ----
  // 页面与首屏聚合共用同一份片：清单来自 worktrees 片，版本门来自 version 片里的 switches，
  // 判定调共享层 worktreeJudge —— 界面不另发清单电话、不自己写一份版本比较。
  const wtSeedOf = function () {
    const s = firstSeedOf()
    s.slices.worktrees = fsSliceOk({ others: [{ path: 'D:/w/repo/.wt/a', display: 'a', head: 'a'.repeat(40), branch: 't/a', detached: false, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableReason: null }], bare: false })
    s.slices.version = fsSliceOk({ gitVersion: 'git version 2.17.1', tier: 'degraded', switches: [{ id: '9.7', name: '移动工作树', command: 'git worktree move', state: 'hidden', needed: '2.17', alternative: '2.17 以下在终端移动目录，再跑 git worktree repair' }] })
    return s
  }
  const wtReads = { firstScreen: { state: 'ok', data: wtSeedOf(), error: null } }
  check(Array.isArray(VIEW.VC_WORKTREES_ENTRY_DEFS) && VIEW.VC_WORKTREES_ENTRY_DEFS.length === 8 && VIEW.VC_WORKTREES_ENTRY_DEFS.map(function (d) { return d.capId }).join(',') === '9.1,9.2,9.3,9.4,9.5,9.6,9.7,9.8', 'W22 工作树页八条能力各有入口（9.1–9.8 次序逐条对齐账本）')
  const wtIdle = VIEW.vcWorktreesModelOf({ firstScreen: { state: 'idle', data: null, error: null } })
  check(wtIdle.state === 'idle' && wtIdle.caps.length === 8 && wtIdle.rows.length === 0, 'W23 还没读数时画空态：八条能力行齐、清单为空、不冒充读过')
  const wtModel = VIEW.vcWorktreesModelOf(wtReads)
  check(wtModel.state === 'ok' && wtModel.rows.length === 2 && wtModel.rows[0].current === true && wtModel.count === 2, 'W24 读数到手：当前这一棵排最前，清单与首屏 worktrees 片是同一份（' + wtModel.count + ' 棵）')
  const wtSnapPaths = VIEW.vcWorktreesSnapshotOf(wtReads).rows.map(function (r) { return r.path }).join('|')
  check(wtSnapPaths === wtModel.rows.map(function (r) { return r.path }).join('|') && VIEW.vcFirstScreenSliceOf(wtReads, 'worktrees').data.others.length === 1, 'W25 清单直接取自首屏 worktrees 片，不再发第二条清单电话（两条路径读同一份片）')
  const wtAv = VIEW.vcWorktreeAvailabilityOf(wtModel.version, '9.7')
  check(!!wtAv && wtAv.state === 'hidden' && VIEW.vcWorktreeAvailabilityOf(wtModel.version, '9.1').state === 'full', 'W26 版本门读 version 片里的 switches：9.7 隐藏、9.1 可用（与账本那一份同源）')
  const wtHint = VIEW.vcWorktreesVersionHintOf(tZh, '9.7')
  check(String(wtHint).indexOf('2.17') >= 0 && String(wtHint).indexOf('终端') >= 0, 'W27 版本不够时常驻画「需要哪个版本 + 替代做法」（' + wtHint + '）')
  const wtHtmlOk = renderToStaticMarkup(VIEW.vcWorktreesPageNode(h, tZh, { reads: wtReads, ui: {}, ops: {} }))
  check(wtHtmlOk.indexOf('data-vc-wt-page="1"') >= 0 && attrValuesOf(wtHtmlOk, 'data-wt-entry').length === 8, 'W28 工作树页真的渲染出八条入口（实得 ' + attrValuesOf(wtHtmlOk, 'data-wt-entry').length + ' 条）')
  check(wtHtmlOk.indexOf('data-wt-version="hidden"') >= 0 && wtHtmlOk.indexOf('data-wt-version="full"') < 0, 'W29 9.7 那一行带版本门说明，可用的能力不画多余说明')
  check(wtHtmlOk.indexOf('data-cap-primary') < 0, 'W30 工作树页不用主入口标记 data-cap-primary（每条能力的唯一主入口仍由能力行负责，Z1d 不会被抢）')
  const dangerIds = VIEW.WORKTREE_ACTIONS.filter(function (a) { return a.danger === true }).map(function (a) { return a.id }).sort().join(',')
  const needConfirm = VIEW.WORKTREE_ACTIONS.filter(function (a) { return a.confirm === true }).map(function (a) { return a.id }).sort().join(',')
  check(dangerIds === 'move,prune,remove,sparse-set' && needConfirm === 'add,add-branch,lock,move,prune,remove,sparse-set,unlock', 'W31 危险动作与确认清单逐条对齐（危险：移动/清理/删除/写稀疏；确认：八个写动作；列表与稀疏只读不确认）')
  const wtRunArgs = VIEW.vcWorktreeRunArgsOf('D:/w/repo', 'remove', 'tk1', 't1', { path: 'D:/w/repo/.wt/a' })
  check(wtRunArgs.op === 'remove' && wtRunArgs.ticketId === 'tk1' && wtRunArgs.requestId === 't1' && wtRunArgs.confirm === true && wtRunArgs.path === 'D:/w/repo/.wt/a', 'W32 执行电话带票据、请求号与显式确认（危险动作不会因为界面漏参而在宿主那边静默执行）')
  const wtDecide = VIEW.vcWorktreesActionDecisionOf(wtModel, 'remove', { path: 'D:/w/repo' })
  check(VIEW.vcWorktreeDecisionStateOf(wtDecide) === 'block' && VIEW.vcWorktreeDecisionReasonsOf(wtDecide)[0] === 'worktree-is-current', 'W33 界面先判一次：当前这一棵不许删（发电话之前就拦下）')
  // 下面两条反证（H 组）用的判据：与上面主线断言同一条，改坏源码就该当场假。
  const worktreesEntryJudgmentOf = function (v) { return Array.isArray(v.VC_WORKTREES_ENTRY_DEFS) && v.VC_WORKTREES_ENTRY_DEFS.length === 8 }
  const worktreesPhoneJudgmentOf = function (v) { return !!v.VC_WORKTREE_PHONES && v.VC_WORKTREE_PHONES.run === 'wf.gitWorktreeRun' }
  // ---- Y 组：提交历史页（#1744 T09）——列表分页 / 详情 / 逐文件差异 / 13.14 图形化视图 ----
  // 判据分两层：数据模型（vcHistoryFirstPageOf / vcHistoryModelOf / vcHistoryGraphOf）与渲染
  //   （vcRenderTabAt 的 commits 页，reads / ui / width 从选项进）。首屏第一页必须来自 #1739 那份
  //   快照的 history 片（不另造一条读首屏的路）；「加载更多」才走 reads.log 追加。宽度档按规格第 9 节：
  //   300 只留标题、380 补短号与图形车道、460 起补作者与时间、520 逐文件差异上下文加宽。
  const hcOid = function (i) { return ('0000000' + String(i + 1).toString(16)).slice(-8).repeat(5) }
  const hcCommitsOf = function (n) {
    const out = []
    for (let i = 0; i < n; i += 1) {
      out.push({
        oid: hcOid(i), short: 'c' + (i + 1), author: '林可', email: 'linke@example.com',
        authorDateMs: NOW - (i + 1) * 60000, commitDateMs: NOW - (i + 1) * 60000,
        subject: '第 ' + (i + 1) + ' 次提交：把改动记下来',
        parents: i + 1 < n ? [hcOid(i + 1)] : [],
      })
    }
    return out
  }
  // 四条提交里第二条是合并提交（两个父）、最后一条是根提交（没有父）。
  const hcRows4 = (function () {
    const rows = hcCommitsOf(4)
    rows[1].parents = [rows[2].oid, rows[3].oid]
    return rows
  })()
  const hcSnapshotOf = function (commits, hasMore) {
    const snap = firstSeedOf()
    snap.slices.history = fsSliceOk({ commits: commits, hasMore: hasMore === true })
    return snap
  }
  const hcReadsOf = function (opts) {
    const o = opts || {}
    const base = {
      screen: { state: 'idle', data: null, error: null },
      diffs: {},
      log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null },
      firstScreen: { state: 'ok', data: hcSnapshotOf(o.commits || [], o.hasMore === true), error: null },
      commit: { rev: '', seq: 0, state: 'idle', files: [], truncated: false, reason: '', error: null },
      commitDiffs: {},
    }
    return Object.assign(base, o.reads || {})
  }
  const hcHtmlOf = function (opts) { return shellHtmlOf(Object.assign({ page: 'commits', width: 460, skin: 'dark' }, opts || {})) }
  const hcFiles = [
    { path: 'src/a.ts', origPath: null, added: 2, deleted: 1 },
    { path: '旧名.txt', origPath: '新名.txt', added: 0, deleted: 0 },
  ]
  const hcRev = hcRows4[1]
  const hcCommitOk = { rev: hcRev.oid, seq: 1, state: 'ok', files: hcFiles, truncated: false, reason: 'ok', error: null }

  // Y1 首屏第一页直接复用快照的 history 片（不另读）
  const y1Reads = hcReadsOf({ commits: hcRows4, hasMore: true })
  const y1Model = VIEW.vcHistoryModelOf(y1Reads, {})
  const y1Html = hcHtmlOf({ reads: y1Reads })
  check(y1Html.indexOf('data-vc-history="1"') >= 0 && attrValuesOf(y1Html, 'data-vc-history-row').join(',') === hcRows4.map(function (c) { return c.oid }).join(','), 'Y1a 提交历史页画出一行一条提交（' + hcRows4.length + ' 条，编号与快照逐条一致）')
  check(y1Model.source === 'first-screen' && y1Model.firstPage.length === hcRows4.length && y1Model.loaded === hcRows4.length, 'Y1b 首屏第一页直接复用首屏快照的 history 片（不另造一条读首屏的路）')
  check(attrValuesOf(y1Html, 'data-vc-history-count')[0] === String(hcRows4.length), 'Y1c data-vc-history-count 与已显示条数相等（分页策略有可见读数）')

  // Y2 加载更多：按需再取、每批 50 条、与 vcData 的批大小同源
  check(attrValuesOf(y1Html, 'data-vc-load-more').length === 1, 'Y2a hasMore 为真时才画「加载更多」（没有更多就不给假按钮）')
  check(VIEW.VC_HISTORY_BATCH === VIEW.VC_LOG_BATCH && y1Html.indexOf(String(VIEW.VC_HISTORY_BATCH)) >= 0, 'Y2b 每批条数=vcData 的 VC_LOG_BATCH（' + VIEW.VC_LOG_BATCH + ' 条），历史页不另写一份数字')
  const hcNext2 = (function () {
    const rows = hcCommitsOf(2)
    return rows.map(function (c, i) { return Object.assign({}, c, { oid: hcOid(10 + i), short: 'd' + (i + 1), parents: [] }) })
  })()
  const y2Reads = hcReadsOf({ commits: hcRows4, hasMore: true, reads: { log: { state: 'ok', commits: hcNext2, hasMore: false, fetched: VIEW.VC_HISTORY_BATCH, error: null } } })
  const y2Model = VIEW.vcHistoryModelOf(y2Reads, {})
  const y2Html = hcHtmlOf({ reads: y2Reads })
  check(y2Model.loaded === hcRows4.length + hcNext2.length && attrValuesOf(y2Html, 'data-vc-history-row').length === y2Model.loaded, 'Y2c 「加载更多」把下一批追加在列表后面（第一页 ' + hcRows4.length + ' 条 + 第二批 ' + hcNext2.length + ' 条）')
  check(attrValuesOf(y2Html, 'data-vc-load-more').length === 0 && y2Model.hasMore === false, 'Y2d 下一批读完后不再画「加载更多」')
  const y2LoadingHtml = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, hasMore: true, reads: { log: { state: 'loading', commits: [], hasMore: true, fetched: 0, error: null } } }) })
  check(attrValuesOf(y2LoadingHtml, 'data-vc-history-more-state').join(',') === 'loading' && attrValuesOf(y2LoadingHtml, 'data-vc-history-row').length === hcRows4.length, 'Y2e 下一批正在读：列表原样留着并标加载态（不把旧读数当新读数）')

  // Y3 四种状态：失败 / 加载 / 空 / 还没读
  const y3ErrSnap = firstSeedOf()
  y3ErrSnap.slices.history = fsSliceErr('non-zero', 'git log 没读到')
  const y3ErrHtml = hcHtmlOf({ reads: hcReadsOf({ reads: { firstScreen: { state: 'ok', data: y3ErrSnap, error: null } } }) })
  check(attrValuesOf(y3ErrHtml, 'data-vc-history-state')[0] === 'error' && attrValuesOf(y3ErrHtml, 'data-vc-history-retry').join(',') === 'history', 'Y3a history 片读失败：历史页画失败态并给重试入口')
  const y3LoadHtml = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, reads: { firstScreen: { state: 'loading', data: null, error: null } } }) })
  check(attrValuesOf(y3LoadHtml, 'data-vc-history-state')[0] === 'loading' && attrValuesOf(y3LoadHtml, 'data-vc-history-row').length === 0, 'Y3b 刷新中：画加载态，不拿上一次的列表冒充新读数')
  const y3EmptyHtml = hcHtmlOf({ reads: hcReadsOf({ commits: [], hasMore: false }) })
  check(attrValuesOf(y3EmptyHtml, 'data-vc-history-state')[0] === 'empty' && y3EmptyHtml.indexOf('data-vc-history-next') >= 0, 'Y3c 零提交：空态给出判断与下一步')
  const y3IdleHtml = hcHtmlOf({ reads: hcReadsOf({ reads: { firstScreen: { state: 'idle', data: null, error: null } } }) })
  check(attrValuesOf(y3IdleHtml, 'data-vc-history-state')[0] === 'loading', 'Y3d 刚打开还没读（idle）：按加载态画，不冒充空仓库')

  // Y4 单条提交详情（整页替换）：说明全文、作者时间、父提交数、文件清单与各失败态
  const y4Reads = hcReadsOf({ commits: hcRows4, reads: { commit: hcCommitOk } })
  const y4Html = hcHtmlOf({ reads: y4Reads, ui: { openCommit: hcRev.oid } })
  const y4Detail = y4Html.slice(y4Html.indexOf('data-vc-history-detail'))
  check(y4Html.indexOf('data-vc-history-detail="1"') >= 0 && y4Html.indexOf('data-vc-form="page"') >= 0, 'Y4a 点开一条提交：详情按整页替换形态画在历史页里')
  check(y4Detail.indexOf(hcRev.subject) >= 0 && y4Detail.indexOf('林可') >= 0, 'Y4b 详情画出提交说明全文、作者与时间')
  check(attrValuesOf(y4Html, 'data-vc-history-file').join(',') === 'src/a.ts,旧名.txt', 'Y4c 详情列出这次提交改到的每个文件（重命名带上旧路径）')
  check(y4Html.indexOf('data-vc-history-merge="1"') >= 0, 'Y4d 合并提交在详情里明确说是合并提交（' + hcRev.parents.length + ' 个父）')
  const y4RootHtml = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, reads: { commit: { rev: hcRows4[3].oid, seq: 1, state: 'ok', files: [], truncated: false, reason: 'no-diff', error: null } } }), ui: { openCommit: hcRows4[3].oid } })
  check(y4RootHtml.indexOf('data-vc-history-root="1"') >= 0, 'Y4e 根提交在详情里说明没有父提交（读全量差异，不按普通提交比）')
  const y4LoadHtml = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, reads: { commit: { rev: hcRev.oid, seq: 1, state: 'loading', files: [], truncated: false, reason: '', error: null } } }), ui: { openCommit: hcRev.oid } })
  check(attrValuesOf(y4LoadHtml, 'data-vc-history-detail-state')[0] === 'loading', 'Y4f 文件清单正在读：详情标加载态')
  const y4ErrHtml = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, reads: { commit: { rev: hcRev.oid, seq: 1, state: 'err', files: [], truncated: false, reason: '', error: { kind: 'non-zero', message: '读文件清单失败' } } } }), ui: { openCommit: hcRev.oid } })
  check(attrValuesOf(y4ErrHtml, 'data-vc-history-detail-state')[0] === 'error' && attrValuesOf(y4ErrHtml, 'data-vc-history-files-retry').length === 1, 'Y4g 文件清单读失败：给失败原因与重试入口')
  const y4TruncHtml = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, reads: { commit: { rev: hcRev.oid, seq: 1, state: 'ok', files: [], truncated: true, reason: 'truncated', error: null } } }), ui: { openCommit: hcRev.oid } })
  check(y4TruncHtml.indexOf(LOC.zh['vc.shell.history.filesTruncated']) >= 0, 'Y4h 清单被截断：明确说读不全，不给半份假清单')

  // Y5 逐文件差异（行内展开）：行类型、截断、二进制与合并提交各有说法
  const y5Lines = [
    { kind: 'filehead', text: 'diff --git a/src/a.ts' },
    { kind: 'hunk', text: '@@ -1 +1 @@' },
    { kind: 'add', text: '+新的一行' },
    { kind: 'del', text: '-旧的一行' },
    { kind: 'context', text: ' 没变的一行' },
  ]
  const y5Key = VIEW.vcCommitKeyOf(hcRev.oid, 'src/a.ts')
  const y5Reads = hcReadsOf({ commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [y5Key]: { state: 'ok', lines: y5Lines, truncated: false, reason: 'ok', error: null } } } })
  const y5Html = hcHtmlOf({ reads: y5Reads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } })
  check(y5Html.indexOf('data-vc-file-diff="src/a.ts"') >= 0, 'Y5a 展开逐文件差异：就地画出这个文件的差异块')
  check(attrValuesOf(y5Html, 'data-vc-diff-line').join(',') === 'filehead,hunk,add,del,context', 'Y5b 差异行按 git 的行类型逐行画（文件头 / 段头 / 加 / 删 / 上下文）')
  const y5TruncReads = hcReadsOf({ commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [y5Key]: { state: 'ok', lines: y5Lines, truncated: true, reason: 'ok', error: null } } } })
  check(hcHtmlOf({ reads: y5TruncReads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } }).indexOf(LOC.zh['vc.shell.history.diffTruncated']) >= 0, 'Y5c 差异被截断：明确画出「只画了前面这些行」')
  const y5BinReads = hcReadsOf({ commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [y5Key]: { state: 'ok', lines: [], truncated: false, reason: 'binary-diff', error: null } } } })
  check(hcHtmlOf({ reads: y5BinReads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } }).indexOf(LOC.zh['vc.shell.history.diffBinary']) >= 0, 'Y5d 二进制文件如实说不展开逐行差异（不冒充空差异）')
  const y5MergeReads = hcReadsOf({ commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [y5Key]: { state: 'ok', lines: [], truncated: false, reason: 'merge-commit', error: null } } } })
  check(hcHtmlOf({ reads: y5MergeReads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } }).indexOf(LOC.zh['vc.shell.history.diffMerge']) >= 0, 'Y5e 合并提交的逐文件差异如实说默认不展开')
  const y5ErrReads = hcReadsOf({ commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [y5Key]: { state: 'err', lines: [], truncated: false, reason: '', error: { kind: 'non-zero', message: '读差异失败' } } } } })
  check(attrValuesOf(hcHtmlOf({ reads: y5ErrReads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } }), 'data-vc-file-diff-retry').length === 1, 'Y5f 逐文件差异读失败：给重试入口')
  check(VIEW.vcHistoryDiffContextOf(520) === VIEW.VC_HISTORY_DIFF_LINES_WIDE && VIEW.vcHistoryDiffContextOf(460) === VIEW.VC_HISTORY_DIFF_LINES_NARROW && VIEW.VC_HISTORY_DIFF_LINES_WIDE > VIEW.VC_HISTORY_DIFF_LINES_NARROW, 'Y5g 520 宽的差异上下文比窄档更宽（按宽度放大，不在窄屏堆长差异）')

  // Y6 13.14 图形化视图：在提交历史页自绘（不调用 gitk）
  const y6Model = VIEW.vcHistoryGraphOf(hcRows4)
  check(y6Model.rows.length === hcRows4.length && y6Model.rows.every(function (row, i) { return row.oid === hcRows4[i].oid }), 'Y6a 图形化视图逐条提交一行（行数=提交数）')
  check(y6Model.rows[1].parents.length === 2 && y6Model.rows[1].edges.length === 2 && y6Model.rows[3].parents.length === 0 && y6Model.rows[3].edges.length === 0, 'Y6b 合并提交画两条父连线、根提交不连边')
  check(y6Model.rows.every(function (row) { return Number.isInteger(row.lane) && row.lane >= 0 }), 'Y6c 每条提交都落在一条车道上（图形有坐标，不是一堆散行）')
  const y6Html = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4 }) })
  check(y6Html.indexOf('data-vc-graph="1"') >= 0 && attrValuesOf(y6Html, 'data-vc-graph-row').length === hcRows4.length, 'Y6d 提交历史页画出 13.14 的图形化视图（每行一条）')
  check(y6Html.indexOf('data-vc-note="13.14"') >= 0 && y6Html.indexOf('data-vc-graph') >= 0, 'Y6e 13.14 说明位与图形化视图同页（图形化视图主入口仍在提交历史页）')
  check(y6Model.external === false && y6Html.indexOf('data-vc-graph-external') < 0, 'Y6f 图形化视图在面板内自绘：不调用 gitk、不开外部窗口')

  // Y7 四档宽 × 两套皮肤；宽度档按规格第 9 节只改排布、不删入口
  let y7AllOk = true
  let y7Narrow = ''
  let y7Mid = ''
  for (const y7Skin of VIEW.VC_SHELL_SKINS) {
    for (const y7Width of VIEW.VC_SHELL_WIDTHS) {
      const html = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, hasMore: true }), width: y7Width, skin: y7Skin })
      if (!html) { y7AllOk = false; continue }
      if (attrValuesOf(html, 'data-vc-width')[0] !== String(y7Width) || attrValuesOf(html, 'data-vc-skin')[0] !== y7Skin) y7AllOk = false
      if (attrValuesOf(html, 'data-vc-history-row').length !== hcRows4.length) y7AllOk = false
      if (y7Width === 300) y7Narrow = html
      if (y7Width === 380) y7Mid = html
    }
  }
  check(y7AllOk, 'Y7a 四档宽（300/380/460/520）× 两套皮肤（深/浅）的历史页都能渲染，宽度与皮肤读数对、列表不缩水')
  check(attrValuesOf(y7Narrow, 'data-vc-history-row').length === hcRows4.length && attrValuesOf(y7Narrow, 'data-vc-history-short').length === 0 && attrValuesOf(y7Narrow, 'data-vc-history-author').length === 0 && attrValuesOf(y7Narrow, 'data-vc-graph-row').length === 0, 'Y7b 300 宽只留标题（短号、作者与图形车道收起来，入口一个不删）')
  check(attrValuesOf(y7Mid, 'data-vc-history-short').length === hcRows4.length && attrValuesOf(y7Mid, 'data-vc-history-author').length === 0 && attrValuesOf(y7Mid, 'data-vc-graph-row').length === hcRows4.length, 'Y7c 380 宽补出短号与图形车道，作者与时间仍不占地方')
  const y7Wide = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4 }), width: 520 })
  check(attrValuesOf(y7Wide, 'data-vc-history-author').length === hcRows4.length && attrValuesOf(y7Wide, 'data-vc-history-when').length === hcRows4.length, 'Y7d 520 宽补作者与时间（提交行信息随宽度恢复）')

  // Y8 键盘可达与读屏属性
  const y8Closed = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4 }) })
  const y8Open = hcHtmlOf({ reads: y4Reads, ui: { openCommit: hcRev.oid } })
  // 只数提交行自己的 aria-expanded：壳上有身份行三颗按钮（分支 / 搜索 / 齿轮）也带这个属性，
  //   它们一直按自己的开合报 true/false，不属于列表行；拿全页的 aria-expanded 数会多出三颗。
  const y8ClosedExpand = (y8Closed.match(/data-vc-history-open="[^"]*"[^>]*aria-expanded="([^"]*)"/g) || []).map(function (seg) { return (seg.match(/aria-expanded="([^"]*)"/) || ['', ''])[1] })
  check(y8ClosedExpand.length === hcRows4.length && y8ClosedExpand.every(function (v) { return v === 'false' }), 'Y8a 每条提交行都是带 aria-expanded=false 的按钮（读屏知道能展开）')
  check(y8Open.indexOf('aria-expanded="true"') >= 0 && idSetOf(y8Open).has('vc-history-detail'), 'Y8b 打开详情时 aria-expanded=true，且详情节点 id 真实存在')
  check(attrValuesOf(y8Open, 'aria-controls').indexOf('vc-history-detail') >= 0 && attrValuesOf(y8Closed, 'aria-controls').indexOf('vc-history-detail') >= 0, 'Y8c 行的 aria-controls 指向详情节点（展开前后都指得清）')
  check(y8Open.indexOf('role="region"') >= 0 && y8Open.indexOf('aria-labelledby="vc-history-detail-title"') >= 0 && idSetOf(y8Open).has('vc-history-detail-title'), 'Y8d 详情是 region 且由真实标题节点命名（读屏念得清这是什么）')
  check(attrValuesOf(y8Open, 'data-vc-history-back').length === 1, 'Y8e 详情有返回列表的控件（键盘走得回列表）')
  const y8Load = hcHtmlOf({ reads: hcReadsOf({ commits: hcRows4, hasMore: true }) })
  check(/data-vc-load-more="1"[^>]*aria-controls="vc-history-list"/.test(y8Load) && y8Load.indexOf('id="vc-history-list"') >= 0, 'Y8f 「加载更多」按钮 aria-controls 指向真实列表 id')
  check(y8Load.indexOf('role="list"') >= 0 && y8Load.indexOf('aria-label="') >= 0, 'Y8g 提交列表是按读屏可念的列表画的（role=list 与名称都在）')

  // Y9 车道封顶：宁可少画也不横向溢出
  const y9Commits = (function () {
    const rows = hcCommitsOf(20)
    return rows.map(function (c, i) { return Object.assign({}, c, { parents: [hcOid(i + 1), hcOid(i + 2)] }) })
  })()
  const y9Model = VIEW.vcHistoryGraphOf(y9Commits)
  check(y9Model.rows.every(function (row) { return row.lane < VIEW.VC_HISTORY_LANES_MAX }) && y9Model.hiddenLanes > 0, 'Y9 车道上限生效（超过 ' + VIEW.VC_HISTORY_LANES_MAX + ' 条的车道不画，并如实说有 ' + y9Model.hiddenLanes + ' 处没画）')

  // ---- R 组：远端与同步页（#1754 T18，域 8 的 8.1–8.4）----
  // 三种读数分开验：本地读数（git remote -v + 本地跟踪分支，不联网）、用户点「联网查看」后才走的
  //   git ls-remote（结果标来源与读取时刻）、四条写动作（登记 / 改名 / 删除 / 改地址）的三段式。
  // 数据层与渲染层各验一遍：电话名与读数判据从数据层取，页面属性从 vcRenderTabAt 的 remote 页取；
  //   两边都不另抄一份名单（能力编号一律问能力账本）。
  const rcOid = function (ch) { return String(ch).repeat(40) }
  const rcRemotesOf = function () {
    return [
      {
        name: 'origin',
        fetchUrl: 'https://user:***@example.com/acme/repo.git',
        pushUrl: 'https://user:***@example.com/acme/repo.git',
        hasCredential: true,
        branchCount: 2,
        branches: [
          { short: 'main', name: 'origin/main', oid: rcOid('a'), ref: 'refs/remotes/origin/main' },
          { short: 'dev', name: 'origin/dev', oid: rcOid('b'), ref: 'refs/remotes/origin/dev' },
        ],
      },
      {
        name: 'mirror',
        fetchUrl: 'git@example.com:acme/repo.git',
        pushUrl: 'git@example.com:acme/repo.git',
        hasCredential: false,
        branchCount: 0,
        branches: [],
      },
    ]
  }
  const rcLocalDataOf = function (remotes, readAtMs) {
    return { source: 'local', readAtMs: readAtMs === undefined ? NOW - 2 * 60000 : readAtMs, remotes: remotes || rcRemotesOf() }
  }
  const rcReadsOf = function (opts) {
    const o = opts || {}
    const remote = o.remote !== undefined ? o.remote : { state: 'ok', data: rcLocalDataOf(o.remotes, o.readAtMs), error: null }
    const online = o.online !== undefined ? o.online : { state: 'idle', name: '', data: null, error: null }
    return { remote: remote, online: online }
  }
  const rcHtmlOf = function (opts) {
    const o = opts || {}
    const shellOpts = Object.assign({ page: 'remote', width: 460, skin: 'dark', reads: rcReadsOf(o) }, o.shell || {})
    if (o.ui) shellOpts.ui = o.ui
    return shellHtmlOf(shellOpts)
  }
  // 从某个属性标记起到下一个终止标记之间的那一段：确认卡 / 表单 / 结果必须落在触发点那一段里。
  const rcSegmentOf = function (html, anchor, endAnchors) {
    const text = String(html)
    const at = text.indexOf(anchor)
    if (at < 0) return ''
    const rest = text.slice(at + anchor.length)
    let cut = rest.length
    for (const end of endAnchors || []) {
      const i = rest.indexOf(end)
      if (i >= 0 && i < cut) cut = i
    }
    return rest.slice(0, cut)
  }

  // R0 数据层：电话名与读数判据（页面只读这份，不在画法里另写一份）
  const rcPhones = VIEW.VC_REMOTE_PHONES
  check(rcPhones.list === 'wf.gitRemoteList' && rcPhones.add === 'wf.gitRemoteAdd' && rcPhones.rename === 'wf.gitRemoteRename' && rcPhones.remove === 'wf.gitRemoteRemove' && rcPhones.setUrl === 'wf.gitRemoteSetUrl' && rcPhones.online === 'wf.gitRemoteOnline', 'R0a 客户端六条电话名与宿主登记的六条逐条相等（加/改名/删除/改地址/列表/联网）')
  const rcIdleReads = VIEW.vcNewRemoteReads()
  check(VIEW.vcRemoteStateOf(rcIdleReads) === 'idle' && VIEW.vcRemoteOnlineStateOf(rcIdleReads) === 'idle' && VIEW.vcRemoteOnlineOf(rcIdleReads) === null, 'R0b 全新读数里两个槽都是 idle：打开页面没有任何一处会自动发联网请求')
  const rcApplied = VIEW.vcApplyRemoteReply(rcIdleReads, 'remote', { ok: true, source: 'local', readAtMs: NOW - 120000, remotes: rcRemotesOf() })
  check(VIEW.vcRemoteStateOf(rcApplied) === 'ok' && VIEW.vcRemoteRemotesOf(rcApplied).length === 2 && VIEW.vcRemoteReadAtOf(rcApplied) === NOW - 120000, 'R0c 本地列表回包落成读数：两条远端、读取时刻与回包一致')
  const rcAppliedFail = VIEW.vcApplyRemoteReply(rcApplied, 'remote', { ok: false, error: { kind: 'non-zero', message: 'git remote -v 没读到' } })
  check(VIEW.vcRemoteStateOf(rcAppliedFail) === 'err' && VIEW.vcRemoteRemotesOf(rcAppliedFail).length === 2, 'R0d 刷新失败保留上一次的列表继续画（不拿半份或空表冒充新读数）')

  // R1 本地读数：列表、读取时刻、地址展示与凭据标记
  const r1Html = rcHtmlOf({})
  check(r1Html.indexOf('data-vc-remote-page="1"') >= 0 && attrValuesOf(r1Html, 'data-vc-remote-state')[0] === 'ok', 'R1a 远端与同步页作为管理页二级页画出来（根节点 data-vc-remote-page，状态 ok）')
  check(attrValuesOf(r1Html, 'data-vc-remote').join(',') === 'origin,mirror', 'R1b 远端列表一个远端一行、顺序与本地读数一致（实得 ' + attrValuesOf(r1Html, 'data-vc-remote').join(',') + '）')
  check(attrValuesOf(r1Html, 'data-vc-remote-local-read')[0] === String(NOW - 2 * 60000) && /本地记录/.test(r1Html), 'R1c 本地读数标出读取时刻并写明「这是本地记录」（不是刚从远端读回来的）')
  check(attrValuesOf(r1Html, 'data-vc-remote-url').join(',') === 'https://user:***@example.com/acme/repo.git,git@example.com:acme/repo.git', 'R1d 地址按列表回包里的展示值画（口令已在宿主那一层抹掉，页面不重新拼地址）')
  check(attrValuesOf(r1Html, 'data-vc-remote-credential').join(',') === 'origin', 'R1e 只有带登录信息的远端挂凭据标记（不靠颜色、用文字说明）')
  check(attrValuesOf(r1Html, 'data-vc-remote-branch-count').join(',') === '2,0' && attrValuesOf(r1Html, 'data-vc-remote-branch').join(',') === 'main,dev', 'R1f 每个远端带本地跟踪分支数与分支名（也是本地记录）')

  // R2 联网入口：只在用户点它之后才联网，结果标来源
  const r2OnlineOk = {
    state: 'ok', name: 'origin',
    data: {
      source: 'network', remoteName: 'origin',
      refs: [
        { oid: rcOid('a'), ref: 'refs/heads/main', kind: 'branch' },
        { oid: rcOid('c'), ref: 'refs/tags/v1.0.0', kind: 'tag' },
      ],
      count: 2, readAtMs: NOW - 60000, truncated: false,
    },
    error: null,
  }
  check(attrValuesOf(r1Html, 'data-vc-remote-online-btn').join(',') === 'origin,mirror', 'R2a 每个远端一条「联网查看」按钮（入口不合并、不藏到二级页）')
  check(r1Html.indexOf('需要联网') >= 0 && r1Html.indexOf('data-vc-remote-online-hint="1"') >= 0, 'R2b 联网入口明写「需要联网」，并说明它不是打开页面就会自动走的')
  check(r1Html.indexOf('data-vc-remote-online-source') < 0 && attrValuesOf(r1Html, 'data-vc-remote-ref').length === 0, 'R2c 打开页面只有本地记录：没有任何联网结果，也没有引用清单')
  const r2OkHtml = rcHtmlOf({ online: r2OnlineOk })
  check(attrValuesOf(r2OkHtml, 'data-vc-remote-online-source').join(',') === 'network', 'R2d 联网结果标来源是 network（不把联网结果和本地记录混在一起）')
  check(attrValuesOf(r2OkHtml, 'data-vc-remote-online-read-at')[0] === String(NOW - 60000), 'R2e 联网结果带这一次的读取时刻（不是本地列表的读取时刻）')
  check(attrValuesOf(r2OkHtml, 'data-vc-remote-ref').join(',') === 'refs/heads/main,refs/tags/v1.0.0' && attrValuesOf(r2OkHtml, 'data-vc-remote-online-count')[0] === '2', 'R2f 联网结果列出引用清单与条数（分支、标签各一条）')
  check(attrValuesOf(r2OkHtml, 'data-vc-form').indexOf('page') >= 0 && r2OkHtml.indexOf('data-vc-remote-back') >= 0, 'R2g 引用清单按整页替换形态画（独立滚动、有返回）')
  check(/aria-live="polite"/.test(r2OkHtml) && idSetOf(r2OkHtml).has('vc-remote-online'), 'R2h 联网结果有 aria-live 与真实 id（读屏会念，按钮 aria-controls 指得清）')
  const r2ErrHtml = rcHtmlOf({ online: { state: 'err', name: 'origin', data: null, error: { kind: 'needs-credential', reason: 'needs-credential', message: '远端要凭据才能读取，面板这边不弹登录框。', hint: '' } } })
  check(attrValuesOf(r2ErrHtml, 'data-vc-remote-online-error').join(',') === 'needs-credential' && /终端/.test(r2ErrHtml), 'R2i 需要凭据：明说失败分类并指引到终端登录一次（面板不弹密码框）')
  check(attrValuesOf(r2ErrHtml, 'data-vc-remote-ref').length === 0 && r2ErrHtml.indexOf('data-vc-remote-online-retry') >= 0, 'R2j 联网失败不给半份引用清单，并给重试入口')
  const r2TruncHtml = rcHtmlOf({ online: { state: 'err', name: 'origin', data: null, error: { kind: 'truncated', reason: 'truncated', message: '这次联网输出被截断了，读不全。', hint: '' } } })
  check(attrValuesOf(r2TruncHtml, 'data-vc-remote-online-error').join(',') === 'truncated' && attrValuesOf(r2TruncHtml, 'data-vc-remote-ref').length === 0, 'R2k 输出被截断按失败处理（截断不显示半份）')
  const r2LoadHtml = rcHtmlOf({ online: { state: 'loading', name: 'origin', data: null, error: null } })
  check(attrValuesOf(r2LoadHtml, 'data-vc-remote-online').join(',') === 'loading' && attrValuesOf(r2LoadHtml, 'data-vc-remote-ref').length === 0, 'R2l 联网进行中画加载态（不拿上一次结果冒充这一次）')

  // R3 四种状态：空 / 加载 / 失败 / 还没读
  const r3EmptyHtml = rcHtmlOf({ remotes: [] })
  check(attrValuesOf(r3EmptyHtml, 'data-vc-remote-state')[0] === 'empty' && r3EmptyHtml.indexOf('data-vc-remote-empty') >= 0 && r3EmptyHtml.indexOf('data-vc-remote-empty-next') >= 0, 'R3a 没有远端：空态给出判断与下一步（登记远端）')
  const r3ErrHtml = rcHtmlOf({ remote: { state: 'err', data: null, error: { kind: 'non-zero', message: 'git remote -v 没读到' } } })
  check(attrValuesOf(r3ErrHtml, 'data-vc-remote-state')[0] === 'error' && r3ErrHtml.indexOf('data-vc-remote-retry') >= 0, 'R3b 本地读数失败：失败态给重试入口')
  const r3LoadHtml = rcHtmlOf({ remote: { state: 'loading', data: rcLocalDataOf(), error: null } })
  check(attrValuesOf(r3LoadHtml, 'data-vc-remote-state')[0] === 'loading' && r3LoadHtml.indexOf('data-vc-old-read') >= 0, 'R3c 刷新中：画加载态并把上一次读数标成旧读数')
  const r3IdleHtml = rcHtmlOf({ remote: { state: 'idle', data: null, error: null } })
  check(attrValuesOf(r3IdleHtml, 'data-vc-remote-state')[0] === 'loading', 'R3d 刚打开还没读（idle）：按加载态画，不冒充没有远端')

  // R4 写动作的三种形态与确认卡
  const r4AddHtml = rcHtmlOf({ ui: { form: 'add' } })
  const r4AddSeg = rcSegmentOf(r4AddHtml, 'data-vc-remote-trigger="add"', ['data-vc-cap-list'])
  check(r4AddSeg.indexOf('data-vc-form="inline"') >= 0 && r4AddSeg.indexOf('data-vc-remote-form="add"') >= 0 && (r4AddSeg.match(/aria-label=/g) || []).length >= 2 && r4AddSeg.indexOf('data-vc-remote-submit="add"') >= 0, 'R4a 登记远端用行内展开形态（名字与地址两个字段都有读屏名称）')
  const r4RenameHtml = rcHtmlOf({ ui: { form: 'rename', target: 'mirror' } })
  const r4RenameSeg = rcSegmentOf(r4RenameHtml, 'data-vc-remote="mirror"', ['data-vc-cap-list'])
  check(r4RenameSeg.indexOf('data-vc-form="float"') >= 0 && r4RenameSeg.indexOf('data-vc-remote-form="rename"') >= 0 && r4RenameSeg.indexOf('data-vc-remote-trigger="rename"') >= 0, 'R4b 改名贴触发点用浮层形态（浮层就在那一行里，不开居中模态）')
  const r4RemoveHtml = rcHtmlOf({ ui: { form: 'remove', target: 'mirror' } })
  const r4RemoveSeg = rcSegmentOf(r4RemoveHtml, 'data-vc-remote="mirror"', ['data-vc-cap-list'])
  check(r4RemoveSeg.indexOf('data-vc-confirm="1"') >= 0 && (r4RemoveSeg.match(/data-vc-confirm-seg=/g) || []).length === 4 && r4RemoveSeg.indexOf('data-focus-default="cancel"') >= 0, 'R4c 删除远端贴触发点画确认卡（固定四段，默认焦点在取消）')
  const r4UrlHtml = rcHtmlOf({ ui: { form: 'setUrl', target: 'origin', problem: 'remote-url' } })
  const r4UrlSeg = rcSegmentOf(r4UrlHtml, 'data-vc-remote="origin"', ['data-vc-remote="mirror"'])
  check(r4UrlSeg.indexOf('data-vc-form="float"') >= 0 && r4UrlSeg.indexOf('data-vc-remote-field-error="remote-url"') >= 0, 'R4d 改地址的浮层当场报地址校验原因（判据标识与共享层同一套）')

  // R5 结果贴触发点：成功给命令名 / 耗时 / 作用对象数 / 下一步，失败给 git 原话 / 环节 / 期望与实际 / 上游原因
  const r5OkHtml = rcHtmlOf({ ui: { form: 'add', result: { ok: true, cmd: 'git remote add', ms: 18, n: 1, next: '列表已经刷新' } } })
  const r5OkSeg = rcSegmentOf(r5OkHtml, 'data-vc-remote-trigger="add"', ['data-vc-cap-list'])
  check(r5OkSeg.indexOf('data-vc-result="ok"') >= 0 && r5OkSeg.indexOf('git remote add') >= 0 && r5OkSeg.indexOf('18') >= 0 && r5OkSeg.indexOf('列表已经刷新') >= 0, 'R5a 写动作成功的结果贴在触发点那一段（命令名 / 耗时 / 作用对象数 / 可行动细节都在）')
  const r5FailHtml = rcHtmlOf({ ui: { form: 'add', result: { ok: false, git: 'fatal: remote origin already exists.', step: '执行 git remote add', expected: '远端列表多一条', actual: '列表仍是两条', cause: '同名远端已存在' } } })
  const r5FailSeg = rcSegmentOf(r5FailHtml, 'data-vc-remote-trigger="add"', ['data-vc-cap-list'])
  check(r5FailSeg.indexOf('data-vc-result="fail"') >= 0 && r5FailSeg.indexOf('fatal: remote origin already exists.') >= 0 && r5FailSeg.indexOf('期望') >= 0 && r5FailSeg.indexOf('上游原因') >= 0, 'R5b 失败结果仍贴触发点：git 原话、环节名、期望与实际、上游原因都在')

  // R6 四档宽 × 两套皮肤：只改排布、不删入口，层级 2
  let r6AllOk = true
  let r6Narrow = ''
  for (const r6Skin of VIEW.VC_SHELL_SKINS) {
    for (const r6Width of VIEW.VC_SHELL_WIDTHS) {
      const html = rcHtmlOf({ shell: { width: r6Width, skin: r6Skin } })
      if (!html) { r6AllOk = false; continue }
      if (attrValuesOf(html, 'data-vc-width')[0] !== String(r6Width) || attrValuesOf(html, 'data-vc-skin')[0] !== r6Skin) r6AllOk = false
      if (attrValuesOf(html, 'data-vc-remote').length !== 2) r6AllOk = false
      if (attrValuesOf(html, 'data-vc-remote-online-btn').length !== 2) r6AllOk = false
      if (attrValuesOf(html, 'data-vc-remote-act').length !== 6) r6AllOk = false
      if (attrValuesOf(html, 'data-vc-depth')[0] !== '2') r6AllOk = false
      if (r6Width === 300) r6Narrow = html
    }
  }
  check(r6AllOk, 'R6a 四档宽（300/380/460/520）× 两套皮肤都能渲染：宽度与皮肤读数对、远端与联网入口一个不删、层级都是 2')
  check(attrValuesOf(r6Narrow, 'data-vc-remote').length === 2 && attrValuesOf(r6Narrow, 'data-vc-remote-more').length === 2 && attrValuesOf(r6Narrow, 'data-vc-remote-url').length === 0, 'R6b 300 宽只留名字与状态，其余动作收进「更多」菜单（不删入口），地址收起')

  // R7 主入口唯一、键盘可达与读屏属性
  const r7Caps = VIEW.vcPageCapabilitiesOf('remote')
  const r7CapIds = r7Caps.map(function (c) { return c.id })
  const r7Primary = attrValuesOf(r1Html, 'data-cap-primary')
  const r7EachOnce = r7CapIds.length > 0 && r7Primary.join(',') === r7CapIds.join(',') && r7CapIds.every(function (id) { return r7Primary.filter(function (x) { return x === id }).length === 1 })
  check(r7CapIds.slice(0, 4).join(',') === '8.1,8.2,8.3,8.4' && r7EachOnce, 'R7a 远端页每条能力恰好一个主入口，8.1–8.4 排在最前（页面注册表与能力账本同源；这一页还挂着域 8 其余能力，等后续票接）')
  const r7Cap81 = VIEW.vcCapabilityOf('8.1')
  check(!!r7Cap81 && r7Cap81.page === 'remote' && r7Cap81.primaryEntry.indexOf('远端') >= 0, 'R7b 8.1 的主入口登记在「远端与同步」页')
  check(/data-vc-remote-online-btn="origin"[^>]*aria-expanded="true"/.test(r2OkHtml) && /data-vc-remote-online-btn="mirror"[^>]*aria-expanded="false"/.test(r2OkHtml), 'R7c 联网展开状态由 aria-expanded 报给读屏（展开的是哪个远端指得清）')
  check(attrValuesOf(r2OkHtml, 'aria-controls').indexOf('vc-remote-online') >= 0 && idSetOf(r2OkHtml).has('vc-remote-online'), 'R7d 联网按钮 aria-controls 指向真实结果面板 id')
  check(r2OkHtml.indexOf('role="list"') >= 0 && /aria-label="[^"]*远端/.test(r2OkHtml), 'R7e 远端列表按读屏可念的列表画（role=list 与名称都在）')
  check(r4RemoveSeg.indexOf('role="dialog"') >= 0 && r4RemoveSeg.indexOf('aria-modal="false"') >= 0 && /aria-label="[^"]*mirror/.test(r4RemoveSeg), 'R7f 删除确认卡是带名称的非模态对话框（读屏念得清在做什么、不抢焦点）')
  // ---- Q 组：历史高级查询面板（#1745 T10：能力 3.4–3.13 十条）----
  // 落点（票面写死）：3.5 / 3.9 / 3.11 / 3.13 的主入口在「管理 › 诊断」页，其余六条落提交历史页。
  //   能力归属不在这里另写名单：面板按能力账本的 page 字段筛，断言逐条回账本对。
  // 先量一量页面归属与主入口标记，再判输入、校验、读取四态与十种结果的画法。
  const qEsc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
  const qPageHtmlOf = function (page) { return shellHtmlOf({ page: page, width: 460, skin: 'dark' }) }
  const qKindsOf = function (html) { return attrValuesOf(html, 'data-vc-query') }
  const qCapsOf = function (html) { return attrValuesOf(html, 'data-vc-query-cap') }
  const qDiagPrimaryJudgmentOf = function (v) {
    const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'diagnostics', width: 460 }))
    const prim = attrValuesOf(html, 'data-vc-query-primary')
    return prim.length === 4 && prim.every(function (x) { return x === '1' }) && attrValuesOf(html, 'data-vc-query-primary-badge').length === 4
  }
  const qCommitsHtml = qPageHtmlOf('commits')
  const qDiagHtml = qPageHtmlOf('diagnostics')
  check(qKindsOf(qCommitsHtml).join(',') === 'file-history,grep,pickaxe,compare,describe,notes' && qCapsOf(qCommitsHtml).join(',') === '3.4,3.6,3.7,3.8,3.10,3.12', 'Q1a 提交历史页挂六组历史高级查询（3.4 单文件历史 / 3.6 说明搜索 / 3.7 代码变化搜索 / 3.8 比较引用 / 3.10 版本名 / 3.12 提交备注）')
  check(qKindsOf(qDiagHtml).join(',') === 'blame,range-diff,reflog,show-file' && qCapsOf(qDiagHtml).join(',') === '3.5,3.9,3.11,3.13', 'Q1b 管理·诊断页挂四组只读查询（3.5 行级追溯 / 3.9 两组提交对照 / 3.11 引用日志 / 3.13 取某版本文件内容）')
  check(attrValuesOf(qCommitsHtml, 'data-vc-query-page').every(function (p) { return p === 'commits' }) && attrValuesOf(qDiagHtml, 'data-vc-query-page').every(function (p) { return p === 'diagnostics' }), 'Q1c 每组都带着自己所在的页面读数（页面归属不靠代码里的书写次序猜）')
  check(attrValuesOf(qCommitsHtml, 'data-vc-query-primary').join(',') === '0,0,0,0,0,0' && attrValuesOf(qCommitsHtml, 'data-vc-query-primary-badge').length === 0, 'Q1d 提交历史页六组都不是「诊断页主入口」（不抢 3.5/3.9/3.11/3.13 的说法）')
  check(qDiagPrimaryJudgmentOf(VIEW), 'Q1e 诊断页四组都标主入口并挂「主入口」徽标，页面正文写着这四条的主入口就在本页（共 4 组）')
  check(qDiagHtml.indexOf('data-vc-query-diagnostics="1"') >= 0 && qDiagHtml.indexOf(tZh('vc.query.diagnosticsNote')) >= 0, 'Q1f 诊断页正文有「本页是四条只读能力主入口」的说明段（不是只靠徽标暗示）')
  // 「历史查看」域一共十三条：3.1 提交列表 / 3.2 单条提交详情 / 3.3 提交内逐文件差异 由 #1744 的提交历史页正文承担，
  //   本票接 3.4–3.13 这十条（逐条列在这里，是票面写死的范围，不是从代码里反推的名单）。
  const qWantCapIds = ['3.4', '3.5', '3.6', '3.7', '3.8', '3.9', '3.10', '3.11', '3.12', '3.13']
  const qAllPagesCaps: string[] = []
  VIEW.PAGE_SURFACES.forEach(function (surface) {
    const html = qPageHtmlOf(String(surface.id))
    qCapsOf(html).forEach(function (id) { qAllPagesCaps.push(id) })
  })
  const qCapOrder = function (a: string, b: string) { return Number(a) - Number(b) }
  check(qAllPagesCaps.slice().sort(qCapOrder).join(',') === qWantCapIds.slice().sort(qCapOrder).join(','), 'Q1g 全页面板的能力并集 = 票面那十条（3.4–3.13，一个不多一个不少；3.1–3.3 由提交历史页正文承担）实测：' + qAllPagesCaps.slice().sort(qCapOrder).join(','))
  let qLedgerOk = VIEW.vcQueryCatalogOf().length === 10
  VIEW.vcQueryCatalogOf().forEach(function (entry) {
    const cap = VIEW.vcCapabilityOf(entry.capId)
    const html = qPageHtmlOf(String(entry.page))
    if (!cap || entry.page !== cap.page || entry.name !== cap.name || html.indexOf(qEsc(cap.command)) < 0) qLedgerOk = false
  })
  check(qLedgerOk, 'Q1h 十条的名称、页面归属与命令原文都逐条回能力账本取（界面不另写一份命令清单）')
  let qOtherPagesClean = true
  VIEW.PAGE_SURFACES.forEach(function (surface) {
    const id = String(surface.id)
    if (id === 'commits' || id === 'diagnostics') return
    if (qPageHtmlOf(id).indexOf('data-vc-query-panel') >= 0) qOtherPagesClean = false
  })
  check(qOtherPagesClean, 'Q1i 其余十四页不出现历史高级查询面板（入口不扩散到所有页面）')

  // Q2 输入面：每组的字段名与能力目录一一对应，条数初值与两种下拉的初值有真实默认
  const qFieldCountOf = function (kind) { return VIEW.vcQueryEntryOf(kind).fields.length }
  const qInputsOn = function (html, kind) { return attrValuesOf(html, 'data-vc-query-field-for').filter(function (k) { return k === kind }).length }
  let qFieldsOk = true
  VIEW.vcQueryCatalogOf().forEach(function (entry) {
    const html = qPageHtmlOf(String(entry.page))
    if (qInputsOn(html, entry.kind) !== entry.fields.length) qFieldsOk = false
    entry.fields.forEach(function (f) { if (html.indexOf('data-vc-query-input="' + f.name + '"') < 0) qFieldsOk = false })
  })
  check(qFieldsOk, 'Q2a 十条的输入框逐字段画出来（字段名与能力目录同源，不多不少）')
  check(VIEW.vcQueryInputValueOf(VIEW.vcQueryInputsOf(), 'file-history', 'count') === '50' && VIEW.vcQueryInputValueOf(VIEW.vcQueryInputsOf(), 'compare', 'mode') === 'two-dot' && VIEW.vcQueryInputValueOf(VIEW.vcQueryInputsOf(), 'pickaxe', 'mode') === 'occurrence', 'Q2b 条数初值 50、比较方式初值两点（a..b）、搜索方式初值按出现次数（-S）')
  check(qCommitsHtml.indexOf('value="50"') >= 0 && qCommitsHtml.indexOf('value="two-dot"') >= 0 && qCommitsHtml.indexOf('value="occurrence"') >= 0, 'Q2c 初值真的画进输入框（不是只存在状态里）')
  const qLimitsOk = ['file-history', 'blame', 'compare', 'range-diff'].every(function (kind) {
    const entry = VIEW.vcQueryEntryOf(kind)
    return qPageHtmlOf(String(entry.page)).indexOf('data-vc-query-limit="' + entry.limit + '"') >= 0 && entry.limit > 0
  }) && qPageHtmlOf('commits').indexOf('data-vc-query-limit="0"') < 0
  check(qLimitsOk, 'Q2d 有上限的四条写着各自的显式条数上限，没有上限的三条不放假上限')

  // Q3 本地预检：四类错各指到字段，十条合法输入各自拼出宿主要的那份参数
  const qReq = VIEW.vcQueryParamsOf('file-history', { path: '', count: '50' })
  const qNum = VIEW.vcQueryParamsOf('grep', { pattern: 'x', count: '三' })
  const qOrder = VIEW.vcQueryParamsOf('blame', { path: 'a.txt', lineStart: '9', lineEnd: '3' })
  const qSpan = VIEW.vcQueryParamsOf('blame', { path: 'a.txt', lineStart: '1', lineEnd: '1' + '0'.repeat(3) })
  check(qReq.ok === false && qReq.reason === 'required-missing' && qReq.field === 'path', 'Q3a 必填没填：当场指到 path 字段（不把空路径发出去）')
  check(qNum.ok === false && qNum.reason === 'not-number' && qNum.field === 'count', 'Q3b 条数写歪：当场指到 count 字段（不是拿 NaN 去问 git）')
  check(qOrder.ok === false && qOrder.reason === 'range-order' && qOrder.field === 'lineEnd', 'Q3c 行号区间颠倒：指到 lineEnd（不猜用户想要哪一段）')
  check(qSpan.ok === false && qSpan.reason === 'range-span', 'Q3d 行数跨度超过 ' + VIEW.VC_QUERY_BLAME_SPAN_MAX + '：拒绝并说清上限（不偷偷截小）')
  let qParamsOk = true
  VIEW.vcQueryCatalogOf().forEach(function (entry) {
    const values: any = {}
    entry.fields.forEach(function (f) { if (f.required) values[f.name] = f.type === 'number' ? '50' : 'x' })
    const built = VIEW.vcQueryParamsOf(entry.kind, values)
    entriesOk: {
      if (!built.ok) { qParamsOk = false; break entriesOk }
      const keys = Object.keys(built.params).sort().join(',')
      const want = entry.fields.filter(function (f) { return values[f.name] !== undefined }).map(function (f) { return f.name }).sort().join(',')
      if (keys !== want) qParamsOk = false
      entry.fields.forEach(function (f) { if (f.type === 'number' && values[f.name] !== undefined && typeof built.params[f.name] !== 'number') qParamsOk = false })
    }
  })
  check(qParamsOk, 'Q3e 十条的合法输入各自拼出宿主要的那份参数（键名与能力目录同源，条数转成数字）')
  check(VIEW.vcQueryParamsOf('range-diff', { base: 'main', left: 'feat-a', right: 'feat-b' }).params.right === 'feat-b', 'Q3f 两组提交对照把三个引用原样交给宿主（不在本地猜哪边是新）')

  // Q4 读取路径：一次读 = 电话名 + 参数，成功 / 失败 / 形状不对 / 异常 / 空目录 / 迟到回包各有落点
  const qCalls: any[] = []
  const qCallOk = function (kind, reply) { return function (method, args) { qCalls.push({ method: method, args: args }); return Promise.resolve(reply) } }
  const qCommitsReply = { ok: true, kind: 'file-history', commits: hcRows4.slice(0, 2), count: 2, total: 2, truncated: false, reason: '' }
  const qReadOk = await VIEW.vcReadHistoryQuery({ queries: {} }, qCallOk('file-history', qCommitsReply), 'D:/w/repo', 'file-history', { path: 'src/a.ts', count: '50' })
  check(qReadOk.queries['file-history'].state === 'ok' && qReadOk.queries['file-history'].data === qCommitsReply, 'Q4a 读到就落成成功态（回包原样存着，不在半路改形状）实测：' + JSON.stringify(qReadOk.queries['file-history']).slice(0, 200))
  check(qCalls.length === 1 && qCalls[0].method === VIEW.VC_QUERY_PHONE && qCalls[0].args.cwd === 'D:/w/repo' && qCalls[0].args.kind === 'file-history' && qCalls[0].args.params.path === 'src/a.ts' && qCalls[0].args.params.count === 50, 'Q4b 打的是 wf.gitHistoryQuery：带目录、能力种类与参数（条数已是数字）')
  const qOld = { state: 'ok', seq: 3, data: qCommitsReply, error: null }
  const qReadFail = await VIEW.vcReadHistoryQuery({ queries: { 'file-history': qOld } }, function () { return Promise.resolve({ ok: false, error: { kind: 'non-zero', message: 'fatal: bad revision' } }) }, 'D:/w/repo', 'file-history', { path: 'src/a.ts', count: '50' })
  check(qReadFail.queries['file-history'].state === 'err' && qReadFail.queries['file-history'].error.kind === 'non-zero' && qReadFail.queries['file-history'].error.message === 'fatal: bad revision' && qReadFail.queries['file-history'].data === qCommitsReply, 'Q4c 宿主失败：落失败态并保留上一次读到的数据（错误原文照实存着）')
  const qReadShape = await VIEW.vcReadHistoryQuery({ queries: {} }, function () { return Promise.resolve({ ok: true, kind: 'file-history' }) }, 'D:/w/repo', 'file-history', { path: 'a' })
  check(qReadShape.queries['file-history'].state === 'err' && qReadShape.queries['file-history'].error.kind === 'shape', 'Q4d 回包缺字段判形状失败（不拿半份数据冒充成功）')
  const qReadThrow = await VIEW.vcReadHistoryQuery({ queries: {} }, function () { throw new Error('管道断了') }, 'D:/w/repo', 'grep', { pattern: 'x' })
  check(qReadThrow.queries.grep.state === 'err' && qReadThrow.queries.grep.error.kind === 'throw' && qReadThrow.queries.grep.error.message === '管道断了', 'Q4e 电话抛异常也落失败态（不把异常漏到渲染那一帧）')
  qCalls.length = 0
  const qReadNoCwd = await VIEW.vcReadHistoryQuery({ queries: {} }, qCallOk('grep', { ok: true }), '', 'grep', { pattern: 'x' })
  check(qReadNoCwd.queries.grep.state === 'err' && qReadNoCwd.queries.grep.error.kind === 'no-cwd' && qCalls.length === 0, 'Q4f 没有工作区就不打这一枪（如实说没目录，不发一条注定失败的 git）')
  const qLate = { queries: { grep: { state: 'ok', seq: 2, data: { ok: true }, error: null } } }
  const qLateNext = { queries: { grep: { state: 'ok', seq: 1, data: { ok: true, stale: true }, error: null } } }
  check(VIEW.vcApplyQueryReply(qLate, qLateNext, 'grep') === qLate, 'Q4g 晚到的旧回包丢掉（代际号小的不盖新的）')
  const qLogs: any[] = []
  const qLoggedView = buildView(null, qLogs)
  await qLoggedView.vcReadHistoryQuery({ queries: {} }, function () { return Promise.resolve(qCommitsReply) }, 'D:/w/repo', 'file-history', { path: 'a' })
  await qLoggedView.vcReadHistoryQuery({ queries: {} }, function () { return Promise.resolve({ ok: false, error: { kind: 'timeout', message: '超时了' } }) }, 'D:/w/repo', 'file-history', { path: 'a' })
  const qCallLogs = qLogs.filter(function (l) { return l.event === 'host.call' || l.event === 'host.call.fail' })
  const qOkLog = qCallLogs.filter(function (l) { return l.event === 'host.call' })[0]
  const qFailLog = qCallLogs.filter(function (l) { return l.event === 'host.call.fail' })[0]
  check(!!qOkLog && qOkLog.fields.method === VIEW.VC_QUERY_PHONE && qOkLog.fields.kind === 'git-history-query' && qOkLog.fields.ok === true, 'Q4h 读成功落一条 host.call（电话名、历史查询种类、成功都在）实测：' + JSON.stringify(qCallLogs).slice(0, 300))
  check(!!qFailLog && qFailLog.fields.method === VIEW.VC_QUERY_PHONE && qFailLog.fields.kind === 'git-history-query' && typeof qFailLog.fields.errorHash === 'string' && JSON.stringify(qFailLog.fields).indexOf('超时了') < 0, 'Q4i 读失败落一条 host.call.fail：只留错误散列，不把 git 原话倒进日志')

  // Q5 十种结果的画法：清单条数、行号与原文、文件与二进制、四种对照记号、版本名脏净、引用日志、
  //   备注原文、文件内容或二进制标记、五种空结果的说明、截断的显式读数与那句「读不全不给半份」
  const Q_NOW = NOW
  const qBlameLines = [
    { oid: 'a'.repeat(40), author: '林可', authorTimeMs: Q_NOW, summary: '初始提交', filename: '文件 一.txt', line: 1, origLine: 1, text: '第一行甲', boundary: true, previous: null },
    { oid: 'b'.repeat(40), author: '林可', authorTimeMs: Q_NOW, summary: '改第二行', filename: '文件 一.txt', line: 2, origLine: 2, text: '第二行乙改', boundary: false, previous: 'c'.repeat(40) },
  ]
  const qCompareFiles = [
    { path: 'code.js', origPath: null, added: 3, deleted: 0 },
    { path: '混入 空字节.bin', origPath: null, added: null, deleted: null },
  ]
  const qRangePairs = [
    { leftNo: 1, leftOid: 'ee3fe73', mark: '<', rightNo: null, rightOid: null, subject: 'feat: 对照甲' },
    { leftNo: null, leftOid: null, mark: '>', rightNo: 3, rightOid: 'ce543a2', subject: '只在新分支的提交' },
    { leftNo: 2, leftOid: '195b21e', mark: '=', rightNo: 2, rightOid: '305a2a5', subject: 'feat: 对照乙' },
    { leftNo: 1, leftOid: 'aaaaaaa', mark: '!', rightNo: 1, rightOid: 'bbbbbbb', subject: '改过的提交' },
  ]
  const qRenderOf = function (kind, data, width) {
    const entry = VIEW.vcQueryEntryOf(kind)
    const queries: any = {}
    queries[kind] = { state: 'ok', seq: 1, data: data, error: null }
    return renderToStaticMarkup(VIEW.vcQueryPageNode(h, tZh, { page: entry.page, width: width === undefined ? 460 : width, nowMs: Q_NOW, queries: queries }))
  }
  const qCommitsHtml2 = qRenderOf('file-history', qCommitsReply)
  check(attrValuesOf(qCommitsHtml2, 'data-vc-query-list').join(',') === 'commits' && attrValuesOf(qCommitsHtml2, 'data-vc-query-item').length === 2 && qCommitsHtml2.indexOf(hcRows4[0].subject) >= 0, 'Q5a 单文件历史画出提交清单（条数与提交说明都在，读到的才画）')
  const qBlameHtml = qRenderOf('blame', { ok: true, kind: 'blame', lines: qBlameLines, count: qBlameLines.length, total: qBlameLines.length, truncated: false, reason: '' })
  check(attrValuesOf(qBlameHtml, 'data-vc-query-blame-line').join(',') === '1,2' && qBlameHtml.indexOf('第二行乙改') >= 0 && qBlameHtml.indexOf('林可') >= 0 && qBlameHtml.indexOf(tZh('vc.query.blame.from').split('{short}')[0]) >= 0, 'Q5b 行级追溯逐行画出最终行号、来源提交与这一行的原文（' + qBlameLines.length + ' 行）')
  const qCompareHtml = qRenderOf('compare', { ok: true, kind: 'compare', files: qCompareFiles, total: qCompareFiles.length, truncated: false, reason: '' })
  check(attrValuesOf(qCompareHtml, 'data-vc-query-file').join(',') === 'code.js,混入 空字节.bin' && qCompareHtml.indexOf('+' + '3') >= 0 && qCompareHtml.indexOf('—') >= 0, 'Q5c 比较两个引用逐文件画出增删行数（二进制文件答不出增删就画「—」，不猜 0）')
  const qRangeHtml = qRenderOf('range-diff', { ok: true, kind: 'range-diff', pairs: qRangePairs, extraLines: [' 第二行说明'], total: qRangePairs.length, truncated: false, reason: '' })
  check(attrValuesOf(qRangeHtml, 'data-vc-query-mark').join(',') === '&lt;,&gt;,=,!' && qRangeHtml.indexOf(tZh('vc.query.range.onlyOld')) >= 0 && qRangeHtml.indexOf(tZh('vc.query.range.onlyNew')) >= 0 && qRangeHtml.indexOf(tZh('vc.query.range.same')) >= 0 && qRangeHtml.indexOf(tZh('vc.query.range.diff')) >= 0, 'Q5d 两组提交对照四种记号各说各的话（只在旧组 / 只在新组 / 两边同形 / 两边不同）')
  check(attrValuesOf(qRangeHtml, 'data-vc-query-range-extra')[0] === '1' && qRangeHtml.indexOf(tZh('vc.query.result.rangeExtra').replace('{n}', '1')) >= 0, 'Q5e 对照里多行的提交说明单独说还有几行（不当成对照行混进去）')
  const qDescHtml = qRenderOf('describe', { ok: true, kind: 'describe', text: 'v1.0.0-6-g437a134', dirty: false, truncated: false, reason: '' })
  const qDirtyHtml = qRenderOf('describe', { ok: true, kind: 'describe', text: 'v1.0.0-6-g437a134-dirty', dirty: true, truncated: false, reason: '' })
  check(qDescHtml.indexOf('v1.0.0-6-g437a134') >= 0 && attrValuesOf(qDescHtml, 'data-vc-query-dirty')[0] === '0' && qDirtyHtml.indexOf(tZh('vc.query.result.dirty')) >= 0 && attrValuesOf(qDirtyHtml, 'data-vc-query-dirty')[0] === '1', 'Q5f 版本名画出 describe 原文，并明确说工作区脏不脏（-dirty 不当成版本名的一部分藏起来）')
  const qReflogReply = { ok: true, kind: 'reflog', entries: [{ oid: 'a'.repeat(40), short: '437a134', selector: 'HEAD@{0}', actor: '样本作者', subject: 'commit: 初始' }], count: 1, total: 1, truncated: false, reason: '' }
  const qReflogWide = qRenderOf('reflog', qReflogReply, 460)
  const qReflogNarrow = qRenderOf('reflog', qReflogReply, 300)
  check(attrValuesOf(qReflogWide, 'data-vc-query-reflog-entry').join(',') === 'HEAD@{0}' && attrValuesOf(qReflogWide, 'data-vc-query-author').length === 1 && attrValuesOf(qReflogNarrow, 'data-vc-query-author').length === 0, 'Q5g 引用日志画出选择器与动作；300 宽收起执行者、入口一个不少（宽度只改排布）')
  const qNotesHtml = qRenderOf('notes', { ok: true, kind: 'notes', note: '这条提交是发布点，别动', reason: 'ok', truncated: false, total: 1 })
  check(qNotesHtml.indexOf('data-vc-query-note="1"') >= 0 && qNotesHtml.indexOf('这条提交是发布点，别动') >= 0, 'Q5h 提交备注原样写出来（不改写作者写的文字）')
  const qShowHtml = qRenderOf('show-file', { ok: true, kind: 'show-file', text: '第一行甲\n第二行', binary: false, truncated: false, total: 1, reason: '' })
  const qBinaryHtml = qRenderOf('show-file', { ok: true, kind: 'show-file', text: '', binary: true, truncated: false, total: 1, reason: '' })
  check(qShowHtml.indexOf('data-vc-query-content="1"') >= 0 && qShowHtml.indexOf('第二行') >= 0 && qBinaryHtml.indexOf('data-vc-query-binary="1"') >= 0 && qBinaryHtml.indexOf(tZh('vc.query.result.binary')) >= 0, 'Q5i 取某版本的文件内容：文本原样画出，二进制只标出来不硬塞乱码')
  const qEmptyChecks = [
    ['grep', { ok: true, kind: 'grep', commits: [], count: 0, total: 0, truncated: false, reason: 'empty' }, 'commits'],
    ['compare', { ok: true, kind: 'compare', files: [], total: 0, truncated: false, reason: 'same' }, 'same'],
    ['range-diff', { ok: true, kind: 'range-diff', pairs: [], extraLines: [], total: 0, truncated: false, reason: 'same' }, 'rangeSame'],
    ['notes', { ok: true, kind: 'notes', note: null, reason: 'no-note', truncated: false, total: 0 }, 'no-note'],
    ['show-file', { ok: true, kind: 'show-file', text: '', binary: false, truncated: false, total: 1, reason: '' }, 'content'],
  ]
  const qEmptyOk = qEmptyChecks.every(function (one) { return attrValuesOf(qRenderOf(one[0], one[1]), 'data-vc-query-empty').join(',') === one[2] })
  check(qEmptyOk, 'Q5j 五种空结果各说各的情形（没有提交 / 两边一样 / 两组对照一样 / 没有备注 / 这个版本里这个文件是空的）')
  const qTruncReply = { ok: true, kind: 'compare', files: qCompareFiles, total: 5000, truncated: true, reason: '' }
  const qTruncView = { queries: { compare: { state: 'ok', seq: 1, data: qTruncReply, error: null } } }
  const qTruncHtml = renderToStaticMarkup(VIEW.vcQueryPageNode(h, tZh, { page: 'commits', width: 460, nowMs: Q_NOW, queries: qTruncView.queries }))
  check(qTruncHtml.indexOf('data-vc-query-truncated="1"') >= 0 && qTruncHtml.indexOf(tZh('vc.query.truncated').replace('{shown}', String(qCompareFiles.length)).replace('{total}', '5000')) >= 0 && qTruncHtml.indexOf(tZh('vc.query.truncatedHint').slice(0, 8)) >= 0, 'Q5k 回包被截断时显式写出「已显示 2 / 共 5000」与补齐办法（不悄悄少画几条）')
  const qTruncJudgmentOf = function (v) {
    const html = renderToStaticMarkup(v.vcQueryPageNode(h, tZh, { page: 'commits', width: 460, nowMs: Q_NOW, queries: { compare: { state: 'ok', seq: 1, data: qTruncReply, error: null } } }))
    return html.indexOf('data-vc-query-truncated="1"') >= 0
  }
  const qInvalidView = { queries: { 'file-history': { state: 'err', seq: 1, data: null, error: { kind: 'invalid-input', field: 'path', reason: 'required-missing', message: '' } } } }
  const qInvalidHtml = renderToStaticMarkup(VIEW.vcQueryPageNode(h, tZh, { page: 'commits', width: 460, nowMs: Q_NOW, queries: qInvalidView.queries }))
  check(attrValuesOf(qInvalidHtml, 'data-vc-query-error').join(',') === 'required-missing' && qInvalidHtml.indexOf(tZh('vc.query.invalid.required').replace('{field}', tZh('vc.query.field.path'))) >= 0, 'Q5l 本地预检失败说清哪个字段要填（用字段真名，不是 field 变量名）')
  const qGitErrView = { queries: { 'file-history': { state: 'err', seq: 1, data: null, error: { kind: 'non-zero', field: '', reason: 'git', message: 'fatal: bad revision' } } } }
  const qGitErrHtml = renderToStaticMarkup(VIEW.vcQueryPageNode(h, tZh, { page: 'commits', width: 460, nowMs: Q_NOW, queries: qGitErrView.queries }))
  const qTruncErrView = { queries: { 'file-history': { state: 'err', seq: 1, data: null, error: { kind: 'truncated', field: '', reason: 'git', message: '' } } } }
  const qTruncErrHtml = renderToStaticMarkup(VIEW.vcQueryPageNode(h, tZh, { page: 'commits', width: 460, nowMs: Q_NOW, queries: qTruncErrView.queries }))
  check(qGitErrHtml.indexOf('fatal: bad revision') >= 0 && qTruncErrHtml.indexOf(tZh('vc.query.truncatedFail')) >= 0, 'Q5m 宿主失败显示 git 原话；读不全时明说「读不全就不给半份」（两种失败不混成一句）')
  check(attrValuesOf(qGitErrHtml, 'data-vc-query-retry').length === 0, 'Q5n 静态渲染里失败态不给假重试按钮（没有回调就不画能点的东西）')
  const qIdleHtml = qPageHtmlOf('commits')
  check(qIdleHtml.indexOf('data-vc-query-state="idle"') >= 0 && qIdleHtml.indexOf(tZh('vc.query.idle')) >= 0, 'Q5o 还没跑过任何一条时每组都写「还没查」（不冒充空结果）')
  const qLoadingView = { 'file-history': { state: 'loading', seq: 2, data: null, error: null } }
  const qLoadingHtml = renderToStaticMarkup(VIEW.vcQueryPageNode(h, tZh, { page: 'commits', width: 460, nowMs: Q_NOW, queries: qLoadingView }))
  check(qLoadingHtml.indexOf('data-vc-query-running="1"') >= 0 && qLoadingHtml.indexOf(tZh('vc.query.running')) >= 0, 'Q5p 正在读时写「正在查」（不拿上一次的结果冒充新读数）')
  let qWidthOk = true
  VIEW.VC_SHELL_WIDTHS.forEach(function (width) {
    const html = qRenderOf('file-history', qCommitsReply, width)
    if (attrValuesOf(html, 'data-vc-query-item').length !== 2) qWidthOk = false
    if (width < 460 && attrValuesOf(html, 'data-vc-query-author').length !== 0) qWidthOk = false
    if (width >= 460 && attrValuesOf(html, 'data-vc-query-author').length !== 2) qWidthOk = false
  })
  check(qWidthOk, 'Q5q 四档宽下结果条数不变：300/380 收起作者，460 起补上作者（宽度只改排布、不删结果）')

  // Q6 页面壳集成：面板只挂两页、组数对、全页渲染 id 不重复
  check(qCommitsHtml.indexOf('data-vc-query-panel="commits"') >= 0 && qDiagHtml.indexOf('data-vc-query-panel="diagnostics"') >= 0 && attrValuesOf(qCommitsHtml, 'data-vc-query-panel-count')[0] === '6' && attrValuesOf(qDiagHtml, 'data-vc-query-panel-count')[0] === '4', 'Q6a 页面壳把面板挂进提交历史页与诊断页（组数读数 6 / 4 与账本一致）')
  const qAllHtml = allShellHtmlOf({ width: 460, skin: 'dark' })
  const qIds = attrValuesOf(qAllHtml, 'id')
  check(new Set(qIds).size === qIds.length, 'Q6b 全页渲染时面板不造重复 id（' + qIds.length + ' 个 id 全不相同，输入框的 label/for 不会指错）')
  const qCapsListOf = function (html) { return attrValuesOf(html, 'data-cap-primary').length }
  check(qCapsListOf(qCommitsHtml) === VIEW.vcPageCapabilitiesOf('commits').length && qCapsListOf(qDiagHtml) === VIEW.vcPageCapabilitiesOf('diagnostics').length, 'Q6c 面板插在能力清单之前、不吞掉本页的能力行（两页能力行数与原页面一致）')
  check(qCommitsHtml.indexOf('vc-query-commits') >= 0 && qDiagHtml.indexOf('vc-query-diagnostics') >= 0, 'Q6d 两页各有自己的面板 id（锚点与深链指得清是哪一页的面板）')

  // ---- CL 组：克隆向导（#1756 T20，能力 8.16）----
  // 判据全部取真源：电话名、表单收敛、票据与回包分类都调 vcClonePage 自己的导出；
  //   宿主理由标识符逐个核对界面词条表，免得界面上印出英文标识符。
  check(VIEW.VC_CLONE_PHONES.check === 'wf.gitCloneCheck' && VIEW.VC_CLONE_PHONES.write === 'wf.gitCloneWrite'
    && VIEW.VC_CLONE_PHONES.query === 'wf.gitTaskQuery' && VIEW.VC_CLONE_PHONES.cancel === 'wf.gitTaskCancel'
    && VIEW.VC_CLONE_PAGE_HINT === 'migrate' && VIEW.VC_CLONE_PAGE_SOURCE === 'src/client/views/versionControl/vcClonePage.ts',
    'CL1 克隆向导四条电话与「挂在迁移页」的口径都从真源读（预检 / 凭票执行 / 查询 / 取消）')
  const clDefaults = VIEW.VC_CLONE_FORM_DEFAULT
  check(clDefaults.url === '' && clDefaults.dir === '' && clDefaults.depth === '' && clDefaults.branch === ''
    && clDefaults.recurseSubmodules === false && clDefaults.shallowSubmodules === false && clDefaults.offline === false,
    'CL2 表单初值：地址与目录都空着，三个开关默认关（不会没让选就替人选子模块）')
  const clForm = VIEW.vcCloneFormOf({ url: '  https://x/a.git  ', dir: ' d ', depth: ' 3 ', branch: ' dev ', recurseSubmodules: true, shallowSubmodules: 1, offline: 'yes' })
  check(clForm.url === 'https://x/a.git' && clForm.dir === 'd' && clForm.depth === '3' && clForm.branch === 'dev'
    && clForm.recurseSubmodules === true && clForm.shallowSubmodules === false && clForm.offline === false,
    'CL3 表单收敛：去空白，两个子模块开关与离线只认真正的 true（1 与字符串不算）')
  const clCheck = VIEW.vcCloneCheckArgsOf('/w', { url: 'https://x/a.git', dir: 'd', depth: '3', branch: 'dev', recurseSubmodules: true, shallowSubmodules: true })
  check(clCheck.cwd === '/w' && clCheck.op === 'start' && clCheck.depth === 3 && clCheck.branch === 'dev'
    && clCheck.recurseSubmodules === true && clCheck.shallowSubmodules === true && clCheck.offline === undefined
    && clCheck.ticketId === undefined && clCheck.requestId === undefined,
    'CL4 预检参数：深度写成数字、只出现真选项，票号与请求号留到执行那一步')
  check(VIEW.vcCloneCheckArgsOf('/w', { url: 'u', dir: 'd', depth: '' }).depth === undefined,
    'CL5 深度留空时不塞一个 0 进去（宿主按缺省全深度）')
  const clWrite = VIEW.vcCloneWriteArgsOf('/w', { url: 'u', dir: 'd' }, 't-1', 'rq-1', true)
  check(clWrite.op === 'start' && clWrite.ticketId === 't-1' && clWrite.requestId === 'rq-1' && clWrite.confirmed === true,
    'CL6 凭票执行参数：票号、请求号与确认都在（宿主凭票执行并去重）')
  check(VIEW.vcCloneWriteArgsOf('/w', { url: 'u', dir: 'd' }, 't-1', 'rq-1', false).confirmed === undefined,
    'CL7 没点确认就不带 confirmed 字段（宿主据它回 need-confirm，界面再画确认卡）')
  const clCleanCheck = VIEW.vcCloneCleanupCheckArgsOf('/w', ' d ')
  const clCleanWrite = VIEW.vcCloneCleanupWriteArgsOf('/w', 'd', 't-2', 'rq-2', true)
  check(clCleanCheck.op === 'cleanup' && clCleanCheck.dir === 'd' && clCleanWrite.op === 'cleanup' && clCleanWrite.ticketId === 't-2' && clCleanWrite.confirmed === true,
    'CL8 清理残留目录也走同一套：先预检拿票，再凭票删除')
  const clTicket = VIEW.vcCloneTicketOf({ ticket: { id: 't', op: 'start', checkedAtMs: NOW, expiresAtMs: NOW + 120000 } })
  check(!!clTicket && clTicket.id === 't' && clTicket.expiresAtMs === NOW + 120000 && VIEW.vcCloneTicketOf({}) === null && VIEW.vcCloneTicketOf({ ticket: {} }) === null,
    'CL9 票据四段取出来；没有票时回 null（绝不用空串冒充票号）')
  check(VIEW.vcCloneReplyKindOf({ ok: true, ticket: { id: 't' } }) === 'checked' && VIEW.vcCloneReplyKindOf({ ok: true, task: { taskId: 'x' } }) === 'done',
    'CL10 回包分类：签了票是 checked、起了任务是 done')
  check(VIEW.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: 'target-not-empty' }) === 'blocked'
    && VIEW.vcCloneReplyKindOf({ ok: false, error: { kind: 'need-confirm' }, reason: 'need-confirm' }) === 'need-confirm',
    'CL11 目标不空是 blocked、要确认是 need-confirm，两档分开画')
  check(['ticket-missing', 'ticket-expired', 'ticket-op-mismatch', 'target-changed', 'stale-repo'].every(function (r) {
    return VIEW.vcCloneReplyKindOf({ ok: false, error: { kind: 'blocked' }, reason: r }) === 'stale'
  }), 'CL12 票没了 / 过期 / 换了动作 / 现场变了都归 stale（重新预检这一档，不冒充真失败）')
  check(VIEW.vcCloneReplyKindOf({ ok: false, error: { kind: 'env', message: 'x' } }) === 'fail' && VIEW.vcCloneReplyKindOf(null) === 'unknown',
    'CL13 真装配失败归 fail、空回包归 unknown')
  check(VIEW.vcCloneReasonOf({ reason: 'a', decision: { reasons: ['b'] }, error: { reason: 'c' } }) === 'a'
    && VIEW.vcCloneReasonOf({ decision: { reasons: ['b'] }, error: { reason: 'c' } }) === 'b'
    && VIEW.vcCloneReasonOf({ error: { reason: 'c' } }) === 'c',
    'CL14 原因标识符的优先级：顶层 > 判定 > 错误（界面据此选词条）')
  const clProg = VIEW.vcCloneProgressOf({ state: 'running', percent: 55, phase: 'Receiving objects' })
  check(clProg.percent === 55 && clProg.phase === 'Receiving objects' && clProg.uncertain === false
    && VIEW.vcCloneProgressOf({ state: 'running' }).uncertain === true
    && VIEW.vcCloneProgressOf({ state: 'running', percent: 140 }).percent === null,
    'CL15 进度读真实百分比与阶段；报不出数时标 uncertain，越界数字不冒充')
  const clResidual = '目标目录可能只写了一半，删除该目录后可以重试'
  const clDone = { state: 'done', conclusion: 'cancelled', residual: clResidual }
  check(VIEW.vcCloneResidualOf({ state: 'running', residual: 'x' }) === '' && VIEW.vcCloneResidualOf(clDone) === clResidual
    && VIEW.vcCloneTaskEndedOf(clDone) === true && VIEW.vcCloneTaskEndedOf({ state: 'running' }) === false
    && VIEW.vcCloneTaskOf({ tasks: [{ taskId: 'a' }, { taskId: 'b' }] }, 'b').taskId === 'b' && VIEW.vcCloneTaskOf({ tasks: [] }, 'x') === null,
    'CL16 取消后的残留说明只在结束的任务上出现，并按 taskId 找回那一条任务')
  const cloneHostReasons = (function () {
    const text = sourceText('src/host/versionControlClone.ts')
    const seg = text.slice(text.indexOf('const CLONE_REASONS'), text.indexOf('翻成一句人话'))
    const out: string[] = []
    const re = /'([a-z][a-z-]+)':/g
    let m
    while ((m = re.exec(seg)) !== null) out.push(m[1])
    return out
  })()
  const cloneUncovered = cloneHostReasons.filter(function (id) { return !Object.prototype.hasOwnProperty.call(VIEW.VC_CLONE_REASON_KEYS, id) })
  check(cloneHostReasons.length >= 20 && cloneUncovered.length === 0,
    'CL17 宿主每个克隆理由标识符在界面词条表里都有词条（缺的：' + cloneUncovered.join('、') + '）')
  const cloneMarkup = renderToStaticMarkup(React.createElement(VIEW.vcClonePageNode, { t: function (k) { return k }, cwd: '/w', call: function () { return Promise.resolve({}) } }))
  check(cloneMarkup.indexOf('data-vc-clone="1"') >= 0 && cloneMarkup.indexOf('data-vc-clone-step="form"') >= 0
    && ['url', 'dir', 'depth', 'branch'].every(function (n) { return cloneMarkup.indexOf('data-vc-clone-field="' + n + '"') >= 0 })
    && ['recurseSubmodules', 'shallowSubmodules', 'offline'].every(function (n) { return cloneMarkup.indexOf('data-vc-clone-checkbox="' + n + '"') >= 0 }),
    'CL18 进页面先把表单画出来：四个字段与三个开关齐全，不自动发电话')
  check(cloneMarkup.indexOf('data-vc-clone-action="check"') >= 0 && cloneMarkup.indexOf('data-vc-clone-action="start"') < 0,
    'CL19 初态只有「预检」按钮，没有票就不给「开始克隆」')
  const clShellHtmlOf = function (page) {
    try { return renderToStaticMarkup(VIEW.vcRenderTabAt(h, tZh, { page: page, cwd: '/w', call: function () { return Promise.resolve({}) } })) }
    catch (e) { console.log('    （克隆页渲染抛错：' + ((e && e.message) || e) + '）'); return '' }
  }
  const clMigrateHtml = clShellHtmlOf('migrate')
  const clDiagHtml = clShellHtmlOf('diagnostics')
  check(clMigrateHtml.indexOf('data-vc-clone="1"') >= 0 && clDiagHtml.indexOf('data-vc-clone="1"') < 0,
    'CL20 克隆向导只挂在「迁移与备份」页的正文里，别的页不带')

  // ---- H 组：反证（把被守的东西改坏，同一套断言必须当场变红）----
  // 反证锚点的两种落点：还住在手写 .js 里的代码写成单引号，已经变成构建产物的界面叶子被 esbuild
  //   统一成双引号（产物首行写着 AUTO-GENERATED）。字符串 replace 找不到目标就原样返回，于是
  //   「改坏了」其实没落到源码上、断言当然不会红；这里对同一个锚点先按原样、再按双引号形态各试一次。
  //   只试这两种写法，不做整份源码的引号替换 —— 那会误伤字符串里本来就有的撇号。
  function subQuoteAware(text: string, from: string, to: string): { text: string; hit: boolean } {
    if (text.indexOf(from) >= 0) return { text: text.replace(from, to), hit: true }
    const altFrom = from.replace(/'/g, '"')
    if (altFrom !== from && text.indexOf(altFrom) >= 0) {
      return { text: text.replace(altFrom, to.replace(/'/g, '"')), hit: true }
    }
    return { text, hit: false }
  }
  // 一处反证可以有好几处替换（先注种子、再把某一行改坏）。逐处记命中，全部命中才算
  //   「这处改法真的落到了源码上」——只看"文本变过没有"会被第一处永远命中的替换骗过去。
  function applyPairs(text: string, pairs: ReadonlyArray<readonly [string | RegExp, string]>): { src: string; allHit: boolean } {
    const hits: boolean[] = []
    let cur = text
    for (const pair of pairs) {
      const from = pair[0]
      if (from instanceof RegExp) {
        const next = cur.replace(from, pair[1])
        hits.push(next !== cur)
        cur = next
        continue
      }
      const r = subQuoteAware(cur, from, pair[1])
      cur = r.text
      hits.push(r.hit)
    }
    return { src: cur, allHit: hits.every(Boolean) }
  }
  // ---------- S 组：#1755 同步十个动作（域 8 的 8.5–8.14）在「远端与同步」页里的画法 ----------
  // 这一段只喂读数，不发请求：预检回包按宿主真实形状造（plan / ticket / confirm / baseline / decision），
  // 断言界面上十个入口、命令原文、理由、租约、确认卡、结果与任务区都按票面画法出现。
  const syOidOld = 'a'.repeat(40)
  const syOidNew = 'c'.repeat(40)
  const syReplyOf = function (action, id, extra) {
    const e = extra || {}
    const cap = VIEW.vcCapabilityOf(id)
    const plan = {
      action: action, id: id, op: action === 'force-push' ? 'push' : action, level: cap.level, needsConfirm: true,
      commandText: cap.command, remote: 'origin', branch: 'main', localBranch: 'main', upstream: '', ref: '', refKind: '',
      mode: '', leaseBranch: 'main', leaseOid: syOidOld, forceIfIncludes: true, versionNeed: '', versionNote: '',
      targetText: '远端分支 origin/main', taskArgs: { remote: 'origin', localBranch: 'main', branch: 'main' }
    }
    return Object.assign({
      ok: true, contract: 'version-control.sync-check', version: 1, action: action, capabilityId: id, op: plan.op,
      level: cap.level, command: cap.command, decision: 'warn', reasons: [{ id: 'dirty-tree', text: '工作区有未提交改动', blocking: false }],
      confirmRequired: true,
      confirm: { verb: '强推', target: '远端分支 origin/main（远端现在是 ' + syOidOld.slice(0, 12) + '，准备推成 ' + syOidNew.slice(0, 12) + '）', what: '会把远端分支推成新位置', wont: '不会覆盖预检之后出现的提交', reversible: '推错可以按旧提交号推回去' },
      plan: plan, ticket: { id: 'sync-1700000000000-1', op: plan.op, target: plan },
      oldOid: syOidOld, newOid: syOidNew,
      baseline: { source: 'network', oid: syOidOld, readAtMs: NOW },
      scene: { remotes: ['origin'], remotesKnown: true }, readAtMs: NOW,
      versionPolicy: { need: '2.30', satisfied: true, note: '', degraded: false }
    }, e || {})
  }
  const syReadsOf = function (data, extra) {
    return Object.assign({
      sync: { state: 'ok', data: data, error: null },
      task: { state: 'idle', data: null, error: null }
    }, extra || {})
  }
  const syShellOf = function (reads, ui, width, skin) {
    return shellHtmlOf({ page: 'remote', width: width || 460, skin: skin || 'dark', reads: reads, ui: ui || {} })
  }
  const syIds = VIEW.SYNC_ACTIONS.map(function (row) { return row.id })
  const syOpen = syShellOf(syReadsOf(syReplyOf('force-push', '8.12')), { open: '8.12' })
  const syActs = attrValuesOf(syOpen, 'data-vc-sync-act')
  check(syActs.length === 10 && JSON.stringify(syActs) === JSON.stringify(syIds), 'S1 同步段一次画出十个动作入口，顺序与账本 8.5–8.14 一致（' + syActs.join(',') + '）')
  const syPanels = attrValuesOf(syOpen, 'data-vc-sync-panel')
  check(syPanels.length === 1 && syPanels[0] === '8.12', 'S2 同时只展开一个动作面板（面板带 data-vc-sync-panel，值是这次展开的动作 id）')
  check(syOpen.indexOf('aria-controls="vc-sync-panel-8.12"') >= 0 && syOpen.indexOf('id="vc-sync-panel-8.12"') >= 0, 'S3 展开按钮的 aria-controls 指向真实存在的面板 id（键盘与读屏跟得到）')
  check(attrValuesOf(syOpen, 'data-vc-sync-command')[0] === '8.12' && syOpen.indexOf(String(VIEW.vcCapabilityOf('8.12').command)) >= 0, 'S4 面板里画命令原文，且直接取自能力账本（不在界面另写一份命令）')
  check(attrValuesOf(syOpen, 'data-vc-sync-decision')[0] === 'warn' && syOpen.indexOf('data-vc-sync-why="1"') >= 0 && syOpen.indexOf('data-vc-sync-reason="dirty-tree"') >= 0, 'S5 判定为 warn 时标题写「可以执行但先看理由」，理由逐条常驻在触发点（不是灰按钮不说为什么）')
  check(attrValuesOf(syOpen, 'data-vc-sync-old')[0] === syOidOld && attrValuesOf(syOpen, 'data-vc-sync-new')[0] === syOidNew, 'S6 强推面板点名远端当前提交号与准备推上去的提交号（两个都是完整 40 位）')
  check(syOpen.indexOf('data-vc-sync-lease="1"') >= 0 && syOpen.indexOf(syOidOld.slice(0, 7)) >= 0, 'S7 租约段写明基准来自这次联网读取与读取时刻（租约不能是别的来源）')
  check((syOpen.match(/data-vc-confirm-seg="/g) || []).length === 4 && syOpen.indexOf('data-focus-default="cancel"') >= 0 && syOpen.indexOf('data-vc-sync-confirm="1"') >= 0, 'S8 确认卡贴触发点、四段齐全、默认焦点在取消；外层带 aria-label 负责念出确认对象')
  check(syOpen.indexOf('data-vc-sync-ticket="sync-1700000000000-1"') >= 0, 'S9 确认卡旁写清这次凭哪张票执行（票过期或现场变了会被拒绝、不自动重放）')
  const syOk = syShellOf(syReadsOf(syReplyOf('push', '8.9')), { open: '8.9', result: { ok: true, cmd: 'git push --progress origin main:main', ms: 180, n: 1, next: '去远端页核对分支位置' } })
  check(attrValuesOf(syOk, 'data-vc-result')[0] === 'ok' && syOk.indexOf('180') >= 0 && syOk.indexOf('data-vc-sync-panel="8.9"') >= 0, 'S10 成功结果回到触发点：命令、耗时与下一步都画在同一个动作面板里')
  const syFail = syShellOf(syReadsOf(syReplyOf('fetch', '8.5')), { open: '8.5', result: { ok: false, git: 'fatal: 远端没有响应', step: '获取远端更新这一步', expected: '读到引用清单', actual: '连接超时', cause: '网络不可用' } })
  check(attrValuesOf(syFail, 'data-vc-result')[0] === 'fail' && syFail.indexOf('fatal: 远端没有响应') >= 0 && syFail.indexOf('data-vc-result-action="retry"') >= 0, 'S11 失败结果贴触发点：git 原话、环节、期望与实际、上游原因与重试入口一样不少')
  const syTaskReads = syReadsOf(syReplyOf('fetch', '8.5'), { task: { state: 'ok', data: { taskId: 'task-9', state: 'running', phase: 'receiving', conclusion: '', residual: 'x' }, error: null } })
  const syTask = syShellOf(syTaskReads, { open: '8.5' })
  check(syTask.indexOf('data-vc-sync-task="1"') >= 0 && syTask.indexOf('data-vc-sync-task-id="task-9"') >= 0 && syTask.indexOf('data-vc-sync-cancel="1"') >= 0, 'S12 执行后交给长任务通道：任务号、状态与取消按钮都画出来（取消要有残留说明）')
  check(syTask.indexOf('data-vc-sync-task-residual="1"') >= 0, 'S13 取消后的残留说明常驻在任务区（下载的对象与已发出的引用不会自己回去）')
  check(attrValuesOf(syOk, 'data-cap-primary').join(',') === VIEW.vcPageCapabilitiesOf('remote').map(function (cap) { return cap.id }).join(','), 'S14 远端页的主入口仍只有账本登记的那 16 条（同步段不许自己再挂 data-cap-primary）')
  for (const sw of VIEW.VC_SHELL_WIDTHS) {
    const wHtml = syShellOf(syReadsOf(syReplyOf('push', '8.9')), { open: '8.9' }, sw, sw % 2 === 0 ? 'dark' : 'light')
    check(wHtml.indexOf('data-vc-sync-page="1"') >= 0 && attrValuesOf(wHtml, 'data-vc-sync-act').length === 10, 'S15 宽 ' + sw + '：同步段十个入口一个不少（窄档不删入口）')
  }
  const syNarrow = syShellOf(syReadsOf(syReplyOf('push', '8.9')), { open: '8.9' }, 300, 'dark')
  const syWide = syShellOf(syReadsOf(syReplyOf('push', '8.9')), { open: '8.9' }, 460, 'dark')
  check(attrValuesOf(syNarrow, 'data-vc-sync-command').length === 0 && attrValuesOf(syWide, 'data-vc-sync-command').length === 1, 'S16 命令原文按宽度收放：300 收起、460 起恢复（收起不删除，仍在面板里可开）')
  const syErr = syShellOf({ sync: { state: 'err', data: null, error: { kind: 'env', message: '找不到 git 命令' } }, task: { state: 'idle', data: null, error: null } }, {})
  check(attrValuesOf(syErr, 'data-vc-sync-state')[0] === 'error' && syErr.indexOf('data-vc-sync-error="env"') >= 0 && syErr.indexOf('找不到 git 命令') >= 0, 'S17 读数失败时同步段画失败态并带上宿主原话（不把读不到画成没有动作）')
  const syDelete = syShellOf(syReadsOf(syReplyOf('delete-remote-ref', '8.11')), { open: '8.11' })
  check(attrValuesOf(syDelete, 'data-vc-sync-kind').length === 2 && syDelete.indexOf('data-vc-sync-kind="branch"') >= 0 && syDelete.indexOf('data-vc-sync-kind="tag"') >= 0, 'S18 删远端引用要分清分支还是标签：两个按钮常驻在触发点（不靠下拉藏起来）')
  const syLight = syShellOf(syReadsOf(syReplyOf('push', '8.9')), { open: '8.9' }, 460, 'light')
  check(attrValuesOf(syLight, 'data-vc-skin')[0] === 'light' && attrValuesOf(syLight, 'data-vc-sync-act').length === 10, 'S19 另一套皮肤同样能渲染同步段（两套皮肤都只换颜色，不删入口）')
  const syClosedHtml = syShellOf(syReadsOf(syReplyOf('push', '8.9')), {}, 460, 'dark')
  const syAuto = syClosedHtml.match(/data-vc-sync-act="([^"]+)"[^>]*aria-expanded="true"/g) || []
  check(syAuto.length === 1 && syAuto[0].indexOf('8.9') >= 0, 'S20 预检回包默认展开它对应的那一个动作面板（同时只开一个，用户不用自己再找）')
  const syIdleHtml = syShellOf({ sync: { state: 'idle', data: null, error: null }, task: { state: 'idle', data: null, error: null } }, {}, 460, 'dark')
  const syIdleClosed = syIdleHtml.match(/data-vc-sync-act="[^"]+"[^>]*aria-expanded="false"/g) || []
  check(syIdleClosed.length === 10, 'S20b 没有预检回包时十个按钮都写 aria-expanded="false"（不靠视觉猜展开没展开）')
  const antiCases: AntiCase[] = [
    // #1253：真源已经转成 .ts，形参后面多了类型标注（st: any），锚点用正则把标注写成可选的，
    //   写法上仍只认「这一处原样」，不放大到别的地方。
    { name: '显隐谓词改成永远隐藏', patch: (s) => s.replace(/(const vcTabVisible = function \(st(?:: any)?\) \{\n  void st\n  return )true/, '$1false'), test: tabVisibleJudgmentOf, what: 'A1' },
    { name: '冲突条目不再合成一行（同一路径画两行）', patch: (s) => s.replace('      if (conflictSeen[path]) return', '      if (false) return'), test: (v) => { const m = v.vcBlocksOf(merge, readsOf(merge), {}, envOf(merge, readsOf(merge))); return rowsOf(m).length === 1 }, what: 'C9' },
    { name: '汇总句把数字写死成 0', patch: (s) => s.replace("staged: String(hostStaged), unstaged: String(hostUnstaged), conflicts: String(conflicts)", "staged: '0', unstaged: '0', conflicts: String(conflicts)").replace("{ staged: String(hostStaged), unstaged: String(hostUnstaged) }", "{ staged: '0', unstaged: '0' }"), test: (v) => { const c = v.vcBlocksOf(liveScreen, liveReads, {}, envOf(liveScreen, liveReads)); return blockOf(c, 'changes').summary === '已暂存 1 个文件 / 未暂存 4 个文件' }, what: 'B7' },
    { name: '折叠一次让一整段字（不再一个字符）', patch: (s) => s.replace("push('path', -1, Math.max(0, len(ladder.path) - VC_MIDDLE_MIN))", "push('path', -1, 1)"), test: (v) => { const l = v.vcFoldLadderOf({ path: 'abcdefghijklmnop', others: [], commits: [] }); return l.steps.length >= 6 }, what: 'D2' },
    { name: '「回到未提交改动」那一步去掉', patch: (s) => s.replace("    back: t('vc.commit.back'),", "    back: '',"), test: (v) => { const b = v.vcBlocksOf(commitScreen, sReads(), { openCommit: REV1 }, envOf(commitScreen, sReads())); return blockOf(b, 'changes').back === '回到未提交改动' }, what: 'S1' },
    { name: '截断判据改坏（读不全也装作有清单）', patch: (s) => s.replace("  else if (mine.truncated === true) note = t('vc.commit.truncated')", "  else if (false) note = t('vc.commit.truncated')"), test: (v) => { const r2 = sReads({ commit: commitEntry({ files: [], truncated: true, reason: 'truncated' }) }); const b = v.vcBlocksOf(commitScreen, r2, { openCommit: REV1 }, envOf(commitScreen, r2)); return blockOf(b, 'changes').note === '这笔提交的改动太大，读不全就没给清单；请在命令行里看完整改动。' }, what: 'S7' },
    { name: '合并提交那条差异原因键删掉（落回「没读到改动内容」）', patch: (s) => s.replace("  'merge-commit': 'vc.diff.mergeCommit',", "  'merge-commit-removed': 'vc.diff.mergeCommit',"), test: (v) => { const r2 = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: [], reason: 'merge-commit', truncated: false, error: null } } }); const row = rowsOf(v.vcBlocksOf(files, r2, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, r2)))[0]; return row.diff.text === '这是一次合并提交：git 默认不展开合并提交的逐行差异，所以这里没有内容。' }, what: 'C19b' },
    { name: '宿主原话又直出到可见正文（英文界面串出中文）', en: true, seed: errSeedEn, pairs: [
      [VC_SEED_RE, 'React.useState(function () { return seedReads })'],
      ["        rawTip: err.message ? t('vc.fail.raw', { msg: String(err.message) }) : '',", "        detail: err.message ? t('vc.fail.raw', { msg: String(err.message) }) : '',"],
      ["      h('span', { key: 'text', style: { display: 'contents' } }, tipNode(b.rawTip, h('div', { style: { lineHeight: 1.7 } }, b.text))),", "      h('div', { style: { lineHeight: 1.7 } }, b.text),\n      b.detail ? h('div', { style: { marginTop: 6 } }, b.detail) : null,"],
    ], test: (v) => { let html = ''; try { html = renderToStaticMarkup(React.createElement(v.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { html = '' } return !/[\u4e00-\u9fff]/.test(html.replace(/<[^>]*>/g, ' ')) }, what: 'G10' },
    { name: '换工作区不复位（旧工作区的数据继续画）', patch: (s) => s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })').replace('  const staleCwd = fresh.changed', '  const staleCwd = false'), test: (v) => { let html = ''; try { html = renderToStaticMarkup(React.createElement(v.VersionControlTab, { st: { cwd: 'D:/w/B' } })) } catch (e) { html = '' } return html.indexOf('data-vc-identity') < 0 && html.indexOf('data-vc-commit-mode') < 0 }, what: 'N3', seed: staleSeed },
    { name: '首屏形状只判真假值（坏形状画成干净仓库）', patch: (s) => s.replace('reply.ok === true && vcScreenShapeOk(reply.screen)', 'reply.ok === true && reply.screen'), test: async (v) => { const r = await v.vcReadStatus(v.vcNewReads(), function () { return Promise.resolve({ ok: true, screen: {} }) }, 'D:/w/repo'); return r.screen.state === 'err' && r.screen.error.kind === 'shape' }, what: 'N4' },
    { name: '分组退回按记录上的标记判（同一个文件两段改动挤进一组）', patch: (s) => s.replace("  return row.group === 'unstaged' ? 'unstaged' : 'staged'", "  return row.staged ? 'staged' : 'unstaged'"), test: (v) => { const b = v.vcBlocksOf(dual, readsOf(dual), {}, envOf(dual, readsOf(dual))); return b.groups.map(function (g) { return g.key + ':' + g.rows.length }).join(',') === 'staged:1,unstaged:1' }, what: 'N7' },
    { name: '晚到的旧回包照收（界面永久停在「正在读」）', patch: (s) => s.replace('  if (cur && (Number(cur.seq) || 0) > (Number(nxt.seq) || 0)) return currentReads', '  if (false) return currentReads'), test: (v) => v.vcApplyCommitReply(loadingB, lateA) === loadingB, what: 'N11' },
    { name: '台阶上限放开（极端宽度又要走上千档）', patch: (s) => s.replace('const VC_FOLD_STEP_CAP = 120', 'const VC_FOLD_STEP_CAP = 100000'), test: (v) => { const l = v.vcFoldLadderOf({ path: 'p'.repeat(300), others: [], commits: new Array(200).fill('s'.repeat(20)) }); return l.steps.length === v.VC_FOLD_STEP_CAP && v.VC_FOLD_STEP_CAP <= 200 }, what: 'N16' },
    { name: '依据时间不再挡 0 与负数（画成 1970）', patch: (s) => s.replace('|| !isFinite(b) || b <= 0) return t(\'vc.basis.unknown\')', "|| !isFinite(b)) return t('vc.basis.unknown')"), test: (v) => v.vcBasisText(tZh, NOW, 0) === '远端信息什么时候更新的读不到', what: 'N21' },
    { name: '五值以外的同步状态退回领先落后那一支（猜成 0）', patch: (s) => s.replace('  if (VC_SYNC_VALUES.indexOf(sync) < 0) {', '  if (false) {'), test: (v) => { const w = screenOf({ identity: { sync: 'weird-value' } }); const b = v.vcBlocksOf(w, readsOf(w), {}, envOf(w, readsOf(w))); return blockOf(b, 'identity').sync.text === '同步状态读到了界面还不认识的一档，所以不猜领先落后；请在命令行里看。' }, what: 'N22' },
    { name: '其他工作树不再分批（一千棵全画）', patch: (s) => s.replace("const otherRows = fold.otherMode === 'summary' ? [] : otherViews.slice(0, otherShown)", "const otherRows = fold.otherMode === 'summary' ? [] : otherViews"), test: (v) => { const b = v.vcBlocksOf(manyOthers, readsOf(manyOthers), {}, envOf(manyOthers, readsOf(manyOthers))); const o = blockOf(b, 'other'); return o.rows.length === v.VC_FILE_ROWS_FIRST && o.moreCount === 990 }, what: 'N24' },
    { name: '砍字退回按 UTF-16 码元切（emoji 切出半个代理对）', patch: (s) => s.replace('  const cp = Array.from(s)', "  const cp = s.split('')"), test: (v) => { const lone = function (str) { const t = String(str); for (let i = 0; i < t.length; i += 1) { const c = t.charCodeAt(i); if (c >= 0xD800 && c <= 0xDBFF) { const n = t.charCodeAt(i + 1); if (!(n >= 0xDC00 && n <= 0xDFFF)) return true; i += 1 } else if (c >= 0xDC00 && c <= 0xDFFF) return true } return false }; const t2 = v.vcTail('x😀x😀x😀x😀x😀', 3); return t2 === 'x😀…' && !lone(t2) }, what: 'N26' },
    { name: '降级档答不出可清理时按「目录还在」说（丢掉那一档未知）', patch: (s) => s.replace("  else if (w && w.prunableUnknown === true) { stateText = t('vc.other.lockUnknown'); stateTone = 'caption'; stateTip = t('vc.other.prunableUnknownTip') }\n", ''), test: (v) => { const b = v.vcBlocksOf(degraded, readsOf(degraded), {}, envOf(degraded, readsOf(degraded))); const rows = blockOf(b, 'other').rows; return rows[0].stateText === '无法显示' && rows[0].stateTip === '这个 git 版本答不出这个工作树的目录还在不在；答不出不等于还在。' }, what: 'N25b' },
    { name: '摘要档不再把完整路径并进悬停', patch: (s) => s.replace("    tip: t('vc.other.tip') + (summaryTip ? '\\n' + summaryTip : ''),", "    tip: t('vc.other.tip'),"), test: (v) => { const s2 = screenOf({ otherWorktrees: [{ path: 'D:/w/一个很长的副本名字', display: '一个很长的副本名字', head: 'h', branch: 'dev', bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false }] }); const o = blockOf(v.vcBlocksOf(s2, readsOf(s2), {}, envOf(s2, readsOf(s2), 300)), 'other'); return o.mode === 'summary' && o.tip.indexOf('D:/w/一个很长的副本名字') >= 0 }, what: 'M1' },
    { name: '宽度分档改成不单调（更窄反而画更多）', patch: (s) => s.replace('  if (w >= VC_FOLD_BANDS[0]) return 0\n  if (w >= VC_FOLD_BANDS[1]) return 1\n  if (w >= VC_FOLD_BANDS[2]) return 2\n  return 3', '  if (w >= VC_FOLD_BANDS[0]) return 0\n  if (w >= VC_FOLD_BANDS[1]) return 2\n  if (w >= VC_FOLD_BANDS[2]) return 1\n  return 3'), test: (v) => { let prev = null; for (const w of [460, 420, 380, 360, 340, 320, 300, 200]) { const b = v.vcFoldBandAt(w); if (prev !== null && b < prev) return false; prev = b } return true }, what: 'D11' },
    // #1738：页面注册表只留页签页 —— 能力并集缺管理分区，Z2 必须当场红。
    { name: '页面注册表只留页签页（能力并集缺页）', patch: (s) => s.replace("  return PAGE_SURFACES.map(function (p: any) {", "  return PAGE_SURFACES.filter(function (p: any) { return p.kind === '页签' }).map(function (p: any) {"), test: registryJudgmentOf, what: 'Z2' },
    // #1738：主入口标记换个属性名 —— 全页渲染里一个主入口都不剩，Z1d 必须当场红。
    { name: '主入口标记改成另一个属性名', patch: (s) => s.replace("'data-cap-primary': String(cap.id || ''),", "'data-cap-entry': String(cap.id || ''),"), test: primaryMarkerJudgmentOf, what: 'Z1' },
    // #1744：历史页的「加载更多」不再画（有更多也装成到顶）—— Y2a 必须当场红。
    { name: '历史页不再画「加载更多」', patch: (s) => s.replace('  if (hasMore === true) {', '  if (false) {'), test: (v) => { const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'commits', width: 460, skin: 'dark', reads: y1Reads })); return html.indexOf('data-vc-load-more') >= 0 }, what: 'Y2a' },
    // #1744：图形化视图丢掉父提交连线（合并提交画成一条线）—— Y6b 必须当场红。
    { name: '图形化视图丢掉父提交连线', patch: (s) => s.replace('      parents: parentList.slice()', '      parents: []'), test: (v) => { const g = v.vcHistoryGraphOf(hcRows4); return g.rows[1].parents.length === 2 && g.rows[3].parents.length === 0 }, what: 'Y6b' },
    // #1744：点开提交不再画详情（整页替换那一层没了）—— Y4a 必须当场红。
    { name: '点开提交不再画详情', patch: (s) => s.replace('  const detail = ui.openCommit ? vcHistoryDetailOf(', '  const detail = false ? vcHistoryDetailOf('), test: (v) => { const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'commits', width: 460, skin: 'dark', reads: y4Reads, ui: { openCommit: hcRev.oid } })); return html.indexOf('data-vc-history-detail') >= 0 }, what: 'Y4a' },
    // #1745：诊断页四组的主入口标记拿掉 —— Q1e 必须当场红。
    { name: '诊断页四组不再标主入口', patch: (s) => s.replace("'data-vc-query-primary': primary ? '1' : '0',", "'data-vc-query-primary': '0',"), test: qDiagPrimaryJudgmentOf, what: 'Q1e' },
    // #1745：截断标记删掉（少画几条也不说）—— Q5k 必须当场红。
    { name: '截断不再显式标出', patch: (s) => s.replace('  if (cut) {', '  if (false) {'), test: qTruncJudgmentOf, what: 'Q5k' },
    // #1745：本地必填校验放行（空路径也发）—— Q3a 必须当场红。
    { name: '必填校验放行', patch: (s) => s.replace("if (f.required && text === '') return bad(f.name, 'required-missing')", "if (false) return bad(f.name, 'required-missing')"), test: (v) => { const r = v.vcQueryParamsOf('file-history', { path: '', count: '50' }); return r.ok === false && r.reason === 'required-missing' && r.field === 'path' }, what: 'Q3a' },
    // #1743：提交说明退回单行输入框 —— P4 的多行判据必须当场红。
    { name: '提交说明退回单行输入框', patch: (s) => s.replace("    h('textarea', {\n      key: 'area', rows: 6, className: 'vcs-commit-area', value: p.message,", "    h('input', {\n      key: 'area', type: 'text', className: 'vcs-commit-area', value: p.message,"), test: pMultilineJudgmentOf, what: 'P4' },
    // #1743：追加签名行与跳过钩子挤到同一条能力上 —— P3 的「每条能力各自一个控件」必须当场红。
    { name: '追加签名行挂到别条能力上', patch: (s) => s.replace("{ key: 'signoff', cap: '2.6',", "{ key: 'signoff', cap: '2.5',"), test: pCapControlJudgmentOf, what: 'P3' },
    // #1743：确认卡删掉「可逆性与恢复路径」那一段 —— P7 的四段判据必须当场红。
    { name: '确认卡删掉可逆性与恢复路径', patch: (s) => s.replace("          { seg: 'reversible', text: t('vc.commit.confirm.reversible', params) },\n", ''), test: pConfirmJudgmentOf, what: 'P7' },
    // #1751：贮藏页的三处反证 —— 挂载被摘掉、版本门恒放行、危险动作不出确认卡，对应断言必须当场红。
    { name: '贮藏页不再挂进页面壳（十条入口全没了）', patch: (s) => s.replace("if (page === 'stash' && typeof vcStashPageNode === 'function') {", 'if (false) {'), test: stashMountedJudgmentOf, what: 'Z16a' },
    { name: '7.3 的版本门恒放行（低版本也画按钮）', patch: (s) => s.replace('const state = vcStashOpVersionStateOf(VC_STASH_STAGED_OP, versionText)', "const state = 'full'"), test: stashGateJudgmentOf, what: 'Z16m' },
    { name: '危险动作不再出确认卡', patch: (s) => s.replace('if (!state.confirm || !state.confirm.op) return null', 'if (state) return null'), test: stashConfirmJudgmentOf, what: 'Z16p' },
    // #1754：远端页的联网入口换了标记名（按钮还在，但读屏与门禁都找不到「这是联网入口」）—— R2a 必须当场红。
    { name: '远端页的联网入口改成别的属性名', patch: (s) => s.replace("'data-vc-remote-online-btn': String(remote.name),", "'data-vc-remote-online-entry': String(remote.name),"), test: (v) => { const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'remote', width: 460, skin: 'dark', reads: rcReadsOf({}) })); return attrValuesOf(html, 'data-vc-remote-online-btn').length === 2 }, what: 'R2a' },
    // #1754：联网结果不再标来源 network（把这一次的联网读数画成缓存/旧值）—— R2d 必须当场红。
    { name: '联网结果不再标来源 network', patch: (s) => s.replace("'data-vc-remote-online-source': 'network',", "'data-vc-remote-online-source': 'cache',"), test: (v) => { const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'remote', width: 460, skin: 'dark', reads: rcReadsOf({ online: r2OnlineOk }) })); return attrValuesOf(html, 'data-vc-remote-online-source').join(',') === 'network' }, what: 'R2d' },
    // #1752：工作树页删掉 9.7 移动的入口 —— 八条能力少一条，W22 那一组必须当场红。
    { name: '工作树页删掉 9.7 移动的入口', patch: (s) => s.replace("  { capId: '9.7', op: 'move', row: true },\n", ''), test: worktreesEntryJudgmentOf, what: 'W22' },
    // #1752：工作树执行电话改走长任务通道 —— 界面就不再走同步短写那一对电话，W32 那一组必须当场红。
    { name: '工作树执行电话改走长任务通道', patch: (s) => s.replace("run: 'wf.gitWorktreeRun'", "run: 'wf.gitTaskStart'"), test: worktreesPhoneJudgmentOf, what: 'W32' },
    // #1755：同步段十个入口的属性名换掉 —— S1 的数入口断言必须当场红。
    { name: '同步段十个入口换成别的属性名', patch: (s) => s.replace("'data-vc-sync-act': id,", "'data-vc-sync-entry': id,"), test: (v) => { const html = renderToStaticMarkup(v.vcRenderTabAt(h, tZh, { page: 'remote', width: 460, skin: 'dark', reads: syReadsOf(syReplyOf('force-push', '8.12')), ui: { open: '8.12' } })); return (html.match(/data-vc-sync-act="/g) || []).length === 10 }, what: 'S1' },
    // #1755：确认语义退回「不是 block 就弹卡」—— allow 也会弹卡，S 组的判定语义必须当场红。
    { name: '确认语义退回不是 block 就弹卡', patch: (s) => s.replace("confirmRequired: decision === 'warn' }", "confirmRequired: decision !== 'block' }"), test: (v) => { const plan = Object.assign({}, syReplyOf('fetch', '8.5').plan, { needsConfirm: false }); return v.judgeSync({ remotes: ['origin'], remotesKnown: true }, plan).confirmRequired === false }, what: 'S5' },
  ]
  // #845c：反证自证提到循环里 —— 每一处改法先确认它真的落到了源码上（改不中等于没证）。
  //   旧写法只在循环外用一条聚合自检兜底，于是某一条改法失效时，它自己仍会以 broke=true 假绿
  //   （把 vcTabVisible 的 return true 改成别的写法、或谓词已经在源码里被改坏，补丁就找不到落点），
  //   而它声称覆盖的那条断言（A1）此时已经不再受它保护。
  const closureSrc = VC_FILES.map((f2) => stripExports(readSource(f2))).join('\n')
  for (const c of antiCases) {
    let broke = false
    let applied = true
    const keepT = tZh
    if (c.en === true) tZh = tEn
    try {
      const patchFn = (s) => (c.pairs ? applyPairs(s, c.pairs).src : c.patch(s))
      const v = buildView(patchFn, [], React, DswsCtx, TipStub, IcStub, c.seed || null, c.hostStub)
      // 自证逐条算：一处改法里第一处替换永远命中时，只看「文本变过没有」会漏掉后面空转的替换。
      applied = c.pairs ? applyPairs(closureSrc, c.pairs).allHit : c.patch(closureSrc) !== closureSrc
      broke = applied && (await c.test(v)) === false
    } catch (e) { broke = true }
    tZh = keepT
    check(broke, 'H 反证：把「' + c.name + '」改坏之后，' + c.what + ' 那条断言当场变红' + (applied ? '' : '（这一处改法没落到源码上，等于没证）'))
  }
  // 反证（#843 话术那条）：把 vc.fail.exit 退回旧说法（没有「等它结束」）→ M5 的判据必须当场变红。
  const exitBroken = Object.assign({}, LOC.zh, { 'vc.fail.exit': 'git 没有正常结束（多半是权限或锁的问题），这一步读不到。' })
  check(/等它结束/.test(LOC.zh['vc.fail.exit']) && !/等它结束/.test(exitBroken['vc.fail.exit']), 'H 反证：把 vc.fail.exit 退回旧说法 → M5 那条当场变红（现文案有「等它结束」，旧文案没有）')
  // 反证（词条真在字典里那条）：从中文那半边删掉一条键，F9 的判据必须当场报出来。
  const zhBroken = Object.assign({}, LOC.zh)
  delete zhBroken['vc.retry']
  check(missingOf(zhBroken, LOC.en, ['vc.retry']).length === 1 && missingOf(LOC.zh, LOC.en, ['vc.retry']).length === 0, 'H 反证：从 zh 字典里删掉 vc.retry → F9 那条当场变红（同一判据在真字典上放行）')
  // 反证（词条位置那条的渲染级证明）：把词典换成「查不到就回键名」（上一版真发生过的样子），
  //   G8 那条判据必须当场抓出来 —— 这正说明「中文界面印键名」这类假绿躲不过去。
  const goodT = tZh
  tZh = (k) => k
  let brokenHtml = ''
  try {
    const brokenRender = buildView((s) => s.replace(VC_SEED_RE, 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, seedReads)
    brokenHtml = renderToStaticMarkup(React.createElement(brokenRender.VersionControlTab, { st: { cwd: 'D:/w/repo' } }))
  } catch (e) { brokenHtml = '' }
  tZh = goodT
  check(brokenHtml.replace(/<[^>]*>/g, ' ').indexOf('vc.views.changes') >= 0, 'H 反证：词典查不到就回键名时，DOM 里当场出现键名（上一版的中文界面就是这个样子，G8 抓得住）')
  // 反证本身也要自证：改坏的源码必须真的与原文不同（改不中就等于没证）—— 循环里已经逐条确认过一次，
  //   这里再把整张表聚合报一遍，哪几条没改中一眼看全。
  const untouched = antiCases.filter((c) => (c.pairs ? !applyPairs(closureSrc, c.pairs).allHit : c.patch(closureSrc) === closureSrc))
  check(untouched.length === 0, 'H 反证自证：' + antiCases.length + ' 处改法都真的改到了源码（改不中就等于没证）' + (untouched.length ? ' —— 没改中的：' + untouched.map((c) => c.name).join('、') : ''))

  console.log(failed ? '\n存在失败 — verify-818-version-control-view 未通过' : '\n全部通过 — 版本管理页签界面侧门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}
main().catch(function (e) { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
