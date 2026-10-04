// tests/verify-818-version-control-view.js — 版本管理页签界面侧门禁（#818 落地）
// 用法：在插件根目录执行 node tests/verify-818-version-control-view.js，可独立运行。
//
// 主缝（规格定的那一条）：喂一份录好的状态模型，断言「该画哪些块、每块写什么字」。断言落在
//   用户读到的文字与块的顺序上，不落在内部字段名上。模型有三个来源：
//     A. 用真宿主取数层 + 真机样本（version-control-core/fixtures/live-numstat-shapes.json）跑一次
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
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const NOW = Date.parse('2026-10-04T02:00:00+08:00')
const VC_FILES = [
  // #842：判定真源（界面按它画按钮状态，不自己算）与写操作那五个新叶子也拼进这个闭包 ——
  //   入口组件 VersionControlTab.js 会调它们，缺一个就会在渲染那一帧抛错（G 组抓的就是这个）。
  'src/shared/version-control/rules.js',
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
  'src/client/views/versionControl/VersionControlTab.js',
]

// ---------- 真词条：直接 import 两份词条模块，断言落在真字典上 ----------
// 为什么不数「键在文件里出现两次」：上一版正是栽在这里 —— 新词条被插到了 zh: { … } 的**外面**，
//   L_PANEL 顶层多出 62 个键，中文界面把键名原样印了出来，而两道既有门禁都说「全部通过」。
//   所以这里 import 真模块、读真字典，再逐键断言 zh 与 en 两边都存在且非空。
const fill = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : String(s))
let LOC = { zh: {}, en: {} }
let tZh = (k) => k
let tEn = (k) => k

// ---------- 界面侧闭包：照 scripts/build.mjs 的做法把六个叶子拼起来再跑 ----------
function stripExports(text) { return text.replace(/^(\s*)export\s+/gm, '$1') }
const EXPORTS = ['VC_PHONES', 'VC_FILE_ROWS_FIRST', 'VC_FILE_ROWS_BATCH', 'VC_DIFF_LINES_SHOWN', 'VC_BLOCK_ORDER', 'VC_VIEWS', 'VC_TONE', 'VC_MIDDLE_MIN', 'VC_FOLD_STEP_CAP', 'VC_SYNC_VALUES', 'VC_DIFF_REASON_KEY', 'VC_OTHER_SUMMARY_NAMES',
  'vcFailKeyOf', 'vcFileRowsOf', 'vcDiffViewOf', 'vcSyncViewOf', 'vcOtherRowOf', 'vcReadsOf', 'vcBlocksOf',
  'vcChangeKeyOf', 'vcChangeToneOf', 'vcTail', 'vcMiddle', 'vcShortOid', 'vcPlusMinus', 'vcTimeKind',
  'vcWhenText', 'vcBasisText', 'vcFoldBandAt', 'vcFoldDataOf', 'vcFoldLadderOf', 'vcFoldStateAt', 'vcFoldOf',
  'vcTabVisible', 'vcNewReads', 'vcFailureOf', 'vcReadStatus', 'vcReadDiff', 'vcReadMoreCommits', 'vcNextSkipOf',
  'vcCommitKeyOf', 'vcReadCommitFiles', 'vcReadCommitFileDiff', 'vcCommitModeOf', 'vcCommitBlockOf', 'vcShouldRead', 'vcViewOf', 'vcRememberedView', 'vcRememberView', 'vcResetViewMemory', 'vcViewCountsOf', 'vcViewBlocksOf', 'vcViewTabsNode', 'VC_AI_READ_FAIL_KINDS', 'vcAiHandoffOf', 'vcAiButtonNode', 'vcOpenAiHandoff',
  'vcFreshOnCwd', 'vcScreenShapeOk', 'vcApplyCommitReply', 'vcMarkLogLoading', 'vcOneLine',
  'VersionControlTab']
function buildView(patch, logs, React, DswsCtx, Tip, Ic, seedReads, hostStub) {
  let src = VC_FILES.map((f) => stripExports(read(f))).join('\n')
  if (patch) src = patch(src)
  const body = src + '\nreturn { ' + EXPORTS.join(', ') + ' }\n'
  const fn = new Function('React', 'log', 'dswsLogHash', 'dswsLogTrunc', 'tr', 'host', 'DswsCtx', 'Tip', 'Ic', 'seedReads', body)
  return fn(React || {}, function (level, event, fields) { logs.push({ level: level, event: event, fields: fields }) },
    function () { return 'h8' }, function (s) { return String(s) }, tZh, hostStub || {}, DswsCtx || null, Tip || null, Ic || null, seedReads || null)
}
let VIEW = null

// ---------- 假适配器：形状照 DSH subprocess 服务（与 verify-version-control-host.js 同一形状） ----------
const LIVE = JSON.parse(read('version-control-core/fixtures/live-numstat-shapes.json'))
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
/** 从某个 `React.useEffect(function () {` 的起点取出它的函数体（花括号配对）；取不到回空串。 */
function effectBodyAfter(src, at) {
  const open = src.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i)
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i) }
  }
  return ''
}

// ============================================================
async function main() {
  console.log('版本管理页签界面侧门禁（#818：主缝 + 次缝 + 比照 + 反证）')
  // 真字典：两份词条模块都是纯 ESM，可以直接 import 进来读它们的 zh / en 两个对象。
  const panelMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'locale-panel.js')).href)
  const flowMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'locale-flow.js')).href)
  // #842：写操作那一族的词条自成一个片段（locale-panel 与 locale-flow 都在上限上），这里一并读真字典。
  const vcWriteMod = await import(pathToFileURL(path.join(ROOT, 'src', 'client', 'kernel', 'locale-vcwrite.js')).href)
  const L_PANEL = panelMod.L_PANEL
  const L_FLOW = flowMod.L_FLOW
  const L_VCWRITE = vcWriteMod.L_VCWRITE
  LOC = { zh: Object.assign({}, L_PANEL.zh, L_FLOW.zh, L_VCWRITE.zh), en: Object.assign({}, L_PANEL.en, L_FLOW.en, L_VCWRITE.en) }
  tZh = (k, p) => fill(LOC.zh[k] !== undefined ? LOC.zh[k] : k, p)
  tEn = (k, p) => fill(LOC.en[k] !== undefined ? LOC.en[k] : k, p)
  VIEW = buildView(null, [])

  // ---- A 组：显隐与接线 ----
  // #845c：A1 那条判据抽成可复用的一份 —— H 组的反证要评的就是这一份判断，两边不许各写一份。
  //   三个入参就是 A1 点名的三种：普通对象、带 repoRoot 的快照、null。
  const tabVisibleJudgmentOf = (v) => v.vcTabVisible({}) === true && v.vcTabVisible({ snapshot: { repoRoot: null } }) === true && v.vcTabVisible(null) === true
  check(tabVisibleJudgmentOf(VIEW), 'A1 显隐谓词一律回真（总工程师裁定的偏离：不藏页签，空态由视图说真话）')
  const tabsSrc = read('src/client/views/shared/Tabs.js')
  check(tabsSrc.indexOf("typeof vcTabVisible === 'function'") >= 0 && tabsSrc.indexOf("'versionControl'") >= 0 && tabsSrc.indexOf("'branch'") >= 0, 'A2 壳层按名字调用 vcTabVisible、页签 id 与图标名与接口一致')
  const tabSrc = read('src/client/views/versionControl/VersionControlTab.js')
  check(/export\s+const\s+VersionControlTab\s*=/.test(tabSrc), 'A3 入口导出名 VersionControlTab（壳层按这个名字调）')
  const buildSrc = read('scripts/build.mjs')
  const leafOrder = VC_FILES.map((f) => buildSrc.indexOf("'" + f + "'"))
  check(leafOrder.every((i) => i > 0) && leafOrder.every((i, k) => k === 0 || i > leafOrder[k - 1]), 'A4 八个叶子按依赖次序登记在 LEAF_MODULES 里')
  check(buildSrc.indexOf("src/client/views/versionControl/vcText.js") < buildSrc.indexOf("file: 'src/client/views/shared/Tabs.js'"), 'A5 新叶子排在 tabs 之前（Tabs.js 要按 vcTabVisible 判显隐）')
  const idxSrc = read('src/client/index.js')
  const VC_IDS = ['vcText', 'vcFold', 'vcDiff', 'vcCommit', 'vcBlocks', 'vcViews', 'vcTabVisible', 'vcData', 'versionControlTab', 'vcDiffOps']
  check(VC_IDS.every((id) => idxSrc.indexOf('leaf:' + id + ' (spliced') >= 0), 'A6 index.js 里拼接标记齐备（标记 id 就是 LEAF_MODULES 登记的那个，多一个 vcDiffOps）')
  check(idxSrc.indexOf('leaf:vcText (spliced') < idxSrc.indexOf('leaf:tabs (spliced'), 'A7 六个标记排在 tabs 标记之前')

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
  check(!!binaryRow && binaryRow.countsText === '' && binaryRow.countsTip === '二进制文件没有逐行增删的数字。', 'B12 二进制文件没有行数：不写 0，如实说没有这个数字')
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
  check(dId.oidText === '停在提交 ' + 'b'.repeat(12) && dId.sync.text === '不在任何分支上，领先落后这一套用不上', 'C2 游离头指针：给出停在哪次提交上，并说清领先落后用不上')

  const noUp = screenOf({ identity: { sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null } })
  const nB = VIEW.vcBlocksOf(noUp, readsOf(noUp), {}, envOf(noUp, readsOf(noUp)))
  const nId = blockOf(nB, 'identity')
  check(nId.sync.text === '还没有推送目标' && allText(nB).indexOf('领先 0') < 0, 'C3 没设推送目标：写「还没有推送目标」，不写「领先 0」')

  const gone = screenOf({ identity: { sync: 'upstream-gone', ahead: 0, behind: 0, basisMs: null } })
  const gId = blockOf(VIEW.vcBlocksOf(gone, readsOf(gone), {}, envOf(gone, readsOf(gone))), 'identity')
  check(gId.sync.text === '推送目标已经不存在', 'C4 推送目标在远端被删：明说「推送目标已经不存在」')

  const stale = screenOf({ identity: { sync: 'tracked-unknown', ahead: 3, behind: 1, basisMs: null } })
  const sId = blockOf(VIEW.vcBlocksOf(stale, readsOf(stale), {}, envOf(stale, readsOf(stale))), 'identity')
  check(sId.sync.text === '领先 3 个提交，落后 1 个提交' && sId.sync.basis === '远端信息什么时候更新的读不到', 'C5 有推送目标但依据时间读不到：数字照常写，依据如实说读不到')

  const fresh = screenOf({ identity: { sync: 'tracked-known', ahead: 2, behind: 0, basisMs: NOW - 3 * 24 * 3600 * 1000 } })
  const fId = blockOf(VIEW.vcBlocksOf(fresh, readsOf(fresh), {}, envOf(fresh, readsOf(fresh))), 'identity')
  check(fId.sync.basis === '远端信息更新于 3 天前', 'C6 依据时间永远显示：三天前的依据就写「3 天前」（实得「' + fId.sync.basis + '」）')

  const zero = screenOf({ identity: { branch: 'main', oid: null, sync: 'no-upstream', ahead: 0, behind: 0, basisMs: null }, repo: { hasCommits: false } })
  const zB = VIEW.vcBlocksOf(zero, readsOf(zero), {}, envOf(zero, readsOf(zero)))
  check(allText(zB).indexOf('这个仓库还没有任何提交') >= 0 && blockOf(zB, 'commits').empty === true, 'C7 零提交仓库：异常带与历史块都明说「这个仓库还没有任何提交」')

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
  check(allText(mB).indexOf('正在合并') >= 0 && allText(mB).indexOf('有 2 个文件卡在冲突里') >= 0, 'C8 正在合并 + 有冲突：异常带在显眼位置说明，并指去终端')
  check(mRows.length === 1 && mRows[0].conflict === true && mRows[0].conflictText === '冲突', 'C9 同一路径既有冲突又有普通修改：界面上只占一行并带冲突标记')
  check(blockOf(mB, 'changes').groups.map((g) => g.key).join(',') === 'conflict', 'C10 冲突单独一组（排在已暂存之后、未暂存之前）')
  check(allText(mB).indexOf('这些文件里同时留着两边的内容：你这个分支上的') >= 0, 'C11 合并冲突说清两边各是什么')
  check(allText(mB).indexOf('错误') < 0 && allText(mB).indexOf('失败') < 0, 'C12 冲突与合并进行中的话术里不出现「错误」两个字')

  const others = screenOf({ otherWorktrees: [
    { path: 'D:/w/a', display: 'a', head: 'h', branch: 'main', bare: false, current: false, locked: false, lockReason: null, lockUnknown: true, prunable: false },
    { path: 'D:/w/b', display: 'b', head: 'h', branch: 'dev', bare: false, current: false, locked: true, lockReason: null, lockUnknown: false, prunable: true },
  ] })
  const oB = VIEW.vcBlocksOf(others, readsOf(others), {}, envOf(others, readsOf(others)))
  const oBlock = blockOf(oB, 'other')
  check(oBlock.title === '其他工作树 (2)', 'C13 标题写「其他工作树 (2)」（硬约束，不许写成「工作树与分支」）')
  check(oBlock.rows[0].stateText === '无法显示' && oBlock.rows[1].stateText === '目录已不存在', 'C14 答不出占用写「无法显示」、目录已不存在照实写；答不出不当成没被占用')
  check(oBlock.tip.indexOf('不列没有检出的本地分支') >= 0, 'C15 其他工作树那一条说清它不是分支全貌')

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
  check(longRow.diff.lines.length === VIEW.VC_DIFF_LINES_SHOWN && longRow.diff.hunks.length > 0 && longRow.diff.shownNote === '只显示了前 200 行，后面的请在命令行里看。', 'C18 差异很长：先给「哪几段行区间变了」，再给前 200 行，并如实说后面到终端看')
  // 200 行这条阈值卡在边界上验：正好等于阈值给逐行、不补说明；超过一行才先给「哪几段行区间变了」并说只显示了前 200 行。
  const edgeLines = []
  for (let i = 0; i < VIEW.VC_DIFF_LINES_SHOWN; i++) edgeLines.push({ kind: 'add', text: '+' + i })
  const edgeReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: edgeLines, reason: 'ok', truncated: false, error: null } } })
  const edgeRow = rowsOf(VIEW.vcBlocksOf(files, edgeReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, edgeReads)))[0]
  const overLines = edgeLines.concat([{ kind: 'hunk', text: '@@ -201 +201 @@' }, { kind: 'add', text: '+第 201 行' }])
  const overReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: overLines, reason: 'ok', truncated: false, error: null } } })
  const overRow = rowsOf(VIEW.vcBlocksOf(files, overReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, overReads)))[0]
  check(edgeRow.diff.hunks.length === 0 && edgeRow.diff.shownNote === '' && overRow.diff.hunks.length === 1 && overRow.diff.shownNote === '只显示了前 200 行，后面的请在命令行里看。', 'C18b 200 行这条阈值卡在边界上：正好等于阈值给逐行、不补说明；超过一行才先给「哪几段行区间变了」并说只显示了前 200 行')
  // 合并提交里的单文件差异：宿主回 reason:'merge-commit'，这句话不许落到「这一处这次没读到改动内容」上。
  const mergeDiffReads = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: [], reason: 'merge-commit', truncated: false, error: null } } })
  const mergeDiffRow = rowsOf(VIEW.vcBlocksOf(files, mergeDiffReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, mergeDiffReads)))[0]
  check(mergeDiffRow.diff.state === 'note' && mergeDiffRow.diff.text === '这是一次合并提交：git 默认不展开合并提交的逐行差异，所以这里没有内容。' && mergeDiffRow.diff.text !== '这一处这次没读到改动内容。', 'C19b 合并提交里的单文件差异：如实说「git 默认不展开合并提交的逐行差异」，不许落到「这一处没读到改动内容」上')
  const reasons = { 'untracked-no-diff': '这个文件还没被 git 跟踪，没有可比的旧版本。', 'no-commit-baseline': '这个仓库还没有第一次提交，没有可比的基线。', 'binary-diff': '二进制文件，不逐行显示改动。', 'truncated': '这个文件的改动太大，读不全就没给内容；请在命令行里看这一处的完整改动。', 'no-diff': '这一处这次没读到改动内容。' }
  let reasonOk = true
  for (const k of Object.keys(reasons)) {
    const rr = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: [], reason: k, truncated: false, error: null } } })
    const row = rowsOf(VIEW.vcBlocksOf(files, rr, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, rr)))[0]
    if (row.diff.text !== reasons[k]) { reasonOk = false; console.log('    （原因 ' + k + ' 实得「' + row.diff.text + '」）') }
  }
  check(reasonOk, 'C19 差异读不到内容的五种原因各有各的实话（未跟踪 / 零提交 / 二进制 / 太大 / 空差异）')
  const diffFailReads = readsOf(files, { diffs: { '改.txt': { state: 'err', lines: null, reason: '', truncated: false, error: { kind: 'timeout', message: 'x' } } } })
  const failRow = rowsOf(VIEW.vcBlocksOf(files, diffFailReads, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, diffFailReads)))[0]
  check(failRow.diff.state === 'err' && failRow.diff.text === '这个文件的改动读不到' && failRow.diff.retry === '重试', 'C20 差异读不到：说清是哪一块读不到并给重试')

  // 历史续读
  const logMore = readsOf(files, { log: { state: 'ok', commits: [{ oid: 'c'.repeat(40), short: 'ccccccc', author: 'A', authorDateMs: NOW - 1000, commitDateMs: NOW - 1000, subject: '更早的一条', parents: [] }], hasMore: false, fetched: 1, error: null } })
  const moreBlock = blockOf(VIEW.vcBlocksOf(files, logMore, {}, envOf(files, logMore)), 'commits')
  check(moreBlock.rows.length === 1 && moreBlock.more.allLoaded === '已经到底了', 'C21 续读到底：新读回的提交接在列表里并说「已经到底了」')
  const logLoading = readsOf(files, { log: { state: 'loading', commits: [], hasMore: true, fetched: 0, error: null } })
  check(blockOf(VIEW.vcBlocksOf(files, logLoading, {}, envOf(files, logLoading)), 'commits').more.label === '正在读更早的提交…', 'C22 续读在途：那一行说「正在读更早的提交…」')
  const logFail = readsOf(files, { log: { state: 'err', commits: [{ oid: 'd'.repeat(40), short: 'ddddddd', author: 'A', authorDateMs: NOW, commitDateMs: NOW, subject: '旧的还在', parents: [] }], hasMore: true, fetched: 1, error: { kind: 'timeout', message: '' } } })
  const lfBlock = blockOf(VIEW.vcBlocksOf(files, logFail, {}, envOf(files, logFail)), 'commits')
  check(lfBlock.rows.length === 1 && lfBlock.more.failText === '更早的提交读不到' && lfBlock.more.retry === '重试', 'C23 续读失败：已经读回来的还在，旁边说读不到并给重试')

  // 首屏：还没拿到数据 / 失败 / 有旧数据
  check(VIEW.vcBlocksOf(null, VIEW.vcNewReads(), {}, { t: tZh, nowMs: NOW, fold: VIEW.vcFoldOf(460, {}) }).length === 0, 'C24 面板刚打开、还没拿到数据：整块不画（不冒一句常驻道歉）')
  const notRepo = { screen: { state: 'err', data: null, error: { kind: 'not-repo', message: '这个目录不在任何 git 仓库里' } }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const eBlock = VIEW.vcBlocksOf(null, notRepo, {}, { t: tZh, nowMs: NOW, fold: VIEW.vcFoldOf(460, {}) })[0]
  check(eBlock.kind === 'error' && eBlock.text === '这个目录不在任何 git 仓库里。' && eBlock.retry === '', 'C25 不在仓库里：如实说这句话，且不给重试按钮（它不是读取失败）')
  const noGit = { screen: { state: 'err', data: null, error: { kind: 'env', message: 'x' } }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const nBlock = VIEW.vcBlocksOf(null, noGit, {}, { t: tZh, nowMs: NOW, fold: VIEW.vcFoldOf(460, {}) })[0]
  check(nBlock.text.indexOf('找不到 git 程序') === 0 && nBlock.retry === '重试' && String(nBlock.rawTip || '').indexOf('原始说明：') === 0, 'C26 找不到 git：告诉人去确认安装与 PATH 并重启，给重试，宿主原文只进悬停（诊断线索，不进可见正文）')
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
  check(sChanges.commitMode === true && sChanges.title === '这笔提交改了什么' && sChanges.back === '回到未提交改动', 'S1 点开提交后进入「这笔提交改了什么」，最上面给出「回到未提交改动」的出路')
  check(sChanges.summary === 'eeeeeee · 给面板加一个页签', 'S2 抬头写着这是哪一笔提交（短号 + 说明）')
  check(sChanges.groups.length === 1 && sChanges.groups[0].title === '这笔提交改了 2 个文件', 'S3 文件清单与未提交那一层同一套（一组、带计数）')
  const sRows = sChanges.groups[0].rows
  check(sRows.length === 2 && sRows[0].pathText === '面板/新页签.js' && sRows[0].countsText === '+12 −' + '3' && sRows[0].pathTip === '面板/新页签.js', 'S4 每一行给路径与 +a −d，悬停里是完整路径（与未提交那一层同一个画法）')
  check(sRows[1].changeText === '重命名' && sRows[0].changeText === '' && sRows[0].changeTone === 'warning', 'S5 能证明的只有重命名；判不出类型的那一行不冒充六种变化（不画类型字）')
  check(sRows[0].rowTip.indexOf('这笔提交只回了路径与增删行数，判不出变化类型') === 0 && sRows[1].rowTip.indexOf('这笔提交只回了') < 0, 'S5b 判不出类型时悬停里如实说清来由（不让用户以为 git 没给）')
  const patchReads = sReads({ commitDiffs: { [VIEW.vcCommitKeyOf(REV1, '面板/新页签.js')]: { state: 'ok', lines: shortLines, reason: 'ok', truncated: false, error: null } } })
  const sRowOpen = rowsOf(sBlocksOf(patchReads, { openCommit: REV1, openDiff: VIEW.vcCommitKeyOf(REV1, '面板/新页签.js') }))[0]
  check(!!sRowOpen.diff && sRowOpen.diff.state === 'ok' && sRowOpen.diff.lines.length === 4 && sRowOpen.diff.lines[1].kind === 'hunk', 'S6 就地展开差异与未提交那一层同一个画法（同一份差异模型）')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ files: [], truncated: true, reason: 'truncated' }) })), 'changes').note === '这笔提交的改动太大，读不全就没给清单；请在命令行里看完整改动。', 'S7 读不全：明说读不全、指去终端，不装作没有改动')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ rev: REV2, files: [] }) }), { openCommit: REV2 }), 'changes').note === '这是一次合并提交：它相对第一个父提交没有改动文件。', 'S8 合并提交且清单为空：如实说「相对第一个父提交没有改动文件」（真机上 git show --numstat 对合并提交给的是真数据，所以空清单不是「git 不展开」）')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ files: [] }) })), 'changes').note === '这笔提交没有改任何文件（空提交）。', 'S9 空提交：如实说这是空提交')
  check(blockOf(sBlocksOf(sReads({ commit: commitEntry({ state: 'loading', files: [] }) })), 'changes').note === '正在读这笔提交改了什么…', 'S10 这一层也有加载中那一档')
  const sFail = blockOf(sBlocksOf(sReads({ commit: commitEntry({ state: 'err', files: [], error: { kind: 'timeout', message: '' } }) })), 'changes')
  check(sFail.note === '这笔提交改了什么读不到' && sFail.retry === '重试', 'S11 读不到就说读不到，并给重试')
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
  const stripComments = (buf) => buf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  let cjk = 0
  let linesOk = true
  for (const f of VC_FILES) {
    const src = read(f)
    const n = src.split(/\r?\n/).length
    if (n > 350) { linesOk = false; console.log('    （' + f + ' 有 ' + n + ' 行）') }
    const buf = stripComments(src)
    const strRe = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g
    let m
    while ((m = strRe.exec(buf)) !== null) { const s = m[1] !== undefined ? m[1] : m[2]; if (/[\u4e00-\u9fff]/.test(s)) cjk += 1 }
  }
  check(linesOk, 'F1 六个界面文件每个都不超过 350 行')
  check(cjk === 0, 'F2 界面文件里零个中文字面量（文案一律走词条，实得 ' + cjk + ' 处）')
  const keysUsed = new Set()
  for (const f of VC_FILES) {
    const src = stripComments(read(f))
    const re = /\bt\('([A-Za-z0-9_.]+)'/g
    let m
    while ((m = re.exec(src)) !== null) keysUsed.add(m[1])
  }
  const missingZh = [...keysUsed].filter((k) => LOC.zh[k] === undefined)
  const missingEn = [...keysUsed].filter((k) => LOC.en[k] === undefined)
  check(missingZh.length === 0 && missingEn.length === 0, 'F3 界面用到的 ' + keysUsed.size + ' 个词条键中英两边都有（缺的中文 ' + missingZh.length + ' / 缺的英文 ' + missingEn.length + '）')
  const topKeys = Object.keys(L_PANEL).join(',') + '|' + Object.keys(L_FLOW).join(',')
  check(topKeys === 'zh,en|zh,en', 'F8 两份词条模块的顶层键都只有 zh 与 en（实得 ' + topKeys + '）—— 词条插到 zh 块外面时，中文界面会把键名原样印出来')
  const missingOf = function (zh, en, keys) { return keys.filter(function (k) { return typeof zh[k] !== 'string' || zh[k] === '' || typeof en[k] !== 'string' || en[k] === '' }) }
  const usedKeys = [...keysUsed]
  const missKeys = missingOf(LOC.zh, LOC.en, usedKeys)
  check(missKeys.length === 0, 'F9 界面用到的每个词条键在中英两份真字典里都存在且非空（共 ' + usedKeys.length + ' 个，缺 ' + missKeys.length + ' 个' + (missKeys.length ? '：' + missKeys.slice(0, 6).join('、') : '') + '）')
  check(LOC.zh['panel.tabVersionControl'] === '版本管理' && LOC.en['panel.tabVersionControl'] === 'Version control', 'F10 页签名中英成对（版本管理 / Version control）')
  // 三条真机缺陷的回归（独立验收者报的，已修）
  const tailLadder = VIEW.vcFoldLadderOf({ path: 'abcdefghijklmnop', others: ['副本名'], commits: [] })
  const tailLens = []
  for (let i = 0; i <= tailLadder.steps.length; i++) { const st = VIEW.vcFoldStateAt(tailLadder, i); tailLens.push(st.path.length + ':' + st.others[0].length) }
  const tailSeq = tailLens.map((s) => s.split(':').map(Number))
  check(tailSeq[0][0] === 16 && tailSeq[tailSeq.length - 1][0] === VIEW.VC_MIDDLE_MIN && tailSeq[tailSeq.length - 1][1] === 0, 'D9 折叠到最后一档：路径停在最短可砍长度、名字收成空，都不会弹回全长（长度序列 ' + tailLens.join(' → ') + '）')
  check(VIEW.vcWhenText(tZh, NOW, null) === '' && VIEW.vcWhenText(tZh, NOW, undefined) === '', 'D10 没有时间这一项时回空串，不画成 1970 年')
  const toneKeys = Object.keys(VIEW.VC_TONE)
  const toneSrc = read('src/client/views/versionControl/VersionControlTab.js')
  const vcTone = Object.keys(VIEW.VC_TONE).filter((k) => String(VIEW.VC_TONE[k]).indexOf('var(--vc-') < 0)
  check(vcTone.length === 0 && toneSrc.indexOf('--vc-accent') >= 0, 'F4 颜色只走本页皮肤令牌（每个色档都是 var(--vc-…)，带一个兜底色；不是令牌的色档：' + (vcTone.join('、') || '无') + '）')
  const noVar = stripComments(toneSrc).replace(/var\(--vc-[a-z0-9-]+(,[^)]*)?\)/g, '')
  check(!/#[0-9a-fA-F]{3,8}\b/.test(noVar), 'F5 除皮肤令牌的兜底色之外，界面文件里没有别的硬编码颜色（注释里的票号不算）')
  // 令牌定义文件本身当然要有十六进制 —— 那是它该待的地方；这里只确认它确实按主题开关分成深浅两套。
  const vcStyleSrc = read('src/client/views/versionControl/vcStyles.js')
  const skinsOk = vcStyleSrc.indexOf('body[data-ds-dark-theme] [data-vc-root]') >= 0 && vcStyleSrc.indexOf('body:not([data-ds-dark-theme]) [data-vc-root]') >= 0
  check(skinsOk, 'F5b 皮肤令牌按宿主主题开关分成深浅两套（深色那一套在 body[data-ds-dark-theme] 下，浅色那一套在 :not 里）')
  check(vcStyleSrc.indexOf('.dsws-vc-skel') >= 0 && vcStyleSrc.indexOf('@keyframes dsws-vc-shimmer') >= 0 && vcStyleSrc.indexOf('prefers-reduced-motion') >= 0, 'F5c 骨架条有微光动画，并在减弱动态偏好下静止（动画不是装饰，是「正在来」的信号）')
  check(!/setInterval|setTimeout/.test(VC_FILES.map(read).join('\n')), 'F6 界面文件里没有任何定时器（#709 的零定时器不变量）')
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

  // ---- G3/G4：模型与画法对得上 + 首帧真渲染一次（空态不许崩、也不许冒字）----
  const compSrc = stripComments(read('src/client/views/versionControl/VersionControlTab.js'))
  const kindsMissing = VIEW.VC_BLOCK_ORDER.filter((k) => compSrc.indexOf("b.kind === '" + k + "'") < 0)
  check(kindsMissing.length === 0, 'G3 块模型会产出的每一种块，界面那一边都有画它的分支（缺的：' + (kindsMissing.join('、') || '无') + '）')
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const DswsCtx = React.createContext(null)
  const TipStub = function (props) { return props && props.children ? props.children : null }
  const IcStub = function () { return null }
  const renderView = buildView(null, [], React, DswsCtx, TipStub, IcStub)
  let html = ''
  let renderErr = ''
  try { html = renderToStaticMarkup(React.createElement(renderView.VersionControlTab, { st: { cwd: 'D:/w/repo' }, narrow: false })) } catch (e) { renderErr = String((e && e.message) || e) }
  check(renderErr === '' && html.indexOf('data-vc-root') >= 0, 'G4 首帧真渲染一次：不崩，画出带骨架的根（实得 ' + (renderErr ? '抛错：' + renderErr : html.slice(0, 60)) + '）')
  const skelBars = (html.match(/data-vc-skel="1"/g) || []).length
  check(renderErr === '' && html.indexOf('data-vc-skel-root') >= 0 && html.replace(/<[^>]*>/g, '').trim() === '' && skelBars >= 10, 'G5 面板刚打开那一下不画空白：骨架占位、一个字都没有（骨架条 ' + skelBars + ' 条，不冒常驻道歉）')
  // 真渲染第二遍：把首屏读数预先塞进组件的初始状态，看画出来的 DOM 里到底写了哪些字。
  const seedReads = { screen: { state: 'ok', data: { screen: liveScreen, tier: 'full', gitVersion: 'git version 2.49.0', readAtMs: NOW }, error: null }, diffs: {}, log: { state: 'idle', commits: [], hasMore: false, fetched: 0, error: null } }
  const renderSeeded = buildView((s) => s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, seedReads)
  let html2 = ''
  let renderErr2 = ''
  try { html2 = renderToStaticMarkup(React.createElement(renderSeeded.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { renderErr2 = String((e && e.message) || e) }
  const flat = html2.replace(/<[^>]*>/g, ' ')
  check(renderErr2 === '' && html2.indexOf('data-vc-identity') >= 0 && html2.indexOf('data-vc-changes') >= 0 && html2.indexOf('data-vc-views') >= 0 && html2.indexOf('data-vc-commits') < 0 && html2.indexOf('data-vc-other') < 0, 'G6 默认视图真渲染一次：身份行、未提交改动、视图页签在 DOM 里，提交历史与其他工作树收在页签后面（' + (renderErr2 ? '抛错：' + renderErr2 : '默认视图齐备') + '）')
  check(flat.indexOf('已暂存 1 个文件 / 未暂存 4 个文件') >= 0 && flat.indexOf('main') >= 0 && flat.indexOf('提交历史') >= 0, 'G7 画出来的 DOM 里就是那几句人话（汇总句 / 分支名 / 提交历史都在）')
  check(flat.indexOf('data-vc-') < 0 && flat.indexOf('vc.changes') < 0 && flat.indexOf('vc.fail') < 0, 'G8 DOM 里没有把词条键名当文字画出来（上一版把词条插错位置时正是这样）')
  // V 组 · 布局 C（#853 第三步）：三个视图各只画自己的块，页签带数量；点开提交自动跳历史视图。
  const liveCounts = {
    changes: (Number(liveScreen.conflictCount) || 0) + (Number(liveScreen.stagedCount) || 0) + (Number(liveScreen.unstagedCount) || 0),
    commits: Array.isArray(liveScreen.commits) ? liveScreen.commits.length : 0,
    worktrees: Array.isArray(liveScreen.otherWorktrees) ? liveScreen.otherWorktrees.length : 0,
  }
  const viewRender = function (v) {
    const rv = buildView(function (s) {
      return s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })')
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
  check(tabTextOf(vChanges.html, 'changes') === '未提交改动\uFF08' + liveCounts.changes + '\uFF09' && tabTextOf(vChanges.html, 'commits') === '提交历史\uFF08' + liveCounts.commits + '\uFF09' && tabTextOf(vChanges.html, 'worktrees').indexOf('其他工作树') === 0, 'V2 页签是既有词条加纯数字（改动' + liveCounts.changes + ' / 历史' + liveCounts.commits + ' / 工作树' + liveCounts.worktrees + '，没造新词）')
  check(vCommits.err === '' && vCommits.html.indexOf('data-vc-commits') >= 0 && vCommits.html.indexOf('data-vc-changes') < 0 && vCommits.html.indexOf('aria-selected=\"true\"') >= 0, 'V3 提交历史视图：只画历史那一块，页签高亮跟过去')
  check(vTrees.err === '' && vTrees.html.indexOf('data-vc-other') >= 0 && vTrees.html.indexOf('data-vc-terminal') >= 0 && vTrees.html.indexOf('data-vc-changes') < 0 && vTrees.html.indexOf('data-vc-commits') < 0, 'V4 工作树视图：列表与边界说明在，改动与历史不在')
  check(vChanges.html.indexOf('data-vc-identity') >= 0 && vChanges.html.indexOf('data-vc-changes') >= 0, 'V5 常驻块（身份行）不受视图切换影响')
  const vc = VIEW.vcViewCountsOf(liveScreen, { log: { commits: [{ x: 1 }, { x: 2 }] } })
  check(vc.changes === liveCounts.changes && vc.commits === liveCounts.commits + 2 && vc.worktrees === liveCounts.worktrees, 'V6 视图计数：改动按文件数、历史按已读到的提交数（含续读）、工作树按棵数')
  const routed = VIEW.vcViewBlocksOf([{ kind: 'hint' }, { kind: 'band' }, { kind: 'identity' }, { kind: 'changes' }, { kind: 'changes', commitMode: true }, { kind: 'commits' }, { kind: 'other' }, { kind: 'terminal' }])
  check(routed.always.length === 3 && routed.changes.length === 1 && routed.commits.length === 2 && routed.worktrees.length === 2, 'V7 块按视图分区：常驻 3（提示/异常带/身份），点开的提交归历史视图')
  check(VIEW.vcViewOf({}) === 'changes' && VIEW.vcViewOf({ view: 'nope' }) === 'changes' && VIEW.vcViewOf({ view: 'worktrees' }) === 'worktrees', 'V8 视图取值非法时回退到改动页（不画空白）')
  VIEW.vcRememberView('worktrees')
  const memOk = VIEW.vcRememberedView() === 'worktrees'
  VIEW.vcResetViewMemory()
  check(memOk && VIEW.vcRememberedView() === 'changes', 'V9 同一会话内记住上次选的视图，复位回到改动页')
  const viewTabSrc = read('src/client/views/versionControl/VersionControlTab.js')
  check(viewTabSrc.indexOf("view: 'changes'") >= 0 && viewTabSrc.indexOf('vcResetViewMemory()') >= 0, 'V10 换工作区复位到改动页（读数、展开、视图一起清，不把旧视图带进新仓库）')
  // AI 组 · #854：面板解决不了的事 —— 按钮在四个落点，prompt 三段式，预填不发送。
  const aiScreen = screenOf({ conflictCount: 1, stagedCount: 0, unstagedCount: 1, unstaged: [{ path: 'c.txt', origPath: null, staged: false, unstaged: true, conflict: true, change: 'modified', addedLines: 1, deletedLines: 1 }], repo: { merging: false, rebasing: true, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: 'full', autocrlm: null, autocrlf: null } })
  const aiReads = readsOf(aiScreen)
  const aiBlocks = VIEW.vcBlocksOf(aiScreen, aiReads, {}, envOf(aiScreen, aiReads))
  const aiBand = blockOf(aiBlocks, 'band')
  const aiOf = function (key) { return (aiBand && aiBand.items.filter(function (it) { return it.key === key })[0]) || {} }
  check(aiOf('conflicts').ai && aiOf('conflicts').ai.kind === 'conflict' && aiOf('rebase').ai && aiOf('rebase').ai.kind === 'midop', 'AI1 冲突带与进行中操作带上配好交出去的描述（conflict / midop）')
  const aiHandoff = VIEW.vcAiHandoffOf({ ai: { kind: 'conflict', summary: '有 1 个文件卡在冲突里，正等着你处理', detail: '这些文件里同时留着两边的内容。', tip: 'x'.repeat(400) }, t: tZh, screen: aiScreen })
  const aiBody = aiHandoff ? aiHandoff.body : ''
  check(!!aiHandoff && aiHandoff.title === '版本管理求助' && aiBody.indexOf('## 我遇到了什么') < aiBody.indexOf('## 面板已经试过什么') && aiBody.indexOf('## 面板已经试过什么') < aiBody.indexOf('## 我要补充的') && aiBody.indexOf('vc.') < 0, 'AI2 prompt 是三段式（遇到什么 / 试过什么 / 留白），标题对，没有词条键')
  check(aiBody.indexOf('repo / main') >= 0 && aiBody.indexOf('c.txt') >= 0 && aiBody.split('\n').filter(function (l) { return l === 'x'.repeat(400) }).length === 0 && aiBody.indexOf('x'.repeat(300)) >= 0, 'AI3 事实带全（工作树/分支、卡住的文件），宿主原话只留前 300 字')
  check(VIEW.vcAiHandoffOf({ ai: { kind: '', summary: 'x' }, t: tZh, screen: aiScreen }) === null && VIEW.vcAiHandoffOf({ ai: { kind: 'conflict', summary: '' }, t: tZh, screen: aiScreen }) === null, 'AI4 没种类或没正文就不交出去（回 null，不画按钮）')
  const seenOpen = []
  const opened = VIEW.vcOpenAiHandoff({ opener: function (st, body, title, opts) { seenOpen.push({ st: st, body: body, title: title, opts: opts }) }, st: { cwd: 'D:/w/repo' }, handoff: aiHandoff })
  check(opened === true && seenOpen.length === 1 && seenOpen[0].title === '版本管理求助' && seenOpen[0].body === aiBody && seenOpen[0].opts.kind === 'fix', 'AI5 点按钮按约定开新会话：同工作区 st、正文、标题、fix 档')
  check(VIEW.vcOpenAiHandoff({ opener: null, st: {}, handoff: aiHandoff }) === false && VIEW.vcOpenAiHandoff({ opener: function () { throw new Error('no') }, st: {}, handoff: aiHandoff }) === false, 'AI6b 反证： opener 缺席或抛错都回 false，不崩')
  const aiBtn = VIEW.vcAiButtonNode(React.createElement, { ai: { kind: 'conflict' }, tr: tZh, onOpen: function () {} })
  check(!!aiBtn && VIEW.vcAiButtonNode(React.createElement, { ai: null, tr: tZh, onOpen: function () {} }) === null, 'AI6 按钮节点：有描述就画、没描述就不画')
  const aiHtml = (function () { const rv = buildView(function (s) { return s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })') }, [], React, DswsCtx, TipStub, IcStub, aiReads); try { return renderToStaticMarkup(React.createElement(rv.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { return '' } })()
  const aiDoc = new (require('jsdom').JSDOM)('<div id="m">' + aiHtml + '</div>').window.document
  const aiKinds = Array.prototype.map.call(aiDoc.querySelectorAll('[data-vc-ai]'), function (el) { return el.getAttribute('data-vc-ai') }).join(',')
  check(aiKinds.indexOf('conflict') >= 0 && aiKinds.indexOf('midop') >= 0, 'AI7 真渲染：冲突、进行中两处有按钮（实得 ' + aiKinds + '）')
  const aiTreeView = buildView(function (s) { return s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })').replace("view: vcRememberedView()", "view: 'worktrees'") }, [], React, DswsCtx, TipStub, IcStub, aiReads)
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
    return s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })')
      // #842：组件的 ui 初始状态多了 write 那一格，这里改成打最短的稳定锚点（原先把整句写死，
      //   源码一改就对不上、S13/S14 会假红）。锚点必须带上 write 那一格：vcData.js 的 vcFreshOnCwd
      //   返回值里有同样一段字，而它在闭包里排在组件前面，不带 write 会打到那一份上。
      .replace("openCommit: '', view:", "openCommit: '" + REV1 + "', view:")
  }, [], React, DswsCtx, TipStub, IcStub, commitSeed)
  let html3 = ''
  let renderErr3 = ''
  try { html3 = renderToStaticMarkup(React.createElement(renderCommit.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { renderErr3 = String((e && e.message) || e) }
  const flat3 = html3.replace(/<[^>]*>/g, ' ')
  check(renderErr3 === '' && html3.indexOf('data-vc-back') >= 0 && html3.indexOf('data-vc-commit-mode') >= 0, 'S13 真渲染：提交模式画出了「回到未提交改动」那条路（' + (renderErr3 ? '抛错：' + renderErr3 : '在') + '）')
  check(flat3.indexOf('这笔提交改了什么') >= 0 && flat3.indexOf('这笔提交改了 2 个文件') >= 0 && flat3.indexOf('回到未提交改动') >= 0, 'S14 真渲染：DOM 里就是那几句人话（标题 / 计数 / 回去的路）')


  // 英文界面那一遍：同一份数据、同一套画法，只把词典换成英文 —— 画出来的人话必须是英文。
  const goodEn = tZh
  tZh = tEn
  let htmlEn = ''
  try {
    const renderEn = buildView((s) => s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, seedReads)
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
    const renderErr = buildView((s) => s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, errSeedEn)
    htmlErr = renderToStaticMarkup(React.createElement(renderErr.VersionControlTab, { st: { cwd: 'D:/w/repo' } }))
  } catch (e) { htmlErr = '' }
  tZh = goodErr
  const flatErr = htmlErr.replace(/<[^>]*>/g, ' ')
  check(htmlErr !== '' && flatErr.indexOf('git was not found') >= 0 && !/[\u4e00-\u9fff]/.test(flatErr), 'G10 英文界面 + 带中文原话的失败信封：画出来的可见文字里一个 CJK 字符都没有（宿主原话只在悬停里）')
  // G12/G13：这个会话还没有工作区（空 cwd）—— 一个电话都不发，画一句如实的空态。
  check(VIEW.vcShouldRead('') === false && VIEW.vcShouldRead('   ') === false && VIEW.vcShouldRead(null) === false && VIEW.vcShouldRead('D:/w/repo') === true, 'G12 空 cwd 的判据：读数据的谓词回假（宿主对空串会退回它自己的默认目录，那是插件自己那个仓库的数据）')
  const emptyCwdBlocks = VIEW.vcBlocksOf(null, VIEW.vcNewReads(), {}, { t: tZh, nowMs: NOW, cwdEmpty: true, fold: VIEW.vcFoldOf(460, {}) })
  check(emptyCwdBlocks.length === 1 && emptyCwdBlocks[0].text === '这个会话还没有工作区，读不到版本信息' && emptyCwdBlocks[0].retry === '', 'G13 空 cwd 画出那句如实的空态（不是读取失败，所以不给重试）')
  const cwdGuardSrc = read('src/client/views/versionControl/VersionControlTab.js')
  // #845b：G14 的判据从「字节形状」改成「行为形状」。旧写法要求 effect 的下一行恰好是四空格缩进的
  //   `if (!cwd) return` —— 真源一被格式化（换缩进、折行、中间插一行注释）就判红，而守卫其实还在。
  //   现在两问：① `cwdEmpty` 仍由 `vcShouldRead(cwd)` 取反得到（空白怎么写都行）；
  //   ② 找到**函数体里调 `vcReadStatus(` 的那个 `React.useEffect`**（就是读取那一个），花括号配对取出
  //   函数体、去掉注释与多余空白后，断言第一句可执行语句是 `if (!cwd) return` —— 空 cwd 时它先返回，
  //   一个电话都不发。把守卫删掉、或挪到调用之后，这条当场红。
  let readEffectBody = ''
  {
    const effRe = /React\.useEffect\(function \(\) \{/g
    let em
    while ((em = effRe.exec(cwdGuardSrc))) {
      const body = effectBodyAfter(cwdGuardSrc, em.index)
      if (body.indexOf('vcReadStatus(') >= 0) { readEffectBody = body; break }
    }
  }
  const readFirstStmt = readEffectBody
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1 ')
    .trim()
    .replace(/\s+/g, ' ')
  check(/const\s+cwdEmpty\s*=\s*!\s*vcShouldRead\(\s*cwd\s*\)/.test(cwdGuardSrc) && /^if\s*\(\s*!cwd\s*\)\s*return(?![A-Za-z0-9_$])/.test(readFirstStmt), 'G14 组件里那道闸：空 cwd 时读取效果第一句就返回（不发电话），空态走 cwdEmpty 那条路')
  let htmlNoCwd = ''
  let noCwdCalls = 0
  try {
    const hostStub = { call: function () { noCwdCalls += 1; return Promise.resolve({ ok: false, error: { kind: 'shape', message: '' } }) } }
    const renderNoCwd = buildView(null, [], React, DswsCtx, TipStub, IcStub, null, hostStub)
    htmlNoCwd = renderToStaticMarkup(React.createElement(renderNoCwd.VersionControlTab, { st: {} }))
  } catch (e) { htmlNoCwd = '' }
  check(htmlNoCwd.replace(/<[^>]*>/g, ' ').indexOf('这个会话还没有工作区') >= 0 && noCwdCalls === 0, 'G15 真渲染：空 cwd 时画的是那句空态，宿主一个电话都没被调到（实得 ' + noCwdCalls + ' 次）')
  check(flatEn.indexOf('Commit history') >= 0 && flatEn.indexOf('Uncommitted changes') >= 0 && flatEn.indexOf('提交历史') < 0 && flatEn.indexOf('未提交改动') < 0, 'G9 英文界面下画出来的是英文（词条中英成对，界面不写死任何一句中文）')

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
      return s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })')
        .replace('React.useState(cwd)', "React.useState('D:/w/A')")
        .replace("React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: '' } })", "React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: 'aaaa' } })")
        .replace("React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: '' } })", "React.useState(function () { return { fileShown: {}, openDiff: '', openCommit: 'aaaa' } })")
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
  check(dualRows[0].rowTip.indexOf('这一行是已暂存的那部分') >= 0 && dualRows[1].rowTip.indexOf('这一行是还没暂存的那部分') >= 0, 'N8 两行各自说清是哪一部分（用户分得清「准备好要提交的」与「还没暂存的」）')
  const dualDiffReads = readsOf(dual, { diffs: { 'src/app.js': { state: 'ok', lines: shortLines, reason: 'ok', truncated: false, error: null } } })
  const dualDiffRow = rowsOf(VIEW.vcBlocksOf(dual, dualDiffReads, { openDiff: 'staged\u0000src/app.js' }, envOf(dual, dualDiffReads)))[0]
  check(dualDiffRow.diff.scopeText === '这一处看的是相对上一次提交的全部改动（已暂存与未暂存两部分都在里面）。', 'N9 差异面板写清范围：不让用户把「已暂存」组里点开的差异当成「将要提交的那部分」')
  const commitDiffRow = rowsOf(VIEW.vcBlocksOf(commitScreen, patchReads, { openCommit: REV1, openDiff: VIEW.vcCommitKeyOf(REV1, '面板/新页签.js') }, envOf(commitScreen, patchReads)))[0]
  check(commitDiffRow.diff.scopeText === '', 'N10 提交那一层的差异不带这句范围说明（它的范围就是那笔提交，抬头已经写明）')

  // N11 竞态：晚到的旧回包不许把界面钉在旧的那一笔上。
  const loadingB = Object.assign({}, readsA, { commit: { rev: 'bbbb', seq: 2, state: 'loading', files: [], truncated: false, reason: '', error: null } })
  const lateA = Object.assign({}, readsA, { commit: { rev: 'aaaa', seq: 1, state: 'ok', files: commitFiles, truncated: false, reason: 'ok', error: null } })
  check(V2.vcApplyCommitReply(loadingB, lateA) === loadingB, 'N11 晚到的旧回包（代际号更小）被丢掉，界面不会永久停在「正在读」')
  const newerB = Object.assign({}, readsA, { commit: { rev: 'bbbb', seq: 2, state: 'ok', files: commitFiles, truncated: false, reason: 'ok', error: null } })
  check(V2.vcApplyCommitReply(loadingB, newerB) === newerB, 'N12 新回包照常落库（判据不是恒假）')

  // N13 读数时刻 + 重新读一次的入口。
  check(blockOf(liveBlocks, 'identity').readAtText === '读到于 刚刚', 'N13 身份行写着这份读数是什么时候取的（实得「' + blockOf(liveBlocks, 'identity').readAtText + '」）')
  const noReadAt = readsOf(liveScreen, { screen: { state: 'ok', data: { screen: liveScreen, tier: 'full', gitVersion: 'g', readAtMs: 0 }, error: null } })
  check(blockOf(VIEW.vcBlocksOf(liveScreen, noReadAt, {}, envOf(liveScreen, noReadAt)), 'identity').readAtText === '', 'N14 读数时刻读不到就不写那几个字（不画成 1970）')
  check(compSrc.indexOf('data-vc-reload') >= 0 && compSrc.indexOf('reloadNow') >= 0, 'N15 界面上有「重新读一次」这颗按钮（不是定时器）')

  // N16 极端宽度：台阶总数有上限，且窄到第三档以下直接跳到收尾档。
  const hugeLadder = VIEW.vcFoldLadderOf({ path: 'p'.repeat(300), others: [], commits: new Array(200).fill('s'.repeat(20)) })
  check(hugeLadder.steps.length === VIEW.VC_FOLD_STEP_CAP && VIEW.VC_FOLD_STEP_CAP <= 200, 'N16 台阶总数有上限（三百字符路径 + 两百条说明也只有 ' + hugeLadder.steps.length + ' 档，不再上千档）')
  check(compSrc.indexOf('width < VC_FOLD_BANDS[2]') >= 0, 'N17 窄到第三档以下时折叠机直接跳到收尾档（不再一格一格试，允许溢出）')

  // N18「需要自己动手的事」是一句陈述：不摆点不动的图标，也不许再指向侧栏终端。
  check(compSrc.indexOf("Ic({ n: 'external-link'") < 0 && compSrc.indexOf('data-vc-terminal') >= 0, 'N18 「需要自己动手的事」不摆外链图标（看着能点却点不动比不画更差）')
  const noSidebar = /侧栏终端/.test(LOC.zh) === false && /terminal on the same row/.test(LOC.en) === false
  check(noSidebar, 'N18b 中英词条里都不许再出现「侧栏终端 / terminal on the same row」（中文命中：' + /侧栏终端/.test(LOC.zh) + '，英文命中：' + /terminal on the same row/.test(LOC.en) + '）')

  // N19 续读防重入 + 「正在读更早的提交」这一刻真的进读数。
  check(compSrc.indexOf('logBusyRef') >= 0 && compSrc.indexOf('vcMarkLogLoading') >= 0, 'N19 续读有自己的在途守卫，并先把 loading 写进读数')
  check(V2.vcMarkLogLoading(V2.vcNewReads()).log.state === 'loading', 'N20 vcMarkLogLoading 把「正在读更早的提交」这一刻写进读数（那一句提示才有机会出现）')

  // N21 依据时间给 0 或负数：按读不到说，不画成 1970。
  check(VIEW.vcBasisText(tZh, NOW, 0) === '远端信息什么时候更新的读不到' && VIEW.vcBasisText(tZh, NOW, -1) === '远端信息什么时候更新的读不到' && VIEW.vcWhenText(tZh, NOW, 0) === '', 'N21 依据时间 / 时刻给 0 或负数一律按读不到说（不画成 1970）')

  // N22 五值以外的同步状态：如实说不认识，不猜成「领先 0」。
  const weirdSync = screenOf({ identity: { sync: 'weird-value' } })
  const weirdId = blockOf(VIEW.vcBlocksOf(weirdSync, readsOf(weirdSync), {}, envOf(weirdSync, readsOf(weirdSync))), 'identity')
  check(weirdId.sync.text === '同步状态读到了界面还不认识的一档，所以不猜领先落后；请在命令行里看。' && weirdId.sync.text.indexOf('领先 0') < 0 && weirdId.sync.text.indexOf('落后 0') < 0, 'N22 五值以外的同步状态：如实说不认识，不猜成「领先 0 / 落后 0」（实得「' + weirdId.sync.text + '」）')
  const missingSync = screenOf({ identity: { sync: undefined } })
  check(blockOf(VIEW.vcBlocksOf(missingSync, readsOf(missingSync), {}, envOf(missingSync, readsOf(missingSync))), 'identity').sync.text === '还没有推送目标', 'N23 字段缺失时仍按「还没设推送目标」说（缺省值不变）')

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
  check(degradedRows[0].stateText === '无法显示' && degradedRows[0].stateTip === '这个 git 版本答不出这个工作树的目录还在不在；答不出不等于还在。', 'N25b 降级档答不出「可清理」：画「无法显示」并说清是 git 答不出（不是留白、也不是「目录还在」）')
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
  check(coreRow.stateText === '无法显示' && coreRow.stateTip === '这个 git 版本答不出这个工作树的目录还在不在；答不出不等于还在。', 'N25f 真核心喂进界面：降级档那条画的就是「无法显示」（端到端，实得「' + coreRow.stateText + '」）')

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
  check(manyNarrow.summaryText.indexOf('（还有 5 棵没列出来）') >= 0 && (manyNarrow.tip.match(/D:\/w\/w/g) || []).length === VIEW.VC_OTHER_SUMMARY_NAMES, 'M3 摘要最多列 ' + VIEW.VC_OTHER_SUMMARY_NAMES + ' 个名字、其余明说「还有 N 棵没列出来」，悬停只给列出来的那些（实得 ' + (manyNarrow.tip.match(/D:\/w\/w/g) || []).length + ' 条路径）')
  check(compSrc.indexOf("tipNode(b.tip, h('div', { 'data-vc-other-summary': 1") >= 0, 'M4 组件里摘要那一行确实挂在悬停上（不是只把字段算出来没人用）')
  // M5 「另一个 git 在操作」的兜底话术要说清「等它结束」（中英都要有这层意思）。
  const exitZh = LOC.zh['vc.fail.exit'] || ''
  const exitEn = LOC.en['vc.fail.exit'] || ''
  check(/等它结束/.test(exitZh) && /别的程序/.test(exitZh) && /权限/.test(exitZh), 'M5 中文兜底话术含「等它结束」并说清是别的程序占着或权限不够（实得「' + exitZh + '」）')
  check(/wait for it to finish/i.test(exitEn), 'M6 英文兜底话术同样有「等它结束」的意思（实得「' + exitEn + '」）')
  check(VIEW.vcFailKeyOf('exit') === 'vc.fail.exit', 'M7 非零退出仍然映射到这条话术（接法没变）')

  // ---- H 组：反证（把被守的东西改坏，同一套断言必须当场变红）----
  const antiCases = [
    { name: '显隐谓词改成永远隐藏', patch: (s) => s.replace('const vcTabVisible = function (st) {\n  void st\n  return true\n}', 'const vcTabVisible = function (st) {\n  void st\n  return false\n}'), test: tabVisibleJudgmentOf, what: 'A1' },
    { name: '冲突条目不再合成一行（同一路径画两行）', patch: (s) => s.replace('      if (conflictSeen[path]) return', '      if (false) return'), test: (v) => { const m = v.vcBlocksOf(merge, readsOf(merge), {}, envOf(merge, readsOf(merge))); return rowsOf(m).length === 1 }, what: 'C9' },
    { name: '汇总句把数字写死成 0', patch: (s) => s.replace("staged: String(hostStaged), unstaged: String(hostUnstaged), conflicts: String(conflicts)", "staged: '0', unstaged: '0', conflicts: String(conflicts)").replace("{ staged: String(hostStaged), unstaged: String(hostUnstaged) }", "{ staged: '0', unstaged: '0' }"), test: (v) => { const c = v.vcBlocksOf(liveScreen, liveReads, {}, envOf(liveScreen, liveReads)); return blockOf(c, 'changes').summary === '已暂存 1 个文件 / 未暂存 4 个文件' }, what: 'B7' },
    { name: '折叠一次让一整段字（不再一个字符）', patch: (s) => s.replace("push('path', -1, Math.max(0, len(ladder.path) - VC_MIDDLE_MIN))", "push('path', -1, 1)"), test: (v) => { const l = v.vcFoldLadderOf({ path: 'abcdefghijklmnop', others: [], commits: [] }); return l.steps.length >= 6 }, what: 'D2' },
    { name: '「回到未提交改动」那一步去掉', patch: (s) => s.replace("    back: t('vc.commit.back'),", "    back: '',"), test: (v) => { const b = v.vcBlocksOf(commitScreen, sReads(), { openCommit: REV1 }, envOf(commitScreen, sReads())); return blockOf(b, 'changes').back === '回到未提交改动' }, what: 'S1' },
    { name: '截断判据改坏（读不全也装作有清单）', patch: (s) => s.replace("  else if (mine.truncated === true) note = t('vc.commit.truncated')", "  else if (false) note = t('vc.commit.truncated')"), test: (v) => { const r2 = sReads({ commit: commitEntry({ files: [], truncated: true, reason: 'truncated' }) }); const b = v.vcBlocksOf(commitScreen, r2, { openCommit: REV1 }, envOf(commitScreen, r2)); return blockOf(b, 'changes').note === '这笔提交的改动太大，读不全就没给清单；请在命令行里看完整改动。' }, what: 'S7' },
    { name: '合并提交那条差异原因键删掉（落回「没读到改动内容」）', patch: (s) => s.replace("  'merge-commit': 'vc.diff.mergeCommit',", "  'merge-commit-removed': 'vc.diff.mergeCommit',"), test: (v) => { const r2 = readsOf(files, { diffs: { '改.txt': { state: 'ok', lines: [], reason: 'merge-commit', truncated: false, error: null } } }); const row = rowsOf(v.vcBlocksOf(files, r2, { openDiff: 'unstaged\u0000改.txt' }, envOf(files, r2)))[0]; return row.diff.text === '这是一次合并提交：git 默认不展开合并提交的逐行差异，所以这里没有内容。' }, what: 'C19b' },
    { name: '宿主原话又直出到可见正文（英文界面串出中文）', en: true, seed: errSeedEn, patch: (s) => s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })').replace("        rawTip: err.message ? t('vc.fail.raw', { msg: String(err.message) }) : '',", "        detail: err.message ? t('vc.fail.raw', { msg: String(err.message) }) : '',").replace("      h('span', { key: 'text', style: { display: 'contents' } }, tipNode(b.rawTip, h('div', { style: { lineHeight: 1.7 } }, b.text))),", "      h('div', { style: { lineHeight: 1.7 } }, b.text),\n      b.detail ? h('div', { style: { marginTop: 6 } }, b.detail) : null,"), test: (v) => { let html = ''; try { html = renderToStaticMarkup(React.createElement(v.VersionControlTab, { st: { cwd: 'D:/w/repo' } })) } catch (e) { html = '' } return !/[\u4e00-\u9fff]/.test(html.replace(/<[^>]*>/g, ' ')) }, what: 'G10' },
    { name: '换工作区不复位（旧工作区的数据继续画）', patch: (s) => s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })').replace('  const staleCwd = fresh.changed', '  const staleCwd = false'), test: (v) => { let html = ''; try { html = renderToStaticMarkup(React.createElement(v.VersionControlTab, { st: { cwd: 'D:/w/B' } })) } catch (e) { html = '' } return html.indexOf('data-vc-identity') < 0 && html.indexOf('data-vc-commit-mode') < 0 }, what: 'N3', seed: staleSeed },
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
  ]
  // #845c：反证自证提到循环里 —— 每一处改法先确认它真的落到了源码上（改不中等于没证）。
  //   旧写法只在循环外用一条聚合自检兜底，于是某一条改法失效时，它自己仍会以 broke=true 假绿
  //   （把 vcTabVisible 的 return true 改成别的写法、或谓词已经在源码里被改坏，补丁就找不到落点），
  //   而它声称覆盖的那条断言（A1）此时已经不再受它保护。
  const closureSrc = VC_FILES.map((f2) => stripExports(read(f2))).join('\n')
  for (const c of antiCases) {
    let broke = false
    let applied = true
    const keepT = tZh
    if (c.en === true) tZh = tEn
    try {
      const v = buildView(c.patch, [], React, DswsCtx, TipStub, IcStub, c.seed || null, c.hostStub)
      applied = c.patch(closureSrc) !== closureSrc
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
    const brokenRender = buildView((s) => s.replace('React.useState(vcNewReads)', 'React.useState(function () { return seedReads })'), [], React, DswsCtx, TipStub, IcStub, seedReads)
    brokenHtml = renderToStaticMarkup(React.createElement(brokenRender.VersionControlTab, { st: { cwd: 'D:/w/repo' } }))
  } catch (e) { brokenHtml = '' }
  tZh = goodT
  check(brokenHtml.replace(/<[^>]*>/g, ' ').indexOf('vc.changes') >= 0, 'H 反证：词典查不到就回键名时，DOM 里当场出现键名（上一版的中文界面就是这个样子，G8 抓得住）')
  // 反证本身也要自证：改坏的源码必须真的与原文不同（改不中就等于没证）—— 循环里已经逐条确认过一次，
  //   这里再把整张表聚合报一遍，哪几条没改中一眼看全。
  const untouched = antiCases.filter((c) => c.patch(closureSrc) === closureSrc)
  check(untouched.length === 0, 'H 反证自证：' + antiCases.length + ' 处改法都真的改到了源码（改不中就等于没证）' + (untouched.length ? ' —— 没改中的：' + untouched.map((c) => c.name).join('、') : ''))

  console.log(failed ? '\n存在失败 — verify-818-version-control-view 未通过' : '\n全部通过 — 版本管理页签界面侧门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}
main().catch(function (e) { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
