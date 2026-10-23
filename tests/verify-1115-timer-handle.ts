// tests/verify-1115-timer-handle.ts —— 门禁：#1115 宿主计时器交回的是可调用句柄，撤销必须真的撤掉
//
// 这一条盯四件事：
//   ① 共享层那一份撤销判据（src/refresh/contract/host-timer-ports.ts）在**真形状**的句柄上真的撤得掉，
//      顺带把另外两档（数字句柄、带 dispose 的对象句柄）也照顾到；
//   ② 反面样本：原先那两种写法（直接全局 clearTimeout、先判 .dispose 再回退）在真形状上确实撤不掉 ——
//      这条是整扇门禁的意义所在：哪天假计时器不再复现真机形状，这里当场变红；
//   ③ 两个真实调用点用「句柄是函数」的假计时器服务真跑一遍，断言那笔等待答完之后不再悬着：
//      a. 平台通道的 getTimers（经它自己建的探测服务，src/host/platformChannel.js:316 / :326 那一份）；
//      b. 宿主接线的 backendObj.timers（经 deck 工具那条路，src/refresh/rooms/host/refresh-runtime.ts 那一份）；
//   ④ 六个调用点都走共享层那一份（静态钉住），共享层那份自己不 import 任何模块；
//   ⑤ 客户端那一份同款判断（src/client/hostShim.ts 的 timer.clearTimeout）也真跑一遍三档 ——
//      客户端叶子文件是构建时拼进闭包的文本，不能用 import 引共享层那份源码，只能照抄一套判断，
//      所以这里把「照抄的这一份」也拉到门禁下；并钉住 settings-view-write.js 撤销时走它。
//
// 为什么「真形状」要单独钉：宿主计时器服务由 DSH 里的 @deepseek-ai/cordis-plugin-timer 提供，
// 它的 timeout(回调, 毫秒) 交回的是一支**可调用的函数**（cordis 的 effect 撤销器）：不是数字句柄、
// 也没有 dispose 方法。仓里的假计时器从前都交回数字或 dispose 对象，所以「直接全局 clearTimeout」
// 这种写法在门禁里看不出毛病 —— 这一条门禁就是来堵这个洞的（#1115 的实测记录见票面证据一节）。
//
// 用法（手工跑要自己挂装载钩子；npm test / verify:parallel / verify-all / test:smoke 四个入口自动挂）：
//   node --import ./scripts/ts-hook.mts tests/verify-1115-timer-handle.ts
// 产物缺失时本门禁会自己先跑一次 node scripts/build.mts（真实调用点那两段读的是构建后的模块）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { planGates } from '../scripts/lib/discover-gates.ts'
import { sourcePath, spliceableJs } from './lib/source-text.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
let failed = false
let total = 0
const check = (ok: boolean, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

/** 票面那个数：选后端的兜底等待（毫秒）。 */
const WANT_MS = 30000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
type TimerFn = () => void

/**
 * 真形状的假计时器：timeout 交回一支**可调用的撤销器**（没有 dispose 方法），与 cordis-plugin-timer
 * 交给宿主的那一支同形。待触发的那些才算「还悬着」——撤销过的从集合里摘掉，与真插件的 effect 语义一致。
 */
function makeCordisTimer() {
  const pending = new Set<TimerFn>()
  const calls: number[] = []
  return {
    /** 申请过的等待毫秒数（含后来撤销的）。 */
    calls,
    /** 还没被撤销的计时器有几个。 */
    pendingCount() { return pending.size },
    /** 把还悬着的一次性触发，模拟「时间到了」（真插件到点时会先撤销再跑回调）。 */
    fireAll() { const fns = Array.from(pending); pending.clear(); for (const fn of fns) fn() },
    /** 递给宿主的那支计时器服务。 */
    service: {
      timeout(fn: TimerFn, ms?: number) {
        calls.push(Number(ms))
        pending.add(fn)
        // 真实撤销器：调它本身即取消；重复调是安全的（插件到点后会自己先撤一次）。
        return function cancel() { pending.delete(fn) }
      },
    },
  }
}

/** 临时工作区：宿主侧的后端识别读的就是这个目录，默认留空（谁都不命中）。 */
function makeWorkspace(tag: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1115-' + tag + '-'))
  return {
    posix: root.replace(/\\/g, '/'),
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 文件服务：按 DSH 的形状给（resolve 认 opts.cwd，读不到就抛）。 */
function makeFs() {
  const join = (p: string, cwd: string) => {
    const raw = String(p).replace(/\\/g, '/')
    const base = cwd ? String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') : ''
    if (!base || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return raw
    return base + '/' + raw.replace(/^\.\//, '')
  }
  return {
    async resolve(p: string, opts?: { cwd?: string }) { return join(p, (opts && opts.cwd) || '') },
    async readText(t: string) { return fs.readFileSync(t, 'utf8') },
    async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
    async lstat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    async stat(t: string) { try { return fs.statSync(t) } catch (e) { return null } },
    async listDir(t: string) { try { return fs.readdirSync(t) } catch (e) { return [] } },
  }
}

/**
 * 平台通道要的依赖（形状照抄 tests/verify-1109-matches-timeout.ts 那一套）。
 * 与那条门禁的差别只有一处：这里把后端注册表也从 ctx 注入（`ctx.get('trackerRegistry')`），
 * 于是能拿到探测服务里那份 opCtx，直接验它身上的计时器口。
 */
function makeChannelDeps(cwd: string, fsSvc: ReturnType<typeof makeFs>, timerSvc: object, registry: object) {
  const platform = { path: path.posix, fs: fsSvc, getHome: () => os.homedir() }
  return {
    ctx: {
      platform,
      fs: fsSvc,
      cwd,
      get(name: string) {
        if (name === 'fs') return fsSvc
        if (name === 'timer') return timerSvc
        if (name === 'platform') return platform
        if (name === 'trackerRegistry') return registry
        return undefined
      },
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
  console.log('#1115 宿主计时器句柄的撤销：真形状是可调用函数，六处调用点收成共享层一份')

  // ── 产地在盘上（真实调用点那两段读的是构建后的模块；缺了就先构建一次）──
  // #1425 起这份真源搬进 src/refresh/，产物由构建的 refresh-ts 段写进仓库根的 .build/refresh/
  // （真源仍是 src/refresh/contract/host-timer-ports.ts）；这里守的是「构建真能把这份产物写出来」。
  const PRODUCT = path.join(ROOT, '.build/refresh/contract/host-timer-ports.js')
  if (!fs.existsSync(PRODUCT)) {
    console.log('  共享层产物不在盘上，先跑一次 node scripts/build.mts ……')
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mts')], { cwd: ROOT, stdio: 'inherit' })
    check(r.status === 0, '共享层产物缺失时能靠 node scripts/build.mts 补上（退出码 ' + String(r.status) + '）')
  }
  check(fs.existsSync(PRODUCT), '新家产物 .build/refresh/contract/host-timer-ports.js 在盘上（构建 refresh-ts 段写）')

  const { hostTimers } = await imp('src/refresh/contract/host-timer-ports.ts')

  // ── ① 真形状长什么样（先把它钉死，后面两条正反样本才有据可依）──
  {
    const shape = makeCordisTimer()
    const handle: unknown = shape.service.timeout(() => {}, WANT_MS)
    check(typeof handle === 'function', '真句柄是一支可调用的函数（typeof=' + typeof handle + '）')
    check(typeof (handle as { dispose?: unknown }).dispose === 'undefined', '真句柄没有 dispose 方法（那是 cordis 的 effect 撤销器，不是带 dispose 的对象）')
    shape.fireAll()
  }

  // ── ② 共享层那一份：撤销之后那笔等待不再触发（真形状）──
  {
    const fake = makeCordisTimer()
    let fired = 0
    const timers = hostTimers(fake.service)
    const handle = timers.setTimeout(() => { fired += 1 }, WANT_MS)
    check(fake.calls.length === 1 && fake.calls[0] === WANT_MS, '申请等待走的是宿主计时器服务，毫秒数原样透传（实得 ' + JSON.stringify(fake.calls) + '）')
    check(fake.pendingCount() === 1, '刚申请时那笔等待是悬着的（实得 ' + fake.pendingCount() + ' 笔）')
    timers.clearTimeout(handle)
    check(fake.pendingCount() === 0, '撤销之后那笔等待不再悬着（实得 ' + fake.pendingCount() + ' 笔）')
    fake.fireAll()
    check(fired === 0, '撤销之后回调没有被触发（实得 ' + fired + ' 次）')
  }

  // ── ③ 反面样本一：直接全局 clearTimeout（函数句柄上静默无效）──
  {
    const fake = makeCordisTimer()
    let fired = 0
    const legacyGlobal = {
      setTimeout: (fn: TimerFn, ms?: number) => fake.service.timeout(fn, ms),
      clearTimeout: (id: unknown) => { try { clearTimeout(id as number) } catch (e) {} },
    }
    const handle = legacyGlobal.setTimeout(() => { fired += 1 }, WANT_MS)
    legacyGlobal.clearTimeout(handle)
    fake.fireAll()
    check(fired === 1, '反面样本：直接全局 clearTimeout 在真句柄上静默无效，回调照常触发（实得 ' + fired + ' 次）——这一条证明假计时器复现了真机形状，变红说明整条门禁失去意义')
  }

  // ── ④ 反面样本二：先判 .dispose 再回退（真句柄上没有 dispose，回退又落回全局 clearTimeout）──
  {
    const fake = makeCordisTimer()
    let fired = 0
    const legacyDispose = {
      setTimeout: (fn: TimerFn, ms?: number) => fake.service.timeout(fn, ms),
      clearTimeout: (id: unknown) => {
        try {
          const d = id as { dispose?: () => void } | null
          if (d && typeof d.dispose === 'function') d.dispose()
          else clearTimeout(id as number)
        } catch (e) {}
      },
    }
    const handle = legacyDispose.setTimeout(() => { fired += 1 }, WANT_MS)
    legacyDispose.clearTimeout(handle)
    fake.fireAll()
    check(fired === 1, '反面样本：先判 .dispose 再回退的那种写法在真句柄上同样无效，回调照常触发（实得 ' + fired + ' 次）')
  }

  // ── ⑤ 另外两档：数字句柄仍旧交全局 clearTimeout（用真时钟短延时验，撤得掉就一次都不触发）──
  {
    let fired = 0
    const numberService = { timeout: (fn: TimerFn, ms?: number) => setTimeout(fn, ms) }
    const timers = hostTimers(numberService)
    const handle = timers.setTimeout(() => { fired += 1 }, 20)
    timers.clearTimeout(handle)
    await sleep(80)
    check(fired === 0, '数字句柄那一档交回全局 clearTimeout，撤销之后不再触发（实得 ' + fired + ' 次）')
  }
  {
    // 带 dispose 的对象句柄：部分计时器服务与门禁夹具交回这种形状。
    let disposed = 0
    let fired = 0
    const disposeService = {
      timeout(fn: TimerFn) {
        let alive = true
        return { dispose() { alive = false; disposed += 1 }, fire() { if (alive) fn() } }
      },
    }
    const timers = hostTimers(disposeService)
    const handle = timers.setTimeout(() => { fired += 1 }, WANT_MS) as { fire(): void }
    timers.clearTimeout(handle)
    handle.fire()
    check(disposed === 1 && fired === 0, '带 dispose 的对象句柄走 dispose()，撤销之后不再触发（dispose 调用 ' + disposed + ' 次、触发 ' + fired + ' 次）')
  }
  {
    // 可调用且带 dispose 的包装句柄：计时器服务里 throttle / debounce 交回的就是这种形状
    // （_schedule 造的 wrapper：可调用，同时挂着 .dispose）。对它「调用句柄」等于再排一次，
    // 正好是撤销的反面，所以撤销必须先认显式的 .dispose。这一条钉住那个判断顺序。
    let disposed = 0
    let invoked = 0
    let fired = 0
    const wrapperService = {
      timeout(fn: TimerFn) {
        let alive = true
        return Object.assign(() => { invoked += 1; if (alive) fn() }, { dispose() { alive = false; disposed += 1 } })
      },
    }
    const timers = hostTimers(wrapperService)
    const handle = timers.setTimeout(() => { fired += 1 }, WANT_MS)
    timers.clearTimeout(handle)
    check(disposed === 1 && invoked === 0 && fired === 0, '可调用且带 dispose 的包装句柄走 dispose()，没有被当成撤销器调用（dispose 调用 ' + disposed + ' 次、调用句柄 ' + invoked + ' 次、触发 ' + fired + ' 次）')
  }

  // ── ⑥ 真实调用点 a：平台通道的 getTimers（经它自己建的探测服务，opCtx 里那一份）──
  {
    const ws = makeWorkspace('a')
    const fsSvc = makeFs()
    const fake = makeCordisTimer()
    const captured: Array<{ timers?: { setTimeout: (fn: TimerFn, ms?: number) => unknown; clearTimeout: (h: unknown) => void } }> = []
    const fakeRegistry = {
      async select(_handle: unknown, opCtx: { timers?: unknown }) { captured.push(opCtx as { timers?: { setTimeout: (fn: TimerFn, ms?: number) => unknown; clearTimeout: (h: unknown) => void } }); return { backendId: 'markdown', source: 'explicit', ref: { refId: '' } } },
      describe: () => ({ refId: '', name: '' }),
      get: () => null,
      has: () => false,
      modules: () => [],
    }
    const { createPlatformChannel } = await imp('src/host/platformChannel.js')
    const channel = createPlatformChannel(makeChannelDeps(ws.posix, fsSvc, fake.service, fakeRegistry))
    const svc = await channel.getDetectionService()
    let err = ''
    try { await svc.detect({ cwd: ws.posix }, { skipSkillProbes: true }) } catch (e) { err = String((e && (e as Error).message) || e) }
    check(err === '', '探测服务真的跑完了一遍选后端（异常：' + err + '）')
    check(captured.length >= 1, '探测服务把那笔调用交给了后端注册表，opCtx 抓到了 ' + captured.length + ' 份')
    const opCtx = captured[0]
    check(!!opCtx && !!opCtx.timers && typeof opCtx.timers.setTimeout === 'function', 'opCtx 上带着计时器口（平台通道 getTimers 那一份）')
    if (opCtx && opCtx.timers) {
      let fired = 0
      const handle = opCtx.timers.setTimeout(() => { fired += 1 }, WANT_MS)
      const before = fake.pendingCount()
      opCtx.timers.clearTimeout(handle)
      check(fake.pendingCount() === before - 1, '经平台通道那一份口申请、再撤销，悬着的等待少了一笔（' + before + ' → ' + fake.pendingCount() + '）')
      fake.fireAll()
      check(fired === 0, '经平台通道那一份口撤销之后，那笔等待不再触发（实得 ' + fired + ' 次）')
    }
    ws.cleanup()
  }

  // ── ⑦ 真实调用点 b：宿主接线的 backendObj.timers（经 deck 工具那条路，照 verify-1109 的 ④ 段）──
  {
    const ws = makeWorkspace('b')
    const fsSvc = makeFs()
    // 注册表用平台通道在**没有注入**时自己建的那一个（真内置三路）：deck 工具链要真的选一遍后端，
    // 这条路上的等待口才是宿主接线注入的那一份。
    const { createPlatformChannel } = await imp('src/host/platformChannel.js')
    const chanPlain = createPlatformChannel(makeChannelDeps(ws.posix, fsSvc, { timeout: () => undefined }, undefined))
    const registry = await chanPlain.getTrackerRegistry()
    check(!!registry && typeof registry.select === 'function', '生产装配路径交得出后端注册表（deck 工具那条路要它）')
    const fakeDeck = makeCordisTimer()
    const deckTimer = { timeout: (fn: TimerFn, ms?: number) => fakeDeck.service.timeout(fn, ms) }
    const { createRefreshWiring } = await imp('src/refresh/rooms/host/refresh-runtime.ts')
    const wiring = createRefreshWiring({
      ctx: { on: () => () => {}, get: (name: string) => (name === 'fs' ? fsSvc : (name === 'timer' ? deckTimer : undefined)) },
      logCtx: { fire: () => {}, isEnabled: () => false },
      canonicalKey: async (p: string) => String(p).replace(/\\/g, '/'),
      getCacheDir: async () => os.tmpdir(),
      getTrackerRegistry: async () => registry,
      getPlatform: async () => ({ path: path.posix, fs: fsSvc }),
      detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
      setCache: () => {},
    } as never)
    const table = await wiring.deckToolsForHost()
    check(!!table && !!table.tools && !!table.tools.deck_context, '宿主接线装得出 deck_context 那条工具（没有它这条门禁就白盯了）')
    // 额度管够：不喂的话第一笔读就被闸推迟（gate-defer），走不到选后端那一步。
    const quota = () => ({ rest: { limit: 5000, remaining: 5000, reset: Date.now() + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: Date.now() + 3600000 } })
    wiring.ledger.syncServer(quota(), Date.now())
    let err = ''
    try { await table.tools.deck_context.run({ agent: { session: { id: 's-1115-deck', cwd: ws.posix } } }, {}) } catch (e) { err = String((e && (e as Error).message) || e) }
    check(err === '', 'deck 工具那条路真的跑完了一遍（异常：' + err + '）')
    check(fakeDeck.calls.length >= 1 && fakeDeck.calls.every((ms) => ms === WANT_MS), 'deck 工具那条路起的是宿主接线注入的等待口，申请的还是 ' + WANT_MS + 'ms（实得 ' + JSON.stringify(fakeDeck.calls) + '）')
    check(fakeDeck.pendingCount() === 0, 'deck 工具那条路答完之后等待全被撤销，没有留下悬着的计时器（还剩 ' + fakeDeck.pendingCount() + ' 个）')
    ws.cleanup()
  }

  // ── ⑧ 六个调用点都走共享层那一份（静态钉住；谁把内联写法搬回来，这里当场红）──
  const SITES = [
    { file: 'src/host/platformChannel.ts', calls: 2 },
    { file: 'src/host/commentThreads.ts', calls: 1 },
    { file: 'src/host/workspaceCwd.ts', calls: 1 },
    { file: 'src/host/snapshotBuild.ts', calls: 2 },
    { file: 'src/refresh/rooms/host/refresh-runtime.ts', calls: 1 },
  ]
  for (const site of SITES) {
    const text = fs.readFileSync(path.join(ROOT, site.file), 'utf8')
    const got = (text.match(/hostTimers\(/g) || []).length
    check(got === site.calls, site.file + '：' + site.calls + ' 处计时器口都走共享层那一份（实得 ' + got + ' 处 hostTimers( 调用）')
    check(!/clearTimeout\s*:\s*(?:function|\()/.test(text), site.file + '：没有自己写 clearTimeout 字段的残留（六处原先的形态）')
    // 说明符自 #1425 起指向新家 `refresh/contract/host-timer-ports.js`（与调用文件同基准的相对路径：
    // src/host/ 下的用 `../refresh/contract/` 上一层，src/refresh/rooms/host/ 下的（#1426 起是宿主房）用 `../../contract/` 上两层；
    // tsc 靠扩展名替换解析到同名 .ts，包内镜像与 .build 产物由构建写）；判据是「引用的是新家那一份」。
    check(/from '(?:\.\.\/)+(?:refresh\/)?contract\/host-timer-ports\.js'/.test(text), site.file + '：静态引用了新家那一份（相对路径按目录深度）')
  }
  {
    const src = fs.readFileSync(path.join(ROOT, 'src/refresh/contract/host-timer-ports.ts'), 'utf8')
    // 只看代码，不看注释：文件头注释里本来就要提到 ctx.get('timer') 这个来处。
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check(!/^\s*import\s/m.test(codeOnly), 'host-timer-ports.ts 自己不 import 任何模块（判句柄形状自包含）')
    check(!/\brequire\s*\(/.test(codeOnly) && !/\bctx\s*\.\s*get\s*\(/.test(codeOnly), '共享层那一份不碰宿主专属入口（require / ctx）')
  }

  // ── ⑨ 客户端那一份同款判断：hostShim 的 timer.clearTimeout（叶子不能 import，照抄一套，这里真跑一遍）──
  {
    const shimRel = 'src/client/hostShim.js' // #1254：真源已转 src/client/hostShim.ts，spliceableJs 会解析到新真源
    // #1254：读到的是转译后的可拼接 JavaScript —— .ts 真源里的 `: any` 已被剥掉，
    //   所以下面 new Function 与 `\(id\)` 正则都不用改。
    const shimSrc = spliceableJs(shimRel)
    // #1254：真源转 .ts 后走转译，转译器把引号统一成双引号——这里按「形状」判顺序，不钉死哪种引号。
    const disposeIdx = shimSrc.search(/typeof id\.dispose === ['"]function['"]/)
    const fnIdx = shimSrc.search(/typeof id === ['"]function['"]/)
    check(disposeIdx > 0 && fnIdx > 0 && disposeIdx < fnIdx, shimRel + '：撤销顺序与共享层一致——先认显式 dispose、再才是调用句柄本身（本票复查改的那一处）')
    check(/clearTimeout:\s*function\s*\(id\)/.test(shimSrc), shimRel + '：timer 上挂着按形状撤销的那一份（客户端改调它的地方靠它）')
    // 按构建的做法（剥行首 export，叶子文本是缩进过的）把这片叶子拼成可求值的文本，喂一个「句柄是函数」的假宿主 timer 真跑。
    const body = shimSrc.replace(/^[ \t]*export /gm, '')
    const makeShim = () => new Function('ctx', 'React', body + '\n; return { timer: timer, _timerRaw: _timerRaw }')
    const fakeShim = makeCordisTimer()
    const mod = makeShim()({ get: (n: string) => (n === 'timer' ? fakeShim.service : undefined) }, { createElement: () => null })
    let fired = 0
    const h = mod.timer.timeout(() => { fired += 1 }, 30)
    check(typeof h === 'function' && (h as { dispose?: unknown }).dispose === undefined, shimRel + '：宿主真形状——timer.timeout 交回可调用、没有 dispose 的撤销器')
    mod.timer.clearTimeout(h)
    check(fakeShim.pendingCount() === 0, shimRel + '：clearTimeout 把那笔宿主等待真的撤掉了（还剩 ' + fakeShim.pendingCount() + ' 个）')
    fakeShim.fireAll()
    check(fired === 0, shimRel + '：撤销之后回调不再触发（实得 ' + fired + ' 次）')
    // 反面对照：旧写法（拿全局 clearTimeout 撤宿主句柄）在这一份上照样撤不掉。
    let firedOld = 0
    const h2 = mod.timer.timeout(() => { firedOld += 1 }, 30)
    clearTimeout(h2 as number)
    check(fakeShim.pendingCount() === 1, shimRel + '：反面对照——全局 clearTimeout 撤不掉宿主句柄，那笔等待还悬着（旧写法就是这里空转）')
    fakeShim.fireAll()
    check(firedOld === 1, shimRel + '：反面对照——撤不掉的那笔照常触发（实得 ' + firedOld + ' 次）')
    // 第二档：可调用且带 dispose 的包装句柄必须走 dispose()，不能被当成撤销器调用（调用等于再排一次）。
    let disposed = 0
    let invoked = 0
    const wrapper = function () { invoked += 1 } as TimerFn & { dispose?: () => void }
    wrapper.dispose = function () { disposed += 1 }
    mod.timer.clearTimeout(wrapper)
    check(disposed === 1 && invoked === 0, shimRel + '：可调用且带 dispose 的包装句柄走 dispose()、没有被当成撤销器调用（dispose ' + disposed + ' 次、调用 ' + invoked + ' 次）')
    // 第三档：宿主 timer 缺失时退回页面自己的句柄（Node 里是 Timeout 对象、浏览器里是数字），也得撤得掉。
    const mod2 = makeShim()({ get: () => undefined }, { createElement: () => null })
    let firedNum = 0
    const id = mod2.timer.timeout(() => { firedNum += 1 }, 20)
    check(id !== null && id !== undefined && typeof id !== 'function', shimRel + '：宿主 timer 缺失时退回页面自己的 setTimeout，交回的是非函数句柄（实得 ' + typeof id + '）')
    mod2.timer.clearTimeout(id)
    await sleep(60)
    check(firedNum === 0, shimRel + '：页面自己那一档（数字或 Timeout 对象）也撤得掉（实得 ' + firedNum + ' 次）')
    // 真实调用点：设置那一族写盘前的防抖等待撤销要走它（原先拿全局 clearTimeout 撤宿主句柄，是空操作）。
    // #1251：settings-view-write 已转成 .ts，同名 .js 是 esbuild 产物；这三条判据量的是源码里的写法，
    // 所以经 sourcePath 拿同名 .ts 真源（产物里 `typeof timer.clearTimeout === "function"` 是另一套文本）。
    const writeRel = sourcePath('src/client/kernel/settings-view-write.js')
    const writeSrc = fs.readFileSync(path.join(ROOT, writeRel), 'utf8')
    check(/viewFlagCancelTimer\(viewFlagState\.timer\)/.test(writeSrc), writeRel + '：撤销上一次排的那支等待走 viewFlagCancelTimer')
    check(!/clearTimeout\(viewFlagState\.timer\)/.test(writeSrc), writeRel + '：没有再做「拿全局 clearTimeout 撤宿主句柄」的旧写法')
    check(/typeof timer\.clearTimeout === 'function'/.test(writeSrc), writeRel + '：优先用 hostShim 那一份按形状撤销')
  }

  // ── ⑩ 本文件必须在 verify 链里（不挂进链就等于没跑；#1125 起问规划函数）──
  {
    const mine = planGates(ROOT).filter((s) => s.file.indexOf('verify-1115-timer-handle') >= 0)
    check(mine.length === 1, '本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
  }

  console.log('\n' + (failed ? '不通过' : '全部通过') + ' — ' + total + ' 条断言')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
