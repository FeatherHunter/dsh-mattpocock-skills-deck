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
      check(asm.screen.identity.sync === 'tracked-stale', '依据时间未知判 tracked-stale（不设新旧阈值）')
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
  const rel = state.describeTime(1000000, 1000000 - 3600000)
  check(rel.style === 'relative', '一周内相对写法')
  check(state.describeTime(1000000 + 8 * 24 * 3600 * 1000, 1000000).style === 'absolute', '更早绝对写法')

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
