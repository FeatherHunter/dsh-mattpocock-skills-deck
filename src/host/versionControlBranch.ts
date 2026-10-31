// host/versionControlBranch.ts —— 域 4（分支与标签）的宿主电话（#1746 T11）
//
// 住在自包含叶子里，依赖全部由 ../versionControl.js 显式传入（与版本管理其它电话同一先例）：
//   - 读电话 wf.gitBranches 一次取回分支列表（4.1）、标签列表（4.9）、已并入/没并入（4.8）、
//     全部分支说明（4.13 的读部分）与当前分支标记；界面只读这一份，不按行再开枪。
//   - 写电话 wf.gitBranchWrite 按 kind 分派十种写动作（4.2–4.7、4.10、4.11、4.12、4.13 的写部分）。
//     每个动作先读当前状态、用共享层 branch-decisions.ts 的纯函数判定；block 直接拒（禁用原因原样回），
//     warn 必须带 confirmed 才执行（确认卡贴在触发点）。dryRun 只回判定与确认卡四段素材，不执行。
//   - 所有 git 调用经 runPinned（-C 钉死目录、固定前缀、GIT_EDITOR=必失败命令、字节上限、超时、报闸）。
//
// 口径：失败显示 git 原话与环节名；验签退出码非零是「没验过」的读数结论，不是电话失败（4.12 不许冒充成功）；
//   drop / 删除类失败说清动没动（git 自己失败就什么都没动，原话照实回）。
import { commandFor, tagListArgs, tagDeleteArgs, tagCreateArgs, branchCreateArgs, branchCreateCheckoutArgs,
  branchSwitchArgs, branchSwitchCheckoutArgs, branchDetachArgs, branchDetachCheckoutArgs, branchRenameArgs,
  branchDeleteArgs, setUpstreamArgs, unsetUpstreamArgs, mergedBranchesArgs, branchDescriptionsArgs,
  branchDescriptionSetArgs, branchDescriptionUnsetArgs, verifyCommitArgs, verifyTagArgs } from '../shared/version-control/commands.js'
import { parseRefs } from '../shared/version-control/parse-refs.js'
import { parseTagList, parseBranchNameList, parseBranchDescriptions } from '../shared/version-control/parse-branch.js'
import { branchNameProblem, tagNameProblem, upstreamNameProblem, decideBranchSwitch, decideBranchDelete,
  decideBranchCreate, decideTagCreate, decideDescriptionWrite, branchReasonText } from '../shared/version-control/branch-decisions.js'

export const BRANCH_BOARD_CONTRACT = 'version-control.branch-board'
export const BRANCH_BOARD_VERSION = 1

export function createBranchPhones(deps: any): any {
  const failPhone: any = deps.failPhone
  const firstLine: any = deps.firstLine
  const failureFromExec: any = deps.failureFromExec
  const runPinned: any = deps.runPinned
  const resolveGitExecutable: any = deps.resolveGitExecutable
  const resolveRepoRoot: any = deps.resolveRepoRoot
  const cwdOf: any = deps.cwdOf
  const readScreenOf: any = deps.readScreenOf
  const nowFn: any = (deps && typeof deps.now === 'function') ? deps.now : Date.now

  /** 失败信封：kind 是环节，reason 给固定理由标识符（block 用），git 原话与期望/实际放 extra。 */
  function fail(kind: string, message: string, extra?: any): any {
    const e: any = failPhone(kind, message, extra)
    return e
  }
  function gitSays(res: any): string {
    // firstLine 对空文本会回一句兜底话（不是空串），所以不能写成「a || b」：先判断哪一路真的有内容，再取第一行。
    const say: string = String((res && res.stderr) || '').trim() !== '' ? firstLine(res.stderr) : firstLine(res && res.stdout)
    return say.slice(0, 400)
  }
  /** 失败时把用户最需要的四样都带上：git 原话、环节、期望、实际、上游原因。 */
  function gitFail(res: any, step: string, expected: string, actual: string, cause?: string): any {
    return fail('git-failed', step + '失败：git 原话「' + gitSays(res) + '」', {
      git: gitSays(res), step: step, expected: expected, actual: actual, cause: cause || (res && res.kind) || '',
      exitCode: res && typeof res.exitCode === 'number' ? res.exitCode : null,
    })
  }
  async function baseOf(args: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { fail: fail('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, cwdOf(args))
    if (base.ok !== true) return { fail: base }
    return { exe: exe, root: base.root }
  }
  /** 跑一条只读命令：起进程失败/超时走 failureFromExec，读不全当场判 truncate，非零退出交给调用方决定（有些非零是正常读数）。 */
  async function readOut(exe: any, root: any, what: string, args: string[], allowNonZero?: boolean): Promise<any> {
    const res: any = await runPinned(exe, root, args, { stdoutLimit: 8 * 1024 * 1024 })
    const bad: any = res.kind === 'ok' || (allowNonZero && res.kind === 'non-zero') ? null : failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    return { ok: true, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode }
  }
  async function refsOf(exe: any, root: any): Promise<any> {
    const spec: any = commandFor('refs')
    const r: any = await readOut(exe, root, '读分支清单这一步', spec.args)
    if (r.ok !== true) return r
    const parsed: any = parseRefs(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', '分支清单解析失败：' + parsed.detail) }
    return { ok: true, refs: parsed.refs }
  }
  async function tagsOf(exe: any, root: any): Promise<any> {
    const r: any = await readOut(exe, root, '读标签清单这一步', tagListArgs())
    if (r.ok !== true) return r
    const parsed: any = parseTagList(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', '标签清单解析失败：' + parsed.detail) }
    return { ok: true, tags: parsed.tags }
  }
  async function descriptionsOf(exe: any, root: any): Promise<any> {
    const r: any = await readOut(exe, root, '读分支说明这一步', branchDescriptionsArgs(), true)
    if (r.ok !== true) return r
    // git config --get-regexp 没有命中时退出码是 1：这不是失败，是「一条说明都没配过」。
    // 其它非零退出码（例如配置文件读不了）是真失败：照实报，不能当成「没配过说明」把故障吞掉。
    if (typeof r.exitCode === 'number' && r.exitCode !== 0) {
      if (r.exitCode === 1) return { ok: true, descriptions: {} }
      return { ok: false, envelope: gitFail({ kind: 'non-zero', exitCode: r.exitCode, stderr: r.stderr }, '读分支说明这一步', '读回分支说明，或明确告诉我一条都没配过', '退出码 ' + r.exitCode) }
    }
    const parsed: any = parseBranchDescriptions(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', '分支说明解析失败：' + parsed.detail) }
    return { ok: true, descriptions: parsed.descriptions }
  }
  async function namesOf(exe: any, root: any, which: string, base: string): Promise<any> {
    const r: any = await readOut(exe, root, '读已并入分支这一步', mergedBranchesArgs(which, base))
    if (r.ok !== true) return r
    const parsed: any = parseBranchNameList(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', '已并入分支解析失败：' + parsed.detail) }
    return { ok: true, names: parsed.names }
  }
  function currentBranchOf(refs: any[]): any {
    for (let i: number = 0; i < refs.length; i += 1) if (refs[i] && refs[i].current === true) return refs[i]
    return null
  }
  function flagsOf(screen: any): any {
    const s: any = screen || {}
    return {
      merging: s.repo ? s.repo.merging === true : s.merging === true,
      rebasing: s.repo ? s.repo.rebasing === true : s.rebasing === true,
      cherryPicking: s.repo ? s.repo.cherryPicking === true : s.cherryPicking === true,
      reverting: s.repo ? s.repo.reverting === true : s.reverting === true,
      conflictCount: typeof s.conflictCount === 'number' ? s.conflictCount : 0,
      stagedCount: typeof s.stagedCount === 'number' ? s.stagedCount : 0,
      unstagedCount: typeof s.unstagedCount === 'number' ? s.unstagedCount : 0,
    }
  }
  async function protectionOf(args: any): Promise<any> {
    const screen: any = await readScreenOf(cwdOf(args))
    if (screen && screen.ok === true) return { ok: true, flags: flagsOf(screen.screen) }
    if (screen && screen.ok === false && screen.error && screen.error.kind === 'not-repo') return { ok: true, flags: flagsOf({}) }
    return { ok: false, envelope: screen }
  }
  /** 确认卡四段素材：动词写后果、作用对象，其余两段由界面按同一条文案模板拼。 */
  function confirmOf(kind: string, target: string, verb: string): any {
    return { kind: kind, target: target, verb: verb }
  }
  /** 判定结果统一出口：block 直接拒并带理由；warn 要 confirmed；dryRun 只回判定。 */
  function gate(decision: any, args: any, confirm: any): any {
    if (decision.verdict === 'block') {
      return fail('blocked', branchReasonText(decision.reasons[0]) + '（理由：' + decision.reasons.join('、') + '）', { decision: decision, dryRun: false })
    }
    if (args && args.dryRun === true) return { ok: true, dryRun: true, decision: decision, confirm: confirm }
    if (decision.verdict === 'warn' && (!args || args.confirmed !== true)) {
      return fail('need-confirm', branchReasonText(decision.reasons[0]) + '（理由：' + decision.reasons.join('、') + '）', { decision: decision, dryRun: false })
    }
    return null
  }
  async function execWrite(exe: any, root: any, argv: string[], step: string, expected: string): Promise<any> {
    const res: any = await runPinned(exe, root, argv, { timeoutMs: 120000 })
    if (res.kind !== 'ok') return gitFail(res, step, expected, '退出码 ' + String(res.exitCode))
    return { ok: true, argv: argv, atMs: nowFn() }
  }

  /** 读电话：分支列表 + 标签列表 + 已并入/没并入 + 全部分支说明，一次给全。 */
  async function handleGitBranches(args: any): Promise<any> {
    const b: any = await baseOf(args)
    if (b.fail) return b.fail
    const refs: any = await refsOf(b.exe, b.root)
    if (refs.ok !== true) return refs.envelope
    const tags: any = await tagsOf(b.exe, b.root)
    if (tags.ok !== true) return tags.envelope
    const desc: any = await descriptionsOf(b.exe, b.root)
    if (desc.ok !== true) return desc.envelope
    const current: any = currentBranchOf(refs.refs)
    let merged: any = null
    let notMerged: any = null
    if (current && current.short) {
      const m: any = await namesOf(b.exe, b.root, 'merged', current.short)
      if (m.ok !== true) return m.envelope
      const n: any = await namesOf(b.exe, b.root, 'no-merged', current.short)
      if (n.ok !== true) return n.envelope
      merged = m.names
      notMerged = n.names
    }
    return {
      ok: true,
      contract: BRANCH_BOARD_CONTRACT,
      version: BRANCH_BOARD_VERSION,
      readAtMs: nowFn(),
      current: current ? { name: current.short, oid: current.oid } : null,
      branches: refs.refs.map(function (r: any) { return { name: r.short, oid: r.oid, current: r.current === true, upstream: r.upstream || '', ahead: r.ahead || 0, behind: r.behind || 0, commitDateMs: r.commitDateMs || null } }),
      tags: tags.tags,
      descriptions: desc.descriptions,
      merged: merged,
      notMerged: notMerged,
    }
  }

  /** 写电话：按 kind 分派；每个 kind 都先读状态再判定，dryRun 只回判定。 */
  async function handleGitBranchWrite(args: any): Promise<any> {
    const a: any = args || {}
    const kind: string = String(a.kind || '')
    const b: any = await baseOf(a)
    if (b.fail) return b.fail
    const exe: any = b.exe
    const repo: any = b.root
    const refs: any = await refsOf(exe, repo)
    if (refs.ok !== true) return refs.envelope
    const names: string[] = refs.refs.map(function (r: any) { return r.short })
    const current: any = currentBranchOf(refs.refs)
    const tier: string = String(a.tier || 'full')
    function branchExists(n: string): boolean { return names.indexOf(n) >= 0 }
    function nameFail(problem: any): any { return fail('args', problem === 'bad-tag-name' ? '标签名不合法：git 的标签名规则更细（不许空格、冒号、反斜杠、结尾点号等）' : '分支名不合法：git 的分支名规则更细（不许空格、冒号、反斜杠、结尾点号等）', { reasons: [problem] }) }

    if (kind === 'create') {
      const problem: any = branchNameProblem(a.name)
      if (problem) return nameFail(problem)
      const decision: any = decideBranchCreate({ nameExists: branchExists(a.name) })
      if (a.from) { const rp: any = await readOut(exe, repo, '确认起点提交这一步', ['rev-parse', '-q', '--verify', String(a.from)], true); if (rp.ok !== true) return rp.envelope; if (typeof rp.exitCode === 'number' && rp.exitCode !== 0) return fail('args', '起点提交或引用不存在：' + String(a.from)) }
      const g: any = gate(decision, a, confirmOf(kind, String(a.name), '新建分支 ' + String(a.name)))
      if (g) return g
      const argv: string[] = tier === 'degraded' ? branchCreateCheckoutArgs(a.name, a.from) : branchCreateArgs(a.name, a.from)
      const done: any = await execWrite(exe, repo, argv, '新建并切换分支这一步', '切到新分支 ' + String(a.name))
      return done.ok === true ? { ok: true, kind: kind, branch: a.name, command: argv.slice(0, 2).join(' '), atMs: done.atMs, decision: decision } : done
    }
    if (kind === 'switch') {
      const problem: any = branchNameProblem(a.name)
      if (problem) return nameFail(problem)
      if (!branchExists(a.name)) return fail('blocked', branchReasonText('branch-missing'), { reasons: ['branch-missing'] })
      const prot: any = await protectionOf(a)
      if (prot.ok !== true) return prot.envelope
      const decision: any = decideBranchSwitch(prot.flags)
      const g: any = gate(decision, a, confirmOf(kind, String(a.name), '切换到分支 ' + String(a.name)))
      if (g) return g
      const argv: string[] = tier === 'degraded' ? branchSwitchCheckoutArgs(a.name) : branchSwitchArgs(a.name)
      const done: any = await execWrite(exe, repo, argv, '切换分支这一步', '当前分支变成 ' + String(a.name))
      return done.ok === true ? { ok: true, kind: kind, branch: a.name, command: argv.slice(0, 2).join(' '), atMs: done.atMs, decision: decision } : done
    }
    if (kind === 'detach') {
      const rev: string = String(a.rev || '')
      if (!rev || rev.charAt(0) === '-' || /\s/.test(rev)) return fail('args', '要切过去的提交号或引用不合法')
      const prot: any = await protectionOf(a)
      if (prot.ok !== true) return prot.envelope
      const decision: any = decideBranchSwitch(prot.flags)
      const g: any = gate(decision, a, confirmOf(kind, rev, '切到提交 ' + rev + '（分离头指针）'))
      if (g) return g
      const argv: string[] = tier === 'degraded' ? branchDetachCheckoutArgs(rev) : branchDetachArgs(rev)
      const done: any = await execWrite(exe, repo, argv, '切到某个提交这一步', '头指针分离在 ' + rev)
      return done.ok === true ? { ok: true, kind: kind, rev: rev, command: argv.slice(0, 2).join(' '), atMs: done.atMs, decision: decision } : done
    }
    if (kind === 'rename') {
      const toProblem: any = branchNameProblem(a.to)
      if (toProblem) return nameFail(toProblem)
      if (!branchExists(a.from)) return fail('args', '要改名的分支不存在：刷新分支列表再试')
      if (branchExists(a.to)) return fail('blocked', branchReasonText('branch-exists'), { reasons: ['branch-exists'] })
      const decision: any = decideBranchCreate({ nameExists: false })
      const g: any = gate(decision, a, confirmOf(kind, String(a.from) + ' → ' + String(a.to), '把分支 ' + String(a.from) + ' 改名为 ' + String(a.to)))
      if (g) return g
      const argv: string[] = branchRenameArgs(a.from, a.to)
      const done: any = await execWrite(exe, repo, argv, '重命名分支这一步', '分支名从 ' + String(a.from) + ' 变成 ' + String(a.to))
      return done.ok === true ? { ok: true, kind: kind, from: a.from, to: a.to, command: argv.slice(0, 2).join(' '), atMs: done.atMs, decision: decision } : done
    }
    if (kind === 'delete') {
      const problem: any = branchNameProblem(a.name)
      if (problem) return nameFail(problem)
      if (!branchExists(a.name)) return fail('args', '这个分支不存在了：刷新分支列表再试')
      const mergedList: any = current && current.short ? await namesOf(exe, repo, 'merged', current.short) : { ok: true, names: [] }
      if (mergedList.ok !== true) return mergedList.envelope
      const merged: boolean = mergedList.names.indexOf(a.name) >= 0
      const screen: any = await readScreenOf(cwdOf(a))
      const flags: any = screen && screen.ok === true ? flagsOf(screen.screen) : flagsOf({})
      const decision: any = decideBranchDelete({ current: current && current.short === a.name, merged: merged, force: a.force === true, dirty: flags.stagedCount + flags.unstagedCount > 0 })
      const g: any = gate(decision, a, confirmOf(kind, String(a.name), '删除分支 ' + String(a.name) + (merged ? '' : '（未并入，会丢提交）')))
      if (g) return g
      const argv: string[] = branchDeleteArgs(a.name, a.force === true)
      const done: any = await execWrite(exe, repo, argv, '删除分支这一步', '分支 ' + String(a.name) + ' 被删除')
      return done.ok === true ? { ok: true, kind: kind, branch: a.name, command: argv.slice(0, 3).join(' '), atMs: done.atMs, decision: decision } : done
    }
    if (kind === 'upstream') {
      if (!branchExists(a.branch)) return fail('args', '这个分支不存在了：刷新分支列表再试')
      let argv: string[]
      let verb: string
      if (a.unset === true) { argv = unsetUpstreamArgs(a.branch); verb = '取消分支 ' + String(a.branch) + ' 的上游' }
      else { const up: any = upstreamNameProblem(a.upstream); if (up) return fail('args', branchReasonText('bad-upstream'), { reasons: [up] }); argv = setUpstreamArgs(a.upstream, a.branch); verb = '把分支 ' + String(a.branch) + ' 的上游设为 ' + String(a.upstream) }
      const g: any = gate({ verdict: 'allow', reasons: ['ok'] }, a, confirmOf(kind, String(a.branch), verb))
      if (g) return g
      const done: any = await execWrite(exe, repo, argv, '设置上游这一步', verb)
      return done.ok === true ? { ok: true, kind: kind, branch: a.branch, command: argv.slice(0, 2).join(' '), atMs: done.atMs } : done
    }
    if (kind === 'tag-create') {
      const tp: any = tagNameProblem(a.name)
      if (tp) return nameFail(tp)
      const tags: any = await tagsOf(exe, repo)
      if (tags.ok !== true) return tags.envelope
      const exists: boolean = tags.tags.some(function (t: any) { return t.name === a.name })
      const decision: any = decideTagCreate({ exists: exists, mode: String(a.mode || 'light'), message: a.message === undefined ? '' : String(a.message) })
      const modeText: string = a.mode === 'signed' ? '签名标签' : (a.mode === 'annotated' ? '附注标签' : '轻量标签')
      const g: any = gate(decision, a, confirmOf(kind, String(a.name), '在 ' + String(a.target || 'HEAD') + ' 上建' + modeText + ' ' + String(a.name)))
      if (g) return g
      if (a.target) { const rp: any = await readOut(exe, repo, '确认标签目标这一步', ['rev-parse', '-q', '--verify', String(a.target)], true); if (rp.ok !== true) return rp.envelope; if (typeof rp.exitCode === 'number' && rp.exitCode !== 0) return fail('args', '标签目标不存在：' + String(a.target)) }
      const argv: string[] = tagCreateArgs(a.name, String(a.mode || 'light'), a.target, a.message)
      const done: any = await execWrite(exe, repo, argv, '建标签这一步', '标签 ' + String(a.name) + ' 建好')
      return done.ok === true ? { ok: true, kind: kind, tag: a.name, command: argv.slice(0, 3).join(' '), atMs: done.atMs, decision: decision } : done
    }
    if (kind === 'tag-delete') {
      const tp: any = tagNameProblem(a.name)
      if (tp) return nameFail(tp)
      const tags: any = await tagsOf(exe, repo)
      if (tags.ok !== true) return tags.envelope
      if (!tags.tags.some(function (t: any) { return t.name === a.name })) return fail('args', '这个标签不存在了：刷新标签列表再试')
      const g: any = gate({ verdict: 'allow', reasons: ['ok'] }, a, confirmOf(kind, String(a.name), '删除标签 ' + String(a.name)))
      if (g) return g
      const argv: string[] = tagDeleteArgs(a.name)
      const done: any = await execWrite(exe, repo, argv, '删标签这一步', '标签 ' + String(a.name) + ' 被删除')
      return done.ok === true ? { ok: true, kind: kind, tag: a.name, command: argv.slice(0, 2).join(' '), atMs: done.atMs } : done
    }
    if (kind === 'describe') {
      if (!branchExists(a.branch)) return fail('blocked', branchReasonText('branch-missing'), { reasons: ['branch-missing'] })
      const decision: any = decideDescriptionWrite({ branchExists: true, text: a.text === undefined ? '' : String(a.text) })
      const g: any = gate(decision, a, confirmOf(kind, String(a.branch), '写入分支 ' + String(a.branch) + ' 的说明'))
      if (g) return g
      const text: string = typeof a.text === 'string' ? a.text : ''
      const argv: string[] = text ? branchDescriptionSetArgs(a.branch, text) : branchDescriptionUnsetArgs(a.branch)
      const done: any = await execWrite(exe, repo, argv, '写分支说明这一步', text ? '说明写进 branch.' + String(a.branch) + '.description' : '这条分支的说明被清空')
      return done.ok === true ? { ok: true, kind: kind, branch: a.branch, description: text, command: 'config --local', atMs: done.atMs } : done
    }
    if (kind === 'verify') {
      const object: string = String(a.object || '')
      const objectKind: string = a.objectKind === 'tag' ? 'tag' : 'commit'
      if (!object || object.charAt(0) === '-' || /\s/.test(object)) return fail('args', '要验签的对象是空的或不合法')
      const argv: string[] = objectKind === 'tag' ? verifyTagArgs(object) : verifyCommitArgs(object)
      const res: any = await runPinned(exe, repo, argv, { stdoutLimit: 1024 * 1024 })
      const bad: any = res.kind === 'ok' || res.kind === 'non-zero' ? null : failureFromExec(res, '验签这一步')
      if (bad) return bad
      const exitCode: number = typeof res.exitCode === 'number' ? res.exitCode : (res.kind === 'ok' ? 0 : -1)
      return {
        ok: true, kind: kind, objectKind: objectKind, object: object, command: argv.slice(0, 2).join(' '),
        verified: exitCode === 0,
        exitCode: exitCode,
        gitSays: (String((res && res.stdout) || '').trim() !== '' ? firstLine(res.stdout) : firstLine(res && res.stderr)).slice(0, 400),
        atMs: nowFn(),
      }
    }
    return fail('args', '不认识的分支写动作：' + kind + '（允许：create / switch / detach / rename / delete / upstream / tag-create / tag-delete / describe / verify）')
  }

  return { handleGitBranches: handleGitBranches, handleGitBranchWrite: handleGitBranchWrite }
}

export const BRANCH_PHONES_SOURCE = 'src/host/versionControlBranch.ts'