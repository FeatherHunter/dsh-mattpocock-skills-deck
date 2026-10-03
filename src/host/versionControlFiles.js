// src/host/versionControlFiles.js —— 按需取差异那一条电话的处理体：wf.gitDiff（#817 落地，#821 扩展）
//
// 为什么单独成一个文件：src/host/versionControl.js 已经贴着文件粒度门禁的 350 行上限（正好 350 行），
// 这一条电话要长出「看某一次提交改了什么」这一半就放不下了。照仓库惯例（#500 把三组电话体搬到
// logPhones.js、#548 把读取器拆到 updateReader.js）把整条电话体搬成一个自包含叶子，父文件只留一行
// 动态加载器。起进程的唯一出口 runPinned、失败信封 failPhone、仓库根解析 resolveRepoRoot 等全部由
// 父文件显式传进来，所以整个仓库仍然只有一条起 git 进程的路；本文件不引用父文件（单向引用）。
//
// 两种读法（同一套界面、同一套解析器，只有取的命令不同）：
//   · 不带 rev：工作区相对 HEAD 的差异（与 #817 落地时一模一样）；
//   · 带 rev（十六进制提交号）：那一次提交改了什么 —— 不带 path 给「这次提交改了哪些文件」的清单，
//     带 path 给「这次提交里这个文件」的补丁。
// 提交号的形状真源在核心的 REV_PATTERN：不合形状的一律当场拒绝，绝不把它拼进 git 命令行。
//
// 真机核到的两条事实（样本 version-control-core/fixtures/live-rev-shapes.json，git 2.49.0.windows.1）：
//   · git show --numstat 对合并提交给的是「相对第一个父提交」的行数，不空，是真数据；
//   · git show -p 对合并提交走组合差异、默认不展开，输出为空。
// 所以「空输出」在带 rev 的补丁那一路上有两种意思，必须分开说：那一次提交本来就是空提交 → no-diff；
// 那一次提交是合并提交 → merge-commit（git 不展开它，界面照实说，绝不写成「没有改动」）。
import { commandFor, REV_PATTERN } from '../shared/version-control/commands.js'
import { parseDiffFiles } from '../shared/version-control/parse-diff-files.js'
import { parsePatch } from '../shared/version-control/parse-patch.js'

/** 造这条电话的处理体。依赖全部由父文件 createVersionControl 显式传入，本文件不自取任何环境。 */
export function createGitDiffPhone(deps) {
  const { failPhone, runPinned, failureFromExec, resolveGitExecutable, resolveRepoRoot, readHasHead, cwdOf, patchLimit } = deps

  /** 回包补上「这一次问的是哪个提交号」（界面拿它跟请求对齐）；不带 rev 时不加这个字段，回包与从前一字不差。 */
  function withRev(env, rev) { if (rev === '') return env; return Object.assign({ rev: rev }, env) }

  /** 一次提交的提交号与父提交清单：一条命令同时回答「仓库里有没有这个提交号」与「它是不是合并提交」。 */
  async function readCommitShape(exe, root, rev) {
    const res = await runPinned(exe, root, ['rev-list', '--parents', '-n', '1', rev], { stdoutLimit: 8192 })
    if (res.kind === 'timeout' || res.kind === 'spawn-failed') return { ok: false, envelope: failureFromExec(res, '确认这一次提交这一步') }
    if (res.kind !== 'ok') return { ok: false, envelope: failPhone('args', '这个提交号在当前仓库里找不到：' + rev) }
    const fields = String(res.stdout).replace(/\r/g, '').trim().split(/\s+/).filter(function (s) { return s !== '' })
    const oid = fields[0] || ''
    // 完整提交号是 40 位（SHA-256 仓库是 64 位）：形状不对就当这一步没读成，不拿它往下走。
    if (!/^[0-9a-fA-F]{40,64}$/.test(oid)) return { ok: false, envelope: failPhone('parse', '读出来的提交号不像一个提交号：' + oid.slice(0, 80)) }
    return { ok: true, oid: oid, parents: fields.slice(1) }
  }

  /** 把一次补丁命令的结果翻成回包（带不带 rev 两条路共用，只有失败说明的措辞不同）。 */
  function patchEnvelope(res, path, rev, what) {
    const bad = failureFromExec(res, what)
    if (bad) return bad
    // 读不全就明说读不全：截断留下的是尾巴，切出来的会是半截补丁，这里一片都不给。
    if (res.truncated) return withRev({ ok: true, path: path, lines: [], truncated: true, reason: 'truncated', limitBytes: patchLimit }, rev)
    if (res.stdout === '') return withRev({ ok: true, path: path, lines: [], truncated: false, reason: 'no-diff' }, rev)
    if (/^Binary files /m.test(res.stdout) || /^GIT binary patch$/m.test(res.stdout)) return withRev({ ok: true, path: path, lines: [], truncated: false, reason: 'binary-diff' }, rev)
    const parsed = parsePatch(res.stdout)
    if (parsed.ok !== true) return failPhone('parse', '这个文件的差异解析失败：' + parsed.detail)
    return withRev({ ok: true, path: path, lines: parsed.lines, truncated: false, reason: 'ok' }, rev)
  }

  /** 看某一次提交改了什么：带 path 给这个文件的补丁，不带 path 给「这次提交改了哪些文件」的清单。 */
  async function commitDiff(exe, base, rev, path) {
    const shape = await readCommitShape(exe, base.root, rev)
    if (shape.ok !== true) return shape.envelope
    if (path !== '') {
      const res = await runPinned(exe, base.root, commandFor('patch', { patchPath: path, rev: rev }).args, { stdoutLimit: patchLimit })
      const bad = failureFromExec(res, '取这一次提交里这个文件的差异这一步')
      if (bad) return bad
      // 合并提交的补丁 git 默认不展开（空输出）：这时说 merge-commit，绝不说成「这个文件没有改动」。
      if (!res.truncated && res.stdout === '' && shape.parents.length > 1) return withRev({ ok: true, path: path, lines: [], truncated: false, reason: 'merge-commit' }, rev)
      return patchEnvelope(res, path, rev, '取这一次提交里这个文件的差异这一步')
    }
    const res = await runPinned(exe, base.root, commandFor('diffFiles', { rev: rev }).args)
    const bad = failureFromExec(res, '读这一次提交改了哪些文件这一步')
    if (bad) return bad
    // 读不全就明说读不全，绝不假装完整（契约：ok + truncated + 空清单 + reason=truncated）。
    if (res.truncated) return withRev({ ok: true, files: [], truncated: true, reason: 'truncated' }, rev)
    const parsed = parseDiffFiles(res.stdout)
    if (parsed.ok !== true) return failPhone('parse', '这一次提交改了哪些文件解析失败：' + parsed.detail)
    if (parsed.files.length === 0) return withRev({ ok: true, files: [], truncated: false, reason: 'no-diff' }, rev)
    return withRev({ ok: true, files: parsed.files, truncated: false, reason: 'ok' }, rev)
  }

  /** 电话 wf.gitDiff 的处理体：不带 rev 看工作区，带 rev 看某一次提交；错误信封与从前同一份。 */
  async function handleGitDiff(args) {
    const rev = (args && typeof args.rev === 'string') ? args.rev : ''
    const path = (args && typeof args.path === 'string') ? args.path : ''
    // 提交号只许是十六进制：不合形状的一律当场拒绝（看不懂的 rev 绝不忽略、绝不当 git 选项拼进命令行）。
    if (rev !== '' && !REV_PATTERN.test(rev)) return failPhone('args', '提交号只能是 4 到 64 位十六进制字符，这一条给的不是：' + rev.slice(0, 64))
    if (rev === '') {
      if (!path || path.indexOf('\u0000') >= 0) return failPhone('args', '取差异要知道是哪个文件（path），这一条没给')
    } else if (path.indexOf('\u0000') >= 0) return failPhone('args', '文件路径里不许有 NUL 字符，这一条给的不是一个正常的路径')
    const exe = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    // 未跟踪的文件没有可比基线（对 HEAD 求差异恒为空）。界面在首屏里已经知道它是未跟踪，把这件事原样带过来，
    // 这里直说，不去起一条进程拿一份空差异冒充「没有改动」；带 rev 时看的是提交里的那一份，未跟踪这个说法不适用。
    if (rev === '' && args && args.untracked === true) return { ok: true, path: path, lines: [], truncated: false, reason: 'untracked-no-diff' }
    const base = await resolveRepoRoot(exe, cwdOf(args))
    if (base.ok !== true) return base
    // 带 rev 的两条路不需要工作树，裸仓库也能看提交之间改了什么。
    if (rev !== '') return await commitDiff(exe, base, rev, path)
    if (base.kind === 'bare') return failPhone('args', '裸仓库没有工作树，取不了文件差异')
    const hasHead = await readHasHead(exe, base.root)
    if (hasHead === null) return failPhone('env', '问不出这个仓库有没有第一次提交，取差异这一步做不了')
    if (hasHead === false) return { ok: true, path: path, lines: [], truncated: false, reason: 'no-commit-baseline' }
    const res = await runPinned(exe, base.root, commandFor('patch', { patchPath: path }).args, { stdoutLimit: patchLimit })
    return patchEnvelope(res, path, '', '取这个文件的差异这一步')
  }

  return handleGitDiff
}
