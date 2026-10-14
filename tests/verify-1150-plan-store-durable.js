// verify-1150-plan-store-durable.js —— 门禁：#1150 宿主接线给批量建图工具注入落盘的计划存储器
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mjs tests/verify-1150-plan-store-durable.js
//
// 这一条盯三件事：
//   ① 真宿主装配（src/host/refresh/wiring.js 的 createRefreshWiring）真的把落盘的存储器注入了批量建图工具。
//      夹具用的是**生产形状**的文件服务：读写在 resolve() 的产物（带 targetKey 的目标对象）上做，
//      拿裸路径串去读写会被当场拒绝——DSH 的 fs 契约就是这个形状（见 README「文件服务」那一节）。
//      为什么非要用这个形状：#1150 之前的老夹具收裸路径串，于是「工具以为自己在落盘、其实一个字节都没写出去」
//      这件事在门禁里完全看不出来（回执照样说 durable:true）。夹具自检那一条断言就是防这个假绿的。
//   ② 中间态真的落到盘上：工作区里出现 .dsh-mattskillsdeck-cache/deck-plans/ 下的游标文件，
//      里面的地图票号与回执里的 mapKey 一致，已建子票与回执的 builtKeys 对得上。
//   ③ 建一半断了能续跑：第二段换一整套装配（等价于进程重启，进程内存里什么都没有）带同一个 planId 再调一次，
//      回执里那句「地图票 X 上次已经建好了」只可能来自盘上读回来的游标；整张图建完之后游标被清掉。
//
// 断言只认回执与盘上文件，不读任何源码文本——改写法、搬文件都不该让它变红。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
// 夹具口：真生产装配读的就是工作区文件 docs/agents/workspace.yaml（面板选定写的那一份）。
const { writeWorkspaceFile } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

/**
 * 取出目标形状里的真实路径。生产那一份文件服务的读写只认 resolve() 的产物：
 * 给裸路径串它会拒绝（这正是本门禁要盯住的形状），所以夹具照抄这一点。
 */
function targetOf(v, api) {
  if (!v || typeof v !== 'object' || typeof v.targetKey !== 'string') {
    throw new Error('这一份文件服务的 ' + api + ' 只吃 resolve() 的产物（目标对象），这次拿到的是 ' + (typeof v))
  }
  return v.targetKey
}

/** 一个真实临时工作区：本地 Markdown 后端（票就是盘上的文件）+ 生产形状的文件服务。 */
function strictWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-store-1150-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'map.md'), '# 计划存储演示地图\n\nStatus: ready-for-agent\n\n## Destination\n\n演示\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n', 'utf8')
  const rootPosix = root.replace(/\\/g, '/')
  const fsSvc = {
    // 相对路径按 opts.cwd 展开（后端识别读 docs/agents/workspace.yaml 靠它定位）；回来的永远是目标对象。
    async resolve(p, opts) {
      const base = String((opts && opts.cwd) || '').replace(/\\/g, '/').replace(/\/+$/, '')
      const raw = String(p).replace(/\\/g, '/')
      const abs = (!base || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) ? raw : base + '/' + raw.replace(/^\.\//, '')
      return { targetKey: abs, displayPath: abs }
    },
    async readText(t) { return fs.readFileSync(targetOf(t, 'readText'), 'utf8') },
    // 生产那份文件服务没有 mkdir：建目录由写盘这一步自己带（夹具照此，不额外给能力）。
    async writeText(t, c) { const f = targetOf(t, 'writeText'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(c), 'utf8') },
    async listDir(t) { try { return fs.readdirSync(targetOf(t, 'listDir')) } catch (e) { return [] } },
    // lstat 在生产那一份里是路径形状（拿路径串），stat / 别的都吃目标对象；夹具两样都照抄。
    async lstat(p) { try { return fs.statSync(String(p)) } catch (e) { return null } },
    async stat(t) { try { return fs.statSync(targetOf(t, 'stat')) } catch (e) { return null } },
  }
  const plat = { path: path.posix, fs: fsSvc }
  return {
    root: root,
    rootPosix: rootPosix,
    ctx: { platform: plat, fs: fsSvc, cwd: rootPosix, get(name) { return name === 'fs' ? fsSvc : undefined } },
    /** 盘上现在有哪些票文件（本地 Markdown 后端：票就是文件）。 */
    ticketFiles() { try { return fs.readdirSync(path.join(dir, 'issues')).filter((f) => f.endsWith('.md')) } catch (e) { return [] } },
    /** 计划游标目录：一个工作区一个目录，一个计划一个小 JSON。 */
    cursorDir() { return path.join(root, '.dsh-mattskillsdeck-cache', 'deck-plans') },
    cursorFiles() { try { return fs.readdirSync(this.cursorDir()).filter((f) => f.indexOf('deck-plan-') === 0) } catch (e) { return [] } },
    /** 读回游标内容（空文件 = 已经清掉，不是「读不到」）。 */
    cursorText(name) { try { return fs.readFileSync(path.join(this.cursorDir(), name), 'utf8') } catch (e) { return null } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {} },
  }
}

/**
 * 装一套真宿主接线（宿主入口实际调用的那一份 createRefreshWiring），返回工具表。
 * 每次调用都新装一套：对应「进程重启」——进程内存里那份表是新的，上一段留下的东西只能从盘上读回来。
 */
async function assemble(ws, logs) {
  const registryMod = await imp('src/tracker/registry/core.ts')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.ts')).markdownModule
  const { createRefreshWiring } = await imp('src/host/refresh/wiring.js')
  const registry = registryMod.createRegistry(Object.assign({ logEvent: () => {}, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
  const dispose = registry.register(markdownModule)
  const wiring = createRefreshWiring({
    ctx: { on: () => () => {}, get: (name) => (name === 'fs' ? ws.ctx.fs : undefined) },
    logCtx: { fire: (level, event, fields) => logs.push({ level, event, fields }), isEnabled: () => false },
    canonicalKey: async (p) => String(p).replace(/\\/g, '/'),
    getCacheDir: async () => os.tmpdir(),
    getTrackerRegistry: async () => registry,
    getPlatform: async () => ws.ctx.platform,
    detectionExec: async () => ({ ok: false, kind: 'env', error: '门禁里不发真请求' }),
    setCache: () => {},
  })
  const clock = Date.now()
  wiring.ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
  const table = await wiring.deckToolsForHost()
  return { wiring: wiring, table: table, dispose: dispose }
}

async function main() {
  console.log('#1150 门禁：宿主接线注入落盘计划存储器（真落盘、断了能续跑）')
  const ws = strictWorkspace()
  const logs = []

  // ── 夹具自检：这一份文件服务必须是生产形状，否则「没落盘」这件事在本门禁里看不出来 ──
  let strictRejected = false
  try { await ws.ctx.fs.writeText(ws.rootPosix + '/不该收下.txt', 'x') } catch (e) { strictRejected = true }
  check(strictRejected, '✗ 夹具自检：拿裸路径串写盘会被拒（生产那份文件服务只认 resolve() 的产物）')
  check(!fs.existsSync(path.join(ws.root, '不该收下.txt')), '✗ 夹具自检：那一次被拒的写入没有留下文件')

  writeWorkspaceFile(ws.root, 'markdown')
  const first = await assemble(ws, logs)
  check(first.table && first.table.names && first.table.names.length === 9, '宿主里装出九条工具：' + JSON.stringify(first.table && first.table.names))
  check(first.table && first.table.missing && first.table.missing.length === 0, '一条都不缺（missing = ' + JSON.stringify(first.table && first.table.missing) + '）')

  const exec = { agent: { session: { id: 's-1150', cwd: ws.rootPosix } } }
  const children = [{ key: 'c1', title: '子票一' }, { key: 'c2', title: '子票二' }]
  const ticketsBefore = ws.ticketFiles().length

  // ── 第一段：建到一半（那条边的落点不存在，所以这一跑不会是「全成」，中间态必须留在盘上） ──
  const plan1 = await first.table.tools.deck_map_plan_create.run(exec, {
    planId: 'plan-store-1150', title: '计划存储演示地图', children: children, edges: [{ from: 'c1', to: '没有这张票' }],
  })
  check(plan1 && plan1.data && plan1.data.durable === true, '第一跑回执说这次是落盘的（durable=' + (plan1 && plan1.data && plan1.data.durable) + '）')
  check(!!(plan1 && plan1.data && plan1.data.mapKey), '第一跑建出了地图票（mapKey=' + (plan1 && plan1.data && plan1.data.mapKey) + '）')
  check(plan1 && plan1.status !== 'ok', '第一跑如实报了「没全成」（status=' + (plan1 && plan1.status) + '，那条边的落点不存在）：这才是「建到一半」的现场')
  const built1 = (plan1 && plan1.data && Array.isArray(plan1.data.builtKeys)) ? plan1.data.builtKeys.length : -1
  check(ws.ticketFiles().length === ticketsBefore + 3, '地图票与两张子票真的落到了盘上（票文件 ' + ticketsBefore + ' → ' + ws.ticketFiles().length + '，回执 builtKeys ' + built1 + ' 条）')

  const cursors1 = ws.cursorFiles()
  check(cursors1.length === 1, '盘上留下了一个计划游标文件：' + JSON.stringify(cursors1))
  let cursorState = null
  try { cursorState = JSON.parse(ws.cursorText(cursors1[0]) || 'null') } catch (e) { cursorState = null }
  check(!!cursorState && cursorState.mapKey === plan1.data.mapKey, '游标里的地图票号与回执一致（游标 ' + (cursorState && cursorState.mapKey) + ' ／ 回执 ' + plan1.data.mapKey + '）')
  check(!!cursorState && cursorState.keys && Object.keys(cursorState.keys).length === 2, '游标里记下了已建的两张子票：' + JSON.stringify(cursorState && cursorState.keys))

  // ── 第二段：换一套全新装配（等价于进程重启）带同一个计划标识接着建 ──
  const second = await assemble(ws, logs)
  const plan2 = await second.table.tools.deck_map_plan_create.run(exec, {
    planId: 'plan-store-1150', title: '计划存储演示地图', children: children,
  })
  check(plan2 && plan2.status === 'ok', '续跑这一跑全成了（status=' + (plan2 && plan2.status) + '，notes=' + JSON.stringify(plan2 && plan2.notes) + '）')
  check(plan2 && plan2.data && plan2.data.mapKey === plan1.data.mapKey, '地图票没有重建，还是同一张（' + (plan2 && plan2.data && plan2.data.mapKey) + '）')
  check(!!(plan2 && plan2.notes && plan2.notes.some((n) => String(n).indexOf('上次已经建好了') >= 0)), '回执里那句「地图票上次已经建好了」来自盘上读回来的游标（第二套装配进程内存里是空的）')
  check(ws.ticketFiles().length === ticketsBefore + 3, '续跑没有重复建票（票文件仍是 ' + ws.ticketFiles().length + ' 个）')
  check(!!(plan2 && plan2.data && plan2.data.skippedKeys && plan2.data.skippedKeys.length === 2), '两张子票都被认出来跳过了：' + JSON.stringify(plan2 && plan2.data && plan2.data.skippedKeys))
  const cursors2 = ws.cursorFiles()
  check(cursors2.length === 1 && ws.cursorText(cursors2[0]) === '', '整张图建成之后游标被清掉（写成空文件，读回来就是「没有」）')

  first.dispose.dispose()
  second.dispose.dispose()
  ws.cleanup()
  console.log('\n' + (failed ? '存在失败' : '全部通过 — 宿主接线把计划中间态真落盘，重启后靠它续跑（' + total + ' 条断言）'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁执行异常：' + ((e && e.stack) || e)); process.exit(1) })
