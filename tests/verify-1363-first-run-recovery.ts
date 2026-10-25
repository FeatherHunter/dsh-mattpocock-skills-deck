// tests/verify-1363-first-run-recovery.ts —— 门禁：全新工作区的横幅要出现、初始化做完后要自己消失（#1363 / #1220 / #891）。
//
// 用户看到的两幕：
//   一、全新工作区选定后端之后，状态栏既不出黄条、右侧面板还写着「未识别仓库」——其实后端已经选上了，
//      只是选完那一次重取链没有带「人刚做的动作」这个触发名，被宿主的退避当成后台刷新挡了回去，
//      拿回的还是选之前那份旧快照；旧快照里没有仓库那一行，横幅的判据就整条都不显示。
//   二、Markdown 工作区按提示做完初始化，黄条一直不消失——初始化的产物是会话里写文件，检查链没有对应事件，
//      只能靠正在看时那条 5 秒节拍反复重算；而客户端那片 timer 包装从前没有转发 interval，
//      节拍从来没排上过（真机日志 probe.loop 全是 no-timer）。
//
// 本门禁量四件事（都是跑起来的结果，不读源码里有没有某个字）：
//   A. hostShim 的 timer 包装真的转发了 interval：宿主有 interval 用宿主的、撤销能撤掉；
//      宿主没有退回页面自己那一档，也撤得掉。
//   B. chainBackoff 对 'setup-pending' 这一路的等待封顶：等满 15 秒无条件真算一次；
//      同一个时刻换别的后台触发名仍然按退避等；人手重查照旧无条件算。
//   C. probe-auto 的活跃节拍真的排得上：宿主有 interval 时按宿主给的间隔排、隔变要重排；
//      宿主没有时如实记 no-timer 且不排；排上之后每一拍会带 'setup-pending' 让链重算（#891 的接线）。
//   D. 显示层的判定本身认得出两幕：选完后端拿回的还是选之前那份旧快照（里面没有仓库那一行）时，
//      不再一条都不出，而是出中性提示条；初始化与技能都做完后一条都不出。这是「黄条该出现时出现、
//      该消失时消失」的最后一跳，此前没有门禁直接喂快照给它。
//
// 门禁归属: src/client/hostShim.ts
// 门禁归属: src/client/statusbar/StatusBar.ts
// 门禁归属: src/client/statusbar/bannerChain.ts
// 门禁归属: src/refresh/rooms/client/refresh-timer.ts
// 门禁归属: src/refresh/rooms/client/client-attention-heartbeat.ts
// 门禁归属: src/refresh/rooms/host/chain-backoff.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1363-first-run-recovery.ts
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourceText } from './lib/source-text.ts'
import { CHAIN_SETUP_PENDING_CAP_MS } from '../src/shared/time-config/values.js'
import { guideStepsFor, guideStepDone, guideBannerOf, guideMissingOf } from '../src/shared/tracker/guide-steps.js'

let failed = false
let total = 0
const check = function (ok: any, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const sleep = function (ms: number): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

// ---------------------------------------------------------------------------------------------
// A. hostShim 的 timer 包装：interval 这一档在不在、撤销能不能撤掉
// ---------------------------------------------------------------------------------------------
const partA = function (): void {
  console.log('#1363 A. hostShim 转发了 interval，撤销按宿主句柄形状走')
  const shimSrc = spliceableJs('src/client/hostShim.js')
  check(/interval:\s*function\s*\(fn, ms\)/.test(shimSrc), 'hostShim 上挂着 interval 这一档（排 5 秒节拍的人靠它）')
  const body = shimSrc.replace(/^[ \t]*export /gm, '')
  const makeShim = function (rawTimer: any): any {
    return compileFn(['ctx', 'React'], body + '\n; return { timer: timer, _timerRaw: _timerRaw }')({ get: function (): any { return rawTimer } }, { createElement: function (): any { return null } })
  }
  const makeService = function (withInterval: boolean): any {
    const pending: any[] = []
    const service: any = {
      timeout: function (fn: any): any { pending.push(fn); return function cancel(): void { const i = pending.indexOf(fn); if (i >= 0) pending.splice(i, 1) } },
    }
    if (withInterval) service.interval = service.timeout
    return { service: service, pending: pending }
  }

  // A1. 宿主有 interval：用宿主那一档，交回可调用撤销器，clearTimeout 真能撤掉。
  const hostA = makeService(true)
  const modA = makeShim(hostA.service)
  let firedA = 0
  const hA = modA.timer.interval(function (): void { firedA += 1 }, 5000)
  check(hostA.pending.length === 1, '宿主有 interval 时这一档交给宿主排（实得悬着 ' + hostA.pending.length + ' 笔）')
  check(typeof hA === 'function' && hA.dispose === undefined, '交回的是宿主真形状：可调用、没有 dispose 的撤销器（实得 ' + typeof hA + '）')
  check(hostA.service.interval === hostA.service.timeout, '（这一段用的假宿主把 interval 与 timeout 记在同一本账上，便于数笔数）')
  firedA = 0
  modA.timer.clearTimeout(hA)
  check(hostA.pending.length === 0, 'clearTimeout 走「可调用就调它本身」把宿主那一笔撤掉了（实得还悬着 ' + hostA.pending.length + ' 笔）')

  // A2. 宿主没有 interval：退回页面自己那一档，也撤得掉。
  const hostB = makeService(false)
  const modB = makeShim(hostB.service)
  let firedB = 0
  const hB = modB.timer.interval(function (): void { firedB += 1 }, 20)
  check(hB !== null && hB !== undefined && typeof hB !== 'function', '宿主没有 interval 时退回页面自己的 setInterval，交回非函数句柄（实得 ' + typeof hB + '）')
  modB.timer.clearTimeout(hB)

  // A3. 撤销改成「先走 timer.clearTimeout」的那两处（宿主句柄是可调用撤销器，全局 clearInterval 对它空操作）。
  const beatSrc = sourceText('src/refresh/rooms/client/client-attention-heartbeat.js')
  check(/timer\.clearTimeout\(/.test(beatSrc), 'attention-heartbeat 撤销心跳走 timer.clearTimeout（全局 clearInterval 撤不掉宿主句柄）')
  const probeSrc = sourceText('src/refresh/rooms/client/refresh-timer.js')
  check(/timer\.clearTimeout\(shared\._activeTimer\)/.test(probeSrc), 'probe-auto 重排节拍前先走 timer.clearTimeout 撤旧句柄')
}

// ---------------------------------------------------------------------------------------------
// B. chainBackoff：初始化等待这一路的等待封顶
// ---------------------------------------------------------------------------------------------
const partB = async function (): Promise<void> {
  console.log('#1363 B. setup-pending 等满封顶就无条件重算，别的后台触发名与手人重查口径不变')
  check(CHAIN_SETUP_PENDING_CAP_MS === 15000, '封顶值来自中央配置 config/timeouts.yaml 的 chainSetupPendingCapMs（实得 ' + CHAIN_SETUP_PENDING_CAP_MS + '）')
  const mod = await import('../src/refresh/rooms/host/chain-backoff.js')
  const cb = mod.createChainBackoff({ logCtx: { fire: function (): void {}, isEnabled: function (): boolean { return false } } })
  const t0 = 1700000000000
  const snap = { steps: [{ id: 'a', status: 'done' }, { id: 'b', status: 'pending' }] }
  const fullReply = { ok: true, snapshot: snap }
  await cb.note('k1363', snap, t0, fullReply)
  await cb.note('k1363', snap, t0, fullReply) // 没进展：档位从 0 升到 1
  await cb.note('k1363', snap, t0, fullReply) // 没进展：升到 2（下一次按退避要等 120 秒）
  const before = await cb.verdict('k1363', t0 + CHAIN_SETUP_PENDING_CAP_MS - 1, { trigger: 'setup-pending' })
  check(before.needed === false, '还没等满封顶时照旧按退避等（实得 needed=' + before.needed + '，原因 ' + before.reason + '）')
  const atCap = await cb.verdict('k1363', t0 + CHAIN_SETUP_PENDING_CAP_MS, { trigger: 'setup-pending' })
  check(atCap.needed === true && atCap.reason === 'setup-pending-cap', '等满封顶就真算一次（实得 needed=' + atCap.needed + '，原因 ' + atCap.reason + '）')
  const otherAtCap = await cb.verdict('k1363', t0 + CHAIN_SETUP_PENDING_CAP_MS, { trigger: 'event' })
  check(otherAtCap.needed === false, '同一个时刻换别的后台触发名仍然按退避等（封顶只给初始化那一路，实得 needed=' + otherAtCap.needed + '）')
  const humanAtCap = await cb.verdict('k1363', t0 + CHAIN_SETUP_PENDING_CAP_MS, { trigger: 'user-recheck' })
  check(humanAtCap.needed === true && humanAtCap.reason === 'user-recheck-bypass', '人手重查照旧无条件真算（实得 needed=' + humanAtCap.needed + '，原因 ' + humanAtCap.reason + '）')
  const fresh = await cb.verdict('k1363-empty', t0, { trigger: 'setup-pending' })
  check(fresh.needed === true, '这个键上一份快照都没有时直接算（首屏不许被退避拦住，实得 needed=' + fresh.needed + '，原因 ' + fresh.reason + '）')
}

// ---------------------------------------------------------------------------------------------
// C. probe-auto 的活跃节拍：排得上、按宿主间隔、每拍带 setup-pending 让链重算
// ---------------------------------------------------------------------------------------------
const loadSpliced = function (relPath: string, exportNames: string[], scope: Record<string, any>): any {
  const paramNames = Object.keys(scope)
  const fn = compileFn(paramNames, spliceableJs(relPath) + '\nreturn { ' + exportNames.join(', ') + ' }')
  return fn.apply(null, paramNames.map(function (k) { return scope[k] }))
}

const partC = async function (): Promise<void> {
  console.log('#1363 C. 活跃节拍真的排上了，并且每一拍会把「初始化还在等」这条带去让链重算')
  const noop = function (): void {}
  const makeProbe = function (withInterval: boolean): any {
    const logs: any[] = []
    const intervals: number[] = []
    const revokeCalls: any[] = []
    const firedSteps: any[] = []
    const triggers: any[] = []
    const tickHandles: any[] = []
    const timer: any = { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) } }
    if (withInterval) timer.interval = function (fn: any, ms: number): any { intervals.push(ms); firedSteps.push(fn); return function cancel(): void { revokeCalls.push(fn) } }
    timer.clearTimeout = function (h: any): void { revokeCalls.push(h); try { if (typeof h === 'function') h() } catch (e) {} }
    const scope: Record<string, any> = {
      SYNC: null,
      SYNC_FALLBACK_PROBE_MS: 60000, SYNC_FOCUS_PROBE_MIN_MS: 60000,
      SYNC_SNAP_FRESH_MS: 60000, PROBE_AUTO_WAIT_MS: 50,
      host: { call: function (): any { return Promise.resolve({ ok: false }) } },
      _attentionPlan: { intervalMs: 5000, standing: 'active' },
      shared: { cwd: 'D:\\ws1363', sessionId: 'sess-1363', snapshot: null },
      stores: {},
      wsKeyOf: function (x: any): string { return String(x || '') },
      keyOf: function (x: any): string { return String(x || '') },
      log: function (level: any, event: any, fields: any): void { logs.push({ level: level, event: event, fields: fields }) },
      isEnabled: function (): boolean { return false },
      dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
      dswsLogTrunc: function (s: any): string { return String(s || '').slice(0, 120) },
      touchProbeAt: noop,
      emit: noop,
      diffSnapshots: function (): any { return { added: [], changed: [], removed: [], issueFlash: {} } },
      scheduleFlashClear: noop,
      loadSnapshot: function (): any { return Promise.resolve() },
      hydrateFromCache: function (): boolean { return false },
      snapshotWithoutWorkRoute: function (s: any): any { return s },
      ensureOwnWorkRoute: noop,
      chainEventRefresh: function (st: any, trigger: any): any { triggers.push(trigger); return Promise.resolve(null) },
      loadChain: function (): any { return Promise.resolve(null) },
      setupPendingOf: function (): boolean { return true },
      attentionVisible: function (): boolean { return true },
      attentionStoreOf: function (): any { return { cwd: 'D:\\ws1363', chainSnapshot: null } },
      // #1418 P1：探测范围与降档搬到 client-attention-heartbeat.ts 了（本门禁只量节拍接线，
      //   这两件事给桩就行）：探主会话那个目录，回复不记账。
      probeTargetNow: function (): any { return 'D:\\ws1363' },
      noteProbeReply: noop,
      namingGuardianEvent: noop,
      applySnapshotSelection: noop,
      flash: noop,
      tr: function (k: any): string { return String(k) },
      timer: timer,
      document: undefined, window: undefined,
    }
    const mod = loadSpliced('src/refresh/rooms/client/refresh-timer.js', ['startActiveProbeLoop'], scope)
    return { mod: mod, scope: scope, logs: logs, intervals: intervals, revokeCalls: revokeCalls, firedSteps: firedSteps, triggers: triggers, timer: timer }
  }

  // C1. 宿主有 interval：按它给的间隔排上，并且记一行 scheduled（调试开关关着也落盘）。
  const ok = makeProbe(true)
  ok.mod.startActiveProbeLoop()
  check(ok.intervals.length === 1 && ok.intervals[0] === 5000, '按宿主给的 5000ms 排上了活跃节拍（实得 ' + JSON.stringify(ok.intervals) + '）')
  check(ok.scope.shared._activeTimer !== undefined && ok.scope.shared._activeTimer !== null, '把节拍句柄记在 shared._activeTimer 上（重排时要能撤它）')
  const scheduled = ok.logs.filter(function (l: any): boolean { return l.event === 'probe.loop' && l.fields && l.fields.reason === 'scheduled' })
  check(scheduled.length === 1 && scheduled[0].level === 'info' && scheduled[0].fields.timerOk === true, '常驻记一行 probe.loop reason=scheduled、timerOk=true（实得 ' + JSON.stringify(scheduled) + '）')

  // C2. 间隔变了要重排：旧句柄先撤（走 timer.clearTimeout），新间隔重新排。
  ok.scope._attentionPlan.intervalMs = 15000
  ok.mod.startActiveProbeLoop()
  check(ok.revokeCalls.length >= 1, '重排前先撤了旧句柄（否则两个节拍并行跑，实得撤销调用 ' + ok.revokeCalls.length + ' 次）')
  check(ok.intervals.length === 2 && ok.intervals[1] === 15000, '按新间隔重排一次（实得 ' + JSON.stringify(ok.intervals) + '）')

  // C3. 每一拍：初始化还在等时，带 'setup-pending' 让链重算一次（#891 的接线就挂在这条节拍上）。
  const step = ok.firedSteps[ok.firedSteps.length - 1]
  step()
  await sleep(5)
  check(ok.triggers.indexOf('setup-pending') >= 0, '节拍跑起来时带 setup-pending 叫链重算（实得触发 ' + JSON.stringify(ok.triggers) + '）')

  // C4. 宿主没有 interval：如实记 no-timer，并且什么都不排（这就是真机上「自动重算从没跑过」那一步）。
  const no = makeProbe(false)
  no.mod.startActiveProbeLoop()
  check(no.intervals.length === 0, '宿主没有 interval 时一笔都不排（实得 ' + no.intervals.length + ' 笔）')
  const noTimer = no.logs.filter(function (l: any): boolean { return l.event === 'probe.loop' && l.fields && l.fields.reason === 'no-timer' })
  check(noTimer.length === 1 && noTimer[0].fields.timerOk === false, '常驻记一行 probe.loop reason=no-timer、timerOk=false（实得 ' + JSON.stringify(noTimer) + '）')
}

// ---------------------------------------------------------------------------------------------
// D. 显示层：直接把链快照喂给判定函数，量两幕里「该出哪一条」这个结论本身
// ---------------------------------------------------------------------------------------------
const partD = function (): void {
  console.log('#1363 D. 显示层认得出「快照缺了挡路那一行」，两幕该出的横幅都判得出来')
  const scope: Record<string, any> = {
    guideStepsFor: guideStepsFor,
    guideStepDone: guideStepDone,
    guideBannerOf: guideBannerOf,
    guideMissingOf: guideMissingOf,
    dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
    wsKeyOf: function (x: any): string { return String(x || '') },
  }
  const mod = loadSpliced('src/client/statusbar/bannerChain.js', ['guideBannerDecision', 'guideBannerStep', 'guideBannerDiagnosis'], scope)
  const stOf = function (backendId: string, steps: any[]): any {
    return { cwd: 'D:\\ws1363', sessionId: 'sess-1363', selection: { backendId: backendId }, chainSnapshot: { steps: steps } }
  }
  const done = function (id: string): any { return { id: id, status: 'done' } }
  const pending = function (id: string): any { return { id: id, status: 'pending' } }

  // D1. 后端已选、快照还没到：安静等着，不出横幅（#661 第④条：快照没到不许当成没过）。
  const wait = mod.guideBannerDecision(stOf('github', []), false)
  check(wait.step === null && wait.reason === 'waiting-snapshot' && wait.stepId === 'gh:remote', '快照一行都没有时不出横幅、原因记 waiting-snapshot（实得 ' + JSON.stringify(wait) + '）')

  // D2. 场景一那一刻：选完后端、拿回来的还是选之前的旧快照（真机上是 4 行通用步骤，没有仓库/CLI 那几行）。
  //     旧代码在这里整条链都不出（静默），现在要出那条中性的「环境状态没取到，点此重新检查」。
  const staleRows = [pending('tracker:initialized'), pending('skill:wayfinder'), pending('skill:setup-matt-pocock-skills'), pending('skill:ask-matt')]
  const unread = mod.guideBannerDecision(stOf('github', staleRows), false)
  check(unread.step && unread.step.id === 'chain:unread' && unread.reason === 'missing-blocks-setup', '旧快照缺仓库那一行时出中性提示条，原因记 missing-blocks-setup（实得 ' + JSON.stringify({ id: unread.step && unread.step.id, reason: unread.reason }) + '）')
  const unreadMeta = mod.guideBannerDiagnosis(stOf('github', staleRows), false)
  check(unreadMeta.meta && unreadMeta.meta.text === 'banner.chainUnread' && unreadMeta.meta.tone === 'warn', '中性提示条的文案与颜色取自这一条自己的声明（实得 ' + JSON.stringify(unreadMeta.meta) + '）')
  check(unreadMeta.steps === 4 && unreadMeta.backendId === 'github', '日志字段带上当时快照行数与后端 id（实得 steps=' + unreadMeta.steps + '、backendId=' + unreadMeta.backendId + '）')
  const unreadMissing = guideMissingOf(unread.step, staleRows)
  check(unreadMissing && unreadMissing.type === 'recheck', '中性提示条那颗按钮走「人亲手重查」那一路（实得 ' + JSON.stringify(unreadMissing) + '）')
  check(String(unreadMeta.key).indexOf('chain:unread|') === 0, '边沿键分得清是这一条（实得 ' + unreadMeta.key + '）')

  // D3. 重算回来了：缺 CLI / 缺仓库按清单顺序各自出对应那条；仓库那条排在初始化之前（修复后第一条黄条是仓库那条）。
  const noCli = mod.guideBannerDecision(stOf('github', [pending('gh:installed'), pending('gh:authed'), pending('gh:remote'), pending('tracker:initialized')]), false)
  check(noCli.step && noCli.step.id === 'gh:installed' && noCli.reason === 'step-not-done', '缺命令行工具时先出装 CLI 那条（实得 ' + JSON.stringify({ id: noCli.step && noCli.step.id, reason: noCli.reason }) + '）')
  const noRepoSteps = [done('gh:installed'), done('gh:authed'), pending('gh:remote'), pending('tracker:initialized')]
  const noRepo = mod.guideBannerDecision(stOf('github', noRepoSteps), false)
  check(noRepo.step && noRepo.step.id === 'gh:remote' && noRepo.reason === 'step-not-done', '命令行与登录都过了、只缺仓库时出仓库那条（实得 ' + JSON.stringify({ id: noRepo.step && noRepo.step.id, reason: noRepo.reason }) + '）')
  const noRepoMeta = mod.guideBannerDiagnosis(stOf('github', noRepoSteps), false)
  check(noRepoMeta.meta && noRepoMeta.meta.text === 'banner.repo', '缺仓库时用的是仓库那条文案（实得 ' + JSON.stringify(noRepoMeta.meta) + '）')

  // D4. 场景二：Markdown 工作区初始化还挂着时出初始化那条；初始化与技能都做完后一条都不出（黄条该消失就消失）。
  const mdSteps = [pending('tracker:initialized'), pending('skill:wayfinder'), pending('skill:setup-matt-pocock-skills'), pending('skill:ask-matt')]
  const mdSetup = mod.guideBannerDecision(stOf('markdown', mdSteps), false)
  check(mdSetup.step && mdSetup.step.id === 'tracker:initialized' && mdSetup.reason === 'step-not-done', 'Markdown 工作区没初始化完时出初始化那条（实得 ' + JSON.stringify({ id: mdSetup.step && mdSetup.step.id, reason: mdSetup.reason }) + '）')
  const mdDone = mod.guideBannerDecision(stOf('markdown', [done('tracker:initialized'), done('skill:wayfinder'), done('skill:setup-matt-pocock-skills'), done('skill:ask-matt')]), false)
  check(mdDone.step === null && mdDone.reason === 'all-done', '初始化与技能都做完了就不再出横幅、原因记 all-done（实得 ' + JSON.stringify(mdDone) + '）')

  // D5. 全绿之后：GitHub 那条清单也一条都不出（六步全 done）。
  const ghAllSteps = [done('gh:installed'), done('gh:authed'), done('gh:remote'), done('tracker:initialized'), done('skill:wayfinder'), done('skill:setup-matt-pocock-skills'), done('skill:ask-matt')]
  const ghAll = mod.guideBannerDecision(stOf('github', ghAllSteps), false)
  check(ghAll.step === null && ghAll.reason === 'all-done', 'GitHub 六步全过时一条横幅都不出（实得 ' + JSON.stringify(ghAll) + '）')

  // D6. 一条都没有时边沿键仍带原因（日志看得出状态在迁移），但 StatusBar 判出现/消失必须看 bannerStep。
  const clearKey = mod.guideBannerDiagnosis(stOf('github', []), false)
  check(clearKey.step === null && String(clearKey.key).indexOf('cleared|waiting-snapshot') === 0, '没有横幅时边沿键以 cleared|原因 开头（实得 ' + clearKey.key + '）')
  const barSrc = sourceText('src/client/statusbar/StatusBar.js')
  check(/outcome:\s*bannerStep\s*\?\s*'shown'\s*:\s*'cleared'/.test(barSrc), 'guide.banner 的出现/消失按 bannerStep 判断（键非空不能当有横幅；真机日志出现过 step 与 banner 都空、outcome 却记 shown 的行）')

  // D7. 老入口与判定入口同结论（兼容调用方拿到的仍是同一条）。
  check(mod.guideBannerStep(stOf('github', staleRows), false) === unread.step, 'guideBannerStep 与 guideBannerDecision 同一条结论')
}

const main = async function (): Promise<void> {
  partA()
  console.log('')
  await partB()
  console.log('')
  await partC()
  console.log('')
  partD()
  console.log('\n' + (failed ? '不通过' : '全部通过') + ' — ' + total + ' 条断言')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e: any): void { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
