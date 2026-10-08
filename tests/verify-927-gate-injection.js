// tests/verify-927-gate-injection.js —— 门禁：闸真的接到了传输层，而且「闸晚一步就位」也接得上（#927）
// 用法：在插件根目录执行 node tests/verify-927-gate-injection.js，可独立运行。
//
// 守的是什么：#723（T19）写好那两处报账（platformChannel 的 detectionExec、repoKeys 的 runGh）之后，
// 宿主装配处一直没把闸交给它们，于是生产里「每一笔真实出站都记在账上」这条不变式是空的：
// transport 与 accounted 不动、escaped 是个空 0。这一条门禁钉三件事：
//   ① 装配处（src/host/index.js）必须把闸交给这两处（带一个活的取值口 getGate）；
//   ② 两处传输层必须每次现问一次闸，不能只认创建时拿到的那份快照；
//   ③ 用真件跑一遍：建通道时闸还没有 → 报账静默；闸随后就位 → 同一处立刻开始报账。
//     第 ③ 条是关键：刷新接线要到插件起步时才建好，先建好的那一路老写法永远拿不到闸。
import nodePath from 'node:path'
import { readFileSync } from 'node:fs'
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

// ── ① 装配处必须把闸交给两处传输层，并且用活的取值口 ──
{
  const idx = readFileSync(nodePath.join(ROOT, 'src/host/index.js'), 'utf8')
  const plat = /createPlatformChannel\(\{[\s\S]*?getGate: function \(\) \{ return refreshGate \}/.test(idx)
  const repo = /createRepoKeys\(\{[\s\S]*?getGate: function \(\) \{ return refreshGate \}/.test(idx)
  check(plat, '① 建 platformChannel 时把闸交出去了（装配处带 getGate）')
  check(repo, '① 建 repoKeys 时把闸交出去了（装配处带 getGate）')
  check(/refreshGate = \(w && w\.gate\) \|\| null/.test(idx), '① 刷新接线一就位就把闸填进取值口（不填的话取值口永远是空的）')
  const pc = readFileSync(nodePath.join(ROOT, 'src/host/platformChannel.js'), 'utf8')
  const rk = readFileSync(nodePath.join(ROOT, 'src/host/repoKeys.js'), 'utf8')
  check(/function gateOf\(\)/.test(pc) && /gateOf\(\)/.test(pc), '② platformChannel 每次报账现问一次闸（gateOf）')
  check(/function gateOf\(\)/.test(rk) && /gateOf\(\)/.test(rk), '② repoKeys 每次报账现问一次闸（gateOf）')
}

// ── ③ 真件：闸晚一步就位也接得上 ──
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

console.log(failed ? '\n存在失败 — verify-927-gate-injection 未通过' : '\n全部通过 — 闸接进了传输层，且晚一步就位也接得上（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
