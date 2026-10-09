// tests/verify-969-tiered-timeout.js —— 门禁：分档超时暂定值（#969）
// 为什么需要它：以前全仓只有一档 30000，读等得久拖住界面，写杀得早害用户不敢重试，
// 探活本该最快却也要等满；慢网超时还可能被说成没登录，写超时还可能被自动重试写两遍。
// 它守三件事（只看外部行为，不看内部队列数组长什么样）：
//   一、读与写各走各的档（读 12000、写 30000、探活 3000，调用方显式传超时优先）；
//   二、慢网超时归网络档（未知、稍后），不报没登录；
//   三、写超时只试一次就停，把超时原样交回调用方人工核对，不自动再发一次。
// 用法：node tests/verify-969-tiered-timeout.js
import nodePath from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = nodePath.resolve(nodePath.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : ' — ' + detail))
  if (!ok) failed = true
}

console.log('== #969 分档超时（读12秒／写30秒／探活3秒） ==')

// —— 一、纯函数分档：读的短、写的长、探活的最短 ——
let tiers = null
try {
  tiers = await import(pathToFileURL(nodePath.join(ROOT, 'src/shared/gh-timeout-tiers.js')).href)
} catch (e) {
  check(false, '一、能读到分档超时纯函数（src/shared/gh-timeout-tiers.js）', String((e && e.message) || e).slice(0, 200))
}
if (tiers) {
  const { READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, PROBE_TIMEOUT_MS, tierForGhArgs, timeoutForGhArgs, timeoutForTier } = tiers
  check(READ_TIMEOUT_MS === 12000, '一、读档是 12 秒（暂定值，终值等测量回填）', '实得 ' + String(READ_TIMEOUT_MS))
  check(WRITE_TIMEOUT_MS === 30000, '一、写档是 30 秒（暂定值，写超时不提前杀）', '实得 ' + String(WRITE_TIMEOUT_MS))
  check(PROBE_TIMEOUT_MS === 3000, '一、探活档是 3 秒（登录态与版本自检最短）', '实得 ' + String(PROBE_TIMEOUT_MS))
  // 读：列票与看票走读档
  check(tierForGhArgs(['issue', 'list', '--repo', 'a/b']) === 'read', '一、列票走读档')
  check(timeoutForGhArgs(['issue', 'view', '1']) === 12000, '一、看票超时 12 秒')
  // 写：建票改票走写档
  check(tierForGhArgs(['issue', 'create', '--title', 'x']) === 'write', '一、建票走写档')
  check(timeoutForGhArgs(['issue', 'create', '--title', 'x']) === 30000, '一、建票超时 30 秒')
  check(tierForGhArgs(['issue', 'comment', '1', '--body', 'hi']) === 'write', '一、评论走写档')
  check(tierForGhArgs(['api', 'repos/a/b/issues', '--method', 'POST']) === 'write', '一、经接口写票（POST）走写档')
  check(tierForGhArgs(['api', 'repos/a/b/issues/1']) === 'read', '一、经接口读票（GET）走读档')
  // 探活：登录态与版本自检走最短档
  check(tierForGhArgs(['auth', 'status']) === 'probe', '一、查登录态走探活档')
  check(timeoutForGhArgs(['auth', 'status']) === 3000, '一、查登录态超时 3 秒')
  check(tierForGhArgs(['--version']) === 'probe', '一、查版本号走探活档')
  // 调用方显式传的超时优先，不被档位覆盖
  check(timeoutForGhArgs(['issue', 'list'], 5000) === 5000, '一、调用方显式传的超时优先')
  check(timeoutForTier('write') === 30000 && timeoutForTier('probe') === 3000 && timeoutForTier('read') === 12000, '一、按档名取超时各走各的档')
}

// —— 二、慢网超时归网络档，不报没登录 ——
{
  const { classifyGhError } = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/tracker/backends/github/errors.js')).href)
  const { ERROR_KIND } = await import(pathToFileURL(nodePath.join(ROOT, 'src/shared/tracker/constants.js')).href)
  // 超时原文（含 timeout / timed out / 超时杀掉）一律归网络档
  check(classifyGhError({ message: 'timeout of 12000ms exceeded' }) === ERROR_KIND.NETWORK, '二、读超时原文归网络档（未知、稍后）')
  check(classifyGhError({ message: 'gh api timed out' }) === ERROR_KIND.NETWORK, '二、接口超时原文归网络档')
  check(classifyGhError({ message: 'connection timed out' }) === ERROR_KIND.NETWORK, '二、连接超时原文归网络档')
  // 超时不许被误判成没登录
  const k = classifyGhError({ message: 'timeout of 3000ms exceeded' })
  check(k !== ERROR_KIND.AUTH, '二、超时不报没登录（归 ' + String(k) + '，不是 auth）')
}

// —— 三、执行层按档取超时：读 12 秒、写 30 秒、探活 3 秒 ——
{
  const { ghClient } = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/tracker/backends/github/client.js')).href)
  // 假执行器：只记调用方要它等多久，不真起进程
  const seen = []
  const fakeExec = async (cmd, args, opts) => {
    seen.push({ args: [...args], timeout: opts && opts.timeout })
    return { stdout: '[]', stderr: '', code: 0 }
  }
  const fakeCtx = {
    platform: { resolveExecutable: async () => 'gh' },
    exec: fakeExec,
    cwd: '.',
    logEvent: () => {},
    isEnabled: () => false,
  }
  const c = ghClient(fakeCtx)
  seen.length = 0
  await c.execGh(['issue', 'list', '--repo', 'a/b'], { cwd: '.' })
  check(seen.length === 1 && seen[0].timeout === 12000, '三、读调用默认等 12 秒', '实得 ' + JSON.stringify(seen[0] && seen[0].timeout))
  seen.length = 0
  await c.execGh(['issue', 'create', '--title', 'x'], { cwd: '.' })
  check(seen.length === 1 && seen[0].timeout === 30000, '三、写调用默认等 30 秒', '实得 ' + JSON.stringify(seen[0] && seen[0].timeout))
  seen.length = 0
  await c.execGh(['auth', 'status'], { cwd: '.' })
  check(seen.length === 1 && seen[0].timeout === 3000, '三、探活调用默认等 3 秒', '实得 ' + JSON.stringify(seen[0] && seen[0].timeout))
  // 调用方显式传的超时不被档位覆盖
  seen.length = 0
  await c.execGh(['issue', 'list'], { cwd: '.', timeout: 5000 })
  check(seen.length === 1 && seen[0].timeout === 5000, '三、显式超时优先（传 5000 就等 5000）')
}

// —— 四、写超时只试一次就停，不自动再发一次 ——
{
  const { ghClient } = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/tracker/backends/github/client.js')).href)
  const { ERROR_KIND } = await import(pathToFileURL(nodePath.join(ROOT, 'src/shared/tracker/constants.js')).href)
  let calls = 0
  const timeoutExec = async () => {
    calls += 1
    const e = new Error('timeout of 30000ms exceeded')
    e.code = -1
    throw e
  }
  const ctx = {
    platform: { resolveExecutable: async () => 'gh' },
    exec: timeoutExec,
    cwd: '.',
    logEvent: () => {},
    isEnabled: () => false,
  }
  const c = ghClient(ctx)
  const r = await c.execGh(['issue', 'create', '--title', 'x'], { cwd: '.' })
  check(calls === 1, '四、写超时只发一次（不自动重试，不写两遍）', '实发 ' + calls + ' 次')
  check(r && r.ok === false && r.error && r.error.kind === ERROR_KIND.NETWORK, '四、写超时归网络档，可人工核对', '实得 ' + JSON.stringify(r && r.error && r.error.kind))
  check(r && r.error && /timeout/i.test(String(r.error.message || '')), '四、写超时原文保留超时字样（人工核对有据）')
}

// —— 五、取数层超时也记超时行，且超时那一次归网络档 ——
{
  const src = readFileSync(nodePath.join(ROOT, 'src/host/repoKeys.js'), 'utf8')
  // 超时杀掉后记超时行（gh.timeout），且超时那一次按网络档返回（不是没登录也不是找不到）
  check(/gh\.timeout/.test(src), '五、取数层超时记超时行（gh.timeout）')
  check(/signal\s*===\s*['"]timeout['"]/.test(src) && /network/.test(src), '五、超时信号归网络档（慢网显示未知）')
  // 取数层按档取超时（读短写长探活最短），不是全仓一档写死
  check(/gh-timeout-tiers|timeoutForGhArgs|tierForGhArgs|READ_TIMEOUT_MS|WRITE_TIMEOUT_MS|PROBE_TIMEOUT_MS/.test(src), '五、取数层按读写探活分档取超时（不是一档写死）')
}

console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
process.exit(failed ? 1 : 0)
