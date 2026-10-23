// tests/verify-927-gate-injection.ts —— 门禁：闸真的接到了传输层，而且「闸晚一步就位」也接得上（#927）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-927-gate-injection.ts。
// 它不能裸跑：src/host/platformChannel.js 这个说明符要靠装载钩子改指同名的 .ts 源文件，
// 不挂钩子会直接 ERR_MODULE_NOT_FOUND（这一行的旧说法「可独立运行」是错的）。
//
// 守的是什么：#723（T19）写好那两处报账（platformChannel 的 detectionExec、repoKeys 的 runGh）之后，
// 宿主装配处一直没把闸交给它们，于是生产里「每一笔真实出站都记在账上」这条不变式是空的：
// transport 与 accounted 不动、escaped 是个空 0。这一条门禁用真件跑一遍：
//   建通道时闸还没有 → 报账静默；闸随后就位 → 同一处立刻开始报账。
//   关键在这里：刷新接线要到插件起步时才建好，先建好的那一路老写法永远拿不到闸。
import nodePath from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPlatformChannel } from '../src/host/platformChannel.js'
import { createRepoKeys } from '../src/refresh/rooms/host/git-execution.ts'

const ROOT = nodePath.resolve(nodePath.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
let failed = 0
let total = 0
const check = (ok: unknown, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

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
  const ledgerMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/refresh/rooms/host/quota-ledger.ts')).href)
  const gateMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/refresh/rooms/host/refresh-gate.ts')).href)
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

// ── ⑦ 活件：读数改走会话的 readBudget，剩 0 的那一桶落账后由裁决降档（#1443 改道） ──
// #1443 把这一截的读法从「经闸打一次免费的 gh、撞 0 就 noteRateLimited 等重置」改成了
// 「经 Tracker 会话调 readBudget，房间自己读 gh，读数落账后由裁决按分桶剩余算」。所以旧的
// send / runGh / noteRateLimited 三个口已经不存在（再传也只是被忽略，读数恒回 missing-dep）；
// 这里按新口给 readBudget，并用真账本 + 真闸验证「见底的那一桶真的被降档、另一桶照旧放行」。
{
  const mod = await import(pathToFileURL(nodePath.join(ROOT, 'src/refresh/registry/quota-sync-bridge.ts')).href)
  const ledgerMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/refresh/rooms/host/quota-ledger.ts')).href)
  const gateMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/refresh/rooms/host/refresh-gate.ts')).href)
  const CLOCK = 1700000000000
  const ledger = ledgerMod.createLedger({ now: () => CLOCK })
  const gate = gateMod.createGate({ ledger: ledger, now: () => CLOCK })
  gate.setWorkspace('/ws', { active: true })
  const readCalls = []
  const sync = mod.createDeckQuotaSync({
    // 房间回两桶读数：rest 已经见底（0/5000），graphql 还满着（5000/5000）。
    readBudget: async (cwd) => {
      readCalls.push(cwd)
      return { ok: true, data: { known: true, kind: 'two-buckets', buckets: { rest: { limit: 5000, remaining: 0 }, graphql: { limit: 5000, remaining: 5000 } } } }
    },
    syncDue: () => true,
    syncServer: (readings) => ledger.syncServer(readings),
    logCtx: null,
  })
  const r = await sync.ensureReading('/ws', 'ws-panel')
  check(r.ok === true && r.fresh === true, '⑦ 读数这条路照旧成功（实得 ' + JSON.stringify(r) + '）')
  check(readCalls.length === 1 && readCalls[0] === '/ws', '⑦ 读一次预算、按这次调用的工作区目录读（实得 ' + JSON.stringify(readCalls) + '）')
  const restRemaining = ledger.view('rest').remaining
  const graphqlRemaining = ledger.view('graphql').remaining
  check(restRemaining === 0 && graphqlRemaining > 0, '⑦ 读数按桶落账：见底的那一桶记 0、另一桶照旧有数（实得 rest=' + restRemaining + ' / graphql=' + graphqlRemaining + '）')
  // 降档由裁决算：rest 见底（红档）→ AI 工具的写被推迟；graphql 还满着 → 同一笔照旧放行。
  const restVerdict = gate.decideFor({ source: 'tool.call', kind: 'write', bucket: 'rest', workspaceKey: '/ws' })
  const gqlVerdict = gate.decideFor({ source: 'tool.call', kind: 'tool-batch', bucket: 'graphql', workspaceKey: '/ws' })
  check(restVerdict.verdict === 'defer' && restVerdict.reason === 'ai-tool-below-remaining', '⑦ 只剩 0 的那一桶被降档：AI 工具那一笔被推迟（实得 ' + restVerdict.verdict + '/' + restVerdict.reason + '）')
  check(gqlVerdict.verdict === 'allow' && gqlVerdict.reason === 'ai-tool-within-caps', '⑦ 另一桶还满着：同一档照旧放行，不被别桶连坐（实得 ' + gqlVerdict.verdict + '/' + gqlVerdict.reason + '）')
}

// ── ⑧ 活件：面板那一路真走一遍（真 platformChannel + 真闸）：账与真发数一致、绕闸为 0 ──
{
  const CLOCK = 1700000000000
  const ledgerMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/refresh/rooms/host/quota-ledger.ts')).href)
  const gateMod = await import(pathToFileURL(nodePath.join(ROOT, 'src/refresh/rooms/host/refresh-gate.ts')).href)
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
