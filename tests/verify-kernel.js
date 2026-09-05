// verify-kernel.js — dsh-mattpocock-skills-deck 阶段 2 内核迁移（#96 T3）：kernel 27 模块契约验证（#444 对齐后基准 + #454 K1 拆分 + #455 K2 拆分 + #456 K3 拆分 + #457 K4 拆分 + #458 K5 拆分）
// 验证：
//   1) kernel 27 模块文件存在且含预期导出（docs/architecture/kernel-contract.md · G3 冻结接口表 + #444 对齐新增 backendList/link/slots/slotRenderer，其中 slotRenderer 经 #454 拆为 queue/repo-sync/modal-view 三文件，store 经 #455 拆为 prefs/switch/snapshot/derived 四文件，probe 经 #456 拆为 chain/snapshot/auto 三文件，api 经 #457 拆为 naming/new-session/io 三文件，locale 经 #458 拆为 panel/flow/word 三片段加合并器）
//   2) 构建产物（_dev client.js / _pkg package/lib/client.js）已拼接全部模块（一源两物 · 无标记残留）
//   3) 双产物模块段关键特征一致（行为零变化证明）
//   4) 产物新鲜度门禁（缺失/过期 → FAIL，提示先构建；与 verify-ctx 同口径）
// 用法: node tests/verify-kernel.js（在插件根目录；先运行 node scripts/build.mjs 生成产物）
const fs = require('fs')
const path = require('path')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const PRODUCTS = ['client.js', 'package/lib/client.js']
const MODULES = [
  { name: 'styles', exports: ['STYLE_TEXT'] },
  { name: 'portal', exports: ['RDOM', 'portalTop', 'PortalOverlay'] },
  { name: 'localePanel', file: 'locale-panel', exports: ['L_PANEL'] },
  { name: 'localeFlow', file: 'locale-flow', exports: ['L_FLOW'] },
  { name: 'localeWord', file: 'locale-word', exports: ['L_WORD'] },
  { name: 'locale', exports: ['L'] },
  { name: 'icons', exports: ['ICON_SCHEMES', 'WORD_SCHEMES', 'Icon', 'Ic'] },
  { name: 'prompts', exports: ['PROMPTS', 'promptLang', 'promptText', 'BODY_FORMAT', 'completePrompt', 'FIXATE_PROMPT'] },
  { name: 'config', exports: ['CFG_KEY', 'cfg', 'templates', 'migrateStartCfg', 'TPL_DEFAULT', 'renderTemplate', 'validateTemplate'] },
  { name: 'storePrefs', file: 'store-prefs', exports: ['DEFAULT_PANEL_H', 'listPrefs', 'saveListPrefs', 'labelClicks', 'saveLabelClicks', 'NOREPO_DISMISS_PREFIX', 'cwdHash', 'noRepoDismissKey', 'isNoRepoDismissed', 'setNoRepoDismissed', 'cwdBasename', 'isNoRepoNameValid', 'ensureNoRepoCard', 'setActiveMap', 'clearActiveMap', 'setActiveIssue', 'clearActiveIssue', 'clearActiveDetail', 'ISSUE_CACHE_TTL', 'selectionByCwd', 'repositoryByCwd', 'SELECTION_BY_CWD_KEY', 'BANNER_FOLD_KEY', 'bannerFoldByCwd', 'isBannerFolded', 'setBannerFolded', 'getCachedSelection', 'setCachedSelection', 'getCachedRepository', 'setCachedRepository'] },
  { name: 'storeSwitch', file: 'store-switch', exports: ['labelOf', 'presentationById', 'setPresentationMap', 'backendColorOf', 'backendBgOf', 'backendBorderOf', 'repoShortName', 'DEFAULT_SWITCH_PROMPT_ZH', 'openSwitchConfirm', 'closeSwitchConfirm', 'loadSwitchCri', 'confirmSwitchConfirm', 'clearBackendBinding'] },
  { name: 'storeSnapshot', file: 'store-snapshot', exports: ['makeStore', 'shared', 'stores', 'storeOf', 'emit', 'sub', 'useStore', 'SNAP_CWD_LRU_MAX', 'snapshotByCwd', 'touchLRUClient', 'getCachedSnapshot', 'getCachedEntry', 'setCachedSnapshot', 'getSnapshotVersion', 'lastProbeAtByCwd', 'getProbeAt', 'touchProbeAt', 'SNAP_DISK_CAP', 'diskPutSnapshot', 'diskGetSnapshot', 'CHAIN_CWD_LRU_MAX', 'chainByCwd', 'getChainCacheKey', 'getCachedChain', 'setCachedChain', 'hydrateFromCache', 'mergeSelection', 'applySnapshotSelection', 'getCwdSync', 'NOTICE_COLOR', 'noticeIcon', 'flash'] },
  { name: 'storeDerived', file: 'store-derived', exports: ['compute', 'frontierAll', 'openIssuesOf', 'isOccupied', 'occCount', 'frontierCount', 'hasLabelOf', 'isTriageLike', 'bugCount', 'triageCount', 'buildColorOf', 'isLightHex', 'actionColorOf', 'rowActionText', 'mkRowAction', 'timeStampStr'] },
  { name: 'probeChain', file: 'probe-chain', exports: ['scheduleChainAutoRefresh', 'cancelChainAutoRefresh', 'loadChain', 'chainSteps', 'chainStep', 'chainStepStatus', 'chainStepOk', 'chainStepBad', 'readyCount', 'envTotal', 'envLabel', 'setupCheck', 'openBlockers', 'blockerNames', 'detectCwd'] },
  { name: 'probeSnapshot', file: 'probe-snapshot', exports: ['pendingSnapshotByCwd', 'hexA', 'darken', 'nowStr', 'timeOf', 'timeOfMs', 'broadcastCfg', 'diffSnapshots', '_flashClearPending', 'scheduleFlashClear', 'loadSnapshot'] },
  { name: 'probeAuto', file: 'probe-auto', exports: ['PROBE_MS', 'FOCUS_PROBE_MIN_MS', 'lastFocusProbe', '_actionProbePending', 'probeNow', 'scheduleActionProbe', 'startAutoProbe', 'spinAll', 'refreshAll', 'SNAP_FRESH_MS', 'snapFresh'] },
  { name: 'router', exports: ['openPagePanel', 'openDockPanel', 'openPanel', 'togglePanel', 'ensureSidebarTab', 'repoStr', 'startText', 'newWayfinderText', 'newBugWayfinderText'] },
  { name: 'apiNaming', file: 'api-naming', exports: ['injectFixate', 'handoffTs', 'handoffFile', 'handoffPrompt', 'extractHandoffFile', 'absHandoffPath', 'handoffReadText', 'pendingDraft', 'pendingDraftTargetSid', 'getRowPreset', 'isHealthyPreset', 'isReusableBlank', 'buildCreateOpts', 'createPTCSession', 'NAMING_POLL_MS', 'namingCurrentTitleOf', 'namingHintOf', 'executeNamingOrder', 'reconcileNamingFailure', 'applyNamingFailurePanel', 'namingGuardianKick', 'startNamingGuardianPoll'] },
  { name: 'apiPresetGuard', file: 'api-preset-guard', exports: ['describeReuseDecision', 'verifyFreshPreset', 'tryQuarantineSession', 'createVerifiedPTCSession'] },
  { name: 'apiNewSession', file: 'api-new-session', exports: ['probeHandoffReady', 'doHandoff', 'doHandoffOpen', 'openTextInNewSession'] },
  { name: 'apiIo', file: 'api-io', exports: ['openInNewSession', 'inject', 'openUrl', 'copyText', 'fetchIssueDetail', 'clearIssueDetailCache', 'fetchIssueComments', 'submitIssueComment'] },
  { name: 'actions', exports: ['createActionDispatcher', 'ACTIONS_VERSION'] },
  { name: 'backendList', file: 'builtin-backends', exports: ['BUILTIN_BACKENDS', 'builtinLabelOf', 'otherFiltered', 'firstBackendIdOf', 'repositoryActionOf', 'moduleMetaOf'] },
  { name: 'link', exports: ['issueUrlFor', 'openIssueUrl', 'searchUrlFor', 'repoUrlFor', 'issueRefNumbersFrom'] },
  { name: 'slots', exports: ['SLOTS_KERNEL_VERSION', 'SLOT_DEFS_KERNEL', 'MODAL_SEAT_ID', 'orderOf', 'isScopeValid', 'canDeclareIn', 'shouldShowInModal', 'isModalAction', 'getWizardAction', 'getFormAction', 'getModalAction', 'getWizardSteps'] },
  { name: 'slotRendererQueue', file: 'slotRenderer-queue', exports: ['SLOT_RENDERER_VERSION', 'ensureFormModal', 'openFormModal', 'closeFormModal', 'createModalRenderForm', 'canOpenModalForStep', 'canOpenWizardForStep'] },
  { name: 'slotRendererRepoSync', file: 'slotRenderer-repo-sync', exports: ['startRepoSync', 'finishRepoSync', 'retryRepoSync'] },
  { name: 'slotRendererModalView', file: 'slotRenderer-modal-view', exports: ['FormModalSeat'] },
]
const kernelFileOf = (m) => 'src/client/kernel/' + (m.file || m.name) + '.js'
const SOURCES = [
  'src/client/index.js', 'scripts/build.mjs', 'package/package.json',
  ...MODULES.map(kernelFileOf),
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

async function main() {
  // ---- 产物新鲜度门禁 ----
  PRODUCTS.forEach((p) => {
    const why = productStale(p)
    check(!why, '产物门禁 ' + p + (why ? '：' + why : '（存在且新鲜）'))
  })
  if (failed) { console.log('\n存在失败'); process.exit(1) }

  // ---- 模块文件 + 导出齐全 ----
  for (const m of MODULES) {
    const file = kernelFileOf(m)
    if (!fs.existsSync(file)) { check(false, file + ' 缺失'); continue }
    const src = fs.readFileSync(file, 'utf8')
    for (const ex of m.exports) {
      const ok = new RegExp('export\\s+(const|let|function|var)\\s+' + ex + '\\b').test(src)
      check(ok, m.name + '.js 导出 ' + ex)
    }
  }

  // ---- 产物已拼接（无标记残留 + 关键导出在双产物）----
  const cli = fs.readFileSync('client.js', 'utf8')
  const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
  for (const m of MODULES) {
    check(!cli.includes('kernel:' + m.name + ' (spliced') && !pcli.includes('kernel:' + m.name + ' (spliced'),
      '双产物无 ' + m.name + ' 拼接标记残留')
  }
  const spot = [
    ['const STYLE_TEXT = [', 'const portalTop = function', 'const L = {', 'const Ic = ({ n', 'const PROMPTS = {', 'const cfg = (function', 'const shared = makeStore()', 'const loadSnapshot = function', 'const openPanel = function', 'const inject = (st, text)', 'const BUILTIN_BACKENDS = [', 'const issueUrlFor = (st', 'const SLOT_DEFS_KERNEL = Object.freeze', 'const SLOT_RENDERER_VERSION = 1'],
  ][0]
  spot.forEach((k) => {
    check(cli.includes(k) && pcli.includes(k), '双产物含 ' + k.slice(0, 30) + '…（' + (cli.includes(k) ? '✓' : '✗') + '/' + (pcli.includes(k) ? '✓' : '✗') + '）')
  })

  // ---- index.js 无残留大块（模块代码已全部迁出，只剩组件区 + 装配）----
  const idx = fs.readFileSync('src/client/index.js', 'utf8')
  check(!idx.includes('const PROMPTS = {'), 'src/client/index.js 已不含 PROMPTS（迁出 prompts.js）')
  check(!idx.includes('const makeStore = () =>'), 'src/client/index.js 已不含 makeStore（迁出 store.js）')

  console.log(failed ? '\n存在失败' : '\n全部通过')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })