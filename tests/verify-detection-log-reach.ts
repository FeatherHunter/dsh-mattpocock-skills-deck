// tests/verify-detection-log-reach.ts —— 门禁：#1048 收口补做，判定结论线在四条路上都落得下来
//
// 背景（第一性原理那一层）：一次判定只该有一条结论记录，而且必须落在真正做判断的那一处。问「这个工作区
// 是哪个后端」有四条入口——面板与首帧的 wf.selection、deck 工具壳、改色电话、早快照。其中改色那条已由
// #1131 改走带缓存的探测服务（服务内部把日志出口一路递给判定出口）；早快照那条（src/host/sessionLifecycle.js
// 的 selectEarly）从前借用常驻事件 detection.detect 的名字记一行五键结论，于是同一个事件名下住着两种形状。
//
// 这一条盯三件事：
//   ① 早快照的兜底收窄了：探测服务给出结论（哪怕是「没有后端」）就不再直问注册表；只有服务缺席或抛错时
//      才走兜底。理由不是省一次查询——服务内部走的就是统一判定出口，它已经答过；再问一遍会给出第二套
//      答案，而早快照会拿这第二套答案当结果（#1138 要收掉的「两条路两个答案」）。
//   ② 真走兜底那一趟自己落一行按需事件 detection.fallback（为什么走这一步、拿到什么、花了多久），不再借
//      detection.detect 的名字；调试开关关着时一行都不落；没有日志出口时不抛。
//   ③ 另外两条直调点把日志出口递进了判定出口：wf.selection（src/host/workspaceCwd.js）与 deck 工具壳
//      （src/deck/shell/call-shell.ts）。这两处补的是「同一件事没被记录到」这个洞。驱动它们要装配整条宿主链
//      （另有门禁在跑那些行为），这里只钉「递了没有」这一件事，用的是定点文本断言。
//
// 用法（手工跑要自己挂装载钩子；npm test / verify:parallel / verify-all / test:smoke 四个入口自动挂）：
//   node --import ./scripts/ts-hook.mjs tests/verify-detection-log-reach.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 日志出口落下来的行：门禁只用到级别、事件名与字段三样。 */
interface LogRow { level: string; event: string; fields: Record<string, unknown> }

/** 假日志出口：调试开关由参数给，落下来的行按顺序记着。 */
function fakeLog(debugOn: boolean) {
  const rows: LogRow[] = []
  return {
    rows,
    fire(level: string, event: string, fields: Record<string, unknown>) { rows.push({ level, event, fields }) },
    isEnabled(level: string) { return debugOn && level === 'debug' },
  }
}

/** 假注册表：兜底那一路只用得上 select 一件事（记下调用、回一份答案，需要时可抛）。 */
function fakeRegistry(answer: unknown = null, opts: { throws?: boolean } = {}) {
  const calls: unknown[] = []
  return {
    calls,
    select(handle: unknown, ctx: unknown) {
      calls.push({ handle, ctx })
      return opts.throws ? Promise.reject(new Error('注册表挂了')) : Promise.resolve(answer)
    },
  }
}

/** 造一个只装 selectEarly 真正用到的那几样依赖的早快照函数（其余依赖留空，走不到）。 */
async function makeSelectEarly(opts: { svc: unknown; registry?: unknown; logCtx?: unknown }) {
  const mod = await imp('src/host/sessionLifecycle.js') as {
    createSessionLifecycle: (deps: unknown) => { selectEarly: (c: { cwd: string }) => Promise<unknown> }
  }
  const lifecycle = mod.createSessionLifecycle({
    ctx: { get: () => ({ resolve: async () => ({}), readText: async () => '' }) },
    DEFAULT_CWD: '/tmp/ws-1048',
    errText: (e: unknown) => String((e as Error)?.message || e),
    canonicalKey: async (c: unknown) => c,
    getDetectionService: async () => opts.svc,
    getTrackerRegistry: async () => opts.registry,
    getPlatform: async () => ({ fs: {} }),
    logCtx: opts.logCtx || null,
  })
  return lifecycle.selectEarly
}

/** 回一份「探测服务给出结论」的假服务（结论本身是什么由参数决定）。 */
const svcSaid = (selection: unknown) => ({ detect: async () => ({ selection }) })
/** 回一份「服务这一步就炸了」的假服务。 */
const svcThrew = () => ({ detect: async () => { throw new Error('探测服务挂了') } })

const CWD = '/tmp/ws-1048'
const fallbackRows = (log: { rows: LogRow[] }) => log.rows.filter((r) => r.event === 'detection.fallback')

async function main() {
  console.log('\n一、服务给了结论就不再直问注册表（兜底收窄）')
  {
    const log = fakeLog(true)
    const reg = fakeRegistry({ backendId: 'markdown', source: 'matches' })
    const picked = { backendId: 'github', source: 'explicit' }
    const select = await makeSelectEarly({ svc: svcSaid(picked), registry: reg, logCtx: log })
    const sel = await select({ cwd: CWD }) as { backendId?: string } | null
    check(sel?.backendId === 'github', '服务给出人选时就把它的结论交出去（backendId=github）')
    check(reg.calls.length === 0, '服务给出结论后不再直问注册表（select 一次都没调）')
    check(fallbackRows(log).length === 0, '没走兜底就不落 detection.fallback 行')
  }
  {
    const log = fakeLog(true)
    const reg = fakeRegistry({ backendId: 'markdown', source: 'matches' })
    const honest = { backendId: null, source: 'fallback' }
    const select = await makeSelectEarly({ svc: svcSaid(honest), registry: reg, logCtx: log })
    const sel = await select({ cwd: CWD }) as { source?: string } | null
    check(reg.calls.length === 0, '服务如实回答「没有后端」时也算给了结论：不再重扫一遍各房认领')
    check(sel?.source === 'fallback', '交出去的仍是服务那一份结论（source=fallback），不是注册表另算的')
    check(fallbackRows(log).length === 0, '这一趟没走兜底，因此不落 detection.fallback 行')
  }

  console.log('\n二、只有服务缺席或抛错才走兜底，并且自己落一行')
  {
    const log = fakeLog(true)
    const reg = fakeRegistry({ backendId: 'markdown', source: 'matches' })
    const select = await makeSelectEarly({ svc: null, registry: reg, logCtx: log })
    const sel = await select({ cwd: CWD }) as { backendId?: string } | null
    const rows = fallbackRows(log)
    check(reg.calls.length === 1, '服务没装上时直问注册表一次（select 调了一次）')
    check(sel?.backendId === 'markdown', '兜底拿到的后端照旧交出去（backendId=markdown）')
    check(rows.length === 1, '兜底这一趟落一行 detection.fallback')
    check(rows[0]?.level === 'debug', '这一行是调试级（按需事件）')
    check(rows[0]?.fields.why === 'service-missing', '原因码写清为什么走兜底：service-missing')
    check(rows[0]?.fields.backendId === 'markdown', '这一行记下兜底拿到谁')
    check(rows[0]?.fields.errorHash === '', '没错就不记错误散列（空串）')
    check(typeof rows[0]?.fields.latencyMs === 'number', '这一行带这一次兜底花了多久（毫秒数）')
    check(log.rows.every((r) => r.event !== 'detection.detect'), '兜底那一趟不再借用常驻 detection.detect 的名字')
  }
  {
    const log = fakeLog(true)
    const reg = fakeRegistry(null)
    const select = await makeSelectEarly({ svc: svcThrew(), registry: reg, logCtx: log })
    await select({ cwd: CWD })
    const rows = fallbackRows(log)
    check(rows.length === 1 && rows[0]?.fields.why === 'service-threw', '服务抛错时原因码是 service-threw')
    check(String(rows[0]?.fields.errorHash || '').length === 8, '抛错时记下错误散列（八位短散列，不记原文）')
    check(rows[0]?.fields.backendId === '', '兜底什么也没拿到时 backendId 记空串')
  }
  {
    const log = fakeLog(true)
    const reg = fakeRegistry(null, { throws: true })
    const select = await makeSelectEarly({ svc: null, registry: reg, logCtx: log })
    const sel = await select({ cwd: CWD })
    const rows = fallbackRows(log)
    check(sel === null, '注册表也抛错时如实交回空（不编一个后端出来）')
    check(String(rows[0]?.fields.why || '').endsWith('+registry-threw'), '两处都出问题时原因码把两层都写上')
  }

  console.log('\n三、开关关着不落行，没有日志出口也不抛')
  {
    const log = fakeLog(false)
    const reg = fakeRegistry({ backendId: 'markdown', source: 'matches' })
    const select = await makeSelectEarly({ svc: null, registry: reg, logCtx: log })
    const sel = await select({ cwd: CWD }) as { backendId?: string } | null
    check(reg.calls.length === 1 && sel?.backendId === 'markdown', '开关关着时兜底照跑（行为不受日志开关影响）')
    check(log.rows.length === 0, '开关关着时一行都不落')
  }
  {
    const reg = fakeRegistry({ backendId: 'markdown', source: 'matches' })
    const select = await makeSelectEarly({ svc: null, registry: reg, logCtx: null })
    const sel = await select({ cwd: CWD }) as { backendId?: string } | null
    check(sel?.backendId === 'markdown', '没有日志出口时兜底照跑、不抛（只是留不下轨迹）')
  }

  console.log('\n四、另外两条直调点把日志出口递进了判定出口')
  {
    const cwdSrc = fs.readFileSync(path.join(ROOT, 'src/host/workspaceCwd.js'), 'utf8')
    check(/caller: 'wf\.selection', logCtx: logCtx/.test(cwdSrc), "wf.selection 那条出口调用递了 logCtx（caller: 'wf.selection', logCtx: logCtx）")
    const shellSrc = fs.readFileSync(path.join(ROOT, 'src/deck/shell/call-shell.ts'), 'utf8')
    check(/readDeclarationId: d\.readDeclarationId[\s\S]{0,400}?logCtx: log,/.test(shellSrc), 'deck 工具壳那条出口调用递了 logCtx（logCtx: log，与它记 host.call 的是同一个出口）')
    const lifeSrc = fs.readFileSync(path.join(ROOT, 'src/host/sessionLifecycle.js'), 'utf8')
    check(lifeSrc.indexOf("'detection.detect'") === -1, '早快照不再发与出口同名的常驻结论线（detection.detect 在文件里已消失）')
    check(lifeSrc.indexOf("'detection.fallback'") !== -1, '早快照的兜底改用自己那个名字（detection.fallback）')
  }

  console.log('\n共 ' + total + ' 项，' + (failed ? '有失败项' : '全部通过'))
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.log('  FAIL 门禁自己炸了：' + String((e && (e as Error).stack) || e)); process.exitCode = 1 })
