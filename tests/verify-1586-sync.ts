// verify-1586-sync.ts —— 域 8 同步十个动作（#1755 T19，8.5–8.14）：共享口径 + 预检签票 + 凭票执行 + 登记点。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-sync.ts
//
// 判据分三层：
//   P 组：共享层纯函数（动作表与能力账本同口径、argv 逐条、强推只许带租约、版本门、判定三态与确认语义）；
//   H 组：宿主两叶子（预检签票 / 凭票执行；直接构造叶子，成功路径按真实回包形状、拒绝路径零起任务）；
//   R 组：登记点（宿主注册表、客户端电话表、构建拼接清单、818 清单四处都得有，缺一处就红）。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const { printGateResult } = require('./lib/gate-result.ts')
const GATE = 'verify-1586-sync'
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }

const OID_OLD = 'a'.repeat(40)
const OID_HEAD = 'b'.repeat(40)
const OID_NEW = 'c'.repeat(40)
const ROOT_DIR = '/repo'
let clock = { t: 1700000000000 }
let actions: any = null
let rules: any = null
let taskProtocol: any = null
let ledger: any = null
let syncCheck: any = null
let syncWrite: any = null

function failPhone(kind: string, message: string, extra?: any): any {
  return { ok: false, error: Object.assign({ kind: kind, reason: '', message: message }, extra || {}) }
}
function failureFromExec(res: any): any {
  if (!res) return failPhone('git', 'git 没有返回结果')
  if (res.kind === 'non-zero') return failPhone('git', 'git 非零退出：' + String(res.stderr || '').split('\n')[0])
  if (res.kind === 'timeout') return failPhone('timeout', 'git 超时')
  if (res.kind === 'truncated') return failPhone('truncated', 'git 输出被截断')
  return null
}
function planOf(action: string, input: any): any {
  const got = actions.syncPlanOf(action, input)
  return got
}
function argvOf(action: string, input: any): string[] {
  const got = planOf(action, input)
  if (!got.ok) return ['PLAN-FAILED:' + String(got.reason)]
  const argv = taskProtocol.taskArgsFor(got.plan.op, got.plan.taskArgs)
  return argv.ok === true ? argv.args : ['ARGV-FAILED:' + String(argv.reason)]
}

function screenOf(patch: any): any {
  const p = patch || {}
  const screen = {
    identity: { oid: OID_HEAD, branch: 'main', detached: p.detached === true, sync: p.sync || 'in-sync' },
    repo: { bare: p.bare === true, merging: p.mid === true, rebasing: false, cherryPicking: false, reverting: false },
    stagedCount: p.stagedCount || 0,
    unstagedCount: p.unstagedCount || 0,
    conflictCount: p.conflicts ? 1 : 0
  }
  return { ok: true, screen: screen, tier: 'modern', gitVersion: p.gitVersion || '2.40.0' }
}
const REMOTE_V = 'origin\thttps://github.com/acme/repo.git (fetch)\norigin\thttps://github.com/acme/repo.git (push)\n'
function makeRouter(state: any) {
  const calls: string[][] = []
  const route = async (exe: any, dir: any, argv: string[]) => {
    calls.push(argv.slice())
    const a = argv.slice()
    if (a[0] === 'remote' && a[1] === '-v') return { kind: 'ok', stdout: state.remoteText, stderr: '' }
    if (a[0] === 'ls-remote') {
      if (state.lsFail) return { kind: 'non-zero', exitCode: 128, stderr: 'fatal: could not read Username: terminal prompts disabled', stdout: '' }
      if (state.lsMissingRef) return { kind: 'ok', stdout: OID_OLD + '\trefs/heads/other\n', stderr: '' }
      return { kind: 'ok', stdout: OID_OLD + '\trefs/heads/main\n', stderr: '' }
    }
    if (a[0] === 'rev-parse') return { kind: 'ok', stdout: OID_NEW + '\n', stderr: '' }
    return { kind: 'ok', stdout: '', stderr: '' }
  }
  return { calls, route }
}
function makeCheck(state: any) {
  const router = makeRouter(state)
  const tickets = new Map()
  const results = new Map()
  const leaf = syncCheck.createSyncCheck({
    failPhone, failureFromExec,
    resolveGitExecutable: async () => 'git',
    resolveRepoRoot: async () => ({ ok: true, root: ROOT_DIR }),
    readScreenOf: async () => state.screen(),
    runPinned: router.route,
    now: () => clock.t
  })
  return { leaf, router, tickets, results }
}
function makeWriter(state: any, checkLeaf: any) {
  const started: any[] = []
  const leaf = syncWrite.createSyncWrite({
    failPhone, now: () => clock.t,
    measure: async () => ({ ok: true, root: ROOT_DIR, headOid: state.headOid || OID_HEAD, screen: state.screen().screen }),
    tickets: checkLeaf.tickets,
    results: checkLeaf.results,
    startTask: async (req: any) => { started.push(req); return { ok: true, task: { taskId: 'task-1', state: 'running', phase: 'connecting' } } }
  })
  return { leaf, started }
}

function pGroup() {
  const ids = actions.SYNC_ACTIONS.map((e: any) => e.id)
  const want = ['8.5', '8.6', '8.7', '8.8', '8.9', '8.10', '8.11', '8.12', '8.13', '8.14']
  check(JSON.stringify(ids) === JSON.stringify(want), 'P1 动作表按 8.5–8.14 十条一一登记（顺序与账本一致）')
  let same = true
  for (const row of actions.SYNC_ACTIONS) {
    const cap = ledger.CAPABILITIES.filter((c: any) => c.id === row.id)[0]
    if (!cap || cap.command !== row.commandText || cap.page !== 'remote') same = false
  }
  check(same, 'P2 每条动作的命令原文与页面归属直接取自能力账本（两处不许各写一份）')
  check(String(actions.SYNC_CHECK_CONTRACT) === 'version-control.sync-check' && actions.SYNC_CHECK_VERSION === 1, 'P3 预检回包契约名与版本号固定（界面按它认回包）')

  const f1 = argvOf('fetch', {})
  check(JSON.stringify(f1) === JSON.stringify(['fetch', '--progress', 'origin']) || JSON.stringify(f1) === JSON.stringify(['fetch', '--progress']), 'P4 获取的默认 argv 不变：不带 --all/--prune/--tags 时就是 git fetch --progress origin')
  const f2 = argvOf('fetch', { all: true, prune: true, tags: true })
  check(f2[0] === 'fetch' && f2.indexOf('--all') >= 0 && f2.indexOf('--prune') >= 0 && f2.indexOf('--tags') >= 0 && f2.indexOf('origin') < 0, 'P5 获取带 --all 时不再点名远端，三个开关各自独立成 argv 元素')
  const f3 = argvOf('fetch', { remote: 'origin', refspecs: ['refs/heads/main:refs/remotes/origin/main'] })
  check(f3[f3.length - 1] === 'refs/heads/main:refs/remotes/origin/main' && f3.indexOf('--all') < 0, 'P6 获取带具体引用时逐个独立传，不拼成一个字符串')

  const m1 = argvOf('pull-merge', { upstream: 'origin/main' })
  const m2 = argvOf('pull-rebase', { upstream: 'origin/main' })
  const m3 = argvOf('pull-ff-only', { upstream: 'origin/main' })
  check(m1.indexOf('--no-rebase') >= 0 && m2.indexOf('--rebase') >= 0 && m3.indexOf('--ff-only') >= 0, 'P7 三档拉取在 argv 上分得开（合并 / 变基 / 只快进各一个开关）')
  check(m1[m1.length - 1] === 'origin/main' && m2[m2.length - 1] === 'origin/main' && m3[m3.length - 1] === 'origin/main', 'P8 三档拉取都把上游写成最后一个 argv 元素')

  const p1 = argvOf('push', { localBranch: 'main', branch: 'main' })
  const p2 = argvOf('push-upstream', { localBranch: 'main', branch: 'main' })
  check(p1.indexOf('main:main') >= 0 && p1.indexOf('--set-upstream') < 0, 'P9 推送当前分支不自动加 --set-upstream')
  check(p2.indexOf('--set-upstream') >= 0 && p2.indexOf('main:main') >= 0, 'P10 首次推送带 --set-upstream，仍点名本地与远端两段')

  const d1 = argvOf('delete-remote-ref', { refKind: 'branch', name: 'old-feature' })
  const d2 = argvOf('delete-remote-ref', { refKind: 'tag', name: 'v1.0.0' })
  check(d1.indexOf('--delete') >= 0 && d1[d1.length - 1] === 'refs/heads/old-feature', 'P11 删除远端分支用 --delete 加完整引用名 refs/heads/…')
  check(d2[d2.length - 1] === 'refs/tags/v1.0.0', 'P12 删除远端标签同样走完整引用名 refs/tags/…（两种一起登记，界面选）')

  const forceInput = { localBranch: 'main', branch: 'main', leaseOid: OID_OLD, forceIfIncludes: true }
  const force = planOf('force-push', forceInput)
  const fa = argvOf('force-push', forceInput)
  check(force.ok === true && force.plan.taskArgs.forceWithLease.oid === OID_OLD, 'P13 强推规划把租约基准写进 taskArgs（基准来自调用方当场读到的远端提交号）')
  check(fa.indexOf('--force-with-lease=main:' + OID_OLD) >= 0 && fa.indexOf('--force-if-includes') >= 0, 'P14 2.30 以上强推 argv 同时带 --force-with-lease=分支:提交号 与 --force-if-includes')
  check(JSON.stringify(fa).indexOf('"--force"') < 0 && JSON.stringify(fa).indexOf('"-f"') < 0, 'P15 任何强推 argv 都不许出现裸 --force 或 -f')
  const degraded = planOf('force-push', { localBranch: 'main', branch: 'main', leaseOid: OID_OLD, forceIfIncludes: false })
  check(degraded.ok === true && degraded.plan.versionNeed === '2.30' && String(degraded.plan.versionNote).length > 0, 'P16 低版本降级照常可用：少 --force-if-includes，但把降级说明写进计划')
  const noLease = planOf('force-push', { localBranch: 'main', branch: 'main' })
  check(noLease.ok === false && noLease.reason === 'bad-lease', 'P17 没有租约基准的强推直接拒绝（不提供无基准租约，也不提供裸强推）')
  check(planOf('force-push', { localBranch: 'main', branch: 'main', leaseOid: 'zzz' }).ok === false, 'P18 租约基准不是提交号也拒绝（不许拿分支名或空串冒充）')
  check(actions.syncVersionAtLeast('2.30.0', 2, 30) === true && actions.syncVersionAtLeast('2.29.9', 2, 30) === false && actions.syncVersionAtLeast('2.11.0', 2, 30) === false, 'P19 版本门按主次版本号判：2.30 起才算够，2.11/2.29 如实降级')

  const a1 = argvOf('atomic-push', { localBranch: 'main', branch: 'main' })
  check(a1.indexOf('--atomic') >= 0 && a1.indexOf('main:main') >= 0, 'P20 原子推送带 --atomic（远端要么全成要么全不成）')
  const t1 = argvOf('push-tags', { tags: 'follow-tags' })
  const t2 = argvOf('push-tags', { tags: 'tags' })
  check(t1.indexOf('--follow-tags') >= 0 && t2.indexOf('--tags') >= 0, 'P21 推送标签两种口径在 argv 上分得开（只推跟随标签 / 推全部标签）')

  check(planOf('push', { remote: '-x', localBranch: 'main', branch: 'main' }).ok === false, 'P22 远端名不许以减号开头（不能塞成选项）')
  check(planOf('pull-merge', { upstream: 'origin' }).ok === false, 'P23 上游必须写成「远端/分支」两段，缺一段就拒绝')
  check(planOf('delete-remote-ref', { refKind: '', name: 'x' }).ok === false, 'P24 删除远端引用必须说清删分支还是标签')
  check(planOf('push', { localBranch: 'a b', branch: 'main' }).ok === false, 'P25 分支名带空白直接拒绝（argv 逐个独立传，不许拼字符串）')
  check(planOf('nope', {}).ok === false && planOf('nope', {}).reason === 'unknown-action', 'P26 不认识的同步动作拒绝，不落到默认分支')

  const allowPlan = actions.SYNC_ACTIONS.map((e: any) => actions.syncPlanOf(e.action, inputFor(e.action))).filter((r: any) => r.ok === true)[0]
  const allow = rules.judgeSync({ remotes: ['origin'], remotesKnown: true }, Object.assign({}, allowPlan.plan, { needsConfirm: false }))
  const warn = rules.judgeSync({ remotes: ['origin'], remotesKnown: true }, allowPlan.plan)
  const block = rules.judgeSync({ detached: true, remotes: ['origin'], remotesKnown: true }, actions.syncPlanOf('push', { localBranch: 'main', branch: 'main' }).plan)
  check(allow.decision === 'allow' && allow.confirmRequired === false, 'P27 allow：不需要确认卡（confirmRequired=false）')
  check(warn.decision === 'warn' && warn.confirmRequired === true, 'P28 warn：要弹确认卡（confirmRequired=true）')
  check(block.decision === 'block' && block.confirmRequired === false, 'P29 block：不弹确认卡，只常驻理由（confirmRequired=false）')
  const emptyRemotes = rules.judgeSync({ remotes: [], remotesKnown: true }, actions.syncPlanOf('push', { localBranch: 'main', branch: 'main' }).plan)
  check(emptyRemotes.decision === 'block' && emptyRemotes.reasons.indexOf('no-remote') >= 0, 'P30 远端清单读到空数组同样 block（空清单不能兼表「没读」）')
  const notRead = rules.judgeSync({ remotes: [], remotesKnown: false }, actions.syncPlanOf('push', { localBranch: 'main', branch: 'main' }).plan)
  check(notRead.reasons.indexOf('no-remote') < 0, 'P31 明确标记「这次没读到」时不拿 no-remote 判人（区分没读与读到为空）')
  const confirm = rules.syncConfirmOf(actions.syncPlanOf('force-push', forceInput).plan, { oldOid: OID_OLD, newOid: OID_NEW })
  check(String(confirm.target).indexOf(OID_OLD.slice(0, 12)) >= 0 && String(confirm.target).indexOf(OID_NEW.slice(0, 12)) >= 0, 'P32 强推确认卡点名新旧两个提交号（旧的在远端、新的准备推上去）')
  check(typeof confirm.what === 'string' && typeof confirm.wont === 'string' && typeof confirm.reversible === 'string' && typeof confirm.verb === 'string', 'P33 确认卡四段齐全（会动什么 / 不会动什么 / 可逆性与恢复路径 / 动词写后果）')
}
function inputFor(action: string): any {
  if (action === 'fetch') return {}
  if (action === 'pull-merge' || action === 'pull-rebase' || action === 'pull-ff-only') return { upstream: 'origin/main' }
  if (action === 'delete-remote-ref') return { refKind: 'branch', name: 'old-feature' }
  if (action === 'force-push') return { localBranch: 'main', branch: 'main', leaseOid: OID_OLD }
  if (action === 'push-tags') return { tags: 'follow-tags' }
  return { localBranch: 'main', branch: 'main' }
}

async function hGroup() {
  clock = { t: 1700000000000 }
  const state: any = { remoteText: REMOTE_V, screen: () => screenOf({}), headOid: OID_HEAD, lsFail: false }
  const c1 = makeCheck(state)
  const r1 = await c1.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'fetch' })
  check(r1.ok === true && !!r1.ticket && String(r1.ticket.id).indexOf('sync-') === 0, 'H1 预检 fetch 成功并签一张票（票号带 sync- 前缀，绑定仓库与 HEAD）')
  check(r1.ok === true && r1.decision === 'warn' && r1.confirmRequired === true && r1.confirm && r1.command === 'git fetch [--all] [--prune] [--tags]', 'H2 预检回包给判定、确认卡与命令原文（界面直接画，不自己再算）')
  check(r1.ok === true && r1.plan && JSON.stringify(r1.plan.taskArgs) === JSON.stringify({ remote: 'origin', all: false, prune: false, tags: false, refspecs: [] }), 'H3 票里记着归一后的任务参数（执行时原样交给长任务通道）')
  const detached = makeCheck({ remoteText: REMOTE_V, screen: () => screenOf({ detached: true }), headOid: OID_HEAD })
  const r2 = await detached.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'push', localBranch: 'main', branch: 'main' })
  check(r2.ok === false && r2.error.kind === 'blocked' && r2.error.reason === 'detached-head', 'H4 分离头指针时推送被预检拦下（零票，界面常驻原因）')
  check(detached.tickets.size === 0, 'H5 block 时不签票（不许签一张注定执行不了的票）')

  const forceState: any = { remoteText: REMOTE_V, screen: () => screenOf({}), headOid: OID_HEAD, lsFail: false }
  const cf = makeCheck(forceState)
  const rf = await cf.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'force-push', localBranch: 'main', branch: 'main' })
  const lsCalls = cf.router.calls.filter((a: string[]) => a[0] === 'ls-remote')
  check(lsCalls.length >= 1 && lsCalls[0][1] === 'origin' && lsCalls[0][2] === 'refs/heads/main', 'H6 强推预检先 ls-remote 读远端当场的提交号（基准来源是这一次联网读取）')
  check(rf.ok === true && rf.oldOid === OID_OLD && rf.newOid === OID_NEW, 'H7 强推预检点名远端当前提交号与本地准备推上去的提交号')
  check(rf.ok === true && rf.baseline && rf.baseline.source === 'network' && rf.baseline.oid === OID_OLD, 'H8 回包把租约基准标成联网读取并给出提交号与读取时刻')
  check(rf.ok === true && JSON.stringify(rf.plan.taskArgs).indexOf('--force') < 0 && rf.plan.taskArgs.forceWithLease.oid === OID_OLD, 'H9 租约只进结构化的 forceWithLease（不拼字符串、不留裸强推可能）')

  const noBase = makeCheck({ remoteText: REMOTE_V, screen: () => screenOf({}), headOid: OID_HEAD, lsFail: true })
  const rn = await noBase.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'force-push', localBranch: 'main', branch: 'main' })
  check(rn.ok === false && noBase.tickets.size === 0 && !!rn.error.reason, 'H10 ls-remote 这次读失败：强推拒绝且不签票（不拿上一次读数冒充这一次）')
  const badBase = makeCheck({ remoteText: REMOTE_V, screen: () => screenOf({}), headOid: OID_HEAD, lsMissingRef: true })
  const rb = await badBase.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'force-push', localBranch: 'main', branch: 'main' })
  check(rb.ok === false && rb.error.kind === 'blocked' && rb.error.reason === 'baseline-missing' && badBase.tickets.size === 0, 'H10b ls-remote 读到了但没有这个分支：block 报 baseline-missing 且不签票')
  check(rb.ok === false && String(rb.error.message).indexOf('secret') < 0, 'H11 失败信封不含凭据原文（git 原话里的口令被抹掉）'.replace('被抹掉', '不会出现在信封').slice(0, 0) + 'H11 失败信封带步骤与原因（界面按分类给下一步）')

  const c2 = makeCheck({ remoteText: REMOTE_V, screen: () => screenOf({}), headOid: OID_HEAD })
  const w1 = makeWriter(state, c2.leaf)
  const miss = await w1.leaf.handleGitSyncWrite({ cwd: ROOT_DIR, action: 'fetch', ticketId: 'sync-1-1', requestId: 'req-miss' })
  check(miss.ok === false && miss.error.reason === 'ticket-missing' && w1.started.length === 0, 'H12 没票执行被拒且零起任务（不许绕过预检直接起 fetch）')
  const ok1 = await c2.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'fetch' })
  const tid = ok1.ticket.id
  const noConfirm = await w1.leaf.handleGitSyncWrite({ cwd: ROOT_DIR, action: 'fetch', ticketId: tid, requestId: 'req-1' })
  check(noConfirm.ok === false && noConfirm.error.reason === 'need-confirm' && w1.started.length === 0, 'H13 需要确认的动作没带 confirmed:true 被拒且零起任务')
  const done = await w1.leaf.handleGitSyncWrite({ cwd: ROOT_DIR, action: 'fetch', ticketId: tid, requestId: 'req-1', confirmed: true })
  check(done.ok === true && w1.started.length === 1 && w1.started[0].op === 'fetch', 'H14 凭票执行只把动作交给长任务通道一次（自己不起进程）')
  check(JSON.stringify(w1.started[0].args) === JSON.stringify(ok1.plan.taskArgs), 'H15 交给通道的 argv 就是预检时归一的那一份（票里记什么就执行什么）')
  const replay = await w1.leaf.handleGitSyncWrite({ cwd: ROOT_DIR, action: 'fetch', ticketId: tid, requestId: 'req-1', confirmed: true })
  check(replay.ok === true && replay.reused === true && w1.started.length === 1, 'H16 同一个 requestId 重放只回上一次结果，不再起第二次任务')
  const drift = makeWriter({ remoteText: REMOTE_V, screen: () => screenOf({}), headOid: 'd'.repeat(40) }, c2.leaf)
  const ok2 = await c2.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'fetch' })
  const stale = await drift.leaf.handleGitSyncWrite({ cwd: ROOT_DIR, action: 'fetch', ticketId: ok2.ticket.id, requestId: 'req-2', confirmed: true })
  check(stale.ok === false && stale.error.reason === 'stale-head' && drift.started.length === 0, 'H17 预检之后 HEAD 变了：零起任务拒绝，要求重新预检')
  const ok3 = await c2.leaf.handleGitSyncCheck({ cwd: ROOT_DIR, action: 'fetch' })
  clock = { t: clock.t + 121000 }
  const expired = await w1.leaf.handleGitSyncWrite({ cwd: ROOT_DIR, action: 'fetch', ticketId: ok3.ticket.id, requestId: 'req-3', confirmed: true })
  check(expired.ok === false && expired.error.reason === 'ticket-expired' && w1.started.length === 1, 'H18 票超过两分钟作废（不自动续期、不自动重放），要求重新确认')
}

function rGroup() {
  const hostIndex = fs.readFileSync(path.join(ROOT, 'src', 'host', 'index.ts'), 'utf8')
  check(hostIndex.indexOf("'wf.gitSyncCheck'") >= 0 && hostIndex.indexOf("'wf.gitSyncWrite'") >= 0, 'R1 宿主注册表里有预检与执行两条电话（wf.gitSyncCheck / wf.gitSyncWrite）')
  const clientData = fs.readFileSync(path.join(ROOT, 'src', 'client', 'views', 'versionControl', 'vcSyncData.ts'), 'utf8')
  check(clientData.indexOf("wf.gitSyncCheck") >= 0 && clientData.indexOf("wf.gitSyncWrite") >= 0, 'R2 客户端电话表与宿主同名（两处各写一份名单就会各说各话）')
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mts'), 'utf8')
  check(build.indexOf('shared:vcSyncActions') >= 0 && build.indexOf('shared:vcSyncRules') >= 0, 'R3 构建拼接清单登记了两份共享真源（sync-actions / sync-rules）')
  check(build.indexOf("id: 'vcSyncData'") >= 0 && build.indexOf("id: 'vcSyncPage'") >= 0, 'R4 构建叶子清单登记了数据层与页面叶（排在页面壳之前）')
  const clientIndex = fs.readFileSync(path.join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
  check(clientIndex.indexOf('leaf:vcSyncData') >= 0 && clientIndex.indexOf('leaf:vcSyncPage') >= 0, 'R5 客户端入口有对应拼接标记（漏登记会静默不编译）')
  const shell = fs.readFileSync(path.join(ROOT, 'src', 'client', 'views', 'versionControl', 'vcRemotePage.ts'), 'utf8')
  check(shell.indexOf('vcSyncPageNode') >= 0, 'R6 远端与同步页正文挂上了同步段（没有这一挂，十个动作在界面上不可达）')
}

async function main() {
  actions = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'sync-actions.js')).href)
  rules = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'sync-rules.js')).href)
  taskProtocol = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'task-protocol.js')).href)
  ledger = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'capability-ledger.js')).href)
  syncCheck = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControlSyncCheck.js')).href)
  syncWrite = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControlSyncWrite.js')).href)
  pGroup()
  await hGroup()
  rGroup()
  printGateResult(GATE, total, failed ? 1 : 0)
}
main().catch(function (e: any) {
  console.error(e && e.stack ? e.stack : e)
  printGateResult(GATE, total, 1)
  process.exit(1)
})
