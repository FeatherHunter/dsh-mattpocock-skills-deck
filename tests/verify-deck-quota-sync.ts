// verify-deck-quota-sync.ts —— 门禁：剩余额度读数接线（#758）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-deck-quota-sync.ts，可独立运行。
//
// 为什么要这一段：闸的裁决要看剩余额度，可读数从没有任何一路写入——
// 重启后剩余额度恒为零，读请求撞保底线、工具调用撞红档，九个工具在闸口
// 就被诚实推迟（干跑码 gate-defer）。修法不是改裁决数字，而是把设计好的
// 同步接上：差读数时经闸打一次免费的 `gh api rate_limit`，不差不打。
// 本门禁盯住：解析只认全格、差才打、失败永不抛、并发只打一次、
// 壳动手前保一次且缺席时跳过（老桩照样过）。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href)

function rateLimitText(remaining: number): string {
  return JSON.stringify({
    resources: {
      core: { limit: 5000, remaining: remaining, reset: 9999999999 },
      graphql: { limit: 5000, remaining: remaining, reset: 9999999999 },
    },
  })
}

async function main() {
  console.log('剩余额度读数接线门禁（#758：只接断开的线，不改裁决数字）')

  let mod = null
  try { mod = await imp('src/deck/registration/quota-sync.ts') } catch (e) {
    check(false, '接线模块可加载（src/deck/registration/quota-sync.ts）：' + String((e && e.message) || e))
    console.log('\n' + total + ' 条断言，失败')
    process.exit(1)
  }
  check(mod && typeof mod.createDeckQuotaSync === 'function', '交出 createDeckQuotaSync（工厂）')
  check(typeof mod.parseRateLimit === 'function', '交出 parseRateLimit（纯解析）')

  // ── 1. 解析只认全格 ──
  const full = mod.parseRateLimit(rateLimitText(1234))
  check(full && full.rest.remaining === 1234 && full.graphql.limit === 5000, '全格解析出两桶读数')
  check(mod.parseRateLimit('不是 JSON') === null, '非 JSON 算失败')
  check(mod.parseRateLimit(JSON.stringify({ resources: { core: { limit: 1, remaining: 1, reset: 1 } } })) === null, '缺一桶算失败')
  check(mod.parseRateLimit(JSON.stringify({ resources: { core: { limit: 1 }, graphql: { limit: 1, remaining: 1, reset: 1 } } })) === null, '格子不全算失败')
  check(mod.parseRateLimit(null) === null, '空输入算失败')

  // ── 2. 不差不打 ──
  let calls = { send: 0, runGh: 0 }
  const idle = mod.createDeckQuotaSync({
    send: async function () { calls.send += 1; return { sent: true } },
    syncDue: function () { return false },
    syncServer: function () { throw new Error('不该落账') },
    runGh: async function () { calls.runGh += 1; return { ok: true, text: rateLimitText(1) } },
  })
  const idleOut = await idle.ensureReading('/ws', 'ws-1')
  check(idleOut && idleOut.ok === true && idleOut.fresh === false && calls.send === 0 && calls.runGh === 0, '账本说不差，一条都不打')

  // ── 3. 差就打一次免费的，读数落账 ──
  calls = { send: 0, runGh: 0 }
  let synced = null
  let sentReq = null
  const fired = []
  const fakeLog = { fire: function (level, event, fields) { fired.push({ level: level, event: event, fields: fields }) } }
  const live = mod.createDeckQuotaSync({
    send: async function (req, perform) {
      calls.send += 1
      sentReq = req
      return perform()
    },
    syncDue: function () { return true },
    syncServer: function (readings) { synced = readings; return { applied: ['rest', 'graphql'] } },
    runGh: async function (args, cwd) {
      calls.runGh += 1
      if (String(args[0]) !== 'api' || String(args[1]) !== 'rate_limit') throw new Error('打错了接口')
      if (cwd !== '/ws') throw new Error('目录没递过去')
      return { ok: true, text: rateLimitText(4321) }
    },
    logCtx: fakeLog,
  })
  const liveOut = await live.ensureReading('/ws', 'ws-abc')
  check(liveOut && liveOut.ok === true, '差读数时同步成功')
  check(calls.send === 1 && calls.runGh === 1, '只打一条（免费读数那一条）')
  check(sentReq && sentReq.kind === 'quota-read' && sentReq.workspaceKey === 'ws-abc', '走免费的 quota-read，工作区键带过去记账')
  check(synced && synced.rest.remaining === 4321 && synced.graphql.remaining === 4321, '读数落进账本两桶')
  check(fired.length === 1 && fired[0].level === 'info' && fired[0].event === 'host.call' && fired[0].fields.method === 'deck.quotaSync' && fired[0].fields.ok === true && fired[0].fields.kind === 'deck-tool' && typeof fired[0].fields.latencyMs === 'number',
    '落账成功留一行既有 host.call（电话名、耗时、成功标记、种类，无新事件无新字段）')

  // ── 4. gh 不在、解析不出，都认失败，永不抛 ──
  const noGh = mod.createDeckQuotaSync({
    send: async function (req, perform) { return perform() },
    syncDue: function () { return true },
    syncServer: function () { throw new Error('不该落账') },
    runGh: async function () { return { ok: false, error: 'gh 不可用' } },
    logCtx: fakeLog,
  })
  const noGhOut = await noGh.ensureReading('/ws', 'ws-1')
  check(noGhOut && noGhOut.ok === false, 'gh 不在认失败，不抛')
  // 2026-10-21（#1006 复核）：失败也留一行既有 host.call（ok=false + 原因码），回答「这轮冷却为什么开始」。
  // 仍然只有 info 级、只有既有事件、只有字典里那几个键，不刷屏也不新增事件名。
  check(fired.length === 2 && fired[1].level === 'info' && fired[1].event === 'host.call' && fired[1].fields.method === 'deck.quotaSync' && fired[1].fields.ok === false && fired[1].fields.reason === 'sync-empty',
    '失败也留一行既有 host.call：ok=false 加原因码 sync-empty（成功那行不带 reason）')
  const badJson = mod.createDeckQuotaSync({
    send: async function (req, perform) { return perform() },
    syncDue: function () { return true },
    syncServer: function () { throw new Error('不该落账') },
    runGh: async function () { return { ok: true, text: '坏掉的' } },
  })
  const badOut = await badJson.ensureReading('/ws', 'ws-1')
  check(badOut && badOut.ok === false, '解析不出认失败，不抛')
  const noDeps = mod.createDeckQuotaSync({})
  let noDepsCrashed = false
  let noDepsOut = null
  try { noDepsOut = await noDeps.ensureReading('/ws', 'ws-1') } catch (e) { noDepsCrashed = true }
  check(!noDepsCrashed && noDepsOut && noDepsOut.ok === false, '依赖缺席认失败，不抛')
  const throwingSend = mod.createDeckQuotaSync({
    send: async function () { throw new Error('闸炸了') },
    syncDue: function () { return true },
    syncServer: function () {},
    runGh: async function () { return { ok: true, text: rateLimitText(1) } },
  })
  let throwCrashed = false
  try { await throwingSend.ensureReading('/ws', 'ws-1') } catch (e) { throwCrashed = true }
  check(!throwCrashed, '闸抛错也吞掉（调用方照旧被闸推迟，不多一条崩）')

  // ── 5. 并发只打一次 ──
  let ghCalls = 0
  const slow = mod.createDeckQuotaSync({
    send: async function (req, perform) { return perform() },
    syncDue: function () { return true },
    syncServer: function () {},
    runGh: async function () {
      ghCalls += 1
      await new Promise(function (r) { setTimeout(r, 50) })
      return { ok: true, text: rateLimitText(9) }
    },
  })
  await Promise.all([slow.ensureReading('/a', 'k1'), slow.ensureReading('/b', 'k2'), slow.ensureReading('/c', 'k3')])
  check(ghCalls === 1, '三路并发只打一条（实例内并单）')

  // ── 5b. 失败冷却：gh 不在的机器不每次白起 ──
  let failCalls = 0
  const chilly = mod.createDeckQuotaSync({
    send: async function (req, perform) { return perform() },
    syncDue: function () { return true },
    syncServer: function () {},
    runGh: async function () { failCalls += 1; return { ok: false, error: 'gh 不可用' } },
    cooldownMs: 40,
  })
  const f1 = await chilly.ensureReading('/ws', 'k')
  const f2 = await chilly.ensureReading('/ws', 'k')
  check(f1 && f1.ok === false && f2 && f2.ok === false && failCalls === 1, '连着失败只打一次，冷却内直接认失败')
  await new Promise(function (r) { setTimeout(r, 60) })
  await chilly.ensureReading('/ws', 'k')
  check(failCalls === 2, '冷却过了再试一次（不永久放弃）')
  await new Promise(function (r) { setTimeout(r, 60) })
  await chilly.ensureReading('/ws', 'k')
  await chilly.ensureReading('/ws', 'k')
  check(failCalls === 3, '过期后连着失败仍按节流：滑动锚只打一次（#998 Q2）')

  // ── 6. 壳动手前保一次：调了、传了目录与键；缺席时跳过老桩照过 ──
  const shell = await imp('src/deck/shell/call-shell.ts')
  const decModQuota = await imp('src/tracker/detection/backendDecision.ts')
  let ensured = null
  const stubGate = {
    send: async function (req, perform) {
      const out = await perform()
      return { sent: true, requests: 1, points: 0 }
    },
    admitAiTool: function () { return { admitted: true, reason: 'ai-tool-within-caps', points: 1, requests: 1 } },
  }
  // 注册表在 #1138 之后只剩「我这儿有哪些后端」与「这个仓库是谁」两件事，原来那个「进程内绑定一次」的口子
  //   （bound）已整段删除；这里要走到「壳真的选出后端」那一步（写用途要求 canWrite:true），凭据只有一个来源：
  //   工作区里那份工作区文件。生产里由宿主读出来递给壳（src/refresh/rooms/host/refresh-runtime.js 的 readWorkspaceFileText），
  //   夹具照这条口径直接给原文。
  const stubRegistry = {
    has: function () { return true },
    select: async function () { return { backendId: 'github', source: 'test', ref: {} } },
  }
  const anchorQuota = await imp('src/deck/shell/workspace-anchor.ts')
  const wsFileDeps = {
    readWorkspaceFileText: async function () { return 'version: 2\nbackendId: github\npickedAt: 1\nsource: user\n' },
    parseWorkspaceFile: anchorQuota.parseWorkspaceFile,
  }
  const sh = shell.createDeckShell({
    gate: stubGate,
    registry: stubRegistry,
    budget: {},
    estimate: function () { return { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' } },
    costInputFrom: function () { return {} },
    ensureReading: async function (cwd, key) { ensured = { cwd: cwd, key: key }; return { ok: true, fresh: true } },
    decideBackend: decModQuota.decideBackend,
    readWorkspaceFileText: wsFileDeps.readWorkspaceFileText,
    parseWorkspaceFile: wsFileDeps.parseWorkspaceFile,
  })
  const picked = await sh.pickBackend({ agent: { session: { cwd: '/ws-shell' } } }, { cwd: '/ws-shell', workspaceKey: 'ws-shell-1', sessionId: 's1', source: 't', text: '' })
  check(picked && picked.ok === true, '壳照常选出后端（保读数不挡路）')
  check(ensured && ensured.cwd === '/ws-shell' && ensured.key === 'ws-shell-1', '壳动手前保一次读数，目录与键都递过去')
  const shOld = shell.createDeckShell({ gate: stubGate, registry: stubRegistry, budget: {}, estimate: function () { return { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' } }, costInputFrom: function () { return {} }, decideBackend: decModQuota.decideBackend, readWorkspaceFileText: wsFileDeps.readWorkspaceFileText, parseWorkspaceFile: wsFileDeps.parseWorkspaceFile })
  const pickedOld = await shOld.pickBackend({ agent: { session: { cwd: '/ws' } } }, { cwd: '/ws', workspaceKey: 'k', sessionId: '', source: '', text: '' })
  check(pickedOld && pickedOld.ok === true, '没给保读数的老桩照样过（缺席跳过）')

  // ── 7. 闸口径迹：只记机器码，探针读走；口子缺席不影响干活 ──
  const cell = await imp('src/deck/shell/table-cell.ts')
  check(cell && typeof cell.noteDeckGate === 'function' && typeof cell.readDeckGate === 'function', '共享格交出口径迹读写口')
  cell.noteDeckGate({ phase: 'select', verdict: 'defer', reason: 'reserve-kept-for-writes' })
  cell.noteDeckGate({ phase: 'Has Space!', verdict: null, reason: 42 })
  const notes = cell.readDeckGate()
  const lastTwo = notes.slice(-2)
  check(lastTwo[0] && lastTwo[0].phase === 'select' && lastTwo[0].verdict === 'defer' && lastTwo[0].reason === 'reserve-kept-for-writes',
    '机器码原样记（阶段结论原因三格）')
  check(lastTwo[1] && lastTwo[1].phase === '' && lastTwo[1].verdict === '' && lastTwo[1].reason === '', '非法字符洗成空格，不记原文')
  const noted = []
  const deferGate = {
    send: async function () { return { sent: false, verdict: 'defer', reason: 'reserve-kept-for-writes', detail: '读让路' } },
    admitAiTool: function () { return { admitted: true, reason: 'ai-tool-within-caps', points: 1, requests: 1 } },
  }
  const shDefer = shell.createDeckShell({
    gate: deferGate, registry: stubRegistry, budget: {},
    estimate: function () { return { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' } },
    costInputFrom: function () { return {} },
    noteGate: function (info) { noted.push(info) },
    decideBackend: decModQuota.decideBackend,
  })
  const deferOut = await shDefer.pickBackend({ agent: { session: { cwd: '/ws' } } }, { cwd: '/ws', workspaceKey: 'k', sessionId: '', source: '', text: '' })
  check(deferOut && deferOut.ok === false && deferOut.reason === 'gate-defer', '推迟照旧回做不到（口径迹不改变裁决）')
  check(noted.length === 1 && noted[0].phase === 'select' && noted[0].verdict === 'defer' && noted[0].reason === 'reserve-kept-for-writes',
    '推迟那一笔的机器码记下来了（给探针读）')
  const shNoNote = shell.createDeckShell({ gate: deferGate, registry: stubRegistry, budget: {}, estimate: function () { return { points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '' } }, costInputFrom: function () { return {} }, decideBackend: decModQuota.decideBackend })
  const deferOld = await shNoNote.pickBackend({ agent: { session: { cwd: '/ws' } } }, { cwd: '/ws', workspaceKey: 'k', sessionId: '', source: '', text: '' })
  check(deferOld && deferOld.ok === false && deferOld.reason === 'gate-defer', '没给口子缺席跳过，老行为不动')

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
