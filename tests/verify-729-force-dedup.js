#!/usr/bin/env node
/**
 * verify-729-force-dedup.js —— “点刷新不该另起一整趟”门禁（票 #729，一次性方案）
 *
 * 治的是什么：面板上有两条取数路（自动走 wf.snapshot、手动点刷新走 wf.refresh），
 * 从前强制刷新永远不查在途表（sessionSnapshot 里被 if (!isForce) 排除在外），
 * 而刷新路（sessionRefresh）整篇没有任何在途表 —— 在途时再点一次强制必另起一整趟，
 * 工作区越大越明显（52 张地图 / 950 张票 / 9.7MB 快照本机连着 30 秒超时）。
 * 本票把两条路接到同一张在途表（src/host/snapshotInflight.js），强制语义收敛为
 * “跳过缓存、要新数据”，不再是“再起一趟”。
 *
 * 复用规则（非对称，只拦该拦的）：
 *   强制只搭强制的车（#366：强制恒等于真重建，磁盘回放与 304 都不许冒充新鲜）；
 *   非强制搭任何车（顺风车只会更新鲜，与客户端 probe-stale.js 口径同构）。
 *
 * 覆盖（按票面验收逐条）：
 *   A. 快照路强制撞强制 → 只重建 1 次，且后来者记 dedup.hit（作用域为快照，不新增事件名）。
 *   B. 刷新路强制 x2 并发 → 只重建 1 次（此前整篇无表，必为 2）。
 *   C. 跨路：快照路强制在途 + 刷新路到达 → 共 1 次（只有共享表能过，是本方案区别于止血版的证明）。
 *   D. 口径钉死：强制撞非强制仍为 2（#366 不动）；非强制搭强制为 1；换后端为 2（键能分清）。
 *   E. 反证：把协调器规则拆掉（补丁副本），Take 永不搭车 —— 证明规则行是承重的；
 *      把整单回滚（临摹旧码：强制不查表）→ A/B/C 当场变红；静态钉住两处电话路的 Take/Park/Leave 接线。
 *   F. 本门禁已挂进 npm run verify 链；三处 src 文件都在 350 行内；两处电话路的新增同层边已记基线。
 *   G. 不要做的事钉死：客户端 30 秒死线一字未动；三处宿主文件无节流与防抖。
 *   H. 同 tick 并发（零延迟）：Take 到 Park 之间无等待点，确定性仍为 1（延迟 10ms 只是常量，不是遮羞布）。
 *
 * 测法：真跑 sessionSnapshot / sessionRefresh（计数重建次数，不起外部命令）+ 读源码断言。
 *
 * 用法：node tests/verify-729-force-dedup.js
 */
const fsx = require('fs')
const fsp = fsx.promises
const nodePath = require('path')
const nodeOs = require('os')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const read = (rel) => fsx.readFileSync(nodePath.join(ROOT, rel), 'utf8')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total++
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

const PLATFORM = { os: 'win32', path: nodePath, async getHome() { return nodeOs.homedir() } }
function makeTable() {
  const m = new Map()
  return {
    getCache(cwd) { const e = m.get(String(cwd)); return e || { ts: 0, snapshot: null, error: null, cwd: String(cwd) } },
    setCache(v) { if (v && v.cwd) m.set(String(v.cwd), v) },
  }
}
const quiet = { fire: () => {}, isEnabled: () => false }

// 真宿主装配：与 src/host/index.js 同形的最小依赖（计数桩 + 80ms 延迟模拟大工作区）。
function snapDeps(table, counter, fires, backendOf) {
  const adopt = (s, c) => { table.setCache({ ts: Date.now(), snapshot: s, error: null, cwd: c }); return s }
  return {
    canonicalKey: async (x) => 'K729',
    selectEarly: async ({ backendId }) => ({ backendId: (backendOf && backendOf.backendId) || backendId || 'github', source: 'auto', rev: 0 }),
    isComposerSelection: () => true,
    getTrackerRegistry: async () => ({
      modules: () => [], describe: () => ({ backend: 'github', refId: 'a/b', name: 'a/b', url: '' }),
      get: () => ({ list: async () => { counter.n++; await delay(80); return { ok: true, data: [] } } }),
    }),
    getPlatform: async () => PLATFORM, ctx: { get: () => undefined },
    getCache: table.getCache, setCache: table.setCache, CACHE_MS: 60000,
    cacheSnapshotIsCurrent: async () => null,
    upcaseSnapStates: (s) => s, computeLevels: () => ({ byNumber: {}, byKey: {} }),
    groupTickets: () => ({ total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} }),
    getRepoRoot: async (c) => c, getRepoKey: async () => ({ owner: 'a', name: 'b' }),
    readDiskCache: async () => null, writeDiskCache: async () => {},
    adoptSnapshot: adopt,
    detectionExec: async () => ({ ok: false }), getGhPath: () => '', getGhLastError: () => '',
    errText: (e) => String((e && e.message) || e), DEFAULT_CWD: 'K729',
    logCtx: { fire: (l, e, f) => { fires.push({ level: l, event: e, fields: (typeof f === 'function') ? f() : f }) }, isEnabled: () => true },
  }
}
async function refreshDeps(table, counter, fires) {
  const envMod = await import(url('src/host/snapshotEnvelope.js'))
  const adopt = (s, c) => { table.setCache({ ts: Date.now(), snapshot: s, error: null, cwd: c }); return s }
  const d = snapDeps(table, counter, fires)
  d.resetGhCache = () => {}
  d.envelope = envMod.createSnapshotEnvelope({ getGhPath: () => '', getGhLastError: () => '', adoptSnapshot: adopt, logCtx: quiet })
  return d
}
// 先发车、隔 10ms 再来第二趟（第一趟必已登记在途，不赌微任务顺序），返回重建次数。
async function twoTrips(first, second) {
  const p1 = first()
  await delay(10)
  const p2 = second()
  await Promise.all([p1, p2])
}

async function main() {
  const snapMod = await import(url('src/host/sessionSnapshot.js'))
  const refMod = await import(url('src/host/sessionRefresh.js'))

  title('A) 快照路：强制撞强制只重建 1 次，且后来者记 dedup.hit')
  {
    const counter = { n: 0 }
    const fires = []
    const table = makeTable()
    const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
    table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
    await twoTrips(() => h.handleSnapshot({ cwd: 'K729', force: true }), () => h.handleSnapshot({ cwd: 'K729', force: true }))
    must(counter.n === 1, '快照路强制撞强制只重建一次', 'builds=' + counter.n)
    must(fires.some((f) => f.event === 'dedup.hit' && f.fields && f.fields.scope === 'snapshot'),
      '后来者记复用事件 dedup.hit（作用域为快照，不新增事件名）', JSON.stringify(fires.filter((f) => f.event === 'dedup.hit')))
  }

  title('B) 刷新路：强制 x2 并发只重建 1 次（此前整篇无表，必为 2）')
  {
    const counter = { n: 0 }
    const fires = []
    const table = makeTable()
    const h = refMod.createSessionRefresh(await refreshDeps(table, counter, fires))
    await twoTrips(() => h.handleRefresh({ cwd: 'K729' }), () => h.handleRefresh({ cwd: 'K729' }))
    must(counter.n === 1, '刷新路强制 x2 并发只重建一次', 'builds=' + counter.n)
    must(fires.some((f) => f.event === 'dedup.hit' && f.fields && f.fields.scope === 'snapshot'),
      '刷新路后来者同样记 dedup.hit（作用域为快照，不新增事件名）', JSON.stringify(fires.filter((f) => f.event === 'dedup.hit')))
  }

  title('C) 跨路：快照路强制在途 + 刷新路到达，共 1 次（共享表的证明）')
  {
    const counter = { n: 0 }
    const fires = []
    const table = makeTable()
    const hs = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
    const hr = refMod.createSessionRefresh(await refreshDeps(table, counter, fires))
    table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
    await twoTrips(() => hs.handleSnapshot({ cwd: 'K729', force: true }), () => hr.handleRefresh({ cwd: 'K729' }))
    must(counter.n === 1, '跨路强制撞强制只重建一次（两张表做不到这一条）', 'builds=' + counter.n)
  }

  title('D) 口径钉死：该分开的一律分开')
  {
    // D1：强制撞非强制仍为 2（#366 不动：强制恒等于真重建）
    {
      const counter = { n: 0 }
      const fires = []
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await twoTrips(() => h.handleSnapshot({ cwd: 'K729' }), () => h.handleSnapshot({ cwd: 'K729', force: true }))
      must(counter.n === 2, '强制撞非强制在途仍另起一趟（#366 口径不动）', 'builds=' + counter.n)
    }
    // D2：非强制搭强制的车为 1（顺风车只会更新鲜）
    {
      const counter = { n: 0 }
      const fires = []
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await twoTrips(() => h.handleSnapshot({ cwd: 'K729', force: true }), () => h.handleSnapshot({ cwd: 'K729' }))
      must(counter.n === 1, '非强制搭上在途强制那一趟（只重建一次）', 'builds=' + counter.n)
    }
    // D3：换后端是另一把键，为 2（#669 的切换保护在宿主侧同构）
    {
      const counter = { n: 0 }
      const fires = []
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, fires))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await twoTrips(
        () => h.handleSnapshot({ cwd: 'K729', force: true, backendId: 'github', baseRev: 1 }),
        () => h.handleSnapshot({ cwd: 'K729', force: true, backendId: 'markdown', baseRev: 1 }))
      must(counter.n === 2, '换后端的强制各跑各的一趟（键能分清）', 'builds=' + counter.n)
    }
  }

  title('E) 反证：拆掉复用，当场变红')
  {
    // E1：协调器规则被拆（补丁副本）→ 永不搭车。模块零依赖，可独立加载副本验证。
    const tmp = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'anti729-'))
    try {
      const src = read('src/host/snapshotInflight.js')
      must(src.indexOf('ongoing.isForce === true || !isForce') >= 0, '真源里找得到非对称规则那一行（反证靶点存在）')
      const patched = src.split('ongoing.isForce === true || !isForce').join('false')
      const copyPath = nodePath.join(tmp, 'snapshotInflight-broken.mjs')
      fsx.writeFileSync(copyPath, patched)
      const brokenMod = await import(pathToFileURL(copyPath).href)
      const goodMod = await import(url('src/host/snapshotInflight.js'))
      const k = goodMod.snapshotDedupKeyOf({ cwd: 'K', backendId: 'github', lang: '', baseRev: 0, version: '' })
      const parked = goodMod.snapshotInflightPark(k, true, Promise.resolve({ ok: true, marker: 'x' }))
      try {
        must(await goodMod.snapshotInflightTake(k, true, () => {}) !== null, '真模块：同键强制搭上强制（规则行生效）')
      } finally { goodMod.snapshotInflightLeave(k, parked) }
      const k2 = 'anti729|github|||0|'
      const parked2 = brokenMod.snapshotInflightPark(k2, true, Promise.resolve({ ok: true, marker: 'x' }))
      try {
        must(await brokenMod.snapshotInflightTake(k2, true, () => {}) === null, '反证成立：规则拆掉后永不搭车（补丁副本当场验证）')
      } finally { brokenMod.snapshotInflightLeave(k2, parked2) }
    } finally { try { fsx.rmSync(tmp, { recursive: true, force: true }) } catch (eRm) {} }
    // E3：整单回滚——临摹“强制不查表”的旧码（只拆协调器规则一行），真电话路重跑 A/B/C 必须全红（全为 2）。
    const tmpTree = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'rollback729-'))
    try {
      fsx.cpSync(nodePath.join(ROOT, 'src'), nodePath.join(tmpTree, 'src'), { recursive: true })
      const brokenTreePath = nodePath.join(tmpTree, 'src', 'host', 'snapshotInflight.js')
      const brokenTreeSrc = fsx.readFileSync(brokenTreePath, 'utf8')
      fsx.writeFileSync(brokenTreePath, brokenTreeSrc.split('ongoing.isForce === true || !isForce').join('false'))
      const treeUrl = (rel) => pathToFileURL(nodePath.join(tmpTree, rel)).href
      const snapRolled = await import(treeUrl('src/host/sessionSnapshot.js'))
      const refRolled = await import(treeUrl('src/host/sessionRefresh.js'))
      {
        const counter = { n: 0 }
        const table = makeTable()
        const h = snapRolled.createSessionSnapshot(snapDeps(table, counter, []))
        table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
        await twoTrips(() => h.handleSnapshot({ cwd: 'K729', force: true }), () => h.handleSnapshot({ cwd: 'K729', force: true }))
        must(counter.n === 2, '反证 A 成立：回滚后快照路强制撞强制回到 2 次', 'builds=' + counter.n)
      }
      {
        const counter = { n: 0 }
        const table = makeTable()
        const h = refRolled.createSessionRefresh(await refreshDeps(table, counter, []))
        await twoTrips(() => h.handleRefresh({ cwd: 'K729' }), () => h.handleRefresh({ cwd: 'K729' }))
        must(counter.n === 2, '反证 B 成立：回滚后刷新路强制 x2 回到 2 次', 'builds=' + counter.n)
      }
      {
        const counter = { n: 0 }
        const table = makeTable()
        const hs = snapRolled.createSessionSnapshot(snapDeps(table, counter, []))
        const hr = refRolled.createSessionRefresh(await refreshDeps(table, counter, []))
        table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
        await twoTrips(() => hs.handleSnapshot({ cwd: 'K729', force: true }), () => hr.handleRefresh({ cwd: 'K729' }))
        must(counter.n === 2, '反证 C 成立：回滚后跨路回到 2 次', 'builds=' + counter.n)
      }
    } finally { try { fsx.rmSync(tmpTree, { recursive: true, force: true }) } catch (eRm2) {} }
    // E2：静态钉住接线 —— 两处电话路的 Take/Park/Leave 任一段被摘，A/B/C 的行为必红（A–D 已证非恒绿）。
    const snapSrc = read('src/host/sessionSnapshot.js')
    const refSrc = read('src/host/sessionRefresh.js')
    for (const [name, src] of [['sessionSnapshot.js', snapSrc], ['sessionRefresh.js', refSrc]]) {
      must(src.indexOf('./snapshotInflight.js') >= 0, name + ' 接了共用协调器（动态引入在）')
      must(src.indexOf('snapshotInflightTake(') >= 0, name + ' 搭车那一段在（Take）')
      must(src.indexOf('snapshotInflightPark(') >= 0, name + ' 发车登记那一段在（Park）')
      must(src.indexOf('snapshotInflightLeave(') >= 0, name + ' 收车删键那一段在（Leave，只删自己那一条）')
    }
    must(snapSrc.indexOf('snapshotInflightTake(snapshotDedupKey, isForce') >= 0,
      '快照路把“是不是强制”交给了协调器（非对称规则吃得到这个参数）')
    must(refSrc.indexOf('snapshotInflightTake(refreshDedupKey, true') >= 0,
      '刷新路恒以强制身份进表（搭车只搭强制的车）')
  }

  title('F) 门禁入链与文件纪律')
  {
    const pkg = JSON.parse(read('package.json'))
    const chain = String((pkg.scripts || {}).verify || '')
    must(chain.indexOf('verify-729-force-dedup.js') >= 0, '本门禁已挂进 npm run verify 链', 'package.json 里没有它')
    must(chain.indexOf('verify-696-shared-cache.js') >= 0, '既有 #696 门禁仍在链上（与本门禁一起守）', '696 missing')
    for (const rel of ['src/host/snapshotInflight.js', 'src/host/sessionSnapshot.js', 'src/host/sessionRefresh.js']) {
      const n = read(rel).split(/\r?\n/).length
      must(n <= 350, rel + ' 不超 350 行（实得 ' + n + ' 行）')
    }
    const baseline = JSON.parse(read('tests/same-layer-baseline.json'))
    const keys = new Set((baseline.entries || []).map((e) => e.file + '|' + e.resolved))
    must(keys.has('src/host/sessionSnapshot.js|src/host/snapshotInflight.js'), '同层基线记了快照路 → 协调器这条边（owner #729）')
    must(keys.has('src/host/sessionRefresh.js|src/host/snapshotInflight.js'), '同层基线记了刷新路 → 协调器这条边（owner #729）')
    const art = read('tests/verify-log-artifacts.js')
    must(art.indexOf("'dedup.hit'") >= 0, '复用的事件名在日志白名单里（无新增事件，附录对照表不动）')
  }

  title('G) 不要做的事钉死：死线不动，不加节流')
  {
    const probeSrc = read('src/client/kernel/probe-snapshot.js')
    must(probeSrc.indexOf('30000') >= 0 && probeSrc.indexOf('timeout 30s') >= 0,
      '客户端 30 秒死线一字未动（本票禁入，迟到落地是另一张票的范围）')
    const g1 = read('src/host/sessionSnapshot.js')
    const g2 = read('src/host/sessionRefresh.js')
    const g3 = read('src/host/snapshotInflight.js')
    for (const [name, src] of [['sessionSnapshot.js', g1], ['sessionRefresh.js', g2], ['snapshotInflight.js', g3]]) {
      must(!/[Tt]hrottle|[Dd]ebounce/.test(src), name + ' 无节流与防抖（症状不许被时间窗压后）')
    }
  }

  title('H) 同 tick 并发（零延迟）：Take 到 Park 之间无等待点，确定性仍为 1')
  {
    {
      const counter = { n: 0 }
      const table = makeTable()
      const h = snapMod.createSessionSnapshot(snapDeps(table, counter, []))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await Promise.all([h.handleSnapshot({ cwd: 'K729', force: true }), h.handleSnapshot({ cwd: 'K729', force: true })])
      must(counter.n === 1, '快照路同 tick 强制撞强制仍只重建一次', 'builds=' + counter.n)
    }
    {
      const counter = { n: 0 }
      const table = makeTable()
      const h = refMod.createSessionRefresh(await refreshDeps(table, counter, []))
      await Promise.all([h.handleRefresh({ cwd: 'K729' }), h.handleRefresh({ cwd: 'K729' })])
      must(counter.n === 1, '刷新路同 tick 强制撞强制仍只重建一次', 'builds=' + counter.n)
    }
    {
      const counter = { n: 0 }
      const table = makeTable()
      const hs = snapMod.createSessionSnapshot(snapDeps(table, counter, []))
      const hr = refMod.createSessionRefresh(await refreshDeps(table, counter, []))
      table.setCache({ ts: 0, snapshot: null, error: null, cwd: 'K729' })
      await Promise.all([hs.handleSnapshot({ cwd: 'K729', force: true }), hr.handleRefresh({ cwd: 'K729' })])
      must(counter.n === 1, '跨路同 tick 强制撞强制仍只重建一次（谁先谁后都是 1）', 'builds=' + counter.n)
    }
  }

  console.log('\n=== 汇总 ===')
  console.log(total + ' 条判据，' + (broken.length ? broken.length + ' 条不变式破了' : '全部守住'))
  if (broken.length) { console.log('\n破了的不变式：'); for (const b of broken) console.log('  ' + b); process.exit(1) }
  console.log('全部通过 ✅ — 在途时再点强制，重建次数仍是 1')
}

main().catch(function (e) { console.error('RUNNER ERROR:', e && e.stack || e); process.exit(2) })
