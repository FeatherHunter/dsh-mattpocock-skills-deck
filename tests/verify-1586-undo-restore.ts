// verify-1586-undo-restore.ts —— 规格 #1586 域 5 的门禁（#1748 T13：撤销、重置、还原与拣选五条动作）
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-undo-restore.ts
// 分六组：
//   A 共享层动作表与 argv 形状（不碰 git）；
//   B 稳定计划与两份摘要（预检签票与执行前重验必须读同一份算法）；
//   C 真 git 仓库里跑三条重置：预检拿票、执行、HEAD 与改动落点的实测；
//   D 还原与拣选：多选保序、还原两步、冲突要如实报（不自动解决）；
//   E 六种拒绝理由与零进程闸（伪造票、过期票、换动作、换仓库、头漂、索引变、目标变）；
//   F 恢复点：会丢什么、怎么找回、读不全就拒签票；
//   G 反证：把判据改坏，A–F 的同一套判断必须判红。
// 本文件是 CommonJS：产品源码靠动态 import 取，说明符一律 .js（由钩子改指同名 .ts）。
// 宿主仍走「真 git 子进程」的垫片（argv 直传、不经 shell），所以断言的是真仓库有没有被动过。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }
const git = (cwd: string, args: string[]) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() } }
// 造仓库：先三条提交（每条改一个新文件），再在 a.txt 上叠一次未提交改动（测 stale-index 与「会丢什么」用）。
function mkRepo(tag: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1748-' + tag + '-'))
  git(base, ['init', '-q', '-b', 'main']); git(base, ['config', 'user.name', '样本作者']); git(base, ['config', 'user.email', 'x@y'])
  fs.writeFileSync(path.join(base, 'a.txt'), '第一行\n'); git(base, ['add', '-A']); git(base, ['commit', '-q', '-m', '基线：建立 a.txt'])
  fs.writeFileSync(path.join(base, 'b.txt'), '第二份\n'); git(base, ['add', '-A']); git(base, ['commit', '-q', '-m', '第二提交：建立 b.txt'])
  fs.writeFileSync(path.join(base, 'c.txt'), '第三份\n'); git(base, ['add', '-A']); git(base, ['commit', '-q', '-m', '第三提交：建立 c.txt'])
  return base
}
// 造一条待还原/待拣选的分支：从 main 拉出 feat，在 feat 上多两条提交，然后回到 main。
function mkFeature(base: string): void {
  git(base, ['checkout', '-q', '-b', 'feat'])
  fs.writeFileSync(path.join(base, 'f1.txt'), '甲\n'); git(base, ['add', '-A']); git(base, ['commit', '-q', '-m', 'feat 甲'])
  fs.writeFileSync(path.join(base, 'f2.txt'), '乙\n'); git(base, ['add', '-A']); git(base, ['commit', '-q', '-m', 'feat 乙'])
  git(base, ['checkout', '-q', 'main'])
}
const spawns: string[][] = []
const logs: Array<{ level: string; event: string; fields: Record<string, any> }> = []
let clock = { t: 1000000 }
let vcMod: any = null
// 宿主垫片：不在路由里的命令一律真跑本机 git（所以断言能落在真仓库上）；只在需要数进程时读 spawns。
function makeVc(route?: ((argv: string[]) => any) | null) {
  spawns.length = 0
  logs.length = 0
  const deps = {
    subprocess: { spawn(req: any) {
      spawns.push(req.argv.slice())
      const hit = route ? route(req.argv) : null
      if (hit) { const mk = (t: any, trunc: any) => ({ finalize: () => ({ text: String(t || ''), truncated: trunc === true }) }); return { done: Promise.resolve({ exitCode: hit.code || 0 }), collected: { stdout: mk(hit.stdout, hit.truncated), stderr: mk(hit.stderr) }, terminate() {} } }
      const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 1 << 26 })
      const mk2 = (b: any) => ({ finalize: () => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) })
      return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk2(r.stdout), stderr: mk2(r.stderr) }, terminate() {} }
    } },
    timer: { timeout: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) },
    fs: { stat: async (p: any) => await fs.promises.stat(p), lstat: async (p: any) => await fs.promises.lstat(p), exists: async (p: any) => { try { await fs.promises.access(p); return true } catch (e) { return false } } },
    getPlatform: async () => ({ resolveExecutable: async (n: string) => (n === 'git' ? 'git' : null) }),
    DEFAULT_CWD: ROOT, TIMEOUT_MS: 30000, gate: { noteOutbound() {} },
    logCtx: { fire(level: string, event: string, fields: any) { logs.push({ level: level, event: event, fields: fields }) } },
    now: () => clock.t,
  }
  return vcMod.createVersionControl(deps)
}
const after = (argv: string[]): string[] => { const i = argv.indexOf('i18n.logOutputEncoding=UTF-8'); return i < 0 ? argv : argv.slice(i + 1) }
const rightAfter = (argv: string[]): string[] => after(argv).filter((a) => a !== '--no-pager' && a.indexOf('-c ') !== 0 && a.charAt(0) !== '-')
// 写命令白名单：只有这些子命令能改动仓库，拒绝闸要求它们一个都没出现。
const WRITE_SUBS = ['reset', 'revert', 'cherry-pick', 'commit']
const writes = (): string[][] => spawns.filter((a) => WRITE_SUBS.indexOf(after(a)[0]) >= 0)
const deny = (r: any, reason: string): boolean => !!(r && r.ok === false && r.error && r.error.reason === reason)
const printGateResult = require('./lib/gate-result.ts').printGateResult
// 反证基座：把共享层三叶按构建同一个拼装次序拼成闭包（它们之间没有 import，可以直拼），
// 改一处判据再求值，看同一套断言会不会判红。转译参数与构建同一份（TRANSPILE_OPTIONS）。
const UNDO_SHARED_FILES = [
  'src/shared/version-control/src/undo-ops.ts',
  'src/shared/version-control/src/undo-ticket.ts',
  'src/shared/version-control/src/recovery-point.ts',
]
const UNDO_SHARED_EXPORTS = [
  'UNDO_OPS', 'UNDO_OP_NAMES', 'undoOpOf', 'undoDangerOf', 'undoNeedsRecoveryOf', 'undoRevProblem',
  'undoCommitsOf', 'undoDefaultMessageOf', 'undoPlanOf', 'undoArgvOf', 'undoStepCountOf', 'undoPlanDangerOf',
  'UNDO_CHECK_CONTRACT', 'UNDO_CHECK_VERSION', 'undoPlanDigestOf', 'undoWorktreeDigestOf', 'undoSceneSummaryOf',
  'recoveryPointOf', 'recoveryImpactProblem', 'recoveryRestoreStepsOf', 'recoverySummaryOf',
]
function undoSharedSourceOf(patch?: any): string {
  let src = UNDO_SHARED_FILES.map(function (rel: string) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^(\s*)export\s+/gm, '$1') }).join('\n')
  if (patch) src = patch(src)
  return src
}
function buildUndoShared(patch?: any): any {
  const js = require('esbuild').transformSync(undoSharedSourceOf(patch), require('../scripts/lib/transpile-unit.mts').TRANSPILE_OPTIONS).code
  const body = js + '\nreturn { ' + UNDO_SHARED_EXPORTS.join(', ') + ' }\n'
  const fn = require('./lib/eval-probe.ts').compileFn([], body)
  return fn()
}

async function main(): Promise<void> {
  console.log('历史改写五条动作门禁（#1748：动作表 / 票据 / 真仓库执行 / 拒绝理由 / 恢复点 / 反证）')
  vcMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'versionControl.js')).href)
  const ops = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'undo-ops.js')).href)
  const ticket = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'undo-ticket.js')).href)
  const rec = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'src', 'recovery-point.js')).href)
  const wt = await import(pathToFileURL(path.join(ROOT, 'src', 'shared', 'version-control', 'write-ticket.js')).href)

  // A 共享层：动作表、危险等级、argv 形状与本地校验
  console.log('A 动作表与 argv')
  check(ops.UNDO_OP_NAMES.length === 5 && ops.UNDO_OP_NAMES.join(',') === 'reset-soft,reset-mixed,reset-hard,revert,cherry-pick', 'A1 五条动作与账本 5.1–5.5 同序：' + ops.UNDO_OP_NAMES.join(','))
  check(ops.UNDO_OPS.map((o: any) => o.id).join(',') === '5.1,5.2,5.3,5.4,5.5', 'A2 动作各自挂着账本编号')
  check(ops.undoDangerOf('reset-hard') === true && ops.undoDangerOf('reset-soft') === false && ops.undoNeedsRecoveryOf('reset-hard') === true && ops.undoNeedsRecoveryOf('reset-mixed') === false, 'A3 只有硬重置是「毁」级且要恢复点')
  check(ops.undoNeedsTicketOf('cherry-pick') === true, 'A4 写动作都要票')
  const planSoft = ops.undoPlanOf({ op: 'reset-soft', target: 'HEAD~1' })
  check(planSoft.ok === true && planSoft.plan.resetMode === 'soft' && planSoft.plan.target === 'HEAD~1', 'A5 reset-soft 计划带 soft 模式与目标')
  const argvSoft = ops.undoArgvOf(planSoft.plan)
  check(argvSoft.ok === true && JSON.stringify(argvSoft.steps) === JSON.stringify([['reset', '--soft', 'HEAD~1']]), 'A6 reset-soft 一步 argv：' + JSON.stringify(argvSoft.steps))
  const argvHard = ops.undoArgvOf({ op: 'reset-hard', target: 'HEAD~2' })
  check(argvHard.ok === true && argvHard.steps[0][1] === '--hard', 'A7 reset-hard 用 --hard（不是 --soft/--mixed）')
  const planRev = ops.undoPlanOf({ op: 'revert', target: 'HEAD~1', message: '手工说明' })
  const argvRev = ops.undoArgvOf(planRev.plan)
  check(argvRev.ok === true && argvRev.steps.length === 2 && argvRev.steps[0][0] === 'revert' && argvRev.steps[0][1] === '--no-commit' && argvRev.steps[1][0] === 'commit', 'A8 还原固定两步（先 --no-commit 再提交，-m 不是 merge 主线）')
  check(planRev.plan.message === '手工说明', 'A9 用户填的还原说明原样保留')
  check(ops.undoDefaultMessageOf('第三提交：建立 c.txt') === 'Revert "第三提交：建立 c.txt"', 'A10 默认还原说明与 git 自己会写的那句一致')
  const planPick = ops.undoPlanOf({ op: 'cherry-pick', commits: 'abc1234\n\ndef5678\n' })
  check(planPick.ok === true && planPick.plan.commits.join(',') === 'abc1234,def5678', 'A11 拣选清单：空行跳过、原序保留')
  const argvPick = ops.undoArgvOf(planPick.plan)
  check(argvPick.ok === true && argvPick.steps.length === 1 && argvPick.steps[0].join(',') === 'cherry-pick,abc1234,def5678', 'A12 拣选是一条命令按次序传入：' + JSON.stringify(argvPick.steps))
  check(ops.undoCommitsOf('').reason === 'commits-empty', 'A13 空清单：commits-empty')
  check(ops.undoCommitsOf(new Array(51).fill('x').map((_, i) => 'c' + i).join('\n')).reason === 'commits-too-many', 'A14 超过 50 条：commits-too-many')
  check(ops.undoCommitsOf('c1\nc1\n').reason === 'commits-duplicate' && ops.undoCommitsOf('c1\nc1\n').index === 2, 'A15 重复项：commits-duplicate 并指第 2 条')
  check(ops.undoCommitsOf('c1\n-bad\n').reason === 'commits-invalid', 'A16 以横杠开头的引用：commits-invalid')
  check(ops.undoRevProblem('') === 'required' && ops.undoRevProblem('a b') === 'bad-shape' && ops.undoRevProblem('a..b') === 'bad-shape' && ops.undoRevProblem('a:b') === 'bad-shape', 'A17 引用形状四类：required / 空白 / 范围表达式 / 冒号')
  check(ops.undoRevProblem('HEAD~1') === null && ops.undoRevProblem('refs/heads/main') === null, 'A18 正常引用放行（存在性交给宿主预检）')
  check(ops.undoPlanOf({ op: 'nope' }).reason === 'unknown-op' && ops.undoPlanOf({ op: 'nope' }).field === 'op', 'A19 未知动作：unknown-op 且指 op 字段')
  check(ops.undoPlanOf({ op: 'reset-soft', target: '   ' }).reason === 'required-target', 'A20 目标只剩空白：required-target')
  check(ops.undoPlanOf({ op: 'reset-soft', target: '-x' }).reason === 'bad-target', 'A21 目标形状不对：bad-target')
  check(ops.undoPlanOf({ op: 'revert', target: 'HEAD~1', message: new Array(201).fill('x').join('') }).reason === 'message-too-long', 'A22 说明超长：message-too-long')
  check(ops.undoStepCountOf(planRev.plan) === 2 && ops.undoStepCountOf(planSoft.plan) === 1 && ops.undoStepCountOf(planPick.plan) === 1, 'A23 步数与三种动作对得上')
  check(ops.UNDO_OPS_SOURCE === 'src/shared/version-control/src/undo-ops.ts' && ops.UNDO_COMMIT_MAX === 50 && ops.UNDO_MESSAGE_MAX === 200, 'A24 单源常量与出处')

  // B 稳定计划与摘要
  console.log('B 摘要与票据判定')
  check(ticket.UNDO_CHECK_CONTRACT === 'version-control.undo-check' && ticket.UNDO_CHECK_VERSION === 1, 'B1 预检电话契约名与版本')
  const d1 = ticket.undoPlanDigestOf({ op: 'reset-hard', target: 'HEAD~1', targetOid: 'a'.repeat(40), message: '', resetMode: 'hard', commits: [] })
  const d2 = ticket.undoPlanDigestOf({ commits: [], resetMode: 'hard', message: '', targetOid: 'a'.repeat(40), target: 'HEAD~1', op: 'reset-hard' })
  check(d1 === d2 && /^[0-9a-f]{16}$/.test(d1), 'B2 键序不同摘要相同（稳定序列化）：' + d1)
  const d3 = ticket.undoPlanDigestOf({ op: 'reset-hard', target: 'HEAD~1', targetOid: 'a'.repeat(40), message: '', resetMode: 'hard', commits: ['b'] })
  check(d3 !== d1, 'B3 拣选清单进摘要（换了清单就是另一份计划）')
  const d4 = ticket.undoPlanDigestOf({ op: 'reset-hard', target: 'HEAD~1', targetOid: 'b'.repeat(40), message: '', resetMode: 'hard', commits: [] })
  check(d4 !== d1, 'B13 目标提交号进摘要（只换目标解析结果也是另一份计划）')
  const screenA = { identity: { oid: 'f'.repeat(40), branch: 'main' }, staged: [{ path: 'a.txt', status: 'M' }], unstaged: [], conflictCount: 0, stagedCount: 1, unstagedCount: 0, repo: { hasCommits: true } }
  const screenB = { identity: { oid: 'f'.repeat(40), branch: 'main' }, staged: [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'A' }], unstaged: [], conflictCount: 0, stagedCount: 2, unstagedCount: 0, repo: { hasCommits: true } }
  check(ticket.undoWorktreeDigestOf(screenA) !== ticket.undoWorktreeDigestOf(screenB), 'B4 暂存区多一个文件，工作区摘要就变')
  const scene = ticket.undoSceneSummaryOf(screenA)
  check(scene.head === 'f'.repeat(40) && scene.dirty === true && scene.midOperation === false && scene.hasCommits === true, 'B5 场景摘要只写头/脏/中途/有提交这几个事实')
  check(ticket.undoSceneSummaryOf({ identity: { oid: '' }, repo: { rebasing: true, hasCommits: true } }).midOperationWhich === 'rebase', 'B6 中途操作写清是哪一种')
  check(ticket.undoSceneSummaryOf({ identity: { oid: '' }, repo: {} }).head === '', 'B7 读不到头就写空串，不编假提交号')
  const t1: any = wt.makeTicket({ id: 'un-abc', op: 'reset-hard', nowMs: 1000, headOid: 'f'.repeat(40), indexFingerprint: null, indexEntries: null, target: planSoft.plan, repoRoot: 'D:/r', bindings: { preconditions: { planDigest: d1, worktreeDigest: ticket.undoWorktreeDigestOf(screenA) }, counters: { indexEntries: null } } })
  check(wt.ticketPureVerdict(t1, 'reset-hard', 1000).ok === true && wt.ticketPureVerdict(t1, 'reset-soft', 1000).reason === 'ticket-op-mismatch', 'B8 票据纯判定：动作不符回 ticket-op-mismatch')
  check(wt.ticketPureVerdict(t1, 'reset-hard', t1.expiresAtMs + 1).reason === 'ticket-expired', 'B9 票据纯判定：过期回 ticket-expired')
  check(wt.bindingsVerdict(t1, { preconditions: { planDigest: d3, worktreeDigest: ticket.undoWorktreeDigestOf(screenA) }, counters: { indexEntries: null } }) === 'target-changed', 'B10 计划摘要变了回 target-changed')
  check(wt.bindingsVerdict(t1, { preconditions: { planDigest: d1, worktreeDigest: ticket.undoWorktreeDigestOf(screenB) }, counters: { indexEntries: null } }) === 'target-changed', 'B11 工作区摘要变了回 target-changed（持久层口径；执行层把它翻成对用户更准的 stale-index，见 E7）')
  check(wt.bindingsVerdict(t1, { preconditions: { planDigest: d1, worktreeDigest: ticket.undoWorktreeDigestOf(screenA) }, counters: { indexEntries: null } }) === null, 'B12 现场没变放行')

  // ---- C 三条重置：真仓库、真 git、真 argv ----
  console.log('C 三条重置（真仓库）')
  {
    const r = mkRepo('c-soft')
    const head0 = git(r, ['rev-parse', 'HEAD']).out
    const target = git(r, ['rev-parse', 'HEAD~1']).out
    const vc = makeVc()
    const pre = await vc.handleGitUndoCheck({ cwd: r, op: 'reset-soft', target: 'HEAD~1' })
    check(pre.ok === true && pre.contract === 'version-control.undo-check' && String(pre.ticket.id).slice(0, 2) === 'un', 'C1 软重置预检拿到票（' + (pre.ok ? pre.ticket.id : '失败') + '）')
    check(pre.ok === true && pre.plan.targetOid === target && pre.scene.head === head0, 'C2 预检把目标解析成提交号，回显当前头')
    check(pre.ok === true && pre.steps.length === 1 && pre.danger === false && pre.recovery === null, 'C3 软重置一步、不危险、不要恢复点')
    const w = await vc.handleGitUndoWrite({ cwd: r, op: 'reset-soft', target: 'HEAD~1', ticketId: pre.ticket.id, requestId: 'c-soft-1' })
    check(w.ok === true && w.before.headOid === head0 && w.after.headOid === target && w.stepsDone === 1, 'C4 软重置真跑了：HEAD ' + head0.slice(0, 7) + ' → ' + target.slice(0, 7))
    check(git(r, ['rev-parse', 'HEAD']).out === target && git(r, ['status', '--porcelain']).out === 'A  c.txt', 'C5 软重置后改动回到暂存区（索引里 A c.txt）')
    check(w.after.headOid === git(r, ['rev-parse', 'HEAD']).out, 'C6 回包里的新 HEAD 与仓库实测一致（不猜）')
    const w2 = await vc.handleGitUndoWrite({ cwd: r, op: 'reset-soft', target: 'HEAD~1', ticketId: pre.ticket.id, requestId: 'c-soft-1' })
    check(w2.replayed === true && git(r, ['rev-parse', 'HEAD']).out === target, 'C7 同一 requestId 重放回第一次的结果，不重复执行')
  }
  {
    const r = mkRepo('c-mixed')
    const target = git(r, ['rev-parse', 'HEAD~1']).out
    const vc = makeVc()
    const pre = await vc.handleGitUndoCheck({ cwd: r, op: 'reset-mixed', target: 'HEAD~1' })
    const w = await vc.handleGitUndoWrite({ cwd: r, op: 'reset-mixed', target: 'HEAD~1', ticketId: pre.ticket.id, requestId: 'c-mixed-1' })
    check(pre.ok === true && pre.steps[0][1] === '--mixed', 'C8 混合重置用 --mixed')
    check(w.ok === true && w.after.headOid === target && w.stepsDone === 1, 'C9 混合重置真跑了')
    check(git(r, ['status', '--porcelain']).out === '?? c.txt', 'C10 混合重置后改动退出暂存区（只剩未跟踪的 c.txt）')
  }
  {
    const r = mkRepo('c-hard')
    fs.appendFileSync(path.join(r, 'a.txt'), '脏改动\n')
    const head0 = git(r, ['rev-parse', 'HEAD']).out
    const target = git(r, ['rev-parse', 'HEAD~1']).out
    const vc = makeVc()
    const pre = await vc.handleGitUndoCheck({ cwd: r, op: 'reset-hard', target: 'HEAD~1' })
    check(pre.ok === true && pre.danger === true, 'C11 硬重置预检成功且标成危险动作')
    check(pre.ok === true && pre.steps[0][1] === '--hard' && pre.stepCount === 1, 'C12 硬重置 argv 用 --hard')
    const pt = pre.recovery || {}
    check(pt.kind === 'reset-hard' && pt.required === true && pt.discard && pt.discard.files === 2 && pt.discard.added === 2 && pt.discard.binary === 0, 'C13 恢复点数清会丢什么（工作树相对目标：a.txt 改动与 c.txt 共 2 个文件、新增 ' + (pt.discard && pt.discard.added) + ' 行）')
    check(pt.commits === 1 && pt.restore && pt.restore.headOid === head0 && pt.restore.reflogBefore === 'HEAD@{0}' && pt.restore.reflogAfter === 'HEAD@{1}', 'C14 恢复点记着旧提交全号与前后 reflog 选择器、会被移出历史的提交数')
    const w = await vc.handleGitUndoWrite({ cwd: r, op: 'reset-hard', target: 'HEAD~1', ticketId: pre.ticket.id, requestId: 'c-hard-1' })
    check(w.ok === true && w.after.headOid === target && w.stepsDone === 1, 'C15 硬重置真跑了')
    check(git(r, ['rev-parse', 'HEAD']).out === target && git(r, ['status', '--porcelain']).out === '', 'C16 硬重置后工作区与暂存区都干净')
    check(fs.readFileSync(path.join(r, 'a.txt'), 'utf8') === '第一行\n' && !fs.existsSync(path.join(r, 'c.txt')), 'C17 未提交的脏改动真的被丢掉（a.txt 回到目标版本、c.txt 消失）')
    check(w.recovery && w.recovery.restore.headOid === head0, 'C18 执行回包带同一份恢复点（丢了怎么找回还在）')
  }

  // ---- D 还原与拣选 ----
  console.log('D 还原与拣选（真仓库）')
  {
    const r = mkRepo('d-revert')
    const head0 = git(r, ['rev-parse', 'HEAD']).out
    const vc = makeVc()
    const pre = await vc.handleGitUndoCheck({ cwd: r, op: 'revert', target: 'HEAD' })
    check(pre.ok === true && pre.defaultMessage === 'Revert "第三提交：建立 c.txt"' && pre.plan.message === pre.defaultMessage, 'D1 还原的默认说明与 git 会写的那句一致（可改）')
    check(pre.steps.length === 2 && pre.steps[0].join(' ') === 'revert --no-commit ' + head0 && pre.steps[1][0] === 'commit' && pre.steps[1].indexOf(pre.defaultMessage) > 0, 'D2 还原两步 argv：先 --no-commit 再按说明提交')
    const w = await vc.handleGitUndoWrite({ cwd: r, op: 'revert', target: 'HEAD', message: pre.defaultMessage, ticketId: pre.ticket.id, requestId: 'd-revert-1' })
    check(w.ok === true && w.stepsDone === 2, 'D3 还原真跑了两步')
    check(git(r, ['log', '-1', '--format=%s']).out === pre.defaultMessage, 'D4 新提交的说明就是确认卡上那句')
    check(!fs.existsSync(path.join(r, 'c.txt')) && git(r, ['status', '--porcelain']).out === '', 'D5 还原后 c.txt 被撤销且工作区干净')
  }
  {
    const r = mkRepo('d-pick')
    mkFeature(r)
    const pickA = git(r, ['rev-parse', 'feat~1']).out
    const pickB = git(r, ['rev-parse', 'feat']).out
    const vc = makeVc()
    const pre = await vc.handleGitUndoCheck({ cwd: r, op: 'cherry-pick', commits: pickA + '\n' + pickB })
    check(pre.ok === true && pre.plan.commits.length === 2 && pre.plan.commits[0].oid === pickA && pre.plan.commits[1].oid === pickB, 'D6 拣选预检按给出次序解析两条提交')
    check(pre.steps.length === 1 && pre.steps[0].join(',') === 'cherry-pick,' + pickA + ',' + pickB, 'D7 拣选是一条命令按序传入两条提交号')
    const w = await vc.handleGitUndoWrite({ cwd: r, op: 'cherry-pick', commits: pickA + '\n' + pickB, ticketId: pre.ticket.id, requestId: 'd-pick-1' })
    check(w.ok === true && w.stepsDone === 1, 'D8 拣选真跑了')
    const subj = git(r, ['log', '-2', '--format=%s']).out.split('\n')
    check(subj[0] === 'feat 乙' && subj[1] === 'feat 甲', 'D9 两条提交按给出次序落地（先甲后乙：' + subj.reverse().join(' → ') + '）')
    check(fs.existsSync(path.join(r, 'f1.txt')) && fs.existsSync(path.join(r, 'f2.txt')), 'D10 两条提交带的文件都在')
  }
  {
    const r = mkRepo('d-conflict')
    git(r, ['checkout', '-q', '-b', 'feat'])
    fs.writeFileSync(path.join(r, 'shared.txt'), 'feat 版\n'); git(r, ['add', '-A']); git(r, ['commit', '-q', '-m', 'feat 改 shared'])
    const pick = git(r, ['rev-parse', 'HEAD']).out
    git(r, ['checkout', '-q', 'main'])
    fs.writeFileSync(path.join(r, 'shared.txt'), 'main 版\n'); git(r, ['add', '-A']); git(r, ['commit', '-q', '-m', 'main 改 shared'])
    const vc = makeVc()
    const pre = await vc.handleGitUndoCheck({ cwd: r, op: 'cherry-pick', commits: pick })
    check(pre.ok === true, 'D11 会撞冲突的拣选在预检阶段看不出来（git 只在执行时才知道）')
    const w = await vc.handleGitUndoWrite({ cwd: r, op: 'cherry-pick', commits: pick, ticketId: pre.ticket.id, requestId: 'd-conflict-1' })
    check(w.ok === false && w.error.kind === 'conflict' && w.error.reason === 'cherry-pick-conflict', 'D12 拣选撞冲突：kind=conflict、reason=cherry-pick-conflict（不自动解决）')
    check(w.conflicts && w.conflicts.indexOf('shared.txt') >= 0, 'D13 冲突文件清单交回界面：' + (w.conflicts || []).join('、'))
    check(/^(AA|UU) shared\.txt$/m.test(git(r, ['status', '--porcelain']).out), 'D14 仓库真的停在冲突态（证明没有替用户编一份结果）')
    git(r, ['cherry-pick', '--abort'])
  }
  {
    const r = mkRepo('d-partial')
    const head0 = git(r, ['rev-parse', 'HEAD']).out
    const vc = makeVc(function (argv) {
      const a = after(argv)
      if (a[0] === 'commit') return { code: 1, stderr: 'fatal: 提交这一步被门禁的垫片拦住\n' }
      return null
    })
    const pre = await vc.handleGitUndoCheck({ cwd: r, op: 'revert', target: 'HEAD' })
    const w = await vc.handleGitUndoWrite({ cwd: r, op: 'revert', target: 'HEAD', message: pre.defaultMessage, ticketId: pre.ticket.id, requestId: 'd-partial-1' })
    check(w.ok === false && w.error.kind === 'partial' && w.error.reason === 'revert-partial' && w.stepsDone === 1, 'D15 还原第二步没提交成：kind=partial、reason=revert-partial（如实说停在哪）')
    check(git(r, ['rev-parse', 'HEAD']).out === head0 && git(r, ['status', '--porcelain']).out === 'D  c.txt', 'D16 此时反向改动已进索引、HEAD 没动（与原话一致）')
    git(r, ['revert', '--quit']); git(r, ['reset', '--hard', head0])
  }

  // ---- E 六种拒绝理由与零进程闸 ----
  console.log('E 拒绝理由与零进程闸')
  {
    const aA = mkRepo('e-a')
    const aB = mkRepo('e-b')
    const vc = makeVc()
    const pre = await vc.handleGitUndoCheck({ cwd: aA, op: 'reset-soft', target: 'HEAD~1' })
    check(pre.ok === true, 'E1 预检拿到票（后面几格拿这张票试各种失效）')
    let n = spawns.length
    const fake = await vc.handleGitUndoWrite({ cwd: aA, op: 'reset-soft', target: 'HEAD~1', ticketId: 'NO-SUCH-TICKET' })
    check(deny(fake, 'ticket-missing') && spawns.length === n, 'E2 伪造票：ticket-missing 且一个进程都没起')
    const mism = await vc.handleGitUndoWrite({ cwd: aA, op: 'reset-hard', target: 'HEAD~2', ticketId: pre.ticket.id })
    check(deny(mism, 'ticket-op-mismatch'), 'E3 换动作（软重置的票拿去硬重置）：ticket-op-mismatch')
    clock.t = pre.ticket.expiresAtMs + 1
    const exp = await vc.handleGitUndoWrite({ cwd: aA, op: 'reset-soft', target: 'HEAD~1', ticketId: pre.ticket.id })
    check(deny(exp, 'ticket-expired'), 'E4 过期票：ticket-expired')
    clock.t = 1000000
    const preB = await vc.handleGitUndoCheck({ cwd: aA, op: 'reset-soft', target: 'HEAD~1' })
    const other = await vc.handleGitUndoWrite({ cwd: aB, op: 'reset-soft', target: 'HEAD~1', ticketId: preB.ticket.id })
    check(deny(other, 'stale-repo') && writes().length === 0, 'E5 换仓库（A 的票在 B 上用）：stale-repo 且零写命令')
    git(aA, ['commit', '-q', '--allow-empty', '-m', '别的进程提交的'])
    const moved = await vc.handleGitUndoWrite({ cwd: aA, op: 'reset-soft', target: 'HEAD~1', ticketId: preB.ticket.id })
    check(deny(moved, 'stale-head') && writes().length === 0, 'E6 确认后 HEAD 漂了：stale-head 且零写命令')
    const preC = await vc.handleGitUndoCheck({ cwd: aA, op: 'reset-soft', target: 'HEAD~1' })
    fs.writeFileSync(path.join(aA, 'dirty.txt'), '新文件\n'); git(aA, ['add', 'dirty.txt'])
    const dirty = await vc.handleGitUndoWrite({ cwd: aA, op: 'reset-soft', target: 'HEAD~1', ticketId: preC.ticket.id })
    check(deny(dirty, 'stale-index') && writes().length === 0, 'E7 确认后索引变了：stale-index 且零写命令')
    const rSide = mkRepo('e-side')
    git(rSide, ['branch', 'side', 'HEAD~1'])
    const vcS = makeVc()
    const preS = await vcS.handleGitUndoCheck({ cwd: rSide, op: 'reset-soft', target: 'side' })
    git(rSide, ['branch', '-f', 'side', 'HEAD~2'])
    const drift = await vcS.handleGitUndoWrite({ cwd: rSide, op: 'reset-soft', target: 'side', ticketId: preS.ticket.id })
    check(deny(drift, 'target-changed') && writes().length === 0, 'E8 目标引用在预检之后换了指向：target-changed 且零写命令')
    const rMid = mkRepo('e-mid')
    git(rMid, ['checkout', '-q', '-b', 'other', 'HEAD~1'])
    fs.writeFileSync(path.join(rMid, 'c.txt'), '别的分支版本\n'); git(rMid, ['add', '-A']); git(rMid, ['commit', '-q', '-m', '别的分支改 c'])
    git(rMid, ['checkout', '-q', 'main'])
    fs.writeFileSync(path.join(rMid, 'c.txt'), '主线版本\n'); git(rMid, ['add', '-A']); git(rMid, ['commit', '-q', '-m', '主线改 c'])
    git(rMid, ['merge', '--no-edit', 'other'])
    const vcM = makeVc()
    const mid = await vcM.handleGitUndoCheck({ cwd: rMid, op: 'reset-soft', target: 'HEAD~1' })
    check(mid.ok === false && mid.error.kind === 'blocked' && mid.error.reason === 'mid-operation' && mid.scene && mid.scene.midOperation === true, 'E9 仓库停在合并中途：mid-operation（先做完或放弃再来）')
    git(rMid, ['merge', '--abort'])
    const rNoHead = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1748-e-empty-'))
    git(rNoHead, ['init', '-q', '-b', 'main'])
    const empty = await vcM.handleGitUndoCheck({ cwd: rNoHead, op: 'reset-soft', target: 'HEAD~1' })
    check(empty.ok === false && empty.error.reason === 'no-head', 'E10 还没有第一次提交的仓库：no-head（不改历史）')
    const rMiss = mkRepo('e-miss')
    const miss = await vcM.handleGitUndoCheck({ cwd: rMiss, op: 'reset-soft', target: 'nope-nope' })
    check(miss.ok === false && miss.error.reason === 'target-missing' && miss.field === 'target', 'E11 目标提交不存在：target-missing 且指 target 字段')
    const same = await vcM.handleGitUndoCheck({ cwd: rMiss, op: 'reset-soft', target: 'HEAD' })
    check(same.ok === false && same.error.reason === 'nothing-to-do', 'E12 目标就是当前头：nothing-to-do（不签一张没意义的票）')
    const dup = await vcM.handleGitUndoCheck({ cwd: rMiss, op: 'cherry-pick', commits: 'HEAD~1' })
    check(dup.ok === false && dup.error.reason === 'commit-already-present', 'E13 拣选的提交已在历史里：commit-already-present')
    const badReq = await vcM.handleGitUndoWrite({ cwd: rMiss, op: 'reset-soft', target: 'HEAD~1', ticketId: 'x', requestId: 'bad id!' })
    check(badReq.ok === false && badReq.error.kind === 'usage', 'E14 requestId 形状不对：usage 拒绝（重放保护不能含糊）')
    check(deny(fake, 'ticket-missing') === true && deny({ ok: true, after: {} }, 'ticket-missing') === false, 'E15 拒绝判据自检：把「放行」的坏回包喂给同一套判据必须判红')
  }

  // ---- F 恢复点纯逻辑 ----
  console.log('F 恢复点')
  {
    const good = rec.recoveryPointOf({ headOid: 'a'.repeat(40), targetOid: 'b'.repeat(40), impact: { files: 2, added: 5, deleted: 3, binary: 1, truncated: false }, commits: 4, reflogBefore: 'HEAD@{0}', reflogAfter: 'HEAD@{1}', atMs: 7 })
    check(good.ok === true && good.point.discard.files === 2 && good.point.commits === 4, 'F1 恢复点原样收下四项计数与提交数')
    const steps = rec.recoveryRestoreStepsOf(good.point)
    check(steps.length === 2 && steps[0] === 'git reset --hard ' + 'a'.repeat(40) && steps[1].indexOf('HEAD@{1}') > 0, 'F2 找回旧提交的两步写法（旧提交已失效时再用 reflog）')
    check(rec.recoverySummaryOf(good.point).indexOf('2 个文件') === 0 && rec.recoverySummaryOf(good.point).indexOf('二进制') > 0, 'F3 一句话摘要把丢失量写全（含二进制）')
    check(rec.recoveryImpactProblem({ files: -1, added: 0, deleted: 0, binary: 0, truncated: false }) === 'bad-count', 'F4 计数为负：判坏')
    check(rec.recoveryImpactProblem({ files: 0, added: 0, deleted: 0, binary: 0 }) === 'bad-truncated', 'F5 缺完整性标志：判坏')
    const cut = rec.recoveryPointOf({ headOid: 'a'.repeat(40), targetOid: 'b'.repeat(40), impact: { files: 1, added: 1, deleted: 0, binary: 0, truncated: true } })
    check(cut.ok === false && cut.reason === 'recovery-unreadable', 'F6 读数被截断：recovery-unreadable（数不全就不签票）')
    const noHead = rec.recoveryPointOf({ headOid: '', targetOid: 'b'.repeat(40), impact: { files: 0, added: 0, deleted: 0, binary: 0, truncated: false } })
    check(noHead.ok === false && noHead.reason === 'recovery-unreadable', 'F7 缺当前头：recovery-unreadable')
    const rTrunc = mkRepo('f-trunc')
    const vcT = makeVc(function (argv) {
      const a = after(argv)
      if (a[0] === 'diff' && a.indexOf('--numstat') >= 0) return { code: 0, stdout: '3\t0\ta.txt\u0000', truncated: true }
      return null
    })
    const preT = await vcT.handleGitUndoCheck({ cwd: rTrunc, op: 'reset-hard', target: 'HEAD~1' })
    check(preT.ok === false && preT.error.kind === 'truncated' && String(preT.error.message).indexOf('读不全') >= 0, 'F8 影响读数被截断时宿主拒签票（不给半份计数，也不让硬重置执行）')
  }

  // ---- G 反证：把判据改坏，同一套判断必须判红 ----
  console.log('G 反证')
  {
    const N = buildUndoShared()
    check(N.undoArgvOf({ op: 'reset-hard', target: 'HEAD~1' }).steps[0][1] === '--hard', 'G0 反证基座：未改动的闭包同一判据为真')
    const B1 = buildUndoShared(function (s) { return s.replace("return { ok: true, steps: [['reset', '--' + String(def.resetMode), target]] }", "return { ok: true, steps: [['reset', '--soft', target]] }") })
    check(B1.undoArgvOf({ op: 'reset-hard', target: 'HEAD~1' }).steps[0][1] !== '--hard', 'G1 把重置 argv 写死成 --soft：硬重置那格的判据必红')
    const B2 = buildUndoShared(function (s) { return s.replace("    targetOid: String(p.targetOid || ''),", "    targetOid: '',") })
    const p1 = { op: 'reset-hard', target: 'HEAD~1', targetOid: 'a'.repeat(40), message: '', resetMode: 'hard', commits: [] }
    const p2 = { op: 'reset-hard', target: 'HEAD~1', targetOid: 'b'.repeat(40), message: '', resetMode: 'hard', commits: [] }
    check(B2.undoPlanDigestOf(p1) === B2.undoPlanDigestOf(p2), 'G2 摘要输入里摘掉目标提交号：只换目标解析结果的判据（B13）必红')
    const B3 = buildUndoShared(function (s) { return s.replace('if (impact.truncated === true) return { ok: false', 'if (false) return { ok: false') })
    check(B3.recoveryPointOf({ headOid: 'a'.repeat(40), targetOid: 'b'.repeat(40), impact: { files: 1, added: 1, deleted: 0, binary: 0, truncated: true } }).ok === true, 'G3 截断拒签那行改坏：读不全就拒签票的判据必红')
    const B4 = buildUndoShared(function (s) { return s.replace("{ id: '5.3', op: 'reset-hard', nameKey: 'vc.undo.op.resetHard', danger: true", "{ id: '5.3', op: 'reset-hard', nameKey: 'vc.undo.op.resetHard', danger: false") })
    check(B4.undoDangerOf('reset-hard') === false, 'G4 硬重置不再标危险：危险等级判据必红')
  }

  printGateResult('verify-1586-undo-restore', total, failed)
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('门禁脚本自身出错：' + (e && e.stack ? e.stack : e)); printGateResult('verify-1586-undo-restore', total, true); process.exit(1) })
