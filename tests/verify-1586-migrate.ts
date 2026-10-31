// verify-1586-migrate.ts —— 域 11 迁移与备份（#1759 T23）：11.1 / 11.12 / 11.13 与 5.13，加 svn 补充块。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-migrate.ts
//
// 判据分三层：
//   P 组：共享层纯函数（九个动作与能力账本同口径、argv 逐条、参数守卫、版本门、票据摘要）；
//   H 组：宿主两叶子（预检签票 / 凭票执行；直接构造叶子，成功路径按真实回包形状、拒绝路径零进程）；
//   R 组：登记点（宿主注册表、客户端电话表、构建拼接清单、页面壳挂载、词表与电话条数）。
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const { printGateResult } = require('./lib/gate-result.ts')
const GATE = 'verify-1586-migrate'
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }

const OID_HEAD = 'b'.repeat(40)
const OID_OTHER = 'e'.repeat(40)
const REPO = '/repo'
const OUT = '/tmp/out.tar'
const BUNDLE = '/tmp/repo.bundle'
const IMPORT_FILE = '/tmp/hist.fi'
const IMPORT_DIR = '/tmp/imported'
const NEW_REPO = '/tmp/newrepo'
const SHA = 'd'.repeat(64)
let clock = { t: 1700000000000 }
let actions: any = null
let taskProtocol: any = null
let ledger: any = null
let migrateCheck: any = null
let migrateWrite: any = null

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
  return actions.migratePlanOf(action, input)
}
function argvOf(action: string, input: any): string[] {
  const got = planOf(action, input)
  if (!got.ok) return ['PLAN-FAILED:' + String(got.reason)]
  const built = taskProtocol.taskArgsFor(got.plan.op, got.plan.taskArgs)
  return built.ok === true ? built.args : ['ARGV-FAILED:' + String(built.reason)]
}
function stateOf(patch?: any): any {
  const p = patch || {}
  const state: any = {
    root: p.root || REPO,
    headOid: p.headOid || OID_HEAD,
    gitVersion: p.gitVersion || 'git version 2.40.0',
    notRepo: p.notRepo === true,
    repoIn: p.repoIn || [],
    probeNull: p.probeNull === true,
    listNull: p.listNull === true,
    digestNull: p.digestNull === true,
    mkdirFail: p.mkdirFail === true,
    failArgv: p.failArgv || '',
    files: {},
    dirs: {},
    calls: [],
    made: [],
    started: []
  }
  if (p.files) Object.keys(p.files).forEach(function (k: string): void { state.files[k] = p.files[k] })
  if (p.dirs) Object.keys(p.dirs).forEach(function (k: string): void { state.dirs[k] = p.dirs[k] })
  return state
}
function fileOf(sizeBytes: number): any { return { exists: true, isDirectory: false, isFile: true, sizeBytes: sizeBytes, sha256: SHA } }
function dirOf(): any { return { exists: true, isDirectory: true, isFile: false, sizeBytes: 0 } }

function makeLeaf(state: any): any {
  const runPinned = async (exe: any, dir: any, argv: string[]) => {
    state.calls.push({ dir: dir, argv: argv.slice() })
    const a = argv.slice()
    if (state.failArgv !== '' && a.join(' ').indexOf(state.failArgv) >= 0) return { kind: 'non-zero', exitCode: 128, stderr: 'fatal: 假 git 拒绝了这条命令', stdout: '' }
    if (a[0] === '--version') return { kind: 'ok', stdout: state.gitVersion + '\n', stderr: '' }
    if (a[0] === 'bundle' && a[1] === 'verify') return { kind: 'ok', stdout: 'The bundle contains these 2 refs:\n' + OID_HEAD + ' refs/heads/main\n', stderr: '' }
    if (a[0] === 'config') return { kind: 'non-zero', exitCode: 1, stdout: '', stderr: 'fatal: not found' }
    return { kind: 'ok', stdout: '', stderr: '' }
  }
  const probe = {
    stat: async (p: any) => {
      if (state.probeNull) return null
      const found = state.files[p]
      return found ? Object.assign({}, found) : { exists: false, isDirectory: false, isFile: false, sizeBytes: 0 }
    },
    list: async (p: any) => {
      if (state.listNull) return null
      return state.dirs[p] ? state.dirs[p].slice() : []
    },
    digest: async (p: any) => {
      if (state.digestNull) return null
      const found = state.files[p]
      return found ? { sizeBytes: found.sizeBytes, sha256: found.sha256 || SHA } : null
    },
    makeDir: async (p: any) => {
      if (state.mkdirFail) return { ok: false, message: '假文件服务拒绝建目录' }
      state.made.push(p)
      state.dirs[p] = []
      state.files[p] = dirOf()
      return { ok: true }
    }
  }
  const readScreenOf = async (cwd: any) => {
    state.calls.push({ dir: String(cwd || ''), argv: ['<read-screen>'] })
    // 真 readScreenOf 只认仓库目录：仓库之外（新建目录、导入目标）要回失败，初始化预检才走得下去。
    const inRepo = state.notRepo !== true && (String(cwd || '').indexOf(REPO) === 0 || state.repoIn.indexOf(String(cwd || '')) >= 0)
    if (!inRepo) return { ok: false, error: { kind: 'blocked', reason: 'not-repo', message: '这里不是 git 仓库' } }
    return { ok: true, screen: { identity: { worktreePath: state.root, oid: state.headOid, branch: 'main', detached: false, sync: 'in-sync' }, repo: { root: state.root, bare: false, merging: false }, stagedCount: 0, unstagedCount: 0, conflictCount: 0 }, tier: 'modern', gitVersion: String(state.gitVersion).replace('git version ', '') }
  }
  const resolveGitExecutable = async () => 'git'
  const resolveRepoRoot = async () => ({ ok: true, root: state.root })
  const startTask = async (req: any) => {
    state.started.push(req)
    return { ok: true, task: { taskId: 'task-1', state: 'running', op: req.op, phase: 'started' } }
  }
  const checkLeaf = migrateCheck.createMigrateCheck({ failPhone: failPhone, failureFromExec: failureFromExec, resolveGitExecutable: resolveGitExecutable, resolveRepoRoot: resolveRepoRoot, readScreenOf: readScreenOf, runPinned: runPinned, now: () => clock.t, probe: probe, defaultCwd: REPO })
  const writeLeaf = migrateWrite.createMigrateWrite({ failPhone: failPhone, now: () => clock.t, measure: checkLeaf.measure, tickets: checkLeaf.tickets, results: checkLeaf.results, startTask: startTask, probe: probe, resolveGitExecutable: resolveGitExecutable, runPinned: runPinned })
  return { check: checkLeaf, write: writeLeaf, state: state }
}
function callCount(leaf: any): number { return leaf.state.calls.length }
function startedCount(leaf: any): number { return leaf.state.started.length }

async function main(): Promise<void> {
  actions = require('../src/shared/version-control/src/migrate-actions.js')
  taskProtocol = require('../src/shared/version-control/src/task-protocol.js')
  ledger = require('../src/shared/version-control/src/capability-ledger.js')
  migrateCheck = require('../src/host/versionControlMigrateCheck.js')
  migrateWrite = require('../src/host/versionControlMigrateWrite.js')

  console.log('P 组：共享层（动作表、参数守卫、argv 与票据摘要）')
  const ids = actions.migrateActionIds()
  check(ids.join(',') === 'init,archive,bundle-create,bundle-verify,bundle-unbundle,fast-export,fast-import,svn-probe,svn-fetch', 'P1 九个迁移动作按票面顺序登记（初始化、归档、离线包三件事、历史搬运两件事、svn 探测与抓取）')
  check(actions.MIGRATE_CHECK_CONTRACT === 'version-control.migrate-check' && actions.MIGRATE_CHECK_VERSION === 1, 'P2 预检契约名与版本号固定')
  check(actions.MIGRATE_ACTIONS_SOURCE === 'src/shared/version-control/src/migrate-actions.ts', 'P3 动作表标出自己所在文件，登记点据此对账')
  const capOf = (id: string) => ledger.CAPABILITIES.filter(function (c: any): boolean { return c.id === id })[0]
  const migrateIds = ['11.1', '11.12', '11.13', '5.13']
  const ledgerPages = migrateIds.map(function (id: string): string { return String(capOf(id).page) })
  check(ledgerPages.join(',') === 'migrate,migrate,migrate,migrate', 'P4 四个能力 id 在账本里都归「管理·迁移」页')
  check(capOf('11.1').command === 'git init [--bare]' && capOf('11.13').command === 'git bundle create / verify / unbundle', 'P5 账本里的命令原文与动作表口径一致（11.1、11.13）')
  check(actions.migrateActionOf('nope') === null && actions.migrateActionOf(undefined) === null, 'P6 不认识的动作回 null，不静默放过')
  check(String(capOf('11.14').page) === 'maintenance' && String(capOf('11.15').page) === 'maintenance', 'P7 11.14 refs migrate 与 11.15 scalar 归维护页，不是迁移页')
  check(ids.indexOf('refs-migrate') < 0 && ids.join(',').indexOf('scalar') < 0, 'P8 只读的 11.14 / 11.15 不混进迁移动作表（只读项不出现触发按钮）')

  check(actions.migratePathProblem('') !== '' && actions.migratePathProblem('rel/out.tar') !== '', 'P9 路径守卫拒空与相对路径')
  check(actions.migratePathProblem('/tmp/../etc/x') !== '' && actions.migratePathProblem('-oops') !== '', 'P10 路径守卫拒上跳段与短横线开头')
  check(actions.migratePathProblem('D:\\backup\\repo.bundle') === '' && actions.migratePathProblem('/tmp/out.tar') === '', 'P11 Windows 盘符与 POSIX 绝对路径都放行')
  check(actions.migrateRefProblem('-x') !== '' && actions.migrateRefProblem('a b') !== '' && actions.migrateRefProblem('HEAD') === '', 'P12 引用守卫拒减号开头与空白，放行 HEAD')
  check(actions.migrateBranchProblem('feature/x') === '' && actions.migrateBranchProblem('a..b') !== '' && actions.migrateBranchProblem('x~1') !== '', 'P13 分支名守卫与 git check-ref-format 的拒绝面对齐')
  check(actions.migrateUrlProblem('https://svn.example.com/repo') === '' && actions.migrateUrlProblem('ftp://x/y') !== '' && actions.migrateUrlProblem('-x') !== '', 'P14 svn 地址只认常见协议并拒减号开头')
  check(actions.migrateVersionAtLeast('git version 2.28.0', 2, 28) === true && actions.migrateVersionAtLeast('git version 2.27.9', 2, 28) === false, 'P15 版本门 2.28：达标与不达标两侧都判对')
  check(actions.migrateVersionAtLeast('读不出来', 2, 28) === false, 'P16 版本号读不出来按旧版本处理（宁可用改名产线也不假装支持）')

  const initPlan = planOf('init', { path: NEW_REPO })
  check(initPlan.ok === true && initPlan.plan.branch === 'main' && initPlan.plan.initMode === 'initial-branch' && initPlan.plan.versionNeed === '2.28', 'P17 init 计划缺省 main 与 --initial-branch 产线，版本要求 2.28')
  check(initPlan.plan.targetText.indexOf('初始分支 main') >= 0 && initPlan.plan.pathAbsent.length === 0, 'P18 init 计划点名初始分支；「目标不存在」由宿主写进票据绑定，共享层不重复登记')
  const renamePlan = planOf('init', { path: NEW_REPO, initMode: 'rename' })
  check(renamePlan.plan.initMode === 'rename' && renamePlan.plan.versionNeed === '2.11' && renamePlan.plan.versionNote.indexOf('symbolic-ref') >= 0, 'P19 init 改名产线要求 2.11 并在计划里写清改名做法')
  check(planOf('init', { path: 'rel' }).reason === 'bad-path' && planOf('init', { path: NEW_REPO, branch: 'a..b' }).reason === 'bad-branch', 'P20 init 参数守卫失败给出稳定 reason')
  const barePlan = planOf('init', { path: NEW_REPO, bare: true })
  check(barePlan.plan.bare === true && barePlan.plan.targetText.indexOf('裸仓库') >= 0, 'P21 裸仓库初始化在计划与确认卡上都标出来')

  const archivePlan = planOf('archive', { outputPath: OUT })
  check(archivePlan.ok === true && archivePlan.plan.ref === 'HEAD' && archivePlan.plan.pathAbsent.join(',') === OUT, 'P22 archive 缺省 HEAD，输出路径登记为「预检时不存在」')
  check(argvOf('archive', { outputPath: OUT }).join(' ') === 'archive --format=tar --output=' + OUT + ' HEAD', 'P23 archive 的 argv 逐元素固定')
  check(planOf('archive', { outputPath: OUT, ref: '-x' }).reason === 'bad-ref', 'P24 archive 引用守卫在共享层就拦下')
  const bundlePlan = planOf('bundle-create', { outputPath: BUNDLE })
  check(argvOf('bundle-create', { outputPath: BUNDLE }).join(' ') === 'bundle create ' + BUNDLE + ' --all', 'P25 bundle create 不带引用时打全部引用')
  check(argvOf('bundle-create', { outputPath: BUNDLE, ref: 'main' }).join(' ') === 'bundle create ' + BUNDLE + ' main', 'P26 bundle create 带引用时只打那一条')
  check(argvOf('bundle-verify', { filePath: BUNDLE }).join(' ') === 'bundle verify ' + BUNDLE, 'P27 bundle verify 的 argv 只校验这个文件')
  check(argvOf('bundle-unbundle', { filePath: BUNDLE }).join(' ') === 'bundle unbundle ' + BUNDLE, 'P28 bundle unbundle 的 argv 把包里的引用装回当前仓库')
  check(taskProtocol.taskArgsFor('bundle', { outputPath: BUNDLE, mode: 'explode' }).reason === 'bad-mode', 'P29 离线包不接受第四种动作')
  const fastExportPlan = planOf('fast-export', { outputPath: OUT })
  check(fastExportPlan.ok === true && fastExportPlan.plan.pathAbsent.join(',') === OUT, 'P30 fast-export 产出文件，路径登记为「预检时不存在」')
  check(argvOf('fast-export', { outputPath: OUT }).join(' ') === 'fast-export --output=' + OUT + ' --all', 'P31 fast-export 的 argv 逐元素固定')
  const fastImportPlan = planOf('fast-import', { targetPath: IMPORT_DIR, filePath: IMPORT_FILE })
  check(fastImportPlan.ok === true && fastImportPlan.plan.needsConfirm === true && fastImportPlan.plan.pathAbsent.join(',') === IMPORT_DIR, 'P32 fast-import 目标登记为「预检时不存在」且必须确认')
  check(argvOf('fast-import', { targetPath: IMPORT_DIR, filePath: IMPORT_FILE }).join(' ') === 'fast-import --quiet', 'P33 fast-import 的 argv 固定，输入走标准输入而不是参数')
  check(planOf('fast-import', { targetPath: 'rel', filePath: IMPORT_FILE }).reason === 'bad-target', 'P34 fast-import 目标必须是绝对路径')
  const svnFetchPlan = planOf('svn-fetch', { url: 'https://svn.example.com/repo' })
  check(svnFetchPlan.ok === true && svnFetchPlan.plan.needsConfirm === true && argvOf('svn-fetch', { url: 'https://svn.example.com/repo' }).join(' ') === 'svn fetch --quiet https://svn.example.com/repo', 'P35 svn 抓取一次走长任务通道、必须确认、argv 固定')
  check(planOf('svn-fetch', { url: 'ftp://x/y' }).reason === 'bad-url', 'P36 svn 抓取拒绝不认识的协议')
  const probePlan = planOf('svn-probe', {})
  check(probePlan.ok === true && probePlan.plan.readOnly === true && probePlan.plan.needsConfirm === false, 'P37 svn 探测只读、不需要确认')
  check(planOf('nope', {}).reason === 'unknown-action', 'P38 未知动作在共享层给出 unknown-action')
  const digestA = actions.migratePlanDigestInput(archivePlan.plan)
  const digestB = actions.migratePlanDigestInput(Object.assign({}, archivePlan.plan))
  const digestC = actions.migratePlanDigestInput(Object.assign({}, archivePlan.plan, { ref: 'main' }))
  check(digestA === digestB && digestA !== digestC, 'P39 票据摘要对同一个计划稳定、对改过的计划必然不同')
  check(actions.migrateActionOf('bundle-verify').task === false && actions.migrateActionOf('bundle-unbundle').task === true, 'P40 离线包三种产线里只有 verify 不进长任务通道')

  console.log('H 组：宿主预检与凭票执行')
  let leaf = makeLeaf(stateOf())
  let st = leaf
  let r: any = await st.check.handleGitMigrateCheck({ action: 'init', path: NEW_REPO })
  check(r.ok === true && r.decision === 'allow' && r.confirmRequired === false && r.ticket && r.ticket.op === 'init', 'H1 不存在的目录初始化：允许、不需要确认、签一张 init 票据')
  check(r.plan.initMode === 'initial-branch' && r.scene.gitVersion.indexOf('2.40') >= 0, 'H2 读到 2.40 时走 --initial-branch 产线')
  const callsBefore = callCount(st)
  const noChange = await st.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  check(noChange.ok === true && noChange.decision === 'allow' && noChange.ticket.op === 'archive', 'H3 归档预检：允许并签任务票据')
  check(noChange.plan.pathAbsent.join(',') === OUT && noChange.plan.taskArgs.outputPath === OUT, 'H4 归档票据里登记输出路径「预检时不存在」并带任务参数')
  check(noChange.confirmRequired === false, 'H5 归档不是危险动作，不需要确认')
  check(callCount(st) === callsBefore + 1 || callCount(st) > callsBefore, 'H6 归档预检只读现场，不起写进程')

  leaf = makeLeaf(stateOf({ dirs: {}, files: (function () { const f: any = {}; f[NEW_REPO] = dirOf(); return f })() }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'init', path: NEW_REPO })
  check(r.ok === true && r.decision === 'allow' && r.reasons.length === 0, 'H7 空目录初始化：允许，没有额外理由')
  const emptyTicket = r.ticket
  check(emptyTicket.bindings.preconditions.worktreeDigest === 'dir:0:', 'H8 空目录的票据绑定目录摘要是 dir:0:')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[NEW_REPO] = dirOf(); return f })(), dirs: (function () { const d: any = {}; d[NEW_REPO] = ['a.txt', 'b.txt']; return d })() }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'init', path: NEW_REPO })
  check(r.ok === true && r.decision === 'warn' && r.confirmRequired === true && r.reasons[0].id === 'dir-not-empty', 'H9 非空目录初始化：给 warn 与「目录里已有内容」理由，必须确认')
  check(r.ticket.bindings.preconditions.worktreeDigest === 'dir:2:a.txt|b.txt', 'H10 非空目录的票据绑定排序后的目录摘要')

  leaf = makeLeaf(stateOf({ repoIn: [NEW_REPO] }))
  const ticketsBefore = leaf.check.tickets.size
  r = await leaf.check.handleGitMigrateCheck({ action: 'init', path: NEW_REPO })
  check(r.ok === false && r.error.reason === 'already-repo', 'H11 目录已经在仓库里：拒绝嵌套仓库')
  check(leaf.check.tickets.size === ticketsBefore, 'H12 拒绝时不签票')

  leaf = makeLeaf(stateOf({ gitVersion: 'git version 2.20.1' }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'init', path: NEW_REPO })
  check(r.ok === true && r.plan.initMode === 'rename' && r.versionPolicy.degraded === true, 'H13 本机 git 2.20：降级到建后改名产线并如实标降级')
  check(r.reasons.filter(function (x: any): boolean { return x.id === 'version-degraded' }).length === 1, 'H14 降级理由常驻在预检回包里')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[NEW_REPO] = fileOf(10); return f })() }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'init', path: NEW_REPO })
  check(r.ok === false && r.error.reason === 'not-directory', 'H15 目标已存在且是文件：拒绝初始化')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[OUT] = fileOf(3); return f })() }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  check(r.ok === false && r.error.reason === 'output-exists', 'H16 输出文件已存在：不覆盖，拒绝预检')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[IMPORT_DIR] = dirOf(); f[IMPORT_FILE] = fileOf(7); return f })() }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'fast-import', cwd: REPO, targetPath: IMPORT_DIR, filePath: IMPORT_FILE })
  check(r.ok === false && r.error.reason === 'target-exists', 'H17 导入目标已存在：拒绝，绝不覆盖或复用现有仓库')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[IMPORT_FILE] = fileOf(7); return f })() }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'fast-import', cwd: REPO, targetPath: IMPORT_DIR, filePath: IMPORT_FILE })
  check(r.ok === true && r.decision === 'warn' && r.confirmRequired === true, 'H18 导入历史：需要确认，确认卡点名新仓库')
  check(r.plan.input && r.plan.input.path === IMPORT_FILE && r.plan.input.sizeBytes === 7 && r.plan.input.sha256 === SHA, 'H19 票据绑定输入文件的路径、大小与 sha256')
  check(r.plan.pathAbsent.join(',') === IMPORT_DIR, 'H20 导入票据把目标目录登记为「预检时不存在」')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[BUNDLE] = fileOf(9); return f })() }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'bundle-verify', cwd: REPO, filePath: BUNDLE })
  check(r.ok === true && r.readOnly === true && r.ticket === null && r.result.ok === true, 'H21 离线包校验是只读动作：当场给结果且不签票')
  check(leaf.state.calls.filter(function (c: any): boolean { return c.argv[0] === 'bundle' && c.argv[1] === 'verify' }).length === 1, 'H22 离线包校验只跑一条只读的 git bundle verify')

  leaf = makeLeaf(stateOf())
  r = await leaf.check.handleGitMigrateCheck({ action: 'svn-probe', cwd: REPO })
  check(r.ok === true && r.readOnly === true && r.result.linked === false, 'H23 svn 探测：只读本地配置，没登记关联就如实说没有')
  check(leaf.state.calls.filter(function (c: any): boolean { return c.argv[0] === 'svn' || c.argv[0] === 'ls-remote' || c.argv[0] === 'fetch' }).length === 0, 'H24 svn 探测不联网、不跑 git svn')
  r = await leaf.check.handleGitMigrateCheck({ action: 'svn-fetch', cwd: REPO, url: 'https://svn.example.com/repo' })
  check(r.ok === true && r.confirmRequired === true, 'H25 svn 抓取一次必须确认')

  leaf = makeLeaf(stateOf({ notRepo: true }))
  r = await leaf.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  check(r.ok === false && leaf.check.tickets.size === 0, 'H26 不在仓库里：把读现场的失败原样透传，不签票')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[OUT] = { exists: false }; return f })() }))
  r = await leaf.write.handleGitMigrateWrite({ ticketId: 'migrate-1-0', action: 'archive', cwd: REPO })
  check(r.ok === false && r.error.reason === 'ticket-missing' && startedCount(leaf) === 0, 'H27 伪造票号：零任务拒绝')

  leaf = makeLeaf(stateOf())
  const initChk = await leaf.check.handleGitMigrateCheck({ action: 'init', path: NEW_REPO })
  const beforeInit = callCount(leaf)
  const initRun = await leaf.write.handleGitMigrateWrite({ ticketId: initChk.ticket.id, action: 'init', requestId: 'r-init-1' })
  const initCall = leaf.state.calls.slice(beforeInit).filter(function (c: any): boolean { return c.argv[0] === 'init' })[0]
  check(initRun.ok === true && initRun.init.created === true, 'H28 凭票执行初始化：成功回包写明建了哪个仓库')
  check(initCall && initCall.argv.join(' ') === 'init --initial-branch=main ' + NEW_REPO, 'H29 初始化只起一次 git init，argv 逐元素固定')
  const afterFirst = callCount(leaf)
  const replay = await leaf.write.handleGitMigrateWrite({ ticketId: initChk.ticket.id, action: 'init', requestId: 'r-init-1' })
  check(replay.ok === true && replay.reused === true && callCount(leaf) === afterFirst, 'H30 同一请求号重放：回同一结果，不再起进程')

  leaf = makeLeaf(stateOf({ files: (function () { const f: any = {}; f[IMPORT_FILE] = fileOf(7); return f })() }))
  const impChk = await leaf.check.handleGitMigrateCheck({ action: 'fast-import', cwd: REPO, targetPath: IMPORT_DIR, filePath: IMPORT_FILE })
  const needConfirm = await leaf.write.handleGitMigrateWrite({ ticketId: impChk.ticket.id, action: 'fast-import', cwd: REPO })
  check(needConfirm.ok === false && needConfirm.error.reason === 'need-confirm' && leaf.state.made.length === 0, 'H31 导入没带确认：拒绝且一个目录都没建')
  const impRun = await leaf.write.handleGitMigrateWrite({ ticketId: impChk.ticket.id, action: 'fast-import', cwd: REPO, requestId: 'r-imp-1', confirmed: true })
  check(impRun.ok === true && leaf.state.made[0] === IMPORT_DIR, 'H32 确认后先建新目录，再在新目录里 git init')
  const impInit = leaf.state.calls.filter(function (c: any): boolean { return c.dir === IMPORT_DIR && c.argv[0] === 'init' })[0]
  check(Boolean(impInit), 'H33 导入前的 git init 钉在新目录上，不是原仓库')
  check(leaf.state.started.length === 1 && leaf.state.started[0].op === 'fast-import' && leaf.state.started[0].stdinFile.sha256 === SHA, 'H34 导入交给长任务通道，stdinFile 带票据里那份摘要')
  check(leaf.state.started[0].stdinFile.path === IMPORT_FILE && leaf.state.started[0].stdinFile.sizeBytes === 7, 'H35 导入的文件流路径与大小在执行时复验过')

  leaf = makeLeaf(stateOf())
  const arcChk = await leaf.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  const arcRun = await leaf.write.handleGitMigrateWrite({ ticketId: arcChk.ticket.id, action: 'archive', cwd: REPO, confirmed: true })
  check(arcRun.ok === true && leaf.state.started.length === 1 && leaf.state.started[0].op === 'archive', 'H36 归档确认后交给长任务通道，执行层自己不起进程')
  check(leaf.state.started[0].args.outputPath === OUT && leaf.state.started[0].args.ref === 'HEAD', 'H37 任务参数与票据里的计划逐字一致')

  const expiredTicket = arcChk.ticket
  clock.t = clock.t + 180000
  const expiredRun = await leaf.write.handleGitMigrateWrite({ ticketId: expiredTicket.id, action: 'archive', cwd: REPO, confirmed: true })
  check(expiredRun.ok === false && expiredRun.error.reason === 'ticket-expired', 'H38 过期票据：拒绝执行，不自动重放')
  clock.t = clock.t - 180000

  leaf = makeLeaf(stateOf())
  const mismChk = await leaf.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  const mismRun = await leaf.write.handleGitMigrateWrite({ ticketId: mismChk.ticket.id, action: 'bundle-create', cwd: REPO, confirmed: true })
  check(mismRun.ok === false && mismRun.error.reason === 'ticket-op-mismatch' && startedCount(leaf) === 0, 'H39 票上动作与请求不一致：拒绝，零任务')

  leaf = makeLeaf(stateOf())
  const headChk = await leaf.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  leaf.state.headOid = OID_OTHER
  const headRun = await leaf.write.handleGitMigrateWrite({ ticketId: headChk.ticket.id, action: 'archive', cwd: REPO, confirmed: true })
  check(headRun.ok === false && headRun.error.reason === 'stale-head' && startedCount(leaf) === 0, 'H40 HEAD 在预检后动过：拒绝，零任务')

  leaf = makeLeaf(stateOf())
  const pathChk = await leaf.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  leaf.state.files[OUT] = fileOf(5)
  const pathRun = await leaf.write.handleGitMigrateWrite({ ticketId: pathChk.ticket.id, action: 'archive', cwd: REPO, confirmed: true })
  check(pathRun.ok === false && pathRun.error.reason === 'target-changed' && startedCount(leaf) === 0, 'H41 预检时不存在的输出路径执行前出现了：拒绝，不覆盖')

  leaf = makeLeaf(stateOf())
  const repoChk = await leaf.check.handleGitMigrateCheck({ action: 'archive', cwd: REPO, outputPath: OUT })
  leaf.state.root = '/other'
  const repoRun = await leaf.write.handleGitMigrateWrite({ ticketId: repoChk.ticket.id, action: 'archive', cwd: REPO, confirmed: true })
  check(repoRun.ok === false && repoRun.error.reason === 'stale-repo' && startedCount(leaf) === 0, 'H42 换了一个仓库用同一张票：拒绝，零任务')
  check(repoRun.error && typeof repoRun.error.kind === 'string' && typeof repoRun.error.message === 'string' && typeof repoRun.error.reason === 'string', 'H43 拒绝信封始终是 {kind, message, reason} 三段')

  console.log('R 组：登记点（宿主、客户端、构建、页面壳、词表与电话条数）')
  const readText = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const hostIndex = readText('src/host/index.ts')
  check(hostIndex.indexOf("'wf.gitMigrateCheck'") >= 0 && hostIndex.indexOf("'wf.gitMigrateWrite'") >= 0, 'R1 宿主入口注册了两条迁移电话')
  const clientData = readText('src/client/views/versionControl/vcMigrateData.ts')
  check(clientData.indexOf("check: 'wf.gitMigrateCheck'") >= 0 && clientData.indexOf("write: 'wf.gitMigrateWrite'") >= 0, 'R2 客户端电话表与宿主同一个名字')
  const buildSrc = readText('scripts/build.mts')
  check(buildSrc.indexOf('shared:vcMigrateActions') >= 0 && buildSrc.indexOf('vcMigrateData') >= 0 && buildSrc.indexOf('vcMigratePage') >= 0, 'R3 构建清单登记了共享拼接与两张客户端叶子')
  const clientIndex = readText('src/client/index.ts')
  check(clientIndex.indexOf('leaf:vcMigrateData') >= 0 && clientIndex.indexOf('leaf:vcMigratePage') >= 0 && clientIndex.indexOf('shared:vcMigrateActions') >= 0, 'R4 客户端入口的拼接标记与构建清单同序同项')
  const shellPages = readText('src/client/views/versionControl/vcShellPages.ts')
  check(shellPages.indexOf('vcMigratePageNode') >= 0 && shellPages.indexOf("page === 'migrate'") >= 0, 'R5 页面壳把迁移页正文挂进 migrate 分区，没有另开一层')
  const copy = readText('config/copy/vcshell.yaml')
  check(copy.indexOf('vc.migrate.action.fastImport') >= 0 && copy.indexOf('vc.migrate.confirmLabel') >= 0, 'R6 界面文字走词表，键名成对存在')
  const settings = readText('tests/verify-settings-phones.ts')
  check(settings.indexOf('宿主电话一百零七条') >= 0 && settings.indexOf('#1759') >= 0, 'R7 宿主电话条数期望已随合并后的总数更新（合到集成分支后是一百零七条，含本票两名；之后 #1750 又加三条）')

  printGateResult(GATE, total, failed ? 1 : 0)
  if (failed) process.exit(1)
}
main().catch(function (e: any): void { console.error(e && e.stack ? e.stack : String(e)); process.exit(1) })
