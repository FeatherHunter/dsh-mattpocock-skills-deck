/**
 * tests/verify-1799-input-stage.ts —— 门禁：房间失败在「发出任何写动作之前就拒绝输入」时，
 * 失败结果带上链路阶段 input-refused（#1799）。
 *
 * 为什么要有这一道：deck 工具失败回执里的 reason 回答的是「下一步该做什么」，不是「错误叫什么」。
 * 房间因为标题为空、幂等键不合规、正文带错模板、依赖成环这类原因拒绝时，下一步是「改输入再来」；
 * 不带这个阶段标注，上层只能把失败当成后端能力不足或原样重试，人照着回执做会白跑一趟。
 *
 * 本门禁钉两件事：
 *   一、三个代表点的 error.stage 恰好是 TRACKER_ERROR_STAGE.INPUT_REFUSED，而且拒绝发生在写动作之前
 *      （Markdown 房：正文带远端四段模板被模板守卫拒绝；Markdown 房：写依赖成环；
 *        GitHub 房：幂等键字符集不合规，连一条 gh 命令都没发出）；
 *   二、反例：票不存在这类「请求已经发出、只是没读到」的读失败，以及没装 gh 这类环境失败，
 *      都不带 stage —— 证明这个标注没有滥用到「读失败」与「机器没准备好」上。
 *
 * 全程离线：GitHub 房的执行桩只记账、一个进程都不真起；工作区造在系统临时目录里，跑完即删。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1799-input-stage.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createMarkdownBackend } from '../src/tracker/rooms/markdown/index.ts'
import { createGithubBackend } from '../src/tracker/rooms/github/room/backend.ts'
import { TRACKER_ERROR_STAGE } from '../src/tracker/contract/results.ts'
import { ERROR_KIND } from '../src/tracker/contract/vocabulary.ts'

let failed = false
let total = 0
const check = (ok: boolean, msg: string) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
/** 失败结果里 stage 那一格的可读写法：没带就是 undefined，带错值就原样打出来。 */
const stageText = (r: unknown): string => {
  const e = r && typeof r === 'object' ? (r as { error?: { stage?: unknown } }).error : undefined
  return e && e.stage !== undefined ? String(e.stage) : String(undefined)
}
/** 失败结果里 kind 那一格的可读写法。 */
const kindText = (r: unknown): string => {
  const e = r && typeof r === 'object' ? (r as { error?: { kind?: unknown } }).error : undefined
  return e && e.kind !== undefined ? String(e.kind) : String(undefined)
}
const messageText = (r: unknown): string => {
  const e = r && typeof r === 'object' ? (r as { error?: { message?: unknown } }).error : undefined
  return e && e.message !== undefined ? String(e.message) : ''
}

// ── 本地 Markdown 房的工作区夹具：与 tests/verify-1059-issue-write.ts 同一套适配器形状 ──
type MdCtx = {
  platform: { path: typeof path.posix; fs: Record<string, unknown> }
  fs: Record<string, unknown>
  cwd: string
  opId: string
  writes: string[]
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void
  isEnabled: (level: string) => boolean
  get: (name: string) => unknown
}
/** 造一个只认本地目录的上下文：writes 记下每一次真写文件，用来核「拒绝发生在写盘之前」。 */
function makeMdCtx(cwd: string): MdCtx {
  const writes: string[] = []
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return p },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { writes.push(t); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async rename(a: string, b: string) { fs.renameSync(a, b) },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async rm(t: string) { try { fs.rmSync(t, { force: true }); return true } catch { return false } },
    },
  }
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    opId: 'test-op-1799',
    writes,
    logEvent() {},
    isEnabled() { return false },
    get(name: string) { return name === 'fs' ? plat.fs : undefined },
  }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'input-stage-1799-'))
/** 在临时工作区里造一个工作单元（map.md + 若干票文件），票文件与 tests/verify-1059 同形。 */
function ws(suffix: string, tickets: Array<[string, string]>): string {
  const root = fs.mkdtempSync(path.join(tmpRoot, suffix + '-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 工作单元 demo\n\nStatus: ready-for-agent\n\n## Destination\n\n夹具\n', 'utf8')
  for (const [file, status] of tickets) {
    fs.writeFileSync(path.join(dir, 'issues', file), '# ' + file + '\n\nStatus: ' + status + '\n\n## Body\n\n夹具里的票\n', 'utf8')
  }
  return root
}
const REPO_MD = { backend: 'markdown', refId: '.scratch/demo', name: 'demo', url: '' }

// ── GitHub 房的上下文桩：与 tests/verify-1443-github-readbudget.ts 同一套形状，exec 只记账 ──
type GhExec = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>
function makeGhCtx(execFn: GhExec, resolveFn: () => Promise<string | null>): Record<string, unknown> {
  const outbound = {
    acquire: async function () { return function release() {} },
    isCancelled: function () { return false },
    noteWrite: function () {},
    reportTransportFailure: function () {},
    reportSuccess: function () {},
  }
  return {
    cwd: '/ws-test-1799',
    signal: undefined,
    platform: {
      resolveExecutable: resolveFn,
      path: {
        join: function (...a: string[]) { return a.join('/') },
        sep: '/',
        isAbsolute: function (p: string) { return String(p).charAt(0) === '/' },
        dirname: function (p: string) { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : '/' },
      },
      fs: { resolve: async function (rel: string) { return rel }, readText: async function () { throw new Error('no-file') } },
      env: { get: function () { return undefined }, has: function () { return false } },
    },
    fs: null,
    exec: execFn,
    timers: { setTimeout: setTimeout, clearTimeout: clearTimeout },
    logEvent: function () {},
    isEnabled: function () { return false },
    outbound: outbound,
    gate: null,
  }
}
const REPO_GH = { backend: 'github', refId: 'octo/demo', name: 'demo', url: 'https://github.com/octo/demo' }

console.log('== 一、本地 Markdown 房：模板守卫拒绝，且拒绝发生在写盘之前 ==')
{
  const ctx = makeMdCtx(ws('tpl', [['01-a.md', 'ready-for-agent']]))
  const b = createMarkdownBackend(ctx)
  const writesBefore = ctx.writes.length
  // 正文里带远端跟踪器的四段模板（## Acceptance criteria）：本地票不收这种写法，房间应当当场拒绝。
  const refused = await b.create(REPO_MD, { title: '带远端模板的一张', body: '## Acceptance criteria\n\n- [ ] 一条验收\n' }, ctx)
  check(refused.ok === false, '正文带远端四段模板：建票如实失败 → ' + (refused.ok ? '竟然成功' : kindText(refused)))
  check(kindText(refused) === ERROR_KIND.PARSE, '模板守卫拒绝归 parse 档（输入不合规，不是后端能力不足）→ ' + kindText(refused))
  check(stageText(refused) === TRACKER_ERROR_STAGE.INPUT_REFUSED, '模板守卫拒绝带 stage=input-refused（下一步是改正文）→ 实得 ' + stageText(refused))
  check(messageText(refused).indexOf('模板') >= 0, '拒绝语说清是模板问题（人能照着改）→ ' + messageText(refused))
  check(ctx.writes.length === writesBefore, '模板守卫拒绝发生在写盘之前：一份文件都没写 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次写')
}

console.log('== 二、本地 Markdown 房：写依赖成环，且拒绝发生在写盘之前 ==')
{
  const ctx = makeMdCtx(ws('cycle', [['01-a.md', 'ready-for-agent'], ['02-b.md', 'ready-for-agent']]))
  const b = createMarkdownBackend(ctx)
  const first = await b.setBlockedBy(REPO_MD, '01', ['02'], {}, ctx)
  check(first.ok === true, '先写 01 被 02 阻塞：这一步本来就不成环，照常成功 → ' + (first.ok ? 'ok' : kindText(first)))
  const writesBefore = ctx.writes.length
  const cycle = await b.setBlockedBy(REPO_MD, '02', ['01'], {}, ctx)
  check(cycle.ok === false, '再写 02 被 01 阻塞：会把依赖图写成环，房间应当拒绝 → ' + (cycle.ok ? '竟然成功' : kindText(cycle)))
  check(kindText(cycle) === ERROR_KIND.CONFLICT, '成环归 conflict 档（与写前环检的既有档位一致）→ ' + kindText(cycle))
  check(stageText(cycle) === TRACKER_ERROR_STAGE.INPUT_REFUSED, '成环拒绝带 stage=input-refused（下一步是改这批边）→ 实得 ' + stageText(cycle))
  check(ctx.writes.length === writesBefore, '成环拒绝发生在写盘之前：一份文件都没写 → 实得 ' + (ctx.writes.length - writesBefore) + ' 次写')
}

console.log('== 三、GitHub 房：幂等键不合规，连一条 gh 命令都不发 ==')
{
  const calls: string[] = []
  const execFn: GhExec = async function (cmd, args) {
    calls.push(String(cmd) + ' ' + (args || []).join(' '))
    return { stdout: '', stderr: 'stub：这条命令本不该被发出', code: 1 }
  }
  const ctx = makeGhCtx(execFn, async function () { return 'gh-on-path' })
  const b = createGithubBackend(ctx as never)
  // 键里有空格：幂等键会原样写进票面正文，带空格/换行的键会把正文写坏，房间必须在发命令前拒绝。
  const bad = await b.create(REPO_GH, { title: '一张票', idempotencyKey: 'bad key with spaces' }, ctx as never)
  check(bad.ok === false, '幂等键字符集不合规：建票如实失败 → ' + (bad.ok ? '竟然成功' : kindText(bad)))
  check(kindText(bad) === ERROR_KIND.PARSE, '幂等键不合规归 parse 档 → ' + kindText(bad))
  check(stageText(bad) === TRACKER_ERROR_STAGE.INPUT_REFUSED, '幂等键不合规带 stage=input-refused（下一步是换一个键）→ 实得 ' + stageText(bad))
  check(calls.length === 0, '幂等键不合规在发命令之前就拒绝：一条 gh 命令都没发 → 实得 ' + calls.length + ' 条')
}

console.log('== 四、反例：读失败与环境失败不带 stage（标注没有滥用） ==')
{
  // 反例一：关一张不存在的票。请求已经发出（读了目录）、结论是「没有这张票」，属读失败，不是输入被拒。
  const ctx = makeMdCtx(ws('missing', [['01-a.md', 'ready-for-agent']]))
  const b = createMarkdownBackend(ctx)
  const missing = await b.close(REPO_MD, '99', {}, ctx)
  check(missing.ok === false && kindText(missing) === ERROR_KIND.NOTFOUND, '关一张不存在的票：如实失败，档位是 notfound → ' + kindText(missing))
  check(missing.ok === false && stageText(missing) === String(undefined), '反例一：票不存在是读失败（请求已发出），不带 stage → 实得 ' + stageText(missing))

  // 反例二：机器上没装 gh。这是环境没准备好，原样重试与改输入都不是下一步，同样不带 stage。
  const noGhCtx = makeGhCtx(async function () { return { stdout: '', stderr: 'gh is not recognized as a command', code: 1 } }, async function () { return null })
  const noGh = createGithubBackend(noGhCtx as never)
  const envFail = await noGh.list(REPO_GH, {}, noGhCtx as never)
  check(envFail.ok === false, '没装 gh：列票如实失败 → ' + (envFail.ok ? '竟然成功' : kindText(envFail)))
  check(envFail.ok === false && stageText(envFail) === String(undefined), '反例二：环境失败（没装 gh）不带 stage → 实得 ' + stageText(envFail))
}

fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log(failed ? '\n存在失败 — verify-1799-input-stage 未通过' : '\n全部通过 — 房间在写动作之前拒绝输入时带上了 input-refused，读失败与环境失败没有被滥标')
process.exit(failed ? 1 : 0)
