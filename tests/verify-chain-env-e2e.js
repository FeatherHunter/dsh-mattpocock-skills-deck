// tests/verify-chain-env-e2e.js —— 门禁：**进工作区之后「环境」那一格真的被检测过一次**（#724）
// 用法：在插件根目录执行 node tests/verify-chain-env-e2e.js，可独立运行。
//
// 为什么要有这一条：真机上出过一次「D:\ilife 工作区的状态栏那一格恒为红色 `--`（未知）」，宿主日志
// 里查不出原因 —— 因为查问题的路径完全在界面那一侧：客户端报了 107 次 `wf.chain` 全败，宿主这边
// 一个字都没留下。事后查清是「回话到了、里面没有链快照」（见 .tmp/map/briefs/调查-环境未知-report.md）。
// 只看代码形状查不出这件事（同一份代码在单测里是好的），必须**按生产装配跑一遍、看回话里有没有快照**。
//
// 这条门禁跑的就是生产那一套，一处都不换成桩：
//   · 宿主入口 `src/host/index.js` 的 `apply(ctx)`（wf.chain 那条电话由它按真实依赖清单装起来）；
//   · 真接线 `src/host/refresh/wiring.js`（它供的是闸与界面读数）；
//   · 真注册表 `src/host/tracker/registryCore.js`（经 `src/host/platformChannel.js` 装起来，不另造一个）；
//   · 真检查链 `src/host/detectChain.js` 与真退避 `src/host/refresh/chainBackoff.js`（**不给替身**）；
//   · 真客户端 `src/client/kernel/probe-chain.js` 的 `loadChain`（按 tests/verify-669-chain-after-pick.js
//     同一套沙箱取真身）与真通道解包 `src/seam/rpc.js` 的 `createPkgHost`。
// 换掉的只有「外面那个世界」：起进程（`subprocess` 服务）与 gh / git 的答复、以及时基。界面那一层不碰。
//
// 它盯三件事（打勾的是这次故障里真的坏掉的那几条）：
//   一、一笔不带 force 的 `wf.chain` 回话里**真的有链快照**（`ok:true` 且带 `fullSnapshot`/`snapshot`）；
//   二、紧接着第二笔不带 force 的 `wf.chain`（会被退避挡下、直接回上一份的那种）**同样带快照** ——
//      ✔ 就是这一条坏了：从前被挡下时回的是「光一份快照」（没有 `ok` 那一栏），客户端判成「回话里没有内容」，
//        于是状态栏那一格永远等不到读数（真机日志里的 `host.call.fail` + `chain.derive.error` 就是它）；
//   三、环境那几步有结论（不是全 pending、也不是 `ok:false`），且真客户端的 `loadChain` 跑完之后
//      会话状态里真的有了链快照、`envLabel` 不再是 `--` —— 这才是「进工作区后环境被检测过一次」。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// ── 一个最小宿主：只给 src/host/index.js 真正会用到的那五个服务 ────────────────────────────
// 起进程那一层换掉是为了不起真 gh / 真 git；答复按 argv 回一份最少的、够把 gh 那几步判成 done 的输出。
function makeHost () {
  const seen = { spawn: [] }
  const replyFor = function (argv) {
    const argv0 = String(argv[0] || '')
    const a = argv.slice(1).map(String).join(' ')
    if (/git(\.exe)?$/i.test(argv0)) return (a.indexOf('remote get-url origin') >= 0) ? 'git@github.com:FeatherHunter/ilife.git\n' : ''
    if (a === 'auth status') return 'github.com\n  ok Logged in to github.com account FeatherHunter (keyring)\n'
    if (a.indexOf('api user') === 0) return 'FeatherHunter\n'
    if (a.indexOf('api repos/') === 0) return '{}\n'
    if (a === '--version') return 'gh version 2.62.0 (2025-01-01)\n'
    return '{}\n'
  }
  const subprocess = {
    async resolveExecutable (n) { return String(n) === 'gh' ? 'C:/fake/gh.exe' : 'C:/fake/git.exe' },
    spawn (req) {
      // 宿主那条真出口是 spawn({ argv, cwd, … })（按 tests/verify-refresh-workspace-key.js 的 same 形状）；
      // 这里只答 argv 那一段，够把 gh / git 的几条判断拼出来。
      const argv = ((req && req.argv) || []).map(String)
      const out = replyFor(argv)
      seen.spawn.push(argv.join(' ') || '(空 argv)')
      return {
        stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, terminate: () => {},
        done: Promise.resolve({ exitCode: 0 }),
        collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: '' }) } },
      }
    },
  }
  const timer = {
    timeout: (a, b) => (typeof a === 'function' ? setTimeout(a, b) : new Promise((r) => { setTimeout(r, a) })),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  }
  const fsSvc = {
    readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {},
    readdirSync: () => [], statSync: () => ({ isDirectory: () => false }),
    promises: { readFile: async () => '', writeFile: async () => {}, mkdir: async () => {}, readdir: async () => [], stat: async () => null },
  }
  const platformSvc = {
    getHome: async () => 'C:/Users/fake',
    path: { join: (...a) => a.join('/'), posix: { join: (...a) => a.join('/') } },
    fs: {
      async resolve (p) { return String(p).replace(/\\/g, '/') },
      async readText () { return '' }, async writeText () {}, async lstat () { return null }, async stat () { return null }, async listDir () { return [] },
    },
    resolveExecutable: async (n) => (String(n) === 'gh' ? 'C:/fake/gh.exe' : 'C:/fake/git.exe'),
    env: { get: () => undefined }, os: 'win32',
  }
  const services = {
    subprocess, timer, fs: fsSvc, platform: platformSvc,
    connection: { fetch: { register: (r) => { services.__route = r; return () => {} } } },
  }
  const ctx = { get: (k) => services[k], effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} }, on: () => () => {} }
  return { ctx, services, seen }
}

/**
 * 按 DSH 的 client-request 信封打一笔电话（形状与 tests/smoke-host-dispatch.test.js 逐字一致）。
 * 回的是 `{ ok, value }` 那一层（宿主 rpcChannel 的 RpcResult），失败一律把 error.message 带出来 ——
 * 「电话抛错」与「回话里没有内容」在这里是两种不同形状，门禁要把它们分开说。
 */
function makeDispatch (route) {
  return async function (endpoint, args) {
    const res = await route.fetch({
      method: 'POST',
      url: 'http://127.0.0.1:1/api/dsws',
      json: async () => ({ type: 'client-request', rpcId: 'gate-724-' + endpoint, method: 'dsws', payload: { method: endpoint, payload: args } }),
    })
    const env = await res.json()
    const r = env && env.result
    return { ok: !!(r && r.ok), value: r && r.value, error: r && r.error && r.error.message }
  }
}

/** 这一份回话客户端认不认（口径逐字取自 src/client/kernel/probe-chain.js 第 132 行）。 */
const clientAccepts = (v) => !!(v && v.ok === true && (v.fullSnapshot || v.snapshot))
/** 宿主的兜底 catch 交出来的那一份（回话里明说失败）。 */
const isFailureEnvelope = (v) => !!(v && v.ok === false)

/** 退避挡下时回的那一份与真算一次回的那一份，步骤读数必须一致（不是空的、也不是别的工作区的）。 */
const stepIds = (v) => {
  const s = (v && (v.fullSnapshot || v.snapshot)) || null
  return (s && Array.isArray(s.steps)) ? s.steps.map((x) => String(x.id) + ':' + String(x.status)) : []
}

async function main () {
  console.log('进工作区之后「环境」真的被检测过一次（#724：生产装配形状，真接线 + 真注册表 + 真链 + 真客户端）')

  // ── 一、宿主侧：按生产装配把 wf.chain 装起来，打三笔电话 ────────────────────────────────
  const hostMod = (await imp('src/host/index.js'))
  const entry = hostMod.default || hostMod
  const host = makeHost()
  entry.apply(host.ctx)
  const t0 = Date.now()
  while (!host.services.__route && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20))
  const route = host.services.__route
  check(!!route && typeof route.fetch === 'function', '宿主入口把 /api/dsws 通道注册起来了（路由路径 ' + (route && route.path) + '）')
  if (!route) { console.log('\n存在失败 — 通道都没起，后面量不了'); process.exit(1) }

  const dispatch = makeDispatch(route)
  const CWD = process.cwd()

  const first = await dispatch('chain', { cwd: CWD, lang: 'zh' })
  check(!!first.ok, '第一笔不带 force 的 wf.chain 分发成功（信封 ok，拿不到就是通道层的事）')
  check(clientAccepts(first.value), '第一笔回话里真的有链快照（客户端判据 res.ok && (fullSnapshot||snapshot)）')
  check(!isFailureEnvelope(first.value), '第一笔不是「宿主兜底 catch」那一份（value.ok 不是 false）')

  // 第二笔是这次故障的正身：退避挡下时回的是不是完整回话。
  const second = await dispatch('chain', { cwd: CWD, lang: 'zh' })
  check(!!second.ok, '第二笔不带 force 的 wf.chain 分发成功')
  check(clientAccepts(second.value), '第二笔（退避挡下直接回上一份的那一路）回话里同样有链快照 —— 这一条就是真机 107 次全败的那一处')
  check(stepIds(second.value).length > 0, '第二笔回话里带着步骤读数（实得 ' + stepIds(second.value).length + ' 步），不是一份空壳')
  check(JSON.stringify(stepIds(second.value)) === JSON.stringify(stepIds(first.value)), '退避挡下回的那一份与真算一次回的那一份步骤读数一致')

  const third = await dispatch('chain', { cwd: CWD, lang: 'zh', force: true, trigger: 'user-recheck' })
  check(clientAccepts(third.value), '第三笔（人点「重新检查」，带 trigger=user-recheck）回话里也有链快照')

  // ── 二、环境那几步有结论（用真客户端的读数口径算，不另写一份）──────────────────────────
  const probeMod = await imp('src/client/kernel/probe-chain.js')
  const stOf = (v) => ({ cwd: CWD, chainSnapshot: (v && (v.fullSnapshot || v.snapshot)) || null })
  const snapSt = stOf(third.value)
  const nonPending = probeMod.envTotal(snapSt)
  const doneN = probeMod.readyCount(snapSt)
  check(nonPending > 0, '环境那几步有结论：非 pending 的步数实得 ' + nonPending + ' 步（为 0 就是客户端那个 `--`）')
  check(doneN >= 0, '其中判成 done 的步数实得 ' + doneN + ' 步（-1 = 一步都没算出来）')
  check(probeMod.envLabel(snapSt) !== '--', '真客户端的 envLabel 不再是 `--`（实得 ' + probeMod.envLabel(snapSt) + '）')
  console.log('  这一份链的步骤读数：' + stepIds(third.value).join(' | '))

  // ── 三、客户端侧：真 loadChain + 真通道解包，跑完会话状态里必须有链快照 ──────────────────
  // 沙箱做法与 tests/verify-669-chain-after-pick.js 的 C 组同一套：取 probe-chain.js 真身，
  // 把它的自由变量（host / wsKeyOf / 日志……）从外面喂进去；host 用生产那一支 createPkgHost。
  const rpcMod = await imp('src/seam/rpc.js')
  const pkgHost = rpcMod.createPkgHost(() => ({ get: (k) => (k === 'connection' ? { rpc: { call: async (channel, endpoint, body) => {
    const res = await route.fetch({
      method: 'POST',
      url: 'http://127.0.0.1:1' + channel + '/' + endpoint,
      json: async () => ({ type: 'client-request', rpcId: 'gate-724-seam', method: 'dsws', payload: body }),
    })
    const env = await res.json()
    return env && env.result
  } } } : undefined) }))
  const chainSrc = require('fs').readFileSync(path.join(ROOT, 'src/client/kernel/probe-chain.js'), 'utf8')
  const cache = new Map()
  const keyOf = (cwd, bid, lang) => String(cwd) + '|' + String(bid || '') + '|' + String(lang || '')
  const sandbox = {
    host: pkgHost,
    userHintOf: () => null,
    wsKeyOf: (p) => String(p || '').replace(/\\/g, '/').toLowerCase(),
    getChainCacheKey: keyOf,
    getCachedChain: (cwd, bid, lang) => cache.get(keyOf(cwd, bid, lang)) || null,
    setCachedChain: (cwd, bid, lang, snap) => { cache.set(keyOf(cwd, bid, lang), snap) },
    promptLang: () => 'zh', isEnabled: () => false,
    log: () => {}, dswsLogHash: (s) => 'h' + String(s || '').length, dswsLogTrunc: (s) => String(s || '').slice(0, 120),
    emit: () => {}, nowStr: () => '00:00:00',
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  const body = chainSrc.replace(/^[ \t]*export[ \t]+/gm, '') + '\n;return { loadChain: loadChain, envLabel: envLabel, envTotal: envTotal }'
  const client = new Function(...names, body)(...names.map((n) => sandbox[n]))

  // 会话状态：一个刚切进来的工作区，链快照还没有（真机现场就是这一格）。
  const st = { cwd: CWD, selection: null, chainSnapshot: null }
  const r1 = await client.loadChain(st, false)
  check(!!r1, '真客户端的 loadChain（不带 force，进工作区那一路）拿到了读数')
  check(!!st.chainSnapshot && Array.isArray(st.chainSnapshot.steps) && st.chainSnapshot.steps.length > 0, '这一跑之后会话状态里真的有了链快照（' + (st.chainSnapshot ? st.chainSnapshot.steps.length : 0) + ' 步）')
  check(client.envLabel(st) !== '--', '状态栏「环境」那一格算得出读数（envLabel = ' + client.envLabel(st) + '），不再是红色 `--`')

  // 再来一次（这一步在真机上会被退避挡下）—— 读数不许因此掉回「没有」。
  const r2 = await client.loadChain(st, false)
  check(!!r2, '紧接着的第二笔（退避挡下那一路）也拿到了读数')
  check(client.envLabel(st) !== '--', '第二笔之后那一格仍然有读数（envLabel = ' + client.envLabel(st) + '）')

  console.log('\n  这一跑起过的进程：' + (host.seen.spawn.length ? host.seen.spawn.join(' / ') : '（一次都没起）'))
  console.log('\n' + (failed ? '存在失败' : '全部通过 — 进工作区之后「环境」真的被检测过一次（' + total + ' 条断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
