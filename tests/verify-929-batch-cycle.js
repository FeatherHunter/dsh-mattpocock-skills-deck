// tests/verify-929-batch-cycle.js —— 门禁：同一批并发补阻塞边不许造出环（#929）
// 用法：在插件根目录执行 node tests/verify-929-batch-cycle.js，可独立运行。
//
// 守的是什么：deck_map_link 一批里按票分组、组间并行；每一组建边之前的成环检查读的是**已经落盘**的图，
// 看不见同批里另一组还没落盘的边 —— 两条互指的边同批发出时两边都会通过、盘上留下环（#921 复核发现，
// 用真件复现过）。修法是：写任何一条边之前先整批过一遍成环预检（读一次整图，把本批要写的边按写出顺序
// 逐条试放，会让图成环的那条挑出来），组间并行一个字不动。
//
// 四条断言：
//   ① 同批两条互指的边（合流点调度）：至少一条如实报失败，盘上终态没有环；
//   ② 批内两条边互不相干、靠盘上已有的边闭合成环：同样挡得住（这一条是「把有依赖关系的边收进同组串行」
//      那种小改法的反证）；
//   ③ 两条互不相干且不成环的边仍然同时做（合流点处两笔写同时在飞），钉住 d9663ad 的组间并行；
//   ④ 整图读不回时不猜、如实说（notes 里明说这次只有逐组那份检查），工具照旧回话。
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const transports = require('./deck-tools-matrix-transports.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const REPO = { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' }
const EXEC = { agent: { session: { cwd: '/ws/github', id: 's-929' } } }

let failed = 0
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const registryMod = await imp('src/host/tracker/registryCore.js')
const githubModule = (await imp('src/host/tracker/backends/github/index.js')).githubModule
const linkMod = await imp('src/host/tools/deckMapLink.js')
const budget = await imp('src/shared/refresh/budget.js')
const toolCost = await imp('src/shared/refresh/tool-cost.js')

/** 一套真件环境：真 github 房 + 真注册表 + 真 deck_map_link，只把 gh 传输层换成脚本化的假「服务端」。 */
function makeEnv(opts) {
  const o = opts || {}
  const sink = []
  const gh = transports.makeScriptedGh(sink)
  gh.mk('票1'); gh.mk('票2'); gh.mk('票3'); gh.mk('票4')
  for (const pair of (o.seed || [])) { const t = gh.tickets.find((x) => String(x.number) === String(pair[0])); if (t) t.blockedBy.push(String(pair[1])) }
  const events = []
  const ctl = { posts: 0, bothPosted: null, onBothPosted: null }
  ctl.bothPosted = new Promise((r) => { ctl.onBothPosted = r })
  const exec = async (cmd, args) => {
    const line = Array.isArray(args) ? args.join(' ') : ''
    events.push(line)
    if (o.tickMs) await sleep(o.tickMs)
    const post = /dependencies\/blocked_by\s+--method POST/.test(line)
    if (post && o.rendezvousPosts) { ctl.posts += 1; if (ctl.posts >= 2) ctl.onBothPosted(); await Promise.race([ctl.bothPosted, sleep(2000)]) }
    return gh.exec(cmd, args)
  }
  const registry = registryMod.createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  registry.register(githubModule)
  registry.bind({ cwd: '/ws/github', refId: 'acme/demo' }, 'github')
  const tracker = registry.get('github')
  const backendCtx = {
    cwd: '/ws/github',
    platform: { resolveExecutable: async (n) => (n === 'gh' ? '/usr/local/bin/gh' : null), path: path.posix, env: { get: () => undefined } },
    exec, isEnabled: () => false, logEvent: () => {},
  }
  function toolDeps() {
    return {
      gate: { admitAiTool: () => ({ admitted: true }), send: async (req, fn) => { await fn(); return { sent: true, requests: 1, points: 0, remaining: 100, tier: 'ai' } } },
      registry: { select: async () => ({ backendId: 'github', source: 'test', ref: { backend: 'github', refId: 'acme/demo', name: 'demo', url: '' } }), get: () => tracker },
      budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      backendCtx, now: Date.now, hourUsage: () => ({}),
    }
  }
  return { gh, sink, events, exec, backendCtx, tracker, toolDeps, ctl }
}
function storeOf(gh) { return gh.tickets.map((t) => t.number + ' 被 [' + t.blockedBy.join(',') + '] 阻塞').join('；') }
function hasCycleInStore(gh) {
  const adj = new Map(); for (const t of gh.tickets) adj.set(String(t.number), new Set(t.blockedBy.map(String)))
  const vis = new Set(), done = new Set()
  const dfs = (u) => { if (vis.has(u)) return true; if (done.has(u)) return false; vis.add(u); for (const v of (adj.get(u) || [])) if (dfs(v)) return true; vis.delete(u); done.add(u); return false }
  for (const u of adj.keys()) if (dfs(u)) return true
  return false
}
function itemsOf(out) { return (out.items || []).map((i) => i.key + '→' + (i.target || '') + ' [' + i.status + ']') }

// ── ① 同批两条互指的边：至少一条报失败，盘上无环 ──
{
  const env = makeEnv({ rendezvousPosts: true, tickMs: 2 })
  const tool = linkMod.createDeckMapLink(env.toolDeps())
  const out = await tool.run(EXEC, { edges: [{ key: '1', blockedBy: ['2'] }, { key: '2', blockedBy: ['1'] }] })
  check(out.status !== 'ok', '① 同批两条互指的边：工具不再报全成功（实得 status=' + out.status + '）')
  check((out.items || []).some((i) => i.status !== 'ok'), '① 至少一条边如实报失败（实得 ' + JSON.stringify(itemsOf(out)) + '）')
  check(hasCycleInStore(env.gh) === false, '① 盘上终态没有环（实得 ' + storeOf(env.gh) + '）')
}

// ── ② 批内两条边互不相干、靠盘上已有的边闭合成环 ──
{
  const env = makeEnv({ rendezvousPosts: true, tickMs: 2, seed: [['2', '3'], ['4', '1']] })
  const tool = linkMod.createDeckMapLink(env.toolDeps())
  const out = await tool.run(EXEC, { edges: [{ key: '1', blockedBy: ['2'] }, { key: '3', blockedBy: ['4'] }] })
  check((out.items || []).some((i) => i.status !== 'ok'), '② 批内两条不相干的边也挡得住：至少一条报失败（实得 ' + JSON.stringify(itemsOf(out)) + '）')
  check(hasCycleInStore(env.gh) === false, '② 盘上终态没有环（实得 ' + storeOf(env.gh) + '）')
}

// ── ③ 互不相干且不成环的两条边仍然同时做（钉住 d9663ad 的组间并行）──
{
  const env = makeEnv({ rendezvousPosts: true, tickMs: 2 })
  let inFlight = 0
  let peak = 0
  const origExec = env.backendCtx.exec
  env.backendCtx.exec = async (cmd, args) => {
    const line = Array.isArray(args) ? args.join(' ') : ''
    const isPost = /dependencies\/blocked_by\s+--method POST/.test(line)
    if (isPost) { inFlight += 1; if (inFlight > peak) peak = inFlight }
    try { return await origExec(cmd, args) } finally { if (isPost) inFlight -= 1 }
  }
  const tool = linkMod.createDeckMapLink(env.toolDeps())
  const out = await tool.run(EXEC, { edges: [{ key: '1', blockedBy: ['2'] }, { key: '3', blockedBy: ['4'] }] })
  check(out.status === 'ok', '③ 两条不相干且不成环的边都建成（实得 status=' + out.status + ' ' + JSON.stringify(itemsOf(out)) + '）')
  check(hasCycleInStore(env.gh) === false, '③ 这两条不成环（实得 ' + storeOf(env.gh) + '）')
  check(peak >= 2, '③ 组间并行原样保留：两笔写同时在飞（峰值 ' + peak + '，要求 ≥2）')
}

// ── ④ 整图读不回时不猜、如实说 ──
{
  const env = makeEnv({ tickMs: 1 })
  env.tracker.list = async () => ({ ok: false, error: { kind: 'env', message: 'probe: 列表读不回' } })
  const tool = linkMod.createDeckMapLink(env.toolDeps())
  const out = await tool.run(EXEC, { edges: [{ key: '1', blockedBy: ['2'] }] })
  const notes = String((out.notes || []).join(' '))
  check(notes.indexOf('整批成环预检没读到整图') >= 0, '④ 读不回整图时不假装预检过了：notes 里如实说（实得 ' + notes.slice(0, 150) + '）')
  check(out && typeof out.status === 'string', '④ 这一步失败不影响工具照旧回话（status=' + out.status + '）')
}

console.log(failed ? '\n存在失败 — verify-929-batch-cycle 未通过' : '\n全部通过 — 同批并发补边不再造出环（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
