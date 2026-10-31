// host/versionControlBranchCheck.ts —— 域 4（分支与标签）的预检电话 wf.gitBranchCheck（#1746 T11 返工）
//
// 一条写动作走三步（规格第 8 节、方案第 4 节主缝 B）：
//   ① 预检（本文件）：读一次真实现场 → 共享层 branch-decisions.ts 判定 allow/warn/block → 签票（120 秒）；
//   ② 用户确认（界面）：block 直接显示不能做的理由；warn 与毁类动作弹确认卡；
//   ③ 执行（versionControlBranchWrite.ts）：只收票号、requestId 与动作参数，逐条重验后执行一次。
//
// 票据只管「预检那一刻看到的事实」：票里记下目标分支 oid、上游配置旧值、说明旧值、工作区脏不脏；
//   执行前重量一次逐格比对，不一致按 target-changed 零进程拒绝。票不自动续期，过期就重新预检。
//
// 起进程纪律：预检只跑只读命令，绝不起写命令；读不全当场显式失败，不给半份现场。
//   所有 git 调用经装配处注入的 runPinned（-C 钉仓库、固定前缀、字节上限、超时、报闸）。
// block 时照样回现场（scene），界面据此画「为什么不能点」，而不是只给一句理由。
import { commandFor, tagListArgs, branchDescriptionsArgs, mergedBranchesArgs, verifyCommitArgs, verifyTagArgs } from '../shared/version-control/src/commands.js'
import { parseRefs } from '../shared/version-control/src/parse-refs.js'
import { parseTagList, parseBranchNameList, parseBranchDescriptions } from '../shared/version-control/src/parse-branch.js'
import { branchNameProblem, tagNameProblem, upstreamNameProblem, decideBranchSwitch, decideBranchDelete,
  decideBranchCreate, decideTagCreate, decideDescriptionWrite, branchReasonText } from '../shared/version-control/src/branch-decisions.js'
import { makeTicket, makeBindings, pathAbsentFromScreen } from '../shared/version-control/src/write-ticket.js'
import { BRANCH_CHECK_CONTRACT, BRANCH_CHECK_VERSION, BRANCH_TICKET_OPS, BRANCH_TICKET_READ_OP, BRANCH_OP_CAP_IDS,
  branchPlanOf, branchPlanDigestInput, branchWorktreeInput, branchConfigInput, branchSceneSummary } from '../shared/version-control/src/branch-ticket.js'
import { capabilityAvailability } from '../shared/version-control/src/capabilities.js'
import { CAPABILITIES } from '../shared/version-control/src/capability-ledger.js'
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，内建模块必然存在。
import { createHash as cryptoCreateHash } from 'node:crypto'
import { VC_BRANCH_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 摘要：票据绑定表只用 16 位十六进制，够区分同一份计划/现场且不把原文带进票据。 */
function digest16Of(text: any): string { try { return cryptoCreateHash('sha256').update(String(text === undefined || text === null ? '' : text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return '0000000000000000' } }

/** 造预检电话：返回 { handleBranchCheck, tickets, results, measure }。
 *  tickets/results 是宿主进程内存里的两张表，执行叶子共用同一份（预检签的票执行必须能在同一张表里找到）；
 *  measure 供执行叶子在动手前按同一口径重算现场（不另写第二套读法）。 */
export function createBranchCheck(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const readScreenOf: any = d.readScreenOf
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()
  // 账本按能力号索引一次：预检要查「这个动作在哪版 git 上要换做法」，账本是唯一数据源。
  const capsById: any = {}
  for (let i: number = 0; i < CAPABILITIES.length; i += 1) capsById[String(CAPABILITIES[i].id)] = CAPABILITIES[i]

  /** 读一次 git 版本，把这个动作的版本档定下来。
   *  低于 minVersion 且账本登记了 versionPolicy:"degrade"（4.2 / 4.3 / 4.4 的 2.23）就退成 degraded，
   *  执行层据此换 checkout 等价动作；低于硬底线（2.11）或没有降级做法则当场拒，不签一张注定失败的票。 */
  async function versionFor(exe: any, root: any, op: string): Promise<any> {
    const capId: string = String(BRANCH_OP_CAP_IDS[op] || '')
    const cap: any = capsById[capId]
    if (!cap) return { ok: false, envelope: fail('env', 'env', '能力账本里找不到这个分支动作的版本登记：' + capId) }
    const v: any = await readOut(exe, root, '读 git 版本这一步', ['--version'])
    if (v.ok !== true) return { ok: false, envelope: v.envelope }
    const gitVersion: string = firstLine(v.stdout)
    const avail: any = capabilityAvailability(cap, gitVersion)
    if (avail.state === 'hidden') return { ok: false, envelope: fail('unsupported', 'version-unsupported', '这台机器上的 git 版本太旧（' + gitVersion + '），这个分支动作至少需要 ' + String(avail.needed) + '；升级 git 之后再试', { gitVersion: gitVersion, needed: avail.needed, capId: capId }) }
    return { ok: true, tier: avail.state === 'degraded' ? 'degraded' : 'full', gitVersion: gitVersion, capId: capId, needed: avail.needed, alternative: avail.alternative }
  }

  /** 失败信封：kind 是环节，reason 给固定理由标识符（票据门用），附加字段（decision/scene 等）平铺在顶层。 */
  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
  }
  function gitSays(res: any): string {
    // firstLine 对空文本会回一句兜底话（不是空串），所以不能写成「a || b」：先判断哪一路真有内容。
    const text: string = String((res && res.stderr) || '').trim() !== '' ? firstLine(res.stderr) : firstLine(res && res.stdout)
    return text.slice(0, 400)
  }
  /** 读一条只读命令：起进程失败/超时走 failureFromExec；读不全显式失败；非零退出交给调用方决定。 */
  async function readOut(exe: any, root: any, what: string, args: string[], allowNonZero?: boolean): Promise<any> {
    const res: any = await runPinned(exe, root, args, { stdoutLimit: 8 * 1024 * 1024, timeoutMs: READ_TIMEOUT_MS })
    const bad: any = res.kind === 'ok' || (allowNonZero && res.kind === 'non-zero') ? null : failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', 'truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    return { ok: true, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode }
  }
  async function baseOf(cwd: string): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { fail: fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return { fail: base }
    return { exe: exe, root: base.root }
  }
  async function refsOf(exe: any, root: any): Promise<any> {
    const r: any = await readOut(exe, root, '读分支清单这一步', commandFor('refs', {}).args)
    if (r.ok !== true) return r
    const parsed: any = parseRefs(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', 'parse', '分支清单解析失败：' + parsed.detail) }
    return { ok: true, refs: parsed.refs }
  }
  async function tagsOf(exe: any, root: any): Promise<any> {
    const r: any = await readOut(exe, root, '读标签清单这一步', tagListArgs())
    if (r.ok !== true) return r
    const parsed: any = parseTagList(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', 'parse', '标签清单解析失败：' + parsed.detail) }
    return { ok: true, tags: parsed.tags }
  }
  async function descriptionsOf(exe: any, root: any): Promise<any> {
    const r: any = await readOut(exe, root, '读分支说明这一步', branchDescriptionsArgs(), true)
    if (r.ok !== true) return r
    // git config --get-regexp 没命中时退出码 1：这是「一条说明都没配过」，不是失败；其它非零是真失败。
    if (typeof r.exitCode === 'number' && r.exitCode !== 0) {
      if (r.exitCode === 1) return { ok: true, descriptions: {} }
      return { ok: false, envelope: fail('git-failed', 'other', '读分支说明这一步失败：git 原话「' + gitSays({ kind: 'non-zero', exitCode: r.exitCode, stderr: r.stderr }) + '」', { git: gitSays({ kind: 'non-zero', exitCode: r.exitCode, stderr: r.stderr }), step: '读分支说明这一步', actual: '退出码 ' + r.exitCode }) }
    }
    const parsed: any = parseBranchDescriptions(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', 'parse', '分支说明解析失败：' + parsed.detail) }
    return { ok: true, descriptions: parsed.descriptions }
  }
  async function namesOf(exe: any, root: any, which: string, base: string): Promise<any> {
    const r: any = await readOut(exe, root, '读已并入分支这一步', mergedBranchesArgs(which, base))
    if (r.ok !== true) return r
    const parsed: any = parseBranchNameList(r.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', 'parse', '已并入分支解析失败：' + parsed.detail) }
    return { ok: true, names: parsed.names }
  }
  async function revOid(exe: any, root: any, rev: string): Promise<any> {
    const r: any = await readOut(exe, root, '确认目标提交这一步', ['rev-parse', '-q', '--verify', String(rev)], true)
    if (r.ok !== true) return r
    if (typeof r.exitCode === 'number' && r.exitCode !== 0) return { ok: true, oid: null }
    return { ok: true, oid: String(r.stdout || '').trim() || null }
  }
  async function configOf(exe: any, root: any, key: string): Promise<any> {
    const r: any = await readOut(exe, root, '读分支上游配置这一步', ['config', '--local', '--get', key], true)
    if (r.ok !== true) return r
    if (typeof r.exitCode === 'number' && r.exitCode !== 0) {
      if (r.exitCode === 1) return { ok: true, value: null }
      return { ok: false, envelope: fail('git-failed', 'other', '读分支上游配置这一步失败：退出码 ' + r.exitCode) }
    }
    return { ok: true, value: String(r.stdout || '').replace(/\r?\n$/, '') }
  }
  function currentBranchOf(refs: any[]): any {
    for (let i: number = 0; i < refs.length; i += 1) if (refs[i] && refs[i].current === true) return refs[i]
    return null
  }
  function flagsOf(screen: any): any {
    const s: any = screen || {}
    const repo: any = s.repo || {}
    return {
      merging: repo.merging === true || s.merging === true,
      rebasing: repo.rebasing === true || s.rebasing === true,
      cherryPicking: repo.cherryPicking === true || s.cherryPicking === true,
      reverting: repo.reverting === true || s.reverting === true,
      conflictCount: typeof s.conflictCount === 'number' ? s.conflictCount : 0,
      stagedCount: typeof s.stagedCount === 'number' ? s.stagedCount : 0,
      unstagedCount: typeof s.unstagedCount === 'number' ? s.unstagedCount : 0,
    }
  }
  /** 读一次现场：分支清单、标签清单、分支说明、首屏读数。只读，不起写命令。 */
  async function sceneOf(exe: any, root: any, cwd: string): Promise<any> {
    const refs: any = await refsOf(exe, root)
    if (refs.ok !== true) return refs
    const tags: any = await tagsOf(exe, root)
    if (tags.ok !== true) return tags
    const desc: any = await descriptionsOf(exe, root)
    if (desc.ok !== true) return desc
    const screenRes: any = await readScreenOf(cwd)
    if (!screenRes || screenRes.ok !== true) return { ok: false, envelope: screenRes }
    const screen: any = screenRes.screen || {}
    const current: any = currentBranchOf(refs.refs)
    return {
      ok: true,
      screen: screen,
      refs: refs.refs,
      tags: tags.tags,
      descriptions: desc.descriptions,
      current: current ? String(current.short || '') : null,
      oids: (function () { const m: any = {}; for (let i: number = 0; i < refs.refs.length; i += 1) m[String(refs.refs[i].short)] = String(refs.refs[i].oid || ''); return m })(),
      flags: flagsOf(screen),
      headOid: String((screen.identity && screen.identity.oid) || ''),
    }
  }
  function branchOidOf(scene: any, name: any): string {
    const oid: any = scene.oids[String(name || '')]
    return oid === undefined ? '' : String(oid)
  }
  function tagOf(scene: any, name: any): any {
    for (let i: number = 0; i < scene.tags.length; i += 1) if (String(scene.tags[i].name || '') === String(name || '')) return scene.tags[i]
    return null
  }
  /** 按计划算出「执行前必须还没变」的那几个观测量：目标 oid、配置旧值（上游或说明）。 */
  async function factsOf(exe: any, root: any, scene: any, plan: any): Promise<any> {
    let targetOid: string | null = null
    let configOld: string | null = null
    const op: string = String(plan.op || '')
    if (op === 'create') {
      if (plan.from) { const r: any = await revOid(exe, root, plan.from); if (r.ok !== true) return r; targetOid = r.oid === null ? '' : String(r.oid) }
      else targetOid = scene.headOid
    } else if (op === 'switch' || op === 'rename' || op === 'delete') { targetOid = branchOidOf(scene, op === 'rename' ? plan.from : plan.name) }
    else if (op === 'detach') { const r: any = await revOid(exe, root, plan.rev); if (r.ok !== true) return r; targetOid = r.oid === null ? '' : String(r.oid) }
    else if (op === 'tag-create') { if (plan.target) { const r: any = await revOid(exe, root, plan.target); if (r.ok !== true) return r; targetOid = r.oid === null ? '' : String(r.oid) } else targetOid = scene.headOid }
    else if (op === 'tag-delete') { const t: any = tagOf(scene, plan.name); targetOid = t ? String(t.oid || '') : '' }
    if (op === 'upstream') {
      const remote: any = await configOf(exe, root, 'branch.' + String(plan.branch) + '.remote')
      if (remote.ok !== true) return remote
      const merge: any = await configOf(exe, root, 'branch.' + String(plan.branch) + '.merge')
      if (merge.ok !== true) return merge
      configOld = branchConfigInput(remote.value, merge.value)
    } else if (op === 'describe') {
      configOld = String(scene.descriptions[String(plan.branch)] || '')
    }
    return { ok: true, targetOid: targetOid, configOld: configOld }
  }
  function bindingsOf(scene: any, plan: any, facts: any): any {
    return makeBindings({
      preconditions: {
        planDigest: digest16Of(branchPlanDigestInput(plan)),
        worktreeDigest: digest16Of(branchWorktreeInput(scene.screen)),
        configOldValue: facts.configOld === null || facts.configOld === undefined ? null : String(facts.configOld),
        remoteOid: facts.targetOid === null || facts.targetOid === undefined ? null : String(facts.targetOid),
        pathAbsent: pathAbsentFromScreen(scene.screen),
      },
      counters: { indexEntries: null },
    })
  }
  function confirmOf(op: string, plan: any, scene: any, merged?: boolean): any {
    if (op === 'create') return { kind: op, target: plan.name, verb: '新建并切换到分支 ' + plan.name }
    if (op === 'switch') return { kind: op, target: plan.name, verb: '切换到分支 ' + plan.name }
    if (op === 'detach') return { kind: op, target: plan.rev, verb: '切到提交 ' + plan.rev + '（分离头指针）' }
    if (op === 'rename') return { kind: op, target: plan.from + ' → ' + plan.to, verb: '把分支 ' + plan.from + ' 改名为 ' + plan.to }
    if (op === 'delete') return { kind: op, target: plan.name, verb: '删除分支 ' + plan.name + (merged === false ? '（未并入，会丢提交）' : '') }
    if (op === 'upstream') return { kind: op, target: plan.branch, verb: plan.unset ? '取消分支 ' + plan.branch + ' 的上游' : '把分支 ' + plan.branch + ' 的上游设为 ' + String(plan.upstream) }
    if (op === 'tag-create') { const modeText: string = plan.mode === 'signed' ? '签名标签' : (plan.mode === 'annotated' ? '附注标签' : '轻量标签'); return { kind: op, target: plan.name, verb: '在 ' + String(plan.target || 'HEAD') + ' 上建' + modeText + ' ' + plan.name } }
    if (op === 'tag-delete') return { kind: op, target: plan.name, verb: '删除标签 ' + plan.name }
    return { kind: op, target: plan.branch, verb: '写入分支 ' + plan.branch + ' 的说明' }
  }
  /** 现场摘要：block 时也要回，界面才能画「为什么不能点」。 */
  function sceneSummaryOf(scene: any, plan: any, merged?: boolean): any {
    return {
      current: scene.current,
      dirty: scene.flags.stagedCount + scene.flags.unstagedCount > 0,
      conflicts: scene.flags.conflictCount > 0,
      midOperation: scene.flags.merging || scene.flags.rebasing || scene.flags.cherryPicking || scene.flags.reverting,
      targetOid: branchOidOf(scene, plan.op === 'rename' ? plan.from : (plan.name || plan.branch || '')),
      descriptionOld: String(scene.descriptions[String(plan.branch)] || ''),
      upstreamOld: null,
      merged: merged === undefined ? null : merged,
    }
  }
  function sign(plan: any, root: any, scene: any, facts: any, decision: any, confirm: any, confirmRequired: boolean): any {
    const ticket: any = makeTicket({
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      op: plan.op as any,
      nowMs: nowFn(),
      headOid: scene.headOid,
      indexFingerprint: null,
      indexEntries: null,
      target: null,
      repoRoot: String(root),
      changes: null,
      bindings: bindingsOf(scene, plan, facts),
    })
    // 计划与判定随票保存：执行层只按这张票里的计划拼 argv，客户端再送一遍参数也不采信。
    ticket.plan = plan
    ticket.decision = decision
    ticket.confirmRequired = confirmRequired
    ticket.sceneSummary = branchSceneSummary(sceneSummaryOf(scene, plan))
    tickets.set(ticket.id, ticket)
    // 票表只活内存；超过 200 张按插入顺序删最旧的，避免长会话里无限长。
    while (tickets.size > 200) { const k: any = tickets.keys().next().value; tickets.delete(k) }
    return ticket
  }
  /** 4.12 验签（只读动作）：退出码非零是「没验过」的读数结论，不是电话失败，不许冒充成功。 */
  async function verifyAt(args: any): Promise<any> {
    const object: string = String(args.object || '')
    const objectKind: string = args.objectKind === 'tag' ? 'tag' : 'commit'
    if (!object || object.charAt(0) === '-' || /\s/.test(object)) return fail('args', 'bad-target', '要验签的对象是空的或不合法')
    const b: any = await baseOf(String(args.cwd))
    if (b.fail) return b.fail
    const argv: string[] = objectKind === 'tag' ? verifyTagArgs(object) : verifyCommitArgs(object)
    const res: any = await runPinned(b.exe, b.root, argv, { stdoutLimit: 1024 * 1024, timeoutMs: READ_TIMEOUT_MS })
    const bad: any = res.kind === 'ok' || res.kind === 'non-zero' ? null : failureFromExec(res, '验签这一步')
    if (bad) return bad
    const exitCode: number = typeof res.exitCode === 'number' ? res.exitCode : (res.kind === 'ok' ? 0 : -1)
    return { ok: true, contract: BRANCH_CHECK_CONTRACT, version: BRANCH_CHECK_VERSION, op: BRANCH_TICKET_READ_OP, kind: BRANCH_TICKET_READ_OP, objectKind: objectKind, object: object, command: argv.slice(0, 2).join(' '), verified: exitCode === 0, exitCode: exitCode, gitSays: (String((res && res.stdout) || '').trim() !== '' ? firstLine(res.stdout) : firstLine(res && res.stderr)).slice(0, 400), atMs: nowFn() }
  }

  /** 预检入口：校验 → 读现场 → 判定 → 签票（block 不签票，照样回现场）。 */
  async function handleBranchCheck(args: any): Promise<any> {
    const a: any = args || {}
    if (typeof a.cwd !== 'string' || a.cwd.trim() === '') return fail('args', 'bad-target', '缺少工作目录：预检必须先说清在哪个仓库做')
    if (String(a.op || '') === BRANCH_TICKET_READ_OP) return verifyAt(a)
    const planRes: any = branchPlanOf(String(a.op || ''), a)
    if (!planRes.ok) return fail('args', planRes.reason, planRes.message)
    const plan: any = planRes.plan
    const op: string = String(plan.op)
    const b: any = await baseOf(a.cwd)
    if (b.fail) return b.fail
    const scene: any = await sceneOf(b.exe, b.root, a.cwd)
    if (scene.ok !== true) return scene.envelope
    // 取名与参数形状（不碰仓库的纯检查）先做：形状不合法当场拒，不去读目标提交。
    if (op === 'create' || op === 'switch' || op === 'delete') { const p: any = branchNameProblem(plan.name); if (p) return fail('args', p, branchReasonText(p), { reasons: [p] }) }
    if (op === 'rename') { const p: any = branchNameProblem(plan.to); if (p) return fail('args', p, branchReasonText(p), { reasons: [p] }) }
    if (op === 'tag-create' || op === 'tag-delete') { const p: any = tagNameProblem(plan.name); if (p) return fail('args', p, branchReasonText(p), { reasons: [p] }) }
    if (op === 'upstream' && plan.unset !== true) { const p: any = upstreamNameProblem(plan.upstream); if (p) return fail('args', p, branchReasonText(p), { reasons: [p] }) }
    if (op === 'detach') { const rev: string = String(plan.rev || ''); if (!rev || rev.charAt(0) === '-' || /\s/.test(rev)) return fail('args', 'rev-missing', branchReasonText('rev-missing'), { reasons: ['rev-missing'] }) }
    // 存在性：要操作的分支/标签不在场就按固定理由拒（界面据此提示刷新）。
    const exists: (n: string) => boolean = function (n: string) { return branchOidOf(scene, n) !== '' || (scene.oids[String(n)] !== undefined) }
    // block 的回包也要带契约名、版本、动作与读时刻：界面用同一套形状判据读它，才能画「为什么不能点」。
    if ((op === 'switch' || op === 'delete' || op === 'describe') && !exists(plan.name) && !exists(plan.branch)) return fail('blocked', 'branch-missing', branchReasonText('branch-missing'), { contract: BRANCH_CHECK_CONTRACT, version: BRANCH_CHECK_VERSION, op: op, decision: { verdict: 'block', reasons: ['branch-missing'] }, reasons: ['branch-missing'], scene: sceneSummaryOf(scene, plan), readAtMs: nowFn() })
    if (op === 'rename' && !exists(plan.from)) return fail('args', 'branch-missing', branchReasonText('branch-missing'), { reasons: ['branch-missing'] })
    if (op === 'upstream' && !exists(plan.branch)) return fail('args', 'branch-missing', branchReasonText('branch-missing'), { reasons: ['branch-missing'] })
    if ((op === 'tag-delete') && tagOf(scene, plan.name) === null) return fail('args', 'branch-missing', '这个标签不存在了：刷新标签列表再试', { reasons: ['branch-missing'] })
    let decision: any = null
    let merged: boolean | undefined
    if (op === 'create') decision = decideBranchCreate({ nameExists: exists(plan.name) })
    else if (op === 'switch' || op === 'detach') decision = decideBranchSwitch(scene.flags)
    else if (op === 'rename') decision = decideBranchCreate({ nameExists: exists(plan.to) })
    else if (op === 'delete') {
      const ml: any = scene.current ? await namesOf(b.exe, b.root, 'merged', scene.current) : { ok: true, names: [] }
      if (ml.ok !== true) return ml.envelope
      merged = ml.names.indexOf(plan.name) >= 0
      decision = decideBranchDelete({ current: scene.current === plan.name, merged: merged, force: plan.force, dirty: scene.flags.stagedCount + scene.flags.unstagedCount > 0 })
    } else if (op === 'upstream') decision = { verdict: 'allow', reasons: ['ok'] }
    else if (op === 'tag-create') decision = decideTagCreate({ exists: tagOf(scene, plan.name) !== null, mode: plan.mode, message: plan.message })
    else if (op === 'tag-delete') decision = { verdict: 'allow', reasons: ['ok'] }
    else decision = decideDescriptionWrite({ branchExists: true, text: plan.text })
    // 4.5 改名到已存在的名字、4.6 删当前分支这类判定在共享层给 block；这里统一转成失败信封并回现场。
    const confirm: any = confirmOf(op, plan, scene, merged)
    if (decision.verdict === 'block') return fail('blocked', String(decision.reasons[0] || 'other'), branchReasonText(decision.reasons[0]) + '（理由：' + decision.reasons.join('、') + '）', { contract: BRANCH_CHECK_CONTRACT, version: BRANCH_CHECK_VERSION, op: op, decision: decision, reasons: decision.reasons, confirm: confirm, scene: sceneSummaryOf(scene, plan, merged), readAtMs: nowFn() })
    // 版本档必须在签票之前算好并写进计划：票里保存的就是执行层要照做的 argv 依据，
    // 计划摘要（bindingsOf 的 planDigest）也因此把 tier 算进去——预检与执行不会各判一次版本。
    const ver: any = await versionFor(b.exe, b.root, op)
    if (ver.ok !== true) return ver.envelope
    plan.tier = ver.tier
    plan.gitVersion = ver.gitVersion
    plan.capId = ver.capId
    plan.needed = ver.needed
    plan.versionAlternative = ver.alternative
    const facts: any = await factsOf(b.exe, b.root, scene, plan)
    if (facts.ok !== true) return facts.envelope
    const confirmRequired: boolean = decision.verdict === 'warn' || op === 'delete' || op === 'tag-delete'
    const ticket: any = sign(plan, b.root, scene, facts, decision, confirm, confirmRequired)
    return { ok: true, contract: BRANCH_CHECK_CONTRACT, version: BRANCH_CHECK_VERSION, op: op, decision: decision, reasons: decision.reasons, confirmRequired: confirmRequired, confirm: confirm, ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs }, scene: sceneSummaryOf(scene, plan, merged), readAtMs: nowFn() }
  }

  /** 执行前的现场重量：与预检同一套读法与同一套摘要口径；执行层只拿它算出来的绑定表去比对。 */
  async function measure(cwd: string, plan: any): Promise<any> {
    const b: any = await baseOf(cwd)
    if (b.fail) return { ok: false, envelope: b.fail }
    const scene: any = await sceneOf(b.exe, b.root, cwd)
    if (scene.ok !== true) return { ok: false, envelope: scene.envelope }
    const facts: any = await factsOf(b.exe, b.root, scene, plan)
    if (facts.ok !== true) return { ok: false, envelope: facts.envelope }
    return { ok: true, repoRoot: String(b.root), headOid: scene.headOid, bindings: bindingsOf(scene, plan, facts), scene: sceneSummaryOf(scene, plan) }
  }

  return { handleBranchCheck: handleBranchCheck, tickets: tickets, results: results, measure: measure }
}

export const BRANCH_CHECK_SOURCE = 'src/host/versionControlBranchCheck.ts'
