// tests/verify-927-gate-injection.js —— 门禁：闸真的接到了传输层，而且「闸晚一步就位」也接得上（#927）
// 用法：在插件根目录执行 node tests/verify-927-gate-injection.js，可独立运行。
//
// 守的是什么：#723（T19）写好那两处报账（platformChannel 的 detectionExec、repoKeys 的 runGh）之后，
// 宿主装配处一直没把闸交给它们，于是生产里「每一笔真实出站都记在账上」这条不变式是空的：
// transport 与 accounted 不动、escaped 是个空 0。这一条门禁用真件跑一遍：
//   建通道时闸还没有 → 报账静默；闸随后就位 → 同一处立刻开始报账。
//   关键在这里：刷新接线要到插件起步时才建好，先建好的那一路老写法永远拿不到闸。
import nodePath from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPlatformChannel } from '../src/host/platformChannel.js'
import { createRepoKeys } from '../src/host/repoKeys.js'

const ROOT = nodePath.resolve(nodePath.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// ── 一份假传输底座：不起真进程，只把 handle 的形状给全 ──
function mkSubprocess() {
  return {
    spawn: function () {
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: 'gh version 2.0.0\n' }) }, stderr: { readFrom: () => ({ text: '' }) } },
        terminate: function () {},
      }
    },
  }
}
const neverTimer = { timeout: function () { return new Promise(function () {}) } }

// ── 一个只数条目的假闸（形状与真闸一样有 noteOutbound） ──
function mkGate() {
  const seen = []
  return { seen: seen, noteOutbound: function (entry) { seen.push(entry); return { requests: seen.length, points: 0 } } }
}

// ── 真件：闸晚一步就位也接得上 ──
{
  let gateNow = null
  const pc = createPlatformChannel({
    ctx: {}, subprocess: mkSubprocess(), timer: neverTimer, fs: null, DEFAULT_CWD: '.', TIMEOUT_MS: 5000,
    getMattSkillProbeNames: async () => [], probeSkill: async () => null, logCtx: null,
    getGate: function () { return gateNow },
  })
  await pc.detectionExec('gh', ['api', 'repos/o/r/issues'], { cwd: '.' }, 'gate-injection-probe')
  check(gateNow === null, '③ 起步时闸还没建好（取值口是空的）')
  const g = mkGate()
  gateNow = g
  await pc.detectionExec('gh', ['api', 'repos/o/r/issues'], { cwd: '.' }, 'gate-injection-probe')
  check(g.seen.length === 1, '③ 闸就位之后同一处立刻开始报账：这一笔真出站记了 1 条（实得 ' + g.seen.length + '）')
  check(g.seen[0] && g.seen[0].requests === 1, '③ 报的是「这一笔真发的请求数」（实得 ' + JSON.stringify(g.seen[0]) + '）')
  await pc.detectionExec('gh', ['api', 'graphql'], { cwd: '.' }, 'gate-injection-probe')
  check(g.seen.length === 2 && g.seen[1].points === 1, '③ GraphQL 那一路按点数记（实得 ' + JSON.stringify(g.seen[1]) + '）')
}

// ── ④ 真件：repoKeys 那一处（runGh）同一条结论 ──
{
  let gateNow = null
  let ghPath = 'gh'   // 直接给好路径，跳过那条 --version 探测，让这一笔只报一次
  const rk = createRepoKeys({
    subprocess: mkSubprocess(), timer: neverTimer, fs: null, DEFAULT_CWD: '.', TIMEOUT_MS: 5000,
    repoKeys: new Map(), repoRoots: new Map(),
    getGhPath: function () { return ghPath }, setGhPath: function (v) { ghPath = v },
    getGhLastError: function () { return null }, setGhLastError: function () {},
    getPlatform: async () => ({ resolveExecutable: async () => 'gh' }),
    getWorkspaceStore: async () => null, setCache: function () {}, clearWorkspaceStore: function () {},
    namingSweepSoon: function () {}, getChainBackoff: function () { return {} },
    parseGithubRepo: function () { return null }, logCtx: null,
    getGate: function () { return gateNow },
  })
  const before = await rk.runGh(['api', 'repos/o/r/issues'], '.')
  check(before && before.ok === true, '④ repoKeys.runGh 能跑通（假进程底座）')
  const g = mkGate()
  gateNow = g
  await rk.runGh(['api', 'repos/o/r/issues'], '.')
  check(g.seen.length === 1, '④ repoKeys 这一处也在闸就位之后开始报账（实得 ' + g.seen.length + '）')
}


// ── ⑥ 活件：过闸的调用把结果带回来；没报数不算「对不上」；报假数仍被抓 ──
{
  const CLOCK = 1700000000000
  const ledgerMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/refresh/ledger.js')).href)
  const gateMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/refresh/gate.js')).href)
  const ledger = ledgerMod.createLedger({ now: () => CLOCK })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 } }, CLOCK)
  const gate = gateMod.createGate({ ledger: ledger, now: () => CLOCK })
  gate.setWorkspace('ws-panel', { active: true })
  function transport(requests, points) { gate.noteOutbound({ requests: requests, points: points }) }
  const before = gate.stats()
  const out = await gate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'graphql', workspaceKey: 'ws-panel' }, async function () { transport(2, 2); return { ok: true, snapshot: '面板那份数据' } })
  const after = gate.stats()
  check(out.sent === true && !!out.result && out.result.snapshot === '面板那份数据', '⑥ 过闸的调用把真做出来的东西带回来了（result 原样）')
  check(after.accounted.requests - before.accounted.requests === 2 && after.accounted.points - before.accounted.points === 2, '⑥ 真发的 2 条 2 点都记进了账')
  check(after.mismatch === before.mismatch, '⑥ 没报数的调用不算「对不上」（对不上次数没动）')
  check(gate.escaped().requests === 0 && gate.escaped().points === 0, '⑥ 过闸之后绕闸条数是 0（这一条正是观察期要盯的数）')
  const lieBefore = gate.stats().mismatch
  await gate.send({ source: 'panel.refresh', kind: 'detail', bucket: 'graphql', workspaceKey: 'ws-panel' }, async function () { transport(3, 0); return { requests: 1, points: 0 } })
  check(gate.stats().mismatch === lieBefore + 1, '⑥ 报假数（发 3 条报 1 条）仍然当场对出来')
}

// ── ⑦ 活件：读数里剩 0 时，真的按服务端给的重置时刻降了档（#927 ①） ──
{
  const mod = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/platform/deckQuotaSync.js')).href)
  const notes = []
  const resetSec = Math.floor((Date.now() + 600000) / 1000)
  const body = JSON.stringify({ resources: { core: { limit: 5000, remaining: 0, reset: resetSec }, graphql: { limit: 5000, remaining: 5000, reset: resetSec } } })
  const sync = mod.createDeckQuotaSync({
    send: async (req, perform) => ({ sent: true, result: await perform() }),
    syncDue: () => true,
    syncServer: () => ({ applied: ['rest', 'graphql'] }),
    noteRateLimited: (bucket, seconds, key) => { notes.push({ bucket: bucket, seconds: seconds, key: key }); return { bucket: bucket } },
    runGh: async () => ({ ok: true, text: body }),
    logCtx: null,
  })
  const r = await sync.ensureReading('/ws', 'ws-panel')
  check(r.ok === true, '⑦ 读数这条路照旧成功（实得 ' + JSON.stringify(r) + '）')
  check(notes.length === 1 && notes[0].bucket === 'rest' && notes[0].seconds > 0 && notes[0].seconds <= 600, '⑦ 只剩 0 的那一桶被降档，秒数取自服务端给的重置时刻（实得 ' + JSON.stringify(notes) + '）')
}

// ── ⑧ 活件：面板那一路真走一遍（真 platformChannel + 真闸）：账与真发数一致、绕闸为 0 ──
{
  const CLOCK = 1700000000000
  const ledgerMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/refresh/ledger.js')).href)
  const gateMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/host/refresh/gate.js')).href)
  const ledger = ledgerMod.createLedger({ now: () => CLOCK })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 } }, CLOCK)
  const gate = gateMod.createGate({ ledger: ledger, now: () => CLOCK })
  gate.setWorkspace('/ws', { active: true })
  const pc = createPlatformChannel({
    ctx: {}, subprocess: mkSubprocess(), timer: neverTimer, fs: null, DEFAULT_CWD: '.', TIMEOUT_MS: 5000,
    getMattSkillProbeNames: async () => [], probeSkill: async () => null, logCtx: null,
    getGate: function () { return gate },
  })
  const panelExec = function (c, a, o) {
    const isGql = String((a && a[0]) || '') === 'api' && String((a && a[1]) || '').indexOf('graphql') >= 0
    return gate.send({ source: 'panel.refresh', kind: 'detail', bucket: isGql ? 'graphql' : 'rest', workspaceKey: '/ws' }, function () { return pc.detectionExec(c, a, o, 'snapshot') }).then(function (r) { return r.result })
  }
  await panelExec('gh', ['api', 'repos/o/r/issues'], { cwd: '.' })
  await panelExec('gh', ['api', 'graphql'], { cwd: '.' })
  const st = gate.stats()
  check(st.accounted.requests === 2 && st.transport.requests === 2, '⑧ 面板那一路过闸之后：闸记的 2 条 == 传输层真发的 2 条（实得 ' + JSON.stringify(st.accounted) + ' / ' + JSON.stringify(st.transport) + '）')
  check(st.accounted.points === 1 && st.transport.points === 1, '⑧ GraphQL 那一条按点数记（1 点）')
  check(gate.escaped().requests === 0 && gate.escaped().points === 0, '⑧ 绕闸条数为 0（面板那一路不再算绕闸）')
  check(st.mismatch === 0, '⑧ 面板那一路没报数，所以不算「对不上」')
}
console.log(failed ? '\n存在失败 — verify-927-gate-injection 未通过' : '\n全部通过 — 闸接进了传输层，且晚一步就位也接得上（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
