// tests/verify-refresh-workspace-key.js —— 门禁：**同一个工作区根在闸里只许有一格**（#724 第一件）
// 用法：在插件根目录执行 node tests/verify-refresh-workspace-key.js，可独立运行。
//
// 为什么要有这一条：闸按一把工作区钥匙记账（活跃、失败次数、限流标记、推迟队列都在那一格上）。
// 钥匙算错一处，同一个工作区就会在闸里裂成两格：标活跃标在一格、过闸走另一格 —— 真机上出过一次
// 正是这个形状的事（.tmp/map/briefs/调查-环境未知-report.md 第 2.3 节：检查链那一笔记账把 cwd 原文
// 交给闸，而活跃集合用的是短散列，于是链的失败计数与限流标记落在另一格里，probe/patch 的退避看不到）。
//
// 这一条跑**真代码**、不做静态断言就下结论：
//   真接线 src/host/refresh/wiring.js 的 createRefreshWiring + 真闸与真账本（refresh/gate.js、ledger.js）
//   + 真检查链 src/host/detectChain.js 的 createDetectChain（gh 那一侧在假进程接缝上跑，不起真进程）。
// 它盯三件事：
//   一、钥匙只有一处：接线转出来的那把与共享层那一把是**同一个函数**，接线里不再有第二份散列写法；
//   二、三条路进闸带的是同一把钥匙、落在同一格上：① 视图模型标活跃（wf.focus → syncAttention）；
//      ② 检查链求值那一笔记账（detectChain 的 noteChainEval）；③ 七个 deck_* 工具里的一次调用过闸。
//      其中 ① 与 ② 正是真机那次错位的两半。
//   三、反证：把 cwd **原文**喂给闸，它就是另一格（后台档被判 background-inactive 推迟）——
//      这条判据有牙齿，改动把钥匙改回原文时，本门禁的第二组断言会红。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 本门禁的「宿主洗衣机」替身：与 src/host/workspaceKey.js 同一套口径（小写化、斜杠转正、去尾斜杠）。 */
function canon(p) {
  let s = String(p || '').replace(/\\/g, '/')
  while (s.length > 1 && s.charAt(s.length - 1) === '/') s = s.slice(0, -1)
  return s.toLowerCase()
}

/** 一个本地 Markdown 工作区（票就是盘上的文件）：七个 deck_* 工具要在一个真工作区上真跑一次。 */
function markdownWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-724-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 门禁演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n演示\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p) { return String(p).replace(/\\/g, '/') },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch (e) { return null } },
      async stat(t) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch (e) { return [] } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    root: root, rootPosix: rootPosix, canon: canon(rootPosix),
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/** 一次假的「起进程」：gh / git 的输出按 argv 回一份最少的、够检查链判成 done 的答复。 */
function makeSpawn() {
  const replyFor = (argv) => {
    const argv0 = String(argv[0] || '')
    const rest = argv.slice(1).map(String)
    const a = rest.join(' ')
    if (/git(\.exe)?$/i.test(argv0)) {
      return (a.indexOf('remote get-url origin') >= 0)
        ? 'git@github.com:FeatherHunter/demo.git\n'
        : ''
    }
    if (a === 'auth status') return 'github.com\n  ok Logged in to github.com account FeatherHunter (keyring)\n'
    if (a.indexOf('api user') === 0) return 'FeatherHunter\n'
    if (a.indexOf('api repos/') === 0) return '{}\n'
    if (a === '--version') return 'gh version 2.62.0 (2025-01-01)\n'
    return '{}\n'
  }
  return (req) => {
    const argv = ((req && req.argv) || []).map(String)
    const out = replyFor(argv)
    return {
      done: Promise.resolve({ exitCode: 0 }),
      collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: '' }) } },
      terminate() {},
    }
  }
}

/**
 * 装一套真模块：真接线 + 真闸（外面套一层「把过闸带的钥匙记下来」的壳）+ 真检查链。
 * 记下来的那一列就是我们唯一要看的东西 —— 每一次过闸带进了哪把钥匙。
 */
async function makeHost() {
  const wiringMod = await imp('src/host/refresh/wiring.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const detectChainMod = await imp('src/host/detectChain.js')
  const registryMod = await imp('src/host/tracker/registryCore.js')
  const markdownModule = (await imp('src/host/tracker/backends/markdown/index.js')).markdownModule

  const ws = markdownWorkspace()
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: ws.canon }
  registry.bind(handle, 'markdown')

  const clock = 1700000000000

  const spawn = makeSpawn()
  const platform = Object.assign({}, ws.ctx.platform, {
    resolveExecutable: async (n) => (String(n) === 'gh' ? 'C:/fake/gh.exe' : String(n) === 'git' ? 'C:/fake/git.exe' : null),
    env: { get: () => undefined },
    getHome: async () => 'C:/Users/fake',
    os: 'win32',
  })

  const ledger = ledgerMod.createLedger({ now: () => clock })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const realGate = gateMod.createGate({ ledger: ledger, now: () => clock })
  const seen = []   // 每一次过闸：带了哪把钥匙、什么种类、闸怎么判的
  const gate = {
    send: async (req, perform) => {
      const out = await realGate.send(req, perform)
      seen.push({ key: String((req && req.workspaceKey) || ''), kind: String((req && req.kind) || ''), source: String((req && req.source) || ''), verdict: out && out.verdict, reason: out && out.reason, sent: !!(out && out.sent) })
      return out
    },
    decideFor: (req) => realGate.decideFor(req),
    setWorkspace: (k, p) => realGate.setWorkspace(k, p),
    workspaceView: (k) => realGate.workspaceView(k),
    stats: () => realGate.stats(),
    escaped: () => realGate.escaped(),
    noteOutbound: (e) => realGate.noteOutbound(e),
    admitAiTool: (c, r) => realGate.admitAiTool(c, r),
    drain: (at) => realGate.drain(at),
  }

  const wiring = wiringMod.createRefreshWiring({
    ctx: { on: () => () => {}, get: (name) => (name === 'fs' ? ws.ctx.fs : undefined), },
    logCtx: { fire: () => {}, isEnabled: () => false },
    canonicalKey: async (p) => canon(p),
    getCacheDir: async () => os.tmpdir(),
    getTrackerRegistry: async () => registry,
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'markdown', source: 'explicit', pending: false } }) }),
    getPlatform: async () => platform,
    detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不起真进程' }),
    setCache: () => {},
    runGh: async (args) => {
      const h = spawn({ argv: ['gh'].concat(args || []), cwd: ws.canon })
      const outcome = await h.done
      return { ok: outcome.exitCode === 0, text: h.collected.stdout.readFrom(0).text, code: outcome.exitCode }
    },
    getRepoKey: async () => ({ owner: 'FeatherHunter', name: 'demo' }),
    issueIndexFromSnapshot: () => ({}),
    fetchIssueIndex: async () => ({ ok: false }),
    getCache: () => ({ ts: 0, snapshot: null, error: null, cwd: ws.canon }),
    ledger: ledger,
    gate: gate,
  })

  const chain = detectChainMod.createDetectChain({
    canonicalKey: async (p) => canon(p), DEFAULT_CWD: ws.canon,
    resetGhCache: () => {},
    getDetectionService: async () => ({ detect: async () => ({ selection: { backendId: 'markdown', source: 'explicit', pending: false } }) }),
    getPlatform: async () => platform,
    getTrackerRegistry: async () => registry,
    getRepoKey: async () => ({ owner: 'FeatherHunter', name: 'demo' }),
    runGh: async (args) => {
      const h = spawn({ argv: ['gh'].concat(args || []), cwd: ws.canon })
      const outcome = await h.done
      return { ok: outcome.exitCode === 0, text: h.collected.stdout.readFrom(0).text, code: outcome.exitCode }
    },
    timer: { timeout: (ms) => new Promise((r) => setTimeout(() => r(null), Math.min(ms, 5))), setTimeout: (fn, ms) => setTimeout(fn, ms) },
    probeSkill: async () => ({ ok: true, level: 'ok', detail: 'fake' }),
    mdParseOkPredicate: async () => ({ status: 'pass', detail: 'fake' }),
    getChainCache: () => null,
    setChainCache: () => {},
    getChainBackoff: async () => ({ verdict: async () => ({ needed: true, reason: 'due', waitMs: 0, cached: null }), note: async () => {} }),
    logCtx: null,
    gate: gate,
  })
  return { wiring: wiring, chain: chain, ledger: ledger, gate: gate, seen: seen, ws: ws, dispose: () => { try { dispose.dispose() } catch (e) {}; ws.cleanup() } }
}

/** 这个门禁用的两种写法：会话里可能出现的（大写盘符 + 反斜杠 + 尾斜杠）与规整之后的钥匙。 */
function spellings(canonRoot) {
  const raw = canonRoot.replace(/\//g, '\\').replace(/^([a-z])/, (m) => m.toUpperCase()) + '\\'
  return { raw: raw, canon: canonRoot }
}

async function main() {
  console.log('同一个工作区根在闸里只许有一格（#724：真接线 + 真闸 + 真检查链 + 一次真工具调用）')

  // ── 一、钥匙只有一处：接线的转出 = 共享层那一把（同一个函数，不是两份实现）──
  const wiringMod = await imp('src/host/refresh/wiring.js')
  const sharedMod = await imp('src/shared/refresh-workspace-key.js')
  check(typeof wiringMod.workspaceKeyOf === 'function', '接线转出 workspaceKeyOf（宿主这一侧取钥匙的唯一入口）')
  check(wiringMod.workspaceKeyOf === sharedMod.workspaceKeyOf, '接线转出的那把与共享层那把是同一个函数（实现只有一处）')
  const wiringSrc = read('src/host/refresh/wiring.js')
  const ownHash = (wiringSrc.match(/hash8\(String\(/g) || []).length
  check(ownHash === 0, '接线里不再自己抄一份钥匙（hash8(String(…)) 出现 ' + ownHash + ' 处，应为 0）')

  // ── 二、三条路进闸带的是同一把钥匙、落在同一格上 ──
  const host = await makeHost()
  const s = spellings(host.ws.canon)
  const K = wiringMod.workspaceKeyOf(s.canon)
  check(/^[0-9a-f]{8}$/.test(K), '钥匙形状是 8 位十六进制小写（实得 ' + K + '）')
  check(wiringMod.workspaceKeyOf(s.raw) !== K, '会话里那种写法（大写盘符 / 反斜杠 / 尾斜杠）本身不是钥匙：' + wiringMod.workspaceKeyOf(s.raw) + ' ≠ ' + K + '（所以传原文就会落进另一格）')

  // ① 视图模型：客户端报「我在看这个工作区」（报的是会话里那种写法），宿主洗过之后标活跃
  const focusOut = await host.wiring.attention.handleFocus({ windowId: 'w-724', workspaceRoot: s.raw, kind: 'focus', visible: true })
  check(!!(focusOut && focusOut.ok && focusOut.root === s.canon), 'wf.focus 上报的写法被洗成工作区根（' + (focusOut && focusOut.root) + '）')
  await host.wiring.syncAttention()
  const cell = host.gate.workspaceView(K)
  check(cell.active === true, '活跃集合标在钥匙 ' + K + ' 那一格上（active=' + cell.active + '）')

  // ② 检查链求值那一笔记账（真机那次错位的另一半）
  const chainOut = await host.chain.handleChain({ cwd: s.raw, backendId: 'markdown', lang: 'zh', force: true })
  check(!!(chainOut && chainOut.ok), '真跑一次检查链求值（ok=' + !!(chainOut && chainOut.ok) + '）')
  const chainSends = host.seen.filter((x) => x.kind === 'chain')
  check(chainSends.length === 1, '这一轮求值恰有一笔记账进闸（实得 ' + chainSends.length + ' 笔）')
  check(chainSends.length === 1 && chainSends[0].key === K, '链那一笔记账带的钥匙 = 活跃集合那把（实得 ' + (chainSends[0] && chainSends[0].key) + '，应为 ' + K + '）')
  check(chainSends.length === 1 && chainSends[0].sent === true && chainSends[0].verdict === 'allow', '链那一笔在同一格上被放行（' + (chainSends[0] && (chainSends[0].verdict + '/' + chainSends[0].reason)) + '）')

  // ③ 七个 deck_* 工具里的一次调用过闸（同一个闸、同一把钥匙）
  const table = await host.wiring.deckToolsForHost()
  check(!!(table && table.tools && table.tools.deck_context), '七个工具在宿主装配形状下装起来了（reason=' + JSON.stringify(table && table.reason) + '）')
  const exec = { agent: { session: { id: 's-724', cwd: s.canon } } }
  const ctxOut = await table.tools.deck_context.run(exec, {})
  check(!!(ctxOut && ctxOut.status === 'ok'), 'deck_context 真跑通一次（status=' + (ctxOut && ctxOut.status) + '）')
  const toolSends = host.seen.filter((x) => x.source === 'tool.call')
  check(toolSends.length >= 1, '这次工具调用过了闸（实得 ' + toolSends.length + ' 笔）')
  check(toolSends.length >= 1 && toolSends.every((x) => x.key === K), '工具调用带的钥匙也是同一把（' + JSON.stringify(toolSends.map((x) => x.key)) + '，应为 ' + K + '）')

  // 全部过闸的钥匙只有这一把 —— 「同一个工作区根在闸里只许有一格」
  const keys = Array.from(new Set(host.seen.map((x) => x.key)))
  check(keys.length === 1 && keys[0] === K, '这一轮所有过闸的钥匙只有一格（实得 ' + JSON.stringify(keys) + '）')
  check(host.seen.every((x) => /^[0-9a-f]{8}$/.test(x.key)), '没有任何一笔带的是目录原文：过闸的钥匙一律是 8 位短散列（' + JSON.stringify(host.seen.map((x) => x.key)) + '）')

  // ── 三、反证：把原文喂给闸，它就是另一格（这条判据有牙齿）──
  const rawSelf = host.gate.decideFor({ source: 'probe.tick', kind: 'probe', workspaceKey: s.raw })
  const keyedSelf = host.gate.decideFor({ source: 'probe.tick', kind: 'probe', workspaceKey: K })
  check(keyedSelf.verdict === 'allow' && keyedSelf.reason === 'background-fits', '同一格（钥匙 ' + K + '）里后台档放行（' + keyedSelf.verdict + '/' + keyedSelf.reason + '）')
  check(rawSelf.verdict === 'defer' && rawSelf.reason === 'background-inactive', '反证：cwd 原文那一格不算活跃 —— 后台档被判推迟（' + rawSelf.verdict + '/' + rawSelf.reason + '），这正是「两把钥匙」的代价')

  host.dispose()
  console.log('\n' + (failed ? '存在失败' : '全部通过 — 同一个工作区根在闸里只有一格（' + total + ' 条断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
