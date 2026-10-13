// tests/verify-1109-matches-timeout.ts —— 门禁：#1109 把「选后端」的兜底等待从 3 秒放到 30 秒
//
// 这一条盯票面「判据（做完）」的三条，外加票面「怎么证」里点名的那条缝：
//   ① 生产装配路径（src/host/platformChannel.js 里建的那个后端注册表）实际申请的等待是 30000ms；
//   ② 显式绑定命中时一次计时器都不起（快路径不等兜底）；
//   ③ 等待超时之后仍然是「还没答完」（pending=true），不是「没有后端」（不是 other、不是干净回落）；
//   ④ 经 deck 工具进来的那条路（宿主接线 src/host/refresh/wiring.js 造的后端上下文）也要走注入的
//      等待口，而不是全局时钟——否则它一挂住，门禁就只能真等 30 秒，看不住。
//
// ① 怎么盯：不看源码文本、不读常量，而是给注册表一个假计时器，看它**真的申请了多少毫秒**。
//   注册表每问一个后端「你是不是这个仓库的后端」（registryCore.withTimeout），都会先申请一个计时器，
//   假计时器把这笔账逐条记下来。运行期谁把 3000 写回去，这里立刻变红。
//
// 用法（手工跑要自己挂装载钩子；npm test / verify:parallel / verify-all / test:smoke 四个入口自动挂）：
//   node --import ./scripts/ts-hook.mjs tests/verify-1109-matches-timeout.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 票面那个数：每一路后端识别的兜底等待（毫秒）。 */
const WANT_MS = 30000
/** 等一下微任务，让 select 内部把 matches 都问出去。 */
const tick = () => new Promise((r) => setImmediate(r))

type TimerFn = () => void

/**
 * 假计时器：把每一笔「申请了多久的等待」逐条记下来。
 * 只有没被撤销的才算真的会超时——撤销了说明那一份 matches 早就答完了，这一笔不该算进「等不到」。
 */
function makeFakeTimers() {
  const calls: number[] = []
  const live = new Map<number, TimerFn>()
  let seq = 0
  return {
    /** 申请过的等待毫秒数（含后来撤销的）。 */
    calls,
    /** 递给注册表的口子，形状与 OpContext.timers 一致。 */
    api: {
      setTimeout(fn: TimerFn, ms: number) { seq += 1; calls.push(ms); live.set(seq, fn); return seq },
      clearTimeout(id: number) { live.delete(id) },
    },
    /** 还没被撤销的计时器有几个。 */
    liveCount() { return live.size },
    /** 把还没撤销的那些一次性触发，模拟「时间到了」。 */
    fireLive() { const fns = Array.from(live.values()); live.clear(); for (const fn of fns) fn() },
  }
}

/**
 * 临时工作区：宿主侧的后端识别读的就是这个目录。
 * 默认留空（谁都不命中，用来验「干净回落」）；withMarkdown 时按本地 Markdown 后端的形状铺一份
 * （票就是盘上的文件：`.scratch/<名字>/map.md`），deck 工具那条路要一个真的读得动的工作区。
 */
function makeWorkspace(tag: string, withMarkdown = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1109-' + tag + '-'))
  if (withMarkdown) {
    const dir = path.join(root, '.scratch', 'demo')
    fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'map.md'), '# 门禁演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n演示\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  }
  return {
    root,
    posix: root.replace(/\\/g, '/'),
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/**
 * 文件服务：按 DSH 的形状给（resolve 是「路径 → 目标」，会吃 opts.cwd）。
 * 这里必须认 opts.cwd：github 那一路读 `.git/config` 是靠 cwd 定位的，
 * 不认就会读到本仓的 .git/config（里面写着 github.com），把空目录误判成 GitHub 仓库。
 */
function makeFs() {
  const join = (p: string, cwd: string) => {
    const raw = String(p).replace(/\\/g, '/')
    const base = cwd ? String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') : ''
    if (!base || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return raw
    return base + '/' + raw.replace(/^\.\//, '')
  }
  return {
    async resolve(p: string, opts?: { cwd?: string }) { return join(p, (opts && opts.cwd) || '') },
    // 读不到就抛（真文件服务就是这个脾气）：读不动当空字符串的话，markdown 那一路的
    // 「文件在不在」会被误判成「在」，空目录就永远不能当谁都不命中的控制组了。
    async readText(t: string) { return fs.readFileSync(t, 'utf8') },
    async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    async stat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    async listDir(t: string) { try { return fs.readdirSync(t) } catch (e) { return [] } },
  }
}

/** 后端识别要的上下文（OpContext 的最小可用形状；exec 一律立刻回「这台机器不发真请求」）。 */
function makeOpCtx(cwd: string, fsSvc: ReturnType<typeof makeFs>, fake: ReturnType<typeof makeFakeTimers>) {
  return {
    cwd,
    platform: { path: path.posix, fs: fsSvc },
    fs: fsSvc,
    caller: 'verify-1109',
    exec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
    timers: fake.api,
  }
}

/** 宿主入口（src/host/index.js）喂给平台通道的那一份依赖，形状照抄生产。 */
function makeChannelDeps(cwd: string, fsSvc: ReturnType<typeof makeFs>, timerSvc: object) {
  return {
    ctx: {
      platform: { path: path.posix, fs: fsSvc },
      fs: fsSvc,
      cwd,
      get(name: string) { return name === 'fs' ? fsSvc : (name === 'timer' ? timerSvc : undefined) },
      set() {},
    },
    subprocess: {},
    timer: timerSvc,
    fs: fsSvc,
    DEFAULT_CWD: cwd,
    TIMEOUT_MS: 1000,
    getMattSkillProbeNames: () => [],
    getChainSkillNames: () => [],
    probeSkill: async () => ({ level: 'ok' }),
    logCtx: { fire() {}, isEnabled: () => false },
    getGate: () => null,
  }
}

async function main() {
  console.log('#1109 选后端的兜底等待：生产路径真的是 30000ms、快路径不起计时器、超时仍算「还没答完」')

  const { createPlatformChannel } = await imp('src/host/platformChannel.js')
  const { createRefreshWiring } = await imp('src/host/refresh/wiring.js')

  const wsA = makeWorkspace('a')
  const fsSvc = makeFs()
  // 宿主那支 timer 服务：形状与生产一致（timeout 交回一个可撤销的句柄）。
  const hostTimer = { timeout: (fn: TimerFn, ms: number) => { const id = setTimeout(fn, ms); return { dispose() { clearTimeout(id) } } } }

  // ── ① 生产装配路径：注册表是平台通道自己建的，每一笔等待都必须是 30000ms ──
  const channel = createPlatformChannel(makeChannelDeps(wsA.posix, fsSvc, hostTimer))
  const registry = await channel.getTrackerRegistry()
  check(!!registry && typeof registry.select === 'function', '生产装配路径交得出后端注册表（平台通道自己建的那一个）')

  const fakeA = makeFakeTimers()
  const handleFree = { cwd: wsA.posix }
  const selFree = await registry.select(handleFree, makeOpCtx(wsA.posix, fsSvc, fakeA))
  check(fakeA.calls.length >= 1, '空目录里问过至少一路后端，因此至少申请过一笔等待（实得 ' + fakeA.calls.length + ' 笔）')
  check(fakeA.calls.every((ms) => ms === WANT_MS), '生产装配路径申请的每一笔等待都是 ' + WANT_MS + 'ms（实得 ' + JSON.stringify(fakeA.calls) + '）')
  check(fakeA.liveCount() === 0, '内置几路都答完之后等待被撤销了，没有留下悬着的计时器（还剩 ' + fakeA.liveCount() + ' 个）')
  check(selFree.backendId === null && selFree.source === 'fallback' && selFree.pending === undefined,
    '控制组：谁都不命中且都答完了 → 干净回落（实得 ' + JSON.stringify(selFree) + '）')

  // ── ③ 超时那一路：挂住不答的后端必须落成「还没答完」，不是「没有后端」 ──
  const hanging = {
    id: 'probe-1109-hanging', label: '门禁夹具：永不回话的假后端',
    create: () => ({}),
    matches: () => new Promise(() => {}),
  }
  const reg = registry.register(hanging)
  const fakeB = makeFakeTimers()
  const pendingP = registry.select(handleFree, makeOpCtx(wsA.posix, fsSvc, fakeB))
  await tick()
  check(fakeB.calls.length === registry.modules().length && fakeB.calls.every((ms) => ms === WANT_MS),
    '多一路挂住的后端时，申请的每一笔等待仍是 ' + WANT_MS + 'ms（' + fakeB.calls.length + ' 笔，注册了 ' + registry.modules().length + ' 路）')
  check(fakeB.liveCount() >= 1, '答完的都撤销了，只剩挂住那一笔还悬着（实得 ' + fakeB.liveCount() + ' 笔）')
  fakeB.fireLive() // 时间到
  const selPending = await pendingP
  check(selPending.pending === true && selPending.backendId === null && selPending.source === 'fallback',
    '超时之后仍记「还没答完」（pending=true、backendId=null、source=fallback），实得 ' + JSON.stringify(selPending))
  check(selPending.backendId !== 'other' && selPending.source !== 'other', '不许把它说成 other（无后端）')
  reg.dispose()

  // ── ② 显式绑定命中：一次计时器都不该起 ──
  const wsB = makeWorkspace('b')
  const handleBound = { cwd: wsB.posix }
  registry.bind(handleBound, 'markdown')
  const fakeC = makeFakeTimers()
  const selBound = await registry.select(handleBound, makeOpCtx(wsB.posix, fsSvc, fakeC))
  check(fakeC.calls.length === 0, '显式绑定命中时一次计时器都没起（实得 ' + JSON.stringify(fakeC.calls) + '）')
  check(selBound.backendId === 'markdown' && selBound.source === 'explicit', '走的是显式那一路（实得 ' + JSON.stringify(selBound) + '）')

  // ── ④ 经 deck 工具进来的那条路：走宿主接线注入的等待口，不是全局时钟 ──
  const wsC = makeWorkspace('c', true)
  const fakeDeck = makeFakeTimers()
  const deckTimer = {
    timeout: (fn: TimerFn, ms: number) => { const id = fakeDeck.api.setTimeout(fn, ms); return { dispose() { fakeDeck.api.clearTimeout(id) } } },
    setTimeout: (fn: TimerFn, ms: number) => fakeDeck.api.setTimeout(fn, ms),
  }
  const wiring = createRefreshWiring({
    ctx: { on: () => () => {}, get: (name: string) => (name === 'fs' ? fsSvc : (name === 'timer' ? deckTimer : undefined)) },
    logCtx: { fire: () => {}, isEnabled: () => false },
    canonicalKey: async (p: string) => String(p).replace(/\\/g, '/'),
    getCacheDir: async () => os.tmpdir(),
    getTrackerRegistry: async () => registry,
    getPlatform: async () => ({ path: path.posix, fs: fsSvc }),
    detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
    setCache: () => {},
  })
  const table = await wiring.deckToolsForHost()
  check(!!table && Array.isArray(table.names) && table.names.length === 9, '宿主接线装出九条 deck 工具（实得 ' + JSON.stringify(table && table.names) + '）')
  // 给账本一份「额度管够」的读数：不喂的话第一笔读就被闸推迟（gate-defer），
  // 根本走不到选后端那一步，这条门禁就白盯了。
  const quota = () => ({ rest: { limit: 5000, remaining: 5000, reset: Date.now() + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: Date.now() + 3600000 } })
  wiring.ledger.syncServer(quota(), Date.now())

  const execFree = { agent: { session: { id: 's-1109-free', cwd: wsC.posix } } }
  await table.tools.deck_context.run(execFree, {})
  check(fakeDeck.calls.length >= 1 && fakeDeck.calls.every((ms) => ms === WANT_MS),
    'deck 工具那条路选后端时，起的是宿主接线注入的等待口，申请的还是 ' + WANT_MS + 'ms（实得 ' + JSON.stringify(fakeDeck.calls) + '）')

  const wsD = makeWorkspace('d', true)
  registry.bind({ cwd: wsD.posix }, 'markdown')
  const fakeDeck2 = makeFakeTimers()
  const deckTimer2 = {
    timeout: (fn: TimerFn, ms: number) => { const id = fakeDeck2.api.setTimeout(fn, ms); return { dispose() { fakeDeck2.api.clearTimeout(id) } } },
  }
  // 第二套接线换成第二个假计时器：只看「绑过的那一条快路径」起了几个。
  const wiring2 = createRefreshWiring({
    ctx: { on: () => () => {}, get: (name: string) => (name === 'fs' ? fsSvc : (name === 'timer' ? deckTimer2 : undefined)) },
    logCtx: { fire: () => {}, isEnabled: () => false },
    canonicalKey: async (p: string) => String(p).replace(/\\/g, '/'),
    getCacheDir: async () => os.tmpdir(),
    getTrackerRegistry: async () => registry,
    getPlatform: async () => ({ path: path.posix, fs: fsSvc }),
    detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
    setCache: () => {},
  })
  const table2 = await wiring2.deckToolsForHost()
  wiring2.ledger.syncServer(quota(), Date.now())
  const runBound = await table2.tools.deck_context.run({ agent: { session: { id: 's-1109-bound', cwd: wsD.posix } } }, {})
  check(fakeDeck2.calls.length === 0, 'deck 工具那条路遇到显式绑定命中时一次计时器都没起（实得 ' + JSON.stringify(fakeDeck2.calls) + '）')
  check(!!runBound && !!runBound.backend && runBound.backend.source === 'explicit', '回包说走的是绑过的那一个后端（实得 ' + JSON.stringify(runBound && runBound.backend) + '）')

  // ── 本文件必须在 verify 链里（不挂进链就等于没跑）──
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const steps = String(pkg.scripts.verify).split('&&').map((s: string) => s.trim())
  const mine = steps.filter((s: string) => s.indexOf('verify-1109-matches-timeout') >= 0)
  check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')

  wsA.cleanup(); wsB.cleanup(); wsC.cleanup(); wsD.cleanup()
  console.log('\n' + (failed ? '不通过' : '全部通过') + ' — ' + total + ' 条断言')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
