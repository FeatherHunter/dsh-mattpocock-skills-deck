// tests/verify-842-version-control-write-view.js — 版本管理「写操作」界面门禁（#842 落地）
// 用法：在插件根目录执行 node tests/verify-842-version-control-write-view.js，可独立运行。
//
// 这份门禁守的是「用户点得完、看得懂」那一半：#842 的四个动作（暂存 / 提交 / 拉取 / 推送）落点对不对、
//   禁用态读的是不是核心判定、三个确认框有没有点名目标、五族失败话术能不能照着做、执行中会不会把读数弄假。
// 写法照 tests/verify-818-version-control-view.js 的先例：把叶子按 build.mjs 的次序拼成真闭包再跑，
//   词条读真字典（locale-panel / locale-flow / locale-vcwrite），断言落在模型与真渲染出来的 DOM 上。
//
// A–H 八组共 41 条；H 组是六条反证：把被守的东西改坏，同一套判据必须当场不再成立。
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
  'src/client/views/versionControl/vcRows.js',
  'src/client/views/versionControl/vcWrite.js',
  'src/client/views/versionControl/vcWriteRun.js',
  'src/client/views/versionControl/vcWriteUi.js',
  'src/client/views/versionControl/vcWriteOps.js',
  'src/client/views/versionControl/vcWriteView.js',
  'src/client/views/versionControl/vcBlocks.js',
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
  'vcBasisText',
  'vcBlockKeyOf',
  'vcBlockedTipOf',
  'vcBlocksOf',
  'vcChangeKeyOf',
  'vcChangeToneOf',
  'vcClockText',
  'vcCommitAreaNode',
  'vcCommitBlockOf',
  'vcCommitKeyOf',
  'vcCommitListOf',
  'vcCommitModeOf',
  'vcConfirmOf',
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
  check(a5, 'A5 冲突行没有「暂存」而有去侧栏终端的指引（模型 ' + JSON.stringify(rowD && rowD.stageAction) + '，DOM ' + (html.indexOf('data-vc-conflict-terminal') >= 0) + '）')

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
  check(pullBody.indexOf('快进') >= 0 && pullBody.indexOf('侧栏终端') >= 0, 'C5 拉取确认框正文写清「只做快进」与「去侧栏终端」（' + pullBody + '）')

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
    return s.indexOf('侧栏终端') < 0 && s.indexOf('不自动重试') < 0
  })
  check(weak.length === 0, 'D2 五条 limit 句都提到「侧栏终端」或「不自动重试」（缺的：' + (weak.join('、') || '无') + '）')

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
const NEW_LEAVES = ['vcRows.js', 'vcWrite.js', 'vcWriteRun.js', 'vcWriteUi.js', 'vcWriteOps.js', 'vcWriteView.js']
const leafPath = (f) => 'src/client/views/versionControl/' + f
const stripComments = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function groupF(view, exportsList) {
  const over = NEW_LEAVES.filter(function (f) { return read(leafPath(f)).split(/\r?\n/).length > 350 })
  check(over.length === 0, 'F1 六个新叶子各自 ≤350 行（超的：' + (over.join('、') || '无') + '）')

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
    return s.replace("openCommit: '', write: { op: '', state: 'idle', message: '', confirm: null, result: null, remoteChoice: null }", "openCommit: '', write: " + preset)
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
  check(d4.result.indexOf('没做成') >= 0 && d4.resultText.indexOf('远端的新提交已经取回来了') >= 0 && d4.resultLimit.indexOf('侧栏终端') >= 0 && d4.result.indexOf('vc.') < 0,
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
async function main() {
  console.log('版本管理写操作界面门禁（#842：A–H 八组）')
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
  await groupI(view, planMod.pushPlanOf, cmdMod.pushArgs)
  await groupH(React, DswsCtx, TipStub, IcStub, logs)

  console.log(failed ? '\n存在失败' : '\n全部通过 — 写操作界面门禁生效（' + total + ' 条断言）')
  process.exit(failed ? 1 : 0)
}
main().catch(function (e) { console.error(e); process.exit(1) })
