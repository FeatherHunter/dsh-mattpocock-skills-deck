// 门禁归属: src/shared/version-control/src/note-ops.ts
// 门禁归属: src/host/versionControlNote.ts
// 门禁归属: src/shared/version-control/src/parse-log.ts
// 门禁归属: src/shared/version-control/src/commands.ts
// 门禁归属: src/host/versionControlHistory.ts
// #1903 提交历史页四条能力（3.4 / 3.7 / 3.8 / 3.12）的后端半边：
//   ① 提交改到了哪些文件的那条读法（git log --name-only）怎么拼、怎么解析；
//   ② 提交备注的输入口径与 argv；
//   ③ 备注写路径的票据门（票不在 / 过期 / 换仓库 / 备注在确认之后被改过，都一条写命令都不许起）；
//   ④ 比较两个引用时认不出的一端要原样报回来，不许悄悄当成 HEAD。
// 界面那一半（范围切换、只看文件、比较结果、备注段）由 tests/verify-818-version-control-view.ts 的 Z1903 段断言。
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1903-history-entries'
let total = 0
let failed = 0
function check(ok, msg) { total += 1; if (!ok) { failed += 1; console.log('  FAIL ' + msg) } }
const text = (v) => (v === null || v === undefined ? '' : String(v))
const modUrl = (rel) => pathToFileURL(path.join(ROOT, rel)).href

const OID_A = 'a'.repeat(40)
const OID_B = 'b'.repeat(40)
const SOH = String.fromCharCode(1)
const NUL = String.fromCharCode(0)

async function main() {
  // ---------------- ① 每条提交改到了哪些文件 ----------------
  console.log('A 每条提交改到了哪些文件（git log --name-only）')
  const CMD = await import(modUrl('src/shared/version-control/src/commands.ts'))
  const namesArgs = CMD.commandFor('log', { logCount: 7, logNames: true, logSkip: 3 }).args
  check(namesArgs[0] === 'log' && namesArgs.indexOf('--name-only') >= 0 && namesArgs.indexOf('-z') >= 0,
    'A1 拼出来的是带 --name-only 与 -z 的 log（实得 ' + JSON.stringify(namesArgs) + '）')
  check(namesArgs.indexOf('--format=%x01%H') >= 0, 'A2 提交号前有一枚 %x01 记录标记（否则 40 位哈希的文件名会被当成提交号）')
  check(namesArgs.join(' ').indexOf('-n 7') >= 0 && namesArgs.indexOf('--skip=3') >= 0, 'A3 条数与起点都进了 argv')
  const plainArgs = CMD.commandFor('log', { logCount: 7 }).args
  check(plainArgs.indexOf('--name-only') < 0, 'A4 不带 logNames 时仍是原来那条八字段命令（既有读法一个字没改）')

  const PL = await import(modUrl('src/shared/version-control/src/parse-log.ts'))
  const sample = SOH + OID_A + NUL + '\n' + 'src/a.ts' + NUL + 'src/dir/b b.ts' + NUL + SOH + OID_B + NUL + '\n'
  const parsed = PL.parseLogFiles(sample)
  check(parsed.ok === true && parsed.commits.length === 2, 'A5 两条提交各带自己的文件清单（实际 ' + (parsed.ok ? parsed.commits.length : parsed.reason) + ' 条）')
  if (parsed.ok === true && parsed.commits.length === 2) {
    check(parsed.commits[0].oid === OID_A && parsed.commits[0].paths.length === 2 && parsed.commits[0].paths[1] === 'src/dir/b b.ts',
      'A6 路径原样保留（含空格），提交号后面那个换行被剥掉')
    check(parsed.commits[1].oid === OID_B && parsed.commits[1].paths.length === 0, 'A7 没有文件清单的提交读成空数组（不补假数据）')
  }
  check(PL.parseLogFiles('').ok === true && PL.parseLogFiles('').commits.length === 0, 'A8 空输出读成零条')
  check(PL.parseLogFiles('src/a.ts' + NUL).ok === false, 'A9 文件出现在提交号之前判失败（不猜它属于哪条提交）')
  check(PL.parseLogFiles(SOH + 'not-a-hash' + NUL).ok === false, 'A10 提交号那一段不是哈希就判失败')

  // ---------------- ② 备注的输入口径与 argv ----------------
  console.log('B 提交备注的输入口径')
  const NO = await import(modUrl('src/shared/version-control/src/note-ops.ts'))
  check(NO.noteTextProblem('') === null && NO.noteTextProblem('写一句') === null, 'B1 空文本与普通文本都合法（空文本 = 删除这条备注）')
  check(NO.noteTextProblem('x'.repeat(NO.NOTE_TEXT_MAX + 1)) === 'too-long', 'B2 超过上限显式拒绝，不悄悄截断')
  check(NO.noteTextProblem('a' + NUL + 'b') === 'bad-shape', 'B3 NUL 不许进 argv')
  check(NO.noteRevProblem('') === 'required' && NO.noteRevProblem('-x') === 'bad-shape' && NO.noteRevProblem('a..b') === 'bad-shape', 'B4 提交号形状：空 / 前导横杠 / 区间都拒')
  check(NO.noteRevProblem(OID_A) === null && NO.noteRevProblem('HEAD~2') === null, 'B5 完整哈希与 HEAD~2 都收')
  const addArgv = NO.noteArgvOf(OID_A, '这一版为了兼容旧数据')
  check(addArgv.length === 6 && addArgv[0] === 'notes' && addArgv[1] === 'add' && addArgv[2] === '-f' && addArgv[3] === '-m' && addArgv[4] === '这一版为了兼容旧数据' && addArgv[5] === OID_A,
    'B6 写备注的 argv 逐格对：notes add -f -m <文本> <提交>（实得 ' + JSON.stringify(addArgv) + '）')
  check(NO.noteArgvOf(OID_A, '').join(' ') === ('notes remove ' + OID_A), 'B7 空文本拼成 notes remove')
  check(NO.noteRemovingOf('') === true && NO.noteRemovingOf('x') === false, 'B8 「是不是删除」只有一处口径')
  check(NO.notePlanInputOf(OID_A, 'old') !== NO.notePlanInputOf(OID_A, 'new'), 'B9 票里绑的字节跟着备注原文变')

  // ---------------- ③ 备注写路径的票据门 ----------------
  console.log('C 备注写路径的票据门（真跑一遍，一条写命令都不许乱起）')
  const NOTE = await import(modUrl('src/host/versionControlNote.ts'))
  const made = makeNoteDeps({ note: '', revKnown: { HEAD: OID_A, nope: null } })
  const phones = NOTE.createNotePhones(made.deps)
  check(phones.tickets instanceof Map, 'C1 预检层带回一张票表（票只留在宿主进程内存里）')

  const badRev = await phones.check({ cwd: '/w/repo', rev: 'nope', text: '写一句' })
  check(badRev.ok === false && badRev.error.reason === 'unknown-rev', 'C2 认不出的提交原样说「找不到这个提交」（实得 ' + text(badRev.error && badRev.error.reason) + '）')
  check(made.writes().length === 0, 'C3 认不出提交时一条写命令都没起')

  const noNoteYet = await phones.check({ cwd: '/w/repo', rev: 'HEAD', text: '' })
  check(noNoteYet.ok === false && noNoteYet.error.reason === 'note-empty', 'C4 没有备注却要删：明确拒绝，不写空备注')

  const ok = await phones.check({ cwd: '/w/repo', rev: 'HEAD', text: '这一版为了兼容旧数据' })
  check(ok.ok === true && ok.ticket && ok.ticket.op === 'note' && ok.plan.hadNote === false, 'C5 预检通过签发一张 note 票，并说清这条提交原来没有备注')

  const moved = await phones.write({ cwd: '/w/other', ticketId: ok.ticket.id, requestId: 'req-repo' })
  check(moved.ok === false && moved.error.reason === 'stale-repo', 'C6 换了仓库：拒绝（票绑的是哪个工作树就只在哪个里执行）')
  check(made.writes().length === 0, 'C7 换仓库时零写命令')

  made.setNote('别人的话')
  const changed = await phones.write({ cwd: '/w/repo', ticketId: ok.ticket.id, requestId: 'req-changed' })
  check(changed.ok === false && changed.error.reason === 'note-changed', 'C8 预检之后备注被别人改过：拒绝，不覆盖别人的话')
  check(made.writes().length === 0, 'C9 备注被改过时零写命令')

  made.advance(ok.ticket.expiresAtMs - made.deps.nowMs() + 1)
  const spawnsBeforeExpired = made.spawns()
  const expired = await phones.write({ cwd: '/w/repo', ticketId: ok.ticket.id, requestId: 'req-expired' })
  check(expired.ok === false && expired.error.reason === 'ticket-expired', 'C10 票过期：拒绝')
  check(made.writes().length === 0, 'C11 票过期时零写命令')
  // ADR 20261004 第 5 条：票失效时一个进程都不许起 —— 连 rev-parse 那条只读命令也不许。
  check(made.spawns() === spawnsBeforeExpired, 'C11b 票过期时连一个进程都没起（纯判定先行，实得多起 ' + String(made.spawns() - spawnsBeforeExpired) + ' 个）')
  const spawnsBeforeMissing = made.spawns()
  const missing = await phones.write({ cwd: '/w/repo', ticketId: 'tk-nope', requestId: 'req-missing' })
  check(missing.ok === false && missing.error.reason === 'ticket-missing' && made.spawns() === spawnsBeforeMissing, 'C11c 票不在时也一个进程都不起')

  const ok2 = await phones.check({ cwd: '/w/repo', rev: 'HEAD', text: '这一版为了兼容旧数据' })
  const wrote = await phones.write({ cwd: '/w/repo', ticketId: ok2.ticket.id, requestId: 'req-ok' })
  check(wrote.ok === true && wrote.cmd === 'git notes add' && wrote.removing === false, 'C12 凭票执行成功，回包说清写的是哪条命令')
  const argv = made.writes()[0] || []
  check(argv.join(' ') === ('notes add -f -m 这一版为了兼容旧数据 ' + OID_A), 'C13 真跑的那条 argv 就是 notes add -f -m（实得 ' + JSON.stringify(argv) + '）')

  const replay = await phones.write({ cwd: '/w/repo', ticketId: ok2.ticket.id, requestId: 'req-ok' })
  check(replay.ok === true && made.writes().length === 1, 'C14 同一个 requestId 重放回第一次的结果，不重复写（连点两下不会写两遍）')

  // 读不动 git 时不许说「找不到这个提交 / 这条提交还没有备注」：那是把「读不到」当成「没有」。
  const broken = makeNoteDeps({ note: '', revKnown: {} })
  broken.deps.runPinned = async () => ({ kind: 'spawn-failed', message: 'spawn ENOENT' })
  const brokenCheck = await NOTE.createNotePhones(broken.deps).check({ cwd: '/w/repo', rev: 'HEAD', text: '写一句' })
  check(brokenCheck.ok === false && brokenCheck.error.reason === 'read-failed',
    'C16 起不动进程时如实说「读不到」，不冒充「找不到这个提交」（实得 ' + text(brokenCheck.error && brokenCheck.error.reason) + '）')

  const removed = makeNoteDeps({ note: '旧的备注', revKnown: { HEAD: OID_A } })
  const rmPhones = NOTE.createNotePhones(removed.deps)
  const rmCheck = await rmPhones.check({ cwd: '/w/repo', rev: 'HEAD', text: '' })
  const rmWrite = await rmPhones.write({ cwd: '/w/repo', ticketId: rmCheck.ticket.id, requestId: 'req-rm' })
  check(rmWrite.ok === true && rmWrite.removing === true && (removed.writes()[0] || []).join(' ') === ('notes remove ' + OID_A), 'C15 清空再存 = 删除这条备注（argv 是 notes remove）')

  // ---------------- ④ 比较两个引用：认不出的一端原样报回来 ----------------
  console.log('D 比较两个引用时的引用解析')
  const HIST = await import(modUrl('src/host/versionControlHistory.ts'))
  const histDeps = makeHistoryDeps({ revs: { HEAD: OID_A, 'HEAD~1': OID_B } })
  const histPhone = HIST.createHistoryQueryPhone(histDeps.deps)
  const unknown = await histPhone({ cwd: '/w/repo', kind: 'compare', params: { left: 'nope', right: 'HEAD' } })
  check(unknown.ok === false && unknown.error.reason === 'unknown-rev' && unknown.error.which === 'left' && text(unknown.error.message).indexOf('nope') >= 0,
    'D1 左边认不出：回 reason=unknown-rev 与 which=left，原话里带着那个词（实得 ' + JSON.stringify(unknown.error || {}) + '）')
  check(histDeps.diffs() === 0, 'D2 两端没都认出来时一条 diff 都没跑（不拿 HEAD 顶替）')
  const known = await histPhone({ cwd: '/w/repo', kind: 'compare', params: { left: 'HEAD~1', right: 'HEAD' } })
  check(known.ok === true && Array.isArray(known.files) && known.leftOid === OID_B && known.rightOid === OID_A, 'D3 两端都认得出：结果里带上解析后的两个提交号')
  check(histDeps.diffs() === 1, 'D4 正常比较只跑一条 diff')

  // ---------------- ④b 客户端那两个上限与共享层逐条相等 ----------------
  console.log('D2 客户端的上限与共享层同源')
  const OPS = await import(modUrl('src/client/views/versionControl/vcHistoryOps.ts'))
  check(OPS.VC_NOTE_TEXT_MAX === NO.NOTE_TEXT_MAX, 'D2a 客户端备注上限等于共享层 NOTE_TEXT_MAX（客户端 ' + String(OPS.VC_NOTE_TEXT_MAX) + ' / 共享层 ' + String(NO.NOTE_TEXT_MAX) + '）')
  const HQ = await import(modUrl('src/shared/version-control/src/history-query-commands.ts'))
  check(OPS.VC_HISTORY_FILE_MAX === HQ.HISTORY_QUERY_COUNT_MAX, 'D2b 客户端单文件历史上限等于共享层 HISTORY_QUERY_COUNT_MAX（客户端 ' + String(OPS.VC_HISTORY_FILE_MAX) + ' / 共享层 ' + String(HQ.HISTORY_QUERY_COUNT_MAX) + '）')

  // ---------------- ⑤ 给一批提交补上文件清单与备注标记 ----------------
  console.log('E 给一批提交补上「改到了哪些文件」与「哪几条有备注」')
  const LOGFILES = await import(modUrl('src/host/versionControlLogFiles.ts'))
  const runs = []
  const fakeRun = async (exe, root, argv) => {
    runs.push(argv.slice())
    if (argv[0] === 'log') return { kind: 'ok', stdout: SOH + OID_A + NUL + '\n' + 'src/a.ts' + NUL + SOH + OID_B + NUL + '\n', truncated: false }
    if (argv[0] === 'notes' && argv[1] === 'list') return { kind: 'ok', stdout: OID_A + ' ' + OID_B + '\n', truncated: false }
    return { kind: 'non-zero', exitCode: 1, stderr: '' }
  }
  const batch = [{ oid: OID_A }, { oid: OID_B }]
  await LOGFILES.attachCommitFileInfo(fakeRun, 'git', '/w/repo', batch, 0)
  check(Array.isArray(batch[0].paths) && batch[0].paths.join(',') === 'src/a.ts' && batch[1].paths.length === 0,
    'E1 每条提交补上自己的文件清单（没有改动的那条是空数组）')
  check(batch[0].hasNote === false && batch[1].hasNote === true, 'E2 「哪几条有备注」按 git notes list 判，不靠界面自己记')
  check(runs.length === 2 && runs[0][0] === 'log' && runs[1][0] === 'notes', 'E3 只起两条读命令（文件清单 + 备注索引）')
  const brokenBatch = [{ oid: OID_A }]
  await LOGFILES.attachCommitFileInfo(async () => ({ kind: 'non-zero', exitCode: 128, stderr: 'boom' }), 'git', '/w/repo', brokenBatch, 0)
  check(Array.isArray(brokenBatch[0].paths) && brokenBatch[0].paths.length === 0 && brokenBatch[0].hasNote === false,
    'E4 这两条读失败时留空、不报错（历史片与续读本身照常可用）')

  // ---------------- ⑥ 备注电话的装配外壳 ----------------
  console.log('F 备注电话的装配外壳（懒加载 + 票表复用）')
  const MOUNT = await import(modUrl('src/host/versionControlNoteMount.ts'))
  const hostCalls = []
  const host = {
    failPhone: (kind, message) => ({ ok: false, error: { kind: kind, message: message || '' } }),
    runPinned: async () => ({ kind: 'ok', stdout: OID_A + '\n', truncated: false }),
    resolveGitExecutable: async () => 'git',
    resolveRepoRoot: async () => ({ ok: true, root: '/w/repo' }),
    cwdOf: () => '/w/repo',
    now: () => Date.parse('2026-11-05T10:00:00+08:00'),
    loggedPhone: function (method, kind, fn) { return async function (args) { hostCalls.push(method); return fn(args) } },
  }
  const one = MOUNT.notePhonesOf(host)
  const two = MOUNT.notePhonesOf(host)
  check(one === two, 'F1 同一份宿主依赖只装配一次（票表因此不会在两次拨电话之间丢掉）')
  const checkReply = await one.handleGitNoteCheck({ cwd: '/w/repo', rev: 'HEAD', text: '写一句' })
  check(checkReply.ok === true && !!checkReply.ticket, 'F2 预检电话真的签到票')
  const tickets = await MOUNT.noteTicketsOf(host)
  check(tickets instanceof Map && tickets.size >= 1 && hostCalls.join(',') === 'wf.gitNoteCheck',
    'F3 票表确实留下了一张票；读票表不是电话、不落日志（实得日志里的电话：' + hostCalls.join(',') + '）')

  printGateResult(GATE, total, failed)
}

/**
 * 备注写路径的假依赖：一个「记得住备注原文」的内存仓库。
 * 每一次写命令都记进 writes()，票据门要求「一格不对就零写命令」，门禁就数这个数组。
 */
function makeNoteDeps(init) {
  const s = { note: text(init.note), list: [], spawns: 0, now: Date.parse('2026-11-05T10:00:00+08:00') }
  const deps = {
    failPhone: (kind, message) => ({ ok: false, error: { kind: kind, message: message || '' } }),
    runPinned: async (exe, root, argv) => {
      s.spawns += 1
      if (argv[0] === 'rev-parse') {
        const rev = String(argv[3] || '').replace('^{commit}', '')
        const oid = init.revKnown[rev]
        return oid ? { kind: 'ok', stdout: oid + '\n', truncated: false } : { kind: 'non-zero', exitCode: 128, stderr: 'unknown revision' }
      }
      if (argv[0] === 'notes' && argv[1] === 'show') return s.note === '' ? { kind: 'non-zero', exitCode: 1, stderr: '' } : { kind: 'ok', stdout: s.note + '\n', truncated: false }
      if (argv[0] === 'notes' && (argv[1] === 'add' || argv[1] === 'remove')) {
        s.list.push(argv.slice())
        s.note = argv[1] === 'remove' ? '' : String(argv[4])
        return { kind: 'ok', stdout: '', truncated: false }
      }
      return { kind: 'non-zero', exitCode: 1, stderr: 'unexpected' }
    },
    resolveGitExecutable: async () => 'git',
    // 工作树的根跟着 cwd 走：换一个目录就是另一个仓库（票据绑的是具体哪一个工作树）。
    resolveRepoRoot: async (exe, cwd) => ({ ok: true, root: text(cwd) === '' ? '/w/repo' : text(cwd) }),
    cwdOf: (args) => text(args && args.cwd) || '/w/repo',
    nowMs: () => s.now,
    randomId: () => 'fixed',
  }
  return {
    deps: deps,
    writes: () => s.list,
    setNote: (v) => { s.note = text(v) },
    advance: (ms) => { s.now += Number(ms) || 0 },
    spawns: () => s.spawns,
  }
}

/** 历史查询的假依赖：认识 HEAD / HEAD~1，别的引用一律认不出。 */
function makeHistoryDeps(init) {
  const s = { diffs: 0 }
  const deps = {
    failPhone: (kind, message) => ({ ok: false, error: { kind: kind, message: message || '' } }),
    failureFromExec: (res, what) => (res && res.kind === 'ok' ? null : { ok: false, error: { kind: 'exit', message: what + '失败' } }),
    runPinned: async (exe, root, argv) => {
      if (argv[0] === 'rev-parse') {
        const rev = String(argv[argv.length - 1] || '').replace('^{commit}', '')
        const oid = init.revs[rev]
        return oid ? { kind: 'ok', stdout: oid + '\n', truncated: false } : { kind: 'non-zero', exitCode: 128, stderr: 'fatal: ambiguous argument' }
      }
      if (argv[0] === 'diff') {
        s.diffs += 1
        return { kind: 'ok', stdout: '3\t1\tsrc/a.ts' + NUL, truncated: false }
      }
      return { kind: 'ok', stdout: '', truncated: false }
    },
    resolveGitExecutable: async () => 'git',
    resolveRepoRoot: async () => ({ ok: true, root: '/w/repo' }),
    cwdOf: () => '/w/repo',
  }
  return { deps: deps, diffs: () => s.diffs }
}

main().then(function () {}, function (e) {
  console.log('  FAIL 门禁自己抛了异常：' + text(e && e.message))
  printGateResult(GATE, 1, 1)
})
