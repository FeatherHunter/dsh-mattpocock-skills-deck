// tests/verify-969-tiered-timeout.ts —— 门禁：分档超时暂定值（#969）
// 为什么需要它：以前全仓只有一档 30000，读等得久拖住界面，写杀得早害用户不敢重试，
// 探活本该最快却也要等满；慢网超时还可能被说成没登录，写超时还可能被自动重试写两遍。
// 它守三件事（只看外部行为，不看内部队列数组长什么样）：
//   一、读与写各走各的档（三个档位的毫秒数取自 src/shared/time-config/values.js，调用方显式传超时优先）；
//   二、慢网超时归网络档（未知、稍后），不报没登录；
//   三、写超时只试一次就停，把超时原样交回调用方人工核对，不自动再发一次。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-969-tiered-timeout.ts（2026-10-17 从 .js 转成 TypeScript：只改名与加类型标注，判据一条没动）
import nodePath from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = nodePath.resolve(nodePath.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')

// 三个档位的毫秒数只有中央一个来源（src/shared/time-config/values.js）：这里不手抄数字，
// 免得配置一调（例如 #1245 把写档从 30 秒放宽到 60 秒）门禁就假红。
const { OUTBOUND_READ_TIMEOUT_MS: READ_BUDGET_MS, OUTBOUND_WRITE_TIMEOUT_MS: WRITE_BUDGET_MS, OUTBOUND_PROBE_TIMEOUT_MS: PROBE_BUDGET_MS } =
  await import(pathToFileURL(nodePath.join(ROOT, 'src/shared/time-config/values.js')).href)

let failed = false
let total = 0
const check = (ok: unknown, msg: string, detail?: unknown): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : ' — ' + detail))
  if (!ok) failed = true
}

console.log('== #969 分档超时（读 ' + READ_BUDGET_MS / 1000 + ' 秒／写 ' + WRITE_BUDGET_MS / 1000 + ' 秒／探活 ' + PROBE_BUDGET_MS / 1000 + ' 秒） ==')

// #1159：房间的出站能力从「直接 import 宿主件」改成「宿主注入一份 ctx.outbound」，
// 所以夹具里也得挂上那一份。这里用生产那份（src/host/platform/outbound-control.ts，只做转发），
// 顺带证明「注入进来的端口确实能让房间正常出站」；缺了它房内会大声报 env 错、一笔都不发。
const { createOutboundControl } = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/platform/outbound-control.ts')).href)
const outbound = createOutboundControl()

// —— 一、纯函数分档：读的短、写的长、探活的最短 ——
let tiers: any = null
try {
  tiers = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/kernel/outbound-tiers.ts')).href)
} catch (e) {
  check(false, '一、能读到分档超时纯函数（src/tracker/kernel/outbound-tiers.ts）', String((e && e.message) || e).slice(0, 200))
}
if (tiers) {
  const { READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, PROBE_TIMEOUT_MS, tierForGhArgs, timeoutForGhArgs, timeoutForTier, normalizeGhStringFields } = tiers
  check(READ_TIMEOUT_MS === READ_BUDGET_MS, '一、读档是 ' + READ_BUDGET_MS / 1000 + ' 秒（暂定值，终值等测量回填）', '实得 ' + String(READ_TIMEOUT_MS))
  check(WRITE_TIMEOUT_MS === WRITE_BUDGET_MS, '一、写档是 ' + WRITE_BUDGET_MS / 1000 + ' 秒（#1245 从 30 秒放宽到 60 秒，值取自中央常量）', '实得 ' + String(WRITE_TIMEOUT_MS))
  check(PROBE_TIMEOUT_MS === PROBE_BUDGET_MS, '一、探活档是 ' + PROBE_BUDGET_MS / 1000 + ' 秒（#1160：冷启动 keyring 加 TLS 经常超 3 秒，与谓词 15 秒对齐）', '实得 ' + String(PROBE_TIMEOUT_MS))
  // 读：列票与看票走读档
  check(tierForGhArgs(['issue', 'list', '--repo', 'a/b']) === 'read', '一、列票走读档')
  check(timeoutForGhArgs(['issue', 'view', '1']) === READ_BUDGET_MS, '一、看票超时 ' + READ_BUDGET_MS / 1000 + ' 秒')
  // 写：建票改票走写档
  check(tierForGhArgs(['issue', 'create', '--title', 'x']) === 'write', '一、建票走写档')
  check(timeoutForGhArgs(['issue', 'create', '--title', 'x']) === WRITE_BUDGET_MS, '一、建票超时 ' + WRITE_BUDGET_MS / 1000 + ' 秒')
  check(tierForGhArgs(['issue', 'comment', '1', '--body', 'hi']) === 'write', '一、评论走写档')
  check(tierForGhArgs(['api', 'repos/a/b/issues', '--method', 'POST']) === 'write', '一、经接口写票（POST）走写档')
  check(tierForGhArgs(['api', 'repos/a/b/issues/1']) === 'read', '一、经接口读票（GET）走读档')
  // 探活：登录态与版本自检走探活档（#1160 起探活 15 秒，不再是三档里最短的）
  check(tierForGhArgs(['auth', 'status']) === 'probe', '一、查登录态走探活档')
  check(timeoutForGhArgs(['auth', 'status']) === PROBE_BUDGET_MS, '一、查登录态超时 ' + PROBE_BUDGET_MS / 1000 + ' 秒（#1160）')
  check(tierForGhArgs(['--version']) === 'probe', '一、查版本号走探活档')
  // 调用方显式传的超时优先，不被档位覆盖
  check(timeoutForGhArgs(['issue', 'list'], 5000) === 5000, '一、调用方显式传的超时优先')
  check(timeoutForTier('write') === WRITE_BUDGET_MS && timeoutForTier('probe') === PROBE_BUDGET_MS && timeoutForTier('read') === READ_BUDGET_MS, '一、按档名取超时各走各的档')
  // #1375：gh 的 -F 会做类型推断，纯数字的 owner（例如 776317107）被发成 JSON 数字，
  // 而 GraphQL 把 $owner 与 $name 声明为 String!，于是回「Could not coerce ... to String」。
  // 出站前必须把这两个字段归一成 -f，整型字段保持 -F。
  const numericOwnerArgs = ['api', 'graphql', '-f', 'query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){nameWithOwner}}', '-F', 'owner=776317107', '-F', 'name=dsh-data-manager', '-F', 'number=13']
  const normalized = normalizeGhStringFields(numericOwnerArgs)
  const idxOwner = normalized.indexOf('owner=776317107')
  const idxName = normalized.indexOf('name=dsh-data-manager')
  const idxNumber = normalized.indexOf('number=13')
  check(idxOwner > 0 && normalized[idxOwner - 1] === '-f', '一、纯数字 owner 的 GraphQL 字段改成 -f（#1375）', normalized.join(' '))
  check(idxName > 0 && normalized[idxName - 1] === '-f', '一、repo name 同样改成 -f', normalized.join(' '))
  check(idxNumber > 0 && normalized[idxNumber - 1] === '-F', '一、整型字段 number 仍保持 -F', normalized.join(' '))
  check(numericOwnerArgs[4] === '-F', '一、归一化不改调用方传进来的数组')
  const restArgs = ['api', 'repos/776317107/dsh-data-manager/issues/13']
  check(normalizeGhStringFields(restArgs) === restArgs, '一、非 GraphQL 调用原样返回')
  const alreadyRaw = ['api', 'graphql', '-f', 'query=x', '-f', 'owner=776317107', '-f', 'name=dsh-data-manager']
  check(normalizeGhStringFields(alreadyRaw) === alreadyRaw, '一、已经是 -f 的调用原样返回')
  const longField = normalizeGhStringFields(['api', 'graphql', '-f', 'query=x', '--field', 'owner=776317107'])
  check(longField[4] === '-f', '一、--field 写法的 owner 也归一成 -f', longField.join(' '))
  // 只测纯函数还不够：两个出站包装器真的把它接上了，才算修好。
  const hostSource = readFileSync(nodePath.join(ROOT, 'src/host/git-process.ts'), 'utf8')
  const roomSource = readFileSync(nodePath.join(ROOT, 'src/tracker/rooms/github/client.ts'), 'utf8')
  check(hostSource.indexOf('normalizeGhStringFields(args)') >= 0, '一、host 的 runGh 出站前调用了归一化')
  check(roomSource.indexOf('normalizeGhStringFields(args)') >= 0, '一、房内 execGh 出站前调用了归一化')
}

// —— 二、慢网超时归网络档，不报没登录 ——
{
  const { classifyGhError } = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/rooms/github/errors.ts')).href)
  const { ERROR_KIND } = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/contract/vocabulary.ts')).href)
  // 超时原文（含 timeout / timed out / 超时杀掉）一律归网络档
  check(classifyGhError({ message: 'timeout of 12000ms exceeded' }) === ERROR_KIND.NETWORK, '二、读超时原文归网络档（未知、稍后）')
  check(classifyGhError({ message: 'gh api timed out' }) === ERROR_KIND.NETWORK, '二、接口超时原文归网络档')
  check(classifyGhError({ message: 'connection timed out' }) === ERROR_KIND.NETWORK, '二、连接超时原文归网络档')
  // 超时不许被误判成没登录
  const k = classifyGhError({ message: 'timeout of 3000ms exceeded' })
  check(k !== ERROR_KIND.AUTH, '二、超时不报没登录（归 ' + String(k) + '，不是 auth）')
}

// —— 三、执行层按档取超时：读、写、探活各按中央常量那一档（#1160、#1245）——
{
  const { ghClient } = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/rooms/github/client.ts')).href)
  // 假执行器：只记调用方要它等多久，不真起进程
  const seen = []
  const fakeExec = async (cmd, args, opts) => {
    seen.push({ args: [...args], timeout: opts && opts.timeout })
    return { stdout: '[]', stderr: '', code: 0 }
  }
  const fakeCtx = {
    outbound,
    platform: { resolveExecutable: async () => 'gh' },
    exec: fakeExec,
    cwd: '.',
    logEvent: () => {},
    isEnabled: () => false,
  }
  const c = ghClient(fakeCtx)
  seen.length = 0
  await c.execGh(['issue', 'list', '--repo', 'a/b'], { cwd: '.' })
  check(seen.length === 1 && seen[0].timeout === READ_BUDGET_MS, '三、读调用默认等 ' + READ_BUDGET_MS / 1000 + ' 秒', '实得 ' + JSON.stringify(seen[0] && seen[0].timeout))
  seen.length = 0
  await c.execGh(['issue', 'create', '--title', 'x'], { cwd: '.' })
  check(seen.length === 1 && seen[0].timeout === WRITE_BUDGET_MS, '三、写调用默认等 ' + WRITE_BUDGET_MS / 1000 + ' 秒', '实得 ' + JSON.stringify(seen[0] && seen[0].timeout))
  seen.length = 0
  await c.execGh(['auth', 'status'], { cwd: '.' })
  check(seen.length === 1 && seen[0].timeout === PROBE_BUDGET_MS, '三、探活调用默认等 ' + PROBE_BUDGET_MS / 1000 + ' 秒（#1160）', '实得 ' + JSON.stringify(seen[0] && seen[0].timeout))
  // 调用方显式传的超时不被档位覆盖
  seen.length = 0
  await c.execGh(['issue', 'list'], { cwd: '.', timeout: 5000 })
  check(seen.length === 1 && seen[0].timeout === 5000, '三、显式超时优先（传 5000 就等 5000）')
}

// —— 四、写超时只试一次就停，不自动再发一次 ——
{
  const { ghClient } = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/rooms/github/client.ts')).href)
  const { ERROR_KIND } = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/contract/vocabulary.ts')).href)
  let calls = 0
  const timeoutExec = async () => {
    calls += 1
    const e = new Error('timeout of 30000ms exceeded')
    e.code = -1
    throw e
  }
  const ctx = {
    outbound,
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
  const src = readFileSync(nodePath.join(ROOT, 'src/host/git-process.ts'), 'utf8')
  // 超时杀掉后记超时行（gh.timeout），且超时那一次按网络档返回（不是没登录也不是找不到）
  check(/gh\.timeout/.test(src), '五、取数层超时记超时行（gh.timeout）')
  check(/signal\s*===\s*['"]timeout['"]/.test(src) && /network/.test(src), '五、超时信号归网络档（慢网显示未知）')
  // 取数层按档取超时（读短写长探活最长：探活 15 秒比读档的 12 秒还久），不是全仓一档写死
  check(/gh-timeout-tiers|timeoutForGhArgs|tierForGhArgs|READ_TIMEOUT_MS|WRITE_TIMEOUT_MS|PROBE_TIMEOUT_MS/.test(src), '五、取数层按读写探活分档取超时（不是一档写死）')
}

// —— 六、房内自己掐表（#1007）：排队段也算进这只表，且与「调用方取消」分得开 ——
{
  const { ghClient } = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/rooms/github/client.ts')).href)
  const { getGhLane } = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/outbound/admission.ts')).href)
  const { ERROR_KIND } = await import(pathToFileURL(nodePath.join(ROOT, 'src/tracker/contract/vocabulary.ts')).href)

  // 执行器卡住、连取消都不理：promise 永不落地。房内不能因此被无限拖住。
  const hangExec = (): Promise<never> => new Promise(() => {})
  const events = []
  const hangCtx = {
    outbound,
    platform: { resolveExecutable: async () => 'gh' },
    exec: hangExec,
    cwd: '.',
    logEvent: (level, event, fields) => events.push({ level, event, fields }),
    isEnabled: () => true,
  }
  const hangClient = ghClient(hangCtx)

  // ① 执行器不回来：房内到点即返回，不再拖到外层的调用钳制，并如实归超时
  const t0 = Date.now()
  const r1 = await hangClient.execGh(['issue', 'list'], { cwd: '.', timeout: 150 })
  const took = Date.now() - t0
  check(r1 && r1.ok === false && r1.error && r1.error.kind === ERROR_KIND.NETWORK, '六、执行器不回来时房内返回超时（归网络档，不报没登录）', JSON.stringify(r1 && r1.error))
  check(r1 && r1.error && r1.error.timedOut === true && r1.error.cancelled !== true, '六、这一笔按「超时」交回，不混进「被取消」', JSON.stringify(r1 && r1.error))
  check(took < 2000, '六、到点就返回（不等外层钳制）', '实耗 ' + took + 'ms')
  check(events.some((e) => e.event === 'gh.timeout' && e.fields && e.fields.timeoutMs === 150), '六、房内到点记一行超时告警（gh.timeout 带本档毫秒）')

  // ② 名额被占满：排队段也算进这只表（旧实现会一路排到外层钳制才结束）
  const lane = getGhLane()
  const maxRead = lane.limits().readMax
  const held = []
  for (let i = 0; i < maxRead; i++) held.push(await lane.acquire({ bucket: 'read' }))
  const t1 = Date.now()
  const r2 = await hangClient.execGh(['issue', 'list'], { cwd: '.', timeout: 150 })
  const queued = Date.now() - t1
  for (const rel of held) { try { rel() } catch (eR) {} }
  check(r2 && r2.ok === false && r2.error && r2.error.timedOut === true, '六、排在名额队列里也算进房内的表（到点即中止）', JSON.stringify(r2 && r2.error))
  check(queued < 2000, '六、排队段到点即返回', '实耗 ' + queued + 'ms')

  // ③ 调用方取消照旧算「取消」，不算失败（生产里的执行器会因信号而落地，这里照实模拟）
  const signalAwareExec = (cmd: unknown, args: unknown, opts: any) => new Promise((resolve, reject) => {
    const s = opts && opts.signal
    if (s && typeof s.addEventListener === 'function') {
      s.addEventListener('abort', () => { const e = new Error('aborted by caller'); e.aborted = true; reject(e) }, { once: true })
    }
  })
  const cancelClient = ghClient(Object.assign({}, hangCtx, { exec: signalAwareExec }))
  const ctl = new AbortController()
  const p = cancelClient.execGh(['issue', 'list'], { cwd: '.', timeout: 5000, signal: ctl.signal })
  setTimeout(() => { try { ctl.abort() } catch (eA) {} }, 60)
  const r3 = await p
  check(r3 && r3.ok === false && r3.error && r3.error.cancelled === true, '六、调用方取消仍按「取消」返回（不算失败、可重试）', JSON.stringify(r3 && r3.error))
}

console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
process.exit(failed ? 1 : 0)
