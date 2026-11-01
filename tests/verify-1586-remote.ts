// verify-1586-remote.ts —— 域 8 远端与同步（#1754 T18）：共享层纯函数 + 宿主远端电话。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-remote.ts
//
// 判据分三层：
//   P 组：共享层纯函数（git remote -v / for-each-ref / ls-remote 的解析、argv、输入校验、联网失败分类）；
//   H 组：宿主电话（真 subprocess 形状的垫片 + 会真的改状态的假 git；写动作后必须重读、截断与失败不给半份、
//         同一远端同一时刻只飞一个 ls-remote、日志不带凭据原文）；
//   R 组：电话登记点（宿主注册表与客户端电话表两边都得有，缺一处就红）。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const { printGateResult } = require('./lib/gate-result.ts')
const GATE = 'verify-1586-remote'
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }

// git.exec 的字段白名单：这十个键是既有事件的全部字段，远端电话只许复用、不许往里加新键。
// 判据遍历 fields 的每一个键，而不是只看第一个有值的键——只看第一个的话，把非法键放在第二个位置就漏过去了。
const GIT_EXEC_FIELDS = ['argv0', 'cwdHash', 'cmd', 'argc', 'latencyMs', 'exitCode', 'stdoutBytes', 'truncated', 'stdinBytes', 'via']
const gitExecFieldsOk = (fields: unknown): boolean => Object.keys((fields as Record<string, unknown>) || {}).every((k) => GIT_EXEC_FIELDS.indexOf(k) >= 0)

// ---------- P 组夹具：真 git 的输出形状 ----------
const NUL = '\u0000'
const OID_A = 'a'.repeat(40)
const OID_B = 'b'.repeat(40)
const FIXTURE_REMOTE_V = [
  'origin\thttps://github.com/acme/repo.git (fetch)',
  'origin\thttps://github.com/acme/repo.git (push)',
  'mirror\tgit@github.com:acme/mirror.git (fetch)',
  'mirror\tgit@github.com:acme/mirror.git (push)',
  'leaky\thttps://user:secret-token@example.com/acme/leaky.git (fetch)',
  'leaky\thttps://user:secret-token@example.com/acme/leaky.git (push)',
  '',
].join('\n')
const FIXTURE_BRANCHES = [
  'refs/remotes/origin/main' + NUL + OID_A,
  'refs/remotes/origin/release/1.0' + NUL + OID_B,
  'refs/remotes/origin/HEAD' + NUL + OID_A,
  '',
].join('\n')
const FIXTURE_LS_REMOTE = [
  OID_A + '\trefs/heads/main',
  OID_B + '\trefs/heads/release/1.0',
  'c'.repeat(40) + '\trefs/tags/v1.0.0',
  'd'.repeat(40) + '\trefs/tags/v1.0.0^{}',
  '',
].join('\n')

const spawns: string[][] = []
const logs: Array<{ level: string; event: string; fields: Record<string, any> }> = []
const requests: Array<{ argv: string[]; env: any }> = []
let clock = { t: 1700000000000 }
let vcMod: any = null
let remote: any = null

// 会真的记住状态的假 git：写动作改一份远端表，随后的重读看得到变化；联网那一路可以挂住不返回。
function statefulGit() {
  const state = {
    remotes: [
      { name: 'origin', url: 'https://github.com/acme/repo.git' },
      { name: 'mirror', url: 'git@github.com:acme/mirror.git' },
      { name: 'leaky', url: 'https://user:secret-token@example.com/acme/leaky.git' },
    ],
    online: 'ok' as 'ok' | 'pending' | 'denied' | 'truncated',
  }
  const route = (argv: string[]) => {
    const a = after(argv)
    const sub = a[0] || ''
    if (sub === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return { code: 0, stdout: ROOT + '\\.git\ntrue\nfalse\n' }
    if (sub === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: ROOT + '\n' }
    if (sub === 'remote' && a[1] === '-v') {
      const lines = state.remotes.map((r) => r.name + '\t' + r.url + ' (fetch)\n' + r.name + '\t' + r.url + ' (push)').join('\n') + '\n'
      return { code: 0, stdout: lines }
    }
    if (sub === 'remote' && a[1] === 'add') { state.remotes.push({ name: a[3], url: a[4] }); return { code: 0 } }
    if (sub === 'remote' && a[1] === 'remove') { state.remotes = state.remotes.filter((r) => r.name !== a[3]); return { code: 0 } }
    if (sub === 'remote' && a[1] === 'rename') { for (const r of state.remotes) if (r.name === a[3]) r.name = a[4]; return { code: 0 } }
    if (sub === 'remote' && a[1] === 'set-url') { for (const r of state.remotes) if (r.name === a[3]) r.url = a[4]; return { code: 0 } }
    if (sub === 'for-each-ref') {
      const spec = a[1] || ''
      const name = spec.replace('refs/remotes/', '').replace(/\/$/, '')
      if (state.remotes.every((r) => r.name !== name)) return { code: 0, stdout: '' }
      return { code: 0, stdout: 'refs/remotes/' + name + '/main' + NUL + OID_A + '\n' + 'refs/remotes/' + name + '/HEAD' + NUL + OID_A + '\n' }
    }
    if (sub === 'ls-remote') {
      if (state.online === 'denied') return { code: 128, stderr: "fatal: could not read Username for 'https://user:secret-token@example.com': terminal prompts disabled" }
      if (state.online === 'truncated') return { code: 0, stdout: FIXTURE_LS_REMOTE, truncated: true }
      return { code: 0, stdout: FIXTURE_LS_REMOTE, pending: state.online === 'pending' }
    }
    return { code: 0, stdout: '' }
  }
  return { state, route }
}
function makeVc(route: (argv: string[]) => any) {
  spawns.length = 0
  requests.length = 0
  const deps = {
    subprocess: {
      spawn(req: any) {
        spawns.push(req.argv.slice())
        requests.push({ argv: req.argv.slice(), env: req.env })
        const hit = route(req.argv) || { code: 0, stdout: '' }
        const pending = hit.pending ? new Promise(() => {}) : Promise.resolve({ exitCode: hit.code || 0 })
        const mk = (text: any, truncated: any) => ({ finalize: () => ({ text: String(text || ''), truncated: truncated === true }) })
        const handle: any = { done: pending, collected: { stdout: mk(hit.stdout, hit.truncated), stderr: mk(hit.stderr) }, terminate() { handle.terminated = true } }
        if (hit.throwOnSpawn) handle.done = Promise.reject(new Error('spawn ENOENT'))
        return handle
      },
    },
    timer: { timeout: () => new Promise(() => {}) },
    fs: { stat: async () => ({}), lstat: async () => ({}), exists: async () => true },
    getPlatform: async () => ({ resolveExecutable: async (n: string) => (n === 'git' ? 'git' : null) }),
    DEFAULT_CWD: ROOT, TIMEOUT_MS: 30000, gate: { noteOutbound() {} },
    logCtx: { fire(level: string, event: string, fields: any) { logs.push({ level, event, fields }) } },
    now: () => clock.t,
  }
  return vcMod.createVersionControl(deps)
}
// 固定前缀的最后一项是 i18n.logOutputEncoding=UTF-8：切在它之后才是真正的子命令（与 verify-841 同一口径）。
function after(argv: string[]): string[] { const i = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return i < 0 ? argv : argv.slice(i + 1) }
function subOf(argv: string[]): string { return after(argv)[0] || '' }
function countOf(sub: string, arg1?: string): number { return spawns.filter((a) => { const x = after(a); return x[0] === sub && (arg1 === undefined || x[1] === arg1) }).length }
function allLogText(): string { return logs.map((l) => JSON.stringify(l)).join('\n') }

function pGroup() {
  const list = remote.parseRemoteList(FIXTURE_REMOTE_V)
  check(list.ok === true && list.remotes.length === 3, 'P1 git remote -v 解析出三条远端（fetch/push 成对，不拆成两条）')
  check(list.ok === true && list.remotes[0].name === 'origin' && list.remotes[0].fetchUrl === 'https://github.com/acme/repo.git' && list.remotes[0].pushUrl === 'https://github.com/acme/repo.git', 'P2 每条远端带 fetch 与 push 地址（同一个地址也分开写，界面能分别说）')
  const leaky = list.ok === true ? list.remotes.filter((r: any) => r.name === 'leaky')[0] : null
  check(!!leaky && leaky.fetchUrl.indexOf('secret-token') < 0 && leaky.hasCredential === true, 'P3 地址里的口令在展示值里被抹掉（不展示凭据原文，只标出这条带凭据）')
  const half = remote.parseRemoteList('origin\thttps://x/y.git (fetch)\n')
  check(half.ok === false && half.error === 'remote-list-malformed' && !half.remotes, 'P4 只有 fetch 没有 push 的记录算整体读不全（不给半份）')
  check(remote.parseRemoteList('origin\thttps://x/y.git\n').ok === false, 'P5 字段数不对的行走整体解析失败（不静默丢掉那一行）')
  check(remote.parseRemoteList('origin\thttps://x/1.git (fetch)\norigin\thttps://x/2.git (fetch)\n').ok === false, 'P6 同一远端两条 fetch 记录冲突：整体失败（不猜用哪一个）')
  check(remote.parseRemoteList('').ok === true && remote.parseRemoteList('').remotes.length === 0, 'P7 空输出就是零个远端（不是失败）')

  const branches = remote.parseRemoteBranches(FIXTURE_BRANCHES, 'origin')
  check(branches.ok === true && branches.branches.length === 2, 'P8 远端跟踪分支解析出两条（origin/HEAD 这个别名不算一条分支）')
  check(branches.ok === true && branches.branches[0].short === 'main' && branches.branches[0].name === 'origin/main' && branches.branches[0].oid === OID_A, 'P9 分支短名去掉远端前缀，另留完整跟踪名与提交号')
  check(remote.parseRemoteBranches('refs/remotes/origin/main\n', 'origin').ok === false, 'P10 分支记录字段数不对：整体解析失败')

  const ls = remote.parseLsRemote(FIXTURE_LS_REMOTE)
  check(ls.ok === true && ls.refs.length === 4, 'P11 ls-remote 输出逐行解析（分支、标签、标签的解引用行都收下）')
  check(ls.ok === true && ls.refs[0].oid === OID_A && ls.refs[0].ref === 'refs/heads/main' && ls.refs[0].kind === 'branch', 'P12 引用记录带提交号、完整引用名与分支/标签类型')
  check(remote.parseLsRemote('not-a-oid\trefs/heads/main\n').ok === false, 'P13 提交号不是十六进制：整体失败（不画半份引用清单）')
  check(remote.parseLsRemote('').ok === true && remote.parseLsRemote('').refs.length === 0, 'P14 空输出就是零引用（不是失败）')

  check(remote.remoteListArgs().join(',') === 'remote,-v', 'P15 列表命令形状固定为 git remote -v')
  check(remote.remoteAddArgs('origin', 'https://x/y.git').join(',') === 'remote,add,--,origin,https://x/y.git', 'P16 登记远端：名字与地址都是独立 argv 元素、排在 -- 之后')
  check(remote.remoteRenameArgs('a', 'b').join(',') === 'remote,rename,--,a,b' && remote.remoteRemoveArgs('a').join(',') === 'remote,remove,--,a' && remote.remoteSetUrlArgs('a', 'https://x/y.git').join(',') === 'remote,set-url,--,a,https://x/y.git', 'P17 改名 / 删除 / 改地址三件事的 argv 各自固定、参数独立')
  check(remote.lsRemoteArgs('origin', ['main', 'refs/tags/v1']).join(',') === 'ls-remote,origin,main,refs/tags/v1', 'P18 联网查看：远端名与引用名都按独立 argv 直传，拼不出自选选项')
  const allArgv = [remote.remoteListArgs(), remote.remoteBranchesArgs('origin'), remote.remoteAddArgs('a', 'b'), remote.remoteRenameArgs('a', 'b'), remote.remoteRemoveArgs('a'), remote.remoteSetUrlArgs('a', 'b'), remote.lsRemoteArgs('a', ['b'])].map((x) => x.join('\u0001')).join('\u0002')
  check(['--upload-pack', '--exec', '--server-option', '--depth'].every((bad) => allArgv.indexOf(bad) < 0), 'P19 四条禁用选项一个都不许进 argv')

  check(remote.remoteNameProblem('') === 'empty' && remote.remoteNameProblem('origin') === null, 'P20 远端名：空名字拒绝、正常名字放行')
  check(remote.remoteNameProblem('-x') === 'leading-dash' && remote.remoteNameProblem('a b') === 'whitespace' && remote.remoteNameProblem('a\u0000b') === 'control' && remote.remoteNameProblem('a'.repeat(300)) === 'too-long', 'P21 远端名：前导减号、空白、控制字符、过长都拒绝')
  check(remote.remoteNameProblem('上游/主分支') === null, 'P22 非 ASCII 远端名照 git 的规则放行（不用 ASCII 白名单误杀）')
  check(remote.remoteUrlProblem('') === 'empty' && remote.remoteUrlProblem('https://github.com/acme/repo.git') === null && remote.remoteUrlProblem('git@github.com:acme/repo.git') === null, 'P23 地址：空地址拒绝，https 与 scp 风格都放行')
  check(remote.remoteUrlProblem('-x') === 'leading-dash' && remote.remoteUrlProblem('a b') === 'whitespace' && remote.remoteUrlProblem('https://x/y\nz') === 'control' && remote.remoteUrlProblem('javascript:alert(1)') === 'scheme', 'P24 地址：前导减号、空白、控制字符、不认识的协议都拒绝')
  check(remote.remoteUrlProblem('C:\\repos\\repo.git') === null && remote.remoteUrlProblem('/srv/git/repo.git') === null, 'P25 地址：本机绝对路径放行（离线仓库也是合法地址）')
  check(remote.remoteRefSelectorProblem('main') === null && remote.remoteRefSelectorProblem('refs/tags/v1.0') === null, 'P26 引用选择器：分支短名与完整引用名都放行')
  check(remote.remoteRefSelectorProblem('') === 'empty' && remote.remoteRefSelectorProblem('-x') === 'leading-dash' && remote.remoteRefSelectorProblem('a b') === 'whitespace' && remote.remoteRefSelectorProblem('a..b') === 'shape', 'P27 引用选择器：空、前导减号、空白与非法形状都拒绝')

  const kinds = [
    remote.classifyLsRemoteFailure({ kind: 'timeout', timeoutMs: 1 }).kind,
    remote.classifyLsRemoteFailure({ kind: 'non-zero', exitCode: 128, stderr: "fatal: could not read Username for 'https://example.com': terminal prompts disabled" }).kind,
    remote.classifyLsRemoteFailure({ kind: 'non-zero', exitCode: 128, stderr: 'fatal: unable to access ... Could not resolve host: example.com' }).kind,
    remote.classifyLsRemoteFailure({ kind: 'non-zero', exitCode: 128, stderr: "fatal: repository 'xyz' not found" }).kind,
    remote.classifyLsRemoteFailure({ kind: 'ok', stdout: '', truncated: true }).kind,
    remote.classifyLsRemoteFailure({ kind: 'non-zero', exitCode: 1, stderr: 'fatal: something else' }).kind,
  ]
  check(kinds.join(',') === 'timeout,needs-credential,no-network,remote-missing,truncated,other', 'P28 联网失败按 ADR 至少五类分开：超时 / 要凭据 / 没网络 / 远端不在或没权限 / 输出截断，其余归其他')
  const leakFail = remote.classifyLsRemoteFailure({ kind: 'non-zero', exitCode: 128, stderr: 'fatal: unable to access https://user:secret-token@example.com/x.git: 403' })
  check(leakFail.message.indexOf('secret-token') < 0 && leakFail.hint.length > 0, 'P29 失败原话里的口令也抹掉，并给下一步（去终端登录一次之类）')
  check(remote.classifyLsRemoteFailure({ kind: 'non-zero', exitCode: 128, stderr: 'Could not resolve host: x' }).kind === 'no-network' && remote.classifyLsRemoteFailure({ kind: 'spawn-failed', message: 'ENOENT' }).kind === 'other', 'P30 起进程失败（git 不存在）不冒充没网络，归其他')
}

async function hGroup() {
  const repo = statefulGit()
  const vc = makeVc(repo.route)
  const listed = await vc.handleGitRemoteList({ cwd: ROOT })
  check(listed.ok === true && listed.source === 'local' && listed.remotes.length === 3, 'H1 远端列表走本地 git remote -v + for-each-ref，标成「本地记录」')
  check(listed.ok === true && listed.readAtMs === clock.t && listed.remotes[0].branchCount === 1 && listed.remotes[0].branches[0].short === 'main', 'H2 列表带读取时刻与每个远端的跟踪分支（分支持久化在同一个回包里）')
  check(spawns.every((a) => subOf(a) !== 'ls-remote'), 'H3 打开列表不联网：一次 ls-remote 都没跑（联网只在显式点击后）')
  check(listed.ok === true && listed.remotes.map((r: any) => r.name).join(',') === 'origin,mirror,leaky', 'H4 列表按 git 输出顺序给远端，不重排')
  const leak = listed.ok === true ? listed.remotes.filter((r: any) => r.name === 'leaky')[0] : null
  check(!!leak && JSON.stringify(leak).indexOf('secret-token') < 0, 'H5 回包里不出现地址中的口令原文')

  // 假 git 要能过「确认仓库根」那一步，只在 git remote -v 这一条上给出半份输出。
  const badVc = makeVc((argv: string[]) => {
    const a = after(argv)
    if (a[0] === 'rev-parse' && a.indexOf('--is-inside-work-tree') >= 0) return { code: 0, stdout: ROOT + '\\.git\ntrue\nfalse\n' }
    if (a[0] === 'rev-parse' && a.indexOf('--show-toplevel') >= 0) return { code: 0, stdout: ROOT + '\n' }
    if (a[0] === 'remote' && a[1] === '-v') return { code: 0, stdout: 'origin\thttps://x/y (fetch)\n' }
    return { code: 0, stdout: '' }
  })
  const bad = await badVc.handleGitRemoteList({ cwd: ROOT })
  check(bad.ok === false && bad.error.kind === 'parse' && bad.error.reason === 'remote-list-malformed', 'H6 列表读不全时明确报解析失败（不给半份列表）')

  /** 写子命令计数：只数真正动手的四条（add / rename / remove / set-url），读列表与联网不算。 */
  const writeCountOf = () => spawns.filter((a) => subOf(a) === 'remote' && ['add', 'remove', 'rename', 'set-url'].indexOf(after(a)[1]) >= 0).length
  /** 凭票执行时要带的三个固定字段：票号、请求号、确认标记。 */
  const ticketArgsOf = (ticket: any, requestId: string, extra: any) => Object.assign({ cwd: ROOT, ticketId: ticket.ticket.id, requestId: requestId, confirmed: true }, extra || {})

  // 第一段：预检只读列表、签到票；目标门槛（名字 / 地址 / 已存在）也都在预检就判，写进程一个都不起。
  const vcAdd = makeVc(repo.route)
  clock.t = 1700000001000
  const addCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'add', name: 'upstream', url: 'https://github.com/acme/up.git' })
  check(addCheck.ok === true && !!addCheck.ticket && addCheck.ticket.checkedAtMs === clock.t && addCheck.ticket.expiresAtMs - addCheck.ticket.checkedAtMs === 120000, 'H7 远端写先预检签票：票记下检查时刻，有效期 120 秒（与贮藏写动作同一套口径）')
  check(addCheck.ok === true && addCheck.action === 'add' && addCheck.command === 'git remote add' && String(addCheck.ticket.id).indexOf('rt') === 0, 'H7b 预检回包点名动作与 git 子命令，票号带 rt 前缀')
  check(writeCountOf() === 0, 'H7c 预检只读远端列表，一个写进程都不起')
  check(addCheck.ok === true && (addCheck.remotes || []).length === 3 && addCheck.remotes.every((r: any) => r.name !== undefined && r.fetchUrl !== undefined && r.pushUrl !== undefined), 'H8 预检回包带远端列表摘要（每个远端的名字与 fetch/push 地址）')
  check(addCheck.ok === true && addCheck.plan && addCheck.plan.name === 'upstream' && addCheck.plan.url === 'https://github.com/acme/up.git', 'H8b 票据绑定这一次的目标：名字与地址都在 plan 里')
  const added = await vcAdd.handleGitRemoteAdd(ticketArgsOf(addCheck, 'rq-add-1', { name: 'upstream', url: 'https://github.com/acme/up.git' }))
  const addArgv = spawns.filter((a) => subOf(a) === 'remote' && after(a)[1] === 'add')[0] || []
  check(addArgv.length > 0 && after(addArgv).join(',') === 'remote,add,--,upstream,https://github.com/acme/up.git', 'H9 凭票登记远端用固定 argv（名字与地址独立、排在 -- 之后）')
  check(addArgv.indexOf('--force') < 0 && addArgv.indexOf('-f') < 0, 'H9b 登记远端不带任何自选选项（参数只有名字与地址）')
  check(added.ok === true && added.action === 'add' && added.command === 'git remote add' && added.n === 1, 'H9c 登记成功的回包带 git 子命令名、作用对象数与耗时')
  check(added.ok === true && added.after && added.after.remotes.indexOf('upstream') >= 0, 'H9d 写动作后重新读一遍远端列表（用真实状态说话，不把「发出去」当「成了」）')
  const nWriteAfterAdd = writeCountOf()
  const ticketless = await vcAdd.handleGitRemoteAdd({ cwd: ROOT, name: 'later', url: 'https://x/y', requestId: 'rq-ticketless', confirmed: true })
  check(ticketless.ok === false && ticketless.error.reason === 'ticket-missing' && writeCountOf() === nWriteAfterAdd, 'H10 没有预检票的写电话：零进程拒绝（面板不会发，直发也挡下）')
  const unconfirmed = await vcAdd.handleGitRemoteAdd({ cwd: ROOT, name: 'later', url: 'https://x/y', ticketId: addCheck.ticket.id, requestId: 'rq-unconfirmed' })
  check(unconfirmed.ok === false && unconfirmed.error.reason === 'not-confirmed' && writeCountOf() === nWriteAfterAdd, 'H11 有票但没经过确认卡（confirmed 缺省）：零进程拒绝')
  const nameBadCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'add', name: '-x', url: 'https://x/y' })
  check(nameBadCheck.ok === false && nameBadCheck.error.reason === 'remote-name' && writeCountOf() === nWriteAfterAdd, 'H12 名字不合法在预检就拒绝：零写进程（参数注入不进 argv）')
  const addUrlBadCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'add', name: 'newremote', url: 'javascript:alert(1)' })
  check(addUrlBadCheck.ok === false && addUrlBadCheck.error.reason === 'remote-url' && writeCountOf() === nWriteAfterAdd, 'H13 地址不合法在预检就拒绝：零写进程')
  const dupCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'add', name: 'origin', url: 'https://x/y' })
  check(dupCheck.ok === false && dupCheck.error.reason === 'remote-exists' && writeCountOf() === nWriteAfterAdd, 'H14 同名远端已存在在预检就拒绝：零写进程')

  // 改名 / 删除 / 改地址：三次都走「预检拿票 → 凭票执行」，顺带守住旧两步流程不再出现。
  const renameCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'rename', from: 'origin', to: 'backup' })
  const renamed = renameCheck.ok === true ? await vcAdd.handleGitRemoteRename(ticketArgsOf(renameCheck, 'rq-ren-1', { from: 'origin', to: 'backup' })) : { ok: false }
  const renameArgv = spawns.filter((a) => subOf(a) === 'remote' && after(a)[1] === 'rename')[0] || []
  check(renameCheck.ok === true && renamed.ok === true && renamed.action === 'rename' && renamed.command === 'git remote rename', 'H15 改名：先预检签票、再凭票执行，回包说明这次做的是改名')
  check(renameArgv.length > 0 && after(renameArgv).join(',') === 'remote,rename,--,origin,backup', 'H15b 改名 argv 固定（旧名与新名独立、排在 -- 之后）')
  const nWriteAfterRename = writeCountOf()
  const renameBadCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'rename', from: 'backup', to: '-x' })
  check(renameBadCheck.ok === false && renameBadCheck.error.reason === 'remote-name' && writeCountOf() === nWriteAfterRename, 'H16 改名目标名字不合法在预检就拒绝：零写进程')
  const renameSameCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'rename', from: 'backup', to: 'backup' })
  check(renameSameCheck.ok === false && renameSameCheck.error.reason === 'remote-unchanged' && writeCountOf() === nWriteAfterRename, 'H16b 改成一个名字在预检就拒绝：零写进程（不做无意义动作）')

  const removeCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'remove', name: 'mirror' })
  const removed = removeCheck.ok === true ? await vcAdd.handleGitRemoteRemove(ticketArgsOf(removeCheck, 'rq-rem-1', { name: 'mirror' })) : { ok: false }
  const removeArgv = spawns.filter((a) => subOf(a) === 'remote' && after(a)[1] === 'remove')[0] || []
  check(removeArgv.length > 0 && after(removeArgv).join(',') === 'remote,remove,--,mirror', 'H17 删除远端：argv 固定、名字独立')
  check(removed.ok === true && removed.action === 'remove' && removed.before && removed.before.exists === true && removed.after && removed.after.remotes.indexOf('mirror') < 0, 'H18 删除回包带动手前后的状态（界面据此说清删掉的是哪一个）')
  const nWriteAfterRemove = writeCountOf()
  const removeMissingCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'remove', name: 'nope' })
  check(removeMissingCheck.ok === false && removeMissingCheck.error.reason === 'remote-missing' && writeCountOf() === nWriteAfterRemove, 'H19 删一个不存在的远端在预检就拒绝：零写进程')

  const urlCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'setUrl', name: 'backup', url: 'git@github.com:acme/new.git' })
  const setUrl = urlCheck.ok === true ? await vcAdd.handleGitRemoteSetUrl(ticketArgsOf(urlCheck, 'rq-url-1', { name: 'backup', url: 'git@github.com:acme/new.git' })) : { ok: false }
  const setUrlArgv = spawns.filter((a) => subOf(a) === 'remote' && after(a)[1] === 'set-url')[0] || []
  check(setUrl.ok === true && setUrl.action === 'setUrl' && setUrl.command === 'git remote set-url' && setUrl.name === 'backup', 'H20 改地址成功，回包点名改了哪个远端')
  check(setUrlArgv.length > 0 && after(setUrlArgv).join(',') === 'remote,set-url,--,backup,git@github.com:acme/new.git', 'H20b 改地址 argv 固定（名字与地址独立、排在 -- 之后）')
  const nWriteAfterUrl = writeCountOf()
  const setUrlBadCheck = await vcAdd.handleGitRemoteCheck({ cwd: ROOT, action: 'setUrl', name: 'backup', url: 'a b' })
  check(setUrlBadCheck.ok === false && setUrlBadCheck.error.reason === 'remote-url' && writeCountOf() === nWriteAfterUrl, 'H20c 改地址传了含空白的地址在预检就拒绝：零写进程')

  // 反证一：票据过期。签发之后把时钟拨到有效期那一刻，执行电话必须一个进程都不起。
  const expRepo = statefulGit()
  const expVc = makeVc(expRepo.route)
  const expCheck = await expVc.handleGitRemoteCheck({ cwd: ROOT, action: 'add', name: 'later', url: 'https://x/y' })
  clock.t = expCheck.ok === true ? expCheck.ticket.expiresAtMs : clock.t
  const expSpawns = spawns.length
  const expired = await expVc.handleGitRemoteAdd({ cwd: ROOT, ticketId: expCheck.ticket.id, requestId: 'rq-exp-1', confirmed: true, name: 'later', url: 'https://x/y' })
  check(expCheck.ok === true && expired.ok === false && expired.error.kind === 'stale' && expired.error.reason === 'ticket-expired' && spawns.length === expSpawns, 'H20d 票据过期后凭票执行：一个 git 进程都不起（只回「重新预检」）')

  // 反证二：同一个 requestId 重放：回同一份结果，不再起写进程（重放去重）。
  const replayRepo = statefulGit()
  const replayVc = makeVc(replayRepo.route)
  clock.t = 1700000004000
  const replayCheck = await replayVc.handleGitRemoteCheck({ cwd: ROOT, action: 'add', name: 'replay', url: 'https://git.example/r.git' })
  const replayArgs = Object.assign({ cwd: ROOT, ticketId: replayCheck.ticket.id, requestId: 'rq-replay-1', confirmed: true }, { name: 'replay', url: 'https://git.example/r.git' })
  const firstRun = await replayVc.handleGitRemoteAdd(replayArgs)
  const replayWrites = writeCountOf()
  const secondRun = await replayVc.handleGitRemoteAdd(replayArgs)
  check(firstRun.ok === true && JSON.stringify(secondRun) === JSON.stringify(firstRun) && writeCountOf() === replayWrites, 'H20e 同一个 requestId 重放：回同一份结果且不再起写进程（requestId 去重）')

  // 反证三：预检之后远端列表变了（改地址 / 多一条），绑定摘要不一致 → 写进程不起，要求重新预检。
  const driftRepo = statefulGit()
  const driftVc = makeVc(driftRepo.route)
  const driftCheck = await driftVc.handleGitRemoteCheck({ cwd: ROOT, action: 'remove', name: 'mirror' })
  driftRepo.state.remotes[1].url = 'https://changed.example/mirror.git'
  const driftWrites = writeCountOf()
  const drift = await driftVc.handleGitRemoteRemove({ cwd: ROOT, ticketId: driftCheck.ticket.id, requestId: 'rq-drift-1', confirmed: true, name: 'mirror' })
  check(drift.ok === false && drift.error.kind === 'stale' && drift.error.reason === 'target-changed' && writeCountOf() === driftWrites, 'H20f 预检之后目标远端的地址被改：绑定摘要不一致，零写进程要求重新预检')
  const drift2Repo = statefulGit()
  const drift2Vc = makeVc(drift2Repo.route)
  const drift2Check = await drift2Vc.handleGitRemoteCheck({ cwd: ROOT, action: 'add', name: 'later', url: 'https://x/y' })
  drift2Repo.state.remotes.push({ name: 'extra', url: 'https://extra.example/x.git' })
  const drift2Writes = writeCountOf()
  const drift2 = await drift2Vc.handleGitRemoteAdd({ cwd: ROOT, ticketId: drift2Check.ticket.id, requestId: 'rq-drift-2', confirmed: true, name: 'later', url: 'https://x/y' })
  check(drift2.ok === false && drift2.error.reason === 'target-changed' && writeCountOf() === drift2Writes, 'H20g 预检之后列表多了一条远端：同样判绑定不一致，零写进程')

  const onlineRepo = statefulGit()
  const vcOnline = makeVc(onlineRepo.route)
  clock.t = 1700000002000
  const online = await vcOnline.handleGitRemoteOnline({ cwd: ROOT, name: 'origin', refs: ['main', 'refs/tags/v1.0.0'] })
  const onlineArgv = spawns.filter((a) => subOf(a) === 'ls-remote')[0] || []
  check(onlineArgv.length > 0 && after(onlineArgv).join(',') === 'ls-remote,origin,main,refs/tags/v1.0.0', 'H21 联网查看：远端名与引用选择器按独立 argv 直传')
  check(online.ok === true && online.source === 'network' && online.count === 4 && online.readAtMs === clock.t && online.truncated === false, 'H22 联网结果带读取时刻、引用条数与来源标记（这是联网读的）')
  const nOnlineRefs = countOf('ls-remote')
  const onlineBadRef = await vcOnline.handleGitRemoteOnline({ cwd: ROOT, name: 'origin', refs: ['-x'] })
  check(onlineBadRef.ok === false && onlineBadRef.error.reason === 'remote-ref' && countOf('ls-remote') === nOnlineRefs, 'H23 引用选择器不合法：零进程拒绝')
  const onlineMissing = await vcOnline.handleGitRemoteOnline({ cwd: ROOT, name: 'nope', refs: [] })
  check(onlineMissing.ok === false && onlineMissing.error.reason === 'remote-missing' && countOf('ls-remote') === nOnlineRefs, 'H24 远端不在白名单里：零进程拒绝（远端名只能从 git remote 输出里选）')

  // 同一远端同一时刻只飞一个请求：第二次调用复用第一次的在途 Promise，不多起进程。
  const flightRepo = statefulGit()
  flightRepo.state.online = 'pending'
  const vcFlight = makeVc(flightRepo.route)
  const flightA = vcFlight.handleGitRemoteOnline({ cwd: ROOT, name: 'origin', refs: ['main'] })
  const flightB = vcFlight.handleGitRemoteOnline({ cwd: ROOT, name: 'origin', refs: ['main'] })
  await new Promise((resolve) => setTimeout(resolve, 80))
  const flightCount = spawns.filter((a) => subOf(a) === 'ls-remote').length
  check(flightCount === 1 && countOf('ls-remote') === 1, 'H25 同一远端同一时刻只飞一个联网请求（重复点击复用同一个在途 Promise，不排队不补发）')

  const deniedRepo = statefulGit()
  deniedRepo.state.online = 'denied'
  const vcDenied = makeVc(deniedRepo.route)
  clock.t = 1700000003000
  const denied = await vcDenied.handleGitRemoteOnline({ cwd: ROOT, name: 'origin', refs: ['main'] })
  check(denied.ok === false && denied.error.kind === 'needs-credential' && denied.error.message.indexOf('secret-token') < 0, 'H26 要凭据时明确失败并抹掉原话里的口令（不拿上一次结果冒充这一次）')
  check(denied.ok === false && denied.error.hint.indexOf('终端') >= 0, 'H27 要凭据的失败给下一步：去终端登录一次')
  const truncRepo = statefulGit()
  truncRepo.state.online = 'truncated'
  const truncVc = makeVc(truncRepo.route)
  const truncated = await truncVc.handleGitRemoteOnline({ cwd: ROOT, name: 'origin', refs: ['main'] })
  check(truncated.ok === false && truncated.error.kind === 'truncated' && !truncated.refs, 'H28 输出被截断：整次失败、不给半份引用清单')
  check(!(truncated.ok === true && truncated.refs.length > 0), 'H29 反证装置自检：半份引用清单喂给「不许半份」判据必须判红')

  const allText = allLogText()
  check(allText.indexOf('secret-token') < 0, 'H30 日志里不出现口令原文（含失败原话那一路）')
  check(logs.some((l) => l.event === 'host.call' && String(l.fields.method || '').indexOf('wf.gitRemote') === 0), 'H31 远端电话成功时落既有 host.call（电话名进 method，不新开事件名）')
  check(logs.every((l) => l.event !== 'git.exec' || gitExecFieldsOk(l.fields)), 'H32 远端电话不往既有 git.exec 里塞新字段（逐键比对白名单，不新开事件名、不动字段含义）')
  check(gitExecFieldsOk({ cwdHash: 'x', bogus: 1 }) === false && gitExecFieldsOk({ cwdHash: 'x', via: 'exec' }) === true, 'H33 反证装置自检：非法键放在第二个位置也必须判红，合法键放几个都放行')

  // R 组：两边登记点（宿主注册表 + 客户端电话表），缺一处就红。
  const methods = ['wf.gitRemoteList', 'wf.gitRemoteCheck', 'wf.gitRemoteAdd', 'wf.gitRemoteRename', 'wf.gitRemoteRemove', 'wf.gitRemoteSetUrl', 'wf.gitRemoteOnline']
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src', 'host', 'index.ts'), 'utf8')
  const clientFile = path.join(ROOT, 'src', 'client', 'views', 'versionControl', 'vcRemoteData.ts')
  const clientSrc = fs.existsSync(clientFile) ? fs.readFileSync(clientFile, 'utf8') : ''
  const missingOf = (sources: string) => methods.filter((m) => sources.indexOf("'" + m + "'") < 0)
  check(missingOf(hostSrc).length === 0 && missingOf(clientSrc).length === 0, 'R1 七条远端电话在宿主注册表与客户端电话表两边都登记' + (missingOf(hostSrc).length || missingOf(clientSrc).length ? ' —— 缺：' + missingOf(hostSrc).concat(missingOf(clientSrc)).join('、') : ''))
  const provableMissing = (list: string[]) => list.filter((m) => methods.indexOf(m) < 0)
  check(provableMissing(['wf.gitRemoteList', 'wf.gitRemoteNope']).join(',') === 'wf.gitRemoteNope', 'R2 反证装置自检：从名单里塞一个不存在的电话名就报一条缺（同一判据在真树上放行）')
}

async function main() {
  console.log('域 8 远端与同步门禁（#1754 T18：共享解析 / 宿主电话 / 同一时刻单飞 / 登记点）')
  remote = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'remote.js')).href)
  vcMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  pGroup()
  await hGroup()
  console.log(failed ? '\n存在失败 — verify-1586-remote 未通过' : '\n全部通过 — 远端与同步门禁生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}
main().catch(function (e) { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })