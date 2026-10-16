/**
 * tests/verify-1130-gitlab-marker-read.ts —— GitLab 房识别工作区时读标记文件的两处读取（#1130）。
 *
 * 票面给的两条验收，本文件一条一条钉住：
 *   ① GitLab 标记文件「在」与「不在」两种情况下，`matches` 的结论都正确；
 *   ② 读不到时，失败原因能出现在判定过程的日志里，而不是只剩一个笼统的「没认出来」。
 *
 * 这条票的病根（本文件第 ① 组用例就是冲着它去的）：旧写法是
 * `fs.readText(platform.path.join(cwd, '.git', 'config'))` —— 自己拼一个路径字符串喂给文件服务。
 * 而 DSH 的文件服务吃的是 `resolve()` 给出的那个 target，喂路径会抛错，抛的还不是「文件不在」，
 * 是形状不对（同一个教训记在 `src/host/versionControl.js` 的 stat 那一处：喂路径抛 TypeError，
 * 不是 ENOENT）。于是「文件明明在」也一律读不到，失败又被两个空 catch 吞掉，外面只剩注册表
 * 那一句「没认出来」。
 *
 * 本文件的假文件服务按真服务的规矩来：`resolve` 交出一个不透明的 target，`readText` 只认这个
 * target，喂别的一律抛 TypeError。第 ① 组第一件事就是拿这个规矩把「直接喂路径」判死一次，
 * 当作 ✗ 反例自证 —— 老写法正是死在这一步上，所以这一组用例在老代码上必然红。
 *
 * 运行：node --import ./scripts/ts-hook.mjs tests/verify-1130-gitlab-marker-read.ts
 * （已挂在 package.json 的 verify 长串上）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitlabBackend } from '../src/tracker/rooms/gitlab/index.ts'
import { READ_DEGRADED_OPS, READ_DEGRADED_REASONS } from '../src/tracker/rooms/gitlab/read-log.ts'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ── 夹具：每个用例一个真的空目录，按需要往里写文件 ──
function newWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gl-1130-'))
}
function put(ws: string, rel: string, text: string): void {
  const full = path.posix.join(ws, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text, 'utf8')
}

/** 不透明 target 的前缀：只有 `resolve` 发出来的才带它，`readText` 靠它认出来源。 */
const TARGET_PREFIX = 'dsh-target:'

/**
 * 假文件服务：底下是真实磁盘，但对外的规矩照抄真服务 —— 只有 `resolve` 交出的 target 能读。
 * 这样「读不到」就不是随便造的，而是真服务上那个形状问题的复现。
 */
function makeFs(calls: { resolve: string[]; readText: string[] }) {
  return {
    async resolve(rel: string, opts?: { cwd?: string }) {
      const full = path.posix.join((opts && opts.cwd) || '', rel)
      calls.resolve.push(full)
      return TARGET_PREFIX + full
    },
    async readText(target: unknown) {
      if (typeof target !== 'string' || target.indexOf(TARGET_PREFIX) !== 0) {
        // 真服务在这里抛的是 TypeError，不是「文件不在」——本文件靠这一句钉住形状要求。
        throw new TypeError('readText 要的是 resolve() 给出的 target，不是路径：' + String(target))
      }
      const full = target.slice(TARGET_PREFIX.length)
      calls.readText.push(full)
      return fs.readFileSync(full, 'utf8')
    },
  }
}

type Logged = { level: string; event: string; fields: Record<string, unknown> }

/** 递给 `matches` 的操作上下文：带一块记日志的板子，把这一趟落了哪些事件留下来。 */
function ctxOf(
  ws: string,
  opts?: { fs?: unknown; platform?: unknown; exec?: unknown },
): { ctx: Record<string, unknown>; logged: Logged[] } {
  const logged: Logged[] = []
  const ctx: Record<string, unknown> = {
    cwd: ws,
    opId: 'op-1130',
    isEnabled: () => true,
    logEvent: (level: string, event: string, fields: Record<string, unknown>) => {
      logged.push({ level, event, fields })
    },
  }
  const fsLike = opts && 'fs' in opts ? opts.fs : makeFs({ resolve: [], readText: [] })
  ctx.fs = fsLike
  ctx.platform = opts && 'platform' in opts ? opts.platform : { fs: fsLike }
  // 默认给一个「命令跑得成、但没说 gitlab」的兜底执行器：第 ③ 组要验「正常否定不记日志」。
  ctx.exec = opts && 'exec' in opts ? opts.exec : async () => ({ stdout: '', stderr: '', code: 0 })
  return { ctx, logged }
}

async function run(ws: string, opts?: Parameters<typeof ctxOf>[1]) {
  const { ctx, logged } = ctxOf(ws, opts)
  const hit = await gitlabBackend.matches({ cwd: ws } as never, ctx as never)
  return { hit, logged }
}

const GITLAB_CONFIG = '[remote "origin"]\n\turl = git@gitlab.com:acme/demo.git\n'
const GITHUB_CONFIG = '[remote "origin"]\n\turl = git@github.com:acme/demo.git\n'
const DECL_GITLAB = '# Issue tracker: GitLab\n\nIssues live as GitLab issues.\n'
const DECL_GITHUB = '# Issue tracker: GitHub\n\nIssues live as GitHub issues.\n'

// ══════════════════════════════════════════════════════════════════════════
console.log('== #1130 ✗ 反例自证：直接喂路径给 readText 会被判死（老写法就是这么死的）==')

{
  const ws = newWorkspace()
  put(ws, '.git/config', GITLAB_CONFIG)
  const calls = { resolve: [] as string[], readText: [] as string[] }
  const fsLike = makeFs(calls)
  let threw = ''
  try {
    await fsLike.readText(path.posix.join(ws, '.git/config'))
  } catch (e) {
    threw = String(e)
  }
  check(
    threw.indexOf('TypeError') >= 0,
    '✗ 反例自证：把拼出来的路径直接喂 readText 会抛 TypeError（不是 ENOENT）——旧写法正死在这里',
  )
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n== #1130 ① 标记文件「在」的时候，结论必须认得出 GitLab ==')

// 这条就是本票的主症：`.git/config` 明明写着 gitlab，旧写法读不到，于是回了 false。
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITLAB_CONFIG)
  const r = await run(ws)
  check(r.hit === true, '工作区有 .git/config 且里面写着 gitlab → true（旧写法在这里回 false）')
  check(r.logged.length === 0, '这一趟读成了，不落任何 read.degraded（读成功不记）')
}

// 第二处读取：声明文件里写着 GitLab（本机 Local Markdown / GitHub 工作区靠的就是这类声明）。
{
  const ws = newWorkspace()
  put(ws, 'docs/agents/issue-tracker.md', DECL_GITLAB)
  const r = await run(ws)
  check(r.hit === true, '工作区只有 docs/agents/issue-tracker.md 写着 GitLab → true')
}

// 两处文件都没有时，兜底那一次 git remote 仍然要能认出来。
{
  const ws = newWorkspace()
  const r = await run(ws, {
    exec: async () => ({ stdout: 'git@gitlab.com:acme/demo.git\n', stderr: '', code: 0 }),
  })
  check(r.hit === true, '两处标记文件都不在，但 git remote 回的是 gitlab 地址 → true（兜底还在）')
}

// 读取必须经 `fs.resolve`：这是本票的修法本身，钉住它，免得哪天又被改回拼路径。
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITLAB_CONFIG)
  const calls = { resolve: [] as string[], readText: [] as string[] }
  const fsLike = makeFs(calls)
  await run(ws, { fs: fsLike, platform: { fs: fsLike } })
  check(
    calls.resolve.indexOf(path.posix.join(ws, '.git/config')) >= 0,
    '读 .git/config 走的是 fs.resolve(相对路径, {cwd})，不是自己拼路径',
  )
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n== #1130 ① 标记文件「不在」的时候，结论仍然正确，且不许抛 ==')

// 空工作区：两个标记文件都不在，兜底也说不认识。
{
  const ws = newWorkspace()
  const r = await run(ws)
  check(r.hit === false, '空工作区（两个标记文件都不在）→ false，不抛')
}

// 别家的工作区：两个文件都在、都读得成，只是里面写的是 GitHub —— 这是正常的否定结论。
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITHUB_CONFIG)
  put(ws, 'docs/agents/issue-tracker.md', DECL_GITHUB)
  const r = await run(ws)
  check(r.hit === false, 'GitHub 工作区（两处都读得成、都写着 GitHub）→ false')
  check(
    r.logged.length === 0,
    '读成了、只是内容里没有 gitlab → 一条 read.degraded 都不记（正常的否定结论不是故障）',
  )
}

// refId 直接写着 gitlab 时照旧认，不受本次改动影响。
{
  const ws = newWorkspace()
  const { ctx } = ctxOf(ws)
  const hit = await gitlabBackend.matches({ cwd: ws, refId: 'gitlab.com/acme/demo' } as never, ctx as never)
  check(hit === true, 'refId 显式含 gitlab 串 → true（与改动前一致）')
}

// 反过来：refId 不含 gitlab 串时，不许因为「有 refId」就认下来，仍要看三处标记。
{
  const ws = newWorkspace()
  const { ctx } = ctxOf(ws)
  const hit = await gitlabBackend.matches({ cwd: ws, refId: 'acme/demo' } as never, ctx as never)
  check(hit === false, 'refId 不含 gitlab 串、三处标记也都没有 → false（不靠 refId 蒙）')
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n== #1130 ② 读不到时，失败原因必须落到判定过程的日志里 ==')

// 两个标记文件都不在：每一处「没给出答案」各记一行，事件名与字段形状照全仓登记的那份。
{
  const ws = newWorkspace()
  const r = await run(ws)
  const reasons = r.logged.map((l) => l.fields['reason'])
  check(r.logged.length === 2, '两处标记文件都不在 → 记两行（实际 ' + r.logged.length + ' 行）')
  check(
    reasons.indexOf('matches:git-config') >= 0,
    '其中一行说清是读 .git/config 这一步没给出答案（matches:git-config）',
  )
  check(
    reasons.indexOf('matches:tracker-doc') >= 0,
    '另一行说清是读 docs/agents/issue-tracker.md 这一步没给出答案（matches:tracker-doc）',
  )
  check(
    r.logged.every((l) => l.event === 'read.degraded' && l.level === 'warn'),
    '落的是全仓登记过的那条事件 read.degraded（警告级），没有新开 glab.* 事件',
  )
  check(
    r.logged.every((l) => {
      const keys = Object.keys(l.fields).sort().join(',')
      return keys === 'latencyMs,op,opId,reason'
    }),
    '字段恰好是 read.degraded 登记的那四格（op/reason/latencyMs/opId），没多没少',
  )
  check(
    r.logged.every((l) => l.fields['op'] === 'matches'),
    'op 取登记值 matches',
  )
  check(
    r.logged.every((l) => READ_DEGRADED_OPS.indexOf(String(l.fields['op']) as never) >= 0),
    'op 在房间自己的 READ_DEGRADED_OPS 登记表里',
  )
  check(
    r.logged.every((l) => READ_DEGRADED_REASONS.indexOf(String(l.fields['reason']) as never) >= 0),
    'reason 在房间自己的 READ_DEGRADED_REASONS 登记表里（不许冒用没登记的取值）',
  )
  check(
    r.logged.every((l) => typeof l.fields['latencyMs'] === 'number' && Number.isInteger(l.fields['latencyMs'])),
    'latencyMs 是整数（这一笔花了多久）',
  )
}

// 根本没有文件服务：识别跑不起来，这是故障，必须留下一行，而不是悄悄回 false。
{
  const ws = newWorkspace()
  const r = await run(ws, { fs: null, platform: null })
  check(r.hit === false, '没有文件服务 → false')
  check(
    r.logged.length === 1 && r.logged[0].fields['reason'] === 'matches:fs-unavailable',
    '没有文件服务 → 记一行 matches:fs-unavailable（说清是识别跑不起来，不是「这个仓库不是 GitLab」）',
  )
}

// 有文件服务、但它没长 resolve/readText 这两件：同上，也是跑不起来。
{
  const ws = newWorkspace()
  const r = await run(ws, { fs: {}, platform: { fs: {} } })
  check(r.hit === false, '文件服务没长 resolve/readText → false')
  check(
    r.logged.length === 1 && r.logged[0].fields['reason'] === 'matches:fs-unavailable',
    '文件服务形状不对 → 也记 matches:fs-unavailable（不许空 catch 吞掉）',
  )
}

// 整段抛了（这里让兜底的 exec 抛）：也要留一行，不许静默。
{
  const ws = newWorkspace()
  const r = await run(ws, {
    exec: async () => {
      throw new Error('exec 起不来')
    },
  })
  check(r.hit === false, '兜底 exec 抛错 → 结论照旧是 false，不把异常漏给调用方')
  check(
    r.logged.some((l) => l.fields['reason'] === 'matches:unknown'),
    '整段抛了 → 记一行 matches:unknown（记不下来源的那一档，不许当默认值乱用）',
  )
}

// 日志本身写不出去时，识别结论不许跟着失败（这是房间读路径的既定口径）。
{
  const ws = newWorkspace()
  const ctx: Record<string, unknown> = {
    cwd: ws,
    opId: 'op-1130',
    isEnabled: () => true,
    logEvent: () => {
      throw new Error('日志写不出去')
    },
  }
  const fsLike = makeFs({ resolve: [], readText: [] })
  ctx.fs = fsLike
  ctx.platform = { fs: fsLike }
  ctx.exec = async () => ({ stdout: '', stderr: '', code: 0 })
  const hit = await gitlabBackend.matches({ cwd: ws } as never, ctx as never)
  check(hit === false, '日志写不出去时，识别结论照旧返回 false（读路径不许因为日志而失败）')
}

// 没有 logEvent 的上下文（宿主兜底那条路就是这样）：照旧能判定，不抛。
{
  const ws = newWorkspace()
  put(ws, '.git/config', GITLAB_CONFIG)
  const fsLike = makeFs({ resolve: [], readText: [] })
  const ctx = { cwd: ws, fs: fsLike, platform: { fs: fsLike } }
  const hit = await gitlabBackend.matches({ cwd: ws } as never, ctx as never)
  check(hit === true, '上下文没有 logEvent 时，识别照旧能判定（宿主兜底那条路）')
}

// ── 本文件必须在 verify 链里（不挂进链就等于没跑；#1125 起问规划函数）──
{
  const mine = planGates(ROOT).filter((s) => s.file.indexOf('verify-1130-gitlab-marker-read') >= 0)
  check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
}

console.log('\nverify-1130-gitlab-marker-read: ' + (failed ? '有失败项' : '全部通过'))
if (failed) process.exit(1)
console.log('GITLAB MARKER READ OK')
