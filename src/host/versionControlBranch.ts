// host/versionControlBranch.ts —— 域 4（分支与标签）的只读电话 wf.gitBranches（#1746 T11 返工后）
//
// 这一层只负责「读一次取全」：分支列表（4.1）、标签列表（4.9）、已并入/没并入（4.8）、全部分支说明
//   （4.13 的读部分）与当前分支标记。界面只读这一份快照，不按行再开枪。
//
// 写动作（4.2–4.7、4.10、4.11、4.12、4.13 的写部分）已搬到两个自包含叶子：
//   - versionControlBranchCheck.ts 的 wf.gitBranchCheck：读现场、判定、签 120 秒票；
//   - versionControlBranchWrite.ts 的 wf.gitBranchWrite：凭票执行、requestId 去重。
//   两边由 versionControlBranchMount.ts 装配并共用同一张票表。
//
// 所有 git 调用经 runPinned（-C 钉死目录、固定前缀、GIT_EDITOR=必失败命令、字节上限、超时、报闸）；
//   失败显示 git 原话与环节名，读不全就当显式失败，不拿半份数据冒充成功。
//
// 装配面：createBranchPhones(deps) 由父文件 versionControl.ts 显式传入全部依赖（与其它电话同一先例），
//   本文件不引用任何宿主兄弟文件，只依赖 shared/version-control 的共享解析器。
import { commandFor, tagListArgs, branchDescriptionsArgs, mergedBranchesArgs } from '../shared/version-control/src/commands.js'
import { parseRefs } from '../shared/version-control/src/parse-refs.js'
import { parseTagList, parseBranchNameList, parseBranchDescriptions } from '../shared/version-control/src/parse-branch.js'
import { BRANCH_TICKET_OPS, BRANCH_OP_CAP_IDS } from '../shared/version-control/src/branch-ticket.js'
import { parseVersion, capabilityTierFor, capabilityAvailability } from '../shared/version-control/src/capabilities.js'
import { CAPABILITIES } from '../shared/version-control/src/capability-ledger.js'

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
  const nowFn: any = (deps && typeof deps.now === 'function') ? deps.now : Date.now
  // 账本按能力号索引一次：分支页要按当前 git 版本算出每个写动作是完整可用还是降级。
  const capsById: any = {}
  for (let i: number = 0; i < CAPABILITIES.length; i += 1) capsById[String(CAPABILITIES[i].id)] = CAPABILITIES[i]

  /** 失败信封：kind 是环节，git 原话与期望/实际放 extra 顶层（与改动页同一口径）。 */
  function fail(kind: string, message: string, extra?: any): any {
    return failPhone(kind, message, extra)
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
    const spec: any = commandFor('refs', {})
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
    // 版本片：git 版本 + 九个写动作各自的可用档。4.2 / 4.3 / 4.4 在 2.23 以下退成 degraded（改用 checkout），
    // 界面据此画一行「当前 git 版本用 checkout 等价动作」——不让用户点了按钮才看到 git: 'switch' is not a git command。
    const ver: any = await readOut(b.exe, b.root, '读 git 版本这一步', ['--version'])
    if (ver.ok !== true) return ver.envelope
    const gitVersion: string = firstLine(ver.stdout)
    const actions: any[] = []
    for (let i: number = 0; i < BRANCH_TICKET_OPS.length; i += 1) {
      const op: string = BRANCH_TICKET_OPS[i]
      const capId: string = String(BRANCH_OP_CAP_IDS[op] || '')
      const cap: any = capsById[capId]
      if (!cap) continue
      const av: any = capabilityAvailability(cap, gitVersion)
      actions.push({ op: op, capId: capId, state: av.state, needed: av.needed, alternative: av.alternative })
    }
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
      // gone：上游那条远端分支已经被删（for-each-ref 给 [gone]）。不传这一位的话，界面只能把
      //   「上游没了」画成「与上游齐平」——一句假话（#1881）。
      // subject：#1883 追加的提交主题，界面把它写在分支行第三行「时间 · 主题」里。它是**追加字段**，
      //   板回包版本号不动；老回包没有这一位时界面只画时间，不会把 undefined 画成一行字。
      branches: refs.refs.map(function (r: any) { return { name: r.short, oid: r.oid, current: r.current === true, upstream: r.upstream || '', ahead: r.ahead || 0, behind: r.behind || 0, gone: r.upstreamGone === true, commitDateMs: r.commitDateMs || null, subject: r.subject || '' } }),
      tags: tags.tags,
      descriptions: desc.descriptions,
      merged: merged,
      notMerged: notMerged,
      // 版本片叫 capabilities 不叫 version：回包顶层的 version 是契约版本号（数字），两个不能同名。
      capabilities: { gitVersion: gitVersion, tier: capabilityTierFor(parseVersion(gitVersion)), actions: actions },
    }
  }

  return { handleGitBranches: handleGitBranches }
}

export const BRANCH_PHONES_SOURCE = 'src/host/versionControlBranch.ts'
