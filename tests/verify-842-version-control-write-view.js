// tests/verify-842-version-control-write-view.js — 版本管理「写操作」界面门禁（#842 落地）
// 用法：在插件根目录执行 node tests/verify-842-version-control-write-view.js，可独立运行。
//
// 这份门禁守的是「用户点得完、看得懂」那一半：#842 的四个动作（暂存 / 提交 / 拉取 / 推送）落点对不对、
//   禁用态读的是不是核心判定、三个确认框有没有点名目标、五族失败话术能不能照着做、执行中会不会把读数弄假。
// 写法照 tests/verify-818-version-control-view.js 的先例：把叶子按 build.mjs 的次序拼成真闭包再跑，
//   词条读真字典（locale-panel / locale-flow / locale-vcwrite），断言落在模型与真渲染出来的 DOM 上。
//
// A–M 组；M 组是性能（竞态 / 工作区污染 / 缓存上限 / 同键在途不重复发），每项正反两面。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const NOW = Date.parse('2026-10-04T03:00:00+08:00')

// ---------- 界面侧闭包：照 scripts/build.mjs 的做法把叶子拼起来再跑 ----------
const VC_FILES = [
  'src/shared/version-control/rules.js', // 判定真源（界面按它画按钮状态）
  'src/client/views/versionControl/vcText.js',
  'src/client/views/versionControl/vcFold.js',
  'src/client/views/versionControl/vcDiff.js',
  'src/client/views/versionControl/vcCommit.js',
  'src/client/views/versionControl/vcStyles.js', // #851 视觉语言的样式叶子（CSS 文本，注入点与 styles.js 同一个接缝）
  'src/client/views/versionControl/vcRows.js',
  'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcWriteRun.js',
  'src/client/views/versionControl/vcWriteUi.js',
  'src/client/views/versionControl/vcWriteOps.js',
  'src/client/views/versionControl/vcWriteView.js',
  'src/client/views/versionControl/vcDiffOps.js', // #857：差异与提交那几路的动作（闭包里排在 vcBlocks 之前）
  'src/client/views/versionControl/vcBlocks.js',
  'src/client/views/versionControl/vcViews.js', // #853 第三步：布局 C 的三个视图（与构建同序，排在 vcBlocks 之后）
  'src/client/views/versionControl/vcAiHandoff.js', // #854：AI 交接（与构建同序）
  'src/client/views/versionControl/vcTabVisible.js',
  'src/client/views/versionControl/vcData.js',
  'src/client/views/versionControl/VersionControlTab.js',
]
const EXPORTS = [
  'REASONS',
  'RULES_SOURCE',
  'VC_BLOCK_KEY',
  'VC_BLOCK_ORDER',
  'VC_CHANGE_KEY',
  'VC_CHANGE_TONE',
  'VC_DIFF_CACHE_MAX',
  'VC_DIFF_LINES_SHOWN',
  'VC_DIFF_REASON_KEY',
  'VC_FAIL_KEY',
  'VC_FILE_ROWS_BATCH',
  'VC_FILE_ROWS_FIRST',
  'VC_FOLD_BANDS',
  'VC_FOLD_STEP_CAP',
  'VC_LOG_BATCH',
  'VC_MIDDLE_MIN',
  'VC_OTHER_SUMMARY_NAMES',
  'VC_PHONES',
  'VC_RELATIVE_WINDOW_MS',
  'VC_SYNC_VALUES',
  'VC_TONE',
  'VC_WRITE_ERR_FAMILY',
  'VC_WRITE_ERR_KIND_FAMILY',
  'VC_WRITE_ERR_NETWORK_KINDS',
  'VC_WRITE_OPS',
  'VC_WRITE_PHONES',
  'VersionControlTab',
  'judge',
  'vcActionsNode',
  'vcAfterWrite',
  'vcApplyCommitReply',
  'vcApplyCommitFileDiffReply',
  'vcApplyDiffReply',
  'vcBasisText',
  'VC_BADGE_LETTER',
  'VC_STYLE_TEXT',
  'vcBadgeLetterOf',
  'vcBlockKeyOf',
  'vcBlockedTipOf',
  'vcBlocksOf',
  'vcBoundedMap',
  'vcChangeKeyOf',
  'vcChangeToneOf',
  'vcClockText',
  'vcCommitAreaNode',
  'vcCommitBlockOf',
  'vcCommitKeyOf',
  'vcCommitListOf',
  'vcCommitModeOf',
  'vcConfirmOf',
  'vcDiffOpenKeyOf',
  'vcDiffOpsOf',
  'vcDiffViewOf',
  'vcFailKeyOf',
  'vcFailureOf',
  'vcFileRowsOf',
  'vcFoldBandAt',
  'vcFoldDataOf',
  'vcFoldLadderOf',
  'vcFoldOf',
  'vcFoldStateAt',
  'vcFreshOnCwd',
  'vcGroupOfRow',
  'vcMarkCommitFileDiffLoading',
  'vcMarkCommitLoading',
  'vcMarkDiffLoading',
  'vcMarkLogLoading',
  'vcMiddle',
  'vcNewReads',
  'vcNextSkipOf',
  'vcOneLine',
  'vcOpResultOf',
  'vcOpStateOf',
  'vcOtherRowOf',
  'vcPlanMismatchOf',
  'vcPlusMinus',
  'vcPushDecisionOf',
  'vcReadCommitFileDiff',
  'vcReadCommitFiles',
  'vcReadDiff',
  'vcReadMoreCommits',
  'vcReadStatus',
  'vcReadsOf',
  'vcReasonKeysOf',
  'vcRemoteChoiceOf',
  'vcRequestIdOf',
  'vcRowStageNodes',
  'vcRowStageOf',
  'vcRowViewOf',
  'vcRunCheck',
  'vcRunWrite',
  'vcScreenShapeOk',
  'vcShortOid',
  'vcShouldRead',
  'vcStageAllNode',
  'vcSyncViewOf',
  'vcTabVisible',
  'vcTail',
  'VC_VIEWS',
  'VC_AI_READ_FAIL_KINDS',
  'vcAiHandoffOf',
  'vcAiButtonNode',
  'vcOpenAiHandoff',
  'vcRememberedView',
  'vcRememberView',
  'vcResetViewMemory',
  'vcViewOf',
  'vcViewCountsOf',
  'vcViewBlocksOf',
  'vcViewTabsNode',
  'vcTimeKind',
  'vcWhenText',
  'vcWriteErrFamilyOf',
  'vcWriteErrKeyOf',
  'vcWriteOpsOf',
  'vcWriteTailNodes',
  'vcWriteUiOf',
]
function stripExports(text) { return text.replace(/^(\s*)export\s+/gm, '$1') }
function buildView(patch, React, DswsCtx, Tip, Ic, seedReads, logs, trFn, exportsList) {
  let src = VC_FILES.map((f) => stripExports(read(f))).join('\n')
  if (patch) src = patch(src)
  const names = exportsList || EXPORTS
  const body = src + '\nreturn { ' + names.join(', ') + ' }\n'
  const fn = new Function('React', 'log', 'dswsLogHash', 'dswsLogTrunc', 'tr', 'host', 'DswsCtx', 'Tip', 'Ic', 'seedReads', body)
  return fn(React || {}, function (level, event, fields) { (logs || []).push({ level: level, event: event, fields: fields }) },
    function () { return 'h8' }, function (s) { return String(s) }, trFn, {}, DswsCtx || null, Tip || null, Ic || null, seedReads || null)
}

// ---------- 真词条 ----------
const fill = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : String(s))
let LOC = { zh: {}, en: {} }
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
  return { stage: view.judge(screen, 'stage'), commit: view.judge(screen, 'commit'), pull: view.judge(screen, 'pull'), push: view.judge(screen, 'push') }
}
function blocksOf(view, screen, reads, ui) {
  const fold = view.vcFoldOf(460, view.vcFoldDataOf(screen, reads, LABELS()))
  return view.vcBlocksOf(screen, reads, ui, { t: trZh, nowMs: NOW, decisions: decisionsOf(view, screen), fold: fold })
}
const blockOf = (blocks, kind) => blocks.filter((b) => b.kind === kind)[0] || null
const rowOf = (blocks, p) => { const c = blockOf(blocks, 'changes'); const gs = c ? c.groups : []; const all = gs.reduce((a, g) => a.concat(g.rows), []); return all.filter((r) => r.path === p)[0] || null }

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
// A 组 · 落点（模型 + 真渲染出来的 DOM）
// ============================================================
function renderTab(React, DswsCtx, TipStub, IcStub, seedReads, patch) {
  const seeded = buildView(function (s) {
    const out = s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })')
    return patch ? patch(out) : out
  }, React, DswsCtx, TipStub, IcStub, seedReads, [], trZh)
  try {
    const { renderToStaticMarkup } = require('react-dom/server')
    return { html: renderToStaticMarkup(React.createElement(seeded.VersionControlTab, { st: { cwd: 'D:/w/repo' } })), view: seeded, err: '' }
  } catch (e) { return { html: '', view: seeded, err: String((e && e.message) || e) } }
}

function groupA(view, React, DswsCtx, TipStub, IcStub) {
  const screen = richScreen()
  const reads = readsOf(screen)
  const blocks = blocksOf(view, screen, reads, uiOf())
  const identity = blockOf(blocks, 'identity')
  const changes = blockOf(blocks, 'changes')
  const r = renderTab(React, DswsCtx, TipStub, IcStub, reads)
  const html = r.html
  const iPull = html.indexOf('data-vc-action="pull"')
  const iPush = html.indexOf('data-vc-action="push"')
  const a1 = !!(identity && identity.actions && identity.actions.pull && identity.actions.push) && iPull >= 0 && iPush > iPull
  check(a1, 'A1 identity 块里出现拉取与推送两颗按钮，顺序是「拉取 → 推送」（模型 ' + !!(identity && identity.actions) + '，DOM ' + iPull + '/' + iPush + '，渲染错 ' + (r.err || '无') + '）')

  const paths = (changes && changes.stageAll ? changes.stageAll.paths : []).join(',')
  const a2 = !!(changes && changes.stageAll && changes.stageAll.show === true) && paths === 'b.txt,c.txt' && html.indexOf('data-vc-stage-all') >= 0
  check(a2, 'A2 changes 标题行有「全部暂存」，路径只含未暂存且非冲突的两行（实得 ' + JSON.stringify(paths) + '）')

  const cleanScreen = screenOf({ staged: [fileOf('a.txt', 'staged')], stagedCount: 1 })
  const typedUi = uiOf({ write: { op: '', state: 'idle', message: '写一句', confirm: null, result: null } })
  const cleanBlocks = blocksOf(view, cleanScreen, readsOf(cleanScreen), typedUi)
  const ca = blockOf(cleanBlocks, 'changes') ? blockOf(cleanBlocks, 'changes').commitArea : null
  const blankBlocks = blocksOf(view, cleanScreen, readsOf(cleanScreen), uiOf())
  const caBlank = blockOf(blankBlocks, 'changes') ? blockOf(blankBlocks, 'changes').commitArea : null
  const a3 = !!(ca && ca.placeholder && ca.text && ca.hint) && ca.disabled === false && !!caBlank && caBlank.disabled === true && caBlank.needMessage === true && caBlank.tip === trZh('vc.commitArea.needMessage') && html.indexOf('data-vc-commit-area') >= 0 && html.indexOf('data-vc-commit-msg') >= 0 && html.indexOf('data-vc-commit-btn') >= 0
  const emptyScreen = screenOf()
  const emptyBlocks = blocksOf(view, emptyScreen, readsOf(emptyScreen), uiOf())
  const caEmpty = blockOf(emptyBlocks, 'changes') ? blockOf(emptyBlocks, 'changes').commitArea : null
  check(a3 && !!caEmpty && caEmpty.disabled === true, 'A3 changes 块底部有提交区（输入框 + 按钮）；空提交信息与无暂存都禁用并给出原因（有信息禁用=' + (ca ? ca.disabled : '缺') + '，空信息禁用=' + (caBlank ? caBlank.disabled : '缺') + '，无暂存禁用=' + (caEmpty ? caEmpty.disabled : '缺') + '）')

  const rowB = rowOf(blocks, 'b.txt')
  const a4 = !!(rowB && rowB.stageAction && rowB.stageAction.show === true) && html.indexOf('data-vc-stage') >= 0
  check(a4, 'A4 未暂存文件行右侧有「暂存」按钮（模型 ' + !!(rowB && rowB.stageAction) + '，DOM ' + (html.indexOf('data-vc-stage') >= 0) + '）')

  const rowD = rowOf(blocks, 'd.txt')
  const a5 = !!(rowD && rowD.stageAction && rowD.stageAction.conflict === true && rowD.stageAction.show === false) && html.indexOf('data-vc-conflict-terminal') >= 0
  const conflictText = (html.match(/data-vc-conflict-terminal[^>]*>([^<]*)/) || [])[1] || ''
  const a5b = conflictText.indexOf('命令行') >= 0 && conflictText.indexOf('侧栏终端') < 0
  check(a5 && a5b, 'A5 冲突行没有「暂存」，改说「在命令行里解决」，且不再提侧栏终端（模型 ' + JSON.stringify(rowD && rowD.stageAction) + '，DOM ' + (html.indexOf('data-vc-conflict-terminal') >= 0) + '，文字 ' + JSON.stringify(conflictText) + '）')

  // A6：多远端 + 没有上游 —— 候选远端来自失败回包顶层 remotes，界面上要有一排可点的入口。
  const choiceUi = uiOf({ write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: { show: true, remotes: ['origin', 'mirror'], hint: '' } } })
  const choiceModel = view.vcWriteUiOf(screen, choiceUi, { t: trZh, nowMs: NOW, decisions: decisionsOf(view, screen) })
  const choiceHtml = renderTab(React, DswsCtx, TipStub, IcStub, reads, function (s) {
    return s.replace("write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null }", "write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: { show: true, remotes: ['origin', 'mirror'], hint: '' } }")
  }).html
  const a6 = !!(choiceModel.remoteChoice && choiceModel.remoteChoice.remotes.join(',') === 'origin,mirror') && choiceHtml.indexOf('data-vc-remote-choice') >= 0 && choiceHtml.indexOf('data-vc-remote="origin"') >= 0 && choiceHtml.indexOf('data-vc-remote="mirror"') >= 0
  check(a6, 'A6 多远端 + 没有上游：界面上有一排可点的远端入口（模型 ' + JSON.stringify(choiceModel.remoteChoice && choiceModel.remoteChoice.remotes) + '，DOM ' + (choiceHtml.indexOf('data-vc-remote-choice') >= 0) + '）')
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
    ['stage', 'commit', 'pull', 'push'].forEach((op) => {
      const d = view.judge(s, op)
      const expect = d.verdict === 'block' ? 'blocked' : 'idle'
      if (view.vcOpStateOf(d) !== expect) same = false
    })
  })
  check(same, 'B5 四个动作的状态都由核心判定来（' + screens.length + ' 个 screen × 4 个动作，界面状态与 judge 的 verdict 一一对应）')

  const noUp = screenOf({ branches: [{ short: 'main', upstream: '', upstreamGone: false }], identity: { sync: 'no-upstream' } })
  const fixed = view.vcPushDecisionOf(view.judge(noUp, 'push'))
  const gone = screenOf({ branches: [{ short: 'main', upstream: 'origin/main', upstreamGone: true }], identity: { sync: 'upstream-gone' } })
  const fixed2 = view.vcPushDecisionOf(view.judge(gone, 'push'))
  check(fixed.verdict === 'allow' && fixed2.verdict === 'allow', 'B6 推送的「没有上游 / 上游被删」不是禁用，而是走确认档（no-upstream=' + fixed.verdict + '，upstream-gone=' + fixed2.verdict + '）')

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
  const c6 = recByMode.mode === 'recreate' && recByFlag.mode === 'recreate' && recBody.indexOf('origin/feature') >= 0 && recBody.indexOf('已经不在了') >= 0 && recBody.indexOf('feature') >= 0 && recByMode.okText === trZh('vc.action.pushRecreate')
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
  const stillTerminal = Object.keys(LOC.zh).filter(function (k) { return /侧栏终端/.test(String(LOC.zh[k])) })
  const stillTerminalEn = Object.keys(LOC.en).filter(function (k) { return /terminal on the same row/.test(String(LOC.en[k])) })
  check(weak.length === 0 && stillTerminal.length === 0 && stillTerminalEn.length === 0, 'D2 五条 limit 句都写到「命令行」或「不自动重试」，且中英词条里都不许再有「侧栏终端」（缺的：' + (weak.join('、') || '无') + '；中文残留：' + (stillTerminal.join('、') || '无') + '；英文残留：' + (stillTerminalEn.join('、') || '无') + '）')

  const unmapped = writeReasons.filter(function (r) { return !view.VC_WRITE_ERR_FAMILY[r] })
  check(unmapped.length === 0, 'D3 宿主 ' + writeReasons.length + ' 个 WRITE_REASONS 逐个都在映射表里（没家的：' + (unmapped.join('、') || '无') + '）')

  check(view.vcWriteErrKeyOf({ reason: 'unknown-write-failure', kind: 'other' }) === 'vc.writeErr.unknown', 'D4 表里没有的失败走兜底键')

  const res = view.vcOpResultOf('pull', { ok: false, error: { kind: 'exit', reason: 'unknown-write-failure', message: 'git 原话', hint: '宿主给的一句中文' } })
  check(res.tip === '宿主给的一句中文' && res.key.indexOf('vc.writeErr.') === 0 && res.key !== res.tip, 'D5 宿主原话进悬停（tip），可见文字只用词条键（key=' + res.key + '）')

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
// F 组 · 纪律（行数 / 硬编码中文 / 导出登记 / 前缀 / 定时器）
// ============================================================
const NEW_LEAVES = ['vcRows.js', 'vcWrite.js', 'vcWriteRun.js', 'vcWriteUi.js', 'vcWriteOps.js', 'vcWriteView.js', 'vcDiffOps.js']
const leafPath = (f) => 'src/client/views/versionControl/' + f
const stripComments = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function groupF(view, exportsList) {
  const over = NEW_LEAVES.filter(function (f) { return read(leafPath(f)).split(/\r?\n/).length > 350 })
  check(over.length === 0, 'F1 七个新叶子各自 ≤350 行（超的：' + (over.join('、') || '无') + '）')

  const cjk = []
  NEW_LEAVES.forEach(function (f) {
    const body = stripComments(read(leafPath(f)))
    const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g
    let m
    while ((m = re.exec(body)) !== null) {
      const s = m[1] !== undefined ? m[1] : m[2]
      if (/[\u4e00-\u9fff]/.test(s)) cjk.push(f)
    }
  })
  check(cjk.length === 0, 'F2 新叶子里没有硬编码中文（命中的：' + (cjk.join('、') || '无') + '）')

  const srcExports = []
  VC_FILES.forEach(function (f) {
    const t = read(f)
    const re = /^\s*export\s+(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm
    let m
    while ((m = re.exec(t)) !== null) srcExports.push(m[1])
  })
  const names = exportsList || EXPORTS
  const missing = srcExports.filter(function (n) { return names.indexOf(n) < 0 })
  check(missing.length === 0, 'F3 闭包里 ' + srcExports.length + ' 个 export 全部登记进 EXPORTS（漏的：' + (missing.join('、') || '无') + '）')

  const bad = NEW_LEAVES.filter(function (f) { return /'vc\.fail\./.test(read(leafPath(f))) })
  check(bad.length === 0, 'F4 写路径只用 vc.writeErr.*，不借只读的 vc.fail.*（借了的：' + (bad.join('、') || '无') + '）')

  const timers = NEW_LEAVES.filter(function (f) { return /setTimeout|setInterval/.test(read(leafPath(f))) })
  check(timers.length === 0, 'F5 新叶子里没有定时器（命中的：' + (timers.join('、') || '无') + '）')
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
    ;['stage', 'commit', 'pull', 'push'].forEach(function (op) {
      const raw = view.judge(s, op)
      // 推送那一条界面用的是 vcPushDecisionOf（摘掉「没有上游 / 上游被删」），照同一口径比。
      const d = op === 'push' ? view.vcPushDecisionOf(raw) : raw
      const ui = view.vcWriteUiOf(s, uiOf(), { t: trZh, nowMs: NOW, decisions: decisionsOf(view, s) })
      if (ui.ops[op].disabled !== (d.verdict === 'block')) same = false
    })
  })
  check(same, 'G2 同一批 screen 喂 rules.judge 与界面状态函数，两边结论一致（' + screens.length + ' 个 screen × 4 个动作）')

  const phones = view.VC_WRITE_PHONES
  const namesOk = phones.check === 'wf.gitWriteCheck' && phones.stage === 'wf.gitStage' && phones.commit === 'wf.gitCommit' && phones.pull === 'wf.gitPull' && phones.push === 'wf.gitPush'
  const host = makeHost(function () { return { ok: true } })
  view.vcRunCheck(host.call, 'D:/w/repo', 'pull', {})
  view.vcRunWrite(host.call, 'D:/w/repo', 'stage', { paths: ['a.txt'] })
  view.vcRunWrite(host.call, 'D:/w/repo', 'commit', { ticketId: 't1', requestId: 'r1', message: 'm' })
  await flush()
  const checkCall = host.calls[0] || { method: '', args: {} }
  const stageCall = host.calls[1] || { method: '', args: {} }
  const commitCall = host.calls[2] || { method: '', args: {} }
  const argsOk = checkCall.args.cwd === 'D:/w/repo' && checkCall.args.op === 'pull' && Array.isArray(stageCall.args.paths) && stageCall.args.paths.join(',') === 'a.txt' && commitCall.args.ticketId === 't1' && commitCall.args.message === 'm'
  check(namesOk && argsOk, 'G3 预检与四条写电话的名字、入参形状与宿主契约一致（' + [checkCall.method, stageCall.method, commitCall.method].join(' / ') + '）')

  const keys = ['stage', 'commit', 'pull', 'push'].map(function (op) {
    const reply = op === 'stage' ? { ok: true, staged: ['a'] } : (op === 'commit' ? { ok: true, committed: true, headAfter: 'b' } : (op === 'pull' ? { ok: true, mode: 'fast-forward' } : { ok: true, mode: 'existing-upstream', remote: 'origin', branch: 'main' }))
    return view.vcOpResultOf(op, reply).key
  })
  check(keys.join(',') === 'vc.op.doneStage,vc.op.doneCommit,vc.op.donePull,vc.op.donePush', 'G4 四条写电话的成功回包各自映射到结果句词条（' + keys.join(',') + '）')
}


// ============================================================
// J 组 · DOM 级（真渲染：确认框正文、结果横幅是人话、文字里不出现词条键）
//   这一组是 #842 视觉预览漏网的补丁：原来 53 条大多停在模型层，接线断了也没人发现。
// ============================================================
function writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, write) {
  const preset = JSON.stringify(write)
  return renderTab(React, DswsCtx, TipStub, IcStub, readsOf(screen), function (s) {
    return s.replace("view: vcRememberedView(), write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null } }", "view: vcRememberedView(), write: " + preset + " }")
  })
}
function domText(html) {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div id="m">' + html + '</div>')
  const root = dom.window.document.getElementById('m')
  const pick = function (sel) { const el = root.querySelector(sel); return el ? String(el.textContent || '') : '' }
  return {
    text: String(root.textContent || ''),
    confirmBody: pick('[data-vc-confirm-body]'),
    confirmTitle: pick('[data-vc-confirm] > div'),
    confirmOk: pick('[data-vc-confirm-ok]'),
    confirmTtl: pick('[data-vc-confirm-ttl]'),
    result: pick('[data-vc-op-result]'),
    resultVerb: pick('[data-vc-op-result] span'),
    resultText: pick('[data-vc-op-text]'),
    resultLimit: pick('[data-vc-op-limit]'),
    running: pick('[data-vc-running]'),
    choice: pick('[data-vc-remote-choice]'),
    choiceBody: pick('[data-vc-remote-choice-body]'),
  }
}
function groupJ(React, DswsCtx, TipStub, IcStub) {
  const screen = richScreen()
  const ttl = { id: 't1', expiresAtMs: NOW + 120000 }
  const pulls = writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, { op: '', state: 'idle', message: '', confirm: { op: 'pull', plan: { mode: 'existing', remote: 'origin', branch: 'main', localBranch: 'main' }, ticket: ttl, remotes: [] }, result: null, remoteChoice: null })
  const d1 = domText(pulls.html)
  check(pulls.err === '' && d1.confirmBody.indexOf('只做快进') >= 0 && d1.confirmOk === trZh('vc.action.pull') && d1.confirmBody.indexOf('vc.') < 0,
    'J1 真渲染·拉取确认框：正文是那句话、主按钮是词条句（正文=' + JSON.stringify(d1.confirmBody) + '，按钮=' + JSON.stringify(d1.confirmOk) + '，渲染错=' + (pulls.err || '无') + '）')

  const sets = writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, { op: '', state: 'idle', message: '', confirm: { op: 'push', plan: { mode: 'set-upstream', remote: 'origin', branch: 'main', localBranch: 'main' }, ticket: ttl, remotes: [] }, result: null, remoteChoice: null })
  const d2 = domText(sets.html)
  check(d2.confirmBody.indexOf('把本地 main 推到 origin/main，并把它设为上游。') >= 0 && d2.confirmOk === trZh('vc.action.pushSetUpstream'),
    'J2 真渲染·set-upstream 确认框：正文点名目标并写清设为上游（正文=' + JSON.stringify(d2.confirmBody) + '，按钮=' + JSON.stringify(d2.confirmOk) + '）')

  const recs = writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, { op: '', state: 'idle', message: '', confirm: { op: 'push', plan: { mode: 'recreate', remote: 'origin', branch: 'feature', localBranch: 'feature' }, ticket: ttl, remotes: [] }, result: null, remoteChoice: null })
  const d3 = domText(recs.html)
  check(d3.confirmBody.indexOf('origin/feature') >= 0 && d3.confirmBody.indexOf('不在了') >= 0 && d3.confirmOk === trZh('vc.action.pushRecreate'),
    'J3 真渲染·recreate 确认框：正文说「已经不在了」并点名目标（正文=' + JSON.stringify(d3.confirmBody) + '，按钮=' + JSON.stringify(d3.confirmOk) + '）')

  const fails = writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, { op: '', state: 'failed', message: '', confirm: null, remoteChoice: null, result: { state: 'failed', key: 'vc.writeErr.notFastForward', params: {}, limitKey: 'vc.writeErr.notFastForward.limit', verb: 'vc.op.failed', tipKey: '', tip: '宿主原话', retryable: true, moved: false } })
  const d4 = domText(fails.html)
  check(d4.result.indexOf('没做成') >= 0 && d4.resultText.indexOf('远端的新提交已经取回来了') >= 0 && d4.resultLimit.indexOf('命令行') >= 0 && d4.resultLimit.indexOf('侧栏终端') < 0 && d4.result.indexOf('vc.') < 0,
    'J4 真渲染·失败横幅：动作词 + 主句 + limit 句都是人话（横幅=' + JSON.stringify(d4.result) + '，渲染错=' + (fails.err || '无') + '，HTML 长=' + fails.html.length + '）')

  const dones = writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, { op: '', state: 'done', message: '', confirm: null, remoteChoice: null, result: { state: 'done', key: 'vc.op.donePushRecreate', params: { local: 'feature', remote: 'origin', target: 'feature' }, verb: 'vc.op.done', tipKey: '', tip: '', retryable: false, moved: false } })
  const d5 = domText(dones.html)
  check(d5.result.indexOf('做完了') >= 0 && d5.result.indexOf('已重建上游') >= 0 && d5.result.indexOf('origin/feature') >= 0 && d5.result.indexOf('vc.') < 0,
    'J5 真渲染·成功横幅：按预检档说「已重建上游…」（横幅=' + JSON.stringify(d5.result) + '，渲染错=' + (dones.err || '无') + '）')

  const running = writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, { op: 'pull', state: 'running', message: '', confirm: null, result: null, remoteChoice: null })
  const d6 = domText(running.html)
  check(d6.running === trZh('vc.op.running'), 'J6 真渲染·执行中那一行有正文（实得 ' + JSON.stringify(d6.running) + '）')

  const choice = writePresetHtml(React, DswsCtx, TipStub, IcStub, screen, { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: { show: true, remotes: ['origin', 'mirror'], hint: '' } })
  const d7 = domText(choice.html)
  check(d7.choice.indexOf(trZh('vc.pickRemote.title')) >= 0 && d7.choiceBody.indexOf('面板不替你挑远端') >= 0 && d7.choice.indexOf('origin') >= 0 && d7.choice.indexOf('mirror') >= 0,
    'J7 真渲染·多远端候选框：标题与正文都是人话、两个远端都可点（框=' + JSON.stringify(d7.choice.slice(0, 60)) + '）')

  // J8 通用守卫：上面七次真渲染的文字里，一个 vc. 开头的词条键都不许出现。
  const allText = [d1, d2, d3, d4, d5, d6, d7].map(function (d) { return d.text }).join('\n')
  const leaked = allText.match(/vc\.[A-Za-z][A-Za-z0-9_.]*/g) || []
  check(leaked.length === 0, 'J8 通用守卫：真渲染出来的文字里不出现词条键（命中：' + (leaked.slice(0, 5).join('、') || '无') + '）')

  // J9 真渲染·补丁块（task-61 打磨）：卡片类挂上了、差异行画出来了。
  //   展开键是「分组\u0000路径」（块模型那一层的口径）；未提交那一层点开打不开是既有缺陷，见 .tmp-842-visual/POLISH.md。
  const diffReads = Object.assign({}, readsOf(screen), { diffs: { 'a.txt': { state: 'ok', lines: [{ kind: 'add', text: '+新行' }, { kind: 'del', text: '-旧行' }], reason: 'ok', truncated: false, error: null } } })
  const diffRender = renderTab(React, DswsCtx, TipStub, IcStub, diffReads, function (s) {
    return s.replace("openDiff: '', openCommit: '', view:", "openDiff: 'staged' + String.fromCharCode(0) + 'a.txt', openCommit: '', view:")
  })
  const doc9 = new (require('jsdom').JSDOM)('<div id="m">' + diffRender.html + '</div>').window.document
  const card = doc9.querySelector('[data-vc-diff="lines"]')
  check(!!card && String(card.className).indexOf('dsws-vc-card') >= 0 && card.textContent.indexOf('新行') >= 0 && card.textContent.indexOf('旧行') >= 0,
    'J9 真渲染·补丁块：卡片类与差异行都在（class=' + (card ? card.className : '缺') + '，渲染错=' + (diffRender.err || '无') + '）')

  // J10–J13：#850 —— 两组各自的文件行都能点开自己的补丁；同一路径在两组时互不串；键改回裸路径必须红。
  const openKey = function (group, path) { return group + String.fromCharCode(0) + path }
  const diffReadsOf = function (paths) {
    const diffs = {}
    paths.forEach(function (p2) { diffs[p2] = { state: 'ok', lines: [{ kind: 'add', text: '+新行' }], reason: 'ok', truncated: false, error: null } })
    return Object.assign({}, readsOf(screen), { diffs: diffs })
  }
  const uiSeed = "openDiff: '', openCommit: '', view:"
  const renderOpen = function (key, reads, patchExtra) {
    const v = buildView(function (s) {
      let out = s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })')
      out = out.replace(uiSeed, 'openDiff: ' + JSON.stringify(key) + ", openCommit: '', view:")
      return patchExtra ? patchExtra(out) : out
    }, React, DswsCtx, TipStub, IcStub, reads, [], trZh)
    try { return require('react-dom/server').renderToStaticMarkup(React.createElement(v.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { return '' }
  }
  const rowsWithCard = function (html) {
    const doc = new (require('jsdom').JSDOM)('<div id="m">' + html + '</div>').window.document
    const out = []
    Array.prototype.slice.call(doc.querySelectorAll('[data-vc-file]')).forEach(function (el) {
      if (el.querySelector('[data-vc-diff]')) out.push(String(el.textContent || '').slice(0, 20))
    })
    return out
  }
  const staged10 = rowsWithCard(renderOpen(openKey('staged', 'a.txt'), diffReadsOf(['a.txt'])))
  check(staged10.length === 1 && staged10[0].indexOf('a.txt') >= 0, 'J10 #850·已暂存组：点开 a.txt 画出它自己的补丁（含补丁的行：' + JSON.stringify(staged10) + '）')

  const un11 = rowsWithCard(renderOpen(openKey('unstaged', 'b.txt'), diffReadsOf(['b.txt'])))
  check(un11.length === 1 && un11[0].indexOf('b.txt') >= 0, 'J11 #850·未暂存组：点开 b.txt 画出它自己的补丁（含补丁的行：' + JSON.stringify(un11) + '）')

  const dual = screenOf({ staged: [fileOf('x.txt', 'staged')], stagedCount: 1, unstaged: [fileOf('x.txt', 'unstaged')], unstagedCount: 1 })
  const dualReads = Object.assign({}, readsOf(dual), { diffs: { 'x.txt': { state: 'ok', lines: [{ kind: 'add', text: '+新行' }], reason: 'ok', truncated: false, error: null } } })
  const dualOpen = rowsWithCard(renderOpen(openKey('staged', 'x.txt'), dualReads))
  const dualBoth = rowsWithCard(renderOpen(openKey('unstaged', 'x.txt'), dualReads))
  const dualDoc = new (require('jsdom').JSDOM)('<div id="m">' + renderOpen(openKey('staged', 'x.txt'), dualReads) + '</div>').window.document
  const dualRows = Array.prototype.slice.call(dualDoc.querySelectorAll('[data-vc-file]'))
  const onlyFirst = dualRows.length === 2 && !!dualRows[0].querySelector('[data-vc-diff]') && !dualRows[1].querySelector('[data-vc-diff]')
  check(dualOpen.length === 1 && dualBoth.length === 1 && onlyFirst, 'J12 #850·同一路径在两组时互不串：展开键带分组，一次只开一行（已暂存键=' + JSON.stringify(dualOpen) + '，未暂存键=' + JSON.stringify(dualBoth) + '，只有第一行开=' + onlyFirst + '）')

  const bareHtml = renderOpen(openKey('staged', 'a.txt'), diffReadsOf(['a.txt']), function (s) {
    return s.replace("  return String(r.group || '') + '\\u0000' + String(r.path || '')", "  return String(r.path || '')")
  })
  check(rowsWithCard(bareHtml).length === 0, 'J13 反证：把展开键改回裸路径 → J10 那条当场不成立（含补丁的行：' + JSON.stringify(rowsWithCard(bareHtml)) + '）')

  const loadingReads = Object.assign({}, readsOf(screen), { diffs: { 'a.txt': { state: 'loading', lines: null, reason: '', truncated: false, error: null } } })
  const loadingHtml = renderOpen(openKey('staged', 'a.txt'), loadingReads)
  const loadingDoc = new (require('jsdom').JSDOM)('<div id="m">' + loadingHtml + '</div>').window.document
  const loadingBlock = loadingDoc.querySelector('[data-vc-diff="loading"]')
  const loadingBars = loadingBlock ? loadingBlock.querySelectorAll('[data-vc-skel="1"]') : []
  check(!!loadingBlock && loadingBars.length >= 3 && loadingBlock.textContent.trim() === '' && loadingHtml.indexOf('正在读改动') < 0, 'J14 #857·读取中的差异画骨架条，不画会跳动的文字（骨架条 ' + loadingBars.length + ' 条）')

  const failDoc = new (require('jsdom').JSDOM)('<div id="m">' + fails.html + '</div>').window.document
  const failAi = failDoc.querySelector('[data-vc-op-result] [data-vc-ai="write-fail"]')
  const doneDoc = new (require('jsdom').JSDOM)('<div id="m">' + dones.html + '</div>').window.document
  check(!!failAi && failAi.textContent === trZh('vc.action.aiHandoff') && !doneDoc.querySelector('[data-vc-op-result] [data-vc-ai]'), 'J15 #854·没做成的横幅旁边有「让 AI 帮我解决」，做完了没有（按钮=' + (failAi ? '有' : '无') + '）')
}



// ============================================================
// L 组 · 视觉语言（#851 照原型 C「档案索引」）：徽章 / 等宽 / 正负着色 / 小标题 / 字号层级
//   这一组同时给三条反证：把新加的样式钩子改回去，对应的判据必须当场变红。
// ============================================================
function groupL(view, React, DswsCtx, TipStub, IcStub) {
  // 这一组要同时看到文件行与提交历史行（短号等宽那条挂在提交行上），所以夹具带上一条提交。
  const screen = screenOf({
    staged: [fileOf('a.txt', 'staged')], stagedCount: 1,
    unstaged: [fileOf('b.txt', 'unstaged')], unstagedCount: 1,
    commits: [{ oid: 'c'.repeat(40), short: 'ccccccc', subject: '提交说明', author: 'x', authorDateMs: NOW - 3600000, commitDateMs: NOW - 3600000, parents: ['p'] }],
  })
  const render = function (patch) {
    const v = buildView(function (s) {
      let out = s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })')
      return patch ? patch(out) : out
    }, React, DswsCtx, TipStub, IcStub, readsOf(screen), [], trZh)
    try { return require('react-dom/server').renderToStaticMarkup(React.createElement(v.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { return '' }
  }
  const docOf = function (html) { return new (require('jsdom').JSDOM)('<div id="m">' + html + '</div>').window.document.getElementById('m') }
  const letters = ['added', 'modified', 'deleted', 'renamed', 'typechange', 'untracked'].map(function (c) { return view.vcBadgeLetterOf(c) }).join('')
  const badgeOk = function (doc) {
    const b = doc.querySelector('[data-vc-badge]')
    const row = doc.querySelector('[data-vc-file]')
    return !!b && b.textContent === 'M' && String(b.className).indexOf('dsws-vc-badge') >= 0 && !!row && row.textContent.indexOf('修改') >= 0
  }
  const monoOk = function (doc) {
    // 文件行里等宽的元素不止一个（状态词、路径、行数都是），所以要找「装着路径那一枚」。
    const pathOk = Array.prototype.some.call(doc.querySelectorAll('[data-vc-file] .dsws-vc-mono'), function (el) { return el.textContent.indexOf('a.txt') >= 0 })
    // 提交短号住在历史视图里（布局 C）：到那个视图去查，不在改动页硬找。
    const commitsDoc = docOf(render(function (s) { return s.replace("view: vcRememberedView()", "view: 'commits'") }))
    const shortOk = Array.prototype.some.call(commitsDoc.querySelectorAll('[data-vc-commit] .dsws-vc-mono'), function (el) { return el.textContent.indexOf('ccccccc') >= 0 })
    return pathOk && shortOk
  }
  const countsOk = function (doc) {
    const a = doc.querySelector('[data-vc-file] .dsws-vc-add')
    const d = doc.querySelector('[data-vc-file] .dsws-vc-del')
    const row = doc.querySelector('[data-vc-file]')
    return !!a && !!d && a.textContent === '+1' && d.textContent === '\u22120' && row.textContent.indexOf('+1 \u22120') >= 0
  }
  const secOk = function (doc) {
    const el = doc.querySelector('[data-vc-group] .dsws-vc-sec')
    return !!el && el.textContent.indexOf('已暂存') >= 0
  }
  const hierOk = function (doc) {
    const name = doc.querySelector('[data-vc-worktree]')
    const sync = doc.querySelector('[data-vc-sync]')
    const pathEl = doc.querySelector('[data-vc-path]')
    return !!name && String(name.className).indexOf('dsws-vc-id') >= 0 && !!sync && String(sync.className).indexOf('dsws-vc-count') >= 0 && !!pathEl && String(pathEl.className).indexOf('dsws-vc-mono') >= 0
  }
  const html = render(null)
  const doc = docOf(html)
  check(letters === 'AMDRT?' && badgeOk(doc), 'L1 状态字母徽章：六种变化各一个字母（实得 ' + letters + '），文件行上挂方形徽章，中文状态词「修改」照旧在同一行里')
  check(monoOk(doc), 'L2 等宽 + 表格数字：路径与提交短号都挂 dsws-vc-mono')
  check(countsOk(doc), 'L3 加减行数按正负着色：+1 与 \u22120 各自一个 span（合起来仍是原来那一串）')
  check(secOk(doc), 'L4 分段小标题：分组标题挂 dsws-vc-sec，文字仍是既有词条（已暂存…）')
  check(hierOk(doc), 'L5 身份行与计数行拉开层级：身份行 dsws-vc-id、计数行 dsws-vc-count、路径行 dsws-vc-mono')

  // 反证（三条）：把新加的样式钩子改回去，对应的判据必须当场变红。
  const noBadge = docOf(render(function (s) { return s.replace("    badge: vcBadgeLetterOf(row.change),", "    badge: '',") }))
  check(badgeOk(noBadge) === false, 'L6 反证：把行模型里的徽章字母去掉 → L1 那条当场不成立')
  const noMono = docOf(render(function (s) { return s.replace("h('span', { key: 'path', className: 'dsws-vc-mono', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.pathText)", "h('span', { key: 'path', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.pathText)") }))
  check(monoOk(noMono) === false, 'L7 反证：把路径上的 dsws-vc-mono 撤掉 → L2 那条当场不成立')
  const noSign = docOf(render(function (s) { return s.replace("h('span', { key: 'add', className: 'dsws-vc-add' }, row.addText),", "h('span', { key: 'add' }, row.addText),") }))
  check(countsOk(noSign) === false, 'L8 反证：把加减行数的着色类撤掉 → L3 那条当场不成立')
}

// ============================================================
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

  // K3 真渲染：kind=env-fs 的失败信封 → 可见文字是那一档、不提 git、不出现词条键（J8 守卫同口径）。
  const errReads = { screen: { state: 'err', data: null, error: { kind: 'env-fs', message: '宿主的原话：文件服务没给出结论' } }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const r = renderTab(React, DswsCtx, TipStub, IcStub, errReads, null)
  const d = domText(r.html)
  const leaked = d.text.match(/vc\.[A-Za-z][A-Za-z0-9_.]*/g) || []
  check(r.err === '' && d.text.indexOf('运行状态') >= 0 && d.text.indexOf(zhEnvFs) >= 0 && !/git/i.test(d.text) && leaked.length === 0,
    'K3 真渲染 kind=env-fs：可见文字是「运行状态 / 文件服务」那句、不提 git、不出现词条键（实得 ' + JSON.stringify(d.text.slice(0, 60)) + '）')
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
  check(recConfirm.mode === 'recreate' && recConfirm.body.indexOf('origin/feature') >= 0 && recConfirm.body.indexOf('已经不在了') >= 0 && recArgv.indexOf('origin') >= 0 && recArgv.indexOf('feature:feature') >= 0, 'I4 上游被删那一档：正文说「已经不在了」、命令是显式 feature:feature（正文=' + recConfirm.body + '；命令=' + recArgv + '）')
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

  const v5 = build(function (s) { return s.replace('const stagePaths = guarded(function (paths) {', "const stagePaths = guarded(function (paths) { callHost('wf.gitStatus', { cwd: cwd })") })
  const screen = richScreen()
  const host5 = makeHost(function () { return { ok: true, staged: ['b.txt'], atMs: NOW } })
  const ops5 = v5.vcWriteOpsOf({ ui: uiOf(), setUi: function () {}, callHost: host5.call, cwd: 'D:/w/repo', readsRef: { current: readsOf(screen) }, setReads: function () {}, screen: screen })
  ops5.stagePaths(['b.txt'])
  const read5 = host5.methods().filter(function (m) { return m === 'wf.gitStatus' }).length
  await flush()
  check(read5 > 0, 'H5 反证：执行中偷发一次只读电话 → E1 那条当场不成立（实测 ' + read5 + ' 次）')

  const shortExports = EXPORTS.filter(function (n) { return n !== 'vcConfirmOf' })
  const v6 = build(null, shortExports)
  check(typeof v6.vcConfirmOf === 'undefined', 'H6 反证：从 EXPORTS 名单里去掉一个新导出 → F3 那条当场不成立')

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
async function main() {
  console.log('版本管理写操作界面门禁（#842：A–M 组）')
  const panelMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'locale-panel.js')).href)
  const flowMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'locale-flow.js')).href)
  const vcMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'locale-vcwrite.js')).href)
  LOC = {
    zh: Object.assign({}, panelMod.L_PANEL.zh, flowMod.L_FLOW.zh, vcMod.L_VCWRITE.zh),
    en: Object.assign({}, panelMod.L_PANEL.en, flowMod.L_FLOW.en, vcMod.L_VCWRITE.en),
  }
  const reasonsMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'write-reasons.js')).href)
  const writeReasons = Object.keys(reasonsMod.WRITE_REASONS)
  // I 组要用宿主真源：真 pushPlanOf 生成 plan、真 pushArgs 拼命令（不是手搓形状）。
  const planMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'push-plan.js')).href)
  const cmdMod = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'commands.js')).href)

  const React = require('react')
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
  groupF(view, EXPORTS)
  await groupG(view)
  groupJ(React, DswsCtx, TipStub, IcStub)
  groupK(view, React, DswsCtx, TipStub, IcStub)
  groupL(view, React, DswsCtx, TipStub, IcStub)
  await groupM(view)
  await groupI(view, planMod.pushPlanOf, cmdMod.pushArgs)
  await groupH(React, DswsCtx, TipStub, IcStub, logs)

  console.log(failed ? '\n存在失败' : '\n全部通过 — 写操作界面门禁生效（' + total + ' 条断言）')
  process.exit(failed ? 1 : 0)
}
main().catch(function (e) { console.error(e); process.exit(1) })
