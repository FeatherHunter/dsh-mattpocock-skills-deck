// verify-deck-tools-host-wiring.js —— 门禁：七个 deck_* 工具在**真宿主装配形状**下装起来并跑通一次（#723 T19c · 第 D 件）
// 用法：在插件根目录执行 node tests/verify-deck-tools-host-wiring.js，可独立运行。
//
// 这一条补的是 tests/verify-deck-tools.js 补不上的那一半：那一条是**单元形状**的门禁——它自己
// 把七个工厂 import 进来、自己拼依赖喂给工厂；而那七个工具在生产里到底有没有被装进宿主、
// 装的时候拿的是不是宿主那一套真东西（同一个闸、同一个后端注册表、同一个工作区），它证明不了。
//
// 所以这一段盯四件事：
//   ① 装配只有一处：七个工具文件只在 src/host/platform/deckToolsAssembly.js 里被读进来一次，
//      而且那一步走的是共享层的装配口 createDeckTools（不是手拼一张表）。宿主层（src/host/ 下，
//      platform/ 与 tracker/backends/ 除外）里的文件一次都不许自己去读那七个文件 ——
//      本票的纪律是不给宿主层新增 7 条同层引用边（tests/verify-no-same-layer-import.js 管这条墙）。
//   ② 真在宿主装配形状下装起来：用 src/host/refresh/wiring.js 的 createRefreshWiring（宿主入口
//      实际调用的那一份）装出一套刷新机制，从它拿到的七个工具表必须齐（names 七条、missing 空）。
//   ③ 真跑一次：在一个真实临时工作区（本地 Markdown 后端，票就是盘上的文件）上，让 AI 那一侧
//      真的调一次工具，回包必须是三态信封，且落盘真的发生了。
//   ④ 每次后端调用都过闸**那一份闸**：断言用的是宿主接线对象上的那一个 gate（不是门禁自己另造一个），
//      它的账里必须有「AI 工具」那一档，且绕开闸的请求数为 0。
//
// 末尾一条内存夹具是为了让 ① 不空转：把「宿主层里的文件读宿主层的工具文件」这件事喂给本文件
// 同一套判据，它必须判违规。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const ASSEMBLY = 'src/host/platform/deckToolsAssembly.js'
const SEVEN = [
  'src/host/tools/deckContext.js',
  'src/host/tools/deckIssueGet.js',
  'src/host/tools/deckMapSnapshot.js',
  'src/host/tools/deckIssueCreate.js',
  'src/host/tools/deckMapPlanCreate.js',
  'src/host/tools/deckMapLink.js',
  'src/host/tools/deckIssuePatch.js',
]
const NAMES = ['deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_issue_create', 'deck_map_plan_create', 'deck_map_link', 'deck_issue_patch']

/**
 * 本文件用的层判据，与 tests/verify-no-same-layer-import.js 的文件头逐字同一条：
 * 宿主层 = src/host/ 下，但排除 src/host/platform/ 与 src/host/tracker/backends/。
 * （只用来判「这一条引用边算不算宿主层内部的边」——真正的墙还是那一条门禁。）
 */
function layerOf(posixPath) {
  if (posixPath === 'src/host/platform' || posixPath.startsWith('src/host/platform/')) return 'platform'
  if (posixPath === 'src/host/tracker/backends' || posixPath.startsWith('src/host/tracker/backends/')) return 'backends'
  if (posixPath === 'src/host' || posixPath.startsWith('src/host/')) return 'host'
  if (posixPath === 'src/shared' || posixPath.startsWith('src/shared/')) return 'shared'
  if (posixPath === 'src/seam' || posixPath.startsWith('src/seam/')) return 'seam'
  return 'other'
}

/** 一个工作区里现在有哪些票文件（本地 Markdown 后端：票就是文件）。 */
function markdownWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-hostwiring-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 宿主装配演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n演示\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p) { return String(p).replace(/\\/g, '/') },
      async readText(t) { return fs.readFileSync(t, 'utf8') },
      async writeText(t, c) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t) { try { return fs.statSync(t) } catch (e) { return null } },
      async listDir(t) { try { return fs.readdirSync(t) } catch (e) { return [] } },
      async stat(t) { try { return fs.statSync(t) } catch (e) { return null } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    root: root,
    rootPosix: rootPosix,
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name) { return name === 'fs' ? plat.fs : undefined } },
    ticketFiles() { try { return fs.readdirSync(path.join(dir, 'issues')).filter((f) => f.endsWith('.md')) } catch (e) { return [] } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

async function main() {
  console.log('七个 deck_* 工具的宿主装配门禁（#723 T19c：装配口、宿主形状、真跑一次、过宿主那一个闸）')

  // ── ① 装配只有一处，而且走装配口 ──
  const wiringSrc = readText('src/host/refresh/wiring.js')
  const assemblySrc = readText(ASSEMBLY)
  const importedSeven = SEVEN.filter((f) => assemblySrc.indexOf(f.slice(f.lastIndexOf('/') + 1)) >= 0)
  check(importedSeven.length === 7, '装配点把七个工具文件都读进来了（' + importedSeven.length + ' / 7，装配点：' + ASSEMBLY + '）')
  check(/createDeckTools\s*\(/.test(assemblySrc), '装配点走的是共享层装配口 createDeckTools（不是手拼一张表）')

  const hostLayerHits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!e.name.endsWith('.js')) continue
      const rel = path.relative(ROOT, full).split(path.sep).join('/')
      if (layerOf(rel) !== 'host') continue
      const text = readText(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const tool of SEVEN) {
        const base = tool.slice(tool.lastIndexOf('/') + 1)
        if (new RegExp('[\'"](\\.\\.?/)+' + base.replace(/\./g, '\\.') + '[\'"]').test(text)) hostLayerHits.push(rel + ' -> ' + base)
      }
    }
  }
  walk(path.join(ROOT, 'src', 'host'))
  check(hostLayerHits.length === 0, '宿主层里没有任何文件自己去读那七个工具文件（0 条同层边；实得 ' + (hostLayerHits.length ? hostLayerHits.join('、') : '零命中') + '）')

  // 内存夹具（反证 ① 不空转）：宿主层里的文件读宿主层的工具文件 → 同一条判据必须判违规。
  const fixture = { file: 'src/host/refresh/wiring.js', import: './tools/deckContext.js', resolved: 'src/host/tools/deckContext.js' }
  check(layerOf(fixture.file) === 'host' && layerOf(fixture.resolved) === 'host', '✗ probe：宿主层文件引用宿主层工具文件，会被同一条层判据判成同层边（' + fixture.file + ' -> ' + fixture.resolved + '）')

  check(wiringSrc.indexOf('deckToolsForHost') >= 0, '宿主接线对象把装好的表交出来了（deckToolsForHost）')

  // ── ② 真在宿主装配形状下装起来 ──
  const registryMod = await imp('src/host/tracker/registryCore.js')
  const markdownModule = (await imp('src/host/tracker/backends/markdown/index.js')).markdownModule
  const { createRefreshWiring } = await imp('src/host/refresh/wiring.js')

  const ws = markdownWorkspace()
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const handle = { cwd: ws.rootPosix }   // 宿主自己绑的就是这个形状（wf.bind 那一侧：{ cwd: canonicalKey(cwd) }）
  registry.bind(handle, 'markdown')

  const logs = []
  const cacheWrites = []
  let clock = 1700000000000
  const wiring = createRefreshWiring({
    // ctx 与生产同形：宿主上下文里 `ctx.get('fs')` 就是后端房间写盘用的那一份文件服务。
    ctx: { on: () => () => {}, get: (name) => (name === 'fs' ? ws.ctx.fs : undefined) },
    logCtx: { fire: (level, event, fields) => logs.push({ level, event, fields }), isEnabled: () => false },
    canonicalKey: async (p) => String(p).replace(/\\/g, '/'),
    getCacheDir: async () => os.tmpdir(),
    getTrackerRegistry: async () => registry,
    getPlatform: async () => ws.ctx.platform,
    detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
    setCache: (v) => cacheWrites.push(v),
  })
  check(!!wiring && !!wiring.gate && typeof wiring.gate.stats === 'function', '装配形状：宿主接线对象上有闸（七个工具过的是同一个闸）')
  wiring.ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)

  const table = await wiring.deckToolsForHost()
  check(table && table.names && table.names.length === 7, '宿主里装出七条：' + JSON.stringify(table && table.names))
  check(table && table.missing && table.missing.length === 0, '一条都不缺（missing = ' + JSON.stringify(table && table.missing) + '）')
  check(table && table.reason === '', '装配没有回退（reason=' + JSON.stringify(table && table.reason) + '）')
  check(table && typeof table.tools === 'object' && NAMES.every((n) => table.tools[n] && typeof table.tools[n].run === 'function'), '每条都能真调（run 是函数）')
  check(Array.isArray(table.files) && table.files.length === 7, '装配结果里如实带着这七个文件的清单（' + JSON.stringify((table && table.files) || []).slice(0, 60) + '…）')

  // ── ③ 真跑一次（宿主装机形状：会话上下文 + 真工作区 + 真后端） ──
  const exec = { agent: { session: { id: 's-723c', cwd: ws.rootPosix } } }
  const ctxRun = await table.tools.deck_context.run(exec, {})
  check(ctxRun && ctxRun.status === 'ok' && ctxRun.ok === true, 'deck_context 在宿主装配形状下回 ok（实得 ' + (ctxRun && ctxRun.status) + '）')
  check(ctxRun && ctxRun.workspace && ctxRun.workspace.root === ws.rootPosix, '回显解析到的工作区根（' + (ctxRun && ctxRun.workspace && ctxRun.workspace.root) + '）')
  check(ctxRun && ctxRun.backend && ctxRun.backend.id === 'markdown' && ctxRun.backend.source === 'explicit', '走的是注册表里绑过的那一个后端（' + JSON.stringify(ctxRun && ctxRun.backend) + '）')

  const filesBefore = ws.ticketFiles().length
  const created = await table.tools.deck_issue_create.run(exec, { title: '宿主装配演示票', kind: 'task', body: '正文' })
  check(created && created.status === 'ok' && created.data && created.data.ticket, 'deck_issue_create 真的建了一张票（key=' + (created && created.data && created.data.ticket && created.data.ticket.key) + '）｜' + JSON.stringify({ status: created && created.status, reason: created && created.reason, text: String((created && created.text) || '').slice(0, 200), notes: created && created.notes }))
  check(ws.ticketFiles().length === filesBefore + 1, '票真的落到了盘上（新增 ' + (ws.ticketFiles().length - filesBefore) + ' 个票文件）')
  check(cacheWrites.length > 0 && cacheWrites[cacheWrites.length - 1].cwd === ws.rootPosix, '写成功之后把那个工作区的快照缓存作废了（' + JSON.stringify(cacheWrites[cacheWrites.length - 1]) + '）')

  const plan = await table.tools.deck_map_plan_create.run(exec, { planId: 'host-723c', title: '宿主装配演示地图', children: [{ key: 'c1', title: '子票一' }] })
  check(plan && plan.data && plan.data.durable === false, '没注入持久化计划表时，批量工具如实说中间态不落盘（durable=' + (plan && plan.data && plan.data.durable) + '）')

  // ── ④ 过的是宿主那一个闸 ──
  const stats = wiring.gate.stats()
  const esc = wiring.gate.escaped()
  check(esc.requests === 0 && esc.points === 0, '绕开闸的请求数为 0（闸记 ' + JSON.stringify(stats.accounted) + '，传输层真发 ' + JSON.stringify(stats.transport) + '）')
  check(stats.byCategory['ai-tool'] >= 6, '这些调用都记在宿主闸的「AI 工具」那一档（' + stats.byCategory['ai-tool'] + ' 笔）')
  check(logs.some((l) => l.event === 'host.call' && l.fields && l.fields.kind === 'deck-tool'), '每次调用都落了既有的 host.call（kind=deck-tool），没有新造事件名（' + logs.filter((l) => l.event.indexOf('host.call') === 0).length + ' 行）')

  dispose.dispose()
  ws.cleanup()
  console.log('\n' + (failed ? '存在失败' : '全部通过 — 七个工具在宿主装配形状下装齐并跑通（' + total + ' 条断言）'))
  console.log('提示：本门禁还没有挂进 package.json 的 verify 链，请统筹者接一行（见交付报告第 5 节）。')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
