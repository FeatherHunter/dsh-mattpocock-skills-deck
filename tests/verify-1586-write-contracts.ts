// 门禁归属: src/host/versionControl.ts
// verify-1586-write-contracts.ts —— 写路径契约门禁（规格 #1586 之 T06 #1741）。
// 守三类契约：① stdinFile 只读文件流这一个窄例外（命令白名单、路径守卫、大小与摘要、送入字节数、EPIPE 分类、
// 传输层不支持时显式失败）；② 票据绑定字段扩张（后面几节）；③ 命令白名单、路径守卫、refspec 守卫。
// 夹具：真 git 临时仓库 + 与宿主 subprocess 服务同形的假垫片（能记下 argv/cwd/stdio/env，能按需返回
// stdin 管道、待答进程、EPIPE、缺失 stdin 流），这样「到底起没起进程」与「送进去了多少字节」都看得见。
// 本文件是 CommonJS：产品源码用动态 import 取，说明符写 .js（靠钩子改指同名 .ts）。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-write-contracts.ts
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-write-contracts'
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + msg) }

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

/** 造一个真临时 git 仓库：基线一次提交，工作区留一处未暂存改动，用来给写命令当靶子。 */
function mkRepo(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1586c-' + tag + '-'))
  git(base, ['init', '-q', '-b', 'main'])
  git(base, ['config', 'user.name', 'x'])
  git(base, ['config', 'user.email', 'x@y'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\n')
  git(base, ['add', '-A'])
  git(base, ['commit', '-q', '-m', '基线'])
  fs.writeFileSync(path.join(base, 'a.txt'), 'a\nb\n')
  git(base, ['add', 'a.txt'])
  return base
}

/** 造一个带真远端的仓库：origin 是一个真的裸仓库，本地 main 已经跟踪它。
 *  拉取/推送/更新远方记录三档的预检都要求「有上游且远端在」，所以这三档的票据只能在有远端的仓库上拿。 */
function mkRepoWithOrigin(tag) {
  const base = mkRepo(tag)
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsws1586o-' + tag + '-'))
  git(bare, ['init', '-q', '--bare', '-b', 'main'])
  git(base, ['remote', 'add', 'origin', bare])
  const pushed = git(base, ['push', '-q', '-u', 'origin', 'main'])
  if (pushed.code !== 0) throw new Error('造带远端的仓库失败：' + pushed.err)
  return base
}

const spawns = []
const requests = []
const logs = []
let lastStdin = null
// 拨动时钟：票据过期这件事要在门禁里真的走一遍（宿主注入的 now 读这里）。
const clock = { t: 1000 }

/**
 * 造宿主注入的那套依赖。fakeRoute(req) 返回一次「假进程」的行为描述：
 *   { code, stdout, stderr, pending, epipeOnWrite, epipeAsync, noStdin }
 * 返回 null 时走真 git（spawnSync），这样「没有 stdinFile 的命令」照样真跑、行为不变。
 */
function makeDeps(fakeRoute) {
  spawns.length = 0
  requests.length = 0
  logs.length = 0
  lastStdin = null
  return {
    subprocess: {
      spawn(req) {
        spawns.push(req.argv.slice())
        requests.push({ argv: req.argv.slice(), cwd: req.cwd, stdio: req.stdio, env: req.env })
        const hit = fakeRoute ? fakeRoute(req) : null
        if (hit) {
          const mk = (t, trunc) => ({ finalize: () => ({ text: String(t || ''), truncated: trunc === true }) })
          const handle = {
            done: hit.pending ? new Promise(() => {}) : Promise.resolve({ exitCode: hit.code || 0 }),
            collected: { stdout: mk(hit.stdout), stderr: mk(hit.stderr) },
            terminate() { handle.terminated = true },
          }
          if (req.stdio && req.stdio.stdin === 'pipe') {
            if (!hit.noStdin) {
              const chunks = []
              const stdin = {
                chunks,
                write(chunk) {
                  if (hit.epipeOnWrite) { const e = new Error('write EPIPE'); e.code = 'EPIPE'; throw e }
                  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
                  return true
                },
                end() { stdin.ended = true },
                on(ev, fn) { if (ev === 'error') stdin.errHandler = fn },
              }
              handle.stdin = stdin
              lastStdin = stdin
              if (hit.epipeAsync && stdin.errHandler) {
                queueMicrotask(() => { try { stdin.errHandler(Object.assign(new Error('EPIPE: broken pipe'), { code: 'EPIPE' })) } catch (e) {} })
              }
            }
          }
          return handle
        }
        const r = spawnSync(req.argv[0], req.argv.slice(1), { cwd: req.cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 1 << 26 })
        const mk2 = (b) => ({ finalize: () => ({ text: (b || Buffer.alloc(0)).toString('utf8'), truncated: false }) })
        return { done: Promise.resolve({ exitCode: r.status }), collected: { stdout: mk2(r.stdout), stderr: mk2(r.stderr) }, terminate() {} }
      },
    },
    timer: { timeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    fs: { stat: async (p) => await fs.promises.stat(p), lstat: async (p) => await fs.promises.lstat(p), exists: async (p) => { try { await fs.promises.access(p); return true } catch (e) { return false } } },
    getPlatform: async () => ({ resolveExecutable: async (n) => (n === 'git' ? 'git' : null) }),
    DEFAULT_CWD: ROOT,
    TIMEOUT_MS: 30000,
    gate: { noteOutbound() {} },
    logCtx: { fire(level, event, fields) { logs.push({ level, event, fields }) } },
    now: () => clock.t,
  }
}

async function createVc(vcMod, fakeRoute) {
  return vcMod.createVersionControl(makeDeps(fakeRoute))
}

async function main() {
  const vcMod = await import(pathToFileURL(path.join(ROOT, 'src/host/versionControl.ts')).href)
  const r = mkRepo('stdin')
  const target = path.join(r, 'feed.dat')
  const bytes = Buffer.from('a\nb\n', 'utf8')
  fs.writeFileSync(target, bytes)
  const size = bytes.length
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')
  const spec = { path: target, sizeBytes: size, sha256: sha }
  const fastImportArgs = (dir) => ['-C', dir, '--no-pager', 'fast-import', '--quiet']

  // ---- S1：stdinFile 只许配 fast-import；别的命令给了它当场拒，一个进程都不起 ----
  {
    const vc = await createVc(vcMod, () => null)
    const got = await vc.runGitCommand('git', r, ['-C', r, '--no-pager', 'status', '--porcelain=v2'], { stdinFile: spec })
    check(got && got.kind === 'stdin-failed' && got.reason === 'not-allowed' && spawns.length === 0, 'S1 stdinFile 只许配 fast-import：status 带它被拒（reason=not-allowed），零进程')
  }
  // ---- S2：路径守卫：只能是绝对路径、不许含 NUL 或 .. 段 ----
  {
    const vc = await createVc(vcMod, () => null)
    const rel = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: Object.assign({}, spec, { path: 'feed.dat' }) })
    // 注意：不能用 path.join 拼 .. —— 它会先把 .. 归一掉，这里要的正是「字符串里真的带 .. 段」。
    const dotdot = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: Object.assign({}, spec, { path: r + path.sep + '..' + path.sep + 'feed.dat' }) })
    const nul = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: Object.assign({}, spec, { path: target + '\u0000x' }) })
    check(rel && rel.kind === 'stdin-failed' && rel.reason === 'bad-path' && dotdot && dotdot.reason === 'bad-path' && nul && nul.reason === 'bad-path' && spawns.length === 0, 'S2 路径守卫：相对路径、含 .. 段、含 NUL 一律拒（reason=bad-path），零进程')
  }
  // ---- S3：必须是普通文件（目录、符号链接都不收） ----
  {
    const vc = await createVc(vcMod, () => null)
    const isDir = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: Object.assign({}, spec, { path: r }) })
    check(isDir && isDir.kind === 'stdin-failed' && isDir.reason === 'not-regular-file' && spawns.length === 0, 'S3 只收普通文件：目录被拒（reason=not-regular-file），零进程')
  }
  // ---- S4：文件必须存在 ----
  {
    const vc = await createVc(vcMod, () => null)
    const missing = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: Object.assign({}, spec, { path: path.join(r, 'nope.dat') }) })
    check(missing && missing.kind === 'stdin-failed' && missing.reason === 'missing-file' && spawns.length === 0, 'S4 文件不存在被拒（reason=missing-file），零进程')
  }
  // ---- S5：大小与摘要都要对上，对不上不送 ----
  {
    const vc = await createVc(vcMod, () => null)
    const wrongSize = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: Object.assign({}, spec, { sizeBytes: size + 1 }) })
    const wrongSha = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: Object.assign({}, spec, { sha256: '0'.repeat(64) }) })
    check(wrongSize && wrongSize.reason === 'size-mismatch' && wrongSha && wrongSha.reason === 'digest-mismatch' && spawns.length === 0, 'S5 大小与摘要各自校验：不符分别 reason=size-mismatch / digest-mismatch，零进程')
  }
  // ---- S6：成功送入：开 stdin 管道、送进去的字节与文件一字不差、日志记送入字节数 ----
  {
    const vc = await createVc(vcMod, () => ({ code: 0 }))
    const ok = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: spec })
    const fed = lastStdin ? Buffer.concat(lastStdin.chunks) : Buffer.alloc(0)
    const execLine = logs.filter((l) => l.event === 'git.exec')[0]
    check(ok && ok.kind === 'ok' && ok.stdinBytes === size && requests.length === 1 && requests[0].stdio.stdin === 'pipe' && fed.equals(bytes) && !!execLine && execLine.fields.cmd === 'fast-import' && execLine.fields.stdinBytes === size, 'S6 成功送入：stdin 开管道、送入字节与原文件一致、回包与日志都记 stdinBytes')
  }
  // ---- S7：写管道时 EPIPE：按「输入没送完」显式失败，不能当成普通非零退出 ----
  {
    const vc = await createVc(vcMod, () => ({ code: 0, epipeOnWrite: true }))
    const epipe = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: spec })
    const failLine = logs.filter((l) => l.event === 'git.exec.fail')[0]
    check(epipe && epipe.kind === 'stdin-failed' && epipe.reason === 'epipe' && !!failLine && failLine.fields.errorKind === 'epipe' && logs.filter((l) => l.event === 'git.exec').length === 0, 'S7 写 stdin 抛 EPIPE：归类 epipe（不是普通非零退出），不假装成功')
  }
  // ---- S8：传输层没有 stdin 流：显式失败，不静默忽略 ----
  {
    const vc = await createVc(vcMod, () => ({ code: 0, noStdin: true }))
    const noStream = await vc.runGitCommand('git', r, fastImportArgs(r), { stdinFile: spec })
    check(noStream && noStream.kind === 'stdin-failed' && noStream.reason === 'stdin-unsupported' && spawns.length === 1, 'S8 传输层不支持 stdin 管道：显式失败（reason=stdin-unsupported），不静默忽略')
  }
  // ---- S9：fast-import 必须配文件流；缺了是明确失败，不能空着管道挂住 ----
  {
    const vc = await createVc(vcMod, () => ({ code: 0 }))
    const noFile = await vc.runGitCommand('git', r, fastImportArgs(r), {})
    check(noFile && noFile.kind === 'stdin-failed' && noFile.reason === 'stdin-required' && spawns.length === 0, 'S9 fast-import 没配 stdinFile：明确失败（reason=stdin-required），零进程')
  }

  // ---- T 组：票据绑定字段扩张 ----
  // 规格第 9 节把「预检看到的状态」拆成一张绑定表；执行前除了既有的 HEAD/索引指纹/目标，还要把这些格子
  // 逐一和此刻重算的值对一遍。这里不测内部函数，测的是「篡改票里某个格子之后，写命令必须停住且零进程」。
  console.log('T 票据绑定字段扩张（预检记住的值，执行前再对一遍）')
  const cmds = await import(pathToFileURL(path.join(ROOT, 'src/shared/version-control/src/commands.ts')).href)
  const WRITE_COMMANDS = ['add', 'reset', 'commit', 'pull', 'push', 'fetch']
  // 记录下来的 argv 第一项是可执行文件名（git），子命令要从第二项起找，别把它也数进去。
  const writeSpawns = () => spawns.filter((a) => WRITE_COMMANDS.indexOf(cmds.subcommandOf(a.slice(1))) >= 0)
  const ticketOf = async (vc, id) => {
    const m = (vc && typeof vc.writeTickets === 'function') ? await vc.writeTickets() : null
    const t = m ? m.get(id) : null
    // 红阶段兜底：写路径还没暴露票据表时，让断言以「没有绑定字段」失败，而不是整扇门禁崩掉。
    return t || { bindings: { counters: {}, preconditions: {} } }
  }

  // T1 提交票：counters.indexEntries（索引条数变了就拒，理由沿用 stale-index）
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepo('t1')
    const pre = await vc.handleGitWriteCheck({ cwd: repo, op: 'commit', message: '标题' })
    const t = await ticketOf(vc, pre.ticket.id)
    check(!!t.bindings && !!t.bindings.counters && typeof t.bindings.counters.indexEntries === 'number' && t.bindings.counters.indexEntries > 0, 'T1a 提交票绑定 counters.indexEntries（预检记下索引条数）')
    t.bindings.counters.indexEntries += 1
    const n = writeSpawns().length
    const got = await vc.handleGitCommit({ cwd: repo, message: '标题', ticketId: pre.ticket.id })
    check(got && got.ok === false && got.error.reason === 'stale-index' && writeSpawns().length === n, 'T1b 篡改索引条数：stale-index 且零写命令')
  }

  // T2/T3/T4 拉取票：五个绑定格子逐个真接线；全对时照常执行
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepoWithOrigin('t2')
    const pre = await vc.handleGitWriteCheck({ cwd: repo, op: 'pull' })
    check(pre.ok === true && !!pre.plan && pre.plan.upstream === 'origin/main', 'T2a 有上游的仓库：拉取预检成功且目标记下 origin/main')
    const t = await ticketOf(vc, pre.ticket.id)
    const b = t.bindings && t.bindings.preconditions
    check(!!b &&
      typeof b.worktreeDigest === 'string' && /^[0-9a-f]{16}$/.test(b.worktreeDigest) &&
      typeof b.planDigest === 'string' && /^[0-9a-f]{16}$/.test(b.planDigest) &&
      typeof b.configOldValue === 'string' && b.configOldValue !== '' &&
      typeof b.remoteOid === 'string' && /^[0-9a-f]{40,64}$/.test(b.remoteOid) &&
      Array.isArray(b.pathAbsent) && b.pathAbsent.join(',') === 'MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,rebase-merge,rebase-apply' &&
      b.unreachableDigest === null, 'T2b 拉取票绑定 worktreeDigest/planDigest/configOldValue/remoteOid/pathAbsent（unreachableDigest 本轮不绑）')
    for (const field of ['worktreeDigest', 'configOldValue', 'planDigest', 'remoteOid']) {
      const p = await vc.handleGitWriteCheck({ cwd: repo, op: 'pull' })
      const tt = await ticketOf(vc, p.ticket.id)
      tt.bindings.preconditions[field] = (field === 'worktreeDigest' || field === 'planDigest') ? '0'.repeat(16) : 'tampered'
      const n = writeSpawns().length
      const got = await vc.handleGitPull({ cwd: repo, ticketId: p.ticket.id })
      check(got && got.ok === false && got.error.reason === 'target-changed' && writeSpawns().length === n, 'T3 拉取票篡改 ' + field + '：target-changed 且零写命令')
    }
    const pPath = await vc.handleGitWriteCheck({ cwd: repo, op: 'pull' })
    const tPath = await ticketOf(vc, pPath.ticket.id)
    tPath.bindings.preconditions.pathAbsent = []
    const nPath = writeSpawns().length
    const gotPath = await vc.handleGitPull({ cwd: repo, ticketId: pPath.ticket.id })
    check(gotPath && gotPath.ok === false && gotPath.error.reason === 'target-changed' && writeSpawns().length === nPath, 'T3b 拉取票篡改 pathAbsent（进行中的操作标记数变了）：target-changed 且零写命令')
    const pUn = await vc.handleGitWriteCheck({ cwd: repo, op: 'pull' })
    const tUn = await ticketOf(vc, pUn.ticket.id)
    tUn.bindings.preconditions.unreachableDigest = '0'.repeat(16)
    const nUn = writeSpawns().length
    const gotUn = await vc.handleGitPull({ cwd: repo, ticketId: pUn.ticket.id })
    check(gotUn && gotUn.ok === false && gotUn.error.reason === 'target-changed' && writeSpawns().length === nUn, 'T3c unreachableDigest 非空且不符：target-changed（证明这个格子真的接线，不是只写进结构体）')
    const pOk = await vc.handleGitWriteCheck({ cwd: repo, op: 'pull' })
    const okPull = await vc.handleGitPull({ cwd: repo, ticketId: pOk.ticket.id })
    check(okPull && okPull.ok === true && okPull.mode === 'up-to-date', 'T4 五个格子都对得上时拉取照常执行（本地与 origin 同点 → up-to-date）')
  }

  // T5 推送票：planDigest/configOldValue/remoteOid
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepoWithOrigin('t5')
    const pre = await vc.handleGitWriteCheck({ cwd: repo, op: 'push' })
    check(pre.ok === true && !!pre.plan && pre.plan.mode === 'existing', 'T5a 有上游的仓库：推送预检成功且走 existing 档')
    const t = await ticketOf(vc, pre.ticket.id)
    const b = t.bindings && t.bindings.preconditions
    check(!!b &&
      typeof b.planDigest === 'string' && /^[0-9a-f]{16}$/.test(b.planDigest) &&
      typeof b.configOldValue === 'string' && b.configOldValue !== '' &&
      typeof b.remoteOid === 'string' && /^[0-9a-f]{40,64}$/.test(b.remoteOid) &&
      b.worktreeDigest === null && b.pathAbsent.length === 0, 'T5b 推送票绑定 planDigest/configOldValue/remoteOid（工作树与运行中标记不绑）')
    for (const field of ['remoteOid', 'planDigest', 'configOldValue']) {
      const p = await vc.handleGitWriteCheck({ cwd: repo, op: 'push' })
      const tt = await ticketOf(vc, p.ticket.id)
      tt.bindings.preconditions[field] = field === 'remoteOid' ? 'f'.repeat(40) : 'tampered'
      const n = writeSpawns().length
      const got = await vc.handleGitPush({ cwd: repo, ticketId: p.ticket.id })
      check(got && got.ok === false && got.error.reason === 'target-changed' && writeSpawns().length === n, 'T5c 推送票篡改 ' + field + '：target-changed 且零写命令')
    }
    const pOk = await vc.handleGitWriteCheck({ cwd: repo, op: 'push' })
    const okPush = await vc.handleGitPush({ cwd: repo, ticketId: pOk.ticket.id })
    check(okPush && okPush.ok === true && okPush.mode === 'existing-upstream', 'T5d 三个格子对得上时推送照常执行')
  }

  // T6 更新远方记录：planDigest
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepoWithOrigin('t6')
    const pre = await vc.handleGitWriteCheck({ cwd: repo, op: 'fetch' })
    check(pre.ok === true && !!pre.plan && pre.plan.mode === 'fetch' && pre.plan.remote === 'origin', 'T6a 单远端仓库：更新远方记录预检成功且目标记下 origin')
    const t = await ticketOf(vc, pre.ticket.id)
    check(!!t.bindings && typeof t.bindings.preconditions.planDigest === 'string' && t.bindings.preconditions.worktreeDigest === null, 'T6b 更新远方记录的票只绑 planDigest')
    t.bindings.preconditions.planDigest = '0'.repeat(16)
    const n = writeSpawns().length
    const got = await vc.handleGitFetch({ cwd: repo, ticketId: pre.ticket.id })
    check(got && got.ok === false && got.error.reason === 'target-changed' && writeSpawns().length === n, 'T6c 篡改 planDigest：target-changed 且零写命令')
    const pOk = await vc.handleGitWriteCheck({ cwd: repo, op: 'fetch' })
    const okFetch = await vc.handleGitFetch({ cwd: repo, ticketId: pOk.ticket.id })
    check(okFetch && okFetch.ok === true && okFetch.mode === 'fetched', 'T6d 格子对得上时更新远方记录照常执行')
  }

  // T7 老票（没有 bindings 字段）仍可执行：字段扩张不许把存量票据全判死
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepo('t7')
    const pre = await vc.handleGitWriteCheck({ cwd: repo, op: 'commit', message: '标题' })
    const t = await ticketOf(vc, pre.ticket.id)
    if (t && t.bindings) delete t.bindings
    const ok = await vc.handleGitCommit({ cwd: repo, message: '标题', ticketId: pre.ticket.id })
    check(ok && ok.ok === true && ok.committed === true, 'T7 没有 bindings 字段的旧票仍可执行（向后兼容，只有票里记了值才比对）')
  }

  // T8 requestId 重放：同一个请求号第二次回上次结果、不重复起写命令（841 没覆盖这一条）
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepo('t8')
    const pre = await vc.handleGitWriteCheck({ cwd: repo, op: 'commit', message: '标题' })
    const n = writeSpawns().length
    const first = await vc.handleGitCommit({ cwd: repo, message: '标题', ticketId: pre.ticket.id, requestId: 'r1' })
    const afterFirst = writeSpawns().length
    const second = await vc.handleGitCommit({ cwd: repo, message: '标题', ticketId: pre.ticket.id, requestId: 'r1' })
    check(first && first.ok === true && second && second.ok === true && second.committed === true && afterFirst > n && writeSpawns().length === afterFirst, 'T8 requestId 重放：第二次回上次结果、不重复起写命令')
  }

  // T9 票据有效期 120 秒，且只管「预检新鲜度」：到点即拒且零写命令（不自动续期、不自动重放）
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepo('t9')
    const pre = await vc.handleGitWriteCheck({ cwd: repo, op: 'commit', message: '标题' })
    check(pre.ticket.expiresAtMs - pre.ticket.checkedAtMs === 120000, 'T9a 票据有效期 120 秒（只管预检新鲜度）')
    clock.t = pre.ticket.expiresAtMs
    const n = writeSpawns().length
    const expired = await vc.handleGitCommit({ cwd: repo, message: '标题', ticketId: pre.ticket.id })
    clock.t = 1000
    check(expired && expired.ok === false && expired.error.reason === 'ticket-expired' && writeSpawns().length === n, 'T9b 到点即过期：ticket-expired 且零写命令')
  }

  // ---- R 组：命令白名单 / 路径守卫 / refspec 守卫 ----
  console.log('R 命令白名单 / 路径守卫 / refspec 守卫')
  let threwPlus = false
  try { cmds.pushArgs({ mode: 'existing', remote: 'origin', branch: '+wip', localBranch: '+wip' }) } catch (e) { threwPlus = true }
  check(threwPlus, 'R1 refspec 守卫：分支名以 + 开头（会被 git 当强推）当场抛错')
  check(cmds.REMOTE_PATTERN.test('-origin') === false && cmds.REMOTE_PATTERN.test('ori gin') === false && cmds.REMOTE_PATTERN.test('x:y') === false && cmds.REMOTE_PATTERN.test('origin') === true, 'R2 远端名白名单：前导短横线、空白、冒号都拒，普通名字放行')
  {
    const vc = await createVc(vcMod, () => null)
    const repo = mkRepo('r3')
    const n = writeSpawns().length
    const badDash = await vc.handleGitStage({ cwd: repo, paths: ['-u'] })
    const badColon = await vc.handleGitStage({ cwd: repo, paths: [':/'] })
    check(badDash && badDash.ok === false && badDash.error.reason === 'bad-paths' && badColon && badColon.ok === false && badColon.error.reason === 'bad-paths' && writeSpawns().length === n, 'R3 路径守卫：前导短横线与排除前缀（:/）当场拒，零写命令')
    const srcWrite = fs.readFileSync(path.join(ROOT, 'src', 'host', 'versionControlWrite.ts'), 'utf8')
    check(/child_process|spawnSync|execSync/.test(srcWrite) === false, 'R4 源码断言：写层不自己起进程（只经注入的安全执行层）')
    check(srcWrite.indexOf('checkRefArgs(') >= 0 && srcWrite.indexOf('pushArgs(') >= 0, 'R5 源码断言：推送前先让 git 复核分支名（checkRefArgs），再拼 refspec')
    const repoR2 = mkRepoWithOrigin('r6')
    const vcR2 = await createVc(vcMod, () => null)
    const preR2 = await vcR2.handleGitWriteCheck({ cwd: repoR2, op: 'push' })
    const tR2 = await ticketOf(vcR2, preR2.ticket.id)
    if (tR2 && tR2.target) tR2.target.remote = 'evil'
    const nR2 = writeSpawns().length
    const gotR2 = await vcR2.handleGitPush({ cwd: repoR2, ticketId: preR2.ticket.id })
    check(gotR2 && gotR2.ok === false && gotR2.error.reason === 'target-changed' && writeSpawns().length === nR2, 'R6 推送目标守卫：票据里的远端执行前重算比对，不一致即拒（零写命令）')
  }

  console.log(failed ? '\n存在失败 — ' + GATE + ' 未通过' : '\n全部通过 — ' + GATE + ' 生效（' + total + ' 项断言）')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + (e && e.stack || e)); process.exit(1) })
