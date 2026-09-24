// verify-reply-envelope-parity.js —— 门禁：会话快照两条回包路径的**字段集合必须逐项相等**。
//
// 为什么要有这一条（2026-09-24 维护者真机反馈引出）：面板上那条「读不到处理记录」从来没消失过。
// 查到根因是**两条回包路径各拼一份信封**：
//   · wf.snapshot（src/host/sessionSnapshot.js）在回包外面挂上了「每个会话在处理哪些票」的读数；
//   · wf.refresh （src/host/sessionRefresh.js）自己手写了四份信封字面量，从来没挂过这个字段。
// 而界面（src/client/kernel/probe-snapshot.js）是 `force ? wf.refresh : wf.snapshot`，
// 回来一律 `st.snapshot = snap` —— 于是任何一次强制刷新都把「不带字段」的那份装进面板，
// 界面上那一块就只能判「读不到」。两条路的字段集合当时确实不等（快照 22 项 / 刷新 19 项）。
//
// #653 那条老规矩「快照里有哪些字段，改一处就够」在 sessionRefresh.js 上从来没成立过。这条门禁就是把它钉住：
// 用同一组假零件真的建起两条电话，真各调一次，把两份 ok:true 回包的**键集合排序后逐项比对**。
// 相等才通过；哪一边多了少了，报出来是哪几个键。
//
// 它同时钉住两件事（都是这次故障的直接症状）：
//   一、两条路都必须挂上那个读数字段（谁漏了，界面就会说读不到）；
//   二、两份回包的键集合必须完全一样（杜绝再次各拼一份信封）。
//
// 用法：node tests/verify-reply-envelope-parity.js（在插件根目录）
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')

let failed = false
const problems = []
const fail = function (msg) { problems.push(msg); failed = true }
function ok(msg) { console.log('  PASS ' + msg) }

/** 假的日志出口：一条都不记（门禁只比形状，不测日志）。 */
const quietLog = { fire: function () {}, isEnabled: function () { return false } }

/** 一组两条电话都能吃饱的假零件。走向固定在最简那条分支：没有后端。 */
function makeDeps(envelope, chainReadout) {
  return {
    envelope: envelope,
    chainReadout: chainReadout,
    chainField: 'sessionTickets',
    canonicalKey: async function (s) { return s },
    selectEarly: async function () { return { backendId: null, source: 'fallback', pending: false, rev: 0 } },
    isComposerSelection: function () { return false },
    getTrackerRegistry: async function () { return null },
    getPlatform: async function () { return {} },
    ctx: { get: function () { return {} }, effect: function () { return function () {} }, on: function () { return function () {} } },
    getCache: function () { return { ts: 0, snapshot: null, error: null, cwd: null } },
    setCache: function () {},
    CACHE_MS: 60000,
    cacheSnapshotIsCurrent: async function () { return false },
    upcaseSnapStates: function (s) { return s },
    computeLevels: function () { return { byNumber: {}, byKey: {} } },
    groupTickets: function () { return { total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} } },
    getRepoRoot: async function (c) { return c },
    getRepoKey: async function () { return null },
    readDiskCache: async function () { return null },
    writeDiskCache: async function () {},
    adoptSnapshot: function (snap) { return snap },
    detectionExec: async function () { return {} },
    getGhPath: function () { return null },
    getGhLastError: function () { return null },
    errText: function (e) { return String((e && e.message) || e) },
    DEFAULT_CWD: process.cwd(),
    logCtx: quietLog,
    getChoiceStore: async function () { return null },
    resetGhCache: function () {},
  }
}

async function main() {
  console.log('会话快照两条回包路径的字段集合对等门禁（wf.snapshot 与 wf.refresh）')
  const envMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'snapshotEnvelope.js')).href)
  const snapMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'sessionSnapshot.js')).href)
  const refMod = await import(pathToFileURL(path.join(ROOT, 'src', 'host', 'sessionRefresh.js')).href)

  // 那份「每个会话在处理哪些票」的读数：这里用一个最简的假件（ok:true + 空列表），
  // 门禁只关心它有没有被挂上、挂的名字对不对。
  let readoutCalls = 0
  const chainReadout = function () {
    readoutCalls += 1
    return { ok: true, at: 1, reason: 'host.chain.empty', sessions: [] }
  }
  const envelope = envMod.createSnapshotEnvelope({
    getGhPath: function () { return null },
    getGhLastError: function () { return null },
    adoptSnapshot: function (snap) { return snap },
    logCtx: quietLog,
    chainReadout: chainReadout,
    chainField: 'sessionTickets',
  })

  const deps = makeDeps(envelope, chainReadout)
  const cwd = process.cwd()

  const snapshotPhone = snapMod.createSessionSnapshot(deps)
  const refreshPhone = refMod.createSessionRefresh(deps)

  const snapReply = await snapshotPhone.handleSnapshot({ cwd: cwd })
  const refReply = await refreshPhone.handleRefresh({ cwd: cwd })

  if (!snapReply || snapReply.ok !== true) fail('wf.snapshot 这条没回出一份 ok:true 的快照，拿不到可比的东西：' + JSON.stringify(snapReply).slice(0, 160))
  if (!refReply || refReply.ok !== true) fail('wf.refresh 这条没回出一份 ok:true 的快照，拿不到可比的东西：' + JSON.stringify(refReply).slice(0, 160))
  if (failed) return

  const snapKeys = Object.keys(snapReply).sort()
  const refKeys = Object.keys(refReply).sort()

  // 一、两条路都必须挂上那个读数字段。
  if (snapKeys.indexOf('sessionTickets') < 0) fail('wf.snapshot 的回包里没有挂「每个会话在处理哪些票」的读数（sessionTickets）：界面那一块只能判读不到')
  if (refKeys.indexOf('sessionTickets') < 0) fail('wf.refresh 的回包里没有挂「每个会话在处理哪些票」的读数（sessionTickets）：界面只要走过一次强制刷新就会一直显示读不到（这就是 2026-09-24 那条真机反馈）')

  // 二、两条路的字段集合必须逐项相等 —— 这是本条门禁的主句。
  if (snapKeys.join(',') !== refKeys.join(',')) {
    const onlySnap = snapKeys.filter(function (k) { return refKeys.indexOf(k) < 0 })
    const onlyRef = refKeys.filter(function (k) { return snapKeys.indexOf(k) < 0 })
    fail('两条回包路径的字段集合不相等：只有 wf.snapshot 有 ' + JSON.stringify(onlySnap) + '；只有 wf.refresh 有 ' + JSON.stringify(onlyRef) +
      '（快照 ' + snapKeys.length + ' 项 / 刷新 ' + refKeys.length + ' 项）。两条路必须共用同一份信封，不许各拼一份')
  }

  if (readoutCalls < 2) fail('两份回包应当各现算一次读数（共 2 次），实得 ' + readoutCalls + ' 次 —— 说明有一边没接上')

  if (failed) return
  ok('两条回包路径的字段集合逐项相等（各 ' + snapKeys.length + ' 项）')
  ok('两条路都挂上了 sessionTickets 读数，且各现算一次（共 ' + readoutCalls + ' 次）')
}

main().then(function () {
  if (failed) { problems.forEach(function (p) { console.log('  FAIL ' + p) }); console.log('\n存在失败'); process.exit(1) }
  console.log('\n全部通过')
}).catch(function (e) {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
