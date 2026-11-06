// tests/verify-842-version-control-write-view.js — 版本管理「写操作」界面门禁（#842 落地）
// 用法：在插件根目录执行 node tests/verify-842-version-control-write-view.ts，可独立运行。
//
// 这份门禁守的是「用户点得完、看得懂」那一半：写操作的五个动作（add / 提交 / 拉取 / 更新 / 推送）落点对不对、
//   禁用态读的是不是核心判定、三个确认框有没有点名目标、五族失败话术能不能照着做、执行中会不会把读数弄假。
// 写法照 tests/verify-818-version-control-view.ts 的先例：把叶子按 build.mts 的次序拼成真闭包再跑，
//   词条读真字典（locale-panel / locale-flow / locale-vcwrite），断言落在模型与真渲染出来的 DOM 上。
//
// A–M 组；M 组是性能（竞态 / 工作区污染 / 缓存上限 / 同键在途不重复发），每项正反两面。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { compileFn } = require('./lib/eval-probe.js')
// 中央时间真值：相对时间窗口只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
const centralTime = require('../src/shared/time-config/values.js')
// 2026-10-17：locale-flow.js 的界面文案改成按中央时间参数现算（提交 2d0a3f85）之后，闭包里会用到
// SETTINGS_DEBUG_PUSH_WAIT_MS 等好几个常量；只预埋一个已经不够，改成把 values.js 里的数值导出整批挂到
// globalThis 上（ESM 裸标识符回落全局），以后再有新常量进来也不会当场 ReferenceError。
for (const [k, v] of Object.entries(centralTime)) {
  if (typeof v === 'number' && globalThis[k] === undefined) globalThis[k] = v
}
// #1236：版本管理样式叶子里的动效时长读 kernel/motion.ts 的 MOTION；compileFn 的自由变量落回 globalThis。
globalThis.MOTION = require('../src/client/kernel/motion.ts').MOTION
// 中央 import 在 compileFn 函数体里非法，求值前整行剥掉（闭包里它由时间片段提供，门禁里走上面的全局预埋）。
const stripTimeConfigImport = (s: string): string => s.split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// #1253：这些界面叶子已经从手写 .js 转成 .ts 真源。求值与反证都基于「真源原文」：
//   先拼原文、再按反证要求改坏，最后按构建同一份转译参数转成 JavaScript 交给 compileFn。
//   为什么不读产物 .js：产物被 esbuild 重排过（双引号、function 后面不留空格、句末补分号），
//   而反证锚点是按原文写的，读产物就会「改不中」，等于没证——#1253 收口时这里正是这样红的。
const { sourceText, sourcePath } = require('./lib/source-text.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
const readSource = (rel: string): string => (fs.existsSync(path.join(ROOT, rel.replace(/\.js$/, '.ts'))) ? sourceText(rel) : read(rel))
// 转译口径复用构建那一份（scripts/lib/transpile-unit.mts 的 TRANSPILE_OPTIONS），不在这里写第二套参数。
const toEvalJs = (code: string): string => require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code
// 反证与注种的锚点有两种落点：还住在手写 .js 里的代码写成单引号，已经变成构建产物的界面叶子被
//   esbuild 统一成双引号（产物首行写着 AUTO-GENERATED）。字符串 replace 找不到目标就原样返回，于是
//   「改坏了」其实没落到源码上、断言当然不会红；这个包装先按原样、再按双引号形态各试一次。只试这两种
//   写法，不做整份源码的引号替换 —— 那会误伤字符串里本来就有的撇号。
const subQ = function (from: string, to: string): (s: string) => string {
  return function (s: string): string {
    if (s.indexOf(from) >= 0) return s.replace(from, to)
    const altFrom = from.replace(/'/g, '"')
    if (altFrom !== from && s.indexOf(altFrom) >= 0) return s.replace(altFrom, to.replace(/'/g, '"'))
    return s
  }
}
const NOW = Date.parse('2026-10-04T03:00:00+08:00')

// ---------- 界面侧闭包：照 scripts/build.mts 的做法把叶子拼起来再跑 ----------
const VC_FILES = [
  // #842：判定真源（界面按它画按钮状态，不自己算）与写操作那五个新叶子也拼进这个闭包 ——
  //   入口组件 VersionControlTab.js 会调它们，缺一个就会在渲染那一帧抛错（G 组抓的就是这个）。
  // 2026-10-19 第三阶段起共享层产物搬出源码树（域产物落在 .build/shared/ 下），
  // 拼闭包要「按原文改坏」，所以读 src/ 下的真源 rules.ts，不读转译产物。
  'src/shared/version-control/src/rules.ts',
  // #1738：页面注册表与命令面板的唯一数据源（能力账本 162 条），界面壳按它渲染，测试也按它断言。
  'src/shared/version-control/src/capability-ledger.ts',
  // #1737 版本可用性判定（capabilityAvailability）在共享层同一份：命令面板按它写「需要哪版、替代做法」。
  'src/shared/version-control/src/capabilities.ts',
  // #1739 首屏七片契约（契约名、版本号、七片名单、刷新三时机与形状判据的唯一真源）：排在客户端那片之前。
  'src/shared/version-control/src/first-screen.ts',
  // #1743 提交计划（八条提交能力共用的形态、目标、跳过钩子、签名、追加签名行与各自 argv）：宿主与界面读同一份。
  'src/shared/version-control/src/commit-plan.ts',
  // #1755：同步十个动作（域 8 的 8.5–8.14）的共享口径（动作表、argv 规划、现场判定与确认文案），
  //   与构建同序排在客户端两叶之前。
  'src/shared/version-control/src/sync-actions.ts',
  'src/shared/version-control/src/sync-rules.ts',
  // #1759：迁移与备份域（11.1 / 11.12 / 11.13 与 5.13，加 svn 补充块）的动作表、参数守卫与计划摘要，
  //   与构建同序排在客户端两叶之前；界面不手抄动作名单与命令原文。
  'src/shared/version-control/src/migrate-actions.ts',
  // #1751：贮藏十条的规则真源（动作名单、版本门、危险档、命令拼装与恢复路径）。
  'src/shared/version-control/src/stash-rules.ts',
  // #1756 克隆向导的共享层两片（与构建同序）：地址与选项口径 → 预检票据的契约与目标现场形状。
  'src/shared/version-control/src/clone-options.ts',
  'src/shared/version-control/src/clone-ticket.ts',
  // #1760 配置与钩子八条的规则真源（四组配置 / 只读边界 / 2.36 版本门 / 钩子名形状 / 清单解析），与构建同序。
  'src/shared/version-control/src/config-rules.ts',
  // #1752 工作树八条能力的纯规则层（八条动作 / argv / 判定 / 清单行模型），与构建同序排在客户端那片之前。
  'src/shared/version-control/src/worktree-ops.ts',
  // #1762 平台段：凭据助手链、rebase.updateRefs、request-pull 参数与补丁清单的判定真源（两页与宿主读同一份）。
  'src/shared/version-control/src/platform-inspect.ts',
  // #1757 子模块域（10.1–10.8）的纯规则层：八条能力、十一个动作、固定四项批量菜单、判定与 argv，与构建同序排在客户端那片之前。
  'src/shared/version-control/src/submodule-ops.ts',
  // #1747 冲突文本的解析与拼装（冲突块切分、按选择拼回整份、残留标记判定）：宿主保存前扫标记与界面冲突视图同源，
  //   与构建同序排在客户端那片之前。
  'src/shared/version-control/src/conflict-text.ts',
  // #1750 T15 整仓重写的共享两片（与构建同序）：五张 filter-repo 表单的输入守卫/计划/argv 拼装，以及整仓备份点与还原步骤。
  'src/shared/version-control/src/rewrite-ops.ts',
  'src/shared/version-control/src/recovery-point.ts',
  // #1758 T22 维护页十条能力的共享协议（动作表、计划、任务请求、版本门，与构建同序排在客户端那片之前）。
  'src/shared/version-control/src/maintenance-ops.ts',
  'src/client/views/versionControl/vcText.js',
  'src/client/views/versionControl/vcFold.js',
  'src/client/views/versionControl/vcDiff.js',
  'src/client/views/versionControl/vcCommit.js',
  'src/client/views/versionControl/vcStyles.js', // #851 视觉语言的样式叶子（CSS 文本；842 的视觉语言组读它），与构建同序排在 vcCommit 之后
  'src/client/views/versionControl/vcRows.js', // #842 从 vcBlocks 原样搬出的那一层（闭包里排在 vcBlocks 之前）
  'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcWriteRun.js',
  'src/client/views/versionControl/vcWriteUi.js',
  'src/client/views/versionControl/vcWriteOps.js',
  'src/client/views/versionControl/vcWriteView.js',
  'src/client/views/versionControl/vcDiffOps.js', // #857：差异与提交那几路的动作（从入口组件搬出，闭包里排在 vcBlocks 之前）
  'src/client/views/versionControl/vcBlocks.js',
  'src/client/views/versionControl/vcAiHandoff.js', // #854：AI 交接（与构建同序）
  'src/client/views/versionControl/vcTabVisible.js',
  'src/client/views/versionControl/vcData.js',
  'src/client/views/versionControl/vcCache.js', // #864：进出缓存（与构建同序）
  'src/client/views/versionControl/vcInView.js', // #997：「还能显示更多」那几处什么时候接着显示（与构建同序）
  'src/client/views/versionControl/vcFirstScreen.js', // #1739：首屏七片的客户端数据层（只读一份版本化快照；与构建同序）
  // #1752 工作树页三叶（与构建同序）：数据层 → 处理层 → 页面体，页面壳的挂载段要看到页面体那一叶。
  'src/client/views/versionControl/vcWorktreesData.js',
  'src/client/views/versionControl/vcWorktreesUi.js', // #1904 界面读数归一
  'src/client/views/versionControl/vcWorktreesFormOps.js', // #1904 三张表单的处理动作
  'src/client/views/versionControl/vcWorktreesOps.js',
  'src/client/views/versionControl/vcWorktreesFormView.js', // #1904 三张表单与结果条画法
  'src/client/views/versionControl/vcWorktreesRows.js', // #1904 逐行画法与清单
  'src/client/views/versionControl/vcWorktreesView.js', // #1829 阶段 3：工作树页版式（页面体只留能力定义与状态面）
  'src/client/views/versionControl/vcWorktreesPage.js',
  // #1757 子模块页三叶（与构建同序）：数据层 → 处理层 → 页面体，页面壳的挂载段要看到页面体那一叶。
  'src/client/views/versionControl/vcSubmodulesData.js',
  'src/client/views/versionControl/vcSubmodulesOps.js',
  'src/client/views/versionControl/vcSubmodulesPage.js',
  // #1738 页面壳四片（与构建同序）：页面注册表 → 基础画法 → 命令面板 → 页面壳本体。
  'src/client/views/versionControl/vcCapabilityPages.js',
  'src/client/views/versionControl/vcShellPrimitives.js',
  'src/client/views/versionControl/vcPalette.js',
  'src/client/views/versionControl/vcBranches.js', // #1746：分支与标签业务面板（十三条能力入口、预检与确认、结果贴点；排在页面壳之前，壳里会调它）
  'src/client/views/versionControl/vcBranchSections.js', // #1881：本页后两段正文（标签、上游跟踪）与四件小工具，注入次序在视图叶子之前
  'src/client/views/versionControl/vcBranchPage.js', // #1829 阶段 3：分支与标签页的视图叶子（静态树 vcBranchTreeOf 画页面结构，组件 vcBranchPageOf 供壳挂载）
  // #1744 提交历史页：列表 / 详情 / 逐文件差异 / 13.14 图形化视图（排在页面壳之前，壳要调它）。
  // #1903：历史页四条能力的纯判定、动作层与多出来的画法（vcHistory 与 vcHistoryDetail 都要调它们），排在历史页之前。
  'src/client/views/versionControl/vcHistoryQuery.js',
  'src/client/views/versionControl/vcHistoryOps.js',
  'src/client/views/versionControl/vcHistoryExtra.js',
  'src/client/views/versionControl/vcHistory.js',
  // #1829 阶段 3：图形视图与提交详情从历史页拆成独立叶子；它们在 vcHistory 之后、页面壳之前拼接。
  'src/client/views/versionControl/vcHistoryGraph.js',
  'src/client/views/versionControl/vcHistoryDetail.js',
  // #1754 远端与同步页（域 8 的 8.1–8.4）：数据层在前、画法在后，最后才是调它们的页面壳。
  'src/client/views/versionControl/vcSyncData.js', // #1755：同步段数据层（两条电话、预检与执行回包落位；与构建同序排在远端数据层之前）
  'src/client/views/versionControl/vcRemoteData.js',
  'src/client/views/versionControl/vcRemoteFacts.js', // #1841：远端页的同步事实格（vcRemotePage 调 vcRemoteFactsOf），与构建同序排在页面之前
  'src/client/views/versionControl/vcRemotePage.js',
  'src/client/views/versionControl/vcSyncPage.js', // #1755：同步段正文（十个动作、理由、租约、确认卡、任务区；挂在远端页正文末尾）
  // #1759 迁移与备份页：数据层在前、正文在后（与构建同序，页面壳的挂载段要看到正文那一叶）。
  'src/client/views/versionControl/vcMigrateData.js',
  // #1745 历史高级查询：数据层（十条能力的目录与读取）与面板画法都排在页面壳之前。
  'src/client/views/versionControl/vcQuery.js',
  'src/client/views/versionControl/vcQueryView.js',
  // #1743 提交页：动作层、提交选项展开区与正文叶子（与构建同序，排在页面壳之前，壳要调 vcCommitPageNode）。
  'src/client/views/versionControl/vcCommitOps.js',
  // #1877：提交选项四组住在独立叶子里，提交页要调 vcCommitOptionsNode，闭包少了它一渲染就 ReferenceError。
  'src/client/views/versionControl/vcCommitOptions.js',
  'src/client/views/versionControl/vcCommitPage.js',
  // #1740 长任务区（真任务在跑时的进度、四类结论与取消按钮）：M2 的容器要读任务槽并轮询，拼闭包缺它就会在挂载那一帧抛错。
  'src/client/views/versionControl/vcTaskPanel.js',
  // #1742 改动页操作面板（13 条动作的渲染面板）：页面壳只在传了改动读数时才挂它；与构建同序，排在页面壳之前。
  'src/client/views/versionControl/vcChangesPage.js',
  // #1751 贮藏页三片（与构建同序）：先动作与数据层，再文件清单的画法（#1860 D8），最后是页面本体。
  'src/client/views/versionControl/vcStashOps.js',
  'src/client/views/versionControl/vcStashDetail.js',
  'src/client/views/versionControl/vcStashPage.js',
  // #1761 诊断页两片（与构建同序）：先数据与动作层，再页面正文；页面壳只在诊断页且拿到读数时挂它。
  'src/client/views/versionControl/vcDiagnostics.js',
  'src/client/views/versionControl/vcDiagnosticsPage.js',
  // #1762 平台段两页（与构建同序）：数据层 → 平台页画法 → 迁移页 14.1 导出向导，最后才是调它们的页面壳。
  'src/client/views/versionControl/vcPlatformData.js',
  'src/client/views/versionControl/vcPlatformPage.js',
  'src/client/views/versionControl/vcMigrateExport.js',
  // #1762 T26：「本页负责的能力」列表从壳拆到独立叶子，构建次序在壳之前，闭包拼装要跟着放。
  // #1748 变基待办页的历史改写面板（与构建同序）：先数据层，再页面本体，都排在页面壳之前。
  'src/client/views/versionControl/vcUndoOps.js',
  'src/client/views/versionControl/vcUndoPage.js',
  'src/client/views/versionControl/vcMigratePage.js', // #1759：迁移与备份页正文（九个动作、只读结果、确认卡与任务区；壳要调它）
  'src/client/views/versionControl/vcClonePage.js', // #1756：迁移页 › 克隆向导（自持表单与进度状态；排在页面壳之前，壳里会挂它）
  // #1747 冲突向导两叶（与构建同序）：先动作模型（15 条能力的出入参形状），再页面正文；壳的挂载段要看到页面体那一叶。
  'src/client/views/versionControl/vcConflictsOps.js',
  'src/client/views/versionControl/vcConflictsPage.js',
  // #1760 配置与钩子三片（与构建同序）：数据与动作层 → 配置页 → 钩子页，页面壳的挂载段要看到这两页。
  'src/client/views/versionControl/vcConfigOps.js',
  'src/client/views/versionControl/vcConfigPage.js',
  'src/client/views/versionControl/vcHooksPage.js',
  // #1749 变基待办页两叶（与构建同序）：先动作模型（九条能力的出入参形状），再页面正文；壳的挂载段要看到页面体那一叶。
  'src/client/views/versionControl/vcRebaseOps.js',
  'src/client/views/versionControl/vcRebasePage.js',
  // #1750 T15 维护页整仓重写两叶（与构建同序）：动作模型在前、页面正文在后，壳的挂载段要看到页面体那一叶。
  'src/client/views/versionControl/vcRewriteOps.js',
  'src/client/views/versionControl/vcRewritePage.js',
  // #1758 T22 维护页与诊断页三叶（与构建同序）：数据模型在前，两个页面正文在后；壳的挂载段要看到页面体那两叶。
  'src/client/views/versionControl/vcMaintenanceData.js',
  'src/client/views/versionControl/vcMaintenancePage.js',
  'src/client/views/versionControl/vcMaintenanceDiag.js',
  'src/client/views/versionControl/vcShellIdentity.js',
  // #1902 改动页三叶（与构建同序）：纯规则（拆块 / 合并 / 分组）→ 贴行确认与改名表单 → 一行的画法 → 页面本体。
  'src/client/views/versionControl/vcChangesHunks.js',
  'src/client/views/versionControl/vcChangesAct.js',
  'src/client/views/versionControl/vcChangesRow.js',
  'src/client/views/versionControl/vcChangesView.js',
  // #1829 阶段 4 三个共享件（与构建同序）：页头与页面原语、齿轮里的管理索引卡、分支浮层；壳的挂载段要看到它们。
  'src/client/views/versionControl/vcPageHead.js',
  // #1845 流程页共用小部件（状态芯片 / 动作条 / 进度条 / 行内提示）：变基、冲突、任务三页正文都要调它，
  //   闭包里少了这一叶，三页渲染会直接 ReferenceError。
  'src/client/views/versionControl/vcFlowParts.js',
  'src/client/views/versionControl/vcManageIndex.js',
  'src/client/views/versionControl/vcBranchPopover.js',
  'src/client/views/versionControl/vcShellPages.js',
  // #1776 M1 真实页签容器四叶 + #1776 M2 管理页七叶（与构建同序）：纯状态换算 → 管理页状态与模型
  //   → 每页读数分发 → 分支/远端/同步动作 → 配置/钩子/诊断/子模块/平台动作 → 迁移与任务轮询
  //   → 冲突与变基动作 → 导航动作与顶部条 → 事件翻译 → 数据装载与动作 → 容器组件。
  'src/client/views/versionControl/vcRealModel.js',
  'src/client/views/versionControl/vcRealManage.js',
  'src/client/views/versionControl/vcRealManageReads.js',
  'src/client/views/versionControl/vcRealManageActions.js',
  'src/client/views/versionControl/vcRealManageActions2.js',
  'src/client/views/versionControl/vcRealManageActions3.js',
  'src/client/views/versionControl/vcRealManageSide.js',
  'src/client/views/versionControl/vcRealShell.js',
  'src/client/views/versionControl/vcRealDelegate.js',
  'src/client/views/versionControl/vcRealActions.js',
  // #1902：改动页动作处理器从 vcRealActions 搬出，容器照旧只调 vcRealChangesHandlersOf 一个入口。
  'src/client/views/versionControl/vcChangesHandlers.js',
  // #1877：提交选项浮层的关闭与焦点行为拆成独立叶子，容器要调 vcRealCommitFlowEffectsOf。
  'src/client/views/versionControl/vcRealCommitFlow.js',
  'src/client/views/versionControl/vcRealTab.js',
  'src/client/views/versionControl/VersionControlTab.js',
]

const EXPORTS = [
  'VC_PHONES', 'VC_FILE_ROWS_FIRST', 'VC_FILE_ROWS_BATCH', 'VC_DIFF_LINES_SHOWN', 'VC_BLOCK_ORDER', 'VC_TONE', 'VC_MIDDLE_MIN',
  'VC_FOLD_STEP_CAP', 'VC_SYNC_VALUES', 'VC_DIFF_REASON_KEY', 'VC_OTHER_SUMMARY_NAMES', 'vcFailKeyOf', 'vcFileRowsOf', 'vcDiffViewOf', 'vcSyncViewOf',
  'vcOtherRowOf', 'vcReadsOf', 'vcBlocksOf', 'vcChangeKeyOf', 'vcChangeToneOf', 'vcTail', 'vcMiddle', 'vcShortOid',
  'vcPlusMinus', 'vcTimeKind', 'vcWhenText', 'vcBasisText', 'vcFoldBandAt', 'vcFoldDataOf', 'vcFoldLadderOf', 'vcFoldStateAt',
  'vcFoldOf', 'vcTabVisible', 'vcNewReads', 'vcFailureOf', 'vcReadStatus', 'vcReadDiff', 'vcReadMoreCommits', 'vcNextSkipOf',
  'vcCommitKeyOf', 'vcReadCommitFiles', 'vcReadCommitFileDiff', 'vcCommitModeOf', 'vcCommitBlockOf', 'vcShouldRead', 'VC_AI_READ_FAIL_KINDS', 'vcAiHandoffOf',
  'vcAiButtonNode', 'vcOpenAiHandoff', 'vcFreshOnCwd', 'vcScreenShapeOk', 'vcApplyCommitReply', 'vcMarkLogLoading', 'vcOneLine', 'VC_SCREEN_CACHE_MAX',
  'vcCacheSeedOf', 'vcCacheSave', 'vcMoreStepOf', 'vcMoreStateOf', 'vcMoreShownOf', 'vcUseMoreSightOf', 'CAPABILITIES', 'PAGE_SURFACES',
  'PAGE_COUNTS', 'CAPABILITY_TOTAL', 'REASONS', 'judge', 'VC_TAB_PAGES', 'VC_MANAGE_PAGES', 'VC_SEARCH_PAGE', 'VC_DEEP_LINKS',
  'VC_SHELL_WIDTHS', 'VC_SHELL_STATES', 'VC_SHELL_SKINS', 'vcPageDepthOf', 'vcPageRegistryOf', 'vcPageCapabilitiesOf', 'vcCapabilityOf', 'vcDeepLinkOf',
  'vcPageSurfaceOf', 'vcShellStateNode', 'vcShellConfirmCardNode', 'vcShellResultNode', 'vcShellCapabilityRowNode', 'vcCapabilitySurfaceKindOf', 'VC_BLOCK_KEY',
  'vcBlockKeyOf', 'vcReasonKeysOf', 'VC_PALETTE_MAX', 'vcCapabilityAliasOf', 'vcCapabilitySummaryOf', 'vcCapabilityNeedsObjectOf', 'vcPaletteRowsOf', 'vcPaletteTargetOf',
  'vcPaletteNode', 'VC_LOG_BATCH', 'VC_HISTORY_BATCH', 'VC_HISTORY_LANES_MAX', 'VC_HISTORY_DIFF_LINES_WIDE', 'VC_HISTORY_DIFF_LINES_NARROW', 'vcHistoryFirstPageOf', 'vcHistoryModelOf',
  'vcHistoryGraphOf', 'vcHistoryDiffContextOf', 'vcHistoryPageNode', 'vcHistoryListOf', 'vcHistoryRowNode', 'vcHistoryDetailOf', 'vcHistoryGraphNode', 'VC_REMOTE_PHONES',
  'VC_REMOTE_FORMS', 'VC_REMOTE_ONLINE_FAIL_KINDS', 'vcNewRemoteReads', 'vcRemoteStateOf', 'vcRemoteReadAtOf', 'vcRemoteRemotesOf', 'vcRemoteErrorOf', 'vcRemoteOnlineStateOf',
  'vcRemoteOnlineOf', 'vcRemoteOnlineErrorOf', 'vcRemoteOnlineNameOf', 'vcApplyRemoteReply', 'vcReadRemoteList', 'vcReadRemoteOnline', 'vcRunRemoteWrite', 'vcRemoteModelOf',
  'vcRemotePageNode', 'SYNC_ACTIONS', 'SYNC_CHECK_CONTRACT', 'SYNC_CHECK_VERSION', 'syncActionOf', 'syncPlanOf', 'syncPlanDigestInput', 'syncVersionAtLeast',
  'judgeSync', 'syncConfirmOf', 'syncReasonTextOf', 'VC_SYNC_PHONES', 'VC_SYNC_ACTION_ROWS', 'VC_SYNC_GROUPS', 'vcNewSyncReads', 'vcSyncStateOf', 'vcSyncDataOf',
  'vcSyncErrorOf', 'vcSyncTaskOf', 'vcApplySyncReply', 'vcApplySyncWriteReply', 'vcReadSyncCheck', 'vcRunSyncWrite', 'vcSyncModelOf', 'vcSyncPageNode',
  'MIGRATE_ACTIONS', 'MIGRATE_CHECK_CONTRACT', 'MIGRATE_CHECK_VERSION', 'migrateActionOf', 'migrateActionIds', 'migratePathProblem', 'migrateRefProblem', 'migrateBranchProblem',
  'migrateUrlProblem', 'migrateVersionAtLeast', 'migratePlanOf', 'migratePlanDigestInput', 'VC_MIGRATE_PHONES', 'VC_MIGRATE_ACTION_ROWS', 'vcNewMigrateReads', 'vcMigrateStateOf',
  'vcMigrateDataOf', 'vcMigrateErrorOf', 'vcMigrateTaskOf', 'vcApplyMigrateReply', 'vcApplyMigrateWriteReply', 'vcReadMigrateCheck', 'vcRunMigrateWrite', 'vcMigrateModelOf',
  'vcMigratePageNode', 'VC_QUERY_PHONE', 'VC_QUERY_COUNT_MAX', 'VC_QUERY_BLAME_SPAN_MAX', 'VC_QUERY_COMPARE_MAX', 'VC_QUERY_RANGE_MAX', 'vcQueryCatalogOf', 'vcQueryEntriesOf',
  'vcQueryEntryOf', 'vcQueryDefaultsOf', 'vcQueryInputsOf', 'vcQueryInputValueOf', 'vcNewQueries', 'vcQueryStateOf', 'vcMarkQueryLoading', 'vcApplyQueryReply',
  'vcQueryParamsOf', 'vcQueryShapeOk', 'vcReadHistoryQuery', 'vcQueryEmptyOf', 'vcQueryTruncatedOf', 'vcQueryShownOf', 'vcQueryPageNode', 'VC_QUERY_PANEL',
  'commitPlanOf', 'commitPlanProblem', 'commitPlanDangerous', 'commitArgvOf', 'commitDecisionOf', 'commitTrailerOf', 'VC_COMMIT_MODES', 'VC_COMMIT_MODE_CAPS',
  'VC_COMMIT_PHONES', 'vcCommitInitialState', 'vcCommitOpsOf', 'vcCommitPanelOf', 'vcCommitPageNode', 'vcCommitConfirmNode', 'commitBlockKeyOf', 'vcRenderTabAt',
  'vcRenderAllPages', 'VC_CHANGES_PHONES', 'VC_CHANGES_OPS', 'vcChangesPageNode', 'vcChangesCheckArgsOf', 'vcChangesWriteArgsOf', 'FIRST_SCREEN_CONTRACT', 'FIRST_SCREEN_VERSION',
  'FIRST_SCREEN_SLICES', 'FIRST_SCREEN_REFRESH_MOMENTS', 'firstScreenVersionOk', 'firstScreenShapeOk', 'firstScreenFailedSlices', 'VC_FIRST_SCREEN_PHONE', 'vcNewFirstScreenRead', 'vcFirstScreenShapeOk',
  'vcFirstScreenOf', 'vcFirstScreenStateOf', 'vcFirstScreenReadAtOf', 'vcFirstScreenSliceOf', 'vcFirstScreenSliceStateOf', 'vcFirstScreenFailedSlicesOf', 'vcFirstScreenSliceRetryableOf', 'vcReadFirstScreen',
  'vcReadFirstScreenOnEnter', 'vcReadFirstScreenAfterTask', 'vcReadFirstScreenOnManual', 'vcRetryFirstScreen', 'vcRetryFirstScreenSlice', 'vcFirstScreenScreenOf', 'VC_BRANCHES_PHONE', 'VC_BRANCH_CHECK_PHONE',
  'VC_BRANCH_WRITE_PHONE', 'VC_BRANCH_BOARD_CONTRACT', 'VC_BRANCH_BOARD_VERSION', 'VC_BRANCH_CHECK_CONTRACT', 'VC_BRANCH_CHECK_VERSION', 'VC_BRANCH_OP_IDS', 'VC_BRANCH_WRITE_OPS', 'VC_BRANCH_ACTIONS',
  'vcNewBranchRead', 'vcBranchShapeOk', 'vcBranchCheckShapeOk', 'vcReadBranches', 'vcBranchReadOf', 'vcBranchBoardOf', 'vcBranchStateOf', 'vcBranchCheckOf',
  'vcBranchWriteResultOf', 'vcBranchTicketOf', 'vcBranchCheckDecisionOf', 'vcBranchRequestOf', 'vcBranchCheck', 'vcBranchWrite', 'vcBranchCheckKindOf', 'vcBranchReplyKindOf',
  'vcBranchReasonsOf', 'vcBranchConfirmOf', 'vcBranchResultOf', 'vcBranchBoardNode', 'STASH_OPS', 'STASH_WRITE_OPS', 'STASH_READ_OPS', 'stashNeedsTicketOf',
  'STASH_STAGED_MIN_VERSION', 'STASH_STAGED_ALTERNATIVE', 'STASH_UNKNOWN_OP_KEY', 'stashOpOf', 'stashOpById', 'stashOpNameKeyOf', 'stashDangerOpsOf', 'vcStashSelectorOk',
  'vcStashMessageError', 'vcStashBranchError', 'stashOperationArgs', 'stashRestoreArgs', 'VC_STASH_PHONE', 'VC_STASH_SLICE', 'VC_STASH_STAGED_OP', 'vcStashStateNew',
  'vcStashEntriesOf', 'vcStashListStateOf', 'vcStashVersionTextOf', 'vcStashStagedStateOf', 'vcStashOpVisibleOf', 'vcStashNeedsConfirmOf', 'vcStashConfirmOf', 'vcStashConfirmPayloadOf',
  'vcStashActionPayloadOf', 'vcStashFailKeyOf', 'vcStashResultOf', 'vcStashApplyReply', 'vcStashRecentOf', 'vcStashShortOidOf', 'vcStashWhenOf', 'vcStashPageNode',
  'VC_STASH_PAGE_SOURCE', 'CONFIG_GROUPS', 'CONFIG_IDENTITY_KEYS', 'CONFIG_SCOPES', 'CONFIG_WRITE_OPS', 'CONFIG_ENTRY_DEFS', 'HOOK_NAMES', 'CONFIG_CHECK_CONTRACT',
  'CONFIG_CHECK_VERSION', 'CONFIG_HOOK_RUN_MIN_VERSION', 'CONFIG_HOOK_RUN_ALTERNATIVE', 'configGroupOf', 'configKeyEditable', 'configHookRunStateOf', 'identityValueError', 'hookNameProblem',
  'configScopeOf', 'parseConfigList', 'configOldValueOf', 'configRowsOf', 'parseCheckAttr', 'parseCheckMailmap', 'configCheckPlanOf', 'configNeedsConfirmOf',
  'configConfirmOf', 'configSceneSummary', 'VC_CONFIG_READ_PHONE', 'VC_CONFIG_CHECK_PHONE', 'VC_CONFIG_WRITE_PHONE', 'VC_CONFIG_READ_CONTRACT', 'VC_CONFIG_WRITE_KEYS', 'VC_CONFIG_PHONES',
  'vcConfigStateNew', 'vcConfigApplyRead', 'vcConfigReadStateOf', 'vcConfigIdentityRowsOf', 'vcConfigGroupsOf', 'vcConfigGroupRowsOf', 'vcConfigEditOf', 'vcConfigSetInputOf',
  'vcRealConfigHandlersOf', 'vcRealConflictsHandlersOf',
  'vcConfigUnsetInputOf', 'vcHookRunInputOf', 'vcConfigCheckCallOf', 'vcConfigWriteCallOf', 'vcConfigConfirmOf', 'vcConfigConfirmTargetOf', 'vcConfigFailKeyOf', 'vcConfigResultOf',
  'vcConfigApplyReply', 'vcConfigApplyCheck', 'vcHooksReadStateOf', 'vcHookRowsOf', 'vcHooksDirOf', 'vcHookRunStateOf', 'vcHookRunVisibleOf', 'vcHookConfirmOf',
  'vcHookResultOf', 'vcHooksApplyReply', 'vcHookOutputOf', 'vcConfigPageNode', 'vcHooksPageNode', 'VC_CONFIG_PAGE_SOURCE', 'VC_HOOKS_PAGE_SOURCE', 'VC_DIAG_PHONES',
  'VC_DIAG_QUERY_ROWS', 'VC_DIAG_BISECT_ACTIONS', 'VC_DIAG_POINTERS', 'VC_DIAG_BISECT_CAP', 'VC_DIAG_PATCH_CAP', 'VC_DIAG_TRAILER_CAP', 'VC_DIAG_REPLACE_CAP', 'vcDiagnosticsStateNew',
  'vcDiagnosticsInputOf', 'vcDiagnosticsReadPayloadOf', 'vcDiagnosticsPatchPayloadOf', 'vcDiagnosticsTrailerPayloadOf', 'vcDiagnosticsReplaceListPayloadOf', 'vcDiagnosticsWritePayloadOf', 'vcDiagnosticsDangerousOf', 'vcDiagnosticsCallOf',
  'vcDiagnosticsFailKeyOf', 'vcDiagnosticsShortOidOf', 'vcDiagnosticsResultOf', 'vcDiagnosticsRowsOf', 'vcDiagnosticsApplyReadReply', 'vcDiagnosticsApplyWriteReply', 'vcDiagnosticsActionsOf', 'vcDiagnosticsMountNode',
  'vcDiagnosticsPageNode', 'VC_DIAGNOSTICS_SOURCE', 'VC_DIAG_PAGE_SOURCE', 'WORKTREE_ACTIONS', 'WORKTREE_CAP_IDS', 'WORKTREE_REASONS', 'worktreeJudge', 'worktreeArgsOf',
  'worktreeRowsOf', 'worktreePruneEntriesOf', 'VC_WORKTREES_ENTRY_DEFS', 'VC_WORKTREE_PHONES', 'VC_WORKTREES_PAGE_SOURCE', 'VC_WORKTREES_DATA_SOURCE', 'vcWorktreesListStateOf', 'vcWorktreesSnapshotOf',
  'vcWorktreesModelOf', 'vcWorktreesVersionOf', 'vcWorktreeAvailabilityOf', 'vcWorktreeWhyKeyOf', 'vcWorktreesVersionHintOf', 'vcWorktreesRowActionsOf', 'vcWorktreesActionDecisionOf', 'vcWorktreeCheckArgsOf',
  'vcWorktreeRunArgsOf', 'vcWorktreePlanOf', 'vcWorktreeFailureOf', 'vcWorktreeResultOf', 'vcWorktreeDecisionReasonsOf', 'vcWorktreeDecisionStateOf', 'vcWorktreesPageNode', 'VC_PLATFORM_INSPECT_SOURCE',
  'PLATFORM_CREDENTIAL_MAX', 'PLATFORM_PATCH_MAX', 'PLATFORM_ARG_MAX', 'PLATFORM_STORE_HELPER', 'vcConfigTruthyOf', 'vcNulValuesOf', 'vcCredentialHelpersOf', 'vcCredentialStoreOf',
  'vcCredentialRiskOf', 'vcUpdateRefsOf', 'vcRequestPullArgsOf', 'vcPatchSummaryOf', 'VC_PLATFORM_PHONES', 'VC_PLATFORM_DATA_SOURCE', 'vcNewPlatformReads', 'vcPlatformStateOf',
  'vcPlatformDataOf', 'vcPlatformErrorOf', 'vcPlatformCredentialOf', 'vcPlatformUpdateRefsOf', 'vcPlatformRequestPullStateOf', 'vcPlatformRequestPullOf', 'vcPlatformRequestPullErrorOf', 'vcPlatformPatchesStateOf',
  'vcPlatformPatchesOf', 'vcPlatformPatchesErrorOf', 'vcApplyPlatformReply', 'vcApplyRequestPullReply', 'vcApplyPatchesReply', 'vcReadPlatform', 'vcRunRequestPull', 'vcReadPatchFiles',
  'VC_PLATFORM_PAGE_SOURCE', 'VC_PLATFORM_PAGE_CAP_IDS', 'VC_PLATFORM_OUTBOUND_IDS', 'VC_PLATFORM_BOUNDARY_KEYS', 'vcPlatformModelOf', 'vcPlatformPageNode', 'VC_MIGRATE_EXPORT_SOURCE', 'VC_MIGRATE_EXPORT_PHONES', 'VC_MIGRATE_PAGE_CAP_IDS', 'vcNewMigrateExport',
  'vcApplyMigrateCheck', 'vcApplyMigrateRun', 'vcApplyMigrateTask', 'vcRunMigrateCheck', 'vcRunMigrateExport', 'vcRunMigrateTaskQuery', 'vcMigrateExportNode', 'VC_UNDO_PHONE_CHECK',
  'VC_UNDO_PHONE_WRITE', 'VC_UNDO_COMMIT_MAX', 'VC_UNDO_MESSAGE_MAX', 'VC_UNDO_REV_MAX', 'VC_UNDO_CATALOG', 'vcUndoCatalogOf', 'vcUndoEntryOf', 'vcUndoInputsOf',
  'vcUndoSetInputOf', 'vcUndoPickOpOf', 'vcUndoRevProblem', 'vcUndoCommitsOf', 'vcUndoParamsOf', 'vcUndoCheckArgsOf', 'vcUndoWriteArgsOf', 'vcUndoCheckShapeOk',
  'vcUndoWriteShapeOk', 'vcUndoStateNew', 'vcUndoMark', 'vcUndoErrorOf', 'vcUndoApplyCheck', 'vcUndoApplyWrite', 'vcUndoBusyOf', 'vcUndoRecoveryStepsOf',
  'vcUndoShortOidOf', 'vcUndoWhenOf', 'vcUndoRequestIdOf', 'VC_UNDO_FAIL_KEYS', 'vcUndoFailKnownOf', 'VC_UNDO_OPS_SOURCE', 'vcUndoPageNode', 'VC_UNDO_PANEL',
  'VC_UNDO_PAGE_SOURCE', 'VC_UNDO_PAGE_NAMES', 'CLONE_OPTION_DEFAULTS', 'cloneSourceKindOf', 'cloneMaskedUrl', 'cloneDefaultDirOf', 'cloneHardlinkNote', 'cloneOptionsOf',
  'CLONE_TICKET_OPS', 'CLONE_CHECK_CONTRACT', 'CLONE_CHECK_VERSION', 'CLONE_TARGET_STATES', 'clonePlanOf', 'cloneTaskArgsOf', 'cloneTargetProblem', 'VC_CLONE_PAGE_SOURCE',
  'VC_CLONE_PHONES', 'VC_CLONE_FORM_DEFAULT', 'VC_CLONE_STEPS', 'VC_CLONE_REASON_KEYS', 'VC_CLONE_PAGE_HINT', 'vcCloneRequestIdOf', 'vcCloneFormOf', 'vcCloneCheckArgsOf',
  'vcCloneWriteArgsOf', 'vcCloneCleanupCheckArgsOf', 'vcCloneCleanupWriteArgsOf', 'vcCloneCallOf', 'vcCloneTicketOf', 'vcCloneSceneOf', 'vcCloneDecisionOf', 'vcCloneReasonOf',
  'vcCloneReplyKindOf', 'vcCloneTaskOf', 'vcCloneProgressOf', 'vcCloneResidualOf', 'vcCloneTaskEndedOf', 'vcClonePageNode', 'SUBMODULE_CAP_IDS', 'SUBMODULE_ACTIONS',
  'SUBMODULE_WRITE_OPS', 'SUBMODULE_TASK_OPS', 'SUBMODULE_BATCH_MENU', 'SUBMODULE_REASONS', 'submoduleJudge', 'submoduleTaskOf', 'submoduleWriteArgsOf', 'submoduleRowsOf',
  'VC_SUBMODULES_PHONES', 'VC_SUBMODULE_ENTRIES', 'VC_SUBMODULE_MODES', 'vcSubmoduleBoardShapeOk', 'vcSubmoduleRowsOf', 'vcSubmoduleBatchOf', 'vcSubmoduleWhyKeyOf', 'vcSubmoduleCheckArgsOf',
  'vcSubmoduleRunArgsOf', 'vcSubmoduleTaskArgsOf', 'vcSubmoduleFailureOf', 'vcSubmodulesUiOf', 'vcSubmodulesPageNode', 'VC_SUBMODULES_PAGE_SOURCE', 'VC_CONFLICTS_PHONES', 'VC_CONFLICTS_OPS',
  'VC_CONFLICTS_STATES', 'VC_CONFLICTS_KINDS', 'VC_CONFLICTS_OPS_SOURCE', 'vcConflictsOpMetaOf', 'vcConflictsOpLabelKeyOf', 'vcConflictsOpVerbKeyOf', 'vcConflictsStateLabelKeyOf', 'vcConflictsKindLabelKeyOf',
  'vcConflictsSideLabelKeyOf', 'vcConflictsRequestIdOf', 'vcConflictsVisibleOf', 'vcConflictsPayloadOf', 'vcConflictsCheckArgsOf', 'vcConflictsWriteArgsOf', 'vcConflictsTargetOf', 'vcConflictsListOf',
  'vcConflictsChoicesOf', 'vcConflictsRowNode', 'vcConflictsPageNode', 'VC_REBASE_PHONES', 'VC_REBASE_OPS', 'VC_REBASE_TODO_ACTIONS', 'VC_REBASE_TODO_MOVES', 'vcRebaseOpMetaOf',
  'vcRebaseOpLabelKeyOf', 'vcRebaseOpVerbKeyOf', 'vcRebaseActionLabelKeyOf', 'vcRebaseStateLabelKeyOf', 'vcRebaseRequestIdOf', 'vcRebaseVisibleOf', 'vcRebasePayloadOf', 'vcRebaseCheckArgsOf',
  'vcRebaseWriteArgsOf', 'vcRebaseTargetOf', 'vcRebaseRowsOf', 'vcRebaseRowPatchOf', 'vcRebaseRowTextOf', 'vcRebaseMoveOf', 'vcRebasePageNode', 'vcRebaseRowNode',
  'VC_REWRITE_PAGE_SOURCE', 'VC_REWRITE_PHONES', 'VC_REWRITE_FORM_IDS', 'VC_REWRITE_FIELDS', 'VC_REWRITE_FORM_DEFAULT', 'VC_REWRITE_REASON_KEYS', 'vcRewriteFieldOf', 'vcRewriteFieldLabelKeyOf',
  'vcRewriteFieldHintKeyOf', 'vcRewriteLinesOf', 'vcRewriteRenamesOf', 'vcRewriteReplacementsOf', 'vcRewriteAuthorsOf', 'vcRewritePlanOf', 'vcRewritePreviewArgsOf', 'vcRewriteCheckArgsOf',
  'vcRewriteRunArgsOf', 'vcRewriteRequestIdOf', 'vcRewriteReasonOf', 'vcRewriteReplyKindOf', 'vcRewriteTicketOf', 'vcRewriteCountRowsOf', 'vcRewriteBackupOf', 'vcRewriteBackupSummaryOf',
  'vcRewriteRestoreStepsOf', 'vcRewriteTaskOf', 'vcRewriteTaskEndedOf', 'vcRewriteProgressOf', 'vcRewriteFailTextOf', 'vcRewritePageNode', 'VC_MAINTENANCE_PAGE_SOURCE', 'VC_MAINTENANCE_PHONES',
  'VC_MAINTENANCE_ACTIONS', 'VC_MAINTENANCE_VERSION_GATES', 'VC_MAINTENANCE_DANGER_IDS', 'vcMaintenanceOpMetaOf', 'vcMaintenanceOpLabelKeyOf', 'vcMaintenanceOpVerbKeyOf', 'vcMaintenanceOpsOfPage', 'vcMaintenanceVisibleOf',
  'vcMaintenanceRequestIdOf', 'vcMaintenanceReadArgsOf', 'vcMaintenanceCheckArgsOf', 'vcMaintenanceWriteArgsOf', 'vcMaintenanceTaskArgsOf', 'vcMaintenanceReplyKindOf', 'vcMaintenanceReasonOf', 'vcMaintenanceTicketOf',
  'vcMaintenanceConfirmOf', 'vcMaintenanceBackupOf', 'vcMaintenancePreviewOf', 'vcMaintenanceObjectsOf', 'vcMaintenanceStatusOf', 'vcMaintenanceTaskOf', 'vcMaintenanceProgressOf', 'vcMaintenanceFailTextOf',
  'VC_MAINTENANCE_PAGE_BODY_SOURCE', 'VC_MAINTENANCE_PAGE_WRITES', 'VC_MAINTENANCE_PAGE_READS', 'VC_MAINTENANCE_PAGE_DANGER', 'vcMaintenancePageNode', 'VC_MAINTENANCE_DIAG_SOURCE', 'VC_MAINTENANCE_DIAG_TASKS', 'VC_MAINTENANCE_DIAG_ITEM_LIMIT',
  'VC_MAINTENANCE_DIAG_EXITS', 'vcMaintenanceDiagNode', 'VcRealTab', 'VersionControlTab', 'RULES_SOURCE', 'VC_CHANGE_KEY', 'VC_CHANGE_TONE', 'VC_DIFF_CACHE_MAX',
  'VC_FAIL_KEY', 'VC_FOLD_BANDS', 'VC_RELATIVE_WINDOW_MS', 'VC_WRITE_ERR_FAMILY', 'VC_WRITE_ERR_KIND_FAMILY', 'VC_WRITE_ERR_NETWORK_KINDS', 'VC_WRITE_OPS', 'VC_WRITE_PHONES',
  'vcActionsNode', 'vcAfterWrite', 'vcApplyCommitFileDiffReply', 'vcApplyDiffReply', 'VC_BADGE_LETTER', 'VC_STYLE_TEXT', 'vcBadgeLetterOf', 'vcBlockedTipOf',
  'vcBoundedMap', 'vcClockText', 'vcClearTheme', 'vcCommitAreaNode', 'vcCommitListOf', 'vcConfirmOf', 'vcDiffOpenKeyOf', 'vcDiffOpsOf',
  'vcGroupOfRow', 'vcMarkCommitFileDiffLoading', 'vcMarkCommitLoading', 'vcMarkDiffLoading', 'vcOpResultOf', 'vcOpStateOf', 'vcPlanMismatchOf', 'vcPushDecisionOf',
  'vcRemoteChoiceOf', 'vcRequestIdOf', 'vcRowStageNodes', 'vcRowStageOf', 'vcRowUnstageNodes', 'vcRowUnstageOf', 'vcRowViewOf', 'vcRunCheck',
  'vcRunWrite', 'vcSetTheme', 'vcStageAllNode',
  'vcWriteErrFamilyOf', 'vcWriteErrKeyOf', 'vcWriteOpsOf', 'vcWriteTailNodes', 'vcWriteUiOf',
]

// #1776 M4c：真实页签的闭包（一百四十多份叶子）在本机 Windows 上会被 esbuild 0.28.2 判定为「超过 1MB 的输入」：
//   它先把内容写进 os.tmpdir() 的临时文件、再让子进程删掉，删除那一步报 "remove …: Access is denied."，
//   整段转译当场抛错，门禁连第一条断言都没跑到就崩。照 verify-818 的先例按文件边界切开、逐份转译再拼回去：
//   每一段都是完整源文件，转译只剥类型标注、不改作用域，与整段转译等价。
//   切分靠拼装时插入的分隔行 VC_SRC_SEAM；反证改法仍作用在整段拼好的源码上，语义不变。
const VC_SRC_SEAM = '\n//#vc-source-seam#\n'
const toEvalJsBundle = (src: string): string =>
  src.length <= 1024 * 1024 ? toEvalJs(src) : src.split(VC_SRC_SEAM).map(toEvalJs).join('\n')
// 种子注入的匹配口（#1196 转 TS 时发现的耦合）：门禁按源码文本往闭包里注种子，手写 .js 与构建
//   生成的双生 .js（esbuild 重排了空格、引号与换行）两种写法都认。只换匹配方式，不断言含义。
const VC_SEED_RE = /React\.useState\(function\s*\(\s*\)\s*\{\s*return vcCacheSeedOf\(cwd\)\s*\|\|\s*vcNewReads\(\)\s*;?\s*\}\)/
const VC_WRITE_INIT_RE = /write:\s*\{\s*op:\s*["']{2},\s*state:\s*["']idle["'],\s*message:\s*["']{2},\s*confirm:\s*null,\s*result:\s*null,\s*remoteChoice:\s*null\s*\}/
function stripExports(text) { return text.replace(/^(\s*)export\s+/gm, '$1') }
function buildView(patch, React, DswsCtx, Tip, Ic, seedReads, logs, trFn, exportsList) {
  let src = VC_FILES.map((f) => stripExports(stripTimeConfigImport(readSource(f)))).join(VC_SRC_SEAM)
  if (patch) src = patch(src)
  // #1253：改坏之后统一转译——原文里带类型标注，compileFn 只吃 JavaScript。
  src = toEvalJsBundle(src)
  const names = exportsList || EXPORTS
  const body = src + '\nreturn { ' + names.join(', ') + ' }\n'
  // 手法：compileFn——这份门禁照 build.mts 的做法把叶子拼成一段文本再跑，这里把参数名数组与文本交给共用入口造函数，语义不变。
  const fn = compileFn(['React', 'log', 'dswsLogHash', 'dswsLogTrunc', 'tr', 'host', 'DswsCtx', 'Tip', 'Ic', 'seedReads'], body)
  return fn(React || {}, function (level, event, fields) { (logs || []).push({ level: level, event: event, fields: fields }) },
    function () { return 'h8' }, function (s) { return String(s) }, trFn, {}, DswsCtx || null, Tip || null, Ic || null, seedReads || null)
}


// ---------- 真词条 ----------
const fill = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : String(s))
let LOC = { zh: {}, en: {} }
let LOC_WRITE = { zh: {}, en: {} }
const trZh = (k, p) => fill(LOC.zh[k] !== undefined ? LOC.zh[k] : k, p)
const trEn = (k, p) => fill(LOC.en[k] !== undefined ? LOC.en[k] : k, p)

// ---------- 夹具 ----------
function screenOf(over) {
  const base = {
    identity: { worktreeDisplay: 'repo', worktreePath: 'D:/w/repo', branch: 'main', detached: false, oid: 'a'.repeat(40), sync: 'tracked-known', ahead: 0, behind: 0, basisMs: NOW - 3600000 },
    staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0,
    otherWorktrees: [], branches: [{ short: 'main', upstream: 'origin/main', upstreamGone: false }], commits: [],
    repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlf: null },
  }
  const out = Object.assign({}, base, over || {})
  out.identity = Object.assign({}, base.identity, (over && over.identity) || {})
  out.repo = Object.assign({}, base.repo, (over && over.repo) || {})
  return out
}
const fileOf = (p, group, extra) => Object.assign({ path: p, group: group, change: 'modified', addedLines: 1, deletedLines: 0, conflict: false }, extra || {})
const richScreen = () => screenOf({
  staged: [fileOf('a.txt', 'staged')], stagedCount: 1,
  unstaged: [fileOf('b.txt', 'unstaged'), fileOf('c.txt', 'unstaged', { change: 'untracked' }), fileOf('d.txt', 'unstaged', { conflict: true })],
  unstagedCount: 3, conflictCount: 1,
})
function readsOf(screen) {
  return {
    screen: screen ? { state: 'ok', data: { screen: screen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }, error: null } : { state: 'idle', data: null, error: null },
    diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null },
  }
}
const uiOf = (over) => Object.assign({ fileShown: {}, openDiff: '', openCommit: '', write: { op: '', state: 'idle', message: '', confirm: null, result: null } }, over || {})
const LABELS = () => ({ push: trZh('vc.action.push'), pull: trZh('vc.action.pull'), stageAll: trZh('vc.action.stageAll'), commit: trZh('vc.action.commit', { n: '1' }) })
function decisionsOf(view, screen) {
  return { stage: view.judge(screen, 'stage'), commit: view.judge(screen, 'commit'), pull: view.judge(screen, 'pull'), push: view.judge(screen, 'push'), fetch: view.judge(screen, 'fetch') }
}
function blocksOf(view, screen, reads, ui) {
  const fold = view.vcFoldOf(460, view.vcFoldDataOf(screen, reads, LABELS()))
  return view.vcBlocksOf(screen, reads, ui, { t: trZh, nowMs: NOW, decisions: decisionsOf(view, screen), fold: fold })
}
const blockOf = (blocks, kind) => blocks.filter((b) => b.kind === kind)[0] || null
const rowOf = (blocks, p) => { const c = blockOf(blocks, 'changes'); const gs = c ? c.groups : []; const all = gs.reduce((a, g) => a.concat(g.rows), []); return all.filter((r) => r.path === p)[0] || null }

// ---------- 真实页签渲染夹具（#1776 M4c：A / J / L 组在真页面壳上断 DOM） ----------
// #1776 M1 删掉旧块渲染路径时，本门禁的 DOM 断言退化成只断模型；M4c 改回真渲染：
//   单页入口是页面壳的 vcRenderTabAt（vcShellPages.ts:419），整页签入口是 VersionControlTab（vcRealTab.ts）。
//   词条仍是真字典，渲染结果就是用户真看见的那份 DOM。
const renderToStaticMarkup: any = require('react-dom/server').renderToStaticMarkup
// H 要等 main 里拿到 React 才赋值；渲染函数都在 main 之后调用，所以这里先留空。
let H: any = null
// 取某个 data 属性在渲染结果里出现过的所有值，按出现顺序（断言「渲染了哪些、按什么次序」用）。
const attrValuesOf = function (html: string, name: string): string[] {
  return Array.from(String(html).matchAll(new RegExp(name + '="([^"]*)"', 'g'))).map(function (m: any) { return m[1] })
}
// 去掉标签后的可见文字：断言「用户看得见的字」里没有词条键名。
const visibleTextOf = function (html: any): string { return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') }
// 从渲染结果里抠出某个标记所在的整个开标签（断 disabled / class / aria 这类属性用）。
const tagAt = function (html: any, anchor: string): string {
  const s = String(html)
  const at = s.indexOf(anchor)
  if (at < 0) return ''
  const start = s.lastIndexOf('<', at)
  const end = s.indexOf('>', at)
  return start >= 0 && end >= 0 ? s.slice(start, end + 1) : ''
}
// 单页真实渲染：opts 就是页面壳的入参（page / width / skin / seed / reads / ui …）。
const pageHtmlOf = function (view: any, opts: any): string {
  try { return renderToStaticMarkup(view.vcRenderTabAt(H, trZh, opts || {})) } catch (e: any) {
    console.log('  （单页渲染抛错：' + String((e && e.message) || e) + '）')
    return ''
  }
}
const fsSliceOk = function (data: any) { return { state: 'ok', data: data, error: null } }
const fsSliceErr = function (kind: string, msg: string) { return { state: 'err', data: null, error: { kind: kind, message: msg } } }
// 首屏七片快照（真页签的读数入口；J 组末尾整页签挂载与历史页都用它）。
function firstSeedOf(view: any, over?: any) {
  const snap: any = {
    contract: view.FIRST_SCREEN_CONTRACT, version: view.FIRST_SCREEN_VERSION, readAtMs: NOW,
    slices: {
      workspace: fsSliceOk({ identity: screenOf().identity, repo: screenOf().repo, branches: [] }),
      changes: fsSliceOk({ staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0 }),
      history: fsSliceOk({ commits: [], hasMore: false }),
      worktrees: fsSliceOk({ others: [], bare: false }),
      stashes: fsSliceOk({ entries: [] }),
      sync: fsSliceOk({ sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null, upstream: null, remote: null, branch: 'main' }),
      version: fsSliceOk({ gitVersion: 'git version 2.49.0', tier: 'full', switches: [] }),
    },
  }
  return over ? (over(snap) || snap) : snap
}
// 整页签静态挂载：把读数注进 VersionControlTab 的 useState 初值（818 AI 组同一做法，见那边的 aiRenderOf）。
function renderTabHtmlOf(React: any, DswsCtx: any, TipStub: any, IcStub: any, seedReads: any, navPage?: string): string {
  const patch = function (src0: string) {
    let out = src0.split('const [reads, setReadsState] = React.useState(function () { return vcRealReadsNew(cwd) })')
      .join('const [reads, setReadsState] = React.useState(function () { return Object.assign({}, vcRealReadsNew(cwd), ' + JSON.stringify(seedReads) + ') })')
    if (navPage) out = out.split('|| vcRealInitialNav()').join('|| Object.assign(vcRealInitialNav(), { page: ' + JSON.stringify(navPage) + ' })')
    return out
  }
  const seeded = buildView(patch, React, DswsCtx, TipStub, IcStub, seedReads, [], trZh)
  try { return renderToStaticMarkup(React.createElement(seeded.VersionControlTab, { st: { cwd: 'D:/w/repo' }, narrow: false })) } catch (e: any) {
    console.log('  （整页签渲染抛错：' + String((e && e.message) || e) + '）')
    return ''
  }
}
// 远端页夹具：三条远端，覆盖「有凭据 / 没凭据 / 取址与推址不同」；宽 460 才画地址与分支。
function remoteRowsOf() {
  return [
    { name: 'origin', fetchUrl: 'https://user:***@example.com/acme/repo.git', pushUrl: 'https://user:***@example.com/acme/repo.git', hasCredential: true, branchCount: 2, branches: [{ short: 'main', name: 'origin/main', oid: 'a'.repeat(40), ref: 'refs/remotes/origin/main' }, { short: 'dev', name: 'origin/dev', oid: 'b'.repeat(40), ref: 'refs/remotes/origin/dev' }] },
    { name: 'mirror', fetchUrl: 'git@example.com:acme/repo.git', pushUrl: 'git@example.com:acme/repo.git', hasCredential: false, branchCount: 0, branches: [] },
    { name: 'leaky', fetchUrl: 'https://example.com/acme/leaky.git', pushUrl: 'https://example.com/acme/leaky.git', hasCredential: false, branchCount: 1, branches: [{ short: 'main', name: 'leaky/main', oid: 'c'.repeat(40), ref: 'refs/remotes/leaky/main' }] },
  ]
}
function syncDataOf(over?: any) {
  return Object.assign({ capabilityId: '8.8', action: 'pull-ff-only', plan: { id: '8.8', refKind: '' }, decision: 'allow', reasons: [], confirmRequired: false, ticket: null, confirm: null, readAtMs: NOW - 2000, versionPolicy: { degraded: false } }, over || {})
}
// 远端页的四份读数：本地列表 / 显式联网 / 同步段 / 长任务。
function remoteReadsOf(opts?: any) {
  const o = opts || {}
  return {
    remote: { state: 'ok', data: { source: 'local', readAtMs: NOW - 60000, remotes: o.remotes || remoteRowsOf() }, error: null },
    online: { state: 'idle', name: '', data: null, error: null },
    sync: { state: 'ok', data: o.sync === null ? null : syncDataOf(o.sync), error: null },
    task: { state: o.task ? 'ok' : 'idle', data: o.task || null, error: null },
  }
}
const remotePageHtmlOf = function (view: any, opts?: any): string {
  const o = opts || {}
  return pageHtmlOf(view, { page: 'remote', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: o.reads || remoteReadsOf(o), ui: o.ui })
}
// 历史页夹具：四条提交（第二条是合并提交），逐文件差异按「提交号 + 路径」分开存。
const hcOid = function (i: number) { return ('0000000' + String(i + 1).toString(16)).slice(-8).repeat(5) }
function hcCommitsOf(n: number) {
  const out: any[] = []
  for (let i = 0; i < n; i++) {
    out.push({ oid: hcOid(i), short: 'c' + (i + 1), author: '林可', email: 'linke@example.com', authorDateMs: NOW - (i + 1) * 60000, commitDateMs: NOW - (i + 1) * 60000, subject: '第 ' + (i + 1) + ' 次提交：把改动记下来', parents: i + 1 < n ? [hcOid(i + 1)] : [] })
  }
  return out
}
const hcRows4 = hcCommitsOf(4)
hcRows4[1].parents = [hcRows4[2].oid, hcRows4[3].oid]
const hcFiles = [{ path: 'src/a.ts', origPath: null, added: 2, deleted: 1 }, { path: '旧名.txt', origPath: '新名.txt', added: 0, deleted: 0 }]
const hcRev = hcRows4[1]
const hcCommitOk = { rev: hcRev.oid, seq: 1, state: 'ok', files: hcFiles, truncated: false, reason: 'ok', error: null }
const y5Lines = [
  { kind: 'filehead', text: 'diff --git a/src/a.ts' },
  { kind: 'hunk', text: '@@ -1 +1 @@' },
  { kind: 'add', text: '+新的一行' },
  { kind: 'del', text: '-旧的一行' },
  { kind: 'context', text: ' 没变的一行' },
]
function hcReadsOf(view: any, opts?: any) {
  const o = opts || {}
  const snap = firstSeedOf(view, function (s: any) { s.slices.history = fsSliceOk({ commits: o.commits || [], hasMore: o.hasMore === true }); return s })
  return Object.assign({
    screen: { state: 'idle', data: null, error: null },
    diffs: {},
    log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null },
    firstScreen: { state: 'ok', data: snap, error: null },
    commit: { rev: '', seq: 0, state: 'idle', files: [], truncated: false, reason: '', error: null },
    commitDiffs: {},
  }, o.reads || {})
}
// 提交面板要一份 form（身份 / 签名 / 模板 / 追加行 / 上一条提交），形状与宿主回包一致。
function commitFormOf() {
  return {
    identity: { name: '张三', email: 'z@example.com' },
    signing: { key: 'ABC123', format: 'ssh', gpgsign: true },
    template: { configured: true, path: '.gitmessage', text: '模板第一行', truncated: false, problem: '' },
    trailer: 'Signed-off-by: 张三 <z@example.com>',
    amend: { available: true, oid: 'b'.repeat(40), short: 'bbbbbbb', subject: '上一条提交', message: '上一条提交' },
  }
}

// ---------- 假宿主：记账每一次 host.call ----------
function makeHost(routes) {
  const calls = []
  const call = function (method, args) {
    calls.push({ method: method, args: args })
    const r = routes ? routes(method, args, calls) : null
    return Promise.resolve(r === undefined ? { ok: true } : r)
  }
  return { call: call, calls: calls, methods: function () { return calls.map((c) => c.method) }, countOf: function (m) { return calls.filter((c) => c.method === m).length } }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async function (n) { for (let i = 0; i < (n || 6); i++) await tick() }

// ============================================================
// ============================================================
// A 组 · 落点（真实页签渲染）
// #1776 M1 删掉旧块渲染路径后，这一组一度只剩模型断言；M4c 改回「渲染页面壳、断真 DOM」：
//   视图条模型、改动页十三条动作行、提交区禁用态、多远端入口与动作按钮，全部落在 vcRenderTabAt 的输出上。
// ============================================================
function groupA(view) {
  const screen = richScreen()
  const reads = readsOf(screen)
  const blocks = blocksOf(view, screen, reads, uiOf())
  const identity = blockOf(blocks, 'identity')
  check(!!(identity && identity.actions && identity.actions.pull && identity.actions.push), 'A1 视图条模型里仍有拉取与推送两颗按钮，顺序是「拉取 → 推送」')

  // A1b：页面壳把十个同步动作画在远端页的同步段里。2026-11-03 起按 #1841 的四组摆放（获取 / 拉取 / 推送 / 远端引用，
  //   组序照定稿原型第 39 张），组内次序仍读同一张 VC_SYNC_ACTION_ROWS；平铺编号顺序不再是判据（8.11 在最后一组）。
  const a1Html = remotePageHtmlOf(view, { sync: null })
  const a1Want = view.VC_SYNC_GROUPS.map(function (g) {
    return view.VC_SYNC_ACTION_ROWS.filter(function (r) { return g.ids.indexOf(String(r.id)) >= 0 }).map(function (r) { return String(r.id) })
  }).reduce(function (a, b) { return a.concat(b) }, []).join(',')
  const a1Got = attrValuesOf(a1Html, 'data-vc-sync-act').join(',')
  check(a1Got === a1Want, 'A1b 远端页同步段真渲染十个动作，按四组摆放、组内次序与 VC_SYNC_ACTION_ROWS 一致（实得 ' + (a1Got || '空') + '）')

  const changes = blockOf(blocks, 'changes')
  const paths = (changes && changes.stageAll ? changes.stageAll.paths : []).join(',')
  check(!!(changes && changes.stageAll && changes.stageAll.show === true) && paths === 'b.txt,c.txt', 'A2 视图条模型里有「add 全部」，路径只含未暂存且非冲突的两行（实得 ' + JSON.stringify(paths) + '）')

  // A2b：#1860 起 162 条能力主入口只在命令面板，改动页不再画十三条动作清单；这里反向守住「页面体里没有它」。
  const a2Changes = { counts: { staged: 1, unstaged: 3, untracked: 1, conflicts: 1 }, values: {}, rows: {}, handlers: {} }
  const a2Html = pageHtmlOf(view, { page: 'changes', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: reads, changes: a2Changes })
  const a2Rows = attrValuesOf(a2Html, 'data-vc-changes-row')
  check(a2Rows.length === 0 && a2Html.indexOf('data-vc-changes-count=') < 0 && a2Html.indexOf('data-vc-changes-page') < 0, 'A2b 改动页不再挂十三条动作清单（#1860：能力主入口只在命令面板；页面体 data-vc-changes-row 为 0，实得 ' + a2Rows.length + ' 行）')

  // A3：提交区真渲染 —— 没有说明时提交按钮禁用并常驻原因，写了说明就解除禁用、预览跟着变。
  const a3Ui = function (message) { return { commit: Object.assign({}, view.vcCommitInitialState(), { form: commitFormOf(), message: message }) } }
  // #1860 起提交区按原型 composer 排：先要有已暂存的文件，提交按钮才可能解除禁用。
  const a3Changes = { counts: { staged: 1, unstaged: 0, untracked: 0, conflicts: 0 }, files: { staged: [{ path: 'a.txt' }], unstaged: [] }, values: {}, rows: {}, handlers: {} }
  const a3Blank = pageHtmlOf(view, { page: 'changes', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: reads, changes: a3Changes, ui: a3Ui('') })
  const a3Typed = pageHtmlOf(view, { page: 'changes', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: reads, changes: a3Changes, ui: a3Ui('写一句提交信息') })
  // 锚点必须带等号与引号：原因行 span 的属性是 data-vc-commit-submit-tip，裸前缀会把它当成按钮抠出来。
  const a3BlankBtn = tagAt(a3Blank, 'data-vc-commit-submit="')
  const a3TypedBtn = tagAt(a3Typed, 'data-vc-commit-submit="')
  // 只看独立的 disabled 属性：aria-disabled="false" 里也含 disabled 这个子串，不能用 indexOf 直接判。
  const a3Disabled = function (tag) { return /(?:^|\s)disabled(?:="")?(?:\s|>)/.test(tag) }
  check(a3Disabled(a3BlankBtn) && a3Blank.indexOf('data-vc-commit-submit-tip') >= 0 && a3TypedBtn !== '' && !a3Disabled(a3TypedBtn) && a3Typed.indexOf('写一句提交信息') >= 0 && /<textarea[^>]*data-vc-commit-msg="1"/.test(a3Typed),
    'A3 提交区真渲染：没有提交信息时按钮禁用并写明原因，写了信息就解除禁用、说明就在提交区的多行输入框里（#1877 起原型不再画单独的预览块）')

  const rowB = rowOf(blocks, 'b.txt')
  check(!!(rowB && rowB.stageAction && rowB.stageAction.show === true), 'A4 未暂存文件行的模型里有「add」按钮')

  const rowD = rowOf(blocks, 'd.txt')
  const conflictText = String((rowD && rowD.stageAction && rowD.stageAction.text) || '')
  check(!!(rowD && rowD.stageAction && rowD.stageAction.conflict === true && rowD.stageAction.show === false) && conflictText.indexOf('命令行') >= 0 && conflictText.indexOf('侧栏终端') < 0, 'A5 冲突行没有「add」，改说「在命令行里解决」，且不再提侧栏终端（模型 ' + JSON.stringify(rowD && rowD.stageAction) + '）')

  const rowA = rowOf(blocks, 'a.txt')
  check(!!(rowA && rowA.unstageAction && rowA.unstageAction.show === true), 'A4b 已暂存文件行的模型里有「撤回」按钮')
  check(!(rowB && rowB.unstageAction && rowB.unstageAction.show) && !(rowD && rowD.unstageAction && rowD.unstageAction.show), 'A4c 未暂存与冲突行没有「撤回」按钮（模型里只给已暂存那一行）')

  // A6：多远端 —— 远端页把三条远端各画一行，每行三个动作入口（改名 / 改地址 / 删除），另有「登记远端」入口。
  const a6Html = remotePageHtmlOf(view, {})
  const a6Rows = attrValuesOf(a6Html, 'data-vc-remote').join(',')
  const a6Acts = attrValuesOf(a6Html, 'data-vc-remote-act')
  check(a6Rows === 'origin,mirror,leaky' && a6Acts.length === 9 && a6Html.indexOf('data-vc-remote-add="1"') >= 0, 'A6 远端页多远端真渲染：三条远端各一行、每行三个动作入口，另有「登记远端」入口（实得 ' + a6Rows + '，动作 ' + a6Acts.length + ' 个）')
}

// ============================================================
// B 组 · 状态机（禁用一律读核心判定）
// ============================================================
function groupB(view) {
  const reasonValues = Object.keys(view.REASONS)
  const missing = reasonValues.filter((r) => !view.vcBlockKeyOf(r))
  check(missing.length === 0, 'B1 核心 REASONS 的 ' + reasonValues.length + ' 个取值逐个进映射表，都有词条键（缺的：' + (missing.join('、') || '无') + '）')

  const bare = screenOf({ repo: { bare: true }, unstaged: [fileOf('b.txt', 'unstaged')], unstagedCount: 1 })
  const bareBlocks = blocksOf(view, bare, readsOf(bare), uiOf())
  const bareId = blockOf(bareBlocks, 'identity')
  const b2 = bareId && bareId.actions && bareId.actions.pull.disabled === true && bareId.actions.pull.tip.length > 0
  check(!!b2, 'B2 verdict=block 时按钮禁用且悬停给理由（裸仓库下拉取禁用=' + !!(bareId && bareId.actions && bareId.actions.pull.disabled) + '，悬停=' + JSON.stringify(bareId && bareId.actions ? bareId.actions.pull.tip : '') + '）')

  const typedUi = uiOf({ write: { op: '', state: 'idle', message: '写一句', confirm: null, result: null } })
  const mid = screenOf({ staged: [fileOf('a.txt', 'staged')], stagedCount: 1, repo: { merging: true } })
  const midBlocks = blocksOf(view, mid, readsOf(mid), typedUi)
  const midChanges = blockOf(midBlocks, 'changes')
  const b3 = midChanges && midChanges.commitArea.disabled === false && view.vcOpStateOf(view.judge(mid, 'commit')) === 'idle'
  check(!!b3, 'B3 verdict=warn 时可点（合并进行中提交仍可点，理由在确认框/悬停里列：' + JSON.stringify(view.judge(mid, 'commit').reasons) + '）')

  const ok = screenOf({ staged: [fileOf('a.txt', 'staged')], stagedCount: 1 })
  const okBlocks = blocksOf(view, ok, readsOf(ok), typedUi)
  const okChanges = blockOf(okBlocks, 'changes')
  const b4 = okChanges && okChanges.commitArea.disabled === false && okChanges.commitArea.tip === ''
  check(!!b4, 'B4 verdict=allow 时可点、没有禁用理由（禁用=' + (okChanges ? okChanges.commitArea.disabled : '缺') + '，悬停=' + JSON.stringify(okChanges ? okChanges.commitArea.tip : '') + '）')

  const screens = [ok, mid, bare, screenOf({ identity: { detached: true, sync: 'detached' } }), screenOf({ unstaged: [fileOf('b.txt', 'unstaged')], unstagedCount: 1 })]
  let same = true
  screens.forEach((s) => {
    ['stage', 'commit', 'pull', 'push', 'fetch'].forEach((op) => {
      const d = view.judge(s, op)
      const expect = d.verdict === 'block' ? 'blocked' : 'idle'
      if (view.vcOpStateOf(d) !== expect) same = false
    })
  })
  check(same, 'B5 五个动作的状态都由核心判定来（' + screens.length + ' 个 screen × 5 个动作，界面状态与 judge 的 verdict 一一对应）')

  const noUp = screenOf({ branches: [{ short: 'main', upstream: '', upstreamGone: false }], identity: { sync: 'no-upstream' } })
  const fixed = view.vcPushDecisionOf(view.judge(noUp, 'push'))
  const gone = screenOf({ branches: [{ short: 'main', upstream: 'origin/main', upstreamGone: true }], identity: { sync: 'upstream-gone' } })
  const fixed2 = view.vcPushDecisionOf(view.judge(gone, 'push'))
  check(fixed.verdict === 'allow' && fixed2.verdict === 'allow', 'B6 推送的「没有上游 / 上游被删」不是禁用，而是走确认档（no-upstream=' + fixed.verdict + '，upstream-gone=' + fixed2.verdict + '）')

  // B8：更新远方记录只挡裸仓库；脏树、无上游、上游被删都不挡（它不碰工作树，落后与依据未知正是要用它修的）。
  const dirtyNoUp = screenOf({ unstaged: [fileOf('b.txt', 'unstaged')], unstagedCount: 1, branches: [{ short: 'main', upstream: '', upstreamGone: false }], identity: { sync: 'no-upstream', behind: 2, basisMs: null } })
  const fetchDirty = view.judge(dirtyNoUp, 'fetch')
  const fetchBare = view.judge(screenOf({ repo: { bare: true } }), 'fetch')
  check(fetchDirty.verdict === 'allow' && fetchBare.verdict === 'block' && fetchBare.reasons.includes('bare-repo'), 'B8 更新远方记录脏树无上游也放行、裸仓库拦住（脏树=' + fetchDirty.verdict + '，裸仓=' + fetchBare.verdict + '）')
  // 反证 B8r：若把更新按拉取口径判（无上游就拦），上面那一例会判成 block —— 新场景把它逮住。
  const oldFetchLikePull = dirtyNoUp.identity.sync === 'no-upstream' ? 'block' : 'allow'
  check(oldFetchLikePull === 'block' && fetchDirty.verdict === 'allow', '反证 B8r：旧方向（照拉取口径）把无上游更新判成拦住（实得 ' + oldFetchLikePull + '），新场景要求放行')

  // B7：结果不确定的两档（head-moved / head-unreadable）不归「这一步现在做不成」那一族。
  const movedKeys = ['head-moved', 'head-unreadable'].map(function (r) { return view.vcWriteErrKeyOf({ reason: r, kind: 'other' }) })
  check(movedKeys.join(',') === 'vc.writeErr.moved,vc.writeErr.moved', 'B7 head-moved / head-unreadable 走「结果不确定」那一族（实得 ' + movedKeys.join(',') + '）')
}

// ============================================================
// C 组 · 确认框（三档推送 + 拉取）
// ============================================================
async function groupC(view, logs) {
  const planExisting = { mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main', upstream: 'origin/main' }
  const planSet = { mode: 'set-upstream', remote: 'origin', branch: 'main', localBranch: 'main', upstream: '' }
  const planRecreate = { mode: 'recreate', remote: 'origin', branch: 'main', localBranch: 'main', upstream: '' }
  const cPull = view.vcConfirmOf('pull', {}, trZh)
  const cExist = view.vcConfirmOf('push', planExisting, trZh)
  const cSet = view.vcConfirmOf('push', planSet, trZh, ['origin', 'mirror'])
  const cRec = view.vcConfirmOf('push', planRecreate, trZh)
  const c1 = cPull.okText === trZh('vc.action.pull') && cExist.okText === trZh('vc.action.push') && cSet.okText === trZh('vc.action.pushSetUpstream') && cRec.okText === trZh('vc.action.pushRecreate')
  check(c1, 'C1 三档推送 + 拉取各自的主按钮文字与档位对得上（' + [cPull.okText, cExist.okText, cSet.okText, cRec.okText].join(' / ') + '）')

  const setBody = trZh('vc.confirm.pushSetUpstreamBody', { local: 'main', remote: 'origin', target: 'main' })
  const c2 = cSet.body.indexOf('origin/main') >= 0 && setBody.indexOf('设为上游') >= 0 && cSet.pickRemote === true && cSet.remotes.join(',') === 'origin,mirror'
  check(c2, 'C2 set-upstream 档正文点名目标远端与分支、写清「设为上游」，多远端时列出全部（正文=' + cSet.body + '；远端=' + cSet.remotes.join(',') + '）')

  const c3 = cSet.remote === planSet.remote && cSet.target === planSet.branch && cExist.target === planExisting.branch && cExist.remote === planExisting.remote
  check(c3, 'C3 确认框显示的目标 === 预检回包 plan 里的目标（不自己拆 origin/main）')

  const mismatchScreen = screenOf({ branches: [{ short: 'main', upstream: 'other/main', upstreamGone: false }] })
  const why = view.vcPlanMismatchOf('push', mismatchScreen, planExisting)
  const host = makeHost(function (m) {
    if (m === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: [] }, plan: planExisting, ticket: { id: 't1', checkedAtMs: NOW, expiresAtMs: NOW + 120000, op: 'push' }, remotes: ['origin'], readAtMs: NOW }
    return { ok: true }
  })
  const ops = view.vcWriteOpsOf({ ui: uiOf(), setUi: function () {}, callHost: host.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(mismatchScreen) }, setReads: function () {}, screen: mismatchScreen })
  ops.startPush('')
  await flush()
  const shapeLogs = (logs || []).filter(function (l) { return l.event === 'host.call.fail' && l.fields && l.fields.kind === 'shape' })
  check(!!why && shapeLogs.length > 0, 'C4 回包目标与界面读数不一致时按回包显示，并记一条 kind=shape（判出 ' + JSON.stringify(why) + '，日志 ' + shapeLogs.length + ' 条）')

  const pullBody = trZh('vc.confirm.pullBody')
  check(pullBody.indexOf('快进') >= 0 && pullBody.indexOf('命令行') >= 0 && pullBody.indexOf('侧栏终端') < 0, 'C5 拉取确认框正文写清「只做快进」并说清剩下的事在命令行里做，且不提侧栏终端（' + pullBody + '）')

  // C6：上游被删（宿主可能回 mode=recreate，也可能只给 upstreamGone 布尔）——两档都要走「已经不在了」那套话术。
  const recByMode = view.vcConfirmOf('push', planRecreate, trZh)
  const recByFlag = view.vcConfirmOf('push', { mode: 'set-upstream', upstreamGone: true, remote: 'origin', branch: 'feature', localBranch: 'feature' }, trZh)
  const recBody = trZh('vc.confirm.pushRecreateBody', { remote: 'origin', target: 'feature', local: 'feature' })
  const c6 = recByMode.mode === 'recreate' && recByFlag.mode === 'recreate' && recBody.indexOf('origin/feature') >= 0 && recBody.indexOf('已不存在') >= 0 && recBody.indexOf('feature') >= 0 && recByMode.okText === trZh('vc.action.pushRecreate')
  check(c6, 'C6 上游被删：mode=recreate 与 upstreamGone 布尔两种回包都走「远端分支已经不在了」那套话术（正文=' + recBody + '）')
}

// ============================================================
// D 组 · 五族失败话术（含 stale / notReady 两族与兜底）
// ============================================================
function groupD(view, writeReasons) {
  const families = ['noCredential', 'noPermission', 'conflict', 'notFastForward', 'network', 'stale', 'notReady', 'unknown']
  const missing = []
  families.forEach(function (f) {
    ['', '.limit'].forEach(function (suf) {
      ['zh', 'en'].forEach(function (lang) {
        const k = 'vc.writeErr.' + f + suf
        const v = lang === 'zh' ? LOC.zh[k] : LOC.en[k]
        if (!v || String(v).trim() === '') missing.push(k + '(' + lang + ')')
      })
    })
  })
  check(missing.length === 0, 'D1 八族主句 + limit 句中英都在且非空（缺的：' + (missing.join('、') || '无') + '）')

  const weak = ['noCredential', 'noPermission', 'conflict', 'notFastForward', 'network'].filter(function (f) {
    const s = String(LOC.zh['vc.writeErr.' + f + '.limit'] || '')
    return s.indexOf('命令行') < 0 && s.indexOf('不自动重试') < 0
  })
  // 只扫写操作那三族词条（panel / flow / vcwrite）：#1776 M4c 起页面壳族也进了 LOC，
  //   那是远端页与页面壳自己的话术，不在「五条 limit 句」这条判据的范围里。
  const stillTerminal = Object.keys(LOC_WRITE.zh).filter(function (k) { return /侧栏终端/.test(String(LOC_WRITE.zh[k])) })
  const stillTerminalEn = Object.keys(LOC_WRITE.en).filter(function (k) { return /terminal on the same row/.test(String(LOC_WRITE.en[k])) })
  check(weak.length === 0 && stillTerminal.length === 0 && stillTerminalEn.length === 0, 'D2 五条 limit 句都写到「命令行」或「不自动重试」，且中英词条里都不许再有「侧栏终端」（缺的：' + (weak.join('、') || '无') + '；中文残留：' + (stillTerminal.join('、') || '无') + '；英文残留：' + (stillTerminalEn.join('、') || '无') + '）')

  const unmapped = writeReasons.filter(function (r) { return !view.VC_WRITE_ERR_FAMILY[r] })
  check(unmapped.length === 0, 'D3 宿主 ' + writeReasons.length + ' 个 WRITE_REASONS 逐个都在映射表里（没家的：' + (unmapped.join('、') || '无') + '）')

  check(view.vcWriteErrKeyOf({ reason: 'unknown-write-failure', kind: 'other' }) === 'vc.writeErr.unknown', 'D4 表里没有的失败走兜底键')

  const res = view.vcOpResultOf('pull', { ok: false, error: { kind: 'exit', reason: 'unknown-write-failure', message: 'git 原话', hint: '宿主给的一句中文' } })
  check(res.tip === '宿主给的一句中文' && res.key.indexOf('vc.writeErr.') === 0 && res.key !== res.tip, 'D5 宿主原话进悬停（tip），可见文字只用词条键（key=' + res.key + '）')

  const unDone = view.vcOpResultOf('unstage', { ok: true, unstaged: ['a.txt', 'b.txt'], atMs: NOW })
  check(unDone.state === 'done' && unDone.key === 'vc.op.doneUnstage' && unDone.params.n === '2' && trZh(unDone.key, unDone.params) === '已撤回暂存 2 个文件', 'D5b 撤回成功话术带数（实得 ' + JSON.stringify(unDone) + '）')
  const unFailUi = uiOf({ write: { op: 'unstage', state: 'failed', message: '', confirm: null, result: { state: 'failed', key: 'vc.writeErr.unknown', params: {}, limitKey: 'vc.writeErr.unknown.limit', verb: 'vc.op.failed', tip: '', retryable: true, moved: false }, remoteChoice: null } })
  const unFailModel = view.vcWriteUiOf(screenOf(), unFailUi, { t: trZh, nowMs: NOW, decisions: decisionsOf(view, screenOf()) })
  check(!!(unFailModel.result && unFailModel.result.ai) && unFailModel.result.ai.opText === trZh('vc.action.unstage'), 'D5c 撤回失败的 AI 交接写的是「撤回」不是提交')

  // D6：确认框里写清票据有效期（停久了才知道为什么会说「已过期」）。
  const s6 = screenOf()
  const ui6 = uiOf({ write: { op: '', state: 'idle', message: '', confirm: { op: 'push', plan: { mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' }, ticket: { id: 't1', expiresAtMs: NOW + 120000 }, remotes: [] }, result: null, remoteChoice: null } })
  const m6 = view.vcWriteUiOf(s6, ui6, { t: trZh, nowMs: NOW, decisions: decisionsOf(view, s6) })
  check(!!m6.confirm && /120 秒内有效/.test(m6.confirm.ttlText), 'D6 确认框带票据有效期那句（实得 ' + JSON.stringify(m6.confirm && m6.confirm.ttlText) + '）')
}

// ============================================================
// E 组 · 操作中与操作后
// ============================================================
async function groupE(view) {
  // E1：执行中只发那一张写电话，一条只读电话都不发
  const screen = richScreen()
  const host1 = makeHost(function (m) { return m === 'wf.gitStage' ? { ok: true, staged: ['b.txt'], atMs: NOW } : { ok: true, screen: screen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW, diffs: {}, log: { commits: [], hasMore: false, fetched: 0 } } })
  const ops1 = view.vcWriteOpsOf({ ui: uiOf(), setUi: function () {}, callHost: host1.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(screen) }, setReads: function () {}, screen: screen })
  ops1.stagePaths(['b.txt'])
  const during = host1.methods().slice()
  const readDuring = during.filter(function (m) { return m === 'wf.gitStatus' || m === 'wf.gitDiff' || m === 'wf.gitLog' }).length
  check(readDuring === 0 && during.join(',') === 'wf.gitStage', 'E1 执行中只发那一张写电话，零只读调用（实测 ' + JSON.stringify(during) + '）')
  const host1b = makeHost(function (m) { return m === 'wf.gitUnstage' ? { ok: true, unstaged: ['a.txt'], atMs: NOW } : { ok: true, screen: screen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW, diffs: {}, log: { commits: [], hasMore: false, fetched: 0 } } })
  const ops1b = view.vcWriteOpsOf({ ui: uiOf(), setUi: function () {}, callHost: host1b.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(screen) }, setReads: function () {}, screen: screen })
  ops1b.unstagePaths(['a.txt'])
  check(host1b.methods().join(',') === 'wf.gitUnstage', 'E1b 撤回只发 wf.gitUnstage 一张电话（实测 ' + JSON.stringify(host1b.methods()) + '）')
  await flush()

  // E2：running / failed 时旧读数仍在，且依据时间照旧
  const runningUi = uiOf({ write: { op: 'stage', state: 'running', message: '', confirm: null, result: null } })
  const runningBlocks = blocksOf(view, screen, readsOf(screen), runningUi)
  const runningId = blockOf(runningBlocks, 'identity')
  const writeModel = view.vcWriteUiOf(screen, runningUi, { t: trZh, nowMs: NOW, decisions: decisionsOf(view, screen) })
  check(!!runningId && !!runningId.readAtText && writeModel.runningText !== '' && String(runningId.readAtText || '') !== '', 'E2 running 时旧读数仍在、依据时间照旧（readAt=' + JSON.stringify(runningId ? runningId.readAtText : '') + '，执行中那句=' + JSON.stringify(writeModel.runningText) + '）')

  // E3：成功后各读一次首屏；提交再多读一次历史第一页
  const host3 = makeHost(function (m) {
    if (m === 'wf.gitStage') return { ok: true, staged: ['b.txt'], atMs: NOW }
    if (m === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: [] }, plan: { mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' }, ticket: { id: 't9', checkedAtMs: NOW, expiresAtMs: NOW + 120000, op: 'commit' }, readAtMs: NOW }
    if (m === 'wf.gitCommit') return { ok: true, committed: true, headBefore: 'a', headAfter: 'b', atMs: NOW }
    if (m === 'wf.gitStatus') return { ok: true, screen: screen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }
    if (m === 'wf.gitLog') return { ok: true, commits: [], skip: 0, requested: 50, returned: 0, hasMore: false }
    return { ok: true }
  })
  const stagedScreen = screenOf({ staged: [fileOf('a.txt', 'staged')], stagedCount: 1 })
  const ops3 = view.vcWriteOpsOf({ ui: uiOf({ write: { op: '', state: 'idle', message: '写一句', confirm: null, result: null } }), setUi: function () {}, callHost: host3.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(stagedScreen) }, setReads: function () {}, screen: stagedScreen })
  ops3.submitCommit()
  await flush(10)
  const statusAfter = host3.countOf('wf.gitStatus')
  const logAfter = host3.countOf('wf.gitLog')
  check(statusAfter === 1 && logAfter === 1, 'E3 提交成功后恰好重读一次首屏 + 一次历史第一页（status=' + statusAfter + '，log=' + logAfter + '）')

  // E4：提交失败且 HEAD 变了 → 不给重试，文案是「HEAD 已经变了」那一族
  const res4 = view.vcOpResultOf('commit', { ok: false, error: { kind: 'other', reason: 'unknown-write-failure', message: 'x', hint: 'h' }, headBefore: 'a', headAfter: 'b' })
  check(res4.state === 'failed' && res4.moved === true && res4.retryable === false && res4.key === 'vc.writeErr.moved' && res4.verb === 'vc.op.unknown', 'E4 提交失败且 HEAD 变了：不重试、动作词是「结果不确定」而不是「没做成」（retryable=' + res4.retryable + '，moved=' + res4.moved + '，key=' + res4.key + '，verb=' + res4.verb + '）')

  // E5：拉取失败后重试必须先重新预检（第二次点击先发 wf.gitWriteCheck）
  const host5 = makeHost(function (m) {
    if (m === 'wf.gitWriteCheck') return { ok: false, error: { kind: 'blocked', reason: 'stale-head', message: '', hint: 'h' } }
    return { ok: true }
  })
  const okScreen = screenOf()
  const uiBox = { ui: uiOf() }
  const ops5 = view.vcWriteOpsOf({ ui: uiBox.ui, setUi: function (fn) { uiBox.ui = fn(uiBox.ui) }, callHost: host5.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(okScreen) }, setReads: function () {}, screen: okScreen })
  ops5.startPull()
  await flush()
  // 真机上每次渲染都会重建这一层，所以失败之后拿到的是带 result 的新一份。
  const ops5b = view.vcWriteOpsOf({ ui: uiBox.ui, setUi: function (fn) { uiBox.ui = fn(uiBox.ui) }, callHost: host5.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(okScreen) }, setReads: function () {}, screen: okScreen })
  ops5b.retryResult()
  await flush()
  check(host5.countOf('wf.gitWriteCheck') === 2, 'E5 拉取失败后重试重新预检（wf.gitWriteCheck 调用 ' + host5.countOf('wf.gitWriteCheck') + ' 次）')

  // E6：同一帧里连点两次提交，只发一次预检（重入闸）；且确认框连点两次确定只发一次写电话。
  const host6 = makeHost(function (m) {
    if (m === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: [] }, plan: { mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' }, ticket: { id: 't6', checkedAtMs: NOW, expiresAtMs: NOW + 120000, op: 'commit' }, readAtMs: NOW }
    if (m === 'wf.gitCommit') return { ok: true, committed: true, headBefore: 'a', headAfter: 'b', atMs: NOW }
    if (m === 'wf.gitStatus') return { ok: true, screen: stagedScreen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }
    if (m === 'wf.gitLog') return { ok: true, commits: [], hasMore: false }
    return { ok: true }
  })
  const uiBox6 = { ui: uiOf({ write: { op: '', state: 'idle', message: '写一句', confirm: null, result: null, remoteChoice: null } }) }
  const mk6 = function () { return view.vcWriteOpsOf({ ui: uiBox6.ui, setUi: function (fn) { uiBox6.ui = fn(uiBox6.ui) }, callHost: host6.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(stagedScreen) }, setReads: function () {}, screen: stagedScreen }) }
  const ops6 = mk6()
  ops6.submitCommit()
  ops6.submitCommit()
  await flush()
  const preChecks = host6.countOf('wf.gitWriteCheck')
  const ops6b = mk6()
  ops6b.confirmNow()
  ops6b.confirmNow()
  await flush(8)
  const commits = host6.countOf('wf.gitCommit')
  check(preChecks === 1 && commits === 1, 'E6 同帧连点两次提交只发一次预检、连点两次确定只发一次写电话（预检=' + preChecks + '，提交=' + commits + '）')

  // E7：推送成功的措辞按**预检 plan.mode** 分三档（执行回包对 recreate 档仍回 existing-upstream，分不出来）。
  const pushReply = { ok: true, mode: 'existing-upstream', remote: 'origin', branch: 'main', upToDate: false, atMs: NOW }
  const rExisting = view.vcOpResultOf('push', pushReply, { mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' })
  const rSet = view.vcOpResultOf('push', pushReply, { mode: 'set-upstream', remote: 'origin', branch: 'main', localBranch: 'main' })
  const rRec = view.vcOpResultOf('push', pushReply, { mode: 'recreate', remote: 'origin', branch: 'feature', localBranch: 'feature' })
  const e7 = rExisting.key === 'vc.op.donePush' && rSet.key === 'vc.op.donePushSetUpstream' && rRec.key === 'vc.op.donePushRecreate' && rRec.params.local === 'feature' && rRec.params.remote === 'origin' && rRec.params.target === 'feature' && rExisting.key !== rSet.key && rSet.key !== rRec.key
  const recSentence = trZh(rRec.key, rRec.params)
  check(e7 && recSentence.indexOf('origin/feature') >= 0 && recSentence.indexOf('feature') >= 0, 'E7 推送成功分三档：existing / set-upstream / recreate 各自一句，recreate 那句点名 remote/target/local（' + recSentence + '）')
}

// ============================================================
// G 组 · 跨层比照（核心判定 / 电话名 / 回包字段）
// ============================================================
async function groupG(view) {
  const missing = Object.keys(view.REASONS).filter(function (r) { return r !== 'ok' && !view.VC_BLOCK_KEY[r] })
  check(missing.length === 0, 'G1 核心 REASONS 每个取值都有词条键（缺的：' + (missing.join('、') || '无') + '）')

  const screens = [screenOf(), richScreen(), screenOf({ repo: { bare: true } }), screenOf({ identity: { detached: true, sync: 'detached' } }), screenOf({ identity: { sync: 'no-upstream' }, branches: [] })]
  let same = true
  screens.forEach(function (s) {
    ;['stage', 'commit', 'pull', 'push', 'fetch'].forEach(function (op) {
      const raw = view.judge(s, op)
      // 推送那一条界面用的是 vcPushDecisionOf（摘掉「没有上游 / 上游被删」），照同一口径比。
      const d = op === 'push' ? view.vcPushDecisionOf(raw) : raw
      const ui = view.vcWriteUiOf(s, uiOf(), { t: trZh, nowMs: NOW, decisions: decisionsOf(view, s) })
      if (ui.ops[op].disabled !== (d.verdict === 'block')) same = false
    })
  })
  check(same, 'G2 同一批 screen 喂 rules.judge 与界面状态函数，两边结论一致（' + screens.length + ' 个 screen × 5 个动作）')

  const phones = view.VC_WRITE_PHONES
  const namesOk = phones.check === 'wf.gitWriteCheck' && phones.stage === 'wf.gitStage' && phones.unstage === 'wf.gitUnstage' && phones.commit === 'wf.gitCommit' && phones.pull === 'wf.gitPull' && phones.fetch === 'wf.gitFetch' && phones.push === 'wf.gitPush'
  const host = makeHost(function () { return { ok: true } })
  view.vcRunCheck(host.call, 'D:/w/repo', 'pull', {})
  view.vcRunWrite(host.call, 'D:/w/repo', 'stage', { paths: ['a.txt'] })
  view.vcRunWrite(host.call, 'D:/w/repo', 'commit', { ticketId: 't1', requestId: 'r1', message: 'm' })
  await flush()
  const checkCall = host.calls[0] || { method: '', args: {} }
  const stageCall = host.calls[1] || { method: '', args: {} }
  const commitCall = host.calls[2] || { method: '', args: {} }
  const argsOk = checkCall.args.cwd === 'D:/w/repo' && checkCall.args.op === 'pull' && Array.isArray(stageCall.args.paths) && stageCall.args.paths.join(',') === 'a.txt' && commitCall.args.ticketId === 't1' && commitCall.args.message === 'm'
  check(namesOk && argsOk, 'G3 预检与六条写电话的名字、入参形状与宿主契约一致（' + [checkCall.method, stageCall.method, commitCall.method].join(' / ') + '）')

  const keys = ['stage', 'unstage', 'commit', 'pull', 'fetch', 'push'].map(function (op) {
    const reply = op === 'stage' ? { ok: true, staged: ['a'] } : (op === 'unstage' ? { ok: true, unstaged: ['a'] } : (op === 'commit' ? { ok: true, committed: true, headAfter: 'b' } : (op === 'pull' ? { ok: true, mode: 'fast-forward' } : (op === 'fetch' ? { ok: true, mode: 'fetched', remote: 'origin' } : { ok: true, mode: 'existing-upstream', remote: 'origin', branch: 'main' }))))
    return view.vcOpResultOf(op, reply).key
  })
  check(keys.join(',') === 'vc.op.doneStage,vc.op.doneUnstage,vc.op.doneCommit,vc.op.donePull,vc.op.doneFetch,vc.op.donePush', 'G4 六条写电话的成功回包各自映射到结果句词条（' + keys.join(',') + '）')

  // G5：更新远方记录拿到票后直接执行，不弹确认框；多远端定不出时与推送同一品格，先选一个。
  const fetchHost = makeHost(function (m) {
    if (m === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: [] }, plan: { mode: 'fetch', remote: 'origin', branch: '', localBranch: 'main' }, ticket: { id: 'tf', checkedAtMs: NOW, expiresAtMs: NOW + 120000, op: 'fetch' }, readAtMs: NOW }
    if (m === 'wf.gitFetch') return { ok: true, mode: 'fetched', remote: 'origin', atMs: NOW }
    return { ok: true }
  })
  let fetchConfirm = 'unset'
  const fetchOps = view.vcWriteOpsOf({ ui: uiOf(), setUi: function (fn) { const cur = uiOf(); const next = fn(cur); if (next.write && next.write.confirm) fetchConfirm = next.write.confirm }, callHost: fetchHost.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(screenOf()) }, setReads: function () {}, screen: screenOf() })
  fetchOps.startFetch('')
  await flush()
  check(fetchHost.methods().slice(0, 2).join(',') === 'wf.gitWriteCheck,wf.gitFetch' && fetchConfirm === 'unset', 'G5 更新远方记录预检通过后直跑执行电话、不弹确认框（实发 ' + fetchHost.methods().join(',') + '，确认框=' + JSON.stringify(fetchConfirm) + '）')
  // 反证 G5r：若把更新接到确认框那条路上，上面这一串会多出等待确认、执行电话发不出去 —— 直跑无确认正是要守的形状。
  check(fetchHost.countOf('wf.gitFetch') === 1, '反证 G5r：直跑形状下执行电话恰发一次（实发 ' + fetchHost.countOf('wf.gitFetch') + ' 次）')
}


// K 组 · 失败种类分档（宿主新档 env-fs：文件服务读不到运行状态，不许再指向 git）
// ============================================================
function groupK(view, React, DswsCtx, TipStub, IcStub) {
  const kEnvFs = view.vcFailKeyOf('env-fs')
  const kEnv = view.vcFailKeyOf('env')
  const zhEnvFs = String(LOC.zh[kEnvFs] || '')
  const enEnvFs = String(LOC.en[kEnvFs] || '')
  const zhEnv = String(LOC.zh[kEnv] || '')
  check(kEnvFs === 'vc.fail.envFs' && zhEnvFs.indexOf('运行状态') >= 0 && zhEnvFs.indexOf('文件服务') >= 0 && !/git/i.test(zhEnvFs) && !/git/i.test(enEnvFs),
    'K1 env-fs 有自己那一档：主句含「运行状态 / 文件服务」，中英都不提 git（zh=' + zhEnvFs + '）')
  check(kEnv === 'vc.fail.noGit' && /git/i.test(zhEnv), 'K2 env 仍留给「真的找不到 git」（zh=' + zhEnv + '）')

  // K3 文案级：env-fs 那一档与「找不到 git」那一档必须是两句不同的人话（渲染后的可见文字由真挂载门禁守）。
  check(zhEnvFs.length > 0 && zhEnvFs.indexOf('运行状态') >= 0 && !/git/i.test(zhEnvFs) && zhEnvFs !== zhEnv, 'K3 env-fs 那一档文案说「运行状态 / 文件服务」、不提 git，也不是「找不到 git」那句（zh=' + zhEnvFs + '）')
}

// ============================================================
// I 组 · 跨层：真宿主回包 → 真命令 → 确认框正文（对抗式审查第 8 节推荐的那一条）
// ============================================================
async function groupI(view, pushPlanOf, pushArgs) {
  const cases = [
    { name: 'existing', args: { branch: 'main', upstream: 'origin/main', upstreamGone: false, remotes: ['origin'], requestedRemote: null } },
    { name: 'set-upstream', args: { branch: 'feature/x', upstream: null, upstreamGone: false, remotes: ['origin'], requestedRemote: null } },
    { name: 'recreate', args: { branch: 'feature', upstream: 'origin/feature', upstreamGone: true, remotes: ['origin'], requestedRemote: null } },
    { name: 'slash-remote', args: { branch: 'main', upstream: null, upstreamGone: false, remotes: ['my/fork'], requestedRemote: null } },
  ]
  const bad = []
  const detail = []
  cases.forEach(function (c) {
    const pp = pushPlanOf(c.args)
    if (!pp || pp.ok !== true) { bad.push(c.name + ':宿主没给出 plan(' + (pp && pp.reason) + ')'); return }
    const plan = pp.plan
    const argv = pushArgs(plan)
    const argvText = argv.join(' ')
    const confirm = view.vcConfirmOf('push', plan, trZh)
    const remote = String(plan.remote || '')
    const target = String(plan.branch || '')
    const local = String(plan.localBranch || '')
    const argvOk = argvText.indexOf(' ' + remote + ' ') >= 0 && argvText.indexOf(local + ':' + target) >= 0 && argvText.indexOf('--force') < 0 && argvText.indexOf(' +') < 0
    const bodyOk = confirm.body.indexOf(remote + '/' + target) >= 0 && confirm.body.indexOf(local) >= 0 && confirm.remote === remote && confirm.target === target && confirm.localBranch === local
    if (!argvOk || !bodyOk) bad.push(c.name + ':argv=' + argvText + ' 正文=' + confirm.body)
    detail.push(c.name + '[' + plan.mode + '] ' + argvText + ' ⇄ ' + confirm.body)
  })
  check(bad.length === 0, 'I1 四档真 plan → 真 argv → 确认框正文：remote/target/local 与命令完全一致（' + (bad.join('；') || detail.join(' ｜ ')) + '）')

  // I2：多远端 + 没有上游 —— 用真 pushPlanOf 的失败档造回包（顶层 remotes），界面必须有可点入口。
  const need = pushPlanOf({ branch: 'main', upstream: null, upstreamGone: false, remotes: ['origin', 'mirror'], requestedRemote: null })
  const reply = { ok: false, error: { kind: 'args', reason: need.reason, message: '', hint: '这个仓库有多个远端，面板不替你挑。请选一个远端再确认。' }, remotes: need.candidates }
  const choice = view.vcRemoteChoiceOf(reply)
  const host = makeHost(function (m, args) {
    if (m === 'wf.gitWriteCheck' && !args.remote) return reply
    if (m === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: [] }, plan: { mode: 'set-upstream', remote: args.remote, branch: 'main', localBranch: 'main' }, ticket: { id: 't8', op: 'push' }, readAtMs: NOW }
    return { ok: true }
  })
  const uiBox = { ui: uiOf() }
  const mk = function () { return view.vcWriteOpsOf({ ui: uiBox.ui, setUi: function (fn) { uiBox.ui = fn(uiBox.ui) }, callHost: host.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(screenOf()) }, setReads: function () {}, screen: screenOf() }) }
  mk().startPush('')
  await flush()
  const model = view.vcWriteUiOf(screenOf(), uiBox.ui, { t: trZh, nowMs: NOW, decisions: decisionsOf(view, screenOf()) })
  const shown = !!(model.remoteChoice && model.remoteChoice.remotes.join(',') === 'origin,mirror')
  mk().pickRemote('mirror')
  await flush()
  const remoteArg = (host.calls.filter(function (c) { return c.method === 'wf.gitWriteCheck' && c.args.remote })[0] || { args: {} }).args.remote
  check(choice.show === true && shown && remoteArg === 'mirror', 'I2 多远端 + 没有上游：真回包的候选进界面、点一个就带 remote 重跑预检（入口=' + JSON.stringify(model.remoteChoice && model.remoteChoice.remotes) + '，重跑带的 remote=' + JSON.stringify(remoteArg) + '）')

  // I3：真回包的 plan 里 remote 含斜杠时，确认框正文与 argv 仍然逐字一致（防「客户端自己拆」复发）。
  const slash = pushPlanOf({ branch: 'main', upstream: null, upstreamGone: false, remotes: ['foo/bar'], requestedRemote: null })
  const slashBody = view.vcConfirmOf('push', slash.plan, trZh).body
  check(slash.ok === true && slashBody.indexOf('foo/bar/main') >= 0 && pushArgs(slash.plan).join(' ').indexOf('foo/bar') >= 0, 'I3 远端名含斜杠：正文与命令都写 foo/bar/main，客户端没有自己拆（正文=' + slashBody + '）')

  // I4：recreate 档的正文与命令一致（宿主新档落地后这一条不用改）。
  const rec = pushPlanOf({ branch: 'feature', upstream: 'origin/feature', upstreamGone: true, remotes: ['origin'], requestedRemote: null })
  const recConfirm = view.vcConfirmOf('push', rec.plan, trZh)
  const recArgv = pushArgs(rec.plan).join(' ')
  check(recConfirm.mode === 'recreate' && recConfirm.body.indexOf('origin/feature') >= 0 && recConfirm.body.indexOf('已不存在') >= 0 && recArgv.indexOf('origin') >= 0 && recArgv.indexOf('feature:feature') >= 0, 'I4 上游被删那一档：正文说「已经不在了」、命令是显式 feature:feature（正文=' + recConfirm.body + '；命令=' + recArgv + '）')
}

// ============================================================
// H 组 · 反证（每一条都要把对应的判据改红）
// ============================================================
async function groupH(React, DswsCtx, TipStub, IcStub, logs) {
  const build = (patch, exportsList) => buildView(patch, React, DswsCtx, TipStub, IcStub, null, logs, trZh, exportsList)

  const v1 = build(function (s) { return s.replace("const base = { op: String(op || ''), mode: mode, remote: remote, target: target,", "const base = { op: String(op || ''), mode: mode, remote: '', target: '',") })
  const h1 = v1.vcConfirmOf('push', { mode: 'existing', remote: 'origin', branch: 'main' }, trZh).target === 'main'
  check(h1 === false, 'H1 反证：把推送确认框里的目标删掉 → C3 那条当场不成立')

  const v2 = build(function (s) { return s.replace("return v === 'allow' || v === 'warn' ? 'idle' : 'blocked'", "return 'idle'") })
  const bare = screenOf({ repo: { bare: true } })
  const h2 = v2.vcOpStateOf(v2.judge(bare, 'pull')) === 'blocked'
  check(h2 === false, 'H2 反证：把禁用判据改成永远可点 → B2 那条当场不成立')

  const v3 = build(function (s) { return s.replace("body: t('vc.confirm.pushSetUpstreamBody'", "body: t('vc.confirm.pushBody'") })
  const h3 = v3.vcConfirmOf('push', { mode: 'set-upstream', remote: 'origin', branch: 'main', localBranch: 'main' }, trZh).body
  check(h3.indexOf('设为上游') < 0, 'H3 反证：把 set-upstream 那档正文换成普通推送 → C2 那条当场不成立')

  const savedLimit = LOC.zh['vc.writeErr.conflict.limit']
  LOC.zh['vc.writeErr.conflict.limit'] = ''
  const h4 = !String(LOC.zh['vc.writeErr.conflict.limit'] || '').trim()
  LOC.zh['vc.writeErr.conflict.limit'] = savedLimit
  check(h4, 'H4 反证：把一条 limit 句抹掉 → D1 那条当场不成立')

  // #1253：真源转 .ts 后形参多了类型标注（paths: any），锚点用正则把标注写成可选的。
  const v5 = build(function (s) { return s.replace(/const stagePaths = guarded\(function \(paths(?:: any)?\) \{/, "const stagePaths = guarded(function (paths) { callHost('wf.gitStatus', { cwd: cwd })") })
  const screen = richScreen()
  const host5 = makeHost(function () { return { ok: true, staged: ['b.txt'], atMs: NOW } })
  const ops5 = v5.vcWriteOpsOf({ ui: uiOf(), setUi: function () {}, callHost: host5.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(screen) }, setReads: function () {}, screen: screen })
  ops5.stagePaths(['b.txt'])
  const read5 = host5.methods().filter(function (m) { return m === 'wf.gitStatus' }).length
  await flush()
  check(read5 > 0, 'H5 反证：执行中偷发一次只读电话 → E1 那条当场不成立（实测 ' + read5 + ' 次）')

  const shortExports = EXPORTS.filter(function (n) { return n !== 'vcConfirmOf' })
  const v6 = build(null, shortExports)
  check(typeof v6.vcConfirmOf === 'undefined', 'H6 反证：拼装名单里去掉一个新导出 → 拼出来的模块就没有那个导出（守的是拼接台自己）')

  // H7：把「多远端要用户选」那一档的判据改坏（show 永远 false）→ A6/I2 那条不成立。
  const v7 = build(function (s) { return s.replace("show: r.ok === false && String(err.reason || '') === 'need-remote-choice' && remotes.length > 0,", "show: false,") })
  const h7 = v7.vcRemoteChoiceOf({ ok: false, error: { reason: 'need-remote-choice' }, remotes: ['origin', 'mirror'] }).show === true
  check(h7 === false, 'H7 反证：把「多远端要用户选」的判据改坏 → A6/I2 那条当场不成立')

  // H8：把重入闸拆掉（guarded 直接放行）→ E6 那条不成立。
  const v8 = build(function (s) { return s.replace('      if (inFlight) return null', '      if (false) return null') })
  const host8 = makeHost(function (m) {
    if (m === 'wf.gitWriteCheck') return { ok: true, decision: { verdict: 'allow', reasons: [] }, plan: { mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' }, ticket: { id: 't8b', op: 'commit' }, readAtMs: NOW }
    if (m === 'wf.gitCommit') return { ok: true, committed: true, headBefore: 'a', headAfter: 'b', atMs: NOW }
    return { ok: true }
  })
  const staged8 = screenOf({ staged: [fileOf('a.txt', 'staged')], stagedCount: 1 })
  const uiBox8 = { ui: uiOf({ write: { op: '', state: 'idle', message: '写一句', confirm: null, result: null, remoteChoice: null } }) }
  const mk8 = function () { return v8.vcWriteOpsOf({ ui: uiBox8.ui, setUi: function (fn) { uiBox8.ui = fn(uiBox8.ui) }, callHost: host8.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(staged8) }, setReads: function () {}, screen: staged8 }) }
  const ops8 = mk8()
  ops8.submitCommit()
  ops8.submitCommit()
  await flush()
  check(host8.countOf('wf.gitWriteCheck') > 1, 'H8 反证：把重入闸拆掉 → E6 那条当场不成立（实测预检 ' + host8.countOf('wf.gitWriteCheck') + ' 次）')
}

// ============================================================
// M 组 · 性能（#857）：竞态 / 工作区污染 / 缓存上限 / 同键在途不重复发
//   每一项都要有正反两面：正常落库 + 反向（旧回包/换工作区/超上限/去标记）当场被拦。
// ============================================================
async function groupM(view) {
  const diffCalls = function (calls, rev, path) {
    return calls.filter(function (c) {
      if (!c || c.method !== 'wf.gitDiff') return false
      if (rev !== undefined && String((c.args && c.args.rev) || '') !== String(rev)) return false
      if (path !== undefined && String((c.args && c.args.path) || '') !== String(path)) return false
      return true
    })
  }
  const pendingHost = function () {
    const calls = []
    const resolvers = []
    const call = function (method, args) {
      calls.push({ method: method, args: args })
      return new Promise(function (resolve) { resolvers.push(resolve) })
    }
    return { calls: calls, resolvers: resolvers, call: call }
  }
  const baseUi = function (openCommit) {
    return { fileShown: {}, openDiff: '', openCommit: openCommit || '', write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null } }
  }
  const wireOps = function (reads, cwd, ref, marks, openCommit) {
    let current = reads
    const readsRef = { current: current }
    let ui = baseUi(openCommit)
    const applied = []
    const setReads = function (next) { current = (typeof next === 'function') ? next(current) : next; readsRef.current = current; applied.push(current) }
    const setUi = function (n) { ui = n }
    const host = pendingHost()
    const ops = view.vcDiffOpsOf({ ui: ui, setUi: setUi, setReads: setReads, readsRef: readsRef, callHost: host.call, cwd: cwd, stateCwdRef: ref, vcDiffOpenKeyOf: view.vcDiffOpenKeyOf, vcReadDiff: view.vcReadDiff, vcReadCommitFiles: view.vcReadCommitFiles, vcReadCommitFileDiff: view.vcReadCommitFileDiff, vcApplyDiffReply: view.vcApplyDiffReply, vcApplyCommitReply: view.vcApplyCommitReply, vcReadsOf: view.vcReadsOf, vcMarkDiffLoading: marks && marks.diff ? marks.diff : view.vcMarkDiffLoading, vcMarkCommitLoading: view.vcMarkCommitLoading, vcMarkCommitFileDiffLoading: view.vcMarkCommitFileDiffLoading, vcApplyCommitFileDiffReply: view.vcApplyCommitFileDiffReply })
    return { ops: ops, host: host, applied: applied, cur: function () { return current }, ref: readsRef, cwdRef: ref }
  }
  const okLines = function (text) { return { ok: true, lines: [{ kind: 'add', text: text }], reason: 'ok', truncated: false } }
  const rowA = { path: 'a.txt', untracked: false, group: 'unstaged' }

  // M1 未提交差异：后到的旧回包不顶掉新的，且与落库顺序无关。
  {
    const h = pendingHost()
    const base0 = view.vcNewReads()
    const p1 = view.vcReadDiff(base0, h.call, 'D:/w/repo', 'a.txt', false)
    const marked = view.vcMarkDiffLoading(base0, 'a.txt')
    const p2 = view.vcReadDiff(marked, h.call, 'D:/w/repo', 'a.txt', false)
    await flush()
    check(h.calls.length === 2 && diffCalls(h.calls, undefined, 'a.txt').length === 2, 'M1 未提交差异连读两次发两枪（同键两枪是竞态的前提）')
    h.resolvers[1](okLines('+new'))
    const r2 = await p2
    h.resolvers[0](okLines('+old'))
    const r1 = await p1
    const seqOk = r2.diffs['a.txt'].seq > r1.diffs['a.txt'].seq
    const lateFirst = view.vcApplyDiffReply(view.vcApplyDiffReply(view.vcNewReads(), r2), r1)
    const earlyFirst = view.vcApplyDiffReply(view.vcApplyDiffReply(view.vcNewReads(), r1), r2)
    check(seqOk && lateFirst.diffs['a.txt'].lines[0].text === '+new' && earlyFirst.diffs['a.txt'].lines[0].text === '+new', 'M1 晚到的旧回包不顶掉新的：先落新再落旧、与落库顺序无关（代际 ' + r1.diffs['a.txt'].seq + ' → ' + r2.diffs['a.txt'].seq + '）')
  }

  // M1b 提交里某一处文件的补丁：同一形状，只是键在 commitDiffs 那张表里。
  {
    const h = pendingHost()
    const base0 = view.vcNewReads()
    const p1 = view.vcReadCommitFileDiff(base0, h.call, 'D:/w/repo', 'r1', 'a.txt')
    const marked = view.vcMarkCommitFileDiffLoading(base0, 'r1', 'a.txt')
    const p2 = view.vcReadCommitFileDiff(marked, h.call, 'D:/w/repo', 'r1', 'a.txt')
    await flush()
    const key = view.vcCommitKeyOf('r1', 'a.txt')
    h.resolvers[1](okLines('+new'))
    const r2 = await p2
    h.resolvers[0](okLines('+old'))
    const r1 = await p1
    const lateFirst = view.vcApplyCommitFileDiffReply(view.vcApplyCommitFileDiffReply(view.vcNewReads(), r2), r1)
    check(r2.commitDiffs[key].seq > r1.commitDiffs[key].seq && lateFirst.commitDiffs[key].lines[0].text === '+new', 'M1b 提交里某一处文件的补丁：晚到的旧回包同样不顶掉新的（键 ' + key.replace('\u0000', '+') + '）')
  }

  // M2 换工作区后在飞的那一枪不写进新工作区；同工作区照常落库（正反两面）。
  {
    const w = wireOps(view.vcNewReads(), 'D:/w/repo', { current: 'D:/w/repo' })
    w.ops.toggleDiff(rowA)
    await flush()
    const fired = diffCalls(w.host.calls, undefined, 'a.txt').length
    const loading = w.cur().diffs['a.txt'] && w.cur().diffs['a.txt'].state === 'loading'
    w.cwdRef.current = 'D:/other'
    w.host.resolvers[0](okLines('+stale'))
    await flush()
    check(fired === 1 && loading && w.applied.length === 1 && !w.cur().diffs['a.txt'].lines, 'M2 换工作区后旧回包直接丢掉：只写过一次 loading 标记，没有落库、没有旧补丁')
    const v = wireOps(view.vcNewReads(), 'D:/w/repo', { current: 'D:/w/repo' })
    v.ops.toggleDiff(rowA)
    await flush()
    v.host.resolvers[0](okLines('+new'))
    await flush()
    check(v.applied.length === 2 && v.cur().diffs['a.txt'].lines[0].text === '+new', 'M2b 反面：同工作区的回包照常落库（标记一次 + 落库一次）')
  }

  // M2c 提交文件清单那一路同样校验工作区。
  {
    const w = wireOps(view.vcNewReads(), 'D:/w/repo', { current: 'D:/w/repo' })
    w.ops.openCommit({ key: 'r1' })
    await flush()
    const fired = diffCalls(w.host.calls, 'r1').length
    w.cwdRef.current = 'D:/other'
    w.host.resolvers[0]({ ok: true, files: [{ path: 'a.txt' }], truncated: false, reason: 'ok' })
    await flush()
    check(fired === 1 && w.applied.length === 1 && w.cur().commit.state === 'loading', 'M2c 提交清单那一路：换工作区后旧回包同样丢掉（只剩 loading 标记）')
  }

  // M3 两个补丁缓存都封顶：超出的丢最旧的；读一次新键也一样封顶。
  {
    const max = view.VC_DIFF_CACHE_MAX
    const big = {}
    for (let i = 0; i < max + 5; i += 1) big['k' + i] = { state: 'ok', lines: [], reason: 'ok', truncated: false, error: null, seq: i + 1 }
    const out = view.vcBoundedMap(big)
    check(Object.keys(out).length === max && out['k' + (max + 4)] && !out.k0, 'M3 缓存只留最近 ' + max + ' 条：最旧的 k0 被丢掉，最新的 k' + (max + 4) + ' 还在')
    const h = pendingHost()
    const p = view.vcReadDiff({ diffs: out }, h.call, 'D:/w/repo', 'fresh.txt', false)
    await flush()
    h.resolvers[0](okLines('+x'))
    const r = await p
    check(Object.keys(r.diffs).length === max && r.diffs['fresh.txt'] && !r.diffs.k5, 'M3b 读一次新键也一样封顶：fresh.txt 进来，最旧的 k5 出去')
  }

  // M4 同键在途不重复发：第二次点只改展开状态，不再起 git 进程。
  {
    const w = wireOps(view.vcNewReads(), 'D:/w/repo', { current: 'D:/w/repo' })
    w.ops.toggleDiff(rowA)
    await flush()
    w.ops.toggleDiff(rowA)
    await flush()
    check(diffCalls(w.host.calls, undefined, 'a.txt').length === 1 && w.cur().diffs['a.txt'].state === 'loading', 'M4 同键在途只发一枪：第二次点开只改展开状态，不再起 git 进程')
    const v = wireOps(view.vcNewReads(), 'D:/w/repo', { current: 'D:/w/repo' }, { diff: function (r) { return r } })
    v.ops.toggleDiff(rowA)
    await flush()
    v.ops.toggleDiff(rowA)
    await flush()
    check(diffCalls(v.host.calls, undefined, 'a.txt').length === 2, 'M4b 反证：把同步写 loading 标记拿掉 → 第二次照发不误（同键在途的守卫靠的就是那一笔同步标记）')
  }

  // M5/M6 点开提交跳历史视图、回来跳改动视图（布局 C 的联动，回调缺席时不崩）。
  const seenViews = []
  const ops5 = view.vcDiffOpsOf({ ui: { fileShown: {}, openDiff: '', openCommit: '' }, setUi: function () {}, setReads: function () {}, readsRef: { current: view.vcNewReads() }, callHost: function () { return Promise.resolve({ ok: true, files: [], truncated: false, reason: 'ok' }) }, cwd: 'D:/w/repo', stateCwdRef: { current: 'D:/w/repo' }, vcDiffOpenKeyOf: view.vcDiffOpenKeyOf, vcReadDiff: view.vcReadDiff, vcReadCommitFiles: view.vcReadCommitFiles, vcReadCommitFileDiff: view.vcReadCommitFileDiff, vcApplyDiffReply: view.vcApplyDiffReply, vcApplyCommitReply: view.vcApplyCommitReply, vcReadsOf: view.vcReadsOf, vcMarkDiffLoading: view.vcMarkDiffLoading, vcMarkCommitLoading: view.vcMarkCommitLoading, vcMarkCommitFileDiffLoading: view.vcMarkCommitFileDiffLoading, vcApplyCommitFileDiffReply: view.vcApplyCommitFileDiffReply, onView: function (v) { seenViews.push(v) } })
  ops5.openCommit({ key: 'r9' })
  ops5.closeCommit()
  check(seenViews.join(',') === 'commits,changes', 'M5/M6 点开提交跳历史视图、回来跳改动视图（实得 ' + seenViews.join(',') + '）')
  const opsNoView = view.vcDiffOpsOf({ ui: { fileShown: {}, openDiff: '', openCommit: '' }, setUi: function () {}, setReads: function () {}, readsRef: { current: view.vcNewReads() }, callHost: function () { return Promise.resolve({ ok: true, files: [], truncated: false, reason: 'ok' }) }, cwd: 'D:/w/repo', stateCwdRef: { current: 'D:/w/repo' }, vcDiffOpenKeyOf: view.vcDiffOpenKeyOf, vcReadDiff: view.vcReadDiff, vcReadCommitFiles: view.vcReadCommitFiles, vcReadCommitFileDiff: view.vcReadCommitFileDiff, vcApplyDiffReply: view.vcApplyDiffReply, vcApplyCommitReply: view.vcApplyCommitReply, vcReadsOf: view.vcReadsOf, vcMarkDiffLoading: view.vcMarkDiffLoading, vcMarkCommitLoading: view.vcMarkCommitLoading, vcMarkCommitFileDiffLoading: view.vcMarkCommitFileDiffLoading, vcApplyCommitFileDiffReply: view.vcApplyCommitFileDiffReply })
  let noViewErr = ''
  try { opsNoView.openCommit({ key: 'r9' }); opsNoView.closeCommit() } catch (e) { noViewErr = String((e && e.message) || e) }
  check(noViewErr === '', 'M6b 反证：没传 onView 回调时点开/回来不抛错（回调缺席不崩）')

  // M4c 提交文件清单那一路同样：连点同一笔只发一枪。
  {
    const w = wireOps(view.vcNewReads(), 'D:/w/repo', { current: 'D:/w/repo' })
    w.ops.openCommit({ key: 'r1' })
    await flush()
    w.ops.openCommit({ key: 'r1' })
    await flush()
    check(diffCalls(w.host.calls, 'r1').length === 1 && w.cur().commit.state === 'loading', 'M4c 连点同一笔提交只发一枪（第二次看到 loading 就停）')
  }
}

// ============================================================
// J 组 · 真实页签渲染：确认卡 / 结果横幅 / 逐文件差异 / AI 入口
// #1776 M1 把这一组降级成了只断模型；M4c 改回渲染真页面（vcRenderTabAt 与 VersionControlTab），
//   断言落在用户真能看见的 DOM 上。J13 与 J15c 是反证：判据不是自说自话。
// ============================================================
function groupJ(view: any, React: any, DswsCtx: any, TipStub: any, IcStub: any, logs: any) {
  const rendered: string[] = []
  const renderOf = function (opts: any): string { const html = pageHtmlOf(view, opts); rendered.push(html); return html }
  const remoteOf = function (opts?: any): string { const html = remotePageHtmlOf(view, opts); rendered.push(html); return html }

  // J1 拉取（8.8）：确认卡四段齐全、票号在卡上、目标点到 origin/main。
  const j1Sync = { capabilityId: '8.8', action: 'pull-ff-only', plan: { id: '8.8', refKind: '' }, decision: 'allow', confirmRequired: true, ticket: { id: 'T-8.8', expiresAtMs: NOW + 120000 }, confirm: { verb: trZh('vc.action.pull'), target: 'origin/main' } }
  const j1Html = remoteOf({ reads: remoteReadsOf({ sync: j1Sync }), ui: { open: '8.8' } })
  check(j1Html.indexOf('data-vc-sync-confirm="1"') >= 0 && attrValuesOf(j1Html, 'data-vc-confirm-seg').join(',') === 'what,wont,reversible,verb' && j1Html.indexOf('data-focus-default="cancel"') >= 0 && j1Html.indexOf('data-vc-sync-ticket="T-8.8"') >= 0 && j1Html.indexOf('origin/main') >= 0, 'J1 拉取确认卡真渲染：四段（会动什么 / 不会动什么 / 可逆性与恢复 / 动词写后果）齐全，票号与目标都在卡上')

  // J2 设为上游并推送（8.10）：同一套确认卡，确认键写的是后果。
  const j2Sync = { capabilityId: '8.10', action: 'push-upstream', plan: { id: '8.10', refKind: '' }, decision: 'allow', confirmRequired: true, ticket: { id: 'T-8.10', expiresAtMs: NOW + 120000 }, confirm: { verb: trZh('vc.action.pushSetUpstream'), target: 'origin/main' } }
  const j2Html = remoteOf({ reads: remoteReadsOf({ sync: j2Sync }), ui: { open: '8.10' } })
  check(j2Html.indexOf('data-vc-sync-confirm="1"') >= 0 && j2Html.indexOf(trZh('vc.action.pushSetUpstream')) >= 0 && j2Html.indexOf('data-vc-sync-ticket="T-8.10"') >= 0 && j2Html.indexOf('origin/main') >= 0, 'J2 设为上游并推送的确认卡真渲染：动词是「设为上游并推送」，目标点到 origin/main')

  // J3 强推（8.12）：租约段点名旧 / 新提交号，确认卡照样在。
  const j3Old = 'd'.repeat(40)
  const j3New = 'e'.repeat(40)
  const j3Sync = { capabilityId: '8.12', action: 'force-push', plan: { id: '8.12', refKind: '' }, decision: 'allow', confirmRequired: true, ticket: { id: 'T-8.12', expiresAtMs: NOW + 120000 }, confirm: { verb: trZh('vc.action.pushRecreate'), target: 'origin/feature' }, oldOid: j3Old, newOid: j3New, readAtMs: NOW - 30000 }
  const j3Html = remoteOf({ reads: remoteReadsOf({ sync: j3Sync }), ui: { open: '8.12' } })
  check(j3Html.indexOf('data-vc-sync-lease="1"') >= 0 && j3Html.indexOf('data-vc-sync-old="' + j3Old + '"') >= 0 && j3Html.indexOf('data-vc-sync-new="' + j3New + '"') >= 0 && j3Html.indexOf('data-vc-sync-confirm="1"') >= 0, 'J3 强推的租约段真渲染：旧 / 新提交号都点名，确认卡仍在（不糊成一句「覆盖远端」）')

  // J4 失败横幅：git 原话、环节、期望与实际、上游原因一样都不省，重试入口贴在同一段里。
  const j4Git = '! [rejected] main -> main (fetch first)'
  const j4Html = remoteOf({ reads: remoteReadsOf({ sync: { capabilityId: '8.9', action: 'push', plan: { id: '8.9', refKind: '' }, decision: 'allow' } }), ui: { open: '8.9', result: { ok: false, git: j4Git, step: '推送', expected: '远端接受这次推送', actual: '远端有新提交', cause: '先拉取再推送' } } })
  check(j4Html.indexOf('data-vc-result="fail"') >= 0 && j4Html.indexOf('role="alert"') >= 0 && j4Html.indexOf(j4Git.replace(/>/g, '&gt;')) >= 0 && j4Html.indexOf('data-vc-result-action="retry"') >= 0, 'J4 推送失败的横幅真渲染：git 原话与重试入口都在触发点那一段里')

  // J5 成功横幅：命令、耗时、对象数与下一步。
  const j5Html = remoteOf({ reads: remoteReadsOf({ sync: { capabilityId: '8.9', action: 'push', plan: { id: '8.9', refKind: '' }, decision: 'allow' } }), ui: { open: '8.9', result: { ok: true, cmd: 'fetch', ms: 12, n: 1, next: '看一眼日志再决定' } } })
  check(j5Html.indexOf('data-vc-result="ok"') >= 0 && j5Html.indexOf('role="status"') >= 0 && j5Html.indexOf('fetch') >= 0 && j5Html.indexOf('看一眼日志再决定') >= 0, 'J5 成功横幅真渲染：命令名、耗时、对象数与下一步都在')

  // J6 任务区：长任务进行中要如实画任务号、状态与阶段。
  const j6Html = remoteOf({ reads: remoteReadsOf({ task: { taskId: 'task-8.9', state: 'running', phase: '推送中' } }), ui: { open: '8.9' } })
  check(j6Html.indexOf('data-vc-sync-task="1"') >= 0 && j6Html.indexOf('data-vc-sync-task-id="task-8.9"') >= 0 && j6Html.indexOf('data-vc-sync-task-phase="推送中"') >= 0, 'J6 任务区真渲染：任务号、状态与阶段都在（执行中的进度不靠猜）')

  // J7 远端页删除确认卡：预检签到票之后才出现，动作、目标与票据有效期都写清。
  const j7Confirm = { action: 'remove', ticketId: 'rt-9', requestId: 'rq-9', checkedAtMs: NOW, expiresAtMs: NOW + 120000, name: 'mirror' }
  const j7Html = remoteOf({ ui: { form: 'remove', target: 'mirror', confirm: j7Confirm } })
  check(j7Html.indexOf('data-vc-remote="origin"') >= 0 && attrValuesOf(j7Html, 'data-vc-remote').join(',') === 'origin,mirror,leaky' && j7Html.indexOf('data-vc-remote-confirm="mirror"') >= 0 && j7Html.indexOf('data-vc-remote-confirm-action="remove"') >= 0 && j7Html.indexOf('data-vc-remote-confirm-note="1"') >= 0 && j7Html.indexOf('重新预检') >= 0, 'J7 远端删除的确认卡真渲染：三条远端都列着，卡挂在 mirror 那一行上，动作与票据有效期都写清（过期要重新预检）')

  // J8 用户看得见的文字里不出现词条键名（译好了才画）。
  const jKeyHits = visibleTextOf(rendered.join('\n')).match(/vc\.[A-Za-z][A-Za-z0-9_.]*/g) || []
  check(jKeyHits.length === 0, 'J8 本组渲染出来的可见文字里没有词条键名（词典已插进页面；命中：' + (jKeyHits.join('、') || '无') + '）')

  // J10 历史页逐文件差异：五种行按读数次序画，加 / 减行各带自己的类名。
  const y5Key = view.vcCommitKeyOf(hcRev.oid, 'src/a.ts')
  const y5Reads = hcReadsOf(view, { commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [y5Key]: { state: 'ok', lines: y5Lines, truncated: false, reason: 'ok', error: null } } } })
  const j10Html = renderOf({ page: 'commits', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: y5Reads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } })
  const j10Add = /<span[^>]*vcs-hist-line-add[^>]*>([^<]*)</.exec(j10Html)
  const j10Del = /<span[^>]*vcs-hist-line-del[^>]*>([^<]*)</.exec(j10Html)
  check(j10Html.indexOf('data-vc-file-diff="src/a.ts"') >= 0 && attrValuesOf(j10Html, 'data-vc-diff-line').join(',') === 'filehead,hunk,add,del,context' && !!j10Add && j10Add[1].charAt(0) === '+' && !!j10Del && j10Del[1].charAt(0) === '-', 'J10 历史页逐文件差异真渲染：五种行按读数次序画，新增行以「+」开头、删除行以「-」开头')

  // J11 同路径不同提交互不串：缓存键带上提交号，打开哪条提交就看哪一份。
  const hcRow3 = hcRows4[3]
  const y3Key = view.vcCommitKeyOf(hcRow3.oid, 'src/a.ts')
  const j11Diffs: any = {}
  j11Diffs[y5Key] = { state: 'ok', lines: y5Lines, truncated: false, reason: 'ok', error: null }
  j11Diffs[y3Key] = { state: 'ok', lines: [{ kind: 'add', text: '+第三条提交里的另一行' }], truncated: false, reason: 'ok', error: null }
  const j11First = renderOf({ page: 'commits', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: hcReadsOf(view, { commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: j11Diffs } }), ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } })
  const j11Second = renderOf({ page: 'commits', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: hcReadsOf(view, { commits: hcRows4, reads: { commit: Object.assign({}, hcCommitOk, { rev: hcRow3.oid }), commitDiffs: j11Diffs } }), ui: { openCommit: hcRow3.oid, openFile: 'src/a.ts' } })
  check(j11First.indexOf('新的一行') >= 0 && j11First.indexOf('第三条提交里的另一行') < 0 && j11Second.indexOf('第三条提交里的另一行') >= 0 && j11Second.indexOf('新的一行') < 0, 'J11 同一路径在不同提交下的差异互不串：打开哪条提交就看哪一份（缓存键不是只按路径）')
  check(y5Key.indexOf('\u0000') >= 0 && y5Key !== y3Key && y5Key === String(hcRev.oid) + '\u0000' + 'src/a.ts', 'J12 逐文件差异的缓存键确实是「提交号 + 路径」（实得 ' + JSON.stringify(y5Key) + '）')

  // J13 反证：把缓存键改成裸路径，同一份读数就取不到了 —— 证明 J10 / J11 过的是复合键。
  const j13View = buildView(subQ("return String(rev || '') + '\\u0000' + String(path || '')", "return String(path || '')"), React, DswsCtx, TipStub, IcStub, null, [], trZh)
  const j13Html = pageHtmlOf(j13View, { page: 'commits', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: y5Reads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } })
  check(j13Html.indexOf('data-vc-file-diff="src/a.ts"') >= 0 && attrValuesOf(j13Html, 'data-vc-diff-line').length === 0, 'J13 反证：把缓存键改成裸路径，同一份读数就取不到了（差异区只剩标题、没有行）——J10 过的是复合键')

  // J14 四种读法各说各的话：还在读 / 二进制 / 合并提交 / 截断。
  const j14Of = function (read: any): string {
    const reads = hcReadsOf(view, { commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [y5Key]: read } } })
    return renderOf({ page: 'commits', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: reads, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } })
  }
  const j14Loading = j14Of(null)
  const j14Binary = j14Of({ state: 'ok', lines: [], truncated: false, reason: 'binary-diff', error: null })
  const j14Merge = j14Of({ state: 'ok', lines: [], truncated: false, reason: 'merge-commit', error: null })
  const j14Trunc = j14Of({ state: 'ok', lines: y5Lines, truncated: true, reason: 'ok', error: null })
  check(j14Loading.indexOf('data-vc-file-diff="src/a.ts"') >= 0 && j14Loading.indexOf(trZh('vc.shell.history.diffLoading')) >= 0 && attrValuesOf(j14Loading, 'data-vc-diff-line').length === 0, 'J14a 差异还在读时只画加载说法，不先画空清单冒充「没有差异」')
  check(j14Binary.indexOf('data-vc-file-diff-binary="1"') >= 0 && j14Binary.indexOf(trZh('vc.shell.history.diffBinary')) >= 0, 'J14b 二进制差异单独说一句，不硬塞文本行')
  check(j14Merge.indexOf('data-vc-file-diff-merge="1"') >= 0 && j14Merge.indexOf(trZh('vc.shell.history.diffMerge')) >= 0, 'J14c 合并提交的差异单独说一句（不把它当普通差异展示）')
  check(j14Trunc.indexOf('data-vc-file-diff-truncated="1"') >= 0 && attrValuesOf(j14Trunc, 'data-vc-diff-line').length === y5Lines.length, 'J14d 截断时先说截断，已有行照常画')

  // J15 AI 入口：旧块删掉后只靠模型断不出「按钮真画在页面上」，这里真挂载整个页签。
  const j15Conflict = firstSeedOf(view)
  j15Conflict.slices.changes.data.conflictCount = 1
  j15Conflict.slices.workspace.data.repo = Object.assign({}, j15Conflict.slices.workspace.data.repo, { rebasing: true })
  const j15Html = renderTabHtmlOf(React, DswsCtx, TipStub, IcStub, { firstScreen: { state: 'ok', data: j15Conflict, error: null } })
  const j15Kinds = attrValuesOf(j15Html, 'data-vc-ai')
  const j15Btn = /<button[^>]*data-vc-ai="conflict"[^>]*>([\s\S]*?)<\/button>/.exec(j15Html)
  check(j15Kinds.indexOf('conflict') >= 0 && j15Kinds.indexOf('midop') >= 0 && !!j15Btn && j15Btn[1].replace(/<[^>]*>/g, '').trim() === trZh('vc.action.aiHandoff'), 'J15 真页签渲染：有冲突且正在变基时画出「冲突」「进行中」两个 AI 入口，按钮文字是动词译文')
  const j15FailHtml = renderTabHtmlOf(React, DswsCtx, TipStub, IcStub, { firstScreen: { state: 'err', data: null, error: { kind: 'timeout', message: '读首屏超时' } } })
  check(attrValuesOf(j15FailHtml, 'data-vc-ai').indexOf('read-fail') >= 0, 'J15b 首屏整次读失败时画出「读失败」AI 入口')
  const j15PlainHtml = renderTabHtmlOf(React, DswsCtx, TipStub, IcStub, { firstScreen: { state: 'ok', data: firstSeedOf(view), error: null } })
  check(attrValuesOf(j15PlainHtml, 'data-vc-ai').length === 0 && j15PlainHtml.indexOf('data-vc-shell="1"') >= 0, 'J15c 反证：普通工作区（无冲突、无进行中操作）一个 AI 入口都不画')
}

// ============================================================
// L 组 · 视觉语言（真渲染 + 样式原文两面对照）
// 只守「用户一眼能分的层级」：页面层级、确认卡、正负行、等宽换行、结果语义色；
//   最后三条反证把源码改坏，对应判据当场变假 —— 证明这些断言不是恒真。
// ============================================================
function groupL(view: any, React: any, DswsCtx: any, TipStub: any, IcStub: any) {
  const css = readSource('src/client/views/versionControl/vcShellStyles.ts')

  // L1 页面层级：页面壳自己画根、页头与页标题；标题文字是词条译文。
  const l1Html = remotePageHtmlOf(view, {})
  check(l1Html.indexOf('data-vc-page="remote"') >= 0 && l1Html.indexOf('data-vc-shell="1"') >= 0 && l1Html.indexOf('vcs-page-meta') >= 0 && l1Html.indexOf('vcs-page-title') >= 0 && l1Html.indexOf(trZh('vc.shell.page.remote')) >= 0, 'L1 页面层级真渲染：根、页头与页标题都在，标题是词条译文而不是键名')

  // L2 确认卡视觉：标题 / 四段 / 按钮组四种零件在 DOM 与样式表里都齐。
  const l2Html = remotePageHtmlOf(view, { ui: { form: 'remove', target: 'mirror', confirm: { action: 'remove', ticketId: 'rt-l2', requestId: 'rq-l2', checkedAtMs: NOW, expiresAtMs: NOW + 120000, name: 'mirror' } } })
  const l2Classes = ['vcs-confirm', 'vcs-confirm-title', 'vcs-confirm-seg', 'vcs-confirm-acts']
  const l2Dom = l2Classes.every(function (c: string) { return l2Html.indexOf(c) >= 0 })
  const l2Css = l2Classes.every(function (c: string) { return css.indexOf('.' + c + '{') >= 0 })
  check(l2Dom && l2Css, 'L2 危险动作确认卡：标题 / 四段 / 按钮组四种零件在 DOM 与样式表里都齐（DOM=' + l2Dom + '，样式=' + l2Css + '）')

  // L3 正负行：新增行以 + 开头、删除行以 - 开头，且各带自己的类名与颜色规则。
  const l3Lines = hcReadsOf(view, { commits: hcRows4, reads: { commit: hcCommitOk, commitDiffs: { [view.vcCommitKeyOf(hcRev.oid, 'src/a.ts')]: { state: 'ok', lines: y5Lines, truncated: false, reason: 'ok', error: null } } } })
  const l3Html = pageHtmlOf(view, { page: 'commits', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: l3Lines, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } })
  const l3Add = /<span[^>]*vcs-hist-line-add[^>]*>([^<]*)</.exec(l3Html)
  const l3Del = /<span[^>]*vcs-hist-line-del[^>]*>([^<]*)</.exec(l3Html)
  check(!!l3Add && l3Add[1].charAt(0) === '+' && !!l3Del && l3Del[1].charAt(0) === '-' && css.indexOf('.vcs-hist-line-add{color') >= 0 && css.indexOf('.vcs-hist-line-del{color') >= 0, 'L3 正负行：+/- 开头与类名、颜色规则两面都成立（新增绿、删除用危险色）')

  // L4 等宽与换行：差异行住在一个 pre 里，逐行 display:block + pre-wrap（长行不撑破布局）。
  const l4Pre = /<pre[^>]*class="[^"]*vcs-hist-diff-lines[^"]*"/.test(l3Html)
  check(l4Pre && css.indexOf('.vcs-hist-diff-line{display:block;white-space:pre-wrap') >= 0, 'L4 差异块等宽换行：pre.vcs-hist-diff-lines 包着逐行 span，样式是 block + pre-wrap')

  // L5 结果语义色：失败是 alert 加失败色，成功是 status；失败的颜色规则在样式表里。
  const l5Sync = { capabilityId: '8.9', action: 'push', plan: { id: '8.9', refKind: '' }, decision: 'allow' }
  const l5Fail = remotePageHtmlOf(view, { reads: remoteReadsOf({ sync: l5Sync }), ui: { open: '8.9', result: { ok: false, git: 'rejected', step: '推送', expected: '被接受', actual: '被拒', cause: '先拉取' } } })
  const l5Ok = remotePageHtmlOf(view, { reads: remoteReadsOf({ sync: l5Sync }), ui: { open: '8.9', result: { ok: true, cmd: 'push', ms: 9, n: 1, next: '继续' } } })
  check(l5Fail.indexOf('vcs-result-fail') >= 0 && l5Fail.indexOf('role="alert"') >= 0 && l5Ok.indexOf('vcs-result-ok') >= 0 && l5Ok.indexOf('role="status"') >= 0 && css.indexOf('.vcs-result-fail{border-color') >= 0, 'L5 结果语义色：失败是 alert 加失败色、成功是 status，颜色规则在样式表里（不靠浏览器默认）')

  // L6 反证：把改动页统计卡的类名前缀改坏，同一份渲染结果里这个类名当场消失（证明类名判据不是恒真）。
  //   #1860 之后旧的 13 条动作面板（「不可逆」徽标）已从改动页退役，反证目标换成新版首屏的三张统计卡。
  const l6Plain = pageHtmlOf(view, { page: 'changes', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: readsOf(richScreen()), changes: { counts: {}, values: {}, rows: {}, handlers: {} } })
  const l6View = buildView(subQ("'stat tone-'", "'stat-broken tone-'"), React, DswsCtx, TipStub, IcStub, null, [], trZh)
  const l6Html = pageHtmlOf(l6View, { page: 'changes', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: readsOf(richScreen()), changes: { counts: {}, values: {}, rows: {}, handlers: {} } })
  check(l6Plain.indexOf('stat tone-') >= 0 && l6Html.indexOf('stat tone-') < 0, 'L6 反证：把改动页统计卡的类名改坏后，同一份渲染里这个类名当场消失（证明类名判据不是恒真）')

  // L7 反证：把差异行的类名前缀改坏，L3 的类名判据当场变假。
  const l7View = buildView(subQ("'vcs-hist-diff-line vcs-hist-line-'", "'vcs-hist-diff-line vcs-hist-lineX-'"), React, DswsCtx, TipStub, IcStub, null, [], trZh)
  const l7Html = pageHtmlOf(l7View, { page: 'commits', width: 460, skin: 'dark', seed: { nowMs: NOW }, reads: l3Lines, ui: { openCommit: hcRev.oid, openFile: 'src/a.ts' } })
  check(l7Html.indexOf('vcs-hist-line-add') < 0 && l7Html.indexOf('vcs-hist-diff-line') >= 0, 'L7 反证：把差异行的类名前缀改坏后，L3 的类名判据当场变假')

  // L8 反证：把失败结果的类名拼法改坏，L5 的失败色判据当场变假。
  const l8View = buildView(subQ("(fail ? 'fail' : 'ok')", "(fail ? 'broken' : 'ok')"), React, DswsCtx, TipStub, IcStub, null, [], trZh)
  const l8Html = remotePageHtmlOf(l8View, { reads: remoteReadsOf({ sync: l5Sync }), ui: { open: '8.9', result: { ok: false, git: 'rejected', step: '推送', expected: '被接受', actual: '被拒', cause: '先拉取' } } })
  check(l8Html.indexOf('vcs-result-fail') < 0 && l8Html.indexOf('data-vc-result="fail"') >= 0, 'L8 反证：把失败结果的类名拼法改坏后，L5 的失败色判据当场变假（语义标记与样式类名是两件事）')
}

// ============================================================
// M4e 组 · 客户端写层的三条规矩（#1776 M4e）
//   1) 配置页读电话的名字只在 vcConfigOps 定义一次，动作层用 declare 复用，不另抄一份；
//   2) 冲突页「没有票」那条兜底必须说人话、不发写电话、不抛异常；
//   3) 配置预检开跑时先收掉上一轮留下的确认卡与结果，不拿一条假失败回包占位。
//   每条都配一条反证：把源码改回旧写法，判据当场变假。
// ============================================================
function groupM4e(view: any, React: any, DswsCtx: any, TipStub: any, IcStub: any) {
  const build = function (patch: any) { return buildView(patch, React, DswsCtx, TipStub, IcStub, null, [], trZh) }

  // N1 单一来源：动作层不再自带一份读电话名字。
  const actions2Src = readSource('src/client/views/versionControl/vcRealManageActions2.ts')
  const configOpsSrc = readSource('src/client/views/versionControl/vcConfigOps.ts')
  check(actions2Src.indexOf('declare const VC_CONFIG_READ_PHONE') >= 0 && actions2Src.indexOf('VC_REAL_CONFIG_READ_PHONE') < 0 && actions2Src.indexOf("'wf.gitConfigRead'") < 0 && configOpsSrc.indexOf("export const VC_CONFIG_READ_PHONE = 'wf.gitConfigRead'") >= 0, 'N1 配置页读电话的名字只有一处定义（vcConfigOps 导出、动作层 declare 复用），动作层没有第二份字面量')

  // N1b 运行时也走同一份名字：读一次配置，发出去的正是 wf.gitConfigRead。
  const n1Phones: string[] = []
  const n1Handlers = view.vcRealConfigHandlersOf({
    callHost: function (phone: any) { n1Phones.push(String(phone)); return Promise.resolve({ ok: true }) },
    cwd: 'D:/w/repo',
    nowMs: function () { return NOW },
    getManage: function () { return { config: view.vcConfigStateNew() } },
    setManage: function () {},
    onRefresh: function () { return null },
  })
  n1Handlers.onConfig({ op: 'read' })
  check(n1Phones.length === 1 && n1Phones[0] === 'wf.gitConfigRead', 'N1b 配置页读一次发的就是 wf.gitConfigRead（复用共享常量之后运行时仍指向同一条电话）')

  // N2 冲突页没有票的兜底：说人话、零写电话、不抛异常。
  let conflictCalls: any[] = []
  let conflictsState: any = { values: {}, rows: {} }
  const conflictHandlers = view.vcRealConflictsHandlersOf({
    callHost: function (phone: any, args: any) { conflictCalls.push({ phone: phone, args: args }); return Promise.resolve({ ok: false }) },
    cwd: 'D:/w/repo',
    nowMs: function () { return NOW },
    getConflicts: function () { return conflictsState },
    patchConflicts: function (next: any) { conflictsState = next },
    translate: trZh,
  })
  let conflictErr = ''
  try {
    conflictHandlers.run('conflict-view', {}, { ticketId: '' })
  } catch (e) { conflictErr = String((e && e.message) || e) }
  const conflictRow = (conflictsState.rows && conflictsState.rows['conflict-view']) || {}
  const conflictErrObj = (conflictRow.result && conflictRow.result.error) || {}
  check(conflictErr === '' && conflictErrObj.message === trZh('vc.shell.live.noTicket') && conflictErrObj.kind === 'shape' && conflictErrObj.reason === 'no-ticket' && conflictCalls.length === 0, 'N2 冲突页没有票时的兜底：印「先重新预检」这句人话、零写电话、不抛异常（旧写法里局部变量遮蔽翻译函数，这里必抛 TypeError）')

  // N2b 反证：把局部变量改回遮蔽 translate 的旧写法，同样的调用当场抛错。
  const n2Bad = build(function (s: string) { return s.replace('const tk: any = ticket || {}', 'const t: any = ticket || {}') })
  let n2BadThrew = false
  let n2BadState: any = { values: {}, rows: {} }
  try {
    n2Bad.vcRealConflictsHandlersOf({ callHost: function () { return Promise.resolve({ ok: false }) }, cwd: 'D:/w/repo', nowMs: function () { return NOW }, getConflicts: function () { return n2BadState }, patchConflicts: function (next: any) { n2BadState = next }, translate: trZh }).run('conflict-view', {}, { ticketId: '' })
  } catch (e) { n2BadThrew = true }
  check(n2BadThrew, 'N2b 反证：把局部变量改回遮蔽 translate 的旧写法后，同样的调用当场抛错（N2 的判据不是恒真）')

  // N3 配置预检开跑时清掉上一轮的确认卡与结果，只留预检输入。
  const oldConfig = view.vcConfigStateNew()
  oldConfig.edit = { key: 'user.name', scope: 'local', value: '林可' }
  oldConfig.check = { ok: true, ticket: { id: 'old-ticket' }, op: 'config-set' }
  oldConfig.result = { ok: false, kind: 'other', message: '上一轮留下的失败' }
  let configState = oldConfig
  const configHandlers = view.vcRealConfigHandlersOf({
    callHost: function () { return new Promise(function () {}) },
    cwd: 'D:/w/repo',
    nowMs: function () { return NOW },
    getManage: function () { return { config: configState } },
    setManage: function (next: any) { configState = next.config },
    onRefresh: function () { return null },
  })
  configHandlers.onConfig({ op: 'config-set' })
  const pendingInput = configState.pending || null
  check(!!pendingInput && pendingInput.op === 'config-set' && configState.check === null && configState.result === null, 'N3 配置预检开跑时先收掉上一轮的确认卡与结果，只留预检输入（不拿假失败回包占位）')

  // N3b 反证：改回「先用假失败回包占位」的旧写法，同一场景下结果里当场多出一条 kind=pending 的假失败。
  const n3Bad = build(function (s: string) {
    return s.replace('setState(Object.assign({}, current, { pending: input, check: null, result: null }))', "setState(vcConfigApplyCheck(Object.assign({}, current, { pending: input }), { ok: false, error: { kind: 'pending' } }))")
  })
  let n3BadState: any = Object.assign({}, oldConfig)
  n3Bad.vcRealConfigHandlersOf({
    callHost: function () { return new Promise(function () {}) },
    cwd: 'D:/w/repo',
    nowMs: function () { return NOW },
    getManage: function () { return { config: n3BadState } },
    setManage: function (next: any) { n3BadState = next.config },
    onRefresh: function () { return null },
  }).onConfig({ op: 'config-set' })
  check(!!(n3BadState.result && n3BadState.result.ok === false && n3BadState.result.kind === 'pending'), 'N3b 反证：把清旧读数改回造假失败回包的旧写法后，结果里当场多出一条 kind=pending 的假失败（N3 的判据不是恒真）')
}

// ============================================================
async function main() {
  console.log('版本管理写操作界面门禁（#842：A–M 组）')
  // #1294：旧片段路径经 tests/lib/source-text.ts 的 sourcePath 映射到生成物 locale-data.ts，
  //   里面仍按族导出 L_PANEL / L_FLOW / L_VCWRITE，判据不变。
  const locUrl = (f: string) => pathToFileURL(path.join(ROOT, sourcePath(f))).href
  const panelMod = await import(locUrl('src/client/kernel/locale-panel.js'))
  const flowMod = await import(locUrl('src/client/kernel/locale-flow.js'))
  const vcMod = await import(locUrl('src/client/kernel/locale-vcwrite.js'))
  // #1776 M4c：A / J / L 组渲染真实页面壳，页面标题、确认卡四段与结果话术住在 vcshell 族、
  //   改动页动作名住在 vcchanges 族；词条仍是真字典，缺哪一族就会在断言里露成键名。
  const vcshellMod = await import(locUrl('src/client/kernel/locale-vcshell.js'))
  const vcchangesMod = await import(locUrl('src/client/kernel/locale-vcchanges.js'))
  const writeOnly = {
    zh: Object.assign({}, panelMod.L_PANEL.zh, flowMod.L_FLOW.zh, vcMod.L_VCWRITE.zh),
    en: Object.assign({}, panelMod.L_PANEL.en, flowMod.L_FLOW.en, vcMod.L_VCWRITE.en),
  }
  LOC_WRITE = writeOnly
  LOC = {
    zh: Object.assign({}, writeOnly.zh, vcshellMod.L_VCSHELL.zh, vcchangesMod.L_VCCHANGES.zh),
    en: Object.assign({}, writeOnly.en, vcshellMod.L_VCSHELL.en, vcchangesMod.L_VCCHANGES.en),
  }
  const reasonsMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'write-reasons.js')).href)
  const writeReasons = Object.keys(reasonsMod.WRITE_REASONS)
  // I 组要用宿主真源：真 pushPlanOf 生成 plan、真 pushArgs 拼命令（不是手搓形状）。
  const planMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'push-plan.js')).href)
  const cmdMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'commands.js')).href)

  const React = require('react')
  // 真渲染用 React.createElement；夹具里的 pageHtmlOf / renderTabHtmlOf 读这个模块级变量。
  H = React.createElement
  const DswsCtx = React.createContext(null)
  const TipStub = function (props) { return props && props.children ? props.children : null }
  const IcStub = function () { return null }
  const logs = []
  const view = buildView(null, React, DswsCtx, TipStub, IcStub, null, logs, trZh)

  groupA(view, React, DswsCtx, TipStub, IcStub)
  groupB(view)
  await groupC(view, logs)
  groupD(view, writeReasons)
  await groupE(view)
  await groupG(view)
  groupK(view, React, DswsCtx, TipStub, IcStub)
  groupJ(view, React, DswsCtx, TipStub, IcStub, logs)
  groupL(view, React, DswsCtx, TipStub, IcStub)
  groupM4e(view, React, DswsCtx, TipStub, IcStub)
  await groupM(view)
  await groupI(view, planMod.pushPlanOf, cmdMod.pushArgs)
  await groupH(React, DswsCtx, TipStub, IcStub, logs)

  console.log(failed ? '\n存在失败' : '\n全部通过 — 写操作界面门禁生效（' + total + ' 条断言）')
  process.exit(failed ? 1 : 0)
}
main().catch(function (e) { console.error(e); process.exit(1) })
