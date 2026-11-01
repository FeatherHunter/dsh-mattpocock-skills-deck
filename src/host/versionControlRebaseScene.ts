// host/versionControlRebaseScene.ts —— 变基待办页（#1749 T14，规格域 5 的 5.6–5.8、5.10）的现场读数叶子
//
// 为什么单独一层：这个页面要读的东西有三类别的页没有——待办窗口（基座到 HEAD 的提交顺序）、
//   换基座的移动范围（旧基座到 HEAD、旧基座到新基座两段）、--autosquash 将吸收的提交对，
//   还要读 rebase.updateRefs 这个配置开关与 --rebase-merges 需要的版本门。这些读法如果散在
//   预检与执行两处，两边口径迟早分叉；本叶子只读不写（唯一例外是 --autosquash 预演要写一个
//   临时文件接住 git 自己生成的待办，临时文件由装配处注入的 tmp 服务创建与删除）。
//
// 三条口径（改了会坏）：
//   1. 所有 git 调用都走装配处注入的 runPinned：-C 钉仓库、固定前缀、字节上限、超时、报闸、git.exec 日志；
//      本文件不自己起进程、不自己拼可执行文件路径。
//   2. 读不全（截断、起进程失败、超时）一律显式失败，不给半份现场；非零退出只在「用退出码当结论」
//      的地方被接受（--autosquash 预演就是靠编辑器失败来拿待办，见 autosquashPairsOf）。
//   3. 票据绑定表用 16 位摘要，不把待办内容或计划原文带进票据；计划摘要用共享层的 canonicalJson 算。
import { canonicalJson, makeBindings, pathAbsentFromScreen, worktreeBindingInput } from '../shared/version-control/src/write-ticket.js'
import { conflictStateOfScreen } from '../shared/version-control/src/conflict-ops.js'
import { gitVersionAtLeast, rebaseAutosquashPairsOf, rebasePlanOf, rebaseTargetProblem, REBASE_MERGES_MIN_VERSION } from '../shared/version-control/src/rebase-ops.js'
import { VC_REBASE_READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，内建模块必然存在。
import { createHash as cryptoCreateHash } from 'node:crypto'

/** 读命令的输出上限：待办窗口与范围清单都很小，但统一给上限，超了显式失败而不是悄悄截断。 */
const READ_LIMIT = 8 * 1024 * 1024

/** 票据绑定用的 16 位摘要。
 *  这八份的算法体由 tests/verify-1586-write-contracts.ts 的 C 组逐字节比对：改一处必须八处一起改。 */
function digest16Of(text: any): string { try { return cryptoCreateHash('sha256').update(String(text === undefined || text === null ? '' : text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return '0000000000000000' } }

/** 造变基待办页的现场读数器：返回一组只读能力与绑定表算法，供预检、执行与只读电话共用。 */
export function createRebaseScene(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const readScreenOf: any = d.readScreenOf
  const tmp: any = d.tmp
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  /** 失败信封：kind 是环节、reason 是固定理由标识符，附加字段平铺在顶层。 */
  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
  }
  function gitSays(res: any): string {
    const text: string = String((res && res.stderr) || '').trim() !== '' ? firstLine(res.stderr) : firstLine(res && res.stdout)
    return String(text || '').slice(0, 400)
  }
  /** 读一条只读命令；allowNonZero 表示「非零退出本身是读数结论」，交给调用方解释。 */
  async function readOut(exe: any, root: any, what: string, args: string[], opts?: any): Promise<any> {
    const o: any = opts || {}
    const res: any = await runPinned(exe, root, args, { stdoutLimit: o.stdoutLimit || READ_LIMIT, timeoutMs: o.timeoutMs || VC_REBASE_READ_TIMEOUT_MS })
    const bad: any = res.kind === 'ok' || (o.allowNonZero === true && res.kind === 'non-zero') ? null : failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', 'truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    return { ok: true, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), exitCode: typeof res.exitCode === 'number' ? res.exitCode : (res.kind === 'ok' ? 0 : -1) }
  }
  async function baseOf(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { fail: fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, String(cwd || ''))
    if (!base || base.ok !== true) return { fail: base }
    return { exe: exe, root: String(base.root) }
  }
  /** 解析一个基座目标（分支名、标签名或提交号）到完整提交号；解析不到就是明确的 target-missing。 */
  async function oidOf(exe: any, root: any, target: any, what: string): Promise<any> {
    const bad: any = rebaseTargetProblem(target)
    if (bad) return { ok: false, envelope: fail('args', bad, what + '的名字形状不对：面板只接受分支名、标签名或完整提交号', { target: target }) }
    const r: any = await readOut(exe, root, what + '这一步', ['rev-parse', '--verify', '--quiet', String(target) + '^{commit}'], { allowNonZero: true })
    if (r.ok !== true) return r
    const oid: string = String(r.stdout || '').trim()
    if (r.exitCode !== 0 || oid === '') return { ok: false, envelope: fail('args', 'target-missing', '找不到这个分支或提交：' + String(target) + '；请刷新清单后重新选', { target: String(target) }) }
    return { ok: true, oid: oid }
  }
  /** 读一次完整现场：仓库根、HEAD、首屏读数、进行中操作、当前分支、rebase.updateRefs 开关。 */
  async function sceneOf(cwd: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const sr: any = await readScreenOf(cwd)
    if (!sr || sr.ok !== true) return { ok: false, envelope: sr }
    const screen: any = sr.screen || {}
    const headOid: string = String((screen.identity && screen.identity.oid) || '')
    const state: any = conflictStateOfScreen(screen)
    const br: any = await readOut(b.exe, b.root, '读当前分支这一步', ['rev-parse', '--abbrev-ref', 'HEAD'], { allowNonZero: true })
    if (br.ok !== true) return br
    const branch: string = String(br.stdout || '').trim()
    const cfg: any = await readOut(b.exe, b.root, '读 rebase.updateRefs 开关这一步', ['config', '--get', 'rebase.updateRefs'], { allowNonZero: true })
    if (cfg.ok !== true) return cfg
    const updateRefs: boolean = cfg.exitCode === 0 && /^(true|1|yes|on)$/i.test(String(cfg.stdout || '').trim())
    return { ok: true, exe: b.exe, repoRoot: b.root, headOid: headOid, screen: screen, state: state, branch: branch, updateRefs: updateRefs, gitVersion: String(sr.gitVersion || ''), readAtMs: nowFn() }
  }

  /** 把 `--format=%H%x1f%s` 的输出解析成提交列表；没有分隔符的行跳过（不让半行数据混进来）。 */
  function commitsOf(stdout: any): any[] {
    const out: any[] = []
    const lines: string[] = String(stdout || '').split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line: string = lines[i]
      if (line === '') continue
      const sep: number = line.indexOf('\u001f')
      if (sep < 0) continue
      out.push({ oid: line.slice(0, sep), subject: line.slice(sep + 1) })
    }
    return out
  }

  /** 读待办窗口：基座..HEAD 的提交（按从旧到新排，界面按这个顺序显示）。 */
  async function windowOf(cwd: any, base: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const o: any = await oidOf(b.exe, b.root, base, '读待办窗口的基座')
    if (o.ok !== true) return o
    const r: any = await readOut(b.exe, b.root, '读待办窗口这一步', ['log', '--reverse', '--format=%H%x1f%s', o.oid + '..HEAD'])
    if (r.ok !== true) return r
    const commits: any[] = commitsOf(r.stdout)
    const headOid: string = commits.length > 0 ? String(commits[commits.length - 1].oid) : o.oid
    return { ok: true, base: String(base), baseOid: o.oid, headOid: headOid, commits: commits, commitCount: commits.length, readAtMs: nowFn() }
  }

  /** 读换基座的移动范围：旧基座..HEAD 是要搬走的提交，旧基座..新基座是新基座带来的提交。 */
  async function ontoRangeOf(cwd: any, oldBase: any, newBase: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const o1: any = await oidOf(b.exe, b.root, oldBase, '读换基座的旧基座')
    if (o1.ok !== true) return o1
    const o2: any = await oidOf(b.exe, b.root, newBase, '读换基座的新基座')
    if (o2.ok !== true) return o2
    const moved: any = await readOut(b.exe, b.root, '读要搬走的提交这一步', ['log', '--reverse', '--format=%H%x1f%s', o1.oid + '..HEAD'])
    if (moved.ok !== true) return moved
    const incoming: any = await readOut(b.exe, b.root, '读新基座带来的提交这一步', ['log', '--reverse', '--format=%H%x1f%s', o1.oid + '..' + o2.oid])
    if (incoming.ok !== true) return incoming
    const movedList: any[] = commitsOf(moved.stdout)
    const incomingList: any[] = commitsOf(incoming.stdout)
    return { ok: true, oldBase: String(oldBase), oldBaseOid: o1.oid, newBase: String(newBase), newBaseOid: o2.oid, moved: movedList, incoming: incomingList, movedCount: movedList.length, incomingCount: incomingList.length, readAtMs: nowFn() }
  }

  /**
   * 只读预演 --autosquash：让 git 自己生成待办，在编辑器处接住这份待办再让它失败。
   * 为什么用「必定失败的编辑器」而不是解析提交说明：git 的 autosquash 配对规则随版本演进
   * （fixup!/squash!/amend! 与按提交号配对），照抄一遍迟早对不上；让它自己算最稳。
   * 预演失败是预期行为：HEAD、分支与 .git/rebase-merge 都不会变（探针已在 git 2.49 上确认）。
   */
  async function autosquashPairsOf(cwd: any, base: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const sr: any = await readScreenOf(cwd)
    if (!sr || sr.ok !== true) return { ok: false, envelope: sr }
    const state: any = conflictStateOfScreen(sr.screen || {})
    if (state !== null) return { ok: false, envelope: fail('blocked', 'operation-in-progress', '仓库正在 ' + String(state) + ' 中，先把当前操作处理完再看自动吸收清单', { state: state }) }
    const o: any = await oidOf(b.exe, b.root, base, '读自动吸收清单的基座')
    if (o.ok !== true) return o
    if (!tmp || typeof tmp.write !== 'function' || typeof tmp.read !== 'function' || typeof tmp.remove !== 'function') return { ok: false, envelope: fail('env', 'env', '临时文件服务不可用，读不了自动吸收清单') }
    const cap: any = await tmp.write('')
    if (!cap || cap.ok !== true) return { ok: false, envelope: fail('env', 'env', '建不了临时文件，读不了自动吸收清单：' + String((cap && cap.message) || '')) }
    const editor: string = "sh -c 'cp \"$0\" \"" + String(cap.path) + "\"; exit 1'"
    const res: any = await runPinned(b.exe, b.root, ['rebase', '-i', '--autosquash', o.oid], { stdoutLimit: READ_LIMIT, timeoutMs: VC_REBASE_READ_TIMEOUT_MS, env: { GIT_SEQUENCE_EDITOR: editor } })
    const got: any = await tmp.read(cap.path)
    await tmp.remove(cap.path)
    if (!got || got.ok !== true || String(got.text || '').trim() === '') return { ok: false, envelope: fail('git-failed', 'unknown-write-failure', '读自动吸收的待办这一步失败：git 没有生成待办，原话「' + gitSays(res) + '」', { git: gitSays(res), step: '读自动吸收的待办这一步', actual: '退出码 ' + String(res && res.exitCode) }) }
    const parsed: any = rebaseAutosquashPairsOf(got.text)
    return { ok: true, base: String(base), baseOid: o.oid, pairs: parsed.pairs, todoText: String(got.text), readAtMs: nowFn() }
  }

  /** 读保留合并结构的代价：基座..HEAD 之间有几个合并提交（--rebase-merges 会把它们一并重排）。 */
  async function mergesCostOf(cwd: any, base: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const sr: any = await readScreenOf(cwd)
    if (!sr || sr.ok !== true) return { ok: false, envelope: sr }
    const ver: string = String(sr.gitVersion || '')
    if (!gitVersionAtLeast(ver, 2, 18)) return { ok: false, envelope: fail('unsupported', 'version-unsupported', '保留合并结构要 git ' + REBASE_MERGES_MIN_VERSION + ' 及以上（--rebase-merges）；当前是 ' + (ver || '未知版本') + '，升级后再来', { needed: REBASE_MERGES_MIN_VERSION, gitVersion: ver }) }
    const o: any = await oidOf(b.exe, b.root, base, '读保留合并结构代价的基座')
    if (o.ok !== true) return o
    const r: any = await readOut(b.exe, b.root, '读合并提交清单这一步', ['log', '--merges', '--reverse', '--format=%H%x1f%s', o.oid + '..HEAD'])
    if (r.ok !== true) return r
    const merges: any[] = commitsOf(r.stdout)
    return { ok: true, base: String(base), baseOid: o.oid, mergeCommits: merges, count: merges.length, gitVersion: ver, readAtMs: nowFn() }
  }

  /** 票据绑定：计划摘要、工作区摘要、updateRefs 开关的当时值、当时不存在的标记。 */
  function bindingsOf(scene: any, plan: any): any {
    const sc: any = scene.screen || {}
    return makeBindings({
      preconditions: {
        planDigest: digest16Of(canonicalJson(plan)),
        worktreeDigest: digest16Of(worktreeBindingInput(sc)),
        configOldValue: scene.updateRefs ? 'true' : 'false',
        remoteOid: null,
        pathAbsent: pathAbsentFromScreen(sc),
      },
      counters: { indexEntries: null },
    })
  }

  /** 预检与执行共用的一把尺：读现场并把计划里的基座解析成当时的确切提交号。 */
  async function measure(cwd: any, plan: any): Promise<any> {
    const scene: any = await sceneOf(cwd)
    if (scene.ok !== true) return { ok: false, envelope: scene.envelope }
    const p: any = rebasePlanOf(plan)
    let baseOid: any = null
    let oldBaseOid: any = null
    let newBaseOid: any = null
    if (p.base !== null) {
      const o: any = await oidOf(scene.exe, scene.repoRoot, p.base, '核对基座')
      if (o.ok !== true) return { ok: false, envelope: o.envelope }
      baseOid = o.oid
    }
    if (p.oldBase !== null) {
      const o: any = await oidOf(scene.exe, scene.repoRoot, p.oldBase, '核对旧基座')
      if (o.ok !== true) return { ok: false, envelope: o.envelope }
      oldBaseOid = o.oid
    }
    if (p.newBase !== null) {
      const o: any = await oidOf(scene.exe, scene.repoRoot, p.newBase, '核对新基座')
      if (o.ok !== true) return { ok: false, envelope: o.envelope }
      newBaseOid = o.oid
    }
    let windowOids: string[] = []
    if (baseOid !== null && p.op === 'rebase-todo') {
      const r: any = await readOut(scene.exe, scene.repoRoot, '核对待办窗口这一步', ['log', '--reverse', '--format=%H', String(baseOid) + '..HEAD'])
      if (r.ok !== true) return r
      windowOids = String(r.stdout || '').split(/\r?\n/).filter(function (s: string): boolean { return s !== '' })
    }
    return { ok: true, repoRoot: scene.repoRoot, headOid: scene.headOid, state: scene.state, branch: scene.branch, updateRefs: scene.updateRefs, gitVersion: scene.gitVersion, baseOid: baseOid, oldBaseOid: oldBaseOid, newBaseOid: newBaseOid, windowOids: windowOids, bindings: bindingsOf(scene, p), scene: scene }
  }

  return { fail: fail, readOut: readOut, baseOf: baseOf, oidOf: oidOf, sceneOf: sceneOf, bindingsOf: bindingsOf, measure: measure, digest16: digest16Of, commitsOf: commitsOf, windowOf: windowOf, ontoRangeOf: ontoRangeOf, autosquashPairsOf: autosquashPairsOf, mergesCostOf: mergesCostOf }
}

export const REBASE_SCENE_SOURCE = 'src/host/versionControlRebaseScene.ts'

