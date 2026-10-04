// verify-version-control-parsers.js — 版本控制核心解析器门禁（#816 落地）
// 用法：在插件根目录执行 node tests/verify-version-control-parsers.js，可独立运行。
//
// 断言文字：只测外部行为——给定一段样本文本，断言产出的数据模型，不测实现细节。
// 六组解析器各自：实采干净仓库能解出手写脏仓库中文重命名能解出、冲突不丢、游离与零提交
// 不误判、上游被删单独成态、旧版降级有路、截断半截显式失败（不装作成功）。
// 最后带一层断言装置自检：把样本改坏（字段数、行首字符、哈希），同一套解析必须显式失败。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

async function main() {
  console.log('版本控制解析器门禁（#816：六组解析 + 严格失败 + 断言装置自检）')

  const vc = (rel) => pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', rel)).href
  const status = await import(vc('parse-status.js'))
  const worktrees = await import(vc('parse-worktrees.js'))
  const refs = await import(vc('parse-refs.js'))
  const log = await import(vc('parse-log.js'))
  const diffFiles = await import(vc('parse-diff-files.js'))
  const patch = await import(vc('parse-patch.js'))
  const caps = await import(vc('capabilities.js'))
  const commands = await import(vc('commands.js'))
  const state = await import(vc('state.js'))

  // ---- 0) 命令口径与解析同处被测单元：描述子键与采集清单一致 ----
  check(JSON.stringify(commands.COLLECTION_KEYS) === JSON.stringify(['status', 'worktrees', 'refs', 'log', 'diffFiles', 'patch']),
    '采集项清单恰好六键（status/worktrees/refs/log/diffFiles/patch）')
  for (const k of commands.COLLECTION_KEYS) {
    const spec = commands.commandFor(k, {})
    check(spec.key === k && Array.isArray(spec.args) && spec.args.length > 0, '命令描述子 ' + k + ' 可构造（' + spec.args.slice(0, 2).join(' ') + '）')
  }
  const prefix = commands.fixedPrefix()
  check(prefix.includes('--no-optional-locks') && prefix.includes('color.ui=false'), '固定前缀含不抢锁与关颜色')
  check(commands.commandFor('status', {}).args.includes('-z') && commands.commandFor('diffFiles', {}).args.includes('-z'),
    '凡输出含路径的命令一律带 -z')
  check(commands.RUNNING_MARKER_PATHS.length === 5 && commands.RUNNING_MARKER_PATHS.includes('MERGE_HEAD'),
    '运行中标记恰好五个路径名（含 MERGE_HEAD）')
  check(commands.stepZeroArgs().includes('--is-inside-work-tree'), '第 0 步独立成项（含 is-inside-work-tree）')

  // ---- 0.5) #821 看某一次提交改了什么：两个 rev 选项拼出来的命令形状 ----
  const REV = 'a1b2c3d4'
  check(commands.REV_PATTERN instanceof RegExp && commands.REV_PATTERN.test('a1b2c3d4') && commands.REV_PATTERN.test('A1B2C3')
    && !commands.REV_PATTERN.test('abc') && !commands.REV_PATTERN.test('HEAD') && !commands.REV_PATTERN.test('--upload-pack=x')
    && !commands.REV_PATTERN.test('a'.repeat(65)) && !commands.REV_PATTERN.test('a1b2c3d4 '),
    '提交号形状的唯一真源：四位到六十四位十六进制（三个字符、分支名、选项、六十五位、带空格都不是）')
  const revFiles = commands.commandFor('diffFiles', { rev: REV }).args
  check(JSON.stringify(revFiles) === JSON.stringify(['show', '--numstat', '-z', '--no-ext-diff', '--find-renames', '--format=', REV]),
    '带 rev 的 diffFiles 换成 git show（--format= 空掉提交头）：' + revFiles.join(' '))
  const revPatch = commands.commandFor('patch', { rev: REV, patchPath: '有 空格/中文.txt' }).args
  check(JSON.stringify(revPatch) === JSON.stringify(['show', '--unified=3', '--no-color', '--no-ext-diff', '--no-prefix', '--find-renames', '--format=', REV, '--', '有 空格/中文.txt']),
    '带 rev 的 patch 换成 git show，路径仍排在 -- 之后：' + revPatch.join(' '))
  check(revFiles[revFiles.length - 1] === REV && revPatch.filter((a) => a === REV).length === 1,
    '提交号只作为一个独立的 argv 元素出现（不拼进选项、不拼进路径）')
  check(JSON.stringify(commands.commandFor('diffFiles', {}).args) === JSON.stringify(['diff', '--numstat', '-z', '--no-ext-diff', '--find-renames', 'HEAD'])
    && JSON.stringify(commands.commandFor('patch', { patchPath: 'x.txt' }).args) === JSON.stringify(['diff', '--unified=3', '--no-color', '--no-ext-diff', '--no-prefix', '--find-renames', 'HEAD', '--', 'x.txt']),
    '不带 rev 的两条命令与从前一字不差（既有行为不变）')
  // 反证：把外部给的值拼进选项（而不是作为独立元素）的旧写法，在「提交号必须独占一个元素」这条断言下当场判红。
  const splicedBuilder = (rev) => ['show', '--numstat', '-z', '--no-ext-diff', '--find-renames', '--format=' + rev]
  check(splicedBuilder(REV).indexOf(REV) < 0, '反证：把 rev 拼进 --format= 元素的旧写法必须判红（它拼出来的是 ' + splicedBuilder(REV).slice(-1)[0] + '）')
  check(splicedBuilder('--upload-pack=x').slice(-1)[0] === '--format=--upload-pack=x', '反证：那种拼法会把外部给的值塞进选项里，所以门禁要求提交号独占一个元素且原样等于输入')
  // 反证：不认 rev 的旧命令表，在带 rev 的调用上会拼出「对 HEAD 的差异」——正是「把提交差异画成工作区差异」那个坑。
  const oldCommandFor = (key, opts) => (key === 'diffFiles' ? ['diff', '--numstat', '-z', '--no-ext-diff', '--find-renames', 'HEAD'] : ['diff', '--unified=3', '--no-color', '--no-ext-diff', '--no-prefix', '--find-renames', 'HEAD', '--', opts.patchPath])
  check(JSON.stringify(oldCommandFor('diffFiles', { rev: REV })) !== JSON.stringify(revFiles),
    '反证：不认 rev 的旧命令表在带 rev 的调用上拼出的命令与新形状不同（门禁会红）')

  // ---- 1) 版本能力：两条线 ----
  check(caps.tierFor(caps.parseVersion('git version 2.49.0.windows.1')) === 'full', '2.49 完整档')
  check(caps.tierFor(caps.parseVersion('git version 2.20.0')) === 'degraded', '2.20 降级档（锁标记未知）')
  check(caps.tierFor(caps.parseVersion('git version 2.10.0')) === 'unsupported', '2.10 以下直说请升级')
  check(caps.tierFor(caps.parseVersion('not git')) === 'unsupported', '解不出版本按不支持处理')

  // ---- 2) 实采干净仓库 ----
  const clean = readJson('version-control-core/fixtures/clean-repo.json')
  const cs = status.parseStatus(clean.status.out)
  check(cs.ok === true && cs.branch.head === 'main' && cs.entries.every((e) => e.kind === 'untracked'), '实采仓库：分支 main、仅未跟踪新文件（无已跟踪改动）')
  if (cs.ok === true) {
    check(cs.branch.upstream === 'origin/main' && cs.branch.ahead === 0 && cs.branch.behind === 0, '实采领先落后 +0-0 且有上游')
  }
  const cw = worktrees.parseWorktrees(clean.worktrees.out, true)
  check(cw.ok === true && cw.worktrees.length >= 1 && cw.worktrees[0].branch === 'main', '实采工作树列表：主工作树排第一')
  const cr = refs.parseRefs(clean.refs.out)
  check(cr.ok === true && cr.refs.some((r) => r.short === 'main' && r.current === true), '实采分支列表含当前 main（星号识别）')
  const cl = log.parseLog(clean.log.out)
  check(cl.ok === true && cl.commits.length === 3 && cl.commits[0].parents.length === 1, '实采提交历史三条、首条有父提交')
  const cd = diffFiles.parseDiffFiles(clean.diffFiles.out)
  check(cd.ok === true && cd.files.length === 0, '实采干净树 numstat 为空')
  const cz = state.classifyStepZero(clean.step0.code, clean.step0.out, clean.step0.err)
  check(cz.ok === true && cz.kind === 'worktree', '实采第 0 步判为工作树')

  // ---- 3) 手写脏仓库：中文、重命名、冲突 ----
  const dirty = readJson('version-control-core/fixtures/dirty-rename-chinese.json')
  const ds = status.parseStatus(dirty.status.out)
  check(ds.ok === true, '脏仓库 status 解出')
  if (ds.ok === true) {
    check(ds.branch.ahead === 2 && ds.branch.behind === 1, '领先 2 落后 1 读出')
    const kinds = ds.entries.map((e) => e.kind).sort().join(',')
    check(kinds.includes('renamed') && kinds.includes('unmerged') && kinds.includes('untracked'), '重命名/冲突/未跟踪三类都在（' + kinds + '）')
    const ren = ds.entries.find((e) => e.kind === 'renamed')
    check(!!ren && ren.path === 'new-新名字.txt' && ren.origPath === 'old-name.txt', '重命名新在前、原在后（-z 反转）')
    check(ds.entries.some((e) => e.path === '未跟踪 文件.txt'), '中文空格路径原样（无转义）')
  }
  const dd = diffFiles.parseDiffFiles(dirty.numstat.out)
  check(dd.ok === true, '脏仓库 numstat 解出')
  if (dd.ok === true) {
    check(dd.files.some((f) => f.added === null && f.path === 'logo.png'), '二进制行数记 null（不是 0）')
    check(dd.files.some((f) => f.origPath === 'old-name.txt' && f.path === 'new-新名字.txt'), '重命名行数按新路径会合')
  }
  const dr = refs.parseRefs(dirty.refs.out)
  check(dr.ok === true && dr.refs.some((r) => r.upstream === null), '无上游分支解出（track 空串）')

  // ---- 3.5) #817 修正：numstat 的两种真机形状（真机字节样本，live:true）----
  // 来历：真机上普通文件的 numstat 是「计数与路径同一个 NUL 字段」，重命名才是「计数头独占字段 + 两个路径字段」。
  // #816 的手写样本只写了重命名那一种，于是解析器只认一种形状也一直是绿的；这一段用真机字节把它钉住。
  const live = readJson('version-control-core/fixtures/live-numstat-shapes.json')
  check(live.source.live === true && /2\.49/.test(live.source.gitVersion), '真机样本带版本与 live 标记（' + live.source.gitVersion + '）')
  const liveNumstat = live.diffFiles.out
  check(/-\t-\t[^\0]+\0/.test(liveNumstat), '真机样本含「计数与路径同一字段」的二进制条目')
  check(/\d+\t\d+\t\0[^\0]+\0[^\0]+\0/.test(liveNumstat), '真机样本含「计数头独占字段 + 两个路径字段」的重命名条目')
  check(/\d+\t\d+\t[^\0]+\0/.test(dirty.numstat.out), '手写样本的 numstat 已按真机形状改写（普通条目计数与路径同一字段）')
  const ld = diffFiles.parseDiffFiles(liveNumstat)
  check(ld.ok === true && ld.files.length === 4, '真机 numstat 解出四条（实得 ' + (ld.ok === true ? ld.files.length : '失败') + '）')
  if (ld.ok === true) {
    check(ld.files.some((f) => f.path === '图片.png' && f.added === null && f.deleted === null), '真机二进制行数记 null（不是 0）')
    check(ld.files.some((f) => f.path === '已跟踪 文件.txt' && f.added === 2 && f.deleted === 1), '真机普通修改解出（中文与空格路径原样）')
    check(ld.files.some((f) => f.path === '改名 后.txt' && f.origPath === '改名 前.txt'), '真机重命名原路径在前、新路径在后')
    check(ld.files.some((f) => f.path === '普通.txt' && f.added === 1 && f.deleted === 1), '真机普通修改第二条解出')
  }
  const ls = status.parseStatus(live.status.out)
  check(ls.ok === true && ls.entries.some((e) => e.kind === 'untracked' && e.path === '新增 未跟踪.txt'), '真机 status 解开未跟踪新文件')
  check(ls.ok === true && ls.entries.some((e) => e.kind === 'ordinary' && e.path === '已跟踪 文件.txt'), '真机 status：1 号记录的路径带空格也解出（-z 下路径原样不转义）')
  check(ls.ok === true && ls.entries.some((e) => e.kind === 'renamed' && e.path === '改名 后.txt' && e.origPath === '改名 前.txt'), '真机 status：2 号记录的路径带空格也解出（新在前、原在后）')
  // 反证：整行按空格全切、再数固定段数的旧写法，在这份真机 status 上必然多切出一段而判红。
  const firstOrdinary = live.status.out.split('\0').filter((f) => f.charAt(0) === '1' && f.indexOf('已跟踪 文件.txt') >= 0)[0]
  check(String(firstOrdinary).split(' ').length === 10, '真机 1 号记录按空格全切是 10 段（路径里带空格，旧写法要求恰好 9 段）')
  const oldSplitBySpace = function (record) { return String(record).split(' ').length === 9 ? { ok: true } : { ok: false, error: 'status-malformed', detail: '1 记录字段数不是 9' } }
  const ob = oldSplitBySpace(firstOrdinary)
  check(ob.ok === false, '反证：按空格全切并数段数的旧写法在这条真机记录上必须判红（' + (ob.ok === false ? ob.detail : '它居然过了') + '）')
  const ll = log.parseLog(live.log.out)
  check(ll.ok === true && ll.commits.length === 1 && ll.commits[0].subject.indexOf('首次提交') === 0, '真机 log 解开中文标题与八字段')
  const lw = worktrees.parseWorktrees(live.worktrees.out, true)
  check(lw.ok === true && lw.worktrees.length === 1 && lw.worktrees[0].branch === 'main', '真机 worktree 清单解出')
  const lr = refs.parseRefs(live.refs.out)
  check(lr.ok === true && lr.refs.some((r) => r.short === 'main' && r.current === true), '真机 refs 解出当前分支')

  // 反证：把被守的口径改回去（解析器只认「计数头独占字段」一种形状）——旧实现在这份真机字节上必须当场失败。
  const oldSingleShape = function (stdout) {
    const text = String(stdout)
    if (text === '') return { ok: true, files: [] }
    const fields = text.split('\0')
    if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
    const HEAD_RE = /^(\S+)\t(\S+)\t?$/
    const out = []
    let i = 0
    while (i < fields.length) {
      const m = HEAD_RE.exec(fields[i]); i += 1
      if (!m) return { ok: false, error: 'diff-files-malformed', detail: '计数头不是 两数+TAB' }
      if (i >= fields.length) return { ok: false, error: 'diff-files-malformed', detail: '缺路径字段' }
      const p1 = fields[i]; i += 1
      let path = p1; let orig = null
      if (i < fields.length && !HEAD_RE.test(fields[i])) { orig = p1; path = fields[i]; i += 1 }
      out.push({ path: path, origPath: orig, added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]) })
    }
    return { ok: true, files: out }
  }
  const od = oldSingleShape(liveNumstat)
  check(od.ok === false, '反证：只认单一形状的旧解析器在真机样本上必须被判红（' + (od.ok === false ? od.detail : '它居然解出了 ' + od.files.length + ' 条') + '）')
  check(oldSingleShape('0\t0\t\0old.txt\0new.txt\0').ok === true, '反证对照：旧解析器仍认重命名形状（说明它错的正是普通形状，不是整体坏掉）')

  // ---- 3.7) #817 第二轮：补丁的六种真机头行（样本 live:true，按文件逐个采）----
  const livePatch = readJson('version-control-core/fixtures/live-patch-shapes.json')
  check(livePatch.source.live === true && livePatch.patches.combined.code === 0, '真机补丁样本带 live 标记与退出码')
  for (const k of ['modified', 'added', 'deleted', 'modeChanged', 'renamed', 'binary', 'combined']) {
    const pr = patch.parsePatch(livePatch.patches[k].out)
    check(pr.ok === true, '真机补丁形态解出：' + k + (pr.ok === true ? '' : ' —— ' + pr.error + '：' + pr.detail))
  }
  const headOf = (caseName) => { const pr = patch.parsePatch(livePatch.patches[caseName].out); return pr.ok === true ? pr.lines.filter((l) => l.kind === 'filehead').map((l) => l.text) : [] }
  check(headOf('added').some((t) => t.indexOf('new file mode ') === 0), '新增：new file mode 行算结构行')
  check(headOf('deleted').some((t) => t.indexOf('deleted file mode ') === 0), '删除：deleted file mode 行算结构行')
  check(headOf('modeChanged').some((t) => t.indexOf('old mode ') === 0) && headOf('modeChanged').some((t) => t.indexOf('new mode ') === 0), '模式变更：old/new mode 行算结构行')
  const combinedHeads = headOf('combined')
  check(combinedHeads.some((t) => t.indexOf('similarity index ') === 0) && combinedHeads.some((t) => t.indexOf('rename from ') === 0) && combinedHeads.some((t) => t.indexOf('rename to ') === 0), '重命名：similarity index 与 rename from/to 行算结构行')
  check(combinedHeads.some((t) => t.indexOf('Binary files ') === 0), '二进制：Binary files 行算结构行')
  check(combinedHeads.some((t) => t.indexOf('new file mode ') === 0) && combinedHeads.some((t) => t.indexOf('deleted file mode ') === 0) && combinedHeads.some((t) => t.indexOf('old mode ') === 0), '全量补丁里六种头行同时在（新增/删除/模式变更/重命名/二进制/普通）')
  // 形状严格没放松：仍然认不出的行首字符必须显式失败
  const stillStrict = patch.parsePatch('diff --git a b\nZ 这一行的行首字符谁也不认\n')
  check(stillStrict.ok === false && stillStrict.error === 'patch-malformed', '形状严格不变：未知行首字符仍显式失败')
  // 反证：旧的补丁解析器（只认普通修改那几种头行）在这些真机样本上必须当场判红
  const oldPatchParser = function (stdout) {
    const raw = String(stdout).split('\n')
    if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
    const out = []
    for (const ln of raw) {
      if (ln.startsWith('@@')) out.push('hunk')
      else if (ln.startsWith('diff --git ') || ln.startsWith('index ') || ln.startsWith('--- ') || ln.startsWith('+++ ')) out.push('filehead')
      else if (ln.startsWith('\\ ')) out.push('no-newline')
      else if (ln.startsWith('+')) out.push('add')
      else if (ln.startsWith('-')) out.push('del')
      else if (ln.startsWith(' ') || ln === '') out.push('context')
      else return { ok: false, error: 'patch-malformed', detail: '未知差异行首字符' }
    }
    return { ok: true, lines: out }
  }
  const oldFailures = ['added', 'deleted', 'modeChanged', 'renamed', 'binary', 'combined'].filter((k) => oldPatchParser(livePatch.patches[k].out).ok === false)
  check(oldFailures.length >= 5, '反证：旧的补丁解析器在真机样本上必红（实红 ' + oldFailures.length + ' 种：' + oldFailures.join('、') + '）')

  // ---- 3.8) #817 第二轮：游离头工作树的身份要按路径认，不能按 oid 猜 ----
  const DETACH_OID = 'a'.repeat(40)
  const mkWorktree = (p, branch) => ({ path: p, head: DETACH_OID, branch: branch, bare: false, detached: branch === null, locked: false, lockReason: null, prunable: false, prunableReason: null })
  const twoWorktrees = [mkWorktree('D:/repo', 'main'), mkWorktree('D:/repo-detached', null)]
  const detachedInput = (root) => ({
    repoRoot: root, bare: false, statusHead: '(detached)', statusDetached: true, statusOid: DETACH_OID,
    statusUpstream: null, statusAhead: 0, statusBehind: 0, statusEntries: [], worktrees: twoWorktrees, refs: [], commits: [], diffFiles: [],
    merging: false, rebasing: false, cherryPicking: false, reverting: false, tier: 'full', autocrlf: null, nowMs: 0, basisMs: null,
  })
  const d1 = state.assemble(detachedInput('D:/repo-detached'))
  check(d1.ok === true && d1.screen.identity.worktreePath === 'D:/repo-detached', '游离头与主工作树同一提交时：身份命中游离那棵（实得 ' + (d1.ok === true ? d1.screen.identity.worktreePath : '失败') + '）')
  check(d1.ok === true && d1.screen.otherWorktrees.length === 1 && d1.screen.otherWorktrees[0].path === 'D:/repo', '「其他工作树」把当前那棵排除掉')
  check(d1.ok === true && d1.screen.identity.worktreeDisplay === 'repo-detached', '显示名跟着当前那棵走（最短唯一后缀下标一致）')
  const d2 = state.assemble(detachedInput('d:\\repo-detached\\'))
  check(d2.ok === true && d2.screen.identity.worktreePath === 'D:/repo-detached', '路径归一化：反斜杠、尾斜杠、盘符大小写不同也算同一棵')
  const d3 = state.assemble(detachedInput('D:/repo'))
  check(d3.ok === true && d3.screen.identity.worktreePath === 'D:/repo' && d3.screen.otherWorktrees[0].path === 'D:/repo-detached', '主工作树情形不回归：按路径命中主工作树')
  const d4 = state.assemble(detachedInput('D:/不在工作树清单里'))
  check(d4.ok === true && d4.screen.identity.worktreePath === 'D:/repo', '路径对不上时退回原来的 oid 退路（不在清单里也要有答案）')
  // 反证：旧的「游离就按 oid find」写法必须判红
  const oldDetachedPick = function (worktrees, oid) { const hit = worktrees.find((w) => w.head === oid); return hit ? hit.path : null }
  check(oldDetachedPick(twoWorktrees, DETACH_OID) === 'D:/repo', '反证：只按 oid 找会命中主工作树（旧写法在这条用例上必红）')

  // ---- 4) 首屏组装：一次读全成败一起 ----
  if (cs.ok === true && cw.ok === true && cr.ok === true && cl.ok === true && cd.ok === true) {
    const asm = state.assemble({
      repoRoot: 'D:/dsh-plugin/dsh-mattpocock-skills-deck', bare: false,
      statusHead: cs.branch.head, statusDetached: cs.branch.detached, statusOid: cs.branch.oid,
      statusUpstream: cs.branch.upstream, statusAhead: cs.branch.ahead, statusBehind: cs.branch.behind,
      statusEntries: cs.entries, worktrees: cw.worktrees, refs: cr.refs,
      commits: cl.commits, diffFiles: cd.files,
      merging: false, rebasing: false, cherryPicking: false, reverting: false,
      tier: 'full', autocrlf: clean.autocrlf.out.trim() || null, nowMs: Date.now(), basisMs: null,
    })
    check(asm.ok === true, '首屏组装成功（成败一起，不各自降级）')
    if (asm.ok === true) {
      check(asm.screen.identity.branch === 'main' && asm.screen.branches.length >= 1, '身份行分支 main 且分支列表非空')
      check(asm.screen.identity.sync === 'tracked-unknown', '依据时间未知判 tracked-unknown（#819 收口改名：unknown 是「不知道新不新」，不设新旧阈值）')
    }
  } else {
    check(false, '首屏组装前置解析全过')
  }
  const edge = readJson('version-control-core/fixtures/edge-cases.json')
  // ---- 5) 边界：游离、零提交、上游被删、旧版、新版锁、空历史、补丁、截断 ----
  const det = status.parseStatus(edge.detachedStatus)
  check(det.ok === true && det.branch.detached === true, '游离头指针判出（不误报成分支）')
  const zero = status.parseStatus(edge.zeroStatus)
  check(zero.ok === true && zero.branch.oid === null, '零提交仓库 oid 为 null（initial）')
  const gone = refs.parseRefs(edge.goneRefs)
  check(gone.ok === true && gone.refs[0].upstreamGone === true, '上游被删 [gone] 单独成态')
  const wo = worktrees.parseWorktrees(edge.wtOldNonZ, false)
  check(wo.ok === true && wo.worktrees.length === 2 && wo.worktrees[1].locked === false, '旧版非 -z 无锁标记（答不出，不是没锁）')
  const wn = worktrees.parseWorktrees(edge.wtNewZ, true)
  check(wn.ok === true && wn.worktrees[1].locked === true && !!wn.worktrees[1].lockReason, '新版锁标记与原因解出')
  const le = log.parseLog(edge.logEmpty)
  check(le.ok === true && le.commits.length === 0, '零提交历史为空（退出 0，不报错）')
  const pp = patch.parsePatch(edge.patch)
  check(pp.ok === true && pp.lines.some((l) => l.kind === 'no-newline'), '补丁逐行分类含末尾无换行')
  const tr = status.parseStatus(edge.truncatedStatus)
  check(tr.ok === false && tr.error === 'status-malformed', '截断半截显式失败（不装作成功）')

  // ---- 6) 显示判据 ----
  check(JSON.stringify(state.shortestUniqueSuffix(['D:/a/同名', 'D:/b/同名'])) === JSON.stringify([2, 2]), '撞名显示名自动加长')
  check(state.displayFor('D:/a/同名', 1) === '同名', '平时只显示熟悉的末段')
  check(state.foldMiddle('src/very/long/path/to/file.txt', 20).endsWith('file.txt'), '路径折叠砍中段、文件名端保留')

  // ---- 6.5) #819 复审：砍字按 Unicode 码点，不按 UTF-16 码元（emoji 不许切出半个代理项）----
  const loneSurrogate = (s) => {
    const t = String(s)
    for (let i = 0; i < t.length; i += 1) {
      const c = t.charCodeAt(i)
      if (c >= 0xD800 && c <= 0xDBFF) { const n = t.charCodeAt(i + 1); if (!(n >= 0xDC00 && n <= 0xDFFF)) return true; i += 1 }
      else if (c >= 0xDC00 && c <= 0xDFFF) return true
    }
    return false
  }
  // 两条 emoji 路径：一条 emoji 在开头（切头那一段最容易切进代理对），一条 emoji 在结尾（切尾那一段同理）。
  const emojiPaths = ['😀😀😀😀😀😀😀😀😀😀/很长的目录/文.txt', '目录/子目录/文件名😀😀😀😀😀😀😀😀.txt']
  const badNs = []
  const lenBadNs = []
  for (const p of emojiPaths) {
    const cpLen = Array.from(p).length
    for (let n = 10; n <= 60; n += 1) {
      const out = state.foldMiddle(p, n)
      if (loneSurrogate(out)) badNs.push(p.slice(0, 6) + ' @' + n)
      if (cpLen > n && Array.from(out).length !== n) lenBadNs.push(p.slice(0, 6) + ' @' + n)
    }
  }
  check(badNs.length === 0, 'emoji 路径砍中段：10 到 60 每一档都不出落单代理项' + (badNs.length ? ' —— 出问题的档：' + badNs.slice(0, 6).join('、') : ''))
  check(lenBadNs.length === 0, '砍完的串按码点数正好等于 maxLen（长度不变量按码点算）' + (lenBadNs.length ? ' —— 不符的档：' + lenBadNs.slice(0, 6).join('、') : ''))
  check(state.foldMiddle('😀😀😀😀😀😀😀😀😀😀/文.txt', 12) === '😀😀😀😀😀…/文.txt', '审查者报的那一例：😀×10/文.txt @12 是五个完整 emoji + 省略号 + /文.txt')
  // 反证一：旧的按 UTF-16 码元切的写法，在同一批输入上必然切出落单代理项（改回旧写法这条门禁会当场红）。
  const oldFoldByUnits = (p, maxLen) => {
    const s = String(p)
    if (s.length <= maxLen || maxLen < 10) return s
    const keep = maxLen - 1
    const headLen = Math.ceil(keep * 0.4)
    return s.slice(0, headLen) + '…' + s.slice(s.length - (keep - headLen))
  }
  const oldBadNs = []
  for (const p of emojiPaths) for (let n = 10; n <= 60; n += 1) if (loneSurrogate(oldFoldByUnits(p, n))) oldBadNs.push(n)
  check(oldBadNs.length > 0, '反证：按 UTF-16 码元切的旧写法确实会切出落单代理项（实红 ' + oldBadNs.length + ' 档，例如 @' + oldBadNs.slice(0, 6).join('、@') + '）')
  check(state.foldMiddle(emojiPaths[0], 12) !== oldFoldByUnits(emojiPaths[0], 12), '反证：第 12 档上新旧结果不同（门禁守着的是真的会变的那一段）')
  // 反证二：全是 BMP 的输入上，新旧两种算法必须逐字一致——这次只动了星空平面字符那一段。
  const bmpSame = ['src/very/long/path/to/file.txt', 'D:/很长的目录/子目录/文件名.txt', '短.txt', 'x'.repeat(60) + '/y.txt']
    .every((p) => [10, 12, 20, 24, 46, 80].every((n) => state.foldMiddle(p, n) === oldFoldByUnits(p, n)))
  check(bmpSame, '反证二：全是 BMP 的输入上新旧结果逐字一致（不是顺手改错了别的）')

  const rel = state.describeTime(1000000, 1000000 - 3600000)
  check(rel.style === 'relative', '一周内相对写法')
  check(state.describeTime(1000000 + 8 * 24 * 3600 * 1000, 1000000).style === 'absolute', '更早绝对写法')


  // ---- 6.6) #819 复审批次：路径按字面量解释、补丁行首歧义、答不出的可清理、冲突不重复计数、路径比对归一 ----
  const review = readJson('version-control-core/fixtures/live-819-review-shapes.json')
  check(review.source.live === true, '复审真机样本带 live 标记（' + review.source.gitVersion + '）')
  const wtOf = (p, branch) => ({ path: p, head: 'a'.repeat(40), branch: branch, bare: false, detached: false, locked: false, lockReason: null, prunable: false, prunableReason: null })
  const assembleWith = (over) => state.assemble(Object.assign({
    repoRoot: 'D:/repo', bare: false, statusHead: 'main', statusDetached: false, statusOid: 'a'.repeat(40),
    statusUpstream: 'origin/main', statusAhead: 0, statusBehind: 0, statusEntries: [], worktrees: [], refs: [], commits: [], diffFiles: [],
    merging: false, rebasing: false, cherryPicking: false, reverting: false, tier: 'full', autocrlf: null, nowMs: 0, basisMs: Date.now() - 1000,
  }, over))

  // P0-1 方括号路径：固定前缀里的字面量开关 + 真机样本对照
  check(commands.fixedPrefix().includes('--literal-pathspecs'), '固定前缀含 --literal-pathspecs（方括号路径不许当通配，P0-1）')
  check(commands.commandFor('patch', { patchPath: '方括号[1].txt' }).args[0] === 'diff', '字面量开关在固定前缀里，不混进 commandFor 的参数（参数表只描述子命令本身）')
  const namedCount = (t) => (String(t).match(/^diff --git /gm) || []).length
  check(namedCount(review.bracket.patchWithLiteral.out) === 1 && namedCount(review.bracket.patchWithoutLiteral.out) === 2,
    '真机样本：点名一个文件时带开关只回它、不带开关连另一个一起回（' + namedCount(review.bracket.patchWithLiteral.out) + ' / ' + namedCount(review.bracket.patchWithoutLiteral.out) + ' 段）')

  // P1-4 补丁行首歧义：删除行内容以 -- 开头、新增行内容以 ++ 开头
  const sqlParsed = patch.parsePatch(review.sql.patch.out)
  check(sqlParsed.ok === true, 'sql 真机补丁解出（' + (sqlParsed.ok === true ? sqlParsed.lines.length + ' 行' : sqlParsed.detail) + '）')
  if (sqlParsed.ok === true) {
    const kindOf = (t) => (sqlParsed.lines.filter((l) => l.text === t)[0] || {}).kind
    check(kindOf('--- 注释一') === 'del' && kindOf('+++ 新的注释') === 'add',
      '行首歧义：删除行按 del、新增行按 add（实得 ' + kindOf('--- 注释一') + ' / ' + kindOf('+++ 新的注释') + '）')
    check(kindOf('--- sql.txt') === 'filehead' && kindOf('+++ sql.txt') === 'filehead', '真正的两个头行在第一个 @@ 之前，照旧算 filehead')
  }
  // 反证：按前缀先判的旧写法会把这两行当文件头（改回去门禁当场红）
  const oldPatchByPrefix = function (stdout) {
    const raw = String(stdout).split('\n')
    if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
    const out = []
    for (const ln of raw) {
      if (ln.startsWith('@@')) out.push({ kind: 'hunk', text: ln })
      else if (ln.startsWith('diff --git ') || ln.startsWith('index ')) out.push({ kind: 'filehead', text: ln })
      else if (ln.startsWith('--- ') || ln.startsWith('+++ ')) out.push({ kind: 'filehead', text: ln })
      else if (ln.startsWith('\u005c ')) out.push({ kind: 'no-newline', text: ln })
      else if (ln.startsWith('+')) out.push({ kind: 'add', text: ln })
      else if (ln.startsWith('-')) out.push({ kind: 'del', text: ln })
      else if (ln.startsWith(' ') || ln === '') out.push({ kind: 'context', text: ln })
      else return { ok: false, error: 'patch-malformed', detail: '未知差异行首字符' }
    }
    return { ok: true, lines: out }
  }
  const oldSql = oldPatchByPrefix(review.sql.patch.out).lines.filter((l) => l.text === '--- 注释一')[0]
  check(!!oldSql && oldSql.kind === 'filehead', '反证：旧的前缀优先写法把删除行当文件头（实得 ' + (oldSql && oldSql.kind) + '），新门禁会当场逮住')

  // P0-2 冲突不重复计数 + P2-7 未跟踪按未暂折算
  if (ds.ok === true) {
    const dirty = assembleWith({ statusEntries: ds.entries })
    const unmergedPath = (ds.entries.filter((e) => e.kind === 'unmerged')[0] || {}).path
    const inStaged = dirty.screen.staged.filter((f) => f.path === unmergedPath)
    const inUnstaged = dirty.screen.unstaged.filter((f) => f.path === unmergedPath)
    const conflictRow = inStaged.concat(inUnstaged)[0]
    check(inStaged.length === 0 && inUnstaged.length === 1 && !!conflictRow && conflictRow.conflict === true && conflictRow.staged === false && conflictRow.unstaged === false,
      '冲突文件只在工作区那一边出现一次、两个标记都是 false（P0-2）')
    const rows = dirty.screen.staged.concat(dirty.screen.unstaged)
    check(rows.filter((f) => f.staged || f.unstaged).every((f) => f.conflict !== true), '冲突行两个计数都不占（没有任何冲突行带已暂存/未暂存标记）')
    check(dirty.screen.stagedCount === rows.filter((f) => f.staged).length && dirty.screen.unstagedCount === rows.filter((f) => f.unstaged).length,
      '两个计数按标记算，不按数组长度算（实得 ' + dirty.screen.stagedCount + '/' + dirty.screen.unstagedCount + '，共 ' + rows.length + ' 行）')
    const untrackedRow = rows.filter((f) => f.change === 'untracked')[0]
    check(!!untrackedRow && untrackedRow.unstaged === true, '未跟踪条目按「未暂存的改动」置真（P2-7）')
    const ue = ds.entries.filter((e) => e.kind === 'unmerged')[0]
    const oldStaged = ue.x !== '.' && ue.x !== '?' && ue.x !== '!'
    const oldUnstaged = ue.y !== '.' && ue.y !== '?' && ue.y !== '!'
    check(oldStaged === true && oldUnstaged === true, '反证：按 x/y 原样算标记的旧写法会把冲突文件同时算进两组（实得 ' + oldStaged + '/' + oldUnstaged + '）')
  } else {
    check(false, '冲突用例的前置：脏仓库 status 解出')
  }

  // P1-5 降级档答不出「可清理」
  const twoWt = [wtOf('D:/repo', 'main'), wtOf('D:/repo-linked', 'other')]
  const degAsm = assembleWith({ worktrees: twoWt, tier: 'degraded' })
  check(degAsm.ok === true && degAsm.screen.otherWorktrees.length === 1 && degAsm.screen.otherWorktrees[0].prunable === false && degAsm.screen.otherWorktrees[0].prunableUnknown === true,
    '降级档（2.11–2.30）答不出可清理：prunableUnknown 真、prunable 不冒充 false（P1-5）')
  const fullAsm = assembleWith({ worktrees: twoWt, tier: 'full' })
  check(fullAsm.ok === true && fullAsm.screen.otherWorktrees[0].prunableUnknown === false, '完整档确实答得出：prunableUnknown 假')

  // P2-6 路径比对走同一个归一函数
  // 末段同名（真正要加长才分得开）的两棵工作树，当前那棵的写法与调用方给的写法不一致。
  const mixedWt = [wtOf('D:/a/同名', 'main'), wtOf('D:\\b\\同名\\', 'other')]
  const mixedAsm = assembleWith({ repoRoot: 'd:/b/同名', statusHead: 'other', worktrees: mixedWt })
  check(mixedAsm.ok === true && mixedAsm.screen.otherWorktrees.length === 1 && mixedAsm.screen.otherWorktrees[0].path === 'D:/a/同名',
    '当前工作树按归一后的路径判：其他工作树里不许再出现它（实得 ' + (mixedAsm.ok === true ? mixedAsm.screen.otherWorktrees.length : '失败') + ' 棵，P2-6）')
  check(mixedAsm.ok === true && mixedAsm.screen.identity.worktreeDisplay === 'b/同名',
    '显示名用的是归一后算出的最短唯一后缀长度（实得 ' + (mixedAsm.ok === true ? mixedAsm.screen.identity.worktreeDisplay : '失败') + '——按原始字符串找下标会退化成 1 段「同名」）')
  const oldOthers = mixedWt.filter((w) => w.path !== 'd:/b/同名')
  check(oldOthers.length === 2, '反证：当前工作树写法与清单不一致时，按原始字符串比较会把当前那棵也列进「其他工作树」（实得 ' + oldOthers.length + ' 棵）')

  // ---- 7) 断言装置自检：改坏样本必须红 ----
  const badStatus = status.parseStatus('1 M. N... 100644')
  check(badStatus.ok === false, '自检：字段数不对必须失败')
  const badHead = status.parseStatus('X oops')
  check(badHead.ok === false, '自检：未知行首字符必须失败')
  const badHash = refs.parseRefs('refs/heads/a\0a\0xyz\0\0\0 \0' + '2026-10-02T16:02:31+08:00')
  check(badHash.ok === false, '自检：非哈希 objectname 必须失败')
  const badLog = log.parseLog('a\0b\0c')
  check(badLog.ok === false, '自检：字段总数非法必须失败')
  const badStep = state.classifyStepZero(128, '', 'fatal: not a git repository (or any of the parent directories): .git')
  check(badStep.ok === true && badStep.kind === 'not-repo', '自检：非仓库exit128 判 not-repo')

  console.log(failed ? '\n存在失败 — verify-version-control-parsers 未通过' : '\n全部通过 — 解析器门禁生效（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('门禁执行异常：' + ((e && e.stack) || e))
  process.exit(1)
})
