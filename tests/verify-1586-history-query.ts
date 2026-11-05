// 门禁归属: src/shared/version-control/src/history-query-commands.ts
// 门禁归属: src/shared/version-control/src/parse-history-query.ts
// 门禁归属: src/host/versionControlHistory.ts
// 门禁归属: src/host/versionControl.ts
// 门禁归属: src/client/views/versionControl/vcQuery.ts
// 门禁归属: src/client/views/versionControl/vcQueryView.ts
// 门禁归属: src/client/views/versionControl/vcShellPages.ts
// 历史高级查询与追溯（#1745 T10，规格 #1586 能力 3.4–3.13）的参数口径与回包解析门禁。
// 这里只查「拼出来的 argv 是不是那一条」与「真 git 输出能不能读成对的结构」；
// 界面与宿主接线在同一个门禁的后半段（同一份文件，按 A/B/C/D/E 五段）。
//
// 真样本来源：tests/fixtures/version-control/live-history-query-shapes.json，
// 由本机 git 2.49.0.windows.1 在临时样本仓库上采样（采样脚本与命令见该文件 source 字段）。
// 每条解析断言都用真输出，不用手写示例；坏形状另用最小反例。
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-history-query'
let total = 0
let failed = 0
function check(ok, msg) {
  total += 1
  if (!ok) {
    failed += 1
    console.log('  FAIL ' + msg)
  }
}
function textOf(v) { return v === null || v === undefined ? '' : String(v) }
function hasSeq(list, seq) {
  for (let i = 0; i + seq.length <= list.length; i += 1) {
    let hit = true
    for (let j = 0; j < seq.length; j += 1) if (list[i + j] !== seq[j]) { hit = false; break }
    if (hit) return true
  }
  return false
}
// ---------- 假 subprocess 适配器：形状照 DSH subprocess 服务（同 verify-818 与 verify-1586-first-screen） ----------
const QFX_REL = 'tests/fixtures/version-control/live-history-query-shapes.json'
const QFX = JSON.parse(fs.readFileSync(path.join(ROOT, QFX_REL), 'utf8'))
/** 宿主的固定前缀之后才是这条 git 命令本身；路由按这一段判命令。 */
function qAfterPrefix(argv) {
  const at = argv.indexOf('i18n.logOutputEncoding=UTF-8')
  return at < 0 ? null : argv.slice(at + 1)
}
/** 把一条 git 命令认回十条查询里的哪一种（route 与门禁都用这一份，不各认各的）。 */
function qKindOfArgv(a) {
  if (!a || a.length === 0) return ''
  if (a[0] === 'log') {
    if (a.indexOf('--follow') >= 0) return 'file-history'
    if (a.some(function (x) { return x === '--grep' || x.indexOf('--grep=') === 0 })) return 'grep'
    if (a.some(function (x) { return x.indexOf('-S') === 0 || x.indexOf('-G') === 0 })) return 'pickaxe'
    return 'file-history'
  }
  if (a[0] === 'blame') return 'blame'
  if (a[0] === 'diff') return 'compare'
  if (a[0] === 'range-diff') return 'range-diff'
  if (a[0] === 'describe') return 'describe'
  if (a[0] === 'reflog') return 'reflog'
  if (a[0] === 'notes') return 'notes'
  if (a[0] === 'show') return 'show-file'
  return ''
}
// 每条查询默认回哪一份真样本；个别用例要换样本时用 opts.fixture 覆盖。
const Q_DEFAULT_FIXTURE = {
  'file-history': 'fileHistory', blame: 'blame', grep: 'grep', pickaxe: 'pickaxeS',
  compare: 'diffTwoDot', 'range-diff': 'rangeDiff', describe: 'describeTagged',
  reflog: 'reflogIso', notes: 'notesHas', 'show-file': 'showFile',
}
/** 路线：第 0 步与仓库根按真值回，十条命令各回对应的真样本；opts 可逐路改坏。 */
function makeQueryRoute(opts) {
  const o = opts || {}
  const seen = []
  function route(argv) {
    seen.push(argv.slice())
    const a = qAfterPrefix(argv)
    if (a === null) return { code: 1, stderr: '缺少固定前缀' }
    if (a[0] === 'rev-parse' && a.indexOf('--absolute-git-dir') >= 0) {
      if (o.noRepo) return { code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' }
      return { code: 0, stdout: 'D:/假工作区/repo/.git\ntrue\nfalse\n' }
    }
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: 'D:/假工作区/repo\n' }
    const kind = qKindOfArgv(a)
    const over = o.over && o.over[kind]
    if (over) return over
    const rec = QFX[(o.fixture && o.fixture[kind]) || Q_DEFAULT_FIXTURE[kind]]
    if (!rec) return { code: 0, stdout: '' }
    const out = { code: rec.code === undefined ? 0 : rec.code, stdout: rec.out || '', stderr: rec.err || '' }
    if (o.truncated && o.truncated[kind]) out.truncated = true
    return out
  }
  return { route: route, seen: seen }
}
function makeQueryCollector(text, truncated) {
  return { finalize() { return { text: String(text), truncated: truncated === true } } }
}
function makeQueryHostDeps(route, opts) {
  const o = opts || {}
  const logs = []
  const deps = {
    subprocess: {
      spawn(req) {
        const hit = route(req.argv) || { code: 0, stdout: '' }
        return {
          done: Promise.resolve({ exitCode: hit.code === undefined ? 0 : hit.code, signal: hit.signal }),
          collected: { stdout: makeQueryCollector(hit.stdout || '', hit.truncated), stderr: makeQueryCollector(hit.stderr || '', false) },
          terminate() {},
        }
      },
    },
    timer: { timeout() { return new Promise(function (resolve) { setTimeout(resolve, 1) }) } },
    fs: {
      stat() { return Promise.reject(Object.assign(new Error('没有这个文件'), { code: 'ENOENT' })) },
      lstat() { return Promise.resolve(null) },
      exists() { return Promise.resolve(false) },
    },
    getPlatform: async function () {
      return { resolveExecutable: async function (name) { return name === 'git' ? (o.gitExe === null ? null : 'git') : null } }
    },
    DEFAULT_CWD: 'D:/假工作区/repo',
    TIMEOUT_MS: 30000,
    gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level: level, event: event, fields: fields }) } },
  }
  return { deps: deps, logs: logs }
}

// ---------- 客户端闭包：能力账本 + 页面注册表 + 读数层 + 查询数据层 ----------
// 与 scripts/build.mts 同一个拼装次序、同一份转译参数；源码树里没有构建产物之外的副本。
const Q_STRIP_EXPORTS = function (s) { return s.replace(/^(\s*)export\s+/gm, '$1') }
const Q_CLIENT_FILES = [
  '.build/shared/version-control/capability-ledger.js',
  'src/client/views/versionControl/vcCapabilityPages.ts',
  'src/client/views/versionControl/vcData.ts',
  'src/client/views/versionControl/vcQuery.ts',
]
const Q_CLIENT_EXPORTS = [
  'VC_QUERY_PHONE', 'VC_QUERY_COUNT_MAX', 'VC_QUERY_BLAME_SPAN_MAX', 'VC_QUERY_COMPARE_MAX', 'VC_QUERY_RANGE_MAX',
  'vcQueryCatalogOf', 'vcQueryEntriesOf', 'vcQueryEntryOf', 'vcQueryDefaultsOf', 'vcQueryInputsOf', 'vcQueryInputValueOf',
  'vcNewQueries', 'vcQueryStateOf', 'vcMarkQueryLoading', 'vcApplyQueryReply', 'vcQueryParamsOf', 'vcQueryShapeOk',
  'vcReadHistoryQuery', 'vcQueryEmptyOf', 'vcQueryTruncatedOf', 'vcQueryShownOf', 'vcFailureOf', 'vcShouldRead',
]
function queryClientSourceOf(patch) {
  let src = Q_CLIENT_FILES.map(function (rel) { return Q_STRIP_EXPORTS(fs.readFileSync(path.join(ROOT, rel), 'utf8')) }).join('\n')
  if (patch) src = patch(src)
  return src
}
function buildQueryClient(patch) {
  const js = require('esbuild').transformSync(queryClientSourceOf(patch), require('../scripts/lib/transpile-unit.mts').TRANSPILE_OPTIONS).code
  const body = js + '\nreturn { ' + Q_CLIENT_EXPORTS.join(', ') + ' }\n'
  const fn = require('./lib/eval-probe.ts').compileFn(['log', 'dswsLogHash', 'dswsLogTrunc'], body)
  return fn(function () {}, function () { return 'h8' }, function (s) { return String(s) })
}


async function main() {
  const base = pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src') + path.sep).href
  const CR = await import(base + 'history-query-commands.ts')
  const PR = await import(base + 'parse-history-query.ts')
  const PL = await import(base + 'parse-log.ts')
  const PD = await import(base + 'parse-diff-files.ts')
  const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'version-control', 'live-history-query-shapes.json')
  const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

  // ---------- A. 十条查询的 argv 口径 ----------
  const kinds = CR.HISTORY_QUERY_KINDS
  check(Array.isArray(kinds) && kinds.length === 10, '十条查询的标识符齐了（实际 ' + (Array.isArray(kinds) ? kinds.length : '不是数组') + ' 条）')
  const recognised = kinds.filter(function (k) {
    const r = CR.historyQueryCommandFor(k, k === 'describe' ? {} : { path: 'x', pattern: 'x', text: 'x', left: 'a', right: 'b', base: 'a', lineStart: 1, lineEnd: 2, rev: 'HEAD', ref: 'HEAD' })
    return r && r.ok === true && r.kind === k && Array.isArray(r.args) && r.args.length > 1
  })
  check(recognised.length === 10, '十条查询不分参数都能拼出命令（实际认了 ' + recognised.length + ' 条）')

  const fh = CR.historyQueryCommandFor('file-history', { path: '文件 一.txt' })
  check(fh.ok === true && fh.subcommand === 'log', '3.4 单文件历史走 log 子命令')
  check(fh.ok === true && fh.args.indexOf('--follow') >= 0, '3.4 单文件历史带 --follow（重命名前后都算这条路径）')
  check(fh.ok === true && hasSeq(fh.args, ['--', '文件 一.txt']), '3.4 单文件历史把路径放在 -- 之后')
  check(fh.ok === true && hasSeq(fh.args, ['-n', '50']), '3.4 单文件历史默认取 50 条')
  const fhMax = CR.historyQueryCommandFor('file-history', { path: 'a', count: 9999 })
  check(fhMax.ok === true && hasSeq(fhMax.args, ['-n', '200']), '3.4 条数上限归一成 200，不在界面上悄悄变少')

  const bl = CR.historyQueryCommandFor('blame', { path: '文件 一.txt', lineStart: 1, lineEnd: 3 })
  check(bl.ok === true && bl.subcommand === 'blame', '3.5 行级追溯走 blame 子命令')
  check(bl.ok === true && bl.args.indexOf('--line-porcelain') >= 0, '3.5 用 --line-porcelain 取每行的作者与摘要')
  check(bl.ok === true && hasSeq(bl.args, ['-L', '1,3']), '3.5 行号范围拼成 -L 起,止')
  check(bl.ok === true && !hasSeq(bl.args, ['HEAD']), '3.5 不给提交号时先补 -- 再给路径（读工作区当前内容）')
  check(bl.ok === true && hasSeq(bl.args, ['--', '文件 一.txt']), '3.5 路径放在 -- 之后')
  const blRev = CR.historyQueryCommandFor('blame', { path: 'a.txt', lineStart: 2, lineEnd: 2, rev: 'HEAD~1' })
  check(blRev.ok === true && hasSeq(blRev.args, ['2,2', 'HEAD~1', '--', 'a.txt']), '3.5 给了提交号就按那个版本追溯')
  check(CR.historyQueryCommandFor('blame', { path: 'a', lineStart: 3, lineEnd: 1 }).error === 'invalid-input', '3.5 结束行小于起始行被拒')
  check(CR.historyQueryCommandFor('blame', { path: 'a', lineStart: 1, lineEnd: 501 }).error === 'invalid-input', '3.5 一次超过 500 行被拒（显式拒绝，不悄悄截断）')
  check(CR.historyQueryCommandFor('blame', { path: 'a', lineStart: 0, lineEnd: 1 }).error === 'invalid-input', '3.5 行号从 1 起算')

  const gr = CR.historyQueryCommandFor('grep', { pattern: 'MAGIC_TOKEN' })
  check(gr.ok === true && hasSeq(gr.args, ['-i', '--grep=MAGIC_TOKEN']), '3.6 按说明搜提交带 -i 与 --grep=')
  check(CR.historyQueryCommandFor('grep', {}).error === 'invalid-input', '3.6 搜索词为空被拒')
  check(CR.historyQueryCommandFor('grep', { pattern: 'a'.repeat(201) }).error === 'invalid-input', '3.6 搜索词超过 200 字被拒')
  check(CR.historyQueryCommandFor('grep', { pattern: 'a\nb' }).error === 'invalid-input', '3.6 搜索词里有换行被拒')

  const pkS = CR.historyQueryCommandFor('pickaxe', { text: 'MAGIC_TOKEN' })
  check(pkS.ok === true && hasSeq(pkS.args, ['-SMAGIC_TOKEN']), '3.7 按代码变化搜提交默认用 -S（增删过这段文本）')
  const pkG = CR.historyQueryCommandFor('pickaxe', { text: 'MAGIC_TOKEN', mode: 'change' })
  check(pkG.ok === true && hasSeq(pkG.args, ['-GMAGIC_TOKEN']), '3.7 选「补丁里出现过」时用 -G')
  check(CR.historyQueryCommandFor('pickaxe', { text: '' }).error === 'invalid-input', '3.7 搜索文本为空被拒')

  const cmp2 = CR.historyQueryCommandFor('compare', { left: 'HEAD~1', right: 'HEAD' })
  check(cmp2.ok === true && hasSeq(cmp2.args, ['HEAD~1..HEAD']), '3.8 比较两个引用默认拼两点区间')
  const cmp3 = CR.historyQueryCommandFor('compare', { left: 'main', right: 'feat', mode: 'three-dot' })
  check(cmp3.ok === true && hasSeq(cmp3.args, ['main...feat']), '3.8 选「共同祖先起算」时拼三点区间')
  check(cmp2.ok === true && cmp2.subcommand === 'diff' && hasSeq(cmp2.args, ['--numstat', '-z']), '3.8 比较回包按 numstat 的机器可读口径取')
  check(CR.historyQueryCommandFor('compare', { left: '-x', right: 'main' }).error === 'invalid-input', '3.8 引用以 - 开头被拒（会被当成选项）')
  check(CR.historyQueryCommandFor('compare', { left: 'a..b', right: 'main' }).error === 'invalid-input', '3.8 引用里自己写区间被拒（区间由面板拼）')
  check(CR.historyQueryCommandFor('compare', { left: 'a:b', right: 'main' }).error === 'invalid-input', '3.8 引用里有冒号被拒')

  const rd = CR.historyQueryCommandFor('range-diff', { base: 'main', left: 'main', right: 'feat-new' })
  check(rd.ok === true && rd.subcommand === 'range-diff', '3.9 两组提交对照走 range-diff 子命令')
  check(rd.ok === true && hasSeq(rd.args, ['main..main', 'main..feat-new']), '3.9 两组都按同一基线拼区间')
  check(CR.historyQueryCommandFor('range-diff', { left: 'a', right: 'b' }).error === 'invalid-input', '3.9 缺基线被拒')

  const ds = CR.historyQueryCommandFor('describe', {})
  check(ds.ok === true && ds.args.join(' ') === 'describe --tags --dirty --always', '3.10 版本名带 --tags --dirty --always（实际 ' + (ds.ok ? ds.args.join(' ') : '拼装失败') + '）')
  const dsRev = CR.historyQueryCommandFor('describe', { rev: 'abc' })
  check(dsRev.ok === true && dsRev.args.join(' ') === 'describe --tags --dirty --always', '3.10 版本名不接提交号（--dirty 与提交号互斥）')

  const rl = CR.historyQueryCommandFor('reflog', { count: 3 })
  check(rl.ok === true && hasSeq(rl.args, ['reflog', 'show', '--date=iso-strict']), '3.11 引用日志走 reflog show 并带可读时间')
  check(rl.ok === true && hasSeq(rl.args, ['-n', '3']), '3.11 引用日志按条数取')
  const rlRef = CR.historyQueryCommandFor('reflog', { ref: 'main' })
  check(rlRef.ok === true && rlRef.args[rlRef.args.length - 1] === 'main', '3.11 给了引用就只看那个引用的日志')
  check(rl.ok === true && rl.args[rl.args.length - 1] !== 'main', '3.11 没给引用时不追加引用')
  check(CR.historyQueryCommandFor('reflog', { ref: 'bad ref' }).error === 'invalid-input', '3.11 引用里有空白被拒')
  check(CR.historyQueryCommandFor('reflog', { count: 9999 }).args.join(' ').indexOf('-n 200') >= 0, '3.11 条数上限归一成 200')

  const nt = CR.historyQueryCommandFor('notes', {})
  check(nt.ok === true && hasSeq(nt.args, ['notes', 'show', 'HEAD']), '3.12 提交备注缺省读 HEAD')
  const ntRev = CR.historyQueryCommandFor('notes', { rev: 'v1.0.0' })
  check(ntRev.ok === true && ntRev.args.join(' ') === 'notes show v1.0.0', '3.12 提交备注可以指定版本')
  check(CR.historyQueryCommandFor('notes', { rev: 'a..b' }).error === 'invalid-input', '3.12 提交备注的版本里不许写区间')

  const sf = CR.historyQueryCommandFor('show-file', { rev: 'v1.0.0', path: '文件 一.txt' })
  check(sf.ok === true && hasSeq(sf.args, ['v1.0.0:文件 一.txt']), '3.13 取某版本的文件内容拼成 版本:路径')
  check(CR.historyQueryCommandFor('show-file', { rev: 'HEAD', path: 'a:b' }).error === 'invalid-input', '3.13 路径里有冒号被拒（拼接会歧义）')
  check(CR.historyQueryCommandFor('show-file', { rev: 'HEAD', path: '' }).error === 'invalid-input', '3.13 路径为空被拒')
  check(CR.historyQueryCommandFor('show-file', { rev: 'a..b', path: 'x' }).error === 'invalid-input', '3.13 版本里不许写区间')

  check(CR.historyQueryCommandFor('nope', {}).error === 'unknown-kind', '不认识的第 11 种查询被拒（不猜）')
  check(CR.historyQueryCommandFor(null, {}).error === 'unknown-kind', '查询标识符为空被拒')

  // ---------- B. 真样本解析 ----------
  check(fx.source && fx.source.live === true, '夹具是真机采样（source.live）')
  check(textOf(fx.source && fx.source.gitVersion).indexOf('git version 2.') === 0, '夹具记录了本机 git 版本（实际 ' + textOf(fx.source && fx.source.gitVersion) + '）')
  const needKeys = ['fileHistory', 'fileHistoryMissingPath', 'blame', 'blameBadRange', 'grep', 'grepEmpty', 'grepBadRegex', 'pickaxeS', 'pickaxeG', 'diffTwoDot', 'diffThreeDot', 'diffSame', 'rangeDiff', 'rangeDiffSame', 'rangeDiffBad', 'describeTagged', 'describeUntagged', 'describeDirty', 'reflog', 'reflogIso', 'reflogRef', 'reflogBadRef', 'notesHas', 'notesNone', 'notesHeadNone', 'notesList', 'showFile', 'showFileChinese', 'showFileMissing', 'showFileBinary']
  const missKeys = needKeys.filter(function (k) { return !fx[k] || typeof fx[k].out !== 'string' })
  check(missKeys.length === 0, '夹具的样本齐了（缺：' + missKeys.join('、') + '）')

  const fhLog = PL.parseLog(fx.fileHistory.out)
  check(fhLog.ok === true && fhLog.commits.length === 2, '3.4 真样本读成两条提交（实际 ' + (fhLog.ok ? fhLog.commits.length : '解析失败') + '）')
  check(fhLog.ok === true && fhLog.commits[0].subject.indexOf('重命名') >= 0, '3.4 重命名那次提交留在单文件历史里（证明 --follow 生效）')
  check(fhLog.ok === true && fhLog.commits[1].parents.length === 0, '3.4 最初的提交没有父提交')
  const fhEmpty = PL.parseLog(fx.fileHistoryMissingPath.out)
  check(fhEmpty.ok === true && fhEmpty.commits.length === 0, '3.4 不存在的路径读成空历史，不报错也不猜')

  const bls = PR.parseBlame(fx.blame.out)
  check(bls.ok === true && bls.lines.length === 3, '3.5 真样本读成三行（实际 ' + (bls.ok ? bls.lines.length : '解析失败：' + bls.detail) + '）')
  if (bls.ok) {
    const l1 = bls.lines[0]
    check(l1.line === 1 && l1.origLine === 1 && l1.text === '第一行甲', '3.5 第一行的行号、原行号与原文都对上')
    check(l1.boundary === true && l1.previous === null, '3.5 最早的那一行带 boundary 标记（无值单独一行也能读）')
    check(l1.author === '样本作者' && l1.summary.indexOf('初始提交') >= 0, '3.5 每行带作者与提交摘要')
    const l2 = bls.lines[1]
    check(l2.line === 2 && l2.previous === 'e46e480b5b9eb209d225f4e9f08fc76664807608', '3.5 改过的行带 previous 指回上一版')
    check(bls.lines[2].line === 3 && bls.lines[2].text === '第三行丙改', '3.5 第三行读到原文')
  } else {
    check(false, '3.5 真样本解析失败：' + bls.detail)
    check(false, '3.5 第一行字段'); check(false, '3.5 boundary'); check(false, '3.5 作者摘要'); check(false, '3.5 previous'); check(false, '3.5 第三行')
  }
  const blEmpty = PR.parseBlame('')
  check(blEmpty.ok === true && blEmpty.lines.length === 0, '3.5 空输出读成零行')
  check(PR.parseBlame('garbage\n').ok === false, '3.5 不是 blame 输出就显式失败')
  check(PR.parseBlame('e46e480b5b9eb209d225f4e9f08fc76664807608 1 1 1\nauthor\tnope\n').ok === false, '3.5 行头后面缺原文行（读到一半）判失败，不交半份')

  const rds = PR.parseRangeDiff(fx.rangeDiff.out)
  check(rds.ok === true && rds.pairs.length === 4, '3.9 真样本读成四对（实际 ' + (rds.ok ? rds.pairs.length : '解析失败') + '）')
  if (rds.ok) {
    check(rds.pairs[0].mark === '<' && rds.pairs[0].leftNo === 1 && rds.pairs[0].rightNo === null, '3.9 只在旧组的那一对（<）没有新组编号')
    check(rds.pairs[1].mark === '>' && rds.pairs[1].leftNo === null && rds.pairs[1].rightNo === 1, '3.9 只在新组的那一对（>）没有旧组编号')
    check(rds.pairs[2].mark === '=' && rds.pairs[2].leftOid === '195b21e' && rds.pairs[2].rightOid === '305a2a5', '3.9 两边同形的那一对（=）两个提交号都读到')
    check(rds.pairs[3].subject.indexOf('只在新分支') >= 0, '3.9 对照行的提交说明原样保留')
  } else {
    check(false, '3.9 真样本解析失败：' + rds.detail)
    check(false, '3.9 旧组'); check(false, '3.9 新组'); check(false, '3.9 同形'); check(false, '3.9 说明')
  }
  const rdsSame = PR.parseRangeDiff(fx.rangeDiffSame.out)
  check(rdsSame.ok === true && rdsSame.pairs.length === 2 && rdsSame.pairs.every(function (p) { return p.mark === '=' }), '3.9 完全相同的两组全部标成 =')
  const rdsEmpty = PR.parseRangeDiff('')
  check(rdsEmpty.ok === true && rdsEmpty.pairs.length === 0, '3.9 空输出读成零对')
  check(PR.parseRangeDiff('garbage line\n').ok === false, '3.9 不是对照表输出就显式失败')

  const dTag = PR.parseDescribe(fx.describeTagged.out)
  check(dTag.ok === true && dTag.describe.text === 'v1.0.0-6-g437a134' && dTag.describe.dirty === false, '3.10 有标签时读到离最近标签的距离')
  const dDirty = PR.parseDescribe(fx.describeDirty.out)
  check(dDirty.ok === true && dDirty.describe.dirty === true, '3.10 工作区有改动时标出 -dirty')
  const dUn = PR.parseDescribe(fx.describeUntagged.out)
  check(dUn.ok === true && dUn.describe.text === '75a3cbc', '3.10 没有标签时 --always 兜底成短提交号')
  check(PR.parseDescribe('').ok === false, '3.10 成功却空输出判失败（不猜）')
  check(PR.parseDescribe('a\nb\n').ok === false, '3.10 多行输出判失败')

  const rlg = PR.parseReflog(fx.reflogIso.out)
  const rlgLines = fx.reflogIso.out.split('\n').filter(function (l) { return l !== '' }).length
  check(rlg.ok === true && rlg.entries.length === rlgLines, '3.11 真样本逐行读成引用日志条目（行 ' + rlgLines + ' / 条 ' + (rlg.ok ? rlg.entries.length : '解析失败') + '）')
  if (rlg.ok && rlg.entries.length) {
    check(rlg.entries[0].selector.indexOf('HEAD@{') === 0 && rlg.entries[0].selector.indexOf('T') > 0, '3.11 选择器带可读时间（iso-strict）')
    check(/^[0-9a-f]{7}$/.test(rlg.entries[0].short), '3.11 短提交号是 7 位十六进制')
    check(rlg.entries[0].actor === '样本作者' && rlg.entries[0].subject.indexOf('checkout') === 0, '3.11 动作者与动作说明都读到')
  } else { check(false, '3.11 选择器'); check(false, '3.11 短号'); check(false, '3.11 动作者') }
  const rlgRef = PR.parseReflog(fx.reflogRef.out)
  check(rlgRef.ok === true && rlgRef.entries.length === 2, '3.11 只看某个引用时读成两条（实际 ' + (rlgRef.ok ? rlgRef.entries.length : '解析失败') + '）')
  check(PR.parseReflog(fx.reflog.out).ok === false, '3.11 多出一个字段的旧样本判失败（解析的必须是我们拼的那条命令）')
  const rlgEmpty = PR.parseReflog('')
  check(rlgEmpty.ok === true && rlgEmpty.entries.length === 0, '3.11 空输出读成零条')
  check(PR.parseReflog('not a reflog line\n').ok === false, '3.11 不是引用日志输出就显式失败')

  const sfText = PR.parseFileContent(fx.showFileChinese.out)
  check(sfText.ok === true && sfText.file.text === '第一行甲\n第二行乙改\n第三行丙改\n' && sfText.file.binary === false, '3.13 某版本的文件内容原样读出（中文与行尾都保留）')
  const sfBin = PR.parseFileContent(fx.showFileBinary.out)
  check(sfBin.ok === true && sfBin.file.binary === true && sfBin.file.text === '', '3.13 含 NUL 的内容标成二进制，不把 NUL 送到界面')
  const sfOne = PR.parseFileContent(fx.showFile.out)
  check(sfOne.ok === true && sfOne.file.text === '将被重命名的文件\n', '3.13 单行文件内容原样读出')
  const sfEmpty = PR.parseFileContent('')
  check(sfEmpty.ok === true && sfEmpty.file.text === '', '3.13 空文件读成空内容')

  check(PR.parseNotesText(fx.notesHas.out) === '备注：这条提交是发布点，别动', '3.12 提交备注去掉行尾换行、正文原样')
  check(PR.parseNotesText('') === '' && PR.parseNotesText('a\n\n') === 'a', '3.12 空备注与多余行尾都归一')
  check(textOf(fx.notesNone.err).indexOf('no note found') >= 0, '3.12 没有备注时 git 退出码 1 且原话在 stderr（宿主据此报「没有备注」）')

  const diffs = PD.parseDiffFiles(fx.diffTwoDot.out)
  check(diffs.ok === true && diffs.files.length === 5, '3.8 真样本比较出五个文件（实际 ' + (diffs.ok ? diffs.files.length : '解析失败') + '）')
  if (diffs.ok && diffs.files.length === 5) {
    const ren = diffs.files[2]
    check(ren.origPath === '旧名.txt' && ren.path === '新名.txt', '3.8 重命名那一项分开记住原名与新名')
    const bin = diffs.files[4]
    check(bin.added === null && bin.deleted === null, '3.8 二进制文件没有增删行数（null，不是 0）')
  } else { check(false, '3.8 重命名'); check(false, '3.8 二进制') }
  const diffsSame = PD.parseDiffFiles(fx.diffSame.out)
  check(diffsSame.ok === true && diffsSame.files.length === 0, '3.8 两个引用相同时读成空比较')
  check(PD.parseDiffFiles('garbage\n').ok === false, '3.8 不是 numstat 输出就显式失败')

  const grLog = PL.parseLog(fx.grep.out)
  check(grLog.ok === true && grLog.commits.length === 1 && grLog.commits[0].subject.indexOf('MAGIC_TOKEN') >= 0, '3.6 按说明搜提交的真样本读成一条提交')
  const grEmpty = PL.parseLog(fx.grepEmpty.out)
  check(grEmpty.ok === true && grEmpty.commits.length === 0, '3.6 搜不到时读成空清单')
  check(PL.parseLog(fx.pickaxeS.out).ok === true && PL.parseLog(fx.pickaxeS.out).commits.length === 1, '3.7 按代码变化搜（-S）的真样本读成一条提交')
  check(PL.parseLog(fx.pickaxeG.out).ok === true && PL.parseLog(fx.pickaxeG.out).commits.length === 1, '3.7 按代码变化搜（-G）的真样本读成一条提交')
  check(textOf(fx.grepBadRegex.err).indexOf('Invalid regular expression') >= 0, '3.6 坏正则时 git 原话在 stderr（宿主原样带回来，不猜）')
  check(textOf(fx.reflogBadRef.err).indexOf('unknown revision') >= 0, '3.11 不存在的引用时 git 原话在 stderr')
  check(textOf(fx.rangeDiffBad.err).indexOf('bad revision') >= 0, '3.9 坏区间时 git 原话在 stderr')
  check(textOf(fx.showFileMissing.err).indexOf('does not exist') >= 0, '3.13 文件不在那个版本时 git 原话在 stderr')
  check(textOf(fx.blameBadRange.err).indexOf('has only 3 lines') >= 0, '3.5 行号超出文件时 git 原话在 stderr')


  // ---- C 组：客户端数据层（目录与账本同源、上限同值、本地校验四类、空/截断/形状判定） ----
  // 闭包拼的是构建同一份拼装次序与同一份转译参数；这里只查数据层算出来的读数，不重复画界面
  //   （界面那一层在 verify-818 的 Q 组里按真渲染查）。
  const LH = await import(base + 'capability-ledger.ts')
  const CV = buildQueryClient()
  check(CV.VC_QUERY_PHONE === 'wf.gitHistoryQuery', 'C1 客户端只发一条历史查询电话 wf.gitHistoryQuery（实测 ' + CV.VC_QUERY_PHONE + '）')
  check(CV.VC_QUERY_COUNT_MAX === CR.HISTORY_QUERY_COUNT_MAX && CV.VC_QUERY_BLAME_SPAN_MAX === CR.HISTORY_QUERY_BLAME_LINES_MAX && CV.VC_QUERY_COMPARE_MAX === CR.HISTORY_QUERY_COMPARE_FILES_MAX && CV.VC_QUERY_RANGE_MAX === CR.HISTORY_QUERY_RANGE_PAIRS_MAX, 'C2 客户端四条上限与共享层常量逐条相等（实测 ' + [CV.VC_QUERY_COUNT_MAX, CV.VC_QUERY_BLAME_SPAN_MAX, CV.VC_QUERY_COMPARE_MAX, CV.VC_QUERY_RANGE_MAX].join('/') + '，共享层 ' + [CR.HISTORY_QUERY_COUNT_MAX, CR.HISTORY_QUERY_BLAME_LINES_MAX, CR.HISTORY_QUERY_COMPARE_FILES_MAX, CR.HISTORY_QUERY_RANGE_PAIRS_MAX].join('/') + '）')
  const qCat = CV.vcQueryCatalogOf()
  check(qCat.length === 10, 'C3 客户端目录恰好十条（实测 ' + qCat.length + ' 条）')
  let qCatOk = qCat.length === 10
  qCat.forEach(function (e) {
    const cap = LH.CAPABILITIES.filter(function (c) { return c.id === e.capId })[0]
    if (!cap || e.page !== cap.page || e.name !== cap.name || e.command !== cap.command || e.primaryEntry !== cap.primaryEntry) qCatOk = false
  })
  check(qCatOk, 'C4 十条的名称 / 页面 / 命令原文 / 主入口逐条回能力账本取（界面不另写一份命令清单）')
  check(CV.vcQueryEntriesOf('commits').map(function (e) { return e.capId }).join(',') === '3.4,3.6,3.7,3.8,3.10,3.12' && CV.vcQueryEntriesOf('diagnostics').map(function (e) { return e.capId }).join(',') === '3.5,3.9,3.11,3.13', 'C5 按账本的页面归属分组：提交历史页六条（3.4/3.6/3.7/3.8/3.10/3.12）、管理·诊断页四条（3.5/3.9/3.11/3.13）')
  check(CV.vcQueryEntryOf('blame').diagnostic === true && CV.vcQueryEntryOf('file-history').diagnostic === false && CV.vcQueryEntryOf('没有这种查询') === null, 'C6 单条：诊断页那条标着诊断页来源，提交历史页那条不标，不认识的回 null（不造空壳）')
  const qIn = CV.vcQueryInputsOf()
  check(CV.vcQueryInputValueOf(qIn, 'file-history', 'count') === '50' && CV.vcQueryInputValueOf(qIn, 'compare', 'mode') === 'two-dot' && CV.vcQueryInputValueOf(qIn, 'pickaxe', 'mode') === 'occurrence' && CV.vcQueryInputValueOf(qIn, 'describe', 'count') === '', 'C7 输入初值：条数 50、两种下拉各自的初值、没有的字段回空串（不凭空造一个值）')
  check(qCat.filter(function (e) { return e.limit > 0 }).length === 7 && CV.vcQueryEntryOf('describe').limit === 0 && CV.vcQueryEntryOf('notes').limit === 0 && CV.vcQueryEntryOf('show-file').limit === 0, 'C8 七条有显式条数上限、三条只有一条读数（limit 0，不放假上限）')
  const qBadCases = [
    ['file-history', { path: '' }, 'path', 'required-missing'],
    ['file-history', { path: 'a', count: '不少' }, 'count', 'not-number'],
    ['blame', { path: 'a', lineStart: '9', lineEnd: '3' }, 'lineEnd', 'range-order'],
    ['blame', { path: 'a', lineStart: '1', lineEnd: '501' }, 'lineEnd', 'range-span'],
    ['grep', { pattern: '' }, 'pattern', 'required-missing'],
    ['compare', { left: 'main' }, 'right', 'required-missing'],
    ['range-diff', { base: 'main', left: 'a' }, 'right', 'required-missing'],
    ['show-file', { rev: 'HEAD' }, 'path', 'required-missing'],
  ]
  let qBadOk = true
  const qBadDetail = []
  qBadCases.forEach(function (c) {
    const r = CV.vcQueryParamsOf(c[0], c[1])
    if (!(r.ok === false && r.field === c[2] && r.reason === c[3])) { qBadOk = false; qBadDetail.push(c[0] + ':' + JSON.stringify(r)) }
  })
  check(qBadOk, 'C9 本地预检四类错误各指到具体字段（必填没填 / 整数写歪 / 行号颠倒 / 跨度超限；不符的 ' + (qBadDetail.join('；') || '无') + '）')
  const qGood = {
    'file-history': { path: 'a', count: '10' }, blame: { path: 'a', lineStart: '1', lineEnd: '2' },
    grep: { pattern: 'x' }, pickaxe: { text: 'x', mode: 'change' }, compare: { left: 'a', right: 'b' },
    'range-diff': { base: 'a', left: 'b', right: 'c' }, describe: {}, reflog: { ref: 'HEAD', count: '5' },
    notes: { rev: 'HEAD' }, 'show-file': { rev: 'HEAD', path: 'a.txt' },
  }
  const qWantKeys = { 'file-history': 'count,path', blame: 'lineEnd,lineStart,path', grep: 'pattern', pickaxe: 'mode,text', compare: 'left,right', 'range-diff': 'base,left,right', describe: '', reflog: 'count,ref', notes: 'rev', 'show-file': 'path,rev' }
  let qGoodOk = true
  const qGoodDetail = []
  Object.keys(qGood).forEach(function (kind) {
    const r = CV.vcQueryParamsOf(kind, qGood[kind])
    if (!r.ok || Object.keys(r.params).sort().join(',') !== qWantKeys[kind]) { qGoodOk = false; qGoodDetail.push(kind + ':' + JSON.stringify(r)) }
  })
  check(qGoodOk, 'C10 十条的合法输入各自拼出宿主要的那份参数（键名与能力目录同源；不符的 ' + (qGoodDetail.join('；') || '无') + '）')
  check(CV.vcQueryParamsOf('没有这种', {}).ok === false && CV.vcQueryParamsOf('没有这种', {}).reason === 'unknown-kind', 'C11 不认识的查询种类：当场拒（不猜成最近的一条）')
  check(CV.vcQueryParamsOf('file-history', { path: 'a', count: '10' }).params.count === 10 && CV.vcQueryParamsOf('blame', { path: 'a', lineStart: '1', lineEnd: '2' }).params.lineEnd === 2, 'C12 条数与行号到宿主那一侧已经是数字（不是字符串 "10"）')
  check(CV.vcQueryEmptyOf('notes', { note: null }) === 'no-note' && CV.vcQueryEmptyOf('file-history', { reason: 'empty', commits: [] }) === 'commits' && CV.vcQueryEmptyOf('compare', { reason: 'same', files: [] }) === 'same' && CV.vcQueryEmptyOf('range-diff', { reason: 'same', pairs: [] }) === 'rangeSame' && CV.vcQueryEmptyOf('show-file', { text: '', binary: false }) === 'content' && CV.vcQueryEmptyOf('reflog', { reason: 'ok', entries: [{}] }) === '', 'C13 空结果的五种说法各按宿主 reason 说（没有提交 / 两边一样 / 两组对照一样 / 没有备注 / 这个版本里这个文件是空的），不猜成「没有历史」')
  const qTr1 = CV.vcQueryTruncatedOf({ truncated: true, files: [1, 2, 3], total: 9 })
  const qTr2 = CV.vcQueryTruncatedOf({ truncated: true, pairs: [1], total: 4 })
  check(!!qTr1 && qTr1.shown === 3 && qTr1.total === 9 && !!qTr2 && qTr2.shown === 1 && qTr2.total === 4 && CV.vcQueryTruncatedOf({ truncated: false, files: [1] }) === null, 'C14 截断读数：给「已显示几条 / 一共几条」，没截断回 null（不把「没截断」画成上限）')
  check(CV.vcQueryShownOf('file-history', { commits: [1, 2] }) === 2 && CV.vcQueryShownOf('blame', { lines: [1] }) === 1 && CV.vcQueryShownOf('reflog', { entries: [1, 2, 3] }) === 3 && CV.vcQueryShownOf('describe', { text: 'v1' }) === 0, 'C15 清单条数按各类型真读出来的数组算（单条读数的类型算 0 条）')
  const qShapes = {
    'file-history': { ok: true, kind: 'file-history', commits: [{}], count: 1 },
    blame: { ok: true, kind: 'blame', lines: [{}], count: 1 },
    grep: { ok: true, kind: 'grep', commits: [], count: 0 },
    pickaxe: { ok: true, kind: 'pickaxe', commits: [], count: 0 },
    compare: { ok: true, kind: 'compare', files: [], total: 0, truncated: false },
    'range-diff': { ok: true, kind: 'range-diff', pairs: [], extraLines: [], truncated: false },
    describe: { ok: true, kind: 'describe', text: 'v1', dirty: false },
    reflog: { ok: true, kind: 'reflog', entries: [], count: 0 },
    notes: { ok: true, kind: 'notes', note: null, reason: 'no-note' },
    'show-file': { ok: true, kind: 'show-file', text: 'x', binary: false },
  }
  const qShapeBad = Object.keys(qShapes).filter(function (k) { return CV.vcQueryShapeOk(k, qShapes[k]) !== true })
  check(qShapeBad.length === 0, 'C16 十类回包的形状判据逐类放行各自的真形状（判红的 ' + (qShapeBad.join(',') || '无') + '）')
  let qShapeCutOk = true
  const qShapeCutDetail = []
  Object.keys(qShapes).forEach(function (k) {
    const broken = Object.assign({}, qShapes[k])
    const first = Object.keys(broken).filter(function (f) { return f !== 'ok' && f !== 'kind' })[0]
    delete broken[first]
    if (CV.vcQueryShapeOk(k, broken) !== false) { qShapeCutOk = false; qShapeCutDetail.push(k + ' 缺 ' + first) }
  })
  check(qShapeCutOk, 'C17 十类回包各缺一个字段都判形状失败（不拿半份数据冒充成功；漏判的 ' + (qShapeCutDetail.join('；') || '无') + '）')
  const qFailEnv = CV.vcFailureOf({ ok: false, error: { kind: 'exit', message: 'git 说不行' } })
  check(qFailEnv.kind === 'exit' && qFailEnv.message === 'git 说不行' && CV.vcFailureOf({ ok: true }).kind === 'shape', 'C18 失败归一：真失败信封照原 kind 与原文；ok:true 却缺字段的一律记 shape（与读数层同一个判据）')

  // ---- D 组：宿主电话（真 createVersionControl + 假 subprocess，回路线都按真样本） ----
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const dParams = {
    'file-history': { path: '文件 一.txt' },
    blame: { path: '文件 一.txt', lineStart: 1, lineEnd: 2 },
    grep: { pattern: 'MAGIC' },
    pickaxe: { text: 'MAGIC_TOKEN', mode: 'occurrence' },
    compare: { left: 'HEAD~1', right: 'HEAD' },
    'range-diff': { base: 'main', left: 'feat-a', right: 'feat-b' },
    describe: {},
    reflog: { count: 20 },
    notes: { rev: 'HEAD' },
    'show-file': { rev: 'HEAD', path: '文件 二.txt' },
  }
  const dRoute = makeQueryRoute({})
  const dRun = makeQueryHostDeps(dRoute.route)
  const DVC = hostMod.createVersionControl(dRun.deps)
  const dReplies = {}
  const dKinds = CR.HISTORY_QUERY_KINDS
  for (let i = 0; i < dKinds.length; i += 1) {
    dReplies[dKinds[i]] = await DVC.handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: dKinds[i], params: dParams[dKinds[i]] || {} })
  }
  const dBadKinds = dKinds.filter(function (k) { const r = dReplies[k]; return !(r && r.ok === true && r.kind === k) })
  check(dBadKinds.length === 0, 'D1 十条查询逐条走通 wf.gitHistoryQuery（失败的 ' + (dBadKinds.join(',') || '无') + '）')
  // 每种查询固定两条前置命令（确认仓库根那两步），之后才是这条查询自己的命令。
  // #1903 起 compare 在跑 diff 之前先把两端各认一遍（认不出的那一端要原样说给用户听，
  //   不能让 git 的 fatal 原文或者「当成 HEAD」糊过去），所以它比别的多两条。
  let dArgvBad = ''
  let dCursor = 0
  const dCompareResolve: string[][] = []
  dKinds.forEach(function (k) {
    const extra = k === 'compare' ? 2 : 0
    const slice = dRoute.seen.slice(dCursor, dCursor + 3 + extra)
    dCursor += 3 + extra
    const want = CR.historyQueryCommandFor(k, dParams[k] || {})
    const got = qAfterPrefix(slice[slice.length - 1])
    if (!want.ok || JSON.stringify(want.args) !== JSON.stringify(got)) dArgvBad = dArgvBad || (k + ' 期望 ' + JSON.stringify(want.args) + ' 实得 ' + JSON.stringify(got))
    if (extra > 0) {
      dCompareResolve.push(qAfterPrefix(slice[2]))
      dCompareResolve.push(qAfterPrefix(slice[3]))
    }
  })
  check(dArgvBad === '', 'D2 十条电话发出的 argv 与共享层的命令口径逐条相同（' + (dArgvBad || '十条全同') + '）')
  const dResolveOk = dCompareResolve.length === 2
    && dCompareResolve[0][0] === 'rev-parse' && dCompareResolve[0][dCompareResolve[0].length - 1] === 'HEAD~1^{commit}'
    && dCompareResolve[1][0] === 'rev-parse' && dCompareResolve[1][dCompareResolve[1].length - 1] === 'HEAD^{commit}'
  check(dResolveOk, 'D2b 3.8 比较之前先把左右两端各认一遍：认不出的那一端才说得清是哪一端（实得 ' + JSON.stringify(dCompareResolve) + '）')
  const dFH = dReplies['file-history']
  check(dFH.commits.length === 2 && dFH.count === 2 && dFH.reason === 'ok' && !!dFH.commits[0].oid, 'D3 3.4 单文件历史：真样本两条提交、count 与 reason 都在（实测 ' + dFH.count + ' 条，reason ' + dFH.reason + '）')
  const dBL = dReplies.blame
  check(dBL.lines.length === 3 && dBL.count === 3 && dBL.lines[0].line === 1 && String(dBL.lines[0].text).indexOf('第一行甲') >= 0, 'D4 3.5 行级追溯：真样本三行、首行行号 1、原文照抄（实测 ' + dBL.count + ' 行，首行 ' + dBL.lines[0].line + '）')
  check(dReplies.grep.commits.length === 1 && String(dReplies.grep.commits[0].subject).indexOf('MAGIC_TOKEN') >= 0 && dReplies.grep.reason === 'ok', 'D5 3.6 按说明搜提交：真样本一条提交，说明原样带出（实测 ' + dReplies.grep.count + ' 条）')
  check(dReplies.pickaxe.commits.length === 1 && dReplies.pickaxe.reason === 'ok', 'D6 3.7 按代码变化搜提交：真样本（-S）一条提交（实测 ' + dReplies.pickaxe.count + ' 条）')
  const dCP = dReplies.compare
  check(dCP.files.length === 5 && dCP.total === 5 && dCP.truncated === false && dCP.reason === 'ok' && dCP.files[2].origPath === '旧名.txt' && dCP.files[4].added === null, 'D7 3.8 比较两个引用：真样本五个文件、重命名分开记原名、二进制没有增删行数、truncated 为假（实测 ' + dCP.total + ' 个）')
  const dRD = dReplies['range-diff']
  check(dRD.pairs.length === 4 && dRD.extraLines.length === 0 && dRD.truncated === false && dRD.reason === 'ok' && dRD.pairs[0].mark === '<' && dRD.pairs[2].mark === '=', 'D8 3.9 两组提交对照：真样本四对（一边独有两条、同名两条各占一行）、多行说明为空、truncated 为假（实测 ' + dRD.pairs.length + ' 对，记号 ' + dRD.pairs.map(function (x) { return x.mark }).join('') + '）')
  check(dReplies.describe.text === 'v1.0.0-6-g437a134' && dReplies.describe.dirty === false, 'D9 3.10 版本名：真样本带 tag 的描述串与干净标记（实测 ' + dReplies.describe.text + '，dirty ' + dReplies.describe.dirty + '）')
  check(dReplies.reflog.entries.length === 12 && dReplies.reflog.count === 12 && String(dReplies.reflog.entries[0].selector).indexOf('HEAD@{') === 0, 'D10 3.11 引用日志：真样本十二条、选择器原样带出（实测 ' + dReplies.reflog.count + ' 条）')
  check(dReplies.notes.note === '备注：这条提交是发布点，别动' && dReplies.notes.reason === 'ok', 'D11 3.12 提交备注：作者写的原文照抄（只去掉行尾换行；实测 ' + JSON.stringify(dReplies.notes.note) + '）')
  check(dReplies['show-file'].text === QFX.showFile.out && dReplies['show-file'].binary === false, 'D13 3.13 取某版本的文件内容：真样本逐字节照抄（实测 ' + JSON.stringify(dReplies['show-file'].text) + '）')

  const dEmptyRun = makeQueryHostDeps(makeQueryRoute({ fixture: { grep: 'grepEmpty' } }).route)
  const dEmpty = await hostMod.createVersionControl(dEmptyRun.deps).handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'grep', params: { pattern: '没有这个' } })
  check(dEmpty.ok === true && dEmpty.commits.length === 0 && dEmpty.reason === 'empty' && dEmpty.count === 0, 'D14 3.6 搜不到：ok:true 空清单 + reason=empty（不当失败，也不猜成没有历史）')
  const dSameRun = makeQueryHostDeps(makeQueryRoute({ fixture: { compare: 'diffSame', 'range-diff': 'rangeDiffSame' } }).route)
  const dSameVC = hostMod.createVersionControl(dSameRun.deps)
  const dSameCompare = await dSameVC.handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'compare', params: { left: 'HEAD', right: 'HEAD' } })
  const dSameRange = await dSameVC.handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'range-diff', params: { base: 'main', left: 'a', right: 'b' } })
  check(dSameCompare.ok === true && dSameCompare.reason === 'same' && dSameCompare.files.length === 0 && dSameRange.ok === true && dSameRange.reason === 'ok' && dSameRange.pairs.length === 2 && dSameRange.pairs.every(function (x) { return x.mark === '=' }), 'D15 两边一样：比较两个引用回 reason=same 明说没差异；两组提交完全一样：range-diff 逐对给 = 记号（两边方向一致，不当空结果）（实测 compare files ' + dSameCompare.files.length + '，range pairs ' + dSameRange.pairs.length + ' 个 =）')
  const dNoNoteRun = makeQueryHostDeps(makeQueryRoute({ fixture: { notes: 'notesNone' } }).route)
  const dNoNote = await hostMod.createVersionControl(dNoNoteRun.deps).handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'notes', params: { rev: 'HEAD' } })
  check(dNoNote.ok === true && dNoNote.note === null && dNoNote.reason === 'no-note', 'D16 3.12 目标没有备注：git 退出码 1 不算失败，回 note:null + reason=no-note（不猜成「备注是空串」）')

  const dFailRoute = makeQueryRoute({ fixture: { grep: 'grepBadRegex', 'range-diff': 'rangeDiffBad', 'show-file': 'showFileMissing', blame: 'blameBadRange' } })
  const dFailRun = makeQueryHostDeps(dFailRoute.route)
  const dFailVC = hostMod.createVersionControl(dFailRun.deps)
  const dFailGrep = await dFailVC.handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'grep', params: { pattern: '[' } })
  check(dFailGrep.ok === false && dFailGrep.error.kind === 'exit' && String(dFailGrep.error.message).indexOf('Invalid regular expression') >= 0, 'D17 坏正则：失败信封带 git 原话（实测 ' + JSON.stringify(dFailGrep.error && dFailGrep.error.message) + '）')
  const dFailRange = await dFailVC.handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'range-diff', params: { base: 'nope', left: 'main', right: 'main' } })
  check(dFailRange.ok === false && String(dFailRange.error.message).indexOf('bad revision') >= 0, 'D18 坏区间：失败信封带 git 原话（不猜哪边是新）')
  const dFailShow = await dFailVC.handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'show-file', params: { rev: 'HEAD', path: '不存在的文件.txt' } })
  check(dFailShow.ok === false && String(dFailShow.error.message).indexOf('does not exist') >= 0, 'D19 文件不在那个版本：失败信封带 git 原话（不拿空内容冒充空文件）')
  const dFailBlame = await dFailVC.handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'blame', params: { path: '文件 一.txt', lineStart: 1, lineEnd: 99 } })
  check(dFailBlame.ok === false && String(dFailBlame.error.message).indexOf('has only 3 lines') >= 0, 'D20 行号超出文件：失败信封带 git 原话（不截到文件末尾凑一个结果）')

  const dNoCallRoute = makeQueryRoute({})
  const dNoCall = await hostMod.createVersionControl(makeQueryHostDeps(dNoCallRoute.route).deps).handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'file-history', params: { path: '' } })
  check(dNoCall.ok === false && dNoCall.error.kind === 'args' && dNoCallRoute.seen.length === 0, 'D21 空路径这类不合口径的输入在宿主侧就拒：一个 git 进程都不起（实测起了 ' + dNoCallRoute.seen.length + ' 个）')
  const dTruncRoute = makeQueryRoute({ truncated: { blame: true } })
  const dTrunc = await hostMod.createVersionControl(makeQueryHostDeps(dTruncRoute.route).deps).handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'blame', params: { path: '文件 一.txt', lineStart: 1, lineEnd: 2 } })
  check(dTrunc.ok === false && dTrunc.error.kind === 'truncated' && String(dTrunc.error.message).indexOf('读不全就不给半份') >= 0 && dTrunc.lines === undefined, 'D22 读不全：blame 输出超上限时显式失败并写清「读不全就不给半份」，回包里没有半份 lines（实测 ' + JSON.stringify(dTrunc.error) + '）')
  const dNoRepo = await hostMod.createVersionControl(makeQueryHostDeps(makeQueryRoute({ noRepo: true }).route).deps).handleGitHistoryQuery({ cwd: 'D:/不在仓库里', kind: 'describe', params: {} })
  check(dNoRepo.ok === false && dNoRepo.error.kind === 'not-repo', 'D23 不在仓库里：明确回 not-repo（不试出一条空命令当成功）')
  const dNoGit = await hostMod.createVersionControl(makeQueryHostDeps(makeQueryRoute({}).route, { gitExe: null }).deps).handleGitHistoryQuery({ cwd: 'D:/假工作区/repo', kind: 'describe', params: {} })
  check(dNoGit.ok === false && dNoGit.error.kind === 'env', 'D24 找不到 git 命令：明确回 env（历史查询起不了进程）')

  const dPhoneLogs = dRun.logs.filter(function (l) { return l.event === 'host.call' && l.fields && l.fields.method === 'wf.gitHistoryQuery' })
  const dExecLogs = dRun.logs.filter(function (l) { return l.event === 'git.exec' })
  check(dPhoneLogs.length >= 10 && dExecLogs.length >= 30 && JSON.stringify(dRun.logs).indexOf('文件 一.txt') < 0, 'D25 每次读取落一行 host.call、每次进程落一行 git.exec；日志里不出现路径原文（规格第 8 节字段白名单；电话日志 ' + dPhoneLogs.length + ' 行、进程日志 ' + dExecLogs.length + ' 行）')
  const dFailExecBad = dFailRun.logs.filter(function (l) { return l.event === 'git.exec' && l.fields && typeof l.fields.exitCode === 'number' && l.fields.exitCode !== 0 })
  const dFailPhoneFails = dFailRun.logs.filter(function (l) { return l.event === 'host.call.fail' && l.fields && l.fields.method === 'wf.gitHistoryQuery' })
  const dFailLogsText = JSON.stringify(dFailRun.logs)
  check(dFailExecBad.length >= 4 && dFailPhoneFails.length >= 4 && dFailLogsText.indexOf('Invalid regular expression') < 0 && dFailLogsText.indexOf('文件 一.txt') < 0, 'D26 失败那一趟逐次落 git.exec（记退出码）与 host.call.fail，只记哈希不记 stderr 原文与路径原文（实测非零退出日志 ' + dFailExecBad.length + ' 行、电话失败日志 ' + dFailPhoneFails.length + ' 行；规格第 8 节字段白名单）')

  // ---- E 组：反证（把本门依赖的判据改坏，原判据必须当场变红） ----
  const eBaseSrc = queryClientSourceOf(null)
  const eAntiCases = [
    {
      name: '本地必填校验被放行',
      patch: function (s) { return s.replace("if (f.required && text === '') return bad(f.name, 'required-missing')", "if (false) return bad(f.name, 'required-missing')") },
      judge: function (v) { const r = v.vcQueryParamsOf('file-history', { path: '' }); return r.ok === false && r.reason === 'required-missing' && r.field === 'path' },
      what: 'C9',
    },
    {
      name: '回包形状判据放行缺字段',
      patch: function (s) { return s.replace("if (kind === 'file-history' || kind === 'grep' || kind === 'pickaxe') return Array.isArray(reply.commits) && typeof reply.count === 'number'", "if (kind === 'file-history' || kind === 'grep' || kind === 'pickaxe') return true") },
      judge: function (v) { return v.vcQueryShapeOk('file-history', { ok: true, kind: 'file-history', commits: [] }) === false && v.vcQueryShapeOk('file-history', { ok: true, kind: 'file-history', commits: [], count: 0 }) === true },
      what: 'C16/C17',
    },
    {
      name: '截断读数不再判',
      patch: function (s) { return s.replace("if (!reply || reply.truncated !== true) return null", "return null") },
      judge: function (v) { const t = v.vcQueryTruncatedOf({ truncated: true, files: [1, 2], total: 5 }); return !!t && t.shown === 2 && t.total === 5 },
      what: 'C14',
    },
  ]
  eAntiCases.forEach(function (c) {
    const eBrokenSrc = c.patch(eBaseSrc)
    check(eBrokenSrc !== eBaseSrc, 'E 反证自证：' + c.name + ' 的改法真的改得到源码')
    let eBroke = false
    try { eBroke = c.judge(buildQueryClient(c.patch)) === false } catch (e) { eBroke = false }
    check(eBroke, 'E 反证：' + c.name + ' 之后 ' + c.what + ' 那条当场变红')
  })

  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error(e); process.exit(1) })
