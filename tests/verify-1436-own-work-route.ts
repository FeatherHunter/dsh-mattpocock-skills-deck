// tests/verify-1436-own-work-route.ts —— 门禁：胶囊首帧直接读本机工作路线，不再为一张名单重建整份快照（#1436）。
//
// 用户看到的样子：处理过票的会话打开时，胶囊状态栏那一段要么很久才出现（本机实测 25–30 秒），
// 要么干脆不出现。原因不是没有数据 —— 答案本来就在本机一份小存档里（<主目录>/.dsh/mattskillsdeck/work-path/），
// 但界面从前只有一条路：发现快照里没有工作路线表，就发 wf.refresh 让宿主把整个仓库重建一遍。
//
// 修复分三层（都在插件这一侧）：
//   一、宿主新增只读电话 wf.workRoute：只读那份小存档，几十毫秒回话；读不出来如实回理由，不拿空名单冒充没有；
//   二、客户端首帧先读这条电话（work-route-own.ts 的 loadOwnWorkRoute）：读到就用；还在读就画极小转圈；
//      读失败自己再试两次，仍不成安静退回旧路，不弹失败、不给按钮；
//   三、快照决策不再因为缺表发强制整份刷新（旧那支 25 秒重建），只按自己的新鲜度走。
//
// 本门禁量四件事：
//   A. 宿主电话：四种如实的失败理由各回对、先规整工作区再读、读存档抛错与形状不对分得开、日志只记散列；
//   B. 客户端读取：读到置 ready、在途只发一次、失败按 1.2s/2.5s 再试两次后标 off、宿主旧版不空转、
//      迟到回包按「会话号 + 目录」丢弃、重读期间旧数据先顶着；
//   C. 胶囊取数：电话读数优先于旧快照表、读取中画转圈不画空白、有旧表时继续显示旧表；
//   D. 快照决策：缺表不再是强制整份刷新的理由（老行为仍由 verify-1355 守着）。
//
// 门禁归属: src/host/snapshotEnvelope.ts
// 门禁归属: src/host/index.ts
// 门禁归属: src/client/kernel/work-route-own.ts
// 门禁归属: src/client/statusbar/SessionChainCapsule.ts
// 门禁归属: src/client/statusbar/StatusBar.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
// 门禁归属: src/refresh/rooms/client/refresh-timer.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1436-own-work-route.ts
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourceText } from './lib/source-text.ts'
// #1518：胶囊判据现在问内核 container-view.ts 的 containerKindOf（容器身份唯一真源）。本门禁按模块单独加载视图叶子，
//   构建闭包里才有的名字这里补上真身 —— 不另抄一份判定，否则门禁会跟着实现一起漂。
;(globalThis as any).containerKindOf = (await import('../src/client/kernel/container-view.js')).containerKindOf

let failed = false
let total = 0
const check = function (ok: any, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const tick = function (): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, 0) })
}
const ISO = '2026-10-23T12:30:00.000Z'

const loadSpliced = function (relPath: string, exportNames: string[], scope: Record<string, any>): any {
  const paramNames = Object.keys(scope)
  const fn = compileFn(paramNames, spliceableJs(relPath) + '\nreturn { ' + exportNames.join(', ') + ' }')
  return fn.apply(null, paramNames.map(function (k) { return scope[k] }))
}
const loadLeaf = function (relPath: string, deps: Record<string, any>): any {
  // 导出名要从原文里找：spliceableJs 已经把行首 export 剥掉，拿它再做正则会一个都找不到。
  const src = sourceText(relPath)
  const names: string[] = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) names.push(m[1])
  if (!names.length) throw new Error(relPath + ' 里没有找到 export 声明')
  const fn = compileFn(Object.keys(deps), spliceableJs(relPath) + '\nreturn { ' + names.join(', ') + ' }')
  return fn.apply(null, Object.keys(deps).map(function (k) { return deps[k] }))
}

// ---------------------------------------------------------------------------------------------
// A. 宿主电话 wf.workRoute：只读、如实、记日志不记原文
// ---------------------------------------------------------------------------------------------
const partA = async function (): Promise<void> {
  console.log('#1436 A. 宿主电话 wf.workRoute 只读本机存档、读不到如实说')
  const makePhone = function (deps: any): any {
    return loadSpliced('src/host/snapshotEnvelope.js', ['createOwnWorkRoutePhone'], {}).createOwnWorkRoutePhone(deps)
  }
  const logs: any[] = []
  const logCtx = { fire: function (level: any, event: any, fields: any): void { logs.push({ level: level, event: event, fields: fields }) } }

  // A1. 没有工作区目录 / 没有会话号 / 宿主没接上读口：三档都诚实回 ok:false + 各自的 reason，不冒充「没有记录」。
  const noCwd: any = await makePhone({ logCtx: logCtx }).handleWorkRoute({ sessionId: 's1', cwd: '   ' })
  check(noCwd.ok === true && noCwd.workRouteTable && noCwd.workRouteTable.ok === false
    && noCwd.workRouteTable.reason === 'host.work-route.no-workspace',
    '没有工作区目录 → 回 ok:false + no-workspace（实得 ' + JSON.stringify(noCwd.workRouteTable) + '）')
  const noSid: any = await makePhone({ logCtx: logCtx }).handleWorkRoute({ cwd: 'D:\\ws' })
  check(noSid.workRouteTable && noSid.workRouteTable.reason === 'host.work-route.no-session',
    '没有会话号 → 回 no-session（实得 ' + JSON.stringify(noSid.workRouteTable) + '）')
  const noBind: any = await makePhone({ logCtx: logCtx }).handleWorkRoute({ sessionId: 's1', cwd: 'D:\\ws' })
  check(noBind.workRouteTable && noBind.workRouteTable.reason === 'host.work-route.no-binding',
    '宿主没接上读口 → 回 no-binding（实得 ' + JSON.stringify(noBind.workRouteTable) + '）')
  const reasons: string[] = logs.filter(function (x) { return x.event === 'host.call' }).map(function (x) { return x.fields.reason })
  check(reasons.indexOf('host.work-route.no-workspace') >= 0 && reasons.indexOf('host.work-route.no-session') >= 0 && reasons.indexOf('host.work-route.no-binding') >= 0,
    '三档诚实失败各记一行 host.call 日志、reason 是完整理由串（实得 ' + JSON.stringify(reasons) + '）')

  // A2. 先规整工作区再读：账本按规整后的路径散列存放，少走这一步会读出第二格。
  let sawRoot: any = null
  let sawSid: any = null
  const phoneOk = makePhone({
    logCtx: logCtx,
    canonicalKey: function (p: any): any { return Promise.resolve(String(p).toLowerCase() + '/') },
    readout: function (root: any, sessions: any): any {
      sawRoot = root
      sawSid = sessions
      return Promise.resolve({ ok: true, readout: { at: ISO, staleCount: 0, entries: [{ ticketKey: '1436' }] } })
    },
  })
  const okRes: any = await phoneOk.handleWorkRoute({ sessionId: 's1', cwd: 'D:\\WS' })
  check(!!sawRoot && sawRoot.ok === true && sawRoot.workspaceRoot === 'd:\\ws/',
    '读存档前先把工作区路径交给 canonicalKey 规整（实得 ' + JSON.stringify(sawRoot) + '）')
  check(!!sawSid && sawSid.sessionId === 's1', '读存档时带上请求里的会话号（实得 ' + JSON.stringify(sawSid) + '）')
  check(okRes.ok === true && okRes.workRouteTable.ok === true && okRes.workRouteTable.readout.entries[0].ticketKey === '1436',
    '读到的那份表原样交回（实得 ' + JSON.stringify(okRes.workRouteTable) + '）')
  const okLog: any = logs.filter(function (x) { return x.event === 'host.call' && x.fields.reason === 'ready' }).pop()
  check(!!okLog && okLog.fields.method === 'wf.workRoute' && okLog.fields.kind === 'work-route'
    && typeof okLog.fields.latencyMs === 'number' && okLog.fields.ok === true,
    '成功一行沿用既有 host.call 事件，带电话名与耗时（实得 ' + JSON.stringify(okLog && okLog.fields) + '）')

  // A3. 读存档抛错：回 read-failed，日志落 host.call.fail，只记散列不记报错原文。
  logs.length = 0
  const phoneThrow = makePhone({
    logCtx: logCtx,
    readout: function (): any { return Promise.reject(new Error('EACCES D:\\secret\\work-path\\x.json')) },
  })
  const throwRes: any = await phoneThrow.handleWorkRoute({ sessionId: 's1', cwd: 'D:\\ws' })
  check(throwRes.ok === true && throwRes.workRouteTable.ok === false
    && throwRes.workRouteTable.reason === 'host.work-route.read-failed',
    '读存档抛错 → 回 read-failed（实得 ' + JSON.stringify(throwRes.workRouteTable) + '）')
  const failLog: any = logs.filter(function (x) { return x.event === 'host.call.fail' }).pop()
  const failText: string = JSON.stringify(failLog && failLog.fields)
  check(!!failLog && failLog.fields.errorKind === 'read-failed' && typeof failLog.fields.errorHash === 'string'
    && failText.indexOf('secret') < 0 && failText.indexOf('x.json') < 0,
    '抛错那一行只记散列，不把路径原文写进日志（实得 ' + failText + '）')

  // A4. 形状不对：读回来的不是对象 / 说了读到却没有读数，各回 shape 或 read-failed，不把 undefined 当「没有记录」。
  const shapeRes: any = await makePhone({ readout: function (): any { return Promise.resolve(null) } })
    .handleWorkRoute({ sessionId: 's1', cwd: 'D:\\ws' })
  check(shapeRes.workRouteTable.reason === 'host.work-route.read-failed',
    '读回来不是对象 → 回 read-failed（实得 ' + JSON.stringify(shapeRes.workRouteTable) + '）')
  const shape2: any = await makePhone({ readout: function (): any { return Promise.resolve({ ok: true }) } })
    .handleWorkRoute({ sessionId: 's1', cwd: 'D:\\ws' })
  check(shape2.workRouteTable.reason === 'host.work-route.shape',
    '说了读到却没有读数 → 回 shape（实得 ' + JSON.stringify(shape2.workRouteTable) + '）')
  const kept: any = await makePhone({ readout: function (): any { return Promise.resolve({ ok: false, reason: 'host.work-route.no-record' }) } })
    .handleWorkRoute({ sessionId: 's1', cwd: 'D:\\ws' })
  check(kept.workRouteTable.reason === 'host.work-route.no-record',
    '读口说没有记录时原样透出那个理由（不改成 read-failed）')

  // A5. canonicalKey 抛错时不拖垮整条电话：退回请求里的原始目录继续读。
  let rootFallback: any = null
  const phoneKeyThrow = makePhone({
    canonicalKey: function (): any { return Promise.reject(new Error('no such dir')) },
    readout: function (root: any): any { rootFallback = root; return Promise.resolve({ ok: false, reason: 'host.work-route.no-record' }) },
  })
  await phoneKeyThrow.handleWorkRoute({ sessionId: 's1', cwd: 'D:\\ws' })
  check(!!rootFallback && rootFallback.workspaceRoot === 'D:\\ws',
    '规整工作区这一步抛错时退回原始目录继续读（实得 ' + JSON.stringify(rootFallback) + '）')
}

// ---------------------------------------------------------------------------------------------
// B. 客户端首帧读取：读到就用、在途去重、失败自己再试两次、宿主旧版不空转、迟到回包丢弃
// ---------------------------------------------------------------------------------------------
const loadOwnModule = function (): any {
  const calls: any[] = []
  const logs: any[] = []
  const timers: any[] = []
  const emits: any[] = []
  const host = {
    call: function (method: any, params: any): any {
      let res: any = function (): void {}
      const p = new Promise<any>(function (r) { res = r })
      calls.push({ method: method, params: params, res: res })
      return p
    },
  }
  const scope: Record<string, any> = {
    host: host,
    log: function (level: any, event: any, fields: any): void { logs.push({ level: level, event: event, fields: fields }) },
    emit: function (st: any): void { emits.push(st) },
    setTimeout: function (fn: any, ms: number): any {
      const id: any = { fn: fn, ms: ms, cleared: false }
      timers.push(id)
      return id
    },
    clearTimeout: function (id: any): void { if (id) id.cleared = true },
  }
  const mod: any = loadSpliced('src/client/kernel/work-route-own.js',
    ['loadOwnWorkRoute', 'ownWorkRouteSlotOf', 'ownWorkRouteKeyOf', 'snapshotRequestPlan'], scope)
  return {
    mod: mod, calls: calls, logs: logs, emits: emits, timers: timers,
    pending: function (): any[] { return timers.filter(function (t) { return !t.cleared && !t.done }) },
    runTimers: function (): void {
      timers.forEach(function (t) { if (!t.cleared && !t.done) { t.done = true; t.fn() } })
    },
  }
}

const partB = async function (): Promise<void> {
  console.log('#1436 B. 客户端首帧读取：拿到就显示，失败自己重试，不串会话')
  const mk = function (): any { return { sessionId: 's1', cwd: 'D:\\ws', snapshot: { ok: true, maps: [] } } }

  // B0. 会话号或目录缺一个就不读（键拼不出来，读了也不知道是谁的）。
  const b0 = loadOwnModule()
  const st0: any = { cwd: 'D:\\ws' }
  b0.mod.loadOwnWorkRoute(st0, null)
  check(b0.calls.length === 0 && b0.mod.ownWorkRouteKeyOf(st0) === '',
    '缺会话号或目录时不读（键拼不出来，实得 ' + b0.calls.length + ' 次）')

  // B1. 读到一份表：置 ready、留 raw、发一次通知，日志记 ready。
  const b1 = loadOwnModule()
  const st1: any = mk()
  b1.mod.loadOwnWorkRoute(st1, null)
  check(b1.calls.length === 1 && b1.calls[0].method === 'wf.workRoute'
    && b1.calls[0].params.sessionId === 's1' && b1.calls[0].params.cwd === 'D:\\ws',
    '首帧发一次只读请求，参数带会话号与目录（实得 ' + JSON.stringify(b1.calls[0] && b1.calls[0].params) + '）')
  const slotLoading: any = b1.mod.ownWorkRouteSlotOf(st1)
  check(!!slotLoading && slotLoading.state === 'loading' && b1.emits.length >= 1,
    '请求发出去时先把这一格标成读取中并通知界面（实得 ' + JSON.stringify(slotLoading && slotLoading.state) + '）')
  const rawTable: any = { ok: true, readout: { at: ISO, staleCount: 0, entries: [{ ticketKey: '1436', currentSession: true }] } }
  b1.calls[0].res({ ok: true, workRouteTable: rawTable })
  await tick()
  const slotReady: any = b1.mod.ownWorkRouteSlotOf(st1)
  check(!!slotReady && slotReady.state === 'ready' && slotReady.raw === rawTable && slotReady.at === ISO,
    '回包到了置 ready，并留着那一份原始读数（实得 ' + JSON.stringify(slotReady && slotReady.state) + '）')
  const readyLog: any = b1.logs.filter(function (x) { return x.event === 'host.call' }).pop()
  check(!!readyLog && readyLog.fields.reason === 'ready' && readyLog.fields.method === 'wf.workRoute',
    '读到那一行记 host.call、reason=ready（实得 ' + JSON.stringify(readyLog && readyLog.fields) + '）')

  // B2. 在途只发一次：同一份键连着触发只认第一发。
  const b2 = loadOwnModule()
  const st2: any = mk()
  b2.mod.loadOwnWorkRoute(st2, null)
  b2.mod.loadOwnWorkRoute(st2, null)
  check(b2.calls.length === 1, '同一份键在途时只发一次（实得 ' + b2.calls.length + ' 次）')
  b2.calls[0].res({ ok: true, workRouteTable: rawTable })
  await tick()

  // B3. 读失败：先标读取中并排一次 1.2 秒后的重试；再失败排 2.5 秒；第三次仍失败标 off 并停手。
  const b3 = loadOwnModule()
  const st3: any = mk()
  b3.mod.loadOwnWorkRoute(st3, null)
  b3.calls[0].res({ ok: false, error: { message: 'EACCES' } })
  await tick()
  let slot: any = b3.mod.ownWorkRouteSlotOf(st3)
  check(!!slot && slot.state === 'loading' && slot.tries === 1 && b3.pending().length === 1 && b3.pending()[0].ms === 1200,
    '第一次失败先保持读取中，1.2 秒后自己再试（实得 ' + JSON.stringify({ state: slot && slot.state, ms: b3.pending()[0] && b3.pending()[0].ms }) + '）')
  b3.runTimers()
  await tick()
  check(b3.calls.length === 2, '等待到点后自己再读一次（实得 ' + b3.calls.length + ' 次）')
  b3.calls[1].res({ ok: false, error: { message: 'EACCES' } })
  await tick()
  slot = b3.mod.ownWorkRouteSlotOf(st3)
  check(!!slot && slot.state === 'loading' && slot.tries === 2 && b3.pending().length === 1 && b3.pending()[0].ms === 2500,
    '第二次失败再等 2.5 秒试最后一次（实得 ' + JSON.stringify({ tries: slot && slot.tries, ms: b3.pending()[0] && b3.pending()[0].ms }) + '）')
  b3.runTimers()
  await tick()
  b3.calls[2].res({ ok: false, error: { message: 'EACCES' } })
  await tick()
  slot = b3.mod.ownWorkRouteSlotOf(st3)
  check(!!slot && slot.state === 'off' && b3.pending().length === 0,
    '三次都不成标 off、安静停手，不弹失败也不排下一次（实得 ' + JSON.stringify({ state: slot && slot.state, pending: b3.pending().length }) + '）')
  const b3Fl: any = b3.logs.filter(function (x) { return x.event === 'host.call.fail' }).pop()
  check(!!b3Fl && b3Fl.fields.errorKind === 'rejected' && typeof b3Fl.fields.errorHash === 'string',
    '失败那几行记 host.call.fail、errorKind=rejected（实得 ' + JSON.stringify(b3Fl && b3Fl.fields) + '）')

  // B4. 宿主是旧版本（不认这条电话）：立即标 off，不在后台空转重试。
  const b4 = loadOwnModule()
  const st4: any = mk()
  b4.mod.loadOwnWorkRoute(st4, null)
  b4.calls[0].res({ ok: false, error: { message: 'unknown endpoint: wf.workRoute' } })
  await tick()
  slot = b4.mod.ownWorkRouteSlotOf(st4)
  const b4Fl: any = b4.logs.filter(function (x) { return x.event === 'host.call.fail' }).pop()
  check(!!slot && slot.state === 'off' && b4.pending().length === 0,
    '宿主旧版不认这条电话时直接标 off，不排重试（实得 ' + JSON.stringify({ state: slot && slot.state, pending: b4.pending().length }) + '）')
  check(!!b4Fl && b4Fl.fields.errorKind === 'unknown-endpoint',
    '这一档单独记 unknown-endpoint，与读存档失败分开（实得 ' + JSON.stringify(b4Fl && b4Fl.fields) + '）')

  // B5. 迟到回包按「会话号 + 目录」丢弃：切了会话之后旧回包到岸，不能把新会话写成旧记录。
  const b5 = loadOwnModule()
  const st5: any = mk()
  b5.mod.loadOwnWorkRoute(st5, null)
  st5.sessionId = 's2'
  b5.calls[0].res({ ok: true, workRouteTable: rawTable })
  await tick()
  check(b5.mod.ownWorkRouteSlotOf(st5) === null, '切会话之后旧回包被丢弃，不装进新会话那一格')
  check(!!st5.ownWorkRoute && st5.ownWorkRoute.state !== 'ready', '旧回包也没有把那一格改成 ready')

  // B6. 重读期间旧数据先顶着：第二次读还在路上时，上一份表仍留在格子里（旧总比空白强）。
  const b6 = loadOwnModule()
  const st6: any = mk()
  b6.mod.loadOwnWorkRoute(st6, null)
  b6.calls[0].res({ ok: true, workRouteTable: rawTable })
  await tick()
  b6.mod.loadOwnWorkRoute(st6, { reset: true })
  slot = b6.mod.ownWorkRouteSlotOf(st6)
  check(!!slot && slot.state === 'loading' && slot.raw === rawTable,
    '重读期间保留上一份表，界面不回退成空白（实得 ' + JSON.stringify({ state: slot && slot.state, kept: slot && slot.raw === rawTable }) + '）')
  b6.calls[1].res({ ok: true, workRouteTable: { ok: true, readout: { at: ISO, staleCount: 0, entries: [{ ticketKey: '999' }] } } })
  await tick()
  slot = b6.mod.ownWorkRouteSlotOf(st6)
  check(!!slot && slot.state === 'ready' && slot.raw.readout.entries[0].ticketKey === '999',
    '新读数到了换成新的（实得 ' + JSON.stringify({ state: slot && slot.state }) + '）')
}

// ---------------------------------------------------------------------------------------------
// C. 胶囊取数：电话读数优先、读取中画转圈、有旧表先显示旧表
// ---------------------------------------------------------------------------------------------
const makeReactStub = function (): any {
  return {
    createElement: function (type: any, props: any): any {
      return { type: type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useContext: function (): any { return null },
    useState: function (v: any): any[] { return [v, function (): void {}] },
    useRef: function (v: any): any { return { current: v } },
    useEffect: function (): void {},
  }
}
const partC = function (own: any): void {
  console.log('#1436 C. 胶囊取数：电话读数优先、读取中不空白')
  const tr = function (k: any): string { return String(k) }
  const fakeH = function (type: any, props: any, children: any): any { return { type: type, props: props || {}, children: children === undefined ? [] : children } }
  const Ic = function (p: any): any { return { type: 'Ic', props: p || {} } }
  const table: any = loadLeaf('src/client/views/shared/workRouteTable.js', {
    React: makeReactStub(),
    DswsCtx: null,
    Tip: function (p: any, c: any): any { return { type: 'Tip', props: p || {}, children: c === undefined ? [] : [c] } },
    tr: tr,
    h: fakeH,
    Ic: Ic,
    portalTop: function (x: any): any { return x },
    DSW_VERSION: 'test',
    ownWorkRouteSlotOf: own.ownWorkRouteSlotOf,
  })
  const noop = function (): void {}
  const capsule: any = loadLeaf('src/client/statusbar/SessionChainCapsule.js', {
    React: makeReactStub(),
    DswsCtx: null,
    tr: tr,
    Ic: Ic,
    Tip: function (p: any, c: any): any { return { type: 'Tip', props: p || {}, children: c === undefined ? [] : [c] } },
    pushNav: noop,
    findMapByIdentity: function (): any { return null },
    workRouteActionKeyOf: table.workRouteActionKeyOf,
    workRouteTableOf: table.workRouteTableOf,
    workRouteTableClock: table.workRouteTableClock,
    capsuleOwnRoutePick: table.capsuleOwnRoutePick,
    capsuleOwnRouteFallbackNode: table.capsuleOwnRouteFallbackNode,
    ownWorkRouteSlotOf: own.ownWorkRouteSlotOf,
    clearStatusClose: noop,
    openPanel: noop,
    placeStatusOverlay: function (): any { return null },
    scheduleStatusClose: noop,
    PortalOverlay: null,
  })
  const row = function (key: any): any {
    return { ticketKey: key, title: '票 ' + key, sessionLabel: '会话', action: 'report', actionAt: ISO, active: true, currentSession: true }
  }
  const phoneRaw = function (entries: any[]): any { return { ok: true, readout: { at: ISO, staleCount: 0, entries: entries } } }
  const keyOf = function (st: any): string { return String(st.sessionId) + '|' + String(st.cwd) }

  // C1. 电话读数优先于快照里那张旧表：两边都有时，用电话这一份（它按当前会话现读，不会串会话）。
  const st1: any = { sessionId: 's1', cwd: 'D:\\ws', snapshot: { ok: true, maps: [], workRouteTable: phoneRaw([row('999')]) } }
  st1.ownWorkRoute = { key: keyOf(st1), state: 'ready', reason: '', at: ISO, tries: 0, raw: phoneRaw([row('1436')]) }
  const cap1: any = capsule.sessionChainCapsuleOf(st1, 's1')
  check(cap1.state === 'ok' && !!cap1.entry && cap1.entry.ticketKey === '1436',
    '两边都有时用电话读数那一份（实得 ' + JSON.stringify({ state: cap1.state, key: cap1.entry && cap1.entry.ticketKey }) + '）')

  // C2. 还在读、旧路也没有表：胶囊回 loading（画转圈），不是空白、也不是「没有记录」。
  const st2: any = { sessionId: 's2', cwd: 'D:\\ws', snapshot: { ok: true, maps: [] } }
  st2.ownWorkRoute = { key: keyOf(st2), state: 'loading', reason: '', at: '', tries: 1, raw: null }
  const cap2: any = capsule.sessionChainCapsuleOf(st2, 's2')
  check(cap2.state === 'loading', '还在读且旧路没有表 → 胶囊回 loading（实得 ' + JSON.stringify(cap2.state) + '）')
  const node: any = table.capsuleOwnRouteFallbackNode(fakeH, tr, cap2, Ic)
  check(!!node && node.props && node.props['aria-label'] === 'chainView.ownRouteLoading'
    && node.children.length === 1 && node.children[0].props.className === 'dsws-spin',
    '读取中那一档画一枚转圈（实得 ' + JSON.stringify(node && node.props) + '）')

  // C3. 还在读、但旧路有表：继续显示旧表，不退回读取中（旧数据比转圈有用）。
  const st3: any = { sessionId: 's3', cwd: 'D:\\ws', snapshot: { ok: true, maps: [], workRouteTable: phoneRaw([row('1355')]) } }
  st3.ownWorkRoute = { key: keyOf(st3), state: 'loading', reason: '', at: '', tries: 1, raw: null }
  const cap3: any = capsule.sessionChainCapsuleOf(st3, 's3')
  check(cap3.state === 'ok' && cap3.entry.ticketKey === '1355',
    '还在读但快照里有表 → 继续显示旧表（实得 ' + JSON.stringify({ state: cap3.state }) + '）')

  // C4. 还在读、上一格已经读到过表：继续显示上一份，不退回读取中。
  const st4: any = { sessionId: 's4', cwd: 'D:\\ws', snapshot: { ok: true, maps: [] } }
  st4.ownWorkRoute = { key: keyOf(st4), state: 'loading', reason: '', at: ISO, tries: 0, raw: phoneRaw([row('1373')]) }
  const pick4: any = table.capsuleOwnRoutePick(st4)
  check(pick4.view && pick4.view.state === 'ok' && pick4.fallback === null,
    '重读时有上一份读数 → 继续用它、不画读取中（实得 ' + JSON.stringify({ state: pick4.view && pick4.view.state, fallback: pick4.fallback }) + '）')

  // C5. 读法已经 off（宿主旧版或两次重试都不成）：安静退回旧路，不画失败。
  const st5: any = { sessionId: 's5', cwd: 'D:\\ws', snapshot: { ok: true, maps: [] } }
  st5.ownWorkRoute = { key: keyOf(st5), state: 'off', reason: 'host.work-route.unknown-endpoint', at: '', tries: 3, raw: null }
  const cap5: any = capsule.sessionChainCapsuleOf(st5, 's5')
  check(cap5.state === 'idle', '读法 off 且旧路没有表 → 回 idle（整段不画），不画失败（实得 ' + JSON.stringify(cap5.state) + '）')
  check(table.capsuleOwnRouteFallbackOf(st5.ownWorkRoute) === null, 'off 这一档没有「读取中/失败」视图，界面不打扰人')

  // C6. 电话说读到了、就是空的：回 empty（有记录可查、只是没有），与「读坏了」分得开。
  const st6: any = { sessionId: 's6', cwd: 'D:\\ws', snapshot: { ok: true, maps: [] } }
  st6.ownWorkRoute = { key: keyOf(st6), state: 'ready', reason: '', at: ISO, tries: 0, raw: phoneRaw([]) }
  const cap6: any = capsule.sessionChainCapsuleOf(st6, 's6')
  check(cap6.state === 'empty', '电话说读到但一条没有 → 回 empty（实得 ' + JSON.stringify(cap6.state) + '）')

  // C7. 旧快照里那张表读坏了：照旧回 unreadable，不被电话那一档掩盖。
  const st7: any = { sessionId: 's7', cwd: 'D:\\ws', snapshot: { ok: true, maps: [], workRouteTable: { ok: false, reason: 'host.work-route.read-failed' } } }
  const cap7: any = capsule.sessionChainCapsuleOf(st7, 's7')
  check(cap7.state === 'unreadable' && cap7.reason === 'host.work-route.read-failed',
    '快照里的表读坏了 → 回 unreadable 并透出宿主理由（实得 ' + JSON.stringify({ state: cap7.state, reason: cap7.reason }) + '）')
}

async function main(): Promise<void> {
  await partA()
  await partB()
  const own = loadOwnModule()
  partC(own.mod)
  // D. 快照决策：缺表不再是强制整份刷新的理由（老行为与逐格参数由 verify-1355 守着）。
  const stNeed: any = { sessionId: 's9', cwd: 'D:\\ws', snapshot: { ok: true, maps: [] } }
  check(own.mod.snapshotRequestPlan(stNeed, true, 'apply', true) === null,
    'D：缺表但快照水合过且新鲜 → 不发请求（#1436 之前这里会强制重建整份快照）')
  const plan: any = own.mod.snapshotRequestPlan(stNeed, false, 'mount', false)
  check(!!plan && plan.force === false && plan.silent === true,
    'D：缺表且快照不新鲜 → 只按新鲜度发普通静默请求（force=false）')
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  if (failed) process.exitCode = 1
  const t: any = setTimeout(function (): void { process.exit(failed ? 1 : 0) }, 200)
  if (t && typeof t.unref === 'function') t.unref()
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  process.exitCode = 1
})
