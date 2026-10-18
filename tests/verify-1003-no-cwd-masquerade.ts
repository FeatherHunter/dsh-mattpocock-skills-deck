#!/usr/bin/env node
/**
 * verify-1003-no-cwd-masquerade.js —— 「拿不到工作区目录时，不许拿进程目录冒充」这条不变式的门禁。
 *
 * 依据：#1003 实施契约的期望行为第 9 条，以及维护者 2026-10-12 对第 3 个问题的拍板（选 A：同期收掉）。
 * 为什么单独立一扇：兜底值一旦回到「进程自己的目录」，缺目录的调用会静默落到一条真实存在的、
 * 别人的目录上——读会在错的仓库里读，写会在错的仓库里写，而且**不报错**，最难查。
 *
 * 钉两件事（都跑起来看结果，不读源码文本）：
 *   ① 凭据 git 出口（真会执行 git 的那一条）在空目录上如实失败，且一次都没有起进程；有目录时照常执行（对照）。
 *   ② 真宿主入口装配出来的那几条电话：从 src/host/index.js 的 apply 起，经它注册的 RPC 路由真调——
 *      后端探测（空目录时如实说「工作区还没就绪」、不产出任何后端、一次外部命令都不起）与按页取票
 *      （空目录时如实拒绝，且起过的命令里一条都不许带真实目录）；最后两条电话各给一个真目录作对照：
 *      后端探测照常干活、按页取票照常带着那条目录去起命令——证明上面拦的是「缺目录」，不是「功能整个关掉」。
 *
 * 为什么第 ② 条非有不可（2026-10-12 实测）：装配时递给各模块的兜底值，只有从真入口调一次才看得见。
 * 只给模块塞一个空串的话，把 src/host/index.js 里那一行改回进程自己的目录（也就是 #1003 的病根）
 * 也照样全绿——那一次负控证明了这一点。
 *
 * 用法：node tests/verify-1003-no-cwd-masquerade.js
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let passed = 0
let failed = 0
const check = (ok: boolean, msg: string) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

console.log('== ① 凭据 git 出口：空目录如实失败，且一次都没起进程 ==')
{
  const mod = await imp('src/host/gitCredentialExec.js')
  const calls: Array<{ exe: unknown; cwd: unknown; argv: unknown }> = []
  const runGit = async function (exe: unknown, cwd: unknown, argv: unknown) { calls.push({ exe, cwd, argv }); return { kind: 'ok', stdout: 'ok', truncated: false } }
  const deps = {
    runGit,
    getPlatform: async () => ({ resolveExecutable: async () => '/usr/bin/git' }),
    getEnv: () => ({}),
    DEFAULT_CWD: '',
  }
  const safe = mod.createCredentialSafeGit(deps)

  const empty = await safe.runOnce({ args: ['status'], cwd: '' })
  check(empty && empty.ok === false, '空目录：如实失败（不返回成功）—— 实得 ' + JSON.stringify(empty))
  check(empty && empty.kind === 'cwd', '空目录：失败原因是「没有工作区目录」这一档 —— 实得 kind=' + (empty && empty.kind))
  check(calls.length === 0, '空目录：一次都没有起 git 进程（不拿进程目录顶上）—— 实得起了 ' + calls.length + ' 次')

  const blank = await safe.runOnce({ args: ['status'], cwd: '   ' })
  check(blank && blank.ok === false && calls.length === 0, '只有空白字符的目录：同样如实失败且不起进程')

  const withDir = await safe.runOnce({ args: ['status'], cwd: 'D:\\ws' })
  check(withDir && withDir.ok === true, '对照：有目录时照常执行（说明上面两条拦的就是「缺目录」，不是把功能整个关掉）')
  check(calls.length === 1 && calls[0].cwd === 'D:\\ws', '对照：这一趟确实带着那个目录起了进程 —— 实得 cwd=' + (calls[0] && calls[0].cwd))
}

console.log('')
console.log('== ② 真宿主入口：空目录调一次后端探测，看它有没有拿进程目录顶上 ==')
{
  const entry = (await imp('src/host/index.js')).default
  const spawns: Array<{ argv: unknown; cwd: unknown }> = []
  const subprocess = {
    spawn: (o: { argv?: unknown; cwd?: unknown }) => { spawns.push({ argv: (o && o.argv) || [], cwd: o && o.cwd }); return { ok: true, stdout: '', stderr: '', code: 0, kill() {} } },
    exec: async () => ({ ok: true, stdout: '', stderr: '', code: 0 }),
  }
  // 定时器给「永不触发」的桩：装配里那些重试/兜底定时器不该在门禁里真的跑起来（跑起来会挂住进程，也不确定）。
  const timer = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, now: () => Date.now() }
  const fsStub = {
    readText: async () => null,
    writeText: async () => ({ ok: true }),
    exists: async () => false,
    mkdir: async () => ({ ok: true }),
    resolve: (p: unknown) => p,
    listDir: async () => [],
    unlink: async () => ({ ok: true }),
  }
  // 平台服务给最小可用桩：电话们要先问出 git/gh 的可执行文件，问不出来它们会在「起命令」之前就早退，
  // 那样就看不见「起命令时用的是哪条目录」这件事了。
  const platformStub = {
    resolveExecutable: async (n: unknown) => (n === 'git' ? 'C:/verify/git.exe' : (n === 'gh' ? 'C:/verify/gh.exe' : null)),
    path: {
      join: (...p: unknown[]) => p.filter(Boolean).join('/'),
      dirname: (p: unknown) => String(p).replace(/[\\/][^\\/]*$/, ''),
      basename: (p: unknown) => String(p).split(/[\\/]/).pop(),
      resolve: (...p: unknown[]) => p.filter(Boolean).join('/'),
      isAbsolute: (p: unknown) => /^([A-Za-z]:[\\/]|\/)/.test(String(p)),
    },
    fs: fsStub,
    getHome: async () => 'C:/verify-home',
    env: { get: () => undefined },
    openFolder: async () => ({ ok: true }),
  }
  // 假连接：宿主入口把它的 RPC 路由注册到这里，我们拿着这条路由真的发一次请求。
  const routes: Array<{ fetch: (req: unknown) => Promise<{ text(): Promise<string> }> }> = []
  const connection = { fetch: { register: (r: { fetch: (req: unknown) => Promise<{ text(): Promise<string> }> }) => { routes.push(r); return () => {} } } }
  const stubs: Record<string, unknown> = { subprocess, timer, fs: fsStub, connection, platform: platformStub }
  const ctx = { get: (n: string) => stubs[n], inject: () => {}, effect: () => {} }

  entry.apply(ctx)
  const t0 = Date.now()
  while (routes.length === 0 && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100))
  check(routes.length > 0, '真宿主入口把电话路由注册出来了（注册不出来说明装配没起来，下面几条就不算数）')

  const route = routes[0]
  // 走线格式与客户端一致（src/seam/rpc.ts 会把 wf. 前缀摘掉再发，所以这里发的是不带前缀的名字）。
  const callPhone = async (method: unknown, payload: unknown) => {
    const req = new Request('http://verify.local/api/dsws', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'verify-1003-no-cwd', payload: { method, payload } }),
    })
    const res = await route.fetch(req)
    const envelope = JSON.parse(await res.text())
    return (envelope && envelope.result) || {}
  }

  // 甲、后端探测这条电话：空目录如实说「还没就绪」。
  const before = spawns.length
  const empty = await callPhone('detect', { cwd: '' })
  const emptyValue = (empty && empty.value) || {}
  check(empty.ok === true, '空目录：宿主回了成功信封（不是「宿主整个没起来」被当成守住了）—— 实得 ' + JSON.stringify(empty).slice(0, 180))
  check(emptyValue.workspaceNotReady === true, '空目录：如实说「工作区还没就绪」—— 实得 ' + JSON.stringify(emptyValue).slice(0, 180))
  check(emptyValue.selection === null || emptyValue.selection === undefined, '空目录：不产出任何后端（不拿进程目录去认一个出来）—— 实得 ' + JSON.stringify(emptyValue.selection))
  check(spawns.length === before, '空目录：一次外部命令都没起 —— 实得起了 ' + (spawns.length - before) + ' 次')

  // 乙、按页取票这条电话：cwd 缺席时它会用到装配递进来的兜底值，所以它是这条不变式最灵的那一根探针。
  //     2026-10-12 实测：把 src/host/index.js 里那一行改回进程自己的目录，这条电话会带着进程目录起命令、
  //     并在那个目录里「读成功」（回 ok:true）——这就是「读会在错的仓库里读」。
  const before2 = spawns.length
  const page = await callPhone('issuesPage', {})
  const pageValue = (page && page.value) || {}
  const pageCwds = spawns.slice(before2).map((s) => s.cwd)
  check(page.ok === true && pageValue.ok === false, '空目录：按页取票如实拒绝（不许产出一份「读成功」的回话）—— 实得 ' + JSON.stringify(pageValue).slice(0, 180))
  check(pageCwds.every((c) => !c || String(c).trim() === ''), '空目录：起过的命令里没有一条带真实目录（不拿进程目录顶上）—— 实得 ' + JSON.stringify(pageCwds))

  // 丙、对照：给一个真目录时照常干活。
  const before3 = spawns.length
  const withDir = await callPhone('detect', { cwd: ROOT })
  const withValue = (withDir && withDir.value) || {}
  check(withDir.ok === true && withValue.workspaceNotReady !== true, '对照：给一个真目录时它照常干活（说明上面拦的是「缺目录」，不是把功能整个关掉）')
  check(spawns.length > before3, '对照：给真目录时确实去看了那个目录（起了外部命令）—— 实得起了 ' + (spawns.length - before3) + ' 次')

  // 丁、对照（判别力最强的这根探针自己得活着）：给一个真目录时，按页取票确实带着那条目录去起命令。
  //     没有这一条的话，「空目录如实拒绝」在「这条电话对谁都说拒绝、整个坏了」时也会绿——那这扇门禁
  //     就退化成橡皮图章：它会一直绿，却什么也没守住（2026-10-12 对抗式审查发现，补上）。
  const before4 = spawns.length
  const pageWithDir = await callPhone('issuesPage', { cwd: ROOT })
  const pageWithDirCwds = spawns.slice(before4).map((s) => s.cwd)
  const sameDir = (p: unknown) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()
  check(pageWithDir.ok === true, '对照：给真目录时按页取票这条电话照常走到宿主里（不是对谁都说拒绝）—— 实得 ' + JSON.stringify(pageWithDir).slice(0, 140))
  check(pageWithDirCwds.some((c) => sameDir(c) === sameDir(ROOT)), '对照：它确实带着我给的那条目录去起命令（上面「不带真实目录」才有意义）—— 实得 ' + JSON.stringify(pageWithDirCwds))
}

console.log('')
console.log(failed ? '存在失败 — 空目录冒充不变式没守住（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 空目录不许冒充工作区（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
