// 门禁归属: src/shared/version-control/src/history-query-commands.ts
// 历史高级查询与追溯（#1745 T10，规格 #1586 能力 3.4–3.13）的参数口径与回包解析门禁。
// 这里只查「拼出来的 argv 是不是那一条」与「真 git 输出能不能读成对的结构」；
// 界面与宿主接线在同一个门禁的后半段（同一份文件，按 A/B/C/D 四段）。
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

  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.error(e); process.exit(1) })
