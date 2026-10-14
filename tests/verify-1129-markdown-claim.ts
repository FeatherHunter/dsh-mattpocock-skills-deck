/**
 * tests/verify-1129-markdown-claim.ts —— Markdown 房的认领条件收紧，以及找 map.md 的成本不再随 .scratch 里的条目数增长。
 *
 * 票面（#1129）给出三条验收，本文件一条一条钉住：
 *   ① 工作区里没有 `.scratch/map.md`、也没有「指向 markdown 的声明」时，`matches` 必须返回 false；
 *   ② 有 `.scratch/map.md` 的工作区，结论与改动前一致（返回 true）；
 *   ③ 认领路径不再按「`.scratch` 目录里的每个条目」去猜 map.md 在哪。这一条用两个计数器钉：
 *      找 map.md 的过程不再调用列目录（listDir），判断路径是否存在（lstat）的次数也不再随
 *      `.scratch` 里的条目数增长。
 *
 * 为什么这条要紧（2026-10-14 在本机只读实测到的事实）：
 *   - wayfinder 的本地地图写在 `.scratch/<effort>/map.md`，根级 `.scratch/map.md` 在真机上并不存在
 *     （布局定义见 `bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md` 第 7、25 行：
 *     「One feature per directory: `.scratch/<feature-slug>/`」「Map: `.scratch/<effort>/map.md`」）。
 *     本机 D:\dsh-plugin 下的四个 Local Markdown 工作区（matt-demo-markdown、matt-demo-markdown-test1、
 *     demo-md-1、dsh-matt-md-09323）没有一个有根级 `.scratch/map.md`，它们能被认出来靠的是声明文件
 *     `docs/agents/issue-tracker.md` 里那句 "Local Markdown"。
 *   - 反过来，本仓是 GitHub 后端（本仓 `docs/agents/issue-tracker.md` 第 1 行写的是 `# Issue tracker: GitHub`），
 *     根级 `.scratch/map.md` 也不存在，但 `.scratch/572-debug/map.md` 在。旧实现会因此把本仓认下来，
 *     只是恰好被「多个房同时命中时按注册序取第一个」的顺序兜住（`src/tracker/registry/core.ts:185-188`
 *     取 `hits[0]`，顺序就是注册顺序）。也就是说，Markdown 房认领得对不对，当时并不由它自己保证。
 *
 * 运行：node tests/verify-1129-markdown-claim.ts（已挂在 package.json 的 verify 长串上）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { matches } from '../src/tracker/rooms/markdown/index.ts'

let failed = false
const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ── 夹具：每个用例一个真的空目录，按需要往里写文件 ──
// 路径一律用 posix 拼法（下面的 platform.path 就是 path.posix），写盘时 Windows 也认正斜杠，
// 这样期望路径与实际路径用的是同一个拼法，不会两边各说各话。
function newWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-1129-'))
}
function put(ws: string, rel: string, text = ''): void {
  const full = path.posix.join(ws, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text, 'utf8')
}
/** 在一个工作区的 `.scratch` 下造 n 个普通文件（不是子目录）：票面特意点明旧实现连普通文件也当候选。 */
function putScratchFiles(ws: string, n: number): void {
  for (let i = 0; i < n; i++) put(ws, '.scratch/entry-' + String(i).padStart(2, '0') + '.md', 'x')
}

/** 调用计数器：本文件靠它钉「不再遍历 .scratch」这条验收（listDir 次数、lstat 次数）。 */
type Calls = { listDir: number; lstat: number }
function freshCalls(): Calls {
  return { listDir: 0, lstat: 0 }
}
let calls: Calls = freshCalls()

/**
 * 递给 `matches` 的操作上下文：文件服务包一层真实磁盘，顺手把 listDir 与 lstat 的调用次数记下来。
 * 形状按 `src/tracker/rooms/markdown/read.ts` 的 `getFs` 认的顺序给（platform.fs 优先）。
 */
const plat = {
  path: path.posix,
  fs: {
    async resolve(p: string) { return p },
    async lstat(t: string) { calls.lstat++; try { return fs.lstatSync(t) } catch { return null } },
    async listDir(t: string) { calls.listDir++; try { return fs.readdirSync(t) } catch { return [] } },
    async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    async readText(t: string) { return fs.readFileSync(t, 'utf8') },
  },
}
function ctxOf(ws: string) {
  return { cwd: ws, platform: plat, fs: plat.fs }
}
/** 跑一次认领判定，并把这一次的调用次数一起交出来。 */
async function claim(ws: string, refId?: string): Promise<{ hit: boolean; calls: Calls }> {
  calls = freshCalls()
  const handle: { cwd: string; refId?: string } = { cwd: ws }
  if (refId !== undefined) handle.refId = refId
  const hit = await matches(handle as never, ctxOf(ws) as never)
  return { hit, calls: { listDir: calls.listDir, lstat: calls.lstat } }
}

const DECLARATION_LOCAL = '# Issue tracker: Local Markdown\n\nIssues and specs for this repo live as markdown files in `.scratch/`.\n'
const DECLARATION_GITHUB = '# Issue tracker: GitHub\n\nIssues and specs for this repo live as GitHub issues.\n'

console.log('== #1129 ① 没有 map.md、也没有指向 markdown 的声明 → 不是我 ==')

// 本仓形态：声明说 GitHub，根级没有 .scratch/map.md，但 .scratch 的某个子目录里有 map.md。
// 旧实现会因为那个子目录里的 map.md 把工作区认下来（票面说的「探测走偏」），新实现必须如实说不是。
{
  const ws = newWorkspace()
  put(ws, 'docs/agents/issue-tracker.md', DECLARATION_GITHUB)
  put(ws, '.scratch/572-debug/map.md', '## Destination\n\n某个 effort 留下的本地地图\n')
  const r = await claim(ws)
  check(r.hit === false, '声明是 GitHub、根级无 .scratch/map.md、只有 .scratch/572-debug/map.md → false（本仓形态）')
}

// 什么都没有的工作区：既没有 map.md，也没有声明文件。
{
  const ws = newWorkspace()
  const r = await claim(ws)
  check(r.hit === false, '空工作区（无 .scratch、无声明）→ false')
}

// 有 .scratch 目录但里面没有 map.md，也没有声明文件。
{
  const ws = newWorkspace()
  putScratchFiles(ws, 3)
  const r = await claim(ws)
  check(r.hit === false, '.scratch 下只有普通文件、没有 map.md、也没有声明 → false')
}

console.log('\n== #1129 ② 有 map.md 或声明时，结论与改动前一致 ==')

// 根级扁平布局（`ref.effortId` 为空串时走的那种，见 src/tracker/rooms/markdown/path.ts:69-77）。
{
  const ws = newWorkspace()
  put(ws, '.scratch/map.md', '## Destination\n\n扁平布局的本地地图\n')
  const r = await claim(ws)
  check(r.hit === true, '有 .scratch/map.md → true（与改动前一致）')
}

// setup 已经选好 Local Markdown、但首张地图还没画：声明文件在，.scratch 目录还不存在。
// 实测 dsh-matt-md-09323 就是这个形态。
{
  const ws = newWorkspace()
  put(ws, 'docs/agents/issue-tracker.md', DECLARATION_LOCAL)
  const r = await claim(ws)
  check(r.hit === true, '只有声明（含 "Local Markdown"）、还没有 .scratch → true（与改动前一致）')
}

// 真机 Local Markdown 工作区的常态：声明在，地图在 `.scratch/<effort>/map.md`，根级没有 map.md。
// 实测 matt-demo-markdown / matt-demo-markdown-test1 / demo-md-1 都是这个形态。
{
  const ws = newWorkspace()
  put(ws, 'docs/agents/issue-tracker.md', DECLARATION_LOCAL)
  put(ws, '.scratch/buy-luckin-coffee-plan/map.md', '## Destination\n\n按 effort 分目录的本地地图\n')
  const r = await claim(ws)
  check(r.hit === true, '声明 + .scratch/<effort>/map.md、根级无 map.md → true（真机 Local Markdown 常态）')
}

// refId 直接指向 `.scratch/<effort>`：这是调用方明确给出的路径，不是「猜」出来的，必须继续认。
{
  const ws = newWorkspace()
  put(ws, '.scratch/effort-a/map.md', '## Destination\n\n某个 effort 的地图\n')
  const r = await claim(ws, '.scratch/effort-a')
  check(r.hit === true, 'refId 明确指向 .scratch/effort-a 且那里有 map.md → true（显式路径仍然认）')
}

console.log('\n== #1129 ③ 认领时不再遍历 .scratch，成本不随条目数增长 ==')

// 两批规模差 20 倍的普通文件：判断存在性的次数必须一样多。旧实现会一个条目一个候选地试下去，
// 于是「.scratch 里有多少条目」直接决定这次认领要问盘多少次。
{
  const small = newWorkspace()
  putScratchFiles(small, 3)
  const big = newWorkspace()
  putScratchFiles(big, 60)
  const rSmall = await claim(small)
  const rBig = await claim(big)
  console.log('    3 个条目: lstat ' + rSmall.calls.lstat + ' 次 | 60 个条目: lstat ' + rBig.calls.lstat + ' 次')
  check(rSmall.hit === false && rBig.hit === false, '两批都不含 map.md → 都是 false')
  check(rSmall.calls.lstat === rBig.calls.lstat, 'lstat 次数不随 .scratch 条目数增长（3 个条目与 60 个条目次数相同）')
}

// 「不再按目录里的每个条目去猜」最直接的证据：认领这一趟根本不列目录。
{
  const ws = newWorkspace()
  putScratchFiles(ws, 20)
  const r = await claim(ws)
  check(r.calls.listDir === 0, '认领过程一次 listDir 都不调用（不再遍历 .scratch）')
}

console.log('\nverify-1129-markdown-claim: ' + (failed ? '有失败项' : '全部通过'))
if (failed) process.exit(1)
console.log('MARKDOWN CLAIM OK')
