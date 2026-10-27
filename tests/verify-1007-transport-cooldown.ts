// tests/verify-1007-transport-cooldown.ts —— 门禁：去 GitHub 的通路失败后快速失败（#1007）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1007-transport-cooldown.ts，可独立运行。
//
// 这张票要验收的是四件事，本门禁一扇看住：
//   ① 房内自己掐表：执行器永不返回时，读档到点返回超时（归网络档），日志里有 gh.timeout，且写明是房内那一层；
//   ② 一次 transport 级失败之后，同一只桶在冷却窗口里不再起进程、立刻回一句「通路不通」；
//   ③ 第一次成功（拿到退出码）立刻清零冷却；通路正常时不多起进程、不多记事件；
//   ④ 失败回话带得出命令名，读写两档的后续动作分得开（读可重试 / 写先核对现状）。
//
// 为什么用自建准入闸：冷却状态住在准入单例里，用全局那一只测会把冷却留给后面的门禁
// （例如 verify-969 接着要占满名额，会被 30 秒冷却挡红）。这里用 createGhAdmission({ cooldownMs })
// 自建一只隔离的闸，再用一个只做转发的出站对象交给房间客户端，测完就地丢掉。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || detail === undefined ? '' : '  —— ' + String(detail)))
  if (!ok) failed = true
}
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 把一只自建准入闸包成房间客户端认得的出站控制面：两个判定方法照旧，冷却两件事转给闸。 */
function roomOutbound(lane: any): any {
  return {
    acquire: (req: any) => lane.acquire(req),
    isCancelled: () => false,
    noteWrite: () => {},
    reportTransportFailure: (f: any) => lane.reportTransportFailure(f),
    reportSuccess: (r: any) => lane.reportSuccess(r),
  }
}

/** 房间客户端要的最小上下文：能解析出 gh、能起进程、有出站控制面与日志出口。 */
function roomCtx(outbound: any, exec: any, events: any[]): any {
  return {
    cwd: '/ws-test-1007',
    platform: { resolveExecutable: async () => 'gh' },
    exec,
    outbound,
    gate: null,
    logEvent: (level: string, event: string, fields: any) => events.push({ level, event, fields }),
    isEnabled: () => true,
  }
}

// 执行器卡住、连取消都不理：promise 永不落地，用来模拟「进程起了但不回话」。
const hangExec = (): Promise<never> => new Promise(() => {})
// 数一数到底起过几次进程：冷却期间这一格必须保持 0。
function countingOk(store: { spawns: number }): any {
  return async () => { store.spawns += 1; return { stdout: '', stderr: '', code: 0 } }
}

async function main(): Promise<void> {
  const { createGhAdmission, setGhLaneLogCtx, isAdmissionCancelled } = await imp('src/refresh/rooms/host/outbound-admission.ts')
  const tiers = await imp('src/tracker/kernel/outbound-tiers.ts')
  const { outboundCooldownOf } = tiers
  // 全局的日志出口只给「自建闸」用：设一次，收集 gh.transport；结束时清掉，不影响别人。
  const transportEvents: any[] = []
  setGhLaneLogCtx({ fire: (level: string, event: string, fields: any) => transportEvents.push({ level, event, fields }), isEnabled: () => true })

  // —— 一、闸自己：失败设冷却、冷却拒人、成功清零；正常路径一个事件都不多记 ——
  {
    const lane = createGhAdmission({ readMax: 2, writeMax: 1, cooldownMs: 5000 })
    const before = transportEvents.length
    lane.reportTransportFailure({ bucket: 'read', reason: 'timeout', cmd: 'issue:list' })
    const setEvt = transportEvents[transportEvents.length - 1]
    check(setEvt && setEvt.event === 'gh.transport' && setEvt.fields.decision === 'cooldown-set', '一、一次 transport 失败会设冷却（gh.transport decision=cooldown-set）', JSON.stringify(setEvt))
    check(setEvt && setEvt.fields.bucket === 'read' && setEvt.fields.reason === 'timeout' && setEvt.fields.failStreak === 1 && setEvt.fields.cmd === 'issue:list', '一、冷却轨迹带桶名、原因、连续失败次数与命令短标签', JSON.stringify(setEvt && setEvt.fields))
    check(setEvt && typeof setEvt.fields.remainingMs === 'number' && setEvt.fields.remainingMs > 0, '一、冷却轨迹带剩余毫秒（不是一句笼统的限时）', JSON.stringify(setEvt && setEvt.fields))

    const firstReject: any = await lane.acquire({ bucket: 'read', cmd: 'issue:get' }).then(() => null, (e: any) => e)
    const info = outboundCooldownOf(firstReject)
    check(!!info && info.bucket === 'read' && info.reason === 'timeout' && info.failStreak === 1, '一、冷却窗口里拿名额被拒，错误带得出桶与上次原因', JSON.stringify(info))
    const rejectEvt = transportEvents.filter((e) => e.event === 'gh.transport' && e.fields.decision === 'reject-cooling')
    check(rejectEvt.length === 1, '一、被冷却挡回也留一行轨迹（先只记第一笔，避免面板刷屏）', String(rejectEvt.length))
    const secondReject: any = await lane.acquire({ bucket: 'read' }).then(() => null, (e: any) => e)
    check(!!outboundCooldownOf(secondReject), '一、冷却没走完之前，后续调用继续被拒（不会起进程）')
    const rejectAgain = transportEvents.filter((e) => e.event === 'gh.transport' && e.fields.decision === 'reject-cooling')
    check(rejectAgain.length === 1, '一、同一轮冷却只记第一笔被挡回的轨迹', String(rejectAgain.length))

    const w = await lane.acquire({ bucket: 'write' })
    check(typeof w === 'function', '一、读桶冷却不该拦住写桶（两档各管各的）')
    w()

    lane.reportSuccess({ bucket: 'read' })
    const cleared = transportEvents[transportEvents.length - 1]
    check(cleared && cleared.event === 'gh.transport' && cleared.fields.decision === 'cooldown-cleared', '一、拿到退出码后冷却立刻清零（gh.transport decision=cooldown-cleared）', JSON.stringify(cleared))
    const afterClear = await lane.acquire({ bucket: 'read' })
    check(typeof afterClear === 'function', '一、清零之后立刻能拿名额（不等到窗口过期）')
    afterClear()

    const mark = transportEvents.length
    lane.reportSuccess({ bucket: 'write' })
    lane.reportSuccess({ bucket: 'read' })
    await lane.acquire({ bucket: 'read' })
    check(transportEvents.length === mark, '一、本来就没冷却时，成功与正常拿名额都不多记事件', String(transportEvents.length - mark))

    // 冷却按时间过期：到点之后自然放行（失败退避不会永久封路）。
    const lane2 = createGhAdmission({ readMax: 2, writeMax: 1, cooldownMs: 60 })
    lane2.reportTransportFailure({ bucket: 'read', reason: 'killed' })
    await wait(90)
    const expired = await lane2.acquire({ bucket: 'read' })
    check(typeof expired === 'function', '一、冷却窗口走完自然放行，不需要再报一次成功')
    expired()
  }
  transportEvents.length = 0

  // —— 一·B、冷却按「服务 + 读写档」分开（#1007 复核）：GitHub 的通路故障不许挡住 GitLab / git ——
  {
    const lane = createGhAdmission({ readMax: 1, writeMax: 1, cooldownMs: 60000 })
    lane.reportTransportFailure({ bucket: 'read', reason: 'timeout', cmd: 'issue:list', service: 'github' })
    const ghBlocked: any = await lane.acquire({ bucket: 'read' }).then(() => null, (e: any) => e)
    check(!!outboundCooldownOf(ghBlocked), '一·B、GitHub 的通路失败只挡 GitHub（缺省服务按 github 算）', JSON.stringify(outboundCooldownOf(ghBlocked)))
    const glab = await lane.acquire({ bucket: 'read', service: 'gitlab' })
    check(typeof glab === 'function', '一·B、同一只读桶里，GitLab 的调用不被 GitHub 的冷却挡住')
    glab()
    const git = await lane.acquire({ bucket: 'read', service: 'git' })
    check(typeof git === 'function', '一·B、git 的调用也不被 GitHub 的冷却挡住')
    git()
    const writeOk = await lane.acquire({ bucket: 'write' })
    check(typeof writeOk === 'function', '一·B、GitHub 的读档冷却不跨到写档（服务与档位各记各的）')
    writeOk()

    // 别的服务成功清零时，不能把 GitHub 的冷却一起清掉。
    lane.reportSuccess({ bucket: 'read', service: 'gitlab' })
    const ghStill: any = await lane.acquire({ bucket: 'read' }).then(() => null, (e: any) => e)
    check(!!outboundCooldownOf(ghStill), '一·B、GitLab 的成功不清 GitHub 的冷却（两条路各清各的）')
    lane.reportSuccess({ bucket: 'read' })
    const ghOk = await lane.acquire({ bucket: 'read' })
    check(typeof ghOk === 'function', '一·B、GitHub 自己的成功只清自己那条冷却')
    ghOk()

    // 冷却设上时只拒绝同一条通路上排队的：另一条路的排队者不该被掀掉。
    const lane2 = createGhAdmission({ readMax: 1, writeMax: 1, cooldownMs: 60000 })
    const held = await lane2.acquire({ bucket: 'read' })
    const glabWaiter = lane2.acquire({ bucket: 'read', service: 'gitlab' })
    const ghWaiter: any = lane2.acquire({ bucket: 'read' }).then(() => null, (e: any) => e)
    lane2.reportTransportFailure({ bucket: 'read', reason: 'killed', cmd: 'issue:get', service: 'github' })
    const ghWaiterErr = await ghWaiter
    check(!!outboundCooldownOf(ghWaiterErr), '一·B、冷却设上时同一条通路上排队的调用立刻被拒（不等分档超时）')
    held()
    const glabRelease = await glabWaiter
    check(typeof glabRelease === 'function', '一·B、另一条通路上排队的调用不被这条路的故障一起掀掉')
    glabRelease()
  }
  transportEvents.length = 0

  // —— 二、房内掐表 + 冷却快速失败：读档 ——
  {
    const lane = createGhAdmission({ readMax: 2, writeMax: 1, cooldownMs: 60000 })
    const roomEvents: any[] = []
    const client = (await imp('src/tracker/rooms/github/client.ts')).ghClient(roomCtx(roomOutbound(lane), hangExec, roomEvents))

    const t0 = Date.now()
    const r1 = await client.execGh(['issue', 'list'], { cwd: '.', timeout: 150 })
    const took = Date.now() - t0
    check(r1 && r1.ok === false && r1.error && r1.error.timedOut === true && r1.error.cancelled !== true, '二、执行器不回来时房内到点返回超时，不混进「被取消」', JSON.stringify(r1 && r1.error))
    check(took < 2000, '二、到点就返回，不等外层钳制', '实耗 ' + took + 'ms')
    const timeoutEvt = roomEvents.find((e) => e.event === 'gh.timeout')
    check(!!timeoutEvt && timeoutEvt.fields.layer === 'room-tier' && timeoutEvt.fields.cmd === 'issue:list' && timeoutEvt.fields.phase === 'inflight', '二、gh.timeout 写明是房内那一层、哪条命令、到点在执行段', JSON.stringify(timeoutEvt && timeoutEvt.fields))
    check(/issue:list/.test(r1.error.message) && /房内分档表/.test(r1.error.message) && /读操作/.test(r1.error.message) && /可以直接重试/.test(r1.error.message), '二、超时回话带命令名与「读可重试」的后续动作', String(r1.error.message).slice(0, 240))
    const execEvt = roomEvents.find((e) => e.event === 'gh.exec')
    check(!!execEvt && execEvt.fields.cmd === 'issue:list' && typeof execEvt.fields.latencyMs === 'number', '四、gh.exec 记出子命令与真实耗时', JSON.stringify(execEvt && execEvt.fields))

    // 冷却期间再调：一次进程都不许起，并且立刻回「通路不通」。
    const store = { spawns: 0 }
    const client2 = (await imp('src/tracker/rooms/github/client.ts')).ghClient(roomCtx(roomOutbound(lane), countingOk(store), roomEvents))
    const t1 = Date.now()
    const r2 = await client2.execGh(['issue', 'list'], { cwd: '.', timeout: 5000 })
    const took2 = Date.now() - t1
    check(r2 && r2.ok === false && r2.error && r2.error.cancelled !== true && r2.error.timedOut !== true, '二、冷却期间返回的是失败但不是超时/取消', JSON.stringify(r2 && r2.error))
    check(store.spawns === 0, '二、冷却期间一条进程都没起', String(store.spawns))
    check(took2 < 1000, '二、冷却期间瞬时返回，不再赔满一次超时', '实耗 ' + took2 + 'ms')
    check(/通路现在不通/.test(r2.error.message) && /issue:list/.test(r2.error.message) && /没有起进程/.test(r2.error.message), '二、回话说清是「通路不通」并带命令名，不是笼统限时', String(r2.error.message).slice(0, 240))
    check(/可以直接重试/.test(r2.error.message), '四、读档的后续动作写死为「可以直接重试」', String(r2.error.message).slice(0, 240))
    const rejectEvt = transportEvents.find((e) => e.event === 'gh.transport' && e.fields.decision === 'reject-cooling')
    check(!!rejectEvt && rejectEvt.fields.bucket === 'read', '二、冷却拒绝落进常驻轨迹（gh.transport）', JSON.stringify(rejectEvt && rejectEvt.fields))
  }

  // —— 三、写档的后续动作与读档分得开 ——
  {
    const lane = createGhAdmission({ readMax: 2, writeMax: 1, cooldownMs: 60000 })
    lane.reportTransportFailure({ bucket: 'write', reason: 'killed', cmd: 'issue:create' })
    const store = { spawns: 0 }
    const roomEvents: any[] = []
    const client = (await imp('src/tracker/rooms/github/client.ts')).ghClient(roomCtx(roomOutbound(lane), countingOk(store), roomEvents))
    const r = await client.execGh(['issue', 'create', '--title', 'x'], { cwd: '.', timeout: 5000 })
    check(r && r.ok === false && store.spawns === 0, '四、写档冷却期间同样不起进程', JSON.stringify(r && r.error))
    check(/这一笔写操作没有确认结果/.test(r.error.message) && /核对票面现状/.test(r.error.message) && /不要直接重放/.test(r.error.message), '四、写档的后续动作写死为「先核对现状、不直接重放」', String(r.error.message).slice(0, 260))
  }

  // —— 四、第一次成功立刻清零；正常时一条命令只起一次进程 ——
  {
    const lane = createGhAdmission({ readMax: 2, writeMax: 1, cooldownMs: 150 })
    const roomEvents: any[] = []
    const client = (await imp('src/tracker/rooms/github/client.ts')).ghClient(roomCtx(roomOutbound(lane), hangExec, roomEvents))
    await client.execGh(['issue', 'list'], { cwd: '.', timeout: 80 })
    await wait(180)
    const store = { spawns: 0 }
    const okClient = (await imp('src/tracker/rooms/github/client.ts')).ghClient(roomCtx(roomOutbound(lane), countingOk(store), roomEvents))
    const ok = await okClient.execGh(['issue', 'list'], { cwd: '.', timeout: 5000 })
    check(ok && ok.ok === true && store.spawns === 1, '三、冷却窗口过去后第一条成功命令正常执行（起一次进程）', JSON.stringify(ok))
    const clearedEvt = transportEvents.filter((e) => e.event === 'gh.transport' && e.fields.decision === 'cooldown-cleared')
    check(clearedEvt.length >= 1, '三、第一条成功命令把冷却立刻清零', String(clearedEvt.length))
    const mark = transportEvents.filter((e) => e.event === 'gh.transport').length
    const ok2 = await okClient.execGh(['issue', 'list'], { cwd: '.', timeout: 5000 })
    check(ok2 && ok2.ok === true && store.spawns === 2, '三、通路正常时每条命令各起一次进程', String(store.spawns))
    check(transportEvents.filter((e) => e.event === 'gh.transport').length === mark, '三、通路正常时不额外多记 gh.transport 事件', String(transportEvents.filter((e) => e.event === 'gh.transport').length - mark))
  }

  // —— 五、宿主两路也接上了这只闸与本票的回话口径（静态看接线，运行行为由 verify-969 等门禁看）——
  {
    const fs = require('fs')
    const ghExecSrc = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/gh-execution.ts'), 'utf8')
    check(/host-queue/.test(ghExecSrc) && /phase:\s*'queue'/.test(ghExecSrc), '五、宿主 runGh 的排队段单独计时（gh.timeout layer=host-queue）', '')
    check(/reportGhRunOutcome/.test(ghExecSrc) && /reportTransportFailure/.test(ghExecSrc) && /reportSuccess/.test(ghExecSrc), '五、宿主 runGh 的结局回写给同一只准入桶', '')
    const platSrc = fs.readFileSync(path.join(ROOT, 'src/host/platformChannel.ts'), 'utf8')
    // 回话与上报的共用口径住在 tracker/kernel/outbound-tiers.ts（宿主不能新建指向刷新房或宿主兄弟文件的边）。
    const reportSrc = fs.readFileSync(path.join(ROOT, 'src/tracker/kernel/outbound-tiers.ts'), 'utf8')
    check(/ghCooldownReply/.test(platSrc) && /outboundCooldownOf/.test(reportSrc) && /通路现在不通/.test(reportSrc), '五、平台通道的探测出口经共享口径把冷却翻译成「通路不通」', '')
    check(/waitMs:\s*deIsGh\s*\?\s*queueTimeoutForTier/.test(platSrc), '五、平台通道的探测出口把 gh 的排队预算递给闸（glab 不设上限）', '')
    const admSrc = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/outbound-admission.ts'), 'utf8')
    check(/gh\.transport/.test(admSrc) && /admission-cooldown/.test(admSrc), '五、准入闸里有常驻的冷却轨迹与冷却错误标记', '')
    // 排队上限只在 YAML 里有一处定义；#1570 起「到点由闸抛排队超时、归还晚到名额」住在闸里，出口只递预算。
    const yamlSrc = fs.readFileSync(path.join(ROOT, 'config/timeouts.yaml'), 'utf8')
    check(/ghQueueWaitTimeoutMs:\s*10000/.test(yamlSrc), '五、排队上限在 config/timeouts.yaml 里有一处定义（10000 毫秒）', '')
    const tiersSrc = fs.readFileSync(path.join(ROOT, 'src/tracker/kernel/outbound-tiers.ts'), 'utf8')
    check(/queueTimeoutForTier/.test(tiersSrc) && /GH_QUEUE_WAIT_TIMEOUT_MS/.test(tiersSrc) && /queueTimeoutForTier/.test(ghExecSrc) && /waitMs/.test(ghExecSrc), '五、排队上限来自中央配置，宿主 runGh 只把预算递给闸', '')
    // #1007 复核：三条出站通道拿名额时都要报服务名，GitHub 的通路故障才不会挡住 GitLab 与 git。
    check(/service:\s*deIsGh\s*\?\s*'github'\s*:\s*'gitlab'/.test(platSrc), '五、平台通道按 gh / glab 分别报服务名（GitHub 冷却不挡 glab）', '')
    const gitExecSrc = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/git-execution.ts'), 'utf8')
    check(/service:\s*xpIsGh\s*\?\s*'github'\s*:\s*'gitlab'/.test(gitExecSrc), '五、自建操作上下文的 execProc 按 gh / glab 分别报服务名（GitHub 冷却不挡 glab）', '')
    check(/waitMs:\s*xpIsGh\s*\?\s*queueTimeoutForTier/.test(gitExecSrc), '五、execProc 把 gh 的排队预算递给闸（glab 不设上限）', '')
    const vcSrc = fs.readFileSync(path.join(ROOT, 'src/host/versionControl.ts'), 'utf8')
    check(/withGhLane\(\{[^}]*service:\s*'git'/.test(vcSrc), '五、本地 git 命令拿名额时报 service=git（GitHub 冷却不挡 git）', '')
    const ctlSrc = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/outbound-control.ts'), 'utf8')
    check((ctlSrc.match(/service/g) || []).length >= 3, '五、出站控制面把调用方报的服务名原样转给准入闸', '')
  }

  // —— 六、排队上限只在闸里执行：到点抛可辨认错误、迟到名额不泄漏、取消与到点分得开（#1570）——
  {
    const { GH_QUEUE_WAIT_TIMEOUT_MS } = await imp('src/shared/time-config/src/values.js')
    const { outboundQueueTimeoutOf, queueTimeoutForTier } = tiers
    check(queueTimeoutForTier(12000) === GH_QUEUE_WAIT_TIMEOUT_MS && GH_QUEUE_WAIT_TIMEOUT_MS === 10000 && queueTimeoutForTier(1500) === 1500, '六、排队上限取「本档预算」与「中央配置」更小的那个（不把整档预算花在排队上）', String(queueTimeoutForTier(12000)) + ' / ' + String(queueTimeoutForTier(1500)))

    // 用可手动触发的表测到点：不睡真实时间，也不依赖机器快慢。
    const pending: any[] = []
    const timers = {
      setTimeout: (fn: () => void, ms: number) => { const h: any = { fn: fn, ms: ms, cleared: false }; pending.push(h); return h },
      clearTimeout: (h: any) => { if (h) h.cleared = true },
    }
    const lane = createGhAdmission({ readMax: 1, writeMax: 1, timers: timers })
    const releaseHeld = await lane.acquire({ bucket: 'read' })
    let queueErr: any = null
    const queued = lane.acquire({ bucket: 'read', waitMs: 250 }).then(() => 'got', (e: any) => { queueErr = e; return 'rejected' })
    check(pending.length === 1 && pending[0].ms === 250, '六、给了预算才建表：排队时按「最多等多久」起一只表', JSON.stringify(pending.map((h) => h.ms)))
    pending[0].fn()
    const outcome = await queued
    check(outcome === 'rejected' && !!outboundQueueTimeoutOf(queueErr), '六、到点由闸抛可辨认的「排队超时」，调用方靠 kernel 的判定函数认出来', JSON.stringify(queueErr && queueErr.code))
    const qInfo = outboundQueueTimeoutOf(queueErr)
    check(!!qInfo && qInfo.bucket === 'read' && qInfo.limitMs === 250 && qInfo.waitedMs >= 0, '六、排队超时错误带桶名、预算与已等毫秒', JSON.stringify(qInfo))
    // 这一笔没有拿过名额，也没把名额弄丢：放掉占位后下一笔立刻能进。
    releaseHeld()
    const nextRel: any = await Promise.race([lane.acquire({ bucket: 'read' }), wait(1000).then(() => 'stuck')])
    check(typeof nextRel === 'function', '六、排队到点后名额没有泄漏（放掉占位，下一笔立刻拿到）', String(nextRel))
    if (typeof nextRel === 'function') nextRel()
    check(lane.snapshot().readQueueTimedOut === 1, '六、排队到点单独计数，不混进取消或成功', String(lane.snapshot().readQueueTimedOut))

    // 取消与排队到点分得开：取消按取消返回，那只表被撤掉、不算到点。
    const releaseHeld2 = await lane.acquire({ bucket: 'read' })
    const ctl = new AbortController()
    let cancelErr: any = null
    const queued2 = lane.acquire({ bucket: 'read', waitMs: 250, signal: ctl.signal }).then(() => 'got', (e: any) => { cancelErr = e; return 'rejected' })
    const timedOutBefore = lane.snapshot().readQueueTimedOut
    ctl.abort()
    const outcome2 = await queued2
    check(outcome2 === 'rejected' && isAdmissionCancelled(cancelErr) && !outboundQueueTimeoutOf(cancelErr), '六、取消仍按取消返回，不算排队到点', String(cancelErr && cancelErr.code))
    const cancelTimer = pending[pending.length - 1]
    check(!!cancelTimer && cancelTimer.cleared === true, '六、取消后排队那只表被撤掉（不会稍后误杀）', JSON.stringify({ cleared: cancelTimer && cancelTimer.cleared }))
    check(lane.snapshot().readQueueTimedOut === timedOutBefore, '六、排队到点计数不因取消而增加', String(lane.snapshot().readQueueTimedOut))
    releaseHeld2()

    // 没给预算就不设上限：不建表，放掉占位后照常拿到（既有调用方行为不变）。
    const lane2 = createGhAdmission({ readMax: 1, writeMax: 1, timers: timers })
    const hold2 = await lane2.acquire({ bucket: 'read' })
    const pendingBefore = pending.length
    const waitOnly = lane2.acquire({ bucket: 'read' }).then(() => 'ok')
    check(pending.length === pendingBefore, '六、缺省不给预算时不设上限（排队不建表，与既有调用方兼容）', String(pending.length - pendingBefore))
    hold2()
    const gotWait = await Promise.race([waitOnly, wait(1000).then(() => 'stuck')])
    check(gotWait === 'ok', '六、不设上限的排队在名额回来时照常放行', String(gotWait))
  }

  setGhLaneLogCtx(null)
  const transportOnly = transportEvents.filter((e: any) => e.event === 'gh.transport')
  check(transportOnly.length >= 2 && transportOnly.every((e: any) => Object.keys(e.fields).every((k) => ['decision', 'bucket', 'reason', 'remainingMs', 'failStreak', 'cmd'].indexOf(k) >= 0)), '五、gh.transport 只记枚举、数字与命令短标签（字段都在白名单内，不记命令原文）', JSON.stringify(transportOnly.slice(0, 2)))
  // 闸自身的排队轨迹不许换名夹带：除 gh.transport 外只允许排队饱和/排队等待两种。
  const otherEvents = transportEvents.filter((e: any) => e.event !== 'gh.transport')
  check(otherEvents.every((e: any) => e.event === 'gh.lane.saturated' || e.event === 'gh.lane.wait'), '五、闸的排队轨迹只有饱和与等待两种，不夹带别的日志', JSON.stringify(otherEvents.map((e: any) => e.event).slice(0, 5)))
  console.log('\n共 ' + total + ' 项，' + (failed ? '有失败' : '全部通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
